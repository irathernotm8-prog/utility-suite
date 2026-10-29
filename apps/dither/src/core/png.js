// Dither — PNG in and out with no dependencies (Node's zlib). Images are { w, h, data: Uint8ClampedArray RGBA }.
'use strict';
const zlib = require('zlib');

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// encode(img, { text: { key: value } }) → Buffer
function encode(img, opts = {}) {
  const { w, h, data } = img;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
  for (const [k, v] of Object.entries(opts.text || {})) parts.push(chunk('tEXt', Buffer.from(`${k}\0${v}`, 'latin1')));
  parts.push(chunk('IDAT', zlib.deflateSync(raw, { level: opts.level ?? 9 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }

// decode(Buffer) → { w, h, data } (8-bit and palette PNGs, interlaced or not)
function decode(buf) {
  buf = Buffer.from(buf);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG');
  let o = 8, w, h, depth, ctype, interlace, pal = null, trns = null; const idat = []; const text = {};
  while (o < buf.length) {
    const len = buf.readUInt32BE(o); const type = buf.toString('ascii', o + 4, o + 8); const d = buf.subarray(o + 8, o + 8 + len); o += 12 + len;
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; interlace = d[12]; }
    else if (type === 'PLTE') pal = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'tEXt') { const i = d.indexOf(0); if (i > 0) text[d.toString('latin1', 0, i)] = d.toString('latin1', i + 1); }
    else if (type === 'IEND') break;
  }
  if (depth === 16) throw new Error('16-bit PNGs aren’t supported here');
  const chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const bpp = Math.max(1, (chans * depth) >> 3);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = new Uint8ClampedArray(w * h * 4);
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  let p = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * chans * depth) / 8);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < ph; y++) {
      const f = raw[p++]; const line = Buffer.from(raw.subarray(p, p + stride)); p += stride;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        line[i] = (line[i] + (f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? paeth(a, b, c) : 0)) & 255;
      }
      prev = line;
      for (let x = 0; x < pw; x++) {
        const sample = (k) => { if (depth === 8) return line[x * chans + k]; const bit = (x * chans + k) * depth; const v = (line[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1); return ctype === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1)); };
        const q = ((y0 + y * dy) * w + x0 + x * dx) * 4;
        if (ctype === 6) { out[q] = sample(0); out[q + 1] = sample(1); out[q + 2] = sample(2); out[q + 3] = sample(3); }
        else if (ctype === 2) { out[q] = sample(0); out[q + 1] = sample(1); out[q + 2] = sample(2); out[q + 3] = trns && trns.length >= 6 && trns.readUInt16BE(0) === out[q] && trns.readUInt16BE(2) === out[q + 1] && trns.readUInt16BE(4) === out[q + 2] ? 0 : 255; }
        else if (ctype === 0) { const v = sample(0); out[q] = out[q + 1] = out[q + 2] = v; out[q + 3] = trns && trns.length >= 2 && trns.readUInt16BE(0) === v ? 0 : 255; }
        else if (ctype === 4) { const v = sample(0); out[q] = out[q + 1] = out[q + 2] = v; out[q + 3] = sample(1); }
        else { const i = sample(0); out[q] = pal[i * 3]; out[q + 1] = pal[i * 3 + 1]; out[q + 2] = pal[i * 3 + 2]; out[q + 3] = trns && i < trns.length ? trns[i] : 255; }
      }
    }
  }
  return { w, h, data: out, text };
}

module.exports = { encode, decode, crc32 };
