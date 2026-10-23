// A pretend computer for development on Linux and for the end-to-end test (SCENE_DEMO=1).
// Two displays, a dozen apps and their windows; launching, placing, hiding and quitting all change this state.
'use strict';

const DISPLAYS = [
  { id: 1, label: 'Built-in Retina Display', bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 33, width: 1512, height: 949 }, scaleFactor: 2, internal: true, primary: true },
  { id: 2, label: 'LG UltraFine', bounds: { x: 1512, y: -458, width: 2560, height: 1440 }, workArea: { x: 1512, y: -433, width: 2560, height: 1415 }, scaleFactor: 1, internal: false, primary: false }
];
const APPS = [
  { name: 'Google Chrome', bundleId: 'com.google.Chrome', path: '/Applications/Google Chrome.app' },
  { name: 'Slack', bundleId: 'com.tinyspeck.slackmacgap', path: '/Applications/Slack.app' },
  { name: 'Visual Studio Code', bundleId: 'com.microsoft.VSCode', path: '/Applications/Visual Studio Code.app' },
  { name: 'Spotify', bundleId: 'com.spotify.client', path: '/Applications/Spotify.app' },
  { name: 'Steam', bundleId: 'com.valvesoftware.steam', path: '/Applications/Steam.app' },
  { name: 'Discord', bundleId: 'com.hnc.Discord', path: '/Applications/Discord.app' },
  { name: 'Touchline', bundleId: 'com.bilal.touchline', path: '/Applications/Touchline.app' },
  { name: 'Docket', bundleId: 'com.bilal.docket', path: '/Applications/Docket.app' },
  { name: 'Datum', bundleId: 'com.bilal.datum', path: '/Applications/Datum.app' },
  { name: 'Lumen', bundleId: 'com.bilal.lumen', path: '/Applications/Lumen.app' },
  { name: 'Relay', bundleId: 'com.bilal.relay', path: '/Applications/Relay.app' },
  { name: 'Messages', bundleId: 'com.apple.MobileSMS', path: '/System/Applications/Messages.app' },
  { name: 'Notes', bundleId: 'com.apple.Notes', path: '/System/Applications/Notes.app' },
  { name: 'Finder', bundleId: 'com.apple.finder', path: '/System/Library/CoreServices/Finder.app' },
  { name: 'Adobe Photoshop 2025', bundleId: 'com.adobe.Photoshop', path: '/Applications/Adobe Photoshop 2025/Adobe Photoshop 2025.app' },
  { name: 'CapCut', bundleId: 'com.lemon.lvoverseas', path: '/Applications/CapCut.app' },
  { name: 'Safari', bundleId: 'com.apple.Safari', path: '/Applications/Safari.app' },
  { name: 'Mail', bundleId: 'com.apple.mail', path: '/System/Applications/Mail.app' },
  { name: 'Calendar', bundleId: 'com.apple.iCal', path: '/System/Applications/Calendar.app' }
];
const find = (n) => APPS.find((a) => a.name === n);
let nextPid = 500; const pidOf = new Map();
const pid = (a) => { if (!pidOf.has(a.name)) pidOf.set(a.name, nextPid++); return pidOf.get(a.name); };
let wins = [];
const W = (name, title, x, y, w, h, state = 'normal', front = false) => { const a = find(name); wins[front ? 'unshift' : 'push']({ id: 'w' + Math.random().toString(36).slice(2, 8), pid: pid(a), index: 0, app: { ...a, pid: pid(a) }, title, bounds: { x, y, width: w, height: h }, state }); };
W('Google Chrome', 'Inbox (3) - bilal@lytefiber.com - Gmail - Google Chrome', 1512, -433, 1280, 1415);
W('Google Chrome', 'Lyte Fiber — GA4 Reports - Google Chrome', 2792, -433, 1280, 1415);
W('Slack', 'Slack — Lyte Fiber', 40, 70, 980, 860);
W('Visual Studio Code', 'main.js — scene', 300, 90, 1180, 860);
W('Spotify', 'Spotify Premium', 160, 160, 1000, 700, 'minimized');
W('Finder', 'Downloads', 120, 120, 900, 560);
W('Notes', 'Notes', 260, 120, 820, 600);
let front = 'Slack';
let volume = { volume: 45, muted: false }; let appearance = 'dark';
const log = [];

function reindex() { const n = {}; for (const w of wins) { n[w.pid] = n[w.pid] || 0; w.index = n[w.pid]++; } }
async function snapshot() {
  reindex();
  const windows = wins.map((w) => ({ ...w, bounds: { ...w.bounds }, focused: w.app.name === front && w.index === 0 }));
  const apps = []; for (const w of windows) if (!apps.some((a) => a.name === w.app.name)) apps.push(w.app);
  return { windows, apps };
}
async function runningApps() { return (await snapshot()).apps; }
async function listApps() { return APPS.filter((a) => a.name !== 'Finder').map((a) => ({ ...a })); }
async function launch(app, { open = [] } = {}) {
  log.push(['launch', app.name, open]);
  const a = APPS.find((x) => x.name === app.name || x.bundleId === app.bundleId) || { ...app };
  const has = wins.some((w) => w.app.name === a.name);
  setTimeout(() => {
    if (!has || open.length) {
      const title = open.length ? `${String(open[0]).replace(/^https?:\/\/(www\.)?/, '').split('/')[0]} - ${a.name}` : a.name;
      W(a.name, title, 200 + Math.random() * 200, 140, 900, 640, 'normal', true);
    }
    front = a.name;
  }, 450);
  return { ok: true };
}
async function place(ops) {
  return ops.map((o) => {
    const w = wins.find((x) => x.id === o.win.id); if (!w) return { ok: false, error: 'window closed' };
    w.state = o.state === 'maximized' || o.state === 'fullscreen' ? o.state : o.state || 'normal';
    if (o.state !== 'minimized') w.bounds = { x: Math.round(o.rect.x), y: Math.round(o.rect.y), width: Math.round(o.rect.width), height: Math.round(o.rect.height) };
    return { ok: true };
  });
}
async function quit(apps) { log.push(['quit', apps.map((a) => a.name)]); wins = wins.filter((w) => !apps.some((a) => a.name === w.app.name)); return { ok: true }; }
async function hide(apps) { log.push(['hide', apps.map((a) => a.name)]); for (const w of wins) if (apps.some((a) => a.name === w.app.name)) w.state = 'minimized'; return { ok: true }; }
async function focus(app) { front = app.name; const mine = wins.filter((w) => w.app.name === app.name); wins = [...mine, ...wins.filter((w) => w.app.name !== app.name)]; return { ok: true }; }
module.exports = {
  name: 'demo', DISPLAYS, snapshot, runningApps, listApps, launch, place, quit, hide, focus,
  getVolume: async () => ({ ...volume }), setVolume: async (v) => { volume.volume = v; return { ok: true }; }, setMute: async (m) => { volume.muted = m; return { ok: true }; },
  getAppearance: async () => appearance, setAppearance: async (m) => { appearance = m; return { ok: true }; },
  setWallpaper: async (p) => { log.push(['wallpaper', p]); return { ok: true }; },
  listShortcuts: async () => ['Do Not Disturb On', 'Focus: Work', 'Focus: Gaming', 'Lights: Movie'],
  runShortcut: async (n) => { log.push(['shortcut', n]); return { ok: true }; },
  runCommand: async (c) => { log.push(['command', c]); return { ok: true, stdout: '' }; },
  supports: { fullscreen: true, shortcuts: true, wallpaper: true, appearance: true, volume: true, hide: true },
  log
};
