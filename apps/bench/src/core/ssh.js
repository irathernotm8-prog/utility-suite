// Bench — commands and file copies on VM and remote desks over SSH (pure JavaScript, no system ssh needed).
'use strict';
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

class Ssh {
  constructor({ host, port = 22, username = 'admin', password = 'admin', privateKey = null, readyTimeout = 20000 }) {
    Object.assign(this, { host, port, username, password, privateKey, readyTimeout });
    this.conn = null; this.connecting = null;
  }
  connect() {
    if (this.conn) return Promise.resolve(this.conn);
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const c = new Client();
      c.on('ready', () => { this.conn = c; this.connecting = null; resolve(c); })
        .on('error', (e) => { this.connecting = null; this.conn = null; reject(new Error(`SSH to ${this.host}: ${e.level === 'client-authentication' ? 'wrong user name or password' : e.message}`)); })
        .on('close', () => { this.conn = null; })
        .connect({ host: this.host, port: this.port, username: this.username, password: this.password || undefined, privateKey: this.privateKey || undefined, readyTimeout: this.readyTimeout, keepaliveInterval: 15000, tryKeyboard: true })
        .on('keyboard-interactive', (name, instr, lang, prompts, finish) => finish(prompts.map(() => this.password || '')));
    });
    return this.connecting;
  }
  /** Waits until SSH answers (a VM that's still booting), up to timeoutMs. */
  async waitReady(timeoutMs = 180000, onTry = () => {}) {
    const t0 = Date.now(); let last;
    while (Date.now() - t0 < timeoutMs) { try { onTry(); await this.connect(); return true; } catch (e) { last = e; await new Promise((r) => setTimeout(r, 3000)); } }
    throw last || new Error('SSH didn’t answer');
  }
  async exec(command, { timeout = 120000, onData } = {}) {
    const c = await this.connect();
    return new Promise((resolve, reject) => {
      c.exec(command, (err, stream) => {
        if (err) return reject(err);
        let out = '', errOut = '', done = false; const t0 = Date.now();
        const timer = setTimeout(() => { if (done) return; done = true; try { stream.close(); } catch {} resolve({ code: null, timedOut: true, stdout: out, stderr: errOut, ms: Date.now() - t0 }); }, timeout);
        stream.on('data', (d) => { out += d; if (out.length > 600000) out = out.slice(-500000); onData && onData(d.toString(), 'stdout'); });
        stream.stderr.on('data', (d) => { errOut += d; if (errOut.length > 200000) errOut = errOut.slice(-150000); onData && onData(d.toString(), 'stderr'); });
        stream.on('close', (code, signal) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, signal, stdout: out, stderr: errOut, ms: Date.now() - t0 }); });
      });
    });
  }
  async sftp() { const c = await this.connect(); return new Promise((res, rej) => c.sftp((e, s) => (e ? rej(e) : res(s)))); }
  /** Copies a file or folder from this computer into the desk. */
  async upload(local, remote) {
    const s = await this.sftp();
    const put = (a, b) => new Promise((res, rej) => s.fastPut(a, b, (e) => (e ? rej(e) : res())));
    const mkdir = (d) => new Promise((res) => s.mkdir(d, () => res()));
    const st = fs.statSync(local); let n = 0;
    const walk = async (a, b) => {
      if (fs.statSync(a).isDirectory()) { await mkdir(b); for (const e of fs.readdirSync(a)) await walk(path.join(a, e), b + '/' + e); }
      else { await put(a, b); n++; }
    };
    if (st.isDirectory()) await walk(local, remote); else await put(local, remote), n++;
    s.end(); return n;
  }
  async download(remote, local) {
    const s = await this.sftp();
    const stat = (p) => new Promise((res, rej) => s.stat(p, (e, x) => (e ? rej(e) : res(x))));
    const list = (p) => new Promise((res, rej) => s.readdir(p, (e, x) => (e ? rej(e) : res(x))));
    const get = (a, b) => new Promise((res, rej) => s.fastGet(a, b, (e) => (e ? rej(e) : res())));
    let n = 0;
    const walk = async (a, b) => {
      const st = await stat(a);
      if (st.isDirectory()) { fs.mkdirSync(b, { recursive: true }); for (const e of await list(a)) await walk(a + '/' + e.filename, path.join(b, e.filename)); }
      else { fs.mkdirSync(path.dirname(b), { recursive: true }); await get(a, b); n++; }
    };
    await walk(remote, local); s.end(); return n;
  }
  close() { try { this.conn && this.conn.end(); } catch {} this.conn = null; }
}
/** Quotes a string for a POSIX shell. */
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

module.exports = { Ssh, sq };
