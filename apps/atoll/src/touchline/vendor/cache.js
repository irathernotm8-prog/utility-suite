// Vendored from apps/touchline/src/data by `npm run sync-touchline`. Edit it in Touchline, not here.
// Touchline — disk cache with per-entry lifetimes.
// Fresh entries are served straight from disk. Expired entries are refetched;
// if the network fails, the expired copy is served and marked stale, so the
// app keeps working offline with whatever it has already seen.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Cache {
  constructor(dir) {
    this.dir = dir;
    this.mem = new Map();          // key -> { at, ttl, value }
    this.inflight = new Map();     // key -> Promise
    fs.mkdirSync(dir, { recursive: true });
  }

  file(key) {
    const h = crypto.createHash('sha1').update(key).digest('hex');
    return path.join(this.dir, h.slice(0, 2), `${h}.json`);
  }

  read(key) {
    if (this.mem.has(key)) return this.mem.get(key);
    try {
      const e = JSON.parse(fs.readFileSync(this.file(key), 'utf8'));
      if (e && e.key === key) { this.remember(key, e); return e; }
    } catch {}
    return null;
  }

  remember(key, e) {
    this.mem.set(key, e);
    if (this.mem.size > 400) this.mem.delete(this.mem.keys().next().value);
  }

  write(key, value, ttl) {
    const e = { key, at: Date.now(), ttl, value };
    this.remember(key, e);
    const f = this.file(key);
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(`${f}.tmp`, JSON.stringify(e));
      fs.renameSync(`${f}.tmp`, f);
    } catch {}
    return e;
  }

  /**
   * get(key, ttlMs | (value)=>ttlMs, loader, { force })
   * Returns { value, at, stale, fromCache }.
   */
  async get(key, ttl, loader, { force = false } = {}) {
    const hit = this.read(key);
    const now = Date.now();
    if (hit && !force && now - hit.at < hit.ttl) return { value: hit.value, at: hit.at, stale: false, fromCache: true };
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = (async () => {
      try {
        const value = await loader();
        const life = typeof ttl === 'function' ? ttl(value) : ttl;
        const e = this.write(key, value, life);
        return { value, at: e.at, stale: false, fromCache: false };
      } catch (err) {
        if (hit) return { value: hit.value, at: hit.at, stale: true, fromCache: true, error: err.message };
        throw err;
      } finally { this.inflight.delete(key); }
    })();
    this.inflight.set(key, p);
    return p;
  }

  size() {
    let bytes = 0, files = 0;
    const walk = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, n.name); if (n.isDirectory()) walk(p); else { files++; bytes += fs.statSync(p).size; } } };
    try { walk(this.dir); } catch {}
    return { bytes, files };
  }

  clear() {
    this.mem.clear();
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(this.dir, { recursive: true });
  }
}

const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
module.exports = { Cache, MIN, HOUR, DAY };
