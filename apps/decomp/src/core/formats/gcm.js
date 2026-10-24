// Nintendo GameCube discs (.iso/.gcm): the file system table plus the system files (boot.bin, bi2.bin,
// apploader, main.dol). Wii discs are identified but their partitions are encrypted, so only the
// header is shown.
'use strict';
const fs = require('fs');
const path = require('path');
const { FileReader, cstr } = require('../util');

function kind(r) {
  const h = r.read(0, 0x20);
  if (h.length < 0x20) return null;
  if (h.readUInt32BE(0x1c) === 0xc2339f3d) return 'gamecube';
  if (h.readUInt32BE(0x18) === 0x5d1c9ea3) return 'wii';
  return null;
}

function dolSize(b) {
  let max = 0x100;
  for (let i = 0; i < 18; i++) { const off = b.readUInt32BE(i * 4), sz = b.readUInt32BE(0x90 + i * 4); if (off && sz) max = Math.max(max, off + sz); }
  return max;
}

function open(file) {
  const r = new FileReader(file);
  const k = kind(r);
  if (!k) { r.close(); throw new Error('Not a GameCube/Wii disc'); }
  const h = r.read(0, 0x440);
  const info = { platform: k === 'wii' ? 'Wii' : 'GameCube', gameId: h.toString('latin1', 0, 6), title: cstr(h, 0x20, 0x400), disc: h[6] + 1, version: h[7] };
  const entries = [];
  if (k === 'wii') { info.note = 'Wii partitions are encrypted; Decomp shows the header only.'; return { format: 'gcm', info, entries, extract() {}, close() { r.close(); } }; }
  const dolOff = h.readUInt32BE(0x420), fstOff = h.readUInt32BE(0x424), fstSize = h.readUInt32BE(0x428);
  const apHdr = r.read(0x2440, 0x20);
  const apSize = 0x20 + apHdr.readUInt32BE(0x14) + apHdr.readUInt32BE(0x18);
  entries.push({ path: 'sys/boot.bin', size: 0x440, offset: 0 });
  entries.push({ path: 'sys/bi2.bin', size: 0x2000, offset: 0x440 });
  entries.push({ path: 'sys/apploader.img', size: apSize, offset: 0x2440 });
  entries.push({ path: 'sys/main.dol', size: dolSize(r.read(dolOff, 0x100)), offset: dolOff });
  entries.push({ path: 'sys/fst.bin', size: fstSize, offset: fstOff });
  const fst = r.read(fstOff, fstSize);
  const n = fst.readUInt32BE(8), strBase = n * 12;
  const name = (i) => cstr(fst, strBase + (fst.readUInt32BE(i * 12) & 0xffffff));
  // Directories hold the index just past their last child; walk with a stack of [endIndex, path].
  const stack = [[n, '']];
  for (let i = 1; i < n; i++) {
    while (stack.length > 1 && i >= stack[stack.length - 1][0]) stack.pop();
    const top = stack[stack.length - 1][1];
    const isDir = fst[i * 12] === 1, nm = name(i), full = (top ? top + '/' : 'files/') + nm;
    if (isDir) { entries.push({ path: full, dir: true, size: 0 }); stack.push([fst.readUInt32BE(i * 12 + 8), full]); }
    else entries.push({ path: full, size: fst.readUInt32BE(i * 12 + 8), offset: fst.readUInt32BE(i * 12 + 4) });
  }
  return {
    format: 'gcm', info, entries,
    extract(e, dest) {
      if (e.dir) { fs.mkdirSync(dest, { recursive: true }); return; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.openSync(dest, 'w');
      try { let d = 0; while (d < e.size) { const c = Math.min(4 << 20, e.size - d); fs.writeSync(out, r.read(e.offset + d, c)); d += c; } } finally { fs.closeSync(out); }
    },
    close() { r.close(); },
  };
}
module.exports = { open, kind };
