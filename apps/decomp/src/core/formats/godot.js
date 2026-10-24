// Godot game packs (.pck), standalone or embedded at the end of the game's executable.
'use strict';
const fs = require('fs');
const path = require('path');
const { FileReader } = require('../util');

function locate(r) {
  const h = r.read(0, 4);
  if (h.toString('latin1') === 'GDPC') return 0;
  const t = r.read(r.size - 12, 12);
  if (t.length === 12 && t.toString('latin1', 8, 12) === 'GDPC') { const size = Number(t.readBigUInt64LE(0)); const s = r.size - 12 - size; if (s >= 0 && r.read(s, 4).toString('latin1') === 'GDPC') return s; }
  return -1;
}

function open(file) {
  const r = new FileReader(file);
  const base = locate(r);
  if (base < 0) { r.close(); throw new Error('No Godot pack found'); }
  const h = r.read(base, 4 + 4 * 4 + 8 + 16 * 4 + 4 + 8);
  const fmt = h.readUInt32LE(4); const engine = `${h.readUInt32LE(8)}.${h.readUInt32LE(12)}.${h.readUInt32LE(16)}`;
  let p, flags = 0, fileBase = base, count;
  if (fmt >= 2) {
    flags = h.readUInt32LE(20); const rel = (flags & 2) || base === 0; fileBase = (rel ? base : 0) + Number(h.readBigUInt64LE(24));
    if (fmt >= 3) { const dirOff = Number(h.readBigUInt64LE(32)); p = (rel ? base : 0) + dirOff; count = r.read(p, 4).readUInt32LE(0); p += 4; }
    else { p = base + 32 + 64; count = r.read(p, 4).readUInt32LE(0); p += 4; }
  } else { p = base + 20 + 64; count = r.read(p, 4).readUInt32LE(0); p += 4; }
  const info = { engine: 'Godot ' + engine, packFormat: fmt, embedded: base > 0, encrypted: !!(flags & 1), files: count };
  const entries = [];
  if (!info.encrypted) {
    for (let i = 0; i < Math.min(count, 500000); i++) {
      const l = r.read(p, 4).readUInt32LE(0); p += 4;
      const name = r.read(p, l).toString('utf8').replace(/\0+$/, ''); p += l;
      const m = r.read(p, 8 + 8 + 16 + (fmt >= 2 ? 4 : 0)); p += m.length;
      const off = Number(m.readBigUInt64LE(0)), size = Number(m.readBigUInt64LE(8)), ef = fmt >= 2 ? m.readUInt32LE(32) : 0;
      entries.push({ path: name.replace(/^res:\/\//, '').replace(/^user:\/\//, '_user/'), size, offset: (fmt >= 2 ? fileBase : base) + off, encrypted: !!(ef & 1) });
    }
  }
  return {
    format: 'godot', info, entries,
    extract(e, dest) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.openSync(dest, 'w');
      try { let d = 0; while (d < e.size) { const n = Math.min(4 << 20, e.size - d); fs.writeSync(out, r.read(e.offset + d, n)); d += n; } } finally { fs.closeSync(out); }
    },
    close() { r.close(); },
  };
}
const probe = (r) => locate(r) >= 0;
module.exports = { open, probe };
