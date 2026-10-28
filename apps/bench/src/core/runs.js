// Bench — runs that use the whole computer: smoke-test many apps at once (each opens with fresh data, out of
// sight; Bench waits for its windows, screenshots them, collects errors and crashes, then closes it), and run
// several apps' test suites side by side.
'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { ElectronApp } = require('./electron-app');
const { CommandSession, tail } = require('./proc');
const { Collection, newId, slug, safeRemove } = require('./store');
const apps = require('./apps');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Messages every Electron app prints in development that say nothing about the app itself
const NOISE = [/Electron Security Warning/i, /Autofill\.(enable|setAddresses)/i, /Request Autofill/i, /DevTools/i, /was preloaded using link preload but not used/i, /Insecure Content-Security-Policy/i];
const isNoise = (t) => NOISE.some((r) => r.test(t || ''));

async function pool(items, n, fn, isCancelled) {
  let i = 0; const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (i < items.length && !isCancelled()) { const k = i++; await fn(items[k], k); } });
  await Promise.all(workers);
}

class Runs extends EventEmitter {
  constructor({ dataDir, ctx }) {
    super(); this.dir = path.join(dataDir, 'runs'); fs.mkdirSync(this.dir, { recursive: true });
    this.ctx = ctx; this.store = new Collection(path.join(dataDir, 'runs.json'), { max: 80 }); this.active = new Map();
    for (const r of this.store.all()) if (r.state === 'running') { r.state = 'stopped'; for (const it of r.items) if (it.status === 'running' || it.status === 'queued') it.status = 'skipped'; }
    this.store.save();
  }
  list() { return this.store.all().map((r) => ({ ...r, items: r.items.map((i) => ({ ...i, output: undefined })) })); }
  get(id) { return this.store.get(id); }
  remove(id) { const r = this.store.get(id); if (!r) return false; if (r.state === 'running') throw new Error('Stop the run first'); try { safeRemove(path.join(this.dir, id), [this.dir]); } catch {} this.store.remove(id); this.emit('changed', { id }); return true; }
  cancel(id) { const a = this.active.get(id); if (!a) return false; a.cancelled = true; for (const s of a.sessions) { try { s.quit ? s.quit() : s.stop(); } catch {} } return true; }
  _save(run) { this.store.update(run.id, run); this.emit('changed', { id: run.id, run }); }

  /** Which apps a smoke run covers. source: 'installed' | 'projects' | 'auto' (installed when there, else source). */
  pickApps(names, source = 'auto') {
    const pkg = this.ctx.pkgDir();
    const all = !names || names === 'all' || (Array.isArray(names) && (names.length === 0 || names.includes('all')));
    // Utility Hub installs and removes real apps, so it's only tested when asked for by name
    const isHub = (a) => a.hub || a.id === 'hub' || a.name === 'Utility Hub';
    const inst = apps.installedSuite(pkg).filter((a) => !all || !isHub(a)); const proj = apps.projects(pkg).filter((p) => !all || !isHub(p));
    const wanted = all ? null : (Array.isArray(names) ? names : String(names).split(',')).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
    const out = []; const seen = new Set();
    const consider = (list, kind) => { for (const a of list) { const key = a.id || a.name.toLowerCase(); if (seen.has(key)) continue; if (wanted && !wanted.includes(a.id) && !wanted.includes(a.name.toLowerCase())) continue; seen.add(key); out.push({ id: a.id, name: a.name, version: a.version, source: kind, spec: kind === 'installed' ? { app: a.name } : { project: a.dir } }); } };
    if (source === 'installed') consider(inst, 'installed');
    else if (source === 'projects') consider(proj, 'project');
    else { consider(inst, 'installed'); consider(proj, 'project'); }
    if (wanted) for (const w of wanted) if (!out.some((o) => o.id === w || o.name.toLowerCase() === w)) out.push({ id: slug(w), name: w, version: '', source: 'missing', spec: null });
    return out;
  }

  async smoke({ apps: names, source = 'auto', parallel, wait_seconds = 4, who = 'You', label } = {}) {
    const items = this.pickApps(names, source);
    if (!items.length) throw new Error('No apps found to test. Install Utility Suite apps, or set the Utility Package folder in Settings.');
    const n = Math.max(1, Math.min(+parallel || this.ctx.limits().apps, 16));
    const run = { id: newId('r'), kind: 'smoke', label: label || (items.length > 1 ? `Smoke test · ${items.length} apps` : `Smoke test · ${items[0].name}`), who, started: Date.now(), state: 'running', parallel: n, source, waitSeconds: wait_seconds,
      items: items.map((it) => ({ id: it.id, name: it.name, version: it.version, source: it.source, status: it.spec ? 'queued' : 'fail', note: it.spec ? '' : 'Not found on this computer or in the Utility Package', errors: [], warnings: 0, shots: [] })) };
    this.store.add(run); this.emit('changed', { id: run.id, run });
    const dir = path.join(this.dir, run.id); fs.mkdirSync(dir, { recursive: true });
    const act = { cancelled: false, sessions: new Set() }; this.active.set(run.id, act);
    const work = items.map((it, k) => ({ it, rec: run.items[k] })).filter((x) => x.it.spec);
    const done = (async () => {
      await pool(work, n, async ({ it, rec }) => {
        rec.status = 'running'; rec.started = Date.now(); this._save(run);
        let a = null; const data = path.join(dir, slug(it.id) + '-data');
        try {
          let target = apps.resolveLaunch(it.spec, { pkgDir: this.ctx.pkgDir() });
          if (target.needsInstall) { rec.note = 'Installing its packages first (npm install)'; this._save(run); await this.ctx.installDeps(target.needsInstall); target = apps.resolveLaunch(it.spec, { pkgDir: this.ctx.pkgDir() }); if (target.needsInstall) throw new Error('Its packages didn’t install'); rec.note = ''; }
          if (target.kind !== 'electron') throw new Error('Not an Electron app');
          rec.version = rec.version || target.version;
          const home = path.join(data, 'home'); for (const d of ['Documents', 'Downloads', 'Desktop', 'Pictures', 'Music']) fs.mkdirSync(path.join(home, d), { recursive: true });
          const env = { HOME: home, TMPDIR: path.join(data, 'tmp'), TEMP: path.join(data, 'tmp'), TMP: path.join(data, 'tmp'), BENCH_SANDBOX: '1' }; fs.mkdirSync(env.TMPDIR, { recursive: true });
          if (process.platform === 'win32') Object.assign(env, { USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local') });
          a = new ElectronApp({ id: newId('s'), name: it.name, exec: target.exec, args: target.args, cwd: target.cwd, env, userData: path.join(data, 'app-data'), hidden: true });
          act.sessions.add(a);
          await a.start();
          if (!a.controlled) throw new Error('The app doesn’t allow Bench inside (debugging is switched off in this build)');
          const ws = await a.waitForWindow({ timeout: 40000 });
          rec.windowMs = a.firstWindowAt ? a.firstWindowAt - a.startedAt : null; rec.loadMs = a.firstLoadAt ? a.firstLoadAt - a.startedAt : null;
          await sleep(Math.max(0, wait_seconds) * 1000);
          if (act.cancelled) throw new Error('Stopped');
          const vis = (await a.windows()).filter((w) => w.visible && !w.devtools);
          rec.windows = vis.map((w) => ({ id: w.id, title: w.title, width: w.width, height: w.height }));
          for (const w of vis.slice(0, 4)) {
            try { const s = await a.screenshot(w.id, { maxWidth: 1600 }); const f = path.join(dir, `${slug(it.id)}-${w.id}.png`); fs.writeFileSync(f, s.buffer); rec.shots.push({ file: f, win: w.id, title: w.title, width: s.width, height: s.height }); } catch (e) { rec.errors.push(`Couldn’t capture window “${w.title}”: ${e.message}`); }
          }
          void ws;
        } catch (e) { rec.fatal = e.message; }
        finally {
          if (a) {
            const errs = a.logs.query({ level: 'errors', limit: 400 }).filter((e) => !isNoise(e.text));
            rec.errors.push(...errs.map((e) => `${e.source === 'window' ? 'Window' : e.source === 'main' ? 'Main' : e.source === 'bench' ? 'Bench' : e.source}: ${e.text.slice(0, 600)}`).slice(0, 40));
            rec.warnings = a.logs.query({ level: 'warnings', limit: 1000 }).filter((e) => e.level === 'warning' && !isNoise(e.text)).length;
            rec.crashes = a.crashes.map((c) => `${c.kind}: ${c.reason}`);
            rec.log = a.logs.query({ limit: 400 }).map((e) => `[${e.level}] ${e.source}: ${e.text}`).join('\n').slice(-60000);
            await a.quit().catch(() => {}); act.sessions.delete(a);
            const exitBad = a.exit && a.state !== 'quitting' && (a.exit.code || a.exit.signal) && !rec.fatal;
            if (exitBad) rec.crashes.push(`App exited (${a.exit.signal || 'code ' + a.exit.code})`);
          }
          rec.ms = Date.now() - rec.started;
          rec.status = act.cancelled && rec.fatal === 'Stopped' ? 'skipped' : rec.fatal || (rec.crashes && rec.crashes.length) || (rec.windows && !rec.windows.length) ? 'fail' : rec.errors.length ? 'warn' : 'pass';
          if (rec.windows && !rec.windows.length && !rec.fatal) rec.fatal = 'No window appeared';
          try { safeRemove(data, [dir]); } catch {}
          this._save(run);
        }
      }, () => act.cancelled);
      for (const r of run.items) if (r.status === 'queued') r.status = 'skipped';
      run.state = act.cancelled ? 'stopped' : 'done'; run.finished = Date.now(); this._summarise(run); this._save(run); this.active.delete(run.id);
      return run;
    })();
    Object.defineProperty(run, 'promise', { value: done, enumerable: false });
    return run;
  }

  async tests({ projects: names, script = 'test', parallel, timeout_minutes = 10, who = 'You' } = {}) {
    const pkg = this.ctx.pkgDir();
    const all = apps.projects(pkg);
    let list;
    if (!names || names === 'all' || (Array.isArray(names) && names.includes('all'))) list = all.filter((p) => p.scripts.includes(script));
    else { const want = (Array.isArray(names) ? names : String(names).split(',')).map((s) => String(s).trim()); list = want.map((w) => all.find((p) => p.id === w.toLowerCase() || p.name.toLowerCase() === w.toLowerCase()) || (fs.existsSync(path.join(w, 'package.json')) ? (() => { const pk = JSON.parse(fs.readFileSync(path.join(w, 'package.json'), 'utf8')); return { id: slug(pk.name || path.basename(w)), name: pk.productName || pk.name || path.basename(w), dir: w, version: pk.version || '', scripts: Object.keys(pk.scripts || {}), hasDeps: fs.existsSync(path.join(w, 'node_modules')) }; })() : { id: slug(w), name: w, missing: true })); }
    if (!list.length) throw new Error(`No projects with a “${script}” script${pkg ? '' : ' (set the Utility Package folder in Settings)'}`);
    const n = Math.max(1, Math.min(+parallel || this.ctx.limits().tests, 24));
    const run = { id: newId('r'), kind: 'tests', label: list.length > 1 ? `npm ${script === 'test' ? 'test' : 'run ' + script} · ${list.length} projects` : `npm ${script === 'test' ? 'test' : 'run ' + script} · ${list[0].name}`, who, started: Date.now(), state: 'running', parallel: n, script,
      items: list.map((p) => ({ id: p.id, name: p.name, version: p.version || '', dir: p.dir, status: p.missing ? 'fail' : !p.scripts || !p.scripts.includes(script) ? 'skipped' : 'queued', note: p.missing ? 'Not found' : !p.scripts || !p.scripts.includes(script) ? `No “${script}” script` : '', errors: [] })) };
    this.store.add(run); this.emit('changed', { id: run.id, run });
    const dir = path.join(this.dir, run.id); fs.mkdirSync(dir, { recursive: true });
    const act = { cancelled: false, sessions: new Set() }; this.active.set(run.id, act);
    const done = (async () => {
      await pool(run.items.filter((i) => i.status === 'queued'), n, async (rec) => {
        rec.status = 'running'; rec.started = Date.now(); this._save(run);
        try {
          if (!fs.existsSync(path.join(rec.dir, 'node_modules'))) { rec.note = 'Installing packages first'; this._save(run); await this.ctx.installDeps(rec.dir); rec.note = ''; }
          const s = new CommandSession({ id: newId('s'), command: script === 'test' ? 'npm test' : `npm run ${script}`, cwd: rec.dir, env: { CI: '1' } });
          act.sessions.add(s); s.start();
          const r = await s.wait(timeout_minutes * 60000); act.sessions.delete(s);
          if (r.timedOut) { s.stop(); rec.fatal = `Still running after ${timeout_minutes} min, stopped`; }
          rec.code = r.code; rec.output = tail(r.output, 30000);
          fs.writeFileSync(path.join(dir, `${slug(rec.id)}.log`), r.output);
          rec.summary = summaryLine(r.output);
          if (r.code !== 0 && !rec.fatal) rec.errors = failingLines(r.output);
          rec.status = act.cancelled ? 'skipped' : r.code === 0 ? 'pass' : 'fail';
        } catch (e) { rec.fatal = e.message; rec.status = 'fail'; }
        rec.ms = Date.now() - rec.started; this._save(run);
      }, () => act.cancelled);
      for (const r of run.items) if (r.status === 'queued') r.status = 'skipped';
      run.state = act.cancelled ? 'stopped' : 'done'; run.finished = Date.now(); this._summarise(run); this._save(run); this.active.delete(run.id);
      return run;
    })();
    Object.defineProperty(run, 'promise', { value: done, enumerable: false });
    return run;
  }
  _summarise(run) {
    const c = { pass: 0, warn: 0, fail: 0, skipped: 0 }; for (const i of run.items) c[i.status] = (c[i.status] || 0) + 1;
    run.counts = c; run.ms = (run.finished || Date.now()) - run.started;
  }
}
function summaryLine(out) {
  const lines = String(out).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).reverse();
  return (lines.find((l) => /\b(\d+\s+(passing|passed|failed|failing|tests?|checks?|ok))\b|\bpass(ed)?\b.*\d|\d+\/\d+/i.test(l)) || lines[0] || '').slice(0, 160);
}
function failingLines(out) {
  return String(out).split(/\r?\n/).filter((l) => /(✗|✘|×|FAIL|not ok|AssertionError|Error:|failed)/.test(l)).slice(0, 12).map((l) => l.trim().slice(0, 300));
}

module.exports = { Runs, isNoise };
