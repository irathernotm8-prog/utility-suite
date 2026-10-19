const { app, BrowserWindow, ipcMain, protocol, net, session, dialog, clipboard, shell, desktopCapturer, Menu, systemPreferences } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const settings = require('./settings');
const { Stage, prepareSession, registerLocalFile, playerUrl, setAdblock, cleanUserAgent, MIME } = require('./stage');

const UI_DIR = path.join(__dirname, '..', 'ui');
const PROTOCOL = 'sideby';

// Separate profiles let you run two copies side by side for testing:
//   SIDEBY_PROFILE=friend npm start
if (process.env.SIDEBY_PROFILE) {
  app.setPath('userData', path.join(app.getPath('appData'), `Sideby-${process.env.SIDEBY_PROFILE.replace(/[^\w-]/g, '')}`));
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'sideby-app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  { scheme: 'sideby-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);

app.userAgentFallback = cleanUserAgent(app.userAgentFallback);
// Lets window/screen sharing capture system audio on macOS where supported.
app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare');

let mainWindow = null;
let stage = null;
let pendingDeepLink = null;
let pendingCapture = null;

// ---- single instance + deep links ----
const gotLock = process.env.SIDEBY_PROFILE ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function extractDeepLink(argv) {
  return argv.find(arg => typeof arg === 'string' && arg.toLowerCase().startsWith(`${PROTOCOL}://`)) || null;
}

function handleDeepLink(url) {
  if (!url) return;
  pendingDeepLink = url;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('app:deeplink', url);
  }
}

app.on('second-instance', (event, argv) => {
  const link = extractDeepLink(argv);
  if (link) handleDeepLink(link);
  else if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});
app.on('open-url', (event, url) => { event.preventDefault(); handleDeepLink(url); });
pendingDeepLink = extractDeepLink(process.argv);

function registerProtocolClient() {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL);
    }
  } catch (error) { console.warn('[sideby] could not register sideby:// links', error.message); }
}

// ---- UI protocol ----
function registerUiProtocol() {
  protocol.handle('sideby-app', request => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const target = path.normalize(path.join(UI_DIR, relative));
    if (!target.startsWith(UI_DIR + path.sep) || !fs.existsSync(target)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(target).toString()).then(res => new Response(res.body, {
      status: res.status,
      headers: { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' }
    }));
  });
}

// ---- screen capture ----
function registerCaptureHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const choice = pendingCapture;
    pendingCapture = null;
    try {
      if (!choice) return callback(null);
      if (choice.kind === 'stage' && stage) {
        const frame = stage.view.webContents.mainFrame;
        return callback({ video: frame, audio: request.audioRequested ? frame : undefined, enableLocalEcho: true });
      }
      if (choice.kind === 'source') {
        const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 0, height: 0 } });
        const source = sources.find(s => s.id === choice.id);
        if (!source) return callback(null);
        const audio = request.audioRequested && (process.platform === 'win32' || (process.platform === 'darwin' && choice.audio)) ? 'loopback' : undefined;
        return callback({ video: source, audio });
      }
    } catch (error) {
      console.error('[sideby] capture failed', error);
    }
    callback(null);
  });
}

// ---- window ----
function sendToUi(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

async function createWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1360, height: 860, minWidth: 980, minHeight: 640,
    backgroundColor: '#0B0E0C',
    title: 'Sideby',
    show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'ui-preload.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
      spellcheck: true
    }
  });
  const wc = mainWindow.webContents;
  wc.setVisualZoomLevelLimits(1, 1);
  wc.setWindowOpenHandler(({ url }) => { if (/^https:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (event, url) => { if (!url.startsWith('sideby-app://')) event.preventDefault(); });
  wc.session.setPermissionRequestHandler((contents, permission, callback) => {
    callback(contents === wc && ['media', 'display-capture', 'clipboard-sanitized-write', 'fullscreen', 'notifications'].includes(permission));
  });

  stage = new Stage(mainWindow, (event, payload) => sendToUi(`stage:${event}`, payload));
  mainWindow.on('enter-full-screen', () => sendToUi('app:fullscreen', true));
  mainWindow.on('leave-full-screen', () => sendToUi('app:fullscreen', false));
  mainWindow.on('focus', () => sendToUi('app:focus', true));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { stage?.destroy(); stage = null; mainWindow = null; });

  await wc.loadURL('sideby-app://ui/index.html');
}

// ---- IPC ----
function fromMain(event) {
  return mainWindow && event.sender === mainWindow.webContents;
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!fromMain(event)) throw new Error('Untrusted sender');
    return fn(...args);
  });
}
function on(channel, fn) {
  ipcMain.on(channel, (event, ...args) => { if (fromMain(event)) fn(...args); });
}

handle('settings:get', () => settings.load());
handle('settings:set', patch => {
  const before = settings.load().adblock;
  const next = settings.update(patch);
  if (patch && 'adblock' in patch && patch.adblock !== before) setAdblock(!!patch.adblock);
  return next;
});
handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, profile: process.env.SIDEBY_PROFILE || null }));
handle('app:take-deeplink', () => { const link = pendingDeepLink; pendingDeepLink = null; return link; });
handle('app:clipboard-invite', () => {
  const text = clipboard.readText();
  return /sideby:\/\/join\//i.test(text) ? text.slice(0, 400) : null;
});
handle('app:copy', text => { clipboard.writeText(String(text ?? '')); return true; });
handle('app:open-external', url => { if (/^https:\/\//i.test(url)) shell.openExternal(url); });
handle('app:fullscreen', on => { if (mainWindow) mainWindow.setFullScreen(on === undefined ? !mainWindow.isFullScreen() : !!on); return mainWindow?.isFullScreen(); });

handle('stage:load', url => stage?.load(url));
handle('stage:snapshot', () => stage?.snapshot());
on('stage:bounds', rect => stage?.setBounds(rect));
on('stage:visible', visible => stage?.setVisible(visible));
on('stage:nav', action => stage?.navigate(action));
on('stage:blank', () => stage?.blank());
on('stage:apply', cmd => stage?.apply(cmd));
on('stage:react', payload => stage?.react(payload));
on('stage:devtools', () => stage?.view.webContents.openDevTools({ mode: 'detach' }));
on('stage:mute', muted => stage?.view.webContents.setAudioMuted(!!muted));
handle('stage:nav-state', () => stage?.navState());
handle('stage:player-url', (src, opts) => playerUrl(src, opts));

handle('stage:open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a video to watch together',
    properties: ['openFile'],
    filters: [{ name: 'Videos', extensions: ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv', 'mp3', 'm4a'] }, { name: 'All files', extensions: ['*'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const file = registerLocalFile(result.filePaths[0]);
  return { name: file.name, url: playerUrl(file.url, { name: file.name }) };
});

handle('capture:sources', async () => {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status === 'denied' || status === 'restricted') return { error: 'screen-permission', sources: [] };
  }
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 360, height: 220 }, fetchWindowIcons: true });
  const ownIds = new Set(BrowserWindow.getAllWindows().map(w => w.getMediaSourceId()));
  return {
    sources: sources.filter(s => !ownIds.has(s.id) && s.name).map(s => ({
      id: s.id, name: s.name, kind: s.id.startsWith('screen') ? 'screen' : 'window',
      thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null
    }))
  };
});
handle('capture:prepare', choice => {
  pendingCapture = choice && (choice.kind === 'stage' || (choice.kind === 'source' && typeof choice.id === 'string')) ? choice : null;
  return !!pendingCapture;
});
handle('capture:open-settings', () => {
  if (process.platform === 'darwin') shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
});

// ---- menu ----
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'Leave Room', accelerator: 'CmdOrCtrl+W', click: () => sendToUi('app:menu', 'leave') },
      ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }])
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Toggle Chat', accelerator: 'CmdOrCtrl+Shift+C', click: () => sendToUi('app:menu', 'toggle-chat') },
      { label: 'Theater Mode', accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11', click: () => sendToUi('app:menu', 'theater') },
      { type: 'separator' },
      { label: 'Reload Page on Stage', accelerator: 'CmdOrCtrl+R', click: () => stage?.navigate('reload') },
      { type: 'separator' },
      { label: 'Developer', submenu: [
        { label: 'Sideby Developer Tools', click: () => mainWindow?.webContents.openDevTools({ mode: 'detach' }) },
        { label: 'Stage Developer Tools', click: () => stage?.view.webContents.openDevTools({ mode: 'detach' }) },
        { label: 'Reload Sideby', click: () => mainWindow?.webContents.reload() }
      ] }
    ] },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  registerProtocolClient();
  registerUiProtocol();
  registerCaptureHandler();
  buildMenu();
  prepareSession(() => settings.load()).catch(error => console.error('[sideby] stage session', error));
  await createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => settings.flush());
