// Atoll — the island window: a borderless, transparent panel pinned to the top centre of a display.
// On a Mac with a notch it sits flush against the notch and grows out of it; everywhere else it floats as a pill
// just under the top edge.
// Mac: the window is always exactly the size the island needs (the page says how big), so the rest of the screen
// stays clickable and files can be dropped straight onto the pill.
// Windows (and Linux): resizing a transparent window there is what made the island jitter, so the window keeps one
// fixed size and only the island inside it animates. Everything outside the island lets clicks through
// (setIgnoreMouseEvents with forwarding); the page reports when the pointer is over the island to take clicks again.
'use strict';
const path = require('path');
const { BrowserWindow, screen } = require('electron');

const FAKE_NOTCH = !!process.env.ATOLL_FAKE_NOTCH;          // tests: pretend this display is a notched MacBook
const IS_MAC = process.platform === 'darwin' || FAKE_NOTCH;
const IS_WIN = process.platform === 'win32' && !FAKE_NOTCH;
const FIXED = process.env.ATOLL_FIXED ? process.env.ATOLL_FIXED === '1' : process.platform !== 'darwin';
const FIXED_SIZE = { w: 820, h: 380 };   // fits the open island, its shadow and the bubble

/** Menu bar height on a Mac display (0 elsewhere). Notched MacBooks have a taller menu bar (≥ 32 pt). */
function menuBarHeight(d) { return FAKE_NOTCH ? 38 : IS_MAC ? Math.max(0, d.workArea.y - d.bounds.y) : 0; }
function hasNotch(d) { return FAKE_NOTCH || (IS_MAC && d.internal !== false && menuBarHeight(d) >= 32); }

/** Geometry the page needs to draw the island to match this display. */
function geometry(d, settings) {
  const mb = menuBarHeight(d);
  const notch = hasNotch(d);
  // Notch style works everywhere: on a notched Mac it hugs the real notch; elsewhere it's a black tab flush with the
  // top edge of the screen. Automatic picks it only on a Mac that has a notch.
  const style = settings.style === 'notch' ? 'notch' : settings.style === 'float' ? 'float' : notch ? 'notch' : 'float';
  // MacBook notches are ~185 pt (14") to ~200 pt (16") wide at the default scaling; elsewhere there's no camera
  // housing, so the tab is narrower by default. Either can be set in Settings › Island.
  const notchWidth = settings.notchWidth || (notch ? (d.bounds.width >= 1700 ? 200 : 186) : 140);
  const notchHeight = style === 'notch' ? (notch ? mb : 32) : 0;
  return { style, notch, menuBar: mb || 0, notchHeight, notchWidth, displayId: d.id, scale: d.scaleFactor, platform: process.platform, width: d.bounds.width, fixed: FIXED };
}

class Island {
  constructor({ preload, page, settings, onEvent = () => {} }) {
    this.preload = preload; this.page = page; this.settings = settings; this.onEvent = onEvent;
    this.win = null; this.size = { w: 220, h: 40 }; this.display = null; this.geo = null; this.cursorTimer = null; this.expanded = false; this.hidden = false;
  }

  pickDisplay() {
    const s = this.settings();
    const all = screen.getAllDisplays();
    if (s.display === 'cursor') return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (s.display && s.display !== 'primary') { const d = all.find((x) => String(x.id) === String(s.display)); if (d) return d; }
    return screen.getPrimaryDisplay();
  }

  create() {
    if (this.win) return this.win;
    this.display = this.pickDisplay();
    this.geo = geometry(this.display, this.settings());
    const w = new BrowserWindow({
      ...this.bounds(this.size), frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, show: false, title: 'Atoll', alwaysOnTop: true,
      enableLargerThanScreen: true, roundedCorners: false, acceptFirstMouse: true,
      ...(process.platform === 'darwin' ? { type: 'panel' } : IS_WIN ? { type: 'toolbar', thickFrame: false } : {}),
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false }
    });
    this.win = w;
    w.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'darwin') { w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); w.setWindowButtonVisibility?.(false); }
    w.loadFile(this.page);
    w.once('ready-to-show', () => { if (!this.hidden) w.showInactive(); this.place(); });
    w.on('blur', () => this.onEvent('blur'));
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    w.on('closed', () => { this.win = null; });
    const moved = () => this.relayout();
    screen.on('display-metrics-changed', moved); screen.on('display-added', moved); screen.on('display-removed', moved);
    if (FIXED) { w.setIgnoreMouseEvents(true, { forward: true }); this.hit = false; }
    this.watchCursor();
    return w;
  }

  /** Fixed-size mode: the page says whether the pointer is over the island (take clicks) or not (let them through). */
  setHit(on) {
    if (!FIXED || !this.win || this.win.isDestroyed()) return;
    on = !!on; if (on === this.hit) return;
    this.hit = on;
    this.win.setIgnoreMouseEvents(!on, { forward: true });
  }

  /** Top-centre bounds for a window of size {w,h} on the island's display. */
  bounds({ w, h }) {
    if (FIXED) ({ w, h } = FIXED_SIZE);
    const d = this.display || screen.getPrimaryDisplay();
    const g = this.geo || geometry(d, this.settings());
    const W = Math.round(w), H = Math.round(h);
    const x = Math.round(d.bounds.x + (d.bounds.width - W) / 2);
    let y;
    if (g.style === 'notch') y = d.bounds.y;                          // flush with the top, over the menu bar
    else if (process.platform === 'darwin') y = d.workArea.y + 6;                            // just under the menu bar
    else y = d.bounds.y + 6;                                          // Windows/Linux: just under the top edge
    return { x, y, width: W, height: H };
  }

  setSize(size) {
    if (typeof size.expanded === 'boolean') this.expanded = size.expanded;
    if (FIXED) return;   // the window never changes size; only the island inside it animates
    this.size = { w: Math.max(40, Math.min(1000, size.w | 0)), h: Math.max(8, Math.min(800, size.h | 0)) };
    this.place();
  }
  place() {
    if (!this.win || this.win.isDestroyed()) return;
    const b = this.bounds(this.size), cur = this.win.getBounds();
    if (b.x !== cur.x || b.y !== cur.y || b.width !== cur.width || b.height !== cur.height) this.win.setBounds(b, false);
  }

  relayout() {
    if (!this.win) return;
    const d = this.pickDisplay();
    const g = geometry(d, this.settings());
    const changed = !this.geo || JSON.stringify(g) !== JSON.stringify(this.geo) || d.id !== this.display?.id;
    this.display = d; this.geo = g; this.place();
    if (changed) this.onEvent('geometry', g);
  }

  watchCursor() {
    clearInterval(this.cursorTimer);
    if (this.settings().display !== 'cursor') return;
    this.cursorTimer = setInterval(() => {
      if (this.expanded || !this.win) return;
      const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      if (d.id !== this.display?.id) this.relayout();
    }, 1200);
  }

  show() { this.hidden = false; if (this.win) { this.win.showInactive(); this.place(); } }
  hide() { this.hidden = true; if (this.win) this.win.hide(); }
  focus() { if (this.win) { this.win.show(); this.win.focus(); } }
  send(ch, d) { if (this.win && !this.win.isDestroyed()) this.win.webContents.send(ch, d); }
  destroy() { clearInterval(this.cursorTimer); if (this.win) this.win.destroy(); }
}

module.exports = { Island, geometry, hasNotch, menuBarHeight, FIXED, FIXED_SIZE };
