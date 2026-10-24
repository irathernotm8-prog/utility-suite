'use strict';
// Waypoint — main process: the window, settings, the trip store, documents, the offline pack, PDF,
// .waypoint files, phone hand-off over Wi-Fi and "Send with Beam". The window talks to all of it
// through window.waypoint.call(...) → the `api` table below.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { Store } = require('./core/store');
const bundle = require('./core/bundle');
const pack = require('./core/pack');
const { Share } = require('./core/share');
const TL = require('./core/timeline');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const DEMO = process.env.WAYPOINT_DEMO === '1';
if (process.env.WAYPOINT_USER_DATA) app.setPath('userData', process.env.WAYPOINT_USER_DATA);
const USER = app.getPath('userData');
const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'build', 'icon.png');

if (!process.env.WAYPOINT_MULTI && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('com.bilal.waypoint');

let win = null, store = null, share = null, settings = null;
let pendingOpen = [];   // .waypoint files opened before the window was ready

// ───────── settings
const SETTINGS = path.join(USER, 'settings.json');
function defaults() {
  return {
    dataDir: process.env.WAYPOINT_DATA || path.join(app.getPath('documents'), 'Waypoint'),
    theme: 'system', currency: 'USD', clock: 'auto', weekStart: 'auto', onboarded: false,
    lastTrip: '', timelineZoom: 64, embedDocs: true, sharePort: 0, shareToken: '', me: '',
  };
}
function loadSettings() { let s = {}; try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch {} return { ...defaults(), ...s }; }
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.mkdirSync(USER, { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2)); } catch {} }, 120);
}

// ───────── window
function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }
function shouldDark() { return settings.theme === 'dark' || (settings.theme !== 'light' && nativeTheme.shouldUseDarkColors); }
function applyTheme() {
  nativeTheme.themeSource = settings.theme === 'dark' ? 'dark' : settings.theme === 'light' ? 'light' : 'system';
  if (!IS_MAC && win && !win.isDestroyed()) try { win.setTitleBarOverlay({ color: '#00000000', symbolColor: shouldDark() ? '#efeae3' : '#2a241e' }); } catch {}
}
function createWindow() {
  const dark = shouldDark();
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 940, minHeight: 600, show: false, title: 'Waypoint',
    backgroundColor: dark ? '#0d0c12' : '#f7f4f0',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
    titleBarOverlay: IS_MAC ? undefined : { color: '#00000000', symbolColor: dark ? '#efeae3' : '#2a241e', height: 44 },
    trafficLightPosition: { x: 16, y: 16 },
    icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}
function showWindow() { if (!win) return createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

// ───────── .waypoint files from outside (double-click, Open With, drag onto the Dock icon)
function openFiles(paths) {
  const list = (paths || []).filter(p => /\.waypoint$/i.test(p) && fs.existsSync(p));
  if (!list.length) return;
  if (!win || win.webContents.isLoading()) { pendingOpen.push(...list); return; }
  showWindow();
  for (const p of list) send('open-bundle', p);
}
app.on('open-file', (e, p) => { e.preventDefault(); openFiles([p]); });
app.on('second-instance', (_e, argv) => { const f = argv.filter(a => /\.waypoint$/i.test(a)); if (f.length) openFiles(f); else showWindow(); });

// ───────── helpers
const tmpDir = () => path.join(os.tmpdir(), 'waypoint');
const outbox = () => path.join(settings.dataDir, '.outbox');
const fileSafe = (s) => String(s || 'Trip').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim().slice(0, 80) || 'Trip';
function cleanOutbox() {
  try { for (const f of fs.readdirSync(outbox())) { const p = path.join(outbox(), f); if (Date.now() - fs.statSync(p).mtimeMs > 3 * 864e5) fs.rmSync(p, { force: true }); } } catch {}
}
async function trash(p) { try { await shell.trashItem(p); } catch { await fs.promises.rm(p, { recursive: true, force: true }); } }

// Beam (the suite's AirDrop) — where Utility Hub puts it
function beamPath() {
  if (IS_MAC) return ['/Applications/Beam.app', path.join(os.homedir(), 'Applications', 'Beam.app')].find(p => fs.existsSync(p)) || null;
  if (IS_WIN) {
    const la = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return [path.join(la, 'Programs', 'Utility Suite', 'Beam', 'Beam.exe'), path.join(la, 'Programs', 'Beam', 'Beam.exe')].find(p => fs.existsSync(p)) || null;
  }
  return null;
}
function handToBeam(file) {
  const b = beamPath();
  if (!b) throw new Error('Beam isn’t installed on this computer. Install it from Utility Hub, or use Save .waypoint file.');
  if (IS_MAC) return new Promise((res, rej) => execFile('open', ['-a', b, file], (e) => e ? rej(new Error('Couldn’t open Beam: ' + e.message)) : res(true)));
  spawn(b, ['--send', file], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

// a hidden window renders a page to PDF
async function htmlToPdf(html, out) {
  fs.mkdirSync(tmpDir(), { recursive: true });
  const tmp = path.join(tmpDir(), `print-${Date.now()}.html`);
  fs.writeFileSync(tmp, html);
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: false, sandbox: true } });
  try {
    await w.loadFile(tmp);
    const buf = await w.webContents.printToPDF({ printBackground: true, pageSize: 'Letter', margins: { marginType: 'custom', top: 0.5, bottom: 0.5, left: 0.55, right: 0.55 } });
    fs.writeFileSync(out, buf);
  } finally { w.destroy(); fs.rm(tmp, { force: true }, () => {}); }
  return out;
}

function progress(kind, id) { let last = 0; return (done, total) => { const now = Date.now(); if (now - last > 120 || done === total) { last = now; send('progress', { kind, id, done, total }); } }; }

// ───────── IPC
const api = {
  state: () => ({
    settings, trips: store.list(), dataDir: store.dir, version: app.getVersion(), platform: process.platform, demo: DEMO,
    home: Intl.DateTimeFormat().resolvedOptions().timeZone, beam: !!beamPath(), user: os.userInfo().username,
  }),
  set: (patch) => {
    const ok = ['theme', 'currency', 'clock', 'weekStart', 'onboarded', 'lastTrip', 'timelineZoom', 'embedDocs', 'me'];
    for (const k of ok) if (k in patch) settings[k] = patch[k];
    saveSettings(); if ('theme' in patch) applyTheme();
    return settings;
  },
  trips: () => store.scan(),
  trip: (id) => store.get(id),
  create: (fields) => { const t = store.create(fields || {}); return t; },
  save: (trip) => store.save(trip),
  duplicate: async (id) => {
    const src = store.get(id);
    const f = path.join(tmpDir(), `dup-${Date.now()}.waypoint`); fs.mkdirSync(tmpDir(), { recursive: true });
    await bundle.exportTrip(store, id, f);
    const t = await bundle.importTrip(store, f, 'copy');
    fs.rm(f, { force: true }, () => {});
    t.name = `${src.name} (copy)`; store.save(t);
    return t;
  },
  remove: async (id) => { const folder = store.folder(id); share.close(id); store.forget(id); await trash(folder); return store.list(); },
  sample: async () => { const { seed } = require('./demo'); const ids = await seed(store, { which: 'lisbon' }); return ids[0]; },

  // documents
  pickDocs: async (id, meta) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], title: 'Add documents to this trip', filters: [{ name: 'Documents and images', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'heic', 'webp', 'gif', 'pkpass', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'svg'] }, { name: 'All files', extensions: ['*'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    return (await store.addDocs(id, r.filePaths, meta || {}));
  },
  addDocs: (id, paths, meta) => store.addDocs(id, paths, meta || {}),
  removeDoc: async (id, docId) => { const r = await store.removeDoc(id, docId); if (r.file) await trash(r.file); return r.trip; },
  docFile: (id, docId) => { const t = store.get(id); const d = t.docs.find(x => x.id === docId); if (!d) throw new Error('That document is gone.'); const p = store.docPath(id, d); return { path: p, url: require('url').pathToFileURL(p).href, exists: fs.existsSync(p) }; },
  openDoc: async (id, docId) => { const { path: p } = api.docFile(id, docId); const e = await shell.openPath(p); if (e) throw new Error(e); },
  showDoc: (id, docId) => { const { path: p } = api.docFile(id, docId); shell.showItemInFolder(p); },
  previewDoc: (id, docId) => {
    const t = store.get(id); const d = t.docs.find(x => x.id === docId); const p = store.docPath(id, d);
    const w = new BrowserWindow({ width: 900, height: 1000, title: d.name, parent: win, backgroundColor: shouldDark() ? '#1a1820' : '#ffffff', icon: ICON, webPreferences: { sandbox: true, plugins: true } });
    w.setMenuBarVisibility(false);
    w.loadFile(p);
    return true;
  },
  copyDocsOut: async (id, docIds) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Copy documents to…' });
    if (r.canceled || !r.filePaths[0]) return 0;
    const t = store.get(id); let n = 0;
    for (const d of t.docs.filter(x => !docIds || docIds.includes(x.id))) {
      const p = store.docPath(id, d); if (!fs.existsSync(p)) continue;
      const { uniquePath } = require('./core/store');
      await fs.promises.copyFile(p, uniquePath(r.filePaths[0], path.basename(p))); n++;
    }
    shell.openPath(r.filePaths[0]);
    return n;
  },

  // take it with you
  savePack: async (id) => {
    const t = store.get(id);
    const r = await dialog.showSaveDialog(win, { title: 'Save offline pack', defaultPath: path.join(app.getPath('downloads'), `${fileSafe(t.name)}.html`), filters: [{ name: 'Web page', extensions: ['html'] }] });
    if (r.canceled || !r.filePath) return null;
    const html = pack.build(t, { embed: settings.embedDocs !== false, docPath: (d) => store.docPath(id, d) });
    fs.writeFileSync(r.filePath, html);
    shell.showItemInFolder(r.filePath);
    return { path: r.filePath, size: Buffer.byteLength(html) };
  },
  previewPack: (id) => {
    const t = store.get(id);
    fs.mkdirSync(tmpDir(), { recursive: true });
    const f = path.join(tmpDir(), `${id}-preview.html`);
    fs.writeFileSync(f, pack.build(t, { embed: true, docPath: (d) => store.docPath(id, d) }));
    const w = new BrowserWindow({ width: 420, height: 860, title: `${t.name} — offline pack`, parent: win, icon: ICON, webPreferences: { sandbox: true } });
    w.setMenuBarVisibility(false);
    w.loadFile(f);
    return true;
  },
  savePdf: async (id) => {
    const t = store.get(id);
    const r = await dialog.showSaveDialog(win, { title: 'Save itinerary as PDF', defaultPath: path.join(app.getPath('downloads'), `${fileSafe(t.name)} itinerary.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return null;
    await htmlToPdf(pack.printable(t), r.filePath);
    shell.openPath(r.filePath);
    return { path: r.filePath };
  },
  saveBundle: async (id) => {
    const t = store.get(id);
    const r = await dialog.showSaveDialog(win, { title: 'Save trip file', defaultPath: path.join(app.getPath('downloads'), `${fileSafe(t.name)}.waypoint`), filters: [{ name: 'Waypoint trip', extensions: ['waypoint'] }] });
    if (r.canceled || !r.filePath) return null;
    const out = await bundle.exportTrip(store, id, r.filePath, { onProgress: progress('export', id) });
    shell.showItemInFolder(r.filePath);
    return out;
  },
  beam: async (id) => {
    const t = store.get(id);
    fs.mkdirSync(outbox(), { recursive: true });
    const f = path.join(outbox(), `${fileSafe(t.name)}.waypoint`);
    const out = await bundle.exportTrip(store, id, f, { onProgress: progress('export', id) });
    await handToBeam(f);
    return out;
  },
  pickBundle: async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'Open a trip file', filters: [{ name: 'Waypoint trip', extensions: ['waypoint'] }] });
    return r.canceled ? null : r.filePaths[0];
  },
  peekBundle: (file) => bundle.peek(store, file),
  importBundle: (file, mode) => bundle.importTrip(store, file, mode, { onProgress: progress('import', file) }),

  // phone over Wi-Fi
  shareOpen: (id, address) => share.open(id, address),
  shareInfo: (id, address) => share.info(id, address),
  shareClose: (id) => share.close(id),
  shareNewLink: (id) => { share.newLink(); return share.info(id); },

  // folders and odds and ends
  openDataDir: () => { fs.mkdirSync(store.dir, { recursive: true }); shell.openPath(store.dir); },
  openTripFolder: (id) => shell.openPath(store.folder(id)),
  pickDataDir: async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Choose where Waypoint keeps trips' });
    if (r.canceled || !r.filePaths[0]) return null;
    settings.dataDir = r.filePaths[0]; saveSettings();
    await share.stop();
    store.setDir(settings.dataDir);
    return { dataDir: store.dir, trips: store.scan() };
  },
  openUrl: (u) => { if (/^https?:\/\//i.test(String(u))) shell.openExternal(String(u)); },
  copy: (text) => { clipboard.writeText(String(text ?? '')); return true; },
  beamInstalled: () => !!beamPath(),
};
ipcMain.handle('call', async (_e, method, ...args) => {
  try {
    const fn = api[method];
    if (!fn) throw new Error('Unknown: ' + method);
    return { ok: true, data: await fn(...args) };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
});
ipcMain.on('pending', (e) => { e.returnValue = pendingOpen.splice(0); });

// ───────── menu
function buildMenu() {
  const cmd = (c) => () => { showWindow(); send('menu', c); };
  const file = { label: 'File', submenu: [
    { label: 'New Trip…', accelerator: 'CmdOrCtrl+N', click: cmd('new-trip') },
    { label: 'Open Trip File…', accelerator: 'CmdOrCtrl+O', click: cmd('open-bundle') },
    { type: 'separator' },
    { label: 'Add Plan…', accelerator: 'CmdOrCtrl+Shift+P', click: cmd('add-plan') },
    { label: 'Add Booking…', accelerator: 'CmdOrCtrl+Shift+B', click: cmd('add-booking') },
    { label: 'Add Documents…', accelerator: 'CmdOrCtrl+Shift+D', click: cmd('add-docs') },
    { label: 'Add Expense…', accelerator: 'CmdOrCtrl+Shift+E', click: cmd('add-expense') },
    { type: 'separator' },
    { label: 'Take It With You…', accelerator: 'CmdOrCtrl+Shift+S', click: cmd('take') },
    { type: 'separator' },
    IS_MAC ? { role: 'close' } : { role: 'quit' },
  ] };
  if (IS_MAC) Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, file, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
  else Menu.setApplicationMenu(Menu.buildFromTemplate([file, { role: 'editMenu' }, { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] }]));
  if (!IS_MAC && win) win.setMenuBarVisibility(false);
}

// ───────── app
app.whenReady().then(async () => {
  settings = loadSettings();
  if (!fs.existsSync(SETTINGS)) saveSettings();
  applyTheme();
  store = new Store(settings.dataDir);
  store.scan();
  if (DEMO && !store.list().length) { const { seed } = require('./demo'); await seed(store); store.scan(); }
  share = new Share({ store, settings: () => settings, saveSettings, tmpDir: path.join(tmpDir(), 'share'), onVisit: (v) => send('visit', v) });
  cleanOutbox();
  pendingOpen.push(...process.argv.filter(a => /\.waypoint$/i.test(a) && fs.existsSync(a)));
  buildMenu();
  createWindow();
  nativeTheme.on('updated', () => { applyTheme(); send('theme', shouldDark()); });
});
app.on('activate', () => showWindow());
app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });
app.on('will-quit', () => { if (share) share.stop(); });

module.exports = { TL };
