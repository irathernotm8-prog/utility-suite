// Vitals — the window. Everything system-related goes through window.vitals (see preload.js).
(() => {
'use strict';
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason && e.reason.message || e.reason)));
const V = window.vitals;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { settings: {}, platform: 'darwin', view: 'overview', last: null, history: null, procs: null, cores: 1, apps: null, startup: null, perms: null, specs: null, focus: null, checkup: null, icons: new Map() };

// ---------------------------------------------------------------- formatting
function fmtB(b, d) { if (b == null || isNaN(b)) return '–'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (Math.abs(b) >= 1000 && i < u.length - 1) { b /= 1000; i++; } const dd = d ?? (b >= 100 || i === 0 ? 0 : 1); return `${b.toFixed(dd)} ${u[i]}`; }
const fmtRate = (b) => (b == null ? '–' : fmtB(b) + '/s');
const pct = (v, d = 0) => (v == null || isNaN(v) ? '–' : `${v.toFixed(d)}%`);
function dur(s, long) { s = Math.round(s || 0); const d = long === 'h' ? 0 : Math.floor(s / 86400), h = long === 'h' ? Math.floor(s / 3600) : Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); if (d) return `${d}d ${h}h`; if (h) return `${h}h ${String(m).padStart(long === true ? 2 : 1, '0')}m`; if (m) return `${m}m`; return `${s}s`; }
function temp(c) { if (c == null || isNaN(c)) return '–'; return S.settings.tempUnit === 'F' ? `${Math.round(c * 9 / 5 + 32)}°F` : `${Math.round(c)}°C`; }
function ago(t) {
  if (!t) return '—'; const s = (Date.now() - t) / 1000;
  if (s < 3600) return 'Just now'; if (s < 86400) return 'Today'; if (s < 2 * 86400) return 'Yesterday';
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} days ago`; if (s < 365 * 86400) return `${Math.floor(s / (30 * 86400))} mo ago`; return `${(s / (365 * 86400)).toFixed(1)} yr ago`;
}
const dateStr = (t) => (t ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const isMac = () => S.platform === 'darwin';
const isWin = () => S.platform === 'win32';
const computer = () => (isMac() ? 'Mac' : 'PC');
const initials = (n) => String(n || '?').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

// ---------------------------------------------------------------- small UI helpers
function toast(msg, err) { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; $('#toasts').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3200); }
function modal(html, { wide } = {}) {
  const m = $('#modal'), box = $('#modal-in'); box.className = 'modal' + (wide ? ' wide' : ''); box.innerHTML = html; m.hidden = false;
  return new Promise((resolve) => {
    const done = (v) => { m.hidden = true; m.onclick = null; document.removeEventListener('keydown', key); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', key);
    m.onclick = (e) => { if (e.target === m) done(null); const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r); };
    box._done = done;
  });
}
function confirmBox(title, body, ok = 'OK', danger) { return modal(`<h2>${esc(title)}</h2><p>${body}</p><div class="foot"><button class="btn" data-r="">Cancel</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" data-r="ok">${esc(ok)}</button></div>`).then((r) => r === 'ok'); }
const call = (ch, ...a) => V.call(ch, ...a);
async function safeCall(ch, ...a) { try { return await call(ch, ...a); } catch (e) { toast(e.message, true); return undefined; } }

// ---------------------------------------------------------------- icons
const iconWait = new Set(); let iconTimer = null;
function iconHtml(p, name, cls = 'appic') {
  const u = p && S.icons.get(p);
  if (u) return `<img class="${cls}" src="${u}" alt="">`;
  if (p && !S.icons.has(p)) { iconWait.add(p); clearTimeout(iconTimer); iconTimer = setTimeout(loadIcons, 60); }
  return `<span class="${cls} ph" data-icon="${esc(p || '')}">${esc(initials(name))}</span>`;
}
async function loadIcons() {
  const list = [...iconWait].slice(0, 60); list.forEach((p) => iconWait.delete(p)); if (!list.length) return;
  list.forEach((p) => S.icons.set(p, null));
  const res = await call('icons', list).catch(() => ({}));
  for (const [p, u] of Object.entries(res || {})) {
    S.icons.set(p, u);
    if (u) $$(`[data-icon="${CSS.escape(p)}"]`).forEach((el) => { const img = document.createElement('img'); img.className = el.className.replace(' ph', ''); img.src = u; img.alt = ''; el.replaceWith(img); });
  }
  if (iconWait.size) loadIcons();
}

// ---------------------------------------------------------------- theme & platform
function applyTheme() {
  const t = S.settings.theme; const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#theme-btn use').setAttribute('href', dark ? '#i-sun' : '#i-moon');
  if (isWin()) call('window:chrome', { color: '#00000000', symbolColor: dark ? '#e6ecea' : '#22302c', height: 46 });
  redrawAll();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.settings.theme === 'system') applyTheme(); });
$('#theme-btn').onclick = async () => { const dark = document.documentElement.dataset.theme === 'dark'; S.settings = await call('settings:set', { theme: dark ? 'light' : 'dark' }); applyTheme(); };

// ---------------------------------------------------------------- navigation
const loaders = {};
let procSubscribed = false;
function setProcSub(on) { if (on === procSubscribed) return; procSubscribed = on; call('procs:subscribe', on).then((p) => { if (p && on) onProcs(p); }); }
function go(target) {
  const [view, arg] = String(target).split(':');
  S.view = view;
  $$('.nav-btn[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + view));
  setProcSub(view === 'overview' || view === 'activity' || view === 'checkup');
  if (loaders[view]) loaders[view](arg);
  redrawAll();
}
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) go(b.dataset.view); });
document.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g && !e.target.closest('.seg')) go(g.dataset.go); });
V.on('navigate', go);
V.on('menu', (m) => { if (m === 'report') saveReport(); });
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') { const i = $('.view.on .search input'); if (i) { e.preventDefault(); i.focus(); i.select(); } }
  if (e.key === 'Escape') { if (!$('#drawer').hidden) closeDrawer(); }
});
window.addEventListener('resize', () => redrawAll());

// ---------------------------------------------------------------- live tick
V.on('tick', (s) => {
  S.last = s; const H = S.history; const push = (k, v) => { H[k].push(v); if (H[k].length > 300) H[k].shift(); };
  push('t', s.t); push('cpu', s.cpu.total); push('mem', s.mem.pct); push('gpu', s.gpu.util); push('rx', s.net.rx); push('tx', s.net.tx); push('read', s.disk.read); push('write', s.disk.write); push('temp', s.thermal.cpu ?? null);
  renderSide();
  if (S.view === 'overview') renderOverview();
  if (S.view === 'thermals') renderThermals();
  if (S.view === 'activity') renderActStrip();
});
function redrawAll() { if (!S.last) return; renderSide(); if (S.view === 'overview') renderOverview(); if (S.view === 'thermals') renderThermals(); if (S.view === 'focus' && S.focus) renderFocus(); if (S.view === 'checkup' && S.checkup) renderCheckup(); }

function tone(v, warn, bad) { return v == null ? 'acc' : v >= bad ? 'bad' : v >= warn ? 'warn' : 'acc'; }
function renderSide() {
  const s = S.last; if (!s) return;
  Charts.spark($('#sl-cpu'), S.history.cpu.slice(-40), { max: 100, fill: false });
  Charts.spark($('#sl-mem'), S.history.mem.slice(-40), { max: 100, fill: false, color: '--s2' });
  $('#sl-cpu-v').textContent = pct(s.cpu.total); $('#sl-mem-v').textContent = pct(s.mem.pct);
}

// ---------------------------------------------------------------- OVERVIEW
function renderOverview() {
  const s = S.last; if (!s) return; const H = S.history;
  $('#ov-sub').textContent = `${S.hostname} · up ${dur(s.uptime)}`;
  // CPU
  Charts.ring($('#ring-cpu'), s.cpu.total / 100, { tone: tone(s.cpu.total, 75, 92) });
  $('#ov-cpu').innerHTML = `${Math.round(s.cpu.total)}<small>%</small>`;
  $('#ov-cpu-split').textContent = `${pct(s.cpu.user)} apps · ${pct(s.cpu.sys)} system`;
  $('#ov-cpu-sub').textContent = `${S.cores} cores${s.cpu.load ? ` · load ${s.cpu.load[0].toFixed(2)}` : ''}`;
  Charts.spark($('#sp-cpu'), H.cpu.slice(-90));
  // memory
  const m = s.mem;
  Charts.ring($('#ring-mem'), m.pct / 100, { tone: m.pressure === 'critical' ? 'bad' : m.pressure === 'warning' ? 'warn' : 'acc' });
  $('#ov-mem').innerHTML = `${fmtB(m.used).replace(/ (\w+)$/, '<small>$1</small>')}`;
  $('#ov-mem-sub').textContent = `of ${fmtB(m.total, 0)}${m.swap && m.swap.used > 5e7 ? ` · ${fmtB(m.swap.used)} swap` : ''}`;
  const mp = $('#ov-mem-press'); mp.className = 'pill ' + (m.pressure === 'critical' ? 'bad' : m.pressure === 'warning' ? 'warn' : 'ok'); mp.innerHTML = `<i></i>${m.pressure === 'normal' ? 'Healthy' : m.pressure === 'warning' ? 'Tight' : 'Under pressure'}`;
  const parts = isMac() ? [['App', m.app, '--s1'], ['Wired', m.wired, '--s3'], ['Compressed', m.compressed, '--s2']] : [['In use', m.used, '--s1']];
  $('#ov-mem-bar').innerHTML = parts.map(([n, v, c]) => `<i title="${n} ${fmtB(v)}" style="width:${(v / m.total * 100).toFixed(2)}%;background:var(${c})"></i>`).join('');
  // GPU
  const g = s.gpu || {};
  Charts.ring($('#ring-gpu'), g.util != null ? g.util / 100 : null, { tone: tone(g.util, 85, 97) });
  $('#ov-gpu').innerHTML = g.util != null ? `${Math.round(g.util)}<small>%</small>` : '<span class="muted" style="font-size:16px">Not reported</span>';
  $('#ov-gpu-sub').textContent = g.memUsed ? `${fmtB(g.memUsed)} graphics memory${g.memTotal ? ` of ${fmtB(g.memTotal, 0)}` : ''}` : (g.util == null ? 'This system doesn’t share GPU load' : 'Busy time');
  $('#ov-gpu-name').textContent = g.name || (S.specs && S.specs.gpus[0] ? S.specs.gpus[0].model : '');
  Charts.spark($('#sp-gpu'), H.gpu.slice(-90), { color: '--s3' });
  // temp
  const t = s.thermal || {};
  const tc = t.cpu;
  Charts.ring($('#ring-temp'), tc != null ? Math.min(1, Math.max(0, (tc - 25) / 80)) : null, { tone: tc == null ? 'acc' : tc >= 95 ? 'bad' : tc >= 85 ? 'warn' : 'acc' });
  $('#ov-temp').innerHTML = tc != null ? temp(tc).replace(/°([CF])$/, '<small>°$1</small>') : `<span style="font-size:18px">${thermalWord(t.state)}</span>`;
  $('#ov-temp-sub').textContent = tc != null ? `Processor${t.gpu != null ? ` · GPU ${temp(t.gpu)}` : ''}` : (t.state ? 'Thermal pressure' : 'No sensor reading');
  const ts = $('#ov-therm-state'); const st = thermalTone(t); ts.className = 'pill ' + st[0]; ts.innerHTML = st[1] ? `<i></i>${st[1]}` : '';
  Charts.spark($('#sp-temp'), H.temp.slice(-90), { max: null, color: '--warn' });
  // network & disk
  $('#ov-rx').textContent = fmtRate(s.net.rx); $('#ov-tx').textContent = fmtRate(s.net.tx);
  Charts.area($('#ch-net'), [{ data: H.rx, color: '--s1', label: 'Down' }, { data: H.tx, color: '--s2', label: 'Up' }], { t: H.t, fmt: fmtRate });
  $('#ov-rd').textContent = fmtRate(s.disk.read); $('#ov-wr').textContent = fmtRate(s.disk.write);
  Charts.area($('#ch-disk'), [{ data: H.read, color: '--s1', label: 'Read' }, { data: H.write, color: '--s2', label: 'Write' }], { t: H.t, fmt: fmtRate });
  // storage & battery
  $('#ov-vols').innerHTML = (s.volumes || []).map((v) => { const p = v.used / v.size * 100; return `<div class="vol"><div class="vol-h"><b>${esc(v.name)}</b><span class="muted">${fmtB(v.free)} free of ${fmtB(v.size, 0)}</span></div><div class="bar ${p > 94 ? 'bad' : p > 85 ? 'warn' : ''}"><i style="width:${p.toFixed(1)}%"></i></div></div>`; }).join('') || '<div class="muted small">No drives found</div>';
  const b = s.battery || {};
  if (b.present) {
    $('#ov-bat-sub').textContent = b.plugged ? (b.charging ? 'Charging' : b.fullyCharged || b.percent >= 99 ? 'Charged' : 'Plugged in') : b.timeRemaining ? `${dur(b.timeRemaining * 60)} left` : 'On battery';
    $('#ov-bat').innerHTML = `<div class="vol"><div class="vol-h"><b>${b.percent ?? '–'}%</b><span class="muted">${b.health != null ? `Health ${b.health}%` : ''}${b.cycles ? ` · ${b.cycles} cycles` : ''}</span></div><div class="bar ${b.percent < 15 ? 'bad' : b.percent < 25 ? 'warn' : ''}"><i style="width:${b.percent || 0}%"></i></div></div>`;
  } else { $('#ov-bat-sub').textContent = ''; $('#ov-bat').innerHTML = '<div class="muted small">No battery — this computer runs on mains power.</div>'; }
  renderOvFocus();
}
function thermalWord(st) { return st ? { nominal: 'Cool', fair: 'Warm', serious: 'Hot', critical: 'Very hot' }[st] || st : '–'; }
function thermalTone(t) {
  if (t.state === 'critical' || t.state === 'serious') return ['bad', t.state === 'critical' ? 'Throttling hard' : 'Throttling'];
  if (t.state === 'fair' || (t.speedLimit != null && t.speedLimit < 100)) return ['warn', 'Warm'];
  if (t.cpu != null && t.cpu >= 95) return ['bad', 'Hot']; if (t.cpu != null && t.cpu >= 85) return ['warn', 'Warm'];
  if (t.state || t.cpu != null) return ['ok', 'Normal'];
  return ['', ''];
}
let ovTopMode = 'mem';
$('#ov-top-mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; e.stopPropagation(); ovTopMode = b.dataset.m; $$('#ov-top-mode button').forEach((x) => x.classList.toggle('on', x === b)); renderOvTop(); });
function renderOvTop() {
  if (!S.procs) return;
  const list = S.procs.groups.slice().sort((a, b) => b[ovTopMode] - a[ovTopMode]).slice(0, 7);
  const max = Math.max(...list.map((g) => g[ovTopMode]), 1);
  $('#ov-top').innerHTML = list.map((g) => `<div class="trow" data-key="${esc(g.key)}">${iconHtml(g.path, g.name)}<span class="nm">${esc(g.name)}</span><div class="minibar"><i style="width:${(g[ovTopMode] / max * 100).toFixed(1)}%"></i></div><span class="v">${ovTopMode === 'mem' ? fmtB(g.mem) : pct(g.cpu, 1)}</span></div>`).join('');
}
$('#ov-top').addEventListener('click', (e) => { const r = e.target.closest('.trow'); if (r) { const g = S.procs.groups.find((x) => x.key === r.dataset.key); if (g) openProcDrawer(g); } });
function renderOvFocus() {
  const el = $('#ov-focus'); const f = S.focusToday;
  if (!S.settings.focusTracking) { el.innerHTML = `<div class="muted small">Time tracking is off. Turn it on in Settings to see where your day goes.</div>`; return; }
  if (!f || f.active < 60) { el.innerHTML = `<div class="muted small">Vitals is keeping track of which app is in front. Your day will show up here after a few minutes.</div>`; return; }
  const top = f.apps.slice(0, 4); const max = Math.max(...top.map((a) => a.secs), 1);
  el.innerHTML = `<div class="kv" style="margin-bottom:10px"><span>Active</span><b>${dur(f.active)}</b><span>Focus score</span><b>${f.score ?? '–'}</b><span>Longest stretch</span><b>${dur(f.longest)}</b></div>` +
    top.map((a) => `<div class="trow">${iconHtml(a.path, a.name)}<span class="nm">${esc(a.name)}</span><div class="minibar"><i style="width:${(a.secs / max * 100).toFixed(1)}%"></i></div><span class="v">${dur(a.secs)}</span></div>`).join('');
}

// ---------------------------------------------------------------- ACTIVITY
const act = { sort: 'mem', asc: false, kind: 'all', q: '', open: new Set(), sel: null };
V.on('procs', onProcs);
function onProcs(p) {
  S.procs = p;
  const nb = $('#nb-activity'); const na = p.groups.filter((g) => g.kind === 'app').length; nb.hidden = !na; nb.textContent = na;
  if (S.view === 'overview') renderOvTop();
  if (S.view === 'activity') renderActivity();
  const d = $('#drawer'); if (!d.hidden && d._proc) { const g = p.groups.find((x) => x.key === d._proc); if (g) renderProcDrawer(g); }
}
loaders.activity = (arg) => { if (arg === 'cpu' || arg === 'mem') { act.sort = arg; act.asc = false; } act.kind = S.settings.activityKind || 'all'; syncSeg('#act-kind', 'k', act.kind); renderActivity(); renderActStrip(); };
function syncSeg(sel, attr, val) { $$(sel + ' button').forEach((b) => b.classList.toggle('on', b.dataset[attr] === val)); }
$('#act-kind').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; act.kind = b.dataset.k; syncSeg('#act-kind', 'k', act.kind); call('settings:set', { activityKind: act.kind }); renderActivity(); };
$('#act-q').oninput = (e) => { act.q = e.target.value.toLowerCase(); renderActivity(); };
$('#act-tbl thead').onclick = (e) => { const th = e.target.closest('th[data-s]'); if (!th) return; const k = th.dataset.s; if (act.sort === k) act.asc = !act.asc; else { act.sort = k; act.asc = k === 'name' || k === 'kind'; } renderActivity(); };
function renderActStrip() {
  const s = S.last; if (!s) return; const p = S.procs;
  $('#act-strip').innerHTML = `<span>CPU<b>${pct(s.cpu.total)}</b></span><span>Memory<b>${fmtB(s.mem.used)} / ${fmtB(s.mem.total, 0)}</b></span>${s.mem.swap && s.mem.swap.total ? `<span>Swap<b>${fmtB(s.mem.swap.used)}</b></span>` : ''}<span>GPU<b>${s.gpu.util != null ? pct(s.gpu.util) : '–'}</b></span>` +
    (p ? `<span>Apps<b>${p.groups.filter((g) => g.kind === 'app').length}</b></span><span>Background<b>${p.groups.filter((g) => g.kind === 'background').length}</b></span><span>Processes<b>${p.count}</b></span>` : '') + `<span class="grow"></span><button class="link-btn" id="act-sysmon">Open ${isMac() ? 'Activity Monitor' : 'Task Manager'}</button>`;
  $('#act-sysmon').onclick = () => call('open-system-monitor');
}
const KIND = { app: 'App', background: 'Background', system: 'System' };
function renderActivity() {
  const p = S.procs; const body = $('#act-body'); if (!p) { body.innerHTML = '<tr><td colspan="6" class="muted">Reading processes…</td></tr>'; return; }
  $('#act-sub').textContent = `${p.groups.length} apps and services`;
  let list = p.groups.filter((g) => act.kind === 'all' || g.kind === act.kind);
  if (act.q) list = list.filter((g) => g.name.toLowerCase().includes(act.q) || g.procs.some((x) => String(x.name).toLowerCase().includes(act.q) || String(x.pid) === act.q));
  const k = act.sort; const dir = act.asc ? 1 : -1;
  list.sort((a, b) => (typeof a[k] === 'string' ? a[k].localeCompare(b[k]) : (a[k] - b[k])) * dir || b.mem - a.mem);
  $$('#act-tbl th').forEach((th) => { th.classList.toggle('sorted', th.dataset.s === k); th.classList.toggle('asc', th.dataset.s === k && act.asc); });
  const maxMem = Math.max(...p.groups.map((g) => g.mem), 1); const cpuCap = S.cores * 100;
  const heat = (c) => (c > cpuCap * 0.5 || c > 150 ? 'heat h2' : c > 40 ? 'heat h1' : '');
  const rows = [];
  for (const g of list.slice(0, 400)) {
    const open = act.open.has(g.key);
    rows.push(`<tr data-key="${esc(g.key)}" class="${act.sel === g.key ? 'sel' : ''}"><td><div class="namecell"><button class="twist ${g.count > 1 ? (open ? 'open' : '') : 'none'}"><svg class="ic" width="12" height="12"><use href="#i-chev"/></svg></button>${iconHtml(g.path, g.name)}<span class="t">${esc(g.name)}${g.self ? ' <span class="muted small">(this app)</span>' : ''}</span></div></td>
      <td><span class="kindtag ${g.kind}">${KIND[g.kind]}</span></td><td class="num muted">${g.count}</td><td class="num ${heat(g.cpu)}">${pct(g.cpu, 1)}</td><td class="num">${fmtB(g.mem)}</td><td><div class="rowbar"><i style="width:${(g.mem / maxMem * 100).toFixed(1)}%"></i></div></td></tr>`);
    if (open && g.count > 1) for (const x of g.procs) rows.push(`<tr class="sub" data-key="${esc(g.key)}" data-pid="${x.pid}"><td><span class="t">${esc(x.name)}</span> <span class="muted">· ${x.pid}</span></td><td class="muted">${esc(x.user || '')}</td><td></td><td class="num">${pct(x.cpu, 1)}</td><td class="num">${fmtB(x.mem)}</td><td></td></tr>`);
  }
  body.innerHTML = rows.join('') || `<tr><td colspan="6"><div class="empty"><b>Nothing matches</b>Try a different search.</div></td></tr>`;
  const sel = p.groups.find((g) => g.key === act.sel);
  $('#act-quit').disabled = $('#act-force').disabled = !sel || sel.self;
}
$('#act-body').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-key]'); if (!tr) return;
  const key = tr.dataset.key;
  if (e.target.closest('.twist')) { act.open.has(key) ? act.open.delete(key) : act.open.add(key); renderActivity(); return; }
  act.sel = key; renderActivity();
});
$('#act-body').addEventListener('dblclick', (e) => { const tr = e.target.closest('tr[data-key]'); if (!tr) return; const g = S.procs.groups.find((x) => x.key === tr.dataset.key); if (g) openProcDrawer(g); });
$('#act-quit').onclick = () => { const g = S.procs.groups.find((x) => x.key === act.sel); if (g) quitGroup(g, false); };
$('#act-force').onclick = () => { const g = S.procs.groups.find((x) => x.key === act.sel); if (g) quitGroup(g, true); };
async function quitGroup(g, force) {
  const sys = g.kind === 'system';
  const ok = await confirmBox(force ? `Force quit ${g.name}?` : `Quit ${g.name}?`,
    (force ? 'It closes immediately. <b>Anything unsaved will be lost.</b>' : 'It will be asked to close, the same as quitting it normally.') + (g.count > 1 ? ` This ends all ${g.count} of its processes.` : '') + (sys ? `<br><br>This is part of ${isMac() ? 'macOS' : 'Windows'}; it may restart on its own or the system may misbehave until you sign out.` : ''),
    force ? 'Force quit' : 'Quit', force);
  if (!ok) return;
  const r = await safeCall('procs:quit', g.pids || g.procs.map((x) => x.pid), force);
  if (r) toast(`${force ? 'Force quit' : 'Quit'} ${g.name}`);
}

// process drawer
function openProcDrawer(g) { const d = $('#drawer'); d._proc = g.key; d.hidden = false; renderProcDrawer(g); }
function closeDrawer() { const d = $('#drawer'); d.hidden = true; d._proc = null; }
$('#drawer').addEventListener('click', (e) => { if (e.target.id === 'drawer' || e.target.closest('[data-close]')) closeDrawer(); });
function renderProcDrawer(g) {
  $('#drawer-in').innerHTML = `<button class="icon-btn sm" data-close style="float:right"><svg class="ic" width="16" height="16"><use href="#i-x"/></svg></button>
    <div class="dr-h">${iconHtml(g.path, g.name)}<div><h2>${esc(g.name)}</h2><div class="muted">${KIND[g.kind]} · ${g.count} process${g.count > 1 ? 'es' : ''}${g.bundleId ? ' · ' + esc(g.bundleId) : ''}</div></div></div>
    <div class="kv"><span>Processor</span><b>${pct(g.cpu, 1)}</b><span>Memory</span><b>${fmtB(g.mem)}</b><span>Share of memory</span><b>${S.last ? pct(g.mem / S.last.mem.total * 100, 1) : '–'}</b><span>Main process</span><b>${g.mainPid}</b>${g.users && g.users.length ? `<span>Runs as</span><b>${esc(g.users.join(', '))}</b>` : ''}</div>
    ${g.path ? `<div class="dr-sec"><h4>Location</h4><div class="path">${esc(g.path)}</div></div>` : ''}
    <div class="dr-sec"><h4>Processes</h4><div class="list">${g.procs.map((x) => `<div class="li" style="grid-template-columns:minmax(0,1fr) auto auto;min-height:40px"><div class="main"><div class="t">${esc(x.name)}</div><div class="s">PID ${x.pid}${x.user ? ' · ' + esc(x.user) : ''}</div></div><span class="tnum small">${pct(x.cpu, 1)}</span><span class="tnum small" style="width:70px;text-align:right">${fmtB(x.mem)}</span></div>`).join('')}</div></div>
    <div class="foot" style="display:flex;gap:8px;margin-top:18px">${g.path ? '<button class="btn sm" id="dr-reveal"><svg class="ic" width="15" height="15"><use href="#i-folder"/></svg>Show in ' + (isMac() ? 'Finder' : 'Explorer') + '</button>' : ''}<div class="grow"></div>${g.self ? '' : '<button class="btn sm" id="dr-quit">Quit</button><button class="btn sm danger" id="dr-force">Force quit</button>'}</div>`;
  const rv = $('#dr-reveal'); if (rv) rv.onclick = () => call('reveal', g.path);
  const q = $('#dr-quit'); if (q) q.onclick = () => quitGroup(g, false);
  const f = $('#dr-force'); if (f) f.onclick = () => quitGroup(g, true);
}

// ---------------------------------------------------------------- APPS
const ap = { sort: 'name', asc: true, filter: 'all', q: '', loading: false };
loaders.apps = async (arg) => {
  if (arg === 'unused') { ap.filter = 'unused'; ap.sort = 'lastUsed'; ap.asc = true; }
  if (arg === 'size') { ap.filter = 'big'; ap.sort = 'size'; ap.asc = false; }
  syncSeg('#apps-filter', 'f', ap.filter);
  if (!S.apps) await loadApps(false); else renderApps();
};
async function loadApps(force) {
  if (ap.loading) return; ap.loading = true;
  $('#apps-body').innerHTML = `<tr><td colspan="6" class="muted" style="padding-left:20px">Looking through your apps…</td></tr>`;
  const list = await safeCall('apps:list', force); ap.loading = false;
  if (list) { S.apps = list; const nb = $('#nb-apps'); const n = list.filter((a) => !a.protected).length; nb.hidden = !n; nb.textContent = n; }
  renderApps();
}
V.on('apps:size', ({ id, size }) => { const a = S.apps && S.apps.find((x) => x.id === id); if (a) { a.size = size; clearTimeout(ap.t); ap.t = setTimeout(() => S.view === 'apps' && renderApps(), 400); } });
$('#apps-refresh').onclick = () => loadApps(true);
$('#apps-q').oninput = (e) => { ap.q = e.target.value.toLowerCase(); renderApps(); };
$('#apps-filter').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; ap.filter = b.dataset.f; if (ap.filter === 'big') { ap.sort = 'size'; ap.asc = false; } if (ap.filter === 'unused') { ap.sort = 'lastUsed'; ap.asc = true; } syncSeg('#apps-filter', 'f', ap.filter); renderApps(); };
$('#apps-tbl thead').onclick = (e) => { const th = e.target.closest('th[data-s]'); if (!th) return; const k = th.dataset.s; if (ap.sort === k) ap.asc = !ap.asc; else { ap.sort = k; ap.asc = k === 'name' || k === 'version'; } renderApps(); };
const lastUse = (a) => a.lastUsed || (a.seenDay ? Date.parse(a.seenDay + 'T12:00:00') : null);
function renderApps() {
  const all = S.apps || []; if (!S.apps) return;
  const sys = all.filter((a) => a.protected).length;
  const total = all.filter((a) => !a.protected).reduce((x, a) => x + (a.size || 0), 0);
  $('#apps-sub').textContent = `${all.length - sys} apps${total ? ` · ${fmtB(total)}` : ''}${sys ? ` · ${sys} built in` : ''}`;
  let list = all.filter((a) => (ap.filter === 'system' ? a.protected : !a.protected));
  if (ap.filter === 'unused') list = list.filter((a) => { const l = lastUse(a); return !l || Date.now() - l > 90 * 86400000; });
  if (ap.q) list = list.filter((a) => (a.name + ' ' + (a.publisher || '') + ' ' + (a.bundleId || '')).toLowerCase().includes(ap.q));
  const k = ap.sort; const dir = ap.asc ? 1 : -1;
  const val = (a) => (k === 'lastUsed' ? (lastUse(a) || 0) : a[k]);
  list.sort((a, b) => { const x = val(a), y = val(b); if (typeof x === 'string' || typeof y === 'string') return String(x || '').localeCompare(String(y || ''), undefined, { numeric: true }) * dir; return ((x || 0) - (y || 0)) * dir; });
  $$('#apps-tbl th').forEach((th) => { th.classList.toggle('sorted', th.dataset.s === k); th.classList.toggle('asc', th.dataset.s === k && ap.asc); });
  const running = new Set((S.procs ? S.procs.groups : []).map((g) => g.path));
  $('#apps-body').innerHTML = list.map((a) => {
    const lu = lastUse(a);
    return `<tr data-id="${esc(a.id)}"><td><div class="namecell">${iconHtml(a.icon || a.path, a.name)}<div style="min-width:0"><div class="t">${esc(a.name)}${running.has(a.path) ? ' <span class="pill ok" style="height:17px;font-size:10.5px"><i></i>Running</span>' : ''}${a.source === 'store' ? ' <span class="pill" style="height:17px;font-size:10.5px">Store</span>' : ''}${a.appStore ? ' <span class="pill" style="height:17px;font-size:10.5px">App Store</span>' : ''}</div><div class="s">${esc(a.publisher || a.bundleId || '')}</div></div></div></td>
      <td class="muted">${esc(a.version || '—')}</td><td class="num">${a.size ? fmtB(a.size) : '<span class="muted">…</span>'}</td><td class="${lu && Date.now() - lu > 180 * 86400000 ? 'heat h1' : ''}">${lu ? ago(lu) : '<span class="muted">Never seen</span>'}</td><td class="muted">${dateStr(a.installed)}</td>
      <td><div class="rowacts">${a.path ? `<button class="btn xs" data-a="reveal">Show</button>` : ''}${a.protected ? '<span class="muted small">Built in</span>' : `<button class="btn xs danger" data-a="uninstall"><svg class="ic" width="13" height="13"><use href="#i-trash"/></svg>Uninstall</button>`}</div></td></tr>`;
  }).join('');
  $('#apps-empty').hidden = !!list.length;
  $('#apps-empty').innerHTML = ap.filter === 'unused' ? '<b>Nothing gathering dust</b>Every app has been used in the last three months.' : '<b>No apps match</b>';
}
$('#apps-body').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return; const a = S.apps.find((x) => x.id === tr.dataset.id); if (!a) return;
  const b = e.target.closest('[data-a]'); if (!b) return;
  if (b.dataset.a === 'reveal') call('reveal', a.path);
  if (b.dataset.a === 'uninstall') uninstall(a);
});
async function uninstall(a) {
  const running = (S.procs ? S.procs.groups : []).find((g) => g.path && a.path && g.path === a.path);
  if (isMac()) {
    const left = await safeCall('apps:leftovers', a) || [];
    const sizes = left.length ? await call('apps:leftover-sizes', left.filter((l) => l.dir).map((l) => l.path)).catch(() => ({})) : {};
    left.forEach((l) => { if (l.dir) l.size = sizes[l.path]; });
    const total = (a.size || 0) + left.reduce((x, l) => x + (l.size || 0), 0);
    const p = modal(`<h2>Uninstall ${esc(a.name)}?</h2><p>${esc(a.name)} will be moved to the Trash${left.length ? ' along with the files it keeps in your Library. Untick anything you want to keep' : ''}. You can put it all back from the Trash until you empty it.</p>
      ${running ? `<p class="pill warn" style="height:auto;padding:6px 10px"><i></i>${esc(a.name)} is open — it will be quit first.</p>` : ''}
      ${left.length ? `<div class="leftovers"><label><input type="checkbox" checked disabled><span class="p">${esc(a.path)}</span><span class="k">${a.size ? fmtB(a.size) : 'App'}</span></label>${left.map((l, i) => `<label><input type="checkbox" checked data-i="${i}"><span class="p" title="${esc(l.path)}">${esc(l.path.replace(/^\/Users\/[^/]+/, '~'))}</span><span class="k">${esc(l.kind)}${l.size ? ' · ' + fmtB(l.size) : ''}</span></label>`).join('')}</div>` : ''}
      <div class="foot"><span class="muted small" style="margin-right:auto;align-self:center">${total ? 'Frees about ' + fmtB(total) : ''}</span><button class="btn" data-r="">Cancel</button><button class="btn danger-fill" id="un-go">Move to Trash</button></div>`, { wide: left.length > 0 });
    $('#un-go').onclick = async () => {
      const chosen = $$('.leftovers input[data-i]').filter((c) => c.checked).map((c) => left[+c.dataset.i].path);
      $('#un-go').disabled = true; $('#un-go').textContent = 'Removing…';
      if (running) { await call('procs:quit', running.pids || running.procs.map((x) => x.pid), false).catch(() => {}); await new Promise((r) => setTimeout(r, 1500)); }
      try { const r = await call('apps:uninstall', a, chosen); $('#modal-in')._done(null); S.apps = S.apps.filter((x) => x.id !== a.id); renderApps(); toast(`${a.name} moved to the Trash${r.failed && r.failed.length ? ` (${r.failed.length} file${r.failed.length > 1 ? 's' : ''} couldn’t be moved)` : ''}`); }
      catch (e) { $('#modal-in')._done(null); toast(e.message, true); }
    };
    return p;
  }
  const ok = await confirmBox(`Uninstall ${a.name}?`, isWin() && a.source !== 'store' ? `${esc(a.name)}’s own uninstaller will open. Follow its steps; Vitals updates the list when it’s done.` : `${esc(a.name)} will be removed.`, 'Uninstall', true);
  if (!ok) return;
  const r = await safeCall('apps:uninstall', a); if (!r) return;
  if (r.done) { S.apps = S.apps.filter((x) => x.id !== a.id); renderApps(); toast(`${a.name} removed`); return; }
  toast(`Opened ${a.name}’s uninstaller`);
  let n = 0; const poll = setInterval(async () => { n++; const still = await call('apps:check', a).catch(() => true); if (!still) { clearInterval(poll); S.apps = S.apps.filter((x) => x.id !== a.id); renderApps(); toast(`${a.name} was uninstalled`); } if (n > 120) clearInterval(poll); }, 3000);
}

// ---------------------------------------------------------------- STARTUP
const st = { filter: 'all', q: '', apple: false, loading: false };
loaders.startup = (arg) => { if (arg === 'broken') { st.filter = 'broken'; syncSeg('#st-filter', 'f', 'broken'); } if (!S.startup) loadStartup(); else renderStartup(); };
async function loadStartup() {
  if (st.loading) return; st.loading = true; $('#st-list').innerHTML = '<div class="loading">Finding everything that starts on its own…</div>';
  const r = await safeCall('startup:list', { loginItems: true }); st.loading = false;
  if (r) { S.startup = r.items; S.startupErr = r.loginError; const on = r.items.filter((i) => i.enabled && !i.apple).length; const nb = $('#nb-startup'); nb.hidden = !on; nb.textContent = on; }
  renderStartup();
}
$('#st-refresh').onclick = loadStartup;
$('#st-q').oninput = (e) => { st.q = e.target.value.toLowerCase(); renderStartup(); };
$('#st-filter').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.filter = b.dataset.f; syncSeg('#st-filter', 'f', st.filter); renderStartup(); };
$('#st-apple').onchange = (e) => { st.apple = e.target.checked; renderStartup(); };
$('#st-os').onclick = () => call('open-external', isMac() ? 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension' : 'ms-settings:startupapps');
const ST_GROUPS = { login: 'Opens when you sign in', run: 'Opens when you sign in', folder: 'Startup folder', agent: 'Runs in the background', daemon: 'System services', task: 'Scheduled at sign-in', xdg: 'Autostart' };
function renderStartup() {
  const items = S.startup || [];
  const banner = $('#st-banner');
  if (S.startupErr === 'automation-denied') { banner.hidden = false; banner.innerHTML = `<svg class="ic" width="18" height="18"><use href="#i-info"/></svg><div class="grow">To list your Login Items, allow Vitals to control <b>System Events</b> in System Settings › Privacy &amp; Security › Automation.</div><button class="btn sm" id="st-auto">Open settings</button>`; $('#st-auto').onclick = () => call('open-external', 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation'); }
  else if (isMac()) { banner.hidden = false; banner.innerHTML = `<svg class="ic" width="18" height="18"><use href="#i-info"/></svg><div class="grow">Some newer apps register background items only macOS can switch off. Find those under <b>Allow in the Background</b> in Login Items settings.</div>`; }
  else banner.hidden = true;
  let list = items.filter((i) => st.apple || !i.apple);
  if (st.filter === 'on') list = list.filter((i) => i.enabled); if (st.filter === 'off') list = list.filter((i) => !i.enabled); if (st.filter === 'broken') list = list.filter((i) => i.missing);
  if (st.q) list = list.filter((i) => (i.name + ' ' + (i.program || '') + ' ' + (i.label || '')).toLowerCase().includes(st.q));
  const on = items.filter((i) => i.enabled && !i.apple).length;
  $('#st-sub').textContent = `${on} on · ${items.filter((i) => !i.enabled).length} off`;
  $('#st-apple-l').parentElement.hidden = !isMac();
  $('#st-os-l').textContent = isMac() ? 'Login Items settings' : 'Startup apps settings';
  const groups = {};
  for (const i of list) (groups[ST_GROUPS[i.type] || 'Other'] = groups[ST_GROUPS[i.type] || 'Other'] || []).push(i);
  const order = ['Opens when you sign in', 'Startup folder', 'Scheduled at sign-in', 'Runs in the background', 'System services', 'Autostart', 'Other'];
  const html = order.filter((g) => groups[g]).map((g) => `<div class="group-h">${g} <span class="c">${groups[g].length}</span></div><div class="list">${groups[g].sort((a, b) => a.name.localeCompare(b.name)).map(stRow).join('')}</div>`).join('');
  $('#st-list').innerHTML = html || `<div class="empty"><b>${st.filter === 'broken' ? 'Nothing broken' : 'Nothing here'}</b>${st.filter === 'all' ? 'Nothing starts on its own. Nice and clean.' : ''}</div>`;
}
function stRow(i) {
  const status = i.missing ? '<span class="pill bad"><i></i>App missing</span>' : i.running ? '<span class="pill ok"><i></i>Running</span>' : '';
  const sub = [i.kind, i.scope !== 'user' ? `for ${i.scope}` : '', i.program ? i.program.replace(/^\/Users\/[^/]+/, '~') : ''].filter(Boolean).join(' · ');
  return `<div class="li ${i.enabled ? '' : 'off'}" data-id="${esc(i.id)}">${iconHtml(i.app || (i.program && /\.(exe|app)$/i.test(i.program) ? i.program : ''), i.name)}<div class="main"><div class="t">${esc(i.name)} ${status}${i.needsAdmin ? '<svg class="ic" width="12" height="12" style="color:var(--mut)"><use href="#i-lock"/></svg>' : ''}</div><div class="s" title="${esc(i.program || '')}">${esc(sub)}</div></div>
    <div class="acts">${i.file || i.program ? `<button class="btn xs ghost" data-a="reveal">Show</button>` : ''}</div><button class="switch ${i.enabled ? 'on' : ''}" data-a="toggle" title="${i.enabled ? 'Turn off' : 'Turn on'}"></button></div>`;
}
$('#st-list').addEventListener('click', async (e) => {
  const li = e.target.closest('.li'); const b = e.target.closest('[data-a]'); if (!li || !b) return;
  const i = S.startup.find((x) => x.id === li.dataset.id); if (!i) return;
  if (b.dataset.a === 'reveal') return call('reveal', i.file || i.program);
  const enable = !i.enabled;
  if (!enable && i.apple && !(await confirmBox(`Turn off ${i.name}?`, 'This is part of macOS. Turning it off can break the feature it belongs to. You can turn it back on here.', 'Turn off', true))) return;
  b.disabled = true;
  const r = await safeCall('startup:toggle', i, enable);
  b.disabled = false;
  if (r) { i.enabled = enable; if (i.type === 'login' && !enable) i.id = 'login:' + i.name; renderStartup(); toast(`${i.name} ${enable ? 'will start again' : 'won’t start on its own any more'}`); }
});

// ---------------------------------------------------------------- PERMISSIONS
const pm = { by: 'perm', q: '' };
loaders.permissions = () => { if (!S.perms) loadPerms(); else renderPerms(); };
async function loadPerms() { $('#pm-list').innerHTML = '<div class="loading">Reading privacy settings…</div>'; const r = await safeCall('perms:list'); if (r) S.perms = r; renderPerms(); }
$('#pm-refresh').onclick = loadPerms;
$('#pm-q').oninput = (e) => { pm.q = e.target.value.toLowerCase(); renderPerms(); };
$('#pm-by').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; pm.by = b.dataset.b; syncSeg('#pm-by', 'b', pm.by); renderPerms(); };
function clientName(c) {
  if (!c) return '?';
  const a = (S.apps || []).find((x) => x.bundleId && x.bundleId === c);
  if (a) return a.name;
  if (/[\\/]/.test(c)) return c.split(/[\\/]/).pop().replace(/\.(exe|app)$/i, '');
  const known = { 'com.apple.Terminal': 'Terminal', 'com.googlecode.iterm2': 'iTerm', 'com.microsoft.VSCode': 'Visual Studio Code', 'com.google.Chrome': 'Google Chrome', 'us.zoom.xos': 'Zoom', 'com.tinyspeck.slackmacgap': 'Slack', 'com.hnc.Discord': 'Discord', 'com.microsoft.teams2': 'Microsoft Teams' };
  if (known[c]) return known[c];
  const parts = c.split(/[._]/).filter((p) => !/^(com|org|net|io|app|co|us|de|Microsoft|[0-9a-z]{13})$/.test(p));
  const n = (parts.pop() || c).replace(/([a-z])([A-Z])/g, '$1 $2');
  return n.charAt(0).toUpperCase() + n.slice(1);
}
function clientPath(c) { if (/^\//.test(c) || /^[a-z]:\\/i.test(c)) return c; const a = (S.apps || []).find((x) => x.bundleId && x.bundleId === c); return a ? a.path : ''; }
function renderPerms() {
  const r = S.perms; const el = $('#pm-list'); if (!r) return;
  if (r.unsupported) { el.innerHTML = '<div class="empty"><b>Not available on this system</b>Permissions are read on Mac and Windows.</div>'; return; }
  if (r.needsAccess) {
    $('#pm-sub').textContent = '';
    el.innerHTML = `<div class="callout"><div class="ci"><svg class="ic" width="26" height="26"><use href="#i-lock"/></svg></div><div><h3>Let Vitals read your privacy settings</h3><p>macOS keeps the list of which apps can use your camera, microphone, screen and files in a protected place. Vitals only reads it — it never changes anything unless you press Remove.</p>
      <ol><li>Open <b>Full Disk Access</b> in System Settings.</li><li>Turn on <b>Vitals</b> (press + and pick it from Applications if it isn’t listed).</li><li>Come back and press Check again.</li></ol>
      <div style="display:flex;gap:8px"><button class="btn primary" id="pm-fda">Open Full Disk Access</button><button class="btn" id="pm-again">Check again</button></div></div></div>`;
    $('#pm-fda').onclick = () => call('perms:open-settings', null); $('#pm-again').onclick = loadPerms; return;
  }
  let rows = r.rows.filter((x) => !x.global);
  if (pm.q) rows = rows.filter((x) => (clientName(x.client) + ' ' + x.client + ' ' + x.label).toLowerCase().includes(pm.q));
  const allowed = rows.filter((x) => x.allowed);
  $('#pm-sub').textContent = `${new Set(allowed.map((x) => x.client)).size} apps have access to something`;
  const globals = r.rows.filter((x) => x.global && !x.allowed);
  const live = rows.filter((x) => x.inUse);
  let html = live.length ? `<div class="banner" style="margin:0 0 12px;border-color:color-mix(in srgb,var(--bad) 40%,transparent);background:color-mix(in srgb,var(--bad) 7%,transparent)"><svg class="ic" width="18" height="18" style="color:var(--bad)"><use href="#i-cam"/></svg><div class="grow"><b>In use right now:</b> ${live.map((x) => `${esc(clientName(x.client))} (${esc(x.label)})`).join(', ')}</div></div>` : '';
  if (globals.length) html += `<div class="note" style="margin:0 0 10px">Turned off for every app: ${globals.map((g) => esc(g.label)).join(', ')}.</div>`;
  if (pm.by === 'perm') {
    const by = {}; for (const x of rows) (by[x.label] = by[x.label] || { group: x.group, rows: [] }).rows.push(x);
    const groups = ['Screen & input', 'Devices', 'Files', 'Personal data'];
    for (const g of groups) {
      const labels = Object.keys(by).filter((l) => by[l].group === g).sort();
      if (!labels.length) continue;
      html += `<div class="group-h">${g}</div><div class="list">` + labels.map((l) => {
        const list = by[l].rows.sort((a, b) => (b.allowed - a.allowed) || clientName(a.client).localeCompare(clientName(b.client)));
        return `<div class="li" style="grid-template-columns:minmax(0,1fr) auto;align-items:start"><div class="main"><div class="t">${esc(l)} <span class="muted small">${list.filter((x) => x.allowed).length} allowed</span></div><div class="chips">${list.map((x) => permChip(x)).join('')}</div></div><button class="btn xs ghost" data-settings="${esc(list[0].service || list[0].cap)}" data-label="${esc(l)}"><svg class="ic" width="13" height="13"><use href="#i-ext"/></svg>Settings</button></div>`;
      }).join('') + '</div>';
    }
  } else {
    const by = {}; for (const x of rows) (by[x.client] = by[x.client] || []).push(x);
    const clients = Object.keys(by).sort((a, b) => by[b].filter((x) => x.allowed).length - by[a].filter((x) => x.allowed).length || clientName(a).localeCompare(clientName(b)));
    html += `<div class="list">` + clients.map((c) => `<div class="li" style="grid-template-columns:28px minmax(0,1fr);align-items:start">${iconHtml(clientPath(c), clientName(c))}<div class="main"><div class="t">${esc(clientName(c))} <span class="muted small" style="font-weight:400">${esc(c.length > 60 ? '…' + c.slice(-58) : c)}</span></div><div class="chips">${by[c].map((x) => permChip(x, true)).join('')}</div></div></div>`).join('') + '</div>';
  }
  el.innerHTML = html || '<div class="empty"><b>No permissions found</b></div>';
}
function permChip(x, showLabel) {
  const idx = S.perms.rows.indexOf(x);
  const name = showLabel ? x.label + (x.target ? ` → ${clientName(x.target)}` : '') : clientName(x.client) + (x.target ? ` → ${clientName(x.target)}` : '');
  const when = x.lastUsed ? ` · used ${ago(x.lastUsed).toLowerCase()}` : '';
  return `<span class="chip ${x.allowed ? 'on' : 'denied'} ${x.inUse ? 'live' : ''}" title="${esc(x.client)}${x.allowed ? '' : ' — not allowed'}${when}">${!showLabel ? iconHtml(clientPath(x.client), clientName(x.client), 'appic') : ''}${esc(name)}${x.allowed ? `<button data-revoke="${idx}" title="Remove access"><svg class="ic" width="12" height="12"><use href="#i-x"/></svg></button>` : (isWin() ? `<button data-allow="${idx}" title="Allow"><svg class="ic" width="12" height="12"><use href="#i-check"/></svg></button>` : '')}</span>`;
}
$('#pm-list').addEventListener('click', async (e) => {
  const rv = e.target.closest('[data-revoke]'), al = e.target.closest('[data-allow]'), se = e.target.closest('[data-settings]');
  if (se) { const row = S.perms.rows.find((x) => (x.service || x.cap) === se.dataset.settings); return call('perms:open-settings', row); }
  if (rv) {
    const x = S.perms.rows[+rv.dataset.revoke];
    const body = isMac() ? `macOS resets ${esc(clientName(x.client))}’s ${esc(x.label)} access. It will have to ask again next time it needs it.` : `${esc(clientName(x.client))} won’t be able to use ${esc(x.label).toLowerCase()} until you allow it again.`;
    if (!(await confirmBox(`Remove ${x.label} access?`, body, 'Remove', true))) return;
    const r = await safeCall('perms:revoke', x); if (r) { x.allowed = false; if (isMac()) S.perms.rows.splice(S.perms.rows.indexOf(x), 1); renderPerms(); toast('Access removed'); }
  }
  if (al) { const x = S.perms.rows[+al.dataset.allow]; const r = await safeCall('perms:allow', x); if (r) { x.allowed = true; renderPerms(); toast('Allowed'); } }
});

// ---------------------------------------------------------------- FOCUS
const fx = { days: 1 };
loaders.focus = () => loadFocus();
$('#fx-range').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; fx.days = +b.dataset.d; syncSeg('#fx-range', 'd', String(fx.days)); loadFocus(); };
$('#fx-pause').onclick = async () => { const p = await call('focus:pause', !S.paused); S.paused = p; syncPause(); };
V.on('focus:paused', (p) => { S.paused = p; syncPause(); });
function syncPause() { $('#fx-pause span').textContent = S.paused ? 'Resume tracking' : 'Pause tracking'; $('#fx-pause use').setAttribute('href', S.paused ? '#i-play' : '#i-pause'); }
async function loadFocus() { const r = await safeCall('focus:summary', Math.max(7, fx.days)); if (!r) return; S.focus = r; S.focusToday = r.days[r.days.length - 1]; S.paused = r.paused; syncPause(); renderFocus(); }
setInterval(async () => { if (!S.settings.focusTracking) return; const r = await call('focus:summary', 1).catch(() => null); if (r) { S.focusToday = r.days[0]; renderFocusSide(r.current); if (S.view === 'focus' && fx.days === 1) { S.focus = { ...S.focus, ...r, days: S.focus ? [...S.focus.days.slice(0, -1), r.days[0]] : r.days }; renderFocus(); } } }, 30000);
function renderFocusSide(cur) {
  const el = $('#sl-focus');
  if (!S.settings.focusTracking) { el.innerHTML = ''; return; }
  if (S.paused) { el.innerHTML = 'Time tracking paused'; return; }
  el.innerHTML = cur ? `${iconHtml('', cur.name).replace('appic', 'appic')}<span>${esc(cur.name)} · ${dur(cur.secs)}</span>` : (S.focusToday && S.focusToday.active > 60 ? `Active today · ${dur(S.focusToday.active)}` : '');
}
const CAT = { focus: 'Focus', neutral: 'Neutral', distracting: 'Distracting' };
function renderFocus() {
  const el = $('#fx-page'); const r = S.focus; if (!r) return;
  if (!S.settings.focusTracking) { el.innerHTML = `<div class="callout"><div class="ci"><svg class="ic" width="26" height="26"><use href="#i-focus"/></svg></div><div><h3>Time tracking is off</h3><p>Vitals can note which app is in front while you work — never window titles or what’s on screen — and turn it into a picture of your day: where time goes, how long you stay focused, and how often you switch.</p><button class="btn primary" id="fx-on">Turn on time tracking</button></div></div>`; $('#fx-on').onclick = async () => { S.settings = await call('settings:set', { focusTracking: true }); loadFocus(); }; return; }
  const days = r.days.slice(-fx.days); const today = days[days.length - 1];
  const active = days.reduce((a, d) => a + d.active, 0), focusSecs = days.reduce((a, d) => a + d.focusSecs, 0), sessions = days.reduce((a, d) => a + d.focusSessions, 0);
  const switches = days.reduce((a, d) => a + d.switches, 0); const scores = days.map((d) => d.score).filter((x) => x != null);
  const score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const longest = Math.max(0, ...days.map((d) => d.longest));
  const apps = {}; for (const d of days) for (const a of d.apps) { const x = apps[a.key] || (apps[a.key] = { ...a, secs: 0, opens: 0 }); x.secs += a.secs; x.opens += a.opens; }
  const appList = Object.values(apps).sort((a, b) => b.secs - a.secs);
  const byCat = { focus: 0, neutral: 0, distracting: 0 }; for (const a of appList) byCat[a.cat] += a.secs;
  $('#fx-sub').textContent = fx.days === 1 ? new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : `Last ${fx.days} days`;
  if (active < 60) { el.innerHTML = `<div class="empty"><b>Nothing tracked yet</b>Vitals notes which app is in front every few seconds while it’s running (even with the window closed). Check back in a little while.</div>`; return; }
  const perDay = fx.days > 1 ? active / days.filter((d) => d.active > 0).length : null;
  el.innerHTML = `
  <div class="fx-top">
    <div class="card stat"><div class="score-ring"><canvas id="fx-score" width="84" height="84"></canvas><div><div class="lbl">Focus score</div><div class="big">${score ?? '–'}</div><div class="s">${scoreWord(score)}</div></div></div></div>
    <div class="card stat"><div class="lbl">${fx.days === 1 ? 'Active today' : 'Active time'}</div><div class="big">${dur(active, 'h')}</div><div class="s">${perDay ? `${dur(perDay)} a day on average` : today.first ? `Since ${new Date(today.first).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</div></div>
    <div class="card stat"><div class="lbl">Deep focus</div><div class="big">${dur(focusSecs, 'h')}</div><div class="s">${sessions} session${sessions === 1 ? '' : 's'} of ${S.settings.focusSessionMinutes}+ min · longest ${dur(longest)}</div></div>
    <div class="card stat"><div class="lbl">App switches</div><div class="big">${switches}</div><div class="s">${active > 600 ? `${(switches / (active / 3600)).toFixed(0)} an hour` : ''}</div></div>
  </div>
  <div class="fx-grid">
    <div class="card"><div class="card-h"><span>${fx.days === 1 ? 'Through the day' : 'Day by day'}</span><span class="legend"><i class="lg a"></i>Focus <i class="lg" style="background:var(--mut)"></i>Neutral <i class="lg b"></i>Distracting</span></div>${fx.days === 1 ? hoursChart(today) : daysChart(days)}
      ${fx.days === 1 ? timeline(today) : ''}</div>
    <div class="card"><div class="card-h"><span>Where the time went</span></div>
      <div class="stackbar" style="height:12px;margin:0 0 6px">${['focus', 'neutral', 'distracting'].map((c) => `<i style="width:${(byCat[c] / active * 100).toFixed(2)}%;background:var(${c === 'focus' ? '--s1' : c === 'distracting' ? '--s2' : '--mut'})"></i>`).join('')}</div>
      <div class="stack-legend">${['focus', 'neutral', 'distracting'].map((c) => `<span><i class="cat-dot cat-${c}"></i>${CAT[c]} ${dur(byCat[c], 'h')}</span>`).join('')}</div>
      <div class="note">Set each app’s category below. Focus sessions are unbroken stretches of ${S.settings.focusSessionMinutes} minutes or more in one app that isn’t marked distracting. The score blends time in those sessions (50%), how calmly you switch (30%) and how little time goes to distractions (20%).</div>
    </div>
  </div>
  <div class="card fx-apps" style="margin-top:12px"><div class="card-h"><span>Apps</span><span class="muted small">${appList.length} used</span></div>
    ${appList.slice(0, 40).map((a) => `<div class="trow">${iconHtml(a.path, a.name)}<span class="nm">${esc(a.name)}</span><div class="minibar"><i style="width:${(a.secs / appList[0].secs * 100).toFixed(1)}%;background:var(${a.cat === 'focus' ? '--s1' : a.cat === 'distracting' ? '--s2' : '--mut'})"></i></div><span class="v">${dur(a.secs, 'h')}</span>
      <select class="catsel" data-key="${esc(a.key)}">${Object.entries(CAT).map(([k, v]) => `<option value="${k}" ${a.cat === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`).join('')}
  </div>`;
  Charts.ring($('#fx-score'), score != null ? score / 100 : null, { width: 8 });
  $$('.catsel', el).forEach((s) => (s.onchange = async () => { await call('focus:category', s.dataset.key, s.value); S.settings.focusCategories = { ...(S.settings.focusCategories || {}), [s.dataset.key]: s.value }; loadFocus(); }));
}
function scoreWord(s) { if (s == null) return 'Needs a few more minutes'; if (s >= 75) return 'Deep, steady work'; if (s >= 55) return 'Good focus'; if (s >= 35) return 'Fairly scattered'; return 'Lots of switching'; }
function hoursChart(d) {
  const max = Math.max(...d.hours, 600);
  const bars = d.hours.map((v, h) => `<div class="hb" style="height:100%" title="${h}:00 — ${dur(v)}"><i style="height:${(v / max * 100).toFixed(1)}%"></i></div>`).join('');
  return `<div class="hours">${bars}</div><div class="hours-ax">${d.hours.map((_, h) => `<span>${h % 3 === 0 ? (h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p') : ''}</span>`).join('')}</div>`;
}
function daysChart(days) {
  const max = Math.max(...days.map((d) => d.active), 3600);
  return `<div class="days ${days.length > 10 ? 'many' : ''}">${days.map((d) => { const H = 120; return `<div class="d" title="${d.day}: ${dur(d.active)}"><div class="col">${['focus', 'neutral', 'distracting'].map((c) => `<i style="height:${(d.byCat[c] / max * H).toFixed(1)}px;background:var(${c === 'focus' ? '--s1' : c === 'distracting' ? '--s2' : '--mut'})"></i>`).join('')}</div><span>${new Date(d.day + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })}</span></div>`; }).join('')}</div>`;
}
function timeline(d) {
  if (!d.sessions.length) return '';
  const start = new Date(d.first || Date.now()); start.setMinutes(0, 0, 0); const s0 = start.getTime(); const s1 = Math.max(Date.now(), s0 + 3600000); const span = s1 - s0;
  const cats = S.settings.focusCategories || {}; const catOf = (k) => (d.apps.find((a) => a.key === k) || {}).cat || cats[k] || 'neutral';
  return `<div class="card-h mt"><span>Sessions</span><span class="muted small">stretches of a minute or more</span></div><div class="timeline">${d.sessions.map((x) => `<i title="${esc(x.name)} · ${dur((x.end - x.start) / 1000)}" style="left:${((x.start - s0) / span * 100).toFixed(2)}%;width:${Math.max(0.3, (x.end - x.start) / span * 100).toFixed(2)}%;background:var(${catOf(x.key) === 'focus' ? '--s1' : catOf(x.key) === 'distracting' ? '--s2' : '--mut'});opacity:.9"></i>`).join('')}</div>
    <div class="tl-ax"><span>${start.toLocaleTimeString([], { hour: 'numeric' })}</span><span>now</span></div>`;
}

// ---------------------------------------------------------------- THERMALS & POWER
loaders.thermals = () => { thBuilt = false; renderThermals(); };
let thBuilt = false;
function renderThermals() {
  const s = S.last; if (!s) return; const t = s.thermal || {}; const b = s.battery || {}; const el = $('#th-page');
  if (!thBuilt) {
    el.innerHTML = `<div class="th-grid">
      <div class="card"><div class="card-h"><span>Processor</span><span class="pill" id="th-state"></span></div><div class="gauge-row"><canvas class="ring" id="th-ring" width="120" height="120"></canvas><div class="gauge-meta"><div class="big" id="th-cpu">–</div><div class="muted small" id="th-cpu-s"></div></div></div></div>
      <div class="card"><div class="card-h"><span>Graphics</span></div><div class="gauge-row"><canvas class="ring" id="th-gring" width="120" height="120"></canvas><div class="gauge-meta"><div class="big" id="th-gpu">–</div><div class="muted small" id="th-gpu-s"></div></div></div></div>
      <div class="card"><div class="card-h"><span>Fans</span></div><div id="th-fans"></div></div>
    </div>
    <div class="th-grid2">
      <div class="card"><div class="card-h"><span>Temperature history</span><span class="legend"><i class="lg c"></i>Processor</span></div><canvas class="chart" id="th-hist" height="150" style="height:150px"></canvas><div class="empty" id="th-hist-empty" style="padding:40px 10px" hidden>No temperature readings from this computer${isMac() ? ' — macOS shares thermal pressure instead' : ''}.</div>
        <div class="card-h mt"><span>Per core</span><span class="muted small" id="th-cores-s"></span></div><div class="cores" id="th-cores"></div><div class="note" id="th-note"></div></div>
      <div class="card"><div class="card-h"><span>Battery</span><span class="pill" id="th-bat-pill"></span></div><div id="th-bat"></div></div>
    </div>`;
    thBuilt = true;
  }
  const st = thermalTone(t); const sp = $('#th-state'); sp.className = 'pill ' + st[0]; sp.innerHTML = st[1] ? `<i></i>${st[1]}` : '';
  $('#th-sub').textContent = t.state ? `Thermal pressure: ${t.state}` : '';
  Charts.ring($('#th-ring'), t.cpu != null ? Math.min(1, Math.max(0, (t.cpu - 25) / 80)) : (t.state ? { nominal: .25, fair: .55, serious: .8, critical: 1 }[t.state] : null), { tone: st[0] === 'bad' ? 'bad' : st[0] === 'warn' ? 'warn' : 'acc', text: t.cpu != null ? temp(t.cpu) : thermalWord(t.state) });
  $('#th-cpu').innerHTML = t.cpu != null ? temp(t.cpu) : `<span style="font-size:18px">${thermalWord(t.state)}</span>`;
  $('#th-cpu-s').innerHTML = [t.soc != null ? `Chip average ${temp(t.soc)}` : '', t.speedLimit != null ? `Speed limit ${t.speedLimit}%` : '', `Load ${pct(s.cpu.total)}`].filter(Boolean).join('<br>');
  const g = s.gpu || {};
  Charts.ring($('#th-gring'), t.gpu != null ? Math.min(1, Math.max(0, (t.gpu - 25) / 80)) : (g.util != null ? g.util / 100 : null), { tone: t.gpu >= 90 ? 'bad' : t.gpu >= 80 ? 'warn' : 'acc', text: t.gpu != null ? temp(t.gpu) : g.util != null ? pct(g.util) : '–' });
  $('#th-gpu').innerHTML = t.gpu != null ? temp(t.gpu) : (g.util != null ? `${Math.round(g.util)}<small>% busy</small>` : '<span class="muted" style="font-size:16px">No reading</span>');
  $('#th-gpu-s').innerHTML = [g.util != null && t.gpu != null ? `${pct(g.util)} busy` : '', g.memUsed ? `${fmtB(g.memUsed)} memory` : '', g.power != null ? `${g.power.toFixed(0)} W` : ''].filter(Boolean).join('<br>');
  $('#th-fans').innerHTML = t.fans && t.fans.length ? t.fans.map((f) => `<div class="vol"><div class="vol-h"><b>${esc(f.label || 'Fan')}</b><span class="muted">${f.rpm != null ? `${Math.round(f.rpm)} rpm` : ''}${f.pct != null ? ` · ${Math.round(f.pct)}%` : ''}</span></div><div class="bar"><i style="width:${f.pct != null ? f.pct : (f.max ? f.rpm / f.max * 100 : 0)}%"></i></div></div>`).join('')
    : `<div class="gauge-row" style="min-height:92px"><svg class="ic" width="34" height="34" style="color:var(--mut)"><use href="#i-fan"/></svg><div class="muted small">${S.specs && /MacBook Air/i.test(S.specs.model) ? 'MacBook Air has no fan — it cools silently and slows down a little when it gets hot.' : 'No fan readings from this computer.'}</div></div>`;
  const hist = $('#th-hist'); hist._max = null;
  const hasT = S.history.temp.some((v) => v != null);
  hist.hidden = !hasT; $('#th-hist-empty').hidden = hasT;
  if (hasT) Charts.area(hist, [{ data: S.history.temp, color: '--s3', label: 'Processor' }], { t: S.history.t, fmt: (v) => temp(v) });
  // cores: load + temperatures
  const cores = s.cpu.cores || []; const tc = t.cores || [];
  $('#th-cores-s').textContent = `${cores.length} cores${tc.length ? ` · ${tc.length} sensors` : ''}`;
  $('#th-cores').innerHTML = cores.map((c, i) => `<div class="core">${i + 1}<b>${Math.round(c)}%</b>${tc[i] != null ? `<span>${temp(tc[i])}</span>` : ''}<div class="cb"><i style="width:${c.toFixed(0)}%"></i></div></div>`).join('');
  $('#th-note').textContent = t.cpu == null ? (isWin() ? 'This PC’s firmware doesn’t share a processor temperature with Windows. Graphics temperature appears for NVIDIA cards.' : isMac() ? 'macOS reports thermal pressure instead of a temperature on this Mac.' : 'No temperature sensors found.') : (t.source === 'acpi' ? 'Temperature comes from the motherboard’s thermal zones, which can read lower than the processor itself.' : '');
  // battery
  const bp = $('#th-bat-pill');
  if (!b.present) { bp.className = 'pill'; bp.textContent = ''; $('#th-bat').innerHTML = '<div class="muted small">No battery — this computer runs on mains power.</div>'; return; }
  bp.className = 'pill ' + (b.health != null && b.health < 80 ? 'warn' : 'ok'); bp.innerHTML = b.health != null ? `<i></i>${b.health < 80 ? 'Service soon' : 'Healthy'}` : '';
  $('#th-bat').innerHTML = `<div class="gauge-row" style="margin-bottom:14px"><canvas class="ring" id="th-bring" width="120" height="120"></canvas><div class="gauge-meta"><div class="big">${b.percent ?? '–'}<small>%</small></div><div class="muted small">${b.plugged ? (b.charging ? 'Charging' : 'Plugged in') : b.timeRemaining ? `${dur(b.timeRemaining * 60)} remaining` : 'On battery'}</div></div></div>
    <div class="kv"><span>Health</span><b>${b.health != null ? b.health + '%' : '–'}</b><span>Charge cycles</span><b>${b.cycles ?? '–'}</b>${b.maxCapacity ? `<span>Holds now</span><b>${b.maxCapacity} mAh</b>` : ''}${b.designCapacity ? `<span>When new</span><b>${b.designCapacity} mAh</b>` : ''}${b.temperature != null ? `<span>Temperature</span><b>${temp(b.temperature)}</b>` : ''}${b.voltage ? `<span>Voltage</span><b>${b.voltage.toFixed(2)} V</b>` : ''}${b.amperage && b.voltage ? `<span>${b.amperage < 0 ? 'Drawing' : 'Charging at'}</span><b>${Math.abs(b.amperage * b.voltage / 1000).toFixed(1)} W</b>` : ''}</div>
    <div class="note">Batteries are usually considered worn below 80% health${isMac() ? ' (Apple’s service threshold). Laptops last longest kept between 20 and 80%.' : '.'}</div>`;
  Charts.ring($('#th-bring'), (b.percent || 0) / 100, { tone: b.percent < 15 ? 'bad' : b.percent < 25 ? 'warn' : 'acc' });
}

// ---------------------------------------------------------------- SPECS
loaders.specs = async () => { if (!S.specs) S.specs = await safeCall('specs'); renderSpecs(); };
function renderSpecs() {
  const sp = S.specs; if (!sp) return; const el = $('#sp-page');
  const t = (rows) => `<table class="spec-t">${rows.filter(([, v]) => v != null && v !== '' && v !== 0).map(([k, v, cls]) => `<tr><th>${esc(k)}</th><td class="${cls || ''}">${esc(v)}</td></tr>`).join('')}</table>`;
  const serial = S.settings.showSerials ? '' : 'blur';
  const cache = sp.cpu.cache || {};
  el.innerHTML = `<div class="card sp-hero"><div class="devic"><svg class="ic" width="44" height="44"><use href="#i-chip"/></svg></div><div><h2>${esc(sp.model)}</h2><div class="muted">${esc(sp.cpu.name)} · ${fmtB(sp.memory.total, 0)} memory · ${esc(sp.os.name)} ${esc(sp.os.version)}</div></div>
      <div class="kv"><span>Up for</span><b>${dur(S.last ? S.last.uptime : sp.os.uptime)}</b><span>Name</span><b>${esc(sp.hostname)}</b></div></div>
    <div class="sp-grid">
      <div class="card"><div class="card-h"><span>Processor</span></div>${t([['Chip', sp.cpu.name], ['Cores', sp.cpu.performanceCores && sp.cpu.efficiencyCores ? `${sp.cpu.cores} (${sp.cpu.performanceCores} performance + ${sp.cpu.efficiencyCores} efficiency)` : sp.cpu.cores], ['Threads', sp.cpu.threads !== sp.cpu.cores ? sp.cpu.threads : null], ['Base speed', sp.cpu.speed ? `${sp.cpu.speed} GHz` : null], ['Max speed', sp.cpu.speedMax && sp.cpu.speedMax !== sp.cpu.speed ? `${sp.cpu.speedMax} GHz` : null], ['L2 cache', cache.l2 ? fmtB(cache.l2, 0) : null], ['L3 cache', cache.l3 ? fmtB(cache.l3, 0) : null], ['Architecture', sp.arch], ['Socket', sp.cpu.socket]])}</div>
      <div class="card"><div class="card-h"><span>Memory</span></div>${t([['Installed', fmtB(sp.memory.total, 0)], ...sp.memory.modules.map((m, i) => [m.slot || `Module ${i + 1}`, [fmtB(m.size, 0), m.type, m.speed ? m.speed + ' MHz' : '', m.maker].filter(Boolean).join(' · ')])])}</div>
      <div class="card"><div class="card-h"><span>Graphics &amp; displays</span></div>${t([...sp.gpus.map((g) => ['Graphics', [g.model, g.cores ? `${g.cores} cores` : '', typeof g.vram === 'number' ? fmtB(g.vram, 0) : g.vram].filter(Boolean).join(' · ')]), ...sp.displays.map((d) => [d.internal ? 'Built-in display' : (d.name || 'Display'), d.resolution || d.pixels])])}</div>
      <div class="card"><div class="card-h"><span>Storage</span></div>${t([...sp.disks.map((d) => [d.name || 'Drive', [fmtB(d.size, 0), d.type, d.interface, d.smart && d.smart !== 'unknown' ? `SMART ${d.smart}` : ''].filter(Boolean).join(' · ')]), ...((S.last && S.last.volumes) || []).map((v) => [v.name, `${fmtB(v.free)} free of ${fmtB(v.size, 0)}`])])}</div>
      <div class="card"><div class="card-h"><span>System</span></div>${t([['Operating system', `${sp.os.name} ${sp.os.version}`], ['Build', sp.os.build], ['Kernel', sp.os.kernel], ['Model ID', sp.modelId !== sp.model ? sp.modelId : null], ['Firmware', sp.firmware], ['Motherboard', sp.board], ['Serial number', sp.serial && sp.serial !== '-' ? sp.serial : null, serial], ['Booted', new Date(sp.os.bootTime).toLocaleString()]])}</div>
      <div class="card"><div class="card-h"><span>Network</span></div>${t(sp.network.map((n) => [n.name + (n.ssid ? ` (${n.ssid})` : ''), [n.type, n.ip4, n.speed > 0 ? `${n.speed} Mb/s` : ''].filter(Boolean).join(' · ')]))}</div>
      ${sp.battery ? `<div class="card"><div class="card-h"><span>Battery</span></div>${t([['Cycles', sp.battery.cycles], ['Capacity', sp.battery.max && sp.battery.design ? `${sp.battery.max} of ${sp.battery.design} ${sp.battery.unit || ''}` : null], ['Type', sp.battery.type], ['Maker', sp.battery.maker]])}</div>` : ''}
    </div>`;
  $$('.blur', el).forEach((x) => (x.onclick = () => x.classList.remove('blur')));
}
$('#sp-copy').onclick = () => {
  const sp = S.specs; if (!sp) return;
  const lines = [sp.model, `Processor: ${sp.cpu.name} (${sp.cpu.cores} cores)`, `Memory: ${fmtB(sp.memory.total, 0)}`, ...sp.gpus.map((g) => `Graphics: ${g.model}${g.cores ? ` (${g.cores} cores)` : ''}`), ...sp.disks.map((d) => `Storage: ${d.name} ${fmtB(d.size, 0)}`), `OS: ${sp.os.name} ${sp.os.version}${sp.os.build ? ` (${sp.os.build})` : ''}`];
  navigator.clipboard.writeText(lines.join('\n')).then(() => toast('Specs copied'));
};

// ---------------------------------------------------------------- CHECKUP
loaders.checkup = () => runCheckup(!S.checkup);
$('#ck-run').onclick = () => runCheckup(true);
$('#ck-report').onclick = saveReport;
async function saveReport() { const b = $('#ck-report'); b.disabled = true; const p = await safeCall('report'); b.disabled = false; if (p) toast('Report saved'); }
async function runCheckup(deep) {
  if (!S.checkup) $('#ck-page').innerHTML = '<div class="loading">Checking storage, memory, temperatures, startup items and apps…</div>';
  const r = await safeCall('checkup', deep); if (!r) return; S.checkup = r; renderCheckup(); badgeCheckup();
}
function badgeCheckup() { const r = S.checkup; const nb = $('#nb-checkup'); if (!r) return; const n = r.bad + r.warn; nb.hidden = !n; nb.textContent = n; nb.className = 'badge ' + (r.bad ? 'bad' : 'warn'); $('#ov-health').textContent = `Health ${r.score}`; }
const FI = { bad: 'i-alert', warn: 'i-alert', info: 'i-info', ok: 'i-check' };
function renderCheckup() {
  const r = S.checkup; if (!r) return;
  $('#ck-sub').textContent = `${r.bad + r.warn ? `${r.bad + r.warn} to look at` : 'All clear'}`;
  const head = r.bad ? 'A few things need attention' : r.warn ? `Your ${computer()} is in decent shape` : `Your ${computer()} is in great shape`;
  $('#ck-page').innerHTML = `<div class="card ck-hero"><canvas id="ck-ring" width="130" height="130"></canvas><div><h2>${head}</h2><p>${r.bad ? `${r.bad} problem${r.bad > 1 ? 's' : ''}` : 'No problems'}${r.warn ? ` and ${r.warn} thing${r.warn > 1 ? 's' : ''} worth a look` : ''}. Vitals checked storage, memory, the processor, temperatures, battery, startup items, unused apps and permissions.</p></div></div>
    <div class="list">${r.findings.map((f) => `<div class="finding ${f.level}"><div class="fi"><svg class="ic" width="17" height="17"><use href="#${FI[f.level]}"/></svg></div><div><b>${esc(f.title)}</b><span>${esc(f.detail || '')}</span></div>${f.action ? `<button class="btn sm" data-go="${esc(f.action.go)}">${esc(f.action.label)}</button>` : '<span></span>'}</div>`).join('')}</div>`;
  Charts.ring($('#ck-ring'), r.score / 100, { width: 11, tone: r.score < 50 ? 'bad' : r.score < 75 ? 'warn' : 'acc', text: String(r.score) });
}

// ---------------------------------------------------------------- SETTINGS
$('#open-settings').onclick = openSettings;
function openSettings() {
  const s = S.settings;
  const sel = (k, opts) => `<select data-k="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(s[k]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const sw = (k) => `<button class="switch ${s[k] ? 'on' : ''}" data-sw="${k}"></button>`;
  modal(`<h2>Settings</h2>
    <div class="set-sec">General</div>
    <div class="set-row"><div>Appearance</div>${sel('theme', [['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']])}</div>
    <div class="set-row"><div>Refresh every<div class="s">Faster updates use a little more power.</div></div>${sel('interval', [[1000, '1 second'], [2000, '2 seconds'], [5000, '5 seconds']])}</div>
    <div class="set-row"><div>Temperature</div>${sel('tempUnit', [['C', 'Celsius'], ['F', 'Fahrenheit']])}</div>
    <div class="set-row"><div>${isMac() ? 'Menu bar' : 'Tray tooltip'} shows</div>${sel('menuBarStat', [['cpu', 'CPU'], ['mem', 'Memory'], ['temp', 'Temperature'], ['none', 'Just the icon']])}</div>
    <div class="set-row"><div>Keep running when the window closes<div class="s">Keeps time tracking and alerts going from the ${isMac() ? 'menu bar' : 'tray'}.</div></div>${sw('keepRunning')}</div>
    <div class="set-row"><div>Open at login<div class="s">Starts quietly in the ${isMac() ? 'menu bar' : 'tray'}.</div></div>${sw('openAtLogin')}</div>
    <div class="set-row"><div>Alert me when it runs hot or memory runs out</div>${sw('notifyHot')}</div>
    <div class="set-row"><div>Show serial numbers</div>${sw('showSerials')}</div>
    <div class="set-sec">Time &amp; Focus</div>
    <div class="set-row"><div>Track which app is in front<div class="s">Only the app and how long. Stays on this computer.</div></div>${sw('focusTracking')}</div>
    <div class="set-row"><div>Count me away after</div>${sel('idleMinutes', [[1, '1 minute'], [3, '3 minutes'], [5, '5 minutes'], [10, '10 minutes']])}</div>
    <div class="set-row"><div>A focus session is at least</div>${sel('focusSessionMinutes', [[15, '15 minutes'], [25, '25 minutes'], [45, '45 minutes'], [60, '1 hour']])}</div>
    <div class="set-row"><div>Delete time history<div class="s">Removes every day Vitals has recorded.</div></div><button class="btn sm danger" id="set-clear">Delete…</button></div>
    <div class="foot"><span class="muted small" style="margin-right:auto;align-self:center">Vitals ${esc(S.version)}</span><button class="btn primary" data-r="">Done</button></div>`);
  const box = $('#modal-in');
  $$('select[data-k]', box).forEach((x) => (x.onchange = async () => { const v = /^\d+$/.test(x.value) ? +x.value : x.value; S.settings = await call('settings:set', { [x.dataset.k]: v }); applyTheme(); }));
  $$('[data-sw]', box).forEach((b) => (b.onclick = async () => { const k = b.dataset.sw; S.settings = await call('settings:set', { [k]: !S.settings[k] }); b.classList.toggle('on', !!S.settings[k]); if (k === 'showSerials' && S.specs) renderSpecs(); if (k === 'focusTracking') { renderFocusSide(null); if (S.view === 'focus') loadFocus(); } }));
  $('#set-clear').onclick = async () => { if (await confirmBox('Delete time history?', 'Every recorded day is removed. This can’t be undone.', 'Delete', true)) { await call('focus:clear'); toast('Time history deleted'); S.focus = null; S.focusToday = null; } };
}

// ---------------------------------------------------------------- boot
(async () => {
  const b = await call('bootstrap');
  Object.assign(S, { settings: b.settings, platform: b.platform, version: b.version, cores: b.cores, hostname: b.hostname, paused: b.paused });
  S.history = b.history; S.last = b.last; if (b.procs) S.procs = b.procs;
  document.documentElement.dataset.platform = b.platform;
  $('#specs-label').textContent = 'This ' + computer(); $('#sp-title').textContent = 'This ' + computer();
  $$('.nav-btn[data-view="specs"]').forEach((x) => (x.title = 'This ' + computer()));
  applyTheme();
  document.body.classList.add('ready');
  go('overview');
  renderFocusSide(b.focusCurrent);
  call('focus:summary', 1).then((r) => { S.focusToday = r.days[0]; renderFocusSide(r.current); if (S.view === 'overview') renderOvFocus(); }).catch(() => {});
  call('specs').then((sp) => { S.specs = sp; }).catch(() => {});
  setTimeout(() => call('checkup', false).then((r) => { S.checkup = r; badgeCheckup(); }).catch(() => {}), 6000);
  V.on('visible', () => redrawAll());
})();
})();
