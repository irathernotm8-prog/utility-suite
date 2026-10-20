'use strict';
const {app, BrowserWindow, ipcMain, dialog, nativeImage, nativeTheme, shell, protocol, net, Menu, clipboard, screen} = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const core = require('./lib/organizer');
const settings = require('./lib/settings');
const ai = require('./lib/ai');
const fsops = require('./lib/fsops');
const launch = require('./lib/launch');
const {History} = require('./lib/history');

const isMac = process.platform === 'darwin', isWin = process.platform === 'win32';
let win, history, prefsCache;
const pendingOpen = [];
const userData = () => app.getPath('userData');
const send = (ch, ...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };

protocol.registerSchemesAsPrivileged([{scheme: 'fdfile', privileges: {standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false, corsEnabled: false}}]);

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  const target = argv.slice(1).find(a => !a.startsWith('-') && path.isAbsolute(a));
  if (target) send('open-path', target);
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on('open-file', (e, p) => { e.preventDefault(); if (win) send('open-path', p); else pendingOpen.push(p); });

// ---------- window ----------
const themeColors = () => nativeTheme.shouldUseDarkColors ? {bg: '#1b1d1f', fg: '#e8eaeb'} : {bg: '#fbfbfa', fg: '#24292b'};
async function windowState() { try { return JSON.parse(await fs.readFile(path.join(userData(), 'window.json'), 'utf8')); } catch { return {}; } }
function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  fs.writeFile(path.join(userData(), 'window.json'), JSON.stringify({...b, maximized: win.isMaximized()})).catch(() => {});
}
async function createWindow() {
  const state = await windowState();
  const onScreen = state.width && screen.getAllDisplays().some(d => state.x >= d.bounds.x - 50 && state.y >= d.bounds.y - 50 && state.x < d.bounds.x + d.bounds.width && state.y < d.bounds.y + d.bounds.height);
  const c = themeColors();
  win = new BrowserWindow({
    icon: path.join(__dirname, 'build/icon.png'),
    width: onScreen ? state.width : 1240, height: onScreen ? state.height : 800,
    x: onScreen ? state.x : undefined, y: onScreen ? state.y : undefined,
    minWidth: 720, minHeight: 460, show: false,
    title: 'Fresh Desk',
    backgroundColor: isMac ? '#00000000' : c.bg,
    ...(isMac ? {titleBarStyle: 'hiddenInset', trafficLightPosition: {x: 16, y: 17}, vibrancy: 'sidebar', visualEffectState: 'followWindow'} : {}),
    ...(isWin ? {titleBarStyle: 'hidden', titleBarOverlay: {color: c.bg, symbolColor: c.fg, height: 46}} : {}),
    webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false},
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('resize', debounce(saveWindowState, 400)); win.on('move', debounce(saveWindowState, 400)); win.on('close', saveWindowState);
  // If the page process ever dies, bring the window back instead of leaving it blank.
  win.webContents.on('render-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') setTimeout(() => { if (!win.isDestroyed()) win.webContents.reload(); }, 300); });
  win.loadFile('renderer/index.html', {query: {platform: process.platform}});
}
nativeTheme.on('updated', () => {
  const c = themeColors();
  if (isWin && win) try { win.setTitleBarOverlay({color: c.bg, symbolColor: c.fg}); } catch {}
  send('theme', nativeTheme.shouldUseDarkColors);
});
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

app.whenReady().then(async () => {
  if (isMac) app.dock.setIcon(path.join(__dirname, 'build/icon.png'));
  protocol.handle('fdfile', req => {
    // fdfile://f/<encoded absolute path> — local previews (images, video, audio).
    const u = new URL(req.url);
    const p = decodeURIComponent(u.pathname.slice(1));
    const abs = isWin ? p : '/' + p.replace(/^\/+/, '');
    return net.fetch(pathToFileURL(abs).toString(), {headers: req.headers});
  });
  history = new History(userData(), p => shell.trashItem(p));
  prefsCache = await settings.loadPrefs(userData());
  nativeTheme.themeSource = prefsCache.theme;
  buildMenu();
  await createWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });

// ---------- menu (macOS); Windows/Linux use in-window shortcuts ----------
function buildMenu() {
  if (!isMac) { Menu.setApplicationMenu(null); return; }
  const cmd = (label, id, accelerator, extra = {}) => ({label, accelerator: accelerator || undefined, click: () => send('command', id), ...extra});
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {role: 'appMenu', submenu: [{role: 'about'}, {type: 'separator'}, cmd('Settings…', 'settings', 'Cmd+,'), {type: 'separator'}, {role: 'services'}, {type: 'separator'}, {role: 'hide'}, {role: 'hideOthers'}, {role: 'unhide'}, {type: 'separator'}, {role: 'quit'}]},
    {label: 'File', submenu: [cmd('New Tab', 'newTab', 'Cmd+T'), cmd('New Folder', 'newFolder', 'Cmd+Shift+N'), cmd('New Text File', 'newFile', 'Cmd+Alt+N'), {type: 'separator'}, cmd('Open', 'open', 'Cmd+O'), cmd('Open in Terminal', 'terminal', 'Ctrl+`'), cmd('Open in Editor', 'editor', 'Cmd+Shift+E'), cmd('Show in Finder', 'reveal', 'Cmd+Alt+R'), {type: 'separator'}, cmd('Rename', 'rename', ''), cmd('Duplicate', 'duplicate', 'Cmd+D'), cmd('Compress', 'compress', ''), cmd('Copy Path', 'copyPath', 'Cmd+Alt+C'), {type: 'separator'}, cmd('Move to Trash', 'trash', 'Cmd+Backspace', {registerAccelerator: false}), {type: 'separator'}, cmd('Close Tab', 'closeTab', 'Cmd+W')]},
    {label: 'Edit', submenu: [cmd('Undo', 'undo', 'Cmd+Z'), {role: 'redo'}, {type: 'separator'}, cmd('Cut', 'cut', 'Cmd+X'), cmd('Copy', 'copy', 'Cmd+C'), cmd('Paste', 'paste', 'Cmd+V'), cmd('Select All', 'selectAll', 'Cmd+A'), {type: 'separator'}, cmd('Find', 'find', 'Cmd+F'), cmd('Command Palette…', 'palette', 'Cmd+K')]},
    {label: 'View', submenu: [cmd('as List', 'viewList', 'Cmd+1'), cmd('as Grid', 'viewGrid', 'Cmd+2'), cmd('as Columns', 'viewColumns', 'Cmd+3'), {type: 'separator'}, cmd('Show Preview', 'togglePreview', 'Cmd+Shift+P'), cmd('Show Hidden Files', 'toggleHidden', 'Cmd+Shift+.'), {type: 'separator'}, cmd('Tidy This Folder', 'tidy', 'Cmd+Shift+Y'), {type: 'separator'}, {role: 'zoomIn'}, {role: 'zoomOut'}, {role: 'resetZoom'}, {type: 'separator'}, {role: 'togglefullscreen'}, ...(app.isPackaged ? [] : [{role: 'toggleDevTools'}])]},
    {label: 'Go', submenu: [cmd('Back', 'back', 'Cmd+['), cmd('Forward', 'forward', 'Cmd+]'), cmd('Enclosing Folder', 'up', 'Cmd+Up', {registerAccelerator: false}), {type: 'separator'}, cmd('Home', 'goHome', 'Cmd+Shift+H'), cmd('Desktop', 'goDesktop', 'Cmd+Shift+D'), cmd('Downloads', 'goDownloads', 'Cmd+Alt+L'), {type: 'separator'}, cmd('Go to Folder…', 'goto', 'Cmd+Shift+G')]},
    {role: 'windowMenu', submenu: [{role: 'minimize'}, {role: 'zoom'}, {type: 'separator'}, cmd('Next Tab', 'nextTab', 'Ctrl+Tab'), cmd('Previous Tab', 'prevTab', 'Ctrl+Shift+Tab'), {type: 'separator'}, {role: 'front'}]},
  ]));
}

// ---------- helpers ----------
const handle = (name, fn) => ipcMain.handle(name, (_e, ...args) => fn(...args));
const asPaths = v => { if (!Array.isArray(v) || !v.length || v.length > 5000 || v.some(p => typeof p !== 'string' || !path.isAbsolute(p))) throw Error('Nothing selected.'); return v; };
const asPath = v => { if (typeof v !== 'string' || !path.isAbsolute(v)) throw Error('Invalid location.'); return v; };

// ---------- explorer ----------
handle('init', async () => ({
  platform: process.platform, home: app.getPath('home'), sep: path.sep,
  dark: nativeTheme.shouldUseDarkColors, version: app.getVersion(),
  prefs: prefsCache, open: pendingOpen.splice(0),
  paths: Object.fromEntries(['home', 'desktop', 'documents', 'downloads'].map(k => [k, app.getPath(k)])),
}));
handle('places', async () => fsops.places(Object.fromEntries(['home', 'desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'].map(k => { try { return [k, app.getPath(k)]; } catch { return [k, null]; } }))));
handle('list', async (dir, opts) => fsops.list(asPath(dir), opts || {}));
handle('info', async p => fsops.info(asPath(p)));
handle('readText', async p => fsops.readText(asPath(p)));
handle('diskSpace', async p => fsops.diskSpace(asPath(p)));
handle('savePrefs', async value => { prefsCache = await settings.savePrefs(userData(), value); nativeTheme.themeSource = prefsCache.theme; return prefsCache; });
handle('launchers', async () => launch.available());

const jobs = new Map();
handle('folderSize', async (p, id) => {
  const job = {canceled: false}; jobs.set(id, job);
  try { return await fsops.folderSize(asPath(p), () => job.canceled); } finally { jobs.delete(id); }
});
handle('search', async (root, query, id, opts) => {
  const job = {canceled: false}; jobs.set(id, job);
  try { return await fsops.search(asPath(root), String(query || ''), {hidden: !!opts?.hidden, onBatch: b => send('search-batch', id, b), canceled: () => job.canceled}); }
  finally { jobs.delete(id); }
});
ipcMain.on('cancel', (_e, id) => { const j = jobs.get(id); if (j) j.canceled = true; });

handle('newFolder', async (dir, name) => { const p = await fsops.makeFolder(asPath(dir), name || 'untitled folder'); await history.record(`New folder “${path.basename(p)}”`, [{type: 'create', path: p}]); return p; });
handle('newFile', async (dir, name) => { const p = await fsops.makeFile(asPath(dir), name || 'untitled.txt'); await history.record(`New file “${path.basename(p)}”`, [{type: 'create', path: p}]); return p; });
handle('rename', async (from, name) => {
  const to = await fsops.rename(asPath(from), name);
  if (to !== from) await history.record(`Rename to “${path.basename(to)}”`, [{type: 'rename', from, to}]);
  return to;
});
handle('transfer', async (kind, sources, dest) => {
  if (!['move', 'copy'].includes(kind)) throw Error('Unknown operation.');
  const results = await fsops.transfer(kind, asPaths(sources), asPath(dest));
  const done = results.filter(r => r.ok && r.to);
  if (done.length) await history.record(`${kind === 'copy' ? 'Copy' : 'Move'} ${done.length === 1 ? '“' + path.basename(done[0].from) + '”' : done.length + ' items'}`,
    done.map(r => kind === 'copy' ? {type: 'create', path: r.to} : {type: 'move', from: r.from, to: r.to}));
  return results;
});
handle('duplicate', async sources => {
  const results = [];
  for (const p of asPaths(sources)) results.push(...await fsops.transfer('copy', [p], path.dirname(p)));
  const done = results.filter(r => r.ok);
  if (done.length) await history.record(`Duplicate ${done.length} item${done.length > 1 ? 's' : ''}`, done.map(r => ({type: 'create', path: r.to})));
  return results;
});
handle('trash', async paths => {
  const results = [];
  for (const p of asPaths(paths)) { try { await shell.trashItem(p); results.push({path: p, ok: true}); } catch (e) { results.push({path: p, ok: false, error: e.message}); } }
  return results;
});
handle('undo', async id => history.undo(id));
handle('history', async () => history.list());
handle('open', async p => { const err = await shell.openPath(asPath(p)); if (err) throw Error(err); });
handle('reveal', async p => shell.showItemInFolder(asPath(p)));
handle('terminal', async p => launch.openTerminal(asPath(p), prefsCache.terminal));
handle('editor', async p => launch.openInEditor(asPath(p), prefsCache.editor));
handle('openWith', async p => {
  asPath(p);
  if (isMac) {
    const r = await dialog.showOpenDialog(win, {title: 'Open With', defaultPath: '/Applications', properties: ['openFile'], filters: [{name: 'Applications', extensions: ['app']}]});
    if (r.canceled) return;
    return launch.openWith(p, r.filePaths[0]);
  }
  return launch.openWith(p);
});
handle('editCmd', async name => {
  if (name === 'zoomWindow') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); return; }
  if (['cut', 'copy', 'paste', 'undo', 'redo', 'selectAll'].includes(name)) win.webContents[name]();
});
handle('copyText', async text => clipboard.writeText(String(text)));
handle('compress', async paths => {
  asPaths(paths);
  const dir = path.dirname(paths[0]);
  const name = paths.length === 1 ? `${path.basename(paths[0])}.zip` : 'Archive.zip';
  const dest = await fsops.uniquePath(dir, name);
  await launch.compress(paths, dest);
  await history.record(`Compress to “${path.basename(dest)}”`, [{type: 'create', path: dest}]);
  return dest;
});
handle('extract', async p => {
  const dest = await fsops.uniquePath(path.dirname(asPath(p)), path.basename(p).replace(/\.zip$/i, ''));
  await launch.extract(p, dest);
  await history.record(`Extract “${path.basename(p)}”`, [{type: 'create', path: dest}]);
  return dest;
});
handle('chooseFolder', async () => { const r = await dialog.showOpenDialog(win, {properties: ['openDirectory', 'createDirectory']}); return r.canceled ? null : r.filePaths[0]; });
handle('confirm', async (message, detail, ok) => (await dialog.showMessageBox(win, {type: 'warning', buttons: ['Cancel', ok || 'OK'], defaultId: 1, cancelId: 0, message, detail})).response === 1);

// Thumbnails & icons, cached by path + modification time.
const thumbCache = new Map();
function remember(key, value) { thumbCache.set(key, value); if (thumbCache.size > 800) thumbCache.delete(thumbCache.keys().next().value); return value; }
handle('thumb', async (p, size = 256, mtime = 0) => {
  const key = `${p}|${size}|${mtime}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  let img = null;
  try {
    if (/\.(app|photoslibrary|musiclibrary|framework|bundle)$/i.test(p)) return null;
    if (isMac || isWin) img = await nativeQueue(() => nativeImage.createThumbnailFromPath(p, {width: size, height: size}));
    else if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(p)) { img = nativeImage.createFromPath(p); if (!img.isEmpty()) { const s = img.getSize(); const k = size / Math.max(s.width, s.height); if (k < 1) img = img.resize({width: Math.round(s.width * k), height: Math.round(s.height * k), quality: 'good'}); } }
  } catch { img = null; }
  return remember(key, img && !img.isEmpty() ? img.toDataURL() : null);
});
// Native image work runs a few at a time; flooding it froze or crashed macOS builds.
function queue(limit) {
  let active = 0; const waiting = [];
  const next = () => { if (active >= limit || !waiting.length) return; active++; const {fn, resolve} = waiting.shift(); Promise.resolve().then(fn).then(resolve, () => resolve(null)).finally(() => { active--; next(); }); };
  return fn => new Promise(resolve => { waiting.push({fn, resolve}); next(); });
}
const nativeQueue = queue(3);
// App icons. macOS: app.getFileIcon crashes Electron 44 (a CHECK on a worker thread), so read the
// bundle's .icns with the system's plutil + sips instead and cache the PNG in app-data.
async function macAppIcon(appPath) {
  if (!/\.app$/i.test(appPath)) return null;
  const st = await fs.stat(appPath);
  const cacheDir = path.join(userData(), 'app-icons');
  const out = path.join(cacheDir, crypto.createHash('sha1').update(`${appPath}|${st.mtimeMs}`).digest('hex') + '.png');
  try { await fs.access(out); return nativeImage.createFromPath(out).toDataURL(); } catch {}
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  let name = '';
  try { name = (await launch.run('/usr/bin/plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', plist], {timeout: 5000})).trim(); } catch {}
  if (!name) return null;
  if (!/\.icns$/i.test(name)) name += '.icns';
  const icns = path.join(appPath, 'Contents', 'Resources', name);
  try { await fs.access(icns); } catch { return null; }
  await fs.mkdir(cacheDir, {recursive: true});
  await launch.run('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '128', icns, '--out', out], {timeout: 10000});
  const img = nativeImage.createFromPath(out);
  return img.isEmpty() ? null : img.toDataURL();
}
handle('icon', async (p, size = 'normal') => {
  const key = `icon|${p}|${size}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const src = await nativeQueue(async () => {
    if (isMac) return macAppIcon(asPath(p));
    const img = await app.getFileIcon(asPath(p), {size});
    return img.isEmpty() ? null : img.toDataURL();
  });
  return remember(key, src || null);
});
const dragIcon = () => nativeImage.createFromPath(path.join(__dirname, 'build/icon.png')).resize({width: 40, height: 40});
ipcMain.on('startDrag', (e, paths) => { try { e.sender.startDrag({files: asPaths(paths), icon: dragIcon()}); } catch {} });

// Watch the folders on screen and tell the renderer when they change.
const watchers = new Map();
handle('watch', async dirs => {
  const want = new Set((Array.isArray(dirs) ? dirs : []).filter(d => typeof d === 'string').slice(0, 12));
  for (const [d, w] of watchers) if (!want.has(d)) { w.close(); watchers.delete(d); }
  for (const d of want) {
    if (watchers.has(d)) continue;
    try {
      const notify = debounce(() => send('dir-changed', d), 180);
      const w = fsSync.watch(d, {persistent: false}, notify);
      w.on('error', () => { w.close(); watchers.delete(d); });
      watchers.set(d, w);
    } catch {}
  }
});

// Native context menu built from the renderer's item list.
handle('menu', async items => new Promise(resolve => {
  let chosen = null;
  const build = list => list.map(it => it.type === 'separator' ? {type: 'separator'} : {label: it.label, enabled: it.enabled !== false, accelerator: it.accel || undefined, registerAccelerator: false, type: it.checked !== undefined ? 'checkbox' : 'normal', checked: !!it.checked, ...(it.submenu ? {submenu: build(it.submenu)} : {click: () => { chosen = it.id; }})});
  Menu.buildFromTemplate(build(items)).popup({window: win, callback: () => setTimeout(() => resolve(chosen), 0)});
}));

// ---------- Tidy (organizer) ----------
let plan = null, busy = false, cancelScan = false, aiRequest = null, aiProposals = [];
const locked = fn => async (...args) => { if (busy) throw Error('Another Tidy operation is running.'); busy = true; try { return await fn(...args); } finally { busy = false; } };
handle('tidyScan', locked(async (root, options) => {
  plan = null; aiRequest = null; aiProposals = []; cancelScan = false;
  const saved = await settings.load(userData());
  const profile = saved.profiles.find(p => p.id === options.profile);
  plan = await core.scan(asPath(root), {...options, rules: profile?.rules || []}, async p => nativeImage.createFromPath(p).getSize(), status => send('scan-progress', status), () => cancelScan);
  return plan;
}));
ipcMain.on('cancel-scan', () => { cancelScan = true; });
handle('tidyApply', locked(async ids => {
  if (!plan) throw Error('Preview again first.');
  const batch = await history.begin(`Tidy “${path.basename(plan.root)}”`, 'tidy');
  const results = await core.apply(plan, ids, batch.ops, () => history.save());
  await history.commit(batch);
  plan = null;
  return results;
}));
handle('tidyTrash', locked(async (ids, dirs) => {
  if (!plan) throw Error('Preview again first.');
  const rows = plan.rows.filter(r => (ids || []).includes(r.id) && !(r.keep && r.source === 'protected'));
  const empty = (dirs || []).filter(d => plan.emptyDirs.includes(d));
  const total = rows.length + empty.length;
  if (!total) throw Error('Select files to move to the Trash.');
  const answer = await dialog.showMessageBox(win, {type: 'warning', buttons: ['Cancel', 'Move to Trash'], defaultId: 0, cancelId: 0, message: `Move ${total} item${total > 1 ? 's' : ''} to the Trash?`, detail: 'You can put them back from the Trash (Recycle Bin on Windows).'});
  if (answer.response !== 1) return [];
  const results = [];
  for (const row of rows) { try { await core.validate(row.from, row.fingerprint); await shell.trashItem(row.from); results.push({name: row.name, ok: true}); } catch (e) { results.push({name: row.name, ok: false, error: e.message}); } }
  for (const d of empty) { try { const inner = await fs.readdir(d); if (inner.some(n => !['.DS_Store', 'Thumbs.db', 'desktop.ini'].includes(n))) throw Error('No longer empty'); await shell.trashItem(d); results.push({name: path.basename(d), ok: true}); } catch (e) { results.push({name: path.basename(d), ok: false, error: e.message}); } }
  plan = null; return results;
}));
handle('profiles', locked(async () => settings.load(userData())));
handle('saveProfiles', locked(async value => { const r = await settings.save(userData(), value); plan = null; aiRequest = null; aiProposals = []; return r; }));
handle('revise', locked(async changes => {
  if (!plan) throw Error('Preview again first.');
  if (!Array.isArray(changes) || changes.length > 5000) throw Error('Invalid corrections.');
  const updated = await core.revise(plan, changes); aiRequest = null; aiProposals = []; return updated;
}));
handle('assistStatus', locked(async () => ai.assistStatus(app.getPath('appData'))));
handle('aiPreview', locked(async input => {
  if (!plan) throw Error('Preview again first.');
  const payload = ai.prepare(plan, input.ids, input.goal, !!input.includeContent);
  aiRequest = {ticket: crypto.randomUUID(), payload, expires: Date.now() + 10 * 60 * 1000}; aiProposals = [];
  return {ticket: aiRequest.ticket, payload};
}));
handle('aiRun', locked(async input => {
  if (!plan || !aiRequest || input.ticket !== aiRequest.ticket || Date.now() > aiRequest.expires) throw Error('AI preview expired. Review the request again.');
  const payload = aiRequest.payload; aiRequest = null;
  aiProposals = await ai.complete(input.provider, input.config || {}, payload, app.getPath('appData'));
  return aiProposals.map(p => ({...p, name: plan.rows.find(r => r.id === p.id)?.name}));
}));
handle('acceptAI', locked(async ids => {
  if (!plan) throw Error('Preview again first.');
  const proposals = aiProposals.filter(p => ids.includes(p.proposalId));
  if (!proposals.length) throw Error('Select a suggestion first.');
  await core.revise(plan, proposals);
  for (const p of proposals) { const row = plan.rows.find(r => r.id === p.id); row.source = 'ai'; row.confidence = 'review'; row.reason = `AI (${Math.round(p.confidence * 100)}% self-rated): ${p.reason}`; }
  aiProposals = []; return plan;
}));
