// Mural — the wallpaper format. One folder per wallpaper with a mural.json (plus any pictures, videos, shaders or web
// pages it uses). This file describes every scene layer and its settings once: the runtime fills in defaults from it,
// the Studio builds its property panels from it, and the main process checks manifests with it.
//
// mural.json
//   { "format": 1, "name": "Snowfall", "type": "scene" | "shader" | "video" | "image" | "web", "author": "", "tags": [],
//     "scene":  { "layers": [ … ], "effects": { "click": "ripple", "cursorGlow": null } }   // scene, and the overlay on video/image
//     "shader": "main.frag" | "code": "…glsl…", "params": [{ "name", "value", "min", "max" }…]          // shader
//     "src": "clip.mp4", "fit": "cover", "speed": 1                                                      // video / image
//     "page": "index.html", "interactive": { "cursor": true, "click": true }                              // web
//     "quality": { "fps": 30, "scale": 1 } }                                                            // hints (user limits win)

export const TYPES = ['scene', 'shader', 'video', 'image', 'web'];
export const PHASES = ['night', 'dawn', 'day', 'dusk'];
export const BLENDS = ['source-over', 'screen', 'lighter', 'multiply', 'overlay', 'soft-light', 'color-dodge'];

const range = (key, label, min, max, step, def, extra = {}) => ({ key, label, type: 'range', min, max, step, default: def, ...extra });
const color = (key, label, def) => ({ key, label, type: 'color', default: def });
const select = (key, label, options, def) => ({ key, label, type: 'select', options, default: def });
const toggle = (key, label, def) => ({ key, label, type: 'toggle', default: def });
const text = (key, label, def, extra = {}) => ({ key, label, type: 'text', default: def, ...extra });
const file = (key, label, accept) => ({ key, label, type: 'file', accept, default: '' });

const BOX = [range('x', 'Left', -0.5, 1.5, 0.005, 0), range('y', 'Top', -0.5, 1.5, 0.005, 0), range('w', 'Width', 0, 2, 0.005, 1), range('h', 'Height', 0, 2, 0.005, 1)];

/** Every layer kind: label, what it's for, its own fields, and whether it moves on its own. */
export const KINDS = {
  sky: { label: 'Sky', hint: 'A sky that follows the sun: dawn, day, dusk and night colors, with a sun and moon.', animated: false, fields: [
    color('nightTop', 'Night top', '#050816'), color('nightBottom', 'Night bottom', '#1a2140'),
    color('dawnTop', 'Dawn top', '#3b4a8c'), color('dawnBottom', 'Dawn bottom', '#ff9f7a'),
    color('dayTop', 'Day top', '#3d8bff'), color('dayBottom', 'Day bottom', '#bfe3ff'),
    color('duskTop', 'Dusk top', '#2b1e5c'), color('duskBottom', 'Dusk bottom', '#ff7a59'),
    toggle('sun', 'Sun', true), toggle('moon', 'Moon', true), range('sunSize', 'Sun size', 0.01, 0.12, 0.005, 0.045), range('horizon', 'Horizon', 0.3, 1, 0.01, 0.72)
  ] },
  gradient: { label: 'Gradient', hint: 'A smooth color blend.', animated: false, fields: [
    color('from', 'From', '#141b2d'), color('to', 'To', '#3a2d5c'), color('via', 'Middle (optional)', ''), range('angle', 'Angle', 0, 360, 1, 180),
    select('style', 'Style', ['linear', 'radial'], 'linear')
  ] },
  image: { label: 'Picture', hint: 'A photo or drawing. Give it depth to make it shift with the cursor.', animated: false, fields: [
    file('src', 'Picture', 'image'), select('fit', 'Fit', ['cover', 'contain', 'stretch'], 'cover'), ...BOX
  ] },
  video: { label: 'Video', hint: 'A looping clip, decoded by the graphics chip.', animated: true, fields: [
    file('src', 'Video', 'video'), select('fit', 'Fit', ['cover', 'contain', 'stretch'], 'cover'), range('speed', 'Speed', 0.25, 2, 0.05, 1), ...BOX
  ] },
  hills: { label: 'Landscape', hint: 'Hills, mountains, dunes or a city skyline, drawn for you.', animated: false, fields: [
    select('style', 'Style', ['hills', 'mountains', 'dunes', 'skyline', 'forest'], 'hills'), color('color', 'Color', '#1d2a44'),
    color('nightColor', 'Color at night (optional)', ''), range('base', 'Height', 0.1, 1, 0.005, 0.7), range('rough', 'Roughness', 0, 1, 0.01, 0.5),
    range('seed', 'Shape', 1, 999, 1, 7), color('lights', 'Window lights (skyline)', '#ffd27a'), range('lightsOn', 'Lights on', 0, 1, 0.01, 0.35)
  ] },
  waves: { label: 'Waves', hint: 'Rolling water lines.', animated: true, fields: [
    color('color', 'Color', '#1b3b6f'), color('crest', 'Crest', '#7fb6ff'), range('y', 'Water line', 0, 1, 0.005, 0.72), range('amp', 'Height', 0, 0.1, 0.001, 0.02),
    range('count', 'Rows', 1, 8, 1, 4), range('speed', 'Speed', 0, 3, 0.05, 1)
  ] },
  particles: { label: 'Particles', hint: 'Snow, rain, fireflies, stars and more, that can dodge or follow the cursor.', animated: true, fields: [
    select('preset', 'Kind', ['snow', 'rain', 'fireflies', 'stars', 'bokeh', 'dust', 'petals', 'bubbles', 'embers'], 'snow'),
    range('count', 'Amount', 10, 1500, 10, 220), color('color', 'Color', '#ffffff'), range('size', 'Size', 0.2, 4, 0.05, 1), range('speed', 'Speed', 0, 4, 0.05, 1),
    range('wind', 'Wind', -2, 2, 0.05, 0), select('cursor', 'Cursor', ['none', 'repel', 'attract'], 'repel'), toggle('clickBurst', 'Burst on click', true),
    range('top', 'Area top', 0, 1, 0.01, 0), range('bottom', 'Area bottom', 0, 1, 0.01, 1)
  ] },
  glow: { label: 'Glow', hint: 'A soft light. Can follow the cursor.', animated: false, fields: [
    color('color', 'Color', '#ffb86b'), range('x', 'Left', 0, 1, 0.005, 0.5), range('y', 'Top', 0, 1, 0.005, 0.5), range('r', 'Size', 0.01, 1.5, 0.005, 0.25),
    range('strength', 'Strength', 0, 1, 0.01, 0.6), toggle('follow', 'Follow the cursor', false), toggle('sun', 'Ride with the sun', false)
  ] },
  text: { label: 'Text & clock', hint: 'Words, or a live clock: {time}, {time24}, {seconds}, {date}, {day}, {greeting}.', animated: false, fields: [
    text('text', 'Text', '{time}'), select('font', 'Font', ['system', 'rounded', 'serif', 'mono', 'condensed'], 'system'), range('size', 'Size', 0.01, 0.4, 0.005, 0.09),
    range('weight', 'Weight', 100, 900, 100, 300), color('color', 'Color', '#ffffff'), range('x', 'Left', 0, 1, 0.005, 0.5), range('y', 'Top', 0, 1, 0.005, 0.42),
    select('align', 'Align', ['left', 'center', 'right'], 'center'), range('spacing', 'Letter spacing', -0.1, 0.5, 0.01, 0), toggle('shadow', 'Soft shadow', true)
  ] },
  shape: { label: 'Shape', hint: 'A circle, ring or rounded box.', animated: false, fields: [
    select('shape', 'Shape', ['circle', 'ring', 'box'], 'circle'), color('fill', 'Color', '#ffffff'), range('x', 'Left', 0, 1, 0.005, 0.4), range('y', 'Top', 0, 1, 0.005, 0.4),
    range('w', 'Width', 0, 1, 0.005, 0.2), range('h', 'Height', 0, 1, 0.005, 0.2), range('radius', 'Corner', 0, 0.5, 0.005, 0.04), range('line', 'Ring width', 0.001, 0.1, 0.001, 0.01)
  ] }
};

/** Fields every layer has. */
export const COMMON = [
  range('opacity', 'Opacity', 0, 1, 0.01, 1), select('blend', 'Blend', BLENDS, 'source-over'),
  range('depth', 'Depth (moves with cursor)', 0, 1, 0.01, 0),
  select('motion', 'Motion', ['none', 'drift', 'float', 'sway', 'pulse', 'spin'], 'none'), range('motionSpeed', 'Motion speed', 0, 3, 0.05, 1), range('motionAmount', 'Motion amount', 0, 1, 0.01, 0.3)
];

export const EFFECTS = [
  select('click', 'On click', ['none', 'ripple', 'sparkle', 'shockwave'], 'ripple'), color('clickColor', 'Click color', '#ffffff'),
  toggle('cursorGlow', 'Light under the cursor', false), color('cursorColor', 'Cursor light', '#8fb7ff')
];

let seq = 0;
export const newId = () => 'l' + Date.now().toString(36).slice(-4) + (++seq).toString(36);

/** A layer of a kind with every default filled in. */
export function makeLayer(kind, over = {}) {
  const k = KINDS[kind]; if (!k) throw new Error('Unknown layer kind: ' + kind);
  const l = { id: newId(), kind, name: k.label, hidden: false, when: null };
  for (const f of [...k.fields, ...COMMON]) l[f.key] = f.default;
  return Object.assign(l, over);
}

/** Fill in missing settings (older or hand-written files), drop unknown kinds. Never throws. */
export function normalizeScene(scene) {
  const s = scene && typeof scene === 'object' ? scene : {};
  const layers = (Array.isArray(s.layers) ? s.layers : []).filter((l) => l && KINDS[l.kind]).map((l) => {
    const out = makeLayer(l.kind); for (const [k, v] of Object.entries(l)) if (v !== undefined) out[k] = v; if (!l.id) out.id = newId(); return out;
  });
  const effects = {}; for (const f of EFFECTS) effects[f.key] = f.default;
  Object.assign(effects, s.effects || {});
  return { layers, effects };
}

export function normalizeManifest(m) {
  const o = m && typeof m === 'object' ? { ...m } : {};
  o.format = 1;
  o.type = TYPES.includes(o.type) ? o.type : 'scene';
  o.name = String(o.name || 'Untitled').slice(0, 80);
  o.tags = Array.isArray(o.tags) ? o.tags.map(String).slice(0, 12) : [];
  if (o.type === 'scene' || o.scene) o.scene = normalizeScene(o.scene);
  if (o.type === 'shader') { o.params = Array.isArray(o.params) ? o.params.slice(0, 4) : []; }
  if (o.type === 'video' || o.type === 'image') { o.fit = o.fit || 'cover'; o.speed = Number(o.speed) || 1; }
  o.quality = { fps: 30, scale: 1, ...(o.quality || {}) };
  return o;
}

/** What a wallpaper reacts to and whether it moves on its own — decides what Mural has to watch and how often to draw. */
export function traits(m) {
  const t = { cursor: false, click: false, animated: false, timeOfDay: false, video: false };
  if (!m) return t;
  if (m.type === 'shader') {
    const src = String(m.code || '');
    t.animated = true; t.cursor = /iMouse|iPointer/.test(src) || !!m.cursor; t.click = /iClick/.test(src) || !!m.click; t.timeOfDay = /iDaylight|iPhase/.test(src);
    if (!src && m.shader) { t.cursor = m.cursor !== false; t.click = m.click !== false; } // file not read yet: assume it does
  }
  if (m.type === 'web') { t.animated = true; t.cursor = !!(m.interactive && m.interactive.cursor); t.click = !!(m.interactive && m.interactive.click); }
  if (m.type === 'video') { t.animated = true; t.video = true; }
  const sc = m.scene;
  if (sc && Array.isArray(sc.layers)) {
    for (const l of sc.layers) {
      if (l.hidden) continue;
      const k = KINDS[l.kind]; if (!k) continue;
      if (k.animated || (l.motion && l.motion !== 'none')) t.animated = true;
      if (l.kind === 'video') t.video = true;
      if (l.depth > 0) t.cursor = true;
      if (l.kind === 'glow' && l.follow) t.cursor = true;
      if (l.kind === 'glow' && l.sun) t.timeOfDay = true;
      if (l.kind === 'particles' && l.cursor && l.cursor !== 'none') t.cursor = true;
      if (l.kind === 'particles' && l.clickBurst) t.click = true;
      if (l.kind === 'sky' || (l.when && PHASES.some((p) => l.when[p] != null && l.when[p] !== 1)) || (l.kind === 'hills' && l.nightColor)) t.timeOfDay = true;
      if (l.kind === 'text' && /\{seconds\}/.test(l.text || '')) t.animated = true;
    }
    const e = sc.effects || {};
    if (e.click && e.click !== 'none') t.click = true;
    if (e.cursorGlow) t.cursor = true;
  }
  return t;
}
