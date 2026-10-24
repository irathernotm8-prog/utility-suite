// Cadence — main process: the window, the menu-bar / tray icon, settings, the engine and its services
// (browser, PDF, notifications), the Claude/Codex plugin bridge, and everything the window asks for.
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, Tray, Notification, nativeImage, powerMonitor, powerSaveBlocker, safeStorage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Engine } = require('./core/engine');
const { STEPS, GROUPS, TRIGGERS, COMMON, BROWSER_ACTIONS, SLIDE_LAYOUTS, TESTS, PROVIDERS, defaults } = require('./core/catalog');
const { TEMPLATES } = require('./core/templates');
const { describe, nextRun } = require('./core/schedule');
const { dateContext } = require('./core/dates');
const { readJson, writeJson } = require('./core/store');
const { Browser } = require('./browser');
const connectors = require('./connectors');
const { makeHandlers } = require('./mcp-handlers');
const ai = require('./core/ai');
const aiBuild = require('./core/ai-build');

const IS_MAC = process.platform === 'darwin';
const DEMO = process.env.CADENCE_DEMO === '1';
if (process.env.CADENCE_USER_DATA) app.setPath('userData', process.env.CADENCE_USER_DATA);
app.setName('Cadence');
if (process.platform === 'win32') app.setAppUserModelId('com.bilal.cadence');

let startHidden = process.argv.includes('--hidden');
if (!DEMO && !process.env.CADENCE_E2E && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ───────────────────────── settings
const USER = app.getPath('userData');
const SETTINGS = path.join(USER, 'settings.json');
const DEFAULTS = { theme: 'system', weekStart: 1, background: true, openAtLogin: true, notify: 'all', keepRunDays: 14, outputRoot: '', onboarded: false, aiProvider: 'auto' };
let settings = { ...DEFAULTS, ...readJson(SETTINGS, {}) };
const saveSettings = () => writeJson(SETTINGS, settings);

// ───────────────────────── services
const crypt = {
  encrypt: (s) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s).toString('base64') : 'p:' + Buffer.from(s).toString('base64')),
  decrypt: (s) => (s.startsWith('p:') ? Buffer.from(s.slice(2), 'base64').toString() : safeStorage.decryptString(Buffer.from(s, 'base64'))),
};
let engine, browser, win = null, tray = null, quitting = false, blocker = null;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

function notify(title, body, open) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body: body || '', silent: false });
  n.on('click', () => { if (open) { if (/^https?:/.test(open)) shell.openExternal(open); else shell.openPath(open); } else showWindow(); });
  n.show();
}
async function printPDF(html, dest) {
  const tmp = path.join(os.tmpdir(), `cadence-report-${Date.now()}.html`);
  fs.writeFileSync(tmp, html);
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await w.loadFile(tmp);
    const buf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'none' }, preferCSSPageSize: true });
    fs.writeFileSync(dest, buf);
  } finally { w.destroy(); try { fs.unlinkSync(tmp); } catch {} }
}

function boot() {
  engine = new Engine({
    root: USER, crypt, settings: () => settings,
    services: {
      documents: app.getPath('documents'), notify, pdf: printPDF,
      open: (t) => (/^https?:/.test(t) ? shell.openExternal(t) : shell.openPath(t).then((e) => { if (e) throw new Error(e); })),
      trash: (p) => shell.trashItem(p),
    },
  });
  browser = new Browser({ store: engine.store });
  engine.services.browser = browser;
  engine.services.outputRoot = settings.outputRoot || '';

  engine.on('run', (s) => send('run:update', s));
  engine.on('flows', () => { send('flows:changed'); updateTray(); });
  engine.on('runEnd', (s) => {
    const bg = !win || win.isDestroyed() || !win.isVisible() || !win.isFocused();
    const want = settings.notify === 'all' || (settings.notify === 'failures' && s.status === 'failed');
    const already = s.steps.some((x) => x.type === 'logic.notify' && x.status === 'done');
    if (bg && want && !already && s.status !== 'cancelled' && !s.partial) notify(s.status === 'done' ? `${s.flowName} finished` : `${s.flowName} failed`, s.status === 'done' ? (s.files.length ? `${s.files.length} file${s.files.length === 1 ? '' : 's'} made` : 'All steps done') : s.error || '', s.status === 'done' && s.files.length ? s.files[s.files.length - 1] : null);
    holdAwake();
  });
  engine.on('run', () => holdAwake());

  if (DEMO) require('./demo').seed(engine);
  engine.startScheduler();
  engine.store.pruneRunDirs(Number(settings.keepRunDays) || 14);
  setInterval(() => engine.store.pruneRunDirs(Number(settings.keepRunDays) || 14), 6 * 3600e3).unref();

  // The plugin: Claude / Codex talk to Cadence through this bridge.
  const handle = makeHandlers(engine, { settings: () => settings, onActivity: (msg, flowId) => send('ai:activity', { msg, flowId, at: Date.now() }) });
  connectors.startBridge(handle, (st) => send('bridge:status', st));
  connectors.refreshInstalled();

  // Catch up after sleep, and keep the computer from napping mid-run.
  powerMonitor.on('resume', () => setTimeout(() => engine.tick(), 4000));
  powerMonitor.on('unlock-screen', () => engine.tick());
}
function holdAwake() {
  const busy = [...engine.live.values()].some((r) => r.status === 'running');
  if (busy && blocker == null) blocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!busy && blocker != null) { powerSaveBlocker.stop(blocker); blocker = null; }
}
function applyLogin() {
  try { app.setLoginItemSettings({ openAtLogin: !!settings.openAtLogin, openAsHidden: true, args: ['--hidden'] }); } catch {}
}
function applyTheme() { nativeTheme.themeSource = ['light', 'dark'].includes(settings.theme) ? settings.theme : 'system'; }

// ───────────────────────── window & tray
function createWindow() {
  win = new BrowserWindow({
    width: 1340, height: 880, minWidth: 1020, minHeight: 660, show: false, title: 'Cadence',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0b12' : '#f6f5f9',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
    titleBarOverlay: IS_MAC ? undefined : { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ebe7f5' : '#1c1a24', height: 44 },
    trafficLightPosition: { x: 16, y: 16 },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!startHidden || DEMO) win.show(); });
  win.on('close', (e) => { if (!quitting && settings.background) { e.preventDefault(); win.hide(); if (IS_MAC && app.dock) app.dock.hide(); } });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  nativeTheme.on('updated', () => { if (!IS_MAC && win && !win.isDestroyed()) try { win.setTitleBarOverlay({ symbolColor: nativeTheme.shouldUseDarkColors ? '#ebe7f5' : '#1c1a24' }); } catch {} });
}
function showWindow() {
  if (IS_MAC && app.dock) app.dock.show();
  if (!win || win.isDestroyed()) createWindow();
  win.once('ready-to-show', () => win.show());
  if (win.webContents && !win.webContents.isLoading()) { win.show(); win.focus(); }
}
function trayImage() {
  const dir = path.join(__dirname, '..', 'build');
  if (IS_MAC) { const img = nativeImage.createFromPath(path.join(dir, 'trayTemplate.png')); img.setTemplateImage(true); return img; }
  return nativeImage.createFromPath(path.join(dir, 'tray.png'));
}
function updateTray() {
  if (!tray) return;
  const flows = engine.list();
  const next = flows.filter((f) => f.nextAt).sort((a, b) => a.nextAt - b.nextAt)[0];
  const running = [...engine.live.values()].filter((r) => r.status === 'running');
  const items = [
    { label: 'Open Cadence', click: showWindow },
    { type: 'separator' },
    ...(running.length ? running.map((r) => ({ label: `Running: ${r.flow.name}`, enabled: false })) : []),
    { label: next ? `Next: ${next.name} — ${fmtWhen(next.nextAt)}` : 'Nothing scheduled', enabled: false },
    { label: 'Run now', submenu: flows.length ? flows.map((f) => ({ label: f.name, click: () => engine.start(f.id, { trigger: { kind: 'manual' } }) })) : [{ label: 'No automations yet', enabled: false }] },
    { type: 'separator' },
    { label: 'Pause all automations', type: 'checkbox', checked: engine.paused, click: (m) => { engine.paused = m.checked; send('flows:changed'); } },
    { label: 'Open at login', type: 'checkbox', checked: !!settings.openAtLogin, click: (m) => { settings.openAtLogin = m.checked; saveSettings(); applyLogin(); send('settings:changed', settings); } },
    { type: 'separator' },
    { label: 'Quit Cadence', click: () => { quitting = true; app.quit(); } },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(running.length ? `Cadence — running ${running[0].flow.name}` : next ? `Cadence — next: ${next.name}, ${fmtWhen(next.nextAt)}` : 'Cadence');
}
function fmtWhen(t) {
  const d = new Date(t); const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `today ${time}`;
  const tm = new Date(now); tm.setDate(tm.getDate() + 1);
  if (d.toDateString() === tm.toDateString()) return `tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
}

function appMenu() {
  const t = [
    ...(IS_MAC ? [{ role: 'appMenu', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: () => { showWindow(); send('nav', 'settings'); } }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { label: 'Quit Cadence', accelerator: 'Cmd+Q', click: () => { quitting = true; app.quit(); } }] }] : []),
    { label: 'File', submenu: [{ label: 'New automation', accelerator: 'CmdOrCtrl+N', click: () => { showWindow(); send('nav', 'new'); } }, { label: 'Import automation…', click: () => { showWindow(); send('nav', 'import'); } }, { type: 'separator' }, IS_MAC ? { role: 'close' } : { label: 'Quit', click: () => { quitting = true; app.quit(); } }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

// ───────────────────────── IPC
function h(ch, fn) { ipcMain.handle(ch, async (e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (err) { return { ok: false, error: err.message || String(err), problems: err.problems }; } }); }

h('app:info', () => ({ version: app.getVersion(), platform: process.platform, home: os.homedir(), documents: app.getPath('documents'), downloads: app.getPath('downloads'), userData: USER, demo: DEMO, sep: path.sep, now: Date.now(), dates: dateContext(new Date(), Number(settings.weekStart)) }));
h('catalog', () => ({ steps: STEPS, groups: GROUPS, triggers: TRIGGERS, common: COMMON, browserActions: BROWSER_ACTIONS, slideLayouts: SLIDE_LAYOUTS, tests: TESTS, providers: PROVIDERS, templates: TEMPLATES.map(({ flow, ...t }) => ({ ...t, steps: flow.steps.map((s) => s.type), when: describe(flow.trigger) })) }));
h('step:defaults', (type) => defaults(type));
h('settings:get', () => settings);
h('settings:set', (patch) => {
  settings = { ...settings, ...patch }; saveSettings();
  if ('openAtLogin' in patch) applyLogin();
  if ('theme' in patch) applyTheme();
  if ('outputRoot' in patch) engine.services.outputRoot = settings.outputRoot || '';
  if ('weekStart' in patch) send('flows:changed');
  updateTray(); return settings;
});
h('flows:list', () => ({ flows: engine.list(), paused: engine.paused }));
h('flows:get', (id) => engine.get(id));
h('flows:save', (flow) => engine.save(flow));
h('flows:check', (flow) => engine.check(flow));
h('flows:remove', (id) => engine.remove(id));
h('flows:duplicate', (id) => engine.duplicate(id));
h('flows:enable', (id, on) => engine.card(engine.setEnabled(id, on)));
h('flows:fromTemplate', (tid) => { const t = TEMPLATES.find((x) => x.id === tid); if (!t) throw new Error('No such template'); return engine.save({ ...JSON.parse(JSON.stringify(t.flow)), enabled: false, color: t.color, icon: t.icon }).flow; });
h('flows:export', async (id) => { const f = engine.get(id); const r = await dialog.showSaveDialog(win, { defaultPath: `${f.name}.cadence.json`, filters: [{ name: 'Cadence automation', extensions: ['json'] }] }); if (r.canceled) return null; const { id: _, createdAt, updatedAt, ...rest } = f; fs.writeFileSync(r.filePath, JSON.stringify({ cadence: 1, ...rest }, null, 2)); return r.filePath; });
h('flows:import', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Cadence automation', extensions: ['json'] }] }); if (r.canceled) return null; const j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); delete j.id; j.enabled = false; return engine.save(j).flow; });
h('flows:preview', (trigger) => { const out = []; let t = new Date(); for (let i = 0; i < 4; i++) { const n = nextRun(trigger, t); if (!n) break; out.push(n.getTime()); t = n; } return { when: describe(trigger), next: out }; });
h('flows:pause', (on) => { engine.paused = !!on; updateTray(); return engine.paused; });
h('run:start', (id, opts = {}) => { const r = engine.start(id, { trigger: { kind: opts.test ? 'test' : 'manual' }, upTo: opts.upTo || null, only: opts.only || null, inputs: opts.inputs || {} }); if (!r) throw new Error('Already running'); return r.snapshot(); });
h('run:cancel', (id) => engine.cancel(id));
h('runs:list', (opts) => engine.runs(opts || {}));
h('runs:get', (id) => engine.getRun(id));
h('runs:clear', (flowId) => { engine.store.history = engine.store.history.filter((r) => flowId && r.flowId !== flowId); engine.store.flushRuns(); return true; });
h('memory:clear', (flowId) => { engine.store.memory.clear(flowId); return true; });
h('memory:keys', (flowId) => engine.store.memory.keys(flowId));
h('secrets:list', () => ({ list: engine.store.secrets.list(), encrypted: safeStorage.isEncryptionAvailable() }));
h('secrets:set', (name, value) => { engine.store.secrets.set(String(name).trim(), value); return engine.store.secrets.list(); });
h('secrets:remove', (name) => { engine.store.secrets.remove(name); return engine.store.secrets.list(); });
h('profiles:list', () => engine.store.profiles());
h('profiles:add', (name) => { const id = String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile'; engine.store.ensureProfile(id); const list = engine.store.profiles().map((p) => (p.id === id ? { ...p, name: String(name).trim() || p.name } : p)); engine.store.saveProfiles(list); return list; });
h('profiles:remove', async (id) => { await browser.clear(id); engine.store.saveProfiles(engine.store.profiles().filter((p) => p.id !== id)); return engine.store.profiles(); });
h('profiles:signIn', async (id, url) => { await browser.signIn(id, url); const list = engine.store.profiles().map((p) => (p.id === id ? { ...p, signedInAt: Date.now(), site: url || p.site } : p)); engine.store.saveProfiles(list); return list; });
h('profiles:clear', async (id) => { await browser.clear(id); const list = engine.store.profiles().map((p) => (p.id === id ? { ...p, signedInAt: null } : p)); engine.store.saveProfiles(list); return list; });
let recording = null;
h('record:start', (profile, url) => {
  if (recording) recording.stop();
  if (!/^https?:\/\//.test(url || '')) throw new Error('Put the start page in first');
  recording = browser.record(profile || 'default', url, path.join(USER, 'recordings', String(Date.now())), (ev) => { send('record:event', ev); if (ev.type === 'done') recording = null; });
  return true;
});
h('record:stop', () => { if (recording) recording.stop(); recording = null; return true; });
h('ai:status', () => { const av = ai.available(engine.store.secrets); return { claude: av.claude, codex: av.codex, anthropic: av.anthropic, openai: av.openai }; });
h('ai:draft', async (description, existing) => {
  const ctx = `Browser profiles: ${engine.store.profiles().map((p) => p.id).join(', ')}. Secrets saved: ${engine.store.secrets.names().join(', ') || 'none'}. Home folder: ${os.homedir()}. Platform: ${process.platform}.`;
  const r = await aiBuild.draft({ description, existing, context: ctx, provider: settings.aiProvider || 'auto', secrets: engine.store.secrets, dir: path.join(USER, 'ai-drafts'), check: (f) => engine.check(f), log: (m) => send('ai:progress', m) });
  return r;
});
h('connectors:status', () => connectors.connectorStatus());
h('connectors:desktop', () => connectors.connectDesktop());
h('connectors:code', () => connectors.connectCode());
h('connectors:codex', () => connectors.connectCodex());
h('dialog:folder', async (start) => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: start ? start.replace(/^~/, os.homedir()) : undefined }); return r.canceled ? null : r.filePaths[0]; });
h('dialog:file', async (opts = {}) => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: opts.filters }); return r.canceled ? null : r.filePaths[0]; });
h('dialog:save', async (opts = {}) => { const r = await dialog.showSaveDialog(win, { defaultPath: opts.defaultPath, filters: opts.filters }); return r.canceled ? null : r.filePath; });
h('shell:open', async (p) => { if (/^https?:/.test(p)) return shell.openExternal(p); const e = await shell.openPath(p.replace(/^~/, os.homedir())); if (e) throw new Error(e); return true; });
h('shell:reveal', (p) => { shell.showItemInFolder(p.replace(/^~/, os.homedir())); return true; });
h('clipboard:write', (t) => { require('electron').clipboard.writeText(String(t)); return true; });

// ───────────────────────── lifecycle
app.on('second-instance', (e, argv) => { if (!argv.includes('--hidden')) showWindow(); });
app.on('activate', () => showWindow());
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { try { engine.shutdown(); } catch {} connectors.stopBridge(); });
app.on('window-all-closed', () => { if (!settings.background) { quitting = true; app.quit(); } });

app.whenReady().then(() => {
  try { if (IS_MAC && app.getLoginItemSettings().wasOpenedAsHidden) startHidden = true; } catch {}
  applyTheme(); appMenu(); boot();
  if (!settings.onboarded) { settings.onboarded = true; saveSettings(); applyLogin(); }
  createWindow();
  if (startHidden && !DEMO && IS_MAC && app.dock) app.dock.hide();
  tray = new Tray(trayImage());
  tray.on('click', () => { if (!IS_MAC) showWindow(); });
  updateTray();
  setInterval(updateTray, 60e3).unref();
});

module.exports = { send };
