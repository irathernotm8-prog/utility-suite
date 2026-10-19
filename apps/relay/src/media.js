// Relay — media player & reader back-end:
//  • Reader: opens images, folders of images, comic archives (.cbz/.zip) and PDFs page by page
//  • Player: Chromecast / Google TV casting (local files are served to the TV over your Wi-Fi),
//    AirPlay hand-off via QuickTime Player, and file pickers
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { ipcMain, dialog, shell } = require('electron');

let ctx = null;
const IMG = /\.(jpe?g|png|gif|webp|bmp|avif|svg)$/i;
const MEDIA = /\.(mp4|m4v|mov|webm|mkv|mp3|m4a|aac|wav|flac|ogg|oga|opus)$/i;
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', pdf: 'application/pdf'
};
const mimeOf = (p) => MIME[path.extname(p).slice(1).toLowerCase()] || 'application/octet-stream';
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const send = (ch, d) => { const w = ctx.getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, d); };

/* ---------------- Reader ---------------- */
const books = new Map(); // id -> { kind, file, pages:[{name, path?, entry?}], zip? }

function openZip(file) {
  const yauzl = require('yauzl');
  return new Promise((res, rej) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => {
    if (err) return rej(err);
    const entries = [];
    zip.readEntry();
    zip.on('entry', (e) => { if (!/\/$/.test(e.fileName) && IMG.test(e.fileName) && !/(^|\/)(__MACOSX|\.)/.test(e.fileName)) entries.push(e); zip.readEntry(); });
    zip.on('end', () => res({ zip, entries: entries.sort((a, b) => natural(a.fileName, b.fileName)) }));
    zip.on('error', rej);
  }));
}
function readEntry(zip, entry) {
  return new Promise((res, rej) => zip.openReadStream(entry, (err, s) => {
    if (err) return rej(err);
    const chunks = []; s.on('data', c => chunks.push(c)); s.on('end', () => res(Buffer.concat(chunks))); s.on('error', rej);
  }));
}

async function openBook(target) {
  const id = crypto.randomUUID();
  const st = fs.statSync(target);
  let book;
  if (st.isDirectory()) {
    const pages = fs.readdirSync(target).filter(f => IMG.test(f)).sort(natural).map(f => ({ name: f, path: path.join(target, f) }));
    book = { kind: 'images', file: target, title: path.basename(target), pages, start: 0 };
  } else if (/\.(cbz|zip)$/i.test(target)) {
    const { zip, entries } = await openZip(target);
    book = { kind: 'zip', file: target, title: path.basename(target).replace(/\.(cbz|zip)$/i, ''), zip, pages: entries.map(e => ({ name: path.basename(e.fileName), entry: e })), start: 0 };
  } else if (/\.pdf$/i.test(target)) {
    book = { kind: 'pdf', file: target, title: path.basename(target, '.pdf'), pages: [], start: 0 };
  } else if (IMG.test(target)) {
    // A single image opens with its neighbours in the same folder, so you can flip through them
    const d = path.dirname(target);
    const files = fs.readdirSync(d).filter(f => IMG.test(f)).sort(natural);
    book = { kind: 'images', file: target, title: path.basename(d), pages: files.map(f => ({ name: f, path: path.join(d, f) })), start: Math.max(0, files.indexOf(path.basename(target))) };
  } else if (/\.cbr$/i.test(target)) {
    throw new Error('.cbr (RAR) comics aren’t supported yet — convert to .cbz, or open the folder of pages');
  } else throw new Error('Relay Reader opens images, folders of images, .cbz/.zip comics and PDFs');
  books.set(id, book);
  const progress = (ctx.getStore().readerProgress || {})[book.file];
  return { id, kind: book.kind, title: book.title, file: book.file, pages: book.pages.map(p => p.name), start: progress?.page ?? book.start };
}

function registerReader() {
  ipcMain.handle('reader:open', (_e, target) => openBook(target));
  ipcMain.handle('reader:page', async (_e, { id, index }) => {
    const b = books.get(id);
    const p = b?.pages[index];
    if (!p) return null;
    const data = p.entry ? await readEntry(b.zip, p.entry) : await fs.promises.readFile(p.path);
    return { data, mime: mimeOf(p.name) };
  });
  // Fetch an image from a web page using that account's own session (so signed-in attachments work)
  ipcMain.handle('reader:fetch', async (_e, { url, partition }) => {
    const { session } = require('electron');
    const ses = partition ? session.fromPartition(partition) : session.defaultSession;
    const r = await ses.fetch(url);
    if (!r.ok) throw new Error('Couldn’t load that image (' + r.status + ')');
    return { data: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') || 'image/jpeg' };
  });
  ipcMain.handle('reader:pdf-bytes', async (_e, id) => { const b = books.get(id); return b?.kind === 'pdf' ? fs.promises.readFile(b.file) : null; });
  ipcMain.handle('reader:close', (_e, id) => { const b = books.get(id); try { b?.zip?.close(); } catch {} books.delete(id); });
  ipcMain.handle('reader:progress', (_e, { file, page, total }) => {
    const s = ctx.getStore();
    s.readerProgress = s.readerProgress || {};
    s.readerProgress[file] = { page, total, at: Date.now() };
    ctx.saveStore();
  });
}

/* ---------------- Pickers ---------------- */
function registerPickers() {
  ipcMain.handle('media:pick', async (_e, kind) => {
    const filters = kind === 'reader'
      ? [{ name: 'Comics, images & PDFs', extensions: ['cbz', 'zip', 'pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'] }]
      : [{ name: 'Video & audio', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'] }];
    const props = kind === 'reader' ? ['openFile', 'openDirectory'] : ['openFile', 'multiSelections'];
    const r = await dialog.showOpenDialog(ctx.getWin(), { title: kind === 'reader' ? 'Open in Relay Reader' : 'Open in Relay Player', properties: props, filters, defaultPath: ctx.downloadsDir() });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('media:stat', (_e, p) => { try { const s = fs.statSync(p); return { exists: true, dir: s.isDirectory(), size: s.size, mime: mimeOf(p) }; } catch { return { exists: false }; } });
}

/* ---------------- AirPlay ---------------- */
// Chromium (and so Electron) has no built-in AirPlay picker. On a Mac we hand the file to
// QuickTime Player, which has the AirPlay button; for speakers, macOS's sound output works system-wide.
function registerAirPlay() {
  ipcMain.handle('media:airplay', async (_e, src) => {
    if (process.platform !== 'darwin') return { ok: false, reason: 'AirPlay is only available on a Mac' };
    if (!src || /^https?:/.test(src)) return { ok: false, reason: 'Download the file first — AirPlay hand-off works with files on your Mac' };
    return new Promise((res) => execFile('open', ['-a', 'QuickTime Player', src], (err) => res(err ? { ok: false, reason: err.message } : { ok: true })));
  });
  ipcMain.handle('media:sound-output', () => shell.openExternal('x-apple.systempreferences:com.apple.Sound-Settings.extension'));
}

/* ---------------- Chromecast ---------------- */
let server = null, serverPort = 0;
const served = new Map(); // token -> file path

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal && !/^169\.254\./.test(i.address)) return i.address;
  }
  return '127.0.0.1';
}
// Tiny HTTP server (with Range support so the TV can seek) that only serves files you chose to cast
function ensureServer() {
  if (server) return Promise.resolve(serverPort);
  return new Promise((res) => {
    server = http.createServer((req, resp) => {
      const token = (req.url.split('/')[1] || '');
      const file = served.get(token);
      if (!file || !fs.existsSync(file)) { resp.writeHead(404); return resp.end(); }
      const size = fs.statSync(file).size;
      const headers = { 'Content-Type': mimeOf(file), 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (m) {
        const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], size - 1) : size - 1;
        resp.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
        if (req.method === 'HEAD') return resp.end();
        fs.createReadStream(file, { start, end }).pipe(resp);
      } else {
        resp.writeHead(200, { ...headers, 'Content-Length': size });
        if (req.method === 'HEAD') return resp.end();
        fs.createReadStream(file).pipe(resp);
      }
    });
    server.listen(0, '0.0.0.0', () => { serverPort = server.address().port; res(serverPort); });
  });
}

function discover(ms = 2500) {
  return new Promise((resolve) => {
    let mdns;
    try { mdns = require('multicast-dns')(); } catch { return resolve([]); }
    const devices = new Map();
    const pending = {};
    mdns.on('error', () => {});
    mdns.on('warning', () => {});
    mdns.on('response', (r) => {
      const all = [...(r.answers || []), ...(r.additionals || [])];
      const name = {}, target = {}, port = {}, addr = {};
      for (const a of all) {
        if (a.type === 'TXT' && /_googlecast/.test(a.name)) {
          const txt = (Array.isArray(a.data) ? a.data : [a.data]).map(b => b.toString());
          const fn = txt.find(t => t.startsWith('fn='));
          const id = txt.find(t => t.startsWith('id='));
          name[a.name] = { fn: fn ? fn.slice(3) : null, id: id ? id.slice(3) : a.name };
        }
        if (a.type === 'SRV' && /_googlecast/.test(a.name)) { target[a.name] = a.data.target; port[a.name] = a.data.port; }
        if (a.type === 'A') addr[a.name] = a.data;
      }
      for (const svc of Object.keys(target)) {
        const host = addr[target[svc]] || pending[target[svc]];
        const n = name[svc] || {};
        if (host) devices.set(n.id || svc, { id: n.id || svc, name: n.fn || svc.split('.')[0], host, port: port[svc] || 8009 });
      }
      for (const [k, v] of Object.entries(addr)) pending[k] = v;
    });
    mdns.query({ questions: [{ name: '_googlecast._tcp.local', type: 'PTR' }] });
    setTimeout(() => mdns.query({ questions: [{ name: '_googlecast._tcp.local', type: 'PTR' }] }), 800);
    setTimeout(() => { try { mdns.destroy(); } catch {} resolve([...devices.values()]); }, ms);
  });
}

let cast = null; // { client, player, device }
function stopCast() {
  if (!cast) return;
  try { cast.player?.stop(() => {}); } catch {}
  try { cast.client?.close(); } catch {}
  cast = null;
}

function registerCast() {
  let lastDevices = [];
  ipcMain.handle('cast:discover', async () => (lastDevices = await discover()));
  ipcMain.handle('cast:play', async (_e, { deviceId, src, title, currentTime = 0 }) => {
    const device = lastDevices.find(d => d.id === deviceId);
    if (!device) throw new Error('That device isn’t available any more — search again');
    let url = src, contentType = mimeOf(src.split('?')[0]);
    if (!/^https?:/.test(src)) {
      const port = await ensureServer();
      const token = crypto.randomBytes(12).toString('hex');
      served.set(token, src);
      url = `http://${lanAddress()}:${port}/${token}/${encodeURIComponent(path.basename(src))}`;
    }
    stopCast();
    const { Client, DefaultMediaReceiver } = require('castv2-client');
    return new Promise((resolve, reject) => {
      const client = new Client();
      client.on('error', (err) => { send('cast:status', { state: 'error', message: err.message }); stopCast(); });
      client.connect({ host: device.host, port: device.port }, () => {
        client.launch(DefaultMediaReceiver, (err, player) => {
          if (err) { reject(err); return; }
          cast = { client, player, device };
          player.on('status', (s) => send('cast:status', { state: (s.playerState || '').toLowerCase(), currentTime: s.currentTime, device: device.name }));
          player.load({ contentId: url, contentType, streamType: 'BUFFERED', metadata: { type: 0, metadataType: 0, title: title || path.basename(src) } },
            { autoplay: true, currentTime }, (e2) => e2 ? reject(e2) : resolve({ ok: true, device: device.name }));
        });
      });
    });
  });
  ipcMain.handle('cast:control', (_e, { action, value }) => {
    if (!cast?.player) return false;
    const p = cast.player;
    if (action === 'play') p.play(() => {});
    if (action === 'pause') p.pause(() => {});
    if (action === 'seek') p.seek(value, () => {});
    if (action === 'stop') stopCast();
    return true;
  });
}

function register(c) {
  ctx = c;
  registerReader();
  registerPickers();
  registerAirPlay();
  registerCast();
}

module.exports = { register, stopCast };
