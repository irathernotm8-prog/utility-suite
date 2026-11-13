// Mixer — game sound effects. The classic sfxr synth (square/saw/sine/noise/triangle oscillator, pitch slide and
// "delta slide", vibrato, arpeggio jump, duty sweep, retrigger, phaser, resonant low-pass and high-pass sweeps, a
// punchy envelope) rendered sample-exact at 44.1 kHz with 8× oversampling, plus what sfxr can't do: up to four
// layers per sound (each with a delay, gain and pitch), and 8-bit / low-sample-rate output for a retro feel.
// Plain JS with no imports: runs in the main process, the windows, the plugin's tests, and inside exported game
// modules (the source is embedded in them as-is).
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.MXSfx = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SR = 44100;
  const WAVES = ['square', 'saw', 'sine', 'noise', 'triangle'];
  // every parameter: [min, max, default, group, label]
  const PARAMS = {
    wave: [0, 4, 0, 'Wave', 'Waveform'],
    attack: [0, 1, 0, 'Envelope', 'Attack'], sustain: [0, 1, 0.3, 'Envelope', 'Sustain'], punch: [0, 1, 0, 'Envelope', 'Punch'], decay: [0, 1, 0.4, 'Envelope', 'Decay'],
    freq: [0, 1, 0.3, 'Pitch', 'Start pitch'], freqLimit: [0, 1, 0, 'Pitch', 'Lowest pitch (cut-off)'], slide: [-1, 1, 0, 'Pitch', 'Slide'], deltaSlide: [-1, 1, 0, 'Pitch', 'Slide change'],
    vibDepth: [0, 1, 0, 'Vibrato', 'Depth'], vibSpeed: [0, 1, 0, 'Vibrato', 'Speed'],
    arpMod: [-1, 1, 0, 'Arpeggio', 'Jump'], arpSpeed: [0, 1, 0, 'Arpeggio', 'When'],
    duty: [0, 1, 0, 'Duty', 'Square width'], dutySweep: [-1, 1, 0, 'Duty', 'Width sweep'],
    repeat: [0, 1, 0, 'Retrigger', 'Repeat speed'],
    phaserOffset: [-1, 1, 0, 'Phaser', 'Offset'], phaserSweep: [-1, 1, 0, 'Phaser', 'Sweep'],
    lpf: [0, 1, 1, 'Filters', 'Low-pass'], lpfSweep: [-1, 1, 0, 'Filters', 'Low-pass sweep'], lpfRes: [0, 1, 0, 'Filters', 'Resonance'], hpf: [0, 1, 0, 'Filters', 'High-pass'], hpfSweep: [-1, 1, 0, 'Filters', 'High-pass sweep'],
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function defaults() { const p = {}; for (const [k, v] of Object.entries(PARAMS)) p[k] = v[2]; return p; }
  function norm(p) { const o = defaults(); for (const k of Object.keys(PARAMS)) if (p && p[k] != null && isFinite(+p[k])) o[k] = clamp(+p[k], PARAMS[k][0], PARAMS[k][1]); o.wave = Math.round(typeof (p && p.wave) === 'string' ? Math.max(0, WAVES.indexOf(p.wave)) : o.wave); return o; }

  // a seedable random generator so "variation 3 of coin" is the same every time
  function rng(seed) { let s = (seed >>> 0) || 0x2f6b9a1d; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

  // ───── synthesis (one layer) → Float32Array at 44.1 kHz
  function synth(P0, { maxSeconds = 8, seed = 1 } = {}) {
    const p = norm(P0); const R = rng(seed); const rnd = () => R() * 2 - 1;
    let fperiod, fmaxperiod, fslide, fdslide, period, squareDuty, squareSlide, arpMod, arpTime, arpLimit;
    let fltp = 0, fltdp = 0, fltw, fltwD, fltdmp, fltphp = 0, flthp, flthpD, vibPhase = 0, vibSpeed, vibAmp;
    let envVol = 0, envStage = 0, envTime = 0; let envLen; let fphase, fdphase, iphase, ipp = 0; const phaser = new Float32Array(1024); const noiseBuf = new Float32Array(32);
    let repTime = 0, repLimit; let phase = 0;
    function reset(restart) {
      fperiod = 100 / (p.freq * p.freq + 0.001); period = fperiod | 0; fmaxperiod = 100 / (p.freqLimit * p.freqLimit + 0.001);
      fslide = 1 - Math.pow(p.slide, 3) * 0.01; fdslide = -Math.pow(p.deltaSlide, 3) * 0.000001;
      squareDuty = 0.5 - p.duty * 0.5; squareSlide = -p.dutySweep * 0.00005;
      arpMod = p.arpMod >= 0 ? 1 - p.arpMod * p.arpMod * 0.9 : 1 + p.arpMod * p.arpMod * 10; arpTime = 0; arpLimit = ((1 - p.arpSpeed) * (1 - p.arpSpeed) * 20000 + 32) | 0; if (p.arpSpeed === 1) arpLimit = 0;
      if (!restart) {
        fltp = 0; fltdp = 0; fltw = Math.pow(p.lpf, 3) * 0.1; fltwD = 1 + p.lpfSweep * 0.0001; fltdmp = Math.min(0.8, (5 / (1 + p.lpfRes * p.lpfRes * 20)) * (0.01 + fltw));
        fltphp = 0; flthp = p.hpf * p.hpf * 0.1; flthpD = 1 + p.hpfSweep * 0.0003;
        vibPhase = 0; vibSpeed = p.vibSpeed * p.vibSpeed * 0.01; vibAmp = p.vibDepth * 0.5;
        envVol = 0; envStage = 0; envTime = 0; envLen = [p.attack * p.attack * 100000, p.sustain * p.sustain * 100000, p.decay * p.decay * 100000].map((x) => Math.max(1, x | 0));
        fphase = p.phaserOffset * p.phaserOffset * 1020; if (p.phaserOffset < 0) fphase = -fphase; fdphase = p.phaserSweep * p.phaserSweep; if (p.phaserSweep < 0) fdphase = -fdphase; iphase = Math.abs(fphase | 0); ipp = 0; phaser.fill(0);
        for (let i = 0; i < 32; i++) noiseBuf[i] = rnd();
        repTime = 0; repLimit = ((1 - p.repeat) * (1 - p.repeat) * 20000 + 32) | 0; if (p.repeat === 0) repLimit = 0;
      }
    }
    reset(false);
    const max = Math.floor(maxSeconds * SR); const out = new Float32Array(max); let n = 0;
    for (; n < max; n++) {
      repTime++; if (repLimit !== 0 && repTime >= repLimit) { repTime = 0; reset(true); }
      arpTime++; if (arpLimit !== 0 && arpTime >= arpLimit) { arpLimit = 0; fperiod *= arpMod; }
      fslide += fdslide; fperiod *= fslide;
      if (fperiod > fmaxperiod) { fperiod = fmaxperiod; if (p.freqLimit > 0) break; }
      let rfperiod = fperiod; if (vibAmp > 0) { vibPhase += vibSpeed; rfperiod = fperiod * (1 + Math.sin(vibPhase) * vibAmp); }
      period = rfperiod | 0; if (period < 8) period = 8;
      squareDuty = clamp(squareDuty + squareSlide, 0, 0.5);
      envTime++; if (envTime > envLen[envStage]) { envTime = 0; envStage++; if (envStage === 3) break; }
      if (envStage === 0) envVol = envTime / envLen[0]; else if (envStage === 1) envVol = 1 + Math.pow(1 - envTime / envLen[1], 1) * 2 * p.punch; else envVol = 1 - envTime / envLen[2];
      fphase += fdphase; iphase = Math.min(1023, Math.abs(fphase | 0));
      if (flthpD !== 0) flthp = clamp(flthp * flthpD, 0.00001, 0.1);
      let ss = 0;
      for (let si = 0; si < 8; si++) {
        phase++; if (phase >= period) { phase %= period; if (p.wave === 3) for (let i = 0; i < 32; i++) noiseBuf[i] = rnd(); }
        const fp = phase / period; let s;
        switch (p.wave) { case 0: s = fp < squareDuty ? 0.5 : -0.5; break; case 1: s = 1 - fp * 2; break; case 2: s = Math.sin(fp * 2 * Math.PI); break; case 3: s = noiseBuf[((phase * 32) / period) | 0]; break; default: s = Math.abs(1 - fp * 2) * 2 - 1; }
        const pp = fltp; fltw = clamp(fltw * fltwD, 0, 0.1);
        if (p.lpf !== 1) { fltdp += (s - fltp) * fltw; fltdp -= fltdp * fltdmp; } else { fltp = s; fltdp = 0; }
        fltp += fltdp; fltphp += fltp - pp; fltphp -= fltphp * flthp; s = fltphp;
        phaser[ipp & 1023] = s; s += phaser[(ipp - iphase + 1024) & 1023]; ipp = (ipp + 1) & 1023;
        ss += s * envVol;
      }
      out[n] = ss / 8; // a full square sits at ±0.5; render() normalises the finished sound
    }
    return out.subarray(0, n);
  }

  // ───── a whole sound: layers (each delayed, gained, pitched), then output gain, fades, bit depth and sample rate
  // sound = { layers: [{ params, delay (s), gain (dB), pitch (semitones), on, seed }], gain (dB), bits: 16|8|6|4, rate: 44100|22050|11025|5512, normalize }
  function render(sound, { maxSeconds = 8 } = {}) {
    const S = typeof sound.layers === 'object' ? sound : { layers: [{ params: sound }] }; const parts = [];
    for (const [i, L] of (S.layers || []).entries()) {
      if (!L || L.on === false) continue; const P = norm(L.params || {});
      if (L.pitch) { const k = Math.pow(2, L.pitch / 12); const sh = (f) => clamp(Math.sqrt(Math.max(0, k * (f * f + 0.001) - 0.001)), 0, 1); P.freq = sh(P.freq); if (P.freqLimit) P.freqLimit = sh(P.freqLimit); } // sfxr's period is 100/(f²+0.001)
      const x = synth(P, { maxSeconds, seed: L.seed || i + 1 }); parts.push({ x, at: Math.round(clamp(+L.delay || 0, 0, 4) * SR), g: Math.pow(10, (+L.gain || 0) / 20) });
    }
    const len = parts.reduce((m, q) => Math.max(m, q.at + q.x.length), 0); const y = new Float32Array(Math.max(1, len));
    for (const q of parts) for (let i = 0; i < q.x.length; i++) y[q.at + i] += q.x[i] * q.g;
    // normalise the mix of layers to −3 dBFS so every sound in a pack starts at the same level; gain trims from there
    let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v)); const norm0 = S.normalize === false || pk < 1e-6 ? 1 : 0.708 / pk;
    const g = norm0 * Math.pow(10, (+S.gain || 0) / 20); const rate = [44100, 22050, 11025, 5512].includes(+S.rate) ? +S.rate : 44100; const bits = [16, 8, 6, 4].includes(+S.bits) ? +S.bits : 16;
    const hold = Math.round(SR / rate); const steps = Math.pow(2, bits - 1); let held = 0;
    for (let i = 0; i < y.length; i++) { let v = clamp(y[i] * g, -1, 1); if (hold > 1) { if (i % hold === 0) held = v; v = held; } if (bits < 16) v = Math.round(v * steps) / steps; y[i] = v; }
    // 4 ms fade at the end so a cut-off never clicks
    const f = Math.min(y.length, Math.round(0.004 * SR)); for (let i = 0; i < f; i++) y[y.length - 1 - i] *= i / f;
    return y;
  }

  // ───── generators: sfxr's eight, plus game staples. Each takes a random source so variations are repeatable.
  const G = {};
  const P = (o) => ({ ...defaults(), ...o });
  G.coin = (r) => { const o = P({ freq: 0.4 + r() * 0.5, sustain: r() * 0.1, decay: 0.1 + r() * 0.4, punch: 0.3 + r() * 0.3 }); if (r() < 0.5) { o.arpSpeed = 0.5 + r() * 0.2; o.arpMod = 0.2 + r() * 0.4; } return o; };
  G.laser = (r) => { const o = P({ wave: Math.floor(r() * 3) }); if (o.wave === 2 && r() < 0.5) o.wave = Math.floor(r() * 2); o.freq = 0.5 + r() * 0.5; o.freqLimit = Math.max(0.2, o.freq - 0.2 - r() * 0.6); o.slide = -0.15 - r() * 0.2; if (r() < 0.33) { o.freq = 0.3 + r() * 0.6; o.freqLimit = r() * 0.1; o.slide = -0.35 - r() * 0.3; } if (r() < 0.5) { o.duty = r() * 0.5; o.dutySweep = r() * 0.2; } else { o.duty = 0.4 + r() * 0.5; o.dutySweep = -r() * 0.7; } o.sustain = 0.1 + r() * 0.2; o.decay = r() * 0.4; if (r() < 0.5) o.punch = r() * 0.3; if (r() < 0.33) { o.phaserOffset = r() * 0.2; o.phaserSweep = -r() * 0.2; } if (r() < 0.5) o.hpf = r() * 0.3; return o; };
  G.explosion = (r) => { const o = P({ wave: 3 }); if (r() < 0.5) { o.freq = 0.1 + r() * 0.4; o.slide = -0.1 + r() * 0.4; } else { o.freq = 0.2 + r() * 0.7; o.slide = -0.2 - r() * 0.2; } o.freq *= o.freq; if (r() < 0.2) o.slide = 0; if (r() < 0.33) o.repeat = 0.3 + r() * 0.5; o.sustain = 0.1 + r() * 0.3; o.decay = r() * 0.5; if (r() < 0.5) { o.phaserOffset = -0.3 + r() * 0.9; o.phaserSweep = -r() * 0.3; } o.punch = 0.2 + r() * 0.6; if (r() < 0.5) { o.vibDepth = r() * 0.7; o.vibSpeed = r() * 0.6; } if (r() < 0.33) { o.arpSpeed = 0.6 + r() * 0.3; o.arpMod = 0.8 - r() * 1.6; } return o; };
  G.powerup = (r) => { const o = P(); if (r() < 0.5) o.wave = 1; else o.duty = r() * 0.6; if (r() < 0.5) { o.freq = 0.2 + r() * 0.3; o.slide = 0.1 + r() * 0.4; o.repeat = 0.4 + r() * 0.4; } else { o.freq = 0.2 + r() * 0.3; o.slide = 0.05 + r() * 0.2; if (r() < 0.5) { o.vibDepth = r() * 0.7; o.vibSpeed = r() * 0.6; } } o.sustain = r() * 0.4; o.decay = 0.1 + r() * 0.4; return o; };
  G.hit = (r) => { const o = P({ wave: [0, 1, 3][Math.floor(r() * 3)] }); if (o.wave === 0) o.duty = r() * 0.6; o.freq = 0.2 + r() * 0.6; o.slide = -0.3 - r() * 0.4; o.sustain = r() * 0.1; o.decay = 0.1 + r() * 0.2; if (r() < 0.5) o.hpf = r() * 0.3; return o; };
  G.jump = (r) => { const o = P({ wave: 0, duty: r() * 0.6, freq: 0.3 + r() * 0.3, slide: 0.1 + r() * 0.2, sustain: 0.1 + r() * 0.3, decay: 0.1 + r() * 0.2 }); if (r() < 0.5) o.hpf = r() * 0.3; if (r() < 0.5) o.lpf = 1 - r() * 0.6; return o; };
  G.blip = (r) => { const o = P({ wave: Math.floor(r() * 2) }); if (o.wave === 0) o.duty = r() * 0.6; o.freq = 0.2 + r() * 0.4; o.sustain = 0.1 + r() * 0.1; o.decay = r() * 0.2; o.hpf = 0.1; return o; };
  G.random = (r) => { const o = P(); const s = () => r() * 2 - 1; o.freq = Math.pow(s(), 2); if (r() < 0.5) o.freq = Math.pow(s(), 3) + 0.5; o.freqLimit = 0; o.slide = Math.pow(s(), 5); if (o.freq > 0.7 && o.slide > 0.2) o.slide = -o.slide; if (o.freq < 0.2 && o.slide < -0.05) o.slide = -o.slide; o.deltaSlide = Math.pow(s(), 3); o.duty = s(); o.dutySweep = Math.pow(s(), 3); o.vibDepth = Math.pow(s(), 3); o.vibSpeed = s(); o.attack = Math.pow(s(), 3); o.sustain = Math.pow(s(), 2); o.decay = s(); o.punch = Math.pow(r() * 0.8, 2); if (o.attack + o.sustain + o.decay < 0.2) { o.sustain += 0.2 + r() * 0.3; o.decay += 0.2 + r() * 0.3; } o.lpfRes = s(); o.lpf = 1 - Math.pow(r(), 3); o.lpfSweep = Math.pow(s(), 3); if (o.lpf < 0.1 && o.lpfSweep < -0.05) o.lpfSweep = -o.lpfSweep; o.hpf = Math.pow(r(), 5); o.hpfSweep = Math.pow(s(), 5); o.phaserOffset = Math.pow(s(), 3); o.phaserSweep = Math.pow(s(), 3); o.repeat = s(); o.arpSpeed = s(); o.arpMod = s(); o.wave = Math.floor(r() * 5); for (const key of Object.keys(PARAMS)) o[key] = clamp(o[key], PARAMS[key][0], PARAMS[key][1]); return o; };
  // game staples beyond sfxr
  G.select = (r) => P({ wave: 2, freq: 0.55 + r() * 0.15, sustain: 0.03 + r() * 0.03, decay: 0.08 + r() * 0.06, hpf: 0.15, punch: 0.2 });
  G.confirm = (r) => P({ wave: 0, duty: 0.3 + r() * 0.3, freq: 0.45 + r() * 0.1, sustain: 0.08 + r() * 0.05, decay: 0.18 + r() * 0.1, arpSpeed: 0.55 + r() * 0.1, arpMod: 0.35 + r() * 0.15, punch: 0.3 });
  G.cancel = (r) => P({ wave: 0, duty: 0.5, freq: 0.42 + r() * 0.08, sustain: 0.07, decay: 0.15 + r() * 0.08, arpSpeed: 0.55 + r() * 0.1, arpMod: -0.25 - r() * 0.1, hpf: 0.08 });
  G.footstep = (r) => P({ wave: 3, freq: 0.08 + r() * 0.08, sustain: 0.02 + r() * 0.03, decay: 0.12 + r() * 0.08, punch: 0.5 + r() * 0.3, lpf: 0.3 + r() * 0.2, lpfRes: 0.2, hpf: 0.03 });
  G.whoosh = (r) => P({ wave: 3, freq: 0.2 + r() * 0.2, attack: 0.25 + r() * 0.15, sustain: 0.1 + r() * 0.1, decay: 0.3 + r() * 0.15, lpf: 0.15 + r() * 0.1, lpfSweep: 0.25 + r() * 0.2, lpfRes: 0.5 + r() * 0.3, hpf: 0.05 });
  G.thud = (r) => P({ wave: 2, freq: 0.16 + r() * 0.06, slide: -0.25 - r() * 0.1, sustain: 0.03, decay: 0.25 + r() * 0.15, punch: 0.6 + r() * 0.3, lpf: 0.5 });
  G.magic = (r) => P({ wave: 2, freq: 0.35 + r() * 0.2, slide: 0.08 + r() * 0.08, vibDepth: 0.15 + r() * 0.2, vibSpeed: 0.5 + r() * 0.3, attack: 0.1 + r() * 0.1, sustain: 0.3 + r() * 0.2, decay: 0.35 + r() * 0.2, phaserOffset: 0.15 + r() * 0.2, phaserSweep: 0.1, repeat: r() < 0.5 ? 0.5 + r() * 0.2 : 0 });
  G.teleport = (r) => P({ wave: 0, duty: 0.2 + r() * 0.3, freq: 0.3 + r() * 0.1, slide: 0.25 + r() * 0.15, repeat: 0.55 + r() * 0.2, vibDepth: 0.3, vibSpeed: 0.7, sustain: 0.35 + r() * 0.15, decay: 0.3, phaserOffset: 0.2, phaserSweep: -0.15 });
  G.alarm = (r) => P({ wave: 0, duty: 0.5, freq: 0.45 + r() * 0.1, vibDepth: 0.5 + r() * 0.2, vibSpeed: 0.35 + r() * 0.15, sustain: 0.6 + r() * 0.2, decay: 0.2, hpf: 0.05 });
  G.death = (r) => P({ wave: 0, duty: 0.4 + r() * 0.2, freq: 0.45 + r() * 0.1, slide: -0.12 - r() * 0.06, deltaSlide: -0.1, vibDepth: 0.25 + r() * 0.15, vibSpeed: 0.55, sustain: 0.55 + r() * 0.2, decay: 0.4, lpf: 0.8 });
  G.heal = (r) => P({ wave: 2, freq: 0.35 + r() * 0.1, slide: 0.06, arpSpeed: 0.65 + r() * 0.1, arpMod: 0.3 + r() * 0.15, repeat: 0.62 + r() * 0.1, sustain: 0.25, decay: 0.3, phaserOffset: 0.1 });
  G.charge = (r) => P({ wave: 1, freq: 0.18 + r() * 0.08, slide: 0.12 + r() * 0.06, attack: 0.3 + r() * 0.1, sustain: 0.5 + r() * 0.15, decay: 0.12, vibDepth: 0.08, vibSpeed: 0.6, lpf: 0.45 + r() * 0.2, lpfSweep: 0.3, hpf: 0.05 });
  G.zap = (r) => P({ wave: 1, freq: 0.6 + r() * 0.2, slide: -0.25 - r() * 0.15, vibDepth: 0.6 + r() * 0.3, vibSpeed: 0.85 + r() * 0.15, sustain: 0.08 + r() * 0.08, decay: 0.2 + r() * 0.1, phaserOffset: -0.2, phaserSweep: 0.1 });
  G.bounce = (r) => P({ wave: 0, duty: 0.4, freq: 0.25 + r() * 0.1, slide: 0.35 + r() * 0.1, deltaSlide: -0.4 - r() * 0.2, sustain: 0.12, decay: 0.15 + r() * 0.1 });
  G.shoot = (r) => P({ wave: 3, freq: 0.5 + r() * 0.3, slide: -0.3 - r() * 0.2, sustain: 0.05 + r() * 0.05, decay: 0.15 + r() * 0.15, punch: 0.6 + r() * 0.3, lpf: 0.7 + r() * 0.3, hpf: 0.05 });
  G.door = (r) => P({ wave: 3, freq: 0.1 + r() * 0.05, attack: 0.05, sustain: 0.15 + r() * 0.1, decay: 0.2, lpf: 0.25 + r() * 0.1, lpfRes: 0.6 + r() * 0.2, lpfSweep: -0.1, vibDepth: 0.2, vibSpeed: 0.3 });
  // layered: what a single sfxr voice can't carry alone
  const LAYERED = {
    'big-explosion': (r) => [{ params: G.explosion(r), gain: 0 }, { params: G.thud(r), gain: 2, pitch: -7 }, { params: P({ wave: 3, freq: 0.05, sustain: 0.4, decay: 0.7, lpf: 0.2, lpfSweep: -0.1 }), delay: 0.05, gain: -6 }],
    'sword': (r) => [{ params: G.whoosh(r), gain: -2 }, { params: P({ wave: 0, duty: 0.8, freq: 0.75 + r() * 0.1, sustain: 0.02, decay: 0.35, punch: 0.4, vibDepth: 0.05, vibSpeed: 0.9, hpf: 0.25 }), delay: 0.1, gain: -4 }],
    'level-up': (r) => [0, 4, 7, 12].map((s, i) => ({ params: P({ wave: 0, duty: 0.5, freq: 0.42, sustain: 0.06, decay: 0.12 + (i === 3 ? 0.2 : 0), punch: 0.3 }), delay: i * 0.08, pitch: s, seed: i + 1 + Math.floor(r() * 9) })),
    'game-over': () => [0, -1, -2, -5].map((s, i) => ({ params: P({ wave: 0, duty: 0.5, freq: 0.36, sustain: i === 3 ? 0.4 : 0.12, decay: i === 3 ? 0.5 : 0.1, vibDepth: i === 3 ? 0.2 : 0, vibSpeed: 0.5, lpf: 0.8 }), delay: i * 0.22, pitch: s })),
    'pickup-gem': (r) => [{ params: G.coin(r) }, { params: P({ wave: 2, freq: 0.75, sustain: 0.05, decay: 0.35, phaserOffset: 0.1 }), delay: 0.06, gain: -6 }],
    'hurt-voice': (r) => [{ params: P({ wave: 1, freq: 0.3 + r() * 0.1, slide: -0.2, vibDepth: 0.3, vibSpeed: 0.75, sustain: 0.1, decay: 0.2, lpf: 0.4, lpfRes: 0.7 }) }, { params: G.hit(r), gain: -4 }],
  };
  const KINDS = {
    coin: 'Coin / pickup', laser: 'Laser', explosion: 'Explosion', powerup: 'Power-up', hit: 'Hit / hurt', jump: 'Jump', blip: 'Blip', random: 'Random',
    select: 'Menu move', confirm: 'Confirm', cancel: 'Cancel', footstep: 'Footstep', whoosh: 'Whoosh', thud: 'Thud / land', magic: 'Magic', teleport: 'Teleport', alarm: 'Alarm', death: 'Death', heal: 'Heal', charge: 'Charge-up', zap: 'Zap', bounce: 'Bounce', shoot: 'Gunshot', door: 'Door',
    'big-explosion': 'Big explosion', sword: 'Sword swing', 'level-up': 'Level up', 'game-over': 'Game over', 'pickup-gem': 'Gem', 'hurt-voice': 'Ouch',
  };
  function generate(kind, seed = Date.now()) {
    const k = String(kind || 'random').toLowerCase().replace(/[\s_]+/g, '-'); const r = rng(seed);
    if (LAYERED[k]) return { kind: k, layers: LAYERED[k](r).map((L, i) => ({ on: true, delay: 0, gain: 0, pitch: 0, seed: i + 1, ...L, params: norm(L.params) })) };
    const g = G[k] || G[Object.keys(G).find((x) => KINDS[x] && KINDS[x].toLowerCase().includes(k))]; if (!g) throw new Error(`Unknown kind “${kind}”. Kinds: ${Object.keys(KINDS).join(', ')}.`);
    return { kind: k, layers: [{ on: true, delay: 0, gain: 0, pitch: 0, seed: 1, params: norm(g(r)) }] };
  }
  // small random changes to every parameter (sfxr's Mutate), amount 0..1
  function mutate(params, amount = 0.3, seed = Date.now()) { const r = rng(seed); const o = { ...norm(params) }; for (const [k, [lo, hi]] of Object.entries(PARAMS)) { if (k === 'wave' || r() < 0.5) continue; o[k] = clamp(o[k] + (r() * 2 - 1) * 0.1 * amount * 3 * (hi - lo) / 2, lo, hi); } return o; }
  function mutateSound(sound, amount, seed) { return { ...sound, layers: sound.layers.map((L, i) => ({ ...L, params: mutate(L.params, amount, (seed || 1) * 31 + i) })) }; }

  // a quick description for Claude: length, peak, pitch at start/end
  function describe(sound) {
    const y = render(sound); let pk = 0, ss = 0; for (const v of y) { pk = Math.max(pk, Math.abs(v)); ss += v * v; }
    const L0 = (sound.layers || []).find((L) => L.on !== false); const pitch = (fr) => (fr ? Math.round((44100 / (100 / (fr * fr + 0.001))) * 8) : 0);
    return { seconds: +(y.length / SR).toFixed(3), peak_dbfs: +(pk > 0 ? 20 * Math.log10(pk) : -120).toFixed(1), rms_dbfs: +(ss > 0 ? 10 * Math.log10(ss / y.length) : -120).toFixed(1), layers: (sound.layers || []).filter((L) => L.on !== false).length, wave: L0 ? WAVES[norm(L0.params).wave] : null, start_hz: L0 && norm(L0.params).wave !== 3 ? pitch(norm(L0.params).freq) : null };
  }
  function wav(y, rate = SR) { const n = y.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf); const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }; w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true); for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(y[i] * 32767))), true); return new Uint8Array(buf); }
  function blank(name = 'New sound') { return { id: 'x' + Math.random().toString(36).slice(2, 9), name, kind: 'blip', gain: 0, bits: 16, rate: 44100, layers: [{ on: true, delay: 0, gain: 0, pitch: 0, seed: 1, params: defaults() }] }; }
  return { SR, WAVES, PARAMS, KINDS, defaults, norm, rng, synth, render, generate, mutate, mutateSound, describe, wav, blank };
});
