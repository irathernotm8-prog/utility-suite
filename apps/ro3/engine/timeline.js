// Turns a video-editor project into a single FFmpeg filter graph and renders it.
//
// project = {
//   settings: { width, height, fps, fadeIn, fadeOut, fit, audioCrossfade, duck:{on,amount}, mix:{main,overlay,music} },
//   clips:    [{ path, kind:'video'|'image', in, out, speed, hasAudio, volume, muted, transition:{type,duration}, fx:{…}, grade, afx }],
//   overlays: [{ path, kind:'video'|'image'|'title', start, in, out, x, y, scale, opacity, rotation, fadeIn, fadeOut, hasAudio, volume, muted, kf, key, afx }],
//   audio:    [{ path, start, in, out, volume, fadeIn, fadeOut, afx }],
// }
// out = { output, quality, preview, codec, prores, bitrate, loudnorm, gif:{fps,width}, chapters, sequence }
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runFfmpeg, FFMPEG } = require('./ffmpeg');
const { encoderArgs, QUALITY } = require('./media');
const { extOf } = require('./formats');
const ColorGrade = require('../src/js/color-grade.js');

// Every xfade style. Names added in FFmpeg 7 are checked against the bundled binary at runtime.
const XFADE = ['fade', 'fadeblack', 'fadewhite', 'fadegrays', 'fadefast', 'fadeslow', 'dissolve', 'distance',
  'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'wipetl', 'wipetr', 'wipebl', 'wipebr',
  'slideleft', 'slideright', 'slideup', 'slidedown', 'smoothleft', 'smoothright', 'smoothup', 'smoothdown',
  'coverleft', 'coverright', 'coverup', 'coverdown', 'revealleft', 'revealright', 'revealup', 'revealdown',
  'circleopen', 'circleclose', 'circlecrop', 'rectcrop', 'radial', 'horzopen', 'horzclose', 'vertopen', 'vertclose',
  'diagtl', 'diagtr', 'diagbl', 'diagbr', 'hlslice', 'hrslice', 'vuslice', 'vdslice', 'hlwind', 'hrwind', 'vuwind', 'vdwind',
  'squeezeh', 'squeezev', 'pixelize', 'zoomin', 'hblur'];
const TRANSITIONS = Object.fromEntries([['none', null], ...XFADE.map(n => [n, n])]);
let xfadeSupported = null;
/** Transition names the bundled FFmpeg actually knows (older builds lack the cover, reveal and fadefast styles). */
function supportedTransitions() {
  if (xfadeSupported) return xfadeSupported;
  try {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-h', 'filter=xfade'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const text = (r.stdout || '') + (r.stderr || '');
    xfadeSupported = new Set(XFADE.filter(n => new RegExp('\\b' + n + '\\b').test(text)));
    if (!xfadeSupported.size) throw new Error('none');
  } catch (_) { xfadeSupported = new Set(['fade', 'fadeblack', 'fadewhite', 'dissolve', 'distance', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft', 'slideright', 'slideup', 'slidedown', 'smoothleft', 'smoothright', 'circleopen', 'circleclose', 'radial', 'pixelize', 'zoomin', 'hblur']); }
  return xfadeSupported;
}
const xfadeName = t => supportedTransitions().has(t) ? t : 'fade';
/** FFmpeg frame-rate string: NTSC rates as exact rationals. */
const rateOf = fps => ({ 23.976: '24000/1001', 29.97: '30000/1001', 59.94: '60000/1001', 47.952: '48000/1001' })[fps] || String(fps || 30);

const f3 = n => Number(n).toFixed(3);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const CACHE = path.join(os.tmpdir(), 'ro3-cache');
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

// ---------- keyframes ----------
const EASE = {
  linear: u => u,
  ease: u => `(${u})*(${u})*(3-2*(${u}))`,
  in: u => `(${u})*(${u})`,
  out: u => `(1-(1-(${u}))*(1-(${u})))`,
};
/** Piecewise expression for keyframes [{t, v, ease}] in variable `T` (seconds). */
function kfExpr(list, T, scale = 1) {
  const k = [...list].sort((a, b) => a.t - b.t);
  if (!k.length) return null;
  const v = x => f3(x * scale);
  if (k.length === 1) return v(k[0].v);
  let e = v(k[k.length - 1].v);
  for (let i = k.length - 2; i >= 0; i--) {
    const a = k[i], b = k[i + 1], span = Math.max(1e-3, b.t - a.t);
    const u = `clip((${T}-${f3(a.t)})/${f3(span)},0,1)`;
    const seg = a.ease === 'hold' ? v(a.v) : `${v(a.v)}+(${v(b.v - a.v)})*${(EASE[a.ease] || EASE.linear)(u)}`;
    e = `if(lt(${T},${f3(b.t)}),${seg},${e})`;
  }
  return `if(lt(${T},${f3(k[0].t)}),${v(k[0].v)},${e})`;
}
const hasKf = (o, p) => !!(o.kf && o.kf[p] && o.kf[p].length);

// ---------- audio effects ----------
/** Audio effect chain for a clip / overlay / music item. */
function audioFx(a = {}) {
  const f = [];
  if (!a) return f;
  if (a.voice) f.push('highpass=f=80', 'afftdn=nr=12:nf=-30', 'acompressor=threshold=0.1:ratio=3:attack=10:release=180:makeup=1.6', 'equalizer=f=3200:t=q:w=1:g=3');
  if (a.highpass > 0) f.push(`highpass=f=${Math.round(a.highpass)}`);
  if (a.lowpass > 0) f.push(`lowpass=f=${Math.round(a.lowpass)}`);
  if (a.dehum) for (let k = 1; k <= 4; k++) f.push(`bandreject=f=${a.dehum * k}:width_type=h:w=${2 + k}`);
  if (a.denoise > 0) f.push(`afftdn=nr=${f3(6 + a.denoise * 0.34)}:nf=-28`);
  if (a.low) f.push(`bass=g=${f3(a.low)}:f=110`);
  if (a.mid) f.push(`equalizer=f=1200:t=q:w=0.9:g=${f3(a.mid)}`);
  if (a.high) f.push(`treble=g=${f3(a.high)}:f=5000`);
  if (a.deess > 0) f.push(`deesser=i=${f3(Math.min(1, a.deess / 100))}`);
  if (a.compress > 0) f.push(`acompressor=threshold=${f3(Math.pow(10, (-10 - a.compress * 0.25) / 20))}:ratio=${f3(1.5 + a.compress / 20)}:attack=8:release=160:makeup=${f3(Math.min(8, 1 + a.compress / 60))}`);
  if (a.pitch) {
    const k = Math.pow(2, a.pitch / 12);
    f.push(`asetrate=${Math.round(48000 * k)}`, 'aresample=48000', ...atempo(1 / k));
  }
  if (a.reverb > 0) { const r = a.reverb / 100; f.push(`aecho=0.85:${f3(0.9 - r * 0.2)}:${[37, 53, 79, 113].join('|')}:${[0.45, 0.35, 0.25, 0.18].map(d => f3(d * r)).join('|')}`); }
  if (a.limiter) f.push('alimiter=limit=0.891:attack=5:release=50:level=disabled');
  if (a.gain) f.push(`volume=${f3(Math.pow(10, a.gain / 20))}`);
  return f;
}

// ---------- clip picture effects ----------
/** Effects that go before scaling (on source pixels). */
function preScaleFx(fx = {}) {
  const f = [];
  if (fx.stabilize) f.push('deshake=rx=32:ry=32:edge=mirror');
  const c = fx.crop;
  if (c && (c.l || c.t || c.r || c.b)) {
    const l = c.l / 100, t = c.t / 100, r = c.r / 100, b = c.b / 100;
    f.push(`crop=iw*${f3(Math.max(0.02, 1 - l - r))}:ih*${f3(Math.max(0.02, 1 - t - b))}:iw*${f3(l)}:ih*${f3(t)}`);
  }
  if (fx.denoise > 0) { const s = 1 + fx.denoise / 12; f.push(`hqdn3d=${f3(s)}:${f3(s * 0.75)}:${f3(s * 1.5)}:${f3(s * 1.1)}`); }
  return f;
}
/** Scale to the frame: fit (letterbox) or fill (crop). */
function frameFit(fx, W, H) {
  return (fx && fx.fit === 'fill')
    ? [`scale=${W}:${H}:force_original_aspect_ratio=increase:flags=bicubic`, `crop=${W}:${H}`]
    : [`scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=bicubic`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`];
}
/** Ken Burns pan & zoom across the clip's length (zoompan, upscaled 2× first so motion stays smooth). */
function kenBurns(kb, W, H, F, d) {
  if (!kb || !kb.on) return [];
  const N = Math.max(1, Math.round(d * Number(F))); // frames
  const z0 = Math.max(1, kb.z0 || 1), z1 = Math.max(1, kb.z1 || 1.3);
  const u = `min(on/${N},1)`, ez = `(${u})*(${u})*(3-2*(${u}))`;
  const cx = (a, b) => `(${f3(a)}+(${f3(b - a)})*${ez})`;
  return [`scale=${W * 2}:${H * 2}:flags=bicubic`,
    `zoompan=z='${f3(z0)}+(${f3(z1 - z0)})*${ez}':x='(iw-iw/zoom)*${cx(kb.x0 ?? 0.5, kb.x1 ?? 0.5)}':y='(ih-ih/zoom)*${cx(kb.y0 ?? 0.5, kb.y1 ?? 0.5)}':d=1:s=${W}x${H}:fps=${rateOf(F)}`];
}
/** Effects after scaling & colour. Returns filters; `branch` marks effects that need a split (glow). */
function postFx(fx = {}) {
  const f = [];
  if (fx.blur > 0) f.push(`gblur=sigma=${f3(fx.blur / 5)}`);
  if (fx.sharpen > 0) f.push(`unsharp=5:5:${f3(fx.sharpen / 40)}:5:5:0`);
  if (fx.rgbsplit > 0) f.push(`rgbashift=rh=${-Math.round(fx.rgbsplit)}:bh=${Math.round(fx.rgbsplit)}`);
  if (fx.grain > 0) f.push(`noise=alls=${Math.round(fx.grain / 3)}:allf=t`);
  if (fx.echo > 0) f.push(`tmix=frames=${Math.max(2, Math.round(2 + fx.echo / 20))}`);
  if (fx.posterizeTime > 0) f.push(`fps=${fx.posterizeTime}`);
  if (fx.edges) f.push('edgedetect=mode=colormix:high=0.2:low=0.05');
  return f;
}
/** Write a grade as a .cube LUT into the cache folder; returns the file name (FFmpeg runs with cwd there). */
function lutFile(grade, dir) {
  if (!grade || !ColorGrade.isColorActive(grade)) return null;
  const g = { ...grade };
  if (g.lut && g.lut.text) { try { g.lut = { ...ColorGrade.parseLut(g.lut.text, g.lut.name), amount: g.lut.amount }; } catch (_) { g.lut = null; } }
  else g.lut = null;
  const key = require('crypto').createHash('sha1').update(ColorGrade.key(g) + (grade.lut && grade.lut.text ? grade.lut.text.length + grade.lut.text.slice(0, 200) : '')).digest('hex').slice(0, 16);
  const name = `grade-${key}.cube`, full = path.join(dir, name);
  if (!fs.existsSync(full)) fs.writeFileSync(full, ColorGrade.toCube(ColorGrade.bake(g, 33)));
  return name;
}
function gradeFx(grade, dir) {
  const f = [], g = grade || {};
  const lut = lutFile(grade, dir);
  if (lut) f.push(`lut3d=file=${lut}:interp=tetrahedral`);
  if (g.sharpen > 0) f.push(`unsharp=5:5:${f3(g.sharpen / 50)}:5:5:0`);
  if (g.vignette > 0) f.push(`vignette=angle=${f3(0.25 + g.vignette / 100 * 0.6)}:x0=w/2:y0=h/2:mode=forward`);
  return f;
}

function videoCodecArgs(ext, out) {
  const Q = QUALITY[out.quality] || QUALITY.balanced;
  if (out.codec === 'hevc' && ['mp4', 'm4v', 'mov', 'mkv'].includes(ext)) {
    return ['-c:v', 'libx265', '-preset', 'medium', '-crf', String(Q.crf + 4), '-pix_fmt', 'yuv420p', ...(ext === 'mkv' ? [] : ['-tag:v', 'hvc1']), '-c:a', 'aac', '-b:a', Q.abr, ...(ext === 'mkv' ? [] : ['-movflags', '+faststart'])];
  }
  if (out.codec === 'prores' && ext === 'mov') return ['-c:v', 'prores_ks', '-profile:v', String(out.prores ?? 3), '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0', '-c:a', 'pcm_s16le'];
  if (out.codec === 'dnxhr' && ['mov', 'mxf', 'mkv'].includes(ext)) return ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hq', '-pix_fmt', 'yuv422p', '-c:a', 'pcm_s16le'];
  const args = encoderArgs(ext, out.quality);
  if (out.bitrate > 0) {
    // target bitrate (platform presets): replace CRF with VBR limits
    const i = args.indexOf('-crf'); const mb = out.bitrate;
    if (i >= 0) args.splice(i, 2, '-b:v', mb + 'M', '-maxrate', Math.round(mb * 1.5) + 'M', '-bufsize', Math.round(mb * 2) + 'M');
    const ab = args.indexOf('-b:a'); if (ab >= 0 && out.abitrate) args[ab + 1] = out.abitrate;
  }
  return args;
}

/** Build ffmpeg args. out = { output, quality, preview, codec, loudnorm, gif:{fps,width} } */
function buildArgs(project, out) {
  const clips = (project.clips || []).filter(c => clipLen(c) > 0.04);
  if (!clips.length) throw new Error('Add at least one clip to the timeline before exporting.');
  const S = project.settings || {};
  let W = even(S.width || 1920), H = even(S.height || 1080);
  const F = S.fps || 30, R = rateOf(F);
  const dir = out.cacheDir || CACHE;
  const xc = S.audioCrossfade || 'qsin';
  const mix = S.mix || {};
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
    const fit = { fit: fx.fit || S.fit };
    const vf = [`trim=duration=${f3(src)}`, sp !== 1 ? `setpts=(PTS-STARTPTS)/${sp}` : 'setpts=PTS-STARTPTS', ...(fx.reverse && c.kind !== 'image' ? ['reverse'] : []),
      ...preScaleFx(fx), ...pictureFx(fx),
      ...frameFit(fit, W, H), 'setsar=1', ...kenBurns(fx.kb, W, H, F, d), `fps=${R}`, 'format=yuv420p',
      ...colorFx(fx), ...gradeFx(c.grade, dir), ...postFx(fx), ...(fx.posterizeTime > 0 ? [`fps=${R}`] : []),
      'tpad=stop_mode=clone:stop_duration=1', `trim=duration=${f3(d)}`];
    if (fx.fadeIn > 0) vf.push(`fade=t=in:st=0:d=${f3(Math.min(fx.fadeIn, d / 2))}`);
    if (fx.fadeOut > 0) vf.push(`fade=t=out:st=${f3(Math.max(0, d - fx.fadeOut))}:d=${f3(Math.min(fx.fadeOut, d / 2))}`);
    if (fx.glow > 0) {
      // glow: screen a blurred copy over the picture
      graph.push(`[${idx}:v:0]${vf.join(',')},settb=AVTB,split[g${i}a][g${i}b]`);
      graph.push(`[g${i}b]gblur=sigma=${f3(6 + fx.glow / 6)}[g${i}c]`);
      graph.push(`[g${i}a][g${i}c]blend=all_mode=screen:all_opacity=${f3(Math.min(1, fx.glow / 100))},format=yuv420p[v${i}]`);
    } else graph.push(`[${idx}:v:0]${vf.join(',')},settb=AVTB[v${i}]`);
    if (c.kind !== 'image' && c.hasAudio && !c.muted && (c.volume ?? 1) > 0) {
      const af = ['aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', `atrim=duration=${f3(src)}`, 'asetpts=PTS-STARTPTS', ...(fx.reverse ? ['areverse'] : []), ...atempo(sp), ...audioFx(c.afx), `volume=${f3(c.volume ?? 1)}`];
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
      graph.push(`[${v}][v${i}]xfade=transition=${xfadeName(TRANSITIONS[clips[i - 1].transition.type])}:duration=${f3(td)}:offset=${f3(acc - td)}[${nv}]`);
      graph.push(`[${a}][a${i}]acrossfade=d=${f3(td)}:c1=${xc}:c2=${xc}[${na}]`);
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
    else {
      f.push(...preScaleFx(o.fx), ...pictureFx(o.fx));
      const key = o.key;
      if (key && key.on) {
        // green/blue screen: remove the key colour (colorkey + despill)
        const hex = String(key.color || '#00ff00').replace('#', '0x');
        f.push('format=rgba');
        const kc = String(key.color || '#00ff00').replace('#', ''), isBlue = parseInt(kc.slice(4, 6), 16) > parseInt(kc.slice(2, 4), 16);
        if (key.spill > 0) f.push(`despill=type=${isBlue ? 'blue' : 'green'}:mix=${f3(key.spill / 100)}:expand=0`);
        f.push(`colorkey=color=${hex}:similarity=${f3(Math.max(0.01, (key.similarity ?? 30) / 100))}:blend=${f3((key.smooth ?? 10) / 100)}`);
      }
      const rotK = hasKf(o, 'rotation'), rot0 = o.rotation || 0;
      if (rotK || rot0) f.push('format=rgba', `rotate=a='${rotK ? kfExpr(o.kf.rotation, 't', Math.PI / 180) : f3(rot0 * Math.PI / 180)}':c=none:ow='hypot(iw,ih)':oh='ow'`);
      if (hasKf(o, 'scale')) f.push(`scale=w='2*trunc(${kfExpr(o.kf.scale, 't', W)}/2)':h=-2:eval=frame:flags=bicubic`);
      else f.push(`scale=${even(Math.max(0.02, o.scale || 0.35) * W)}:-2:flags=bicubic`);
    }
    f.push(`fps=${R}`, 'format=rgba', ...colorFx(o.fx), ...gradeFx(o.grade, dir));
    if (o.fadeIn > 0) f.push(`fade=t=in:st=0:d=${f3(Math.min(o.fadeIn, len / 2))}:alpha=1`);
    if (o.fadeOut > 0) f.push(`fade=t=out:st=${f3(Math.max(0, len - o.fadeOut))}:d=${f3(Math.min(o.fadeOut, len / 2))}:alpha=1`);
    if (hasKf(o, 'opacity')) f.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${kfExpr(o.kf.opacity, 'T')})'`);
    else if ((o.opacity ?? 1) < 1) f.push(`colorchannelmixer=aa=${f3(o.opacity)}`);
    f.push(`setpts=PTS+${f3(o.start)}/TB`);
    graph.push(`[${idx}:v:0]${f.join(',')}[ov${k}]`);
    const lt = `(t-${f3(o.start)})`;
    const px = hasKf(o, 'x') ? kfExpr(o.kf.x, lt, W) : f3((o.x ?? 0.5) * W), py = hasKf(o, 'y') ? kfExpr(o.kf.y, lt, H) : f3((o.y ?? 0.5) * H);
    const pos = o.kind === 'title' ? 'x=0:y=0' : `x='${px}-overlay_w/2':y='${py}-overlay_h/2'`;
    graph.push(`[${v}][ov${k}]overlay=${pos}:eof_action=pass:enable='between(t,${f3(o.start)},${f3(o.start + len)})'[vo${k}]`);
    v = `vo${k}`;
    if (o.kind === 'video' && o.hasAudio && !o.muted && (o.volume ?? 1) > 0) extraAudio.push({ idx, start: o.start, len, volume: (o.volume ?? 1) * (mix.overlay ?? 1), fadeIn: o.fadeIn, fadeOut: o.fadeOut, afx: o.afx, lane: 'overlay' });
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
    extraAudio.push({ idx, start: m.start, len, volume: (m.volume ?? 1) * (mix.music ?? 1), fadeIn: m.fadeIn, fadeOut: m.fadeOut, afx: m.afx, lane: 'music' });
  }
  let aOut = 'amain';
  if ((mix.main ?? 1) !== 1) { graph.push(`[amain]volume=${f3(mix.main)}[amainv]`); aOut = 'amainv'; }
  if (extraAudio.length) {
    const labels = [], musicLabels = [];
    extraAudio.forEach((m, k) => {
      const fades = [];
      if (m.fadeIn) fades.push(`afade=t=in:st=0:d=${f3(Math.min(m.fadeIn, m.len / 2))}`);
      if (m.fadeOut) fades.push(`afade=t=out:st=${f3(Math.max(0, m.len - m.fadeOut))}:d=${f3(Math.min(m.fadeOut, m.len))}`);
      const delay = Math.round(m.start * 1000), fx = audioFx(m.afx);
      graph.push(`[${m.idx}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${f3(m.len)},asetpts=PTS-STARTPTS,` +
        `${fx.length ? fx.join(',') + ',' : ''}volume=${f3(m.volume)}${fades.length ? ',' + fades.join(',') : ''},adelay=${delay}|${delay}[mu${k}]`);
      (m.lane === 'music' ? musicLabels : labels).push(`mu${k}`);
    });
    const duck = S.duck && S.duck.on && musicLabels.length;
    if (duck) {
      // auto-ducking: the main track's sound compresses the music (sidechain)
      const amt = clamp(S.duck.amount ?? 12, 3, 30);
      graph.push(`[${aOut}]asplit=2[amd][asc]`); aOut = 'amd';
      graph.push(`${musicLabels.map(l => `[${l}]`).join('')}amix=inputs=${musicLabels.length}:duration=longest:normalize=0[mus0]`);
      graph.push(`[mus0][asc]sidechaincompress=threshold=${f3(S.duck.threshold ?? 0.04)}:ratio=${f3(2 + amt / 2)}:attack=${Math.round((S.duck.attack ?? 0.15) * 1000)}:release=${Math.round((S.duck.release ?? 0.8) * 1000)}:makeup=1[musd]`);
      labels.push('musd');
    } else labels.push(...musicLabels);
    graph.push(`[${aOut}]${labels.map(l => `[${l}]`).join('')}amix=inputs=${labels.length + 1}:duration=first:normalize=0:dropout_transition=0[amix]`);
    aOut = 'amix';
  }
  if (out.loudnorm && !out.preview) { const I = typeof out.loudnorm === 'number' ? out.loudnorm : -14; graph.push(`[${aOut}]loudnorm=I=${I}:TP=-1.5:LRA=11,aresample=48000[aloud]`); aOut = 'aloud'; }
  // chapters from markers (MP4/MOV/MKV)
  let meta = [];
  if (out.chapters && ['mp4', 'mov', 'm4v', 'mkv'].includes(ext)) {
    const mp = path.join(dir, `chapters-${Date.now()}.txt`); fs.writeFileSync(mp, out.chapters);
    const mi = addInput('-f', 'ffmetadata', '-i', mp);
    meta = ['-map_metadata', String(mi), '-map_chapters', String(mi)];
  }

  let args;
  if (ext === 'gif') {
    const g = out.gif || {};
    graph.push(`[${aOut}]anullsink`);
    graph.push(`[vmain]fps=${g.fps || 15},scale=${g.width || 480}:-2:flags=lanczos,split[g1][g2];[g1]palettegen=stats_mode=diff[gp];[g2][gp]paletteuse=dither=bayer:bayer_scale=4[vgif]`);
    args = [...inputs, '-filter_complex', graph.join(';'), '-map', '[vgif]', '-loop', '0', out.output];
  } else if (out.sequence) {
    // image sequence: name_00001.png …
    graph.push(`[${aOut}]anullsink`);
    args = [...inputs, '-filter_complex', graph.join(';'), '-map', '[vmain]', '-f', 'image2', '-start_number', '1', ...(ext === 'jpg' ? ['-q:v', '2'] : []), out.output];
  } else if (audioOnly) {
    graph.push('[vmain]nullsink');
    args = [...inputs, '-filter_complex', graph.join(';'), '-map', `[${aOut}]`, ...encoderArgs(ext, out.quality), out.output];
  } else {
    let enc = videoCodecArgs(ext, out);
    if (out.preview) enc = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'];
    args = [...inputs, '-filter_complex', graph.join(';'), '-map', '[vmain]', '-map', `[${aOut}]`, ...meta, ...enc, '-r', R, out.output];
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
  fs.mkdirSync(CACHE, { recursive: true });
  const { args, duration } = buildArgs(ready, { ...out, cacheDir: CACHE });
  // runs inside the cache folder so LUT files are referenced by bare name (no drive-letter escaping on Windows)
  await runFfmpeg(args, { duration, onProgress, signal, cwd: CACHE });
  if (out.sequence) { const first = out.output.replace(/%0\d+d/, m => '1'.padStart(Number(m.slice(2, -1)), '0')); const st = await fs.promises.stat(first).catch(() => ({ size: 0 })); return { output: first, bytes: st.size, duration }; }
  const stat = await fs.promises.stat(out.output);
  return { output: out.output, bytes: stat.size, duration };
}

module.exports = { buildArgs, renderProject, sequenceDuration, clipLen, TRANSITIONS, supportedTransitions, kfExpr, audioFx, rateOf };
