'use strict';
// Beam — main process: the window, the menu bar / tray, notifications, settings and the bridge to the engine.
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeTheme, Notification, clipboard, nativeImage, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { Engine } = require('./core/engine');
const { loadIdentity } = require('./core/identity');
const F = require('./core/files');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const DEMO = process.env.BEAM_DEMO === '1';
if (process.env.BEAM_USER_DATA) app.setPath('userData', process.env.BEAM_USER_DATA);
const USER = app.getPath('userData');
const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'build', 'icon.png');

if (!DEMO && !process.env.BEAM_MULTI && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('com.bilal.beam');

let win = null, tray = null, engine = null, settings = null, quitting = false, blocker = null;
const startHidden = process.argv.includes('--hidden') || (IS_MAC && app.getLoginItemSettings().wasOpenedAsHidden);
let staged = [];                  // files waiting for a device (from the Dock, Send to, the tray)
const asking = new Map();         // tid → Notification for an incoming request

// ───────── settings
const SETTINGS = path.join(USER, 'settings.json');
function defaults() {
  return {
    name: defaultName(), receiveDir: path.join(app.getPath('downloads'), 'Beam'), receive: 'everyone', autoAcceptTrusted: true,
    trusted: [], saved: [], streams: 0, openAtLogin: false, background: true, theme: 'system', notify: true,
    copyText: true, openFolderWhenDone: false, keepAwake: true, phone: { enabled: true }, sendTo: IS_WIN, onboarded: false,
  };
}
function loadSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch {}
  return { ...defaults(), ...s };
}
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.mkdirSync(USER, { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2)); } catch {} send('settings', settings); }, 150);
}

function defaultName() {
  if (DEMO) return 'Bilal’s MacBook Pro';
  if (IS_MAC) { try { const n = require('child_process').execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000 }).trim(); if (n) return n; } catch {} }
  const h = os.hostname().replace(/\.local$/, '');
  if (IS_WIN && /^(DESKTOP|LAPTOP)-[A-Z0-9]+$/i.test(h)) {
    const u = os.userInfo().username; return `${u.charAt(0).toUpperCase()}${u.slice(1)}’s PC`;
  }
  return h || 'This computer';
}

// laptop or desktop, for the little picture other devices see
function detectDev() {
  return new Promise((resolve) => {
    if (IS_MAC) return execFile('sysctl', ['-n', 'hw.model'], { timeout: 2000 }, (e, out) => resolve(/book/i.test(out || '') ? 'laptop' : 'desktop'));
    if (IS_WIN) return execFile('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Battery | Measure-Object).Count'], { timeout: 8000, windowsHide: true }, (e, out) => resolve(Number(String(out).trim()) > 0 ? 'laptop' : 'desktop'));
    resolve('laptop');
  });
}

// ───────── window
function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

function createWindow() {
  if (win) { showWindow(); return; }
  const dark = shouldDark();
  win = new BrowserWindow({
    width: 1080, height: 720, minWidth: 820, minHeight: 560, show: false, title: 'Beam',
    backgroundColor: dark ? '#080b14' : '#f4f6fb',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
    titleBarOverlay: IS_MAC ? undefined : { color: '#00000000', symbolColor: dark ? '#e6ecfa' : '#1a2030', height: 44 },
    trafficLightPosition: { x: 16, y: 16 },
    icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!startHidden || DEMO) win.show(); });
  win.on('close', (e) => {
    if (!quitting && settings.background) { e.preventDefault(); win.hide(); if (IS_MAC && app.dock) app.dock.hide(); }
  });
  win.on('closed', () => { win = null; });
  win.on('focus', () => { for (const n of asking.values()) try { n.close(); } catch {} });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}
function showWindow() {
  if (!win) return createWindow();
  if (IS_MAC && app.dock) app.dock.show();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
function shouldDark() { return settings.theme === 'dark' || (settings.theme !== 'light' && nativeTheme.shouldUseDarkColors); }
function applyTheme() {
  nativeTheme.themeSource = settings.theme === 'dark' ? 'dark' : settings.theme === 'light' ? 'light' : 'system';
  if (!IS_MAC && win && !win.isDestroyed()) try { win.setTitleBarOverlay({ symbolColor: shouldDark() ? '#e6ecfa' : '#1a2030' }); } catch {}
}

// ───────── tray / menu bar
function trayImage() {
  if (IS_MAC) { const i = nativeImage.createFromPath(path.join(ROOT, 'build', 'trayTemplate.png')); i.setTemplateImage(true); return i; }
  return nativeImage.createFromPath(path.join(ROOT, 'build', 'tray.png')).resize({ width: 16, height: 16 });
}
function setupTray() {
  try { tray = new Tray(trayImage()); } catch { return; }
  tray.setToolTip('Beam');
  tray.on('click', () => { if (IS_MAC) tray.popUpContextMenu(trayMenu()); else showWindow(); });
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
  // macOS: drop files on the menu bar icon
  tray.on('drop-files', (_e, files) => stage(files));
  updateTray();
}
function trayMenu() {
  const peers = engine ? engine.peerList() : [];
  const live = engine ? engine.list().filter(t => ['active', 'waiting', 'asking', 'preparing'].includes(t.status)) : [];
  const items = [];
  for (const t of live.slice(0, 4)) {
    const pct = t.total ? Math.floor((t.bytes / t.total) * 100) : 0;
    items.push({ label: `${t.dir === 'out' ? 'To' : 'From'} ${t.peer.name} — ${t.status === 'asking' ? 'waiting for you' : t.status === 'waiting' ? 'waiting for them' : pct + '%'}`, click: showWindow });
  }
  if (items.length) items.push({ type: 'separator' });
  items.push({ label: peers.length ? 'Send files to' : 'No devices nearby', enabled: false });
  for (const p of peers.slice(0, 12)) {
    items.push({ label: p.name, submenu: [
      { label: 'Files…', click: () => pickAndSend(p.id, 'files') },
      { label: 'A folder…', click: () => pickAndSend(p.id, 'folder') },
      { label: 'What’s on the clipboard', click: () => { const t = clipboard.readText(); if (t) engine.sendText(p.id, t).catch(() => {}); } },
    ] });
  }
  items.push({ type: 'separator' });
  items.push({ label: `Receiving: ${settings.receive === 'off' ? 'Off' : settings.receive === 'trusted' ? 'Trusted devices only' : 'Everyone nearby'}`, submenu: [
    { label: 'Everyone nearby', type: 'radio', checked: settings.receive === 'everyone', click: () => setSetting({ receive: 'everyone' }) },
    { label: 'Trusted devices only', type: 'radio', checked: settings.receive === 'trusted', click: () => setSetting({ receive: 'trusted' }) },
    { label: 'Off', type: 'radio', checked: settings.receive === 'off', click: () => setSetting({ receive: 'off' }) },
  ] });
  items.push({ label: 'Open received folder', click: () => openReceiveDir() });
  items.push({ type: 'separator' });
  items.push({ label: 'Open Beam', click: showWindow });
  items.push({ label: 'Quit Beam', click: () => { quitting = true; app.quit(); } });
  return Menu.buildFromTemplate(items);
}
function updateTray() {
  if (!tray) return;
  const live = engine ? engine.list().filter(t => t.status === 'active') : [];
  if (IS_MAC) {
    if (live.length) {
      const b = live.reduce((a, t) => a + t.bytes, 0), tot = live.reduce((a, t) => a + (t.total || 0), 0);
      tray.setTitle(tot ? ` ${Math.floor((b / tot) * 100)}%` : '');
    } else tray.setTitle('');
  }
  tray.setToolTip(live.length ? `Beam — ${live.length} transfer${live.length > 1 ? 's' : ''} going` : 'Beam');
  if (!IS_MAC) tray.setContextMenu(trayMenu());
}
async function pickAndSend(peerId, kind) {
  const r = await dialog.showOpenDialog(win && win.isVisible() ? win : undefined, { properties: kind === 'folder' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'], title: 'Choose what to send' });
  if (!r.canceled && r.filePaths.length) engine.send(peerId, r.filePaths).catch(e => notify('Couldn’t send', e.message));
}
function openReceiveDir() { const d = engine.receiveDir(); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); }

// ───────── files from outside (Dock, Open With, Windows “Send to”, the tray)
function stage(paths) {
  const list = (paths || []).filter(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (!list.length) return;
  staged = [...new Set([...staged, ...list])];
  showWindow();
  send('stage', staged);
}
function argFiles(argv) {
  const i = argv.indexOf('--send');
  if (i < 0) return [];
  return argv.slice(i + 1).filter(a => !a.startsWith('--'));
}
app.on('open-file', (e, p) => { e.preventDefault(); if (app.isReady() && engine) stage([p]); else staged.push(p); });
app.on('second-instance', (_e, argv) => { const f = argFiles(argv); if (f.length) stage(f); else showWindow(); });

// Windows: a “Beam” entry in Explorer's Send to menu
function syncSendTo() {
  if (!IS_WIN) return;
  const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'SendTo', 'Beam.lnk');
  try {
    if (settings.sendTo && app.isPackaged) shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', { target: process.execPath, args: '--send', icon: process.execPath, iconIndex: 0, description: 'Send with Beam' });
    else if (!settings.sendTo && fs.existsSync(lnk)) fs.unlinkSync(lnk);
  } catch {}
}

// ───────── notifications
function notify(title, body, onClick, actions) {
  if (!settings.notify || !Notification.isSupported()) return null;
  const n = new Notification({ title, body, silent: false, icon: IS_MAC ? undefined : ICON, actions: IS_MAC && actions ? actions.map(a => ({ type: 'button', text: a })) : undefined, hasReply: false });
  n.on('click', () => { if (onClick) onClick(); else showWindow(); });
  n.show();
  return n;
}
function badge() {
  const n = engine ? engine.list().filter(t => t.status === 'asking').length : 0;
  try { app.setBadgeCount(n); } catch {}
  if (win && IS_WIN) { try { win.flashFrame(n > 0 && !win.isFocused()); } catch {} }
}
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
function what(t) {
  if (t.kind === 'text') return /^https?:\/\/\S+$/.test((t.text || '').trim()) ? 'a link' : 'some text';
  if (t.count === 1 && t.names.length === 1) return `“${t.names[0]}”`;
  if (t.names.length === 1) return `“${t.names[0]}” (${plural(t.count, 'file')})`;
  return plural(t.count, 'file');
}

// keep the computer awake while something is moving
function syncAwake() {
  const busy = engine && engine.list().some(t => t.status === 'active');
  if (busy && settings.keepAwake && blocker == null) blocker = powerSaveBlocker.start('prevent-app-suspension');
  if ((!busy || !settings.keepAwake) && blocker != null) { try { powerSaveBlocker.stop(blocker); } catch {} blocker = null; }
}

// ───────── engine
async function boot() {
  const identity = loadIdentity(USER);
  const dev = await Promise.race([detectDev(), new Promise(r => setTimeout(() => r('laptop'), 3000))]);
  engine = new Engine({
    dataDir: USER, identity, settings: () => settings, saveSettings,
    platform: { os: IS_MAC ? 'mac' : IS_WIN ? 'windows' : 'linux', dev },
    version: app.getVersion(),
    phoneHtml: () => fs.readFileSync(path.join(__dirname, 'phone', 'index.html'), 'utf8'),
    iconPath: ICON,
    discovery: DEMO ? false : {},
    port: Number(process.env.BEAM_PORT) || undefined,
  });
  engine.on('peers', (p) => { send('peers', p); if (!IS_MAC) updateTray(); });
  engine.on('transfer', (t) => { send('transfer', t); updateTray(); syncAwake(); });
  engine.on('transfers', (l) => send('transfers', l));
  engine.on('history', (h) => send('history', h));
  engine.on('phone', (p) => send('phone', p));
  engine.on('warn', (m) => console.warn(m));
  engine.on('incoming', (t, meta) => {
    send('incoming', { t, meta });
    badge();
    if (!win || !win.isVisible() || !win.isFocused()) {
      const n = notify(`${t.peer.name} wants to send ${what(t)}`, t.kind === 'text' ? (t.text || '').slice(0, 120) : `${F.human(t.total)} — open Beam to accept or decline.`, () => showWindow(), ['Accept', 'Decline']);
      if (n) {
        n.on('action', (_e, i) => engine.respond(t.tid, i === 0));
        asking.set(t.tid, n);
      }
    }
  });
  engine.on('asked', (tid) => { const n = asking.get(tid); if (n) { try { n.close(); } catch {} asking.delete(tid); } send('asked', tid); badge(); });
  engine.on('text', ({ from, text, tid }) => {
    const link = /^https?:\/\/\S+$/.test(text.trim());
    if (settings.copyText) clipboard.writeText(text);
    send('text', { from, text, tid, copied: settings.copyText });
    notify(link ? `Link from ${from}` : `Text from ${from}`, (settings.copyText ? 'Copied — ' : '') + text.slice(0, 140), () => { if (link) shell.openExternal(text.trim()); else showWindow(); });
  });
  engine.on('received', (t) => {
    send('received', t);
    const first = (t.saved || [])[0];
    notify(`Received ${what(t)}`, `From ${t.peer.name}${t.avg ? ` · ${F.human(t.avg)}/s` : ''}`, () => { if (first) shell.showItemInFolder(first); else openReceiveDir(); });
    if (settings.openFolderWhenDone && first) shell.showItemInFolder(first);
  });
  await engine.start();
  if (DEMO) require('./demo').install(engine);
}

function setSetting(patch) {
  const prevReceive = settings.receive;
  Object.assign(settings, patch);
  saveSettings();
  if ('openAtLogin' in patch && app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!settings.openAtLogin, openAsHidden: true, args: ['--hidden'] });
  if ('theme' in patch) applyTheme();
  if ('sendTo' in patch) syncSendTo();
  if ('receive' in patch && engine && engine.disc) {
    if (settings.receive === 'off' && prevReceive !== 'off') engine.disc.send('bye');
    else if (settings.receive !== 'off') engine.disc.send('hi');
  }
  if ('name' in patch && engine && engine.disc) engine.disc.send('hi');
  updateTray();
}

// ───────── IPC
const api = {
  state: () => ({
    me: engine.me(), settings, peers: engine.peerList(), transfers: engine.list(), history: engine.history,
    staged, platform: process.platform, home: os.homedir(), version: app.getVersion(), receiveDir: engine.receiveDir(),
    addresses: engine.addresses(), port: engine.port, demo: DEMO,
    asking: engine.list().filter(t => t.status === 'asking'),
  }),
  set: (patch) => { const ok = ['name', 'receiveDir', 'receive', 'autoAcceptTrusted', 'streams', 'openAtLogin', 'background', 'theme', 'notify', 'copyText', 'openFolderWhenDone', 'keepAwake', 'sendTo', 'onboarded'];
    const p = {}; for (const k of ok) if (k in patch) p[k] = patch[k];
    if ('name' in p) { p.name = String(p.name).trim().slice(0, 60); if (!p.name) delete p.name; }
    setSetting(p); return settings; },
  pick: async (kind) => {
    const props = kind === 'folder' ? ['openDirectory', 'multiSelections'] : kind === 'dir' ? ['openDirectory', 'createDirectory'] : ['openFile', 'multiSelections'];
    const r = await dialog.showOpenDialog(win, { properties: props, title: kind === 'dir' ? 'Choose where received files go' : 'Choose what to send' });
    return r.canceled ? [] : r.filePaths;
  },
  inspect: async (paths) => {
    const out = [];
    for (const p of paths) {
      try {
        const st = await fs.promises.stat(p);
        out.push({ path: p, name: path.basename(p), dir: st.isDirectory(), size: st.isDirectory() ? null : st.size, ext: path.extname(p).slice(1).toLowerCase() });
      } catch {}
    }
    return out;
  },
  send: (peerId, paths) => engine.send(peerId, paths),
  sendText: (peerId, text) => engine.sendText(peerId, text),
  clipboard: () => clipboard.readText(),
  copy: (text) => { clipboard.writeText(String(text || '')); return true; },
  unstage: (p) => { staged = p ? staged.filter(x => x !== p) : []; return staged; },
  cancel: (tid) => engine.cancel(tid),
  retry: (tid) => engine.retry(tid),
  respond: (tid, accept, trust) => engine.respond(tid, accept, { trust }),
  trust: (id, on) => engine.setTrust(id, on),
  untrust: (id) => { settings.trusted = settings.trusted.filter(x => x.id !== id); saveSettings(); engine.emitPeers(); return settings.trusted; },
  addAddress: (a) => engine.addAddress(a),
  removeAddress: (a) => engine.removeAddress(a),
  clearHistory: () => engine.clearHistory(),
  removeHistory: (tid) => engine.removeHistory(tid),
  open: async (p) => { const e = await shell.openPath(p); if (e) throw new Error(e); },
  show: (p) => { if (fs.existsSync(p)) shell.showItemInFolder(p); else throw new Error('It’s been moved or deleted.'); },
  openReceived: () => openReceiveDir(),
  openUrl: (u) => { if (/^https?:\/\//.test(u)) shell.openExternal(u); },
  phone: (address) => engine.phone.info(address),
  phoneShare: (paths) => engine.phone.share(paths),
  phoneUnshare: (id) => engine.phone.unshare(id),
  phoneText: (text) => engine.phone.shareText(text),
  phoneUntext: (id) => engine.phone.unshareText(id),
  phoneLink: () => engine.phone.newLink(),
  phoneEnable: (on) => engine.phone.setEnabled(on),
  quit: () => { quitting = true; app.quit(); },
};
ipcMain.handle('call', async (_e, method, ...args) => {
  try {
    const fn = api[method];
    if (!fn) throw new Error('Unknown: ' + method);
    return { ok: true, data: await fn(...args) };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
});

// ───────── app
app.whenReady().then(async () => {
  settings = loadSettings();
  if (!fs.existsSync(SETTINGS)) saveSettings();
  applyTheme();
  if (IS_MAC) Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
  else Menu.setApplicationMenu(null);
  await boot();
  staged = [...new Set([...staged, ...argFiles(process.argv)])];
  setupTray();
  syncSendTo();
  createWindow();
  nativeTheme.on('updated', () => { applyTheme(); send('theme', shouldDark()); });
});
app.on('activate', () => showWindow());
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (!settings || !settings.background) { quitting = true; app.quit(); } });
app.on('will-quit', async (e) => {
  if (engine && !engine._stopped) { e.preventDefault(); engine._stopped = true; try { await engine.stop(); } catch {} app.quit(); }
});
