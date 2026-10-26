// Atoll Settings — every choice saves the moment you make it.
(() => {
  'use strict';
  const A = window.atoll;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const errText = (e) => String(e.message || e).replace(/^Error invoking remote method 'atoll': (Error: )?/, '');
  let S = null, section = new URLSearchParams(location.search).get('section') || 'general', recording = false, places = null, placeErr = null, msg = null;
  const isMac = () => S.platform === 'darwin';

  const SECTIONS = [
    ['general', 'gear', 'General'], ['island', 'display', 'Island'], ['timers', 'timer', 'Timers'], ['media', 'music', 'Music'],
    ['match', 'ball', 'Live match'], ['weather', 'sun', 'Weather'], ['shelf', 'tray', 'Shelf'], ['about', 'info', 'About']
  ];
  const set = async (p) => { try { S.settings = await A.call('setSettings', p); msg = null; } catch (e) { msg = errText(e); } render(); };
  const sw = (key, on, extra = '') => `<button class="switch ${on ? 'on' : ''}" data-sw="${key}" ${extra}></button>`;
  const seg = (key, val, opts) => `<div class="seg" data-seg="${key}">${opts.map(([v, l]) => `<button class="${String(val) === String(v) ? 'on' : ''}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
  const row = (title, sub, ctl, ic = '', color = '') => `<div class="row">${ic ? `<div class="ric" style="background:${color}">${icon(ic, 16)}</div>` : ''}<div class="lbl"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</div>${ctl}</div>`;
  const prettyKey = (acc) => String(acc || '').split('+').map((k) => ({ CommandOrControl: isMac() ? '⌘' : 'Ctrl', Command: '⌘', Control: isMac() ? '⌃' : 'Ctrl', Alt: isMac() ? '⌥' : 'Alt', Shift: isMac() ? '⇧' : 'Shift', Space: 'Space' }[k] || k)).join(isMac() ? ' ' : ' + ');

  function nav() {
    $('#nav').innerHTML = SECTIONS.map(([k, ic, l]) => `<button class="${section === k ? 'on' : ''}" data-sec="${k}">${icon(ic, 17)}${l}</button>`).join('');
  }

  const pages = {
    general: () => `<h1>General</h1><p class="lede">Atoll lives at the top of your screen and in the ${isMac() ? 'menu bar' : 'system tray'}.</p>
      <div class="hero"><div class="pill"><span class="art"></span><span style="flex:1;font-size:13px;font-weight:600">Now playing</span><span class="eq"><i></i><i></i><i></i><i></i></span></div></div>
      <div class="group">
        ${row('Open the island', 'Show the full island from anywhere.', `<span class="kbd ${recording ? 'rec' : ''}" id="rec">${recording ? 'Press keys…' : esc(prettyKey(S.settings.shortcut))}</span>`, 'keyboard', '#5e5ce6')}
        ${row('Open on', 'Hover opens it after a short pause; click waits for a click.', seg('expandOn', S.settings.expandOn, [['hover', 'Hover'], ['click', 'Click']]), 'sparkle', '#bf5af2')}
        ${S.settings.expandOn === 'hover' ? row('Hover delay', `${S.settings.hoverDelay} ms`, `<div class="range"><input type="range" min="0" max="800" step="20" value="${S.settings.hoverDelay}" data-range="hoverDelay"></div>`) : ''}
        ${row('Start Atoll when you log in', '', sw('openAtLogin', S.settings.openAtLogin), 'restart', '#30d158')}
      </div>
      ${msg ? `<div class="note err">${esc(msg)}</div>` : ''}
      <h2>Settings window</h2><div class="group">${row('Appearance', 'The island itself is always black.', seg('theme', S.settings.theme, [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]))}</div>`,

    island: () => {
      const g = S.geo || {};
      const pri = S.settings.priority;
      const names = { timers: ['Timers and focus', 'timer', '#ff9f0a'], match: ['Live match', 'ball', '#30d158'], media: ['Music', 'music', '#ff375f'] };
      return `<h1>Island</h1><p class="lede">${g.notch ? 'This Mac has a notch, so the island can grow out of it.' : isMac() ? 'No notch on this display, so the island floats just under the menu bar.' : 'The island floats at the top centre of your screen.'}</p>
      <div class="group">
        ${row('Style', isMac() ? 'Notch hugs the camera housing. Floating is a pill under the menu bar.' : 'A floating pill at the top of the screen.', seg('style', S.settings.style, isMac() ? [['auto', 'Automatic'], ['notch', 'Notch'], ['float', 'Floating']] : [['auto', 'Floating']]), 'display', '#0a84ff')}
        ${row('Display', '', `<select class="field" data-sel="display"><option value="primary" ${S.settings.display === 'primary' ? 'selected' : ''}>Main display</option><option value="cursor" ${S.settings.display === 'cursor' ? 'selected' : ''}>The one with the pointer</option>${S.displays.map((d) => `<option value="${d.id}" ${String(S.settings.display) === String(d.id) ? 'selected' : ''}>${esc(d.label)} (${esc(d.size)})</option>`).join('')}</select>`)}
        ${g.style === 'notch' ? row('Notch width', 'Line the wings up with your notch.', `<div class="range"><input type="range" min="150" max="240" step="2" value="${S.settings.notchWidth || g.notchWidth}" data-range="notchWidth"><span class="tnum muted" style="width:52px">${S.settings.notchWidth || g.notchWidth} pt</span></div>`) : ''}
        ${g.style !== 'notch' ? row('When nothing is going on', 'What the floating island shows when no timer, song or match is live.', seg('idle', S.settings.idle, [['clock', 'Clock'], ['dot', 'Small pill'], ['hide', 'Thin line']])) : ''}
      </div>
      <h2>Modules</h2><div class="group">
        ${row('Music', 'What’s playing, with controls and system volume.', sw('m:media', S.settings.modules.media), 'music', '#ff375f')}
        ${row('Timers', 'Timers, focus sessions and a stopwatch.', sw('m:timers', S.settings.modules.timers), 'timer', '#ff9f0a')}
        ${row('Live match', 'One football match from Touchline.', sw('m:match', S.settings.modules.match), 'ball', '#30d158')}
        ${row('Shelf', 'Files you drop on the island and recent copies.', sw('m:shelf', S.settings.modules.shelf), 'tray', '#0a84ff')}
        ${row('Weather', 'Forecast on Home and in the header.', sw('m:weather', S.settings.modules.weather), 'sun', '#64d2ff')}
        ${row('System', 'Battery, processor and memory on Home.', sw('m:system', S.settings.modules.system), 'cpu', '#8e8e93')}
      </div>
      <h2>When more than one thing is live</h2><div class="group"><div class="order">${pri.map((k, i) => `<div class="it"><span class="n">${i + 1}</span><span style="color:${names[k][2]}">${icon(names[k][1], 16)}</span><span class="grow">${names[k][0]}</span><button class="btn sm ghost" data-up="${i}" ${i === 0 ? 'disabled' : ''}>${icon('up', 14)}</button><button class="btn sm ghost" data-down="${i}" ${i === pri.length - 1 ? 'disabled' : ''}>${icon('down', 14)}</button></div>`).join('')}</div></div>
      <div class="note">The first one takes the island; the second gets the little bubble beside it.</div>`;
    },

    timers: () => `<h1>Timers</h1><p class="lede">Timers keep running when the island is closed, and pick up where they were if Atoll restarts.</p>
      <div class="group">
        ${row('Sound', 'Plays when a timer finishes, and repeats until you stop it.', `${seg('sound', S.settings.sound, [['chime', 'Chime'], ['bell', 'Bell'], ['pulse', 'Pulse'], ['none', 'None']])}`, 'bell', '#ff9f0a')}
        ${row('Notifications', 'Also send a system notification.', sw('timerNotify', S.settings.timerNotify), 'info', '#8e8e93')}
        ${row('Quick timers', 'Minutes, separated by commas.', `<input class="field" style="width:200px" data-text="presets" value="${esc(S.settings.presets.join(', '))}">`)}
      </div>
      <h2>Focus sessions</h2><div class="group">
        ${['work', 'short', 'long'].map((k) => row({ work: 'Focus', short: 'Short break', long: 'Long break' }[k], '', `<div class="range"><input type="range" min="${k === 'work' ? 5 : 1}" max="${k === 'work' ? 90 : 45}" value="${S.settings.focus[k]}" data-focus="${k}"><span class="tnum muted" style="width:52px">${S.settings.focus[k]} min</span></div>`)).join('')}
        ${row('Long break after', '', `<div class="range"><input type="range" min="2" max="8" value="${S.settings.focus.every}" data-focus="every"><span class="tnum muted" style="width:72px">${S.settings.focus.every} sessions</span></div>`)}
      </div>`,

    media: () => `<h1>Music</h1><p class="lede">${isMac() ? 'On a Mac, Atoll follows Music and Spotify. The first time, macOS asks to let Atoll control them.' : 'Atoll follows whatever shows in the Windows media controls: Spotify, Apple Music, Media Player, YouTube in a browser and more.'}</p>
      <div class="group">
        ${row('Show new songs', 'The island briefly shows the cover and title when the song changes.', sw('trackBurst', S.settings.trackBurst), 'music', '#ff375f')}
        ${isMac() ? row('Music', '', sw('p:Music', S.settings.macPlayers.includes('Music'))) + row('Spotify', '', sw('p:Spotify', S.settings.macPlayers.includes('Spotify'))) : ''}
      </div>
      ${S.media?.error ? `<div class="note">Last message from the player: ${esc(S.media.error)}</div>` : ''}
      ${isMac() ? '<div class="note">Browsers aren’t covered on macOS: since macOS 15.4 only Apple’s own apps can read the system-wide Now Playing.</div>' : ''}`,

    match: () => {
      const f = S.match?.follow;
      return `<h1>Live match</h1><p class="lede">Powered by Touchline’s data. Follow a team and Atoll finds its game every day, or pin one match from the island’s Match tab.</p>
      <div class="group">
        ${row('Following', f ? (f.mode === 'team' ? esc(f.team.name) : 'One pinned match') : 'Nothing yet. Open the island’s Match tab to choose.', f ? '<button class="btn sm" id="unfollow">Stop</button>' : '<button class="btn sm" id="pick">Choose…</button>', 'ball', '#30d158')}
        ${row('Goal moments', 'The island shows goals, kick-off and full-time as they happen.', sw('goalBurst', S.settings.goalBurst))}
        ${row('Notifications', 'Also send a system notification for goals.', sw('goalNotify', S.settings.goalNotify))}
      </div><div class="note">Scores refresh every 20 seconds while the match is live, and every few minutes before kick-off.</div>`;
    },

    weather: () => {
      const w = S.settings.weather;
      return `<h1>Weather</h1><p class="lede">From Open-Meteo. No account, no key; Atoll only sends the city’s coordinates.</p>
      <div class="group">
        ${row('City', w ? `${esc(w.name)}${w.admin ? `, ${esc(w.admin)}` : ''}${w.country ? `, ${esc(w.country)}` : ''}` : 'Not set', w ? '<button class="btn sm ghost" id="clear-city">Remove</button>' : '', 'sun', '#64d2ff')}
        <div class="row"><input class="field grow" id="city" placeholder="Search a city: Houston, Lisbon, Lagos…"></div>
        ${places ? `<div class="results">${places.length ? places.map((p, i) => `<button data-place="${i}">${icon('display', 15)}<span class="grow">${esc(p.name)}<span class="muted"> · ${esc([p.admin, p.country].filter(Boolean).join(', '))}</span></span></button>`).join('') : '<div class="muted small" style="padding:8px">No places found.</div>'}</div>` : ''}
        ${placeErr ? `<div class="row err">${esc(placeErr)}</div>` : ''}
        ${row('Units', '', seg('units', S.settings.units, [['auto', 'Automatic'], ['f', '°F'], ['c', '°C']]))}
      </div>`;
    },

    shelf: () => `<h1>Shelf</h1><p class="lede">Drop files on the island and they wait there until you drag them somewhere else. Nothing is copied; the shelf remembers where they are.</p>
      <div class="group">
        ${row('Clipboard history', 'Keeps recent text you copy, in memory only. It’s cleared when Atoll quits.', sw('clipboard', S.settings.clipboard), 'clipboard', '#0a84ff')}
        ${row('Keep', '', seg('clipboardSize', S.settings.clipboardSize, [[6, '6'], [12, '12'], [24, '24']]))}
      </div>`,

    about: () => `<h1>About Atoll</h1><p class="lede">A Dynamic Island for your desktop, part of the Utility Suite.</p>
      <div class="group">
        ${row('Version', '', `<span class="muted tnum" id="vinfo"></span>`)}
        ${row('Data folder', 'Settings, timers, the shelf list and the match cache.', '<button class="btn sm" id="data">Open</button>')}
        ${row('Quit Atoll', 'The island and its timers stop until you open Atoll again.', '<button class="btn sm" id="quit">Quit</button>')}
      </div>
      <div class="note">Football data from FotMob (through Touchline’s data layer), with ESPN as a backup. Weather from Open-Meteo.</div>`
  };

  function render() {
    applyTheme(); nav();
    $('#page').innerHTML = (pages[section] || pages.general)();
    $('#hide-island').innerHTML = `${icon('eyeOff', 15)} Hide the island`;
    if (section === 'about') A.call('info').then((i) => { const el = $('#vinfo'); if (el) el.textContent = `${i.version} · Electron ${i.electron}`; });
  }

  // ---------------------------------------------------------------- events
  document.addEventListener('click', async (e) => {
    const t = e.target;
    const sec = t.closest('[data-sec]'); if (sec) { section = sec.dataset.sec; places = null; render(); $('#main').scrollTop = 0; return; }
    const s = t.closest('[data-sw]');
    if (s) {
      const k = s.dataset.sw;
      if (k.startsWith('m:')) return set({ modules: { [k.slice(2)]: !S.settings.modules[k.slice(2)] } });
      if (k.startsWith('p:')) { const p = k.slice(2); const cur = S.settings.macPlayers; return set({ macPlayers: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] }); }
      return set({ [k]: !S.settings[k] });
    }
    const b = t.closest('[data-seg] button');
    if (b) { const key = b.parentElement.dataset.seg; let v = b.dataset.v; if (key === 'clipboardSize') v = Number(v); return set({ [key]: v }); }
    if (t.closest('[data-up]') || t.closest('[data-down]')) {
      const el = t.closest('[data-up]') || t.closest('[data-down]'); const i = Number(el.dataset.up ?? el.dataset.down); const j = el.dataset.up != null ? i - 1 : i + 1;
      const p = S.settings.priority.slice(); [p[i], p[j]] = [p[j], p[i]]; return set({ priority: p });
    }
    if (t.closest('#rec')) { recording = true; render(); return; }
    if (t.closest('[data-place]')) { const p = places[Number(t.closest('[data-place]').dataset.place)]; places = null; return set({ weather: p }); }
    if (t.closest('#clear-city')) return set({ weather: null });
    if (t.closest('#unfollow')) { await A.call('matchClear'); S = await A.call('state'); return render(); }
    if (t.closest('#pick')) return A.call('openIsland', 'match');
    if (t.closest('#data')) return A.call('openData');
    if (t.closest('#quit')) return A.call('quit');
    if (t.closest('#hide-island')) return A.call('hideIsland');
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.sel === 'display') return set({ display: t.value });
    if (t.dataset.range) return set({ [t.dataset.range]: Number(t.value) });
    if (t.dataset.focus) return set({ focus: { [t.dataset.focus]: Number(t.value) } });
    if (t.dataset.text === 'presets') { const list = t.value.split(/[,\s]+/).map(Number).filter((n) => n > 0 && n <= 600).slice(0, 10); if (list.length) set({ presets: list }); }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.range || t.dataset.focus) { const lab = t.parentElement.querySelector('span'); if (lab) lab.textContent = `${t.value} ${t.dataset.focus === 'every' ? 'sessions' : t.dataset.focus ? 'min' : t.dataset.range === 'notchWidth' ? 'pt' : ''}`; }
    if (t.id === 'city') {
      clearTimeout(t._t); const q = t.value;
      t._t = setTimeout(async () => { try { places = q.trim().length < 2 ? null : await A.call('places', q); placeErr = null; } catch (err) { placeErr = errText(err); places = null; } const keep = q; render(); const c = $('#city'); if (c) { c.value = keep; c.focus(); } }, 300);
    }
  });
  window.addEventListener('keydown', (e) => {
    if (!recording) return;
    e.preventDefault();
    if (e.key === 'Escape') { recording = false; return render(); }
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;
    const parts = [];
    if (e.metaKey || e.ctrlKey) parts.push(isMac() && e.ctrlKey && !e.metaKey ? 'Control' : 'CommandOrControl');
    if (e.altKey) parts.push('Alt'); if (e.shiftKey) parts.push('Shift');
    let k = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : { Space: 'Space', Backquote: '`', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=' }[e.code] || (/^F\d+$/.test(e.key) ? e.key : null);
    if (!k || parts.length === 0) return;
    recording = false; set({ shortcut: [...parts, k].join('+') });
  });

  A.on('patch', (p) => { Object.assign(S, p); if (p.settings || p.geo || (section === 'match' && p.match)) { if (!document.activeElement || document.activeElement.tagName !== 'INPUT' || document.activeElement.type === 'range') render(); } });
  A.on('theme', (t) => applyTheme());
  A.on('section', (s) => { section = s; render(); });
  function applyTheme() { const t = S.settings.theme; const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  (async () => {
    S = await A.call('state');
    document.documentElement.classList.toggle('win', S.platform === 'win32');
    $('#ver').textContent = `Version ${S.version}`;
    applyTheme(); render();
  })();
})();
