// Crate — FFmpeg work: convert to MP3, apply edits, square artwork, waveforms, silence detection
const fs = require('fs');
const tools = require('./tools');

const QUALITY = {
  '320': ['-b:a', '320k'],
  '256': ['-b:a', '256k'],
  '192': ['-b:a', '192k'],
  'v0': ['-q:a', '0']
};

// File facts from FFmpeg's own report (no separate ffprobe binary to ship).
async function probe(file) {
  const r = await tools.run(tools.ffmpeg(), ['-hide_banner', '-nostdin', '-i', file]);
  const e = r.stderr;
  const a = /Stream #\S+?(?:\[\w+\])?(?:\(\w+\))?: Audio: (\w+)[^\n]*?(\d+) Hz, ([^,\n]+)[^\n]*/.exec(e);
  if (!a) {
    if (/No such file|Invalid data|could not find codec/i.test(e)) throw new Error('Could not read this file: ' + lastLine(e));
    throw new Error('This file has no audio.');
  }
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(e);
  const duration = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0;
  const sbr = /(\d+) kb\/s/.exec(a[0]);
  const fbr = /Duration:[^\n]*bitrate: (\d+) kb\/s/.exec(e);
  let size = 0; try { size = fs.statSync(file).size; } catch {}
  return {
    duration, bitrate: sbr ? +sbr[1] : fbr ? +fbr[1] : 0, sampleRate: +a[2],
    channels: /stereo/.test(a[3]) ? 2 : /mono/.test(a[3]) ? 1 : 2, codec: a[1], size
  };
}

// Tags from any audio file (m4a, flac, ...) via FFmpeg's metadata writer.
async function readTags(file) {
  const r = await tools.run(tools.ffmpeg(), ['-hide_banner', '-nostdin', '-i', file, '-f', 'ffmetadata', '-']);
  const out = {};
  if (r.code !== 0) return out;
  const text = r.stdout.replace(/\\\r?\n/g, '\u0001');
  for (const line of text.split(/\r?\n/)) {
    if (!line || line[0] === ';' || line[0] === '[') continue;
    const m = /^((?:\\.|[^=])+)=(.*)$/.exec(line);
    if (!m) continue;
    const unesc = (v) => v.replace(/\u0001/g, '\n').replace(/\\(.)/g, '$1');
    const k = unesc(m[1]).toLowerCase();
    if (!(k in out)) out[k] = unesc(m[2]);
  }
  return out;
}

const lastLine = (s) => String(s || '').trim().split('\n').filter(Boolean).slice(-1)[0] || 'unknown error';

/**
 * Encode `src` to an MP3 at `dst`.
 * opts: quality, normalize, start, end (seconds), fadeIn, fadeOut (seconds), gainDb, duration (of the source, for progress), onProgress(0..1), signal
 */
async function toMp3(src, dst, opts = {}) {
  const { quality = '320', normalize = false, start = 0, end = 0, fadeIn = 0, fadeOut = 0, gainDb = 0, onProgress, signal } = opts;
  let duration = opts.duration;
  if (!duration) { try { duration = (await probe(src)).duration; } catch { duration = 0; } }
  const s = Math.max(0, Number(start) || 0);
  const e = end && end > s ? Math.min(Number(end), duration || Number(end)) : duration;
  const len = Math.max(0.1, (e || 0) - s);

  const args = ['-hide_banner', '-nostdin', '-y'];
  if (s > 0) args.push('-ss', s.toFixed(3));
  args.push('-i', src);
  if (end && e) args.push('-t', len.toFixed(3));
  const filters = [];
  if (gainDb) filters.push(`volume=${Number(gainDb).toFixed(2)}dB`);
  if (normalize) filters.push('loudnorm=I=-14:TP=-1.0:LRA=11');
  if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${Number(fadeIn).toFixed(2)}`);
  if (fadeOut > 0 && len > fadeOut) filters.push(`afade=t=out:st=${(len - fadeOut).toFixed(3)}:d=${Number(fadeOut).toFixed(2)}`);
  if (normalize) filters.push('aresample=44100');
  if (filters.length) args.push('-af', filters.join(','));
  args.push('-map', '0:a:0', '-vn', '-map_metadata', '-1', '-c:a', 'libmp3lame', ...(QUALITY[quality] || QUALITY['320']));
  args.push('-id3v2_version', '3', '-write_xing', '1', '-progress', 'pipe:1', '-nostats', dst);

  const r = await tools.run(tools.ffmpeg(), args, {
    signal,
    onLine: (l) => {
      const m = /^out_time_(?:us|ms)=(\d+)/.exec(l);
      if (m && onProgress && len) onProgress(Math.min(1, Number(m[1]) / 1e6 / len));
    }
  });
  if (r.aborted) throw new Error('Canceled');
  if (r.code !== 0) { try { fs.rmSync(dst, { force: true }); } catch {} throw new Error('Conversion failed: ' + lastLine(r.stderr)); }
  return dst;
}

// Square, 1000px JPEG from any image (center crop — YouTube "Topic" thumbnails carry the album art in the middle).
async function squareArt(src, dst, size = 1000) {
  const vf = `crop='min(iw,ih)':'min(iw,ih)',scale=${size}:${size}:flags=lanczos`;
  const r = await tools.run(tools.ffmpeg(), ['-hide_banner', '-nostdin', '-y', '-i', src, '-frames:v', '1', '-vf', vf, '-q:v', '2', dst]);
  if (r.code !== 0) throw new Error('Could not use that image: ' + lastLine(r.stderr));
  return dst;
}

// Detect letterboxed thumbnails (art in the middle, bars or blur at the sides) vs. full-frame images.
async function cropdetect(src) {
  const r = await tools.run(tools.ffmpeg(), ['-hide_banner', '-nostdin', '-i', src, '-vf', 'cropdetect=limit=24:round=2:reset=0', '-frames:v', '1', '-f', 'null', '-']);
  const m = /crop=(\d+):(\d+):(\d+):(\d+)/.exec(r.stderr);
  return m ? { w: +m[1], h: +m[2], x: +m[3], y: +m[4] } : null;
}

// Peaks for the waveform: `buckets` values 0..1
async function peaks(file, buckets = 1600) {
  const rate = 4000;
  const r = await tools.run(tools.ffmpeg(), ['-hide_banner', '-nostdin', '-i', file, '-ac', '1', '-ar', String(rate), '-f', 's16le', '-acodec', 'pcm_s16le', '-'], { binary: true });
  if (r.code !== 0) throw new Error('Could not read audio: ' + lastLine(r.stderr));
  const buf = r.stdout;
  const n = Math.floor(buf.length / 2);
  const per = Math.max(1, Math.floor(n / buckets));
  const out = [];
  let max = 0;
  for (let b = 0; b < buckets && b * per < n; b++) {
    let peak = 0; let sum = 0;
    const end = Math.min(n, (b + 1) * per);
    for (let i = b * per; i < end; i++) { const v = Math.abs(buf.readInt16LE(i * 2)); if (v > peak) peak = v; sum += v * v; }
    const rms = Math.sqrt(sum / Math.max(1, end - b * per));
    out.push([peak, rms]);
    if (peak > max) max = peak;
  }
  max = max || 1;
  return { duration: n / rate, peaks: out.map(([p, r2]) => [+(p / max).toFixed(3), +(r2 / max).toFixed(3)]) };
}

// Leading/trailing silence, for the "Trim silence" helper.
async function silence(file, duration) {
  const r = await tools.run(tools.ffmpeg(), ['-hide_banner', '-nostdin', '-i', file, '-af', 'silencedetect=noise=-45dB:d=0.4', '-f', 'null', '-']);
  const starts = [...r.stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
  const ends = [...r.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
  let start = 0; let end = duration;
  if (starts.length && starts[0] <= 0.05 && ends.length) start = Math.max(0, ends[0] - 0.05);
  const lastStart = starts[starts.length - 1];
  if (lastStart != null && (ends.length < starts.length || ends[ends.length - 1] >= duration - 0.1) && lastStart > start + 1) end = Math.min(duration, lastStart + 0.15);
  return { start: +start.toFixed(2), end: +end.toFixed(2) };
}

module.exports = { probe, readTags, toMp3, squareArt, cropdetect, peaks, silence, QUALITY };
