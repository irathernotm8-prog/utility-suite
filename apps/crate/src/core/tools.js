// Crate — the command-line tools it drives: FFmpeg (bundled), yt-dlp and Deno (downloaded on first run, kept up to date)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
let binDir = null;

function init(dir) { binDir = path.join(dir, 'bin'); fs.mkdirSync(binDir, { recursive: true }); }

const unpacked = (p) => (p ? p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`) : p);

function ffmpeg() {
  if (process.env.CRATE_FFMPEG) return process.env.CRATE_FFMPEG;
  try { return unpacked(require('ffmpeg-static')); } catch { return 'ffmpeg'; }
}
const exe = (name) => (IS_WIN ? name + '.exe' : name);
function ytdlp() { return process.env.CRATE_YTDLP || path.join(binDir, exe('yt-dlp')); }

function onPath(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  if (IS_MAC) dirs.push('/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.deno', 'bin'));
  if (IS_WIN) dirs.push(path.join(os.homedir(), '.deno', 'bin'));
  for (const d of dirs) { const p = path.join(d, exe(name)); try { if (fs.statSync(p).isFile()) return p; } catch {} }
  return null;
}
function deno() {
  if (process.env.CRATE_DENO) return process.env.CRATE_DENO;
  const own = path.join(binDir, exe('deno'));
  if (fs.existsSync(own)) return own;
  return onPath('deno');
}

function assets() {
  const arm = process.arch === 'arm64';
  if (IS_MAC) return { ytdlp: 'yt-dlp_macos', deno: arm ? 'deno-aarch64-apple-darwin.zip' : 'deno-x86_64-apple-darwin.zip' };
  if (IS_WIN) return { ytdlp: 'yt-dlp.exe', deno: 'deno-x86_64-pc-windows-msvc.zip' };
  return { ytdlp: arm ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux', deno: arm ? 'deno-aarch64-unknown-linux-gnu.zip' : 'deno-x86_64-unknown-linux-gnu.zip' };
}

function version(bin, args = ['--version']) {
  return new Promise((resolve) => {
    if (!bin || !fs.existsSync(bin)) return resolve(null);
    execFile(bin, args, { timeout: 20000, windowsHide: true }, (err, out) => resolve(err ? null : String(out).trim().split('\n')[0]));
  });
}

async function status() {
  const [y, d, f] = await Promise.all([version(ytdlp()), version(deno()), version(ffmpeg(), ['-version'])]);
  return {
    ytdlp: y, deno: d ? d.replace(/^deno\s+/, '').split(' ')[0] : null,
    ffmpeg: f ? (f.match(/ffmpeg version (\S+)/) || [])[1] || 'ok' : null,
    denoOwn: fs.existsSync(path.join(binDir, exe('deno'))),
    ready: !!(y && f)
  };
}

function getFetch() {
  if (process.versions.electron) { const { net } = require('electron'); if (net && net.fetch) return net.fetch.bind(net); }
  return fetch;
}

async function download(url, dest, onProgress) {
  const res = await getFetch()(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${path.basename(url)}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
    if (onProgress && total) onProgress(got / total);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  fs.renameSync(tmp, dest);
}

function unzip(zip, dir) {
  return new Promise((resolve, reject) => {
    const [cmd, args] = IS_MAC ? ['ditto', ['-x', '-k', zip, dir]]
      : IS_WIN ? ['tar', ['-xf', zip, '-C', dir]]
      : ['python3', ['-c', 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zip, dir]];
    execFile(cmd, args, { windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });
}

// Install or refresh yt-dlp (+ Deno, which YouTube now needs to unlock formats).
async function install({ onProgress, force = false } = {}) {
  const a = assets();
  const report = (stage, p) => onProgress && onProgress({ stage, progress: p });
  const yt = ytdlp();
  if (force || !fs.existsSync(yt)) {
    report('Downloading yt-dlp', 0);
    await download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${a.ytdlp}`, yt, (p) => report('Downloading yt-dlp', p));
    if (!IS_WIN) fs.chmodSync(yt, 0o755);
  }
  const ownDeno = path.join(binDir, exe('deno'));
  if (!deno() || (force && fs.existsSync(ownDeno))) {
    report('Downloading Deno (lets yt-dlp read YouTube)', 0);
    const zip = path.join(binDir, 'deno.zip');
    await download(`https://github.com/denoland/deno/releases/latest/download/${a.deno}`, zip, (p) => report('Downloading Deno (lets yt-dlp read YouTube)', p));
    const tmpDir = path.join(binDir, 'deno-unzip');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    await unzip(zip, tmpDir);
    fs.rmSync(ownDeno, { force: true });
    fs.renameSync(path.join(tmpDir, exe('deno')), ownDeno);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(zip, { force: true });
    if (!IS_WIN) fs.chmodSync(ownDeno, 0o755);
  }
  report('Done', 1);
  return status();
}

// Quiet self-update for yt-dlp (YouTube changes often; stale yt-dlp is the #1 cause of failures).
function selfUpdate() {
  return new Promise((resolve) => {
    if (!fs.existsSync(ytdlp())) return resolve(false);
    execFile(ytdlp(), ['-U'], { timeout: 120000, windowsHide: true }, (err, out) => resolve(!err && /Updated|up to date/i.test(String(out))));
  });
}

// Run a process; resolves with { code, stdout, stderr }. onLine gets stdout+stderr lines as they arrive.
function run(bin, args, { onLine, signal, cwd, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true });
    const out = []; let err = ''; let buf = '';
    const feed = (chunk) => {
      if (!onLine) return;
      buf += chunk.toString();
      const parts = buf.split(/\r?\n|\r/);
      buf = parts.pop();
      for (const l of parts) if (l.trim()) onLine(l);
    };
    child.stdout.on('data', (d) => { out.push(d); if (!binary) feed(d); });
    child.stderr.on('data', (d) => { err += d; if (err.length > 200000) err = err.slice(-100000); feed(d); });
    child.on('error', reject);
    const kill = () => { try { child.kill('SIGKILL'); } catch {} };
    if (signal) { if (signal.aborted) kill(); else signal.addEventListener('abort', kill, { once: true }); }
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', kill);
      const stdout = Buffer.concat(out);
      resolve({ code, stdout: binary ? stdout : stdout.toString(), stderr: err, aborted: !!(signal && signal.aborted) });
    });
  });
}

module.exports = { init, ffmpeg, ytdlp, deno, status, install, selfUpdate, run, IS_WIN, IS_MAC };
