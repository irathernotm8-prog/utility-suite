// Mixer — synthesized drums (no samples): kick, snare, clap, rim, hats, toms, cymbals, shaker, cowbell, percussion,
// snap and transition FX, each shaped by the kit's settings. A drum track can also swap any voice for your own sample.
(function (root) {
  'use strict';
  const SND = root.MXSounds, FX = root.MXFx, SY = root.MXSynth;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const METAL = [2, 3, 4.16, 5.43, 6.79, 8.21];
  const LEVEL = 0.27; // headroom: a fresh mix lands near −14 LUFS with the master limiter at 0 dB

  function env(ctx, t, peak, decay, attack = 0.001) { const gn = ctx.createGain(); gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(peak, t + attack); gn.gain.setTargetAtTime(0, t + attack, Math.max(0.003, decay) / 4); return gn; }
  function noiseSrc(ctx, t, end) { const s = ctx.createBufferSource(); s.buffer = SY.noise(ctx); s.start(t, Math.random() * 2); s.stop(end); return s; }
  function filt(ctx, type, f, q = 0.7) { const b = ctx.createBiquadFilter(); try { b.frequency.automationRate = 'k-rate'; } catch {} b.type = type; b.frequency.value = clamp(f, 20, ctx.sampleRate / 2 - 100); b.Q.value = q; return b; }
  function chain(...n) { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; }

  // six detuned squares (the 808 cymbal recipe), rendered once per context and played as a buffer
  function metalBuffer(ctx, base) {
    const C = FX.ctxCache(ctx); const k = 'metal' + base; if (C[k]) return C[k];
    const sr = ctx.sampleRate, len = Math.floor(sr * 2.5), b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    const ph = METAL.map((r) => (base * r * 7.3) / sr); for (let i = 0; i < len; i++) { let v = 0; for (let j = 0; j < 6; j++) v += ((i * ph[j]) % 1 < 0.5 ? 1 : -1); d[i] = v * 0.18; }
    return (C[k] = b);
  }
  function metallic(ctx, t, end, base = 40) { const s = ctx.createBufferSource(); s.buffer = metalBuffer(ctx, base); s.start(t); s.stop(Math.min(end, t + 2.5)); return s; }

  const V = {
    kick(ctx, out, t, v, P) {
      const end = t + P.decay * 1.6 + 0.1; const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(P.f0 * 2.2, t); o.frequency.exponentialRampToValueAtTime(P.f0, t + 0.006); o.frequency.setTargetAtTime(P.f1, t + 0.006, P.pd / 2.5);
      const e = env(ctx, t, 1.1 * v * P.gain, P.decay, 0.0015); let n = o; if (P.drive) { const ws = ctx.createWaveShaper(); ws.curve = FX.curve(ctx, 'drive', Math.round(P.drive * 20) / 20); o.connect(ws); n = ws; }
      chain(n, e, out); o.start(t); o.stop(end);
      if (P.click) { const ns = noiseSrc(ctx, t, t + 0.03); chain(ns, filt(ctx, 'highpass', 1800), env(ctx, t, P.click * v * 0.6, 0.012), out); }
    },
    snare(ctx, out, t, v, P) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(P.tone * 1.6, t); o.frequency.setTargetAtTime(P.tone, t, 0.012); chain(o, env(ctx, t, 0.75 * v * P.gain, P.toneDecay), out); o.start(t); o.stop(t + P.toneDecay * 2 + 0.05);
      const ns = noiseSrc(ctx, t, t + P.noiseDecay * 2 + 0.05); chain(ns, filt(ctx, 'highpass', P.hp), filt(ctx, 'peaking', P.bp, 0.8), env(ctx, t, P.noise * v * P.gain * 0.9, P.noiseDecay), out);
    },
    clap(ctx, out, t, v, P) {
      const end = t + P.decay * 2 + 0.06; const ns = noiseSrc(ctx, t, end); const bp = filt(ctx, 'bandpass', P.bp, P.q); const gn = ctx.createGain(); gn.gain.setValueAtTime(0, t);
      const pk = 1.3 * v * P.gain; for (let i = 0; i < 3; i++) { const s = t + i * P.spread; gn.gain.setValueAtTime(pk, s); gn.gain.setTargetAtTime(0.1 * pk, s + 0.001, 0.003); }
      const tail = t + 3 * P.spread; gn.gain.setValueAtTime(pk * 0.9, tail); gn.gain.setTargetAtTime(0, tail, P.decay / 4); chain(ns, filt(ctx, 'highpass', 600), bp, gn, out);
    },
    rim(ctx, out, t, v, P) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = P.f; const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = P.f * 0.48; const e = env(ctx, t, 0.5 * v * P.gain, P.decay); const bp = filt(ctx, 'bandpass', P.f, 3); o.connect(bp); o2.connect(bp); chain(bp, e, out); for (const x of [o, o2]) { x.start(t); x.stop(t + P.decay * 3 + 0.02); } },
    hat(ctx, out, t, v, P) { const end = t + P.decay * 3 + 0.03; const m = metallic(ctx, t, end); const ns = noiseSrc(ctx, t, end); const mix = ctx.createGain(); const mg = ctx.createGain(); mg.gain.value = P.metal; const ng = ctx.createGain(); ng.gain.value = (1 - P.metal) * 0.6 + 0.15; m.connect(mg); mg.connect(mix); ns.connect(ng); ng.connect(mix); chain(mix, filt(ctx, 'highpass', P.hp), filt(ctx, 'peaking', 10500, 1), env(ctx, t, 0.9 * v * P.gain, P.decay), out); },
    tom(ctx, out, t, v, P) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(P.f0, t); o.frequency.setTargetAtTime(P.f1, t, P.decay / 3); chain(o, env(ctx, t, 0.95 * v * P.gain, P.decay, 0.002), out); o.start(t); o.stop(t + P.decay * 1.6 + 0.05); const ns = noiseSrc(ctx, t, t + 0.05); chain(ns, filt(ctx, 'lowpass', P.f0 * 6), env(ctx, t, 0.2 * v, 0.02), out); },
    cymbal(ctx, out, t, v, P) { const end = t + P.decay * 1.4 + 0.1; const m = metallic(ctx, t, end, 46); const ns = noiseSrc(ctx, t, end); const mix = ctx.createGain(); const mg = ctx.createGain(); mg.gain.value = P.metal * 0.8; m.connect(mg); mg.connect(mix); const ng = ctx.createGain(); ng.gain.value = 0.55; ns.connect(ng); ng.connect(mix); chain(mix, filt(ctx, 'highpass', P.hp), env(ctx, t, 0.8 * v * P.gain, P.decay, 0.003), out);
      if (P.bell) { const b = ctx.createOscillator(); b.type = 'square'; b.frequency.value = 640; const b2 = ctx.createOscillator(); b2.type = 'square'; b2.frequency.value = 940; const bg = filt(ctx, 'bandpass', 3200, 2); b.connect(bg); b2.connect(bg); chain(bg, env(ctx, t, P.bell * 0.35 * v, 0.35), out); for (const x of [b, b2]) { x.start(t); x.stop(t + 0.6); } } },
    shaker(ctx, out, t, v, P) { const ns = noiseSrc(ctx, t, t + P.decay * 3 + P.attack + 0.02); chain(ns, filt(ctx, 'highpass', P.hp), filt(ctx, 'peaking', 9000, 1.5), env(ctx, t, 0.8 * v * P.gain, P.decay, P.attack), out); },
    cowbell(ctx, out, t, v, P) { const e = env(ctx, t, 0.5 * v * P.gain, P.decay); const bp = filt(ctx, 'bandpass', P.f * 1.6, 1.4); for (const f of [P.f, P.f * 1.48]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(bp); o.start(t); o.stop(t + P.decay * 3); } chain(bp, e, out); },
    perc(ctx, out, t, v, P) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(P.f * 1.5, t); o.frequency.setTargetAtTime(P.f, t, 0.01); chain(o, env(ctx, t, 0.8 * v * P.gain, P.decay), out); o.start(t); o.stop(t + P.decay * 3); },
    snap(ctx, out, t, v, P) { const ns = noiseSrc(ctx, t, t + P.decay * 3); chain(ns, filt(ctx, 'bandpass', P.bp, 2.5), env(ctx, t, 1.4 * v * P.gain, P.decay), out); },
    riser(ctx, out, t, v, P, o) { const L = (P.len * 60) / (o.bpm || 120); const ns = noiseSrc(ctx, t, t + L + 0.05); const bp = filt(ctx, 'bandpass', 300, 2.5); bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(9000, t + L); const gn = ctx.createGain(); gn.gain.setValueAtTime(0.001, t); gn.gain.exponentialRampToValueAtTime(v * P.gain, t + L * 0.95); gn.gain.linearRampToValueAtTime(0, t + L); chain(ns, bp, gn, out); },
    downlifter(ctx, out, t, v, P, o) { const L = (P.len * 60) / (o.bpm || 120); const ns = noiseSrc(ctx, t, t + L + 0.05); const bp = filt(ctx, 'bandpass', 8000, 2); bp.frequency.setValueAtTime(8000, t); bp.frequency.exponentialRampToValueAtTime(200, t + L); const gn = ctx.createGain(); gn.gain.setValueAtTime(v * P.gain, t); gn.gain.exponentialRampToValueAtTime(0.001, t + L); chain(ns, bp, gn, out); },
    impact(ctx, out, t, v, P) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.6); chain(o, env(ctx, t, v * P.gain, P.decay, 0.002), out); o.start(t); o.stop(t + P.decay * 1.5); const ns = noiseSrc(ctx, t, t + 1.2); chain(ns, filt(ctx, 'lowpass', 2500), env(ctx, t, 0.5 * v, 0.6), out); },
  };
  const MAP = { kick: 'kick', snare: 'snare', clap: 'clap', rim: 'rim', hat: 'hat', openhat: 'hat', tom_low: 'tom', tom_mid: 'tom', tom_high: 'tom', crash: 'cymbal', ride: 'cymbal', shaker: 'shaker', cowbell: 'cowbell', perc: 'perc', snap: 'snap', riser: 'riser', downlifter: 'downlifter', impact: 'impact' };

  // ───── 8-bit kits: drums built only from what an NES / Game Boy has — the triangle channel and the noise channel —
  // with stepped (4-bit) volume decays
  function stepEnv(ctx, t, peak, dur, attack = 0) {
    const gn = ctx.createGain(); const n = 48, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1); const lvl = attack && x < attack ? x / attack : Math.exp(-(x - attack) * 4.2) * (i === n - 1 ? 0 : 1); c[i] = (Math.round(lvl * 15) / 15) * peak; }
    gn.gain.setValueAtTime(0, Math.max(0, t - 0.001)); gn.gain.setValueCurveAtTime(c, t, Math.max(0.01, dur)); return gn;
  }
  function chipTri(ctx, out, t, f0, f1, dur, peak) { const o = ctx.createOscillator(); o.setPeriodicWave(SY.wave(ctx, 'tri4')); o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur * 0.8); const e = stepEnv(ctx, t, peak, dur); o.connect(e); e.connect(out); o.start(t); o.stop(t + dur + 0.02); }
  function chipNoise(ctx, out, t, rate, dur, peak, { short = false, to = null, attack = 0 } = {}) { const s = ctx.createBufferSource(); s.buffer = SY.lfsr(ctx, short); s.loop = true; const r0 = clamp(rate / ctx.sampleRate, 0.01, 16); s.playbackRate.setValueAtTime(r0, t); if (to) s.playbackRate.exponentialRampToValueAtTime(clamp(to / ctx.sampleRate, 0.01, 16), t + dur); const e = stepEnv(ctx, t, peak, dur, attack); s.connect(e); e.connect(out); s.start(t, Math.random()); s.stop(t + dur + 0.02); }
  const CHIPV = {
    kick: (c, o, t, v, k) => { chipTri(c, o, t, 240 * k.f, 50 * k.f, 0.13, v); chipNoise(c, o, t, 18000 * k.f, 0.025, v * 0.35); },
    snare: (c, o, t, v, k) => { chipNoise(c, o, t, 120000 * k.f, 0.15 * k.d, v * 0.75); chipTri(c, o, t, 230, 140, 0.06, v * 0.5); },
    clap: (c, o, t, v, k) => { chipNoise(c, o, t, 80000 * k.f, 0.03, v * 0.7); chipNoise(c, o, t + 0.022, 80000 * k.f, 0.12 * k.d, v * 0.7); },
    rim: (c, o, t, v) => chipTri(c, o, t, 950, 800, 0.035, v * 0.8),
    hat: (c, o, t, v, k) => chipNoise(c, o, t, 330000 * k.f, 0.035 * k.d, v * 0.55),
    openhat: (c, o, t, v, k) => chipNoise(c, o, t, 300000 * k.f, 0.22 * k.d, v * 0.5),
    tom_low: (c, o, t, v) => chipTri(c, o, t, 150, 70, 0.2, v), tom_mid: (c, o, t, v) => chipTri(c, o, t, 210, 100, 0.17, v), tom_high: (c, o, t, v) => chipTri(c, o, t, 290, 140, 0.14, v),
    crash: (c, o, t, v, k) => chipNoise(c, o, t, 190000 * k.f, 0.9 * k.d, v * 0.55), ride: (c, o, t, v, k) => chipNoise(c, o, t, 160000 * k.f, 0.55 * k.d, v * 0.4, { short: true }),
    shaker: (c, o, t, v, k) => chipNoise(c, o, t, 360000 * k.f, 0.06, v * 0.4, { attack: 0.3 }), cowbell: (c, o, t, v, k) => chipNoise(c, o, t, 52000 * k.f, 0.16, v * 0.5, { short: true }),
    perc: (c, o, t, v) => chipTri(c, o, t, 520, 380, 0.08, v * 0.8), snap: (c, o, t, v, k) => chipNoise(c, o, t, 220000 * k.f, 0.045, v * 0.6),
    riser: (c, o, t, v, k, P, b) => { const L = (P.len * 60) / (b || 120); chipNoise(c, o, t, 6000, L, v * 0.5, { to: 320000, attack: 0.9 }); },
    downlifter: (c, o, t, v, k, P, b) => { const L = (P.len * 60) / (b || 120); chipNoise(c, o, t, 300000, L, v * 0.5, { to: 5000 }); },
    impact: (c, o, t, v, k) => { chipTri(c, o, t, 120, 30, 0.6, v); chipNoise(c, o, t, 26000 * k.f, 1.2, v * 0.6); },
  };
  const CHIPK = { nes: { f: 1, d: 1 }, gb: { f: 0.75, d: 0.8 } };

  // a hit: kitId + voice name, or a sample pad { buffer, gain, tune }
  function hit(ctx, out, kitId, voice, t, vel, o = {}) {
    const pad = o.pad;
    if (pad && pad.buffer) { const s = ctx.createBufferSource(); s.buffer = pad.buffer; s.playbackRate.value = Math.pow(2, (pad.tune || 0) / 12); const gn = ctx.createGain(); gn.gain.value = FX.dbToGain(pad.gain || 0) * (0.25 + 0.75 * vel); s.connect(gn); gn.connect(out); s.start(t); return { node: gn, end: t + pad.buffer.duration / s.playbackRate.value + 0.05 }; }
    const fn = V[MAP[voice]]; if (!fn) return null; const P = SND.kitVoice(kitId, voice);
    if (kitId === 'fx' && voice === 'crash') P.decay = 3.2;
    const hg = ctx.createGain(); hg.connect(out); // one node per hit to disconnect when it's over
    const L = root.MXLevels && root.MXLevels.kit[kitId] && root.MXLevels.kit[kitId][voice]; const kit = SND.kit(kitId);
    if (kit && kit.chip && CHIPV[voice]) { CHIPV[voice](ctx, hg, t, clamp(vel, 0.02, 1) * (L || LEVEL), CHIPK[kit.chip] || CHIPK.nes, P, o.bpm); return { node: hg, end: t + Math.max(1.4, P.len ? (P.len * 60) / (o.bpm || 120) + 0.1 : 0) }; }
    fn(ctx, hg, t, clamp(vel, 0.02, 1) * (L || LEVEL), P, o);
    const len = P.len ? (P.len * 60) / (o.bpm || 120) : 0;
    return { node: hg, end: t + Math.max(len, (Math.max(P.decay || 0, P.noiseDecay || 0, P.toneDecay || 0) * 1.6) + 0.15, 0.3) };
  }
  root.MXDrums = { hit, VOICES: Object.keys(MAP) };
})(typeof self !== 'undefined' ? self : this);
