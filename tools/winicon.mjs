// Windows icons for the Utility Suite (plain Node, no dependencies).
//
//   makeWindowsIco(png, ico)  turns an app's build/icon.png (the 1024px Mac-style icon, a rounded tile
//                             with transparent margin) into a Windows .ico: the tile is cropped out and
//                             scaled to fill each size the same way, so every app looks the same size
//                             in the taskbar, Start menu and Explorer.
//   exeIcons(exe)             reads the icon images embedded in a Windows .exe.
//   checkExeIcon(exe, made)   confirms the .exe carries exactly the icon makeWindowsIco made.
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ───────────── PNG ─────────────
export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w, h, depth, ctype, interlace, plte = null, trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; interlace = d[12]; }
    else if (type === 'PLTE') plte = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (depth !== 8 || interlace || !ch) throw new Error(`unsupported PNG (bit depth ${depth}, color type ${ctype}${interlace ? ', interlaced' : ''})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch] : 0, b = y ? px[row - stride + x] : 0, c = x >= ch && y ? px[row - stride + x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * ch, o = i * 4;
    if (ctype === 6) px.copy(out, o, s, s + 4);
    else if (ctype === 2) { out[o] = px[s]; out[o + 1] = px[s + 1]; out[o + 2] = px[s + 2]; out[o + 3] = 255; }
    else if (ctype === 0) { out[o] = out[o + 1] = out[o + 2] = px[s]; out[o + 3] = 255; }
    else if (ctype === 4) { out[o] = out[o + 1] = out[o + 2] = px[s]; out[o + 3] = px[s + 1]; }
    else { const k = px[s]; out[o] = plte[k * 3]; out[o + 1] = plte[k * 3 + 1]; out[o + 2] = plte[k * 3 + 2]; out[o + 3] = trns && k < trns.length ? trns[k] : 255; }
  }
  return { w, h, data: out };
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const t = Buffer.from(type, 'latin1'), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
export function encodePNG({ w, h, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ───────────── image helpers ─────────────
// bounding box of the opaque tile (ignores the soft drop shadow)
export function tileBox({ w, h, data }, min = 128) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] >= min) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  // square it around the centre so the tile keeps its shape
  const s = Math.max(x1 - x0 + 1, y1 - y0 + 1), cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
  return { x: cx - s / 2, y: cy - s / 2, w: s, h: s };
}

// area-average resample of a region (fractional edges allowed) to dw×dh, in premultiplied alpha
function resample(img, r, dw, dh) {
  const { w, data } = img;
  const pm = new Float32Array(img.w * img.h * 4);
  for (let i = 0; i < img.w * img.h; i++) { const a = data[i * 4 + 3] / 255; pm[i * 4] = data[i * 4] * a; pm[i * 4 + 1] = data[i * 4 + 1] * a; pm[i * 4 + 2] = data[i * 4 + 2] * a; pm[i * 4 + 3] = data[i * 4 + 3]; }
  const weights = (n, start, len, limit) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = start + (i * len) / n, b = start + ((i + 1) * len) / n, ws = [];
      for (let s = Math.floor(a); s < Math.ceil(b); s++) {
        const wgt = Math.min(b, s + 1) - Math.max(a, s);
        if (wgt > 0 && s >= 0 && s < limit) ws.push([s, wgt]);
      }
      out.push(ws);
    }
    return out;
  };
  const wx = weights(dw, r.x, r.w, img.w), wy = weights(dh, r.y, r.h, img.h);
  const tmp = new Float32Array(dw * img.h * 4);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < dw; x++) {
    const o = (y * dw + x) * 4;
    for (const [s, wgt] of wx[x]) { const i = (y * w + s) * 4; tmp[o] += pm[i] * wgt; tmp[o + 1] += pm[i + 1] * wgt; tmp[o + 2] += pm[i + 2] * wgt; tmp[o + 3] += pm[i + 3] * wgt; }
    for (let k = 0; k < 4; k++) tmp[o + k] /= r.w / dw;
  }
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const acc = [0, 0, 0, 0];
    for (const [s, wgt] of wy[y]) { const i = (s * dw + x) * 4; for (let k = 0; k < 4; k++) acc[k] += tmp[i + k] * wgt; }
    for (let k = 0; k < 4; k++) acc[k] /= (r.h / dh);
    const a = acc[3], o = (y * dw + x) * 4;
    out[o + 3] = Math.max(0, Math.min(255, Math.round(a)));
    if (a > 0) for (let k = 0; k < 3; k++) out[o + k] = Math.max(0, Math.min(255, Math.round((acc[k] * 255) / a)));
  }
  return { w: dw, h: dh, data: out };
}

function place(tile, size) {
  const canvas = Buffer.alloc(size * size * 4), off = (size - tile.w) >> 1;
  for (let y = 0; y < tile.h; y++) tile.data.copy(canvas, ((y + off) * size + off) * 4, y * tile.w * 4, (y + 1) * tile.w * 4);
  return { w: size, h: size, data: canvas };
}

// 32-bit BMP entry (what Windows prefers below 256px)
function bmpEntry({ w, h, data }) {
  const hdr = Buffer.alloc(40), mask = Buffer.alloc(Math.ceil(w / 32) * 4 * h), px = Buffer.alloc(w * h * 4);
  hdr.writeUInt32LE(40, 0); hdr.writeInt32LE(w, 4); hdr.writeInt32LE(h * 2, 8); hdr.writeUInt16LE(1, 12); hdr.writeUInt16LE(32, 14); hdr.writeUInt32LE(px.length + mask.length, 20);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, o = ((h - 1 - y) * w + x) * 4;
    px[o] = data[s + 2]; px[o + 1] = data[s + 1]; px[o + 2] = data[s]; px[o + 3] = data[s + 3];
  }
  return Buffer.concat([hdr, px, mask]);
}

// ───────────── ICO ─────────────
// fill: how much of each square the tile covers (Windows icons run nearly edge to edge)
export function makeWindowsIco(pngFile, icoFile, { fill = 0.94 } = {}) {
  const img = decodePNG(fs.readFileSync(pngFile));
  const box = tileBox(img);
  const images = SIZES.map((size) => {
    const pad = size <= 20 ? 0 : Math.max(1, Math.round((size * (1 - fill)) / 2));
    const t = resample(img, box, size - pad * 2, size - pad * 2);
    const full = place(t, size);
    return { size, bytes: size >= 256 ? encodePNG(full) : bmpEntry(full) };
  });
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach((im, i) => {
    const e = 6 + i * 16;
    head[e] = im.size >= 256 ? 0 : im.size; head[e + 1] = im.size >= 256 ? 0 : im.size;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(im.bytes.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += im.bytes.length;
  });
  fs.writeFileSync(icoFile, Buffer.concat([head, ...images.map((i) => i.bytes)]));
  return { file: icoFile, sizes: SIZES, hashes: images.map((i) => sha(i.bytes)), tileFill: box.w / img.w };
}

// ───────────── reading icons out of a Windows .exe ─────────────
export function exeIcons(exe) {
  const fd = fs.openSync(exe, 'r');
  try {
    const rd = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b; };
    const pe = rd(0x3c, 4).readUInt32LE(0);
    const coff = rd(pe, 24);
    if (coff.readUInt32LE(0) !== 0x4550) throw new Error('not a Windows program');
    const nSec = coff.readUInt16LE(6), optSize = coff.readUInt16LE(20), opt = rd(pe + 24, optSize);
    const ddir = opt.readUInt16LE(0) === 0x20b ? 112 : 96;
    const rsrcRva = opt.readUInt32LE(ddir + 16);
    if (!rsrcRva) return [];
    const secs = rd(pe + 24 + optSize, nSec * 40);
    let sec = null;
    for (let i = 0; i < nSec; i++) {
      const va = secs.readUInt32LE(i * 40 + 12), vs = Math.max(secs.readUInt32LE(i * 40 + 8), secs.readUInt32LE(i * 40 + 16));
      if (rsrcRva >= va && rsrcRva < va + vs) sec = { va, raw: secs.readUInt32LE(i * 40 + 20), size: secs.readUInt32LE(i * 40 + 16) };
    }
    if (!sec) return [];
    const rs = rd(sec.raw, sec.size), base = rsrcRva - sec.va;
    const dir = (off) => {
      const n = rs.readUInt16LE(base + off + 12) + rs.readUInt16LE(base + off + 14), out = [];
      for (let i = 0; i < n; i++) { const e = base + off + 16 + i * 8; out.push({ id: rs.readUInt32LE(e), off: rs.readUInt32LE(e + 4) }); }
      return out;
    };
    const leaf = (e) => { // walk to the first language's data
      while (e.off & 0x80000000) e = dir(e.off & 0x7fffffff)[0];
      const d = base + e.off, rva = rs.readUInt32LE(d), size = rs.readUInt32LE(d + 4);
      return rs.subarray(rva - sec.va, rva - sec.va + size);
    };
    const types = dir(0);
    const iconType = types.find((t) => t.id === 3), groupType = types.find((t) => t.id === 14);
    if (!iconType || !groupType) return [];
    const icons = new Map(dir(iconType.off & 0x7fffffff).map((e) => [e.id, e]));
    const group = leaf(dir(groupType.off & 0x7fffffff)[0]);
    const out = [];
    for (let i = 0, n = group.readUInt16LE(4); i < n; i++) {
      const e = 6 + i * 14, id = group.readUInt16LE(e + 12), ic = icons.get(id);
      if (ic) { const bytes = Buffer.from(leaf(ic)); out.push({ size: group[e] || 256, hash: sha(bytes) }); }
    }
    return out;
  } finally { fs.closeSync(fd); }
}

// { ok, reason }
export function checkExeIcon(exe, made) {
  let got;
  try { got = exeIcons(exe); } catch (e) { return { ok: false, reason: `couldn't read its icon (${e.message})` }; }
  if (!got.length) return { ok: false, reason: 'it has no icon at all' };
  const want = new Set(made.hashes), have = new Set(got.map((g) => g.hash));
  const missing = [...want].filter((h) => !have.has(h)).length;
  if (!missing) return { ok: true };
  if (missing === want.size) return { ok: false, reason: 'it still has the default Electron icon' };
  return { ok: false, reason: `only part of the app icon made it in (${want.size - missing} of ${want.size} sizes)` };
}
