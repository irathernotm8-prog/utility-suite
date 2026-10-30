'use strict';
// Windows: the second half of a Utility Hub update, run by the NEW copy of the hub
// (started as "Utility Hub.exe --finish-update <installed folder> --wait-pid <old pid>").
// No console windows, no scripts: wait for the old hub to close (closing it if it won't),
// stop anything still running from the installed folder, copy the new version over it
// file by file, then start the hub from its usual place, whether or not the copy worked.
const path = require('path');
const fs = require('./fsx');
const fsp = fs.promises;
const { spawn } = require('child_process');
const { run, sleep, exists } = require('./sys');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

async function finishUpdate({ src, dest, pid, log, exeName = 'Utility Hub.exe' }) {
  const say = (m) => { try { fs.mkdirSync(path.dirname(log), { recursive: true }); fs.appendFileSync(log, `${new Date().toISOString()} ${m}\n`); } catch {} };
  say(`finishing update: ${src} -> ${dest} (waiting for ${pid})`);
  try {
    for (let i = 0; i < 30 && pid && alive(pid); i++) await sleep(500);
    if (pid && alive(pid)) { try { process.kill(pid); } catch {} say('the old hub did not close by itself; closed it'); await sleep(1500); }
    const like = `${dest.replace(/'/g, "''")}\\*`;
    if (process.platform === 'win32') await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${like}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
      { allowFail: true, windowsHide: true });
    await sleep(500);
    let err = null;
    for (let i = 0; i < 10; i++) {
      try { await fsp.cp(src, dest, { recursive: true, force: true }); err = null; break; } catch (e) { err = e; await sleep(1000); }
    }
    if (err) say(`FAILED: ${err.message}`);
    else {
      const prune = async (s, t) => {
        for (const ent of await fsp.readdir(t, { withFileTypes: true }).catch(() => [])) {
          const sp = path.join(s, ent.name), tp = path.join(t, ent.name);
          if (!exists(sp)) await fsp.rm(tp, { recursive: true, force: true }).catch(() => {});
          else if (ent.isDirectory()) await prune(sp, tp);
        }
      };
      await prune(src, dest);
      say('updated');
    }
  } catch (e) {
    say(`FAILED: ${e.message}`);
  }
  const exe = path.join(dest, exeName);
  if (exists(exe)) spawn(exe, ['--installed'], { detached: true, stdio: 'ignore', cwd: dest }).unref();
}

module.exports = { finishUpdate };
