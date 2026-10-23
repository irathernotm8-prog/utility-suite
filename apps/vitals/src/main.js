// Vitals — main process. Owns the samplers, the focus tracker and every system action; the window only asks.
'use strict';
const { app, BrowserWindow, ipcMain, nativeTheme, shell, dialog, Menu, Tray, nativeImage, powerMonitor, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

if (process.env.VITALS_USER_DATA) app.setPath('userData', process.env.VITALS_USER_DATA);
if (!app.requestSingleInstanceLock()) { app.exit(0); }

const { Sampler } = require('./sys/metrics');
const processes = require('./sys/processes');
const apps = require('./sys/apps');
const startup = require('./sys/startup');
const perms = require('./sys/perms');
const specs = require('./sys/specs');
const checkup = require('./sys/checkup');
const { FocusTracker } = require('./sys/focus');
const { stopShells } = require('./sys/run');
const { reportHtml } = require('./report');

const isMac = process.platform === 'darwin';
let win = null, tray = null, quitting = false;

// ---------------------------------------------------------------- settings & small state
const DEFAULTS = {
  theme: 'system', interval: 2000, tempUnit: 'C', focusTracking: true, idleMinutes: 3, focusSessionMinutes: 25, keepRunning: true, openAtLogin: false,
  menuBarStat: 'cpu', showSerials: false, focusCategories: {}, activityGroup: true, activityKind: 'all', sidebarCollapsed: false, notifyHot: true
};
const file = (n) => path.join(app.getPath('userData'), n);
function readJson(n, d) { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } }
function writeJson(n, v) { try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(file(n), JSON.stringify(v, null, 1)); } catch (_) {} }
let settingsCache = null;
const settings = () => (settingsCache = settingsCache || { ...DEFAULTS, ...readJson('settings.json', {}) });
function saveSettings(patch) {
  settingsCache = { ...settings(), ...patch }; writeJson('settings.json', settingsCache);
  if ('theme' in patch) nativeTheme.themeSource = settingsCache.theme;
  if ('interval' in patch) sampler.setInterval(settingsCache.interval);
  if ('openAtLogin' in patch) applyLoginItem();
  if ('menuBarStat' in patch) updateTray(sampler.last);
  if ('focusTracking' in patch) updateTrayMenu();
  return settingsCache;
}
const kv = { data: null, load() { this.data = this.data || readJson('state.json', {}); return this.data; }, get(k) { return this.load()[k]; }, set(k, v) { this.load()[k] = v; writeJson('state.json', this.data); }, delete(k) { delete this.load()[k]; writeJson('state.json', this.data); } };

const send = (ch, d) => { if (win && !win.isDestroyed() && win.isVisible()) win.webContents.send('vitals:' + ch, d); };

// ---------------------------------------------------------------- live data
const sampler = new Sampler({
  onTick: (s) => { send('tick', s); updateTray(s); hotWatch(s); if (wantProcs()) pushProcs(); },
  getThermalState: () => { try { return isMac && powerMonitor.getCurrentThermalState ? powerMonitor.getCurrentThermalState() : null; } catch { return null; } }
});
let procSubs = 0, lastProcs = null, procBusy = false;
const wantProcs = () => procSubs > 0 && win && win.isVisible();
async function pushProcs() {
  if (procBusy) return; procBusy = true;
  try { lastProcs = await processes.snapshot(); send('procs', lastProcs); } catch (_) {} finally { procBusy = false; }
}
let hotSince = 0, hotNotified = 0;
function hotWatch(s) {
  if (!settings().notifyHot) return;
  const hot = (s.thermal && (s.thermal.state === 'serious' || s.thermal.state === 'critical')) || (s.thermal && s.thermal.cpu >= 98) || (s.mem && s.mem.pressure === 'critical');
  if (!hot) { hotSince = 0; return; }
  if (!hotSince) hotSince = Date.now();
  if (Date.now() - hotSince > 60000 && Date.now() - hotNotified > 30 * 60000 && Notification.isSupported()) {
    hotNotified = Date.now();
    const what = s.mem && s.mem.pressure === 'critical' ? 'Memory is under heavy pressure' : 'Your computer is running hot';
    const n = new Notification({ title: 'Vitals', body: `${what}. Click to see what’s using it.` });
    n.on('click', () => { showWindow(); send('navigate', 'activity'); }); n.show();
  }
}

// ---------------------------------------------------------------- focus
const focus = new FocusTracker({ dir: file('focus'), settings, idleTime: () => { try { return powerMonitor.getSystemIdleTime(); } catch { return 0; } }, onChange: () => {} });

// ---------------------------------------------------------------- caches for slow lists
const cacheOf = { apps: null, appsAt: 0, startup: null, perms: null, specs: null };
let sizing = false;
async function listApps(force) {
  if (!force && cacheOf.apps && Date.now() - cacheOf.appsAt < 5 * 60000) return withSeen(cacheOf.apps);
  const sizes = kv.get('appSizes') || {};
  const list = await apps.list();
  for (const a of list) if (a.size == null && sizes[a.path] && sizes[a.path].m === a.modified) a.size = sizes[a.path].s;
  cacheOf.apps = list; cacheOf.appsAt = Date.now();
  sizeInBackground();
  return withSeen(list);
}
function withSeen(list) {
  const seen = focus.lastSeen();
  return list.map((a) => { const k = (a.bundleId || '').toLowerCase(); const s = (k && seen[k]) || Object.values(seen).find((x) => x.path && a.path && x.path === a.path); return s ? { ...a, seenDay: s.day } : a; });
}
async function sizeInBackground() {
  if (sizing || process.platform === 'win32' || !cacheOf.apps) return; sizing = true;
  const sizes = kv.get('appSizes') || {};
  const todo = cacheOf.apps.filter((a) => a.size == null && a.path);
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map(async (a) => { const s = await apps.sizeOf(a.path); if (s != null) { a.size = s; sizes[a.path] = { s, m: a.modified }; send('apps:size', { id: a.id, size: s }); } }));
  }
  kv.set('appSizes', sizes); sizing = false;
}

// ---------------------------------------------------------------- icons (one at a time; macOS can crash on bursts of getFileIcon)
const iconCache = new Map(); let iconChain = Promise.resolve();
function iconFor(p) {
  if (!p) return Promise.resolve(null);
  if (iconCache.has(p)) return Promise.resolve(iconCache.get(p));
  const job = iconChain.then(async () => {
    if (iconCache.has(p)) return iconCache.get(p);
    let url = null;
    try { if (fs.existsSync(p)) { const img = await app.getFileIcon(p, { size: isMac ? 'large' : 'normal' }); if (img && !img.isEmpty()) url = img.resize({ width: 64, height: 64, quality: 'best' }).toDataURL(); } } catch (_) {}
    iconCache.set(p, url); return url;
  });
  iconChain = job.catch(() => null);
  return job;
}

// ---------------------------------------------------------------- report
async function exportReport() {
  const s = sampler.last; const sp = cacheOf.specs || (cacheOf.specs = await specs.collect());
  const procs = lastProcs || await processes.snapshot();
  const st = cacheOf.startup || (await startup.list({ loginItems: false })).items;
  const ck = checkup.run({ sample: s, procs: procs.groups, apps: cacheOf.apps, startup: st, perms: cacheOf.perms, platform: process.platform, history: sampler.history, cores: os.cpus().length });
  const r = await dialog.showSaveDialog(win, { title: 'Save health report', defaultPath: path.join(app.getPath('documents'), `Vitals report ${new Date().toISOString().slice(0, 10)}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }, { name: 'Web page', extensions: ['html'] }] });
  if (r.canceled || !r.filePath) return null;
  const html = reportHtml({ specs: sp, sample: s, checkup: ck, procs: procs.groups, startup: st, focus: focus.summary(7), showSerials: settings().showSerials, version: app.getVersion() });
  if (/\.html?$/i.test(r.filePath)) { fs.writeFileSync(r.filePath, html); shell.showItemInFolder(r.filePath); return r.filePath; }
  const tmp = path.join(app.getPath('temp'), `vitals-report-${Date.now()}.html`); fs.writeFileSync(tmp, html);
  const w = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true, contextIsolation: true } });
  try { await w.loadFile(tmp); fs.writeFileSync(r.filePath, await w.webContents.printToPDF({ printBackground: true, pageSize: 'Letter', margins: { marginType: 'default' } })); }
  finally { w.destroy(); fs.rm(tmp, { force: true }, () => {}); }
  shell.showItemInFolder(r.filePath);
  return r.filePath;
}

// ---------------------------------------------------------------- IPC
const h = (name, fn) => ipcMain.handle('vitals:' + name, async (_e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } });
function registerIpc() {
  h('bootstrap', () => ({ settings: settings(), platform: process.platform, arch: process.arch, version: app.getVersion(), history: sampler.history, last: sampler.last, procs: lastProcs, cores: os.cpus().length, hostname: os.hostname(), user: os.userInfo().username, focusCurrent: focus.current(), paused: focus.paused }));
  h('settings:set', (p) => saveSettings(p || {}));
  h('procs:subscribe', (on) => { procSubs = Math.max(0, procSubs + (on ? 1 : -1)); if (on) pushProcs(); return lastProcs; });
  h('procs:now', () => processes.snapshot());
  h('procs:quit', (pids, force) => processes.quit(pids, { force }).then((r) => { setTimeout(pushProcs, 600); if (!r.ok) throw new Error(r.error); return r; }));
  h('specs', async (fresh) => (cacheOf.specs = (!fresh && cacheOf.specs) || await specs.collect()));
  h('apps:list', (force) => listApps(force));
  h('apps:leftovers', (a) => (isMac ? apps.macLeftovers(a) : []));
  h('apps:leftover-sizes', async (paths) => { const out = {}; for (const p of paths || []) out[p] = await apps.sizeOf(p); return out; });
  h('apps:uninstall', async (a, leftovers) => { const r = await apps.uninstall(a, { leftovers, trashItem: (p) => shell.trashItem(p) }); if (r.done) { cacheOf.apps = (cacheOf.apps || []).filter((x) => x.id !== a.id); } return r; });
  h('apps:check', (a) => apps.stillInstalled(a));
  h('startup:list', async (o) => { const r = await startup.list(o || {}); const offLogin = Object.entries(kv.load()).filter(([k]) => k.startsWith('login:')).map(([, v]) => ({ ...v, enabled: false })); r.items = [...r.items.filter((i) => !offLogin.some((o2) => o2.id === i.id)), ...offLogin]; cacheOf.startup = r.items; return r; });
  h('startup:toggle', (item, enable) => startup.toggle(item, enable, kv));
  h('perms:list', async () => { const r = await perms.list(); cacheOf.perms = r.rows; return r; });
  h('perms:revoke', (row) => perms.revoke(row));
  h('perms:allow', (row) => perms.allow(row));
  h('perms:open-settings', (row) => { const u = row ? perms.settingsUrl(row) : (isMac ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles' : 'ms-settings:privacy'); if (u) shell.openExternal(u); return true; });
  h('focus:summary', (days) => ({ days: focus.summary(days || 7), current: focus.current(), paused: focus.paused }));
  h('focus:category', (key, cat) => { const c = { ...(settings().focusCategories || {}) }; if (cat) c[key] = cat; else delete c[key]; saveSettings({ focusCategories: c }); return c; });
  h('focus:pause', (on) => { focus.paused = !!on; updateTrayMenu(); return focus.paused; });
  h('focus:clear', () => { focus.clear(); return true; });
  h('checkup', async (deep) => {
    if (deep || !cacheOf.startup) { try { cacheOf.startup = (await startup.list({ loginItems: false })).items; } catch (_) {} }
    if (deep || !cacheOf.apps) { try { await listApps(); } catch (_) {} }
    if (deep && !cacheOf.perms) { try { cacheOf.perms = (await perms.list()).rows; } catch (_) {} }
    const procs = lastProcs || await processes.snapshot();
    return checkup.run({ sample: sampler.last, procs: procs.groups, apps: cacheOf.apps, startup: cacheOf.startup, perms: cacheOf.perms, platform: process.platform, history: sampler.history, cores: os.cpus().length });
  });
  h('report', () => exportReport());
  h('icons', async (paths) => { const out = {}; for (const p of (paths || []).slice(0, 80)) out[p] = await iconFor(p); return out; });
  h('reveal', (p) => { if (p) shell.showItemInFolder(p); return true; });
  h('open-external', (u) => { if (/^(https?:|x-apple\.systempreferences:|ms-settings:)/.test(u)) shell.openExternal(u); return true; });
  h('open-system-monitor', () => { if (isMac) shell.openPath('/System/Applications/Utilities/Activity Monitor.app'); else if (process.platform === 'win32') require('child_process').spawn('taskmgr.exe', { detached: true, stdio: 'ignore' }).unref(); return true; });
  h('window:chrome', (c) => { if (!isMac && win && win.setTitleBarOverlay) { try { win.setTitleBarOverlay(c); } catch (_) {} } return true; });
}

// ---------------------------------------------------------------- tray / menu bar
const fmtPct = (v) => (v == null ? '–' : `${Math.round(v)}%`);
function trayLabel(s) {
  if (!s) return '';
  const k = settings().menuBarStat;
  if (k === 'cpu') return `CPU ${fmtPct(s.cpu.total)}`;
  if (k === 'mem') return `Mem ${fmtPct(s.mem.pct)}`;
  if (k === 'temp') return s.thermal && s.thermal.cpu != null ? `${Math.round(settings().tempUnit === 'F' ? s.thermal.cpu * 9 / 5 + 32 : s.thermal.cpu)}°` : '';
  return '';
}
function updateTray(s) {
  if (!tray || tray.isDestroyed()) return;
  if (isMac) tray.setTitle(trayLabel(s), { fontType: 'monospacedDigit' });
  if (s) tray.setToolTip(`Vitals — CPU ${fmtPct(s.cpu.total)} · Memory ${fmtPct(s.mem.pct)}`);
}
function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const s = settings();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Vitals', click: showWindow },
    { type: 'separator' },
    { label: 'Pause time tracking', type: 'checkbox', checked: focus.paused, enabled: s.focusTracking, click: (m) => { focus.paused = m.checked; send('focus:paused', focus.paused); } },
    { type: 'separator' },
    { label: 'Quit Vitals', click: () => { quitting = true; app.quit(); } }
  ]));
}
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', isMac ? 'trayTemplate.png' : 'icon.png'));
  const icon = isMac ? img : img.resize({ width: 16, height: 16 });
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Vitals');
  updateTrayMenu();
  if (!isMac) tray.on('click', showWindow);
}
function applyLoginItem() {
  try { app.setLoginItemSettings({ openAtLogin: !!settings().openAtLogin, openAsHidden: true, args: ['--hidden'] }); } catch (_) {}
}

// ---------------------------------------------------------------- window
function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1380, height: 900, minWidth: 1020, minHeight: 640, show: false, title: 'Vitals',
    backgroundColor: dark ? '#0b0f12' : '#f4f6f6',
    titleBarStyle: 'hidden', ...(isMac ? { trafficLightPosition: { x: 16, y: 15 } } : { titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#e6ecea' : '#22302c', height: 46 } }),
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: true }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  const hidden = process.argv.includes('--hidden') || (app.getLoginItemSettings && app.getLoginItemSettings().wasOpenedAsHidden);
  win.once('ready-to-show', () => { if (!hidden || process.env.VITALS_E2E) win.show(); });
  win.on('close', (e) => {
    if (!quitting && settings().keepRunning) { e.preventDefault(); win.hide(); if (isMac && app.dock) { /* stays in the dock; the menu bar keeps tracking */ } }
  });
  win.on('show', () => { send('visible', true); if (sampler.last) send('tick', sampler.last); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; });
}
function showWindow() { if (!win) createWindow(); else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } }

function menu() {
  const tpl = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [{ label: 'Save Health Report…', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('menu', 'report') }, { type: 'separator' }, isMac ? { role: 'close' } : { label: 'Quit', click: () => { quitting = true; app.quit(); } }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      ...['overview', 'activity', 'apps', 'startup', 'permissions', 'focus', 'thermals', 'specs', 'checkup'].map((p, i) => ({ label: p === 'specs' ? (isMac ? 'This Mac' : 'This PC') : p[0].toUpperCase() + p.slice(1), accelerator: `CmdOrCtrl+${i + 1}`, click: () => send('navigate', p) })),
      { type: 'separator' }, { role: 'reload', accelerator: 'CmdOrCtrl+Shift+R' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.on('second-instance', showWindow);
app.whenReady().then(() => {
  nativeTheme.themeSource = settings().theme;
  registerIpc(); menu();
  try { if (process.platform === 'win32') require('systeminformation').powerShellStart(); } catch (_) {}
  sampler.interval = settings().interval; sampler.start();
  focus.start();
  powerMonitor.on('lock-screen', () => focus.setLocked(true));
  powerMonitor.on('unlock-screen', () => focus.setLocked(false));
  powerMonitor.on('suspend', () => focus.setLocked(true));
  powerMonitor.on('resume', () => focus.setLocked(false));
  createWindow();
  try { createTray(); } catch (_) {}
  applyLoginItem();
  if (process.env.VITALS_E2E) require(process.env.VITALS_E2E)({ win, app, sampler, focus, settings, saveSettings, kv });
  app.on('activate', showWindow);
});
app.on('before-quit', () => { quitting = true; try { focus.stop(); } catch (_) {} sampler.stop(); stopShells(); try { if (process.platform === 'win32') require('systeminformation').powerShellRelease(); } catch (_) {} });
app.on('window-all-closed', () => { if (!settings().keepRunning && !isMac) app.quit(); });
