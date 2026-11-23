// Mural — when a wallpaper runs, and how hard. Pure functions so every rule is testable.
'use strict';

const FPS_STEPS = [60, 30, 24, 20, 15, 10];
const BUDGETS = { light: 4, balanced: 8, generous: 16, unlimited: Infinity }; // % of one CPU core, averaged

/**
 * Why a display's wallpaper should be paused right now, or null if it can run.
 * ctx: { settings, covered, onBattery, locked, suspended, thermal ('nominal'|'fair'|'serious'|'critical'), userPaused, idle }
 */
function pauseReason(ctx) {
  const s = ctx.settings || {};
  if (ctx.userPaused) return 'paused';
  if (ctx.suspended) return 'sleeping';
  if (ctx.locked && s.pauseLocked !== false) return 'locked';
  if (ctx.covered && s.pauseCovered !== false) return 'covered';
  if (ctx.onBattery && s.battery === 'pause') return 'battery';
  if ((ctx.thermal === 'serious' || ctx.thermal === 'critical') && s.pauseHot !== false) return 'hot';
  if (ctx.idle && s.pauseIdle) return 'idle';
  return null;
}

/** The frame-rate and resolution a wallpaper gets: the user's limits, the wallpaper's own hint, battery and the governor. */
function quality({ settings = {}, hint = {}, onBattery = false, level = 0 }) {
  let fps = Math.min(Number(settings.fps) || 30, Number(hint.fps) || 60);
  let scale = Math.min(Number(settings.scale) || 1, 1);
  if (onBattery && settings.battery === 'eco') { fps = Math.min(fps, 15); scale = Math.min(scale, 0.75); }
  // governor: each level steps the frame rate down; after that, resolution
  let i = FPS_STEPS.findIndex((f) => f <= fps); if (i < 0) i = FPS_STEPS.length - 1;
  const lv = Math.max(0, level | 0);
  const fpsLv = Math.min(lv, FPS_STEPS.length - 1 - i);
  fps = Math.min(fps, FPS_STEPS[i + fpsLv]);
  const rest = lv - fpsLv; if (rest > 0) scale = Math.max(0.4, scale * Math.pow(0.8, rest));
  return { fps, scale: Math.round(scale * 100) / 100 };
}

/**
 * Keeps the wallpapers inside a CPU budget. Feed it the wallpaper processes' CPU use (% of one core) every few
 * seconds; it raises `level` (less work) when they run hot and slowly lowers it again once there's room.
 */
class Governor {
  constructor(budget = 'balanced') { this.setBudget(budget); this.level = 0; this.samples = []; this.calmSince = 0; }
  setBudget(b) { this.budgetName = b in BUDGETS ? b : 'balanced'; this.limit = BUDGETS[this.budgetName]; }
  /** cpu: number, now: ms. Returns true if the level changed. */
  sample(cpu, now = Date.now()) {
    if (!Number.isFinite(cpu)) return false;
    this.samples.push(cpu); if (this.samples.length > 3) this.samples.shift();
    if (!Number.isFinite(this.limit)) { const ch = this.level !== 0; this.level = 0; return ch; }
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    if (avg > this.limit && this.samples.length >= 2 && this.level < 8) { this.level++; this.samples = []; this.calmSince = 0; return true; }
    if (avg < this.limit * 0.45 && this.level > 0) {
      if (!this.calmSince) this.calmSince = now;
      if (now - this.calmSince > 30000) { this.level--; this.calmSince = now; return true; }
    } else this.calmSince = 0;
    return false;
  }
  reset() { this.level = 0; this.samples = []; this.calmSince = 0; }
}

/** Does a window rectangle cover (nearly) all of a display? Used by both platforms' "is the desktop hidden" checks. */
function covers(win, disp, frac = 0.97) {
  const x0 = Math.max(win.x, disp.x), y0 = Math.max(win.y, disp.y), x1 = Math.min(win.x + win.width, disp.x + disp.width), y1 = Math.min(win.y + win.height, disp.y + disp.height);
  if (x1 <= x0 || y1 <= y0) return false;
  return ((x1 - x0) * (y1 - y0)) / (disp.width * disp.height) >= frac;
}

/** Which display a point (or rectangle) belongs to: the one containing it, else the nearest. */
function displayFor(pt, displays) {
  let best = null, bd = Infinity;
  for (const d of displays) {
    const b = d.bounds; const inside = pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height;
    if (inside) return d;
    const dx = Math.max(b.x - pt.x, 0, pt.x - (b.x + b.width)), dy = Math.max(b.y - pt.y, 0, pt.y - (b.y + b.height)); const dist = dx * dx + dy * dy;
    if (dist < bd) { bd = dist; best = d; }
  }
  return best;
}

module.exports = { pauseReason, quality, Governor, covers, displayFor, BUDGETS, FPS_STEPS };
