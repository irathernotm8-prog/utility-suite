// Droid main window. Plain DOM + template strings; everything that touches the computer goes through window.droid.
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtBytes = (n) => (!n ? '0 MB' : n >= 1e9 ? `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const fmtRam = (mb) => (mb >= 1024 ? `${+(mb / 1024).toFixed(1)} GB` : `${mb} MB`);
const ago = (t) => { if (!t) return 'never'; const s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; const d = Math.floor(s / 86400); return d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(t).toLocaleDateString(); };
const call = (...a) => window.droid.call(...a);

const S = {
  init: null, devices: [], view: 'devices', filter: 'all', states: {}, downloads: {}, thumbs: {}, library: [], images: null, imagesErr: null,
  query: '', results: null, searching: false, browser: null, sysUsage: null, accel: null, hostInfo: null,
};

// ───────────────────────── boot
async function boot() {
  document.documentElement.classList.toggle('win', window.droid.platform === 'win32');
  S.init = await call('app:init');
  S.devices = S.init.devices;
  for (const d of S.devices) S.states[d.id] = d.state;
  applyTheme();
  hydrateIcons(document);
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) go(b.dataset.view); });
  document.addEventListener('click', onAct);
  subscribe();
  renderSide();
  render();
  refreshLibrary();
  document.body.classList.add('ready');
  setInterval(() => { if (S.view === 'devices') $$('.clock').forEach((c) => (c.textContent = clockNow())); }, 15000);
  setInterval(refreshHost, 5000);
}
function applyTheme() {
  const t = S.init.settings.theme;
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => S.init && applyTheme());
function hydrateIcons(root) { $$('[data-icon]', root).forEach((el) => { if (!el.firstChild) el.innerHTML = icon(el.dataset.icon, +el.dataset.size || 18); }); }
const clockNow = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');

function subscribe() {
  const on = window.droid.on;
  on('devices:changed', () => refreshDevices());
  on('device:state', (s) => {
    S.states[s.id] = s.state;
    if (s.state !== 'downloading') delete S.downloads[s.id];
    else S.downloads[s.id] = { ...(S.downloads[s.id] || {}), label: s.label };
    if (S.view === 'devices') patchCard(s.id); else renderSide();
    if (S.view === 'apps' || S.view === 'library') renderTargets();
  });
  on('device:thumb', (t) => { S.thumbs[t.id] = t; const img = $(`.card[data-id="${t.id}"] .shot`); if (img && img.dataset.rot === t.rotation) img.src = t.url; else if (S.view === 'devices') patchCard(t.id); });
  on('sdk:progress', (p) => {
    const id = p.deviceId || p.key;
    S.downloads[id] = { ...(S.downloads[id] || {}), ...p };
    if (p.phase === 'done') setTimeout(() => { if (S.downloads[id]?.phase === 'done') { delete S.downloads[id]; if (S.view === 'devices') patchCard(id); } }, 600);
    if (S.view === 'devices' && p.deviceId) patchCardProgress(p.deviceId);
    if (S.view === 'system') renderSysProgress();
  });
  on('sdk:changed', () => { if (S.view === 'system') render(); S.images = null; });
  on('toast', toast);
  on('library:changed', () => refreshLibrary());
  on('settings:changed', (st) => { S.init.settings = st; applyTheme(); });
  on('web:download', (d) => { const f = $('#browserFoot'); if (!f) return; if (d.state === 'progress') f.innerHTML = `<span class="spin"></span> Downloading ${esc(d.name)} · ${d.total ? Math.round((d.got / d.total) * 100) + '%' : fmtBytes(d.got)}`; else if (d.state === 'completed') f.innerHTML = `${icon('check', 15)} ${esc(d.name)} ${d.app ? 'added to your library' : 'saved to Downloads'}`; else f.textContent = `Download ${d.state}`; });
}
async function refreshDevices() {
  S.devices = await call('devices:list');
  for (const d of S.devices) if (!S.states[d.id] || S.states[d.id] === 'stopped') S.states[d.id] = d.state;
  renderSide();
  if (S.view === 'devices') render();
  if (S.view === 'apps' || S.view === 'library') renderTargets();
}
async function refreshLibrary() { S.library = await call('library:list').catch(() => []); renderSide(); if (S.view === 'library') render(); }
async function refreshHost() { S.hostInfo = await call('host:info').catch(() => S.hostInfo); renderHost(); }

function go(view) {
  S.view = view;
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  render();
}

// ───────────────────────── sidebar
const running = () => S.devices.filter((d) => ['running', 'booting', 'starting'].includes(S.states[d.id]));
function renderSide() {
  $('#navCount').textContent = S.devices.length || '';
  $('#libCount').textContent = S.library.length || '';
  renderHost();
}
function renderHost() {
  const h = S.hostInfo || S.init.host;
  const run = running();
  const used = run.reduce((a, d) => a + d.ramMB, 0);
  const pct = Math.min(100, Math.round((used / h.ramMB) * 100));
  const label = h.platform === 'darwin' ? 'This Mac' : h.platform === 'win32' ? 'This PC' : 'This computer';
  $('#hostCard').innerHTML = `
    <div class="hc-top"><span>${label}</span><span class="pill ${run.length ? 'ok' : ''}">${run.length ? `${run.length} running` : 'Idle'}</span></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="hc-line"><span>${fmtRam(used)} of ${fmtRam(h.ramMB)} for devices</span><span>${h.cores} cores</span></div>
    ${h.disk ? `<div class="hc-line"><span>${fmtBytes(h.disk.free)} free on disk</span></div>` : ''}`;
}

// ───────────────────────── main render
function head(title, sub, right = '') {
  $('#headLeft').innerHTML = `<h1>${title}${sub ? ` <small>${sub}</small>` : ''}</h1>`;
  $('#headRight').innerHTML = right;
  hydrateIcons($('#head'));
}
function render() {
  const v = $('#view');
  v.classList.remove('flush');
  v.onscroll = null;
  if (S.view !== 'apps' || !S.browser) S.browser = S.view === 'apps' ? S.browser : null;
  ({ devices: renderDevices, apps: renderApps, library: renderLibrary, system: renderSystem, settings: renderSettings })[S.view]();
  hydrateIcons(v);
}

// ───────────────────────── devices
function styleOf(d) { return S.init.catalog.styles[d.style] || S.init.catalog.styles.pixel; }
function finishOf(d) { const st = styleOf(d); return st.finishes.find((f) => f.id === d.finish) || st.finishes[0]; }
function stateLabel(st) { return { running: 'Running', booting: 'Starting Android…', starting: 'Starting…', stopping: 'Saving…', downloading: 'Downloading…', stopped: 'Off' }[st] || 'Off'; }

function renderDevices() {
  const n = S.devices.length, r = running().length;
  head('Devices', n ? `${n} saved${r ? ` · ${r} running` : ''}` : '', n ? `
    <div class="seg" id="devFilter">${['all', 'running', 'pinned'].map((f) => `<button data-filter="${f}" class="${S.filter === f ? 'on' : ''}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div>
    <button class="btn primary" data-act="new">${icon('plus', 16)}New device</button>` : '');
  $('#devFilter')?.addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (b) { S.filter = b.dataset.filter; renderDevices(); hydrateIcons($('#view')); } });
  const v = $('#view');
  if (!n) { v.innerHTML = emptyHero(); mountHero(); return; }
  let list = S.devices;
  if (S.filter === 'running') list = list.filter((d) => S.states[d.id] && S.states[d.id] !== 'stopped');
  if (S.filter === 'pinned') list = list.filter((d) => d.pinned);
  v.innerHTML = `<div class="grid">${list.map(cardHtml).join('')}${S.filter === 'all' ? `<div class="card new-card" data-act="new"><div><div class="plus">${icon('plus', 26)}</div><b>New device</b><div class="small muted">Phone, tablet or custom</div></div></div>` : ''}</div>
    ${!list.length ? `<div class="empty">${S.filter === 'running' ? 'No devices are running.' : 'No pinned devices yet.'}</div>` : ''}`;
  for (const d of list) mountMini(d);
}

function cardHtml(d) {
  const st = S.states[d.id] || 'stopped';
  return `<div class="card a-${d.accent}" data-id="${d.id}">${cardInner(d, st)}</div>`;
}
function cardInner(d, st) {
  const dl = S.downloads[d.id];
  const busy = ['starting', 'booting', 'stopping', 'downloading'].includes(st);
  const net = d.network.mode === 'isolated' ? `<span class="spec" title="No internet">${icon('wifiOff', 13)}Isolated</span>` : d.network.mode === 'proxy' ? `<span class="spec" title="${esc(d.network.proxy)}">${icon('route', 13)}Proxy</span>` : '';
  const loc = d.location.mode === 'actual' ? '' : `<span class="spec" title="${esc(d.location.label || '')}">${icon('pin', 13)}${d.location.mode === 'simulated' ? esc((S.init.cities.find((c) => c.id === d.location.city) || {}).name || 'Simulated') : esc((d.location.label || '').split(',')[0] || 'Map spot')}</span>`;
  let actions;
  if (st === 'running') actions = `<button class="btn sm primary" data-act="open" data-id="${d.id}">${icon('phone', 15)}Open</button><button class="btn sm" data-act="stop" data-id="${d.id}">${icon('power', 15)}Turn off</button>`;
  else if (st === 'downloading') actions = `<button class="btn sm" data-act="cancelDl" data-id="${d.id}">Cancel download</button>`;
  else if (busy) actions = `<button class="btn sm" data-act="open" data-id="${d.id}" ${st === 'stopping' ? 'disabled' : ''}>${st === 'stopping' ? '<span class="spin"></span>Saving…' : `<span class="spin"></span>${stateLabel(st)}`}</button>`;
  else actions = `<button class="btn sm primary" data-act="start" data-id="${d.id}">${icon('play', 14)}Start</button><button class="btn sm" data-act="edit" data-id="${d.id}">${icon('edit', 15)}Edit</button>`;
  const dlHtml = st === 'downloading' && dl ? `<div class="dl" data-dl="${d.id}">${dlInner(dl)}</div>` : '';
  return `
    <div class="stage" data-act="${st === 'stopped' ? 'start' : 'open'}" data-id="${d.id}">
      <div class="stage-top">
        <span class="state-chip"><span class="dot ${st === 'running' ? 'on' : busy ? 'busy' : ''}"></span>${stateLabel(st)}</span>
        <span class="row" style="gap:6px">
          <button class="icon-btn xs ${d.pinned ? 'pinned' : ''}" data-act="pin" data-id="${d.id}" title="${d.pinned ? 'Unpin' : 'Pin to the top'}">${icon('pin', 14)}</button>
          <button class="icon-btn xs" data-act="menu" data-id="${d.id}" title="More">${icon('more', 15)}</button>
        </span>
      </div>
      <div class="mini"></div>
    </div>
    <div class="card-body">
      <div class="card-name"><span class="acc-dot"></span><span class="ellip">${esc(d.name)}</span></div>
      <div class="card-sub">${esc(d.image.name)} · ${esc(d.image.tagName)} · ${esc(styleOf(d).short)}</div>
      <div class="specs">
        <span class="spec" title="Screen">${icon('screen', 13)}${d.screen.w}×${d.screen.h}</span>
        <span class="spec" title="Memory">${icon('memory', 13)}${fmtRam(d.ramMB)}</span>
        <span class="spec" title="Processor cores">${icon('cpu', 13)}${d.cores}</span>
        <span class="spec" title="Storage">${icon('disk', 13)}${d.storageGB} GB</span>
        ${net}${loc}
      </div>
      ${dlHtml}
      <div class="card-actions">${actions}</div>
    </div>`;
}
function dlInner(dl) {
  const pct = dl.total ? Math.round((dl.got / dl.total) * 100) : 0;
  const what = dl.phase === 'unpack' ? 'Unpacking' : dl.phase === 'verify' ? 'Checking' : 'Downloading';
  return `<div class="row"><span class="grow ellip">${what} ${esc(dl.label || '')}</span><span class="tnum">${dl.phase === 'download' && dl.total ? `${pct}%` : ''}</span></div>
    <div class="bar ${dl.phase !== 'download' ? 'indet' : ''}"><i style="width:${pct}%"></i></div>
    ${dl.phase === 'download' && dl.total ? `<div class="tiny muted tnum">${fmtBytes(dl.got)} of ${fmtBytes(dl.total)}${dl.rate ? ` · ${fmtBytes(dl.rate)}/s` : ''}</div>` : ''}`;
}
function patchCard(id) {
  const el = $(`.card[data-id="${id}"]`); const d = S.devices.find((x) => x.id === id);
  if (!el || !d) { if (S.view === 'devices') render(); return; }
  el.innerHTML = cardInner(d, S.states[id] || 'stopped');
  mountMini(d);
  renderSide();
  const r = running().length, n = S.devices.length;
  const sm = $('#head h1 small'); if (sm) sm.textContent = `${n} saved${r ? ` · ${r} running` : ''}`;
}
function patchCardProgress(id) {
  const box = $(`[data-dl="${id}"]`);
  if (box && S.downloads[id]) box.innerHTML = dlInner(S.downloads[id]);
  else if (S.states[id] === 'downloading') patchCard(id);
}

// Mini frame on a card with the latest screenshot (or a lock-screen placeholder).
function mountMini(d) {
  const stage = $(`.card[data-id="${d.id}"] .stage`); if (!stage) return;
  const host = $('.mini', stage); host.innerHTML = '';
  const t = S.thumbs[d.id];
  const draw = (rotation, src) => {
    const L = Frames.renderFrame(host, { style: d.style, finish: finishOf(d), natW: d.screen.w, natH: d.screen.h, rotation, box: { w: 230, h: 192 } });
    host.querySelectorAll('.shot, .shot-ph').forEach((x) => x.remove());
    const sc = L.screen;
    const el = document.createElement(src ? 'img' : 'div');
    el.className = src ? 'shot' : 'shot-ph';
    Object.assign(el.style, { left: `${sc.x}px`, top: `${sc.y}px`, width: `${sc.w}px`, height: `${sc.h}px`, borderRadius: `${sc.r}px` });
    if (src) { el.src = src; el.dataset.rot = rotation; el.draggable = false; }
    else el.innerHTML = `<span class="clock" style="font-size:${Math.max(14, sc.w * 0.2)}px">${clockNow()}</span>`;
    host.appendChild(el);
  };
  const src = t?.url || d.thumb;
  if (!src) return draw('PORTRAIT', null);
  if (t?.rotation) return draw(t.rotation, src);
  // saved thumbnails: work out the orientation from the picture itself
  const probe = new Image();
  probe.onload = () => { const natLand = d.screen.w > d.screen.h, imgLand = probe.naturalWidth > probe.naturalHeight; draw(natLand === imgLand ? 'PORTRAIT' : 'LANDSCAPE', src); };
  probe.onerror = () => draw('PORTRAIT', null);
  probe.src = src;
}

function emptyHero() {
  const styles = Object.values(S.init.catalog.styles);
  return `<div class="hero">
    <div class="hero-frames" id="heroFrames"></div>
    <h2>Android, without the phone</h2>
    <p>Build virtual phones and tablets that run real Android and real apps. Pick a look to start; you'll choose the Android version, screen, memory, network and location next.</p>
    <div class="quick-styles">${styles.map((s) => `<div class="qs" data-act="new" data-style="${s.id}"><div class="qs-art" data-art="${s.id}"></div><b>${esc(s.short)}</b></div>`).join('')}</div>
  </div>`;
}
function mountHero() {
  const hf = $('#heroFrames');
  const demo = [['tablet', 'graphite', 2560, 1600, 'a-sky', 150], ['pixel', 'bay', 1080, 2400, 'a-mint', 200], ['island', 'natural', 1179, 2556, 'a-rose', 180]];
  for (const [st, fin, w, h, acc, bh] of demo) {
    const wrap = document.createElement('div'); wrap.className = acc; wrap.style.position = 'relative';
    hf.appendChild(wrap); miniStatic(wrap, st, fin, w, h, { w: st === 'tablet' ? 230 : 120, h: bh });
  }
  $$('[data-art]').forEach((el) => { const s = S.init.catalog.styles[el.dataset.art]; const w = s.orientation === 'landscape' ? 1600 : 1080; const h = Math.round(w / (s.orientation === 'landscape' ? s.aspect : 1 / s.aspect)); el.classList.add('a-mint'); el.style.position = 'relative'; miniStatic(el, s.id, s.finishes[0].id, w, h, { w: 110, h: 88 }); });
}
function miniStatic(host, style, finishId, w, h, box, rotation = 'PORTRAIT') {
  const st = S.init.catalog.styles[style];
  const fin = st.finishes.find((f) => f.id === finishId) || st.finishes[0];
  const L = Frames.renderFrame(host, { style, finish: fin, natW: w, natH: h, rotation, box });
  const sc = L.screen;
  const ph = document.createElement('div'); ph.className = 'shot-ph';
  Object.assign(ph.style, { position: 'absolute', zIndex: 2, left: `${sc.x}px`, top: `${sc.y}px`, width: `${sc.w}px`, height: `${sc.h}px`, borderRadius: `${sc.r}px`, display: 'grid', placeItems: 'center', background: 'linear-gradient(160deg, color-mix(in srgb, var(--c) 55%, #0b0d10), color-mix(in srgb, var(--c2) 40%, #0b0d10))' });
  ph.innerHTML = `<span class="clock" style="color:#fff;font-weight:300;font-size:${Math.max(10, Math.min(sc.w, sc.h) * 0.22)}px">${clockNow()}</span>`;
  host.appendChild(ph);
  return L;
}

// ───────────────────────── actions
async function onAct(e) {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const id = el.dataset.id, d = id && S.devices.find((x) => x.id === id);
  const act = el.dataset.act;
  if (act !== 'menu') e.stopPropagation();
  try {
    switch (act) {
      case 'new': return openWizard({ style: el.dataset.style });
      case 'edit': return openWizard({ device: d });
      case 'start': S.states[id] = 'starting'; patchCard(id); await call('device:start', id); return;
      case 'open': return call('device:open', id);
      case 'stop': S.states[id] = 'stopping'; patchCard(id); return call('device:stop', id);
      case 'pin': return call('devices:pin', id, !d.pinned);
      case 'cancelDl': return call('sdk:cancel', d.image.path).then(() => call('sdk:cancel', 'emulator')).then(() => call('sdk:cancel', 'platform-tools'));
      case 'menu': return deviceMenu(el, d);
    }
  } catch (err) {
    if (id) { S.states[id] = 'stopped'; patchCard(id); }
    toast({ kind: 'bad', title: 'Something went wrong', text: err.message });
  }
}

function deviceMenu(anchor, d) {
  const st = S.states[d.id] || 'stopped';
  const on = st !== 'stopped';
  menu(anchor, [
    on ? { icon: 'phone', label: 'Open window', run: () => call('device:open', d.id) } : { icon: 'play', label: 'Start', run: () => call('device:start', d.id) },
    !on && { icon: 'boot', label: 'Cold boot (fresh start)', run: () => call('device:start', d.id, { coldBoot: true }) },
    on && { icon: 'refresh', label: 'Restart', run: () => call('device:restart', d.id) },
    { icon: 'edit', label: 'Edit device…', run: () => openWizard({ device: d }) },
    { icon: 'copy', label: 'Duplicate', run: () => call('devices:duplicate', d.id) },
    { icon: 'pin', label: d.pinned ? 'Unpin' : 'Pin to the top', run: () => call('devices:pin', d.id, !d.pinned) },
    '-',
    { icon: 'folder', label: 'Show device folder', run: () => call('device:showFolder', d.id) },
    { icon: 'wipe', label: 'Wipe data (factory reset)…', danger: true, run: async () => { if (await confirmBox({ title: `Factory reset ${d.name}?`, text: 'Apps, accounts, files and saved states on this device are erased. The device itself and its settings stay.', ok: 'Wipe and start', danger: true })) call('device:wipe', d.id).catch((e) => toast({ kind: 'bad', title: 'Could not wipe', text: e.message })); } },
    on && { icon: 'power', label: 'Force stop', danger: true, run: () => call('device:forceStop', d.id) },
    { icon: 'trash', label: 'Delete device…', danger: true, run: async () => {
      const bytes = await call('devices:usage', d.id).catch(() => 0);
      if (await confirmBox({ title: `Delete ${d.name}?`, text: `The device and everything on it is removed${bytes ? `, freeing ${fmtBytes(bytes)}` : ''}. The Android version stays downloaded for other devices.`, ok: 'Delete', danger: true })) await call('devices:remove', d.id);
    } },
  ].filter(Boolean));
}

function menu(anchor, items, { align = 'right' } = {}) {
  closeMenus();
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : it.heading ? `<div class="menu-label">${esc(it.heading)}</div>` : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon, 16) : ''}<span class="grow">${esc(it.label)}</span>${it.hint ? `<span class="tiny muted">${esc(it.hint)}</span>` : ''}</button>`)).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let x = align === 'right' ? r.right - mw : r.left, y = r.bottom + 6;
  if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 6);
  m.style.left = `${Math.max(8, Math.min(x, innerWidth - mw - 8))}px`; m.style.top = `${y}px`;
  m.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (!b) return; closeMenus(); Promise.resolve(items[+b.dataset.i].run()).catch((err) => toast({ kind: 'bad', title: 'Something went wrong', text: err.message })); });
  setTimeout(() => document.addEventListener('mousedown', outside, { once: true }), 0);
  function outside(e) { if (!m.contains(e.target)) closeMenus(); else document.addEventListener('mousedown', outside, { once: true }); }
}
function closeMenus() { $$('.menu').forEach((m) => m.remove()); }

function confirmBox({ title, text, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const s = document.createElement('div'); s.className = 'scrim';
    s.innerHTML = `<div class="panel" style="width:420px;margin:0;box-shadow:var(--shadow-lg);padding:20px 22px">
      <h3 style="font-size:16px;margin:0 0 6px">${esc(title)}</h3><p style="margin:0 0 18px;color:var(--fg-2)">${esc(text)}</p>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-x="0">Cancel</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" data-x="1">${esc(ok)}</button></div></div>`;
    document.body.appendChild(s);
    const done = (v) => { s.remove(); resolve(v); };
    s.addEventListener('click', (e) => { const b = e.target.closest('[data-x]'); if (b) done(b.dataset.x === '1'); else if (e.target === s) done(false); });
    $('[data-x="1"]', s).focus();
  });
}

// ───────────────────────── toasts
const toastTimers = {};
function toast(t) {
  const host = $('#toasts');
  const id = t.id || `t${Date.now()}${Math.random()}`;
  let el = host.querySelector(`[data-tid="${CSS.escape(id)}"]`);
  if (!el) { el = document.createElement('div'); el.dataset.tid = id; host.appendChild(el); }
  const ic = t.kind === 'ok' ? icon('check', 17, 't-ic') : t.kind === 'bad' ? icon('warning', 17, 't-ic') : t.kind === 'busy' ? '<span class="spin t-ic" style="color:var(--acc)"></span>' : icon('info', 17, 't-ic');
  el.className = `toast ${t.kind || ''}`;
  el.innerHTML = `${ic}<div class="grow"><div class="t-title">${esc(t.title)}</div>${t.text ? `<div class="t-text">${esc(t.text)}</div>` : ''}${t.reveal ? `<button class="link-btn" style="margin-top:4px">Show in folder</button>` : ''}</div><button class="icon-btn xs" title="Dismiss">${icon('close', 14)}</button>`;
  el.querySelector('.icon-btn').onclick = () => el.remove();
  if (t.reveal) el.querySelector('.link-btn').onclick = () => call('shell:reveal', t.reveal);
  clearTimeout(toastTimers[id]);
  toastTimers[id] = setTimeout(() => el.remove(), t.kind === 'busy' ? 120000 : t.kind === 'bad' ? 12000 : 5000);
}

window.addEventListener('DOMContentLoaded', () => boot().catch((e) => { document.body.classList.add('ready'); document.body.innerHTML = `<pre style="padding:20px;color:#f66">${esc(e.stack || e.message)}</pre>`; }));
