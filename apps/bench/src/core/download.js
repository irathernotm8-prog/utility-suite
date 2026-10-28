// Bench — downloads with redirects and progress (engines like Tart are fetched the first time they're needed).
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

function download(url, dest, { onProgress = () => {}, headers = {}, maxRedirects = 8 } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  return new Promise((resolve, reject) => {
    const go = (u, left) => {
      const lib = u.startsWith('https:') ? https : http;
      const req = lib.get(u, { headers: { 'User-Agent': 'Bench (Utility Suite)', ...headers } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); if (!left) return reject(new Error('Too many redirects'));
          return go(new URL(res.headers.location, u).toString(), left - 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`Download failed (${res.statusCode}) from ${new URL(u).host}`)); }
        const total = +res.headers['content-length'] || 0; let got = 0; let last = 0;
        const out = fs.createWriteStream(tmp);
        res.on('data', (c) => { got += c.length; const now = Date.now(); if (now - last > 200) { last = now; onProgress({ got, total, pct: total ? got / total : null }); } });
        res.pipe(out);
        out.on('finish', () => { out.close(() => { try { fs.renameSync(tmp, dest); onProgress({ got, total, pct: 1 }); resolve(dest); } catch (e) { reject(e); } }); });
        out.on('error', reject); res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(60000, () => req.destroy(new Error('The download stalled')));
    };
    go(url, maxRedirects);
  });
}

module.exports = { download };
