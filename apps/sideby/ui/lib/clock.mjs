// NTP-style clock offset between this computer and the host.
// offset = hostClock - localClock. hostNow = Date.now() + offset.
export class ClockSync {
  constructor({ keep = 8 } = {}) {
    this.keep = keep;
    this.samples = [];
    this.offset = 0;
    this.rtt = null;
  }

  reset() { this.samples = []; this.offset = 0; this.rtt = null; }

  add(t0, hostTime, t3) {
    const rtt = t3 - t0;
    if (!(rtt >= 0) || !Number.isFinite(hostTime)) return;
    this.samples.push({ rtt, offset: hostTime - (t0 + t3) / 2 });
    this.samples.sort((a, b) => a.rtt - b.rtt);
    this.samples = this.samples.slice(0, this.keep);
    const best = this.samples.slice(0, 3).map(s => s.offset).sort((a, b) => a - b);
    this.offset = best[Math.floor(best.length / 2)];
    this.rtt = this.samples[0].rtt;
  }

  hostNow(local = Date.now()) { return local + this.offset; }
  get ready() { return this.samples.length > 0; }
}
