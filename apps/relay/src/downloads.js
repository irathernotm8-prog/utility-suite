// Relay — download manager: every download from any account, storage service, browser tab
// or the media player lands in one folder (default ~/Downloads/Relay/Relay Files/Downloads) and is recorded in history.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, ipcMain, shell, dialog, session } = require('electron');

let ctx = null;                 // { getStore, saveStore, getWin }
const active = new Map();       // id -> DownloadItem
const attached = new WeakSet();

const KIND = {
  video: /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpg|mpeg|3gp)$/i,
  audio: /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|aiff?|wma)$/i,
  image: /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif|tiff?|svg)$/i,
  comic: /\.(cbz|cbr|cb7)$/i,
  pdf: /\.pdf$/i,
  archive: /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|dmg|pkg|iso)$/i,
  doc: /\.(docx?|xlsx?|pptx?|pages|numbers|key|txt|rtf|csv|md|odt|ods|odp|json|xml|html?)$/i
};
function kindOf(name) {
  for (const [k, re] of Object.entries(KIND)) if (re.test(name)) return k;
  return 'other';
}

const OLD_DEFAULT = () => path.join(app.getPath('downloads'), 'Relay');
function dir() {
  const s = ctx.getStore();
  const d = s.settings.downloadDir || path.join(ctx.filesRoot(), 'Downloads');
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}
function history() { const s = ctx.getStore(); return (s.downloads = s.downloads || []); }
function send(ch, data) { const w = ctx.getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, data); }
function publicItem(d) { return { ...d, exists: d.state !== 'completed' ? true : fs.existsSync(d.path) }; }

function uniquePath(d, name) {
  name = name.replace(/[/\\:]/g, '_') || 'download';
  let target = path.join(d, name), n = 1;
  const ext = path.extname(name), base = path.basename(name, ext);
  while (fs.existsSync(target) || [...active.values()].some(i => i.getSavePath() === target)) target = path.join(d, `${base} (${n++})${ext}`);
  return target;
}

// partition -> friendly label resolver is supplied by main.js
let describeSource = () => ({});

function attach(ses, partition) {
  if (attached.has(ses)) return;
  attached.add(ses);
  ses.on('will-download', (_e, item, wc) => {
    const id = crypto.randomUUID();
    const target = uniquePath(dir(), item.getFilename());
    item.setSavePath(target);
    active.set(id, item);
    let pageUrl = '', pageTitle = '';
    try { pageUrl = wc?.getURL() || ''; pageTitle = wc?.getTitle() || ''; } catch {}
    const rec = {
      id, name: path.basename(target), path: target, url: item.getURL(), mime: item.getMimeType(),
      kind: kindOf(target), total: item.getTotalBytes(), received: 0, state: 'progressing',
      startedAt: Date.now(), doneAt: null, partition, pageUrl, pageTitle, ...describeSource(partition)
    };
    history().unshift(rec);
    if (history().length > 1000) history().length = 1000;
    ctx.saveStore();
    send('download', { state: 'started', name: rec.name, path: rec.path });
    send('downloads:update', publicItem(rec));
    let last = 0;
    item.on('updated', (_ev, state) => {
      rec.received = item.getReceivedBytes(); rec.total = item.getTotalBytes();
      rec.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing';
      const now = Date.now();
      if (now - last > 250) { last = now; send('downloads:update', publicItem(rec)); }
    });
    item.once('done', (_ev, state) => {
      active.delete(id);
      rec.received = item.getReceivedBytes(); rec.total = item.getTotalBytes() || rec.received;
      rec.state = state; rec.doneAt = Date.now();
      ctx.saveStore();
      send('downloads:update', publicItem(rec));
      send('download', { state, name: rec.name, path: rec.path, id });
    });
  });
}

function find(id) { return history().find(d => d.id === id); }

// v1.5: downloads used to land straight in ~/Downloads/Relay (next to Relay's own files).
// Move what Relay downloaded there into Relay Files/Downloads, once.
function migrate() {
  const s = ctx.getStore();
  if (s.settings.downloadDir && path.resolve(s.settings.downloadDir) === path.resolve(OLD_DEFAULT())) delete s.settings.downloadDir;
  if (s.settings.filesMigrated) return;
  s.settings.filesMigrated = true;
  const target = dir();
  for (const d of history()) {
    if (d.state !== 'completed' || !d.path || path.resolve(path.dirname(d.path)) !== path.resolve(OLD_DEFAULT())) continue;
    try {
      if (!fs.existsSync(d.path)) continue;
      const to = uniquePath(target, path.basename(d.path));
      fs.renameSync(d.path, to);
      d.path = to; d.name = path.basename(to);
    } catch {}
  }
  ctx.saveStore();
}

function register(c) {
  ctx = c;
  try { migrate(); } catch {}
  describeSource = c.describeSource || describeSource;
  attach(session.defaultSession, 'default');

  ipcMain.handle('downloads:list', () => history().map(publicItem));
  ipcMain.handle('downloads:folder', () => dir());
  ipcMain.handle('downloads:choose-folder', async () => {
    const r = await dialog.showOpenDialog(ctx.getWin(), { title: 'Choose where Relay saves downloads', properties: ['openDirectory', 'createDirectory'], defaultPath: dir() });
    if (r.canceled || !r.filePaths[0]) return null;
    ctx.getStore().settings.downloadDir = r.filePaths[0];
    ctx.saveStore();
    return r.filePaths[0];
  });
  ipcMain.handle('downloads:open-folder', () => shell.openPath(dir()));
  ipcMain.handle('downloads:open', (_e, id) => { const d = find(id); return d ? shell.openPath(d.path) : 'not found'; });
  ipcMain.handle('downloads:show', (_e, id) => { const d = find(id); if (d) shell.showItemInFolder(d.path); });
  ipcMain.handle('downloads:remove', (_e, id) => {
    const s = ctx.getStore();
    s.downloads = history().filter(d => d.id !== id || active.has(d.id));
    ctx.saveStore();
    return s.downloads.map(publicItem);
  });
  ipcMain.handle('downloads:delete', async (_e, id) => {
    const d = find(id);
    if (d) {
      active.get(id)?.cancel();
      if (fs.existsSync(d.path)) await shell.trashItem(d.path).catch(() => {});
      const s = ctx.getStore();
      s.downloads = history().filter(x => x.id !== id);
      ctx.saveStore();
    }
    return history().map(publicItem);
  });
  ipcMain.handle('downloads:clear', (_e, which = 'all') => {
    const s = ctx.getStore();
    s.downloads = history().filter(d => active.has(d.id) || (which === 'missing' && fs.existsSync(d.path) && d.state === 'completed'));
    ctx.saveStore();
    return s.downloads.map(publicItem);
  });
  ipcMain.handle('downloads:control', (_e, { id, action }) => {
    const item = active.get(id);
    if (!item) return false;
    if (action === 'pause') item.pause();
    if (action === 'resume' && item.canResume()) item.resume();
    if (action === 'cancel') item.cancel();
    return true;
  });
  // Start a download from Relay itself (e.g. the media player's Download button)
  ipcMain.handle('downloads:start', (_e, { url, partition }) => {
    const ses = partition ? session.fromPartition(partition) : session.defaultSession;
    attach(ses, partition || 'default');
    ses.downloadURL(url);
    return true;
  });
}

module.exports = { register, attach, kindOf, dir };
