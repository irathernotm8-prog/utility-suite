// ZIP-family reader (zip, jar, apk, aab, ipa, xapk, apkm, nupkg, docx/xlsx, crx, whl, epub…):
// central directory with zip64, stored + deflate. Anything else (AES, bzip2, LZMA, zstd) is flagged
// so the pipeline hands the archive to 7-Zip instead.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { FileReader } = require('../util');

const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const cp437 = (b) => { let s = ''; for (const c of b) s += c < 128 ? String.fromCharCode(c) : CP437[c - 128]; return s; };

function readDirectory(r) {
  const tailLen = Math.min(r.size, 65557);
  const tail = r.read(r.size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file (no central directory)');
  let count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
  const comment = tail.toString('utf8', eocd + 22, eocd + 22 + tail.readUInt16LE(eocd + 20));
  if (eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50) {
    const loc = Number(tail.readBigUInt64LE(eocd - 20 + 8));
    const z = r.read(loc, 56);
    if (z.readUInt32LE(0) === 0x06064b50) { count = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOff = Number(z.readBigUInt64LE(48)); }
  }
  // Self-extracting archives and APK signing blocks shift offsets: measure the real start.
  const eocdAbs = r.size - tailLen + eocd;
  let shift = 0;
  if (cdOff + cdSize < eocdAbs - (eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50 ? 76 : 0)) shift = 0;
  const probeCd = r.read(cdOff, 4);
  if (probeCd.length < 4 || probeCd.readUInt32LE(0) !== 0x02014b50) { shift = eocdAbs - cdSize - cdOff; }
  const cd = r.read(cdOff + shift, cdSize);
  const entries = [];
  let unsupported = 0, encrypted = 0;
  for (let p = 0, n = 0; n < count && p + 46 <= cd.length; n++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10);
    let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
    const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    const ext = cd.readUInt32LE(p + 38);
    let off = cd.readUInt32LE(p + 42);
    const nb = cd.subarray(p + 46, p + 46 + nl);
    const name = flags & 0x800 ? nb.toString('utf8') : (nb.every((c) => c < 128) ? nb.toString('latin1') : cp437(nb));
    let x = p + 46 + nl; const xe = x + xl;
    while (x + 4 <= xe) {
      const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
      if (id === 1) { let q = x + 4; if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; } if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; } if (off === 0xffffffff) off = Number(cd.readBigUInt64LE(q)); }
      x += 4 + len;
    }
    const dir = name.endsWith('/');
    const enc = !!(flags & 1);
    const ok = !enc && (method === 0 || method === 8);
    if (!dir && enc) encrypted++;
    else if (!dir && !ok) unsupported++;
    const mode = (ext >>> 16) & 0xffff;
    entries.push({ path: name.replace(/\/+$/, ''), dir, method, csize, size: usize, off: off + shift, encrypted: enc, supported: ok, link: (mode & 0xf000) === 0xa000, exec: !!(mode & 0o111) });
    p = xe + cl;
  }
  return { entries, comment, unsupported, encrypted, sfxOffset: shift };
}

function open(file) {
  const r = new FileReader(file);
  let d;
  try { d = readDirectory(r); } catch (e) { r.close(); throw e; }
  const dataStart = (e) => { const h = r.read(e.off, 30); if (h.readUInt32LE(0) !== 0x04034b50) throw new Error('Bad local header for ' + e.path); return e.off + 30 + h.readUInt16LE(26) + h.readUInt16LE(28); };
  const api = {
    format: 'zip', entries: d.entries, info: { files: d.entries.filter((e) => !e.dir).length, comment: d.comment || undefined, unsupported: d.unsupported, encrypted: d.encrypted, sfxOffset: d.sfxOffset || undefined },
    read(e) {
      if (typeof e === 'string') e = d.entries.find((x) => x.path === e);
      if (!e || !e.supported) throw new Error('Cannot read ' + (e ? e.path : 'entry'));
      const b = r.read(dataStart(e), e.csize);
      return e.method === 0 ? b : zlib.inflateRawSync(b);
    },
    find: (name) => d.entries.find((e) => e.path === name),
    // Returns a promise; small members are written synchronously, big deflated ones are streamed.
    async extract(e, dest) {
      if (e.dir) { fs.mkdirSync(dest, { recursive: true }); return; }
      if (!e.supported) throw new Error(e.encrypted ? 'encrypted' : 'unsupported method ' + e.method);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const start = dataStart(e);
      if (e.method === 8 && e.csize >= 32 << 20) {
        await pipeline(fs.createReadStream(null, { fd: r.fd, start, end: start + e.csize - 1, autoClose: false }), zlib.createInflateRaw(), fs.createWriteStream(dest));
      } else {
        const out = fs.openSync(dest, 'w');
        try {
          if (e.method === 0) { let done = 0; while (done < e.csize) { const n = Math.min(8 << 20, e.csize - done); fs.writeSync(out, r.read(start + done, n)); done += n; } }
          else if (e.csize) fs.writeSync(out, zlib.inflateRawSync(r.read(start, e.csize)));
        } finally { fs.closeSync(out); }
      }
      if (e.exec && process.platform !== 'win32') { try { fs.chmodSync(dest, 0o755); } catch {} }
    },
    close() { r.close(); },
  };
  return api;
}

const isZip = (b) => b.length >= 4 && b.readUInt32LE(0) === 0x04034b50;
module.exports = { open, isZip, readDirectory };
