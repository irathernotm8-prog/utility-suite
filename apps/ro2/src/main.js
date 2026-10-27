// RO2 main process: the window, the ro2:// protocol (pages + AI model files), designs, files, export, the photo library and model downloads.
// The page never touches the disk or network itself; everything goes through window.ro2 (preload.js) → the handlers below.
'use strict';
const { app, BrowserWindow, ipcMain, protocol, net, dialog, shell, Menu, clipboard, nativeImage, session, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const { Models, CATALOG } = require('./models');
const { Designs, safeName } = require('./designs');

if (process.env.RO2_USER_DATA) app.setPath('userData', path.resolve(process.env.RO2_USER_DATA));
app.setName('RO2');

const RENDERER = path.join(__dirname, 'renderer');
const LOG = () => path.join(app.getPath('userData'), 'ro2.log');
function log(...a) { try { fs.appendFileSync(LOG(), `[${new Date().toISOString()}] ${a.map((x) => (x && x.stack) || String(x)).join(' ')}\n`); } catch {} }
process.on('uncaughtException', (e) => log('uncaught', e));
process.on('unhandledRejection', (e) => log('unhandled', e));

protocol.registerSchemesAsPrivileged([{ scheme: 'ro2', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);

// ───────────── settings ─────────────
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = { designsFolder: null, theme: 'dark', snap: true, exportFormat: 'png', exportScale: 1, jpgQuality: 0.92, recentColors: [], brandColors: [], aiPrompted: false };
let settings = { ...DEFAULTS };
function loadSettings() { try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) }; } catch { settings = { ...DEFAULTS }; } }
function saveSettings() { try { fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 1)); } catch (e) { log('settings', e); } }
const designsFolder = () => process.env.RO2_DESIGNS || settings.designsFolder || path.join(app.getPath('documents'), 'RO2');
const modelsFolder = () => process.env.RO2_MODELS || path.join(app.getPath('userData'), 'Models');

let win = null; let models; let designs; const pendingOpen = [];
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

// ───────────── protocol ─────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.onnx': 'application/octet-stream', '.txt': 'text/plain' };
function serveFile(file, root) {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) return new Response('Forbidden', { status: 403 });
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) return new Response('Not found', { status: 404 });
  const headers = {
    'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
    // Cross-origin isolation lets the AI use every CPU core (SharedArrayBuffer); "credentialless" still lets library thumbnails load.
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Length': String(fs.statSync(resolved).size),
  };
  const stream = fs.createReadStream(resolved);
  return new Response(require('stream').Readable.toWeb(stream), { status: 200, headers });
}
function registerProtocol() {
  protocol.handle('ro2', (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    if (u.host === 'app') return serveFile(path.join(RENDERER, rel || 'index.html'), RENDERER);
    if (u.host === 'models') return serveFile(path.join(modelsFolder(), rel), modelsFolder());
    return new Response('Not found', { status: 404 });
  });
}

// ───────────── window ─────────────
function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1040, minHeight: 640, show: false,
    backgroundColor: '#0c0e10', title: 'RO2',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 18 } } : { titleBarOverlay: { color: '#0c0e10', symbolColor: '#c9d1d6', height: 52 } }),
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.loadURL('ro2://app/index.html');
  win.once('ready-to-show', () => { win.show(); if (process.env.RO2_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' }); });
  win.on('closed', () => { win = null; });
  // tests: RO2_E2E=<driver.js> drives the real window and quits
  if (process.env.RO2_E2E) win.webContents.once('did-finish-load', () => setTimeout(() => require(path.resolve(process.env.RO2_E2E))({ win, app, models: () => models }).catch((e) => { console.error(e); }).finally(() => app.exit(0)), 600));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('ro2://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.webContents.on('render-process-gone', (_e, d) => log('renderer gone', JSON.stringify(d)));
  win.on('close', (e) => {
    if (win.__closing) return;
    e.preventDefault();
    win.webContents.send('app:before-close');
    setTimeout(() => { if (win && !win.isDestroyed()) { win.__closing = true; win.close(); } }, 1500);
  });
}
ipcMain.on('app:ready-to-close', () => { if (win && !win.isDestroyed()) { win.__closing = true; win.close(); } });

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const cmd = (c) => () => send('menu', c);
  const template = [
    ...(isMac ? [{ label: 'RO2', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: cmd('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [
      { label: 'New design…', accelerator: 'CmdOrCtrl+N', click: cmd('new') },
      { label: 'Open image…', accelerator: 'CmdOrCtrl+O', click: cmd('open-image') },
      { label: 'Open design…', accelerator: 'CmdOrCtrl+Shift+O', click: cmd('open-design') },
      { type: 'separator' },
      { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: cmd('export') },
      { label: 'Copy as PNG', accelerator: 'CmdOrCtrl+Shift+C', click: cmd('copy-png') },
      { type: 'separator' },
      { label: 'Home', accelerator: 'CmdOrCtrl+Shift+H', click: cmd('home') },
      ...(isMac ? [] : [{ type: 'separator' }, { label: 'Settings', accelerator: 'Ctrl+,', click: cmd('settings') }, { role: 'quit' }]),
    ] },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: cmd('undo') },
      { label: 'Redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: cmd('redo') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [
      { label: 'Zoom in', accelerator: 'CmdOrCtrl+=', click: cmd('zoom-in') },
      { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: cmd('zoom-out') },
      { label: 'Fit to window', accelerator: 'CmdOrCtrl+0', click: cmd('zoom-fit') },
      { label: 'Actual size', accelerator: 'CmdOrCtrl+1', click: cmd('zoom-100') },
      { type: 'separator' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]),
    ] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ───────────── images in ─────────────
const IMG_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg', 'ico', 'heic', 'heif', 'tif', 'tiff'];
const MIME_OF = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon' };
function run(cmd, args) { return new Promise((res, rej) => execFile(cmd, args, { timeout: 60000 }, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so)))); }
// Chromium can't open HEIC or TIFF; macOS converts them with sips (built in).
async function convertToJpeg(buf, ext) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ro2-'));
  const src = path.join(tmp, 'in.' + ext), out = path.join(tmp, 'out.jpg');
  try {
    fs.writeFileSync(src, buf);
    if (process.platform === 'darwin') await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', src, '--out', out]);
    else if (process.platform === 'win32') {
      const ps = `Add-Type -AssemblyName PresentationCore; $s=[IO.File]::OpenRead('${src.replace(/'/g, "''")}'); $d=[Windows.Media.Imaging.BitmapDecoder]::Create($s,'None','OnLoad'); $e=New-Object Windows.Media.Imaging.JpegBitmapEncoder; $e.QualityLevel=95; $e.Frames.Add($d.Frames[0]); $o=[IO.File]::Create('${out.replace(/'/g, "''")}'); $e.Save($o); $o.Close(); $s.Close()`;
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    } else throw new Error('This format needs converting first (try RO3 › Quick Convert).');
    return fs.readFileSync(out);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
async function readImageFile(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  let buf = fs.readFileSync(file);
  if (buf.length > 200 * 1024 * 1024) throw new Error('That file is over 200 MB.');
  let mime = MIME_OF[ext];
  if (['heic', 'heif', 'tif', 'tiff'].includes(ext)) { buf = await convertToJpeg(buf, ext); mime = 'image/jpeg'; }
  if (!mime) throw new Error(`RO2 can't open .${ext} files.`);
  return { name: path.basename(file), dataUrl: `data:${mime};base64,${buf.toString('base64')}`, svg: ext === 'svg' ? buf.toString('utf8') : null };
}

// ───────────── PDF ─────────────
function fontFaceCss() {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(RENDERER, 'vendor/fonts/fonts.json'), 'utf8'));
    return '<style>' + list.map((f) => Object.entries(f.files).map(([w, file]) => `@font-face{font-family:"${f.family}";font-weight:${w};font-style:normal;src:url("${pathToFileURL(path.join(RENDERER, 'vendor/fonts', file)).href}") format("woff2")}`).join('')).join('') + '</style>';
  } catch { return ''; }
}
async function writePdf({ svgs, width, height, file }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ro2-pdf-'));
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${width}px ${height}px; margin: 0 } html,body { margin:0; padding:0; background: transparent }
    .p { width:${width}px; height:${height}px; overflow:hidden; page-break-after: always; break-after: page; position: relative }
    .p:last-child { page-break-after: auto; break-after: auto } .p > svg { display:block; width:100%; height:100% }
  </style>${fontFaceCss()}</head><body>${svgs.map((s) => `<div class="p">${s}</div>`).join('')}</body></html>`;
  const htmlFile = path.join(tmp, 'doc.html'); fs.writeFileSync(htmlFile, html);
  const pdfWin = new BrowserWindow({ show: false, width: Math.min(4000, Math.ceil(width)), height: Math.min(4000, Math.ceil(height)), webPreferences: { offscreen: false, sandbox: true } });
  try {
    await pdfWin.loadURL(pathToFileURL(htmlFile).href);
    await pdfWin.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise(r => setTimeout(r, 300)))');
    const pdf = await pdfWin.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    fs.writeFileSync(file, pdf);
    return { ok: true, file, size: pdf.length };
  } finally { pdfWin.destroy(); fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ───────────── IPC ─────────────
function handle(ch, fn) {
  ipcMain.handle(ch, async (_e, ...a) => { try { return await fn(...a); } catch (e) { log(ch, e); throw new Error(e.message || String(e)); } });
}
function registerIpc() {
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, designsFolder: designsFolder(), modelsFolder: modelsFolder(), userData: app.getPath('userData'), dark: nativeTheme.shouldUseDarkColors }));
  handle('app:pending-open', () => pendingOpen.splice(0));
  handle('settings:get', () => settings);
  handle('settings:set', (patch) => { settings = { ...settings, ...patch }; saveSettings(); return settings; });
  handle('shell:open', (url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return true; });
  handle('shell:reveal', (file) => { shell.showItemInFolder(file); return true; });
  handle('log', (msg) => { log('renderer', msg); return true; });

  handle('designs:list', () => designs.list());
  handle('designs:load', (file) => designs.load(file));
  handle('designs:save', (p) => designs.save(p));
  handle('designs:rename', (file, name) => designs.rename(file, name));
  handle('designs:duplicate', (file) => designs.duplicate(file));
  handle('designs:delete', async (file) => { await shell.trashItem(file).catch(() => fs.rmSync(file, { force: true })); designs.forget(file); return true; });
  handle('designs:choose-folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Folder for your designs', defaultPath: designsFolder(), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    settings.designsFolder = r.filePaths[0]; saveSettings(); return r.filePaths[0];
  });
  handle('designs:open-dialog', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Open a design', defaultPath: designsFolder(), filters: [{ name: 'RO2 design', extensions: ['ro2'] }], properties: ['openFile'] });
    return r.canceled ? null : r.filePaths[0];
  });

  handle('files:open-images', async (opts = {}) => {
    const r = await dialog.showOpenDialog(win, { title: opts.title || 'Choose images', filters: [{ name: 'Images', extensions: IMG_EXT }], properties: ['openFile', ...(opts.single ? [] : ['multiSelections'])] });
    if (r.canceled) return [];
    const out = [];
    for (const f of r.filePaths) { try { out.push(await readImageFile(f)); } catch (e) { out.push({ name: path.basename(f), error: e.message }); } }
    return out;
  });
  handle('files:read-image', (file) => readImageFile(file));
  handle('files:convert-image', async (bytes, ext) => { const b = await convertToJpeg(Buffer.from(bytes), ext); return `data:image/jpeg;base64,${b.toString('base64')}`; });

  handle('export:choose', async ({ name, ext, many }) => {
    if (many) {
      const r = await dialog.showOpenDialog(win, { title: 'Export pages to folder', defaultPath: settings.lastExportDir || app.getPath('downloads'), properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Export here' });
      if (r.canceled || !r.filePaths[0]) return null;
      settings.lastExportDir = r.filePaths[0]; saveSettings(); return r.filePaths[0];
    }
    const r = await dialog.showSaveDialog(win, { title: 'Export', defaultPath: path.join(settings.lastExportDir || app.getPath('downloads'), `${safeName(name)}.${ext}`), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (r.canceled || !r.filePath) return null;
    settings.lastExportDir = path.dirname(r.filePath); saveSettings(); return r.filePath;
  });
  handle('export:write', (file, bytes) => { fs.writeFileSync(file, Buffer.from(bytes)); return { ok: true, file, size: bytes.byteLength }; });
  handle('export:write-in', (dir, name, bytes) => {
    let p = path.join(dir, safeName(name.replace(/\.[^.]+$/, '')) + path.extname(name)); let n = 2;
    while (fs.existsSync(p)) p = path.join(dir, `${safeName(name.replace(/\.[^.]+$/, ''))} (${n++})${path.extname(name)}`);
    fs.writeFileSync(p, Buffer.from(bytes)); return p;
  });
  handle('export:pdf', (p) => writePdf(p));
  handle('export:copy-png', (bytes) => { clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(bytes))); return true; });
  handle('clipboard:read-image', () => { const im = clipboard.readImage(); return im.isEmpty() ? null : im.toDataURL(); });

  // Free photos: Wikimedia Commons first (fast and reliable), Openverse as a second source. Everything there is openly licensed.
  const UA = { 'User-Agent': `RO2/${app.getVersion()} (personal design app; Electron)` };
  const withTimeout = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
  const strip = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  async function commons(q, page, kind) {
    const u = new URL('https://commons.wikimedia.org/w/api.php');
    const terms = kind === 'illustration' ? `${q} filetype:drawing` : `${q} filetype:bitmap`;
    Object.entries({ action: 'query', format: 'json', generator: 'search', gsrsearch: terms, gsrnamespace: '6', gsrlimit: '40', gsroffset: String((page - 1) * 40), prop: 'imageinfo', iiprop: 'url|size|extmetadata|mime', iiurlwidth: '480', iiextmetadatafilter: 'LicenseShortName|Artist|ObjectName|LicenseUrl', origin: '*' }).forEach(([k, v]) => u.searchParams.set(k, v));
    const res = await net.fetch(u.href, { headers: UA, signal: withTimeout(15000) });
    if (!res.ok) throw new Error(`Photo search failed (${res.status}).`);
    const d = await res.json(); const pages = Object.values(d.query?.pages || {}).sort((a, b) => a.index - b.index);
    const results = [];
    for (const p of pages) {
      const ii = p.imageinfo?.[0]; if (!ii || !ii.thumburl) continue;
      const svg = ii.mime === 'image/svg+xml';
      if (!svg && (!/^image\/(jpeg|png|webp)$/.test(ii.mime) || ii.width < 500)) continue;
      const m = ii.extmetadata || {};
      const full = svg ? ii.thumburl.replace(/\/\d+px-/, '/2000px-') : ii.width > 2400 ? ii.thumburl.replace(/\/\d+px-/, '/2400px-') : ii.url;
      results.push({ id: 'c' + p.pageid, title: strip(m.ObjectName?.value) || p.title.replace(/^File:|\.[a-z]+$/gi, ''), creator: strip(m.Artist?.value).slice(0, 80), license: strip(m.LicenseShortName?.value) || 'Free license', licenseUrl: m.LicenseUrl?.value, url: full, thumb: ii.thumburl, w: ii.width, h: ii.height, page: ii.descriptionurl, source: 'Wikimedia Commons' });
    }
    return { results, pages: d.continue ? page + 1 : page };
  }
  async function openverse(q, page, kind) {
    const u = new URL('https://api.openverse.org/v1/images/');
    u.searchParams.set('q', q); u.searchParams.set('page', String(page)); u.searchParams.set('page_size', '20');
    u.searchParams.set('license', 'cc0,pdm,by,by-sa'); u.searchParams.set('category', kind === 'illustration' ? 'illustration,digitized_artwork' : 'photograph');
    const res = await net.fetch(u.href, { headers: UA, signal: withTimeout(15000) });
    if (!res.ok) throw new Error(`Photo search failed (${res.status}).`);
    const d = await res.json();
    return { pages: d.page_count, results: (d.results || []).map((r) => ({ id: r.id, title: r.title, creator: r.creator, license: `${String(r.license || '').toUpperCase()} ${r.license_version || ''}`.trim(), licenseUrl: r.license_url, url: r.url, thumb: r.thumbnail, w: r.width, h: r.height, page: r.foreign_landing_url, source: r.source })) };
  }
  handle('library:search', async ({ q, page = 1, kind = 'photo', source }) => {
    const order = source === 'openverse' ? [openverse, commons] : [commons, openverse];
    let err;
    for (const fn of order) { try { const r = await fn(q, page, kind); if (r.results.length || fn === order[order.length - 1]) return r; } catch (e) { err = e; } }
    throw new Error(err && err.name === 'AbortError' ? 'The photo library is not answering. Check your internet connection.' : (err?.message || 'Photo search failed.'));
  });
  handle('library:fetch', async (url) => {
    if (!/^https:\/\//.test(url)) throw new Error('Bad address');
    const res = await net.fetch(url, { headers: { 'User-Agent': `RO2/${app.getVersion()} (personal design app; Electron)` } });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    let mime = (res.headers.get('content-type') || '').split(';')[0].trim();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 40 * 1024 * 1024) throw new Error('That image is too large.');
    if (!mime.startsWith('image/')) {
      if (buf[0] === 0xff && buf[1] === 0xd8) mime = 'image/jpeg'; else if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png'; else throw new Error('That link is not an image.');
    }
    if (['image/heic', 'image/heif', 'image/tiff'].includes(mime)) return `data:image/jpeg;base64,${(await convertToJpeg(buf, mime.split('/')[1])).toString('base64')}`;
    return `data:${mime};base64,${buf.toString('base64')}`;
  });

  handle('models:list', () => models.list());
  handle('models:download', (id) => models.download(id));
  handle('models:cancel', (id) => models.cancel(id));
  handle('models:delete', (id) => models.remove(id));
}

// ───────────── app ─────────────
function openPaths(argv) {
  const files = argv.filter((a) => /\.(ro2|png|jpe?g|webp|gif|bmp|avif|svg|heic|heif|tiff?)$/i.test(a) && fs.existsSync(a));
  if (!files.length) return;
  if (win && !win.webContents.isLoading()) send('app:open-files', files); else pendingOpen.push(...files);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_e, argv) => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } openPaths(argv.slice(1)); });
  app.on('open-file', (e, file) => { e.preventDefault(); openPaths([file]); });
  app.whenReady().then(() => {
    loadSettings();
    models = new Models(modelsFolder(), send);
    designs = new Designs(path.join(app.getPath('userData'), 'index.json'), designsFolder);
    registerProtocol(); registerIpc(); buildMenu();
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['local-fonts', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(perm)));
    session.defaultSession.setPermissionCheckHandler((_wc, perm) => ['local-fonts', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(perm));
    createWindow();
    openPaths(process.argv.slice(app.isPackaged ? 1 : 2));
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
}

module.exports = { CATALOG };
