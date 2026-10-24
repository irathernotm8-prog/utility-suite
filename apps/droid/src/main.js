// Droid — virtual Android devices. Main process: windows, the SDK, emulators and everything the windows ask for.
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, session, clipboard, nativeImage, screen, nativeTheme, Menu } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const catalog = require('./core/catalog');
const { Sdk, existingSdks, EXE } = require('./core/sdk');
const { Adb } = require('./core/adb');
const { Runner } = require('./core/emulator');
const { DeviceStore, readJson, writeJson } = require('./core/devices');
const { writeAvd, avdDir, diskUsage, avdName } = require('./core/avd');
const apk = require('./core/apk');
const sources = require('./core/sources');
const location = require('./core/location');
const host = require('./core/host');
const { download } = require('./core/download');

const DEMO = process.env.DROID_DEMO === '1';
if (process.env.DROID_USER_DATA) app.setPath('userData', process.env.DROID_USER_DATA);
app.setName('Droid');

// ───────────────────────── paths and settings
const USER = app.getPath('userData');
const pointerFile = path.join(USER, 'data-folder.json');
let DATA = readJson(pointerFile, {}).dir || USER;
if (!fs.existsSync(DATA)) DATA = USER;
const P = {
  settings: () => path.join(USER, 'settings.json'),
  devices: () => path.join(DATA, 'devices.json'),
  avd: () => path.join(DATA, 'avd'),
  apks: () => path.join(DATA, 'apks'),
  thumbs: () => path.join(DATA, 'thumbs'),
  cache: () => path.join(DATA, 'cache'),
  tmp: () => path.join(DATA, 'cache', 'tmp'),
  captures: () => path.join(app.getPath('pictures'), 'Droid'),
};
const DEFAULTS = { theme: 'system', sdkRoot: null, emulatorWindow: 'hidden', autoInstall: true, installTarget: null, showAllImages: false, licensesAccepted: [], onboarded: false, dock: 'right' };
let settings = { ...DEFAULTS, ...readJson(P.settings(), {}) };
const saveSettings = () => writeJson(P.settings(), settings);
const sdkRoot = () => process.env.DROID_SDK || settings.sdkRoot || path.join(DATA, 'sdk');
for (const d of [P.avd(), P.apks(), P.thumbs(), P.cache(), P.tmp()]) fs.mkdirSync(d, { recursive: true });

// ───────────────────────── services
const hostInfo = () => host.info(DATA);
let sdk, adb, runner, store;
function makeServices() {
  sdk = new Sdk({ root: sdkRoot(), cacheDir: P.cache() });
  if (DEMO) {
    // pretend SDK: everything is "installed", the emulator and adb are Node scripts
    sdk.status = () => ({ root: sdk.root, emulator: 'demo', platformTools: 'demo', images: [], ready: true });
    sdk.hasImage = () => true;
    sdk.plan = async () => [];
    sdk.emulatorCmd = () => ({ cmd: process.execPath, pre: [path.join(__dirname, 'demo', 'fake-emulator.js')], env: { ELECTRON_RUN_AS_NODE: '1' }, cwd: os.tmpdir() });
    adb = new Adb(process.execPath, { ...process.env, ELECTRON_RUN_AS_NODE: '1', ANDROID_AVD_HOME: P.avd() }, [path.join(__dirname, 'demo', 'fake-adb.js')]);
  } else {
    adb = new Adb(sdk.adbBin, { ...process.env, ANDROID_SDK_ROOT: sdk.root, ANDROID_HOME: sdk.root, ANDROID_AVD_HOME: P.avd() });
  }
  const lim = hostInfo().limits;
  store = new DeviceStore(P.devices(), { ramMB: Math.round(os.totalmem() / 1048576), cores: os.cpus().length });
  runner = new Runner({ sdk, avdHome: P.avd(), adb, settings: () => settings });
  runner.on('state', (s) => { broadcast('device:state', s); if (s.state === 'stopped') stopExtras(s.id); });
  runner.on('booted', (s) => onBooted(s.id).catch(() => {}));
  runner.on('exit', (e) => {
    const dv = views.get(e.id);
    if (e.failed || e.crashed) {
      broadcast('toast', { kind: 'bad', title: `${store.get(e.id)?.name || 'Device'} ${e.failed ? "didn't start" : 'stopped'}`, text: e.reason });
      if (dv && !dv.win.isDestroyed()) dv.win.webContents.send('view:error', { reason: e.reason, failed: e.failed });
    } else if (dv && !dv.win.isDestroyed() && !restarting.has(e.id)) dv.win.close();
    saveThumbFromLast(e.id);
  });
  void lim;
}

// ───────────────────────── windows
let mainWin = null;
const restarting = new Set();   // devices being restarted keep their window open
const views = new Map();     // device id -> { win, stream, want, inFlight, pending, audio, last }
function broadcast(ch, data) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ch, data);
}
const isMac = process.platform === 'darwin';

function createMain() {
  mainWin = new BrowserWindow({
    width: 1240, height: 820, minWidth: 940, minHeight: 620, show: false,
    title: 'Droid', backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d10' : '#f5f6f8',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac ? undefined : { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#e8eaed' : '#1b1f24', height: 44 },
    trafficLightPosition: { x: 16, y: 16 },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true, sandbox: false },
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.on('closed', () => { mainWin = null; });
  mainWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

const STYLE_PAD = { pixel: [0.045, 0.03], galaxy: [0.03, 0.025], tablet: [0.05, 0.05], island: [0.05, 0.035], custom: [0.04, 0.04] };
const TOOLBAR = 64;
// Window size that fits the device frame plus its toolbar on the current display.
function fitSize(dev, rotated) {
  let { w, h } = dev.screen;
  if (rotated) [w, h] = [h, w];
  const [px] = STYLE_PAD[dev.style] || STYLE_PAD.pixel;
  const fw = w * (1 + px * 2 * (h / w > 1 ? h / w : 1) * (w > h ? 0.6 : 1)), fh = h + w * px * 2;
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const s = Math.min((wa.height * 0.86) / fh, (wa.width * 0.7 - TOOLBAR) / fw, 1);
  return { width: Math.round(fw * s + TOOLBAR + 24), height: Math.round(fh * s + 24) };
}

function openDeviceWindow(id) {
  const dev = store.get(id);
  if (!dev) return;
  const v = views.get(id);
  if (v && !v.win.isDestroyed()) { if (v.win.isMinimized()) v.win.restore(); v.win.show(); v.win.focus(); return; }
  const ui = readJson(path.join(DATA, 'windows.json'), {});
  const size = fitSize(dev, false);
  const saved = ui[id];
  const win = new BrowserWindow({
    width: saved?.width || size.width, height: saved?.height || size.height, x: saved?.x, y: saved?.y,
    minWidth: 220, minHeight: 260, frame: false, transparent: true, hasShadow: true, resizable: true, show: false,
    title: dev.name, backgroundColor: '#00000000', roundedCorners: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  const view = { id, win, stream: null, want: null, inFlight: false, pending: null, audio: null, last: null, clip: null, clipText: null };
  views.set(id, view);
  win.loadFile(path.join(__dirname, 'renderer', 'device.html'), { query: { id } });
  win.once('ready-to-show', () => win.show());
  const remember = () => { if (win.isDestroyed()) return; const b = win.getBounds(); const u = readJson(path.join(DATA, 'windows.json'), {}); u[id] = b; writeJson(path.join(DATA, 'windows.json'), u); };
  win.on('moved', remember); win.on('resized', remember);
  win.on('minimize', () => pauseStream(view));
  win.on('restore', () => restartStream(view));
  win.on('focus', () => pushClipboard(view));
  // Closing the phone window turns the device off (Quick Boot saves where you were).
  win.on('close', () => { const s = runner.session(id); if (s && !['stopping', 'stopped'].includes(s.state)) runner.stop(id).catch(() => {}); });
  win.on('closed', () => { stopStream(view); stopAudio(view); views.delete(id); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

// ───────────────────────── screen streaming to a device window
function client(id) { return runner.session(id)?.client || null; }
function stopStream(v) { if (v.stream) { v.stream.cancel(); v.stream = null; } }
function pauseStream(v) { stopStream(v); }
function restartStream(v) {
  stopStream(v);
  const c = client(v.id);
  if (!c || !v.want || v.win.isDestroyed() || v.win.isMinimized()) return;
  const myStream = c.streamScreen(v.want, (f) => {
    if (v.win.isDestroyed()) return;
    v.last = f;
    if (v.inFlight) { v.pending = f; return; }
    sendFrame(v, f);
  }, () => {
    // stream ended (device restarted the display, or stopped): retry while the device is up
    if (v.stream === myStream) { v.stream = null; setTimeout(() => { if (!v.stream && runner.session(v.id)?.client) restartStream(v); }, 800); }
  });
  v.stream = myStream;
}
function sendFrame(v, f) {
  v.inFlight = true; v.pending = null;
  v.win.webContents.send('view:frame', { w: f.width, h: f.height, rotation: f.rotation, seq: f.seq, data: f.data });
}

// ───────────────────────── audio + clipboard
function startAudio(v) {
  const c = client(v.id);
  if (!c || v.audio) return;
  v.audio = c.streamAudio((pcm) => { if (!v.win.isDestroyed()) v.win.webContents.send('view:audio', pcm); });
}
function stopAudio(v) { if (v.audio) { v.audio.cancel(); v.audio = null; } }
function pushClipboard(v) {
  const dev = store.get(v.id); const c = client(v.id);
  if (!dev?.options.clipboard || !c || runner.session(v.id)?.state !== 'running') return;
  const t = clipboard.readText();
  if (t && t !== v.clipText && t.length < 100000) { v.clipText = t; c.setClipboard(t).catch(() => {}); }
}
function watchClipboard(id) {
  const dev = store.get(id); const c = client(id); const v = views.get(id);
  if (!dev?.options.clipboard || !c) return;
  const h = c.streamClipboard((t) => { const vv = views.get(id); if (t && vv && t !== vv.clipText) { vv.clipText = t; clipboard.writeText(t); } });
  extras(id).clip = h;
  if (v) pushClipboard(v);
}

// ───────────────────────── per-device background work (location movement, thumbnails, recording)
const extrasMap = new Map();
const extras = (id) => { if (!extrasMap.has(id)) extrasMap.set(id, {}); return extrasMap.get(id); };
function stopExtras(id) {
  const x = extrasMap.get(id); if (!x) return;
  clearInterval(x.mover); clearInterval(x.thumbs); x.clip && x.clip.cancel();
  if (x.rec) { try { x.rec.kill(); } catch {} }
  extrasMap.delete(id);
}

let approxCache = null;
async function applyLocation(id) {
  const dev = store.get(id); const c = client(id);
  if (!dev || !c) return null;
  const x = extras(id); clearInterval(x.mover);
  const l = dev.location;
  let center = null;
  if (l.mode === 'manual' && Number.isFinite(l.lat)) center = { lat: l.lat, lng: l.lng };
  else if (l.mode === 'simulated') {
    const city = location.CITIES.find((cty) => cty.id === l.city) || (Number.isFinite(l.lat) ? { lat: l.lat, lng: l.lng } : location.CITIES[0]);
    center = { lat: city.lat, lng: city.lng };
  } else {
    if (!approxCache || Date.now() - approxCache.at > 3600e3) approxCache = { at: Date.now(), ...(await location.approximate().catch(() => null)) };
    if (Number.isFinite(approxCache.lat)) center = { lat: approxCache.lat, lng: approxCache.lng };
  }
  if (!center) return null;
  if (l.mode === 'simulated' && l.motion && l.motion !== 'still') {
    const f = location.mover(center, l.motion); const t0 = Date.now();
    const tick = () => c.setGps(f((Date.now() - t0) / 1000)).catch(() => {});
    tick(); x.mover = setInterval(tick, 1000);
  } else await c.setGps(center).catch(() => {});
  return center;
}

async function applyNetwork(id, live = false) {
  const dev = store.get(id); const s = runner.session(id);
  if (!dev || !s) return;
  if (dev.network.mode === 'isolated') await adb.airplane(s.serial, true);
  else if (live) await adb.airplane(s.serial, false);
}

async function onBooted(id) {
  store.touch(id);
  broadcast('devices:changed', null);
  const c = client(id);
  await Promise.all([applyLocation(id), applyNetwork(id), c && c.setBattery({ level: 100, charging: true }).catch(() => {})]);
  watchClipboard(id);
  const v = views.get(id);
  if (v) { restartStream(v); if (store.get(id)?.options.audio && v.audioWanted !== false) startAudio(v); }
  const x = extras(id);
  x.thumbs = setInterval(() => thumbOf(id).catch(() => {}), 4000);
  thumbOf(id).catch(() => {});
  const q = installQueue.get(id);
  if (q) { installQueue.delete(id); for (const job of q) job(); }
}

async function thumbOf(id) {
  const c = client(id); if (!c) return;
  const shot = await c.call('getScreenshot', { format: 'PNG', width: 360, height: 800 }, { timeout: 8000 });
  if (!shot?.image?.length) return;
  const file = path.join(P.thumbs(), `${id}.png`);
  fs.writeFileSync(file, shot.image);
  if (mainWin) mainWin.webContents.send('device:thumb', { id, url: `data:image/png;base64,${Buffer.from(shot.image).toString('base64')}`, rotation: shot.format?.rotation?.rotation || 'PORTRAIT' });
}
function saveThumbFromLast(id) {
  // the dashboard keeps the last picture; nothing to do if no frame was ever drawn
  const f = views.get(id)?.last;
  if (!f || !f.data) return;
  try {
    const bgra = Buffer.alloc(f.width * f.height * 4);
    for (let i = 0, j = 0; i < f.data.length; i += 3, j += 4) { bgra[j] = f.data[i + 2]; bgra[j + 1] = f.data[i + 1]; bgra[j + 2] = f.data[i]; bgra[j + 3] = 255; }
    const img = nativeImage.createFromBitmap(bgra, { width: f.width, height: f.height }).resize({ width: Math.min(360, f.width) });
    fs.writeFileSync(path.join(P.thumbs(), `${id}.png`), img.toPNG());
  } catch {}
}

// ───────────────────────── starting devices (downloads first if needed)
const progress = (p) => broadcast('sdk:progress', p);
async function ensureReady(dev) {
  if (DEMO) return;
  const need = await sdk.plan(dev.image.path);
  const missing = need.find((n) => n.kind === 'missing');
  if (missing) throw new Error(`Google no longer offers ${dev.image.name} (${dev.image.tagName}). Edit the device and pick another Android version.`);
  for (const item of need) {
    broadcast('device:state', { id: dev.id, state: 'downloading', label: item.label });
    await sdk.install(item, (p) => progress({ ...p, deviceId: dev.id }));
  }
  if (need.length) broadcast('sdk:changed', sdk.status());
}

async function startDevice(id, opts = {}) {
  const dev = store.get(id);
  if (!dev) throw new Error('Device not found');
  if (runner.session(id)) { openDeviceWindow(id); return runner.session(id); }
  try {
    await ensureReady(dev);
  } catch (e) {
    broadcast('device:state', { id, state: 'stopped' });
    throw e;
  }
  writeAvd(P.avd(), dev);
  if (!opts.background) openDeviceWindow(id);
  const s = await runner.start(dev, opts);
  return s;
}

// Installs one app file on a device, starting it first if needed. Reports through toasts.
const installQueue = new Map();
function whenRunning(id, job) {
  const s = runner.session(id);
  if (s && s.state === 'running') return job();
  if (!installQueue.has(id)) installQueue.set(id, []);
  installQueue.get(id).push(job);
  if (!s) startDevice(id, { background: false }).catch((e) => broadcast('toast', { kind: 'bad', title: 'Could not start the device', text: e.message }));
}

async function installFile(id, file, { label } = {}) {
  const dev = store.get(id); if (!dev) throw new Error('Device not found');
  const name = label || path.basename(file);
  const tid = `install-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return new Promise((resolve, reject) => whenRunning(id, async () => {
    const s = runner.session(id);
    const note = (t, kind = 'info', extra = {}) => broadcast('toast', { id: tid, kind, title: t, text: name, device: id, ...extra });
    note(`Installing on ${dev.name}…`, 'busy');
    try {
      const info = apk.inspect(file);
      if (info.encrypted) throw new Error('This bundle is password-protected (older APKMirror format). Download it again, or the plain APK.');
      if (info.kind === 'apk') await adb.install(s.serial, file);
      else {
        const dir = path.join(P.tmp(), `bundle-${Date.now()}`);
        const { apks, obb } = await apk.unpackBundle(file, dir, { abi: dev.image.abi });
        if (!apks.length) throw new Error('No APKs inside this file.');
        await adb.install(s.serial, apks);
        for (const o of obb) { await adb.mkdir(s.serial, path.posix.dirname(o.remote)); await adb.push(s.serial, o.local, o.remote); }
        fs.rmSync(dir, { recursive: true, force: true });
      }
      note(`Installed on ${dev.name}`, 'ok', { pkg: info.package || null });
      broadcast('apps:changed', { id });
      resolve({ ok: true, package: info.package });
    } catch (e) {
      note(`Couldn't install on ${dev.name}`, 'bad', { text: `${name}: ${e.message}` });
      reject(e);
    }
  }));
}

// ───────────────────────── APK library (downloads from the browser and F-Droid land here)
function library() {
  const out = [];
  for (const f of fs.readdirSync(P.apks())) {
    if (!apk.isAppFile(f)) continue;
    const file = path.join(P.apks(), f);
    let info = {};
    try { info = apk.inspect(file); } catch {}
    const st = fs.statSync(file);
    out.push({ file, name: f, size: st.size, added: st.mtimeMs, package: info.package || null, version: info.versionName || null, label: info.label || null, kind: info.kind, splits: info.splits?.length || 0, broken: !!info.broken, encrypted: !!info.encrypted, minSdk: info.minSdk || null });
  }
  return out.sort((a, b) => b.added - a.added);
}
const uniquePath = (dir, name) => {
  let p = path.join(dir, name), n = 2;
  const ext = path.extname(name), base = path.basename(name, ext);
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${n++})${ext}`);
  return p;
};

function setupWebSession() {
  const ses = session.fromPartition('persist:droid-web');
  // Present as regular Chrome so APK sites don't block an "Electron" browser.
  const chromeVer = process.versions.chrome || '140.0.0.0';
  const ua = isMac
    ? `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`
    : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
  ses.setUserAgent(ua);
  ses.on('will-download', (e, item) => {
    const name = item.getFilename();
    const appFile = apk.isAppFile(name);
    const dest = appFile ? uniquePath(P.apks(), name) : uniquePath(app.getPath('downloads'), name);
    item.setSavePath(dest);
    const id = `dl-${Date.now()}`;
    item.on('updated', () => broadcast('web:download', { id, name, got: item.getReceivedBytes(), total: item.getTotalBytes(), state: 'progress' }));
    item.once('done', (ev, state) => {
      broadcast('web:download', { id, name, state, file: dest, app: appFile });
      if (state !== 'completed') return;
      if (!appFile) { broadcast('toast', { kind: 'ok', title: 'Saved to Downloads', text: name, reveal: dest }); return; }
      broadcast('library:changed', null);
      const target = settings.installTarget && store.get(settings.installTarget) ? settings.installTarget : null;
      if (settings.autoInstall && target) installFile(target, dest).catch(() => {});
      else broadcast('toast', { kind: 'ok', title: 'Added to your app library', text: name });
    });
  });
}

// ───────────────────────── IPC
const h = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => {
  try { return { ok: true, data: await fn(...a, e) }; } catch (err) { return { ok: false, error: err.message || String(err) }; }
});

function devicePublic(d) {
  const s = runner.session(d.id);
  const thumb = path.join(P.thumbs(), `${d.id}.png`);
  return { ...d, state: s ? s.state : 'stopped', thumb: fs.existsSync(thumb) ? `file://${thumb}?v=${Math.floor(fs.statSync(thumb).mtimeMs)}` : null };
}

function registerIpc() {
  h('app:init', async () => ({
    settings, demo: DEMO, platform: process.platform, arch: process.arch, version: app.getVersion(), dataDir: DATA, sdkRoot: sdkRoot(),
    host: hostInfo(), catalog: { styles: catalog.STYLES, ram: catalog.RAM_OPTIONS, cores: catalog.CORE_OPTIONS, storage: catalog.STORAGE_OPTIONS, res: catalog.RES_PRESETS, tabletRes: catalog.TABLET_RES_PRESETS, accents: catalog.ACCENTS, densities: catalog.DENSITIES },
    cities: location.CITIES, starters: sources.STARTERS, sites: sources.SITES,
    devices: store.all().map(devicePublic), sdk: sdk.status(), existingSdks: existingSdks().filter((p) => p !== sdkRoot()),
  }));
  h('settings:set', (patch) => { settings = { ...settings, ...patch }; saveSettings(); if (patch.theme) nativeTheme.themeSource = patch.theme; broadcast('settings:changed', settings); return settings; });

  h('catalog:images', async (force) => {
    if (DEMO) {
      const fake = (api, tag, size) => ({ path: `system-images;android-${api};${tag};arm64-v8a`, api: String(api), apiNum: api, tag, tagName: catalog.TAGS[tag].name, tagRank: catalog.TAGS[tag].rank, abi: 'arm64-v8a', name: catalog.androidName(api), size, revision: '1' });
      const images = [36, 35, 34, 33, 31, 30].flatMap((a) => [fake(a, 'google_apis_playstore', 1.9e9 - (36 - a) * 8e7), fake(a, 'google_apis', 1.8e9 - (36 - a) * 8e7), fake(a, 'default', 8e8)]);
      return { images, all: images, recommended: images[0].path, installed: [images[0].path], emulator: { version: 'demo', size: 0 }, platformTools: { version: 'demo', size: 0 }, licenses: {} };
    }
    const cat = await sdk.loadCatalog({ force: !!force });
    const rec = require('./core/repo').recommended(cat.images);
    return { images: cat.images, all: cat.allImages, recommended: rec?.path || null, installed: sdk.installedImages().map((i) => i.path), emulator: cat.emulator, platformTools: cat.platformTools, licenses: cat.licenses };
  });
  h('sdk:status', () => sdk.status());
  h('sdk:plan', (imagePath) => sdk.plan(imagePath));
  h('sdk:install', async (item) => { await sdk.install(item, progress); broadcast('sdk:changed', sdk.status()); return sdk.status(); });
  h('sdk:cancel', (key) => sdk.cancel(key));
  h('sdk:removeImage', (p) => {
    const users = store.all().filter((d) => d.image.path === p).map((d) => d.name);
    if (users.length) throw new Error(`Used by ${users.join(', ')}. Delete those devices first.`);
    sdk.removeImage(p); broadcast('sdk:changed', sdk.status()); return sdk.status();
  });
  h('sdk:usage', () => {
    const imgs = sdk.installedImages().map((i) => ({ ...i, bytes: diskUsage(sdk.imageDir(i.path)), users: store.all().filter((d) => d.image.path === i.path).map((d) => d.name) }));
    return { images: imgs, emulator: diskUsage(path.join(sdk.root, 'emulator')), platformTools: diskUsage(path.join(sdk.root, 'platform-tools')), devices: store.all().map((d) => ({ id: d.id, name: d.name, bytes: diskUsage(avdDir(P.avd(), d)) })), apks: diskUsage(P.apks()), downloads: diskUsage(path.join(P.cache(), 'downloads')) };
  });
  h('sdk:clearDownloads', () => { fs.rmSync(path.join(P.cache(), 'downloads'), { recursive: true, force: true }); return true; });
  h('sdk:useExisting', (root) => { settings.sdkRoot = root || null; saveSettings(); makeServices(); broadcast('sdk:changed', sdk.status()); return sdk.status(); });
  h('host:accel', () => (DEMO ? { ok: true, text: 'Demo mode' } : host.accelCheck(sdk.emulatorBin)));
  h('host:info', () => hostInfo());

  h('devices:list', () => store.all().map(devicePublic));
  h('devices:create', async (input, opts = {}) => {
    const d = store.create(input);
    broadcast('devices:changed', null);
    if (opts.start) startDevice(d.id).catch((e) => broadcast('toast', { kind: 'bad', title: `Couldn't start ${d.name}`, text: e.message }));
    return devicePublic(d);
  });
  h('devices:update', async (id, patch) => {
    const before = store.get(id);
    const d = store.update(id, patch);
    const s = runner.session(id);
    // live changes while running
    if (s && s.state === 'running') {
      if (patch.location) await applyLocation(id);
      if (patch.network) await applyNetwork(id, true);
    }
    if (before && before.image.path !== d.image.path) {
      // a new Android version needs fresh data: the old userdata won't boot on it
      for (const f of ['userdata-qemu.img', 'userdata-qemu.img.qcow2', 'userdata.img', 'cache.img', 'cache.img.qcow2', 'snapshots']) fs.rmSync(path.join(avdDir(P.avd(), d), f), { recursive: true, force: true });
    }
    if (!s) writeAvd(P.avd(), d);
    broadcast('devices:changed', null);
    const restart = s && before && (JSON.stringify([before.screen, before.ramMB, before.cores, before.storageGB, before.image.path, before.options.gpu, before.network.proxy, before.network.mode === 'isolated']) !== JSON.stringify([d.screen, d.ramMB, d.cores, d.storageGB, d.image.path, d.options.gpu, d.network.proxy, d.network.mode === 'isolated']));
    return { device: devicePublic(d), restartNeeded: !!restart };
  });
  h('devices:remove', async (id) => {
    if (runner.session(id)) await runner.stop(id, { force: true });
    const d = store.get(id);
    if (d) {
      fs.rmSync(avdDir(P.avd(), d), { recursive: true, force: true });
      fs.rmSync(path.join(P.avd(), `${avdName(d)}.ini`), { force: true });
      fs.rmSync(path.join(P.thumbs(), `${id}.png`), { force: true });
    }
    store.remove(id); broadcast('devices:changed', null); return true;
  });
  h('devices:duplicate', (id) => { const d = store.duplicate(id); broadcast('devices:changed', null); return devicePublic(d); });
  h('devices:pin', (id, pinned) => { store.update(id, { pinned }); broadcast('devices:changed', null); return true; });
  h('devices:usage', (id) => { const d = store.get(id); return d ? diskUsage(avdDir(P.avd(), d)) : 0; });

  h('device:start', (id, opts) => startDevice(id, opts || {}).then(() => true));
  h('device:stop', (id) => runner.stop(id).then(() => true));
  h('device:forceStop', (id) => runner.stop(id, { force: true }).then(() => true));
  h('device:restart', async (id, opts = {}) => {
    restarting.add(id);
    try { await runner.stop(id); await new Promise((r) => setTimeout(r, 800)); await startDevice(id, opts); } finally { restarting.delete(id); }
    return true;
  });
  h('device:wipe', async (id) => {
    restarting.add(id);
    try { if (runner.session(id)) await runner.stop(id, { force: true }); await startDevice(id, { wipe: true }); } finally { restarting.delete(id); }
    return true;
  });
  h('device:open', (id) => { if (runner.session(id)) openDeviceWindow(id); return true; });
  h('device:showFolder', (id) => { const d = store.get(id); shell.openPath(avdDir(P.avd(), d)); return true; });
  h('device:info', (id) => ({ device: devicePublic(store.get(id)), session: runner.session(id) ? { ...runner.list().find((s) => s.id === id) } : null }));

  // device window
  h('view:hello', (id) => { const d = store.get(id); return { device: devicePublic(d), session: runner.list().find((s) => s.id === id) || null, platform: process.platform, demo: DEMO, styles: catalog.STYLES, cities: location.CITIES }; });
  ipcMain.on('view:want', (e, id, want) => {
    const v = views.get(id); if (!v) return;
    const changed = !v.want || Math.abs(v.want.width - want.width) > 24 || Math.abs(v.want.height - want.height) > 24;
    v.want = want;
    if (changed || !v.stream) restartStream(v);
  });
  ipcMain.on('view:ack', (e, id) => { const v = views.get(id); if (!v) return; v.inFlight = false; if (v.pending) sendFrame(v, v.pending); });
  ipcMain.on('view:mouse', (e, id, x, y, buttons) => { const c = client(id); c && c.mouse(x, y, buttons); });
  ipcMain.on('view:touch', (e, id, touches) => { const c = client(id); c && c.touch(touches); });
  ipcMain.on('view:wheel', (e, id, dx, dy) => { const c = client(id); c && c.wheelEvent(dx, dy); });
  ipcMain.on('view:key', (e, id, key, type) => { const c = client(id); c && c.key(key, type || 'keypress'); });
  ipcMain.on('view:text', (e, id, text) => { const c = client(id); c && c.text(text); });
  ipcMain.on('view:fit', (e, id, w, h) => {
    const v = views.get(id); if (!v || v.win.isDestroyed()) return;
    const wa = screen.getDisplayMatching(v.win.getBounds()).workArea;
    const s = Math.min(1, (wa.height * 0.92) / h, (wa.width * 0.92) / w);
    const b = v.win.getBounds();
    const nw = Math.round(w * s), nh = Math.round(h * s);
    v.win.setBounds({ x: Math.max(wa.x, Math.min(b.x, wa.x + wa.width - nw)), y: Math.max(wa.y, Math.min(b.y, wa.y + wa.height - nh)), width: nw, height: nh }, true);
  });
  ipcMain.on('view:win', (e, id, action) => {
    const v = views.get(id); if (!v || v.win.isDestroyed()) return;
    if (action === 'minimize') v.win.minimize();
    if (action === 'close') v.win.close();
    if (action === 'top') v.win.setAlwaysOnTop(!v.win.isAlwaysOnTop(), 'floating');
    if (action === 'dashboard') { if (!mainWin) createMain(); else { mainWin.show(); mainWin.focus(); } }
  });
  h('view:onTop', (id) => { const v = views.get(id); return v ? v.win.isAlwaysOnTop() : false; });
  h('view:audio', (id, on) => { const v = views.get(id); if (!v) return false; v.audioWanted = on; if (on) startAudio(v); else stopAudio(v); return on; });
  h('view:rotate', async (id, z) => { const c = client(id); if (!c) throw new Error('Not running'); await c.rotate(z); return z; });
  h('view:screenshot', async (id) => {
    const c = client(id); if (!c) throw new Error('Not running');
    const shot = await c.screenshotPng();
    const d = store.get(id);
    fs.mkdirSync(P.captures(), { recursive: true });
    const file = uniquePath(P.captures(), `${d.name} ${stamp()}.png`);
    fs.writeFileSync(file, shot.data);
    try { clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(shot.data))); } catch {}
    return file;
  });
  h('view:record', async (id, on) => {
    const s = runner.session(id); if (!s) throw new Error('Not running');
    const x = extras(id);
    if (on) {
      if (x.rec) return true;
      const remote = '/sdcard/droid-rec.mp4';
      x.rec = spawn(adb.bin, [...adb.pre, '-s', s.serial, 'shell', `screenrecord --bit-rate 8000000 ${remote}`], { env: adb.env, windowsHide: true });
      x.recStart = Date.now();
      x.recDone = new Promise((r) => x.rec.on('close', r));
      return true;
    }
    if (!x.rec) return null;
    await adb.shell(s.serial, 'pkill -INT screenrecord').catch(() => {});
    await Promise.race([x.recDone, new Promise((r) => setTimeout(r, 4000))]);
    try { x.rec.kill(); } catch {}
    x.rec = null;
    await new Promise((r) => setTimeout(r, 700));
    fs.mkdirSync(P.captures(), { recursive: true });
    const file = uniquePath(P.captures(), `${store.get(id).name} ${stamp()}.mp4`);
    await adb.pull(s.serial, '/sdcard/droid-rec.mp4', file);
    adb.rm(s.serial, '/sdcard/droid-rec.mp4').catch(() => {});
    return file;
  });
  h('view:snapshots', (id) => { const c = client(id); if (!c) throw new Error('Not running'); return c.listSnapshots(); });
  h('view:snapshot', async (id, action, name) => {
    const c = client(id); if (!c) throw new Error('Not running');
    // the emulator only keeps letters, digits, dot, dash and underscore in snapshot names
    if (action === 'save') return c.saveSnapshot(String(name || `Snapshot ${stamp()}`).trim().replace(/[^\w.-]+/g, '_').slice(0, 80));
    if (action === 'load') return c.loadSnapshot(name);
    if (action === 'delete') return c.deleteSnapshot(name);
  });
  h('view:sms', (id, from, text) => { const c = client(id); if (!c) throw new Error('Not running'); return c.sendSms(from, text); });
  h('view:battery', (id, level, charging) => { const c = client(id); if (!c) throw new Error('Not running'); return c.setBattery({ level, charging }); });
  h('view:drop', async (id, paths) => {
    const s = runner.session(id); if (!s || s.state !== 'running') throw new Error('Wait for the device to finish starting');
    const results = [];
    for (const p of paths) {
      if (!fs.existsSync(p)) continue;
      if (fs.statSync(p).isDirectory()) { await adb.push(s.serial, p, '/sdcard/Download/'); results.push({ name: path.basename(p), kind: 'folder' }); continue; }
      if (apk.isAppFile(p)) {
        const lib = uniquePath(P.apks(), path.basename(p));
        try { fs.copyFileSync(p, lib); broadcast('library:changed', null); } catch {}
        installFile(id, p).catch(() => {});
        results.push({ name: path.basename(p), kind: 'app' });
      } else {
        const remote = `/sdcard/Download/${path.basename(p)}`;
        const tid = `push-${Date.now()}`;
        broadcast('toast', { id: tid, kind: 'busy', title: 'Copying to Downloads…', text: path.basename(p), device: id });
        await adb.push(s.serial, p, remote);
        await adb.scan(s.serial, remote);
        broadcast('toast', { id: tid, kind: 'ok', title: 'Copied to Downloads', text: path.basename(p), device: id });
        results.push({ name: path.basename(p), kind: 'file' });
      }
    }
    broadcast('files:changed', { id });
    return results;
  });

  // files on the device
  h('files:list', (id, dir) => { const s = runner.session(id); if (!s) throw new Error('Not running'); return adb.ls(s.serial, dir); });
  h('files:mkdir', (id, dir) => { const s = runner.session(id); return adb.mkdir(s.serial, dir); });
  h('files:delete', (id, p) => { const s = runner.session(id); if (!/^\/(sdcard|storage)\//.test(p)) throw new Error('Only shared storage can be changed'); return adb.rm(s.serial, p); });
  h('files:push', async (id, paths, dir) => { const s = runner.session(id); for (const p of paths) { await adb.push(s.serial, p, dir.endsWith('/') ? dir : dir + '/'); await adb.scan(s.serial, (dir.endsWith('/') ? dir : dir + '/') + path.basename(p)); } return true; });
  h('files:save', async (id, remote, e) => {
    const s = runner.session(id);
    const w = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showSaveDialog(w, { defaultPath: path.join(app.getPath('downloads'), path.posix.basename(remote)) });
    if (r.canceled || !r.filePath) return null;
    await adb.pull(s.serial, remote, r.filePath);
    return r.filePath;
  });
  const pulled = new Map();
  const prepull = (id, remote) => {
    const key = `${id}:${remote}`;
    if (!pulled.has(key)) {
      const s = runner.session(id);
      const dir = path.join(P.tmp(), 'drag', String(Date.now()));
      fs.mkdirSync(dir, { recursive: true });
      const local = path.join(dir, path.posix.basename(remote));
      pulled.set(key, adb.pull(s.serial, remote, local).then(() => local));
      setTimeout(() => pulled.delete(key), 60000);
    }
    return pulled.get(key);
  };
  ipcMain.on('files:prepull', (e, id, remote) => { prepull(id, remote).catch(() => {}); });
  ipcMain.on('files:drag', async (e, id, remote) => {
    try {
      const local = await prepull(id, remote);
      e.sender.startDrag({ file: local, icon: dragIcon() });
    } catch {}
  });

  // apps
  h('apps:search', (q) => sources.fdroidSearch(q));
  h('apps:about', (pkg) => sources.fdroidAbout(pkg));
  h('apps:fdroid', async (pkg, deviceId) => {
    const meta = await sources.fdroidPackage(pkg);
    const dev = store.get(deviceId);
    let lastErr = null;
    for (const b of meta.builds.slice(0, 4)) {
      const file = path.join(P.apks(), `${pkg}_${b.versionCode}.apk`);
      const tid = `fd-${pkg}`;
      try {
        if (!fs.existsSync(file)) {
          broadcast('toast', { id: tid, kind: 'busy', title: 'Downloading from F-Droid…', text: `${pkg} ${b.versionName}` });
          await download(b.url, file, { onProgress: (p) => p.total && broadcast('toast', { id: tid, kind: 'busy', title: `Downloading from F-Droid… ${Math.round((p.got / p.total) * 100)}%`, text: `${pkg} ${b.versionName}` }) });
          broadcast('library:changed', null);
        }
        if (!dev) { broadcast('toast', { id: tid, kind: 'ok', title: 'Added to your app library', text: pkg }); return { file }; }
        // processor-specific builds: skip ones that can't run on this device
        const info = apk.inspect(file);
        if (info.abis && info.abis.length && !info.abis.includes(dev.image.abi) && meta.builds.length > 1) { lastErr = new Error('wrong processor'); continue; }
        broadcast('toast', { id: tid, kind: 'busy', title: 'Downloaded', text: pkg, done: true });
        await installFile(deviceId, file, { label: `${pkg} ${b.versionName}` });
        return { file };
      } catch (e) { lastErr = e; if (!/processor|NO_MATCHING_ABIS/i.test(e.message)) throw e; }
    }
    throw lastErr || new Error('No build of this app runs on this device');
  });
  h('library:list', () => library());
  h('library:install', (file, deviceId) => installFile(deviceId, file));
  h('library:remove', (file) => { if (path.dirname(file) !== P.apks()) throw new Error('Not in the library'); fs.rmSync(file, { force: true }); broadcast('library:changed', null); return true; });
  h('library:reveal', (file) => { shell.showItemInFolder(file); return true; });
  h('library:add', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender) || mainWin, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Android apps', extensions: ['apk', 'apkm', 'xapk', 'apks'] }] });
    if (r.canceled) return [];
    const out = [];
    for (const f of r.filePaths) { const d = uniquePath(P.apks(), path.basename(f)); fs.copyFileSync(f, d); out.push(d); }
    broadcast('library:changed', null);
    return out;
  });
  h('library:addPaths', (paths) => { const out = []; for (const f of paths) if (apk.isAppFile(f)) { const d = uniquePath(P.apks(), path.basename(f)); fs.copyFileSync(f, d); out.push(d); } broadcast('library:changed', null); return out; });
  h('apps:installed', async (id) => { const s = runner.session(id); if (!s || s.state !== 'running') return null; return adb.packages(s.serial); });
  h('apps:uninstall', async (id, pkg) => { const s = runner.session(id); await adb.uninstall(s.serial, pkg); broadcast('apps:changed', { id }); return true; });
  h('apps:launch', async (id, pkg) => { const s = runner.session(id); await adb.launch(s.serial, pkg); openDeviceWindow(id); return true; });
  h('apps:openPlay', async (id, pkg) => { const s = runner.session(id); await adb.openUrl(s.serial, pkg ? `market://details?id=${pkg}` : 'market://search?q='); openDeviceWindow(id); return true; });

  // location
  h('location:approximate', () => location.approximate());
  h('location:search', (q) => location.search(q));
  h('location:apply', (id) => applyLocation(id));

  // misc
  h('shell:open', (url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return true; });
  h('shell:reveal', (p) => { shell.showItemInFolder(p); return true; });
  h('shell:captures', () => { fs.mkdirSync(P.captures(), { recursive: true }); shell.openPath(P.captures()); return true; });
  h('dialog:dataFolder', async () => {
    const r = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory', 'createDirectory'], title: 'Choose where Droid keeps devices and Android versions' });
    if (r.canceled || !r.filePaths[0]) return null;
    if (runner.list().length) throw new Error('Stop all devices before moving the data folder.');
    const dir = r.filePaths[0];
    writeJson(pointerFile, { dir });
    return { dir, restart: true };
  });
  h('app:relaunch', () => { app.relaunch(); app.exit(0); });
}

let _dragIcon = null;
function dragIcon() {
  if (_dragIcon) return _dragIcon;
  const p = path.join(__dirname, '..', 'build', 'icon.png');
  _dragIcon = fs.existsSync(p) ? nativeImage.createFromPath(p).resize({ width: 48, height: 48 }) : nativeImage.createEmpty();
  return _dragIcon;
}
const stamp = () => { const d = new Date(); const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} at ${z(d.getHours())}.${z(d.getMinutes())}.${z(d.getSeconds())}`; };

// ───────────────────────── app lifecycle
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } else createMain(); });

app.whenReady().then(() => {
  nativeTheme.themeSource = settings.theme || 'system';
  makeServices();
  registerIpc();
  setupWebSession();
  if (isMac) {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]));
  }
  createMain();
  adb.startServer();
  // test hook: test/e2e drives the real windows through this
  if (process.env.DROID_E2E) {
    global.__droid = { get mainWin() { return mainWin; }, views, get store() { return store; }, get runner() { return runner; }, startDevice, openDeviceWindow, P, settings: () => settings };
    require(process.env.DROID_E2E)(global.__droid).catch((e) => { console.error('E2E FAILED', e); app.exit(1); });
  }
  app.on('activate', () => { if (!mainWin) createMain(); });
});

let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting || !runner || !runner.list().length) return;
  e.preventDefault();
  quitting = true;
  broadcast('toast', { kind: 'busy', title: 'Saving devices before quitting…' });
  await Promise.race([runner.stopAll(), new Promise((r) => setTimeout(r, 25000))]);
  runner.killAll();
  app.quit();
});
app.on('window-all-closed', () => { if (!isMac || !runner?.list().length) app.quit(); });
process.on('exit', () => { try { runner && runner.killAll(); } catch {} });
