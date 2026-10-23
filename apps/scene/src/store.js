// Everything Scene remembers, as small JSON files in its app-data folder.
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  theme: 'system', keepRunning: true, openAtLogin: false, switcherHotkey: 'Control+Alt+Space', waitSeconds: 20,
  keepApps: [], notify: true, menuBarName: true, triggers: true, sidebarCollapsed: false, confirmQuit: true
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
  settings() { return { ...DEFAULTS, ...this.read('settings.json', {}) }; }
  setSettings(p) { return this.write('settings.json', { ...this.settings(), ...p }); }
  scenes() { return this.read('scenes.json', []); }
  scene(id) { return this.scenes().find((s) => s.id === id) || null; }
  saveScene(s) {
    const list = this.scenes().slice(); const i = list.findIndex((x) => x.id === s.id);
    const next = { ...s, updatedAt: Date.now() };
    if (i >= 0) list[i] = next; else list.push(next);
    this.write('scenes.json', list); return next;
  }
  deleteScene(id) { this.write('scenes.json', this.scenes().filter((s) => s.id !== id)); }
  reorder(ids) { const list = this.scenes(); this.write('scenes.json', ids.map((id) => list.find((s) => s.id === id)).filter(Boolean).concat(list.filter((s) => !ids.includes(s.id)))); }
  state() { return this.read('state.json', {}); }
  setState(p) { return this.write('state.json', { ...this.state(), ...p }); }
  history() { return this.read('history.json', []); }
  addHistory(h) { const list = [h, ...this.history()].slice(0, 200); this.write('history.json', list); return list; }
}

module.exports = { Store, DEFAULTS };
