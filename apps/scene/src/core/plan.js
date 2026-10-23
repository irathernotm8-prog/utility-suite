// Pure planning helpers: no Electron, no system calls, so they're easy to test (test/run.js).
// Coordinates are always global "points" (Electron DIP): origin at the top-left of the main display.
'use strict';

const uid = (p = '') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lc = (s) => String(s || '').toLowerCase();

// ---------------------------------------------------------------- displays
/** A compact, serialisable description of an Electron display. */
function describeDisplay(d, i = 0) {
  return {
    id: String(d.id), label: d.label || (d.internal ? 'Built-in display' : `Display ${i + 1}`),
    bounds: rect(d.bounds), workArea: rect(d.workArea), scale: d.scaleFactor || 1,
    primary: !!d.primary, internal: !!d.internal,
    key: displayKey(d)
  };
}
const rect = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
/** Stable-ish key used when the OS id changes (new cable, different port): name + resolution. */
function displayKey(d) { return `${lc(d.label || (d.internal ? 'built-in' : 'display'))}|${Math.round(d.bounds.width)}x${Math.round(d.bounds.height)}`; }

/**
 * Map each saved display to one of the current displays.
 * Order of preference: same OS id, same name and size, same name, same size, same side (left-to-right order),
 * otherwise the primary display. Returns { [savedId]: currentDisplay, ... } and which ones fell back.
 */
function matchDisplays(saved, current) {
  const map = {}; const fallback = []; const used = new Set();
  const primary = current.find((d) => d.primary) || current[0];
  const tryPass = (test) => {
    for (const s of saved) {
      if (map[s.id]) continue;
      const c = current.find((x) => !used.has(x.id) && test(s, x));
      if (c) { map[s.id] = c; used.add(c.id); }
    }
  };
  tryPass((s, c) => s.id === c.id && lc(s.label) === lc(c.label));
  tryPass((s, c) => s.key === c.key);
  tryPass((s, c) => lc(s.label) === lc(c.label) && s.internal === c.internal);
  tryPass((s, c) => s.internal && c.internal);
  tryPass((s, c) => s.bounds.width === c.bounds.width && s.bounds.height === c.bounds.height);
  tryPass((s, c) => s.id === c.id);
  // same position in left-to-right order
  const order = (arr) => [...arr].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  const so = order(saved), co = order(current);
  for (const s of saved) {
    if (map[s.id]) continue;
    const c = co[so.indexOf(s)];
    if (c && !used.has(c.id)) { map[s.id] = c; used.add(c.id); }
  }
  for (const s of saved) if (!map[s.id]) { map[s.id] = primary; fallback.push(s.id); }
  return { map, fallback };
}

/** Which display holds most of rect r? */
function displayForRect(r, displays) {
  let best = null, bestA = -1;
  for (const d of displays) {
    const b = d.bounds;
    const w = Math.min(r.x + r.width, b.x + b.width) - Math.max(r.x, b.x);
    const h = Math.min(r.y + r.height, b.y + b.height) - Math.max(r.y, b.y);
    const a = Math.max(0, w) * Math.max(0, h);
    if (a > bestA) { bestA = a; best = d; }
  }
  if (bestA <= 0) {  // off-screen: nearest centre
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    best = displays.slice().sort((a, b) => dist(a) - dist(b))[0];
    function dist(d) { const b = d.bounds; return Math.hypot(b.x + b.width / 2 - cx, b.y + b.height / 2 - cy); }
  }
  return best;
}

/** Absolute rect -> fractions of a display's work area (so a layout survives resolution changes). */
function toFrac(r, d) {
  const wa = d.workArea;
  const f = (v) => Math.round(v * 10000) / 10000;
  return { x: f((r.x - wa.x) / wa.width), y: f((r.y - wa.y) / wa.height), w: f(r.width / wa.width), h: f(r.height / wa.height) };
}
/** Fractions -> absolute rect inside a display's work area, kept on screen. */
function fromFrac(fr, d) {
  const wa = d.workArea;
  let w = Math.round(clamp(fr.w, 0.05, 1) * wa.width), h = Math.round(clamp(fr.h, 0.05, 1) * wa.height);
  let x = Math.round(wa.x + fr.x * wa.width), y = Math.round(wa.y + fr.y * wa.height);
  x = clamp(x, wa.x, wa.x + wa.width - Math.min(w, wa.width)); y = clamp(y, wa.y, wa.y + wa.height - Math.min(h, wa.height));
  w = Math.min(w, wa.width); h = Math.min(h, wa.height);
  return { x, y, width: w, height: h };
}

// ---------------------------------------------------------------- apps & windows
/** One key per app across both systems: bundle id on a Mac, exe path or Store app id on Windows, else the name. */
function appKey(a) {
  if (!a) return '';
  if (a.bundleId) return 'b:' + lc(a.bundleId);
  if (a.path) return 'p:' + lc(String(a.path).replace(/\\/g, '/'));
  if (a.aumid) return 'u:' + lc(a.aumid);
  return 'n:' + lc(a.name);
}
const baseName = (p) => lc(String(p || '').split(/[\\/]/).pop().replace(/\.(app|exe)$/i, ''));
/** Does a live window/app belong to a saved app? Tolerant of paths that moved and of name-only Windows Store apps. */
function sameApp(saved, live) {
  if (!saved || !live) return false;
  if (saved.bundleId && live.bundleId) return lc(saved.bundleId) === lc(live.bundleId);
  if (saved.path && live.path && lc(saved.path.replace(/\\/g, '/')) === lc(live.path.replace(/\\/g, '/'))) return true;
  if (saved.path && live.path && baseName(saved.path) === baseName(live.path) && baseName(saved.path)) return true;
  if (saved.aumid && live.aumid) return lc(saved.aumid) === lc(live.aumid);
  const sn = lc(saved.name), ln = lc(live.name);
  return !!sn && (sn === ln || (live.path && baseName(live.path) === sn));
}

// Titles like "Inbox (3) - Gmail - Google Chrome": drop the app name, counters and punctuation, keep words.
function titleWords(t, appName) {
  let s = lc(t).replace(/\(\d+\)/g, ' ');
  if (appName) s = s.split(lc(appName)).join(' ');
  return new Set(s.split(/[^a-z0-9]+/i).filter((w) => w.length > 1));
}
function titleScore(a, b, appName) {
  if (!a || !b) return 0;
  if (lc(a) === lc(b)) return 1;
  const A = titleWords(a, appName), B = titleWords(b, appName);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.max(A.size, B.size);
}

/**
 * Pair saved window rules with live windows of the same app.
 * New windows (ones that appeared after we opened something) are preferred for rules flagged `fresh`.
 * Exact titles first, then the best word overlap, then whatever is left in front-to-back order.
 * Returns [{ rule, win }] for every rule that got a window.
 */
function matchWindows(rules, wins, { appName = '', fresh = new Set() } = {}) {
  const pairs = []; const usedR = new Set(); const usedW = new Set();
  const take = (r, w) => { pairs.push({ rule: r, win: w }); usedR.add(r); usedW.add(w); };
  // fresh rules grab fresh windows first (in order)
  const freshWins = wins.filter((w) => fresh.has(w.id));
  for (const r of rules.filter((x) => x.fresh)) { const w = freshWins.find((x) => !usedW.has(x)); if (w) take(r, w); }
  for (const r of rules) { if (usedR.has(r) || r.match === 'any') continue; const w = wins.find((x) => !usedW.has(x) && r.title && lc(x.title) === lc(r.title)); if (w) take(r, w); }
  const cands = [];
  for (const r of rules) if (!usedR.has(r) && r.match !== 'any') for (const w of wins) if (!usedW.has(w)) { const s = titleScore(r.title, w.title, appName); if (s >= 0.34) cands.push({ r, w, s }); }
  cands.sort((a, b) => b.s - a.s);
  for (const c of cands) if (!usedR.has(c.r) && !usedW.has(c.w)) take(c.r, c.w);
  for (const r of rules) { if (usedR.has(r) || r.match === 'title-only') continue; const w = wins.find((x) => !usedW.has(x)); if (w) take(r, w); }
  return pairs;
}

// ---------------------------------------------------------------- capture
// Apps that are part of the system, never captured and never quit.
const PROTECTED = new Set([
  'b:com.apple.finder', 'b:com.apple.dock', 'b:com.apple.systemuiserver', 'b:com.apple.loginwindow', 'b:com.apple.controlcenter',
  'b:com.apple.notificationcenterui', 'b:com.apple.windowmanager', 'b:com.apple.wallpaper.agent', 'b:com.apple.spotlight', 'b:com.bilal.scene',
  'b:com.github.electron'
]);
const PROTECTED_EXE = new Set(['explorer', 'scene', 'applicationframehost', 'shellexperiencehost', 'searchhost', 'startmenuexperiencehost', 'textinputhost', 'lockapp', 'systemsettings', 'electron', 'dwm', 'taskmgr']);
function isProtected(a) {
  if (!a) return true;
  if (PROTECTED.has(appKey(a))) return true;
  if (a.path && PROTECTED_EXE.has(baseName(a.path))) return true;
  if (!a.bundleId && !a.path && /^(finder|dock|explorer|scene)$/i.test(a.name || '')) return true;
  return false;
}

/**
 * Turn a live snapshot ({ displays, windows }) into scene app rules.
 * `include` (optional set of app keys) limits which apps are taken; minimised windows are kept as minimised.
 */
function captureApps(snapshot, { include = null, keepMinimized = true } = {}) {
  const byApp = new Map();
  for (const w of snapshot.windows) {
    if (isProtected(w.app)) continue;
    const k = appKey(w.app);
    if (include && !include.has(k)) continue;
    if (w.state === 'minimized' && !keepMinimized) continue;
    if (!byApp.has(k)) byApp.set(k, { id: uid('a'), name: w.app.name, bundleId: w.app.bundleId || null, path: w.app.path || null, aumid: w.app.aumid || null, launch: true, args: '', open: [], windows: [] });
    const d = displayForRect(w.bounds, snapshot.displays);
    byApp.get(k).windows.push({ id: uid('w'), title: w.title || '', match: 'auto', display: d.id, frac: toFrac(w.bounds, d), state: w.state || 'normal' });
  }
  return [...byApp.values()];
}

/** Displays a scene actually uses (so a scene captured on 3 screens remembers all 3). */
function captureDisplays(snapshot) { return snapshot.displays.map((d) => ({ ...d })); }

// ---------------------------------------------------------------- activation plan
/**
 * Work out what a switch will do, before doing it. Pure: takes the scene, the live snapshot and running apps.
 * Returns { launch: [app], already: [app], others: [liveApp], placements: [{app, rule, display, rect}], displayFallback: [ids] }.
 */
function planSwitch(scene, snapshot, { running = [], keep = [] } = {}) {
  const { map, fallback } = matchDisplays(scene.displays || [], snapshot.displays);
  const isRunning = (a) => running.some((r) => sameApp(a, r)) || snapshot.windows.some((w) => sameApp(a, w.app));
  const launch = [], already = [];
  for (const a of scene.apps || []) { if (a.launch === false && !isRunning(a)) continue; (isRunning(a) ? already : launch).push(a); }
  const sceneHas = (live) => (scene.apps || []).some((a) => sameApp(a, live));
  const keepHas = (live) => keep.some((k) => sameApp(k, live));
  const seen = new Set(); const others = [];
  for (const live of [...snapshot.windows.map((w) => w.app), ...running]) {
    const k = appKey(live); if (seen.has(k)) continue; seen.add(k);
    if (isProtected(live) || sceneHas(live) || keepHas(live)) continue;
    others.push(live);
  }
  const placements = [];
  for (const a of scene.apps || []) {
    for (const r of a.windows || []) {
      const d = map[r.display] || snapshot.displays.find((x) => x.primary) || snapshot.displays[0];
      const full = r.state === 'maximized' || r.state === 'fullscreen';
      placements.push({ app: a, rule: r, display: d, rect: full ? { ...d.workArea } : fromFrac(r.frac, d) });
    }
  }
  return { launch, already, others, placements, displayFallback: fallback, displayMap: map };
}

// ---------------------------------------------------------------- arranging helpers (Desktop page and templates)
const ZONES = {
  full: { x: 0, y: 0, w: 1, h: 1 }, left: { x: 0, y: 0, w: 0.5, h: 1 }, right: { x: 0.5, y: 0, w: 0.5, h: 1 },
  top: { x: 0, y: 0, w: 1, h: 0.5 }, bottom: { x: 0, y: 0.5, w: 1, h: 0.5 },
  'left-third': { x: 0, y: 0, w: 1 / 3, h: 1 }, 'center-third': { x: 1 / 3, y: 0, w: 1 / 3, h: 1 }, 'right-third': { x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
  'left-two-thirds': { x: 0, y: 0, w: 2 / 3, h: 1 }, 'right-two-thirds': { x: 1 / 3, y: 0, w: 2 / 3, h: 1 },
  'top-left': { x: 0, y: 0, w: 0.5, h: 0.5 }, 'top-right': { x: 0.5, y: 0, w: 0.5, h: 0.5 }, 'bottom-left': { x: 0, y: 0.5, w: 0.5, h: 0.5 }, 'bottom-right': { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
  center: { x: 0.15, y: 0.1, w: 0.7, h: 0.8 }
};
/** n windows -> a sensible set of zones (1: full, 2: halves, 3: main + two stacked, 4: quarters, more: grid). */
function autoZones(n) {
  if (n <= 0) return [];
  if (n === 1) return [ZONES.full];
  if (n === 2) return [ZONES.left, ZONES.right];
  if (n === 3) return [{ x: 0, y: 0, w: 0.6, h: 1 }, { x: 0.6, y: 0, w: 0.4, h: 0.5 }, { x: 0.6, y: 0.5, w: 0.4, h: 0.5 }];
  if (n === 4) return [ZONES['top-left'], ZONES['top-right'], ZONES['bottom-left'], ZONES['bottom-right']];
  const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols); const out = [];
  for (let i = 0; i < n; i++) { const r = Math.floor(i / cols), c = i % cols; const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols; out.push({ x: (i - r * cols) / inRow, y: r / rows, w: 1 / inRow, h: 1 / rows }); void c; }
  return out;
}

// ---------------------------------------------------------------- triggers
/** Should a schedule trigger fire at `now`? Fires once per day, within 2 minutes after its time. */
function scheduleDue(t, now, lastFired) {
  if (!t || t.kind !== 'schedule' || !t.time) return false;
  const days = t.days && t.days.length ? t.days : [0, 1, 2, 3, 4, 5, 6];
  if (!days.includes(now.getDay())) return false;
  const [hh, mm] = String(t.time).split(':').map(Number);
  const at = new Date(now); at.setHours(hh, mm, 0, 0);
  const diff = now - at;
  if (diff < 0 || diff > 2 * 60000) return false;
  const today = now.toISOString().slice(0, 10) + ':' + t.time;
  return lastFired !== today;
}
const scheduleStamp = (t, now) => now.toISOString().slice(0, 10) + ':' + t.time;
/** Display trigger: does the display set change match? */
function displayTriggerMatches(t, change) {
  if (!t || t.kind !== 'display') return false;
  if ((t.when || 'connected') !== change.type) return false;
  if (!t.display) return true;
  const d = change.display || {};
  return lc(t.display.label) === lc(d.label) || (t.display.key && t.display.key === d.key);
}

// ---------------------------------------------------------------- accelerators
/** KeyboardEvent-ish -> Electron accelerator ("CommandOrControl+Alt+1"). Returns null for bare modifiers. */
function accelFromKey(e, platform) {
  const k = e.key;
  if (!k || ['Shift', 'Control', 'Alt', 'Meta', 'Fn', 'CapsLock'].includes(k)) return null;
  const parts = [];
  const cmdOrCtrl = platform === 'darwin' ? e.metaKey : e.ctrlKey;
  if (cmdOrCtrl) parts.push('CommandOrControl');
  if (platform === 'darwin' && e.ctrlKey) parts.push('Control');
  if (platform !== 'darwin' && e.metaKey) parts.push('Super');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (!parts.length || (parts.length === 1 && parts[0] === 'Shift')) return null;  // global hotkeys need a real modifier
  let key;
  if (/^Key[A-Z]$/.test(e.code || '')) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code || '')) key = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(k)) key = k;
  else key = ({ ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return', Escape: 'Escape', Backspace: 'Backspace', Tab: 'Tab', '+': 'Plus' })[k] || (k.length === 1 ? k.toUpperCase() : null);
  if (!key) return null;
  parts.push(key); return parts.join('+');
}
function prettyAccel(a, platform) {
  if (!a) return '';
  const mac = platform === 'darwin';
  return a.split('+').map((p) => (mac ? ({ CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧', Space: 'Space', Return: '↩', Up: '↑', Down: '↓', Left: '←', Right: '→' })[p] || p
    : ({ CommandOrControl: 'Ctrl', Control: 'Ctrl', Super: 'Win', Space: 'Space', Return: 'Enter' })[p] || p)).join(mac ? '' : '+');
}

module.exports = {
  uid, clamp, describeDisplay, displayKey, matchDisplays, displayForRect, toFrac, fromFrac,
  appKey, sameApp, baseName, titleScore, matchWindows, isProtected, captureApps, captureDisplays, planSwitch,
  ZONES, autoZones, scheduleDue, scheduleStamp, displayTriggerMatches, accelFromKey, prettyAccel
};
