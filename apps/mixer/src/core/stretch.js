// Mixer — time-stretching that keeps the pitch (WSOLA: overlapping windows, each placed where it lines up best with
// the last). Used for an audio clip's "stretch" and "pitch" (pitch = stretch, then play back faster or slower).
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.MXStretch = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // channels: Float32Array[]; factor > 1 = longer/slower. Returns new Float32Array[] of length ≈ n·factor.
  function wsola(channels, sr, factor, { win = 0.05, tol = 0.012 } = {}) {
    if (Math.abs(factor - 1) < 1e-4) return channels.map((c) => c.slice());
    const N = Math.max(256, Math.round(win * sr) & ~1), Hs = N / 2, Ha = Hs / factor, T = Math.round(tol * sr);
    const n = channels[0].length, outLen = Math.ceil(n * factor) + N; const out = channels.map(() => new Float32Array(outLen)); const norm = new Float32Array(outLen);
    const w = new Float32Array(N); for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    const mono = channels.length === 1 ? channels[0] : (() => { const m = new Float32Array(n); for (const c of channels) for (let i = 0; i < n; i++) m[i] += c[i] / channels.length; return m; })();
    let prevIn = 0; const step = Math.max(1, Math.round(T / 48));
    for (let k = 0, outPos = 0; ; k++, outPos += Hs) {
      const nominal = Math.round(k * Ha); if (nominal >= n) break;
      let best = nominal;
      if (k > 0) { // the natural continuation of the previous frame is prevIn + Hs; find the shift near nominal most like it
        const nat = prevIn + Hs; let bs = -Infinity; const L = Math.min(Hs, 512);
        for (let d = -T; d <= T; d += step) { const p = nominal + d; if (p < 0 || p + L >= n || nat + L >= n) continue; let s = 0; for (let i = 0; i < L; i += 2) s += mono[p + i] * mono[nat + i]; if (s > bs) { bs = s; best = p; } }
      }
      for (let c = 0; c < channels.length; c++) { const src = channels[c], dst = out[c]; for (let i = 0; i < N; i++) { const si = best + i; if (si >= n) break; dst[outPos + i] += src[si] * w[i]; } }
      for (let i = 0; i < N; i++) norm[outPos + i] += w[i];
      prevIn = best;
    }
    const L = Math.round(n * factor);
    return out.map((c) => { const o = new Float32Array(L); for (let i = 0; i < L; i++) o[i] = norm[i] > 0.1 ? c[i] / norm[i] : c[i]; return o; });
  }
  return { wsola };
});
