'use strict';
// The hub keeps its own copy of the newest package for every app, so apps can be
// installed or reinstalled later without the original download.
//   <userData>/library/index.json
//   <userData>/library/packages/<id>-<version>-<arch>.zip
//   <userData>/library/icons/<id>.png
const path = require('path');
const fs = require('./fsx');
const fsp = require('./fsx').promises;
const { readJSON, writeJSON, copyWithHash, compareVersions } = require('./sys');
const { readCatalog, compatibility } = require('./catalog');

class Library {
  constructor(dir, host = {}) {
    this.dir = dir;
    this.host = host;
    this.indexFile = path.join(dir, 'index.json');
    this.index = readJSON(this.indexFile, null) || { apps: {}, imports: [] };
  }

  save() { writeJSON(this.indexFile, this.index); }
  list() { return Object.values(this.index.apps); }
  get(id) { return this.index.apps[id] || null; }

  // What importing this folder would bring in, without copying anything.
  preview(root) {
    const { catalog, dir } = readCatalog(root);
    const items = catalog.apps.map((entry) => {
      const have = this.get(entry.id);
      const compat = compatibility(catalog, entry, this.host);
      let action = 'add';
      if (!compat.ok) action = 'incompatible';
      else if (have) {
        const c = compareVersions(entry.version, have.version);
        if (c < 0 && this.hasPackage(entry.id)) action = 'older';
        else if (c === 0) action = this.hasPackage(entry.id) ? 'same' : 'restore'; // same version = same app, even if re-zipped
        else if (c < 0) action = 'restore';
        else action = 'newer';
      }
      return { entry, action, reason: compat.reason, current: have?.version || null };
    });
    return { catalog, dir, items, news: items.filter((i) => ['add', 'newer', 'restore'].includes(i.action)) };
  }

  async importFrom(root, { onProgress } = {}) {
    const { catalog, dir, items } = this.preview(root);
    const wanted = items.filter((i) => ['add', 'newer', 'restore'].includes(i.action));
    const totalBytes = wanted.reduce((s, i) => s + (i.entry.size || 0), 0) || 1;
    let doneBytes = 0;
    const imported = [], skipped = [];
    for (const i of items) if (!wanted.includes(i)) skipped.push({ id: i.entry.id, name: i.entry.name, action: i.action, reason: i.reason });

    for (const { entry } of wanted) {
      const src = path.join(dir, entry.file);
      if (!fs.existsSync(src)) { skipped.push({ id: entry.id, name: entry.name, action: 'missing', reason: `${entry.file} is missing from the packages folder` }); continue; }
      const fileName = `${entry.id}-${entry.version}-${entry.arch || 'any'}.zip`;
      const dst = path.join(this.dir, 'packages', fileName);
      const tmp = `${dst}.partial`;
      const base = doneBytes;
      const hash = await copyWithHash(src, tmp, (n) => onProgress && onProgress({ id: entry.id, name: entry.name, fraction: Math.min(1, (base + n) / totalBytes) }));
      if (entry.sha256 && hash !== entry.sha256) {
        await fsp.rm(tmp, { force: true });
        skipped.push({ id: entry.id, name: entry.name, action: 'damaged', reason: `${entry.file} is damaged (checksum mismatch). Copy the packages over again.` });
        continue;
      }
      await fsp.rename(tmp, dst);
      doneBytes += entry.size || 0;

      let icon = null;
      if (entry.icon && fs.existsSync(path.join(dir, entry.icon))) {
        icon = path.join(this.dir, 'icons', `${entry.id}${path.extname(entry.icon) || '.png'}`);
        await fsp.mkdir(path.dirname(icon), { recursive: true });
        await fsp.copyFile(path.join(dir, entry.icon), icon);
      }

      const old = await this.record(entry, dst, hash, icon, catalog.suiteVersion);
      imported.push({ id: entry.id, name: entry.name, version: entry.version, from: old?.version || null });
      this.save();
    }

    this.index.imports = [{ suiteVersion: catalog.suiteVersion, source: root, at: new Date().toISOString(), count: imported.length }, ...(this.index.imports || [])].slice(0, 20);
    this.save();
    return { catalog, dir, imported, skipped };
  }

  // Store a verified package in the index, replacing (and deleting) an older one.
  async record(entry, dst, hash, icon, suiteVersion) {
    const old = this.get(entry.id);
    if (old?.package && old.package !== dst) await fsp.rm(old.package, { force: true });
    this.index.apps[entry.id] = {
      id: entry.id, name: entry.name, version: entry.version, arch: entry.arch, description: entry.description || '',
      appId: entry.appId || null, bundle: entry.bundle || null, folder: entry.folder || null, exe: entry.exe || null,
      notes: entry.notes || [], sha256: hash, size: entry.size || fs.statSync(dst).size,
      package: dst, icon: icon || old?.icon || null,
      suiteVersion: suiteVersion || null, importedAt: new Date().toISOString(),
    };
    this.save();
    return old;
  }

  // Download one app's package (and icon) from the online feed.
  async importRemote(entry, feed, { onProgress } = {}) {
    const dst = path.join(this.dir, 'packages', `${entry.id}-${entry.version}-${entry.arch || 'any'}.zip`);
    const hash = await feed.download(entry.file, dst, { sha256: entry.sha256, size: entry.size, onProgress });
    let icon = null;
    if (entry.icon) {
      const iconPath = path.join(this.dir, 'icons', `${entry.id}${path.extname(entry.icon) || '.png'}`);
      try { await feed.download(entry.icon, iconPath); icon = iconPath; } catch {} // an icon is nice to have, not required
    }
    const old = await this.record(entry, dst, hash, icon, 'online');
    return { id: entry.id, name: entry.name, version: entry.version, from: old?.version || null };
  }

  async remove(id) {
    const e = this.get(id);
    if (!e) return;
    // keep the name, icon and notes so an installed app still shows properly
    if (e.package) await fsp.rm(e.package, { force: true });
    e.package = null;
    this.save();
  }

  hasPackage(id) {
    const e = this.get(id);
    return !!(e && e.package && fs.existsSync(e.package));
  }

  sizeBytes() {
    return this.list().reduce((s, e) => { try { return e.package ? s + fs.statSync(e.package).size : s; } catch { return s; } }, 0);
  }
}

module.exports = { Library };
