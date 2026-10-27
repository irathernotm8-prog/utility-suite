// RO2's AI, off the UI thread. onnxruntime-web runs each model on the GPU (WebGPU) when it can, else on every CPU core (WASM).
//   removebg  ORMBG / IS-Net → an alpha matte, refined at full size with a guided filter
//   sam       SlimSAM: embed once per picture, then decode clicks into object masks
//   inpaint   LaMa on a crop around the hole, blended back with a feathered edge
//   expand    LaMa fills new canvas around a picture (outpainting)
import * as ort from '../../vendor/ort/ort.webgpu.bundle.min.mjs';

ort.env.wasm.wasmPaths = new URL('../../vendor/ort/', import.meta.url).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)) : 1;
ort.env.logLevel = 'error';
const FORCE_CPU = new URL(self.location.href).searchParams.get('cpu') === '1';
const MODEL = (id, file) => `ro2://models/${id}/${file}`;
const sessions = new Map(); // key → { s, ep }
let gpuOk = null;

async function hasGpu() {
  if (gpuOk !== null) return gpuOk;
  try { gpuOk = !FORCE_CPU && !!navigator.gpu && !!(await navigator.gpu.requestAdapter()); } catch { gpuOk = false; }
  return gpuOk;
}
async function session(id, file, { cpuOnly = false } = {}) {
  const key = `${id}/${file}`;
  if (sessions.has(key)) return sessions.get(key);
  const gpu = !cpuOnly && (await hasGpu());
  progress(`Loading the ${id === 'lama' ? 'eraser' : id === 'slimsam' ? 'selection' : 'cut-out'} model${gpu ? ' on the GPU' : ''}…`);
  let s, ep;
  try {
    if (!gpu) throw new Error('no gpu');
    s = await ort.InferenceSession.create(MODEL(id, file), { executionProviders: ['webgpu', 'wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 }); ep = 'gpu';
  } catch (e) {
    s = await ort.InferenceSession.create(MODEL(id, file), { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 }); ep = 'cpu';
  }
  const v = { s, ep, key };
  sessions.set(key, v);
  return v;
}
// Run, and if the GPU path fails, rebuild the model on the CPU and try once more
async function run(id, file, feeds, opts = {}) {
  let ses = await session(id, file, opts);
  try { return await ses.s.run(feeds); } catch (e) {
    if (ses.ep !== 'gpu') throw e;
    sessions.delete(ses.key); try { ses.s.release(); } catch {}
    ses = await session(id, file, { cpuOnly: true });
    return await ses.s.run(feeds);
  }
}
let curId = null;
const progress = (text, p) => postMessage({ id: curId, progress: { text, p } });

// ───── pixels ─────
function canvas(w, h) { const c = new OffscreenCanvas(w, h); return [c, c.getContext('2d', { willReadFrequently: true })]; }
function imageDataOf(img) { return new ImageData(new Uint8ClampedArray(img.data), img.w, img.h); }
function resizeRGBA(img, w, h, sx = 0, sy = 0, sw = img.w, sh = img.h) {
  const [c0, x0] = canvas(img.w, img.h); x0.putImageData(imageDataOf(img), 0, 0);
  const [c1, x1] = canvas(w, h); x1.imageSmoothingQuality = 'high'; x1.drawImage(c0, sx, sy, sw, sh, 0, 0, w, h);
  return x1.getImageData(0, 0, w, h).data;
}
// Scale a one-channel 0..255 map with bilinear filtering
function resizeGray(src, sw, sh, w, h, region) {
  const [c0, x0] = canvas(sw, sh); const id = x0.createImageData(sw, sh);
  for (let i = 0; i < sw * sh; i++) { const v = src[i]; id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
  x0.putImageData(id, 0, 0);
  const [c1, x1] = canvas(w, h); x1.imageSmoothingQuality = 'high';
  if (region) x1.drawImage(c0, region[0], region[1], region[2], region[3], 0, 0, w, h); else x1.drawImage(c0, 0, 0, w, h);
  const d = x1.getImageData(0, 0, w, h).data; const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = d[i * 4];
  return out;
}
function toCHW(rgba, n, { mean = [0, 0, 0], std = [1, 1, 1], scale = 1 / 255, mask } = {}) {
  const t = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const keep = mask ? 1 - mask[i] : 1;
    t[i] = ((rgba[i * 4] * scale - mean[0]) / std[0]) * keep; t[n + i] = ((rgba[i * 4 + 1] * scale - mean[1]) / std[1]) * keep; t[2 * n + i] = ((rgba[i * 4 + 2] * scale - mean[2]) / std[2]) * keep;
  }
  return t;
}
// box mean over radius r (separable, O(n)) on a Float32 map
// LaMa's fill can sit a shade off the surrounding colour (most visible on gradients). Measure how far its output is
// from the real picture on a ring around the hole, spread that difference smoothly over the hole, and take it out.
function colourMatch(back, orig, W, rx, ry, rw, rh, hole) {
  // the seam: the real picture just outside the hole vs. LaMa's fill just inside it, both averaged smoothly
  const n = rw * rh; const r0 = Math.max(3, Math.round(Math.max(rw, rh) / 120));
  const grown = dilateU8(hole, rw, rh, r0); const inv = new Uint8Array(n); for (let q = 0; q < n; q++) inv[q] = hole[q] ? 0 : 1;
  const inside = dilateU8(inv, rw, rh, r0); const outer = new Float32Array(n), inner = new Float32Array(n);
  for (let q = 0; q < n; q++) { if (grown[q] && !hole[q]) outer[q] = 1; if (hole[q] && inside[q]) inner[q] = 1; }
  const R = Math.max(8, Math.round(Math.max(rw, rh) / 12)); const wo = boxMean(outer, rw, rh, R), wi = boxMean(inner, rw, rh, R);
  for (let c = 0; c < 3; c++) {
    const o = new Float32Array(n), i = new Float32Array(n);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { const q = y * rw + x; if (outer[q]) o[q] = orig[((y + ry) * W + x + rx) * 4 + c]; if (inner[q]) i[q] = back[q * 4 + c]; }
    const so = boxMean(o, rw, rh, R), si = boxMean(i, rw, rh, R);
    for (let q = 0; q < n; q++) if (hole[q] && wo[q] > 1e-3 && wi[q] > 1e-3) back[q * 4 + c] = Math.max(0, Math.min(255, back[q * 4 + c] + so[q] / wo[q] - si[q] / wi[q]));
  }
}
function dilateU8(m, w, h, r) { const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { let last = -1e9; for (let x = 0; x < w; x++) { if (m[y * w + x]) last = x; t[y * w + x] = x - last <= r ? 1 : 0; } last = 1e9; for (let x = w - 1; x >= 0; x--) { if (m[y * w + x]) last = x; if (last - x <= r) t[y * w + x] = 1; } }
  for (let x = 0; x < w; x++) { let last = -1e9; for (let y = 0; y < h; y++) { if (t[y * w + x]) last = y; o[y * w + x] = y - last <= r ? 1 : 0; } last = 1e9; for (let y = h - 1; y >= 0; y--) { if (t[y * w + x]) last = y; if (last - y <= r) o[y * w + x] = 1; } }
  return o; }
function boxMean(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[row + x] = acc / (2 * r + 1); acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = acc / (2 * r + 1); acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
  }
  return out;
}
// Guided filter (He et al.): snaps a soft matte to the picture's real edges (hair, fur, fine outlines)
function guided(rgba, alpha, w, h, r, eps) {
  const n = w * h; const I = new Float32Array(n), p = new Float32Array(n);
  for (let i = 0; i < n; i++) { I[i] = (rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114) / 255; p[i] = alpha[i] / 255; }
  const mI = boxMean(I, w, h, r), mp = boxMean(p, w, h, r);
  const Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mIp = boxMean(Ip, w, h, r), mII = boxMean(II, w, h, r);
  const a = Ip, b = II; // reuse
  for (let i = 0; i < n; i++) { const cov = mIp[i] - mI[i] * mp[i], v = mII[i] - mI[i] * mI[i]; a[i] = cov / (v + eps); b[i] = mp[i] - a[i] * mI[i]; }
  const ma = boxMean(a, w, h, r), mb = boxMean(b, w, h, r);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const q = ma[i] * I[i] + mb[i]; const o = alpha[i] / 255; const v = o > 0.97 || o < 0.03 ? o * 0.6 + q * 0.4 : q; out[i] = Math.max(0, Math.min(255, Math.round(v * 255))); }
  return out;
}
function dilate(mask, w, h, r) { // square max filter, separable
  if (r <= 0) return mask;
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { const row = y * w; let last = -1e9; for (let x = 0; x < w; x++) { if (mask[row + x]) last = x; tmp[row + x] = x - last <= r ? 1 : 0; } last = 1e9; for (let x = w - 1; x >= 0; x--) { if (mask[row + x]) last = x; if (last - x <= r) tmp[row + x] = 1; } }
  for (let x = 0; x < w; x++) { let last = -1e9; for (let y = 0; y < h; y++) { if (tmp[y * w + x]) last = y; out[y * w + x] = y - last <= r ? 1 : 0; } last = 1e9; for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) last = y; if (last - y <= r) out[y * w + x] = 1; } }
  return out;
}
function feather(mask01, w, h, r) { // soft edge: box blur of a 0/1 mask → 0..1
  const f = new Float32Array(w * h); for (let i = 0; i < w * h; i++) f[i] = mask01[i];
  if (r < 1) return f; return boxMean(boxMean(f, w, h, Math.max(1, r >> 1)), w, h, Math.max(1, r >> 1));
}

// ───── background removal ─────
async function removebg({ model = 'ormbg', img, refine = true }) {
  const S = 1024, n = S * S;
  progress('Finding the subject…');
  const small = resizeRGBA(img, S, S);
  const x = toCHW(small, n, model === 'isnet' ? { mean: [0.5, 0.5, 0.5] } : {});
  const out = await run(model, 'model.onnx', { [(await session(model, 'model.onnx')).s.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, S, S]) });
  const t = out[Object.keys(out)[0]].data;
  let mn = Infinity, mx = -Infinity; for (let i = 0; i < n; i++) { const v = t[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const a8 = new Uint8Array(n); const k = 255 / Math.max(1e-6, mx - mn);
  for (let i = 0; i < n; i++) a8[i] = Math.round((t[i] - mn) * k);
  progress('Refining the edges…');
  let alpha = resizeGray(a8, S, S, img.w, img.h);
  if (refine && img.w * img.h <= 24e6) {
    const r = Math.max(2, Math.round(Math.max(img.w, img.h) / 700));
    alpha = guided(img.data, alpha, img.w, img.h, r, 1e-4);
  }
  return { alpha };
}

// ───── segment anything ─────
const SAM_MEAN = [0.485, 0.456, 0.406], SAM_STD = [0.229, 0.224, 0.225];
let samCache = null; // { key, emb, pos, w, h, s }
async function samEmbed({ key, img }) {
  if (samCache && samCache.key === key) return { ok: true, cached: true };
  progress('Looking at the picture…');
  const s = 1024 / Math.max(img.w, img.h), nw = Math.round(img.w * s), nh = Math.round(img.h * s);
  const rs = resizeRGBA(img, nw, nh); const n = 1024 * 1024; const t = new Float32Array(3 * n);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const i = y * nw + x, j = y * 1024 + x;
    for (let c = 0; c < 3; c++) t[c * n + j] = (rs[i * 4 + c] / 255 - SAM_MEAN[c]) / SAM_STD[c];
  }
  const out = await run('slimsam', 'encoder.onnx', { pixel_values: new ort.Tensor('float32', t, [1, 3, 1024, 1024]) });
  samCache = { key, emb: out.image_embeddings, pos: out.image_positional_embeddings, w: img.w, h: img.h, s, nw, nh };
  return { ok: true };
}
async function samDecode({ key, points }) {
  if (!samCache || samCache.key !== key) throw new Error('The picture changed; select again.');
  const { s, w, h, nw, nh } = samCache;
  const pts = new Float32Array(points.length * 2), labels = new BigInt64Array(points.length);
  points.forEach((p, i) => { pts[i * 2] = p.x * s; pts[i * 2 + 1] = p.y * s; labels[i] = BigInt(p.label ? 1 : 0); });
  const out = await run('slimsam', 'decoder.onnx', {
    input_points: new ort.Tensor('float32', pts, [1, 1, points.length, 2]), input_labels: new ort.Tensor('int64', labels, [1, 1, points.length]),
    image_embeddings: samCache.emb, image_positional_embeddings: samCache.pos,
  });
  const iou = Array.from(out.iou_scores.data); const m = out.pred_masks.data; const L = 256 * 256;
  const masks = [];
  for (let k = 0; k < 3; k++) {
    const g = new Uint8Array(L); for (let i = 0; i < L; i++) g[i] = 255 / (1 + Math.exp(-m[k * L + i]));
    // the 256×256 output covers the padded 1024 square; crop to the picture, scale to full size
    const full = resizeGray(g, 256, 256, w, h, [0, 0, (nw / 1024) * 256, (nh / 1024) * 256]);
    let area = 0; for (let i = 0; i < full.length; i++) { full[i] = full[i] > 127 ? 255 : 0; if (full[i]) area++; }
    masks.push({ mask: full, iou: iou[k], area });
  }
  return { masks };
}

// ───── inpainting (LaMa) ─────
// img: {data,w,h} RGBA; hole: Uint8Array w*h (nonzero = remove). Returns new RGBA.
async function lama512(rgba512, hole512) {
  const n = 512 * 512;
  const x = toCHW(rgba512, n, { mask: hole512 });
  const out = await run('lama', 'model.onnx', { image: new ort.Tensor('float32', x, [1, 3, 512, 512]), mask: new ort.Tensor('float32', Float32Array.from(hole512), [1, 1, 512, 512]) });
  return out[Object.keys(out)[0]].data; // CHW 0..255
}
function bbox(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}
async function inpaint({ img, hole, grow = 1 }) {
  const { w, h } = img; const b = bbox(hole, w, h);
  if (!b) return { data: img.data };
  const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
  // a crop around the hole with plenty of context, as square as the picture allows
  let side = Math.round(Math.max(bw, bh) * 1.9 + 96);
  side = Math.max(side, Math.min(512, Math.max(w, h)));
  let rw = Math.min(w, side), rh = Math.min(h, side);
  let rx = Math.round((b.x0 + b.x1) / 2 - rw / 2), ry = Math.round((b.y0 + b.y1) / 2 - rh / 2);
  rx = Math.max(0, Math.min(w - rw, rx)); ry = Math.max(0, Math.min(h - rh, ry));
  if (bw > rw || bh > rh) { rx = 0; ry = 0; rw = w; rh = h; }
  // grow the hole a little so the edge of the object (and its halo) goes too
  const k = Math.max(rw, rh) / 512;
  const dil = Math.max(2, Math.round((4 + 4 * grow) * Math.max(1, k)));
  const holeD = dilate(hole, w, h, dil);
  progress('Erasing…');
  const crop = resizeRGBA(img, 512, 512, rx, ry, rw, rh);
  const hcrop = new Uint8Array(rw * rh); for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) hcrop[y * rw + x] = holeD[(y + ry) * w + x + rx] ? 255 : 0;
  const h512 = resizeGray(hcrop, rw, rh, 512, 512); for (let i = 0; i < h512.length; i++) h512[i] = h512[i] > 20 ? 1 : 0;
  const res = await lama512(crop, h512);
  // back to the crop's size
  const [c, x] = canvas(512, 512); const id = x.createImageData(512, 512); const N = 512 * 512;
  for (let i = 0; i < N; i++) { id.data[i * 4] = res[i]; id.data[i * 4 + 1] = res[N + i]; id.data[i * 4 + 2] = res[2 * N + i]; id.data[i * 4 + 3] = 255; }
  x.putImageData(id, 0, 0);
  const [c2, x2] = canvas(rw, rh); x2.imageSmoothingQuality = 'high'; x2.drawImage(c, 0, 0, rw, rh);
  const back = x2.getImageData(0, 0, rw, rh).data;
  colourMatch(back, img.data, w, rx, ry, rw, rh, hcrop);
  // blend into the original with a soft edge, only where the (grown) hole is
  const soft = feather(hcrop.map((v) => (v ? 1 : 0)), rw, rh, Math.max(2, Math.round(k * 3)));
  const out = new Uint8ClampedArray(img.data);
  for (let y = 0; y < rh; y++) for (let xx = 0; xx < rw; xx++) {
    const j = y * rw + xx; let a = soft[j]; if (hcrop[j]) a = Math.max(a, 0.999); if (a <= 0.001) continue;
    const i = ((y + ry) * w + xx + rx) * 4;
    out[i] = out[i] * (1 - a) + back[j * 4] * a; out[i + 1] = out[i + 1] * (1 - a) + back[j * 4 + 1] * a; out[i + 2] = out[i + 2] * (1 - a) + back[j * 4 + 2] * a;
    if (out[i + 3] < 255 && a > 0.5) out[i + 3] = 255;
  }
  return { data: out };
}
// Outpainting (Magic expand). LaMa smears big edge-touching holes into grey, so RO2 grows the picture a thin band
// at a time: each pass shows LaMa [mirrored edge | new band | real picture] so the band is a hole *inside* the window.
// Width first, then height (by transposing). Work happens at 512 px across the band direction; the original is
// pasted back sharp on top with a soft seam.
function transpose(c) { const t = new OffscreenCanvas(c.height, c.width); const x = t.getContext('2d'); x.setTransform(0, 1, 1, 0, 0, 0); x.drawImage(c, 0, 0); return t; }
const VARIANTS = [[24, 48], [16, 40], [32, 56], [12, 32]];
async function growSideways(src, NW, ox, label, variant = 0) {
  const w = src.width, hh = src.height; if (NW <= w) return src;
  const s = Math.min(1, 512 / hh); const hk = Math.max(8, Math.round(hh * s)), wk = Math.max(8, Math.round(NW * s));
  const ok = Math.round(ox * s), ik = Math.max(1, Math.round(w * s));
  const [work, xw] = canvas(wk, hk); xw.imageSmoothingQuality = 'high'; xw.drawImage(src, ok, 0, ik, hk);
  const ww = Math.min(512, wk); const k = hk / 512;
  const [vl, vb] = VARIANTS[variant % VARIANTS.length];
  const B = Math.max(4, Math.round(vb * k)), L = Math.max(2, Math.round(vl * k));
  const total = Math.ceil(ok / B) + Math.ceil((wk - ok - ik) / B); let done = 0;
  const pass = async (kind, at) => { // kind 'left': fill [at-b, at); 'right': fill [at, at+b)
    const b = kind === 'left' ? Math.min(B, at) : Math.min(B, wk - at);
    const R = Math.max(1, ww - L - B);
    const [win, xx] = canvas(ww, hk);
    if (kind === 'left') {
      xx.drawImage(work, at, 0, Math.min(R, wk - at), hk, L + B, 0, Math.min(R, wk - at), hk);
      xx.save(); xx.translate(L, 0); xx.scale(-1, 1); xx.drawImage(work, at, 0, L, hk, 0, 0, L, hk); xx.restore();
    } else {
      const r0 = Math.max(0, at - R); xx.drawImage(work, r0, 0, at - r0, hk, R - (at - r0), 0, at - r0, hk);
      xx.save(); xx.translate(R + B + L, 0); xx.scale(-1, 1); xx.drawImage(work, at - L, 0, L, hk, 0, 0, L, hk); xx.restore();
    }
    const hx0 = kind === 'left' ? L : R;
    const [i5, x5] = canvas(512, 512); x5.imageSmoothingQuality = 'high'; x5.drawImage(win, 0, 0, 512, 512);
    const rgba = x5.getImageData(0, 0, 512, 512).data;
    const hole = new Uint8Array(512 * 512); const h0 = Math.floor((hx0 / ww) * 512), h1 = Math.ceil(((hx0 + B) / ww) * 512);
    for (let y = 0; y < 512; y++) for (let x = h0; x < h1; x++) hole[y * 512 + x] = 1;
    const res = await lama512(rgba, hole);
    const id = x5.createImageData(512, 512); const N = 512 * 512;
    for (let q = 0; q < N; q++) { id.data[q * 4] = res[q]; id.data[q * 4 + 1] = res[N + q]; id.data[q * 4 + 2] = res[2 * N + q]; id.data[q * 4 + 3] = 255; }
    x5.putImageData(id, 0, 0);
    const [back, xb] = canvas(ww, hk); xb.imageSmoothingQuality = 'high'; xb.drawImage(i5, 0, 0, ww, hk);
    if (kind === 'left') xw.drawImage(back, hx0 + B - b, 0, b, hk, at - b, 0, b, hk);
    else xw.drawImage(back, hx0, 0, b, hk, at, 0, b, hk);
    done++; progress(`${label}… ${Math.round((done / Math.max(1, total)) * 100)}%`);
    return b;
  };
  for (let kl = ok; kl > 0;) kl -= await pass('left', kl);
  for (let kr = ok + ik; kr < wk;) kr += await pass('right', kr);
  // full size: painted canvas scaled up, the source pasted back sharp with a soft seam where it meets new space
  const [out, xo] = canvas(NW, hh); xo.imageSmoothingQuality = 'high'; xo.drawImage(work, 0, 0, NW, hh);
  const fe = Math.max(3, Math.round(Math.min(w, hh) * 0.012));
  const [m, xm] = canvas(w, hh); xm.drawImage(src, 0, 0); xm.globalCompositeOperation = 'destination-in';
  const g = new OffscreenCanvas(w, hh); const gx = g.getContext('2d'); gx.fillStyle = '#fff'; gx.filter = `blur(${fe / 2}px)`;
  const l = ox > 0 ? fe : -fe * 2, r = ox + w < NW ? fe : -fe * 2; gx.fillRect(l, -fe * 2, w - l - r, hh + fe * 4);
  xm.drawImage(g, 0, 0); xm.globalCompositeOperation = 'source-over';
  xo.drawImage(m, ox, 0);
  return out;
}
async function expand({ img, W, H, ox, oy, variant = 0 }) {
  progress('Imagining what is beyond the edges…');
  const [ci, xi] = canvas(img.w, img.h); xi.putImageData(imageDataOf(img), 0, 0);
  let c = await growSideways(ci, W, ox, 'Widening', variant);
  if (H > img.h) c = transpose(await growSideways(transpose(c), H, oy, 'Making it taller', variant));
  const x = c.getContext('2d');
  return { data: x.getImageData(0, 0, W, H).data, w: W, h: H };
}

// ───── Make editable: every object in the picture (SAM on a grid of points), at a small analysis size ─────
async function samAuto({ key, aw, ah, grid = 8, extra = [] }) {
  if (!samCache || samCache.key !== key) throw new Error('The picture changed; start again.');
  const { s, w, h, nw, nh } = samCache; const L = 256 * 256; const out = [];
  const pts = []; for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++) pts.push({ x: ((gx + 0.5) / grid) * w, y: ((gy + 0.5) / grid) * h });
  for (const p of extra) pts.push(p);
  let i = 0;
  for (const p of pts) {
    i++; if (i % 4 === 0) progress(`Finding objects… ${Math.round((i / pts.length) * 100)}%`);
    const r = await run('slimsam', 'decoder.onnx', {
      input_points: new ort.Tensor('float32', new Float32Array([p.x * s, p.y * s]), [1, 1, 1, 2]), input_labels: new ort.Tensor('int64', new BigInt64Array([1n]), [1, 1, 1]),
      image_embeddings: samCache.emb, image_positional_embeddings: samCache.pos,
    });
    const iou = Array.from(r.iou_scores.data); const m = r.pred_masks.data;
    for (let k = 0; k < 3; k++) {
      if (iou[k] < 0.8) continue;
      const g = new Uint8Array(L); for (let q = 0; q < L; q++) g[q] = 255 / (1 + Math.exp(-m[k * L + q]));
      const small = resizeGray(g, 256, 256, aw, ah, [0, 0, (nw / 1024) * 256, (nh / 1024) * 256]);
      // stability: the mask barely changes between a strict and a loose threshold
      let hi = 0, lo = 0, area = 0; const mask = new Uint8Array(aw * ah); let x0 = aw, y0 = ah, x1 = -1, y1 = -1;
      for (let q = 0; q < small.length; q++) { const v = small[q]; if (v > 160) hi++; if (v > 95) lo++; if (v > 127) { mask[q] = 1; area++; const x = q % aw, y = (q / aw) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      const stab = lo ? hi / lo : 0; if (!area || stab < 0.86) continue;
      out.push({ mask, iou: iou[k], stab, area, bbox: [x0, y0, x1, y1], seed: p, extra: i > grid * grid });
    }
  }
  // keep the best of overlapping candidates
  out.sort((a, b) => (b.extra - a.extra) || (b.iou * b.stab - a.iou * a.stab));
  const kept = [];
  for (const c of out) {
    let dup = false;
    for (const k of kept) {
      if (c.bbox[0] > k.bbox[2] || c.bbox[2] < k.bbox[0] || c.bbox[1] > k.bbox[3] || c.bbox[3] < k.bbox[1]) continue;
      let inter = 0; for (let q = 0; q < c.mask.length; q++) if (c.mask[q] && k.mask[q]) inter++;
      if (inter / (c.area + k.area - inter) > 0.72) { dup = true; break; }
    }
    if (!dup) kept.push(c);
    if (kept.length >= 40) break;
  }
  return { masks: kept.map(({ mask, iou, stab, area, bbox, extra: ex }) => ({ mask, iou, stab, area, bbox, extra: ex })) };
}
// A small mask → a full-size soft alpha that hugs the picture's edges
async function refineMask({ img, mask, aw, ah, feather = true, soft = false, radius }) {
  const g = new Uint8Array(mask.length); for (let q = 0; q < mask.length; q++) g[q] = soft ? mask[q] : mask[q] ? 255 : 0;
  let alpha = aw === img.w && ah === img.h ? g : resizeGray(g, aw, ah, img.w, img.h);
  if (feather && img.w * img.h <= 24e6) alpha = guided(img.data, alpha, img.w, img.h, radius || Math.max(2, Math.round(Math.max(img.w, img.h) / 600)), 1e-3);
  return { alpha };
}
// Fill several holes one after another (each with its own crop, so small holes stay sharp)
async function inpaintParts({ img, parts }) {
  let data = img.data;
  for (const [i, part] of parts.entries()) {
    progress(`Rebuilding the background… ${i + 1} of ${parts.length}`);
    const hole = new Uint8Array(img.w * img.h); // part: {x, y, w, h, m} is a cropped 0/1 mask
    for (let y = 0; y < part.h; y++) for (let x = 0; x < part.w; x++) if (part.m[y * part.w + x]) hole[(y + part.y) * img.w + x + part.x] = 1;
    data = (await inpaint({ img: { data, w: img.w, h: img.h }, hole, grow: part.grow ?? 0 })).data;
  }
  return { data };
}

async function info() { return { gpu: await hasGpu(), threads: ort.env.wasm.numThreads, isolated: self.crossOriginIsolated }; }
const API = { removebg, samEmbed, samDecode, inpaint, expand, samAuto, refineMask, inpaintParts, info, reset: async () => { samCache = null; return true; } };
self.onmessage = async (e) => {
  const { id, method, args } = e.data; curId = id;
  try {
    const r = await API[method](args || {});
    const transfer = [];
    if (r && r.data && r.data.buffer) transfer.push(r.data.buffer);
    if (r && r.alpha) transfer.push(r.alpha.buffer);
    if (r && r.masks) r.masks.forEach((m) => transfer.push(m.mask.buffer));
    postMessage({ id, result: r }, transfer);
  } catch (err) { postMessage({ id, error: String((err && err.message) || err) }); }
};
