// Worker thread: runs one CPU-heavy task at a time for the pool.
'use strict';
process.noAsar = true; // see main.js: other apps' .asar files are plain files here
const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const analysis = require('./analysis');
const { safeJoin } = require('./util');

const FORMATS = {
  iso9660: () => require('./formats/iso9660'), xiso: () => require('./formats/xiso'), gcm: () => require('./formats/gcm'),
  zip: () => require('./formats/zip'), asar: () => require('./formats/asar'), godot: () => require('./formats/godot'), 'dotnet-bundle': () => require('./formats/dotnetbundle'),
};
let open = null; // last opened container { key, c }
function container(format, file) {
  const key = format + '|' + file;
  if (open && open.key === key) return open.c;
  if (open) try { open.c.close(); } catch {}
  const c = FORMATS[format]().open(file);
  open = { key, c };
  return c;
}

let beautify = null, wabt = null;
const progress = (p) => parentPort.postMessage({ progress: p });

const TASKS = {
  scan: ({ file, start, end }) => analysis.scanRange(file, start, end),
  strings: ({ file, start, end, min }) => analysis.stringsRange(file, start, end, { min }),
  entropy: ({ file, start, end, block }) => analysis.entropyRange(file, start, end, block),
  hash: ({ file }) => analysis.hashFile(file),
  async extract({ format, file, indexes, outDir }) {
    const c = container(format, file);
    let files = 0, bytes = 0; const errors = [];
    for (let k = 0; k < indexes.length; k++) {
      const e = c.entries[indexes[k]];
      try { await c.extract(e, safeJoin(outDir, e.path)); if (!e.dir) { files++; bytes += e.size || 0; } } catch (er) { errors.push(`${e.path}: ${er.message}`); }
      if (k % 25 === 0) progress({ files, bytes });
    }
    return { files, bytes, errors: errors.slice(0, 50), failed: errors.length };
  },
  cso: ({ file, dest, from, to }) => { require('./formats/cso').decompressRange(file, dest, from, to); return { blocks: to - from }; },
  beautify({ pairs }) {
    beautify = beautify || require('js-beautify');
    let n = 0;
    for (const [src, dest, kind] of pairs) {
      try {
        const text = fs.readFileSync(src, 'utf8');
        const fn = kind === 'css' ? beautify.css : kind === 'html' ? beautify.html : beautify.js;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, fn(text, { indent_size: 2, max_preserve_newlines: 2, wrap_line_length: 0 }));
        n++;
      } catch {}
    }
    return { files: n };
  },
  async wat({ file, dest }) {
    wabt = wabt || (await require('wabt')());
    const mod = wabt.readWasm(new Uint8Array(fs.readFileSync(file)), { readDebugNames: true, mutable_globals: true, sat_float_to_int: true, sign_extension: true, simd: true, threads: true, multi_value: true, bulk_memory: true, reference_types: true, tail_call: true, exceptions: true, gc: true, memory64: true });
    mod.generateNames(); mod.applyNames();
    const text = mod.toText({ foldExprs: false, inlineExport: true });
    mod.destroy();
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text);
    return { bytes: text.length };
  },
  axml({ src, dest }) { const x = require('./formats/axml').toXml(fs.readFileSync(src)); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, x); return {}; },
  pyinstaller: ({ file, outDir }) => require('./formats/python').extractPyInstaller(file, outDir, { onProgress: (f) => progress({ fraction: f }) }),
  identify: ({ files }) => { const d = require('./detect'); return files.map((f) => { try { return d.quick(f); } catch (e) { return { path: f, kind: 'unknown', error: e.message }; } }); },
  grep({ files, query, regex, cs, max = 2000 }) {
    const re = regex ? new RegExp(query, cs ? 'g' : 'gi') : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), cs ? 'g' : 'gi');
    const out = [];
    for (const f of files) {
      let text; try { const st = fs.statSync(f); if (st.size > 32 << 20) continue; const b = fs.readFileSync(f); if (b.subarray(0, 8000).includes(0)) continue; text = b.toString('utf8'); } catch { continue; }
      if (!re.test(text)) { re.lastIndex = 0; continue; } re.lastIndex = 0;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length && out.length < max; i++) { re.lastIndex = 0; if (re.test(lines[i])) out.push({ file: f, line: i + 1, text: lines[i].trim().slice(0, 300) }); }
      if (out.length >= max) break;
    }
    return out;
  },
};

parentPort.on('message', async ({ id, task, args }) => {
  try {
    const fn = TASKS[task]; if (!fn) throw new Error('Unknown task ' + task);
    const result = await fn(args);
    parentPort.postMessage({ id, result });
  } catch (e) { parentPort.postMessage({ id, error: e.message || String(e), code: e.code }); }
});
