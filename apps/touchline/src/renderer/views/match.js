// Touchline — one match: timeline, lineups on a pitch, stats, shot map,
// momentum, head-to-head and the league table, refreshing while it's live.
(() => {
  const { esc } = UI;
  const Views = (window.Views = window.Views || {});

  const kit = (c, fallback) => (c && /^#|^rgb/.test(c) ? c : fallback);

  function scorers(M, home) {
    const goals = M.events.filter((e) => e.kind === 'goal' && e.home === home);
    const byName = new Map();
    for (const g of goals) {
      const k = g.player.name;
      if (!byName.has(k)) byName.set(k, { id: g.player.id, mins: [] });
      byName.get(k).mins.push(`${g.minute}${g.added ? `+${g.added}` : ''}'${g.penalty ? ' (P)' : ''}${g.ownGoal ? ' (OG)' : ''}`);
    }
    const reds = M.events.filter((e) => (e.kind === 'red' || e.kind === 'secondYellow') && e.home === home);
    return [...byName.entries()].map(([n, v]) => `<div>${icon('ball', 12, 'ic-inline').replace('class="ic', 'style="display:inline;vertical-align:-1px;margin-right:4px" class="ic')}<span data-go="player:${v.id}" style="cursor:pointer">${esc(n)}</span> ${esc(v.mins.join(', '))}</div>`).join('')
      + reds.map((r) => `<div><i class="rcard" style="display:inline-block;width:8px;height:11px;border-radius:2px;margin-right:6px;vertical-align:-1px"></i>${esc(r.player.name)} ${r.minute}'</div>`).join('');
  }

  function header(M) {
    const pre = M.state === 'pre';
    const score = pre ? `<div class="big-score pre">${esc(UI.time(M.kickoff))}</div>` : `<div class="big-score">${M.home.score ?? 0} – ${M.away.score ?? 0}</div>`;
    const state = M.state === 'live' ? `<div class="state live"><span class="live-dot"></span>${esc(M.label)}</div>`
      : M.state === 'pre' ? `<div class="state">${esc(UI.date(M.kickoff, { weekday: 'long', day: 'numeric', month: 'long' }))}</div>`
      : `<div class="state">${esc(M.detail || M.label)}${M.penalties ? ` · Pens ${esc(M.penalties.join('–'))}` : ''}${M.aggregate ? ` · Agg ${esc(M.aggregate)}` : ''}</div>`;
    const meta = [
      !pre && M.kickoff ? `<span>${icon('calendar', 14)}${esc(UI.date(M.kickoff, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))} · ${esc(UI.time(M.kickoff))}</span>` : '',
      M.venue ? `<span>${icon('stadium', 14)}${esc(M.venue.name)}${M.venue.city ? `, ${esc(M.venue.city)}` : ''}</span>` : '',
      M.referee ? `<span>${icon('whistle', 14)}${esc(M.referee.name)}</span>` : '',
      M.attendance ? `<span>${icon('users', 14)}${Number(M.attendance).toLocaleString()}</span>` : '',
      M.weather ? `<span>${esc(M.weather.temp)}°C · ${esc(M.weather.text)}</span>` : ''
    ].filter(Boolean).join('');
    return `<div class="card mhead" style="--home:${esc(kit(M.home.color, 'transparent'))};--away:${esc(kit(M.away.color, 'transparent'))}">
      <div class="comp" data-go="league:${M.league.parentId || M.league.id}">${UI.crest(M.league.logo, M.league.name)}${esc(M.league.name)}${M.league.round ? ` · ${/^\d+$/.test(M.league.round) ? `Matchday ${esc(M.league.round)}` : esc(M.league.round)}` : ''}</div>
      <div class="teams">
        <div class="side home" data-go="team:${M.home.id}"><h2>${esc(M.home.name)}</h2>${UI.crest(M.home.logo, M.home.name, 'lg')}</div>
        <div>${score}${state}</div>
        <div class="side" data-go="team:${M.away.id}">${UI.crest(M.away.logo, M.away.name, 'lg')}<h2>${esc(M.away.name)}</h2></div>
      </div>
      ${!pre ? `<div class="scorers"><div class="home">${scorers(M, true)}</div><div></div><div>${scorers(M, false)}</div></div>` : ''}
      ${meta ? `<div class="meta">${meta}</div>` : ''}
    </div>`;
  }

  function timeline(M) {
    const ev = M.events.filter((e) => e.kind !== 'added');
    if (!ev.length) return UI.empty(M.state === 'pre' ? 'Not started yet' : 'No events', M.state === 'pre' ? `Kick-off ${UI.time(M.kickoff)}` : '', 'clock');
    const list = M.state === 'live' ? [...ev].reverse() : ev;
    return `<div class="timeline">${list.map((e) => {
      if (e.kind === 'period') return `<div class="tl-period">${esc(e.label)} ${e.score ? `${e.score[0]} – ${e.score[1]}` : ''}</div>`;
      let ic = '', text = '';
      const pl = (x, bold) => `<${bold ? 'b' : 'span'} data-go="player:${x.id}" style="cursor:pointer">${esc(x.name)}</${bold ? 'b' : 'span'}>`;
      if (e.kind === 'goal') { ic = `<span class="ic-goal">${icon('ball', 17)}</span>`; text = `${pl(e.player, true)} <b>${e.score ? `${e.score[0]}–${e.score[1]}` : ''}</b><small>${e.ownGoal ? 'Own goal' : e.penalty ? 'Penalty' : e.assist ? `Assist: ${esc(e.assist.name)}` : ''}${e.xg != null ? ` · xG ${Number(e.xg).toFixed(2)}` : ''}</small>`; }
      else if (e.kind === 'yellow') { ic = '<i class="ycard"></i>'; text = `${pl(e.player)}<small>${esc(e.reason || 'Yellow card')}</small>`; }
      else if (e.kind === 'red' || e.kind === 'secondYellow') { ic = '<i class="rcard"></i>'; text = `${pl(e.player, true)}<small>${e.kind === 'secondYellow' ? 'Second yellow' : 'Red card'}${e.reason ? ` · ${esc(e.reason)}` : ''}</small>`; }
      else if (e.kind === 'sub') { ic = `<span style="color:var(--mute)">${icon('swap', 16)}</span>`; text = `<span class="sub-on">${esc(e.on?.name || '')}</span><small><span class="sub-off">${esc(e.off?.name || '')}</span>${e.injury ? ' · injury' : ''}</small>`; }
      else if (e.kind === 'missedPen') { ic = `<span style="color:var(--loss)">${icon('x', 16)}</span>`; text = `${pl(e.player)}<small>Missed penalty</small>`; }
      else if (e.kind === 'var') { ic = '<span class="source-tag">VAR</span>'; text = esc(e.label); }
      else if (e.kind === 'shootout') { ic = icon('target', 16); text = `${pl(e.player)}<small>Shoot-out</small>`; }
      else return '';
      const min = `<span class="min">${e.minute}${e.added ? `+${e.added}` : ''}'</span>`;
      return `<div class="tl-row">${e.home ? `<div class="ev home"><div>${text}</div>${ic}</div>${min}<div></div>` : `<div></div>${min}<div class="ev">${ic}<div>${text}</div></div>`}</div>`;
    }).join('')}</div>`;
  }

  function factsSide(M) {
    const p = M.potm;
    const form = M.form && M.form.length === 2 ? `<div class="card"><div class="card-head"><h3>Form going in</h3></div>
      <div class="set-row">${UI.crest(M.home.logo, M.home.name)}<span class="grow ellipsis">${esc(M.home.name)}</span>${UI.form(M.form[0])}</div>
      <div class="set-row">${UI.crest(M.away.logo, M.away.name)}<span class="grow ellipsis">${esc(M.away.name)}</span>${UI.form(M.form[1])}</div></div>` : '';
    return `<div class="grid">
      ${p ? `<div class="card pad" data-go="player:${p.id}" style="cursor:pointer;display:flex;align-items:center;gap:14px">${UI.photo(UI.playerPhoto(p.id), p.name)}<div class="grow"><small class="muted" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px;font-weight:600">Player of the match</small><div><b>${esc(p.name)}</b></div><div class="muted small">${esc(p.team)}</div></div>${UI.rating(p.rating)}</div>` : ''}
      ${form}
      ${M.venue ? `<div class="card"><div class="card-head"><h3>Venue</h3></div><div class="set-row" style="align-items:flex-start">${icon('stadium', 18)}<div class="grow"><b>${esc(M.venue.name)}</b><small>${esc([M.venue.city, M.venue.country].filter(Boolean).join(', '))}${M.venue.capacity ? ` · capacity ${Number(M.venue.capacity).toLocaleString()}` : ''}${M.venue.surface ? ` · ${esc(M.venue.surface)}` : ''}</small></div></div></div>` : ''}
      ${M.highlights ? `<button class="btn" data-href="${esc(M.highlights)}">${icon('play', 14)}Watch highlights</button>` : ''}
    </div>`;
  }

  function pitchSide(team, half, color) {
    if (!team) return '';
    return team.starters.map((p) => {
      if (p.x == null || p.y == null) return '';
      const left = half === 'home' ? p.x * 100 : (1 - p.x) * 100;
      const top = half === 'home' ? 100 - p.y * 50 : p.y * 50;
      const tags = [];
      for (const ev of p.events) { if (ev === 'goal') tags.push('⚽'); if (ev === 'ownGoal') tags.push('🔴'); if (ev === 'yellowCard') tags.push('🟨'); if (ev === 'redCard') tags.push('🟥'); }
      if (p.subOut != null) tags.push('↓');
      return `<div class="pl" style="left:${left}%;top:${top}%;--kit:${esc(color)}" data-go="player:${p.id}">
        <div class="shirt"><img src="${UI.src(p.photo)}" alt="" loading="lazy" data-fb="${esc(p.number ?? '')}"></div>
        ${p.rating ? `<span class="rt" style="background:${UI.ratingColor(p.rating)}">${p.rating.toFixed(1)}</span>` : ''}
        ${tags.length ? `<span class="tags">${tags.map((t) => `<i>${t}</i>`).join('')}</span>` : ''}
        <span class="nm">${p.number != null ? `${esc(p.number)} ` : ''}${esc(p.last)}</span>
      </div>`;
    }).join('');
  }

  function benchList(team, side) {
    if (!team) return '';
    const row = (p, extra = '') => `<div class="pi" data-go="player:${p.id}"><span class="no">${esc(p.number ?? '')}</span>${UI.photo(p.photo, p.name, 'sm')}<span class="grow ellipsis">${esc(p.name)}</span>${extra}${UI.rating(p.rating)}</div>`;
    return `<div class="card plist">
      <div class="card-head">${UI.crest(UI.teamLogo(team.id), team.name)}<h3 class="ellipsis">${esc(team.name)}</h3><span class="muted small">${esc(team.formation || '')}</span>${team.rating ? UI.rating(team.rating) : ''}</div>
      ${team.coach ? `<div class="pi" style="cursor:default"><span class="no"></span>${icon('users', 16)}<span class="grow">${esc(team.coach.name)}</span><span class="muted small">Coach</span></div>` : ''}
      <div class="pi" style="cursor:default;color:var(--mute);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Substitutes</div>
      ${team.subs.map((p) => row(p, p.subIn != null ? `<span class="sub-on small" style="color:var(--win)">${p.subIn}'</span>` : '')).join('')}
      ${team.unavailable.length ? `<div class="pi" style="cursor:default;color:var(--mute);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Unavailable</div>${team.unavailable.map((p) => `<div class="pi" data-go="player:${p.id}"><span class="no"></span><span class="grow ellipsis">${esc(p.name)}</span><span class="muted small">${esc(p.reason)}</span></div>`).join('')}` : ''}
      ${team.avgAge || team.value ? `<div class="compare-note">Starting XI: ${team.avgAge ? `average age ${Number(team.avgAge).toFixed(1)}` : ''}${team.value ? ` · value ${UI.money(team.value)}` : ''}</div>` : ''}
    </div>`;
  }

  function lineups(M) {
    const lu = M.lineups;
    if (!lu || !lu.home || !lu.home.starters.length) return UI.empty('No lineups yet', 'Teams are usually announced about an hour before kick-off.', 'shirt');
    const hc = kit(M.teamColors?.darkMode?.home, '#ffffff'), ac = kit(M.teamColors?.darkMode?.away, '#7cc4ff');
    return `${!lu.confirmed ? '<div class="notice">' + icon('info', 16) + '<span>Predicted lineups. They\'ll update when the teams are announced.</span></div>' : ''}
      <div class="lineup-wrap">
        ${benchList(lu.home, 'home')}
        <div class="pitch-col"><div class="pitch">${Charts.pitchLines(true)}${pitchSide(lu.away, 'away', ac)}${pitchSide(lu.home, 'home', hc)}</div></div>
        ${benchList(lu.away, 'away')}
      </div>`;
  }

  function stats(M) {
    if (!M.stats.length) return UI.empty('No stats yet', M.state === 'pre' ? 'Stats arrive once the match starts.' : '', 'chart');
    const hc = kit(M.teamColors?.darkMode?.home, 'var(--accent)'), ac = kit(M.teamColors?.darkMode?.away, '#7cc4ff');
    return `<div class="grid two">${M.stats.map((g) => `<div class="card"><div class="card-head"><h3>${esc(g.title)}</h3></div>
      ${g.stats.map((s) => {
        const a = s.hv ?? 0, b = s.av ?? 0, tot = a + b || 1;
        const pct = /possession/i.test(s.title) ? [a, b] : [(a / tot) * 100, (b / tot) * 100];
        return `<div class="stat-row"><div class="labels"><span class="${a > b ? 'better' : ''}">${esc(s.home)}</span><span>${esc(s.title)}</span><span class="${b > a ? 'better' : ''}">${esc(s.away)}</span></div>
          <div class="bars"><div class="bar h"><i style="width:${pct[0]}%;background:${a >= b ? hc : 'var(--line-2)'}"></i></div><div class="bar"><i style="width:${pct[1]}%;background:${b >= a ? ac : 'var(--line-2)'}"></i></div></div></div>`;
      }).join('')}</div>`).join('')}</div>`;
  }

  function shots(M) {
    const list = M.shots.filter((x) => !x.ownGoal);
    if (!list.length) return UI.empty('No shots recorded', '', 'target');
    const hc = kit(M.teamColors?.darkMode?.home, '#c8f26b'), ac = kit(M.teamColors?.darkMode?.away, '#7cc4ff');
    const official = M.stats.flatMap((g) => g.stats).find((x) => x.key === 'expected_goals');
    const sum = (id) => official ? Number(id === M.home.id ? official.home : official.away) : list.filter((s) => s.teamId === id).reduce((a, s) => a + (s.xg || 0), 0);
    const count = (id) => list.filter((s) => s.teamId === id).length;
    const best = [...list].filter((s) => s.xg != null).sort((a, b) => b.xg - a.xg).slice(0, 8);
    return `<div class="grid side">
      <div class="card" style="padding:14px">${Charts.shotmap(list, M.home.id, { home: hc, away: ac })}
        <div class="shot-legend"><span><i style="width:10px;height:10px;border-radius:50%;background:${esc(hc)}"></i>${esc(M.home.name)} → attacking right</span><span><i style="width:10px;height:10px;border-radius:50%;background:${esc(ac)}"></i>${esc(M.away.name)} ← attacking left</span><span>Filled = goal · size = xG</span></div></div>
      <div class="grid">
        <div class="card"><div class="card-head"><h3>Expected goals</h3></div>
          <div class="set-row">${UI.crest(M.home.logo, M.home.name)}<span class="grow">${esc(M.home.name)}</span><b>${sum(M.home.id).toFixed(2)}</b><span class="muted small">${count(M.home.id)} shots</span></div>
          <div class="set-row">${UI.crest(M.away.logo, M.away.name)}<span class="grow">${esc(M.away.name)}</span><b>${sum(M.away.id).toFixed(2)}</b><span class="muted small">${count(M.away.id)} shots</span></div></div>
        <div class="card"><div class="card-head"><h3>Best chances</h3></div>
          ${best.map((s) => `<div class="pi" style="display:flex;align-items:center;gap:10px;padding:7px 14px;border-top:1px solid var(--line);cursor:pointer" data-go="player:${s.playerId}"><span class="muted small" style="width:28px">${s.minute}'</span><span class="grow ellipsis">${esc(s.player)}</span><span class="muted small">${esc(s.type === 'Goal' ? 'Goal' : s.type === 'AttemptSaved' ? 'Saved' : s.type === 'Miss' ? 'Missed' : s.type === 'Post' ? 'Woodwork' : s.type)}</span><b>${s.xg.toFixed(2)}</b></div>`).join('')}</div>
      </div></div>`;
  }

  function h2h(M) {
    const h = M.h2h;
    if (!h || !h.matches.length) return UI.empty('No previous meetings', '', 'history');
    const [hw, d, aw] = h.summary || [0, 0, 0];
    const tot = hw + d + aw || 1;
    return `<div class="card pad" style="margin-bottom:14px">
        <div class="row" style="justify-content:space-between;font-weight:700"><span class="row">${UI.crest(M.home.logo, M.home.name)}${hw} wins</span><span class="muted">${d} draws</span><span class="row">${aw} wins${UI.crest(M.away.logo, M.away.name)}</span></div>
        <div style="display:flex;height:8px;border-radius:5px;overflow:hidden;margin-top:10px;gap:2px"><i style="flex:${hw};background:${esc(kit(M.teamColors?.darkMode?.home, 'var(--accent)'))}"></i><i style="flex:${d};background:var(--line-2)"></i><i style="flex:${aw};background:${esc(kit(M.teamColors?.darkMode?.away, '#7cc4ff'))}"></i></div>
        <div class="muted small" style="margin-top:8px">Last ${tot} meetings</div></div>
      <div class="card">${h.matches.map((m) => `<div class="mrow" ${m.id ? `data-go="match:${m.id}"` : ''} style="grid-template-columns:110px minmax(0,1fr) 76px minmax(0,1fr) 120px">
        <span class="when">${esc(UI.date(m.kickoff, { day: 'numeric', month: 'short', year: 'numeric' }))}</span>
        <div class="team home"><span>${esc(m.home.name)}</span>${UI.crest(UI.teamLogo(m.home.id), m.home.name)}</div>
        <div style="text-align:center"><span class="score">${m.home.score ?? '–'}<span style="opacity:.5">–</span>${m.away.score ?? '–'}</span></div>
        <div class="team">${UI.crest(UI.teamLogo(m.away.id), m.away.name)}<span>${esc(m.away.name)}</span></div>
        <span class="muted small ellipsis" style="text-align:right">${esc(m.league)}</span></div>`).join('')}</div>`;
  }

  Views.match = {
    async render(el, params, ctx) {
      const id = Number(params[0]);
      let tab = params[1] || 'facts';
      let M;
      el.innerHTML = `<div class="card mhead"><div class="skel" style="height:110px"></div></div>${UI.loading(6)}`;
      try { M = await UI.api('match', id, { force: ctx.force }); }
      catch (err) { if (ctx.alive()) el.innerHTML = UI.error(err, 'this match'); return; }
      if (!ctx.alive()) return;

      const tabsFor = () => [['facts', 'Facts'], ['lineups', 'Lineups'], ['stats', 'Stats'], ['shots', 'Shot map'], ['h2h', 'Head-to-head'], ...(M.tableLeagueId ? [['table', 'Table']] : [])];

      async function body() {
        const b = UI.$('#m-body', el);
        if (tab === 'facts') {
          const mom = Charts.momentum(M.momentum, kit(M.teamColors?.darkMode?.home, 'var(--accent)'), kit(M.teamColors?.darkMode?.away, '#7cc4ff'));
          b.innerHTML = `<div class="grid side"><div class="grid">
              ${mom ? `<div class="card"><div class="card-head"><h3>Momentum</h3><span class="muted small">${esc(M.home.name)} above · ${esc(M.away.name)} below</span></div><div style="padding:10px 14px">${mom}</div></div>` : ''}
              <div class="card">${timeline(M)}</div></div>${factsSide(M)}</div>`;
        } else if (tab === 'lineups') b.innerHTML = lineups(M);
        else if (tab === 'stats') b.innerHTML = stats(M);
        else if (tab === 'shots') b.innerHTML = shots(M);
        else if (tab === 'h2h') b.innerHTML = h2h(M);
        else if (tab === 'table') {
          b.innerHTML = UI.loading(10, 36);
          try {
            const L = await UI.api('league', M.tableLeagueId, null, {});
            if (!ctx.alive() || tab !== 'table') return;
            const ids = new Set([M.home.id, M.away.id]);
            const t = L.tables.find((x) => (x.views.all || []).some((r) => ids.has(r.team.id))) || L.tables[0];
            if (!t) { b.innerHTML = UI.empty('No table for this competition', '', 'list'); return; }
            b.innerHTML = `<div class="card" style="overflow:hidden"><div class="card-head" data-go="league:${L.id}" style="cursor:pointer">${UI.crest(L.logo, L.name)}<h3>${esc(t.name || L.name)}</h3><span class="muted small" style="display:inline-flex;align-items:center;gap:2px">Full page ${icon('chevronRight', 12)}</span></div>
              <table class="tbl"><thead><tr><th class="l" style="padding-left:16px">#</th><th class="l">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead><tbody>
              ${t.views.all.map((r) => `<tr class="${ids.has(r.team.id) ? 'hl' : ''}" data-go="team:${r.team.id}"><td class="pos l" style="padding-left:16px">${r.qual ? `<i style="background:${esc(r.qual.color)}"></i>` : ''}${r.pos}</td><td class="l"><div class="team-cell">${UI.crest(r.team.logo, r.team.name)}<span>${esc(r.team.name)}</span></div></td><td class="num">${r.p}</td><td class="num">${r.w}</td><td class="num">${r.d}</td><td class="num">${r.l}</td><td class="num">${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.pts}</td></tr>`).join('')}
              </tbody></table></div>`;
          } catch (err) { b.innerHTML = UI.error(err, 'the table'); }
        }
      }

      function draw() {
        el.innerHTML = `${UI.staleNotice(M._meta)}${header(M)}${UI.tabs(tabsFor(), tab, 'mtab')}<div id="m-body"></div>`;
        UI.onSeg(el, 'mtab', (v) => { tab = v; ctx.replaceParams([id, tab]); body(); });
        body();
      }
      draw();

      ctx.every(20 * 1000, async () => {
        const soon = M.state === 'pre' && Date.parse(M.kickoff) - Date.now() < 70 * 60 * 1000;
        if (M.state !== 'live' && !soon) return;
        try {
          const next = await UI.api('match', id, {});
          if (!ctx.alive()) return;
          const scroll = UI.$('.main').scrollTop;
          M = next;
          if (tab === 'table') { UI.$('.mhead', el).outerHTML = header(M); return; }
          draw();
          UI.$('.main').scrollTop = scroll;
        } catch {}
      });
    }
  };
})();
