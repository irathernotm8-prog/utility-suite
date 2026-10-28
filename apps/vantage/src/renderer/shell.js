/* Vantage — shared UI helpers: toasts, menus, popovers, modals, icons, and the bridge the
   Library / Player / Reader / Vault screens (moved over from Relay) expect as window.RelayApp. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const cleanErr = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

Object.assign(ICONS, {
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  fwd: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  layout1: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/>',
  layoutCols2: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M12 4.5v15"/>',
  layoutRows2: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 12h17"/>',
  layoutMain3: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M12 4.5v15M12 12h8.5"/>',
  layoutCols3: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.2 4.5v15M14.8 4.5v15"/>',
  layoutGrid4: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M12 4.5v15M3.5 12h17"/>',
  split: '<rect x="3.5" y="4.5" width="7.5" height="15" rx="2"/><rect x="13" y="4.5" width="7.5" height="6.5" rx="2"/><rect x="13" y="13" width="7.5" height="6.5" rx="2"/>',
  maximize: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  shieldCheck: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m8.8 12 2.2 2.2 4.4-4.4"/>',
  shieldOff: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m4 4 16 16"/>',
  vpn: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5M12 3.5C9.6 5.8 8.4 8.6 8.4 12s1.2 6.2 3.6 8.5"/>',
  mask: '<path d="M3 9.5c3-1.3 6-2 9-2s6 .7 9 2c0 4.4-2.2 7-4.8 7-2 0-2.6-1.8-4.2-1.8S9.8 16.5 7.8 16.5C5.2 16.5 3 13.9 3 9.5z"/><circle cx="8.3" cy="11" r="1.2"/><circle cx="15.7" cy="11" r="1.2"/>',
  reader: '<path d="M4 5.5h7v14H4zM13 5.5h7v14h-7"/><path d="M6.5 9h2.5M6.5 12h2.5M15.5 9h2M15.5 12h2"/>',
  bolt: '<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z"/>',
  window: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9h18"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  mapPin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  container: '<rect x="3.5" y="6" width="17" height="13" rx="2.5"/><path d="M3.5 10h17M8 6V4h8v2"/>',
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  minus: '<path d="M5 12h14"/>',
  scissors: '<circle cx="6" cy="6.5" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><path d="m8 8 12 9M8 16 20 7"/>',
  printer: '<path d="M7 9V3.5h10V9M7 17H4.5V10h15v7H17M7 14h10v6.5H7z"/>',
  save: '<path d="M5 3.5h11L20.5 8v12.5H3.5V5z"/><path d="M8 3.5V8h7M7.5 20.5v-6h9v6"/>',
  sleep: '<path d="M4 6h5L4 12h5M13 4h4l-4 5h4M15 15h3.5l-3.5 4.5H19"/>'
});

/* ---------- toasts ---------- */
function toast(msg, type = '', action) {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-act'; b.textContent = action.label;
    b.onclick = () => { action.onClick(); t.remove(); };
    t.appendChild(b);
  }
  $('#toastRoot').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, type === 'error' ? 5000 : action ? 6500 : 2600);
}

/* ---------- context menus ---------- */
function popMenu(x, y, items) {
  const root = $('#menuRoot');
  root.innerHTML = `<div class="menu">${items.filter(Boolean).map((it, i) => it === '-' ? '<hr>' :
    it.html ? `<div class="menu-pad">${it.html}</div>` :
    `<button class="${it.danger ? 'danger' : ''} ${it.checked ? 'checked' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>${it.icon ? ic(it.icon, 15) : '<span class="ic-sp"></span>'}<span class="ml">${esc(it.label)}</span>${it.hint ? `<span class="mk">${esc(it.hint)}</span>` : ''}</button>`).join('')}</div>`;
  const list = items.filter(Boolean);
  const m = root.firstChild;
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(6, Math.min(x, innerWidth - w - 8)) + 'px';
  m.style.top = Math.max(6, Math.min(y, innerHeight - h - 8)) + 'px';
  $$('button[data-i]', m).forEach(b => b.onclick = () => { closeMenu(); list[+b.dataset.i].onClick?.(); });
  list.forEach(it => it.mount?.(m, closeMenu));
  setTimeout(() => { document.addEventListener('mousedown', outside); document.addEventListener('keydown', onEsc); window.addEventListener('blur', closeMenu); }, 0);
  function outside(e) { if (!m.contains(e.target)) closeMenu(); }
  function onEsc(e) { if (e.key === 'Escape') closeMenu(); }
  function closeMenu() { root.innerHTML = ''; document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', onEsc); window.removeEventListener('blur', closeMenu); }
  return closeMenu;
}

/* ---------- popovers (anchored panels under toolbar buttons) ---------- */
let popClose = null;
function popover(anchor, { html, cls = '', width = 320, onMount, align = 'right' }) {
  if (popClose) { const same = popClose.anchor === anchor; popClose(); if (same) return null; }
  const root = $('#popRoot');
  const r = anchor.getBoundingClientRect();
  root.innerHTML = `<div class="pop ${cls}" style="width:${width}px">${html}</div>`;
  const p = root.firstChild;
  const left = align === 'left' ? r.left : r.right - width;
  p.style.left = Math.max(8, Math.min(left, innerWidth - width - 8)) + 'px';
  p.style.top = (r.bottom + 8) + 'px';
  anchor.classList.add('open');
  const close = () => {
    root.innerHTML = ''; anchor.classList.remove('open'); popClose = null;
    document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onEsc); window.removeEventListener('blur', onBlur);
  };
  close.anchor = anchor;
  const outside = (e) => { if (!p.contains(e.target) && !anchor.contains(e.target) && !$('#modalRoot').contains(e.target)) close(); };
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  const onBlur = () => setTimeout(() => { if (!document.hasFocus() && !$('#modalRoot').children.length) close(); }, 50);
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', onEsc); window.addEventListener('blur', onBlur); }, 0);
  popClose = close;
  onMount?.(p, close);
  return { el: p, close };
}
function closePopover() { popClose?.(); }

/* ---------- modals ---------- */
function openModal({ title, subtitle = '', color = 'var(--accent)', icon = 'key', body, actions = [], wide = false, onMount, left = '' }) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal ${wide ? 'wide' : ''}" role="dialog" style="--c:${color}">
      <div class="modal-head">
        <div class="modal-badge">${ic(icon, 20)}</div>
        <div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
        <button class="icon-btn" data-close title="Close">${ic('x', 16)}</button>
      </div>
      ${body !== '' ? `<div class="modal-body">${body}</div>` : ''}
      <div class="modal-foot">${left}<span class="spacer"></span>${actions.map((a, i) => `<button class="btn ${a.cls || ''}" style="${a.style || ''}" data-act="${i}">${esc(a.label)}</button>`).join('')}</div>
    </div></div>`;
  const modal = $('.modal', root);
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $('[data-close]', root).onclick = close;
  $('.modal-backdrop', root).onmousedown = (e) => { if (e.target.classList.contains('modal-backdrop')) close(); };
  $$('[data-act]', root).forEach(b => b.onclick = async () => {
    const a = actions[+b.dataset.act];
    if (a.onClick) { const r = await a.onClick(modal); if (r === false) return; }
    close();
  });
  onMount?.(modal, close);
  setTimeout(() => $('input:not([type=color]):not([type=checkbox]):not([type=range]), textarea', modal)?.focus(), 30);
  return { modal, close };
}
function confirmModal(title, subtitle, okLabel = 'OK', danger = false) {
  return new Promise((res) => {
    let done = false;
    openModal({ title, subtitle, icon: danger ? 'alert' : 'check', color: danger ? 'var(--danger)' : 'var(--accent)', body: '',
      actions: [{ label: 'Cancel', onClick: () => { done = true; res(false); } }, { label: okLabel, cls: 'brand', style: danger ? '--c:var(--danger)' : '', onClick: () => { done = true; res(true); } }] });
    const obs = new MutationObserver(() => { if (!$('#modalRoot').children.length) { obs.disconnect(); if (!done) res(false); } });
    obs.observe($('#modalRoot'), { childList: true });
  });
}

/* ---------- formatting ---------- */
const fmtBytes = (n) => { if (!n && n !== 0) return ''; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`; };
const fmtSpeed = (n) => n ? fmtBytes(n) + '/s' : '';
const fmtEta = (s) => { if (!isFinite(s) || s <= 0) return ''; s = Math.round(s); if (s < 60) return `${s}s left`; const m = Math.floor(s / 60); if (m < 60) return `${m} min left`; return `${Math.floor(m / 60)} h ${m % 60} min left`; };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const TILE = ['#2fd3bd', '#4f8cff', '#8b6dff', '#ff6b8b', '#ffb03b', '#22c55e', '#0ea5e9', '#f97316', '#a855f7', '#e5484d'];
const tileColor = (s) => TILE[[...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TILE.length];
const letterOf = (t) => ((hostOf(t.url) || t.title || '?')[0] || '?').toUpperCase();
const faviconHTML = (t, size = 16) => t.favicon && !/^data:,/.test(t.favicon)
  ? `<img class="fav" src="${esc(t.favicon)}" width="${size}" height="${size}" alt="" draggable="false" data-letter="${esc(letterOf(t))}" data-c="${tileColor(hostOf(t.url) || t.title)}">`
  : `<span class="fav letter" style="--c:${tileColor(hostOf(t.url) || t.title)}">${esc(letterOf(t))}</span>`;
document.addEventListener('load', (e) => { const img = e.target; if (img instanceof HTMLImageElement && img.classList.contains('nt-fav') && img.naturalWidth > 1) img.classList.add('ok'); }, true);
// favicons that fail to load turn into a letter tile (no inline handlers: the page's CSP forbids them)
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.classList.contains('nt-fav')) { img.classList.add('broken'); return; }
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('fav')) return;
  const s = document.createElement('span');
  s.className = 'fav letter'; s.textContent = img.dataset.letter || '?'; s.style.setProperty('--c', img.dataset.c || '#4f8cff');
  img.replaceWith(s);
}, true);

/* ---------- the Vantage namespace (filled in by tabs.js, toolbar.js, pages.js) ---------- */
window.V = { settings: {}, bookmarks: [], tabs: [], isPrivate: false, platform: 'darwin' };

/* ---------- what the screens moved over from Relay expect ---------- */
window.RelayApp = {
  $, $$, esc, uid, ic, toast, popMenu, openModal,
  state: { ui: { platform: 'browser' }, settings: {}, browser: {} },
  isShown: (kind) => V.isShown?.(kind) || false,
  setPlatform: (kind) => V.openInternal?.(kind),
  renderTabs: () => V.renderTabs?.()
};
window.Browser = { openTab: (url) => V.openTab?.(url) };
