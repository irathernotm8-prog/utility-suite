// Dither — the sandbox page: takes render jobs from the main process, runs them in a worker with a time limit,
// and turns frames into a WebM video with MediaRecorder when asked. If workers can't start here, effects run on the
// page instead (the main process recreates this whole window if one hangs).
'use strict';
const bridge = window.sandbox;
let worker = null, inline = false; const pending = new Map();

function renderInline(id, code, opts) {
  try { const r = DitherFX.render(code, opts || {}); return { id, ok: true, meta: r.meta, frames: r.frames.map((f) => f.buffer) }; }
  catch (err) { let line = null; const m = /<anonymous>:(\d+):(\d+)/.exec((err && err.stack) || ''); if (m) line = Math.max(1, Number(m[1]) - 3); return { id, ok: false, error: String((err && err.message) || err), line }; }
}
function spawn() {
  try { worker = new Worker('fx-worker.js'); } catch { inline = true; return; }
  worker.started = false;
  worker.onmessage = (e) => { worker.started = true; const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); clearTimeout(p.timer); p.done(e.data); };
  worker.onerror = (e) => {
    e.preventDefault(); const never = !worker.started; worker.terminate();
    if (never) { inline = true; for (const [id, p] of pending) { clearTimeout(p.timer); p.done(renderInline(id, p.code, p.opts)); } pending.clear(); return; }
    for (const [id, p] of pending) { clearTimeout(p.timer); p.done({ id, ok: false, error: e.message || 'The effect crashed' }); }
    pending.clear(); spawn();
  };
}
spawn();

function render(id, code, opts, timeoutMs) {
  if (inline) return Promise.resolve(renderInline(id, code, opts));
  return new Promise((done) => {
    const timer = setTimeout(() => { pending.delete(id); worker.terminate(); spawn(); done({ id, ok: false, error: `The effect didn’t finish within ${Math.round(timeoutMs / 1000)} s (an endless loop, or too much work per frame).` }); }, timeoutMs);
    pending.set(id, { done, timer, code, opts }); worker.postMessage({ id, code, opts });
  });
}

async function webm(frames, w, h, durations, scale, bg, loops) {
  const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale; const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h; const tx = tmp.getContext('2d');
  const stream = c.captureStream(60); const type = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6e6 }); const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r)); rec.start();
  const paint = (i) => { x.fillStyle = bg || '#16141e'; x.fillRect(0, 0, c.width, c.height); tx.clearRect(0, 0, w, h); tx.putImageData(new ImageData(new Uint8ClampedArray(frames[i]), w, h), 0, 0); x.drawImage(tmp, 0, 0, c.width, c.height); };
  for (let l = 0; l < loops; l++) for (let i = 0; i < frames.length; i++) { paint(i); await new Promise((r) => setTimeout(r, durations[i] || 83)); }
  rec.stop(); await stopped; const blob = new Blob(chunks, { type: 'video/webm' }); return new Uint8Array(await blob.arrayBuffer());
}

// video / GIF → frames (RGBA, scaled so the long side is at most maxSize), sampled at fps
async function extract(bytes, mime, { fps = 24, maxFrames = 144, maxSize = 512 } = {}) {
  const fit = (w, h) => { const s = Math.min(1, maxSize / Math.max(w, h)); return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]; };
  if (/gif|webp|apng/.test(mime) && typeof ImageDecoder !== 'undefined') {
    const dec = new ImageDecoder({ data: bytes, type: mime }); await dec.tracks.ready; const n = Math.min(maxFrames, dec.tracks.selectedTrack.frameCount); const out = []; let dur = 0;
    for (let i = 0; i < n; i++) { const { image } = await dec.decode({ frameIndex: i }); const [w, h] = fit(image.displayWidth, image.displayHeight); const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); x.drawImage(image, 0, 0, w, h); out.push({ w, h, data: x.getImageData(0, 0, w, h).data.buffer }); dur += (image.duration || 100000) / 1000; image.close(); }
    return { frames: out, fps: n ? Math.round(1000 / (dur / n)) || 10 : 10 };
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'video/mp4' })); const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url;
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('This video can’t be read here (codec?). Try MP4 (H.264) or WebM.')); });
  if (!isFinite(v.duration)) { v.currentTime = 1e7; await new Promise((r) => (v.onseeked = r)); v.currentTime = 0; await new Promise((r) => (v.onseeked = r)); }
  const [w, h] = fit(v.videoWidth, v.videoHeight); const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true });
  const n = Math.max(1, Math.min(maxFrames, Math.floor(v.duration * fps))); const out = [];
  for (let i = 0; i < n; i++) { const t = Math.min(v.duration - 0.001, (i + 0.5) / fps); v.currentTime = t; await new Promise((r) => (v.onseeked = r)); x.drawImage(v, 0, 0, w, h); out.push({ w, h, data: x.getImageData(0, 0, w, h).data.buffer }); }
  URL.revokeObjectURL(url); return { frames: out, fps };
}

bridge.onJob(async (job) => {
  try {
    if (job.kind === 'render') bridge.reply(job.id, await render(job.id, job.code, job.opts, job.timeoutMs || 10000));
    else if (job.kind === 'frames') { const r = await extract(job.bytes, job.mime, job.opts || {}); bridge.reply(job.id, { ok: true, ...r }); }
    else if (job.kind === 'webm') bridge.reply(job.id, { ok: true, data: await webm(job.frames, job.w, job.h, job.durations, job.scale || 6, job.bg, job.loops || 3) });
  } catch (e) { bridge.reply(job.id, { ok: false, error: e.message || String(e) }); }
});
bridge.ready();
