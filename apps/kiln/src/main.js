// Kiln — main process
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, shell, nativeTheme, Menu, dialog } = require('electron');
const core = require('./core');
const tools = require('./tools');
const gallery = require('./gallery');

const IS_MAC = process.platform === 'darwin';
app.setName('Kiln');
if (process.env.KILN_USER_DATA) app.setPath('userData', process.env.KILN_USER_DATA);
if (!app.requestSingleInstanceLock()) { app.quit(); }
gallery.registerScheme();

let win = null;
const getWin = () => win;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const ctx = { getWin, send };

const ICON = path.join(__dirname, '..', 'build', 'icon.png');

function createWindow() {
  const w = core.g().window || {};
  win = new BrowserWindow({
    width: w.width || 1360, height: w.height || 860, x: w.x, y: w.y, minWidth: 1020, minHeight: 640, title: 'Kiln', show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#151a21' : '#f2f4f7',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    ...(IS_MAC
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#e9edf3' : '#1b2129', height: 52 } }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true, spellcheck: true }
  });
  if (w.maximized) win.maximize();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  const remember = () => { if (!win || win.isDestroyed()) return; const b = win.getNormalBounds(); core.g().window = { ...b, maximized: win.isMaximized() }; core.saveGlobal(); };
  win.on('resize', remember); win.on('move', remember);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
}

function setTheme(theme) {
  nativeTheme.themeSource = theme === 'light' ? 'light' : theme === 'system' ? 'system' : 'dark';
  if (win && !IS_MAC) {
    const dark = nativeTheme.shouldUseDarkColors;
    try { win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#e9edf3' : '#1b2129', height: 52 }); } catch {}
  }
}

/* ---------- app & profile IPC ---------- */
const unlocked = new Set();
function appState() {
  const G = core.g();
  return {
    setupDone: G.setupDone, platform: process.platform, version: app.getVersion(),
    dataRoot: core.dataRoot(), defaultDataRoot: core.defaultDataRoot(),
    profiles: G.profiles.map(core.publicProfile), activeProfileId: G.activeProfileId && unlocked.has(G.activeProfileId) ? G.activeProfileId : null,
    lastProfileId: G.activeProfileId, askOnLaunch: G.askOnLaunch, libraries: G.libraries.map(l => ({ ...l, profiles: G.profiles.filter(p => p.libraryId === l.id).map(p => p.name) })),
    colors: core.COLORS
  };
}
function profileState() {
  const a = core.active();
  if (!a) return null;
  return {
    profile: core.publicProfile(a.profile), settings: core.publicSettings(a.data.settings), prompts: a.data.prompts || [],
    browser: a.data.browser, favorites: a.data.favorites
  };
}

function registerApp() {
  ipcMain.handle('app:state', () => appState());
  ipcMain.handle('app:choose-folder', async (_e, { title, defaultPath } = {}) => {
    const r = await dialog.showOpenDialog(win, { title: title || 'Choose a folder', defaultPath, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('app:choose-files', async (_e, { title, filters } = {}) => {
    const r = await dialog.showOpenDialog(win, { title: title || 'Choose files', properties: ['openFile', 'multiSelections'], filters });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('app:open-external', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.handle('app:open-path', (_e, p) => { if (p && gallery.allowed(p)) shell.openPath(p); });
  ipcMain.handle('app:gpu', () => tools.detectGpu());
  ipcMain.handle('app:tools', async () => ({ git: await tools.findGit(), uv: await tools.findUv(), pythonDir: tools.pythonDir(), dataRoot: core.dataRoot() }));
  ipcMain.handle('setup:complete', (_e, { dataRoot }) => {
    const G = core.g();
    if (dataRoot) G.dataRoot = dataRoot;
    core.ensureDir(core.dataRoot());
    G.setupDone = true;
    core.saveGlobal(true);
    return appState();
  });
  ipcMain.handle('app:set', (_e, patch) => {
    const G = core.g();
    if ('askOnLaunch' in patch) G.askOnLaunch = !!patch.askOnLaunch;
    if ('dataRoot' in patch && patch.dataRoot) G.dataRoot = patch.dataRoot;
    core.saveGlobal();
    return appState();
  });

  ipcMain.handle('profile:create', (_e, opts) => {
    const p = core.createProfile(opts);
    return core.publicProfile(p);
  });
  ipcMain.handle('profile:update', (_e, { id, patch }) => {
    if (patch.pin !== undefined && core.getProfile(id)?.pin && !unlocked.has(id)) throw new Error('Unlock the profile first');
    core.updateProfile(id, patch);
    send('profile:changed', profileState());
    return appState();
  });
  ipcMain.handle('profile:remove', async (_e, { id, deleteFiles }) => {
    if (core.getProfile(id)?.pin && !unlocked.has(id)) throw new Error('Unlock the profile first');
    const dir = core.getProfile(id)?.dir || path.join(core.dataRoot(), 'Profiles', id);
    core.removeProfile(id);
    unlocked.delete(id);
    if (deleteFiles && fs.existsSync(dir)) await shell.trashItem(dir).catch(() => {});
    return appState();
  });
  ipcMain.handle('profile:open', (_e, { id, pin }) => {
    if (!core.checkPin(id, pin)) return { ok: false, error: 'That PIN isn’t right' };
    unlocked.add(id);
    core.activate(id);
    const a = core.active();
    setTheme(a.data.settings.theme);
    require('./models/library').invalidate();
    gallery.invalidate();
    return { ok: true, state: profileState(), app: appState() };
  });
  ipcMain.handle('profile:lock', () => { const id = core.g().activeProfileId; if (id) unlocked.delete(id); return appState(); });
  ipcMain.handle('profile:state', () => profileState());

  ipcMain.handle('settings:save', (_e, patch) => {
    const a = core.active();
    if (!a) return null;
    const s = a.data.settings;
    for (const [k, v] of Object.entries(patch || {})) {
      if (k === 'civitaiKey' || k === 'hfToken') s[k] = v ? core.encrypt(String(v).trim()) : null;
      else if (k === 'gen' || k === 'discover') s[k] = { ...(s[k] || {}), ...v };
      else s[k] = v;
    }
    a.store.save();
    if ('theme' in patch) setTheme(s.theme);
    return core.publicSettings(s);
  });

  ipcMain.handle('prompts:list', () => core.active()?.data.prompts || []);
  ipcMain.handle('prompts:save', (_e, p) => {
    const a = core.active(); if (!a) return [];
    const list = a.data.prompts;
    const now = Date.now();
    const i = list.findIndex(x => x.id === p.id);
    const rec = { id: p.id || core.uid(), name: String(p.name || '').trim() || (p.positive || '').slice(0, 40) || 'Untitled', positive: p.positive || '', negative: p.negative || '', tags: (p.tags || []).map(t => String(t).trim()).filter(Boolean), favorite: !!p.favorite, notes: p.notes || '', params: p.params || null, createdAt: i >= 0 ? list[i].createdAt : now, updatedAt: now, usedAt: p.usedAt || (i >= 0 ? list[i].usedAt : 0) };
    if (i >= 0) list[i] = rec; else list.unshift(rec);
    a.store.save();
    return list;
  });
  ipcMain.handle('prompts:remove', (_e, id) => { const a = core.active(); if (!a) return []; a.data.prompts = a.data.prompts.filter(p => p.id !== id); a.store.save(); return a.data.prompts; });
  ipcMain.handle('prompts:used', (_e, id) => { const a = core.active(); const p = a?.data.prompts.find(x => x.id === id); if (p) { p.usedAt = Date.now(); a.store.save(); } return true; });
  ipcMain.handle('prompts:export', async () => {
    const a = core.active(); if (!a) return null;
    const r = await dialog.showSaveDialog(win, { title: 'Export prompts', defaultPath: `${a.profile.name} prompts.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify({ kiln: 1, prompts: a.data.prompts }, null, 2));
    return r.filePath;
  });
  ipcMain.handle('prompts:import', async () => {
    const a = core.active(); if (!a) return null;
    const r = await dialog.showOpenDialog(win, { title: 'Import prompts', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    const incoming = Array.isArray(j) ? j : j.prompts || [];
    let n = 0;
    for (const p of incoming) {
      if (!p || (!p.positive && !p.prompt)) continue;
      a.data.prompts.unshift({ id: core.uid(), name: p.name || (p.positive || p.prompt).slice(0, 40), positive: p.positive || p.prompt || '', negative: p.negative || p.negative_prompt || '', tags: p.tags || [], favorite: !!p.favorite, notes: p.notes || '', params: p.params || null, createdAt: Date.now(), updatedAt: Date.now(), usedAt: 0 });
      n++;
    }
    a.store.save();
    return { added: n, prompts: a.data.prompts };
  });

  ipcMain.handle('libraries:create', (_e, { name }) => core.createLibrary(name || 'New library'));
  ipcMain.handle('libraries:add-existing', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a models folder to use as a library', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const existing = core.g().libraries.find(l => path.resolve(l.path) === path.resolve(r.filePaths[0]));
    return existing || core.createLibrary(path.basename(r.filePaths[0]), r.filePaths[0]);
  });
  ipcMain.handle('libraries:rename', (_e, { id, name }) => { const l = core.getLibrary(id); if (l) { l.name = name; core.saveGlobal(); } return appState(); });
}

function buildMenu() {
  const go = (page) => () => send('menu', page);
  const tpl = [
    ...(IS_MAC ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'Generate', accelerator: 'CmdOrCtrl+1', click: go('generate') },
      { label: 'Gallery', accelerator: 'CmdOrCtrl+2', click: go('gallery') },
      { label: 'Models', accelerator: 'CmdOrCtrl+3', click: go('models') },
      { label: 'Find models', accelerator: 'CmdOrCtrl+4', click: go('discover') },
      { label: 'Packages', accelerator: 'CmdOrCtrl+5', click: go('packages') },
      { label: 'Browser', accelerator: 'CmdOrCtrl+6', click: go('browser') },
      { label: 'Prompts', accelerator: 'CmdOrCtrl+7', click: go('prompts') },
      { type: 'separator' },
      { label: 'New browser tab', accelerator: 'CmdOrCtrl+T', click: go('browser:new-tab') },
      { label: 'Close browser tab', accelerator: 'CmdOrCtrl+W', click: go('browser:close-tab') },
      { label: 'Switch profile…', accelerator: 'CmdOrCtrl+Shift+P', click: go('switch-profile') },
      { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: go('settings') },
      { type: 'separator' },
      IS_MAC ? { role: 'close' } : { role: 'quit' }
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Quick search', accelerator: 'CmdOrCtrl+K', click: go('palette') },
      { label: 'Reload page', accelerator: 'CmdOrCtrl+R', click: go('browser:reload') },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
      { type: 'separator' }, { role: 'toggleDevTools' }
    ] },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.on('web-contents-created', (_e, contents) => require('./browser').onWebContents(contents));

app.whenReady().then(() => {
  core.init();
  gallery.handleProtocol();
  registerApp();
  require('./packages/manager').register(ctx);
  require('./models/library').register(ctx);
  require('./models/downloads').register(ctx);
  require('./models/ipc').register(ctx);
  require('./generate').register(ctx);
  gallery.register(ctx);
  require('./tags').register(ctx);
  require('./browser').register(ctx);
  buildMenu();
  const a = core.active();
  setTheme(a ? a.data.settings.theme : 'dark');
  createWindow();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
app.on('before-quit', () => { try { require('./packages/manager').stopAll(); } catch {} core.flushAll(); });
app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });
