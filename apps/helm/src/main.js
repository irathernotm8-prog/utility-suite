// Helm — main process. Reads the controllers, runs the mapper on a steady tick, sends real input through the platform
// helper, steps aside for games, and owns the windows: Settings, and one see-through overlay for the HUD, the on-screen
// keyboard, the quick panel and the command-layer hint. Windows only ask through window.helm.call(...).
'use strict';
const { app, BrowserWindow, ipcMain, nativeTheme, shell, Menu, Tray, nativeImage, screen, systemPreferences, clipboard } = require('electron');
const path = require('path');

if (process.env.HELM_USER_DATA) app.setPath('userData', process.env.HELM_USER_DATA);
if (!process.env.HELM_E2E && !app.requestSingleInstanceLock()) { app.exit(0); }

const { Store } = require('./store');
const { Output } = require('./output');
const { Controllers } = require('./controllers');
const { Mapper } = require('./core/mapper');
const { ACTIONS, BINDABLE, DEFAULT_BINDINGS, GROUPS, specFor } = require('./core/actions');
const { GameGuard, DEFAULT_GAMES, DEFAULT_KEEP } = require('./games');
const suitelink = require('./suitelink');

const isMac = process.platform === 'darwin', isWin = process.platform === 'win32';
const DEMO = !!process.env.HELM_DEMO || (!isMac && !isWin);
const PLATFORM = DEMO ? (process.env.HELM_DEMO_PLATFORM || 'darwin') : process.platform;

let store, platform, output, controllers, mapper, guard;
let win = null, overlay = null, tray = null, quitting = false, link = null;
const logs = [];
function log(s) { logs.push(`${new Date().toISOString().slice(11, 19)} ${s}`); if (logs.length > 300) logs.shift(); if (process.env.HELM_DEBUG) console.log('[helm]', s); }
const settings = () => store.get();
const send = (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send('helm:' + ch, d); };
const sendOverlay = (ch, d) => { if (overlay && !overlay.isDestroyed()) overlay.webContents.send('helm:' + ch, d); };

// ---------------------------------------------------------------- status
function access() {
  if (DEMO) return { accessibility: !process.env.HELM_DEMO_NOAX };
  if (isMac) return { accessibility: systemPreferences.isTrustedAccessibilityClient(false) };
  return { accessibility: true };
}
function status() {
  const g = guard ? guard.status() : {};
  return {
    enabled: mapper ? mapper.enabled : true, paused: mapper ? mapper.paused : null, mode: mapper ? mapper.mode : 'pointer',
    front: g.front || null, claims: g.claims || [], override: !!g.override,
    helper: platform ? !!platform.ready : false, access: access(), devices: controllers ? controllers.list() : [], linked: link ? link.clients() : 0
  };
}
let statusTimer = null;
function pushStatus() {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { const s = status(); send('status', s); updateTray(s); if (link) link.emit('state', { enabled: s.enabled, paused: s.paused }); }, 30);
}

// ---------------------------------------------------------------- overlay: HUD, keyboard, quick panel, layer hint
const shown = { hud: false, keyboard: false, panel: false, hint: false };
let hideTimer = null, hudTimer = null, overlayDisplay = null;
function createOverlay() {
  overlay = new BrowserWindow({
    show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, backgroundColor: '#00000000', title: 'Helm Overlay',
    ...(isMac ? { type: 'panel' } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false }
  });
  overlay.setIgnoreMouseEvents(true);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  if (isMac) overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  overlay.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlay.on('closed', () => { overlay = null; });
}
function placeOverlay() {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  if (overlayDisplay !== d.id || !overlay.isVisible()) { overlay.setBounds(d.workArea); overlayDisplay = d.id; }
}
function overlayShow(part, on) {
  if (!overlay) createOverlay();
  shown[part] = on;
  const any = Object.values(shown).some(Boolean);
  if (any) {
    clearTimeout(hideTimer);
    if (!overlay.isVisible()) { placeOverlay(); overlay.showInactive(); if (isMac) overlay.setAlwaysOnTop(true, 'screen-saver'); }
  } else {
    clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (overlay && !Object.values(shown).some(Boolean)) overlay.hide(); }, 260);
  }
}
const overlayTheme = () => ({ platform: PLATFORM, accent: settings().lightbarColor, kind: (controllers && controllers.active() && controllers.active().kind) || 'dualsense' });
const ui = {
  hud(text, opts = {}) {
    if (!settings().showHud && !opts.force) return;
    overlayShow('hud', true); sendOverlay('hud', { text, icon: opts.icon || null, tone: opts.tone || null, ...overlayTheme() });
    clearTimeout(hudTimer); hudTimer = setTimeout(() => { sendOverlay('hud', null); overlayShow('hud', false); }, opts.ms || 1300);
  },
  keyboard(view) { overlayShow('keyboard', !!view); sendOverlay('keyboard', view ? { ...view, ...overlayTheme() } : null); pushStatus(); },
  panel(view) { overlayShow('panel', !!view); sendOverlay('panel', view ? { ...view, battery: batteryNow(), ...overlayTheme() } : null); pushStatus(); },
  layerHint(bindings) { overlayShow('hint', !!bindings); sendOverlay('hint', bindings ? { bindings, labels: actionLabels(), ...overlayTheme() } : null); },
  state(s) { pushStatus(); feedback(); if (s && s.why === 'chord') ui.hud(mapper.enabled ? 'Helm is on' : 'Helm is off — hold Create + Options to turn it back on', { icon: 'power', force: true, ms: 2200 }); },
  chord() {
    if (mapper.paused && guard.overrideNow()) { ui.hud('Helm is back on for this app', { icon: 'power', force: true, ms: 1800 }); return; }
    const on = !mapper.enabled; store.set({ enabled: on }); mapper.setEnabled(on, 'chord');
  },
  haptic(kind) { if (settings().haptics) rumble(kind === 'toggle' ? 150 : 70, kind === 'toggle' ? 90 : 45); },
  openSettings() { showWindow(); }
};
function batteryNow() { const d = controllers && controllers.active(); return d && d.frame ? { level: d.frame.battery, charging: d.frame.charging, name: d.name } : null; }
let labelCache = null;
function actionLabels() {
  if (labelCache) return labelCache;
  labelCache = Object.fromEntries(ACTIONS.map((a) => [a.id, a.label])); return labelCache;
}

// ---------------------------------------------------------------- controller lights and rumble
function hexRgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return [56, 214, 255]; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function feedback() {
  if (!controllers || mapper.paused || !settings().lightbar) return;
  if (mapper.enabled) controllers.feedback({ rgb: hexRgb(settings().lightbarColor), players: 0x04 });
  else controllers.feedback({ rgb: [24, 24, 30], players: 0 });
}
let rumbleTimer = null;
function rumble(ms, strength) {
  if (!controllers || mapper.paused) return;
  controllers.feedback({ rumble: [strength, Math.round(strength * 0.6)] });
  clearTimeout(rumbleTimer); rumbleTimer = setTimeout(() => controllers.feedback({ rumble: [0, 0] }), ms);
}

// ---------------------------------------------------------------- the loop
let tickTimer = null, frameSentAt = 0, latest = null;
function startLoop() {
  const { performance } = require('perf_hooks');
  tickTimer = setInterval(() => {
    const now = performance.now();
    mapper.tick(now);
    if (win && win.isVisible() && now - frameSentAt > 33) { frameSentAt = now; send('frame', slim(latest)); }
  }, 8);
}
function slim(f) { if (!f) return null; return { b: f.b, a: f.a, t: f.t.map((p) => ({ x: p.x, y: p.y })), kind: f.kind, conn: f.conn, battery: f.battery, charging: f.charging, touch: f.hasTouch }; }

// ---------------------------------------------------------------- windows
function chromeOpts(dark) {
  return { titleBarStyle: 'hidden', ...(isMac ? { trafficLightPosition: { x: 16, y: 15 } } : { titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#e7ecf3' : '#1d2430', height: 46 } }) };
}
function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1180, height: 800, minWidth: 940, minHeight: 620, show: false, title: 'Helm', backgroundColor: dark ? '#0c0f14' : '#f4f6f9', ...chromeOpts(dark),
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  const hidden = process.argv.includes('--hidden') || (app.getLoginItemSettings && app.getLoginItemSettings().wasOpenedAsHidden);
  win.once('ready-to-show', () => { if (!hidden || settings().firstRun || process.env.HELM_E2E) win.show(); });
  win.on('close', (e) => { if (!quitting && settings().keepRunning) { e.preventDefault(); win.hide(); if (isMac && app.dock) app.dock.hide(); } });
  win.on('show', () => { if (isMac && app.dock) app.dock.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; });
}
function showWindow() { if (!win) createWindow(); else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } }

// ---------------------------------------------------------------- tray / menu bar
function updateTray(s = status()) {
  if (!tray || tray.isDestroyed()) return;
  const dev = s.devices.find((d) => d.active) || s.devices[0];
  const line = !s.enabled ? 'Helm is off' : s.paused ? `Paused for ${s.paused}` : dev ? `Driving with ${dev.name}` : 'Waiting for a controller';
  tray.setToolTip(`Helm — ${line}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: line, enabled: false },
    ...(dev && dev.battery != null ? [{ label: `${dev.name}: ${dev.battery}%${dev.charging ? ' (charging)' : ''}`, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Helm is on', type: 'checkbox', checked: s.enabled, click: (i) => setEnabled(i.checked) },
    ...(s.paused ? [{ label: `Use Helm over ${s.paused}`, click: () => guard.overrideNow() }] : []),
    { type: 'separator' },
    { label: 'Open Helm', click: showWindow },
    { label: 'Quit Helm', role: 'quit' }
  ]));
}
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', isMac ? 'trayTemplate.png' : 'tray.png'));
  const icon = img.isEmpty() ? nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 16, height: 16 }) : img;
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon); updateTray();
  if (!isMac) tray.on('click', showWindow);
}
function setEnabled(on) { store.set({ enabled: !!on }); mapper.setEnabled(!!on, 'app'); pushStatus(); return status(); }

// ---------------------------------------------------------------- IPC
const h = (name, fn) => ipcMain.handle('helm:' + name, async (_e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } });
function catalog() {
  return ACTIONS.map((a) => ({ id: a.id, label: a.label, group: a.group, kind: a.kind, available: a.kind === 'helm' || a.kind === 'mouse' || a.kind === 'media' || a.kind === 'switcher' || !!specFor(a, PLATFORM) }));
}
function registerIpc() {
  h('bootstrap', () => ({
    settings: settings(), platform: PLATFORM, demo: DEMO, version: app.getVersion(), actions: catalog(), groups: GROUPS, bindable: BINDABLE, defaults: DEFAULT_BINDINGS,
    defaultGames: DEFAULT_GAMES, defaultKeep: DEFAULT_KEEP, status: status()
  }));
  h('status', () => status());
  h('set', (patch) => {
    const s = store.set(patch);
    if ('theme' in patch) nativeTheme.themeSource = s.theme;
    if ('openAtLogin' in patch) applyLoginItem();
    if ('lightbarColor' in patch || 'lightbar' in patch) feedback();
    if ('gameApps' in patch || 'keepApps' in patch || 'gameMode' in patch || 'fullscreenGames' in patch) guard.decide();
    send('settings', s); return s;
  });
  h('bind', (layer, button, action) => { const s = store.bind(layer, button, action); send('settings', s); return s; });
  h('resetBindings', () => { const s = store.resetBindings(); send('settings', s); return s; });
  h('setEnabled', (on) => setEnabled(on));
  h('override', () => guard.overrideNow());
  h('openAccess', () => {
    if (isMac && !DEMO) { systemPreferences.isTrustedAccessibilityClient(true); shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'); }
    return access();
  });
  h('testFeel', () => { feedback(); rumble(160, 110); ui.hud('Hello from Helm', { icon: 'controller', force: true }); return true; });
  h('preview', (what) => {
    if (what === 'keyboard') mapper.setMode(mapper.mode === 'keyboard' ? 'pointer' : 'keyboard');
    else if (what === 'panel') mapper.setMode(mapper.mode === 'panel' ? 'pointer' : 'panel');
    else if (what === 'hint') { ui.layerHint(mapper.s().bindings.layer); setTimeout(() => ui.layerHint(null), 3500); }
    return mapper.mode;
  });
  h('logs', () => logs.slice(-120));
  h('openExternal', (url) => { if (/^(https?:|x-apple)/.test(url)) shell.openExternal(url); return true; });
  h('quit', () => { quitting = true; app.quit(); });
}

function applyLoginItem() {
  if (DEMO || (!app.isPackaged && !settings().openAtLogin)) return;
  try { app.setLoginItemSettings({ openAtLogin: !!settings().openAtLogin, openAsHidden: true, args: ['--hidden'] }); } catch (_) {}
}

// ---------------------------------------------------------------- Utility Suite link (Game Hub, Atoll and friends)
function startLink() {
  try {
    link = suitelink.serve('helm', {
      version: app.getVersion(),
      calls: {
        status: () => { const s = status(); return { enabled: s.enabled, paused: s.paused, mode: s.mode, controller: (s.devices.find((d) => d.active) || null) }; },
        // A game (or Game Hub while it runs one) holds the controller: renew every few seconds; it lapses on its own.
        claim: (owner, seconds, label) => guard.claim(owner, seconds, label),
        release: (owner) => guard.release(owner),
        setEnabled: (on) => { setEnabled(!!on); return mapper.enabled; },
        toggle: () => { setEnabled(!mapper.enabled); return mapper.enabled; },
        open: () => { showWindow(); return true; }
      },
      onError: (e) => log('link: ' + e.message)
    });
  } catch (e) { link = null; log('link: ' + e.message); }
}

// ---------------------------------------------------------------- start
function pickPlatform() {
  const dataDir = app.getPath('userData');
  if (DEMO) return require('./platform/demo').create();
  if (isMac) return require('./platform/mac').create({ dataDir, clipboard, log });
  return require('./platform/win').create({ dataDir, log });
}
let axWas = null;
function watchAccess() {
  if (!isMac || DEMO) return;
  setInterval(() => {
    const ok = systemPreferences.isTrustedAccessibilityClient(false);
    if (axWas === false && ok) { log('accessibility granted, restarting input helper'); platform.stop(); setTimeout(() => { platform = pickPlatform(); output.p = platform; platform.start(); guard.platform = platform; }, 300); }
    if (axWas !== ok) pushStatus();
    axWas = ok;
  }, 2000);
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  nativeTheme.themeSource = settings().theme;
  platform = pickPlatform();
  if (isWin && !DEMO && platform.setConverter) platform.setConverter((p) => screen.dipToScreenPoint(p));
  platform.start();
  output = new Output(platform, screen);
  mapper = new Mapper({ out: output, ui, settings, platform: PLATFORM });
  mapper.enabled = settings().enabled !== false;
  controllers = new Controllers({ platform, log });
  controllers.on('frame', (f) => { latest = f; mapper.update(f); });
  let had = 0;
  controllers.on('devices', (list) => {
    send('devices', list); pushStatus();
    const n = list.length;
    if (n > had) { feedback(); const d = list.find((x) => x.active) || list[list.length - 1]; if (d) ui.hud(`${d.name} connected`, { icon: 'controller', ms: 1600 }); }
    had = n;
  });
  controllers.start();
  if (DEMO) require('./demo-controller').attach(controllers);
  guard = new GameGuard({ platform: { front: () => platform.front() }, settings, screen, onChange: (reason) => {
    mapper.setPaused(reason);
    if (reason) { output.releaseAll(); ui.hud(`Helm is resting — ${reason} has the controller`, { icon: 'game', force: true, ms: 2000 }); }
    else if (mapper.enabled) { ui.hud('Helm is back', { icon: 'controller', ms: 1100 }); feedback(); }
    pushStatus();
  } });
  guard.start();
  registerIpc(); startLink();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []), { role: 'editMenu' }, { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] }, { role: 'windowMenu' }
  ]));
  createWindow(); createOverlay();
  try { createTray(); } catch (e) { log('tray: ' + e.message); }
  applyLoginItem(); watchAccess(); startLoop();
  if (settings().firstRun) store.set({ firstRun: false });
  if (process.env.HELM_E2E) require(process.env.HELM_E2E)({ app, win: () => win, overlay: () => overlay, mapper, controllers, platform, store, guard, ui });
  app.on('activate', showWindow);
  app.on('second-instance', showWindow);
});
app.on('before-quit', () => { quitting = true; try { mapper && mapper.releaseAll(); output && output.releaseAll(); } catch (_) {} });
app.on('will-quit', () => { try { clearInterval(tickTimer); controllers && controllers.stop(); platform && platform.stop(); guard && guard.stop(); link && link.close(); store && store.flush(); } catch (_) {} });
app.on('window-all-closed', () => { if (!settings().keepRunning) app.quit(); });
