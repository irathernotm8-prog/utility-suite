// Docket — main process. Owns files, settings, AI calls, meeting detection, the tray and the floating bar.
// Recording and transcription run in the main window (it has the audio APIs and the GPU); this side never sees audio except to save it.
const { app, BrowserWindow, ipcMain, nativeTheme, nativeImage, dialog, shell, protocol, session, desktopCapturer,
  systemPreferences, Menu, Tray, Notification, globalShortcut, screen, safeStorage, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const { Store, toMarkdown } = require('./store');
const ai = require('./ai');
const detect = require('./detect');

protocol.registerSchemesAsPrivileged([
  { scheme: 'docket', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }
]);
if (process.env.DOCKET_USER_DATA) app.setPath('userData', process.env.DOCKET_USER_DATA);
// System audio ("loopback") on macOS comes through ScreenCaptureKit; these switch it on in Chromium.
app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');
if (process.env.DOCKET_FAKE_AUDIO) { // tests: a WAV file stands in for the microphone
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.DOCKET_FAKE_AUDIO);
}
if (!app.requestSingleInstanceLock()) app.quit();

const isMac = process.platform === 'darwin', isWin = process.platform === 'win32';
const RENDERER = path.join(__dirname, 'renderer'), VENDOR = path.join(__dirname, 'vendor');
let win = null, bar = null, tray = null, store = null, watcher = null;
let quitting = false, wantQuit = false, toldHidden = false;
let rec = { recording: false, paused: false, elapsed: 0, line: '', meetingId: null, title: '', levels: [0, 0] };

// ---------------------------------------------------------------- settings
const DEFAULTS = {
  theme: 'system', myName: 'You', model: 'balanced', language: 'en', device: 'auto',
  micId: 'default', captureSystem: true, keepAudio: true, floatingBar: true,
  aiProvider: 'claude-cli', aiModel: '', cliModel: '', autoSummary: true,
  watch: 'notify', shortcut: 'CommandOrControl+Shift+Alt+D', barPos: null, onboarded: false, modelReady: {},
  home: ''
};
let S = null;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function settings() {
  if (!S) { try { S = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch (_) { S = { ...DEFAULTS }; } }
  return S;
}
function saveSettings(patch) {
  S = { ...settings(), ...patch };
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(S, null, 1)); } catch (_) {}
  return S;
}
const publicSettings = () => { const s = { ...settings() }; const hasKey = !!s.keyEnc || !!s.keyPlain; delete s.keyEnc; delete s.keyPlain; return { ...s, hasKey }; };
function getKey() {
  const s = settings();
  if (s.keyEnc && safeStorage.isEncryptionAvailable()) { try { return safeStorage.decryptString(Buffer.from(s.keyEnc, 'base64')); } catch (_) {} }
  return s.keyPlain || '';
}
function setKey(k) {
  k = String(k || '').trim();
  if (!k) return saveSettings({ keyEnc: null, keyPlain: null });
  if (safeStorage.isEncryptionAvailable()) return saveSettings({ keyEnc: safeStorage.encryptString(k).toString('base64'), keyPlain: null });
  return saveSettings({ keyPlain: k, keyEnc: null });
}
const homeDir = () => process.env.DOCKET_HOME || settings().home || path.join(app.getPath('documents'), 'Docket');
const aiCfg = () => { const s = settings(); return { provider: s.aiProvider, key: getKey(), model: s.aiModel || undefined, cliModel: s.cliModel || undefined, myName: s.myName }; };

// ---------------------------------------------------------------- protocol
// docket://app/...        the window's files (and /vendor/ for the speech engine)
// docket://data/<id>/<f>  a meeting's audio, with byte ranges so the player can seek
const MIME = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', wasm: 'application/wasm', png: 'image/png', svg: 'image/svg+xml', json: 'application/json',
  webm: 'audio/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', wav: 'audio/wav', ogg: 'audio/ogg', mov: 'video/quicktime', aac: 'audio/aac', flac: 'audio/flac', mkv: 'video/x-matroska' };
const ISOLATE = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-origin' };
function within(base, rel) {
  const p = path.normalize(path.join(base, rel));
  if (!p.startsWith(base + path.sep)) throw new Error('outside');
  return p;
}
function registerProtocol() {
  protocol.handle('docket', async (req) => {
    try {
      const u = new URL(req.url);
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      if (u.host === 'app') {
        const file = rel.startsWith('vendor/') ? within(VENDOR, rel.slice(7)) : within(RENDERER, rel || 'index.html');
        const data = await fs.promises.readFile(file);
        return new Response(data, { headers: { 'content-type': MIME[file.split('.').pop()] || 'application/octet-stream', ...ISOLATE, 'cache-control': 'no-cache' } });
      }
      if (u.host === 'data') {
        const [id, name] = rel.split('/');
        const file = store.file(id, name);
        if (!/^audio\.[a-z0-9]+$/.test(name)) throw new Error('not audio');
        const st = await fs.promises.stat(file);
        const type = MIME[name.split('.').pop()] || 'application/octet-stream';
        const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
        const base = { 'content-type': type, 'accept-ranges': 'bytes', ...ISOLATE };
        if (!range) return new Response(fs.createReadStream(file), { headers: { ...base, 'content-length': String(st.size) } });
        let start = range[1] ? +range[1] : st.size - +range[2], end = range[1] && range[2] ? +range[2] : st.size - 1;
        if (!range[1] && range[2]) end = st.size - 1;
        start = Math.max(0, Math.min(start, st.size - 1)); end = Math.max(start, Math.min(end, st.size - 1));
        return new Response(fs.createReadStream(file, { start, end }), { status: 206, headers: { ...base, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${st.size}` } });
      }
    } catch (_) {}
    return new Response('Not found', { status: 404 });
  });
}

// ---------------------------------------------------------------- audio capture
function registerMedia() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write'].includes(perm)));
  ses.setPermissionCheckHandler((wc, perm) => ['media', 'display-capture', 'notifications', 'clipboard-sanitized-write'].includes(perm));
  // The window asks for "the screen with sound"; we hand back the main screen plus system audio. The video track is dropped right away.
  ses.setDisplayMediaRequestHandler(async (_req, cb) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      if (!sources.length) return cb({});
      cb(isMac || isWin ? { video: sources[0], audio: 'loopback' } : { video: sources[0] });
    } catch (_) { cb({}); }
  }, { useSystemPicker: false });
}
function permissions() {
  if (!isMac) return { mic: 'granted', screen: 'granted' };
  return { mic: systemPreferences.getMediaAccessStatus('microphone'), screen: systemPreferences.getMediaAccessStatus('screen') };
}

// ---------------------------------------------------------------- commands into the window (with a user gesture, so capture can start)
function command(cmd, arg) {
  if (!win || win.isDestroyed()) createWindow();
  const run = () => win.webContents.executeJavaScript(`window.docket && window.docket.command(${JSON.stringify(cmd)}, ${JSON.stringify(arg ?? null)})`, true).catch(() => {});
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(run, 300)); else run();
}
function showWin() { if (!win || win.isDestroyed()) createWindow(); else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } }
function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  if (onClick) n.on('click', onClick);
  n.show();
}

// ---------------------------------------------------------------- meeting detection
function startWatcher() {
  if (watcher) watcher.stop();
  watcher = null;
  if (settings().watch === 'off') return;
  if (isMac && systemPreferences.getMediaAccessStatus('screen') !== 'granted') return; // never prompt from the background
  watcher = detect.makeWatcher({
    list: async () => (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })).map((s) => s.name),
    onStart: (m) => {
      if (rec.recording) return;
      send('detected', m);
      if (settings().watch === 'auto') { command('start', { app: m.app, title: m.title, auto: true }); notify('Docket is taking notes', `${m.app} call detected. Stop any time from the floating bar.`, showWin); }
      else notify(`${m.app} call started`, 'Click to have Docket take notes.', () => { showWin(); command('start', { app: m.app, title: m.title }); });
    },
    onEnd: (m) => {
      send('detected', null);
      if (!rec.recording) return;
      if (settings().watch === 'auto' && rec.auto) command('stop', { reason: 'ended' });
      else notify('Did the call end?', 'Click to stop and summarize your notes.', () => { showWin(); command('stop'); });
    }
  });
  watcher.start();
}
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send('docket:' + ch, data); };

// ---------------------------------------------------------------- tray + floating bar
function trayImage(recording) {
  if (isMac) {
    const img = nativeImage.createFromPath(path.join(__dirname, 'assets', recording ? 'trayRecTemplate.png' : 'trayTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', recording ? 'tray-rec.png' : 'tray.png'));
  return img.isEmpty() ? nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 16, height: 16 }) : img;
}
function updateTray() {
  if (!tray) return;
  tray.setImage(trayImage(rec.recording));
  tray.setToolTip(rec.recording ? `Docket — taking notes (${fmt(rec.elapsed)})` : 'Docket');
  tray.setContextMenu(Menu.buildFromTemplate([
    rec.recording
      ? { label: rec.paused ? 'Resume' : 'Pause', click: () => command(rec.paused ? 'resume' : 'pause') }
      : { label: 'Start Taking Notes', accelerator: settings().shortcut, click: () => command('start') },
    ...(rec.recording ? [{ label: 'Stop & Summarize', click: () => command('stop') }, { label: 'Mark This Moment', click: () => command('mark') }] : []),
    { type: 'separator' },
    { label: 'Open Docket', click: showWin },
    { label: 'To-dos', click: () => { showWin(); command('view', 'todos'); } },
    { type: 'separator' },
    { label: 'Quit Docket', click: () => { wantQuit = true; app.quit(); } }
  ]));
}
const fmt = (s) => { s = Math.floor(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
function createTray() {
  if (tray) return;
  try { tray = new Tray(trayImage(false)); } catch (_) { tray = null; return; }
  if (!isMac) tray.on('click', showWin);
  updateTray();
}
function openBar() {
  if (bar && !bar.isDestroyed()) { bar.showInactive(); return; }
  const wa = screen.getPrimaryDisplay().workArea;
  const W = 420, H = 56;
  const pos = settings().barPos;
  const onScreen = pos && screen.getAllDisplays().some((d) => pos.x >= d.bounds.x - 50 && pos.x < d.bounds.x + d.bounds.width && pos.y >= d.bounds.y - 10 && pos.y < d.bounds.y + d.bounds.height);
  bar = new BrowserWindow({
    width: W, height: H, x: onScreen ? pos.x : Math.round(wa.x + (wa.width - W) / 2), y: onScreen ? pos.y : wa.y + 14,
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false, hasShadow: false,
    fullscreenable: false, minimizable: false, maximizable: false, focusable: true, ...(isMac ? { type: 'panel' } : {}),
    webPreferences: { preload: path.join(__dirname, 'bar-preload.js'), contextIsolation: true, sandbox: true }
  });
  bar.setAlwaysOnTop(true, 'floating');
  if (isMac) bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bar.on('moved', () => { const [x, y] = bar.getPosition(); saveSettings({ barPos: { x, y } }); });
  bar.on('closed', () => { bar = null; });
  bar.loadURL('docket://app/bar.html');
  bar.once('ready-to-show', () => { bar.showInactive(); sendBar(); });
}
function closeBar() { if (bar && !bar.isDestroyed()) bar.close(); bar = null; }
const sendBar = () => { if (bar && !bar.isDestroyed()) bar.webContents.send('bar:state', rec); };
function syncBar() {
  const want = rec.recording && settings().floatingBar && !(win && !win.isDestroyed() && win.isVisible() && win.isFocused());
  if (want) openBar(); else if (bar && !bar.isDestroyed()) bar.hide();
  sendBar();
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  const acc = settings().shortcut;
  if (!acc) return true;
  try { return globalShortcut.register(acc, () => command(rec.recording ? 'stop' : 'start')); } catch (_) { return false; }
}

// ---------------------------------------------------------------- IPC
const h = (name, fn) => ipcMain.handle('docket:' + name, async (_e, ...a) => {
  try { return { ok: true, data: await fn(...a) }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});
// For questions across meetings: the meetings that share the most words with the question, else the latest few.
const STOP = new Set('what when where which who whom whose why how that this with from have were will would could should about there their they them then than into your yours mine also just been being does did done said meeting meetings call calls talk talked'.split(' '));
function pickMeetings(q) {
  const words = [...new Set((String(q).toLowerCase().match(/[a-z0-9']{3,}/g) || []).filter((w) => !STOP.has(w)))].slice(0, 8);
  const score = new Map();
  for (const w of words) for (const r of store.search(w)) score.set(r.id, (score.get(r.id) || 0) + 1);
  const ids = [...score].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  return (ids.length ? ids : store.list().map((m) => m.id)).slice(0, 5);
}
const safeName = (s) => String(s || 'Meeting').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Meeting';

function registerIpc() {
  h('bootstrap', () => ({
    settings: publicSettings(), platform: process.platform, version: app.getVersion(), home: store.root,
    meetings: store.list(), todos: store.todos(), permissions: permissions(), detected: watcher && watcher.current, shortcutOk: registerShortcut(),
    providers: Object.fromEntries(Object.entries(ai.PROVIDERS).map(([k, v]) => [k, v.label]))
  }));
  h('settings:set', (patch) => {
    patch = { ...(patch || {}) };
    if ('key' in patch) { setKey(patch.key); delete patch.key; }
    const allowed = Object.keys(DEFAULTS).filter((k) => k !== 'home');
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
    saveSettings(clean);
    if ('theme' in clean) nativeTheme.themeSource = ['light', 'dark'].includes(clean.theme) ? clean.theme : 'system';
    let shortcutOk = true;
    if ('shortcut' in clean) shortcutOk = registerShortcut();
    if ('watch' in clean) startWatcher();
    if ('shortcut' in clean) updateTray();
    if ('floatingBar' in clean) syncBar();
    return { settings: publicSettings(), shortcutOk };
  });

  h('meetings', () => store.list());
  h('meeting:create', (init) => store.create({ ...(init || {}), myName: settings().myName }));
  h('meeting:load', (id) => store.load(id));
  h('meeting:save', (m) => store.save(m));
  h('meeting:delete', async (id) => { const d = store.dir(id); try { await shell.trashItem(d); } catch (_) {} store.remove(id); return store.todos(); });
  h('meeting:search', (q) => store.search(q));
  h('meeting:reveal', (id) => shell.showItemInFolder(path.join(store.dir(id), 'notes.md')));
  h('meeting:export', async (id) => {
    const m = store.load(id);
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), safeName(m.title) + '.md'), filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, toMarkdown(m, store.todos().filter((t) => t.meetingId === id)));
    return r.filePath;
  });
  h('meeting:copy', (id) => { const m = store.load(id); clipboard.writeText(toMarkdown(m, store.todos().filter((t) => t.meetingId === id))); return true; });

  h('audio:append', (id, bytes) => store.appendAudio(id, bytes));
  h('audio:finish', (id, ms) => store.finishAudio(id, ms));
  h('audio:remove', (id) => store.removeAudio(id));

  h('import:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Transcribe a recording', properties: ['openFile'], filters: [{ name: 'Audio or video', extensions: ['mp3', 'm4a', 'wav', 'webm', 'mp4', 'mov', 'ogg', 'aac', 'flac', 'mkv'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  // Copies the file into the meeting (so it plays later) and hands the bytes to the window to decode.
  h('import:read', async (id, file) => {
    const ext = path.extname(file).slice(1).toLowerCase();
    if (!MIME[ext]) throw new Error('That file type is not supported.');
    const st = fs.statSync(file);
    if (st.size > 2 * 1024 * 1024 * 1024) throw new Error('That file is over 2 GB.');
    const name = 'audio.' + ext;
    if (settings().keepAudio) await fs.promises.copyFile(file, store.file(id, name));
    const buf = await fs.promises.readFile(file);
    return { bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), name: settings().keepAudio ? name : null, title: path.basename(file).replace(/\.[^.]+$/, ''), mtime: st.mtimeMs };
  });
  h('import:path', (p) => (fs.existsSync(String(p)) ? String(p) : null));

  h('todos', () => store.todos());
  h('todos:add', (items) => store.addTodos(items));
  h('todos:update', (id, patch) => store.updateTodo(id, patch));
  h('todos:delete', (ids) => store.deleteTodos(ids));

  h('ai:summarize', async (id) => {
    const m = store.load(id);
    const summary = await ai.summarize(m, aiCfg());
    const made = store.replaceAiTodos(id, summary.actionItems);
    summary.at = Date.now(); summary.provider = settings().aiProvider;
    return { summary, todos: store.todos(), added: made.length };
  });
  h('ai:ask', async ({ question, history, meetingIds }) => {
    let ids = meetingIds;
    if (!ids || !ids.length) ids = pickMeetings(question);
    const meetings = ids.slice(0, 6).map((i) => { try { return store.load(i); } catch (_) { return null; } }).filter(Boolean);
    const answer = await ai.ask({ question, history, meetings, myName: settings().myName }, aiCfg());
    return { answer, used: meetings.map((m) => ({ id: m.id, title: m.title })) };
  });
  h('ai:detect', (provider) => ai.detect(provider));

  h('perm:mic', async () => (isMac ? systemPreferences.askForMediaAccess('microphone') : true));
  h('perm:status', () => permissions());
  h('perm:open', (kind) => {
    if (isMac) return shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?Privacy_${kind === 'mic' ? 'Microphone' : 'ScreenCapture'}`);
    if (isWin) return shell.openExternal(kind === 'mic' ? 'ms-settings:privacy-microphone' : 'ms-settings:privacy');
  });
  // macOS only asks for Screen & System Audio Recording once something tries to capture; this does that on purpose.
  h('perm:requestScreen', async () => { try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }); } catch (_) {} return permissions(); });

  h('window:chrome', (bg, fg) => { if (!isMac && win && win.setTitleBarOverlay) { try { win.setTitleBarOverlay({ color: bg, symbolColor: fg, height: 44 }); } catch (_) {} } });
  h('open', (url) => { if (/^https?:\/\//.test(String(url))) return shell.openExternal(url); });
  h('home:open', () => shell.openPath(store.root));
  h('notify', (title, body) => notify(String(title), String(body), showWin));
  h('watch:restart', () => { startWatcher(); return !!watcher; });

  ipcMain.on('docket:rec', (_e, state) => {
    const was = rec.recording;
    rec = { ...rec, ...state };
    if (was !== rec.recording) { updateTray(); if (!rec.recording) { closeBar(); toldHidden = false; } }
    syncBar();
    if (tray && rec.recording) tray.setToolTip(`Docket — taking notes (${fmt(rec.elapsed)})`);
  });
  ipcMain.on('docket:flushed', () => finishClose());
  ipcMain.on('bar:cmd', (_e, cmd) => { if (cmd === 'open') showWin(); else command(cmd); });
}

// ---------------------------------------------------------------- menu + window
function buildMenu() {
  const go = (cmd, arg) => () => { showWin(); command(cmd, arg); };
  const tpl = [
    ...(isMac ? [{ label: 'Docket', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: go('view', 'settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { label: 'Quit Docket', accelerator: 'Cmd+Q', click: () => { wantQuit = true; app.quit(); } }] }] : []),
    { label: 'File', submenu: [
      { label: 'Start Taking Notes', accelerator: 'CmdOrCtrl+R', click: go('start') },
      { label: 'Stop & Summarize', accelerator: 'CmdOrCtrl+.', click: go('stop') },
      { label: 'Mark This Moment', accelerator: 'CmdOrCtrl+M', click: go('mark') },
      { type: 'separator' },
      { label: 'Transcribe a Recording…', accelerator: 'CmdOrCtrl+O', click: go('import') },
      { label: 'Export Notes…', accelerator: 'CmdOrCtrl+E', click: go('export') },
      { label: 'Open Notes Folder', click: () => shell.openPath(store.root) },
      ...(isMac ? [] : [{ type: 'separator' }, { label: 'Settings', accelerator: 'Ctrl+,', click: go('view', 'settings') }, { label: 'Quit', click: () => { wantQuit = true; app.quit(); } }])
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Meetings', accelerator: 'CmdOrCtrl+1', click: go('view', 'home') },
      { label: 'To-dos', accelerator: 'CmdOrCtrl+2', click: go('view', 'todos') },
      { label: 'Ask Your Meetings', accelerator: 'CmdOrCtrl+3', click: go('view', 'ask') },
      { label: 'Find…', accelerator: 'CmdOrCtrl+K', click: go('find') },
      { type: 'separator' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }])
    ] },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}
function finishClose() { if (!win || win.isDestroyed()) return; quitting = true; if (wantQuit) app.quit(); else win.close(); }

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 880, minHeight: 580, show: false,
    backgroundColor: dark ? '#0f0e0c' : '#f7f5f1',
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 15 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: dark ? '#0f0e0c' : '#f7f5f1', symbolColor: dark ? '#a9a39a' : '#4c4740', height: 44 } }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true, backgroundThrottling: false }
  });
  win.once('ready-to-show', () => { if (!process.env.DOCKET_HIDDEN) win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('docket://app/')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  win.on('focus', syncBar); win.on('blur', syncBar); win.on('show', syncBar); win.on('hide', syncBar); win.on('minimize', syncBar);
  win.on('close', (e) => {
    if (quitting) return;
    // While taking notes, closing the window just tucks it away; the floating bar and tray keep going.
    if (rec.recording && !wantQuit) {
      e.preventDefault(); win.hide();
      if (!toldHidden) { toldHidden = true; notify('Docket is still taking notes', 'Use the floating bar or the ' + (isMac ? 'menu bar' : 'tray') + ' icon to stop.'); }
      return;
    }
    if (!isMac && !wantQuit && settings().watch !== 'off') { e.preventDefault(); win.hide(); return; } // keep watching for calls from the tray
    e.preventDefault();
    win.webContents.send('docket:flush');
    setTimeout(finishClose, 2500);
  });
  win.on('closed', () => { win = null; quitting = false; });
  win.loadURL('docket://app/index.html');
}

app.whenReady().then(() => {
  nativeTheme.themeSource = ['light', 'dark'].includes(settings().theme) ? settings().theme : 'system';
  store = new Store(homeDir());
  registerProtocol();
  registerMedia();
  registerIpc();
  buildMenu();
  createWindow();
  createTray();
  startWatcher();
  app.on('activate', () => showWin());
});
app.on('second-instance', () => showWin());
app.on('before-quit', (e) => {
  wantQuit = true;
  if (rec.recording && win && !win.isDestroyed() && !quitting) { // finish the recording properly before quitting
    e.preventDefault();
    command('stop', { quitting: true });
    setTimeout(() => { quitting = true; app.exit(0); }, 6000);
    ipcMain.once('docket:stopped', () => { quitting = true; app.quit(); });
  }
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (!isMac && wantQuit) app.quit(); else if (!isMac && settings().watch === 'off') app.quit(); });
