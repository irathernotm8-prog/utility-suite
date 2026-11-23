// Mural — settings and what's on each display, saved as settings.json in the app-data folder.
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  enabled: true,              // wallpapers on the desktop at all
  sameOnAll: true,            // one wallpaper for every display
  wallpaper: 'builtin/aurora',// used when sameOnAll
  perDisplay: {},             // displayKey -> wallpaper id
  fps: 30,                    // frame cap: 15 / 24 / 30 / 60
  scale: 1,                   // resolution (shaders also use their own lower hint)
  budget: 'balanced',         // light / balanced / generous / unlimited (CPU the wallpapers may use)
  battery: 'eco',             // on battery: 'normal' | 'eco' (15 fps, lower res) | 'pause'
  pauseCovered: true,         // a full-screen or maximized window hides the desktop
  pauseLocked: true,
  pauseHot: true,             // the computer is running hot
  pauseIdle: false,           // nobody's touched it in a while
  cursor: true, clicks: true, // let wallpapers react
  freeAfter: 0,               // minutes paused before the wallpaper windows close to free memory (0 = never)
  location: null,             // { name, lat, lon } for dynamic skies; null = a guess from the time zone
  startAtLogin: false,
  showStats: false,           // small fps readout on the desktop
  rotate: { on: false, minutes: 60, ids: [] },
  favorites: [],
  firstRun: true
};

class Store {
  constructor(dir) { this.file = path.join(dir, 'settings.json'); fs.mkdirSync(dir, { recursive: true }); this.data = this.load(); }
  load() {
    let d = {}; try { d = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch (_) {}
    return { ...DEFAULTS, ...d, rotate: { ...DEFAULTS.rotate, ...(d.rotate || {}) }, perDisplay: { ...(d.perDisplay || {}) } };
  }
  get() { return this.data; }
  set(patch) {
    const allowed = Object.keys(DEFAULTS);
    for (const [k, v] of Object.entries(patch || {})) if (allowed.includes(k)) this.data[k] = k === 'rotate' ? { ...this.data.rotate, ...v } : v;
    this.save(); return this.data;
  }
  save() { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1)); fs.renameSync(tmp, this.file); }
  /** The wallpaper meant for a display. */
  wallpaperFor(key) { return this.data.sameOnAll ? this.data.wallpaper : (this.data.perDisplay[key] || this.data.wallpaper); }
}

module.exports = { Store, DEFAULTS };
