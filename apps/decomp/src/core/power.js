// How hard Decomp drives the computer. Every engine and worker takes its share from here:
// threads per engine, how many engines run side by side, worker threads, Java heap and priority.
'use strict';
const os = require('os');

const MODES = {
  max:      { label: 'Full power', share: 1.0,  heap: 0.70, priority: 0,  note: 'Every core, most of the memory. Best when you’re waiting on it.' },
  balanced: { label: 'Balanced',   share: 0.75, heap: 0.50, priority: 0,  note: 'Leaves room for your other apps.' },
  quiet:    { label: 'Background', share: 0.40, heap: 0.30, priority: 10, note: 'Low priority; the computer stays responsive and cool.' },
};

function cpuCount() { return typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length; }

function budget(mode = 'max', override = {}) {
  const m = MODES[mode] || MODES.max;
  const cores = cpuCount();
  const threads = Math.max(1, Math.round(cores * m.share));
  const totalMB = Math.floor(os.totalmem() / 1048576);
  const heapMB = Math.max(1024, Math.min(Math.floor(totalMB * m.heap), 48 * 1024));
  // Engines are multi-threaded themselves, so only a few run at once and split the threads.
  const engines = Math.max(1, Math.min(override.engines || Math.ceil(threads / 3), 6));
  return { mode, label: m.label, cores, threads, workers: Math.max(1, threads), engines, heapMB, totalMB, priority: m.priority, cpuModel: (os.cpus()[0] || {}).model || 'CPU' };
}

// Per-core load since the previous call (0–1 each), for the live meter.
let prev = null;
function sample() {
  const cpus = os.cpus();
  const now = cpus.map((c) => { const t = c.times; return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq }; });
  let loads = now.map(() => 0);
  if (prev && prev.length === now.length) loads = now.map((c, i) => { const dt = c.total - prev[i].total, di = c.idle - prev[i].idle; return dt > 0 ? Math.max(0, Math.min(1, 1 - di / dt)) : 0; });
  prev = now;
  const free = os.freemem(), total = os.totalmem();
  return { cores: loads, avg: loads.reduce((a, b) => a + b, 0) / (loads.length || 1), memUsed: total - free, memTotal: total };
}

module.exports = { MODES, budget, sample, cpuCount };
