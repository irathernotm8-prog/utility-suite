// Atoll — timers, a stopwatch and focus sessions. Lives in the main process so nothing is lost when the island
// reloads; the window gets end times and works out the countdown itself. Pure apart from setTimeout, and the
// clock can be swapped for tests.
'use strict';
const { EventEmitter } = require('events');

const uid = () => Math.random().toString(36).slice(2, 9);
const clampMs = (ms) => Math.max(1000, Math.min(24 * 3600e3, Math.round(ms)));

/** "90" -> 90 min, "1:30" -> 1 min 30 s, "1:02:00" -> 1 h 2 min, "45s", "2h", "1h30m" -> ms (null if unreadable). */
function parseDuration(text) {
  const s = String(text || '').trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 60e3;
  if (/^\d{1,3}(:\d{1,2}){1,2}$/.test(s)) {
    const p = s.split(':').map(Number);
    if (p.slice(1).some((v) => v > 59)) return null;
    return p.length === 3 ? ((p[0] * 60 + p[1]) * 60 + p[2]) * 1000 : (p[0] * 60 + p[1]) * 1000;
  }
  const re = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/g;
  let total = 0, any = false, m, used = '';
  while ((m = re.exec(s))) { any = true; used += m[0]; const v = Number(m[1]); total += m[2].startsWith('h') ? v * 3600e3 : m[2].startsWith('m') ? v * 60e3 : v * 1000; }
  if (!any || s.replace(/\s+/g, '').length !== used.replace(/\s+/g, '').length) return null;
  return total || null;
}

/** 65000 -> "1:05", 3725000 -> "1:02:05". Rounds up so a timer never shows 0:00 while running. */
function fmt(ms, { up = true } = {}) {
  const t = Math.max(0, up ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function nameFor(ms) {
  const m = Math.round(ms / 60e3);
  if (ms < 60e3) return `${Math.round(ms / 1000)} sec`;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

class Timers extends EventEmitter {
  constructor({ now = () => Date.now(), saved = {}, focusPlan = () => ({ work: 25, short: 5, long: 15, every: 4 }) } = {}) {
    super();
    this.now = now;
    this.focusPlan = focusPlan;
    this.list = [];                 // { id, label, duration, endsAt, left, state: running|paused|done, doneAt }
    this.watch = { running: false, startedAt: 0, before: 0, laps: [] };
    this.focus = null;              // { phase: work|short|long, cycle, endsAt, left, running, duration }
    this.handles = new Map();
    this.restore(saved);
  }

  // -------------------------------------------------- timers
  add(ms, label = '') {
    const duration = clampMs(ms);
    const t = { id: uid(), label: String(label || '').slice(0, 40) || nameFor(duration), duration, endsAt: this.now() + duration, left: duration, state: 'running', createdAt: this.now() };
    this.list.push(t); this.arm(t); this.changed(); return t;
  }
  pause(id) { const t = this.get(id); if (!t || t.state !== 'running') return; t.left = Math.max(0, t.endsAt - this.now()); t.state = 'paused'; this.disarm(id); this.changed(); }
  resume(id) { const t = this.get(id); if (!t || t.state !== 'paused') return; t.endsAt = this.now() + t.left; t.state = 'running'; this.arm(t); this.changed(); }
  toggle(id) { const t = this.get(id); if (!t) return; if (t.state === 'running') this.pause(id); else if (t.state === 'paused') this.resume(id); }
  extend(id, ms = 60e3) {
    const t = this.get(id); if (!t) return;
    if (t.state === 'done') { t.state = 'running'; t.endsAt = this.now() + ms; t.duration = ms; t.doneAt = null; this.arm(t); }
    else if (t.state === 'running') { t.endsAt += ms; t.duration += ms; this.arm(t); }
    else { t.left += ms; t.duration += ms; }
    this.changed();
  }
  restart(id) { const t = this.get(id); if (!t) return; t.state = 'running'; t.endsAt = this.now() + t.duration; t.left = t.duration; t.doneAt = null; this.arm(t); this.changed(); }
  remove(id) { this.disarm(id); this.list = this.list.filter((t) => t.id !== id); this.changed(); }
  dismissDone() { const done = this.list.filter((t) => t.state === 'done'); if (!done.length) return; this.list = this.list.filter((t) => t.state !== 'done'); this.changed(); }
  get(id) { return this.list.find((t) => t.id === id) || null; }

  arm(t) {
    this.disarm(t.id);
    const ms = Math.max(0, t.endsAt - this.now());
    // setTimeout drifts on sleep; re-check close to the end so it rings on time.
    const h = setTimeout(() => {
      if (t.state !== 'running') return;
      if (t.endsAt - this.now() > 250) return this.arm(t);
      t.state = 'done'; t.left = 0; t.doneAt = this.now(); this.handles.delete(t.id);
      this.emit('done', { kind: 'timer', timer: { ...t } });
      this.changed();
    }, Math.min(ms, 60e3));
    this.handles.set(t.id, h);
  }
  disarm(id) { const h = this.handles.get(id); if (h) clearTimeout(h); this.handles.delete(id); }

  // -------------------------------------------------- stopwatch
  watchToggle() {
    const w = this.watch;
    if (w.running) { w.before += this.now() - w.startedAt; w.running = false; }
    else { w.startedAt = this.now(); w.running = true; }
    this.changed();
  }
  watchElapsed() { const w = this.watch; return w.before + (w.running ? this.now() - w.startedAt : 0); }
  watchLap() { if (!this.watch.running) return; const total = this.watchElapsed(); const prev = this.watch.laps[0]?.total || 0; this.watch.laps.unshift({ total, split: total - prev }); this.watch.laps = this.watch.laps.slice(0, 50); this.changed(); }
  watchReset() { this.watch = { running: false, startedAt: 0, before: 0, laps: [] }; this.changed(); }

  // -------------------------------------------------- focus (work / break cycles)
  focusStart() {
    if (this.focus && !this.focus.running) { this.focus.endsAt = this.now() + this.focus.left; this.focus.running = true; this.armFocus(); this.changed(); return; }
    this.focus = { phase: 'work', cycle: 1, running: true }; this.phase('work');
  }
  focusPause() { const f = this.focus; if (!f || !f.running) return; f.left = Math.max(0, f.endsAt - this.now()); f.running = false; this.disarm('focus'); this.changed(); }
  focusSkip() { if (this.focus) this.nextPhase(false); }
  focusStop() { this.disarm('focus'); this.focus = null; this.changed(); }
  phase(p) {
    const plan = this.focusPlan(); const mins = p === 'work' ? plan.work : p === 'long' ? plan.long : plan.short;
    const f = this.focus; f.phase = p; f.duration = Math.max(1, mins) * 60e3; f.endsAt = this.now() + f.duration; f.left = f.duration; f.running = true;
    this.armFocus(); this.changed();
  }
  nextPhase(rang = true) {
    const f = this.focus; const plan = this.focusPlan();
    const from = f.phase;
    if (f.phase === 'work') this.phase(f.cycle % Math.max(1, plan.every) === 0 ? 'long' : 'short');
    else { f.cycle += 1; this.phase('work'); }
    if (rang) this.emit('done', { kind: 'focus', from, to: f.phase, cycle: f.cycle });
  }
  armFocus() {
    this.disarm('focus');
    const f = this.focus; if (!f || !f.running) return;
    const h = setTimeout(() => {
      if (!this.focus || !this.focus.running) return;
      if (this.focus.endsAt - this.now() > 250) return this.armFocus();
      this.nextPhase(true);
    }, Math.min(Math.max(0, f.endsAt - this.now()), 60e3));
    this.handles.set('focus', h);
  }

  // -------------------------------------------------- state
  /** What the island needs. endsAt is absolute so the window can count down on its own. */
  snapshot() {
    return {
      list: this.list.map((t) => ({ ...t, left: t.state === 'running' ? Math.max(0, t.endsAt - this.now()) : t.left })),
      watch: { ...this.watch, elapsed: this.watchElapsed(), laps: this.watch.laps.slice(0, 20) },
      focus: this.focus ? { ...this.focus, left: this.focus.running ? Math.max(0, this.focus.endsAt - this.now()) : this.focus.left } : null,
      now: this.now()
    };
  }
  /** The single most urgent countdown: a ringing timer, then the soonest running one, then focus. */
  lead() {
    const s = this.snapshot();
    const ringing = s.list.find((t) => t.state === 'done');
    if (ringing) return { kind: 'timer', ...ringing };
    const run = s.list.filter((t) => t.state === 'running').sort((a, b) => a.endsAt - b.endsAt)[0];
    if (run) return { kind: 'timer', ...run };
    if (s.focus) return { kind: 'focus', ...s.focus };
    const paused = s.list.find((t) => t.state === 'paused');
    if (paused) return { kind: 'timer', ...paused };
    if (s.watch.running) return { kind: 'watch', ...s.watch };
    return null;
  }
  serialize() { return { list: this.list, watch: this.watch, focus: this.focus, savedAt: this.now() }; }
  restore(saved) {
    const now = this.now();
    for (const t of saved.list || []) {
      if (!t || !t.id) continue;
      if (t.state === 'running' && t.endsAt <= now) { t.state = 'done'; t.left = 0; t.doneAt = t.endsAt; }
      this.list.push(t);
      if (t.state === 'running') this.arm(t);
    }
    if (saved.watch) this.watch = { running: false, startedAt: 0, before: 0, laps: [], ...saved.watch };
    if (saved.focus) {
      this.focus = saved.focus;
      if (this.focus.running && this.focus.endsAt <= now) { this.focus.running = false; this.focus.left = 0; }
      else if (this.focus.running) this.armFocus();
    }
  }
  changed() { this.emit('change'); }
  dispose() { for (const id of [...this.handles.keys()]) this.disarm(id); }
}

module.exports = { Timers, parseDuration, fmt, nameFor };
