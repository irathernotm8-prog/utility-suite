// RO2 — the lite video side. A design's pages become scenes; scenes, transitions and music go through RO3's
// FFmpeg timeline engine (src/engine, shared with RO3) to make MP4, WebM or GIF.
//
// The renderer sends each page as layers in paint order:
//   { kind:'png',   file|data }                       still layers flattened to a W×H picture (transparent where empty)
//   { kind:'html',  key|html, w, h, cx, cy, width, height, angle, opacity }   an HTML layer, frame-stepped (html.js)
//   { kind:'video', path, in, out, cx, cy, width, height, angle, opacity, muted, volume }   a video clip on the page
// Pages with only stills become picture clips; anything that moves is composed into a scene file first.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { FFMPEG, runFfmpeg, probe } = require('./engine/ffmpeg');
const timeline = require('./engine/timeline');
const media = require('./engine/media');
const html = require('./html');

const WORK = () => path.join(os.tmpdir(), 'ro2-video');
const f3 = (n) => (Math.round(n * 1000) / 1000).toFixed(3);
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

function workDir() { const d = path.join(WORK(), `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`); fs.mkdirSync(d, { recursive: true }); return d; }
function cleanOld() { try { for (const f of fs.readdirSync(WORK())) { const p = path.join(WORK(), f); if (Date.now() - fs.statSync(p).mtimeMs > 6 * 3600e3) fs.rmSync(p, { recursive: true, force: true }); } } catch {} }

// An HTML layer's frames → a lossless clip with see-through (QuickTime Animation), streamed straight from the capture
async function htmlClip(layer, { fps, durationMs, out, onProgress, signal }) {
  const scale = Math.min(4, Math.max(0.1, layer.width / layer.w));
  const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', '-c:v', 'qtrle', '-pix_fmt', 'argb', out], { windowsHide: true });
  let err = ''; ff.stderr.on('data', (d) => { err += d; });
  const closed = new Promise((res, rej) => { ff.on('error', rej); ff.on('close', (c) => (c === 0 ? res() : rej(new Error('Could not record the HTML animation: ' + err.trim().split('\n').pop())))); });
  const write = (buf) => new Promise((res, rej) => { if (!ff.stdin.write(buf)) ff.stdin.once('drain', res); else res(); ff.stdin.once('error', rej); });
  try {
    await html.frames(layer.key ? { key: layer.key } : { html: layer.html, w: layer.w, h: layer.h }, { scale, fps, durationMs, startMs: layer.start || 0, onFrame: write, onProgress, signal });
  } finally { ff.stdin.end(); }
  await closed; return out;
}

// One page with moving parts → an H.264 scene (with sound from its video clips), or straight to a transparent WebM
async function composeScene(page, i, { W, H, fps, dir, onProgress, signal, final }) {
  const dur = Math.max(0.2, +page.duration || 3); const inputs = []; const graph = []; let n = 0; const audio = [];
  const add = (...a) => { inputs.push(...a); return n++; };
  const dyn = page.layers.filter((l) => l.kind === 'html').length || 1; let done = 0;
  // still layers to files
  for (const [k, l] of page.layers.entries()) if (l.kind === 'png' && !l.file) { l.file = path.join(dir, `p${i}-s${k}.png`); fs.writeFileSync(l.file, Buffer.from(l.data, 'base64')); delete l.data; }
  graph.push(`color=c=black@0.0:s=${W}x${H}:r=${fps}:d=${f3(dur)},format=rgba[b0]`);
  let cur = 'b0';
  for (const [k, l] of page.layers.entries()) {
    let src;
    if (l.kind === 'png') { src = add('-loop', '1', '-framerate', String(fps), '-t', f3(dur + 0.2), '-i', l.file); graph.push(`[${src}:v]format=rgba,trim=duration=${f3(dur)}[l${k}]`); graph.push(`[${cur}][l${k}]overlay=0:0:eof_action=repeat[c${k}]`); cur = `c${k}`; continue; }
    if (l.kind === 'html') {
      const file = path.join(dir, `p${i}-h${k}.mov`);
      await htmlClip(l, { fps, durationMs: dur * 1000, out: file, signal, onProgress: (p) => onProgress && onProgress((done + p) / dyn) }); done++;
      src = add('-i', file);
    } else if (l.kind === 'video') {
      const len = Math.max(0.05, (l.out ?? dur) - (l.in || 0));
      src = add('-ss', f3(l.in || 0), '-t', f3(Math.min(len, dur) + 0.2), '-i', l.path);
      if (l.hasAudio && !l.muted && (l.volume ?? 1) > 0) audio.push(`[${src}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${f3(Math.min(len, dur))},asetpts=PTS-STARTPTS,volume=${f3(l.volume ?? 1)}`);
    } else continue;
    const w = even(l.width), h = even(l.height); const rad = ((l.angle || 0) * Math.PI) / 180;
    const fx = [`setpts=PTS-STARTPTS`, `fps=${fps}`, `scale=${w}:${h}:flags=lanczos`, 'format=rgba'];
    if (l.kind === 'video') fx.push(`tpad=stop_mode=clone:stop_duration=${f3(dur)}`);
    if (Math.abs(rad) > 1e-4) fx.push(`rotate=a=${f3(rad)}:c=none:ow=rotw(${f3(rad)}):oh=roth(${f3(rad)})`);
    if ((l.opacity ?? 1) < 0.999) fx.push(`colorchannelmixer=aa=${f3(l.opacity)}`);
    fx.push(`trim=duration=${f3(dur)}`);
    graph.push(`[${src}:v]${fx.join(',')}[l${k}]`);
    graph.push(`[${cur}][l${k}]overlay=x='${f3(l.cx)}-overlay_w/2':y='${f3(l.cy)}-overlay_h/2':eof_action=pass:format=auto[c${k}]`); cur = `c${k}`;
  }
  const m = final && final.music; // music straight into a one-page export (the see-through WebM)
  if (m && m.path) {
    const src = add('-ss', f3(+m.in || 0), '-t', f3(dur + 0.2), '-i', m.path); const fo = Math.min(+m.fadeOut || 0, dur / 2), fi = Math.min(+m.fadeIn || 0, dur / 2);
    audio.push(`[${src}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${f3(dur)},asetpts=PTS-STARTPTS,volume=${f3(m.volume ?? 0.8)}${fi > 0 ? `,afade=t=in:d=${f3(fi)}` : ''}${fo > 0 ? `,afade=t=out:st=${f3(dur - fo)}:d=${f3(fo)}` : ''}`);
  }
  const transparent = final && final.transparent;
  graph.push(`[${cur}]trim=duration=${f3(dur)},setsar=1,format=${transparent ? 'yuva420p' : 'yuv420p'}[vout]`);
  if (audio.length) { audio.forEach((a, k) => graph.push(`${a}[sa${k}]`)); graph.push(`${audio.map((_, k) => `[sa${k}]`).join('')}amix=inputs=${audio.length}:normalize=0:duration=longest,apad,atrim=duration=${f3(dur)}[aout]`); }
  else graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${f3(dur)}[aout]`);
  const out = final ? final.output : path.join(dir, `scene-${i}.mp4`);
  const enc = final && /\.webm$/i.test(out)
    ? ['-c:v', 'libvpx-vp9', '-pix_fmt', transparent ? 'yuva420p' : 'yuv420p', '-b:v', '0', '-crf', '30', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '3', ...(transparent ? ['-auto-alt-ref', '0'] : []), '-c:a', 'libopus', '-b:a', '160k']
    : ['-c:v', 'libx264', '-preset', final ? 'medium' : 'veryfast', '-crf', final ? '20' : '14', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];
  await runFfmpeg([...inputs, '-filter_complex', graph.join(';'), '-map', '[vout]', '-map', '[aout]', ...enc, '-r', String(fps), '-t', f3(dur), out], { duration: dur, signal });
  return out;
}

// spec = { W, H, fps, output, quality, transparent, gif:{fps,width}, music:{path,volume,fadeIn,fadeOut,in}, pages:[{duration, transition:{type,duration}, layers}] }
async function exportVideo(spec, onProgress = () => {}, signal) {
  cleanOld();
  const dir = workDir(); const W = even(spec.W), H = even(spec.H); const fps = Math.max(1, Math.min(60, Math.round(spec.fps || 30)));
  const ext = path.extname(spec.output).slice(1).toLowerCase();
  const pages = spec.pages || []; if (!pages.length) throw new Error('Nothing to export.');
  const moving = (p) => p.layers.some((l) => l.kind !== 'png');
  const weight = pages.map((p) => (moving(p) ? 3 : 0.2)); const total = weight.reduce((a, b) => a + b, 0) + 2; let acc = 0;
  const stage = (k) => (p) => onProgress(Math.min(0.99, (acc + weight[k] * p) / total));
  try {
    // a single moving page with see-through: straight to WebM with alpha (the timeline engine works without alpha)
    if (spec.transparent && ext === 'webm' && pages.length === 1) {
      await composeScene(pages[0], 0, { W, H, fps, dir, signal, onProgress: (p) => onProgress(p * 0.95), final: { output: spec.output, transparent: true, music: spec.music } });
      onProgress(1); return { output: spec.output, bytes: fs.statSync(spec.output).size, duration: pages[0].duration };
    }
    const clips = [];
    for (const [k, p] of pages.entries()) {
      const d = Math.max(0.2, +p.duration || 3); const tr = k > 0 && p.transition && p.transition.type && p.transition.type !== 'none' ? { type: p.transition.type, duration: Math.min(+p.transition.duration || 0.6, d / 2) } : undefined;
      if (!moving(p)) {
        const l = p.layers.find((x) => x.kind === 'png'); const file = path.join(dir, `page-${k}.png`);
        fs.writeFileSync(file, l ? Buffer.from(l.data, 'base64') : Buffer.alloc(0));
        if (tr) clips[k - 1].transition = tr; // the engine (shared with RO3) keeps a transition on the clip it leaves
        clips.push({ path: file, kind: 'image', in: 0, out: d }); acc += weight[k]; continue;
      }
      const file = await composeScene(p, k, { W, H, fps, dir, signal, onProgress: stage(k) }); acc += weight[k];
      if (tr) clips[k - 1].transition = tr;
      clips.push({ path: file, kind: 'video', in: 0, out: d, hasAudio: true, volume: 1 });
    }
    const totalDur = timeline.sequenceDuration ? timeline.sequenceDuration(clips) : clips.reduce((a, c) => a + (c.out - c.in), 0);
    const audio = [];
    if (spec.music && spec.music.path) audio.push({ path: spec.music.path, start: 0, in: +spec.music.in || 0, out: (+spec.music.in || 0) + totalDur, volume: spec.music.volume ?? 0.8, fadeIn: spec.music.fadeIn ?? 0, fadeOut: spec.music.fadeOut ?? 1.5 });
    const project = { settings: { width: W, height: H, fps, fit: 'contain' }, clips, overlays: [], audio };
    const r = await timeline.renderProject(project, { output: spec.output, quality: spec.quality || 'high', gif: spec.gif || { fps: Math.min(fps, 15), width: Math.min(W, 720) }, preview: !!spec.preview }, (p) => onProgress(Math.min(0.999, (acc + 2 * p) / total)), signal);
    onProgress(1);
    return r;
  } finally { fs.rm(dir, { recursive: true, force: true }, () => {}); }
}

// Video and music files used in designs are copied into <designs>/Media so designs keep working when the original moves
async function importMedia(file, mediaDir) {
  const info = await probe(file);
  if (!info.hasVideo && !info.hasAudio) throw new Error('That file has no video or sound.');
  fs.mkdirSync(mediaDir, { recursive: true });
  const st = fs.statSync(file); const id = require('crypto').createHash('sha1').update(`${path.basename(file)}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 12);
  const dest = path.join(mediaDir, `${path.basename(file, path.extname(file)).replace(/[^\w.-]+/g, '-').slice(0, 40)}-${id}${path.extname(file).toLowerCase()}`);
  if (!fs.existsSync(dest)) fs.copyFileSync(file, dest);
  const poster = info.hasVideo ? await media.frameAt(dest, Math.min(0.5, info.duration / 3), Math.min(1080, info.height || 720)) : null;
  return { path: dest, name: path.basename(file), duration: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio, hasVideo: info.hasVideo, poster };
}
const posterAt = (file, t, height = 720) => media.frameAt(file, t, height);

module.exports = { exportVideo, importMedia, posterAt, probe, WORK };
