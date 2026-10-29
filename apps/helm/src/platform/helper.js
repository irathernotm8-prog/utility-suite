// A long-running helper process that takes one command per line and answers some of them with one line.
// Restarts itself if it dies (backing off), and never throws into the caller.
'use strict';
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class Helper extends EventEmitter {
  constructor(name, launch) {
    super();
    this.name = name; this.launch = launch; // () => { cmd, args, opts } | null
    this.child = null; this.buf = ''; this.waiting = []; this.ready = false; this.stopped = false; this.fails = 0; this.timer = null; this.info = null;
  }
  start() {
    if (this.child || this.stopped) return;
    const l = this.launch(); if (!l) return this.retry();
    let c;
    try { c = spawn(l.cmd, l.args || [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...(l.opts || {}) }); }
    catch (e) { this.emit('log', `${this.name}: ${e.message}`); return this.retry(); }
    this.child = c; this.ready = false; this.buf = '';
    const born = Date.now();
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (d) => { if (this.child === c) this.onData(d); });
    c.stderr.setEncoding('utf8');
    c.stderr.on('data', (d) => { if (this.child === c) this.emit('log', `${this.name}: ${String(d).trim()}`); });
    c.stdin.on('error', () => {});
    const gone = (why) => {
      if (this.child !== c) return;
      this.child = null; this.ready = false;
      for (const w of this.waiting.splice(0)) { clearTimeout(w.t); w.resolve(null); }
      this.emit('down', why);
      if (Date.now() - born < 4000) this.fails++; else this.fails = 0;
      if (l.onFail && this.fails >= 2) l.onFail();
      this.retry();
    };
    c.on('exit', (code) => gone(`exited (${code})`));
    c.on('error', (e) => gone(e.message));
  }
  retry() { if (this.stopped) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.start(), Math.min(15000, 600 * Math.pow(2, Math.min(5, this.fails)))); }
  stop() { this.stopped = true; clearTimeout(this.timer); if (this.child) { try { this.child.stdin.write('q\n'); } catch (_) {} const c = this.child; setTimeout(() => { try { c.kill(); } catch (_) {} }, 300); } this.child = null; }
  onData(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, ''); this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      if (line.startsWith('READY')) { this.ready = true; this.fails = 0; this.info = line.slice(6).trim(); this.emit('ready', this.info); continue; }
      if (line.startsWith('E ')) { this.emit('log', `${this.name}: ${line.slice(2)}`); continue; }
      if (line.startsWith('X')) { this.emit('xinput', line); continue; }
      const w = this.waiting.find((x) => line.startsWith(x.tag + ' ') || line === x.tag);
      if (w) { this.waiting.splice(this.waiting.indexOf(w), 1); clearTimeout(w.t); w.resolve(line.slice(w.tag.length + 1)); }
    }
  }
  send(line) { if (!this.child) { this.start(); return false; } try { this.child.stdin.write(line + '\n'); return true; } catch (_) { return false; } }
  ask(cmd, tag, timeout = 1500) {
    return new Promise((resolve) => {
      if (!this.send(cmd)) return resolve(null);
      const w = { tag, resolve, t: setTimeout(() => { const k = this.waiting.indexOf(w); if (k >= 0) this.waiting.splice(k, 1); resolve(null); }, timeout) };
      this.waiting.push(w);
    });
  }
}

module.exports = { Helper };
