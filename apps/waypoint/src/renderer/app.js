// Waypoint window: shared state, navigation, saving, sheets, menus, toasts and small helpers used by every view.
'use strict';
const W = window.waypoint;
const call = W.call;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = { settings: {}, trips: [], trip: null, view: 'trips', day: null, sel: null, dataDir: '', home: '', beam: false, share: null, mode: 'day' };
const VIEWS = {};
const TRIP_VIEWS = [
  ['overview', 'Overview', 'home'], ['timeline', 'Timeline', 'timeline'], ['bookings', 'Bookings', 'ticket'], ['book', 'Book', 'search'],
  ['docs', 'Documents', 'passport'], ['budget', 'Budget', 'wallet'], ['research', 'Research', 'map'],
];
const COVERS = {
  sunset: ['#ffb340', '#ff6a4c', '#c43c7a'], ocean: ['#2fd3c0', '#3a8bff', '#3b3fb8'], forest: ['#a3e36a', '#2fb38a', '#1d5a63'],
  desert: ['#ffd27a', '#ff9a5c', '#c4573a'], dusk: ['#8f7bff', '#d06bff', '#ff7aa8'], alpine: ['#bfe8ff', '#6aa8ff', '#4a5bd0'],
  city: ['#ffc65c', '#ff6f91', '#5a4ff0'], island: ['#7af0d6', '#36c2ff', '#ff9a6b'],
};
const coverCss = (k) => { const c = COVERS[k] || COVERS.sunset; return `linear-gradient(135deg, ${c[0]}, ${c[1]} 55%, ${c[2]})`; };
const newId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

// ───────── words, dates, money
function dObj(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
function fmtDate(s, o = { weekday: 'short', month: 'short', day: 'numeric' }) { return s ? dObj(s).toLocaleDateString(undefined, o) : ''; }
function fmtRange(a, b) {
  if (!a) return 'No dates yet';
  if (!b || a === b) return fmtDate(a, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const A = dObj(a), B = dObj(b);
  if (A.getFullYear() === B.getFullYear()) {
    if (A.getMonth() === B.getMonth()) return `${A.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${B.getDate()}, ${B.getFullYear()}`;
    return `${A.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${B.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  return `${A.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} – ${B.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
function hour12() { const c = S.settings.clock; if (c === '12') return true; if (c === '24') return false; return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 !== false; }
function t12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (!hour12()) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const ap = h < 12 ? 'am' : 'pm', hh = h % 12 || 12;
  return m ? `${hh}:${String(m).padStart(2, '0')}${ap}` : `${hh}${ap}`;
}
const tmin = (m) => t12(TL.fromMin(m));
function durTxt(min) { min = Math.round(min); const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`; }
function money(v, cur, digits) {
  cur = cur || (S.trip && S.trip.currency) || S.settings.currency || 'USD';
  const abs = Math.abs(v);
  const whole = Number.isInteger(Math.round(v * 100) / 100) || abs >= 1000;
  const fd = digits ?? (whole ? 0 : 2);
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: fd, minimumFractionDigits: digits != null ? 0 : fd }).format(v); }
  catch { return `${Math.round(v * 100) / 100} ${cur}`; }
}
function human(n) {
  if (n == null || !Number.isFinite(n)) return '';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
}
const plural = (n, w, ws) => `${Number(n).toLocaleString()} ${n === 1 ? w : (ws || w + 's')}`;
function phaseText(t) {
  const p = TL.phase(t);
  if (p.kind === 'before') return p.days === 0 ? 'Today' : p.days === 1 ? 'Tomorrow' : `In ${p.days} days`;
  if (p.kind === 'during') return `Day ${p.day} of ${p.total}`;
  if (p.kind === 'after') return p.days < 30 ? 'Just got back' : 'Been there';
  return 'Dates not set';
}
function typeOf(k) { return TL.TYPES[k] || TL.TYPES.note; }
const flagOf = (c) => PLACES.flag(c);

// ───────── toasts
function toast(title, text = '', kind = 'ok', ms = 4200, actions) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<span class="t-ic">${kind === 'busy' ? '<span class="spin"></span>' : icon(kind === 'bad' ? 'alert' : kind === 'info' ? 'info' : 'check', 16)}</span><div class="grow"><div class="t-title">${esc(title)}</div>${text ? `<div class="t-text">${esc(text)}</div>` : ''}${actions ? `<div class="row" style="margin-top:7px;gap:6px">${actions.map((a, i) => `<button class="btn xs" data-a="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div>`;
  if (actions) el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { actions[+b.dataset.a].run(); el.remove(); });
  $('#toasts').appendChild(el);
  if (ms) setTimeout(() => { el.style.transition = 'opacity .2s'; el.style.opacity = 0; setTimeout(() => el.remove(), 220); }, ms);
  return el;
}
const fail = (e) => toast('That didn’t work', e.message || String(e), 'bad', 8000);

// ───────── navigation
function go(view, opts = {}) {
  if (view !== 'trips' && view !== 'settings' && !S.trip) view = 'trips';
  if (S.view === 'timeline' && view !== 'timeline' && VIEWS.timeline.leave) VIEWS.timeline.leave();
  S.view = view;
  if (opts.day) S.day = opts.day;
  render();
  $('#view').scrollTop = 0;
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
  side();
}
function refresh(views) { if (!views || views.includes(S.view)) render(); }

function side() {
  $('#tripCount').textContent = S.trips.length || '';
  $$('#navTop button').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
  const t = S.trip;
  $('#tripNav').innerHTML = t ? `
    <div class="side-trip"><div class="st-cover" style="background:${coverCss(t.cover)}"><span>${esc(flagOf(t.country))}</span></div>
      <div class="grow" style="min-width:0"><b class="ellip" title="${esc(t.name)}">${esc(t.name)}</b><span class="ellip">${esc(phaseText(t))} · ${esc(fmtRange(t.start, t.end))}</span></div></div>
    <nav id="nav">${TRIP_VIEWS.map(([k, l, ic]) => `<button data-view="${k}" class="${S.view === k ? 'on' : ''}"><span class="nav-ic" data-icon="${ic}"></span>${l}<span class="nav-count">${navCount(k)}</span></button>`).join('')}</nav>` : '';
  $$('#nav button').forEach(b => b.onclick = () => go(b.dataset.view));
  $('#sideFoot').innerHTML = `<div class="off-card"><span class="tile sm a-lime" data-icon="wifiOff" data-size="14"></span><div class="grow" style="min-width:0"><b>Works offline</b><span class="ellip">Everything is saved on this computer</span></div></div>
    <div class="side-actions"><button class="btn sm ghost grow" id="sfFolder" title="${esc(S.dataDir)}"><span data-icon="folder" data-size="15"></span>Trips folder</button><button class="icon-btn sm ${S.view === 'settings' ? 'on' : ''}" id="sfSet" title="Settings"><span data-icon="gear" data-size="16"></span></button></div>`;
  $('#sfFolder').onclick = () => call('openDataDir').catch(fail);
  $('#sfSet').onclick = () => go('settings');
  hydrateIcons($('#side'));
}
function navCount(k) {
  const t = S.trip; if (!t) return '';
  if (k === 'timeline') return t.items.length || '';
  if (k === 'bookings') return t.bookings.length || '';
  if (k === 'docs') return t.docs.length || '';
  if (k === 'research') return t.research.places.length || '';
  return '';
}

// ───────── trips: open, save
async function openTrip(id, view = 'overview') {
  try {
    S.trip = await call('trip', id);
    S.sel = null;
    const days = TL.dayList(S.trip.start, S.trip.end);
    const ph = TL.phase(S.trip);
    S.day = ph.kind === 'during' ? ph.today : days[0] || null;
    setSettings({ lastTrip: id }, true);
    go(view);
  } catch (e) { fail(e); S.trip = null; go('trips'); }
}
let saveTimer = null, saving = null;
function persist(now) {
  if (!S.trip) return;
  S.trip.updated = Date.now();
  clearTimeout(saveTimer);
  const t = S.trip;
  const run = () => { saving = call('save', t).then((saved) => { if (S.trip && S.trip.id === saved.id) S.trip.docs = saved.docs; updateSummary(saved); }).catch(fail); return saving; };
  if (now) return run();
  saveTimer = setTimeout(run, 280);
}
async function flush() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await persist(true); } else if (saving) await saving; }
function updateSummary(t) {
  const i = S.trips.findIndex(x => x.id === t.id);
  const sum = { id: t.id, name: t.name, destination: t.destination, country: t.country, start: t.start, end: t.end, cover: t.cover, tz: t.tz,
    counts: { items: t.items.length, bookings: t.bookings.length, docs: t.docs.length, places: t.research.places.length }, travelers: t.travelers, updated: t.updated, folder: i >= 0 ? S.trips[i].folder : '' };
  if (i >= 0) S.trips[i] = sum; else S.trips.push(sum);
}
async function reloadTrips() { S.trips = await call('trips'); }
async function setSettings(patch, quiet) {
  try { S.settings = await call('set', patch); if (!quiet) render(); } catch (e) { fail(e); }
}

// ───────── sheets (dialogs)
function openSheet(html, { onClose, width, cls = '' } = {}) {
  closeSheet();
  const host = $('#sheetHost');
  host.innerHTML = `<div class="scrim"><div class="sheet ${cls}"${width ? ` style="width:min(${width}px,calc(100vw - 48px))"` : ''}>${html}</div></div>`;
  const scrim = host.firstChild;
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim && !scrim.firstChild.classList.contains('sticky')) closeSheet(); });
  S.sheetClose = onClose;
  hydrateIcons(host);
  const first = host.querySelector('[autofocus],input:not([type=hidden]):not([type=checkbox]):not([type=date]):not([type=time]),textarea'); if (first) setTimeout(() => first.focus(), 30);
  return scrim.firstChild;
}
function closeSheet() { const h = $('#sheetHost'); if (h.firstChild) { h.innerHTML = ''; if (S.sheetClose) { const f = S.sheetClose; S.sheetClose = null; f(); } } }
function confirmBox({ title, text, ok = 'OK', danger = false }) {
  return new Promise((res) => {
    const el = openSheet(`<div class="sheet-head"><h3>${esc(title)}</h3></div><div class="sheet-body"><div class="muted">${esc(text)}</div></div>
      <div class="sheet-foot"><span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" data-ok>${esc(ok)}</button></div>`, { onClose: () => res(false), width: 440 });
    el.querySelector('[data-x]').onclick = () => closeSheet();
    el.querySelector('[data-ok]').onclick = () => { S.sheetClose = null; closeSheet(); res(true); };
  });
}
// read every [name] field in a sheet into an object (checkboxes → booleans, numbers → numbers)
function formVals(el) {
  const o = {};
  el.querySelectorAll('[name]').forEach((f) => {
    if (f.type === 'checkbox') o[f.name] = f.checked;
    else if (f.type === 'number') o[f.name] = f.value === '' ? '' : Number(f.value);
    else if (f.type === 'radio') { if (f.checked) o[f.name] = f.value; }
    else o[f.name] = f.value.trim();
  });
  return o;
}

// ───────── menus
function menu(anchor, items, { head } = {}) {
  closeMenu();
  const host = $('#popHost');
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  host.innerHTML = `<div class="pop-catch"></div><div class="menu">${head || ''}${items.filter(Boolean).map((it, i) => it === '-' ? '<hr>' : it.section ? `<div class="menu-label">${esc(it.label)}</div>` : `<button data-i="${i}" class="${it.danger ? 'danger' : ''} ${it.on ? 'on' : ''}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon, 16) : ''}<span class="grow ellip">${esc(it.label)}</span>${it.hint ? `<span class="muted tiny">${esc(it.hint)}</span>` : ''}${it.on ? icon('check', 14) : ''}</button>`).join('')}</div>`;
  const list = items.filter(Boolean);
  const m = host.querySelector('.menu');
  const w = m.offsetWidth, h = m.offsetHeight;
  let x = r.left, y = r.bottom + 6;
  if (x + w > innerWidth - 10) x = Math.max(10, r.right - w);
  if (y + h > innerHeight - 10) y = Math.max(10, r.top - h - 6);
  m.style.left = x + 'px'; m.style.top = y + 'px';
  host.querySelector('.pop-catch').onmousedown = closeMenu;
  m.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => { closeMenu(); list[+b.dataset.i].run(); });
  hydrateIcons(m);
}
function closeMenu() { $('#popHost').innerHTML = ''; }
addEventListener('keydown', (e) => { if (e.key === 'Escape') { if ($('#popHost').firstChild) closeMenu(); else if (!$('.sheet.sticky')) closeSheet(); } });

// ───────── small bits of UI
function tile(tint, ic, size = 'md', isz = 17) { return `<span class="tile ${size} ${tint}" data-icon="${ic}" data-size="${isz}"></span>`; }
function copyBtn(text, label) { return `<button class="ref-chip" data-copy="${esc(text)}" title="Copy">${esc(label || text)}<span data-icon="copy" data-size="12"></span></button>`; }
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-copy]');
  if (c) { e.stopPropagation(); call('copy', c.dataset.copy).then(() => { c.classList.add('copied'); setTimeout(() => c.classList.remove('copied'), 1200); }); }
  const u = e.target.closest('[data-url]');
  if (u) { e.preventDefault(); call('openUrl', u.dataset.url); }
}, true);
function empty(ic, title, text, btn) {
  return `<div class="empty">${tile('a-sunset', ic, 'xl', 26)}<b>${esc(title)}</b><span>${esc(text)}</span>${btn || ''}</div>`;
}
function mapsUrl(q) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q); }
// time zones for pickers
let TZS = null;
function timeZones() { if (!TZS) { try { TZS = Intl.supportedValuesOf('timeZone'); } catch { TZS = ['UTC']; } } return TZS; }
function tzLabel(tz) { if (!tz) return ''; const off = TL.tzOffsetHours(tz); const city = tz.split('/').pop().replace(/_/g, ' '); return off === 0 ? `${city} · same time as here` : `${city} · ${Math.abs(off)} h ${off > 0 ? 'ahead' : 'behind'}`; }
