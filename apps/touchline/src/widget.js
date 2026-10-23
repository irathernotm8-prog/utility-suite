// Touchline — the live widget: a small floating window with today's scores.
// It stays on top of other apps (unless unpinned), remembers where you left it,
// and reopens on launch if it was open when you quit.
'use strict';
const path = require('path');
const { BrowserWindow, screen, nativeTheme, app } = require('electron');
const store = require('./store');

const IS_MAC = process.platform === 'darwin';
let w = null;
let quitting = false;
app.on('before-quit', () => { quitting = true; });

const state = () => {
  const s = store.get();
  s.widget = { open: false, pinned: true, filter: 'today', bounds: null, ...(s.widget || {}) };
  return s.widget;
};

function placement(b) {
  const W = b?.width || 340, H = b?.height || 480;
  if (b && Number.isFinite(b.x) && Number.isFinite(b.y)) {
    const d = screen.getDisplayMatching({ x: b.x, y: b.y, width: W, height: H }).workArea;
    const onScreen = b.x < d.x + d.width - 60 && b.x + W > d.x + 60 && b.y >= d.y - 10 && b.y < d.y + d.height - 60;
    if (onScreen) return { x: b.x, y: b.y, width: W, height: H };
  }
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - W - 24, y: a.y + 24, width: W, height: H };
}

function applyPin(on) {
  if (!w) return;
  w.setAlwaysOnTop(!!on, 'floating');
  if (IS_MAC) w.setVisibleOnAllWorkspaces(!!on, { visibleOnFullScreen: true });
}

function open() {
  const s = state();
  if (w) { w.show(); w.focus(); return w; }
  const b = placement(s.bounds);
  w = new BrowserWindow({
    ...b, minWidth: 260, minHeight: 160, maxWidth: 560,
    title: 'Touchline Live', frame: false, show: false, fullscreenable: false, maximizable: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b120e' : '#f4f7f4',
    roundedCorners: true, hasShadow: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  w.loadFile(path.join(__dirname, 'renderer', 'widget.html'));
  w.once('ready-to-show', () => { applyPin(s.pinned); w.showInactive(); });
  const remember = () => { if (!w || w.isDestroyed()) return; state().bounds = w.getBounds(); store.save(); };
  w.on('resize', remember); w.on('move', remember);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.on('closed', () => { w = null; if (!quitting) { state().open = false; store.save(); } });
  s.open = true; store.save();
  return w;
}

function close() { if (w) w.close(); }
function toggle() { if (w) close(); else open(); return !!w; }
function isOpen() { return !!w; }
function pin(on) { state().pinned = !!on; store.save(); applyPin(on); return state(); }
function send(ch, d) { if (w && !w.isDestroyed()) w.webContents.send(ch, d); }
function restore() { if (state().open) open(); }

module.exports = { open, close, toggle, isOpen, pin, send, restore, state, get win() { return w; } };
