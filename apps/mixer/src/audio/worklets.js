// Mixer — audio worklets. mx-crush: bit depth and sample-rate reduction (sample-and-hold), the "8-bit" sound.
class MxCrush extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'bits', defaultValue: 16, minValue: 1, maxValue: 16, automationRate: 'k-rate' }, { name: 'rate', defaultValue: 44100, minValue: 500, maxValue: 192000, automationRate: 'k-rate' }]; }
  constructor() { super(); this.ph = 0; this.h = [0, 0]; }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0]; const bits = params.bits[0]; const step = Math.max(1, sampleRate / params.rate[0]); const q = Math.pow(2, Math.max(1, bits) - 1); let end = this.ph;
    for (let c = 0; c < out.length; c++) {
      const x = inp[c] || inp[0], y = out[c]; if (!x) { y.fill(0); continue; } let ph = this.ph; let h = this.h[c] || 0;
      for (let n = 0; n < y.length; n++) { ph += 1; if (ph >= step) { ph -= step; h = bits >= 16 ? x[n] : Math.round(x[n] * q) / q; } y[n] = step <= 1 ? (bits >= 16 ? x[n] : Math.round(x[n] * q) / q) : h; }
      this.h[c] = h; end = ph;
    }
    this.ph = end; return true;
  }
}
registerProcessor('mx-crush', MxCrush);
