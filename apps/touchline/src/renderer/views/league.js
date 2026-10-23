// Touchline — a competition: table, matches, stats leaders, knockout bracket and
// roll of honour, for any season the competition has.
(() => {
  const { esc } = UI;
  const Views = (window.Views = window.Views || {});

  const roundLabel = (L, r) => {
    const m = L.fixtures.find((f) => f.round === r);
    const name = m?.roundName || r;
    if (/^\d+$/.test(String(name))) return `${L.type === 'cup' ? 'Round' : 'Matchday'} ${name}`;
    return { final: 'Final', '1/2': 'Semi-finals', '1/4': 'Quarter-finals', '1/8': 'Round of 16', '1/16': 'Round of 32' }[name] || String(name);
  };

  function tableHtml(t, view, mine) {
    const rows = t.views[view] || t.views.all;
    const xg = view === 'xg';
    return `<div class="card" style="overflow:hidden;margin-bottom:14px">
      ${t.name ? `<div class="card-head"><h3>${esc(t.name.replace(/^Grp\.\s*/, 'Group '))}</h3></div>` : ''}
      <table class="tbl std"><thead><tr><th class="l" style="padding-left:16px;width:44px">#</th><th class="l">Team</th>
        ${xg ? '<th>P</th><th>xG</th><th>xGA</th><th>xPts</th><th>Pts</th><th title="Position by expected points">xPos</th>' : '<th>P</th><th>W</th><th>D</th><th>L</th><th class="wide">Goals</th><th>GD</th><th>Pts</th>'}
      </tr></thead><tbody>
      ${rows.map((r) => `<tr class="${mine.has(r.team.id) ? 'hl' : ''}" ${r.team.id ? `data-go="team:${r.team.id}"` : ''}>
        <td class="pos l" style="padding-left:16px">${r.qual && view === 'all' ? `<i style="background:${esc(r.qual.color)}"></i>` : ''}${r.pos}</td>
        <td class="l"><div class="team-cell">${UI.crest(r.team.logo, r.team.name)}<span>${esc(r.team.name)}</span>${r.live ? '<span class="live-dot"></span>' : ''}${r.deduction ? `<span class="muted small">(${esc(r.deduction)})</span>` : ''}</div></td>
        ${xg ? `<td class="num">${r.p}</td><td class="num">${UI.n(r.xg?.xg, 1)}</td><td class="num">${UI.n(r.xg?.xga, 1)}</td><td class="num">${UI.n(r.xg?.xpts, 1)}</td><td class="pts">${r.pts}</td><td class="num">${r.xg?.xpos ?? '—'}</td>`
          : `<td class="num">${r.p ?? '—'}</td><td class="num">${r.w ?? '—'}</td><td class="num">${r.d ?? '—'}</td><td class="num">${r.l ?? '—'}</td><td class="num">${r.gf ?? '—'}:${r.ga ?? '—'}</td><td class="num">${r.gd > 0 ? '+' : ''}${r.gd ?? '—'}</td><td class="pts">${r.pts ?? '—'}</td>`}
      </tr>`).join('')}
      </tbody></table>
      ${view === 'all' && t.legend.length ? `<div class="legend">${t.legend.map((l) => `<span><i style="background:${esc(l.color)}"></i>${esc(l.label)}</span>`).join('')}</div>` : ''}
    </div>`;
  }

  function bracketHtml(rounds) {
    return `<div class="bracket">${rounds.map((r) => `<div class="col"><h3>${esc(r.name)}</h3><div class="ties">${r.ties.map((t) => {
      const m = t.matches[0];
      const done = t.winner != null;
      const side = (s, key) => {
        const sc = t.agg ? t.agg[key === 'home' ? 0 : 1] : m && m.state !== 'pre' ? (m.home === s.id ? m.hs : m.as) : '';
        return `<div class="t ${done ? (t.winner === s.id ? 'won' : 'lost') : ''}">${UI.crest(s.logo, s.name)}<span class="ellipsis">${esc(s.name)}${s.alt ? `<small> / ${esc(s.alt)}</small>` : ''}</span><b>${sc ?? ''}</b></div>`;
      };
      const pens = t.matches.some((x) => /pen/i.test(x.label || ''));
      return `<div class="card tie" ${m?.id ? `data-go="match:${m.id}"` : ''}>${side(t.home, 'home')}${side(t.away, 'away')}${pens ? '<div class="t"><small>Won on penalties</small></div>' : ''}${!done && m?.state === 'pre' ? `<div class="t"><small>${esc(UI.date(m.kickoff))} · ${esc(UI.time(m.kickoff))}</small></div>` : ''}</div>`;
    }).join('')}</div></div>`).join('')}</div>`;
  }

  function leadersHtml(list, kind) {
    if (!list.length) return UI.empty('No stats yet', 'Leaders appear once matches have been played.', 'chart');
    return `<div class="leaders">${list.map((s, i) => {
      const [a, ...rest] = s.top;
      const pic = kind === 'players' ? UI.photo(a.photo, a.name) : UI.crest(UI.teamLogo(a.id), a.name, 'md');
      return `<div class="card leader-card" data-leaders="${kind}:${i}">
        <h3><span>${esc(s.title)}</span>${s.url ? `<span class="muted small" style="font-weight:500;display:inline-flex;align-items:center;gap:2px">See all ${icon('chevronRight', 12)}</span>` : ''}</h3>
        <div class="top">${pic}<div class="grow"><b style="font:600 14px var(--ui);color:var(--ink)" class="ellipsis">${esc(a.name)}</b><div class="muted small ellipsis">${esc(a.team || '')}</div></div><b>${esc(a.value)}</b></div>
        ${rest.map((p) => `<div class="rest"><span class="muted">${p.rank}</span><span class="ellipsis">${esc(p.name)}</span><b>${esc(p.value)}</b></div>`).join('')}
      </div>`;
    }).join('')}</div>`;
  }

  function honoursHtml(h) {
    if (!h.length) return UI.empty('No roll of honour', 'FotMob has no past winners for this competition.', 'trophy');
    const tally = new Map();
    for (const s of h) { const k = s.winner.id || s.winner.name; const t = tally.get(k) || { ...s.winner, n: 0 }; t.n++; tally.set(k, t); }
    const top = [...tally.values()].sort((a, b) => b.n - a.n).slice(0, 12);
    const max = top[0]?.n || 1;
    return `<div class="grid side">
      <div class="card honours"><div class="card-head"><h3>Winners by season</h3><span class="muted small">${h.length} seasons</span></div>
        <div class="h-row muted small" style="font-weight:600"><span>Season</span><span>Winner</span><span>Runner-up</span></div>
        ${h.map((s) => `<div class="h-row"><span class="season">${esc(s.season)}</span>
          <span ${s.winner.id ? `data-go="team:${s.winner.id}"` : ''}>${UI.crest(s.winner.logo, s.winner.name)}<b class="ellipsis">${esc(s.winner.name)}</b></span>
          <span class="muted" ${s.runnerUp?.id ? `data-go="team:${s.runnerUp.id}"` : ''}>${s.runnerUp ? `${UI.crest(s.runnerUp.logo, s.runnerUp.name)}<span class="ellipsis">${esc(s.runnerUp.name)}</span>` : '—'}</span></div>`).join('')}
      </div>
      <div class="card"><div class="card-head"><h3>Most titles</h3></div><div class="tally">
        ${top.map((t) => `<div class="tr" ${t.id ? `data-go="team:${t.id}"` : ''}>${UI.crest(t.logo, t.name)}<span class="ellipsis">${esc(t.name)}</span><div><div class="b" style="width:${(t.n / max) * 100}%"></div></div><b>${t.n}</b></div>`).join('')}
      </div></div>
    </div>`;
  }

  Views.league = {
    async render(el, params, ctx) {
      const id = Number(params[0]);
      let season = params[1] || '';
      let tab = params[2] || '';
      let tableView = 'all';
      let round = null;
      let leaderKind = 'players';
      let L;

      el.innerHTML = UI.heroLoading() + UI.loading(10);
      const load = async (force) => {
        L = await UI.api('league', id, season || null, { force });
      };
      try { await load(ctx.force); } catch (err) { if (ctx.alive()) el.innerHTML = UI.error(err, 'this competition'); return; }
      if (!ctx.alive()) return;

      const tabsFor = () => {
        const t = [];
        if (L.tables.length) t.push(['table', 'Table']);
        if (L.fixtures.length) t.push(['matches', 'Matches']);
        if (L.bracket && L.bracket.length) t.push(['knockout', 'Knockout']);
        if (L.leaders.players.length || L.leaders.teams.length) t.push(['stats', 'Stats']);
        if (L.honours.length) t.push(['history', 'Roll of honour']);
        return t;
      };

      function drawHero() {
        const seasons = L.seasons || [];
        const cur = L.season || seasons[0];
        const isPast = L.latestSeason && cur && cur !== L.latestSeason;
        const champ = isPast && L.honours.find((h) => h.season === cur);
        return `<div class="hero" style="--team:${esc(L.color || 'var(--accent)')}">
          ${UI.crest(L.logo, L.name, 'lg')}
          <div class="grow">
            <h1>${esc(L.name)}</h1>
            <div class="sub">${esc(L.country || '')}${L.country ? '<span class="dot"></span>' : ''}<span>${esc(cur || '')}</span>
              ${champ ? `<span class="dot"></span><span style="color:var(--gold)">${icon('trophy', 14)}</span><b data-go="team:${champ.winner.id}" style="cursor:pointer">${esc(champ.winner.name)}</b>` : ''}</div>
          </div>
          ${UI.trophyArt(L.id) ? `<img class="hero-trophy" src="${UI.trophyArt(L.id)}" alt="" title="The ${esc(L.name)} trophy">` : ''}
          <div class="actions">
            ${seasons.length > 1 ? `<select class="select" id="season">${seasons.map((s) => `<option ${s === cur ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : ''}
            ${UI.followBtn('leagues', L.id, L.name)}
          </div>
        </div>`;
      }

      function body() {
        const mine = UI.myTeamIds();
        const b = UI.$('#lg-body', el);
        if (tab === 'table') {
          const hasViews = L.tables[0] ? Object.keys(L.tables[0].views) : ['all'];
          const names = { all: 'Overall', home: 'Home', away: 'Away', form: 'Form', xg: 'Expected (xG)' };
          b.innerHTML = `<div class="row" style="margin-bottom:14px">${UI.seg(hasViews.map((v) => [v, names[v] || v]), tableView, 'tview')}<span class="grow"></span>${L.tables.length > 1 ? `<span class="muted small">${L.tables.length} groups</span>` : ''}</div>
            ${L.tables.map((t) => tableHtml(t, tableView, mine)).join('')}`;
          UI.onSeg(b, 'tview', (v) => { tableView = v; body(); });
        } else if (tab === 'matches') {
          const rounds = L.rounds.filter((r) => r !== '—');
          if (rounds.length > 1) {
            if (round == null || !rounds.includes(round)) round = L.activeRound && rounds.includes(L.activeRound) ? L.activeRound : rounds[rounds.length - 1];
            const i = rounds.indexOf(round);
            const list = L.fixtures.filter((m) => m.round === round).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
            b.innerHTML = `<div class="rounds">
                <button class="icon-btn" id="rprev" ${i <= 0 ? 'disabled' : ''}>${icon('chevronLeft', 18)}</button>
                <div class="chips scroll" id="rchips">${rounds.map((r) => `<button class="chip ${r === round ? 'on' : ''}" data-r="${esc(r)}">${esc(roundLabel(L, r))}</button>`).join('')}</div>
                <button class="icon-btn" id="rnext" ${i >= rounds.length - 1 ? 'disabled' : ''}>${icon('chevronRight', 18)}</button>
              </div>
              ${groupByDay(list, mine)}`;
            const on = UI.$('#rchips .chip.on', b); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
            UI.$('#rchips', b).addEventListener('click', (e) => { const c = e.target.closest('[data-r]'); if (c) { round = c.dataset.r; body(); } });
            UI.$('#rprev', b).onclick = () => { round = rounds[i - 1]; body(); };
            UI.$('#rnext', b).onclick = () => { round = rounds[i + 1]; body(); };
          } else {
            const now = Date.now();
            const upcoming = L.fixtures.filter((m) => m.state !== 'post').sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
            const played = L.fixtures.filter((m) => m.state === 'post').sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff));
            b.innerHTML = `${upcoming.length ? `<div class="section-head"><h2>Coming up</h2></div>${groupByDay(upcoming.slice(0, 60), mine)}` : ''}
              ${played.length ? `<div class="section-head" style="margin-top:22px"><h2>Results</h2></div>${groupByDay(played.slice(0, 80), mine)}` : ''}`;
            void now;
          }
        } else if (tab === 'knockout') {
          b.innerHTML = bracketHtml(L.bracket);
        } else if (tab === 'stats') {
          b.innerHTML = `<div class="row" style="margin-bottom:14px">${UI.seg([['players', 'Players'], ['teams', 'Teams']], leaderKind, 'lk')}</div>${leadersHtml(L.leaders[leaderKind], leaderKind)}`;
          UI.onSeg(b, 'lk', (v) => { leaderKind = v; body(); });
        } else if (tab === 'history') {
          b.innerHTML = honoursHtml(L.honours);
        }
      }

      function groupByDay(list, mine) {
        const days = new Map();
        for (const m of list) { const k = m.kickoff ? UI.ymd(new Date(m.kickoff)) : 'TBD'; if (!days.has(k)) days.set(k, []); days.get(k).push(m); }
        if (!days.size) return UI.empty('No matches', '', 'calendar');
        return [...days.entries()].map(([d, ms]) => `<section class="card league-block"><div class="card-head" style="cursor:default"><h3>${d === 'TBD' ? 'Date to be confirmed' : esc(UI.dayLabel(d))}</h3></div>${ms.map((m) => UI.matchRow(m, { mine })).join('')}</section>`).join('');
      }

      function draw() {
        const tabs = tabsFor();
        if (!tabs.some(([t]) => t === tab)) tab = tabs[0]?.[0] || 'matches';
        el.innerHTML = `${UI.staleNotice(L._meta)}${drawHero()}${UI.tabs(tabs, tab, 'ltab')}<div id="lg-body"></div>`;
        UI.onSeg(el, 'ltab', (v) => { tab = v; ctx.replaceParams([id, season, tab]); body(); });
        const sel = UI.$('#season', el);
        if (sel) sel.addEventListener('change', async () => {
          season = sel.value === L.latestSeason ? '' : sel.value;
          round = null;
          ctx.replaceParams([id, season, tab]);
          UI.$('#lg-body', el).innerHTML = UI.loading(10);
          try { await load(false); if (ctx.alive()) draw(); } catch (err) { UI.$('#lg-body', el).innerHTML = UI.error(err, 'that season'); }
        });
        body();
      }

      el.addEventListener('click', async (e) => {
        const c = e.target.closest('[data-leaders]');
        if (!c) return;
        const [kind, i] = c.dataset.leaders.split(':');
        const s = L.leaders[kind][Number(i)];
        if (!s?.url) return;
        const sh = UI.sheet(`${L.name} · ${s.title}`, UI.loading(8, 40));
        try {
          const { list } = await UI.api('leaders', s.url);
          sh.el.innerHTML = `<table class="tbl"><thead><tr><th class="l" style="padding-left:18px">#</th><th class="l">${kind === 'players' ? 'Player' : 'Team'}</th>${kind === 'players' ? '<th>Apps</th><th>Mins</th>' : ''}<th style="padding-right:18px">${esc(s.title)}</th></tr></thead><tbody>
            ${list.slice(0, 200).map((p) => `<tr data-go="${kind === 'players' ? 'player' : 'team'}:${p.id}"><td class="pos l" style="padding-left:18px">${p.rank}</td>
              <td class="l"><div class="team-cell">${kind === 'players' ? UI.photo(p.photo, p.name, 'sm') : UI.crest(UI.teamLogo(p.id), p.name)}<span><b>${esc(p.name)}</b>${kind === 'players' ? `<span class="muted small"> · ${esc(p.team)}</span>` : ''}</span></div></td>
              ${kind === 'players' ? `<td class="num">${p.apps ?? '—'}</td><td class="num">${p.mins ?? '—'}</td>` : ''}<td class="pts" style="padding-right:18px">${esc(Number.isInteger(p.value) ? p.value : Number(p.value).toFixed(2))}</td></tr>`).join('')}
          </tbody></table>`;
        } catch (err) { sh.el.innerHTML = UI.error(err, 'the full list'); }
      });

      draw();
      ctx.every(60 * 1000, async () => {
        if (season || !L.fixtures.some((m) => m.state === 'live')) return;
        try { await load(false); if (ctx.alive()) body(); } catch {}
      });
    }
  };
})();
