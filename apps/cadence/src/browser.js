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

const { HELPER, runActions, withTimeout } = require('./actions');

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
    const KEYS = { enter: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', space: 'Space', down: 'Down', up: 'Up', left: 'Left', right: 'Right', backspace: 'Backspace', pagedown: 'PageDown', pageup: 'PageUp', home: 'Home', end: 'End' };
    const driver = {
      alive: () => !win.isDestroyed(),
      js: (code) => { if (win.isDestroyed()) throw new Error('Cancelled'); return wc.executeJavaScript(code, true); },
      mouseClick: async (px, py) => { const p = { x: px, y: py }; wc.sendInputEvent({ type: 'mouseMove', ...p }); wc.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', ...p, button: 'left', clickCount: 1 }); },
      insertText: async (t) => wc.insertText(t),
      key: async (k) => { const kc = KEYS[String(k).toLowerCase()] || String(k); wc.sendInputEvent({ type: 'keyDown', keyCode: kc }); if (kc.length === 1 || kc === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: kc === 'Enter' ? '\r' : kc }); wc.sendInputEvent({ type: 'keyUp', keyCode: kc }); },
      goto: (url) => wc.loadURL(url).catch((e) => { if (!/ERR_ABORTED/.test(e.message)) throw e; }),
      isLoading: async () => wc.isLoading(),
      url: async () => wc.getURL(),
      expectDownload: (dir, saveAs, secs) => this.expectDownload(wc, dir, saveAs, secs),
      downloadURL: async (u) => wc.downloadURL(u),
      capture: async (rect) => (await wc.capturePage(rect)).toPNG(),
      pdf: () => wc.printToPDF({ printBackground: true, pageSize: 'A4' }),
    };
    try {
      const start = String(x.renderText(w.url || '')).trim();
      if (!/^https?:\/\//i.test(start)) throw new Error(`“${start || '(blank)'}” isn’t a web address`);
      x.log(`Opening ${start}`);
      await withTimeout(wc.loadURL(start).catch((e) => { if (!/ERR_ABORTED/.test(e.message)) throw new Error(`Couldn’t open the page: ${e.message.replace(/^.*?(ERR_\w+).*$/, '$1')}`); }), left(), 'The page took too long to load');
      await new Promise((r) => setTimeout(r, 600));
      await runActions({ driver, actions: w.actions, x, out, deadline, hint: `this looks like a sign-in page. Sign in to the “${profile}” browser profile from Connections › Browser profiles.` });
      out.url = wc.getURL();
      return { ...out, file: out.files[0] || '' };
    } finally {
      this.downloadWaiters.delete(wc.id);
      this.windows.delete(x.run.id);
      if (!win.isDestroyed()) win.destroy();
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

module.exports = { Browser, partitionFor, HELPER };
