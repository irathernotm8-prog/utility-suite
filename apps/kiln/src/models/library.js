// Kiln — the local model library: listing, previews, metadata, moving and deleting models.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ipcMain, shell, net } = require('electron');
const core = require('../core');
const sources = require('./sources');
const { MODEL_TYPES, MODEL_EXT, byId } = require('../shared/types');

let send = () => {};
const cache = new Map();   // libRoot -> { at, items }
const PREVIEW_EXTS = ['.preview.jpeg', '.preview.jpg', '.preview.png', '.preview.webp', '.jpeg', '.jpg', '.png', '.webp'];

function baseOf(file) { return file.slice(0, file.length - path.extname(file).length); }
function findPreview(file) {
  const b = baseOf(file);
  for (const e of PREVIEW_EXTS) if (fs.existsSync(b + e)) return b + e;
  return null;
}
function readInfo(file) {
  try {
    const j = JSON.parse(fs.readFileSync(baseOf(file) + '.cm-info.json', 'utf8'));
    return {
      modelId: j.ModelId, versionId: j.VersionId, modelName: j.ModelName || '', versionName: j.VersionName || '', baseModel: j.BaseModel || '',
      trainedWords: j.TrainedWords || [], nsfw: !!j.Nsfw, author: j.AuthorUsername || '', tags: j.Tags || [], civType: j.ModelType || '',
      sha256: j.Hashes?.SHA256 || null, userTitle: j.UserTitle || null, sourceUrl: j.SourceUrl || (j.ModelId ? `https://civitai.com/models/${j.ModelId}?modelVersionId=${j.VersionId}` : null)
    };
  } catch { return null; }
}

function walk(dir, type, root, out, depth = 5, seen = new Set()) {
  let real = dir;
  try { real = fs.realpathSync(dir); } catch {}
  if (seen.has(real)) return;
  seen.add(real);
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of list) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory() || e.isSymbolicLink()) {
      let isDir = e.isDirectory();
      if (e.isSymbolicLink()) { try { isDir = fs.statSync(p).isDirectory(); } catch { isDir = false; } }
      if (isDir) { if (depth > 0) walk(p, type, root, out, depth - 1, seen); continue; }
    }
    if (!MODEL_EXT.test(e.name)) continue;
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.size < 1024) continue;
    const info = readInfo(p);
    out.push({
      path: p, file: e.name, name: path.basename(e.name, path.extname(e.name)), ext: path.extname(e.name).slice(1).toLowerCase(),
      type, folder: path.relative(path.join(root, type), dir).split(path.sep).join('/'), size: st.size, mtime: st.mtimeMs,
      preview: findPreview(p), info, title: info?.userTitle || info?.modelName || path.basename(e.name, path.extname(e.name))
    });
  }
}

function scan(root, force = false) {
  if (!root) return [];
  const c = cache.get(root);
  if (c && !force && Date.now() - c.at < 30000) return c.items;
  const items = [];
  for (const t of MODEL_TYPES) walk(path.join(root, t.id), t.id, root, items);
  items.sort((a, b) => b.mtime - a.mtime);
  cache.set(root, { at: Date.now(), items });
  return items;
}
function invalidate(root) { if (root) cache.delete(root); else cache.clear(); send('lib:changed', {}); }
function activeRoot() { return core.active()?.library?.path || null; }

function inLibrary(p) {
  const root = activeRoot();
  return root && path.resolve(p).toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep);
}
function sidecars(p) {
  const b = baseOf(p);
  return [b + '.cm-info.json', ...PREVIEW_EXTS.map(e => b + e), b + '.json', b + '.civitai.info', b + '.sha256'].filter(f => fs.existsSync(f));
}

async function remove(p) {
  if (!inLibrary(p)) throw new Error('That file isn’t in this profile’s library');
  for (const f of [p, ...sidecars(p)]) await shell.trashItem(f).catch(() => fs.promises.rm(f, { force: true }));
  invalidate(activeRoot());
  return true;
}
function move(p, toType, sub = '') {
  if (!inLibrary(p)) throw new Error('That file isn’t in this profile’s library');
  if (!byId[toType]) throw new Error('Unknown model type');
  const dir = path.join(activeRoot(), toType, ...String(sub || '').split('/').filter(Boolean));
  fs.mkdirSync(dir, { recursive: true });
  for (const f of [p, ...sidecars(p)]) {
    const to = path.join(dir, path.basename(f));
    if (fs.existsSync(to)) throw new Error(`${path.basename(f)} already exists there`);
    fs.renameSync(f, to);
  }
  invalidate(activeRoot());
  return path.join(dir, path.basename(p));
}
function setTitle(p, title) {
  const file = baseOf(p) + '.cm-info.json';
  let j = {};
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  j.UserTitle = title || null;
  fs.writeFileSync(file, JSON.stringify(j));
  invalidate(activeRoot());
}

/* ---------- metadata from CivitAI by hash ---------- */
function sha256(file, onProgress) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const total = fs.statSync(file).size;
    let got = 0, last = 0;
    fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 })
      .on('data', (c) => { h.update(c); got += c.length; const now = Date.now(); if (now - last > 300) { last = now; onProgress?.(got / total); } })
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex').toUpperCase()));
  });
}
async function savePreview(url, file) {
  const res = await net.fetch(sources.thumb(url, 768));
  if (!res.ok) return null;
  const ext = /png/.test(res.headers.get('content-type') || '') ? '.preview.png' : '.preview.jpeg';
  const out = baseOf(file) + ext;
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return out;
}
function pickPreview(images, allowNsfw) {
  const imgs = (images || []).filter(i => i.type === 'image');
  return (allowNsfw ? imgs[0] : imgs.find(i => (i.nsfwLevel || 1) <= 2)) || null;
}
async function lookup(p) {
  if (!inLibrary(p)) throw new Error('That file isn’t in this profile’s library');
  const onProgress = (f) => send('lib:hash-progress', { path: p, progress: f });
  const existing = readInfo(p);
  const hash = existing?.sha256 || await sha256(p, onProgress);
  onProgress(1);
  let found;
  try { found = await sources.civByHash(hash); }
  catch (e) { if (e.code === 404) return { found: false, hash }; throw e; }
  let model = found.model;
  try { model = await sources.civModel(found.modelId); } catch {}
  const file = found.version.files.find(f => (f.hashes?.SHA256 || '').toUpperCase() === hash) || found.version.files.find(f => f.primary) || found.version.files[0];
  const info = sources.cmInfo({ model: { ...model, creator: { username: model.creator } }, version: found.version, file });
  info.Hashes.SHA256 = hash;
  fs.writeFileSync(baseOf(p) + '.cm-info.json', JSON.stringify(info));
  if (!findPreview(p)) {
    const allow = core.active()?.data.settings.nsfw === 'show';
    const img = pickPreview(found.version.images, allow);
    if (img) { try { await savePreview(img.url, p); } catch {} }
  }
  invalidate(activeRoot());
  return { found: true, hash, name: model.name, version: found.version.name };
}
async function lookupAll() {
  const items = scan(activeRoot(), true).filter(m => !m.info);
  let done = 0, found = 0;
  for (const m of items) {
    send('lib:scan-progress', { done, total: items.length, current: m.file });
    try { const r = await lookup(m.path); if (r.found) found++; } catch {}
    done++;
  }
  send('lib:scan-progress', { done, total: items.length, finished: true, found });
  return { total: items.length, found };
}

/* ---------- names the generators use ---------- */
// LoRA token for prompts: file name without extension (A1111/Forge style)
function loraToken(m) { return `<lora:${m.name}:1>`; }

function register(ctx) {
  send = ctx.send;
  ipcMain.handle('lib:list', (_e, { force } = {}) => scan(activeRoot(), force));
  ipcMain.handle('lib:types', () => MODEL_TYPES);
  ipcMain.handle('lib:remove', (_e, p) => remove(p));
  ipcMain.handle('lib:move', (_e, { path: p, type, sub }) => move(p, type, sub));
  ipcMain.handle('lib:set-title', (_e, { path: p, title }) => setTitle(p, title));
  ipcMain.handle('lib:lookup', (_e, p) => lookup(p));
  ipcMain.handle('lib:lookup-all', () => lookupAll());
  ipcMain.handle('lib:open-folder', (_e, type) => { const r = activeRoot(); if (r) shell.openPath(type ? core.ensureDir(path.join(r, type)) : r); });
  ipcMain.handle('lib:show', (_e, p) => { if (inLibrary(p)) shell.showItemInFolder(p); });
  ipcMain.handle('lib:import-files', async (_e, { files, type }) => {
    const root = activeRoot();
    if (!root) throw new Error('No library');
    const out = [];
    for (const f of files || []) {
      if (!MODEL_EXT.test(f)) continue;
      const t = type || require('../shared/types').guessType(path.basename(f), fs.statSync(f).size);
      const dest = path.join(core.ensureDir(path.join(root, t)), path.basename(f));
      if (fs.existsSync(dest)) continue;
      await fs.promises.copyFile(f, dest);   // copy: the original stays where it was
      out.push(dest);
    }
    invalidate(root);
    return out;
  });
}

module.exports = { register, scan, invalidate, activeRoot, readInfo, findPreview, baseOf, savePreview, pickPreview, loraToken, sha256 };
