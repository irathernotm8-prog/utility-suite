'use strict';
// Waypoint — where trips live. Every trip is a plain folder in the data folder (default
// ~/Documents/Waypoint): trip.json plus a Documents folder with copies of the files you add. Nothing
// is online, so every plan, booking and document is there with no connection. Writes are atomic
// (temp file + rename) and the previous trip.json is kept as trip.json.bak.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const newId = (n = 8) => crypto.randomBytes(n).toString('base64url').replace(/[-_]/g, 'x').slice(0, n + 2);
const slug = (s) => String(s || 'Trip').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'Trip';
// a name that's safe on Mac and Windows
function safeName(n) {
  let s = String(n || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)) s = '_' + s;
  return s.slice(0, 150) || 'file';
}
function uniquePath(dir, name) {
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  let p = path.join(dir, name), i = 2;
  while (fs.existsSync(p)) p = path.join(dir, `${base} ${i++}${ext}`);
  return p;
}
function kindOf(name) {
  const e = path.extname(String(name)).slice(1).toLowerCase();
  if (/^(jpe?g|png|gif|webp|heic|heif|bmp|svg)$/.test(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  if (/^(txt|md|rtf|docx?|pages|odt)$/.test(e)) return 'text';
  if (/^(xlsx?|csv|numbers)$/.test(e)) return 'sheet';
  if (/^(pkpass)$/.test(e)) return 'pass';
  if (/^(mp4|mov|m4v)$/.test(e)) return 'video';
  return 'file';
}
// guess what a document is from its name (you can change it)
function guessTag(name) {
  const n = String(name).toLowerCase();
  if (/passport/.test(n)) return 'passport';
  if (/visa|esta|eta\b|etias|evisa/.test(n)) return 'visa';
  if (/insur/.test(n)) return 'insurance';
  if (/boarding|ticket|e-?ticket|pass\b|pkpass|itinerary|flight/.test(n)) return 'ticket';
  if (/booking|reservation|confirm|hotel|airbnb|receipt|invoice/.test(n)) return 'booking';
  if (/licen[cs]e|permit|idp/.test(n)) return 'license';
  if (/vaccin|health|covid|prescription/.test(n)) return 'health';
  if (/map/.test(n)) return 'map';
  return 'other';
}

function blankTrip(f = {}) {
  return {
    v: 1, id: newId(), name: f.name || 'New trip', destination: f.destination || '', country: f.country || '', tz: f.tz || '',
    start: f.start || '', end: f.end || '', cover: f.cover || 'sunset', currency: f.currency || 'USD', localCurrency: f.localCurrency || '',
    travelers: f.travelers || [], abroad: f.abroad !== false,
    items: [], bookings: [], docs: [], expenses: [], rates: {},
    budget: { total: 0, categories: {} },
    research: { notes: '', places: [], links: [], packing: [], facts: {} },
    created: Date.now(), updated: Date.now(),
  };
}

// fill in anything an older or hand-edited trip.json is missing, and drop junk
function normalize(t) {
  const b = blankTrip();
  const out = { ...b, ...t };
  for (const k of ['items', 'bookings', 'docs', 'expenses', 'travelers']) if (!Array.isArray(out[k])) out[k] = [];
  if (!out.rates || typeof out.rates !== 'object') out.rates = {};
  out.budget = { total: 0, categories: {}, ...(out.budget || {}) };
  out.research = { ...b.research, ...(out.research || {}) };
  for (const k of ['places', 'links', 'packing']) if (!Array.isArray(out.research[k])) out.research[k] = [];
  if (!out.research.facts || typeof out.research.facts !== 'object') out.research.facts = {};
  out.items = out.items.filter(i => i && i.id);
  out.bookings = out.bookings.filter(i => i && i.id).map(x => ({ docs: [], ...x }));
  out.docs = out.docs.filter(d => d && d.id && d.file);
  return out;
}

class Store {
  constructor(dir) { this.setDir(dir); this.index = new Map(); }
  setDir(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); this.index = new Map(); }

  // trip folders are found by their trip.json, so you can rename or move folders inside the data folder
  scan() {
    this.index = new Map();
    let names = [];
    try { names = fs.readdirSync(this.dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch {}
    for (const n of names) {
      const f = path.join(this.dir, n, 'trip.json');
      let t = null;
      try { t = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {
        try { t = JSON.parse(fs.readFileSync(f + '.bak', 'utf8')); } catch {}
      }
      if (t && t.id && !this.index.has(t.id)) this.index.set(t.id, { folder: path.join(this.dir, n), trip: normalize(t) });
    }
    return this.list();
  }
  list() {
    return [...this.index.values()].map(({ trip: t, folder }) => ({
      id: t.id, name: t.name, destination: t.destination, country: t.country, start: t.start, end: t.end, cover: t.cover, tz: t.tz,
      counts: { items: t.items.length, bookings: t.bookings.length, docs: t.docs.length, places: t.research.places.length }, travelers: t.travelers, updated: t.updated, folder,
    })).sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999') || a.name.localeCompare(b.name));
  }
  has(id) { return this.index.has(id); }
  get(id) { const e = this.index.get(id); if (!e) throw new Error('That trip isn’t here any more.'); return e.trip; }
  folder(id) { const e = this.index.get(id); if (!e) throw new Error('That trip isn’t here any more.'); return e.folder; }
  docsDir(id) { return path.join(this.folder(id), 'Documents'); }
  docPath(id, doc) {
    const base = path.resolve(this.folder(id));
    const p = path.resolve(base, doc.file);
    if (!p.startsWith(base + path.sep)) throw new Error('Bad document path');
    return p;
  }

  create(fields) {
    const t = normalize(blankTrip(fields));
    const folder = uniquePath(this.dir, `${slug(t.name)}`);
    fs.mkdirSync(path.join(folder, 'Documents'), { recursive: true });
    this.index.set(t.id, { folder, trip: t });
    this.write(t.id);
    return t;
  }
  // take a whole trip from the window; documents are managed here, so the window can't invent files
  save(trip) {
    const e = this.index.get(trip.id); if (!e) throw new Error('That trip isn’t here any more.');
    const t = normalize(trip);
    const known = new Map(e.trip.docs.map(d => [d.id, d]));
    t.docs = t.docs.filter(d => known.has(d.id)).map(d => ({ ...d, file: known.get(d.id).file, size: known.get(d.id).size }));
    t.updated = Date.now();
    e.trip = t;
    this.write(t.id);
    return t;
  }
  write(id) {
    const e = this.index.get(id);
    const f = path.join(e.folder, 'trip.json');
    fs.mkdirSync(e.folder, { recursive: true });
    const tmp = f + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(e.trip, null, 1));
    try { if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak'); } catch {}
    fs.renameSync(tmp, f);
  }
  forget(id) { this.index.delete(id); }

  async addDocs(id, paths, meta = {}) {
    const trip = this.get(id);
    const dir = this.docsDir(id);
    await fsp.mkdir(dir, { recursive: true });
    const added = [];
    for (const src of paths) {
      let st; try { st = await fsp.stat(src); } catch { continue; }
      if (!st.isFile()) continue;
      const dest = uniquePath(dir, safeName(path.basename(src)));
      await fsp.copyFile(src, dest);
      try { await fsp.utimes(dest, st.atime, st.mtime); } catch {}
      const name = path.basename(src);
      const d = { id: newId(), name: meta.name && paths.length === 1 ? meta.name : name.replace(/\.[^.]+$/, ''), file: path.relative(this.folder(id), dest).split(path.sep).join('/'),
        size: st.size, kind: kindOf(name), ext: path.extname(name).slice(1).toLowerCase(), tag: meta.tag || guessTag(name), bookingId: meta.bookingId || '', who: meta.who || '', added: Date.now(), notes: '' };
      trip.docs.push(d); added.push(d);
      if (d.bookingId) { const b = trip.bookings.find(x => x.id === d.bookingId); if (b && !b.docs.includes(d.id)) b.docs.push(d.id); }
    }
    trip.updated = Date.now();
    this.write(id);
    return { trip, added };
  }
  // a document from bytes (pasted image, imported bundle)
  async addDocBytes(id, name, buf, meta = {}) {
    const trip = this.get(id);
    const dir = this.docsDir(id);
    await fsp.mkdir(dir, { recursive: true });
    const dest = uniquePath(dir, safeName(name));
    await fsp.writeFile(dest, buf);
    const d = { id: meta.id || newId(), name: meta.name || name.replace(/\.[^.]+$/, ''), file: path.relative(this.folder(id), dest).split(path.sep).join('/'),
      size: buf.length, kind: kindOf(name), ext: path.extname(name).slice(1).toLowerCase(), tag: meta.tag || guessTag(name), bookingId: meta.bookingId || '', who: meta.who || '', added: meta.added || Date.now(), notes: meta.notes || '' };
    trip.docs.push(d);
    this.write(id);
    return d;
  }
  async removeDoc(id, docId) {
    const trip = this.get(id);
    const d = trip.docs.find(x => x.id === docId); if (!d) return { trip, file: null };
    trip.docs = trip.docs.filter(x => x.id !== docId);
    for (const b of trip.bookings) b.docs = (b.docs || []).filter(x => x !== docId);
    this.write(id);
    return { trip, file: this.docPath(id, d) };
  }
}

module.exports = { Store, normalize, blankTrip, newId, slug, safeName, uniquePath, kindOf, guessTag };
