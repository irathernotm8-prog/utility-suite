// Thin wrapper around the bundled FFmpeg / FFprobe binaries.
const { spawn } = require('child_process');

function unpacked(p) {
  // Inside a packaged app the binaries live in app.asar.unpacked.
  return p ? p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1') : p;
}

const FFMPEG = unpacked(require('ffmpeg-static'));
const FFPROBE = unpacked(require('ffprobe-static').path);

/**
 * Run ffmpeg. Resolves with stderr text, rejects with a readable error.
 * opts.duration (seconds) enables progress reporting through opts.onProgress(0..1).
 * opts.signal: AbortSignal to cancel.
 */
function runFfmpeg(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const full = ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...args];
    const proc = spawn(FFMPEG, full, { windowsHide: true });
    let stderr = '';
    let buf = '';
    let cancelled = false;
    proc.stdout.on('data', chunk => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m && opts.duration && opts.onProgress) {
          const sec = Number(m[1]) / 1e6;
          opts.onProgress(Math.max(0, Math.min(1, sec / opts.duration)));
        }
      }
    });
    proc.stderr.on('data', d => {
      stderr += d.toString();
      if (stderr.length > 200000) stderr = stderr.slice(-100000);
    });
    if (opts.signal) {
      const onAbort = () => { cancelled = true; try { proc.kill('SIGKILL'); } catch (_) {} };
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    proc.on('error', err => reject(err));
    proc.on('close', code => {
      if (cancelled) return reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
      if (code === 0) {
        if (opts.onProgress) opts.onProgress(1);
        return resolve(stderr);
      }
      const lines = stderr.trim().split('\n').filter(l => !/^\s*(Stream|Input|Output|Metadata|Duration|encoder|\[)/.test(l));
      reject(new Error('FFmpeg failed: ' + (lines.slice(-3).join(' ').trim() || 'exit code ' + code)));
    });
  });
}

/** Capture ffmpeg output to a Buffer (stdout). */
function ffmpegToBuffer(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args], { windowsHide: true });
    const chunks = [];
    let stderr = '';
    proc.stdout.on('data', c => chunks.push(c));
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0 && chunks.length) resolve(Buffer.concat(chunks));
      else reject(new Error(stderr.trim() || 'FFmpeg produced no output'));
    });
    if (opts.input) { proc.stdin.end(opts.input); }
  });
}

/** Inspect a media file. Returns a compact summary. */
function probe(file) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { windowsHide: true });
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(err.trim() || 'Could not read this file'));
      try {
        const j = JSON.parse(out);
        const v = (j.streams || []).find(s => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
        const a = (j.streams || []).find(s => s.codec_type === 'audio');
        let fps = 0;
        if (v && v.avg_frame_rate && v.avg_frame_rate !== '0/0') {
          const [n, d] = v.avg_frame_rate.split('/').map(Number);
          fps = d ? n / d : n;
        }
        let rotation = 0;
        if (v) {
          if (v.tags && v.tags.rotate) rotation = Number(v.tags.rotate) || 0;
          const sd = (v.side_data_list || []).find(s => s.rotation !== undefined);
          if (sd) rotation = Number(sd.rotation) || 0;
        }
        let width = v ? v.width : 0, height = v ? v.height : 0;
        if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
        resolve({
          duration: Number(j.format && j.format.duration) || Number(v && v.duration) || Number(a && a.duration) || 0,
          size: Number(j.format && j.format.size) || 0,
          container: j.format && j.format.format_name,
          hasVideo: !!v,
          hasAudio: !!a,
          vcodec: v ? v.codec_name : null,
          acodec: a ? a.codec_name : null,
          width, height, fps,
          audioStreams: (j.streams || []).filter(s => s.codec_type === 'audio').length,
        });
      } catch (e) { reject(e); }
    });
  });
}

module.exports = { FFMPEG, FFPROBE, runFfmpeg, ffmpegToBuffer, probe };
