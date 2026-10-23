// Touchline — crests, flags and player photos through `tl-img://`.
// Each picture is fetched once, kept on disk, and served from there after,
// so the app looks right offline and doesn't refetch the same crest a thousand times.
'use strict';
const { protocol, net } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { UA } = require('./http');

const ALLOWED = /^https:\/\/(images\.fotmob\.com|a\.espncdn\.com|upload\.wikimedia\.org|commons\.wikimedia\.org)\//;
const MAX_AGE = 30 * 24 * 3600 * 1000;
let dir = null;
const misses = new Map(); // url -> time of last 404, so we don't hammer missing images

function registerScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'tl-img', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
}

const typeOf = (buf) => (buf[0] === 0x89 ? 'image/png' : buf[0] === 0xff ? 'image/jpeg' : buf.slice(0, 4).toString() === 'RIFF' ? 'image/webp' : buf.slice(0, 5).toString().includes('<svg') || buf.slice(0, 5).toString() === '<?xml' ? 'image/svg+xml' : 'image/png');

function handle(userDataDir) {
  dir = path.join(userDataDir, 'cache', 'img');
  fs.mkdirSync(dir, { recursive: true });
  protocol.handle('tl-img', async (req) => {
    const u = new URL(req.url).searchParams.get('u') || '';
    if (!ALLOWED.test(u)) return new Response('', { status: 400 });
    const h = crypto.createHash('sha1').update(u).digest('hex');
    const f = path.join(dir, h.slice(0, 2), h);
    let st = null;
    try { st = fs.statSync(f); } catch {}
    if (st && Date.now() - st.mtimeMs < MAX_AGE) return serve(fs.readFileSync(f));
    const miss = misses.get(u);
    if (miss && Date.now() - miss < 6 * 3600 * 1000) return st ? serve(fs.readFileSync(f)) : new Response('', { status: 404 });
    try {
      const res = await net.fetch(u, { headers: { 'user-agent': UA, referer: 'https://www.fotmob.com/' } });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, buf);
      return serve(buf);
    } catch (err) {
      if (err.status === 404 || err.status === 403) misses.set(u, Date.now());
      if (st) return serve(fs.readFileSync(f));
      return new Response('', { status: 404 });
    }
  });
}

function serve(buf) {
  return new Response(buf, { status: 200, headers: { 'content-type': typeOf(buf), 'cache-control': 'max-age=86400' } });
}

function size() {
  let bytes = 0, files = 0;
  const walk = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, n.name); if (n.isDirectory()) walk(p); else { files++; bytes += fs.statSync(p).size; } } };
  try { walk(dir); } catch {}
  return { bytes, files };
}
function clear() { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} fs.mkdirSync(dir, { recursive: true }); misses.clear(); }

module.exports = { registerScheme, handle, size, clear };
