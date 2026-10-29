// Dither — Pixel snap: turns an AI image that only *looks* like pixel art (soft edges, uneven cells, hundreds of
// near-identical colours) into real pixel art: finds the hidden grid, takes one colour per cell, reduces to a palette,
// and optionally clears the background. Also does plain "pixelize" for any picture.
'use strict';
const FX = require('./fxruntime');
const { medianCut } = require('./gif');

const lum = (d, i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;

function profiles(img) {
  const { w, h, data } = img; const col = new Float64Array(w), row = new Float64Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; const v = lum(data, i) * (data[i + 3] / 255);
    if (x + 1 < w) { const j = i + 4; col[x + 1] += Math.abs(lum(data, j) * (data[j + 3] / 255) - v); }
    if (y + 1 < h) { const j = i + w * 4; row[y + 1] += Math.abs(lum(data, j) * (data[j + 3] / 255) - v); }
  }
  return { col, row };
}

// period of the hidden grid: edges only happen on grid lines, so the right period is the largest one at which the
// edge positions all line up (phase coherence). Smaller divisors line up too; larger multiples cancel out.
function period(p, minP = 2, maxP = 64) {
  const n = p.length; const mean = p.reduce((a, b) => a + b, 0) / n; const sd = Math.sqrt(p.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
  const peaks = []; for (let x = 1; x < n - 1; x++) if (p[x] > mean + 0.5 * sd && p[x] >= p[x - 1] && p[x] >= p[x + 1]) peaks.push([x, p[x]]);
  if (peaks.length < 3) return null;
  const tw = peaks.reduce((a, q) => a + q[1], 0); const scores = [];
  for (let P = minP; P <= Math.min(maxP, n / 2); P += 0.02) { let re = 0, im = 0; for (const [x, w] of peaks) { const a = 2 * Math.PI * x / P; re += w * Math.cos(a); im += w * Math.sin(a); } scores.push([P, Math.hypot(re, im) / tw]); }
  const best = Math.max(...scores.map((q) => q[1])); if (best < 0.5) return null;
  let pick = null; for (const [P, c] of scores) if (c >= best * 0.9) pick = P;     // the largest coherent period
  // polish around the pick
  let top = 0, at = pick; for (const [P, c] of scores) if (Math.abs(P - pick) < 0.3 && c > top) { top = c; at = P; }
  return at;
}

// grid lines: start at the best phase, then walk, snapping each line to the strongest edge near where it should be
function lines(p, P, n) {
  let bestOff = 0, bestS = -1;
  for (let o = 0; o < Math.ceil(P); o++) { let s = 0; for (let x = o; x < n; x += P) s += p[Math.round(x)] || 0; if (s > bestS) { bestS = s; bestOff = o; } }
  const out = [0]; let x = bestOff; if (x > P * 0.5) out.push(Math.round(x)); else x = bestOff;
  const win = Math.max(1, Math.floor(P / 4));
  const mean = p.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(p.reduce((a, b) => a + (b - mean) ** 2, 0) / n), thr = mean + 0.75 * sd;
  while (x + P < n - 1) {
    const guess = x + P; let at = Math.round(guess), top = -1;
    for (let k = Math.round(guess) - win; k <= Math.round(guess) + win; k++) if (k > 0 && k < n && p[k] > top) { top = p[k]; at = k; }
    x = top > thr ? at : guess; if (Math.round(x) > out[out.length - 1]) out.push(Math.round(x));
  }
  if (n - out[out.length - 1] < P * 0.5 && out.length > 1) out.pop();
  out.push(n);
  return out;
}

function cellColor(img, x0, x1, y0, y1) {
  const { w, data } = img; const iw = x1 - x0, ih = y1 - y0;
  const mx = Math.floor(iw * 0.2), my = Math.floor(ih * 0.2);
  const counts = new Map(); let alpha = 0, n = 0;
  for (let y = y0 + my; y < y1 - my; y++) for (let x = x0 + mx; x < x1 - mx; x++) {
    const i = (y * w + x) * 4; n++; alpha += data[i + 3];
    if (data[i + 3] < 128) continue;
    const k = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    const e = counts.get(k); if (e) { e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2]; } else counts.set(k, { n: 1, r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  if (!n || alpha / n < 128) return null;
  let best = null; for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  return best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n), 255] : null;
}

// perceptual-ish distance ("redmean")
function dist(a, b) { const r = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return (2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db; }
function nearest(c, pal) { let bi = 0, bd = Infinity; for (let i = 0; i < pal.length; i++) { const d = dist(c, pal[i]); if (d < bd) { bd = d; bi = i; } } return pal[bi]; }

function kmeans(colors, k, iters = 6) { // colors: [r,g,b,count]
  let cents = medianCut(colors.map((c) => c.slice()), k);
  for (let it = 0; it < iters; it++) {
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (const c of colors) { let bi = 0, bd = Infinity; cents.forEach((m, i) => { const d = dist(c, m); if (d < bd) { bd = d; bi = i; } }); const a = acc[bi]; a[0] += c[0] * c[3]; a[1] += c[1] * c[3]; a[2] += c[2] * c[3]; a[3] += c[3]; }
    cents = acc.map((a, i) => (a[3] ? [Math.round(a[0] / a[3]), Math.round(a[1] / a[3]), Math.round(a[2] / a[3])] : cents[i]));
  }
  // drop duplicates
  const seen = new Set(); return cents.filter((c) => { const k2 = c.join(','); if (seen.has(k2)) return false; seen.add(k2); return true; });
}

function reduce(img, { colors = 0, palette = null } = {}) {
  const { data } = img; const counts = new Map();
  for (let i = 0; i < data.length; i += 4) if (data[i + 3]) { const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]; counts.set(k, (counts.get(k) || 0) + 1); }
  let pal;
  if (palette) pal = FX.resolvePalette(palette).map(FX.hex);
  else {
    const list = [...counts.entries()].map(([k, n]) => [k >> 16, (k >> 8) & 255, k & 255, n]);
    const want = colors || autoColors(list);
    if (list.length <= want) return { img, palette: list.map((c) => FX.toHex(c)) };
    pal = kmeans(list, want);
  }
  const memo = new Map(); const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue; const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let c = memo.get(k); if (!c) { c = nearest([data[i], data[i + 1], data[i + 2]], pal); memo.set(k, c); }
    out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
  }
  const used = new Set(); for (let i = 0; i < out.length; i += 4) if (out[i + 3]) used.add(FX.toHex([out[i], out[i + 1], out[i + 2]]));
  return { img: { w: img.w, h: img.h, data: out }, palette: [...used] };
}
// how many colours an image "really" has: count clusters that cover at least 0.4% of pixels after a coarse merge
function autoColors(list) {
  const total = list.reduce((s, c) => s + c[3], 0); const coarse = new Map();
  for (const c of list) { const k = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4); coarse.set(k, (coarse.get(k) || 0) + c[3]); }
  const big = [...coarse.values()].filter((n) => n / total > 0.004).length;
  return Math.max(4, Math.min(32, big));
}

function removeBackground(img, tolerance = 0) {
  const { w, h, data } = img; const out = data.slice();
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => (y * w + x) * 4);
  const key = (i) => (out[i + 3] ? `${out[i]},${out[i + 1]},${out[i + 2]}` : 'clear');
  const tally = {}; corners.forEach((i) => { const k = key(i); tally[k] = (tally[k] || 0) + 1; });
  const [bgKey, hits] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  if (bgKey === 'clear' || hits < 2) return { img, removed: 0 };
  const bg = bgKey.split(',').map(Number);
  const like = (i) => out[i + 3] && dist([out[i], out[i + 1], out[i + 2]], bg) <= tolerance * tolerance * 9;
  const seen = new Uint8Array(w * h); const st = []; let removed = 0;
  for (let x = 0; x < w; x++) st.push(x, 0, x, h - 1); for (let y = 0; y < h; y++) st.push(0, y, w - 1, y);
  while (st.length) { const y = st.pop(), x = st.pop(); if (x < 0 || y < 0 || x >= w || y >= h) continue; const k = y * w + x; if (seen[k]) continue; seen[k] = 1; const i = k * 4; if (!like(i)) continue; out[i + 3] = 0; removed++; st.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1); }
  return { img: { w, h, data: out }, removed };
}

// lone pixels that differ from all four neighbours, which neighbours agree on, get the neighbours' colour
function cleanOrphans(img) {
  const { w, h, data } = img; const out = data.slice(); let fixed = 0;
  const at = (x, y) => { const i = (y * w + x) * 4; return data[i + 3] ? `${data[i]},${data[i + 1]},${data[i + 2]}` : 'clear'; };
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const me = at(x, y), n = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
    if (n.every((v) => v === n[0]) && n[0] !== me) { const i = (y * w + x) * 4; if (n[0] === 'clear') out[i + 3] = 0; else { const c = n[0].split(',').map(Number); out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255; } fixed++; }
  }
  return { img: { w, h, data: out }, fixed };
}

// snap(img, { width, colors, palette, background: true, clean: true }) → { img, grid: { cols, rows, cell }, palette }
function snap(img, opts = {}) {
  let xs, ys, cell;
  if (opts.width) {
    const cols = Math.max(1, Math.round(opts.width)); cell = img.w / cols; const rows = Math.max(1, Math.round(img.h / cell));
    xs = Array.from({ length: cols + 1 }, (_, i) => Math.round(i * img.w / cols)); ys = Array.from({ length: rows + 1 }, (_, i) => Math.round(i * img.h / rows));
  } else {
    const p = profiles(img); const px = period(p.col, 2, Math.max(4, Math.floor(img.w / 8))), py = period(p.row, 2, Math.max(4, Math.floor(img.h / 8)));
    cell = px && py ? (Math.abs(px - py) / Math.max(px, py) < 0.15 ? (px + py) / 2 : Math.min(px, py)) : px || py;
    if (!cell || cell < 1.5) { cell = Math.max(1, img.w / 64); }
    xs = lines(p.col, cell, img.w); ys = lines(p.row, cell, img.h);
  }
  const W = xs.length - 1, H = ys.length - 1; const out = new Uint8ClampedArray(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const c = cellColor(img, xs[i], Math.max(xs[i] + 1, xs[i + 1]), ys[j], Math.max(ys[j] + 1, ys[j + 1])); if (c) out.set(c, (j * W + i) * 4); }
  let res = { w: W, h: H, data: out };
  const red = reduce(res, { colors: opts.colors, palette: opts.palette }); res = red.img;
  if (opts.background !== false) res = removeBackground(res, opts.tolerance ?? 0).img;
  if (opts.clean !== false) res = cleanOrphans(res).img;
  const used = new Set(); for (let i = 0; i < res.data.length; i += 4) if (res.data[i + 3]) used.add(FX.toHex([res.data[i], res.data[i + 1], res.data[i + 2]]));
  return { img: res, grid: { cols: W, rows: H, cell: Math.round(cell * 100) / 100 }, palette: [...used] };
}

module.exports = { snap, reduce, removeBackground, cleanOrphans, period, profiles };
