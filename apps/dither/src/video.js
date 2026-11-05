// Dither — animating a character with a video model. Two engines:
//   local: Wan 2.2 TI2V 5B in ComfyUI (the one Kiln runs) — free, on this computer's GPU (best on the PC's NVIDIA card)
//   cloud: fal.ai with your own key — Kling 3.0 or Wan image-to-video, faster, paid per clip by fal
// Both start from the character on a flat green screen and come back as frames for clip2sprite.
'use strict';
const fs = require('fs');
const path = require('path');
const png = require('./core/png');

let fetchImpl = (...a) => { try { const { net } = require('electron'); if (net && net.fetch) return net.fetch(...a); } catch {} return fetch(...a); };
function setFetch(f) { fetchImpl = f; }
async function j(url, { method = 'GET', body, headers = {}, timeout = 15000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetchImpl(url, { method, signal: ctl.signal, headers: { ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body && !(body instanceof FormData) ? JSON.stringify(body) : body });
    const txt = await r.text(); let v = null; try { v = JSON.parse(txt); } catch {}
    if (!r.ok) { const d = v && (v.detail || v.error || v.message); throw new Error(`${r.status} ${typeof d === 'string' ? d : d ? JSON.stringify(d).slice(0, 400) : txt.slice(0, 300)}`); }
    return v ?? txt;
  } finally { clearTimeout(t); }
}

// ───────── the motion prompts: presets + the guard that keeps clips usable for sprites
const PRESETS = {
  idle: { label: 'Idle', loop: true, align: 'feet', seconds: 2, text: 'stands in place breathing calmly, a subtle weight shift, arms relaxed' },
  walk: { label: 'Walk', loop: true, align: 'feet', seconds: 2, text: 'walks in place facing the same direction, a full walk cycle with arms swinging, the feet stay on the same spot' },
  run: { label: 'Run', loop: true, align: 'feet', seconds: 2, text: 'runs in place facing the same direction, a full run cycle, the body stays in the same spot' },
  attack: { label: 'Attack', loop: false, align: 'feet', seconds: 2, text: 'performs a quick weapon attack: a short wind-up, a fast strike, then returns to the starting pose' },
  cast: { label: 'Cast', loop: false, align: 'feet', seconds: 3, text: 'casts a spell: raises a hand, magic glows in the hand, then lowers it back to the starting pose' },
  jump: { label: 'Jump', loop: false, align: 'x', seconds: 2, text: 'crouches, jumps straight up and lands back on the same spot' },
  hurt: { label: 'Hurt', loop: false, align: 'feet', seconds: 2, text: 'flinches back from a hit, then recovers to the starting pose' },
  death: { label: 'Defeat', loop: false, align: 'feet', seconds: 3, text: 'staggers and collapses to the ground' },
  turnaround: { label: 'Turnaround', loop: true, align: 'x', seconds: 4, text: 'slowly turns around on the spot through a full circle — front, side, back, other side, front — standing upright with arms relaxed a little away from the body, the feet stay on the same spot' },
};
const GUARD = 'The camera does not move or zoom. The plain flat green background stays exactly the same. No new shadows, no new objects, no text. The character keeps the same design, colours and size and stays fully inside the frame.';
const NEGATIVE = 'camera movement, zoom, pan, shaky camera, background change, new shadows, new objects, extra limbs, morphing, blur, text, watermark, cropped body';
function motionPrompt(text, { loop } = {}) { return `${String(text || '').trim().replace(/\.?$/, '.')} ${loop ? 'Seamless loop: the last frame matches the first. ' : ''}${GUARD}`; }

// ───────── local: ComfyUI + Wan 2.2 TI2V 5B
const WAN = {
  name: 'Wan 2.2 (5B)',
  files: [
    { kind: 'unet', folder: 'DiffusionModels', comfyDir: 'diffusion_models', file: 'wan2.2_ti2v_5B_fp16.safetensors', size: 10.0, url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors' },
    { kind: 'clip', folder: 'TextEncoders', comfyDir: 'text_encoders', file: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', size: 6.7, url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors' },
    { kind: 'vae', folder: 'VAE', comfyDir: 'vae', file: 'wan2.2_vae.safetensors', size: 1.4, url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors' },
  ],
  fps: 24,
};
const combo = (info, node, input) => { const v = info && info[node] && info[node].input && (info[node].input.required || {})[input]; return Array.isArray(v) && Array.isArray(v[0]) ? v[0] : []; };
async function localStatus(base) {
  if (!base) return { ready: false, reason: 'no-comfy' };
  const [n, u, c, v] = await Promise.all(['Wan22ImageToVideoLatent', 'UNETLoader', 'CLIPLoader', 'VAELoader'].map((x) => j(`${base}/object_info/${x}`, { timeout: 8000 }).catch(() => ({}))));
  const nodeOk = !!(n && n.Wan22ImageToVideoLatent);
  const have = { unet: combo(u, 'UNETLoader', 'unet_name'), clip: combo(c, 'CLIPLoader', 'clip_name'), vae: combo(v, 'VAELoader', 'vae_name') };
  const find = (f) => have[f.kind].find((x) => x.replace(/\\/g, '/').split('/').pop() === f.file);
  const files = WAN.files.map((f) => ({ ...f, found: find(f) || null }));
  return { ready: nodeOk && files.every((f) => f.found), nodeOk, files, missingGB: Math.round(files.filter((f) => !f.found).reduce((a, f) => a + f.size, 0) * 10) / 10 };
}
async function upload(base, img, name) {
  const fd = new FormData(); fd.append('image', new Blob([png.encode(img)], { type: 'image/png' }), name); fd.append('overwrite', 'true');
  const r = await j(`${base}/upload/image`, { method: 'POST', body: fd, timeout: 60000 }); return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
}
function wanGraph({ files, image, prompt, negative, width, height, length, seed, steps = 20, cfg = 5 }) {
  const f = Object.fromEntries(files.map((x) => [x.kind, x.found || x.file]));
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: f.unet, weight_dtype: 'default' } },
    2: { class_type: 'ModelSamplingSD3', inputs: { model: ['1', 0], shift: 8 } },
    3: { class_type: 'CLIPLoader', inputs: { clip_name: f.clip, type: 'wan', device: 'default' } },
    4: { class_type: 'VAELoader', inputs: { vae_name: f.vae } },
    5: { class_type: 'LoadImage', inputs: { image } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['3', 0] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['3', 0] } },
    8: { class_type: 'Wan22ImageToVideoLatent', inputs: { vae: ['4', 0], width, height, length, batch_size: 1, start_image: ['5', 0] } },
    9: { class_type: 'KSampler', inputs: { model: ['2', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['8', 0], seed, steps, cfg, sampler_name: 'uni_pc', scheduler: 'simple', denoise: 1 } },
    10: { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['4', 0] } },
    11: { class_type: 'SaveImage', inputs: { images: ['10', 0], filename_prefix: 'Dither/clip' } },
  };
}
// runLocal({ base, image, prompt, seconds, size, seed }) → { frames: [{w,h,data}], fps }
async function runLocal({ base, image, prompt, seconds = 2, size = 640, seed, steps, onProgress = () => {}, signal }) {
  const st = await localStatus(base); if (!st.nodeOk) throw new Error('This ComfyUI is too old for Wan 2.2. Update ComfyUI in Kiln › Packages, then try again.');
  if (!st.ready) throw new Error(`Wan 2.2 needs ${st.files.filter((f) => !f.found).map((f) => f.file).join(', ')} (${st.missingGB} GB). Add them in Animate › Engine.`);
  const side = Math.max(256, Math.min(1024, Math.round(size / 32) * 32)); const length = Math.max(17, Math.round((seconds * WAN.fps) / 4) * 4 + 1);
  onProgress({ msg: 'Sending the character to ComfyUI…', progress: 0.02 });
  const name = await upload(base, image, `dither-${Date.now()}.png`);
  const graph = wanGraph({ files: st.files, image: name, prompt, negative: NEGATIVE, width: side, height: side, length, seed: seed >= 0 ? seed : Math.floor(Math.random() * 2 ** 31), steps });
  const q = await j(`${base}/prompt`, { method: 'POST', body: { prompt: graph, client_id: 'dither' }, timeout: 30000 });
  if (q.node_errors && Object.keys(q.node_errors).length) throw new Error('ComfyUI rejected the workflow: ' + JSON.stringify(q.node_errors).slice(0, 400));
  const t0 = Date.now(); onProgress({ msg: `Animating with Wan 2.2 — ${length} frames at ${side}×${side}. The first run loads the model and takes longest.`, progress: 0.05 });
  for (;;) {
    if (signal && signal.aborted) { await j(`${base}/interrupt`, { method: 'POST', body: {} }).catch(() => {}); throw new Error('Stopped'); }
    await new Promise((r) => setTimeout(r, 1500));
    const h = (await j(`${base}/history/${q.prompt_id}`, { timeout: 8000 }).catch(() => ({})))[q.prompt_id];
    if (h && h.status && h.status.status_str === 'error') { const m = (h.status.messages || []).find((x) => x[0] === 'execution_error'); throw new Error((m && m[1] && m[1].exception_message) || 'ComfyUI hit an error. See its console in Kiln.'); }
    const imgs = h ? Object.values(h.outputs || {}).flatMap((o) => o.images || []).filter((x) => x.type === 'output' || !x.type) : [];
    if (imgs.length) {
      const frames = [];
      for (const [i, im] of imgs.entries()) { const r = await fetchImpl(`${base}/view?filename=${encodeURIComponent(im.filename)}&subfolder=${encodeURIComponent(im.subfolder || '')}&type=${im.type || 'output'}`); frames.push(png.decode(Buffer.from(await r.arrayBuffer()))); if (i % 8 === 0) onProgress({ msg: `Collecting frames ${i + 1}/${imgs.length}…`, progress: 0.92 + 0.08 * i / imgs.length }); }
      return { frames, fps: WAN.fps, engine: WAN.name, size: side };
    }
    const el = (Date.now() - t0) / 1000; onProgress({ progress: Math.min(0.9, 0.05 + el / (120 + seconds * 60)) });
    if (el > 3600) throw new Error('ComfyUI took longer than an hour');
  }
}

// ───────── cloud: fal.ai queue API with your own key
const CLOUD = {
  'kling-3': { label: 'Kling 3.0', id: 'fal-ai/kling-video/o3/standard/image-to-video', input: (o) => ({ prompt: o.prompt, image_url: o.image, negative_prompt: NEGATIVE, duration: String(o.seconds <= 5 ? 5 : 10) }) },
  'wan-i2v': { label: 'Wan (fal)', id: 'fal-ai/wan-i2v', input: (o) => ({ prompt: o.prompt, image_url: o.image, negative_prompt: NEGATIVE, num_frames: 81, frames_per_second: 16, resolution: '480p', aspect_ratio: '1:1' }) },
};
// runCloud({ key, model, customId, image (PNG Buffer), prompt, seconds }) → { video: Buffer, mime }
async function runCloud({ key, model = 'kling-3', customId, image, prompt, seconds = 2, onProgress = () => {}, signal }) {
  if (!key) throw new Error('Add your fal.ai key in Animate › Engine first.');
  const m = CLOUD[model] || CLOUD['kling-3']; const id = (customId || m.id).replace(/^\/+|\/+$/g, '');
  const input = m.input({ prompt, image: `data:image/png;base64,${image.toString('base64')}`, seconds });
  onProgress({ msg: `Sending to ${m.label} on fal.ai…`, progress: 0.03 });
  const sub = await j(`https://queue.fal.run/${id}`, { method: 'POST', body: input, headers: { Authorization: `Key ${key}` }, timeout: 120000 });
  const statusUrl = sub.status_url || `https://queue.fal.run/${id}/requests/${sub.request_id}/status`, respUrl = sub.response_url || `https://queue.fal.run/${id}/requests/${sub.request_id}`;
  const t0 = Date.now();
  for (;;) {
    if (signal && signal.aborted) throw new Error('Stopped');
    await new Promise((r) => setTimeout(r, 2500));
    const s = await j(statusUrl, { headers: { Authorization: `Key ${key}` } }).catch((e) => ({ status: 'ERR', error: e.message }));
    if (s.status === 'COMPLETED') break;
    if (s.status === 'FAILED' || s.error && s.status !== 'ERR') throw new Error(`fal.ai: ${s.error || 'the job failed'}`);
    const el = (Date.now() - t0) / 1000; onProgress({ msg: s.status === 'IN_QUEUE' ? `Waiting in ${m.label}'s queue${s.queue_position != null ? ` (position ${s.queue_position})` : ''}…` : `${m.label} is animating…`, progress: Math.min(0.85, 0.05 + el / 240) });
    if (el > 1800) throw new Error('fal.ai took longer than 30 minutes');
  }
  const res = await j(respUrl, { headers: { Authorization: `Key ${key}` }, timeout: 60000 });
  const url = res && (res.video && res.video.url || res.videos && res.videos[0] && res.videos[0].url); if (!url) throw new Error('fal.ai finished but sent no video: ' + JSON.stringify(res).slice(0, 300));
  onProgress({ msg: 'Downloading the clip…', progress: 0.9 });
  const r = await fetchImpl(url); return { video: Buffer.from(await r.arrayBuffer()), mime: (res.video && res.video.content_type) || 'video/mp4', engine: m.label };
}

// ───────── downloads (resumable) for the local model files
async function download(url, dest, onProgress = () => {}, signal) {
  fs.mkdirSync(path.dirname(dest), { recursive: true }); const part = dest + '.part';
  let start = 0; try { start = fs.statSync(part).size; } catch {}
  const r = await fetchImpl(url, { headers: start ? { Range: `bytes=${start}-` } : {}, signal }); if (!r.ok && r.status !== 206) throw new Error(`Download failed: ${r.status} for ${path.basename(dest)}`);
  if (start && r.status !== 206) start = 0;
  const total = (Number(r.headers.get('content-length')) || 0) + start; const out = fs.createWriteStream(part, { flags: start ? 'a' : 'w' });
  let got = start, last = 0; const reader = r.body.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; got += value.length; if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res)); if (Date.now() - last > 400) { last = Date.now(); onProgress({ got, total }); } }
  await new Promise((res) => out.end(res)); fs.renameSync(part, dest); onProgress({ got, total, done: true }); return dest;
}

module.exports = { PRESETS, GUARD, NEGATIVE, motionPrompt, WAN, CLOUD, localStatus, runLocal, runCloud, wanGraph, download, setFetch };
