// Dither — turning a video clip of a character into a pixel-art animation:
//   key out the green screen → lock the character in place → find the loop → pick frames →
//   downsample to the sprite size (one colour per cell) → one palette shared by every frame → clean flicker and strays.
// Frames are { w, h, data: RGBA }. Everything here is plain JS (tested without Electron).
'use strict';
const FX = require('./fxruntime');
const { reduce, cleanOrphans } = require('./pixelsnap');

// ───────── keying
const ycc = (r, g, b) => [0.299 * r + 0.587 * g + 0.114 * b, -0.1687 * r - 0.3313 * g + 0.5 * b + 128, 0.5 * r - 0.4187 * g - 0.0813 * b + 128];
// the screen colour: the median of the frame border (video models keep a flat background)
function keyColor(f) {
  const { w, h, data } = f; const rs = [], gs = [], bs = [];
  const take = (x, y) => { const i = (y * w + x) * 4; if (data[i + 3] < 128) return; rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); };
  for (let x = 0; x < w; x += 2) { take(x, 0); take(x, h - 1); take(x, 1); take(x, h - 2); }
  for (let y = 0; y < h; y += 2) { take(0, y); take(w - 1, y); take(1, y); take(w - 2, y); }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1] ?? 0; };
  return rs.length ? [med(rs), med(gs), med(bs)] : [0, 255, 0];
}
// key(frame, { color, tolerance 0–100, softness, despill, islands }) → new frame with hard alpha (pixel art has no partial alpha)
function key(f, o = {}) {
  const { w, h, data } = f; const out = new Uint8ClampedArray(data); const kc = o.color || keyColor(f); const [, kb, kr] = ycc(...kc);
  const tol = (o.tolerance ?? 45) / 100; const t1 = 10 + tol * 50, t2 = t1 + 14 + (o.softness ?? 10);
  let fr = null; const dom = kc[1] >= kc[0] && kc[1] >= kc[2] ? 1 : kc[2] >= kc[0] ? 2 : 0;           // which channel the screen is
  for (let i = 0; i < out.length; i += 4) {
    if (!out[i + 3]) continue; const [, cb, cr] = ycc(out[i], out[i + 1], out[i + 2]);
    const d = Math.hypot(cb - kb, cr - kr); const a = d <= t1 ? 0 : d >= t2 ? 1 : (d - t1) / (t2 - t1);
    out[i + 3] = a < 0.5 ? 0 : 255; if (out[i + 3] && d < t2 * 1.7) (fr || (fr = new Uint8Array(w * h)))[i >> 2] = 1;
  }
  // the blended rim (video compression mixes the screen into the outline): drop tinted pixels that touch the screen
  if (fr && o.rim !== false) { const kill = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x; if (!fr[p]) continue; if ((x > 0 && !out[(p - 1) * 4 + 3]) || (x + 1 < w && !out[(p + 1) * 4 + 3]) || (y > 0 && !out[(p - w) * 4 + 3]) || (y + 1 < h && !out[(p + w) * 4 + 3])) kill.push(p); } for (const p of kill) out[p * 4 + 3] = 0; }
  // despill: screen colour reflected onto the character's edges (only near the edge, so green clothes stay green)
  if (o.despill !== false) {
    // pixels within 2 of the background: dilate the background mask (separable, so it stays fast on big frames)
    let m = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) m[i] = out[i * 4 + 3] ? 0 : 1;
    for (let pass = 0; pass < 2; pass++) { const t = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; t[i] = m[i] || (x > 0 && m[i - 1]) || (x + 1 < w && m[i + 1]) ? 1 : 0; } const u = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; u[i] = t[i] || (y > 0 && t[i - w]) || (y + 1 < h && t[i + w]) ? 1 : 0; } m = u; }
    const others = [0, 1, 2].filter((c) => c !== dom);
    for (let p = 0; p < w * h; p++) { const i = p * 4; if (!out[i + 3] || !m[p]) continue; const lim = Math.max(out[i + others[0]], out[i + others[1]]); if (out[i + dom] > lim + 6) out[i + dom] = lim + 6; }
  }
  if (o.islands !== false) dropIslands(out, w, h, Math.max(8, Math.round(w * h * 0.0006)));
  return { w, h, data: out, key: kc };
}
// remove specks the keyer missed: opaque blobs smaller than min pixels
function dropIslands(d, w, h, min) {
  const seen = new Uint8Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !d[s * 4 + 3]) continue; const comp = [], st = [s]; seen[s] = 1;
    while (st.length) { const p = st.pop(); comp.push(p); const x = p % w, y = (p / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const q = Y * w + X; if (!seen[q] && d[q * 4 + 3]) { seen[q] = 1; st.push(q); } } }
    if (comp.length < min) for (const p of comp) d[p * 4 + 3] = 0;
  }
}

// ───────── where the character is
function stats(f) {
  const { w, h, data } = f; let x0 = w, y0 = h, x1 = -1, y1 = -1, sx = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; sx += x; n++; }
  if (!n) return null;
  // the feet: centre of mass of the lowest 12% of the body
  const band = Math.max(1, Math.round((y1 - y0 + 1) * 0.12)); let fx = 0, fn = 0;
  for (let y = y1 - band + 1; y <= y1; y++) for (let x = x0; x <= x1; x++) if (data[(y * w + x) * 4 + 3]) { fx += x; fn++; }
  return { x0, y0, x1, y1, cx: sx / n, feetX: fn ? fx / fn : sx / n, bottom: y1, area: n };
}
function shift(f, dx, dy) {
  const { w, h, data } = f; const out = new Uint8ClampedArray(data.length); dx = Math.round(dx); dy = Math.round(dy);
  for (let y = 0; y < h; y++) { const Y = y + dy; if (Y < 0 || Y >= h) continue; for (let x = 0; x < w; x++) { const X = x + dx; if (X < 0 || X >= w) continue; const a = (y * w + x) * 4, b = (Y * w + X) * 4; out[b] = data[a]; out[b + 1] = data[a + 1]; out[b + 2] = data[a + 2]; out[b + 3] = data[a + 3]; } }
  return { w, h, data: out };
}
// align: 'feet' locks the feet in place (idles, walks and attacks in place), 'x' keeps vertical motion (jumps), 'none'
function align(frames, mode = 'feet') {
  if (mode === 'none') return frames; const st = frames.map(stats); const ref = st.find(Boolean); if (!ref) return frames;
  // smooth the anchor a little so the keyer's edge noise doesn't make it shiver
  const xs = st.map((s) => (s ? (mode === 'feet' ? s.feetX : s.cx) : null)); const ys = st.map((s) => (s ? s.bottom : null));
  return frames.map((f, i) => { if (!st[i]) return f; const dx = (mode === 'feet' ? ref.feetX : ref.cx) - xs[i]; const dy = mode === 'feet' ? ref.bottom - ys[i] : 0; return shift(f, dx, dy); });
}

// ───────── loop: the frame (after a minimum length) that looks most like the first one
function thumb(f, s = 48) { const out = new Float32Array(s * s * 4); for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const i = (Math.floor(y * f.h / s) * f.w + Math.floor(x * f.w / s)) * 4; out.set([f.data[i] / 255, f.data[i + 1] / 255, f.data[i + 2] / 255, f.data[i + 3] / 255], (y * s + x) * 4); } return out; }
function diff(a, b) { let d = 0; for (let i = 0; i < a.length; i += 4) { const aa = a[i + 3], bb = b[i + 3]; d += Math.abs(aa - bb) * 2 + (aa && bb ? Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) : 0); } return d / (a.length / 4); }
// thumbnails anchored at each frame's bottom-centre, so drift across the screen doesn't hide the loop
function anchored(frames, s = 48) {
  const bb = frames.map((f) => { let x0 = f.w, y0 = f.h, x1 = -1, y1 = -1; for (let y = 0; y < f.h; y += 2) for (let x = 0; x < f.w; x += 2) if (f.data[(y * f.w + x) * 4 + 3] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : { cx: (x0 + x1) / 2, by: y1, w: x1 - x0 + 1, h: y1 - y0 + 1 }; });
  if (bb.some((b) => !b)) return frames.map((f) => thumb(f, s));
  const W = Math.max(...bb.map((b) => b.w)) + 8, H = Math.max(...bb.map((b) => b.h)) + 8, side = Math.max(W, H);
  return frames.map((f, k) => { const b = bb[k]; const ox = Math.round(b.cx - side / 2), oy = Math.round(b.by + 4 - side); const out = new Float32Array(s * s * 4);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const sx = ox + Math.floor(x * side / s), sy = oy + Math.floor(y * side / s); if (sx < 0 || sy < 0 || sx >= f.w || sy >= f.h) continue; const i = (sy * f.w + sx) * 4; out.set([f.data[i] / 255, f.data[i + 1] / 255, f.data[i + 2] / 255, f.data[i + 3] / 255], (y * s + x) * 4); }
    return out; });
}
function findLoop(frames, { minFrac = 0.35 } = {}) {
  const n = frames.length; if (n < 6) return { end: n, score: null }; const t = anchored(frames); const lo = Math.max(3, Math.floor(n * minFrac));
  // compare a few frames after the candidate too, so a pose passed in the other direction (half a cycle) doesn't count
  const score = (k) => { let s = 0, w = 0; for (let j = 0; j < 4; j++) { const a = j, b = (k + j) % n; if (k + j >= n && j > 0) break; s += diff(t[a], t[b]) * (j ? 0.6 : 1); w += j ? 0.6 : 1; } return s / w; };
  const sc = []; const hi = n - 3 > lo ? n - 3 : n; for (let k = lo; k < hi; k++) sc.push([k, score(k)]); const min = Math.min(...sc.map((x) => x[1]));
  // among near-best candidates prefer the longest loop (whole cycles, not half ones)
  let best = sc.find((x) => x[1] === min); const med = sc.map((x) => x[1]).sort((a, b) => a - b)[sc.length >> 1]; const tol = min + (med - min) * 0.12; sc.forEach((x, i) => { const l = sc[i - 1], r = sc[i + 1]; if (x[1] <= tol && (!l || x[1] <= l[1]) && (!r || x[1] <= r[1]) && x[0] > best[0]) best = x; });
  return { end: best[0], score: Math.round(best[1] * 1000) / 1000 };                     // frames [0, end) loop back to 0
}

// ───────── downsample to the sprite size: crop to the union of all frames, one colour per cell (majority)
function downsample(frames, { height, width, pad = 1 }) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1; for (const f of frames) { const s = stats(f); if (!s) continue; x0 = Math.min(x0, s.x0); y0 = Math.min(y0, s.y0); x1 = Math.max(x1, s.x1); y1 = Math.max(y1, s.y1); }
  if (x1 < 0) throw new Error('Nothing left after keying — the background colour took the whole picture. Lower the key tolerance.');
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1; const scale = width ? cw / Math.max(1, width - pad * 2) : ch / Math.max(1, height - pad * 2);
  const W = width || Math.max(1, Math.ceil(cw / scale) + pad * 2), H = height || Math.max(1, Math.ceil(ch / scale) + pad * 2);
  const ox = x0 - ((W - pad * 2) * scale - cw) / 2 - pad * scale, oy = y0 - ((H - pad * 2) * scale - ch) - pad * scale; // feet on the bottom edge (minus pad)
  const out = frames.map((f) => {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
      const sx0 = ox + X * scale, sy0 = oy + Y * scale; const counts = new Map(); let n = 0, op = 0;
      const step = Math.max(1, scale / 4);
      for (let sy = sy0 + step / 2; sy < sy0 + scale; sy += step) for (let sx = sx0 + step / 2; sx < sx0 + scale; sx += step) {
        const ix = Math.floor(sx), iy = Math.floor(sy); n++; if (ix < 0 || iy < 0 || ix >= f.w || iy >= f.h) continue; const i = (iy * f.w + ix) * 4; if (!f.data[i + 3]) continue; op++;
        const k = ((f.data[i] >> 3) << 10) | ((f.data[i + 1] >> 3) << 5) | (f.data[i + 2] >> 3); const e = counts.get(k); if (e) { e.n++; e.r += f.data[i]; e.g += f.data[i + 1]; e.b += f.data[i + 2]; } else counts.set(k, { n: 1, r: f.data[i], g: f.data[i + 1], b: f.data[i + 2] });
      }
      if (!n || op / n < 0.5) continue; let best = null; for (const e of counts.values()) if (!best || e.n > best.n) best = e;
      const o = (Y * W + X) * 4; d[o] = best.r / best.n; d[o + 1] = best.g / best.n; d[o + 2] = best.b / best.n; d[o + 3] = 255;
    }
    return d;
  });
  return { w: W, h: H, frames: out, scale };
}

// one palette for every frame, so colours don't flicker between frames
function sharedPalette(frames, w, h, { colors, palette }) {
  const strip = new Uint8ClampedArray(frames.length * w * h * 4); frames.forEach((f, i) => strip.set(f, i * w * h * 4));
  const r = reduce({ w, h: h * frames.length, data: strip }, { colors: colors || 16, palette });
  return { frames: frames.map((_, i) => r.img.data.slice(i * w * h * 4, (i + 1) * w * h * 4)), palette: r.palette };
}
// a pixel that changes for exactly one frame while its neighbours in time agree is flicker
function deflicker(frames, w, h, loop) {
  const n = frames.length; if (n < 3) return frames; const src = frames.map((f) => f.slice()); let fixed = 0;
  for (let f = 0; f < n; f++) {
    const p = loop ? (f - 1 + n) % n : f - 1, q = loop ? (f + 1) % n : f + 1; if (p < 0 || q >= n) continue;
    for (let i = 0; i < w * h * 4; i += 4) {
      const A = src[p], B = src[f], C = src[q]; const same = (X, Y) => X[i + 3] === Y[i + 3] && (!X[i + 3] || (X[i] === Y[i] && X[i + 1] === Y[i + 1] && X[i + 2] === Y[i + 2]));
      if (same(A, C) && !same(A, B)) { frames[f][i] = A[i]; frames[f][i + 1] = A[i + 1]; frames[f][i + 2] = A[i + 2]; frames[f][i + 3] = A[i + 3]; fixed++; }
    }
  }
  return frames;
}

// convert(frames, fps, opts) → { w, h, frames: [RGBA], durations, palette, info }
// opts: { key: { tolerance, color } | false, align: 'feet'|'x'|'none', loop: true|false, count, height, width, colors, palette, outline }
function convert(raw, fps, o = {}) {
  if (!raw.length) throw new Error('The clip has no frames');
  let fr = o.key === false ? raw : raw.map((f) => key(f, o.key || {}));
  fr = align(fr, o.align || 'feet');
  let end = fr.length, loopInfo = null; if (o.loop) { loopInfo = findLoop(fr); end = loopInfo.end; }
  const use = fr.slice(o.start || 0, end); const count = Math.max(1, Math.min(use.length, o.count || 8));
  const pick = Array.from({ length: count }, (_, i) => Math.floor(i * use.length / count)); const sel = pick.map((i) => use[i]);
  const ds = downsample(sel, { height: o.height || (o.width ? 0 : 48), width: o.width || 0, pad: o.pad ?? 1 });
  let { frames: px, palette } = sharedPalette(ds.frames, ds.w, ds.h, { colors: o.colors, palette: o.palette });
  px = px.map((d) => cleanOrphans({ w: ds.w, h: ds.h, data: d }).img.data);
  px = deflicker(px, ds.w, ds.h, !!o.loop);
  if (o.outline) { const c = FX.hex(o.outline === true ? '#141020' : o.outline); px = px.map((d) => { const g = new FX.Canvas(ds.w, ds.h, ['#000']); g.data.set(d); g.outline(FX.toHex(c)); return g.data; }); }
  const ms = Math.round((use.length / count) * 1000 / (fps || 24));
  return { w: ds.w, h: ds.h, frames: px, durations: px.map(() => Math.max(40, ms)), palette, info: { source_frames: raw.length, used_frames: use.length, picked: pick.map((i) => i + (o.start || 0)), loop: loopInfo, scale: Math.round(ds.scale * 100) / 100, key: o.key === false ? null : FX.toHex(fr[0].key || keyColor(raw[0])) } };
}

// put a character on a flat screen colour for a video model (transparent → green, scaled up nearest-neighbour)
function onScreen(img, { size = 640, color = [0, 255, 0], fill = 0.72 } = {}) {
  const s = Math.max(1, Math.floor(size * fill / Math.max(img.w, img.h))); const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < out.length; i += 4) { out[i] = color[0]; out[i + 1] = color[1]; out[i + 2] = color[2]; out[i + 3] = 255; }
  const ox = Math.floor((size - img.w * s) / 2), oy = Math.floor((size - img.h * s) / 2 + size * 0.06);
  for (let y = 0; y < img.h * s; y++) for (let x = 0; x < img.w * s; x++) { const i = (Math.floor(y / s) * img.w + Math.floor(x / s)) * 4; const a = img.data[i + 3] / 255; if (!a) continue; const o = ((oy + y) * size + ox + x) * 4; if (oy + y < 0 || oy + y >= size || ox + x < 0 || ox + x >= size) continue; for (let c = 0; c < 3; c++) out[o + c] = img.data[i + c] * a + color[c] * (1 - a); }
  return { w: size, h: size, data: out };
}

module.exports = { convert, key, keyColor, align, findLoop, downsample, sharedPalette, deflicker, onScreen, stats };
