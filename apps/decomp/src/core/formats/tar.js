// tar archives (ustar, GNU long names, pax), optionally gzip/zstd-compressed, read as a stream.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { safeJoin } = require('../util');

const oct = (b, o, n) => { const s = b.toString('latin1', o, o + n).replace(/\0.*$/, '').trim(); if (b[o] & 0x80) { let v = 0; for (let i = 1; i < n; i++) v = v * 256 + b[o + i]; return v; } return s ? parseInt(s, 8) : 0; };

function source(file) {
  const fd = fs.openSync(file, 'r'); const h = Buffer.alloc(4); fs.readSync(fd, h, 0, 4, 0); fs.closeSync(fd);
  const raw = fs.createReadStream(file, { highWaterMark: 1 << 20 });
  if (h[0] === 0x1f && h[1] === 0x8b) return raw.pipe(zlib.createGunzip());
  if (h.readUInt32LE(0) === 0xfd2fb528) {
    if (typeof zlib.createZstdDecompress !== 'function') throw Object.assign(new Error('zstd needs 7-Zip'), { needs7z: true });
    return raw.pipe(zlib.createZstdDecompress());
  }
  return raw;
}

// Walks the archive. onEntry({path,size,type,link,mode}, stream?) — when `outDir` is given, files are written.
async function walk(file, { outDir, onEntry, onProgress } = {}) {
  const src = source(file);
  let buf = Buffer.alloc(0), state = null, longName = null, pax = {}, globalPax = {};
  const entries = []; let bytes = 0;
  const flushHeader = () => {
    const h = buf.subarray(0, 512);
    if (h.every((c) => c === 0)) { buf = buf.subarray(512); return 'zero'; }
    let name = h.toString('utf8', 0, 100).replace(/\0.*$/, '');
    const prefix = h.toString('latin1', 257, 263) === 'ustar\0' || h.toString('latin1', 257, 262) === 'ustar' ? h.toString('utf8', 345, 500).replace(/\0.*$/, '') : '';
    if (prefix) name = prefix + '/' + name;
    const size = oct(h, 124, 12), type = String.fromCharCode(h[156] || 48), mode = oct(h, 100, 8);
    const link = h.toString('utf8', 157, 257).replace(/\0.*$/, '');
    buf = buf.subarray(512);
    state = { name, size, type, mode, link, left: size, pad: (512 - (size % 512)) % 512, data: [] };
    return 'hdr';
  };
  const finishEntry = () => {
    const s = state; state = null;
    if (s.type === 'L') { longName = Buffer.concat(s.data).toString('utf8').replace(/\0.*$/, ''); return; }
    if (s.type === 'x' || s.type === 'g') {
      const txt = Buffer.concat(s.data).toString('utf8'); const kv = {};
      for (const line of txt.split('\n')) { const m = line.match(/^\d+ ([^=]+)=(.*)$/); if (m) kv[m[1]] = m[2]; }
      if (s.type === 'g') globalPax = { ...globalPax, ...kv }; else pax = kv; return;
    }
    let name = pax.path || longName || s.name; const size = pax.size ? +pax.size : s.size;
    longName = null; pax = {};
    name = name.replace(/^\.\//, '').replace(/\/+$/, '');
    if (!name) return;
    const e = { path: name, size, dir: s.type === '5', link: s.type === '2' ? (s.link || true) : null, hardlink: s.type === '1' ? s.link : null, exec: !!(s.mode & 0o111) };
    entries.push(e);
    if (outDir && s.out) { fs.closeSync(s.out); if (e.exec && process.platform !== 'win32') try { fs.chmodSync(s.dest, 0o755); } catch {} }
    if (outDir && e.dir) fs.mkdirSync(safeJoin(outDir, name), { recursive: true });
    if (outDir && e.hardlink) { try { fs.copyFileSync(safeJoin(outDir, e.hardlink), safeJoin(outDir, name)); } catch {} }
    if (outDir && e.link && process.platform !== 'win32') { try { const d = safeJoin(outDir, name); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.symlinkSync(e.link, d); } catch {} }
    onEntry && onEntry(e);
  };
  for await (const chunk of src) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    bytes += chunk.length; onProgress && onProgress(bytes);
    for (;;) {
      if (!state) { if (buf.length < 512) break; const r = flushHeader(); if (r === 'zero') continue;
        const meta = 'Lxg'.includes(state.type);
        if (outDir && !meta && (state.type === '0' || state.type === '\0' || state.type === '7')) {
          state.dest = safeJoin(outDir, pax.path || longName || state.name);
          fs.mkdirSync(path.dirname(state.dest), { recursive: true }); state.out = fs.openSync(state.dest, 'w');
        }
        state.meta = meta;
      }
      if (state.left > 0) {
        if (!buf.length) break;
        const n = Math.min(state.left, buf.length); const part = buf.subarray(0, n);
        if (state.meta) state.data.push(Buffer.from(part)); else if (state.out) fs.writeSync(state.out, part);
        state.left -= n; buf = buf.subarray(n);
        if (state.left > 0) break;
      }
      if (buf.length < state.pad) break;
      buf = buf.subarray(state.pad);
      finishEntry();
    }
  }
  if (state && state.out) fs.closeSync(state.out);
  return entries;
}

const isTar = (b) => b.length >= 262 && b.toString('latin1', 257, 262) === 'ustar';
module.exports = { walk, isTar };
