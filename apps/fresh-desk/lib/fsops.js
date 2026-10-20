'use strict';
// File-system operations for the explorer. Plain Node so it can be tested
// without Electron. Nothing here deletes permanently: removal goes through
// the OS Trash in main.js.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const KINDS = [
  ['Folder', []],
  ['Image', 'png jpg jpeg gif webp bmp tif tiff heic heif avif svg ico raw cr2 cr3 nef arw dng psd'.split(' ')],
  ['PDF', ['pdf']],
  ['Document', 'doc docx rtf odt pages txt md markdown tex epub mobi'.split(' ')],
  ['Spreadsheet', 'xls xlsx xlsm csv tsv ods numbers'.split(' ')],
  ['Presentation', 'ppt pptx key odp'.split(' ')],
  ['Video', 'mp4 mov m4v avi mkv webm wmv flv mpg mpeg'.split(' ')],
  ['Audio', 'mp3 wav aac flac m4a ogg opus aiff aif wma'.split(' ')],
  ['Archive', 'zip rar 7z tar gz tgz bz2 xz zst'.split(' ')],
  ['Installer', 'dmg pkg exe msi msix appimage deb rpm'.split(' ')],
  ['Code', 'js mjs cjs ts tsx jsx py rb go rs java kt swift c h cpp hpp cs php sh zsh bash ps1 bat cmd html htm css scss vue svelte sql lua r dart yml yaml toml ini xml json jsonc env lock'.split(' ')],
  ['Font', 'ttf otf woff woff2'.split(' ')],
  ['Design', 'ai fig sketch xd afdesign afphoto indd eps'.split(' ')],
];
const KIND_BY_EXT = new Map();
for (const [kind, exts] of KINDS) for (const e of exts) KIND_BY_EXT.set(e, kind);

const TEXT_EXT = new Set('txt md markdown log csv tsv json jsonc xml yml yaml toml ini cfg conf env gitignore js mjs cjs ts tsx jsx py rb go rs java kt swift c h cpp hpp cs php sh zsh bash ps1 bat cmd html htm css scss vue svelte sql lua r dart lock srt vtt'.split(' '));

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}
function kindOf(name, isDir) {
  if (isDir) return name.toLowerCase().endsWith('.app') ? 'Application' : 'Folder';
  if (/^\.?(dockerfile|makefile|readme|license)$/i.test(name)) return 'Document';
  return KIND_BY_EXT.get(extOf(name)) || (extOf(name) ? `${extOf(name).toUpperCase()} file` : 'File');
}
const isHidden = name => name.startsWith('.') || name === 'desktop.ini' || name === 'Thumbs.db' || name === '$RECYCLE.BIN';

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
  return out;
}

async function entry(dir, name) {
  const full = path.join(dir, name);
  let st = await fs.lstat(full);
  const isLink = st.isSymbolicLink();
  let broken = false;
  if (isLink) { try { st = await fs.stat(full); } catch { broken = true; } }
  const isDir = !broken && st.isDirectory();
  // macOS app bundles behave like files in the explorer (open, don't enter).
  const isPackage = isDir && /\.(app|bundle|framework|photoslibrary|musiclibrary|rtfd)$/i.test(name) && process.platform === 'darwin';
  return {
    name, path: full, isDir: isDir && !isPackage, isPackage, isLink, broken,
    size: isDir ? null : st.size,
    mtime: st.mtimeMs, ctime: st.birthtimeMs || st.ctimeMs,
    ext: isDir && !isPackage ? '' : extOf(name),
    kind: isPackage ? 'Application' : kindOf(name, isDir),
    hidden: isHidden(name),
  };
}

// Things Finder keeps out of sight even though they aren't dotfiles.
const MAC_ROOT_HIDDEN = new Set(['bin', 'cores', 'dev', 'etc', 'home', 'opt', 'private', 'sbin', 'tmp', 'usr', 'var', 'Volumes']);
function hiddenHere(dir, name) {
  if (isHidden(name) || name === 'Icon\r') return true;
  if (process.platform === 'darwin') {
    if (dir === '/' && MAC_ROOT_HIDDEN.has(name)) return true;
    if (dir === os.homedir() && name === 'Library') return true;
  }
  return false;
}
async function list(dir, {hidden = false} = {}) {
  dir = path.resolve(dir);
  const names = await fs.readdir(dir);
  const shown = hidden ? names : names.filter(n => !hiddenHere(dir, n));
  const entries = (await mapLimit(shown, 48, async n => { try { return await entry(dir, n); } catch { return null; } })).filter(Boolean);
  const parent = path.dirname(dir);
  return {path: dir, parent: parent === dir ? null : parent, entries, hiddenCount: names.length - shown.length};
}

async function exists(p) { try { await fs.lstat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }

function checkName(name) {
  if (typeof name !== 'string') throw Error('Enter a name.');
  const n = name.trim();
  if (!n || n === '.' || n === '..') throw Error('Enter a name.');
  if (n.length > 255) throw Error('That name is too long.');
  if (/[\/\x00]/.test(n) || (process.platform === 'win32' && /[<>:"\\|?*\x00-\x1f]/.test(n))) throw Error('Names can’t contain / or other reserved characters.');
  if (process.platform === 'win32' && /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(n)) throw Error('That name is reserved by Windows.');
  return n;
}

// "report.pdf" -> "report 2.pdf", "report 3.pdf" ... (folders: "untitled folder 2")
async function uniquePath(dir, name, {copy = false} = {}) {
  let candidate = path.join(dir, name);
  if (!(await exists(candidate))) return candidate;
  const ext = path.extname(name);
  const isFolderLike = !ext || ext.length > 8;
  const stem = isFolderLike ? name : name.slice(0, -ext.length);
  const suffix = isFolderLike ? '' : ext;
  const base = copy ? `${stem.replace(/ copy( \d+)?$/, '')} copy` : stem.replace(/ \d+$/, '');
  for (let i = copy ? 1 : 2; i < 10000; i++) {
    candidate = path.join(dir, `${base}${i === 1 ? '' : ' ' + i}${suffix}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw Error('Could not find a free name.');
}

async function makeFolder(dir, name = 'untitled folder') {
  const target = await uniquePath(dir, checkName(name));
  await fs.mkdir(target);
  return target;
}
async function makeFile(dir, name = 'untitled.txt') {
  const target = await uniquePath(dir, checkName(name));
  await fs.writeFile(target, '', {flag: 'wx'});
  return target;
}

async function rename(from, newName) {
  const name = checkName(newName);
  const to = path.join(path.dirname(from), name);
  if (to === from) return from;
  const caseOnly = to.toLowerCase() === from.toLowerCase();
  if (!caseOnly && await exists(to)) throw Error(`“${name}” already exists here.`);
  if (caseOnly) { // case-insensitive volumes: go through a temporary name
    const tmp = path.join(path.dirname(from), `.fd-rename-${process.pid}-${Date.now()}`);
    await fs.rename(from, tmp); await fs.rename(tmp, to);
  } else await fs.rename(from, to);
  return to;
}

function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function moveOne(from, destDir) {
  if (inside(destDir, from)) throw Error(`Can’t move “${path.basename(from)}” into itself.`);
  if (path.dirname(from) === destDir) return null; // already there
  const to = await uniquePath(destDir, path.basename(from));
  try { await fs.rename(from, to); }
  catch (e) {
    if (e.code !== 'EXDEV') throw e;
    // Different drive: copy, verify, then remove the original.
    await fs.cp(from, to, {recursive: true, errorOnExist: true, force: false, preserveTimestamps: true});
    await fs.rm(from, {recursive: true});
  }
  return to;
}
async function copyOne(from, destDir) {
  if (inside(destDir, from) && destDir !== path.dirname(from)) throw Error(`Can’t copy “${path.basename(from)}” into itself.`);
  const to = await uniquePath(destDir, path.basename(from), {copy: path.dirname(from) === destDir});
  await fs.cp(from, to, {recursive: true, errorOnExist: true, force: false, preserveTimestamps: true});
  return to;
}
// Runs one operation per source and reports each result; never overwrites.
async function transfer(kind, sources, destDir) {
  const st = await fs.stat(destDir);
  if (!st.isDirectory()) throw Error('Destination is not a folder.');
  const results = [];
  for (const from of sources) {
    try {
      const to = kind === 'copy' ? await copyOne(from, destDir) : await moveOne(from, destDir);
      results.push({from, to, ok: true, renamed: to && path.basename(to) !== path.basename(from)});
    } catch (e) { results.push({from, ok: false, error: e.message}); }
  }
  return results;
}

async function folderSize(dir, canceled = () => false) {
  let bytes = 0, files = 0, folders = 0;
  const stack = [dir];
  while (stack.length) {
    if (canceled()) throw Error('Canceled');
    const cur = stack.pop();
    let ents; try { ents = await fs.readdir(cur, {withFileTypes: true}); } catch { continue; }
    await mapLimit(ents, 32, async ent => {
      const p = path.join(cur, ent.name);
      if (ent.isSymbolicLink()) return;
      if (ent.isDirectory()) { folders++; stack.push(p); return; }
      try { bytes += (await fs.lstat(p)).size; files++; } catch {}
    });
  }
  return {bytes, files, folders};
}

const SEARCH_SKIP = new Set(['node_modules', '.git', '.Trash', 'Library', '$RECYCLE.BIN', 'System Volume Information', 'AppData']);
function matcher(query) {
  const q = query.trim().toLowerCase();
  if (q.includes('*') || q.includes('?')) {
    const re = new RegExp('^' + q.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    return name => re.test(name);
  }
  const words = q.split(/\s+/).filter(Boolean);
  return name => { const n = name.toLowerCase(); return words.every(w => n.includes(w)); };
}
// Breadth-first so nearby matches arrive first. Streams batches via onBatch.
async function search(root, query, {hidden = false, max = 2000, onBatch = () => {}, canceled = () => false} = {}) {
  const match = matcher(query);
  const queue = [root]; let found = 0, scanned = 0, batch = [], lastFlush = Date.now();
  const flush = () => { if (batch.length) { onBatch(batch); batch = []; } lastFlush = Date.now(); };
  while (queue.length && found < max) {
    if (canceled()) break;
    const dir = queue.shift();
    let names; try { names = await fs.readdir(dir, {withFileTypes: true}); } catch { continue; }
    for (const ent of names) {
      if (!hidden && isHidden(ent.name)) continue;
      scanned++;
      if (ent.isDirectory() && !ent.isSymbolicLink() && !SEARCH_SKIP.has(ent.name) && !(process.platform === 'darwin' && /\.app$/i.test(ent.name))) queue.push(path.join(dir, ent.name));
      if (match(ent.name)) {
        try { batch.push(await entry(dir, ent.name)); found++; } catch {}
        if (found >= max) break;
      }
    }
    if (batch.length >= 50 || Date.now() - lastFlush > 120) flush();
  }
  flush();
  return {found, scanned, truncated: found >= max, canceled: canceled()};
}

async function readText(file, max = 200 * 1024) {
  const h = await fs.open(file, 'r');
  try {
    const st = await h.stat();
    const buf = Buffer.alloc(Math.min(max, st.size));
    const {bytesRead} = await h.read(buf, 0, buf.length, 0);
    const slice = buf.subarray(0, bytesRead);
    if (slice.subarray(0, 8000).includes(0)) return {binary: true};
    return {text: slice.toString('utf8'), truncated: st.size > bytesRead, size: st.size};
  } finally { await h.close(); }
}

async function info(p) {
  const e = await entry(path.dirname(p), path.basename(p));
  const st = await fs.stat(p);
  const out = {...e, mode: (st.mode & 0o777).toString(8), atime: st.atimeMs};
  if (e.isDir) { try { out.items = (await fs.readdir(p)).filter(n => !isHidden(n)).length; } catch { out.items = null; } }
  if (e.isLink) { try { out.target = await fs.readlink(p); } catch {} }
  return out;
}

async function diskSpace(p) {
  try { const s = await fs.statfs(p); return {free: s.bavail * s.bsize, total: s.blocks * s.bsize}; } catch { return null; }
}

async function places(paths) {
  const home = paths.home;
  const favorites = [
    {name: 'Home', path: home, icon: 'home'},
    {name: 'Desktop', path: paths.desktop, icon: 'desktop'},
    {name: 'Documents', path: paths.documents, icon: 'doc'},
    {name: 'Downloads', path: paths.downloads, icon: 'download'},
    {name: 'Pictures', path: paths.pictures, icon: 'image'},
    {name: 'Music', path: paths.music, icon: 'music'},
    {name: process.platform === 'darwin' ? 'Movies' : 'Videos', path: paths.videos, icon: 'video'},
  ];
  if (process.platform === 'darwin') favorites.splice(1, 0, {name: 'Applications', path: '/Applications', icon: 'apps'});
  // Some Linux setups report the home folder for every standard folder.
  for (const f of favorites) if (f.name !== 'Home' && (!f.path || f.path === home)) f.path = path.join(home, f.name);
  const ok = await mapLimit(favorites, 8, async f => (f.path && await exists(f.path)) ? f : null);
  const seen = new Set();
  return {favorites: ok.filter(f => f && !seen.has(f.path) && seen.add(f.path)), volumes: await volumes()};
}

async function volumes() {
  const out = [];
  if (process.platform === 'darwin') {
    out.push({name: 'Macintosh HD', path: '/', icon: 'drive'});
    try {
      for (const n of await fs.readdir('/Volumes')) {
        const p = path.join('/Volumes', n);
        try { if ((await fs.lstat(p)).isSymbolicLink()) continue; } catch { continue; }
        out.push({name: n, path: p, icon: 'drive', removable: true});
      }
    } catch {}
  } else if (process.platform === 'win32') {
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const found = await mapLimit(letters, 8, async l => { try { await fs.access(`${l}:\\`); return {name: `${l}:`, path: `${l}:\\`, icon: 'drive'}; } catch { return null; } });
    out.push(...found.filter(Boolean));
  } else {
    out.push({name: 'Computer', path: '/', icon: 'drive'});
    for (const base of [`/media/${os.userInfo().username}`, '/mnt']) {
      try { for (const n of await fs.readdir(base)) out.push({name: n, path: path.join(base, n), icon: 'drive', removable: true}); } catch {}
    }
  }
  return out;
}

module.exports = {list, entry, kindOf, extOf, isHidden, uniquePath, makeFolder, makeFile, rename, transfer, folderSize, search, readText, info, diskSpace, places, volumes, exists, inside, checkName, TEXT_EXT, KINDS};
