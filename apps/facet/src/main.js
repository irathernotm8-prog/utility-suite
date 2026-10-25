// Facet — main process: window, settings, engine setup, model downloads, jobs and the library.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu } = require('electron');
const core = require('./core');
const tools = require('./tools');
const setup = require('./setup');
const models = require('./models');
const worker = require('./worker');
const library = require('./library');

const isMac = process.platform === 'darwin';
let win = null;

if (process.env.FACET_USER_DATA) app.setPath('userData', process.env.FACET_USER_DATA);
if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

function createWindow() {
  const s = core.get();
  win = new BrowserWindow({
    width: s.window.width || 1380, height: s.window.height || 880, minWidth: 1040, minHeight: 680, show: false,
    title: 'Facet', backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0b10' : '#f5f5f8',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac ? undefined : { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#e9e8f2' : '#1b1a22', height: 44 },
    trafficLightPosition: { x: 16, y: 16 },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('resize', () => { const [w, h] = win.getSize(); core.get().window = { width: w, height: h }; core.save(); });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function applyTheme() {
  const t = core.get().theme;
  nativeTheme.themeSource = t === 'light' ? 'light' : t === 'dark' ? 'dark' : 'system';
  if (win && !isMac) { try { win.setTitleBarOverlay({ color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#e9e8f2' : '#1b1a22', height: 44 }); } catch {} }
}

/* ───────────────────────── prompts ───────────────────────── */
const STYLES = {
  object: (p) => `${p}, a single object, front view at eye level, full view, centered, isolated on a plain white background, soft even studio lighting, clean product render`,
  character: (p) => `${p}, full body visible from head to feet, standing straight in an A-pose with arms held out away from the body, legs slightly apart, facing the camera, front view, centered, simple clean silhouette, isolated on a plain white background, soft even lighting, 3D character render`,
  game: (p) => `${p}, stylized game asset, single object, full view, centered, isolated on a plain white background, hand-painted look, 3D render`,
  lowpoly: (p) => `${p}, low poly 3D model, simple flat-shaded facets, single object, full view, centered, plain white background`,
  figurine: (p) => `${p}, collectible figurine on a small base, full view, centered, plain white background, studio lighting, smooth painted resin`,
  prop: (p) => `${p}, single prop, front view at eye level, full view, centered, isolated on a plain white background, realistic materials, product photo`
};
const buildPrompt = (text, style) => (STYLES[style] || STYLES.object)(String(text || '').trim().replace(/[.\s]+$/, ''));

/* ───────────────────────── jobs ───────────────────────── */
const jobs = new Map();
function jobUpdate(job, patch) {
  Object.assign(job, patch);
  const { _req, _meta, ...pub } = job;
  send('job', pub);
}
function detailParams(engineId, detailId) {
  const m = models.get(engineId);
  const d = (m?.detail || []).find(x => x.id === detailId) || (m?.detail || [])[1] || {};
  return { resolution: d.resolution, octree: d.octree, steps: m?.steps };
}

function startImagine(a) {
  if (!models.installed(a.imageModel)) throw new Error('Download a sketch model first (Models › Images).');
  const id = crypto.randomUUID();
  const outDir = core.ensureDir(path.join(core.scratchDir(), 'ideas', id.slice(0, 8)));
  const job = { id, kind: 'imagine', status: 'running', stage: 'queued', pct: 0, msg: 'Waiting for the engine', images: [], prompt: a.prompt, style: a.style };
  jobs.set(id, job);
  jobUpdate(job, {});
  const r = worker.request('imagine', { prompt: buildPrompt(a.prompt, a.style), model: a.imageModel, count: a.count || 4, seed: a.seed ?? -1, outDir }, (p) => {
    const images = p.image ? [...job.images, { path: p.image }] : job.images;
    jobUpdate(job, { stage: p.stage, pct: p.pct, msg: p.msg, images });
  });
  job._req = r.id;
  r.promise.then((res) => jobUpdate(job, { status: 'done', pct: 1, msg: 'Pick one to build', images: res.images, seed: res.seed }))
    .catch((e) => jobUpdate(job, { status: e.stopped ? 'stopped' : 'failed', error: e.stopped ? null : e.message, msg: e.stopped ? 'Stopped' : e.message }));
  return job.id;
}

function startRig(id, markers, opts = {}) {
  const m = library.find(id);
  if (!m) throw new Error('That model is gone.');
  const jid = crypto.randomUUID();
  const job = { id: jid, kind: 'rig', status: 'running', stage: 'queued', pct: 0, msg: 'Waiting for the engine', projectId: id, name: m.name };
  jobs.set(jid, job);
  jobUpdate(job, {});
  const heightM = Math.max(0.1, Math.min(50, Number(opts.heightM) || 1.8));
  const r = worker.request('rig', { src: m.paths.model, markers, out: path.join(m.dir, 'model-rigged.glb'), heightM, animations: opts.animations !== false },
    (p) => jobUpdate(job, { stage: p.stage, pct: p.pct, msg: p.msg }));
  job._req = r.id;
  r.promise.then((res) => {
    const saved = library.setRig(id, { markers: res.markers, heightM, clips: res.clips, joints: res.joints, at: Date.now() });
    jobUpdate(job, { status: 'done', pct: 1, msg: 'Rigged', project: saved });
    send('library', { type: 'updated', id });
  }).catch((e) => jobUpdate(job, { status: e.stopped ? 'stopped' : 'failed', error: e.stopped ? null : e.message, msg: e.stopped ? 'Stopped' : e.message }));
  return jid;
}

function startMake(a) {
  const eng = models.get(a.engine);
  if (!eng || eng.kind !== 'shape') throw new Error('Choose a 3D engine.');
  if (!models.installed(a.engine)) throw new Error(`Download ${eng.name} first (Models).`);
  if (!models.installed('cutout') && a.removeBg !== false) throw new Error('Download the background remover first (Models).');
  const views = a.views || {};
  if (!views.front) throw new Error('Add a picture first.');
  for (const v of Object.values(views)) if (v && !fs.existsSync(v)) throw new Error('A picture could not be found: ' + v);

  const name = (a.name || '').trim() || (a.prompt ? library.nameFrom(a.prompt) : library.nameFrom(path.basename(views.front, path.extname(views.front)).replace(/[-_]+/g, ' ')));
  const params = { detail: a.detail, faces: a.faces || 0, colorize: !!a.colorize && !eng.colors, removeBg: a.removeBg !== false, seed: a.seed ?? -1, texture: a.texture || 'picture' };
  const source = { mode: a.mode, prompt: a.prompt || null, style: a.style || null, imageModel: a.prompt ? a.imageModel : null, views: Object.keys(views).filter(k => views[k]) };
  const meta = library.create({ name, source, engine: a.engine, params });
  // keep the originals with the model
  for (const [k, v] of Object.entries(views)) if (v) { try { fs.copyFileSync(v, path.join(meta.dir, `source-${k}${path.extname(v).toLowerCase() || '.png'}`)); } catch {} }

  const id = crypto.randomUUID();
  const job = { id, kind: 'make', status: 'running', stage: 'queued', pct: 0, msg: 'Waiting for the engine', name, engine: a.engine, image: views.front, startedAt: Date.now() };
  jobs.set(id, job);
  job._meta = meta;
  jobUpdate(job, {});
  const dp = detailParams(a.engine, a.detail);
  const r = worker.request('shape', {
    engine: a.engine, views, outDir: meta.dir, removeBg: params.removeBg, seed: params.seed, faces: params.faces,
    colorize: params.colorize, resolution: dp.resolution, octree: dp.octree, steps: dp.steps, texture: params.texture
  }, (p) => jobUpdate(job, { stage: p.stage, pct: p.pct, msg: p.msg, ...(p.image ? { image: p.image } : {}) }));
  job._req = r.id;
  r.promise.then((res) => {
    const saved = library.finish(meta, res.stats);
    jobUpdate(job, { status: 'done', pct: 1, msg: 'Done', project: saved });
    send('library', { type: 'added', id: saved.id });
  }).catch((e) => {
    library.abandon(meta);
    jobUpdate(job, { status: e.stopped ? 'stopped' : 'failed', error: e.stopped ? null : e.message, msg: e.stopped ? 'Stopped' : e.message });
  });
  return job.id;
}

/* ───────────────────────── IPC ───────────────────────── */
function handle(ch, fn) {
  ipcMain.handle(ch, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
}

function registerIpc() {
  handle('app:info', async () => ({
    version: app.getVersion(), platform: process.platform, arch: process.arch, demo: !!process.env.FACET_DEMO,
    settings: core.get(), paths: { models: core.modelsDir(), output: core.outputDir(), engine: core.engineRoot(), defaultModels: core.defaultModelsDir(), defaultOutput: core.defaultOutputDir() }
  }));
  handle('settings:patch', async (p) => {
    const before = core.get();
    const restartEngine = ('device' in p && p.device !== before.device) || ('keepLoaded' in p && p.keepLoaded !== before.keepLoaded) || ('modelsDir' in p);
    core.patch(p);
    if ('theme' in p) applyTheme();
    if (restartEngine && !worker.busy()) worker.restart();
    return core.get();
  });
  handle('app:openExternal', async (url) => { if (/^https?:\/\//.test(url)) await shell.openExternal(url); });
  handle('app:reveal', async (p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); });
  handle('app:openPath', async (p) => { if (p && fs.existsSync(p)) return shell.openPath(p); });
  handle('app:chooseFolder', async (title, def) => {
    const r = await dialog.showOpenDialog(win, { title, defaultPath: def, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('app:chooseImages', async (multi) => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a picture', properties: multi ? ['openFile', 'multiSelections'] : ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'] }] });
    return r.canceled ? [] : r.filePaths;
  });
  handle('app:chooseModelFile', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Add a 3D file', properties: ['openFile', 'multiSelections'], filters: [{ name: '3D models', extensions: ['glb', 'obj', 'stl', 'ply'] }] });
    return r.canceled ? [] : r.filePaths;
  });
  handle('app:saveTemp', async (name, bytes) => {
    const ext = (path.extname(name || '') || '.png').toLowerCase();
    const p = path.join(core.ensureDir(path.join(core.scratchDir(), 'pasted')), `paste-${Date.now()}${ext}`);
    fs.writeFileSync(p, Buffer.from(bytes));
    return p;
  });

  handle('hw:detect', () => tools.detectHardware());

  handle('engine:status', async () => ({ ...(await setup.status()), worker: worker.running(), hello: worker.lastHello() }));
  handle('engine:install', async (o) => { setup.install(o || {}); return setup.status(); });
  handle('engine:cancel', async () => setup.cancel());
  handle('engine:hello', () => worker.hello());
  handle('engine:restart', async () => worker.restart());
  handle('engine:log', async () => { try { const s = fs.readFileSync(core.logFile(), 'utf8'); return s.slice(-60000); } catch { return ''; } });
  handle('engine:size', async () => setup.envSize());

  handle('models:list', () => models.list());
  handle('models:download', async (id) => { models.download(id); });
  handle('models:cancel', async (id) => models.cancel(id));
  handle('models:remove', async (id) => { if (worker.busy()) throw new Error('Wait for the current job to finish.'); worker.restart(); return models.remove(id); });

  handle('create:imagine', async (a) => startImagine(a));
  handle('create:make', async (a) => startMake(a));
  handle('create:cancel', async (id) => { const j = jobs.get(id); if (j?._req) worker.cancel(j._req); });
  handle('create:jobs', async () => [...jobs.values()].map(({ _req, _meta, ...j }) => j));

  handle('library:list', () => library.list());
  handle('library:get', async (id) => library.find(id));
  handle('library:update', async (id, p) => library.update(id, p));
  handle('library:trash', async (id) => library.trash(id));
  handle('library:thumb', async (id, url) => library.setThumb(id, url));
  handle('library:export', async (id, fmt, opts = {}) => {
    const m = library.find(id);
    if (!m) throw new Error('That model is gone.');
    const ext = fmt === 'glb' ? 'glb' : fmt;
    const rigged = opts.rigged && m.paths.rigged;
    const suffix = opts.suffix ? ` (${opts.suffix})` : rigged ? ' (rigged)' : '';
    const r = await dialog.showSaveDialog(win, { title: `Export ${m.name}`, defaultPath: path.join(app.getPath('downloads'), `${m.name}${suffix}.${ext}`), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (r.canceled || !r.filePath) return null;
    if (rigged && opts.faces && (m.stats?.faces || Infinity) > opts.faces && m.rig?.markers) {
      // a lighter rigged copy: reduce the static model, then rig it again with the same markers
      const tmp = path.join(core.scratchDir(), `rig-${Date.now()}.glb`);
      await worker.request('export', { src: m.paths.model, out: tmp, format: 'glb', faces: opts.faces }).promise;
      try { await worker.request('rig', { src: tmp, markers: m.rig.markers, out: r.filePath, heightM: m.rig.heightM || 1.8, animations: (m.rig.clips || []).length > 0 }).promise; }
      finally { try { fs.unlinkSync(tmp); } catch {} }
      return { path: r.filePath };
    }
    if (rigged) { fs.copyFileSync(m.paths.rigged, r.filePath); return { path: r.filePath }; }
    if (fmt === 'glb' && !opts.faces && !opts.heightM) { fs.copyFileSync(m.paths.model, r.filePath); return { path: r.filePath }; }
    const { promise } = worker.request('export', { src: m.paths.model, out: r.filePath, format: fmt, heightMm: fmt === 'stl' ? (opts.heightMm || core.get().export.stlHeight) : null, heightM: opts.heightM || null, faces: opts.faces || 0 });
    return promise;
  });
  handle('library:rigGuess', async (id, fresh) => {
    const m = library.find(id);
    if (!m) throw new Error('That model is gone.');
    if (m.rig?.markers && !fresh) return { markers: m.rig.markers, saved: true };
    return worker.request('rig_guess', { src: m.paths.model }).promise;
  });
  handle('library:rig', async (id, markers, opts) => startRig(id, markers, opts));
  handle('library:repaint', async (id) => {
    const m = library.find(id);
    if (!m?.paths.input) throw new Error('This model has no picture to paint from.');
    const tmp = path.join(m.dir, 'model-painted.glb');
    const res = await worker.request('repaint', { src: m.paths.model, image: m.paths.input, out: tmp }).promise;
    const before = path.join(m.dir, 'model-before-paint.glb');
    if (!fs.existsSync(before)) fs.copyFileSync(m.paths.model, before);
    fs.renameSync(tmp, m.paths.model);
    if (m.paths.thumb) { try { fs.unlinkSync(m.paths.thumb); } catch {} }
    if (m.paths.rigged) { try { fs.unlinkSync(m.paths.rigged); } catch {} library.setRig(id, null); }
    const { paths, ...raw } = library.find(id);
    const saved = library.decorate(library.writeMeta({ ...raw, stats: { ...(raw.stats || {}), ...res.stats }, params: { ...(raw.params || {}), texture: 'picture' } }));
    send('library', { type: 'updated', id });
    return saved;
  });
  handle('library:unrig', async (id) => {
    const m = library.find(id);
    if (m?.paths.rigged) { try { fs.unlinkSync(m.paths.rigged); } catch {} }
    const saved = library.setRig(id, null);
    send('library', { type: 'updated', id });
    return saved;
  });
  handle('library:import', async (files) => {
    const added = [];
    for (const f of files || []) {
      const ext = path.extname(f).toLowerCase();
      if (!['.glb', '.obj', '.stl', '.ply'].includes(ext)) continue;
      const meta = library.importStart(f);
      try {
        const dest = path.join(meta.dir, 'model.glb');
        if (ext === '.glb') fs.copyFileSync(f, dest);
        else await worker.request('export', { src: f, out: dest, format: 'glb' }).promise;
        added.push(library.finish(meta, null));
      } catch (e) { library.abandon(meta); throw e; }
    }
    send('library', { type: 'added' });
    return added;
  });
}

/* ───────────────────────── lifecycle ───────────────────────── */
app.whenReady().then(() => {
  core.init();
  applyTheme();
  if (isMac) {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      { role: 'windowMenu' }
    ]));
  } else Menu.setApplicationMenu(null);
  setup.onEvent((e) => send('engine', e));
  models.onEvent((e) => send('models', e));
  worker.onEvent((e) => send('worker', e));
  registerIpc();
  createWindow();
  nativeTheme.on('updated', () => applyTheme());
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
app.on('before-quit', () => { core.save(true); worker.stop(); });
