'use strict';
// Utility Hub installing, updating and removing itself.
//   Mac:     /Applications/Utility Hub.app
//   Windows: %LOCALAPPDATA%\Programs\Utility Suite\Utility Hub\  + Start Menu/desktop shortcuts
//            + "Utility Hub" in Settings > Apps
const path = require('path');
const os = require('os');
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
      // A .cmd run outside the hub (PowerShell scripts were blocked or died with the hub on some PCs).
      // It waits until every Utility Hub process has gone (Electron leaves helper processes behind
      // for a moment), copies the new version over the old one file by file with retries (renaming
      // the folder fails while anything still has it open), then starts the hub again either way.
      const exe = path.join(dest, `${HUB_NAME}.exe`);
      const log = path.join(path.dirname(path.dirname(newCopy)), 'update.log');
      const q = (p) => `"${p}"`;
      const lines = [
        '@echo off', 'setlocal', `set PID=${pid}`, 'set /a N=0',
        `echo %date% %time% updating Utility Hub from ${q(newCopy)} >>${q(log)}`,
        ':wait',
        'tasklist /FI "PID eq %PID%" /NH 2>nul | find " %PID% " >nul',
        'if not errorlevel 1 ( ping -n 2 127.0.0.1 >nul & goto wait )',
        ':helpers',
        `tasklist /FI "IMAGENAME eq ${HUB_NAME}.exe" /NH 2>nul | find /I "${HUB_NAME}.exe" >nul`,
        'if errorlevel 1 goto copy',
        'set /a N+=1',
        `if %N% GEQ 15 ( taskkill /F /IM "${HUB_NAME}.exe" >nul 2>&1 & ping -n 3 127.0.0.1 >nul & goto copy )`,
        'ping -n 2 127.0.0.1 >nul', 'goto helpers',
        ':copy',
        `robocopy ${q(newCopy)} ${q(dest)} /MIR /R:10 /W:1 /NFL /NDL /NJH /NJS /NP >>${q(log)} 2>&1`,
        `if errorlevel 8 ( echo %date% %time% FAILED, robocopy code %errorlevel% >>${q(log)} ) else ( echo %date% %time% updated >>${q(log)} & rmdir /s /q ${q(newCopy)} )`,
        `start "" /D ${q(dest)} ${q(exe)}`,
        'del "%~f0"',
      ];
      const script = path.join(os.tmpdir(), `utility-hub-update-${Date.now()}.cmd`);
      fs.writeFileSync(script, lines.join('\r\n') + '\r\n');
      spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'), ['/d', '/c', script],
        { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.tmpdir() }).unref();
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
