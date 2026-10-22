// Glean — the library: one "haul" per account or page you've saved from.
// Each haul's folder holds the files plus glean.json (what was saved, from where) and captions.csv.
// library.json in app data is just the index; the folders are the truth and can be rebuilt from glean.json.
const fs = require('fs');
const path = require('path');
const { captionsCsv, clean } = require('./naming');

const MANIFEST = 'glean.json';

function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJson(p, v) { const tmp = p + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 1)); fs.renameSync(tmp, p); }

class Library {
  constructor(indexFile) {
    this.indexFile = indexFile;
    this.index = readJson(indexFile, { hauls: [] });
    if (!Array.isArray(this.index.hauls)) this.index.hauls = [];
    this.manifests = new Map(); // folder -> manifest (cache)
  }
  save() { try { fs.mkdirSync(path.dirname(this.indexFile), { recursive: true }); writeJson(this.indexFile, this.index); } catch (_) {} }
  list() {
    return this.index.hauls.filter(h => fs.existsSync(h.folder)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  get(id) { return this.index.hauls.find(h => h.id === id) || null; }
  byFolder(folder) { return this.index.hauls.find(h => path.resolve(h.folder) === path.resolve(folder)) || null; }

  manifest(folder) {
    if (this.manifests.has(folder)) return this.manifests.get(folder);
    const m = readJson(path.join(folder, MANIFEST), null) || { app: 'Glean', version: 1, items: {} };
    if (!m.items || typeof m.items !== 'object') m.items = {};
    this.manifests.set(folder, m);
    return m;
  }
  // Every key saved anywhere in the library (so the tray can mark what you already have).
  savedKeys() {
    const s = new Set();
    for (const h of this.list()) for (const k of Object.keys(this.manifest(h.folder).items)) s.add(k);
    return s;
  }
  // Open (or create) the haul for a folder.
  ensure(folder, info) {
    let h = this.byFolder(folder);
    if (!h) {
      h = { id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), folder, createdAt: Date.now(), updatedAt: Date.now(), count: 0, ...info };
      this.index.hauls.push(h);
    } else {
      for (const k of ['site', 'account', 'accountName', 'title']) if (info[k]) h[k] = info[k];
      if (info.sourceUrl) h.sourceUrl = info.sourceUrl;
    }
    const m = this.manifest(folder);
    Object.assign(m, { site: h.site, account: h.account, accountName: h.accountName || null, title: h.title, sourceUrl: h.sourceUrl || m.sourceUrl || null });
    return h;
  }
  // Record one saved file. relFile is relative to the haul folder.
  record(folder, key, entry) {
    const m = this.manifest(folder);
    m.items[key] = { ...entry, savedAt: Date.now() };
    m.dirty = true;
  }
  has(folder, key) {
    const e = this.manifest(folder).items[key];
    return !!(e && e.file && fs.existsSync(path.join(folder, e.file)));
  }
  // Write glean.json + captions.csv for every haul that changed, refresh the index.
  flush() {
    for (const [folder, m] of this.manifests) {
      if (!m.dirty) continue;
      delete m.dirty;
      try {
        fs.mkdirSync(folder, { recursive: true });
        writeJson(path.join(folder, MANIFEST), m);
        const rows = Object.entries(m.items).map(([key, e]) => ({ key, ...e }));
        fs.writeFileSync(path.join(folder, 'captions.csv'), captionsCsv(rows));
      } catch (_) {}
      const h = this.byFolder(folder);
      if (h) {
        const items = Object.values(m.items);
        h.count = items.length; h.photos = items.filter(i => i.kind !== 'video').length; h.videos = items.length - h.photos;
        h.posts = new Set(items.map(i => i.postId).filter(Boolean)).size;
        h.updatedAt = Date.now();
        h.cover = items.filter(i => i.kind !== 'video' || i.poster).sort((a, b) => (b.date || b.savedAt) - (a.date || a.savedAt)).slice(0, 4).map(i => i.kind === 'video' ? i.poster : i.file);
      }
    }
    this.save();
  }
  remove(id) { this.index.hauls = this.index.hauls.filter(h => h.id !== id); this.save(); }
  // Items of a haul, newest first, with absolute paths, for the Library view and contact sheets.
  items(id) {
    const h = this.get(id); if (!h) return [];
    const m = this.manifest(h.folder);
    return Object.entries(m.items).map(([key, e]) => ({ key, ...e, path: path.join(h.folder, e.file), posterPath: e.poster ? path.join(h.folder, e.poster) : null, exists: fs.existsSync(path.join(h.folder, e.file)) }))
      .sort((a, b) => (b.date || 0) - (a.date || 0) || String(a.postId || '').localeCompare(String(b.postId || '')) || (a.postIndex || 0) - (b.postIndex || 0));
  }
  // Re-adopt folders that have a glean.json but aren't in the index (e.g. after reinstalling).
  rescan(root) {
    let added = 0;
    const walk = (dir, depth) => {
      if (depth > 3) return;
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      if (ents.some(e => e.isFile() && e.name === MANIFEST)) {
        if (!this.byFolder(dir)) {
          const m = readJson(path.join(dir, MANIFEST), null);
          if (m && m.items) { this.manifests.set(dir, m); this.ensure(dir, { site: m.site, account: m.account, accountName: m.accountName, title: m.title || clean(path.basename(dir)), sourceUrl: m.sourceUrl }); m.dirty = true; added++; }
        }
        return;
      }
      for (const e of ents) if (e.isDirectory() && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1);
    };
    walk(root, 0);
    if (added) this.flush();
    return added;
  }
}

module.exports = { Library, MANIFEST };
