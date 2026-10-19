// Kiln — generating images through a running package: Forge/A1111/SD.Next (sdapi) or ComfyUI.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ipcMain, net } = require('electron');
const core = require('../core');
const manager = require('../packages/manager');
const library = require('../models/library');
const png = require('./png');

let send = () => {};
const activeJobs = new Map(); // pkgId -> { id, cancel }

function backendOf(pkgId) {
  const run = manager.running().find(r => r.id === pkgId);
  if (!run || run.state !== 'running' || !run.url) throw new Error('Start a package first. Generate works with Forge, A1111, SD.Next and ComfyUI.');
  if (!run.backend) throw new Error(`${run.name} doesn’t offer an API Kiln can use. Use its own window instead.`);
  const a = core.active();
  if (a && run.profileId && run.profileId !== a.profile.id) throw new Error(`${run.name} is running with ${run.profileName || 'another profile'}’s models. Restart it from Packages to use ${a.profile.name}’s.`);
  const p = manager.getPkg(pkgId);
  return { url: run.url.replace(/\/$/, ''), kind: run.backend, pkg: p, outputsDir: run.outputsDir };
}
async function api(base, p, { method = 'GET', body, timeout = 0 } = {}) {
  const ctl = new AbortController();
  const t = timeout ? setTimeout(() => ctl.abort(), timeout) : null;
  try {
    const res = await net.fetch(base + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    const txt = await res.text();
    let j = null; try { j = JSON.parse(txt); } catch {}
    if (!res.ok) {
      if (res.status === 404 && /sdapi/.test(p)) throw new Error('The API is off. Turn on “Allow Kiln to generate with it” in the package’s launch options and restart it.');
      throw new Error(j?.detail ? (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)) : j?.error?.message || j?.error || `${res.status} ${txt.slice(0, 200)}`);
    }
    return j ?? txt;
  } finally { if (t) clearTimeout(t); }
}

function dayDir() {
  const a = core.active();
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return core.ensureDir(path.join(a.outputsDir, 'Kiln', day));
}
function nextName(dir, seed) {
  let n = 0;
  try { n = fs.readdirSync(dir).filter(f => /^\d{5}-/.test(f)).length; } catch {}
  return path.join(dir, `${String(n).padStart(5, '0')}-${seed}.png`);
}
const toDataUrl = (buf, mime = 'image/png') => `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
const fromDataUrl = (d) => Buffer.from(String(d).replace(/^data:[^,]+,/, ''), 'base64');

/* ================= A1111 / Forge / SD.Next ================= */
async function a1111Options(base, pkg) {
  const safe = (p) => api(base, p).catch(() => []);
  const [models, samplers, schedulers, upscalers, latent, vaes, opts] = await Promise.all([
    safe('/sdapi/v1/sd-models'), safe('/sdapi/v1/samplers'), safe('/sdapi/v1/schedulers'), safe('/sdapi/v1/upscalers'),
    safe('/sdapi/v1/latent-upscale-modes'), safe('/sdapi/v1/sd-vae'), api(base, '/sdapi/v1/options').catch(() => ({}))
  ]);
  if (!Array.isArray(models)) throw new Error('Couldn’t read models from the package');
  return {
    kind: 'a1111', pkgName: pkg.name,
    checkpoints: models.map(m => ({ value: m.title, label: m.model_name, file: m.filename })),
    current: opts.sd_model_checkpoint || '',
    samplers: (samplers || []).map(s => s.name),
    schedulers: ['Automatic', ...(schedulers || []).map(s => s.label || s.name).filter(n => n && n !== 'Automatic')],
    upscalers: [...(latent || []).map(l => l.name), ...(upscalers || []).map(u => u.name).filter(n => n && n !== 'None')],
    vaes: ['Automatic', 'None', ...(vaes || []).map(v => v.model_name)]
  };
}
async function a1111Run(base, pkg, job, { mode, params, initImage }) {
  const p = params;
  const isForge = pkg.catalogId === 'forge' || pkg.catalogId === 'forge-neo';
  const override = { CLIP_stop_at_last_layers: Number(p.clipSkip) || 1 };
  if (p.checkpoint) override.sd_model_checkpoint = p.checkpoint;
  if (p.vae && !isForge) override.sd_vae = p.vae;
  const body = {
    prompt: p.positive, negative_prompt: p.negative || '', steps: Number(p.steps), cfg_scale: Number(p.cfg), width: Number(p.width), height: Number(p.height),
    sampler_name: p.sampler, seed: Number(p.seed ?? -1), batch_size: Number(p.batchSize) || 1, n_iter: Number(p.batchCount) || 1,
    override_settings: override, override_settings_restore_afterwards: false, send_images: true, save_images: false
  };
  if (p.scheduler && p.scheduler !== 'Automatic') body.scheduler = p.scheduler;
  if (isForge && p.vae && !/^(Automatic|None)$/.test(p.vae)) {
    const m = library.scan(library.activeRoot()).find(x => (x.type === 'VAE' || x.type === 'TextEncoders') && (x.file === p.vae || x.name === p.vae || x.name === p.vae.replace(/\.[^.]+$/, '')));
    if (m) body.override_settings.forge_additional_modules = [m.path];
  }
  if (mode === 'img2img') {
    body.init_images = [String(initImage).replace(/^data:[^,]+,/, '')];
    body.denoising_strength = Number(p.denoise ?? 0.6);
    body.resize_mode = 0;
  } else if (p.hires) {
    if (isForge) body.hr_additional_modules = ['Use same choices'];
    Object.assign(body, { enable_hr: true, hr_scale: Number(p.hiresScale) || 1.5, hr_upscaler: p.hiresUpscaler || 'Latent', hr_second_pass_steps: Number(p.hiresSteps) || 0, denoising_strength: Number(p.hiresDenoise) || 0.4 });
  }
  let done = false;
  const poll = (async () => {
    while (!done && !job.cancelled) {
      await new Promise(r => setTimeout(r, 700));
      if (done) break;
      try {
        const pr = await api(base, '/sdapi/v1/progress?skip_current_image=false', { timeout: 4000 });
        send('gen:progress', { jobId: job.id, progress: pr.progress || 0, eta: pr.eta_relative || 0, step: pr.state?.sampling_step, steps: pr.state?.sampling_steps, preview: pr.current_image ? 'data:image/png;base64,' + pr.current_image : null });
      } catch {}
    }
  })();
  let r;
  try { r = await api(base, mode === 'img2img' ? '/sdapi/v1/img2img' : '/sdapi/v1/txt2img', { method: 'POST', body }); }
  finally { done = true; await poll; }
  let info = {};
  try { info = JSON.parse(r.info || '{}'); } catch {}
  const texts = info.infotexts || [];
  const dir = dayDir();
  const images = [];
  const count = (body.batch_size * body.n_iter);
  (r.images || []).slice(0, count).forEach((b64, i) => {
    let buf = Buffer.from(b64, 'base64');
    const seed = info.all_seeds?.[i] ?? info.seed ?? '';
    const txt = texts[i] || texts[0] || '';
    if (txt && !png.readText(buf).parameters) buf = png.writeText(buf, 'parameters', txt);
    const file = nextName(dir, seed);
    fs.writeFileSync(file, buf);
    images.push({ path: file, seed });
  });
  return { images, seed: info.seed, info: texts[0] || '' };
}

/* ================= ComfyUI ================= */
function combo(v) {
  if (!v) return [];
  if (Array.isArray(v[0])) return v[0];
  if (v[0] === 'COMBO' && v[1]?.options) return v[1].options;
  return [];
}
async function comfyOptions(base, pkg) {
  const info = await api(base, '/object_info/CheckpointLoaderSimple');
  const ks = await api(base, '/object_info/KSampler');
  const vae = await api(base, '/object_info/VAELoader').catch(() => ({}));
  const up = await api(base, '/object_info/UpscaleModelLoader').catch(() => ({}));
  return {
    kind: 'comfy', pkgName: pkg.name,
    checkpoints: combo(info.CheckpointLoaderSimple?.input?.required?.ckpt_name).map(n => ({ value: n, label: n.replace(/\.[^.]+$/, '') })),
    current: '',
    samplers: combo(ks.KSampler?.input?.required?.sampler_name),
    schedulers: combo(ks.KSampler?.input?.required?.scheduler),
    upscalers: ['Latent', ...combo(up.UpscaleModelLoader?.input?.required?.model_name)],
    vaes: ['Automatic', ...combo(vae.VAELoader?.input?.required?.vae_name)]
  };
}
async function comfyLoras(base) {
  try { return combo((await api(base, '/object_info/LoraLoader')).LoraLoader?.input?.required?.lora_name); } catch { return []; }
}
function comfyGraph(p, { loras, seed, uploaded, batch }) {
  const g = {};
  let id = 1;
  const add = (class_type, inputs) => { const k = String(id++); g[k] = { class_type, inputs }; return k; };
  const ck = add('CheckpointLoaderSimple', { ckpt_name: p.checkpoint });
  let model = [ck, 0], clip = [ck, 1], vae = [ck, 2];
  for (const l of loras) { const n = add('LoraLoader', { model, clip, lora_name: l.file, strength_model: l.weight, strength_clip: l.weight }); model = [n, 0]; clip = [n, 1]; }
  if (p.vae && p.vae !== 'Automatic') { const v = add('VAELoader', { vae_name: p.vae }); vae = [v, 0]; }
  if (Number(p.clipSkip) > 1) { const c = add('CLIPSetLastLayer', { clip, stop_at_clip_layer: -Number(p.clipSkip) }); clip = [c, 0]; }
  const pos = add('CLIPTextEncode', { text: p.positiveClean, clip });
  const neg = add('CLIPTextEncode', { text: p.negative || '', clip });
  let latent;
  if (uploaded) {
    const img = add('LoadImage', { image: uploaded });
    const sc = add('ImageScale', { image: [img, 0], upscale_method: 'lanczos', width: Number(p.width), height: Number(p.height), crop: 'center' });
    latent = [add('VAEEncode', { pixels: [sc, 0], vae }), 0];
    if (batch > 1) latent = [add('RepeatLatentBatch', { samples: latent, amount: batch }), 0];
  } else latent = [add('EmptyLatentImage', { width: Number(p.width), height: Number(p.height), batch_size: batch }), 0];
  const sched = p.scheduler && p.scheduler !== 'Automatic' ? p.scheduler : 'normal';
  let out = add('KSampler', { model, positive: [pos, 0], negative: [neg, 0], latent_image: latent, seed, steps: Number(p.steps), cfg: Number(p.cfg), sampler_name: p.sampler || 'euler', scheduler: sched, denoise: uploaded ? Number(p.denoise ?? 0.6) : 1 });
  if (!uploaded && p.hires) {
    const upl = add('LatentUpscaleBy', { samples: [out, 0], upscale_method: 'nearest-exact', scale_by: Number(p.hiresScale) || 1.5 });
    out = add('KSampler', { model, positive: [pos, 0], negative: [neg, 0], latent_image: [upl, 0], seed, steps: Number(p.hiresSteps) || Math.max(8, Math.round(Number(p.steps) / 2)), cfg: Number(p.cfg), sampler_name: p.sampler || 'euler', scheduler: sched, denoise: Number(p.hiresDenoise) || 0.4 });
  }
  const dec = add('VAEDecode', { samples: [out, 0], vae });
  add('SaveImage', { images: [dec, 0], filename_prefix: 'Kiln/kiln' });
  return g;
}
async function comfyRun(base, pkg, job, { mode, params, initImage }) {
  const p = { ...params };
  const known = await comfyLoras(base);
  const loras = [];
  p.positiveClean = String(p.positive || '').replace(/<lora:([^:>]+)(?::([-\d.]+))?(?::[-\d.]+)?>/gi, (_m, name, w) => {
    const file = known.find(k => k.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '') === name || k === name);
    if (file) loras.push({ file, weight: Number(w ?? 1) });
    return '';
  }).replace(/(\s*,\s*)+/g, ', ').replace(/^\s*,\s*|\s*,\s*$/g, '').replace(/\s{2,}/g, ' ').trim();
  if (!p.checkpoint) throw new Error('Pick a checkpoint');
  let uploaded = null;
  if (mode === 'img2img' && initImage) {
    const fd = new FormData();
    fd.append('image', new Blob([fromDataUrl(initImage)], { type: 'image/png' }), `kiln-${Date.now()}.png`);
    fd.append('overwrite', 'true');
    const res = await net.fetch(base + '/upload/image', { method: 'POST', body: fd });
    const j = await res.json();
    uploaded = j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
  }
  const clientId = crypto.randomUUID();
  const outputsDir = path.join(job.outputsDir || core.active().outputsDir, 'ComfyUI');
  let ws = null;
  try {
    ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws?clientId=' + clientId);
    ws.binaryType = 'arraybuffer';
  } catch { ws = null; }
  const runs = Math.max(1, Number(p.batchCount) || 1);
  const batch = Math.max(1, Number(p.batchSize) || 1);
  let seed = Number(p.seed);
  if (!(seed >= 0)) seed = Math.floor(Math.random() * 2 ** 32);
  const firstSeed = seed;
  const images = [];
  for (let r = 0; r < runs && !job.cancelled; r++, seed++) {
    const graph = comfyGraph(p, { loras, seed, uploaded, batch });
    const q = await api(base, '/prompt', { method: 'POST', body: { prompt: graph, client_id: clientId } });
    if (q.error || q.node_errors && Object.keys(q.node_errors).length) throw new Error(q.error?.message || 'ComfyUI rejected the workflow');
    const promptId = q.prompt_id;
    await new Promise((resolve, reject) => {
      let finished = false;
      const end = () => { if (!finished) { finished = true; clearInterval(iv); resolve(); } };
      if (ws) {
        ws.onmessage = (ev) => {
          if (typeof ev.data !== 'string') {
            const buf = Buffer.from(ev.data);
            if (buf.readUInt32BE(0) === 1) send('gen:progress', { jobId: job.id, preview: toDataUrl(buf.subarray(8), buf.readUInt32BE(4) === 2 ? 'image/png' : 'image/jpeg') });
            return;
          }
          let m; try { m = JSON.parse(ev.data); } catch { return; }
          if (m.type === 'progress' && m.data?.prompt_id === promptId) send('gen:progress', { jobId: job.id, progress: ((r + m.data.value / m.data.max) / runs), step: m.data.value, steps: m.data.max });
          if (m.type === 'executing' && m.data?.prompt_id === promptId && m.data.node === null) end();
          if (m.type === 'execution_error' && m.data?.prompt_id === promptId) { finished = true; clearInterval(iv); reject(new Error(m.data.exception_message || 'ComfyUI hit an error. See the console.')); }
          if (m.type === 'execution_interrupted' && m.data?.prompt_id === promptId) end();
        };
      }
      const iv = setInterval(async () => {
        try {
          const h = (await api(base, '/history/' + promptId, { timeout: 4000 }))[promptId];
          if (h?.status?.status_str === 'error') { if (!finished) { finished = true; clearInterval(iv); const m = (h.status.messages || []).find(x => x[0] === 'execution_error'); reject(new Error(m?.[1]?.exception_message || 'ComfyUI hit an error. See the console.')); } return; }
          if (h?.status?.completed || (h?.outputs && Object.keys(h.outputs).length)) end();
        } catch {}
        if (job.cancelled) end();
      }, 1500);
    });
    const hist = (await api(base, '/history/' + promptId))[promptId];
    for (const node of Object.values(hist?.outputs || {})) {
      for (const im of node.images || []) {
        if (im.type !== 'output') continue;
        images.push({ path: path.join(outputsDir, im.subfolder || '', im.filename), seed, comfy: im });
      }
    }
  }
  try { ws?.close(); } catch {}
  return { images, seed: firstSeed, info: '' };
}

/* ================= shared ================= */
async function options(pkgId) {
  const b = backendOf(pkgId);
  return b.kind === 'comfy' ? comfyOptions(b.url, b.pkg) : a1111Options(b.url, b.pkg);
}
async function generate({ pkgId, mode = 'txt2img', params, initImage }) {
  const b = backendOf(pkgId);
  if (activeJobs.has(pkgId)) throw new Error('Already generating. Wait for it or press Stop.');
  const job = { id: crypto.randomUUID(), cancelled: false, outputsDir: b.outputsDir };
  activeJobs.set(pkgId, job);
  send('gen:started', { jobId: job.id, pkgId });
  try {
    const run = b.kind === 'comfy' ? comfyRun : a1111Run;
    const res = await run(b.url, b.pkg, job, { mode, params, initImage });
    const a = core.active();
    const entry = { id: job.id, at: Date.now(), mode, pkg: b.pkg.name, positive: params.positive, negative: params.negative, params: { ...params, positive: undefined, negative: undefined }, seed: res.seed, images: res.images.map(i => i.path), info: res.info };
    a.data.history.unshift(entry);
    if (a.data.history.length > 500) a.data.history.length = 500;
    a.store.save();
    return { jobId: job.id, entry, images: res.images.map(i => ({ path: i.path, seed: i.seed })) };
  } finally { activeJobs.delete(pkgId); }
}
async function interrupt(pkgId) {
  const job = activeJobs.get(pkgId);
  if (job) job.cancelled = true;
  const b = backendOf(pkgId);
  if (b.kind === 'comfy') await api(b.url, '/interrupt', { method: 'POST', body: {} }).catch(() => {});
  else await api(b.url, '/sdapi/v1/interrupt', { method: 'POST', body: {} }).catch(() => {});
  return true;
}
async function upscale({ pkgId, imagePath, scale = 2, upscaler }) {
  const b = backendOf(pkgId);
  if (b.kind !== 'a1111') throw new Error('Upscaling from Kiln works with Forge and A1111. In ComfyUI, add an upscale node to your workflow.');
  const img = fs.readFileSync(imagePath).toString('base64');
  const r = await api(b.url, '/sdapi/v1/extra-single-image', { method: 'POST', body: { image: img, upscaling_resize: Number(scale), upscaler_1: upscaler || 'R-ESRGAN 4x+' } });
  const out = path.join(dayDir(), path.basename(imagePath, path.extname(imagePath)) + `-x${scale}.png`);
  fs.writeFileSync(out, Buffer.from(r.image, 'base64'));
  return { path: out };
}
async function refresh(pkgId) {
  const b = backendOf(pkgId);
  if (b.kind === 'a1111') { await api(b.url, '/sdapi/v1/refresh-checkpoints', { method: 'POST', body: {} }).catch(() => {}); await api(b.url, '/sdapi/v1/refresh-loras', { method: 'POST', body: {} }).catch(() => {}); }
  return options(pkgId);
}

function register(ctx) {
  send = ctx.send;
  ipcMain.handle('gen:options', (_e, pkgId) => options(pkgId));
  ipcMain.handle('gen:refresh', (_e, pkgId) => refresh(pkgId));
  ipcMain.handle('gen:run', (_e, opts) => generate(opts));
  ipcMain.handle('gen:interrupt', (_e, pkgId) => interrupt(pkgId));
  ipcMain.handle('gen:upscale', (_e, opts) => upscale(opts));
  ipcMain.handle('gen:history', () => core.active()?.data.history || []);
  ipcMain.handle('gen:pick-image', async () => {
    const { dialog } = require('electron');
    const r = await dialog.showOpenDialog(ctx.getWin(), { title: 'Choose a starting image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const ext = path.extname(r.filePaths[0]).slice(1).toLowerCase().replace('jpg', 'jpeg');
    return toDataUrl(fs.readFileSync(r.filePaths[0]), `image/${ext}`);
  });
  ipcMain.handle('gen:image-from-url', async (_e, url) => {
    if (!/^https?:\/\//.test(url)) throw new Error('Not a web image');
    const res = await net.fetch(url);
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !/^image\//.test(type)) throw new Error('Not an image');
    return toDataUrl(Buffer.from(await res.arrayBuffer()), type.split(';')[0]);
  });
  ipcMain.handle('gen:history-remove', (_e, id) => { const a = core.active(); if (!a) return []; a.data.history = a.data.history.filter(h => h.id !== id); a.store.save(); return a.data.history; });
}

module.exports = { register, generate, options };
