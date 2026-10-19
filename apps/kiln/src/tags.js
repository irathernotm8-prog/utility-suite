// Kiln — prompt tag autocomplete (Danbooru/e621 tag lists, same CSV format as a1111-tagcomplete).
const fs = require('fs');
const path = require('path');
const { ipcMain, app } = require('electron');
const core = require('./core');
const tools = require('./tools');

let tags = null;      // [{ t, c, n, a }]
let loadedFrom = null;
const PREFERRED = ['danbooru_e621_merged.csv', 'danbooru.csv', 'e621.csv'];
const DOWNLOAD = 'https://raw.githubusercontent.com/DominikDoom/a1111-sd-webui-tagcomplete/main/tags/danbooru.csv';

function ownDir() { return core.ensureDir(path.join(app.getPath('userData'), 'tags')); }
function findCsv() {
  const dirs = [core.g().tools.tagsDir, ownDir()].filter(Boolean);
  for (const d of dirs) for (const f of PREFERRED) { const p = path.join(d, f); if (fs.existsSync(p)) return p; }
  return null;
}
function parseLine(line) {
  // tag,category,count,"alias1,alias2"
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function load() {
  const file = findCsv();
  if (!file) { tags = []; loadedFrom = null; return; }
  if (loadedFrom === file && tags) return;
  const text = fs.readFileSync(file, 'utf8');
  const arr = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const [t, c, n, a] = parseLine(line);
    if (!t) continue;
    arr.push({ t, c: Number(c) || 0, n: Number(n) || 0, a: a ? a.split(',').filter(Boolean) : [] });
  }
  arr.sort((x, y) => y.n - x.n);
  tags = arr; loadedFrom = file;
}
function search(q, limit = 12) {
  if (!tags || !tags.length) load();
  q = String(q || '').trim().toLowerCase().replace(/ /g, '_');
  if (q.length < 2 || !tags.length) return [];
  const out = [];
  for (const x of tags) {
    if (x.t.startsWith(q)) out.push({ tag: x.t, count: x.n, category: x.c });
    else { const al = x.a.find(a => a.startsWith(q)); if (al) out.push({ tag: x.t, count: x.n, category: x.c, alias: al }); }
    if (out.length >= limit) break;
  }
  if (out.length < limit && q.length >= 3) {
    for (const x of tags) { if (out.length >= limit) break; if (!x.t.startsWith(q) && x.t.includes(q)) out.push({ tag: x.t, count: x.n, category: x.c }); }
  }
  return out;
}

function register() {
  ipcMain.handle('tags:search', (_e, q) => search(q));
  ipcMain.handle('tags:status', () => { if (!tags) { try { load(); } catch {} } return { available: !!(tags && tags.length), count: tags?.length || 0, file: loadedFrom }; });
  ipcMain.handle('tags:download', async () => {
    await tools.downloadFile(DOWNLOAD, path.join(ownDir(), 'danbooru.csv'));
    tags = null; load();
    return { available: !!tags.length, count: tags.length };
  });
}

module.exports = { register, search };
