// Video clips on a page: shown as their first frame (the poster), played when the design is exported as a video.
// o.ro2Video = { path, name, in, out, duration, hasAudio, muted, volume, w, h }
import { fabric, uid } from './editor/fab.js';
import { loadImage } from './editor/objects.js';
import { h, modal, btn, toast, toastErr, toggle, slider } from './ui.js';

export async function addVideoLayer(ed, info, { x, y, width, height, start = 0, end, muted = false, name } = {}) {
  const el = await loadImage(info.poster || (await window.ro2.media.poster(info.path, start)));
  const o = new fabric.FabricImage(el, { ro2Name: name || info.name || 'Video', assetId: ed.addAsset(el.src) });
  const nw = el.naturalWidth, nh = el.naturalHeight;
  let w = width, hh = height;
  if (!w && !hh) { const k = Math.min(ed.W / nw, ed.H / nh); w = nw * k; hh = nh * k; } else if (!w) w = (hh * nw) / nh; else if (!hh) hh = (w * nh) / nw;
  o.set({ scaleX: w / nw, scaleY: hh / nh, left: (x ?? (ed.W - w) / 2) + w / 2, top: (y ?? (ed.H - hh) / 2) + hh / 2 });
  o.ro2Video = { path: info.path, name: info.name, in: start, out: end != null ? Math.min(end, info.duration) : info.duration, duration: info.duration, hasAudio: !!info.hasAudio, muted, volume: 1, w: info.width, h: info.height };
  o.id = uid();
  return o;
}
export async function pickVideo(ed) {
  try { const info = await window.ro2.media.pick('video'); if (!info) return; const o = await addVideoLayer(ed, info); ed.add(o); toast('Video added. It plays when you export the design as a video.'); return o; } catch (e) { toastErr(e); }
}
// Trim: in / out points with the clip playing
export async function openTrim(ed, o) {
  const v = o.ro2Video; const src = await window.ro2.media.url(v.path);
  let a = v.in || 0, b = v.out ?? v.duration;
  const vid = h('video', { src, controls: true, muted: true, style: { width: '100%', maxHeight: '46vh', borderRadius: '10px', background: '#000' } });
  vid.addEventListener('loadedmetadata', () => { vid.currentTime = a; });
  vid.addEventListener('timeupdate', () => { if (vid.currentTime > b) { vid.currentTime = a; } });
  const lab = h('div.small.muted');
  const show = () => { lab.textContent = `Plays ${a.toFixed(1)} s → ${b.toFixed(1)} s (${(b - a).toFixed(1)} s of ${v.duration.toFixed(1)} s)`; };
  const s1 = slider('Start', { min: 0, max: v.duration, step: 0.05, value: a, fmt: (x) => (+x).toFixed(2) + ' s', onInput: (x) => { a = Math.min(+x, b - 0.1); vid.currentTime = a; show(); } });
  const s2 = slider('End', { min: 0, max: v.duration, step: 0.05, value: b, fmt: (x) => (+x).toFixed(2) + ' s', onInput: (x) => { b = Math.max(+x, a + 0.1); vid.currentTime = Math.max(a, b - 0.5); show(); } });
  let muted = !!v.muted; let vol = v.volume ?? 1; show();
  const m = modal({ title: 'Trim video', wide: true, body: [vid, h('div', { style: { marginTop: '12px' } }, s1, s2, lab), v.hasAudio ? h('div', { style: { marginTop: '10px' } }, toggle('Mute this clip', muted, (x) => { muted = x; }), slider('Volume', { min: 0, max: 150, value: Math.round(vol * 100), fmt: (x) => x + '%', onInput: (x) => { vol = x / 100; } })) : h('p.small.dim', 'This clip has no sound.')],
    foot: [btn('Cancel', () => m.close(), { cls: 'ghost' }), btn('Apply', async () => {
      const changedIn = Math.abs(a - (v.in || 0)) > 0.01;
      o.ro2Video = { ...v, in: a, out: b, muted, volume: vol };
      if (changedIn) { try { const el = await loadImage(await window.ro2.media.poster(v.path, a)); const sw = o.getScaledWidth(), sh = o.getScaledHeight(); o.setElement(el); o.set({ scaleX: sw / el.naturalWidth, scaleY: sh / el.naturalHeight }); o.assetId = ed.addAsset(el.src); } catch {} }
      ed.canvas.requestRenderAll(); ed.commit(); ed.emit('modified', [o]); m.close();
    }, { cls: 'primary', icon: 'check' })] });
}
