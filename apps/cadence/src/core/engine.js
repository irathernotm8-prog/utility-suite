// Cadence — the engine: keeps automations, starts runs (by schedule, folder watch, you, or Claude/Codex),
// catches up on runs missed while the computer slept, and reports everything as events.
'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { Store } = require('./store');
const { Run } = require('./runner');
const { nextRun, describe } = require('./schedule');
const { validate, normalize } = require('./validate');
const { matcher } = require('./steps/files')._;
const { expandHome } = require('./runner');

const GRACE_MS = 5 * 60e3;   // a schedule is "on time" within 5 minutes
const MAX_PARALLEL = 3;

class Engine extends EventEmitter {
  constructor({ root, services = {}, crypt, settings = () => ({}) }) {
    super();
    this.store = new Store(root, { crypt });
    this.settings = settings;
    this.services = { ...services, secrets: this.store.secrets, memory: this.store.memory, runFlow: (id, inputs, signal, depth) => this.runNested(id, inputs, signal, depth) };
    this.live = new Map(); // run id → Run
    this.queue = [];
    this.watchers = new Map();
    this.timer = null;
    this.paused = false;
  }

  // ───────── automations
  list() {
    return this.store.listFlows().map((f) => this.card(f));
  }
  card(f) {
    const st = this.store.state(f.id);
    const last = this.store.history.find((r) => r.flowId === f.id && !r.partial);
    const running = [...this.live.values()].find((r) => r.flow.id === f.id && r.status === 'running');
    return { id: f.id, name: f.name, description: f.description || '', icon: f.icon || null, color: f.color || null, enabled: f.enabled !== false, trigger: f.trigger, when: describe(f.trigger), steps: f.steps.length, stepTypes: f.steps.map((s) => s.type),
      nextAt: f.enabled !== false && f.trigger.type === 'schedule' ? st.nextAt || null : null, lastRun: last ? { id: last.id, status: last.status, at: last.startedAt, endedAt: last.endedAt, error: last.error } : null, running: running ? running.id : null, updatedAt: f.updatedAt };
  }
  get(id) { const f = this.store.getFlow(id); if (!f) throw new Error('No automation with that id'); return JSON.parse(JSON.stringify(f)); }
  check(flow) {
    return validate(normalize(flow), { secretNames: this.store.secrets.names(), flowIds: this.store.listFlows().map((f) => f.id), profiles: this.store.profiles().map((p) => p.id) });
  }
  save(flow, { strict = false } = {}) {
    const f = normalize(flow);
    const v = this.check(f);
    if (strict && !v.ok) { const e = new Error('The automation has problems:\n' + v.errors.map((x) => `- ${x.step ? x.step + ': ' : ''}${x.msg}`).join('\n')); e.problems = v; throw e; }
    for (const s of f.steps) if (s.type === 'web.browser' && s.with.profile) this.store.ensureProfile(s.with.profile);
    const prev = f.id ? this.store.getFlow(f.id) : null;
    const saved = this.store.saveFlow(f);
    if (!prev || JSON.stringify(prev.trigger) !== JSON.stringify(saved.trigger) || prev.enabled !== saved.enabled) this.reschedule(saved);
    this.syncWatchers();
    this.emit('flows');
    return { flow: saved, problems: v };
  }
  remove(id) { this.store.deleteFlow(id); this.syncWatchers(); this.emit('flows'); return true; }
  duplicate(id) { const f = JSON.parse(JSON.stringify(this.get(id))); delete f.id; delete f.createdAt; f.name = f.name + ' copy'; f.enabled = false; return this.save(f).flow; }
  setEnabled(id, on) { const f = this.get(id); f.enabled = !!on; return this.save(f).flow; }

  // ───────── runs
  start(id, { trigger = { kind: 'manual' }, inputs = {}, upTo = null, only = null, flow = null } = {}) {
    const f = flow ? normalize(flow) : this.get(id);
    if (trigger.kind !== 'manual' && trigger.kind !== 'test' && [...this.live.values()].some((r) => r.flow.id === f.id && ['running', 'queued'].includes(r.status))) {
      return null; // already running; scheduled/watch triggers don't pile up
    }
    const run = new Run({ flow: f, services: { ...this.services, documents: this.services.documents }, runsDir: this.store.runsDir, trigger, inputs, upTo, only, weekStart: Number(this.settings().weekStart ?? 1) });
    this.live.set(run.id, run);
    let last = 0, t = null;
    run.on('change', (force) => {
      const now = Date.now();
      if (force || now - last > 200) { last = now; clearTimeout(t); t = null; this.emit('run', run.snapshot()); }
      else if (!t) t = setTimeout(() => { t = null; last = Date.now(); this.emit('run', run.snapshot()); }, 200);
    });
    run.on('end', (snap) => {
      clearTimeout(t);
      this.store.addRun(run.snapshot({ full: true }));
      if (!snap.partial) { const st = this.store.state(f.id); st.lastAt = snap.startedAt; st.lastStatus = snap.status; this.store.saveState(); }
      setTimeout(() => { this.live.delete(run.id); }, 3000);
      this.emit('run', snap); this.emit('runEnd', snap); this.emit('flows');
      this.pump();
    });
    this.queue.push(run);
    this.pump();
    this.emit('flows');
    return run;
  }
  pump() {
    const active = [...this.live.values()].filter((r) => r.status === 'running').length;
    let free = MAX_PARALLEL - active;
    while (free > 0 && this.queue.length) { const r = this.queue.shift(); if (r.abort.signal.aborted) { r.finish('cancelled'); continue; } r.start(); free--; }
  }
  async runAndWait(id, opts = {}) { const run = this.start(id, opts); if (!run) throw new Error('That automation is already running'); return new Promise((res) => run.once('end', () => res(run))); }
  async runNested(id, inputs, signal, depth = 1) {
    if (depth > 4) throw new Error('Too many automations running each other');
    const run = this.start(id, { trigger: { kind: 'automation', depth }, inputs });
    if (!run) throw new Error('That automation is already running');
    if (signal) signal.addEventListener('abort', () => run.cancel(), { once: true });
    await new Promise((res) => run.once('end', res));
    return { ...run.snapshot(), rawOutputs: run.outputs };
  }
  cancel(runId) { const r = this.live.get(runId); if (!r) return false; if (r.status === 'queued') { this.queue = this.queue.filter((x) => x !== r); r.finish('cancelled'); } else r.cancel(); return true; }
  runs({ flowId = null, limit = 100 } = {}) {
    const live = [...this.live.values()].filter((r) => !flowId || r.flow.id === flowId).map((r) => r.snapshot());
    const ids = new Set(live.map((r) => r.id));
    return [...live, ...this.store.history.filter((r) => !ids.has(r.id) && (!flowId || r.flowId === flowId))].slice(0, limit).map(slim);
  }
  getRun(id) { const r = this.live.get(id); if (r) return r.snapshot({ full: true }); const h = this.store.history.find((x) => x.id === id); if (!h) throw new Error('No run with that id'); return h; }

  // ───────── schedule
  reschedule(f, from = new Date()) {
    const st = this.store.state(f.id);
    st.nextAt = f.enabled !== false && f.trigger.type === 'schedule' ? (nextRun(f.trigger, from) || { getTime: () => null }).getTime() : null;
    this.store.saveState();
  }
  startScheduler() {
    for (const f of this.store.listFlows()) { const st = this.store.state(f.id); if (f.trigger.type === 'schedule' && f.enabled !== false && !st.nextAt) this.reschedule(f); }
    this.tick();
    this.timer = setInterval(() => this.tick(), 20e3);
    this.syncWatchers();
  }
  stopScheduler() { clearInterval(this.timer); this.timer = null; for (const w of this.watchers.values()) clearInterval(w.timer); this.watchers.clear(); }
  // Called every 20 s and when the computer wakes.
  tick(now = Date.now()) {
    if (this.paused) return;
    for (const f of this.store.listFlows()) {
      if (f.enabled === false || f.trigger.type !== 'schedule') continue;
      const st = this.store.state(f.id);
      if (!st.nextAt) { this.reschedule(f, new Date(now)); continue; }
      if (now < st.nextAt) continue;
      const late = now - st.nextAt;
      const due = st.nextAt;
      this.reschedule(f, new Date(now));
      if (late > GRACE_MS && f.trigger.catchUp === false) { this.emit('log', `${f.name}: skipped the ${new Date(due).toLocaleString()} run (computer was off)`); continue; }
      this.start(f.id, { trigger: { kind: 'schedule', due, late: late > GRACE_MS } });
    }
  }
  // ───────── folder watching (polling: works on every OS and on synced / network folders)
  syncWatchers() {
    const want = new Map();
    for (const f of this.store.listFlows()) if (f.enabled !== false && f.trigger.type === 'watch' && f.trigger.folder) want.set(f.id, f);
    for (const [id, w] of this.watchers) if (!want.has(id) || JSON.stringify(want.get(id).trigger) !== w.key) { clearInterval(w.timer); this.watchers.delete(id); }
    for (const [id, f] of want) if (!this.watchers.has(id) && this.timer) this.watchers.set(id, this.makeWatcher(f));
  }
  makeWatcher(f) {
    const dir = expandHome(f.trigger.folder);
    const match = matcher(f.trigger.pattern || '*');
    const list = () => { const out = new Map(); const walk = (d, depth) => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { if (e.name.startsWith('.') || /\.(crdownload|part|download|tmp)$/i.test(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) { if (f.trigger.subfolders && depth < 4) walk(p, depth + 1); } else if (match(e.name)) { try { const s = fs.statSync(p); out.set(p, s.size + ':' + s.mtimeMs); } catch {} } } }; walk(dir, 0); return out; };
    const w = { key: JSON.stringify(f.trigger), seen: list(), pending: new Map() };
    w.timer = setInterval(() => {
      if (this.paused) return;
      const now = list();
      for (const [p, sig] of now) {
        if (w.seen.get(p) === sig) continue;
        const prev = w.pending.get(p);
        if (prev === sig) { w.pending.delete(p); w.seen.set(p, sig); w.ready = [...(w.ready || []), p]; }
        else w.pending.set(p, sig); // wait one more poll so the file is fully written
      }
      for (const p of [...w.seen.keys()]) if (!now.has(p)) w.seen.delete(p);
      if (w.ready && w.ready.length) { const files = w.ready; w.ready = []; this.start(f.id, { trigger: { kind: 'watch', files }, inputs: { file: files[0], files } }); }
    }, Math.max(3, Number(f.trigger.every) || 5) * 1000);
    return w;
  }
  shutdown() { this.stopScheduler(); for (const r of this.live.values()) r.cancel(); this.store.flushRuns(); this.store.saveState(); }
}
function slim(r) { const { outputs, ...rest } = r; return { ...rest, steps: (r.steps || []).map((s) => ({ id: s.id, name: s.name, type: s.type, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt, error: s.error, summary: s.summary })) }; }

module.exports = { Engine };
