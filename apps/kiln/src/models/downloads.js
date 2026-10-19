// Kiln — one download manager for models from CivitAI, Hugging Face, pasted links and the built-in browser.
// Model files land in the profile's library under the right type folder, with a Stability Matrix
// compatible .cm-info.json and a preview image when Kiln knows where the model came from.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ipcMain, shell, session, net } = require('electron');
const core = require('../core');
const sources = require('./sources');
const library = require('./library');
const { MODEL_EXT, byId, guessType, typeForCivitai } = require('../shared/types');

let send = () => {};
const live = new Map();        // id -> DownloadItem
const pendingByUrl = new Map(); // url -> record waiting for will-download
const attached = new WeakSet();
const sessionProfile = new WeakMap(); // session -> profile id that owns it

function historyOf(profileId) {
  const d = core.profileStore(profileId).data;
  return (d.downloads = d.downloads || []);
}
function save(profileId) { core.profileStore(profileId).save(); }
function pub(r) { return { ...r, exists: r.state === 'completed' ? fs.existsSync(r.path || '') : true }; }
function update(r, force) {
  const now = Date.now();
  if (!force && now - (r._t || 0) < 250) return;
  r._t = now;
  const { _t, ...clean } = r; void _t;
  send('dl:update', pub(clean));
}
function uniquePath(dir, name) {
  name = String(name || 'download').replace(/[/\\:*?"<>|]/g, '_');
  let target = path.join(dir, name), n = 1;
  const ext = path.extname(name), base = path.basename(name, ext);
  while (fs.existsSync(target) || [...live.values()].some(i => i.getSavePath() === target)) target = path.join(dir, `${base} (${n++})${ext}`);
  return target;
}
function record(r) {
  const h = historyOf(r.profileId);
  h.unshift(r);
  if (h.length > 300) h.length = 300;
  save(r.profileId);
  update(r, true);
  return r;
}
function strip(r) { const { _t, ...c } = r; void _t; return c; }

/* ---------- starting downloads from Kiln ---------- */
async function start({ url, name, type, meta, previewUrl, source = 'link', headers }) {
  const a = core.active();
  if (!a?.library) throw new Error('Pick a profile first');
  if (!url) throw new Error('No download link');
  let finalUrl = url;
  const hdrs = { ...(headers || {}) };
  if (/civitai\.com/.test(url)) {
    finalUrl = sources.civDownloadUrl(url);
    try {
      const pre = await net.fetch(finalUrl, { method: 'GET', redirect: 'manual', headers: hdrs });
      if (pre.status === 401 || pre.status === 403) throw new Error(core.secret('civitaiKey') ? 'CivitAI refused the download. The model may be early access, or your API key may have expired.' : 'This model needs a CivitAI API key. Add one in Settings → Accounts, then try again.');
      try { pre.body?.cancel(); } catch {}
    } catch (e) { if (/API key|refused/.test(e.message)) throw e; }
  }
  if (/huggingface\.co/.test(url)) Object.assign(hdrs, sources.hfHeaders());
  const r = {
    id: crypto.randomUUID(), url, name: name || decodeURIComponent(url.split('?')[0].split('/').pop() || 'model'), type: type || null, suggestedType: type || guessType(name, 0),
    source, meta: meta || null, previewUrl: previewUrl || null, profileId: a.profile.id, libraryRoot: a.library.path,
    state: 'starting', received: 0, total: 0, startedAt: Date.now(), doneAt: null, error: null, path: null, isModel: true,
    title: meta?.model?.name ? `${meta.model.name}${meta.version?.name ? ' · ' + meta.version.name : ''}` : null
  };
  pendingByUrl.set(finalUrl, r);
  record(r);
  const ses = session.fromPartition(partitionFor(a.profile.id));
  attach(ses, a.profile.id);
  ses.downloadURL(finalUrl, Object.keys(hdrs).length ? { headers: hdrs } : undefined);
  return pub(strip(r));
}

function partitionFor(profileId) { return `persist:kiln-${profileId}`; }

/* ---------- every session's downloads come through here ---------- */
function attach(ses, profileId) {
  if (profileId) sessionProfile.set(ses, profileId);
  if (attached.has(ses)) return;
  attached.add(ses);
  ses.on('will-download', (_e, item, wc) => {
    const chain = item.getURLChain();
    let r = pendingByUrl.get(chain[0]);
    if (r) pendingByUrl.delete(chain[0]);
    const owner = core.getProfile(sessionProfile.get(ses)) || core.activeProfile();
    const fname = item.getFilename();
    if (!r) {
      if (!owner) { item.cancel(); return; }
      const lib = core.getLibrary(owner.libraryId);
      const isModel = MODEL_EXT.test(fname);
      let pageUrl = '', pageTitle = '';
      try { pageUrl = wc?.getURL() || ''; pageTitle = wc?.getTitle() || ''; } catch {}
      r = {
        id: crypto.randomUUID(), url: chain[0], name: fname, type: null, suggestedType: isModel ? guessType(fname, item.getTotalBytes()) : null,
        source: 'browser', meta: null, previewUrl: null, profileId: owner.id, libraryRoot: lib?.path || null,
        state: 'progressing', received: 0, total: item.getTotalBytes(), startedAt: Date.now(), doneAt: null, error: null, path: null,
        isModel, pageUrl, pageTitle, needsType: isModel
      };
      record(r);
      if (isModel) identify(r, chain);
    } else {
      if (r.state === 'cancelled') { item.cancel(); return; }
      r.name = r.name && MODEL_EXT.test(r.name) ? r.name : fname;
    }
    const tmpDir = r.isModel && r.libraryRoot ? core.ensureDir(path.join(r.libraryRoot, '.downloads')) : core.ensureDir(path.join(core.profileDir(r.profileId), 'Downloads'));
    const target = uniquePath(tmpDir, r.isModel ? r.name : fname);
    item.setSavePath(target);
    r.tmpPath = target; r.state = 'progressing'; r.total = item.getTotalBytes();
    live.set(r.id, item);
    update(r, true);
    item.on('updated', (_ev, state) => {
      r.received = item.getReceivedBytes(); r.total = item.getTotalBytes();
      r.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing';
      update(r);
    });
    item.once('done', async (_ev, state) => {
      live.delete(r.id);
      r.received = item.getReceivedBytes(); r.total = r.total || r.received;
      if (state !== 'completed') { r.state = state === 'cancelled' ? 'cancelled' : 'failed'; r.error = r.error || (state === 'interrupted' ? 'The connection dropped' : null); r.doneAt = Date.now(); try { fs.rmSync(target, { force: true }); } catch {} save(r.profileId); update(r, true); return; }
      try { await finish(r, item.getMimeType()); }
      catch (e) { r.state = 'failed'; r.error = e.message; }
      r.doneAt = Date.now();
      save(r.profileId);
      update(r, true);
      send('dl:done', pub(strip(r)));
    });
  });
}

// Work out what a model downloaded in the browser is, from CivitAI's API when the link came from there
async function identify(r, chain) {
  const civ = chain.map(u => u.match(/civitai\.com\/api\/download\/models\/(\d+)/)).find(Boolean);
  if (!civ) return;
  try {
    const v = await sources.civVersion(civ[1]);
    let model = v.model;
    try { model = await sources.civModel(v.modelId); } catch {}
    const file = v.version.files.find(f => f.name === r.name) || v.version.files.find(f => f.primary) || v.version.files[0];
    r.type = typeForCivitai(model.type || v.model?.type);
    r.needsType = false;
    r.meta = { model, version: v.version, file };
    const allow = core.profileStore(r.profileId).data.settings.nsfw === 'show';
    r.previewUrl = library.pickPreview(v.version.images, allow)?.url || null;
    r.title = model.name;
    update(r, true);
  } catch {}
}

async function finish(r, mime) {
  if (!r.isModel) { r.path = r.tmpPath; r.state = 'completed'; return; }
  const size = fs.statSync(r.tmpPath).size;
  if ((/text\/html|application\/json/.test(mime || '') && size < 2e6) || size < 2048) {
    fs.rmSync(r.tmpPath, { force: true });
    throw new Error('The site sent a page instead of the model file. You may need to sign in or add an API key.');
  }
  const type = r.type || r.suggestedType || guessType(r.name, size);
  r.type = type;
  const dir = core.ensureDir(path.join(r.libraryRoot, type));
  const dest = uniquePath(dir, path.basename(r.tmpPath));
  fs.renameSync(r.tmpPath, dest);
  r.path = dest; r.state = 'completed'; r.needsType = false;
  if (r.meta?.version) {
    try {
      const info = sources.cmInfo({ model: { ...r.meta.model, creator: { username: r.meta.model?.creator } }, version: r.meta.version, file: r.meta.file });
      fs.writeFileSync(library.baseOf(dest) + '.cm-info.json', JSON.stringify(info));
    } catch {}
  }
  if (r.previewUrl) { try { await library.savePreview(r.previewUrl, dest); } catch {} }
  library.invalidate(r.libraryRoot);
}

/* ---------- controls ---------- */
function find(id) {
  for (const p of core.g().profiles) { const r = historyOf(p.id).find(x => x.id === id); if (r) return r; }
  return null;
}
function control(id, action) {
  const item = live.get(id);
  const r = find(id);
  if (action === 'cancel') {
    if (item) item.cancel();
    else if (r && r.state === 'starting') {
      r.state = 'cancelled';
      for (const [u, x] of pendingByUrl) if (x.id === r.id) pendingByUrl.delete(u);
      save(r.profileId); update(r, true);
    }
    return true;
  }
  if (!item) return false;
  if (action === 'pause') item.pause();
  if (action === 'resume' && item.canResume()) item.resume();
  return true;
}
function setType(id, type) {
  const r = find(id);
  if (!r || !byId[type]) return null;
  r.type = type; r.needsType = false;
  if (r.state === 'completed' && r.path && fs.existsSync(r.path)) {
    try { r.path = moveCompleted(r, type); } catch (e) { r.error = e.message; }
  }
  save(r.profileId); update(r, true);
  return pub(strip(r));
}
function moveCompleted(r, type) {
  const dir = core.ensureDir(path.join(r.libraryRoot, type));
  const b = library.baseOf(r.path);
  const files = [r.path, ...['.cm-info.json', '.preview.jpeg', '.preview.png'].map(e => b + e).filter(f => fs.existsSync(f))];
  let newPath = r.path;
  for (const f of files) { const to = path.join(dir, path.basename(f)); fs.renameSync(f, to); if (f === r.path) newPath = to; }
  library.invalidate(r.libraryRoot);
  return newPath;
}
async function retry(id) {
  const r = find(id);
  if (!r) throw new Error('Not found');
  removeRec(id);
  return start({ url: r.url, name: r.name, type: r.type, meta: r.meta, previewUrl: r.previewUrl, source: r.source });
}
function removeRec(id) {
  for (const p of core.g().profiles) {
    const d = core.profileStore(p.id).data;
    const before = (d.downloads || []).length;
    d.downloads = (d.downloads || []).filter(x => x.id !== id || live.has(x.id));
    if (d.downloads.length !== before) save(p.id);
  }
}

function markInterrupted() {
  for (const p of core.g().profiles) {
    let changed = false;
    for (const r of historyOf(p.id)) if (['progressing', 'paused', 'starting'].includes(r.state)) { r.state = 'interrupted'; r.error = 'Kiln closed before it finished'; changed = true; }
    if (changed) save(p.id);
  }
}

function register(ctx) {
  send = ctx.send;
  markInterrupted();
  ipcMain.handle('dl:start', (_e, opts) => start(opts));
  ipcMain.handle('dl:list', () => { const a = core.active(); return a ? historyOf(a.profile.id).map(r => pub(strip(r))) : []; });
  ipcMain.handle('dl:control', (_e, { id, action }) => control(id, action));
  ipcMain.handle('dl:set-type', (_e, { id, type }) => setType(id, type));
  ipcMain.handle('dl:retry', (_e, id) => retry(id));
  ipcMain.handle('dl:remove', (_e, id) => { removeRec(id); return true; });
  ipcMain.handle('dl:clear', () => {
    const a = core.active(); if (!a) return [];
    a.data.downloads = historyOf(a.profile.id).filter(r => live.has(r.id) || r.state === 'starting');
    save(a.profile.id);
    return a.data.downloads.map(r => pub(strip(r)));
  });
  ipcMain.handle('dl:open', (_e, id) => { const r = find(id); if (r?.path) shell.showItemInFolder(r.path); });
}

module.exports = { register, attach, start, partitionFor };
