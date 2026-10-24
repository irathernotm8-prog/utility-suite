// Understands the app files people download: plain APKs and split bundles (APKM from APKMirror,
// XAPK from APKPure, APKS from bundletool/SAI). Reads zips and the binary manifest without native code.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ───────────── tiny zip reader (central directory, stored + deflate, zip64 sizes)
function openZip(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const tailLen = Math.min(size, 65557);
  const tail = Buffer.alloc(tailLen);
  fs.readSync(fd, tail, 0, tailLen, size - tailLen);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) { fs.closeSync(fd); throw new Error('Not a zip file'); }
  let count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
  if (cdOff === 0xffffffff || count === 0xffff) {
    const loc = tail.readUInt32LE(eocd - 20) === 0x07064b50 ? Number(tail.readBigUInt64LE(eocd - 20 + 8)) : -1;
    if (loc >= 0) {
      const z = Buffer.alloc(56); fs.readSync(fd, z, 0, 56, loc);
      count = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOff = Number(z.readBigUInt64LE(48));
    }
  }
  const cd = Buffer.alloc(cdSize);
  fs.readSync(fd, cd, 0, cdSize, cdOff);
  const entries = [];
  for (let p = 0, n = 0; n < count && p + 46 <= cd.length; n++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10);
    let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
    const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    let off = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nl);
    let x = p + 46 + nl; const xe = x + xl;
    while (x + 4 <= xe) {
      const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
      if (id === 1) { let q = x + 4; if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; } if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; } if (off === 0xffffffff) off = Number(cd.readBigUInt64LE(q)); }
      x += 4 + len;
    }
    entries.push({ name, method, csize, usize, off, encrypted: !!(flags & 1) });
    p = xe + cl;
  }
  const dataStart = (e) => { const h = Buffer.alloc(30); fs.readSync(fd, h, 0, 30, e.off); return e.off + 30 + h.readUInt16LE(26) + h.readUInt16LE(28); };
  return {
    entries,
    read(e) {
      if (e.encrypted) throw new Error('encrypted');
      const b = Buffer.alloc(e.csize); fs.readSync(fd, b, 0, e.csize, dataStart(e));
      return e.method === 0 ? b : zlib.inflateRawSync(b);
    },
    // Streams an entry to disk without holding it all in memory (bundles can be several GB with OBBs).
    extract(e, dest) {
      if (e.encrypted) throw new Error('encrypted');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const start = dataStart(e);
      return new Promise((resolve, reject) => {
        const src = fs.createReadStream(null, { fd, start, end: start + e.csize - 1, autoClose: false });
        const out = fs.createWriteStream(dest);
        const pipe = e.method === 0 ? src : src.pipe(zlib.createInflateRaw());
        pipe.on('error', reject); out.on('error', reject); out.on('finish', resolve);
        pipe.pipe(out);
      });
    },
    close() { try { fs.closeSync(fd); } catch {} },
  };
}

// ───────────── binary AndroidManifest.xml: package, versionName, versionCode, label (if literal), minSdk
function readManifest(buf) {
  const u16 = (o) => buf.readUInt16LE(o), u32 = (o) => buf.readUInt32LE(o);
  let strings = [];
  const out = { package: null, versionName: null, versionCode: null, label: null, minSdk: null, targetSdk: null, split: null, nativeCode: [] };
  let p = 8;
  while (p + 8 <= buf.length) {
    const type = u16(p), hsz = u16(p + 2), csz = u32(p + 4);
    if (csz <= 0) break;
    if (type === 0x0001) {                    // string pool
      const n = u32(p + 8), flags = u32(p + 16), sStart = u32(p + 20), utf8 = !!(flags & 0x100);
      strings = new Array(n);
      for (let i = 0; i < n; i++) {
        let o = p + sStart + u32(p + hsz + i * 4);
        if (utf8) {
          let l = buf[o++]; if (l & 0x80) o++;
          let bl = buf[o++]; if (bl & 0x80) bl = ((bl & 0x7f) << 8) | buf[o++];
          strings[i] = buf.toString('utf8', o, o + bl);
        } else {
          let l = u16(o); o += 2; if (l & 0x8000) { l = ((l & 0x7fff) << 16) | u16(o); o += 2; }
          strings[i] = buf.toString('utf16le', o, o + l * 2);
        }
      }
    } else if (type === 0x0102) {             // start element
      const tag = strings[u32(p + 20)];
      const attrStart = u16(p + 24), attrSize = u16(p + 26), attrCount = u16(p + 28);
      const attrs = {};
      for (let i = 0; i < attrCount; i++) {
        const a = p + 16 + attrStart + i * attrSize;
        const name = strings[u32(a + 4)], raw = u32(a + 8), dtype = buf[a + 15], data = u32(a + 16);
        attrs[name] = raw !== 0xffffffff ? strings[raw] : dtype === 0x03 ? strings[data] : dtype === 0x01 ? `@0x${data.toString(16)}` : data;
      }
      if (tag === 'manifest') { out.package = attrs.package || null; out.versionName = attrs.versionName != null ? String(attrs.versionName) : null; out.versionCode = attrs.versionCode ?? null; out.split = attrs.split || null; }
      if (tag === 'uses-sdk') { out.minSdk = attrs.minSdkVersion ?? null; out.targetSdk = attrs.targetSdkVersion ?? null; }
      if (tag === 'application' && typeof attrs.label === 'string' && !attrs.label.startsWith('@')) out.label = attrs.label;
    }
    p += csz;
  }
  return out;
}

function apkInfo(apkFile) {
  const z = openZip(apkFile);
  try {
    const m = z.entries.find((e) => e.name === 'AndroidManifest.xml');
    const info = m ? readManifest(z.read(m)) : {};
    info.abis = [...new Set(z.entries.map((e) => (e.name.match(/^lib\/([^/]+)\//) || [])[1]).filter(Boolean))];
    return info;
  } finally { z.close(); }
}

const BUNDLE_EXT = ['.apkm', '.xapk', '.apks', '.zip'];
const isAppFile = (f) => /\.(apk|apkm|xapk|apks)$/i.test(f);

// Looks inside a downloaded file and returns what installing it involves.
function inspect(file) {
  const ext = path.extname(file).toLowerCase();
  const base = { file, name: path.basename(file), size: fs.statSync(file).size, kind: ext === '.apk' ? 'apk' : 'bundle' };
  if (ext === '.apk') {
    try { return { ...base, ...apkInfo(file) }; } catch { return { ...base, broken: true }; }
  }
  if (!BUNDLE_EXT.includes(ext)) return { ...base, kind: 'other' };
  const z = openZip(file);
  try {
    if (z.entries.some((e) => e.encrypted)) return { ...base, encrypted: true };
    const apks = z.entries.filter((e) => /\.apk$/i.test(e.name) && !e.name.includes('/'));
    const nested = z.entries.filter((e) => /\.apk$/i.test(e.name) && e.name.includes('/')); // apks from bundletool: splits/base-master.apk
    const list = apks.length ? apks : nested;
    const obb = z.entries.filter((e) => /\.obb$/i.test(e.name));
    let meta = {};
    const mf = z.entries.find((e) => e.name === 'manifest.json' || e.name === 'info.json');
    if (mf) { try { const j = JSON.parse(z.read(mf).toString('utf8')); meta = { package: j.package_name || j.pname || null, label: j.name || j.app_name || null, versionName: j.version_name || j.release_version || null }; } catch {} }
    const baseEntry = list.find((e) => /(^|\/)base(-master)?\.apk$/i.test(e.name)) || list.find((e) => !/split|config\./i.test(e.name)) || list[0];
    if (baseEntry && !meta.package) {
      try { const m = readManifest(readEntryManifest(z, baseEntry)); meta = { package: m.package, versionName: m.versionName, label: m.label, minSdk: m.minSdk }; } catch {}
    }
    return { ...base, ...meta, splits: list.map((e) => e.name), obb: obb.map((e) => e.name), empty: !list.length };
  } finally { z.close(); }
}

// Reads AndroidManifest.xml from an APK stored inside a bundle (APK inside zip).
function readEntryManifest(z, entry) {
  const tmp = path.join(require('os').tmpdir(), `droid-m-${process.pid}-${Date.now()}.apk`);
  fs.writeFileSync(tmp, z.read(entry));
  try { const inner = openZip(tmp); try { const m = inner.entries.find((e) => e.name === 'AndroidManifest.xml'); return inner.read(m); } finally { inner.close(); } }
  finally { fs.rmSync(tmp, { force: true }); }
}

// Unpacks the APKs (and OBB files) from a bundle so adb can install them. Returns { apks, obb }.
async function unpackBundle(file, dir, { abi } = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const z = openZip(file);
  try {
    if (z.entries.some((e) => e.encrypted)) throw new Error('This bundle is password-protected (older APKMirror files). Download it again from APKMirror, or pick the plain APK.');
    let list = z.entries.filter((e) => /\.apk$/i.test(e.name));
    // drop splits for other processors so the install isn't refused
    const otherAbi = /(armeabi_v7a|armeabi-v7a|arm64_v8a|arm64-v8a|x86_64|x86)(\.apk)?$/i;
    if (abi) {
      const want = abi.replace('-', '_');
      list = list.filter((e) => { const m = e.name.match(/config\.([a-z0-9_]+)\.apk$/i) || e.name.match(/split_config\.([a-z0-9_]+)\.apk$/i); if (!m || !otherAbi.test(m[1] + '.apk')) return true; return m[1].replace('-', '_') === want; });
    }
    const apks = [];
    for (const e of list) { const out = path.join(dir, path.basename(e.name)); await z.extract(e, out); apks.push(out); }
    const obb = [];
    for (const e of z.entries.filter((x) => /\.obb$/i.test(x.name))) { const out = path.join(dir, 'obb', path.basename(e.name)); await z.extract(e, out); obb.push({ local: out, remote: '/sdcard/' + e.name.replace(/^.*?Android\//, 'Android/') }); }
    return { apks, obb };
  } finally { z.close(); }
}

module.exports = { openZip, readManifest, apkInfo, inspect, unpackBundle, isAppFile };
