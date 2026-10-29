// Vantage — settings, bookmarks, session and history, kept as JSON in the app-data folder.
// vantage-data.json holds everything small; history.json is kept apart because it grows.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_SETTINGS = {
  theme: 'system',              // system | dark | light
  searchEngine: 'google',       // google | duckduckgo | bing | brave | startpage
  suggestions: true,            // the drop-down under the address bar at all
  engineSuggestions: true,      // ask the search engine for suggestions as you type
  signinMode: 'auto',           // browser identity on Google/Microsoft sign-in pages: auto | firefox | safari | edge | chrome
  accent: 'ocean',              // ocean | teal | violet | rose | amber | lime | graphite | custom
  accentCustom: '#3fa9f5',
  density: 'comfortable',       // comfortable | compact
  toolbar: { vpn: true, split: true, downloads: true, vault: true, library: true },
  bookmarkNames: true,          // names next to icons on the bookmarks bar
  miniPlayer: { auto: true, corner: 'br', size: 'm' },
  newtab: {
    bg: 'aurora',               // aurora | daily | image | plain
    image: '',
    clock24: false,
    city: '', units: 'auto',    // weather; units: auto | c | f
    shortcuts: 'auto',          // auto (most visited) | custom
    dial: [],
    widgets: { clock: true, weather: true, shortcuts: true, jump: true, readLater: true, privacy: true, notes: true }
  },
  startup: 'restore',           // restore | newtab
  tabsOnSide: false,
  bookmarksBar: true,
  sleepAfterMin: 30,            // 0 = never
  adblock: { enabled: true, strict: true, allow: [], custom: '' },
  httpsUpgrade: true,
  gpc: true,
  secureDns: 'automatic',       // off | automatic | secure
  dnsProvider: 'cloudflare',    // cloudflare | google | quad9 | nextdns
  downloadDir: '',
  askWhereToSave: false,
  fastDownloads: true,
  downloadConnections: 8,
  vault: { offerToSave: true, autofill: true, never: [] },
  vpn: { mode: 'off', killSwitch: true, webrtc: true, proxy: { type: 'socks5', host: '', port: 1080 } },
  containers: [
    { id: 'work', name: 'Work', color: '#4f8cff' },
    { id: 'personal', name: 'Personal', color: '#f59e0b' }
  ],
  sites: {}                     // host -> { zoom, dark, adblock:false, perms:{} }
};

let data = null, history = null, saveT = null, histT = null;
const file = () => path.join(app.getPath('userData'), 'vantage-data.json');
const hfile = () => path.join(app.getPath('userData'), 'history.json');

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = (base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null) ? merge(base[k], v) : v;
  return out;
}

function load() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch {}
  data = {
    settings: merge(DEFAULT_SETTINGS, raw.settings || {}),
    bookmarks: raw.bookmarks || [],
    session: raw.session || { windows: [] },
    downloads: raw.downloads || [],
    library: raw.library || { meta: {} },
    readerProgress: raw.readerProgress || {},
    mediaProgress: raw.mediaProgress || {},
    stats: raw.stats || { blocked: 0, since: Date.now() },
    secrets: raw.secrets || {},
    readLater: raw.readLater || [],
    notes: raw.notes || '',
    favicons: raw.favicons || {},
    migrated: raw.migrated || {}
  };
  try { history = JSON.parse(fs.readFileSync(hfile(), 'utf8')); } catch { history = []; }
  if (!Array.isArray(history)) history = [];
  return data;
}

function writeNow() {
  clearTimeout(saveT); saveT = null;
  try { fs.writeFileSync(file(), JSON.stringify(data, null, 1), { mode: 0o600 }); } catch (e) { console.error('save failed', e.message); }
}
function save() { clearTimeout(saveT); saveT = setTimeout(writeNow, 400); }
function writeHistoryNow() {
  clearTimeout(histT); histT = null;
  try { fs.writeFileSync(hfile(), JSON.stringify(history), { mode: 0o600 }); } catch {}
}
function saveHistory() { clearTimeout(histT); histT = setTimeout(writeHistoryNow, 2000); }
function flush() { if (saveT) writeNow(); if (histT) writeHistoryNow(); }

/* ---------- history ---------- */
const MAX_HISTORY = 20000;
function addVisit({ url, title }) {
  if (!/^https?:/i.test(url || '')) return;
  const now = Date.now();
  const last = history[history.length - 1];
  if (last && last.url === url && now - last.t < 30000) { if (title) last.title = title; return saveHistory(); }
  history.push({ url, title: title || '', t: now });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  saveHistory();
}
function setTitle(url, title) {
  for (let i = history.length - 1, n = 0; i >= 0 && n < 30; i--, n++) if (history[i].url === url) { history[i].title = title; saveHistory(); return; }
}
function searchHistory(q = '', limit = 200, before = Infinity) {
  q = String(q).toLowerCase().trim();
  const out = [];
  for (let i = history.length - 1; i >= 0 && out.length < limit; i--) {
    const h = history[i];
    if (h.t >= before) continue;
    if (q && !(h.url.toLowerCase().includes(q) || (h.title || '').toLowerCase().includes(q))) continue;
    out.push({ ...h, i });
  }
  return out;
}
// For omnibox suggestions: one row per URL, ranked by visit count and recency.
function frecent(q = '', limit = 8) {
  q = String(q).toLowerCase().trim();
  const map = new Map();
  const now = Date.now();
  for (let i = history.length - 1, n = 0; i >= 0 && n < 6000; i--, n++) {
    const h = history[i];
    const key = h.url.replace(/#.*$/, '');
    let r = map.get(key);
    if (!r) { r = { url: key, title: h.title, visits: 0, score: 0, t: h.t }; map.set(key, r); }
    r.visits++;
    r.score += 1 / (1 + (now - h.t) / 86400000 / 3);
    if (!r.title && h.title) r.title = h.title;
  }
  let list = [...map.values()];
  // sites you visit a lot rank higher as a whole, not just the exact page
  const hostOf = (u) => u.replace(/^https?:\/\/(www\.)?/i, '').split(/[/?#]/)[0];
  const perHost = new Map();
  for (const r of list) perHost.set(hostOf(r.url), (perHost.get(hostOf(r.url)) || 0) + r.score);
  for (const r of list) r.score += 0.35 * perHost.get(hostOf(r.url));
  if (q) {
    list = list.filter(r => r.url.toLowerCase().includes(q) || (r.title || '').toLowerCase().includes(q));
    const host = (u) => u.replace(/^https?:\/\/(www\.)?/i, '');
    list.forEach(r => { if (host(r.url).toLowerCase().startsWith(q)) r.score *= 3; });
  }
  return list.sort((a, b) => b.score - a.score).slice(0, limit);
}
function topSites(limit = 8) {
  const byHost = new Map();
  for (const r of frecent('', 400)) {
    let h; try { h = new URL(r.url).hostname.replace(/^www\./, ''); } catch { continue; }
    const cur = byHost.get(h);
    if (!cur) byHost.set(h, { host: h, url: new URL(r.url).origin, title: r.title, score: r.score });
    else cur.score += r.score;
  }
  return [...byHost.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
function deleteHistory({ urls, since, until, all } = {}) {
  if (all) history = [];
  else if (urls) { const set = new Set(urls); history = history.filter(h => !set.has(h.url)); }
  else if (since != null) history = history.filter(h => h.t < since || h.t > (until || Infinity));
  saveHistory();
}

module.exports = {
  load, save, flush, get: () => data, settings: () => data.settings, DEFAULT_SETTINGS, merge,
  addVisit, setTitle, searchHistory, frecent, topSites, deleteHistory, historyCount: () => history.length
};
