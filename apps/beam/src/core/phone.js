'use strict';
// Phones and tablets (or any computer without Beam): scan a QR code and a page opens in the phone's
// browser. From it you can send photos, videos, files and text to this computer, and download
// whatever this computer has put up for the phone. The page lives at a secret link that only works
// on your network; "New link" makes the old one stop working.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const qrcode = require('qrcode-generator');
const F = require('./files');

const TOKEN_LEN = 12;
const newToken = () => crypto.randomBytes(9).toString('base64url').slice(0, TOKEN_LEN);

function deviceFromUA(ua = '') {
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) return { name: 'iPad', dev: 'tablet', os: 'ios' };
  if (/iPhone|iPod/.test(ua)) return { name: 'iPhone', dev: 'phone', os: 'ios' };
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? { name: 'Android phone', dev: 'phone', os: 'android' } : { name: 'Android tablet', dev: 'tablet', os: 'android' };
  if (/Windows/.test(ua)) return { name: 'Windows browser', dev: 'browser', os: 'windows' };
  if (/Mac OS X/.test(ua)) return { name: 'Mac browser', dev: 'browser', os: 'mac' };
  return { name: 'Browser', dev: 'browser', os: 'other' };
}

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', zip: 'application/zip', apk: 'application/vnd.android.package-archive' };

class Phone {
  constructor(engine) {
    this.e = engine;
    this.shared = [];   // files this computer has put up for the phone
    this.texts = [];    // text this computer has put up for the phone
    this.batches = new Map();
    this.ensureToken();
  }

  cfg() { const s = this.e.settings(); if (!s.phone) s.phone = { enabled: true }; return s.phone; }
  ensureToken() { const c = this.cfg(); if (!c.token || c.token.length !== TOKEN_LEN) { c.token = newToken(); this.e.saveSettings(); } }
  newLink() { this.cfg().token = newToken(); this.e.saveSettings(); return this.info(); }
  setEnabled(on) { this.cfg().enabled = !!on; this.e.saveSettings(); return this.info(); }

  urlFor(address) { return `http://${address}:${this.e.port}/m/${this.cfg().token}/`; }

  info(address) {
    const addrs = this.e.addresses();
    const a = address && addrs.some(x => x.address === address) ? address : (addrs[0] && addrs[0].address);
    const url = a ? this.urlFor(a) : null;
    let qr = null;
    if (url) {
      const q = qrcode(0, 'Q'); q.addData(url); q.make();
      const n = q.getModuleCount(); qr = { n, rows: [] };
      for (let r = 0; r < n; r++) { let row = ''; for (let c = 0; c < n; c++) row += q.isDark(r, c) ? '1' : '0'; qr.rows.push(row); }
    }
    return { enabled: this.cfg().enabled !== false, url, address: a, addresses: addrs, qr, shared: this.sharedList(), texts: this.texts.map(x => ({ id: x.id, text: x.text, added: x.added })) };
  }

  sharedList() { return this.shared.map(x => ({ id: x.id, name: x.name, size: x.size, added: x.added, downloads: x.downloads || 0 })); }

  async share(paths) {
    const { items } = await F.collect(paths);
    for (const it of items) {
      if (this.shared.some(x => x.abs === it.abs)) continue;
      this.shared.push({ id: crypto.randomBytes(6).toString('hex'), name: it.p.split('/').pop(), rel: it.p, size: it.s, abs: it.abs, added: Date.now() });
    }
    this.e.emit('phone', this.info());
    return this.info();
  }
  unshare(id) { this.shared = id ? this.shared.filter(x => x.id !== id) : []; this.e.emit('phone', this.info()); return this.info(); }
  shareText(text) {
    text = String(text || '').trim();
    if (!text) return this.info();
    this.texts.unshift({ id: crypto.randomBytes(6).toString('hex'), text: text.slice(0, 100000), added: Date.now() });
    this.texts = this.texts.slice(0, 10);
    this.e.emit('phone', this.info());
    return this.info();
  }
  unshareText(id) { this.texts = this.texts.filter(x => x.id !== id); this.e.emit('phone', this.info()); return this.info(); }

  async handle(req, res, u) {
    const parts = u.pathname.split('/');            // ['', 'm', token, ...]
    const c = this.cfg();
    const tok = parts[2] || '';
    const good = c.enabled !== false && tok.length === TOKEN_LEN && crypto.timingSafeEqual(Buffer.from(tok.padEnd(TOKEN_LEN).slice(0, TOKEN_LEN)), Buffer.from(c.token));
    if (!good) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('This link has expired. Scan the code in Beam again.'); }
    const rest = parts.slice(3).join('/');
    const who = deviceFromUA(req.headers['user-agent']);
    const st = this.e.settings();

    if (rest === '' && req.method === 'GET') {
      const html = (this.e.phoneHtml ? this.e.phoneHtml() : '<!doctype html><title>Beam</title>').replace(/__NAME__/g, escapeHtml(st.name)).replace(/__OS__/g, this.e.platform.os);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
      return res.end(html);
    }
    if (rest === 'icon.png' && this.e.iconPath) {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=86400' });
      return fs.createReadStream(this.e.iconPath).pipe(res);
    }
    if (rest === 'api/info' && req.method === 'GET') {
      return this.e.json(res, 200, { name: st.name, os: this.e.platform.os, receiving: st.receive !== 'off', shared: this.sharedList(), texts: this.texts.map(x => ({ id: x.id, text: x.text })) });
    }
    if (rest.startsWith('api/dl/') && req.method === 'GET') {
      const it = this.shared.find(x => x.id === rest.slice(7));
      if (!it) { res.writeHead(404); return res.end(); }
      let st2; try { st2 = await fsp.stat(it.abs); } catch { res.writeHead(410); return res.end(); }
      const ext = path.extname(it.name).slice(1).toLowerCase();
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      const head = { 'content-type': MIME[ext] || 'application/octet-stream', 'accept-ranges': 'bytes', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(it.name)}`, 'cache-control': 'no-store' };
      if (range && (range[1] || range[2])) {
        let a = range[1] ? Number(range[1]) : st2.size - Number(range[2]);
        let b = range[1] && range[2] ? Number(range[2]) : st2.size - 1;
        if (a >= st2.size || a > b) { res.writeHead(416, { 'content-range': `bytes */${st2.size}` }); return res.end(); }
        b = Math.min(b, st2.size - 1);
        res.writeHead(206, { ...head, 'content-range': `bytes ${a}-${b}/${st2.size}`, 'content-length': b - a + 1 });
        return fs.createReadStream(it.abs, { start: a, end: b, highWaterMark: 1 << 20 }).pipe(res);
      }
      it.downloads = (it.downloads || 0) + 1;
      this.e.emit('phone', this.info());
      res.writeHead(200, { ...head, 'content-length': st2.size });
      return fs.createReadStream(it.abs, { highWaterMark: 1 << 20 }).pipe(res);
    }
    if (rest === 'api/text' && req.method === 'POST') {
      if (st.receive === 'off') return this.e.json(res, 403, { error: `${st.name} isn’t receiving right now.` });
      const chunks = []; let n = 0;
      for await (const ch of req) { n += ch.length; if (n > 1e6) return this.e.json(res, 413, { error: 'Too long.' }); chunks.push(ch); }
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return this.e.json(res, 400, { error: 'Empty.' });
      const t = { tid: 'p' + crypto.randomBytes(8).toString('base64url'), dir: 'in', kind: 'text', phone: true, text, peer: { id: 'phone', ...who }, status: 'done', bytes: Buffer.byteLength(text), total: Buffer.byteLength(text), count: 1, started: Date.now(), names: [] };
      this.e.transfers.set(t.tid, t); t.activeSince = Date.now();
      this.e.emit('text', { from: who.name, text, tid: t.tid });
      this.e.finishT(t, 'done');
      return this.e.json(res, 200, { ok: true });
    }
    if (rest === 'api/up' && req.method === 'PUT') return this.upload(req, res, u, who);
    res.writeHead(404); res.end();
  }

  // one file per request; files picked together share a batch and show as one transfer
  async upload(req, res, u, who) {
    const st = this.e.settings();
    const drain = (code, msg) => { req.resume(); this.e.json(res, code, { error: msg }); };
    if (st.receive === 'off') return drain(403, `${st.name} isn’t receiving right now.`);
    const q = u.searchParams;
    const size = Number(q.get('size')), total = Number(q.get('total')), count = Number(q.get('count'));
    const bid = String(q.get('batch') || '').replace(/[^\w-]/g, '').slice(0, 40);
    let name = String(q.get('name') || 'file');
    if (!Number.isSafeInteger(size) || size < 0 || !bid) return drain(400, 'Bad request.');
    try { name = F.cleanPart(name.split(/[\\/]/).pop()); } catch { name = 'file'; }

    let t = this.batches.get(bid);
    if (!t || !this.e.transfers.has(t.tid)) {
      t = { tid: 'p' + bid, dir: 'in', kind: 'files', phone: true, peer: { id: 'phone', ...who }, status: 'active', bytes: 0, total: Number.isSafeInteger(total) ? total : size, count: Number.isSafeInteger(count) && count > 0 ? count : 1, started: Date.now(), names: [], saved: [], got: 0 };
      t.activeSince = Date.now(); t.lastData = Date.now();
      t.inDir = path.join(this.e.receiveDir(), '.beam-incoming', t.tid);
      this.batches.set(bid, t); this.e.transfers.set(t.tid, t);
      this.e.meter(t); this.e.update(t, true);
    }
    if (t.status !== 'active') return drain(410, 'Cancelled.');
    if (t.names.length < 4) t.names.push(name);
    let fh, got = 0;
    const tmp = path.join(t.inDir, crypto.randomBytes(6).toString('hex') + '-' + name);
    t.reqs = t.reqs || new Set(); t.reqs.add(req);
    try {
      await fsp.mkdir(t.inDir, { recursive: true });
      fh = await fsp.open(tmp, 'w');
      for await (const ch of req) {
        if (got + ch.length > size) throw new Error('more data than expected');
        let off = 0; while (off < ch.length) off += (await fh.write(ch, off, ch.length - off)).bytesWritten;
        got += ch.length; t.bytes += ch.length; t.lastData = Date.now();
      }
      await fh.close(); fh = null;
      if (got !== size) throw new Error('the upload was cut short');
      const dest = this.e.receiveDir();
      await fsp.mkdir(dest, { recursive: true });
      const to = await F.uniquePath(dest, name);
      await F.move(tmp, to);
      t.saved.push(to); t.got++;
      this.e.json(res, 200, { ok: true });
      if (t.got >= t.count) {
        fsp.rm(t.inDir, { recursive: true, force: true }).catch(() => {});
        this.batches.delete(bid);
        this.e.finishT(t, 'done');
        this.e.emit('received', this.e.snap(t));
      } else this.e.update(t);
    } catch (e) {
      t.bytes -= got;
      if (fh) await fh.close().catch(() => {});
      fsp.rm(tmp, { force: true }).catch(() => {});
      if (!res.headersSent) this.e.json(res, 400, { error: e.message });
    } finally { t.reqs.delete(req); }
  }
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

module.exports = { Phone, deviceFromUA };
