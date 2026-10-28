// Bench — Mac and Linux virtual machines on Apple Silicon, through Tart (github.com/cirruslabs/tart, free for
// personal use). Bench downloads Tart into its own folder the first time, keeps its VMs in Bench's data folder
// (TART_HOME), clones a clean copy per desk (instant on APFS), and runs each VM with its built-in VNC screen.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { download } = require('./download');
const { parseVncUrl } = require('./rfb');

const TART_URL = 'https://github.com/cirruslabs/tart/releases/latest/download/tart.tar.gz';
const IMAGES = [
  { id: 'macos-tahoe', os: 'mac', label: 'macOS Tahoe', sub: 'macOS 26 · clean desktop, Xcode not included · needs this Mac on macOS 26', ref: 'ghcr.io/cirruslabs/macos-tahoe-base:latest', download: '≈ 20 GB', disk: 50, minDarwin: 25 },
  { id: 'macos-sequoia', os: 'mac', label: 'macOS Sequoia', sub: 'macOS 15 · clean desktop', ref: 'ghcr.io/cirruslabs/macos-sequoia-base:latest', download: '≈ 18 GB', disk: 50 },
  { id: 'ubuntu', os: 'linux', label: 'Ubuntu', sub: 'Ubuntu 24.04 LTS · command line (add a desktop with apt)', ref: 'ghcr.io/cirruslabs/ubuntu:latest', download: '≈ 1 GB', disk: 20 },
];
const USER = { username: 'admin', password: 'admin' };

class TartEngine {
  constructor({ engineDir, home, log = () => {} }) { this.engineDir = engineDir; this.home = home; this.log = log; this.running = new Map(); }
  supported() {
    if (process.platform !== 'darwin') return { ok: false, why: 'Mac and Linux VMs run on a Mac with Apple Silicon' };
    if (process.arch !== 'arm64') return { ok: false, why: 'Mac and Linux VMs need Apple Silicon (M1 or newer)' };
    if (+os.release().split('.')[0] < 22) return { ok: false, why: 'Mac and Linux VMs need macOS 13 Ventura or newer' };
    return { ok: true };
  }
  bin() {
    const own = path.join(this.engineDir, 'tart.app', 'Contents', 'MacOS', 'tart');
    return [own, '/opt/homebrew/bin/tart', '/usr/local/bin/tart'].find((p) => fs.existsSync(p)) || null;
  }
  env() { fs.mkdirSync(this.home, { recursive: true }); return { ...process.env, TART_HOME: this.home, TART_NO_AUTO_PRUNE: '1' }; }
  run(args, { timeout = 600000, onOut } = {}) {
    const bin = this.bin(); if (!bin) return Promise.reject(new Error('Tart isn’t installed yet'));
    return new Promise((resolve, reject) => {
      const p = spawn(bin, args, { env: this.env(), stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      const t = setTimeout(() => { p.kill('SIGTERM'); reject(new Error(`tart ${args[0]} took too long`)); }, timeout);
      p.stdout.on('data', (d) => { out += d; onOut && onOut(d.toString()); });
      p.stderr.on('data', (d) => { err += d; onOut && onOut(d.toString()); });
      p.on('error', (e) => { clearTimeout(t); reject(e); });
      p.on('close', (code) => { clearTimeout(t); if (code === 0) resolve(out); else reject(new Error((err || out).trim().split('\n').slice(-3).join(' ') || `tart ${args[0]} failed (${code})`)); });
    });
  }
  async status() {
    const s = this.supported(); const bin = this.bin();
    let version = null; if (bin) { try { version = (await this.run(['--version'], { timeout: 15000 })).trim(); } catch {} }
    return { kind: 'tart', supported: s.ok, why: s.why || null, installed: !!bin, version, home: this.home };
  }
  async install(progress = () => {}) {
    if (!this.supported().ok) throw new Error(this.supported().why);
    const tgz = path.join(this.engineDir, 'tart.tar.gz');
    await download(TART_URL, tgz, { onProgress: (p) => progress({ label: 'Downloading Tart', pct: p.pct }) });
    progress({ label: 'Unpacking Tart', pct: null });
    await new Promise((res, rej) => execFile('tar', ['-xzf', tgz, '-C', this.engineDir], (e) => (e ? rej(e) : res())));
    fs.rmSync(tgz, { force: true });
    if (!this.bin()) throw new Error('Tart unpacked, but its program wasn’t where Bench expected');
    return this.status();
  }
  async list() { try { return JSON.parse(await this.run(['list', '--format', 'json'], { timeout: 30000 })); } catch { return []; } }
  async images() {
    const l = await this.list();
    return IMAGES.map((im) => { const hit = l.find((v) => /oci/i.test(v.Source || '') && this.isImage(v.Name, im)); return { ...im, pulled: !!hit, size: hit ? hit.Size || hit.Disk : null, needsNewerMac: !!(im.minDarwin && +os.release().split('.')[0] < im.minDarwin) }; });
  }
  async pull(ref, progress = () => {}) {
    let lastPct = null;
    await this.run(['pull', ref], { timeout: 6 * 3600 * 1000, onOut: (s) => {
      const m = s.match(/(\d{1,3}(?:\.\d+)?)%/g); if (m) { const v = parseFloat(m[m.length - 1]) / 100; if (v !== lastPct) { lastPct = v; progress({ label: 'Downloading the system', pct: v }); } }
      else if (/pulling|decompress|unpack/i.test(s)) progress({ label: s.trim().split('\n').pop().slice(0, 80), pct: lastPct });
    } });
  }
  vmName(rec) { return `bench-${rec.id}`; }
  cleanName(rec) { return `bench-${rec.id}-clean`; }
  image(rec) { return IMAGES.find((i) => i.id === (rec.vm && rec.vm.image)) || IMAGES.find((i) => i.id === this.defaultImage()); }
  async exists(name) { return (await this.list()).some((v) => v.Name === name); }
  async create(rec, progress = () => {}) {
    const im = this.image(rec);
    const imgs = await this.images();
    if (!imgs.find((i) => i.id === im.id).pulled) { progress({ label: `Downloading ${im.label} (${im.download}, once)`, pct: 0 }); await this.pull(im.ref, progress); }
    progress({ label: 'Making this desk’s copy', pct: null });
    if (await this.exists(this.vmName(rec))) await this.run(['delete', this.vmName(rec)]);
    await this.run(['clone', im.ref, this.vmName(rec)]);
    await this.configure(rec);
  }
  async configure(rec) {
    const v = rec.vm || {}; const args = ['set', this.vmName(rec)];
    if (v.cpu) args.push('--cpu', String(v.cpu));
    if (v.memoryGB) args.push('--memory', String(Math.round(v.memoryGB * 1024)));
    if (v.display) args.push('--display', v.display);
    if (args.length > 2) await this.run(args, { timeout: 60000 });
  }
  /** Starts the desk's VM and hands back how to reach its screen and shell. */
  async start(rec, { log = () => {}, progress = () => {} } = {}) {
    const name = this.vmName(rec);
    if (!(await this.exists(name))) await this.create(rec, progress);
    else await this.configure(rec).catch((e) => log('warning', `Couldn’t apply CPU/memory settings: ${e.message}`));
    progress({ label: 'Booting', pct: null });
    const args = ['run', name, '--no-graphics', '--vnc-experimental'];
    if (rec.vm && rec.vm.shareDir) args.push('--dir', `bench:${rec.vm.shareDir}`);
    const child = spawn(this.bin(), args, { env: this.env(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let exited = null;
    const onOut = (d) => { out += d.toString(); for (const line of d.toString().split('\n')) if (line.trim() && !/vnc:\/\//.test(line)) log('info', line.trim()); };
    child.stdout.on('data', onOut); child.stderr.on('data', onOut);
    const handle = { child, onExit: null };
    child.on('exit', (code, sig) => { exited = { code, sig }; this.running.delete(rec.id); handle.onExit && handle.onExit(sig ? `killed (${sig})` : `exited (${code})${out ? ': ' + out.trim().split('\n').pop() : ''}`); });
    this.running.set(rec.id, child);
    const t0 = Date.now(); let url = null;
    while (!url && !exited && Date.now() - t0 < 120000) { const m = /(vnc:\/\/[^\s]+?)(?:\.\.\.|\s|$)/.exec(out); if (m) url = m[1]; else await new Promise((r) => setTimeout(r, 200)); }
    if (!url) { try { child.kill(); } catch {} throw new Error(exited ? `The VM didn’t start: ${out.trim().split('\n').slice(-2).join(' ') || 'tart exited'}` : 'The VM’s screen didn’t come up'); }
    const vnc = parseVncUrl(url);
    progress({ label: 'Waiting for the network', pct: null });
    let ip = null; try { ip = (await this.run(['ip', name, '--wait', '180'], { timeout: 200000 })).trim(); } catch (e) { log('warning', `No IP address yet: ${e.message}`); }
    return Object.assign(handle, {
      vnc, ip, vncUrlSafe: `vnc://127.0.0.1:${vnc.port}`,
      ssh: ip ? { host: ip, port: 22, ...USER } : null,
      stop: async () => {
        try { await this.run(['stop', name, '--timeout', '30'], { timeout: 60000 }); } catch {}
        if (!exited) { try { child.kill('SIGTERM'); } catch {} }
      },
    });
  }
  async reset(rec) {
    const name = this.vmName(rec); const from = (rec.vm && rec.vm.resetFrom) || this.image(rec).ref;
    if (await this.exists(name)) await this.run(['delete', name]);
    await this.run(['clone', from, name]); await this.configure(rec);
  }
  /** Makes the current state the one Reset goes back to. */
  async saveClean(rec) {
    const name = this.vmName(rec), clean = this.cleanName(rec);
    if (this.running.has(rec.id)) throw new Error('Stop the desk first, then save it as the clean copy');
    if (await this.exists(clean)) await this.run(['delete', clean]);
    await this.run(['clone', name, clean]); return clean;
  }
  async remove(rec) { for (const n of [this.vmName(rec), this.cleanName(rec)]) if (await this.exists(n)) await this.run(['delete', n]).catch(() => {}); }
  isImage(name, im) { const repo = im.ref.replace(/:[^/:]+$/, ''); return name === im.ref || name.startsWith(repo + ':') || name.startsWith(repo + '@'); }
  /** Deletes the tag and the digest copy it points at (deleting only the tag frees nothing). */
  async removeImage(id) { const im = IMAGES.find((i) => i.id === id); if (!im) return; for (const v of await this.list()) if (/oci/i.test(v.Source || '') && this.isImage(v.Name, im)) await this.run(['delete', v.Name]).catch(() => {}); }
  /** A system newer than this Mac's own macOS won't boot, so the default follows the Mac. */
  defaultImage() { return +os.release().split('.')[0] >= 25 ? 'macos-tahoe' : 'macos-sequoia'; }
  /** VMs left running by a Bench that quit unexpectedly. */
  async stopStrays() { for (const v of await this.list()) if (/^bench-/.test(v.Name) && /running/i.test(v.State || v.Running || '')) await this.run(['stop', v.Name]).catch(() => {}); }
}

module.exports = { TartEngine, IMAGES: IMAGES, TART_USER: USER };
