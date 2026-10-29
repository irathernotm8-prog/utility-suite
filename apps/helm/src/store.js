// Helm — settings, kept as JSON in the app-data folder.
'use strict';
const fs = require('fs');
const path = require('path');
const { DEFAULT_GAMES, DEFAULT_KEEP } = require('./games');

const DEFAULTS = {
  enabled: true,
  theme: 'system',
  // pointer and scrolling
  pointerSpeed: 1, pointerCurve: 2, deadzone: 0.14, precisionStrength: 0.7, scrollSpeed: 1, invertScroll: false, swapSticks: false,
  // touchpad
  touchSpeed: 1, touchScrollSpeed: 1, naturalTouchScroll: true, tapToClick: true, twoFingerSideways: 'desktops', rightHalfClick: false, touchMomentum: true,
  // buttons: only what differs from the defaults is stored
  bindings: { base: {}, layer: {} },
  // games
  gameMode: true, fullscreenGames: true, gameApps: DEFAULT_GAMES, keepApps: DEFAULT_KEEP,
  // feel
  showHints: true, showHud: true, haptics: true, lightbar: true, lightbarColor: '#38d6ff',
  // app
  openAtLogin: false, keepRunning: true, firstRun: true
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (_) {}
    this.s = { ...DEFAULTS, ...saved, bindings: { base: { ...((saved.bindings && saved.bindings.base) || {}) }, layer: { ...((saved.bindings && saved.bindings.layer) || {}) } } };
    this.t = null;
  }
  get() { return this.s; }
  set(patch) {
    for (const [k, v] of Object.entries(patch || {})) {
      if (!(k in DEFAULTS)) continue;
      this.s[k] = v;
    }
    this.save(); return this.s;
  }
  bind(layer, button, action) {
    if (layer !== 'base' && layer !== 'layer') throw new Error('bad layer');
    this.s.bindings[layer][button] = action; this.save(); return this.s;
  }
  resetBindings() { this.s.bindings = { base: {}, layer: {} }; this.save(); return this.s; }
  save() {
    clearTimeout(this.t);
    this.t = setTimeout(() => { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.s, null, 2)); fs.renameSync(this.file + '.tmp', this.file); } catch (_) {} }, 150);
  }
  flush() { clearTimeout(this.t); try { fs.writeFileSync(this.file, JSON.stringify(this.s, null, 2)); } catch (_) {} }
}

module.exports = { Store, DEFAULTS };
