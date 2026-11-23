// Mural — macOS: wallpaper windows are Electron "desktop" windows (desktop level, on every Space, never focused,
// mouse passes through) — above the picture macOS draws, below the desktop icons and every app.
//
// A small JavaScript-for-Automation helper (osascript, no permissions needed) watches two things:
//   • clicks on the bare desktop (NSEvent.pressedMouseButtons, and no app window under the pointer), only when the
//     current wallpaper reacts to clicks;
//   • whether each screen's desktop is hidden by a full-screen or zoomed window (CGWindowList, every ~1.5 s), and
//     whether macOS has moved its own wallpaper picture in front of ours (then we bring ours forward again).
'use strict';
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');

const JXA = String.raw`
ObjC.import('Cocoa'); ObjC.import('CoreGraphics');
function run(argv) {
  var pid = parseInt(argv[0], 10), clicks = argv[1] === '1';
  var out = $.NSFileHandle.fileHandleWithStandardOutput;
  function emit(o) { out.writeData($.NSString.alloc.initWithUTF8String(JSON.stringify(o) + '\n').dataUsingEncoding($.NSUTF8StringEncoding)); }
  var IGNORE = { 'Window Server': 1, 'Dock': 1, 'Control Center': 1, 'SystemUIServer': 1, 'Notification Center': 1, 'WindowManager': 1, 'Spotlight': 1, 'Screenshot': 1, 'Wallpaper': 1, 'WallpaperAgent': 1, 'TextInputMenuAgent': 1 };
  function mainH() { return $.NSScreen.screens.objectAtIndex(0).frame.size.height; }
  function windows() { var ref = $.CGWindowListCopyWindowInfo(1, 0); return ObjC.deepUnwrap(ObjC.castRefToObject(ref)) || []; }
  function screens() { var s = $.NSScreen.screens, n = s.count, H = mainH(), r = []; for (var i = 0; i < n; i++) { var f = s.objectAtIndex(i).frame; r.push({ x: f.origin.x, y: H - (f.origin.y + f.size.height), width: f.size.width, height: f.size.height }); } return r; }
  function blocking(w) { return w.kCGWindowLayer === 0 && w.kCGWindowOwnerPID !== pid && !IGNORE[w.kCGWindowOwnerName] && (w.kCGWindowAlpha === undefined || w.kCGWindowAlpha > 0.1); }
  function covers(b, s) { var x0 = Math.max(b.X, s.x), y0 = Math.max(b.Y, s.y), x1 = Math.min(b.X + b.Width, s.x + s.width), y1 = Math.min(b.Y + b.Height, s.y + s.height); return x1 > x0 && y1 > y0 && (x1 - x0) * (y1 - y0) / (s.width * s.height) >= 0.97; }
  var last = '', down = false, tick = 0;
  emit({ ev: 'ready' });
  while (true) {
    if (clicks) {
      var b = $.NSEvent.pressedMouseButtons, isDown = (b & 3) !== 0;
      if (isDown && !down) {
        var loc = $.NSEvent.mouseLocation, x = loc.x, y = mainH() - loc.y, hit = false, ws = windows();
        for (var i = 0; i < ws.length; i++) { var w = ws[i]; if (!blocking(w)) continue; var r = w.kCGWindowBounds; if (x >= r.X && x < r.X + r.Width && y >= r.Y && y < r.Y + r.Height) { hit = true; break; } }
        if (!hit) emit({ ev: 'click', x: x, y: y, b: (b & 2) ? 2 : 0 });
      }
      down = isDown;
    }
    if (tick % 38 === 0) {
      var all = windows(), ss = screens(), cov = [], ours = -1, paper = -1;
      for (var k = 0; k < ss.length; k++) { var c = false; for (var j = 0; j < all.length; j++) if (blocking(all[j]) && covers(all[j].kCGWindowBounds, ss[k])) { c = true; break; } cov.push(c); }
      for (var q = 0; q < all.length; q++) { var aw = all[q]; if (aw.kCGWindowLayer >= 0) continue; if (aw.kCGWindowOwnerPID === pid && ours < 0) ours = q; if ((aw.kCGWindowOwnerName === 'Dock' || aw.kCGWindowOwnerName === 'Wallpaper' || aw.kCGWindowOwnerName === 'WallpaperAgent') && paper < 0) paper = q; }
      var behind = ours >= 0 && paper >= 0 && ours > paper;
      var key = JSON.stringify(cov) + behind;
      if (key !== last) { last = key; emit({ ev: 'cover', screens: ss.map(function (s, i) { return { x: s.x, y: s.y, width: s.width, height: s.height, covered: cov[i] }; }), behind: behind }); }
    }
    tick += clicks ? 1 : 38;
    delay(clicks ? 0.04 : 1.5);
  }
}
`;

class MacDesktop extends EventEmitter {
  constructor({ log }) { super(); this.log = log || (() => {}); this.child = null; this.opts = { clicks: false, cover: true }; this.restarts = 0; this.stopped = false; }
  get name() { return 'mac'; }
  windowOptions() { return { type: 'desktop' }; }
  start(opts = {}) {
    Object.assign(this.opts, opts); this.stopped = false;
    if (this.child) return;
    const c = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', JXA, String(process.pid), this.opts.clicks ? '1' : '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = c; let buf = '';
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const ln = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (ln) this.onLine(ln); } });
    c.stderr.on('data', (d) => this.log('helper:', String(d).trim()));
    c.on('exit', (code) => {
      if (this.child !== c) return; this.child = null;
      if (this.stopped || this.restarting) return;
      this.log('desktop helper exited', code);
      if (this.restarts < 5) { this.restarts++; setTimeout(() => this.start(), 2000 * this.restarts); }
    });
  }
  onLine(ln) {
    let m; try { m = JSON.parse(ln); } catch (_) { return; }
    if (m.ev === 'ready') this.restarts = 0;
    if (m.ev === 'click') this.emit('click', { x: m.x, y: m.y, button: m.b });
    if (m.ev === 'cover') { this.emit('cover', (m.screens || []).map((s) => ({ bounds: { x: s.x, y: s.y, width: s.width, height: s.height }, covered: !!s.covered }))); if (m.behind) this.emit('behind'); }
  }
  /** The helper takes its settings on the command line, so a change restarts it (rare: only when clicks turn on/off). */
  configure(opts) {
    const before = JSON.stringify(this.opts); Object.assign(this.opts, opts);
    if (JSON.stringify(this.opts) === before || !this.child) return;
    this.restarting = true; const c = this.child; this.child = null; try { c.kill(); } catch (_) {} this.restarting = false; this.start();
  }
  async attach(win) { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false }); win.setIgnoreMouseEvents(true); return { ok: true, mode: 'desktop' }; }
  async place(win, display) { win.setBounds(display.bounds); return { ok: true }; }
  forget() { return Promise.resolve(); }
  restoreDesktop() { return Promise.resolve({ ok: true }); }
  getWallpaper() {
    return new Promise((res) => execFile('/usr/bin/osascript', ['-e', 'tell application "System Events" to get picture of desktop 1'], { timeout: 8000 }, (e, out) => res(e ? null : String(out).trim() || null)));
  }
  setWallpaper(p) {
    return new Promise((res) => execFile('/usr/bin/osascript', ['-e', 'on run argv', '-e', 'tell application "System Events" to tell every desktop to set picture to (item 1 of argv)', '-e', 'end run', String(p)], { timeout: 15000 }, (e) => res({ ok: !e, error: e ? String(e.message) : null })));
  }
  stop() { this.stopped = true; const c = this.child; this.child = null; try { c && c.kill(); } catch (_) {} }
}

module.exports = { MacDesktop, JXA };
