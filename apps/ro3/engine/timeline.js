// Turns a video-editor project into a single FFmpeg filter graph and renders it.
//
// project = {
//   settings: { width, height, fps, fadeIn, fadeOut },
//   clips:    [{ path, kind:'video'|'image', in, out, speed, hasAudio, volume, muted, transition:{type,duration}, fx:{…} }],
//   overlays: [{ path, kind:'video'|'image'|'title', start, in, out, x, y, scale, opacity, fadeIn, fadeOut, hasAudio, volume, muted }],
//   audio:    [{ path, start, in, out, volume, fadeIn, fadeOut }],
// }
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runFfmpeg } = require('./ffmpeg');
const { encoderArgs, QUALITY } = require('./media');
const { extOf } = require('./formats');

const TRANSITIONS = {
  none: null, fade: 'fade', fadeblack: 'fadeblack', fadewhite: 'fadewhite', dissolve: 'dissolve',
  wipeleft: 'wipeleft', wiperight: 'wiperight', wipeup: 'wipeup', wipedown: 'wipedown',
  slideleft: 'slideleft', slideright: 'slideright', slideup: 'slideup', slidedown: 'slidedown',
  smoothleft: 'smoothleft', smoothright: 'smoothright', circleopen: 'circleopen', circleclose: 'circleclose',
  radial: 'radial', pixelize: 'pixelize', zoomin: 'zoomin', hblur: 'hblur', distance: 'distance',
};

const f3 = n => Number(n).toFixed(3);
const even = n => Math.max(2, Math.round(n / 2) * 2);
const speedOf = c => c.kind === 'image' ? 1 : Math.min(8, Math.max(0.1, c.speed || 1));
/** Length of a clip on the timeline (source length ÷ speed). */
const clipLen = c => (c.out - c.in) / speedOf(c);
const AUDIO_ONLY = ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus', 'aac'];
// Image formats FFmpeg can't decode itself; these are converted to PNG before rendering.
const NEEDS_PNG = ['psd', 'avif', 'svg', 'ico', 'heic', 'heif', 'jxl', 'tif', 'tiff'];

function transitionLength(prev, next, accDur) {
  const t = prev.transition;
  if (!t || !TRANSITIONS[t.type]) return 0;
  return Math.max(0.1, Math.min(t.duration || 1, accDur - 0.1, clipLen(next) - 0.1));
}
function sequenceDuration(clips) {
  let total = 0;
  clips.forEach((c, i) => { const d = clipLen(c); total += d; if (i > 0) total -= transitionLength(clips[i - 1], c, total - d); });
  return total;
}

/** atempo only accepts 0.5–2, so chain it for bigger changes. */
function atempo(speed) {
  const parts = [];
  let s = speed;
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-3) parts.push(`atempo=${s.toFixed(4)}`);
  return parts;
}

/** Per-clip picture filters: rotation, flips and colour. */
function pictureFx(fx = {}) {
  const f = [];
  const rot = ((fx.rotate || 0) % 360 + 360) % 360;
  if (rot === 90) f.push('transpose=1'); else if (rot === 180) f.push('hflip,vflip'); else if (rot === 270) f.push('transpose=2');
  if (fx.flipH) f.push('hflip');
  if (fx.flipV) f.push('vflip');
  return f;
}
function colorFx(fx = {}) {
  const f = [];
  const b = (fx.brightness || 0) / 250, c = 1 + (fx.contrast || 0) / 100, s = 1 + (fx.saturation || 0) / 100, g = fx.gamma || 1;
  if (b || c !== 1 || s !== 1 || g !== 1) f.push(`eq=brightness=${f3(b)}:contrast=${f3(c)}:saturation=${f3(Math.max(0, s))}:gamma=${f3(g)}`);
  if (fx.hue) f.push(`hue=h=${f3(fx.hue)}`);
  if (fx.temperature) { const t = fx.temperature / 100 * 0.25; f.push(`colorbalance=rm=${f3(t)}:bm=${f3(-t)}:rh=${f3(t / 2)}:bh=${f3(-t / 2)}`); }
  return f;
}

function videoCodecArgs(ext, out) {
  const Q = QUALITY[out.quality] || QUALITY.balanced;
  if (out.codec === 'hevc' && ['mp4', 'm4v', 'mov', 'mkv'].includes(ext)) {
    return ['-c:v', 'libx265', '-preset', 'medium', '-crf', String(Q.crf + 4), '-pix_fmt', 'yuv420p', ...(ext === 'mkv' ? [] : ['-tag:v', 'hvc1']), '-c:a', 'aac', '-b:a', Q.abr, ...(ext === 'mkv' ? [] : ['-movflags', '+faststart'])];
  }
  if (out.codec === 'prores' && ext === 'mov') return ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0', '-c:a', 'pcm_s16le'];
  return encoderArgs(ext, out.quality);
}

/** Build ffmpeg args. out = { output, quality, preview, codec, loudnorm, gif:{fps,width} } */
function buildArgs(project, out) {
  const clips = (project.clips || []).filter(c => clipLen(c) > 0.04);
  if (!clips.length) throw new Error('Add at least one clip to the timeline before exporting.');
  const S = project.settings || {};
  let W = even(S.width || 1920), H = even(S.height || 1080);
  const F = S.fps || 30;
  if (out.preview) { const k = Math.min(1, 480 / H); W = even(W * k); H = even(H * k); }
  const ext = extOf(out.output);
  const audioOnly = AUDIO_ONLY.includes(ext);

  const inputs = [];
  const graph = [];
  let nIn = 0;
  const addInput = (...args) => { inputs.push(...args); return nIn++; };

  // ---- main track
  clips.forEach((c, i) => {
    const src = c.out - c.in, d = clipLen(c), sp = speedOf(c), fx = c.fx || {};
    const idx = c.kind === 'image'
      ? addInput('-loop', '1', '-framerate', String(F), '-t', f3(d + 0.5), '-i', c.path)
      : addInput('-ss', f3(c.in), '-t', f3(src + 0.5), '-i', c.path);
    const vf = [`trim=duration=${f3(src)}`, sp !== 1 ? `setpts=(PTS-STARTPTS)/${sp}` : 'setpts=PTS-STARTPTS', ...pictureFx(fx),
      `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=bicubic`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`, 'setsar=1', `fps=${F}`, 'format=yuv420p',
      ...colorFx(fx), 'tpad=stop_mode=clone:stop_duration=1', `trim=duration=${f3(d)}`];
    if (fx.fadeIn > 0) vf.push(`fade=t=in:st=0:d=${f3(Math.min(fx.fadeIn, d / 2))}`);
    if (fx.fadeOut > 0) vf.push(`fade=t=out:st=${f3(Math.max(0, d - fx.fadeOut))}:d=${f3(Math.min(fx.fadeOut, d / 2))}`);
    graph.push(`[${idx}:v:0]${vf.join(',')},settb=AVTB[v${i}]`);
    if (c.kind !== 'image' && c.hasAudio && !c.muted && (c.volume ?? 1) > 0) {
      const af = ['aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', `atrim=duration=${f3(src)}`, 'asetpts=PTS-STARTPTS', ...atempo(sp), `volume=${f3(c.volume ?? 1)}`];
      if (fx.fadeIn > 0) af.push(`afade=t=in:st=0:d=${f3(Math.min(fx.fadeIn, d / 2))}`);
      if (fx.fadeOut > 0) af.push(`afade=t=out:st=${f3(Math.max(0, d - fx.fadeOut))}:d=${f3(Math.min(fx.fadeOut, d / 2))}`);
      graph.push(`[${idx}:a:0]${af.join(',')},apad,atrim=duration=${f3(d)}[a${i}]`);
    } else {
      graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${f3(d)},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    }
  });

  let v = 'v0', a = 'a0', acc = clipLen(clips[0]);
  for (let i = 1; i < clips.length; i++) {
    const d = clipLen(clips[i]);
    const td = transitionLength(clips[i - 1], clips[i], acc);
    const nv = `vx${i}`, na = `ax${i}`;
    if (td > 0) {
      graph.push(`[${v}][v${i}]xfade=transition=${TRANSITIONS[clips[i - 1].transition.type]}:duration=${f3(td)}:offset=${f3(acc - td)}[${nv}]`);
      graph.push(`[${a}][a${i}]acrossfade=d=${f3(td)}:c1=tri:c2=tri[${na}]`);
      acc += d - td;
    } else {
      graph.push(`[${v}][${a}][v${i}][a${i}]concat=n=2:v=1:a=1[${nv}][${na}]`);
      acc += d;
    }
    v = nv; a = na;
  }

  // ---- overlay track (picture-in-picture, logos, titles)
  const extraAudio = [];
  const overlays = (project.overlays || []).filter(o => o.out - o.in > 0.04 && o.start < acc);
  overlays.forEach((o, k) => {
    const len = Math.min(o.out - o.in, acc - o.start);
    const still = o.kind === 'image' || o.kind === 'title';
    const idx = still ? addInput('-loop', '1', '-framerate', String(F), '-t', f3(len + 0.5), '-i', o.path)
      : addInput('-ss', f3(o.in), '-t', f3(len + 0.5), '-i', o.path);
    const f = [`trim=duration=${f3(len)}`, 'setpts=PTS-STARTPTS'];
    if (o.kind === 'title') f.push(`scale=${W}:${H}`);
    else f.push(...pictureFx(o.fx), `scale=${even(Math.max(0.02, o.scale || 0.35) * W)}:-2:flags=bicubic`);
    f.push(`fps=${F}`, 'format=rgba', ...colorFx(o.fx));
    if (o.fadeIn > 0) f.push(`fade=t=in:st=0:d=${f3(Math.min(o.fadeIn, len / 2))}:alpha=1`);
    if (o.fadeOut > 0) f.push(`fade=t=out:st=${f3(Math.max(0, len - o.fadeOut))}:d=${f3(Math.min(o.fadeOut, len / 2))}:alpha=1`);
    if ((o.opacity ?? 1) < 1) f.push(`colorchannelmixer=aa=${f3(o.opacity)}`);
    f.push(`setpts=PTS+${f3(o.start)}/TB`);
    graph.push(`[${idx}:v:0]${f.join(',')}[ov${k}]`);
    const pos = o.kind === 'title' ? 'x=0:y=0' : `x=${f3((o.x ?? 0.5) * W)}-overlay_w/2:y=${f3((o.y ?? 0.5) * H)}-overlay_h/2`;
    graph.push(`[${v}][ov${k}]overlay=${pos}:eof_action=pass:enable='between(t,${f3(o.start)},${f3(o.start + len)})'[vo${k}]`);
    v = `vo${k}`;
    if (o.kind === 'video' && o.hasAudio && !o.muted && (o.volume ?? 1) > 0) extraAudio.push({ idx, start: o.start, len, volume: o.volume ?? 1, fadeIn: o.fadeIn, fadeOut: o.fadeOut, ofInput: true });
  });

  // ---- global fade in / out
  const vf = [], af = [];
  if (S.fadeIn > 0) { vf.push(`fade=t=in:st=0:d=${f3(S.fadeIn)}`); af.push(`afade=t=in:st=0:d=${f3(S.fadeIn)}`); }
  if (S.fadeOut > 0) {
    const st = Math.max(0, acc - S.fadeOut);
    vf.push(`fade=t=out:st=${f3(st)}:d=${f3(S.fadeOut)}`); af.push(`afade=t=out:st=${f3(st)}:d=${f3(S.fadeOut)}`);
  }
  graph.push(`[${v}]${vf.length ? vf.join(',') : 'null'}[vmain]`);
  graph.push(`[${a}]${af.length ? af.join(',') : 'anull'}[amain]`);

  // ---- music lane + overlay audio
  const music = (project.audio || []).filter(m => m.out - m.in > 0.05 && m.start < acc);
  for (const m of music) {
    const len = Math.min(m.out - m.in, acc - m.start);
    const idx = addInput('-ss', f3(m.in), '-t', f3(len + 0.2), '-i', m.path);
    extraAudio.push({ idx, start: m.start, len, volume: m.volume ?? 1, fadeIn: m.fadeIn, fadeOut: m.fadeOut });
  }
  let aOut = 'amain';
  if (extraAudio.length) {
    const labels = ['amain'];
    extraAudio.forEach((m, k) => {
      const fades = [];
      if (m.fadeIn) fades.push(`afade=t=in:st=0:d=${f3(Math.min(m.fadeIn, m.len / 2))}`);
      if (m.fadeOut) fades.push(`afade=t=out:st=${f3(Math.max(0, m.len - m.fadeOut))}:d=${f3(Math.min(m.fadeOut, m.len))}`);
      const delay = Math.round(m.start * 1000);
      graph.push(`[${m.idx}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${f3(m.len)},asetpts=PTS-STARTPTS,` +
        `volume=${f3(m.volume)}${fades.length ? ',' + fades.join(',') : ''},adelay=${delay}|${delay}[mu${k}]`);
      labels.push(`mu${k}`);
    });
    graph.push(`${labels.map(l => `[${l}]`).join('')}amix=inputs=${labels.length}:duration=first:normalize=0:dropout_transition=0[amix]`);
    aOut = 'amix';
  }
  if (out.loudnorm && !out.preview) { graph.push(`[${aOut}]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aloud]`); aOut = 'aloud'; }

  let args;
  if (ext === 'gif') {
    const g = out.gif || {};
    graph.push(`[${aOut}]anullsink`);
    graph.push(`[vmain]fps=${g.fps || 15},scale=${g.width || 480}:-2:flags=lanczos,split[g1][g2];[g1]palettegen=stats_mode=diff[gp];[g2][gp]paletteuse=dither=bayer:bayer_scale=4[vgif]`);
    args = [...inputs, '-filter_complex', graph.join(';'), '-map', '[vgif]', '-loop', '0', out.output];
  } else if (audioOnly) {
    graph.push('[vmain]nullsink');
    args = [...inputs, '-filter_complex', graph.join(';'), '-map', `[${aOut}]`, ...encoderArgs(ext, out.quality), out.output];
  } else {
    let enc = videoCodecArgs(ext, out);
    if (out.preview) enc = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'];
    args = [...inputs, '-filter_complex', graph.join(';'), '-map', '[vmain]', '-map', `[${aOut}]`, ...enc, '-r', String(F), out.output];
  }
  return { args, duration: acc };
}

/** Convert still images FFmpeg can't read (PSD, AVIF, SVG…) to temporary PNGs. */
async function prepareStills(project) {
  const image = require('./image');
  const dir = path.join(os.tmpdir(), 'ro3-cache');
  fs.mkdirSync(dir, { recursive: true });
  const map = new Map();
  const fix = async (item) => {
    if (!item || item.kind === 'title' || !NEEDS_PNG.includes(extOf(item.path))) return item;
    if (!map.has(item.path)) {
      const out = path.join(dir, 'still-' + Buffer.from(item.path).toString('base64url').slice(-48) + '.png');
      if (!fs.existsSync(out)) await image.convertImage({ input: item.path, output: out });
      map.set(item.path, out);
    }
    return { ...item, path: map.get(item.path) };
  };
  return {
    ...project,
    clips: await Promise.all((project.clips || []).map(c => c.kind === 'image' ? fix(c) : c)),
    overlays: await Promise.all((project.overlays || []).map(o => o.kind === 'image' ? fix(o) : o)),
  };
}

async function renderProject(project, out, onProgress, signal) {
  const ready = await prepareStills(project);
  const { args, duration } = buildArgs(ready, out);
  await runFfmpeg(args, { duration, onProgress, signal });
  const stat = await fs.promises.stat(out.output);
  return { output: out.output, bytes: stat.size, duration };
}

module.exports = { buildArgs, renderProject, sequenceDuration, clipLen, TRANSITIONS };
