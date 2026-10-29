// Helm — the controller's touchpad as a laptop trackpad.
//   one finger         moves the pointer (faster the quicker you swipe)
//   tap                click            two-finger tap   right-click
//   press the pad      click (hold and move to drag); with two fingers, right-click
//   two fingers        scroll, with momentum when you let go
//   two-finger swipe sideways   the desktop to the left / right (or scroll sideways, if set)
// Pure: update(touches, padDown, now) returns a list of events; the mapper performs them.
'use strict';

const PAD_W = 1920, PAD_H = 1080;

class Touchpad {
  constructor(opts = () => ({})) {
    this.opts = opts;
    this.reset();
  }
  reset() {
    this.prev = []; this.fingers = 0; this.start = null; this.mode = null; this.total = { x: 0, y: 0 }; this.maxFingers = 0;
    this.clicked = false; this.clickButton = null; this.fired = false; this.vel = { x: 0, y: 0 }; this.lastT = 0; this.momentum = null;
  }
  o() {
    const s = this.opts() || {};
    return {
      speed: s.touchSpeed ?? 1, scrollSpeed: s.touchScrollSpeed ?? 1, natural: s.naturalTouchScroll !== false, tap: s.tapToClick !== false,
      sideways: s.twoFingerSideways || 'desktops', rightHalf: !!s.rightHalfClick, momentum: s.touchMomentum !== false
    };
  }
  /** Stop any momentum (a new touch, a mode change). */
  halt() { this.momentum = null; }

  update(touches, padDown, now) {
    const o = this.o();
    const ev = [];
    const pts = touches.map((p) => ({ id: p.id, x: p.x * PAD_W, y: p.y * PAD_H }));
    const n = pts.length;
    const dt = this.lastT ? Math.max(1, now - this.lastT) : 8; this.lastT = now;

    // ---- the physical click
    if (padDown && !this.clicked) {
      this.clicked = true;
      const right = n >= 2 || (o.rightHalf && n === 1 && pts[0].x > PAD_W * 0.62);
      this.clickButton = right ? 'right' : 'left';
      ev.push({ type: 'button', button: this.clickButton, down: true });
      if (this.start) this.start.clicked = true;
    } else if (!padDown && this.clicked) {
      this.clicked = false;
      ev.push({ type: 'button', button: this.clickButton, down: false });
      this.clickButton = null;
    }

    // ---- touches begin / end
    if (n > 0 && this.fingers === 0) {
      this.momentum = null;
      this.start = { t: now, clicked: this.clicked }; this.mode = null; this.total = { x: 0, y: 0 }; this.maxFingers = n; this.fired = false; this.vel = { x: 0, y: 0 };
    }
    if (n > this.maxFingers) this.maxFingers = n;
    if (n === 0 && this.fingers > 0) {
      const dur = now - this.start.t, moved = Math.hypot(this.total.x, this.total.y);
      if (o.tap && !this.start.clicked && !this.clicked) {
        if (this.maxFingers === 1 && dur < 200 && moved < 28) ev.push({ type: 'tap', button: 'left' });
        else if (this.maxFingers >= 2 && dur < 260 && moved < 40 && !this.mode) ev.push({ type: 'tap', button: 'right' });
      }
      if (this.mode === 'swipe' && !this.fired && Math.abs(this.total.x) > 230 && dur < 450) ev.push({ type: 'swipe', dir: this.total.x < 0 ? 'left' : 'right' });
      if (this.mode === 'scroll' && o.momentum) {
        const v = this.vel; if (Math.hypot(v.x, v.y) > 0.35) this.momentum = { x: v.x, y: v.y, t: now };
      }
      this.start = null; this.mode = null;
    }

    // ---- movement (only when the same fingers are down as last frame)
    const same = n > 0 && n === this.prev.length && pts.every((p, i) => this.prev[i] && this.prev[i].id === p.id);
    if (same) {
      if (n === 1) {
        const dx = pts[0].x - this.prev[0].x, dy = pts[0].y - this.prev[0].y;
        this.total.x += dx; this.total.y += dy;
        if (this.maxFingers === 1 || this.clicked) {
          const v = Math.hypot(dx, dy) / dt; // pad units per ms
          const gain = 0.78 * o.speed * (1 + 1.6 * Math.min(1, Math.max(0, v - 0.25) / 2.2));
          if (dx || dy) ev.push({ type: 'move', dx: dx * gain, dy: dy * gain });
        }
      } else if (n >= 2) {
        const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
        const px = (this.prev[0].x + this.prev[1].x) / 2, py = (this.prev[0].y + this.prev[1].y) / 2;
        const dx = cx - px, dy = cy - py;
        this.total.x += dx; this.total.y += dy;
        if (this.clicked) {
          // two fingers pressed in: a right-button drag
          ev.push({ type: 'move', dx: dx * 0.78 * o.speed, dy: dy * 0.78 * o.speed });
        } else {
          if (!this.mode && Math.hypot(this.total.x, this.total.y) > 36) {
            this.mode = (o.sideways === 'desktops' && Math.abs(this.total.x) > 1.5 * Math.abs(this.total.y)) ? 'swipe' : 'scroll';
          }
          if (this.mode === 'swipe') {
            if (!this.fired && Math.abs(this.total.x) > 420) { this.fired = true; ev.push({ type: 'swipe', dir: this.total.x < 0 ? 'left' : 'right' }); }
          } else if (this.mode === 'scroll') {
            const k = 0.9 * o.scrollSpeed * (o.natural ? -1 : 1);
            const sx = o.sideways === 'desktops' ? 0 : dx * k, sy = dy * k;
            // keep a smoothed velocity for momentum (pixels per ms)
            this.vel.x = this.vel.x * 0.6 + (sx / dt) * 0.4; this.vel.y = this.vel.y * 0.6 + (sy / dt) * 0.4;
            if (sx || sy) ev.push({ type: 'scroll', dx: sx, dy: sy });
          }
        }
      }
    } else if (n !== this.prev.length && n > 0 && this.fingers > 0) {
      // finger count changed mid-gesture: start measuring again from here so nothing jumps
    }
    this.prev = pts; this.fingers = n;

    // ---- momentum after a two-finger scroll
    if (this.momentum && n === 0) {
      const m = this.momentum; const k = Math.exp(-dt / 330);
      m.x *= k; m.y *= k;
      if (Math.hypot(m.x, m.y) < 0.03) this.momentum = null;
      else ev.push({ type: 'scroll', dx: m.x * dt, dy: m.y * dt, momentum: true });
    }
    return ev;
  }
  /** First finger, 0..1, for pointing at the keyboard or the quick panel. */
  static primary(touches) { return touches && touches.length ? touches[0] : null; }
}

module.exports = { Touchpad, PAD_W, PAD_H };
