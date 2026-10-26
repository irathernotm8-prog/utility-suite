// Atoll — everything it remembers, as small JSON files in its app-data folder.
// settings.json: how the island looks and behaves. state.json: timers, the shelf, the chosen match.
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // island
  style: 'auto',            // auto | notch | float  (auto: notch on a Mac with a notch, float everywhere else)
  display: 'primary',       // primary | cursor | <display id>
  expandOn: 'hover',        // hover | click
  hoverDelay: 180,          // ms before a hover opens the island
  notchWidth: 0,            // 0 = measured from the menu bar; otherwise points
  idle: 'clock',            // what a floating island shows when nothing is live: clock | dot | hide
  shortcut: 'CommandOrControl+Alt+Space',
  openAtLogin: false,
  theme: 'system',          // settings window only; the island is always black
  modules: { media: true, timers: true, match: true, shelf: true, weather: true, system: true },
  priority: ['timers', 'match', 'media'],   // which live activity takes the island first
  // timers
  sound: 'chime',           // chime | bell | pulse | none
  timerNotify: true,
  presets: [1, 3, 5, 10, 15, 25, 45, 60],
  focus: { work: 25, short: 5, long: 15, every: 4 },
  // media
  trackBurst: true,
  macPlayers: ['Music', 'Spotify'],
  // live match
  goalBurst: true,
  goalNotify: true,
  // weather
  weather: null,            // { name, admin, country, lat, lon }
  units: 'auto',            // auto | f | c
  // shelf
  clipboard: true,
  clipboardSize: 12
};

class Store {
  constructor(dir) { this.dir = dir; this.cache = {}; }
  file(n) { return path.join(this.dir, n); }
  read(n, d) {
    if (n in this.cache) return this.cache[n];
    let v = d; try { v = JSON.parse(fs.readFileSync(this.file(n), 'utf8')); } catch (_) {}
    return (this.cache[n] = v);
  }
  write(n, v) {
    this.cache[n] = v;
    try { fs.mkdirSync(this.dir, { recursive: true }); const tmp = this.file(n + '.tmp'); fs.writeFileSync(tmp, JSON.stringify(v, null, 1)); fs.renameSync(tmp, this.file(n)); } catch (_) {}
    return v;
  }
  settings() {
    const s = { ...DEFAULTS, ...this.read('settings.json', {}) };
    s.modules = { ...DEFAULTS.modules, ...(s.modules || {}) };
    s.focus = { ...DEFAULTS.focus, ...(s.focus || {}) };
    return s;
  }
  setSettings(p) { const cur = this.settings(); return this.write('settings.json', { ...cur, ...p, modules: { ...cur.modules, ...(p.modules || {}) }, focus: { ...cur.focus, ...(p.focus || {}) } }); }
  state() { return this.read('state.json', {}); }
  setState(p) { return this.write('state.json', { ...this.state(), ...p }); }
}

module.exports = { Store, DEFAULTS };
