// Mural — minimal zip read/write for .mural packages (a wallpaper folder in one file). Deflate via zlib, no deps.
'use strict';
const zlib = require('zlib');

const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** entries: [{ name, data: Buffer }] -> Buffer */
function writeZip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const def = zlib.deflateRawSync(raw, { level: 9 });
    const useDef = def.length < raw.length; const body = useDef ? def : raw; const crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(useDef ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(useDef ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body); centrals.push(ch, name); offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Buffer -> [{ name, data }]; refuses unsafe paths (absolute, "..") and oversized packages. */
function readZip(buf, { maxTotal = 2 * 1024 * 1024 * 1024 } = {}) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16); const out = []; let total = 0;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Damaged zip');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8'); p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const norm = name.replace(/\\/g, '/');
    if (norm.startsWith('/') || /^[a-z]:/i.test(norm) || norm.split('/').includes('..')) throw new Error(`Unsafe path in package: ${name}`);
    if (norm.startsWith('__MACOSX/') || norm.endsWith('.DS_Store')) continue;
    total += usize; if (total > maxTotal) throw new Error('Package too large');
    const lnl = buf.readUInt16LE(lo + 26), lxl = buf.readUInt16LE(lo + 28); const start = lo + 30 + lnl + lxl; const body = buf.slice(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : method === 0 ? Buffer.from(body) : null;
    if (!data) throw new Error(`Unsupported compression in ${name}`);
    out.push({ name: norm, data });
  }
  return out;
}

module.exports = { writeZip, readZip, crc32 };
