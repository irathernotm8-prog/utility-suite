// Helm — the on-screen keyboard's model: layouts, the highlighted key, shift / caps, the ⌘ (Ctrl) one-shot.
// The overlay only draws view(); the mapper moves the highlight and presses keys.
'use strict';

const K = (k, w = 1, extra = {}) => ({ k, w, ...extra });
const chars = (s) => [...s].map((c) => K(c));

function layouts(platform) {
  const mod = platform === 'win32' ? 'Ctrl' : '⌘';
  const bottom = (toggle) => [K('mode', 1.5, { label: toggle, type: 'mode' }), K('mod', 1.25, { label: mod, type: 'mod' }), K(' ', 4.75, { label: 'space', type: 'char' }),
    K('left', 1, { label: '←', type: 'key' }), K('right', 1, { label: '→', type: 'key' }), K('hide', 1.5, { label: 'Done', type: 'hide' })];
  return {
    abc: [
      [...chars('1234567890'), K('backspace', 1.5, { label: '⌫', type: 'key' })],
      [K('tab', 1.25, { label: 'tab', type: 'key' }), ...chars('qwertyuiop'), K("'", 1, {})],
      [K('caps', 1.5, { label: 'caps', type: 'caps' }), ...chars('asdfghjkl'), K('return', 1.75, { label: 'return', type: 'key' })],
      [K('shift', 2, { label: '⇧', type: 'shift' }), ...chars('zxcvbnm,.'), K('?', 1, {}), K('-', 1, {})],
      bottom('123')
    ],
    sym: [
      [...chars('!@#$%^&*()'), K('backspace', 1.5, { label: '⌫', type: 'key' })],
      [K('tab', 1.25, { label: 'tab', type: 'key' }), ...chars('-_=+[]{}\\|'), K('/', 1, {})],
      [K('caps', 1.5, { label: 'caps', type: 'caps', disabled: true }), ...chars(';:"<>~`€£'), K('return', 1.75, { label: 'return', type: 'key' })],
      [K('shift', 2, { label: '⇧', type: 'shift', disabled: true }), ...chars(',.?\'/*#@&'), K('…', 1, {}), K('%', 1, {})],
      bottom('ABC')
    ]
  };
}
const SHIFT_MAP = { 1: '!', 2: '@', 3: '#', 4: '$', 5: '%', 6: '^', 7: '&', 8: '*', 9: '(', 0: ')', "'": '"', ',': '<', '.': '>', '?': '?', '-': '_' };

class Keyboard {
  constructor(platform = process.platform) {
    this.platform = platform; this.L = layouts(platform);
    this.layout = 'abc'; this.row = 2; this.col = 5; this.shift = 0; this.caps = false; this.mod = false; this.held = false;
  }
  rows() { return this.L[this.layout]; }
  key() { const r = this.rows()[this.row]; return r[Math.min(this.col, r.length - 1)]; }
  centers(row) { const r = this.rows()[row]; const total = r.reduce((s, k) => s + k.w, 0); let x = 0; return r.map((k) => { const c = (x + k.w / 2) / total; x += k.w; return c; }); }
  move(dir) {
    const rows = this.rows();
    if (dir === 'left' || dir === 'right') {
      const n = rows[this.row].length; this.col = (this.col + (dir === 'left' ? -1 : 1) + n) % n;
    } else {
      const here = this.centers(this.row)[Math.min(this.col, rows[this.row].length - 1)];
      this.row = (this.row + (dir === 'up' ? -1 : 1) + rows.length) % rows.length;
      const cs = this.centers(this.row); let best = 0;
      cs.forEach((c, i) => { if (Math.abs(c - here) < Math.abs(cs[best] - here)) best = i; });
      this.col = best;
    }
  }
  /** Point at a key from a touchpad position (0..1 across and down). */
  pointAt(x, y) {
    const rows = this.rows();
    this.row = Math.max(0, Math.min(rows.length - 1, Math.floor(y * rows.length)));
    const cs = this.centers(this.row); const r = rows[this.row]; const total = r.reduce((s, k) => s + k.w, 0);
    let acc = 0; let idx = r.length - 1;
    for (let i = 0; i < r.length; i++) { acc += r[i].w / total; if (x <= acc) { idx = i; break; } }
    this.col = idx; void cs;
  }
  upper() { return this.caps !== (this.shift > 0 || this.held); }
  /** Press the highlighted key (or a named one). Returns what to send: { type:'text', text } | { type:'key', key }
   *  | { type:'combo', key, mods } | { type:'hide' } | null when the keyboard handled it itself. */
  press(named = null) {
    const k = named ? (this.rows().flat().find((x) => x.k === named) || { k: named, type: named.length === 1 ? 'char' : 'key' }) : this.key();
    if (k.disabled) return null;
    const t = k.type || 'char';
    if (t === 'mode') { this.layout = this.layout === 'abc' ? 'sym' : 'abc'; this.shift = 0; return null; }
    if (t === 'shift') { this.shift = this.shift ? 0 : 1; return null; }
    if (t === 'caps') { this.caps = !this.caps; this.shift = 0; return null; }
    if (t === 'mod') { this.mod = !this.mod; return null; }
    if (t === 'hide') return { type: 'hide' };
    if (t === 'key') {
      if (this.mod) { this.mod = false; return { type: 'combo', key: k.k, mods: [this.platform === 'win32' ? 'ctrl' : 'cmd'] }; }
      return { type: 'key', key: k.k };
    }
    let ch = k.k;
    if (this.mod) {
      this.mod = false;
      const key = ch === ' ' ? 'space' : ch.toLowerCase();
      return { type: 'combo', key, mods: [this.platform === 'win32' ? 'ctrl' : 'cmd', ...(this.shift ? ['shift'] : [])] };
    }
    if (this.layout === 'abc' && this.upper()) ch = /[a-z]/.test(ch) ? ch.toUpperCase() : (this.shift || this.held ? SHIFT_MAP[ch] || ch : ch);
    if (this.shift === 1) this.shift = 0;
    return { type: 'text', text: ch };
  }
  view() {
    const up = this.upper();
    return {
      layout: this.layout, shift: this.shift > 0 || this.held, caps: this.caps, mod: this.mod,
      rows: this.rows().map((r, ri) => r.map((k, ci) => ({
        label: k.label || (this.layout === 'abc' && up && /[a-z]/.test(k.k) ? k.k.toUpperCase() : (this.layout === 'abc' && (this.shift || this.held) && SHIFT_MAP[k.k] && !/[a-z]/.test(k.k) ? SHIFT_MAP[k.k] : k.k)),
        w: k.w, type: k.type || 'char', sel: ri === this.row && ci === Math.min(this.col, r.length - 1), disabled: !!k.disabled,
        on: (k.type === 'shift' && (this.shift > 0 || this.held)) || (k.type === 'caps' && this.caps) || (k.type === 'mod' && this.mod)
      })))
    };
  }
}

module.exports = { Keyboard, layouts };
