// Touchline — the data API the window talks to. Every call goes through the
// cache, picks a lifetime that suits the data (a finished match never changes;
// a live one changes every minute), and falls back to ESPN or saved copies.
'use strict';
const path = require('path');
const fs = require('fs');
const { Cache, MIN, HOUR, DAY } = require('./cache');
const { getJson } = require('./http');
const N = require('./normalize');
const espn = require('./espn');
const wiki = require('./wikidata');

const FM = 'https://www.fotmob.com/api/data';
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();

// Bump SCHEMA whenever normalize.js changes the shape of what it returns, so
// saved copies from an older version of Touchline are fetched again.
const SCHEMA = 2;
let cache = null;
let legendsData = null;
const status = { fotmob: 'unknown', lastError: null, lastOk: null };

function init(dir) { cache = new Cache(path.join(dir, 'cache', `data-v${SCHEMA}`)); cleanOld(dir); }

function cleanOld(dir) {
  try { for (const n of fs.readdirSync(path.join(dir, 'cache'))) if (/^data(-v\d+)?$/.test(n) && n !== `data-v${SCHEMA}`) fs.rmSync(path.join(dir, 'cache', n), { recursive: true, force: true }); } catch {}
}

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function fm(url) {
  try {
    if (process.env.TOUCHLINE_FOTMOB_OFF) throw Object.assign(new Error('FotMob switched off for testing'), { status: 0 });
    const v = await getJson(url);
    status.fotmob = 'ok'; status.lastOk = Date.now();
    return v;
  } catch (err) {
    if (err.status !== 404) { status.fotmob = 'down'; status.lastError = err.message; }
    throw err;
  }
}

const meta = (r, extra = {}) => ({ ...r.value, _meta: { at: r.at, stale: !!r.stale, error: r.error || null, ...extra } });

/* ---------- matches ---------- */
async function matchDay(date, { force = false, leagueIds = [] } = {}) {
  const day = date || todayStr();
  const isPast = day < todayStr();
  const isFuture = day > todayStr();
  const key = `fm:day:${day}:${TZ}`;
  try {
    const r = await cache.get(key, (v) => {
      const live = v.leagues.some((l) => l.matches.some((m) => m.state === 'live'));
      if (live) return 25 * 1000;
      if (isPast) { const pending = v.leagues.some((l) => l.matches.some((m) => m.state === 'pre')); return pending ? 30 * MIN : 14 * DAY; }
      return isFuture ? 20 * MIN : 2 * MIN;
    }, async () => N.matchDay(await fm(`${FM}/matches?date=${day.replace(/-/g, '')}&timezone=${encodeURIComponent(TZ)}&ccode3=USA`)), { force });
    return meta(r);
  } catch (err) {
    const backup = await espn.matchDay(day, leagueIds);
    return { ...backup, _meta: { at: Date.now(), stale: false, backup: 'ESPN', error: err.message } };
  }
}

async function match(id, { force = false } = {}) {
  const r = await cache.get(`fm:match:${id}`, (v) => (v.state === 'live' ? 20 * 1000 : v.state === 'post' ? 30 * DAY : v.state === 'off' ? 6 * HOUR : (Date.parse(v.kickoff) - Date.now() < 2 * HOUR ? 2 * MIN : 30 * MIN)),
    async () => N.match(await fm(`${FM}/matchDetails?matchId=${id}`)), { force });
  return meta(r);
}

/* ---------- competitions ---------- */
async function catalog({ force = false } = {}) {
  const r = await cache.get('fm:catalog', 7 * DAY, async () => N.catalog(await fm(`${FM}/allLeagues?locale=en&country=USA`)), { force });
  return meta(r);
}

async function league(id, season, { force = false } = {}) {
  const key = `fm:league:${id}:${season || 'current'}`;
  try {
    const r = await cache.get(key, (v) => {
      if (season && v.latestSeason && season !== v.latestSeason) return 60 * DAY;        // past seasons don't change
      return v.fixtures.some((m) => m.state === 'live') ? 45 * 1000 : 10 * MIN;
    }, async () => N.league(await fm(`${FM}/leagues?id=${id}&ccode3=USA${season ? `&season=${encodeURIComponent(season)}` : ''}`)), { force });
    return meta(r);
  } catch (err) {
    const t = await espn.table(Number(id)).catch(() => null);
    if (!t) throw err;
    return { id: Number(id), name: t.name, logo: N.img.league(Number(id)), tables: t.tables, fixtures: [], rounds: [], seasons: [], honours: [], leaders: { players: [], teams: [] }, bracket: null, tabs: ['table'], _meta: { at: Date.now(), backup: 'ESPN', error: err.message } };
  }
}

async function leaders(url, { force = false } = {}) {
  if (!/^https:\/\/data\.fotmob\.com\/stats\//.test(url)) throw new Error('Unsupported stats link');
  const r = await cache.get(`fm:leaders:${url}`, 3 * HOUR, async () => ({ list: N.leaderList(await getJson(url)) }), { force });
  return meta(r);
}

/* ---------- teams & players ---------- */
async function team(id, { force = false } = {}) {
  const r = await cache.get(`fm:team:${id}`, (v) => (v.fixtures.some((f) => f.state === 'live') ? 45 * 1000 : 20 * MIN),
    async () => N.team(await fm(`${FM}/teams?id=${id}&ccode3=USA`)), { force });
  return meta(r);
}

async function player(id, { force = false } = {}) {
  const r = await cache.get(`fm:player:${id}`, 4 * HOUR, async () => N.player(await fm(`${FM}/playerData?id=${id}`)), { force });
  return meta(r);
}

async function playerSeason(id, entry, { force = false } = {}) {
  const r = await cache.get(`fm:pstats:${id}:${entry}`, (v) => (String(entry).startsWith('0-') ? 4 * HOUR : 60 * DAY),
    async () => ({ deep: N.deepStats(await fm(`${FM}/playerStats?playerId=${id}&seasonId=${encodeURIComponent(entry)}&isFirstSeason=false`)) }), { force });
  return meta(r);
}

async function search(term) {
  const q = String(term || '').trim();
  if (q.length < 2) return { players: [], teams: [], leagues: [] };
  const r = await cache.get(`fm:search:${q.toLowerCase()}`, 6 * HOUR, async () => N.search(await fm(`${FM}/search/suggest?term=${encodeURIComponent(q)}&lang=en`)));
  const legends = (loadLegends().list || []).filter((l) => wiki.norm(l.name).includes(wiki.norm(q))).slice(0, 5);
  return { ...r.value, legends };
}

/* ---------- history (Wikidata) ---------- */
async function history(name, birthYear, { force = false } = {}) {
  const key = `wd:career:${wiki.norm(name)}:${birthYear || ''}`;
  const r = await cache.get(key, 30 * DAY, async () => {
    const qid = await wiki.findPlayer(name, birthYear);
    if (!qid) return { qid: null, clubs: [], national: [], youthNational: [] };
    return wiki.career(qid);
  }, { force });
  return meta(r);
}

/* ---------- legends (bundled) ---------- */
function loadLegends() {
  if (!legendsData) {
    try { legendsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'legends.json'), 'utf8')); }
    catch { legendsData = { list: [] }; }
  }
  return legendsData;
}

function cacheInfo() { return cache.size(); }
function clearCache() { cache.clear(); }

module.exports = { init, matchDay, match, catalog, league, leaders, team, player, playerSeason, search, history, legends: loadLegends, cacheInfo, clearCache, status, TZ, todayStr };
