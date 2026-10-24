// A pool of worker threads (one per allowed core) for Decomp's own CPU work: hashing, string and
// signature scans, entropy, parallel extraction, CSO decompression, beautifying and search.
'use strict';
const path = require('path');
const { Worker } = require('worker_threads');

class Pool {
  constructor(size) {
    this.size = Math.max(1, size); this.workers = []; this.queue = []; this.seq = 0; this.busy = 0; this.closed = false;
  }
  resize(n) { this.size = Math.max(1, n); this.pump(); }
  spawn() {
    const w = new Worker(path.join(__dirname, 'worker.js'));
    w.job = null;
    w.on('message', (m) => {
      if (m.progress != null && w.job) { w.job.onProgress && w.job.onProgress(m.progress); return; }
      const j = w.job; w.job = null; this.busy--;
      if (j) { if (m.error) j.reject(Object.assign(new Error(m.error), { code: m.code })); else j.resolve(m.result); }
      this.pump();
    });
    w.on('error', (e) => { const j = w.job; w.job = null; if (j) { this.busy--; j.reject(e); } this.workers = this.workers.filter((x) => x !== w); this.pump(); });
    w.unref();
    this.workers.push(w);
    return w;
  }
  run(task, args, onProgress) {
    return new Promise((resolve, reject) => { this.queue.push({ id: ++this.seq, task, args, resolve, reject, onProgress }); this.pump(); });
  }
  pump() {
    while (this.queue.length && this.busy < this.size) {
      let w = this.workers.find((x) => !x.job);
      if (!w) { if (this.workers.length >= this.size) break; w = this.spawn(); }
      const j = this.queue.shift(); w.job = j; this.busy++;
      w.postMessage({ id: j.id, task: j.task, args: j.args });
    }
    // trim idle workers above the size
    for (const w of this.workers.filter((x) => !x.job).slice(Math.max(0, this.size - this.busy))) if (this.workers.length > this.size) { w.terminate(); this.workers = this.workers.filter((x) => x !== w); }
  }
  // Runs many tasks and resolves when all are done (keeps going past failures, which are returned).
  async all(items, onEach) {
    let done = 0;
    return Promise.all(items.map(([task, args]) => this.run(task, args).then((r) => { onEach && onEach(++done, items.length); return r; }, (e) => { onEach && onEach(++done, items.length); return { error: e.message }; })));
  }
  get active() { return this.busy; }
  close() { this.closed = true; for (const w of this.workers) w.terminate(); this.workers = []; }
}
module.exports = { Pool };
