'use strict';
// Utility Hub installing, updating and removing itself.
//   Mac:     /Applications/Utility Hub.app
//   Windows: %LOCALAPPDATA%\Programs\Utility Suite\Utility Hub\  + Start Menu/desktop shortcuts
//            + "Utility Hub" in Settings > Apps
const path = require('path');
const fs = require('./fsx');
const fsp = require('./fsx').promises;
const { spawn } = require('child_process');
const { run, exists, readJSON, psQuote } = require('./sys');
const legacy = require('./legacy-win');

const HUB_NAME = 'Utility Hub';
const UNINSTALL_KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\UtilityHub';

class SelfHub {
  // ctx: { platform, home, execPath, version, publisher, userData, shell, apps (Apps instance) }
  constructor(ctx) { this.ctx = ctx; }

  get isMac() { return this.ctx.platform === 'darwin'; }
  get isWin() { return this.ctx.platform === 'win32'; }

  // The running hub's own bundle (.app on Mac, the folder on Windows)
  get selfPath() {
    const e = this.ctx.execPath;
    if (this.isMac) { const i = e.indexOf('.app/'); return i === -1 ? null : e.slice(0, i + 4); }
    return path.dirname(e);
  }

  get installTarget() {
    if (this.isMac) return path.join('/Applications', `${HUB_NAME}.app`);
    return path.join(this.ctx.apps.winRoot, HUB_NAME);
  }

  // Running from its installed home (not from a download, DMG or project folder)?
  get installed() {
    const p = this.selfPath;
    if (!p) return false;
    if (this.isMac) return p.startsWith('/Applications/') || p.startsWith(path.join(this.ctx.home, 'Applications') + '/');
    if (this.isWin) return path.resolve(p).toLowerCase() === path.resolve(this.installTarget).toLowerCase();
    return true;
  }

  get canManageSelf() { return (this.isMac || this.isWin) && !!this.selfPath && !this.ctx.isDev; }

  async installSelf() {
    const src = this.selfPath;
    let dest = this.installTarget;
    if (this.isMac) {
      try {
        await copyAppMac(src, dest);
      } catch (e) {
        dest = path.join(this.ctx.home, 'Applications', `${HUB_NAME}.app`);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await copyAppMac(src, dest);
      }
      return dest;
    }
    // Windows
    await fsp.rm(`${dest}.new`, { recursive: true, force: true });
    await fsp.cp(src, `${dest}.new`, { recursive: true });
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.rename(`${dest}.new`, dest);
    await legacy.unblock(dest);
    await this.registerWindows(dest, { shortcuts: true });
    await this.retireOldInstaller();
    return dest;
  }

  // Settings > Apps entry (refreshed every launch so the version stays current); shortcuts only when asked
  async registerWindows(dir = this.selfPath, { shortcuts = false } = {}) {
    const exe = path.join(dir, `${HUB_NAME}.exe`);
    if (shortcuts) {
      const opts = { target: exe, cwd: dir, description: 'Install, update and remove the Utility Suite apps', icon: exe, iconIndex: 0 };
      const places = [this.ctx.apps.winStartMenu];
      if (this.ctx.settings().desktopShortcuts !== false) places.push(this.ctx.apps.winDesktop);
      for (const d of places) {
        try { fs.mkdirSync(d, { recursive: true }); this.ctx.shell.writeShortcutLink(path.join(d, `${HUB_NAME}.lnk`), 'create', opts); } catch {}
      }
    }
    await legacy.regSet(UNINSTALL_KEY, {
      DisplayName: HUB_NAME, DisplayVersion: this.ctx.version, Publisher: this.ctx.publisher || '',
      InstallLocation: dir, DisplayIcon: exe, UninstallString: `"${exe}" --uninstall`,
      NoModify: 1, NoRepair: 1,
    });
  }

  // The old Install.cmd put apps in the same folder and its own entry in Settings > Apps.
  // Record their versions as hub-managed, then remove the old entry and uninstaller.
  async retireOldInstaller() {
    const root = this.ctx.apps.winRoot;
    const old = readJSON(path.join(root, 'suite-info.json'), null);
    if (old) {
      for (const a of old.apps || []) {
        const dir = path.join(root, a.folder || a.name);
        if (exists(path.join(dir, a.exe || `${a.name}.exe`)) && !this.ctx.apps.state.apps[a.id]) {
          this.ctx.apps.state.apps[a.id] = { version: a.version, path: dir, installedAt: old.builtAt || null, name: a.name };
        }
      }
      this.ctx.apps.saveState();
    }
    await legacy.regDelete('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\UtilitySuite');
    for (const f of ['uninstall.ps1', 'suite-info.json']) await fsp.rm(path.join(root, f), { force: true }).catch(() => {});
  }

  relaunch(target) {
    if (this.isMac) spawn('/usr/bin/open', ['-n', target, '--args', '--installed'], { detached: true, stdio: 'ignore' }).unref();
    else spawn(path.join(target, `${HUB_NAME}.exe`), ['--installed'], { detached: true, stdio: 'ignore' }).unref();
  }

  // Replace the running hub with a newer copy, then reopen it. `newCopy` is a staged
  // copy of the new hub (.app or folder) inside userData, so the source can go away.
  scheduleSelfUpdate(newCopy) {
    const dest = this.selfPath;
    const pid = process.pid;
    if (this.isMac) {
      const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
      const sh = [
        `while kill -0 ${pid} 2>/dev/null; do sleep 0.5; done`,
        `rm -rf ${q(dest + '.old')}`,
        `mv ${q(dest)} ${q(dest + '.old')} && /usr/bin/ditto --noqtn ${q(newCopy)} ${q(dest)} && /usr/bin/xattr -dr com.apple.quarantine ${q(dest)}`,
        `if [ -d ${q(dest + '/Contents')} ]; then rm -rf ${q(dest + '.old')}; else rm -rf ${q(dest)}; mv ${q(dest + '.old')} ${q(dest)}; fi`,
        `rm -rf ${q(newCopy)}`,
        `/usr/bin/open ${q(dest)}`,
      ].join('; ');
      spawn('/bin/sh', ['-c', sh], { detached: true, stdio: 'ignore' }).unref();
    } else {
      const exe = path.join(dest, `${HUB_NAME}.exe`);
      const ps = [
        `Wait-Process -Id ${pid} -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500`,
        `$d=${psQuote(dest)}; $n=${psQuote(newCopy)}; $o="$d.old"`,
        `Remove-Item -Recurse -Force $o -ErrorAction SilentlyContinue`,
        `try { Rename-Item $d $o -ErrorAction Stop; Copy-Item $n $d -Recurse -ErrorAction Stop; Remove-Item -Recurse -Force $o -ErrorAction SilentlyContinue }`,
        `catch { if (Test-Path $o) { Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue; Rename-Item $o $d } }`,
        `Get-ChildItem -LiteralPath $d -Recurse -File | Unblock-File -ErrorAction SilentlyContinue`,
        `Remove-Item -Recurse -Force $n -ErrorAction SilentlyContinue`,
        `Start-Process -FilePath ${psQuote(exe)}`,
      ].join('\n');
      spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', ps], { detached: true, stdio: 'ignore' }).unref();
    }
  }

  async stageCopy(src, stagingDir) {
    const dest = path.join(stagingDir, path.basename(src));
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.mkdir(stagingDir, { recursive: true });
    if (this.isMac) await run('/usr/bin/ditto', ['--noqtn', src, dest]);
    else await fsp.cp(src, dest, { recursive: true, verbatimSymlinks: true });
    return dest;
  }

  // Remove the hub itself (apps are removed beforehand by the caller if asked).
  async uninstallSelf() {
    const dir = this.selfPath;
    if (this.isMac) {
      await this.ctx.shell.trashItem(dir).catch(() => {});
      return;
    }
    for (const d of [this.ctx.apps.winStartMenu, this.ctx.apps.winDesktop]) await fsp.rm(path.join(d, `${HUB_NAME}.lnk`), { force: true }).catch(() => {});
    try { if (!fs.readdirSync(this.ctx.apps.winStartMenu).length) fs.rmdirSync(this.ctx.apps.winStartMenu); } catch {}
    await legacy.regDelete(UNINSTALL_KEY);
    const pid = process.pid;
    const ps = `Wait-Process -Id ${pid} -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1; Remove-Item -Recurse -Force ${psQuote(dir)} -ErrorAction SilentlyContinue;` +
      ` $r=${psQuote(this.ctx.apps.winRoot)}; if ((Test-Path $r) -and -not (Get-ChildItem $r -Force | Where-Object { $_.Name -ne '.staging' })) { Remove-Item -Recurse -Force $r }`;
    spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', ps], { detached: true, stdio: 'ignore' }).unref();
  }
}

async function copyAppMac(src, dest) {
  const tmp = `${dest}.new`;
  await fsp.rm(tmp, { recursive: true, force: true });
  await run('/usr/bin/ditto', ['--noqtn', src, tmp]);
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.rename(tmp, dest);
  await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', dest], { allowFail: true });
}

module.exports = { SelfHub, HUB_NAME };
