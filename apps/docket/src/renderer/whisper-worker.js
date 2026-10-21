// Speech-to-text on this computer: Whisper through Transformers.js, on the GPU (WebGPU) when there is one, otherwise on the CPU (WASM).
// The model downloads once from Hugging Face and is cached; audio never leaves the computer.
import { pipeline, env } from '../vendor/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL('../vendor/', import.meta.url).href;
env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));

let asr = null, loaded = null, loading = null;

async function gpuInfo() {
  try {
    if (!navigator.gpu) return null;
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    return a ? { f16: a.features.has('shader-f16') } : null;
  } catch (_) { return null; }
}

function dtypes(preset, device, f16) {
  if (device === 'wasm') return { encoder_model: 'q8', decoder_model_merged: 'q8' };
  if (preset === 'best') return f16 ? { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' } : { encoder_model: 'q4', decoder_model_merged: 'q4' };
  if (preset === 'balanced') return { encoder_model: f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' };
  return { encoder_model: 'fp32', decoder_model_merged: 'q4' };
}

async function load({ model, preset, device: want }) {
  const key = JSON.stringify({ model, preset, want });
  if (loaded === key && asr) return { ok: true, device: asr.__device };
  if (loading && loading.key === key) return loading.p;
  const p = (async () => {
    if (asr) { try { await asr.dispose(); } catch (_) {} asr = null; }
    const gpu = want === 'cpu' ? null : await gpuInfo();
    const devices = gpu ? ['webgpu', 'wasm'] : ['wasm'];
    let lastErr = null;
    for (const device of devices) {
      try {
        const files = {};
        const pipe = await pipeline('automatic-speech-recognition', model, {
          device, dtype: dtypes(preset, device, gpu && gpu.f16),
          progress_callback: (e) => {
            if (e.status === 'progress' && e.total) { files[e.file] = [e.loaded, e.total]; const v = Object.values(files); postMessage({ type: 'progress', loaded: v.reduce((a, x) => a + x[0], 0), total: v.reduce((a, x) => a + x[1], 0), file: e.file }); }
          }
        });
        // Warm up so the first real segment isn't slow.
        await pipe(new Float32Array(16000), { return_timestamps: false });
        pipe.__device = device;
        asr = pipe; loaded = key;
        return { ok: true, device };
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('The speech model could not be loaded.');
  })();
  loading = { key, p };
  try { return await p; } finally { loading = null; }
}

const queue = [];
let busy = false;
async function pump() {
  if (busy) return; busy = true;
  while (queue.length) {
    const job = queue.shift();
    postMessage({ type: 'queue', size: queue.length });
    try {
      if (!asr && loading) await loading.p.catch(() => {}); // segments that arrive while the model downloads wait here
      if (!asr) throw new Error('Speech model not loaded');
      const t = performance.now();
      const opts = { return_timestamps: false };
      if (job.language && !job.english) { opts.language = job.language; opts.task = 'transcribe'; }
      const r = await asr(job.pcm, opts);
      postMessage({ type: 'result', id: job.id, text: (r && r.text) || '', ms: Math.round(performance.now() - t) });
    } catch (e) { postMessage({ type: 'result', id: job.id, text: '', error: String(e && e.message || e) }); }
  }
  busy = false;
  postMessage({ type: 'queue', size: 0 });
}

onmessage = async (e) => {
  const d = e.data;
  if (d.type === 'load') {
    try { postMessage({ type: 'loaded', ...(await load(d)) }); }
    catch (err) { postMessage({ type: 'loaded', ok: false, error: String(err && err.message || err) }); }
  } else if (d.type === 'transcribe') {
    queue.push(d); pump();
  } else if (d.type === 'clear') {
    queue.length = 0;
  }
};
