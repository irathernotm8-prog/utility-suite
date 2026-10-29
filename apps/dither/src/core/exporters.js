// Dither — turning frames into files: sprite sheet + JSON, GIF, PNG frames, contact sheets, and standalone JS modules
// for effects (the runtime + the effect's code, pre-rendered at load; no dependencies, no eval).
'use strict';
const fs = require('fs');
const path = require('path');
const png = require('./png');
const gif = require('./gif');
const sheets = require('./sheets');

const RUNTIME_SRC = () => fs.readFileSync(path.join(__dirname, 'fxruntime.js'), 'utf8');
const fileBase = (s) => String(s || 'export').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'export';
const jsName = (s) => String(s || 'effect').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'effect';

function writeSheet(dir, name, frames, w, h, { durations, cols, padding = 0, tags } = {}) {
  const base = fileBase(name); const { img, json } = sheets.spriteSheet(frames, w, h, { cols, padding, durations, name: base, tags });
  const pngFile = path.join(dir, `${base}.png`), jsonFile = path.join(dir, `${base}.json`);
  fs.writeFileSync(pngFile, png.encode(img)); fs.writeFileSync(jsonFile, JSON.stringify(json, null, 1));
  return [pngFile, jsonFile];
}
function writeGif(file, frames, w, h, { durations = [], scale = 4, background = null, loop = true } = {}) {
  fs.writeFileSync(file, gif.encode(frames.map((d, i) => ({ data: d, delay: durations[i] || 83 })), w, h, { scale, background, loop })); return file;
}
function writeFrames(dir, name, frames, w, h, { scale = 1 } = {}) {
  const sub = path.join(dir, fileBase(name)); fs.mkdirSync(sub, { recursive: true }); const out = [];
  frames.forEach((d, i) => { const f = path.join(sub, `${String(i).padStart(3, '0')}.png`); fs.writeFileSync(f, png.encode(scale > 1 ? sheets.scaleImage({ w, h, data: d }, scale) : { w, h, data: d })); out.push(f); });
  return out;
}
function writeContact(file, frames, w, h, opts) { fs.writeFileSync(file, png.encode(sheets.contactSheet(frames, w, h, opts))); return file; }

function effectModule(code, meta) {
  return `// ${meta.name} — a pixel effect made in Dither (${meta.w}×${meta.h}, ${meta.n} frames${meta.loop ? ', loops' : ''}).
// Standalone ES module: no dependencies and no eval. Frames are drawn once when you call createEffect().
//
//   import { createEffect } from './${jsName(meta.name)}.js';
//   const fx = createEffect();                 // or createEffect({ params: { ... }, seed: 3 })
//   // each game frame:  const alive = fx.drawAt(ctx, x, y, msSinceStart, scale);   (one-shots return false when done)
//   //               or:  fx.draw(ctx, x, y, frameIndex, scale);
//   // anchor: drawAt/draw take the top-left corner; use fx.w / fx.h to centre it (x - fx.w * scale / 2).

const DitherFX = (function () { var module = { exports: {} }; var self = {};
${RUNTIME_SRC()}
return module.exports; })();

let DEF = null;
(function (effect, Canvas, PALETTES, RAMPS) {
${code}
})(function (d) { DEF = d; return d; }, DitherFX.Canvas, DitherFX.PALETTES, DitherFX.RAMPS);

export const meta = ${JSON.stringify({ name: meta.name, w: meta.w, h: meta.h, frames: meta.n, durations: meta.durations, loop: meta.loop, params: meta.params })};

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

export function createEffect(opts = {}) {
  const r = DitherFX.render(DEF, opts); const m = r.meta;
  const frames = r.frames.map((d) => { const c = makeCanvas(m.w, m.h); c.getContext('2d').putImageData(new ImageData(d, m.w, m.h), 0, 0); return c; });
  const starts = []; let total = 0; for (const d of m.durations) { starts.push(total); total += d; }
  const frameAt = (ms) => { if (!m.loop && ms >= total) return -1; const t = ((ms % total) + total) % total; let i = 0; while (i + 1 < starts.length && starts[i + 1] <= t) i++; return i; };
  const draw = (ctx, x, y, i = 0, scale = 1) => { const c = frames[((i % frames.length) + frames.length) % frames.length]; ctx.imageSmoothingEnabled = false; ctx.drawImage(c, Math.round(x), Math.round(y), m.w * scale, m.h * scale); };
  return { w: m.w, h: m.h, length: frames.length, durations: m.durations, duration: total, loop: m.loop, frames, pixels: r.frames, frameAt, draw,
    drawAt(ctx, x, y, ms, scale = 1) { const i = frameAt(ms); if (i < 0) return false; draw(ctx, x, y, i, scale); return true; } };
}
export default createEffect;
`;
}
function writeModule(dir, code, meta) { const f = path.join(dir, `${jsName(meta.name)}.js`); fs.writeFileSync(f, effectModule(code, meta)); return f; }

module.exports = { writeSheet, writeGif, writeFrames, writeContact, writeModule, effectModule, fileBase, jsName };
