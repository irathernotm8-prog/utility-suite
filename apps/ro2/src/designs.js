// Designs are single .ro2 files (JSON) in the designs folder (default ~/Documents/RO2).
// index.json in the app-data folder caches names, sizes and thumbnails so Home opens instantly.
'use strict';
const fs = require('fs');
const path = require('path');

const safeName = (s) => String(s || 'Untitled design').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled design';

class Designs {
  constructor(indexFile, getFolder) {
    this.indexFile = indexFile; this.getFolder = getFolder;
    try { this.index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch { this.index = {}; }
  }
  folder() { const d = this.getFolder(); fs.mkdirSync(d, { recursive: true }); return d; }
  _saveIndex() { try { fs.writeFileSync(this.indexFile, JSON.stringify(this.index)); } catch {} }
  _unique(name, except) {
    const dir = this.folder(); let base = safeName(name), p = path.join(dir, base + '.ro2'), n = 2;
    while (fs.existsSync(p) && p !== except) p = path.join(dir, `${base} ${n++}.ro2`);
    return p;
  }
  // Scan the folder so designs copied in by hand (or from another computer) show up too.
  list() {
    const dir = this.folder(); const seen = new Set(); let changed = false;
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.ro2')) continue;
      const p = path.join(dir, f); seen.add(p);
      let st; try { st = fs.statSync(p); } catch { continue; }
      const e = this.index[p];
      if (!e || e.mtime !== st.mtimeMs) {
        try {
          const d = JSON.parse(fs.readFileSync(p, 'utf8'));
          this.index[p] = { name: d.name || f.slice(0, -4), w: d.width, h: d.height, pages: (d.pages || []).length, thumb: d.thumb || null, updated: d.updated || st.mtimeMs, mtime: st.mtimeMs };
        } catch { this.index[p] = { name: f.slice(0, -4), broken: true, updated: st.mtimeMs, mtime: st.mtimeMs }; }
        changed = true;
      }
    }
    for (const p of Object.keys(this.index)) if (!seen.has(p) && path.dirname(p) === dir) { delete this.index[p]; changed = true; }
    if (changed) this._saveIndex();
    return Object.entries(this.index).filter(([p]) => seen.has(p)).map(([file, e]) => ({ file, ...e })).sort((a, b) => b.updated - a.updated);
  }
  load(file) { return fs.readFileSync(file, 'utf8'); }
  // data: the design as a JSON string; returns the file it was written to (a new one for a new design)
  save({ file, name, data }) {
    const target = file && fs.existsSync(path.dirname(file)) ? file : this._unique(name);
    const tmp = target + '.saving';
    fs.writeFileSync(tmp, data); fs.renameSync(tmp, target);
    try {
      const d = JSON.parse(data); const st = fs.statSync(target);
      this.index[target] = { name: d.name, w: d.width, h: d.height, pages: (d.pages || []).length, thumb: d.thumb || null, updated: d.updated || Date.now(), mtime: st.mtimeMs };
      this._saveIndex();
    } catch {}
    return target;
  }
  rename(file, name) {
    const to = this._unique(name, file);
    const d = JSON.parse(fs.readFileSync(file, 'utf8')); d.name = name;
    fs.writeFileSync(file, JSON.stringify(d));
    if (to !== file) fs.renameSync(file, to);
    delete this.index[file]; this._saveIndex();
    return to;
  }
  duplicate(file) {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    d.name = (d.name || 'Design') + ' copy'; d.id = Math.random().toString(36).slice(2); d.updated = Date.now();
    const to = this._unique(d.name);
    fs.writeFileSync(to, JSON.stringify(d)); return to;
  }
  forget(file) { delete this.index[file]; this._saveIndex(); }
}

module.exports = { Designs, safeName };
