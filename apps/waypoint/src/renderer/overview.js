// A trip at a glance: the cover, what's next, today's plans, what still needs doing, key facts and the hand-off.
'use strict';

VIEWS.overview = {
  head: () => `<h1>${esc(S.trip.name)}</h1>`,
  actions: () => `<button class="btn" id="ovEdit"><span data-icon="edit" data-size="15"></span>Details</button><button class="btn primary" id="ovTake"><span data-icon="qr" data-size="15"></span>Take it with you</button>`,
  render(v) {
    const t = S.trip;
    const ph = TL.phase(t);
    const days = TL.dayList(t.start, t.end);
    const b = TL.budget(t);
    const facts = { ...(PLACES.get(t.country) || {}), ...t.research.facts };
    const n = TL.nextUp(t);
    const focusDay = ph.kind === 'during' ? ph.today : days[0];
    const dayItems = focusDay ? TL.itemsOn(t, focusDay) : [];
    const checks = TL.checks(t);
    const pctUsed = b.planned ? Math.min(100, b.used / b.planned * 100) : 0;
    const local = t.tz ? TL.localNow(t.tz) : null;

    v.innerHTML = `
    <div class="ov-cover" style="background:${coverCss(t.cover)}">
      <div class="hero-glow"></div>${routeArt('hero-route')}
      <div class="hero-main"><span class="hero-kicker">${esc(flagOf(t.country))} ${esc(t.destination || 'Destination not set')}</span>
      <h2>${esc(fmtRange(t.start, t.end))}</h2>
      <div class="hero-sub">${days.length ? plural(days.length, 'day') + ' · ' : ''}${t.travelers.length ? esc(t.travelers.join(', ')) : 'Just you'}${local ? ` · ${esc(t12(TL.fromMin(local.min)))} there now` : ''}</div></div>
      <div class="hero-count">${ph.kind === 'before' ? `<b>${ph.days}</b><span>${ph.days === 1 ? 'day to go' : 'days to go'}</span>` : ph.kind === 'during' ? `<b>${ph.day}</b><span>of ${ph.total} days</span>` : ph.kind === 'after' ? `<b>${icon('check', 34)}</b><span>Trip complete</span>` : `<b>—</b><span>Set dates in Details</span>`}</div>
    </div>

    <div class="ov-grid">
      <div class="card ov-next">
        <div class="card-head"><b>${ph.kind === 'during' ? 'Next up' : 'First up'}</b><button class="link-btn" id="ovTl">Open timeline ${icon('chevron', 13)}</button></div>
        ${n ? `<div class="next-main">${tile(typeOf(n.type).tint, typeOf(n.type).icon, 'lg', 21)}<div class="grow" style="min-width:0"><b class="ellip">${esc(n.title)}</b>
          <span>${esc(fmtDate(n.day, { weekday: 'long', month: 'short', day: 'numeric' }))}${n.start ? ' · ' + esc(t12(n.start)) : ''}${n.end ? '–' + esc(t12(n.end)) : ''}</span>
          ${n.place ? `<span class="muted">${icon('pin', 12)} ${esc(n.place)}</span>` : ''}</div>${n.ref ? copyBtn(n.ref) : ''}</div>` : `<div class="muted small" style="padding:6px 0 4px">Nothing on the timeline yet. Add a plan or a booking and it shows up here.</div>`}
        ${focusDay ? `<div class="mini-day"><div class="md-head">${esc(ph.kind === 'during' ? 'Today' : 'Day 1')} · ${esc(fmtDate(focusDay, { weekday: 'long', month: 'short', day: 'numeric' }))}</div>
          ${dayItems.length ? dayItems.slice(0, 7).map(i => `<button class="md-row" data-item="${i.id}" data-day="${i.day}"><span class="md-t">${esc(i.start ? t12(i.start) : 'Any time')}</span><i class="${typeOf(i.type).tint}"></i><span class="ellip grow">${esc(i.title)}</span></button>`).join('') + (dayItems.length > 7 ? `<div class="muted tiny" style="padding:4px 0 0 66px">and ${dayItems.length - 7} more</div>` : '') : '<div class="muted small">A free day so far.</div>'}</div>` : ''}
      </div>

      <div class="ov-side">
        <div class="stat-tiles">
          <button class="stat-tile" data-go="timeline">${tile('a-gold', 'timeline', 'sm', 14)}<b>${t.items.length}</b><span>Plans</span></button>
          <button class="stat-tile" data-go="bookings">${tile('a-sky', 'ticket', 'sm', 14)}<b>${t.bookings.length}</b><span>Bookings</span></button>
          <button class="stat-tile" data-go="docs">${tile('a-violet', 'passport', 'sm', 14)}<b>${t.docs.length}</b><span>Documents</span></button>
          <button class="stat-tile" data-go="research">${tile('a-teal', 'pin', 'sm', 14)}<b>${t.research.places.filter(p => !p.visited).length}</b><span>Places to go</span></button>
        </div>
        <button class="card ov-money" data-go="budget">
          <div class="card-head"><b>Budget</b><span class="muted small">${b.planned ? `${Math.round(pctUsed)}% used` : 'No budget set'}</span></div>
          <div class="money-big">${esc(money(b.used))}<span>${b.planned ? ' of ' + esc(money(b.planned)) : ' booked and spent'}</span></div>
          ${b.planned ? `<div class="bar thick ${pctUsed > 100 ? 'over' : ''}"><i style="width:${pctUsed}%"></i></div><div class="row small" style="margin-top:7px"><span class="muted">${esc(money(b.booked))} booked · ${esc(money(b.spent))} spent</span><span class="grow"></span><b class="${b.left < 0 ? 'bad-t' : ''}">${esc(money(Math.abs(b.left)))} ${b.left < 0 ? 'over' : 'left'}</b></div>` : ''}
        </button>
      </div>

      <div class="card ov-checks">
        <div class="card-head"><b>Before you go</b><span class="muted small">${checks.length ? plural(checks.length, 'thing') + ' to look at' : 'All set'}</span></div>
        ${checks.length ? checks.slice(0, 6).map(c => `<button class="check-row" data-check="${c.kind}" data-id="${esc(c.id || '')}" data-day="${esc(c.day || '')}">${icon(c.kind === 'clash' ? 'alert' : c.kind === 'doc' || c.kind === 'passport' ? 'passport' : c.kind === 'stay' ? 'bed' : 'hash', 15)}<span class="grow">${esc(c.text.replace(/on (\d{4}-\d{2}-\d{2})/, (m, d) => 'on ' + fmtDate(d)))}</span>${icon('chevron', 13)}</button>`).join('') : `<div class="all-set">${icon('checkCircle', 18)}<span>Bookings have confirmation numbers, tickets are saved, and nothing overlaps.</span></div>`}
      </div>

      <div class="card ov-facts">
        <div class="card-head"><b>${esc(flagOf(t.country))} Key facts</b><button class="link-btn" data-go="research">Edit</button></div>
        ${factRows(facts, t)}
      </div>

      <div class="card ov-take">
        <div class="card-head"><b>Take it with you</b><span class="pill ok">${icon('wifiOff', 12)} Offline-ready</span></div>
        <div class="take-row">
          <button class="take-btn" id="tkPhone">${tile('a-sunset', 'qr', 'md', 17)}<b>To your phone</b><span>Scan a code on the same Wi-Fi</span></button>
          <button class="take-btn" id="tkPack">${tile('a-teal', 'wifiOff', 'md', 17)}<b>Offline pack</b><span>One page that works anywhere</span></button>
          <button class="take-btn" id="tkBeam">${tile('a-sky', 'beam', 'md', 17)}<b>Send with Beam</b><span>${S.beam ? 'To your other computer' : 'Install Beam to use'}</span></button>
          <button class="take-btn" id="tkPdf">${tile('a-violet', 'print', 'md', 17)}<b>PDF itinerary</b><span>To print or email</span></button>
        </div>
      </div>
    </div>`;
    $$('[data-go]', v).forEach(b => b.onclick = () => go(b.dataset.go));
    $$('.md-row', v).forEach(b => b.onclick = () => { S.sel = b.dataset.item; go('timeline', { day: b.dataset.day }); });
    $('#ovTl').onclick = () => go('timeline', { day: n ? n.day : focusDay });
    if (n) $('.next-main', v).onclick = (e) => { if (e.target.closest('[data-copy]')) return; S.sel = n.id; go('timeline', { day: n.day }); };
    $$('.check-row', v).forEach(b => b.onclick = () => {
      const k = b.dataset.check;
      if (k === 'clash') go('timeline', { day: b.dataset.day });
      else if (k === 'ref') { go('bookings'); bookingSheet(S.trip.bookings.find(x => x.id === b.dataset.id)); }
      else if (k === 'doc') { go('docs'); call('pickDocs', S.trip.id, { bookingId: b.dataset.id, tag: 'ticket' }).then(r => { if (r) { S.trip = r.trip; render(); toast('Added to the booking'); } }).catch(fail); }
      else if (k === 'passport') { go('docs'); call('pickDocs', S.trip.id, { tag: 'passport' }).then(r => { if (r) { S.trip = r.trip; render(); } }).catch(fail); }
      else if (k === 'stay') { go('bookings'); bookingSheet(null, 'stay'); }
    });
    $('#tkPhone').onclick = () => takeSheet('phone');
    $('#tkPack').onclick = () => takeSheet('pack');
    $('#tkBeam').onclick = () => S.beam ? sendWithBeam() : takeSheet('file');
    $('#tkPdf').onclick = () => savePdf();
  },
  after() {
    $('#ovEdit').onclick = () => tripSheet(S.trip);
    $('#ovTake').onclick = () => takeSheet();
  },
};

function factRows(f, t) {
  const rows = [
    ['phone', 'Emergency', f.emergency], ['wallet', 'Money', f.currency ? `${f.currency}${t.rates && t.rates[f.currency] ? ` · 1 ${f.currency} ≈ ${money(t.rates[f.currency], t.currency, 3)}` : ''}` : ''],
    ['plug', 'Plugs', f.plugs ? `Type ${f.plugs}${f.volts ? ' · ' + f.volts : ''}` : ''], ['car', 'Driving', f.drive ? `On the ${f.drive}` : ''],
    ['translate', 'Language', f.languages], ['hash', 'Dialling code', f.dial], ['clock', 'Time', t.tz ? tzLabel(t.tz) : ''], ['note', 'Also', f.extra],
  ].filter(r => r[2]);
  if (!rows.length) return `<div class="muted small">Pick a country in Details to see plugs, money, emergency numbers and more — or add your own in Research.</div>`;
  return `<div class="facts">${rows.map(([i, l, v]) => `<div class="fact">${icon(i, 15)}<span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div><div class="hint" style="margin-top:8px">Saved for offline use. Rules change — double-check before you go.</div>`;
}
