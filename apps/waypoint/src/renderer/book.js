// Book: search flights and stays for this trip and book them right here (Duffel for flights, LiteAPI for
// stays, once their keys are in Settings), or open Google Flights, Booking.com, Airbnb… inside Waypoint
// with the search filled in and save the confirmation back to the trip. Either way it lands in Bookings,
// on the timeline and in the budget, with the confirmation in Documents.
'use strict';

const BK = { tab: 'flights', state: null, offers: null, hotels: null, mode: null, sort: 'price', stops: 'any', busy: false, err: '', fq: null, sq: null, tripId: null };

async function bookState(force) { if (!BK.state || force) BK.state = await call('bookingState'); return BK.state; }
function defaultQueries() {
  const t = S.trip;
  if (BK.tripId === t.id && BK.fq) return;
  BK.tripId = t.id; BK.offers = null; BK.hotels = null; BK.err = '';
  const dest = AIRPORTS.guess(t.destination, t.country);
  const home = (BK.state && BK.state.homeAirport) || '';
  BK.fq = { from: home ? AIRPORTS.codeOf(home) : '', to: dest ? dest.code : '', depart: t.start || '', ret: t.end || '', oneway: false, adults: Math.max(1, t.travelers.length || 1), cabin: 'economy' };
  const city = String(t.destination || '').split(/[&,/]| and /)[0].trim() || (PLACES.get(t.country) || {}).name || '';
  BK.sq = { city, checkin: t.start || '', checkout: t.end || '', adults: Math.max(1, t.travelers.length || 2), rooms: 1 };
}

VIEWS.book = {
  head() {
    const st = BK.state || {};
    const m = BK.tab === 'flights' ? st.flights : st.stays;
    return `<h1>Book <small>${BK.tab === 'flights' ? 'Flights' : 'Stays'} for ${esc(S.trip.name)}</small></h1>${modePill(m)}`;
  },
  actions: () => `<div class="seg" id="bkTab"><button data-t="flights" class="${BK.tab === 'flights' ? 'on' : ''}">${icon('plane', 14)}Flights</button><button data-t="stays" class="${BK.tab === 'stays' ? 'on' : ''}">${icon('bed', 14)}Stays</button></div>`,
  render(v) {
    if (!BK.state) { v.innerHTML = '<div class="muted small">Loading…</div>'; bookState().then(() => { if (S.view === 'book') render(); }).catch(fail); return; }
    defaultQueries();
    v.innerHTML = BK.tab === 'flights' ? flightsHtml() : staysHtml();
    hydrateIcons(v);
    if (BK.tab === 'flights') wireFlights(v); else wireStays(v);
  },
  after() { $$('#bkTab button').forEach(b => b.onclick = () => { BK.tab = b.dataset.t; BK.err = ''; render(); }); },
};
function modePill(m) {
  if (m === 'live') return `<span class="pill ok mode-pill">${icon('bolt', 12)} Live booking</span>`;
  if (m === 'test') return `<span class="pill warn mode-pill">${icon('shield', 12)} Test mode — nothing is charged</span>`;
  if (m === 'demo') return `<span class="pill info mode-pill">${icon('sparkle', 12)} Sample results</span>`;
  return `<span class="pill mode-pill">${icon('globe', 12)} Booking sites</span>`;
}

// ───────── flights
function flightsHtml() {
  const q = BK.fq, st = BK.state, inApp = !!st.flights;
  let h = `<form class="card search-card" id="fForm" autocomplete="off">
    <div class="sf-row">
      <div class="field ap"><label>From</label><input class="input" name="from" value="${esc(apLabel(q.from))}" placeholder="City or airport" list="apList" data-ap></div>
      <button type="button" class="icon-btn swap" id="swap" title="Swap">${icon('refresh', 15)}</button>
      <div class="field ap"><label>To</label><input class="input" name="to" value="${esc(apLabel(q.to))}" placeholder="City or airport" list="apList" data-ap></div>
      <div class="field"><label>Depart</label><input class="input" type="date" name="depart" value="${esc(q.depart)}"></div>
      <div class="field"><label>Return ${q.oneway ? '' : ''}</label><input class="input" type="date" name="ret" value="${esc(q.oneway ? '' : q.ret)}" ${q.oneway ? 'disabled' : ''}></div>
      <div class="field sm"><label>Travelers</label><input class="input" type="number" min="1" max="9" name="adults" value="${q.adults}"></div>
      <div class="field"><label>Cabin</label><select class="select" name="cabin">${[['economy', 'Economy'], ['premium_economy', 'Premium'], ['business', 'Business'], ['first', 'First']].map(([k, l]) => `<option value="${k}" ${q.cabin === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <button class="btn primary lg sf-go" type="submit">${inApp ? `${icon('search', 16)}Search` : `${icon('external', 15)}Search Google Flights`}</button>
    </div>
    <div class="sf-foot"><label class="check-line"><input type="checkbox" id="oneway" ${q.oneway ? 'checked' : ''}> One way</label><span class="grow"></span><span class="muted small">Compare on</span>${st.sites.flights.map(s => `<button type="button" class="site-chip" data-site="${s.id}">${esc(s.name)}${icon('external', 11)}</button>`).join('')}</div>
    <datalist id="apList"></datalist>
  </form>`;
  if (!inApp) h += setupCard('flights');
  if (BK.err) h += `<div class="note-box warn" style="margin-top:14px">${icon('alert', 16)}<div>${esc(BK.err)}</div></div>`;
  if (BK.busy) h += `<div class="searching">${icon('plane', 22)}<b>Searching airlines…</b><span>This can take up to 20 seconds.</span><div class="bar indet" style="width:240px"><i></i></div></div>`;
  else if (BK.offers) h += offersHtml();
  return h;
}
function apLabel(code) { if (!code) return ''; const a = AIRPORTS.get(code); return a ? AIRPORTS.label(a) : code; }
function setupCard(kind) {
  const f = kind === 'flights';
  return `<div class="card setup-card">${tile('a-sky', f ? 'plane' : 'bed', 'lg', 20)}<div class="grow"><b>${f ? 'Book flights without leaving Waypoint' : 'Book hotels without leaving Waypoint'}</b>
    <span>${f ? 'Add a Duffel key in Settings and flight results show up right here, with tickets bought in one step and saved to the trip. Duffel’s test mode is free and instant; live booking needs a quick identity check and charges about $3 + 1% per order, paid from your Duffel balance.' : 'Add a LiteAPI key in Settings to search hotels here and book them in one step. The sandbox key is free; live bookings are charged to the card on your LiteAPI account.'}
    Until then, the search opens ${f ? 'Google Flights' : 'Booking.com'} inside Waypoint — book there and press <b>Save to trip</b>.</span></div><button class="btn" data-go-settings>Set up</button></div>`;
}
function offersHtml() {
  let list = BK.offers.slice();
  if (BK.stops !== 'any') list = list.filter(o => o.slices.every(s => s.stops <= Number(BK.stops)));
  const total = (o) => o.slices.reduce((a, s) => a + (s.minutes || 0), 0);
  if (BK.sort === 'price') list.sort((a, b) => a.price - b.price);
  else if (BK.sort === 'fast') list.sort((a, b) => total(a) - total(b));
  else list.sort((a, b) => a.slices[0].depart.localeCompare(b.slices[0].depart));
  const cheapest = Math.min(...BK.offers.map(o => o.price)), fastest = Math.min(...BK.offers.map(total));
  return `<div class="res-bar"><b>${plural(list.length, 'flight')}</b><span class="muted small">${BK.offers.length !== list.length ? `of ${BK.offers.length} · ` : ''}prices are for ${plural(BK.fq.adults, 'traveler')}, taxes included</span><span class="grow"></span>
    <div class="seg" id="fStops">${[['any', 'Any stops'], ['0', 'Nonstop'], ['1', '1 stop max']].map(([k, l]) => `<button data-k="${k}" class="${BK.stops === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="seg" id="fSort">${[['price', 'Cheapest'], ['fast', 'Fastest'], ['early', 'Earliest']].map(([k, l]) => `<button data-k="${k}" class="${BK.sort === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="offers">${list.length ? list.map(o => offerCard(o, o.price === cheapest, total(o) === fastest)).join('') : '<div class="muted small" style="padding:20px">No flights match — try allowing stops.</div>'}</div>`;
}
function hhmmOf(iso) { return t12(String(iso).slice(11, 16)); }
function dayDiff(a, b) { return TL.daysBetween(String(a).slice(0, 10), String(b).slice(0, 10)); }
function offerCard(o, cheap, fast) {
  const logo = o.airline.logo ? `<img src="${esc(o.airline.logo)}" alt="" data-fallback="${esc(o.airline.code || '✈')}">` : esc(o.airline.code || '✈');
  return `<div class="offer" data-offer="${o.id}">
    <div class="of-air"><span class="of-logo">${logo}</span><span class="ellip">${esc(o.airline.name)}</span></div>
    <div class="of-slices">${o.slices.map(s => { const d = dayDiff(s.depart, s.arrive); return `<div class="of-slice">
      <div class="of-t"><b>${esc(hhmmOf(s.depart))}</b><span>${esc(s.from.code)}</span></div>
      <div class="of-line"><span class="of-dur">${esc(s.minutes != null ? durTxt(s.minutes) : '')}</span><i>${s.segments.slice(1).map(() => '<em></em>').join('')}</i><span class="of-stops ${s.stops ? '' : 'non'}">${s.stops ? `${plural(s.stops, 'stop')} · ${esc(s.segments.slice(1).map(g => g.from.code).join(', '))}` : 'Nonstop'}</span></div>
      <div class="of-t"><b>${esc(hhmmOf(s.arrive))}${d > 0 ? `<sup>+${d}</sup>` : ''}</b><span>${esc(s.to.code)}</span></div>
      <div class="of-date">${esc(fmtDate(String(s.depart).slice(0, 10)))}</div></div>`; }).join('')}</div>
    <div class="of-tags">${cheap ? '<span class="pill ok">Cheapest</span>' : ''}${fast ? '<span class="pill info">Fastest</span>' : ''}${o.slices[0].bags ? `<span class="pill">${icon('suitcase', 11)} ${esc(o.slices[0].bags)}</span>` : ''}${o.refundable ? '<span class="pill">Refundable</span>' : ''}${o.changeable ? '<span class="pill">Changes OK</span>' : ''}</div>
    <div class="of-price"><b>${esc(money(o.price, o.currency))}</b><span>${o.passengerIds.length > 1 ? `${esc(money(o.price / o.passengerIds.length, o.currency))} each` : 'total'}</span><button class="btn primary sm">Select</button></div>
  </div>`;
}
function readFlightForm() {
  const f = $('#fForm'); const v = formVals(f);
  BK.fq = { ...BK.fq, from: AIRPORTS.codeOf(v.from) || (v.from || '').toUpperCase().slice(0, 3), to: AIRPORTS.codeOf(v.to) || (v.to || '').toUpperCase().slice(0, 3), depart: v.depart, ret: BK.fq.oneway ? '' : v.ret, adults: Math.max(1, Math.min(9, Number(v.adults) || 1)), cabin: v.cabin };
  return BK.fq;
}
function wireFlights(v) {
  const f = $('#fForm', v);
  // airport suggestions as you type
  let t = null;
  $$('[data-ap]', f).forEach(inp => inp.addEventListener('input', () => {
    clearTimeout(t); const q = inp.value; if (q.length < 2 || /\([A-Z]{3}\)$/.test(q)) return;
    t = setTimeout(async () => { const list = await call('airports', q).catch(() => []); $('#apList').innerHTML = list.map(a => `<option value="${esc(`${a.city} (${a.code})`)}">${esc(a.name)}</option>`).join(''); }, 160);
  }));
  $('#swap', f).onclick = () => { readFlightForm(); BK.fq = { ...BK.fq, from: BK.fq.to, to: BK.fq.from }; render(); };
  $('#oneway', f).onchange = (e) => { readFlightForm(); BK.fq.oneway = e.target.checked; render(); };
  f.onsubmit = async (e) => {
    e.preventDefault(); const q = readFlightForm();
    if (!BK.state.flights) return openSiteFor('flights', 'google');
    BK.busy = true; BK.err = ''; BK.offers = null; render();
    try { const r = await call('searchFlights', { from: q.from, to: q.to, depart: q.depart, ret: q.oneway ? '' : q.ret, adults: q.adults, cabin: q.cabin }); BK.offers = r.offers; BK.mode = r.mode; if (!r.offers.length) BK.err = 'No flights found for those dates. Try nearby dates or another airport.'; }
    catch (err) { BK.err = err.message; }
    BK.busy = false; if (S.view === 'book') render();
  };
  $$('.site-chip', f).forEach(b => b.onclick = () => { readFlightForm(); openSiteFor('flights', b.dataset.site); });
  $$('[data-go-settings]', v).forEach(b => b.onclick = () => { S.setFocus = 'booking'; go('settings'); });
  $$('#fStops button').forEach(b => b.onclick = () => { BK.stops = b.dataset.k; render(); });
  $$('#fSort button').forEach(b => b.onclick = () => { BK.sort = b.dataset.k; render(); });
  $$('img[data-fallback]', v).forEach(img => img.addEventListener('error', () => img.replaceWith(document.createTextNode(img.dataset.fallback))));
  $$('.offer', v).forEach(c => c.onclick = () => flightCheckout(BK.offers.find(o => o.id === c.dataset.offer)));
}
function openSiteFor(kind, site) {
  const q = kind === 'flights' ? BK.fq : BK.sq;
  if (kind === 'flights' && (!q.from || !q.to || !q.depart)) return toast('Fill in where from, where to and when', '', 'info');
  if (kind === 'stays' && (!q.city || !q.checkin || !q.checkout)) return toast('Fill in the city and dates', '', 'info');
  const qq = kind === 'flights' ? { from: q.from, to: q.to, depart: q.depart, ret: q.oneway ? '' : q.ret, adults: q.adults } : { city: q.city, checkin: q.checkin, checkout: q.checkout, adults: q.adults, rooms: q.rooms };
  call('openSite', kind, site, qq, S.trip.id).catch(fail);
}

// traveler fields, filled from a saved profile
function travelerFields(i, p, saved, minimal) {
  return `<div class="pax" data-pax="${i}">
    <div class="pax-head"><b>${minimal ? 'Lead guest' : `Traveler ${i + 1}`}</b>${saved.length ? `<select class="select sm-sel" data-pick="${i}"><option value="">Fill from saved…</option>${saved.map(s => `<option value="${s.id}" ${p.id === s.id ? 'selected' : ''}>${esc(`${s.given} ${s.family}`)}</option>`).join('')}</select>` : ''}</div>
    <div class="grid2"><div class="field"><label>First and middle names <span class="muted">(as on ${minimal ? 'ID' : 'passport'})</span></label><input class="input" name="given" value="${esc(p.given || '')}"></div><div class="field"><label>Last name</label><input class="input" name="family" value="${esc(p.family || '')}"></div></div>
    ${minimal ? `<div class="grid2"><div class="field"><label>Email</label><input class="input" type="email" name="email" value="${esc(p.email || '')}"></div><div class="field"><label>Phone</label><input class="input" name="phone" value="${esc(p.phone || '')}" placeholder="+1 713 555 0100"></div></div>` :
    `<div class="grid4b"><div class="field"><label>Date of birth</label><input class="input" type="date" name="born" value="${esc(p.born || '')}"></div><div class="field"><label>Gender on passport</label><select class="select" name="gender"><option value="m" ${p.gender !== 'f' ? 'selected' : ''}>Male</option><option value="f" ${p.gender === 'f' ? 'selected' : ''}>Female</option></select></div>
      <div class="field"><label>Email</label><input class="input" type="email" name="email" value="${esc(p.email || '')}"></div><div class="field"><label>Phone</label><input class="input" name="phone" value="${esc(p.phone || '')}" placeholder="+1 713 555 0100"></div></div>`}
  </div>`;
}
function readTravelers(el) {
  return $$('.pax', el).map(px => { const v = formVals(px); v.phone = (v.phone || '').replace(/[^\d+]/g, ''); if (v.phone && !v.phone.startsWith('+')) v.phone = '+1' + v.phone; return v; });
}
function prefillTravelers(n) {
  const saved = BK.state.travelers || [];
  const names = S.trip.travelers.map(x => x.toLowerCase());
  const pick = names.map(nm => saved.find(s => `${s.given} ${s.family}`.toLowerCase().startsWith(nm) || s.given.toLowerCase() === nm)).filter(Boolean);
  for (const s of saved) if (!pick.includes(s)) pick.push(s);
  return Array.from({ length: n }, (_, i) => pick[i] ? { ...pick[i] } : {});
}
function wirePicks(el) {
  $$('[data-pick]', el).forEach(sel => sel.onchange = () => {
    const s = (BK.state.travelers || []).find(x => x.id === sel.value); if (!s) return;
    const box = sel.closest('.pax');
    for (const k of ['given', 'family', 'born', 'gender', 'email', 'phone']) { const f = box.querySelector(`[name=${k}]`); if (f) f.value = s[k] || (k === 'gender' ? 'm' : ''); }
  });
}
function liveConfirm(mode, what) {
  if (mode === 'live') return `<div class="note-box warn">${icon('bolt', 16)}<div><b>This is a real booking.</b> ${esc(what)}</div></div><label class="check-line"><input type="checkbox" id="agree"> I've checked the names match the ${what.includes('ticket') ? 'passports' : 'IDs'} and the dates are right</label>`;
  return `<div class="note-box">${icon('shield', 16)}<div><b>${mode === 'demo' ? 'Sample booking' : 'Test mode'}.</b> Nothing is charged and no ${what.includes('ticket') ? 'ticket is issued' : 'room is held'} — it saves to the trip like a real one so you can try the whole flow.</div></div>`;
}

function flightCheckout(o) {
  const mode = BK.mode || BK.state.flights;
  const pax = prefillTravelers(o.passengerIds.length);
  const saved = BK.state.travelers || [];
  const el = openSheet(`<div class="sheet-head">${tile('a-sky', 'plane', 'md', 18)}<div class="grow"><h3>${esc(o.slices.map(s => `${s.from.city || s.from.code} → ${s.to.city || s.to.code}`).join(' · '))}</h3><div class="muted small">${esc(o.airline.name)} · ${plural(o.passengerIds.length, 'traveler')}</div></div>${modePill(mode)}</div>
    <div class="sheet-body">
      <div class="co-slices">${o.slices.map((s, i) => `<div class="co-slice"><div class="co-lab">${i === 0 ? 'Outbound' : 'Return'} · ${esc(fmtDate(String(s.depart).slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' }))}</div>${s.segments.map(g => `<div class="co-seg"><b>${esc(hhmmOf(g.depart))}</b> ${esc(g.from.code)} → <b>${esc(hhmmOf(g.arrive))}</b> ${esc(g.to.code)}<span class="muted"> · ${esc(g.flight)}${g.aircraft ? ' · ' + esc(g.aircraft) : ''}${g.cabin ? ' · ' + esc(g.cabin) : ''}</span></div>`).join('')}<div class="muted tiny">${esc(s.minutes != null ? durTxt(s.minutes) : '')}${s.bags ? ' · Bags: ' + esc(s.bags) : ''}</div></div>`).join('')}</div>
      <div class="row small" style="gap:6px;flex-wrap:wrap">${o.refundable ? '<span class="pill ok">Refundable</span>' : '<span class="pill">Non-refundable</span>'}${o.changeable ? '<span class="pill ok">Changes allowed</span>' : '<span class="pill">No changes</span>'}${o.expires ? `<span class="muted tiny">Price held until ${esc(new Date(o.expires).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</span>` : ''}</div>
      ${pax.map((p, i) => travelerFields(i, p, saved)).join('')}
      <label class="check-line"><input type="checkbox" id="remember" checked> Save these travelers on this computer for next time</label>
      ${liveConfirm(mode, 'The ticket is bought from your Duffel balance and issued by the airline.')}
    </div>
    <div class="sheet-foot"><div class="co-total"><span>Total</span><b>${esc(money(o.price, o.currency))}</b></div><span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="buy">${icon('check', 15)}Book for ${esc(money(o.price, o.currency))}</button></div>`, { width: 720, cls: 'sticky' });
  wirePicks(el);
  el.querySelector('[data-x]').onclick = closeSheet;
  el.querySelector('#buy').onclick = async () => {
    const travelers = readTravelers(el);
    if (mode === 'live' && !el.querySelector('#agree').checked) return toast('Tick the box to confirm the names and dates', '', 'info');
    const btn = el.querySelector('#buy'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Booking…';
    try {
      await flush();
      if (el.querySelector('#remember').checked) for (const p of travelers) if (p.given && p.family) { const ex = (BK.state.travelers || []).find(s => s.given === p.given && s.family === p.family); BK.state.travelers = await call('saveTraveler', { ...p, id: ex ? ex.id : '' }); }
      const r = await call('bookFlight', { tripId: S.trip.id, offerId: o.id, passengers: travelers });
      S.trip = r.trip; S.sel = null;
      bookedSheet('Flight booked', r, 'flight');
    } catch (e) {
      btn.disabled = false; btn.innerHTML = `${icon('check', 15)}Book for ${esc(money(o.price, o.currency))}`;
      if (/price changed/i.test(e.message)) toast('The price changed', e.message, 'info', 10000); else fail(e);
    }
  };
}
function bookedSheet(title, r, kind) {
  const bk = S.trip.bookings.find(b => b.id === r.bookings[0]);
  updateSummary(S.trip);
  const el = openSheet(`<div class="sheet-body ask booked">
      <div class="booked-tick">${icon('check', 34)}</div><h3>${esc(title)}</h3>
      <div class="ask-what">${esc(bk ? bk.title : '')}</div>
      <div class="booked-ref"><span>Confirmation</span>${r.refs.map(x => copyBtn(x)).join('')}</div>
      ${r.mode !== 'live' ? `<div class="pill warn">${r.mode === 'demo' ? 'Sample booking' : 'Test booking'} — nothing was charged</div>` : ''}
      <div class="muted small">Added to Bookings, the timeline and the budget. The confirmation is saved in Documents, so it's there offline.</div>
    </div>
    <div class="sheet-foot"><button class="btn" id="bkMore">Book something else</button><span class="grow"></span><button class="btn" id="bkList">See in Bookings</button><button class="btn primary" id="bkTl">Show on timeline</button></div>`, { width: 500 });
  el.querySelector('#bkMore').onclick = () => { closeSheet(); render(); };
  const t = S.trip, outs = r.bookings.map(id => t.bookings.find(b => b.id === id)).filter(b => b && b.startDate && t.start && (b.startDate < t.start || (b.endDate || b.startDate) > t.end));
  if (outs.length) toast('Part of this booking is outside the trip dates', 'Stretch the trip so it shows on the timeline?', 'info', 12000, [{ label: 'Stretch the trip', run: () => { for (const b of outs) { t.start = [t.start, b.startDate].sort()[0]; t.end = [t.end, b.endDate || b.startDate].sort().pop(); } persist(true); render(); } }]);
  el.querySelector('#bkList').onclick = () => { closeSheet(); go('bookings'); };
  el.querySelector('#bkTl').onclick = () => { closeSheet(); const it = S.trip.items.find(i => i.bookingId === r.bookings[0]); S.sel = it && it.id; go('timeline', { day: bk ? bk.startDate : null }); };
}

// ───────── stays
function staysHtml() {
  const q = BK.sq, st = BK.state, inApp = !!st.stays;
  let h = `<form class="card search-card" id="sForm" autocomplete="off">
    <div class="sf-row">
      <div class="field ap wide"><label>Where</label><input class="input" name="city" value="${esc(q.city)}" placeholder="City"></div>
      <div class="field"><label>Check in</label><input class="input" type="date" name="checkin" value="${esc(q.checkin)}"></div>
      <div class="field"><label>Check out</label><input class="input" type="date" name="checkout" value="${esc(q.checkout)}"></div>
      <div class="field sm"><label>Guests</label><input class="input" type="number" min="1" max="12" name="adults" value="${q.adults}"></div>
      <div class="field sm"><label>Rooms</label><input class="input" type="number" min="1" max="6" name="rooms" value="${q.rooms}"></div>
      <button class="btn primary lg sf-go" type="submit">${inApp ? `${icon('search', 16)}Search` : `${icon('external', 15)}Search Booking.com`}</button>
    </div>
    <div class="sf-foot">${q.checkin && q.checkout && q.checkout > q.checkin ? `<span class="muted small">${plural(TL.daysBetween(q.checkin, q.checkout), 'night')}${S.trip.country ? ' · ' + esc((PLACES.get(S.trip.country) || {}).name || '') : ''}</span>` : ''}<span class="grow"></span><span class="muted small">Compare on</span>${st.sites.stays.map(s => `<button type="button" class="site-chip" data-site="${s.id}">${esc(s.name)}${icon('external', 11)}</button>`).join('')}</div>
  </form>`;
  if (!inApp) h += setupCard('stays');
  if (BK.err) h += `<div class="note-box warn" style="margin-top:14px">${icon('alert', 16)}<div>${esc(BK.err)}</div></div>`;
  if (BK.busy) h += `<div class="searching">${icon('bed', 22)}<b>Finding places to stay…</b><span>Checking live prices and rooms.</span><div class="bar indet" style="width:240px"><i></i></div></div>`;
  else if (BK.hotels) h += `<div class="res-bar"><b>${plural(BK.hotels.length, 'place')}</b><span class="muted small">total for ${plural(BK.hotels[0] ? BK.hotels[0].nights : 0, 'night')}, taxes included where the hotel says so</span></div><div class="hotels">${BK.hotels.map(hotelCard).join('')}</div>`;
  return h;
}
function stars(n) { n = Math.round(Number(n) || 0); return n ? `<span class="stars">${'★'.repeat(Math.min(5, n))}</span>` : ''; }
function hotelCard(hh) {
  const r0 = hh.rooms[0];
  return `<button class="hotel" data-hotel="${esc(hh.hotelId)}">
    <div class="ht-photo" ${hh.photo ? `style="background-image:url('${esc(hh.photo)}')"` : ''}>${hh.photo ? '' : icon('bed', 30)}${hh.rating ? `<span class="ht-score">${esc(Number(hh.rating).toFixed(1))}</span>` : ''}</div>
    <div class="ht-body"><b class="ellip">${esc(hh.name)}</b><span class="ellip muted small">${stars(hh.stars)} ${esc(hh.address || '')}</span>
      <div class="ht-foot"><div><b>${esc(money(hh.from, hh.currency))}</b><span>${esc(money(r0.perNight, hh.currency))} a night</span></div>${r0.refundable ? '<span class="pill ok">Free cancellation</span>' : ''}</div></div>
  </button>`;
}
function readStayForm() { const v = formVals($('#sForm')); BK.sq = { city: v.city, checkin: v.checkin, checkout: v.checkout, adults: Math.max(1, Number(v.adults) || 1), rooms: Math.max(1, Number(v.rooms) || 1) }; return BK.sq; }
function wireStays(v) {
  const f = $('#sForm', v);
  f.onsubmit = async (e) => {
    e.preventDefault(); const q = readStayForm();
    if (!BK.state.stays) return openSiteFor('stays', 'booking');
    BK.busy = true; BK.err = ''; BK.hotels = null; render();
    try { const r = await call('searchStays', { ...q, country: S.trip.country, currency: S.trip.currency || 'USD' }); BK.hotels = r.hotels; BK.mode = r.mode; if (!r.hotels.length) BK.err = 'Nothing available for those dates. Try other dates or a nearby city.'; }
    catch (err) { BK.err = err.message; }
    BK.busy = false; if (S.view === 'book') render();
  };
  f.addEventListener('change', (e) => { if (e.target.name === 'checkin' || e.target.name === 'checkout') { readStayForm(); render(); } });
  $$('.site-chip', f).forEach(b => b.onclick = () => { readStayForm(); openSiteFor('stays', b.dataset.site); });
  $$('[data-go-settings]', v).forEach(b => b.onclick = () => { S.setFocus = 'booking'; go('settings'); });
  $$('.hotel', v).forEach(c => c.onclick = () => hotelSheet(BK.hotels.find(h => h.hotelId === c.dataset.hotel)));
}
function hotelSheet(hh) {
  const el = openSheet(`<div class="ht-hero" ${hh.photo ? `style="background-image:url('${esc(hh.photo)}')"` : ''}><button class="icon-btn sm" data-x>${icon('x', 16)}</button></div>
    <div class="sheet-head" style="padding-top:16px"><div class="grow"><h3>${esc(hh.name)}</h3><div class="muted small">${stars(hh.stars)} ${esc(hh.address || '')}${hh.rating ? ` · rated ${esc(Number(hh.rating).toFixed(1))}` : ''}</div></div></div>
    <div class="sheet-body"><div class="rooms">${hh.rooms.map(r => `<div class="room"><div class="grow" style="min-width:0"><b>${esc(r.name)}</b><span>${esc([r.board, r.sleeps ? `sleeps ${r.sleeps}` : ''].filter(Boolean).join(' · '))}</span>
      <span class="${r.refundable ? 'ok-t' : 'muted'}">${r.refundable ? `Free cancellation${r.cancelUntil ? ' until ' + esc(fmtDate(r.cancelUntil.slice(0, 10))) : ''}` : 'Non-refundable'}</span></div>
      <div class="room-price"><b>${esc(money(r.price, r.currency))}</b><span>${esc(money(r.perNight, r.currency))} a night</span></div><button class="btn primary sm" data-room="${esc(r.offerId)}">Book</button></div>`).join('')}</div></div>`, { width: 640 });
  el.querySelector('[data-x]').onclick = closeSheet;
  $$('[data-room]', el).forEach(b => b.onclick = () => stayCheckout(hh, hh.rooms.find(r => r.offerId === b.dataset.room)));
}
async function stayCheckout(hh, room) {
  const mode = BK.mode || BK.state.stays;
  const saved = BK.state.travelers || [];
  const el = openSheet(`<div class="sheet-head">${tile('a-violet', 'bed', 'md', 18)}<div class="grow"><h3>${esc(hh.name)}</h3><div class="muted small">${esc(room.name)} · ${esc(fmtDate(BK.sq.checkin))} → ${esc(fmtDate(BK.sq.checkout))} · ${plural(hh.nights, 'night')}</div></div>${modePill(mode)}</div>
    <div class="sheet-body"><div id="pre" class="note-box">${'<span class="spin"></span>'}<div>Checking the price and holding the room…</div></div>
      ${travelerFields(0, prefillTravelers(1)[0], saved, true)}
      ${liveConfirm(mode, 'It’s charged to the card saved in your LiteAPI account and the hotel gets your reservation.')}
    </div>
    <div class="sheet-foot"><div class="co-total"><span>Total</span><b id="coTotal">${esc(money(room.price, room.currency))}</b></div><span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="buy" disabled>${icon('check', 15)}Book</button></div>`, { width: 620, cls: 'sticky' });
  wirePicks(el);
  el.querySelector('[data-x]').onclick = closeSheet;
  let pre = null;
  try {
    pre = await call('prebookStay', room.offerId);
    const changed = pre.price && Math.abs(pre.price - room.price) > 0.5;
    $('#pre', el).className = 'note-box ' + (changed ? 'warn' : 'ok');
    $('#pre', el).innerHTML = `${icon(changed ? 'alert' : 'check', 16)}<div>${changed ? `The price is now <b>${esc(money(pre.price, pre.currency))}</b> (was ${esc(money(room.price, room.currency))}).` : `Price confirmed: <b>${esc(money(pre.price || room.price, pre.currency || room.currency))}</b>.`} ${room.refundable ? 'Free cancellation.' : 'Non-refundable.'}</div>`;
    $('#coTotal', el).textContent = money(pre.price || room.price, pre.currency || room.currency);
    const b = $('#buy', el); b.disabled = false; b.innerHTML = `${icon('check', 15)}Book for ${esc(money(pre.price || room.price, pre.currency || room.currency))}`;
  } catch (e) { $('#pre', el).className = 'note-box warn'; $('#pre', el).innerHTML = `${icon('alert', 16)}<div>${esc(e.message)}</div>`; return; }
  $('#buy', el).onclick = async () => {
    const [holder] = readTravelers(el);
    if (mode === 'live' && !el.querySelector('#agree').checked) return toast('Tick the box to confirm the names and dates', '', 'info');
    const btn = $('#buy', el); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Booking…';
    try {
      await flush();
      const r = await call('bookStay', { tripId: S.trip.id, offerId: room.offerId, prebookId: pre.prebookId, holder, guests: [holder], q: BK.sq });
      S.trip = r.trip;
      bookedSheet('Stay booked', r, 'stay');
    } catch (e) { btn.disabled = false; btn.innerHTML = `${icon('check', 15)}Book`; fail(e); }
  };
}

// ───────── a confirmation saved from a booking site → a booking, filled in
async function captured(c) {
  try {
    if (!S.trip || S.trip.id !== c.tripId) { await flush(); await openTrip(c.tripId, 'bookings'); } else { await flush(); S.trip = await call('trip', c.tripId); }
    const g = c.guess || {}, q = c.q || {};
    const type = g.kind === 'stay' || c.kind === 'stays' ? 'stay' : g.kind === 'car' ? 'car' : g.kind === 'tour' ? 'tour' : 'flight';
    const pre = type === 'flight' ? { from: q.from || '', to: q.to || '', startDate: q.depart || '', endDate: q.depart || '', title: q.from && q.to ? `${apLabel(q.from)} → ${apLabel(q.to)}` : '' }
      : type === 'stay' ? { startDate: q.checkin || '', endDate: q.checkout || '', title: g.title || '' } : {};
    go('bookings');
    bookingSheet(null, type, { ...pre, provider: g.provider || '', ref: g.ref || '', cost: g.total || '', currency: g.currency || S.trip.currency, paid: !!g.total, docs: c.docId ? [c.docId] : [], notes: c.url ? `Booked at ${c.url.split('?')[0]}` : '' });
    toast('Confirmation saved to Documents', 'Check the details Waypoint found, then save the booking.', 'ok', 7000);
  } catch (e) { fail(e); }
}
