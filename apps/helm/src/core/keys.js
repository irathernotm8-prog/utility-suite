// Helm — key names to macOS virtual key codes and Windows virtual-key codes, plus US-layout typing for the Mac.
'use strict';

const MAC = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17,
  1: 18, 2: 19, 3: 20, 4: 21, 6: 22, 5: 23, '=': 24, 9: 25, 7: 26, '-': 27, 8: 28, 0: 29, ']': 30, o: 31, u: 32, '[': 33,
  i: 34, p: 35, return: 36, l: 37, j: 38, "'": 39, k: 40, ';': 41, '\\': 42, ',': 43, '/': 44, n: 45, m: 46, '.': 47,
  tab: 48, space: 49, '`': 50, backspace: 51, escape: 53, cmd: 55, shift: 56, capslock: 57, alt: 58, ctrl: 59,
  fn: 63, f5: 96, f6: 97, f7: 98, f3: 99, f8: 100, f9: 101, f11: 103, f10: 109, f12: 111, home: 115, pageup: 116,
  delete: 117, f4: 118, end: 119, f2: 120, pagedown: 121, f1: 122, left: 123, right: 124, down: 125, up: 126
};
const WIN = {
  backspace: 0x08, tab: 0x09, return: 0x0d, shift: 0x10, ctrl: 0x11, alt: 0x12, escape: 0x1b, space: 0x20,
  pageup: 0x21, pagedown: 0x22, end: 0x23, home: 0x24, left: 0x25, up: 0x26, right: 0x27, down: 0x28, delete: 0x2e,
  win: 0x5b, cmd: 0x5b, ';': 0xba, '=': 0xbb, ',': 0xbc, '-': 0xbd, '.': 0xbe, '/': 0xbf, '`': 0xc0, '[': 0xdb, '\\': 0xdc,
  ']': 0xdd, "'": 0xde, volumemute: 0xad, volumedown: 0xae, volumeup: 0xaf, nexttrack: 0xb0, prevtrack: 0xb1, playpause: 0xb3
};
for (let i = 0; i < 26; i++) WIN[String.fromCharCode(97 + i)] = 0x41 + i;
for (let i = 0; i < 10; i++) WIN[String(i)] = 0x30 + i;
for (let i = 1; i <= 12; i++) WIN['f' + i] = 0x6f + i;
// keys Windows wants flagged as "extended"
const WIN_EXTENDED = new Set([0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2d, 0x2e, 0x5b, 0x5c, 0xad, 0xae, 0xaf, 0xb0, 0xb1, 0xb3]);

// macOS event flags
const MAC_FLAGS = { shift: 0x20000, ctrl: 0x40000, alt: 0x80000, cmd: 0x100000, numpad: 0x200000, fn: 0x800000 };
const MAC_ARROWS = new Set(['left', 'right', 'up', 'down', 'home', 'end', 'pageup', 'pagedown', 'delete', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12']);
function macFlags(mods = [], key) {
  let f = 0; for (const m of mods) f |= MAC_FLAGS[m === 'win' ? 'cmd' : m] || 0;
  // real arrow and function keys carry these; Spaces shortcuts (ctrl + arrow) ignore events without them
  if (MAC_ARROWS.has(key)) f |= MAC_FLAGS.fn | (/^(left|right|up|down)$/.test(key) ? MAC_FLAGS.numpad : 0);
  return f;
}

const SHIFTED = { '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', _: '-', '+': '=',
  '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`' };
/** A character as US-layout key presses on a Mac, or null when it needs pasting. */
function macChar(ch) {
  if (ch === ' ') return { code: MAC.space, shift: false };
  if (ch === '\n') return { code: MAC.return, shift: false };
  if (ch === '\t') return { code: MAC.tab, shift: false };
  if (/^[a-z0-9`\-=[\]\\;',./]$/.test(ch)) return { code: MAC[ch], shift: false };
  if (/^[A-Z]$/.test(ch)) return { code: MAC[ch.toLowerCase()], shift: true };
  if (SHIFTED[ch]) return { code: MAC[SHIFTED[ch]], shift: true };
  return null;
}

module.exports = { MAC, WIN, WIN_EXTENDED, MAC_FLAGS, macFlags, macChar };
