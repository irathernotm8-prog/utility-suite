// Bookings: flights, stays, cars, trains, tickets and tours with confirmation numbers, costs and the
// documents that go with them. Each one with a date puts itself on the timeline.
'use strict';

VIEWS.bookings = {
  head: () => `<h1>Bookings <small>${plural(S.trip.bookings.length, 'booking')}</small></h1>`,
  actions: () => `<button class="btn" id="bkFind"><span data-icon="search" data-size="15"></span>Find flights &amp; stays</button><div class="seg" id="bkSort"><button data-s="date" class="${S.bkSort !== 'type' ? 'on' : ''}">By date</button><button data-s="type" class="${S.bkSort === 'type' ? 'on' : ''}">By kind</button></div><button class="btn primary" id="bkAdd"><span data-icon="plus" data-size="15"></span>Add booking</button>`,
  render(v) {
    const t = S.trip;
    if (!t.bookings.length) {
      v.innerHTML = empty('ticket', 'No bookings yet', 'Add flights, stays, trains, car hire and tickets. Each one keeps its confirmation number and documents, shows up on the timeline, and counts toward the budget.', `<div class="row" style="gap:8px;justify-content:center;flex-wrap:wrap;margin-top:6px">${Object.entries(TL.BOOKING_TYPES).slice(0, 5).map(([k, b]) => `<button class="btn" data-new="${k}">${icon(b.icon, 15)}${esc(b.label)}</button>`).join('')}</div>`);
      $$('[data-new]', v).forEach(b => b.onclick = () => bookingSheet(null, b.dataset.new));
      return;
    }
    const list = t.bookings.slice().sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999') || (a.startTime || '').localeCompare(b.startTime || ''));
    let groups;
    if (S.bkSort === 'type') groups = Object.entries(TL.BOOKING_TYPES).map(([k, d]) => [d.label, list.filter(b => b.type === k)]).filter(g => g[1].length);
    else {
      const m = new Map();
      for (const b of list) { const k = b.startDate ? fmtDate(b.startDate, { weekday: 'long', month: 'long', day: 'numeric' }) : 'No date'; if (!m.has(k)) m.set(k, []); m.get(k).push(b); }
      groups = [...m.entries()];
    }
    const sum = TL.budget(t);
    v.innerHTML = `<div class="bk-summary">${[['Total booked', money(sum.booked)], ['Still to pay', money(t.bookings.filter(b => !b.paid && Number(b.cost) > 0).reduce((a, b) => a + TL.toHome(b.cost, b.currency, t).v, 0))], ['Confirmation numbers', `${t.bookings.filter(b => b.ref).length} of ${t.bookings.length}`], ['With documents', `${t.bookings.filter(b => (b.docs || []).length).length} of ${t.bookings.length}`]].map(([l, x]) => `<div><span>${l}</span><b>${esc(x)}</b></div>`).join('')}</div>
      ${groups.map(([g, items]) => `<div class="section-title">${esc(g)}</div><div class="bk-list">${items.map(bookingCard).join('')}</div>`).join('')}`;
    $$('.bk-card', v).forEach(c => {
      c.onclick = (e) => { if (e.target.closest('[data-copy],[data-doc],[data-more]')) return; bookingSheet(t.bookings.find(b => b.id === c.dataset.id)); };
      c.oncontextmenu = (e) => { e.preventDefault(); bookingMenu(e, c.dataset.id); };
    });
    $$('[data-more]', v).forEach(b => b.onclick = (e) => { e.stopPropagation(); bookingMenu(b, b.dataset.more); });
    $$('[data-doc]', v).forEach(b => b.onclick = (e) => { e.stopPropagation(); openDoc(b.dataset.doc); });
  },
  after() {
    $('#bkAdd').onclick = () => bookingSheet();
    $('#bkFind').onclick = () => go('book');
    $$('#bkSort button').forEach(b => b.onclick = () => { S.bkSort = b.dataset.s; render(); });
  },
};

function bookingCard(b) {
  const T = TL.BOOKING_TYPES[b.type] || TL.BOOKING_TYPES.other;
  const t = S.trip;
  const tint = typeOf(T.item).tint;
  const docs = (b.docs || []).map(id => t.docs.find(d => d.id === id)).filter(Boolean);
  const when = b.startDate ? `${fmtDate(b.startDate)}${b.startTime ? ' · ' + t12(b.startTime) : ''}` : 'No date';
  const until = b.endDate && b.endDate !== b.startDate ? ` → ${fmtDate(b.endDate)}${b.endTime ? ' · ' + t12(b.endTime) : ''}` : b.endTime ? ` → ${t12(b.endTime)}` : '';
  const nights = b.type === 'stay' && b.startDate && b.endDate ? TL.daysBetween(b.startDate, b.endDate) : 0;
  const route = (b.type === 'flight' || b.type === 'train') && (b.from || b.to);
  return `<div class="bk-card ${tint}" data-id="${b.id}">
    <div class="bk-stripe"></div>
    ${tile(tint, T.icon, 'lg', 20)}
    <div class="bk-main"><div class="bk-kind">${esc(T.label)}${b.provider ? ' · ' + esc(b.provider) : ''}</div><b class="ellip">${esc(b.title || T.label)}</b>
      ${route ? `<div class="bk-route"><span>${esc(b.from || '—')}</span>${icon(b.type === 'flight' ? 'plane' : 'train', 14)}<span>${esc(b.to || '—')}</span></div>` : ''}
      <div class="bk-when">${icon('calendar', 13)}${esc(when + until)}${nights > 0 ? ` · ${plural(nights, 'night')}` : ''}</div>
      ${b.address && !route ? `<div class="bk-when ellip">${icon('pin', 13)}${esc(b.address)}</div>` : ''}
      ${docs.length ? `<div class="bk-docs">${docs.map(d => `<button class="doc-chip" data-doc="${d.id}">${icon(d.kind === 'image' ? 'image' : 'fileText', 12)}<span class="ellip">${esc(d.name)}</span></button>`).join('')}</div>` : ''}
    </div>
    <div class="bk-right">${b.ref ? copyBtn(b.ref) : '<span class="muted small">No confirmation #</span>'}
      ${Number(b.cost) > 0 ? `<span class="bk-cost">${esc(money(Number(b.cost), b.currency || t.currency))}${b.paid ? '<span class="pill ok">Paid</span>' : '<span class="pill warn">To pay</span>'}</span>` : ''}
      ${b.booked ? `<span class="pill ${b.booked.mode === 'live' ? 'acc' : 'warn'}">${icon('check', 11)} Booked in Waypoint${b.booked.mode === 'live' ? '' : b.booked.mode === 'demo' ? ' · sample' : ' · test'}</span>` : ''}
      ${b.onTimeline === false ? '<span class="pill">Not on timeline</span>' : ''}</div>
    <button class="icon-btn sm bk-more" data-more="${b.id}" title="More">${icon('more', 16)}</button>
  </div>`;
}
function bookingMenu(anchor, id) {
  const t = S.trip, b = t.bookings.find(x => x.id === id); if (!b) return;
  menu(anchor, [
    { label: 'Edit…', icon: 'edit', run: () => bookingSheet(b) },
    b.startDate && b.onTimeline !== false ? { label: 'Show on timeline', icon: 'timeline', run: () => { const it = t.items.find(i => i.bookingId === b.id); S.sel = it && it.id; go('timeline', { day: b.startDate }); } } : null,
    { label: 'Attach documents…', icon: 'passport', run: () => attachDocs(b) },
    b.ref ? { label: 'Copy confirmation number', icon: 'copy', run: () => call('copy', b.ref).then(() => toast('Copied', b.ref)) } : null,
    !b.paid && Number(b.cost) > 0 ? { label: 'Mark paid', icon: 'check', run: () => { b.paid = true; persist(); render(); } } : null,
    '-',
    { label: 'Delete booking', icon: 'trash', danger: true, run: () => deleteBooking(b.id) },
  ]);
}
async function attachDocs(b) {
  try { const r = await call('pickDocs', S.trip.id, { bookingId: b.id, tag: ['flight', 'train', 'ticket'].includes(b.type) ? 'ticket' : 'booking' }); if (r) { S.trip = r.trip; render(); toast(`Attached ${plural(r.added.length, 'document')}`, b.title); } } catch (e) { fail(e); }
}
async function deleteBooking(id) {
  const t = S.trip, b = t.bookings.find(x => x.id === id);
  if (!await confirmBox({ title: `Delete “${b.title}”?`, text: 'Its timeline entries go too. Attached documents stay in Documents.', ok: 'Delete', danger: true })) return;
  t.bookings = t.bookings.filter(x => x.id !== id);
  TL.unlinkBooking(t, id);
  for (const d of t.docs) if (d.bookingId === id) d.bookingId = '';
  persist(); render();
}

// ───────── the booking sheet (fields change with the kind)
function bookingSheet(b, kind, prefill) {
  const t = S.trip;
  const isNew = !b;
  const days = TL.dayList(t.start, t.end);
  const x = b ? { ...b } : { id: newId(), type: kind || 'flight', title: '', provider: '', ref: '', from: '', to: '', address: '', phone: '', seat: '', startDate: (S.view === 'timeline' && S.day) || days[0] || '', startTime: '', endDate: '', endTime: '', cost: '', currency: t.currency, paid: false, notes: '', docs: [], onTimeline: true, ...(prefill || {}) };
  const el = openSheet(`<div class="sheet-head">${tile('a-sky', 'ticket', 'md', 18)}<div class="grow"><h3>${isNew ? 'Add a booking' : 'Edit booking'}</h3><div class="muted small">${prefill ? 'Filled in from the confirmation page — check it, then save.' : 'Bookings with a date show up on the timeline.'}</div></div></div>
    <div class="sheet-body">
      <div class="kind-picker">${Object.entries(TL.BOOKING_TYPES).map(([k, d]) => `<button type="button" class="kind ${k === x.type ? 'on' : ''}" data-kind="${k}">${icon(d.icon, 16)}<span>${esc(d.label)}</span></button>`).join('')}</div>
      <div id="bkFields"></div>
    </div>
    <div class="sheet-foot">${isNew ? '' : `<button class="btn ghost danger" id="bkDel">${icon('trash', 15)}Delete</button>`}<span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="bkOk">${isNew ? 'Add booking' : 'Save'}</button></div>`, { width: 640 });
  const fieldsFor = (k) => {
    const route = k === 'flight' || k === 'train';
    const L = { flight: ['Flight', 'e.g. AA 2210 · Houston → Lisbon', 'Airline', 'From (airport)', 'To (airport)', 'Departs', 'Arrives', 'Seats'], stay: ['Place', 'Hotel or rental name', 'Booked through', '', '', 'Check in', 'Check out', 'Room'], car: ['Car', 'e.g. Compact · Hertz', 'Company', 'Pick up at', 'Drop off at', 'Pick up', 'Drop off', ''], train: ['Trip', 'e.g. Lisbon → Porto', 'Operator', 'From', 'To', 'Departs', 'Arrives', 'Seats / car'], ticket: ['Tickets for', 'e.g. Museum, show, match', 'Seller', '', '', 'Starts', 'Ends', 'Seats'], tour: ['Tour', 'e.g. Douro Valley day trip', 'Company', '', '', 'Starts', 'Ends', ''], food: ['Restaurant', 'Restaurant name', 'Booked through', '', '', 'Table at', 'Until', 'Party size'], other: ['What', 'Anything with a booking', 'Company', '', '', 'Starts', 'Ends', ''] }[k];
    return `
      <div class="field"><label>${L[0]}</label><input class="input" name="title" value="${esc(x.title)}" placeholder="${esc(L[1])}"></div>
      <div class="grid2"><div class="field"><label>${L[2]}</label><input class="input" name="provider" value="${esc(x.provider)}"></div><div class="field"><label>Confirmation number</label><input class="input mono-in" name="ref" value="${esc(x.ref)}" placeholder="ABC123"></div></div>
      ${L[3] ? `<div class="grid2"><div class="field"><label>${L[3]}</label><input class="input" name="from" value="${esc(x.from)}"></div><div class="field"><label>${L[4]}</label><input class="input" name="to" value="${esc(x.to)}"></div></div>` : ''}
      ${!route ? `<div class="field"><label>Address</label><input class="input" name="address" value="${esc(x.address)}"></div>` : ''}
      <div class="grid4"><div class="field"><label>${L[5]}</label><input class="input" type="date" name="startDate" value="${esc(x.startDate)}"></div><div class="field"><label>&nbsp;</label><input class="input" type="time" name="startTime" value="${esc(x.startTime)}"></div>
        <div class="field"><label>${L[6]}</label><input class="input" type="date" name="endDate" value="${esc(x.endDate)}"></div><div class="field"><label>&nbsp;</label><input class="input" type="time" name="endTime" value="${esc(x.endTime)}"></div></div>
      <div class="hint">Times are local to where you'll be${t.tz ? ` (${esc(t.tz.split('/').pop().replace(/_/g, ' '))} for this trip)` : ''}.</div>
      <div class="grid3"><div class="field"><label>Cost</label><input class="input" type="number" step="0.01" min="0" name="cost" value="${esc(x.cost)}"></div>
        <div class="field"><label>Currency</label><select class="select" name="currency">${[...new Set([t.currency, t.localCurrency, ...PLACES.CURRENCIES])].filter(Boolean).map(c => `<option ${c === (x.currency || t.currency) ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label>${L[7] || 'Phone'}</label><input class="input" name="${L[7] ? 'seat' : 'phone'}" value="${esc(L[7] ? x.seat : x.phone)}"></div></div>
      ${L[7] ? `<div class="field"><label>Phone</label><input class="input" name="phone" value="${esc(x.phone)}" placeholder="For the front desk, the airline, the driver…"></div>` : ''}
      <div class="field"><label>Notes</label><textarea class="input area" name="notes" rows="3">${esc(x.notes)}</textarea></div>
      <div class="row" style="gap:18px;flex-wrap:wrap"><label class="check-line"><input type="checkbox" name="paid" ${x.paid ? 'checked' : ''}> Paid</label><label class="check-line"><input type="checkbox" name="onTimeline" ${x.onTimeline !== false ? 'checked' : ''}> Show on timeline</label>
        <span class="grow"></span>${isNew ? '' : `<button class="btn sm" type="button" id="bkAttach">${icon('passport', 14)}Attach documents${(x.docs || []).length ? ` (${x.docs.length})` : ''}</button>`}</div>`;
  };
  const draw = () => { $('#bkFields', el).innerHTML = fieldsFor(x.type); hydrateIcons(el); const a = $('#bkAttach', el); if (a) a.onclick = () => { save(false); closeSheet(); attachDocs(t.bookings.find(q => q.id === x.id)); }; };
  const grab = () => Object.assign(x, formVals($('#bkFields', el)));
  $$('.kind', el).forEach(k => k.onclick = () => { grab(); x.type = k.dataset.kind; $$('.kind', el).forEach(q => q.classList.toggle('on', q === k)); draw(); });
  draw();
  el.addEventListener('change', (e) => { if (e.target.name === 'startDate') { const end = el.querySelector('[name=endDate]'); if (end && end.value && end.value < e.target.value) end.value = e.target.value; } });
  el.querySelector('[data-x]').onclick = closeSheet;
  const save = (close = true) => {
    grab();
    if (!x.title) x.title = x.type === 'flight' || x.type === 'train' ? [x.from, x.to].filter(Boolean).join(' → ') || TL.BOOKING_TYPES[x.type].label : TL.BOOKING_TYPES[x.type].label;
    if (x.endDate && x.startDate && x.endDate < x.startDate) x.endDate = x.startDate;
    x.cost = x.cost === '' ? '' : Number(x.cost);
    const i = t.bookings.findIndex(q => q.id === x.id);
    if (i >= 0) t.bookings[i] = x; else t.bookings.push(x);
    TL.syncBooking(t, x, newId);
    for (const id of x.docs || []) { const d = t.docs.find(q => q.id === id); if (d) d.bookingId = x.id; }
    // a booking outside the trip dates: offer to stretch the trip
    if (x.startDate && t.start && (x.startDate < t.start || (x.endDate || x.startDate) > t.end)) {
      toast('This booking is outside the trip dates', `${fmtDate(x.startDate)} isn't between ${fmtDate(t.start)} and ${fmtDate(t.end)}.`, 'info', 10000, [{ label: 'Stretch the trip', run: () => { t.start = [t.start, x.startDate].sort()[0]; t.end = [t.end, x.endDate || x.startDate].sort().pop(); persist(); render(); } }]);
    }
    persist();
    if (close) { closeSheet(); render(); toast(isNew ? 'Booking added' : 'Saved', x.title); }
  };
  el.querySelector('#bkOk').onclick = () => save();
  if (!isNew) el.querySelector('#bkDel').onclick = () => { closeSheet(); deleteBooking(x.id); };
}
