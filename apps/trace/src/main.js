// Trace — main process. Owns files, screenshots and PDF export; the window only sees what preload exposes.
const { app, BrowserWindow, ipcMain, nativeTheme, nativeImage, dialog, shell, protocol, clipboard, Menu, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');
const { Store, uid, imageSize } = require('./store');
const folders = require('./folders');
const makeCapture = require('./capture');

protocol.registerSchemesAsPrivileged([
  { scheme: 'trace-media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);
if (process.env.TRACE_USER_DATA) app.setPath('userData', process.env.TRACE_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

const isMac = process.platform === 'darwin';
let win = null, store = null, capture = null, activeProject = null, quitting = false, wantQuit = false;
function finishClose() { if (!win || win.isDestroyed()) return; quitting = true; if (wantQuit) app.quit(); else win.close(); }

// ---- settings (small JSON in app data) ----
const DEFAULTS = {
  theme: 'system', shortcut: 'CommandOrControl+Shift+2', repeatShortcut: 'CommandOrControl+Alt+Shift+2',
  captureTarget: null, lastRegion: null, orientation: 'vertical', seeded: false, sidebar: true, inspector: true, lastProject: null
};
let settingsCache = null;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function settings() {
  if (!settingsCache) { try { settingsCache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch (_) { settingsCache = { ...DEFAULTS }; } }
  return settingsCache;
}
function saveSettings(patch) {
  settingsCache = { ...settings(), ...patch };
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settingsCache, null, 1)); } catch (_) {}
  return settingsCache;
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const safeName = (s) => String(s || 'Trace').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Trace';

// Any image file → something the store accepts (PNG/JPEG/GIF/WebP), converting HEIC/TIFF/BMP through nativeImage.
function toStorable(buf, filePath) {
  if (imageSize(buf)) return buf;
  const img = filePath ? nativeImage.createFromPath(filePath) : nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) throw new Error('That file could not be read as an image.');
  return img.toPNG();
}
function notifyMedia(pid, media) { if (win && !win.isDestroyed()) win.webContents.send('trace:media-added', { pid, media }); }

// ---- PDF export: the window hands over a finished HTML page; a hidden window prints it ----
async function exportPdf(html, opts = {}) {
  const r = process.env.TRACE_TEST_SAVE_DIR ? { filePath: path.join(process.env.TRACE_TEST_SAVE_DIR, safeName(opts.name) + '.pdf') } : await dialog.showSaveDialog(win, {
    title: 'Export PDF', defaultPath: path.join(app.getPath('documents'), safeName(opts.name) + '.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (r.canceled || !r.filePath) return null;
  const tmp = path.join(app.getPath('temp'), 'trace-export-' + uid(8) + '.html');
  fs.writeFileSync(tmp, String(html));
  const w = new BrowserWindow({ show: false, width: 1280, height: 960, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await w.loadFile(tmp);
    await w.webContents.executeJavaScript(`Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })))
      .then(() => document.fonts && document.fonts.ready).then(() => new Promise(r => setTimeout(r, 450))).then(() => true)`);
    const pdf = await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(r.filePath, pdf);
    return r.filePath;
  } finally {
    w.destroy();
    fs.unlink(tmp, () => {});
  }
}

// ---- IPC ----
const h = (name, fn) => ipcMain.handle('trace:' + name, async (_e, ...a) => {
  try { return { ok: true, data: await fn(...a) }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

function registerIpc() {
  h('bootstrap', () => ({
    settings: settings(), platform: process.platform, version: app.getVersion(),
    projects: store.list(), library: store.root, permission: capture.permission(), shortcutsFailed: capture.registerShortcuts()
  }));
  h('settings:set', (patch) => {
    const allowed = ['theme', 'shortcut', 'repeatShortcut', 'captureTarget', 'orientation', 'seeded', 'sidebar', 'inspector', 'lastProject', 'wheelZoom'];
    const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
    const s = saveSettings(clean);
    if ('theme' in clean) nativeTheme.themeSource = ['light', 'dark'].includes(s.theme) ? s.theme : 'system';
    let failed = [];
    if ('shortcut' in clean || 'repeatShortcut' in clean) failed = capture.registerShortcuts();
    if ('captureTarget' in clean) capture.sendBar();
    return { settings: s, shortcutsFailed: failed };
  });

  h('projects', () => store.list());
  h('project:create', (opts) => { const p = store.create(opts || {}); capture.sendBar(); return p; });
  h('project:load', (id) => { const r = store.load(id); activeProject = id; saveSettings({ lastProject: id }); return r; });
  h('project:save', (project) => store.save(project));
  h('project:delete', async (id) => {
    const dir = store.projectDir(id);
    await shell.trashItem(dir);
    if (activeProject === id) activeProject = null;
    if (settings().captureTarget === id) saveSettings({ captureTarget: null });
    capture.sendBar();
  });
  h('project:active', (id) => { activeProject = id || null; capture.sendBar(); });

  h('media:list', (pid) => store.listMedia(pid));
  h('media:update', (pid, mid, patch) => store.updateMedia(pid, mid, patch));
  h('media:delete', async (pid, ids) => { for (const id of ids || []) for (const f of store.mediaFiles(pid, id)) await shell.trashItem(f).catch(() => fs.rmSync(f, { force: true })); });
  h('media:import', async (pid) => {
    const r = await dialog.showOpenDialog(win, { title: 'Add images', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'tif', 'tiff', 'bmp'] }] });
    if (r.canceled) return [];
    return r.filePaths.map((f) => store.addMedia(pid, toStorable(fs.readFileSync(f), f), { source: 'import', name: path.basename(f).replace(/\.[^.]+$/, '') }));
  });
  h('media:fromBuffer', (pid, bytes, name) => store.addMedia(pid, toStorable(Buffer.from(bytes)), { source: 'paste', name: String(name || '').replace(/\.[^.]+$/, '') }));
  h('media:fromPaths', (pid, paths) => (paths || []).filter((f) => fs.existsSync(f)).map((f) => store.addMedia(pid, toStorable(fs.readFileSync(f), f), { source: 'import', name: path.basename(f).replace(/\.[^.]+$/, '') })));
  h('media:dataUrl', (pid, mid) => {
    const m = store.getMedia(pid, mid);
    const ext = m.file.split('.').pop();
    return `data:${MIME[ext] || 'image/png'};base64,` + fs.readFileSync(store.mediaFile(pid, m.file)).toString('base64');
  });
  h('media:reveal', (pid, mid) => { const m = store.getMedia(pid, mid); shell.showItemInFolder(store.mediaFile(pid, m.file)); });
  h('media:seed', (pid) => {
    const dir = path.join(__dirname, 'seed');
    return fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => store.addMedia(pid, fs.readFileSync(path.join(dir, f)), { source: 'import', name: f.replace(/^\d+-/, '').replace(/\.png$/, '').replace(/-/g, ' ') }));
  });

  h('file:save', async (bytes, name, ext) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('pictures'), safeName(name) + '.' + ext), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, Buffer.from(bytes));
    return r.filePath;
  });
  h('clipboard:image', (bytes) => { clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(bytes))); });
  h('export:pdf', (html, opts) => exportPdf(html, opts));

  h('folder:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a folder to map', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  h('folder:scan', (dir, opts) => folders.scan(dir, opts));

  // From inside Trace: step out of the way first so the screenshot shows the app behind it.
  h('capture', async (mode) => {
    const hide = win && !win.isDestroyed() && win.isVisible() && !win.isFullScreen();
    if (hide) { win.hide(); await new Promise((r) => setTimeout(r, 280)); }
    try { return await capture.capture(mode); }
    finally { if (hide && win && !win.isDestroyed()) win.show(); }
  });
  h('capture:bar', (open) => { if (open) capture.openBar(); else capture.closeBar(); return capture.isBarOpen(); });
  h('capture:permission', () => capture.permission());
  h('capture:openSettings', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'));

  h('window:fullscreen', (on) => { if (win) win.setFullScreen(!!on); return win ? win.isFullScreen() : false; });
  h('window:chrome', (bg, fg) => { if (!isMac && win && win.setTitleBarOverlay) { try { win.setTitleBarOverlay({ color: bg, symbolColor: fg, height: 44 }); } catch (_) {} } });
  h('open', (url) => { if (/^https?:\/\//.test(String(url))) return shell.openExternal(url); });
  h('reveal', (p) => shell.showItemInFolder(String(p)));
  h('openPath', (p) => shell.openPath(String(p)));
  h('library:open', () => shell.openPath(store.root));
  ipcMain.on('trace:flushed', () => finishClose());
}

// ---- protocol: trace-media://m/<projectId>/<file> serves stored images to the window and to PDF export ----
function registerProtocol() {
  protocol.handle('trace-media', async (req) => {
    try {
      const u = new URL(req.url);
      const [, pid, file] = u.pathname.split('/');
      const name = decodeURIComponent(file || '');
      const data = await fs.promises.readFile(store.mediaFile(pid, name));
      return new Response(data, { headers: { 'content-type': MIME[name.split('.').pop()] || 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'max-age=31536000, immutable' } });
    } catch (_) { return new Response('Not found', { status: 404 }); }
  });
}

// ---- menu: commands go to the window ----
function buildMenu() {
  const send = (cmd) => () => { if (win && !win.isDestroyed()) { win.show(); win.webContents.send('trace:menu', cmd); } };
  const tpl = [
    ...(isMac ? [{ label: 'Trace', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: send('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [
      { label: 'New Project', accelerator: 'CmdOrCtrl+Shift+N', click: send('new-project') },
      { label: 'New Chart', accelerator: 'CmdOrCtrl+N', click: send('new-chart') },
      { label: 'New Note', accelerator: 'CmdOrCtrl+Alt+N', click: send('new-note') },
      { label: 'New Guide', click: send('new-guide') },
      { type: 'separator' },
      { label: 'Capture Region', click: send('capture-region') },
      { label: 'Capture Bar', accelerator: 'CmdOrCtrl+Shift+B', click: send('capture-bar') },
      { label: 'Import Images…', click: send('import-images') },
      { type: 'separator' },
      { label: 'Present', accelerator: 'CmdOrCtrl+Enter', click: send('present') },
      { label: 'Export PDF…', accelerator: 'CmdOrCtrl+E', click: send('export') },
      ...(isMac ? [] : [{ type: 'separator' }, { label: 'Settings', accelerator: 'Ctrl+,', click: send('settings') }, { role: 'quit' }])
    ] },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
      { label: 'Redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: send('redo') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' }, { label: 'Find…', accelerator: 'CmdOrCtrl+K', click: send('palette') }
    ] },
    { label: 'View', submenu: [
      { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\', click: send('toggle-sidebar') },
      { label: 'Toggle Inspector', accelerator: 'CmdOrCtrl+Alt+I', click: send('toggle-inspector') },
      { type: 'separator' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }])
    ] },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 600, show: false,
    backgroundColor: dark ? '#0c0d12' : '#f5f5f8',
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 15 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: dark ? '#0c0d12' : '#f5f5f8', symbolColor: dark ? '#a9adbb' : '#4a4d58', height: 44 } }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true }
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  win.on('enter-full-screen', () => win.webContents.send('trace:fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('trace:fullscreen', false));
  // Give the window a moment to save before closing.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.webContents.send('trace:flush');
    setTimeout(finishClose, 1500);
  });
  win.on('closed', () => { win = null; quitting = false; });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  nativeTheme.themeSource = ['light', 'dark'].includes(settings().theme) ? settings().theme : 'system';
  store = new Store(path.join(app.getPath('userData'), 'Library'));
  capture = makeCapture({ store, getWin: () => win, settings, saveSettings, activeProject: () => activeProject, onAdded: notifyMedia });
  registerProtocol();
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length && !win) createWindow(); else if (win) win.show(); });
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('before-quit', () => { wantQuit = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
