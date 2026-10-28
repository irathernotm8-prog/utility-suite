// Bench — a desk you drive by its whole screen: a Mac or Linux VM (Tart) or any computer reachable by VNC.
// The screen comes over VNC (rfb.js); commands and file copies go over SSH (ssh.js) when it's set up.
'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { RfbClient, parseVncUrl } = require('./rfb');
const { Ssh, sq } = require('./ssh');
const { LogBuffer } = require('./electron-app');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class ScreenDesk extends EventEmitter {
  /** rec: the desk record. engine: { start(rec, log) → {vnc, ssh:{host,port,user,password}, stop()} } for VMs; null for a plain VNC desk. */
  constructor(rec, { engine = null, dir } = {}) {
    super();
    this.rec = rec; this.engine = engine; this.dir = dir; this.state = 'stopped'; this.rfb = null; this.ssh = null; this.vm = null;
    this.logs = new LogBuffer(2000); this.shotScale = 1; this.detail = '';
    this.guest = rec.kind === 'mac-vm' ? 'mac' : rec.kind === 'linux-vm' ? 'linux' : (rec.remote && rec.remote.os) || 'unknown';
  }
  log(level, text) { this.emit('log', this.logs.add({ source: 'desk', level, text })); }
  setState(s, detail = '') { this.state = s; this.detail = detail; this.emit('state', { state: s, detail }); }

  async start({ progress = () => {} } = {}) {
    if (this.state === 'running' || this.state === 'starting') return;
    this.setState('starting', this.engine ? 'Starting the virtual machine' : 'Connecting');
    try {
      let vnc, ssh;
      if (this.engine) {
        this.vm = await this.engine.start(this.rec, { log: (l, t) => this.log(l, t), progress: (p) => { this.setState('starting', p.label || 'Starting'); progress(p); } });
        vnc = this.vm.vnc; ssh = this.vm.ssh;
        this.vm.onExit = (why) => { if (this.state !== 'stopping' && this.state !== 'stopped') { this.log('error', `The virtual machine stopped: ${why}`); this._teardown(); this.setState('stopped', why); } };
      } else {
        const r = this.rec.remote || {};
        vnc = { host: r.host || '127.0.0.1', port: +r.vncPort || 5900, password: r.vncPassword || '' };
        if (r.sshUser) ssh = { host: r.host || '127.0.0.1', port: +r.sshPort || 22, username: r.sshUser, password: r.sshPassword || '' };
      }
      this.setState('starting', 'Connecting to the screen');
      const rfb = new RfbClient({ host: vnc.host, port: vnc.port, password: vnc.password });
      let lastErr;
      for (let i = 0; i < (this.engine ? 40 : 2); i++) { try { await rfb.connect(); lastErr = null; break; } catch (e) { lastErr = e; await sleep(1500); } }
      if (lastErr) throw lastErr;
      this.rfb = rfb; rfb.interval = 33;
      rfb.on('update', () => this.emit('frame'));
      rfb.on('close', () => { if (this.state === 'running') { this.log('warning', 'The screen connection closed'); this.rfb = null; this.emit('changed'); this._reconnect(vnc); } });
      rfb.on('error', (e) => this.log('warning', `Screen: ${e.message}`));
      if (ssh) this.ssh = new Ssh(ssh);
      this.log('info', `Connected to ${rfb.name || 'the screen'} (${rfb.width}×${rfb.height})`);
      this.setState('running');
      if (this.ssh) this.ssh.waitReady(this.engine ? 240000 : 15000).then(() => { this.log('info', 'Commands are ready (SSH)'); this.emit('changed'); }).catch((e) => this.log('warning', `Commands aren’t available: ${e.message}`));
    } catch (e) {
      this._teardown(); if (this.vm && this.vm.stop) await this.vm.stop().catch(() => {});
      this.setState('error', e.message); throw e;
    }
  }
  async _reconnect(vnc) {
    for (let i = 0; i < 10 && this.state === 'running' && !this.rfb; i++) {
      await sleep(2000);
      try { const r = new RfbClient(vnc); await r.connect(); r.interval = 33; r.on('update', () => this.emit('frame')); this.rfb = r; this.log('info', 'Screen reconnected'); this.emit('changed'); return; } catch {}
    }
  }
  _teardown() { try { this.rfb && this.rfb.close(); } catch {} this.rfb = null; try { this.ssh && this.ssh.close(); } catch {} this.ssh = null; }
  async stop() {
    if (this.state === 'stopped') return;
    this.setState('stopping', this.engine ? 'Shutting down' : 'Disconnecting');
    this._teardown();
    if (this.vm && this.vm.stop) await this.vm.stop().catch((e) => this.log('warning', e.message));
    this.vm = null; this.setState('stopped');
  }
  async reset(opts) {
    if (!this.engine || !this.engine.reset) throw new Error('Only virtual machine desks can be reset');
    await this.stop(); this.setState('starting', 'Going back to the clean copy');
    await this.engine.reset(this.rec, opts || {}); this.setState('stopped', 'Clean');
  }
  _need() { if (!this.rfb || this.state !== 'running') throw new Error(`${this.rec.name} isn’t running. Start it first.`); return this.rfb; }
  _needSsh() { if (!this.ssh) throw new Error(`${this.rec.name} has no command access (SSH isn’t set up for it)`); return this.ssh; }
  _pt(x, y) { return { x: Math.round(x * this.shotScale), y: Math.round(y * this.shotScale) }; }

  get size() { return this.rfb ? { width: this.rfb.width, height: this.rfb.height } : null; }
  async screenshot({ maxSide = 1600, settle = true } = {}) {
    const r = this._need(); if (settle) await r.settle(250);
    const s = r.snapshot({ maxSide }); this.shotScale = s.scale;
    return { buffer: s.png, width: s.width, height: s.height, scale: s.scale, mime: 'image/png', title: this.rec.name };
  }
  /** Raw RGBA of the screen for the live view (no copying of unchanged frames). */
  frameRgba() { const r = this.rfb; return r && r.fb ? { data: r.fb, width: r.width, height: r.height, seq: r.updates } : null; }
  async click({ x, y, button = 'left', count = 1, raw = false }) { const r = this._need(); const p = raw ? { x, y } : this._pt(x, y); await r.click(p.x, p.y, { button, count }); return p; }
  async move({ x, y, raw = false }) { const r = this._need(); const p = raw ? { x, y } : this._pt(x, y); r.pointer(p.x, p.y, 0); return p; }
  async pointer({ x, y, buttons }) { const r = this._need(); r.pointer(x, y, buttons); }
  async drag({ x1, y1, x2, y2 }) { const r = this._need(); const a = this._pt(x1, y1), b = this._pt(x2, y2); await r.drag(a.x, a.y, b.x, b.y); return { from: a, to: b }; }
  async scroll({ x, y, dx = 0, dy = 0 }) { const r = this._need(); const p = this._pt(x, y); await r.scroll(p.x, p.y, dx, dy); return p; }
  async type({ text }) { await this._need().type(text); }
  async press({ keys, repeat = 1 }) { const r = this._need(); for (let i = 0; i < Math.max(1, Math.min(50, repeat)); i++) await r.press(keys, { mac: this.guest === 'mac' }); }
  async key({ keysym, down }) { this._need().keyEvent(keysym, down); }

  async run(command, { timeout = 120000, cwd } = {}) {
    const s = this._needSsh();
    const full = cwd ? `cd ${sq(cwd)} && ${command}` : command;
    this.log('info', `$ ${command}`);
    const r = await s.exec(this.guest === 'mac' ? `/bin/zsh -lc ${sq(full)}` : this.guest === 'linux' ? `bash -lc ${sq(full)}` : full, { timeout });
    return { code: r.code, timedOut: !!r.timedOut, ms: r.ms, output: (r.stdout || '') + (r.stderr ? (r.stdout ? '\n' : '') + r.stderr : '') };
  }
  async copyIn(local, remote) {
    const s = this._needSsh();
    if (!remote) remote = this.guest === 'mac' ? `/Users/${(this.vm && this.vm.ssh && this.vm.ssh.username) || 'admin'}/Desktop/${path.basename(local)}` : `/tmp/${path.basename(local)}`;
    const n = await s.upload(local, remote); return { files: n, to: remote };
  }
  async copyOut(remote, local) { const s = this._needSsh(); const n = await s.download(remote, local); return { files: n, to: local }; }

  /** Opens an app in the desk: an app already in it (by name or path), or an installer / app / zip from this computer. */
  async launch(spec) {
    this._need();
    if (spec.url) {
      if (this.guest === 'mac') return this._ok(await this.run(`open ${sq(spec.url)}`), `Opened ${spec.url}`);
      if (this.guest === 'linux') return this._ok(await this.run(`DISPLAY=:0 xdg-open ${sq(spec.url)} >/dev/null 2>&1 &`), `Opened ${spec.url}`);
    }
    if (spec.command) return this.run(spec.command, { timeout: (spec.wait_seconds || 120) * 1000 });
    if (spec.file) { // something on this computer: copy it in, install it, open it
      const local = spec.file; if (!fs.existsSync(local)) throw new Error(`Nothing at ${local}`);
      const base = path.basename(local);
      if (this.guest === 'mac') {
        const tmp = `/tmp/bench-in-${Date.now()}`; await this.run(`mkdir -p ${sq(tmp)}`);
        await this._needSsh().upload(local, `${tmp}/${base}`);
        const pw = sq((this.vm && this.vm.ssh && this.vm.ssh.password) || 'admin');
        const low = base.toLowerCase();
        // Every step is checked, and nothing in /Applications is removed unless an app name was found (never "/Applications/").
        const findApp = (dir) => `{ APP=$(find ${dir} -maxdepth 3 -name '*.app' -type d -prune 2>/dev/null | head -1) && [ -n "$APP" ] && NAME=$(basename "$APP") && [ -n "$NAME" ] && [ "$NAME" != ".app" ] || { echo "NOAPP: no .app inside ${base}"; false; }; }`;
        const place = `rm -rf "/Applications/$NAME" && cp -R "$APP" /Applications/`;
        const quarantine = spec.quarantine ? ` && xattr -w com.apple.quarantine "0081;$(printf %x $(date +%s));Bench;" "/Applications/$NAME"` : '';
        let steps;
        if (low.endsWith('.dmg')) steps = `MNT="$PWD/mnt" && mkdir -p "$MNT" && yes | hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$MNT" ${sq(base)} >/dev/null && { ${findApp('"$MNT"')} && ${place}${quarantine}; RC=$?; hdiutil detach "$MNT" -quiet || hdiutil detach "$MNT" -force -quiet; [ $RC -eq 0 ]; } && open -a "/Applications/$NAME" && echo "OPENED:$NAME"`;
        else if (low.endsWith('.zip')) steps = `mkdir -p x && ditto -x -k ${sq(base)} x && ${findApp('x')} && ${place}${quarantine} && open -a "/Applications/$NAME" && echo "OPENED:$NAME"`;
        else if (low.endsWith('.app')) steps = `APP=${sq(base)} && NAME=$(basename "$APP") && ${place}${quarantine} && open -a "/Applications/$NAME" && echo "OPENED:$NAME"`;
        else if (low.endsWith('.pkg')) steps = `sudo -S installer -pkg ${sq(base)} -target / <<< ${pw} && echo INSTALLED`;
        else steps = `chmod +x ${sq(base)} 2>/dev/null; echo "COPIED:${tmp}/${base}"`;
        const script = `cd ${sq(tmp)} && ${steps}`;
        const r = await this.run(script, { timeout: 600000 });
        const m = /OPENED:(.+)/.exec(r.output);
        if (!m && r.code !== 0) throw new Error(`Couldn’t install ${base}: ${r.output.slice(-800)}`);
        const c = /COPIED:(.+)/.exec(r.output);
        return { ok: true, text: m ? `Installed and opened ${m[1].trim()}` : c ? `Copied ${base} to ${c[1].trim()} (not an app, dmg, zip or pkg)` : `Installed ${base}`, output: r.output };
      }
      if (this.guest === 'linux') {
        const dest = `/home/${(this.vm && this.vm.ssh && this.vm.ssh.username) || 'admin'}/Desktop/${base}`;
        await this.run('mkdir -p ~/Desktop'); await this._needSsh().upload(local, dest);
        return { ok: true, text: `Copied ${base} to the desktop (${dest}). Install or run it with run_command.` };
      }
      const r = await this.copyIn(local); return { ok: true, text: `Copied ${base} to ${r.to}` };
    }
    const name = spec.app || spec.path;
    if (!name) throw new Error('Say what to open');
    if (this.guest === 'mac') return this._ok(await this.run(name.startsWith('/') ? `open ${sq(name)}` : `open -a ${sq(name)}`), `Opened ${name}`);
    if (this.guest === 'linux') return this._ok(await this.run(`DISPLAY=:0 nohup ${name} >/dev/null 2>&1 &`), `Started ${name}`);
    throw new Error('On this desk, open apps by clicking on its screen, or set up SSH to start them by command');
  }
  _ok(r, text) { if (r.code !== 0) throw new Error(r.output.trim().slice(-600) || `Failed (code ${r.code})`); return { ok: true, text }; }

  summary() {
    return { id: this.rec.id, state: this.state, detail: this.detail, screen: this.size, commands: !!(this.ssh && this.ssh.conn), ip: this.vm && this.vm.ip, vnc: this.vm && this.vm.vncUrlSafe };
  }
}

module.exports = { ScreenDesk, parseVncUrl };
