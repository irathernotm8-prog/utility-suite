// Small UI toolkit shared by all three workspaces.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.childElementCount === 1 ? t.content.firstElementChild : t.content;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = (() => { let n = 0; return (p = 'id') => `${p}${Date.now().toString(36)}${(n++).toString(36)}`; })();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtBytes(n) {
  if (!n && n !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
}
function fmtTime(t, frac = true) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${frac ? s.toFixed(2).padStart(5, '0') : String(Math.floor(s)).padStart(2, '0')}`;
}
function baseName(p) { return String(p).split(/[\\/]/).pop(); }
function dirName(p) { const parts = String(p).split(/([\\/])/); parts.splice(-2, 2); return parts.join(''); }
function stripExt(name) { return name.replace(/\.[^.]+$/, ''); }
function joinPath(dir, name) { const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'; return dir.replace(/[\\/]+$/, '') + sep + name; }

function toast(message, kind = 'info', ms = 3600) {
  const t = h(`<div class="toast toast-${kind}" role="status">${icon(kind === 'error' ? 'x' : kind === 'ok' ? 'check' : 'info')}<span>${esc(message)}</span></div>`);
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, ms);
}

/**
 * modal({ title, body: Node|string, actions: [{label, kind:'primary'|'ghost'|'danger', onClick(close) -> false keeps open}], width, onClose })
 */
function modal({ title, body, actions = [], width = 440, onClose, dismissable = true, side = false }) {
  const root = h(`<div class="modal-backdrop ${side ? 'side' : ''}"><div class="modal" role="dialog" aria-modal="true" style="width:${width}px">
      <div class="modal-head"><h2>${esc(title)}</h2>${dismissable ? `<button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>` : ''}</div>
      <div class="modal-body"></div>
      <div class="modal-actions"></div></div></div>`);
  const bodyEl = $('.modal-body', root);
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  let closed = false;
  const close = (v) => {
    if (closed) return; closed = true;
    root.remove(); document.removeEventListener('keydown', onKey, true);
    onClose && onClose(v);
  };
  const actionsEl = $('.modal-actions', root);
  actions.forEach(a => {
    const b = h(`<button class="btn ${a.kind ? 'btn-' + a.kind : ''}">${esc(a.label)}</button>`);
    b.addEventListener('click', async () => {
      const r = a.onClick ? await a.onClick(close, b) : undefined;
      if (r !== false) close(a.value);
    });
    actionsEl.appendChild(b);
  });
  if (!actions.length) actionsEl.remove();
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissable) { e.stopPropagation(); close(); }
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
      const primary = $('.btn-primary', actionsEl);
      if (primary) { e.preventDefault(); e.stopPropagation(); primary.click(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('mousedown', e => { if (e.target === root && dismissable && !side) close(); });
  $$('[data-close]', root).forEach(b => b.addEventListener('click', () => close()));
  $('#modal-root').appendChild(root);
  setTimeout(() => { const f = $('input, select, textarea', bodyEl) || $('.btn-primary', actionsEl); f && f.focus(); }, 30);
  return { root, body: bodyEl, close };
}

function confirmBox(title, message, okLabel = 'OK', kind = 'primary') {
  return new Promise(res => modal({ title, body: `<p class="muted">${esc(message)}</p>`,
    actions: [{ label: 'Cancel', kind: 'ghost', onClick: () => res(false) }, { label: okLabel, kind, onClick: () => res(true) }],
    onClose: () => res(false) }));
}

function promptBox(title, label, value = '', okLabel = 'OK') {
  return new Promise(res => {
    const body = h(`<label class="field"><span>${esc(label)}</span><input type="text" value="${esc(value)}"></label>`);
    modal({ title, body, actions: [{ label: 'Cancel', kind: 'ghost', onClick: () => res(null) }, { label: okLabel, kind: 'primary', onClick: () => res($('input', body).value) }], onClose: () => res(null) });
  });
}

/** A progress dialog for long jobs. Returns { set(p, label), close() }. */
function progressBox(title, onCancel) {
  const body = h(`<div class="progress-box"><div class="progress"><div class="progress-fill"></div></div><div class="progress-meta"><span class="progress-label">Starting…</span><span class="progress-pct">0%</span></div></div>`);
  const m = modal({ title, body, dismissable: false, width: 420,
    actions: onCancel ? [{ label: 'Cancel', kind: 'ghost', onClick: () => { onCancel(); return false; } }] : [] });
  const started = performance.now();
  return {
    set(p, label) {
      $('.progress-fill', body).style.width = (p * 100).toFixed(1) + '%';
      $('.progress-pct', body).textContent = Math.round(p * 100) + '%';
      if (label) $('.progress-label', body).textContent = label;
      else if (p > 0.03) {
        const el = (performance.now() - started) / 1000;
        const left = el / p - el;
        $('.progress-label', body).textContent = left > 1 ? `About ${left < 60 ? Math.ceil(left) + 's' : Math.ceil(left / 60) + ' min'} left` : 'Finishing…';
      }
    },
    close: m.close,
  };
}

/** Labeled range slider bound to a number. Returns the element; listen to 'input'. */
function slider({ label, min, max, step = 1, value, unit = '', id, fmt }) {
  const show = v => fmt ? fmt(v) : `${v}${unit}`;
  const el = h(`<label class="slider-field" ${id ? `data-key="${id}"` : ''}>
      <span class="sf-top"><span>${esc(label)}</span><output>${show(value)}</output></span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${value}">
    </label>`);
  const input = $('input', el), out = $('output', el);
  const paint = () => {
    const p = (input.value - min) / (max - min) * 100;
    input.style.setProperty('--p', p + '%');
    out.textContent = show(Number(input.value));
  };
  input.addEventListener('input', paint);
  input.addEventListener('dblclick', () => { input.value = value; paint(); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  paint();
  el.get = () => Number(input.value);
  el.set = (v) => { input.value = v; paint(); };
  el.input = input;
  return el;
}

function selectField(label, options, value) {
  const el = h(`<label class="field"><span>${esc(label)}</span><select>${options.map(o => {
    const [v, l] = Array.isArray(o) ? o : [o.value ?? o.ext ?? o, o.label ?? o];
    return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`;
  }).join('')}</select></label>`);
  el.get = () => $('select', el).value;
  el.select = $('select', el);
  return el;
}

function numberField(label, value, { min, max, step = 1, suffix = '' } = {}) {
  const el = h(`<label class="field"><span>${esc(label)}</span><span class="num-wrap"><input type="number" value="${value}" ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} step="${step}">${suffix ? `<em>${esc(suffix)}</em>` : ''}</span></label>`);
  el.get = () => Number($('input', el).value);
  el.set = v => { $('input', el).value = v; };
  el.input = $('input', el);
  return el;
}

function checkField(label, checked) {
  const el = h(`<label class="check"><input type="checkbox" ${checked ? 'checked' : ''}><span class="check-box">${icon('check')}</span><span>${esc(label)}</span></label>`);
  el.get = () => $('input', el).checked;
  el.input = $('input', el);
  return el;
}

/** Drag-to-scrub helper for pointer interactions. */
function onDrag(el, { start, move, end }) {
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const r = start && start(e);
    if (r === false) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    const mv = ev => move && move(ev, e);
    const up = ev => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      end && end(ev, e);
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
}

function isTyping() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' && !['range', 'checkbox', 'button'].includes(a.type) || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

let FORMATS = null; // filled in app.js

/** Popover menu anchored to an element. items: [{label, kbd, onClick, disabled} | 'sep'] */
function menuAt(anchor, items, { align = 'left' } = {}) {
  closeMenus();
  const m = h(`<div class="menu" role="menu"></div>`);
  items.forEach(it => {
    if (it === 'sep') { m.appendChild(h('<div class="menu-sep"></div>')); return; }
    if (it.heading) { m.appendChild(h(`<div class="menu-heading">${esc(it.heading)}</div>`)); return; }
    const b = h(`<button role="menuitem" ${it.disabled ? 'disabled' : ''}><span>${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}</button>`);
    b.addEventListener('click', () => { closeMenus(); it.onClick && it.onClick(); });
    m.appendChild(b);
  });
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = align === 'right' ? r.right - mw : r.left;
  let top = r.bottom + 4;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  left = clamp(left, 8, innerWidth - mw - 8);
  m.style.left = left + 'px'; m.style.top = top + 'px';
  setTimeout(() => {
    const off = e => { if (!m.contains(e.target)) closeMenus(); };
    document.addEventListener('mousedown', off, true);
    m._off = off;
    const first = m.querySelector('button:not([disabled])'); first && first.focus();
  });
  m.addEventListener('keydown', e => {
    const btns = $$('button:not([disabled])', m); const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
    if (e.key === 'Escape') closeMenus();
  });
  return m;
}
function closeMenus() {
  $$('.menu').forEach(m => { if (m._off) document.removeEventListener('mousedown', m._off, true); m.remove(); });
}
