// Glean — the tray: everything collected so far, deduped by picture, grouped into posts.
// A short page buffer remembers what the page loaded before you pressed Collect, so nothing is missed.
const { merge, accountFromUrl, siteOf } = require('./extract');

class Collection {
  constructor(onChange) {
    this.items = new Map();      // key -> media
    this.order = 0;
    this.buffer = new Map();     // key -> media, seen on the current page while not collecting
    this.active = false;
    this.onChange = onChange || (() => {});
    this.dirty = new Set();
    this.removed = new Set();
    this.timer = null;
  }
  _flush() {
    this.timer = null;
    const upserts = [...this.dirty].map(k => this.items.get(k)).filter(Boolean);
    const removed = [...this.removed];
    this.dirty.clear(); this.removed.clear();
    if (upserts.length || removed.length) this.onChange({ upserts, removed, total: this.items.size });
  }
  _touch(key) { this.dirty.add(key); if (!this.timer) this.timer = setTimeout(() => this._flush(), 250); }

  _put(map, m) {
    const old = map.get(m.key);
    if (old) { const n = merge(old, m); map.set(m.key, n); return n !== old && JSON.stringify(n) !== JSON.stringify(old); }
    map.set(m.key, { ...m, seq: ++this.order, seenAt: Date.now() });
    return true;
  }
  // Media seen on the page. Goes into the tray while collecting, otherwise into the page buffer.
  offer(list) {
    for (const m of list || []) {
      if (!m || !m.url) continue;
      if (this.active) { if (this._put(this.items, m)) this._touch(m.key); }
      else {
        if (this.items.has(m.key)) { if (this._put(this.items, m)) this._touch(m.key); continue; } // richer info for something already in the tray
        this._put(this.buffer, m);
        if (this.buffer.size > 4000) { const first = this.buffer.keys().next().value; this.buffer.delete(first); }
      }
    }
  }
  // Start collecting on a page: take what the page already loaded that belongs to it.
  start(pageUrl) {
    this.active = true;
    const acct = accountFromUrl(pageUrl); const site = siteOf(pageUrl);
    for (const m of this.buffer.values()) {
      if (m.site !== site && siteOf(m.url) !== site && m.source !== 'api') continue;
      if (acct && m.account && m.account !== acct) continue;
      if (this._put(this.items, m)) this._touch(m.key);
    }
    this.buffer.clear();
  }
  stop() { this.active = false; }
  newPage() { this.buffer.clear(); }
  remove(keys) { for (const k of keys || []) { if (this.items.delete(k)) { this.removed.add(k); this.dirty.delete(k); } } if (!this.timer) this.timer = setTimeout(() => this._flush(), 50); }
  clear() { const keys = [...this.items.keys()]; this.items.clear(); this.buffer.clear(); this.dirty.clear(); this.removed.clear(); this.onChange({ reset: true, upserts: [], removed: keys, total: 0 }); }
  list() { return [...this.items.values()]; }
  get(key) { return this.items.get(key); }
}

module.exports = { Collection };
