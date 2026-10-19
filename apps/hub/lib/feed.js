'use strict';
// Online updates: the catalogs and packages that `./utility publish` posts to the GitHub
// release (or any web folder). Utility Hub reads catalog-<os>.json from there and
// downloads only the apps that changed.
const path = require('path');
const fs = require('./fsx');
const crypto = require('crypto');
const { readJSON } = require('./sys');
const { platformKey, compatibility, FORMAT } = require('./catalog');

class Feed {
  // ctx: { platform, arch, fetch, configFile, settings: () => settings }
  constructor(ctx) {
    this.ctx = ctx;
    this.catalog = null;
    this.lastChecked = null;
    this.error = null;
  }

  // settings.feedUrl overrides; otherwise feed.json shipped inside the hub: { repo, release } or { base }
  get config() {
    const custom = (this.ctx.settings().feedUrl || '').trim();
    if (custom) return { base: custom.replace(/\/+$/, ''), label: custom };
    // fileConfig is read by main with Electron's own fs, because feed.json sits inside app.asar
    const f = this.ctx.fileConfig !== undefined ? this.ctx.fileConfig : readJSON(this.ctx.configFile, null);
    if (f?.base) return { base: String(f.base).replace(/\/+$/, ''), label: f.base };
    if (f?.repo) return { base: `https://github.com/${f.repo}/releases/download/${f.release || 'packages'}`, label: `github.com/${f.repo}`, repo: f.repo };
    return null;
  }
  get enabled() { return !!this.config && this.ctx.settings().onlineUpdates !== false; }
  url(file) { return `${this.config.base}/${encodeURIComponent(file)}`; }

  async check() {
    if (!this.enabled) { this.catalog = null; return null; }
    try {
      const res = await this.ctx.fetch(`${this.config.base}/catalog-${platformKey(this.ctx.platform)}.json?t=${Date.now()}`, { cache: 'no-store' });
      if (res.status === 404) this.catalog = { apps: [] }; // nothing published for this OS yet
      else if (!res.ok) throw new Error(`the update server answered ${res.status}`);
      else {
        const cat = await res.json();
        if (!cat || !Array.isArray(cat.apps)) throw new Error('the update catalog is unreadable');
        if (cat.format > FORMAT) throw new Error('these updates need a newer Utility Hub');
        this.catalog = cat;
      }
      this.error = null;
    } catch (e) {
      this.error = /fetch failed|ENOTFOUND|ERR_INTERNET|ERR_NAME|ECONNREFUSED|network/i.test(String(e.message || e)) ? 'offline' : String(e.message || e);
    } finally {
      this.lastChecked = new Date().toISOString();
    }
    return this.catalog;
  }

  // apps this computer can run, by id
  entries() {
    const out = new Map();
    if (!this.catalog) return out;
    const cat = { ...this.catalog, platform: this.catalog.platform || platformKey(this.ctx.platform) };
    for (const e of this.catalog.apps) {
      if (!compatibility(cat, e, { platform: this.ctx.platform, arch: this.ctx.arch }).ok) continue;
      out.set(e.id, { ...e, iconUrl: e.icon ? this.url(e.icon) : null });
    }
    return out;
  }

  hub() { return this.catalog?.hub?.file ? { ...this.catalog.hub } : null; }

  // Download one published file to dest, verifying its checksum. onProgress(fraction)
  async download(file, dest, { sha256, size, onProgress } = {}) {
    const res = await this.ctx.fetch(this.url(file));
    if (!res.ok || !res.body) throw new Error(`Couldn't download ${file} (${res.status}). Check your connection and try again.`);
    const total = size || +res.headers.get('content-length') || 0;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.partial`;
    const out = fs.createWriteStream(tmp);
    const hash = crypto.createHash('sha256');
    let n = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value);
        hash.update(buf);
        n += buf.length;
        if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
        if (onProgress && total) onProgress(Math.min(1, n / total));
      }
      await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    } catch (e) {
      out.destroy();
      fs.rmSync(tmp, { force: true });
      throw new Error(`The download of ${file} was interrupted. Try again.`);
    }
    const got = hash.digest('hex');
    if (sha256 && got !== sha256) { fs.rmSync(tmp, { force: true }); throw new Error(`${file} arrived damaged (checksum mismatch). Try again.`); }
    fs.renameSync(tmp, dest);
    return got;
  }
}

module.exports = { Feed };
