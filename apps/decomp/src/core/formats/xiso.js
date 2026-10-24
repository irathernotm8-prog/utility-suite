// Xbox and Xbox 360 game discs (XDVDFS, ".xiso" or full redump images with the game partition inside).
'use strict';
const fs = require('fs');
const path = require('path');
const { FileReader } = require('../util');

const MAGIC = 'MICROSOFT*XBOX*MEDIA';
const PARTITIONS = [0, 0x18300000, 0xfd90000, 0x89d80000, 0x2080000];

function findBase(r) {
  for (const off of PARTITIONS) {
    const b = r.read(off + 0x10000, 20);
    if (b.toString('latin1') === MAGIC) return off;
  }
  return -1;
}

function open(file) {
  const r = new FileReader(file);
  const base = findBase(r);
  if (base < 0) { r.close(); throw new Error('No Xbox (XDVDFS) volume found'); }
  const vd = r.read(base + 0x10000, 2048);
  const rootSector = vd.readUInt32LE(20), rootSize = vd.readUInt32LE(24);
  const entries = [];
  const sec = (s) => base + s * 2048;
  const seen = new Set();
  function readTable(sector, size, prefix, depth) {
    if (!size || depth > 48 || seen.has(sector)) return;
    seen.add(sector);
    const t = r.read(sec(sector), size);
    const visit = (off, guard) => {
      if (guard > 100000 || off + 14 > t.length) return;
      const left = t.readUInt16LE(off), right = t.readUInt16LE(off + 2);
      if (left === 0xffff) return;
      const start = t.readUInt32LE(off + 4), fsize = t.readUInt32LE(off + 8), attr = t[off + 12], nl = t[off + 13];
      const name = t.toString('latin1', off + 14, off + 14 + nl);
      if (left) visit(left * 4, guard + 1);
      const full = prefix ? prefix + '/' + name : name;
      if (attr & 0x10) { entries.push({ path: full, dir: true, size: 0 }); readTable(start, fsize, full, depth + 1); }
      else entries.push({ path: full, size: fsize, offset: sec(start) });
      if (right) visit(right * 4, guard + 1);
    };
    visit(0, 0);
  }
  readTable(rootSector, rootSize, '', 0);
  const xbe = entries.find((e) => /^default\.xbe$/i.test(e.path)), xex = entries.find((e) => /^default\.xex$/i.test(e.path));
  const info = { platform: xex ? 'Xbox 360' : 'Xbox', partitionOffset: base, files: entries.filter((e) => !e.dir).length };
  if (xbe) {
    try {
      const h = r.read(xbe.offset, 0x200);
      if (h.toString('latin1', 0, 4) === 'XBEH') {
        const baseAddr = h.readUInt32LE(0x104), certAddr = h.readUInt32LE(0x118);
        const c = r.read(xbe.offset + (certAddr - baseAddr), 0x1d0);
        info.title = c.toString('utf16le', 0x0c, 0x0c + 80).replace(/\0.*$/, '');
        info.titleId = c.readUInt32LE(8).toString(16).toUpperCase().padStart(8, '0');
      }
    } catch {}
  }
  return {
    format: 'xiso', info, entries,
    extract(e, dest) {
      if (e.dir) { fs.mkdirSync(dest, { recursive: true }); return; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.openSync(dest, 'w');
      try { let done = 0; while (done < e.size) { const n = Math.min(4 << 20, e.size - done); fs.writeSync(out, r.read(e.offset + done, n)); done += n; } } finally { fs.closeSync(out); }
    },
    close() { r.close(); },
  };
}
const probe = (r) => findBase(r) >= 0;
module.exports = { open, probe };
