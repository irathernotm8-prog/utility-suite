// The stage is Sideby's built-in browser: a WebContentsView that can open any
// site. A preload runs in every frame (including cross-origin player iframes)
// to find the main <video> and report/control it, which is how sync works on
// sites Sideby has never heard of.
const { WebContentsView, session, ipcMain, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');

const PARTITION = 'persist:sideby-web';
const UI_DIR = path.join(__dirname, '..', 'ui');
const stages = new Map(); // webContents.id -> Stage
const localFiles = new Map(); // token -> { path, name, size }
let sessionReady = null;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'video/ogg', '.ogv': 'video/ogg', '.wav': 'audio/wav'
};

function cleanUserAgent(ua) {
  return ua.replace(/\s(sideby|Sideby|Electron)\/\S+/g, '');
}

function serveFromDir(dir, relative) {
  const target = path.normalize(path.join(dir, relative));
  if (!target.startsWith(dir + path.sep)) return new Response('Not found', { status: 404 });
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(target).toString()).then(res => new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' }
  }));
}

function serveLocalFile(token, request) {
  const entry = localFiles.get(token);
  if (!entry) return new Response('This file is no longer shared.', { status: 404 });
  const size = fs.statSync(entry.path).size;
  const type = MIME[path.extname(entry.path).toLowerCase()] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('Range') || '');
  let start = 0, end = size - 1, status = 200;
  if (range) {
    if (range[1]) start = Number(range[1]);
    if (range[2]) end = Math.min(Number(range[2]), size - 1);
    if (!range[1] && range[2]) { start = Math.max(0, size - Number(range[2])); end = size - 1; }
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    status = 206;
  }
  const stream = fs.createReadStream(entry.path, { start, end });
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return new Response(Readable.toWeb(stream), { status, headers });
}

async function prepareSession(getSettings) {
  if (sessionReady) return sessionReady;
  sessionReady = (async () => {
    const ses = session.fromPartition(PARTITION);
    ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      callback(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'screen-wake-lock'].includes(permission));
    });
    ses.setPermissionCheckHandler((wc, permission) => ['fullscreen', 'clipboard-sanitized-write', 'screen-wake-lock'].includes(permission));
    ses.on('will-download', event => event.preventDefault());
    ses.protocol.handle('sideby-media', request => {
      const url = new URL(request.url);
      if (url.host === 'player') return serveFromDir(path.join(UI_DIR, 'player'), url.pathname.slice(1) || 'index.html');
      if (url.host === 'file') return serveLocalFile(url.pathname.slice(1), request);
      return new Response('Not found', { status: 404 });
    });
    if (getSettings().adblock !== false) await enableAdblock(ses);
    return ses;
  })();
  return sessionReady;
}

let blocker = null;
async function enableAdblock(ses) {
  try {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron');
    const { app } = require('electron');
    const cacheFile = path.join(app.getPath('userData'), 'adblock-engine.bin');
    blocker = await Promise.race([
      ElectronBlocker.fromPrebuiltAdsAndTracking(net.fetch.bind(net), {
        path: cacheFile,
        read: fs.promises.readFile,
        write: fs.promises.writeFile
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 15000))
    ]);
    blocker.enableBlockingInSession(ses);
  } catch (error) {
    console.warn('[sideby] ad blocking unavailable:', error.message);
  }
}

function setAdblock(on) {
  const ses = session.fromPartition(PARTITION);
  if (on && !blocker) return enableAdblock(ses);
  if (blocker) {
    try { on ? blocker.enableBlockingInSession(ses) : blocker.disableBlockingInSession(ses); } catch {}
  }
}

function frameKey(frame) { return `${frame.processId}:${frame.routingId}`; }

class Stage {
  constructor(window, emit) {
    this.window = window;
    this.emit = emit;
    this.frames = new Map();
    this.active = null;
    this.fullscreenFrame = null;
    this.programmaticUntil = 0;
    this.lastGesture = 0;
    this.lastVideoSent = false;
    this.visible = false;
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };

    this.view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        preload: path.join(__dirname, 'frame-preload.js'),
        nodeIntegrationInSubFrames: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        autoplayPolicy: 'no-user-gesture-required',
        backgroundThrottling: false,
        spellcheck: false
      }
    });
    this.view.setBackgroundColor('#000000');
    this.view.setVisible(false);
    window.contentView.addChildView(this.view);
    const wc = this.view.webContents;
    stages.set(wc.id, this);

    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (/^https?:/i.test(url)) this.emit('popup', { url, disposition });
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => { if (!/^(https?|sideby-media):/i.test(url)) event.preventDefault(); });
    wc.on('will-frame-navigate', details => {
      if (details.isMainFrame) return;
      if (!/^(https?|sideby-media|about|blob|data):/i.test(details.url)) details.preventDefault();
    });
    const nav = (url, inPage) => {
      const user = Date.now() > this.programmaticUntil && Date.now() - this.lastGesture < 2500;
      this.emit('nav', { ...this.navState(), url, inPage, user });
    };
    wc.on('did-navigate', (e, url) => { this.resetFrames(); nav(url, false); });
    wc.on('did-navigate-in-page', (e, url, isMainFrame) => { if (isMainFrame) nav(url, true); });
    wc.on('page-title-updated', () => this.emit('nav', this.navState()));
    wc.on('did-start-loading', () => this.emit('nav', this.navState()));
    wc.on('did-stop-loading', () => this.emit('nav', this.navState()));
    wc.on('did-fail-load', (e, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.emit('load-error', { code, description, url });
    });
    wc.on('enter-html-full-screen', () => this.emit('fullscreen', true));
    wc.on('leave-html-full-screen', () => this.emit('fullscreen', false));
    wc.on('render-process-gone', (e, details) => this.emit('crashed', details.reason));
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' || input.type === 'mouseDown') this.lastGesture = Date.now();
      if (input.type === 'keyDown' && input.key === 'Escape' && !wc.isFullScreen?.()) this.emit('escape');
    });
    this.sweep = setInterval(() => this.pickActive(), 1000);
  }

  navState() {
    const wc = this.view.webContents;
    if (wc.isDestroyed()) return {};
    return {
      url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward()
    };
  }

  setBounds(rect) {
    if (!rect) return;
    const [w, h] = this.window.getContentSize();
    const x = Math.max(0, Math.round(rect.x)), y = Math.max(0, Math.round(rect.y));
    this.bounds = { x, y, width: Math.max(0, Math.min(w - x, Math.round(rect.width))), height: Math.max(0, Math.min(h - y, Math.round(rect.height))) };
    this.view.setBounds(this.bounds);
    this.setVisible(rect.visible !== false);
  }

  setVisible(on) {
    this.visible = !!on;
    this.view.setVisible(this.visible && this.bounds.width > 0 && this.bounds.height > 0);
  }

  async load(url) {
    if (typeof url !== 'string' || !/^(https?|sideby-media):/i.test(url)) throw new Error('Sideby can only open web links.');
    this.programmaticUntil = Date.now() + 4000;
    this.resetFrames();
    try {
      await this.view.webContents.loadURL(url);
    } catch (error) {
      if (error.code !== 'ERR_ABORTED' && !/ERR_ABORTED/.test(error.message)) throw error;
    }
  }

  navigate(action) {
    const wc = this.view.webContents;
    const history = wc.navigationHistory;
    this.programmaticUntil = 0;
    this.lastGesture = Date.now();
    if (action === 'back' && history.canGoBack()) history.goBack();
    else if (action === 'forward' && history.canGoForward()) history.goForward();
    else if (action === 'reload') wc.reload();
    else if (action === 'stop') wc.stop();
  }

  blank() {
    this.programmaticUntil = Date.now() + 2000;
    this.resetFrames();
    this.view.webContents.loadURL('about:blank').catch(() => {});
  }

  resetFrames() {
    this.frames.clear();
    this.active = null;
    this.fullscreenFrame = null;
    if (this.lastVideoSent) { this.lastVideoSent = false; this.emit('video', null); }
  }

  report(frame, data) {
    if (!frame || !data) return;
    const key = frameKey(frame);
    if (data.kind === 'gesture') { this.lastGesture = Date.now(); return; }
    if (data.kind === 'fullscreen') { this.fullscreenFrame = data.on ? key : (this.fullscreenFrame === key ? null : this.fullscreenFrame); return; }
    if (data.kind === 'novideo') { this.frames.delete(key); if (this.active === key) this.pickActive(); return; }
    if (data.kind !== 'video' || !data.state) return;
    this.frames.set(key, { frame, area: Number(data.area) || 0, at: Date.now() });
    if (!this.active || !this.frames.has(this.active)) this.pickActive();
    if (this.active === key) {
      this.lastVideoSent = true;
      this.emit('video', { ...data.state, event: data.event || null, user: !!data.user, frameTitle: data.title || null });
    }
  }

  pickActive() {
    const now = Date.now();
    let best = null;
    for (const [key, entry] of this.frames) {
      if (now - entry.at > 3000 || entry.frame.detached) { this.frames.delete(key); continue; }
      if (!best || entry.area > best[1].area) best = [key, entry];
    }
    const current = this.active && this.frames.get(this.active);
    if (current && best && current.area >= best[1].area * 0.6) return;
    const next = best ? best[0] : null;
    if (next !== this.active) {
      this.active = next;
      if (!next && this.lastVideoSent) { this.lastVideoSent = false; this.emit('video', null); }
    }
  }

  apply(cmd) {
    const entry = this.active && this.frames.get(this.active);
    if (!entry || entry.frame.detached) return false;
    try { entry.frame.send('sideby:apply', cmd); return true; } catch { return false; }
  }

  react(payload) {
    const wc = this.view.webContents;
    let target = wc.mainFrame;
    if (this.fullscreenFrame) {
      const entry = [...wc.mainFrame.framesInSubtree].find(f => frameKey(f) === this.fullscreenFrame);
      if (entry) target = entry;
    }
    try { target.send('sideby:react', payload); } catch {}
  }

  async snapshot() {
    try {
      if (!this.view.getVisible()) return null;
      const image = await this.view.webContents.capturePage();
      return image.isEmpty() ? null : image.resize({ width: Math.min(1280, image.getSize().width) }).toDataURL();
    } catch { return null; }
  }

  destroy() {
    clearInterval(this.sweep);
    const wc = this.view.webContents;
    stages.delete(wc.id);
    if (!wc.isDestroyed()) wc.close();
  }
}

ipcMain.on('frame:report', (event, data) => {
  const stage = stages.get(event.sender.id);
  if (stage) stage.report(event.senderFrame, data);
});

function registerLocalFile(filePath) {
  const token = randomUUID();
  localFiles.set(token, { path: filePath, name: path.basename(filePath) });
  return { token, url: `sideby-media://file/${token}`, name: path.basename(filePath) };
}

function playerUrl(src, { name, live } = {}) {
  const url = new URL('sideby-media://player/index.html');
  url.searchParams.set('src', src);
  if (name) url.searchParams.set('name', name);
  if (live) url.searchParams.set('live', '1');
  return url.toString();
}

module.exports = { Stage, prepareSession, registerLocalFile, playerUrl, setAdblock, cleanUserAgent, PARTITION, MIME };
