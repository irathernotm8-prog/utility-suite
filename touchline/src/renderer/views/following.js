// Touchline — Following: your teams (next and last match), your players, your competitions.
(() => {
  const { esc } = UI;
  const Views = (window.Views = window.Views || {});

  Views.following = {
    async render(el, _p, ctx) {
      const f = UI.store.following;
      el.innerHTML = `
        <div class="day-head"><h1>Following</h1><div class="grow"></div><button class="btn" id="add">${icon('plus', 15)}Follow a team or player</button></div>
        <section class="section" style="margin-top:4px"><div class="section-head"><h2>Teams</h2><span class="muted small">Match alerts are ${UI.store.alerts.enabled ? 'on' : 'off'} · <a href="#" data-go="settings">change</a></span></div>
          <div id="teams" class="grid three">${f.teams.length ? f.teams.map((t) => `<div class="card pad skel-wrap" data-team="${t.id}" style="min-height:150px"><div class="row">${UI.crest(UI.teamLogo(t.id), t.name, 'md')}<b>${esc(t.name)}</b></div><div class="skel" style="height:60px;margin-top:14px"></div></div>`).join('') : ''}</div>
          ${f.teams.length ? '' : `<div class="card">${UI.empty('No teams yet', 'Follow a team from its page, or search for one. Their matches get starred in Matchday and you get goal alerts.', 'shirt')}</div>`}
        </section>
        <section class="section"><div class="section-head"><h2>Players</h2></div>
          ${f.players.length ? `<div class="squad-grid">${f.players.map((p) => `<div class="card sq" data-go="player:${p.id}">${UI.photo(UI.playerPhoto(p.id), p.name)}<div class="nm"><b>${esc(p.name)}</b><small id="pl-${p.id}"></small></div><button class="icon-btn on" data-follow="players:${p.id}:${UI.attr(p.name)}">${icon('starFill', 16)}</button></div>`).join('')}</div>` : `<div class="card">${UI.empty('No players yet', 'Follow players from their profile page.', 'users')}</div>`}
        </section>
        <section class="section"><div class="section-head"><h2>Competitions</h2><a href="#" class="link" data-go="leagues">Manage</a></div>
          <div class="comp-grid">${f.leagues.map((l) => `<div class="comp-item" data-go="league:${l.id}">${UI.crest(UI.leagueLogo(l.id), l.name)}<div class="nm">${esc(l.name)}</div></div>`).join('')}</div>
        </section>`;
      UI.$('#add', el).onclick = () => Palette.open();

      for (const t of f.teams) {
        UI.api('team', t.id).then((T) => {
          if (!ctx.alive()) return;
          const card = UI.$(`[data-team="${t.id}"]`, el);
          if (!card) return;
          const last = T.fixtures.filter((x) => x.state === 'post').slice(-1)[0];
          const next = T.next;
          const line = (m, label) => {
            if (!m) return '';
            const opp = m.home.id === T.id ? m.away : m.home;
            const venue = m.home.id === T.id ? 'v' : '@';
            const res = m.state === 'pre' ? `${UI.date(m.kickoff)} · ${UI.time(m.kickoff)}` : `${m.home.score}–${m.away.score}`;
            return `<div class="set-row" style="padding:8px 0;border-top:1px solid var(--line);cursor:pointer" data-go="match:${m.id}"><span class="muted small" style="width:38px">${label}</span>${UI.crest(opp.logo, opp.name)}<span class="grow ellipsis">${venue} ${esc(opp.name)}</span><b class="small">${m.state === 'live' ? `<span style="color:var(--live)">${esc(m.label)} ${m.home.score}–${m.away.score}</span>` : esc(res)}</b></div>`;
          };
          card.innerHTML = `<div class="row" style="margin-bottom:10px;cursor:pointer" data-go="team:${T.id}">${UI.crest(T.logo, T.name, 'md')}<div class="grow"><b>${esc(T.name)}</b><div class="muted small">${esc(T.primaryLeague?.name || '')}</div></div><button class="icon-btn on" data-follow="teams:${T.id}:${UI.attr(T.name)}">${icon('starFill', 16)}</button></div>
            ${T.form.length ? `<div style="margin-bottom:8px">${UI.form(T.form)}</div>` : ''}${line(last, 'Last')}${line(next, next?.state === 'live' ? 'Now' : 'Next')}`;
        }).catch(() => {});
      }
      for (const p of f.players) {
        UI.api('player', p.id).then((P) => { const s = UI.$(`#pl-${p.id}`, el); if (s && ctx.alive()) s.innerHTML = `${UI.flag(P.ccode)}${esc(P.team?.name || '')}${P.position ? ` · ${esc(P.position)}` : ''}`; }).catch(() => {});
      }
      el.addEventListener('click', (e) => { if (e.target.closest('[data-follow]')) setTimeout(() => App.refresh(), 60); });
    }
  };
})();
