// Small DOM toolkit: elements, icons, toasts, modals, popovers, menus, sliders.
let ICONS = {};
export async function loadIcons() {
  const r = await fetch('vendor/lucide/icons.json'); ICONS = await r.json();
}
export const iconNames = () => Object.keys(ICONS);
export const iconData = (n) => ICONS[n];
export function svgIcon(name, cls = 'i') {
  const d = ICONS[name]; const inner = d ? d[0] : '<circle cx="12" cy="12" r="9"/>';
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
}
export const ico = (n) => svgIcon(n);

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
// h('div.cls#id', {attrs, on: {click}}, children...)
export function h(tag, attrs, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
  const el = document.createElement(m[1] || 'div');
  (m[2] || '').replace(/([.#])([\w-]+)/g, (_, t, v) => { if (t === '.') el.classList.add(v); else el.id = v; });
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) { if (k == null || k === false) continue; el.append(k instanceof Node ? k : document.createTextNode(String(k))); }
  return el;
}
export const frag = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
export function btn(label, onClick, { icon, cls = '', title, disabled } = {}) {
  const b = h('button.btn' + (cls ? '.' + cls.split(' ').join('.') : ''), { title: title || null, disabled, on: { click: onClick } });
  b.innerHTML = (icon ? svgIcon(icon) : '') + (label ? `<span>${esc(label)}</span>` : '');
  return b;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); fn(...a); }; d.cancel = () => clearTimeout(t); return d; };
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const fmtBytes = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? Math.round(n / 1e6) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
export const isMac = navigator.platform.toLowerCase().includes('mac');
export const MOD = isMac ? '⌘' : 'Ctrl+';

// ───── toasts ─────
export function toast(msg, { type = 'ok', ms = 3200, action } = {}) {
  const t = h('div.toast.' + type, { html: svgIcon(type === 'err' ? 'circle-alert' : type === 'info' ? 'info' : 'circle-check') });
  t.append(h('span', msg));
  if (action) t.append(btn(action.label, () => { action.run(); t.remove(); }, { cls: 'sm' }));
  document.getElementById('toasts').append(t);
  setTimeout(() => { t.style.transition = 'opacity .25s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 260); }, ms);
  return t;
}
export const toastErr = (e) => toast(String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { type: 'err', ms: 5200 });

// ───── modals ─────
export function modal({ title, body, foot, wide, onClose, cls }) {
  const root = document.getElementById('overlayRoot');
  const close = () => { bd.remove(); document.removeEventListener('keydown', onKey, true); onClose && onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const m = h('div.modal' + (wide ? '.wide' : '') + (cls ? '.' + cls : ''),
    h('div.modal-head', h('h3', title), (() => { const b = btn('', close, { icon: 'x', cls: 'ghost icon sm', title: 'Close' }); return b; })()),
    h('div.modal-body', body), foot ? h('div.modal-foot', foot) : null);
  const bd = h('div.backdrop', { on: { mousedown: (e) => { if (e.target === bd) close(); } } }, m);
  root.append(bd); document.addEventListener('keydown', onKey, true);
  return { el: m, close, body: m.querySelector('.modal-body') };
}
export function confirmBox(title, text, okLabel = 'OK', danger) {
  return new Promise((res) => {
    let done = false;
    const m = modal({ title, body: h('p.muted', { style: { margin: '4px 0 6px', lineHeight: 1.5 } }, text), onClose: () => { if (!done) res(false); },
      foot: [btn('Cancel', () => m.close(), { cls: 'ghost' }), btn(okLabel, () => { done = true; m.close(); res(true); }, { cls: danger ? 'danger' : 'primary' })] });
  });
}
export function promptBox(title, value = '', okLabel = 'Save') {
  return new Promise((res) => {
    let done = false;
    const inp = h('input.input', { value, style: { width: '100%' }, on: { keydown: (e) => { if (e.key === 'Enter') ok(); } } });
    const ok = () => { done = true; m.close(); res(inp.value.trim()); };
    const m = modal({ title, body: inp, onClose: () => { if (!done) res(null); }, foot: [btn('Cancel', () => m.close(), { cls: 'ghost' }), btn(okLabel, ok, { cls: 'primary' })] });
    setTimeout(() => { inp.focus(); inp.select(); }, 20);
  });
}

// ───── popovers & menus ─────
let openPop = null;
export function closePopover() { if (openPop) { const p = openPop; openPop = null; p.cleanup(); } }
export function popover(anchor, content, { place = 'below', onClose, cls = '' } = {}) {
  closePopover();
  const el = h('div.popover' + (cls ? '.' + cls : ''), content);
  document.getElementById('overlayRoot').append(el);
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
  const pw = el.offsetWidth, ph = el.offsetHeight;
  let x = r.left, y = place === 'above' ? r.top - ph - 6 : r.bottom + 6;
  if (place === 'right') { x = r.right + 8; y = r.top; }
  x = clamp(x, 8, innerWidth - pw - 8); if (y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 6); y = clamp(y, 8, innerHeight - ph - 8);
  el.style.left = x + 'px'; el.style.top = y + 'px';
  const down = (e) => { if (!el.contains(e.target) && !(anchor.contains && anchor.contains(e.target))) closePopover(); };
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePopover(); } };
  setTimeout(() => { document.addEventListener('mousedown', down, true); document.addEventListener('keydown', key, true); });
  openPop = { el, cleanup: () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key, true); el.remove(); onClose && onClose(); } };
  return el;
}
// items: [{label, icon, run, key, danger, disabled} | '-']
export function menu(at, items) {
  const el = h('div.menu');
  for (const it of items) {
    if (it === '-') { el.append(h('hr')); continue; }
    if (!it) continue;
    const b = h('button' + (it.danger ? '.danger' : ''), { disabled: it.disabled, on: { click: () => { closePopover(); it.run(); } } });
    b.innerHTML = (it.icon ? svgIcon(it.icon) : '<span style="width:16px"></span>') + `<span>${esc(it.label)}</span>` + (it.key ? `<span class="k">${esc(it.key)}</span>` : '');
    el.append(b);
  }
  closePopover();
  document.getElementById('overlayRoot').append(el);
  const pw = el.offsetWidth, ph = el.offsetHeight;
  let x = at.x, y = at.y;
  if (at.getBoundingClientRect) { const r = at.getBoundingClientRect(); x = r.left; y = r.bottom + 4; }
  el.style.left = clamp(x, 6, innerWidth - pw - 6) + 'px'; el.style.top = clamp(y, 6, innerHeight - ph - 6) + 'px';
  const down = (e) => { if (!el.contains(e.target)) closePopover(); };
  const key = (e) => { if (e.key === 'Escape') closePopover(); };
  setTimeout(() => { document.addEventListener('mousedown', down, true); document.addEventListener('keydown', key, true); });
  openPop = { el, cleanup: () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key, true); el.remove(); } };
  return el;
}

// ───── sliders & number fields ─────
export function slider(label, { min = 0, max = 100, step = 1, value = 0, fmt = (v) => Math.round(v), onInput, onChange }) {
  const v = h('span.v', fmt(value));
  const r = h('input', { type: 'range', min, max, step, value });
  const paint = () => r.style.setProperty('--p', ((r.value - min) / (max - min)) * 100 + '%');
  r.addEventListener('input', () => { paint(); v.textContent = fmt(+r.value); onInput && onInput(+r.value); });
  r.addEventListener('change', () => onChange && onChange(+r.value));
  r.addEventListener('dblclick', () => { if (r.dataset.reset != null) { r.value = r.dataset.reset; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); } });
  paint();
  const row = h('div.range-row', h('label', label), v, r);
  row.set = (val) => { r.value = val; paint(); v.textContent = fmt(+val); };
  row.input = r;
  return row;
}
export function numField(label, value, onCommit, { step = 1, min = -1e9, max = 1e9, suffix = '' } = {}) {
  const inp = h('input', { value: fmtNum(value) + suffix });
  const commit = () => { const n = parseFloat(inp.value); if (Number.isFinite(n)) onCommit(clamp(n, min, max)); };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commit(); inp.blur(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const n = (parseFloat(inp.value) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1); inp.value = fmtNum(clamp(n, min, max)); commit(); }
  });
  inp.addEventListener('blur', commit);
  const lab = h('span', label);
  // drag the label to scrub the value
  lab.addEventListener('mousedown', (e) => {
    const x0 = e.clientX, v0 = parseFloat(inp.value) || 0;
    const mv = (ev) => { inp.value = fmtNum(clamp(v0 + Math.round((ev.clientX - x0) / 2) * step, min, max)); commit(); };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  });
  const el = h('label.num', lab, inp);
  el.set = (v) => { if (document.activeElement !== inp) inp.value = fmtNum(v) + suffix; };
  return el;
}
export const fmtNum = (n) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));
export function toggle(label, checked, onChange) {
  const i = h('input', { type: 'checkbox', checked, on: { change: () => onChange(i.checked) } });
  return h('label.check', i, h('span', label));
}
export function seg(options, value, onChange, { block } = {}) {
  const el = h('div.seg' + (block ? '.block' : ''));
  const render = (v) => { el.innerHTML = ''; for (const o of options) { const b = h('button' + (o.value === v ? '.on' : ''), { title: o.title || null, on: { click: () => { render(o.value); onChange(o.value); } } }); b.innerHTML = (o.icon ? svgIcon(o.icon) : '') + (o.label ? `<span>${esc(o.label)}</span>` : ''); el.append(b); } };
  render(value); el.set = render; return el;
}
export function busy(title) {
  const bar = h('i'); const note = h('div.small.muted');
  const el = h('div.busy', h('div.box', h('b', title), h('div.progress.indet', bar), note));
  document.getElementById('overlayRoot').append(el);
  return {
    set(p, text) { if (p != null) { bar.parentElement.classList.remove('indet'); bar.style.width = Math.round(p * 100) + '%'; } if (text != null) note.textContent = text; },
    title(t) { el.querySelector('b').textContent = t; },
    close() { el.remove(); },
  };
}
