// Touchline — Wikidata career history. Fills the gaps FotMob has for older
// players: every club and national team with years, appearances and goals.
'use strict';
const { getJson } = require('./http');

const HEADERS = { 'user-agent': 'Touchline/0.1 (personal football stats app; desktop)', accept: 'application/sparql-results+json' };

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Find the Wikidata item for a footballer by name (optionally birth year to disambiguate). */
async function findPlayer(name, birthYear) {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=8&format=json`;
  const d = await getJson(url, { headers: { 'user-agent': HEADERS['user-agent'] } });
  const hits = (d.search || []).filter((x) => /football|soccer/i.test(x.description || ''));
  if (!hits.length) return null;
  if (birthYear) {
    const ids = hits.map((h) => `wd:${h.id}`).join(' ');
    const q = `SELECT ?p ?b WHERE { VALUES ?p { ${ids} } ?p wdt:P569 ?b }`;
    try {
      const r = await sparql(q);
      const match = r.find((x) => String(x.b).startsWith(String(birthYear)));
      if (match) return match.p.split('/').pop();
    } catch {}
  }
  const exact = hits.find((h) => norm(h.label) === norm(name));
  return (exact || hits[0]).id;
}

async function sparql(q) {
  const d = await getJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { headers: HEADERS, timeout: 30000 });
  return (d.results?.bindings || []).map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}

function shape(rows) {
  const clubs = [], national = [];
  for (const r of rows) {
    const label = r.teamLabel || '';
    const isNat = /national|under-\d+|\bU-?\d{2}\b/i.test(label) || r.nat === '1';
    const item = {
      team: label.replace(/ (men's )?national (association )?football team$/i, '').replace(/ national under-(\d+) (association )?football team$/i, ' U$1'),
      start: r.start ? r.start.slice(0, 4) : null, end: r.end ? r.end.slice(0, 4) : null,
      apps: r.apps != null ? Number(r.apps) : null, goals: r.goals != null ? Number(r.goals) : null,
      loan: /loan/i.test(r.qual || '')
    };
    (isNat ? national : clubs).push(item);
  }
  const byStart = (a, b) => String(a.start || '').localeCompare(String(b.start || ''));
  return { clubs: clubs.sort(byStart), national: national.filter((n) => !/ U\d+$/.test(n.team)).sort(byStart), youthNational: national.filter((n) => / U\d+$/.test(n.team)).sort(byStart) };
}

async function career(qid) {
  // one query: every team spell with dates, apps and goals, plus birth date and description
  const q = `SELECT ?teamLabel ?start ?end ?apps ?goals ?nat ?qual ?birth ?desc WHERE {
    { wd:${qid} p:P54 ?st. ?st ps:P54 ?team.
      OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end }
      OPTIONAL { ?st pq:P1350 ?apps } OPTIONAL { ?st pq:P1351 ?goals }
      OPTIONAL { ?st pq:P1642 ?q. ?q rdfs:label ?qual FILTER(lang(?qual)='en') }
      OPTIONAL { ?team wdt:P31 wd:Q6979593. BIND("1" AS ?nat) } }
    UNION { OPTIONAL { wd:${qid} wdt:P569 ?birth } OPTIONAL { wd:${qid} schema:description ?desc FILTER(lang(?desc)='en') } }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } ORDER BY ?start`;
  const all = await sparql(q);
  const facts = all.find((r) => r.birth || r.desc) || {};
  const rows = all.filter((r) => r.teamLabel);
  return { qid, ...shape(rows), birth: facts.birth ? facts.birth.slice(0, 10) : null, description: facts.desc || null, url: `https://www.wikidata.org/wiki/${qid}` };
}

module.exports = { findPlayer, career, shape, norm };
