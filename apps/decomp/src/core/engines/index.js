// Installs, finds and removes the engines in <data>/engines/<id>. Each engine's state lives in
// engines.json; anything already on the computer (java, dotnet, upx, pycdc…) is picked up too.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ENGINES, SYSTEM_TOOLS, plat, byId } = require('./catalog');
const { download, unpack, run } = require('../download');
const { readJson, writeJson } = require('../util');

const EXE = process.platform === 'win32' ? '.exe' : '';

function which(cmd) {
  const dirs = (process.env.PATH || '').split(path.delimiter).concat(process.platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : []);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const d of dirs) for (const x of exts) { const p = path.join(d, cmd + x); try { if (fs.statSync(p).isFile()) return p; } catch {} }
  return null;
}

// Finds a file or folder by name below dir (breadth-first, shallow) — archives nest differently per OS.
function findBelow(dir, test, depth = 5) {
  let level = [dir];
  for (let d = 0; d <= depth && level.length; d++) {
    const next = [];
    for (const l of level) {
      let ents; try { ents = fs.readdirSync(l, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) { const p = path.join(l, e.name); if (test(p, e)) return p; if (e.isDirectory() && !e.isSymbolicLink()) next.push(p); }
    }
    level = next;
  }
  return null;
}

class Engines {
  constructor(root, { useSystem = true } = {}) {
    this.root = root; this.useSystem = useSystem;
    fs.mkdirSync(root, { recursive: true });
    this.stateFile = path.join(root, 'engines.json');
    this.state = readJson(this.stateFile, {});
    this.busy = new Map();
    this._sys = null;
  }
  save() { writeJson(this.stateFile, this.state); }
  dir(id) { return path.join(this.root, id); }

  files(e) { return e.files ? e.files[plat()] || e.files[`${process.platform}-x64`] || e.files.any : null; }
  available(e) { if (e.unavailable && e.unavailable[process.platform]) return false; return !!(e.resolve || this.files(e)); }

  // Paths to the things the runners need. Installed copies win; system copies are the fallback.
  installed(id) { const s = this.state[id]; return s && s.path && fs.existsSync(s.path) ? s : null; }
  path(id) {
    const s = this.installed(id); if (s) return s.path;
    const sys = this.system()[id]; return sys ? sys.path : null;
  }
  javaHome() { const j = this.path('jdk'); if (!j) return null; return path.dirname(path.dirname(j)); }
  // Java version of the runtime Decomp would use (installed copy first).
  javaMajor() { const s = this.installed('jdk'); if (s) return s.major || parseInt(String(s.version), 10) || 0; const sys = this.system().jdk; return sys ? sys.major : 0; }
  // Ready to run, including the Java version an engine needs (Ghidra 12 needs Java 25).
  usable(id) {
    if (!this.ready(id)) return false;
    const e = byId(id); if (!e || !(e.requires || []).includes('jdk')) return (e && e.requires || []).every((d) => this.ready(d));
    return this.javaMajor() >= (e.java || 17);
  }

  // What's already on this computer (cached; refresh with rescan()).
  system() {
    if (this._sys) return this._sys;
    const out = {};
    if (this.useSystem) {
      const java = process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, 'bin', 'java' + EXE)) ? path.join(process.env.JAVA_HOME, 'bin', 'java' + EXE) : which('java');
      if (java && !(process.platform === 'darwin' && java === '/usr/bin/java' && !hasMacJava())) {
        const v = javaVersion(java); if (v && v.major >= 17) out.jdk = { path: java, version: v.text, major: v.major, source: 'system' };
      }
      const dn = which('dotnet');
      if (dn) { try { const r = spawnSync(dn, ['--list-runtimes'], { encoding: 'utf8', timeout: 8000, windowsHide: true }); const m = (r.stdout || '').match(/Microsoft\.NETCore\.App (1\d\.\d+\.\d+)/g); if (m && m.some((x) => /App 1[0-9]\./.test(x))) out.dotnet = { path: dn, version: m.pop().split(' ').pop(), source: 'system' }; } catch {} }
      const sz = which('7zz') || which('7z') || (process.platform === 'win32' && fs.existsSync('C:\\Program Files\\7-Zip\\7z.exe') ? 'C:\\Program Files\\7-Zip\\7z.exe' : null);
      if (sz) out.sevenzip = { path: sz, version: 'system', source: 'system' };
      const upx = which('upx'); if (upx) out.upx = { path: upx, version: 'system', source: 'system' };
      for (const t of SYSTEM_TOOLS) { const p = which(t.cmd); if (p) out[t.id] = { path: p, source: 'system' }; }
    }
    this._sys = out; return out;
  }
  rescan() { this._sys = null; return this.list(); }

  list() {
    const sys = this.system();
    const engines = ENGINES.map((e) => {
      const inst = this.installed(e.id);
      return {
        id: e.id, name: e.name, version: inst ? inst.version : e.version, group: e.group, what: e.what, license: e.license, size: e.size,
        requires: e.requires || [], auto: !!e.auto, available: this.available(e), note: e.unavailable && e.unavailable[process.platform] || null,
        installed: !!inst, system: !inst && sys[e.id] ? sys[e.id] : null, ready: this.usable(e.id), java: e.java || null,
        busy: this.busy.has(e.id) ? this.busy.get(e.id).progress : null, diskBytes: inst ? inst.bytes || null : null,
      };
    });
    const tools = SYSTEM_TOOLS.map((t) => ({ ...t, found: sys[t.id] ? sys[t.id].path : null }));
    return { engines, tools };
  }
  ready(id) { return !!this.path(id); }

  // Installs an engine (and what it needs). onProgress({ id, phase, got, total, rate }).
  async install(id, onProgress = () => {}, signal) {
    const e = byId(id); if (!e) throw new Error('Unknown engine ' + id);
    for (const dep of e.requires || []) if (!this.ready(dep) || (dep === 'jdk' && this.javaMajor() < (e.java || 17))) await this.install(dep, onProgress, signal);
    if (this.installed(id)) return this.state[id];
    if (this.busy.has(id)) return this.busy.get(id).promise;
    const job = { progress: { phase: 'Starting' } };
    const report = (p) => { job.progress = { ...job.progress, ...p }; onProgress({ id, ...job.progress }); };
    job.promise = (async () => {
      let files = this.files(e), version = e.version;
      if (e.resolve) { report({ phase: 'Finding the latest build' }); const r = await e.resolve(); files = r.files; version = r.version; }
      if (!files) throw new Error(`${e.name} isn\u2019t available for this computer`);
      const dir = this.dir(id), dl = path.join(this.root, '_downloads');
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      for (const f of files) {
        const name = f.name || decodeURIComponent(f.url.split('/').pop().split('?')[0]);
        const dest = path.join(dl, name);
        report({ phase: `Downloading ${e.name}`, got: 0, total: f.size || 0 });
        await download(f.url, dest, { hash: f.hash, size: f.size, signal, onProgress: (p) => report(p.verifying ? { phase: 'Checking download' } : { got: p.got, total: p.total, rate: p.rate }) });
        report({ phase: `Unpacking ${e.name}`, got: null });
        if (f.unpack) { await unpack(dest, dir); fs.rmSync(dest, { force: true }); }
        else if (f.sfx) { const z = path.join(dir, '7zr.exe'); await run(z, ['x', '-y', '-o' + dir, dest, '7z.exe', '7z.dll', 'License.txt']); fs.rmSync(dest, { force: true }); fs.rmSync(z, { force: true }); }
        else fs.renameSync(dest, path.join(dir, name));
      }
      const p = this.locate(e, dir);
      if (!p) throw new Error(`${e.name} installed, but its program wasn\u2019t found`);
      if (process.platform !== 'win32') { try { fs.chmodSync(p, 0o755); } catch {} this.fixPermissions(e, dir); }
      if (process.platform === 'darwin') { try { await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', dir]); } catch {} }
      this.state[id] = { path: p, version, installedAt: new Date().toISOString(), bytes: dirSize(dir) };
      if (id === 'jdk') { const v = javaVersion(p); if (v) this.state[id].major = v.major; }
      this.save(); this._sys = null;
      report({ phase: 'Ready', done: true });
      return this.state[id];
    })();
    this.busy.set(id, job);
    try { return await job.promise; } finally { this.busy.delete(id); }
  }

  locate(e, dir) {
    if (e.id === 'jdk') return findBelow(dir, (p, d) => d.isFile() && d.name === 'java' + EXE && path.basename(path.dirname(p)) === 'bin' && !p.includes(`${path.sep}jre${path.sep}`), 6);
    const name = (e.bin && (e.bin[process.platform] || e.bin.default)) || '';
    const direct = path.join(dir, name); if (fs.existsSync(direct)) return direct;
    const base = path.basename(name);
    return findBelow(dir, (p) => path.basename(p) === base && p.endsWith(name.split('/').join(path.sep)), 4) || findBelow(dir, (p) => path.basename(p) === base, 4);
  }
  fixPermissions(e, dir) {
    const mark = (p) => { try { fs.chmodSync(p, 0o755); } catch {} };
    if (e.id === 'ghidra') {
      const home = this.state.ghidra ? this.state.ghidra.path : this.locate(e, dir);
      if (!home) return;
      for (const s of ['support/analyzeHeadless', 'support/launch.sh', 'ghidraRun']) mark(path.join(home, s));
      const os = findBelow(home, (p, d) => d.isDirectory() && d.name === 'os' && p.includes('Decompiler'), 4);
      if (os) for (const sub of fs.readdirSync(os)) for (const f of fs.readdirSync(path.join(os, sub))) mark(path.join(os, sub, f));
    }
    if (e.id === 'dotnet' || e.id === 'jdk') { const bin = findBelow(dir, (p, d) => d.isDirectory() && d.name === 'bin', 4); if (bin) for (const f of fs.readdirSync(bin)) mark(path.join(bin, f)); }
  }

  remove(id) {
    fs.rmSync(this.dir(id), { recursive: true, force: true });
    delete this.state[id]; this.save();
  }
}

function hasMacJava() { try { const r = spawnSync('/usr/libexec/java_home', [], { encoding: 'utf8', timeout: 5000 }); return r.status === 0; } catch { return false; } }
function javaVersion(java) {
  try {
    const r = spawnSync(java, ['-version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    const m = (r.stderr || r.stdout || '').match(/version "(\d+)(?:\.(\d+))?[^"]*"/);
    if (!m) return null; let major = +m[1]; if (major === 1) major = +m[2];
    return { major, text: ((r.stderr || r.stdout || '').split('\n').find((l) => /version/.test(l)) || '').trim() };
  } catch { return null; }
}
function dirSize(dir) {
  let n = 0; const st = [dir];
  while (st.length) { const d = st.pop(); let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) st.push(p); else if (e.isFile()) { try { n += fs.statSync(p).size; } catch {} } } }
  return n;
}

module.exports = { Engines, which, findBelow, javaVersion };
