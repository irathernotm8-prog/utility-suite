'use strict';
// Waypoint — hand a trip to a phone (or any device) on the same Wi-Fi. Scan the QR code and the trip
// opens in the phone's browser straight from this computer: days, bookings, documents. "Save for
// offline" downloads the self-contained page so it keeps working with no signal. The link has a
// secret in it and only works on your network while sharing is on; "New link" retires the old one.
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const qrcode = require('qrcode-generator');
const pack = require('./pack');
const bundle = require('./bundle');

const newToken = () => crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').slice(0, 12);

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      // virtual adapters (Docker, VMs, VPN tunnels) last
      const virt = /^(docker|br-|veth|vmnet|vbox|utun|tun|tap|zt|tailscale|wg)/i.test(name) || /virtual|vEthernet|VMware|Hyper-V/i.test(name);
      out.push({ address: a.address, name, virt });
    }
  }
  return out.sort((a, b) => a.virt - b.virt);
}

function qrRows(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), rows = [];
  for (let r = 0; r < n; r++) { let row = ''; for (let c = 0; c < n; c++) row += q.isDark(r, c) ? '1' : '0'; rows.push(row); }
  return { n, rows };
}

class Share {
  constructor({ store, settings, saveSettings, tmpDir, onVisit }) {
    this.store = store; this.settings = settings; this.saveSettings = saveSettings; this.tmpDir = tmpDir; this.onVisit = onVisit || (() => {});
    this.server = null; this.port = 0; this.shared = new Set(); this.visits = [];
  }
  token() { const s = this.settings(); if (!s.shareToken) { s.shareToken = newToken(); this.saveSettings(); } return s.shareToken; }
  newLink() { this.settings().shareToken = newToken(); this.saveSettings(); return true; }

  async start() {
    if (this.server) return this.port;
    this.server = http.createServer((req, res) => this.handle(req, res).catch((e) => { try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end(String(e.message || e)); } catch {} }));
    const want = Number(this.settings().sharePort) || 0;
    this.port = await new Promise((resolve, reject) => {
      const tryListen = (p) => {
        this.server.once('error', (e) => { if (p && e.code === 'EADDRINUSE') tryListen(0); else reject(e); });
        this.server.listen(p, '0.0.0.0', () => resolve(this.server.address().port));
      };
      tryListen(want);
    });
    return this.port;
  }
  async stop() { const s = this.server; this.server = null; this.shared.clear(); if (s) await new Promise(r => s.close(() => r())); }

  async open(tripId, address) {
    await this.start();
    this.shared.add(tripId);
    return this.info(tripId, address);
  }
  close(tripId) { this.shared.delete(tripId); if (!this.shared.size) this.stop(); return true; }
  info(tripId, address) {
    const addrs = lanAddresses();
    const a = address && addrs.some(x => x.address === address) ? address : (addrs[0] && addrs[0].address);
    const url = a && this.server ? `http://${a}:${this.port}/w/${this.token()}/${tripId}/` : null;
    return { on: this.shared.has(tripId) && !!this.server, url, address: a, addresses: addrs, qr: url ? qrRows(url) : null, visits: this.visits.filter(v => v.trip === tripId).slice(0, 8) };
  }

  async handle(req, res) {
    const u = new URL(req.url, 'http://x');
    const parts = u.pathname.split('/').filter(Boolean);       // ['w', token, tripId, ...rest]
    const deny = () => { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('This link isn’t shared any more. Open Waypoint on the computer and scan the code again.'); };
    if (req.method !== 'GET' && req.method !== 'HEAD') return deny();
    if (parts[0] !== 'w' || parts[1] !== this.token() || !this.shared.has(parts[2]) || !this.store.has(parts[2])) return deny();
    const id = parts[2];
    const trip = this.store.get(id);
    const rest = parts.slice(3);
    const base = `/w/${this.token()}/${id}/`;
    const ua = String(req.headers['user-agent'] || '');
    const head = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

    if (!rest.length) {
      if (!u.pathname.endsWith('/')) { res.writeHead(302, { location: base }); return res.end(); }
      this.visit(id, ua, 'opened');
      let html = pack.build(trip, { docUrl: (d) => `${base}doc/${d.id}` });
      // the live page offers the offline copy and the .waypoint file
      const fname = encodeURIComponent(trip.name || 'Trip');
      html = html.replace('<main>', `<main><div style="display:flex;gap:8px;margin:14px 16px 0;flex-wrap:wrap"><a href="${base}offline.html" download="${fname}.html" style="flex:1;min-width:150px;text-align:center;padding:12px;border-radius:14px;background:linear-gradient(135deg,#ff8a4c,#ffc04d);color:#2a1200;font-weight:700;text-decoration:none">Save for offline</a><a href="${base}trip.waypoint" style="flex:1;min-width:150px;text-align:center;padding:12px;border-radius:14px;background:var(--panel);border:1px solid var(--line2);color:var(--fg);font-weight:650;text-decoration:none">Get .waypoint file</a></div>`);
      res.writeHead(200, { ...head, 'content-type': 'text/html; charset=utf-8' });
      return res.end(req.method === 'HEAD' ? undefined : html);
    }
    if (rest[0] === 'offline.html') {
      this.visit(id, ua, 'saved for offline');
      const html = pack.build(trip, { embed: true, docPath: (d) => this.store.docPath(id, d) });
      res.writeHead(200, { ...head, 'content-type': 'text/html; charset=utf-8', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent((trip.name || 'Trip') + '.html')}` });
      return res.end(req.method === 'HEAD' ? undefined : html);
    }
    if (rest[0] === 'trip.waypoint') {
      this.visit(id, ua, 'downloaded the trip file');
      fs.mkdirSync(this.tmpDir, { recursive: true });
      const out = path.join(this.tmpDir, `${id}-${Date.now()}.waypoint`);
      await bundle.exportTrip(this.store, id, out);
      const st = fs.statSync(out);
      res.writeHead(200, { ...head, 'content-type': 'application/octet-stream', 'content-length': st.size, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent((trip.name || 'Trip') + '.waypoint')}` });
      if (req.method === 'HEAD') { res.end(); fs.unlink(out, () => {}); return; }
      const s = fs.createReadStream(out);
      s.pipe(res); s.on('close', () => fs.unlink(out, () => {}));
      return;
    }
    if (rest[0] === 'doc' && rest[1]) {
      const d = trip.docs.find(x => x.id === rest[1]); if (!d) return deny();
      const p = this.store.docPath(id, d);
      let st; try { st = fs.statSync(p); } catch { return deny(); }
      const mime = pack.mimeOf(d.ext);
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      const disp = `inline; filename*=UTF-8''${encodeURIComponent(path.basename(p))}`;
      if (range && (range[1] || range[2])) {
        let s = range[1] ? +range[1] : Math.max(0, st.size - +range[2]); let e = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
        if (s > e || s >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
        res.writeHead(206, { ...head, 'content-type': mime, 'content-length': e - s + 1, 'content-range': `bytes ${s}-${e}/${st.size}`, 'accept-ranges': 'bytes', 'content-disposition': disp });
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(p, { start: s, end: e }).pipe(res);
      }
      res.writeHead(200, { ...head, 'content-type': mime, 'content-length': st.size, 'accept-ranges': 'bytes', 'content-disposition': disp });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(p).pipe(res);
    }
    return deny();
  }
  visit(trip, ua, what) {
    const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows browser' : /Mac OS X/.test(ua) ? 'Mac browser' : 'A browser';
    this.visits.unshift({ trip, dev, what, at: Date.now() });
    this.visits = this.visits.slice(0, 40);
    this.onVisit(this.visits[0]);
  }
}

module.exports = { Share, lanAddresses, qrRows };
