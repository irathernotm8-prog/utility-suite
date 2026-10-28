// Bench — small JSON files in the app-data folder (desks, findings, runs, settings), written safely.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
const newId = (prefix = '') => prefix + crypto.randomBytes(5).toString('hex');
const slug = (s) => String(s || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'app';

/** A list of records kept in one JSON file. */
class Collection {
  constructor(file, { key = 'id', max = 0 } = {}) { this.file = file; this.key = key; this.max = max; this.items = readJson(file, []); if (!Array.isArray(this.items)) this.items = []; }
  all() { return this.items.slice(); }
  get(id) { return this.items.find((x) => x[this.key] === id) || null; }
  add(rec) { this.items.unshift(rec); if (this.max && this.items.length > this.max) this.items.length = this.max; this.save(); return rec; }
  update(id, patch) { const r = this.get(id); if (!r) return null; Object.assign(r, typeof patch === 'function' ? patch(r) || {} : patch); this.save(); return r; }
  remove(id) { const n = this.items.length; this.items = this.items.filter((x) => x[this.key] !== id); if (n !== this.items.length) this.save(); return n !== this.items.length; }
  save() { writeJson(this.file, this.items); }
}

/** Removes a folder only if it sits inside one of Bench's own folders. */
function safeRemove(target, roots) {
  const t = path.resolve(target);
  if (!roots.some((r) => { const rr = path.resolve(r); return t !== rr && t.startsWith(rr + path.sep); })) throw new Error(`Bench won’t delete ${t}: it isn’t inside Bench’s own folders`);
  fs.rmSync(t, { recursive: true, force: true });
}

function dirSize(dir, limit = 200000) {
  let total = 0, n = 0; const stack = [dir];
  while (stack.length && n < limit) {
    const d = stack.pop(); let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) { n++; const p = path.join(d, e.name); if (e.isDirectory()) stack.push(p); else if (e.isFile()) { try { total += fs.statSync(p).size; } catch {} } }
  }
  return total;
}

module.exports = { readJson, writeJson, newId, slug, Collection, safeRemove, dirSize };
