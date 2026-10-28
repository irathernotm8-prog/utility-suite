// Bench — a small VNC (RFB 3.3/3.7/3.8) client: connects to a desk's screen, keeps the framebuffer as RGBA,
// and sends the mouse and keyboard. Encodings: Raw, CopyRect and the DesktopSize pseudo-encoding — plenty for a
// screen on this same computer (a VM's built-in VNC server, Xvfb + x11vnc, another machine on the LAN).
'use strict';
const net = require('net');
const { EventEmitter } = require('events');
const { vncResponse } = require('./des');
const { encodePng, scaleRgba } = require('./png');
const { parseCombo, keysymFor, charKeysym, MOD_KEYSYM } = require('./keys');

const ENC_RAW = 0, ENC_COPYRECT = 1, ENC_DESKTOPSIZE = -223;

/** Parses vnc://[user][:password]@host:port into {host, port, password}. Port numbers under 100 are display numbers (5900 + n). */
function parseVncUrl(url) {
  const m = /^vnc:\/\/(?:([^:@/]*)(?::([^@/]*))?@)?\[?([^\]/:]+)\]?(?::(\d+))?\/?/i.exec(String(url || '').trim());
  if (!m) return null;
  let port = m[4] ? +m[4] : 5900; if (port < 100) port += 5900;
  return { host: m[3], port, password: m[2] != null ? decodeURIComponent(m[2]) : '', username: m[1] ? decodeURIComponent(m[1]) : '' };
}

class Reader {
  constructor() { this.chunks = []; this.len = 0; this.waiting = null; this.err = null; }
  push(b) { this.chunks.push(b); this.len += b.length; this._wake(); }
  fail(e) { this.err = e; this._wake(); }
  _wake() { const w = this.waiting; if (w && (this.err || this.len >= w.n)) { this.waiting = null; w.resolve(); } }
  async read(n) {
    if (this.len < n && !this.err) await new Promise((resolve) => { this.waiting = { n, resolve }; });
    if (this.len < n) throw this.err || new Error('VNC connection closed');
    const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks);
    const out = all.subarray(0, n); const rest = all.subarray(n);
    this.chunks = rest.length ? [rest] : []; this.len = rest.length;
    return Buffer.from(out);
  }
}

class RfbClient extends EventEmitter {
  constructor({ host = '127.0.0.1', port = 5900, password = '', timeout = 15000 } = {}) {
    super();
    Object.assign(this, { host, port, password, timeout });
    this.width = 0; this.height = 0; this.name = ''; this.fb = null; this.connected = false; this.closed = false;
    this.buttons = 0; this.lastPointer = { x: 0, y: 0 }; this.updates = 0; this.lastUpdate = 0; this.wantMore = true; this.pending = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: this.host, port: this.port });
      this.sock = sock; this.reader = new Reader();
      const to = setTimeout(() => { sock.destroy(new Error(`No answer from the screen at ${this.host}:${this.port}`)); }, this.timeout);
      sock.setNoDelay(true);
      sock.on('data', (d) => this.reader.push(d));
      sock.on('error', (e) => { this.reader.fail(e); if (!this.connected) { clearTimeout(to); reject(e); } else this.emit('error', e); });
      sock.on('close', () => { this.closed = true; this.connected = false; this.reader.fail(new Error('VNC connection closed')); this.emit('close'); });
      sock.on('connect', () => {
        this._handshake().then(() => { clearTimeout(to); this.connected = true; resolve(this); this._loop().catch((e) => { if (!this.closed) this.emit('error', e); }); })
          .catch((e) => { clearTimeout(to); sock.destroy(); reject(e); });
      });
    });
  }

  async _handshake() {
    const r = this.reader;
    const ver = (await r.read(12)).toString('latin1');
    const m = /^RFB (\d{3})\.(\d{3})\n$/.exec(ver);
    if (!m) throw new Error('That port isn’t a VNC screen');
    const minor = +m[1] > 3 ? 8 : Math.min(+m[2], 8);
    const use = minor >= 8 ? 8 : minor >= 7 ? 7 : 3;
    this.sock.write(`RFB 003.00${use}\n`);
    let type;
    if (use === 3) {
      type = (await r.read(4)).readUInt32BE(0);
      if (type === 0) throw new Error(await this._reason());
    } else {
      const n = (await r.read(1))[0];
      if (n === 0) throw new Error(await this._reason());
      const types = [...(await r.read(n))];
      type = types.includes(2) && this.password ? 2 : types.includes(1) ? 1 : types.includes(2) ? 2 : null;
      if (type == null) throw new Error(`This VNC screen asks for a sign-in Bench can’t do yet (security types ${types.join(', ')}). Turn on a VNC password in its sharing settings.`);
      this.sock.write(Buffer.from([type]));
    }
    if (type === 2) {
      if (!this.password) throw new Error('This screen needs a VNC password');
      const challenge = await r.read(16);
      this.sock.write(vncResponse(this.password, challenge));
    }
    if (type === 2 || use === 8) {
      const res = (await r.read(4)).readUInt32BE(0);
      if (res !== 0) throw new Error(use === 8 ? `VNC sign-in failed: ${await this._reason()}` : 'VNC sign-in failed: wrong password');
    }
    this.sock.write(Buffer.from([1])); // shared: don't kick other viewers off
    const si = await r.read(24);
    this.width = si.readUInt16BE(0); this.height = si.readUInt16BE(2);
    const nameLen = si.readUInt32BE(20); this.name = (await r.read(nameLen)).toString('utf8');
    this.fb = Buffer.alloc(this.width * this.height * 4);
    // 32 bpp, true colour, little-endian, red in the low byte → memory order R,G,B,X (= RGBA with a junk alpha)
    const pf = Buffer.alloc(20); pf[0] = 0; pf.writeUInt8(32, 4); pf.writeUInt8(24, 5); pf.writeUInt8(0, 6); pf.writeUInt8(1, 7);
    pf.writeUInt16BE(255, 8); pf.writeUInt16BE(255, 10); pf.writeUInt16BE(255, 12); pf.writeUInt8(0, 14); pf.writeUInt8(8, 15); pf.writeUInt8(16, 16);
    this.sock.write(pf);
    const encs = [ENC_COPYRECT, ENC_RAW, ENC_DESKTOPSIZE];
    const se = Buffer.alloc(4 + encs.length * 4); se[0] = 2; se.writeUInt16BE(encs.length, 2); encs.forEach((e, i) => se.writeInt32BE(e, 4 + i * 4));
    this.sock.write(se);
    this.request(false);
  }
  async _reason() { const n = (await this.reader.read(4)).readUInt32BE(0); return (await this.reader.read(n)).toString('utf8'); }

  /** Asks for screen changes (incremental) or the whole screen. */
  request(incremental = true) {
    if (!this.sock || this.closed) return;
    const b = Buffer.alloc(10); b[0] = 3; b[1] = incremental ? 1 : 0; b.writeUInt16BE(0, 2); b.writeUInt16BE(0, 4); b.writeUInt16BE(this.width, 6); b.writeUInt16BE(this.height, 8);
    this.pending = true; this.sock.write(b);
  }

  async _loop() {
    const r = this.reader;
    while (!this.closed) {
      const type = (await r.read(1))[0];
      if (type === 0) {
        const h = await r.read(3); const n = h.readUInt16BE(1); const rects = [];
        for (let i = 0; i < n; i++) {
          const rh = await r.read(12);
          const x = rh.readUInt16BE(0), y = rh.readUInt16BE(2), w = rh.readUInt16BE(4), hh = rh.readUInt16BE(6), enc = rh.readInt32BE(8);
          if (enc === ENC_RAW) {
            const px = await r.read(w * hh * 4);
            for (let row = 0; row < hh; row++) { if (y + row >= this.height) break; px.copy(this.fb, ((y + row) * this.width + x) * 4, row * w * 4, row * w * 4 + Math.min(w, this.width - x) * 4); }
            rects.push({ x, y, w, h: hh });
          } else if (enc === ENC_COPYRECT) {
            const s = await r.read(4); const sx = s.readUInt16BE(0), sy = s.readUInt16BE(2);
            const copy = Buffer.alloc(w * hh * 4);
            for (let row = 0; row < hh; row++) this.fb.copy(copy, row * w * 4, ((sy + row) * this.width + sx) * 4, ((sy + row) * this.width + sx + w) * 4);
            for (let row = 0; row < hh; row++) copy.copy(this.fb, ((y + row) * this.width + x) * 4, row * w * 4, row * w * 4 + w * 4);
            rects.push({ x, y, w, h: hh });
          } else if (enc === ENC_DESKTOPSIZE) {
            this.width = w; this.height = hh; this.fb = Buffer.alloc(w * hh * 4);
            this.emit('resize', { width: w, height: hh }); rects.push({ x: 0, y: 0, w, h: hh });
          } else throw new Error(`The VNC screen sent an encoding Bench didn’t ask for (${enc})`);
        }
        this.updates++; this.lastUpdate = Date.now(); this.pending = false;
        this.emit('update', rects);
        if (this.wantMore) setTimeout(() => this.request(true), this.interval || 50);
      } else if (type === 1) {
        const h = await r.read(5); const n = h.readUInt16BE(3); await r.read(n * 6);
      } else if (type === 2) {
        this.emit('bell');
      } else if (type === 3) {
        const h = await r.read(7); const n = h.readUInt32BE(3); this.emit('clipboard', (await r.read(n)).toString('latin1'));
      } else throw new Error(`Unknown VNC message ${type}`);
    }
  }

  /** Waits for the next screen update (or times out quietly), so a screenshot right after a click shows its effect. */
  settle(ms = 400) {
    return new Promise((res) => { const t = setTimeout(done, ms); function done() { clearTimeout(t); res(); } this.once('update', () => setTimeout(done, 60)); if (!this.pending) this.request(true); });
  }

  // ── input
  pointer(x, y, buttons = this.buttons) {
    x = Math.max(0, Math.min(this.width - 1, Math.round(x))); y = Math.max(0, Math.min(this.height - 1, Math.round(y)));
    const b = Buffer.alloc(6); b[0] = 5; b[1] = buttons; b.writeUInt16BE(x, 2); b.writeUInt16BE(y, 4);
    this.buttons = buttons; this.lastPointer = { x, y }; this.sock.write(b);
  }
  static mask(button) { return { left: 1, middle: 2, right: 4 }[button || 'left'] || 1; }
  async click(x, y, { button = 'left', count = 1 } = {}) {
    const m = RfbClient.mask(button);
    this.pointer(x, y, 0); await sleep(30);
    for (let i = 0; i < count; i++) { this.pointer(x, y, m); await sleep(40); this.pointer(x, y, 0); await sleep(count > 1 ? 70 : 30); }
  }
  async drag(x1, y1, x2, y2, { steps = 12 } = {}) {
    this.pointer(x1, y1, 0); await sleep(30); this.pointer(x1, y1, 1); await sleep(60);
    for (let i = 1; i <= steps; i++) { this.pointer(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps, 1); await sleep(16); }
    await sleep(40); this.pointer(x2, y2, 0);
  }
  /** Wheel: VNC uses buttons 4/5 (up/down) and 6/7 (left/right), one click per ~100 px of delta. */
  async scroll(x, y, dx = 0, dy = 0) {
    const go = async (btn, n) => { for (let i = 0; i < n; i++) { this.pointer(x, y, btn); await sleep(10); this.pointer(x, y, 0); await sleep(10); } };
    const ny = Math.min(30, Math.max(1, Math.round(Math.abs(dy) / 100))); const nx = Math.min(30, Math.max(1, Math.round(Math.abs(dx) / 100)));
    if (dy) await go(dy < 0 ? 8 : 16, ny);
    if (dx) await go(dx < 0 ? 32 : 64, nx);
  }
  keyEvent(keysym, down) { const b = Buffer.alloc(8); b[0] = 4; b[1] = down ? 1 : 0; b.writeUInt32BE(keysym >>> 0, 4); this.sock.write(b); }
  async press(combo, { mac = false } = {}) {
    const { mods, key } = parseCombo(combo, { mac });
    for (const m of mods) { this.keyEvent(MOD_KEYSYM[m], true); await sleep(15); }
    const ks = keysymFor(key); this.keyEvent(ks, true); await sleep(25); this.keyEvent(ks, false);
    for (const m of mods.slice().reverse()) { await sleep(15); this.keyEvent(MOD_KEYSYM[m], false); }
  }
  async type(text, { delay = 12 } = {}) {
    for (const ch of String(text)) {
      const ks = charKeysym(ch); const shift = /[A-Z~!@#$%^&*()_+{}|:"<>?]/.test(ch);
      if (shift) this.keyEvent(MOD_KEYSYM.shift, true);
      this.keyEvent(ks, true); this.keyEvent(ks, false);
      if (shift) this.keyEvent(MOD_KEYSYM.shift, false);
      await sleep(delay);
    }
  }
  setClipboard(text) { const t = Buffer.from(String(text), 'latin1'); const b = Buffer.alloc(8 + t.length); b[0] = 6; b.writeUInt32BE(t.length, 4); t.copy(b, 8); this.sock.write(b); }

  /** PNG of the screen, optionally shrunk to fit maxSide; returns { png, width, height, scale } where scale maps screenshot px → screen px. */
  snapshot({ maxSide = 0 } = {}) {
    if (!this.fb) throw new Error('No screen yet');
    let { width, height } = this; let data = this.fb; let scale = 1;
    if (maxSide && Math.max(width, height) > maxSide) { scale = Math.max(width, height) / maxSide; const nw = Math.round(width / scale), nh = Math.round(height / scale); data = scaleRgba(this.fb, width, height, nw, nh); width = nw; height = nh; }
    return { png: encodePng(data, width, height), width, height, scale };
  }
  close() { this.closed = true; this.wantMore = false; try { this.sock.destroy(); } catch {} }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { RfbClient, parseVncUrl };
