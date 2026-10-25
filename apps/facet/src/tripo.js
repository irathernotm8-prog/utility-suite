// Facet — Tripo cloud engine (optional). Uses the person's own Tripo API key and credits.
// Docs: https://developers.tripo3d.com (v3 API). Everything else in Facet stays on the computer; this engine uploads
// the picture (or sends the prompt) to Tripo and downloads the finished model.
const fs = require('fs');
const path = require('path');
const { net } = require('electron');
const tools = require('./tools');

const BASE = process.env.FACET_TRIPO_BASE || 'https://openapi.tripo3d.com/v3';   // override only for testing
const MODELS = [
  { id: 'v3.1-20260211', label: 'Tripo H3.1', note: 'Latest, highest detail' },
  { id: 'v3.0-20250812', label: 'Tripo H3.0', note: 'Tripo 3.0' },
  { id: 'P1-20260311', label: 'Tripo P1', note: 'Low-poly, game-ready' }
];

async function call(key, method, p, body) {
  const headers = { Authorization: `Bearer ${key}` };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await net.fetch(BASE + p, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch {}
  if (!res.ok || !json || json.code !== 0) {
    const msg = json?.message || json?.error || json?.data?.message || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new Error('Tripo did not accept the API key. Check it in Models › Tripo.');
    if (/credit|balance|insufficient/i.test(msg)) throw new Error('Your Tripo account is out of credits.');
    throw new Error('Tripo: ' + msg);
  }
  return json.data;
}

async function upload(key, file) {
  const ext = path.extname(file).toLowerCase();
  const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)], { type }), path.basename(file));
  const d = await call(key, 'POST', '/files', form);
  return d.file_token;
}

// Starts a generation. Returns the task id.
async function start(key, { image, prompt, model, quality, faces }) {
  const body = { model: model || MODELS[0].id, texture: true, pbr: true };
  if (quality && quality !== 'standard') body.texture_quality = quality;
  if (faces) body.face_limit = Math.max(500, Math.min(faces, 1500000));
  if (model?.startsWith('P1')) { delete body.texture_quality; body.smart_low_poly = false; }
  if (image) {
    body.input = await upload(key, image);
    const d = await call(key, 'POST', '/generation/image-to-model', body);
    return d.task_id;
  }
  body.prompt = String(prompt || '').slice(0, 1000);
  const d = await call(key, 'POST', '/generation/text-to-model', body);
  return d.task_id;
}

async function wait(key, id, onProgress, signal) {
  for (;;) {
    if (signal?.aborted) throw Object.assign(new Error('Stopped'), { stopped: true });
    const d = await call(key, 'GET', `/tasks/${encodeURIComponent(id)}`);
    if (d.status === 'success') return d;
    if (['failed', 'cancelled', 'banned', 'expired'].includes(d.status)) throw new Error(`Tripo could not make this model (${d.status}).`);
    onProgress?.(d.progress || 0, d.status);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function run(key, opts, outDir, onProgress, signal) {
  onProgress?.(0.02, opts.image ? 'Uploading the picture to Tripo' : 'Sending the prompt to Tripo');
  const id = await start(key, opts);
  onProgress?.(0.08, 'Queued at Tripo');
  const d = await wait(key, id, (p, s) => onProgress?.(0.08 + 0.8 * (p / 100), s === 'queued' ? 'Queued at Tripo' : `Tripo is building it (${p}%)`), signal);
  const out = d.output || {};
  const url = out.pbr_model || out.model_url || out.model || out.base_model;
  if (!url) throw new Error('Tripo finished but sent no model file.');
  onProgress?.(0.9, 'Downloading the model');
  const dest = path.join(outDir, 'tripo.glb');
  await tools.downloadFile(url, dest);
  let preview = null;
  if (out.rendered_image_url) {
    try { preview = await tools.downloadFile(out.rendered_image_url, path.join(outDir, 'tripo-preview' + (path.extname(new URL(out.rendered_image_url).pathname) || '.webp'))); } catch {}
  }
  return { glb: dest, preview, task: id, credits: d.credits_consumed ?? null };
}

module.exports = { MODELS, run };
