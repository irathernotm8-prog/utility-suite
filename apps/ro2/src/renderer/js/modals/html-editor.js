// The HTML layer editor: code on the left, the page playing live on the right (in RO2's sandbox), timing below.
import { h, modal, btn, toast, toastErr, debounce } from '../ui.js';
import { app } from '../app.js';
import { makeHtml, updateHtml, starterHtml } from '../html-layer.js';
import { activeKit } from '../panels/brand.js';

export function openHtmlEditor(o = null) {
  const ed = app.editor; const cur = o && o.ro2Html;
  const w = cur ? cur.w : ed.W, hh = cur ? cur.h : ed.H;
  let code = cur ? cur.html : starterHtml(w, hh, activeKit());
  let duration = cur && cur.durationSet ? cur.duration : '';
  let poster = cur && cur.poster != null ? cur.poster : '';
  const ta = h('textarea.code', { spellcheck: false, on: { input: () => { code = ta.value; live(); }, keydown: (e) => { if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); code = ta.value; live(); } } } });
  ta.value = code;
  const frame = h('iframe.html-live', { sandbox: 'allow-scripts', title: 'Live preview', style: { width: w + 'px', height: hh + 'px' } });
  const stage = h('div.html-stage', frame);
  const status = h('div.small.muted', '');
  const fit = () => { const r = stage.getBoundingClientRect(); const k = Math.min((r.width - 16) / w, (r.height - 16) / hh, 1); frame.style.transform = `translate(-50%,-50%) scale(${k})`; };
  const live = debounce(async () => {
    try { const key = await window.ro2.html.register({ html: code, w, h: hh }); frame.src = `ro2://html/${key}.html?mode=live&r=${Date.now()}`; status.textContent = `${w} × ${hh} px · plays live here; video export records it frame by frame`; } catch (e) { status.textContent = e.message; }
  }, 450);
  const replay = () => { const s = frame.src; frame.src = 'about:blank'; setTimeout(() => { frame.src = s; }, 30); };
  const opt = (val, ph, set) => h('input.input', { type: 'number', min: '0', max: '600', step: '0.1', value: val, placeholder: ph, style: { width: '96px' }, on: { input: (e) => set(e.target.value) } });
  const durF = opt(duration, 'auto', (v) => { duration = v; }); const posF = opt(poster, 'end', (v) => { poster = v; });
  const timing = h('div.html-timing', h('label', h('span.small.muted', 'Plays for (s)'), durF), h('label', h('span.small.muted', 'Show on the page at (s)'), posF), btn('Replay', replay, { icon: 'rotate-ccw', cls: 'ghost sm' }));
  const body = h('div.html-editor', h('div.html-code', ta), h('div.html-side', stage, timing, status));
  const m = modal({
    title: cur ? 'Edit HTML layer' : 'New HTML layer', wide: true, cls: 'xl',
    body,
    foot: [h('div.left.small.dim', 'Tip: ask Claude or ChatGPT to write it. They can also build it straight in RO2 with the AI design tab.'), btn('Cancel', () => m.close(), { cls: 'ghost' }), btn(cur ? 'Apply' : 'Add to page', apply, { cls: 'primary', icon: 'check' })],
  });
  const ro = new ResizeObserver(fit); ro.observe(stage); setTimeout(fit, 30); live();
  async function apply() {
    const go = m.el.querySelector('.modal-foot .primary'); go.disabled = true;
    try {
      const d = duration === '' || duration == null ? undefined : +duration; const p = poster === '' || poster == null ? null : +poster;
      if (cur) { await updateHtml(ed, o, { html: code, duration: d, poster: p }); ed.commit(); ed.emit('modified', [o]); }
      else { const { o: n } = await makeHtml(ed, { html: code, x: 0, y: 0, width: w, height: hh, duration: d, poster: p }); ed.add(n, { index: ed.userObjects().length + 1 }); }
      ro.disconnect(); m.close(); toast(cur ? 'HTML layer updated.' : 'HTML layer added. Double-click it to edit the code.');
    } catch (e) { toastErr(e); go.disabled = false; }
  }
}
