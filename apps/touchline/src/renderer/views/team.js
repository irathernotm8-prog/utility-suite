// Touchline — a team: next match, fixtures across every competition, squad,
// trophies, league finishes by season, managers, and club legends.
(() => {
  const { esc } = UI;
  const Views = (window.Views = window.Views || {});
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(fc|cf|afc|sc|ac|ss|as|club|de|the|football|calcio|1\.)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

  let legendsCache = null;
  async function clubLegends(team) {
    if (!legendsCache) legendsCache = await UI.api('legends').catch(() => ({ list: [], clubAliases: {} }));
    const names = new Set([norm(team.name), norm(team.short)]);
    for (const [canon, aliases] of Object.entries(legendsCache.clubAliases || {})) {
      const all = [canon, ...aliases].map(norm);
      if (all.some((a) => names.has(a))) all.forEach((a) => names.add(a));
    }
    names.delete('');
    return legendsCache.list.filter((p) => p.career.some((c) => names.has(norm(c.club))));
  }

  function nextCard(T) {
    const m = T.next;
    if (!m) return '';
    const home = m.home.id === T.id;
    const opp = home ? m.away : m.home;
    return `<div class="card pad" data-go="match:${m.id}" style="cursor:pointer">
      <div class="row muted small" style="margin-bottom:12px">${m.state === 'live' ? `<span class="live-dot"></span><b style="color:var(--live)">Live · ${esc(m.label)}</b>` : `${icon('calendar', 14)}<span>Next · ${esc(UI.fullDate(m.kickoff))}</span>`}<span class="grow"></span><span>${esc(m.league)}</span></div>
      <div class="row" style="gap:16px">
        ${UI.crest(m.home.logo, m.home.name, 'md')}<b class="grow ellipsis" style="font-size:15px">${esc(m.home.name)}</b>
        <span class="score ${m.state === 'live' ? 'live' : 'pre'}" style="min-width:76px">${m.state === 'live' ? `${m.home.score}–${m.away.score}` : esc(UI.time(m.kickoff))}</span>
        <b class="grow ellipsis" style="font-size:15px;text-align:right">${esc(m.away.name)}</b>${UI.crest(m.away.logo, m.away.name, 'md')}
      </div>
      <div class="muted small" style="margin-top:10px">${home ? 'Home' : 'Away'} against ${esc(opp.name)}</div>
    </div>`;
  }

  function resultRows(list, T) {
    const mine = new Set([T.id]);
    return list.map((m) => UI.matchRow({ ...m, home: { ...m.home, short: m.home.name }, away: { ...m.away, short: m.away.name } }, { showDate: true, mine })).join('');
  }

  Views.team = {
    async render(el, params, ctx) {
      const id = Number(params[0]);
      let tab = params[1] || 'overview';
      let comp = '';
      let T;
      el.innerHTML = UI.heroLoading() + UI.loading(8);
      try { T = await UI.api('team', id, { force: ctx.force }); }
      catch (err) { if (ctx.alive()) el.innerHTML = UI.error(err, 'this team'); return; }
      if (!ctx.alive()) return;
      const legends = await clubLegends(T).catch(() => []);
      if (!ctx.alive()) return;

      const tabs = [['overview', 'Overview'], ['matches', 'Matches'], ['squad', 'Squad'], ['history', 'History'], ...(legends.length ? [['legends', `Legends · ${legends.length}`]] : [])];

      function hero() {
        const pos = T.tables[0]?.views.all?.find((r) => r.team.id === T.id);
        return `<div class="hero" style="--team:${esc(T.color || 'var(--accent)')}">
          ${UI.crest(T.logo, T.name, 'xl')}
          <div class="grow">
            <h1>${esc(T.name)}</h1>
            <div class="sub">${UI.flag(T.country)}${T.primaryLeague ? `<span data-go="league:${T.primaryLeague.id}" style="cursor:pointer">${esc(T.primaryLeague.name)}</span>` : ''}${pos ? `<span class="dot"></span><span>${UI.ordinal(pos.pos)} · ${pos.pts} pts</span>` : ''}${T.venue ? `<span class="dot"></span><span>${esc(T.venue.name)}</span>` : ''}</div>
            ${T.form.length ? `<div style="margin-top:12px">${UI.form(T.form)}</div>` : ''}
          </div>
          <div class="actions">${UI.followBtn('teams', T.id, T.name)}</div>
        </div>`;
      }

      function overview() {
        const played = T.fixtures.filter((f) => f.state === 'post').slice(-6).reverse();
        const upcoming = T.fixtures.filter((f) => f.state === 'pre').slice(0, 5);
        const t = T.tables[0];
        const top = (title, list, unit) => list.length ? `<div class="card"><div class="card-head"><h3>${esc(title)}</h3></div>${list.slice(0, 3).map((p) => `<div class="set-row" style="padding:9px 16px;cursor:pointer" data-go="player:${p.id}">${UI.photo(p.photo, p.name, 'sm')}<span class="grow ellipsis">${esc(p.name)}</span><b>${esc(unit === 'r' ? Number(p.value).toFixed(2) : p.value)}</b></div>`).join('')}</div>` : '';
        let mini = '';
        if (t) {
          const rows = t.views.all;
          const i = rows.findIndex((r) => r.team.id === T.id);
          const slice = i < 0 ? rows.slice(0, 7) : rows.slice(Math.max(0, Math.min(i - 3, rows.length - 7)), Math.max(7, Math.min(i - 3, rows.length - 7) + 7));
          mini = `<div class="card" style="overflow:hidden"><div class="card-head" ${T.primaryLeague ? `data-go="league:${T.primaryLeague.id}" style="cursor:pointer"` : ''}><h3>${esc(t.name || T.primaryLeague?.name || 'Table')}</h3><span class="muted small" style="display:inline-flex;align-items:center;gap:2px">Full table ${icon('chevronRight', 12)}</span></div>
            <table class="tbl"><thead><tr><th class="l" style="padding-left:16px">#</th><th class="l">Team</th><th>P</th><th>GD</th><th>Pts</th></tr></thead><tbody>
            ${slice.map((r) => `<tr class="${r.team.id === T.id ? 'hl' : ''}" data-go="team:${r.team.id}"><td class="pos l" style="padding-left:16px">${r.qual ? `<i style="background:${esc(r.qual.color)}"></i>` : ''}${r.pos}</td><td class="l"><div class="team-cell">${UI.crest(r.team.logo, r.team.name)}<span>${esc(r.team.name)}</span></div></td><td class="num">${r.p}</td><td class="num">${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.pts}</td></tr>`).join('')}
            </tbody></table></div>`;
        }
        return `<div class="grid side">
          <div class="grid">
            ${nextCard(T)}
            ${played.length ? `<div class="card league-block" style="margin:0"><div class="card-head" style="cursor:default"><h3>Recent results</h3></div>${resultRows(played, T)}</div>` : ''}
            ${upcoming.length ? `<div class="card league-block" style="margin:0"><div class="card-head" style="cursor:default"><h3>Coming up</h3></div>${resultRows(upcoming, T)}</div>` : ''}
          </div>
          <div class="grid">
            ${mini}
            ${top('Top rated', T.top.rating, 'r')}${top('Top scorers', T.top.goals)}${top('Most assists', T.top.assists)}
            ${T.venue ? `<div class="card"><div class="card-head"><h3>${esc(T.venue.name)}</h3></div>${T.venue.city ? `<div class="set-row" style="padding:9px 16px"><span class="grow muted">City</span><b>${esc(T.venue.city)}</b></div>` : ''}${T.venue.facts.map((f) => `<div class="set-row" style="padding:9px 16px"><span class="grow muted">${esc(f.k)}</span><b>${esc(typeof f.v === 'number' ? f.v.toLocaleString() : f.v)}</b></div>`).join('')}</div>` : ''}
          </div></div>`;
      }

      function matches() {
        const comps = [...new Set(T.fixtures.map((f) => f.league).filter(Boolean))];
        const list = T.fixtures.filter((f) => !comp || f.league === comp);
        const months = new Map();
        for (const f of list) { const k = f.kickoff ? f.kickoff.slice(0, 7) : 'TBD'; if (!months.has(k)) months.set(k, []); months.get(k).push(f); }
        return `<div class="chips" style="margin-bottom:14px" id="comp-chips"><button class="chip ${!comp ? 'on' : ''}" data-c="">All competitions</button>${comps.map((c) => `<button class="chip ${c === comp ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
          ${[...months.entries()].map(([k, fs]) => `<section class="card league-block"><div class="card-head" style="cursor:default"><h3>${k === 'TBD' ? 'Date to be confirmed' : esc(new Date(`${k}-15T12:00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' }))}</h3></div>${resultRows(fs, T)}</section>`).join('') || UI.empty('No matches', '', 'calendar')}`;
      }

      function squad() {
        if (!T.squad.length) return UI.empty('No squad listed', '', 'users');
        const titles = { coach: 'Coach', keepers: 'Goalkeepers', defenders: 'Defenders', midfielders: 'Midfielders', attackers: 'Attackers' };
        return T.squad.map((g) => `<section class="section" style="margin-top:0;margin-bottom:22px"><div class="section-head"><h2>${esc(titles[g.title] || g.title)}</h2><span class="muted small">${g.members.length}</span></div>
          <div class="squad-grid">${g.members.map((m) => `<div class="card sq" data-go="player:${m.id}">
            <span class="no">${esc(m.number ?? '')}</span>${UI.photo(m.photo, m.name)}
            <div class="nm"><b>${esc(m.name)}</b><small>${UI.flag(m.ccode)}${m.age ? `${m.age} yrs` : ''}${m.pos && g.title !== 'coach' ? ` · ${esc(m.pos.split(',')[0])}` : ''}${m.goals ? ` · ${m.goals} G` : ''}</small>${m.injury ? `<span class="inj">Out · ${esc(m.injury)}</span>` : ''}</div>
            ${m.rating ? UI.rating(m.rating) : ''}
          </div>`).join('')}</div></section>`).join('');
      }

      function history() {
        const ranks = [...T.ranks].sort((a, b) => String(a.season).localeCompare(String(b.season)));
        const divRank = new Map(T.divisions.map((d) => [d.id, d.rank]));
        const topDiv = Math.min(...T.divisions.map((d) => d.rank).filter(Boolean), Infinity);
        // stack divisions so a 3rd in the second tier sits below 20th in the top tier
        const offset = (r) => { const dr = divRank.get(r.leagueId); return dr && topDiv !== Infinity ? (dr - topDiv) * 24 : 0; };
        const series = ranks.filter((r) => r.pos).map((r) => ({ x: r.season.replace(/^(\d{4})\/\d{2}(\d{2})$/, "$1/$2"), y: r.pos + offset(r), label: `${UI.ordinal(r.pos)} in ${r.league}`, color: offset(r) ? 'var(--mute)' : r.pos === 1 ? 'var(--gold)' : 'var(--accent)', mark: r.pos === 1 }));
        return `${T.trophies.length ? `<div class="section-head"><h2>Trophy cabinet</h2><span class="muted small">${T.trophies.reduce((a, t) => a + t.won, 0)} titles</span></div>
            ${T.trophies.some((t) => t.won && UI.trophyArt(t.leagueId)) ? `<div class="cabinet">${T.trophies.filter((t) => t.won && UI.trophyArt(t.leagueId)).map((t) => `<div class="shelf-item" title="${esc(t.league)}" ${t.leagueId ? `data-go="league:${t.leagueId}"` : ''}>${UI.trophy(t.leagueId)}<b>×${t.won}</b><small>${esc(t.league)}</small></div>`).join('')}</div>` : ''}
            <div class="trophies">${T.trophies.map((t) => `<div class="card trophy ${t.won ? '' : 'none'}" ${t.leagueId ? `data-go="league:${t.leagueId}" style="cursor:pointer"` : ''}><div class="plinth">${UI.trophy(t.leagueId)}<span class="count ${t.won ? '' : 'zero'}">${t.won}</span></div><div class="grow"><b>${esc(t.league)}</b><small>${t.seasonsWon.length ? esc(t.seasonsWon.slice(0, 8).join(', ')) + (t.seasonsWon.length > 8 ? ` +${t.seasonsWon.length - 8} more` : '') : 'No wins'}${t.runnerUp ? `<br>Runner-up ${t.runnerUp}×` : ''}</small></div></div>`).join('')}</div>` : ''}
          ${series.length > 1 ? `<div class="section"><div class="section-head"><h2>League finishes</h2><span class="muted small">Higher is better · grey points are lower divisions</span></div>
            <div class="card chart-wrap">${Charts.line(series, { invert: true, min: 1, max: Math.max(...series.map((s) => s.y)), fmt: (v) => (v > 24 ? '' : v), height: 220, integer: true })}</div></div>` : ''}
          ${T.ranks.length ? `<div class="section"><div class="card" style="overflow:hidden"><table class="tbl"><thead><tr><th class="l" style="padding-left:16px">Season</th><th class="l">Competition</th><th>Pos</th><th>W</th><th>D</th><th>L</th><th>Pts</th></tr></thead><tbody>
            ${[...T.ranks].sort((a, b) => String(b.season).localeCompare(String(a.season))).map((r) => `<tr data-go="league:${r.leagueId}:${UI.attr(r.season)}"><td class="l" style="padding-left:16px">${esc(r.season)}</td><td class="l">${esc(r.league)}</td><td class="pts">${r.pos ? UI.ordinal(r.pos) : '—'}${r.teams ? `<span class="muted small"> / ${r.teams}</span>` : ''}</td><td class="num">${r.w ?? '—'}</td><td class="num">${r.d ?? '—'}</td><td class="num">${r.l ?? '—'}</td><td class="num">${r.pts ?? '—'}</td></tr>`).join('')}
            </tbody></table></div></div>` : ''}
          ${T.coaches.length ? `<div class="section"><div class="section-head"><h2>Managers</h2></div><div class="card" style="overflow:hidden"><table class="tbl"><thead><tr><th class="l" style="padding-left:16px">Season</th><th class="l">Manager</th><th class="l">League</th><th>W</th><th>D</th><th>L</th><th>Pts/game</th></tr></thead><tbody>
            ${T.coaches.map((c) => `<tr data-go="player:${c.id}"><td class="l" style="padding-left:16px">${esc(c.season)}</td><td class="l"><b>${esc(c.name)}</b></td><td class="l muted">${esc(c.league)}</td><td class="num">${c.w ?? '—'}</td><td class="num">${c.d ?? '—'}</td><td class="num">${c.l ?? '—'}</td><td class="pts">${c.ppg != null ? Number(c.ppg).toFixed(2) : '—'}</td></tr>`).join('')}
            </tbody></table></div></div>` : ''}
          ${!T.trophies.length && !T.ranks.length && !T.coaches.length ? UI.empty('No history recorded', '', 'history') : ''}`;
      }

      function legendsTab() {
        return `<p class="muted" style="margin:0 0 14px">Hall of Fame players who spent part of their career here.</p><div class="legend-grid">${legends.map((p) => Views.legends.card(p, T.name)).join('')}</div>`;
      }

      function body() {
        const b = UI.$('#t-body', el);
        b.innerHTML = tab === 'overview' ? overview() : tab === 'matches' ? matches() : tab === 'squad' ? squad() : tab === 'history' ? history() : legendsTab();
        const cc = UI.$('#comp-chips', b);
        if (cc) cc.addEventListener('click', (e) => { const c = e.target.closest('[data-c]'); if (c) { comp = c.dataset.c; body(); } });
      }

      el.innerHTML = `${UI.staleNotice(T._meta)}${hero()}${UI.tabs(tabs, tab, 'ttab')}<div id="t-body"></div>`;
      UI.onSeg(el, 'ttab', (v) => { tab = v; ctx.replaceParams([id, tab]); body(); });
      body();
    }
  };
})();
