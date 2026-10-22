// Glean — main process. Owns the browser session, the collector, downloads and the library.
// The window only sees what preload.js exposes.
const { app, BrowserWindow, ipcMain, nativeTheme, dialog, shell, protocol, net, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { Collection } = require('./collect/collection');
const { Capture, PRELOAD } = require('./browser/capture');
const { Library } = require('./library/library');
const { Downloader } = require('./library/downloader');
const { sheetHtml } = require('./library/sheet');
const { siteName, siteOf, accountFromUrl } = require('./collect/extract');
const { IDENTITIES } = require('./browser/identity');

protocol.registerSchemesAsPrivileged([
  { scheme: 'glean-img', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'glean-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);
if (process.env.GLEAN_USER_DATA) app.setPath('userData', process.env.GLEAN_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();
app.userAgentFallback = IDENTITIES.chrome.ua;
if (process.env.GLEAN_TEST_RESOLVE) { // tests: send every site to the local mock server (test/e2e)
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * 127.0.0.1, EXCLUDE localhost');
  app.commandLine.appendSwitch('ignore-certificate-errors');
  app.commandLine.appendSwitch('no-proxy-server');
}

const isMac = process.platform === 'darwin';
let win = null, converter = null;

// ---------------------------------------------------------------- settings
const DEFAULT_SITES = [
  { title: 'Instagram', url: 'https://www.instagram.com/' },
  { title: 'Facebook', url: 'https://www.facebook.com/' },
  { title: 'Patreon', url: 'https://www.patreon.com/home' },
  { title: 'X', url: 'https://x.com/' },
  { title: 'Pinterest', url: 'https://www.pinterest.com/' }
];
const DEFAULTS = {
  theme: 'system', folder: null, layout: 'account', fileNames: 'date-post-n', convertWebp: true, captionFiles: false,
  concurrency: 3, gapMs: 150, scrollSpeed: 'normal', minSide: 320, onlyPosts: true, sites: DEFAULT_SITES,
  homeUrl: 'https://www.instagram.com/', lastUrl: null, trayWidth: 384, newOnly: true
};
let settingsCache = null;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function settings() {
  if (!settingsCache) {
    try { settingsCache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { settingsCache = { ...DEFAULTS }; }
    if (!settingsCache.folder) settingsCache.folder = process.env.GLEAN_FOLDER || path.join(app.getPath('pictures'), 'Glean');
  }
  return settingsCache;
}
function saveSettings(patch) {
  settingsCache = { ...settings(), ...patch };
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settingsCache, null, 1)); } catch (_) {}
  if ('theme' in patch) nativeTheme.themeSource = settingsCache.theme;
  return settingsCache;
}

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send('glean:' + ch, data); };

// ---------------------------------------------------------------- the pieces
let library, collection, capture, downloader;
function setup() {
  library = new Library(path.join(app.getPath('userData'), 'library.json'));
  collection = new Collection(diff => send('collection', diff));
  capture = new Capture({ collection, settings, send, library });
  downloader = new Downloader({
    fetch: (url, o) => capture.fetch(url, o), library, settings, convert: convertToJpg,
    onEvent: (ev) => { send('download', ev); if (ev.type === 'done') { send('library', libraryList()); maybeNotify(ev.job); } }
  });
}
function libraryList() { return library.list().map(h => ({ ...h, siteName: siteName(h.site || 'web'), coverPaths: (h.cover || []).map(f => path.join(h.folder, f)) })); }
function maybeNotify(job) {
  if (!job || !win || win.isFocused()) return;
  try { const { Notification } = require('electron'); if (Notification.isSupported()) new Notification({ title: 'Glean', body: `Saved ${job.done} file${job.done === 1 ? '' : 's'}${job.failed ? ` · ${job.failed} failed` : ''}` }).show(); } catch (_) {}
}

// ---------------------------------------------------------------- WebP/AVIF → JPG (a hidden window decodes with Chromium)
function converterWindow() {
  if (converter && !converter.isDestroyed()) return converter;
  converter = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  converter.loadURL('data:text/html,<!doctype html><title>convert</title>');
  return converter;
}
async function convertToJpg(file) {
  const w = converterWindow();
  if (w.webContents.isLoading()) await new Promise(r => w.webContents.once('did-finish-load', r));
  const src = 'glean-file://f/?p=' + encodeURIComponent(file);
  const b64 = await w.webContents.executeJavaScript(`(async () => {
    const blob = await (await fetch(${JSON.stringify(src)})).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0);
    const out = await c.convertToBlob({ type: 'image/jpeg', quality: 0.93 });
    const buf = new Uint8Array(await out.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
    return btoa(s);
  })()`);
  let out = file.replace(/\.(webp|avif)$/i, '.jpg'); let n = 2;
  while (fs.existsSync(out)) out = file.replace(/\.(webp|avif)$/i, ` (${n++}).jpg`);
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  try { const st = fs.statSync(file); fs.utimesSync(out, st.atime, st.mtime); } catch (_) {}
  fs.rmSync(file, { force: true });
  return out;
}

// ---------------------------------------------------------------- protocols
const thumbCache = new Map(); // url -> { buf, type }
function protocols() {
  // glean-img://t/?u=<remote url>&r=<referer> — remote pictures for the tray, fetched with the signed-in session
  protocol.handle('glean-img', async (req) => {
    const q = new URL(req.url).searchParams; const u = q.get('u'); const r = q.get('r') || '';
    if (!u || !/^https?:/.test(u)) return new Response('bad', { status: 400 });
    const hit = thumbCache.get(u);
    if (hit) { thumbCache.delete(u); thumbCache.set(u, hit); return new Response(hit.buf, { headers: { 'content-type': hit.type, 'cache-control': 'max-age=3600' } }); }
    try {
      const res = await capture.fetch(u, { referer: r });
      if (!res.ok) return new Response('', { status: res.status });
      const buf = Buffer.from(await res.arrayBuffer()); const type = res.headers.get('content-type') || 'image/jpeg';
      if (buf.length < 6 * 1024 * 1024) { thumbCache.set(u, { buf, type }); if (thumbCache.size > 500) thumbCache.delete(thumbCache.keys().next().value); }
      return new Response(buf, { headers: { 'content-type': type, 'cache-control': 'max-age=3600' } });
    } catch (e) { return new Response(String(e.message || e), { status: 502 }); }
  });
  // glean-file://f/?p=<absolute path> — saved files, only from inside the Glean folder or a haul
  protocol.handle('glean-file', async (req) => {
    const p = new URL(req.url).searchParams.get('p') || '';
    const abs = path.resolve(p);
    const roots = [settings().folder, ...library.list().map(h => h.folder)].map(r => path.resolve(r) + path.sep);
    if (!roots.some(r => abs.startsWith(r))) return new Response('not allowed', { status: 403 });
    return net.fetch(pathToFileURL(abs).href, { headers: req.headers });
  });
}

// ---------------------------------------------------------------- contact sheet PDF
async function makeSheet(id) {
  const h = library.get(id); if (!h) throw new Error('That haul is gone');
  const items = library.items(id);
  if (!items.length) throw new Error('Nothing saved in this haul yet');
  const out = path.join(h.folder, `Contact sheet ${new Date().toISOString().slice(0, 10)}.pdf`);
  const tmp = path.join(app.getPath('temp'), `glean-sheet-${Date.now()}.html`);
  fs.writeFileSync(tmp, sheetHtml({ ...h, siteName: siteName(h.site || 'web') }, items));
  const w = new BrowserWindow({ show: false, width: 1100, height: 1400, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await w.loadFile(tmp);
    await w.webContents.executeJavaScript(`Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))).then(() => new Promise(r => setTimeout(r, 300))).then(() => true)`);
    fs.writeFileSync(out, await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }));
  } finally { w.destroy(); fs.rm(tmp, { force: true }, () => {}); }
  return out;
}

// ---------------------------------------------------------------- sync: re-check an account for new posts
async function syncHaul(id) {
  const h = library.get(id); if (!h) throw new Error('That haul is gone');
  if (!h.sourceUrl) throw new Error('Glean doesn’t know which page this came from. Open the page and collect from it once.');
  if (capture.scrolling || capture.batch) throw new Error('Glean is busy scrolling. Stop that first.');
  send('sync', { id, phase: 'loading', title: h.accountName || h.title });
  collection.clear(); capture.stop();
  await capture.load(h.sourceUrl);
  capture.start();
  const known = new Set(Object.keys(library.manifest(h.folder).items));
  send('sync', { id, phase: 'scrolling', title: h.accountName || h.title });
  await capture.autoScroll({ untilKnown: known });
  await new Promise(r => setTimeout(r, 400));
  const minSide = settings().minSide;
  const fresh = collection.list().filter(m => !known.has(m.key) && (m.postId || !settings().onlyPosts) && !(m.width && m.height && Math.max(m.width, m.height) < minSide));
  send('sync', { id, phase: 'done', found: fresh.length, title: h.accountName || h.title });
  if (fresh.length) downloader.enqueue(fresh, { pageUrl: h.sourceUrl, pageTitle: capture.pageTitle(), sourceUrl: h.sourceUrl });
  return { found: fresh.length };
}

// ---------------------------------------------------------------- IPC
const h = (name, fn) => ipcMain.handle('glean:' + name, async (_e, ...a) => {
  try { return { ok: true, data: await fn(...a) }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});
function registerIpc() {
  h('bootstrap', () => {
    try { library.rescan(settings().folder); } catch (_) {}
    return {
      settings: settings(), platform: process.platform, version: app.getVersion(),
      preload: pathToFileURL(PRELOAD).href, partition: 'persist:glean',
      library: libraryList(), saved: [...library.savedKeys()], collection: collection.list(),
      startUrl: process.env.GLEAN_START_URL || settings().lastUrl || settings().homeUrl
    };
  });
  h('settings:set', (patch) => saveSettings(patch || {}));
  h('view:attach', (id) => capture.attach(id));
  h('collect:start', () => { capture.start(); return true; });
  h('collect:stop', () => { capture.stop(); return true; });
  h('collect:scan', async () => { const was = collection.active; if (!was) collection.start(capture.pageUrl()); const n = await capture.scan(); if (!was) collection.stop(); return n; });
  h('collect:clear', () => { capture.stop(); collection.clear(); return true; });
  h('collect:remove', (keys) => { collection.remove(keys); return true; });
  h('collect:add-urls', (urls) => { capture.addLoose((urls || []).map(url => ({ url }))); return true; });
  h('scroll:start', (o) => { capture.autoScroll(o || {}); return true; });
  h('scroll:stop', () => { capture.stopScroll(); return true; });
  h('batch:start', (o) => { capture.runBatch(o || {}); return true; });
  h('batch:stop', () => { capture.stopBatch(); return true; });
  h('download', (keys, ctx) => {
    const items = (keys || []).map(k => collection.get(k)).filter(Boolean);
    if (!items.length) throw new Error('Nothing selected');
    fs.mkdirSync(settings().folder, { recursive: true });
    const page = capture.pageUrl();
    return downloader.enqueue(items, { pageUrl: page, pageTitle: capture.pageTitle(), ...(ctx || {}) });
  });
  h('download:pause', (on) => { downloader.pause(on); return true; });
  h('download:cancel', () => { downloader.cancel(); return true; });
  h('library:list', () => libraryList());
  h('library:items', (id) => library.items(id));
  h('library:remove', (id) => { library.remove(id); return libraryList(); });
  h('library:rename', (id, title) => { const x = library.get(id); if (x) { x.title = x.accountName = String(title || '').trim() || x.title; library.save(); } return libraryList(); });
  h('library:sync', (id) => syncHaul(id));
  h('library:sheet', async (id) => { const p = await makeSheet(id); shell.openPath(p); return p; });
  h('library:saved', () => [...library.savedKeys()]);
  h('shell:reveal', (p) => { shell.showItemInFolder(p); return true; });
  h('shell:open', (p) => shell.openPath(p));
  h('shell:external', (u) => { if (/^https?:/.test(u)) shell.openExternal(u); return true; });
  h('pick-folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Save pictures to…', defaultPath: settings().folder, properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    saveSettings({ folder: r.filePaths[0] }); library.rescan(r.filePaths[0]);
    return r.filePaths[0];
  });
  h('browser:clear-data', async () => { const s = capture.configure(); await s.clearStorageData(); await s.clearCache(); return true; });
  h('window:chrome', (colors) => { if (!isMac && win && win.setTitleBarOverlay) { try { win.setTitleBarOverlay(colors); } catch (_) {} } return true; });
}

// ---------------------------------------------------------------- window
function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 980, minHeight: 620, show: false,
    title: 'Glean', backgroundColor: dark ? '#0e0d12' : '#f7f6fa',
    titleBarStyle: 'hidden', ...(isMac ? { trafficLightPosition: { x: 16, y: 15 } } : { titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#e8e6ef' : '#2a2833', height: 46 } }),
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true, spellcheck: false }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-attach-webview', (_e, prefs, params) => {
    // Pages only ever get our small identity preload, never Node.
    prefs.preload = PRELOAD; prefs.nodeIntegration = false; prefs.contextIsolation = true; prefs.sandbox = true;
    params.partition = 'persist:glean';
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; if (converter && !converter.isDestroyed()) converter.destroy(); converter = null; });
}

function menu() {
  const tpl = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' }, { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload', accelerator: 'CmdOrCtrl+Shift+R' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('web-contents-created', (_e, contents) => { if (capture) capture.onWebContents(contents); });
app.whenReady().then(() => {
  nativeTheme.themeSource = settings().theme;
  setup();
  capture.configure();
  protocols();
  registerIpc();
  menu();
  createWindow();
  if (process.env.GLEAN_E2E) require(process.env.GLEAN_E2E)({ win, app, collection, capture, library, downloader, settings, saveSettings });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().filter(w => w !== converter).length) createWindow(); });
});
app.on('before-quit', () => { try { library && library.flush(); } catch (_) {} });
app.on('window-all-closed', () => { if (!isMac) app.quit(); else if (converter && !converter.isDestroyed()) converter.destroy(); });
