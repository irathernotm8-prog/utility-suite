// Starts, watches and stops emulator processes, one per running device, each on its own ports.
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { avdName } = require('./avd');
const { EmulatorClient } = require('./grpc');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

// Pure: the command line for one device. Kept separate so it can be checked in tests.
function buildArgs(dev, { port, grpcPort, window = 'hidden', wipe = false, coldBoot = false }) {
  const a = ['-avd', avdName(dev), '-port', String(port), '-grpc', String(grpcPort), '-grpc-use-token'];
  if (window === 'hidden') a.push('-qt-hide-window');
  else if (window === 'none') a.push('-no-window');
  a.push('-gpu', dev.options?.gpu || 'auto');
  if (dev.options?.audio === false) a.push('-no-audio');
  if (wipe) a.push('-wipe-data');
  if (coldBoot || dev.options?.quickBoot === false) a.push('-no-snapshot-load');
  if (dev.options?.quickBoot === false) a.push('-no-snapshot-save');
  const n = dev.network || {};
  if (n.mode === 'proxy' && n.proxy) a.push('-http-proxy', normalizeProxy(n.proxy));
  if (n.mode === 'isolated') a.push('-wifi-user-mode-options', 'restrict=on', '-network-user-mode-options', 'restrict=on');
  if (n.dns) a.push('-dns-server', n.dns);
  if (n.speed && n.speed !== 'full') a.push('-netspeed', n.speed);
  if (n.delay && n.delay !== 'none') a.push('-netdelay', n.delay);
  return a;
}

function normalizeProxy(p) {
  let s = String(p).trim();
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s;
}

function discoveryDirs() {
  const h = os.homedir();
  const d = [path.join(h, '.android', 'avd', 'running')];
  if (process.env.ANDROID_EMULATOR_HOME) d.push(path.join(process.env.ANDROID_EMULATOR_HOME, 'avd', 'running'));
  if (process.platform === 'darwin') d.push(path.join(h, 'Library', 'Caches', 'TemporaryItems', 'avd', 'running'));
  if (process.platform === 'win32') d.push(path.join(process.env.LOCALAPPDATA || path.join(h, 'AppData', 'Local'), 'Temp', 'avd', 'running'));
  if (process.env.XDG_RUNTIME_DIR) d.push(path.join(process.env.XDG_RUNTIME_DIR, 'avd', 'running'));
  d.push(path.join(os.tmpdir(), 'avd', 'running'), path.join(os.tmpdir(), `android-${os.userInfo().username}`, 'avd', 'running'));
  return [...new Set(d)];
}

function parseIni(text) {
  const o = {};
  for (const l of String(text).split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  return o;
}

// Finds the discovery file of the emulator we just started. Old files from emulators that crashed or
// were killed can linger with the same port, so only a file written after `since` by a live process counts.
function findDiscovery(port, hint, since = 0) {
  const files = [];
  if (hint && fs.existsSync(hint)) files.push(hint);
  for (const dir of discoveryDirs()) { try { for (const f of fs.readdirSync(dir)) if (/^pid_\d+\.ini$/.test(f)) files.push(path.join(dir, f)); } catch {} }
  for (const f of files) {
    try {
      if (fs.statSync(f).mtimeMs < since - 2000) continue;
      const pid = +(path.basename(f).match(/\d+/) || [0])[0];
      if (pid && !alive(pid)) continue;
      const ini = parseIni(fs.readFileSync(f, 'utf8'));
      if (ini['port.serial'] === String(port)) return { file: f, ...ini };
    } catch {}
  }
  return null;
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

// Turns the emulator's own log into something a person can act on.
function explainFailure(log, platform = process.platform) {
  const L = log || '';
  if (/requires hardware acceleration|HVF error|hvf.*not supported|HAXM|Hypervisor.*not/i.test(L) || /WHPX|AEHD|Windows Hypervisor Platform/i.test(L) && /not|fail|unavailable/i.test(L)) {
    return platform === 'win32'
      ? 'Virtualization is off on this PC. Turn on "Windows Hypervisor Platform" in Windows Features (and virtualization in your BIOS), then restart.'
      : 'This Mac could not start the virtual machine. Restart the Mac and try again.';
  }
  if (/same AVD|already running|is already in use/i.test(L)) return 'This device is already running in another emulator. Close it there first.';
  if (/not enough space|No space left|ENOSPC/i.test(L)) return 'Your disk is full. Free some space, or give the device less storage.';
  if (/Not enough memory|Cannot allocate memory|could not allocate/i.test(L)) return 'Not enough free memory for this device. Close other devices or apps, or give it less RAM.';
  if (/Cannot find AVD system path|SDK system image|system image.*missing|kernel.*not found/i.test(L)) return 'The Android system image for this device is missing. Open the device and Droid will download it again.';
  if (/broken AVD system path|Unknown AVD name/i.test(L)) return 'The emulator could not read this device. Edit it and save to rebuild it.';
  if (/qemu.*killed|Segmentation fault|crashed/i.test(L)) return 'The emulator crashed. Try Cold boot from the device menu, or set Graphics to Software in Edit device.';
  return null;
}

class Runner extends EventEmitter {
  constructor({ sdk, avdHome, adb, settings }) {
    super();
    this.sdk = sdk; this.avdHome = avdHome; this.adb = adb; this.settings = settings || (() => ({}));
    this.live = new Map();   // device id -> session
  }

  env() {
    return { ...process.env, ANDROID_SDK_ROOT: this.sdk.root, ANDROID_HOME: this.sdk.root, ANDROID_AVD_HOME: this.avdHome };
  }

  session(id) { return this.live.get(id) || null; }
  list() { return [...this.live.values()].map(pub); }

  async pickPorts() {
    const used = new Set([...this.live.values()].flatMap((s) => [s.port, s.port + 1, s.grpcPort]));
    let port = null, grpcPort = null;
    for (let p = 5554; p <= 5680; p += 2) if (!used.has(p) && await isFree(p) && await isFree(p + 1)) { port = p; break; }
    for (let g = 8554; g <= 8654; g++) if (!used.has(g) && await isFree(g)) { grpcPort = g; break; }
    if (!port || !grpcPort) throw new Error('No free ports for another device. Stop one first.');
    return { port, grpcPort };
  }

  async start(dev, { wipe = false, coldBoot = false } = {}) {
    if (this.live.has(dev.id)) return pub(this.live.get(dev.id));
    const { port, grpcPort } = await this.pickPorts();
    const win = this.settings().emulatorWindow || 'hidden';
    const args = [...buildArgs(dev, { port, grpcPort, window: win, wipe, coldBoot }), ...String(process.env.DROID_EMU_ARGS || '').split(' ').filter(Boolean)];
    const s = { id: dev.id, dev, port, grpcPort, serial: `emulator-${port}`, state: 'starting', log: '', startedAt: Date.now(), client: null, proc: null, stopping: false, hint: null, booted: false };
    this.live.set(dev.id, s);
    this.emit('state', pub(s));

    const ec = this.sdk.emulatorCmd ? this.sdk.emulatorCmd() : { cmd: this.sdk.emulatorBin, pre: [], env: {} };
    const proc = spawn(ec.cmd, [...ec.pre, ...args], { env: { ...this.env(), ...ec.env }, windowsHide: true, cwd: ec.cwd || path.dirname(this.sdk.emulatorBin) });
    s.proc = proc;
    const onOut = (d) => {
      const t = String(d);
      s.log = (s.log + t).slice(-24000);
      const m = t.match(/Advertising in: (.+?\.ini)/);
      if (m) s.hint = m[1].trim();
    };
    proc.stdout.on('data', onOut); proc.stderr.on('data', onOut);
    proc.on('error', (e) => { s.log += '\n' + e.message; });
    proc.on('exit', (code, signal) => {
      const was = s.state;
      s.state = 'stopped';
      try { s.client && s.client.close(); } catch {}
      this.live.delete(dev.id);
      const failed = !s.stopping && was !== 'running';
      const crashed = !s.stopping && was === 'running';
      this.emit('exit', { id: dev.id, code, signal, failed, crashed, reason: failed || crashed ? (explainFailure(s.log) || lastLines(s.log)) : null });
      this.emit('state', { id: dev.id, state: 'stopped' });
    });

    // Find the gRPC token the emulator advertises, then wait for Android to finish booting.
    (async () => {
      let disc = null;
      for (let i = 0; i < 120 && this.live.get(dev.id) === s && !disc; i++) { await sleep(500); disc = findDiscovery(port, s.hint, s.startedAt); }
      if (this.live.get(dev.id) !== s) return;
      s.client = new EmulatorClient({ port: disc?.['grpc.port'] || grpcPort, token: disc?.['grpc.token'], protoDir: this.sdk.protoDir });
      try { await s.client.waitReady(30000); } catch {}
      s.state = 'booting';
      this.emit('state', pub(s));
      const deadline = Date.now() + 8 * 60000;
      while (this.live.get(dev.id) === s && Date.now() < deadline) {
        let booted = false;
        try { booted = (await s.client.status()).booted; } catch {}
        if (!booted) booted = await this.adb.booted(s.serial).catch(() => false);
        if (booted) break;
        await sleep(1000);
      }
      if (this.live.get(dev.id) !== s) return;
      s.state = 'running'; s.booted = true; s.bootedAt = Date.now();
      this.emit('state', pub(s));
      this.emit('booted', pub(s));
    })().catch((e) => { s.log += '\n' + e.message; });

    return pub(s);
  }

  async stop(id, { force = false } = {}) {
    const s = this.live.get(id);
    if (!s) return;
    s.stopping = true; s.state = 'stopping';
    this.emit('state', pub(s));
    if (!force) {
      // "emu kill" lets the emulator save Quick Boot state before it exits.
      await this.adb.emu(s.serial, 'kill').catch(() => s.client && s.client.vmState('SHUTDOWN').catch(() => {}));
      for (let i = 0; i < 60 && this.live.has(id); i++) await sleep(500);
    }
    if (this.live.has(id)) killTree(s.proc);
  }

  async stopAll() { await Promise.all([...this.live.keys()].map((id) => this.stop(id))); }
  killAll() { for (const s of this.live.values()) killTree(s.proc); }
}

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
  else { try { proc.kill('SIGTERM'); } catch {} setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 4000); }
}

const lastLines = (log) => (log || '').split('\n').map((l) => l.trim()).filter((l) => /ERROR|FATAL|error:/i.test(l)).slice(-2).join(' ') || 'The emulator stopped unexpectedly.';
const pub = (s) => ({ id: s.id, state: s.state, port: s.port, grpcPort: s.grpcPort, serial: s.serial, startedAt: s.startedAt, bootedAt: s.bootedAt || null });

module.exports = { Runner, buildArgs, normalizeProxy, findDiscovery, explainFailure, discoveryDirs, parseIni, isFree };
