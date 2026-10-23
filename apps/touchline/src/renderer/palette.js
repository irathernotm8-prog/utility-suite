// Touchline — search palette (⌘K): players, teams, competitions and legends.
(() => {
  const { esc } = UI;
  let catalog = null;
  let seq = 0;

  const open = () => {
    const o = UI.$('#overlay');
    o.innerHTML = `<div class="scrim"><div class="palette">
      <div class="pin">${icon('search', 18)}<input id="pal-q" placeholder="Search players, teams, competitions, legends" autocomplete="off" spellcheck="false"></div>
      <div class="results" id="pal-r"></div></div></div>`;
    const input = UI.$('#pal-q');
    const box = UI.$('#pal-r');
    let items = [];
    let sel = 0;

    const close = () => { o.innerHTML = ''; document.removeEventListener('keydown', key, true); };
    const choose = (i) => { const it = items[i]; if (!it) return; close(); App.go(it.route, it.params); };

    const renderList = (groups, hint) => {
      items = [];
      let html = '';
      for (const [title, list] of groups) {
        if (!list.length) continue;
        html += `<div class="grp">${esc(title)}</div>`;
        for (const it of list) { html += `<div class="res ${items.length === sel ? 'sel' : ''}" data-i="${items.length}">${it.pic}<div class="nm"><b>${esc(it.name)}</b><small>${esc(it.sub || '')}</small></div>${it.right || ''}</div>`; items.push(it); }
      }
      box.innerHTML = html || `<div class="hint">${esc(hint)}</div>`;
    };

    const recent = () => {
      const f = UI.store.following;
      renderList([
        ['Your teams', f.teams.map((t) => ({ route: 'team', params: [t.id], name: t.name, sub: 'Team', pic: UI.crest(UI.teamLogo(t.id), t.name) }))],
        ['Your players', f.players.map((p) => ({ route: 'player', params: [p.id], name: p.name, sub: 'Player', pic: UI.photo(UI.playerPhoto(p.id), p.name, 'sm') }))],
        ['Your competitions', f.leagues.slice(0, 6).map((l) => ({ route: 'league', params: [l.id], name: l.name, sub: 'Competition', pic: UI.crest(UI.leagueLogo(l.id), l.name) }))]
      ], 'Type a name. Anyone who has played, any team, any competition.');
    };

    const search = async () => {
      const q = input.value.trim();
      sel = 0;
      if (q.length < 2) { recent(); return; }
      const my = ++seq;
      if (!catalog) UI.api('catalog').then((c) => (catalog = c)).catch(() => {});
      const local = (catalog?.leagues || []).filter((l) => `${l.name} ${l.country}`.toLowerCase().includes(q.toLowerCase())).slice(0, 5)
        .map((l) => ({ route: 'league', params: [l.id], name: l.name, sub: l.country, pic: UI.crest(l.logo, l.name) }));
      renderList([['Competitions', local]], 'Searching…');
      let r;
      try { r = await UI.api('search', q); } catch (err) { if (my === seq) renderList([['Competitions', local]], "Search needs a connection. Try again when you're online."); return; }
      if (my !== seq) return;
      const leagueIds = new Set(local.map((l) => Number(l.params[0])));
      renderList([
        ['Players', r.players.slice(0, 8).map((p) => ({ route: 'player', params: [p.id], name: p.name, sub: p.team || (p.coach ? 'Coach' : 'Player'), pic: UI.photo(p.photo, p.name, 'sm') }))],
        ['Legends', (r.legends || []).map((l) => ({ route: 'legend', params: [l.id], name: l.name, sub: `Hall of Fame · ${l.nationality || ''}`, pic: l.photo ? `<img class="avatar sm" src="${esc(l.photo)}" alt="" style="filter:grayscale(1) sepia(.7)">` : UI.photo(null, l.name, 'sm') }))],
        ['Teams', r.teams.slice(0, 6).map((t) => ({ route: 'team', params: [t.id], name: t.name, sub: t.country, pic: UI.crest(t.logo, t.name) }))],
        ['Competitions', [...local, ...r.leagues.filter((l) => !leagueIds.has(l.id)).map((l) => ({ route: 'league', params: [l.id], name: l.name, sub: l.country, pic: UI.crest(l.logo, l.name) }))].slice(0, 6)]
      ], `Nothing found for “${q}”.`);
    };

    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    };
    const mark = () => { UI.$$('.res', box).forEach((r) => r.classList.toggle('sel', Number(r.dataset.i) === sel)); const s = UI.$('.res.sel', box); if (s) s.scrollIntoView({ block: 'nearest' }); };

    let t;
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 220); });
    document.addEventListener('keydown', key, true);
    o.querySelector('.scrim').addEventListener('mousedown', (e) => { if (e.target.classList.contains('scrim')) close(); });
    box.addEventListener('click', (e) => { const r = e.target.closest('[data-i]'); if (r) choose(Number(r.dataset.i)); });
    box.addEventListener('mousemove', (e) => { const r = e.target.closest('[data-i]'); if (r && Number(r.dataset.i) !== sel) { sel = Number(r.dataset.i); mark(); } });
    recent();
    input.focus();
  };

  window.Palette = { open };
})();
