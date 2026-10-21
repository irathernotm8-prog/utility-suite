// Trace — project storage. Plain Node (no Electron) so it can be tested on its own.
//
// <library>/projects/<projectId>/project.json   charts, notes, guides, capture order and groups
// <library>/projects/<projectId>/media/<id>.png  screenshots and images (originals, never edited)
// <library>/projects/<projectId>/media/<id>.json sidecar: name, size, annotations, crop
//
// The window owns project.json while a project is open. The main process only ever writes media files and
// sidecars, so a screenshot arriving mid-edit can never overwrite the window's unsaved changes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ID = /^[a-z0-9]{6,32}$/;
const FILE = /^[a-z0-9]{6,32}\.(png|jpg|jpeg|webp|gif)$/;
const uid = (n = 12) => {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.randomBytes(n), (b) => abc[b % 36]).join('');
};

function writeAtomic(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } };

// Image size straight from the file header (PNG, JPEG, GIF, WebP) so imports don't need Electron.
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), ext: 'png' };
  if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8), ext: 'gif' };
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), ext: 'webp' };
    if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, ext: 'webp' };
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1, ext: 'webp' }; }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), ext: 'jpg' };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return { w: 0, h: 0, ext: 'jpg' };
  }
  return null;
}

class Store {
  constructor(root) {
    this.root = root;
    this.dir = path.join(root, 'projects');
    fs.mkdirSync(this.dir, { recursive: true });
  }
  projectDir(id) {
    if (!ID.test(String(id))) throw new Error('Unknown project.');
    return path.join(this.dir, id);
  }
  mediaDir(id) { return path.join(this.projectDir(id), 'media'); }

  list() {
    const out = [];
    for (const id of fs.readdirSync(this.dir)) {
      if (!ID.test(id)) continue;
      const p = readJSON(path.join(this.dir, id, 'project.json'), null);
      if (!p) continue;
      let media = 0;
      try { media = fs.readdirSync(path.join(this.dir, id, 'media')).filter((f) => f.endsWith('.json')).length; } catch (_) {}
      const items = p.items || [];
      out.push({ id, name: p.name, color: p.color, icon: p.icon, created: p.created, updated: p.updated,
        counts: { chart: items.filter((i) => i.type === 'chart').length, note: items.filter((i) => i.type === 'note').length, guide: items.filter((i) => i.type === 'guide').length, media } });
    }
    return out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  }

  create({ name, color, icon, items } = {}) {
    const id = uid();
    const now = new Date().toISOString();
    const project = { id, name: String(name || 'Untitled project').slice(0, 120), color: color || 'violet', icon: icon || '', created: now, updated: now, items: items || [], captureGroups: [], captureOrder: [] };
    fs.mkdirSync(path.join(this.projectDir(id), 'media'), { recursive: true });
    writeAtomic(path.join(this.projectDir(id), 'project.json'), JSON.stringify(project, null, 1));
    return project;
  }

  load(id) {
    const project = readJSON(path.join(this.projectDir(id), 'project.json'), null);
    if (!project) throw new Error('That project could not be opened.');
    project.items = project.items || [];
    project.captureGroups = project.captureGroups || [];
    project.captureOrder = project.captureOrder || [];
    return { project, media: this.listMedia(id) };
  }

  save(project) {
    if (!project || !ID.test(String(project.id))) throw new Error('Bad project.');
    const dir = this.projectDir(project.id);
    if (!fs.existsSync(dir)) throw new Error('That project no longer exists.');
    project.updated = new Date().toISOString();
    writeAtomic(path.join(dir, 'project.json'), JSON.stringify(project, null, 1));
    return project.updated;
  }

  // ---- media ----
  addMedia(pid, buf, meta = {}) {
    const size = imageSize(buf);
    if (!size) throw new Error('That file is not a PNG, JPEG, GIF or WebP image.');
    const id = uid();
    const file = id + '.' + size.ext;
    const dir = this.mediaDir(pid);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), buf);
    const m = { id, file, w: meta.w || size.w, h: meta.h || size.h, created: new Date().toISOString(), source: meta.source || 'import', name: String(meta.name || '').slice(0, 200), annotations: [], crop: null, scale: meta.scale || 1 };
    writeAtomic(path.join(dir, id + '.json'), JSON.stringify(m));
    return m;
  }
  listMedia(pid) {
    let files = [];
    try { files = fs.readdirSync(this.mediaDir(pid)); } catch (_) { return []; }
    return files.filter((f) => f.endsWith('.json')).map((f) => readJSON(path.join(this.mediaDir(pid), f), null)).filter((m) => m && m.id && FILE.test(m.file))
      .sort((a, b) => String(a.created).localeCompare(String(b.created)));
  }
  getMedia(pid, mid) {
    if (!ID.test(String(mid))) throw new Error('Unknown image.');
    const m = readJSON(path.join(this.mediaDir(pid), mid + '.json'), null);
    if (!m) throw new Error('That image is missing.');
    return m;
  }
  updateMedia(pid, mid, patch = {}) {
    const m = this.getMedia(pid, mid);
    if ('name' in patch) m.name = String(patch.name || '').slice(0, 200);
    if ('annotations' in patch && Array.isArray(patch.annotations)) m.annotations = patch.annotations.slice(0, 500);
    if ('crop' in patch) m.crop = patch.crop && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(patch.crop[k])) ? { x: patch.crop.x, y: patch.crop.y, w: patch.crop.w, h: patch.crop.h } : null;
    writeAtomic(path.join(this.mediaDir(pid), mid + '.json'), JSON.stringify(m));
    return m;
  }
  // Returns the files to remove; the caller moves them to the Trash.
  mediaFiles(pid, mid) {
    const m = this.getMedia(pid, mid);
    return [path.join(this.mediaDir(pid), m.file), path.join(this.mediaDir(pid), mid + '.json')];
  }
  mediaFile(pid, file) {
    if (!FILE.test(String(file))) throw new Error('Unknown image.');
    return path.join(this.mediaDir(pid), file);
  }
}

module.exports = { Store, uid, imageSize, ID };
