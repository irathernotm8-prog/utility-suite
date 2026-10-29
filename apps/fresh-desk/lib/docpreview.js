'use strict';
// Live document previews for the side pane and Quick Look. Heavy parsing runs in a
// bounded worker thread so a broken file can't freeze or crash the app.
const path = require('node:path');
const fs = require('node:fs/promises');
const {Worker} = require('node:worker_threads');

const WORKER_TYPES = new Set(['docx', 'docm', 'xlsx', 'xlsm', 'pptx', 'rtf']);
const LIMIT = 60 * 1024 * 1024;

async function docPreview(file, opts = {}) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!WORKER_TYPES.has(ext)) return null;
  const st = await fs.stat(file);
  if (st.size > LIMIT) return {type: 'none', note: 'Too large to preview here — press Open.'};
  return new Promise(resolve => {
    let done = false;
    const worker = new Worker(path.join(__dirname, 'doc-worker.js'), {workerData: {file, ext, sheet: opts.sheet | 0}, resourceLimits: {maxOldGenerationSizeMb: 384}});
    const finish = r => { if (done) return; done = true; clearTimeout(timer); worker.terminate(); resolve(r); };
    const timer = setTimeout(() => finish({type: 'none', note: 'This file took too long to preview.'}), 20000);
    worker.once('message', m => finish(m.ok ? m.result : {type: 'none', note: `Couldn’t preview this file (${m.error}).`}));
    worker.once('error', e => finish({type: 'none', note: `Couldn’t preview this file (${e.message}).`}));
    worker.once('exit', () => finish({type: 'none', note: 'Couldn’t preview this file.'}));
  });
}

// Raw bytes for the in-page PDF renderer.
async function readBytes(file, max = LIMIT) {
  const st = await fs.stat(file);
  if (st.size > max) throw Error('Too large to preview.');
  return new Uint8Array(await fs.readFile(file));
}

module.exports = {docPreview, readBytes, WORKER_TYPES};
