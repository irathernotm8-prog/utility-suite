// Audio / video conversion, thumbnails, filmstrips and preview proxies.
const fs = require('fs');
const { runFfmpeg, ffmpegToBuffer, probe } = require('./ffmpeg');
const { extOf } = require('./formats');

const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus', 'aac'];

const QUALITY = {
  high:     { crf: 18, vp9: 28, abr: '256k', preset: 'slow' },
  balanced: { crf: 22, vp9: 32, abr: '192k', preset: 'medium' },
  small:    { crf: 28, vp9: 38, abr: '128k', preset: 'medium' },
};

/** Encoder args for a target container. `copy` = {video, audio} booleans for stream copy. */
function encoderArgs(ext, q, copy = {}) {
  const Q = QUALITY[q] || QUALITY.balanced;
  const x264 = ['-c:v', 'libx264', '-preset', Q.preset, '-crf', String(Q.crf), '-pix_fmt', 'yuv420p'];
  const aac = ['-c:a', 'aac', '-b:a', Q.abr];
  switch (ext) {
    case 'mp4': case 'm4v': case 'mov':
      return [...(copy.video ? ['-c:v', 'copy'] : x264), ...(copy.audio ? ['-c:a', 'copy'] : aac), '-movflags', '+faststart'];
    case 'mkv':
      return [...(copy.video ? ['-c:v', 'copy'] : x264), ...(copy.audio ? ['-c:a', 'copy'] : aac)];
    case 'webm':
      return [...(copy.video ? ['-c:v', 'copy'] : ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(Q.vp9), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '3', '-pix_fmt', 'yuv420p']),
        ...(copy.audio ? ['-c:a', 'copy'] : ['-c:a', 'libopus', '-b:a', '160k'])];
    case 'avi':
      return ['-c:v', 'mpeg4', '-q:v', q === 'small' ? '6' : q === 'high' ? '2' : '3', '-c:a', 'libmp3lame', '-b:a', Q.abr];
    case 'mp3': return ['-vn', '-c:a', 'libmp3lame', '-b:a', q === 'high' ? '320k' : q === 'small' ? '128k' : '192k'];
    case 'wav': return ['-vn', '-c:a', 'pcm_s16le'];
    case 'm4a': case 'aac': return ['-vn', '-c:a', 'aac', '-b:a', Q.abr];
    case 'flac': return ['-vn', '-c:a', 'flac'];
    case 'ogg': return ['-vn', '-c:a', 'libopus', '-b:a', '160k'];
    case 'opus': return ['-vn', '-c:a', 'libopus', '-b:a', q === 'small' ? '96k' : '160k'];
    default: throw new Error(`RO3 can't write .${ext} files.`);
  }
}

/** Decide whether streams can be copied into the target container (lossless + very fast). */
function copyPlan(info, ext) {
  const v = info.vcodec, a = info.acodec;
  const mp4ish = ['mp4', 'm4v', 'mov'];
  if (mp4ish.includes(ext)) {
    return { video: ['h264', 'hevc', 'av1', 'mpeg4'].includes(v), audio: !a || ['aac', 'mp3', 'alac', 'ac3', 'eac3'].includes(a) };
  }
  if (ext === 'mkv') return { video: !!v, audio: true };
  if (ext === 'webm') return { video: ['vp8', 'vp9', 'av1'].includes(v), audio: !a || ['opus', 'vorbis'].includes(a) };
  return { video: false, audio: false };
}

/**
 * Convert one media file.
 * job = { input, output, quality, fastCopy, resize: {height}, gif: {fps, width}, trim: {start, end} }
 */
async function convertMedia(job, onProgress, signal) {
  const info = await probe(job.input);
  const ext = extOf(job.output);
  const start = job.trim && job.trim.start || 0;
  const end = job.trim && job.trim.end || 0;
  const dur = Math.max(0.1, (end || info.duration) - start);
  const pre = [];
  if (start) pre.push('-ss', String(start));
  if (end) pre.push('-to', String(end));
  pre.push('-i', job.input);

  let args;
  if (ext === 'gif') {
    if (!info.hasVideo) throw new Error('This file has no video to turn into a GIF.');
    const fps = (job.gif && job.gif.fps) || 15;
    const width = (job.gif && job.gif.width) || 480;
    args = [...pre, '-filter_complex',
      `[0:v]fps=${fps},scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
      '-loop', '0', job.output];
  } else if (AUDIO_EXTS.includes(ext)) {
    if (!info.hasAudio) throw new Error('This file has no audio track to extract.');
    args = [...pre, '-map', '0:a:0', ...encoderArgs(ext, job.quality), job.output];
  } else {
    if (!info.hasVideo) throw new Error('This file has no video stream.');
    const wantScale = job.resize && job.resize.height && job.resize.height < info.height;
    const copy = job.fastCopy && !wantScale && !start && !end ? copyPlan(info, ext) : { video: false, audio: false };
    const maps = ['-map', '0:v:0', '-map', '0:a?'];
    const filters = wantScale ? ['-vf', `scale=-2:${job.resize.height}:flags=lanczos`] : [];
    const tag = copy.video && info.vcodec === 'hevc' && ['mp4', 'm4v', 'mov'].includes(ext) ? ['-tag:v', 'hvc1'] : [];
    args = [...pre, ...maps, ...filters, ...encoderArgs(ext, job.quality, copy), ...tag, '-sn', '-map_metadata', '0', job.output];
  }
  await runFfmpeg(args, { duration: dur, onProgress, signal });
  const stat = await fs.promises.stat(job.output);
  return { output: job.output, bytes: stat.size };
}

async function frameAt(file, t = 0, height = 180) {
  const buf = await ffmpegToBuffer(['-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-vf', `scale=-2:${height}`, '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '4', 'pipe:1']);
  return 'data:image/jpeg;base64,' + buf.toString('base64');
}

async function thumbnail(file) {
  const info = await probe(file);
  if (!info.hasVideo) return null;
  return frameAt(file, Math.min(1, info.duration * 0.1), 180);
}

/** A strip of N frames across the whole clip, used to paint timeline clips. */
async function filmstrip(file, duration, frames = 12, height = 56) {
  const fps = Math.max(0.01, frames / Math.max(0.5, duration));
  const buf = await ffmpegToBuffer(['-i', file, '-vf', `fps=${fps.toFixed(4)},scale=-2:${height},tile=${frames}x1`, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '5', 'pipe:1']);
  return 'data:image/jpeg;base64,' + buf.toString('base64');
}

async function waveform(file, width = 1200, height = 56) {
  const buf = await ffmpegToBuffer(['-i', file, '-filter_complex', `aformat=channel_layouts=mono,showwavespic=s=${width}x${height}:colors=#3ddc84`, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1']);
  return 'data:image/png;base64,' + buf.toString('base64');
}

/** Low-res H.264 copy for formats Chromium can't play (MKV/AVI/WMV…). */
async function makeProxy(file, out, onProgress, signal) {
  const info = await probe(file);
  await runFfmpeg(['-i', file, '-map', '0:v:0?', '-map', '0:a:0?', '-vf', 'scale=-2:min(720\\,ih)', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out], { duration: info.duration, onProgress, signal });
  return out;
}

module.exports = { convertMedia, encoderArgs, frameAt, thumbnail, filmstrip, waveform, makeProxy, probe, QUALITY };
