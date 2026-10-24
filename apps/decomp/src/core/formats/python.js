// Python apps: PyInstaller executables (CArchive + PYZ), .pyc version detection, and the marshal
// subset needed to read PYZ tables. Writes proper .pyc files that pycdc / Python can load.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { FileReader, safeJoin, cstr } = require('../util');

const MAGIC = Buffer.from('MEI\x0c\x0b\x0a\x0b\x0e', 'latin1');
// Python version → pyc magic number
const PYC = { '2.7': 62211, '3.4': 3310, '3.5': 3351, '3.6': 3379, '3.7': 3394, '3.8': 3413, '3.9': 3425, '3.10': 3439, '3.11': 3495, '3.12': 3531, '3.13': 3571, '3.14': 3627 };
function versionFromMagic(n) {
  let best = null;
  for (const [v, m] of Object.entries(PYC)) if (n >= m - 40 && n <= m + 5 && (!best || Math.abs(n - m) < Math.abs(n - PYC[best]))) best = v;
  if (n >= 20121 && n <= 62211) best = n >= 62211 ? '2.7' : n >= 62151 ? '2.7' : '2.x';
  return best;
}
function pycHeader(magicBytes, version) {
  const [maj, min] = String(version || '3.8').split('.').map(Number);
  const size = maj > 3 || (maj === 3 && min >= 7) ? 16 : maj === 3 && min >= 3 ? 12 : 8;
  const h = Buffer.alloc(size); magicBytes.copy(h, 0, 0, 4); return h;
}
const magicFor = (version) => { const m = PYC[version]; if (!m) return null; const b = Buffer.alloc(4); b.writeUInt16LE(m, 0); b[2] = 0x0d; b[3] = 0x0a; return b; };

// ── marshal (read-only subset)
function unmarshal(buf, pos = 0) {
  const refs = [];
  let p = pos;
  const i32 = () => { const v = buf.readInt32LE(p); p += 4; return v; };
  const read = () => {
    const code = buf[p++]; const flag = code & 0x80, t = String.fromCharCode(code & 0x7f);
    let slot = -1; if (flag) { slot = refs.length; refs.push(null); }
    const keep = (v) => { if (slot >= 0) refs[slot] = v; return v; };
    switch (t) {
      case '0': return undefined; case 'N': return keep(null); case 'F': return keep(false); case 'T': return keep(true);
      case 'S': case '.': return keep(null);
      case 'i': return keep(i32());
      case 'I': { const v = Number(buf.readBigInt64LE(p)); p += 8; return keep(v); }
      case 'l': { const n = i32(); let v = 0; for (let k = 0; k < Math.abs(n); k++) { v += buf.readUInt16LE(p) * 2 ** (15 * k); p += 2; } return keep(n < 0 ? -v : v); }
      case 'g': { const v = buf.readDoubleLE(p); p += 8; return keep(v); }
      case 's': case 't': case 'u': case 'a': case 'A': { const n = i32(); const v = t === 's' ? buf.subarray(p, p + n) : buf.toString(t === 'u' || t === 't' ? 'utf8' : 'latin1', p, p + n); p += n; return keep(t === 's' ? v.toString('latin1') : v); }
      case 'z': case 'Z': { const n = buf[p++]; const v = buf.toString('latin1', p, p + n); p += n; return keep(v); }
      case '(': case '[': case '<': case '>': case ')': { const n = t === ')' ? buf[p++] : i32(); const a = []; keep(a); for (let k = 0; k < n; k++) a.push(read()); return a; }
      case '{': { const d = new Map(); keep(d); for (;;) { const k = read(); if (k === undefined) break; d.set(k, read()); } return d; }
      case 'r': return refs[i32()];
      default: throw new Error(`marshal type ${JSON.stringify(t)} not supported`);
    }
  };
  return read();
}

// ── PyInstaller CArchive
function findCookie(r) {
  const span = Math.min(r.size, 8 << 20);
  const tail = r.read(r.size - span, span);
  const i = tail.lastIndexOf(MAGIC);
  return i < 0 ? -1 : r.size - span + i;
}

function openPyInstaller(file) {
  const r = new FileReader(file);
  const at = findCookie(r);
  if (at < 0) { r.close(); return null; }
  const c = r.read(at, 88);
  const len = c.readUInt32BE(8), tocOff = c.readUInt32BE(12), tocLen = c.readUInt32BE(16), pyv = c.readUInt32BE(20);
  const lib = cstr(c, 24, 88);
  const cookieSize = /python|libpython/i.test(lib) ? 88 : 24;
  const start = at + cookieSize - len;
  const toc = r.read(start + tocOff, tocLen);
  const entries = [];
  for (let p = 0; p + 18 <= toc.length;) {
    const es = toc.readUInt32BE(p); if (es < 18) break;
    entries.push({ pos: toc.readUInt32BE(p + 4), csize: toc.readUInt32BE(p + 8), size: toc.readUInt32BE(p + 12), compressed: toc[p + 16] === 1, type: String.fromCharCode(toc[p + 17]), name: cstr(toc, p + 18, p + es) });
    p += es;
  }
  const version = pyv >= 100 ? `${Math.floor(pyv / 100)}.${pyv % 100}` : `${Math.floor(pyv / 10)}.${pyv % 10}`;
  const data = (e) => { const b = r.read(start + e.pos, e.csize); return e.compressed ? zlib.inflateSync(b) : b; };
  return { version, lib: cookieSize === 88 ? lib : null, entries, data, close: () => r.close(), start };
}

// Extracts everything; returns { version, scripts, modules, binaries, encrypted }.
function extractPyInstaller(file, outDir, { onProgress } = {}) {
  const a = openPyInstaller(file);
  if (!a) throw new Error('Not a PyInstaller executable');
  const res = { version: a.version, scripts: [], modules: 0, binaries: 0, encrypted: 0, pyzMagic: null, files: 0 };
  try {
    let magic = magicFor(a.version);
    // PYZ archives carry the exact magic; read one first.
    const pyzEntries = a.entries.filter((e) => e.type === 'z' || e.type === 'Z');
    for (const e of pyzEntries) { const b = a.data(e); if (b.toString('latin1', 0, 4) === 'PYZ\0') { magic = b.subarray(4, 8); res.pyzMagic = magic.readUInt16LE(0); break; } }
    const ver = res.pyzMagic ? versionFromMagic(res.pyzMagic) || a.version : a.version;
    res.version = ver;
    let n = 0;
    for (const e of a.entries) {
      onProgress && onProgress(++n / a.entries.length);
      let b; try { b = a.data(e); } catch { res.encrypted++; continue; }
      if (e.type === 's') {
        const dest = safeJoin(outDir, e.name + '.pyc');
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.concat([pycHeader(magic || Buffer.alloc(4), ver), b]));
        res.scripts.push(path.relative(outDir, dest)); res.files++;
      } else if (e.type === 'z' || e.type === 'Z') {
        const dest = safeJoin(outDir, e.name); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, b); res.files++;
        const r2 = extractPyz(b, safeJoin(outDir, e.name.replace(/\.pyz$/i, '') + ' (modules)'), ver); res.modules += r2.modules; res.encrypted += r2.encrypted; res.files += r2.modules;
      } else if (e.type !== 'o') {
        const dest = safeJoin(outDir, e.name + (e.type === 'm' || e.type === 'M' ? '.pyc' : ''));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const body = (e.type === 'm' || e.type === 'M') && b.readUInt32LE(0) !== (magic ? magic.readUInt32LE(0) : -1) ? Buffer.concat([pycHeader(magic || Buffer.alloc(4), ver), b]) : b;
        fs.writeFileSync(dest, body); res.files++;
        if (e.type === 'b') res.binaries++;
      }
    }
  } finally { a.close(); }
  return res;
}

function extractPyz(b, outDir, ver) {
  const magic = b.subarray(4, 8), tocPos = b.readUInt32BE(8);
  let toc = unmarshal(b, tocPos);
  const items = toc instanceof Map ? [...toc.entries()] : toc;
  let modules = 0, encrypted = 0;
  for (const it of items) {
    const [name, meta] = it; const [kind, pos, len] = meta;
    const raw = b.subarray(pos, pos + len);
    let code; try { code = zlib.inflateSync(raw); } catch { encrypted++; continue; }
    const rel = String(name).split('.').join('/') + (kind === 1 || kind === true ? '/__init__' : '') + '.pyc';
    const dest = safeJoin(outDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.concat([pycHeader(magic, ver), code]));
    modules++;
  }
  return { modules, encrypted };
}

function pycInfo(b) {
  if (b.length < 4 || b[2] !== 0x0d || b[3] !== 0x0a) return null;
  const n = b.readUInt16LE(0); const v = versionFromMagic(n);
  return v ? { magic: n, version: v } : null;
}

module.exports = { openPyInstaller, extractPyInstaller, extractPyz, unmarshal, pycInfo, versionFromMagic, findCookie, MAGIC };
