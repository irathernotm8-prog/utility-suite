// Bench — a minimal PNG encoder (RGBA → PNG) so pure modules and tests can make images without Electron.
'use strict';
const zlib = require('zlib');

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** rgba: Buffer of w*h*4 bytes (alpha ignored and written as opaque when opaque=true). */
function encodePng(rgba, w, h, { opaque = true, level = 3 } = {}) {
  const stride = w * 4; const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
    if (opaque) for (let x = 0; x < w; x++) raw[y * (stride + 1) + 1 + x * 4 + 3] = 255;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level })), chunk('IEND', Buffer.alloc(0))]);
}
/** Reads width/height from a PNG header. */
function pngSize(buf) { if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null; return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }; }
/** Nearest-neighbour downscale of an RGBA buffer (used when a remote screen is bigger than a screenshot should be). */
function scaleRgba(rgba, w, h, nw, nh) {
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / nh));
    for (let x = 0; x < nw; x++) { const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / nw)); rgba.copy(out, (y * nw + x) * 4, (sy * w + sx) * 4, (sy * w + sx) * 4 + 4); }
  }
  return out;
}

module.exports = { encodePng, pngSize, scaleRgba, crc32 };
