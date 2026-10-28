// The AI models RO2 can download. Each runs on this computer (onnxruntime-web: WebGPU on the GPU, else WASM on the CPU).
// Files live at <userData>/Models/<id>/<file name> and are served to the page at ro2://models/<id>/<file name>.
'use strict';
const fs = require('fs');
const path = require('path');
const { net } = require('electron');

const HF = (repo, file) => `https://huggingface.co/${repo}/resolve/main/${file}`;

const CATALOG = [
  {
    id: 'ormbg', task: 'removebg', name: 'Background remover',
    blurb: 'Cuts out people, pets, products and objects in one click.',
    license: 'Apache-2.0', source: 'schirrmacher/ormbg (Open Remove Background Model)',
    files: [{ name: 'model.onnx', url: HF('schirrmacher/ormbg', 'ormbg.onnx'), size: 176182050 }],
  },
  {
    id: 'lama', task: 'inpaint', name: 'Magic eraser',
    blurb: 'Removes anything you paint over and rebuilds what was behind it (LaMa). Also powers Grab and Magic expand.',
    license: 'Apache-2.0', source: 'opencv/inpainting_lama (LaMa, Samsung AI)',
    files: [{ name: 'model.onnx', url: HF('opencv/inpainting_lama', 'inpainting_lama_2025jan.onnx'), size: 92591623 }],
  },
  {
    id: 'slimsam', task: 'segment', name: 'Click to select',
    blurb: 'Click on any object to select exactly it, for erasing, grabbing or keeping (Segment Anything).',
    license: 'Apache-2.0', source: 'Xenova/slimsam-77-uniform (SlimSAM)',
    files: [
      { name: 'encoder.onnx', url: HF('Xenova/slimsam-77-uniform', 'onnx/vision_encoder.onnx'), size: 23276014 },
      { name: 'decoder.onnx', url: HF('Xenova/slimsam-77-uniform', 'onnx/prompt_encoder_mask_decoder.onnx'), size: 16557892 },
    ],
  },
  {
    id: 'ocrpro', task: 'ocr', name: 'Text reader',
    blurb: 'Reads the words in a picture (also small, stylised, spaced-out and tilted text) so Make editable can turn them into real, editable text (PP-OCRv6).',
    license: 'Apache-2.0', source: 'PaddlePaddle PP-OCRv6 small (detection + recognition)',
    files: [
      { name: 'det.onnx', url: HF('PaddlePaddle/PP-OCRv6_small_det_onnx', 'inference.onnx'), size: 9880512 },
      { name: 'rec.onnx', url: HF('PaddlePaddle/PP-OCRv6_small_rec_onnx', 'inference.onnx'), size: 21159378 },
      { name: 'rec.yml', url: HF('PaddlePaddle/PP-OCRv6_small_rec_onnx', 'inference.yml'), size: 150579 },
    ],
  },
  {
    id: 'ocr', task: 'ocr', name: 'Text reader: classic', optional: true,
    blurb: 'The previous text reader (Tesseract, English). Only used if the main text reader is not downloaded or cannot run.',
    license: 'Apache-2.0', source: 'tesseract-ocr/tessdata (via tesseract.js-data)',
    files: [{ name: 'eng.traineddata.gz', url: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', size: 2952873 }],
  },
  {
    id: 'isnet', task: 'removebg', name: 'Background remover: whole scenes', optional: true,
    blurb: 'An alternative cut-out model that keeps everything in the foreground (IS-Net general). Try it when the main one misses part of a scene.',
    license: 'Apache-2.0', source: 'xuebinqin/DIS (IS-Net), via rembg',
    files: [{ name: 'model.onnx', url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx', size: 178648008 }],
  },
];

class Models {
  constructor(dir, send) {
    this.dir = dir; this.send = send; this.jobs = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }
  fileOf(id, name) { return path.join(this.dir, id, name); }
  installed(m) { return m.files.every((f) => { try { return fs.statSync(this.fileOf(m.id, f.name)).size === f.size; } catch { return false; } }); }
  list() {
    return CATALOG.map((m) => {
      const job = this.jobs.get(m.id);
      return {
        id: m.id, task: m.task, name: m.name, blurb: m.blurb, license: m.license, source: m.source, optional: !!m.optional,
        size: m.files.reduce((s, f) => s + f.size, 0), installed: this.installed(m),
        downloading: !!job, progress: job ? job.progress : 0,
      };
    });
  }
  async download(id) {
    const m = CATALOG.find((x) => x.id === id);
    if (!m) throw new Error('Unknown model ' + id);
    if (this.installed(m)) return { ok: true };
    if (this.jobs.has(id)) return this.jobs.get(id).promise;
    const job = { progress: 0, abort: new AbortController() };
    job.promise = (async () => {
      const total = m.files.reduce((s, f) => s + f.size, 0);
      let doneBefore = 0;
      fs.mkdirSync(path.join(this.dir, id), { recursive: true });
      try {
        for (const f of m.files) {
          const dest = this.fileOf(id, f.name);
          if (fs.existsSync(dest) && fs.statSync(dest).size === f.size) { doneBefore += f.size; continue; }
          await this._fetchFile(f, dest, job.abort.signal, (got) => {
            job.progress = (doneBefore + got) / total;
            this.send('models:progress', { id, progress: job.progress });
          });
          doneBefore += f.size;
        }
        this.send('models:progress', { id, progress: 1, done: true });
        return { ok: true };
      } catch (e) {
        const cancelled = job.abort.signal.aborted;
        this.send('models:progress', { id, progress: job.progress, error: cancelled ? 'cancelled' : String(e.message || e) });
        return { ok: false, error: cancelled ? 'cancelled' : String(e.message || e) };
      } finally { this.jobs.delete(id); }
    })();
    this.jobs.set(id, job);
    return job.promise;
  }
  // Resumable download to <dest>.part, then renamed. Retries a few times on network hiccups.
  async _fetchFile(f, dest, signal, onBytes) {
    const part = dest + '.part';
    for (let attempt = 0; ; attempt++) {
      let have = 0; try { have = fs.statSync(part).size; } catch {}
      if (have > f.size) { fs.rmSync(part, { force: true }); have = 0; }
      try {
        if (have < f.size) {
          const res = await net.fetch(f.url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal });
          if (!(res.status === 200 || res.status === 206)) throw new Error(`HTTP ${res.status} for ${path.basename(f.url)}`);
          if (res.status === 200 && have) { have = 0; }
          const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
          const reader = res.body.getReader();
          let got = have, lastTick = 0;
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
              got += value.byteLength;
              const now = Date.now(); if (now - lastTick > 150) { lastTick = now; onBytes(got); }
            }
          } finally { await new Promise((r) => out.end(r)); }
        }
        const size = fs.statSync(part).size;
        if (size !== f.size) throw new Error(`Download incomplete (${size} of ${f.size} bytes)`);
        fs.renameSync(part, dest); onBytes(f.size); return;
      } catch (e) {
        if (signal.aborted || attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }
  cancel(id) { const j = this.jobs.get(id); if (j) j.abort.abort(); return true; }
  remove(id) { this.cancel(id); fs.rmSync(path.join(this.dir, id), { recursive: true, force: true }); return true; }
}

module.exports = { Models, CATALOG };
