// Small shared helpers: JSON files, safe paths, sizes, a random-access file reader.
'use strict';
const fs = require('fs');
const path = require('path');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Joins an archive member name onto a folder without ever leaving it ("zip slip"), and makes names
// legal on Windows and macOS.
const WIN_BAD = /[<>:"|?*\x00-\x1f]/g;
const WIN_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
function safeJoin(root, member) {
  const parts = String(member).replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..');
  const clean = parts.map((p) => {
    let s = p.replace(WIN_BAD, '_').replace(/[. ]+$/, (m) => m.replace(/./g, '_'));
    if (WIN_RESERVED.test(s)) s = '_' + s;
    return s.slice(0, 200) || '_';
  });
  const out = path.join(root, ...clean);
  const rel = path.relative(root, out);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Unsafe path in archive: ' + member);
  return out;
}

const fmtSize = (n) => {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + ' TB';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + ' MB';
  if (n >= 1e3) return Math.round(n / 1e3) + ' KB';
  return n + ' B';
};

// Random-access reads from big files (disc images can be tens of GB, so nothing is loaded whole).
class FileReader {
  constructor(file) { this.file = file; this.fd = fs.openSync(file, 'r'); this.size = fs.fstatSync(this.fd).size; }
  read(pos, len) {
    if (pos < 0 || pos >= this.size) return Buffer.alloc(0);
    len = Math.max(0, Math.min(len, this.size - pos));
    const b = Buffer.alloc(len);
    let got = 0;
    while (got < len) { const n = fs.readSync(this.fd, b, got, len - got, pos + got); if (!n) break; got += n; }
    return got === len ? b : b.subarray(0, got);
  }
  close() { try { fs.closeSync(this.fd); } catch {} }
}
const withReader = (file, fn) => { const r = new FileReader(file); try { return fn(r); } finally { r.close(); } };

// Copies a byte range of one file into a new file in chunks.
function copyRange(srcFd, start, length, dest, bufSize = 4 << 20) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const out = fs.openSync(dest, 'w');
  try {
    const buf = Buffer.allocUnsafe(Math.min(bufSize, Math.max(1, length)));
    let done = 0;
    while (done < length) {
      const n = fs.readSync(srcFd, buf, 0, Math.min(buf.length, length - done), start + done);
      if (!n) break;
      fs.writeSync(out, buf, 0, n);
      done += n;
    }
    return done;
  } finally { fs.closeSync(out); }
}

// Lists every file under a folder (no symlink following).
function walk(dir, { max = 500000 } = {}) {
  const out = [];
  const stack = [dir];
  while (stack.length && out.length < max) {
    const d = stack.pop();
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) out.push(p);
    }
  }
  return out;
}

const cstr = (buf, start = 0, end = buf.length) => {
  let e = start; while (e < end && buf[e] !== 0) e++;
  return buf.toString('latin1', start, e);
};

const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
};

module.exports = { readJson, writeJson, safeJoin, fmtSize, FileReader, withReader, copyRange, walk, cstr, stamp };
