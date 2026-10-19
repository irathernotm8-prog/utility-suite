'use strict';
// Small process / file helpers shared by the hub's modules. No Electron imports here.
const fs = require('./fsx');
const fsp = require('./fsx').promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    let p;
    try {
      p = spawn(cmd, args, { windowsHide: true, ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { reject(e); return; }
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => (opts.allowFail ? resolve({ code: -1, stdout: out, stderr: String(e) }) : reject(e)));
    p.on('close', (code) => {
      if (code === 0 || opts.allowFail) resolve({ code, stdout: out, stderr: err });
      else reject(new Error(`${path.basename(cmd)} failed (${code}): ${(err || out).trim().slice(0, 400)}`));
    });
  });
}

const POWERSHELL = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
function powershell(script, opts = {}) {
  return run(POWERSHELL(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], opts);
}
async function powershellJSON(script, opts = {}) {
  const r = await powershell(script, opts);
  const txt = r.stdout.trim();
  if (!txt) return [];
  const v = JSON.parse(txt);
  return Array.isArray(v) ? v : [v];
}

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
function readJSON(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

// Copy a file while hashing it; reports bytes copied.
function copyWithHash(src, dst, onBytes) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const h = crypto.createHash('sha256');
    let n = 0;
    const rs = fs.createReadStream(src);
    const ws = fs.createWriteStream(dst);
    rs.on('data', (d) => { h.update(d); n += d.length; if (onBytes) onBytes(n); });
    rs.on('error', (e) => { ws.destroy(); reject(e); });
    ws.on('error', reject);
    ws.on('finish', () => resolve(h.digest('hex')));
    rs.pipe(ws);
  });
}

// "1.10.0" > "1.9.2"; "1.0.0-beta" < "1.0.0"; suite dates "2026.10.16-2" > "2026.10.16"
function compareVersions(a, b) {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  const split = (v) => {
    const [main, ...rest] = String(v).replace(/^v/i, '').split('-');
    return { nums: main.split('.').map((x) => parseInt(x, 10) || 0), pre: rest.join('-') };
  };
  const A = split(a), B = split(b);
  for (let i = 0; i < Math.max(A.nums.length, B.nums.length); i++) {
    const d = (A.nums[i] || 0) - (B.nums[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  if (A.pre === B.pre) return 0;
  // numeric suffix (suite rebuilds "-2") sorts after none; text suffix (prerelease) sorts before
  const numeric = (s) => /^\d+$/.test(s);
  if (!A.pre) return numeric(B.pre) ? -1 : 1;
  if (!B.pre) return numeric(A.pre) ? 1 : -1;
  if (numeric(A.pre) && numeric(B.pre)) return Math.sign(+A.pre - +B.pre);
  return A.pre < B.pre ? -1 : 1;
}

async function extractZip(zip, dest, platform = process.platform) {
  await fsp.mkdir(dest, { recursive: true });
  if (platform === 'darwin') return run('/usr/bin/ditto', ['-x', '-k', '--noqtn', zip, dest]);
  if (platform === 'win32') return run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dest]);
  return run('unzip', ['-q', '-o', zip, '-d', dest]);
}

// Move a file tree, falling back to copy+delete across volumes.
async function moveTree(src, dst, platform = process.platform) {
  try {
    await fsp.rename(src, dst);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    if (platform === 'darwin') await run('/usr/bin/ditto', ['--noqtn', src, dst]);
    else await fsp.cp(src, dst, { recursive: true, verbatimSymlinks: true });
    await fsp.rm(src, { recursive: true, force: true });
  }
}

async function dirSize(dir) {
  let total = 0;
  const walk = async (d) => {
    let ents;
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) { try { total += (await fsp.stat(p)).size; } catch {} }
    }
  };
  await walk(dir);
  return total;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check, timeoutMs, everyMs = 500) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return true;
    await sleep(everyMs);
  }
  return !!(await check());
}

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

module.exports = {
  run, powershell, powershellJSON, exists, isDir, readJSON, writeJSON, sha256File, copyWithHash,
  compareVersions, extractZip, moveTree, dirSize, sleep, waitFor, psQuote,
};
