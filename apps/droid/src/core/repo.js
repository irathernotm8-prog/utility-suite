// Reads Google's Android SDK repository manifests (the same XML Android Studio's SDK Manager reads)
// so Droid can install the emulator, platform tools and system images itself, with no Java tools.
'use strict';
const { androidName, TAGS } = require('./catalog');

const BASE = 'https://dl.google.com/android/repository/';
const REPO_URL = BASE + 'repository2-3.xml';
const IMG_TAGS = ['google_apis_playstore', 'google_apis', 'default'];
const imgUrl = (tag) => `${BASE}sys-img/${tag === 'default' ? 'android' : tag}/sys-img2-3.xml`;
const imgBase = (tag) => `${BASE}sys-img/${tag === 'default' ? 'android' : tag}/`;

function hostOf(platform = process.platform, arch = process.arch) {
  const os = platform === 'darwin' ? 'macosx' : platform === 'win32' ? 'windows' : 'linux';
  const a = arch === 'arm64' ? 'aarch64' : 'x64';
  // Apple Silicon runs arm64 system images natively; Intel/AMD hosts run x86_64 images.
  const abi = arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
  return { os, arch: a, abi };
}

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const one = (b, tag) => { const m = b.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return m ? decode(m[1].trim()) : null; };
const all = (b, tag) => [...b.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => decode(m[1].trim()));

function revisionOf(b) {
  const r = b.match(/<revision>([\s\S]*?)<\/revision>/);
  if (!r) return { major: 0, minor: 0, micro: 0 };
  return { major: +one(r[1], 'major') || 0, minor: +one(r[1], 'minor') || 0, micro: +one(r[1], 'micro') || 0 };
}
const revStr = (r) => [r.major, r.minor, r.micro].join('.').replace(/(\.0)+$/, '') || '0';
const revCmp = (a, b) => a.major - b.major || a.minor - b.minor || a.micro - b.micro;

function parseLicenses(xml) {
  const out = {};
  for (const m of xml.matchAll(/<license id="([^"]+)" type="text">([\s\S]*?)<\/license>/g)) out[m[1]] = decode(m[2]).trim();
  return out;
}

function parseChannels(xml) {
  const out = {};
  for (const m of xml.matchAll(/<channel id="([^"]+)">([^<]*)<\/channel>/g)) out[m[1]] = m[2].trim();
  return out;
}

function parsePackages(xml) {
  const channels = parseChannels(xml);
  const out = [];
  for (const m of xml.matchAll(/<remotePackage path="([^"]+)"(?:\s+obsolete="true")?>([\s\S]*?)<\/remotePackage>/g)) {
    const [, path, b] = m;
    const archives = [];
    for (const a of b.matchAll(/<archive>([\s\S]*?)<\/archive>/g)) {
      const c = a[1].match(/<complete>([\s\S]*?)<\/complete>/);
      if (!c) continue;
      const sum = c[1].match(/<checksum type="sha1">([^<]+)<\/checksum>/);
      archives.push({ url: one(c[1], 'url'), size: +one(c[1], 'size') || 0, sha1: sum ? sum[1].trim() : null, hostOs: one(a[1], 'host-os'), hostArch: one(a[1], 'host-arch') });
    }
    const ch = (b.match(/<channelRef ref="([^"]+)"/) || [])[1] || 'channel-0';
    const td = (b.match(/<type-details[^>]*>([\s\S]*?)<\/type-details>/) || [])[1] || '';
    const tagBlock = (td.match(/<tag>([\s\S]*?)<\/tag>/) || [])[1] || '';
    out.push({
      path, revision: revisionOf(b), displayName: one(b, 'display-name'), channel: channels[ch] || 'stable',
      license: (b.match(/<uses-license ref="([^"]+)"/) || [])[1] || null,
      obsolete: /obsolete="true"/.test(m[0].slice(0, 200)),
      api: one(td, 'api-level'), extension: one(td, 'extension-level'), codename: one(td, 'codename'),
      abi: one(td, 'abi'), tag: one(tagBlock, 'id'), tagDisplay: one(tagBlock, 'display'),
      archives,
    });
  }
  return out;
}

function archiveFor(pkg, host) {
  const fits = pkg.archives.filter((a) => (!a.hostOs || a.hostOs === host.os) && (!a.hostArch || a.hostArch === host.arch));
  // prefer the archive made for this exact host over a generic one
  return fits.find((a) => a.hostOs && a.hostArch) || fits.find((a) => a.hostOs) || fits[0] || null;
}

// Newest stable build of a tool (emulator, platform-tools) that has an archive for this host.
function latestTool(xml, name, host, channel = 'stable') {
  const pk = parsePackages(xml).filter((p) => p.path === name && p.channel === channel && archiveFor(p, host));
  pk.sort((a, b) => revCmp(b.revision, a.revision));
  const p = pk[0];
  if (!p) return null;
  const a = archiveFor(p, host);
  return { path: p.path, version: revStr(p.revision), revision: p.revision, url: BASE + a.url, size: a.size, sha1: a.sha1, license: p.license };
}

// System images this computer can run. `stable` hides previews, canary builds, extension-only and 16 KB page variants.
function systemImages(xmlByTag, host, { stable = true } = {}) {
  const out = [];
  for (const tag of IMG_TAGS) {
    const xml = xmlByTag[tag];
    if (!xml) continue;
    const byPath = new Map();
    for (const p of parsePackages(xml)) {
      if (p.abi !== host.abi || p.obsolete) continue;
      const a = archiveFor(p, host);
      if (!a) continue;
      const prev = byPath.get(p.path);
      if (prev && revCmp(prev.revision, p.revision) >= 0) continue;
      byPath.set(p.path, { ...p, archive: a });
    }
    for (const p of byPath.values()) {
      const plat = p.path.split(';')[1] || '';           // android-36, android-36.1, android-35-ext15, android-CANARY
      const preview = !!p.codename || /CANARY|beta|preview/i.test(plat);
      const variant = /-ext\d+/.test(plat) ? 'ext' : /ps16k/.test(p.path) ? '16k' : null;
      if (stable && (preview || variant || p.channel !== 'stable')) continue;
      const apiNum = parseFloat(String(p.api).replace(/x$/, ''));
      if (!(apiNum >= 24)) continue;                    // Android 7 and newer only
      const tagInfo = TAGS[p.tag] || TAGS[tag] || { name: p.tagDisplay || p.tag, rank: 9 };
      out.push({
        path: p.path, platform: plat, api: String(p.api), apiNum, tag: p.tag || tag, tagName: tagInfo.name, tagRank: tagInfo.rank,
        abi: p.abi, name: androidName(p.api) + (variant === 'ext' ? ` ext ${p.extension}` : '') + (preview ? ' preview' : ''),
        revision: revStr(p.revision), url: imgBase(tag) + p.archive.url, size: p.archive.size, sha1: p.archive.sha1, license: p.license,
        preview, variant,
      });
    }
  }
  out.sort((a, b) => b.apiNum - a.apiNum || a.tagRank - b.tagRank);
  return out;
}

// Pick the image Droid suggests by default: the newest stable Play image at or below a well-tested level.
function recommended(images, ceiling = 36) {
  const play = images.filter((i) => i.tag === 'google_apis_playstore' && !i.preview && !i.variant);
  return play.find((i) => i.apiNum <= ceiling) || play[0] || images[0] || null;
}

module.exports = { BASE, REPO_URL, IMG_TAGS, imgUrl, hostOf, parseLicenses, parsePackages, latestTool, systemImages, recommended, archiveFor, revStr, revCmp };
