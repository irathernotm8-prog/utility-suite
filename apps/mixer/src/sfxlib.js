// Mixer — sound-effect packs on disk: ~/Documents/Mixer/Sound FX/<Pack>/pack.json holds every sound's recipe (tiny,
// so a whole game's worth fits in a few KB); exports go where you choose: WAV or MP3 files, a sounds.json manifest,
// or a self-contained JavaScript module that synthesizes the pack in the browser at runtime.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const X = require('./core/sfx');

const slug = (s) => String(s || 'Untitled').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Untitled';
const fileSafe = (s) => String(s || 'sound').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'sound';
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const uid = () => 's' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

function hydrate(s) {
  const o = { id: s.id || uid(), name: String(s.name || 'Sound').slice(0, 60), kind: s.kind || 'custom', gain: +s.gain || 0, bits: [16, 8, 6, 4].includes(+s.bits) ? +s.bits : 16, rate: [44100, 22050, 11025, 5512].includes(+s.rate) ? +s.rate : 44100, normalize: s.normalize !== false, tags: s.tags || [], note: s.note || '' };
  o.layers = (s.layers && s.layers.length ? s.layers : [{ params: X.defaults() }]).slice(0, 4).map((L, i) => ({ on: L.on !== false, delay: Math.max(0, Math.min(4, +L.delay || 0)), gain: Math.max(-40, Math.min(12, +L.gain || 0)), pitch: Math.max(-24, Math.min(24, +L.pitch || 0)), seed: L.seed || i + 1, params: X.norm(L.params || {}) }));
  return o;
}

class Pack {
  constructor(dir) { this.dir = dir; this.id = path.basename(dir); const j = readJSON(path.join(dir, 'pack.json'), {}); this.name = j.name || this.id; this.sounds = (j.sounds || []).map(hydrate); this.updatedAt = j.updatedAt || Date.now(); this.exportDir = j.exportDir || null; }
  save() { this.updatedAt = Date.now(); const f = path.join(this.dir, 'pack.json'); fs.writeFileSync(f + '.tmp', JSON.stringify({ v: 1, name: this.name, updatedAt: this.updatedAt, exportDir: this.exportDir, sounds: this.sounds }, null, 1)); fs.renameSync(f + '.tmp', f); }
  find(ref, { must = true } = {}) { const r = String(ref ?? '').toLowerCase().trim(); const s = this.sounds.find((x) => x.id === ref) || this.sounds.find((x) => x.name.toLowerCase() === r) || (/^\d+$/.test(r) ? this.sounds[+r - 1] : null) || this.sounds.find((x) => x.name.toLowerCase().startsWith(r)); if (!s && must) throw new Error(`No sound “${ref}” in ${this.name}. Sounds: ${this.sounds.map((x) => x.name).join(', ') || 'none yet'}.`); return s || null; }
  uniqueName(n) { let name = slug(n), i = 2; while (this.sounds.some((s) => s.name.toLowerCase() === name.toLowerCase())) name = `${slug(n)} ${i++}`; return name; }
  upsert(s) { const h = hydrate(s); const i = this.sounds.findIndex((x) => x.id === h.id); if (i >= 0) this.sounds[i] = h; else this.sounds.push(h); this.save(); return h; }
  remove(ref) { const s = this.find(ref); this.sounds = this.sounds.filter((x) => x !== s); this.save(); return s; }
  info() { return { id: this.id, name: this.name, count: this.sounds.length, updatedAt: this.updatedAt, dir: this.dir }; }
}

class SfxLib {
  constructor(rootFn) { this.rootFn = rootFn; this.cache = new Map(); }
  root() { const d = path.join(this.rootFn(), 'Sound FX'); fs.mkdirSync(d, { recursive: true }); return d; }
  list() { const out = []; for (const e of fs.readdirSync(this.root(), { withFileTypes: true })) if (e.isDirectory() && fs.existsSync(path.join(this.root(), e.name, 'pack.json'))) out.push(this.get(e.name).info()); return out.sort((a, b) => b.updatedAt - a.updatedAt); }
  get(id) {
    const dir = path.join(this.root(), path.basename(String(id))); const c = this.cache.get(dir); if (c) return c;
    if (!fs.existsSync(path.join(dir, 'pack.json'))) { const m = this.list().find((p) => p.name.toLowerCase() === String(id).toLowerCase()); if (m) return this.get(m.id); throw new Error(`No sound pack “${id}”. Packs: ${this.list().map((p) => p.name).join(', ') || 'none yet'}.`); }
    const p = new Pack(dir); this.cache.set(dir, p); return p;
  }
  create(name) { const base = slug(name || 'Sound pack'); let id = base, i = 2; while (fs.existsSync(path.join(this.root(), id))) id = `${base} ${i++}`; fs.mkdirSync(path.join(this.root(), id), { recursive: true }); const p = new Pack(path.join(this.root(), id)); p.name = name || id; p.save(); this.cache.set(p.dir, p); return p; }
  ensure(id) { if (id) { try { return this.get(id); } catch {} } const l = this.list(); return l.length ? this.get(l[0].id) : this.create('My game sounds'); }
  rename(id, name) { const p = this.get(id); p.name = String(name).slice(0, 60) || p.name; p.save(); return p; }
}

// ───── exporting
let lame = null;
function mp3(y, kbps = 192) {
  if (!lame) { const ctx = {}; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, 'vendor', 'lamejs', 'lame.min.js'), 'utf8'), ctx); lame = ctx.lamejs; }
  const enc = new lame.Mp3Encoder(1, 44100, kbps); const i16 = new Int16Array(y.length); for (let i = 0; i < y.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(y[i] * 32767)));
  const parts = []; for (let i = 0; i < i16.length; i += 1152 * 8) { const b = enc.encodeBuffer(i16.subarray(i, i + 1152 * 8)); if (b.length) parts.push(Buffer.from(b)); } const f = enc.flush(); if (f.length) parts.push(Buffer.from(f)); return Buffer.concat(parts);
}
function jsModule(pack, sounds) {
  const src = fs.readFileSync(path.join(__dirname, 'core', 'sfx.js'), 'utf8');
  const recipes = Object.fromEntries(sounds.map((s) => [fileSafe(s.name), { gain: s.gain, bits: s.bits, rate: s.rate, normalize: s.normalize, layers: s.layers.map((L) => ({ ...L, params: Object.fromEntries(Object.entries(L.params).filter(([k, v]) => v !== X.PARAMS[k][2])) })) }]));
  return `// ${pack.name} — game sound effects made in Mixer. They are synthesized in the browser when first played, so this
// one file is the whole pack (no audio files to load).
//   import { play, names } from './${fileSafe(pack.name)}.js';   play('${Object.keys(recipes)[0] || 'coin'}');   play('jump', { volume: 0.5, pitch: 1.2 });
// buffer(name, audioContext) gives you an AudioBuffer if you have your own audio setup (Phaser, Howler, PixiJS sound…).
const MXSfx = (() => { const module = { exports: {} }; ${src.replace(/^\/\/.*$/gm, '').trim()}
return module.exports; })();
export const sounds = ${JSON.stringify(recipes)};
export const names = Object.keys(sounds);
let ctx = null; const made = new Map();
export function buffer(name, audioCtx) {
  const ac = audioCtx || ctx || (ctx = new AudioContext()); const key = name; if (made.has(key) && made.get(key).ac === ac) return made.get(key).b;
  const s = sounds[name]; if (!s) throw new Error('No sound ' + name + '. Sounds: ' + names.join(', '));
  const y = MXSfx.render(s); const b = ac.createBuffer(1, y.length, MXSfx.SR); b.copyToChannel(y, 0); made.set(key, { ac, b }); return b;
}
export function play(name, { volume = 1, pitch = 1, when = 0 } = {}) {
  if (!ctx) ctx = new AudioContext(); if (ctx.state === 'suspended') ctx.resume();
  const src = ctx.createBufferSource(); src.buffer = buffer(name, ctx); src.playbackRate.value = pitch; const g = ctx.createGain(); g.gain.value = volume; src.connect(g); g.connect(ctx.destination); src.start(ctx.currentTime + when); return src;
}
export default { play, buffer, names, sounds };
`;
}
// files: [{ name, path }]; variations add name_1… with small random changes (seeded, so re-exports match)
function exportPack(pack, { ids = null, format = 'wav', folder, variations = 0, amount = 0.25, kbps = 192 } = {}) {
  const dest = folder || path.join(pack.dir, 'exports'); fs.mkdirSync(dest, { recursive: true });
  const list = ids && ids.length ? ids.map((r) => pack.find(r)) : pack.sounds; if (!list.length) throw new Error('This pack has no sounds yet.');
  const files = []; const manifest = [];
  const write = (name, s) => { const y = X.render(s); const base = path.join(dest, name); if (format === 'wav' || format === 'all') { fs.writeFileSync(base + '.wav', Buffer.from(X.wav(y))); files.push(base + '.wav'); } if (format === 'mp3' || format === 'all') { fs.writeFileSync(base + '.mp3', mp3(y, kbps)); files.push(base + '.mp3'); } manifest.push({ name, seconds: +(y.length / X.SR).toFixed(3) }); };
  if (format !== 'js') for (const s of list) { write(fileSafe(s.name), s); for (let v = 1; v <= Math.min(12, variations); v++) write(`${fileSafe(s.name)}_${v}`, X.mutateSound(s, amount, v * 7919)); }
  if (format === 'js' || format === 'all') { const f = path.join(dest, fileSafe(pack.name) + '.js'); fs.writeFileSync(f, jsModule(pack, list)); files.push(f); }
  if (format !== 'js') { const f = path.join(dest, 'sounds.json'); fs.writeFileSync(f, JSON.stringify({ pack: pack.name, made_with: 'Mixer', sounds: manifest }, null, 1)); files.push(f); }
  return { folder: dest, files };
}
module.exports = { SfxLib, Pack, hydrate, exportPack, jsModule, fileSafe, mp3 };
