// Settings: look, clock, home currency, where trips are kept, the offline pack and what Waypoint is.
'use strict';

VIEWS.settings = {
  title: 'Settings',
  render(v) {
    const st = S.settings;
    const row = (title, sub, ctl) => `<div class="set-row"><div class="grow"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</div>${ctl}</div>`;
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
    $('#sMove').onclick = async () => {
      try {
        const r = await call('pickDataDir'); if (!r) return;
        S.dataDir = r.dataDir; S.trips = r.trips; S.trip = null;
        render(); toast('Using the new folder', `${plural(r.trips.length, 'trip')} found there. Move trip folders into it to bring them along.`, 'ok', 8000);
      } catch (e) { fail(e); }
    };
  },
};
