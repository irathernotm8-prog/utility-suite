// Touchline — quick Node checks on saved FotMob responses (no network).
// Run: npm test
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');
const assert = require('assert/strict');
const N = require('../src/data/normalize');
const { Cache } = require('../src/data/cache');
const wiki = require('../src/data/wikidata');

const fx = (name) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', name))).toString());
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('status: finished, live, half-time, postponed, not started', () => {
  assert.deepEqual(N.status({ finished: true, started: true, reason: { short: 'FT', long: 'Full-Time' } }).state, 'post');
  const live = N.status({ started: true, ongoing: true, liveTime: { short: '56‎’‎', long: '55:46' } });
  assert.equal(live.state, 'live'); assert.equal(live.label, '56’'); assert.equal(live.minute, 55);
  assert.equal(N.status({ started: true, reason: { short: 'HT', shortKey: 'halftime_short' } }).label, 'HT');
  assert.equal(N.status({ cancelled: true, reason: { long: 'Postponed' } }).label, 'Postponed');
  assert.equal(N.status({}).state, 'pre');
  assert.deepEqual(N.parseScore('3 - 0'), [3, 0]);
});

test('matches by date: grouped by competition with logos and states', () => {
  const d = N.matchDay(fx('matches-day.json.gz'));
  assert.ok(d.leagues.length >= 5);
  const epl = d.leagues.find((l) => l.primaryId === 47);
  assert.ok(epl, 'Premier League present');
  for (const m of epl.matches) { assert.ok(m.id && m.home.name && m.away.name && m.kickoff); assert.ok(['pre', 'live', 'post', 'off'].includes(m.state)); }
  const anyLive = d.leagues.flatMap((l) => l.matches).find((m) => m.state === 'live');
  if (anyLive) assert.ok(anyLive.label);
});

test('league: table views, legend, fixtures by round, honours back to the 1800s, leaders', () => {
  const L = N.league(fx('league-epl.json.gz'));
  assert.equal(L.id, 47); assert.equal(L.name, 'Premier League');
  assert.ok(L.seasons.includes(L.latestSeason));
  const t = L.tables[0];
  assert.equal(t.views.all.length, 20);
  assert.ok(t.views.home && t.views.away && t.views.xg, 'home/away/xg views');
  const top = t.views.all[0];
  assert.ok(top.team.id && top.pts >= 0 && top.gf >= 0 && top.qual && top.qual.color);
  assert.equal(L.fixtures.length, 380);
  assert.equal(L.rounds.length, 38);
  assert.ok(L.activeRound);
  assert.ok(L.honours.length > 100 && L.honours.at(-1).season.startsWith('1888'));
  assert.ok(L.leaders.players.find((x) => x.key === 'goals').top.length === 3);
});

test('league: group tables and knockout bracket (World Cup), cup without a table (FA Cup)', () => {
  const W = N.league(fx('league-worldcup.json.gz'));
  assert.ok(W.tables.length >= 8, 'groups');
  assert.ok(W.bracket && W.bracket.length >= 4);
  const final = W.bracket.at(-1);
  assert.ok(/Final/.test(final.name) && final.ties.length >= 1);
  assert.ok(W.seasons.includes('2022'));
  const F = N.league(fx('league-facup.json.gz'));
  assert.equal(F.tables.length, 0);
  assert.ok(F.bracket && F.bracket[0].ties.length > 10);
});

test('full leader list (gzipped stats file)', () => {
  const list = N.leaderList(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'leaders-goals.gz'))).toString()));
  assert.ok(list.length > 10);
  assert.equal(list[0].rank, 1); assert.ok(list[0].name && list[0].teamId && list[0].value > 0);
});

test('match: events, lineups on a pitch, stats, shot map, momentum, h2h, venue', () => {
  const M = N.match(fx('match.json.gz'));
  assert.equal(M.state, 'post');
  assert.equal(M.home.score, 5); assert.equal(M.away.score, 0);
  const goals = M.events.filter((e) => e.kind === 'goal');
  assert.equal(goals.length, 5);
  assert.ok(goals[0].ownGoal);
  assert.ok(M.events.some((e) => e.kind === 'sub' && e.on && e.off));
  assert.ok(M.events.some((e) => e.kind === 'yellow'));
  assert.equal(M.lineups.home.starters.length, 11);
  assert.ok(M.lineups.home.formation);
  assert.ok(M.lineups.home.starters.every((p) => p.x != null && p.y != null));
  assert.ok(M.stats.find((g) => /xG|Expected/i.test(g.title)));
  assert.ok(M.shots.length > 10 && M.shots.some((s) => s.xg != null));
  assert.ok(M.momentum.length > 80);
  assert.ok(M.h2h.matches.length > 0);
  assert.ok(M.venue.name && M.referee.name);
  assert.ok(M.potm && M.potm.rating);
});

test('team: squad groups, fixtures, trophies, league finishes, coaches', () => {
  const T = N.team(fx('team.json.gz'));
  assert.equal(T.id, 10204);
  assert.ok(T.squad.length >= 4 && T.squad.some((g) => g.members.length > 5));
  assert.ok(T.fixtures.length > 20);
  assert.ok(T.ranks.length > 10 && T.ranks[0].season);
  assert.ok(T.coaches.length > 5);
  assert.ok(T.tables.length >= 1);
});

test('player: profile, club + national + season-by-season career, trophies, recent form, value history', () => {
  const P = N.player(fx('player.json.gz'));
  assert.equal(P.name, 'Erling Haaland');
  assert.ok(P.team.id && P.position && P.height && P.foot);
  assert.ok(P.career.senior.clubs.length >= 4);
  assert.ok(P.career.senior.seasons.length >= 8 && P.career.senior.seasons[0].comps.length >= 1);
  assert.ok(P.career.national.clubs.length >= 1);
  assert.ok(P.trophies.length > 3);
  assert.ok(P.recent.length > 3);
  assert.ok(P.marketValues.length > 5);
  assert.ok(P.statSeasons.length > 3);
  assert.ok(P.deep && P.deep.top.length && P.deep.sections.length);
  const S = N.deepStats(fx('player-season.json.gz'));
  assert.ok(S.sections[0].items.some((i) => i.title === 'Goals'));
});

test('search and league catalog', () => {
  const s = N.search(fx('search.json.gz'));
  assert.equal(s.players[0].name, 'Thierry Henry');
  const c = N.catalog(fx('catalog.json.gz'));
  assert.ok(c.leagues.length > 300);
  assert.ok(c.popular.includes(47));
  assert.ok(c.leagues.find((l) => l.id === 42).country === 'International');
});

test('wikidata career rows split clubs, senior national team and youth sides', () => {
  const r = wiki.shape([
    { teamLabel: 'AS Monaco FC', start: '1994-01-01T00:00:00Z', end: '1999-01-01T00:00:00Z', apps: '105', goals: '20' },
    { teamLabel: "France men's national association football team", start: '1997-01-01T00:00:00Z', end: '2010-01-01T00:00:00Z', apps: '123', goals: '51', nat: '1' },
    { teamLabel: 'France national under-21 association football team', start: '1997-01-01', apps: '6', goals: '1' },
    { teamLabel: 'Arsenal F.C.', start: '1999-08-03T00:00:00Z', end: '2007-01-01T00:00:00Z', apps: '377', goals: '228' }
  ]);
  assert.deepEqual(r.clubs.map((c) => c.team), ['AS Monaco FC', 'Arsenal F.C.']);
  assert.equal(r.national[0].team, 'France'); assert.equal(r.national[0].apps, 123);
  assert.equal(r.youthNational[0].team, 'France U21');
});

test('cache: fresh hits, expiry, offline fallback marks stale', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-cache-'));
  const c = new Cache(dir);
  let calls = 0;
  const a = await c.get('k', 1000, async () => ++calls);
  const b = await c.get('k', 1000, async () => ++calls);
  assert.equal(a.value, 1); assert.equal(b.value, 1); assert.ok(b.fromCache);
  const c2 = new Cache(dir);                       // survives restart (disk)
  assert.equal((await c2.get('k', 1000, async () => 99)).value, 1);
  const forced = await c2.get('k', 1000, async () => { throw new Error('offline'); }, { force: true });
  assert.equal(forced.value, 1); assert.ok(forced.stale);
  await assert.rejects(() => c2.get('none', 1000, async () => { throw new Error('offline'); }));
  const z = await c2.get('t', () => 0, async () => 5);
  assert.equal(z.value, 5);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('legends: bundled Hall of Fame with photos and careers', () => {
  const L = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'legends.json'), 'utf8'));
  assert.ok(L.list.length >= 160);
  for (const p of L.list) {
    assert.ok(p.name && p.group, p.name);
    if (p.photo) assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'renderer', p.photo)), p.photo);
  }
  assert.ok(L.list.filter((p) => p.career.length).length > 150);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`  ✓ ${t.name}`); }
    catch (err) { failed++; console.log(`  ✗ ${t.name}\n    ${err.stack.split('\n').slice(0, 3).join('\n    ')}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
