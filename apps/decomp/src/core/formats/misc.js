// Smaller game/installer formats: RPG Maker archives (decrypted), Apple pbzx payloads, Flash SWF.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { FileReader, safeJoin } = require('../util');

// ── RPG Maker RGSSAD / rgss2a / rgss3a
const step = (k) => (Math.imul(k, 7) + 3) >>> 0;
function xorData(buf, key) {
  const out = Buffer.from(buf);
  let k = key >>> 0;
  for (let i = 0; i < out.length; i += 4) {
    for (let j = 0; j < 4 && i + j < out.length; j++) out[i + j] ^= (k >>> (8 * j)) & 0xff;
    k = step(k);
  }
  return out;
}
function rgssEntries(r) {
  const h = r.read(0, 8); const ver = h[7]; const entries = [];
  if (ver === 3) {
    let key = (Math.imul(r.read(8, 4).readUInt32LE(0), 9) + 3) >>> 0; let p = 12;
    for (let guard = 0; guard < 200000; guard++) {
      const b = r.read(p, 16); if (b.length < 16) break;
      const off = (b.readUInt32LE(0) ^ key) >>> 0; if (!off) break;
      const size = (b.readUInt32LE(4) ^ key) >>> 0, fkey = (b.readUInt32LE(8) ^ key) >>> 0, nl = (b.readUInt32LE(12) ^ key) >>> 0;
      const nb = Buffer.from(r.read(p + 16, nl)); for (let i = 0; i < nb.length; i++) nb[i] ^= (key >>> (8 * (i % 4))) & 0xff;
      entries.push({ path: nb.toString('utf8').replace(/\\/g, '/'), size, offset: off, key: fkey }); p += 16 + nl;
    }
  } else {
    let key = 0xdeadcafe; let p = 8;
    for (let guard = 0; guard < 200000 && p + 4 <= r.size; guard++) {
      const nl = (r.read(p, 4).readUInt32LE(0) ^ key) >>> 0; key = step(key); p += 4;
      if (nl > 4096) break;
      const nb = Buffer.from(r.read(p, nl)); for (let i = 0; i < nb.length; i++) { nb[i] ^= key & 0xff; key = step(key); } p += nl;
      const size = (r.read(p, 4).readUInt32LE(0) ^ key) >>> 0; key = step(key); p += 4;
      entries.push({ path: nb.toString('utf8').replace(/\\/g, '/'), size, offset: p, key }); p += size;
    }
  }
  return { version: ver, entries };
}
function openRgss(file) {
  const r = new FileReader(file); const { version, entries } = rgssEntries(r);
  return { format: 'rgss', info: { version, files: entries.length }, entries, extract(e, dest) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, xorData(r.read(e.offset, e.size), e.key)); }, close() { r.close(); } };
}

// ── Apple pbzx (Payload inside modern .pkg files) → concatenated .xz (or raw cpio)
function pbzx(file, outBase) {
  const r = new FileReader(file);
  try {
    if (r.read(0, 4).toString('latin1') !== 'pbzx') return null;
    let p = 12; const xzOut = outBase + '.xz', rawOut = outBase + '.cpio'; let xz = null, raw = null;
    while (p + 16 <= r.size) {
      const len = Number(r.read(p + 8, 8).readBigUInt64BE(0)); p += 16;
      const chunk = r.read(p, len); p += len;
      if (chunk.toString('hex', 0, 6) === 'fd377a585a00') { xz = xz || fs.openSync(xzOut, 'w'); fs.writeSync(xz, chunk); }
      else { raw = raw || fs.openSync(rawOut, 'w'); fs.writeSync(raw, chunk); }
    }
    if (xz) fs.closeSync(xz); if (raw) fs.closeSync(raw);
    return { xz: xz ? xzOut : null, raw: raw ? rawOut : null };
  } finally { r.close(); }
}

// ── Flash SWF: decompress, list tags, pull out ActionScript 3 (ABC) blocks and JPEGs
const TAGS = { 0: 'End', 1: 'ShowFrame', 2: 'DefineShape', 6: 'DefineBits', 9: 'SetBackgroundColor', 10: 'DefineFont', 11: 'DefineText', 12: 'DoAction', 14: 'DefineSound', 20: 'DefineBitsLossless', 21: 'DefineBitsJPEG2', 26: 'PlaceObject2', 35: 'DefineBitsJPEG3', 36: 'DefineBitsLossless2', 39: 'DefineSprite', 43: 'FrameLabel', 56: 'ExportAssets', 59: 'DoInitAction', 69: 'FileAttributes', 72: 'DoABC', 76: 'SymbolClass', 77: 'Metadata', 82: 'DoABC2', 87: 'DefineBinaryData' };
function swf(file, outDir, { lzma } = {}) {
  let b = fs.readFileSync(file); const sig = b.toString('latin1', 0, 3);
  if (sig === 'CWS') b = Buffer.concat([Buffer.from('FWS'), b.subarray(3, 8), zlib.inflateSync(b.subarray(8))]);
  else if (sig === 'ZWS') { if (!lzma) throw Object.assign(new Error('LZMA SWF needs 7-Zip'), { needs7z: true }); b = Buffer.concat([Buffer.from('FWS'), b.subarray(3, 8), lzma(b)]); }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'uncompressed.swf'), b);
  const nbits = b[8] >> 3; let p = 8 + Math.ceil((5 + nbits * 4) / 8) + 4;
  const counts = {}; const lines = []; let abc = 0, jpg = 0, bin = 0; const symbols = [];
  while (p + 2 <= b.length) {
    const cl = b.readUInt16LE(p); p += 2; const code = cl >> 6; let len = cl & 0x3f; if (len === 0x3f) { len = b.readUInt32LE(p); p += 4; }
    const body = b.subarray(p, p + len); p += len;
    counts[TAGS[code] || 'Tag' + code] = (counts[TAGS[code] || 'Tag' + code] || 0) + 1;
    if (code === 72 || code === 82) { fs.mkdirSync(path.join(outDir, 'actionscript'), { recursive: true }); let q = 0; let name = ''; if (code === 82) { q = 4; const e = body.indexOf(0, q); name = body.toString('utf8', q, e); q = e + 1; } fs.writeFileSync(safeJoin(outDir, `actionscript/${String(++abc).padStart(3, '0')}${name ? '-' + name.replace(/[^\w.-]/g, '_') : ''}.abc`), body.subarray(q)); }
    if (code === 21 || code === 35) { const id = body.readUInt16LE(0); const data = code === 35 ? body.subarray(6, 6 + body.readUInt32LE(2)) : body.subarray(2); fs.mkdirSync(path.join(outDir, 'images'), { recursive: true }); fs.writeFileSync(path.join(outDir, 'images', `${id}.jpg`), data); jpg++; }
    if (code === 87) { const id = body.readUInt16LE(0); fs.mkdirSync(path.join(outDir, 'binary'), { recursive: true }); fs.writeFileSync(path.join(outDir, 'binary', `${id}.bin`), body.subarray(6)); bin++; }
    if (code === 76) { const n = body.readUInt16LE(0); let q = 2; for (let i = 0; i < n; i++) { const id = body.readUInt16LE(q); q += 2; const e = body.indexOf(0, q); symbols.push(`${id}\t${body.toString('utf8', q, e)}`); q = e + 1; } }
    if (code === 0) break;
  }
  for (const [k, v] of Object.entries(counts).sort((a, c) => c[1] - a[1])) lines.push(`${String(v).padStart(6)}  ${k}`);
  fs.writeFileSync(path.join(outDir, 'tags.txt'), `Flash ${b[3]} movie\n\n` + lines.join('\n') + (symbols.length ? '\n\nClasses\n' + symbols.join('\n') : '') + '\n');
  return { version: b[3], abc, images: jpg, binary: bin, classes: symbols.length };
}

module.exports = { openRgss, xorData, pbzx, swf };
