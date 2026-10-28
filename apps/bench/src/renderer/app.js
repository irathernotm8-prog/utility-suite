// Bench main window. Plain DOM + template strings; everything that touches the computer goes through window.bench.
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtBytes = (n) => (!n ? '0 GB' : n >= 1e9 ? `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB` : `${Math.round(n / 1e6)} MB`);
const fmtMs = (ms) => (ms == null ? '' : ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
const ago = (t) => { if (!t) return 'never'; const s = (Date.now() - t) / 1000; if (s < 45) return 'just now'; if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; const d = Math.floor(s / 86400); return d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(t).toLocaleDateString(); };
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }).replace(/\s?[AP]M$/i, '');
const call = (...a) => window.bench.call(...a);

const S = {
  init: null, view: 'desks', desks: [], deskId: null, host: null, thumbs: {}, activity: {}, runs: [], runId: null, findings: [], findingId: null, findingFilter: 'open',
  claude: null, engines: null, catalog: null, engineProgress: {},
};
const KIND_ICON = { sandbox: 'stack', 'mac-vm': 'apple', 'linux-vm': 'linux', 'windows-sandbox': 'winlogo', vnc: 'monitor' };
const STATE_LABEL = { ready: 'Ready', running: 'Running', stopped: 'Stopped', starting: 'Starting', stopping: 'Stopping', preparing: 'Getting ready', error: 'Problem' };

// ───────────────────────── boot
async function boot() {
  document.documentElement.classList.toggle('win', window.bench.platform === 'win32');
  document.documentElement.classList.toggle('mac', window.bench.platform === 'darwin');
  S.init = await call('app:init');
  S.desks = S.init.desks; S.host = S.init.host; S.claude = S.init.claude; S.thumbs = S.init.thumbs || {};
  applyTheme();
  hydrateIcons(document);
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) go(b.dataset.view); });
  document.addEventListener('click', onAct);
  subscribe();
  renderSide(); renderHost();
  refreshFindings(); refreshRuns();
  go('desks');
  document.body.classList.add('ready');
}
function applyTheme() {
  const t = S.init.settings.theme;
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => S.init && applyTheme());
function hydrateIcons(root) { $$('[data-icon]', root).forEach((el) => { if (!el.firstChild) el.innerHTML = icon(el.dataset.icon, +el.dataset.size || 18); }); }

function subscribe() {
  const on = window.bench.on;
  on('desks:changed', refreshDesks);
  on('desk:state', (s) => { const d = S.desks.find((x) => x.id === s.id); if (d) { d.state = s.state; d.detail = s.detail; d.progress = s.progress || null; } if (S.view === 'desks' && !S.deskId) patchCard(s.id); else if (S.deskId === s.id) Desk.onState(s); });
  on('desk:sessions', ({ id }) => { refreshDesksSoon(); if (S.deskId === id) Desk.refreshSessions(); });
  on('desk:activity', (e) => { const list = (S.activity[e.desk] = S.activity[e.desk] || []); list.push(e); if (list.length > 400) list.shift(); if (S.deskId === e.desk) Desk.onActivity(e); });
  on('desk:log', (e) => { if (S.deskId === e.desk) Desk.onLog(e); });
  on('desk:dialog', (e) => { if (S.deskId === e.desk) Desk.onDialog(e); else if (e.dialog.pending) toast({ kind: 'busy', title: 'An app is waiting for an answer', text: `${e.dialog.kind === 'open' ? 'Open' : e.dialog.kind === 'save' ? 'Save' : 'Message'} dialog on ${(S.desks.find((d) => d.id === e.desk) || {}).name || 'a desk'}` }); });
  on('desk:thumb', (t) => { if (t.url) S.thumbs[t.id] = t.url; else delete S.thumbs[t.id]; if (S.view === 'desks' && !S.deskId) patchCard(t.id); });
  on('live:frame', (f) => { if (S.deskId === f.desk) Desk.onFrame(f); });
  on('runs:changed', () => refreshRunsSoon());
  on('findings:changed', () => refreshFindings());
  on('claude:status', (c) => { S.claude = c; renderSide(); if (S.view === 'claude') render(); if (S.view === 'desks' && !S.deskId) render(); });
  on('host:tick', (h) => { S.host = { ...S.host, ...h }; renderHost(); });
  on('settings:changed', (st) => { S.init.settings = st; applyTheme(); });
  on('engines:progress', (p) => { S.engineProgress[p.key] = p.done ? null : p; if (S.view === 'engines') Views.engineProgress(p); });
  on('toast', toast);
}
let deskTimer = null;
function refreshDesksSoon() { clearTimeout(deskTimer); deskTimer = setTimeout(refreshDesks, 120); }
async function refreshDesks() {
  S.desks = await call('desks:list');
  if (S.deskId && !S.desks.find((d) => d.id === S.deskId)) { S.deskId = null; if (S.view === 'desks') render(); }
  renderSide();
  if (S.view === 'desks' && !S.deskId) render(); else if (S.deskId) Desk.onDesk();
}
let runsTimer = null;
function refreshRunsSoon() { clearTimeout(runsTimer); runsTimer = setTimeout(refreshRuns, 150); }
async function refreshRuns() { S.runs = await call('runs:list').catch(() => S.runs); renderSide(); if (S.view === 'runs') Views.runsUpdate(); }
async function refreshFindings() { S.findings = await call('findings:list').catch(() => S.findings); renderSide(); if (S.view === 'findings') render(); }

function go(view, opts = {}) {
  if (S.view === 'desks' && S.deskId && (view !== 'desks' || opts.desk !== S.deskId)) Desk.leave();
  S.view = view;
  if (view === 'desks') S.deskId = opts.desk || null;
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  render();
}
function render() {
  const v = $('#view'); v.className = '';
  $('#headLeft').innerHTML = ''; $('#headRight').innerHTML = '';
  if (S.view === 'desks') { if (S.deskId) Desk.render(); else renderDesks(); }
  else if (Views[S.view]) Views[S.view]();
  hydrateIcons(document);
}
function head(title, sub, right = '', back = false) {
  $('#headLeft').innerHTML = `${back ? `<button class="icon-btn" data-act="back" title="All desks">${icon('back')}</button>` : ''}<h1>${title}${sub ? ` <small>${sub}</small>` : ''}</h1>`;
  $('#headRight').innerHTML = right;
}

// ───────────────────────── sidebar
function renderSide() {
  const running = S.desks.reduce((n, d) => n + d.sessions.filter((s) => s.state !== 'exited').length + (d.kind !== 'sandbox' && d.state === 'running' ? 1 : 0), 0);
  $('#navDesks').textContent = running ? `${running} running` : S.desks.length || '';
  const activeRuns = S.runs.filter((r) => r.state === 'running').length;
  $('#navRuns').innerHTML = activeRuns ? `<span class="spin" style="width:11px;height:11px"></span>` : '';
  const open = S.findings.filter((f) => f.status === 'open').length;
  $('#navFindings').innerHTML = open ? `<span class="badge">${open}</span>` : '';
  const c = S.claude && S.claude.bridge;
  $('#navClaude').innerHTML = c && c.connected ? '<span class="dot on" title="Connected"></span>' : '';
}
function renderHost() {
  const h = S.host; if (!h) return;
  const memUsed = h.totalMem ? 1 - h.freeMem / h.totalMem : 0;
  $('#hostCard').innerHTML = `
    <div class="hc-top"><span>${esc(h.cpu)}</span><span class="muted tnum">${h.cores} cores</span></div>
    <div class="hc-line"><span>Processor</span><span class="tnum">${h.load == null ? '—' : Math.round(h.load * 100) + '%'}</span></div>
    <div class="bar"><i style="width:${Math.round((h.load || 0) * 100)}%"></i></div>
    <div class="hc-line"><span>Memory</span><span class="tnum">${fmtBytes(h.totalMem - h.freeMem)} of ${fmtBytes(h.totalMem)}</span></div>
    <div class="bar"><i style="width:${Math.round(memUsed * 100)}%"></i></div>
    <div class="hc-cap">${icon('bolt', 14)}<span>Runs <b>${h.limits.apps}</b> app${h.limits.apps === 1 ? '' : 's'} or <b>${h.limits.tests}</b> test suite${h.limits.tests === 1 ? '' : 's'} at once</span></div>`;
}

// ───────────────────────── desks dashboard
function deskArt(d) {
  const k = d.kind;
  if (k === 'sandbox') return `<div class="art"><div class="w" style="left:20px;top:22px;width:120px;height:82px"></div><div class="w" style="left:76px;top:40px;width:120px;height:80px"></div></div>`;
  if (k === 'mac-vm') return `<div class="art"><div class="screen"></div><div class="bar-top"></div><div class="dock"></div><div class="w" style="left:52px;top:26px;width:104px;height:66px"></div></div>`;
  if (k === 'windows-sandbox') return `<div class="art"><div class="screen"></div><div class="task"></div><div class="w" style="left:48px;top:22px;width:112px;height:72px"></div></div>`;
  if (k === 'linux-vm') return `<div class="art"><div class="screen"></div><div class="term">admin@ubuntu:~$ <span style="opacity:.6">_</span></div></div>`;
  return `<div class="art"><div class="screen"></div><div class="w" style="left:44px;top:24px;width:120px;height:76px"></div></div>`;
}
function stateChip(d) {
  const st = d.state; const busy = ['starting', 'stopping', 'preparing'].includes(st);
  const live = d.sessions.filter((s) => s.state !== 'exited').length;
  const label = d.kind === 'sandbox' ? (live ? `${live} running` : 'Ready') : STATE_LABEL[st] || st;
  return `<span class="state-chip"><span class="dot ${busy ? 'busy' : st === 'running' || (d.kind === 'sandbox' && live) ? 'on' : st === 'error' ? 'bad' : ''}"></span>${esc(label)}</span>`;
}
function deskCard(d) {
  const live = d.sessions.filter((s) => s.state !== 'exited');
  const thumb = S.thumbs[d.id];
  const vm = d.kind === 'mac-vm' || d.kind === 'linux-vm' || d.kind === 'windows-sandbox' || d.kind === 'vnc';
  const busy = ['starting', 'stopping', 'preparing'].includes(d.state);
  const p = d.progress;
  const sub = d.kind === 'sandbox' ? (d.hidden !== false ? 'Sandbox · windows out of sight' : 'Sandbox · windows on screen') : d.kind === 'vnc' ? `Another computer · ${esc((d.remote && d.remote.host) || '')}` : `${esc(d.kindLabel)}${d.vm && d.vm.cpu ? ` · ${d.vm.cpu} cores` : ''}${d.vm && d.vm.memoryGB ? ` · ${d.vm.memoryGB} GB` : ''}`;
  return `<div class="card a-${esc(d.color || 'pink')}" data-id="${d.id}">
    <div class="stage-mini" data-act="open-desk" data-id="${d.id}">
      <div class="stage-top">${stateChip(d)}<span class="kind-chip">${icon(KIND_ICON[d.kind] || 'desk', 13)}${esc(d.kindLabel)}</span></div>
      ${thumb ? `<img class="thumb" src="${thumb}" alt="">` : deskArt(d)}
    </div>
    <div class="card-body">
      <div class="card-name"><span class="acc-dot"></span><span class="ellip">${esc(d.name)}</span></div>
      <div class="card-sub">${sub}</div>
      ${busy || d.error ? `<div class="prog"><span class="ellip">${esc(d.error && !busy ? d.error : d.detail || STATE_LABEL[d.state])}</span>${busy ? `<div class="bar ${p && p.pct != null ? '' : 'indet'}"><i style="width:${p && p.pct != null ? Math.round(p.pct * 100) : 30}%"></i></div>` : ''}</div>` : ''}
      ${live.length ? `<div class="chips">${live.slice(0, 5).map((s) => `<span class="chip-s"><span class="dot ${s.kind === 'command' ? 'busy' : 'on'}"></span><span class="ellip">${esc(s.name)}</span>${s.errors ? `<span class="err">${s.errors}</span>` : ''}</span>`).join('')}${live.length > 5 ? `<span class="chip-s">+${live.length - 5}</span>` : ''}</div>` : ''}
      <div class="card-actions">
        <button class="btn sm primary" data-act="open-desk" data-id="${d.id}">${icon('eye', 15)}Open</button>
        ${vm && d.kind !== 'vnc' || d.kind === 'vnc' ? (d.state === 'running' ? `<button class="btn sm" data-act="desk-stop" data-id="${d.id}">${icon('stop', 14)}${d.kind === 'vnc' ? 'Disconnect' : 'Stop'}</button>` : `<button class="btn sm" data-act="desk-start" data-id="${d.id}" ${busy || d.preparing ? 'disabled' : ''}>${icon('play', 14)}${d.kind === 'vnc' ? 'Connect' : 'Start'}</button>`) : `<button class="btn sm" data-act="launch" data-id="${d.id}">${icon('plus', 14)}Launch</button>`}
        <button class="icon-btn sm" data-act="desk-menu" data-id="${d.id}" title="More">${icon('more')}</button>
      </div>
    </div>
  </div>`;
}
function patchCard(id) { const el = $(`.card[data-id="${id}"]`); const d = S.desks.find((x) => x.id === id); if (el && d) { el.outerHTML = deskCard(d); } }
function renderDesks() {
  const live = S.desks.reduce((n, d) => n + d.sessions.filter((s) => s.state !== 'exited').length, 0);
  head('Desks', `${S.desks.length} desk${S.desks.length === 1 ? '' : 's'}${live ? ` · ${live} running` : ''}`, `<button class="btn" data-act="go-runs">${icon('runs', 15)}Smoke test the suite</button><button class="btn primary" data-act="new-desk">${icon('plus', 15)}New desk</button>`);
  const c = S.claude; const connected = c && c.bridge && c.bridge.connected; const added = c && (c.desktop.added || c.code.added || c.codex.added);
  $('#view').innerHTML = `
    ${!added && !connected ? `<div class="banner"><div class="b-ic">${icon('spark', 20)}</div><div class="grow"><b>Connect Claude to Bench</b><span>Claude can then open apps on these desks, see their windows, click and type, read errors, smoke-test the whole suite and file what it finds.</span></div><button class="btn primary" data-act="go-claude">Connect</button></div>`
      : connected ? `<div class="banner"><div class="b-ic">${icon('spark', 20)}</div><div class="grow"><b>${esc(c.bridge.client || 'Claude')} is connected</b><span>Open a desk to watch what it does, live.</span></div></div>` : ''}
    <div class="grid">${S.desks.map(deskCard).join('')}
      <div class="card new-card" data-act="new-desk"><div><div class="plus">${icon('plus', 24)}</div><b>New desk</b><div class="small muted" style="margin-top:4px;max-width:220px">A sandbox, a Mac or Linux VM, Windows Sandbox, or another computer</div></div></div>
    </div>`;
}

// ───────────────────────── actions
async function onAct(e) {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act; const id = el.dataset.id;
  try {
    switch (a) {
      case 'back': go('desks'); break;
      case 'open-desk': go('desks', { desk: id }); break;
      case 'new-desk': Sheets.newDesk(); break;
      case 'launch': Sheets.launch(id || S.deskId); break;
      case 'go-runs': go('runs'); break;
      case 'go-claude': go('claude'); break;
      case 'desk-start': await deskStart(id); break;
      case 'desk-stop': await call('desks:stop', id); break;
      case 'desk-menu': deskMenu(el, id); break;
      default: if (Desk.act && (await Desk.act(a, el, e))) break; if (Views.act && (await Views.act(a, el, e))) break; if (Sheets.act) await Sheets.act(a, el, e);
    }
  } catch (err) { toast({ kind: 'bad', title: 'That didn’t work', text: err.message }); }
}
async function deskStart(id) {
  const d = S.desks.find((x) => x.id === id);
  try { await call('desks:start', id); toast({ kind: 'ok', title: `${d ? d.name : 'Desk'} is ${d && d.kind === 'vnc' ? 'connected' : 'running'}` }); }
  catch (err) { toast({ kind: 'bad', title: `${d ? d.name : 'Desk'} didn’t start`, text: err.message }); }
}
function deskMenu(anchor, id) {
  const d = S.desks.find((x) => x.id === id); if (!d) return;
  const vm = d.kind === 'mac-vm' || d.kind === 'linux-vm';
  menu(anchor, [
    { label: 'Open', icon: 'eye', run: () => go('desks', { desk: id }) },
    { label: 'Launch…', icon: 'plus', run: () => Sheets.launch(id) },
    d.kind === 'sandbox' ? { label: d.hidden !== false ? 'Show windows on screen' : 'Keep windows out of sight', icon: d.hidden !== false ? 'eye' : 'eyeOff', run: () => call('desks:update', id, { hidden: d.hidden === false }) } : null,
    { label: 'Open desk folder', icon: 'folder', run: () => call('desk:folder', id) },
    { sep: true },
    { label: 'Rename…', icon: 'pen', run: () => Sheets.rename(d) },
    vm ? { label: 'Save current state as clean', icon: 'check', disabled: d.state === 'running', run: async () => { await call('desks:saveClean', id); toast({ kind: 'ok', title: 'Saved as the clean copy' }); } } : null,
    d.kind !== 'vnc' ? { label: d.kind === 'sandbox' ? 'Reset (wipe this desk’s app data)…' : d.kind === 'windows-sandbox' ? 'Reset' : 'Reset to clean…', icon: 'reset', run: () => Sheets.confirm({ title: `Reset ${d.name}?`, text: d.kind === 'sandbox' ? 'Closes everything on the desk and deletes the data its apps saved here (your real data isn’t touched).' : 'Stops the VM and goes back to its clean copy. Anything changed inside it is lost.', ok: 'Reset', danger: true, run: () => call('desks:reset', id) }) } : null,
    { sep: true },
    { label: 'Delete desk…', icon: 'trash', danger: true, run: () => Sheets.confirm({ title: `Delete ${d.name}?`, text: d.kind === 'sandbox' ? 'Closes its apps and deletes the desk with its data.' : 'Stops it and deletes the desk, including its virtual machine disk.', ok: 'Delete', danger: true, run: () => call('desks:remove', id) }) },
  ].filter(Boolean));
}

// ───────────────────────── small UI pieces
function menu(anchor, items) {
  closeMenu();
  const m = document.createElement('div'); m.className = 'menu';
  m.innerHTML = items.map((it, i) => it.sep ? '<hr>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon, 16) : ''}<span>${esc(it.label)}</span></button>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(); const mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.min(window.innerWidth - mw - 8, Math.max(8, r.right - mw)) + 'px';
  m.style.top = (r.bottom + mh + 8 > window.innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px';
  m.addEventListener('click', async (e) => { const b = e.target.closest('button[data-i]'); if (!b) return; closeMenu(); try { await items[+b.dataset.i].run(); } catch (err) { toast({ kind: 'bad', title: 'That didn’t work', text: err.message }); } });
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  function outside(e) { if (!m.contains(e.target)) closeMenu(); }
  m._outside = outside;
}
function closeMenu() { $$('.menu').forEach((m) => { document.removeEventListener('mousedown', m._outside); m.remove(); }); }
function toast({ kind = 'ok', title, text = '', ms } = {}) {
  const t = document.createElement('div'); t.className = `toast ${kind}`;
  t.innerHTML = `<span class="t-ic">${kind === 'busy' ? '<span class="spin"></span>' : icon(kind === 'bad' ? 'alert' : 'check', 17)}</span><div class="grow"><div class="t-title">${esc(title)}</div>${text ? `<div class="t-text">${esc(text)}</div>` : ''}</div><button class="icon-btn xs">${icon('close', 14)}</button>`;
  t.querySelector('button').onclick = () => t.remove();
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), ms || (kind === 'bad' ? 9000 : 4500));
  return t;
}
function zoomImage(src) { const z = document.createElement('div'); z.className = 'zoom'; z.innerHTML = `<img src="${src}" alt="">`; z.onclick = () => z.remove(); document.body.appendChild(z); }
const appColor = (name) => { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0; const hues = [330, 280, 210, 160, 35, 10, 250, 190]; const hue = hues[h % hues.length]; return `linear-gradient(135deg, hsl(${hue} 80% 62%), hsl(${(hue + 40) % 360} 70% 50%))`; };

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if ($('.zoom')) $('.zoom').remove(); else if ($('.menu')) closeMenu(); else if ($('.scrim') && !document.activeElement.closest('.scr')) Sheets.close(); } });
window.addEventListener('DOMContentLoaded', () => boot().catch((e) => { document.body.classList.add('ready'); document.body.innerHTML = `<pre style="padding:30px;color:#f66">${esc(e.stack || e.message)}</pre>`; }));
