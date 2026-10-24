'use strict';
// What gets sent: walking files and folders, the transfer plan both sides agree on, and safe names on arrival.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const SKIP = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized', 'Icon\r']);

// Expand the dropped paths into a flat list of files (relative paths use "/"), plus empty folders.
async function collect(paths, { onProgress } = {}) {
  const items = [], dirs = [];
  let n = 0;
  const seen = new Set();
  async function walk(abs, rel) {
    let st;
    try { st = await fsp.stat(abs); } catch { return; }
    if (st.isDirectory()) {
      let names;
      try { names = await fsp.readdir(abs); } catch { return; }
      names = names.filter(x => !SKIP.has(x)).sort((a, b) => a.localeCompare(b));
      if (!names.length) { dirs.push(rel); return; }
      const before = items.length + dirs.length;
      for (const x of names) await walk(path.join(abs, x), rel + '/' + x);
      if (items.length + dirs.length === before) dirs.push(rel);
    } else if (st.isFile()) {
      const key = abs;
      if (seen.has(key)) return; seen.add(key);
      items.push({ p: rel, s: st.size, m: Math.round(st.mtimeMs), abs });
      if (onProgress && ++n % 500 === 0) onProgress(n);
    }
  }
  const used = new Set();
  for (const p of paths) {
    let base = path.basename(p.replace(/[\\/]+$/, '')) || 'Item';
    // two dropped things with the same name (from different folders) keep both
    let name = base, k = 2;
    while (used.has(name.toLowerCase())) { const e = path.extname(base); name = `${base.slice(0, base.length - e.length)} ${k++}${e}`; }
    used.add(name.toLowerCase());
    await walk(p, name);
  }
  return { items, dirs };
}

// The plan: both sides build the same list of jobs from the same file list and settings,
// so a job is named by its number alone.
//  - big files are cut into segments that travel side by side over several connections
//  - small files are packed together so thousands of them don't each pay for a round trip
function plan(items, { seg = 32 << 20, small = 1 << 20, batch = 16 << 20, batchCount = 1000 } = {}) {
  const tasks = [];
  let cur = null;
  const flush = () => { if (cur) { tasks.push(cur); cur = null; } };
  items.forEach((it, f) => {
    if (!it.s) return;
    if (it.s <= small) {
      if (!cur) cur = { files: [], bytes: 0 };
      cur.files.push(f); cur.bytes += it.s;
      if (cur.bytes >= batch || cur.files.length >= batchCount) flush();
      return;
    }
    for (let o = 0; o < it.s; o += seg) tasks.push({ f, o, l: Math.min(seg, it.s - o), bytes: Math.min(seg, it.s - o) });
  });
  flush();
  // biggest jobs first so the long ones start early and the tail is short
  tasks.sort((a, b) => b.bytes - a.bytes);
  return tasks.map((t, k) => ({ ...t, k }));
}

const WIN_BAD = /[<>:"|?*\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
function cleanPart(s) {
  let x = String(s).replace(WIN_BAD, '_').replace(/[\\/]/g, '_');
  x = x.replace(/[. ]+$/, '');
  if (!x || x === '.' || x === '..') x = '_';
  if (RESERVED.test(x)) x = '_' + x;
  return x.slice(0, 240);
}
// A relative path from another device, made safe for this one (never escapes the folder).
function safeRel(p) {
  const parts = String(p || '').split('/').filter(x => x && x !== '.' && x !== '..').map(cleanPart);
  if (!parts.length) throw new Error('bad path');
  return parts;
}

async function exists(p) { try { await fsp.lstat(p); return true; } catch { return false; } }
async function uniquePath(dir, name) {
  let p = path.join(dir, name);
  if (!(await exists(p))) return p;
  const ext = path.extname(name), stem = ext && ext !== name ? name.slice(0, -ext.length) : name;
  for (let k = 2; k < 10000; k++) {
    p = path.join(dir, ext && ext !== name ? `${stem} ${k}${ext}` : `${name} ${k}`);
    if (!(await exists(p))) return p;
  }
  throw new Error('no free name');
}

// Move, falling back to copy + delete when the target is on another drive.
async function move(src, dst) {
  try { await fsp.rename(src, dst); }
  catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.cp(src, dst, { recursive: true, preserveTimestamps: true });
    await fsp.rm(src, { recursive: true, force: true });
  }
}

function human(n) {
  if (!Number.isFinite(n)) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
}

module.exports = { collect, plan, safeRel, cleanPart, uniquePath, move, exists, human, SKIP };
