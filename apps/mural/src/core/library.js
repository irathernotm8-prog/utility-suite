// Mural — the wallpaper library. Built-ins ship inside the app (src/builtin/<slug>); yours live in ~/Documents/Mural,
// one folder per wallpaper with its mural.json. Ids are "builtin/<slug>" or "user/<slug>".
'use strict';
const fs = require('fs');
const path = require('path');
const { writeZip, readZip } = require('./zip');

const VIDEO = ['.mp4', '.webm', '.mov', '.m4v', '.mkv'];
const IMAGE = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp'];
const SHADER = ['.frag', '.glsl', '.fs'];

const slugify = (s) => String(s || 'wallpaper').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'wallpaper';
/** Recursive copy using only calls that also work inside Electron's app.asar (fs.cpSync doesn't). */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, e.name), b = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(a, b); else if (e.isFile()) fs.writeFileSync(b, fs.readFileSync(a));
  }
}
const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } };

class Library {
  /** schema: the runtime's schema module (normalizeManifest, traits) */
  constructor({ builtinDir, userDir, thumbDir, schema }) {
    this.builtinDir = builtinDir; this.userDir = userDir; this.thumbDir = thumbDir; this.schema = schema;
    fs.mkdirSync(userDir, { recursive: true }); fs.mkdirSync(thumbDir, { recursive: true });
    this.cache = null;
  }
  invalidate() { this.cache = null; }

  dirOf(id) {
    const m = /^(builtin|user)\/([a-z0-9-]+)$/.exec(String(id || '')); if (!m) return null;
    return path.join(m[1] === 'builtin' ? this.builtinDir : this.userDir, m[2]);
  }
  /** A file inside a wallpaper's folder, or null if the path tries to leave it. */
  fileOf(id, rel) {
    const dir = this.dirOf(id); if (!dir) return null;
    const p = path.resolve(dir, String(rel || '').replace(/^\/+/, ''));
    return p === dir || p.startsWith(dir + path.sep) ? p : null;
  }

  read(id) {
    const dir = this.dirOf(id); if (!dir) return null;
    const raw = readJSON(path.join(dir, 'mural.json')); if (!raw) return null;
    const manifest = this.schema.normalizeManifest(raw);
    const probe = { ...manifest };
    if (manifest.type === 'shader' && !manifest.code && manifest.shader) { const f = this.fileOf(id, manifest.shader); try { probe.code = fs.readFileSync(f, 'utf8'); } catch (_) {} }
    let mtime = 0; try { mtime = fs.statSync(path.join(dir, 'mural.json')).mtimeMs; } catch (_) {}
    return { id, dir, builtin: id.startsWith('builtin/'), manifest, traits: this.schema.traits(probe), mtime };
  }

  list() {
    if (this.cache) return this.cache;
    const out = [];
    for (const [kind, dir] of [['builtin', this.builtinDir], ['user', this.userDir]]) {
      let names = []; try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (_) {}
      for (const n of names) {
        if (!/^[a-z0-9-]+$/.test(n)) continue;
        const w = this.read(`${kind}/${n}`); if (!w) continue;
        out.push({ id: w.id, name: w.manifest.name, type: w.manifest.type, tags: w.manifest.tags, author: w.manifest.author || '', builtin: w.builtin, traits: w.traits, thumb: this.thumbUrl(w.id), mtime: w.mtime });
      }
    }
    out.sort((a, b) => (a.builtin === b.builtin ? (b.builtin ? 0 : b.mtime - a.mtime) : a.builtin ? 1 : -1));
    this.cache = out; return out;
  }

  // ------------------------------------------------------------------------------------------------- thumbnails
  thumbFile(id) { return path.join(this.thumbDir, String(id).replace(/\//g, '__') + '.jpg'); }
  thumbUrl(id) { const f = this.thumbFile(id); try { const st = fs.statSync(f); return `mural://thumb/${encodeURIComponent(path.basename(f))}?v=${Math.round(st.mtimeMs)}`; } catch (_) { return null; } }
  saveThumb(id, dataUrl) {
    const m = /^data:image\/(jpeg|png);base64,(.+)$/.exec(String(dataUrl || '')); if (!m || !this.dirOf(id)) return false;
    fs.writeFileSync(this.thumbFile(id), Buffer.from(m[2], 'base64')); this.invalidate(); return true;
  }

  // ------------------------------------------------------------------------------------------------- making & saving
  uniqueDir(name) {
    const base = slugify(name); let s = base, i = 2;
    while (fs.existsSync(path.join(this.userDir, s))) s = `${base}-${i++}`;
    const dir = path.join(this.userDir, s); fs.mkdirSync(dir, { recursive: true });
    return { slug: s, dir, id: `user/${s}` };
  }
  create(manifest) {
    const m = this.schema.normalizeManifest(manifest);
    const { dir, id } = this.uniqueDir(m.name);
    fs.writeFileSync(path.join(dir, 'mural.json'), JSON.stringify(m, null, 1));
    this.invalidate(); return id;
  }
  /** Save a manifest. Built-ins can't change, so saving one makes your own copy; returns the id that was written. */
  save(id, manifest, extraFiles = {}) {
    const m = this.schema.normalizeManifest(manifest);
    let target = id;
    if (!id || id.startsWith('builtin/')) target = this.duplicate(id, m.name, true);
    const dir = this.dirOf(target); if (!dir) throw new Error('Unknown wallpaper');
    for (const [rel, text] of Object.entries(extraFiles)) { const f = this.fileOf(target, rel); if (f) fs.writeFileSync(f, text); }
    fs.writeFileSync(path.join(dir, 'mural.json'), JSON.stringify(m, null, 1));
    this.invalidate(); return target;
  }
  duplicate(id, name, quiet = false) {
    const src = this.dirOf(id);
    const w = src && this.read(id);
    const { dir, id: nid } = this.uniqueDir(name || (w ? (quiet ? w.manifest.name : w.manifest.name + ' copy') : 'Untitled'));
    if (src && fs.existsSync(src)) copyDir(src, dir);
    if (w && !quiet) { const m = { ...w.manifest, name: w.manifest.name + ' copy', author: '' }; fs.writeFileSync(path.join(dir, 'mural.json'), JSON.stringify(m, null, 1)); }
    try { fs.copyFileSync(this.thumbFile(id), this.thumbFile(nid)); } catch (_) {}
    this.invalidate(); return nid;
  }
  /** Copy a picture/video into a wallpaper's folder; returns the name to use in the manifest. */
  addAsset(id, srcPath) {
    const dir = this.dirOf(id); if (!dir || id.startsWith('builtin/')) throw new Error('Save the wallpaper first');
    const ext = path.extname(srcPath).toLowerCase(); const base = slugify(path.basename(srcPath, ext)) || 'asset';
    let name = base + ext, i = 2; while (fs.existsSync(path.join(dir, name))) name = `${base}-${i++}${ext}`;
    fs.copyFileSync(srcPath, path.join(dir, name)); return name;
  }
  remove(id, trash) {
    if (!String(id).startsWith('user/')) throw new Error('Built-in wallpapers can’t be removed');
    const dir = this.dirOf(id); if (!dir) return false;
    try { fs.unlinkSync(this.thumbFile(id)); } catch (_) {}
    const done = trash ? trash(dir) : Promise.resolve(fs.rmSync(dir, { recursive: true, force: true }));
    this.invalidate(); return done;
  }

  // ------------------------------------------------------------------------------------------------- packages
  exportTo(id, dest) {
    const dir = this.dirOf(id); if (!dir) throw new Error('Unknown wallpaper');
    const entries = [];
    const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const p = path.join(d, e.name), r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) walk(p, r); else entries.push({ name: r, data: fs.readFileSync(p) }); } };
    walk(dir, '');
    try { entries.push({ name: '.thumb.jpg', data: fs.readFileSync(this.thumbFile(id)) }); } catch (_) {}
    fs.writeFileSync(dest, writeZip(entries)); return dest;
  }

  /** Bring files in: .mural packages, wallpaper folders, videos, pictures, web pages, shaders, Wallpaper Engine video/web projects. */
  importPaths(paths) {
    const done = [], skipped = [];
    for (const p of paths) {
      try { const id = this.importOne(p); if (id) done.push(id); else skipped.push({ path: p, why: 'Not something Mural can use' }); }
      catch (e) { skipped.push({ path: p, why: e.message }); }
    }
    this.invalidate(); return { imported: done, skipped };
  }
  importOne(p) {
    const st = fs.statSync(p); const ext = path.extname(p).toLowerCase(); const title = path.basename(p, ext).replace(/[_-]+/g, ' ').trim() || 'Imported';
    if (st.isDirectory()) {
      const mj = readJSON(path.join(p, 'mural.json'));
      if (mj) { const { dir, id } = this.uniqueDir(mj.name || title); copyDir(p, dir); return id; }
      const we = readJSON(path.join(p, 'project.json')); // Wallpaper Engine project (video and web kinds)
      if (we && we.file && /^(video|web)$/i.test(we.type || '')) {
        const { dir, id } = this.uniqueDir(we.title || title); copyDir(p, dir);
        const m = we.type.toLowerCase() === 'video' ? { type: 'video', src: we.file } : { type: 'web', page: we.file, interactive: { cursor: true, click: true } };
        fs.writeFileSync(path.join(dir, 'mural.json'), JSON.stringify(this.schema.normalizeManifest({ name: we.title || title, author: '', tags: ['imported'], ...m }), null, 1));
        return id;
      }
      if (fs.existsSync(path.join(p, 'index.html'))) { const { dir, id } = this.uniqueDir(title); copyDir(p, dir); this.writeManifest(dir, { name: title, type: 'web', page: 'index.html', interactive: { cursor: true, click: true } }); return id; }
      if (we && /^scene$/i.test(we.type || '')) throw new Error('Wallpaper Engine scene wallpapers use its own engine; video and web ones import fine');
      return null;
    }
    if (ext === '.mural' || ext === '.zip') {
      const entries = readZip(fs.readFileSync(p));
      const root = entries.find((e) => e.name === 'mural.json') ? '' : (entries.find((e) => /^[^/]+\/mural\.json$/.test(e.name)) || {}).name?.split('/')[0] + '/';
      const mf = entries.find((e) => e.name === root + 'mural.json'); if (!mf) throw new Error('No mural.json inside');
      const m = JSON.parse(mf.data.toString('utf8'));
      const { dir, id } = this.uniqueDir(m.name || title);
      for (const e of entries) {
        if (root && !e.name.startsWith(root)) continue; const rel = e.name.slice(root.length);
        if (rel === '.thumb.jpg') { fs.writeFileSync(this.thumbFile(id), e.data); continue; }
        const out = path.join(dir, rel); if (!out.startsWith(dir + path.sep)) continue;
        fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, e.data);
      }
      return id;
    }
    if (VIDEO.includes(ext) || IMAGE.includes(ext)) {
      const { dir, id } = this.uniqueDir(title); const name = 'media' + ext; fs.copyFileSync(p, path.join(dir, name));
      this.writeManifest(dir, { name: title, type: VIDEO.includes(ext) ? 'video' : 'image', src: name, fit: 'cover', scene: { layers: [] } });
      return id;
    }
    if (ext === '.html' || ext === '.htm') { const { dir, id } = this.uniqueDir(title); fs.copyFileSync(p, path.join(dir, 'index.html')); this.writeManifest(dir, { name: title, type: 'web', page: 'index.html', interactive: { cursor: true, click: true } }); return id; }
    if (SHADER.includes(ext)) { const { dir, id } = this.uniqueDir(title); fs.copyFileSync(p, path.join(dir, 'main.frag')); this.writeManifest(dir, { name: title, type: 'shader', shader: 'main.frag', quality: { fps: 30, scale: 0.5 } }); return id; }
    return null;
  }
  writeManifest(dir, m) { fs.writeFileSync(path.join(dir, 'mural.json'), JSON.stringify(this.schema.normalizeManifest({ author: '', ...m }), null, 1)); }
}

module.exports = { Library, slugify, VIDEO, IMAGE, SHADER };
