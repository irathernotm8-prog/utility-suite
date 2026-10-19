'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme, net } = require('electron');
const path = require('path');
const fs = require('./lib/fsx');
const fsp = require('./lib/fsx').promises;
const { pathToFileURL } = require('url');
const { readJSON, writeJSON, exists, compareVersions, extractZip } = require('./lib/sys');
const { Library } = require('./lib/library');
const { Apps } = require('./lib/apps');
const { Sources } = require('./lib/sources');
const { SelfHub } = require('./lib/selfhub');
const { Feed } = require('./lib/feed');

const PUBLISHER = 'Bilal';
const argv = process.argv.slice(1);
const flag = (f) => argv.includes(f);
const argAfter = (f) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : null; };

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ───────────── settings ─────────────
const userData = app.getPath('userData');
const settingsFile = path.join(userData, 'settings.json');
const DEFAULTS = { desktopShortcuts: true, removeSeparateInstalls: true, scanDownloads: true, keepPackages: true, onlineUpdates: true, feedUrl: '', watchFolders: [], dismissed: [] };
let settings = { ...DEFAULTS, ...readJSON(settingsFile, {}) };
const getSettings = () => settings;
const saveSettings = (patch) => { settings = { ...settings, ...patch }; writeJSON(settingsFile, settings); };

// ───────────── core objects ─────────────
const host = { platform: process.platform, arch: process.arch };
const library = new Library(path.join(userData, 'library'), host);
const baseCtx = {
  platform: process.platform, home: app.getPath('home'), userData, env: process.env, publisher: PUBLISHER,
  desktop: app.getPath('desktop'), downloads: app.getPath('downloads'), settings: getSettings,
  shell: {
    trashItem: (p) => shell.trashItem(p),
    writeShortcutLink: (...a) => shell.writeShortcutLink(...a),
    openPath: async (p) => { const err = await shell.openPath(p); if (err) throw new Error(err); },
    showItemInFolder: (p) => shell.showItemInFolder(p),
  },
};
const apps = new Apps(baseCtx, library);
const self = new SelfHub({ ...baseCtx, execPath: process.execPath, version: app.getVersion(), apps, isDev: !app.isPackaged });
const bundleRoot = !self.installed && self.selfPath ? path.dirname(self.selfPath) : null;
const sources = new Sources({ ...baseCtx, hubVersion: app.getVersion(), bundleRoot }, library);
// online updates: feed.json (written by `./utility github`) says where `./utility publish` posts them
let feedFile = null;
try { feedFile = JSON.parse(require('fs').readFileSync(path.join(__dirname, 'feed.json'), 'utf8')); } catch {} // asar-aware fs on purpose
const feed = new Feed({ platform: process.platform, arch: process.arch, settings: getSettings, fileConfig: feedFile,
  fetch: (url, opts) => net.fetch(url, opts) });

// ───────────── window & events ─────────────
let win = null;
const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
const toast = (text, kind = 'ok') => send('toast', { text, kind });
const changed = () => send('changed');

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1080, height: 720, minWidth: 820, minHeight: 560, show: false,
    title: 'Utility Hub', backgroundColor: dark ? '#1a1e23' : '#e9ecef',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('focus', () => scheduleScan(1500));
}

function buildMenu() {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'File', submenu: [{ label: 'Add Packages…', accelerator: 'Cmd+O', click: () => send('menu', 'add-packages') }, { role: 'close' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ label: 'Check for Updates', accelerator: 'Cmd+R', click: () => { scheduleScan(0); checkOnline(true); } }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
    { role: 'windowMenu' },
  ]));
}

// ───────────── operation queue (one change at a time) ─────────────
const queue = [];
let current = null;
function enqueue(op) {
  queue.push(op);
  changed();
  pump();
  return op.done;
}
function makeOp(id, label, fn) {
  let resolve, reject;
  const done = new Promise((r, j) => { resolve = r; reject = j; });
  done.catch(() => {});
  return { id, label, fn, resolve, reject, done };
}
async function pump() {
  if (current || !queue.length) return;
  current = queue.shift();
  current.step = 'Starting'; current.fraction = null;
  changed();
  const progress = ({ step, fraction }) => {
    if (step) current.step = step;
    current.fraction = fraction ?? null;
    send('progress', { id: current.id, label: current.label, step: current.step, fraction: current.fraction });
  };
  try { current.resolve(await current.fn(progress)); }
  catch (e) { current.reject(e); toast(e.message, 'error'); }
  finally { current = null; changed(); pump(); }
}

// ───────────── scanning for packages ─────────────
let found = [];
let pendingHubUpdate = null;
let scanTimer = null;
function scheduleScan(ms = 0) { clearTimeout(scanTimer); scanTimer = setTimeout(scan, ms); }
async function scan() {
  try { found = await sources.scan(); } catch { found = []; }
  for (const f of found) if (f.hubUpdate && (!pendingHubUpdate || compareVersions(f.hubUpdate.version, pendingHubUpdate.version) > 0)) pendingHubUpdate = f.hubUpdate;
  changed();
  checkOnline(false);
}

// Ask the online feed what's current (at most every 15 minutes unless forced).
let lastOnline = 0, onlineBusy = null;
async function checkOnline(force) {
  if (!feed.enabled) { apps.remote = new Map(); return; }
  if (onlineBusy) return onlineBusy;
  if (!force && Date.now() - lastOnline < 15 * 60 * 1000) return;
  onlineBusy = (async () => {
    await feed.check();
    lastOnline = Date.now();
    if (feed.catalog) apps.remote = feed.entries();
    const h = feed.hub();
    if (h && compareVersions(h.version, app.getVersion()) > 0 && (!pendingHubUpdate || compareVersions(h.version, pendingHubUpdate.version) > 0)) {
      pendingHubUpdate = { version: h.version, remote: h };
    }
    changed();
  })().finally(() => { onlineBusy = null; });
  return onlineBusy;
}

// Before installing: download the app if the online version is newer than the hub's copy.
async function ensurePackage(id, progress) {
  const rem = apps.remote.get(id);
  const have = library.get(id);
  if (!rem || (library.hasPackage(id) && compareVersions(rem.version, have.version) <= 0)) return;
  const step = `Downloading ${rem.name} ${rem.version}`;
  progress({ step, fraction: 0 });
  await library.importRemote(rem, feed, { onProgress: (f) => progress({ step, fraction: f }) });
}

// ───────────── actions ─────────────
const nameOf = (id) => library.get(id)?.name || apps.remote.get(id)?.name || apps.state.apps[id]?.name || id;

function installOp(id) {
  const verb = apps.detect(apps.metaFor(id)) ? 'Updating' : 'Installing';
  return makeOp(id, `${verb} ${nameOf(id)}`, async (progress) => {
    await ensurePackage(id, progress);
    const r = await apps.install(id, { onStep: progress });
    if (!settings.keepPackages) await library.remove(id);
    toast(r.updatedFrom ? `Updated ${nameOf(id)} to ${r.version}` : `Installed ${nameOf(id)} ${r.version}`);
    return r;
  });
}

async function importSource(src) {
  return enqueue(makeOp('import', 'Adding packages', async (progress) => {
    progress({ step: 'Opening' });
    const dir = await sources.open(src);
    try {
      const desc = sources.describe(dir);
      const r = await library.importFrom(dir, { onProgress: ({ name, fraction }) => progress({ step: `Copying ${name}`, fraction }) });
      if (desc?.hubUpdate) {
        // copy the newer hub out now, so the update still works after the download goes away
        progress({ step: 'Copying the new Utility Hub' });
        const staged = await self.stageCopy(desc.hubUpdate.path, path.join(userData, 'hub-update', desc.hubUpdate.version));
        pendingHubUpdate = { version: desc.hubUpdate.version, path: staged };
      }
      const names = r.imported.map((i) => `${i.name} ${i.version}`);
      const damaged = r.skipped.filter((s) => s.action === 'damaged' || s.action === 'missing');
      if (names.length) toast(`Added ${names.join(', ')}`);
      else if (!desc?.hubUpdate) toast('Nothing new in those packages. You already have every app in them.', 'info');
      for (const d of damaged) toast(d.reason, 'error');
      return r;
    } finally {
      await sources.close(src);
      scheduleScan(0);
    }
  }));
}

function installedCount() { return library.list().filter((m) => apps.detect(m)).length; }

ipcMain.handle('state', async () => {
  const rows = await apps.rows();
  return {
    hub: {
      version: app.getVersion(), installed: self.installed, canManageSelf: self.canManageSelf, platform: process.platform, arch: process.arch,
      dev: !app.isPackaged, welcome: self.canManageSelf && !self.installed,
      update: pendingHubUpdate && self.installed ? { version: pendingHubUpdate.version } : null,
    },
    rows: rows.map((r) => ({ ...r, icon: !r.icon ? null : /^https?:/.test(r.icon) ? r.icon : exists(r.icon) ? pathToFileURL(r.icon).href : null })),
    online: { configured: !!feed.config, enabled: feed.enabled, label: feed.config?.label || null, lastChecked: feed.lastChecked, error: feed.error, checking: !!onlineBusy },
    sources: found.map((f) => ({ path: f.path, kind: f.kind, stamp: f.stamp, suiteVersion: f.suiteVersion, unopened: !!f.unopened, news: f.news || [], apps: (f.apps || []).map((a) => ({ ...a, icon: a.icon && exists(a.icon) ? pathToFileURL(a.icon).href : null })), fromBundle: !!bundleRoot && f.path.startsWith(bundleRoot), where: describeWhere(f.path) })),
    settings,
    library: { bytes: library.sizeBytes(), count: library.list().filter((m) => library.hasPackage(m.id)).length, dir: library.dir },
    busy: current ? { id: current.id, label: current.label, step: current.step, fraction: current.fraction } : null,
    queued: queue.map((q) => ({ id: q.id, label: q.label })),
  };
});

function describeWhere(p) {
  const h = app.getPath('home');
  if (p.startsWith('/Volumes/')) return `the disk “${p.split('/')[2]}”`;
  if (p.startsWith(app.getPath('downloads'))) return 'Downloads';
  if (p.startsWith(app.getPath('desktop'))) return 'the Desktop';
  return p.startsWith(h) ? p.replace(h, '~') : p;
}

ipcMain.handle('install', (_e, id) => enqueue(installOp(id)));
ipcMain.handle('install-many', (_e, ids) => Promise.all(ids.map((id) => enqueue(installOp(id)))));
ipcMain.handle('uninstall', (_e, id) => enqueue(makeOp(id, `Removing ${nameOf(id)}`, async (progress) => {
  await apps.uninstall(id, { onStep: progress });
  toast(`Removed ${nameOf(id)}. Its settings and files are still on this computer.`);
})));
ipcMain.handle('open', (_e, id) => apps.open(id));
ipcMain.handle('reveal', (_e, id) => apps.reveal(id));
ipcMain.handle('refresh', async () => { apps._separate = null; await Promise.all([scan(), checkOnline(true)]); });

ipcMain.handle('import', (_e, p) => importSource(p));
ipcMain.handle('pick-packages', async (_e, kind) => {
  const isWin = process.platform === 'win32';
  const props = kind === 'file' ? ['openFile'] : kind === 'folder' ? ['openDirectory'] : isWin ? ['openDirectory'] : ['openFile', 'openDirectory'];
  const r = await dialog.showOpenDialog(win, {
    title: 'Add packages', buttonLabel: 'Add', properties: props,
    message: 'Choose a Utility Suite download: the .dmg/.zip, or the folder with Packages inside.',
    filters: kind === 'folder' ? [] : [{ name: 'Utility Suite', extensions: isWin ? ['zip'] : ['dmg', 'zip'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return importSource(r.filePaths[0]);
});
ipcMain.handle('dismiss-source', (_e, stamp) => { saveSettings({ dismissed: [...new Set([...(settings.dismissed || []), stamp])].slice(-50) }); found = found.filter((f) => f.stamp !== stamp); changed(); });

ipcMain.handle('install-hub', (_e, ids = []) => enqueue(makeOp('hub', 'Installing Utility Hub', async (progress) => {
  const src = found.find((f) => f.kind === 'folder' && f.news?.length) || found.find((f) => f.kind === 'folder');
  if (src && ids.length) {
    const dir = await sources.open(src);
    try { await library.importFrom(dir, { onProgress: ({ name, fraction }) => progress({ step: `Copying ${name}`, fraction }) }); }
    finally { await sources.close(src); }
  }
  progress({ step: 'Installing Utility Hub' });
  const target = await self.installSelf();
  for (const id of ids) {
    await ensurePackage(id, ({ step, fraction }) => progress({ step: `${nameOf(id)}: ${step}`, fraction }));
    if (!library.hasPackage(id)) continue;
    progress({ step: `Installing ${nameOf(id)}` });
    await apps.install(id, { onStep: ({ step }) => progress({ step: `${nameOf(id)}: ${step}` }) });
  }
  progress({ step: 'Opening Utility Hub' });
  await sources.closeAll();
  app.releaseSingleInstanceLock(); // let the installed copy start while this one closes
  self.relaunch(target);
  setTimeout(() => app.quit(), 600);
})));

ipcMain.handle('update-hub', () => enqueue(makeOp('hub', 'Updating Utility Hub', async (progress) => {
  if (!pendingHubUpdate) throw new Error('No Utility Hub update is waiting.');
  let staged = pendingHubUpdate.path;
  if (pendingHubUpdate.remote) {
    // download the new hub, unpack it next to us, then swap it in after we quit
    const h = pendingHubUpdate.remote;
    const dir = path.join(userData, 'hub-update', h.version);
    await fsp.rm(dir, { recursive: true, force: true });
    const zip = path.join(userData, 'hub-update', `${h.version}.zip`);
    await feed.download(h.file, zip, { sha256: h.sha256, size: h.size, onProgress: (f) => progress({ step: `Downloading Utility Hub ${h.version}`, fraction: f }) });
    progress({ step: 'Unpacking' });
    await extractZip(zip, dir, process.platform);
    await fsp.rm(zip, { force: true });
    staged = path.join(dir, h.bundle || h.folder || (process.platform === 'darwin' ? 'Utility Hub.app' : 'Utility Hub'));
    if (!exists(staged)) throw new Error('The downloaded Utility Hub update is incomplete. Try again.');
  } else if (!staged.startsWith(userData)) {
    progress({ step: 'Copying the new version' });
    staged = await self.stageCopy(staged, path.join(userData, 'hub-update', pendingHubUpdate.version));
  }
  await sources.closeAll();
  self.scheduleSelfUpdate(staged);
  setTimeout(() => app.quit(), 300);
})));

async function removeHub(removeApps) {
  if (removeApps) {
    for (const m of apps.allMeta()) if (apps.detect(m)) await apps.uninstall(m.id).catch(() => {});
  }
  await self.uninstallSelf();
}
ipcMain.handle('remove-hub', async (_e, removeApps) => { await removeHub(removeApps); setTimeout(() => app.quit(), 300); });

ipcMain.handle('settings', (_e, patch) => { saveSettings(patch); if ('scanDownloads' in patch || 'watchFolders' in patch) scheduleScan(0); if ('onlineUpdates' in patch || 'feedUrl' in patch) checkOnline(true); changed(); return settings; });
ipcMain.handle('add-watch-folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Watch a folder for new packages', buttonLabel: 'Watch', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return settings;
  saveSettings({ watchFolders: [...new Set([...(settings.watchFolders || []), r.filePaths[0]])] });
  scheduleScan(0); changed();
  return settings;
});
ipcMain.handle('remove-watch-folder', (_e, p) => { saveSettings({ watchFolders: (settings.watchFolders || []).filter((x) => x !== p) }); scheduleScan(0); changed(); return settings; });
ipcMain.handle('remove-package', async (_e, id) => { await library.remove(id); changed(); });
ipcMain.handle('show-library', () => shell.openPath(library.dir));

ipcMain.handle('find-old-copies', async () => {
  apps._separate = null;
  const skip = [bundleRoot, self.selfPath].filter(Boolean);
  return apps.findOtherCopies(skip);
});
ipcMain.handle('remove-old-copies', (_e, items) => enqueue(makeOp('cleanup', 'Removing old copies', async (progress) => {
  let n = 0;
  const failed = [];
  for (const item of items) {
    progress({ step: `Removing ${item.name}`, fraction: n / items.length });
    try { await apps.removeOtherCopy(item); } catch (e) { failed.push(`${item.name}: ${e.message}`); }
    n++;
  }
  apps._separate = null;
  if (failed.length) toast(`Couldn't remove ${failed.length} item(s). ${failed[0]}`, 'error');
  else toast(`Removed ${n} old cop${n === 1 ? 'y' : 'ies'}. Loose files went to the Recycle Bin / Trash.`);
})));

// ───────────── startup ─────────────
async function handleUninstallFlag() {
  const n = installedCount();
  const r = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
    type: 'question', buttons: ['Remove Utility Hub', 'Cancel'], defaultId: 0, cancelId: 1,
    title: 'Remove Utility Hub', message: 'Remove Utility Hub from this computer?',
    detail: 'Apps you keep will still work; you just won’t be able to update them from the hub.',
    checkboxLabel: n ? `Also remove the ${n} app${n === 1 ? '' : 's'} it installed (their settings and files are kept)` : undefined,
    checkboxChecked: false,
  });
  if (r.response === 0) { await removeHub(r.checkboxChecked); app.quit(); }
  else if (!win) app.quit();
}

app.on('second-instance', (_e, args) => {
  if (args.includes('--uninstall')) { handleUninstallFlag(); return; } // from Settings > Apps while the hub is open
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  const i = args.indexOf('--import');
  if (i !== -1 && args[i + 1]) importSource(args[i + 1]);
});

app.whenReady().then(async () => {
  if (flag('--uninstall')) return handleUninstallFlag();
  buildMenu();
  // clean up leftovers from earlier runs
  await fsp.rm(path.join(userData, 'incoming'), { recursive: true, force: true }).catch(() => {});
  await fsp.rm(path.join(userData, 'staging'), { recursive: true, force: true }).catch(() => {});
  if (self.installed && process.platform === 'win32') self.registerWindows().catch(() => {}); // keeps version in Settings > Apps current
  // a hub update copied over in an earlier session is still waiting; older ones are done with
  for (const v of await fsp.readdir(path.join(userData, 'hub-update')).catch(() => [])) {
    const dir = path.join(userData, 'hub-update', v);
    if (v.endsWith('.zip') || v.endsWith('.partial')) { await fsp.rm(dir, { force: true }).catch(() => {}); continue; }
    const inner = (await fsp.readdir(dir).catch(() => [])).map((n) => path.join(dir, n))[0];
    if (inner && compareVersions(v, app.getVersion()) > 0) {
      if (!pendingHubUpdate || compareVersions(v, pendingHubUpdate.version) > 0) pendingHubUpdate = { version: v, path: inner };
    } else await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  createWindow();
  await Promise.all([scan(), checkOnline(true)]);
  const imp = argAfter('--import');
  if (imp) importSource(imp);
  setInterval(() => scheduleScan(0), 90 * 1000);
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { sources.closeAll(); });
