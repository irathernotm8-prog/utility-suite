// HTML layers: a page of HTML/CSS/JS laid out at its own size (usually the whole design), shown on the canvas as a
// picture of one moment (the "poster") and recorded frame by frame for video. The code lives in o.ro2Html:
//   { html, w, h, animated, duration (s), poster (s) }
import { fabric, uid } from './editor/fab.js';
import { loadImage } from './editor/objects.js';

export const isHtml = (o) => !!(o && o.ro2Html);
export const isVideo = (o) => !!(o && o.ro2Video);
const snapScale = (w, h) => Math.max(1, Math.min(2, 2400 / Math.max(w, h)));

// how a page of HTML behaves (animated? how long?) and a picture of it
export async function renderHtml({ html, w, h, duration, poster }, { scale } = {}) {
  const info = await window.ro2.html.inspect({ html, w, h });
  const animated = !!info.animated;
  const dur = duration > 0 ? +duration : animated ? Math.round(info.durationMs / 100) / 10 || 5 : 0;
  // the picture shown on the canvas: the finished state of an animation (or the moment the user chose)
  const t = poster != null ? +poster : animated ? Math.max(0, dur - 1 / 30) : 0;
  const k = scale || snapScale(w, h);
  const r = await window.ro2.html.render({ html, w, h }, { scale: k, t: t * 1000 });
  return { dataUrl: r.dataUrl, k, animated, duration: dur, poster: t, meta: r.meta, logs: [...(info.logs || []), ...(r.logs || [])].slice(0, 8) };
}

// A new HTML layer at x/y (top-left, design px), w×h CSS px
export async function makeHtml(ed, { html, name, x, y, width, height, duration, poster }) {
  const w = Math.round(width || ed.W), h = Math.round(height || ed.H);
  const r = await renderHtml({ html, w, h, duration, poster });
  const el = await loadImage(r.dataUrl);
  const o = new fabric.FabricImage(el, { ro2Name: name || 'HTML', assetId: ed.addAsset(r.dataUrl) });
  o.set({ scaleX: w / el.naturalWidth, scaleY: h / el.naturalHeight, left: (x ?? (ed.W - w) / 2) + w / 2, top: (y ?? (ed.H - h) / 2) + h / 2 });
  o.ro2Html = { html, w, h, animated: r.animated, duration: r.duration, poster: poster != null ? +poster : null, durationSet: duration > 0 };
  o.id = uid();
  return { o, info: r };
}
// New code / timing for an existing HTML layer; keeps where it sits and how big it shows
export async function updateHtml(ed, o, patch = {}) {
  const cur = o.ro2Html; const next = { ...cur, ...patch };
  const r = await renderHtml({ html: next.html, w: next.w, h: next.h, duration: patch.duration ?? (cur.durationSet ? cur.duration : undefined), poster: next.poster });
  const el = await loadImage(r.dataUrl);
  const shownW = o.getScaledWidth(), shownH = o.getScaledHeight();
  o.setElement(el); o.set({ width: el.naturalWidth, height: el.naturalHeight, cropX: 0, cropY: 0, scaleX: shownW / el.naturalWidth, scaleY: shownH / el.naturalHeight });
  o.assetId = ed.addAsset(r.dataUrl);
  o.ro2Html = { ...next, animated: r.animated, duration: r.duration, durationSet: patch.duration != null || !!cur.durationSet };
  o.dirty = true; o.setCoords(); ed.canvas.requestRenderAll();
  return r;
}
// Before a big export: the HTML layers of a page's objects re-drawn sharp at that size (json objects, in place)
export async function sharpenHtml(objs, scale) {
  for (const j of objs) {
    if (j.ro2Html) {
      const need = (j.width * Math.abs(j.scaleX || 1) * scale) / j.ro2Html.w; // px per CSS px
      if (need <= (j.width / j.ro2Html.w) * 1.05) continue;
      const r = await window.ro2.html.render({ html: j.ro2Html.html, w: j.ro2Html.w, h: j.ro2Html.h }, { scale: Math.min(6, need), t: (j.ro2Html.poster ?? (j.ro2Html.animated ? Math.max(0, j.ro2Html.duration - 1 / 30) : 0)) * 1000 });
      const shownW = j.width * (j.scaleX || 1), shownH = j.height * (j.scaleY || 1);
      j.src = r.dataUrl; j.width = r.w; j.height = r.h; j.scaleX = (shownW / r.w) * Math.sign(j.scaleX || 1); j.scaleY = (shownH / r.h) * Math.sign(j.scaleY || 1); j.cropX = 0; j.cropY = 0;
    }
    if (j.objects) await sharpenHtml(j.objects, scale);
  }
  return objs;
}

// Starter code for a new layer at w×h
export function starterHtml(w, h, brand) {
  const c = (brand && brand.colors) || []; const bg = c[0] || '#0f172a', accent = c[1] || '#46e6a2';
  const head = (brand && brand.fonts && brand.fonts.heading && brand.fonts.heading.family) || 'Poppins', body = (brand && brand.fonts && brand.fonts.body && brand.fonts.body.family) || 'Inter';
  const u = Math.min(w, h) / 1080;
  return `<html data-duration="5">
<style>
  .page { position: absolute; inset: 0; background: ${bg}; color: #fff; display: grid; place-content: center; text-align: center; padding: ${Math.round(80 * u)}px; font-family: "${body}"; }
  h1 { font: 800 ${Math.round(120 * u)}px/1.02 "${head}"; margin: 0 0 ${Math.round(28 * u)}px; letter-spacing: -0.02em; }
  p { font-size: ${Math.round(40 * u)}px; margin: 0; opacity: .8; }
  .accent { color: ${accent}; }
  /* animations play when you export a video or GIF */
  h1, p { animation: rise 1s cubic-bezier(.2,.7,.2,1) both; }
  p { animation-delay: .35s; }
  @keyframes rise { from { opacity: 0; transform: translateY(${Math.round(40 * u)}px); } }
</style>
<div class="page">
  <h1>Your <span class="accent">headline</span> here</h1>
  <p>Write HTML and CSS at ${w} × ${h} px. It becomes a layer.</p>
</div>
</html>`;
}
