// Atoll — the Touchline plugin's data side. Same FotMob calls, normalizers, pacing and disk cache as Touchline
// (src/touchline/vendor is copied from apps/touchline/src/data), trimmed to what the island needs:
// today's matches to pick from, one match in detail, a team's next match, and team search.
'use strict';
const path = require('path');
const fs = require('fs');
const { Cache, MIN, HOUR, DAY } = require('./vendor/cache');
const { getJson } = require('./vendor/http');
const N = require('./vendor/normalize');
const espn = require('./vendor/espn');

const FM = 'https://www.fotmob.com/api/data';
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
const SCHEMA = 2;   // follows Touchline's SCHEMA; bump together
let cache = null;
let fixtures = null; // tests: a folder of saved responses (day, match, team, search .json.gz) read instead of the network

function init(dir, { fixtureDir = null } = {}) {
  cache = new Cache(path.join(dir, 'cache', `touchline-v${SCHEMA}`));
  if (fixtureDir) fixtures = fixtureDir;
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function fm(url, kind) {
  if (fixtures) {
    const f = path.join(fixtures, `${kind}.json.gz`);
    if (fs.existsSync(f)) return JSON.parse(require('zlib').gunzipSync(fs.readFileSync(f)).toString('utf8'));
    throw Object.assign(new Error('offline (test)'), { status: 0 });
  }
  if (process.env.ATOLL_FOTMOB_OFF) throw Object.assign(new Error('FotMob switched off for testing'), { status: 0 });
  return getJson(url);
}

/** Today's (or a date's) matches, grouped by competition, most important first. */
async function day(date, { force = false } = {}) {
  const d = date || today();
  const past = d < today();
  try {
    const r = await cache.get(`fm:day:${d}:${TZ}`, (v) => {
      if (v.leagues.some((l) => l.matches.some((m) => m.state === 'live'))) return 25e3;
      return past ? 14 * DAY : 2 * MIN;
    }, async () => N.matchDay(await fm(`${FM}/matches?date=${d.replace(/-/g, '')}&timezone=${encodeURIComponent(TZ)}&ccode3=USA`, 'day')), { force });
    return { ...r.value, _meta: { at: r.at, stale: !!r.stale, error: r.error || null } };
  } catch (err) {
    if (fixtures) throw err;
    const backup = await espn.matchDay(d, []);
    return { ...backup, _meta: { at: Date.now(), backup: 'ESPN', error: err.message } };
  }
}

async function match(id, { force = false } = {}) {
  const r = await cache.get(`fm:match:${id}`, (v) => (v.state === 'live' ? 20e3 : v.state === 'post' ? 30 * DAY : v.state === 'off' ? 6 * HOUR : (Date.parse(v.kickoff) - Date.now() < 2 * HOUR ? 2 * MIN : 30 * MIN)),
    async () => N.match(await fm(`${FM}/matchDetails?matchId=${id}`, 'match')), { force });
  return { ...r.value, _meta: { at: r.at, stale: !!r.stale, error: r.error || null } };
}

async function team(id, { force = false } = {}) {
  const r = await cache.get(`fm:team:${id}`, (v) => (v.fixtures.some((f) => f.state === 'live') ? 45e3 : 20 * MIN),
    async () => N.team(await fm(`${FM}/teams?id=${id}&ccode3=USA`, 'team')), { force });
  return r.value;
}

async function searchTeams(term) {
  const q = String(term || '').trim();
  if (q.length < 2) return [];
  const r = await cache.get(`fm:search:${q.toLowerCase()}`, 6 * HOUR, async () => N.search(await fm(`${FM}/search/suggest?term=${encodeURIComponent(q)}&lang=en`, 'search')));
  return (r.value.teams || []).slice(0, 8);
}

module.exports = { init, day, match, team, searchTeams, today, TZ, img: N.img };
