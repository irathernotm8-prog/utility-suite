// Mixer — effects as Web Audio graphs. Each builder returns { input, output, set(params), param(name), trigger?(t) }.
// The same code runs for playback (AudioContext) and for export (OfflineAudioContext), so what you hear is what you get.
(function (root) {
  'use strict';
  const dbToGain = (d) => Math.pow(10, d / 20);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // "1/4" = a quarter note, "1/8d" dotted eighth, "1/16t" sixteenth triplet, "2" or 2 = that many beats... numbers < 4 with a unit 's' are seconds
  function noteBeats(v) { const m = /^(\d+)\/(\d+)([dt]?)$/.exec(String(v).trim()); if (!m) return null; let b = (4 * +m[1]) / +m[2]; if (m[3] === 'd') b *= 1.5; if (m[3] === 't') b *= 2 / 3; return b; }
  const toSeconds = (v, bpm) => { const b = noteBeats(v); return b != null ? (b * 60) / bpm : clamp(+v || 0.25, 0.001, 4); };
  const toHz = (v, bpm) => { const b = noteBeats(v); return b != null ? bpm / 60 / b : +v || 0; };
  const cache = new WeakMap();
  const ctxCache = (ctx) => { let c = cache.get(ctx); if (!c) { c = {}; cache.set(ctx, c); } return c; };
  const g = (ctx, v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  function setP(p, v, ctx) { if (ctx.state === 'running' && ctx instanceof AudioContext) p.setTargetAtTime(v, ctx.currentTime, 0.02); else p.value = v; }

  function impulse(ctx, decay, tone) {
    const C = ctxCache(ctx); const key = `ir${decay.toFixed(2)}|${Math.round(tone)}`; if (C[key]) return C[key];
    const sr = ctx.sampleRate, len = Math.max(1, Math.floor(sr * Math.min(10, decay * 1.1 + 0.05))); const b = ctx.createBuffer(2, len, sr);
    let seed = 0x9e3779b9 | 0; const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2147483648 - 1; }; // xorshift32: clean white noise (a float LCG loses bits and collapses into a hum)
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let lp = 0; for (let i = 0; i < len; i++) { const t = i / sr; const env = Math.exp((-6.9 * t) / decay) * Math.min(1, t / 0.004); const cut = tone * Math.exp((-1.6 * t) / decay); const a = Math.exp((-2 * Math.PI * cut) / sr); lp = (1 - a) * rnd() + a * lp; d[i] = lp * env; } }
    // no DC and little sub in the tail: a one-pole high-pass at ~90 Hz, then remove what mean is left
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); const a = Math.exp((-2 * Math.PI * 90) / sr); let px = 0, py = 0; for (let i = 0; i < len; i++) { const y = a * (py + d[i] - px); px = d[i]; py = y; d[i] = y; } let m = 0; for (let i = 0; i < len; i++) m += d[i]; m /= len; for (let i = 0; i < len; i++) d[i] -= m; }
    // normalise energy so different sizes sit at similar levels
    let e = 0; for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) e += d[i] * d[i]; } const k = Math.sqrt(0.5 / (e / 2 + 1e-12)); /* tail power ≈ half the dry power at 100% wet */ for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] *= k; }
    C[key] = b; return b;
  }
  function curve(ctx, kind, amt) {
    const C = ctxCache(ctx); const key = `cv${kind}${amt}`; if (C[key]) return C[key]; const n = kind === 'crush' ? 65536 : 4096; const c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; if (kind === 'drive') { const k = 1 + amt * 24; c[i] = Math.tanh(k * x) / Math.tanh(k); } else if (kind === 'crush') { const steps = Math.pow(2, amt - 1); c[i] = Math.round(x * steps) / steps; } else if (kind === 'clip') { const t = amt; const a = Math.abs(x); c[i] = Math.sign(x) * (a < t * 0.9 ? a : t * 0.9 + t * 0.1 * Math.tanh((a - t * 0.9) / (t * 0.1))); } }
    C[key] = c; return c;
  }
  function lfo(ctx, rate, type = 'sine') { const o = ctx.createOscillator(); o.type = type; o.frequency.value = rate; o.start(); return o; }

  const B = {};
  B.eq = (ctx, p) => {
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.Q.value = 0.707;
    const ls = ctx.createBiquadFilter(); ls.type = 'lowshelf'; const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; const hs = ctx.createBiquadFilter(); hs.type = 'highshelf';
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.707; hp.connect(ls); ls.connect(pk); pk.connect(hs); hs.connect(lp);
    const ny = ctx.sampleRate / 2 - 100;
    const set = (q) => { setP(hp.frequency, clamp(q.lowcut, 10, ny), ctx); setP(ls.gain, q.low, ctx); setP(ls.frequency, q.lowFreq, ctx); setP(pk.gain, q.mid, ctx); setP(pk.frequency, q.midFreq, ctx); setP(pk.Q, q.midQ, ctx); setP(hs.gain, q.high, ctx); setP(hs.frequency, Math.min(q.highFreq, ny), ctx); setP(lp.frequency, clamp(q.highcut, 200, ny), ctx); };
    set(p); return { input: hp, output: lp, set, param: (n) => (n === 'cutoff' ? lp.frequency : null) };
  };
  B.compressor = (ctx, p) => { const c = ctx.createDynamicsCompressor(); const m = g(ctx); c.connect(m); const set = (q) => { setP(c.threshold, q.threshold, ctx); setP(c.ratio, q.ratio, ctx); setP(c.attack, q.attack, ctx); setP(c.release, q.release, ctx); setP(c.knee, q.knee, ctx); setP(m.gain, dbToGain(q.makeup), ctx); }; set(p); return { input: c, output: m, set, node: c }; };
  B.reverb = (ctx, p, env) => {
    const inp = g(ctx), out = g(ctx), dry = g(ctx), wet = g(ctx), pre = ctx.createDelay(1); const conv = ctx.createConvolver(); conv.normalize = false;
    inp.connect(dry); dry.connect(out); inp.connect(pre); pre.connect(conv); conv.connect(wet); wet.connect(out);
    let last = '';
    const set = (q) => { const k = `${(+q.decay).toFixed(2)}|${q.tone}`; if (k !== last) { conv.buffer = impulse(ctx, clamp(+q.decay, 0.2, 10), clamp(+q.tone, 500, 18000)); last = k; } setP(pre.delayTime, clamp(+q.predelay, 0, 0.5), ctx); setP(wet.gain, Math.sin((clamp(q.mix, 0, 1) * Math.PI) / 2) * 1.6, ctx); setP(dry.gain, Math.cos((clamp(q.mix, 0, 1) * Math.PI) / 2), ctx); };
    set(p); return { input: inp, output: out, set };
  };
  B.delay = (ctx, p, env) => {
    const inp = g(ctx), out = g(ctx), dry = g(ctx), wet = g(ctx), dl = ctx.createDelay(4), dr = ctx.createDelay(4), fb = g(ctx), tone = ctx.createBiquadFilter(); tone.type = 'lowpass';
    const merge = ctx.createChannelMerger(2); const sum = g(ctx); sum.channelCount = 1; sum.channelCountMode = 'explicit'; sum.channelInterpretation = 'speakers';
    inp.connect(dry); dry.connect(out);
    let mode = null;
    const wire = (pp) => {
      if (mode === pp) return; mode = pp; for (const n of [sum, dl, dr, fb, tone, merge]) try { n.disconnect(); } catch {}
      if (pp) { inp.connect(sum); sum.connect(tone); tone.connect(dl); dl.connect(merge, 0, 0); dl.connect(dr); dr.connect(merge, 0, 1); dr.connect(fb); fb.connect(dl); merge.connect(wet); }
      else { inp.connect(tone); tone.connect(dl); dl.connect(fb); fb.connect(tone); dl.connect(wet); }
      wet.connect(out);
    };
    const set = (q) => { wire(!!+q.pingpong); const t = toSeconds(q.time, env.bpm); setP(dl.delayTime, t, ctx); setP(dr.delayTime, t, ctx); setP(fb.gain, clamp(q.feedback, 0, 0.95), ctx); setP(tone.frequency, q.tone, ctx); setP(wet.gain, clamp(q.mix, 0, 1), ctx); setP(dry.gain, 1 - clamp(q.mix, 0, 1) * 0.35, ctx); };
    set(p); return { input: inp, output: out, set };
  };
  B.drive = (ctx, p) => { const inp = g(ctx), out = g(ctx), dry = g(ctx), wet = g(ctx), pre = g(ctx), ws = ctx.createWaveShaper(), tone = ctx.createBiquadFilter(), comp = g(ctx); ws.oversample = '4x'; tone.type = 'lowpass'; inp.connect(dry); dry.connect(out); inp.connect(pre); pre.connect(ws); ws.connect(tone); tone.connect(comp); comp.connect(wet); wet.connect(out);
    const set = (q) => { const a = clamp(+q.amount, 0, 1); ws.curve = curve(ctx, 'drive', Math.round(a * 20) / 20); setP(pre.gain, 1 + a, ctx); setP(comp.gain, 1 / (1 + a * 1.4), ctx); setP(tone.frequency, q.tone, ctx); setP(wet.gain, clamp(q.mix, 0, 1), ctx); setP(dry.gain, 1 - clamp(q.mix, 0, 1), ctx); }; set(p); return { input: inp, output: out, set }; };
  B.filter = (ctx, p, env) => {
    const f = ctx.createBiquadFilter(); for (const q of [f.frequency, f.detune]) try { q.automationRate = 'k-rate'; } catch {} let osc = null, depth = null;
    const set = (q) => { f.type = ['lowpass', 'highpass', 'bandpass', 'notch'].includes(q.mode) ? q.mode : 'lowpass'; setP(f.frequency, clamp(+q.cutoff, 20, ctx.sampleRate / 2 - 100), ctx); setP(f.Q, clamp(+q.q, 0.1, 30), ctx);
      const r = toHz(q.lfoRate, env.bpm); if (r > 0 && +q.lfoDepth > 0) { if (!osc) { osc = lfo(ctx, r); depth = g(ctx, 0); osc.connect(depth); depth.connect(f.detune); } setP(osc.frequency, r, ctx); setP(depth.gain, 4800 * clamp(+q.lfoDepth, 0, 1), ctx); } else if (depth) setP(depth.gain, 0, ctx); };
    set(p); return { input: f, output: f, set, param: (n) => (n === 'cutoff' ? f.frequency : null) };
  };
  B.chorus = (ctx, p) => {
    const inp = g(ctx), out = g(ctx), dry = g(ctx), wet = g(ctx), sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2); const dL = ctx.createDelay(0.1), dR = ctx.createDelay(0.1); const o = lfo(ctx, 0.8); const aL = g(ctx), aR = g(ctx);
    inp.connect(dry); dry.connect(out); inp.connect(sp); sp.connect(dL, 0); sp.connect(dR, 1); dL.connect(mg, 0, 0); dR.connect(mg, 0, 1); mg.connect(wet); wet.connect(out); o.connect(aL); o.connect(aR); aL.connect(dL.delayTime); aR.connect(dR.delayTime);
    const set = (q) => { setP(o.frequency, q.rate, ctx); dL.delayTime.value = 0.014; dR.delayTime.value = 0.017; setP(aL.gain, q.depth, ctx); setP(aR.gain, -q.depth, ctx); setP(wet.gain, clamp(q.mix, 0, 1), ctx); setP(dry.gain, 1 - clamp(q.mix, 0, 1) * 0.4, ctx); };
    set(p); return { input: inp, output: out, set };
  };
  B.width = (ctx, p) => {
    const inp = g(ctx), sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2); const mL = g(ctx, 0.5), mR = g(ctx, 0.5), sL = g(ctx, 0.5), sR = g(ctx, -0.5); const mid = g(ctx), side = g(ctx), sideW = g(ctx), sideN = g(ctx, -1); const hp = ctx.createBiquadFilter(); hp.type = 'highpass';
    inp.connect(sp); sp.connect(mL, 0); sp.connect(mR, 1); sp.connect(sL, 0); sp.connect(sR, 1); mL.connect(mid); mR.connect(mid); sL.connect(side); sR.connect(side); side.connect(hp); hp.connect(sideW); mid.connect(mg, 0, 0); mid.connect(mg, 0, 1); sideW.connect(mg, 0, 0); sideW.connect(sideN); sideN.connect(mg, 0, 1);
    const set = (q) => { setP(sideW.gain, clamp(+q.width, 0, 2), ctx); setP(hp.frequency, Math.max(1, +q.monoBelow || 1), ctx); }; set(p);
    return { input: inp, output: mg, set };
  };
  // the crush effect uses an audio worklet (bit depth + sample rate); prepare(ctx) loads it once per context
  const BASE = typeof document !== 'undefined' && document.currentScript ? document.currentScript.src : null;
  function prepare(ctx) { if (ctx._mxReady) return ctx._mxReady; ctx._mxReady = ctx.audioWorklet && BASE ? ctx.audioWorklet.addModule(new URL('worklets.js', BASE).href).then(() => { ctx._mxw = true; }).catch((e) => { console.warn('worklet', e); }) : Promise.resolve(); return ctx._mxReady; }
  B.crush = (ctx, p) => {
    if (ctx._mxw) { const inp = g(ctx), out = g(ctx), dry = g(ctx), wet = g(ctx); const w = new AudioWorkletNode(ctx, 'mx-crush', { outputChannelCount: [2] }); inp.connect(dry); dry.connect(out); inp.connect(w); w.connect(wet); wet.connect(out);
      const set = (q) => { w.parameters.get('bits').value = clamp(Math.round(q.bits), 1, 16); w.parameters.get('rate').value = clamp(+q.rate || 44100, 500, 96000); setP(wet.gain, clamp(q.mix, 0, 1), ctx); setP(dry.gain, 1 - clamp(q.mix, 0, 1), ctx); }; set(p); return { input: inp, output: out, set }; }
    return crushShaper(ctx, p);
  };
  const crushShaper = (ctx, p) => { const inp = g(ctx), out = g(ctx), dry = g(ctx), wet = g(ctx), ws = ctx.createWaveShaper(); inp.connect(dry); dry.connect(out); inp.connect(ws); ws.connect(wet); wet.connect(out); const set = (q) => { ws.curve = curve(ctx, 'crush', clamp(Math.round(q.bits), 2, 16)); setP(wet.gain, clamp(q.mix, 0, 1), ctx); setP(dry.gain, 1 - clamp(q.mix, 0, 1), ctx); }; set(p); return { input: inp, output: out, set }; };
  B.tremolo = (ctx, p, env) => { const inp = g(ctx), amp = g(ctx), pan = ctx.createStereoPanner(), o = lfo(ctx, 4), d = g(ctx, 0), dp = g(ctx, 0); inp.connect(amp); amp.connect(pan); o.connect(d); d.connect(amp.gain); o.connect(dp); dp.connect(pan.pan);
    const set = (q) => { const r = toHz(q.rate, env.bpm) || 4; setP(o.frequency, r, ctx); const dep = clamp(+q.depth, 0, 1); if (+q.pan) { setP(d.gain, 0, ctx); setP(amp.gain, 1, ctx); setP(dp.gain, dep, ctx); } else { setP(dp.gain, 0, ctx); setP(amp.gain, 1 - dep / 2, ctx); setP(d.gain, dep / 2, ctx); } }; set(p); return { input: inp, output: pan, set }; };
  B.duck = (ctx, p) => { const n = g(ctx); let q = p; const set = (x) => { q = x; }; set(p); return { input: n, output: n, set, trigger: (t) => { const low = dbToGain(clamp(+q.amount, -40, 0)); n.gain.setTargetAtTime(low, Math.max(0, t - 0.002), 0.004); n.gain.setTargetAtTime(1, t + 0.03, clamp(+q.release, 0.02, 1) / 3); }, follows: () => q }; };
  B.limiter = (ctx, p) => { const pre = g(ctx), c = ctx.createDynamicsCompressor(), post = g(ctx), ws = ctx.createWaveShaper(); c.knee.value = 0; c.ratio.value = 20; c.attack.value = 0.001; c.release.value = 0.08; pre.connect(c); c.connect(post); post.connect(ws);
    const set = (q) => { const ceil = dbToGain(clamp(+q.ceiling, -12, 0)); setP(pre.gain, dbToGain(clamp(+q.gain, 0, 30)), ctx); setP(c.threshold, clamp(+q.ceiling, -12, 0) - 2.5, ctx); setP(post.gain, 1, ctx); ws.curve = curve(ctx, 'clip', Math.round(ceil * 1000) / 1000); }; set(p); return { input: pre, output: ws, set, node: c }; };

  function build(ctx, fx, env) { const b = B[fx.type]; if (!b) throw new Error('Unknown effect ' + fx.type); const u = b(ctx, fx, env); u.type = fx.type; u.id = fx.id; return u; }
  root.MXFx = { build, prepare, toSeconds, toHz, noteBeats, dbToGain, curve, impulse, ctxCache };
})(typeof self !== 'undefined' ? self : this);
