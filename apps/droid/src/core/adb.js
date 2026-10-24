// adb (Android Debug Bridge) for installing apps, copying files and a few settings.
'use strict';
const { execFile, spawn } = require('child_process');
const path = require('path');

class Adb {
  constructor(bin, env = process.env, pre = []) { this.bin = bin; this.env = env; this.pre = pre; }

  run(args, { timeout = 60000, maxBuffer = 32 * 1024 * 1024, encoding = 'utf8' } = {}) {
    return new Promise((resolve, reject) => {
      execFile(this.bin, [...this.pre, ...args], { timeout, maxBuffer, encoding, windowsHide: true, env: this.env }, (err, stdout, stderr) => {
        if (err) { err.message = (String(stderr || '').trim() || String(stdout || '').trim() || err.message).split('\n').slice(-4).join(' '); return reject(err); }
        resolve(stdout);
      });
    });
  }
  s(serial, args, opts) { return this.run(['-s', serial, ...args], opts); }
  shell(serial, cmd, opts) { return this.s(serial, ['shell', cmd], opts).then((o) => String(o).replace(/\r\n/g, '\n')); }
  startServer() { return this.run(['start-server'], { timeout: 20000 }).catch(() => {}); }

  async devices() {
    const out = await this.run(['devices'], { timeout: 10000 }).catch(() => '');
    return out.split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p[0]).map(([serial, state]) => ({ serial, state }));
  }
  async state(serial) { return ((await this.devices()).find((d) => d.serial === serial) || {}).state || null; }
  async connect(hostPort) { return this.run(['connect', hostPort], { timeout: 10000 }).catch(() => ''); }

  async booted(serial) {
    const v = await this.shell(serial, 'getprop sys.boot_completed', { timeout: 8000 }).catch(() => '');
    return v.trim() === '1';
  }

  // Installs an APK, or a set of split APKs from one app (APKM / XAPK / APKS bundles).
  install(serial, apks, { onLine } = {}) {
    const list = Array.isArray(apks) ? apks : [apks];
    const args = ['-s', serial, list.length > 1 ? 'install-multiple' : 'install', '-r', '-t', ...list];
    return new Promise((resolve, reject) => {
      const p = spawn(this.bin, [...this.pre, ...args], { windowsHide: true, env: this.env });
      let out = '';
      const on = (d) => { out += d; String(d).split(/\r?\n/).filter(Boolean).forEach((l) => onLine && onLine(l)); };
      p.stdout.on('data', on); p.stderr.on('data', on);
      p.on('error', reject);
      p.on('close', (code) => {
        if (code === 0 && /Success/.test(out)) return resolve(out);
        const m = out.match(/Failure \[([^\]]+)\]/) || out.match(/(INSTALL_[A-Z_]+[^\n]*)/);
        reject(new Error(explainInstall(m ? m[1] : out.trim().split('\n').pop() || `adb exited with ${code}`)));
      });
    });
  }

  push(serial, local, remote, { onProgress } = {}) {
    return new Promise((resolve, reject) => {
      const p = spawn(this.bin, [...this.pre, '-s', serial, 'push', local, remote], { windowsHide: true, env: this.env });
      let out = '';
      const on = (d) => { out += d; const m = String(d).match(/(\d+)%/g); if (m && onProgress) onProgress(parseInt(m[m.length - 1], 10)); };
      p.stdout.on('data', on); p.stderr.on('data', on);
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(out.trim().split('\n').pop() || 'Copy failed'))));
    });
  }
  pull(serial, remote, local) { return this.s(serial, ['pull', remote, local], { timeout: 10 * 60000 }); }

  // Lists a folder on the device. Uses toybox ls, present on every Android version Droid supports.
  async ls(serial, dir) {
    const d = dir.endsWith('/') ? dir : dir + '/';
    const out = await this.shell(serial, `ls -lA ${q(d)} 2>/dev/null`, { timeout: 15000 });
    return parseLs(out, d);
  }
  mkdir(serial, dir) { return this.shell(serial, `mkdir -p ${q(dir)}`); }
  rm(serial, p) { return this.shell(serial, `rm -rf ${q(p)}`); }
  // Tell the media scanner about new files so they appear in Photos/Files right away.
  scan(serial, remote) { return this.shell(serial, `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d ${q('file://' + remote)} >/dev/null 2>&1; true`).catch(() => {}); }

  async packages(serial) {
    const out = await this.shell(serial, 'pm list packages -3 --show-versioncode 2>/dev/null || pm list packages -3', { timeout: 20000 });
    return out.split('\n').map((l) => l.match(/^package:(\S+)(?:\s+versionCode:(\d+))?/)).filter(Boolean).map((m) => ({ id: m[1], versionCode: m[2] || null })).sort((a, b) => a.id.localeCompare(b.id));
  }
  uninstall(serial, pkg) { return this.s(serial, ['uninstall', pkg]); }
  launch(serial, pkg) { return this.shell(serial, `monkey -p ${q(pkg)} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`); }
  openUrl(serial, url) { return this.shell(serial, `am start -a android.intent.action.VIEW -d ${q(url)}`); }

  async airplane(serial, on) {
    const v = on ? 'enable' : 'disable';
    await this.shell(serial, `cmd connectivity airplane-mode ${v} 2>/dev/null || (settings put global airplane_mode_on ${on ? 1 : 0}; am broadcast -a android.intent.action.AIRPLANE_MODE >/dev/null 2>&1)`).catch(() => {});
    await this.shell(serial, `svc wifi ${on ? 'disable' : 'enable'}; svc data ${on ? 'disable' : 'enable'}`).catch(() => {});
  }
  setProxy(serial, hostPort) { return this.shell(serial, `settings put global http_proxy ${hostPort ? q(hostPort) : ':0'}`).catch(() => {}); }
  emu(serial, cmd) { return this.s(serial, ['emu', ...cmd.split(' ')], { timeout: 30000 }); }
  screencap(serial) { return this.s(serial, ['exec-out', 'screencap', '-p'], { encoding: 'buffer', timeout: 20000 }); }
}

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function parseLs(out, dir) {
  const items = [];
  for (const line of out.split('\n')) {
    // drwxrwx--x 2 root sdcard_rw 3488 2025-03-01 12:34 Download
    const m = line.match(/^([dl-])[rwxsStT-]{9}\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+)$/);
    if (!m) continue;
    let name = m[5], link = null;
    if (m[1] === 'l') { const i = name.indexOf(' -> '); if (i > 0) { link = name.slice(i + 4); name = name.slice(0, i); } }
    if (name === '.' || name === '..') continue;
    items.push({ name, path: dir + name, dir: m[1] === 'd' || (m[1] === 'l' && !/\.[a-z0-9]{1,5}$/i.test(name)), link, size: +m[2], mtime: `${m[3]} ${m[4]}` });
  }
  items.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return items;
}

function explainInstall(code) {
  const map = {
    INSTALL_FAILED_NO_MATCHING_ABIS: 'This app is built for a different processor than this device (try an arm64 or x86_64 build of it).',
    INSTALL_FAILED_OLDER_SDK: 'This app needs a newer Android version than this device runs.',
    INSTALL_FAILED_VERSION_DOWNGRADE: 'A newer version of this app is already installed. Uninstall it first.',
    INSTALL_FAILED_UPDATE_INCOMPATIBLE: 'An app with the same name but a different signature is installed. Uninstall it first.',
    INSTALL_FAILED_INSUFFICIENT_STORAGE: 'The device is out of storage. Give it more storage in Edit device.',
    INSTALL_FAILED_MISSING_SPLIT: 'This app comes in several pieces. Download the full bundle (APKM, XAPK or APKS), not a single APK.',
    INSTALL_PARSE_FAILED_NOT_APK: 'That file is not a working APK.',
    INSTALL_FAILED_INVALID_APK: 'That file is not a working APK.',
    INSTALL_FAILED_TEST_ONLY: 'This is a test-only build.',
    INSTALL_FAILED_DEPRECATED_SDK_VERSION: 'This app targets a very old Android version that newer devices refuse. Try a device with an older Android.',
  };
  const key = Object.keys(map).find((k) => code.includes(k));
  return key ? map[key] : code.replace(/^Failure\s*/, '') || 'Install failed';
}

module.exports = { Adb, parseLs, explainInstall, q };
