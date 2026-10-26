// Vendored from apps/touchline/src/data by `npm run sync-touchline`. Edit it in Touchline, not here.
// Touchline — turns provider payloads into Touchline's own shapes.
// Every function here is pure (no network, no disk) so `npm test` can check
// them against saved responses. If FotMob changes a field, this is the file to fix.
'use strict';

const IMG = 'https://images.fotmob.com/image_resources';
const img = {
  team: (id) => (id ? `${IMG}/logo/teamlogo/${id}_small.png` : null),
  teamLarge: (id) => (id ? `${IMG}/logo/teamlogo/${id}.png` : null),
  league: (id) => (id ? `${IMG}/logo/leaguelogo/dark/${id}.png` : null),
  player: (id) => (id ? `${IMG}/playerimages/${id}.png` : null),
  flag: (ccode) => (ccode ? `${IMG}/logo/teamlogo/${String(ccode).toLowerCase()}.png` : null)
};

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const clean = (s) => String(s ?? '').replace(/[‎‏]/g, '').trim();

function parseScore(str) {
  const m = /^\s*(\d+)\s*-\s*(\d+)/.exec(String(str || ''));
  return m ? [Number(m[1]), Number(m[2])] : [null, null];
}

/* ---------- match status ---------- */
// state: pre | live | post | off   label: what the score chip shows
function status(s = {}) {
  const reason = s.reason || {};
  const short = clean(reason.short);
  if (s.cancelled) {
    const lbl = /postpon/i.test(reason.long || reason.longKey || '') ? 'Postponed' : (clean(reason.long) || 'Cancelled');
    return { state: 'off', label: lbl, detail: lbl };
  }
  if (s.awarded) return { state: 'post', label: 'Awd', detail: 'Awarded' };
  if (s.finished) return { state: 'post', label: short || 'FT', detail: clean(reason.long) || 'Full-time' };
  if (s.started || s.ongoing) {
    const live = s.liveTime || {};
    let label = clean(live.short) || short || 'Live';
    if (/^HT$/i.test(short) || /^HT$/i.test(label) || reason.shortKey === 'halftime_short') label = 'HT';
    return { state: 'live', label, detail: label === 'HT' ? 'Half-time' : `Live · ${label}`, minute: num(live.long?.split(':')[0]) ?? null };
  }
  return { state: 'pre', label: '', detail: 'Not started' };
}

function side(t = {}, scoreFallback) {
  return {
    id: num(t.id),
    name: clean(t.longName || t.name),
    short: clean(t.shortName || t.name),
    score: t.score ?? scoreFallback ?? null,
    red: t.redCards || 0,
    logo: img.team(num(t.id))
  };
}

/* ---------- matches by date (FotMob /matches?date=) ---------- */
function matchFromList(m, league = {}) {
  const st = status(m.status);
  const [hs, as] = parseScore(m.status?.scoreStr);
  const home = side(m.home, hs);
  const away = side(m.away, as);
  if (st.state === 'pre') { home.score = null; away.score = null; }
  return {
    id: num(m.id),
    leagueId: num(m.leagueId ?? league.id),
    primaryLeagueId: num(league.primaryId ?? m.leagueId ?? league.id),
    leagueName: clean(league.name),
    kickoff: m.status?.utcTime || null,
    round: m.round ?? m.tournamentStage ?? null,
    ...st,
    home, away,
    penalties: Array.isArray(m.status?.penalties) ? m.status.penalties : null,
    aggregate: m.status?.aggregatedStr || null
  };
}

function matchDay(payload) {
  const groups = [];
  for (const L of payload?.leagues || []) {
    const matches = (L.matches || []).map((m) => matchFromList(m, L)).filter((m) => m.id);
    if (!matches.length) continue;
    groups.push({
      id: num(L.id),
      primaryId: num(L.primaryId ?? L.id),
      name: clean(L.isGroup && L.parentLeagueName ? `${L.parentLeagueName} · ${L.groupName || L.name}` : L.name),
      ccode: L.ccode || '',
      logo: img.league(num(L.primaryId ?? L.id)),
      rank: num(L.internalRank) ?? 9999,
      matches
    });
  }
  return { date: payload?.date || null, leagues: groups };
}

/* ---------- league catalog ---------- */
function catalog(payload) {
  const out = [];
  const push = (country, ccode, L) => out.push({ id: num(L.id), name: clean(L.localizedName || L.name), country, ccode, logo: img.league(num(L.id)) });
  for (const g of payload?.international || []) for (const L of g.leagues || []) push(g.name || 'International', g.ccode || 'INT', L);
  for (const g of payload?.countries || []) for (const L of g.leagues || []) push(g.name, g.ccode, L);
  const popular = (payload?.popular || []).map((L) => num(L.id));
  return { leagues: out, popular };
}

/* ---------- league tables ---------- */
function tableRows(rows = [], legend = []) {
  const byIndex = new Map();
  for (const l of legend || []) for (const i of l.indices || []) byIndex.set(i, { label: l.title, color: l.color });
  return rows.map((r, i) => {
    const [gf, ga] = (r.scoresStr || '').split('-').map(Number);
    return {
      pos: num(r.idx) ?? i + 1,
      team: { id: num(r.id ?? r.teamId), name: clean(r.name ?? r.teamName), short: clean(r.shortName || r.name), logo: img.team(num(r.id ?? r.teamId)) },
      p: num(r.played), w: num(r.wins), d: num(r.draws), l: num(r.losses),
      gf: Number.isFinite(gf) ? gf : null, ga: Number.isFinite(ga) ? ga : null,
      gd: num(r.goalConDiff), pts: num(r.pts),
      deduction: r.deduction || null,
      qual: byIndex.get(i) || (r.qualColor ? { color: r.qualColor, label: '' } : null),
      xg: r.xg != null ? { xg: r.xg, xga: r.xgConceded, xpts: r.xPoints, xpos: r.xPosition } : null,
      live: !!r.ongoing
    };
  });
}

function oneTable(data) {
  const t = data?.table || {};
  const views = {};
  for (const k of ['all', 'home', 'away', 'form', 'xg']) if (Array.isArray(t[k]) && t[k].length) views[k] = tableRows(t[k], k === 'all' ? data.legend : []);
  return {
    name: clean(data?.leagueName),
    legend: (data?.legend || []).map((l) => ({ label: l.title, color: l.color })),
    views
  };
}

function tables(tableArr) {
  const out = [];
  for (const block of tableArr || []) {
    const d = block?.data || block;
    if (!d) continue;
    if (Array.isArray(d.tables)) for (const sub of d.tables) out.push(oneTable(sub));
    else if (d.table) out.push(oneTable(d));
  }
  return out.filter((t) => Object.keys(t.views).length);
}

/* ---------- league page ---------- */
function fixtureFromLeague(m, leagueId) {
  const st = status(m.status);
  const [hs, as] = parseScore(m.status?.scoreStr);
  return {
    id: num(m.id), leagueId, kickoff: m.status?.utcTime || null,
    round: m.round != null ? String(m.round) : null, roundName: m.roundName != null ? String(m.roundName) : null,
    ...st,
    home: { ...side(m.home), score: st.state === 'pre' ? null : hs },
    away: { ...side(m.away), score: st.state === 'pre' ? null : as }
  };
}

function bracket(po) {
  if (!po || !Array.isArray(po.rounds)) return null;
  const stageName = (s) => ({ '1/64': 'Round of 128', '1/32': 'Round of 64', '1/16': 'Round of 32', '1/8': 'Round of 16', '1/4': 'Quarter-finals', '1/2': 'Semi-finals', final: 'Final', playoff: 'Knockout play-offs' }[s] || (/^\d+$/.test(s) ? `Round ${s}` : s));
  return po.rounds.map((r) => ({
    stage: r.stage, name: stageName(String(r.stage)),
    ties: (r.matchups || []).map((t) => ({
      home: { id: num(t.homeTeamId), name: clean(t.homeTeam) || 'TBD', short: t.homeTeamShortName || '', logo: img.team(num(t.homeTeamId)), alt: t.homeTeam2 ? clean(t.homeTeam2) : null },
      away: { id: num(t.awayTeamId), name: clean(t.awayTeam) || 'TBD', short: t.awayTeamShortName || '', logo: img.team(num(t.awayTeamId)), alt: t.awayTeam2 ? clean(t.awayTeam2) : null },
      agg: t.aggregatedResult && (t.matches || []).some((m) => m.status?.started) ? [t.aggregatedResult.homeScore, t.aggregatedResult.awayScore] : null,
      winner: num(t.aggregatedWinner ?? t.winner),
      matches: (t.matches || []).map((m) => ({ id: num(m.matchId), kickoff: m.status?.utcTime, ...status(m.status), home: num(m.home?.id), away: num(m.away?.id), hs: m.home?.score ?? null, as: m.away?.score ?? null }))
    }))
  }));
}

function leaders(stats) {
  const map = (list) => (Array.isArray(list) ? list : []).map((s) => ({
    key: s.name, title: clean(s.header),
    top: (s.topThree || []).map((p) => ({ id: num(p.id), name: clean(p.name), teamId: num(p.teamId), team: clean(p.teamName), value: p.value, ccode: p.ccode, rank: p.rank, photo: img.player(num(p.id)) })),
    url: s.fetchAllUrl || null
  })).filter((x) => x.top.length);
  return { players: map(stats?.players), teams: map(stats?.teams) };
}

function league(p) {
  const d = p?.details || {};
  const id = num(d.id);
  const all = (p?.fixtures?.allMatches || []).map((m) => fixtureFromLeague(m, id));
  const rounds = [];
  for (const m of all) { const r = m.round ?? '—'; if (!rounds.includes(r)) rounds.push(r); }
  const firstUnplayed = p?.fixtures?.firstUnplayedMatch?.firstUnplayedMatchId;
  const active = p?.fixtures?.fixtureInfo?.activeRound?.roundId ?? (all.find((m) => String(m.id) === String(firstUnplayed))?.round) ?? null;
  return {
    id, name: clean(d.name), short: clean(d.shortName || d.name), country: d.country || '', type: d.type || 'league',
    color: d.leagueColor || null, logo: img.league(id),
    season: d.selectedSeason || d.latestSeason || null, latestSeason: d.latestSeason || null,
    seasons: p?.allAvailableSeasons || [],
    tables: tables(p?.table),
    fixtures: all, rounds, activeRound: active != null ? String(active) : null,
    bracket: bracket(p?.playoff),
    leaders: leaders(p?.stats),
    honours: (p?.seasons || []).map((s) => ({
      season: s.seasonName,
      winner: s.winner ? { id: num(s.winner.id), name: clean(s.winner.name), logo: img.team(num(s.winner.id)) } : null,
      runnerUp: s.loser ? { id: num(s.loser.id), name: clean(s.loser.name), logo: img.team(num(s.loser.id)) } : null
    })).filter((s) => s.winner),
    tabs: p?.tabs || []
  };
}

/* full leader list (data.fotmob.com/stats/...json) */
function leaderList(payload) {
  const t = payload?.TopLists?.[0];
  if (!t) return [];
  return (t.StatList || []).map((s) => ({
    rank: s.Rank, id: num(s.ParticiantId ?? s.ParticipantId), name: clean(s.ParticipantName),
    teamId: num(s.TeamId), team: clean(s.TeamName), value: s.StatValue, sub: s.SubStatValue,
    mins: s.MinutesPlayed, apps: s.MatchesPlayed, ccode: s.ParticipantCountryCode,
    photo: s.TeamId && s.ParticiantId ? img.player(num(s.ParticiantId)) : img.team(num(s.ParticiantId ?? s.ParticipantId))
  }));
}

/* ---------- match details ---------- */
function eventsOf(content) {
  const ev = content?.matchFacts?.events?.events || [];
  return ev.map((e) => {
    const base = { minute: e.time, added: e.overloadTime || null, home: !!e.isHome, type: e.type };
    switch (e.type) {
      case 'Goal': return { ...base, kind: e.isPenaltyShootoutEvent ? 'shootout' : 'goal', player: { id: num(e.player?.id ?? e.playerId), name: clean(e.fullName || e.nameStr || e.player?.name) }, assist: e.assistInput ? { id: num(e.assistPlayerId), name: clean(e.assistInput) } : null, ownGoal: !!e.ownGoal, penalty: /penalty/i.test(e.goalDescription || '') || e.suffixKey === 'penalty_short', missed: false, score: e.newScore || [e.homeScore, e.awayScore], xg: e.shotmapEvent?.expectedGoals ?? null };
      case 'MissedPenalty': return { ...base, kind: 'missedPen', player: { id: num(e.player?.id), name: clean(e.fullName || e.nameStr) } };
      case 'Card': return { ...base, kind: /red/i.test(e.card) ? (/yellow/i.test(e.card) ? 'secondYellow' : 'red') : 'yellow', player: { id: num(e.player?.id), name: clean(e.fullName || e.nameStr) }, reason: e.cardReason?.defaultText || '' };
      case 'Substitution': {
        const [off, on] = e.swap || [];
        return { ...base, kind: 'sub', on: on ? { id: num(on.id), name: clean(on.name) } : null, off: off ? { id: num(off.id), name: clean(off.name) } : null, injury: !!e.injuredPlayerOut };
      }
      case 'Half': return { ...base, kind: 'period', label: clean(e.halfStrShort) || 'HT', score: [e.homeScore, e.awayScore] };
      case 'AddedTime': return { ...base, kind: 'added', amount: e.minutesAddedInput };
      case 'VAR': return { ...base, kind: 'var', label: clean(e.VAR?.decision?.value || e.varDecision || 'VAR check') };
      default: return null;
    }
  }).filter(Boolean);
}

function statGroups(content) {
  const groups = content?.stats?.Periods?.All?.stats || [];
  return groups.map((g) => ({
    title: clean(g.title),
    stats: (g.stats || []).filter((s) => s.type !== 'title' && Array.isArray(s.stats)).map((s) => {
      const [a, b] = s.stats;
      const pa = num(String(a).split(' ')[0]), pb = num(String(b).split(' ')[0]);
      return { key: s.key, title: clean(s.title), home: a, away: b, hv: pa, av: pb, better: s.highlighted || null };
    })
  })).filter((g) => g.stats.length);
}

function lineupTeam(t, shotsByPlayer) {
  if (!t) return null;
  const person = (p, starter) => ({
    id: num(p.id), name: clean(p.name), first: clean(p.firstName), last: clean(p.lastName) || clean(p.name),
    number: p.shirtNumber ?? null, ccode: p.countryCode || null, age: p.age ?? null,
    rating: num(p.performance?.rating), captain: !!p.isCaptain,
    events: (p.performance?.events || []).map((e) => e.type),
    subIn: p.performance?.substitutionEvents?.find((e) => e.type === 'subIn')?.time ?? null,
    subOut: p.performance?.substitutionEvents?.find((e) => e.type === 'subOut')?.time ?? null,
    x: starter ? p.verticalLayout?.x ?? null : null, y: starter ? p.verticalLayout?.y ?? null : null,
    position: p.positionId ?? null, photo: img.player(num(p.id)),
    shots: shotsByPlayer?.get(num(p.id)) || 0
  });
  return {
    id: num(t.id), name: clean(t.name), formation: t.formation || null, rating: num(t.rating),
    starters: (t.starters || []).map((p) => person(p, true)),
    subs: (t.subs || []).map((p) => person(p, false)),
    coach: t.coach ? { id: num(t.coach.id), name: clean(t.coach.name) } : null,
    unavailable: (t.unavailable || []).map((p) => ({ id: num(p.id), name: clean(p.name), reason: clean(p.unavailability?.expectedReturn ? `${p.unavailability.type || ''} · back ${p.unavailability.expectedReturn}` : p.unavailability?.type || '') })),
    avgAge: t.averageStarterAge ?? null, value: t.totalStarterMarketValue ?? null
  };
}

function match(p) {
  const g = p?.general || {}, h = p?.header || {}, c = p?.content || {};
  const [home, away] = h.teams || [];
  const st = status(h.status);
  const info = c.matchFacts?.infoBox || {};
  const shots = (c.shotmap?.shots || []).map((s) => ({
    id: s.id, teamId: num(s.teamId), playerId: num(s.playerId), player: clean(s.playerName), minute: s.min, x: s.x, y: s.y,
    xg: s.expectedGoals ?? null, xgot: s.expectedGoalsOnTarget ?? null, type: s.eventType, shotType: s.shotType, situation: s.situation,
    onTarget: !!s.isOnTarget, ownGoal: !!s.isOwnGoal, blocked: !!s.isBlocked, goalY: s.goalCrossedY, goalZ: s.goalCrossedZ
  }));
  const byPlayer = new Map();
  for (const s of shots) byPlayer.set(s.playerId, (byPlayer.get(s.playerId) || 0) + 1);
  const potm = c.matchFacts?.playerOfTheMatch;
  return {
    id: num(g.matchId),
    league: { id: num(g.leagueId), parentId: num(g.parentLeagueId), name: clean(g.leagueName), round: clean(g.leagueRoundName || g.matchRound), season: g.parentLeagueSeason || null, logo: img.league(num(g.parentLeagueId || g.leagueId)) },
    kickoff: h.status?.utcTime || g.matchTimeUTCDate || null,
    ...st,
    home: { id: num(home?.id), name: clean(home?.name), score: home?.score ?? null, logo: img.team(num(home?.id)), color: g.teamColors?.darkMode?.home || null },
    away: { id: num(away?.id), name: clean(away?.name), score: away?.score ?? null, logo: img.team(num(away?.id)), color: g.teamColors?.darkMode?.away || null },
    penalties: h.status?.reason?.penalties || null,
    aggregate: h.status?.aggregatedStr || null,
    events: eventsOf(c),
    potm: potm?.id ? { id: num(potm.id), name: clean(potm.name?.fullName || potm.name), team: clean(potm.teamName), rating: num(potm.rating?.num) } : null,
    venue: info.Stadium ? { name: clean(info.Stadium.name), city: clean(info.Stadium.city), country: clean(info.Stadium.country), capacity: info.Stadium.capacity || null, surface: info.Stadium.surface || null } : null,
    referee: info.Referee?.text ? { name: clean(info.Referee.text), country: info.Referee.country || '' } : null,
    attendance: info.Attendance ?? null,
    weather: c.weather?.temperature != null ? { temp: c.weather.temperature, text: c.weather.defaultTitle || c.weather.description || '' } : null,
    highlights: c.matchFacts?.highlights?.url || null,
    stats: statGroups(c),
    lineups: c.lineup ? { home: lineupTeam(c.lineup.homeTeam, byPlayer), away: lineupTeam(c.lineup.awayTeam, byPlayer), confirmed: c.lineup.lineupType !== 'predicted' } : null,
    shots,
    momentum: (c.momentum?.main?.data || c.matchFacts?.momentum?.main?.data || []).map((d) => [d.minute, d.value]),
    h2h: c.h2h ? {
      summary: c.h2h.summary || null,
      matches: (c.h2h.matches || []).filter((m) => m.status?.finished).slice(0, 12).map((m) => {
        const [hs, as] = parseScore(m.status?.scoreStr);
        return { id: num(String(m.matchUrl || '').split('#')[1]), kickoff: m.time?.utcTime, league: clean(m.league?.name), home: { id: num(m.home?.id), name: clean(m.home?.name), score: hs }, away: { id: num(m.away?.id), name: clean(m.away?.name), score: as } };
      })
    } : null,
    form: (c.matchFacts?.teamForm || []).map((list) => (list || []).slice(0, 5).map((f) => ({ r: f.resultString, score: f.score, opp: clean(f.tooltipText?.awayTeam || '') }))),
    teamColors: g.teamColors || null,
    tableLeagueId: num(c.table?.parentLeagueId || c.table?.leagueId)
  };
}

/* ---------- team ---------- */
function team(p) {
  const d = p?.details || {}, o = p?.overview || {}, hist = p?.history || {};
  const id = num(d.id);
  const squadGroups = (p?.squad?.squad || []).map((g) => ({
    title: g.title,
    members: (g.members || []).map((m) => ({
      id: num(m.id), name: clean(m.name), number: m.shirtNumber ?? null, ccode: m.ccode, country: m.cname, age: m.age ?? null,
      height: m.height ?? null, pos: m.positionIdsDesc || m.role?.fallback || '', role: m.role?.fallback || '',
      rating: num(m.rating), goals: m.goals ?? null, assists: m.assists ?? null, injury: m.injury ? clean(m.injury.expectedReturn || 'Injured') : null,
      value: m.transferValue ?? null, photo: img.player(num(m.id))
    }))
  }));
  const fixtures = (p?.fixtures?.allFixtures?.fixtures || []).map((f) => {
    const st = status(f.status);
    return {
      id: num(f.id), kickoff: f.status?.utcTime, ...st, league: clean(f.tournament?.name), leagueId: num(f.tournament?.leagueId),
      home: { id: num(f.home?.id), name: clean(f.home?.name), score: st.state === 'pre' ? null : f.home?.score ?? null, logo: img.team(num(f.home?.id)) },
      away: { id: num(f.away?.id), name: clean(f.away?.name), score: st.state === 'pre' ? null : f.away?.score ?? null, logo: img.team(num(f.away?.id)) },
      result: f.result ?? null
    };
  });
  const tl = (hist.trophyList || []).map((t) => ({
    league: clean(t.name), leagueId: num(t.leagueId), won: num(t.won) || 0, runnerUp: num(t.runnerup) || 0,
    seasonsWon: String(t.seasonsWon || '').split(',').filter(Boolean), seasonsRunnerUp: String(t.seasonsRunnerup || '').split(',').filter(Boolean)
  })).filter((t) => t.won || t.runnerUp).sort((a, b) => b.won - a.won);
  const ranks = (hist.historicalTableData?.ranks || []).map((r) => ({ season: r.seasonName, league: clean(r.tournamentName), leagueId: num(r.templateId), pos: num(r.position), teams: num(r.numberOfTeams), pts: num(r.stats?.points), w: num(r.stats?.wins), d: num(r.stats?.draws), l: num(r.stats?.loss) }));
  const divisions = (hist.historicalTableData?.divisions || []).map((x) => ({ id: num(x.templateId), name: clean(x.name), rank: num(x.divisionRank) }));
  const tops = (o.topPlayers || {});
  const top = (k) => (tops[k]?.players || []).map((x) => ({ id: num(x.id), name: clean(x.name), value: x.value, photo: img.player(num(x.id)) }));
  return {
    id, name: clean(d.name), short: clean(d.shortName || d.name), country: d.country || '', national: !!p?.squad?.isNationalTeam,
    logo: img.teamLarge(id), color: o.teamColors?.darkMode || d.teamColor || null, colors: o.teamColors || null,
    primaryLeague: d.primaryLeagueId ? { id: num(d.primaryLeagueId), name: clean(d.primaryLeagueName) } : null,
    season: o.season || d.latestSeason || null,
    venue: o.venue?.widget ? { name: clean(o.venue.widget.name), city: clean(o.venue.widget.city), facts: (o.venue.statPairs || []).map(([k, v]) => ({ k, v })) } : null,
    tables: tables(p?.table || o.table),
    form: (o.teamForm || []).map((f) => ({ r: f.resultString, score: f.score })),
    next: fixtures.find((f) => f.state === 'pre' || f.state === 'live') || null,
    fixtures,
    squad: squadGroups,
    top: { rating: top('byRating'), goals: top('byGoals'), assists: top('byAssists') },
    trophies: tl, ranks, divisions,
    coaches: (hist.coachHistory || []).map((c) => ({ id: num(c.id), name: clean(c.name), season: c.season, league: clean(c.leagueName), w: c.win, d: c.draw, l: c.loss, ppg: c.pointsPerGame })),
    seasons: p?.allAvailableSeasons || []
  };
}

/* ---------- player ---------- */
function infoValue(list, key) {
  const x = (list || []).find((i) => i.translationKey === key || i.title === key);
  return x ? (x.value?.fallback ?? x.value?.numberValue ?? null) : null;
}

function careerSection(sec) {
  if (!sec) return { clubs: [], seasons: [] };
  return {
    clubs: (sec.teamEntries || []).map((t) => ({
      teamId: num(t.teamId), team: clean(t.team), logo: img.team(num(t.teamId)),
      start: t.startDate ? t.startDate.slice(0, 10) : null, end: t.endDate ? t.endDate.slice(0, 10) : null, active: !!t.active,
      apps: num(t.appearances), goals: num(t.goals), assists: num(t.assists), uncertain: !!t.hasUncertainData || /\*/.test(`${t.appearances}${t.goals}`),
      loan: /loan/i.test(t.transferType || ''), role: t.role || null
    })),
    seasons: (sec.seasonEntries || []).map((s) => ({
      season: s.seasonName, teamId: num(s.teamId), team: clean(s.team), logo: img.team(num(s.teamId)),
      apps: num(s.appearances), goals: num(s.goals), assists: num(s.assists), rating: num(s.rating?.rating), loan: /loan/i.test(s.transferType || ''),
      comps: (s.tournamentStats || []).map((t) => ({ leagueId: num(t.leagueId), league: clean(t.leagueName), apps: num(t.appearances), goals: num(t.goals), assists: num(t.assists), rating: num(t.rating?.rating), friendly: !!t.isFriendly }))
    }))
  };
}

function player(p) {
  const id = num(p?.id);
  const info = p?.playerInformation || [];
  const ch = p?.careerHistory?.careerItems || {};
  const pos = p?.positionDescription || {};
  const trophies = [];
  for (const t of p?.trophies?.playerTrophies || []) for (const tr of t.tournaments || []) {
    trophies.push({ team: clean(t.teamName), teamId: num(t.teamId), league: clean(tr.leagueName), leagueId: num(tr.leagueId), won: tr.seasonsWon || [], runnerUp: tr.seasonsRunnerUp || [] });
  }
  return {
    id, name: clean(p?.name), photo: img.player(id), isCoach: !!p?.isCoach,
    birthDate: p?.birthDate?.utcTime ? p.birthDate.utcTime.slice(0, 10) : null,
    team: p?.primaryTeam ? { id: num(p.primaryTeam.teamId), name: clean(p.primaryTeam.teamName), loan: !!p.primaryTeam.onLoan, color: p.primaryTeam.teamColors?.color || null, logo: img.team(num(p.primaryTeam.teamId)) } : null,
    position: clean(pos.primaryPosition?.label) || null,
    positions: (pos.positions || []).map((x) => ({ short: x.strPosShort?.label, label: x.strPos?.label, main: !!x.isMainPosition, x: x.pitchPositionData?.right, y: x.pitchPositionData?.top })),
    height: infoValue(info, 'height_sentencecase'), shirt: infoValue(info, 'shirt'), age: infoValue(info, 'age_sentencecase'),
    foot: infoValue(info, 'preferred_foot'), country: infoValue(info, 'country_sentencecase'),
    ccode: (info.find((i) => i.countryCode) || {}).countryCode || null,
    value: infoValue(info, 'transfer_value'), contractEnd: p?.contractEnd?.utcTime ? p.contractEnd.utcTime.slice(0, 10) : null,
    injury: p?.injuryInformation ? clean(p.injuryInformation.name || p.injuryInformation.expectedReturn?.fallback || 'Injured') : null,
    season: p?.mainLeague ? { league: clean(p.mainLeague.leagueName), leagueId: num(p.mainLeague.leagueId), season: p.mainLeague.season, stats: (p.mainLeague.stats || []).map((s) => ({ title: clean(s.title), value: s.value })) } : null,
    career: { senior: careerSection(ch.senior), national: careerSection(ch['national team']), youth: careerSection(ch.youth), coach: careerSection(ch.coach) },
    trophies,
    recent: (p?.recentMatches || []).map((m) => ({
      id: num(m.id), kickoff: m.matchDate?.utcTime, league: clean(m.leagueName), leagueId: num(m.leagueId),
      team: clean(m.teamName), teamId: num(m.teamId), opp: clean(m.opponentTeamName), oppId: num(m.opponentTeamId), home: !!m.isHomeTeam,
      hs: m.homeScore, as: m.awayScore, mins: m.minutesPlayed, goals: m.goals, assists: m.assists, yc: m.yellowCards, rc: m.redCards,
      rating: num(m.ratingProps?.rating) || null, potm: !!m.playerOfTheMatch, bench: !!m.onBench && !m.playedInMatch
    })),
    traits: p?.traits ? { title: clean(p.traits.title), items: (p.traits.items || []).map((t) => ({ title: clean(t.title), value: t.value })) } : null,
    marketValues: (p?.marketValues?.values || []).map((v) => ({ date: String(v.date).slice(0, 10), value: v.value, team: clean(v.teamName) })),
    statSeasons: (p?.statSeasons || []).map((s) => ({ season: s.seasonName, comps: (s.tournaments || []).map((t) => ({ name: clean(t.name), id: num(t.tournamentId), entry: t.entryId })) })),
    deep: deepStats(p?.firstSeasonStats)
  };
}

/* season stat sheet for one competition (playerStats endpoint or firstSeasonStats) */
function deepStats(s) {
  if (!s) return null;
  const sections = (s.statsSection?.items || []).map((g) => ({
    title: clean(g.display === 'stats-group' ? g.title : g.title),
    items: (g.items || []).map((i) => ({ title: clean(i.title), value: i.statValue ?? i.value ?? null, per90: i.per90 ?? null, pct: i.percentileRank ?? null }))
  })).filter((g) => g.items.length);
  const top = (s.topStatCard?.items || []).map((i) => ({ title: clean(i.title), value: i.statValue, pct: i.percentileRank ?? null }));
  const shots = (s.shotmap || []).map((x) => ({ x: x.x, y: x.y, xg: x.expectedGoals ?? null, type: x.eventType, minute: x.min, matchId: num(x.matchId), onTarget: !!x.isOnTarget }));
  return { top, sections, shots };
}

/* ---------- search ---------- */
function search(payload) {
  const out = { players: [], teams: [], leagues: [] };
  const seen = new Set();
  for (const g of payload || []) for (const s of g.suggestions || []) {
    const key = `${s.type}:${s.id}`;
    if (seen.has(key)) continue; seen.add(key);
    const id = num(s.id);
    if (s.type === 'player') out.players.push({ id, name: clean(s.name), team: clean(s.teamName), coach: !!s.isCoach, photo: img.player(id) });
    else if (s.type === 'team') out.teams.push({ id, name: clean(s.name), country: s.countryCode || '', logo: img.team(id) });
    else if (s.type === 'league') out.leagues.push({ id, name: clean(s.name), country: s.ccode || '', logo: img.league(id) });
  }
  return out;
}

module.exports = { img, status, parseScore, matchFromList, matchDay, catalog, tables, league, leaderList, match, team, player, deepStats, search, clean, num };
