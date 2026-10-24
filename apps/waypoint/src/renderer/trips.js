// All trips: the next trip up front, then upcoming and past trips; new / edit trip; opening .waypoint files.
'use strict';

VIEWS.trips = {
  head: () => `<h1>${greeting()}</h1>`,
  actions: () => `<button class="btn" id="openFile"><span data-icon="import" data-size="15"></span>Open trip file</button><button class="btn primary" id="newTrip"><span data-icon="plus" data-size="15"></span>New trip</button>`,
  render(v) {
    const today = TL.todayStr();
    const trips = S.trips.slice();
    const active = trips.filter(t => t.end && t.end >= today || !t.start).sort((a, b) => (a.start || '9').localeCompare(b.start || '9'));
    const past = trips.filter(t => t.end && t.end < today).sort((a, b) => b.start.localeCompare(a.start));
    if (!trips.length) {
      v.innerHTML = `<div class="first">
        <div class="first-art">${routeArt()}</div>
        <h2>Where to next?</h2>
        <p>Make a trip and Waypoint keeps everything for it in one place: a timeline for each day, bookings and confirmation numbers, tickets and passport copies, the budget, and the places you want to go. It all lives on this computer, so it works with no signal — and it's on your phone in one scan.</p>
        <div class="row" style="justify-content:center;gap:10px"><button class="btn primary lg" id="firstNew"><span data-icon="plus" data-size="16"></span>Plan a trip</button><button class="btn lg" id="firstSample"><span data-icon="sparkle" data-size="16"></span>Try a sample trip</button></div>
        <div class="first-feats">${[['timeline', 'Day timelines', 'Drag plans around, see clashes and free time'], ['ticket', 'Bookings', 'Flights and stays land on the timeline'], ['passport', 'Documents', 'Tickets, passports and insurance, offline'], ['wallet', 'Budget', 'Planned vs spent, any currency, who owes whom'], ['qr', 'On your phone', 'Scan once, keep it offline']].map(([i, b, s]) => `<div>${tile('a-sunset', i, 'md', 17)}<b>${b}</b><span>${s}</span></div>`).join('')}</div>
      </div>`;
      $('#firstNew').onclick = () => tripSheet();
      $('#firstSample').onclick = async () => { try { const id = await call('sample'); await reloadTrips(); openTrip(id); } catch (e) { fail(e); } };
      return;
    }
    const hero = active[0];
    let h = '';
    if (hero) h += heroCard(hero);
    const rest = active.slice(1);
    h += `<div class="section-title">Coming up<span class="muted small" style="font-weight:500">${rest.length ? plural(rest.length, 'trip') : ''}</span></div><div class="trip-grid">${rest.map(tripCard).join('')}<button class="trip-card new" id="newCard"><span data-icon="plus" data-size="22"></span><b>New trip</b><span>Name it, pick dates, fill it in as you go</span></button></div>`;
    if (past.length) h += `<div class="section-title">Been there</div><div class="trip-grid past">${past.map(tripCard).join('')}</div>`;
    v.innerHTML = h;
    $$('[data-trip]', v).forEach(el => {
      el.onclick = (e) => { if (e.target.closest('[data-more]')) return; openTrip(el.dataset.trip); };
      el.oncontextmenu = (e) => { e.preventDefault(); tripMenu(e, el.dataset.trip); };
    });
    $$('[data-more]', v).forEach(b => b.onclick = (e) => { e.stopPropagation(); tripMenu(b, b.dataset.more); });
    $('#newCard').onclick = () => tripSheet();
  },
  after() {
    $('#newTrip').onclick = () => tripSheet();
    $('#openFile').onclick = () => pickBundle();
  },
};

function greeting() {
  const h = new Date().getHours();
  const n = S.settings.me ? `, ${esc(S.settings.me)}` : '';
  return (h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + n;
}
function heroCard(t) {
  const full = S.heroTrip && S.heroTrip.id === t.id ? S.heroTrip : null;
  const ph = TL.phase(t);
  let next = '';
  if (full) {
    const n = TL.nextUp(full);
    if (n) next = `<div class="hero-next"><span class="tiny">${ph.kind === 'during' ? 'Next up' : 'First up'}</span><b>${esc(n.title)}</b><span>${esc(fmtDate(n.day))}${n.start ? ' · ' + esc(t12(n.start)) : ''}${n.place ? ' · ' + esc(n.place) : ''}</span></div>`;
  } else loadHero(t.id);
  const big = ph.kind === 'before' ? `<div class="hero-count"><b>${ph.days}</b><span>${ph.days === 1 ? 'day to go' : 'days to go'}</span></div>` : ph.kind === 'during' ? `<div class="hero-count"><b>${ph.day}</b><span>of ${ph.total} days</span></div>` : '';
  return `<div class="hero" data-trip="${t.id}" style="background:${coverCss(t.cover)}">
    <div class="hero-glow"></div>${routeArt('hero-route')}
    <div class="hero-main"><span class="hero-kicker">${esc(flagOf(t.country))} ${esc(t.destination || 'Somewhere new')}</span><h2>${esc(t.name)}</h2>
    <div class="hero-sub">${esc(fmtRange(t.start, t.end))}${t.travelers && t.travelers.length ? ' · ' + esc(t.travelers.join(', ')) : ''}</div>
    <div class="hero-stats"><span>${icon('timeline', 14)}${plural(t.counts.items, 'plan')}</span><span>${icon('ticket', 14)}${plural(t.counts.bookings, 'booking')}</span><span>${icon('passport', 14)}${plural(t.counts.docs, 'document')}</span></div></div>
    ${big}${next}
    <button class="icon-btn hero-more" data-more="${t.id}" title="More"><span data-icon="more" data-size="18"></span></button>
  </div>`;
}
async function loadHero(id) { try { S.heroTrip = await call('trip', id); if (S.view === 'trips') render(); } catch {} }
function tripCard(t) {
  return `<div class="trip-card" data-trip="${t.id}">
    <div class="tc-cover" style="background:${coverCss(t.cover)}"><span class="tc-flag">${esc(flagOf(t.country))}</span><span class="tc-phase">${esc(phaseText(t))}</span>
      <button class="icon-btn sm tc-more" data-more="${t.id}" title="More"><span data-icon="more" data-size="16"></span></button></div>
    <div class="tc-body"><b class="ellip">${esc(t.name)}</b><span class="ellip">${esc(t.destination || '—')}</span><span class="tc-dates">${esc(fmtRange(t.start, t.end))}</span>
    <div class="tc-counts"><span title="Plans">${icon('timeline', 13)}${t.counts.items}</span><span title="Bookings">${icon('ticket', 13)}${t.counts.bookings}</span><span title="Documents">${icon('passport', 13)}${t.counts.docs}</span></div></div>
  </div>`;
}
function tripMenu(anchor, id) {
  const t = S.trips.find(x => x.id === id); if (!t) return;
  menu(anchor, [
    { label: 'Open', icon: 'external', run: () => openTrip(id) },
    { label: 'Edit details…', icon: 'edit', run: async () => { await openTrip(id); tripSheet(S.trip); } },
    { label: 'Take it with you…', icon: 'qr', run: async () => { await openTrip(id); takeSheet(); } },
    { label: 'Duplicate', icon: 'dup', run: async () => { try { const n = await call('duplicate', id); await reloadTrips(); render(); toast('Duplicated', n.name); } catch (e) { fail(e); } } },
    { label: 'Show folder', icon: 'folder', run: () => call('openTripFolder', id) },
    '-',
    { label: 'Delete trip…', icon: 'trash', danger: true, run: () => deleteTrip(id) },
  ]);
}
async function deleteTrip(id) {
  const t = S.trips.find(x => x.id === id);
  if (!await confirmBox({ title: `Delete “${t.name}”?`, text: 'The trip folder and its documents go to the Trash, so you can still get them back from there.', ok: 'Delete', danger: true })) return;
  try { S.trips = await call('remove', id); if (S.trip && S.trip.id === id) S.trip = null; go('trips'); toast('Moved to the Trash', t.name); } catch (e) { fail(e); }
}

// a dotted route between two pins, used as decoration
function routeArt(cls = '') {
  return `<svg class="route-art ${cls}" viewBox="0 0 320 120" fill="none"><path d="M18 96 C 80 96, 70 30, 140 34 S 230 92, 300 26" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 10"/><circle cx="18" cy="96" r="7" fill="currentColor" opacity=".5"/><path d="M300 10c-7 0-12 5.3-12 11.6 0 8.6 12 20.4 12 20.4s12-11.8 12-20.4C312 15.3 307 10 300 10Z" fill="currentColor"/><circle cx="300" cy="21.5" r="4.2" fill="var(--pin-hole, #0003)"/></svg>`;
}

// ───────── new / edit trip
function tripSheet(trip) {
  const t = trip || { name: '', destination: '', country: '', tz: '', start: '', end: '', cover: 'sunset', currency: S.settings.currency || 'USD', travelers: S.settings.me ? [S.settings.me] : [] };
  const countries = PLACES.list();
  const el = openSheet(`<div class="sheet-head">${tile('a-sunset', trip ? 'edit' : 'compass', 'md', 18)}<div class="grow"><h3>${trip ? 'Trip details' : 'New trip'}</h3><div class="muted small">${trip ? 'Changes save as you go.' : 'You can change any of this later.'}</div></div></div>
    <div class="sheet-body">
      <div class="field"><label>Trip name</label><input class="input" name="name" value="${esc(t.name)}" placeholder="Summer in Lisbon" maxlength="80" autofocus></div>
      <div class="grid2">
        <div class="field"><label>Where</label><input class="input" name="destination" value="${esc(t.destination)}" placeholder="City, region or country"></div>
        <div class="field"><label>Country <span class="muted">(for key facts)</span></label><select class="select" name="country"><option value="">—</option>${countries.map(c => `<option value="${c.code}" ${c.code === t.country ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="XX" ${t.country === 'XX' ? 'selected' : ''}>Somewhere else</option></select></div>
      </div>
      <div class="grid2">
        <div class="field"><label>From</label><input class="input" type="date" name="start" value="${esc(t.start)}"></div>
        <div class="field"><label>To</label><input class="input" type="date" name="end" value="${esc(t.end)}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Time there <span class="muted">(times on the timeline are local)</span></label><select class="select" name="tz"><option value="">Same as this computer</option>${timeZones().map(z => `<option ${z === t.tz ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></div>
        <div class="field"><label>Budget currency</label><select class="select" name="currency">${PLACES.CURRENCIES.map(c => `<option ${c === t.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Who's going <span class="muted">(comma between names — used for splitting costs)</span></label><input class="input" name="travelers" value="${esc((t.travelers || []).join(', '))}" placeholder="Bilal, Kiana"></div>
      <div class="field"><label>Cover</label><div class="covers">${Object.keys(COVERS).map(k => `<button type="button" class="cover-pick ${k === t.cover ? 'on' : ''}" data-cover="${k}" style="background:${coverCss(k)}" title="${k}"></button>`).join('')}</div></div>
    </div>
    <div class="sheet-foot">${trip ? `<button class="btn ghost danger" id="del"><span data-icon="trash" data-size="15"></span>Delete</button>` : ''}<span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="ok">${trip ? 'Save' : 'Create trip'}</button></div>`, { width: 580 });
  let cover = t.cover;
  $$('.cover-pick', el).forEach(b => b.onclick = () => { cover = b.dataset.cover; $$('.cover-pick', el).forEach(x => x.classList.toggle('on', x === b)); });
  // picking a country fills in the time zone if it was empty
  el.querySelector('[name=country]').onchange = (e) => {
    const c = PLACES.get(e.target.value); const tz = el.querySelector('[name=tz]');
    if (c && !tz.value) tz.value = c.tz;
    const dest = el.querySelector('[name=destination]'); if (c && !dest.value) dest.value = c.name;
  };
  el.querySelector('[name=start]').onchange = (e) => { const end = el.querySelector('[name=end]'); if (!end.value || end.value < e.target.value) end.value = e.target.value; };
  el.querySelector('[data-x]').onclick = closeSheet;
  if (trip) el.querySelector('#del').onclick = () => { closeSheet(); deleteTrip(trip.id); };
  const ok = async () => {
    const f = formVals(el);
    if (!f.name) { el.querySelector('[name=name]').focus(); return; }
    if (f.end && f.start && f.end < f.start) f.end = f.start;
    const fields = { ...f, cover, travelers: f.travelers.split(',').map(x => x.trim()).filter(Boolean) };
    if (fields.country === 'XX') fields.country = '';
    const c = PLACES.get(fields.country); if (c) fields.localCurrency = c.currency;
    try {
      if (trip) {
        const moved = trip.start && fields.start && trip.start !== fields.start ? TL.daysBetween(trip.start, fields.start) : 0;
        Object.assign(S.trip, fields);
        if (moved && S.trip.items.length) shiftPrompt(moved);
        persist(true); closeSheet(); render();
      } else {
        const n = await call('create', fields);
        closeSheet(); await reloadTrips(); openTrip(n.id);
      }
    } catch (e) { fail(e); }
  };
  el.querySelector('#ok').onclick = ok;
  el.querySelector('[name=name]').addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
}
// trip dates moved: offer to move every plan, booking and expense with them
function shiftPrompt(days) {
  toast(`Dates moved ${Math.abs(days)} day${Math.abs(days) > 1 ? 's' : ''} ${days > 0 ? 'later' : 'earlier'}`, 'Move your plans and bookings with them?', 'info', 12000, [{ label: 'Move everything', run: () => {
    const t = S.trip, sh = (d) => d ? TL.addDays(d, days) : d;
    for (const i of t.items) i.day = sh(i.day);
    for (const b of t.bookings) { b.startDate = sh(b.startDate); b.endDate = sh(b.endDate); }
    for (const e of t.expenses) e.date = sh(e.date);
    S.day = sh(S.day);
    persist(true); render(); toast('Moved');
  } }]);
}

// ───────── .waypoint files
async function pickBundle() { const f = await call('pickBundle').catch(fail); if (f) bundleSheet(f); }
async function bundleSheet(file) {
  let p;
  try { p = await call('peekBundle', file); } catch (e) { return fail(e); }
  const el = openSheet(`<div class="sheet-head"><div class="bundle-cover" style="background:${coverCss(p.cover)}">${icon('suitcase', 22)}</div><div class="grow"><h3>${esc(p.name)}</h3><div class="muted small">${esc(p.destination || '')}${p.start ? ' · ' + esc(fmtRange(p.start, p.end)) : ''}</div></div></div>
    <div class="sheet-body">
      <div class="stat-row">${[['Plans', p.items], ['Bookings', p.bookings], ['Documents', p.docs], ['Size', human(p.bytes)]].map(([l, v]) => `<div><b>${esc(v)}</b><span>${l}</span></div>`).join('')}</div>
      ${p.exists ? `<div class="note-box ${p.newer ? 'ok' : 'warn'}">${icon(p.newer ? 'info' : 'alert', 16)}<div>You already have this trip. This copy is <b>${p.newer ? 'newer' : 'older or the same'}</b> than yours${p.exported ? ` (saved ${esc(new Date(p.exported).toLocaleString())})` : ''}.</div></div>` : ''}
      <div class="bar indet" id="prog" hidden><i></i></div>
    </div>
    <div class="sheet-foot"><span class="grow"></span><button class="btn" data-x>Cancel</button>${p.exists ? `<button class="btn" id="copy">Keep both</button><button class="btn primary" id="replace">Replace mine</button>` : `<button class="btn primary" id="copy">Add trip</button>`}</div>`, { width: 500 });
  el.querySelector('[data-x]').onclick = closeSheet;
  const run = async (mode) => {
    $$('.sheet-foot .btn', el).forEach(b => b.disabled = true); el.querySelector('#prog').hidden = false;
    S.importing = el;
    try { const t = await call('importBundle', file, mode); closeSheet(); await reloadTrips(); openTrip(t.id); toast(mode === 'replace' ? 'Trip updated' : 'Trip added', t.name); }
    catch (e) { closeSheet(); fail(e); }
    S.importing = null;
  };
  el.querySelector('#copy').onclick = () => run('copy');
  if (p.exists) el.querySelector('#replace').onclick = () => run('replace');
}
