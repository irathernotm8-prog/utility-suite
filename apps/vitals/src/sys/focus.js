// Time & focus: which app is in front, minute by minute, while Vitals runs. Stored per day as small JSON files.
// Nothing about window titles or what's on screen is kept — only the app and how long.
'use strict';
const fs = require('fs');
const path = require('path');
const { run, out, ps, isMac, isWin } = require('./run');
const P = require('./parse');

const WIN_FG = `if (-not ([System.Management.Automation.PSTypeName]'VitalsFg').Type) { Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class VitalsFg { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }' }
$h = [VitalsFg]::GetForegroundWindow(); $fp = [uint32]0; [void][VitalsFg]::GetWindowThreadProcessId($h, [ref]$fp)
$pr = Get-Process -Id $fp -ErrorAction SilentlyContinue
if ($pr) { "$fp\`t$($pr.ProcessName)\`t$($pr.Description)\`t$($pr.Path)" }`;

async function frontApp() {
  if (isMac) {
    const asn = (await out('lsappinfo', ['front'], { timeout: 3000 })).trim();
    if (!asn) return null;
    const info = await out('lsappinfo', ['info', asn], { timeout: 3000 });
    const first = [...P.parseLsappinfo(info).values()][0];
    const a = first ? { name: first.name, bundleId: first.bundleId, pid: first.pid, path: first.bundlePath } : P.parseLsappFront(info);
    if (!a || a.bundleId === 'com.apple.loginwindow' || a.bundleId === 'com.apple.ScreenSaver.Engine') return null;
    return a;
  }
  if (isWin) {
    const r = await ps(WIN_FG, { timeout: 6000 });
    const f = (r.stdout || '').trim().split('\t'); if (f.length < 2 || !f[0]) return null;
    return { pid: +f[0], name: f[2] || f[1], bundleId: f[1].toLowerCase(), path: f[3] || '' };
  }
  const r = await run('xdotool', ['getactivewindow', 'getwindowpid'], { timeout: 2000 });
  if (!r.ok) return null;
  const pid = +r.stdout.trim(); let name = ''; try { name = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch (_) {}
  return name ? { pid, name, bundleId: name, path: '' } : null;
}

const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const appKey = (a) => (a.bundleId || a.name || '').toLowerCase();

const DEFAULT_CATS = {
  focus: ['com.apple.dt.xcode', 'com.microsoft.vscode', 'code', 'com.apple.terminal', 'com.googlecode.iterm2', 'windowsterminal', 'com.microsoft.word', 'winword', 'com.microsoft.excel', 'excel', 'com.microsoft.powerpoint', 'powerpnt',
    'com.figma.desktop', 'figma', 'com.adobe.photoshop', 'photoshop', 'com.adobe.illustrator', 'illustrator', 'com.adobe.premierepro', 'adobe premiere pro', 'afterfx', 'com.apple.finalcut', 'notion.id', 'notion', 'md.obsidian', 'obsidian',
    'com.apple.iwork.pages', 'com.apple.iwork.numbers', 'com.apple.iwork.keynote', 'com.lemon.lvoverseas', 'capcut', 'com.bilal.datum', 'datum', 'com.bilal.ro3', 'ro3', 'com.bilal.docket', 'com.bilal.trace', 'com.bilal.lumen', 'com.bilal.kiln', 'com.canva.canvaeditor', 'canva'],
  distracting: ['com.valvesoftware.steam', 'steam', 'com.hnc.discord', 'discord', 'tv.twitch', 'com.netflix', 'com.apple.tv', 'com.apple.news', 'com.bilal.sideby', 'epicgameslauncher', 'com.apple.arcade', 'com.tiktok', 'com.facebook', 'instagram']
};

class FocusTracker {
  constructor({ dir, settings, idleTime, onChange }) {
    this.dir = dir; this.settings = settings; this.idleTime = idleTime; this.onChange = onChange || (() => {});
    this.timer = null; this.cur = null; this.lastTick = null; this.day = null; this.data = null; this.dirty = false; this.paused = false; this.locked = false;
    fs.mkdirSync(dir, { recursive: true });
  }
  file(day) { return path.join(this.dir, day + '.json'); }
  load(day) {
    try { return JSON.parse(fs.readFileSync(this.file(day), 'utf8')); } catch (_) { return { day, apps: {}, hours: Array(24).fill(0), sessions: [], switches: 0, active: 0, idle: 0, first: null, last: null }; }
  }
  ensureDay(t) { const d = dayKey(t); if (this.day !== d) { this.flush(); this.day = d; this.data = this.load(d); } return this.data; }
  flush() { if (this.dirty && this.data) { try { fs.writeFileSync(this.file(this.day), JSON.stringify(this.data)); } catch (_) {} this.dirty = false; } }
  start() { if (this.timer) return; this.tick(); this.timer = setInterval(() => this.tick(), 5000); this.flushTimer = setInterval(() => this.flush(), 60000); }
  stop() { clearInterval(this.timer); clearInterval(this.flushTimer); this.timer = null; this.endSession(Date.now()); this.flush(); }
  setLocked(v) { this.locked = v; if (v) this.endSession(Date.now()); }
  async tick() {
    const now = Date.now();
    const s = this.settings();
    if (!s.focusTracking || this.paused) { this.lastTick = now; this.cur = null; return; }
    const idle = this.locked || this.idleTime() >= (s.idleMinutes || 3) * 60;
    const app = idle ? null : await frontApp().catch(() => null);
    this.record(app, now, idle);
  }
  /** Add the time since the last tick to whatever was in front. Exposed for tests. */
  record(app, now, idle) {
    const dt = this.lastTick ? Math.min(15, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    const d = this.ensureDay(now);
    if (idle || !app || !app.name) { if (dt) { d.idle += dt; this.dirty = true; } this.endSession(now); return; }
    const k = appKey(app);
    const a = d.apps[k] || (d.apps[k] = { name: app.name, path: app.path || '', secs: 0, hours: Array(24).fill(0), opens: 0 });
    if (app.path && !a.path) a.path = app.path;
    const h = new Date(now).getHours();
    if (dt) { a.secs += dt; a.hours[h] += dt; d.hours[h] += dt; d.active += dt; }
    d.first = d.first || now; d.last = now;
    if (!this.cur || this.cur.key !== k) {
      if (this.cur) d.switches++;
      this.endSession(now);
      a.opens++;
      this.cur = { key: k, name: app.name, start: now - dt * 1000 };
    }
    this.cur.end = now;
    this.dirty = true;
    this.onChange();
  }
  endSession(now) {
    if (!this.cur || !this.data) { this.cur = null; return; }
    const len = ((this.cur.end || now) - this.cur.start) / 1000;
    if (len >= 60) { this.data.sessions.push({ key: this.cur.key, name: this.cur.name, start: this.cur.start, end: this.cur.end || now }); this.dirty = true; }
    this.cur = null;
  }
  current() { return this.cur ? { ...this.cur, secs: ((this.cur.end || Date.now()) - this.cur.start) / 1000 } : null; }
  /** Summary for a range of days (most recent last). */
  summary(days = 7) {
    this.flush();
    const s = this.settings(); const cats = s.focusCategories || {};
    const catOf = (k) => cats[k] || (DEFAULT_CATS.focus.includes(k) ? 'focus' : DEFAULT_CATS.distracting.includes(k) ? 'distracting' : 'neutral');
    const minFocus = (s.focusSessionMinutes || 25) * 60;
    const res = [];
    for (let i = days - 1; i >= 0; i--) {
      const t = Date.now() - i * 86400000; const dk = dayKey(t);
      const d = dk === this.day ? this.data : this.load(dk);
      const sessions = d.sessions.slice();
      if (dk === this.day && this.cur && this.cur.end) sessions.push({ key: this.cur.key, name: this.cur.name, start: this.cur.start, end: this.cur.end, live: true });
      const focusSessions = sessions.filter((x) => (x.end - x.start) / 1000 >= minFocus && catOf(x.key) !== 'distracting');
      const focusSecs = focusSessions.reduce((a, x) => a + (x.end - x.start) / 1000, 0);
      const longest = sessions.reduce((m, x) => Math.max(m, (x.end - x.start) / 1000), 0);
      const activeH = d.active / 3600;
      const switchesPerHour = activeH > 0.05 ? d.switches / activeH : 0;
      const byCat = { focus: 0, neutral: 0, distracting: 0 };
      for (const [k, a] of Object.entries(d.apps)) byCat[catOf(k)] += a.secs;
      // score: time in deep sessions, a calm switching rate, and little distracting time
      const deepShare = d.active ? focusSecs / d.active : 0;
      const calm = Math.max(0, 1 - switchesPerHour / 60);
      const clean = d.active ? 1 - byCat.distracting / d.active : 1;
      const score = d.active > 300 ? Math.round(100 * (0.5 * deepShare + 0.3 * calm + 0.2 * clean)) : null;
      res.push({ day: dk, active: d.active, idle: d.idle, switches: d.switches, switchesPerHour, hours: d.hours, focusSecs, focusSessions: focusSessions.length, longest, score, byCat, first: d.first, last: d.last,
        apps: Object.entries(d.apps).map(([k, a]) => ({ key: k, name: a.name, path: a.path, secs: a.secs, opens: a.opens, hours: a.hours, cat: catOf(k) })).sort((x, y) => y.secs - x.secs),
        sessions: sessions.slice(-200) });
    }
    return res;
  }
  /** Last time Vitals saw each app in front (for the Apps page). */
  lastSeen(days = 60) {
    const map = {};
    let files = []; try { files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort().slice(-days); } catch (_) {}
    for (const f of files) { const d = f.slice(0, 10) === this.day ? this.data : this.load(f.slice(0, 10)); for (const [k, a] of Object.entries(d.apps || {})) { map[k] = { day: d.day || f.slice(0, 10), name: a.name, path: a.path }; } }
    return map;
  }
  clear() { this.flush(); try { for (const f of fs.readdirSync(this.dir)) fs.rmSync(path.join(this.dir, f), { force: true }); } catch (_) {} this.day = null; this.data = null; this.cur = null; }
}

module.exports = { FocusTracker, frontApp, dayKey, DEFAULT_CATS };
