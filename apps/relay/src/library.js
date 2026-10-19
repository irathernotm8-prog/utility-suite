// Relay — personal media library.
// Everything lives in plain folders inside "Relay Files" (default ~/Downloads/Relay/Relay Files):
//   Downloads/ · Books & Comics/ · Movies & Shows/ · Music/
// Relay scans those folders, groups files into books/series, movies/shows and albums, and keeps
// covers: your own (saved in Relay Files/.covers), artwork next to the file (cover.jpg, poster.jpg,
// <name>.jpg), embedded album art, or an automatic one (first page / a video frame) cached by Relay.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, ipcMain, dialog, shell, net } = require('electron');

let ctx = null;
const FOLDERS = { downloads: 'Downloads', books: 'Books & Comics', video: 'Movies & Shows', music: 'Music' };
const BOOK = /\.(pdf|cbz|zip|cbr|epub)$/i;
const IMG = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
const VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;
const AUDIO = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|aiff?)$/i;
const SIDE_COVER = ['cover', 'poster', 'folder', 'front', 'album', 'art', 'artwork'];
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
const send = (ch, d) => { const w = ctx.getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, d); };
const fileUrl = (p) => (p ? 'file://' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F') : null);

/* ---------- folders ---------- */
function root() {
  const s = ctx.getStore().settings;
  return s.filesRoot || path.join(app.getPath('downloads'), 'Relay', 'Relay Files');
}
function folder(kind) { return path.join(root(), FOLDERS[kind]); }
function ensureFolders() {
  for (const k of Object.keys(FOLDERS)) { try { fs.mkdirSync(folder(k), { recursive: true }); } catch {} }
}
const thumbsDir = () => { const d = path.join(app.getPath('userData'), 'library-thumbs'); fs.mkdirSync(d, { recursive: true }); return d; };
const coversDir = () => { const d = path.join(root(), '.covers'); fs.mkdirSync(d, { recursive: true }); return d; };
const lib = () => { const s = ctx.getStore(); return (s.library = s.library || { meta: {} }); };
const metaFor = (kind, key) => lib().meta[kind + ':' + key] || {};

function ls(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => !d.name.startsWith('.') && d.name !== '__MACOSX'); } catch { return []; }
}
function statSafe(p) { try { return fs.statSync(p); } catch { return null; } }
function walk(dir, test, depth = 4, out = []) {
  for (const d of ls(dir)) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { if (depth > 0) walk(p, test, depth - 1, out); }
    else if (test.test(d.name)) out.push(p);
  }
  return out;
}

/* ---------- names ---------- */
const JUNK = /\b(2160p|1080p|720p|480p|4k|uhd|hdr|hdr10|dv|bluray|blu-ray|brrip|bdrip|web-?dl|webrip|web|hdtv|dvdrip|x264|x265|h\.?264|h\.?265|hevc|aac|ac3|dts|atmos|ddp?5\.1|5\.1|10bit|remux|proper|repack|extended|yify|rarbg)\b.*$/i;
function cleanName(name) {
  let n = name.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  let year = null;
  const y = n.match(/^(.*?)[\s([]*((?:19|20)\d{2})[\])]?(\s|$)/);
  if (y && y[1].trim().length > 1) { year = +y[2]; n = y[1]; }
  n = n.replace(JUNK, '').replace(/[\s\-–[(]+$/, '').trim();
  return { title: n || name, year };
}
function episodeInfo(file) {
  const b = path.basename(file);
  let m = b.match(/s(\d{1,2})[ ._-]?e(\d{1,3})/i) || b.match(/\b(\d{1,2})x(\d{2,3})\b/i);
  if (m) {
    const rest = cleanName(b.slice(b.indexOf(m[0]) + m[0].length)).title.replace(/^[\s\-–.]+/, '');
    return { season: +m[1], episode: +m[2], title: rest && !/^\d+$/.test(rest) ? rest : '' };
  }
  const sf = path.basename(path.dirname(file)).match(/season\s*(\d+)/i);
  m = b.match(/(?:episode|ep|e)[ ._-]?(\d{1,3})/i) || b.match(/^(\d{1,3})[ ._-]/);
  return { season: sf ? +sf[1] : 1, episode: m ? +m[1] : null, title: cleanName(b).title };
}

/* ---------- covers ---------- */
function sidecar(file, isDir) {
  const dir = isDir ? file : path.dirname(file);
  const base = isDir ? null : path.basename(file).replace(/\.[^.]+$/, '');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  const imgs = names.filter(n => IMG.test(n));
  if (base) { const own = imgs.find(n => n.replace(/\.[^.]+$/, '').toLowerCase() === base.toLowerCase() || n.toLowerCase().startsWith(base.toLowerCase() + '-poster')); if (own) return path.join(dir, own); }
  const inBase = !isDir && Object.keys(FOLDERS).some(k => path.resolve(folder(k)) === path.resolve(dir));
  if (!inBase) {
    const named = imgs.find(n => SIDE_COVER.includes(n.replace(/\.[^.]+$/, '').toLowerCase()));
    if (named && (isDir || imgs.length <= 3)) return path.join(dir, named);
  }
  return null;
}
function autoThumb(src, mtime) {
  const f = path.join(thumbsDir(), hash(src + '|' + Math.round(mtime || 0)) + '.jpg');
  return fs.existsSync(f) ? f : null;
}
function cover(kind, key, src, opts = {}) {
  const m = metaFor(kind, key);
  if (m.cover) { const c = path.join(coversDir(), m.cover); if (fs.existsSync(c)) return { cover: fileUrl(c), coverKind: 'custom' }; }
  const sc = opts.noSidecar ? null : sidecar(src, opts.isDir);
  if (sc) return { cover: fileUrl(sc), coverKind: 'file' };
  const st = statSafe(src);
  const a = autoThumb(src, st?.mtimeMs);
  if (a) return { cover: fileUrl(a) + '?v=' + Math.round(st?.mtimeMs || 0), coverKind: 'auto' };
  return { cover: null, coverKind: null, auto: opts.auto ? { ...opts.auto, src, mtime: st?.mtimeMs || 0 } : null };
}

/* ---------- books & comics ---------- */
function bookEntry(p, isDir = false) {
  const st = statSafe(p);
  const ext = isDir ? 'folder' : path.extname(p).slice(1).toLowerCase();
  let firstImg = null;
  if (isDir) firstImg = ls(p).filter(d => d.isFile() && IMG.test(d.name)).map(d => d.name).sort(natural)[0];
  const prog = (ctx.getStore().readerProgress || {})[p];
  const autoType = ext === 'pdf' ? 'pdf' : ['cbz', 'zip'].includes(ext) ? 'zip' : isDir && firstImg ? 'image' : null;
  return {
    path: p, ext, isDir, ...cleanName(path.basename(p)), addedAt: st?.birthtimeMs || st?.mtimeMs || 0, size: st?.size || 0,
    progress: prog ? { page: prog.page, total: prog.total, at: prog.at } : null,
    autoType, autoSrc: firstImg ? path.join(p, firstImg) : p
  };
}
function isImageFolder(dir) { const f = ls(dir).filter(d => d.isFile()); return f.filter(d => IMG.test(d.name)).length >= 2 && !f.some(d => BOOK.test(d.name)); }

function scanBooks() {
  const base = folder('books');
  const items = [];
  const withCover = (kind, key, b, extra = {}) => ({ ...b, ...cover(kind, key, b.path, { isDir: b.isDir, auto: b.autoType ? { type: b.autoType, from: b.autoSrc } : null }), ...extra });
  for (const d of ls(base)) {
    const p = path.join(base, d.name);
    if (d.isFile() && BOOK.test(d.name)) {
      const b = bookEntry(p);
      items.push(withCover('books', d.name, b, { key: d.name, type: 'book' }));
    } else if (d.isDirectory()) {
      if (isImageFolder(p)) { const b = bookEntry(p, true); items.push(withCover('books', d.name, b, { key: d.name, type: 'book' })); continue; }
      // a series / collection: every book file or page-folder inside
      const vols = [];
      const collect = (dir, depth) => {
        for (const x of ls(dir)) {
          const q = path.join(dir, x.name);
          if (x.isFile() && BOOK.test(x.name)) vols.push(bookEntry(q));
          else if (x.isDirectory() && depth > 0) { if (isImageFolder(q)) vols.push(bookEntry(q, true)); else collect(q, depth - 1); }
        }
      };
      collect(p, 3);
      if (!vols.length) continue;
      vols.sort((a, b) => natural(path.relative(p, a.path), path.relative(p, b.path)));
      const volumes = vols.map(v => ({ ...v, key: path.relative(base, v.path).split(path.sep).join('/'), ...cover('books', path.relative(base, v.path).split(path.sep).join('/'), v.path, { auto: v.autoType ? { type: v.autoType, from: v.autoSrc } : null }) }));
      const first = volumes[0];
      const st = statSafe(p);
      const c = cover('books', d.name, p, { isDir: true });
      const lastRead = volumes.filter(v => v.progress).sort((a, b) => b.progress.at - a.progress.at)[0];
      items.push({
        key: d.name, type: 'series', path: p, isDir: true, ...cleanName(d.name), volumes, count: volumes.length,
        addedAt: Math.max(st?.birthtimeMs || 0, ...volumes.map(v => v.addedAt)),
        progress: lastRead ? { ...lastRead.progress, volume: lastRead.key } : null,
        ...(c.cover ? c : { cover: first.cover, coverKind: first.coverKind, auto: null, coverFrom: first.key })
      });
    }
  }
  return items;
}

/* ---------- movies & shows ---------- */
function videoProgress(p) { return (ctx.getStore().mediaProgress || {})[p] || null; }
function scanVideo() {
  const base = folder('video');
  const items = [];
  const movie = (p, key, titleFrom) => {
    const st = statSafe(p);
    const n = cleanName(titleFrom);
    const c = cover('video', key, p, { isDir: false, auto: { type: 'video', from: p } });
    // a folder with a single movie may hold poster.jpg next to it
    return { key, type: 'movie', path: p, ...n, addedAt: st?.birthtimeMs || st?.mtimeMs || 0, size: st?.size || 0, progress: videoProgress(p), ...c };
  };
  for (const d of ls(base)) {
    const p = path.join(base, d.name);
    if (d.isFile() && VIDEO.test(d.name)) { items.push(movie(p, d.name, d.name)); continue; }
    if (!d.isDirectory()) continue;
    const vids = walk(p, VIDEO, 3).filter(v => !/sample|trailer/i.test(path.basename(v)));
    if (!vids.length) continue;
    const looksLikeShow = vids.length > 1 || vids.some(v => /s\d{1,2}[ ._-]?e\d{1,3}|\b\d{1,2}x\d{2,3}\b/i.test(path.basename(v))) || ls(p).some(x => x.isDirectory() && /season/i.test(x.name));
    if (!looksLikeShow) { items.push({ ...movie(vids[0], d.name, d.name), ...pickFolderCover('video', d.name, p, vids[0]) }); continue; }
    const episodes = vids.map(v => {
      const e = episodeInfo(v);
      const st = statSafe(v);
      const key = path.relative(base, v).split(path.sep).join('/');
      return { key, path: v, ...e, addedAt: st?.birthtimeMs || st?.mtimeMs || 0, progress: videoProgress(v), ...cover('video', key, v, { auto: { type: 'video', from: v } }) };
    }).sort((a, b) => (a.season - b.season) || ((a.episode ?? 1e9) - (b.episode ?? 1e9)) || natural(a.path, b.path));
    const seasons = [...new Set(episodes.map(e => e.season))];
    const st = statSafe(p);
    const c = cover('video', d.name, p, { isDir: true });
    const watched = episodes.filter(e => e.progress && e.progress.done).length;
    const lastWatched = episodes.filter(e => e.progress).sort((a, b) => b.progress.at - a.progress.at)[0];
    items.push({
      key: d.name, type: 'show', path: p, isDir: true, ...cleanName(d.name), episodes, seasons, count: episodes.length, watched,
      addedAt: Math.max(st?.birthtimeMs || 0, ...episodes.map(e => e.addedAt)),
      progress: lastWatched ? { ...lastWatched.progress, episode: lastWatched.key } : null,
      ...(c.cover ? c : { cover: episodes[0].cover, coverKind: episodes[0].coverKind, auto: null, coverFrom: episodes[0].key })
    });
  }
  return items;
}
function pickFolderCover(kind, key, dir, file) {
  const c = cover(kind, key, dir, { isDir: true });
  return c.cover ? c : {};
}

/* ---------- music ---------- */
let tagCache = null;
const tagFile = () => path.join(app.getPath('userData'), 'library-tags.json');
function tags() { if (!tagCache) { try { tagCache = JSON.parse(fs.readFileSync(tagFile(), 'utf8')); } catch { tagCache = {}; } } return tagCache; }
let tagSaveT = null;
function saveTags() { clearTimeout(tagSaveT); tagSaveT = setTimeout(() => { try { fs.writeFileSync(tagFile(), JSON.stringify(tagCache)); } catch {} }, 800); }

async function readTags(file, st) {
  const c = tags()[file];
  if (c && c.mtime === Math.round(st.mtimeMs)) return c;
  let t = { mtime: Math.round(st.mtimeMs) };
  try {
    const mm = require('music-metadata');
    const md = await mm.parseFile(file, { duration: false, skipCovers: false });
    const cm = md.common;
    t = { ...t, title: cm.title || '', artist: cm.artist || '', albumartist: cm.albumartist || '', album: cm.album || '', track: cm.track?.no || null, disk: cm.disk?.no || null, year: cm.year || null, duration: md.format.duration || null };
    const pic = cm.picture?.[0];
    if (pic?.data?.length) {
      const out = path.join(thumbsDir(), hash('art|' + file + '|' + t.mtime) + (/png/.test(pic.format) ? '.png' : '.jpg'));
      if (!fs.existsSync(out)) fs.writeFileSync(out, pic.data);
      t.art = out;
    }
  } catch {}
  tags()[file] = t; saveTags();
  return t;
}

async function scanMusic() {
  const base = folder('music');
  const files = walk(base, AUDIO, 5);
  const albums = new Map();
  for (const f of files) {
    const st = statSafe(f); if (!st) continue;
    const t = await readTags(f, st);
    const dir = path.dirname(f);
    const loose = dir === base;
    const albumName = t.album || (loose ? 'Singles' : path.basename(dir));
    const artist = t.albumartist || t.artist || (!loose && path.dirname(dir) !== base ? path.basename(path.dirname(dir)) : '');
    // group by folder first (keeps compilations together), loose files by their album tag
    const key = loose ? (t.album ? 'album:' + t.album + '|' + artist : 'Singles') : path.relative(base, dir).split(path.sep).join('/');
    if (!albums.has(key)) albums.set(key, { key, type: 'album', title: albumName, artist, year: t.year, path: loose ? base : dir, isDir: !loose, tracks: [], addedAt: 0, art: null });
    const a = albums.get(key);
    a.tracks.push({ path: f, key: path.relative(base, f).split(path.sep).join('/'), title: t.title || cleanName(path.basename(f)).title.replace(/^\d{1,3}[\s.\-–]+/, ''), artist: t.artist || artist, track: t.track, disk: t.disk, duration: t.duration });
    a.addedAt = Math.max(a.addedAt, st.birthtimeMs || st.mtimeMs);
    if (!a.year && t.year) a.year = t.year;
    if (!a.artist && artist) a.artist = artist;
    if (!a.art && t.art && fs.existsSync(t.art)) a.art = t.art;
  }
  return [...albums.values()].map(a => {
    a.tracks.sort((x, y) => ((x.disk || 1) - (y.disk || 1)) || ((x.track ?? 1e9) - (y.track ?? 1e9)) || natural(x.path, y.path));
    a.count = a.tracks.length;
    a.duration = a.tracks.reduce((n, t) => n + (t.duration || 0), 0);
    let c = cover('music', a.key, a.path, { isDir: a.isDir, noSidecar: !a.isDir });
    if (!c.cover && a.art) c = { cover: fileUrl(a.art), coverKind: 'embedded' };
    delete a.art;
    return { ...a, sub: a.artist, ...c };
  });
}

/* ---------- scan + meta ---------- */
async function scan(kind) {
  ensureFolders();
  const items = kind === 'books' ? scanBooks() : kind === 'video' ? scanVideo() : kind === 'music' ? await scanMusic() : [];
  // user edits win over what the file names say
  for (const it of items) {
    const m = metaFor(kind, it.key);
    if (m.title) it.title = m.title;
    if (m.year) it.year = m.year;
    if (m.sub) it.sub = m.sub;
    if (m.notes) it.notes = m.notes;
    it.favorite = !!m.favorite;
    it.openedAt = m.openedAt || 0;
  }
  return { kind, folder: folder(kind), items };
}

function setMeta(kind, key, patch) {
  const L = lib();
  const k = kind + ':' + key;
  L.meta[k] = { ...(L.meta[k] || {}), ...patch };
  for (const [f, v] of Object.entries(L.meta[k])) if (v === null || v === '') delete L.meta[k][f];
  ctx.saveStore();
}

async function setCover(kind, key, from) {
  let data, ext = '.jpg';
  if (/^https?:/i.test(from)) {
    const r = await net.fetch(from);
    if (!r.ok) throw new Error('Couldn’t download that image');
    data = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get('content-type') || '';
    ext = /png/.test(ct) ? '.png' : /webp/.test(ct) ? '.webp' : '.jpg';
  } else if (/^data:image\//.test(from)) {
    const m = from.match(/^data:image\/(\w+);base64,(.*)$/);
    data = Buffer.from(m[2], 'base64'); ext = '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
  } else {
    if (!IMG.test(from)) throw new Error('Pick an image file (JPG, PNG, WebP…)');
    data = await fs.promises.readFile(from); ext = path.extname(from).toLowerCase();
  }
  const old = metaFor(kind, key).cover;
  const name = hash(kind + ':' + key + ':' + Date.now()) + ext;
  await fs.promises.writeFile(path.join(coversDir(), name), data);
  if (old) fs.promises.unlink(path.join(coversDir(), old)).catch(() => {});
  setMeta(kind, key, { cover: name });
}

async function importFiles(kind, paths, move = false) {
  const dest = folder(kind);
  fs.mkdirSync(dest, { recursive: true });
  const done = [];
  for (const src of paths) {
    if (!src || !fs.existsSync(src)) continue;
    let target = path.join(dest, path.basename(src));
    if (path.resolve(src) === path.resolve(target)) continue;
    let n = 1; const ext = path.extname(target), b = target.slice(0, target.length - ext.length);
    while (fs.existsSync(target)) target = `${b} (${n++})${ext}`;
    if (move) {
      try { await fs.promises.rename(src, target); }
      catch { await fs.promises.cp(src, target, { recursive: true }); await shell.trashItem(src).catch(() => {}); }
      // keep the Downloads history pointing at the file's new home
      for (const d of ctx.getStore().downloads || []) if (d.path === src) { d.path = target; d.name = path.basename(target); d.inLibrary = kind; }
    } else await fs.promises.cp(src, target, { recursive: true, errorOnExist: false });
    done.push(target);
  }
  ctx.saveStore();
  return done;
}
const kindForFile = (p) => (VIDEO.test(p) ? 'video' : AUDIO.test(p) ? 'music' : BOOK.test(p) || IMG.test(p) ? 'books' : null);

let watchT = null, watchers = [];
function watch() {
  watchers.forEach(w => { try { w.close(); } catch {} });
  watchers = [];
  for (const k of ['books', 'video', 'music']) {
    try {
      watchers.push(fs.watch(folder(k), { recursive: true }, (_ev, f) => {
        if (f && /(^|[/\\])\./.test(f)) return;
        clearTimeout(watchT); watchT = setTimeout(() => send('library:changed', {}), 1200);
      }));
    } catch {}
  }
}

function register(c) {
  ctx = c;
  ensureFolders();
  setTimeout(watch, 3000);
  ipcMain.handle('library:root', () => ({ root: root(), folders: Object.fromEntries(Object.keys(FOLDERS).map(k => [k, folder(k)])) }));
  ipcMain.handle('library:scan', (_e, kind) => scan(kind));
  ipcMain.handle('library:meta', (_e, { kind, key, patch }) => setMeta(kind, key, patch));
  ipcMain.handle('library:opened', (_e, { kind, key }) => setMeta(kind, key, { openedAt: Date.now() }));
  ipcMain.handle('library:pick-cover', async (_e, { kind, key }) => {
    const r = await dialog.showOpenDialog(ctx.getWin(), { title: 'Choose a cover image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'] }] });
    if (r.canceled || !r.filePaths[0]) return false;
    await setCover(kind, key, r.filePaths[0]);
    return true;
  });
  ipcMain.handle('library:set-cover', async (_e, { kind, key, from }) => { await setCover(kind, key, from); return true; });
  ipcMain.handle('library:reset-cover', (_e, { kind, key }) => {
    const old = metaFor(kind, key).cover;
    if (old) fs.promises.unlink(path.join(coversDir(), old)).catch(() => {});
    setMeta(kind, key, { cover: null });
    return true;
  });
  // automatic covers are made by the window (PDF first page, a frame of the video) and cached here
  ipcMain.handle('library:save-thumb', async (_e, { src, mtime, dataUrl }) => {
    const m = /^data:image\/jpeg;base64,(.*)$/.exec(dataUrl || '');
    if (!m) return null;
    const out = path.join(thumbsDir(), hash(src + '|' + Math.round(mtime || 0)) + '.jpg');
    await fs.promises.writeFile(out, Buffer.from(m[1], 'base64'));
    return fileUrl(out);
  });
  ipcMain.handle('library:file-bytes', (_e, p) => (p && p.startsWith(root()) ? fs.promises.readFile(p) : null));
  ipcMain.handle('library:zip-first', async (_e, p) => {
    if (!p || !p.startsWith(root())) return null;
    const yauzl = require('yauzl');
    return new Promise((res) => yauzl.open(p, { lazyEntries: true }, (err, zip) => {
      if (err) return res(null);
      const names = [];
      zip.on('entry', (e) => { if (IMG.test(e.fileName) && !/(^|\/)(__MACOSX|\.)/.test(e.fileName)) names.push(e); zip.readEntry(); });
      zip.on('end', () => {
        const first = names.sort((a, b) => natural(a.fileName, b.fileName))[0];
        if (!first) { zip.close(); return res(null); }
        // re-open to read just that one entry
        yauzl.open(p, { lazyEntries: true }, (e2, z2) => {
          if (e2) return res(null);
          z2.on('entry', (e) => {
            if (e.fileName !== first.fileName) return z2.readEntry();
            z2.openReadStream(e, (e3, s) => { if (e3) return res(null); const ch = []; s.on('data', c => ch.push(c)); s.on('end', () => { z2.close(); res({ data: Buffer.concat(ch), name: e.fileName }); }); });
          });
          z2.on('end', () => res(null));
          z2.readEntry();
        });
      });
      zip.readEntry();
    }));
  });
  ipcMain.handle('library:open-folder', (_e, kind) => shell.openPath(kind ? folder(kind) : root()));
  ipcMain.handle('library:show', (_e, p) => { if (p && p.startsWith(root())) shell.showItemInFolder(p); });
  ipcMain.handle('library:open-external', (_e, p) => (p && p.startsWith(root()) ? shell.openPath(p) : 'not allowed'));
  ipcMain.handle('library:trash', async (_e, p) => { if (p && p.startsWith(root()) && p !== root()) await shell.trashItem(p); return true; });
  ipcMain.handle('library:add', async (_e, kind) => {
    const filters = kind === 'books' ? [{ name: 'Books & comics', extensions: ['pdf', 'cbz', 'zip', 'cbr', 'epub'] }]
      : kind === 'video' ? [{ name: 'Movies & episodes', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'] }]
      : [{ name: 'Music', extensions: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'aiff'] }];
    const r = await dialog.showOpenDialog(ctx.getWin(), { title: 'Add to your library (files are copied)', properties: ['openFile', 'openDirectory', 'multiSelections'], filters });
    if (r.canceled) return [];
    return importFiles(kind, r.filePaths, false);
  });
  ipcMain.handle('library:import', (_e, { kind, paths, move }) => importFiles(kind || kindForFile(paths[0]) || 'books', paths, !!move));
  ipcMain.handle('library:kind-for', (_e, p) => kindForFile(p || ''));
  ipcMain.handle('library:choose-root', async () => {
    const r = await dialog.showOpenDialog(ctx.getWin(), { title: 'Choose where Relay keeps your files', properties: ['openDirectory', 'createDirectory'], defaultPath: root() });
    if (r.canceled || !r.filePaths[0]) return null;
    ctx.getStore().settings.filesRoot = r.filePaths[0];
    ctx.saveStore();
    ensureFolders(); watch();
    return root();
  });
  // playback position for local videos & music (resume where you left off)
  ipcMain.handle('media:progress', (_e, { file, pos, dur }) => {
    if (!file || !dur) return;
    const s = ctx.getStore();
    s.mediaProgress = s.mediaProgress || {};
    const done = pos >= dur - Math.min(90, dur * 0.05);
    s.mediaProgress[file] = { pos: done ? 0 : pos, dur, done, at: Date.now() };
    ctx.saveStore();
  });
  ipcMain.handle('media:get-progress', (_e, file) => (ctx.getStore().mediaProgress || {})[file] || null);
}

module.exports = { register, root, folder, ensureFolders, FOLDERS };
