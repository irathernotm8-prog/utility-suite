// Cadence window: shared state, navigation, sheets, menus, toasts and small helpers used by every view.
'use strict';
const C = window.cadence;
const call = C.call;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');
const tildify = (p) => (S.info && p && String(p).startsWith(S.info.home) ? '~' + String(p).slice(S.info.home.length) : p);

const S = { info: null, cat: null, flows: [], paused: false, runs: [], view: 'flows', flowId: null, runId: null, settings: {}, bridge: {}, ai: null, profiles: [], secrets: [], live: {} };
const VIEWS = {};

// ───────── time words
const DAY = 864e5;
function fmtDur(ms) { const s = Math.max(0, Math.round(ms / 1000)); if (s < 60) return s + 's'; const m = Math.floor(s / 60); if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`; return `${Math.floor(m / 60)}h ${m % 60}m`; }
function ago(t) { if (!t) return ''; const s = (Date.now() - t) / 1000; if (s < 45) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; if (s < 6 * 86400) return new Date(t).toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + clock(t); return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function clock(t) { return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
function whenAt(t) {
  if (!t) return '';
  const d = new Date(t), now = new Date();
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY);
  if (days === 0) return `Today ${clock(t)}`;
  if (days === 1) return `Tomorrow ${clock(t)}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString(undefined, { weekday: 'long' })} ${clock(t)}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${clock(t)}`;
}
function until(t) { const m = Math.round((t - Date.now()) / 6e4); if (m < 1) return 'any moment'; if (m < 60) return `in ${m} min`; const h = Math.round(m / 60); if (h < 36) return `in ${h} hour${h === 1 ? '' : 's'}`; const d = Math.round(h / 24); return `in ${d} days`; }

// ───────── toasts
function toast(title, text = '', kind = 'ok', ms = 4200) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<span class="t-ic">${kind === 'busy' ? '<span class="spin"></span>' : icon(kind === 'bad' ? 'alert' : kind === 'info' ? 'info' : 'check', 16)}</span><div class="grow"><div class="t-title">${esc(title)}</div>${text ? `<div class="t-text">${esc(text)}</div>` : ''}</div>`;
  $('#toasts').appendChild(el);
  if (ms) setTimeout(() => { el.style.transition = 'opacity .2s'; el.style.opacity = 0; setTimeout(() => el.remove(), 220); }, ms);
  return el;
}
const fail = (e) => toast('That didn’t work', e.message || String(e), 'bad', 8000);

// ───────── navigation
function go(view, arg) {
  if (S.view === 'editor' && view !== 'editor' && window.Editor) Editor.leave();
  S.view = view;
  if (view === 'editor') { S.flowId = arg; if (window.Editor) { Editor._prev = Editor._for; Editor._for = null; } }
  if (view === 'run') S.runId = arg;
  const navOf = { editor: 'flows', run: 'runs' };
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === (navOf[view] || view)));
  render();
}
function render() {
  const v = VIEWS[S.view]; if (!v) return;
  const view = $('#view');
  view.className = v.flush ? 'flush' : '';
  $('#headLeft').innerHTML = v.head ? v.head() : `<h1>${esc(v.title)}</h1>`;
  $('#headRight').innerHTML = v.actions ? v.actions() : '';
  v.render(view);
  if (v.after) v.after();
  hydrateIcons(document);
}
function refresh(views) { if (!views || views.includes(S.view)) render(); }

// ───────── sheets (dialogs)
function openSheet(html, { onClose, width } = {}) {
  closeSheet();
  const host = $('#sheetHost');
  host.innerHTML = `<div class="scrim"><div class="sheet"${width ? ` style="width:min(${width}px,calc(100vw - 48px))"` : ''}>${html}</div></div>`;
  const scrim = host.firstChild;
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) closeSheet(); });
  S.sheetClose = onClose;
  hydrateIcons(host);
  const first = host.querySelector('input:not([type=hidden]),textarea'); if (first) setTimeout(() => first.focus(), 30);
  return scrim.firstChild;
}
function closeSheet() { const h = $('#sheetHost'); if (h.firstChild) { h.innerHTML = ''; if (S.sheetClose) { const f = S.sheetClose; S.sheetClose = null; f(); } } }
function confirmBox({ title, text, ok = 'OK', danger = false }) {
  return new Promise((res) => {
    const el = openSheet(`<div class="sheet-head"><h3>${esc(title)}</h3></div><div class="sheet-body"><p class="muted" style="margin:0">${esc(text)}</p></div><div class="sheet-foot"><span class="grow"></span><button class="btn" data-a="no">Cancel</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" data-a="yes">${esc(ok)}</button></div>`, { width: 460, onClose: () => res(false) });
    el.querySelector('[data-a=yes]').onclick = () => { S.sheetClose = null; closeSheet(); res(true); };
    el.querySelector('[data-a=no]').onclick = () => closeSheet();
  });
}
function promptBox({ title, text = '', label, value = '', placeholder = '', ok = 'Save', fields }) {
  return new Promise((res) => {
    const fs = fields || [{ key: 'v', label, value, placeholder }];
    const el = openSheet(`<div class="sheet-head"><h3>${esc(title)}</h3></div><div class="sheet-body">${text ? `<p class="muted" style="margin:0">${esc(text)}</p>` : ''}${fs.map((f) => `<div class="field"><label>${esc(f.label || '')}</label><input class="input" data-k="${f.key}" type="${f.type || 'text'}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" spellcheck="false"></div>`).join('')}</div><div class="sheet-foot"><span class="grow"></span><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="yes">${esc(ok)}</button></div>`, { width: 500, onClose: () => res(null) });
    const done = () => { const o = {}; $$('[data-k]', el).forEach((i) => { o[i.dataset.k] = i.value; }); S.sheetClose = null; closeSheet(); res(fields ? o : o.v); };
    el.querySelector('[data-a=yes]').onclick = done;
    el.querySelector('[data-a=no]').onclick = () => closeSheet();
    $$('input', el).forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); }));
  });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if ($('#popHost').firstChild) closePop(); else if ($('#sheetHost').firstChild) closeSheet(); } });

// ───────── menus and popovers
function closePop() { $('#popHost').innerHTML = ''; }
function popAt(anchor, html, { width, align = 'left' } = {}) {
  closePop();
  const host = $('#popHost');
  host.innerHTML = `<div class="pop-catch"></div><div class="menu"${width ? ` style="width:${width}px"` : ''}>${html}</div>`;
  const m = host.lastChild; const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let x = align === 'right' ? r.right - mw : r.left; let y = r.bottom + 6;
  if (y + mh > innerHeight - 10) y = Math.max(10, r.top - mh - 6);
  x = Math.max(10, Math.min(x, innerWidth - mw - 10));
  m.style.left = x + 'px'; m.style.top = y + 'px';
  host.firstChild.onmousedown = closePop;
  hydrateIcons(host);
  return m;
}
function menu(anchor, items, opts) {
  const m = popAt(anchor, items.map((it, i) => it === '-' ? '<hr>' : it.label && it.header ? `<div class="menu-label">${esc(it.label)}</div>` : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon, 16) : ''}<span class="grow">${esc(it.label)}</span>${it.hint ? `<span class="muted tiny">${esc(it.hint)}</span>` : ''}</button>`).join(''), opts);
  $$('button[data-i]', m).forEach((b) => b.onclick = () => { closePop(); const it = items[+b.dataset.i]; if (it.run) it.run(); });
  return m;
}

// ───────── step looks
const COLORS = { web: 'sky', apps: 'lime', files: 'amber', data: 'teal', docs: 'rose', ai: 'violet', logic: 'slate' };
function stepMeta(type) {
  const s = S.cat.steps[type];
  if (!s) return { label: type, icon: 'alert', color: 'red', group: '' };
  return { label: s.label, icon: s.icon, color: COLORS[s.group] || 'slate', group: s.group, summary: s.summary };
}
function tile(iconName, color, size = 'md') { const px = size === 'lg' ? 22 : size === 'sm' ? 14 : 17; return `<span class="tile ${size} a-${color}">${icon(iconName, px)}</span>`; }
const FLOW_COLORS = ['violet', 'sky', 'teal', 'amber', 'rose', 'lime', 'slate'];
function flowTile(f, size = 'md') { const first = (f.stepTypes || (f.steps || []).map((s) => s.type) || [])[0]; return tile(f.icon || (first ? stepMeta(first).icon : 'flows'), f.color || (first ? stepMeta(first).color : 'violet'), size); }

// The week strip: which days this automation fires on, with today and the next run marked.
function weekStrip(trigger, nextAt) {
  const ws = Number(S.settings.weekStart ?? 1);
  const order = [0, 1, 2, 3, 4, 5, 6].map((i) => (i + ws) % 7);
  let on = [];
  const t = trigger || {};
  if (t.type === 'schedule') {
    if (['minutes', 'hours', 'day'].includes(t.every)) on = Array.isArray(t.days) && t.days.length ? t.days : [0, 1, 2, 3, 4, 5, 6];
    else if (t.every === 'week') on = Array.isArray(t.days) && t.days.length ? t.days : [1];
    else if (t.every === 'month' && nextAt && nextAt - Date.now() < 7 * DAY) on = [new Date(nextAt).getDay()];
  }
  const today = new Date().getDay();
  const nextDay = nextAt && nextAt - Date.now() < 7 * DAY ? new Date(nextAt).getDay() : null;
  const L = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const dense = t.type === 'schedule' && ['minutes', 'hours'].includes(t.every);
  return `<div class="beats${dense ? ' dense' : ''}${t.type !== 'schedule' ? ' idle' : ''}">${order.map((d) => `<span class="beat${on.includes(d) ? ' on' : ''}${d === today ? ' today' : ''}${d === nextDay ? ' next' : ''}"><i></i><em>${L[d]}</em></span>`).join('')}</div>`;
}
function triggerWords(f) {
  const t = f.trigger || {};
  if (t.type === 'watch') return { icon: 'folderIn', text: f.when };
  if (t.type === 'schedule') return { icon: 'clock', text: f.when };
  return { icon: 'play', text: 'Runs when you start it' };
}
const STATUS = { done: ['ok', 'Done'], failed: ['bad', 'Failed'], running: ['acc', 'Running'], queued: ['info', 'Waiting'], cancelled: ['', 'Stopped'], skipped: ['', 'Skipped'], pending: ['', 'Waiting'], off: ['', 'Off'] };
function statusPill(st) { const [k, l] = STATUS[st] || ['', st]; return `<span class="pill ${k}">${st === 'running' ? '<span class="spin" style="width:10px;height:10px;border-width:1.5px"></span>' : ''}${l}</span>`; }
const TRIG_WORDS = { schedule: 'On schedule', manual: 'You', watch: 'New file', ai: 'Claude / Codex', test: 'Test', automation: 'Another automation' };
function trigWord(t) { if (!t) return ''; if (t.kind === 'ai') return t.client && /codex/i.test(t.client) ? 'Codex' : t.client || 'Claude'; return (TRIG_WORDS[t.kind] || t.kind) + (t.kind === 'schedule' && t.late ? ' (caught up)' : ''); }

// ───────── state loading
async function loadFlows() { const r = await call('flows:list'); S.flows = r.flows; S.paused = r.paused; $('#flowCount').textContent = S.flows.length || ''; renderNext(); }
async function loadRuns() { S.runs = await call('runs:list', { limit: 200 }); updateRunCount(); }
function updateRunCount() { const live = S.runs.filter((r) => r.status === 'running').length; const el = $('#runCount'); el.textContent = live ? live : ''; el.classList.toggle('live', !!live); }
function upsertRun(snap) {
  const i = S.runs.findIndex((r) => r.id === snap.id);
  if (i >= 0) S.runs[i] = snap; else S.runs.unshift(snap);
  S.live[snap.id] = snap;
  updateRunCount();
}

// Sidebar card: what runs next, and that Cadence is minding the schedule.
function renderNext() {
  const el = $('#nextCard'); if (!el) return;
  const running = S.runs.filter((r) => r.status === 'running');
  const next = S.flows.filter((f) => f.nextAt).sort((a, b) => a.nextAt - b.nextAt)[0];
  let body;
  if (running.length) { const r = running[0]; const done = r.steps.filter((s) => ['done', 'skipped', 'failed'].includes(s.status)).length; body = `<div class="nc-label"><span class="dot busy"></span>Running now</div><button class="nc-name link-plain" data-run="${r.id}">${esc(r.flowName)}</button><div class="bar"><i style="width:${Math.round((done / Math.max(1, r.steps.length)) * 100)}%"></i></div><div class="nc-sub">Step ${Math.min(done + 1, r.steps.length)} of ${r.steps.length}</div>`; }
  else if (next) body = `<div class="nc-label">Up next</div><button class="nc-name link-plain" data-flow="${next.id}">${esc(next.name)}</button><div class="nc-when tnum">${esc(whenAt(next.nextAt))}</div><div class="nc-sub">${esc(until(next.nextAt))}</div>`;
  else body = `<div class="nc-label">Up next</div><div class="nc-sub" style="margin-top:4px">Nothing scheduled yet. Give an automation a schedule and switch it on.</div>`;
  el.innerHTML = `${body}<div class="nc-foot"><span class="dot ${S.paused ? '' : 'on'}"></span><span class="grow">${S.paused ? 'Paused' : S.settings.background ? 'Keeps running when closed' : 'Runs while open'}</span><button class="icon-btn xs" id="ncPause" title="${S.paused ? 'Resume all automations' : 'Pause all automations'}">${icon(S.paused ? 'play' : 'pause', 13)}</button></div>`;
  el.classList.toggle('paused', S.paused);
  const nb = el.querySelector('[data-flow]'); if (nb) nb.onclick = () => go('editor', nb.dataset.flow);
  const rb = el.querySelector('[data-run]'); if (rb) rb.onclick = () => go('run', rb.dataset.run);
  $('#ncPause').onclick = async () => { S.paused = await call('flows:pause', !S.paused); renderNext(); toast(S.paused ? 'All automations paused' : 'Automations resumed', S.paused ? 'Schedules and folder watches won’t start runs until you resume.' : ''); };
}

// Run an automation and follow it.
async function runFlow(id, opts = {}) {
  try {
    const snap = await call('run:start', id, opts);
    upsertRun(snap);
    if (opts.follow !== false) go('run', snap.id); else toast('Started', S.flows.find((f) => f.id === id)?.name || '', 'busy', 2200);
    return snap;
  } catch (e) { fail(e); }
}
async function openPath(p) { try { await call('shell:open', p); } catch (e) { fail(e); } }
function reveal(p) { call('shell:reveal', p).catch(fail); }
