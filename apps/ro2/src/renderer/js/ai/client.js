// Talks to the AI worker, and makes sure the model a tool needs is downloaded first (asking once, with its size).
import { h, btn, modal, fmtBytes, toastErr } from '../ui.js';

let worker = null, seq = 0; const waiting = new Map();
function w() {
  if (worker) return worker;
  worker = new Worker(new URL('./ai.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const { id, result, error, progress } = e.data; const job = waiting.get(id); if (!job) return;
    if (progress) { job.onProgress && job.onProgress(progress); return; }
    waiting.delete(id); if (error) job.rej(new Error(error)); else job.res(result);
  };
  worker.onerror = (e) => { for (const j of waiting.values()) j.rej(new Error(e.message || 'The AI stopped unexpectedly.')); waiting.clear(); worker = null; };
  return worker;
}
export function call(method, args, { transfer = [], onProgress } = {}) {
  const id = ++seq;
  return new Promise((res, rej) => { waiting.set(id, { res, rej, onProgress }); w().postMessage({ id, method, args }, transfer); });
}
export const restart = () => { if (worker) worker.terminate(); worker = null; };

// ───── models ─────
let cache = null;
export async function models(refresh) { if (!cache || refresh) cache = await window.ro2.models.list(); return cache; }
export async function installed(id) { return (await models(true)).find((m) => m.id === id)?.installed; }
const listeners = new Set();
window.ro2.models.onProgress((p) => { if (cache) { const m = cache.find((x) => x.id === p.id); if (m) { m.progress = p.progress; m.downloading = !p.done && !p.error; if (p.done) m.installed = true; } } listeners.forEach((f) => f(p)); });
export const onModelProgress = (f) => { listeners.add(f); return () => listeners.delete(f); };

// Make sure models are there; shows one dialog to download the missing ones. Resolves true when ready.
export async function ensure(ids, why) {
  const list = await models(true);
  const missing = list.filter((m) => ids.includes(m.id) && !m.installed);
  if (!missing.length) return true;
  const total = missing.reduce((s, m) => s + m.size, 0);
  return new Promise((resolve) => {
    let started = false, settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const rows = missing.map((m) => {
      const bar = h('i'); const pct = h('span.small.dim', fmtBytes(m.size));
      const row = h('div.model-row', h('div.mi', h('b', m.name), h('span', m.blurb), h('div.progress', bar)), pct);
      row.bar = bar; row.pct = pct; row.m = m; return row;
    });
    const go = btn(`Download ${fmtBytes(total)}`, async () => {
      started = true; go.disabled = true; later.textContent = 'Hide';
      const off = onModelProgress((p) => { const r = rows.find((x) => x.m.id === p.id); if (r) { r.bar.style.width = Math.round(p.progress * 100) + '%'; r.pct.textContent = p.error ? 'Failed' : Math.round(p.progress * 100) + '%'; } });
      try {
        for (const m of missing) { const r = await window.ro2.models.download(m.id); if (!r.ok) throw new Error(r.error === 'cancelled' ? 'Download cancelled.' : `Couldn't download ${m.name}: ${r.error}`); }
        off(); m.close(); done(true);
      } catch (e) { off(); toastErr(e); go.disabled = false; done(false); }
    }, { cls: 'primary', icon: 'download' });
    const later = btn('Not now', () => m.close(), { cls: 'ghost' });
    const m = modal({
      title: 'Download the AI model' + (missing.length > 1 ? 's' : ''),
      body: [h('p.muted', { style: { marginTop: '2px', lineHeight: 1.5 } }, `${why} runs entirely on this computer, so the model has to be downloaded once (${fmtBytes(total)}). After that it works offline.`), ...rows],
      foot: [later, go], onClose: () => { if (!started) done(false); },
    });
  });
}

// ───── helpers for pixels ─────
export async function imageDataFromUrl(url, maxSide = 0) {
  const im = new Image(); im.src = url; await im.decode();
  let w = im.naturalWidth, hh = im.naturalHeight;
  if (maxSide && Math.max(w, hh) > maxSide) { const s = maxSide / Math.max(w, hh); w = Math.round(w * s); hh = Math.round(hh * s); }
  const c = new OffscreenCanvas(w, hh); const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, w, hh);
  return x.getImageData(0, 0, w, hh);
}
export const plain = (id) => ({ data: id.data, w: id.width, h: id.height });
export async function dataUrlFrom(data, w, h, type = 'image/png', q) {
  const c = new OffscreenCanvas(w, h); c.getContext('2d').putImageData(new ImageData(data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data.buffer || data), w, h), 0, 0);
  const b = await c.convertToBlob({ type, quality: q });
  return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
}
// Old-school content-aware fill (RO3's PatchMatch), for when the eraser model isn't downloaded
export function patchFill(data, w, h, hole) {
  return new Promise((res, rej) => {
    const pw = new Worker(new URL('./patch.worker.js', import.meta.url));
    pw.onmessage = (e) => { if (e.data.progress != null && !e.data.data && !e.data.error) return; pw.terminate(); if (e.data.error) rej(new Error(e.data.error)); else res(e.data.data); };
    pw.onerror = (e) => { pw.terminate(); rej(new Error(e.message)); };
    pw.postMessage({ id: 1, w, h, data, hole, opts: { patch: 3 } });
  });
}
