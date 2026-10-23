// Touchline — settings and follows, saved as one JSON file in the app-data folder.
'use strict';
const fs = require('fs');
const path = require('path');

// The competitions Football Hub covered, by FotMob id. Seasons are never stored:
// every season comes from the competition itself, so nothing breaks at rollover.
const DEFAULT_LEAGUES = [
  [47, 'Premier League'], [87, 'LaLiga'], [55, 'Serie A'], [54, 'Bundesliga'], [53, 'Ligue 1'],
  [42, 'Champions League'], [73, 'Europa League'], [10216, 'Conference League'],
  [48, 'Championship'], [132, 'FA Cup'], [133, 'EFL Cup'], [130, 'MLS'], [57, 'Eredivisie'], [61, 'Liga Portugal'],
  [71, 'Süper Lig'], [40, 'Belgian Pro League'], [64, 'Premiership'], [135, 'Super League Greece'], [252, 'HNL'],
  [230, 'Liga MX'], [268, 'Serie A Brazil'], [112, 'Liga Profesional'], [536, 'Saudi Pro League'],
  [77, 'World Cup'], [9806, 'UEFA Nations League']
].map(([id, name]) => ({ id, name }));

const DEFAULTS = {
  theme: 'dark',
  startPage: 'today',
  scope: 'following',            // matchday shows followed competitions first ('following') or everything ('all')
  following: { leagues: DEFAULT_LEAGUES, teams: [], players: [] },
  alerts: { enabled: true, goals: true, kickoff: true, fulltime: true, redCards: false },
  xis: [],
  widget: { open: false, pinned: true, filter: 'today', bounds: null },
  recent: [],
  window: null
};

let file = null;
let data = null;

function load(dir) {
  file = path.join(dir, 'settings.json');
  try { data = { ...structuredClone(DEFAULTS), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch { data = structuredClone(DEFAULTS); }
  data.following = { ...structuredClone(DEFAULTS.following), ...(data.following || {}) };
  data.alerts = { ...DEFAULTS.alerts, ...(data.alerts || {}) };
  return data;
}

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}
function flush() {
  clearTimeout(timer);
  if (!file || !data) return;
  try { fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2)); fs.renameSync(`${file}.tmp`, file); } catch {}
}

const get = () => data;
function set(patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'window') continue;
    data[k] = v;
  }
  save();
  return publicState();
}

function toggleFollow(kind, item) {
  const list = data.following[kind] || (data.following[kind] = []);
  const i = list.findIndex((x) => Number(x.id) === Number(item.id));
  if (i >= 0) list.splice(i, 1); else list.push({ id: Number(item.id), name: item.name || '', extra: item.extra || null });
  save();
  return publicState();
}

function reorderFollow(kind, ids) {
  const list = data.following[kind] || [];
  const byId = new Map(list.map((x) => [Number(x.id), x]));
  data.following[kind] = ids.map((id) => byId.get(Number(id))).filter(Boolean).concat(list.filter((x) => !ids.map(Number).includes(Number(x.id))));
  save();
  return publicState();
}

function publicState() {
  const { window, ...rest } = data;
  return rest;
}

module.exports = { load, get, set, save, flush, toggleFollow, reorderFollow, publicState, DEFAULTS, DEFAULT_LEAGUES };
