// Utility Suite link — lets the suite's apps talk to each other on this computer, for this user only.
// The canonical copy is tools/suitelink.js in the Utility Package; each app carries its own copy in src/suitelink.js
// (apps are packaged on their own). Keep the copies identical.
//
// An app that offers things calls serve('scene', { version, calls: { list() {}, activate(id) {} } }) and gets back
// { emit(event, data), clients(), close() }. Another app calls connect('scene') and gets a client that reconnects on
// its own, with call(name, ...args) -> Promise and on('event' | 'up' | 'down', fn).
//
// Where it listens: macOS/Linux a Unix socket in the user's own folder (mode 0600, folder 0700); Windows a named
// pipe that includes the user name. Messages are one JSON object per line:
//   client -> app   {"id":1,"call":"activate","args":["work"]}
//   app -> client   {"id":1,"ok":true,"data":…}   or   {"id":1,"ok":false,"error":"…"}
//   app -> clients  {"event":"switched","data":…}
// Every app answers "hello" with { app, version, calls, protocol }.
'use strict';
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const PROTOCOL = 1;
const MAX_LINE = 4 * 1024 * 1024;

function safeId(id) { return String(id).toLowerCase().replace(/[^a-z0-9-]/g, ''); }
function user() { try { return safeId(os.userInfo().username) || 'user'; } catch (_) { return 'user'; } }

/** Folder for the sockets (not used on Windows). */
function linkDir() {
  if (process.env.SUITELINK_DIR) return process.env.SUITELINK_DIR;
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Utility Suite', 'link');
  const base = process.env.XDG_RUNTIME_DIR || path.join(os.homedir(), '.config');
  return path.join(base, 'utility-suite', 'link');
}
/** Where an app listens. */
function address(id) {
  id = safeId(id);
  if (process.platform === 'win32') return `\\\\.\\pipe\\utility-suite-${user()}-${process.env.SUITELINK_DIR ? safeId(path.basename(process.env.SUITELINK_DIR)) + '-' : ''}${id}`;
  return path.join(linkDir(), `${id}.sock`);
}

/** Splits a stream into JSON lines. */
function lines(sock, onMsg) {
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('data', (d) => {
    buf += d;
    if (buf.length > MAX_LINE) { buf = ''; sock.destroy(); return; }
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch (_) { continue; }
      onMsg(m);
    }
  });
}
const write = (sock, obj) => { try { if (!sock.destroyed) sock.write(JSON.stringify(obj) + '\n'); } catch (_) {} };

// ---------------------------------------------------------------- serving (the app that offers things)
function serve(id, { version = '0', calls = {}, onError = () => {} } = {}) {
  const addr = address(id);
  const socks = new Set();
  let server = null, closed = false;
  const all = { ...calls, hello: () => ({ app: safeId(id), version, calls: Object.keys(calls), protocol: PROTOCOL }) };

  function handle(sock) {
    socks.add(sock);
    sock.on('close', () => socks.delete(sock));
    sock.on('error', () => {});
    lines(sock, async (m) => {
      if (m == null || typeof m.call !== 'string') return;
      const fn = Object.prototype.hasOwnProperty.call(all, m.call) ? all[m.call] : null;
      if (!fn) return write(sock, { id: m.id, ok: false, error: `${id} has no "${m.call}"` });
      try { write(sock, { id: m.id, ok: true, data: await fn(...(Array.isArray(m.args) ? m.args : [])) }); }
      catch (e) { write(sock, { id: m.id, ok: false, error: String((e && e.message) || e) }); }
    });
  }

  function listen(retry = true) {
    if (closed) return;
    if (process.platform !== 'win32') {
      try { fs.mkdirSync(path.dirname(addr), { recursive: true, mode: 0o700 }); fs.chmodSync(path.dirname(addr), 0o700); } catch (_) {}
    }
    server = net.createServer(handle);
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE' && retry && process.platform !== 'win32') {
        // Left over from a crash, or another copy of the app is running. If nobody answers, take it over.
        const probe = net.connect(addr);
        probe.on('connect', () => { probe.destroy(); onError(new Error(`${id}: another copy is already linked`)); });
        probe.on('error', () => { try { fs.unlinkSync(addr); } catch (_) {} listen(false); });
        return;
      }
      onError(e);
    });
    server.listen(addr, () => { if (process.platform !== 'win32') { try { fs.chmodSync(addr, 0o600); } catch (_) {} } });
  }
  listen();

  return {
    address: addr,
    emit(event, data) { if (!socks.size) return; for (const s of socks) write(s, { event, data }); },
    clients: () => socks.size,
    close() {
      closed = true;
      for (const s of socks) s.destroy();
      try { server && server.close(); } catch (_) {}
      if (process.platform !== 'win32') { try { fs.unlinkSync(addr); } catch (_) {} }
    }
  };
}

// ---------------------------------------------------------------- connecting (the app that uses things)
class Link extends EventEmitter {
  constructor(id, { retryMs = 4000, timeout = 8000 } = {}) {
    super();
    this.id = safeId(id); this.addr = address(id); this.retryMs = retryMs; this.timeout = timeout;
    this.sock = null; this.up = false; this.info = null; this.seq = 0; this.wait = new Map(); this.timer = null; this.stopped = false;
    this.setMaxListeners(50);
  }
  start() { this.stopped = false; this.dial(); return this; }
  stop() { this.stopped = true; clearTimeout(this.timer); if (this.sock) this.sock.destroy(); this.sock = null; this.setUp(false); }
  /** Try now instead of waiting for the next retry (e.g. right after launching the app). */
  poke() { if (!this.up && !this.stopped) { clearTimeout(this.timer); this.dial(); } }
  dial() {
    if (this.stopped || this.sock) return;
    const s = net.connect(this.addr);
    this.sock = s;
    s.on('connect', async () => {
      lines(s, (m) => this.onMsg(m));
      try { this.info = await this.call('hello'); } catch (_) { this.info = null; }
      this.setUp(true);
    });
    s.on('error', () => {});
    s.on('close', () => {
      if (this.sock === s) this.sock = null;
      for (const [, w] of this.wait) { clearTimeout(w.t); w.reject(new Error(`${this.id} closed`)); }
      this.wait.clear();
      this.setUp(false);
      if (!this.stopped) { clearTimeout(this.timer); this.timer = setTimeout(() => this.dial(), this.retryMs); }
    });
  }
  setUp(on) { if (this.up === on) return; this.up = on; this.emit(on ? 'up' : 'down', this.info); }
  onMsg(m) {
    if (m && m.event) { this.emit(m.event, m.data); return; }
    const w = m && this.wait.get(m.id); if (!w) return;
    this.wait.delete(m.id); clearTimeout(w.t);
    if (m.ok) w.resolve(m.data); else w.reject(new Error(m.error || 'failed'));
  }
  call(name, ...args) {
    return new Promise((resolve, reject) => {
      if (!this.sock || this.sock.destroyed || this.sock.connecting) return reject(new Error(`${this.id} isn't running`));
      const id = ++this.seq;
      const t = setTimeout(() => { this.wait.delete(id); reject(new Error(`${this.id} didn't answer`)); }, this.timeout);
      this.wait.set(id, { resolve, reject, t });
      write(this.sock, { id, call: name, args });
    });
  }
}
const connect = (id, opts) => new Link(id, opts).start();

module.exports = { serve, connect, Link, address, linkDir, PROTOCOL };
