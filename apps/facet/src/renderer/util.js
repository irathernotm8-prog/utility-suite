// Facet — small DOM helpers, toasts, sheets and menus.
import { ic } from './icons.js';
export { fileUrl } from './viewer.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

export function fmtBytes(n) {
  if (!n) return '0 MB';
  const gb = n / 1073741824;
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.max(1, Math.round(n / 1048576))} MB`;
}
export const fmtMB = (mb) => fmtBytes(mb * 1048576);
export function ago(t) {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
export const fmtNum = (n) => (n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n.toLocaleString());

export function toast(title, text = '', kind = 'ok', ms = 4200) {
  const host = $('#toasts');
  const el = h(`<div class="toast ${kind}"><span class="t-ic">${kind === 'busy' ? '<span class="spin"></span>' : ic(kind === 'bad' ? 'alert' : kind === 'info' ? 'info' : 'check', 16)}</span><div class="grow"><div class="t-title">${esc(title)}</div>${text ? `<div class="t-text">${esc(text)}</div>` : ''}</div></div>`);
  host.appendChild(el);
  const close = () => { el.style.transition = 'opacity .2s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 200); };
  if (ms) setTimeout(close, ms);
  el.addEventListener('click', close);
  return close;
}

export function sheet({ title, sub = '', body = '', foot = '', wide = false, onClose } = {}) {
  const scrim = h(`<div class="scrim"><div class="sheet ${wide ? 'wide' : ''}"><div class="sheet-head"><div class="grow"><h3>${esc(title)}</h3>${sub ? `<p>${sub}</p>` : ''}</div><button class="icon-btn" data-close>${ic('x', 16)}</button></div><div class="sheet-body"></div>${foot !== null ? '<div class="sheet-foot"></div>' : ''}</div></div>`);
  const b = $('.sheet-body', scrim);
  if (typeof body === 'string') b.innerHTML = body; else if (body) b.appendChild(body);
  const f = $('.sheet-foot', scrim);
  if (f) { if (typeof foot === 'string') f.innerHTML = foot; else if (foot) f.appendChild(foot); if (!foot) f.remove(); }
  const close = () => { scrim.remove(); document.removeEventListener('keydown', key); onClose?.(); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  $('[data-close]', scrim).onclick = close;
  $('#sheetHost').appendChild(scrim);
  return { el: scrim, body: b, foot: f, close };
}

export function confirmSheet({ title, text, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet({ title, body: `<p style="margin:0;color:var(--fg-2)">${text}</p>`, foot: `<div class="grow"></div><button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(ok)}</button>`, onClose: () => { if (!done) resolve(false); } });
    $('[data-no]', s.el).onclick = () => s.close();
    $('[data-yes]', s.el).onclick = () => { done = true; s.close(); resolve(true); };
  });
}

let openMenu = null;
export function menu(anchor, items) {
  openMenu?.();
  const el = h(`<div class="menu"></div>`);
  for (const it of items) {
    if (it === '-') { el.appendChild(h('<hr>')); continue; }
    if (it.label && !it.run) { el.appendChild(h(`<div class="menu-label">${esc(it.label)}</div>`)); continue; }
    const b = h(`<button class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>${it.icon ? ic(it.icon, 15) : ''}<span>${esc(it.text)}</span>${it.sub ? `<span class="m-sub">${esc(it.sub)}</span>` : ''}</button>`);
    b.onclick = () => { close(); it.run(); };
    el.appendChild(b);
  }
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const mw = el.offsetWidth, mh = el.offsetHeight;
  let x = r.right - mw, y = r.bottom + 6;
  if (x < 8) x = r.left;
  if (y + mh > innerHeight - 8) y = r.top - mh - 6;
  el.style.left = Math.max(8, x) + 'px'; el.style.top = Math.max(8, y) + 'px';
  const away = (e) => { if (!el.contains(e.target)) close(); };
  const close = () => { el.remove(); document.removeEventListener('mousedown', away, true); openMenu = null; };
  setTimeout(() => document.addEventListener('mousedown', away, true));
  openMenu = close;
  return close;
}

export function debounce(fn, ms = 200) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
