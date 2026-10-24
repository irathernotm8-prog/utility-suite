// Decomp — main process: the window, settings, engines, jobs and everything the window asks for.
'use strict';
// Decomp reads and writes .asar files as plain files (it unpacks other apps' archives), so Electron's
// built-in asar handling is switched off. Decomp itself is packaged without asar.
process.noAsar = true;
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createContext } = require('./core/context');
const { Job, plannedEngines } = require('./core/pipeline');
const detect = require('./core/detect');
const power = require('./core/power');
const { TYPES, FAMILIES } = require('./core/types');
const { readJson, writeJson, fmtSize } = require('./core/util');

const DEMO = process.env.DECOMP_DEMO === '1';
if (process.env.DECOMP_USER_DATA) app.setPath('userData', process.env.DECOMP_USER_DATA);
app.setName('Decomp');

// ───────────────────────── settings
const USER = app.getPath('userData');
const P = { settings: path.join(USER, 'settings.json'), history: path.join(USER, 'jobs.json'), engines: process.env.DECOMP_ENGINES || path.join(USER, 'engines') };
const DEFAULTS = {
  theme: 'system', outRoot: path.join(app.getPath('documents'), 'Decomp'), mode: 'max', deep: true, maxDepth: 4, native: true, nativeDeep: false,
  libraries: false, deobf: false, openWhenDone: false, useSystem: true, essentials: true, onboarded: false,
};
let settings = { ...DEFAULTS, ...readJson(P.settings, {}) };
const saveSettings = () => writeJson(P.settings, settings);

// ───────────────────────── services
const ctx = createContext({ enginesDir: P.engines, mode: settings.mode, useSystem: settings.useSystem });
const jobs = new Map();                 // live jobs this session
let history = readJson(P.history, []);  // finished job snapshots, newest first
const saveHistory = () => writeJson(P.history, history.slice(0, 150));

let win = null;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const isMac = process.platform === 'darwin';

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 980, minHeight: 640, show: false,
    title: 'Decomp', backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0b0d' : '#f6f4f4',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac ? undefined : { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ece6e7' : '#1d1a1b', height: 44 },
    trafficLightPosition: { x: 16, y: 16 },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  // dropping a file anywhere must never navigate away
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function applyTheme() { nativeTheme.themeSource = settings.theme === 'light' ? 'light' : settings.theme === 'dark' ? 'dark' : 'system'; }

// ───────────────────────── jobs
function jobOptions(o = {}) {
  return { deep: settings.deep, maxDepth: settings.maxDepth, native: settings.native, nativeDeep: settings.nativeDeep, libraries: settings.libraries, deobf: settings.deobf, ...o };
}
function startJob(input, opts = {}) {
  const identity = opts.identity || detect.full(input);
  const job = new Job({ input, identity, outRoot: settings.outRoot, options: jobOptions(opts.options), ctx });
  jobs.set(job.id, job);
  let timer = null, last = 0;
  job.on('change', (force) => {
    const now = Date.now();
    if (force || now - last > 180) { last = now; clearTimeout(timer); timer = null; send('job:update', job.snapshot()); }
    else if (!timer) timer = setTimeout(() => { timer = null; last = Date.now(); send('job:update', job.snapshot()); }, 180);
  });
  job.run().then((snap) => {
    history = [snapshotForHistory(snap), ...history.filter((h) => h.id !== snap.id)];
    saveHistory();
    send('job:update', snap);
    if (snap.status === 'done' && settings.openWhenDone) shell.openPath(snap.outDir);
    if (win && !win.isFocused() && snap.status !== 'cancelled') { try { const { Notification } = require('electron'); new Notification({ title: snap.status === 'done' ? `${snap.name} is taken apart` : `${snap.name} stopped`, body: snap.status === 'done' ? `${snap.stats.sources.toLocaleString()} source files in ${snap.stats.seconds}s` : snap.error || '' }).show(); } catch {} }
    if (isMac && app.dock) app.dock.bounce('informational');
  });
  return job.snapshot();
}
const snapshotForHistory = (s) => ({ ...s, steps: s.steps.slice(0, 400) });
function findJob(id) { return jobs.get(id) ? jobs.get(id).snapshot() : history.find((h) => h.id === id) || null; }

// Light-weight identity for the window (no raw header tables).
function identify(p) {
  const id = detect.full(p);
  const { pe, elf, macho, ...rest } = id;
  rest.extra = {};
  if (pe) rest.extra.imports = pe.imports.slice(0, 80).map((i) => ({ dll: i.dll, n: i.functions.length, fns: i.functions.slice(0, 40) }));
  if (pe) rest.extra.sections = pe.sections.map((s) => ({ name: s.name, size: s.rawSize, vsize: s.vsize }));
  if (elf) rest.extra.sections = elf.sections.slice(0, 60).map((s) => ({ name: s.name, size: s.size }));
  if (macho) rest.extra.libs = macho.arches[0].libs.slice(0, 120);
  const planned = plannedEngines(id, { native: settings.native });
  const list = ctx.engines.list().engines;
  rest.plan = planned.map((e) => list.find((x) => x.id === e)).filter(Boolean);
  rest.how = TYPES[id.kind] ? TYPES[id.kind].how : '';
  return rest;
}

// ───────────────────────── file browsing for the results view
const TEXT_EXT = /\.(java|kt|kts|smali|cs|vb|fs|il|c|h|cc|cpp|hpp|m|mm|swift|go|rs|py|pyi|js|mjs|cjs|ts|tsx|jsx|json|xml|plist|html?|css|scss|less|md|txt|log|ini|cfg|conf|toml|ya?ml|properties|gradle|csproj|sln|config|manifest|gd|tscn|tres|godot|lua|sh|bat|cmd|ps1|nsi|iss|sql|csv|tsv|wat|wast|dis|rc|def|cmake|mk|pro|desktop|service|svg|rb|php|pl|r|dart|vue|svelte|lst|inf|reg|cue|nfo|map)$/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif)$/i;
function listDir(dir) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { throw new Error('Can’t open this folder: ' + e.message); }
  const out = [];
  for (const e of ents) {
    if (e.name === '.DS_Store') continue;
    const p = path.join(dir, e.name);
    let size = 0; if (e.isFile()) { try { size = fs.statSync(p).size; } catch {} }
    out.push({ name: e.name, path: p, dir: e.isDirectory(), size });
  }
  out.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return out;
}
function readFile(p, { max = 8 << 20 } = {}) {
  const st = fs.statSync(p);
  if (IMG_EXT.test(p) && st.size < 32 << 20) return { kind: 'image', size: st.size, url: require('url').pathToFileURL(p).href };
  const fd = fs.openSync(p, 'r');
  try {
    const n = Math.min(st.size, max); const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, 0);
    const sample = b.subarray(0, Math.min(n, 8192));
    const zeros = sample.reduce((a, c) => a + (c === 0 ? 1 : 0), 0);
    const binary = !TEXT_EXT.test(p) && (zeros > sample.length * 0.01 || sample.some((c) => c < 9));
    if (binary) { const hb = b.subarray(0, Math.min(n, 64 * 1024)); return { kind: 'hex', size: st.size, hex: hb.toString('base64'), shown: hb.length, info: (() => { try { const q = detect.quick(p); return q.kind !== 'unknown' ? TYPES[q.kind] && TYPES[q.kind].label : null; } catch { return null; } })() }; }
    return { kind: 'text', size: st.size, text: b.toString('utf8'), truncated: st.size > n };
  } finally { fs.closeSync(fd); }
}
function walkFiles(root, limit = 60000) {
  const out = []; const st = [root];
  while (st.length && out.length < limit) { const d = st.pop(); let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) st.push(p); else if (e.isFile() && !IMG_EXT.test(e.name) && !(d === root && /^(report\.json|Overview\.md)$/.test(e.name))) out.push(p); } }
  return out;
}
async function search(root, query, { regex, cs } = {}) {
  if (!query) return { results: [], files: 0 };
  if (regex) new RegExp(query); // throws on a bad pattern
  const files = walkFiles(root);
  const n = Math.max(1, ctx.budget().workers * 2), per = Math.ceil(files.length / n), tasks = [];
  for (let i = 0; i < files.length; i += per) tasks.push(['grep', { files: files.slice(i, i + per), query, regex, cs, max: 600 }]);
  const t0 = Date.now();
  const res = (await ctx.pool.all(tasks)).flatMap((r) => (Array.isArray(r) ? r : []));
  return { results: res.slice(0, 2000), files: files.length, ms: Date.now() - t0, workers: Math.min(tasks.length, ctx.budget().workers) };
}

// ───────────────────────── IPC
function h(ch, fn) { ipcMain.handle(ch, async (e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (err) { return { ok: false, error: err.message || String(err) }; } }); }

h('app:info', () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, settings, budget: ctx.budget(), modes: power.MODES, cpu: (os.cpus()[0] || {}).model, cores: power.cpuCount(), memory: os.totalmem(), types: TYPES, families: FAMILIES, demo: DEMO, home: os.homedir() }));
h('settings:set', (patch) => {
  settings = { ...settings, ...patch }; saveSettings();
  if ('theme' in patch) applyTheme();
  if ('mode' in patch) ctx.setMode(settings.mode);
  if ('useSystem' in patch) { ctx.engines.useSystem = settings.useSystem; ctx.engines.rescan(); }
  return settings;
});
h('identify', (p) => identify(p));
h('dialog:open', async ({ folder } = {}) => {
  const r = await dialog.showOpenDialog(win, { properties: folder ? ['openDirectory'] : ['openFile'], title: folder ? 'Choose a folder (an app, a game or anything unpacked)' : 'Choose something to take apart' });
  return r.canceled ? null : r.filePaths[0];
});
h('dialog:outRoot', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.outRoot }); if (r.canceled) return null; settings.outRoot = r.filePaths[0]; saveSettings(); return settings.outRoot; });
h('job:start', ({ path: p, options }) => startJob(p, { options }));
h('job:cancel', (id) => { const j = jobs.get(id); if (j) j.cancel(); return true; });
h('job:list', () => {
  const byId = new Map(history.map((x) => [x.id, x]));
  for (const j of jobs.values()) byId.set(j.id, j.snapshot());
  return [...byId.values()].sort((a, b) => ((b.status === 'running') - (a.status === 'running')) || (b.startedAt || 0) - (a.startedAt || 0));
});
h('job:get', (id) => findJob(id));
h('job:forget', (id) => { history = history.filter((x) => x.id !== id); saveHistory(); return true; });
h('job:rerun', (id) => { const s = findJob(id); if (!s) throw new Error('Job not found'); return startJob(s.input, { options: s.options }); });
h('job:overview', (id) => { const s = findJob(id); if (!s) return null; return readJson(path.join(s.outDir, 'Analysis', 'overview.json'), null); });
h('fs:list', (dir) => listDir(dir));
h('fs:read', (p) => readFile(p));
h('fs:exists', (p) => fs.existsSync(p));
h('fs:search', ({ root, query, regex, cs }) => search(root, query, { regex, cs }));
h('shell:open', (p) => shell.openPath(p));
h('shell:reveal', (p) => { shell.showItemInFolder(p); return true; });
h('engines:list', () => ctx.engines.list());
h('engines:rescan', () => ctx.engines.rescan());
h('engines:remove', (id) => { ctx.engines.remove(id); return ctx.engines.list(); });
h('engines:folder', () => shell.openPath(P.engines));
h('engines:install', async (ids) => {
  for (const id of [].concat(ids)) {
    await ctx.engines.install(id, (p) => send('engines:progress', p));
    send('engines:progress', { id, done: true });
  }
  return ctx.engines.list();
});
h('power:set', (mode) => { settings.mode = mode; saveSettings(); ctx.setMode(mode); return ctx.budget(); });

// live meter: per-core load, memory, and what Decomp has running right now
let meter = null;
function startMeter() {
  power.sample();
  meter = setInterval(() => {
    const s = power.sample();
    send('power:sample', { ...s, threadsInUse: ctx.scheduler.threadsInUse + ctx.pool.active, pool: ctx.pool.active, engines: ctx.scheduler.snapshot().engines, budget: ctx.budget() });
  }, 1000);
}

// ───────────────────────── app lifecycle
let pendingOpen = [];
app.on('open-file', (e, p) => { e.preventDefault(); if (win) send('app:open', p); else pendingOpen.push(p); });

app.whenReady().then(async () => {
  applyTheme();
  if (isMac) Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'File', submenu: [{ label: 'Open…', accelerator: 'Cmd+O', click: () => send('menu', 'open') }, { label: 'Open Folder…', accelerator: 'Shift+Cmd+O', click: () => send('menu', 'open-folder') }, { type: 'separator' }, { role: 'close' }] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
  else Menu.setApplicationMenu(null);
  if (isMac && app.dock) { try { app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'))); } catch {} }
  createWindow();
  startMeter();
  win.webContents.once('did-finish-load', () => { for (const p of pendingOpen.concat(process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-') && fs.existsSync(a)))) send('app:open', p); pendingOpen = []; });
  // 7-Zip is tiny and opens most containers: fetch it quietly the first time.
  if (settings.essentials && !DEMO && !ctx.engines.ready('sevenzip')) ctx.engines.install('sevenzip', (p) => send('engines:progress', p)).then(() => send('engines:progress', { id: 'sevenzip', done: true })).catch(() => {});
  if (process.env.DECOMP_SHOTS) require('../test/e2e/shots')({ get win() { return win; }, ctx, jobs, startJob, settings });
});
app.on('window-all-closed', () => { for (const j of jobs.values()) j.cancel(); app.quit(); });
app.on('before-quit', () => { clearInterval(meter); ctx.close(); });
app.on('activate', () => { if (!win) createWindow(); });

module.exports = { fmtSize };
