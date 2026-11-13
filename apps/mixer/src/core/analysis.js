// Mixer — listening for Claude. Claude can't hear, so this measures what an engineer listens for: loudness (LUFS,
// BS.1770 K-weighting with gating), peaks, dynamics, tempo and the first downbeat, key, tonal balance, stereo width
// and mono-compatibility of the low end, energy per bar (sections), and a mix check that turns those into plain notes.
// Plain JS on Float32Arrays; runs in Node (tests) and in the windows.
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.MXAnalysis = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const db = (x) => (x > 1e-12 ? 20 * Math.log10(x) : -120);
  const pdb = (x) => (x > 1e-24 ? 10 * Math.log10(x) : -120);
  const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2; const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } }
    }
  }
  const hann = (n) => { const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)); return w; };
  // magnitude spectra of frames: calls fn(mag, frameIndex) for each hop
  function stft(x, n, hop, fn) {
    const w = hann(n), re = new Float64Array(n), im = new Float64Array(n), mag = new Float32Array(n / 2); let f = 0;
    for (let s = 0; s + n <= x.length; s += hop, f++) { for (let i = 0; i < n; i++) { re[i] = x[s + i] * w[i]; im[i] = 0; } fft(re, im); for (let k = 0; k < n / 2; k++) mag[k] = Math.hypot(re[k], im[k]); fn(mag, f); }
    return f;
  }
  function mono(ch) { if (ch.length === 1) return ch[0]; const n = ch[0].length, o = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (const c of ch) s += c[i]; o[i] = s / ch.length; } return o; }
  // integer decimation with a 4-pole box pre-filter (good enough for onset/chroma work)
  function decimate(x, sr, target) {
    const k = Math.max(1, Math.round(sr / target)); if (k === 1) return { x, sr };
    let y = x; for (let pass = 0; pass < 2; pass++) { const z = new Float32Array(y.length); let acc = 0; for (let i = 0; i < y.length; i++) { acc += y[i]; if (i >= k) acc -= y[i - k]; z[i] = acc / k; } y = z; }
    const o = new Float32Array(Math.floor(y.length / k)); for (let i = 0; i < o.length; i++) o[i] = y[i * k + k - 1] || 0; return { x: o, sr: sr / k };
  }

  // ───── loudness (ITU-R BS.1770-4 / EBU R128)
  function kCoefs(sr) {
    let K = Math.tan((Math.PI * 1681.974450955533) / sr); const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416), Q = 0.7071752369554196; let a0 = 1 + K / Q + K * K;
    const s1 = { b0: (Vh + (Vb * K) / Q + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q + K * K) / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
    K = Math.tan((Math.PI * 38.13547087602444) / sr); const Q2 = 0.5003270373238773; a0 = 1 + K / Q2 + K * K;
    const s2 = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q2 + K * K) / a0 };
    return [s1, s2];
  }
  function biquad(x, c) { const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; } return y; }
  function loudness(ch, sr) {
    const [c1, c2] = kCoefs(sr); const kw = ch.slice(0, 2).map((x) => biquad(biquad(x, c1), c2));
    const sq = kw.map((x) => { const c = new Float64Array(x.length + 1); for (let i = 0; i < x.length; i++) c[i + 1] = c[i] + x[i] * x[i]; return c; });
    const blockMs = (len) => { const out = []; const L = Math.round(len * sr), hop = Math.round(0.1 * sr); for (let s = 0; s + L <= kw[0].length; s += hop) { let z = 0; for (const c of sq) z += (c[s + L] - c[s]) / L; out.push(z); } return out; };
    const lk = (z) => -0.691 + pdb(z);
    const m = blockMs(0.4); let integrated = -70;
    if (m.length) { const g1 = m.filter((z) => lk(z) > -70); if (g1.length) { const rel = lk(g1.reduce((a, b) => a + b, 0) / g1.length) - 10; const g2 = g1.filter((z) => lk(z) > rel); if (g2.length) integrated = lk(g2.reduce((a, b) => a + b, 0) / g2.length); } }
    const st = blockMs(3).map(lk); const stMax = st.length ? Math.max(...st) : integrated;
    let lra = 0; { const g = st.filter((v) => v > -70); if (g.length > 2) { const mean = pdb(g.reduce((a, v) => a + Math.pow(10, v / 10), 0) / g.length); const r = g.filter((v) => v > mean - 20).sort((a, b) => a - b); if (r.length > 2) lra = r[Math.floor(r.length * 0.95) - 1] - r[Math.floor(r.length * 0.1)]; } }
    return { integrated: +integrated.toFixed(1), shortTermMax: +stMax.toFixed(1), range: +lra.toFixed(1) };
  }
  function levels(ch) { let pk = 0, ss = 0, n = 0, dc = 0; for (const x of ch) { for (let i = 0; i < x.length; i++) { const v = x[i]; const a = v < 0 ? -v : v; if (a > pk) pk = a; ss += v * v; dc += v; } n += x.length; } let clips = 0; for (const x of ch) { let run = 0; for (let i = 0; i < x.length; i++) { if (Math.abs(x[i]) >= 0.999) { run++; if (run === 3) clips++; } else run = 0; } } return { peak: +db(pk).toFixed(2), rms: +db(Math.sqrt(ss / Math.max(1, n))).toFixed(1), dc: +(dc / Math.max(1, n)).toFixed(5), clips }; }

  // ───── tempo: spectral-flux onsets → autocorrelation, with a gentle preference for 85–165 BPM
  function onsetEnvelope(x, sr) {
    const d = decimate(x, sr, 11025); const n = 512, hop = 128; let prev = null; const env = [];
    stft(d.x, n, hop, (mag) => { const lm = new Float32Array(mag.length); for (let k = 0; k < mag.length; k++) lm[k] = Math.log1p(100 * mag[k]); let f = 0; if (prev) for (let k = 2; k < lm.length; k++) { const df = lm[k] - prev[k]; if (df > 0) f += df; } env.push(f); prev = lm; });
    const fps = d.sr / hop; const e = Float32Array.from(env);
    const W = Math.round(fps * 0.5); const o = new Float32Array(e.length); let acc = 0; for (let i = 0; i < e.length; i++) { acc += e[i]; if (i >= W) acc -= e[i - W]; const mean = acc / Math.min(i + 1, W); o[i] = Math.max(0, e[i] - mean); }
    return { env: o, fps };
  }
  function tempo(x, sr, { min = 60, max = 200 } = {}) {
    const { env, fps } = onsetEnvelope(x, sr); if (env.length < fps * 4) return { bpm: null, confidence: 0, firstBeat: 0 };
    const lagMin = Math.floor((60 * fps) / max), lagMax = Math.ceil((60 * fps) / min); const ac = new Float32Array(lagMax + 2);
    let e0 = 0; for (let i = 0; i < env.length; i++) e0 += env[i] * env[i];
    for (let L = lagMin; L <= lagMax + 1; L++) { let s = 0; for (let i = L; i < env.length; i++) s += env[i] * env[i - L]; ac[L] = s / (env.length - L); }
    const score = (L) => { const bpm = (60 * fps) / L; const pref = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2)); let s = ac[L]; if (2 * L < ac.length) s += 0.5 * ac[2 * L]; if (L % 2 === 0) s += 0.25 * ac[L / 2]; return s * (0.55 + 0.45 * pref); };
    let best = lagMin, bs = -1; for (let L = lagMin; L <= lagMax; L++) { const s = score(L); if (s > bs) { bs = s; best = L; } }
    const a = ac[best - 1] || ac[best], b = ac[best], c = ac[best + 1] || ac[best]; const den = a - 2 * b + c; const off = den ? (0.5 * (a - c)) / den : 0; const lag = best + Math.max(-0.5, Math.min(0.5, off));
    let bpm = (60 * fps) / lag;
    const mean = ac.slice(lagMin, lagMax).reduce((p, q) => p + q, 0) / (lagMax - lagMin); const conf = Math.max(0, Math.min(1, (ac[best] / (mean || 1) - 1) / 3));
    // phase: comb over the envelope to find the first beat
    const P = lag; let bestPh = 0, bp = -1; for (let ph = 0; ph < P; ph += 0.5) { let s = 0; for (let t = ph; t < env.length; t += P) s += env[Math.round(t)] || 0; if (s > bp) { bp = s; bestPh = ph; } }
    if (Math.abs(bpm - Math.round(bpm)) < 0.35) bpm = Math.round(bpm);
    if (bestPh > P - 1.5) bestPh = 0;
    return { bpm: +bpm.toFixed(1), confidence: +conf.toFixed(2), firstBeat: +(bestPh / fps).toFixed(3) };
  }

  // ───── key: chroma (55 Hz – 2 kHz) against the Krumhansl–Kessler profiles
  const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  function chroma(x, sr) {
    const d = decimate(x, sr, 11025); const n = 8192, hop = 4096; const pcBins = []; for (let k = 1; k < n / 2; k++) { const f = (k * d.sr) / n; if (f < 55 || f > 2000) continue; pcBins.push([k, ((Math.round(12 * Math.log2(f / 440)) + 9) % 12 + 12) % 12]); }
    const c = new Float64Array(12); let frames = 0;
    stft(d.x, n, hop, (mag) => { let tot = 0; const fc = new Float64Array(12); for (const [k, pc] of pcBins) { const m = mag[k]; if (m > mag[k - 1] && m >= mag[k + 1]) { fc[pc] += m; tot += m; } } if (tot > 1e-6) { for (let i = 0; i < 12; i++) c[i] += fc[i] / tot; frames++; } });
    return Array.from(c, (v) => (frames ? v / frames : 0));
  }
  function corr(a, b) { const ma = a.reduce((p, q) => p + q, 0) / 12, mb = b.reduce((p, q) => p + q, 0) / 12; let s = 0, sa = 0, sb = 0; for (let i = 0; i < 12; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return s / Math.sqrt(sa * sb || 1); }
  function key(x, sr) {
    const ch = chroma(x, sr); const res = [];
    for (let t = 0; t < 12; t++) { const rot = ch.slice(t).concat(ch.slice(0, t)); res.push({ key: `${NAMES[t]} major`, r: corr(rot, MAJ) }, { key: `${NAMES[t]} minor`, r: corr(rot, MIN) }); }
    res.sort((a, b) => b.r - a.r); const conf = Math.max(0, Math.min(1, (res[0].r - res[1].r) * 4 + res[0].r * 0.5));
    return { key: res[0].key, confidence: +conf.toFixed(2), alternatives: res.slice(1, 3).map((r) => r.key), chroma: ch.map((v) => +v.toFixed(3)) };
  }

  // ───── tonal balance, stereo, sections
  const BANDS = [['sub', 20, 60], ['bass', 60, 250], ['low_mids', 250, 500], ['mids', 500, 2000], ['high_mids', 2000, 6000], ['air', 6000, 20000]];
  function balance(x, sr) {
    const n = 4096, hop = 4096; const acc = new Float64Array(n / 2); let frames = 0;
    stft(x, n, hop, (mag) => { for (let k = 0; k < mag.length; k++) acc[k] += mag[k] * mag[k]; frames++; });
    const e = {}; let tot = 0; for (const [nm, lo, hi] of BANDS) { let s = 0; for (let k = Math.max(1, Math.floor((lo * n) / sr)); k < Math.min(n / 2, Math.ceil((hi * n) / sr)); k++) s += acc[k]; e[nm] = s; tot += s; }
    const pct = {}; for (const k in e) pct[k] = +((100 * e[k]) / (tot || 1)).toFixed(1);
    // spectral centroid
    let num = 0, den = 0; for (let k = 1; k < n / 2; k++) { num += ((k * sr) / n) * acc[k]; den += acc[k]; }
    return { percent: pct, centroid_hz: Math.round(num / (den || 1)), spectrum: frames ? acc : null };
  }
  function stereo(ch, sr) {
    if (ch.length < 2) return { mono: true, correlation: 1, width: 0, low_width: 0 };
    const [L, R] = ch; let lr = 0, ll = 0, rr = 0, mm = 0, ss = 0; const a = Math.exp((-2 * Math.PI * 150) / sr); let lL = 0, lR = 0, lm = 0, ls = 0;
    for (let i = 0; i < L.length; i++) { const l = L[i], r = R[i]; lr += l * r; ll += l * l; rr += r * r; const m = (l + r) / 2, s = (l - r) / 2; mm += m * m; ss += s * s; lL = (1 - a) * l + a * lL; lR = (1 - a) * r + a * lR; const m2 = (lL + lR) / 2, s2 = (lL - lR) / 2; lm += m2 * m2; ls += s2 * s2; }
    return { mono: ss < 1e-9 * (mm + 1e-12), correlation: +(lr / Math.sqrt(ll * rr || 1)).toFixed(2), width: +Math.sqrt(ss / (mm || 1)).toFixed(2), low_width: +Math.sqrt(ls / (lm || 1)).toFixed(2) };
  }
  function bars(ch, sr, bpm, { beatsPerBar = 4, firstBeat = 0 } = {}) {
    if (!bpm) return []; const x = mono(ch); const L = Math.round((60 / bpm) * beatsPerBar * sr); const out = []; const s0 = Math.round(firstBeat * sr) % L;
    for (let s = s0, i = 0; s < x.length; s += L, i++) { let z = 0; const e = Math.min(x.length, s + L); for (let k = s; k < e; k++) z += x[k] * x[k]; out.push(+db(Math.sqrt(z / Math.max(1, e - s))).toFixed(1)); }
    return out;
  }
  function sections(barDb) {
    if (barDb.length < 4) return [];
    const top = Math.max(...barDb); const lvl = (v) => (v > top - 3.5 ? 'full' : v > top - 9 ? 'medium' : v > -60 ? 'quiet' : 'silent');
    const out = []; let cur = null;
    barDb.forEach((v, i) => { const l = lvl(v); if (!cur || cur.energy !== l) { if (cur && i - cur.from < 2 && out.length) { /* merge tiny blips */ } cur = { from_bar: i + 1, to_bar: i + 1, energy: l }; out.push(cur); } else cur.to_bar = i + 1; });
    // merge 1-bar islands into neighbours
    for (let i = out.length - 2; i >= 1; i--) if (out[i].to_bar === out[i].from_bar) { out[i - 1].to_bar = out[i].to_bar; out.splice(i, 1); }
    for (let i = out.length - 1; i >= 1; i--) if (out[i].energy === out[i - 1].energy) { out[i - 1].to_bar = out[i].to_bar; out.splice(i, 1); }
    return out;
  }

  // ───── everything at once, plus plain-language mix notes
  function analyze(ch, sr, { bpm = null, beatsPerBar = 4, target = -14, skipKey = false, skipTempo = false, kind = 'mix' } = {}) {
    const lim = 10 * 60 * sr; ch = ch.map((c) => (c.length > lim ? c.subarray(0, lim) : c));
    const x = mono(ch); const dur = ch[0].length / sr;
    const lv = levels(ch); const lu = loudness(ch, sr); const bal = balance(x, sr); const st = stereo(ch, sr);
    const tp = skipTempo ? null : tempo(x, sr); const k = skipKey ? null : key(x, sr);
    const useBpm = bpm || (tp && tp.bpm); const barDb = bars(ch, sr, useBpm, { beatsPerBar, firstBeat: bpm ? 0 : (tp ? tp.firstBeat : 0) });
    const r = { seconds: +dur.toFixed(2), sample_rate: sr, channels: ch.length, peak_dbfs: lv.peak, rms_dbfs: lv.rms, loudness_lufs: lu.integrated, short_term_max_lufs: lu.shortTermMax, loudness_range_lu: lu.range, peak_to_loudness: +(lv.peak - lu.integrated).toFixed(1), clipped_runs: lv.clips, dc_offset: lv.dc, tempo: tp, key: k, balance: bal.percent, centroid_hz: bal.centroid_hz, stereo: st, bar_levels_db: barDb.length <= 512 ? barDb : undefined, sections: sections(barDb) };
    r.notes = check(r, { target, kind });
    return r;
  }
  function check(r, { target = -14, kind = 'mix' } = {}) {
    const n = []; const add = (level, msg, fix) => n.push({ level, msg, fix });
    if (r.loudness_lufs <= -69) { add('major', 'It’s silent.', 'Check that tracks aren’t muted and clips are in range.'); return n; }
    if (r.clipped_runs > 0 || r.peak_dbfs > -0.1) add('major', `Peaks hit ${r.peak_dbfs} dBFS${r.clipped_runs ? ` and it clips in ${r.clipped_runs} place${r.clipped_runs > 1 ? 's' : ''}` : ''}.`, 'Put a limiter last on the master with a ceiling of −1 dB, or lower the loudest tracks.');
    else if (r.peak_dbfs > -0.9 && kind === 'mix') add('minor', `Peaks reach ${r.peak_dbfs} dBFS; streaming services prefer −1 dBTP.`, 'Set the master limiter ceiling to −1 dB.');
    if (kind === 'mix') {
      const d = r.loudness_lufs - target;
      if (d < -6) add('major', `It’s quiet: ${r.loudness_lufs} LUFS against a ${target} LUFS target.`, `Raise the master limiter’s gain by about ${Math.round(-d - 1)} dB, or export with “normalize”.`);
      else if (d < -2.5) add('minor', `A little quiet: ${r.loudness_lufs} LUFS (target ${target}).`, `About ${Math.round(-d)} dB more limiter gain gets there.`);
      else if (d > 2) add('minor', `Louder than the ${target} LUFS target (${r.loudness_lufs}); streaming services will turn it down anyway.`, 'Ease off the limiter gain for more punch.');
      if (r.peak_to_loudness < 7.5 && r.loudness_lufs > -12) add('minor', `Very squashed (peak-to-loudness ${r.peak_to_loudness} dB). Drums lose their snap.`, 'Less limiter gain or a slower compressor attack on the drums.');
    }
    const b = r.balance;
    if (b) {
      const low = b.sub + b.bass;
      if (low > 72) add('major', `Bass-heavy: ${low.toFixed(0)}% of the energy is below 250 Hz.`, 'Turn the bass/808 down 2–4 dB, or cut lows on pads and keys with an EQ low cut at 120–200 Hz.');
      else if (low < 25 && kind === 'mix' && r.seconds > 8) add('minor', `Thin low end: only ${low.toFixed(0)}% below 250 Hz.`, 'Add a bass line or sub, or raise the kick.');
      if (b.low_mids > 22) add('minor', `Muddy: the 250–500 Hz range is heavy (${b.low_mids}%).`, 'A −2 to −4 dB bell around 300–400 Hz on pads, keys or guitars clears it.');
      if (b.high_mids > 22) add('minor', `Harsh: lots of 2–6 kHz energy (${b.high_mids}%).`, 'Pull 2–4 kHz down a little on leads and hats, or lower the hats.');
      if (b.air < 0.25 && b.high_mids < 3 && kind === 'mix') add('minor', 'Dull: very little above 6 kHz.', 'A gentle high shelf (+2 dB at 10 kHz) on the master or brighter hats.');
    }
    if (r.stereo && !r.stereo.mono) {
      if (r.stereo.correlation < 0) add('major', `Phase problem: left and right cancel (correlation ${r.stereo.correlation}); it will vanish in mono.`, 'Lower the width effect, or check a track whose channels are flipped.');
      if (r.stereo.low_width > 0.35) add('minor', `Wide low end (${r.stereo.low_width}); bass below 150 Hz should stay in the middle.`, 'Add a width effect with monoBelow 120 on the master or the bass.');
      if (r.stereo.width < 0.08 && kind === 'mix') add('info', 'Almost mono.', 'Pan some parts, or add chorus/width to pads.');
    }
    if (Math.abs((r.dc_offset || 0)) > 0.01) add('minor', 'DC offset.', 'A low cut at 20–30 Hz removes it.');
    if (!n.length) add('ok', 'Nothing stands out: levels, balance and width look healthy.');
    return n;
  }

  // ───── for pictures
  function peaks(x, cols, from = 0, to = x.length) { const out = new Float32Array(cols * 2); const span = (to - from) / cols; for (let c = 0; c < cols; c++) { let lo = 1, hi = -1; const a = Math.floor(from + c * span), b = Math.max(a + 1, Math.floor(from + (c + 1) * span)); for (let i = a; i < b && i < x.length; i++) { const v = x[i]; if (v < lo) lo = v; if (v > hi) hi = v; } if (lo > hi) lo = hi = 0; out[c * 2] = lo; out[c * 2 + 1] = hi; } return out; }
  // log-frequency spectrogram, rows from 30 Hz (bottom) to 16 kHz (top), values in dB
  function spectrogram(x, sr, cols, rows, n = 2048, minHop = 256) {
    if (x.length < n) { const y = new Float32Array(n); y.set(x); x = y; } const hop = Math.max(minHop, Math.floor((x.length - n) / Math.max(1, cols))); const out = new Float32Array(cols * rows).fill(-120);
    const fLo = 30, fHi = Math.min(16000, sr / 2); const binOf = (r) => (fLo * Math.pow(fHi / fLo, r / rows) * n) / sr;
    let c = 0; stft(x, n, hop, (mag) => { if (c >= cols) return; for (let r = 0; r < rows; r++) { const k0 = Math.floor(binOf(r)), k1 = Math.max(k0 + 1, Math.floor(binOf(r + 1))); let m = 0; for (let k = k0; k < k1 && k < mag.length; k++) m = Math.max(m, mag[k]); out[(rows - 1 - r) * cols + c] = db(m / (n / 4)); } c++; });
    return { data: out, cols: c, rows };
  }

  return { fft, stft, mono, decimate, loudness, levels, tempo, key, chroma, balance, stereo, bars, sections, analyze, check, peaks, spectrogram, db };
});
