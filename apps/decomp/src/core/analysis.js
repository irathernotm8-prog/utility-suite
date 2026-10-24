// Byte-level analysis that splits cleanly into ranges, so every core can take a slice:
// printable strings (ASCII + UTF-16), entropy per block, embedded-file signatures, and hashes.
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { FileReader } = require('./util');

const SIGS = [
  ['zip', Buffer.from('PK\x03\x04', 'latin1')], ['7z', Buffer.from('377abcaf271c', 'hex')], ['rar', Buffer.from('Rar!\x1a\x07', 'latin1')],
  ['gzip', Buffer.from('1f8b08', 'hex')], ['xz', Buffer.from('fd377a585a00', 'hex')], ['bzip2', Buffer.from('BZh9', 'latin1')], ['zstd', Buffer.from('28b52ffd', 'hex')],
  ['lzma', Buffer.from('5d00008000', 'hex')], ['cab', Buffer.from('MSCF\0\0\0\0', 'latin1')],
  ['png', Buffer.from('89504e470d0a1a0a', 'hex')], ['jpeg', Buffer.from('ffd8ffe0', 'hex')], ['jpeg', Buffer.from('ffd8ffe1', 'hex')], ['gif', Buffer.from('GIF89a', 'latin1')],
  ['pdf', Buffer.from('%PDF-', 'latin1')], ['sqlite', Buffer.from('SQLite format 3\0', 'latin1')], ['elf', Buffer.from('7f454c46', 'hex')],
  ['pe', Buffer.from('MZ', 'latin1'), (b, i) => { if (i + 64 > b.length) return false; const o = b.readUInt32LE(i + 0x3c); return o > 0 && o < 4096 && i + o + 4 <= b.length && b.toString('latin1', i + o, i + o + 4) === 'PE\0\0'; }],
  ['mach-o', Buffer.from('cffaedfe', 'hex')], ['squashfs', Buffer.from('hsqs', 'latin1')], ['cpio', Buffer.from('070701', 'latin1')],
  ['uimage', Buffer.from('27051956', 'hex')], ['dtb', Buffer.from('d00dfeed', 'hex')], ['ubi', Buffer.from('UBI#', 'latin1')], ['jffs2', Buffer.from('8519', 'hex'), (b, i) => i % 4 === 0 && b[i + 2] === 0x01 && (b[i + 3] === 0xe0 || b[i + 3] === 0x20)],
  ['cramfs', Buffer.from('453dcd28', 'hex')], ['ext', Buffer.from('53ef', 'hex'), (b, i) => i >= 1080 && (i - 1080) % 1024 === 0],
  ['ogg', Buffer.from('OggS', 'latin1')], ['riff', Buffer.from('RIFF', 'latin1')], ['dex', Buffer.from('dex\n03', 'latin1')], ['wasm', Buffer.from('0061736d01000000', 'hex')],
  ['lua', Buffer.from('1b4c7561', 'hex')], ['pyinstaller', Buffer.from('MEI\x0c\x0b\x0a\x0b\x0e', 'latin1')], ['unity', Buffer.from('UnityFS\0', 'latin1')], ['godot', Buffer.from('GDPC', 'latin1')],
];

// Scans [start, end) for signatures. Returns [{ offset, type }].
function scanRange(file, start, end, { limit = 4000 } = {}) {
  const r = new FileReader(file); const hits = [];
  try {
    const CH = 8 << 20, OV = 64;
    for (let pos = start; pos < end && hits.length < limit; pos += CH) {
      const b = r.read(pos, Math.min(CH + OV, r.size - pos));
      const lim = Math.min(CH, end - pos);
      for (const [type, sig, check] of SIGS) {
        let i = b.indexOf(sig);
        while (i >= 0 && i < lim && hits.length < limit) {
          if (pos + i > 0 || type !== 'pe') if (!check || check(b, i)) hits.push({ offset: pos + i, type });
          i = b.indexOf(sig, i + 1);
        }
      }
    }
  } finally { r.close(); }
  return hits.sort((a, b) => a.offset - b.offset);
}

// Printable strings in [start, end). Keeps offsets so the viewer can jump.
function stringsRange(file, start, end, { min = 5, limit = 200000 } = {}) {
  const r = new FileReader(file); const out = [];
  try {
    const CH = 4 << 20;
    let cur = '', curAt = 0, wide = '', wideAt = 0;
    for (let pos = start; pos < end && out.length < limit; pos += CH) {
      const b = r.read(pos, Math.min(CH, end - pos));
      for (let i = 0; i < b.length; i++) {
        const c = b[i];
        if (c >= 0x20 && c < 0x7f || c === 9) { if (!cur) curAt = pos + i; cur += String.fromCharCode(c); }
        else { if (cur.length >= min) out.push({ o: curAt, s: cur.slice(0, 400) }); cur = ''; }
        // UTF-16LE: printable byte then zero
        if (i % 2 === (start % 2) && i + 1 < b.length) {
          const d = b[i + 1];
          if (d === 0 && (c >= 0x20 && c < 0x7f)) { if (!wide) wideAt = pos + i; wide += String.fromCharCode(c); }
          else { if (wide.length >= min) out.push({ o: wideAt, s: wide.slice(0, 400), w: 1 }); wide = ''; }
        }
      }
    }
    if (cur.length >= min) out.push({ o: curAt, s: cur }); if (wide.length >= min) out.push({ o: wideAt, s: wide, w: 1 });
  } finally { r.close(); }
  return out;
}

// Shannon entropy (0–8 bits/byte) for each block in [start, end).
function entropyRange(file, start, end, block) {
  const r = new FileReader(file); const out = [];
  try {
    const counts = new Uint32Array(256);
    for (let pos = start; pos < end; pos += block) {
      const b = r.read(pos, Math.min(block, end - pos)); if (!b.length) break;
      counts.fill(0); for (let i = 0; i < b.length; i++) counts[b[i]]++;
      let h = 0; for (let k = 0; k < 256; k++) if (counts[k]) { const p = counts[k] / b.length; h -= p * Math.log2(p); }
      out.push(+h.toFixed(3));
    }
  } finally { r.close(); }
  return out;
}

function hashFile(file, algos = ['md5', 'sha1', 'sha256']) {
  return new Promise((resolve, reject) => {
    const hs = algos.map((a) => crypto.createHash(a));
    fs.createReadStream(file, { highWaterMark: 4 << 20 }).on('data', (d) => hs.forEach((h) => h.update(d))).on('end', () => resolve(Object.fromEntries(algos.map((a, i) => [a, hs[i].digest('hex')])))).on('error', reject);
  });
}

// Splits [0, size) into n slices aligned to `align`.
function slices(size, n, align = 4096) {
  const per = Math.max(align, Math.ceil(size / n / align) * align); const out = [];
  for (let s = 0; s < size; s += per) out.push([s, Math.min(size, s + per)]);
  return out;
}
module.exports = { scanRange, stringsRange, entropyRange, hashFile, slices, SIGS };
