// Atrium window: shared state, IPC, toasts, menus, sheets, small helpers. Views live in builder/panels/inspector/
// chat/sheets/home; boot.js wires everything up.
'use strict';
const A = window.atrium;
const call = A.call;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const tildify = (p) => (S.info && p && String(p).startsWith(S.info.home) ? '~' + String(p).slice(S.info.home.length) : p);
function ago(t) { if (!t) return ''; const s = (Date.now() - t) / 1000; if (s < 45) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; if (s < 6 * 86400) return new Date(t).toLocaleDateString(undefined, { weekday: 'short' }); return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

// global state
const S = {
  info: null, settings: {}, lib: null, site: null, page: 'index', view: 'builder', device: 'desktop', mode: 'edit', panel: 'layers', rtab: 'inspect',
  sel: null, // { id, path, info }
  insertAt: null, // { page, position } for the Add panel
  aiBusy: false, bridge: {},
};

// ───────── toasts
function toast(title, text = '', kind = 'ok', ms = 4200) {
  const el = document.createElement('div'); el.className = 'toast ' + kind;
  el.innerHTML = `<span class="t-ic">${kind === 'busy' ? '<span class="spin"></span>' : icon(kind === 'bad' ? 'alert' : kind === 'info' ? 'sparkle' : 'check', 16)}</span><div class="grow"><div class="t-title">${esc(title)}</div>${text ? `<div class="t-text">${esc(text)}</div>` : ''}</div>`;
  $('#toasts').appendChild(el);
  if (ms) setTimeout(() => { el.style.transition = 'opacity .2s'; el.style.opacity = 0; setTimeout(() => el.remove(), 220); }, ms);
  return el;
}
const fail = (e) => toast('That didn’t work', e.message || String(e), 'bad', 8000);
async function attempt(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { fail(e); return undefined; } }

// ───────── menus
function closeMenus() { $('#popHost').innerHTML = ''; }
function menu(anchor, items, opts = {}) {
  closeMenus();
  const m = document.createElement('div'); m.className = 'menu';
  for (const it of items) {
    if (it === '-') { m.appendChild(document.createElement('hr')); continue; }
    if (it.label && !it.run) { const l = document.createElement('div'); l.className = 'menu-label'; l.textContent = it.label; m.appendChild(l); continue; }
    const b = document.createElement('button'); if (it.danger) b.className = 'danger'; if (it.on) b.classList.add('on');
    b.innerHTML = `${it.icon ? icon(it.icon, 16) : it.swatch ? `<span class="sw" style="background:${esc(it.swatch)}"></span>` : ''}<span class="grow ellip">${esc(it.text)}</span>${it.hint ? `<span class="tiny muted">${esc(it.hint)}</span>` : ''}${it.on ? `<span class="menu-check">${icon('check', 14)}</span>` : ''}`;
    b.onclick = (e) => { e.stopPropagation(); closeMenus(); it.run(); };
    m.appendChild(b);
  }
  $('#popHost').appendChild(m);
  const r = anchor.getBoundingClientRect(); const mw = m.offsetWidth, mh = m.offsetHeight;
  let x = opts.right ? r.right - mw : r.left, y = r.bottom + 6;
  if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 6);
  m.style.left = Math.max(8, Math.min(innerWidth - mw - 8, x)) + 'px'; m.style.top = y + 'px';
  setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { closeMenus(); document.removeEventListener('mousedown', off); } }), 0);
  return m;
}

// ───────── sheets
function sheet({ title, body, foot, wide, xwide, onClose }) {
  const back = document.createElement('div'); back.className = 'sheet-back';
  back.innerHTML = `<div class="sheet ${wide ? 'wide' : ''} ${xwide ? 'xwide' : ''}"><div class="sheet-head"><h2>${title}</h2><button class="icon-btn sm" data-x>${icon('x', 17)}</button></div><div class="sheet-body"></div>${foot !== false ? '<div class="sheet-foot"></div>' : ''}</div>`;
  const b = $('.sheet-body', back); if (typeof body === 'string') b.innerHTML = body; else if (body) b.appendChild(body);
  if (foot) { const f = $('.sheet-foot', back); if (typeof foot === 'string') f.innerHTML = foot; else f.appendChild(foot); }
  const close = () => { back.remove(); document.removeEventListener('keydown', key); onClose && onClose(); };
  const key = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) close(); };
  document.addEventListener('keydown', key);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $('[data-x]', back).onclick = close;
  $('#sheetHost').appendChild(back); hydrateIcons(back);
  return { el: back, body: b, foot: $('.sheet-foot', back), close };
}
function confirmSheet(title, text, okText = 'OK', danger = false) {
  return new Promise((res) => {
    const s = sheet({ title, body: `<p style="margin:0;color:var(--fg-2)">${text}</p>`, foot: `<button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" data-yes>${esc(okText)}</button>`, onClose: () => res(false) });
    $('[data-no]', s.el).onclick = () => { s.close(); };
    $('[data-yes]', s.el).onclick = () => { res(true); s.el.remove(); };
  });
}
function promptSheet(title, label, value = '', okText = 'OK', placeholder = '') {
  return new Promise((res) => {
    const s = sheet({ title, body: `<div class="field"><label>${esc(label)}</label><input class="input" data-v value="${esc(value)}" placeholder="${esc(placeholder)}"></div>`, foot: `<button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>${esc(okText)}</button>`, onClose: () => res(null) });
    const inp = $('[data-v]', s.el); setTimeout(() => { inp.focus(); inp.select(); }, 30);
    const done = () => { const v = inp.value.trim(); res(v || null); s.el.remove(); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') done(); };
    $('[data-no]', s.el).onclick = () => s.close(); $('[data-yes]', s.el).onclick = done;
  });
}
function lightbox(src) { const d = document.createElement('div'); d.className = 'lightbox'; d.innerHTML = `<img src="${src}">`; d.onclick = () => d.remove(); document.body.appendChild(d); }

// ───────── data
async function loadSite() { S.site = await call('site:get'); if (!S.site.pages.some((p) => p.slug === S.page || p.id === S.page)) S.page = 'index'; return S.site; }
const curPage = () => (S.site ? S.site.pages.find((p) => p.slug === S.page) || S.site.pages[0] : null);
function findSec(id) {
  if (!S.site) return null; const g = S.site.globals;
  if (g.header && g.header.id === id) return { sec: g.header, where: 'header' };
  if (g.footer && g.footer.id === id) return { sec: g.footer, where: 'footer' };
  for (const p of S.site.pages) { const i = p.sections.findIndex((s) => s.id === id); if (i >= 0) return { sec: p.sections[i], where: 'page', page: p, index: i }; }
  return null;
}
const byWho = (b) => (!b || b === 'you' ? 'You' : b);
const isMac = () => S.info && S.info.platform === 'darwin';
