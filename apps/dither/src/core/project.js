// Dither — projects on disk. One folder per project under the projects folder (default ~/Documents/Dither):
//   dither.json            name, boards (draft rounds), references, notes
//   sprites/<id>.dsprite   sprite documents (JSON, cels deflated)
//   effects/<id>/          effect.json (name, versions, feedback) + v1.js, v2.js … (the code of each version)
//   refs/                  reference pictures you dropped in
//   records/               GIFs, videos and contact sheets rendered for review
//   exports/               files made for games and sites (sheets + JSON, GIFs, JS modules)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SP = require('./sprite');

const id6 = () => crypto.randomBytes(3).toString('hex');
const slug = (s) => String(s || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
function readJSON(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function writeJSON(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 1)); fs.renameSync(t, f); }
const safeName = (s) => String(s || 'Untitled').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';

class Project {
  constructor(dir) { this.dir = dir; this.metaFile = path.join(dir, 'dither.json'); this.meta = readJSON(this.metaFile, null); if (!this.meta) throw new Error('Not a Dither project: ' + dir); this.meta.boards ||= []; this.meta.refs ||= []; }
  get id() { return this.meta.id; }
  get name() { return this.meta.name; }
  p(...a) { return path.join(this.dir, ...a); }
  saveMeta() { this.meta.updatedAt = Date.now(); writeJSON(this.metaFile, this.meta); }
  summary() {
    const sprites = this.listSprites(), effects = this.listEffects();
    return { id: this.id, name: this.name, dir: this.dir, createdAt: this.meta.createdAt, updatedAt: this.meta.updatedAt, cover: this.meta.cover || null, counts: { sprites: sprites.length, effects: effects.filter((e) => !e.boardId || e.kept).length, drafts: effects.filter((e) => e.boardId).length, boards: this.meta.boards.length, refs: this.meta.refs.length, scenes: this.listScenes().length, characters: this.listCharacters().length }, description: this.meta.description || '' };
  }

  // ───────── characters (rigs per view; their parts live in ordinary sprites)
  listCharacters() { const d = this.p('characters'); let files = []; try { files = fs.readdirSync(d).filter((f) => f.endsWith('.json')); } catch {} return files.map((f) => readJSON(path.join(d, f), null)).filter(Boolean).map((c) => ({ id: c.id, name: c.name, views: Object.keys(c.views || {}), directions: c.directions, animations: (c.animations || []).length, pixel: c.pixel !== false, cover: c.views && (c.views.side || c.views.front || Object.values(c.views)[0] || {}).sprite, updatedAt: c.updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt); }
  getCharacter(id) { let c = readJSON(this.p('characters', `${id}.json`), null); if (!c) { const hit = this.listCharacters().find((x) => x.name.toLowerCase() === String(id).toLowerCase()); if (hit) c = readJSON(this.p('characters', `${hit.id}.json`), null); } if (!c) throw new Error(`No character “${id}” in ${this.name}`); return c; }
  saveCharacter(c) { if (!c.id) c.id = `${slug(c.name || 'character')}-${id6()}`; c.updatedAt = Date.now(); c.createdAt ||= Date.now(); writeJSON(this.p('characters', `${c.id}.json`), c); this.touch(); return c; }
  removeCharacter(id) { const c = this.getCharacter(id); for (const v of Object.values(c.views || {})) { try { this.removeSprite(v.sprite); } catch {} } this.trash(this.p('characters', `${c.id}.json`)); this.touch(); }

  // ───────── scenes (parallax layers of sprites and terrain-grid tile layers)
  listScenes() { const d = this.p('scenes'); let files = []; try { files = fs.readdirSync(d).filter((f) => f.endsWith('.json')); } catch {} return files.map((f) => readJSON(path.join(d, f), null)).filter(Boolean).map((sc) => ({ id: sc.id, name: sc.name, w: sc.w, h: sc.h, layers: sc.layers.length, length: sc.length, updatedAt: sc.updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt); }
  getScene(id) { let sc = readJSON(this.p('scenes', `${id}.json`), null); if (!sc) { const hit = this.listScenes().find((x) => x.name.toLowerCase() === String(id).toLowerCase()); if (hit) sc = readJSON(this.p('scenes', `${hit.id}.json`), null); } if (!sc) throw new Error(`No scene “${id}” in ${this.name}`); return sc; }
  saveScene(sc) { if (!sc.id) sc.id = `${slug(sc.name || 'scene')}-${id6()}`; sc.updatedAt = Date.now(); sc.createdAt ||= Date.now(); writeJSON(this.p('scenes', `${sc.id}.json`), sc); this.touch(); return sc; }
  removeScene(id) { this.trash(this.p('scenes', `${this.getScene(id).id}.json`)); this.touch(); }

  // ───────── sprites
  listSprites() {
    const d = this.p('sprites'); let files = []; try { files = fs.readdirSync(d).filter((f) => f.endsWith('.dsprite')); } catch {}
    return files.map((f) => { const s = readJSON(path.join(d, f), null); return s && { id: s.id, name: s.name, w: s.w, h: s.h, frames: s.frames.length, layers: s.layers.length, palette: s.palette.length, updatedAt: s.updatedAt, from: s.from || null, tileset: s.tileset ? { tile: s.tileset.tile, kind: s.tileset.kind, count: s.tileset.count } : undefined, partsOf: s.partsOf || undefined }; }).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  spriteFile(id) { return this.p('sprites', `${id}.dsprite`); }
  getSprite(id) { const s = readJSON(this.spriteFile(id), null) || this.findSpriteByName(id); if (!s) throw new Error(`No sprite “${id}” in ${this.name}`); return SP.hydrate(s); }
  findSpriteByName(name) { const hit = this.listSprites().find((s) => s.name.toLowerCase() === String(name).toLowerCase()); return hit ? readJSON(this.spriteFile(hit.id), null) : null; }
  saveSprite(s) { writeJSON(this.spriteFile(s.id), SP.serialize(s)); this.touch(); return s; }
  removeSprite(id) { this.trash(this.spriteFile(id)); this.touch(); }

  // ───────── effects (each version is its own file, so nothing Claude or you tried is ever lost)
  effectDir(id) { return this.p('effects', id); }
  listEffects() {
    const d = this.p('effects'); let ids = []; try { ids = fs.readdirSync(d).filter((f) => fs.existsSync(path.join(d, f, 'effect.json'))); } catch {}
    return ids.map((id) => this.effectMeta(id)).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  effectMeta(id) { const m = readJSON(path.join(this.effectDir(id), 'effect.json'), null); return m && { ...m, id }; }
  resolveEffect(ref) { const all = this.listEffects(); const m = all.find((e) => e.id === ref) || all.find((e) => e.name.toLowerCase() === String(ref).toLowerCase()); if (!m) throw new Error(`No effect “${ref}” in ${this.name}. Effects: ${all.slice(0, 20).map((e) => `${e.id} (${e.name})`).join(', ') || 'none yet'}`); return m; }
  getEffect(ref, version) {
    const m = this.resolveEffect(ref); const v = Number(version) || m.current || m.versions.length;
    const ver = m.versions.find((x) => x.v === v); if (!ver) throw new Error(`${m.name} has no version ${v} (1–${m.versions.length})`);
    return { ...m, version: v, code: fs.readFileSync(path.join(this.effectDir(m.id), `v${v}.js`), 'utf8') };
  }
  createEffect({ name, code, by = 'you', note = '', boardId = null, from = null }) {
    const id = `${slug(name)}-${id6()}`; const dir = this.effectDir(id); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'v1.js'), code);
    const m = { name: String(name || 'Untitled effect'), createdAt: Date.now(), updatedAt: Date.now(), by, boardId, from, current: 1, versions: [{ v: 1, at: Date.now(), by, note }], feedback: { verdict: null, stars: 0, notes: [] }, params: {}, kept: !boardId };
    writeJSON(path.join(dir, 'effect.json'), m);
    if (boardId) { const b = this.meta.boards.find((x) => x.id === boardId); if (b && !b.items.includes(id)) { b.items.push(id); this.saveMeta(); } }
    this.touch(); return { ...m, id };
  }
  updateEffect(ref, { code, by = 'you', note = '', name }) {
    const m = this.resolveEffect(ref); const dir = this.effectDir(m.id);
    const cur = fs.readFileSync(path.join(dir, `v${m.current || m.versions.length}.js`), 'utf8');
    if (code === cur && !name) return m;
    const full = readJSON(path.join(dir, 'effect.json'), {});
    if (code !== undefined && code !== cur) { const v = full.versions.length + 1; fs.writeFileSync(path.join(dir, `v${v}.js`), code); full.versions.push({ v, at: Date.now(), by, note }); full.current = v; }
    if (name) full.name = String(name);
    full.updatedAt = Date.now(); writeJSON(path.join(dir, 'effect.json'), full); this.touch(); return { ...full, id: m.id };
  }
  patchEffect(ref, patch) { const m = this.resolveEffect(ref); const f = path.join(this.effectDir(m.id), 'effect.json'); const full = readJSON(f, {}); Object.assign(full, patch, { updatedAt: Date.now() }); writeJSON(f, full); this.touch(); return { ...full, id: m.id }; }
  feedback(ref, patch) {
    const m = this.resolveEffect(ref); const f = path.join(this.effectDir(m.id), 'effect.json'); const full = readJSON(f, {});
    const fb = full.feedback || { verdict: null, stars: 0, notes: [] };
    if ('verdict' in patch) fb.verdict = patch.verdict; if ('stars' in patch) fb.stars = Math.max(0, Math.min(3, patch.stars | 0));
    if (patch.note) fb.notes.push({ text: String(patch.note).slice(0, 2000), at: Date.now(), v: full.current, frame: patch.frame ?? null, by: patch.by || 'you', done: false });
    if (patch.resolve != null) fb.notes.forEach((n, i) => { if (i === patch.resolve || patch.resolve === 'all') n.done = true; });
    if (patch.removeNote != null) fb.notes.splice(patch.removeNote, 1);
    full.feedback = fb; full.updatedAt = Date.now(); if (patch.verdict === 'pick') full.kept = true; writeJSON(f, full); this.touch(); return { ...full, id: m.id };
  }
  removeEffect(ref) { const m = this.resolveEffect(ref); this.trash(this.effectDir(m.id)); for (const b of this.meta.boards) b.items = b.items.filter((x) => x !== m.id); this.saveMeta(); }

  // ───────── boards: one round of drafts for one idea
  createBoard({ idea, by = 'you', brief = '' }) { const b = { id: 'b' + id6(), idea: String(idea || 'Untitled idea').slice(0, 300), brief: String(brief || '').slice(0, 4000), by, createdAt: Date.now(), items: [], status: 'open', round: 1 }; this.meta.boards.unshift(b); this.saveMeta(); return b; }
  getBoard(id) { const b = this.meta.boards.find((x) => x.id === id) || (id === 'latest' ? this.meta.boards[0] : null); if (!b) throw new Error(`No board “${id}”`); return b; }
  patchBoard(id, patch) { const b = this.getBoard(id); Object.assign(b, patch); this.saveMeta(); return b; }
  removeBoard(id) { const b = this.getBoard(id); this.meta.boards = this.meta.boards.filter((x) => x !== b); this.saveMeta(); }

  // ───────── clips: video-model (or imported) animations kept as PNG frames, waiting to become sprites
  listClips() {
    const d = this.p('clips'); let ids = []; try { ids = fs.readdirSync(d).filter((f) => fs.existsSync(path.join(d, f, 'clip.json'))); } catch {}
    return ids.map((id) => ({ ...readJSON(path.join(d, id, 'clip.json'), {}), id })).sort((a, b) => b.createdAt - a.createdAt);
  }
  getClip(id) { const m = readJSON(this.p('clips', id, 'clip.json'), null); if (!m) throw new Error(`No clip “${id}”`); return { ...m, id }; }
  saveClip({ name, frames, fps, source, meta = {} }) {
    const png = require('./png'); const id = `${slug(name || 'clip')}-${id6()}`; const dir = this.p('clips', id); fs.mkdirSync(dir, { recursive: true });
    frames.forEach((f, i) => fs.writeFileSync(path.join(dir, `f${String(i).padStart(3, '0')}.png`), png.encode(f, { level: 6 })));
    if (source) fs.writeFileSync(path.join(dir, 'source.png'), png.encode(source));
    const m = { name: String(name || 'Clip').slice(0, 80), fps, w: frames[0].w, h: frames[0].h, n: frames.length, createdAt: Date.now(), sprites: [], ...meta };
    writeJSON(path.join(dir, 'clip.json'), m); this.touch(); return { ...m, id };
  }
  patchClip(id, patch) { const f = this.p('clips', id, 'clip.json'); const m = readJSON(f, null); if (!m) throw new Error('No such clip'); Object.assign(m, patch); writeJSON(f, m); return { ...m, id }; }
  clipFrames(id, { every = 1, max = 400 } = {}) { const png = require('./png'); const dir = this.p('clips', id); const files = fs.readdirSync(dir).filter((f) => /^f\d+\.png$/.test(f)).sort(); return files.filter((_, i) => i % every === 0).slice(0, max).map((f) => png.decode(fs.readFileSync(path.join(dir, f)))); }
  removeClip(id) { this.trash(this.p('clips', id)); this.touch(); }

  // ───────── references
  addRef(file, note = '') {
    const ext = path.extname(file).toLowerCase(); if (!/\.(png|jpe?g|gif|webp|bmp)$/.test(ext)) throw new Error('References can be PNG, JPG, GIF, WebP or BMP pictures');
    const name = `${slug(path.basename(file, ext))}-${id6()}${ext}`; fs.mkdirSync(this.p('refs'), { recursive: true }); fs.copyFileSync(file, this.p('refs', name));
    const r = { id: 'r' + id6(), file: name, title: path.basename(file, ext), note, addedAt: Date.now() }; this.meta.refs.unshift(r); this.saveMeta(); return r;
  }
  patchRef(id, patch) { const r = this.meta.refs.find((x) => x.id === id); if (!r) throw new Error('No such reference'); Object.assign(r, patch); this.saveMeta(); return r; }
  removeRef(id) { const r = this.meta.refs.find((x) => x.id === id); if (!r) return; this.trash(this.p('refs', r.file)); this.meta.refs = this.meta.refs.filter((x) => x !== r); this.saveMeta(); }

  outDir(kind) { const d = this.p(kind); fs.mkdirSync(d, { recursive: true }); return d; }
  uniqueFile(dir, base, ext) { let f = path.join(dir, `${base}${ext}`); for (let i = 2; fs.existsSync(f); i++) f = path.join(dir, `${base} ${i}${ext}`); return f; }
  trash(target) { if (!fs.existsSync(target)) return; const d = this.p('.trash'); fs.mkdirSync(d, { recursive: true }); fs.renameSync(target, path.join(d, `${Date.now()}-${path.basename(target)}`)); }
  touch() { this.meta.updatedAt = Date.now(); writeJSON(this.metaFile, this.meta); }
}

class Library {
  constructor(root) { this.root = root; this.open = new Map(); }
  setRoot(r) { this.root = r; this.open.clear(); }
  list() {
    fs.mkdirSync(this.root, { recursive: true }); const out = [];
    for (const n of fs.readdirSync(this.root)) { const d = path.join(this.root, n); if (!fs.existsSync(path.join(d, 'dither.json'))) continue; try { out.push(this.get(d).summary()); } catch {} }
    return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  get(ref) {
    if (ref instanceof Project) return ref;
    let dir = ref && fs.existsSync(path.join(String(ref), 'dither.json')) ? String(ref) : null;
    if (!dir) { for (const n of fs.existsSync(this.root) ? fs.readdirSync(this.root) : []) { const d = path.join(this.root, n); const m = readJSON(path.join(d, 'dither.json'), null); if (m && (m.id === ref || m.name.toLowerCase() === String(ref).toLowerCase())) { dir = d; break; } } }
    if (!dir) throw new Error(`No project “${ref}”`);
    if (!this.open.has(dir)) this.open.set(dir, new Project(dir));
    const p = this.open.get(dir); p.meta = readJSON(p.metaFile, p.meta); p.meta.boards ||= []; p.meta.refs ||= []; return p;
  }
  create(name, { description = '' } = {}) {
    const base = safeName(name); let dir = path.join(this.root, base); for (let i = 2; fs.existsSync(dir); i++) dir = path.join(this.root, `${base} ${i}`);
    fs.mkdirSync(dir, { recursive: true }); for (const s of ['sprites', 'effects', 'clips', 'scenes', 'characters', 'refs', 'records', 'exports']) fs.mkdirSync(path.join(dir, s), { recursive: true });
    writeJSON(path.join(dir, 'dither.json'), { dither: 1, id: 'p' + crypto.randomBytes(4).toString('hex'), name: path.basename(dir), description, createdAt: Date.now(), updatedAt: Date.now(), boards: [], refs: [] });
    return this.get(dir);
  }
  rename(ref, name) { const p = this.get(ref); p.meta.name = safeName(name); p.saveMeta(); return p; }
}

module.exports = { Project, Library, slug, readJSON, writeJSON };
