// Content-aware fill: multi-scale PatchMatch inpainting (Wexler et al. / Barnes et al.), run off the UI thread.
// in:  { id, w, h, data: Uint8ClampedArray RGBA, hole: Uint8Array (1 = fill), opts: { patch } }
// out: { id, data } — the same region with the hole filled.
'use strict';

function rnd(n) { return (Math.random() * n) | 0; }

function makeLevel(w, h, img, hole) { return { w, h, img, hole }; }

function downsample(L) {
  const w = Math.max(1, L.w >> 1), h = Math.max(1, L.h >> 1);
  const img = new Float32Array(w * h * 4), hole = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let n = 0, r = 0, g = 0, b = 0, a = 0, anyHole = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const sx = Math.min(L.w - 1, x * 2 + dx), sy = Math.min(L.h - 1, y * 2 + dy), si = sy * L.w + sx;
      if (L.hole[si]) { anyHole = 1; continue; }
      r += L.img[si * 4]; g += L.img[si * 4 + 1]; b += L.img[si * 4 + 2]; a += L.img[si * 4 + 3]; n++;
    }
    const i = y * w + x;
    hole[i] = anyHole;
    if (n) { img[i * 4] = r / n; img[i * 4 + 1] = g / n; img[i * 4 + 2] = b / n; img[i * 4 + 3] = a / n; }
  }
  return makeLevel(w, h, img, hole);
}

/** Fill holes by repeatedly averaging known neighbours (onion peel). */
function diffuseFill(L) {
  const { w, h, img } = L;
  const known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) known[i] = L.hole[i] ? 0 : 1;
  let remaining = 0; for (let i = 0; i < w * h; i++) if (!known[i]) remaining++;
  let guard = 0;
  while (remaining > 0 && guard++ < w + h) {
    const next = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (known[i]) continue;
      let n = 0, c = [0, 0, 0, 0];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx; if (!known[j]) continue;
        for (let k = 0; k < 4; k++) c[k] += img[j * 4 + k]; n++;
      }
      if (n) next.push(i, c[0] / n, c[1] / n, c[2] / n, c[3] / n);
    }
    if (!next.length) break;
    for (let k = 0; k < next.length; k += 5) { const i = next[k]; img[i * 4] = next[k + 1]; img[i * 4 + 1] = next[k + 2]; img[i * 4 + 2] = next[k + 3]; img[i * 4 + 3] = next[k + 4]; known[i] = 1; remaining--; }
  }
}

/** Centres whose whole patch lies on known pixels inside the region. */
function validSources(L, r) {
  const { w, h, hole } = L;
  // integral image of hole counts for O(1) patch checks
  const I = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += hole[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  const ok = new Uint8Array(w * h), list = [];
  for (let y = r; y < h - r; y++) for (let x = r; x < w - r; x++) {
    const x0 = x - r, y0 = y - r, x1 = x + r + 1, y1 = y + r + 1;
    const s = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
    if (s === 0) { ok[y * w + x] = 1; list.push(y * w + x); }
  }
  return { ok, list };
}

function solveLevel(L, r, prevNNF, prevW, emIters, finest) {
  const { w, h, img, hole } = L;
  const n = w * h;
  const src = validSources(L, r);
  if (!src.list.length) return null;
  // target centres: any pixel within r of a hole pixel
  const isT = new Uint8Array(n), targets = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!hole[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx; if (!isT[j]) { isT[j] = 1; targets.push(j); }
    }
  }
  const nnf = new Int32Array(n).fill(-1), dist = new Float64Array(n).fill(Infinity);
  const patchDist = (t, s, best) => {
    const tx = t % w, ty = (t / w) | 0, sx = s % w, sy = (s / w) | 0;
    let d = 0, cnt = 0;
    for (let dy = -r; dy <= r; dy++) {
      const ty2 = ty + dy, sy2 = sy + dy; if (ty2 < 0 || ty2 >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const tx2 = tx + dx; if (tx2 < 0 || tx2 >= w) continue;
        const a = (ty2 * w + tx2) * 4, b = (sy2 * w + sx + dx) * 4;
        const wgt = hole[ty2 * w + tx2] ? 1 : 2; // known context matters more
        const e0 = img[a] - img[b], e1 = img[a + 1] - img[b + 1], e2 = img[a + 2] - img[b + 2], e3 = img[a + 3] - img[b + 3];
        d += wgt * (e0 * e0 + e1 * e1 + e2 * e2 + e3 * e3 * 0.5); cnt += wgt;
        if (d > best * cnt * 1.0001 && cnt > 8) return Infinity;
      }
    }
    return cnt ? d / cnt : Infinity;
  };
  const tryS = (t, s) => {
    if (s < 0 || s >= n || !src.ok[s]) return;
    const d = patchDist(t, s, dist[t]);
    if (d < dist[t]) { dist[t] = d; nnf[t] = s; }
  };
  // initialise: upsampled previous solution, else random
  for (const t of targets) {
    if (prevNNF) {
      const tx = t % w, ty = (t / w) | 0, px = Math.min(prevW.w - 1, tx >> 1), py = Math.min(prevW.h - 1, ty >> 1), ps = prevNNF[py * prevW.w + px];
      if (ps >= 0) { const sx = (ps % prevW.w) * 2 + (tx & 1), sy = ((ps / prevW.w) | 0) * 2 + (ty & 1); if (sx < w && sy < h) tryS(t, sy * w + sx); }
    }
    if (nnf[t] < 0) tryS(t, src.list[rnd(src.list.length)]);
    if (nnf[t] < 0) { nnf[t] = src.list[rnd(src.list.length)]; dist[t] = patchDist(t, nnf[t], Infinity); }
  }
  const order = targets.slice().sort((a, b) => a - b);
  const maxR = finest && prevNNF ? Math.min(24, Math.max(w, h)) : Math.max(w, h);
  for (let em = 0; em < emIters; em++) {
    // refresh distances against current image estimate
    for (const t of order) dist[t] = patchDist(t, nnf[t], Infinity);
    for (let pass = 0; pass < (finest ? 1 : 2); pass++) {
      if (finest && em % 2) { /* alternate scan direction between EM steps */ }
      const fwd = finest ? em % 2 === 0 : pass % 2 === 0, step = fwd ? 1 : -1, list = fwd ? order : order.slice().reverse();
      for (const t of list) {
        const tx = t % w, ty = (t / w) | 0;
        // propagation from already-visited neighbours
        const nx = tx - step, ny = ty - step;
        if (nx >= 0 && nx < w) { const j = ty * w + nx; if (isT[j] && nnf[j] >= 0) tryS(t, nnf[j] + step); }
        if (ny >= 0 && ny < h) { const j = ny * w + tx; if (isT[j] && nnf[j] >= 0) tryS(t, nnf[j] + step * w); }
        // random search around the current best
        const s = nnf[t], sx = s % w, sy = (s / w) | 0;
        for (let rad = maxR; rad >= 1; rad = (rad / 2) | 0) {
          const cx = Math.max(r, Math.min(w - r - 1, sx + rnd(rad * 2 + 1) - rad)), cy = Math.max(r, Math.min(h - r - 1, sy + rnd(rad * 2 + 1) - rad));
          tryS(t, cy * w + cx);
        }
      }
    }
    // voting: each hole pixel = weighted average of the overlapping source patches
    let sigma = 0, sc = 0;
    for (const t of order) if (isFinite(dist[t])) { sigma += dist[t]; sc++; }
    sigma = Math.max(1, sigma / Math.max(1, sc));
    // On the final pass at full size, favour the single best patch so fine texture (grain, noise) survives.
    const pickBest = finest && em === emIters - 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!hole[i]) continue;
      if (pickBest) {
        // copy from the single best-matching patch so grain and noise stay crisp
        let bd = Infinity, bb = -1;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const tx = x - dx, ty = y - dy; if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
          const t = ty * w + tx, s = nnf[t]; if (!isT[t] || s < 0) continue;
          const dd = dist[t] + (dx * dx + dy * dy) * 0.5 * sigma / (r * r);
          if (dd < bd) { bd = dd; bb = (((s / w) | 0) + dy) * w + (s % w) + dx; }
        }
        if (bb >= 0) { for (let k = 0; k < 4; k++) img[i * 4 + k] = img[bb * 4 + k]; }
        continue;
      }
      let c0 = 0, c1 = 0, c2 = 0, c3 = 0, ws = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const tx = x - dx, ty = y - dy; if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
        const t = ty * w + tx, s = nnf[t]; if (!isT[t] || s < 0) continue;
        const sx = (s % w) + dx, sy = ((s / w) | 0) + dy, b = (sy * w + sx) * 4;
        const wg = Math.exp(-dist[t] / (2 * sigma));
        c0 += img[b] * wg; c1 += img[b + 1] * wg; c2 += img[b + 2] * wg; c3 += img[b + 3] * wg; ws += wg;
      }
      if (ws > 0) { img[i * 4] = c0 / ws; img[i * 4 + 1] = c1 / ws; img[i * 4 + 2] = c2 / ws; img[i * 4 + 3] = c3 / ws; }
    }
  }
  return nnf;
}

function inpaint(w, h, data, holeIn, opts = {}) {
  const r = opts.patch || 3;
  const img = new Float32Array(w * h * 4);
  for (let i = 0; i < img.length; i++) img[i] = data[i];
  const base = makeLevel(w, h, img, holeIn);
  // pyramid until the hole is only a few pixels across at the coarsest level
  const levels = [base];
  let holeCount = 0; for (let i = 0; i < holeIn.length; i++) holeCount += holeIn[i];
  while (true) {
    const L = levels[levels.length - 1];
    if (Math.min(L.w, L.h) < (r * 2 + 1) * 4 || holeCount / (4 ** (levels.length - 1)) < 60) break;
    levels.push(downsample(L));
  }
  const top = levels[levels.length - 1];
  diffuseFill(top);
  let nnf = null, prev = null;
  for (let li = levels.length - 1; li >= 0; li--) {
    const L = levels[li];
    if (li < levels.length - 1 && nnf) {
      // initialise this level's hole from the coarser solution (nearest upsample)
      for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
        const i = y * L.w + x; if (!L.hole[i]) continue;
        const px = Math.min(prev.w - 1, x >> 1), py = Math.min(prev.h - 1, y >> 1), j = (py * prev.w + px) * 4;
        for (let k = 0; k < 4; k++) L.img[i * 4 + k] = prev.img[j + k];
      }
    }
    const rr = Math.min(r, Math.max(1, Math.floor(Math.min(L.w, L.h) / 8)));
    const em = li === levels.length - 1 ? 6 : li === 0 ? 3 : 4;
    const res = solveLevel(L, rr, nnf, prev, em, li === 0);
    if (!res) { if (li === levels.length - 1) diffuseFill(L); nnf = null; prev = L; continue; }
    nnf = res; prev = L;
    postMessage({ progress: 1 - li / levels.length, id: opts.id });
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i++) out[i] = base.img[i];
  return out;
}

self.onmessage = (e) => {
  const { id, w, h, data, hole, opts } = e.data;
  try {
    const out = inpaint(w, h, data, hole, { ...(opts || {}), id });
    postMessage({ id, data: out }, [out.buffer]);
  } catch (err) {
    postMessage({ id, error: String(err && err.message || err) });
  }
};
