// Small helpers for running system commands. Everything here is promise-based, time-limited and never throws
// into the caller unless asked to: collectors degrade to "not available" instead of breaking a page.
const { execFile, spawn } = require('child_process');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

/** Run a program (no shell). Resolves { ok, stdout, stderr, code }. */
function run(cmd, args = [], { timeout = 15000, input = null, env = null, maxBuffer = 64 * 1024 * 1024, encoding = 'utf8' } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile(cmd, args, { timeout, maxBuffer, windowsHide: true, encoding, env: env ? { ...process.env, ...env } : process.env }, (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', code: err ? (err.code ?? 1) : 0, error: err ? String(err.message || err) : null });
      });
    } catch (e) { resolve({ ok: false, stdout: '', stderr: '', code: 1, error: String(e.message || e) }); return; }
    if (input != null && child.stdin) { child.stdin.end(input); }
  });
}

/** Run and return stdout or '' */
async function out(cmd, args, opts) { const r = await run(cmd, args, opts); return r.ok ? r.stdout : ''; }

/** Run a shell command line with administrator rights. Mac: the standard password prompt. Windows: UAC. */
async function runAdmin(shellLine, { prompt = 'Vitals needs your password to make this change.' } = {}) {
  if (isMac) {
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return run('osascript', ['-e', `do shell script "${esc(shellLine)}" with prompt "${esc(prompt)}" with administrator privileges`], { timeout: 120000 });
  }
  if (isWin) {
    // shellLine is a cmd.exe command line; run it elevated and wait.
    const b64 = Buffer.from(shellLine, 'utf16le').toString('base64');
    const ps = `$p = Start-Process -FilePath cmd.exe -ArgumentList '/c', ([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}'))) -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { timeout: 180000 });
  }
  return run('pkexec', ['sh', '-c', shellLine], { timeout: 120000 });
}

/** Map with limited concurrency. */
async function pool(items, n, fn) {
  const res = new Array(items.length); let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; try { res[k] = await fn(items[k], k); } catch (e) { res[k] = undefined; } } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return res;
}

// ------------------------------------------------------------------ persistent PowerShell (Windows)
// Starting powershell.exe costs ~0.5-1 s, so the samplers share long-lived shells. Commands are sent base64-encoded on
// one line and each answer ends with a marker, so multi-line scripts and odd output never desync the stream.
class PowerShell {
  constructor(name = 'ps') { this.name = name; this.queue = []; this.busy = false; this.child = null; this.buf = ''; this.seq = 0; this.cur = null; }
  start() {
    if (this.child) return;
    this.child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-InputFormat', 'Text', '-NoExit', '-Command', '-'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (d) => this.onData(d));
    this.child.stderr.on('data', () => {});
    this.child.on('exit', () => { this.child = null; if (this.cur) { this.finish({ ok: false, stdout: this.buf, error: 'PowerShell exited' }); } });
    this.child.on('error', () => { this.child = null; });
    this.child.stdin.write('[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ProgressPreference = "SilentlyContinue"; $ErrorActionPreference = "Continue"\n');
  }
  onData(d) {
    if (!this.cur) return;
    this.buf += d;
    const i = this.buf.indexOf(this.cur.marker);
    if (i >= 0) { const text = this.buf.slice(0, i); this.buf = ''; this.finish({ ok: !/^__VERR__/m.test(text), stdout: text.replace(/^__VERR__.*$/m, '').replace(/\r/g, '') }); }
  }
  finish(r) { const c = this.cur; this.cur = null; this.busy = false; if (c) { clearTimeout(c.timer); c.resolve(r); } this.next(); }
  exec(script, { timeout = 20000 } = {}) {
    return new Promise((resolve) => { this.queue.push({ script, timeout, resolve }); this.next(); });
  }
  next() {
    if (this.busy || !this.queue.length) return;
    this.start();
    if (!this.child) { const q = this.queue.shift(); q.resolve({ ok: false, stdout: '', error: 'PowerShell unavailable' }); return this.next(); }
    const job = this.queue.shift(); this.busy = true;
    const marker = `__VEND_${++this.seq}__`;
    const b64 = Buffer.from(job.script, 'utf8').toString('base64');
    this.cur = { marker, resolve: job.resolve, timer: setTimeout(() => { this.kill(); }, job.timeout) };
    this.buf = '';
    this.child.stdin.write(`try { Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))) | Out-String -Width 4096 | Write-Output } catch { Write-Output ("__VERR__ " + $_) }; Write-Output '${marker}'\n`);
  }
  kill() { const c = this.cur; try { this.child && this.child.kill(); } catch (_) {} this.child = null; if (c) { this.cur = null; this.busy = false; clearTimeout(c.timer); c.resolve({ ok: false, stdout: '', error: 'timed out' }); } this.next(); }
  stop() { this.queue = []; try { this.child && this.child.kill(); } catch (_) {} this.child = null; }
}

const shells = {};
/** Run a PowerShell script in a shared shell ("fast" for quick polls, "slow" for heavy queries). */
function ps(script, { shell = 'fast', timeout } = {}) {
  if (!isWin) return Promise.resolve({ ok: false, stdout: '', error: 'not windows' });
  shells[shell] = shells[shell] || new PowerShell(shell);
  return shells[shell].exec(script, { timeout });
}
/** ps() and parse ConvertTo-Json output (always returns an array). */
async function psJson(script, opts) {
  const r = await ps(`ConvertTo-Json -Depth 4 -Compress -InputObject @(& { ${script} })`, opts);
  if (!r.ok) return [];
  const t = r.stdout.trim(); if (!t) return [];
  try { const v = JSON.parse(t); return Array.isArray(v) ? v : [v]; } catch { return []; }
}
function stopShells() { for (const k of Object.keys(shells)) shells[k].stop(); }

module.exports = { run, out, runAdmin, pool, ps, psJson, stopShells, isMac, isWin, PowerShell };
