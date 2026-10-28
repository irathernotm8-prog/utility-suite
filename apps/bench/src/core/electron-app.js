// Bench — runs one Electron app (an installed Utility Suite app, an app's source folder, or any Electron app) and
// controls it from inside: Bench starts it paused under its own debugger, puts its helper in (hooks.js) before the
// app's code runs, then lets it go. From then on Bench can list windows, take screenshots, click and type (through
// each window's DevTools connection, so it works while the window is out of sight), use menus, answer native
// dialogs and read every console message, crash and error.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const { Cdp, unwrap } = require('./cdp');
const { benchHooks } = require('./hooks');
const ps = require('./page-scripts');
const { cdpKeyEvents, comboKey } = require('./keys');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Kills a process and everything it started. */
function killTree(child, signal = 'SIGTERM') {
  if (!child || child.exitCode != null || child.signalCode) return;
  try {
    if (IS_WIN) execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    else process.kill(-child.pid, signal);
  } catch { try { child.kill(signal); } catch {} }
}

class LogBuffer {
  constructor(max = 3000) { this.max = max; this.items = []; this.seq = 0; }
  add(e) { e.seq = ++this.seq; e.t = e.t || Date.now(); this.items.push(e); if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max); return e; }
  query({ since = 0, level = 'all', limit = 200, source } = {}) {
    const rank = { verbose: 0, debug: 0, log: 1, info: 1, warning: 2, warn: 2, error: 3 };
    const min = level === 'errors' || level === 'error' ? 3 : level === 'warnings' || level === 'warning' ? 2 : 0;
    const out = this.items.filter((e) => e.seq > since && (rank[e.level] ?? 1) >= min && (!source || e.source === source));
    return out.slice(-limit);
  }
  counts() { let errors = 0, warnings = 0; for (const e of this.items) { if (e.level === 'error') errors++; else if (e.level === 'warning') warnings++; } return { errors, warnings }; }
}

function fmtRemote(a) {
  if (!a) return '';
  if (a.type === 'string') return a.value;
  if ('value' in a) return typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value);
  if (a.preview && a.preview.properties && a.subtype !== 'error') return `${a.className || ''} {${a.preview.properties.map((p) => `${p.name}: ${p.value}`).join(', ')}${a.preview.overflow ? ', …' : ''}}`;
  return a.description || a.type;
}

class ElectronApp extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.exec  the executable (Electron binary or the app's own)
   * @param {string[]} [o.args]  arguments before Bench's (e.g. the project folder when running from source)
   * @param {string} [o.userData]  where the app keeps its data (passed as --user-data-dir)
   * @param {boolean} [o.hidden]  keep its windows out of sight
   */
  constructor({ id, name, exec, args = [], cwd, env, userData, hidden = true, interceptDialogs = true, extraArgs = [], dialogTimeout = 300 }) {
    super();
    Object.assign(this, { id, name, exec, args, cwd, env, userData, hidden, interceptDialogs, extraArgs, dialogTimeout });
    this.logs = new LogBuffer(); this.state = 'starting'; this.controlled = false; this.info = null; this.windowsCache = []; this.dialogs = new Map();
    this.startedAt = null; this.firstWindowAt = null; this.firstLoadAt = null; this.exit = null; this.crashes = [];
    this.lastShot = new Map();
  }

  async start({ timeout = 45000 } = {}) {
    const args = [...this.args, '--inspect-brk=0', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion,MacWebContentsOcclusion'];
    if (this.userData) { fs.mkdirSync(this.userData, { recursive: true }); args.push(`--user-data-dir=${this.userData}`); }
    if (process.platform === 'linux' && process.getuid && process.getuid() === 0) args.push('--no-sandbox');
    args.push(...this.extraArgs);
    const env = { ...process.env, ...(this.env || {}) };
    delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.ELECTRON_NO_ATTACH_CONSOLE;
    this.startedAt = Date.now();
    const child = spawn(this.exec, args, { cwd: this.cwd || path.dirname(this.exec), env, detached: !IS_WIN, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
    this.child = child; this.pid = child.pid;
    let inspectorUrl = null; let errBuf = '';
    const onLine = (source) => {
      let carry = '';
      return (d) => {
        const s = carry + d.toString(); const lines = s.split(/\r?\n/); carry = lines.pop();
        for (const line of lines) {
          const m = /Debugger listening on (ws:\/\/\S+)/.exec(line);
          if (m) { inspectorUrl = m[1]; continue; }
          if (/^For help, see: https:\/\/nodejs\.org|^Debugger attached\.|^Waiting for the debugger to disconnect/.test(line) || !line.trim()) continue;
          if (/^\[\d+:\d+\/\d+\.\d+:(INFO|VERBOSE)/.test(line)) continue;
          if (/Fontconfig error|dbus\/(bus|object_proxy)|ssl_client_socket_impl|NODE_OPTION --use-openssl-ca|viz_main_impl|gpu_init\.cc|gles2_cmd_decoder|DevTools listening on/.test(line)) continue;
          const lvl = source === 'stderr' && /\b(error|Error|ERROR|exception|Exception|FATAL|Uncaught)\b/.test(line) ? 'error' : source === 'stderr' && /\bwarn(ing)?\b/i.test(line) ? 'warning' : 'info';
          this._log({ source: source === 'stdout' ? 'main' : 'main', stream: source, level: lvl, text: line });
        }
        if (source === 'stderr') errBuf = (errBuf + d.toString()).slice(-4000);
      };
    };
    child.stdout.on('data', onLine('stdout'));
    child.stderr.on('data', onLine('stderr'));
    const exited = new Promise((res) => child.on('exit', (code, signal) => res({ code, signal })));
    child.on('error', (e) => { this._log({ source: 'bench', level: 'error', text: `Couldn’t start ${this.name}: ${e.message}` }); });
    exited.then(({ code, signal }) => {
      this.exit = { code, signal, at: Date.now() };
      const was = this.state; this.state = 'exited';
      const unexpected = was !== 'quitting' && (signal || code);
      if (unexpected) { this.crashes.push({ kind: 'app', reason: signal ? `killed by ${signal}` : `exited with code ${code}`, at: Date.now() }); this._log({ source: 'bench', level: 'error', text: `${this.name} ${signal ? `was killed (${signal})` : `quit with error code ${code}`}` }); }
      else this._log({ source: 'bench', level: 'info', text: `${this.name} closed${code != null ? ` (code ${code})` : ''}` });
      if (this.cdp) this.cdp.close();
      this.emit('exit', this.exit);
      this.emit('changed');
    });

    // wait for the debugger address (or the app dying, or not being an Electron app that allows debugging)
    const t0 = Date.now();
    while (!inspectorUrl && !this.exit && Date.now() - t0 < Math.min(timeout, 20000)) await sleep(40);
    if (this.exit) throw new Error(`${this.name} quit as it started (${this.exit.signal || 'code ' + this.exit.code}).${errBuf ? '\n' + errBuf.trim().split('\n').slice(-6).join('\n') : ''}`);
    if (!inspectorUrl) {
      // Not controllable (debugging switched off in this build, or not an Electron app). It still runs; Bench keeps its logs.
      this.state = 'running'; this.controlled = false;
      this._log({ source: 'bench', level: 'warning', text: `${this.name} is running but doesn’t allow Bench inside (its debugging switch is off), so only its output is available.` });
      this.emit('changed');
      return this;
    }
    const cdp = new Cdp(inspectorUrl); await cdp.open(); this.cdp = cdp;
    cdp.on('Runtime.consoleAPICalled', (p) => {
      const level = { error: 'error', assert: 'error', warning: 'warning', warn: 'warning', debug: 'verbose', trace: 'verbose' }[p.type] || 'info';
      const text = (p.args || []).map(fmtRemote).join(' ');
      const fr = p.stackTrace && p.stackTrace.callFrames && p.stackTrace.callFrames[0];
      this._log({ source: 'main', level, text, url: fr && fr.url, line: fr && fr.lineNumber + 1 });
    });
    cdp.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails || {}; const ex = d.exception || {};
      const text = (ex.description || ex.value || d.text || 'Uncaught exception').toString();
      this._log({ source: 'main', level: 'error', kind: 'exception', text: 'Uncaught exception in the main process: ' + text });
    });
    cdp.on('Runtime.bindingCalled', (p) => { if (p.name === '__benchEmit') { try { this._event(JSON.parse(p.payload)); } catch {} } });
    cdp.on('close', () => { this.controlled = false; });
    let pausedRes; const paused = new Promise((r) => { pausedRes = r; });
    cdp.on('Debugger.paused', (p) => pausedRes(p));
    await cdp.send('Runtime.enable');
    await cdp.send('Runtime.addBinding', { name: '__benchEmit' });
    await cdp.send('Debugger.enable');
    cdp.send('Runtime.runIfWaitingForDebugger').catch(() => {});
    await Promise.race([paused, sleep(15000)]);
    try {
      const r = await cdp.send('Runtime.evaluate', { expression: `(${benchHooks.toString()})(require, ${JSON.stringify({ hidden: this.hidden, intercept: this.interceptDialogs, dialogTimeout: this.dialogTimeout })})`, includeCommandLineAPI: true, returnByValue: true });
      this.info = unwrap(r); this.controlled = true;
    } catch (e) {
      this._log({ source: 'bench', level: 'warning', text: `Bench couldn’t get inside ${this.name}: ${e.message}` });
    }
    await cdp.send('Debugger.disable').catch(() => {});
    await cdp.send('Debugger.resume').catch(() => {});
    this.state = 'running';
    this.emit('changed');
    return this;
  }

  _log(e) {
    // the main process's console reaches Bench twice (its stdout and its debugger); keep one
    if (e.source === 'main' && this.controlled !== undefined) {
      const key = String(e.text).trim(); const now = Date.now(); this._recent = this._recent || new Map();
      const prev = this._recent.get(key);
      if (prev && now - prev.t < 4000 && prev.via !== (e.stream ? 'pipe' : 'debugger')) { if (!e.stream && prev.entry && prev.entry.level === 'info' && e.level !== 'info') { prev.entry.level = e.level; } return prev.entry; }
      if (this._recent.size > 300) for (const [k, v] of this._recent) if (now - v.t > 4000) this._recent.delete(k);
      const x = this.logs.add(e); this._recent.set(key, { t: now, via: e.stream ? 'pipe' : 'debugger', entry: x }); this.emit('log', x); return x;
    }
    const x = this.logs.add(e); this.emit('log', x); return x;
  }
  _event(e) {
    switch (e.type) {
      case 'log': this._log({ source: e.source === 'window' ? 'window' : e.source, win: e.win, level: e.level, text: e.text, url: e.url, line: e.line }); break;
      case 'crash': this.crashes.push({ kind: 'window', win: e.win, reason: e.reason, exitCode: e.exitCode, at: Date.now() }); this._log({ source: 'window', win: e.win, level: 'error', kind: 'crash', text: `Window ${e.win} crashed (${e.reason}${e.exitCode ? ', code ' + e.exitCode : ''})` }); this.emit('changed'); break;
      case 'hang': this._log({ source: 'window', win: e.win, level: 'error', kind: 'hang', text: `Window ${e.win} stopped responding` }); break;
      case 'responsive': this._log({ source: 'window', win: e.win, level: 'info', text: `Window ${e.win} is responding again` }); break;
      case 'load-failed': this._log({ source: 'window', win: e.win, level: 'error', text: `Window ${e.win} couldn’t load ${e.url} (${e.desc || e.code})` }); break;
      case 'child-gone': this.crashes.push({ kind: e.kind, reason: e.reason, at: Date.now() }); this._log({ source: 'main', level: 'error', kind: 'crash', text: `${e.name || e.kind} process ${e.reason}${e.exitCode ? ' (code ' + e.exitCode + ')' : ''}` }); break;
      case 'loaded': if (!this.firstLoadAt) this.firstLoadAt = Date.now(); this.emit('changed'); break;
      case 'window': if (!this.firstWindowAt) this.firstWindowAt = Date.now(); this.emit('changed'); break;
      case 'window-changed': case 'window-closed': this.emit('changed'); break;
      case 'dialog': {
        const d = e.dialog; const what = d.kind === 'open' ? 'an Open dialog' : d.kind === 'save' ? 'a Save dialog' : `a message box${d.message ? ` (“${d.message.slice(0, 80)}”)` : ''}`;
        if (e.pending) { this.dialogs.set(d.id, d); this._log({ source: 'bench', level: 'warning', kind: 'dialog', text: `${this.name} opened ${what} — waiting for an answer` }); }
        else this._log({ source: 'bench', level: 'info', kind: 'dialog', text: `${this.name} opened ${what}; Bench answered ${e.answered && e.answered.cancel ? 'Cancel' : JSON.stringify(e.answered)}` });
        this.emit('dialog', { ...d, pending: !!e.pending }); this.emit('changed'); break;
      }
      case 'dialog-closed': this.dialogs.delete(e.id); this.emit('dialog-closed', e); this.emit('changed'); break;
    }
  }

  get running() { return this.state === 'running' && !this.exit; }
  _need() {
    if (this.exit) throw new Error(`${this.name} isn’t running any more (${this.exit.signal || 'code ' + this.exit.code})`);
    if (!this.controlled) throw new Error(`Bench can’t control ${this.name} (its debugging switch is off), so only its logs are available`);
  }
  async evalMain(expression, { timeout = 60000 } = {}) {
    this._need();
    const r = await this.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true }, timeout);
    return unwrap(r);
  }
  call(fn, ...args) { return this.evalMain(`globalThis.__bench.${fn}(${args.map((a) => JSON.stringify(a === undefined ? null : a)).join(',')})`); }

  async windows() { if (!this.running || !this.controlled) return []; try { this.windowsCache = await this.call('windows'); } catch {} return this.windowsCache; }
  async waitForWindow({ timeout = 30000 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (this.exit) throw new Error(`${this.name} quit before showing a window`);
      const w = (await this.windows()).filter((x) => x.visible && !x.devtools);
      if (w.length && !w.some((x) => x.loading)) return w;
      await sleep(250);
    }
    const w = await this.windows();
    if (w.length) return w;
    throw new Error(`${this.name} didn’t open a window within ${Math.round(timeout / 1000)} s`);
  }
  async screenshot(win, { maxWidth = 0, jpeg = false, quality, native = false } = {}) {
    const r = await this.call('capture', win || null, { maxWidth, jpeg, quality, native });
    this.lastShot.set(r.win, { scale: r.scale, at: Date.now() });
    return { buffer: Buffer.from(r.data, 'base64'), width: r.width, height: r.height, scale: r.scale, win: r.win, title: r.title, mime: jpeg ? 'image/jpeg' : 'image/png' };
  }
  /** Coordinates Claude sends are in the pixels of the latest screenshot; Bench maps them to the window. */
  _pt(win, x, y) { const s = this.lastShot.get(win); const k = s ? s.scale : 1; return { x: Math.round(x * k), y: Math.round(y * k) }; }
  async _resolveWin(win) { if (win) return +win; const ws = await this.windows(); const vis = ws.filter((w) => w.visible); const pick = vis.find((w) => w.focused) || vis.sort((a, b) => b.id - a.id)[0] || ws[0]; if (!pick) throw new Error(`${this.name} has no windows open`); return pick.id; }

  async click(win, x, y, { button = 'left', count = 1, raw = false } = {}) {
    win = await this._resolveWin(win); const p = raw ? { x, y } : this._pt(win, x, y);
    const evs = [{ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' } }, { wait: 20 }];
    for (let i = 1; i <= count; i++) {
      evs.push({ method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: p.x, y: p.y, button, clickCount: i, buttons: button === 'right' ? 2 : 1 } });
      evs.push({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: p.x, y: p.y, button, clickCount: i } });
      if (i < count) evs.push({ wait: 40 });
    }
    await this.call('input', win, evs);
    return { win, ...p };
  }
  async move(win, x, y) { win = await this._resolveWin(win); const p = this._pt(win, x, y); await this.call('input', win, [{ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' } }]); return { win, ...p }; }
  async drag(win, x1, y1, x2, y2, { steps = 14 } = {}) {
    win = await this._resolveWin(win); const a = this._pt(win, x1, y1), b = this._pt(win, x2, y2);
    const evs = [{ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: a.x, y: a.y, button: 'none' } }, { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: a.x, y: a.y, button: 'left', clickCount: 1, buttons: 1 } }, { wait: 60 }];
    for (let i = 1; i <= steps; i++) evs.push({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: Math.round(a.x + ((b.x - a.x) * i) / steps), y: Math.round(a.y + ((b.y - a.y) * i) / steps), button: 'left', buttons: 1 } }, { wait: 16 });
    evs.push({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 } });
    await this.call('input', win, evs); return { win, from: a, to: b };
  }
  async scroll(win, x, y, dx = 0, dy = 0) {
    win = await this._resolveWin(win); const p = this._pt(win, x, y);
    await this.call('input', win, [{ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' } }, { method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x: p.x, y: p.y, deltaX: dx, deltaY: dy } }, { wait: 120 }]);
    return { win, ...p };
  }
  async type(win, text) {
    win = await this._resolveWin(win); const evs = [];
    // newlines and tabs become key presses; everything else goes in as text (like a keyboard with an IME)
    for (const part of String(text).split(/(\n|\t)/)) {
      if (part === '\n') { const k = cdpKeyEvents('Enter', { mac: IS_MAC }); evs.push({ method: 'Input.dispatchKeyEvent', params: k.down }, { method: 'Input.dispatchKeyEvent', params: k.up }); }
      else if (part === '\t') { const k = cdpKeyEvents('Tab', { mac: IS_MAC }); evs.push({ method: 'Input.dispatchKeyEvent', params: k.down }, { method: 'Input.dispatchKeyEvent', params: k.up }); }
      else if (part) evs.push({ method: 'Input.insertText', params: { text: part } });
    }
    await this.call('input', win, evs); return { win };
  }
  async press(win, combo, { repeat = 1 } = {}) {
    win = await this._resolveWin(win);
    const k = cdpKeyEvents(combo, { mac: IS_MAC });
    // a shortcut that belongs to the app menu (Cmd+S, Cmd+N…) is pressed through the menu, as the OS would
    if (k.mods.some((m) => m !== 'shift') || /^F\d+$/.test(k.key)) {
      const hit = await this.call('menuAccel', comboKey(k.mods, k.key), win).catch(() => null);
      if (hit) return { win, menu: hit };
    }
    const evs = []; for (let i = 0; i < Math.max(1, Math.min(50, repeat)); i++) evs.push({ method: 'Input.dispatchKeyEvent', params: k.down }, { method: 'Input.dispatchKeyEvent', params: k.up });
    await this.call('input', win, evs); return { win };
  }
  async page(win, code) { win = await this._resolveWin(win); return this.call('exec', win, code); }
  async inspect(win, opts) {
    win = await this._resolveWin(win);
    const s = await this.page(win, ps.call(ps.snapshotFn, opts || {}));
    const w = (this.windowsCache || []).find((x) => x.id === win) || { id: win };
    this.lastShot.set(win, { scale: 1, at: Date.now() }); // refs and coordinates from inspect are window pixels
    return { win, snapshot: s, text: ps.formatSnapshot(s, w) };
  }
  async clickRef(win, ref, opts = {}) {
    win = await this._resolveWin(win);
    const p = await this.page(win, ps.call(ps.refPointFn, ref, true));
    if (!p || p.error) throw new Error(p ? p.error : `${ref} not found`);
    if (p.disabled) throw new Error(`${ref} is disabled`);
    await sleep(30);
    await this.click(win, p.x, p.y, { ...opts, raw: true });
    return { win, x: p.x, y: p.y, tag: p.tag };
  }
  async clickText(win, text, opts = {}) {
    win = await this._resolveWin(win);
    let f = await this.page(win, ps.call(ps.findTextFn, text, {}));
    if (!f) throw new Error(`No “${text}” on screen in window ${win}`);
    if (f.offscreen) { const p = await this.page(win, ps.call(ps.refPointFn, f.ref, true)); if (p && !p.error) f = { ...f, x: p.x, y: p.y }; }
    await this.click(win, f.x, f.y, { ...opts, raw: true });
    return { win, x: f.x, y: f.y, ref: f.ref, name: f.name, matches: f.matches };
  }
  async fill(win, ref, text, { submit = false, clear = true } = {}) {
    win = await this._resolveWin(win);
    const p = await this.page(win, ps.call(ps.refPointFn, ref, true));
    if (!p || p.error) throw new Error(p ? p.error : `${ref} not found`);
    if (p.select) { const r = await this.page(win, ps.call(ps.selectOptionFn, ref, text)); if (r.error) throw new Error(r.error); return { win, picked: r.picked }; }
    await this.click(win, p.x, p.y, { raw: true });
    const f = await this.page(win, ps.call(ps.focusRefFn, ref, clear)); if (f && f.error) throw new Error(f.error);
    if (clear) { const k = cdpKeyEvents('Delete', { mac: IS_MAC }); await this.call('input', win, [{ method: 'Input.dispatchKeyEvent', params: k.down }, { method: 'Input.dispatchKeyEvent', params: k.up }]); }
    await this.type(win, text);
    if (submit) await this.press(win, 'Enter');
    return { win };
  }
  async waitForText(win, text, { timeout = 10000, gone = false } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const ws = await this.windows();
      const targets = win ? [+win] : ws.filter((w) => w.visible).map((w) => w.id);
      for (const id of targets) {
        let has = false; try { has = await this.call('exec', id, ps.call(ps.hasTextFn, text)); } catch {}
        if (has !== gone) return { win: id, found: !gone, ms: Date.now() - t0 };
      }
      await sleep(200);
    }
    return { found: gone, timedOut: true, ms: Date.now() - t0 };
  }
  menu() { return this.call('menu'); }
  menuClick(pathArr, win) { return this.call('menuClick', pathArr, win || null); }
  pendingDialogs() { return [...this.dialogs.values()]; }
  answerDialog(a) { return this.call('answer', a); }
  setHidden(on) { this.hidden = !!on; return this.call('setHidden', !!on); }
  focus(win) { return this.call('focus', win || null); }
  closeWindow(win) { return this.call('close', win); }
  about() { return this.call('about'); }

  async quit({ timeout = 6000 } = {}) {
    if (this.exit) return this.exit;
    this.state = 'quitting';
    const done = new Promise((r) => this.once('exit', r));
    // let go of the app's debugger right after asking it to quit, or Node waits for the debugger to disconnect
    if (this.controlled) { try { await this.call('quit'); } catch {} setTimeout(() => this.cdp && this.cdp.close(), 150); } else killTree(this.child, 'SIGTERM');
    const r = await Promise.race([done, sleep(timeout).then(() => null)]);
    if (!r) { killTree(this.child, 'SIGKILL'); await Promise.race([done, sleep(3000)]); }
    return this.exit;
  }
  kill() { this.state = 'quitting'; killTree(this.child, 'SIGKILL'); }

  summary() {
    const c = this.logs.counts();
    return { id: this.id, name: this.name, kind: 'electron', state: this.exit ? 'exited' : this.state, controlled: this.controlled, pid: this.pid, hidden: this.hidden,
      startedAt: this.startedAt, firstWindowMs: this.firstWindowAt ? this.firstWindowAt - this.startedAt : null, firstLoadMs: this.firstLoadAt ? this.firstLoadAt - this.startedAt : null,
      errors: c.errors, warnings: c.warnings, crashes: this.crashes.length, dialogs: this.dialogs.size, exit: this.exit, windows: this.windowsCache, electron: this.info && this.info.electron };
  }
}

module.exports = { ElectronApp, LogBuffer, killTree };
