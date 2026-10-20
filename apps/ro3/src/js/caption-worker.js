// Auto-captions: speech-to-text with Whisper, run entirely on this computer.
// Module worker. Models download once from Hugging Face on first use and are cached afterwards.
import { pipeline, env } from '../vendor/transformers/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL('../vendor/transformers/', import.meta.url).href;
try { env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(8, (self.navigator.hardwareConcurrency || 4) - 1)); } catch (_) {}

const MODELS = { tiny: 'onnx-community/whisper-tiny', base: 'onnx-community/whisper-base', small: 'onnx-community/whisper-small' };
const SR = 16000;
let cache = { key: null, asr: null, device: null };
let cancelled = false;

const post = (m) => self.postMessage(m);

async function hasWebGPU() {
  try { if (!self.navigator.gpu) return false; const a = await self.navigator.gpu.requestAdapter(); return !!a; } catch (_) { return false; }
}

async function load(model, wantGpu) {
  const key = model + (wantGpu ? ':gpu' : ':cpu');
  if (cache.key === key && cache.asr) return cache;
  if (cache.asr && cache.asr.dispose) { try { await cache.asr.dispose(); } catch (_) {} }
  const files = new Map();
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.total) {
      files.set(p.file, [p.loaded, p.total]);
      let l = 0, t = 0; for (const [a, b] of files.values()) { l += a; t += b; }
      post({ type: 'progress', stage: 'download', value: t ? l / t : 0, loaded: l, total: t });
    } else if (p.status === 'ready') post({ type: 'progress', stage: 'load', value: 1 });
  };
  const repo = MODELS[model] || MODELS.base;
  const attempts = wantGpu
    ? [{ device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } }, { device: 'wasm', dtype: 'q8' }]
    : [{ device: 'wasm', dtype: 'q8' }];
  let lastErr;
  for (const a of attempts) {
    try {
      const asr = await pipeline('automatic-speech-recognition', repo, { ...a, progress_callback });
      cache = { key, asr, device: a.device };
      return cache;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Could not load the speech model.');
}

/** Split long audio at quiet points near every `span` seconds so words aren't cut in half. */
function segments(audio, span = 240) {
  const out = []; const n = audio.length; const step = span * SR; const win = Math.round(0.05 * SR);
  let s = 0;
  while (s < n) {
    let e = Math.min(n, s + step);
    if (e < n) {
      // search ±4 s for the quietest 50 ms
      const lo = Math.max(s + SR * 10, e - 4 * SR), hi = Math.min(n - win, e + 4 * SR);
      let best = e, bestE = Infinity;
      for (let i = lo; i < hi; i += win) { let acc = 0; for (let j = i; j < i + win; j += 4) acc += audio[j] * audio[j]; if (acc < bestE) { bestE = acc; best = i + (win >> 1); } }
      e = best;
    }
    out.push([s, e]); s = e;
  }
  return out;
}

async function run({ audio, model = 'base', language = 'auto', translate = false, gpu = true }) {
  cancelled = false;
  const wantGpu = gpu && await hasWebGPU();
  const { asr, device } = await load(model, wantGpu);
  post({ type: 'progress', stage: 'transcribe', value: 0, device });
  const segs = segments(audio);
  const total = audio.length; const chunks = [];
  const opts = { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, task: translate ? 'translate' : 'transcribe' };
  if (language && language !== 'auto') opts.language = language;
  for (const [s, e] of segs) {
    if (cancelled) throw new Error('cancelled');
    const part = audio.subarray(s, e);
    // skip silence (no point asking Whisper to hallucinate)
    let peak = 0; for (let i = 0; i < part.length; i += 64) { const v = Math.abs(part[i]); if (v > peak) peak = v; }
    if (peak > 0.01) {
      const r = await asr(part, opts);
      const off = s / SR, segEnd = e / SR;
      for (const c of (r.chunks || [])) {
        const [a, b] = c.timestamp || [];
        const text = String(c.text || '').trim();
        if (!text || a == null) continue;
        chunks.push({ start: off + a, end: Math.min(segEnd, off + (b == null ? Math.min((e - s) / SR, a + 5) : b)), text });
      }
      if (!(r.chunks || []).length && r.text && r.text.trim()) chunks.push({ start: off, end: segEnd, text: r.text.trim() });
    }
    post({ type: 'progress', stage: 'transcribe', value: e / total, device });
  }
  return { chunks, device };
}

self.onmessage = async (ev) => {
  const m = ev.data || {};
  if (m.type === 'cancel') { cancelled = true; return; }
  if (m.type !== 'run') return;
  try {
    const r = await run({ ...m, audio: new Float32Array(m.audio) });
    post({ type: 'done', id: m.id, ...r });
  } catch (e) {
    post({ type: 'error', id: m.id, message: String(e && e.message || e) });
  }
};
