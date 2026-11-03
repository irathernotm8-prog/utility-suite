// Dither — detail tools: procedural textures painted in the colour's own hue-shifted ramp, normal maps (for game
// engine 2D lights) and relighting, pixel-art anti-aliasing of stair-steps, and clean-up of doubled line corners.
// Everything works on RGBA cels and stays on a small set of colours.
'use strict';
const FX = require('./fxruntime');
const SH = require('./shade');

const key = (d, i) => (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
const hexOfKey = (k) => '#' + k.toString(16).padStart(6, '0');
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// ───────── textures: a pattern value per pixel → a step along the colour's own ramp (−2 … +2)
const TEXTURES = {
  stone: 'Cracked stone: irregular cells with dark seams, lit top-left edges',
  bricks: 'Bricks in offset rows with mortar lines and a lit top edge',
  scales: 'Overlapping scales (dragons, fish, armour)',
  bark: 'Vertical bark ridges with dark furrows',
  wood: 'Planks with grain lines and the odd knot',
  weave: 'Fabric weave (cloth, sacks, rope)',
  grass: 'Grass or foliage: small light tufts and dark gaps',
  metal: 'Brushed metal: horizontal streaks and a few scratches',
  sand: 'Sand, dirt or snow: sparse speckles',
  noise: 'Plain mottling (any rough surface)',
};
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function voronoi(x, y, sc, seed) { const gx = Math.floor(x / sc), gy = Math.floor(y / sc); let d1 = 1e9, d2 = 1e9, id = 0, cx = 0, cy = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const X = gx + i, Y = gy + j, px = (X + 0.15 + hash(X, Y, seed) * 0.7) * sc, py = (Y + 0.15 + hash(X, Y, seed + 7) * 0.7) * sc, d = Math.hypot(x - px, y - py); if (d < d1) { d2 = d1; d1 = d; id = hash(X, Y, seed + 3); cx = px; cy = py; } else if (d < d2) d2 = d; } return { edge: d2 - d1, id, cx, cy }; }
function pattern(kind, x, y, sc, seed, nz) {
  switch (kind) {
    case 'stone': { const v = voronoi(x, y, sc * 1.6, seed); if (v.edge < 1.1) return -2; const lit = (x - v.cx) + (y - v.cy) < -sc * 0.45 ? 1 : (x - v.cx) + (y - v.cy) > sc * 0.6 ? -1 : 0; return lit + (v.id > 0.75 ? 1 : v.id < 0.2 ? -1 : 0) * (nz(x / 3, y / 3) > 0.5 ? 1 : 0); }
    case 'bricks': { const bh = Math.max(3, Math.round(sc)), bw = bh * 2 + 1, row = Math.floor(y / bh), ox = row % 2 ? Math.floor(bw / 2) : 0, lx = (x + ox) % bw, ly = y % bh; if (ly === bh - 1 || lx === bw - 1) return -2; if (ly === 0) return 1; return hash(Math.floor((x + ox) / bw), row, seed) > 0.7 ? -1 : nz(x / 2, y / 2) > 0.8 ? 1 : 0; }
    case 'scales': { const r = Math.max(2, Math.round(sc)), row = Math.floor(y / r), ox = row % 2 ? r : 0, cx = Math.floor((x + ox) / (r * 2)) * r * 2 + r - ox, cy = row * r, d = Math.hypot(x - cx, (y - cy) * 1.2); if (d > r * 1.15) return -1; if (d > r * 0.95) return -2; return (y - cy) < r * 0.3 && (x - cx) < 0 ? 1 : 0; }
    case 'bark': { const n = nz(x / (sc * 0.6), y / (sc * 4)), r = Math.sin((x + n * sc * 2) / sc * 2.2); return r > 0.75 ? 1 : r < -0.6 ? -2 : r < -0.2 ? -1 : 0; }
    case 'wood': { const plank = Math.max(4, Math.round(sc * 2)); if (y % plank === 0) return -2; const n = nz(x / (sc * 6), y / sc); const g = Math.sin((y + n * 6) * 1.9); if (hash(Math.floor(x / (sc * 5)), Math.floor(y / plank), seed) > 0.93 && Math.hypot((x % (sc * 5)) - sc * 2.5, (y % plank) - plank / 2) < 1.5) return -2; return g > 0.8 ? -1 : g < -0.85 ? 1 : 0; }
    case 'weave': { const c = Math.max(2, Math.round(sc / 2)), a = Math.floor(x / c) + Math.floor(y / c); return (a % 2 ? (x % c === 0 ? -1 : 0) : (y % c === 0 ? -1 : 1)); }
    case 'grass': { const h = hash(x, Math.floor(y / 2), seed); if (h > 0.9) return 1; if (h < 0.06) return -2; return nz(x / sc, y / sc) > 0.62 ? -1 : 0; }
    case 'metal': { const n = nz(x / (sc * 5), y / 1.2); if (hash(Math.floor(x / 9), y, seed) > 0.985) return 1; return n > 0.68 ? 1 : n < 0.3 ? -1 : 0; }
    case 'sand': { const h = hash(x, y, seed); return h > 0.94 ? 1 : h < 0.05 ? -1 : 0; }
    default: { const n = nz(x / sc, y / sc) * 0.7 + nz(x / (sc / 3), y / (sc / 3), 5) * 0.3; return n > 0.66 ? 1 : n < 0.34 ? -1 : 0; }
  }
}
// texture(cel, w, h, { kind, colors (which flat colours get it; default every colour covering ≥ 12 px), scale, seed, strength 0..1, area:{x,y,w,h} })
function texture(cel, w, h, o = {}) {
  const kind = TEXTURES[o.kind] ? o.kind : 'noise', sc = Math.max(1, o.scale || 4), seed = (o.seed || 1) >>> 0, nz = FX.makeNoise(seed), str = o.strength ?? 1;
  const out = new Uint8ClampedArray(cel); const count = new Map(); for (let i = 0; i < cel.length; i += 4) if (cel[i + 3]) { const k = key(cel, i); count.set(k, (count.get(k) || 0) + 1); }
  const want = o.colors && o.colors.length ? new Set(o.colors.map((c) => { const r = FX.hex(c); return (r[0] << 16) | (r[1] << 8) | r[2]; })) : new Set([...count].filter(([, n]) => n >= 12).map(([k]) => k));
  const ramps = new Map(); const added = new Set();
  const a = o.area || { x: 0, y: 0, w, h };
  for (let y = Math.max(0, a.y); y < Math.min(h, a.y + a.h); y++) for (let x = Math.max(0, a.x); x < Math.min(w, a.x + a.w); x++) {
    const i = (y * w + x) * 4; if (!cel[i + 3]) continue; const k = key(cel, i); if (!want.has(k)) continue;
    if (!ramps.has(k)) ramps.set(k, SH.makeRamp(hexOfKey(k), { steps: 5, material: o.material }).map(FX.hex));
    let step = pattern(kind, x, y, sc, seed, nz); if (!step) continue; if (str < 1 && hash(x, y, seed + 11) > str) continue;
    const c = ramps.get(k)[2 + Math.max(-2, Math.min(2, step))]; out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; added.add(FX.toHex(c));
  }
  return { data: out, colors: [...added] };
}

// ───────── normal maps: height from distance-to-edge per region (rounded forms) plus value detail (bevels, cracks)
// returns RGB normals packed like every 2D engine expects (x → R, y-up → G, z → B; flat facing = #8080ff)
function normalMap(cel, w, h, o = {}) {
  const bulge = o.bulge ?? 1, detail = o.detail ?? 0.6, regionsBy = o.by || 'alpha';
  const H = new Float32Array(w * h); const solid = new Uint8Array(w * h); for (let p = 0; p < w * h; p++) solid[p] = cel[p * 4 + 3] ? 1 : 0;
  // distance to the silhouette (or to a different colour family when by = 'color'), chamfer passes
  const d = new Float32Array(w * h); const INF = 1e6; for (let p = 0; p < w * h; p++) d[p] = solid[p] ? INF : 0;
  const same = (a, b) => regionsBy !== 'color' || Math.abs(luma(cel[a * 4], cel[a * 4 + 1], cel[a * 4 + 2]) - luma(cel[b * 4], cel[b * 4 + 1], cel[b * 4 + 2])) < 60;
  for (let pass = 0; pass < 2; pass++) for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const x = pass ? w - 1 - xx : xx, y = pass ? h - 1 - yy : yy, p = y * w + x; if (!solid[p]) continue; for (const [dx, dy, c] of pass ? [[1, 0, 1], [0, 1, 1], [1, 1, 1.4], [-1, 1, 1.4]] : [[-1, 0, 1], [0, -1, 1], [-1, -1, 1.4], [1, -1, 1.4]]) { const X = x + dx, Y = y + dy; const q = Y * w + X; const v = X < 0 || Y < 0 || X >= w || Y >= h || !solid[q] || !same(p, q) ? c - 0.5 : d[q] + c; if (v < d[p]) d[p] = v; } }
  let mx = 1; for (let p = 0; p < w * h; p++) if (solid[p] && d[p] > mx) mx = d[p];
  const R = Math.min(mx, o.radius || Math.max(2, mx));
  for (let p = 0; p < w * h; p++) if (solid[p]) { const t = Math.min(1, d[p] / R); H[p] = Math.sqrt(1 - (1 - t) * (1 - t)) * R * 1.2 * bulge + (luma(cel[p * 4], cel[p * 4 + 1], cel[p * 4 + 2]) / 255) * detail * 2; }
  for (let pass = 0; pass < (o.soften ?? 2); pass++) { const t = H.slice(); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x; if (!solid[p]) continue; let s = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h || !solid[Y * w + X]) continue; s += t[Y * w + X]; n++; } H[p] = s / n; } }   // soften the chamfer facets
  const out = new Uint8ClampedArray(w * h * 4); const N = new Float32Array(w * h * 3);
  const at = (x, y, p) => (x < 0 || y < 0 || x >= w || y >= h || !solid[y * w + x] ? H[p] - 0.6 : H[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x; if (!solid[p]) continue; const nx = -(at(x + 1, y, p) - at(x - 1, y, p)) / 2, ny = -(at(x, y + 1, p) - at(x, y - 1, p)) / 2; const l = Math.hypot(nx, ny, 1); N[p * 3] = nx / l; N[p * 3 + 1] = ny / l; N[p * 3 + 2] = 1 / l; out[p * 4] = Math.round((nx / l * 0.5 + 0.5) * 255); out[p * 4 + 1] = Math.round((-ny / l * 0.5 + 0.5) * 255); out[p * 4 + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); out[p * 4 + 3] = 255; }
  return { data: out, normals: N };
}
// relight(cel, w, h, { light: 'top-left' | [x,y,z], ambient, strength, palette }) — lights the art with its normal map and snaps
// every lit colour to the sprite's own colours (or each colour's ramp), so the result is still clean pixel art
function relight(cel, w, h, o = {}) {
  const nm = o.normals ? { normals: o.normals } : normalMap(cel, w, h, o); const N = nm.normals; const L = lightVecOf(o.light); const amb = o.ambient ?? 0.45, st = o.strength ?? 0.9;
  const out = new Uint8ClampedArray(cel); const ramps = new Map(); const added = new Set();
  for (let p = 0; p < w * h; p++) {
    const i = p * 4; if (!cel[i + 3]) continue; const dot = Math.max(-1, N[p * 3] * L[0] + N[p * 3 + 1] * L[1] + N[p * 3 + 2] * L[2]);
    const lvl = Math.max(0, Math.min(1, amb + dot * st)); const k = key(cel, i);
    if (!ramps.has(k)) ramps.set(k, SH.makeRamp(hexOfKey(k), { steps: o.steps || 5 }).map(FX.hex));
    const r = ramps.get(k); const base = (r.length - 1) / 2, idx = Math.round(base + (dot - L[2]) * st * (r.length - 1) * 1.6 + (amb - 0.45)); void lvl; const c = r[Math.max(0, Math.min(r.length - 1, idx))];
    out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; added.add(FX.toHex(c));
  }
  return { data: out, colors: [...added] };
}
function lightVecOf(l) { const v = Array.isArray(l) ? l : SH.LIGHTS[l || 'top-left'] || SH.LIGHTS['top-left']; const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; }

// ───────── smooth: pixel-art anti-aliasing. In each inside corner of a stair-step between two colours (runs of 2+),
// one pixel takes an in-between colour. Against transparency it only works if you give the background colour.
function smooth(cel, w, h, o = {}) {
  const out = new Uint8ClampedArray(cel); const minRun = o.minRun || 2; const bg = o.background ? FX.hex(o.background) : null; const added = new Set(); let n = 0;
  const col = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return -1; const i = (y * w + x) * 4; return cel[i + 3] ? key(cel, i) : -1; };
  const mixes = new Map(); const mix = (a, b) => { const k = a + ':' + b; if (!mixes.has(k)) { const A = a < 0 ? bg : [a >> 16, (a >> 8) & 255, a & 255], B = b < 0 ? bg : [b >> 16, (b >> 8) & 255, b & 255]; let m = [Math.round((A[0] + B[0]) / 2), Math.round((A[1] + B[1]) / 2), Math.round((A[2] + B[2]) / 2)]; if (o.palette && o.palette.length) { let best = null, bd = 1e9; for (const h2 of o.palette) { const c = FX.hex(h2); const dd = (c[0] - m[0]) ** 2 + (c[1] - m[1]) ** 2 + (c[2] - m[2]) ** 2; if (dd < bd) { bd = dd; best = c; } } m = best.slice(0, 3); } mixes.set(k, m); } return mixes.get(k); };
  const run = (x, y, dx, dy, c) => { let k = 0; while (col(x + dx * (k + 1), y + dy * (k + 1)) === c && k < 8) k++; return k; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const me = col(x, y); if (me < 0 && !bg) continue;
    for (const [ax, ay, bx, by] of [[-1, 0, 0, -1], [1, 0, 0, -1], [-1, 0, 0, 1], [1, 0, 0, 1]]) {
      const A = col(x + ax, y + ay), B = col(x + bx, y + by); if (A < 0 && !bg || A !== B || A === me) continue;
      if (col(x + ax + bx, y + ay + by) !== A) continue;                             // a real inside corner
      if (col(x - ax, y - ay) === A || col(x - bx, y - by) === A) continue;           // not a notch or a 1px gap
      if (run(x + ax, y + ay, ax, ay, A) + 1 < minRun && run(x + bx, y + by, bx, by, A) + 1 < minRun) continue;
      const m = mix(A, me); const i = (y * w + x) * 4; out[i] = m[0]; out[i + 1] = m[1]; out[i + 2] = m[2]; out[i + 3] = 255; added.add(FX.toHex(m)); n++; break;
    }
  }
  return { data: out, colors: [...added], changed: n };
}

// ───────── cleanup: removes the doubled corner pixel in 1px diagonal lines (an "L" where a diagonal step would do)
// and lone single pixels of a colour surrounded by one other colour
function cleanup(cel, w, h, o = {}) {
  const out = new Uint8ClampedArray(cel); let fixed = 0;
  const col = (d, x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return -1; const i = (y * w + x) * 4; return d[i + 3] ? key(d, i) : -1; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = col(out, x, y); if (c < 0) continue; const N = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => col(out, x + dx, y + dy) === c);
    let eight = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && col(out, x + dx, y + dy) === c) eight++;
    const lone = o.strays !== false && eight === 0 && !N.some(Boolean);
    const corner = eight === 2 && N.filter(Boolean).length === 2 && !(N[0] && N[2]) && !(N[1] && N[3]);   // two perpendicular neighbours only
    if (!lone && !corner) continue;
    if (corner) { const a = N[0] ? [0, -1] : [0, 1], b = N[1] ? [1, 0] : [-1, 0]; if (col(out, x + a[0] + b[0], y + a[1] + b[1]) === c) continue; }
    // what's behind: the commonest other colour around it (or nothing)
    const around = new Map(); for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const k = col(out, x + dx, y + dy); if (k !== c) around.set(k, (around.get(k) || 0) + 1); }
    const [bk, bn] = [...around].sort((p, q) => q[1] - p[1])[0] || [-1, 0]; if (lone && bn < 3) continue;
    const i = (y * w + x) * 4; if (bk < 0) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; } else { out[i] = bk >> 16; out[i + 1] = (bk >> 8) & 255; out[i + 2] = bk & 255; out[i + 3] = 255; } fixed++;
  }
  return { data: out, fixed };
}

module.exports = { TEXTURES, texture, normalMap, relight, smooth, cleanup };
