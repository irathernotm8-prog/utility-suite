// Helm — the bridge from the mapper's motion to the platform: keeps the pointer's position with sub-pixel precision,
// keeps it on a screen, and turns smooth scroll amounts into whole events.
'use strict';

class Output {
  /** screen: Electron's screen module (or a stand-in with getCursorScreenPoint / getAllDisplays). */
  constructor(platform, screen) {
    this.p = platform; this.screen = screen;
    this.pos = null; this.lastSent = null; this.recent = []; this.sx = 0; this.sy = 0; this.buttons = new Set(); this.moved = 0;
  }
  displays() { try { return this.screen.getAllDisplays().map((d) => d.bounds); } catch (_) { return [{ x: 0, y: 0, width: 1920, height: 1080 }]; } }
  moveBy(dx, dy) {
    if (!dx && !dy) return;
    const cur = (() => { try { return this.screen.getCursorScreenPoint(); } catch (_) { return { x: 0, y: 0 }; } })();
    // the real mouse (or something else) moved the pointer since we last did: start from where it is now
    // (compared against the last few positions sent, since the system can be a frame or two behind)
    const ours = this.recent.some((q) => Math.abs(cur.x - q.x) <= 2.5 && Math.abs(cur.y - q.y) <= 2.5);
    if (!this.pos || !ours) this.pos = { x: cur.x, y: cur.y };
    let nx = this.pos.x + dx, ny = this.pos.y + dy;
    const ds = this.displays();
    const inside = (b, x, y) => x >= b.x && x <= b.x + b.width - 1 && y >= b.y && y <= b.y + b.height - 1;
    if (!ds.some((b) => inside(b, nx, ny))) {
      // clamp to the screen it was on, so it slides along the edge instead of stopping dead
      const home = ds.find((b) => inside(b, this.pos.x, this.pos.y)) || ds[0];
      if (home) { nx = Math.max(home.x, Math.min(home.x + home.width - 1, nx)); ny = Math.max(home.y, Math.min(home.y + home.height - 1, ny)); }
    }
    this.pos = { x: nx, y: ny };
    const r = { x: Math.round(nx), y: Math.round(ny) };
    if (!this.lastSent || r.x !== this.lastSent.x || r.y !== this.lastSent.y || this.p.name === 'mac') {
      this.p.moveTo(nx, ny); this.lastSent = r; this.moved++;
      this.recent.push(r); if (this.recent.length > 10) this.recent.shift();
    }
  }
  mouse(btn, down) {
    if (down) this.buttons.add(btn); else { if (!this.buttons.has(btn)) return; this.buttons.delete(btn); }
    this.p.mouse(btn, down);
  }
  /** dy > 0 shows what's further down; amounts in pixels. */
  scroll(dx, dy, { touch = false } = {}) {
    if (this.p.name === 'win') {
      // Windows counts in wheel units (120 a notch, about 3 lines); smooth-scrolling apps accept smaller steps
      this.sx += dx * 1.5; this.sy += dy * 1.5;
    } else { this.sx += dx; this.sy += dy; }
    const ix = Math.trunc(this.sx), iy = Math.trunc(this.sy);
    if (!ix && !iy) return;
    this.sx -= ix; this.sy -= iy;
    this.p.wheel(iy, ix, touch);
  }
  key(name, mods, down) { this.p.key(name, mods, down); }
  combo(name, mods) { this.p.combo(name, mods); }
  text(s) { this.p.text(s); }
  media(name) { this.p.media(name); }
  command(name) { return this.p.command(name); }
  releaseAll() { for (const b of [...this.buttons]) this.mouse(b, false); }
}

module.exports = { Output };
