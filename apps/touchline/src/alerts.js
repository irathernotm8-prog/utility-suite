// Touchline — match alerts for the teams you follow. While a followed team is
// playing today, the day's scores are checked every minute and a notification
// is shown for kick-off, goals, red cards and full time.
'use strict';
const { Notification } = require('electron');
const data = require('./data');
const store = require('./store');

let timer = null;
const seen = new Map(); // matchId -> { state, hs, as, red }
let onOpen = () => {};

function start(openMatch) {
  onOpen = openMatch || onOpen;
  stop();
  tick();
}
function stop() { clearTimeout(timer); timer = null; }

async function tick() {
  let next = 10 * 60 * 1000;
  try {
    const s = store.get();
    const teams = new Set((s.following.teams || []).map((t) => Number(t.id)));
    if (s.alerts.enabled && teams.size && Notification.isSupported()) {
      const day = await data.matchDay(null);
      const mine = day.leagues.flatMap((l) => l.matches).filter((m) => teams.has(m.home.id) || teams.has(m.away.id));
      for (const m of mine) check(m, s.alerts);
      const soon = mine.some((m) => m.state === 'live' || (m.state === 'pre' && Date.parse(m.kickoff) - Date.now() < 20 * 60 * 1000));
      next = soon ? 60 * 1000 : 10 * 60 * 1000;
    }
  } catch {}
  timer = setTimeout(tick, next);
}

function check(m, prefs) {
  const prev = seen.get(m.id);
  const now = { state: m.state, hs: m.home.score ?? 0, as: m.away.score ?? 0, red: (m.home.red || 0) + (m.away.red || 0) };
  seen.set(m.id, now);
  if (!prev) return;                                  // first sighting: just remember it
  const title = `${m.home.short || m.home.name} ${now.hs}–${now.as} ${m.away.short || m.away.name}`;
  if (prefs.kickoff && prev.state === 'pre' && now.state === 'live') notify('Kick-off', `${m.home.name} v ${m.away.name}`, m);
  if (prefs.goals && (now.hs > prev.hs || now.as > prev.as)) notify(`Goal! ${now.hs > prev.hs ? m.home.name : m.away.name}`, `${title} · ${m.label || ''}`, m);
  if (prefs.redCards && now.red > prev.red) notify('Red card', title, m);
  if (prefs.fulltime && prev.state === 'live' && now.state === 'post') notify('Full-time', title, m);
}

function notify(title, body, m) {
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => onOpen(m.id));
  n.show();
}

module.exports = { start, stop, check, seen };
