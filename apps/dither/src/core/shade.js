// Dither — the shading pass. You (or Claude) lay down flat colours, say what each one is made of and roughly what
// shape it is; this lights it from one direction with hue-shifted ramps: form shadows, highlights, rim light, contact
// shadows and a selective outline — the parts that make pixel art look like it has volume.
'use strict';
const FX = require('./fxruntime');

// ───────── colour space helpers
function rgb2hsv([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; return [h, mx ? d / mx : 0, mx]; }
function hsv2rgb([h, s, v]) { h = ((h % 360) + 360) % 360; const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c; const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function hueToward(h, target, amt) { let d = ((target - h + 540) % 360) - 180; return h + Math.sign(d) * Math.min(Math.abs(d), amt); }

// ───────── materials: how many steps, how far the hue travels, contrast, shine, rim, default form
const MATERIALS = {
  skin: { steps: 4, hueShift: 12, contrast: 0.9, spec: 0.12, shine: 6, rim: 0.12, ambient: 0.32, form: 'soft' },
  cloth: { steps: 3, hueShift: 16, contrast: 0.85, spec: 0, shine: 1, rim: 0.08, ambient: 0.3, form: 'soft' },
  leather: { steps: 4, hueShift: 10, contrast: 1, spec: 0.3, shine: 10, rim: 0.1, ambient: 0.26, form: 'soft' },
  metal: { steps: 5, hueShift: 6, contrast: 1.45, spec: 1, shine: 34, rim: 0.3, ambient: 0.16, form: 'soft' },
  gold: { steps: 5, hueShift: 14, contrast: 1.35, spec: 0.9, shine: 26, rim: 0.25, ambient: 0.2, form: 'soft' },
  wood: { steps: 4, hueShift: 10, contrast: 1, spec: 0.05, shine: 4, rim: 0.06, ambient: 0.28, form: 'soft' },
  stone: { steps: 4, hueShift: 8, contrast: 1, spec: 0.05, shine: 4, rim: 0.05, ambient: 0.25, form: 'facet', dither: 0.25 },
  foliage: { steps: 4, hueShift: 22, contrast: 1, spec: 0.05, shine: 3, rim: 0.3, ambient: 0.3, form: 'soft' },
  hair: { steps: 4, hueShift: 14, contrast: 1.1, spec: 0.5, shine: 8, rim: 0.2, ambient: 0.26, form: 'soft' },
  gel: { steps: 4, hueShift: 18, contrast: 1.1, spec: 1, shine: 22, rim: 0.55, ambient: 0.35, form: 'soft' },
  plastic: { steps: 4, hueShift: 8, contrast: 1.05, spec: 0.75, shine: 30, rim: 0.15, ambient: 0.28, form: 'soft' },
  crystal: { steps: 5, hueShift: 20, contrast: 1.3, spec: 1, shine: 40, rim: 0.6, ambient: 0.3, form: 'facet' },
  fur: { steps: 3, hueShift: 14, contrast: 0.9, spec: 0, shine: 1, rim: 0.3, ambient: 0.32, form: 'soft', dither: 0.4 },
  flat: { steps: 1, hueShift: 0, contrast: 0, spec: 0, shine: 1, rim: 0, ambient: 1, form: 'flat' },
};
MATERIALS.steel = MATERIALS.metal; MATERIALS.iron = MATERIALS.metal; MATERIALS.silver = MATERIALS.metal; MATERIALS.slime = MATERIALS.gel; MATERIALS.glass = MATERIALS.crystal; MATERIALS.gem = MATERIALS.crystal; MATERIALS.rock = MATERIALS.stone; MATERIALS.fabric = MATERIALS.cloth; MATERIALS.leaf = MATERIALS.foliage; MATERIALS.grass = MATERIALS.foliage; MATERIALS.flesh = MATERIALS.skin;

// A ramp from dark to light around a base colour: shadows slide toward blue/violet and get a little more saturated,
// highlights slide toward yellow and lose saturation — the classic hue-shifted pixel-art ramp.
function makeRamp(base, opts = {}) {
  const m = MATERIALS[opts.material] || {}; const steps = clamp(Math.round(opts.steps ?? m.steps ?? 5), 1, 9); const hs = opts.hueShift ?? m.hueShift ?? 12; const con = opts.contrast ?? m.contrast ?? 1;
  const [h, s, v] = rgb2hsv(typeof base === 'string' ? FX.hex(base) : base); const mid = (steps - 1) / 2; const out = [];
  for (let i = 0; i < steps; i++) {
    const k = steps === 1 ? 0 : (i - mid) / Math.max(1, mid);              // -1 darkest … +1 lightest
    const hh = k < 0 ? hueToward(h, 250, -k * hs * 1.4) : hueToward(h, 55, k * hs);
    const ss = clamp(s * (k < 0 ? 1 + 0.18 * -k : 1 - 0.32 * k), 0, 1);
    const vv = clamp(v + k * 0.26 * con * (k < 0 ? Math.max(0.6, v) : 1 - v * 0.35), 0.06, 0.99);
    out.push(FX.toHex(hsv2rgb([hh, ss, vv])));
  }
  return out;
}

const LIGHTS = { 'top-left': [-1, -1.2, 1.3], top: [0, -1.4, 1.1], 'top-right': [1, -1.2, 1.3], left: [-1.4, -0.2, 1], right: [1.4, -0.2, 1], front: [0, 0, 1], 'bottom-left': [-1, 1, 1], 'bottom-right': [1, 1, 1], back: [0, -0.4, -0.2] };
function lightVec(l) { const v = Array.isArray(l) ? l : LIGHTS[l || 'top-left'] || LIGHTS['top-left']; const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; }

// Euclidean-ish distance to the region edge (two-pass chamfer 3-4, /3)
function distance(mask, w, h) {
  const INF = 1e9, d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!d[i]) continue; d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4); }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (!d[i]) continue; d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4); }
  for (let i = 0; i < w * h; i++) d[i] /= 3; return d;
}
const FACETS = [[-0.6, -0.6, 0.53], [0.6, -0.6, 0.53], [-0.6, 0.6, 0.53], [0.6, 0.6, 0.53], [0, 0, 1], [-0.85, 0, 0.53], [0.85, 0, 0.53], [0, -0.85, 0.53], [0, 0.85, 0.53]].map((v) => { const n = Math.hypot(...v); return v.map((c) => c / n); });

// normals for one connected region
function normalsFor(pix, w, h, form, opts) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1; for (const i of pix) { const x = i % w, y = (i / w) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + 0.5, ry = (y1 - y0) / 2 + 0.5; const N = new Map();
  if (form === 'sphere' || form === 'cylinder' || form === 'cylinder-h' || form === 'flat' || /^flat-/.test(form)) {
    for (const i of pix) {
      const x = i % w, y = (i / w) | 0; let nx = 0, ny = 0;
      if (form === 'sphere') { nx = (x - cx) / rx; ny = (y - cy) / ry; } else if (form === 'cylinder') nx = (x - cx) / rx; else if (form === 'cylinder-h') ny = (y - cy) / ry;
      else if (form !== 'flat') { const f = { 'flat-up': [0, -0.7], 'flat-down': [0, 0.7], 'flat-left': [-0.7, 0], 'flat-right': [0.7, 0] }[form] || [0, 0]; nx = f[0]; ny = f[1]; }
      const l = nx * nx + ny * ny; if (l > 0.98) { const s = Math.sqrt(0.98 / l); nx *= s; ny *= s; } N.set(i, [nx, ny, Math.sqrt(Math.max(0.02, 1 - nx * nx - ny * ny))]);
    }
    return N;
  }
  // soft / bevel / facet: inflate the silhouette from its distance field
  const mask = new Uint8Array(w * h); for (const i of pix) mask[i] = 1; const d = distance(mask, w, h);
  let R = 0; for (const i of pix) R = Math.max(R, d[i]); R = Math.max(1, R);
  const bevel = opts.bevel || Math.max(1.5, R * 0.35);
  const hgt = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x]) return 0; const v = d[y * w + x]; return form === 'bevel' ? Math.min(v, bevel) / bevel : Math.sqrt(Math.min(1, v / R)); };
  const k = form === 'bevel' ? 1.6 : 1.1 * Math.max(1.5, R * 0.5);
  for (const i of pix) {
    const x = i % w, y = (i / w) | 0; let nx = -(hgt(x + 1, y) - hgt(x - 1, y)) * k, ny = -(hgt(x, y + 1) - hgt(x, y - 1)) * k;
    // tiny shapes still get a sense of roundness from where they sit in their box
    nx = nx * 0.75 + ((x - cx) / rx) * 0.35; ny = ny * 0.75 + ((y - cy) / ry) * 0.35;
    let n = [nx, ny, 1]; const L = Math.hypot(...n); n = n.map((c) => c / L);
    if (form === 'facet') { let best = FACETS[4], bd = -2; for (const f of FACETS) { const dd = f[0] * n[0] + f[1] * n[1] + f[2] * n[2]; if (dd > bd) { bd = dd; best = f; } } n = best; }
    N.set(i, n);
  }
  return N;
}

// shade(cel, w, h, { materials: { '#hex': { material, form, base, ramp, steps, hueShift } }, light, dither, outline, ao, rim, specular })
function shade(cel, w, h, opts = {}) {
  const src = cel; const out = src.slice(); const L = lightVec(opts.light); const H = (() => { const v = [L[0], L[1], L[2] + 1]; const n = Math.hypot(...v); return v.map((c) => c / n); })();
  const key = (i) => (src[i * 4 + 3] ? FX.toHex([src[i * 4], src[i * 4 + 1], src[i * 4 + 2]]) : null);
  const mats = {}; for (const [k, v] of Object.entries(opts.materials || {})) { const kk = String(k).toLowerCase(); mats[kk.length === 4 ? FX.toHex(FX.hex(kk)) : kk] = typeof v === 'string' ? { material: v } : v; }
  const region = new Int32Array(w * h).fill(-1); const regions = []; const ramps = {};
  // connected components per mapped colour
  for (let i = 0; i < w * h; i++) {
    if (region[i] >= 0) continue; const k = key(i); if (!k || !mats[k]) continue;
    const id = regions.length; const pix = []; const st = [i]; region[i] = id;
    while (st.length) { const p = st.pop(); pix.push(p); const x = p % w, y = (p / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const q = Y * w + X; if (region[q] < 0 && key(q) === k) { region[q] = id; st.push(q); } } }
    regions.push({ key: k, pix });
  }
  const shaded = new Map(); const level = new Float32Array(w * h).fill(-1); const rampIdx = new Int16Array(w * h).fill(-1);
  for (const [rid, r] of regions.entries()) {
    const spec = mats[r.key]; const m = { ...(MATERIALS[spec.material] || MATERIALS.cloth), ...spec }; const form = spec.form || m.form || 'soft';
    const ramp = Array.isArray(spec.ramp) ? spec.ramp.map((c) => FX.toHex(FX.hex(c))) : makeRamp(spec.base || r.key, { material: spec.material, steps: spec.steps ?? (m.steps === 1 ? 1 : (opts.steps ?? m.steps)), hueShift: spec.hueShift, contrast: spec.contrast }); ramps[r.key] = ramp;
    const N = normalsFor(r.pix, w, h, form, spec); const amb = opts.ambient ?? m.ambient; const dith = opts.dither ?? m.dither ?? 0; const rimC = opts.rim === false ? 0 : (m.rim || 0); const specS = opts.specular === false ? 0 : (m.spec || 0);
    for (const i of r.pix) {
      const n = N.get(i); const x = i % w, y = (i / w) | 0; const ndl = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
      let I = amb + (1 - amb) * Math.max(0, ndl);
      // contact shadow: a step darker where another shape sits between this pixel and the light
      if (opts.ao !== false) { const ox = Math.round(x + Math.sign(L[0]) * (Math.abs(L[0]) > 0.35 ? 1 : 0)), oy = Math.round(y + Math.sign(L[1]) * (Math.abs(L[1]) > 0.35 ? 1 : 0)); if (ox >= 0 && oy >= 0 && ox < w && oy < h) { const q = oy * w + ox; if (src[q * 4 + 3] && region[q] !== rid && (region[q] >= 0 || key(q) !== r.key)) I -= 0.9 / Math.max(2, ramp.length); } }
      // calibrate so a surface facing the viewer lands on the base colour; brighter/darker spread to either end
      const I0 = amb + (1 - amb) * Math.max(0, L[2]), mid = (ramp.length - 1) / 2; I = clamp(I, 0, 1);
      const v = I >= I0 ? mid + (I - I0) / Math.max(0.01, 1 - I0) * (ramp.length - 1 - mid) * 1.15 : mid * (I / Math.max(0.01, I0)); const vv2 = clamp(v, 0, ramp.length - 1), k0 = Math.floor(vv2), f = vv2 - k0; const up = f > 0.5 + (FX.bayer(x, y) - 0.5) * dith * 1.6;
      let idx = clamp(k0 + (up ? 1 : 0), 0, ramp.length - 1); let col = FX.hex(ramp[idx]);
      const sp = specS * Math.pow(Math.max(0, n[0] * H[0] + n[1] * H[1] + n[2] * H[2]), m.shine || 8);
      if (sp > 0.55 && ramp.length > 1) { col = FX.hex(ramp[ramp.length - 1]); idx = ramp.length - 1; if (sp > 0.85 && m.spec >= 0.7) col = hsv2rgb((([hh, ss, vv]) => [hh, ss * 0.35, Math.min(1, vv + 0.12)])(rgb2hsv(col))); }
      if (rimC && ndl < 0.15 && n[2] < 0.75 && ramp.length > 2) { const rim = rimC * Math.pow(1 - n[2], 1.5); if (rim > 0.18) { idx = Math.max(idx, ramp.length - 2); col = FX.hex(ramp[idx]); } }
      const o = i * 4; out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = 255; level[i] = clamp(ndl, -1, 1); rampIdx[i] = idx; shaded.set(i, r.key);
    }
  }
  // clean-up: a shaded pixel that matches none of its neighbours in the same shape takes their most common colour
  // (lone pixels read as noise); bright single-pixel glints on shiny materials are kept on purpose
  const glint = new Set();
  const tidy = (pixels, sameGroup, keep) => {
    const snap = out.slice();
    for (const i of pixels) {
      if (keep && keep.has(i)) continue; const x = i % w, y = (i / w) | 0; const me = (snap[i * 4] << 16) | (snap[i * 4 + 1] << 8) | snap[i * 4 + 2]; const tally = new Map(); let n = 0, match = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const q = Y * w + X; if (!sameGroup(i, q)) continue; n++; const c = (snap[q * 4] << 16) | (snap[q * 4 + 1] << 8) | snap[q * 4 + 2]; if (c === me) match = true; tally.set(c, (tally.get(c) || 0) + 1); }
      if (match || n < 3) continue; let best = null, bn = 0; for (const [c, k] of tally) if (k > bn) { bn = k; best = c; }
      out[i * 4] = best >> 16; out[i * 4 + 1] = (best >> 8) & 255; out[i * 4 + 2] = best & 255;
    }
  };
  for (const [i, k] of shaded) { const m = { ...(MATERIALS[mats[k].material] || {}), ...mats[k] }; if ((m.spec || 0) >= 0.7 && rampIdx[i] === ramps[k].length - 1) glint.add(i); }
  if (opts.clean !== false) tidy([...shaded.keys()], (i, q) => region[q] === region[i], glint);

  // selective outline: each outline pixel takes the darkest colour of the shape it borders, lighter on the lit side
  const mode = opts.outline === undefined ? 'selective' : opts.outline; const outlineAdded = [];
  if (mode && mode !== 'none' && mode !== 'keep') {
    const dark = mode === 'dark' || mode === 'black' ? (opts.outlineColor ? FX.hex(opts.outlineColor) : [20, 16, 28]) : null;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (out[i * 4 + 3]) continue; let best = null, bl = 2;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const q = Y * w + X; if (!shaded.has(q)) continue; if (level[q] < bl) { bl = level[q]; best = q; } }
      if (best === null) continue; let col;
      if (dark) col = dark; else { const ramp = ramps[shaded.get(best)]; const lit = bl > 0.45; const c = FX.hex(ramp[0]); const hsv = rgb2hsv(c); col = lit && ramp.length > 2 ? FX.hex(ramp[1]) : hsv2rgb([hueToward(hsv[0], 250, 8), Math.min(1, hsv[1] * 1.1), Math.max(0.05, hsv[2] * 0.7)]); }
      const o = i * 4; out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = 255; outlineAdded.push(i);
    }
  }
  if (opts.clean !== false && outlineAdded.length) { const o = new Set(outlineAdded); tidy(outlineAdded, (i, q) => o.has(q)); }
  const colors = new Set(); for (let i = 0; i < out.length; i += 4) if (out[i + 3]) colors.add(FX.toHex([out[i], out[i + 1], out[i + 2]]));
  return { data: out, ramps, regions: regions.length, outline: outlineAdded.length, colors: [...colors], unmapped: [...new Set(Array.from({ length: w * h }, (_, i) => key(i)).filter((k) => k && !mats[k]))] };
}

module.exports = { shade, makeRamp, MATERIALS, LIGHTS, rgb2hsv, hsv2rgb };
