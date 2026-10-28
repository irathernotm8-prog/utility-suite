// Vantage — downloads.
// Big files that the server lets us fetch in parts download over several connections at once (8 by default,
// up to 16), like a download accelerator: each part has its own connection, a finished connection takes over
// half of the biggest part still left, and the parts are written straight into place. Progress is saved, so
// a paused or interrupted download picks up where it stopped, even after quitting Vantage.
// Anything that can't be split (no byte ranges, small files, streams) uses Chromium's own downloader.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, ipcMain, shell, dialog, net, session } = require('electron');

let store = null, getWin = () => null, notifyAll = () => {};
const MIN_FAST = 2 * 1024 * 1024;     // smaller files aren't worth splitting
const MIN_SPLIT = 1024 * 1024;        // never split a part below this
const jobs = new Map();               // id -> FastJob
const natives = new Map();            // id -> DownloadItem
const sessionsByPart = new Map();     // partition -> session
const partOf = new WeakMap();         // session -> partition
const bypass = new Set();             // urls that must use the native downloader

const KIND = {
  video: /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpg|mpeg|3gp)$/i,
  audio: /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|aiff?|wma)$/i,
  image: /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif|tiff?|svg)$/i,
  comic: /\.(cbz|cbr|cb7)$/i,
  pdf: /\.pdf$/i,
  archive: /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|dmg|pkg|iso|exe|msi)$/i,
  doc: /\.(docx?|xlsx?|pptx?|pages|numbers|key|txt|rtf|csv|md|odt|ods|odp|json|xml|html?)$/i
};
const kindOf = (name) => { for (const [k, re] of Object.entries(KIND)) if (re.test(name)) return k; return 'other'; };
const settings = () => store.settings();
const history = () => store.get().downloads;
function dir() {
  const d = settings().downloadDir || app.getPath('downloads');
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}
function publicItem(d) {
  return { id: d.id, name: d.name, path: d.path, url: d.url, kind: d.kind, total: d.total, received: d.received, state: d.state,
    startedAt: d.startedAt, doneAt: d.doneAt, speed: d.speed || 0, connections: d.connections || 0, engine: d.engine,
    error: d.error || '', pageUrl: d.pageUrl || '', private: !!d.private,
    exists: d.state === 'completed' ? fs.existsSync(d.path) : true };
}
function sendUpdate(rec) { notifyAll('downloads:update', publicItem(rec)); }
function uniquePath(d, name) {
  name = String(name || 'download').replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '') || 'download';
  const ext = path.extname(name), base = path.basename(name, ext);
  let target = path.join(d, name), n = 1;
  const taken = (p) => fs.existsSync(p) || fs.existsSync(p + '.vdownload') || history().some(x => x.path === p && ['progressing', 'paused'].includes(x.state));
  while (taken(target)) target = path.join(d, `${base} (${n++})${ext}`);
  return target;
}

/* ---------------- multi-connection engine ---------------- */
function probe(ses, url, headers) {
  return new Promise((resolve) => {
    let finalUrl = url, done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(t); try { req.abort(); } catch {} resolve(v); } };
    // no-store: skip Chromium's cache, which would otherwise make this wait behind the paused download of the same URL
    const req = net.request({ url, session: ses, useSessionCookies: true, redirect: 'manual', cache: 'no-store' });
    for (const [k, v] of Object.entries(headers)) if (v) req.setHeader(k, v);
    req.setHeader('Range', 'bytes=0-0');
    req.setHeader('Accept-Encoding', 'identity');
    req.on('redirect', (_status, _method, redirectUrl) => { finalUrl = redirectUrl; req.followRedirect(); });
    req.on('response', (res) => {
      const cr = String(res.headers['content-range'] || '');
      const m = /\/(\d+)\s*$/.exec(cr);
      const enc = String(res.headers['content-encoding'] || 'identity');
      if (res.statusCode === 206 && m && enc === 'identity') finish({ ok: true, total: Number(m[1]), url: finalUrl, etag: res.headers.etag || '' });
      else finish({ ok: false });
    });
    req.on('error', () => finish({ ok: false }));
    const t = setTimeout(() => finish({ ok: false }), 8000);
    req.end();
  });
}

class FastJob {
  constructor(rec, ses) {
    this.rec = rec; this.ses = ses; this.reqs = new Set(); this.pending = 0; this.paused = false; this.failed = false;
    this.lastBytes = rec.received; this.lastT = Date.now(); this.speed = 0;
    this.limit = Math.min(16, settings().downloadConnections || 8); this.waiting = [];
  }
  temp() { return this.rec.path + '.vdownload'; }
  // (no Referer: Chromium refuses requests whose referrer it didn't set itself; cookies come from the session)
  headers() { return { 'User-Agent': this.ses.getUserAgent() }; }
  start() {
    const r = this.rec;
    const fresh = !fs.existsSync(this.temp());
    if (fresh && r.received > 0) { r.received = 0; r.segments = null; }
    this.fd = fs.openSync(this.temp(), fresh ? 'w' : 'r+');
    if (fresh) fs.ftruncateSync(this.fd, r.total);
    if (!r.segments || !r.segments.length) {
      const n = Math.max(1, Math.min(16, settings().downloadConnections || 8, Math.floor(r.total / MIN_SPLIT) || 1));
      const size = Math.ceil(r.total / n);
      r.segments = [];
      for (let i = 0; i < n; i++) { const s = i * size, e = Math.min(r.total - 1, s + size - 1); if (s <= e) r.segments.push({ s, e, p: s }); }
    }
    r.state = 'progressing'; r.error = ''; this.paused = false;
    this.waiting = [];
    for (const seg of r.segments) if (seg.p <= seg.e) { if (this.active() < this.limit) this.run(seg, 0); else this.waiting.push(seg); }
    this.tick = setInterval(() => this.progress(), 400);
    this.saver = setInterval(() => store.save(), 2000);
    sendUpdate(r);
  }
  active() { return [...this.reqs].length; }
  run(seg, attempt) {
    if (this.paused || this.failed || seg.p > seg.e) return;
    seg.busy = true;
    const req = net.request({ url: this.rec.fastUrl || this.rec.url, session: this.ses, useSessionCookies: true, cache: 'no-store' });
    for (const [k, v] of Object.entries(this.headers())) if (v) req.setHeader(k, v);
    req.setHeader('Range', `bytes=${seg.p}-${seg.e}`);
    req.setHeader('Accept-Encoding', 'identity');
    this.reqs.add(req);
    let finished = false;
    const end = (err) => {
      if (finished) return; finished = true;
      this.reqs.delete(req); seg.busy = false;
      if (this.paused || this.failed) return this.maybeDone();
      if (seg.p <= seg.e && !seg.parked) {
        if (attempt >= 6) return this.fail(err ? err.message : 'The server stopped sending this file');
        return setTimeout(() => this.run(seg, attempt + 1), 600 * (attempt + 1));
      }
      this.next();
      this.maybeDone();
    };
    req.on('response', (res) => {
      if ((res.statusCode === 429 || res.statusCode === 503) && attempt < 8) {
        // the server limits how many connections one download may use: use fewer and queue this part
        res.on('data', () => {}); req.abort();
        this.limit = Math.max(1, Math.min(this.limit, this.active()));
        seg.parked = true; finished = true; this.reqs.delete(req); seg.busy = false;
        if (this.active() > 0) { this.waiting.push(seg); return; }
        seg.parked = false;
        return setTimeout(() => this.run(seg, attempt + 1), 1500 * (attempt + 1));
      }
      if (res.statusCode !== 206) {
        // the server stopped honouring ranges (or the link expired): hand back to Chromium
        res.on('data', () => {}); req.abort();
        if (res.statusCode === 200 && seg.p === 0 && this.rec.segments.length === 1) return this.fail('', true);
        return this.fail(res.statusCode >= 400 ? `The server answered ${res.statusCode}` : '', res.statusCode < 400);
      }
      res.on('data', (chunk) => {
        if (this.paused || this.failed) return;
        let buf = chunk;
        const room = seg.e - seg.p + 1;
        if (room <= 0) { try { req.abort(); } catch {} return end(); }
        if (buf.length > room) buf = buf.subarray(0, room);
        const pos = seg.p;
        seg.p += buf.length;
        this.rec.received += buf.length;
        this.pending++;
        if (this.pending > 96) res.pause?.();
        fs.write(this.fd, buf, 0, buf.length, pos, (e) => {
          this.pending--;
          if (e) this.fail('Couldn’t write to disk: ' + e.message);
          if (this.pending < 32) res.resume?.();
          this.maybeDone();
        });
        if (seg.p > seg.e) { try { req.abort(); } catch {} end(); }
      });
      res.on('end', () => end());
      res.on('error', (e) => end(e));
      res.on('aborted', () => end());
    });
    req.on('error', (e) => end(e));
    req.end();
  }
  // a free connection picks up a queued part, or takes over half of the biggest part still to come
  next() {
    while (this.waiting.length && this.active() < this.limit) { const seg = this.waiting.shift(); seg.parked = false; this.run(seg, 0); }
    this.steal();
  }
  steal() {
    if (this.waiting.length || this.active() >= this.limit) return;
    let big = null;
    for (const s of this.rec.segments) if (s.busy && s.e - s.p > 2 * MIN_SPLIT && (!big || s.e - s.p > big.e - big.p)) big = s;
    if (!big) return;
    const mid = big.p + Math.floor((big.e - big.p) / 2);
    const seg = { s: mid + 1, e: big.e, p: mid + 1 };
    big.e = mid;
    this.rec.segments.push(seg);
    this.run(seg, 0);
  }
  progress() {
    const now = Date.now(), dt = (now - this.lastT) / 1000;
    if (dt > 0) {
      const inst = (this.rec.received - this.lastBytes) / dt;
      this.speed = this.speed ? this.speed * 0.7 + inst * 0.3 : inst;
      this.lastBytes = this.rec.received; this.lastT = now;
    }
    this.rec.speed = Math.round(this.speed);
    this.rec.connections = this.active();
    sendUpdate(this.rec);
  }
  stopTimers() { clearInterval(this.tick); clearInterval(this.saver); }
  pause() {
    this.paused = true;
    for (const r of this.reqs) try { r.abort(); } catch {}
    this.reqs.clear();
    this.rec.segments.forEach(s => { s.busy = false; });
    this.stopTimers();
    this.rec.state = 'paused'; this.rec.speed = 0; this.rec.connections = 0;
    this.closeWhenIdle();
    store.save(); sendUpdate(this.rec);
  }
  closeWhenIdle(cb) {
    const wait = () => { if (this.pending > 0) return setTimeout(wait, 50); try { fs.closeSync(this.fd); } catch {} this.fd = null; cb && cb(); };
    wait();
  }
  cancel() {
    this.paused = true;
    for (const r of this.reqs) try { r.abort(); } catch {}
    this.stopTimers();
    this.closeWhenIdle(() => { try { fs.unlinkSync(this.temp()); } catch {} });
    this.rec.state = 'cancelled'; this.rec.speed = 0; this.rec.doneAt = Date.now();
    jobs.delete(this.rec.id); store.save(); sendUpdate(this.rec);
  }
  fail(msg, fallback = false) {
    if (this.failed) return;
    this.failed = true;
    for (const r of this.reqs) try { r.abort(); } catch {}
    this.stopTimers();
    const rec = this.rec;
    jobs.delete(rec.id);
    this.closeWhenIdle(() => {
      if (fallback) {
        try { fs.unlinkSync(this.temp()); } catch {}
        rec.state = 'replaced'; store.save();
        history().splice(history().indexOf(rec), 1);
        notifyAll('downloads:removed', rec.id);
        bypass.add(rec.url);
        this.ses.downloadURL(rec.url);
      } else {
        rec.state = 'interrupted'; rec.error = msg; rec.speed = 0; store.save(); sendUpdate(rec);
      }
    });
  }
  maybeDone() {
    if (this.paused || this.failed || this.finishing) return;
    if (this.pending > 0 || this.reqs.size) return;
    if (this.waiting.length || !this.rec.segments.every(s => s.p > s.e)) return;
    this.finishing = true;
    this.stopTimers();
    try { fs.closeSync(this.fd); } catch {}
    const rec = this.rec;
    let target = rec.path;
    if (fs.existsSync(target)) target = uniquePath(path.dirname(target), path.basename(target));
    try { fs.renameSync(this.temp(), target); } catch (e) { rec.state = 'interrupted'; rec.error = e.message; jobs.delete(rec.id); store.save(); return sendUpdate(rec); }
    rec.path = target; rec.name = path.basename(target);
    rec.state = 'completed'; rec.doneAt = Date.now(); rec.speed = 0; rec.connections = 0; rec.segments = null;
    rec.avgSpeed = Math.round(rec.total / Math.max(1, (rec.doneAt - rec.startedAt) / 1000));
    jobs.delete(rec.id);
    store.save(); sendUpdate(rec);
    notifyAll('download:done', { id: rec.id, name: rec.name, path: rec.path, state: 'completed' });
  }
}

/* ---------------- Chromium's own downloader ---------------- */
function trackNative(rec, item) {
  natives.set(rec.id, item);
  rec.engine = 'native';
  let last = 0, lastBytes = 0, lastT = Date.now();
  item.on('updated', (_e, state) => {
    rec.received = item.getReceivedBytes(); rec.total = item.getTotalBytes();
    rec.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing';
    const now = Date.now();
    if (now - last > 400) {
      rec.speed = Math.round((rec.received - lastBytes) / Math.max(0.001, (now - lastT) / 1000));
      lastBytes = rec.received; lastT = now; last = now; rec.connections = 1;
      sendUpdate(rec);
    }
  });
  item.once('done', (_e, state) => {
    natives.delete(rec.id);
    rec.received = item.getReceivedBytes(); rec.total = item.getTotalBytes() || rec.received;
    rec.path = item.getSavePath(); rec.name = path.basename(rec.path);
    rec.state = state; rec.doneAt = Date.now(); rec.speed = 0; rec.connections = 0;
    store.save(); sendUpdate(rec);
    if (state === 'completed') notifyAll('download:done', { id: rec.id, name: rec.name, path: rec.path, state });
  });
}

function attach(ses, partition, { isPrivate = false } = {}) {
  sessionsByPart.set(partition, ses);
  partOf.set(ses, partition);
  if (ses.__vantageDownloads) return;
  ses.__vantageDownloads = true;
  ses.on('will-download', (_e, item, wc) => {
    const url = item.getURL();
    const id = crypto.randomUUID();
    let target;
    if (settings().askWhereToSave) {
      const p = dialog.showSaveDialogSync(getWin(), { defaultPath: path.join(dir(), item.getFilename()) });
      if (!p) { item.cancel(); return; }
      target = p;
    } else target = uniquePath(dir(), item.getFilename());
    item.setSavePath(target);
    let pageUrl = '';
    try { pageUrl = wc && !wc.isDestroyed() ? wc.getURL() : ''; } catch {}
    const rec = {
      id, name: path.basename(target), path: target, url, kind: kindOf(target), total: item.getTotalBytes(), received: 0,
      state: 'progressing', startedAt: Date.now(), doneAt: null, partition, pageUrl, private: isPrivate, engine: 'native'
    };
    history().unshift(rec);
    if (history().length > 2000) history().length = 2000;
    store.save();
    notifyAll('download:started', { id, name: rec.name, wcId: wc && !wc.isDestroyed() ? wc.id : null });
    sendUpdate(rec);
    const tryFast = settings().fastDownloads !== false && /^https?:/i.test(url) && !bypass.has(url) && (item.getTotalBytes() === 0 || item.getTotalBytes() >= MIN_FAST);
    if (bypass.has(url)) bypass.delete(url);
    if (process.env.VANTAGE_DEBUG) console.log('[dl]', { tryFast, total: item.getTotalBytes(), url });
    if (!tryFast) return trackNative(rec, item);
    item.pause();
    probe(ses, url, { 'User-Agent': ses.getUserAgent() }).then((p) => {
      if (process.env.VANTAGE_DEBUG) console.log('[dl] probe', p.ok, p.total);
      if (!p.ok || p.total < MIN_FAST) { item.resume(); return trackNative(rec, item); }
      item.cancel();
      rec.engine = 'fast'; rec.total = p.total; rec.fastUrl = p.url; rec.received = 0; rec.segments = null;
      const job = new FastJob(rec, ses);
      jobs.set(id, job);
      try { job.start(); } catch (e) { jobs.delete(id); rec.state = 'interrupted'; rec.error = e.message; sendUpdate(rec); }
    });
  });
}

function find(id) { return history().find(d => d.id === id); }
function control(id, action) {
  const rec = find(id);
  if (!rec) return false;
  const job = jobs.get(id), item = natives.get(id);
  if (action === 'pause') { if (job) job.pause(); else if (item) item.pause(); }
  if (action === 'resume') {
    if (item && item.canResume()) item.resume();
    else if (rec.engine === 'fast' && ['paused', 'interrupted'].includes(rec.state)) {
      const ses = sessionsByPart.get(rec.partition) || session.fromPartition(rec.partition || 'persist:vantage');
      const j = jobs.get(id) || new FastJob(rec, ses);
      j.failed = false; j.finishing = false; jobs.set(id, j);
      try { j.start(); } catch (e) { rec.state = 'interrupted'; rec.error = e.message; sendUpdate(rec); }
    } else return control(id, 'retry');
  }
  if (action === 'cancel') { if (job) job.cancel(); else if (item) item.cancel(); else if (rec.engine === 'fast') { try { fs.unlinkSync(rec.path + '.vdownload'); } catch {} rec.state = 'cancelled'; sendUpdate(rec); } }
  if (action === 'retry') {
    const ses = sessionsByPart.get(rec.partition) || session.fromPartition(rec.partition || 'persist:vantage');
    history().splice(history().indexOf(rec), 1);
    notifyAll('downloads:removed', rec.id);
    try { fs.unlinkSync(rec.path + '.vdownload'); } catch {}
    ses.downloadURL(rec.url);
  }
  store.save();
  return true;
}

function register(ctx) {
  store = ctx.store; getWin = ctx.getWin; notifyAll = ctx.notifyAll;
  // after a restart, unfinished fast downloads wait to be resumed; Chromium's own ones can only start over
  for (const d of history()) if (d.state === 'progressing') { d.state = d.engine === 'fast' && fs.existsSync(d.path + '.vdownload') ? 'paused' : 'interrupted'; d.speed = 0; d.connections = 0; }
  store.save();

  ipcMain.handle('downloads:list', () => history().filter(d => d.state !== 'replaced').map(publicItem));
  ipcMain.handle('downloads:folder', () => dir());
  ipcMain.handle('downloads:choose-folder', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Choose where Vantage saves downloads', properties: ['openDirectory', 'createDirectory'], defaultPath: dir() });
    if (r.canceled || !r.filePaths[0]) return null;
    settings().downloadDir = r.filePaths[0]; store.save();
    return r.filePaths[0];
  });
  ipcMain.handle('downloads:open-folder', () => shell.openPath(dir()));
  ipcMain.handle('downloads:open', (_e, id) => { const d = find(id); return d ? shell.openPath(d.path) : 'not found'; });
  ipcMain.handle('downloads:show', (_e, id) => { const d = find(id); if (d) shell.showItemInFolder(fs.existsSync(d.path) ? d.path : path.dirname(d.path)); });
  ipcMain.handle('downloads:remove', (_e, id) => {
    const s = store.get();
    s.downloads = history().filter(d => d.id !== id || jobs.has(d.id) || natives.has(d.id));
    store.save();
    return s.downloads.map(publicItem);
  });
  ipcMain.handle('downloads:delete', async (_e, id) => {
    const d = find(id);
    if (d) {
      control(id, 'cancel');
      if (fs.existsSync(d.path)) await shell.trashItem(d.path).catch(() => {});
      store.get().downloads = history().filter(x => x.id !== id);
      store.save();
    }
    return history().map(publicItem);
  });
  ipcMain.handle('downloads:clear', () => {
    const s = store.get();
    s.downloads = history().filter(d => jobs.has(d.id) || natives.has(d.id) || d.state === 'paused');
    store.save();
    return s.downloads.map(publicItem);
  });
  ipcMain.handle('downloads:control', (_e, { id, action }) => control(id, action));
  ipcMain.handle('downloads:start', (_e, { url, partition }) => {
    const ses = sessionsByPart.get(partition) || session.fromPartition(partition || 'persist:vantage');
    ses.downloadURL(url);
    return true;
  });
}

function pauseAll() { for (const j of jobs.values()) try { j.pause(); } catch {} }
function activeCount() { return jobs.size + natives.size; }

module.exports = { register, attach, dir, kindOf, pauseAll, activeCount, _test: { probe, FastJob, uniquePath } };
