// Bench — a clean, throwaway Windows desktop through Windows Sandbox (Windows 10/11 Pro, Enterprise or Education).
// Bench writes a .wsb file that maps the desk's share folder to C:\Bench and runs bench-agent.ps1 at sign-in; the
// agent takes screenshots, moves the mouse, types and runs commands, answering through that folder. Every start is
// a fresh Windows, so Reset is just Stop and Start.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const { LogBuffer } = require('./electron-app');
const { parseCombo, vkFor, MOD_VK } = require('./keys');
const { newId } = require('./store');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SYS = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The .wsb configuration for a desk. */
function wsbConfig({ share, memoryMB, network = true, gpu = true, clipboard = true }) {
  return `<Configuration>
  <VGpu>${gpu ? 'Enable' : 'Disable'}</VGpu>
  <Networking>${network ? 'Enable' : 'Disable'}</Networking>
  <ClipboardRedirection>${clipboard ? 'Enable' : 'Disable'}</ClipboardRedirection>
  ${memoryMB ? `<MemoryInMB>${Math.round(memoryMB)}</MemoryInMB>` : ''}
  <MappedFolders>
    <MappedFolder>
      <HostFolder>${xml(share)}</HostFolder>
      <SandboxFolder>C:\\Bench</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\\Bench\\bench-agent.ps1</Command>
  </LogonCommand>
</Configuration>
`;
}

/** Talks to bench-agent.ps1 through the share folder. */
class AgentClient {
  constructor(share) { this.share = share; this.inDir = path.join(share, 'in'); this.outDir = path.join(share, 'out'); }
  reset() { for (const d of [this.inDir, this.outDir]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); } try { fs.rmSync(path.join(this.share, 'agent.json'), { force: true }); } catch {} }
  heartbeat() {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(this.share, 'agent.json'), 'utf8').replace(/^\uFEFF/, ''));
      const key = j.beat != null ? j.beat : j.t; const now = Date.now();
      if (key !== this._lastKey) { this._lastKey = key; this._seen = now; }
      return now - (this._seen || 0) < 8000 ? j : null; // the sandbox's clock may differ from this one, so watch the beat change instead
    } catch { return null; }
  }
  async waitReady(timeoutMs = 240000, onWait = () => {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) { const h = this.heartbeat(); if (h) return h; onWait(Date.now() - t0); await sleep(1000); }
    throw new Error('Windows Sandbox started, but Bench’s helper inside it didn’t check in');
  }
  async send(op, args = {}, { timeout = 30000 } = {}) {
    const id = newId('j'); const job = { id, op, ...args };
    const tmp = path.join(this.inDir, id + '.tmp'); fs.writeFileSync(tmp, JSON.stringify(job)); fs.renameSync(tmp, path.join(this.inDir, id + '.json'));
    const out = path.join(this.outDir, id + '.json'); const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (fs.existsSync(out)) {
        let r; try { r = JSON.parse(fs.readFileSync(out, 'utf8').replace(/^\uFEFF/, '')); } catch { await sleep(30); continue; }
        fs.rmSync(out, { force: true });
        if (!r.ok) throw new Error(r.error || (typeof r.result === 'string' ? r.result : 'The Windows helper failed'));
        return { id, result: r.result };
      }
      await sleep(op === 'screenshot' ? 25 : 40);
    }
    throw new Error(`Windows Sandbox didn’t answer (${op})`);
  }
}

class WinSandboxEngine {
  status() {
    if (process.platform !== 'win32') return { kind: 'winsandbox', supported: false, installed: false, why: 'Windows Sandbox runs on a Windows PC' };
    const exe = path.join(SYS(), 'WindowsSandbox.exe');
    const on = fs.existsSync(exe);
    return { kind: 'winsandbox', supported: true, installed: on, why: on ? null : 'Windows Sandbox is switched off. It needs Windows 10/11 Pro, Enterprise or Education.' };
  }
  /** Asks Windows (with an admin prompt) to switch the feature on. A restart follows. */
  enable() {
    return new Promise((res, rej) => execFile('powershell.exe', ['-NoProfile', '-Command', "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -Command Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -All -NoRestart'"], { windowsHide: true }, (e) => (e ? rej(new Error('Windows didn’t switch Windows Sandbox on: ' + e.message)) : res(this.status()))));
  }
  running() {
    return new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (e, out) => res(!e && /WindowsSandbox(Client|RemoteSession)?\.exe/i.test(out || ''))));
  }
  kill() { for (const im of ['WindowsSandboxClient.exe', 'WindowsSandboxRemoteSession.exe', 'WindowsSandbox.exe']) execFile('taskkill', ['/IM', im, '/F'], { windowsHide: true }, () => {}); }
  async start(rec, dir, { log = () => {}, progress = () => {}, agentSource }) {
    const st = this.status(); if (!st.installed) throw new Error(st.why);
    if (await this.running()) throw new Error('Windows Sandbox is already open (Windows allows one at a time). Close it, then start this desk.');
    const share = path.join(dir, 'share'); fs.mkdirSync(path.join(share, 'files'), { recursive: true });
    fs.copyFileSync(agentSource, path.join(share, 'bench-agent.ps1'));
    const agent = new AgentClient(share); agent.reset();
    const wsb = path.join(dir, 'desk.wsb');
    fs.writeFileSync(wsb, wsbConfig({ share, memoryMB: rec.vm && rec.vm.memoryGB ? rec.vm.memoryGB * 1024 : 0, network: !(rec.vm && rec.vm.network === 'off'), gpu: !(rec.vm && rec.vm.gpu === false) }));
    progress({ label: 'Starting Windows Sandbox' });
    const child = spawn(path.join(SYS(), 'WindowsSandbox.exe'), [wsb], { detached: true, stdio: 'ignore', windowsHide: false }); child.unref();
    try { await agent.waitReady(300000, (ms) => progress({ label: ms < 20000 ? 'Starting Windows' : 'Signing in and starting Bench’s helper' })); }
    catch (e) { this.kill(); throw e; } // don't leave a half-started sandbox open (Windows allows only one)
    log('info', 'Windows Sandbox is ready');
    const handle = { agent, share, onExit: null, stop: async () => {
      try { await agent.send('shutdown', {}, { timeout: 5000 }); } catch {}
      for (let i = 0; i < 20 && (await this.running()); i++) await sleep(1000);
      if (await this.running()) this.kill();
    } };
    const watch = setInterval(async () => { if (!agent.heartbeat() && !(await this.running())) { clearInterval(watch); handle.onExit && handle.onExit('Windows Sandbox was closed'); } }, 4000);
    handle.unwatch = () => clearInterval(watch);
    return handle;
  }
}

/** A Windows Sandbox desk: same surface as ScreenDesk, driven through the agent. */
class WinSandboxDesk extends EventEmitter {
  constructor(rec, { engine, dir, agentSource }) {
    super(); this.rec = rec; this.engine = engine; this.dir = dir; this.agentSource = agentSource;
    this.state = 'stopped'; this.detail = ''; this.vm = null; this.logs = new LogBuffer(2000); this.shotScale = 1; this.screen = null; this.guest = 'windows';
  }
  log(level, text) { this.emit('log', this.logs.add({ source: 'desk', level, text })); }
  setState(s, d = '') { this.state = s; this.detail = d; this.emit('state', { state: s, detail: d }); }
  async start({ progress = () => {} } = {}) {
    if (this.state === 'running' || this.state === 'starting') return;
    this.setState('starting', 'Starting Windows Sandbox');
    try {
      this.vm = await this.engine.start(this.rec, this.dir, { log: (l, t) => this.log(l, t), progress: (p) => { this.setState('starting', p.label); progress(p); }, agentSource: this.agentSource });
      this.vm.onExit = (why) => { if (this.state === 'running') { this.log('warning', why); this.vm = null; this.setState('stopped', why); } };
      const hb = this.vm.agent.heartbeat(); this.screen = hb ? { width: hb.width, height: hb.height } : null;
      this.setState('running');
    } catch (e) { this.setState('error', e.message); throw e; }
  }
  async stop() { if (!this.vm) { this.setState('stopped'); return; } this.setState('stopping', 'Closing Windows Sandbox'); try { this.vm.unwatch && this.vm.unwatch(); await this.vm.stop(); } finally { this.vm = null; this.setState('stopped'); } }
  async reset() { await this.stop(); this.setState('stopped', 'Windows Sandbox starts fresh every time'); }
  _agent() { if (!this.vm || this.state !== 'running') throw new Error(`${this.rec.name} isn’t running. Start it first.`); return this.vm.agent; }
  _pt(x, y) { return { x: Math.round(x * this.shotScale), y: Math.round(y * this.shotScale) }; }
  get size() { return this.screen; }
  async screenshot({ maxSide = 1600, jpeg = false } = {}) {
    const a = this._agent(); const { result: r } = await a.send('screenshot', { maxSide, fmt: jpeg ? 'jpeg' : 'png' });
    const f = path.join(a.outDir, r.file); const buffer = fs.readFileSync(f); fs.rmSync(f, { force: true });
    if (!jpeg) this.shotScale = r.scale; this.screen = { width: r.screenW, height: r.screenH };
    return { buffer, width: r.width, height: r.height, scale: r.scale, mime: jpeg ? 'image/jpeg' : 'image/png', title: this.rec.name };
  }
  async click({ x, y, button = 'left', count = 1, raw = false }) { const p = raw ? { x, y } : this._pt(x, y); await this._agent().send('click', { ...p, button, count }); return p; }
  async move({ x, y, raw = false }) { const p = raw ? { x, y } : this._pt(x, y); await this._agent().send('move', p); return p; }
  async button({ x, y, button = 'left', down }) { await this._agent().send('button', { x, y, button, down }); }
  async drag({ x1, y1, x2, y2 }) { const a = this._pt(x1, y1), b = this._pt(x2, y2); await this._agent().send('drag', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }); return { from: a, to: b }; }
  async scroll({ x, y, dx = 0, dy = 0 }) { const p = this._pt(x, y); await this._agent().send('scroll', { ...p, dx, dy }); return p; }
  async type({ text }) {
    for (const part of String(text).split(/(\n|\t)/)) {
      if (part === '\n') await this._agent().send('key', { mods: [], vk: 0x0d, char: '' });
      else if (part === '\t') await this._agent().send('key', { mods: [], vk: 0x09, char: '' });
      else if (part) await this._agent().send('type', { text: part }, { timeout: 30000 + part.length * 20 });
    }
  }
  async press({ keys, repeat = 1 }) {
    const { mods, key } = parseCombo(keys, { mac: false });
    await this._agent().send('key', { mods: mods.map((m) => MOD_VK[m]), vk: vkFor(key), char: key.length === 1 ? key : '', repeat });
  }
  async run(command, { timeout = 120000, cwd, shell } = {}) {
    this.log('info', `> ${command}`);
    const { result } = await this._agent().send('run', { command, cwd, shell, timeoutMs: timeout }, { timeout: timeout + 15000 });
    return { code: result.code, timedOut: !!result.timedOut, ms: result.ms, output: result.output || '' };
  }
  async copyIn(local, name) {
    const share = path.join(this.dir, 'share', 'files'); fs.mkdirSync(share, { recursive: true });
    const dest = path.join(share, name || path.basename(local));
    fs.cpSync(local, dest, { recursive: true });
    return { to: `C:\\Bench\\files\\${path.basename(dest)}` };
  }
  async copyOut(remote, local) {
    const a = this._agent(); const { result } = await a.send('copyout', { path: remote }, { timeout: 300000 });
    const src = path.join(a.outDir, 'files', result.folder); fs.mkdirSync(local, { recursive: true });
    for (const e of fs.readdirSync(src)) fs.cpSync(path.join(src, e), path.join(local, e), { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
    return { to: local };
  }
  async launch(spec) {
    const a = this._agent();
    if (spec.url) { await a.send('launch', { path: spec.url }); return { ok: true, text: `Opened ${spec.url}` }; }
    if (spec.command) return this.run(spec.command, { timeout: (spec.wait_seconds || 120) * 1000 });
    if (spec.file) {
      const r = await this.copyIn(spec.file);
      const { result } = await a.send('install', { path: r.to }, { timeout: 600000 });
      return { ok: true, text: String(result) };
    }
    const p = spec.app || spec.path; if (!p) throw new Error('Say what to open');
    await a.send('launch', { path: p, args: spec.args || undefined }); return { ok: true, text: `Opened ${p}` };
  }
  async windowsList() { const { result } = await this._agent().send('windows'); return Array.isArray(result) ? result : result ? [result] : []; }
  summary() { return { id: this.rec.id, state: this.state, detail: this.detail, screen: this.screen, commands: this.state === 'running' }; }
}

module.exports = { WinSandboxEngine, WinSandboxDesk, AgentClient, wsbConfig };
