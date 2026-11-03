// Dither — scenes in a project: resolves each layer (a sprite frame, or a terrain grid painted with a tileset sprite)
// into a picture and renders the scene for a camera position, or as a panning animation for previews and GIFs.
'use strict';
const SP = require('./sprite');
const TL = require('./tiles');

// a tileset sprite carries { tileset: { tile, kind, cols, masks } } and its sheet in frame 0
function tilesetOf(s) { if (!s.tileset) throw new Error(`“${s.name}” isn’t a tileset. Make one with make_tileset (or Tiles › New tileset).`); const t = s.tileset; const index = {}; t.masks.forEach((m, i) => (index[m] = i)); return { ...t, index, sheet: { w: s.w, h: s.h, data: SP.compose(s, 0) }, count: t.masks.length }; }

function layerImage(proj, l, ms = 0, cache = new Map()) {
  if (l.kind === 'tiles') {
    const k = `t:${l.tileset}:${(l.rows || []).join('|')}`; if (cache.has(k)) return cache.get(k);
    const ts = tilesetOf(proj.getSprite(l.tileset)); const img = TL.renderMap(ts, l.rows && l.rows.length ? l.rows : ['#'], { edges: l.edges || 'open' }).img; cache.set(k, img); return img;
  }
  const s = cache.get('s:' + l.sprite) || proj.getSprite(l.sprite); cache.set('s:' + l.sprite, s);
  let fi = l.frame || 0; if (l.animate && s.frames.length > 1) { const total = s.frames.reduce((a, f) => a + f.duration, 0); let t = ms % total; fi = 0; for (let i = 0; i < s.frames.length; i++) { if (t < s.frames[i].duration) { fi = i; break; } t -= s.frames[i].duration; } }
  const k = `f:${l.sprite}:${fi}`; if (!cache.has(k)) cache.set(k, { w: s.w, h: s.h, data: SP.compose(s, Math.min(fi, s.frames.length - 1)) }); return cache.get(k);
}
function render(proj, sc, { camX = 0, camY = 0, ms = 0, cache } = {}) {
  cache = cache || new Map(); const layers = sc.layers.filter((l) => l.visible !== false).map((l) => ({ ...l, image: layerImage(proj, l, ms, cache) }));
  return TL.renderScene(sc, layers, camX, camY);
}
// a pan across the scene: frames for a preview / GIF
function pan(proj, sc, { frames = 24, fps = 12, from = 0, to } = {}) {
  const end = to ?? Math.max(0, (sc.length || sc.w * 2) - sc.w); const cache = new Map(); const out = [];
  for (let i = 0; i < frames; i++) out.push(render(proj, sc, { camX: from + (end - from) * (frames > 1 ? i / (frames - 1) : 0), ms: (i * 1000) / fps, cache }).data);
  return { frames: out, w: sc.w, h: sc.h, durations: out.map(() => Math.round(1000 / fps)) };
}
function blankScene({ name = 'Scene', w = 320, h = 180, background = '#1a1c2c', length } = {}) { return { name, w: Math.max(16, Math.min(1920, w | 0)), h: Math.max(16, Math.min(1080, h | 0)), background, length: length || w * 2, layers: [] }; }

module.exports = { tilesetOf, layerImage, render, pan, blankScene };
