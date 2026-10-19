// Crate — main process
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, shell, nativeTheme, Menu, dialog, protocol, clipboard } = require('electron');
const { Readable } = require('stream');

const IS_MAC = process.platform === 'darwin';
app.setName('Crate');
if (process.env.CRATE_USER_DATA) app.setPath('userData', process.env.CRATE_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

protocol.registerSchemesAsPrivileged([{ scheme: 'crate', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

const settings = require('./core/settings');
const tools = require('./core/tools');
const library = require('./core/library');
const downloader = require('./core/downloader');
const audio = require('./core/audio');
const meta = require('./core/metadata');
const exporter = require('./core/exporter');

let win = null;
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

let changeTimer = null;
const libChanged = () => { clearTimeout(changeTimer); changeTimer = setTimeout(() => send('lib:changed'), 120); };

function createWindow() {
  const w = settings.get().window || {};
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: w.width || 1320, height: w.height || 840, x: w.x, y: w.y, minWidth: 980, minHeight: 620, title: 'Crate', show: false,
    backgroundColor: dark ? '#121015' : '#f6f4f7',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    ...(IS_MAC
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 20 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#efe9f2' : '#1d1720', height: 52 } }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: true, backgroundThrottling: false }
  });
  if (w.maximized) win.maximize();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  const remember = () => { if (!win || win.isDestroyed()) return; settings.set({ window: { ...win.getNormalBounds(), maximized: win.isMaximized() } }); };
  let t = null; const later = () => { clearTimeout(t); t = setTimeout(remember, 400); };
  win.on('resize', later); win.on('move', later);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
}

function setTheme(theme) {
  nativeTheme.themeSource = theme === 'light' ? 'light' : theme === 'system' ? 'system' : 'dark';
  if (win && !IS_MAC) { const dark = nativeTheme.shouldUseDarkColors; try { win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#efe9f2' : '#1d1720', height: 52 }); } catch {} }
}

/* ---------- crate:// — songs and artwork for the window (with seeking) ---------- */
function serveFile(file, req, type) {
  let st;
  try { st = fs.statSync(file); } catch { return new Response('Not found', { status: 404 }); }
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' };
  if (range) {
    let start = range[1] === '' ? Math.max(0, st.size - Number(range[2])) : Number(range[1]);
    let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : st.size - 1;
    end = Math.min(end, st.size - 1);
    if (start > end) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
    const body = Readable.toWeb(fs.createReadStream(file, { start, end }));
    return new Response(body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1) } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...headers, 'Content-Length': String(st.size) } });
}

function registerProtocol() {
  protocol.handle('crate', (req) => {
    const u = new URL(req.url);
    const id = decodeURIComponent(u.pathname.replace(/^\//, ''));
    if (u.host === 'audio') {
      const f = u.searchParams.get('src') === 'original' ? library.sourceFor(id) : library.filePath(id);
      return f ? serveFile(f, req, 'audio/mpeg') : new Response('Not found', { status: 404 });
    }
    if (u.host === 'art') return serveFile(library.artPath(id), req, 'image/jpeg');
    return new Response('Not found', { status: 404 });
  });
}

/* ---------- IPC ---------- */
async function appState() {
  return {
    version: app.getVersion(), platform: process.platform, settings: settings.get(), libraryRoot: library.getRoot(),
    tools: await tools.status(), exportTargets: exporter.targets(), defaults: settings.DEFAULTS
  };
}

function snapshot() {
  return { tracks: library.all(), albums: library.albums(), playlists: library.playlists(), stats: library.stats(), root: library.getRoot() };
}

const handle = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => {
  try { return { ok: true, value: await fn(...args) }; }
  catch (e) { return { ok: false, error: e.message || String(e), code: e.code }; }
});

function register() {
  handle('app:state', appState);
  handle('app:clipboard', () => clipboard.readText());
  handle('app:open-url', (u) => { if (/^https?:/.test(u)) shell.openExternal(u); });
  handle('app:choose-folder', async ({ title, defaultPath } = {}) => {
    const r = await dialog.showOpenDialog(win, { title: title || 'Choose a folder', defaultPath, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('app:choose-files', async ({ title, filters, multi = true, folders = false } = {}) => {
    const props = ['openFile']; if (multi) props.push('multiSelections'); if (folders) props.push('openDirectory');
    const r = await dialog.showOpenDialog(win, { title: title || 'Choose files', properties: props, filters });
    return r.canceled ? [] : r.filePaths;
  });

  handle('settings:set', async (patch) => {
    const before = settings.get().libraryRoot;
    const s = settings.set(patch);
    if (patch.theme) setTheme(patch.theme);
    if (patch.libraryRoot && patch.libraryRoot !== before) { library.open(s.libraryRoot); await library.scan(s); libChanged(); }
    return appState();
  });

  handle('tools:status', () => tools.status());
  handle('tools:install', async ({ force } = {}) => {
    const st = await tools.install({ force, onProgress: (p) => send('tools:progress', p) });
    settings.set({ toolsCheckedAt: Date.now() });
    return st;
  });

  handle('lib:snapshot', snapshot);
  handle('lib:update', ({ ids, patch, art }) => library.update(ids, patch || {}, settings.get(), { art }));
  handle('lib:reorder', (ids) => library.reorder(ids, settings.get()));
  handle('lib:remove', async ({ ids, deleteFiles }) => { await library.remove(ids, { deleteFiles }); return true; });
  handle('lib:scan', () => library.scan(settings.get(), { onProgress: (p) => send('lib:progress', { kind: 'scan', ...p }) }));
  handle('lib:organize', () => library.organizeAll(settings.get()));
  handle('lib:import', (paths) => library.importFiles(paths, settings.get(), { onProgress: (p) => send('lib:progress', { kind: 'import', ...p }) }));
  handle('lib:reveal', (id) => { const f = id ? library.filePath(id) : library.getRoot(); if (f) shell.showItemInFolder(f); });
  handle('lib:open-root', () => shell.openPath(library.getRoot()));
  handle('lib:played', (id) => { const t = library.get(id); if (t) return library.update([id], { plays: (t.plays || 0) + 1, lastPlayed: Date.now() }, settings.get()); });
  handle('lib:playlist-save', (pl) => library.savePlaylist(pl));
  handle('lib:playlist-delete', (id) => library.deletePlaylist(id));

  handle('edit:load', async (id) => {
    const src = library.sourceFor(id);
    if (!src) throw new Error('That song is no longer in the library.');
    const w = await audio.peaks(src, 2000);
    const t = library.get(id);
    return { ...w, edit: t.edit || null, edited: !!t.original };
  });
  handle('edit:silence', async (id) => { const src = library.sourceFor(id); const p = await audio.probe(src); return audio.silence(src, p.duration); });
  handle('edit:apply', ({ id, ops }) => library.applyEdit(id, ops, { onProgress: (p) => send('edit:progress', { id, progress: p }) }));
  handle('edit:revert', (id) => library.revertEdit(id));

  handle('meta:songs', (q) => meta.searchSongs(q, 15));
  handle('meta:albums', (q) => meta.searchAlbums(q, 12));
  handle('meta:album-tracks', (cid) => meta.albumTracks(cid));
  handle('meta:best', (q) => meta.bestSong(q));
  handle('meta:clean', ({ title, uploader }) => meta.cleanTitle(title, uploader));
  // Apply a catalog album to local songs: album info + artwork to all, track numbers/titles by matching
  handle('meta:apply-album', async ({ ids, collectionId, renameTitles = false }) => {
    const { album, tracks } = await meta.albumTracks(collectionId);
    if (!album) throw new Error('Couldn\'t load that album.');
    const local = ids.map((id) => library.get(id)).filter(Boolean);
    const matches = meta.matchTracks(local, tracks);
    const s = settings.get();
    await library.update(ids, { album: album.album, albumArtist: album.albumArtist, year: album.year, genre: album.genre, trackTotal: album.trackTotal || tracks.length }, s, { art: album.art ? { url: album.art } : undefined });
    let matched = 0;
    for (const m of matches) {
      if (!m.match) continue;
      matched++;
      const patch = { track: m.match.track, disc: m.match.disc, discTotal: m.match.discTotal };
      if (renameTitles) patch.title = m.match.title;
      await library.update([m.id], patch, s);
    }
    return { matched, total: ids.length };
  });

  handle('dl:probe', (url) => downloader.probe(url, settings.get()));
  handle('dl:search', ({ q, site }) => downloader.search(q, settings.get(), { site, limit: site === 'playlists' ? 12 : 18 }));
  handle('dl:enqueue', ({ items, options }) => downloader.enqueue(items, options));
  handle('dl:cancel', (id) => downloader.cancel(id));
  handle('dl:retry', ({ id, force }) => downloader.retry(id, { force }));
  handle('dl:clear', () => downloader.clearFinished());
  handle('dl:list', () => downloader.list());

  let exportCtrl = null;
  handle('export:targets', () => exporter.targets());
  handle('export:run', async (opts) => {
    exportCtrl = new AbortController();
    try { return await exporter.run({ ...opts, signal: exportCtrl.signal, onProgress: (p) => send('export:progress', p) }); }
    finally { exportCtrl = null; }
  });
  handle('export:cancel', () => exportCtrl && exportCtrl.abort());
  handle('export:open', (p) => shell.openPath(p));
}

function buildMenu() {
  const template = [
    ...(IS_MAC ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'Download…', accelerator: 'CmdOrCtrl+D', click: () => send('menu', 'download') },
      { label: 'Import Files…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'import') },
      { label: 'Send to Phone…', accelerator: 'CmdOrCtrl+E', click: () => send('menu', 'export') },
      { type: 'separator' },
      { label: 'Show Library Folder', click: () => shell.openPath(library.getRoot()) },
      { type: 'separator' },
      IS_MAC ? { role: 'close' } : { role: 'quit' }
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Songs', accelerator: 'CmdOrCtrl+1', click: () => send('menu', 'songs') },
      { label: 'Albums', accelerator: 'CmdOrCtrl+2', click: () => send('menu', 'albums') },
      { label: 'Artists', accelerator: 'CmdOrCtrl+3', click: () => send('menu', 'artists') },
      { type: 'separator' },
      { label: 'Find', accelerator: 'CmdOrCtrl+F', click: () => send('menu', 'find') },
      { type: 'separator' },
      { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }
    ] },
    { label: 'Controls', submenu: [
      { label: 'Play / Pause', accelerator: 'Space', registerAccelerator: false, click: () => send('menu', 'playpause') },
      { label: 'Next', accelerator: 'CmdOrCtrl+Right', click: () => send('menu', 'next') },
      { label: 'Previous', accelerator: 'CmdOrCtrl+Left', click: () => send('menu', 'prev') }
    ] },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(async () => {
  settings.init(app.getPath('userData'));
  tools.init(app.getPath('userData'));
  library.configure({ trash: (p) => shell.trashItem(p), onChange: libChanged });
  const s = settings.get();
  library.open(s.libraryRoot);
  downloader.configure({ settings: () => settings.get(), onUpdate: (j) => { send('dl:update', j); if (j && j.status === 'done') libChanged(); } });
  setTheme(s.theme);
  registerProtocol();
  register();
  buildMenu();
  createWindow();
  // pick up files added to the folder while Crate was closed
  library.scan(s).then(libChanged).catch(() => {});
  // keep yt-dlp fresh (YouTube changes often)
  if (fs.existsSync(tools.ytdlp()) && Date.now() - (s.toolsCheckedAt || 0) > 3 * 864e5) {
    tools.selfUpdate().then(() => settings.set({ toolsCheckedAt: Date.now() })).catch(() => {});
  }
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('before-quit', () => library.flush());
app.on('window-all-closed', () => { library.flush(); if (!IS_MAC) app.quit(); });
