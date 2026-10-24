// Compressed ISOs from the PSP/PS2 scene: CSO (deflate) and ZSO (LZ4). Blocks are independent, so the
// pipeline splits them across every worker and each writes its own slice of the output .iso.
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const { FileReader } = require('../util');

function header(r) {
  const h = r.read(0, 24);
  const magic = h.toString('latin1', 0, 4);
  if (magic !== 'CISO' && magic !== 'ZISO') throw new Error('Not a CSO/ZSO file');
  const total = Number(h.readBigUInt64LE(8)), block = h.readUInt32LE(16), ver = h[20], align = h[21];
  const nblocks = Math.ceil(total / block);
  const idx = r.read(24, (nblocks + 1) * 4);
  return { kind: magic === 'CISO' ? 'cso' : 'zso', total, block, ver, align, nblocks, idx };
}

// Minimal LZ4 block decoder (ZSO uses raw LZ4 blocks).
function lz4Block(src, outLen) {
  const out = Buffer.alloc(outLen); let i = 0, o = 0;
  while (i < src.length) {
    const tok = src[i++]; let lit = tok >> 4;
    if (lit === 15) { let b; do { b = src[i++]; lit += b; } while (b === 255); }
    src.copy(out, o, i, i + lit); i += lit; o += lit;
    if (i >= src.length) break;
    const off = src[i] | (src[i + 1] << 8); i += 2;
    let ml = tok & 15; if (ml === 15) { let b; do { b = src[i++]; ml += b; } while (b === 255); }
    ml += 4; let m = o - off;
    while (ml--) out[o++] = out[m++];
  }
  return o === outLen ? out : out.subarray(0, o);
}

// Decompresses blocks [from, to) into the already-sized dest file.
function decompressRange(file, dest, from, to) {
  const r = new FileReader(file);
  const out = fs.openSync(dest, 'r+');
  try {
    const h = header(r);
    for (let b = from; b < Math.min(to, h.nblocks); b++) {
      const a = h.idx.readUInt32LE(b * 4), n = h.idx.readUInt32LE(b * 4 + 4);
      const plain = (a & 0x80000000) !== 0;
      const start = (a & 0x7fffffff) * 2 ** h.align, end = (n & 0x7fffffff) * 2 ** h.align;
      const want = Math.min(h.block, h.total - b * h.block);
      let raw = r.read(start, Math.max(0, end - start));
      let data;
      if (plain) data = raw.subarray(0, want);
      else if (h.kind === 'cso') data = zlib.inflateRawSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).subarray(0, want);
      else data = lz4Block(raw, want);
      fs.writeSync(out, data, 0, data.length, b * h.block);
    }
  } finally { fs.closeSync(out); r.close(); }
}

function info(file) { const r = new FileReader(file); try { const h = header(r); return { kind: h.kind, size: h.total, block: h.block, blocks: h.nblocks, version: h.ver }; } finally { r.close(); } }
function prepare(file, dest) { const i = info(file); const fd = fs.openSync(dest, 'w'); fs.ftruncateSync(fd, i.size); fs.closeSync(fd); return i; }

module.exports = { info, prepare, decompressRange, lz4Block };
