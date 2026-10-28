// Make editable: take a flat picture apart into layers.
//   text     Tesseract reads each line; RO2 measures its colour, size, weight and alignment and rebuilds it as real text
//   objects  Segment Anything on a grid of points finds the things in the picture; flat-colour ones become vector
//            shapes, the rest become cut-out photo layers (edges refined at full size)
//   behind   LaMa fills in where the text and objects were, so the background is clean underneath
import { call, installed } from './client.js';
import { toHex } from '../panels/color.js';
import { bundledFonts, ensureFont } from '../fonts.js';

let tess = null;
async function ocrWorker(onLog) {
  if (tess) return tess;
  const T = (await import('../../vendor/tesseract/tesseract.esm.min.js')).default;
  tess = await T.createWorker('eng', 1, {
    workerPath: new URL('../../vendor/tesseract/worker.min.js', import.meta.url).href,
    corePath: new URL('../../vendor/tesseract/tesseract-core-simd-lstm.wasm.js', import.meta.url).href,
    langPath: 'ro2://models/ocr', gzip: true, // tesseract fetches <langPath>/'eng.traineddata.gz'
    cacheMethod: 'none', workerBlobURL: false,
    logger: (m) => onLog && onLog(m),
  });
  return tess;
}
export async function stopOcr() { if (tess) { try { await tess.terminate(); } catch {} tess = null; } }

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
// Two colour groups in a box: the ink (fewer pixels) and what's behind it
function inkAndPaper(img, x0, y0, x1, y1) {
  const { data, width: W } = img; const px = [];
  const step = Math.max(1, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / 6000)));
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) { const i = (y * W + x) * 4; px.push([data[i], data[i + 1], data[i + 2]]); }
  if (px.length < 4) return null;
  let a = px.reduce((m, p) => (lum(...p) < lum(...m) ? p : m), px[0]), b = px.reduce((m, p) => (lum(...p) > lum(...m) ? p : m), px[0]);
  let na = 0, nb = 0;
  for (let it = 0; it < 8; it++) {
    const sa = [0, 0, 0], sb = [0, 0, 0]; na = nb = 0;
    for (const p of px) { if (d2(p, a) < d2(p, b)) { sa[0] += p[0]; sa[1] += p[1]; sa[2] += p[2]; na++; } else { sb[0] += p[0]; sb[1] += p[1]; sb[2] += p[2]; nb++; } }
    if (na) a = sa.map((v) => v / na); if (nb) b = sb.map((v) => v / nb);
  }
  // the paper is whichever colour continues just outside the box (heavy display type can cover more of its box than the paper does)
  let inkIsA = na <= nb;
  const ring = []; const m = Math.max(2, Math.round((y1 - y0) * 0.25)); const H = data.length / 4 / W;
  for (const [xx0, yy0, xx1, yy1] of [[x0 - m, y0 - m, x1 + m, y0], [x0 - m, y1, x1 + m, y1 + m], [x0 - m, y0, x0, y1], [x1, y0, x1 + m, y1]])
    for (let y = Math.max(0, yy0); y < Math.min(H, yy1); y += step) for (let x = Math.max(0, xx0); x < Math.min(W, xx1); x += step) { const i = (y * W + x) * 4; ring.push([data[i], data[i + 1], data[i + 2]]); }
  if (ring.length > 8) { let va = 0, vb = 0; for (const p of ring) { if (d2(p, a) < d2(p, b)) va++; else vb++; } if (Math.max(va, vb) > ring.length * 0.6) inkIsA = vb > va; }
  const ink = inkIsA ? a : b, paper = inkIsA ? b : a;
  return { ink, paper, inkFrac: (inkIsA ? na : nb) / px.length, contrast: Math.sqrt(d2(ink, paper)) };
}
const measureCtx = document.createElement('canvas').getContext('2d');
// The fonts RO2 tries when it rebuilds a line of text: a spread of sans, display, condensed and serif faces
const CANDIDATES = [['Inter', 400], ['Inter', 700], ['Inter', 900], ['Poppins', 400], ['Poppins', 600], ['Poppins', 800], ['Montserrat', 400], ['Montserrat', 700], ['Montserrat', 900],
  ['DM Sans', 400], ['DM Sans', 700], ['Raleway', 400], ['Archivo Black', 400], ['Anton', 400], ['Bebas Neue', 400], ['Oswald', 400], ['Oswald', 700], ['Barlow Condensed', 700],
  ['Playfair Display', 400], ['Playfair Display', 700], ['Playfair Display', 900], ['Lora', 400], ['Lora', 700], ['DM Serif Display', 400], ['Merriweather', 700], ['Space Grotesk', 700], ['Rubik', 700]];
function inkBox(mask, W, x0, y0, x1, y1) { let a = x1, b = y1, c = x0 - 1, d = y0 - 1; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (mask[y * W + x]) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; } return c < a ? null : [a, b, c + 1, d + 1]; }
// ink box of the letters: the run of ink rows with the most ink in it (an underline or a rule below is a separate run)
function inkBand(mask, W, x0, y0, x1, y1) {
  const rows = []; for (let y = y0; y < y1; y++) { let n = 0; for (let x = x0; x < x1; x++) n += mask[y * W + x]; rows.push(n); }
  const bands = []; let cur = null, gap = 0; const minGap = Math.max(2, Math.round((y1 - y0) * 0.02));
  rows.forEach((n, i) => { if (n > 0) { if (!cur || gap >= minGap) { cur = { a: i, b: i, ink: 0 }; bands.push(cur); } cur.b = i; cur.ink += n; gap = 0; } else gap++; });
  if (!bands.length) return null; const top = bands.reduce((p, q) => (q.ink > p.ink ? q : p));
  // descenders/accents are small runs right next to the main one: keep those that sit within a fifth of its height
  let a = top.a, b = top.b; const hh = b - a + 1;
  for (const bd of bands) if (bd !== top && bd.ink < top.ink * 0.25 && ((bd.a > b && bd.a - b < hh * 0.2) || (bd.b < a && a - bd.b < hh * 0.2)) && (bd.b - bd.a + 1) < hh * 0.5 && !isRule(mask, W, x0, x1, y0 + bd.a, y0 + bd.b)) { a = Math.min(a, bd.a); b = Math.max(b, bd.b); }
  const box = inkBox(mask, W, x0, y0 + a, x1, y0 + b + 1); return box;
}
function isRule(mask, W, x0, x1, ya, yb) { let mn = x1, mx = x0, n = 0; for (let y = ya; y <= yb; y++) for (let x = x0; x < x1; x++) if (mask[y * W + x]) { n++; if (x < mn) mn = x; if (x > mx) mx = x; } return mx > mn && n / ((mx - mn + 1) * (yb - ya + 1)) > 0.8; } // a solid bar
// ink box of the letters: everything inside core, plus only ink connected to it in the wider box (descenders, not a line below)
function inkGrow(mask, W, core, ext) {
  const [ex0, ey0, ex1, ey1] = ext; const w = ex1 - ex0, h = ey1 - ey0; if (w <= 0 || h <= 0) return null; const seen = new Uint8Array(w * h); const st = [];
  for (let y = core[1]; y < core[3]; y++) for (let x = core[0]; x < core[2]; x++) if (mask[y * W + x]) { const q = (y - ey0) * w + x - ex0; if (q >= 0 && q < seen.length && !seen[q]) { seen[q] = 1; st.push(q); } }
  let a = ex1, b = ey1, c = ex0 - 1, d = ey0 - 1;
  while (st.length) { const q = st.pop(); const x = q % w, y = (q / w) | 0; const X = x + ex0, Y = y + ey0; if (X < a) a = X; if (X > c) c = X; if (Y < b) b = Y; if (Y > d) d = Y;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const k = yy * w + xx; if (!seen[k] && mask[(yy + ey0) * W + xx + ex0]) { seen[k] = 1; st.push(k); } } }
  return c < a ? null : [a, b, c + 1, d + 1];
}
const NH = 36; // compare glyph shapes at this height
function sampleMask(get, w, h, ow) { const o = new Uint8Array(ow * NH); for (let y = 0; y < NH; y++) for (let x = 0; x < ow; x++) { let n = 0, t = 0; for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) { t++; n += get(Math.min(w - 1, Math.floor(((x + (xx + 0.5) / 2) / ow) * w)), Math.min(h - 1, Math.floor(((y + (yy + 0.5) / 2) / NH) * h))); } o[y * ow + x] = n * 2 >= t ? 1 : 0; } return o; }
const rc = document.createElement('canvas'); const rx = rc.getContext('2d', { willReadFrequently: true });
function renderInk(text, fam, wt, size, sp = 0) {
  rx.letterSpacing = sp + 'px'; rx.font = `${wt} ${size}px "${fam}"`; const m = rx.measureText(text); const w = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + 4, h = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + 4;
  const extra = Math.max(0, sp * [...text].length); rc.width = Math.max(1, w + extra); rc.height = Math.max(1, h); rx.letterSpacing = sp + 'px'; rx.font = `${wt} ${size}px "${fam}"`; rx.fillStyle = '#000'; rx.fillText(text, 2 + m.actualBoundingBoxLeft, 2 + m.actualBoundingBoxAscent);
  const d = rx.getImageData(0, 0, rc.width, rc.height).data; const bin = new Uint8Array(rc.width * rc.height); for (let i = 0; i < bin.length; i++) bin[i] = d[i * 4 + 3] > 110 ? 1 : 0;
  const box = inkBox(bin, rc.width, 0, 0, rc.width, rc.height); return box && { bin, cw: rc.width, box };
}
function inkWidth(text, fs, fam, wt) { rx.font = `${wt} ${fs}px "${fam}"`; const m = rx.measureText(text); return m.actualBoundingBoxLeft + m.actualBoundingBoxRight; }
// Pick the bundled font whose letters look most like the picture's: same ink height, then the closest shapes and width
async function matchFont(mask, W, line, caps) {
  const e = Math.round((line.y1 - line.y0) * 0.06), ed = /[gjpqy]/.test(line.text) ? Math.round((line.y1 - line.y0) * 0.3) : e;
  const box = inkBand(mask, W, line.box[0], line.box[1], line.box[2], line.box[3]) || [line.x0, line.y0, line.x1, line.y1];
  const iw = box[2] - box[0], ih = box[3] - box[1]; const ow = Math.max(4, Math.min(600, Math.round((NH * iw) / Math.max(1, ih))));
  const real = sampleMask((x, y) => mask[(y + box[1]) * W + x + box[0]], iw, ih, ow);
  const text = line.text; let best = null;
  for (const [fam, wt] of CANDIDATES) {
    if (!bundledFonts().some((f) => f.family === fam)) continue;
    try { await ensureFont(fam, wt); } catch { continue; }
    let r = renderInk(text, fam, wt, 120); if (!r) continue;
    let [a, b, c, d] = r.box; let rw = c - a, rh = d - b; const k = ih / rh; let widthRatio = (rw * k) / iw;
    // letter-spaced type: try this font with the spacing that would make it as wide as the original
    const n = [...text].length; let sp = 0;
    if (n > 1 && Math.abs(widthRatio - 1) > 0.04) {
      sp = Math.max(-0.1 * 120, Math.min(0.9 * 120, (iw / k - rw) / (n - 1)));
      const r2 = renderInk(text, fam, wt, 120, sp); if (r2) { r = r2; [a, b, c, d] = r.box; rw = c - a; widthRatio = (rw * k) / iw; }
    }
    const syn = sampleMask((x, y) => r.bin[(y + b) * r.cw + x + a], rw, rh, ow);
    let inter = 0, uni = 0; for (let q = 0; q < real.length; q++) { inter += real[q] & syn[q]; uni += real[q] | syn[q]; }
    const score = inter / Math.max(1, uni) - 0.9 * Math.abs(Math.log(widthRatio)) - 0.35 * Math.abs(sp / 120);
    if (!best || score > best.score) best = { score, family: fam, weight: wt, fs: 120 * k, inkW: iw, spacing: Math.round((sp / 120) * 1000) };
    if (window.__lzDebug) (window.__lzFont ||= []).push([text + " " + JSON.stringify([line.x0, line.y0, line.x1, line.y1, box]), fam, wt, +(inter / Math.max(1, uni)).toFixed(3), +widthRatio.toFixed(2), +score.toFixed(3)]);
  }
  rx.letterSpacing = '0px';
  return best || { family: 'Inter', weight: 400, fs: ih / 0.73, inkW: iw };
}
function textWidth(t, fs, fam, wt, spacing = 0) { measureCtx.font = `${wt} ${fs}px "${fam}"`; return measureCtx.measureText(t).width + (spacing / 1000) * fs * Math.max(0, [...t].length - 1); }

// A tesseract line can join things that only happen to share a row ("2,481      new sign-ups"): split it where
// the gap between words is wide or the letter height jumps.
function splitLine(l) {
  const ws = (l.words || []).filter((w) => w.text && w.text.trim());
  if (!ws.length) return [{ text: fixWords((l.text || '').trim().replace(/\s+/g, ' ')), x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1, conf: l.confidence }];
  const runs = []; let cur = [ws[0]];
  const hOf = (w) => w.bbox.y1 - w.bbox.y0;
  for (let i = 1; i < ws.length; i++) {
    const a = cur[cur.length - 1], b = ws[i]; const hh = Math.max(hOf(a), hOf(b)), hl = Math.min(hOf(a), hOf(b));
    const gap = b.bbox.x0 - a.bbox.x1;
    if (gap > hh * 1.3 || (hh > hl * 2.1 && gap > hl * 0.5)) { runs.push(cur); cur = [b]; } else cur.push(b);
  }
  runs.push(cur);
  const join = (r) => { let t = r[0].text.trim(); for (let i = 1; i < r.length; i++) { const a = r[i - 1], b = r[i]; const gap = b.bbox.x0 - a.bbox.x1;
    t += /\d$/.test(a.text.trim()) && /^\d{3}\b/.test(b.text.trim()) && gap < hOf(b) * 0.6 ? ',' : ' '; t += b.text.trim(); } return fixWords(t); };
  return runs.map((r) => ({ text: join(r), x0: Math.min(...r.map((w) => w.bbox.x0)), y0: Math.min(...r.map((w) => w.bbox.y0)), x1: Math.max(...r.map((w) => w.bbox.x1)), y1: Math.max(...r.map((w) => w.bbox.y1)), conf: r.reduce((s2, w) => s2 + w.confidence, 0) / r.length }));
}
function fixWords(t) {
  const caps = t === t.toUpperCase();
  return t.split(' ').map((w, i, a) => (w === '|' ? (caps && a.length > 1 ? 'I' : '') : w)).filter(Boolean).join(' ').replace(/^[|\[\]]\s*|\s*[|\[\]]$/g, '');
}
function iou(a, b) { const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)); const i = ix * iy; return i / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i || 1); }
// keep the more confident reading where the two passes found the same words
function dedupeRuns(runs) {
  const out = [];
  const score = (r) => r.conf + Math.min(12, 3 * r.text.replace(/\s/g, '').length);
  for (const r of runs.sort((a, b) => score(b) - score(a))) {
    const hit = out.find((o) => iou(o, r) > 0.3 || (Math.min(o.x1, r.x1) - Math.max(o.x0, r.x0) > 0 && Math.min(o.y1, r.y1) - Math.max(o.y0, r.y0) > 0.6 * Math.min(o.y1 - o.y0, r.y1 - r.y0)));
    if (!hit) out.push({ ...r });
    else if (hit.text.replace(/\W/g, '') === r.text.replace(/\W/g, '') && r.y1 - r.y0 < (hit.y1 - hit.y0) * 0.95) Object.assign(hit, { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }); // same words: keep the tighter box
  }
  return out;
}
function invertedGrey(img) {
  const { width: W, height: H, data } = img; const g = new Float32Array(W * H); let lo = 255, hi = 0;
  for (let i = 0; i < W * H; i++) { const v = lum(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]); g[i] = v; }
  const sorted = Float32Array.from(g).sort(); lo = sorted[Math.floor(sorted.length * 0.01)]; hi = sorted[Math.floor(sorted.length * 0.99)];
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); const id = x.createImageData(W, H); const k = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < W * H; i++) { const v = 255 - Math.max(0, Math.min(255, (g[i] - lo) * k)); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
  x.putImageData(id, 0, 0); return c;
}

async function readTesseract(img, cv, W, H, onProgress) {
  const w = await ocrWorker((m) => { if (m.status === 'recognizing text') onProgress(`Reading the text… ${Math.round(m.progress * 100)}%`); });
  // two passes: the picture as it is, and a stretched, inverted grey copy (catches light-on-dark and low-contrast text)
  const raw = [];
  const pass = async (canvas, tag) => {
    const { data } = await w.recognize(canvas, {}, { blocks: true, text: false });
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const run of splitLine(l)) raw.push({ ...run, para: tag + (b.bbox.x0 + ',' + b.bbox.y0) + '/' + (p.bbox.x0 + ',' + p.bbox.y0) });
  };
  await pass(cv, 'a');
  onProgress('Reading the text… (second look)');
  await w.setParameters({ tessedit_pageseg_mode: '11' }); // sparse text: finds small, spaced-out and scattered words
  try { await pass(invertedGrey(img), 'b'); } finally { await w.setParameters({ tessedit_pageseg_mode: '3' }); }
  if (Math.max(W, H) >= 700) { // very big display type reads better smaller
    onProgress('Reading the text… (big type)');
    const k = 0.4; const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k); const cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(invertedGrey(img), 0, 0, c.width, c.height);
    const n0 = raw.length; await pass(c, 'c');
    for (const r of raw.slice(n0)) { r.x0 /= k; r.y0 /= k; r.x1 /= k; r.y1 /= k; r.x0 = Math.round(r.x0); r.y0 = Math.round(r.y0); r.x1 = Math.min(W, Math.round(r.x1)); r.y1 = Math.min(H, Math.round(r.y1)); }
    for (let i = raw.length - 1; i >= n0; i--) if (raw[i].y1 - raw[i].y0 < H * 0.05) raw.splice(i, 1); // only trust it for big text
  }
  return raw;
}
// is (x, y) inside a rotated box (grown by k)?
function rotTest(r, k = 1) { if (!r) return null; const ca = Math.cos((r.angle * Math.PI) / 180), sa = Math.sin((r.angle * Math.PI) / 180); const hw = (r.w * k) / 2, hh = (r.h * k) / 2 + r.h * (k - 1);
  return (x, y) => { const dx = x - r.cx, dy = y - r.cy; const u = dx * ca + dy * sa, v = -dx * sa + dy * ca; return Math.abs(u) <= hw && Math.abs(v) <= hh; }; }
// A tilted line: straighten its ink into a local mask, match the font there, and keep the angle
async function tiltedText(res, W, l) {
  const H = res.textMask.length / W; const r = { ...l.rot };
  { // refine the angle from the ink: the angle at which this line's letters are thinnest from top to bottom
    const ca0 = Math.cos((r.angle * Math.PI) / 180), sa0 = Math.sin((r.angle * Math.PI) / 180); const pts = [];
    const inside = (x, y) => { const dx = x - r.cx, dy = y - r.cy; return Math.abs(dx * ca0 + dy * sa0) <= r.w * 0.48 && Math.abs(-dx * sa0 + dy * ca0) <= r.h * 0.34; }; // the core: the detector's box is padded and overlaps the next line
    for (let y = Math.max(0, l.y0); y < Math.min(H, l.y1); y++) for (let x = Math.max(0, l.x0); x < Math.min(W, l.x1); x++) if (res.textMask[y * W + x] && inside(x, y)) pts.push(x - r.cx, y - r.cy);
    if (pts.length > 40) {
      let best = r.angle, bh = Infinity; const n = pts.length / 2; const vs = new Float32Array(n);
      for (let a = r.angle - 8; a <= r.angle + 8; a += 0.5) { const c = Math.cos((a * Math.PI) / 180), s2 = Math.sin((a * Math.PI) / 180); for (let i = 0; i < n; i++) vs[i] = -pts[2 * i] * s2 + pts[2 * i + 1] * c; vs.sort(); const hh = vs[Math.floor(n * 0.97)] - vs[Math.floor(n * 0.03)]; if (hh < bh) { bh = hh; best = a; } }
      r.angle = best;
    }
  }
  const pad = r.h * 0.15; const lw = Math.ceil(r.w + pad * 2), lh = Math.ceil(r.h + pad * 2);
  const ca = Math.cos((r.angle * Math.PI) / 180), sa = Math.sin((r.angle * Math.PI) / 180); const m = new Uint8Array(lw * lh);
  for (let v = 0; v < lh; v++) for (let u = 0; u < lw; u++) { const du = u + 0.5 - lw / 2, dv = v + 0.5 - lh / 2; if (Math.abs(dv) > r.h * 0.4) continue; const X = Math.round(r.cx + du * ca - dv * sa), Y = Math.round(r.cy + du * sa + dv * ca); if (X >= 0 && Y >= 0 && X < W && Y < H) m[v * lw + u] = res.textMask[Y * W + X]; }
  const local = { text: l.text, box: [0, 0, lw, lh], x0: Math.round(pad), y0: Math.round(pad), x1: Math.round(pad + r.w), y1: Math.round(pad + r.h) };
  const fm = await matchFont(m, lw, local, l.text === l.text.toUpperCase());
  const ib = inkBand(m, lw, 0, 0, lw, lh) || [local.x0, local.y0, local.x1, local.y1];
  const icu = (ib[0] + ib[2]) / 2 - lw / 2, icv = (ib[1] + ib[3]) / 2 - lh / 2;
  const icx = r.cx + icu * ca - icv * sa, icy = r.cy + icu * sa + icv * ca;
  return { kind: 'text', on: true, text: l.text, x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1, ink: null, lines: 1, color: toHex({ r: l.ink[0], g: l.ink[1], b: l.ink[2] }), fontSize: fm.fs, fontWeight: fm.weight, fontFamily: fm.family, align: 'center', charSpacing: fm.spacing || 0, lineHeight: 1.15, conf: Math.round(l.conf),
    rot: { cx: icx, cy: icy, inkW: ib[2] - ib[0], inkH: ib[3] - ib[1], angle: r.angle, box: { cx: r.cx, cy: r.cy, w: r.w, h: r.h } } };
}
// Spaces from the picture itself: columns with no ink that are much wider than the gaps between letters
function respace(l, img) {
  if (!l.chars || l.chars.length < 5) return l.text;
  const W = img.width; const x0 = Math.max(0, Math.round(l.cx - l.w / 2)), x1 = Math.min(W, Math.round(l.cx + l.w / 2)), y0 = Math.max(0, Math.round(l.cy - l.h * 0.35)), y1 = Math.min(img.height, Math.round(l.cy + l.h * 0.35));
  if (x1 - x0 < 10) return l.text;
  const bg = inkAndPaper(img, Math.max(0, x0 - 4), Math.max(0, y0 - 4), Math.min(W, x1 + 4), Math.min(img.height, y1 + 4)); if (!bg || bg.contrast < 28) return l.text;
  const col = []; for (let x = x0; x < x1; x++) { let n = 0; for (let y = y0; y < y1; y++) { const i = (y * W + x) * 4; if (d2([img.data[i], img.data[i + 1], img.data[i + 2]], bg.ink) < d2([img.data[i], img.data[i + 1], img.data[i + 2]], bg.paper)) n++; } col.push(n > 0); }
  const runs = []; let st = -1; col.forEach((on, i) => { if (!on && st < 0) st = i; if (on && st >= 0) { runs.push([st, i]); st = -1; } });
  const inner = runs.filter(([a]) => a > 0).map(([a, b]) => ({ a, b, w: b - a })); if (inner.length < 3) return l.text;
  const med = inner.map((r) => r.w).sort((a, b) => a - b)[inner.length >> 1]; const hh = (y1 - y0) / 0.7;
  const cuts = inner.filter((r) => r.w > Math.max(med * 2.2, hh * 0.22)).map((r) => (r.a + r.b) / 2 / (x1 - x0));
  if (!cuts.length) return l.text;
  // rebuild: keep existing spaces, add one before the first letter past each cut
  const words = l.text.split(' '); let k = 0; const flat = []; words.forEach((w, wi) => { for (const ch of w) flat.push({ ch, p: l.chars[k++]?.[1] ?? 0, sp: false }); if (wi < words.length - 1 && flat.length) flat[flat.length - 1].sp = true; });
  for (const c of cuts) { const j = flat.findIndex((f) => f.p > c); if (j > 0) flat[j - 1].sp = true; }
  return flat.map((f) => f.ch + (f.sp ? ' ' : '')).join('').trim();
}
// PP-OCRv6 lines → runs (split at wide gaps like tesseract lines); tilted lines keep their rotated box in .rot
async function readPro(img, onProgress) {
  const W = img.width, H = img.height;
  const { lines } = await call('ocrPro', { img: { data: new Uint8ClampedArray(img.data), w: W, h: H } }, { onProgress: (p) => p?.text && onProgress(p.text) });
  const raw = [];
  for (const [i, l] of lines.entries()) {
    const para = 'p' + i; const tilt = Math.abs(l.angle) >= 2.5;
    // the detector already separates blocks of text, so each line is one run (no gap splitting)
    const lw = l.w, lh = l.h; const ca = Math.cos((l.angle * Math.PI) / 180), sa = Math.sin((l.angle * Math.PI) / 180);
    const cs = [[-lw / 2, -lh / 2], [lw / 2, -lh / 2], [lw / 2, lh / 2], [-lw / 2, lh / 2]].map(([x, y]) => [l.cx + x * ca - y * sa, l.cy + x * sa + y * ca]);
    if (!tilt) l.text = respace(l, img); // letter-spaced words that came back glued together
    raw.push({ text: fixWords(l.text), conf: l.conf, para, x0: Math.max(0, Math.floor(Math.min(...cs.map((c) => c[0])))), y0: Math.max(0, Math.floor(Math.min(...cs.map((c) => c[1])))), x1: Math.min(W, Math.ceil(Math.max(...cs.map((c) => c[0])))), y1: Math.min(H, Math.ceil(Math.max(...cs.map((c) => c[1])))),
      rot: tilt ? { cx: l.cx, cy: l.cy, w: lw, h: lh, angle: l.angle } : undefined });
  }
  return raw;
}

// ───── analyse ─────
// img: ImageData (full size). Returns { texts, objects, aw, ah, small } with everything in full-size pixels except object masks (aw × ah).
export async function analyze(img, { onProgress = () => {}, key, ocr = true, objects = true } = {}) {
  const W = img.width, H = img.height;
  const res = { W, H, texts: [], objects: [], textMask: new Uint8Array(W * H) };
  // small copy for object analysis
  const s = Math.min(1, 512 / Math.max(W, H)); const aw = Math.max(8, Math.round(W * s)), ah = Math.max(8, Math.round(H * s));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.getContext('2d').putImageData(img, 0, 0);
  const sc = document.createElement('canvas'); sc.width = aw; sc.height = ah; const sx = sc.getContext('2d', { willReadFrequently: true }); sx.imageSmoothingQuality = 'high'; sx.drawImage(cv, 0, 0, aw, ah);
  const small = sx.getImageData(0, 0, aw, ah); res.aw = aw; res.ah = ah; res.small = small;
  res.photo = isPhoto(small);

  if (ocr) {
    onProgress('Reading the text…');
    let raw = null;
    if (await installed('ocrpro').catch(() => false)) { // PP-OCRv6: better on stylised, small, spaced-out and tilted text
      try { raw = await readPro(img, onProgress); res.reader = 'ppocr'; } catch (e) { console.warn('text reader fell back to tesseract', e); raw = null; }
    }
    if (!raw) { raw = await readTesseract(img, cv, W, H, onProgress); res.reader = 'tesseract'; }
    if (window.__lzDebug) window.__lzRaw = raw.map((r) => [r.text, Math.round(r.conf), r.para[0], r.x0, r.y0, r.x1, r.y1]);
    const lines = [];
    for (const r of dedupeRuns(raw)) {
      const t = r.text; const alnum = (t.match(/[A-Za-z0-9]/g) || []).length;
      if (!alnum || r.conf < (res.photo ? 70 : 55) || (alnum <= 2 && r.conf < 86)) continue;
      const words = t.split(' '); if (words.length > 1 && words.every((w2) => w2.replace(/\W/g, '').length <= 1) && !/\d/.test(t)) continue; // "y h": stray marks, not words
      const { x0, y0, x1, y1 } = r; if (x1 - x0 < 4 || y1 - y0 < 4) continue;
      const pad = Math.round((y1 - y0) * 0.12), down = /[gjpqy,;]/.test(t) ? Math.round((y1 - y0) * 0.3) : pad; // room for descenders
      const bx0 = Math.max(0, x0 - pad), by0 = Math.max(0, y0 - pad), bx1 = Math.min(W, x1 + pad), by1 = Math.min(H, y1 + down);
      const cp = inkAndPaper(img, bx0, by0, bx1, by1); if (!cp || cp.contrast < 28) continue;
      lines.push({ text: t, x0, y0, x1, y1, h: y1 - y0, conf: r.conf, para: r.para, ...cp, box: [bx0, by0, bx1, by1], rot: r.rot });
    }
    lines.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    // ink mask: pixels in each line's box nearer the ink colour than the paper colour
    for (const l of lines) {
      const [bx0, by0, bx1, by1] = l.box; let n = 0; const inRot = rotTest(l.rot, 1.15);
      for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) { if (inRot && !inRot(x, y)) continue; const i = (y * W + x) * 4; const p = [img.data[i], img.data[i + 1], img.data[i + 2]]; if (d2(p, l.ink) < (l.contrast * 0.55) ** 2 && d2(p, l.ink) < d2(p, l.paper)) { res.textMask[y * W + x] = 1; n++; } }
      l.inkFrac = n / ((bx1 - bx0) * (by1 - by0));
    }
    // tighten each line to its own band of ink (drops an underline or a rule that OCR swept into the box)
    for (const l of lines) { if (l.rot) continue; const b = inkBand(res.textMask, W, ...l.box); if (b) { l.band = b; l.y0 = Math.max(l.y0, b[1] - 1); l.y1 = Math.min(l.y1, b[3] + 1); l.h = l.y1 - l.y0; } }
    for (const l of lines) { if (!l.band) continue; const [bx0, by0, bx1, by1] = l.box; const pad = Math.max(2, Math.round(l.h * 0.08));
      for (let y = by0; y < by1; y++) { if (y >= l.band[1] - pad && y < l.band[3] + pad) continue; if (lines.some((o) => o !== l && o.band && y >= o.band[1] - pad && y < o.band[3] + pad && o.box[0] < bx1 && o.box[2] > bx0)) continue; for (let x = bx0; x < bx1; x++) res.textMask[y * W + x] = 0; } }
    // lines → text boxes: same paragraph, similar height and colour, close together
    const groups = [];
    for (const l of lines) {
      if (l.rot) { groups.push([l]); continue; } // tilted lines stay on their own
      const g = groups.find((g2) => { const last = g2[g2.length - 1]; if (last.rot) return false; const ov = Math.min(l.x1, last.x1) - Math.max(l.x0, last.x0);
        return ov > 0.25 * Math.min(l.x1 - l.x0, last.x1 - last.x0) && Math.abs(l.h - last.h) < Math.max(l.h, last.h) * 0.3 && Math.sqrt(d2(l.ink, last.ink)) < 60 && l.y0 - last.y1 < last.h * 1.1 && l.y0 > last.y0; });
      if (g) g.push(l); else groups.push([l]);
    }
    let id = 0;
    for (const g of groups) {
      if (g[0].rot) { const t = await tiltedText(res, W, g[0]); if (t) res.texts.push({ id: 't' + id++, ...t }); continue; }
      const x0 = Math.min(...g.map((l) => l.x0)), x1 = Math.max(...g.map((l) => l.x1)), y0 = Math.min(...g.map((l) => l.y0)), y1 = Math.max(...g.map((l) => l.y1));
      const text = g.map((l) => l.text).join('\n'); const ref = g.reduce((a, b) => (a.x1 - a.x0 > b.x1 - b.x0 ? a : b));
      const ink = g[0].ink.map((v, i) => g.reduce((s2, l) => s2 + l.ink[i], 0) / g.length);
      const m = await matchFont(res.textMask, W, ref, text === text.toUpperCase());
      const fam = m.family, weight = m.weight, fs = m.fs;
      const left = (l) => l.x0, right = (l) => l.x1, mid = (l) => (l.x0 + l.x1) / 2;
      const spread = (f) => { const v = g.map(f); const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length); };
      const align = g.length < 2 ? 'center' : [['left', spread(left)], ['center', spread(mid)], ['right', spread(right)]].sort((a, b) => a[1] - b[1])[0][0];
      const spacing = m.spacing != null ? m.spacing : Math.max(-60, Math.min(600, ((m.inkW - inkWidth(ref.text, fs, fam, weight)) / Math.max(1, [...ref.text].length - 1) / fs) * 1000));
      const lh = g.length > 1 ? Math.max(0.7, Math.min(2.4, ((g[g.length - 1].y1 - g[0].y1) / (g.length - 1)) / (fs * 1.13))) : 1.15; // fabric: line = fontSize × lineHeight × 1.13
      const ib = g.map((l) => inkBand(res.textMask, W, l.box[0], l.box[1], l.box[2], l.box[3]) || [l.x0, l.y0, l.x1, l.y1]);
      const inkU = [Math.min(...ib.map((b) => b[0])), Math.min(...ib.map((b) => b[1])), Math.max(...ib.map((b) => b[2])), Math.max(...ib.map((b) => b[3]))];
      res.texts.push({ id: 't' + id++, kind: 'text', on: true, text, x0, y0, x1, y1, ink: inkU, lines: g.length, color: toHex({ r: ink[0], g: ink[1], b: ink[2] }), fontSize: fs, fontWeight: weight, fontFamily: fam, align, charSpacing: Math.round(spacing), lineHeight: lh, conf: Math.round(g.reduce((s2, l) => s2 + l.conf, 0) / g.length) });
    }
  }

  if (objects) {
    onProgress('Looking at the picture…');
    await call('samEmbed', { key, img: { data: img.data, w: W, h: H } }, { onProgress: (p) => p?.text && onProgress(p.text) });
    const { masks } = await call('samAuto', { key, aw, ah, grid: 10 }, { onProgress: (p) => p?.text && onProgress(p.text) });
    if (res.photo && (await installed('ormbg').catch(() => false))) { // a photo: the background remover says what the subject is
      onProgress('Finding the subject…');
      try { res.fg = (await call('removebg', { img: { data: new Uint8ClampedArray(small.data), w: aw, h: ah }, refine: false })).alpha; } catch {}
    }
    res.objects = classify(masks, res, small);
  }
  return res;
}
// Add one object the user clicked (in full-size pixels)
export async function objectAt(res, key, x, y) {
  const { masks } = await call('samAuto', { key, aw: res.aw, ah: res.ah, grid: 0, extra: [{ x, y }] });
  const list = classify(masks, res, res.small, { keepAll: true });
  return list[0] || null;
}
// in a photo, the subject (from the background remover's matte) is one object; SAM pieces inside it are its parts
function withSubject(list, fg, aw, ah, small) {
  const N = aw * ah; const m = new Uint8Array(N); for (let q = 0; q < N; q++) m[q] = fg[q] > 128 ? 1 : 0;
  const lab = new Int32Array(N); const comps = []; const st = [];
  for (let i = 0; i < N; i++) { if (!m[i] || lab[i]) continue; const c = { id: comps.length + 1, n: 0, x0: aw, y0: ah, x1: 0, y1: 0 }; comps.push(c); lab[i] = c.id; st.push(i);
    while (st.length) { const j = st.pop(); c.n++; const x = j % aw, y = (j / aw) | 0; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (const k of [x > 0 ? j - 1 : -1, x < aw - 1 ? j + 1 : -1, y > 0 ? j - aw : -1, y < ah - 1 ? j + aw : -1]) if (k >= 0 && m[k] && !lab[k]) { lab[k] = c.id; st.push(k); } } }
  const subjects = comps.filter((c) => c.n > N * 0.01).map((c) => { const mask = new Uint8Array(N); for (let q = 0; q < N; q++) if (lab[q] === c.id) mask[q] = 1; return { mask, area: c.n, frac: c.n / N, bbox: [c.x0, c.y0, c.x1, c.y1], flat: false, on: true, subject: true, color: '#888888' }; });
  if (!subjects.length) return list;
  const rest = list.filter((o) => { let inS = 0; for (let q = 0; q < N; q++) if (o.mask[q] && m[q]) inS++; return inS / o.area < 0.6; }); // parts of the subject go
  return [...subjects, ...rest];
}
function mergeRow(list, aw, ah) {
  const items = list.map((o) => ({ ...o, mask: o.mask }));
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j]; if (a.frac > 0.08 || b.frac > 0.08) continue;
      const ha = a.bbox[3] - a.bbox[1] + 1, hb = b.bbox[3] - b.bbox[1] + 1; const hh = Math.max(ha, hb);
      if (Math.min(ha, hb) < hh * 0.72) continue;
      const vov = Math.min(a.bbox[3], b.bbox[3]) - Math.max(a.bbox[1], b.bbox[1]); if (vov < hh * 0.7) continue;
      const gap = Math.max(a.bbox[0], b.bbox[0]) - Math.min(a.bbox[2], b.bbox[2]); if (gap > hh * 0.35) continue;
      const m = new Uint8Array(a.mask.length); for (let q = 0; q < m.length; q++) m[q] = a.mask[q] | b.mask[q];
      items[i] = { ...a, flat: a.flat && b.flat, mask: m, area: a.area + b.area, frac: a.frac + b.frac, bbox: [Math.min(a.bbox[0], b.bbox[0]), Math.min(a.bbox[1], b.bbox[1]), Math.max(a.bbox[2], b.bbox[2]), Math.max(a.bbox[3], b.bbox[3])] };
      items.splice(j, 1); changed = true; break outer;
    }
  }
  return items;
}
// a smooth gradient has a low spread up close but its halves differ: keep those as photo layers so the gradient survives
function isGradient(m, small, aw, tbox) {
  const [x0, y0, x1, y1] = m.bbox; const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; const s = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const q = y * aw + x; if (!m.mask[q] || tbox[q]) continue; const i = q * 4;
    for (const k of [x < cx ? 0 : 1, y < cy ? 2 : 3]) { s[k][0] += small.data[i]; s[k][1] += small.data[i + 1]; s[k][2] += small.data[i + 2]; s[k][3]++; } }
  const mean = (k) => s[k].slice(0, 3).map((v) => v / Math.max(1, s[k][3]));
  return Math.sqrt(d2(mean(0), mean(1))) > 22 || Math.sqrt(d2(mean(2), mean(3))) > 22;
}
// photos have fine texture/noise almost everywhere; flat graphics (even with gradients) are smooth between edges
function isPhoto(small) {
  const w = small.width, h = small.height, d = small.data; const L = (x, y) => { const i = (y * w + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
  const v = []; for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) v.push(Math.abs(L(x, y) - (L(x - 1, y) + L(x + 1, y) + L(x, y - 1) + L(x, y + 1)) / 4));
  v.sort((a, b) => a - b); return v[Math.floor(v.length * 0.75)] > 0.9;
}
function classify(masks, res, small, { keepAll = false } = {}) {
  const { aw, ah } = res; const N = aw * ah;
  // text boxes at analysis size
  const tbox = new Uint8Array(N); const kx = aw / res.W, ky = ah / res.H;
  for (const t of res.texts) for (let y = Math.floor(t.y0 * ky); y <= Math.ceil(t.y1 * ky); y++) for (let x = Math.floor(t.x0 * kx); x <= Math.ceil(t.x1 * kx); x++) if (x >= 0 && y >= 0 && x < aw && y < ah) tbox[y * aw + x] = 1;
  const out = [];
  for (const m of masks) {
    const frac = m.area / N;
    if (!keepAll && (frac < 0.003 || frac > 0.6)) continue;
    let inText = 0, r = 0, g = 0, b = 0, rr = 0, gg = 0, bb = 0, n = 0;
    for (let q = 0; q < N; q++) {
      if (!m.mask[q]) continue; if (tbox[q]) { inText++; continue; }
      const i = q * 4; const R = small.data[i], G = small.data[i + 1], B = small.data[i + 2]; r += R; g += G; b += B; rr += R * R; gg += G * G; bb += B * B; n++;
    }
    if (!keepAll && inText / m.area > 0.45) continue;
    const [bx0, by0, bx1, by1] = m.bbox; const edges = (bx0 <= 1) + (by0 <= 1) + (bx1 >= aw - 2) + (by1 >= ah - 2);
    if (!keepAll && ((edges >= 2 && frac > 0.12) || edges >= 3)) continue;
    const plainish = (() => { let r = 0, g = 0, b = 0, rr = 0, gg = 0, bb = 0, k = 0; for (let q = 0; q < N; q += 3) if (m.mask[q]) { const i = q * 4; const R = small.data[i], G = small.data[i + 1], B = small.data[i + 2]; r += R; g += G; b += B; rr += R * R; gg += G * G; bb += B * B; k++; } if (!k) return true; r /= k; g /= k; b /= k; return Math.sqrt(Math.max(0, (rr / k - r * r + gg / k - g * g + bb / k - b * b) / 3)) < 28; })();
    if (!keepAll && edges >= 2 && frac > 0.04 && plainish) continue; // a soft corner blob is part of the background
    if (!n) continue;
    r /= n; g /= n; b /= n; const sd = Math.sqrt(Math.max(0, (rr / n - r * r + gg / n - g * g + bb / n - b * b) / 3));
    let on = true, fgShare = null;
    if (res.fg) { let f = 0; for (let q = 0; q < N; q++) if (m.mask[q]) f += res.fg[q] > 128 ? 1 : 0; fgShare = f / m.area; if (!keepAll && fgShare < 0.5) on = false; } // scenery: listed, but off
    else if (res.photo && !keepAll && edges >= 1 && frac > 0.08) on = false; // probably scenery: listed, but off
    const flat = sd < 15 && !isGradient(m, small, aw, tbox) && !(res.photo && frac > 0.02);
    out.push({ ...m, frac, flat, color: toHex({ r, g, b }), sd, on, fgShare });
  }
  // drop pieces of the same photo object (a part mostly inside a bigger photo object)
  out.sort((a, b) => b.area - a.area);
  const kept = [];
  for (const o of out) {
    let drop = false;
    for (const k of kept) {
      if (o.bbox[0] > k.bbox[2] || o.bbox[2] < k.bbox[0] || o.bbox[1] > k.bbox[3] || o.bbox[3] < k.bbox[1]) continue;
      let inter = 0; for (let q = 0; q < N; q++) if (o.mask[q] && k.mask[q]) inter++;
      if (inter / o.area > 0.85 && !k.flat && (!o.flat || o.frac < 0.02)) { drop = true; break; }
    }
    if (!drop || keepAll) kept.push(o);
    if (kept.length >= 18) break;
  }
  // pieces that sit side by side on one line at the same height (the letters of a big word, say) become one object
  let kept2 = keepAll ? kept : mergeRow(kept, aw, ah);
  if (res.fg && !keepAll) kept2 = withSubject(kept2, res.fg, aw, ah, small);
  return kept2.map((o, i) => ({ id: 'o' + Math.random().toString(36).slice(2, 7) + i, kind: o.flat ? 'shape' : 'photo', on: o.on !== false, subject: !!o.subject, mask: o.mask, area: o.area, bbox: o.bbox, color: o.color, flat: o.flat, frac: o.frac }));
}

// ───── outline of a mask → shape (rect, ellipse or path) ─────
function largestComponent(mask, w, h) {
  const lab = new Int32Array(w * h); let best = 0, bestN = 0, cur = 0; const st = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || lab[i]) continue; cur++; let n = 0; st.push(i); lab[i] = cur;
    while (st.length) { const j = st.pop(); n++; const x = j % w, y = (j / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const k = yy * w + xx; if (mask[k] && !lab[k]) { lab[k] = cur; st.push(k); } } }
    if (n > bestN) { bestN = n; best = cur; }
  }
  const out = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) out[i] = lab[i] === best ? 1 : 0; return out;
}
function trace(mask, w, h) { // outer outline: chain the pixel edges between filled and empty, keep the longest loop
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0);
  const next = new Map(); const key = (x, y) => y * (w + 1) + x;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (!at(x, y - 1)) next.set(key(x, y), key(x + 1, y));         // top edge, left → right
    if (!at(x + 1, y)) next.set(key(x + 1, y), key(x + 1, y + 1)); // right edge, down
    if (!at(x, y + 1)) next.set(key(x + 1, y + 1), key(x, y + 1)); // bottom edge, right → left
    if (!at(x - 1, y)) next.set(key(x, y + 1), key(x, y));         // left edge, up
  }
  const seen = new Set(); let best = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue; const loop = []; let k = start, guard = 0;
    while (!seen.has(k) && next.has(k) && guard++ < 4e6) { seen.add(k); loop.push([k % (w + 1), Math.floor(k / (w + 1))]); k = next.get(k); }
    if (loop.length > best.length) best = loop;
  }
  return best;
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts; let dmax = 0, idx = 0; const [a, b] = [pts[0], pts[pts.length - 1]];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  for (let i = 1; i < pts.length - 1; i++) { const p = pts[i]; const d = Math.abs((b[1] - a[1]) * p[0] - (b[0] - a[0]) * p[1] + b[0] * a[1] - b[1] * a[0]) / L; if (d > dmax) { dmax = d; idx = i; } }
  if (dmax > eps) return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
  return [a, b];
}
// A flat piece as a vector: the SAM mask says where it is; its own colour (at full size) says exactly where the edges are
export function shapeOf(o, res, img) {
  const { aw, ah, W, H } = res; const kx = W / aw, ky = H / ah;
  const lm = largestComponent(o.mask, aw, ah); let bx0 = aw, by0 = ah, bx1 = -1, by1 = -1;
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) if (lm[y * aw + x]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  // full-res crop (at most ~900 px on its long side, so tracing stays quick)
  const pad = 2; const X0 = Math.max(0, Math.floor((bx0 - pad) * kx)), Y0 = Math.max(0, Math.floor((by0 - pad) * ky)), X1 = Math.min(W, Math.ceil((bx1 + 1 + pad) * kx)), Y1 = Math.min(H, Math.ceil((by1 + 1 + pad) * ky));
  const f = Math.min(1, 900 / Math.max(X1 - X0, Y1 - Y0)); const cw = Math.max(2, Math.round((X1 - X0) * f)), ch = Math.max(2, Math.round((Y1 - Y0) * f));
  const col = hexRgb(o.color); const m = new Uint8Array(cw * ch); const near = dilate(lm, aw, ah, 1);
  let tol = 0; { // colour tolerance from the piece's own spread
    let sum = 0, n = 0; for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) if (lm[y * aw + x]) { const i = (y * aw + x) * 4; sum += Math.sqrt(d2([res.small.data[i], res.small.data[i + 1], res.small.data[i + 2]], col)); n++; }
    tol = Math.max(18, Math.min(60, (sum / Math.max(1, n)) * 2.5 + 14));
    // …but never so loose that the colour just outside counts too (low-contrast cards on a dark page)
    const ring = dilate(lm, aw, ah, 3); let rr = 0, rg = 0, rb = 0, rn = 0;
    for (let q = 0; q < ring.length; q++) if (ring[q] && !near[q]) { const i = q * 4; rr += res.small.data[i]; rg += res.small.data[i + 1]; rb += res.small.data[i + 2]; rn++; }
    if (rn) { const sep = Math.sqrt(d2([rr / rn, rg / rn, rb / rn], col)); tol = Math.max(5, Math.min(tol, sep * 0.55)); } }
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const X = Math.min(W - 1, Math.floor(X0 + (x + 0.5) / f)), Y = Math.min(H - 1, Math.floor(Y0 + (y + 0.5) / f));
    if (!near[Math.min(ah - 1, Math.floor(Y / ky)) * aw + Math.min(aw - 1, Math.floor(X / kx))]) continue;
    const i = (Y * W + X) * 4; if (Math.sqrt(d2([img.data[i], img.data[i + 1], img.data[i + 2]], col)) < tol) m[y * cw + x] = 1;
  }
  const mm = closeHoles(largestComponent(m, cw, ch), cw, ch);
  let x0 = cw, y0 = ch, x1 = -1, y1 = -1, n = 0; for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (mm[y * cw + x]) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { type: 'rect', x: bx0 * kx, y: by0 * ky, w: (bx1 - bx0 + 1) * kx, h: (by1 - by0 + 1) * ky };
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1; const box = { x: X0 + x0 / f, y: Y0 + y0 / f, w: bw / f, h: bh / f };
  const fill = n / (bw * bh);
  if (fill > 0.88) { // a rectangle: are its four corners cut round? (judge each corner, small radii barely change the fill)
    const cr = Math.max(2, Math.round(Math.min(bw, bh) * 0.32)); const per = [];
    for (const [cx0, cy0, ex, ey] of [[x0, y0, x0, y0], [x1 - cr + 1, y0, x1, y0], [x0, y1 - cr + 1, x0, y1], [x1 - cr + 1, y1 - cr + 1, x1, y1]]) {
      let e = 0; for (let y = cy0; y < cy0 + cr; y++) for (let x = cx0; x < cx0 + cr; x++) if (!mm[y * cw + x]) e++; per.push({ e, tip: !mm[ey * cw + ex] }); }
    const empty = bw * bh - n, corners = per.reduce((t, c) => t + c.e, 0);
    if (per.every((c) => c.tip && c.e >= 3) && corners > empty * 0.5) { const r = Math.sqrt(corners / 4 / (1 - Math.PI / 4)); return { type: 'rect', rx: Math.min(r / f, box.w / 2, box.h / 2), ...box }; }
    if (fill > 0.975) return { type: 'rect', ...box };
  }
  let inE = 0, uni = 0; const cx = x0 + bw / 2, cy = y0 + bh / 2;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const e = ((x + 0.5 - cx) / (bw / 2)) ** 2 + ((y + 0.5 - cy) / (bh / 2)) ** 2 <= 1; const v = mm[y * cw + x]; if (e && v) inE++; if (e || v) uni++; }
  if (inE / uni > 0.96) return { type: 'ellipse', ...box };
  const pts = rdp(smooth(trace(mm, cw, ch), 2), 0.9);
  const d = 'M' + pts.map(([x, y]) => `${(X0 + x / f).toFixed(1)} ${(Y0 + y / f).toFixed(1)}`).join(' L') + ' Z';
  return { type: 'path', d, ...box };
}
function hexRgb(h) { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
function smooth(pts, r) { const n = pts.length; if (n < 8) return pts; const o = []; for (let i = 0; i < n; i++) { let sx = 0, sy = 0; for (let k = -r; k <= r; k++) { const p = pts[(i + k + n) % n]; sx += p[0]; sy += p[1]; } o.push([sx / (2 * r + 1), sy / (2 * r + 1)]); } return o; }
function closeHoles(m, w, h) { // fill small enclosed gaps (anti-aliased text sitting on a shape, say); keep real cut-outs
  let n = 0; for (let q = 0; q < m.length; q++) n += m[q];
  const lab = new Int32Array(w * h); const r = Uint8Array.from(m); let cur = 0; const st = [];
  for (let i = 0; i < w * h; i++) {
    if (m[i] || lab[i]) continue; cur++; const comp = []; let edge = false; st.push(i); lab[i] = cur;
    while (st.length) { const q = st.pop(); comp.push(q); const x = q % w, y = (q / w) | 0; if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      for (const k of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1]) if (k >= 0 && !m[k] && !lab[k]) { lab[k] = cur; st.push(k); } }
    if (!edge && comp.length < n * 0.06) for (const q of comp) r[q] = 1;
  }
  return r;
}


// ───── build the layers ─────
function dilate(m, w, h, r) {
  if (r < 1) return m; const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { let last = -1e9; for (let x = 0; x < w; x++) { if (m[y * w + x]) last = x; t[y * w + x] = x - last <= r; } last = 1e9; for (let x = w - 1; x >= 0; x--) { if (m[y * w + x]) last = x; if (last - x <= r) t[y * w + x] = 1; } }
  for (let x = 0; x < w; x++) { let last = -1e9; for (let y = 0; y < h; y++) { if (t[y * w + x]) last = y; o[y * w + x] = y - last <= r; } last = 1e9; for (let y = h - 1; y >= 0; y--) { if (t[y * w + x]) last = y; if (last - y <= r) o[y * w + x] = 1; } }
  return o;
}
function upMask(m, aw, ah, W, H) { // nearest-neighbour upscale of a 0/1 mask
  const out = new Uint8Array(W * H); const kx = aw / W, ky = ah / H;
  for (let y = 0; y < H; y++) { const sy = Math.min(ah - 1, Math.floor(y * ky)) * aw; for (let x = 0; x < W; x++) out[y * W + x] = m[sy + Math.min(aw - 1, Math.floor(x * kx))]; }
  return out;
}
const toUrl = (c, type = 'image/png', q) => new Promise((r) => c.toBlob((b) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }, type, q));

// choices: { texts: [...items with on/text], objects: [...], rebuild: bool }. Returns everything in full-size pixels.
export async function build(img, res, { texts, objects, rebuild = true }, { onProgress = () => {} } = {}) {
  const { W, H, aw, ah } = res; const out = { W, H, layers: [] };
  const useT = texts.filter((t) => t.on && t.text.trim()), useO = objects.filter((o) => o.on);
  // the holes to fill: chosen objects (grown a little) + the ink of chosen text
  const hole = new Uint8Array(W * H); const grow = Math.max(2, Math.round(Math.max(W, H) / 400));
  for (const o of useO) { const up = upMask(dilate(o.mask, aw, ah, 1), aw, ah, W, H); for (let i = 0; i < hole.length; i++) if (up[i]) hole[i] = 1; }
  if (useT.length) {
    const tm = new Uint8Array(W * H);
    for (const t of useT) { const pad = Math.round((t.y1 - t.y0) * 0.15); for (let y = Math.max(0, t.y0 - pad); y < Math.min(H, t.y1 + pad); y++) for (let x = Math.max(0, t.x0 - pad); x < Math.min(W, t.x1 + pad); x++) if (res.textMask[y * W + x]) tm[y * W + x] = 1; }
    const td = dilate(tm, W, H, grow); for (let i = 0; i < hole.length; i++) if (td[i]) hole[i] = 1;
  }
  if (window.__lzDebug) { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); const id = x.createImageData(W, H); for (let i = 0; i < hole.length; i++) { const v = hole[i] ? 255 : res.textMask[i] ? 120 : 0; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; } x.putImageData(id, 0, 0); window.__lzHole = c.toDataURL(); }
  let bgData = img.data;
  if (rebuild && hole.some((v) => v)) {
    onProgress('Rebuilding the background…');
    // group the holes into parts (connected areas, found on a coarse grid) so each gets its own sharp crop
    const g = 8, gw = Math.ceil(W / g), gh = Math.ceil(H / g); const coarse = new Uint8Array(gw * gh);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hole[y * W + x]) coarse[((y / g) | 0) * gw + ((x / g) | 0)] = 1;
    const cd = dilate(coarse, gw, gh, 2); const lab = new Int32Array(gw * gh); let cur = 0; const boxes = [];
    for (let i = 0; i < gw * gh; i++) {
      if (!cd[i] || lab[i]) continue; cur++; const st = [i]; lab[i] = cur; let bx0 = gw, by0 = gh, bx1 = 0, by1 = 0;
      while (st.length) { const j = st.pop(); const x = j % gw, y = (j / gw) | 0; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue; const k = yy * gw + xx; if (cd[k] && !lab[k]) { lab[k] = cur; st.push(k); } } }
      boxes.push([bx0 * g, by0 * g, Math.min(W, (bx1 + 1) * g), Math.min(H, (by1 + 1) * g)]);
    }
    const near = Math.max(W, H) * 0.04, cap = Math.max(W, H) * 0.28;
    for (let changed = true; changed;) { changed = false;
      for (let i = 0; i < boxes.length && !changed; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j];
        if (a[0] - near > b[2] || b[0] - near > a[2] || a[1] - near > b[3] || b[1] - near > a[3]) continue;
        const u = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; if (u[2] - u[0] > cap || u[3] - u[1] > cap) continue;
        boxes[i] = u; boxes.splice(j, 1); changed = true; break; } }
    const parts = boxes.map(([x0, y0, x1, y1]) => { const w = x1 - x0, hh = y1 - y0; const m = new Uint8Array(w * hh); for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) m[y * w + x] = hole[(y + y0) * W + x + x0]; return { x: x0, y: y0, w, h: hh, m }; }).filter((p) => p.m.some((v) => v));
    parts.sort((a, b) => a.w * a.h - b.w * b.h); // small ones first, so big fills see clean surroundings
    const r = await call('inpaintParts', { img: { data: new Uint8ClampedArray(img.data), w: W, h: H }, parts }, { onProgress: (p) => p?.text && onProgress(p.text) });
    bgData = new Uint8ClampedArray(r.data);
  }
  const bgc = document.createElement('canvas'); bgc.width = W; bgc.height = H; bgc.getContext('2d').putImageData(new ImageData(bgData instanceof Uint8ClampedArray ? bgData : new Uint8ClampedArray(bgData), W, H), 0, 0);
  out.background = await toUrl(bgc, 'image/jpeg', 0.95);
  // objects, biggest first (so they stack behind smaller ones)
  const src = document.createElement('canvas'); src.width = W; src.height = H; src.getContext('2d').putImageData(img, 0, 0);
  const sorted = useO.slice().sort((a, b) => b.area - a.area);
  for (const [i, o] of sorted.entries()) {
    onProgress(`Making layers… ${i + 1} of ${sorted.length}`);
    if (o.kind === 'shape') { out.layers.push({ kind: 'shape', color: o.color, ...shapeOf(o, res, img) }); continue; }
    const kx = W / aw, ky = H / ah; const pad = Math.max(3, Math.round(Math.max(W, H) / 200));
    const x0 = Math.max(0, Math.floor(o.bbox[0] * kx) - pad), y0 = Math.max(0, Math.floor(o.bbox[1] * ky) - pad), x1 = Math.min(W, Math.ceil((o.bbox[2] + 1) * kx) + pad), y1 = Math.min(H, Math.ceil((o.bbox[3] + 1) * ky) + pad);
    const w = x1 - x0, hh = y1 - y0; const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d');
    x.drawImage(src, -x0, -y0); const id = x.getImageData(0, 0, w, hh);
    // the mask at full size for just this crop (bilinear from the analysis grid), then edge-refined on the crop only
    const cm = new Uint8Array(w * hh); for (let yy = 0; yy < hh; yy++) { const sy = Math.min(ah - 1, Math.max(0, ((yy + y0 + 0.5) / ky) - 0.5)); const y_ = Math.floor(sy), fy = sy - y_, y2 = Math.min(ah - 1, y_ + 1);
      for (let xx = 0; xx < w; xx++) { const sx = Math.min(aw - 1, Math.max(0, ((xx + x0 + 0.5) / kx) - 0.5)); const x_ = Math.floor(sx), fx = sx - x_, x2 = Math.min(aw - 1, x_ + 1);
        const v = (o.mask[y_ * aw + x_] * (1 - fx) + o.mask[y_ * aw + x2] * fx) * (1 - fy) + (o.mask[y2 * aw + x_] * (1 - fx) + o.mask[y2 * aw + x2] * fx) * fy; cm[yy * w + xx] = Math.round(v * 255); } }
    const { alpha } = await call('refineMask', { img: { data: new Uint8ClampedArray(id.data), w, h: hh }, mask: cm, aw: w, ah: hh, soft: true, radius: Math.max(2, Math.round(kx * 1.6)) });
    for (let q = 0; q < w * hh; q++) id.data[q * 4 + 3] = alpha[q];
    // text sitting on the object goes too (it becomes its own layer)
    if (useT.length) for (let yy = 0; yy < hh; yy++) for (let xx = 0; xx < w; xx++) if (res.textMask[(yy + y0) * W + xx + x0] && useT.some((t) => xx + x0 >= t.x0 && xx + x0 <= t.x1 && yy + y0 >= t.y0 && yy + y0 <= t.y1)) id.data[(yy * w + xx) * 4 + 3] = 0;
    x.putImageData(id, 0, 0);
    out.layers.push({ kind: 'photo', dataUrl: await toUrl(c), x: x0, y: y0, w, h: hh, name: o.subject ? 'Subject' : 'Object' });
  }
  for (const t of useT) out.layers.push({ ...t, kind: 'text' });
  return out;
}
