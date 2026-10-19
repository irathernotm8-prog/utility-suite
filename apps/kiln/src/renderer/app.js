/* Kiln — app shell: state, navigation, and shared UI pieces (toasts, dialogs, menus). */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtBytes = (b) => { b = Number(b) || 0; if (b < 1024) return b + ' B'; const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1); return (b >= 100 ? b.toFixed(0) : b >= 10 ? b.toFixed(1) : b.toFixed(2)) + ' ' + u[i]; };
  const fmtNum = (n) => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n); };
  const ago = (t) => { if (!t) return ''; const s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago'; return new Date(t).toLocaleDateString(); };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /* ---------- event bus ---------- */
  const handlers = {};
  const bus = {
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return () => { handlers[ev] = handlers[ev].filter(f => f !== fn); }; },
    emit(ev, d) { (handlers[ev] || []).slice().forEach(f => { try { f(d); } catch (e) { console.error(ev, e); } }); }
  };

  const state = { app: null, profile: null, settings: null, prompts: [], packages: [], running: [], downloads: [], page: null, types: window.KilnTypes.MODEL_TYPES };

  /* ---------- toasts ---------- */
  function toast(msg, kind = '', action) {
    const host = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = `${ic(kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'info', 16)}<span>${esc(msg)}</span>${action ? `<button class="toast-act">${esc(action.label)}</button>` : ''}`;
    if (action) $('.toast-act', el).onclick = () => { action.onClick(); el.remove(); };
    host.appendChild(el);
    setTimeout(() => el.classList.add('out'), kind === 'error' ? 6500 : 3800);
    setTimeout(() => el.remove(), kind === 'error' ? 7000 : 4300);
  }
  const fail = (e) => toast(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');

  /* ---------- dialogs ---------- */
  function modal({ title, subtitle, body = '', actions = [{ label: 'Close' }], wide = false, className = '', onMount, onClose, dismissable = true }) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''} ${className}" role="dialog" aria-modal="true" aria-label="${esc(title || '')}">
      ${title ? `<div class="modal-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${dismissable ? `<button class="icon-btn" data-x title="Close">${ic('x', 18)}</button>` : ''}</div>` : ''}
      <div class="modal-body">${body}</div>
      ${actions.length ? `<div class="modal-foot">${actions.map((a, i) => `<button class="btn ${a.kind || ''}" data-a="${i}" ${a.disabled ? 'disabled' : ''}>${a.icon ? ic(a.icon, 15) : ''}${esc(a.label)}</button>`).join('')}</div>` : ''}
    </div>`;
    document.body.appendChild(wrap);
    const m = $('.modal', wrap);
    const close = () => { wrap.classList.add('out'); setTimeout(() => wrap.remove(), 160); document.removeEventListener('keydown', onKey); onClose?.(); };
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) close();
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') { const p = actions.findIndex(a => a.kind?.includes('primary') || a.kind?.includes('danger')); if (p >= 0 && !e.target.closest('.no-enter')) { e.preventDefault(); $(`[data-a="${p}"]`, m).click(); } }
    };
    document.addEventListener('keydown', onKey);
    if (dismissable) wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    $('[data-x]', m)?.addEventListener('click', close);
    actions.forEach((a, i) => $(`[data-a="${i}"]`, m).onclick = async (ev) => {
      const btn = ev.currentTarget;
      if (a.onClick) {
        btn.disabled = true;
        try { const r = await a.onClick(m, close); if (r === false) { btn.disabled = false; return; } }
        catch (e) { fail(e); btn.disabled = false; return; }
      }
      close();
    });
    onMount?.(m, close);
    setTimeout(() => ($('[autofocus]', m) || $('input, textarea, select', m))?.focus(), 30);
    return { el: m, close };
  }
  function confirm(title, text, { ok = 'Continue', danger = false } = {}) {
    return new Promise((res) => {
      let done = false;
      modal({ title, body: text ? `<p class="lead">${esc(text)}</p>` : '', onClose: () => { if (!done) res(false); },
        actions: [{ label: 'Cancel' }, { label: ok, kind: danger ? 'danger' : 'primary', onClick: () => { done = true; res(true); } }] });
    });
  }
  function ask(title, { label = '', value = '', placeholder = '', ok = 'Save', textarea = false, subtitle } = {}) {
    return new Promise((res) => {
      let done = false;
      modal({ title, subtitle, onClose: () => { if (!done) res(null); },
        body: `<label class="field"><span>${esc(label)}</span>${textarea ? `<textarea class="input" rows="4" id="askV" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="input" id="askV" value="${esc(value)}" placeholder="${esc(placeholder)}">`}</label>`,
        actions: [{ label: 'Cancel' }, { label: ok, kind: 'primary', onClick: (m) => { done = true; res($('#askV', m).value); } }] });
    });
  }

  /* ---------- menus ---------- */
  let openMenuEl = null;
  function menu(x, y, items) {
    closeMenu();
    const el = document.createElement('div');
    el.className = 'menu';
    el.innerHTML = items.filter(Boolean).map((it, i) => it === '-' ? '<div class="menu-sep"></div>' : it.html ? `<div class="menu-html">${it.html}</div>` :
      `<button class="menu-item ${it.danger ? 'danger' : ''} ${it.checked ? 'checked' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>${it.icon ? ic(it.icon, 15) : '<span class="ic-sp"></span>'}<span>${esc(it.label)}</span>${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}${it.checked ? ic('check', 14, 'menu-check') : ''}</button>`).join('');
    document.body.appendChild(el);
    const r = el.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
    const list = items.filter(Boolean);
    $$('[data-i]', el).forEach(b => b.onclick = () => { const it = list[Number(b.dataset.i)]; closeMenu(); it.onClick?.(); });
    openMenuEl = el;
    setTimeout(() => document.addEventListener('mousedown', outside), 0);
  }
  function outside(e) { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); }
  function closeMenu() { openMenuEl?.remove(); openMenuEl = null; document.removeEventListener('mousedown', outside); }
  function menuAt(btn, items, align = 'left') { const r = btn.getBoundingClientRect(); menu(align === 'right' ? r.right - 240 : r.left, r.bottom + 6, items); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  /* ---------- pages ---------- */
  const pages = {};
  const NAV = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'generate', label: 'Generate', icon: 'wand' },
    { id: 'gallery', label: 'Gallery', icon: 'image' },
    { id: 'prompts', label: 'Prompts', icon: 'quote' },
    { sep: true, label: 'Models' },
    { id: 'models', label: 'My models', icon: 'cube' },
    { id: 'discover', label: 'Find models', icon: 'compass' },
    { sep: true, label: 'Run' },
    { id: 'packages', label: 'Packages', icon: 'pkg' },
    { id: 'browser', label: 'Browser', icon: 'globe' }
  ];
  function register(id, page) { pages[id] = page; }
  function go(id, params) {
    const page = pages[id];
    if (!page || !state.profile) return;
    closeMenu();
    const prev = state.page;
    if (prev && prev !== id) { pages[prev]?.hide?.(); $(`.page[data-page="${prev}"]`)?.classList.remove('on'); }
    let el = $(`.page[data-page="${id}"]`);
    if (!el) {
      el = document.createElement('section');
      el.className = 'page';
      el.dataset.page = id;
      $('#pages').appendChild(el);
      page.mount(el);
    }
    el.classList.add('on');
    state.page = id;
    $$('.rail-item').forEach(b => b.classList.toggle('on', b.dataset.go === id));
    $('#pageTitle').textContent = page.title || '';
    page.show?.(params || {});
  }

  /* ---------- shell ---------- */
  function avatar(p, size = 'md') {
    const letter = esc((p.avatar || p.name || '?').trim().slice(0, p.avatar ? 2 : 1).toUpperCase());
    return `<span class="avatar ${size}" style="--pc:${esc(p.color || '#ff9a4a')}">${letter}</span>`;
  }
  // The shell and the pages are built once; switching profiles resets their state instead of
  // rebuilding them, so each page's event listeners are only ever registered once.
  function buildShell() {
    const root = $('#app');
    if ($('#pages', root)) {
      $('#profileBtn').innerHTML = `${avatar(state.profile, 'sm')}<span>${esc(state.profile.name)}</span>${ic('chevronDown', 14)}`;
      $$('.page.on').forEach(p => p.classList.remove('on'));
      window.Downloads.toggle(false);
      renderRunPill();
      return;
    }
    root.className = 'app ' + (state.app.platform === 'darwin' ? 'mac' : 'win');
    root.innerHTML = `
      <header class="titlebar">
        <div class="brand"><img src="kiln-mark.svg" alt="" class="brand-mark"><span>Kiln</span></div>
        <div class="tb-title" id="pageTitle"></div>
        <div class="tb-right">
          <div id="runPill"></div>
          <button class="tb-btn" id="dlBtn" title="Downloads">${ic('download', 17)}<span class="dl-badge" id="dlBadge" hidden></span></button>
          <button class="tb-profile" id="profileBtn" title="Profile">${avatar(state.profile, 'sm')}<span>${esc(state.profile.name)}</span>${ic('chevronDown', 14)}</button>
        </div>
      </header>
      <nav class="rail">
        ${NAV.map(n => n.sep ? `<div class="rail-sep">${esc(n.label)}</div>` : `<button class="rail-item" data-go="${n.id}">${ic(n.icon, 18)}<span>${esc(n.label)}</span></button>`).join('')}
        <div class="rail-fill"></div>
        <button class="rail-item" data-go="settings">${ic('settings', 18)}<span>Settings</span></button>
      </nav>
      <main id="pages"></main>
      <aside class="drawer" id="drawer" hidden></aside>`;
    $$('.rail-item', root).forEach(b => b.onclick = () => go(b.dataset.go));
    $('#profileBtn').onclick = (e) => profileMenu(e.currentTarget);
    $('#dlBtn').onclick = () => window.Downloads.toggle();
    renderRunPill();
  }
  function profileMenu(btn) {
    const others = state.app.profiles.filter(p => p.id !== state.profile.id);
    menuAt(btn, [
      { html: `<div class="menu-profile">${avatar(state.profile)}<div><b>${esc(state.profile.name)}</b><small>${esc(state.profile.libraryName)}${state.profile.sharedWith.length ? ` · shared with ${esc(state.profile.sharedWith.join(', '))}` : ''}</small></div></div>` },
      ...others.map(p => ({ label: `Switch to ${p.name}`, icon: p.hasPin ? 'lock' : 'user', onClick: () => window.Profiles.open(p.id) })),
      others.length ? '-' : null,
      { label: 'All profiles…', icon: 'users', onClick: () => window.Profiles.picker() },
      { label: 'Profile settings', icon: 'settings', onClick: () => go('settings', { tab: 'profile' }) },
      ...(state.profile.hasPin ? [{ label: 'Lock', icon: 'lock', onClick: () => window.Profiles.lock() }] : [])
    ], 'right');
  }
  function renderRunPill() {
    const el = $('#runPill');
    if (!el) return;
    const r = state.running;
    if (!r.length) { el.innerHTML = ''; return; }
    const main = r[0];
    el.innerHTML = `<button class="run-pill ${main.state}" title="${esc(main.name)} is ${main.state}"><i></i><span>${esc(main.name)}${r.length > 1 ? ` +${r.length - 1}` : ''}</span><small>${main.state === 'running' ? 'running' : 'starting…'}</small></button>`;
    $('.run-pill', el).onclick = (e) => menuAt(e.currentTarget, r.flatMap(x => [
      { html: `<div class="menu-h">${esc(x.name)} · ${x.state}</div>` },
      ...(x.url ? [{ label: 'Open its web UI', icon: 'globe', onClick: () => window.Browser.openUrl(x.url, { title: x.name }) }] : []),
      ...(x.backend && x.state === 'running' ? [{ label: 'Generate with it', icon: 'wand', onClick: () => go('generate', { pkgId: x.id }) }] : []),
      { label: 'Console', icon: 'terminal', onClick: () => go('packages', { id: x.id, tab: 'console' }) },
      { label: 'Stop', icon: 'stop', danger: true, onClick: () => kiln.pkg.stop(x.id) }, '-'
    ]).slice(0, -1), 'right');
  }
  async function refreshRunning() {
    state.running = await kiln.pkg.running();
    renderRunPill();
    bus.emit('running', state.running);
  }

  /* ---------- profile lifecycle ---------- */
  async function enterProfile(ps) {
    state.profile = ps.profile; state.settings = ps.settings; state.prompts = ps.prompts || [];
    state.browserState = ps.browser;
    document.documentElement.dataset.theme = ps.settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : ps.settings.theme;
    if (state.page) pages[state.page]?.hide?.();
    state.page = null;
    for (const id of Object.keys(pages)) pages[id].reset?.();
    buildShell();
    state.packages = await kiln.pkg.list();
    await refreshRunning();
    const other = state.packages.filter(p => p.status?.state === 'running' && p.status.profileId && p.status.profileId !== state.profile.id);
    if (other.length) toast(`${other[0].name} is still using another profile’s models`, '', { label: 'Restart it', onClick: async () => { try { await kiln.pkg.stop(other[0].id); await kiln.pkg.launch(other[0].id); } catch (e) { fail(e); } } });
    window.Downloads.load();
    go('home');
  }
  function saveSettings(patch) {
    return kiln.settings.save(patch).then(s => { state.settings = s; bus.emit('settings', s); return s; });
  }

  /* ---------- wiring main-process events ---------- */
  kiln.pkg.onStatus((s) => { const p = state.packages.find(x => x.id === s.id); if (p) p.status = s; bus.emit('pkg:status', s); refreshRunning(); });
  kiln.pkg.onList((l) => { state.packages = l; bus.emit('pkg:list', l); });
  kiln.pkg.onLog((d) => bus.emit('pkg:log', d));
  kiln.pkg.onReady((d) => {
    const p = state.packages.find(x => x.id === d.id);
    toast(`${p?.name || 'Package'} is ready`, 'ok', { label: 'Open', onClick: () => window.Browser.openUrl(d.url, { title: p?.name }) });
    if (d.autoOpen) window.Browser.openUrl(d.url, { title: p?.name, background: state.page !== 'browser', quiet: true });
    refreshRunning();
  });
  kiln.app.onMenu((cmd) => {
    if (!state.profile) return;
    if (cmd === 'palette') return window.Palette?.open();
    if (cmd === 'switch-profile') return window.Profiles.picker();
    if (cmd.startsWith('browser:')) { if (state.page === 'browser' || cmd === 'browser:new-tab') { if (cmd === 'browser:new-tab') go('browser'); window.Browser.command(cmd.slice(8)); } return; }
    go(cmd);
  });
  kiln.profiles.onChanged((ps) => { if (ps) { state.profile = ps.profile; } });
  document.addEventListener('dragover', (e) => { if (!e.target.closest('.drop-ok')) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; } });
  document.addEventListener('drop', (e) => { if (!e.target.closest('.drop-ok')) e.preventDefault(); });
  document.addEventListener('error', (e) => { const t = e.target; if (t.tagName === 'IMG' && t.dataset.fallback !== undefined) t.classList.add('broken'); }, true);

  async function boot() {
    state.app = await kiln.app.state();
    if (!state.app.setupDone) return window.Onboarding.start();
    const last = state.app.profiles.find(p => p.id === state.app.lastProfileId);
    if (state.app.profiles.length === 1 && !state.app.askOnLaunch && last && !last.hasPin) return window.Profiles.open(last.id);
    if (state.app.profiles.length && last && !state.app.askOnLaunch && !last.hasPin) return window.Profiles.open(last.id);
    window.Profiles.picker();
  }

  // A model's NSFW display rule for this profile
  function nsfwClass(isNsfw) {
    if (!isNsfw) return '';
    const m = state.settings?.nsfw || 'blur';
    return m === 'show' ? '' : m === 'hide' ? 'nsfw-hide' : 'nsfw-blur';
  }
  // Running packages that Kiln can generate with
  const generators = () => state.running.filter(r => r.backend && r.state === 'running');

  window.K = { $, $$, esc, fmtBytes, fmtNum, ago, uid, debounce, bus, state, toast, fail, modal, confirm, ask, menu, menuAt, closeMenu, register, go, pages, avatar, enterProfile, saveSettings, refreshRunning, nsfwClass, generators, boot };
  window.addEventListener('DOMContentLoaded', () => boot().catch(fail));
})();
