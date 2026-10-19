'use strict';
// Installing, updating, finding and removing apps on this computer.
//   Mac:     /Applications/<Name>.app            (falls back to ~/Applications without admin rights)
//   Windows: %LOCALAPPDATA%\Programs\Utility Suite\<Name>\  + Start Menu (+ desktop) shortcuts
// App data (settings, accounts, files) lives elsewhere and is never touched.
const path = require('path');
const fs = require('./fsx');
const fsp = require('./fsx').promises;
const { run, exists, readJSON, writeJSON, extractZip, moveTree, waitFor, compareVersions, sleep } = require('./sys');
const legacy = require('./legacy-win');

const SUITE_FOLDER = 'Utility Suite';

class Apps {
  // ctx: { platform, home, userData, env, shell: { trashItem, writeShortcutLink, openPath, showItemInFolder },
  //        settings: () => settings, publisher }
  constructor(ctx, library) {
    this.ctx = ctx;
    this.library = library;
    this.stateFile = path.join(ctx.userData, 'installed.json');
    this.state = readJSON(this.stateFile, null) || { apps: {} };
    this.isMac = ctx.platform === 'darwin';
    this.isWin = ctx.platform === 'win32';
    this._separate = null; // cached Windows registry scan
    this.remote = new Map(); // id -> entry from the online catalog (set by main after each check)
  }

  saveState() { writeJSON(this.stateFile, this.state); }

  // ── locations ──
  get winRoot() { return path.join(this.ctx.env.LOCALAPPDATA || path.join(this.ctx.home, 'AppData', 'Local'), 'Programs', SUITE_FOLDER); }
  get winStartMenu() { return path.join(this.ctx.env.APPDATA || path.join(this.ctx.home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', SUITE_FOLDER); }
  get winDesktop() { return this.ctx.desktop || path.join(this.ctx.home, 'Desktop'); }
  get linuxRoot() { return path.join(this.ctx.home, '.local', 'share', SUITE_FOLDER); } // only used by tests

  defaultTarget(meta) {
    if (this.isMac) return path.join('/Applications', meta.bundle || `${meta.name}.app`);
    if (this.isWin) return path.join(this.winRoot, meta.folder || meta.name);
    return path.join(this.linuxRoot, meta.folder || meta.name);
  }
  exePath(meta, target) {
    if (this.isMac) return target;
    return path.join(target, meta.exe || `${meta.name}${this.isWin ? '.exe' : ''}`);
  }

  // ── detection ──
  macBundleInfo(appPath) {
    try {
      const plist = fs.readFileSync(path.join(appPath, 'Contents', 'Info.plist'), 'utf8');
      const key = (k) => (plist.match(new RegExp(`<key>${k}</key>\\s*<string>([^<]*)</string>`)) || [])[1] || null;
      return { version: key('CFBundleShortVersionString'), bundleId: key('CFBundleIdentifier') };
    } catch { return null; }
  }

  // Where (and which version) an app is installed, or null.
  detect(meta) {
    const rec = this.state.apps[meta.id];
    if (this.isMac) {
      const name = meta.bundle || `${meta.name}.app`;
      const candidates = [rec?.path, path.join('/Applications', name), path.join(this.ctx.home, 'Applications', name)].filter(Boolean);
      for (const p of candidates) {
        const info = this.macBundleInfo(p);
        if (!info) continue;
        if (meta.appId && info.bundleId && info.bundleId !== meta.appId) continue;
        return { path: p, version: info.version || rec?.version || null, managed: !!rec && rec.path === p };
      }
      return null;
    }
    const target = rec?.path || this.defaultTarget(meta);
    if (!exists(this.exePath(meta, target))) return null;
    let version = rec?.version || null;
    if (!version && this.isWin) version = this.legacySuiteVersions()[meta.id] || null; // installed by the old Install.cmd
    return { path: target, version, managed: !!rec };
  }

  legacySuiteVersions() {
    const info = readJSON(path.join(this.winRoot, 'suite-info.json'), null);
    const out = {};
    for (const a of info?.apps || []) out[a.id] = a.version;
    return out;
  }

  async isRunning(meta, where) {
    if (!where) return false;
    if (this.isMac) {
      const r = await run('/usr/bin/pgrep', ['-f', `${where.path}/Contents/MacOS/`], { allowFail: true });
      return r.code === 0;
    }
    if (this.isWin) {
      const exe = path.basename(this.exePath(meta, where.path));
      const r = await run('tasklist', ['/FI', `IMAGENAME eq ${exe}`, '/NH', '/FO', 'CSV'], { allowFail: true });
      return r.stdout.toLowerCase().includes(`"${exe.toLowerCase()}"`);
    }
    return false;
  }

  async quit(meta, where) {
    if (!(await this.isRunning(meta, where))) return;
    if (this.isMac) {
      const q = meta.appId ? `quit app id "${meta.appId}"` : `quit app "${meta.name}"`;
      await run('/usr/bin/osascript', ['-e', q], { allowFail: true });
      if (!(await waitFor(async () => !(await this.isRunning(meta, where)), 15000))) {
        await run('/usr/bin/pkill', ['-f', `${where.path}/Contents/MacOS/`], { allowFail: true });
        await sleep(1000);
      }
    } else if (this.isWin) {
      const exe = path.basename(this.exePath(meta, where.path));
      await run('taskkill', ['/IM', exe], { allowFail: true });
      if (!(await waitFor(async () => !(await this.isRunning(meta, where)), 8000))) {
        await run('taskkill', ['/F', '/T', '/IM', exe], { allowFail: true });
        await sleep(1000);
      }
    }
  }

  // ── install / update ──
  async install(id, { onStep = () => {} } = {}) {
    const meta = this.library.get(id);
    if (!meta || !this.library.hasPackage(id)) throw new Error('This app has no package in the hub. Add the packages again, then install.');
    const where = this.detect(meta);

    if (await this.isRunning(meta, where)) { onStep({ step: `Closing ${meta.name}` }); await this.quit(meta, where); }

    if (this.isWin && this.ctx.settings().removeSeparateInstalls !== false) {
      const separate = (await this.separateInstalls()).filter((s) => s.id === id);
      for (const s of separate) {
        onStep({ step: `Removing the separately installed ${s.displayName}` });
        await legacy.uninstallSeparate(s);
      }
      if (separate.length) this._separate = null;
    }

    onStep({ step: 'Unpacking' });
    let target = where?.path || this.defaultTarget(meta);
    const stagingRoot = this.isWin ? path.join(this.winRoot, '.staging') : path.join(this.ctx.userData, 'staging');
    await fsp.mkdir(stagingRoot, { recursive: true });
    const tmp = await fsp.mkdtemp(path.join(stagingRoot, `${id}-`));
    try {
      await extractZip(meta.package, tmp, this.ctx.platform);
      const inner = path.join(tmp, this.isMac ? meta.bundle || `${meta.name}.app` : meta.folder || meta.name);
      if (!exists(inner)) throw new Error(`The ${meta.name} package doesn't contain ${path.basename(inner)}.`);

      onStep({ step: where ? 'Replacing the old version' : 'Copying into place' });
      try {
        target = await this.swapInto(inner, target);
      } catch (e) {
        if (this.isMac && ['EACCES', 'EPERM'].includes(e.code) && target.startsWith('/Applications/')) {
          // not an administrator: install just for this user
          target = path.join(this.ctx.home, 'Applications', path.basename(target));
          await fsp.mkdir(path.dirname(target), { recursive: true });
          target = await this.swapInto(inner, target);
        } else throw e;
      }
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }

    onStep({ step: 'Finishing' });
    if (this.isMac) await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', target], { allowFail: true });
    if (this.isWin) {
      await legacy.unblock(target);
      this.writeShortcuts(meta, target);
    }
    this.state.apps[id] = { version: meta.version, path: target, installedAt: new Date().toISOString(), name: meta.name };
    this.saveState();
    return { id, version: meta.version, path: target, updatedFrom: where?.version || null };
  }

  async swapInto(src, target) {
    const backup = `${target}.old-${Date.now()}`;
    const hadOld = exists(target);
    if (hadOld) await fsp.rename(target, backup);
    try {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await moveTree(src, target, this.ctx.platform);
    } catch (e) {
      if (hadOld) { await fsp.rm(target, { recursive: true, force: true }).catch(() => {}); await fsp.rename(backup, target).catch(() => {}); }
      throw e;
    }
    if (hadOld) await fsp.rm(backup, { recursive: true, force: true }).catch(() => {});
    return target;
  }

  writeShortcuts(meta, target) {
    const exe = this.exePath(meta, target);
    const opts = { target: exe, cwd: target, description: meta.description || meta.name, icon: exe, iconIndex: 0 };
    const places = [this.winStartMenu];
    if (this.ctx.settings().desktopShortcuts !== false) places.push(this.winDesktop);
    for (const dir of places) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        this.ctx.shell.writeShortcutLink(path.join(dir, `${meta.name}.lnk`), 'create', opts);
      } catch {}
    }
  }

  removeShortcuts(meta) {
    for (const dir of [this.winStartMenu, this.winDesktop]) {
      try { fs.rmSync(path.join(dir, `${meta.name}.lnk`), { force: true }); } catch {}
    }
  }

  // ── uninstall ──
  async uninstall(id, { onStep = () => {} } = {}) {
    const meta = this.metaFor(id);
    const where = this.detect(meta);
    if (where) {
      if (await this.isRunning(meta, where)) { onStep({ step: `Closing ${meta.name}` }); await this.quit(meta, where); }
      onStep({ step: 'Removing' });
      if (this.isMac) await this.ctx.shell.trashItem(where.path);
      else await fsp.rm(where.path, { recursive: true, force: true });
    }
    if (this.isWin) this.removeShortcuts(meta);
    delete this.state.apps[id];
    this.saveState();
    return { id, removed: !!where };
  }

  metaFor(id) {
    const m = this.library.get(id);
    if (m) return m;
    const r = this.remote.get(id);
    if (r) return { ...r, icon: null };
    const rec = this.state.apps[id];
    return { id, name: rec?.name || id, bundle: rec?.path && this.isMac ? path.basename(rec.path) : null, folder: rec?.path && !this.isMac ? path.basename(rec.path) : null };
  }

  open(id) {
    const meta = this.metaFor(id);
    const where = this.detect(meta);
    if (!where) throw new Error(`${meta.name} isn't installed.`);
    return this.ctx.shell.openPath(this.exePath(meta, where.path));
  }

  reveal(id) {
    const meta = this.metaFor(id);
    const where = this.detect(meta);
    if (where) this.ctx.shell.showItemInFolder(this.exePath(meta, where.path));
  }

  // ── other copies (old versions installed some other way) ──
  async separateInstalls() {
    if (!this.isWin) return [];
    if (!this._separate) this._separate = await legacy.findSeparateInstalls(this.allMeta(), this.ctx.publisher).catch(() => []);
    return this._separate;
  }

  allMeta() {
    const byId = new Map(this.library.list().map((m) => [m.id, m]));
    for (const [id, r] of this.remote) if (!byId.has(id)) byId.set(id, { ...r, icon: null });
    for (const id of Object.keys(this.state.apps)) if (!byId.has(id)) byId.set(id, this.metaFor(id));
    return [...byId.values()];
  }

  // Copies of the apps outside where the hub keeps them (Windows: portable .exes, unzipped folders,
  // old setup files and suite downloads; Mac: other copies Spotlight knows about).
  async findOtherCopies(skipRoots = []) {
    const metas = this.allMeta();
    if (this.isWin) {
      const loose = await legacy.findLooseCopies(metas, this.ctx.publisher, [this.winRoot, this.ctx.userData, ...skipRoots]).catch(() => []);
      const sep = await this.separateInstalls();
      return [
        ...sep.map((s) => ({ kind: 'separate install', name: s.displayName, path: s.installLocation || s.uninstallExe, id: s.id, key: s.key, separate: s })),
        ...loose,
      ];
    }
    if (this.isMac) {
      const out = [];
      for (const m of metas) {
        if (!m.appId) continue;
        const r = await run('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == "${m.appId}"`], { allowFail: true });
        const installed = this.detect(m)?.path;
        for (const p of r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
          if (p === installed || !p.endsWith('.app')) continue;
          if (/\/(dist|\.build|node_modules|\.Trash)\//.test(p) || p.startsWith('/Volumes/') || p.startsWith(this.ctx.userData)) continue;
          if (skipRoots.some((s) => p.startsWith(s))) continue;
          const info = this.macBundleInfo(p);
          out.push({ kind: 'other copy', name: `${m.name}${info?.version ? ' ' + info.version : ''}`, path: p, id: m.id });
        }
      }
      return out;
    }
    return [];
  }

  async removeOtherCopy(item) {
    if (item.separate) { await legacy.uninstallSeparate(item.separate); this._separate = null; return; }
    await this.ctx.shell.trashItem(item.path);
  }

  // For the interface: one row per app the hub knows about.
  async rows() {
    const sep = this.isWin ? await this.separateInstalls() : [];
    const rows = [];
    for (const meta of this.allMeta()) {
      const where = this.detect(meta);
      const pkg = this.library.get(meta.id);
      const hasPkg = this.library.hasPackage(meta.id);
      const rem = this.remote.get(meta.id);
      // the newest version we can install: the hub's own copy, or one published online
      const online = rem && (!hasPkg || compareVersions(rem.version, pkg.version) > 0);
      const best = online ? rem : hasPkg ? pkg : null;
      let status = 'available';
      if (where) {
        if (!best) status = 'installed';
        else {
          const c = compareVersions(best.version, where.version);
          status = !where.version ? 'unknown' : c > 0 ? 'update' : c < 0 ? 'newer' : 'installed';
        }
      } else if (!best) status = 'missing';
      rows.push({
        id: meta.id, name: meta.name, description: meta.description || rem?.description || '',
        icon: meta.icon || pkg?.icon || rem?.iconUrl || null,
        status, installedVersion: where?.version || null, availableVersion: best ? best.version : null,
        online: !!online, path: where?.path || null, notes: best?.notes || [], size: best ? best.size : null,
        separate: sep.filter((s) => s.id === meta.id).map((s) => ({ name: s.displayName, version: s.displayVersion })),
        running: where ? await this.isRunning(meta, where) : false,
      });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }
}

module.exports = { Apps, SUITE_FOLDER };
