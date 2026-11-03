// Atrium — bringing images and files into a site: from this computer or a URL, with big photos resized for the
// web (longest side 2400px, JPEG 84 unless the picture has transparency), plus logo → favicon.
'use strict';
const fs = require('fs');
const path = require('path');
const { nativeImage } = require('electron');

const MAX = 2400;
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/avif': '.avif', 'video/mp4': '.mp4', 'video/webm': '.webm', 'font/woff2': '.woff2', 'application/pdf': '.pdf' };

function hasAlpha(img) { const b = img.toBitmap(); for (let i = 3; i < b.length; i += 4 * 97) if (b[i] < 250) return true; return false; }
// → { buf, ext }
function optimize(buf, ext) {
  ext = ext.toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext) || buf.length < 350 * 1024) return { buf, ext };
  const img = nativeImage.createFromBuffer(buf); if (img.isEmpty()) return { buf, ext };
  const { width, height } = img.getSize(); let out = img;
  if (Math.max(width, height) > MAX) out = width >= height ? img.resize({ width: MAX, quality: 'best' }) : img.resize({ height: MAX, quality: 'best' });
  if (ext === '.png' && hasAlpha(out)) { const p = out.toPNG(); return p.length < buf.length ? { buf: p, ext: '.png' } : { buf, ext }; }
  const j = out.toJPEG(84); return j.length < buf.length ? { buf: j, ext: '.jpg' } : { buf, ext };
}

async function fromFile(site, file, name) {
  if (!fs.existsSync(file)) throw new Error('No file at ' + file);
  const st = fs.statSync(file); if (st.isDirectory()) throw new Error('That’s a folder; give a file');
  if (st.size > 200 * 1024 * 1024) throw new Error('That file is over 200 MB');
  const o = optimize(fs.readFileSync(file), path.extname(file) || '.bin');
  const base = (name || path.basename(file)).replace(/\.[^.]+$/, '');
  return site.addAssetBuffer(base + o.ext, o.buf);
}
async function fromUrl(site, url, name) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Give a full https:// address');
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Atrium website builder)' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  const len = +r.headers.get('content-length') || 0; if (len > 60 * 1024 * 1024) throw new Error('That file is over 60 MB');
  const buf = Buffer.from(await r.arrayBuffer());
  const type = (r.headers.get('content-type') || '').split(';')[0].trim();
  let ext = path.extname(new URL(url).pathname).toLowerCase(); if (!ext || ext.length > 6) ext = EXT[type] || '.bin';
  if (/text\/html/.test(type)) throw new Error('That address is a web page, not a file. Use the image’s own address.');
  const o = optimize(buf, ext);
  const base = name ? name.replace(/\.[^.]+$/, '') : decodeURIComponent(path.basename(new URL(url).pathname, path.extname(new URL(url).pathname))) || 'image';
  return site.addAssetBuffer(base.slice(0, 60) + o.ext, o.buf);
}
// a square PNG favicon from any image
function favicon(site, rel) {
  const buf = site.p(rel); const img = nativeImage.createFromPath(buf); if (img.isEmpty()) throw new Error('Couldn’t read that image');
  const { width, height } = img.getSize(); const s = Math.min(width, height);
  const sq = img.crop({ x: Math.floor((width - s) / 2), y: Math.floor((height - s) / 2), width: s, height: s }).resize({ width: 192, height: 192, quality: 'best' });
  return site.addAssetBuffer('favicon.png', sq.toPNG());
}

module.exports = { fromFile, fromUrl, optimize, favicon };
