// Facet — processes, downloads (resumable), uv (Python manager) and hardware detection.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { net } = require('electron');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const EXE = IS_WIN ? '.exe' : '';

/* ---------- processes ---------- */
// Runs a command and streams its output line by line. Resolves with the exit code.
function run(cmd, args, { cwd, env, onLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, shell: false, detached: !IS_WIN });
    } catch (e) { reject(e); return; }
    const split = (buf, chunk) => {
      buf.s += chunk.toString();
      const parts = buf.s.split(/\r?\n|\r(?!\n)/);
      buf.s = parts.pop();
      for (const l of parts) onLine?.(l);
    };
    const o = { s: '' }, e = { s: '' };
    child.stdout.on('data', d => split(o, d));
    child.stderr.on('data', d => split(e, d));
    child.on('error', reject);
    child.on('close', code => { if (o.s) onLine?.(o.s); if (e.s) onLine?.(e.s); resolve(code); });
    signal?.addEventListener('abort', () => killTree(child.pid));
  });
}
function capture(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: opts.timeout || 20000, cwd: opts.cwd, env: { ...process.env, ...(opts.env || {}) }, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, out: String(stdout || ''), err: String(stderr || '') });
    });
  });
}
function killTree(pid) {
  if (!pid) return;
  if (IS_WIN) { try { spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }); } catch {} }
  else { try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch {} } }
}

/* ---------- downloads ---------- */
// Streams url to dest. Keeps a .part file so a stopped download picks up where it left off.
async function downloadFile(url, dest, { headers = {}, onProgress, signal, expectedSize } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = dest + '.part';
  let have = 0;
  try { have = fs.statSync(part).size; } catch {}
  if (expectedSize && have >= expectedSize) { fs.renameSync(part, dest); return dest; }
  const h = { ...headers };
  if (have > 0) h.Range = `bytes=${have}-`;
  const res = await net.fetch(url, { headers: h, signal });
  if (res.status === 416 && expectedSize && have === expectedSize) { fs.renameSync(part, dest); return dest; }
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url.replace(/\?.*/, '')}`);
  const resumed = res.status === 206;
  if (!resumed) have = 0;
  const total = resumed ? have + (Number(res.headers.get('content-length')) || 0) : (Number(res.headers.get('content-length')) || expectedSize || 0);
  let got = have, last = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (c) => {
    got += c.length;
    const now = Date.now();
    if (now - last > 150) { last = now; onProgress?.(got, total); }
  });
  await pipeline(body, fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' }), { signal });
  onProgress?.(got, total);
  fs.renameSync(part, dest);
  return dest;
}
async function fetchJson(url, headers = {}) {
  const res = await net.fetch(url, { headers: { Accept: 'application/json', ...headers } });
  if (!res.ok) throw new Error(`Request failed (${res.status}) for ${url}`);
  return res.json();
}
async function extract(archive, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const r = await capture(IS_WIN ? 'tar.exe' : 'tar', ['-xf', archive, '-C', dir], { timeout: 300000 });
  if (!r.ok) throw new Error('Could not unpack ' + path.basename(archive) + ': ' + r.err.slice(0, 300));
}
function findFile(dir, name, depth = 4) {
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return p;
    }
    if (depth > 0) for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { const f = findFile(path.join(dir, e.name), name, depth - 1); if (f) return f; }
    }
  } catch {}
  return null;
}
const exists = (p) => { try { return !!p && fs.existsSync(p); } catch { return false; } };
function dirSize(dir) {
  let n = 0;
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { n += fs.statSync(p).size; } catch {} }
    }
  };
  walk(dir);
  return n;
}

/* ---------- uv (Python + virtual environments) ---------- */
function uvAsset() {
  if (IS_WIN) return 'uv-x86_64-pc-windows-msvc.zip';
  if (IS_MAC) return process.arch === 'arm64' ? 'uv-aarch64-apple-darwin.tar.gz' : 'uv-x86_64-apple-darwin.tar.gz';
  return process.arch === 'arm64' ? 'uv-aarch64-unknown-linux-gnu.tar.gz' : 'uv-x86_64-unknown-linux-gnu.tar.gz';
}
async function which(name) {
  const r = await capture(IS_WIN ? 'where' : 'which', [name], { timeout: 5000 });
  const p = r.ok ? r.out.split(/\r?\n/).map(s => s.trim()).find(Boolean) : '';
  return p || null;
}
async function ensureUv(toolsDir, log) {
  const own = path.join(toolsDir, 'uv', 'uv' + EXE);
  if (exists(own)) return own;
  log?.('Downloading uv, the Python manager…');
  const arc = path.join(toolsDir, uvAsset());
  await downloadFile(`https://github.com/astral-sh/uv/releases/latest/download/${uvAsset()}`, arc);
  const tmp = path.join(toolsDir, 'uv-tmp');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  await extract(arc, tmp);
  const bin = findFile(tmp, 'uv' + EXE);
  if (!bin) throw new Error('The uv download did not contain uv' + EXE);
  const dir = path.dirname(own);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(path.dirname(bin))) fs.renameSync(path.join(path.dirname(bin), f), path.join(dir, f));
  try { fs.rmSync(tmp, { recursive: true, force: true }); fs.unlinkSync(arc); } catch {}
  if (!IS_WIN) fs.chmodSync(own, 0o755);
  return own;
}

/* ---------- hardware ---------- */
let hwCache = null;
async function detectHardware() {
  if (hwCache) return hwCache;
  const gpus = [];
  const smi = await capture(IS_WIN ? 'nvidia-smi.exe' : 'nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'], { timeout: 8000 });
  if (smi.ok) {
    for (const line of smi.out.split(/\r?\n/).filter(Boolean)) {
      const [name, mem, driver] = line.split(',').map(s => s.trim());
      gpus.push({ vendor: 'nvidia', name, memoryMB: Number(mem) || 0, driver });
    }
  }
  if (!gpus.length && IS_WIN) {
    const r = await capture('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + "|" + $_.AdapterRAM }'], { timeout: 12000 });
    for (const line of r.out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
      const [name, ram] = line.split('|');
      const vendor = /nvidia/i.test(name) ? 'nvidia' : /amd|radeon/i.test(name) ? 'amd' : /intel|arc/i.test(name) ? 'intel' : 'other';
      gpus.push({ vendor, name, memoryMB: Math.round((Number(ram) || 0) / 1048576) });
    }
  }
  let chip = null;
  if (IS_MAC) {
    const r = await capture('sysctl', ['-n', 'machdep.cpu.brand_string'], { timeout: 4000 });
    chip = r.ok ? r.out.trim() : (process.arch === 'arm64' ? 'Apple Silicon' : 'Intel Mac');
    if (process.arch === 'arm64') gpus.push({ vendor: 'apple', name: chip + ' GPU', memoryMB: Math.round(os.totalmem() / 1048576) });
  }
  const best = gpus.find(x => x.vendor === 'nvidia') || gpus.find(x => x.vendor === 'apple') || null;
  // what the engine will run on
  const accel = best?.vendor === 'nvidia' ? 'cuda' : best?.vendor === 'apple' ? 'mps' : 'cpu';
  const cpu = (os.cpus()[0]?.model || '').replace(/\s+/g, ' ').trim();
  hwCache = {
    gpus, best, accel, chip, cpu, cores: os.cpus().length, ramMB: Math.round(os.totalmem() / 1048576),
    vramMB: best?.vendor === 'nvidia' ? best.memoryMB : best?.vendor === 'apple' ? Math.round(os.totalmem() / 1048576) : 0,
    platform: process.platform, arch: process.arch
  };
  return hwCache;
}

module.exports = { IS_WIN, IS_MAC, EXE, run, capture, killTree, downloadFile, fetchJson, extract, findFile, exists, dirSize, which, ensureUv, detectHardware };
