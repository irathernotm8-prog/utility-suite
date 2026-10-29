// Helm — the quick panel (PS / Xbox button): big tiles for the things you reach for, navigated with the d-pad,
// the stick or the touchpad.
'use strict';

const TILES = [
  { id: 'search', label: 'Search', sub: { darwin: 'Spotlight', win32: 'Start' }, icon: 'search' },
  { id: 'keyboard', label: 'Keyboard', icon: 'keyboard' },
  { id: 'overview', label: { darwin: 'Mission Control', win32: 'Task View' }, icon: 'overview' },
  { id: 'showDesktop', label: 'Desktop', icon: 'desktop' },
  { id: 'apps', label: 'Apps', sub: { darwin: 'Launchpad', win32: 'Start' }, icon: 'apps' },
  { id: 'screenshot', label: 'Screenshot', icon: 'camera' },
  { id: 'playPause', label: 'Play / pause', icon: 'play' },
  { id: 'mute', label: 'Mute', icon: 'mute' },
  { id: 'volumeDown', label: 'Volume −', icon: 'voldown', keepOpen: true },
  { id: 'volumeUp', label: 'Volume +', icon: 'volup', keepOpen: true },
  { id: 'lock', label: 'Lock', icon: 'lock' },
  { id: 'openHelm', label: 'Helm settings', icon: 'gear' }
];
const COLS = 4;

class Panel {
  constructor(platform = process.platform) { this.platform = platform; this.i = 0; }
  tiles() {
    const pick = (v) => (v && typeof v === 'object' ? v[this.platform] || v.darwin : v);
    return TILES.map((t) => ({ ...t, label: pick(t.label), sub: pick(t.sub) || null }));
  }
  move(dir) {
    const n = TILES.length, rows = Math.ceil(n / COLS);
    let r = Math.floor(this.i / COLS), c = this.i % COLS;
    if (dir === 'left') c = (c - 1 + COLS) % COLS; else if (dir === 'right') c = (c + 1) % COLS;
    else if (dir === 'up') r = (r - 1 + rows) % rows; else if (dir === 'down') r = (r + 1) % rows;
    this.i = Math.min(n - 1, r * COLS + c);
  }
  pointAt(x, y) {
    const n = TILES.length, rows = Math.ceil(n / COLS);
    const r = Math.max(0, Math.min(rows - 1, Math.floor(y * rows))), c = Math.max(0, Math.min(COLS - 1, Math.floor(x * COLS)));
    this.i = Math.min(n - 1, r * COLS + c);
  }
  current() { return TILES[this.i]; }
  view() { return { cols: COLS, sel: this.i, tiles: this.tiles() }; }
}

module.exports = { Panel, TILES };
