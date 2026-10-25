// Facet — the bridge to the Python engine. One long-lived worker process; requests are queued one at a time
// because they share the GPU. Stopping a request restarts the worker (PyTorch cannot be interrupted cleanly).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const core = require('./core');
const tools = require('./tools');
const setup = require('./setup');

let proc = null, ready = null, buf = '';
let seq = 0;
const pending = new Map();   // id -> { resolve, reject, onProgress, cmd }
const queue = [];
let current = null;
let emit = () => {};
let lastHello = null;

function logLine(l) {
  try { fs.appendFileSync(core.logFile(), l + '\n'); } catch {}
  emit({ type: 'log', line: l });
}

function start() {
  if (proc) return ready;
  const py = setup.venvPython();
  if (!tools.exists(py)) return Promise.reject(new Error('The 3D engine is not set up yet. Open Models and choose Set up engine.'));
  const s = core.get();
  const env = {
    FACET_MODELS: core.modelsDir(),
    FACET_DEVICE: s.device === 'cpu' ? 'cpu' : 'auto',
    FACET_KEEP_LOADED: s.keepLoaded ? '1' : '0',
    PYTHONUNBUFFERED: '1', PYTHONNOUSERSITE: '1', PYTHONIOENCODING: 'utf-8',
    HF_HOME: path.join(core.modelsDir(), '.hf'),
    TOKENIZERS_PARALLELISM: 'false', TQDM_DISABLE: '1',
    FACET_RAM_MB: String(Math.round(require('os').totalmem() / 1048576))
  };
  proc = spawn(py, ['-u', path.join(core.bundledEngine(), 'facet_worker.py')], { env: { ...process.env, ...env }, windowsHide: true, cwd: core.bundledEngine() });
  buf = '';
  ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('The engine took too long to start.')), 120000);
    proc.once('error', (e) => { clearTimeout(t); reject(e); });
    proc._ready = () => { clearTimeout(t); resolve(); };
  });
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { logLine(line); continue; }
      handle(msg);
    }
  });
  let errBuf = '';
  proc.stderr.on('data', (d) => {
    errBuf += d.toString();
    const parts = errBuf.split(/\r?\n|\r(?!\n)/);
    errBuf = parts.pop();
    for (const l of parts) if (l.trim() && !/it\/s\]|s\/it\]/.test(l)) logLine(l);
  });
  const me = proc;
  proc.on('exit', (code, sig) => {
    if (proc !== me) return;
    proc = null; ready = null;
    emit({ type: 'state', running: false });
    if (current) {
      const p = pending.get(current);
      pending.delete(current);
      const stopped = p?.stopped;
      current = null;
      p?.reject(Object.assign(new Error(stopped ? 'Stopped' : `The engine stopped unexpectedly${code != null ? ` (exit ${code})` : sig ? ` (${sig})` : ''}. It may have run out of memory; try a lower detail setting.`), { stopped }));
    }
    pump();
  });
  emit({ type: 'state', running: true });
  return ready;
}

function handle(msg) {
  if (msg.type === 'ready') { proc?._ready?.(); return; }
  const p = pending.get(msg.id);
  if (!p) return;
  if (msg.type === 'progress') { p.onProgress?.(msg); return; }
  pending.delete(msg.id);
  current = null;
  if (msg.type === 'result') p.resolve(msg.data);
  else {
    if (msg.detail) logLine(msg.detail);
    p.reject(new Error(msg.error || 'The engine reported an error.'));
  }
  pump();
}

async function pump() {
  if (current || !queue.length) return;
  const job = queue.shift();
  try { await start(); } catch (e) { pending.delete(job.id); job.reject(e); pump(); return; }
  current = job.id;
  job.onProgress?.({ stage: 'queued', pct: 0, msg: 'Starting' });
  proc.stdin.write(JSON.stringify({ id: job.id, cmd: job.cmd, args: job.args }) + '\n');
}

// Sends a command. Returns { id, promise }.
function request(cmd, args = {}, onProgress) {
  const id = 'r' + (++seq) + '-' + Date.now().toString(36);
  const promise = new Promise((resolve, reject) => {
    const job = { id, cmd, args, resolve, reject, onProgress };
    pending.set(id, job);
    queue.push(job);
    pump();
  });
  return { id, promise };
}

function cancel(id) {
  const qi = queue.findIndex(j => j.id === id);
  if (qi >= 0) { const [j] = queue.splice(qi, 1); pending.delete(id); j.reject(Object.assign(new Error('Stopped'), { stopped: true })); return; }
  if (current === id && proc) {
    const p = pending.get(id);
    if (p) p.stopped = true;
    tools.killTree(proc.pid);
    try { proc.kill('SIGKILL'); } catch {}
  }
}

async function hello() {
  const { promise } = request('hello');
  lastHello = await promise;
  return lastHello;
}

function stop() {
  if (!proc) return;
  try { proc.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n'); } catch {}
  const p = proc;
  setTimeout(() => { try { p.kill(); } catch {} }, 1500);
}
function restart() { if (proc) { tools.killTree(proc.pid); try { proc.kill('SIGKILL'); } catch {} } }

module.exports = { request, cancel, hello, stop, restart, running: () => !!proc, busy: () => !!current || queue.length > 0, lastHello: () => lastHello, onEvent: (fn) => { emit = fn; } };
