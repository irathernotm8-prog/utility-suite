// Designs as video: each page is a scene. Still layers are flattened into pictures (one per run between moving
// layers); HTML layers that animate and video clips stay live and are recorded by the main process (src/video.js).
import { fabric } from './editor/fab.js';
import { ensureFontsFor } from './fonts.js';
import { sharpenHtml } from './html-layer.js';

export const TRANSITIONS = [
  ['none', 'Cut'], ['fade', 'Fade'], ['fadeblack', 'Fade to black'], ['fadewhite', 'Fade to white'], ['dissolve', 'Dissolve'],
  ['slideleft', 'Slide left'], ['slideright', 'Slide right'], ['slideup', 'Slide up'], ['slidedown', 'Slide down'],
  ['smoothleft', 'Smooth left'], ['smoothup', 'Smooth up'], ['wipeleft', 'Wipe left'], ['wiperight', 'Wipe right'], ['wipeup', 'Wipe up'],
  ['circleopen', 'Circle open'], ['circleclose', 'Circle close'], ['radial', 'Radial'], ['zoomin', 'Zoom in'], ['pixelize', 'Pixelate'], ['hblur', 'Blur'],
];
const pageOf = (ed, i) => (i === ed.page ? { ...ed.pageData, ...ed.pageSnapshot() } : ed.doc.pages[i]);
const moving = (j) => (j.ro2Html && j.ro2Html.animated) || j.ro2Video;
const walk = (objs, fn) => { for (const j of objs || []) { fn(j); if (j.objects) walk(j.objects, fn); } };

// How long a page plays: what the user set, else its longest moving layer, else 3 s
export function pageDuration(ed, i) {
  const p = pageOf(ed, i); if (p.duration > 0) return +p.duration;
  let d = 0; walk(p.objects, (j) => { if (j.visible === false) return; if (j.ro2Html && j.ro2Html.animated) d = Math.max(d, +j.ro2Html.duration || 5); if (j.ro2Video) d = Math.max(d, (j.ro2Video.out ?? j.ro2Video.duration) - (j.ro2Video.in || 0)); });
  return Math.round((d || 3) * 10) / 10;
}
export const isMovingPage = (ed, i) => (pageOf(ed, i).objects || []).some((j) => j.visible !== false && moving(j));
export const designMoves = (ed) => ed.doc.pages.some((_, i) => isMovingPage(ed, i)) || !!(ed.doc.timeline && ed.doc.timeline.music);
export const totalDuration = (ed) => ed.doc.pages.reduce((a, _, i) => a + pageDuration(ed, i) - (i > 0 ? transitionOf(ed, i).duration : 0), 0);
export function transitionOf(ed, i) { const t = pageOf(ed, i).transition || {}; const d = pageDuration(ed, i); return { type: t.type || 'none', duration: !t.type || t.type === 'none' ? 0 : Math.min(+t.duration || 0.6, d / 2) }; }

// a set of serialized objects drawn on their own at scale, see-through where empty
async function drawRun(ed, objs, { bg, scale }) {
  const W = Math.round(ed.W * scale), H = Math.round(ed.H * scale);
  const el = document.createElement('canvas');
  const sc = new fabric.StaticCanvas(el, { width: ed.W, height: ed.H, enableRetinaScaling: false, renderOnAddRemove: false });
  const json = await sharpenHtml(ed.resolveAssets(objs), scale); await ensureFontsFor(json);
  const live = await fabric.util.enlivenObjects(json);
  if (bg) sc.add(ed.makeBgObject(bg));
  sc.add(...live.filter((o) => o.visible !== false));
  const out = sc.toCanvasElement(scale); sc.dispose();
  const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(out, 0, 0, W, H);
  return c.toDataURL('image/png').split(',')[1];
}
function geometry(j, scale) {
  const o = { cx: j.left * scale, cy: j.top * scale, width: Math.abs(j.width * (j.scaleX || 1)) * scale, height: Math.abs(j.height * (j.scaleY || 1)) * scale, angle: j.angle || 0, opacity: j.opacity ?? 1 };
  if (j.originX && j.originX !== 'center') { o.cx += (o.width / 2) * (j.originX === 'left' ? 1 : -1); }
  if (j.originY && j.originY !== 'center') { o.cy += (o.height / 2) * (j.originY === 'top' ? 1 : -1); }
  return o;
}
// One page → layers for src/video.js
async function pageLayers(ed, i, scale) {
  const p = pageOf(ed, i); const objs = (p.objects || []).filter((j) => j.visible !== false); const layers = []; let run = []; let first = true;
  const flush = async (force) => { if (!run.length && !(first && force)) return; layers.push({ kind: 'png', data: await drawRun(ed, run, { bg: first ? p.bg || { color: '#ffffff' } : null, scale }) }); run = []; first = false; };
  for (const j of objs) {
    if (!moving(j)) { run.push(j); continue; }
    await flush(true);
    if (j.ro2Html) { const key = await window.ro2.html.register({ html: j.ro2Html.html, w: j.ro2Html.w, h: j.ro2Html.h }); layers.push({ kind: 'html', key, w: j.ro2Html.w, h: j.ro2Html.h, ...geometry(j, scale) }); }
    else { const v = j.ro2Video; layers.push({ kind: 'video', path: v.path, in: v.in || 0, out: v.out ?? v.duration, hasAudio: !!v.hasAudio, muted: !!v.muted, volume: v.volume ?? 1, ...geometry(j, scale) }); }
  }
  await flush(first);
  return layers;
}

// The whole spec for the main process
export async function videoSpec(ed, { pages, scale = 1, fps, output, quality, transparent, gif, preview, onStep } = {}) {
  const tl = ed.doc.timeline || {}; ed.syncPage();
  const idx = pages || ed.doc.pages.map((_, i) => i); const out = [];
  for (const [k, i] of idx.entries()) {
    onStep && onStep(k / idx.length, `Preparing page ${i + 1}`);
    out.push({ duration: pageDuration(ed, i), transition: k > 0 ? transitionOf(ed, i) : undefined, layers: await pageLayers(ed, i, scale) });
  }
  return { W: Math.round(ed.W * scale), H: Math.round(ed.H * scale), fps: fps || tl.fps || 30, output, quality: quality || 'high', transparent: !!transparent, gif, preview: !!preview, pages: out,
    music: tl.music ? { path: tl.music.path, volume: tl.music.volume ?? 0.8, fadeIn: tl.music.fadeIn ?? 0, fadeOut: tl.music.fadeOut ?? 1.5, in: tl.music.in || 0 } : null };
}

// Run an export, reporting progress through onProgress(0..1, text). Returns { output, bytes, duration }.
export async function exportVideo(ed, opts, onProgress = () => {}) {
  const jobId = 'v' + Date.now().toString(36);
  const spec = await videoSpec(ed, { ...opts, onStep: (p, t) => onProgress(p * 0.08, t) });
  const off = window.ro2.video.onProgress(({ jobId: j, p }) => { if (j === jobId) onProgress(0.08 + p * 0.92, 'Recording the video…'); });
  try { return await window.ro2.video.export(jobId, spec); } finally { off(); }
}
// A quick low-res preview file for the timeline player
export async function previewVideo(ed, { pages } = {}, onProgress) {
  const output = await window.ro2.video.previewPath();
  const scale = Math.min(1, 640 / Math.max(ed.W, ed.H));
  return exportVideo(ed, { pages, scale, output, quality: 'small', preview: true, fps: Math.min(30, (ed.doc.timeline || {}).fps || 30) }, onProgress);
}
