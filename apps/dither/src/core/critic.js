// Dither — the critic. Looks at a sprite (or every frame of an animation) the way a pixel-art reviewer would and
// marks what's wrong on a zoomed copy: stray pixels, doubled corners in lines, jaggy curves, pillow shading,
// near-duplicate colours, weak contrast against the backgrounds it will sit on, and flicker between frames.
'use strict';
const FX = require('./fxruntime');
const sheets = require('./sheets');

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function lab(c) { const f = (v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; }; const [r, g, b] = c.map(f); let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883; const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116); x = t(x); y = t(y); z = t(z); return [116 * y - 16, 500 * (x - y), 200 * (y - z)]; }
const dE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

function frameIssues(d, w, h, opts) {
  const issues = []; const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? null : d[(y * w + x) * 4 + 3] ? (y * w + x) : null);
  const col = (i) => (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
  const same = (i, x, y) => { const j = at(x, y); return j !== null && col(j) === col(i); };
  const add = (type, x, y, msg, sev = 'minor', ww = 1, hh = 1) => issues.push({ type, x, y, w: ww, h: hh, severity: sev, message: msg });
  let opaque = 0;
  // 1. stray pixels: a lone colour no neighbour shares, sitting inside other colours
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = at(x, y); if (i === null) continue; opaque++;
    let sameN = 0, filled = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const j = at(x + dx, y + dy); if (j !== null) { filled++; if (col(j) === col(i)) sameN++; } }
    if (sameN === 0 && filled >= 6) add('stray', x, y, 'A lone pixel no neighbour shares — reads as noise. Merge it into a neighbour colour or make it part of a cluster.');
    if (filled === 0 && !opts.allowSparks) add('stray', x, y, 'An isolated pixel floating on its own.', 'minor');
  }
  // 2. doubled corners: the redundant pixel in an L of a 1-pixel line (pixel-perfect rule)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = at(x, y); if (i === null) continue;
    for (const [ax, ay, bx, by] of [[-1, 0, 0, -1], [1, 0, 0, -1], [-1, 0, 0, 1], [1, 0, 0, 1]]) {
      if (!same(i, x + ax, y + ay) || !same(i, x + bx, y + by) || same(i, x + ax + bx, y + ay + by)) continue;
      // only for thin lines: the pixel has exactly these two same-colour 4-neighbours and the shape around is not a filled block
      const n4 = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => same(i, x + dx, y + dy)).length;
      const thinA = !same(i, x + ax - bx, y + ay - by) && !same(i, x - ax + bx, y - ay + by);
      if (n4 === 2 && thinA && !same(i, x - ax, y - ay) && !same(i, x - bx, y - by)) add('double', x, y, 'Doubled corner in a 1-pixel line (an L shape). Remove this pixel so the line steps cleanly.');
    }
  }
  // 3. jaggies on the silhouette: uneven staircase steps along each edge of the shape
  const rowsL = [], rowsR = []; for (let y = 0; y < h; y++) { let l = -1, r = -1; for (let x = 0; x < w; x++) if (at(x, y) !== null) { if (l < 0) l = x; r = x; } rowsL.push(l); rowsR.push(r); }
  const colsT = [], colsB = []; for (let x = 0; x < w; x++) { let t = -1, b = -1; for (let y = 0; y < h; y++) if (at(x, y) !== null) { if (t < 0) t = y; b = y; } colsT.push(t); colsB.push(b); }
  const jag = (arr, flipXY, side) => {
    // a zigzag (in, out, in by one pixel) or an odd step length that breaks a run pattern
    for (let k = 1; k + 2 < arr.length; k++) {
      const a = arr[k - 1], b = arr[k], c = arr[k + 1], e = arr[k + 2]; if ([a, b, c, e].some((v) => v < 0)) continue;
      const d1 = b - a, d2 = c - b, d3 = e - c;
      if (d1 && d2 && Math.sign(d1) !== Math.sign(d2) && Math.abs(d1) <= 2 && Math.abs(d2) <= 2 && Math.sign(d3) !== Math.sign(d2)) { const [x, y] = flipXY ? [k, b] : [b, k]; add('jaggy', x, y, `Jagged ${side} edge: it steps in and back out. Smooth the curve so each step goes one way.`, 'major'); }
    }
  };
  jag(rowsL, false, 'left'); jag(rowsR, false, 'right'); jag(colsT, true, 'top'); jag(colsB, true, 'bottom');
  // 4. pillow shading: colour bands that follow the outline instead of the light (checked per solid shape)
  const comp = new Int32Array(w * h).fill(-1); const shapes = [];
  for (let i0 = 0; i0 < w * h; i0++) { if (comp[i0] >= 0 || !d[i0 * 4 + 3]) continue; const id = shapes.length, pix = [], st = [i0]; comp[i0] = id; while (st.length) { const p = st.pop(); pix.push(p); const x = p % w, y = (p / w) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const q = at(x + dx, y + dy); if (q !== null && comp[q] < 0) { comp[q] = id; st.push(q); } } } shapes.push(pix); }
  for (const pix of shapes) {
    if (pix.length < 60) continue; const pts = [];
    for (const i of pix) { const x = i % w, y = (i / w) | 0; let r = 0; while (r < 12 && [[r + 1, 0], [-r - 1, 0], [0, r + 1], [0, -r - 1]].every(([dx, dy]) => at(x + dx, y + dy) !== null)) r++; pts.push([x, y, r, lum([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]])]); }
    const n = pts.length; const mx = pts.reduce((a2, p) => a2 + p[0], 0) / n, my = pts.reduce((a2, p) => a2 + p[1], 0) / n, md = pts.reduce((a2, p) => a2 + p[2], 0) / n, ml = pts.reduce((a2, p) => a2 + p[3], 0) / n;
    let cd = 0, cl = 0, vd = 0, vl = 0, vp = 0;
    for (const [x, y, dd, L] of pts) { const pdir = -(x - mx) - (y - my); cd += (dd - md) * (L - ml); vd += (dd - md) ** 2; vl += (L - ml) ** 2; cl += pdir * (L - ml); vp += pdir * pdir; }
    const rDist = cd / Math.sqrt(vd * vl || 1), rLight = Math.abs(cl / Math.sqrt(vp * vl || 1));
    if (rDist > 0.5 && rLight < 0.25) { let bx = w, by = h, bx2 = 0, by2 = 0; for (const [x, y] of pts) { bx = Math.min(bx, x); by = Math.min(by, y); bx2 = Math.max(bx2, x); by2 = Math.max(by2, y); } add('pillow', bx, by, `Pillow shading: this shape gets lighter toward the middle on every side (it follows the outline, r=${rDist.toFixed(2)}) instead of being lit from one direction. Pick a light direction and darken the far side.`, 'major', bx2 - bx + 1, by2 - by + 1); }
  }
  return { issues, opaque };
}

function paletteIssues(frames) {
  const counts = new Map(); for (const d of frames) for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; counts.set(k, (counts.get(k) || 0) + 1); }
  const cols = [...counts.entries()].map(([k, n]) => ({ c: [k >> 16, (k >> 8) & 255, k & 255], n })); const out = [];
  for (let a = 0; a < cols.length; a++) for (let b = a + 1; b < cols.length; b++) { const e = dE(cols[a].c, cols[b].c); if (e < 4.5) out.push({ type: 'near-duplicate', severity: 'minor', message: `${FX.toHex(cols[a].c)} and ${FX.toHex(cols[b].c)} are almost the same colour (ΔE ${e.toFixed(1)}). Merge them, or push them apart so the step reads.`, colors: [FX.toHex(cols[a].c), FX.toHex(cols[b].c)] }); }
  const L = cols.map((x) => lab(x.c)[0]); const range = cols.length ? Math.max(...L) - Math.min(...L) : 0;
  if (cols.length > 2 && range < 30) out.push({ type: 'flat-values', severity: 'major', message: `Values are flat: lightness only spans ${Math.round(range)} of 100. Add a darker shadow and a brighter highlight so the form reads.` });
  if (cols.length > 48) out.push({ type: 'too-many-colours', severity: 'minor', message: `${cols.length} colours. Pixel art reads best with a limited palette — reduce, or check for blending/anti-aliasing.` });
  return { out, colors: cols.length, valueRange: Math.round(range) };
}

function contrastIssues(d, w, h) {
  // edge pixels against a dark and a light backdrop
  const edge = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (!d[i + 3]) continue; if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const X = x + dx, Y = y + dy; return X < 0 || Y < 0 || X >= w || Y >= h || !d[(Y * w + X) * 4 + 3]; })) edge.push(lab([d[i], d[i + 1], d[i + 2]])[0]); }
  if (!edge.length) return [];
  const out = []; const lowDark = edge.filter((l) => l < 22).length / edge.length, lowLight = edge.filter((l) => l > 80).length / edge.length;
  if (lowDark > 0.6) out.push({ type: 'contrast', severity: 'minor', message: `${Math.round(lowDark * 100)}% of the silhouette edge is very dark, so it will disappear on dark backgrounds. Lighten the outline on the lit side (selective outline) or add a rim light.` });
  if (lowLight > 0.6) out.push({ type: 'contrast', severity: 'minor', message: `${Math.round(lowLight * 100)}% of the edge is very light — it will vanish on light backgrounds. Add a darker outline.` });
  return out;
}

function animationIssues(frames, w, h) {
  const out = []; if (frames.length < 2) return out; const area = frames.map((d) => { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  for (let f = 1; f < frames.length; f++) { const a = area[f - 1], b = area[f]; if (a > 30 && b > 30 && Math.abs(b - a) / Math.max(a, b) > 0.3) out.push({ type: 'volume', severity: 'minor', frame: f + 1, message: `Frame ${f + 1} changes size by ${Math.round(Math.abs(b - a) / Math.max(a, b) * 100)}% from frame ${f} — fine for squash/stretch or an impact, a pop if not.` }); }
  // flicker: a pixel that's on for a single frame between frames where it's off
  if (frames.length >= 3) { let flick = 0; let fx = -1, fy = -1, ff = 0; for (let f = 1; f + 1 < frames.length; f++) for (let i = 0; i < w * h; i++) { const on = frames[f][i * 4 + 3] > 0, p = frames[f - 1][i * 4 + 3] > 0, n = frames[f + 1][i * 4 + 3] > 0; if (on && !p && !n) { flick++; fx = i % w; fy = (i / w) | 0; ff = f + 1; } } if (flick > Math.max(6, w * h * 0.01)) out.push({ type: 'flicker', severity: 'minor', frame: ff, x: fx, y: fy, w: 1, h: 1, message: `${flick} pixels appear for just one frame. Intended sparkle is fine; otherwise it reads as flicker.` }); }
  return out;
}

// critique(frames, w, h, { frame, title, allowSparks }) → { summary, issues, image }
function critique(frames, w, h, opts = {}) {
  const which = opts.frame != null ? [opts.frame] : frames.map((_, i) => i);
  let issues = []; let opaque = 0;
  for (const f of which) { const r = frameIssues(frames[f], w, h, opts); opaque += r.opaque; issues.push(...r.issues.map((x) => ({ ...x, frame: f + 1 }))); }
  // de-duplicate the same spot repeated across frames
  const seen = new Set(); issues = issues.filter((x) => { const k = `${x.type}:${x.x},${x.y}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const pal = paletteIssues(which.map((f) => frames[f])); issues.push(...pal.out);
  issues.push(...contrastIssues(frames[which[0]], w, h));
  if (opts.frame == null) issues.push(...animationIssues(frames, w, h));
  const order = { major: 0, minor: 1 }; issues.sort((a, b) => order[a.severity] - order[b.severity]);
  const capped = issues.slice(0, 40); capped.forEach((x, i) => (x.n = i + 1));
  const counts = {}; for (const x of issues) counts[x.type] = (counts[x.type] || 0) + 1;
  const score = Math.max(0, 100 - issues.reduce((s, x) => s + (x.severity === 'major' ? 8 : 2), 0));
  return { summary: { score, issues: issues.length, by_type: counts, colors: pal.colors, value_range: pal.valueRange, frames_checked: which.length }, issues: capped, image: markup(frames[which[0]], w, h, capped.filter((x) => x.x != null && (x.frame == null || x.frame === which[0] + 1 || opts.frame == null)), opts.title) };
}

// a zoomed copy with numbered boxes around each issue
function markup(d, w, h, list, title = '') {
  const s = Math.max(4, Math.min(16, Math.floor(640 / Math.max(w, h)))); const pad = 16, head = 20;
  const img = sheets.blank(w * s + pad * 2, h * s + pad * 2 + head, [16, 14, 22]);
  sheets.checker(img, pad, pad + head, w * s, h * s, Math.max(4, s)); sheets.put(img, d, w, h, pad, pad + head, s);
  if (title) sheets.label(img, title.slice(0, 40), pad, 6, [230, 226, 240], 2);
  const COLS = { major: [255, 64, 120], minor: [255, 200, 64] };
  for (const x of list) {
    const c = COLS[x.severity] || COLS.minor; const X = pad + x.x * s - 2, Y = pad + head + x.y * s - 2, W = (x.w || 1) * s + 4, H = (x.h || 1) * s + 4;
    for (let t = 0; t < 2; t++) for (let i = 0; i < W; i++) for (const yy of [Y + t, Y + H - 1 - t]) setPx(img, X + i, yy, c);
    for (let t = 0; t < 2; t++) for (let j = 0; j < H; j++) for (const xx of [X + t, X + W - 1 - t]) setPx(img, xx, Y + j, c);
    const lab2 = String(x.n); const lw = lab2.length * 4 + 3; for (let j = 0; j < 9; j++) for (let i = 0; i < lw; i++) setPx(img, X + i, Y - 9 + j, c);
    sheets.label(img, lab2, X + 2, Y - 7, [20, 10, 20]);
  }
  return img;
}
function setPx(img, x, y, c) { if (x < 0 || y < 0 || x >= img.w || y >= img.h) return; const k = (y * img.w + x) * 4; img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255; }

// a zoomed crop of one area (for looking closely at a face or hands)
function crop(d, w, h, { x = 0, y = 0, w: cw = w, h: ch = h } = {}) {
  x = Math.max(0, Math.min(w - 1, x | 0)); y = Math.max(0, Math.min(h - 1, y | 0)); cw = Math.max(1, Math.min(w - x, cw | 0)); ch = Math.max(1, Math.min(h - y, ch | 0));
  const out = new Uint8ClampedArray(cw * ch * 4); for (let j = 0; j < ch; j++) out.set(d.subarray(((y + j) * w + x) * 4, ((y + j) * w + x + cw) * 4), j * cw * 4);
  return { data: out, w: cw, h: ch };
}

module.exports = { critique, crop, markup, dE };
