// Mural — live wallpapers for Mac and Windows. Main process: the mural:// protocol, the library, the host that runs
// the wallpapers, the tray, the app window (Library, Studio, Performance, Settings) and the Utility Suite link.
'use strict';
const { app, BrowserWindow, ipcMain, protocol, screen, powerMonitor, Tray, Menu, nativeImage, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Readable } = require('stream');
const { Store } = require('./core/store');
const { Library } = require('./core/library');
const { Host } = require('./host');
const connectors = require('./connectors');
const ai = require('./ai');
const { makeHandlers } = require('./mcp-handlers');
const { Widgets } = require('./core/widgets');
const { WidgetLayer } = require('./widget-host');

const isMac = process.platform === 'darwin', isWin = process.platform === 'win32';
const E2E = process.env.MURAL_E2E || null;
if (process.env.MURAL_USER_DATA) app.setPath('userData', process.env.MURAL_USER_DATA);

// Windows: Chromium would treat a window living behind the desktop icons as hidden and stop painting it.
if (isWin) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

protocol.registerSchemesAsPrivileged([{ scheme: 'mural', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true } }]);

if (!E2E && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const LOG = () => path.join(app.getPath('userData'), 'mural.log');
function log(...a) { const line = `[${new Date().toISOString()}] ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`; try { fs.appendFileSync(LOG(), line); } catch (_) {} if (!app.isPackaged) process.stdout.write(line); }
process.on('uncaughtException', (e) => log('uncaught', e && e.stack || String(e)));
process.on('unhandledRejection', (e) => log('unhandled', e && e.stack || String(e)));

let asking = null;
let widgets, layer;
let store, library, host, schema, win = null, tray = null, link = null, quitting = false;
const RENDERER = path.join(__dirname, 'renderer');
const userWallpapers = () => process.env.MURAL_LIBRARY || path.join(app.getPath('documents'), 'Mural');

// ---------------------------------------------------------------------------------------------------- mural://
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.frag': 'text/plain', '.glsl': 'text/plain', '.fs': 'text/plain', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain' };

function serveFile(file, req, cors) {
  let st; try { st = fs.statSync(file); } catch (_) { return new Response('Not found', { status: 404 }); }
  if (!st.isFile()) return new Response('Not found', { status: 404 });
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const h = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (cors) h['Access-Control-Allow-Origin'] = '*';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (range && (range[1] || range[2])) { // videos seek and loop with byte ranges
    let start = range[1] ? parseInt(range[1], 10) : st.size - parseInt(range[2], 10); let end = range[1] && range[2] ? parseInt(range[2], 10) : st.size - 1;
    start = Math.max(0, start); end = Math.min(end, st.size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: 206, headers: { ...h, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1) } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...h, 'Content-Length': String(st.size) } });
}
function registerProtocol() {
  protocol.handle('mural', (req) => {
    const u = new URL(req.url); const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean);
    if (u.host === 'app') {
      const f = path.resolve(RENDERER, ...parts); if (!f.startsWith(RENDERER + path.sep)) return new Response('Forbidden', { status: 403 });
      return serveFile(f, req, false);
    }
    if (u.host === 'wp') { // mural://wp/<builtin|user>/<slug>/<file…>
      const id = `${parts[0]}/${parts[1]}`; const f = library.fileOf(id, parts.slice(2).join('/'));
      return f ? serveFile(f, req, true) : new Response('Forbidden', { status: 403 });
    }
    if (u.host === 'widget') { // mural://widget/<builtin|user>/<slug>/<file…>; pages get a policy that enforces their permissions
      const type = `${parts[0]}/${parts[1]}`; const f = widgets.fileOf(type, parts.slice(2).join('/'));
      if (!f) return new Response('Forbidden', { status: 403 });
      const res = serveFile(f, req, true);
      if (/\.html?$/i.test(f) && res.status === 200) {
        const w = widgets.read(type); const net = w && w.manifest.permissions.includes('network');
        const csp = `default-src mural: data: blob: 'unsafe-inline' 'unsafe-eval'; img-src mural: data: blob:${net ? ' https:' : ''}; media-src mural: data: blob:${net ? ' https:' : ''}; connect-src mural:${net ? ' https: wss:' : ''}; font-src mural: data:${net ? ' https:' : ''}; frame-src 'none'; form-action 'none'`;
        res.headers.set('Content-Security-Policy', csp);
      }
      return res;
    }
    if (u.host === 'thumb') { const f = path.join(library.thumbDir, path.basename(parts[0] || '')); return serveFile(f, req, true); }
    return new Response('Not found', { status: 404 });
  });
}

// ---------------------------------------------------------------------------------------------------- app window
function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send('mural:' + ch, data); }
function createWindow(page) {
  if (win && !win.isDestroyed()) { if (page) send('goto', page); win.show(); win.focus(); if (isMac && app.dock) app.dock.show(); return win; }
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 980, minHeight: 640, show: false, title: 'Mural',
    backgroundColor: '#0b0d12', titleBarStyle: isMac ? 'hiddenInset' : 'hidden', titleBarOverlay: isWin ? { color: '#0b0d12', symbolColor: '#e8ebf2', height: 40 } : undefined,
    trafficLightPosition: { x: 16, y: 14 }, icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: false }
  });
  win.loadURL('mural://app/app.html' + (page ? '#' + page : ''));
  win.once('ready-to-show', () => { if (!E2E || process.env.MURAL_E2E_SHOW) win.show(); });
  win.on('closed', () => { win = null; if (isMac && app.dock && !quitting) app.dock.hide(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('mural://app/')) e.preventDefault(); });
  if (isMac && app.dock) app.dock.show();
  return win;
}

// ---------------------------------------------------------------------------------------------------- tray
function trayIcon() {
  const dir = path.join(__dirname, '..', 'build');
  if (isMac) { const i = nativeImage.createFromPath(path.join(dir, 'trayTemplate.png')); i.setTemplateImage(true); return i; }
  return nativeImage.createFromPath(path.join(dir, 'tray.png'));
}
function buildTray() {
  if (E2E) return;
  try { tray = new Tray(trayIcon()); } catch (e) { log('tray failed', e.message); return; }
  tray.setToolTip('Mural');
  tray.on('click', () => { if (isWin) createWindow(); });
  refreshTray();
}
function refreshTray() {
  if (!tray) return;
  const s = store.get(); const list = library.list(); const cur = list.find((w) => w.id === s.wallpaper);
  const favs = (s.favorites || []).map((id) => list.find((w) => w.id === id)).filter(Boolean).slice(0, 8);
  const pick = (favs.length ? favs : list.slice(0, 8)).map((w) => ({ label: w.name, type: 'radio', checked: s.sameOnAll && w.id === s.wallpaper, click: () => apply(w.id) }));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: cur ? `Now: ${cur.name}` : 'Mural', enabled: false },
    { type: 'separator' },
    { label: host.userPaused ? 'Resume wallpapers' : 'Pause wallpapers', click: () => { host.setUserPaused(!host.userPaused); refreshTray(); send('state', host.status()); } },
    { label: 'Wallpapers on desktop', type: 'checkbox', checked: !!s.enabled, click: (i) => setSettings({ enabled: i.checked }) },
    { type: 'separator' }, ...pick, { type: 'separator' },
    { label: 'Open Mural…', click: () => createWindow('library') },
    { label: 'Studio…', click: () => createWindow('studio') },
    { label: layer && layer.editing ? 'Done arranging widgets' : 'Arrange widgets', click: () => { layer.setEditing(!layer.editing); refreshTray(); } },
    { label: 'Widgets…', click: () => createWindow('widgets') },
    { label: 'Performance…', click: () => createWindow('performance') },
    { type: 'separator' }, { label: 'Quit Mural', click: () => { quitting = true; app.quit(); } }
  ]));
}

// ---------------------------------------------------------------------------------------------------- actions
function apply(id, displayKey = null) {
  if (!library.read(id)) throw new Error('That wallpaper isn’t in the library any more');
  if (displayKey) { const per = { ...store.get().perDisplay, [displayKey]: id }; store.set({ perDisplay: per, sameOnAll: false }); }
  else store.set({ wallpaper: id, sameOnAll: true });
  if (!store.get().enabled) store.set({ enabled: true });
  host.sync(); refreshTray(); send('settings', store.get());
  if (link) link.emit('changed', current());
  return current();
}
function current() { const s = store.get(); return { enabled: s.enabled, paused: host.userPaused, sameOnAll: s.sameOnAll, wallpaper: s.wallpaper, displays: host.status().displays.map((d) => ({ key: d.key, label: d.label, wallpaperId: d.wallpaperId, name: d.name, state: d.state })) }; }
function setSettings(patch) {
  const before = store.get(); const prev = { ...before };
  const s = store.set(patch);
  if ('startAtLogin' in patch) applyLogin();
  if ('enabled' in patch || 'sameOnAll' in patch || 'perDisplay' in patch || 'wallpaper' in patch) host.sync();
  if (['fps', 'scale', 'battery', 'budget'].some((k) => k in patch)) { host.governor.setBudget(s.budget); host.governor.reset(); host.pushQuality(); }
  if (['pauseCovered', 'pauseLocked', 'pauseHot', 'pauseIdle', 'battery', 'cursor', 'clicks', 'freeAfter'].some((k) => k in patch)) host.evaluate();
  if ('location' in patch || 'showStats' in patch) for (const r of host.recs.values()) if (r.win && !r.win.isDestroyed()) r.win.webContents.send('wp:settings', { location: s.location, showStats: s.showStats });
  if ('freeAfter' in patch && !patch.freeAfter && prev.freeAfter) host.restoreOriginal();
  refreshTray(); send('settings', s); return s;
}
function applyLogin() { try { app.setLoginItemSettings({ openAtLogin: !!store.get().startAtLogin, openAsHidden: true, args: ['--hidden'] }); } catch (_) {} }

/** Everything a wallpaper's page needs to play in the app (Studio, cards): manifest, base URL, shader code. */
function wallpaperFull(id) {
  const w = library.read(id); if (!w) return null;
  let code = null;
  if (w.manifest.type === 'shader' && !w.manifest.code && w.manifest.shader) { try { code = fs.readFileSync(library.fileOf(id, w.manifest.shader), 'utf8'); } catch (_) {} }
  let files = []; try { files = fs.readdirSync(w.dir).filter((f) => !f.startsWith('.') && f !== 'mural.json'); } catch (_) {}
  return { id, builtin: w.builtin, manifest: w.manifest, traits: w.traits, base: `mural://wp/${id}/`, code, files, dir: w.dir };
}

const API = {
  'app.info': () => ({ version: app.getVersion(), platform: process.platform, library: userWallpapers(), dataDir: app.getPath('userData'), e2e: !!E2E }),
  'settings.get': () => store.get(),
  'settings.set': (patch) => setSettings(patch),
  'cities': () => null,
  'library.list': () => library.list(),
  'library.get': (id) => wallpaperFull(id),
  'library.create': (m) => { const id = library.create(m); notifyLibrary(); return id; },
  'library.save': (id, m, files) => { const nid = library.save(id, m, files || {}); notifyLibrary(); host.recs.forEach((r) => { if (r.wallpaperId === nid) host.load(r, nid); }); return nid; },
  'library.duplicate': (id) => { const nid = library.duplicate(id); notifyLibrary(); return nid; },
  'library.remove': async (id) => {
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Move to Trash', 'Cancel'], defaultId: 0, cancelId: 1, message: 'Move this wallpaper to the Trash?', detail: 'Its folder goes to the Trash, so you can still get it back.' });
    if (r.response !== 0) return false;
    await library.remove(id, (dir) => shell.trashItem(dir));
    const s = store.get(); if (s.wallpaper === id) store.set({ wallpaper: 'builtin/aurora' });
    for (const [k, v] of Object.entries(s.perDisplay)) if (v === id) { const per = { ...store.get().perDisplay }; delete per[k]; store.set({ perDisplay: per }); }
    store.set({ favorites: (s.favorites || []).filter((f) => f !== id) });
    host.sync(); notifyLibrary(); return true;
  },
  'library.export': async (id) => {
    const w = library.read(id); if (!w) return null;
    const r = await dialog.showSaveDialog(win, { title: 'Export wallpaper', defaultPath: path.join(app.getPath('downloads'), w.manifest.name.replace(/[\\/:*?"<>|]/g, '') + '.mural'), filters: [{ name: 'Mural wallpaper', extensions: ['mural'] }] });
    if (r.canceled || !r.filePath) return null; library.exportTo(id, r.filePath); shell.showItemInFolder(r.filePath); return r.filePath;
  },
  'library.import': async (paths) => {
    if (!paths || !paths.length) {
      const r = await dialog.showOpenDialog(win, { title: 'Add wallpapers', properties: ['openFile', 'openDirectory', 'multiSelections'], filters: [{ name: 'Wallpapers', extensions: ['mural', 'zip', 'mp4', 'webm', 'mov', 'm4v', 'mkv', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'html', 'htm', 'frag', 'glsl'] }, { name: 'All files', extensions: ['*'] }] });
      if (r.canceled) return { imported: [], skipped: [] }; paths = r.filePaths;
    }
    const res = library.importPaths(paths); notifyLibrary(); return res;
  },
  'library.addAsset': async (id, kind, given) => {
    let p = given;
    if (!p) {
      const ext = kind === 'video' ? ['mp4', 'webm', 'mov', 'm4v'] : ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'];
      const r = await dialog.showOpenDialog(win, { title: kind === 'video' ? 'Choose a video' : 'Choose a picture', properties: ['openFile'], filters: [{ name: kind === 'video' ? 'Videos' : 'Pictures', extensions: ext }] });
      if (r.canceled || !r.filePaths[0]) return null; p = r.filePaths[0];
    }
    return library.addAsset(id, p);
  },
  'library.saveThumb': (id, dataUrl) => { const ok = library.saveThumb(id, dataUrl); if (ok) notifyLibrary(true); return ok; },
  'library.reveal': (id) => { const d = library.dirOf(id); if (d) shell.openPath(d); return true; },
  'library.openFolder': () => shell.openPath(userWallpapers()),
  'apply': (id, displayKey) => apply(id, displayKey || null),
  'host.status': () => host.status(),
  'host.pause': (v) => { const p = host.setUserPaused(v); refreshTray(); return p; },
  'host.reload': () => { for (const r of host.recs.values()) if (r.wallpaperId) host.load(r, r.wallpaperId); return true; },
  'favorite': (id, on) => { const f = new Set(store.get().favorites || []); on ? f.add(id) : f.delete(id); setSettings({ favorites: [...f] }); return [...f]; },
  'library.thumb': async (id) => { const r = await renderPreview({ id, width: 560, height: 350, wait: 0.9 }); library.saveThumb(id, 'data:image/jpeg;base64,' + r.jpeg.toString('base64')); notifyLibrary(true); return library.thumbUrl(id); },
  'ai.status': () => connectors.connectorStatus(),
  'ai.connect': async (which) => (which === 'desktop' ? connectors.connectDesktop() : which === 'code' ? connectors.connectCode() : connectors.connectCodex()),
  'ai.ask': async (prompt, provider) => {
    if (asking) throw new Error('Already working on something');
    connectors.installScript(); const entry = connectors.connectorStatus().entry; const ctl = new AbortController(); asking = ctl;
    try { return await ai.askAgent({ prompt: String(prompt || ''), entry, provider, cwd: path.join(app.getPath('userData'), 'ask'), signal: ctl.signal, onEvent: (ev) => send('ask', ev) }); }
    finally { asking = null; }
  },
  'ai.stop': () => { if (asking) asking.abort(); return true; },
  // ------------------------------------------------------------------ widgets
  'widgets.types': () => widgets.types(),
  'widgets.state': () => widgetState(),
  'widgets.get': (type) => {
    const w = widgets.read(type); if (!w) return null; const files = {};
    try { for (const f of fs.readdirSync(w.dir)) if (/\.(html?|css|js|json|svg|txt|md)$/i.test(f) && f !== 'widget.json') files[f] = fs.readFileSync(path.join(w.dir, f), 'utf8'); } catch (_) {}
    return { type, builtin: w.builtin, manifest: w.manifest, files };
  },
  'widgets.add': (type, displayKey, opts) => {
    const d = screen.getAllDisplays().find((x) => String(x.id) === String(displayKey)) || screen.getPrimaryDisplay();
    const inst = widgets.add(type, String(d.id), d.bounds, opts || {}); layer.sync(); return inst;
  },
  'widgets.update': (id, patch) => { const i = widgets.update(id, patch || {}); if (patch && patch.display) layer.sync(); else layer.pushAll(); sendWidgets(); return i; },
  'widgets.remove': (id) => { widgets.remove(id); layer.sync(); sendWidgets(); return true; },
  'widgets.arrange': (on) => layer.setEditing(on),
  'widgets.save': (type, manifest, files) => { const t = widgets.saveType(type, manifest, files || {}); widgetThumbs.delete(t); layer.pushAll(); reloadWidgetFrames(t); sendWidgets(); return t; },
  'widgets.create': (name) => { const t = widgets.saveType(null, { name: name || 'My widget', description: '', size: { w: 280, h: 180 }, settings: [{ key: 'accent', label: 'Accent', type: 'color', default: '#8f80ff' }] }, { 'index.html': WIDGET_TEMPLATE }); sendWidgets(); return t; },
  'widgets.duplicate': (type) => { const w = widgets.read(type); const t = widgets.saveType(null, { ...w.manifest, name: w.manifest.name + ' copy' }, {}); const src = w.dir, dst = widgets.dirOf(t); for (const f of fs.readdirSync(src)) if (f !== 'widget.json') { const a = path.join(src, f); if (fs.statSync(a).isFile()) fs.writeFileSync(path.join(dst, f), fs.readFileSync(a)); } sendWidgets(); return t; },
  'widgets.removeType': async (type) => {
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Move to Trash', 'Cancel'], defaultId: 0, cancelId: 1, message: 'Move this widget to the Trash?', detail: 'It’s also taken off your desktop.' });
    if (r.response !== 0) return false; await widgets.removeType(type, (dir) => shell.trashItem(dir)); layer.sync(); sendWidgets(); return true;
  },
  'widgets.import': async (paths) => {
    if (!paths || !paths.length) { const r = await dialog.showOpenDialog(win, { title: 'Add widgets', properties: ['openFile', 'openDirectory', 'multiSelections'], filters: [{ name: 'Widgets', extensions: ['muralwidget', 'zip'] }, { name: 'All files', extensions: ['*'] }] }); if (r.canceled) return []; paths = r.filePaths; }
    const out = []; for (const p of paths) { try { out.push({ path: p, type: widgets.importPath(p) }); } catch (e) { out.push({ path: p, error: e.message }); } }
    sendWidgets(); return out;
  },
  'widgets.export': async (type) => {
    const w = widgets.read(type); if (!w) return null;
    const r = await dialog.showSaveDialog(win, { title: 'Export widget', defaultPath: path.join(app.getPath('downloads'), w.manifest.name.replace(/[\\/:*?"<>|]/g, '') + '.muralwidget'), filters: [{ name: 'Mural widget', extensions: ['muralwidget'] }] });
    if (r.canceled || !r.filePath) return null; widgets.exportType(type, r.filePath); shell.showItemInFolder(r.filePath); return r.filePath;
  },
  'widgets.reveal': (type) => { const d = widgets.dirOf(type); if (d) shell.openPath(d); return true; },
  'widgets.thumb': async (type) => {
    if (widgetThumbs.has(type)) return widgetThumbs.get(type);
    const r = await renderWidget({ type, wait: 1.4 }); const url = 'data:image/jpeg;base64,' + r.jpeg.toString('base64'); widgetThumbs.set(type, url); return url;
  },
  // a live preview inside the app (Widgets page editor): a temporary instance whose calls go through the same checks
  'widgets.temp': (type, settings, size) => { const w = widgets.read(type); if (!w) throw new Error('Unknown widget'); return widgets.temp(type, settings, size); },
  'widgets.call': (id, name, args) => { if (!String(id).startsWith('t')) throw new Error('Not allowed'); return layer.call(id, name, args || []); },
  'openExternal': (url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return true; }
};
// ---------------------------------------------------------------------------------------------------- offscreen previews
// Renders a wallpaper in a hidden offscreen window and returns a PNG: the plugin's preview tool and Library thumbnails.
const previewReports = new Map(); let previewSeq = 0, previewChain = Promise.resolve();
function renderPreview(opts) { const job = previewChain.then(() => doPreview(opts)); previewChain = job.catch(() => {}); return job; }
async function doPreview({ id, hour = null, cursor = null, click = null, width = 1280, height = null, wait = 1.5 }) {
  const w = library.read(id); if (!w) throw new Error('Unknown wallpaper ' + id);
  width = Math.round(Math.max(240, Math.min(2560, Number(width) || 1280))); height = Math.round(Math.max(150, Math.min(1600, Number(height) || width * 10 / 16)));
  const key = 'preview-' + (++previewSeq); previewReports.set(key, { error: null });
  const pw = new BrowserWindow({ show: false, width, height, useContentSize: true, frame: false, webPreferences: { offscreen: true, preload: path.join(__dirname, 'wallpaper-preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, additionalArguments: [`--mural-display=${key}`] } });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    pw.webContents.setFrameRate(30);
    await pw.loadURL('mural://app/wallpaper.html?preview=1');
    pw.webContents.send('wp:load', { id, manifest: w.manifest, base: `mural://wp/${id}/`, quality: { fps: 30, scale: 1 }, location: store.get().location, hour: hour == null ? null : Number(hour), showStats: false });
    await sleep(350);
    const total = Math.max(0.4, Math.min(10, Number(wait) || 1.5)) * 1000;
    if (cursor) pw.webContents.send('wp:pointer', { x: Number(cursor.x) || 0.5, y: Number(cursor.y) || 0.5, inside: true });
    if (click) { await sleep(Math.max(0, total - 450)); pw.webContents.send('wp:click', { x: Number(click.x) || 0.5, y: Number(click.y) || 0.5, button: 0 }); await sleep(380); }
    else await sleep(total);
    const info = await pw.webContents.executeJavaScript('(() => { const p = window.__muralPlayer && window.__muralPlayer(); return p ? { stats: p.stats(), sky: p.sky ? { phases: p.sky.phases, altitude: Math.round(p.sky.altitude * 10) / 10 } : null } : { stats: {} }; })()').catch(() => ({ stats: {} }));
    const img = await pw.webContents.capturePage();
    return { png: img.toPNG(), jpeg: img.toJPEG(84), size: img.getSize(), stats: info.stats || {}, sky: info.sky, error: previewReports.get(key).error };
  } finally { previewReports.delete(key); if (!pw.isDestroyed()) pw.destroy(); }
}

// widgets: offscreen render of one widget on a dark backdrop (plugin preview + gallery thumbnails)
const widgetThumbs = new Map();
async function renderWidget({ type, settings = null, w = null, h = null, wait = 1.5, style = null }) {
  const t = widgets.read(type); if (!t) throw new Error('Unknown widget ' + type);
  const inst = widgets.temp(type, settings, { w: w || t.manifest.size.w, h: h || t.manifest.size.h }, style);
  const key = 'preview-' + (++previewSeq); const pad = 28; const W = inst.w + pad * 2, H = inst.h + pad * 2;
  const pw = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, frame: false, backgroundColor: '#0e1220', webPreferences: { offscreen: true, preload: path.join(__dirname, 'widget-preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, additionalArguments: [`--mural-display=${key}`] } });
  const errors = []; pw.webContents.on('console-message', (e) => { if (e.level === 'error' || /Uncaught/.test(e.message || '')) errors.push(String(e.message || '').slice(0, 300)); });
  try {
    pw.webContents.setFrameRate(30);
    await pw.loadURL('mural://app/widgets.html?preview=1');
    await pw.webContents.insertCSS('html,body{background:radial-gradient(80% 90% at 30% 20%,#2a3563,#0b0e1a)!important}');
    pw.webContents.send('wl:layout', { display: key, editing: false, location: store.get().location, platform: process.platform, widgets: [{ ...inst, x: pad, y: pad, name: t.manifest.name, url: `mural://widget/${type}/${t.manifest.page}?i=${inst.id}`, permissions: t.manifest.permissions, resizable: false }] });
    await new Promise((r) => setTimeout(r, Math.max(0.5, Math.min(8, Number(wait) || 1.5)) * 1000));
    const img = await pw.webContents.capturePage();
    return { png: img.toPNG(), jpeg: img.toJPEG(86), size: img.getSize(), errors };
  } finally { widgets.dropTemp(inst.id); if (!pw.isDestroyed()) pw.destroy(); }
}
function widgetState() { return { types: widgets.types(), instances: widgets.instances(), layer: layer.status(), displays: screen.getAllDisplays().map((d, i) => ({ key: String(d.id), label: d.label || (d.id === screen.getPrimaryDisplay().id ? 'Main display' : `Display ${i + 1}`), bounds: d.bounds })) }; }
function sendWidgets() { send('widgets', widgetState()); }
function reloadWidgetFrames() { for (const L of layer.layers.values()) if (L.win && !L.win.isDestroyed()) L.win.webContents.reload(); }
const WIDGET_TEMPLATE = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="mural://app/widget-base.css">
<script src="mural://app/widget-sdk.js"></script>
<style>
  .w-pad { gap: 8px; justify-content: center; align-items: center; text-align: center; }
  #big { font: 200 44px/1 var(--display); color: var(--accent); }
  button { border: 0; border-radius: 99px; padding: 6px 14px; background: var(--fill2); }
</style></head>
<body><div class="w-pad"><div class="w-title">My widget</div><div id="big">0</div><button id="b">Count</button></div>
<script>
  // mural.settings, mural.storage, mural.on('pause'|'resume'|'settings'|'resize'|'sky') — see mural://app/widget-sdk.js
  let n = 0;
  mural.ready().then(async () => {
    document.documentElement.style.setProperty('--accent', mural.settings.accent || '#8f80ff');
    n = (await mural.storage.get('n')) || 0; big.textContent = n;
  });
  b.onclick = () => { n++; big.textContent = n; mural.storage.set('n', n); };
  mural.on('settings', (s) => document.documentElement.style.setProperty('--accent', s.accent || '#8f80ff'));
</script></body></html>
`;

let libTimer = 0;
function notifyLibrary(quiet) { clearTimeout(libTimer); libTimer = setTimeout(() => { send('library', library.list()); if (!quiet) refreshTray(); }, 60); }

ipcMain.handle('mural:call', async (e, name, ...args) => {
  if (!win || e.sender !== win.webContents) throw new Error('Not allowed');
  const fn = API[name]; if (!fn) throw new Error('Unknown call ' + name);
  return fn(...args);
});
// the widgets layer windows (and offscreen previews): every call is checked against the window it came from
const layerFor = (e, key) => { if (String(key).startsWith('preview-')) return true; const L = layer && layer.layers.get(String(key)); return !!(L && L.win && !L.win.isDestroyed() && L.win.webContents === e.sender); };
ipcMain.handle('wl:call', (e, key, id, name, args) => { if (!layerFor(e, key)) throw new Error('Not allowed'); const inst = widgets.instance(id); if (!inst || (!String(key).startsWith('preview-') && inst.display !== String(key))) throw new Error('Not allowed'); return layer.call(id, name, args || []); });
ipcMain.handle('wl:move', (e, key, id, rect) => { if (!layerFor(e, key)) throw new Error('Not allowed'); widgets.update(id, rect); sendWidgets(); return true; });
ipcMain.handle('wl:remove', (e, key, id) => { if (!layerFor(e, key)) throw new Error('Not allowed'); widgets.remove(id); layer.sync(); sendWidgets(); return true; });
ipcMain.handle('wl:settings', (e, key, id) => { if (!layerFor(e, key)) throw new Error('Not allowed'); if (layer.editing) layer.setEditing(false); createWindow('widgets'); setTimeout(() => send('widget-settings', id), 400); return true; });
ipcMain.handle('wl:done', (e, key) => { if (!layerFor(e, key)) throw new Error('Not allowed'); layer.setEditing(false); refreshTray(); sendWidgets(); return true; });
ipcMain.handle('wl:front', (e, key, id) => { if (!layerFor(e, key)) return false; const i = widgets.instance(id); if (i) { widgets.update(id, { z: Date.now() }); } return true; });
ipcMain.on('wp:stats', (_e, key, st) => host && host.onStats(key, st));
ipcMain.on('wp:error', (_e, key, msg) => { if (previewReports.has(key)) previewReports.get(key).error = msg; else if (host) host.onError(key, msg); });

// ---------------------------------------------------------------------------------------------------- Utility Suite link
function startLink() {
  if (E2E && !process.env.SUITELINK_DIR) return;
  try {
    const suitelink = require('./suitelink');
    link = suitelink.serve('mural', { version: app.getVersion(), calls: {
      list: () => library.list().map((w) => ({ id: w.id, name: w.name, type: w.type, tags: w.tags, builtin: w.builtin })),
      current: () => current(),
      apply: (id, displayKey) => apply(String(id), displayKey ? String(displayKey) : null),
      pause: () => { host.setUserPaused(true); refreshTray(); return current(); },
      resume: () => { host.setUserPaused(false); refreshTray(); return current(); },
      open: (page) => { createWindow(page || 'library'); return true; },
      arrangeWidgets: (on) => layer.setEditing(on !== false)
    } });
  } catch (e) { log('suite link failed', e.message); link = null; }
}

// ---------------------------------------------------------------------------------------------------- start
app.whenReady().then(async () => {
  schema = await import(pathToFileURL(path.join(RENDERER, 'runtime', 'schema.js')).href);
  store = new Store(app.getPath('userData'));
  library = new Library({ builtinDir: path.join(__dirname, 'builtin'), userDir: userWallpapers(), thumbDir: path.join(app.getPath('userData'), 'thumbs'), schema });
  registerProtocol();
  nativeTheme.themeSource = 'dark';
  let desktop;
  if (isWin && !E2E) { const { WinDesktop } = require('./platform/win'); desktop = new WinDesktop({ dataDir: app.getPath('userData'), screen, log }); }
  else if (isMac && !E2E) { const { MacDesktop } = require('./platform/mac'); desktop = new MacDesktop({ log }); }
  else { const { DemoDesktop } = require('./platform/demo'); desktop = new DemoDesktop(); }
  host = new Host({ electron: { app, BrowserWindow, screen, powerMonitor }, store, library, desktop, preload: path.join(__dirname, 'wallpaper-preload.js'), log, dataDir: app.getPath('userData') });
  host.on('state', () => { send('state', host.status()); });
  host.on('metrics', () => { send('state', host.status()); });
  host.on('applied', () => { refreshTray(); send('settings', store.get()); if (link) link.emit('changed', current()); });
  widgets = new Widgets({ builtinDir: path.join(__dirname, 'widgets'), userDir: path.join(userWallpapers(), 'Widgets'), dataDir: app.getPath('userData') });
  layer = new WidgetLayer({ electron: { app, BrowserWindow, screen }, widgets, host, desktop, store, preload: path.join(__dirname, 'widget-preload.js'), log });
  layer.on('changed', () => sendWidgets());
  layer.on('settings', (id) => { createWindow('widgets'); setTimeout(() => send('widget-settings', id), 400); });
  if (!E2E || process.env.MURAL_E2E_HOST) { host.start(); layer.start(); }
  buildTray(); startLink(); applyLogin();
  if (!E2E || process.env.MURAL_E2E_BRIDGE) {
    const handle = makeHandlers({ library, schema, apply, host, store, setSettings, preview: renderPreview, notify: () => notifyLibrary(), widgets, layer, renderWidget, sendWidgets, screen });
    connectors.startBridge(handle, (st) => send('bridge', st)); connectors.refreshInstalled();
    global.__muralHandle = handle;
  } else global.__muralHandle = makeHandlers({ library, schema, apply, host, store, setSettings, preview: renderPreview, notify: () => notifyLibrary(), widgets, layer, renderWidget, sendWidgets, screen });
  const hidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAsHidden;
  if (!hidden || store.get().firstRun) createWindow(store.get().firstRun ? 'library' : null);
  else if (isMac && app.dock) app.dock.hide();
  if (store.get().firstRun) store.set({ firstRun: false });
  if (E2E) require(E2E)({ app, win: () => win, host, store, library, API, createWindow, screen, BrowserWindow, widgets, layer });
});
app.on('second-instance', () => createWindow());
app.on('activate', () => createWindow());
app.on('window-all-closed', () => { /* keeps running in the tray */ if (E2E && !host?.started) app.quit(); });
let stopping = false;
app.on('before-quit', (e) => {
  quitting = true;
  if (stopping || !host) return;
  e.preventDefault(); stopping = true;
  try { if (link) link.close(); } catch (_) {}
  try { connectors.stopBridge(); } catch (_) {}
  try { layer && layer.stop(); } catch (_) {}
  Promise.race([host.stop(), new Promise((r) => setTimeout(r, 3000))]).finally(() => app.exit(0));
});
