// Glean — the browser side: one signed-in session, and the collector that watches what the page loads.
//
// How collecting works:
//  1. Network: Chrome's DevTools protocol (webContents.debugger) shows every response the page receives.
//     JSON from the site's own API (Instagram feed, Patreon posts, Facebook GraphQL, X timelines) is read and
//     turned into posts with their full-size photos and videos. Images and videos the page downloads are noted too.
//  2. Page scan: an isolated-world script lists images (largest srcset), videos, backgrounds, direct links
//     and inline JSON the page shipped with.
//  3. Auto-scroll keeps feeds loading; batch visits a list of links; sync re-checks an account for new posts.
const path = require('path');
const { session, webContents, Menu, clipboard, shell, ipcMain } = require('electron');
const { identityFor, rewriteHeaders, navigatorPatch } = require('./identity');
const X = require('../collect/extract');
const { SCAN, SCROLL, RESET } = require('../collect/dom-scan');

const PARTITION = 'persist:glean';
const PRELOAD = path.join(__dirname, 'webview-preload.js');
const WORLD = 1077;
const AUTH_HOSTS = ['accounts.google.com', 'appleid.apple.com', 'login.live.com', 'login.microsoftonline.com', 'discord.com', 'www.facebook.com', 'm.facebook.com', 'github.com'];
const SPEEDS = { gentle: 1900, normal: 1150, fast: 650 };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const JSONISH = /json|javascript|text\/plain|text\/html/;
const API_HINT = /graphql|\/api\/|\/v1\/|ajax|query|feed|timeline|posts|media/i;

class Capture {
  constructor({ collection, settings, send, library }) {
    this.col = collection; this.settings = settings; this.send = send; this.library = library;
    this.wc = null; this.reqs = new Map();
    this.scanTimer = null; this.scrolling = null; this.batch = null;
    this.ses = null;
    this.stats = { api: 0, net: 0 };
  }

  configure() {
    if (this.ses) return this.ses;
    const ses = this.ses = session.fromPartition(PARTITION);
    ses.setUserAgent(identityFor('https://www.example.com/').ua);
    ses.webRequest.onBeforeSendHeaders((d, cb) => {
      let pageUrl = d.url;
      if (d.resourceType !== 'mainFrame') { try { pageUrl = (d.frame && d.frame.top && d.frame.top.url) || d.referrer || d.url; } catch { pageUrl = d.referrer || d.url; } }
      const headers = rewriteHeaders(d.requestHeaders, identityFor(pageUrl));
      // Glean's own downloads ask for a Referer this way; Chromium refuses one set directly on fetch().
      const ref = headers['X-Glean-Referer'] || headers['x-glean-referer'];
      if (ref) { delete headers['X-Glean-Referer']; delete headers['x-glean-referer']; headers.Referer = ref; }
      cb({ requestHeaders: headers });
    });
    ses.setPermissionRequestHandler((_wc, perm, cb) => cb(['clipboard-sanitized-write', 'fullscreen', 'notifications'].includes(perm)));
    ses.on('will-download', (_e, item) => {
      // Something the page itself downloads (a "Download" button on Patreon, say) goes into Glean's folder.
      const dir = path.join(this.settings().folder, 'Downloads');
      item.setSavePath(path.join(dir, item.getFilename()));
      item.once('done', (_ev, state) => this.send('notice', { text: state === 'completed' ? `Saved ${item.getFilename()} to Glean/Downloads` : `Download of ${item.getFilename()} ${state}`, path: item.getSavePath() }));
    });
    ipcMain.on('glean:navigator-patch', (event, url) => { try { event.returnValue = navigatorPatch(identityFor(url)); } catch { event.returnValue = null; } });
    return ses;
  }
  // Fetch through the signed-in session, as the page would.
  fetch(url, { referer } = {}) {
    const headers = {};
    if (referer && /^https?:/.test(referer)) headers['X-Glean-Referer'] = referer;
    return this.configure().fetch(url, { headers, credentials: 'include', cache: 'default' });
  }
  pageUrl() { try { return this.wc && !this.wc.isDestroyed() ? this.wc.getURL() : ''; } catch { return ''; } }
  pageTitle() { try { return this.wc && !this.wc.isDestroyed() ? this.wc.getTitle() : ''; } catch { return ''; } }

  // Any web contents created in the app: popups and the webview get the same identity and handlers.
  onWebContents(contents) {
    if (contents.getType() !== 'webview' && contents.session !== this.configure()) return;
    contents.on('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument) { const ua = identityFor(e.url).ua; if (contents.getUserAgent() !== ua) contents.setUserAgent(ua); } });
    if (contents.getType() !== 'webview') return;
    contents.setWindowOpenHandler(({ url }) => {
      let h = ''; try { h = new URL(url).hostname; } catch {}
      if (url === 'about:blank' || (AUTH_HOSTS.includes(h) && /login|oauth|dialog|auth|signin/i.test(url))) {
        return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, webPreferences: { session: contents.session, preload: PRELOAD, sandbox: true } } };
      }
      if (/^https?:/.test(url)) contents.loadURL(url); else shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });
    contents.on('context-menu', (_e, p) => this.contextMenu(contents, p));
  }

  contextMenu(contents, p) {
    const items = [];
    if (p.mediaType === 'image' && p.srcURL && /^https?:/.test(p.srcURL)) {
      items.push({ label: 'Add Image to Tray', click: () => this.addLoose([{ url: p.srcURL, kind: 'image' }]) },
        { label: 'Copy Image Address', click: () => clipboard.writeText(p.srcURL) }, { type: 'separator' });
    }
    if (p.mediaType === 'video' && p.srcURL && /^https?:/.test(p.srcURL)) items.push({ label: 'Add Video to Tray', click: () => this.addLoose([{ url: p.srcURL, kind: 'video' }]) }, { type: 'separator' });
    if (p.linkURL && /^https?:/.test(p.linkURL)) {
      if (X.kindOf(p.linkURL)) items.push({ label: 'Add Linked File to Tray', click: () => this.addLoose([{ url: p.linkURL }]) });
      items.push({ label: 'Add Link to Batch', click: () => this.send('batch:add', { url: p.linkURL }) },
        { label: 'Open Link in Default Browser', click: () => shell.openExternal(p.linkURL) },
        { label: 'Copy Link', click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' });
    }
    const nav = contents.navigationHistory;
    items.push({ role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' },
      { label: 'Back', enabled: !!(nav && nav.canGoBack()), click: () => nav.goBack() },
      { label: 'Reload', click: () => contents.reload() },
      { label: 'Inspect', click: () => contents.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup();
  }
  addLoose(list) {
    const page = this.pageUrl();
    const ms = list.map(o => X.harvestNet({ url: o.url, mime: o.kind === 'video' ? 'video/mp4' : (X.kindOf(o.url) ? null : 'image/jpeg') }, page, this.pageTitle())).filter(Boolean).map(m => ({ ...m, source: 'link' }));
    const was = this.col.active; this.col.active = true; this.col.offer(ms); this.col.active = was;
    this.send('notice', { text: ms.length === 1 ? 'Added to the tray' : `Added ${ms.length} to the tray` });
  }

  // ---------------------------------------------------------------- the page being watched
  attach(id) {
    const wc = webContents.fromId(id);
    if (!wc || wc === this.wc) return !!wc;
    this.detach();
    this.wc = wc;
    const dbg = wc.debugger;
    try { if (!dbg.isAttached()) dbg.attach('1.3'); } catch (e) { this.send('notice', { text: 'Glean could not watch this page’s network (is DevTools open?). Page scans still work.' }); }
    const enable = () => dbg.sendCommand('Network.enable', { maxResourceBufferSize: 64 * 1024 * 1024, maxTotalBufferSize: 256 * 1024 * 1024 }).catch(() => {});
    enable();
    this._onMsg = (_e, method, params) => this.onCdp(method, params);
    dbg.on('message', this._onMsg);
    dbg.on('detach', () => { setTimeout(() => { try { if (this.wc === wc && !wc.isDestroyed() && !dbg.isAttached()) { dbg.attach('1.3'); enable(); } } catch (_) {} }, 800); });
    wc.on('did-navigate', () => { if (!this.col.active) this.col.newPage(); this.reqs.clear(); });
    wc.on('did-finish-load', () => { if (this.col.active) setTimeout(() => this.scan(), 900); });
    wc.on('destroyed', () => { if (this.wc === wc) this.wc = null; });
    return true;
  }
  detach() {
    if (this.wc && !this.wc.isDestroyed()) { try { this.wc.debugger.removeListener('message', this._onMsg); } catch (_) {} }
    this.wc = null;
  }

  onCdp(method, p) {
    if (method === 'Network.responseReceived') {
      const r = p.response;
      if (this.reqs.size > 3000) this.reqs.clear();
      this.reqs.set(p.requestId, { url: r.url, mime: (r.mimeType || '').toLowerCase(), type: p.type, status: r.status });
    } else if (method === 'Network.loadingFinished') {
      const info = this.reqs.get(p.requestId); this.reqs.delete(p.requestId);
      if (!info || info.status >= 400) return;
      const page = this.pageUrl();
      if (info.type === 'Image' || info.type === 'Media' || /^image\/|^video\//.test(info.mime)) {
        if (/^image\/svg|x-icon/.test(info.mime)) return;
        const m = X.harvestNet({ url: info.url, mime: info.mime, bytes: p.encodedDataLength }, page, this.pageTitle());
        if (m) { this.stats.net++; this.col.offer([m]); }
        return;
      }
      if ((info.type === 'XHR' || info.type === 'Fetch') && JSONISH.test(info.mime) && (API_HINT.test(info.url) || /json/.test(info.mime)) && p.encodedDataLength < 30 * 1024 * 1024) {
        const wc = this.wc; if (!wc || wc.isDestroyed()) return;
        wc.debugger.sendCommand('Network.getResponseBody', { requestId: p.requestId }).then(({ body, base64Encoded }) => {
          const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
          const found = X.harvestText(text, info.url, this.pageUrl());
          if (found.length) { this.stats.api += found.length; this.col.offer(found); }
        }).catch(() => {});
      }
    } else if (method === 'Network.loadingFailed') this.reqs.delete(p.requestId);
  }

  async run(code) {
    const wc = this.wc; if (!wc || wc.isDestroyed()) throw new Error('No page open');
    return wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }]);
  }
  async scan() {
    try {
      const r = await this.run(SCAN);
      if (!r) return 0;
      const page = r.url || this.pageUrl();
      const found = X.harvestDom(r, page);
      for (const j of r.json || []) found.push(...X.harvestText(j, page, page));
      this.col.offer(found);
      return found.length;
    } catch (_) { return 0; }
  }

  // ---------------------------------------------------------------- collecting
  start() {
    this.col.start(this.pageUrl());
    this.run(RESET).catch(() => {}).then(() => this.scan());
    clearInterval(this.scanTimer);
    this.scanTimer = setInterval(() => this.scan(), 2500);
    this.state();
  }
  stop() { this.col.stop(); clearInterval(this.scanTimer); this.scanTimer = null; this.stopScroll(); this.state(); }
  state() { this.send('state', { collecting: this.col.active, scrolling: this.scrolling ? { ...this.scrolling.info } : null, batch: this.batch ? { ...this.batch.info } : null }); }

  // Scroll until the feed stops growing, `max` items are found, or (sync) a run of already-saved posts shows up.
  async autoScroll({ max = 0, untilKnown = null } = {}) {
    if (this.scrolling) return;
    if (!this.col.active) this.start();
    const me = this.scrolling = { stop: false, info: { rounds: 0, found: this.col.items.size, reason: null } };
    const known = untilKnown || null;
    let stagnant = 0, lastHeight = 0, lastCount = this.col.items.size, lastSeq = this.col.order, knownRun = 0;
    this.state();
    while (!me.stop) {
      let r = null;
      try { r = await this.run(SCROLL); } catch { me.info.reason = 'page closed'; break; }
      const speed = SPEEDS[this.settings().scrollSpeed] || SPEEDS.normal;
      await sleep(speed + Math.random() * speed * 0.4);
      await this.scan();
      me.info.rounds++;
      const items = this.col.list();
      const count = items.length;
      if (known) {
        const fresh = items.filter(m => m.seq > lastSeq);
        // items added this round that you already have
        const newPosts = new Set(fresh.filter(m => m.postId && !known.has(m.key)).map(m => m.postId));
        const oldPosts = new Set(fresh.filter(m => m.postId && known.has(m.key)).map(m => m.postId));
        if (fresh.length && !newPosts.size && oldPosts.size) knownRun += oldPosts.size; else if (newPosts.size) knownRun = 0;
        if (knownRun >= 6) { me.info.reason = 'caught up'; break; }
      }
      const grew = r && r.height > lastHeight + 4;
      if (count === lastCount && !grew && r && r.atBottom) stagnant++; else if (count !== lastCount || grew) stagnant = 0;
      if (r && !r.atBottom && count === lastCount && !grew) stagnant += 0.34;
      lastHeight = r ? r.height : lastHeight; lastCount = count; lastSeq = this.col.order;
      me.info.found = count;
      this.state();
      if (stagnant >= 5) { me.info.reason = 'end of page'; break; }
      if (max && count >= max) { me.info.reason = 'limit'; break; }
    }
    if (me.stop && !me.info.reason) me.info.reason = 'stopped';
    const info = me.info;
    if (this.scrolling === me) this.scrolling = null;
    this.state();
    this.send('scroll:done', info);
    return info;
  }
  stopScroll() { if (this.scrolling) this.scrolling.stop = true; }

  async load(url) {
    const wc = this.wc; if (!wc || wc.isDestroyed()) throw new Error('No page open');
    const done = new Promise(res => { const f = () => { wc.removeListener('did-stop-loading', f); res(); }; wc.on('did-stop-loading', f); setTimeout(f, 25000); });
    wc.loadURL(url).catch(() => {});
    await done;
    await sleep(1600);
  }

  // Visit each link in turn and collect from it. Direct file links go straight into the tray.
  async runBatch({ urls, scroll = false, max = 0 }) {
    if (this.batch) return;
    const list = [...new Set((urls || []).map(s => String(s).trim()).filter(u => /^https?:\/\//.test(u)))];
    const me = this.batch = { stop: false, info: { total: list.length, index: 0, url: null, rows: list.map(u => ({ url: u, state: 'waiting', found: 0 })) } };
    this.state();
    const files = list.filter(u => X.kindOf(u));
    if (files.length) { this.addLoose(files.map(url => ({ url }))); for (const r of me.info.rows) if (files.includes(r.url)) { r.state = 'done'; r.found = 1; } }
    for (let i = 0; i < list.length && !me.stop; i++) {
      const row = me.info.rows[i]; if (row.state === 'done') continue;
      me.info.index = i; me.info.url = row.url; row.state = 'loading'; this.state();
      const before = this.col.items.size;
      try {
        await this.load(row.url);
        if (me.stop) break;
        if (!this.col.active) this.start(); else { this.col.start(this.pageUrl()); }
        await this.scan();
        if (scroll) { row.state = 'scrolling'; this.state(); await this.autoScroll({ max: max ? before + max : 0 }); }
        else { await sleep(1200); await this.scan(); }
        row.state = 'done';
      } catch (e) { row.state = 'failed'; row.error = String(e.message || e); }
      row.found = this.col.items.size - before;
      this.state();
    }
    if (me.stop) for (const r of me.info.rows) if (r.state === 'waiting' || r.state === 'loading' || r.state === 'scrolling') r.state = r.state === 'waiting' ? 'skipped' : 'stopped';
    me.info.finished = true;
    this.state();
    this.send('batch:done', me.info);
    this.batch = null;
    this.state();
  }
  stopBatch() { if (this.batch) { this.batch.stop = true; this.stopScroll(); } }
}

module.exports = { Capture, PARTITION, PRELOAD };
