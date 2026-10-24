// Settings: look, clock, home currency, where trips are kept, the offline pack and what Waypoint is.
'use strict';

VIEWS.settings = {
  title: 'Settings',
  render(v) {
    const st = S.settings;
    const row = (title, sub, ctl) => `<div class="set-row"><div class="grow"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</div>${ctl}</div>`;
    const keyRow = (svc, title, sub, signup) => { const m = BK.state ? BK.state[svc === 'duffel' ? 'flights' : 'stays'] : null; return row(title, `${sub} <button class="link-btn" data-url="${signup}">Get a key</button>`, `<div class="row" style="gap:6px">${m && m !== 'demo' ? `<span class="pill ${m === 'live' ? 'ok' : 'warn'}">${m === 'live' ? 'Live' : 'Test mode'}</span>` : '<span class="pill">Off</span>'}<input class="input" type="password" data-key="${svc}" placeholder="${m && m !== 'demo' ? '••••••••  (saved)' : 'Paste key'}" style="width:190px"><button class="btn sm" data-test="${svc}" ${m && m !== 'demo' ? '' : 'disabled'}>Test</button>${m && m !== 'demo' ? `<button class="icon-btn sm" data-clear="${svc}" title="Remove key">${icon('trash', 14)}</button>` : ''}</div>`); };
    const seg = (key, opts) => `<div class="seg" data-set="${key}">${opts.map(([k, l]) => `<button data-v="${k}" class="${String(st[key]) === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    v.innerHTML = `<div class="set-wrap">
      <div class="section-title">You</div>
      <div class="card set-card">
        ${row('Your name', 'Used for greetings and as the first traveler on new trips', `<input class="input" id="sMe" value="${esc(st.me || '')}" placeholder="${esc(S.user || '')}" style="width:220px">`)}
        ${row('Home currency', 'New trips budget in this currency', `<select class="select" id="sCur" style="width:120px">${PLACES.CURRENCIES.map(c => `<option ${c === st.currency ? 'selected' : ''}>${c}</option>`).join('')}</select>`)}
      </div>
      <div class="section-title">Look</div>
      <div class="card set-card">
        ${row('Appearance', '', seg('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]))}
        ${row('Clock', 'How times show on timelines', seg('clock', [['auto', 'Automatic'], ['12', '12-hour'], ['24', '24-hour']]))}
      </div>
      <div class="section-title">Trips folder</div>
      <div class="card set-card">
        ${row('Where trips are kept', `<span class="mono">${esc(S.dataDir)}</span>`, `<div class="row" style="gap:6px"><button class="btn sm" id="sOpen">Show</button><button class="btn sm" id="sMove">Change…</button></div>`)}
        <div class="set-note">${icon('wifiOff', 15)}<span>Each trip is a folder with <span class="mono">trip.json</span> and a <span class="mono">Documents</span> folder. Nothing goes online, so everything works without a connection — and a folder you back up or sync (iCloud Drive, OneDrive, Dropbox) backs up your trips too.</span></div>
      </div>
      <div class="section-title" id="setBooking">Booking</div>
      <div class="card set-card">
        ${keyRow('duffel', 'Flights · Duffel', 'Search every airline Duffel carries and buy tickets here, paid from your Duffel balance. Test keys start with duffel_test_.', 'https://app.duffel.com/join')}
        ${keyRow('liteapi', 'Stays · LiteAPI', 'Search hotels by city and book them here, charged to the card on your LiteAPI account. Sandbox keys start with sand_.', 'https://dashboard.liteapi.travel/register')}
        ${row('Home airport', 'Where flight searches start from', `<input class="input" id="sHome" value="${esc(BK.state ? BK.state.homeAirport || '' : '')}" placeholder="IAH" list="homeList" style="width:220px"><datalist id="homeList">${AIRPORTS.LIST.map(a => `<option value="${esc(AIRPORTS.label(a))}">`).join('')}</datalist>`)}
        ${row('Nationality for hotel prices', 'Some hotels price by guest nationality', `<select class="select" id="sNat" style="width:220px">${PLACES.list().map(c => `<option value="${c.code}" ${c.code === ((BK.state && BK.state.nationality) || 'US') ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`)}
        <div class="set-note">${icon('lock', 15)}<span>Keys and traveler details are ${BK.state && BK.state.encrypted ? `encrypted with ${W.platform === 'darwin' ? 'your Mac’s Keychain' : W.platform === 'win32' ? 'Windows data protection' : 'the system keyring'}` : 'kept'} in Waypoint’s own folder on this computer — never in trip folders, offline packs or .waypoint files — and only go to the booking service when you search or book.</span></div>
      </div>
      <div class="section-title">Travelers <span class="muted small" style="font-weight:500">fill in bookings in one click</span></div>
      <div class="card set-card">
        ${(BK.state ? BK.state.travelers : []).map(tr => `<div class="set-row">${tile('a-sunset', 'user', 'sm', 13)}<div class="grow"><b>${esc(`${tr.given} ${tr.family}`)}</b><span>${esc([tr.born ? 'Born ' + fmtDate(tr.born, { month: 'short', day: 'numeric', year: 'numeric' }) : '', tr.email, tr.phone].filter(Boolean).join(' · '))}</span></div><button class="btn sm" data-trav="${tr.id}">Edit</button></div>`).join('')}
        <div class="set-row"><div class="grow"><span>Names as on passports, date of birth and contact details — what airlines and hotels ask for.</span></div><button class="btn sm" data-trav="">${icon('plus', 13)}Add traveler</button></div>
      </div>
      <div class="section-title">Taking trips with you</div>
      <div class="card set-card">
        ${row('Put documents inside the offline pack', 'Bigger file, but tickets and passport copies open on the phone with no signal', `<button class="switch ${st.embedDocs !== false ? 'on' : ''}" id="sEmbed"></button>`)}
        ${row('Beam', S.beam ? 'Installed — “Send with Beam” hands trips straight to it' : 'Not installed. Get it from Utility Hub to send trips to your other computers in one click', S.beam ? `<span class="pill ok">${icon('check', 12)} Ready</span>` : `<span class="pill">Not installed</span>`)}
      </div>
      <div class="about">${'<img src="../../build/icon.png" alt="">'}<div><b>Waypoint ${esc(S.version || '')}</b><span>Part of the Utility Suite · updates come through Utility Hub</span></div></div>
    </div>`;
    $$('[data-set]', v).forEach(s => $$('button', s).forEach(b => b.onclick = () => setSettings({ [s.dataset.set]: b.dataset.v }).then(applyTheme)));
    $('#sMe').onchange = (e) => setSettings({ me: e.target.value.trim() }, true);
    $('#sCur').onchange = (e) => setSettings({ currency: e.target.value }, true);
    $('#sEmbed').onclick = () => setSettings({ embedDocs: !(st.embedDocs !== false) });
    $('#sOpen').onclick = () => call('openDataDir');
    if (!BK.state) bookState().then(() => { if (S.view === 'settings') render(); }).catch(() => {});
    $$('[data-key]', v).forEach(i => i.onchange = async () => { if (!i.value.trim()) return; try { BK.state = await call('setKey', i.dataset.key, i.value.trim()); BK.offers = null; BK.hotels = null; render(); const mode = await call('testKey', i.dataset.key); toast('Key saved and working', mode === 'live' ? 'Live mode — bookings are real.' : 'Test mode — nothing is charged.'); } catch (e) { fail(e); } });
    $$('[data-test]', v).forEach(b => b.onclick = async () => { b.disabled = true; try { const m = await call('testKey', b.dataset.test); toast('Connected', m === 'live' ? 'Live mode' : 'Test mode'); } catch (e) { fail(e); } b.disabled = false; });
    $$('[data-clear]', v).forEach(b => b.onclick = async () => { if (!await confirmBox({ title: 'Remove this key?', text: 'Searching here stops; booking sites still work.', ok: 'Remove', danger: true })) return; BK.state = await call('setKey', b.dataset.clear, ''); render(); });
    $('#sHome').onchange = (e) => { const c = AIRPORTS.codeOf(e.target.value) || e.target.value.trim().toUpperCase().slice(0, 3); setSettings({ homeAirport: c }, true); if (BK.state) BK.state.homeAirport = c; BK.tripId = null; e.target.value = apLabel(c); };
    $('#sNat').onchange = (e) => { setSettings({ nationality: e.target.value }, true); if (BK.state) BK.state.nationality = e.target.value; };
    $$('[data-trav]', v).forEach(b => b.onclick = () => travelerSheet((BK.state.travelers || []).find(x => x.id === b.dataset.trav)));
    if (S.setFocus === 'booking') { S.setFocus = null; setTimeout(() => { const el = $('#setBooking'); if (el) el.scrollIntoView({ block: 'start' }); }, 20); }
    $('#sMove').onclick = async () => {
      try {
        const r = await call('pickDataDir'); if (!r) return;
        S.dataDir = r.dataDir; S.trips = r.trips; S.trip = null;
        render(); toast('Using the new folder', `${plural(r.trips.length, 'trip')} found there. Move trip folders into it to bring them along.`, 'ok', 8000);
      } catch (e) { fail(e); }
    };
  },
};

function travelerSheet(tr) {
  const x = tr || { given: '', family: '', born: '', gender: 'm', email: '', phone: '' };
  const el = openSheet(`<div class="sheet-head">${tile('a-sunset', 'user', 'md', 18)}<div class="grow"><h3>${tr ? 'Edit traveler' : 'Add a traveler'}</h3><div class="muted small">Encrypted on this computer. Used to fill in bookings.</div></div></div>
    <div class="sheet-body">${travelerFields(0, x, [])}</div>
    <div class="sheet-foot">${tr ? `<button class="btn ghost danger" id="del">${icon('trash', 15)}Remove</button>` : ''}<span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="ok">Save</button></div>`, { width: 640 });
  el.querySelector('[data-x]').onclick = closeSheet;
  el.querySelector('.pax-head b').textContent = 'Details';
  if (tr) el.querySelector('#del').onclick = async () => { BK.state.travelers = await call('removeTraveler', tr.id); closeSheet(); render(); };
  el.querySelector('#ok').onclick = async () => {
    const [v] = readTravelers(el); if (!v.given || !v.family) return toast('Add a first and last name', '', 'info');
    BK.state.travelers = await call('saveTraveler', { ...v, id: tr ? tr.id : '' }); closeSheet(); render();
  };
}
