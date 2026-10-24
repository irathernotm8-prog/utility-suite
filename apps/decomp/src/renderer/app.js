// Decomp window: shared state, navigation, the live power card, drag-and-drop and small UI helpers.
'use strict';
const D = window.decomp;
const call = D.call;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtSize = (n) => { if (n == null || isNaN(n)) return '—'; if (n >= 1e12) return (n / 1e12).toFixed(2) + ' TB'; if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB'; if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + ' MB'; if (n >= 1e3) return Math.round(n / 1e3) + ' KB'; return n + ' B'; };
const fmtDur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); if (s < 60) return s + 's'; const m = Math.floor(s / 60); if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`; return `${Math.floor(m / 60)}h ${m % 60}m`; };
const ago = (t) => { if (!t) return ''; const s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
const baseName = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || p;

const S = { info: null, view: 'home', jobs: [], engines: { engines: [], tools: [] }, busy: {}, sample: null, jobId: null };
const VIEWS = {};

// ───────── toasts
function toast(title, text = '', kind = 'ok', ms = 4200) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<span class="t-ic">${kind === 'busy' ? '<span class="spin"></span>' : icon(kind === 'bad' ? 'alert' : kind === 'info' ? 'info' : 'check', 16)}</span><div class="grow"><div class="t-title">${esc(title)}</div>${text ? `<div class="t-text">${esc(text)}</div>` : ''}</div>`;
  $('#toasts').appendChild(el);
  if (ms) setTimeout(() => { el.style.transition = 'opacity .2s'; el.style.opacity = 0; setTimeout(() => el.remove(), 220); }, ms);
  return el;
}
const fail = (e) => toast('Something went wrong', e.message || String(e), 'bad', 7000);

// ───────── navigation
function go(view, arg) {
  S.view = view;
  if (view === 'job') S.jobId = arg;
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view || (view === 'job' && b.dataset.view === 'jobs')));
  render();
}
function render() {
  const v = VIEWS[S.view]; if (!v) return;
  const view = $('#view');
  view.className = v.flush ? 'flush' : '';
  $('#headLeft').innerHTML = v.head ? v.head() : `<h1>${esc(v.title)}</h1>`;
  $('#headRight').innerHTML = v.actions ? v.actions() : '';
  v.render(view);
  hydrateIcons(document);
}
// re-render only if the visible view is affected
function refresh(views) { if (!views || views.includes(S.view)) render(); }

// ───────── sheets
function openSheet(html, { onClose, wide } = {}) {
  closeSheet();
  const host = $('#sheetHost');
  host.innerHTML = `<div class="scrim"><div class="sheet"${wide ? ' style="width:min(900px,calc(100vw - 48px))"' : ''}>${html}</div></div>`;
  const scrim = host.firstChild;
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) closeSheet(); });
  S.sheetClose = onClose;
  hydrateIcons(host);
  return scrim.firstChild;
}
function closeSheet() { const h = $('#sheetHost'); if (h.firstChild) { h.innerHTML = ''; if (S.sheetClose) { const f = S.sheetClose; S.sheetClose = null; f(); } } }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#sheetHost').firstChild) closeSheet(); });

// ───────── kind badges
function famOf(family) { return (S.info.families.find((f) => f.id === family) || { color: 'a-slate' }); }
function kindIcon(family, size = 'md') { const f = famOf(family); return `<span class="kicon ${size === 'lg' ? 'lg' : ''} ${f.color}">${icon(FAMILY_ICON[family] || 'file', size === 'lg' ? 26 : size === 'sm' ? 15 : 19)}</span>`; }

// ───────── power card (live)
function renderPower() {
  const el = $('#powerCard'); if (!el || !S.info) return;
  const b = (S.sample && S.sample.budget) || S.info.budget; const mode = S.info.settings.mode;
  const cores = S.sample ? S.sample.cores : new Array(S.info.cores).fill(0);
  const cols = Math.min(cores.length, 16), rows = Math.ceil(cores.length / cols);
  const avg = S.sample ? Math.round(S.sample.avg * 100) : 0;
  const mem = S.sample ? S.sample.memUsed / S.sample.memTotal : 0;
  const using = S.sample ? S.sample.threadsInUse : 0;
  if (!el.dataset.built || +el.dataset.n !== cores.length) {
    el.innerHTML = `<div class="pc-top"><span class="row" style="gap:6px">${icon('bolt', 14)} Power</span><span class="pc-pct" id="pcPct"></span></div>
      <div class="cores" id="pcCores" style="grid-template-columns:repeat(${cols},1fr);height:${rows > 1 ? 30 * rows : 46}px">${cores.map(() => '<div class="core"><i style="height:0"></i></div>').join('')}</div>
      <div class="seg full" id="pcMode">${Object.entries(S.info.modes).map(([k, m]) => `<button data-mode="${k}" title="${esc(m.note)}">${k === 'max' ? 'Full' : k === 'balanced' ? 'Balanced' : 'Quiet'}</button>`).join('')}</div>
      <div class="pc-line"><span id="pcUse"></span><span id="pcHeap"></span></div>
      <div class="pc-mem"><i id="pcMem"></i></div>
      <div class="pc-line"><span class="ellip" id="pcCpu" style="max-width:150px"></span><span id="pcMemTxt"></span></div>`;
    el.dataset.built = 1; el.dataset.n = cores.length;
    $$('#pcMode button', el).forEach((btn) => btn.onclick = async () => { try { const bud = await call('power:set', btn.dataset.mode); S.info.settings.mode = btn.dataset.mode; S.info.budget = bud; renderPower(); refresh(['settings']); } catch (e) { fail(e); } });
  }
  $$('#pcCores .core', el).forEach((c, i) => { const v = cores[i] || 0; c.firstChild.style.height = Math.max(3, v * 100) + '%'; c.classList.toggle('hot', v > 0.85); });
  $$('#pcMode button', el).forEach((btn) => btn.classList.toggle('on', btn.dataset.mode === mode));
  $('#pcPct', el).textContent = avg + '%';
  $('#pcUse', el).innerHTML = using ? `<b>${using}</b> of ${b.threads} threads busy` : `<b>${b.threads}</b> threads ready`;
  $('#pcHeap', el).textContent = `${Math.round(b.heapMB / 1024)} GB heap`;
  $('#pcMem', el).style.width = (mem * 100).toFixed(1) + '%';
  $('#pcCpu', el).textContent = (S.info.cpu || '').replace(/\(R\)|\(TM\)|CPU|@.*$/g, '').replace(/\s+/g, ' ').trim();
  $('#pcMemTxt', el).textContent = S.sample ? `${(S.sample.memUsed / 1e9).toFixed(1)} / ${Math.round(S.sample.memTotal / 1e9)} GB` : fmtSize(S.info.memory);
}

// ───────── jobs and engines state
async function loadJobs() { S.jobs = await call('job:list'); updateCounts(); }
async function loadEngines() { S.engines = await call('engines:list'); updateCounts(); }
function updateCounts() {
  const running = S.jobs.filter((j) => j.status === 'running').length;
  const jc = $('#jobCount'); jc.textContent = running ? running : S.jobs.length || ''; jc.classList.toggle('live', !!running);
  const ready = S.engines.engines.filter((e) => e.ready).length; $('#engCount').textContent = S.engines.engines.length ? `${ready}/${S.engines.engines.filter((e) => e.available).length}` : '';
}
function upsertJob(snap) { const i = S.jobs.findIndex((j) => j.id === snap.id); if (i >= 0) S.jobs[i] = snap; else S.jobs.unshift(snap); updateCounts(); }
D.on('job:update', (snap) => {
  upsertJob(snap);
  updateCounts();
  if (S.view === 'job' && S.jobId === snap.id && window.updateJobView) window.updateJobView(snap);
  else if (S.view === 'jobs' || S.view === 'home') throttleRender();
  if (snap.status === 'done' && !S.notified?.[snap.id] && (S.view !== 'job' || S.jobId !== snap.id)) { (S.notified = S.notified || {})[snap.id] = 1; toast(`${snap.name} is taken apart`, `${snap.stats.sources.toLocaleString()} source files in ${snap.stats.seconds}s`); }
});
let rt = null; function throttleRender() { if (rt) return; rt = setTimeout(() => { rt = null; render(); }, 400); }
D.on('engines:progress', (p) => {
  if (p.done) { delete S.busy[p.id]; loadEngines().then(() => { refresh(['engines']); if (window.onEnginesChanged) window.onEnginesChanged(); }); return; }
  S.busy[p.id] = p;
  if (window.updateEngineProgress) window.updateEngineProgress(p);
});
D.on('power:sample', (s) => { S.sample = s; renderPower(); if (window.onSample) window.onSample(s); });
D.on('app:open', (p) => openPath(p));
D.on('menu', (m) => { if (m === 'open') pickAndOpen(false); if (m === 'open-folder') pickAndOpen(true); });

// ───────── opening things
async function pickAndOpen(folder) { try { const p = await call('dialog:open', { folder }); if (p) openPath(p); } catch (e) { fail(e); } }
async function openPath(p) {
  const t = toast('Looking at ' + baseName(p), '', 'busy', 0);
  try { const id = await call('identify', p); t.remove(); window.showIdentify(id); } catch (e) { t.remove(); fail(e); }
}

// drag and drop anywhere
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; $('#dropVeil').classList.add('on'); } e.preventDefault(); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropVeil').classList.remove('on'); });
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; $('#dropVeil').classList.remove('on');
  const f = e.dataTransfer?.files?.[0]; if (!f) return;
  const p = D.pathFor(f); if (p) openPath(p);
});

$$('#nav button').forEach((b) => b.onclick = () => go(b.dataset.view));

// ───────── boot
(async () => {
  try {
    S.info = await call('app:info');
    document.documentElement.classList.toggle('win', D.platform === 'win32');
    const applyTheme = () => { const t = S.info.settings.theme; const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; };
    window.applyTheme = applyTheme; applyTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    await Promise.all([loadJobs(), loadEngines()]);
    renderPower(); hydrateIcons();
    go('home');
    document.body.classList.add('ready');
  } catch (e) { document.body.classList.add('ready'); document.body.innerHTML = `<pre style="padding:30px">${esc(e.stack || e)}</pre>`; }
})();
