// Droid's own Android SDK: the emulator, platform tools (adb) and system images, installed straight from
// Google's repository into Droid's data folder. Can also point at an existing Android Studio SDK.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const repo = require('./repo');
const { fetchText, download, unzip } = require('./download');

const EXE = process.platform === 'win32' ? '.exe' : '';
const DAY = 24 * 3600 * 1000;

function readProps(file) {
  const out = {};
  try { for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) out[l.slice(0, i).trim()] = l.slice(i + 1).trim(); } } catch {}
  return out;
}

function existingSdks() {
  const c = [];
  if (process.env.ANDROID_HOME) c.push(process.env.ANDROID_HOME);
  if (process.env.ANDROID_SDK_ROOT) c.push(process.env.ANDROID_SDK_ROOT);
  if (process.platform === 'darwin') c.push(path.join(os.homedir(), 'Library', 'Android', 'sdk'));
  if (process.platform === 'win32') c.push(path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Android', 'Sdk'));
  if (process.platform === 'linux') c.push(path.join(os.homedir(), 'Android', 'Sdk'));
  return [...new Set(c)].filter((p) => fs.existsSync(path.join(p, 'emulator', 'emulator' + EXE)));
}

class Sdk {
  constructor({ root, cacheDir, host = repo.hostOf() }) {
    this.root = root;
    this.cacheDir = cacheDir;
    this.host = host;
    this.catalog = null;
    this.jobs = new Map();          // key -> { controller, progress }
  }

  get emulatorBin() { return path.join(this.root, 'emulator', 'emulator' + EXE); }
  get adbBin() { return path.join(this.root, 'platform-tools', 'adb' + EXE); }
  get protoDir() { return path.join(this.root, 'emulator', 'lib'); }
  imageDir(p) { return path.join(this.root, ...p.split(';')); }

  status() {
    const emu = readProps(path.join(this.root, 'emulator', 'source.properties'));
    const pt = readProps(path.join(this.root, 'platform-tools', 'source.properties'));
    return {
      root: this.root,
      emulator: fs.existsSync(this.emulatorBin) ? (emu['Pkg.Revision'] || 'installed') : null,
      platformTools: fs.existsSync(this.adbBin) ? (pt['Pkg.Revision'] || 'installed') : null,
      images: this.installedImages(),
      ready: fs.existsSync(this.emulatorBin) && fs.existsSync(this.adbBin),
    };
  }

  installedImages() {
    const base = path.join(this.root, 'system-images');
    const out = [];
    const ls = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
    for (const plat of ls(base)) for (const tag of ls(path.join(base, plat))) for (const abi of ls(path.join(base, plat, tag))) {
      const dir = path.join(base, plat, tag, abi);
      if (!fs.existsSync(path.join(dir, 'system.img')) && !fs.existsSync(path.join(dir, 'source.properties'))) continue;
      const p = readProps(path.join(dir, 'source.properties'));
      out.push({ path: ['system-images', plat, tag, abi].join(';'), platform: plat, tag, abi, revision: p['Pkg.Revision'] || '', api: p['AndroidVersion.ApiLevel'] || plat.replace('android-', '') });
    }
    return out;
  }
  hasImage(p) { return fs.existsSync(path.join(this.imageDir(p), 'system.img')); }

  // Google's catalog, cached for a day; works offline from the last copy.
  async loadCatalog({ force = false } = {}) {
    if (this.catalog && !force && Date.now() - this.catalog.at < DAY) return this.catalog;
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const get = async (url, name) => {
      const f = path.join(this.cacheDir, name);
      const fresh = fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < DAY;
      if (fresh && !force) return fs.readFileSync(f, 'utf8');
      try { const t = await fetchText(url, { timeout: 20000 }); fs.writeFileSync(f, t); return t; }
      catch (e) { if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8'); throw e; }
    };
    const repoXml = await get(repo.REPO_URL, 'repository2-3.xml');
    const imgs = {};
    await Promise.all(repo.IMG_TAGS.map(async (t) => { try { imgs[t] = await get(repo.imgUrl(t), `sys-img-${t}.xml`); } catch {} }));
    const licenses = { ...repo.parseLicenses(repoXml) };
    for (const x of Object.values(imgs)) Object.assign(licenses, repo.parseLicenses(x));
    this.catalog = {
      at: Date.now(),
      emulator: repo.latestTool(repoXml, 'emulator', this.host),
      platformTools: repo.latestTool(repoXml, 'platform-tools', this.host),
      images: repo.systemImages(imgs, this.host),
      allImages: repo.systemImages(imgs, this.host, { stable: false }),
      licenses,
    };
    return this.catalog;
  }

  // What still has to be downloaded before a device with this image can start.
  async plan(imagePath) {
    const cat = await this.loadCatalog();
    const st = this.status();
    const need = [];
    if (!st.emulator && cat.emulator) need.push({ kind: 'emulator', ...cat.emulator, label: 'Android Emulator' });
    if (!st.platformTools && cat.platformTools) need.push({ kind: 'platform-tools', ...cat.platformTools, label: 'Platform tools (adb)' });
    if (imagePath && !this.hasImage(imagePath)) {
      const img = cat.allImages.find((i) => i.path === imagePath);
      if (img) need.push({ kind: 'image', ...img, label: `${img.name} · ${img.tagName}` });
      else need.push({ kind: 'missing', path: imagePath, label: 'System image no longer offered by Google' });
    }
    return need;
  }

  // Installs one component. onProgress({ key, label, got, total, rate, phase }).
  async install(item, onProgress = () => {}) {
    const key = item.kind === 'image' ? item.path : item.kind;
    if (this.jobs.has(key)) return this.jobs.get(key).promise;
    const controller = new AbortController();
    const job = { controller, label: item.label };
    const promise = (async () => {
      const dlDir = path.join(this.cacheDir, 'downloads');
      const zip = path.join(dlDir, path.basename(new URL(item.url).pathname));
      const report = (p) => onProgress({ key, label: item.label, size: item.size, ...p });
      report({ phase: 'download', got: 0, total: item.size });
      await download(item.url, zip, { sha1: item.sha1, size: item.size, signal: controller.signal, onProgress: (p) => report({ phase: p.verifying ? 'verify' : 'download', ...p }) });
      report({ phase: 'unpack' });
      const target = item.kind === 'image' ? this.imageDir(item.path) : path.join(this.root, item.kind);
      const tmp = path.join(this.root, `.unpack-${Date.now()}`);
      fs.rmSync(tmp, { recursive: true, force: true });
      try {
        await unzip(zip, tmp);
        const tops = fs.readdirSync(tmp).filter((n) => !n.startsWith('.') && n !== '__MACOSX');
        const src = tops.length === 1 && fs.statSync(path.join(tmp, tops[0])).isDirectory() ? path.join(tmp, tops[0]) : tmp;
        fs.rmSync(target, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(src, target);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      fs.rmSync(zip, { force: true });
      report({ phase: 'done' });
      return target;
    })().finally(() => this.jobs.delete(key));
    job.promise = promise;
    this.jobs.set(key, job);
    return promise;
  }

  cancel(key) { const j = this.jobs.get(key); if (j) j.controller.abort(); }
  running() { return [...this.jobs.entries()].map(([key, j]) => ({ key, label: j.label })); }

  removeImage(p) {
    const dir = this.imageDir(p);
    if (!dir.startsWith(path.join(this.root, 'system-images'))) throw new Error('Not a system image');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { Sdk, existingSdks, readProps, EXE };
