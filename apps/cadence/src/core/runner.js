// Cadence — runs one automation: renders each step's fields against what earlier steps produced, runs it,
// retries, logs, and keeps a snapshot the window, history and the MCP plugin can read.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { render, renderText } = require('./template');
const { dateContext } = require('./dates');
const { STEPS } = require('./catalog');
const table = require('./table');
const STEP_IMPL = require('./steps');

// Fields a step templates itself (they depend on per-item values like {{name}}).
const RAW_FIELDS = { 'file.save': ['rename'], 'web.browser': ['actions'], 'logic.run': [] };

class StopRun extends Error { constructor(kind, msg) { super(msg || 'Stopped'); this.kind = kind; } }
class Cancelled extends Error { constructor() { super('Cancelled'); this.cancelled = true; } }

const expandHome = (p) => (typeof p === 'string' && /^~(?=$|[\\/])/.test(p) ? path.join(os.homedir(), p.slice(1)) : p);
const newId = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex');

// Shrink outputs for history / the window: tables become previews, long text is cut.
function summarize(v, depth = 0) {
  if (v == null || typeof v !== 'object') return typeof v === 'string' && v.length > 20000 ? v.slice(0, 20000) + '…' : v;
  if (table.isTable(v)) return { __table: true, ...table.preview(v, 60) };
  if (depth > 4) return '[…]';
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => summarize(x, depth + 1));
  const o = {}; for (const [k, x] of Object.entries(v)) if (!k.startsWith('__')) o[k] = summarize(x, depth + 1); return o;
}
function collectFiles(v, out = new Set()) {
  if (!v) return out;
  if (typeof v === 'string') { if (path.isAbsolute(v) && /\.[a-z0-9]{1,6}$/i.test(v)) out.add(v); return out; }
  if (Array.isArray(v)) v.forEach((x) => collectFiles(x, out));
  else if (typeof v === 'object' && !table.isTable(v)) for (const [k, x] of Object.entries(v)) if (k === 'file' || k === 'files') collectFiles(x, out);
  return out;
}

class Run extends EventEmitter {
  constructor({ flow, services, runsDir, trigger = { kind: 'manual' }, inputs = {}, upTo = null, only = null, weekStart = 1 }) {
    super();
    this.id = newId();
    this.flow = JSON.parse(JSON.stringify(flow));
    this.services = services;
    this.trigger = trigger;
    this.inputs = inputs || {};
    this.upTo = upTo; this.only = only;
    this.weekStart = weekStart;
    this.dir = path.join(runsDir, this.id);
    this.status = 'queued';
    this.startedAt = null; this.endedAt = null; this.error = null;
    this.outputs = {}; this.vars = {};
    this.secretValues = new Set();
    this.memoryWrites = [];
    this.abort = new AbortController();
    const steps = only ? flow.steps.filter((s) => s.id === only) : flow.steps;
    this.steps = steps.map((s) => ({ id: s.id, type: s.type, name: s.name || (STEPS[s.type] ? STEPS[s.type].label : s.type), status: s.off ? 'off' : 'pending', log: [], startedAt: null, endedAt: null, error: null, attempt: 0 }));
    this.result = null;
  }

  // Everything templates can see.
  scope() {
    const self = this;
    const secrets = new Proxy({}, { get(_, k) { if (typeof k !== 'string') return undefined; const v = self.services.secrets ? self.services.secrets.get(k) : undefined; if (v == null) throw new Error(`There’s no secret called “${k}”. Add it in Connections › Secrets.`); if (String(v).length >= 4) self.secretValues.add(String(v)); return v; } });
    const env = new Proxy({}, { get(_, k) { return typeof k === 'string' ? process.env[k] : undefined; } });
    return {
      ...dateContext(this.startedAt ? new Date(this.startedAt) : new Date(), this.weekStart),
      steps: this.outputs, vars: this.vars, inputs: this.inputs, secrets, env,
      flow: { id: this.flow.id, name: this.flow.name, output: this.outputRoot() },
      run: { id: this.id, dir: this.dir, trigger: this.trigger.kind, started: this.startedAt },
      home: os.homedir(),
    };
  }
  outputRoot() {
    const root = this.services.outputRoot ? expandHome(this.services.outputRoot) : path.join(this.services.documents || path.join(os.homedir(), 'Documents'), 'Cadence');
    const o = this.flow.output ? expandHome(this.flow.output) : path.join(root, String(this.flow.name || 'Automation').replace(/[\\/:*?"<>|]+/g, '-'));
    return o;
  }
  resolvePath(p) {
    if (p == null || p === '') return p;
    p = expandHome(String(p).trim());
    return path.isAbsolute(p) ? path.normalize(p) : path.join(this.outputRoot(), p);
  }
  redact(s) { let t = String(s); for (const v of this.secretValues) t = t.split(v).join('••••'); return t; }
  log(step, msg, level = 'info') {
    const line = { t: Date.now(), level, msg: this.redact(msg) };
    if (step) { step.log.push(line); if (step.log.length > 400) step.log.splice(0, step.log.length - 400); }
    this.emit('change');
  }

  async start() {
    this.status = 'running'; this.startedAt = Date.now();
    fs.mkdirSync(this.dir, { recursive: true });
    this.emit('change', true);
    let skipNext = false;
    try {
      for (let i = 0; i < this.steps.length; i++) {
        const st = this.steps[i];
        const def = this.flow.steps.find((s) => s.id === st.id);
        if (this.abort.signal.aborted) throw new Cancelled();
        if (st.status === 'off') continue;
        if (skipNext) { st.status = 'skipped'; this.log(st, 'Skipped by the condition before it'); skipNext = false; continue; }
        const out = await this.runStep(st, def);
        if (out && out.__skipNext) skipNext = true;
        if (out && out.__stop) { for (const rest of this.steps.slice(i + 1)) if (rest.status === 'pending') rest.status = 'skipped'; throw new StopRun('done', out.__stop); }
        if (this.upTo && st.id === this.upTo) { for (const rest of this.steps.slice(i + 1)) if (rest.status === 'pending') rest.status = 'skipped'; break; }
      }
      this.finish('done');
    } catch (e) {
      if (e instanceof StopRun && e.kind === 'done') { this.result = e.message; this.finish('done'); }
      else if (e instanceof Cancelled || this.abort.signal.aborted) this.finish('cancelled');
      else { this.error = this.redact(e.message || String(e)); this.finish('failed'); }
    }
    return this.snapshot();
  }

  async runStep(st, def) {
    const impl = STEP_IMPL[def.type];
    if (!impl) throw new Error(`Unknown step type “${def.type}”`);
    const retries = Math.max(0, Math.min(5, Number(def.retries) || 0));
    st.status = 'running'; st.startedAt = Date.now(); this.emit('change', true);
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      st.attempt = attempt + 1;
      if (attempt) { this.log(st, `Trying again (${attempt + 1} of ${retries + 1})…`, 'warn'); await sleep(Math.min(30000, 2000 * attempt), this.abort.signal); }
      try {
        const scope = this.scope();
        const raw = def.with || {};
        const keep = RAW_FIELDS[def.type] || [];
        const w = {};
        for (const [k, v] of Object.entries(raw)) w[k] = keep.includes(k) ? v : render(v, scope);
        const x = {
          run: this, step: st, def, dir: this.dir, signal: this.abort.signal, services: this.services, scope,
          log: (m, lvl) => this.log(st, m, lvl), resolvePath: (p) => this.resolvePath(p), render: (v, extra) => render(v, { ...this.scope(), ...(extra || {}) }), renderText: (v, extra) => renderText(v, { ...this.scope(), ...(extra || {}) }),
          remember: (key, value) => this.memoryWrites.push({ key, value }),
          recall: (key) => (this.services.memory ? this.services.memory.get(this.flow.id, key) : undefined),
        };
        const out = (await impl(w, x)) || {};
        if (this.abort.signal.aborted) throw new Cancelled();
        const clean = {}; for (const [k, v] of Object.entries(out)) if (!k.startsWith('__')) clean[k] = v;
        this.outputs[st.id] = clean;
        if (def.type === 'data.set' && clean.values) Object.assign(this.vars, clean.values);
        st.status = 'done'; st.endedAt = Date.now(); st.summary = describeOut(clean);
        this.emit('change', true);
        return out;
      } catch (e) {
        if (e instanceof StopRun || e instanceof Cancelled || this.abort.signal.aborted) { st.status = e instanceof StopRun ? 'done' : 'cancelled'; st.endedAt = Date.now(); if (e instanceof StopRun) { this.outputs[st.id] = { passed: false }; this.log(st, e.message); } throw e; }
        lastErr = e; this.log(st, e.message || String(e), 'error');
      }
    }
    st.endedAt = Date.now(); st.error = this.redact(lastErr.message || String(lastErr));
    if (def.continueOnError) { st.status = 'failed'; this.outputs[st.id] = { error: st.error }; this.log(st, 'Keeping going (this step is allowed to fail)', 'warn'); this.emit('change', true); return {}; }
    st.status = 'failed'; this.emit('change', true);
    throw new Error(`${st.name}: ${st.error}`);
  }

  finish(status) {
    this.status = status; this.endedAt = Date.now();
    for (const s of this.steps) if (s.status === 'pending' || s.status === 'running') s.status = status === 'cancelled' ? 'cancelled' : 'skipped';
    if (status === 'done' && this.services.memory && !this.only && !this.upTo) for (const m of this.memoryWrites) this.services.memory.set(this.flow.id, m.key, m.value);
    this.emit('change', true);
    this.emit('end', this.snapshot());
  }
  cancel() { this.abort.abort(); if (this.services.browser) this.services.browser.cancel(this.id); this.emit('change', true); }

  // Files the run made. Scratch copies in the run folder are left out when the same file was saved elsewhere.
  files() { const s = new Set(); for (const o of Object.values(this.outputs)) collectFiles(o, s); const all = [...s]; const saved = new Set(all.filter((f) => !f.startsWith(this.dir + path.sep)).map((f) => path.basename(f))); return all.filter((f) => !f.startsWith(this.dir + path.sep) || !saved.has(path.basename(f))); }
  snapshot({ full = false } = {}) {
    return {
      id: this.id, flowId: this.flow.id, flowName: this.flow.name, status: this.status, trigger: this.trigger, error: this.error, result: this.result,
      startedAt: this.startedAt, endedAt: this.endedAt, dir: this.dir, partial: !!(this.upTo || this.only),
      steps: this.steps.map((s) => ({ ...s, log: full ? s.log : s.log.slice(-60) })),
      outputs: summarize(this.outputs), files: this.files(),
    };
  }
}

function describeOut(o) {
  const parts = [];
  if (o.files && Array.isArray(o.files)) parts.push(`${o.files.length} file${o.files.length === 1 ? '' : 's'}`);
  else if (o.file) parts.push(path.basename(o.file));
  if (o.folder && !o.file) parts.push(path.basename(o.folder));
  if (o.table && table.isTable(o.table)) parts.push(`${o.table.rows.length} row${o.table.rows.length === 1 ? '' : 's'} × ${o.table.columns.length} columns`);
  if (o.json && typeof o.json === 'object') parts.push(o.json.headline ? String(o.json.headline).slice(0, 90) : `Answer with ${Object.keys(o.json).length} part${Object.keys(o.json).length === 1 ? '' : 's'}`);
  else if (o.text && typeof o.text === 'string' && !o.table) parts.push(o.text.replace(/\s+/g, ' ').slice(0, 90));
  if (o.count != null && !o.table && !o.files && !o.file) parts.push(String(o.count));
  if (o.passed === true) parts.push('Yes — carried on');
  if (o.status != null && !parts.length) parts.push('HTTP ' + o.status);
  return parts.join(' · ');
}

function sleep(ms, signal) {
  return new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new Cancelled()); }, { once: true });
  });
}

module.exports = { Run, StopRun, Cancelled, sleep, expandHome, summarize };
