// Glean — the download queue. Fetches through the browser's signed-in session (same cookies the page used),
// writes to a .part file then renames, skips what's already saved, backs off when a site says "slow down".
const fs = require('fs');
const path = require('path');
const { placeFor, uniqueName, ymd } = require('./naming');
const { extFor, siteOf, accountFromUrl, pageAccountOf } = require('../collect/extract');

const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class Downloader {
  // deps: { fetch(url, {referer}) -> Response, library, settings(), convert(file) -> newFile|null, onEvent(ev) }
  constructor(deps) {
    this.d = deps;
    this.queue = [];
    this.running = 0;
    this.paused = false;
    this.cancelled = false;
    this.job = null;
    this.waitUntil = 0;
  }
  status() { return this.job ? { ...this.job, queued: this.queue.length, running: this.running, paused: this.paused } : null; }
  emit(ev) { try { this.d.onEvent(ev); } catch (_) {} }

  // items: media from the tray; ctx: { pageUrl, pageTitle, sourceUrl }
  enqueue(items, ctx = {}) {
    const s = this.d.settings();
    const opts = { layout: s.layout, fileNames: s.fileNames };
    const pageHost = (() => { try { return new URL(ctx.pageUrl).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    const pageAccount = accountFromUrl(ctx.pageUrl || '');
    const isSocial = ['instagram', 'facebook', 'patreon', 'x', 'pinterest', 'threads', 'tiktok'].includes(siteOf(ctx.pageUrl || ''));
    const cx = { account: pageAccount, pageTitle: isSocial ? null : ctx.pageTitle, pageHost };
    if (!this.job || (!this.running && !this.queue.length)) this.job = { total: 0, done: 0, skipped: 0, failed: 0, bytes: 0, folders: [], startedAt: Date.now() };
    const taken = new Map(); // dir -> Set of names used in this batch
    for (const m of items) {
      const p = placeFor(m, opts, cx);
      const haulDir = path.join(s.folder, ...p.root);
      const dir = p.sub ? path.join(haulDir, p.sub) : haulDir;
      if (!this.job.folders.includes(haulDir)) this.job.folders.push(haulDir);
      const lib = this.d.library;
      const pa = ctx.pageUrl ? pageAccountOf(ctx.pageUrl, ctx.pageTitle).account : null;
      const sourceUrl = pa && String(m.account || '').toLowerCase() === String(pa).toLowerCase() ? (ctx.sourceUrl || ctx.pageUrl) : null;
      lib.ensure(haulDir, { site: m.site, account: m.account || p.root[p.root.length - 1], accountName: m.accountName || null, title: m.accountName || m.account || p.root[p.root.length - 1], ...(sourceUrl ? { sourceUrl } : {}) });
      if (lib.has(haulDir, m.key)) { this.job.total++; this.job.skipped++; this.emit({ type: 'item', key: m.key, state: 'saved', file: path.join(haulDir, lib.manifest(haulDir).items[m.key].file) }); continue; }
      if (!taken.has(dir)) {
        let names = []; try { names = fs.readdirSync(dir); } catch {}
        taken.set(dir, new Set(names.map(n => n.toLowerCase())));
      }
      this.queue.push({ m, dir, haulDir, base: p.base, ext: p.ext, taken: taken.get(dir), referer: m.postUrl || ctx.pageUrl || '', tries: 0 });
      this.job.total++;
      this.emit({ type: 'item', key: m.key, state: 'queued' });
    }
    this.d.library.flush();
    this.emit({ type: 'job', job: this.status() });
    if (!this.queue.length && !this.running) this.finish(); else this.pump();
    return this.status();
  }

  pump() {
    const s = this.d.settings();
    const max = Math.max(1, Math.min(8, Number(s.concurrency) || 3));
    while (!this.paused && this.running < max && this.queue.length) {
      const t = this.queue.shift();
      this.running++;
      this.one(t).finally(() => {
        this.running--;
        if (!this.queue.length && !this.running) this.finish();
        else this.pump();
      });
    }
  }
  finish() {
    this.d.library.flush();
    const job = this.status();
    if (job) job.finishedAt = Date.now();
    this.emit({ type: 'done', job });
  }
  pause(on) { this.paused = !!on; if (!on) this.pump(); this.emit({ type: 'job', job: this.status() }); }
  cancel() {
    const dropped = this.queue.splice(0);
    for (const t of dropped) this.emit({ type: 'item', key: t.m.key, state: 'cancelled' });
    if (this.job) this.job.total -= dropped.length;
    if (!this.running) this.finish();
  }

  // A video's cover picture, kept out of the way in .glean/posters so the library can show it.
  async poster(m, t) {
    const res = await this.d.fetch(m.thumb, { referer: t.referer });
    if (!res.ok || !/^image\//.test(res.headers.get('content-type') || '')) return null;
    const dir = path.join(t.haulDir, '.glean', 'posters'); fs.mkdirSync(dir, { recursive: true });
    const name = m.key.replace(/[^\w.-]+/g, '_').slice(-80) + '.jpg';
    fs.writeFileSync(path.join(dir, name), Buffer.from(await res.arrayBuffer()));
    return '.glean/posters/' + name;
  }

  async one(t) {
    const { m } = t;
    this.emit({ type: 'item', key: m.key, state: 'downloading' });
    for (;;) {
      if (Date.now() < this.waitUntil) await sleep(this.waitUntil - Date.now());
      try {
        const res = await this.d.fetch(m.url, { referer: t.referer });
        if (res.status === 429 || res.status === 503) {
          const ra = Number(res.headers.get('retry-after')) || 60;
          this.waitUntil = Date.now() + Math.min(300, ra) * 1000;
          this.emit({ type: 'notice', text: `The site asked Glean to slow down. Waiting ${Math.min(300, ra)} seconds…` });
          if (++t.tries > 4) throw new Error('The site kept saying "too many requests"');
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const mime = res.headers.get('content-type') || '';
        if (/text\/html/.test(mime)) throw new Error('The site sent a web page instead of the file (sign in, or the link expired)');
        const ext = extFor(m.url, m.kind, mime) || t.ext;
        fs.mkdirSync(t.dir, { recursive: true });
        const name = uniqueName(t.base, ext, t.taken);
        const file = path.join(t.dir, name);
        const part = file + '.part';
        if (res.body && Readable.fromWeb) await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part));
        else fs.writeFileSync(part, Buffer.from(await res.arrayBuffer()));
        const size = fs.statSync(part).size;
        if (!size) { fs.rmSync(part, { force: true }); throw new Error('Empty file'); }
        fs.renameSync(part, file);
        let finalFile = file;
        const s = this.d.settings();
        if (s.convertWebp && /^(webp|avif)$/.test(ext) && this.d.convert) {
          try { const out = await this.d.convert(file); if (out) { finalFile = out; t.taken.add(path.basename(out).toLowerCase()); } } catch (_) {}
        }
        if (m.date) { try { const d = new Date(m.date); fs.utimesSync(finalFile, d, d); } catch (_) {} }
        if (s.captionFiles && m.caption && m.postId) {
          const cap = path.join(t.dir, (t.base.replace(/\s*\d{2}$/, '') || m.postId) + '.txt');
          if (!fs.existsSync(cap)) { try { fs.writeFileSync(cap, [m.caption, '', m.postUrl || '', ymd(m.date)].join('\n').trim() + '\n'); } catch (_) {} }
        }
        let poster = null;
        if (m.kind === 'video' && m.thumb) poster = await this.poster(m, t).catch(() => null);
        this.d.library.record(t.haulDir, m.key, {
          ...(poster ? { poster } : {}),
          file: path.relative(t.haulDir, finalFile).split(path.sep).join('/'), url: m.url, kind: m.kind, width: m.width || 0, height: m.height || 0,
          postId: m.postId || null, postUrl: m.postUrl || null, postIndex: m.postIndex || 0, caption: m.caption || '', date: m.date || 0, account: m.account || null, site: m.site
        });
        this.job.done++; this.job.bytes += size;
        this.emit({ type: 'item', key: m.key, state: 'done', file: finalFile });
        if (this.job.done % 25 === 0) this.d.library.flush();
        const gap = Number(this.d.settings().gapMs) || 0; if (gap) await sleep(gap);
        return;
      } catch (e) {
        if (++t.tries <= 2 && !/web page instead/.test(e.message)) { await sleep(1500 * t.tries); continue; }
        this.job.failed++;
        this.emit({ type: 'item', key: m.key, state: 'failed', error: String(e.message || e) });
        return;
      }
    }
  }
}

module.exports = { Downloader };
