'use strict';
// Finding Utility Suite packages that have been brought over to this computer:
//   • an opened suite folder or mounted DMG (…/Packages/catalog.json)
//   • an unopened suite download: Utility-Suite-<version>-mac.dmg / -windows-x64.zip
//   • any folder the user adds in Settings (e.g. a Google Drive / OneDrive / USB folder)
const path = require('path');
const fs = require('./fsx');
const fsp = require('./fsx').promises;
const { run, exists, isDir, compareVersions, extractZip } = require('./sys');
const { findCatalog, readCatalog, hubPath } = require('./catalog');

const ARCHIVE_RE = { darwin: /^Utility-Suite-(.+)-mac\.dmg$/i, win32: /^Utility-Suite-(.+)-windows-[a-z0-9]+\.zip$/i, linux: /^Utility-Suite-(.+)-linux\.zip$/i };

class Sources {
  // ctx: { platform, home, userData, downloads, desktop, hubVersion, settings: () => settings }
  constructor(ctx, library) {
    this.ctx = ctx;
    this.library = library;
    this.mounted = new Map(); // dmg path -> mount point we attached
  }

  roots() {
    const s = this.ctx.settings();
    const list = [];
    if (s.scanDownloads !== false) list.push(this.ctx.downloads, this.ctx.desktop);
    list.push(...(s.watchFolders || []));
    if (this.ctx.bundleRoot) list.push(this.ctx.bundleRoot);
    return [...new Set(list.filter((d) => d && isDir(d)))];
  }

  // Look a couple of levels down for catalogs and suite archives.
  async scan() {
    const found = [];
    const seen = new Set();
    const consider = (p, kind) => { if (!seen.has(p)) { seen.add(p); found.push({ path: p, kind }); } };
    const archiveRe = ARCHIVE_RE[this.ctx.platform];

    const visit = async (dir, depth) => {
      if (findCatalog(dir)) { consider(dir, 'folder'); return; }
      if (depth === 0) return;
      let ents;
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isFile() && archiveRe && archiveRe.test(e.name)) consider(p, this.ctx.platform === 'darwin' ? 'dmg' : 'zip');
        else if (e.isDirectory() && !e.name.endsWith('.app') && e.name !== 'node_modules') await visit(p, depth - 1);
      }
    };
    for (const r of this.roots()) await visit(r, 2);
    if (this.ctx.platform === 'darwin') {
      for (const v of await fsp.readdir('/Volumes').catch(() => [])) {
        const p = path.join('/Volumes', v);
        if (findCatalog(p)) consider(p, 'folder');
      }
    }

    const dismissed = new Set(this.ctx.settings().dismissed || []);
    const out = [];
    for (const f of found) {
      const stamp = sourceStamp(f.path);
      if (dismissed.has(stamp)) continue;
      if (f.kind === 'folder') {
        const info = this.describe(f.path);
        if (info && (info.news.length || info.hubUpdate)) out.push({ ...f, ...info, stamp });
      } else {
        // archive: judge by the version in its name against what we've imported before
        const m = path.basename(f.path).match(archiveRe);
        const version = m ? m[1] : null;
        const imported = (this.library.index.imports || []).map((i) => i.suiteVersion);
        const newest = imported.sort(compareVersions).pop();
        if (version && (!newest || compareVersions(version, newest) > 0)) out.push({ ...f, suiteVersion: version, news: [], stamp, unopened: true });
      }
    }
    return out.sort((a, b) => compareVersions(b.suiteVersion, a.suiteVersion));
  }

  describe(dir) {
    try {
      const p = this.library.preview(dir);
      const hubV = p.catalog.hub?.version;
      const hubSrc = hubPath(p.dir, p.catalog);
      return {
        suiteVersion: p.catalog.suiteVersion, suiteName: p.catalog.suiteName,
        news: p.news.map((i) => ({ id: i.entry.id, name: i.entry.name, version: i.entry.version, current: i.current })),
        apps: p.items.map((i) => ({ id: i.entry.id, name: i.entry.name, version: i.entry.version, description: i.entry.description, action: i.action, reason: i.reason || null, icon: i.entry.icon ? path.join(p.dir, i.entry.icon) : null })),
        hubUpdate: hubV && hubSrc && exists(hubSrc) && compareVersions(hubV, this.ctx.hubVersion) > 0 ? { version: hubV, path: hubSrc } : null,
      };
    } catch { return null; }
  }

  // Turn any source (folder, .dmg, .zip, or a Packages folder) into a folder with a catalog.
  async open(src) {
    const p = typeof src === 'string' ? src : src.path;
    if (isDir(p)) {
      if (findCatalog(p)) return p;
      throw new Error(`No Utility Suite packages in ${p}. Choose the suite folder (the one with a Packages folder inside).`);
    }
    if (/\.dmg$/i.test(p)) {
      if (this.ctx.platform !== 'darwin') throw new Error('That download is for Mac.');
      const r = await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noverify', '-plist', p]);
      const mounts = [...r.stdout.matchAll(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g)].map((m) => m[1]);
      const mp = mounts.find((m) => findCatalog(m));
      if (!mp) { for (const m of mounts) await run('/usr/bin/hdiutil', ['detach', m, '-quiet'], { allowFail: true }); throw new Error('That disk image has no Utility Suite packages.'); }
      this.mounted.set(p, mp);
      return mp;
    }
    if (/\.zip$/i.test(p)) {
      const dest = path.join(this.ctx.userData, 'incoming', path.basename(p, '.zip'));
      await fsp.rm(dest, { recursive: true, force: true });
      await extractZip(p, dest, this.ctx.platform);
      const hit = findCatalog(dest) ? dest : (await fsp.readdir(dest)).map((n) => path.join(dest, n)).find((d) => isDir(d) && findCatalog(d));
      if (!hit) throw new Error('That zip has no Utility Suite packages.');
      return hit;
    }
    throw new Error('Choose a Utility Suite folder, .dmg or .zip.');
  }

  async close(src) {
    const p = typeof src === 'string' ? src : src.path;
    const mp = this.mounted.get(p);
    if (mp) { await run('/usr/bin/hdiutil', ['detach', mp, '-quiet'], { allowFail: true }); this.mounted.delete(p); }
  }

  async closeAll() { for (const p of [...this.mounted.keys()]) await this.close(p); }
}

function sourceStamp(p) {
  try { return `${p}|${Math.round(fs.statSync(p).mtimeMs)}`; } catch { return p; }
}

module.exports = { Sources, sourceStamp, ARCHIVE_RE };
