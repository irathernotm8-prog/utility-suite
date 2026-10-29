// Dither — composing frames: contact sheets (what Claude looks at), sprite sheets + JSON (what games load),
// scaling and backgrounds. Frames are RGBA Uint8ClampedArrays of w×h.
'use strict';
const FX = require('./fxruntime');

const BG = { dark: [22, 20, 30], light: [236, 234, 242], checker: null, black: [0, 0, 0], game: [30, 36, 52] };

function blank(w, h, rgb) { const d = new Uint8ClampedArray(w * h * 4); if (rgb) for (let i = 0; i < d.length; i += 4) { d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255; } return { w, h, data: d }; }
function checker(img, x0, y0, w, h, size, a = [44, 41, 56], b = [36, 33, 46]) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = ((Math.floor(x / size) + Math.floor(y / size)) & 1) ? a : b; const i = ((y0 + y) * img.w + x0 + x) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255; }
}
// draw src (w×h RGBA) into dst at x,y scaled by s (nearest), alpha over
function put(dst, src, sw, sh, x0, y0, s = 1) {
  for (let y = 0; y < sh * s; y++) {
    const dy = y0 + y; if (dy < 0 || dy >= dst.h) continue;
    for (let x = 0; x < sw * s; x++) {
      const dx = x0 + x; if (dx < 0 || dx >= dst.w) continue;
      const si = (((y / s) | 0) * sw + ((x / s) | 0)) * 4, a = src[si + 3]; if (!a) continue;
      const di = (dy * dst.w + dx) * 4;
      if (a === 255) { dst.data[di] = src[si]; dst.data[di + 1] = src[si + 1]; dst.data[di + 2] = src[si + 2]; dst.data[di + 3] = 255; }
      else { const t = a / 255; dst.data[di] = src[si] * t + dst.data[di] * (1 - t); dst.data[di + 1] = src[si + 1] * t + dst.data[di + 1] * (1 - t); dst.data[di + 2] = src[si + 2] * t + dst.data[di + 2] * (1 - t); dst.data[di + 3] = Math.max(dst.data[di + 3], a); }
    }
  }
}
function label(dst, text, x, y, rgb, scale = 1) {
  const c = new FX.Canvas(Math.max(1, text.length * 4 * scale), 5 * scale, ['#ffffff']);
  c.text(text, 0, 0, rgb ? FX.toHex(rgb) : '#ffffff', scale);
  put(dst, c.data, c.w, c.h, x, y, 1);
}
// pick a scale so the sheet stays legible but not huge (max ~1400px wide)
function autoScale(w, h, n, maxW = 1400) { const cols = Math.min(n, Math.max(1, Math.ceil(Math.sqrt(n * 1.6)))); let s = Math.max(1, Math.min(8, Math.floor(Math.min(maxW / cols / (w + 4), 600 / h)))); return { s, cols }; }

// Contact sheet: every frame side by side, numbered, on a dark backdrop, plus a strip header with the name.
function contactSheet(frames, w, h, { title = '', scale, cols, bg = 'checker', durations, maxW } = {}) {
  const n = frames.length; const a = autoScale(w, h, n, maxW);
  const s = scale || a.s, C = cols || a.cols, R = Math.ceil(n / C);
  const pad = Math.max(6, 2 * s), lab = 9, head = title ? 18 : 4;
  const W = C * (w * s + pad) + pad, H = head + R * (h * s + pad + lab) + pad;
  const img = blank(W, H, [16, 14, 22]);
  if (title) label(img, title.slice(0, Math.floor((W - 12) / 8)), pad, 6, [230, 226, 240], 2 > W / 300 ? 1 : 2);
  frames.forEach((f, i) => {
    const cx = pad + (i % C) * (w * s + pad), cy = head + Math.floor(i / C) * (h * s + pad + lab) + lab;
    if (bg === 'checker') checker(img, cx, cy, w * s, h * s, Math.max(2, s * 2));
    else { const rgb = Array.isArray(bg) ? bg : BG[bg] || BG.dark; for (let y = 0; y < h * s; y++) for (let x = 0; x < w * s; x++) { const k = ((cy + y) * W + cx + x) * 4; img.data[k] = rgb[0]; img.data[k + 1] = rgb[1]; img.data[k + 2] = rgb[2]; img.data[k + 3] = 255; } }
    put(img, f, w, h, cx, cy, s);
    label(img, String(i + 1) + (durations && durations[i] && durations[i] !== durations[0] ? ` ${durations[i]}MS` : ''), cx, cy - 7, [140, 134, 160]);
  });
  return img;
}

// Several animations in one picture (a drafts board for Claude): each row = one draft's frames.
function boardSheet(items, { maxFrames = 8, maxW = 1500 } = {}) {
  const rows = items.map((it) => { const n = it.frames.length; const k = Math.min(maxFrames, n); const pick = Array.from({ length: k }, (_, i) => it.frames[Math.round(i * (n - 1) / Math.max(1, k - 1))]); return { ...it, pick }; });
  const maxCellW = Math.max(...rows.map((r) => r.w)), maxCellH = Math.max(...rows.map((r) => r.h));
  const s = Math.max(1, Math.min(6, Math.floor(Math.min((maxW - 40) / (maxFrames * (maxCellW + 3)), 220 / maxCellH))));
  const pad = 6;
  const W = Math.max(...rows.map((r) => r.pick.length * (r.w * s + pad) + pad), 320); const ls = W > 700 ? 2 : 1, lab = 7 * ls + 5;
  const H = rows.reduce((t, r) => t + lab + r.h * s + pad * 2, pad);
  const img = blank(W, H, [16, 14, 22]); let y = pad;
  for (const r of rows) {
    label(img, `${r.label || ''}`.slice(0, Math.floor(W / (4 * ls)) - 2), pad, y + 2, [230, 226, 240], ls);
    y += lab;
    r.pick.forEach((f, i) => { const x = pad + i * (r.w * s + pad); checker(img, x, y, r.w * s, r.h * s, Math.max(2, s * 2)); put(img, f, r.w, r.h, x, y, s); });
    y += r.h * s + pad * 2;
  }
  return img;
}

// Sprite sheet + Aseprite-style JSON (array form; Phaser, Godot importers, PixiJS and most engines read it)
function spriteSheet(frames, w, h, { cols, padding = 0, durations = [], name = 'sprite', tags = [] } = {}) {
  const n = frames.length; const C = cols || n; const R = Math.ceil(n / C);
  const W = C * (w + padding) - padding, H = R * (h + padding) - padding;
  const img = blank(Math.max(1, W), Math.max(1, H));
  const out = [];
  frames.forEach((f, i) => { const x = (i % C) * (w + padding), y = Math.floor(i / C) * (h + padding); put(img, f, w, h, x, y, 1); out.push({ filename: `${name} ${i}`, frame: { x, y, w, h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w, h }, sourceSize: { w, h }, duration: Math.round(durations[i] || 100) }); });
  const json = { frames: out, meta: { app: 'Dither', version: '1', image: `${name}.png`, format: 'RGBA8888', size: { w: img.w, h: img.h }, scale: '1', frameTags: tags.length ? tags : [{ name, from: 0, to: n - 1, direction: 'forward' }] } };
  return { img, json };
}

function scaleImage(img, s) { const out = blank(img.w * s, img.h * s); put(out, img.data, img.w, img.h, 0, 0, s); return out; }
function onBackground(frame, w, h, bg) { const out = blank(w, h, Array.isArray(bg) ? bg : FX.hex(bg)); put(out, frame, w, h, 0, 0, 1); return out.data; }

function colorsUsed(frames) { const m = new Map(); for (const f of frames) for (let i = 0; i < f.length; i += 4) if (f[i + 3]) { const k = FX.toHex([f[i], f[i + 1], f[i + 2]]); m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ color: c, pixels: n })); }
function bounds(frames, w, h) { let x0 = w, y0 = h, x1 = -1, y1 = -1; for (const f of frames) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (f[(y * w + x) * 4 + 3]) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }; }

module.exports = { contactSheet, boardSheet, spriteSheet, scaleImage, onBackground, colorsUsed, bounds, blank, put, label, checker, BG };
