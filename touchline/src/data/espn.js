// Touchline — ESPN backup feed. Used only when FotMob can't be reached, for
// the two things you most need: the day's scores and league tables.
// ESPN has different team IDs, so backup rows are marked source: 'espn'.
'use strict';
const { getJson } = require('./http');

// FotMob league id -> ESPN league slug
const SLUGS = {
  47: 'eng.1', 48: 'eng.2', 132: 'eng.fa', 133: 'eng.league_cup', 87: 'esp.1', 55: 'ita.1', 53: 'fra.1', 54: 'ger.1',
  57: 'ned.1', 61: 'por.1', 71: 'tur.1', 40: 'bel.1', 135: 'gre.1', 64: 'sco.1', 130: 'usa.1', 230: 'mex.1',
  112: 'arg.1', 268: 'bra.1', 536: 'ksa.1', 42: 'uefa.champions', 73: 'uefa.europa', 10216: 'uefa.europa.conf',
  77: 'fifa.world', 9806: 'uefa.nations', 50: 'uefa.euro', 44: 'conmebol.america', 76: 'fifa.cwc', 9134: 'usa.nwsl'
};

const ymd = (d) => d.replace(/-/g, '');

function stateOf(t = {}) {
  if (t.state === 'post') return { state: 'post', label: t.shortDetail || 'FT' };
  if (t.state === 'in') return { state: 'live', label: (t.shortDetail || '').replace(/\s+/g, '') || 'Live' };
  if (/postpon|cancel/i.test(t.description || '')) return { state: 'off', label: t.description };
  return { state: 'pre', label: '' };
}

async function matchDay(date, leagueIds) {
  const ids = leagueIds.filter((id) => SLUGS[id]);
  const out = [];
  await Promise.all(ids.map(async (id) => {
    try {
      const d = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${SLUGS[id]}/scoreboard?dates=${ymd(date)}`, { retries: 1 });
      const matches = (d.events || []).map((e) => {
        const c = e.competitions?.[0] || {};
        const st = stateOf(e.status?.type);
        const team = (ha) => {
          const x = (c.competitors || []).find((k) => k.homeAway === ha) || {};
          return { id: null, name: x.team?.displayName || '', short: x.team?.shortDisplayName || x.team?.displayName || '', score: st.state === 'pre' ? null : Number(x.score), red: 0, logo: x.team?.logo || null };
        };
        return { id: `espn-${e.id}`, source: 'espn', leagueId: id, primaryLeagueId: id, leagueName: d.leagues?.[0]?.name || '', kickoff: e.date, ...st, detail: st.label, home: team('home'), away: team('away') };
      });
      if (matches.length) out.push({ id, primaryId: id, name: d.leagues?.[0]?.name || '', ccode: '', logo: d.leagues?.[0]?.logos?.[0]?.href || null, rank: 0, matches, source: 'espn' });
    } catch {}
  }));
  return { date, leagues: out, source: 'espn' };
}

async function table(leagueId) {
  const slug = SLUGS[leagueId];
  if (!slug) return null;
  const d = await getJson(`https://site.web.api.espn.com/apis/v2/sports/soccer/${slug}/standings`);
  const groups = (d.children || []).map((ch) => ({
    name: ch.name,
    legend: [],
    views: {
      all: (ch.standings?.entries || []).map((en, i) => {
        const s = Object.fromEntries((en.stats || []).map((x) => [x.name, x.value]));
        return {
          pos: s.rank || i + 1,
          team: { id: null, name: en.team?.displayName, short: en.team?.shortDisplayName || en.team?.displayName, logo: en.team?.logos?.[0]?.href || null },
          p: s.gamesPlayed, w: s.wins, d: s.ties, l: s.losses, gf: s.pointsFor, ga: s.pointsAgainst, gd: s.pointDifferential, pts: s.points,
          qual: en.note ? { color: en.note.color, label: en.note.description } : null
        };
      })
    }
  }));
  return { tables: groups, source: 'espn', name: d.name };
}

module.exports = { SLUGS, matchDay, table };
