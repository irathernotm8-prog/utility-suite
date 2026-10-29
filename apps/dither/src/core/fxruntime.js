/* Dither FX runtime — the pixel canvas, drawing kit and effect player. Plain JS with no imports so the same file runs
   in the app's sandbox, in Node (tests, MCP renders) and inside exported game modules.
   An effect is code that calls effect({...}); see GUIDE in src/core/guide.js for the full contract. */
(function (root) {
  'use strict';

  // ───────── palettes (well-known public palettes, hex)
  var PALETTES = {
    pico8: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'],
    sweetie16: ['#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179', '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57'],
    endesga32: ['#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633', '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e', '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466', '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569'],
    gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
    ember: ['#1b0f1f', '#3d1a2a', '#7a2333', '#c2372e', '#e8662c', '#f7a23b', '#ffd96a', '#fff6c9'],
    arcane: ['#120d26', '#2a1b54', '#4b2c91', '#7b45d6', '#a77bff', '#d2b8ff', '#f3ecff', '#66e0ff'],
    frost: ['#0b1626', '#173357', '#22598c', '#2f8fc4', '#5cc8f0', '#a5ecff', '#e6fbff', '#ffffff'],
    energy: ['#ffffff', '#c9fbff', '#66e0ff', '#2fa3ff', '#2a5bd6', '#1f2a7a', '#0b0f2e', '#ffe680'],
    toxic: ['#0f1a0c', '#1f3b14', '#2f6b1c', '#4fa52a', '#8fdc3a', '#cdf56a', '#f4ffbf', '#b04fd1']
  };
  var RAMPS = {
    fire: ['#fff6c9', '#ffd96a', '#f7a23b', '#e8662c', '#c2372e', '#7a2333', '#3d1a2a'],
    magic: ['#f3ecff', '#d2b8ff', '#a77bff', '#7b45d6', '#4b2c91', '#2a1b54'],
    ice: ['#ffffff', '#a5ecff', '#5cc8f0', '#2f8fc4', '#22598c', '#173357'],
    poison: ['#f4ffbf', '#cdf56a', '#8fdc3a', '#4fa52a', '#2f6b1c', '#1f3b14'],
    holy: ['#ffffff', '#fff6c9', '#ffe57a', '#f7c23b', '#c88a2a', '#7a4f1d'],
    blood: ['#ff9a9a', '#e43b44', '#a22633', '#6b1625', '#3a0d17'],
    smoke: ['#e9e6ef', '#b7b2c2', '#857f94', '#5a556a', '#38344a', '#1f1c2b'],
    energy: ['#ffffff', '#c9fbff', '#66e0ff', '#2fa3ff', '#2a5bd6', '#1f2a7a']
  };

  // ───────── colours: palette index, '#rgb', '#rrggbb', '#rrggbbaa', [r,g,b,a], null/'clear' = transparent
  function hex(h) {
    h = String(h).replace('#', '');
    if (!/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(h)) throw new Error('Bad colour "' + h + '": use a palette slot number or \'#rrggbb\'');
    if (h.length === 3 || h.length === 4) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255];
  }
  function toHex(c) { return '#' + [c[0], c[1], c[2]].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('') + (c[3] !== undefined && c[3] < 255 ? ('0' + c[3].toString(16)).slice(-2) : ''); }
  function resolvePalette(p) { if (!p) return PALETTES.pico8.slice(); if (typeof p === 'string') { if (!PALETTES[p]) throw new Error('Unknown palette "' + p + '". Built in: ' + Object.keys(PALETTES).join(', ')); return PALETTES[p].slice(); } return p.map(function (c) { return typeof c === 'string' ? c : toHex(c); }); }

  // ───────── Bayer 4×4 for ordered dithering
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function bayer(x, y) { return (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16; }

  // ───────── 3×5 pixel font
  var FONT = {}; (function () {
    var g = '0:111101101101111 1:010110010010111 2:111001111100111 3:111001011001111 4:101101111001001 5:111100111001111 6:111100111101111 7:111001010010010 8:111101111101111 9:111101111001111 A:010101111101101 B:110101110101110 C:011100100100011 D:110101101101110 E:111100110100111 F:111100110100100 G:011100101101011 H:101101111101101 I:111010010010111 J:001001001101010 K:101101110101101 L:100100100100111 M:101111111101101 N:110101101101101 O:010101101101010 P:110101110100100 Q:010101101110011 R:110101110101101 S:011100010001110 T:111010010010010 U:101101101101111 V:101101101101010 W:101101111111101 X:101101010101101 Y:101101010010010 Z:111001010100111 +:000010111010000 -:000000111000000 !:010010010000010 ?:110001010000010 .:000000000000010 ,:000000000010100 :::000010000010000 %:101001010100101 /:001001010100100 x:000101010101000 *:000101010101000 =:000111000111000 #:101111101111101 (:010100100100010 ):010001001001010';
    g.split(' ').forEach(function (s) { var k = s[0], bits = s.slice(2); if (s.indexOf(':::') === 0) { k = ':'; bits = s.slice(3); } FONT[k] = bits; });
    FONT[' '] = '000000000000000';
  })();

  // ───────── seeded randomness and noise
  function mulberry(seed) { var a = seed >>> 0; return function () { a = (a + 0x6d2b79f5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash3(x, y, z, s) { var h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function makeNoise(seed) {
    var sm = function (t) { return t * t * (3 - 2 * t); };
    return function (x, y, z) {
      y = y || 0; z = z || 0;
      var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = sm(x - xi), yf = sm(y - yi), zf = sm(z - zi);
      var L = function (a, b, t) { return a + (b - a) * t; };
      var c = function (dx, dy, dz) { return hash3(xi + dx, yi + dy, zi + dz, seed); };
      return L(L(L(c(0, 0, 0), c(1, 0, 0), xf), L(c(0, 1, 0), c(1, 1, 0), xf), yf), L(L(c(0, 0, 1), c(1, 0, 1), xf), L(c(0, 1, 1), c(1, 1, 1), xf), yf), zf);
    };
  }
  var EASE = {
    linear: function (t) { return t; },
    inQuad: function (t) { return t * t; }, outQuad: function (t) { return 1 - (1 - t) * (1 - t); }, inOutQuad: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
    inCubic: function (t) { return t * t * t; }, outCubic: function (t) { return 1 - Math.pow(1 - t, 3); }, inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    outQuart: function (t) { return 1 - Math.pow(1 - t, 4); }, inExpo: function (t) { return t === 0 ? 0 : Math.pow(2, 10 * t - 10); }, outExpo: function (t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); },
    outBack: function (t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    inBack: function (t) { var c1 = 1.70158; return (c1 + 1) * t * t * t - c1 * t * t; },
    outElastic: function (t) { return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1; },
    outBounce: function (t) { var n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; }
  };

  // ───────── the pixel canvas
  function Canvas(w, h, palette) {
    if (!(w > 0 && h > 0 && w <= 1024 && h <= 1024)) throw new Error('Canvas size must be 1–1024 pixels each way (got ' + w + '×' + h + ')');
    this.w = w | 0; this.h = h | 0; this.data = new Uint8ClampedArray(this.w * this.h * 4);
    this.palette = resolvePalette(palette); this._pal = this.palette.map(hex); this._mx = false; this._my = false; this.clip = null;
  }
  var P = Canvas.prototype;
  P.color = function (c) {
    if (c === null || c === undefined || c === 'clear' || c === -1) return null;
    if (typeof c === 'number') { var p = this._pal[((c | 0) % this._pal.length + this._pal.length) % this._pal.length]; return p; }
    if (typeof c === 'string') return hex(c);
    if (c.length >= 3) return [c[0] | 0, c[1] | 0, c[2] | 0, c[3] === undefined ? 255 : c[3] | 0];
    throw new Error('Bad colour: ' + c);
  };
  P._put = function (x, y, rgba) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    if (this.clip && (x < this.clip[0] || y < this.clip[1] || x >= this.clip[0] + this.clip[2] || y >= this.clip[1] + this.clip[3])) return;
    var i = (y * this.w + x) * 4, d = this.data;
    if (!rgba) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; return; }
    d[i] = rgba[0]; d[i + 1] = rgba[1]; d[i + 2] = rgba[2]; d[i + 3] = rgba[3] < 128 ? 0 : 255;
  };
  P._plot = function (x, y, rgba) {
    this._put(x, y, rgba);
    if (this._mx) this._put(this.w - 1 - Math.floor(x), y, rgba);
    if (this._my) this._put(x, this.h - 1 - Math.floor(y), rgba);
    if (this._mx && this._my) this._put(this.w - 1 - Math.floor(x), this.h - 1 - Math.floor(y), rgba);
  };
  P.symmetry = function (x, y) { this._mx = !!x; this._my = !!y; return this; };
  P.clear = function (c) { var rgba = this.color(c === undefined ? null : c); for (var i = 0; i < this.data.length; i += 4) { if (rgba) { this.data[i] = rgba[0]; this.data[i + 1] = rgba[1]; this.data[i + 2] = rgba[2]; this.data[i + 3] = 255; } else this.data[i] = this.data[i + 1] = this.data[i + 2] = this.data[i + 3] = 0; } return this; };
  P.px = P.pset = function (x, y, c) { this._plot(x, y, this.color(c)); return this; };
  P.get = function (x, y) { x = Math.floor(x); y = Math.floor(y); if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null; var i = (y * this.w + x) * 4; return this.data[i + 3] ? toHex([this.data[i], this.data[i + 1], this.data[i + 2]]) : null; };
  P.idx = function (x, y) { var h = this.get(x, y); if (!h) return -1; var c = hex(h); for (var k = 0; k < this._pal.length; k++) { var p = this._pal[k]; if (p[0] === c[0] && p[1] === c[1] && p[2] === c[2]) return k; } return -1; };
  P.filled = function (x, y) { x = Math.floor(x); y = Math.floor(y); if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false; return this.data[(y * this.w + x) * 4 + 3] > 0; };
  P.line = function (x0, y0, x1, y1, c) {
    var rgba = this.color(c); x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1, err = dx + dy, guard = 0;
    for (;;) { this._plot(x0, y0, rgba); if (x0 === x1 && y0 === y1 || ++guard > 8192) break; var e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
    return this;
  };
  P.rect = function (x, y, w, h, c) { x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h); if (w <= 0 || h <= 0) return this; this.line(x, y, x + w - 1, y, c).line(x, y + h - 1, x + w - 1, y + h - 1, c).line(x, y, x, y + h - 1, c).line(x + w - 1, y, x + w - 1, y + h - 1, c); return this; };
  P.fillRect = P.fill = function (x, y, w, h, c) { var rgba = this.color(c); x = Math.round(x); y = Math.round(y); for (var j = 0; j < Math.round(h); j++) for (var i = 0; i < Math.round(w); i++) this._plot(x + i, y + j, rgba); return this; };
  P.fillCircle = function (cx, cy, r, c) {
    var rgba = this.color(c); if (r < 0.5) { this._plot(Math.round(cx), Math.round(cy), rgba); return this; }
    var R = r + 0.25; for (var y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) for (var x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) { var dx = x + 0.5 - cx - 0.5, dy = y + 0.5 - cy - 0.5; if (dx * dx + dy * dy <= R * R) this._plot(x, y, rgba); }
    return this;
  };
  P.circle = function (cx, cy, r, c) { return this.ring(cx, cy, r, 1, c); };
  P.ring = function (cx, cy, r, t, c) {
    var rgba = this.color(c); t = Math.max(1, t || 1); if (r < 0.5) { this._plot(Math.round(cx), Math.round(cy), rgba); return this; }
    var Ro = r + 0.25, Ri = Math.max(0, r - t + 0.25) - (t === 1 ? 0.75 : 0);
    for (var y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) for (var x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) { var dx = x - cx, dy = y - cy, d = dx * dx + dy * dy; if (d <= Ro * Ro && d > Ri * Ri) this._plot(x, y, rgba); }
    return this;
  };
  P.fillEllipse = function (cx, cy, rx, ry, c) { var rgba = this.color(c); rx = Math.max(0.5, rx); ry = Math.max(0.5, ry); for (var y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) for (var x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) { var dx = (x - cx) / (rx + 0.25), dy = (y - cy) / (ry + 0.25); if (dx * dx + dy * dy <= 1) this._plot(x, y, rgba); } return this; };
  P.ellipse = function (cx, cy, rx, ry, c) { var rgba = this.color(c); rx = Math.max(0.5, rx); ry = Math.max(0.5, ry); for (var y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) for (var x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) { var o = Math.pow((x - cx) / (rx + 0.25), 2) + Math.pow((y - cy) / (ry + 0.25), 2), i = Math.pow((x - cx) / Math.max(0.1, rx - 0.75), 2) + Math.pow((y - cy) / Math.max(0.1, ry - 0.75), 2); if (o <= 1 && i > 1) this._plot(x, y, rgba); } return this; };
  P.poly = function (pts, c) {
    var rgba = this.color(c); if (!pts || pts.length < 3) return this; var ys = pts.map(function (p) { return p[1]; });
    for (var y = Math.floor(Math.min.apply(null, ys)); y <= Math.ceil(Math.max.apply(null, ys)); y++) {
      var xs = [], yy = y + 0.5;
      for (var i = 0; i < pts.length; i++) { var a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[1] <= yy && b[1] > yy) || (b[1] <= yy && a[1] > yy)) xs.push(a[0] + (yy - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
      xs.sort(function (p, q) { return p - q; });
      for (var k = 0; k + 1 < xs.length; k += 2) for (var x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) this._plot(x, y, rgba);
    }
    return this;
  };
  P.polyline = function (pts, c, closed) { for (var i = 0; i + 1 < pts.length; i++) this.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c); if (closed && pts.length > 2) this.line(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], c); return this; };
  P.flood = function (x, y, c) {
    x = Math.floor(x); y = Math.floor(y); if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this;
    var rgba = this.color(c), d = this.data, w = this.w, h = this.h, i0 = (y * w + x) * 4, t = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
    var same = function (i) { return t[3] === 0 ? d[i + 3] === 0 : d[i + 3] > 0 && d[i] === t[0] && d[i + 1] === t[1] && d[i + 2] === t[2]; };
    if (rgba && t[3] && rgba[0] === t[0] && rgba[1] === t[1] && rgba[2] === t[2]) return this; if (!rgba && !t[3]) return this;
    var seen = new Uint8Array(w * h), st = [x, y];
    while (st.length) { var yy = st.pop(), xx = st.pop(), k = yy * w + xx; if (xx < 0 || yy < 0 || xx >= w || yy >= h || seen[k] || !same(k * 4)) continue; seen[k] = 1; this._put(xx, yy, rgba); st.push(xx + 1, yy, xx - 1, yy, xx, yy + 1, xx, yy - 1); }
    return this;
  };
  // ordered dithering: level 0 = none, 1 = solid
  P.ditherPx = function (x, y, c, level) { if (level >= 1 || bayer(Math.floor(x), Math.floor(y)) < level) this._plot(x, y, this.color(c)); return this; };
  P.dither = function (x, y, w, h, c, level) { var rgba = this.color(c); x = Math.round(x); y = Math.round(y); for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) if (bayer(x + i, y + j) < level) this._plot(x + i, y + j, rgba); return this; };
  P.ditherCircle = function (cx, cy, r, c, level) { var rgba = this.color(c), R = r + 0.25; for (var y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) for (var x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) { var dx = x - cx, dy = y - cy; if (dx * dx + dy * dy <= R * R && bayer(x, y) < level) this._plot(x, y, rgba); } return this; };
  // radial glow without blur: density falls off from the centre, stepping through the given colours (bright → dim)
  P.glow = function (cx, cy, r, colors, strength) {
    colors = Array.isArray(colors) ? colors : [colors]; strength = strength === undefined ? 1 : strength;
    for (var y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) for (var x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      var d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / Math.max(0.5, r); if (d > 1) continue;
      var v = (1 - d) * strength; var band = Math.min(colors.length - 1, Math.floor((1 - v) * colors.length));
      if (bayer(x, y) < Math.min(1, v * 1.6)) this._plot(x, y, this.color(colors[band]));
    }
    return this;
  };
  P.text = function (str, x, y, c, scale) {
    var rgba = this.color(c); scale = scale || 1; var cx = Math.round(x);
    String(str).toUpperCase().split('').forEach(function (ch) { var g = FONT[ch] || FONT['?']; for (var j = 0; j < 5; j++) for (var i = 0; i < 3; i++) if (g[j * 3 + i] === '1') for (var sy = 0; sy < scale; sy++) for (var sx = 0; sx < scale; sx++) this._plot(cx + i * scale + sx, Math.round(y) + j * scale + sy, rgba); cx += 4 * scale; }, this);
    return this;
  };
  P.textWidth = function (str, scale) { return Math.max(0, String(str).length * 4 * (scale || 1) - (scale || 1)); };
  // post-processing on what's drawn so far
  P.outline = function (c, opts) {
    var rgba = this.color(c), w = this.w, h = this.h, d = this.data, src = new Uint8Array(w * h), diag = opts && opts.corners;
    for (var k = 0; k < w * h; k++) src[k] = d[k * 4 + 3] ? 1 : 0;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { if (src[y * w + x]) continue; var hit = false; for (var dy = -1; dy <= 1 && !hit; dy++) for (var dx = -1; dx <= 1; dx++) { if (!dx && !dy || (!diag && dx && dy)) continue; var xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && src[yy * w + xx]) { hit = true; break; } } if (hit) this._put(x, y, rgba); }
    return this;
  };
  P.replace = function (from, to) { var a = this.color(from), b = this.color(to), d = this.data; for (var i = 0; i < d.length; i += 4) { if (a ? d[i + 3] && d[i] === a[0] && d[i + 1] === a[1] && d[i + 2] === a[2] : !d[i + 3]) { if (b) { d[i] = b[0]; d[i + 1] = b[1]; d[i + 2] = b[2]; d[i + 3] = 255; } else d[i + 3] = 0; } } return this; };
  P.shift = function (dx, dy, wrap) { var w = this.w, h = this.h, s = this.data.slice(), d = this.data; d.fill(0); for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var X = x + dx, Y = y + dy; if (wrap) { X = ((X % w) + w) % w; Y = ((Y % h) + h) % h; } if (X < 0 || Y < 0 || X >= w || Y >= h) continue; var a = (y * w + x) * 4, b = (Y * w + X) * 4; d[b] = s[a]; d[b + 1] = s[a + 1]; d[b + 2] = s[a + 2]; d[b + 3] = s[a + 3]; } return this; };
  P.flip = function (horizontal, vertical) { var w = this.w, h = this.h, s = this.data.slice(), d = this.data; for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var X = horizontal ? w - 1 - x : x, Y = vertical ? h - 1 - y : y, a = (y * w + x) * 4, b = (Y * w + X) * 4; d[b] = s[a]; d[b + 1] = s[a + 1]; d[b + 2] = s[a + 2]; d[b + 3] = s[a + 3]; } return this; };
  // draw another canvas / sprite frame ({w,h,data}) at x,y; opts: { flipX, flipY, scale, tint }
  P.blit = function (img, x, y, opts) {
    opts = opts || {}; var s = Math.max(1, Math.round(opts.scale || 1)), tint = opts.tint !== undefined ? this.color(opts.tint) : null;
    for (var j = 0; j < img.h * s; j++) for (var i = 0; i < img.w * s; i++) { var sx = Math.floor(i / s), sy = Math.floor(j / s); if (opts.flipX) sx = img.w - 1 - sx; if (opts.flipY) sy = img.h - 1 - sy; var k = (sy * img.w + sx) * 4; if (!img.data[k + 3]) continue; this._plot(Math.round(x) + i, Math.round(y) + j, tint || [img.data[k], img.data[k + 1], img.data[k + 2], 255]); }
    return this;
  };
  P.copy = function () { var c = new Canvas(this.w, this.h, this.palette); c.data.set(this.data); return c; };
  P.ramp = function (name, t) { var r = Array.isArray(name) ? name : RAMPS[name]; if (!r) throw new Error('Unknown ramp "' + name + '". Built in: ' + Object.keys(RAMPS).join(', ')); t = Math.max(0, Math.min(0.9999, t)); return r[Math.floor(t * r.length)]; };
  P.toImage = function () { return { w: this.w, h: this.h, data: this.data.slice() }; };

  // ───────── effects
  function compile(code) {
    var captured = null;
    var effect = function (def) { if (captured) throw new Error('Call effect({...}) only once'); captured = def; return def; };
    /* eslint-disable no-new-func */
    var fn = new Function('effect', 'Canvas', 'PALETTES', 'RAMPS', '"use strict";\n' + code + '\n;');
    fn(effect, Canvas, PALETTES, RAMPS);
    if (!captured) throw new Error('The code never called effect({...})');
    return normalize(captured);
  }
  function num(v, d, lo, hi) { v = Number(v); if (!isFinite(v)) v = d; return Math.max(lo, Math.min(hi, v)); }
  function normalize(def) {
    if (typeof def.draw !== 'function') throw new Error('effect({...}) needs a draw(g, ctx) function');
    var size = def.size || [32, 32];
    var w = num(size[0], 32, 1, 512) | 0, h = num(size[1] === undefined ? size[0] : size[1], 32, 1, 512) | 0;
    var n = num(def.frames, 12, 1, 240) | 0, fps = num(def.fps, 12, 1, 60);
    var durations = Array.isArray(def.durations) && def.durations.length ? def.durations.slice(0, n).map(function (d) { return num(d, 1000 / fps, 10, 5000); }) : null;
    if (!durations && Array.isArray(def.holds)) durations = Array.from({ length: n }, function (_, i) { return Math.round(1000 / fps * num(def.holds[i] === undefined ? 1 : def.holds[i], 1, 1, 20)); });
    if (!durations) durations = Array.from({ length: n }, function () { return Math.round(1000 / fps); });
    while (durations.length < n) durations.push(Math.round(1000 / fps));
    var params = {}, paramSpec = {};
    Object.keys(def.params || {}).forEach(function (k) { var p = def.params[k]; if (p && typeof p === 'object' && !Array.isArray(p)) { paramSpec[k] = { value: p.value, min: p.min, max: p.max, step: p.step, label: p.label, options: p.options }; params[k] = p.value; } else { paramSpec[k] = { value: p }; params[k] = p; } });
    return { def: def, name: String(def.name || 'Untitled effect'), w: w, h: h, n: n, fps: fps, durations: durations, palette: resolvePalette(def.palette), loop: def.loop !== false, seed: (def.seed === undefined ? 1 : Number(def.seed)) >>> 0, persist: !!def.persist, background: def.background || null, anchor: def.anchor || null, params: params, paramSpec: paramSpec, tags: def.tags || [], description: def.description || '' };
  }
  // render(code | compiled, { params, seed, frames: [i,...] }) → { meta, frames: [Uint8ClampedArray] }
  function render(code, opts) {
    opts = opts || {};
    var fx = typeof code === 'string' ? compile(code) : code && code.def ? code : normalize(code);
    var params = Object.assign({}, fx.params, opts.params || {});
    var seed = opts.seed === undefined ? fx.seed : Number(opts.seed) >>> 0;
    var rand = mulberry(seed), noise = makeNoise(seed);
    var helpers = {
      rand: rand, rnd: function (a, b) { return a === undefined ? rand() : b === undefined ? rand() * a : a + rand() * (b - a); }, irnd: function (a, b) { return Math.floor(b === undefined ? rand() * a : a + rand() * (b - a + 1)); },
      pick: function (arr) { return arr[Math.floor(rand() * arr.length)]; }, chance: function (p) { return rand() < p; }, noise: noise,
      ease: EASE, lerp: function (a, b, t) { return a + (b - a) * t; }, clamp: function (v, a, b) { return Math.max(a, Math.min(b, v)); },
      smooth: function (a, b, v) { var t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); },
      range: function (t, a, b) { return Math.max(0, Math.min(1, (t - a) / (b - a))); }, pingpong: function (t) { return 1 - Math.abs(1 - 2 * (t % 1)); },
      TAU: Math.PI * 2, PI: Math.PI, bayer: bayer, palette: fx.palette, ramps: RAMPS, params: params, w: fx.w, h: fx.h, n: fx.n, seed: seed, cx: (fx.w - 1) / 2, cy: (fx.h - 1) / 2
    };
    var state = typeof fx.def.setup === 'function' ? fx.def.setup(Object.assign({}, helpers)) : {};
    var g = new Canvas(fx.w, fx.h, fx.palette);
    var want = opts.frames ? opts.frames.reduce(function (o, i) { o[i] = 1; return o; }, {}) : null;
    var frames = [], start = Date.now(), budget = opts.budgetMs || 8000;
    for (var f = 0; f < fx.n; f++) {
      if (!fx.persist) g.clear(); g.symmetry(false, false); g.clip = null;
      var ctx = Object.assign({}, helpers, { f: f, t: fx.n > 1 ? f / (fx.loop ? fx.n : fx.n - 1) : 0, frame: f, state: state, time: f / fx.fps });
      fx.def.draw(g, ctx);
      if (!want || want[f]) frames.push(g.data.slice());
      if (Date.now() - start > budget) throw new Error('The effect took longer than ' + Math.round(budget / 1000) + ' s to draw ' + (f + 1) + ' of ' + fx.n + ' frames. Simplify the per-pixel loops.');
    }
    return { meta: { name: fx.name, w: fx.w, h: fx.h, n: fx.n, fps: fx.fps, durations: fx.durations, palette: fx.palette, loop: fx.loop, seed: seed, params: params, paramSpec: fx.paramSpec, tags: fx.tags, description: fx.description, anchor: fx.anchor, background: fx.background }, frames: frames };
  }

  var API = { Canvas: Canvas, PALETTES: PALETTES, RAMPS: RAMPS, EASE: EASE, hex: hex, toHex: toHex, bayer: bayer, compile: compile, render: render, mulberry: mulberry, makeNoise: makeNoise, resolvePalette: resolvePalette, FONT: FONT };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.DitherFX = API;
})(typeof self !== 'undefined' ? self : this);
