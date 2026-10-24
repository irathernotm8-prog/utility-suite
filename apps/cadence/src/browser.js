// Cadence — the Browser step. A real Chromium window (hidden unless you ask) with a saved profile per sign-in,
// driven with trusted mouse and keyboard events. Also: Sign in (a visible window you log in with once) and
// Record (click through a site while Cadence writes the steps).
'use strict';
const fs = require('fs');
const path = require('path');
const { BrowserWindow, session, ipcMain } = require('electron');
const { fromMatrix } = require('./core/table');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const partitionFor = (id) => 'persist:cadence-' + String(id || 'default').replace(/[^a-z0-9_-]/gi, '_');
const UA = () => session.defaultSession.getUserAgent().replace(/\s*(Electron|Cadence)\/\S+/g, '');

// Injected into pages: finds elements by CSS, text=, label=, placeholder=, xpath=.
const HELPER = `(() => { if (window.__cadence) return true;
  const vis = (el) => { if (!el || !el.getBoundingClientRect) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0; };
  const clickable = 'a,button,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],input[type=submit],input[type=button],label,summary,[onclick]';
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  function byText(t) {
    const want = norm(t); const all = [...document.querySelectorAll('body *')].filter((e) => !['SCRIPT','STYLE','NOSCRIPT','HEAD','TITLE'].includes(e.tagName) && vis(e));
    const txt = (e) => norm(e.innerText || e.value || e.getAttribute('aria-label') || e.title || '');
    let hits = all.filter((e) => txt(e) === want); if (!hits.length) hits = all.filter((e) => txt(e).includes(want));
    hits = hits.filter((e) => !hits.some((o) => o !== e && e.contains(o)));
    hits.sort((a, b) => (txt(a) === want ? 0 : 1) - (txt(b) === want ? 0 : 1) || txt(a).length - txt(b).length);
    return hits.map((e) => e.closest(clickable) || e);
  }
  function byLabel(t) {
    const want = norm(t); const out = [];
    for (const l of document.querySelectorAll('label')) if (norm(l.innerText).includes(want)) { const c = l.control || l.querySelector('input,select,textarea'); if (c) out.push(c); }
    for (const e of document.querySelectorAll('input,select,textarea,[contenteditable=true]')) { const a = norm(e.getAttribute('aria-label') || e.getAttribute('name') || ''); if (a && a.includes(want)) out.push(e); const id = e.getAttribute('aria-labelledby'); if (id) { const lb = document.getElementById(id); if (lb && norm(lb.innerText).includes(want)) out.push(e); } }
    return out.filter(vis);
  }
  function find(target, all) {
    const t = String(target || '').trim(); let list = [];
    try {
      if (/^text=/i.test(t)) list = byText(t.slice(5));
      else if (/^label=/i.test(t)) list = byLabel(t.slice(6));
      else if (/^placeholder=/i.test(t)) { const w = norm(t.slice(12)); list = [...document.querySelectorAll('[placeholder]')].filter((e) => norm(e.placeholder).includes(w)); }
      else if (/^xpath=/i.test(t)) { const r = document.evaluate(t.slice(6), document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); for (let i = 0; i < r.snapshotLength; i++) list.push(r.snapshotItem(i)); }
      else list = [...document.querySelectorAll(t)];
    } catch (e) { throw new Error('Bad target ' + t + ': ' + e.message); }
    const v = list.filter(vis); const pick = v.length ? v : list;
    return all ? pick : pick[0] || null;
  }
  function rect(target) { const e = find(target); if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, tag: e.tagName, href: e.href || e.getAttribute('href') || null }; }
  function hit(target, x, y) { const e = find(target); const at = document.elementFromPoint(x, y); return !!(e && at && (e === at || e.contains(at) || at.contains(e))); }
  function table(target) {
    const root = target ? find(target) : document.querySelector('table') || document.querySelector('[role=grid],[role=table]');
    if (!root) return null; const el = root.tagName === 'TABLE' || root.getAttribute('role') ? root : root.querySelector('table,[role=grid],[role=table]') || root;
    const cell = (c) => (c.innerText || c.textContent || '').replace(/\\s+/g, ' ').trim();
    let rows;
    if (el.tagName === 'TABLE') rows = [...el.rows].map((r) => [...r.cells].flatMap((c) => Array(Math.min(20, c.colSpan || 1)).fill(0).map((_, i) => (i ? '' : cell(c)))));
    else rows = [...el.querySelectorAll('[role=row]')].map((r) => [...r.querySelectorAll('[role=columnheader],[role=cell],[role=gridcell],[role=rowheader]')].map(cell));
    return rows.filter((r) => r.some((x) => x));
  }
  function text(target, all) { if (all) return find(target, true).map((e) => (e.innerText || e.value || '').trim()); const e = find(target); return e ? (e.innerText || e.value || '').trim() : null; }
  function focus(target) { const e = find(target); if (!e) return false; e.scrollIntoView({ block: 'center' }); e.focus(); if (e.select && /^(INPUT|TEXTAREA)$/.test(e.tagName)) e.select(); else if (e.isContentEditable) { const r = document.createRange(); r.selectNodeContents(e); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } return true; }
  function setValue(target, v) { const e = find(target); if (!e) return false; if (e.tagName === 'SELECT') { const o = [...e.options].find((o) => o.value === v || norm(o.text) === norm(v)) || [...e.options].find((o) => norm(o.text).includes(norm(v))); if (!o) throw new Error('No option ' + v + ' (options: ' + [...e.options].map((o) => o.text.trim()).join(', ') + ')'); e.value = o.value; } else { const p = Object.getPrototypeOf(e); const d = Object.getOwnPropertyDescriptor(p, 'value'); d && d.set ? d.set.call(e, v) : (e.value = v); } e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; }
  window.__cadence = { find, rect, hit, table, text, focus, setValue, click: (t) => { const e = find(t); if (!e) return false; e.click(); return true; } };
  return true; })()`;

class Browser {
  constructor({ store, onRecord }) {
    this.store = store;
    this.windows = new Map(); // run id → BrowserWindow
    this.onRecord = onRecord || (() => {});
    this.downloadWaiters = new Map(); // webContents id → [{resolve, reject, saveAs, dir}]
    this.wired = new Set();
  }
  sess(profile) {
    const s = session.fromPartition(partitionFor(profile));
    if (!this.wired.has(s)) {
      this.wired.add(s);
      s.setUserAgent(UA());
      s.on('will-download', (e, item, wc) => this.handleDownload(item, wc));
    }
    return s;
  }
  handleDownload(item, wc) {
    const owner = wc && !wc.isDestroyed() ? wc.id : null;
    const queue = (owner != null && this.downloadWaiters.get(owner)) || [];
    const waiter = queue.shift();
    if (!waiter) { // a download nobody asked for (e.g. during recording): keep it in the recorder's folder
      const rec = owner != null && this.recordings && this.recordings.get(owner);
      if (rec) { item.setSavePath(path.join(rec.dir, item.getFilename())); rec.downloaded(item.getFilename()); return; }
      item.cancel(); return;
    }
    const name = (waiter.saveAs && String(waiter.saveAs).trim()) ? addExt(String(waiter.saveAs).trim().replace(/[\\/:*?"<>|]+/g, '-'), item.getFilename()) : item.getFilename();
    let dest = path.join(waiter.dir, name);
    for (let i = 2; fs.existsSync(dest); i++) dest = path.join(waiter.dir, `${path.basename(name, path.extname(name))} (${i})${path.extname(name)}`);
    item.setSavePath(dest);
    waiter.started && waiter.started(item.getFilename());
    item.once('done', (_, state) => { if (state === 'completed') waiter.resolve(dest); else waiter.reject(new Error(`The download ${state === 'cancelled' ? 'was cancelled' : 'failed'}`)); });
  }
  expectDownload(wc, dir, saveAs, timeoutS) {
    return new Promise((resolve, reject) => {
      const w = { dir, saveAs, resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } };
      const t = setTimeout(() => { const q = this.downloadWaiters.get(wc.id) || []; const i = q.indexOf(w); if (i >= 0) q.splice(i, 1); reject(new Error('No download started. Check the target is the button that starts the export, or add a wait before it.')); }, timeoutS * 1000);
      w.started = () => clearTimeout(t); // once it starts, big files may take as long as they need
      if (!this.downloadWaiters.has(wc.id)) this.downloadWaiters.set(wc.id, []);
      this.downloadWaiters.get(wc.id).push(w);
    });
  }
  async cookieHeader(profile, url) { const c = await this.sess(profile).cookies.get({ url }); return c.map((x) => `${x.name}=${x.value}`).join('; '); }
  async clear(profile) { await this.sess(profile).clearStorageData(); await this.sess(profile).clearCache(); }
  cancel(runId) { const w = this.windows.get(runId); if (w && !w.isDestroyed()) w.destroy(); this.windows.delete(runId); }

  makeWindow(profile, show, extra = {}) {
    return new BrowserWindow({ width: 1280, height: 860, show, title: 'Cadence browser', autoHideMenuBar: true, paintWhenInitiallyHidden: true,
      webPreferences: { session: this.sess(profile), contextIsolation: true, nodeIntegration: false, sandbox: !extra.preload, backgroundThrottling: false, ...extra } });
  }

  // ───────── the Browser step
  async run(w, x) {
    const timeout = Math.max(10, Number(w.timeout) || 120);
    const profile = w.profile || 'default';
    this.store.ensureProfile(profile);
    const win = this.makeWindow(profile, !!w.show);
    this.windows.set(x.run.id, win);
    const wc = win.webContents;
    wc.setWindowOpenHandler(({ url }) => { setImmediate(() => { if (!win.isDestroyed()) wc.loadURL(url).catch(() => {}); }); return { action: 'deny' }; }); // keep pop-ups (exports, SSO) in the same window
    const out = { files: [], tables: {}, text: {}, table: null };
    const deadline = Date.now() + timeout * 1000;
    const left = () => Math.max(1, (deadline - Date.now()) / 1000);
    const js = async (code) => { if (win.isDestroyed()) throw new Error('Cancelled'); await wc.executeJavaScript(HELPER, true); return wc.executeJavaScript(code, true); };
    const q = (s) => JSON.stringify(String(s ?? ''));
    const settle = async (ms = 400) => { await sleep(ms); const t0 = Date.now(); while (!win.isDestroyed() && wc.isLoading() && Date.now() - t0 < Math.min(30000, left() * 1000)) await sleep(150); await sleep(150); };
    const waitFor = async (target, secs = 15) => {
      const t0 = Date.now(); let last = null;
      while (Date.now() - t0 < Math.min(secs, left()) * 1000) {
        if (x.signal.aborted || win.isDestroyed()) throw new Error('Cancelled');
        try { if (await js(`!!window.__cadence.find(${q(target)})`)) return true; } catch (e) { last = e; if (/Bad target/.test(e.message)) throw e; }
        await sleep(300);
      }
      const where = wc.getURL();
      throw new Error(`Couldn’t find “${target}” on ${where}${looksLikeLogin(where) ? ` — this looks like a sign-in page. Sign in to the “${profile}” browser profile from Connections › Browser profiles.` : ''}`);
    };
    const click = async (target) => {
      await waitFor(target);
      const r = await js(`window.__cadence.rect(${q(target)})`);
      await sleep(120);
      const r2 = await js(`window.__cadence.rect(${q(target)})`) || r;
      if (r2 && (await js(`window.__cadence.hit(${q(target)}, ${r2.x}, ${r2.y})`))) {
        const p = { x: Math.round(r2.x), y: Math.round(r2.y) };
        wc.sendInputEvent({ type: 'mouseMove', ...p }); wc.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', ...p, button: 'left', clickCount: 1 });
      } else await js(`window.__cadence.click(${q(target)})`);
    };
    const key = (k) => { const map = { enter: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', space: 'Space', down: 'Down', up: 'Up', left: 'Left', right: 'Right', backspace: 'Backspace', pagedown: 'PageDown', pageup: 'PageUp', home: 'Home', end: 'End' }; const kc = map[String(k).toLowerCase()] || String(k); wc.sendInputEvent({ type: 'keyDown', keyCode: kc }); if (kc.length === 1 || kc === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: kc === 'Enter' ? '\r' : kc }); wc.sendInputEvent({ type: 'keyUp', keyCode: kc }); };

    try {
      const start = String(x.renderText(w.url || '')).trim();
      if (!/^https?:\/\//i.test(start)) throw new Error(`“${start || '(blank)'}” isn’t a web address`);
      x.log(`Opening ${start}`);
      await withTimeout(wc.loadURL(start).catch((e) => { if (!/ERR_ABORTED/.test(e.message)) throw new Error(`Couldn’t open the page: ${e.message.replace(/^.*?(ERR_\w+).*$/, '$1')}`); }), left(), 'The page took too long to load');
      await settle(600);
      const actions = Array.isArray(w.actions) ? w.actions : [];
      for (let i = 0; i < actions.length; i++) {
        if (x.signal.aborted || win.isDestroyed()) throw new Error('Cancelled');
        const a = x.render(actions[i]);
        if (!a || a.off) continue;
        const label = `${i + 1}. ${a.do}${a.target ? ' ' + a.target : a.url ? ' ' + a.url : ''}`;
        try {
          switch (a.do) {
            case 'goto': await withTimeout(wc.loadURL(String(a.url)).catch((e) => { if (!/ERR_ABORTED/.test(e.message)) throw e; }), left(), 'The page took too long to load'); await settle(500); break;
            case 'click': await click(a.target); await settle(); break;
            case 'type': {
              await waitFor(a.target);
              const ok = await js(`window.__cadence.focus(${q(a.target)})`); if (!ok) throw new Error('Couldn’t focus it');
              const val = String(a.value ?? '');
              wc.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
              await sleep(40);
              if (val) wc.insertText(val);
              await sleep(80);
              const got = await js(`(() => { const e = window.__cadence.find(${q(a.target)}); return e ? (e.value ?? e.innerText) : null; })()`);
              if (got != null && got !== val && !(a.target && /password/i.test(a.target))) await js(`window.__cadence.setValue(${q(a.target)}, ${q(val)})`);
              break;
            }
            case 'select': await waitFor(a.target); await js(`window.__cadence.setValue(${q(a.target)}, ${q(a.value)})`); await settle(300); break;
            case 'press': key(a.key || 'Enter'); await settle(); break;
            case 'waitFor': await waitFor(a.target, Number(a.timeout) || 30); break;
            case 'waitText': { const t0 = Date.now(); const lim = Math.min(Number(a.timeout) || 30, left()); while (!(await js(`document.body && document.body.innerText.toLowerCase().includes(${q(String(a.value).toLowerCase())})`))) { if (Date.now() - t0 > lim * 1000) throw new Error(`The text “${a.value}” never appeared`); await sleep(400); } break; }
            case 'wait': await sleep(Math.min(600, Number(a.seconds) || 1) * 1000); break;
            case 'download': {
              const p = this.expectDownload(wc, x.dir, a.saveAs, Math.min(Number(a.timeout) || 60, left()));
              await click(a.target);
              const file = await withTimeout(p, left(), 'The download didn’t finish in time');
              out.files.push(file); x.log(`Downloaded ${path.basename(file)}`); break;
            }
            case 'downloadUrl': {
              await waitFor(a.target);
              const href = await js(`(() => { const e = window.__cadence.find(${q(a.target)}); return e && (e.href || e.src || e.getAttribute('href')); })()`);
              if (!href) throw new Error('That element has no link address');
              const p = this.expectDownload(wc, x.dir, a.saveAs, Math.min(60, left()));
              wc.downloadURL(new URL(href, wc.getURL()).href);
              const file = await withTimeout(p, left(), 'The download didn’t finish in time');
              out.files.push(file); x.log(`Downloaded ${path.basename(file)}`); break;
            }
            case 'extractTable': {
              if (a.target) await waitFor(a.target);
              const m = await js(`window.__cadence.table(${a.target ? q(a.target) : 'null'})`);
              if (!m || !m.length) throw new Error('No table found');
              const t = fromMatrix(m, { header: true, types: true });
              const name = a.name || `table${Object.keys(out.tables).length + 1}`;
              out.tables[name] = t; if (!out.table) out.table = t;
              x.log(`Copied table “${name}”: ${t.rows.length} rows × ${t.columns.length} columns`); break;
            }
            case 'extractText': {
              await waitFor(a.target);
              const v = await js(`window.__cadence.text(${q(a.target)}, ${a.all ? 'true' : 'false'})`);
              out.text[a.name || `text${Object.keys(out.text).length + 1}`] = v; x.log(`Copied text: ${String(Array.isArray(v) ? v.join(' | ') : v).slice(0, 120)}`); break;
            }
            case 'screenshot': {
              let rect;
              if (a.target) { await waitFor(a.target); const r = await js(`(() => { const e = window.__cadence.find(${q(a.target)}); e.scrollIntoView({block:'center'}); const b = e.getBoundingClientRect(); return { x: Math.max(0, Math.floor(b.left)), y: Math.max(0, Math.floor(b.top)), width: Math.ceil(b.width), height: Math.ceil(b.height) }; })()`); await sleep(200); rect = r; }
              const img = await wc.capturePage(rect);
              const f = uniq(path.join(x.dir, addExt(a.saveAs || `screenshot-${i + 1}`, 'x.png'))); fs.writeFileSync(f, img.toPNG()); out.files.push(f); x.log(`Screenshot ${path.basename(f)}`); break;
            }
            case 'pdf': { const buf = await wc.printToPDF({ printBackground: true, pageSize: 'A4' }); const f = uniq(path.join(x.dir, addExt(a.saveAs || 'page', 'x.pdf'))); fs.writeFileSync(f, buf); out.files.push(f); x.log(`Saved ${path.basename(f)}`); break; }
            case 'scroll': await waitFor(a.target); await js(`window.__cadence.find(${q(a.target)}).scrollIntoView({block:'center'})`); await sleep(400); break;
            case 'script': { const v = await js(String(a.code || '')); out.text[a.name || `script${i + 1}`] = v; x.log(`Script returned ${JSON.stringify(v)?.slice(0, 120)}`); break; }
            case 'ifExists': { const there = await js(`!!window.__cadence.find(${q(a.target)})`); if (!there) { const n = Math.max(1, Number(a.count) || 1); x.log(`Not there, skipping the next ${n}`); i += n; } break; }
            default: throw new Error(`Unknown browser action “${a.do}”`);
          }
        } catch (e) {
          throw new Error(`Browser step ${label}: ${e.message}`);
        }
        x.log(`✓ ${label}`);
      }
      out.url = wc.getURL();
      return { ...out, file: out.files[0] || '' };
    } finally {
      this.downloadWaiters.delete(wc.id);
      this.windows.delete(x.run.id);
      if (!win.isDestroyed()) { if (w.show && w.keepOpen) {} else win.destroy(); }
    }
  }

  // ───────── sign in: a normal window on the profile; closes when you're done
  signIn(profile, url) {
    this.store.ensureProfile(profile);
    const win = this.makeWindow(profile, true);
    win.setTitle(`Sign in — ${profile} profile (close this window when you’re done)`);
    win.webContents.setWindowOpenHandler(() => ({ action: 'allow' }));
    win.loadURL(/^https?:/.test(url || '') ? url : 'https://www.google.com').catch(() => {});
    return new Promise((res) => win.on('closed', () => res(true)));
  }

  // ───────── recorder: you click through the site, Cadence writes the actions
  record(profile, url, dir, onEvent) {
    this.store.ensureProfile(profile);
    if (!this.recordings) this.recordings = new Map();
    const win = this.makeWindow(profile, true, { preload: path.join(__dirname, 'recorder-preload.js') });
    win.setTitle('Recording — click through the site, then close this window');
    const wc = win.webContents;
    let lastClick = null;
    const rec = { dir, downloaded: (name) => { if (lastClick && lastClick.do === 'click') { lastClick.do = 'download'; onEvent({ type: 'upgrade', action: lastClick, file: name }); } } };
    fs.mkdirSync(dir, { recursive: true });
    this.recordings.set(wc.id, rec);
    const ch = 'cadence-rec:' + wc.id;
    const handler = (e, a) => { if (e.sender !== wc) return; if (a.do === 'click') lastClick = a; else if (a.do !== 'press') lastClick = null; onEvent({ type: 'action', action: a }); };
    ipcMain.on('cadence-rec', handler);
    wc.on('did-navigate', (_, u) => onEvent({ type: 'nav', url: u }));
    wc.setWindowOpenHandler(({ url: u }) => { setImmediate(() => wc.loadURL(u).catch(() => {})); return { action: 'deny' }; });
    win.loadURL(url).catch(() => {});
    win.on('closed', () => { ipcMain.removeListener('cadence-rec', handler); this.recordings.delete(wc.id); onEvent({ type: 'done' }); });
    return { stop: () => { if (!win.isDestroyed()) win.close(); }, channel: ch };
  }
}

function addExt(name, from) { return path.extname(name) ? name : name + path.extname(from); }
function uniq(p) { let d = p; for (let i = 2; fs.existsSync(d); i++) d = path.join(path.dirname(p), `${path.basename(p, path.extname(p))} (${i})${path.extname(p)}`); return d; }
function looksLikeLogin(u) { return /log-?in|sign-?in|auth|sso|account\/|oauth|saml/i.test(String(u)); }
function withTimeout(p, secs, msg) { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), secs * 1000); })]).finally(() => clearTimeout(t)); }

module.exports = { Browser, partitionFor, HELPER };
