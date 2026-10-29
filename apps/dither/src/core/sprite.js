// Dither — the sprite document: layers × frames of RGBA cels, a palette, timing and tags. Pure data + functions so
// the window, the main process and the tests share it. On disk cels are deflated RGBA in base64.
'use strict';
const zlib = require('zlib');
const crypto = require('crypto');
const FX = require('./fxruntime');

const uid = (p = '') => p + crypto.randomBytes(5).toString('hex');

function create({ name = 'Sprite', w = 32, h = 32, palette = 'pico8', frames = 1, fps = 12, background = null } = {}) {
  w = Math.max(1, Math.min(512, w | 0)); h = Math.max(1, Math.min(512, h | 0));
  const layer = { id: uid('l'), name: 'Layer 1', visible: true, opacity: 1 };
  const s = { dither: 1, kind: 'sprite', id: uid('s'), name, w, h, palette: FX.resolvePalette(palette), fps, layers: [layer], frames: [], cels: {}, tags: [], background, createdAt: Date.now(), updatedAt: Date.now() };
  for (let i = 0; i < Math.max(1, frames | 0); i++) s.frames.push({ id: uid('f'), duration: Math.round(1000 / fps) });
  return s;
}
const celKey = (layerId, frameId) => `${layerId}/${frameId}`;
function getCel(s, layerId, frameId) { const c = s.cels[celKey(layerId, frameId)]; return c instanceof Uint8ClampedArray ? c : c ? unpackCel(c, s.w, s.h) : null; }
function setCel(s, layerId, frameId, data) { if (!data || isEmpty(data)) delete s.cels[celKey(layerId, frameId)]; else s.cels[celKey(layerId, frameId)] = data; s.updatedAt = Date.now(); }
function isEmpty(d) { for (let i = 3; i < d.length; i += 4) if (d[i]) return false; return true; }
function packCel(data) { return zlib.deflateSync(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).toString('base64'); }
function unpackCel(b64, w, h) { const buf = zlib.inflateSync(Buffer.from(b64, 'base64')); const d = new Uint8ClampedArray(w * h * 4); d.set(buf.subarray(0, d.length)); return d; }

// everything live (Uint8ClampedArray cels) ⇄ storable (base64 cels)
function serialize(s) { const out = { ...s, cels: {} }; for (const [k, v] of Object.entries(s.cels)) out.cels[k] = v instanceof Uint8ClampedArray ? packCel(v) : v; out.updatedAt = Date.now(); return out; }
function hydrate(s) { const out = { ...s, cels: {} }; for (const [k, v] of Object.entries(s.cels || {})) out.cels[k] = typeof v === 'string' ? unpackCel(v, s.w, s.h) : v instanceof Uint8ClampedArray ? v : new Uint8ClampedArray(v); return out; }

function compose(s, frameIndex, { only = null, hidden = false } = {}) {
  const f = s.frames[frameIndex]; const out = new Uint8ClampedArray(s.w * s.h * 4); if (!f) return out;
  for (const l of s.layers) {
    if (only && l.id !== only) continue; if (!l.visible && !hidden) continue;
    const c = getCel(s, l.id, f.id); if (!c) continue; const op = l.opacity ?? 1;
    for (let i = 0; i < c.length; i += 4) {
      const a = c[i + 3] / 255 * op; if (!a) continue;
      if (a >= 1 || !out[i + 3]) { out[i] = c[i]; out[i + 1] = c[i + 1]; out[i + 2] = c[i + 2]; out[i + 3] = Math.round(Math.max(out[i + 3], a * 255)); continue; }
      out[i] = c[i] * a + out[i] * (1 - a); out[i + 1] = c[i + 1] * a + out[i + 1] * (1 - a); out[i + 2] = c[i + 2] * a + out[i + 2] * (1 - a); out[i + 3] = Math.max(out[i + 3], a * 255);
    }
  }
  return out;
}
const composeAll = (s) => s.frames.map((_, i) => compose(s, i));

// ───────── frames and layers
function addFrame(s, { at = s.frames.length, copyFrom = null, duration } = {}) {
  const f = { id: uid('f'), duration: duration || (s.frames[0] && s.frames[0].duration) || Math.round(1000 / (s.fps || 12)) };
  s.frames.splice(at, 0, f);
  if (copyFrom != null && s.frames[copyFrom >= at ? copyFrom + 1 : copyFrom]) { const src = s.frames[copyFrom >= at ? copyFrom + 1 : copyFrom]; for (const l of s.layers) { const c = getCel(s, l.id, src.id); if (c) setCel(s, l.id, f.id, c.slice()); } }
  shiftTags(s, at, 1); return f;
}
function removeFrame(s, index) { if (s.frames.length <= 1) throw new Error('A sprite needs at least one frame'); const [f] = s.frames.splice(index, 1); for (const l of s.layers) delete s.cels[celKey(l.id, f.id)]; shiftTags(s, index, -1); }
function moveFrame(s, from, to) { const [f] = s.frames.splice(from, 1); s.frames.splice(Math.max(0, Math.min(s.frames.length, to)), 0, f); }
function shiftTags(s, at, d) { for (const t of s.tags || []) { if (t.from >= at) t.from = Math.max(0, t.from + d); if (t.to >= at) t.to = Math.max(t.from, t.to + d); } }
function addLayer(s, { name, at = s.layers.length } = {}) { const l = { id: uid('l'), name: name || `Layer ${s.layers.length + 1}`, visible: true, opacity: 1 }; s.layers.splice(at, 0, l); return l; }
function removeLayer(s, id) { if (s.layers.length <= 1) throw new Error('A sprite needs at least one layer'); s.layers = s.layers.filter((l) => l.id !== id); for (const k of Object.keys(s.cels)) if (k.startsWith(id + '/')) delete s.cels[k]; }
function resize(s, w, h, { anchor = 'center' } = {}) {
  w = Math.max(1, Math.min(512, w | 0)); h = Math.max(1, Math.min(512, h | 0));
  const dx = anchor === 'center' ? Math.floor((w - s.w) / 2) : 0, dy = anchor === 'center' ? Math.floor((h - s.h) / 2) : anchor === 'bottom' ? h - s.h : 0;
  for (const [k, v] of Object.entries(s.cels)) { const c = v instanceof Uint8ClampedArray ? v : unpackCel(v, s.w, s.h); const n = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const a = (y * s.w + x) * 4, b = (Y * w + X) * 4; n[b] = c[a]; n[b + 1] = c[a + 1]; n[b + 2] = c[a + 2]; n[b + 3] = c[a + 3]; } s.cels[k] = n; }
  s.w = w; s.h = h;
}

// ───────── drawing ops (what Claude sends through the plugin, and what the window's tools turn into)
// A cel is wrapped in a Canvas so every op uses the same pixel-perfect drawing kit as effects.
function canvasFor(s, layerId, frameId) { const c = new FX.Canvas(s.w, s.h, s.palette); const d = getCel(s, layerId, frameId); if (d) c.data.set(d); return c; }
function colorArg(s, v) { if (v === undefined || v === null || v === 'clear' || v === 'transparent') return null; if (typeof v === 'number') return v; if (/^\d+$/.test(String(v))) return Number(v); return v; }
function pixelsOp(g, s, op) {
  const rows = Array.isArray(op.rows) ? op.rows : String(op.rows || '').split('\n');
  const key = op.key || {}; const x0 = op.x | 0, y0 = op.y | 0;
  rows.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === '.' || ch === ' ') return;
    let c; if (Object.prototype.hasOwnProperty.call(key, ch)) c = colorArg(s, key[ch]); else if (ch === '_') c = null; else { const n = parseInt(ch, 36); if (isNaN(n)) throw new Error(`Row ${j + 1} has “${ch}”, which isn’t in the key. Use '.' to skip, '_' to erase, 0–9/a–z for palette slots, or add it to key.`); if (n >= s.palette.length) throw new Error(`“${ch}” is palette slot ${n}, but the palette has ${s.palette.length} colours (0–${(s.palette.length - 1).toString(36)}).`); c = n; }
    g.px(x0 + i, y0 + j, c);
  }));
}
const OPS = {
  pixels: (g, s, o) => pixelsOp(g, s, o),
  px: (g, s, o) => g.px(o.x, o.y, colorArg(s, o.color)),
  line: (g, s, o) => g.line(o.x1 ?? o.x, o.y1 ?? o.y, o.x2, o.y2, colorArg(s, o.color)),
  rect: (g, s, o) => (o.fill ? g.fillRect(o.x, o.y, o.w, o.h, colorArg(s, o.color)) : g.rect(o.x, o.y, o.w, o.h, colorArg(s, o.color))),
  circle: (g, s, o) => (o.fill ? g.fillCircle(o.x, o.y, o.r, colorArg(s, o.color)) : g.ring(o.x, o.y, o.r, o.thickness || 1, colorArg(s, o.color))),
  ellipse: (g, s, o) => (o.fill ? g.fillEllipse(o.x, o.y, o.rx, o.ry, colorArg(s, o.color)) : g.ellipse(o.x, o.y, o.rx, o.ry, colorArg(s, o.color))),
  poly: (g, s, o) => (o.fill === false ? g.polyline(o.points, colorArg(s, o.color), true) : g.poly(o.points, colorArg(s, o.color))),
  flood: (g, s, o) => g.flood(o.x, o.y, colorArg(s, o.color)),
  dither: (g, s, o) => g.dither(o.x, o.y, o.w, o.h, colorArg(s, o.color), o.level ?? 0.5),
  outline: (g, s, o) => g.outline(colorArg(s, o.color), { corners: !!o.corners }),
  replace: (g, s, o) => g.replace(colorArg(s, o.from), colorArg(s, o.to)),
  shift: (g, s, o) => g.shift(o.dx | 0, o.dy | 0, !!o.wrap),
  flip: (g, s, o) => g.flip(o.horizontal !== false && o.axis !== 'y', o.axis === 'y' || !!o.vertical),
  clear: (g, s, o) => (o.w ? g.fillRect(o.x | 0, o.y | 0, o.w, o.h, null) : g.clear()),
  text: (g, s, o) => g.text(o.text, o.x, o.y, colorArg(s, o.color), o.scale || 1),
};
// apply(s, ops, { frame, layer }) — ops may target other frames/layers with their own "frame"/"layer" fields
function apply(s, ops, { frame = 0, layer = null } = {}) {
  const touched = new Set();
  const cache = new Map();
  const resolveFrame = (v) => { const i = v === undefined ? frame : v; const idx = typeof i === 'number' ? i : s.frames.findIndex((f) => f.id === i); if (!s.frames[idx]) throw new Error(`No frame ${i} (sprite has ${s.frames.length}, counted from 0)`); return s.frames[idx]; };
  const resolveLayer = (v) => { const id = v === undefined || v === null ? layer || s.layers[s.layers.length - 1].id : v; const l = s.layers.find((x) => x.id === id || x.name === id) || (typeof id === 'number' ? s.layers[id] : null); if (!l) throw new Error(`No layer “${id}”`); return l; };
  ops.forEach((o, n) => {
    const fn = OPS[o.op]; if (!fn) throw new Error(`Op ${n + 1}: unknown op “${o.op}”. Ops: ${Object.keys(OPS).join(', ')}`);
    const f = resolveFrame(o.frame), l = resolveLayer(o.layer); const k = celKey(l.id, f.id);
    if (!cache.has(k)) cache.set(k, canvasFor(s, l.id, f.id));
    const g = cache.get(k); if (o.mirror) g.symmetry(o.mirror === 'x' || o.mirror === 'both', o.mirror === 'y' || o.mirror === 'both'); else g.symmetry(false, false);
    try { fn(g, s, o); } catch (e) { throw new Error(`Op ${n + 1} (${o.op}): ${e.message}`); }
    touched.add(k);
  });
  for (const k of touched) { const [lid, fid] = k.split('/'); setCel(s, lid, fid, cache.get(k).data); }
  return [...touched];
}

// an effect's rendered frames become an editable sprite
function fromFrames({ name, w, h, frames, durations = [], palette }) {
  const s = create({ name, w, h, palette: palette || 'pico8', frames: frames.length, fps: 12 });
  frames.forEach((d, i) => { s.frames[i].duration = Math.round(durations[i] || 83); setCel(s, s.layers[0].id, s.frames[i].id, new Uint8ClampedArray(d)); });
  return s;
}

module.exports = { create, getCel, setCel, compose, composeAll, addFrame, removeFrame, moveFrame, addLayer, removeLayer, resize, apply, serialize, hydrate, fromFrames, packCel, unpackCel, OPS: Object.keys(OPS), uid };
