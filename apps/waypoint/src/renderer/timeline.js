// The interactive day timeline: a day strip, an hour grid with plans you drag to move and stretch to
// resize (snapping to 15 minutes), drag onto another day to move it there, double-click to add, free
// time and clashes shown on the grid, a red "now" line during the trip, and an inspector to edit.
'use strict';

const TLV = { drag: null, scroll: {} };

VIEWS.timeline = {
  flush: true,
  head() {
    const t = S.trip;
    const days = TL.dayList(t.start, t.end);
    const i = days.indexOf(S.day);
    return `<h1>Timeline <small>${S.mode === 'list' ? plural(t.items.length, 'plan') + ' across ' + plural(days.length, 'day') : i >= 0 ? `Day ${i + 1} · ${esc(fmtDate(S.day, { weekday: 'long', month: 'long', day: 'numeric' }))}` : ''}</small></h1>`;
  },
  actions() {
    return `<div class="seg" id="tlMode"><button data-m="day" class="${S.mode !== 'list' ? 'on' : ''}">${icon('timeline', 14)}Day</button><button data-m="list" class="${S.mode === 'list' ? 'on' : ''}">${icon('list', 14)}All days</button></div>
      ${S.mode !== 'list' ? `<div class="seg"><button id="zOut" title="Zoom out">${icon('zoomOut', 14)}</button><button id="zIn" title="Zoom in">${icon('zoomIn', 14)}</button></div>` : ''}
      <button class="btn primary" id="tlAdd"><span data-icon="plus" data-size="15"></span>Add plan</button>`;
  },
  render(v) {
    const t = S.trip;
    const days = TL.dayList(t.start, t.end);
    if (!days.length) { v.innerHTML = `<div style="padding:28px">${empty('calendar', 'Set the trip dates first', 'Timelines are laid out day by day. Add the dates in Details and each day gets its own.', '<button class="btn primary" id="setDates">Add dates</button>')}</div>`; $('#setDates').onclick = () => tripSheet(S.trip); return; }
    if (!days.includes(S.day)) S.day = TL.phase(t).kind === 'during' ? TL.phase(t).today : days[0];
    if (S.sel && !t.items.some(i => i.id === S.sel)) S.sel = null;
    v.innerHTML = `<div class="tl-wrap"><div class="tl-main">${dayStrip(days)}<div id="tlBody" class="tl-body"></div></div><aside class="tl-insp" id="tlInsp"></aside></div>`;
    if (S.mode === 'list') listMode(); else dayMode();
    inspector();
    $$('.tl-day', v).forEach(b => b.onclick = () => { if (TLV.dragged) return; S.day = b.dataset.day; S.sel = null; if (S.mode === 'list') S.mode = 'day'; render(); });
    const on = $('.tl-day.on', v); if (on) on.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  },
  after() {
    $$('#tlMode button').forEach(b => b.onclick = () => { S.mode = b.dataset.m; render(); });
    $('#tlAdd').onclick = () => addPlan();
    if ($('#zIn')) { $('#zIn').onclick = () => zoom(1); $('#zOut').onclick = () => zoom(-1); }
  },
  leave() { const sc = $('#tlScroll'); if (sc) TLV.scroll[S.day] = sc.scrollTop; },
};

const ZOOMS = [40, 52, 64, 80, 100, 128];
function zoomPx() { const z = Number(S.settings.timelineZoom) || 64; return ZOOMS.reduce((a, b) => Math.abs(b - z) < Math.abs(a - z) ? b : a); }
function zoom(d) {
  const sc = $('#tlScroll'); const z0 = zoomPx(); const i = Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z0) + d));
  if (ZOOMS[i] === z0) return;
  const mid = sc ? (sc.scrollTop + sc.clientHeight / 2) / z0 : 0;
  S.settings.timelineZoom = ZOOMS[i]; setSettings({ timelineZoom: ZOOMS[i] }, true);
  dayMode();
  const sc2 = $('#tlScroll'); if (sc2) sc2.scrollTop = mid * ZOOMS[i] - sc2.clientHeight / 2;
}

function dayStrip(days) {
  const t = S.trip, today = TL.localNow(t.tz).date;
  return `<div class="tl-days" id="tlDays">${days.map((d, i) => {
    const items = TL.itemsOn(t, d);
    const clash = TL.clashes(items).length;
    const kinds = items.filter(x => x.type !== 'note').slice(0, 6);
    return `<button class="tl-day ${d === S.day && S.mode !== 'list' ? 'on' : ''} ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}" data-day="${d}">
      <span class="td-wk">${esc(fmtDate(d, { weekday: 'short' }))}</span><b>${dObj(d).getDate()}</b><span class="td-n">Day ${i + 1}</span>
      <span class="td-dots">${kinds.map(k => `<i class="${typeOf(k.type).tint}"></i>`).join('')}${clash ? `<em title="Plans overlap">!</em>` : ''}</span></button>`;
  }).join('')}</div>`;
}

// ───────── one day
function dayMode() {
  const t = S.trip, day = S.day;
  const body = $('#tlBody'); if (!body) return;
  const items = TL.itemsOn(t, day);
  const timed = items.filter(i => TL.span(i)), loose = items.filter(i => !TL.span(i));
  const L = TL.layout(timed);
  const { lo, hi } = TL.window(timed);
  const z = zoomPx(), px = (m) => (m - lo) / 60 * z;
  const clash = new Set(TL.clashes(timed).flat());
  const gaps = TL.gaps(timed, { from: Math.max(lo, 8 * 60), to: Math.min(hi, 22 * 60), min: 90 });
  const ln = TL.localNow(t.tz);
  const hours = []; for (let m = lo; m <= hi; m += 60) hours.push(m);

  body.innerHTML = `
    <div class="tl-anytime" id="tlAny"><span class="ta-label">Any time</span>${loose.map(i => `<button class="ta-chip ${typeOf(i.type).tint} ${S.sel === i.id ? 'sel' : ''}" data-id="${i.id}">${icon(typeOf(i.type).icon, 13)}<span class="ellip">${esc(i.title || 'Untitled')}</span></button>`).join('')}<span class="ta-hint">${loose.length ? '' : 'Plans without a time go here — drag one onto the grid to give it a time'}</span></div>
    <div class="tl-scroll" id="tlScroll"><div class="tl-grid" id="tlGrid" style="height:${px(hi) + 12}px;--hr:${z}px">
      ${hours.map(m => `<div class="tl-hour" style="top:${px(m)}px"><span>${m < 1440 ? esc(tmin(m)) : ''}</span></div>`).join('')}
      ${hours.slice(0, -1).map(m => `<div class="tl-half" style="top:${px(m + 30)}px"></div>`).join('')}
      <div class="tl-lane" id="tlLane">
        ${gaps.map(g => `<button class="tl-gap" data-s="${g.s}" data-e="${g.e}" style="top:${px(g.s) + 3}px;height:${px(g.e) - px(g.s) - 6}px"><span>${icon('sun', 13)}${esc(durTxt(g.e - g.s))} free</span></button>`).join('')}
        ${timed.map(i => block(i, L.get(i.id), px, clash.has(i.id))).join('')}
        ${day === ln.date && ln.min >= lo && ln.min <= hi ? `<div class="tl-now" style="top:${px(ln.min)}px"><span>${esc(tmin(ln.min))}</span></div>` : ''}
      </div>
    </div></div>`;
  hydrateIcons(body);
  const sc = $('#tlScroll');
  // where to look first: the saved spot, the now line, the selected plan, or the first plan
  const sel = S.sel && timed.find(i => i.id === S.sel);
  let top = TLV.scroll[day];
  if (sel) top = px(TL.span(sel).s) - 80;
  else if (top == null) top = day === ln.date ? px(ln.min) - 160 : timed.length ? px(TL.span(timed[0]).s) - 40 : px(8 * 60);
  sc.scrollTop = Math.max(0, top);
  sc.onscroll = () => { TLV.scroll[day] = sc.scrollTop; };
  wireDay(lo, hi, z);
}
function block(i, pos, px, clash) {
  const T = typeOf(i.type);
  const top = px(pos.s), h = Math.max(20, px(pos.e) - top - 2);
  const w = 100 / pos.cols;
  const short = h < 40, tiny = h < 26;
  const b = i.bookingId && S.trip.bookings.find(x => x.id === i.bookingId);
  return `<div class="tl-item ${T.tint} ${S.sel === i.id ? 'sel' : ''} ${clash ? 'clash' : ''} ${short ? 'short' : ''} ${tiny ? 'tiny' : ''} ${i.done ? 'done' : ''}" data-id="${i.id}"
    style="top:${top}px;height:${h}px;left:calc(${pos.col * w}% + 2px);width:calc(${w}% - 4px)">
    <div class="ti-in"><span class="ti-ic">${icon(T.icon, 13)}</span><div class="ti-text"><b>${esc(i.title || 'Untitled')}</b>
    <span class="ti-time">${esc(t12(i.start))}${i.end ? '–' + esc(t12(i.end)) : ''}${i.place ? ' · ' + esc(i.place) : ''}</span>
    ${!short && (b || i.ref) ? `<span class="ti-ref">${icon('ticket', 11)} ${esc(i.ref || (b && b.ref) || 'Booked')}</span>` : ''}</div>${clash ? `<span class="ti-warn" title="Overlaps another plan">${icon('alert', 13)}</span>` : ''}</div>
    <div class="tl-handle" title="Drag to change the end time"></div></div>`;
}

function wireDay(lo, hi, z) {
  const lane = $('#tlLane'), grid = $('#tlGrid');
  const minAt = (clientY) => lo + (clientY - grid.getBoundingClientRect().top) / z * 60;
  // pick / move / resize
  $$('.tl-item', lane).forEach(el => {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const it = S.trip.items.find(x => x.id === el.dataset.id); if (!it) return;
      const sp = TL.span(it);
      startDrag(e, { el, it, mode: e.target.classList.contains('tl-handle') ? 'resize' : 'move', s: sp.s, e: sp.e, dur: sp.e - sp.s, lo, hi, z, minAt });
    });
    el.addEventListener('dblclick', () => { S.sel = el.dataset.id; inspector(); const f = $('#iTitle'); if (f) { f.focus(); f.select(); } });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); itemMenu(e, el.dataset.id); });
  });
  // untimed plans: click to select, drag onto the grid to give them a time
  $$('.ta-chip').forEach(el => {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const it = S.trip.items.find(x => x.id === el.dataset.id); if (!it) return;
      startDrag(e, { el, it, mode: 'place', dur: 60, lo, hi, z, minAt });
    });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); itemMenu(e, el.dataset.id); });
  });
  // empty grid: click to deselect, double-click to add at that time
  lane.addEventListener('pointerdown', (e) => { if (e.target === lane && S.sel) { S.sel = null; refreshDay(); } });
  lane.addEventListener('dblclick', (e) => { if (e.target !== lane) return; const s = Math.max(0, Math.min(1440 - 60, TL.snap(minAt(e.clientY) - 30))); addPlan({ start: TL.fromMin(s), end: TL.fromMin(s + 60) }); });
  $$('.tl-gap', lane).forEach(g => g.onclick = () => { const s = +g.dataset.s; addPlan({ start: TL.fromMin(s), end: TL.fromMin(Math.min(+g.dataset.e, s + 60)) }); });
}

function startDrag(e, d) {
  e.preventDefault();
  d.x0 = e.clientX; d.y0 = e.clientY; d.moved = false;
  TLV.drag = d; TLV.dragged = false;
  const tip = document.createElement('div'); tip.className = 'drag-tip'; d.tip = tip;
  const move = (ev) => {
    const dy = ev.clientY - d.y0, dx = ev.clientX - d.x0;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) { d.moved = true; TLV.dragged = true; document.body.appendChild(tip); document.body.classList.add('dragging'); d.el.classList.add('dragging'); if (d.mode === 'place') { d.ghost = d.el.cloneNode(true); d.ghost.classList.add('ghost-chip'); document.body.appendChild(d.ghost); } }
    const overDay = document.elementFromPoint(ev.clientX, ev.clientY);
    const chip = overDay && overDay.closest('.tl-day');
    const any = overDay && overDay.closest('#tlAny');
    $$('.tl-day.drop').forEach(x => x !== chip && x.classList.remove('drop'));
    if (chip && chip.dataset.day !== S.day) chip.classList.add('drop');
    $('#tlAny').classList.toggle('drop', !!any && d.mode !== 'place' && d.mode !== 'resize');
    d.toDay = chip && chip.dataset.day !== S.day ? chip.dataset.day : null;
    d.toAny = !!any && d.mode === 'move';
    let label = '';
    if (d.mode === 'move') {
      d.ns = Math.max(0, Math.min(1440 - d.dur, TL.snap(d.s + dy / d.z * 60))); d.ne = d.ns + d.dur;
      d.el.style.top = ((d.ns - d.lo) / 60 * d.z) + 'px';
      label = d.toDay ? `Move to ${fmtDate(d.toDay)}` : d.toAny ? 'Any time' : `${tmin(d.ns)} – ${tmin(d.ne)}`;
    } else if (d.mode === 'resize') {
      d.ns = d.s; d.ne = Math.max(d.s + 15, Math.min(1440, TL.snap(d.e + dy / d.z * 60)));
      d.el.style.height = Math.max(20, (d.ne - d.s) / 60 * d.z - 2) + 'px';
      label = `${tmin(d.ns)} – ${d.ne >= 1440 ? 'midnight' : tmin(d.ne)} · ${durTxt(d.ne - d.ns)}`;
    } else {
      d.ghost.style.left = (ev.clientX + 8) + 'px'; d.ghost.style.top = (ev.clientY + 8) + 'px';
      const g = $('#tlGrid').getBoundingClientRect();
      d.onGrid = ev.clientY > g.top && ev.clientY < g.bottom && ev.clientX > g.left && ev.clientX < g.right && !!document.elementFromPoint(ev.clientX, ev.clientY)?.closest('#tlScroll');
      if (d.onGrid) { d.ns = Math.max(0, Math.min(1380, TL.snap(d.minAt(ev.clientY) - 30))); d.ne = d.ns + 60; label = `${tmin(d.ns)} – ${tmin(d.ne)}`; }
      else label = d.toDay ? `Move to ${fmtDate(d.toDay)}` : 'Drop on the grid to set a time';
    }
    tip.textContent = label; tip.style.left = (ev.clientX + 14) + 'px'; tip.style.top = (ev.clientY - 30) + 'px';
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    tip.remove(); if (d.ghost) d.ghost.remove();
    document.body.classList.remove('dragging');
    $$('.tl-day.drop').forEach(x => x.classList.remove('drop')); const a = $('#tlAny'); if (a) a.classList.remove('drop');
    TLV.drag = null;
    setTimeout(() => { TLV.dragged = false; }, 0);
    const it = d.it;
    if (!d.moved) { S.sel = it.id; refreshDay(); return; }
    if (d.toDay) { it.day = d.toDay; toast('Moved', `${it.title} → ${fmtDate(d.toDay)}`, 'ok', 3000, [{ label: 'Show', run: () => { S.day = it.day; S.sel = it.id; render(); } }]); }
    else if (d.toAny) { it.start = ''; it.end = ''; }
    else if (d.mode === 'place') { if (!d.onGrid) { refreshDay(); return; } it.start = TL.fromMin(d.ns); it.end = TL.fromMin(d.ne); }
    else { it.start = TL.fromMin(d.ns); it.end = d.ne >= 1440 ? '23:59' : TL.fromMin(d.ne); }
    S.sel = it.id;
    writeBack(it);
    persist();
    refreshDay();
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}

// a plan that came from a booking moves the booking with it
function writeBack(it) {
  if (!it.bookingId) return;
  const b = S.trip.bookings.find(x => x.id === it.bookingId); if (!b) return;
  if (!it.start) { b.onTimeline = b.onTimeline; return; }
  switch (it.part) {
    case 'main': { const sameDay = !b.endDate || b.endDate === b.startDate; b.startDate = it.day; b.startTime = it.start; if (sameDay) { b.endDate = it.day; b.endTime = it.end; } break; }
    case 'in': case 'pick': b.startDate = it.day; b.startTime = it.start; break;
    case 'out': case 'drop': b.endDate = it.day; b.endTime = it.start; break;
    case 'arrive': b.endDate = it.day; b.endTime = it.end; break;
  }
  TL.syncBooking(S.trip, b, newId);
}

function refreshDay() {
  const sc = $('#tlScroll'); if (sc) TLV.scroll[S.day] = sc.scrollTop;
  const days = TL.dayList(S.trip.start, S.trip.end);
  const strip = $('#tlDays'); if (strip) { const x = strip.scrollLeft; strip.outerHTML = dayStrip(days); const s2 = $('#tlDays'); s2.scrollLeft = x; $$('.tl-day').forEach(b => b.onclick = () => { if (TLV.dragged) return; S.day = b.dataset.day; S.sel = null; S.mode = 'day'; render(); }); }
  if (S.mode === 'list') listMode(); else { TLV.keepScroll = true; dayMode(); }
  inspector();
  $('#headLeft').innerHTML = VIEWS.timeline.head();
  side();
}

// ───────── every day at once
function listMode() {
  const t = S.trip, days = TL.dayList(t.start, t.end), ln = TL.localNow(t.tz);
  const body = $('#tlBody');
  body.innerHTML = `<div class="tl-list">${days.map((d, n) => {
    const items = TL.itemsOn(t, d);
    const cl = new Set(TL.clashes(items).flat());
    return `<section class="tl-lday ${d === ln.date ? 'today' : ''}" data-day="${d}"><div class="tl-lhead"><b>Day ${n + 1}</b><span>${esc(fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' }))}</span>${d === ln.date ? '<span class="pill acc">Today</span>' : ''}<span class="grow"></span><button class="btn xs ghost" data-addday="${d}">${icon('plus', 13)}Add</button></div>
      ${items.length ? items.map(i => `<button class="tl-lrow ${S.sel === i.id ? 'sel' : ''}" data-id="${i.id}" data-day="${d}"><span class="lr-t">${i.start ? esc(t12(i.start)) + (i.end ? `<small>${esc(t12(i.end))}</small>` : '') : '<small>Any time</small>'}</span><i class="${typeOf(i.type).tint}"></i><span class="grow" style="min-width:0"><b class="ellip">${esc(i.title || 'Untitled')}</b>${i.place ? `<span class="ellip muted small">${esc(i.place)}</span>` : ''}</span>${cl.has(i.id) ? `<span class="pill warn">${icon('alert', 11)} Overlap</span>` : ''}${i.ref ? `<span class="code small muted">${esc(i.ref)}</span>` : ''}</button>`).join('') : '<div class="muted small" style="padding:6px 2px 10px">Free day.</div>'}
    </section>`;
  }).join('')}</div>`;
  hydrateIcons(body);
  $$('.tl-lrow', body).forEach(r => { r.onclick = () => { S.sel = r.dataset.id; S.day = r.dataset.day; $$('.tl-lrow.sel').forEach(x => x.classList.remove('sel')); r.classList.add('sel'); inspector(); }; r.ondblclick = () => { S.sel = r.dataset.id; S.day = r.dataset.day; S.mode = 'day'; render(); }; r.oncontextmenu = (e) => { e.preventDefault(); itemMenu(e, r.dataset.id); }; });
  $$('[data-addday]', body).forEach(b => b.onclick = () => { S.day = b.dataset.addday; S.mode = 'day'; addPlan(); });
}

// ───────── adding and changing plans
function addPlan(over = {}) {
  const t = S.trip;
  if (!S.day) S.day = TL.dayList(t.start, t.end)[0];
  if (!S.day) return tripSheet(t);
  if (!over.start && over.start !== '') {
    // first free hour after the last plan, or 10:00
    const items = TL.itemsOn(t, S.day).filter(i => TL.span(i));
    const g = TL.gaps(items, { from: 9 * 60, to: 22 * 60, min: 60 })[0];
    const s = g ? g.s : 10 * 60;
    over.start = TL.fromMin(s); over.end = TL.fromMin(s + 60);
  }
  const it = { id: newId(), day: S.day, start: '', end: '', title: '', type: 'activity', place: '', notes: '', ref: '', ...over };
  t.items.push(it);
  S.sel = it.id; S.mode = S.mode === 'list' ? 'list' : 'day';
  persist();
  if (S.view !== 'timeline') go('timeline'); else refreshDay();
  setTimeout(() => { const f = $('#iTitle'); if (f) f.focus(); }, 30);
  return it;
}
function deletePlan(id) {
  const t = S.trip; const it = t.items.find(x => x.id === id); if (!it) return;
  if (it.bookingId) {
    const b = t.bookings.find(x => x.id === it.bookingId);
    if (b) { b.onTimeline = false; TL.syncBooking(t, b, newId); }
  }
  const before = t.items.slice();
  t.items = t.items.filter(x => x.id !== id);
  if (S.sel === id) S.sel = null;
  persist(); refreshDay();
  toast(it.bookingId ? 'Taken off the timeline' : 'Plan removed', it.bookingId ? 'The booking is still saved — tick “Show on timeline” to bring it back.' : it.title, 'ok', 6000, it.bookingId ? null : [{ label: 'Undo', run: () => { t.items = before; persist(); refreshDay(); } }]);
}
function duplicatePlan(id, toDay) {
  const it = S.trip.items.find(x => x.id === id); if (!it) return;
  const c = { ...it, id: newId(), day: toDay || it.day }; delete c.bookingId; delete c.part;
  S.trip.items.push(c); S.sel = c.id; persist(); refreshDay();
}
function itemMenu(anchor, id) {
  const it = S.trip.items.find(x => x.id === id); if (!it) return;
  const days = TL.dayList(S.trip.start, S.trip.end);
  menu(anchor, [
    { label: 'Edit', icon: 'edit', run: () => { S.sel = id; S.day = it.day; refreshDay(); setTimeout(() => $('#iTitle') && $('#iTitle').focus(), 20); } },
    { label: it.done ? 'Mark not done' : 'Mark done', icon: 'check', run: () => { it.done = !it.done; persist(); refreshDay(); } },
    { label: 'Duplicate', icon: 'dup', run: () => duplicatePlan(id) },
    it.bookingId ? { label: 'Edit booking…', icon: 'ticket', run: () => bookingSheet(S.trip.bookings.find(b => b.id === it.bookingId)) } : null,
    { label: 'Move to another day', section: true },
    ...days.filter(d => d !== it.day).slice(0, 10).map(d => ({ label: fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' }), icon: 'calendar', run: () => { it.day = d; writeBack(it); persist(); refreshDay(); } })),
    '-',
    { label: it.bookingId ? 'Take off the timeline' : 'Delete', icon: 'trash', danger: true, run: () => deletePlan(id) },
  ]);
}

// ───────── the inspector
function inspector() {
  const box = $('#tlInsp'); if (!box) return;
  const t = S.trip;
  const it = S.sel && t.items.find(x => x.id === S.sel);
  if (!it) return daySummary(box);
  const days = TL.dayList(t.start, t.end);
  const T = typeOf(it.type);
  const b = it.bookingId && t.bookings.find(x => x.id === it.bookingId);
  box.innerHTML = `
    <div class="insp-head">${tile(T.tint, T.icon, 'md', 17)}<div class="grow"><span class="tiny muted">${b ? 'From a booking' : 'Plan'}</span><b>${esc(T.label)}</b></div><button class="icon-btn sm" id="iClose" title="Close">${icon('x', 16)}</button></div>
    <div class="insp-body">
      <input class="input title-in" id="iTitle" value="${esc(it.title)}" placeholder="What's the plan?">
      <div class="type-chips">${Object.entries(TL.TYPES).map(([k, v]) => `<button class="type-chip ${v.tint} ${k === it.type ? 'on' : ''}" data-type="${k}" title="${esc(v.label)}">${icon(v.icon, 14)}</button>`).join('')}</div>
      <div class="field"><label>Day</label><select class="select" id="iDay">${days.map((d, i) => `<option value="${d}" ${d === it.day ? 'selected' : ''}>Day ${i + 1} · ${esc(fmtDate(d))}</option>`).join('')}</select></div>
      <div class="grid2 times ${it.start ? '' : 'off'}"><div class="field"><label>Starts</label><input class="input" type="time" id="iStart" value="${esc(it.start)}" step="300"></div><div class="field"><label>Ends</label><input class="input" type="time" id="iEnd" value="${esc(it.end)}" step="300"></div></div>
      <label class="check-line"><input type="checkbox" id="iAny" ${it.start ? '' : 'checked'}> Any time that day</label>
      <div class="field"><label>Where</label><div class="row"><input class="input grow" id="iPlace" value="${esc(it.place)}" placeholder="Address or place name">${it.place ? `<button class="icon-btn" data-url="${esc(mapsUrl(it.place))}" title="Open in maps (needs internet)">${icon('map', 16)}</button>` : ''}</div></div>
      <div class="field"><label>Confirmation / reference</label><input class="input mono-in" id="iRef" value="${esc(it.ref || '')}" placeholder="Optional"></div>
      <div class="field"><label>Notes</label><textarea class="input area" id="iNotes" rows="4" placeholder="Opening hours, what to order, who's meeting where…">${esc(it.notes)}</textarea></div>
      ${b ? `<div class="linked">${icon('ticket', 15)}<div class="grow" style="min-width:0"><b class="ellip">${esc(b.title)}</b><span>Moving this moves the booking too</span></div><button class="btn xs" id="iBk">Edit booking</button></div>` : ''}
    </div>
    <div class="insp-foot"><button class="btn sm ghost" id="iDone">${icon('check', 14)}${it.done ? 'Done' : 'Mark done'}</button><button class="btn sm ghost" id="iDup">${icon('dup', 14)}Duplicate</button><span class="grow"></span><button class="icon-btn sm danger-ic" id="iDel" title="${b ? 'Take off the timeline' : 'Delete'}">${icon('trash', 15)}</button></div>`;
  const set = (patch, redraw = true) => { Object.assign(it, patch); writeBack(it); persist(); if (redraw) { const f = document.activeElement && document.activeElement.id; refreshDay(); if (f && $('#' + f)) { const el = $('#' + f); el.focus(); if (el.setSelectionRange && el.type === 'text') { const n = el.value.length; el.setSelectionRange(n, n); } } } };
  $('#iClose').onclick = () => { S.sel = null; refreshDay(); };
  $('#iTitle').oninput = (e) => { it.title = e.target.value; persist(); const el = $(`.tl-item[data-id="${it.id}"] b`) || $(`.ta-chip[data-id="${it.id}"] span.ellip`) || $(`.tl-lrow[data-id="${it.id}"] b`); if (el) el.textContent = it.title || 'Untitled'; };
  $('#iTitle').onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); };
  $$('.type-chip', box).forEach(c => c.onclick = () => set({ type: c.dataset.type }));
  $('#iDay').onchange = (e) => { S.day = e.target.value; set({ day: e.target.value }); };
  $('#iStart').onchange = (e) => {
    const v = e.target.value; if (!v) return;
    const sp = TL.span(it); const dur = sp ? sp.e - sp.s : 60;
    set({ start: v, end: TL.fromMin(Math.min(1439, TL.toMin(v) + dur)) });
  };
  $('#iEnd').onchange = (e) => { const v = e.target.value; if (v && it.start && v <= it.start) return toast('The end is before the start', 'Pick a later end time.', 'info'); set({ end: v }); };
  $('#iAny').onchange = (e) => { if (e.target.checked) set({ start: '', end: '' }); else set({ start: '10:00', end: '11:00' }); };
  $('#iPlace').onchange = (e) => set({ place: e.target.value.trim() });
  $('#iRef').onchange = (e) => set({ ref: e.target.value.trim() }, false);
  $('#iNotes').oninput = (e) => { it.notes = e.target.value; persist(); };
  $('#iDone').onclick = () => set({ done: !it.done });
  $('#iDup').onclick = () => duplicatePlan(it.id);
  $('#iDel').onclick = () => deletePlan(it.id);
  if (b) $('#iBk').onclick = () => bookingSheet(b);
}

function daySummary(box) {
  const t = S.trip, day = S.day;
  if (S.mode === 'list' && !day) { box.innerHTML = ''; return; }
  const days = TL.dayList(t.start, t.end), n = days.indexOf(day);
  const items = TL.itemsOn(t, day);
  const timed = items.filter(i => TL.span(i) && !['note', 'rest'].includes(i.type));
  const busy = timed.reduce((a, i) => { const s = TL.span(i); return a + (s.e - s.s); }, 0);
  const free = TL.gaps(timed, { from: 8 * 60, to: 22 * 60, min: 60 });
  const spent = TL.budget(t).byDay[day] || 0;
  const clashes = TL.clashes(items);
  const scheduled = new Set(t.items.map(i => (i.title || '').toLowerCase()));
  const ideas = t.research.places.filter(p => !p.visited && !scheduled.has(p.name.toLowerCase())).slice(0, 6);
  const stays = t.bookings.filter(b => b.type === 'stay' && b.startDate && day >= b.startDate && day < (b.endDate || TL.addDays(b.startDate, 1)));
  box.innerHTML = `
    <div class="insp-head">${tile('a-sunset', 'calendar', 'md', 17)}<div class="grow"><span class="tiny muted">Day ${n + 1} of ${days.length}</span><b>${esc(fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric' }))}</b></div>
      <button class="icon-btn sm" id="dPrev" ${n <= 0 ? 'disabled' : ''} title="Previous day (←)">${icon('back', 16)}</button><button class="icon-btn sm" id="dNext" ${n >= days.length - 1 ? 'disabled' : ''} title="Next day (→)">${icon('chevron', 16)}</button></div>
    <div class="insp-body">
      <div class="stat-row small3">${[[String(items.length), items.length === 1 ? 'Plan' : 'Plans'], [busy ? hm(busy) : '—', 'Busy'], [free.length ? hm(free.reduce((a, g) => a + g.e - g.s, 0)) : '—', 'Free time']].map(([v, l]) => `<div><b>${esc(v)}</b><span>${l}</span></div>`).join('')}</div>
      ${stays.length ? `<div class="sum-line">${icon('bed', 15)}<span class="grow">Sleeping at <b>${esc(stays.map(s => s.title).join(', '))}</b></span></div>` : ''}
      ${spent ? `<div class="sum-line">${icon('wallet', 15)}<span class="grow">Spent <b>${esc(money(spent))}</b> this day</span></div>` : ''}
      ${clashes.length ? `<div class="note-box warn">${icon('alert', 16)}<div>${clashes.map(([a, b]) => { const A = t.items.find(x => x.id === a), B = t.items.find(x => x.id === b); return `<b>${esc(A.title)}</b> overlaps <b>${esc(B.title)}</b>`; }).join('<br>')}</div></div>` : ''}
      ${free.length ? `<div class="label">Free time</div><div class="free-list">${free.map(g => `<button class="free-row" data-s="${g.s}" data-e="${g.e}">${icon('sun', 14)}<span class="grow">${esc(tmin(g.s))} – ${esc(tmin(g.e))}</span><span class="muted small">${esc(durTxt(g.e - g.s))}</span>${icon('plus', 14)}</button>`).join('')}</div>` : ''}
      ${ideas.length ? `<div class="label">From your places list</div><div class="free-list">${ideas.map(p => `<button class="free-row" data-place="${p.id}">${icon(typeOf(p.kind).icon, 14)}<span class="grow ellip">${esc(p.name)}</span><span class="muted small ellip">${esc(p.area || '')}</span>${icon('plus', 14)}</button>`).join('')}</div>` : ''}
      <div class="tip">${icon('info', 14)}<span>Drag a plan to move it, drag its bottom edge to change how long it runs, or drop it on another day up top. Double-click the grid to add a plan there.</span></div>
    </div>
    <div class="insp-foot"><button class="btn sm primary grow" id="dAdd">${icon('plus', 14)}Add plan</button></div>`;
  $('#dPrev').onclick = () => stepDay(-1); $('#dNext').onclick = () => stepDay(1);
  $('#dAdd').onclick = () => addPlan();
  $$('.free-row[data-s]', box).forEach(r => r.onclick = () => { const s = +r.dataset.s; addPlan({ start: TL.fromMin(s), end: TL.fromMin(Math.min(+r.dataset.e, s + 90)) }); });
  $$('.free-row[data-place]', box).forEach(r => r.onclick = () => {
    const p = t.research.places.find(x => x.id === r.dataset.place);
    const g = TL.gaps(TL.itemsOn(t, day).filter(i => TL.span(i)), { from: 9 * 60, to: 21 * 60, min: 60 })[0];
    const s = g ? g.s : 10 * 60;
    addPlan({ title: p.name, type: TL.TYPES[p.kind] ? p.kind : 'sight', place: p.area || '', notes: p.notes || '', start: TL.fromMin(s), end: TL.fromMin(s + 90) });
  });
}
function hm(min) { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`; }
function stepDay(d) {
  const days = TL.dayList(S.trip.start, S.trip.end); const i = days.indexOf(S.day) + d;
  if (i < 0 || i >= days.length) return;
  S.day = days[i]; S.sel = null; render();
}
addEventListener('keydown', (e) => {
  if (S.view !== 'timeline' || $('#sheetHost').firstChild || $('#popHost').firstChild) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (typing) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) { e.preventDefault(); deletePlan(S.sel); }
  else if (e.key === 'ArrowLeft' && S.mode !== 'list') stepDay(-1);
  else if (e.key === 'ArrowRight' && S.mode !== 'list') stepDay(1);
  else if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); addPlan(); }
  else if (e.key.toLowerCase() === 'd' && (e.metaKey || e.ctrlKey) && S.sel) { e.preventDefault(); duplicatePlan(S.sel); }
  else if (e.key === 'Escape' && S.sel) { S.sel = null; refreshDay(); }
});
