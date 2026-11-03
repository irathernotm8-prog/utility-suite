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
const { Brand } = require('./brand');
const html = require('./html');
const video = require('./video');
const connectors = require('./connectors');
const ai = require('./ai');
const llm = require('./llm');
const { guideText } = require('../mcp/guide');

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
const mediaFolder = () => path.join(designsFolder(), 'Media');

let win = null; let models; let designs; let brand; const pendingOpen = [];
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

// ───────────── protocol ─────────────
const MIME = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.aac': 'audio/aac', '.flac': 'audio/flac', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.onnx': 'application/octet-stream', '.txt': 'text/plain' };
function serveFile(file, root, { cors = false, range = null } = {}) {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) return new Response('Forbidden', { status: 403 });
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) return new Response('Not found', { status: 404 });
  const size = fs.statSync(resolved).size;
  const headers = {
    'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
    // Cross-origin isolation lets the AI use every CPU core (SharedArrayBuffer); "credentialless" still lets library thumbnails load.
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Cross-Origin-Resource-Policy': cors ? 'cross-origin' : 'same-origin',
    ...(cors ? { 'Access-Control-Allow-Origin': '*' } : {}),
    'Accept-Ranges': 'bytes',
  };
  // byte ranges, so <video> can seek
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    const start = m[1] ? +m[1] : Math.max(0, size - +m[2]); const end = m[1] && m[2] ? Math.min(size - 1, +m[2]) : size - 1;
    if (start >= size) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`; headers['Content-Length'] = String(end - start + 1);
    return new Response(require('stream').Readable.toWeb(fs.createReadStream(resolved, { start, end })), { status: 206, headers });
  }
  headers['Content-Length'] = String(size);
  const stream = fs.createReadStream(resolved);
  return new Response(require('stream').Readable.toWeb(stream), { status: 200, headers });
}
function ro2Protocol(req) {
  const u = new URL(req.url);
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  if (u.host === 'app') return serveFile(path.join(RENDERER, rel || 'index.html'), RENDERER, { cors: /^vendor\/fonts\//.test(rel) });
  if (u.host === 'models') return serveFile(path.join(modelsFolder(), rel), modelsFolder());
  if (u.host === 'brand') return serveFile(brand.logoPath(rel), brand.logoPath(''), { cors: true });
  if (u.host === 'html') return html.serve(u);
  // video and music: the design's Media folder and finished previews only
  if (u.host === 'media') { const f = u.searchParams.get('f') || ''; for (const root of [mediaFolder(), video.WORK(), path.join(os.tmpdir(), 'ro2-previews')]) if (path.resolve(f).startsWith(path.resolve(root) + path.sep)) return serveFile(f, root, { range: req.headers.get('range'), cors: true }); return new Response('Forbidden', { status: 403 }); }
  return new Response('Not found', { status: 404 });
}
function registerProtocol() {
  protocol.handle('ro2', ro2Protocol);
  html.setFonts(RENDERER);
  html.htmlSession(ro2Protocol);
}

// ───────────── window ─────────────
const lightNow = () => settings.theme === 'light' || (settings.theme === 'system' && !nativeTheme.shouldUseDarkColors);
function createWindow() {
  const isMac = process.platform === 'darwin'; const light = lightNow();
  nativeTheme.themeSource = ['light', 'dark'].includes(settings.theme) ? settings.theme : 'system';
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1040, minHeight: 640, show: false,
    backgroundColor: light ? '#f6f7f9' : '#0c0e10', title: 'RO2',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 18 } } : { titleBarOverlay: { color: light ? '#f6f7f9' : '#0c0e10', symbolColor: light ? '#3b444b' : '#c9d1d6', height: 52 } }),
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
  handle('app:theme', (t) => {
    nativeTheme.themeSource = t === 'light' || t === 'dark' ? t : 'system';
    const light = t === 'light' || (t !== 'dark' && !nativeTheme.shouldUseDarkColors);
    if (win && process.platform !== 'darwin') { try { win.setTitleBarOverlay({ color: light ? '#f6f7f9' : '#0c0e10', symbolColor: light ? '#3b444b' : '#c9d1d6', height: 52 }); } catch {} }
    if (win) win.setBackgroundColor(light ? '#f6f7f9' : '#0c0e10');
    return light;
  });
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

  handle('brand:get', () => brand.get());
  handle('brand:active', (id) => brand.setActive(id));
  handle('brand:create', (name) => brand.create(name));
  handle('brand:update', (id, patch) => brand.update(id, patch));
  handle('brand:remove', (id) => brand.remove(id));
  handle('brand:add-logo', (id, logo) => brand.addLogo(id, logo));
  handle('brand:remove-logo', (id, lid) => brand.removeLogo(id, lid));
  handle('brand:logo', (id, lid) => brand.logoData(id, lid));
  handle('brand:pick-logos', async (id) => {
    const r = await dialog.showOpenDialog(win, { title: 'Add logos', filters: [{ name: 'Logos', extensions: ['png', 'svg', 'jpg', 'jpeg', 'webp', 'gif'] }], properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return brand.get();
    for (const f of r.filePaths) brand.addLogo(id, { name: path.basename(f).replace(/\.[^.]+$/, ''), bytes: fs.readFileSync(f), ext: path.extname(f).slice(1) });
    return brand.get();
  });

  // ── HTML layers
  handle('html:register', (spec) => html.register(spec));
  handle('html:render', async (spec, opts) => { const r = await html.render(spec, opts || {}); return { dataUrl: 'data:image/png;base64,' + r.png.toString('base64'), w: r.w, h: r.h, meta: r.meta, logs: r.logs, key: r.key }; });
  handle('html:inspect', (spec) => html.inspect(spec));
  handle('html:layers', (spec, opts) => html.toLayers(spec, opts || {}));

  // ── video: export, previews, clips and music
  const jobs = new Map();
  handle('video:export', async (jobId, spec) => {
    const ac = new AbortController(); jobs.set(jobId, ac);
    try { return await video.exportVideo(spec, (p) => send('video:progress', { jobId, p }), ac.signal); }
    finally { jobs.delete(jobId); }
  });
  handle('video:cancel', (jobId) => { const j = jobs.get(jobId); if (j) j.abort(); return true; });
  handle('video:preview-path', () => { const d = path.join(os.tmpdir(), 'ro2-previews'); fs.mkdirSync(d, { recursive: true }); for (const f of fs.readdirSync(d)) { try { if (Date.now() - fs.statSync(path.join(d, f)).mtimeMs > 3600e3) fs.rmSync(path.join(d, f), { force: true }); } catch {} } return path.join(d, `preview-${Date.now()}.mp4`); });
  handle('media:import', (file) => video.importMedia(file, mediaFolder()));
  handle('media:pick', async (kind) => {
    const exts = kind === 'audio' ? ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'] : ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'gif'];
    const r = await dialog.showOpenDialog(win, { title: kind === 'audio' ? 'Choose music' : 'Choose a video', filters: [{ name: kind === 'audio' ? 'Audio' : 'Video', extensions: exts }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return video.importMedia(r.filePaths[0], mediaFolder());
  });
  handle('agent:out-path', (name, ext, dir) => { // where an AI's export goes: Downloads (or the folder it named), never over a file
    const d = dir && path.isAbsolute(dir) ? dir : app.getPath('downloads'); fs.mkdirSync(d, { recursive: true });
    const base = safeName(String(name || 'Design')); let p = path.join(d, `${base}.${ext}`); let n = 2;
    while (fs.existsSync(p)) p = path.join(d, `${base} (${n++}).${ext}`);
    return p;
  });
  handle('media:poster', (file, t) => video.posterAt(file, t));
  handle('media:url', (file) => `ro2://media/x?f=${encodeURIComponent(file)}`);
  handle('ro3:open', async (file) => {
    const ro3 = process.platform === 'darwin' ? ['/Applications/RO3.app', path.join(os.homedir(), 'Applications', 'RO3.app')].find((p) => fs.existsSync(p))
      : [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'RO3', 'RO3.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ro3', 'RO3.exe')].find((p) => fs.existsSync(p));
    if (!ro3) { shell.showItemInFolder(file); return { ok: false, reason: 'RO3 isn’t installed on this computer (install it from Utility Hub). The video is shown in its folder instead.' }; }
    if (process.platform === 'darwin') require('child_process').spawn('open', ['-a', ro3, file], { detached: true, stdio: 'ignore' }).unref();
    else require('child_process').spawn(ro3, [file], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  });

  // ── AI: the Claude / Codex plugin, and the in-app assistant
  handle('ai:status', () => ({ claude: ai.cli('claude'), codex: ai.cli('codex'), connectors: connectors.connectorStatus(), providers: llm.PROVIDERS, settings: aiSettingsPublic() }));
  handle('ai:connect', async (which) => (which === 'desktop' ? connectors.connectDesktop() : which === 'code' ? connectors.connectCode() : connectors.connectCodex()));
  handle('ai:set', (patch) => { const a = settings.ai || {}; if (patch.key != null && patch.provider) { a.keys = a.keys || {}; a.keys[patch.provider] = patch.key ? encrypt(patch.key) : undefined; } for (const k of ['provider', 'model', 'base', 'route']) if (patch[k] !== undefined) a[k] = patch[k]; settings.ai = a; saveSettings(); return aiSettingsPublic(); });
  handle('ai:models', async (provider) => { const p = llm.PROVIDERS.find((x) => x.id === provider); const a = settings.ai || {}; return llm.listModels({ ...p, base: (provider === 'custom' && a.base) || p.base }, keyOf(provider)); });
  const turns = new Map(); const histories = new Map();
  handle('ai:ask', async (turnId, { prompt, route, reset }) => {
    const ac = new AbortController(); turns.set(turnId, ac);
    const ev = (e) => send('ai:event', { turnId, ...e });
    try {
      const a = settings.ai || {}; const r = route || a.route || 'auto';
      if (reset) histories.clear();
      if (r === 'claude-code' || r === 'codex' || (r === 'auto' && !keyOf(a.provider) && (ai.cli('claude') || ai.cli('codex')))) {
        connectors.installScript();
        const res = await ai.askAgent({ prompt, entry: connectors.connectorStatus().entry, cwd: path.join(app.getPath('userData'), 'agent'), signal: ac.signal, provider: r === 'codex' ? 'codex' : r === 'claude-code' ? 'claude' : 'auto', resume: histories.get('cli') || null, onEvent: ev });
        if (res.session) histories.set('cli', res.session);
        return { who: res.who, text: res.text };
      }
      const provider = llm.PROVIDERS.find((x) => x.id === (a.provider || 'anthropic')); if (!provider) throw new Error('Choose an AI in Settings › AI.');
      const history = histories.get(provider.id) || []; histories.set(provider.id, history);
      const res = await llm.runTurn({ provider: { ...provider, base: (provider.id === 'custom' && a.base) || provider.base }, key: keyOf(provider.id), model: a.model, system: INAPP_SYSTEM(), history, prompt, signal: ac.signal, onEvent: ev, handle: (name, args) => agentCall(name, args, provider.name.split(' · ').pop()) });
      return { who: provider.name.split(' · ').pop(), text: res.text };
    } finally { turns.delete(turnId); }
  });
  handle('ai:stop', (turnId) => { const t = turns.get(turnId); if (t) t.abort(); return true; });
  ipcMain.on('agent:reply', (_e, { id, result }) => { const p = pendingCalls.get(id); if (p) { pendingCalls.delete(id); p(result); } });
  handle('models:list', () => models.list());
  handle('models:download', (id) => models.download(id));
  handle('models:cancel', (id) => models.cancel(id));
  handle('models:delete', (id) => models.remove(id));
}

// ───────────── the AI bridge: every tool runs in the window, where the design lives ─────────────
const { safeStorage } = require('electron');
const encrypt = (t) => { try { return safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(t).toString('base64') : 'raw:' + Buffer.from(t).toString('base64'); } catch { return 'raw:' + Buffer.from(t).toString('base64'); } };
const decrypt = (v) => { if (!v) return ''; try { if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')); if (v.startsWith('raw:')) return Buffer.from(v.slice(4), 'base64').toString(); } catch {} return ''; };
const keyOf = (provider) => decrypt(((settings.ai || {}).keys || {})[provider]);
function aiSettingsPublic() { const a = settings.ai || {}; return { provider: a.provider || 'anthropic', model: a.model || '', base: a.base || '', route: a.route || 'auto', hasKey: Object.fromEntries(Object.entries(a.keys || {}).filter(([, v]) => v).map(([k]) => [k, true])) }; }
const INAPP_SYSTEM = () => `You are the design assistant inside RO2, the user's design and photo editor. You have RO2's tools and can see your work with screenshot. ${guideText({})}`;
const pendingCalls = new Map(); let callSeq = 0;
async function waitForWindow(ms = 30000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (win && !win.isDestroyed() && !win.webContents.isLoading() && win.__agentReady) return true; await new Promise((r) => setTimeout(r, 200)); } return false; }
async function agentCall(name, args, client) {
  if (name === 'ro2_guide') { // the guide is written here; the window adds its fonts, shapes and brand kit
    const r = await agentCall('__info', {}, client).catch(() => null); let info = {};
    try { info = JSON.parse(r.content[0].text); } catch {}
    return { content: [{ type: 'text', text: guideText(info) }] };
  }
  if (!(await waitForWindow())) return { content: [{ type: 'text', text: 'RO2’s window isn’t ready. Ask the user to open RO2.' }], isError: true };
  const id = ++callSeq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pendingCalls.delete(id); resolve({ content: [{ type: 'text', text: 'RO2 took too long to answer (15 min).' }], isError: true }); }, 15 * 60e3);
    pendingCalls.set(id, (r) => { clearTimeout(timer); resolve(r && r.content ? r : { content: [{ type: 'text', text: 'Bad reply from the RO2 window' }], isError: true }); });
    send('agent:call', { id, name, args: args || {}, client: client || 'AI' });
  });
}
ipcMain.on('agent:ready', () => { if (win) win.__agentReady = true; });

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
    brand = new Brand(app.getPath('userData'));
    designs = new Designs(path.join(app.getPath('userData'), 'index.json'), designsFolder);
    registerProtocol(); registerIpc(); buildMenu();
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['local-fonts', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(perm)));
    session.defaultSession.setPermissionCheckHandler((_wc, perm) => ['local-fonts', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(perm));
    createWindow();
    connectors.startBridge((name, args, client) => agentCall(name, args, client), (st) => send('ai:bridge', st));
    connectors.refreshInstalled();
    openPaths(process.argv.slice(app.isPackaged ? 1 : 2));
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => connectors.stopBridge());
}

module.exports = { CATALOG };
