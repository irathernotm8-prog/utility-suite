// Crate — the MP3 library: files on disk (Artist/Album/NN Title.mp3) plus an index in <library>/.crate
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const tags = require('./tags');
const audio = require('./audio');
const meta = require('./metadata');

const TAG_FIELDS = ['title', 'artist', 'album', 'albumArtist', 'year', 'genre', 'track', 'trackTotal', 'disc', 'discTotal', 'composer', 'bpm', 'comment', 'lyrics'];
const OTHER_FIELDS = ['loved', 'rating', 'plays', 'lastPlayed'];
const NUM_FIELDS = new Set(['track', 'trackTotal', 'disc', 'discTotal', 'bpm', 'rating', 'plays']);

let root = null;
let db = null;
let saveTimer = null;
let trashFn = async (p) => fs.rmSync(p, { force: true });
let changeFn = () => {};

const newId = () => crypto.randomBytes(6).toString('hex');
const crateDir = () => path.join(root, '.crate');
const artDir = () => path.join(crateDir(), 'art');
const origDir = () => path.join(crateDir(), 'originals');
const tmpDir = () => path.join(crateDir(), 'tmp');
const abs = (rel) => path.join(root, ...String(rel).split('/'));
const relOf = (p) => path.relative(root, p).split(path.sep).join('/');
const artPath = (id) => path.join(artDir(), id + '.jpg');

function configure({ trash, onChange } = {}) { if (trash) trashFn = trash; if (onChange) changeFn = onChange; }

function open(dir) {
  flush();
  root = dir;
  for (const d of [root, crateDir(), artDir(), origDir(), tmpDir()]) fs.mkdirSync(d, { recursive: true });
  try { db = JSON.parse(fs.readFileSync(path.join(crateDir(), 'library.json'), 'utf8')); } catch { db = null; }
  if (!db || typeof db !== 'object') db = { version: 1, tracks: {}, playlists: [], exports: {} };
  db.tracks = db.tracks || {}; db.playlists = db.playlists || []; db.exports = db.exports || {};
  // leftover temp files from a crash
  try { for (const f of fs.readdirSync(tmpDir())) fs.rmSync(path.join(tmpDir(), f), { recursive: true, force: true }); } catch {}
  writeReadme();
  return root;
}

function writeReadme() {
  const f = path.join(crateDir(), 'READ ME.txt');
  if (fs.existsSync(f)) return;
  fs.writeFileSync(f, 'Crate keeps its library index, artwork cache and the untouched originals of edited songs here.\nDeleting this folder resets Crate\'s extras (originals, play counts, playlists), but your MP3s and their tags stay as they are.\n');
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
  changeFn();
}
function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!root || !db) return;
  const f = path.join(crateDir(), 'library.json');
  const tmp = f + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, f); }
  catch (e) { console.error('Crate: could not save the library index:', e.message); }
}

function getRoot() { return root; }
function tmp(name) { const p = path.join(tmpDir(), `${Date.now()}-${newId()}-${name}`); return p; }

/* ---------------- file naming ---------------- */

function sanitize(s, max = 100) {
  let v = String(s || '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, (c) => (c === ':' ? ' -' : c === '"' ? "'" : c === '/' || c === '\\' ? '-' : '_'))
    .replace(/\s+/g, ' ').trim()
    .replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(v)) v = '_' + v;
  if (v.length > max) v = v.slice(0, max).trim();
  return v;
}

const pad = (n) => String(n).padStart(2, '0');

function renderPattern(pattern, t) {
  const albumArtist = t.albumArtist || meta.primaryArtist(t.artist) || 'Unknown Artist';
  const trackStr = t.track ? (t.discTotal > 1 && t.disc ? `${t.disc}-${pad(t.track)}` : pad(t.track)) : '';
  const values = {
    artist: t.artist || 'Unknown Artist', albumartist: albumArtist, album: t.album || 'Singles',
    title: t.title || 'Untitled', track: trackStr, disc: t.disc ? String(t.disc) : '', year: t.year || '', genre: t.genre || ''
  };
  const segs = String(pattern || '{albumartist}/{album}/{track} {title}').split('/').map((seg) =>
    sanitize(seg.replace(/\{(\w+)\}/g, (_, k) => values[k.toLowerCase()] ?? '').replace(/\s+/g, ' ').replace(/^[\s\-–_.]+/, ''))
  ).filter(Boolean);
  if (!segs.length) segs.push(sanitize(values.title));
  return segs.join('/') + '.mp3';
}

function uniqueRel(rel, selfId) {
  const taken = (r) => {
    const lower = r.toLowerCase();
    for (const t of Object.values(db.tracks)) if (t.id !== selfId && t.file.toLowerCase() === lower) return true;
    const p = abs(r);
    if (!fs.existsSync(p)) return false;
    const mine = selfId && db.tracks[selfId] && db.tracks[selfId].file.toLowerCase() === lower;
    return !mine;
  };
  if (!taken(rel)) return rel;
  const base = rel.replace(/\.mp3$/i, '');
  for (let i = 2; i < 1000; i++) { const r = `${base} (${i}).mp3`; if (!taken(r)) return r; }
  return `${base} ${newId()}.mp3`;
}

function moveFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try { fs.renameSync(from, to); }
  catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(from, to); fs.rmSync(from, { force: true }); }
}

function pruneEmpty(dir) {
  // remove folders left empty by a move, up to the library root
  let d = dir;
  while (d && d.startsWith(root) && path.resolve(d) !== path.resolve(root)) {
    let items;
    try { items = fs.readdirSync(d); } catch { return; }
    const junk = items.filter((n) => n === '.DS_Store' || n === 'Thumbs.db' || n === 'desktop.ini');
    if (items.length !== junk.length) return;
    try { for (const j of junk) fs.rmSync(path.join(d, j), { force: true }); fs.rmdirSync(d); } catch { return; }
    d = path.dirname(d);
  }
}

function placeTrack(t, settings) {
  const current = abs(t.file);
  const target = settings.organize ? renderPattern(settings.pattern, t) : t.file;
  if (target === t.file) return false;
  const rel = uniqueRel(target, t.id);
  if (rel === t.file) return false;
  const dest = abs(rel);
  if (current.toLowerCase() === dest.toLowerCase() && current !== dest) {
    // case-only rename on a case-insensitive disk: go through a temp name
    const mid = dest + '.crate-rename';
    fs.renameSync(current, mid); fs.renameSync(mid, dest);
  } else {
    moveFile(current, dest);
  }
  t.file = rel;
  pruneEmpty(path.dirname(current));
  return true;
}

/* ---------------- artwork ---------------- */

function artBuffer(id) { try { return fs.readFileSync(artPath(id)); } catch { return null; } }

function getFetch() {
  if (process.versions.electron) { const { net } = require('electron'); if (net && net.fetch) return net.fetch.bind(net); }
  return fetch;
}

/** Turn an art source into a square 1000px JPEG buffer. src: { path } | { url } | { buffer } | { trackId } */
async function prepareArt(src) {
  if (!src) return null;
  let input = null; let cleanup = null;
  if (src.trackId) return artBuffer(src.trackId);
  if (src.path) input = src.path;
  else if (src.buffer || src.url) {
    let buf = src.buffer ? Buffer.from(src.buffer) : null;
    if (src.url) {
      const res = await getFetch()(src.url);
      if (!res.ok) throw new Error(`Could not download that image (${res.status})`);
      buf = Buffer.from(await res.arrayBuffer());
    }
    input = tmp('art-in'); fs.writeFileSync(input, buf); cleanup = input;
  }
  if (!input) return null;
  const out = tmp('art.jpg');
  try {
    await audio.squareArt(input, out);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(out, { force: true });
    if (cleanup) fs.rmSync(cleanup, { force: true });
  }
}

function setArt(t, buf) {
  if (buf) { fs.writeFileSync(artPath(t.id), buf); t.hasArt = true; }
  else { fs.rmSync(artPath(t.id), { force: true }); t.hasArt = false; }
  t.artV = (t.artV || 0) + 1;
}

/* ---------------- tracks ---------------- */

function clean(field, v) {
  if (NUM_FIELDS.has(field)) { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; }
  if (field === 'loved') return !!v;
  if (field === 'lastPlayed') return Number(v) || 0;
  if (field === 'year') return String(v || '').replace(/[^\d]/g, '').slice(0, 4);
  return String(v ?? '').replace(/\s+$/g, '').replace(/^\s+/g, '');
}

function publicTrack(t) { return { ...t }; }
function all() { return Object.values(db ? db.tracks : {}).map(publicTrack); }
function get(id) { return db.tracks[id] ? publicTrack(db.tracks[id]) : null; }
function filePath(id) { const t = db.tracks[id]; return t ? abs(t.file) : null; }
function findBySource(videoId, url) {
  return Object.values(db.tracks).find((t) => t.source && ((videoId && t.source.videoId === videoId) || (url && t.source.url === url))) || null;
}

function writeTags(t) { tags.write(abs(t.file), t, t.hasArt ? artBuffer(t.id) : null); }

/**
 * Add a finished MP3 to the library. The file at `file` is moved in.
 * info: tag fields + { source, edit }   art: Buffer | null
 */
async function addTrack(file, info, art, settings) {
  const id = newId();
  const t = { id, file: '', addedAt: Date.now(), modifiedAt: Date.now(), hasArt: false, artV: 0, plays: 0, loved: false, rating: 0 };
  for (const f of TAG_FIELDS) t[f] = clean(f, info[f]);
  if (!t.title) t.title = path.basename(file).replace(/\.\w+$/, '');
  t.source = info.source || null;
  const p = await audio.probe(file);
  t.duration = +p.duration.toFixed(2); t.bitrate = p.bitrate; t.size = p.size;
  if (art) setArt(t, art);
  // temp spot inside the library, then into place
  const rel = uniqueRel(settings.organize ? renderPattern(settings.pattern, t) : sanitize(`${t.artist || 'Unknown Artist'} - ${t.title}`) + '.mp3', id);
  moveFile(file, abs(rel));
  t.file = rel;
  db.tracks[id] = t;
  writeTags(t);
  t.size = fs.statSync(abs(rel)).size;
  save();
  return publicTrack(t);
}

/** Update tag fields (and optionally artwork) on several tracks. patch only holds the fields that change. */
async function update(ids, patch = {}, settings, { art } = {}) {
  let artBuf; let artSet = false;
  if (art) {
    if (art.remove) { artBuf = null; artSet = true; }
    else { artBuf = await prepareArt(art); artSet = true; }
  }
  const changed = [];
  for (const id of ids) {
    const t = db.tracks[id];
    if (!t) continue;
    let tagChange = false;
    for (const [k, v] of Object.entries(patch)) {
      if (TAG_FIELDS.includes(k)) { const c = clean(k, v); if (t[k] !== c) { t[k] = c; tagChange = true; } }
      else if (OTHER_FIELDS.includes(k)) t[k] = clean(k, v);
    }
    if (artSet) { setArt(t, artBuf); tagChange = true; }
    if (tagChange) {
      writeTags(t);
      placeTrack(t, settings);
      t.modifiedAt = Date.now();
      try { t.size = fs.statSync(abs(t.file)).size; } catch {}
    }
    changed.push(publicTrack(t));
  }
  save();
  return changed;
}

/** Number an album's tracks in the given order (1..n of n). */
async function reorder(ids, settings) {
  const out = [];
  for (let i = 0; i < ids.length; i++) out.push(...(await update([ids[i]], { track: i + 1, trackTotal: ids.length }, settings)));
  return out;
}

async function remove(ids, { deleteFiles = true } = {}) {
  for (const id of ids) {
    const t = db.tracks[id];
    if (!t) continue;
    const p = abs(t.file);
    if (deleteFiles && fs.existsSync(p)) { await trashFn(p); pruneEmpty(path.dirname(p)); }
    fs.rmSync(artPath(id), { force: true });
    if (t.original) fs.rmSync(abs(t.original), { force: true });
    delete db.tracks[id];
    for (const pl of db.playlists) pl.trackIds = pl.trackIds.filter((x) => x !== id);
  }
  save();
}

/* ---------------- audio edits (non-destructive: the first edit keeps the original) ---------------- */

async function applyEdit(id, ops, { onProgress } = {}) {
  const t = db.tracks[id];
  if (!t) throw new Error('That song is no longer in the library.');
  if (!t.original) {
    const o = path.join(origDir(), id + '.mp3');
    fs.copyFileSync(abs(t.file), o);
    t.original = relOf(o);
  }
  const src = abs(t.original);
  const p = await audio.probe(src);
  const quality = p.bitrate >= 300 ? '320' : p.bitrate >= 240 ? '256' : p.bitrate >= 180 ? '192' : 'v0';
  const out = tmp('edit.mp3');
  await audio.toMp3(src, out, { ...ops, quality, duration: p.duration, onProgress });
  moveFile(out, abs(t.file));
  t.edit = { start: +ops.start || 0, end: +ops.end || 0, fadeIn: +ops.fadeIn || 0, fadeOut: +ops.fadeOut || 0, gainDb: +ops.gainDb || 0, normalize: !!ops.normalize };
  const np = await audio.probe(abs(t.file));
  t.duration = +np.duration.toFixed(2); t.bitrate = np.bitrate;
  writeTags(t);
  t.size = fs.statSync(abs(t.file)).size;
  t.modifiedAt = Date.now();
  save();
  return publicTrack(t);
}

async function revertEdit(id) {
  const t = db.tracks[id];
  if (!t || !t.original) return t ? publicTrack(t) : null;
  const o = abs(t.original);
  if (fs.existsSync(o)) {
    fs.copyFileSync(o, abs(t.file));
    fs.rmSync(o, { force: true });
  }
  t.original = null; t.edit = null;
  const np = await audio.probe(abs(t.file));
  t.duration = +np.duration.toFixed(2); t.bitrate = np.bitrate;
  writeTags(t);
  t.size = fs.statSync(abs(t.file)).size;
  t.modifiedAt = Date.now();
  save();
  return publicTrack(t);
}

/** Path the editor should draw/play: the original when the song has been edited (edits are re-applied from it). */
function sourceFor(id) { const t = db.tracks[id]; if (!t) return null; return t.original && fs.existsSync(abs(t.original)) ? abs(t.original) : abs(t.file); }

/* ---------------- importing files from disk ---------------- */

const AUDIO_EXT = /\.(mp3|m4a|aac|flac|wav|aiff?|ogg|opus|webm|wma|alac|mp4|mov|mkv)$/i;

async function extractArt(file) {
  const out = tmp('cover.jpg');
  const tools = require('./tools');
  const r = await tools.run(tools.ffmpeg(), ['-hide_banner', '-nostdin', '-y', '-i', file, '-an', '-frames:v', '1', out]);
  if (r.code !== 0 || !fs.existsSync(out)) return null;
  try { return await prepareArt({ path: out }); } catch { return null; } finally { fs.rmSync(out, { force: true }); }
}

async function ffTags(file) {
  const lower = await audio.readTags(file);
  const [track, trackTotal] = String(lower.track || '').split('/');
  const [disc, discTotal] = String(lower.disc || '').split('/');
  return { title: lower.title, artist: lower.artist, album: lower.album, albumArtist: lower.album_artist, year: String(lower.date || lower.year || '').slice(0, 4), genre: lower.genre, track, trackTotal: trackTotal || lower.tracktotal, disc, discTotal, composer: lower.composer, comment: lower.comment, lyrics: lower.lyrics };
}

async function importFiles(files, settings, { onProgress, signal } = {}) {
  const list = [];
  const walk = (p) => {
    let st; try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) { for (const n of fs.readdirSync(p)) if (!n.startsWith('.')) walk(path.join(p, n)); }
    else if (AUDIO_EXT.test(p)) list.push(p);
  };
  for (const f of files) walk(f);
  const added = []; const failed = [];
  for (let i = 0; i < list.length; i++) {
    if (signal && signal.aborted) break;
    const f = list[i];
    onProgress && onProgress({ index: i, total: list.length, name: path.basename(f) });
    try {
      const work = tmp('import.mp3');
      let info; let art;
      if (/\.mp3$/i.test(f)) {
        fs.copyFileSync(f, work);
        const r = tags.read(work);
        info = r;
        art = r.image ? await prepareArt({ buffer: r.image.buffer }).catch(() => null) : null;
      } else {
        info = await ffTags(f);
        art = await extractArt(f);
        await audio.toMp3(f, work, { quality: settings.quality, signal });
      }
      if (!info.title) {
        const c = meta.cleanTitle(path.basename(f).replace(/\.\w+$/, ''));
        info.title = c.title; info.artist = info.artist || c.artist;
      }
      info.source = { kind: 'file', name: path.basename(f) };
      added.push(await addTrack(work, info, art, settings));
    } catch (e) { failed.push({ file: path.basename(f), error: e.message }); }
  }
  onProgress && onProgress({ index: list.length, total: list.length, done: true });
  return { added, failed };
}

/* ---------------- rescanning the folder (files added or removed outside Crate) ---------------- */

async function scan(settings, { onProgress } = {}) {
  const found = [];
  const walk = (d) => {
    let items; try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (it.name.startsWith('.')) continue;
      const p = path.join(d, it.name);
      if (it.isDirectory()) walk(p);
      else if (/\.mp3$/i.test(it.name)) found.push(relOf(p));
    }
  };
  walk(root);
  const known = new Map(Object.values(db.tracks).map((t) => [t.file, t]));
  let removed = 0; let added = 0;
  for (const t of Object.values(db.tracks)) {
    if (!fs.existsSync(abs(t.file))) { fs.rmSync(artPath(t.id), { force: true }); delete db.tracks[t.id]; removed++; }
  }
  const fresh = found.filter((r) => !known.has(r));
  for (let i = 0; i < fresh.length; i++) {
    const rel = fresh[i];
    onProgress && onProgress({ index: i, total: fresh.length, name: path.basename(rel) });
    try {
      const r = tags.read(abs(rel));
      const p = await audio.probe(abs(rel));
      const id = newId();
      const t = { id, file: rel, addedAt: Date.now(), modifiedAt: Date.now(), hasArt: false, artV: 0, plays: 0, loved: false, rating: 0, source: { kind: 'folder' } };
      for (const f of TAG_FIELDS) t[f] = clean(f, r[f]);
      if (!t.title) { const c = meta.cleanTitle(path.basename(rel).replace(/\.mp3$/i, '')); t.title = c.title; if (!t.artist) t.artist = c.artist; }
      t.duration = +p.duration.toFixed(2); t.bitrate = p.bitrate; t.size = p.size;
      if (r.image) { const buf = await prepareArt({ buffer: r.image.buffer }).catch(() => null); if (buf) setArt(t, buf); }
      db.tracks[id] = t; added++;
    } catch {}
  }
  for (const pl of db.playlists) pl.trackIds = pl.trackIds.filter((x) => db.tracks[x]);
  save();
  return { added, removed, total: Object.keys(db.tracks).length };
}

/** Rename/move every file to match the naming pattern. */
async function organizeAll(settings) {
  let moved = 0;
  for (const t of Object.values(db.tracks)) { try { if (placeTrack(t, { ...settings, organize: true })) moved++; } catch {} }
  save();
  return { moved };
}

/* ---------------- albums & artists ---------------- */

const akey = (t) => `${(t.albumArtist || meta.primaryArtist(t.artist) || '').toLowerCase()}\u0000${(t.album || '').toLowerCase()}`;

function albums() {
  const map = new Map();
  for (const t of Object.values(db.tracks)) {
    if (!t.album) continue;
    const k = akey(t);
    let a = map.get(k);
    if (!a) { a = { key: k, album: t.album, albumArtist: t.albumArtist || meta.primaryArtist(t.artist), year: '', genre: '', trackIds: [], duration: 0, artTrackId: null, artV: 0, addedAt: 0 }; map.set(k, a); }
    a.trackIds.push(t.id); a.duration += t.duration || 0;
    if (!a.year && t.year) a.year = t.year;
    if (!a.genre && t.genre) a.genre = t.genre;
    if (!a.artTrackId && t.hasArt) { a.artTrackId = t.id; a.artV = t.artV; }
    a.addedAt = Math.max(a.addedAt, t.addedAt || 0);
  }
  const order = (x, y) => (x.disc || 1) - (y.disc || 1) || (x.track || 999) - (y.track || 999) || x.title.localeCompare(y.title);
  return [...map.values()].map((a) => {
    a.trackIds.sort((x, y) => order(db.tracks[x], db.tracks[y]));
    return a;
  });
}

/* ---------------- playlists ---------------- */

function playlists() { return db.playlists.map((p) => ({ ...p, trackIds: [...p.trackIds] })); }
function savePlaylist(pl) {
  let p = pl.id && db.playlists.find((x) => x.id === pl.id);
  if (!p) { p = { id: newId(), name: 'New playlist', trackIds: [], createdAt: Date.now() }; db.playlists.push(p); }
  if (pl.name != null) p.name = String(pl.name).trim() || p.name;
  if (Array.isArray(pl.trackIds)) p.trackIds = pl.trackIds.filter((id) => db.tracks[id]);
  if (Array.isArray(pl.add)) for (const id of pl.add) if (db.tracks[id] && !p.trackIds.includes(id)) p.trackIds.push(id);
  save();
  return { ...p };
}
function deletePlaylist(id) { db.playlists = db.playlists.filter((p) => p.id !== id); save(); }

/* ---------------- export bookkeeping ---------------- */
function markExported(target, ids) { const m = db.exports[target] || (db.exports[target] = {}); const now = Date.now(); for (const id of ids) m[id] = now; save(); }
function exportedAt(target) { return { ...(db.exports[target] || {}) }; }

function stats() {
  const ts = Object.values(db.tracks);
  return { tracks: ts.length, size: ts.reduce((s, t) => s + (t.size || 0), 0), duration: ts.reduce((s, t) => s + (t.duration || 0), 0) };
}

module.exports = {
  configure, open, flush, getRoot, tmp, all, get, filePath, findBySource, addTrack, update, reorder, remove,
  applyEdit, revertEdit, sourceFor, importFiles, scan, organizeAll, albums, playlists, savePlaylist, deletePlaylist,
  markExported, exportedAt, stats, prepareArt, artPath, renderPattern, sanitize, TAG_FIELDS, abs
};
