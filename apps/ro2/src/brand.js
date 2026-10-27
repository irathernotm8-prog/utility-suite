// Brand kits: logos, colours and fonts for quick access. Kept in the app-data folder:
//   brand.json                 the kits (names, colours, fonts, logo list) and which one is active
//   Brand/<kit id>/<logo>.ext  the logo files
'use strict';
const fs = require('fs');
const path = require('path');

const rid = () => Math.random().toString(36).slice(2, 10);
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif', avif: 'image/avif' };

class Brand {
  constructor(dir) {
    this.dir = dir; this.file = path.join(dir, 'brand.json'); this.logos = path.join(dir, 'Brand');
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.data = null; }
    if (!this.data || !Array.isArray(this.data.kits) || !this.data.kits.length) {
      const k = this.blank('My brand'); this.data = { kits: [k], active: k.id }; this.save();
    }
  }
  blank(name) { return { id: rid(), name, colors: [], fonts: { heading: null, subheading: null, body: null }, logos: [], created: Date.now() }; }
  save() { fs.mkdirSync(this.dir, { recursive: true }); const t = this.file + '.saving'; fs.writeFileSync(t, JSON.stringify(this.data, null, 1)); fs.renameSync(t, this.file); }
  get() { return this.data; }
  kit(id) { const k = this.data.kits.find((x) => x.id === id); if (!k) throw new Error('That brand kit no longer exists.'); return k; }
  setActive(id) { this.kit(id); this.data.active = id; this.save(); return this.data; }
  create(name) { const k = this.blank(name || 'New brand'); this.data.kits.push(k); this.data.active = k.id; this.save(); return this.data; }
  update(id, patch) {
    const k = this.kit(id);
    for (const key of ['name', 'colors', 'fonts']) if (patch[key] !== undefined) k[key] = patch[key];
    this.save(); return this.data;
  }
  remove(id) {
    if (this.data.kits.length < 2) throw new Error('Keep at least one brand kit. Rename this one instead.');
    this.data.kits = this.data.kits.filter((k) => k.id !== id);
    fs.rmSync(path.join(this.logos, id), { recursive: true, force: true });
    if (this.data.active === id) this.data.active = this.data.kits[0].id;
    this.save(); return this.data;
  }
  addLogo(id, { name, bytes, ext }) {
    const k = this.kit(id); ext = String(ext || 'png').toLowerCase().replace('jpeg', 'jpg');
    if (!MIME[ext]) throw new Error(`Logos can be PNG, JPG, WebP, SVG or GIF (not .${ext}).`);
    const lid = rid(); const dir = path.join(this.logos, id); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${lid}.${ext}`), Buffer.from(bytes));
    k.logos.push({ id: lid, name: name || 'Logo', file: `${lid}.${ext}` }); this.save(); return this.data;
  }
  removeLogo(id, lid) {
    const k = this.kit(id); const l = k.logos.find((x) => x.id === lid);
    if (l) fs.rmSync(path.join(this.logos, id, l.file), { force: true });
    k.logos = k.logos.filter((x) => x.id !== lid); this.save(); return this.data;
  }
  logoData(id, lid) {
    const k = this.kit(id); const l = k.logos.find((x) => x.id === lid); if (!l) throw new Error('Logo not found.');
    const ext = path.extname(l.file).slice(1); const buf = fs.readFileSync(path.join(this.logos, id, l.file));
    return { name: l.name, dataUrl: `data:${MIME[ext]};base64,${buf.toString('base64')}`, svg: ext === 'svg' ? buf.toString('utf8') : null };
  }
  logoPath(rel) { return path.join(this.logos, rel); }
}
module.exports = { Brand };
