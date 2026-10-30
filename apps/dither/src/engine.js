// Dither — the optional local image model. Dither doesn't ship its own copy of Stable Diffusion: it uses the one
// Kiln (or any Forge / A1111 / SD.Next / ComfyUI) is already running on this computer, adds the free Pixel Art XL
// LoRA, and Pixel-snaps the result into real pixel art. Nothing leaves the computer.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, net } = require('electron');

const LORA = { name: 'pixel-art-xl', file: 'pixel-art-xl.safetensors', url: 'https://huggingface.co/nerijs/pixel-art-xl/resolve/main/pixel-art-xl.safetensors', page: 'https://huggingface.co/nerijs/pixel-art-xl', license: 'CreativeML Open RAIL++-M', size: '~170 MB', base: 'SDXL 1.0 checkpoints' };
const PORTS = [7860, 7861, 8188, 8000, 7862, 9090];
let custom = '';
let last = null;

async function get(url, { timeout = 2500, method = 'GET', body } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try { const r = await net.fetch(url, { method, signal: ctl.signal, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {} if (!r.ok) throw new Error(j && (j.detail || j.error) ? JSON.stringify(j.detail || j.error).slice(0, 300) : `${r.status} ${txt.slice(0, 200)}`); return j ?? txt; }
  finally { clearTimeout(t); }
}
async function probe(base) {
  base = base.replace(/\/$/, '');
  try { const m = await get(base + '/sdapi/v1/sd-models'); if (Array.isArray(m)) return { kind: 'a1111', url: base }; } catch {}
  try { const s = await get(base + '/system_stats'); if (s && (s.system || s.devices)) return { kind: 'comfy', url: base }; } catch {}
  return null;
}
async function detect() {
  const bases = [custom, ...PORTS.map((p) => `http://127.0.0.1:${p}`)].filter(Boolean);
  for (const b of bases) { const r = await probe(b); if (r) { last = r; return r; } }
  last = null; return null;
}
async function detectComfy(extra) { for (const b of [extra, custom, ...PORTS.map((p) => `http://127.0.0.1:${p}`)].filter(Boolean)) { const r = await probe(b); if (r && r.kind === 'comfy') return r; } return null; }
const isXL = (n) => /xl|pony|illustrious|noob|juggernaut|dreamshaper.?xl|realvis|animagine/i.test(n);
async function status() {
  const e = await detect();
  const base = { lora: LORA, kilnLoraFolders: kilnLoraFolders(), engine: null };
  if (!e) return base;
  try {
    if (e.kind === 'a1111') {
      const [models, loras] = await Promise.all([get(e.url + '/sdapi/v1/sd-models', { timeout: 6000 }), get(e.url + '/sdapi/v1/loras', { timeout: 6000 }).catch(() => [])]);
      const ck = (models || []).map((m) => m.title || m.model_name); const lo = (loras || []).map((l) => l.name);
      return { ...base, engine: { ...e, name: 'Forge / A1111', checkpoints: ck, xl: ck.filter(isXL), loras: lo, hasLora: lo.some((n) => /pixel.?art.?xl/i.test(n)) } };
    }
    const info = await get(e.url + '/object_info/CheckpointLoaderSimple', { timeout: 6000 }); const li = await get(e.url + '/object_info/LoraLoader', { timeout: 6000 }).catch(() => ({}));
    const ck = (info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]) || []; const lo = (li.LoraLoader?.input?.required?.lora_name?.[0]) || [];
    return { ...base, engine: { ...e, name: 'ComfyUI', checkpoints: ck, xl: ck.filter(isXL), loras: lo, hasLora: lo.some((n) => /pixel.?art.?xl/i.test(n)) } };
  } catch (err) { return { ...base, engine: { ...e, error: err.message } }; }
}

const POS = (p, bg, pixel = true) => (bg === 'green' ? `${pixel ? 'pixel art, ' : ''}${p}, full body, centered, standing, side view unless stated, solid flat bright green background (#00ff00), no shadow on the ground, game character${pixel ? ', crisp pixels' : ', clean shapes, flat colours'}` : `pixel art, ${p}, ${bg === 'white' ? 'plain white background' : 'plain flat background'}, game sprite, crisp pixels, clean outline, limited palette`);
const NEG = 'blurry, soft, 3d render, realistic, photo, gradient, anti-aliasing, noise, dithering noise, jpeg artifacts, text, watermark, signature, frame, border';

// generate({ prompt, checkpoint, seed, steps, cfg, width, height, loraWeight, init }) → PNG Buffer
async function generate(o, onProgress = () => {}) {
  const st = await status(); const e = st.engine;
  if (!e) throw new Error('No local image engine is running. Start Forge, A1111 or ComfyUI in Kiln (with its API on), then try again.');
  const ckpt = o.checkpoint || e.xl[0] || e.checkpoints[0]; if (!ckpt) throw new Error(`${e.name} has no checkpoints. Add an SDXL checkpoint in Kiln › Models.`);
  const lora = o.lora === false ? null : (e.loras || []).find((n) => /pixel.?art.?xl/i.test(n));
  const seed = o.seed >= 0 ? Math.floor(o.seed) : Math.floor(Math.random() * 2 ** 31);
  const W = o.width || 1024, H = o.height || 1024, steps = o.steps || 28, cfg = o.cfg || 6, wgt = o.loraWeight ?? 1.0;
  const prompt = POS(o.prompt, o.background, o.lora !== false), negative = [NEG, o.negative].filter(Boolean).join(', ');
  onProgress({ msg: `Generating with ${e.name}${lora ? ' + Pixel Art XL' : ''}…` });
  if (e.kind === 'a1111') {
    const body = { prompt: prompt + (lora ? ` <lora:${lora.replace(/\.safetensors$/, '')}:${wgt}>` : ''), negative_prompt: negative, steps, cfg_scale: cfg, width: W, height: H, seed, sampler_name: o.sampler || 'DPM++ 2M', override_settings: { sd_model_checkpoint: ckpt }, override_settings_restore_afterwards: true, batch_size: 1, n_iter: 1 };
    if (o.init) { body.init_images = [o.init.toString('base64')]; body.denoising_strength = o.denoise ?? 0.6; }
    const poll = setInterval(async () => { try { const p = await get(e.url + '/sdapi/v1/progress?skip_current_image=true', { timeout: 2000 }); onProgress({ progress: p.progress }); } catch {} }, 1200);
    try { const r = await get(e.url + (o.init ? '/sdapi/v1/img2img' : '/sdapi/v1/txt2img'), { method: 'POST', body, timeout: 600000 }); return { png: Buffer.from(r.images[0], 'base64'), seed, checkpoint: ckpt, lora: !!lora, engine: e.name }; }
    finally { clearInterval(poll); }
  }
  // ComfyUI
  const g = {}; let n = 1; const add = (class_type, inputs) => { const k = String(n++); g[k] = { class_type, inputs }; return k; };
  const ck = add('CheckpointLoaderSimple', { ckpt_name: ckpt }); let model = [ck, 0], clip = [ck, 1];
  if (lora) { const l = add('LoraLoader', { model, clip, lora_name: lora, strength_model: wgt, strength_clip: wgt }); model = [l, 0]; clip = [l, 1]; }
  const pos = add('CLIPTextEncode', { text: prompt, clip }), neg = add('CLIPTextEncode', { text: negative, clip });
  const lat = add('EmptyLatentImage', { width: W, height: H, batch_size: 1 });
  const ks = add('KSampler', { model, positive: [pos, 0], negative: [neg, 0], latent_image: [lat, 0], seed, steps, cfg, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1 });
  const dec = add('VAEDecode', { samples: [ks, 0], vae: [ck, 2] }); add('SaveImage', { images: [dec, 0], filename_prefix: 'Dither/dither' });
  const q = await get(e.url + '/prompt', { method: 'POST', body: { prompt: g, client_id: 'dither' }, timeout: 15000 });
  if (q.node_errors && Object.keys(q.node_errors).length) throw new Error('ComfyUI rejected the workflow: ' + JSON.stringify(q.node_errors).slice(0, 300));
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const h = (await get(e.url + '/history/' + q.prompt_id, { timeout: 4000 }).catch(() => ({})))[q.prompt_id];
    if (h?.status?.status_str === 'error') throw new Error('ComfyUI hit an error. See its console.');
    const img = Object.values(h?.outputs || {}).flatMap((o2) => o2.images || [])[0];
    if (img) { const u = `${e.url}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type || 'output'}`; const r = await net.fetch(u); return { png: Buffer.from(await r.arrayBuffer()), seed, checkpoint: ckpt, lora: !!lora, engine: e.name }; }
    onProgress({ progress: Math.min(0.95, i / 60) });
  }
  throw new Error('ComfyUI took too long');
}

// Kiln's model libraries (Stability Matrix layout: <library>/Lora)
function kilnLoraFolders() {
  const out = [];
  try {
    const file = path.join(app.getPath('appData'), 'Kiln', 'kiln.json'); const k = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const l of k.libraries || []) if (l.path) out.push({ name: l.name, dir: path.join(l.path, 'Lora'), has: fs.existsSync(path.join(l.path, 'Lora', LORA.file)) });
  } catch {}
  const def = path.join(os.homedir(), 'Downloads', 'Kiln', 'Kiln Files', 'Libraries');
  try { for (const n of fs.readdirSync(def)) { const d = path.join(def, n, 'Lora'); if (!out.some((o) => o.dir === d) && fs.existsSync(d)) out.push({ name: n, dir: d, has: fs.existsSync(path.join(d, LORA.file)) }); } } catch {}
  return out;
}
async function installLora(dirs, onProgress = () => {}) {
  if (!dirs || !dirs.length) throw new Error('Pick a Lora folder (Kiln › Models shows where yours is)');
  const tmp = path.join(app.getPath('temp'), `dither-${Date.now()}-${LORA.file}`);
  const res = await net.fetch(LORA.url); if (!res.ok) throw new Error(`Hugging Face answered ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0; let got = 0; const outS = fs.createWriteStream(tmp);
  const reader = res.body.getReader(); let lastT = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; got += value.length; if (!outS.write(Buffer.from(value))) await new Promise((r) => outS.once('drain', r)); if (Date.now() - lastT > 300) { lastT = Date.now(); onProgress({ got, total }); } }
  await new Promise((r) => outS.end(r));
  for (const d of dirs) { fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(tmp, path.join(d, LORA.file)); }
  fs.unlinkSync(tmp);
  if (last && last.kind === 'a1111') await get(last.url + '/sdapi/v1/refresh-loras', { method: 'POST', body: {}, timeout: 8000 }).catch(() => {});
  return { installed: dirs.map((d) => path.join(d, LORA.file)) };
}

module.exports = { status, detect, detectComfy, generate, installLora, kilnLoraFolders, setCustom: (u) => { custom = String(u || '').trim(); }, LORA };
