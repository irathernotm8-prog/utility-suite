// Runs on the audio thread. Mixes each input to mono and posts ~128 ms batches (at the context's 16 kHz) with the time of their first sample.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 2048;
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.t0 = 0;
    this.on = true;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.on = false; };
  }
  process(inputs) {
    const input = inputs[0];
    if (!this.on) return false;
    if (!input || !input.length || !input[0]) return true;
    const ch = input.length, len = input[0].length;
    for (let i = 0; i < len; i++) {
      if (this.n === 0) this.t0 = currentTime + i / sampleRate;
      let v = 0;
      for (let c = 0; c < ch; c++) v += input[c][i];
      this.buf[this.n++] = v / ch;
      if (this.n === this.size) {
        let s = 0; for (let k = 0; k < this.size; k++) s += this.buf[k] * this.buf[k];
        const out = this.buf; this.buf = new Float32Array(this.size); this.n = 0;
        this.port.postMessage({ t: this.t0, pcm: out, rms: Math.sqrt(s / this.size) }, [out.buffer]);
      }
    }
    return true;
  }
}
registerProcessor('docket-capture', Capture);
