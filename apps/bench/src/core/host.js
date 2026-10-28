// Bench — what this computer has to work with: cores, memory, load, and how many apps or tests to run at once.
'use strict';
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

let prevCpu = null;
function cpuLoad() {
  const now = os.cpus().map((c) => c.times); let idle = 0, total = 0;
  if (prevCpu && prevCpu.length === now.length) now.forEach((t, i) => { const p = prevCpu[i]; const tt = Object.values(t).reduce((a, b) => a + b, 0) - Object.values(p).reduce((a, b) => a + b, 0); total += tt; idle += t.idle - p.idle; });
  prevCpu = now;
  return total ? Math.max(0, Math.min(1, 1 - idle / total)) : null;
}
// macOS counts reclaimable memory as "used"; vm_stat gives a truer free figure.
function freeMem() {
  if (process.platform !== 'darwin') return os.freemem();
  try {
    const out = execFileSync('vm_stat', { encoding: 'utf8', timeout: 2000 });
    const page = +(/page size of (\d+)/.exec(out) || [0, 16384])[1];
    const get = (k) => +(new RegExp(k + ':\\s+(\\d+)').exec(out) || [0, 0])[1];
    return (get('Pages free') + get('Pages inactive') + get('Pages speculative') + get('Pages purgeable')) * page;
  } catch { return os.freemem(); }
}
function cpuName() { const c = os.cpus()[0]; return c ? c.model.replace(/\(R\)|\(TM\)|CPU|@.*$/g, '').replace(/\s+/g, ' ').trim() : 'CPU'; }
function info() {
  const cores = os.cpus().length; const total = os.totalmem(); const free = freeMem();
  return {
    platform: process.platform, arch: process.arch, release: os.release(), cpu: cpuName(), cores, totalMem: total, freeMem: free, load: cpuLoad(),
    hostname: os.hostname(), appleSilicon: process.platform === 'darwin' && process.arch === 'arm64',
    limits: suggested(cores, total, free),
  };
}
/** How many apps / test suites to run side by side on this computer. */
function suggested(cores = os.cpus().length, total = os.totalmem(), free = freeMem()) {
  const gb = 1024 ** 3;
  const byCpu = Math.max(1, Math.floor(cores * 0.75));
  const appsByMem = Math.max(1, Math.floor(Math.max(free, total * 0.35) / (0.9 * gb)));
  const testsByMem = Math.max(1, Math.floor(Math.max(free, total * 0.35) / (0.6 * gb)));
  return { apps: Math.max(1, Math.min(byCpu, appsByMem, 16)), tests: Math.max(1, Math.min(Math.max(1, cores - 1), testsByMem, 24)), vmCpu: Math.max(2, Math.min(8, Math.floor(cores / 2))), vmMemGB: Math.max(4, Math.min(16, Math.floor(total / gb / 2))) };
}

/** Apps opened from Finder get a bare PATH; ask the login shell for the real one so npm, node and git are found. */
function loginPath() {
  if (process.platform === 'win32') return process.env.PATH;
  const extra = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  let p = process.env.PATH || '';
  try {
    const sh = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
    const out = execFileSync(sh, ['-ilc', 'printf "__BENCH_PATH__%s__END__" "$PATH"'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /__BENCH_PATH__(.*?)__END__/.exec(out); if (m && m[1]) p = m[1];
  } catch {}
  const parts = p.split(':').filter(Boolean);
  for (const e of extra) if (!parts.includes(e) && fs.existsSync(e)) parts.push(e);
  return parts.join(':');
}

module.exports = { info, suggested, loginPath, freeMem };
