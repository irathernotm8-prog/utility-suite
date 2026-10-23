// Touchline — a player: profile, this season, deep stats for any past season and
// competition, full club and international career, trophies, and the historical
// record from Wikidata for the years FotMob doesn't cover.
(() => {
  const { esc } = UI;
  const Views = (window.Views = window.Views || {});

  const yr = (d) => (d ? String(d).slice(0, 4) : '');
  const sumBy = (arr, k) => arr.reduce((a, x) => a + (Number(x[k]) || 0), 0);

  function hero(P) {
    const facts = [
      ['Age', P.age], ['Height', P.height], ['Foot', P.foot], ['Shirt', P.shirt != null ? `#${P.shirt}` : null],
      ['Value', P.value], ['Contract', P.contractEnd ? UI.date(P.contractEnd, { month: 'short', year: 'numeric' }) : null]
    ].filter(([, v]) => v != null && v !== '');
    return `<div class="hero" style="--team:${esc(P.team?.color || 'var(--accent)')}">
      ${UI.photo(P.photo, P.name, 'lg')}
      <div class="grow">
        <h1>${esc(P.name)}</h1>
        <div class="sub">
          ${P.team ? `<span class="row" style="gap:7px;cursor:pointer" data-go="team:${P.team.id}">${UI.crest(P.team.logo, P.team.name)}${esc(P.team.name)}${P.team.loan ? ' <span class="source-tag">On loan</span>' : ''}</span><span class="dot"></span>` : ''}
          ${P.position ? `<span>${esc(P.isCoach && !P.position ? 'Coach' : P.position)}</span><span class="dot"></span>` : P.isCoach ? '<span>Coach</span><span class="dot"></span>' : ''}
          ${P.country ? `<span class="row" style="gap:6px">${UI.flag(P.ccode)}${esc(P.country)}</span>` : ''}
          ${P.injury ? `<span class="dot"></span><span style="color:var(--live);font-weight:600">${esc(P.injury)}</span>` : ''}
        </div>
        <div class="facts">${facts.map(([k, v]) => `<div class="fact"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div>
      </div>
      <div class="actions">${UI.followBtn('players', P.id, P.name)}</div>
    </div>`;
  }

  function overview(P) {
    const s = P.season;
    const recent = P.recent.filter((m) => !m.bench).slice(0, 10);
    const mv = P.marketValues.map((v) => ({ x: v.date.slice(0, 7), y: v.value / 1e6, label: `${UI.money(v.value)} · ${v.team}` }));
    return `<div class="grid side"><div class="grid">
      ${s ? `<div><div class="section-head"><h2>${esc(s.league)} ${esc(s.season)}</h2></div><div class="tiles">${s.stats.map((x) => `<div class="card tile"><small>${esc(x.title)}</small><b>${esc(typeof x.value === 'number' && !Number.isInteger(x.value) ? x.value.toFixed(2) : x.value)}</b></div>`).join('')}</div></div>` : ''}
      ${recent.length ? `<div class="card" style="overflow:hidden"><div class="card-head"><h3>Recent matches</h3></div><table class="tbl"><thead><tr><th class="l" style="padding-left:16px">Date</th><th class="l">Match</th><th>Min</th><th>G</th><th>A</th><th style="padding-right:16px">Rating</th></tr></thead><tbody>
        ${recent.map((m) => {
          const res = m.hs == null ? '' : (m.home ? `${m.hs}–${m.as}` : `${m.as}–${m.hs}`);
          const w = m.hs == null ? '' : (m.home ? m.hs - m.as : m.as - m.hs) > 0 ? 'W' : (m.hs === m.as ? 'D' : 'L');
          return `<tr data-go="match:${m.id}"><td class="l" style="padding-left:16px">${esc(UI.date(m.kickoff, { day: 'numeric', month: 'short' }))}</td>
            <td class="l"><div class="team-cell">${UI.crest(UI.teamLogo(m.oppId), m.opp)}<span>${m.home ? 'v' : '@'} ${esc(m.opp)} <span class="muted small">· ${esc(m.league)}</span></span>${w ? `<span class="res-chip ${w}">${esc(res)}</span>` : ''}</div></td>
            <td class="num">${m.mins ?? '—'}'</td><td class="num">${m.goals || ''}${m.goals ? ' ⚽' : ''}</td><td class="num">${m.assists || ''}</td><td style="padding-right:16px">${UI.rating(m.rating)}${m.potm ? ' ★' : ''}</td></tr>`;
        }).join('')}</tbody></table></div>` : ''}
      ${mv.length > 2 ? `<div class="card"><div class="card-head"><h3>Market value</h3><span class="muted small">€ millions</span></div><div class="chart-wrap">${Charts.line(mv, { height: 200, min: 0, fmt: (v) => `${v}m` })}</div></div>` : ''}
    </div><div class="grid">
      ${P.positions.length ? `<div class="card"><div class="card-head"><h3>Positions</h3></div><div style="padding:14px"><div class="pitch" style="max-width:220px;margin:0 auto">${Charts.pitchLines(true)}${P.positions.map((p) => `<div class="pl" style="left:${(1 - (p.x ?? 0.5)) * 100}%;top:${(p.y ?? 0.5) * 100}%;width:auto"><div class="shirt" style="width:${p.main ? 34 : 26}px;height:${p.main ? 34 : 26}px;font-size:10px;--kit:${p.main ? 'var(--accent)' : 'rgba(255,255,255,.5)'}">${esc(p.short || '')}</div></div>`).join('')}</div></div></div>` : ''}
      ${P.traits ? `<div class="card traits"><div class="card-head"><h3>${esc(P.traits.title)}</h3></div><div style="padding:8px 0">${P.traits.items.map((t) => `<div class="tr"><span>${esc(t.title)}</span><div class="pct-bar"><i style="width:${Math.round(t.value * 100)}%;background:${Charts.pctColor(t.value * 100)}"></i></div><b style="text-align:right">${Math.round(t.value * 100)}</b></div>`).join('')}</div></div>` : ''}
      ${P.birthDate ? `<div class="card"><div class="set-row"><span class="grow muted">Born</span><b>${esc(UI.date(P.birthDate, { day: 'numeric', month: 'long', year: 'numeric' }))}</b></div></div>` : ''}
    </div></div>`;
  }

  function deepHtml(d) {
    if (!d) return UI.empty('No detailed stats for this selection', '', 'chart');
    return `<div class="grid side"><div class="grid">
      ${d.top.length ? `<div class="tiles">${d.top.map((t) => `<div class="card tile"><small>${esc(t.title)}</small><b>${esc(t.value)}</b>${t.pct != null ? `<div class="pct-bar" style="margin-top:8px"><i style="width:${t.pct}%;background:${Charts.pctColor(t.pct)}"></i></div>` : ''}</div>`).join('')}</div>` : ''}
      ${d.sections.map((g) => `<div class="card">${g.title ? `<div class="card-head"><h3>${esc(g.title)}</h3><span class="muted small">Percentile vs. same position</span></div>` : ''}
        ${g.items.map((i) => `<div class="pct-row"><span>${esc(i.title)}</span><span class="v">${esc(i.value ?? '—')}</span><div class="pct-bar" title="${i.pct != null ? `${Math.round(i.pct)}th percentile` : ''}"><i style="width:${i.pct ?? 0}%;background:${Charts.pctColor(i.pct)}"></i></div></div>`).join('')}</div>`).join('')}
    </div><div class="grid">
      ${d.shots.length ? `<div class="card"><div class="card-head"><h3>Shots</h3><span class="muted small">${d.shots.length} · ${d.shots.filter((s) => s.type === 'Goal').length} goals</span></div><div style="padding:14px">${Charts.halfShots(d.shots)}<div class="shot-legend" style="padding:10px 0 0"><span>Filled = goal</span><span>Size = xG</span></div></div></div>` : ''}
    </div></div>`;
  }

  function careerTable(sec, title, { national = false } = {}) {
    if (!sec.seasons.length && !sec.clubs.length) return '';
    if (!sec.seasons.length) return clubsList(sec.clubs, title);
    return `<div class="card career" style="overflow:hidden;margin-bottom:14px"><div class="card-head"><h3>${esc(title)}</h3><span class="muted small">Click a season for each competition</span></div>
      <table class="tbl"><thead><tr><th class="l" style="padding-left:16px">Season</th><th class="l">${national ? 'Team' : 'Club'}</th><th>Apps</th><th>Goals</th><th>Assists</th><th style="padding-right:16px">Rating</th></tr></thead><tbody>
      ${sec.seasons.map((s, i) => `<tr class="season" data-exp="${title}:${i}"><td class="l" style="padding-left:16px">${s.comps.length > 1 ? icon('chevronDown', 12).replace('class="ic', 'style="display:inline;margin-right:4px;vertical-align:-1px" class="ic') : ''}${esc(s.season)}</td>
          <td class="l"><div class="team-cell" data-go="team:${s.teamId}">${UI.crest(s.logo, s.team)}<span>${esc(s.team)}</span>${s.loan ? '<span class="loan">LOAN</span>' : ''}</div></td>
          <td class="num">${s.apps ?? '—'}</td><td class="num">${s.goals ?? '—'}</td><td class="num">${s.assists ?? '—'}</td><td style="padding-right:16px">${UI.rating(s.rating)}</td></tr>
        ${s.comps.map((c) => `<tr class="comp" data-of="${title}:${i}" hidden ${c.leagueId > 0 ? `data-go="league:${c.leagueId}:${UI.attr(s.season)}"` : ''}><td></td><td class="l" style="padding-left:40px">${esc(c.league)}</td><td>${c.apps ?? '—'}</td><td>${c.goals ?? '—'}</td><td>${c.assists ?? '—'}</td><td style="padding-right:16px">${c.rating ? Number(c.rating).toFixed(2) : ''}</td></tr>`).join('')}`).join('')}
      <tr style="cursor:default"><td class="l" style="padding-left:16px"><b>Total</b></td><td></td><td class="pts">${sumBy(sec.seasons, 'apps')}</td><td class="pts">${sumBy(sec.seasons, 'goals')}</td><td class="pts">${sumBy(sec.seasons, 'assists')}</td><td></td></tr>
      </tbody></table></div>`;
  }

  function clubsList(clubs, title) {
    if (!clubs.length) return '';
    return `<div class="card" style="margin-bottom:14px"><div class="card-head"><h3>${esc(title)}</h3></div><div class="ctimeline">
      ${clubs.map((c) => `<div class="ct" ${c.teamId ? `data-go="team:${c.teamId}" style="cursor:pointer"` : ''}><span class="yrs">${esc(yr(c.start))}–${c.active ? 'now' : esc(yr(c.end))}</span>${UI.crest(c.logo, c.team)}<span class="nm ellipsis">${esc(c.team)}${c.loan ? '<span class="loan" style="font-size:10px;font-weight:700;color:var(--gold);border:1px solid currentColor;border-radius:4px;padding:0 4px;margin-left:6px">LOAN</span>' : ''}</span><span class="nums">${c.apps != null ? `${c.apps} apps · ${c.goals ?? 0} goals${c.uncertain ? ' *' : ''}` : ''}</span></div>`).join('')}
    </div>${clubs.some((c) => c.uncertain) ? '<div class="compare-note">* FotMob marks these numbers as incomplete. See the historical record below.</div>' : ''}</div>`;
  }

  function wikiHtml(W) {
    if (!W || (!W.clubs.length && !W.national.length)) return `<div class="card">${UI.empty('No historical record found', 'Wikidata has no club history for this name.', 'history')}</div>`;
    const row = (c) => `<div class="ct compact"><span class="yrs">${esc(c.start || '?')}–${esc(c.end || 'now')}</span><div><span class="nm">${esc(c.team)}${c.loan ? ' <span class="source-tag">Loan</span>' : ''}</span><span class="nums small">${c.apps != null ? `${c.apps} apps · ${c.goals ?? 0} goals` : 'Appearances not recorded'}</span></div></div>`;
    const tot = W.clubs.reduce((a, c) => ({ apps: a.apps + (c.apps || 0), goals: a.goals + (c.goals || 0) }), { apps: 0, goals: 0 });
    return `<div class="card"><div class="card-head"><h3>Historical record</h3><span class="source-tag">Wikidata</span><button class="icon-btn" data-href="${esc(W.url)}" title="Open on Wikidata">${icon('external', 15)}</button></div>
      ${W.description ? `<div class="compare-note" style="border-top:0">${esc(W.description)}${W.birth ? ` · born ${esc(UI.date(W.birth, { day: 'numeric', month: 'long', year: 'numeric' }))}` : ''}</div>` : ''}
      <div class="ctimeline">${W.clubs.map(row).join('')}</div>
      ${tot.apps ? `<div class="compare-note">Club career: <b>${tot.apps}</b> league appearances, <b>${tot.goals}</b> goals</div>` : ''}
      ${W.national.length ? `<div class="card-head" style="border-top:1px solid var(--line)"><h3>International</h3></div><div class="ctimeline">${W.national.map(row).join('')}</div>` : ''}
      ${W.youthNational.length ? `<div class="compare-note">Youth: ${W.youthNational.map((y) => `${esc(y.team)}${y.apps != null ? ` (${y.apps}/${y.goals ?? 0})` : ''}`).join(' · ')}</div>` : ''}
    </div>`;
  }

  function trophies(P) {
    if (!P.trophies.length) return UI.empty('No trophies recorded', '', 'trophy');
    const byTeam = new Map();
    for (const t of P.trophies) { if (!byTeam.has(t.team)) byTeam.set(t.team, { id: t.teamId, list: [] }); byTeam.get(t.team).list.push(t); }
    const total = P.trophies.reduce((a, t) => a + t.won.length, 0);
    return `<div class="section-head"><h2>${total} title${total === 1 ? '' : 's'}</h2></div>` + [...byTeam.entries()].map(([team, v]) => `<div class="card" style="margin-bottom:12px"><div class="card-head" data-go="team:${v.id}" style="cursor:pointer">${UI.crest(UI.teamLogo(v.id), team)}<h3>${esc(team)}</h3></div>
      <div class="trophies" style="padding:12px">${v.list.map((t) => `<div class="card trophy" style="background:var(--raise)"><span class="count ${t.won.length ? '' : 'zero'}">${t.won.length}</span><div class="grow"><b>${esc(t.league)}</b><small>${esc(t.won.join(', ') || '')}${t.runnerUp.length ? `${t.won.length ? '<br>' : ''}Runner-up: ${esc(t.runnerUp.join(', '))}` : ''}</small></div></div>`).join('')}</div></div>`).join('');
  }

  Views.player = {
    async render(el, params, ctx) {
      const id = Number(params[0]);
      let tab = params[1] || 'overview';
      let P;
      let entry = null, deep = null, W = undefined;
      el.innerHTML = UI.heroLoading() + UI.loading(8);
      try { P = await UI.api('player', id, { force: ctx.force }); }
      catch (err) { if (ctx.alive()) el.innerHTML = UI.error(err, 'this player'); return; }
      if (!ctx.alive()) return;
      deep = P.deep;
      entry = P.statSeasons[0]?.comps[0]?.entry || null;

      const tabs = [['overview', 'Overview'], ...(P.statSeasons.length ? [['stats', 'Season stats']] : []), ['career', 'Career'], ['trophies', 'Trophies']];

      async function loadWiki() {
        if (W !== undefined) return;
        W = null;
        try { W = await UI.api('history', P.name, P.birthDate ? Number(P.birthDate.slice(0, 4)) : null); }
        catch { W = { clubs: [], national: [], youthNational: [] }; }
        if (ctx.alive() && tab === 'career') body();
      }

      async function body() {
        const b = UI.$('#p-body', el);
        if (tab === 'overview') b.innerHTML = overview(P);
        else if (tab === 'stats') {
          const opts = P.statSeasons.flatMap((s) => s.comps.map((c) => [c.entry, `${s.season} · ${c.name}`]));
          b.innerHTML = `<div class="row" style="margin-bottom:14px"><select class="select" id="entry">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === entry ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div><div id="deep">${deepHtml(deep)}</div>`;
          UI.$('#entry', b).addEventListener('change', async (e) => {
            entry = e.target.value;
            UI.$('#deep', b).innerHTML = UI.loading(6);
            try { deep = (await UI.api('playerSeason', id, entry)).deep; } catch (err) { deep = null; }
            if (ctx.alive()) UI.$('#deep', b).innerHTML = deepHtml(deep);
          });
        } else if (tab === 'career') {
          const c = P.career;
          b.innerHTML = `<div class="grid side"><div>
              ${careerTable(c.senior, 'Club career') || UI.empty('No club career on FotMob', '', 'shirt')}
              ${careerTable(c.national, 'International', { national: true })}
              ${c.senior.seasons.length ? clubsList(c.senior.clubs, 'Clubs') : ''}
              ${clubsList(c.youth.clubs, 'Youth')}
              ${clubsList(c.coach?.clubs || [], 'As a manager')}
            </div><div id="wiki">${W === undefined || W === null ? `<div class="card">${UI.empty('Looking up the historical record…', 'Wikidata keeps club histories with appearances and goals going back decades.', 'history')}</div>` : wikiHtml(W)}</div></div>`;
          loadWiki();
        } else b.innerHTML = trophies(P);
      }

      el.innerHTML = `${UI.staleNotice(P._meta)}${hero(P)}${UI.tabs(tabs, tab, 'ptab')}<div id="p-body"></div>`;
      UI.onSeg(el, 'ptab', (v) => { tab = v; ctx.replaceParams([id, tab]); body(); });
      el.addEventListener('click', (e) => {
        const r = e.target.closest('[data-exp]');
        if (!r || e.target.closest('[data-go]')) return;
        const rows = UI.$$(`[data-of="${CSS.escape(r.dataset.exp)}"]`, el);
        const open = rows.some((x) => x.hidden);
        rows.forEach((x) => (x.hidden = !open));
      });
      body();
    }
  };
})();
