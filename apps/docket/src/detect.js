// Notices when a call starts by reading window titles (the same list a screen-share picker shows).
// Nothing is recorded by this: it only tells the window "a Zoom meeting looks like it started".
const RULES = [
  { app: 'Zoom', re: /^(zoom meeting|zoom webinar)$/i, title: () => '' },
  { app: 'Zoom', re: /^zoom meeting\s*[-–—]\s*(.+)$/i, title: (m) => m[1] },
  { app: 'Microsoft Teams', re: /^(?:meeting (?:with|in) |call with )?(.+?)\s*\|\s*(?:meeting|call)?\s*\|?\s*microsoft teams/i, need: /(meeting|call|huddle|\bmeet\b)/i, title: (m) => m[1] },
  { app: 'Microsoft Teams', re: /^microsoft teams (?:meeting|call)$/i, title: () => '' },
  { app: 'Google Meet', re: /^meet\s*[-–—:]\s*(.+?)(?:\s*[-–—]\s*(?:google chrome|microsoft edge|brave|arc|safari|firefox|mozilla firefox|chromium|opera|vivaldi).*)?$/i, title: (m) => /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(m[1].trim()) ? '' : m[1] },
  { app: 'Google Meet', re: /google meet/i, need: /[a-z]{3}-[a-z]{4}-[a-z]{3}|meeting|call/i, title: () => '' },
  { app: 'Webex', re: /webex/i, need: /meeting|personal room|call/i, title: () => '' },
  { app: 'Slack', re: /huddle/i, need: /slack/i, title: () => '' },
  { app: 'FaceTime', re: /^facetime$/i, need: /^$/, title: () => '' }
];

function match(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  for (const r of RULES) {
    const m = n.match(r.re);
    if (!m) continue;
    if (r.need && !r.need.test(n)) continue;
    let title = String(r.title(m) || '').replace(/\s*\|\s*microsoft teams.*$/i, '').trim();
    if (/^(chat|calendar|activity|teams|calls?)$/i.test(title)) continue; // Teams tabs, not meetings
    return { app: r.app, title: title.slice(0, 80) };
  }
  return null;
}
function matchAll(names) {
  for (const n of names || []) { const m = match(n); if (m) return m; }
  return null;
}

// Polls every `every` ms while enabled. onStart fires once per call; onEnd after the window has been gone for `graceMs`.
function makeWatcher({ list, onStart, onEnd, every = 8000, graceMs = 25000 }) {
  let timer = null, current = null, lastSeen = 0, busy = false;
  async function tick() {
    if (busy) return; busy = true;
    try {
      const names = await list();
      const hit = matchAll(names);
      const now = Date.now();
      if (hit) {
        lastSeen = now;
        if (!current || current.app !== hit.app) { current = { ...hit, since: now }; onStart && onStart(current); }
      } else if (current && now - lastSeen > graceMs) {
        const ended = current; current = null; onEnd && onEnd(ended);
      }
    } catch (_) {}
    busy = false;
  }
  return {
    start() { if (!timer) { timer = setInterval(tick, every); tick(); } },
    stop() { clearInterval(timer); timer = null; current = null; },
    get current() { return current; },
    get running() { return !!timer; },
    tick
  };
}

module.exports = { match, matchAll, makeWatcher };
