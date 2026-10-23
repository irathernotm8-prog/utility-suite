// macOS: windows are read and moved through System Events (Accessibility), apps are found by scanning the
// Applications folders, everything else is `open`, `osascript`, `shortcuts` and `ps`. No native modules.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { run, pool } = require('./run');

const jxa = (src, args = [], timeout = 20000) => run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', src, ...args], { timeout });
const as = (src, args = [], timeout = 15000) => run('/usr/bin/osascript', ['-e', src, ...args], { timeout });
const asLines = (lines, args = [], timeout = 15000) => run('/usr/bin/osascript', [...lines.flatMap((l) => ['-e', l]), ...args], { timeout });

// One pass over every regular app: its windows, with titles, frames and minimised / full-screen state.
// Bulk property reads (W.name(), W.position() ...) send one Apple Event per property instead of one per window.
const LIST_JXA = `
function run(argv) {
  var se = Application('System Events');
  var procs = se.applicationProcesses.whose({ backgroundOnly: false });
  var pids = procs.unixId(), names = procs.name(), bids = procs.bundleIdentifier(), fronts = procs.frontmost(), vis = procs.visible();
  var out = [];
  for (var i = 0; i < pids.length; i++) {
    var item = { pid: pids[i], name: names[i], bundleId: bids[i], frontmost: fronts[i], visible: vis[i], windows: [] };
    try {
      var p = se.applicationProcesses.whose({ unixId: pids[i] })[0];
      var W = p.windows;
      var wn = W.name();
      if (wn.length) {
        var pos = W.position(), sz = W.size(), sr = [];
        try { sr = W.subrole(); } catch (e) {}
        for (var j = 0; j < wn.length; j++) {
          var mini = false, full = false;
          try { mini = W[j].attributes.byName('AXMinimized').value(); } catch (e) {}
          try { full = W[j].attributes.byName('AXFullScreen').value(); } catch (e) {}
          item.windows.push({ index: j, title: wn[j] || '', x: pos[j] ? pos[j][0] : 0, y: pos[j] ? pos[j][1] : 0, w: sz[j] ? sz[j][0] : 0, h: sz[j] ? sz[j][1] : 0, subrole: sr[j] || '', minimized: !!mini, fullscreen: !!full });
        }
      }
    } catch (e) { item.error = String(e); }
    out.push(item);
  }
  return JSON.stringify(out);
}`;

// Move, resize, minimise or full-screen a batch of windows. Each op names the process (pid) and the window by its
// index at listing time, double-checked against the title; if the title moved, it looks the title up instead.
const PLACE_JXA = `
function run(argv) {
  var ops = JSON.parse(argv[0]); var se = Application('System Events'); var res = [];
  for (var i = 0; i < ops.length; i++) {
    var o = ops[i];
    try {
      var p = se.applicationProcesses.whose({ unixId: o.pid })[0];
      try { if (!p.visible()) { p.visible = true; delay(0.15); } } catch (e) {}
      var W = p.windows; var names = W.name(); var k = -1;
      if (o.index != null && o.index < names.length && names[o.index] === o.title) k = o.index;
      if (k < 0 && o.title) k = names.indexOf(o.title);
      if (k < 0 && o.index != null && o.index < names.length) k = o.index;
      if (k < 0) { res.push({ ok: false, error: 'window not found' }); continue; }
      var w = W[k]; var full = false, mini = false;
      try { full = w.attributes.byName('AXFullScreen').value(); } catch (e) {}
      try { mini = w.attributes.byName('AXMinimized').value(); } catch (e) {}
      if (o.state === 'minimized') { if (!mini) w.attributes.byName('AXMinimized').value = true; res.push({ ok: true }); continue; }
      if (mini) { w.attributes.byName('AXMinimized').value = false; delay(0.4); }
      if (full && o.state !== 'fullscreen') { w.attributes.byName('AXFullScreen').value = false; delay(1.1); }
      if (!(full && o.state === 'fullscreen')) {
        w.position = [o.x, o.y]; w.size = [o.w, o.h]; w.position = [o.x, o.y];
        if (o.state === 'fullscreen') { delay(0.25); w.attributes.byName('AXFullScreen').value = true; delay(0.6); }
      }
      res.push({ ok: true });
    } catch (e) { res.push({ ok: false, error: String(e) }); }
  }
  return JSON.stringify(res);
}`;

const HIDE_JXA = `
function run(argv) {
  var pids = JSON.parse(argv[0]); var se = Application('System Events'); var n = 0;
  for (var i = 0; i < pids.length; i++) { try { se.applicationProcesses.whose({ unixId: pids[i] })[0].visible = false; n++; } catch (e) {} }
  return String(n);
}`;

const needsAx = (s) => /assistive|not allowed|-1719|-25211|-10827|1002/i.test(String(s || ''));

// ---------------------------------------------------------------- executable paths for pids (no permissions needed)
async function pidPaths(pids) {
  const out = {};
  if (!pids.length) return out;
  const r = await run('/bin/ps', ['-o', 'pid=,comm=', '-p', pids.join(',')], { timeout: 5000 });
  for (const line of r.stdout.split('\n')) { const m = line.match(/^\s*(\d+)\s+(.+)$/); if (m) out[m[1]] = bundleOf(m[2].trim()); }
  return out;
}
/** "/Applications/X.app/Contents/MacOS/X" -> "/Applications/X.app" (the outermost bundle, so helpers map to their app). */
function bundleOf(p) { const i = p.indexOf('.app/'); return i >= 0 ? p.slice(0, i + 4) : (/\.app$/.test(p) ? p : null); }

/** Parse the LIST_JXA answer into Scene's window shape. Exported for tests. */
function parseList(json, paths = {}, selfPid = 0) {
  let procs; try { procs = JSON.parse(json); } catch { return { windows: [], apps: [] }; }
  const windows = []; const apps = [];
  for (const p of procs) {
    if (p.pid === selfPid) continue;
    const app = { name: p.name, bundleId: p.bundleId || null, path: paths[p.pid] || null, pid: p.pid, hidden: p.visible === false };
    apps.push(app);
    let first = true;
    for (const w of p.windows || []) {
      if (w.subrole && !/AXStandardWindow|AXDialog/.test(w.subrole)) continue;   // skip panels, popovers, floating palettes
      if (!w.minimized && !w.fullscreen && (w.w < 80 || w.h < 50)) continue;
      windows.push({
        id: `${p.pid}:${w.index}:${w.title}`, pid: p.pid, index: w.index, app, title: w.title,
        bounds: { x: Math.round(w.x), y: Math.round(w.y), width: Math.round(w.w), height: Math.round(w.h) },
        state: w.fullscreen ? 'fullscreen' : w.minimized ? 'minimized' : 'normal', focused: !!(p.frontmost && first), hidden: p.visible === false
      });
      first = false;
    }
  }
  return { windows, apps };
}

async function snapshot() {
  const r = await jxa(LIST_JXA, [], 25000);
  if (!r.ok) { const e = new Error(needsAx(r.stderr + r.error) ? 'accessibility' : (r.stderr || r.error || 'System Events did not answer').trim()); e.code = needsAx(r.stderr + r.error) ? 'accessibility' : 'list'; throw e; }
  let pids = []; try { pids = JSON.parse(r.stdout).map((p) => p.pid); } catch (_) {}
  const parsed = parseList(r.stdout, await pidPaths(pids), process.pid);
  // System Events lists windows but returns empty lists when Accessibility is off; flag that so the UI can explain.
  if (!parsed.windows.length && /error/i.test(r.stdout) && needsAx(r.stdout)) { const e = new Error('accessibility'); e.code = 'accessibility'; throw e; }
  return parsed;
}

/** Regular apps that are running (no permissions needed): every process inside an .app bundle that isn't a helper. */
async function runningApps(index) {
  const r = await run('/bin/ps', ['-axo', 'pid=,comm='], { timeout: 5000 });
  const seen = new Map();
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.+)$/); if (!m) continue;
    const b = bundleOf(m[2].trim()); if (!b || !/\.app\/Contents\/MacOS\//.test(m[2])) continue;
    if (/^\/System\/Library\/|\/Library\/(Apple|Developer|PrivateFrameworks)|\.framework\//.test(b)) continue;
    if (seen.has(b)) continue;
    const known = index && index.get(b);
    seen.set(b, { name: known ? known.name : path.basename(b, '.app'), bundleId: known ? known.bundleId : null, path: b, pid: Number(m[1]) });
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------- installed apps
const APP_DIRS = ['/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities', path.join(os.homedir(), 'Applications')];
async function listApps() {
  const found = [];
  for (const d of APP_DIRS) {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.name.endsWith('.app')) found.push(p);
      else if (e.isDirectory() && d === '/Applications' && e.name !== 'Utilities') {
        try { for (const f of fs.readdirSync(p)) if (f.endsWith('.app')) found.push(path.join(p, f)); } catch (_) {}
      }
    }
  }
  const info = await pool(found, 8, async (p) => {
    const r = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(p, 'Contents', 'Info.plist')], { timeout: 5000 });
    let j = {}; try { j = JSON.parse(r.stdout); } catch (_) {}
    if (j.LSBackgroundOnly === true || j.LSBackgroundOnly === '1') return null;
    return { name: j.CFBundleDisplayName || j.CFBundleName || path.basename(p, '.app'), bundleId: j.CFBundleIdentifier || null, path: p, agent: j.LSUIElement === true || j.LSUIElement === '1' };
  });
  const out = info.filter(Boolean).map((a) => ({ ...a, name: path.basename(a.path, '.app') || a.name }));
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ---------------------------------------------------------------- launching
const CHROMIUM = /^(com\.google\.chrome(\.beta|\.canary)?|com\.microsoft\.edgemac|com\.brave\.browser|com\.vivaldi\.vivaldi|org\.chromium\.chromium|com\.operasoftware\.opera)$/i;
const FIREFOX = /^org\.mozilla\.firefox/i;
const splitArgs = (s) => (String(s || '').match(/"[^"]*"|'[^']*'|\S+/g) || []).map((a) => a.replace(/^["']|["']$/g, ''));

/** Launch (or bring forward) an app, optionally opening URLs or files with it. Browsers get a new window. */
async function launch(app, { open = [], args = '', newWindow = true } = {}) {
  const target = app.bundleId ? ['-b', app.bundleId] : app.path ? ['-a', app.path] : ['-a', app.name];
  const extra = splitArgs(args);
  if (open.length && newWindow && app.bundleId && CHROMIUM.test(app.bundleId)) {
    return run('/usr/bin/open', ['-n', ...target, '--args', '--new-window', ...open, ...extra], { timeout: 20000 });
  }
  if (open.length && newWindow && app.bundleId && FIREFOX.test(app.bundleId)) {
    return run('/usr/bin/open', [...target, '--args', '--new-window', ...open, ...extra], { timeout: 20000 });
  }
  return run('/usr/bin/open', [...target, ...open, ...(extra.length ? ['--args', ...extra] : [])], { timeout: 20000 });
}

async function place(ops) {
  if (!ops.length) return [];
  const r = await jxa(PLACE_JXA, [JSON.stringify(ops.map((o) => ({ pid: o.win.pid, index: o.win.index, title: o.win.title, x: Math.round(o.rect.x), y: Math.round(o.rect.y), w: Math.round(o.rect.width), h: Math.round(o.rect.height), state: o.state || 'normal' })))], 30000 + ops.length * 2500);
  if (!r.ok) return ops.map(() => ({ ok: false, error: needsAx(r.stderr) ? 'accessibility' : (r.stderr || r.error || 'failed').trim() }));
  try { return JSON.parse(r.stdout); } catch { return ops.map(() => ({ ok: false, error: 'bad answer' })); }
}

/** Ask apps to quit the normal way (they can still ask to save). Doesn't wait for their answer. */
async function quit(apps) {
  const lines = [];
  for (const a of apps) {
    const t = a.bundleId ? `application id "${a.bundleId.replace(/"/g, '')}"` : `application "${String(a.name).replace(/"/g, '')}"`;
    lines.push(`try`, `ignoring application responses`, `tell ${t} to quit`, `end ignoring`, `end try`);
  }
  if (!lines.length) return { ok: true };
  return asLines(lines, [], 15000);
}
async function hide(apps) {
  const pids = apps.map((a) => a.pid).filter(Boolean);
  if (!pids.length) return { ok: true };
  return jxa(HIDE_JXA, [JSON.stringify(pids)], 15000);
}
async function focus(app) {
  const t = app.bundleId ? `application id "${app.bundleId.replace(/"/g, '')}"` : `application "${String(app.name).replace(/"/g, '')}"`;
  return as(`tell ${t} to activate`, [], 8000);
}

// ---------------------------------------------------------------- system settings
async function getVolume() {
  const r = await as('set s to get volume settings\nreturn ((output volume of s) as text) & "," & ((output muted of s) as text)');
  const [v, m] = r.stdout.trim().split(','); return { volume: Number(v), muted: m === 'true' };
}
const setVolume = (v) => as(`set volume output volume ${Math.round(Math.max(0, Math.min(100, Number(v) || 0)))}`);
const setMute = (m) => as(`set volume output muted ${m ? 'true' : 'false'}`);
async function getAppearance() { const r = await as('tell application "System Events" to tell appearance preferences to return dark mode'); return r.stdout.trim() === 'true' ? 'dark' : 'light'; }
const setAppearance = (mode) => as(`tell application "System Events" to tell appearance preferences to set dark mode to ${mode === 'dark' ? 'true' : 'false'}`);
const setWallpaper = (p) => asLines(['on run argv', 'tell application "System Events" to tell every desktop to set picture to (item 1 of argv)', 'end run'], [p]);
async function listShortcuts() { const r = await run('/usr/bin/shortcuts', ['list'], { timeout: 10000 }); return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)); }
const runShortcut = (name) => run('/usr/bin/shortcuts', ['run', name], { timeout: 120000 });
const runCommand = (cmd) => run('/bin/zsh', ['-lc', cmd], { timeout: 120000 });

module.exports = {
  name: 'mac', snapshot, runningApps, listApps, launch, place, quit, hide, focus,
  getVolume, setVolume, setMute, getAppearance, setAppearance, setWallpaper, listShortcuts, runShortcut, runCommand,
  supports: { fullscreen: true, shortcuts: true, wallpaper: true, appearance: true, volume: true, hide: true },
  parseList, bundleOf, LIST_JXA, PLACE_JXA
};
