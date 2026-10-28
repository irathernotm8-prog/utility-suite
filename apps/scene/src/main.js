// Scene — main process. Owns the scenes, the switch engine, hotkeys, triggers, the menu-bar menu and the quick
// switcher; the windows only ask through window.scene.call(...).
'use strict';
const { app, BrowserWindow, ipcMain, nativeTheme, shell, dialog, Menu, Tray, nativeImage, screen, globalShortcut, powerSaveBlocker, Notification, systemPreferences } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

if (process.env.SCENE_USER_DATA) app.setPath('userData', process.env.SCENE_USER_DATA);
if (!process.env.SCENE_E2E && !app.requestSingleInstanceLock()) { app.exit(0); }

const P = require('./core/plan');
const { Engine } = require('./core/engine');
const templates = require('./core/templates');
const suitelink = require('./suitelink');
const { Store } = require('./store');
const { run: runCmd, stopShells } = require('./platform/run');

const isMac = process.platform === 'darwin', isWin = process.platform === 'win32';
const DEMO = !!process.env.SCENE_DEMO || (!isMac && !isWin);
const platform = DEMO ? require('./platform/demo') : isMac ? require('./platform/mac') : require('./platform/win');
const PLATFORM = DEMO ? (process.env.SCENE_DEMO_PLATFORM || 'darwin') : process.platform;

let store, engine, win = null, switcher = null, tray = null, quitting = false;
let blocker = null, installed = null, installedAt = 0;
const send = (ch, d) => { for (const w of [win, switcher]) if (w && !w.isDestroyed()) w.webContents.send('scene:' + ch, d); };

// ---------------------------------------------------------------- displays
function displays() {
  if (DEMO) return platform.DISPLAYS.map((d, i) => P.describeDisplay(d, i));
  const prim = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => P.describeDisplay({ ...d, primary: d.id === prim }, i));
}

// ---------------------------------------------------------------- installed apps & icons
async function installedApps(force) {
  if (!force && installed && Date.now() - installedAt < 10 * 60000) return installed;
  try { installed = await platform.listApps(); installedAt = Date.now(); } catch (_) { installed = installed || []; }
  return installed;
}
const appIndex = () => new Map((installed || []).filter((a) => a.path).map((a) => [a.path, a]));

const iconCache = new Map(); let iconChain = Promise.resolve();
async function macAppIcon(appPath) {
  const st = fs.statSync(appPath);
  const dir = path.join(app.getPath('userData'), 'app-icons'); fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, crypto.createHash('sha1').update(`${appPath}|${st.mtimeMs}`).digest('hex') + '.png');
  if (!fs.existsSync(out)) {
    let name = (await runCmd('/usr/bin/plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', path.join(appPath, 'Contents', 'Info.plist')], { timeout: 5000 })).stdout.trim();
    if (!name) {   // newer apps keep only an asset catalog; CFBundleIconName + a same-named .icns is common
      name = (await runCmd('/usr/bin/plutil', ['-extract', 'CFBundleIconName', 'raw', '-o', '-', path.join(appPath, 'Contents', 'Info.plist')], { timeout: 5000 })).stdout.trim();
    }
    if (!name) return null;
    if (!/\.icns$/i.test(name)) name += '.icns';
    const icns = path.join(appPath, 'Contents', 'Resources', name);
    if (!fs.existsSync(icns)) return null;
    await runCmd('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '64', icns, '--out', out], { timeout: 10000 });
  }
  const img = nativeImage.createFromPath(out);
  return img.isEmpty() ? null : img.toDataURL();
}
// Never app.getFileIcon on macOS: it crashes Electron 44 (Fresh Desk and Vitals both hit it).
function iconFor(p) {
  if (!p || DEMO) return Promise.resolve(null);
  if (iconCache.has(p)) return Promise.resolve(iconCache.get(p));
  const job = iconChain.then(async () => {
    if (iconCache.has(p)) return iconCache.get(p);
    let url = null;
    try {
      if (fs.existsSync(p)) {
        if (isMac) url = await macAppIcon(p);
        else { const img = await app.getFileIcon(p, { size: 'normal' }); if (img && !img.isEmpty()) url = img.resize({ width: 64, height: 64, quality: 'best' }).toDataURL(); }
      }
    } catch (_) {}
    iconCache.set(p, url); return url;
  });
  iconChain = job.catch(() => null);
  return job;
}

// ---------------------------------------------------------------- switching
function keepAwake(on, label) {
  if (blocker != null && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker);
  blocker = on ? powerSaveBlocker.start('prevent-display-sleep') : null;
  send('awake', on ? label : null);
}
function openDefault(t) {
  const s = String(t || '').trim(); if (!s) return;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[a-z]:\\/i.test(s)) return shell.openExternal(s);
  return shell.openPath(s);
}
let lastSwitchAt = 0;
async function activate(id, { trigger = 'manual' } = {}) {
  const st = store.state();
  const scene = id === 'previous' ? st.previous : store.scene(id);
  if (!scene) throw new Error('That scene no longer exists');
  if (engine.busy) throw new Error('Already switching');
  lastSwitchAt = Date.now();
  const showHud = trigger !== 'manual' && (!win || !win.isVisible() || !win.isFocused());
  if (showHud) showSwitcher('hud');
  const res = await engine.activate(scene, { trigger, progress: (p) => send('progress', p) });
  lastSwitchAt = Date.now();
  const patch = { activeId: id === 'previous' ? null : id, activeAt: Date.now() };
  if (id !== 'previous' && res.previous) patch.previous = res.previous;
  if (id === 'previous') patch.previous = null;
  store.setState(patch);
  if (id !== 'previous') store.saveScene({ ...scene, lastUsed: Date.now(), uses: (scene.uses || 0) + 1 });
  const h = { id: P.uid('h'), sceneId: id, name: scene.name, color: scene.color, glyph: scene.glyph, at: Date.now(), ms: res.ms, ok: res.ok, trigger, placed: res.placed || 0, missed: res.missed || [], steps: (res.steps || []).map((s) => ({ label: s.label, status: s.status, detail: s.detail })) };
  store.addHistory(h);
  send('switched', { result: { ok: res.ok, ms: res.ms, warn: res.warn, missed: res.missed, error: res.error }, state: store.state(), scenes: store.scenes(), history: store.history().slice(0, 30) });
  updateTray();
  if (link) link.emit('switched', linkScenes());
  if (showHud && switcher && !switcher.isDestroyed()) setTimeout(() => { if (switcher && !switcher.isDestroyed() && switcherMode === 'hud') switcher.hide(); }, res.ok ? 1400 : 4000);
  if (res.warn && res.warn.includes('accessibility')) send('need-access', true);
  return res;
}

// ---------------------------------------------------------------- capture
async function capture() {
  const snap = await engine.snapshot();
  snap.windows = snap.windows.filter((w) => !P.isProtected(w.app));
  return snap;
}
async function sceneFromCapture({ name, include, color, glyph }) {
  const snap = await capture();
  const apps = P.captureApps(snap, { include: include ? new Set(include) : null });
  const s = { id: P.uid('s'), name: name || 'New scene', color: color || 'amber', glyph: glyph || 'spark', hotkey: '', createdAt: Date.now(), displays: P.captureDisplays(snap), apps, extras: [], others: 'leave', focusApp: apps[0] ? apps[0].id : null, system: {}, actions: [], triggers: [], triggerMode: 'auto' };
  return store.saveScene(s);
}
/** Refresh a scene's window positions from the screen, for the apps it already has (and optionally add the rest). */
async function updateFromCurrent(id, { addNew = false } = {}) {
  const scene = store.scene(id); if (!scene) throw new Error('Scene not found');
  const snap = await capture();
  const caught = P.captureApps(snap);
  const apps = scene.apps.map((a) => { const c = caught.find((x) => P.sameApp(a, x)); return c ? { ...a, windows: c.windows } : a; });
  if (addNew) for (const c of caught) if (!apps.some((a) => P.sameApp(a, c))) apps.push(c);
  const ds = P.captureDisplays(snap); const old = (scene.displays || []).filter((d) => !ds.some((x) => x.id === d.id));
  return store.saveScene({ ...scene, apps, displays: [...ds, ...old] });
}

// ---------------------------------------------------------------- hotkeys
let hotkeyProblems = [];
function registerHotkeys() {
  globalShortcut.unregisterAll(); hotkeyProblems = [];
  const s = store.settings();
  const reg = (acc, fn, label) => {
    if (!acc) return;
    try { if (!globalShortcut.register(acc, fn)) hotkeyProblems.push({ acc, label }); } catch (_) { hotkeyProblems.push({ acc, label }); }
  };
  reg(s.switcherHotkey, () => showSwitcher('pick'), 'Quick switcher');
  for (const sc of store.scenes()) reg(sc.hotkey, () => activate(sc.id, { trigger: 'hotkey' }).catch(() => {}), sc.name);
  send('hotkeys', hotkeyProblems);
}

// ---------------------------------------------------------------- triggers
const stamp = {};
function notifyAsk(scene, why) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: `Switch to ${scene.name}?`, body: `${why}. Click to switch.`, silent: true });
  n.on('click', () => activate(scene.id, { trigger: 'ask' }).catch(() => {})); n.show();
}
function fire(scene, why, kind) {
  if (!store.settings().triggers) return;
  if (engine.busy || Date.now() - lastSwitchAt < 20000) return;
  if (store.state().activeId === scene.id && kind !== 'schedule') return;
  if (scene.triggerMode === 'ask') return notifyAsk(scene, why);
  activate(scene.id, { trigger: kind }).then((r) => {
    if (store.settings().notify && Notification.isSupported() && (!win || !win.isVisible())) new Notification({ title: `Switched to ${scene.name}`, body: `${why}. ${r.ok ? 'Everything’s in place.' : 'Some things need a look.'}`, silent: true }).show();
  }).catch(() => {});
}
let lastDisplays = [];
function onDisplaysChanged() {
  clearTimeout(onDisplaysChanged.t);
  onDisplaysChanged.t = setTimeout(() => {
    const now = displays(); const prev = lastDisplays; lastDisplays = now;
    send('displays', now);
    const added = now.filter((d) => !prev.some((p) => p.id === d.id)); const removed = prev.filter((p) => !now.some((d) => d.id === p.id));
    for (const sc of store.scenes()) for (const t of sc.triggers || []) {
      for (const d of added) if (P.displayTriggerMatches(t, { type: 'connected', display: d })) return fire(sc, `${d.label} connected`, 'display');
      for (const d of removed) if (P.displayTriggerMatches(t, { type: 'disconnected', display: d })) return fire(sc, `${d.label} disconnected`, 'display');
    }
  }, 2500);
}
function checkSchedules() {
  const now = new Date(); const st = store.state(); const fired = { ...(st.fired || {}) };
  for (const sc of store.scenes()) for (const [i, t] of (sc.triggers || []).entries()) {
    const k = sc.id + ':' + i;
    if (P.scheduleDue(t, now, fired[k])) { fired[k] = P.scheduleStamp(t, now); store.setState({ fired }); return fire(sc, `It’s ${t.time}`, 'schedule'); }
  }
}
let appSeen = null;
async function checkApps() {
  const wanted = store.scenes().flatMap((sc) => (sc.triggers || []).filter((t) => t.kind === 'app' && t.app).map((t) => ({ sc, t })));
  if (!wanted.length) { appSeen = null; return; }
  const running = await engine.running();
  const nowSet = new Set(running.map(P.appKey));
  if (appSeen) {
    for (const { sc, t } of wanted) {
      const live = running.find((r) => P.sameApp(t.app, r));
      if (live && !appSeen.has(P.appKey(live)) && Date.now() - lastSwitchAt > 30000) { appSeen = nowSet; return fire(sc, `${t.app.name} opened`, 'app'); }
    }
  }
  appSeen = nowSet;
}

// ---------------------------------------------------------------- tray / menu bar
function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  const st = store.state(); const scenes = store.scenes(); const s = store.settings();
  const active = scenes.find((x) => x.id === st.activeId);
  if (isMac) tray.setTitle(s.menuBarName && active ? ' ' + active.name : '');
  tray.setToolTip(active ? `Scene — ${active.name}` : 'Scene');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: active ? `Current: ${active.name}` : 'No scene active', enabled: false },
    { type: 'separator' },
    ...scenes.map((sc, i) => ({ label: sc.name, type: 'checkbox', checked: sc.id === st.activeId, accelerator: sc.hotkey || undefined, registerAccelerator: false, click: () => activate(sc.id, { trigger: 'menu' }).catch(() => {}), ...(i < 0 ? {} : {}) })),
    ...(scenes.length ? [{ type: 'separator' }] : []),
    { label: st.previous ? `Restore “${st.previous.name.replace(/^Before /, 'before ')}”` : 'Restore previous', enabled: !!st.previous, click: () => activate('previous', { trigger: 'menu' }).catch(() => {}) },
    { label: 'Quick Switcher…', accelerator: s.switcherHotkey || undefined, registerAccelerator: false, click: () => showSwitcher('pick') },
    { label: 'Save Current Layout as Scene…', click: () => { showWindow(); send('menu', 'capture'); } },
    { type: 'separator' },
    { label: 'Open Scene', click: showWindow },
    { label: 'Quit Scene', click: () => { quitting = true; app.quit(); } }
  ]));
}
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', isMac ? 'trayTemplate.png' : 'icon.png'));
  const icon = isMac ? img : img.resize({ width: 16, height: 16 });
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon);
  updateTray();
  if (!isMac) tray.on('click', () => showSwitcher('pick'));
}

// ---------------------------------------------------------------- windows
function chromeOpts(dark) {
  return { titleBarStyle: 'hidden', ...(isMac ? { trafficLightPosition: { x: 16, y: 15 } } : { titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#ece8e1' : '#2a2620', height: 46 } }) };
}
function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 980, minHeight: 620, show: false, title: 'Scene',
    backgroundColor: dark ? '#0f0e12' : '#f6f4f1', ...chromeOpts(dark),
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  const hidden = process.argv.includes('--hidden') || (app.getLoginItemSettings && app.getLoginItemSettings().wasOpenedAsHidden);
  win.once('ready-to-show', () => { if (!hidden || process.env.SCENE_E2E) win.show(); });
  win.on('close', (e) => { if (!quitting && store.settings().keepRunning) { e.preventDefault(); win.hide(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; });
}
function showWindow() { if (!win) createWindow(); else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } }

let switcherMode = 'pick';
function createSwitcher() {
  switcher = new BrowserWindow({
    width: 640, height: 420, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, title: 'Scene Switcher', backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  switcher.setAlwaysOnTop(true, 'pop-up-menu');
  if (isMac) switcher.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  switcher.loadFile(path.join(__dirname, 'renderer', 'switcher.html'));
  switcher.on('blur', () => { if (switcherMode === 'pick' && !process.env.SCENE_E2E) switcher.hide(); });
  switcher.on('closed', () => { switcher = null; });
}
function showSwitcher(mode = 'pick') {
  if (!switcher) createSwitcher();
  switcherMode = mode;
  const pt = screen.getCursorScreenPoint(); const d = screen.getDisplayNearestPoint(pt).workArea;
  const [w, h] = switcher.getSize();
  switcher.setPosition(Math.round(d.x + (d.width - w) / 2), Math.round(d.y + d.height * 0.22));
  const go = () => { switcher.webContents.send('scene:switcher', { mode, scenes: store.scenes(), state: store.state(), platform: PLATFORM, theme: store.settings().theme, hotkey: store.settings().switcherHotkey }); if (mode === 'pick') { switcher.show(); switcher.focus(); } else switcher.showInactive(); };
  if (switcher.webContents.isLoading()) switcher.webContents.once('did-finish-load', go); else go();
}

// ---------------------------------------------------------------- IPC
const h = (name, fn) => ipcMain.handle('scene:' + name, async (_e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } });
function access() {
  if (DEMO) return { accessibility: process.env.SCENE_DEMO_NOAX ? false : true };
  if (isMac) return { accessibility: systemPreferences.isTrustedAccessibilityClient(false) };
  return { accessibility: true };
}
function registerIpc() {
  h('bootstrap', () => ({
    settings: store.settings(), platform: PLATFORM, demo: DEMO, version: app.getVersion(), scenes: store.scenes(), state: store.state(), history: store.history().slice(0, 30),
    templates: templates.TEMPLATES, supports: platform.supports, access: access(), displays: displays(), hotkeyProblems, awake: blocker != null ? (store.scene(store.state().activeId) || {}).name || true : null
  }));
  h('settings:set', (p) => {
    const s = store.setSettings(p || {});
    if ('theme' in p) nativeTheme.themeSource = s.theme;
    if ('openAtLogin' in p) applyLoginItem();
    if ('switcherHotkey' in p) registerHotkeys();
    updateTray(); return s;
  });
  h('scenes:list', () => store.scenes());
  h('scene:save', (s) => { const r = store.saveScene(s); registerHotkeys(); updateTray(); return r; });
  h('scene:delete', (id) => { store.deleteScene(id); if (store.state().activeId === id) store.setState({ activeId: null }); registerHotkeys(); updateTray(); return store.scenes(); });
  h('scene:duplicate', (id) => { const s = store.scene(id); if (!s) throw new Error('Scene not found'); const c = JSON.parse(JSON.stringify(s)); c.id = P.uid('s'); c.name = s.name + ' copy'; c.hotkey = ''; c.createdAt = Date.now(); c.uses = 0; c.lastUsed = null; for (const a of c.apps) { a.id = P.uid('a'); for (const w of a.windows) w.id = P.uid('w'); } c.focusApp = c.apps[0] ? c.apps[0].id : null; return store.saveScene(c); });
  h('scenes:reorder', (ids) => { store.reorder(ids); updateTray(); return store.scenes(); });
  h('scene:activate', (id, trigger) => activate(id, { trigger: trigger || 'manual' }));
  h('scene:refit', (id) => {
    const s = store.scene(id); if (!s) throw new Error('Scene not found');
    const cur = displays(); const { map } = P.matchDisplays(s.displays && s.displays.length ? s.displays : cur, cur);
    const apps = s.apps.map((a) => ({ ...a, windows: a.windows.map((w) => ({ ...w, display: (map[w.display] || cur.find((d) => d.primary) || cur[0]).id })) }));
    return store.saveScene({ ...s, apps, displays: cur });
  });
  h('scene:preview', async (id) => { const sc = store.scene(id); const snap = await engine.snapshot(); const running = await engine.running(); const pl = P.planSwitch(sc, snap, { running, keep: store.settings().keepApps }); return { launch: pl.launch.map((a) => a.name), already: pl.already.map((a) => a.name), others: pl.others.map((a) => a.name), fallback: pl.displayFallback }; });
  h('scene:from-template', async (tid) => store.saveScene(templates.fromTemplate(tid, await installedApps(), displays(), { platform: PLATFORM })));
  h('scene:from-capture', (o) => sceneFromCapture(o || {}));
  h('scene:update-from-current', (id, o) => updateFromCurrent(id, o || {}));
  h('capture', () => capture());
  h('displays', () => displays());
  h('apps:installed', (force) => installedApps(force));
  h('apps:running', () => engine.running());
  h('icons', async (paths) => { const out = {}; for (const p of (paths || []).slice(0, 120)) out[p] = await iconFor(p); return out; });
  h('arrange', (w, o) => engine.arrange(w, o || {}));
  h('tidy', (id) => engine.tidy(id));
  h('focus', (a, w) => platform.focus(a, w));
  h('system:state', async () => { const out = {}; try { Object.assign(out, await platform.getVolume()); } catch (_) {} try { out.appearance = await platform.getAppearance(); } catch (_) {} return out; });
  h('shortcuts', () => platform.listShortcuts());
  h('pick', async (kind) => {
    const opts = { image: { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp', 'bmp', 'gif'] }] }, file: { properties: ['openFile'] }, folder: { properties: ['openDirectory'] },
      app: isMac ? { defaultPath: '/Applications', properties: ['openFile'], filters: [{ name: 'Apps', extensions: ['app'] }] } : { properties: ['openFile'], filters: [{ name: 'Programs', extensions: ['exe'] }] } }[kind] || { properties: ['openFile'] };
    const r = await dialog.showOpenDialog(win, opts);
    if (r.canceled || !r.filePaths.length) return null;
    const p = r.filePaths[0];
    if (kind === 'app') {
      const known = (await installedApps()).find((a) => a.path === p);
      if (known) return known;
      if (isMac) { const b = await runCmd('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(p, 'Contents', 'Info.plist')], { timeout: 5000 }); return { name: path.basename(p, '.app'), bundleId: b.stdout.trim() || null, path: p }; }
      return { name: path.basename(p).replace(/\.exe$/i, ''), path: p };
    }
    return p;
  });
  h('access:request', () => {
    if (isMac && !DEMO) { systemPreferences.isTrustedAccessibilityClient(true); shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'); }
    return access();
  });
  h('access:check', () => access());
  h('previous:restore', () => activate('previous', { trigger: 'manual' }));
  h('history:clear', () => { store.write('history.json', []); return []; });
  h('export', async (ids) => {
    const list = store.scenes().filter((s) => !ids || ids.includes(s.id));
    const r = await dialog.showSaveDialog(win, { title: 'Export scenes', defaultPath: path.join(app.getPath('documents'), `Scenes ${new Date().toISOString().slice(0, 10)}.json`), filters: [{ name: 'Scene file', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify({ scene: 1, from: PLATFORM, scenes: list }, null, 1)); shell.showItemInFolder(r.filePath); return r.filePath;
  });
  h('import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Import scenes', properties: ['openFile'], filters: [{ name: 'Scene file', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    const j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); const list = Array.isArray(j) ? j : j.scenes || [];
    const inst = await installedApps(); let n = 0;
    for (const s of list) {
      if (!s || !Array.isArray(s.apps)) continue;
      // scenes made on the other system: find the same apps here by name
      const apps = s.apps.map((a) => { const m = inst.find((x) => P.sameApp(a, x)) || inst.find((x) => x.name.toLowerCase() === String(a.name || '').toLowerCase()); return m ? { ...a, name: m.name, bundleId: m.bundleId || null, path: m.path || null, aumid: m.aumid || null } : a; });
      store.saveScene({ ...s, id: P.uid('s'), apps, hotkey: store.scenes().some((x) => x.hotkey && x.hotkey === s.hotkey) ? '' : s.hotkey }); n++;
    }
    registerHotkeys(); updateTray(); return n;
  });
  h('reveal-data', () => { shell.openPath(app.getPath('userData')); return true; });
  h('open-external', (u) => { if (/^(https?:|x-apple\.systempreferences:|ms-settings:)/.test(u)) shell.openExternal(u); return true; });
  h('test-open', (t) => openDefault(t));
  h('switcher:hide', () => { if (switcher) switcher.hide(); return true; });
  h('switcher:open-app', () => { if (switcher) switcher.hide(); showWindow(); return true; });
  h('hotkeys:pause', (on) => { if (on) globalShortcut.unregisterAll(); else registerHotkeys(); return true; });
  h('window:chrome', (c) => { if (!isMac && win && win.setTitleBarOverlay) { try { win.setTitleBarOverlay(c); } catch (_) {} } return true; });
}
function applyLoginItem() { try { app.setLoginItemSettings({ openAtLogin: !!store.settings().openAtLogin, openAsHidden: true, args: ['--hidden'] }); } catch (_) {} }

function menu() {
  const tpl = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'New Scene…', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new') },
      { label: 'Save Current Layout as Scene…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu', 'capture') },
      { type: 'separator' }, { label: 'Import Scenes…', click: () => send('menu', 'import') }, { label: 'Export Scenes…', click: () => send('menu', 'export') },
      { type: 'separator' }, isMac ? { role: 'close' } : { label: 'Quit', click: () => { quitting = true; app.quit(); } }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      ...['scenes', 'desktop', 'automations', 'history'].map((p, i) => ({ label: p[0].toUpperCase() + p.slice(1), accelerator: `CmdOrCtrl+${i + 1}`, click: () => send('navigate', p) })),
      { label: 'Quick Switcher', accelerator: 'CmdOrCtrl+K', click: () => showSwitcher('pick') },
      { type: 'separator' }, { role: 'reload', accelerator: 'CmdOrCtrl+Shift+R' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.on('second-instance', showWindow);

// ---------------------------------------------------------------- Utility Suite link (Atoll switches scenes from the island)
let link = null;
function linkScenes() {
  const st = store.state();
  return { scenes: store.scenes().map((s) => ({ id: s.id, name: s.name, color: s.color || null, glyph: s.glyph || null, lastUsed: s.lastUsed || null })), activeId: st.activeId || null, hasPrevious: !!st.previous, busy: !!(engine && engine.busy) };
}
function startLink() {
  try {
    link = suitelink.serve('scene', { version: app.getVersion(), calls: {
      list: () => linkScenes(),
      activate: async (id) => { const r = await activate(String(id), { trigger: 'atoll' }); return { ok: r.ok, ms: r.ms, error: r.error || null }; },
      previous: async () => { const r = await activate('previous', { trigger: 'atoll' }); return { ok: r.ok }; },
      open: () => { showWindow(); return true; }
    } });
  } catch (_) { link = null; }
}
app.on('will-quit', () => { try { if (link) link.close(); } catch (_) {} });
app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  startLink();
  nativeTheme.themeSource = store.settings().theme;
  if (isWin && !DEMO) platform.setConverters({ toDip: (r) => screen.screenToDipRect(null, r), toScreen: (r) => screen.dipToScreenRect(null, r) });
  engine = new Engine({ platform, displays, openDefault, keepAwake, appIndex, settings: () => store.settings() });
  registerIpc(); menu();
  createWindow();
  try { createTray(); } catch (_) {}
  registerHotkeys(); applyLoginItem();
  installedApps().catch(() => {});
  lastDisplays = displays();
  screen.on('display-added', onDisplaysChanged); screen.on('display-removed', onDisplaysChanged); screen.on('display-metrics-changed', () => send('displays', displays()));
  setInterval(checkSchedules, 30000);
  setInterval(() => { checkApps().catch(() => {}); }, 8000);
  // a scene that keeps the screen awake stays in force after a restart only if it is still the active one
  const act = store.scene(store.state().activeId); if (act && act.system && act.system.keepAwake) keepAwake(true, act.name);
  if (process.env.SCENE_E2E) require(process.env.SCENE_E2E)({ win: () => win, switcher: () => switcher, app, store, engine, platform, activate, showSwitcher });
  app.on('activate', showWindow);
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); });
app.on('before-quit', () => { quitting = true; stopShells(); });
app.on('window-all-closed', () => { if (!store.settings().keepRunning && !isMac) app.quit(); });
