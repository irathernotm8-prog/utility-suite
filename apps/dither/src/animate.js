// Dither — Animate: a character → a video model (local Wan 2.2 or cloud via fal.ai) → a clip → a pixel-art sprite.
// Also turns any video or GIF you drop in into a sprite. Shared by the window (IPC) and Claude (plugin tools).
'use strict';
const fs = require('fs');
const path = require('path');
const png = require('./core/png');
const SP = require('./core/sprite');
const C2S = require('./core/clip2sprite');
const video = require('./video');

function makeAnimate(ctx) {
  // ctx: { active(), engine, frames(bytes, mime, opts), decodeImage(file), settings(), falKey(), changed(kind,id), progress(ev), userData }
  const cache = new Map(); // clip id → raw frames
  const framesOf = (p, id) => { const k = p.dir + id; if (!cache.has(k)) { if (cache.size > 3) cache.delete(cache.keys().next().value); cache.set(k, p.clipFrames(id)); } return cache.get(k); };
  let job = null;

  async function status() {
    let comfy = null; try { const e = await ctx.engine.detectComfy(ctx.settings().comfyUrl); comfy = e ? e.url : null; } catch {}
    const local = comfy ? await video.localStatus(comfy).catch((e) => ({ ready: false, error: e.message })) : { ready: false, reason: 'no-comfy', files: video.WAN.files.map((f) => ({ ...f, found: null })), missingGB: video.WAN.files.reduce((a, f) => a + f.size, 0) };
    const libs = ctx.engine.kilnLoraFolders().map((l) => ({ name: l.name, root: path.dirname(l.dir) }));
    const onDisk = video.WAN.files.map((f) => ({ file: f.file, in: libs.filter((l) => fs.existsSync(path.join(l.root, f.folder, f.file))).map((l) => l.name) }));
    const s = ctx.settings();
    return { local: { comfy, ...local, libraries: libs, onDisk, platformNote: process.platform === 'darwin' ? 'Wan 2.2 runs on Apple Silicon but slowly (minutes per second of video). The Windows PC with the NVIDIA card is much faster.' : null }, cloud: { hasKey: !!ctx.falKey(), model: s.cloudModel || 'kling-3', customId: s.cloudCustomId || '', models: Object.entries(video.CLOUD).map(([k, v]) => ({ id: k, label: v.label, endpoint: v.id })) }, preferred: s.animateEngine || (local.ready ? 'local' : ctx.falKey() ? 'cloud' : 'local'), presets: video.PRESETS, busy: !!job };
  }

  // where the character comes from: a sprite, a picture on disk, or raw RGBA → a square on the green screen
  function sourceImage(src) {
    const p = ctx.active(); let img;
    if (src.sprite) { const s = p.getSprite(src.sprite); img = { w: s.w, h: s.h, data: SP.compose(s, src.frame || 0) }; }
    else if (src.file) img = ctx.decodeImage(src.file);
    else if (src.image) img = src.image;
    else throw new Error('Pick the character to animate: a sprite, or a picture');
    let transparent = 0; for (let i = 3; i < img.data.length; i += 16) if (img.data[i] < 250) transparent++;
    const small = Math.max(img.w, img.h) < 256;
    if (transparent > img.data.length / 64 || small) return { img: C2S.onScreen(img, { size: 640 }), from: img };
    // an opaque picture (e.g. a character generated on green): letterbox it into a square on its own border colour
    const kc = C2S.keyColor(img); const side = Math.max(img.w, img.h); const sq = new Uint8ClampedArray(side * side * 4);
    for (let i = 0; i < sq.length; i += 4) { sq[i] = kc[0]; sq[i + 1] = kc[1]; sq[i + 2] = kc[2]; sq[i + 3] = 255; }
    const ox = (side - img.w) >> 1, oy = (side - img.h) >> 1; for (let y = 0; y < img.h; y++) sq.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((oy + y) * side + ox) * 4);
    let out = { w: side, h: side, data: sq };
    if (side > 1024) { const s2 = 1024 / side; const d = new Uint8ClampedArray(1024 * 1024 * 4); for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) d.set(out.data.subarray(((Math.floor(y / s2)) * side + Math.floor(x / s2)) * 4, ((Math.floor(y / s2)) * side + Math.floor(x / s2)) * 4 + 4), (y * 1024 + x) * 4); out = { w: 1024, h: 1024, data: d }; }
    return { img: out, from: img };
  }

  // generate({ source, preset, prompt, seconds, engine, name, seed }) → clip
  async function generate(o) {
    if (job) throw new Error('A clip is already being made. Wait for it or stop it.');
    const p = ctx.active(); const pre = video.PRESETS[o.preset] || null; const loop = o.loop ?? (pre ? pre.loop : false);
    const text = o.prompt || (pre ? pre.text : ''); if (!text) throw new Error('Describe the motion, or pick a preset (idle, walk, run, attack…)');
    const prompt = video.motionPrompt(text, { loop }); const seconds = Math.max(1, Math.min(6, o.seconds || (pre ? pre.seconds : 2)));
    const { img } = sourceImage(o.source || {}); const engine = o.engine || (await status()).preferred;
    const ctl = new AbortController(); job = { ctl, engine, started: Date.now(), name: o.name };
    const prog = (e) => ctx.progress({ ...e, engine });
    try {
      let raw, fps, engineName;
      if (engine === 'cloud') {
        const s = ctx.settings(); const r = await video.runCloud({ key: ctx.falKey(), model: o.cloudModel || s.cloudModel, customId: s.cloudModel === 'custom' ? s.cloudCustomId : undefined, image: png.encode(img), prompt, seconds, onProgress: prog, signal: ctl.signal });
        prog({ msg: 'Reading frames…', progress: 0.94 }); const ex = await ctx.frames(r.video, r.mime, { fps: 24, maxFrames: 144, maxSize: 512 }); raw = ex.frames; fps = ex.fps; engineName = r.engine;
        fs.mkdirSync(path.join(ctx.userData, 'clips-cache'), { recursive: true }); fs.writeFileSync(path.join(ctx.userData, 'clips-cache', `last.${/webm/.test(r.mime) ? 'webm' : 'mp4'}`), r.video);
      } else {
        const st = await status(); if (!st.local.comfy) throw new Error('No ComfyUI is running. Start ComfyUI in Kiln (Packages), then try again — or switch Animate to the cloud engine.');
        const r = await video.runLocal({ base: st.local.comfy, image: img, prompt, seconds, size: o.size || 640, seed: o.seed, onProgress: prog, signal: ctl.signal });
        raw = r.frames.map((f) => (Math.max(f.w, f.h) > 512 ? shrink(f, 512) : f)); fps = r.fps; engineName = r.engine;
      }
      const clip = p.saveClip({ name: o.name || (pre ? `${pre.label}` : text.slice(0, 40)), frames: raw, fps, source: img, meta: { prompt: text, preset: o.preset || null, loop, align: o.align || (pre ? pre.align : 'feet'), engine: engineName, seconds, by: o.by || 'you', source: o.source && o.source.sprite ? { sprite: o.source.sprite } : null } });
      ctx.changed('clip', clip.id); prog({ msg: 'Done', progress: 1, done: true, clip: clip.id }); return clip;
    } finally { job = null; }
  }
  function stop() { if (job) job.ctl.abort(); return true; }

  async function importFile(file, { name, by = 'you' } = {}) {
    const p = ctx.active(); const ext = path.extname(file).toLowerCase(); const mime = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4', '.webm': 'video/webm', '.gif': 'image/gif', '.webp': 'image/webp', '.png': 'image/png' }[ext];
    if (!mime) throw new Error('Drop an MP4, MOV, WebM, GIF or animated WebP');
    const ex = await ctx.frames(fs.readFileSync(file), mime, { fps: 24, maxFrames: 144, maxSize: 512 });
    if (!ex.frames.length) throw new Error('No frames in that file');
    const clip = p.saveClip({ name: name || path.basename(file, ext), frames: ex.frames, fps: ex.fps, meta: { imported: path.basename(file), loop: false, align: 'feet', by } });
    ctx.changed('clip', clip.id); return clip;
  }

  // toSprite(id, opts, keep) — preview or keep; opts as clip2sprite.convert
  function toSprite(id, opts = {}, { keep = false, name } = {}) {
    const p = ctx.active(); const clip = p.getClip(id); const raw = framesOf(p, id);
    const r = C2S.convert(raw, clip.fps, { align: clip.align || 'feet', loop: clip.loop, ...opts });
    if (!keep) return { ...r, clip };
    const s = SP.fromFrames({ name: name || `${clip.name}`, w: r.w, h: r.h, frames: r.frames, durations: r.durations, palette: r.palette.length ? r.palette : 'pico8' });
    s.from = { clip: id, opts }; p.saveSprite(s); p.patchClip(id, { sprites: [...(clip.sprites || []), s.id] }); ctx.changed('sprite', s.id);
    return { sprite: s.id, w: r.w, h: r.h, frames: r.frames.length, info: r.info };
  }
  function rawPreview(id, { count = 24, max = 192 } = {}) { const p = ctx.active(); const clip = p.getClip(id); const raw = framesOf(p, id); const step = Math.max(1, Math.floor(raw.length / count)); const pick = raw.filter((_, i) => i % step === 0).slice(0, count).map((f) => (Math.max(f.w, f.h) > max ? shrink(f, max) : f)); return { clip, w: pick[0].w, h: pick[0].h, frames: pick.map((f) => f.data), durations: pick.map(() => Math.round(1000 * step / clip.fps)) }; }

  // the Wan 2.2 files: into every Kiln library (downloaded once, then linked), or a folder you choose
  async function installWan({ dir } = {}, onProgress = () => {}) {
    const libs = dir ? [] : ctx.engine.kilnLoraFolders().map((l) => path.dirname(l.dir)); if (!dir && !libs.length) throw new Error('Kiln’s model library wasn’t found. Choose your ComfyUI models folder instead.');
    const out = [];
    for (const f of video.WAN.files) {
      const targets = dir ? [path.join(dir, f.comfyDir, f.file)] : libs.map((r) => path.join(r, f.folder, f.file));
      let have = targets.find((t) => fs.existsSync(t));
      if (!have) { onProgress({ file: f.file, got: 0, total: f.size * 1e9 }); have = await video.download(f.url, targets[0], (e) => onProgress({ file: f.file, ...e })); }
      for (const t of targets) if (!fs.existsSync(t)) { fs.mkdirSync(path.dirname(t), { recursive: true }); try { fs.linkSync(have, t); } catch { fs.copyFileSync(have, t); } }
      out.push(...targets);
    }
    return { installed: out, note: 'Restart ComfyUI in Kiln so it sees the new files.' };
  }

  return { status, generate, stop, importFile, toSprite, rawPreview, sourceImage, installWan, list: () => ctx.active().listClips(), remove: (id) => { ctx.active().removeClip(id); ctx.changed('clip', id); return true; }, rename: (id, name) => ctx.active().patchClip(id, { name }), patch: (id, p) => ctx.active().patchClip(id, p) };
}
function shrink(f, max) { const s = max / Math.max(f.w, f.h); const w = Math.max(1, Math.round(f.w * s)), h = Math.max(1, Math.round(f.h * s)); const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (Math.min(f.h - 1, Math.floor(y / s)) * f.w + Math.min(f.w - 1, Math.floor(x / s))) * 4; d[(y * w + x) * 4] = f.data[i]; d[(y * w + x) * 4 + 1] = f.data[i + 1]; d[(y * w + x) * 4 + 2] = f.data[i + 2]; d[(y * w + x) * 4 + 3] = f.data[i + 3]; } return { w, h, data: d }; }

module.exports = { makeAnimate };
