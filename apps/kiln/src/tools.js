// Kiln — running commands, finding/downloading uv and Git, detecting the GPU.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { net } = require('electron');
const core = require('./core');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const EXE = IS_WIN ? '.exe' : '';

/* ---------- processes ---------- */
// Runs a command and streams its output line by line. Resolves with the exit code.
function run(cmd, args, { cwd, env, onLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, shell: false });
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
    signal?.addEventListener('abort', () => { try { killTree(child.pid); } catch {} });
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

/* ---------- downloads (tools) ---------- */
async function downloadFile(url, dest, { headers, onProgress } = {}) {
  const res = await net.fetch(url, { headers });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let got = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (c) => { got += c.length; onProgress?.(got, total); });
  await pipeline(body, fs.createWriteStream(dest + '.part'));
  fs.renameSync(dest + '.part', dest);
  return dest;
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
async function findUv() {
  const t = core.g().tools;
  if (exists(t.uv)) return t.uv;
  const own = path.join(core.toolsDir(), 'uv', 'uv' + EXE);
  if (exists(own)) return own;
  const sys = await which('uv');
  return sys;
}
async function ensureUv(log) {
  const found = await findUv();
  if (found) return found;
  log?.('Downloading uv (Python manager)…');
  const dir = path.join(core.toolsDir(), 'uv');
  const arc = path.join(core.toolsDir(), uvAsset());
  await downloadFile(`https://github.com/astral-sh/uv/releases/latest/download/${uvAsset()}`, arc);
  const tmp = dir + '-tmp';
  await extract(arc, tmp);
  const bin = findFile(tmp, 'uv' + EXE);
  if (!bin) throw new Error('uv download did not contain uv' + EXE);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(path.dirname(bin))) fs.renameSync(path.join(path.dirname(bin), f), path.join(dir, f));
  try { fs.rmSync(tmp, { recursive: true, force: true }); fs.unlinkSync(arc); } catch {}
  if (!IS_WIN) fs.chmodSync(path.join(dir, 'uv'), 0o755);
  core.g().tools.uv = path.join(dir, 'uv' + EXE); core.saveGlobal();
  return core.g().tools.uv;
}
function pythonDir() { return core.g().tools.pythonDir || core.ensureDir(path.join(core.toolsDir(), 'Python')); }
function uvEnv() {
  return { UV_PYTHON_INSTALL_DIR: pythonDir(), UV_CACHE_DIR: core.ensureDir(path.join(core.toolsDir(), 'uv-cache')), UV_LINK_MODE: 'copy' };
}

/* ---------- Git ---------- */
async function findGit() {
  const t = core.g().tools;
  if (exists(t.git)) return t.git;
  const own = IS_WIN ? path.join(core.toolsDir(), 'git', 'cmd', 'git.exe') : null;
  if (own && exists(own)) return own;
  const sys = await which('git');
  if (sys) { const r = await capture(sys, ['--version'], { timeout: 8000 }); if (r.ok) return sys; }
  return null;
}
async function ensureGit(log) {
  const found = await findGit();
  if (found) return found;
  if (!IS_WIN) throw new Error(IS_MAC ? 'Git is missing. Run "xcode-select --install" in Terminal, then try again.' : 'Git is missing. Install git, then try again.');
  log?.('Downloading Git for Windows (MinGit)…');
  const rel = await (await net.fetch('https://api.github.com/repos/git-for-windows/git/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })).json();
  const asset = (rel.assets || []).find(a => /^MinGit-[\d.]+-64-bit\.zip$/.test(a.name));
  if (!asset) throw new Error('Could not find a MinGit download on GitHub.');
  const arc = path.join(core.toolsDir(), asset.name);
  await downloadFile(asset.browser_download_url, arc);
  const dir = path.join(core.toolsDir(), 'git');
  await extract(arc, dir);
  try { fs.unlinkSync(arc); } catch {}
  core.g().tools.git = path.join(dir, 'cmd', 'git.exe'); core.saveGlobal();
  return core.g().tools.git;
}
// PATH additions so packages (which call `git` themselves) find our Git
function gitPathDirs(gitExe) {
  if (!gitExe) return [];
  const d = path.dirname(gitExe);
  const root = path.basename(d).toLowerCase() === 'cmd' || path.basename(d).toLowerCase() === 'bin' ? path.dirname(d) : d;
  return [d, path.join(root, 'bin'), path.join(root, 'usr', 'bin'), path.join(root, 'mingw64', 'bin')].filter(exists);
}

/* ---------- GPU ---------- */
let gpuCache = null;
async function detectGpu() {
  if (gpuCache) return gpuCache;
  const gpus = [];
  const smi = await capture(IS_WIN ? 'nvidia-smi.exe' : 'nvidia-smi', ['--query-gpu=name,memory.total,driver_version,compute_cap', '--format=csv,noheader,nounits'], { timeout: 8000 });
  if (smi.ok) {
    for (const line of smi.out.split(/\r?\n/).filter(Boolean)) {
      const [name, mem, driver, cc] = line.split(',').map(s => s.trim());
      gpus.push({ vendor: 'nvidia', name, memoryMB: Number(mem) || 0, driver, computeCap: cc });
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
  if (IS_MAC) gpus.push({ vendor: 'apple', name: process.arch === 'arm64' ? 'Apple Silicon' : 'Mac GPU', memoryMB: Math.round(require('os').totalmem() / 1048576) });
  const best = gpus.find(x => x.vendor === 'nvidia') || gpus[0] || null;
  const torch = !best ? 'cpu' : best.vendor === 'nvidia' ? 'cuda' : best.vendor === 'apple' ? 'mps' : best.vendor === 'amd' && !IS_WIN ? 'rocm' : 'cpu';
  gpuCache = { gpus, best, torch };
  return gpuCache;
}
const TORCH_INDEX = {
  cuda: 'https://download.pytorch.org/whl/cu128',
  rocm: 'https://download.pytorch.org/whl/rocm6.3',
  cpu: 'https://download.pytorch.org/whl/cpu',
  mps: null
};

module.exports = { IS_WIN, IS_MAC, EXE, run, capture, killTree, downloadFile, extract, findFile, exists, which, findUv, ensureUv, uvEnv, pythonDir, findGit, ensureGit, gitPathDirs, detectGpu, TORCH_INDEX };
