// Mixer — main process: the window, settings, songs, the hidden audio engine, the Claude/Codex plugin bridge and
// everything the window asks for.
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, clipboard } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SG = require('./core/song');
const SND = require('./core/sounds');
const TH = require('./core/theory');
const { Library, readJSON, writeJSON, AUDIO_EXT } = require('./project');
const engine = require('./enginehost');
const connectors = require('./connectors');
const ai = require('./ai');
const { makeHandlers } = require('./mcp-handlers');

const IS_MAC = process.platform === 'darwin';
if (process.env.MIXER_USER_DATA) app.setPath('userData', process.env.MIXER_USER_DATA);
app.setName('Mixer');
if (process.platform === 'win32') app.setAppUserModelId('com.bilal.mixer');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
let startHidden = process.argv.includes('--hidden');
if (!process.env.MIXER_E2E && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ───────────────────────── settings
const USER = app.getPath('userData');
const SETTINGS = path.join(USER, 'settings.json');
const DEFAULTS = { theme: 'system', songsDir: '', activeSong: null, askProvider: 'auto', exportFormat: 'wav', exportBits: 24, exportKbps: 320, exportRate: 44100, normalize: -14, metronome: false, snap: 0.25, zoom: 1, onboarded: false };
let settings = { ...DEFAULTS, ...readJSON(SETTINGS, {}) };
const saveSettings = () => writeJSON(SETTINGS, settings);
const songsRoot = () => settings.songsDir || process.env.MIXER_SONGS || path.join(app.getPath('documents'), 'Mixer');
const lib = new Library(songsRoot());

let win = null;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
function active() {
  if (settings.activeSong) { try { return lib.get(settings.activeSong); } catch {} }
  const list = lib.list(); if (list.length) { settings.activeSong = list[0].id; saveSettings(); return lib.get(list[0].id); }
  const p = lib.create({ name: 'My first song', bpm: 100, key: 'A minor', bars: 16 }); settings.activeSong = p.id; saveSettings(); return p;
}
function setActive(id) { const p = lib.get(id); settings.activeSong = p.id; saveSettings(); send('song:switched', snapshot(p)); return p; }
const snapshot = (p = active(), by = null, label = null) => ({ id: p.id, rev: p.rev, song: p.song, dir: p.dir, history: p.history(), by, label });
const changed = (by, label) => send('song:changed', snapshot(active(), by, label));
const activity = (msg) => send('ai:activity', { msg, at: Date.now() });
engine.setProgress((e) => send('engine:progress', e));

// audio bytes for the windows (window playback and the engine window both ask)
// (absolute paths are allowed for audio files only: analyze can measure any file the user points Claude at)
ipcMain.handle('audio:read', async (e, rel) => { try { const f = path.isAbsolute(String(rel)) && AUDIO_EXT.test(rel) && fs.existsSync(rel) ? rel : active().audioPath(rel); return { ok: true, data: fs.readFileSync(f) }; } catch (err) { return { ok: false, error: err.message }; } });

const handle = makeHandlers({ lib, active, setActive, engine, changed, activity, transport: (cmd) => { if (cmd.action === 'play') showWindow(); send('transport', cmd); }, settings: () => settings });

// ───────────────────────── window
function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1120, minHeight: 700, show: false, title: 'Mixer',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0e13' : '#f3f6f9',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
    titleBarOverlay: IS_MAC ? undefined : { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#e8f1f8' : '#16202a', height: 44 },
    trafficLightPosition: { x: 16, y: 16 },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  nativeTheme.on('updated', () => { if (!IS_MAC && win && !win.isDestroyed()) try { win.setTitleBarOverlay({ symbolColor: nativeTheme.shouldUseDarkColors ? '#e8f1f8' : '#16202a' }); } catch {} });
}
function showWindow() { if (IS_MAC && app.dock) app.dock.show(); startHidden = false; if (!win || win.isDestroyed()) { createWindow(); return; } if (!win.webContents.isLoading()) { win.show(); win.focus(); } else win.once('ready-to-show', () => win.show()); }
function applyTheme() { nativeTheme.themeSource = ['light', 'dark'].includes(settings.theme) ? settings.theme : 'system'; }
function appMenu() {
  const go = (v) => () => { showWindow(); send('nav', v); };
  const t = [
    ...(IS_MAC ? [{ role: 'appMenu', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: go('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [{ label: 'New song…', accelerator: 'CmdOrCtrl+N', click: go('new-song') }, { label: 'Import audio…', accelerator: 'CmdOrCtrl+I', click: go('import') }, { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: go('export') }, { type: 'separator' }, IS_MAC ? { role: 'close' } : { role: 'quit' }] },
    { label: 'Edit', submenu: [{ label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('nav', 'undo') }, { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => send('nav', 'redo') }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ label: 'Arrange', accelerator: 'CmdOrCtrl+1', click: go('arrange') }, { label: 'Mix', accelerator: 'CmdOrCtrl+2', click: go('mix') }, { label: 'Sounds', accelerator: 'CmdOrCtrl+3', click: go('sounds') }, { label: 'Songs', accelerator: 'CmdOrCtrl+4', click: go('songs') }, { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

// ───────────────────────── IPC
function h(ch, fn) { ipcMain.handle(ch, async (e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (err) { return { ok: false, error: err.message || String(err) }; } }); }
const P = () => active();

h('app:info', () => ({ version: app.getVersion(), platform: process.platform, home: os.homedir(), userData: USER, songsRoot: songsRoot(), sounds: { instruments: SND.INSTRUMENTS.map(({ id, name, cat, desc }) => ({ id, name, cat, desc })), kits: SND.KITS.map(({ id, name, desc }) => ({ id, name, desc })), effects: SND.EFFECTS, cats: SND.CATS }, rhythms: Object.fromEntries(Object.entries(TH.RHYTHMS).map(([k, v]) => [k, v.desc])), grooves: Object.fromEntries(Object.entries(TH.GROOVES).map(([k, v]) => [k, v.desc])) }));
h('settings:get', () => settings);
h('settings:set', (patch) => { settings = { ...settings, ...patch }; saveSettings(); if ('theme' in patch) applyTheme(); if ('songsDir' in patch) { lib.setRoot(songsRoot()); settings.activeSong = null; send('song:switched', snapshot(active())); } return settings; });

// songs
h('songs:list', () => ({ list: lib.list(), active: P().id }));
h('songs:create', (o) => { const p = lib.create(o || {}); setActive(p.id); return snapshot(p); });
h('songs:open', (id) => snapshot(setActive(id)));
h('songs:rename', (id, name) => { lib.rename(id || P().id, name); if (!id || id === P().id) changed('you', 'Rename'); return true; });
h('songs:duplicate', (id) => snapshot(setActive(lib.duplicate(id || P().id).id)));
h('songs:reveal', (id) => { shell.openPath(lib.get(id || P().id).dir); return true; });
h('song:get', () => snapshot());
// the window edits its copy with the same song code and commits it; a commit based on an older revision is refused
h('song:commit', (song, base, label) => { const p = P(); if (base != null && base !== p.rev) throw Object.assign(new Error('stale'), { stale: true }); p.replace(song, { label: label || 'Edit', by: 'you' }); const s = snapshot(p, 'you', label); send('song:changed', { ...s, quiet: true }); return { rev: p.rev, history: s.history }; });
h('song:undo', () => { const d = P().doUndo(1); changed('you', d[0] ? 'Undo ' + d[0] : null); return d; });
h('song:redo', () => { const d = P().doRedo(1); changed('you', d[0] ? 'Redo ' + d[0] : null); return d; });

// audio
h('audio:import', async (files, opts = {}) => { const out = []; for (const f of files) { const r = await handle.importAudio(f, { ...opts, picture: false }, 'you'); out.push({ clip: r.clip, info: r.info }); } return out; });
h('audio:peaks', (file, cols) => engine.job('peaks', { file, cols }));
h('analyze', async (args) => { const r = await engine.job('analyze', { song: P().song, ...args }); return r; });
h('export', async (args) => {
  if (args.ask) { const r = await dialog.showOpenDialog(win, { title: 'Export to…', defaultPath: P().outDir('exports'), properties: ['openDirectory', 'createDirectory'] }); if (r.canceled) return null; args = { ...args, folder: r.filePaths[0] }; }
  return handle.exportSong(args);
});

// plugin & Ask
h('connectors:status', () => connectors.connectorStatus());
h('connectors:desktop', () => connectors.connectDesktop());
h('connectors:code', () => connectors.connectCode());
h('connectors:codex', () => connectors.connectCodex());
h('ai:status', () => ({ claude: ai.cli('claude'), codex: ai.cli('codex') }));
let asking = null;
h('ask:start', async (prompt) => {
  if (asking) throw new Error('Claude is already working on something. Stop it first.');
  connectors.installScript(); const entry = connectors.connectorStatus().entry; const ctl = new AbortController(); asking = ctl;
  const full = `${prompt}\n\n(You're inside the Mixer app. Work in the open song "${P().name}". Call mixer_guide first if you haven't. The user is watching and listening; keep your final message short.)`;
  try { return await ai.askAgent({ prompt: full, entry, cwd: path.join(USER, 'ask'), signal: ctl.signal, provider: settings.askProvider, onEvent: (ev) => send('ask:event', ev) }); }
  finally { asking = null; }
});
h('ask:stop', () => { if (asking) asking.abort(); asking = null; return true; });

// files
h('dialog:audio', async () => { const r = await dialog.showOpenDialog(win, { title: 'Import audio', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'webm', 'mp4', 'mov', 'caf'] }] }); return r.canceled ? null : r.filePaths; });
h('dialog:folder', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
h('shell:open', async (p) => { if (/^https?:/.test(p)) return shell.openExternal(p); const e = await shell.openPath(p); if (e) throw new Error(e); return true; });
h('shell:reveal', (p) => { shell.showItemInFolder(p); return true; });
h('clipboard:write', (t) => { clipboard.writeText(String(t)); return true; });
h('isAudio', (p) => AUDIO_EXT.test(p));

// ───────────────────────── lifecycle
app.on('second-instance', (e, argv) => { if (!argv.includes('--hidden')) showWindow(); });
app.on('activate', () => showWindow());
app.on('will-quit', () => { connectors.stopBridge(); engine.stop(); try { active().save(true); } catch {} });
app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });

app.whenReady().then(() => {
  try { if (IS_MAC && app.getLoginItemSettings().wasOpenedAsHidden) startHidden = true; } catch {}
  applyTheme(); appMenu(); active();
  connectors.startBridge(handle, (st) => send('bridge:status', st));
  connectors.refreshInstalled();
  engine.start();
  createWindow();
  if (startHidden && IS_MAC && app.dock) app.dock.hide();
});
module.exports = { handle };
