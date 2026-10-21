// Trace — small shared helpers: DOM, icons, toasts, modals, menus, sanitizing.
(function () {
  const T = (window.T = window.T || {});
  const ABC = 'abcdefghijklmnopqrstuvwxyz0123456789';
  T.uid = (n = 10) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ABC[b % 36]).join('');
  T.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  T.$ = (sel, root = document) => root.querySelector(sel);
  T.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  T.el = (html) => { const t = document.createElement('template'); t.innerHTML = String(html).trim(); return t.content.firstElementChild; };
  T.debounce = (fn, ms) => { let t = null, last = []; const d = (...a) => { last = a; clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); }; d.flush = () => { if (t === null) return; clearTimeout(t); t = null; return fn(...last); }; d.cancel = () => { clearTimeout(t); t = null; }; return d; };
  T.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  T.isMac = navigator.platform.includes('Mac');
  T.kbd = (s) => T.isMac ? s.replace(/Mod\+/g, '⌘').replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥').replace(/Ctrl\+/g, '⌃') : s.replace(/Mod\+/g, 'Ctrl+');
  T.accel = (s) => String(s || '').replace('CommandOrControl', 'Mod').replace('CmdOrCtrl', 'Mod');
  T.mod = (e) => (T.isMac ? e.metaKey : e.ctrlKey);
  T.mediaUrl = (pid, file) => `trace-media://m/${pid}/${encodeURIComponent(file)}`;
  T.clone = (o) => JSON.parse(JSON.stringify(o));
  T.fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso), now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (diff < 6 * 86400) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  };
  T.plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  // ---- colors used for nodes, projects and scenarios ----
  T.COLORS = {
    violet: '#9d8cff', blue: '#5b9dff', cyan: '#3fd0e8', green: '#4cd38a', lime: '#b5d94a', amber: '#f5b84a',
    orange: '#ff8a4c', rose: '#ff6b8f', pink: '#ec7bf0', slate: '#94a0b8'
  };
  T.colorOf = (c) => T.COLORS[c] || c || T.COLORS.violet;

  // ---- icons (24px, stroked) ----
  const P = {
    plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6 6 18', check: 'M5 12.5l4.5 4.5L19 7.5',
    chevron: 'M9 6l6 6-6 6', chevdown: 'M6 9l6 6 6-6', chevleft: 'M15 6l-6 6 6 6', back: 'M19 12H5M11 18l-6-6 6-6', next: 'M5 12h14M13 6l6 6-6 6',
    chart: 'M9 4h6v4H9zM4 16h6v4H4zM14 16h6v4h-6zM12 8v4M7 16v-2h10v2', note: 'M6 3.5h9l4 4V20a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 20zM14.5 3.5V8H19M9 12h7M9 15.5h7',
    guide: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z',
    camera: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2.5h6L16.5 7h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    region: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3',
    screen: 'M3 4.5h18v12H3zM8 20h8M12 16.5V20', repeat: 'M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5',
    images: 'M3.5 6.5h13v11h-13zM7 3.5h13.5v11M3.5 15l4-4 3 3 2-2 4 4M12.5 10a.5.5 0 1 0 0-1', image: 'M4 5h16v14H4zM4 16l5-5 4 4 2.5-2.5L20 17M15.5 9a1 1 0 1 0 0-.01',
    play: 'M8 5.5v13l10.5-6.5z', pause: 'M8 5h3v14H8zM13 5h3v14h-3z', present: 'M3 4h18M4 4v10.5A1.5 1.5 0 0 0 5.5 16h13a1.5 1.5 0 0 0 1.5-1.5V4M12 16v4M8.5 20h7M10 8l4 2.2-4 2.2z',
    pdf: 'M7 3.5h7l4.5 4.5v12.5h-11.5zM13.5 3.5V8.5H18.5M9 13.5h1.6a1.2 1.2 0 0 1 0 2.4H9v-4.6M13.5 11.3v4.6h1a2 2 0 0 0 0-4.6z',
    download: 'M12 4v11M7 10.5l5 5 5-5M5 19.5h14', upload: 'M12 19V8M7 12.5l5-5 5 5M5 4.5h14', share: 'M8.5 10.5l7-4M8.5 13.5l7 4M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    trash: 'M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10.5 10.5v6M13.5 10.5v6', edit: 'M14.5 5.5l4 4L8 20H4v-4zM13 7l4 4',
    copy: 'M8.5 8.5h11v11h-11zM15.5 8.5V4.5h-11v11h4', search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
    trace: 'M5 4.5h4v4H5zM15 15.5h4v4h-4zM7 8.5V12h10v3.5', route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9.5A2.5 2.5 0 0 1 8.5 7H16M18 9v5.5a2.5 2.5 0 0 1-2.5 2.5H8',
    vertical: 'M9 3.5h6v4H9zM4 16.5h6v4H4zM14 16.5h6v4h-6zM12 7.5v4.5M7 16.5V12h10v4.5', horizontal: 'M3.5 9v6h4V9zM16.5 4v6h4V4zM16.5 14v6h4v-6zM7.5 12H12M16.5 7H12v10h4.5',
    tidy: 'M4 6h10M4 12h16M4 18h7M17 4v4M14 6h6', fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5', minus: 'M5 12h14', undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11', redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
    folder: 'M3.5 7A1.5 1.5 0 0 1 5 5.5h4.2l2 2.2H19A1.5 1.5 0 0 1 20.5 9.2v8.3A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z', file: 'M7 3.5h7l4.5 4.5v12.5h-11.5zM13.5 3.5V8.5H18.5',
    person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0', people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14a6.5 6.5 0 0 1 3.5 6',
    step: 'M4.5 6.5A2 2 0 0 1 6.5 4.5h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2zM8.5 12h7', start: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 8.5l5 3.5-5 3.5z', end: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9h6v6H9z',
    decision: 'M12 2.8 21.2 12 12 21.2 2.8 12zM10 9.6a2.1 2.1 0 1 1 2.7 2c-.5.2-.7.6-.7 1.1v.4M12 15.6v.1', and: 'M7 5h4a7 7 0 0 1 0 14H7zM3 9h4M3 15h4M18 12h3', or: 'M5 5c4 0 9 2 12 7-3 5-8 7-12 7 2-4 2-10 0-14zM2 9h5M2 15h5M17 12h4',
    sticky: 'M5 4.5h14v9.5l-5.5 5.5H5zM13.5 19.5V14H19', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    collapse: 'M8 4.5l4 4 4-4M8 19.5l4-4 4 4M4 12h16', expand: 'M8 8.5l4-4 4 4M8 15.5l4 4 4-4', grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
    more: 'M5 12h.01M12 12h.01M19 12h.01', bookmark: 'M6.5 4h11v16.5L12 16.5l-5.5 4z', sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z', sidebar: 'M4 4.5h16v15H4zM9.5 4.5v15', panel: 'M4 4.5h16v15H4zM14.5 4.5v15', home: 'M4 10.5 12 4l8 6.5V20h-5.5v-6h-5v6H4z',
    sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    arrow: 'M5 19 19 5M10 5h9v9', box: 'M4.5 5.5h15v13h-15z', circle: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', text: 'M5 6V4.5h14V6M12 4.5v15M9 19.5h6', highlight: 'M4 15.5h16v4H4zM8 15.5l1.5-9h5l1.5 9',
    blur: 'M6 6h2v2H6zM11 6h2v2h-2zM16 6h2v2h-2zM6 11h2v2H6zM11 11h2v2h-2zM16 11h2v2h-2zM6 16h2v2H6zM11 16h2v2h-2zM16 16h2v2h-2z', number: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10.5 9l2-1.5V16',
    crop: 'M6 2.5V18h15.5M2.5 6H18v15.5', cursor: 'M5 3.5l13 6.2-5.6 1.8-1.8 5.6z', pen: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
    bold: 'M7 4.5h6a3.5 3.5 0 0 1 0 7H7zM7 11.5h7a4 4 0 0 1 0 8H7z', italic: 'M14 4.5h-4M14 19.5h-4M14 4.5 10 19.5', underline: 'M7 4v7a5 5 0 0 0 10 0V4M5.5 20h13', strike: 'M5 12h14M16 6.5A4 4 0 0 0 12.5 5h-1A3.5 3.5 0 0 0 10 11.7M8 17.5A4 4 0 0 0 11.5 19h1a3.5 3.5 0 0 0 3.5-3.5',
    h1: 'M4 6v12M12 6v12M4 12h8M16.5 9l2.5-2v11', ul: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01', ol: 'M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M4 14.5a1.5 1.5 0 1 1 2.5 1L4 19h3',
    checklist: 'M3.5 6.5l1.5 1.5 3-3M3.5 15.5l1.5 1.5 3-3M11 7h9.5M11 16h9.5', quote: 'M5 10.5h4.5V17H5zM5 10.5C5 7 6.5 5.5 9 5M14 10.5h4.5V17H14zM14 10.5C14 7 15.5 5.5 18 5', code: 'M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5', hr: 'M4 12h16',
    eye: 'M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', clipboard: 'M8.5 4.5h-2a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-14a1 1 0 0 0-1-1h-2M8.5 3.5h7v3h-7z',
    keyboard: 'M3 6.5h18v11H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10', info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01', target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
    dots: 'M12 6h.01M12 12h.01M12 18h.01', palette: 'M12 21a9 9 0 1 1 9-9c0 2.5-2 3.5-4 3.5h-2a2 2 0 0 0-1.5 3.3c.6.8.3 2.2-1.5 2.2zM7.5 11h.01M10 7h.01M15 7.5h.01'
  };
  T.icon = (name, size = 16, cls = '') => `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[name] || P.step}"/></svg>`;
  T.ICON_PATHS = P;

  // ---- toast ----
  let toastTimer;
  T.toast = (msg, opts = {}) => {
    const el = T.$('#toast');
    el.innerHTML = `<span>${T.esc(msg)}</span>` + (opts.action ? `<button class="link">${T.esc(opts.action)}</button>` : '');
    el.className = 'show ' + (opts.kind || '');
    if (opts.action) el.querySelector('button').onclick = () => { el.className = ''; opts.onAction && opts.onAction(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, opts.ms || (opts.action ? 6000 : 2600));
  };

  // ---- modal ----
  T.modal = ({ title, body, actions = [], wide, cls = '', onClose, closeOnBackdrop = true }) => {
    const host = T.el(`<div class="modal-back"><div class="modal ${wide ? 'wide' : ''} ${cls}" role="dialog" aria-modal="true">
      ${title ? `<div class="modal-head"><h3>${T.esc(title)}</h3><button class="icon-btn ghost m-close" aria-label="Close">${T.icon('x')}</button></div>` : ''}
      <div class="modal-body"></div>${actions.length ? '<div class="modal-foot"></div>' : ''}</div></div>`);
    const b = host.querySelector('.modal-body');
    if (typeof body === 'string') b.innerHTML = body; else if (body) b.appendChild(body);
    const close = (v) => { if (!host.isConnected) return; host.classList.add('out'); setTimeout(() => host.remove(), 140); document.removeEventListener('keydown', key, true); onClose && onClose(v); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    document.addEventListener('keydown', key, true);
    const foot = host.querySelector('.modal-foot');
    for (const a of actions) {
      const btn = T.el(`<button class="btn ${a.kind || ''}">${a.icon ? T.icon(a.icon) : ''}${T.esc(a.label)}</button>`);
      btn.onclick = async () => { if (a.onClick) { const r = await a.onClick(); if (r === false) return; } close(a.value); };
      if (a.left) { btn.classList.add('left'); }
      foot.appendChild(btn);
    }
    const x = host.querySelector('.m-close'); if (x) x.onclick = () => close();
    if (closeOnBackdrop) host.addEventListener('pointerdown', (e) => { if (e.target === host) close(); });
    document.body.appendChild(host);
    requestAnimationFrame(() => host.classList.add('in'));
    const first = host.querySelector('[autofocus], input, textarea, select');
    if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 30);
    return { el: host, body: b, close };
  };
  T.confirm = (title, text, ok = 'OK', danger) => new Promise((res) => {
    let v = false;
    T.modal({ title, body: `<p class="muted">${T.esc(text)}</p>`, onClose: () => res(v),
      actions: [{ label: 'Cancel' }, { label: ok, kind: danger ? 'danger' : 'primary', onClick: () => { v = true; } }] });
  });
  T.prompt = (title, value = '', placeholder = '', ok = 'Save') => new Promise((res) => {
    let v = null;
    const m = T.modal({ title, body: `<input class="input" type="text" value="${T.esc(value)}" placeholder="${T.esc(placeholder)}" autofocus>`, onClose: () => res(v),
      actions: [{ label: 'Cancel' }, { label: ok, kind: 'primary', onClick: () => { v = m.body.querySelector('input').value.trim(); } }] });
    m.body.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { v = e.target.value.trim(); m.close(); } });
  });

  // ---- context menu ----
  let openMenu = null;
  T.closeMenu = () => { if (openMenu) { openMenu.remove(); openMenu = null; } };
  T.menu = (x, y, items, opts = {}) => {
    T.closeMenu();
    const m = T.el('<div class="menu" role="menu"></div>');
    const build = (host, list) => {
      for (const it of list) {
        if (!it) continue;
        if (it.sep) { host.appendChild(T.el('<div class="menu-sep"></div>')); continue; }
        if (it.header) { host.appendChild(T.el(`<div class="menu-head">${T.esc(it.header)}</div>`)); continue; }
        const row = T.el(`<button class="menu-item ${it.danger ? 'danger' : ''} ${it.disabled ? 'disabled' : ''}" role="menuitem">
          <span class="mi-ic">${it.swatch ? `<i class="sw" style="background:${it.swatch}"></i>` : it.icon ? T.icon(it.icon) : it.checked ? T.icon('check') : ''}</span>
          <span class="mi-label">${T.esc(it.label)}</span>${it.kbd ? `<span class="mi-kbd">${T.esc(T.kbd(it.kbd))}</span>` : ''}${it.sub ? T.icon('chevron', 14, 'mi-sub') : ''}</button>`);
        if (it.sub) {
          const sub = T.el('<div class="menu sub"></div>');
          build(sub, it.sub);
          row.appendChild(sub);
          row.addEventListener('pointerenter', () => {
            const r = row.getBoundingClientRect();
            sub.style.display = 'block';
            const sw = sub.offsetWidth, sh = sub.offsetHeight;
            sub.style.left = (r.right + sw > innerWidth - 8 ? -sw + 4 : r.width - 4) + 'px';
            sub.style.top = Math.min(0, innerHeight - 8 - r.top - sh) - 5 + 'px';
          });
          row.addEventListener('pointerleave', () => { sub.style.display = 'none'; });
        } else if (!it.disabled) row.onclick = (e) => { e.stopPropagation(); T.closeMenu(); it.onClick && it.onClick(); };
        host.appendChild(row);
      }
    };
    build(m, items);
    document.body.appendChild(m);
    const w = m.offsetWidth, hgt = m.offsetHeight;
    m.style.left = Math.min(x, innerWidth - w - 8) + 'px';
    m.style.top = (y + hgt > innerHeight - 8 ? Math.max(8, (opts.above ? y - hgt : innerHeight - hgt - 8)) : y) + 'px';
    openMenu = m;
    setTimeout(() => {
      const off = (e) => { if (!m.contains(e.target)) { T.closeMenu(); document.removeEventListener('pointerdown', off, true); } };
      document.addEventListener('pointerdown', off, true);
    });
    return m;
  };
  T.menuAt = (btn, items) => { const r = btn.getBoundingClientRect(); return T.menu(r.left, r.bottom + 6, items); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openMenu) { e.stopPropagation(); T.closeMenu(); } }, true);

  // ---- HTML sanitizing for notes (allowlist) ----
  const TAGS = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'MARK', 'CODE', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'A', 'IMG', 'HR', 'DIV', 'SPAN', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'SUB', 'SUP', 'FIGURE', 'FIGCAPTION']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TITLE', 'HEAD', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'VIDEO', 'AUDIO', 'CANVAS', 'NOSCRIPT', 'TEMPLATE']);
  T.sanitize = (html) => {
    const doc = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html');
    const walk = (node) => {
      for (const c of Array.from(node.childNodes)) {
        if (c.nodeType === 8) { c.remove(); continue; }
        if (c.nodeType !== 1) continue;
        if (DROP.has(c.tagName)) { c.remove(); continue; }
        walk(c);
        if (!TAGS.has(c.tagName)) { c.replaceWith(...Array.from(c.childNodes)); continue; }
        for (const a of Array.from(c.attributes)) {
          const n = a.name.toLowerCase(), v = a.value;
          const keep = (n === 'href' && c.tagName === 'A' && /^(https?:|mailto:)/i.test(v)) ||
            (n === 'src' && c.tagName === 'IMG' && /^(trace-media:|data:image\/)/i.test(v)) ||
            (n === 'data-checked' && c.tagName === 'LI') || (n === 'class' && /^(checklist|callout|done)$/.test(v)) ||
            (n === 'data-media') || (n === 'alt') || (n === 'colspan' || n === 'rowspan');
          if (!keep) c.removeAttribute(a.name);
        }
        if (c.tagName === 'A') { c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noreferrer'); }
      }
    };
    walk(doc.body);
    return doc.body.innerHTML;
  };
  T.textOf = (html) => { const d = document.createElement('div'); d.innerHTML = T.sanitize(html); d.querySelectorAll('li,p,h1,h2,h3,div,br').forEach((x) => x.append(' ')); return d.textContent.replace(/\s+/g, ' ').trim(); };

  // ---- drag helper: pointer capture with move/up callbacks ----
  T.drag = (e, move, up) => {
    const target = e.currentTarget || e.target;
    try { target.setPointerCapture(e.pointerId); } catch (_) {}
    const mv = (ev) => move && move(ev);
    const fin = (ev) => { target.removeEventListener('pointermove', mv); target.removeEventListener('pointerup', fin); target.removeEventListener('pointercancel', fin); up && up(ev); };
    target.addEventListener('pointermove', mv);
    target.addEventListener('pointerup', fin);
    target.addEventListener('pointercancel', fin);
  };

  T.ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  T.animate = (dur, step, done) => {
    const t0 = performance.now();
    let raf, stopped = false;
    const tick = (now) => {
      if (stopped) return;
      const t = Math.min(1, (now - t0) / dur);
      step(T.ease(t), t);
      if (t < 1) raf = requestAnimationFrame(tick); else done && done();
    };
    raf = requestAnimationFrame(tick);
    return { stop: () => { stopped = true; cancelAnimationFrame(raf); } };
  };
})();
