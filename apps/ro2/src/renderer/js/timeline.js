// The lite timeline: each page is a scene with a duration and a transition into it, plus one music track.
// Stored on the design: page.duration (s), page.transition {type, duration}, doc.timeline {fps, music}.
import { h, ico, btn, menu, popover, closePopover, slider, toast, toastErr, busy, esc } from './ui.js';
import { app, autosave } from './app.js';
import { pageDuration, transitionOf, totalDuration, TRANSITIONS, previewVideo, isMovingPage } from './video-export.js';

const PX = 46; // px per second
let open = false;
export const timelineOpen = () => open;
export function toggleTimeline(v = !open) { open = v; document.getElementById('timeline').classList.toggle('hidden', !open); renderTimeline(); app.emit('timeline', open); }
const fmt = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${(Math.round(s * 10) / 10).toFixed(1)} s`);
function changed() { const ed = app.editor; ed.emit('timeline'); autosave(); renderTimeline(); }

export function setPageTiming(ed, i, { duration, transition, transitionDuration } = {}) {
  const p = i === ed.page ? ed.pageData : ed.doc.pages[i];
  if (duration !== undefined) p.duration = duration > 0 ? Math.round(+duration * 100) / 100 : undefined;
  if (transition !== undefined || transitionDuration !== undefined) p.transition = { type: transition ?? (p.transition && p.transition.type) ?? 'fade', duration: +(transitionDuration ?? (p.transition && p.transition.duration) ?? 0.6) };
}
export function setMusic(ed, music) { ed.doc.timeline = { ...(ed.doc.timeline || {}), music: music || undefined }; }

export function renderTimeline() {
  const root = document.getElementById('timeline'); const ed = app.editor; if (!root || !open || !ed || !ed.doc) return;
  root.innerHTML = ''; const tl = ed.doc.timeline || {}; ed.syncPage();
  const head = h('div.tl-head',
    h('b', 'Timeline'), h('span.small.muted', `${ed.doc.pages.length} page${ed.doc.pages.length > 1 ? 's' : ''} · ${fmt(totalDuration(ed))}`),
    h('div', { style: { flex: 1 } }),
    h('select.input.sm', { title: 'Frame rate', on: { change: (e) => { ed.doc.timeline = { ...tl, fps: +e.target.value }; changed(); } } }, ...[24, 30, 60].map((f) => h('option', { value: f, selected: (tl.fps || 30) === f }, `${f} fps`))),
    btn('Preview', preview, { icon: 'play', cls: 'sm' }),
    btn('Export video', () => import('./modals/export.js').then((m) => m.openExport({ video: true })), { icon: 'clapperboard', cls: 'sm primary' }),
    btn('', () => toggleTimeline(false), { icon: 'x', cls: 'ghost icon sm', title: 'Close the timeline' }));
  const track = h('div.tl-track');
  ed.doc.pages.forEach((pg, i) => {
    if (i > 0) {
      const t = transitionOf(ed, i); const name = (TRANSITIONS.find((x) => x[0] === t.type) || TRANSITIONS[0])[1];
      track.append(h('button.tl-tr' + (t.type !== 'none' ? '.on' : ''), { title: `Into page ${i + 1}: ${name}${t.duration ? ` (${t.duration} s)` : ''}`, html: ico(t.type === 'none' ? 'scissors' : 'blend'), on: { click: (e) => pickTransition(e.currentTarget, i) } }));
    }
    const d = pageDuration(ed, i); const auto = !(pg.duration > 0);
    const thumb = document.querySelector(`#pages .page-th:nth-child(${i + 1})`);
    const blk = h('div.tl-page' + (i === ed.page ? '.on' : ''), { style: { width: Math.max(64, d * PX) + 'px', backgroundImage: thumb ? thumb.style.backgroundImage : null }, title: `Page ${i + 1}: plays ${fmt(d)}${auto ? ' (automatic)' : ''}. Drag the right edge to change it.`, on: { click: () => ed.gotoPage(i) } },
      h('span.tl-label', `${i + 1}${isMovingPage(ed, i) ? ' ▸' : ''}`), h('span.tl-dur', { on: { click: (e) => { e.stopPropagation(); editDuration(e.currentTarget, i); } } }, fmt(d) + (auto ? ' · auto' : '')));
    const grip = h('div.tl-grip');
    grip.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); grip.setPointerCapture(e.pointerId); const x0 = e.clientX, d0 = d;
      const mv = (ev) => { const nd = Math.max(0.5, Math.round((d0 + (ev.clientX - x0) / PX) * 10) / 10); blk.style.width = Math.max(64, nd * PX) + 'px'; blk.querySelector('.tl-dur').textContent = fmt(nd); blk.dataset.nd = nd; };
      const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); if (blk.dataset.nd) { setPageTiming(ed, i, { duration: +blk.dataset.nd }); changed(); } };
      grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); });
    blk.append(grip); track.append(blk);
  });
  const music = tl.music;
  const mrow = h('div.tl-music', h('span', { html: ico('music') }),
    music ? [h('b.small', { title: music.path }, music.name || 'Music'), h('span.small.dim', fmt(music.duration || 0)),
      h('div.tl-vol', slider('Volume', { min: 0, max: 100, value: Math.round((music.volume ?? 0.8) * 100), fmt: (v) => v + '%', onChange: (v) => { music.volume = v / 100; changed(); } })),
      btn('Fade out', () => { music.fadeOut = music.fadeOut ? 0 : 1.5; changed(); }, { cls: 'sm ' + (music.fadeOut ? '' : 'ghost') }),
      btn('', () => { setMusic(ed, null); changed(); }, { icon: 'trash-2', cls: 'ghost icon sm', title: 'Remove the music' })]
      : btn('Add music', addMusic, { icon: 'plus', cls: 'ghost sm' }));
  root.append(head, track, mrow);
}
async function addMusic() { const ed = app.editor; try { const info = await window.ro2.media.pick('audio'); if (!info) return; setMusic(ed, { path: info.path, name: info.name, duration: info.duration, volume: 0.8, fadeIn: 0, fadeOut: 1.5 }); changed(); toast('Music added. It plays under the whole video.'); } catch (e) { toastErr(e); } }
function pickTransition(anchor, i) {
  const ed = app.editor; const cur = transitionOf(ed, i);
  const grid = h('div.tl-trs');
  for (const [id, name] of TRANSITIONS) grid.append(h('button.chip' + (cur.type === id ? '.on' : ''), { on: { click: () => { setPageTiming(ed, i, { transition: id, transitionDuration: cur.duration || 0.6 }); closePopover(); changed(); } } }, name));
  const len = slider('Length', { min: 0.2, max: 2, step: 0.1, value: cur.duration || 0.6, fmt: (v) => (+v).toFixed(1) + ' s', onChange: (v) => { setPageTiming(ed, i, { transitionDuration: +v }); changed(); } });
  popover(anchor, h('div', { style: { width: '320px' } }, h('div', { style: { fontWeight: 800, marginBottom: '8px' } }, `Into page ${i + 1}`), grid, len));
}
function editDuration(anchor, i) {
  const ed = app.editor; const d = pageDuration(ed, i);
  const inp = h('input.input', { type: 'number', min: '0.5', max: '600', step: '0.1', value: d, style: { width: '90px' } });
  const set = (v) => { setPageTiming(ed, i, { duration: v }); closePopover(); changed(); };
  popover(anchor, h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, inp, h('span.small.muted', 'seconds'), btn('Set', () => set(+inp.value), { cls: 'primary sm' }), btn('Auto', () => set(0), { cls: 'ghost sm', title: 'As long as its animation or video (3 s for stills)' })));
  setTimeout(() => inp.select(), 20); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') set(+inp.value); });
}
export async function preview() {
  const ed = app.editor; const b = busy('Making a preview…');
  try {
    const r = await previewVideo(ed, {}, (p, t) => b.set(p, t));
    b.close(); playVideo(r.output, `Preview · ${fmt(r.duration || totalDuration(ed))}`);
  } catch (e) { b.close(); toastErr(e); }
}
export async function playVideo(file, title) {
  const { modal } = await import('./ui.js'); const src = await window.ro2.media.url(file);
  const v = h('video', { src, controls: true, autoplay: true, loop: true, style: { width: '100%', maxHeight: '70vh', borderRadius: '10px', background: '#000' } });
  const m = modal({ title: title || 'Video', wide: true, body: v, foot: [btn('Close', () => m.close(), { cls: 'ghost' })], onClose: () => { v.pause(); v.src = ''; } });
}
export { esc, menu };
