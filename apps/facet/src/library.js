// Facet — the library: one folder per model in ~/Documents/Facet, each with model.glb, the input image(s),
// a thumbnail and facet.json describing how it was made.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { shell } = require('electron');
const core = require('./core');

const META = 'facet.json';

function slug(s) {
  return String(s || 'model').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'model';
}
function nameFrom(text) {
  const words = String(text || '').replace(/[,.;:!?].*$/s, '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const n = words.join(' ');
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : 'Untitled model';
}
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

function newFolder(name) {
  const root = core.outputDir();
  const base = `${slug(name)} ${stamp()}`;
  let dir = path.join(root, base), i = 2;
  while (fs.existsSync(dir)) dir = path.join(root, `${base} (${i++})`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readMeta(dir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, META), 'utf8'));
    m.dir = dir;
    return m;
  } catch { return null; }
}
function writeMeta(m) {
  const { dir, ...rest } = m;
  rest.updatedAt = Date.now();
  fs.writeFileSync(path.join(dir, META), JSON.stringify(rest, null, 2));
  return { ...rest, dir };
}

function decorate(m) {
  const f = (n) => (n && fs.existsSync(path.join(m.dir, n)) ? path.join(m.dir, n) : null);
  return { ...m, paths: { model: f(m.files?.model), input: f(m.files?.input), thumb: f(m.files?.thumb), rigged: f(m.files?.rigged), dir: m.dir } };
}

function list() {
  const root = core.outputDir();
  let out = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const m = readMeta(path.join(root, e.name));
    if (m && m.files?.model && fs.existsSync(path.join(m.dir, m.files.model))) out.push(decorate(m));
  }
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return out;
}
function find(id) { return list().find(m => m.id === id) || null; }

function create({ name, source, engine, params }) {
  const dir = newFolder(name);
  const m = { id: crypto.randomUUID(), name, createdAt: Date.now(), source, engine, params, stats: null, favorite: false, files: { model: 'model.glb', input: 'input.png', thumb: 'thumb.png' }, dir };
  return m;
}
function finish(m, stats) { m.stats = stats; return decorate(writeMeta(m)); }
function abandon(m) { try { fs.rmSync(m.dir, { recursive: true, force: true }); } catch {} }

function update(id, patch) {
  const m = find(id);
  if (!m) return null;
  const allowed = {};
  if ('name' in patch) allowed.name = String(patch.name || '').trim().slice(0, 80) || m.name;
  if ('favorite' in patch) allowed.favorite = !!patch.favorite;
  if ('notes' in patch) allowed.notes = String(patch.notes || '').slice(0, 4000);
  const { paths, ...raw } = m;
  return decorate(writeMeta({ ...raw, ...allowed }));
}

function setRig(id, rig) {
  const m = find(id);
  if (!m) return null;
  const { paths, ...raw } = m;
  raw.files = { ...raw.files, rigged: rig ? 'model-rigged.glb' : null };
  raw.rig = rig;
  return decorate(writeMeta(raw));
}

function setThumb(id, dataUrl) {
  const m = find(id);
  if (!m || !/^data:image\/png;base64,/.test(dataUrl)) return false;
  fs.writeFileSync(path.join(m.dir, m.files.thumb || 'thumb.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
  return true;
}

async function trash(id) {
  const m = find(id);
  if (!m) return false;
  try { await shell.trashItem(m.dir); } catch { fs.rmSync(m.dir, { recursive: true, force: true }); }
  return true;
}

// Adds an existing 3D file to the library (GLB is copied as-is; other formats are converted by the engine)
function importStart(file) {
  const name = nameFrom(path.basename(file, path.extname(file)).replace(/[-_]+/g, ' '));
  const m = create({ name, source: { mode: 'import', file: path.basename(file) }, engine: 'import', params: {} });
  m.files.input = null;
  return m;
}

module.exports = { list, find, create, finish, abandon, update, setThumb, setRig, trash, importStart, nameFrom, writeMeta, decorate };
