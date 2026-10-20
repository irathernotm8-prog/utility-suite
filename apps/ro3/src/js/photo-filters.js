// Pixel filters for the photo editor (Blur, Sharpen, Noise, Distort, Stylize, Render galleries).
// Pure functions over RGBA ImageData-like objects ({ width, height, data }), so they run unchanged in
// the filter Web Worker.
const PhotoFilters = (() => {
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const img = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
  const copy = s => ({ width: s.width, height: s.height, data: new Uint8ClampedArray(s.data) });

  // ---------- sampling helpers ----------
  /** Bilinear sample with edge clamp; writes 4 channels into out[o..o+3]. Premultiplied to avoid dark fringes. */
  function sampleInto(s, x, y, out, o, wrap = false) {
    const W = s.width, H = s.height, d = s.data;
    if (wrap) { x = ((x % W) + W) % W; y = ((y % H) + H) % H; }
    x = clamp(x, 0, W - 1.001); y = clamp(y, 0, H - 1.001);
    const x0 = x | 0, y0 = y | 0, tx = x - x0, ty = y - y0;
    const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
    const w00 = (1 - tx) * (1 - ty) * d[i00 + 3], w10 = tx * (1 - ty) * d[i10 + 3], w01 = (1 - tx) * ty * d[i01 + 3], w11 = tx * ty * d[i11 + 3];
    const a = w00 + w10 + w01 + w11;
    if (a <= 0) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; return; }
    for (let c = 0; c < 3; c++) out[o + c] = (d[i00 + c] * w00 + d[i10 + c] * w10 + d[i01 + c] * w01 + d[i11 + c] * w11) / a;
    out[o + 3] = a / 255;
  }
  /** Inverse-mapped warp: map(x, y) → source [sx, sy]. */
  function warp(s, map, wrap) {
    const W = s.width, H = s.height, o = img(W, H), d = o.data, p = [0, 0];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      map(x + 0.5, y + 0.5, p);
      sampleInto(s, p[0] - 0.5, p[1] - 0.5, d, (y * W + x) * 4, wrap);
    }
    return o;
  }

  // ---------- blur primitives ----------
  /** Separable box blur (premultiplied), radius r, `passes` times ≈ gaussian. */
  function boxBlur(s, rx, ry = rx, passes = 3) {
    const W = s.width, H = s.height;
    let A = new Float32Array(W * H * 4);
    const sd = s.data;
    for (let i = 0; i < W * H; i++) { const a = sd[i * 4 + 3] / 255; A[i * 4] = sd[i * 4] * a; A[i * 4 + 1] = sd[i * 4 + 1] * a; A[i * 4 + 2] = sd[i * 4 + 2] * a; A[i * 4 + 3] = sd[i * 4 + 3]; }
    let B = new Float32Array(W * H * 4);
    const pass1 = (src, dst, r, horiz) => {
      if (r < 1) { dst.set(src); return; }
      const len = horiz ? W : H, lines = horiz ? H : W, step = horiz ? 4 : W * 4, n = 2 * r + 1;
      for (let L = 0; L < lines; L++) {
        const base = horiz ? L * W * 4 : L * 4;
        for (let c = 0; c < 4; c++) {
          let acc = 0;
          for (let k = -r; k <= r; k++) acc += src[base + clamp(k, 0, len - 1) * step + c];
          for (let i = 0; i < len; i++) {
            dst[base + i * step + c] = acc / n;
            acc += src[base + Math.min(len - 1, i + r + 1) * step + c] - src[base + Math.max(0, i - r) * step + c];
          }
        }
      }
    };
    for (let p = 0; p < passes; p++) { pass1(A, B, rx, true); pass1(B, A, ry, false); }
    const o = img(W, H), d = o.data;
    for (let i = 0; i < W * H; i++) {
      const a = A[i * 4 + 3]; d[i * 4 + 3] = a;
      if (a > 0) { const k = 255 / a; d[i * 4] = A[i * 4] * k; d[i * 4 + 1] = A[i * 4 + 1] * k; d[i * 4 + 2] = A[i * 4 + 2] * k; }
    }
    return o;
  }
  /** Gaussian approximated by three box passes (sigma → box radius). */
  const gaussian = (s, sigma) => sigma < 0.3 ? copy(s) : boxBlur(s, Math.max(1, Math.round(Math.sqrt(12 * sigma * sigma / 3 + 1) / 2 - 0.5)), undefined, 3);

  /** Average along a line through each pixel (motion / radial / spin share this). */
  function lineBlur(s, vec, samples) {
    const W = s.width, H = s.height, o = img(W, H), d = o.data, tmp = new Float32Array(4), v = [0, 0];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      vec(x, y, v);
      const n = Math.max(1, Math.min(samples, Math.ceil(Math.hypot(v[0], v[1]))));
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k <= n; k++) {
        const t = n ? k / n - 0.5 : 0;
        sampleInto(s, x + v[0] * t, y + v[1] * t, tmp, 0);
        const aa = tmp[3]; r += tmp[0] * aa; g += tmp[1] * aa; b += tmp[2] * aa; a += aa;
      }
      const i = (y * W + x) * 4;
      if (a > 0) { d[i] = r / a; d[i + 1] = g / a; d[i + 2] = b / a; }
      d[i + 3] = a / (n + 1) * 255;
    }
    return o;
  }

  // ---------- helpers for colour work ----------
  const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
  function gaussRand(r) { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  /** Value noise for clouds (fractal, tileable-ish). */
  function makeNoise(seed) {
    const r = rng(seed), P = new Uint8Array(512), G = new Float32Array(256);
    for (let i = 0; i < 256; i++) { P[i] = i; G[i] = r(); }
    for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; [P[i], P[j]] = [P[j], P[i]]; }
    for (let i = 0; i < 256; i++) P[i + 256] = P[i];
    const f = t => t * t * (3 - 2 * t);
    return (x, y) => {
      const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255, xf = x - Math.floor(x), yf = y - Math.floor(y);
      const v = (a, b) => G[P[P[a] + b]];
      const u = f(xf), w = f(yf);
      return (v(xi, yi) * (1 - u) + v(xi + 1, yi) * u) * (1 - w) + (v(xi, yi + 1) * (1 - u) + v(xi + 1, yi + 1) * u) * w;
    };
  }

  // ---------- the filters ----------
  const F = {};
  const def = (id, group, name, params, run, extra = {}) => { F[id] = { id, group, name, params, run, ...extra }; };
  const P = (key, label, min, max, value, o = {}) => ({ key, label, min, max, value, step: 1, ...o });

  // Blur
  def('gaussian', 'Blur', 'Gaussian Blur…', [P('radius', 'Radius', 0.5, 250, 6, { step: 0.5, unit: 'px' })], (s, p) => gaussian(s, p.radius / 2));
  def('box', 'Blur', 'Box Blur…', [P('radius', 'Radius', 1, 200, 8, { unit: 'px' })], (s, p) => boxBlur(s, Math.round(p.radius), Math.round(p.radius), 1));
  def('motion', 'Blur', 'Motion Blur…', [P('angle', 'Angle', -180, 180, 0, { unit: '°' }), P('distance', 'Distance', 1, 500, 30, { unit: 'px' })], (s, p) => {
    const a = p.angle * Math.PI / 180, dx = Math.cos(a) * p.distance, dy = -Math.sin(a) * p.distance;
    return lineBlur(s, (x, y, v) => { v[0] = dx; v[1] = dy; }, 64);
  });
  def('radial', 'Blur', 'Radial Blur…', [P('amount', 'Amount', 1, 100, 20), P('mode', 'Method', 0, 1, 1, { options: [[0, 'Spin'], [1, 'Zoom']] }), P('cx', 'Center X', 0, 100, 50, { unit: '%' }), P('cy', 'Center Y', 0, 100, 50, { unit: '%' })], (s, p) => {
    const cx = s.width * p.cx / 100, cy = s.height * p.cy / 100, k = p.amount / 100;
    if (Number(p.mode) === 1) return lineBlur(s, (x, y, v) => { v[0] = (x - cx) * k * 0.6; v[1] = (y - cy) * k * 0.6; }, 48);
    return lineBlur(s, (x, y, v) => { const ang = k * 0.6; v[0] = -(y - cy) * ang; v[1] = (x - cx) * ang; }, 48);
  });
  def('tiltshift', 'Blur', 'Tilt-Shift…', [P('blur', 'Blur', 1, 60, 14, { unit: 'px' }), P('center', 'Focus line', 0, 100, 50, { unit: '%' }), P('band', 'Sharp band', 2, 80, 20, { unit: '%' }), P('feather', 'Transition', 2, 80, 25, { unit: '%' }), P('angle', 'Angle', -90, 90, 0, { unit: '°' })], (s, p) => {
    const b = gaussian(s, p.blur / 2), W = s.width, H = s.height, o = copy(s), d = o.data, bd = b.data;
    const a = p.angle * Math.PI / 180, nx = -Math.sin(a), ny = Math.cos(a), cx = W / 2, cy = H * p.center / 100, half = H * p.band / 200, fe = Math.max(1, H * p.feather / 100);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dist = Math.abs((x - cx) * nx + (y - cy) * ny), t = clamp((dist - half) / fe, 0, 1), i = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) d[i + c] = d[i + c] + (bd[i + c] - d[i + c]) * t;
    }
    return o;
  });
  def('iris', 'Blur', 'Iris Blur…', [P('blur', 'Blur', 1, 60, 14, { unit: 'px' }), P('cx', 'Center X', 0, 100, 50, { unit: '%' }), P('cy', 'Center Y', 0, 100, 50, { unit: '%' }), P('size', 'Sharp area', 2, 100, 30, { unit: '%' }), P('feather', 'Transition', 2, 100, 30, { unit: '%' })], (s, p) => {
    const b = gaussian(s, p.blur / 2), W = s.width, H = s.height, o = copy(s), d = o.data, bd = b.data;
    const cx = W * p.cx / 100, cy = H * p.cy / 100, R = Math.min(W, H) * p.size / 200, fe = Math.max(1, Math.min(W, H) * p.feather / 100);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = clamp((Math.hypot(x - cx, (y - cy) * W / H * (H / W)) - R) / fe, 0, 1), i = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) d[i + c] = d[i + c] + (bd[i + c] - d[i + c]) * t;
    }
    return o;
  });
  def('surface', 'Blur', 'Surface Blur…', [P('radius', 'Radius', 1, 20, 5, { unit: 'px' }), P('threshold', 'Threshold', 2, 255, 25, { unit: 'levels' })], (s, p) => {
    // edge-preserving: average neighbours whose colour is within the threshold (weighted by closeness)
    const W = s.width, H = s.height, r = Math.round(p.radius), T = p.threshold * 2.5, o = copy(s), d = o.data, sd = s.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4; let R = 0, G = 0, B = 0, S = 0;
      for (let j = -r; j <= r; j += r > 6 ? 2 : 1) { const yy = clamp(y + j, 0, H - 1); for (let k = -r; k <= r; k += r > 6 ? 2 : 1) {
        const q = (yy * W + clamp(x + k, 0, W - 1)) * 4, diff = Math.abs(sd[q] - sd[i]) + Math.abs(sd[q + 1] - sd[i + 1]) + Math.abs(sd[q + 2] - sd[i + 2]);
        const w = Math.max(0, 1 - diff / T); R += sd[q] * w; G += sd[q + 1] * w; B += sd[q + 2] * w; S += w;
      } }
      d[i] = R / S; d[i + 1] = G / S; d[i + 2] = B / S;
    }
    return o;
  });

  // Sharpen
  def('unsharp', 'Sharpen', 'Unsharp Mask…', [P('amount', 'Amount', 1, 500, 100, { unit: '%' }), P('radius', 'Radius', 0.2, 50, 1.5, { step: 0.1, unit: 'px' }), P('threshold', 'Threshold', 0, 255, 0, { unit: 'levels' })], (s, p) => {
    const b = gaussian(s, p.radius), o = copy(s), d = o.data, bd = b.data, k = p.amount / 100, T = p.threshold;
    for (let i = 0; i < d.length; i += 4) {
      const diff = lum(d, i) - lum(bd, i); if (Math.abs(diff) * 2 < T) continue;
      for (let c = 0; c < 3; c++) d[i + c] = d[i + c] + (d[i + c] - bd[i + c]) * k;
    }
    return o;
  });
  def('smartsharpen', 'Sharpen', 'Smart Sharpen…', [P('amount', 'Amount', 1, 500, 150, { unit: '%' }), P('radius', 'Radius', 0.2, 20, 1, { step: 0.1, unit: 'px' }), P('noise', 'Reduce noise', 0, 100, 10, { unit: '%' })], (s, p) => {
    // sharpen luminance only, with a small denoise first so grain isn't amplified, and halo clamping
    const pre = p.noise > 0 ? gaussian(s, p.noise / 100 * 0.9) : s, b = gaussian(pre, p.radius), o = copy(s), d = o.data, bd = b.data, pd = pre.data, k = p.amount / 100;
    for (let i = 0; i < d.length; i += 4) {
      const dl = clamp((lum(pd, i) - lum(bd, i)) * k, -60, 60);
      d[i] += dl; d[i + 1] += dl; d[i + 2] += dl;
    }
    return o;
  });
  def('highpass', 'Other', 'High Pass…', [P('radius', 'Radius', 0.5, 100, 10, { step: 0.5, unit: 'px' })], (s, p) => {
    const b = gaussian(s, p.radius / 2), o = copy(s), d = o.data, bd = b.data;
    for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = 128 + d[i + c] - bd[i + c];
    return o;
  });

  // Noise
  def('addnoise', 'Noise', 'Add Noise…', [P('amount', 'Amount', 0.1, 100, 8, { step: 0.1, unit: '%' }), P('dist', 'Distribution', 0, 1, 1, { options: [[0, 'Uniform'], [1, 'Gaussian']] }), P('mono', 'Monochromatic', 0, 1, 1, { options: [[0, 'Off'], [1, 'On']] }), P('seed', 'Seed', 1, 999, 7)], (s, p) => {
    const o = copy(s), d = o.data, r = rng(p.seed * 7919), A = p.amount / 100 * 255, gauss = Number(p.dist) === 1, mono = Number(p.mono) === 1;
    const n = () => gauss ? gaussRand(r) * A * 0.5 : (r() - 0.5) * A;
    for (let i = 0; i < d.length; i += 4) { if (mono) { const v = n(); d[i] += v; d[i + 1] += v; d[i + 2] += v; } else { d[i] += n(); d[i + 1] += n(); d[i + 2] += n(); } }
    return o;
  });
  def('median', 'Noise', 'Median…', [P('radius', 'Radius', 1, 20, 2, { unit: 'px' })], (s, p) => {
    const W = s.width, H = s.height, r = Math.round(p.radius), o = copy(s), d = o.data, sd = s.data, hist = new Int32Array(256 * 3);
    const half = Math.floor((2 * r + 1) ** 2 / 2);
    for (let y = 0; y < H; y++) {
      hist.fill(0);
      for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) { const q = (clamp(y + j, 0, H - 1) * W + clamp(k, 0, W - 1)) * 4; hist[sd[q]]++; hist[256 + sd[q + 1]]++; hist[512 + sd[q + 2]]++; }
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) { let acc = 0, v = 0; for (; v < 256; v++) { acc += hist[c * 256 + v]; if (acc > half) break; } d[i + c] = v; }
        for (let j = -r; j <= r; j++) {
          const row = clamp(y + j, 0, H - 1) * W, out = (row + clamp(x - r, 0, W - 1)) * 4, inn = (row + clamp(x + r + 1, 0, W - 1)) * 4;
          for (let c = 0; c < 3; c++) { hist[c * 256 + sd[out + c]]--; hist[c * 256 + sd[inn + c]]++; }
        }
      }
    }
    return o;
  });
  def('denoise', 'Noise', 'Reduce Noise…', [P('strength', 'Strength', 1, 10, 6), P('detail', 'Preserve details', 0, 100, 60, { unit: '%' }), P('color', 'Reduce color noise', 0, 100, 45, { unit: '%' })], (s, p) => {
    // luminance: bilateral-style surface blur; chroma: plain blur of the colour difference
    const W = s.width, H = s.height, sd = s.data, o = copy(s), d = o.data;
    const r = Math.max(1, Math.round(p.strength / 2)), T = (110 - p.detail) * 0.9 + 6;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, L0 = lum(sd, i); let S = 0, Ls = 0;
      for (let j = -r; j <= r; j++) { const yy = clamp(y + j, 0, H - 1); for (let k = -r; k <= r; k++) {
        const q = (yy * W + clamp(x + k, 0, W - 1)) * 4, L = lum(sd, q), w = Math.exp(-((L - L0) ** 2) / (2 * T * T)) * Math.exp(-(j * j + k * k) / (2 * r * r));
        Ls += L * w; S += w;
      } }
      const dl = Ls / S - L0; d[i] += dl; d[i + 1] += dl; d[i + 2] += dl;
    }
    if (p.color > 0) {
      const b = gaussian(o, 1 + p.color / 100 * 4), bd = b.data, k = p.color / 100;
      for (let i = 0; i < d.length; i += 4) {
        const L = lum(d, i), Lb = lum(bd, i);
        for (let c = 0; c < 3; c++) { const ch = d[i + c] - L, chb = bd[i + c] - Lb; d[i + c] = L + ch + (chb - ch) * k; }
      }
    }
    return o;
  });
  def('dust', 'Noise', 'Dust & Scratches…', [P('radius', 'Radius', 1, 16, 2, { unit: 'px' }), P('threshold', 'Threshold', 0, 128, 12, { unit: 'levels' })], (s, p) => {
    const m = F.median.run(s, { radius: p.radius }), o = copy(s), d = o.data, md = m.data;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(lum(d, i) - lum(md, i)) > p.threshold) { d[i] = md[i]; d[i + 1] = md[i + 1]; d[i + 2] = md[i + 2]; }
    return o;
  });

  // Distort
  def('twirl', 'Distort', 'Twirl…', [P('angle', 'Angle', -999, 999, 90, { unit: '°' })], (s, p) => {
    const cx = s.width / 2, cy = s.height / 2, R = Math.min(cx, cy), A = p.angle * Math.PI / 180;
    return warp(s, (x, y, o) => {
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
      if (r >= R) { o[0] = x; o[1] = y; return; }
      const t = 1 - r / R, a = A * t * t, c = Math.cos(a), sn = Math.sin(a);
      o[0] = cx + dx * c - dy * sn; o[1] = cy + dx * sn + dy * c;
    });
  });
  def('wave', 'Distort', 'Wave…', [P('amp', 'Amplitude', 1, 200, 12, { unit: 'px' }), P('wavelength', 'Wavelength', 4, 800, 120, { unit: 'px' }), P('type', 'Type', 0, 2, 0, { options: [[0, 'Sine'], [1, 'Triangle'], [2, 'Square']] }), P('dir', 'Direction', 0, 2, 2, { options: [[0, 'Horizontal'], [1, 'Vertical'], [2, 'Both']] })], (s, p) => {
    const L = p.wavelength, A = p.amp, type = Number(p.type), dir = Number(p.dir);
    const wf = t => type === 1 ? (2 / Math.PI) * Math.asin(Math.sin(t)) : type === 2 ? Math.sign(Math.sin(t)) : Math.sin(t);
    return warp(s, (x, y, o) => {
      o[0] = x + (dir !== 1 ? A * wf(2 * Math.PI * y / L) : 0);
      o[1] = y + (dir !== 0 ? A * wf(2 * Math.PI * x / L) : 0);
    });
  });
  def('ripple', 'Distort', 'Ripple…', [P('amount', 'Amount', -999, 999, 100), P('size', 'Size', 0, 2, 1, { options: [[0, 'Small'], [1, 'Medium'], [2, 'Large']] })], (s, p) => {
    const L = [10, 24, 60][Number(p.size)], A = p.amount / 100 * L * 0.3;
    return warp(s, (x, y, o) => { o[0] = x + A * Math.sin(2 * Math.PI * y / L); o[1] = y + A * Math.sin(2 * Math.PI * x / L); });
  });
  def('zigzag', 'Distort', 'Zigzag…', [P('amount', 'Amount', -100, 100, 20), P('ridges', 'Ridges', 1, 20, 5)], (s, p) => {
    const cx = s.width / 2, cy = s.height / 2, R = Math.min(cx, cy), A = p.amount / 100 * R * 0.1;
    return warp(s, (x, y, o) => {
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
      if (r >= R || r === 0) { o[0] = x; o[1] = y; return; }
      const off = A * Math.sin(2 * Math.PI * r / R * p.ridges) * (1 - r / R), k = (r + off) / r;
      o[0] = cx + dx * k; o[1] = cy + dy * k;
    });
  });
  def('spherize', 'Distort', 'Spherize / Pinch…', [P('amount', 'Amount', -100, 100, 60, { unit: '%' })], (s, p) => {
    // positive bulges out (spherize), negative pinches in
    const cx = s.width / 2, cy = s.height / 2, Rx = cx, Ry = cy, A = p.amount / 100;
    return warp(s, (x, y, o) => {
      const nx = (x - cx) / Rx, ny = (y - cy) / Ry, r = Math.hypot(nx, ny);
      if (r >= 1 || r === 0) { o[0] = x; o[1] = y; return; }
      // source radius moves toward asin(r)·2/π (bulge) or sin(r·π/2) (pinch)
      const target = A >= 0 ? Math.asin(r) * 2 / Math.PI : Math.sin(r * Math.PI / 2), k = (r + Math.abs(A) * (target - r)) / r;
      o[0] = cx + nx * k * Rx; o[1] = cy + ny * k * Ry;
    });
  });
  def('polar', 'Distort', 'Polar Coordinates…', [P('mode', 'Conversion', 0, 1, 0, { options: [[0, 'Rectangular to polar'], [1, 'Polar to rectangular']] })], (s, p) => {
    const W = s.width, H = s.height, cx = W / 2, cy = H / 2, R = Math.min(cx, cy);
    if (Number(p.mode) === 0) return warp(s, (x, y, o) => {
      const dx = x - cx, dy = y - cy, a = (Math.atan2(dx, -dy) + Math.PI) / (2 * Math.PI), r = Math.hypot(dx / cx, dy / cy);
      o[0] = a * W; o[1] = r * H;
    }, true);
    return warp(s, (x, y, o) => {
      const a = x / W * 2 * Math.PI - Math.PI, r = y / H;
      o[0] = cx + Math.sin(a) * r * cx; o[1] = cy - Math.cos(a) * r * cy;
    });
  });
  def('shear', 'Distort', 'Shear…', [P('amount', 'Amount', -100, 100, 30, { unit: '%' }), P('wrap', 'Edges', 0, 1, 1, { options: [[0, 'Repeat edge pixels'], [1, 'Wrap around']] })], (s, p) => {
    const W = s.width, H = s.height, A = p.amount / 100 * W * 0.25;
    return warp(s, (x, y, o) => { const t = y / H; o[0] = x - A * Math.sin(Math.PI * t) ; o[1] = y; }, Number(p.wrap) === 1);
  });
  def('lens', 'Distort', 'Lens Correction…', [P('distortion', 'Remove distortion', -100, 100, 0), P('vignette', 'Vignette', -100, 100, 0), P('chroma', 'Fix fringing', -20, 20, 0, { step: 0.5 })], (s, p) => {
    const W = s.width, H = s.height, cx = W / 2, cy = H / 2, R = Math.hypot(cx, cy), k = -p.distortion / 100 * 0.35, ca = p.chroma / 1000;
    const o = img(W, H), d = o.data, t = new Float32Array(4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - cx) / R, dy = (y + 0.5 - cy) / R, r2 = dx * dx + dy * dy, f = 1 + k * r2, i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) { const g = f * (1 + (c - 1) * ca); sampleInto(s, cx + dx * g * R - 0.5, cy + dy * g * R - 0.5, t, 0); d[i + c] = t[c]; if (c === 1) d[i + 3] = t[3] * 255; }
      if (p.vignette) { const v = 1 + p.vignette / 100 * r2 * 1.4; for (let c = 0; c < 3; c++) d[i + c] *= v; }
    }
    return o;
  });

  // Stylize
  def('oilpaint', 'Stylize', 'Oil Paint…', [P('radius', 'Brush size', 1, 10, 4, { unit: 'px' }), P('levels', 'Stylization', 5, 40, 20)], (s, p) => {
    // Kuwahara-like intensity binning: each pixel takes the average colour of the most common intensity bin nearby
    const W = s.width, H = s.height, r = Math.round(p.radius), L = Math.round(p.levels), sd = s.data, o = copy(s), d = o.data;
    const cnt = new Int32Array(L), sr = new Float32Array(L), sg = new Float32Array(L), sb = new Float32Array(L);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      cnt.fill(0); sr.fill(0); sg.fill(0); sb.fill(0);
      for (let j = -r; j <= r; j++) { const yy = clamp(y + j, 0, H - 1); for (let k = -r; k <= r; k++) {
        const q = (yy * W + clamp(x + k, 0, W - 1)) * 4, b = Math.min(L - 1, (lum(sd, q) / 256 * L) | 0);
        cnt[b]++; sr[b] += sd[q]; sg[b] += sd[q + 1]; sb[b] += sd[q + 2];
      } }
      let best = 0; for (let b = 1; b < L; b++) if (cnt[b] > cnt[best]) best = b;
      const i = (y * W + x) * 4; d[i] = sr[best] / cnt[best]; d[i + 1] = sg[best] / cnt[best]; d[i + 2] = sb[best] / cnt[best];
    }
    return o;
  });
  def('emboss', 'Stylize', 'Emboss…', [P('angle', 'Angle', -180, 180, 135, { unit: '°' }), P('height', 'Height', 1, 10, 3, { unit: 'px' }), P('amount', 'Amount', 1, 500, 100, { unit: '%' })], (s, p) => {
    const W = s.width, H = s.height, a = p.angle * Math.PI / 180, dx = Math.cos(a) * p.height, dy = -Math.sin(a) * p.height, k = p.amount / 100, o = copy(s), d = o.data, t1 = new Float32Array(4), t2 = new Float32Array(4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      sampleInto(s, x + dx / 2, y + dy / 2, t1, 0); sampleInto(s, x - dx / 2, y - dy / 2, t2, 0);
      const v = clamp(128 + ((0.299 * t1[0] + 0.587 * t1[1] + 0.114 * t1[2]) - (0.299 * t2[0] + 0.587 * t2[1] + 0.114 * t2[2])) * k, 0, 255), i = (y * W + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    return o;
  });
  def('findedges', 'Stylize', 'Find Edges', [], s => {
    const W = s.width, H = s.height, sd = s.data, o = copy(s), d = o.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const at = (xx, yy) => sd[(clamp(yy, 0, H - 1) * W + clamp(xx, 0, W - 1)) * 4 + c];
        const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
        const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
        d[i + c] = 255 - clamp(Math.hypot(gx, gy) / 2, 0, 255);
      }
    }
    return o;
  });
  def('glowingedges', 'Stylize', 'Glowing Edges…', [P('width', 'Edge width', 1, 10, 2), P('brightness', 'Brightness', 1, 20, 8)], (s, p) => {
    const e = F.findedges.run(gaussian(s, p.width / 3)), d = e.data;
    for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = clamp((255 - d[i + c]) * p.brightness / 4, 0, 255);
    return e;
  });
  def('wind', 'Stylize', 'Wind…', [P('strength', 'Strength', 1, 3, 1, { options: [[1, 'Wind'], [2, 'Blast'], [3, 'Stagger']] }), P('dir', 'Direction', 0, 1, 1, { options: [[0, 'From the left'], [1, 'From the right']] })], (s, p) => {
    const W = s.width, H = s.height, sd = s.data, o = copy(s), d = o.data, r = rng(91), len = [0, 18, 40, 30][Number(p.strength)], fromRight = Number(p.dir) === 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, nx = clamp(x + (fromRight ? 1 : -1), 0, W - 1), q = (y * W + nx) * 4;
      if (Math.abs(lum(sd, i) - lum(sd, q)) > 30 && r() > (Number(p.strength) === 3 ? 0.5 : 0.2)) {
        const L = (len * (0.4 + r() * 0.6)) | 0;
        for (let k = 1; k <= L; k++) {
          const xx = fromRight ? x - k : x + k; if (xx < 0 || xx >= W) break;
          const j = (y * W + xx) * 4, t = 1 - k / (L + 1);
          for (let c = 0; c < 3; c++) d[j + c] = Math.max(d[j + c], sd[i + c] * t + d[j + c] * (1 - t));
        }
      }
    }
    return o;
  });
  def('solarize', 'Stylize', 'Solarize', [], s => { const o = copy(s), d = o.data; for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) if (d[i + c] > 127) d[i + c] = 255 - d[i + c]; return o; });
  def('mosaic', 'Pixelate', 'Mosaic…', [P('size', 'Cell size', 2, 200, 16, { unit: 'px' })], (s, p) => {
    const W = s.width, H = s.height, n = Math.round(p.size), sd = s.data, o = copy(s), d = o.data;
    for (let by = 0; by < H; by += n) for (let bx = 0; bx < W; bx += n) {
      let r = 0, g = 0, b = 0, a = 0, c = 0;
      for (let y = by; y < Math.min(H, by + n); y++) for (let x = bx; x < Math.min(W, bx + n); x++) { const i = (y * W + x) * 4, aa = sd[i + 3]; r += sd[i] * aa; g += sd[i + 1] * aa; b += sd[i + 2] * aa; a += aa; c++; }
      for (let y = by; y < Math.min(H, by + n); y++) for (let x = bx; x < Math.min(W, bx + n); x++) {
        const i = (y * W + x) * 4; if (a) { d[i] = r / a; d[i + 1] = g / a; d[i + 2] = b / a; } d[i + 3] = a / c;
        if ((x === bx || y === by) && n > 5) { d[i] *= 0.82; d[i + 1] *= 0.82; d[i + 2] *= 0.82; }
      }
    }
    return o;
  });
  def('crystallize', 'Pixelate', 'Crystallize…', [P('size', 'Cell size', 3, 200, 20, { unit: 'px' }), P('seed', 'Seed', 1, 999, 3)], (s, p) => {
    // Voronoi cells around jittered grid points, each filled with the colour at its seed
    const W = s.width, H = s.height, n = Math.round(p.size), gw = Math.ceil(W / n) + 1, gh = Math.ceil(H / n) + 1, r = rng(p.seed * 31), pts = new Float32Array(gw * gh * 2);
    for (let i = 0; i < gw * gh; i++) { pts[i * 2] = ((i % gw) + r()) * n; pts[i * 2 + 1] = (Math.floor(i / gw) + r()) * n; }
    const sd = s.data, o = copy(s), d = o.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const gx = Math.floor(x / n), gy = Math.floor(y / n); let best = -1, bd = 1e18;
      for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) { const X = gx + k, Y = gy + j; if (X < 0 || Y < 0 || X >= gw || Y >= gh) continue; const q = Y * gw + X, dd = (pts[q * 2] - x) ** 2 + (pts[q * 2 + 1] - y) ** 2; if (dd < bd) { bd = dd; best = q; } }
      const sx = clamp(pts[best * 2] | 0, 0, W - 1), sy = clamp(pts[best * 2 + 1] | 0, 0, H - 1), q = (sy * W + sx) * 4, i = (y * W + x) * 4;
      d[i] = sd[q]; d[i + 1] = sd[q + 1]; d[i + 2] = sd[q + 2];
    }
    return o;
  });
  def('halftone', 'Pixelate', 'Color Halftone…', [P('radius', 'Max radius', 2, 40, 6, { unit: 'px' })], (s, p) => {
    const W = s.width, H = s.height, n = Math.round(p.radius) * 2, sd = s.data, o = img(W, H), d = o.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = sd[i + 3]; }
    const angles = [108, 162, 90, 45]; // C M Y K screen angles
    for (let ch = 0; ch < 4; ch++) {
      const a = angles[ch] * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const u = x * ca + y * sa, v = -x * sa + y * ca, cu = (Math.floor(u / n) + 0.5) * n, cv = (Math.floor(v / n) + 0.5) * n;
        const sx = clamp(Math.round(cu * ca - cv * sa), 0, W - 1), sy = clamp(Math.round(cu * sa + cv * ca), 0, H - 1), q = (sy * W + sx) * 4;
        const R = sd[q] / 255, G = sd[q + 1] / 255, B = sd[q + 2] / 255, K = 1 - Math.max(R, G, B), ink = ch === 3 ? K : K >= 1 ? 0 : (1 - [R, G, B][ch] - K) / (1 - K);
        if (Math.hypot(u - cu, v - cv) < Math.sqrt(ink) * n * 0.7) { const i = (y * W + x) * 4; if (ch === 3) { d[i] *= 0.15; d[i + 1] *= 0.15; d[i + 2] *= 0.15; } else d[i + ch] *= 0.1; }
      }
    }
    return o;
  });

  // Render
  def('clouds', 'Render', 'Clouds', [P('scale', 'Scale', 10, 400, 100, { unit: '%' }), P('seed', 'Seed', 1, 999, 1), P('mix', 'Opacity', 0, 100, 100, { unit: '%' })], (s, p, ctx = {}) => {
    const W = s.width, H = s.height, n = makeNoise(p.seed * 131), o = copy(s), d = o.data, k = Math.max(W, H) / (4 * p.scale / 100), m = p.mix / 100;
    const fg = ctx.fg || [0, 0, 0], bg = ctx.bg || [255, 255, 255];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = 0, amp = 0.5, f = 1 / k;
      for (let oct = 0; oct < 6; oct++) { v += n(x * f, y * f) * amp; amp /= 2; f *= 2; }
      v = clamp((v - 0.15) / 0.7, 0, 1);
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) d[i + c] = d[i + c] * (1 - m) + (fg[c] * (1 - v) + bg[c] * v) * m;
      d[i + 3] = Math.max(d[i + 3], 255 * m);
    }
    return o;
  }, { usesColors: true });
  def('flare', 'Render', 'Lens Flare…', [P('cx', 'Center X', 0, 100, 30, { unit: '%' }), P('cy', 'Center Y', 0, 100, 30, { unit: '%' }), P('brightness', 'Brightness', 10, 300, 100, { unit: '%' })], (s, p) => {
    const W = s.width, H = s.height, o = copy(s), d = o.data, fx = W * p.cx / 100, fy = H * p.cy / 100, B = p.brightness / 100, R = Math.hypot(W, H);
    const ccx = W / 2, ccy = H / 2;
    // ghosts placed along the line from the flare through the centre
    const ghosts = [[0.35, 0.03, [255, 210, 150], 0.25], [0.6, 0.05, [140, 200, 255], 0.18], [1.2, 0.08, [255, 140, 90], 0.15], [1.45, 0.02, [200, 255, 200], 0.3], [1.8, 0.12, [150, 170, 255], 0.1]];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, dd = Math.hypot(x - fx, y - fy) / R;
      let r = 0, g = 0, b = 0;
      const core = Math.exp(-dd * dd * 900) * 255 + Math.exp(-dd * 28) * 140, ang = Math.atan2(y - fy, x - fx);
      const rays = Math.pow(Math.abs(Math.cos(ang * 6)), 40) * Math.exp(-dd * 10) * 90;
      r += core + rays; g += core * 0.92 + rays * 0.9; b += core * 0.8 + rays * 0.8;
      const ring = Math.exp(-((dd - 0.09) ** 2) * 20000) * 40; r += ring * 0.6; g += ring * 0.8; b += ring;
      for (const [t, rad, col, a] of ghosts) {
        const gx = fx + (ccx - fx) * t, gy = fy + (ccy - fy) * t, gd = Math.hypot(x - gx, y - gy) / R;
        const v = gd < rad ? a * (0.6 + 0.4 * gd / rad) : 0; r += col[0] * v; g += col[1] * v; b += col[2] * v;
      }
      d[i] = d[i] + r * B; d[i + 1] = d[i + 1] + g * B; d[i + 2] = d[i + 2] + b * B;
    }
    return o;
  });

  // Other
  const morph = (s, r, fnMax) => {
    const W = s.width, H = s.height, sd = s.data, tmp = new Uint8ClampedArray(sd.length), o = copy(s), d = o.data;
    const pass = (src, dst, horiz) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; for (let c = 0; c < 3; c++) { let v = src[i + c]; for (let k = -r; k <= r; k++) { const q = horiz ? (y * W + clamp(x + k, 0, W - 1)) * 4 : (clamp(y + k, 0, H - 1) * W + x) * 4; v = fnMax ? Math.max(v, src[q + c]) : Math.min(v, src[q + c]); } dst[i + c] = v; } dst[i + 3] = src[i + 3]; } };
    pass(sd, tmp, true); pass(tmp, d, false); return o;
  };
  def('maximum', 'Other', 'Maximum…', [P('radius', 'Radius', 1, 50, 2, { unit: 'px' })], (s, p) => morph(s, Math.round(p.radius), true));
  def('minimum', 'Other', 'Minimum…', [P('radius', 'Radius', 1, 50, 2, { unit: 'px' })], (s, p) => morph(s, Math.round(p.radius), false));
  def('offset', 'Other', 'Offset…', [P('dx', 'Horizontal', -2000, 2000, 100, { unit: 'px' }), P('dy', 'Vertical', -2000, 2000, 0, { unit: 'px' })], (s, p) => warp(s, (x, y, o) => { o[0] = x - p.dx; o[1] = y - p.dy; }, true));
  def('colortoalpha', 'Other', 'Color to Alpha…', [P('threshold', 'Softness', 1, 100, 40, { unit: '%' })], (s, p, ctx = {}) => {
    // removes the background colour like GIMP's Color to Alpha: alpha grows with distance from the colour
    const o = copy(s), d = o.data, k = ctx.bg || [255, 255, 255], T = p.threshold / 100 * 255;
    for (let i = 0; i < d.length; i += 4) {
      let a = 0; for (let c = 0; c < 3; c++) { const v = d[i + c], ref = k[c]; a = Math.max(a, v > ref ? (v - ref) / Math.max(1, 255 - ref) : (ref - v) / Math.max(1, ref)); }
      a = Math.min(1, a * 255 / Math.max(1, T));
      if (a > 0) for (let c = 0; c < 3; c++) d[i + c] = clamp((d[i + c] - k[c]) / a + k[c], 0, 255);
      d[i + 3] *= a;
    }
    return o;
  }, { usesColors: true, note: 'Turns the background colour transparent.' });
  def('diffuse', 'Stylize', 'Diffuse…', [P('amount', 'Amount', 1, 10, 3, { unit: 'px' }), P('seed', 'Seed', 1, 999, 5)], (s, p) => { const r = rng(p.seed * 17); return warp(s, (x, y, o) => { o[0] = x + (r() - 0.5) * 2 * p.amount; o[1] = y + (r() - 0.5) * 2 * p.amount; }); });
  def('diffclouds', 'Render', 'Difference Clouds', [P('scale', 'Scale', 10, 400, 100, { unit: '%' }), P('seed', 'Seed', 1, 999, 2)], (s, p, ctx = {}) => {
    const c = F.clouds.run(s, { ...p, mix: 100 }, ctx), d = c.data, sd = s.data;
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = Math.abs(sd[i + k] - d[i + k]);
    return c;
  }, { usesColors: true });
  def('fibers', 'Render', 'Fibers…', [P('variance', 'Variance', 1, 64, 16), P('strength', 'Strength', 1, 64, 4), P('seed', 'Seed', 1, 999, 4)], (s, p, ctx = {}) => {
    const W = s.width, H = s.height, n = makeNoise(p.seed * 53), o = copy(s), d = o.data, fx = 0.08 + p.variance / 64 * 0.6, fy = fx / (2 + 1.5 * p.strength) * (0.5 + p.variance / 32);
    const fg = ctx.fg || [0, 0, 0], bg = ctx.bg || [255, 255, 255];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = 0, a = 0.5, f = 1; for (let k = 0; k < 4; k++) { v += n(x * fx * f, y * fy * f) * a; a /= 2; f *= 2; }
      v = clamp((v - 0.2) / 0.6, 0, 1); const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) d[i + c] = fg[c] * (1 - v) + bg[c] * v; d[i + 3] = 255;
    }
    return o;
  }, { usesColors: true });

  // Adjust (one-shot image adjustments)
  const hist3 = (d, clipFrac) => {
    const H = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]; let n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 8) continue; H[0][d[i]]++; H[1][d[i + 1]]++; H[2][d[i + 2]]++; n++; }
    const pts = H.map(h => { const cut = n * clipFrac; let a = 0, lo = 0, hi = 255; for (let v = 0; v < 256; v++) { a += h[v]; if (a > cut) { lo = v; break; } } a = 0; for (let v = 255; v >= 0; v--) { a += h[v]; if (a > cut) { hi = v; break; } } return [lo, hi]; });
    const med = H.map(h => { let a = 0; for (let v = 0; v < 256; v++) { a += h[v]; if (2 * a >= n) return v; } return 128; });
    return { H, n, pts, med };
  };
  const stretch = (d, lo, hi, gamma = [1, 1, 1]) => {
    const T = [0, 1, 2].map(c => { const t = new Uint8ClampedArray(256), s = Math.max(1, hi[c] - lo[c]); for (let v = 0; v < 256; v++) t[v] = 255 * Math.pow(clamp((v - lo[c]) / s, 0, 1), gamma[c]); return t; });
    for (let i = 0; i < d.length; i += 4) { d[i] = T[0][d[i]]; d[i + 1] = T[1][d[i + 1]]; d[i + 2] = T[2][d[i + 2]]; }
  };
  def('autocontrast', 'Adjust', 'Auto Contrast', [], s => {
    // one black/white point from all channels, 0.1% clip
    const o = copy(s), { pts } = hist3(o.data, 0.001), lo = Math.min(...pts.map(p => p[0])), hi = Math.max(...pts.map(p => p[1]));
    stretch(o.data, [lo, lo, lo], [hi, hi, hi]); return o;
  });
  def('autocolor', 'Adjust', 'Auto Color', [], s => {
    // per-channel points, then move each channel's median toward the shared mean (neutralises casts)
    const o = copy(s), { pts, med } = hist3(o.data, 0.001), want = (med[0] + med[1] + med[2]) / 3;
    const g = [0, 1, 2].map(c => { const t = clamp((med[c] - pts[c][0]) / Math.max(1, pts[c][1] - pts[c][0]), 0.02, 0.98), w = clamp(want / 255, 0.02, 0.98); return clamp(Math.log(w) / Math.log(t), 0.1, 9.99); });
    stretch(o.data, pts.map(p => p[0]), pts.map(p => p[1]), g); return o;
  });
  def('equalize', 'Adjust', 'Equalize', [], s => {
    const o = copy(s), d = o.data, h = new Uint32Array(256); let tot = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 8) continue; h[d[i]]++; h[d[i + 1]]++; h[d[i + 2]]++; tot += 3; }
    let first = 0; for (let v = 0; v < 256; v++) if (h[v]) { first = h[v]; break; }
    const lut = new Uint8ClampedArray(256); let acc = 0; for (let v = 0; v < 256; v++) { acc += h[v]; lut[v] = 255 * (acc - first) / Math.max(1, tot - first); }
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    return o;
  });
  def('desaturate', 'Adjust', 'Desaturate', [], s => { const o = copy(s), d = o.data; for (let i = 0; i < d.length; i += 4) { const v = (Math.max(d[i], d[i + 1], d[i + 2]) + Math.min(d[i], d[i + 1], d[i + 2])) / 2; d[i] = d[i + 1] = d[i + 2] = v; } return o; });
  def('shadowhighlight', 'Adjust', 'Shadows/Highlights…', [P('shadows', 'Shadows amount', 0, 100, 35, { unit: '%' }), P('stone', 'Shadows tone', 1, 100, 50, { unit: '%' }), P('highlights', 'Highlights amount', 0, 100, 0, { unit: '%' }), P('htone', 'Highlights tone', 1, 100, 50, { unit: '%' }), P('radius', 'Radius', 1, 300, 30, { unit: 'px' }), P('color', 'Color', -100, 100, 20)], (s, p) => {
    // Photoshop model: a blurred brightness map decides how much each
    // pixel is lifted (shadows) or pulled down (highlights); luma changes, colour difference is kept and boosted.
    const o = copy(s), d = o.data, W = s.width, Hh = s.height, n = W * Hh;
    const B = { width: W, height: Hh, data: new Uint8ClampedArray(n * 4) };
    for (let i = 0; i < n; i++) { const j = i * 4, v = (Math.max(d[j], d[j + 1], d[j + 2]) + lum(d, j)) / 2; B.data[j] = B.data[j + 1] = B.data[j + 2] = v; B.data[j + 3] = 255; }
    const M = gaussian(B, p.radius * 0.57).data;
    const sa = p.shadows / 100, ha = p.highlights / 100, sp = 0.5 + (100 - p.stone) / 25, hp = 0.5 + (100 - p.htone) / 25, cg = 1 + p.color / 100;
    for (let i = 0; i < n; i++) {
      const j = i * 4, m = M[j] / 255, L = lum(d, j) / 255;
      let nl = L;
      if (sa) { const w = Math.pow(1 - m, sp); nl += sa * w * ((1 - Math.pow(1 - L, 2)) - L) * 1.6; }
      if (ha) { const w = Math.pow(m, hp); nl -= ha * w * (L - Math.pow(L, 2)) * 1.6; }
      nl = clamp(nl, 0, 1);
      const k = nl * 255 - L * 255, boost = (sa || ha) ? cg : 1;
      for (let c = 0; c < 3; c++) d[j + c] = clamp(nl * 255 + (d[j + c] - L * 255) * boost, 0, 255) + 0 * k;
    }
    return o;
  });
  def('replacecolor', 'Adjust', 'Replace Color…', [P('fuzz', 'Fuzziness', 0, 200, 40), P('hue', 'Hue', -180, 180, 0, { unit: '°' }), P('sat', 'Saturation', -100, 100, 0), P('light', 'Lightness', -100, 100, 0)], (s, p, ctx = {}) => {
    const o = copy(s), d = o.data, t = p.color || ctx.fg || [255, 0, 0], F = Math.max(1, p.fuzz) * 1.2;
    const rgb2hsl = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; if (mx === mn) return [0, 0, l]; const dd = mx - mn, sat = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn); let h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; return [h / 6, sat, l]; };
    const h2 = (pp, q, tt) => { if (tt < 0) tt += 1; if (tt > 1) tt -= 1; return tt < 1 / 6 ? pp + (q - pp) * 6 * tt : tt < 1 / 2 ? q : tt < 2 / 3 ? pp + (q - pp) * (2 / 3 - tt) * 6 : pp; };
    for (let i = 0; i < d.length; i += 4) {
      const dist = Math.hypot(d[i] - t[0], d[i + 1] - t[1], d[i + 2] - t[2]), m = clamp(1 - dist / F, 0, 1); if (!m) continue;
      let [h, sat, l] = rgb2hsl(d[i], d[i + 1], d[i + 2]);
      h = (h + p.hue / 360 + 1) % 1; sat = p.sat >= 0 ? sat + (1 - sat) * p.sat / 100 : sat * (1 + p.sat / 100); l = p.light >= 0 ? l + (1 - l) * p.light / 100 : l * (1 + p.light / 100);
      let R, G, Bb; if (!sat) R = G = Bb = l; else { const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, pp = 2 * l - q; R = h2(pp, q, h + 1 / 3); G = h2(pp, q, h); Bb = h2(pp, q, h - 1 / 3); }
      d[i] += (R * 255 - d[i]) * m; d[i + 1] += (G * 255 - d[i + 1]) * m; d[i + 2] += (Bb * 255 - d[i + 2]) * m;
    }
    return o;
  }, { pickColor: true, usesColors: true });
  def('matchcolor', 'Adjust', 'Neutralize Color Cast…', [P('amount', 'Strength', 0, 100, 80, { unit: '%' }), P('lum', 'Luminance', 50, 150, 100, { unit: '%' })], (s, p) => {
    // Reinhard-style transfer toward a neutral target in Lab-like space (Match Color's "Neutralize")
    const o = copy(s), d = o.data; let n = 0, ma = 0, mb = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 8) continue; ma += d[i] - d[i + 1]; mb += (d[i] + d[i + 1]) / 2 - d[i + 2]; n++; }
    ma /= Math.max(1, n); mb /= Math.max(1, n);
    const k = p.amount / 100, lk = p.lum / 100;
    for (let i = 0; i < d.length; i += 4) {
      const ca = -ma * k, cb = -mb * k;
      d[i] = clamp((d[i] + ca * 0.5 + cb / 3) * lk, 0, 255); d[i + 1] = clamp((d[i + 1] - ca * 0.5 + cb / 3) * lk, 0, 255); d[i + 2] = clamp((d[i + 2] - cb * 2 / 3) * lk, 0, 255);
    }
    return o;
  });

  /** Run a filter by id. ctx carries foreground/background colours for Render filters. */
  function run(id, src, params, ctx) {
    const f = F[id]; if (!f) throw new Error('Unknown filter ' + id);
    const p = {}; for (const q of f.params) p[q.key] = params && params[q.key] != null ? params[q.key] : q.value;
    return f.run(src, p, ctx);
  }
  return { F, run, gaussian, boxBlur };
})();
if (typeof module !== 'undefined') module.exports = PhotoFilters;
