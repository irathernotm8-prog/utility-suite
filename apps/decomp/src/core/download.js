// HTTPS downloads with progress, resume (Range) and checksum checks, and unpacking with tools every
// Mac and Windows 10/11 PC already has (ditto / tar), so no native modules are needed.
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const UA = 'Decomp/0.1 (Utility Suite; +https://github.com/irathernotm8-prog/utility-suite)';

function get(url, { headers = {}, timeout = 30000, redirects = 8 } = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('http:') ? http : https;
    const req = lib.get(url, { headers: { 'User-Agent': UA, ...headers }, timeout }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), { headers, timeout, redirects: redirects - 1 }));
      }
      res.url = url;
      resolve(res);
    });
    req.on('timeout', () => req.destroy(new Error('Timed out connecting to ' + new URL(url).host)));
    req.on('error', reject);
  });
}

async function fetchText(url, opts = {}) {
  const res = await get(url, opts);
  if (res.statusCode >= 400) { res.resume(); throw new Error(`${new URL(url).host} answered ${res.statusCode}`); }
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}
const fetchJson = async (url, opts) => JSON.parse(await fetchText(url, { ...opts, headers: { Accept: 'application/json', ...(opts?.headers || {}) } }));

function hashFile(file, algo) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(file, { highWaterMark: 4 << 20 }).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

// Downloads url to dest, resuming a .part file. `hash` is "sha256:hex" or "sha512:hex".
async function download(url, dest, { hash, size, onProgress, signal } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = dest + '.part';
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  if (size && have > size) { fs.rmSync(part, { force: true }); have = 0; }
  if (!(size && have === size)) {
    const res = await get(url, { headers: have ? { Range: `bytes=${have}-` } : {} });
    if (res.statusCode === 200 && have) have = 0;
    else if (res.statusCode === 416) { res.resume(); have = size || have; }
    if (res.statusCode >= 400 && res.statusCode !== 416) { res.resume(); throw new Error(`Download failed (${res.statusCode}) from ${new URL(url).host}`); }
    if (res.statusCode !== 416) {
      const total = size || (+res.headers['content-length'] || 0) + have;
      const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
      let got = have, last = 0, lastGot = have; const t0 = Date.now();
      await new Promise((resolve, reject) => {
        const abort = () => { res.destroy(); out.close(); reject(Object.assign(new Error('Cancelled'), { cancelled: true })); };
        if (signal) { if (signal.aborted) return abort(); signal.addEventListener('abort', abort, { once: true }); }
        res.on('data', (c) => {
          got += c.length;
          const now = Date.now();
          if (onProgress && now - last > 250) { const rate = ((got - lastGot) / Math.max(1, now - (last || t0))) * 1000; last = now; lastGot = got; onProgress({ got, total, rate }); }
        });
        res.on('error', reject); out.on('error', reject); out.on('finish', resolve);
        res.pipe(out);
      });
      onProgress && onProgress({ got, total, rate: 0 });
    }
  }
  if (hash) {
    const [algo, want] = hash.split(':');
    onProgress && onProgress({ verifying: true });
    const got = await hashFile(part, algo);
    if (got.toLowerCase() !== want.toLowerCase()) { fs.rmSync(part, { force: true }); throw new Error('The download was damaged (checksum mismatch). Try again.'); }
  }
  fs.renameSync(part, dest);
  return dest;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    let err = '', out = '';
    p.stderr && p.stderr.on('data', (d) => { err += d; if (err.length > 8000) err = err.slice(-8000); });
    p.stdout && p.stdout.on('data', (d) => { out += d; if (out.length > 200000) out = out.slice(-200000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${path.basename(cmd)} exited with ${code}: ${(err || out).trim().split('\n').slice(-3).join(' ')}`))));
  });
}

const sysTar = () => (process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : process.platform === 'darwin' ? '/usr/bin/tar' : 'tar');

// Unpacks .zip / .tar.gz / .tar.xz keeping symlinks and executable bits.
async function unpack(archive, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (/\.zip$|\.nupkg$/i.test(archive)) {
    if (process.platform === 'darwin') return run('/usr/bin/ditto', ['-x', '-k', archive, destDir]);
    if (process.platform === 'win32') return run(sysTar(), ['-xf', archive, '-C', destDir]);
    return run('unzip', ['-q', '-o', archive, '-d', destDir]);
  }
  return run(sysTar(), ['-xf', archive, '-C', destDir]);
}

module.exports = { UA, get, fetchText, fetchJson, download, unpack, hashFile, run, sysTar };
