// Bench — a sandbox desk: apps run on this computer, fast and many at once, but each with its own data (home
// folder, app-data and temp folders inside the desk), so testing never touches your real files. Electron apps
// (every Utility Suite app) are fully controllable; web pages open in Bench's own browser window; commands run in
// the desk's folder; other apps run with their output captured.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { ElectronApp, LogBuffer, killTree } = require('./electron-app');
const { CommandSession } = require('./proc');
const { resolveLaunch } = require('./apps');
const { newId, slug, safeRemove } = require('./store');

const IS_WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class NativeSession extends EventEmitter {
  constructor({ id, name, exec, args, cwd, env }) { super(); Object.assign(this, { id, name, exec, args, cwd, env }); this.logs = new LogBuffer(2000); this.state = 'starting'; this.exit = null; }
  async start() {
    this.startedAt = Date.now();
    const child = spawn(this.exec, this.args || [], { cwd: this.cwd, env: { ...process.env, ...(this.env || {}) }, detached: !IS_WIN, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child; this.pid = child.pid; this.state = 'running';
    const take = (stream) => (d) => { for (const line of d.toString().split(/\r?\n/)) if (line.trim()) this.emit('log', this.logs.add({ source: 'main', stream, level: stream === 'stderr' && /error|fatal|exception/i.test(line) ? 'error' : 'info', text: line })); };
    child.stdout.on('data', take('stdout')); child.stderr.on('data', take('stderr'));
    child.on('error', (e) => this.emit('log', this.logs.add({ source: 'bench', level: 'error', text: e.message })));
    child.on('exit', (code, signal) => { this.exit = { code, signal, at: Date.now() }; this.state = 'exited'; this.emit('exit', this.exit); this.emit('changed'); });
    await sleep(300);
    if (this.exit) throw new Error(`${this.name} quit straight away (${this.exit.signal || 'code ' + this.exit.code})`);
    return this;
  }
  get running() { return !this.exit; }
  async quit() { killTree(this.child, 'SIGTERM'); await sleep(1500); if (!this.exit) killTree(this.child, 'SIGKILL'); }
  summary() { const c = this.logs.counts(); return { id: this.id, name: this.name, kind: 'native', state: this.exit ? 'exited' : this.state, pid: this.pid, startedAt: this.startedAt, exit: this.exit, errors: c.errors, warnings: c.warnings, controlled: false }; }
}

class SandboxDesk extends EventEmitter {
  /** ctx: { dir, pkgDir(), shell() → {exec, args}, installDeps(dir) → Promise } */
  constructor(rec, ctx) {
    super(); this.rec = rec; this.ctx = ctx; this.dir = ctx.dir; this.state = 'running'; this.detail = ''; this.guest = 'host';
    this.sessionsMap = new Map(); this.order = []; this.logs = new LogBuffer(1000);
    this.paths = { home: path.join(this.dir, 'home'), data: path.join(this.dir, 'data'), tmp: path.join(this.dir, 'tmp') };
    this._ensureDirs();
  }
  _ensureDirs() {
    for (const p of Object.values(this.paths)) fs.mkdirSync(p, { recursive: true });
    for (const sub of ['Documents', 'Downloads', 'Desktop', 'Pictures', 'Music', 'Movies']) fs.mkdirSync(path.join(this.paths.home, sub), { recursive: true });
    if (IS_WIN) for (const sub of ['AppData/Roaming', 'AppData/Local']) fs.mkdirSync(path.join(this.paths.home, sub), { recursive: true });
  }
  log(level, text) { this.emit('log', this.logs.add({ source: 'desk', level, text })); }
  async start() { this.state = 'running'; this.emit('state', { state: 'running' }); }
  async stop() { await Promise.all([...this.sessionsMap.values()].filter((s) => s.running).map((s) => this.quit(s.id).catch(() => {}))); }
  async reset() {
    await this.stop();
    for (const p of Object.values(this.paths)) { try { safeRemove(p, [this.dir]); } catch {} }
    this._ensureDirs(); this.sessionsMap.clear(); this.order = []; this.emit('changed');
  }

  /** Environment for an app on this desk. mode: 'desk' (the desk's own data, kept), 'fresh' (new and thrown away), 'real' (your normal data). */
  envFor(mode, name, sessionId) {
    if (mode === 'real') return { env: {}, userData: null, home: null };
    const home = mode === 'fresh' ? path.join(this.paths.tmp, `fresh-${sessionId}`, 'home') : this.paths.home;
    const userData = mode === 'fresh' ? path.join(this.paths.tmp, `fresh-${sessionId}`, 'app-data') : path.join(this.paths.data, slug(name));
    const tmp = path.join(this.paths.tmp, 'tmp');
    for (const d of [home, userData, tmp, path.join(home, 'Documents'), path.join(home, 'Downloads'), path.join(home, 'Desktop'), path.join(home, 'Pictures'), path.join(home, 'Music')]) fs.mkdirSync(d, { recursive: true });
    const env = { HOME: home, TMPDIR: tmp, TEMP: tmp, TMP: tmp, BENCH_DESK: this.rec.id, BENCH_SANDBOX: '1' };
    if (IS_WIN) Object.assign(env, { USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local') });
    if (process.platform === 'linux') Object.assign(env, { XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local', 'share'), XDG_CACHE_HOME: path.join(home, '.cache') });
    return { env, userData, home };
  }

  /**
   * spec: { app | project | path | url | command, args, data: 'desk'|'fresh'|'real', hidden, env, cwd, name, wait_seconds }
   */
  async launch(spec, { onProgress = () => {} } = {}) {
    const id = newId('s');
    const hidden = spec.hidden != null ? !!spec.hidden : this.rec.hidden !== false;
    const mode = spec.data || 'desk';
    let session; let note = '';
    if (spec.command) {
      session = new CommandSession({ id, name: spec.name, command: spec.command, cwd: spec.cwd ? expand(spec.cwd) : this.paths.home, env: { ...(spec.isolate ? this.envFor(mode, 'command', id).env : {}), ...(spec.env || {}) } });
      this._add(session); session.start();
      return { session: session.summary(), note };
    }
    let target;
    if (spec.url) {
      const sh = this.ctx.shell(); let host = spec.url; try { const u = new URL(spec.url); host = u.protocol === 'file:' ? decodeURIComponent(u.pathname.split('/').pop()) : u.host || spec.url; } catch {}
      target = { name: spec.name || host, exec: sh.exec, args: [...sh.args, '--bench-shell', `--bench-url=${spec.url}`, ...(spec.size ? [`--bench-size=${spec.size}`] : [])], cwd: path.dirname(sh.exec), kind: 'electron', source: 'web' };
    } else {
      target = resolveLaunch(spec, { pkgDir: this.ctx.pkgDir(), extraArgs: spec.args || [] });
      if (target.note) note = target.note;
      if (target.needsInstall) {
        onProgress({ label: `Installing ${target.name}’s packages (npm install, first time only)` });
        this.log('info', `Installing packages for ${target.name} in ${target.needsInstall}`);
        await this.ctx.installDeps(target.needsInstall, (line) => this.log('info', line));
        target = resolveLaunch(spec, { pkgDir: this.ctx.pkgDir(), extraArgs: spec.args || [] });
        if (target.needsInstall) throw new Error(`${target.name}’s packages installed, but Electron still isn’t there. Check ${target.needsInstall}/node_modules`);
      }
    }
    const { env, userData } = this.envFor(mode, target.name, id);
    if (target.kind === 'electron') {
      session = new ElectronApp({ id, name: spec.name || target.name, exec: target.exec, args: target.args, cwd: target.cwd, env: { ...env, ...(spec.env || {}) }, userData, hidden, interceptDialogs: spec.dialogs !== 'native' });
    } else {
      session = new NativeSession({ id, name: spec.name || target.name, exec: target.exec, args: target.args, cwd: target.cwd, env: { ...env, ...(spec.env || {}) } });
      note = (note ? note + ' ' : '') + `${target.name} isn’t an Electron app, so Bench can run it and keep its output but can’t see or click inside it here. For that, use a VM desk.`;
    }
    session.meta = { version: target.version || '', source: target.source, data: mode, fresh: mode === 'fresh' ? path.join(this.paths.tmp, `fresh-${id}`) : null, userData };
    this._add(session);
    try { await session.start(); }
    catch (e) { this.sessionsMap.delete(id); this.order = this.order.filter((x) => x !== id); this.emit('changed'); throw e; }
    if (session instanceof ElectronApp && session.controlled) {
      try { await session.waitForWindow({ timeout: (spec.wait_seconds || 30) * 1000 }); } catch (e) { note = (note ? note + ' ' : '') + e.message; }
    }
    return { session: session.summary(), note };
  }
  _add(s) {
    this.sessionsMap.set(s.id, s); this.order.push(s.id);
    s.on('log', (e) => this.emit('session-log', { session: s.id, entry: e }));
    s.on('changed', () => this.emit('changed'));
    s.on('dialog', (d) => this.emit('dialog', { session: s.id, dialog: d }));
    s.on('exit', () => { this.emit('changed'); if (s.meta && s.meta.fresh) setTimeout(() => { try { safeRemove(s.meta.fresh, [this.paths.tmp]); } catch {} }, 1500); });
    this.emit('changed');
  }
  sessions() { return this.order.map((id) => this.sessionsMap.get(id)).filter(Boolean).map((s) => ({ ...s.summary(), meta: s.meta })); }
  session(id) {
    if (id) { const s = this.sessionsMap.get(id) || [...this.sessionsMap.values()].find((x) => x.name.toLowerCase() === String(id).toLowerCase() && x.running); if (!s) throw new Error(`No session “${id}” on this desk`); return s; }
    const ids = this.order.slice().reverse();
    const s = ids.map((i) => this.sessionsMap.get(i)).find((x) => x && x.running && x instanceof ElectronApp) || ids.map((i) => this.sessionsMap.get(i)).find((x) => x && x.running);
    if (!s) throw new Error('Nothing is running on this desk. Launch an app first.');
    return s;
  }
  app(id) { const s = this.session(id); if (!(s instanceof ElectronApp)) throw new Error(`${s.name} is a ${s instanceof CommandSession ? 'command' : 'non-Electron app'}; Bench can’t see or click inside it`); return s; }
  async quit(id) { const s = this.sessionsMap.get(id); if (!s) throw new Error('No such session'); if (s.quit) await s.quit(); else s.stop(); this.emit('changed'); return s.summary(); }
  forget(id) { const s = this.sessionsMap.get(id); if (s && s.running) throw new Error('Stop it first'); this.sessionsMap.delete(id); this.order = this.order.filter((x) => x !== id); this.emit('changed'); }

  // ── the same surface as the VM desks, aimed at an app session's window
  async screenshot({ session, win, maxSide = 1600, jpeg = false, quality } = {}) {
    const a = this.app(session); const r = await a.screenshot(win, { maxWidth: maxSide, jpeg, quality });
    return { ...r, session: a.id, app: a.name };
  }
  async click({ session, win, x, y, ref, text, button = 'left', count = 1 }) {
    const a = this.app(session);
    if (ref) return { ...(await a.clickRef(win, ref, { button, count })), session: a.id };
    if (text) return { ...(await a.clickText(win, text, { button, count })), session: a.id };
    return { ...(await a.click(win, x, y, { button, count })), session: a.id };
  }
  async move({ session, win, x, y }) { const a = this.app(session); return a.move(win, x, y); }
  async drag({ session, win, x1, y1, x2, y2 }) { return this.app(session).drag(win, x1, y1, x2, y2); }
  async scroll({ session, win, x, y, dx, dy }) { return this.app(session).scroll(win, x, y, dx, dy); }
  async type({ session, win, text, ref, submit, clear }) { const a = this.app(session); if (ref) return a.fill(win, ref, text, { submit, clear: clear !== false }); const r = await a.type(win, text); if (submit) await a.press(win, 'Enter'); return r; }
  async press({ session, win, keys, repeat }) { return this.app(session).press(win, keys, { repeat }); }
  async inspect({ session, win }) { const a = this.app(session); const r = await a.inspect(win); return { ...r, session: a.id, app: a.name }; }
  async waitFor({ session, win, text, gone, timeout }) { return this.app(session).waitForText(win, text, { gone, timeout }); }
  async menu({ session, win, path: p }) { const a = this.app(session); if (!p || !p.length) return { items: await a.menu() }; return { clicked: await a.menuClick(p, win) }; }
  async evaluate({ session, win, code, where = 'window' }) { const a = this.app(session); return where === 'main' ? a.evalMain(code) : a.page(win, code); }
  async run(command, { timeout = 120000, cwd, env, isolate } = {}) {
    const s = new CommandSession({ id: newId('s'), command, cwd: cwd ? expand(cwd) : this.paths.home, env: { ...(isolate ? this.envFor('desk', 'command', 'cmd').env : {}), ...(env || {}) } });
    this._add(s); s.start();
    const r = await s.wait(timeout);
    if (r.timedOut) return { ...r, session: s.id, note: 'Still running; read its output with logs, or stop it with stop_session' };
    return { ...r, session: s.id };
  }
  async copyIn(local, dest) { const to = dest ? (path.isAbsolute(dest) ? dest : path.join(this.paths.home, dest)) : path.join(this.paths.home, 'Desktop', path.basename(local)); fs.cpSync(local, to, { recursive: true }); return { to }; }
  async copyOut(src, local) { const from = path.isAbsolute(src) ? src : path.join(this.paths.home, src); fs.cpSync(from, local, { recursive: true }); return { to: local }; }
  summary() { return { id: this.rec.id, state: 'running', detail: '', home: this.paths.home, sessions: this.sessions().filter((s) => s.state !== 'exited').length }; }
}
const expand = (p) => String(p).replace(/^~(?=$|[\\/])/, require('os').homedir());

module.exports = { SandboxDesk, NativeSession };
