// Shares the machine between everything that's running. Engines (multi-threaded processes) take
// slots and split the thread budget between them; light jobs (pycdc, UPX…) run one per thread.
'use strict';

class Limiter {
  constructor(n) { this.n = n; this.active = 0; this.q = []; }
  set(n) { this.n = Math.max(1, n); this.pump(); }
  run(fn) { return new Promise((res, rej) => { this.q.push({ fn, res, rej }); this.pump(); }); }
  pump() { while (this.active < this.n && this.q.length) { const { fn, res, rej } = this.q.shift(); this.active++; Promise.resolve().then(fn).then(res, rej).finally(() => { this.active--; this.pump(); }); } }
}

class Scheduler {
  constructor(getBudget) {
    this.getBudget = getBudget;
    this.running = new Map(); this.waiting = []; this.seq = 0;
    this.light = new Limiter(getBudget().threads);
  }
  refresh() { this.light.set(this.getBudget().threads); this.pump(); }
  // fn({ threads, heapMB, priority }) → promise. label shows in the activity list.
  engine(label, fn, { maxThreads } = {}) {
    return new Promise((resolve, reject) => {
      this.waiting.push({ id: ++this.seq, label, fn, resolve, reject, maxThreads });
      // wait a tick so a burst of requests (all the DLLs in a folder) splits the threads evenly
      if (!this.soon) { this.soon = true; setImmediate(() => { this.soon = false; this.pump(); }); }
    });
  }
  pump() {
    const b = this.getBudget();
    while (this.waiting.length && this.running.size < b.engines) {
      const t = this.waiting[0];
      // split threads across what's running plus what's still waiting (up to the slot count)
      const share = Math.min(b.engines, this.running.size + this.waiting.length);
      const used = [...this.running.values()].reduce((a, r) => a + r.threads, 0);
      const free = b.threads - used;
      if (free < 1) break;                                   // wait for threads to come back
      const threads = Math.max(1, Math.min(Math.floor(b.threads / share), free, t.maxThreads || 999));
      this.waiting.shift();
      const heapMB = Math.max(768, Math.floor(b.heapMB / share));
      const run = { ...t, threads, heapMB, started: Date.now() };
      this.running.set(t.id, run);
      Promise.resolve().then(() => t.fn({ threads, heapMB, priority: b.priority }))
        .then(t.resolve, t.reject).finally(() => { this.running.delete(t.id); this.pump(); });
    }
  }
  lightRun(fn) { return this.light.run(fn); }
  snapshot() { return { engines: [...this.running.values()].map((r) => ({ label: r.label, threads: r.threads, heapMB: r.heapMB, since: r.started })), waiting: this.waiting.length, light: this.light.active }; }
  get threadsInUse() { return [...this.running.values()].reduce((a, r) => a + r.threads, 0) + this.light.active; }
}
module.exports = { Scheduler, Limiter };
