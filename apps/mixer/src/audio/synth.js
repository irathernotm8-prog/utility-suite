// Mixer — the instruments: subtractive/additive voices with unison and stereo spread, FM (electric pianos, bells),
// plucked strings (Karplus–Strong, computed per note), noise layers, LFOs, pitch bends and glide. One call plays one
// note into a track's input; everything is scheduled ahead, so it works the same live and offline.
(function (root) {
  'use strict';
  const FX = root.MXFx;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // filter sweeps update once per 128-sample block: per-sample coefficient updates cost far more and sound the same
  const kr = (f) => { for (const p of [f.frequency, f.detune, f.Q]) try { p.automationRate = 'k-rate'; } catch {} return f; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const TABLES = {
    organ: (n) => ({ 1: 1, 2: 0.85, 3: 0.65, 4: 0.5, 6: 0.32, 8: 0.28, 10: 0.08, 12: 0.06, 16: 0.05 })[n] || 0,
    piano: (n) => (n > 24 ? 0 : (1 / Math.pow(n, 1.45)) * (n % 2 ? 1 : 0.8) * Math.exp(-n / 18)),
    epiano: (n) => ({ 1: 1, 2: 0.25, 3: 0.08, 4: 0.12, 7: 0.04 })[n] || 0,
    strings: (n) => (n > 40 ? 0 : (1 / n) * Math.exp(-n / 14)),
    brass: (n) => (n > 30 ? 0 : 1 / Math.pow(n, 0.85)),
    pulse: (n) => (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.25),
  };
  function wave(ctx, name) {
    const C = FX.ctxCache(ctx); const k = 'pw' + name; if (C[k]) return C[k];
    const N = 64, re = new Float32Array(N), im = new Float32Array(N); for (let n = 1; n < N; n++) { if (name === 'pulse') re[n] = TABLES.pulse(n); else im[n] = TABLES[name](n); }
    return (C[k] = ctx.createPeriodicWave(re, im));
  }
  function noise(ctx, crackle) {
    const C = FX.ctxCache(ctx); const k = crackle ? 'crackle' : 'noise'; if (C[k]) return C[k];
    const sr = ctx.sampleRate, b = ctx.createBuffer(2, sr * 3, sr); let seed = crackle ? 777 : 4242; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); if (crackle) { let hum = 0; for (let i = 0; i < d.length; i++) { const r = rnd(); hum = hum * 0.995 + (rnd() * 2 - 1) * 0.003; d[i] = hum + (r < 0.0004 ? (rnd() * 2 - 1) * 0.9 : r < 0.003 ? (rnd() * 2 - 1) * 0.15 : 0); } } else for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }
    return (C[k] = b);
  }
  // plucked string: an integer-length loop for the note, with the rest of the tuning done by playbackRate
  function ksBuffer(ctx, P, midi, seconds) {
    const C = FX.ctxCache(ctx); const k = `ks${P.id}|${midi}`; if (C[k]) return C[k];
    const sr = ctx.sampleRate, f = mtof(midi), Nx = sr / f, N = Math.max(2, Math.floor(Nx)); const len = Math.floor(sr * clamp(seconds, 0.3, 5)); const b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    const ks = P.ks || {}; const bright = clamp(ks.bright ?? 0.5, 0.05, 1), dec = clamp(ks.decay ?? 0.996, 0.9, 0.9995); const loss = Math.pow(dec, 440 / Math.max(40, f));
    let seed = midi * 9301 + 49297; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 116640 - 1; };
    const buf = new Float32Array(N); let lp = 0; for (let i = 0; i < N; i++) { lp = lp + bright * (rnd() - lp); buf[i] = lp; }
    let mean = 0; for (const v of buf) mean += v / N; for (let i = 0; i < N; i++) buf[i] -= mean;
    let idx = 0, prev = buf[N - 1]; const body = clamp(ks.body ?? 0.4, 0, 1); let bl = 0;
    for (let i = 0; i < len; i++) { const cur = buf[idx]; const nv = loss * (cur * (1 - 0.5) + prev * 0.5); prev = cur; buf[idx] = nv; idx = (idx + 1) % N; bl = bl + 0.25 * (cur - bl); d[i] = cur * (1 - body * 0.6) + bl * body * 0.6; }
    let pk = 0; for (let i = 0; i < Math.min(len, 4000); i++) pk = Math.max(pk, Math.abs(d[i])); if (pk > 0) for (let i = 0; i < len; i++) d[i] *= 0.8 / pk;
    const out = { buffer: b, rate: N / Nx }; C[k] = out; return out;
  }
  // ADSR on a gain param: rises to `peak`, decays to sustain, releases at tr. Works before playback starts.
  function adsr(param, t, tr, A, peak, { a, d, s, r }) {
    a = Math.max(0.001, a); d = Math.max(0.005, d); r = Math.max(0.005, r);
    param.setValueAtTime(0, t);
    let vRel;
    if (tr <= t + a) { vRel = (peak * (tr - t)) / a; param.linearRampToValueAtTime(vRel, tr); }
    else { param.linearRampToValueAtTime(peak, t + a); param.setTargetAtTime(peak * s, t + a, d / 3); vRel = peak * s + (peak - peak * s) * Math.exp(-(tr - t - a) / (d / 3)); param.setValueAtTime(vRel, tr); }
    param.setTargetAtTime(0, tr, r / 5);
    void A; return tr + r + 0.05;
  }

  function playNote(ctx, out, P, midi, t, dur, vel, o = {}) {
    const bpm = o.bpm || 120; const f = mtof(midi); const tr = t + Math.max(0.02, dur); const nodes = [];
    const amp = ctx.createGain(); amp.gain.value = 0; const L = root.MXLevels && root.MXLevels.inst[P.id]; const velGain = (L || 0.3) * (P.gain ?? 0.6) * (0.18 + 0.82 * Math.pow(clamp(vel, 0, 1), 1.25)); // MXLevels: every instrument calibrated so a mezzo-forte note peaks near −12 dBFS
    const A = { ...{ a: 0.005, d: 0.3, s: 0.7, r: 0.2 }, ...(P.amp || {}) };
    if (A.decayKey) A.d *= Math.pow(2, (-(midi - 60) / 12) * A.decayKey * 0.6);
    let ampMod = null;
    const vg = ctx.createGain(); vg.connect(out); // the note's single exit, disconnected once it's over
    // post-voice: optional drive, then amp, then optional pan LFO
    let voiceOut = vg;
    if (P.lfo && P.lfo.target === 'pan') { const pn = ctx.createStereoPanner(); pn.connect(out); voiceOut = pn; nodes.push(pn); }
    if (P.lfo && P.lfo.target === 'amp') { ampMod = ctx.createGain(); ampMod.gain.value = 1 - P.lfo.depth / 2; ampMod.connect(voiceOut); voiceOut = ampMod; }
    amp.connect(voiceOut);
    let pre = amp;
    if (P.drive) { const ws = ctx.createWaveShaper(); ws.curve = FX.curve(ctx, 'drive', Math.round(P.drive * 20) / 20); ws.oversample = '2x'; ws.connect(amp); pre = ws; nodes.push(ws); }
    let filt = null;
    if (P.filter) {
      const F = P.filter; filt = ctx.createBiquadFilter(); kr(filt); filt.type = F.type || 'lowpass'; filt.Q.value = F.q ?? 0.7;
      const kt = Math.pow(f / 261.63, F.keytrack ?? 0.5); const base = clamp((F.cutoff || 1000) * kt, 20, 20000); const peakF = clamp(base + (F.env || 0) * (0.35 + 0.65 * vel) * (F.type === 'bandpass' ? 1 : kt), 20, 20000);
      const fe = { a: F.a ?? 0.01, d: F.d ?? 0.3, s: F.s ?? 0.5, r: F.r ?? 0.2 }; if (F.envStretch) { fe.a = Math.max(fe.a, dur * 0.95); }
      const p = filt.frequency; p.setValueAtTime(base, t);
      if (F.env) { const sus = base + (peakF - base) * fe.s; if (tr <= t + fe.a) p.linearRampToValueAtTime(base + ((peakF - base) * (tr - t)) / fe.a, tr); else { p.linearRampToValueAtTime(peakF, t + fe.a); p.setTargetAtTime(sus, t + fe.a, Math.max(0.005, fe.d) / 3); p.setValueAtTime(sus + (peakF - sus) * Math.exp(-(tr - t - fe.a) / (Math.max(0.005, fe.d) / 3)), tr); } p.setTargetAtTime(base, tr, Math.max(0.005, fe.r) / 4); }
      filt.connect(pre); pre = filt; nodes.push(filt);
    }
    const end = adsr(amp.gain, t, tr, null, velGain, A);
    const srcs = [];
    const startF = o.from != null && P.glide ? mtof(o.from) : null;
    // LFO
    let lfoNode = null, lfoGain = null;
    if (P.lfo && P.lfo.depth) {
      lfoNode = ctx.createOscillator(); lfoNode.frequency.value = FX.toHz(P.lfo.rate, bpm) || 4; lfoGain = ctx.createGain(); const dep = P.lfo.target === 'amp' ? P.lfo.depth / 2 : P.lfo.depth; lfoGain.gain.setValueAtTime(P.lfo.delay ? 0 : dep, t); if (P.lfo.delay) lfoGain.gain.linearRampToValueAtTime(dep, t + P.lfo.delay); lfoNode.connect(lfoGain); srcs.push(lfoNode);
      if (P.lfo.target === 'cutoff' && filt) lfoGain.connect(filt.frequency); else if (P.lfo.target === 'amp' && ampMod) lfoGain.connect(ampMod.gain); else if (P.lfo.target === 'pan' && voiceOut.pan) lfoGain.connect(voiceOut.pan);
    }
    const pitchParams = [];
    // plucked string
    if (P.model === 'ks') { const k = ksBuffer(ctx, P, midi, A.d + A.r); const s = ctx.createBufferSource(); s.buffer = k.buffer; s.playbackRate.value = k.rate; const sg = ctx.createGain(); sg.gain.value = 1; s.connect(sg); sg.connect(pre); srcs.push(s); }
    // FM modulators
    let fmOut = null;
    if (P.model === 'fm' && P.fm) {
      const F = P.fm; fmOut = ctx.createGain(); fmOut.gain.value = 1;
      const mod = (ratio, index, decay, sustain) => { const m = ctx.createOscillator(); m.frequency.value = f * ratio; const mg = ctx.createGain(); const top = index * f * (0.4 + 0.6 * vel); mg.gain.setValueAtTime(top, t); mg.gain.setTargetAtTime(top * (sustain || 0), t, Math.max(0.005, decay) / 3); mg.gain.setTargetAtTime(0, tr, 0.05); m.connect(mg); mg.connect(fmOut); srcs.push(m); };
      mod(F.ratio, F.index, F.decay, F.sustain); if (F.ratio2) mod(F.ratio2, F.index2, F.decay2, 0);
    }
    for (const O of P.osc || []) {
      const voices = Math.max(1, O.voices || 1), spread = O.spread || 0; const og = ctx.createGain(); og.gain.value = (O.gain ?? 0.5) / Math.sqrt(voices);
      if (O.decayMul) { og.gain.setValueAtTime(og.gain.value, t); og.gain.setTargetAtTime(0, t, (A.d * O.decayMul) / 3); }
      og.connect(pre);
      // unison: voices left of centre share one panner, voices right share another (cheaper than one each)
      let pL = null, pR = null; if (voices > 1) { pL = ctx.createStereoPanner(); pL.pan.value = -0.7; pL.connect(og); pR = ctx.createStereoPanner(); pR.pan.value = 0.7; pR.connect(og); }
      for (let v = 0; v < voices; v++) {
        const osc = ctx.createOscillator();
        if (['sine', 'square', 'sawtooth', 'triangle'].includes(O.type)) osc.type = O.type; else osc.setPeriodicWave(wave(ctx, O.type || 'sine'));
        const ff = f * Math.pow(2, (O.octave || 0) + (O.semi || 0) / 12);
        if (startF) { osc.frequency.setValueAtTime(startF * Math.pow(2, (O.octave || 0) + (O.semi || 0) / 12), t); osc.frequency.exponentialRampToValueAtTime(ff, t + P.glide); }
        else if (P.bend) { osc.frequency.setValueAtTime(ff * Math.pow(2, P.bend.semis / 12), t); osc.frequency.setTargetAtTime(ff, t, P.bend.time / 2); }
        else osc.frequency.value = ff;
        osc.detune.value = (O.detune || 0) + (voices > 1 ? spread * (v / (voices - 1) - 0.5) * 2 : 0);
        if (fmOut) fmOut.connect(osc.frequency);
        if (voices > 1) { const side = v / (voices - 1) - 0.5; osc.connect(side < -0.01 ? pL : side > 0.01 ? pR : og); } else osc.connect(og);
        if (lfoGain && P.lfo.target === 'pitch') lfoGain.connect(osc.detune);
        pitchParams.push(osc.detune); srcs.push(osc);
      }
    }
    if (P.noise && P.noise.gain) {
      const N = P.noise; const s = ctx.createBufferSource(); s.buffer = noise(ctx, N.crackle); s.loop = true; const ng = ctx.createGain(); let node = s;
      if (N.hp) { const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = N.hp; node.connect(h); node = h; }
      if (N.bp) { const h = ctx.createBiquadFilter(); h.type = 'bandpass'; h.frequency.value = clamp(f * N.bp, 100, 16000); h.Q.value = 1.2; node.connect(h); node = h; }
      if (N.lp) { const h = ctx.createBiquadFilter(); h.type = 'lowpass'; h.frequency.value = N.lp; node.connect(h); node = h; }
      node.connect(ng); if (N.hold) { ng.gain.value = N.gain; ng.connect(pre); } else { ng.gain.setValueAtTime(N.gain * 2, t); ng.gain.setTargetAtTime(0, t, (N.decay || 0.03) / 3); ng.connect(pre); }
      srcs.push(s); s._off = Math.random() * 2;
    }
    for (const s of srcs) { try { if (s._off != null) s.start(t, s._off); else s.start(t); s.stop(end); } catch {} }
    return { amp, node: vg, end, srcs, cut(at) { amp.gain.cancelScheduledValues(at); amp.gain.setTargetAtTime(0, at, 0.006); for (const s of srcs) { try { s.stop(at + 0.05); } catch {} } } };
  }
  root.MXSynth = { playNote, mtof, wave, noise, ksBuffer };
})(typeof self !== 'undefined' ? self : this);
