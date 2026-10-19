// Datum - renderer core: namespace, state, history, DOM helpers, UI primitives
(function () {
  const D = (window.D = {});
  // null/false-safe append & prepend so optional UI pieces can be passed inline
  for (const proto of [Element.prototype, DocumentFragment.prototype]) {
    for (const m of ['append', 'prepend']) {
      const orig = proto[m];
      proto[m] = function (...a) { return orig.apply(this, a.filter((x) => x != null && x !== false)); };
    }
  }
  D.uid = () => Math.random().toString(36).slice(2, 10);
  D.clone = (o) => JSON.parse(JSON.stringify(o));
  D.esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  D.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  D.sheetTypes = {};

  // ---------- tiny DOM builder
  D.h = function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
  };
  const h = D.h;

  // ---------- icons (stroke icons, 24 grid)
  const P = {
    data: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    slide: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M12 17v4M8 21h8"/>',
    docu: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    report: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    folderOpen: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1"/><path d="M3 19l3-8h16l-3 8z"/>',
    save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8M7 21v-7h10v7"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    bold: '<path d="M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z"/>',
    italic: '<path d="M19 4h-9M14 20H5M15 4L9 20"/>',
    underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4M4 21h16"/>',
    alignLeft: '<path d="M4 6h16M4 12h10M4 18h14"/>',
    alignCenter: '<path d="M4 6h16M7 12h10M5 18h14"/>',
    alignRight: '<path d="M4 6h16M10 12h10M6 18h14"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    listOl: '<path d="M10 6h10M10 12h10M10 18h10M4 4.5h1.5V9M4 9h3M4 14.5c1-1 3-1 3 .5S4 17 4 19h3"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
    text: '<path d="M4 7V5h16v2M9 20h6M12 5v15"/>',
    shape: '<rect x="3" y="3" width="11" height="11" rx="1.5"/><circle cx="16" cy="16" r="5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    line: '<path d="M3 17l6-6 4 4 8-8M3 21h18"/>',
    pie: '<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M10 4v16"/>',
    kpi: '<path d="M4 18h16"/><path d="M7 14l3-4 3 2 4-6"/><circle cx="17" cy="6" r="1.2"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    right: '<path d="M9 6l6 6-6 6"/>',
    up: '<path d="M18 15l-6-6-6 6"/>',
    arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    palette: '<circle cx="13.5" cy="6.5" r="1.3"/><circle cx="17.5" cy="10.5" r="1.3"/><circle cx="8.5" cy="7.5" r="1.3"/><circle cx="6.5" cy="12.5" r="1.3"/><path d="M12 2a10 10 0 0 0 0 20c1 0 1.6-.8 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7H16a6 6 0 0 0 6-6c0-4.9-4.5-8.4-10-8.4z"/>',
    sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    fileUp: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15l3-3 3 3"/>',
    send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
    layers: '<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>',
    pagebreak: '<path d="M4 8V4h16v4M4 16v4h16v-4M2 12h3M8 12h3M13 12h3M19 12h3"/>',
    quote: '<path d="M7 7h4v4c0 3-2 5-4 6M14 7h4v4c0 3-2 5-4 6"/>',
    sortAsc: '<path d="M4 6h7M4 12h5M4 18h3M17 4v16M13 8l4-4 4 4"/>',
    sortDesc: '<path d="M4 6h3M4 12h5M4 18h7M17 4v16M13 16l4 4 4-4"/>',
    freeze: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 9h18" stroke-width="3"/>',
    rows: '<path d="M3 5h18M3 12h18M3 19h18"/>',
    cols: '<path d="M5 3v18M12 3v18M19 3v18"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    command: '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 0 0 0-6z"/>',
    zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/>',
    pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 17v-4h1.5a1.5 1.5 0 0 1 0 3H8M13 13v4M13 13h1a2 2 0 0 1 0 4h-1"/>',
    minus: '<path d="M5 12h14"/>',
    heading: '<path d="M6 4v16M18 4v16M6 12h12"/>',
    fill: '<path d="M19 11l-8-8-8.5 8.5a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0z"/><path d="M5 2l5 5M2 13h15M22 20a2 2 0 1 1-4 0c0-1.6 2-4 2-4s2 2.4 2 4z"/>',
    sigma: '<path d="M18 7V4H6l6 8-6 8h12v-3"/>',
    front: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
    back: '<rect x="3" y="3" width="13" height="13" rx="2"/><path d="M20 8v11a1 1 0 0 1-1 1H8"/>',
    filter: '<path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/>',
    strike: '<path d="M16 6.5C15 5 13.5 4 11.5 4 9 4 7 5.5 7 7.5c0 1.6 1.1 2.7 3 3.4M4 12h16M8 17.5c1 1.6 2.6 2.5 4.5 2.5 2.7 0 4.5-1.5 4.5-3.5 0-.8-.3-1.5-.8-2"/>',
    wrap: '<path d="M3 6h18M3 12h15a3 3 0 0 1 0 6h-4"/><path d="M16 16l-2 2 2 2M3 18h7"/>',
    decLess: '<path d="M14 8h-2.5a2.5 2.5 0 0 0-2.5 2.5v3a2.5 2.5 0 0 0 2.5 2.5H14"/><circle cx="5" cy="16" r="1"/><path d="M22 12h-5M19 9l-3 3 3 3"/>',
    decMore: '<path d="M11 8H8.5A2.5 2.5 0 0 0 6 10.5v3A2.5 2.5 0 0 0 8.5 16H11"/><circle cx="3" cy="16" r="1"/><path d="M14 12h7M18 9l3 3-3 3"/>',
    border: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 12h18M12 3v18" stroke-dasharray="2 2"/>',
    page: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6"/>',
    rotate: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'
  };
  D.icon = (name, size = 16, extra = '') =>
    `<svg class="ic ${extra}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || P.file}</svg>`;
  D.iconEl = (name, size, extra) => { const s = h('span', { class: 'ic-wrap', html: D.icon(name, size, extra) }); return s; };

  D.TYPE_META = {
    data: { label: 'Data Sheet', short: 'Data', icon: 'data', color: '#00C2FF', ext: 'xlsx', hint: 'Spreadsheet with formulas - saves as Excel' },
    slide: { label: 'Slide Sheet', short: 'Slides', icon: 'slide', color: '#3D7BFF', ext: 'pptx', hint: 'Presentation deck - saves as PowerPoint' },
    docu: { label: 'Docu Sheet', short: 'Docu', icon: 'docu', color: '#8B9BFF', ext: 'docx', hint: 'Document - saves as Word or PDF' },
    report: { label: 'Report Sheet', short: 'Report', icon: 'report', color: '#2EE6C9', ext: 'pdf', hint: 'Report pages of charts, KPIs and insights (saves as PDF)' },
    dash: { label: 'Dashboard Sheet', short: 'Dashboard', icon: 'grid', color: '#F5B544', ext: 'pdf', hint: 'Live grid of widgets with date range and sheet filters (saves as PDF)' }
  };

  // ---------- state
  D.state = { project: null, dirty: false };
  D.DEFAULT_BRAND = { primary: '#1F6BFF', accent: '#00C2FF', dark: '#0B1530', font: 'Inter', docFont: 'Calibri', logo: null, palette: ['#1F6BFF', '#00C2FF', '#7C5CFF', '#14B8A6', '#F59E0B', '#EF4444', '#64748B'] };
  D.project = () => D.state.project;
  D.sheet = (id) => D.state.project && D.state.project.sheets.find((s) => s.id === id);
  D.sheetByName = (name, near) => {
    if (!D.state.project) return null;
    const n = String(name).toLowerCase();
    const all = D.state.project.sheets;
    // exact tab name first; then the original workbook tab name (imported workbooks rename tabs "file · tab")
    return all.find((s) => s.name.toLowerCase() === n) || all.find((s) => s.wsName && s.wsName.toLowerCase() === n && (!near || String(s.name).split(' · ')[0] === String(near.name).split(' · ')[0])) || all.find((s) => s.wsName && s.wsName.toLowerCase() === n);
  };
  D.active = () => D.state.project && D.sheet(D.state.project.activeId);
  D.dataSheets = () => (D.state.project ? D.state.project.sheets.filter((s) => s.type === 'data') : []);
  D.brand = () => (D.state.project && D.state.project.brand) || D.DEFAULT_BRAND;

  D.uniqueSheetName = (base) => {
    const names = new Set((D.project()?.sheets || []).map((s) => s.name.toLowerCase()));
    let n = base, i = 2;
    while (names.has(n.toLowerCase())) n = `${base} ${i++}`;
    return n;
  };

  // ---------- events
  const listeners = {};
  D.on = (ev, fn) => { (listeners[ev] ||= []).push(fn); return () => { listeners[ev] = listeners[ev].filter((f) => f !== fn); }; };
  D.emit = (ev, ...a) => (listeners[ev] || []).forEach((f) => { try { f(...a); } catch (e) { console.error(e); } });

  // ---------- history (snapshot based)
  const hist = { stack: [], idx: -1 };
  D.dataVersion = 0;
  D.resetHistory = () => { hist.stack = [JSON.stringify(D.state.project)]; hist.idx = 0; };
  D.commit = (opts = {}) => {
    clearTimeout(D._commitT);
    if (!D.state.project) return;
    const snap = JSON.stringify(D.state.project);
    if (hist.stack[hist.idx] === snap) return;
    hist.stack = hist.stack.slice(0, hist.idx + 1);
    hist.stack.push(snap);
    if (hist.stack.length > 80) hist.stack.shift();
    hist.idx = hist.stack.length - 1;
    D.markDirty();
    if (opts.data !== false) D.dataVersion++;
    D.emit('changed');
  };
  D.commitSoon = (ms = 450) => { clearTimeout(D._commitT); D.markDirty(); D._commitT = setTimeout(() => D.commit(), ms); };
  D.canUndo = () => hist.idx > 0;
  D.canRedo = () => hist.idx < hist.stack.length - 1;
  function restore(i) {
    const activeId = D.state.project.activeId;
    hist.idx = i;
    D.state.project = JSON.parse(hist.stack[i]);
    if (D.sheet(activeId)) D.state.project.activeId = activeId;
    D.dataVersion++;
    D.markDirty();
    D.app.renderAll();
  }
  D.undo = () => { if (D._commitT) D.commit(); if (D.canUndo()) restore(hist.idx - 1); };
  D.redo = () => { if (D.canRedo()) restore(hist.idx + 1); };
  D.markDirty = () => {
    if (!D.state.dirty) { D.state.dirty = true; D.emit('dirty'); }
  };

  // ---------- toasts
  D.toast = (msg, kind = 'info', ms = 3200) => {
    let host = document.getElementById('toasts');
    const t = h('div', { class: `toast ${kind}` }, h('span', { class: 'toast-dot' }), h('span', null, msg));
    host.append(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms);
  };

  // ---------- modal
  D.modal = ({ title, body, actions = [], width = 520, onClose, className = '' }) => {
    const back = h('div', { class: 'modal-back' });
    const close = () => { back.classList.remove('in'); setTimeout(() => back.remove(), 160); document.removeEventListener('keydown', key, true); onClose && onClose(); };
    const key = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
        const p = actions.find((a) => a.primary);
        if (p) { e.preventDefault(); e.stopPropagation(); p.onClick && p.onClick(close) === false || (!p.keepOpen && close()); }
      }
    };
    const box = h('div', { class: `modal ${className}`, style: { width: width + 'px' } },
      h('div', { class: 'modal-head' }, h('div', { class: 'modal-title' }, title), h('button', { class: 'icon-btn ghost', onclick: close, html: D.icon('x') })),
      h('div', { class: 'modal-body' }, body),
      actions.length ? h('div', { class: 'modal-foot' }, actions.map((a) => h('button', {
        class: `btn ${a.primary ? 'primary' : a.danger ? 'danger' : 'ghost'}`,
        onclick: () => { const r = a.onClick && a.onClick(close); if (r !== false && !a.keepOpen) close(); }
      }, a.label))) : null);
    back.append(box);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    document.body.append(back);
    document.addEventListener('keydown', key, true);
    requestAnimationFrame(() => { back.classList.add('in'); const f = box.querySelector('input,select,textarea'); f && f.focus(); f && f.select && f.select(); });
    return close;
  };
  D.prompt = (title, value = '', placeholder = '') => new Promise((res) => {
    const input = h('input', { class: 'input', value, placeholder });
    let done = false;
    D.modal({ title, body: input, width: 420, onClose: () => { if (!done) res(null); }, actions: [
      { label: 'Cancel' },
      { label: 'OK', primary: true, onClick: () => { done = true; res(input.value.trim()); } }
    ] });
  });
  D.confirm = (title, msg, okLabel = 'Continue', danger = false) => new Promise((res) => {
    let done = false;
    D.modal({ title, body: h('p', { class: 'muted' }, msg), width: 440, onClose: () => { if (!done) res(false); }, actions: [
      { label: 'Cancel' },
      { label: okLabel, primary: !danger, danger, onClick: () => { done = true; res(true); } }
    ] });
  });
  D.choose = (title, msg, options) => new Promise((res) => {
    let done = false;
    D.modal({ title, body: h('p', { class: 'muted' }, msg), width: 460, onClose: () => { if (!done) res(null); }, actions: options.map((o) => ({ label: o.label, primary: o.primary, danger: o.danger, onClick: () => { done = true; res(o.value); } })) });
  });

  // ---------- context menu
  // Menus: submenus open on CLICK (not hover), any depth. Each level is its own panel.
  D.menu = (anchor, items, opts = {}) => {
    D.closeMenus();
    const stack = [];
    const closeFrom = (level) => { while (stack.length > level) { const p = stack.pop(); p.remove(); } };
    const place = (panel, x, y, fromRow) => {
      document.body.append(panel);
      if (fromRow) {
        const parent = fromRow.closest('.menu');
        const pr = parent.getBoundingClientRect();
        const r = fromRow.getBoundingClientRect();
        let dir = parent.dataset.dir || 'right';
        if (dir === 'right' && pr.right + 4 + panel.offsetWidth > innerWidth - 6) dir = 'left';
        if (dir === 'left' && pr.left - 4 - panel.offsetWidth < 6) dir = pr.right + 4 + panel.offsetWidth <= innerWidth - 6 ? 'right' : 'left';
        panel.dataset.dir = dir;
        panel.style.left = (dir === 'right' ? pr.right + 4 : Math.max(6, pr.left - panel.offsetWidth - 4)) + 'px';
        panel.style.top = D.clamp(r.top - 6, 6, innerHeight - panel.offsetHeight - 6) + 'px';
      } else {
        panel.style.left = D.clamp(x, 6, innerWidth - panel.offsetWidth - 6) + 'px';
        panel.style.top = (y + panel.offsetHeight > innerHeight - 6 ? Math.max(6, y - panel.offsetHeight - 30) : y) + 'px';
      }
    };
    const open = (list, level, x, y, fromRow) => {
      closeFrom(level);
      const panel = h('div', { class: `menu ${level ? 'sub' : ''}` });
      for (const it of list) {
        if (!it) continue;
        if (it.sep) { panel.append(h('div', { class: 'menu-sep' })); continue; }
        if (it.header) { panel.append(h('div', { class: 'menu-head' }, it.header)); continue; }
        const row = h('div', { class: `menu-item ${it.disabled ? 'disabled' : ''} ${it.danger ? 'danger' : ''} ${it.sub ? 'has-sub' : ''}` },
          it.icon ? h('span', { class: 'mi-ic', html: D.icon(it.icon, 15) }) : it.swatch ? h('span', { class: 'mi-sw', style: { background: it.swatch } }) : h('span', { class: 'mi-ic' }),
          h('span', { class: 'mi-label' }, it.label),
          it.kbd ? h('span', { class: 'mi-kbd' }, it.kbd) : null,
          it.sub ? h('span', { class: 'mi-arrow', html: D.icon('right', 13) }) : null,
          it.checked ? h('span', { class: 'mi-check', html: D.icon('check', 14) }) : null);
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          if (it.disabled) return;
          if (it.sub) {
            const wasOpen = row.classList.contains('open');
            panel.querySelectorAll('.menu-item.open').forEach((x) => x.classList.remove('open'));
            if (wasOpen) { closeFrom(level + 1); return; }
            row.classList.add('open');
            open(typeof it.sub === 'function' ? it.sub() : it.sub, level + 1, 0, 0, row);
            return;
          }
          D.closeMenus();
          it.onClick && it.onClick(e);
        });
        panel.append(row);
      }
      stack.push(panel);
      place(panel, x, y, fromRow);
      return panel;
    };
    let x, y;
    if (anchor instanceof Element) {
      const r = anchor.getBoundingClientRect();
      x = r.left; y = r.bottom + 4;
    } else { x = anchor.x; y = anchor.y; }
    const root = open(items, 0, x, y, null);
    if (opts.alignRight && anchor instanceof Element) root.style.left = Math.max(6, anchor.getBoundingClientRect().right - root.offsetWidth) + 'px';
    D._menuKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); if (stack.length > 1) { closeFrom(stack.length - 1); stack[stack.length - 1].querySelectorAll('.open').forEach((x) => x.classList.remove('open')); } else D.closeMenus(); } };
    document.addEventListener('keydown', D._menuKey, true);
    setTimeout(() => document.addEventListener('mousedown', D._menuOut, true), 0);
    return root;
  };
  D._menuOut = (e) => { if (!e.target.closest('.menu')) D.closeMenus(); };
  D.closeMenus = () => {
    document.querySelectorAll('.menu').forEach((m) => m.remove());
    document.removeEventListener('mousedown', D._menuOut, true);
    if (D._menuKey) document.removeEventListener('keydown', D._menuKey, true);
  };

  // ---------- small helpers
  D.btn = (icon, title, onClick, opts = {}) => {
    const b = h('button', { class: `tb-btn ${opts.cls || ''} ${opts.label ? 'with-label' : ''}`, title, onclick: onClick, html: (icon ? D.icon(icon, opts.size || 16) : '') + (opts.label ? `<span>${D.esc(opts.label)}</span>` : '') + (opts.caret ? D.icon('down', 12, 'caret') : '') });
    if (opts.active) b.classList.add('active');
    return b;
  };
  D.sep = () => h('div', { class: 'tb-sep' });
  D.colorInput = (value, onInput, title = 'Color') => {
    const wrap = h('label', { class: 'color-swatch', title });
    const inp = h('input', { type: 'color', value: value || '#000000' });
    wrap.style.setProperty('--sw', value || 'transparent');
    inp.addEventListener('input', () => { wrap.style.setProperty('--sw', inp.value); onInput(inp.value, false); });
    inp.addEventListener('change', () => onInput(inp.value, true));
    wrap.append(inp);
    return wrap;
  };
  D.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  D.fileToDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  D.loadImage = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  D.fmtTime = (t) => { const d = new Date(t); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
})();
