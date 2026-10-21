// Trace — screenshot tool: a global shortcut, a floating capture bar, and a region picker drawn over a frozen copy of the screen.
const { BrowserWindow, desktopCapturer, screen, ipcMain, systemPreferences, globalShortcut, shell, dialog } = require('electron');
const path = require('path');

const isMac = process.platform === 'darwin';

module.exports = function makeCapture({ store, getWin, settings, saveSettings, activeProject, onAdded }) {
  let busy = false, bar = null, overlay = null, pendingRegion = null, overlayData = null;
  let session = { count: 0, thumb: '' };

  // ---- where captures go ----
  function target() {
    const list = store.list();
    const want = settings().captureTarget;
    if (want && list.find((p) => p.id === want)) return want;
    const act = activeProject();
    if (act && list.find((p) => p.id === act)) return act;
    if (list[0]) return list[0].id;
    return store.create({ name: 'Captures' }).id;
  }

  function permission() {
    if (!isMac) return 'granted';
    try { return systemPreferences.getMediaAccessStatus('screen'); } catch (_) { return 'unknown'; }
  }
  function explainPermission() {
    const w = getWin();
    const r = dialog.showMessageBoxSync(w && !w.isDestroyed() ? w : undefined, {
      type: 'info', buttons: ['Open Settings', 'Not now'], defaultId: 0, cancelId: 1,
      message: 'Trace needs permission to take screenshots',
      detail: 'Open System Settings → Privacy & Security → Screen & System Audio Recording, turn Trace on, then quit and reopen Trace.\n\nAfter an update, macOS may ask again: turn Trace off and on in that list.'
    });
    if (r === 0) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }

  // ---- grabbing pixels ----
  async function grab(display) {
    const b = display.bounds, sf = display.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(b.width * sf), height: Math.round(b.height * sf) } });
    if (!sources.length) throw new Error('No screen to capture.');
    const all = screen.getAllDisplays();
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[all.findIndex((d) => d.id === display.id)] || sources[0];
    const img = src.thumbnail;
    const size = img.getSize();
    if (img.isEmpty() || !size.width) throw Object.assign(new Error('The screenshot came back empty.'), { permission: true });
    return img;
  }

  function cropTo(img, display, rect) {
    const size = img.getSize();
    const sx = size.width / display.bounds.width, sy = size.height / display.bounds.height;
    const r = {
      x: Math.max(0, Math.round(rect.x * sx)), y: Math.max(0, Math.round(rect.y * sy)),
      width: Math.round(rect.w * sx), height: Math.round(rect.h * sy)
    };
    r.width = Math.max(1, Math.min(r.width, size.width - r.x));
    r.height = Math.max(1, Math.min(r.height, size.height - r.y));
    return img.crop(r);
  }

  function pickRegion(display, img) {
    return new Promise((resolve) => {
      const b = display.bounds;
      overlayData = { src: img.toJPEG(88).toString('base64'), w: b.width, h: b.height, last: lastRegionFor(display) };
      pendingRegion = resolve;
      overlay = new BrowserWindow({
        x: b.x, y: b.y, width: b.width, height: b.height, show: false, frame: false, resizable: false, movable: false,
        minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false, enableLargerThanScreen: true,
        alwaysOnTop: true, backgroundColor: '#000000', roundedCorners: false, ...(isMac ? { type: 'panel' } : {}),
        webPreferences: { preload: path.join(__dirname, 'overlay-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
      });
      overlay.setAlwaysOnTop(true, 'screen-saver');
      if (isMac) overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      overlay.setBounds(b);
      overlay.once('ready-to-show', () => { overlay.setBounds(b); overlay.show(); overlay.focus(); });
      overlay.on('closed', () => { overlay = null; if (pendingRegion) { const p = pendingRegion; pendingRegion = null; p(null); } });
      overlay.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
    });
  }
  function lastRegionFor(display) {
    const r = settings().lastRegion;
    return r && String(r.display) === String(display.id) ? r : null;
  }

  async function capture(mode = 'region') {
    if (busy) return null;
    busy = true;
    try {
      const status = permission();
      if (status === 'denied' || status === 'restricted') { explainPermission(); return null; }
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      let img;
      try { img = await grab(display); }
      catch (e) { if (e.permission || isMac) explainPermission(); else throw e; return null; }
      let rect = null;
      if (mode === 'repeat') {
        rect = lastRegionFor(display);
        if (!rect) mode = 'region';
      }
      if (mode === 'region') {
        rect = await pickRegion(display, img);
        if (!rect) return null;
        if (rect.full) rect = null;
        else saveSettings({ lastRegion: { display: String(display.id), x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
      }
      const out = rect ? cropTo(img, display, rect) : img;
      const size = out.getSize();
      const pid = target();
      session.count++;
      const media = store.addMedia(pid, out.toPNG(), { source: 'capture', w: size.width, h: size.height, scale: display.scaleFactor || 1, name: '' });
      session.thumb = out.resize({ height: 72 }).toDataURL();
      onAdded(pid, media);
      sendBar();
      return { pid, media };
    } finally { busy = false; }
  }

  // ---- floating capture bar ----
  function barState() {
    const s = settings();
    return { projects: store.list().map((p) => ({ id: p.id, name: p.name })), target: target(), count: session.count, thumb: session.thumb, shortcut: s.shortcut, repeatShortcut: s.repeatShortcut, platform: process.platform };
  }
  function sendBar() { if (bar && !bar.isDestroyed()) bar.webContents.send('bar:state', barState()); }
  function openBar() {
    if (bar && !bar.isDestroyed()) { bar.show(); sendBar(); return; }
    session = { count: 0, thumb: '' };
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const W = 600, H = 60;
    bar = new BrowserWindow({
      x: Math.round(d.x + (d.width - W) / 2), y: d.y + 14, width: W, height: H, show: false, frame: false, transparent: true,
      resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: true, alwaysOnTop: true,
      ...(isMac ? { type: 'panel' } : {}),
      webPreferences: { preload: path.join(__dirname, 'bar-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    bar.setAlwaysOnTop(true, 'floating');
    if (isMac) bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    bar.setContentProtection(true); // keeps the bar out of its own screenshots
    bar.once('ready-to-show', () => bar.show());
    bar.on('closed', () => { bar = null; const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('trace:bar', false); });
    bar.loadFile(path.join(__dirname, 'renderer', 'bar.html'));
    const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('trace:bar', true);
  }
  function closeBar() { if (bar && !bar.isDestroyed()) bar.close(); }

  // ---- shortcuts ----
  function registerShortcuts() {
    globalShortcut.unregisterAll();
    const s = settings(), failed = [];
    for (const [acc, mode] of [[s.shortcut, 'region'], [s.repeatShortcut, 'repeat']]) {
      if (!acc) continue;
      try { if (!globalShortcut.register(acc, () => capture(mode).catch(reportError))) failed.push(acc); }
      catch (_) { failed.push(acc); }
    }
    return failed;
  }
  function reportError(e) {
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send('trace:error', String(e && e.message || e));
  }

  // ---- IPC for the bar and the overlay ----
  ipcMain.handle('bar:state', () => barState());
  ipcMain.on('bar:target', (_e, id) => { saveSettings({ captureTarget: id || null }); sendBar(); });
  ipcMain.on('bar:capture', (_e, mode) => capture(mode).catch(reportError));
  ipcMain.on('bar:close', () => closeBar());
  ipcMain.on('bar:open-app', () => { const w = getWin(); if (w && !w.isDestroyed()) { w.show(); w.focus(); } });
  ipcMain.handle('overlay:init', () => overlayData);
  ipcMain.on('overlay:done', (_e, rect) => {
    const p = pendingRegion; pendingRegion = null; overlayData = null;
    if (overlay && !overlay.isDestroyed()) overlay.close();
    if (p) p(rect && (rect.full || (rect.w >= 4 && rect.h >= 4)) ? rect : null);
  });

  return { capture, openBar, closeBar, isBarOpen: () => !!(bar && !bar.isDestroyed()), registerShortcuts, permission, sendBar, reportError };
};
