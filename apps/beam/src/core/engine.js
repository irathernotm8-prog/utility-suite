'use strict';
// The transfer engine: one small HTTP server for incoming transfers (and the phone page), discovery,
// and the sender. Runs in Electron's main process, or plain Node for the tests.
//
// A transfer, start to finish:
//   1. sender → POST /v1/offer    the file list (sealed); the receiver asks its user, or accepts at once for a trusted device
//   2. both sides build the same plan (files.plan): big files cut into segments, small ones packed together
//   3. sender → PUT /v1/put?k=N    one request per job, several at a time over kept-alive connections;
//                                  each body is an encrypted frame stream; the receiver writes straight to disk at the right offsets
//   4. sender → POST /v1/finish   the receiver checks every job arrived, sets dates, and moves everything into the receive folder
// A job that fails (Wi-Fi blip, laptop lid) is retried; a transfer that fails can be retried later and
// only the missing jobs are sent again, as long as the receiver still has them (an hour).
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Writable, pipeline } = require('stream');
const { promisify } = require('util');
const pipe = promisify(pipeline);

const C = require('./crypto');
const F = require('./files');
const { Discovery, interfaces } = require('./discovery');
const { Phone } = require('./phone');

const PORT = 47821;
const PLAN = { seg: 32 << 20, small: 1 << 20, batch: 16 << 20, batchCount: 1000 };
const ASK_TIMEOUT = 120000;
const KEEP_PARTIAL = 3600000;
const RETRY = [400, 1000, 2000, 4000, 8000, 8000];
const HISTORY_MAX = 400;

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const rid = () => crypto.randomBytes(9).toString('base64url');

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

class Engine extends EventEmitter {
  constructor(o) {
    super();
    this.dataDir = o.dataDir;
    this.identity = o.identity;           // { id, priv, pub }
    this.settings = o.settings;           // () => current settings object
    this.saveSettings = o.saveSettings || (() => {});
    this.port = o.port || PORT;
    this.platform = o.platform || { os: process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux', dev: 'laptop' };
    this.version = o.version || '0.1.0';
    this.discoveryOpts = o.discovery === false ? null : (o.discovery || {});
    this.phoneHtml = o.phoneHtml;
    this.iconPath = o.iconPath;
    this.retryDelays = o.retry || RETRY;
    this.transfers = new Map();           // tid → live transfer (both directions)
    this.history = [];
    this.historyFile = path.join(this.dataDir, 'history.json');
    this.manual = new Map();              // id → peer found through a typed address
  }

  // ── lifecycle
  async start() {
    await fsp.mkdir(this.dataDir, { recursive: true });
    try { this.history = JSON.parse(await fsp.readFile(this.historyFile, 'utf8')); } catch { this.history = []; }
    this.server = http.createServer((q, s) => this.route(q, s).catch((e) => this.fail(s, e)));
    this.server.keepAliveTimeout = 30000;
    this.server.headersTimeout = 30000;
    this.server.requestTimeout = 0;
    this.server.on('connection', (sock) => { sock.setNoDelay(true); });
    this.port = await this.listen(this.port);
    this.phone = new Phone(this);
    if (this.discoveryOpts) {
      this.disc = new Discovery({ me: () => this.me(), extraTargets: () => (this.settings().saved || []).map(a => a.split(':')[0]), ...this.discoveryOpts });
      this.disc.on('peer', () => this.emitPeers());
      this.disc.on('lost', () => this.emitPeers());
      this.disc.on('warn', (m) => this.emit('warn', m));
      await this.disc.start();
    }
    this.probeTimer = setInterval(() => this.probeSaved(), 10000);
    this.probeSaved();
    this.watchdog = setInterval(() => this.watch(), 5000);
    this.cleanIncoming().catch(() => {});
    return this;
  }

  async stop() {
    clearInterval(this.probeTimer); clearInterval(this.watchdog);
    for (const t of this.transfers.values()) if (t.dir === 'out' && t.abort) t.abort.abort();
    if (this.disc) this.disc.stop();
    await new Promise(r => { this.server.close(() => r()); this.server.closeAllConnections && this.server.closeAllConnections(); setTimeout(r, 300); });
    await this.saveHistory();
  }

  listen(port) {
    return new Promise((resolve, reject) => {
      const tryPort = (p, left) => {
        const onErr = (e) => {
          this.server.off('listening', onOk);
          if (e.code === 'EADDRINUSE' && left > 0) tryPort(left === 1 ? 0 : p + 1, left - 1); else reject(e);
        };
        const onOk = () => { this.server.off('error', onErr); resolve(this.server.address().port); };
        this.server.once('error', onErr); this.server.once('listening', onOk);
        this.server.listen(p, '0.0.0.0');
      };
      tryPort(port, 10);
    });
  }

  me() {
    const s = this.settings();
    return { id: this.identity.id, name: s.name, os: this.platform.os, dev: this.platform.dev, port: this.port, pub: this.identity.pub, ver: this.version, visible: s.receive !== 'off' };
  }

  // ── devices
  trusted(id, pub) {
    const t = (this.settings().trusted || []).find(x => x.id === id);
    return !!t && (!pub || t.pub === pub);
  }

  peerList() {
    const seen = new Map();
    for (const p of (this.disc ? this.disc.list() : [])) seen.set(p.id, p);
    for (const p of this.manual.values()) if (!seen.has(p.id) && Date.now() - p.seen < 30000) seen.set(p.id, p);
    return [...seen.values()].map(p => ({
      id: p.id, name: p.name, os: p.os, dev: p.dev, address: p.address, port: p.port, via: p.via,
      trusted: this.trusted(p.id, p.pub), keyChanged: this.trusted(p.id) && !this.trusted(p.id, p.pub),
      code: C.safetyCode(this.identity.pub, p.pub),
    }));
  }
  emitPeers() { clearTimeout(this._pt); this._pt = setTimeout(() => this.emit('peers', this.peerList()), 60); }

  peer(id) {
    const p = (this.disc && this.disc.get(id)) || this.manual.get(id);
    if (!p) throw new Error('That device isn’t nearby right now.');
    return p;
  }

  // a typed address: "192.168.1.20", "192.168.1.20:47821" or a host name
  async addAddress(text) {
    let s = String(text || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!s) throw new Error('Type the other computer’s address.');
    let [host, port] = s.split(':'); port = Number(port) || PORT;
    const info = await this.hello(host, port).catch(() => { throw new Error(`Couldn’t reach Beam at ${host}:${port}. Check the address and that Beam is open there.`); });
    if (info.id === this.identity.id) throw new Error('That’s this computer.');
    const key = `${host}:${port}`;
    const st = this.settings();
    st.saved = [...new Set([...(st.saved || []), key])];
    this.saveSettings();
    this.seeManual(info, host);
    return { id: info.id, name: info.name };
  }
  removeAddress(key) { const st = this.settings(); st.saved = (st.saved || []).filter(x => x !== key); this.saveSettings(); }

  seeManual(info, host) {
    if (this.disc) this.disc.see(info, host, 'saved');
    else { this.manual.set(info.id, { ...info, address: host, via: 'saved', seen: Date.now(), addrs: new Map() }); this.emitPeers(); }
  }

  hello(host, port) {
    return new Promise((resolve, reject) => {
      const req = http.get({ host, port, path: '/v1/hello', timeout: 2500 }, (res) => {
        readBody(res, 65536).then(b => {
          try { const j = JSON.parse(b.toString()); if (!j.id || !C.validPub(j.pub)) throw new Error('not Beam'); resolve(j); } catch (e) { reject(e); }
        }, reject);
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
    });
  }

  probeSaved() {
    for (const a of (this.settings().saved || [])) {
      const [h, p] = a.split(':');
      this.hello(h, Number(p) || PORT).then(info => { if (info.id !== this.identity.id) this.seeManual(info, h); }, () => {});
    }
  }

  // ── trust
  setTrust(id, on) {
    const st = this.settings();
    st.trusted = (st.trusted || []).filter(x => x.id !== id);
    if (on) {
      const p = (this.disc && this.disc.get(id)) || this.manual.get(id) || [...this.transfers.values()].map(t => t.peer).find(x => x.id === id);
      if (!p || !p.pub) throw new Error('That device isn’t nearby right now.');
      st.trusted.push({ id, name: p.name, pub: p.pub, os: p.os, dev: p.dev, added: Date.now() });
    }
    this.saveSettings();
    this.emitPeers();
  }

  // ── transfers (shared)
  snap(t) {
    return {
      tid: t.tid, dir: t.dir, kind: t.kind, phone: !!t.phone,
      peer: { id: t.peer.id, name: t.peer.name, os: t.peer.os, dev: t.peer.dev },
      count: t.count, total: t.total, names: t.names, tops: t.tops, text: t.kind === 'text' ? t.text : undefined,
      status: t.status, bytes: Math.max(0, t.bytes || 0), speed: t.speed || 0, error: t.error, note: t.note,
      started: t.started, ended: t.ended, saved: t.saved, avg: t.avg, retryable: t.dir === 'out' && t.status === 'failed' && !!t.items,
    };
  }
  list() { return [...this.transfers.values()].map(t => this.snap(t)); }

  update(t, now) {
    const tick = () => { t._u = null; t._last = Date.now(); this.emit('transfer', this.snap(t)); };
    if (now) { clearTimeout(t._u); return tick(); }
    if (t._u) return;
    const due = Math.max(0, 200 - (Date.now() - (t._last || 0)));
    t._u = setTimeout(tick, due);
  }

  meter(t) {
    t.samples = [[Date.now(), t.bytes]];
    t.meterTimer = setInterval(() => {
      const now = Date.now();
      t.samples.push([now, t.bytes]);
      while (t.samples.length > 2 && now - t.samples[0][0] > 3000) t.samples.shift();
      const [t0, b0] = t.samples[0];
      t.speed = now > t0 ? Math.max(0, (t.bytes - b0) / ((now - t0) / 1000)) : 0;
      if (t.bytes !== t._lastBytes) { t._lastBytes = t.bytes; t.lastData = now; }
      this.update(t);
    }, 500);
  }

  finishT(t, status, extra = {}) {
    clearInterval(t.meterTimer);
    Object.assign(t, extra, { status, ended: Date.now(), speed: 0 });
    if (status === 'done' && t.total && t.activeSince) t.avg = t.total / Math.max(0.001, (t.ended - t.activeSince) / 1000);
    this.update(t, true);
    const h = this.snap(t);
    this.history = [h, ...this.history.filter(x => x.tid !== t.tid)].slice(0, HISTORY_MAX);
    this.saveHistory();
    this.emit('history', this.history);
    const keepIn = t.dir === 'in' && (status === 'failed' || status === 'interrupted');
    const keepOut = t.dir === 'out' && status === 'failed';
    if (!keepIn && !keepOut) setTimeout(() => { if (this.transfers.get(t.tid) === t && t.status === status) this.transfers.delete(t.tid); this.emit('transfers', this.list()); }, 4000);
  }

  saveHistory() {
    clearTimeout(this._hs);
    return new Promise(r => { this._hs = setTimeout(() => { fsp.writeFile(this.historyFile, JSON.stringify(this.history)).catch(() => {}).then(r); }, 300); });
  }
  clearHistory() { this.history = []; this.saveHistory(); this.emit('history', this.history); }
  removeHistory(tid) { this.history = this.history.filter(h => h.tid !== tid); this.saveHistory(); this.emit('history', this.history); }

  watch() {
    const now = Date.now();
    for (const t of this.transfers.values()) {
      if (t.dir === 'in' && t.status === 'active' && now - (t.lastData || t.activeSince) > 60000) {
        t.note = 'Waiting for the sender to come back…';
        this.finishT(t, 'interrupted', { error: 'The sender stopped. It will pick up where it left off if they retry within an hour.' });
        this.dropPartialLater(t);
      }
      if (t.dir === 'in' && (t.status === 'interrupted' || t.status === 'failed') && now - t.ended > KEEP_PARTIAL) this.discard(t);
    }
  }

  // ════════════════════ SENDING ════════════════════
  async send(peerId, paths) {
    const p = this.peer(peerId);
    const t = {
      tid: rid(), dir: 'out', kind: 'files', peer: { id: p.id, name: p.name, os: p.os, dev: p.dev, pub: p.pub },
      status: 'preparing', bytes: 0, total: 0, count: 0, started: Date.now(), names: paths.map(x => path.basename(x.replace(/[\\/]+$/, ''))).slice(0, 4), paths,
    };
    this.transfers.set(t.tid, t); this.update(t, true);
    try {
      const { items, dirs } = await F.collect(paths, { onProgress: (n) => { t.note = `Reading ${n.toLocaleString()} files…`; this.update(t); } });
      if (!items.length && !dirs.length) throw new Error('Nothing to send: those files couldn’t be read.');
      Object.assign(t, { items, dirs, total: items.reduce((a, x) => a + x.s, 0), count: items.length, note: null });
    } catch (e) { this.finishT(t, 'failed', { error: e.message }); return t.tid; }
    this.runOut(t);
    return t.tid;
  }

  async sendText(peerId, text) {
    const p = this.peer(peerId);
    text = String(text || '');
    if (!text.trim()) throw new Error('Nothing to send.');
    if (text.length > 1e6) throw new Error('That’s too much text — save it as a file and send the file.');
    const t = { tid: rid(), dir: 'out', kind: 'text', text, peer: { id: p.id, name: p.name, os: p.os, dev: p.dev, pub: p.pub }, status: 'waiting', bytes: 0, total: Buffer.byteLength(text), count: 1, started: Date.now(), names: [] };
    this.transfers.set(t.tid, t);
    this.runOut(t);
    return t.tid;
  }

  retry(tid) {
    const t = this.transfers.get(tid) || null;
    if (!t || t.dir !== 'out' || t.status !== 'failed') throw new Error('Nothing to retry.');
    try { this.peer(t.peer.id); } catch (e) { throw new Error(`${t.peer.name} isn’t nearby right now.`); }
    Object.assign(t, { error: null, note: null, ended: null });
    this.runOut(t);
  }

  cancel(tid) {
    const t = this.transfers.get(tid);
    if (!t) return;
    if (t.dir === 'out') {
      if (['done', 'cancelled', 'declined'].includes(t.status)) return;
      t.cancelled = true;
      if (t.abort) t.abort.abort();
      if (t.status === 'failed') return this.finishT(t, 'cancelled');
      this.call(t.peer.id, '/v1/cancel', { tid }, { timeout: 4000 }).catch(() => {});
      this.finishT(t, 'cancelled');
    } else {
      if (t.status === 'asking') return this.respond(tid, false);
      t.cancelled = true;
      for (const r of t.reqs || []) r.destroy();
      this.discard(t);
      if (!['done', 'cancelled'].includes(t.status)) this.finishT(t, 'cancelled');
    }
  }

  streams(tasks) {
    const n = Number(this.settings().streams) || 0;
    if (n) return Math.max(1, Math.min(16, n));
    return Math.max(1, Math.min(6, tasks));
  }

  async runOut(t) {
    t.abort = new AbortController();
    t.status = 'waiting'; t.note = null; this.update(t, true);
    try {
      const m = this.me();
      const offer0 = t.kind === 'text'
        ? { tid: t.tid, kind: 'text', text: t.text }
        : { tid: t.tid, kind: 'files', items: t.items.map(({ p, s, m }) => ({ p, s, m })), dirs: t.dirs, plan: PLAN };
      const offer = { ...offer0, from: { name: m.name, os: m.os, dev: m.dev, port: m.port } };
      const ans = await this.call(t.peer.id, '/v1/offer', offer, { timeout: ASK_TIMEOUT + 15000, signal: t.abort.signal });
      if (t.cancelled) return;
      if (!ans.accepted) return this.finishT(t, 'declined', { error: ans.reason || null });
      if (t.kind === 'text') { t.bytes = t.total; t.activeSince = Date.now(); return this.finishT(t, 'done'); }

      const tasks = F.plan(t.items, PLAN);
      const done = new Set(ans.done || []);
      const queue = tasks.filter(x => !done.has(x.k));
      t.bytes = tasks.filter(x => done.has(x.k)).reduce((a, x) => a + x.bytes, 0);
      t.status = 'active'; t.activeSince = Date.now(); t.lastData = Date.now();
      this.meter(t); this.update(t, true);
      const n = this.streams(queue.length);
      t.agent = new http.Agent({ keepAlive: true, maxSockets: n });
      let fatal = null;
      const worker = async () => {
        while (queue.length && !fatal && !t.cancelled) {
          const task = queue.shift();
          try { await this.putWithRetry(t, task); } catch (e) { fatal = fatal || e; }
        }
      };
      await Promise.all(Array.from({ length: n }, worker));
      if (t.cancelled) return;
      if (fatal) throw fatal;
      t.note = 'Finishing…'; this.update(t, true);
      const fin = await this.call(t.peer.id, '/v1/finish', { tid: t.tid }, { timeout: 600000, signal: t.abort.signal });
      if (!fin.ok) throw new Error(fin.error || 'The other device couldn’t save the files.');
      t.note = null;
      this.finishT(t, 'done', { saved: fin.saved });
    } catch (e) {
      if (t.cancelled) return;
      if (e.status === 410) return this.finishT(t, 'cancelled', { error: `${t.peer.name} cancelled.` });
      this.finishT(t, 'failed', { error: friendly(e, t.peer.name) });
    } finally {
      clearInterval(t.meterTimer);
      if (t.agent) { t.agent.destroy(); t.agent = null; }
    }
  }

  async putWithRetry(t, task) {
    for (let a = 0; ; a++) {
      try { return await this.put(t, task); }
      catch (e) {
        if (t.cancelled || e.fatal || [404, 409, 410, 413].includes(e.status) || a >= this.retryDelays.length) throw e;
        t.note = 'Connection dropped — retrying…'; this.update(t);
        await wait(this.retryDelays[a]);
        t.note = null;
      }
    }
  }

  put(t, task) {
    const p = this.peer(t.peer.id);
    const key = C.sharedKey(this.identity.priv, this.identity.id, p.pub, p.id);
    const base = crypto.randomBytes(8);
    const parts = task.files ? task.files.map(f => ({ it: t.items[f], o: 0, l: t.items[f].s })) : [{ it: t.items[task.f], o: task.o, l: task.l }];
    let sent = 0;
    async function* source() {
      for (const part of parts) {
        if (!part.l) continue;
        let got = 0;
        const rs = fs.createReadStream(part.it.abs, { start: part.o, end: part.o + part.l - 1, highWaterMark: 1 << 20 });
        try {
          for await (const c of rs) {
            if (got + c.length > part.l) throw Object.assign(new Error(`“${path.basename(part.it.p)}” changed while sending.`), { fatal: true });
            got += c.length; sent += c.length; t.bytes += c.length;
            yield c;
          }
        } catch (e) {
          if (e.code === 'ENOENT' || e.code === 'EACCES' || e.code === 'EPERM') throw Object.assign(new Error(`Couldn’t read “${path.basename(part.it.p)}” — it was moved or can’t be opened.`), { fatal: true });
          throw e;
        }
        if (got !== part.l) throw Object.assign(new Error(`“${path.basename(part.it.p)}” changed while sending.`), { fatal: true });
      }
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const fin = (err, v) => { if (settled) return; settled = true; if (err) { t.bytes -= sent; reject(err); } else resolve(v); };
      const req = http.request({
        host: p.address, port: p.port, method: 'PUT', path: `/v1/put?tid=${t.tid}&k=${task.k}`, agent: t.agent, signal: t.abort.signal,
        headers: { 'x-beam-id': this.identity.id, 'x-beam-pub': this.identity.pub, 'x-beam-nonce': base.toString('hex'), 'content-type': 'application/octet-stream' },
      }, (res) => {
        readBody(res, 65536).then((b) => {
          if (res.statusCode === 200) return fin(null, true);
          let msg = ''; try { msg = JSON.parse(b.toString()).error; } catch {}
          fin(Object.assign(new Error(msg || `HTTP ${res.statusCode}`), { status: res.statusCode }));
        }, (e) => fin(e));
        if (res.statusCode !== 200) req.destroy();
      });
      req.on('error', (e) => fin(e));
      req.setTimeout(45000, () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
      pipe(source(), new C.Encrypt(key, base), req).catch((e) => { fin(e); req.destroy(); });
    });
  }

  // a small sealed request to another device
  call(peerId, pth, obj, { timeout = 15000, signal } = {}) {
    const p = this.peer(peerId);
    const key = C.sharedKey(this.identity.priv, this.identity.id, p.pub, p.id);
    const body = C.seal(key, obj);
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: p.address, port: p.port, method: 'POST', path: pth, signal,
        headers: { 'x-beam-id': this.identity.id, 'x-beam-pub': this.identity.pub, 'content-type': 'application/octet-stream', 'content-length': body.length },
      }, (res) => {
        readBody(res, 64 << 20).then((b) => {
          if (res.statusCode !== 200) {
            let msg = ''; try { msg = JSON.parse(b.toString()).error; } catch {}
            return reject(Object.assign(new Error(msg || `HTTP ${res.statusCode}`), { status: res.statusCode }));
          }
          try { resolve(C.open(key, b)); } catch (e) { reject(new Error('Couldn’t read the reply (keys don’t match).')); }
        }, reject);
      });
      req.on('error', reject);
      req.setTimeout(timeout, () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
      req.end(body);
    });
  }

  // ════════════════════ RECEIVING ════════════════════
  async route(req, res) {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/m/')) return this.phone.handle(req, res, u);
    if (u.pathname === '/' || u.pathname === '/favicon.ico') { res.writeHead(404); return res.end(); }
    if (req.method === 'GET' && u.pathname === '/v1/hello') {
      const m = this.me();
      return this.json(res, 200, { id: m.id, name: m.name, os: m.os, dev: m.dev, port: m.port, pub: m.pub, ver: m.ver, beam: 1 });
    }
    if (!u.pathname.startsWith('/v1/')) { res.writeHead(404); return res.end(); }
    const from = { id: String(req.headers['x-beam-id'] || ''), pub: String(req.headers['x-beam-pub'] || ''), address: (req.socket.remoteAddress || '').replace(/^::ffff:/, '') };
    if (!from.id || from.id.length > 64 || !C.validPub(from.pub)) return this.json(res, 400, { error: 'bad request' });
    const key = C.sharedKey(this.identity.priv, this.identity.id, from.pub, from.id);

    if (req.method === 'PUT' && u.pathname === '/v1/put') return this.onPut(req, res, u, from, key);
    if (req.method !== 'POST') return this.json(res, 405, { error: 'method' });
    let msg;
    try { msg = C.open(key, await readBody(req, 64 << 20)); } catch (e) { return this.json(res, e.status || 400, { error: 'Couldn’t read that request.' }); }
    const reply = (obj) => { const b = C.seal(key, obj); res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': b.length }); res.end(b); };
    if (u.pathname === '/v1/offer') return this.onOffer(req, res, from, msg, reply);
    if (u.pathname === '/v1/finish') return this.onFinish(from, msg, reply);
    if (u.pathname === '/v1/cancel') {
      const t = this.transfers.get(msg.tid);
      if (t && t.dir === 'in' && t.peer.id === from.id) {
        t.cancelled = true; for (const r of t.reqs || []) r.destroy();
        if (t.status === 'asking') { t.decide && t.decide(false, 'cancelled'); }
        else if (!['done', 'cancelled'].includes(t.status)) { this.discard(t); this.finishT(t, 'cancelled', { error: `${t.peer.name} cancelled.` }); }
      }
      return reply({ ok: true });
    }
    this.json(res, 404, { error: 'not found' });
  }

  json(res, code, obj) {
    if (res.headersSent) { try { res.end(); } catch {} return; }
    const b = Buffer.from(JSON.stringify(obj));
    res.writeHead(code, { 'content-type': 'application/json', 'content-length': b.length });
    res.end(b);
  }
  fail(res, e) { this.json(res, e.status || 500, { error: e.message || 'error' }); }

  receiveDir() {
    const d = this.settings().receiveDir;
    return d || path.join(os.homedir(), 'Downloads', 'Beam');
  }

  async onOffer(req, res, from, offer, reply) {
    const st = this.settings();
    const disc = (this.disc && this.disc.get(from.id)) || this.manual.get(from.id);
    const isTrusted = this.trusted(from.id, from.pub);
    const said = offer.from && typeof offer.from === 'object' ? offer.from : {};
    const name = (typeof said.name === 'string' && said.name.trim().slice(0, 80)) || (disc && disc.name) || (st.trusted || []).find(x => x.id === from.id)?.name || 'A nearby device';
    const peer = { id: from.id, name, os: said.os || (disc && disc.os), dev: said.dev || (disc && disc.dev), pub: from.pub, address: from.address };
    // a sender this device can't see (another subnet) still gets an answer path for “send back”
    if (!disc && Number.isInteger(said.port) && from.address) this.seeManual({ id: from.id, name, os: peer.os, dev: peer.dev, port: said.port, pub: from.pub }, from.address);
    if (typeof offer.tid !== 'string' || offer.tid.length > 40) return reply({ accepted: false, reason: 'Bad request.' });

    // the same transfer again (a retry): carry on where it stopped
    const old = this.transfers.get(offer.tid);
    if (old && old.dir === 'in' && old.peer.id === from.id && ['active', 'interrupted', 'failed'].includes(old.status) && old.tasks) {
      clearTimeout(old.dropTimer);
      Object.assign(old, { status: 'active', error: null, note: null, ended: null, cancelled: false, lastData: Date.now() });
      this.history = this.history.filter(h => h.tid !== old.tid);
      this.meter(old); this.update(old, true);
      return reply({ accepted: true, done: [...old.done] });
    }

    if (st.receive === 'off') return reply({ accepted: false, reason: `${st.name} isn’t receiving right now.` });
    if (st.receive === 'trusted' && !isTrusted) return reply({ accepted: false, reason: `${st.name} only accepts from its trusted devices.` });

    const t = { tid: offer.tid, dir: 'in', kind: offer.kind === 'text' ? 'text' : 'files', peer, status: 'asking', bytes: 0, started: Date.now(), trustedSender: isTrusted, keyChanged: this.trusted(from.id) && !isTrusted };
    if (t.kind === 'text') {
      t.text = String(offer.text || '').slice(0, 1e6); t.total = Buffer.byteLength(t.text); t.count = 1; t.names = [];
    } else {
      const items = Array.isArray(offer.items) ? offer.items : [];
      const dirs = Array.isArray(offer.dirs) ? offer.dirs.filter(d => typeof d === 'string') : [];
      if (items.length > 2e6 || !items.every(x => x && typeof x.p === 'string' && Number.isSafeInteger(x.s) && x.s >= 0)) return reply({ accepted: false, reason: 'Bad file list.' });
      try { items.forEach(x => F.safeRel(x.p)); dirs.forEach(d => F.safeRel(d)); } catch { return reply({ accepted: false, reason: 'Bad file list.' }); }
      const pl = offer.plan || {};
      const ok = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
      if (!ok(pl.seg, 1 << 16, 1 << 30) || !ok(pl.small, 0, 64 << 20) || !ok(pl.batch, 1, 1 << 30) || !ok(pl.batchCount, 1, 100000)) return reply({ accepted: false, reason: 'Bad request.' });
      Object.assign(t, { items, dirs, plan: pl, total: items.reduce((a, x) => a + x.s, 0), count: items.length });
      const tops = [];
      for (const x of [...items.map(i => i.p), ...dirs]) { const top = x.split('/')[0]; if (!tops.includes(top)) tops.push(top); }
      t.names = tops.slice(0, 4); t.tops = tops.length;
      const agg = new Map();
      for (const x of items) { const parts = x.p.split('/'); const a = agg.get(parts[0]) || { name: parts[0], dir: false, count: 0, size: 0 }; if (parts.length > 1) a.dir = true; a.count++; a.size += x.s; agg.set(parts[0], a); }
      for (const d of dirs) { const top = d.split('/')[0]; const a = agg.get(top) || { name: top, dir: true, count: 0, size: 0 }; a.dir = true; agg.set(top, a); }
      t.topList = [...agg.values()].slice(0, 6);
      const free = await freeSpace(this.receiveDir());
      if (free != null && free < t.total + (64 << 20)) return reply({ accepted: false, reason: `Not enough space on ${st.name} (${F.human(free)} free).` });
    }
    this.transfers.set(t.tid, t);

    let accepted, reason, trust = false;
    if (isTrusted && st.autoAcceptTrusted !== false) accepted = true;
    else {
      this.update(t, true);
      t.askMeta = { keyChanged: t.keyChanged, code: C.safetyCode(this.identity.pub, from.pub), tops: t.tops, list: t.topList || [] };
      this.emit('incoming', this.snap(t), t.askMeta);
      [accepted, reason, trust] = await new Promise((resolve) => {
        t.decide = (a, r, tr) => { t.decide = null; clearTimeout(timer); resolve([a, r, tr]); };
        const timer = setTimeout(() => t.decide && t.decide(false, 'timeout'), ASK_TIMEOUT);
        res.on('close', () => { if (t.decide && !res.writableEnded) t.decide(false, 'gone'); });
      });
    }
    if (!accepted) {
      this.emit('asked', t.tid);
      const r = reason === 'timeout' ? 'No answer.' : reason === 'gone' || reason === 'cancelled' ? null : `${st.name} declined.`;
      this.finishT(t, reason === 'gone' || reason === 'cancelled' ? 'cancelled' : 'declined', { error: reason === 'timeout' ? 'Not answered in time.' : null });
      if (!res.writableEnded && !res.destroyed) reply({ accepted: false, reason: r });
      return;
    }
    this.emit('asked', t.tid);
    if (trust) { try { this.setTrustFrom(peer); } catch {} }
    if (t.kind === 'text') {
      t.bytes = t.total; t.activeSince = Date.now();
      this.emit('text', { from: peer.name, text: t.text, tid: t.tid });
      this.finishT(t, 'done');
      return reply({ accepted: true });
    }
    t.tasks = F.plan(t.items, t.plan);
    t.done = new Set();
    t.inDir = path.join(this.receiveDir(), '.beam-incoming', t.tid);
    t.prep = new Map(); t.mk = new Map(); t.reqs = new Set();
    try { await fsp.mkdir(t.inDir, { recursive: true }); hideOnWindows(path.dirname(t.inDir)); }
    catch (e) { this.finishT(t, 'failed', { error: 'Couldn’t write to the receive folder: ' + e.message }); return reply({ accepted: false, reason: `${st.name} can’t write to its receive folder.` }); }
    t.status = 'active'; t.activeSince = Date.now(); t.lastData = Date.now();
    this.meter(t); this.update(t, true);
    reply({ accepted: true, done: [] });
  }

  setTrustFrom(peer) {
    const st = this.settings();
    st.trusted = (st.trusted || []).filter(x => x.id !== peer.id);
    st.trusted.push({ id: peer.id, name: peer.name, pub: peer.pub, os: peer.os, dev: peer.dev, added: Date.now() });
    this.saveSettings(); this.emitPeers();
  }

  respond(tid, accept, { trust = false } = {}) {
    const t = this.transfers.get(tid);
    if (t && t.decide) t.decide(!!accept, accept ? null : 'declined', trust);
  }

  partPath(t, f) { return path.join(t.inDir, ...F.safeRel(t.items[f].p)); }
  mkdirOnce(t, dir) {
    let p = t.mk.get(dir);
    if (!p) { p = fsp.mkdir(dir, { recursive: true }); t.mk.set(dir, p); }
    return p;
  }
  prepare(t, f) {
    let p = t.prep.get(f);
    if (!p) {
      p = (async () => {
        const fp = this.partPath(t, f);
        await this.mkdirOnce(t, path.dirname(fp));
        const fh = await fsp.open(fp, 'a');
        try { const st = await fh.stat(); if (st.size !== t.items[f].s) await fh.truncate(t.items[f].s); } finally { await fh.close(); }
      })();
      t.prep.set(f, p);
    }
    return p;
  }

  async onPut(req, res, u, from, key) {
    const t = this.transfers.get(u.searchParams.get('tid'));
    const k = Number(u.searchParams.get('k'));
    const drain = (code, obj) => { req.resume(); this.json(res, code, obj); };
    if (!t || t.dir !== 'in' || t.peer.id !== from.id || t.peer.pub !== from.pub) return drain(404, { error: 'Unknown transfer.' });
    if (t.cancelled || t.status === 'cancelled') return drain(410, { error: 'Cancelled.' });
    if (t.status !== 'active') return drain(409, { error: 'Not ready.' });
    const task = t.tasks[k];
    if (!task) return drain(400, { error: 'Unknown job.' });
    if (t.done.has(k)) return drain(200, { ok: true });
    if (this.testFail && this.testFail(k)) return drain(500, { error: 'test failure' });
    const nonce = Buffer.from(String(req.headers['x-beam-nonce'] || ''), 'hex');
    if (nonce.length !== 8) return drain(400, { error: 'bad request' });
    t.peer.address = from.address;
    const w = new TaskWriter(this, t, task);
    t.reqs.add(req);
    try {
      await pipe(req, new C.Decrypt(key, nonce), w);
      if (w.written !== task.bytes) throw new Error('short');
      t.done.add(k); t.lastData = Date.now();
      this.json(res, 200, { ok: true });
    } catch (e) {
      t.bytes -= w.written;
      if (t.cancelled) return this.json(res, 410, { error: 'Cancelled.' });
      if (e.code === 'ENOSPC') { this.json(res, 413, { error: 'The other device ran out of space.' }); this.finishT(t, 'failed', { error: 'Ran out of space.' }); this.discard(t); return; }
      this.json(res, 400, { error: e.message });
    } finally { t.reqs.delete(req); }
  }

  async onFinish(from, msg, reply) {
    const t = this.transfers.get(msg.tid);
    if (!t || t.dir !== 'in' || t.peer.id !== from.id) return reply({ ok: false, error: 'Unknown transfer.' });
    if (t.status === 'done') return reply({ ok: true, saved: (t.saved || []).map(p => path.basename(p)) });
    const missing = t.tasks.filter(x => !t.done.has(x.k)).length;
    if (missing) return reply({ ok: false, error: `${missing} parts didn’t arrive.` });
    try {
      t.note = 'Saving…'; this.update(t, true);
      // empty files and empty folders
      for (let f = 0; f < t.items.length; f++) if (!t.items[f].s) { const fp = this.partPath(t, f); await this.mkdirOnce(t, path.dirname(fp)); await fsp.writeFile(fp, ''); }
      for (const d of t.dirs) await fsp.mkdir(path.join(t.inDir, ...F.safeRel(d)), { recursive: true });
      // keep the sender's modified dates
      let i = 0;
      const dated = t.items.map((x, f) => [f, x.m]).filter(([, m]) => Number.isFinite(m) && m > 0);
      await Promise.all(Array.from({ length: 32 }, async () => {
        while (i < dated.length) { const [f, m] = dated[i++]; try { await fsp.utimes(this.partPath(t, f), new Date(), new Date(m)); } catch {} }
      }));
      const dest = this.receiveDir();
      await fsp.mkdir(dest, { recursive: true });
      const saved = [];
      const tops = await fsp.readdir(t.inDir);
      const order = []; for (const x of [...t.items.map(i => i.p), ...t.dirs]) { const top = F.safeRel(x)[0]; if (!order.includes(top)) order.push(top); }
      for (const top of order.filter(x => tops.includes(x))) {
        const to = await F.uniquePath(dest, top);
        await F.move(path.join(t.inDir, top), to);
        saved.push(to);
      }
      await fsp.rm(t.inDir, { recursive: true, force: true });
      t.note = null;
      this.finishT(t, 'done', { saved });
      this.emit('received', this.snap(t));
      reply({ ok: true, saved: saved.map(p => path.basename(p)) });
    } catch (e) {
      this.finishT(t, 'failed', { error: 'Couldn’t save: ' + e.message });
      reply({ ok: false, error: 'Couldn’t save the files: ' + e.message });
    }
  }

  dropPartialLater(t) { clearTimeout(t.dropTimer); t.dropTimer = setTimeout(() => this.discard(t), KEEP_PARTIAL); }
  discard(t) {
    clearTimeout(t.dropTimer); clearInterval(t.meterTimer);
    if (t.inDir) fsp.rm(t.inDir, { recursive: true, force: true }).catch(() => {});
    if (this.transfers.get(t.tid) === t && ['interrupted', 'failed', 'cancelled'].includes(t.status)) { this.transfers.delete(t.tid); this.emit('transfers', this.list()); }
  }

  // leftovers from transfers that never finished (app quit mid-way) older than a day
  async cleanIncoming() {
    const dir = path.join(this.receiveDir(), '.beam-incoming');
    let names = [];
    try { names = await fsp.readdir(dir); } catch { return; }
    for (const n of names) {
      try { const st = await fsp.stat(path.join(dir, n)); if (Date.now() - st.mtimeMs > 86400000) await fsp.rm(path.join(dir, n), { recursive: true, force: true }); } catch {}
    }
    try { if (!(await fsp.readdir(dir)).length) await fsp.rmdir(dir); } catch {}
  }

  addresses() { return interfaces().filter(i => !i.virtual).map(i => ({ name: i.name, address: i.address })); }
}

// writes one job's bytes into the right files at the right places
class TaskWriter extends Writable {
  constructor(engine, t, task) {
    super({ highWaterMark: 4 << 20 });
    this.e = engine; this.t = t; this.written = 0;
    this.parts = task.files ? task.files.map(f => ({ f, o: 0, l: t.items[f].s, whole: true })) : [{ f: task.f, o: task.o, l: task.l, whole: false }];
    this.i = 0; this.pos = 0; this.fh = null;
  }
  async openCur() {
    const part = this.parts[this.i];
    const fp = this.e.partPath(this.t, part.f);
    if (part.whole) { await this.e.mkdirOnce(this.t, path.dirname(fp)); this.fh = await fsp.open(fp, 'w'); }
    else { await this.e.prepare(this.t, part.f); this.fh = await fsp.open(fp, 'r+'); }
  }
  _write(chunk, _e, cb) {
    (async () => {
      while (chunk.length) {
        while (this.i < this.parts.length && this.parts[this.i].l === 0) this.i++;
        const part = this.parts[this.i];
        if (!part) throw new Error('more data than expected');
        if (!this.fh) await this.openCur();
        const n = Math.min(part.l - this.pos, chunk.length);
        let off = 0;
        while (off < n) { const { bytesWritten } = await this.fh.write(chunk, off, n - off, part.o + this.pos + off); off += bytesWritten; }
        this.pos += n; this.written += n; this.t.bytes += n; this.t.lastData = Date.now();
        chunk = chunk.subarray(n);
        if (this.pos === part.l) { await this.fh.close(); this.fh = null; this.i++; this.pos = 0; }
      }
    })().then(() => cb(), cb);
  }
  _final(cb) {
    (async () => {
      if (this.fh) { await this.fh.close(); this.fh = null; }
      while (this.i < this.parts.length && this.parts[this.i].l === 0) this.i++;
      if (this.i < this.parts.length) throw new Error('the stream was cut short');
    })().then(() => cb(), cb);
  }
  _destroy(err, cb) { const fh = this.fh; this.fh = null; if (fh) fh.close().then(() => cb(err), () => cb(err)); else cb(err); }
}

async function freeSpace(dir) {
  if (!fsp.statfs) return null;
  let d = dir;
  for (let k = 0; k < 6; k++) {
    try { const s = await fsp.statfs(d); return s.bavail * s.bsize; } catch { d = path.dirname(d); }
  }
  return null;
}

function hideOnWindows(dir) {
  if (process.platform !== 'win32') return;
  try { require('child_process').execFile('attrib', ['+h', dir], { windowsHide: true }, () => {}); } catch {}
}

function friendly(e, name) {
  const c = e.code || '';
  if (e.fatal || e.status) return e.message;
  if (c === 'ECONNREFUSED') return `${name} isn’t accepting connections — is Beam open there?`;
  if (c === 'EHOSTUNREACH' || c === 'ENETUNREACH' || c === 'EHOSTDOWN') return `Can’t reach ${name} — check you’re on the same network.`;
  if (c === 'ETIMEDOUT' || /timed out/.test(e.message)) return `${name} stopped responding.`;
  if (c === 'ECONNRESET' || c === 'EPIPE') return `The connection to ${name} dropped.`;
  if (e.name === 'AbortError') return 'Stopped.';
  return e.message || 'Something went wrong.';
}

module.exports = { Engine, PORT, PLAN };
