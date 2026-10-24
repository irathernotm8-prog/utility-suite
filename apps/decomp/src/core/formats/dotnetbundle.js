// .NET single-file apps (dotnet publish -p:PublishSingleFile=true): the managed DLLs, deps.json and
// runtimeconfig are appended to the host executable behind a manifest. Works for PE, ELF and Mach-O hosts.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { FileReader, safeJoin } = require('../util');

const SIG = Buffer.from([0x8b, 0x12, 0x02, 0xb9, 0x6a, 0x61, 0x20, 0x38, 0x72, 0x7b, 0x93, 0x02, 0x14, 0xd7, 0xa0, 0x32, 0x13, 0xf5, 0xb9, 0xe6, 0xef, 0xae, 0x33, 0x18, 0xee, 0x3b, 0x2d, 0xce, 0x24, 0xb3, 0x6a, 0xae]);
const TYPES = ['Unknown', 'Assembly', 'NativeBinary', 'DepsJson', 'RuntimeConfigJson', 'Symbols'];

function findHeader(r) {
  // the signature lives in the host's data section; scan in 16 MB windows
  const W = 16 << 20;
  for (let pos = 0; pos < r.size; pos += W - 64) {
    const b = r.read(pos, W); const i = b.indexOf(SIG);
    if (i >= 8) { const off = Number(b.readBigInt64LE(i - 8)); if (off > 0 && off < r.size) return off; }
    if (i >= 0 && i < 8) { const pre = r.read(pos + i - 8, 8); const off = Number(pre.readBigInt64LE(0)); if (off > 0 && off < r.size) return off; }
  }
  return -1;
}

function open(file, { r: given } = {}) {
  const r = given || new FileReader(file);
  const at = findHeader(r);
  if (at < 0) { if (!given) r.close(); return null; }
  const b = r.read(at, 1 << 20);
  let p = 0;
  const major = b.readUInt32LE(p), minor = b.readUInt32LE(p + 4), count = b.readInt32LE(p + 8); p += 12;
  const str = () => { let len = 0, shift = 0, c; do { c = b[p++]; len |= (c & 0x7f) << shift; shift += 7; } while (c & 0x80); const s = b.toString('utf8', p, p + len); p += len; return s; };
  const bundleId = str();
  if (major >= 2) p += 8 * 4 + 8;  // deps/runtimeconfig locations + flags
  const entries = [];
  for (let i = 0; i < count && p < b.length - 16; i++) {
    const off = Number(b.readBigInt64LE(p)), size = Number(b.readBigInt64LE(p + 8)); p += 16;
    let csize = 0; if (major >= 6) { csize = Number(b.readBigInt64LE(p)); p += 8; }
    const type = b[p++]; const name = str();
    entries.push({ path: name, offset: off, size, csize, kind: TYPES[type] || type });
  }
  return {
    format: 'dotnet-bundle', info: { version: `${major}.${minor}`, bundleId, files: entries.length, compressed: entries.some((e) => e.csize > 0) }, entries,
    extract(e, dest) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const raw = r.read(e.offset, e.csize || e.size);
      fs.writeFileSync(dest, e.csize ? zlib.inflateRawSync(raw) : raw);
    },
    close() { if (!given) r.close(); },
  };
}
module.exports = { open, findHeader };
