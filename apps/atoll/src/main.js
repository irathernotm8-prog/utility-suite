// Atoll — main process. Owns the island window, the settings window, the menu bar / tray item and every module
// (timers, media, the Touchline live match, the shelf, weather and system glance). The windows only ask through
// window.atoll.call(...) and listen for 'atoll:patch' updates.
'use strict';
const { app, BrowserWindow, ipcMain, nativeTheme, shell, Menu, Tray, nativeImage, globalShortcut, Notification, clipboard, screen, net, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');

if (process.env.ATOLL_USER_DATA) app.setPath('userData', process.env.ATOLL_USER_DATA);
if (!process.env.ATOLL_E2E && !app.requestSingleInstanceLock()) { app.exit(0); }

const { Store } = require('./store');
const { Island } = require('./island');
const { Timers, parseDuration, fmt } = require('./modules/timers');
const { Media } = require('./modules/media');
const { MatchWatch } = require('./modules/match');
const { Shelf } = require('./modules/shelf');
const { Glance } = require('./modules/glance');
const touchline = require('./touchline');
const crests = require('./touchline/images');
const { getJson, getBuffer } = require('./touchline/vendor/http');
const { stopShells } = require('./platform/run');

const IS_MAC = process.platform === 'darwin';
const DEMO = !!process.env.ATOLL_DEMO || (!IS_MAC && process.platform !== 'win32');
const ROOT = path.join(__dirname, '..');

crests.registerScheme();
process.on('unhandledRejection', (e) => { console.error('[atoll] unhandled', (e && e.stack) || e); if (process.env.ATOLL_E2E) require('fs').appendFileSync('/tmp/atoll-dbg.log', String((e && e.stack) || e) + '\n'); });

let store, island, settingsWin = null, tray = null, timers, media, match, shelf, glance, quitting = false, persistTimer = null;
const settings = () => store.settings();

// ---------------------------------------------------------------- push to windows
function windows() { return [island?.win, settingsWin].filter((w) => w && !w.isDestroyed()); }
function patch(p) { for (const w of windows()) w.webContents.send('atoll:patch', p); }
function snapshot() {
  return {
    settings: settings(), geo: island?.geo || null, version: app.getVersion(), platform: process.platform, demo: DEMO,
    timers: timers.snapshot(), media: media.snapshot(), match: match.snapshot(), shelf: shelf.snapshot(), glance: glance.snapshot(),
    displays: screen.getAllDisplays().map((d, i) => ({ id: d.id, label: d.label || (d.internal ? 'Built-in display' : `Display ${i + 1}`), primary: d.id === screen.getPrimaryDisplay().id, size: `${d.size.width}×${d.size.height}` }))
  };
}
function burst(b) { island?.send('atoll:burst', { ...b, at: Date.now() }); }
function notify(title, body) {
  if (!Notification.isSupported()) return;
  try { const n = new Notification({ title, body, silent: true }); n.on('click', () => openIsland()); n.show(); } catch (_) {}
}

// ---------------------------------------------------------------- modules
function setupModules() {
  const dir = app.getPath('userData');
  const st = store.state();

  timers = new Timers({ saved: st.timers || {}, focusPlan: () => settings().focus });
  timers.on('change', () => { patch({ timers: timers.snapshot() }); persistSoon(); updateTray(); });
  timers.on('done', (e) => {
    if (e.kind === 'timer') {
      burst({ kind: 'timer', id: e.timer.id, label: e.timer.label, duration: e.timer.duration });
      if (settings().timerNotify) notify(`${e.timer.label} — done`, `Your ${fmt(e.timer.duration)} timer finished.`);
    } else {
      const label = e.to === 'work' ? 'Back to focus' : e.to === 'long' ? 'Long break' : 'Short break';
      burst({ kind: 'focus', to: e.to, cycle: e.cycle, label });
      if (settings().timerNotify) notify(label, e.to === 'work' ? `Focus session ${e.cycle} starts now.` : 'Nice work. Step away for a bit.');
    }
  });

  media = new Media({
    dir: path.join(dir, 'artwork'), demo: DEMO, players: () => settings().macPlayers, nativeImage,
    fetchBuffer: (u) => getBuffer(u, { timeout: 8000, retries: 1 })
  });
  media.on('change', () => patch({ media: media.snapshot() }));
  media.on('track', (t) => { if (settings().trackBurst && settings().modules.media) burst({ kind: 'track', title: t.title, artist: t.artist, art: t.art, player: t.player }); });

  touchline.init(dir, { fixtureDir: process.env.ATOLL_FIXTURES || null });
  match = new MatchWatch({ data: touchline, getFollow: () => store.state().follow || null, setFollow: (f) => store.setState({ follow: f }) });
  match.on('change', () => { patch({ match: match.snapshot() }); updateTray(); });
  match.on('moment', (m) => {
    const s = settings();
    if (!s.modules.match) return;
    const t = m.match;
    const score = `${t.home.short || t.home.name} ${t.home.score ?? 0}–${t.away.score ?? 0} ${t.away.short || t.away.name}`;
    if (m.kind === 'goal') {
      if (s.goalBurst) burst({ kind: 'goal', side: m.side, match: t, scorer: m.scorer, minute: m.minute, penalty: m.penalty, ownGoal: m.ownGoal });
      if (s.goalNotify) notify(`Goal! ${m.side === 'home' ? t.home.name : t.away.name}`, `${score}${m.scorer ? ` · ${m.scorer}${m.minute ? ` ${m.minute}'` : ''}` : ''}`);
    } else {
      if (s.goalBurst) burst({ kind: m.kind, match: t });
      if (s.goalNotify) notify(m.kind === 'kickoff' ? 'Kick-off' : 'Full-time', score);
    }
  });

  // Linux test runs: X11 clipboard reads can stall under Xvfb, so the pretend computer gets a pretend clipboard.
  const cb = DEMO && process.platform === 'linux' ? (() => { let t = ''; return { readText: () => t, writeText: (v) => { t = String(v); } }; })() : clipboard;
  shelf = new Shelf({ load: () => store.state().shelf || [], save: (items) => store.setState({ shelf: items }), clipboard: cb, size: () => settings().clipboardSize, enabled: () => settings().clipboard && settings().modules.shelf });
  shelf.on('change', () => patch({ shelf: shelf.snapshot() }));

  glance = new Glance({ getJson: (u) => getJson(u, { timeout: 10000, retries: 1 }), place: () => settings().weather, units: () => settings().units });
  glance.on('change', () => patch({ glance: glance.snapshot() }));
  glance.on('sys', () => patch({ glance: glance.snapshot() }));

  if (DEMO && process.env.ATOLL_DEMO_SEED) seedDemo();
  media.start(); match.start(); shelf.watch(); shelf.prune(); glance.start();
}

function persistSoon() { clearTimeout(persistTimer); persistTimer = setTimeout(() => store.setState({ timers: timers.serialize() }), 400); }

// For screenshots and the e2e run: a pretend afternoon with things going on.
function seedDemo() {
  shelf.add([path.join(ROOT, 'build', 'icon.png'), path.join(ROOT, 'README.md'), path.join(ROOT, 'package.json')]);
  for (const t of ['https://www.fotmob.com/matches', 'Q4 paid social: +18% sign-ups week over week', 'git push origin main']) { shelf.cb.writeText(t); shelf.sample(); }
}

// ---------------------------------------------------------------- island
function createIsland() {
  island = new Island({
    preload: path.join(__dirname, 'preload.js'), page: path.join(__dirname, 'renderer', 'island.html'), settings,
    onEvent: (kind, d) => {
      if (kind === 'blur') island.send('atoll:blur', true);
      if (kind === 'geometry') patch({ geo: d });
    }
  });
  island.create();
}
function openIsland(view) { if (!island) return; island.show(); island.focus(); island.send('atoll:open', { view: view || null }); }

// ---------------------------------------------------------------- settings window
function openSettings(section) {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); if (section) settingsWin.webContents.send('atoll:section', section); return; }
  const dark = settings().theme === 'dark' || (settings().theme === 'system' && nativeTheme.shouldUseDarkColors);
  settingsWin = new BrowserWindow({
    width: 860, height: 620, minWidth: 720, minHeight: 520, show: false, title: 'Atoll Settings',
    backgroundColor: dark ? '#0c0c10' : '#f6f6f8',
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } } : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#e8e8ee' : '#222228', height: 44 } }),
    icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'), { query: section ? { section } : {} });
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  settingsWin.webContents.on('will-navigate', (e) => e.preventDefault());
  settingsWin.on('closed', () => { settingsWin = null; if (IS_MAC) app.dock?.hide(); });
  if (IS_MAC) Promise.resolve(app.dock?.show()).catch(() => {});
}
function settingsChrome() {
  if (!settingsWin || IS_MAC || process.platform !== 'win32') return;
  const dark = settings().theme === 'dark' || (settings().theme === 'system' && nativeTheme.shouldUseDarkColors);
  try { settingsWin.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#e8e8ee' : '#222228', height: 44 }); } catch (_) {}
}

// ---------------------------------------------------------------- tray / menu bar
function trayIcon() {
  if (IS_MAC) { const i = nativeImage.createFromPath(path.join(ROOT, 'build', 'trayTemplate.png')); i.setTemplateImage(true); return i; }
  return nativeImage.createFromPath(path.join(ROOT, 'build', 'tray.png'));
}
function updateTray() {
  if (!tray) return;
  const lead = timers.lead();
  const items = [
    { label: 'Open Atoll', accelerator: settings().shortcut, click: () => openIsland() },
    { type: 'separator' },
    { label: lead && lead.kind === 'timer' && lead.state !== 'done' ? `${lead.label} · ${fmt(lead.left)}` : 'Start a timer', enabled: !(lead && lead.kind === 'timer' && lead.state !== 'done'), click: () => openIsland('timers') },
    ...[5, 10, 25].map((m) => ({ label: `    ${m} minutes`, click: () => timers.add(m * 60e3) })),
    { label: timers.focus ? 'Stop focus' : 'Start focus session', click: () => (timers.focus ? timers.focusStop() : timers.focusStart()) },
    { type: 'separator' },
    { label: island?.hidden ? 'Show the island' : 'Hide the island', click: () => { if (island.hidden) island.show(); else island.hide(); updateTray(); } },
    { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => openSettings() },
    { type: 'separator' },
    { label: 'Quit Atoll', accelerator: 'CommandOrControl+Q', click: () => app.quit() }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
  const live = match.cur && match.cur.state === 'live' ? `${match.cur.home.short} ${match.cur.home.score}–${match.cur.away.score} ${match.cur.away.short}` : '';
  tray.setToolTip(live ? `Atoll · ${live}` : 'Atoll');
}
function createTray() {
  tray = new Tray(trayIcon());
  if (!IS_MAC) tray.on('click', () => openIsland());
  updateTray();
}

// ---------------------------------------------------------------- shortcut, login
function applyShortcut(prev) {
  try { if (prev) globalShortcut.unregister(prev); } catch (_) {}
  const s = settings().shortcut;
  if (!s) return true;
  try { return globalShortcut.register(s, () => { if (island.expanded) island.send('atoll:close', true); else openIsland(); }); } catch (_) { return false; }
}
function applyLogin() {
  if (DEMO || !app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: !!settings().openAtLogin, openAsHidden: true }); } catch (_) {}
}

// ---------------------------------------------------------------- calls from the windows
const API = {
  state: () => snapshot(),
  size: (s) => island.setSize(s),
  expanded: (on) => { island.expanded = !!on; media.setFast(on); glance.live(on); if (on) shelf.prune(); },
  openSettings: (section) => openSettings(section),
  openIsland: (v) => openIsland(v),
  quit: () => app.quit(),
  hideIsland: () => { island.hide(); updateTray(); },

  settings: () => settings(),
  setSettings: (p) => {
    const prev = settings();
    const next = store.setSettings(p || {});
    if ('shortcut' in p) { const ok = applyShortcut(prev.shortcut); if (!ok) { store.setSettings({ shortcut: prev.shortcut }); applyShortcut(); patch({ settings: settings() }); throw new Error('That shortcut is taken by another app.'); } }
    if ('openAtLogin' in p) applyLogin();
    if ('weather' in p || 'units' in p) glance.loadWeather();
    if ('display' in p) { island.watchCursor(); }
    if ('style' in p || 'display' in p || 'notchWidth' in p) island.relayout();
    if ('theme' in p) { nativeTheme.themeSource = next.theme; settingsChrome(); }
    if ('macPlayers' in p) media.poll();
    patch({ settings: settings(), geo: island.geo });
    return settings();
  },

  // timers
  timerAdd: (ms, label) => timers.add(ms, label),
  timerAddText: (text, label) => { const ms = parseDuration(text); if (!ms) throw new Error('Try 5, 1:30, 90s or 1h 15m'); return timers.add(ms, label); },
  timerToggle: (id) => timers.toggle(id), timerExtend: (id, ms) => timers.extend(id, ms), timerRestart: (id) => timers.restart(id), timerRemove: (id) => timers.remove(id), timerDismiss: () => timers.dismissDone(),
  watchToggle: () => timers.watchToggle(), watchLap: () => timers.watchLap(), watchReset: () => timers.watchReset(),
  focusStart: () => timers.focusStart(), focusPause: () => timers.focusPause(), focusSkip: () => timers.focusSkip(), focusStop: () => timers.focusStop(),

  // media
  media: (cmd, value) => media.command(cmd, value),

  // live match
  matchList: (date) => match.list(date), matchSearch: (q) => match.search(q), matchFollowTeam: (t) => match.followTeam(t), matchFollowMatch: (row) => match.followMatch(row),
  matchClear: () => match.clear(), matchRefresh: () => match.refresh(),

  // shelf
  shelfAdd: (paths) => shelf.add(paths), shelfRemove: (id) => shelf.remove(id), shelfClear: () => shelf.clear(),
  shelfOpen: (id) => { const i = shelf.get(id); if (i) shell.openPath(i.path); }, shelfReveal: (id) => { const i = shelf.get(id); if (i) shell.showItemInFolder(i.path); },
  shelfThumb: async (id) => {
    const i = shelf.get(id); if (!i || i.kind !== 'image') return null;
    try { const t = await nativeImage.createThumbnailFromPath(i.path, { width: 96, height: 96 }); return t.isEmpty() ? null : t.toDataURL(); }
    catch (_) { const n = nativeImage.createFromPath(i.path); return n.isEmpty() ? null : n.resize({ width: 96 }).toDataURL(); }
  },
  clipCopy: (id) => shelf.copy(id), clipForget: (id) => shelf.forgetClip(id), clipClear: () => shelf.clearClips(),

  // glance
  places: (q) => glance.searchPlaces(q), weatherRefresh: () => glance.loadWeather(),
  openExternal: (u) => { if (/^https:\/\//.test(String(u))) shell.openExternal(u); },
  openData: () => shell.openPath(app.getPath('userData')),
  info: () => ({ version: app.getVersion(), electron: process.versions.electron, data: app.getPath('userData'), platform: process.platform })
};

ipcMain.handle('atoll', async (_e, name, args) => {
  const fn = API[name];
  if (!fn) throw new Error(`Unknown call ${name}`);
  return fn(...(args || []));
});
ipcMain.on('atoll:drag', (e, id) => {
  const i = shelf.get(id); if (!i) return;
  let icon = nativeImage.createFromPath(path.join(ROOT, 'build', IS_MAC ? 'trayTemplate@2x.png' : 'tray.png'));
  if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(ROOT, 'build', 'icon.png')).resize({ width: 48 });
  try { e.sender.startDrag({ file: i.path, icon }); } catch (_) {}
});

// ---------------------------------------------------------------- lifecycle
app.on('second-instance', () => openSettings());
app.on('window-all-closed', () => { /* the island is the app; closing settings keeps Atoll running */ });
app.on('before-quit', () => { quitting = true; try { store.setState({ timers: timers.serialize() }); } catch (_) {} });
app.on('will-quit', () => { globalShortcut.unregisterAll(); stopShells(); media?.stop(); match?.stop(); shelf?.stop(); glance?.stop(); timers?.dispose(); });

app.whenReady().then(() => {
  if (IS_MAC) app.dock?.hide();
  store = new Store(app.getPath('userData'));
  nativeTheme.themeSource = settings().theme;
  crests.handle(app.getPath('userData'));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(IS_MAC ? [{ label: 'Atoll', submenu: [{ label: 'Settings…', accelerator: 'Command+,', click: () => openSettings() }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] }] : []),
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Window', submenu: [{ role: 'close' }, ...(process.env.ATOLL_DEV ? [{ role: 'toggleDevTools' }, { role: 'reload' }] : [])] }
  ]));
  setupModules();
  createIsland();
  createTray();
  applyShortcut();
  applyLogin();
  nativeTheme.on('updated', () => { patch({ theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' }); settingsChrome(); });
  powerMonitor.on('resume', () => { match.refresh(); glance.loadWeather(); });
  if (!store.state().welcomed) { store.setState({ welcomed: true }); if (!process.env.ATOLL_E2E) setTimeout(() => openIsland('home'), 1200); }
  if (process.env.ATOLL_E2E) require(path.join(ROOT, 'test', 'e2e', 'drive.js'))({ app, island: () => island, openSettings: () => openSettings(), settingsWin: () => settingsWin, API, timers, media, match, burst });
});

module.exports = { API };
