// Shared colour pipeline (Lumetri-style grade) used by the photo and video editors.
// A grade is a plain object; ColorGrade.fn(grade) returns (r, g, b) → [r, g, b] in 0…1, and
// ColorGrade.bake(grade, N) turns it into an N³ lookup table so the video preview (WebGL) and the FFmpeg
// export (lut3d) apply exactly the same maths. Also parses and samples .cube / .3dl LUT files.
const ColorGrade = (() => {
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const toLin = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const toSrgb = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

  const DEFAULT = () => ({
    temperature: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    vibrance: 0, saturation: 100, fade: 0, look: 'none', lookAmount: 100,
    wheels: { shadows: { hue: 0, amount: 0 }, midtones: { hue: 0, amount: 0 }, highlights: { hue: 0, amount: 0 } },
    curves: null, // { rgb:[[x,y]...], r, g, b } in 0…255
    lut: null,    // { name, size, data: Float32Array(size³·3), amount }
    vignette: 0, vignetteMid: 50, sharpen: 0,
  });
  /** True when the grade changes colour (so a LUT is needed). */
  function isColorActive(g) {
    if (!g) return false;
    const d = DEFAULT();
    for (const k of ['temperature', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance', 'saturation', 'fade']) if ((g[k] ?? d[k]) !== d[k]) return true;
    if (g.look && g.look !== 'none' && (g.lookAmount ?? 100) > 0) return true;
    if (g.wheels && Object.values(g.wheels).some(w => w && w.amount)) return true;
    if (g.curves && Object.values(g.curves).some(p => p && !identityCurve(p))) return true;
    if (g.lut && g.lut.data && (g.lut.amount ?? 100) > 0) return true;
    return false;
  }
  const identityCurve = pts => !pts || pts.length < 2 || pts.every(([x, y]) => Math.abs(x - y) < 0.5);

  // ---------- curves (monotone cubic through points, 0…255) ----------
  function curveTable(pts) {
    const out = new Float32Array(256);
    if (identityCurve(pts)) { for (let i = 0; i < 256; i++) out[i] = i / 255; return out; }
    const P = [...pts].sort((a, b) => a[0] - b[0]), n = P.length;
    const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
    const d = [], m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; } else {
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    for (let x = 0; x < 256; x++) {
      let y;
      if (x <= xs[0]) y = ys[0]; else if (x >= xs[n - 1]) y = ys[n - 1];
      else {
        let k = 0; while (xs[k + 1] < x) k++;
        const h = xs[k + 1] - xs[k], t = (x - xs[k]) / h, t2 = t * t, t3 = t2 * t;
        y = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
      }
      out[x] = clamp01(y / 255);
    }
    return out;
  }
  const sampleTable = (T, v) => { const x = clamp01(v) * 255, i = Math.min(254, Math.floor(x)), f = x - i; return T[i] * (1 - f) + T[i + 1] * f; };

  // ---------- looks (creative presets) ----------
  // Each look is a small grade of its own, blended by lookAmount.
  const LOOKS = {
    none: { name: 'None' },
    cinematic: { name: 'Cinematic teal & orange', g: { contrast: 18, saturation: 92, wheels: { shadows: { hue: 190, amount: 28 }, highlights: { hue: 32, amount: 22 } }, blacks: 6 } },
    warm: { name: 'Warm summer', g: { temperature: 28, vibrance: 18, highlights: -8 } },
    cool: { name: 'Cool morning', g: { temperature: -26, tint: -4, contrast: 6 } },
    film: { name: 'Faded film', g: { fade: 38, contrast: -10, saturation: 85, wheels: { shadows: { hue: 200, amount: 12 }, highlights: { hue: 45, amount: 10 } } } },
    bleach: { name: 'Bleach bypass', g: { saturation: 45, contrast: 38, highlights: -12 } },
    noir: { name: 'Noir', g: { saturation: 0, contrast: 42, blacks: -14 } },
    vivid: { name: 'Vivid pop', g: { vibrance: 40, saturation: 112, contrast: 14 } },
    matte: { name: 'Soft matte', g: { fade: 24, contrast: -18, highlights: -14, shadows: 10 } },
    golden: { name: 'Golden hour', g: { temperature: 40, tint: 8, highlights: -10, wheels: { highlights: { hue: 38, amount: 30 } } } },
    moonlight: { name: 'Moonlight', g: { temperature: -45, exposure: -0.4, saturation: 70, wheels: { shadows: { hue: 225, amount: 30 } } } },
    sepia: { name: 'Sepia', g: { saturation: 0, wheels: { midtones: { hue: 32, amount: 45 }, highlights: { hue: 40, amount: 25 } } } },
  };

  const wheelRGB = (w) => {
    if (!w || !w.amount) return null;
    const h = (w.hue % 360) * Math.PI / 180, a = w.amount / 100 * 0.25;
    // hue → offset in RGB that sums to ~0 (keeps luminance roughly stable)
    return [Math.cos(h) * a, Math.cos(h - 2.0944) * a, Math.cos(h + 2.0944) * a];
  };

  /** Build the per-pixel colour function for a grade (no LUT file, no look). */
  function core(g) {
    const exp = Math.pow(2, g.exposure || 0);
    const temp = (g.temperature || 0) / 100, tint = (g.tint || 0) / 100;
    // white balance multipliers (in linear light)
    const wbR = 1 + temp * 0.18 + tint * 0.05, wbG = 1 - tint * 0.12, wbB = 1 - temp * 0.22 + tint * 0.05;
    const con = 1 + (g.contrast || 0) / 100 * 0.8;
    const hi = (g.highlights || 0) / 100, sh = (g.shadows || 0) / 100, wh = (g.whites || 0) / 100, bl = (g.blacks || 0) / 100;
    const sat = (g.saturation ?? 100) / 100, vib = (g.vibrance || 0) / 100, fade = (g.fade || 0) / 100;
    const W = g.wheels || {};
    const ws = wheelRGB(W.shadows), wm = wheelRGB(W.midtones), whl = wheelRGB(W.highlights);
    const C = g.curves || {};
    const cm = C.rgb && !identityCurve(C.rgb) ? curveTable(C.rgb) : null;
    const cr = C.r && !identityCurve(C.r) ? curveTable(C.r) : null, cg = C.g && !identityCurve(C.g) ? curveTable(C.g) : null, cb = C.b && !identityCurve(C.b) ? curveTable(C.b) : null;
    return (r, gg, b) => {
      // linear-light: exposure and white balance
      let R = toLin(r) * exp * wbR, G = toLin(gg) * exp * wbG, B = toLin(b) * exp * wbB;
      R = toSrgb(Math.max(0, R)); G = toSrgb(Math.max(0, G)); B = toSrgb(Math.max(0, B));
      // tone: whites/blacks set the end points, highlights/shadows bend the regions, contrast pivots at mid grey
      const tone = v => {
        v = v + bl * 0.25 * (1 - v) * (1 - smooth(0, 0.35, v)) + wh * 0.25 * v * smooth(0.6, 1, v);
        const L = v;
        v += sh * 0.35 * (1 - smooth(0.05, 0.55, L)) * (0.55 - Math.abs(L - 0.3));
        v += hi * 0.35 * smooth(0.45, 0.95, L) * (0.55 - Math.abs(L - 0.75));
        v = (v - 0.5) * con + 0.5;
        return v;
      };
      R = tone(R); G = tone(G); B = tone(B);
      // colour wheels (lift / gamma / gain style weighting by luminance)
      const Y = clamp01(luma(R, G, B));
      if (ws) { const k = 1 - smooth(0, 0.5, Y); R += ws[0] * k; G += ws[1] * k; B += ws[2] * k; }
      if (wm) { const k = 1 - Math.abs(Y - 0.5) * 2; R += wm[0] * k; G += wm[1] * k; B += wm[2] * k; }
      if (whl) { const k = smooth(0.5, 1, Y); R += whl[0] * k; G += whl[1] * k; B += whl[2] * k; }
      // saturation & vibrance (vibrance boosts muted colours more than saturated ones)
      const Y2 = luma(R, G, B);
      let s = sat;
      if (vib) { const mx = Math.max(R, G, B), mn = Math.min(R, G, B), cur = mx > 0 ? (mx - mn) / mx : 0; s *= 1 + vib * (1 - cur) * 1.2; }
      if (s !== 1) { R = Y2 + (R - Y2) * s; G = Y2 + (G - Y2) * s; B = Y2 + (B - Y2) * s; }
      // faded film: lift the blacks, pull the whites a little
      if (fade) { R = R * (1 - fade * 0.3) + fade * 0.16; G = G * (1 - fade * 0.3) + fade * 0.16; B = B * (1 - fade * 0.3) + fade * 0.18; }
      R = clamp01(R); G = clamp01(G); B = clamp01(B);
      if (cm) { R = sampleTable(cm, R); G = sampleTable(cm, G); B = sampleTable(cm, B); }
      if (cr) R = sampleTable(cr, R); if (cg) G = sampleTable(cg, G); if (cb) B = sampleTable(cb, B);
      return [R, G, B];
    };
  }

  /** Full colour function: core grade → look → LUT file. */
  function fn(g) {
    g = { ...DEFAULT(), ...(g || {}) };
    const base = core(g);
    const L = LOOKS[g.look] && LOOKS[g.look].g ? core({ ...DEFAULT(), ...LOOKS[g.look].g }) : null, la = (g.lookAmount ?? 100) / 100;
    const lut = g.lut && g.lut.data ? g.lut : null, lutA = lut ? (lut.amount ?? 100) / 100 : 0;
    return (r, gg, b) => {
      let c = base(r, gg, b);
      if (L && la > 0) { const d = L(c[0], c[1], c[2]); c = [c[0] + (d[0] - c[0]) * la, c[1] + (d[1] - c[1]) * la, c[2] + (d[2] - c[2]) * la]; }
      if (lut && lutA > 0) { const d = sampleLut(lut, c[0], c[1], c[2]); c = [c[0] + (d[0] - c[0]) * lutA, c[1] + (d[1] - c[1]) * lutA, c[2] + (d[2] - c[2]) * lutA]; }
      return c;
    };
  }

  // ---------- LUT files ----------
  /** Parse Adobe/Resolve .cube (3D) or Autodesk .3dl text. Returns { size, data: Float32Array r-fastest, domain }. */
  function parseLut(text, name = 'LUT') {
    const lines = String(text).split(/\r?\n/);
    if (/\.3dl$/i.test(name) || (!/LUT_3D_SIZE/i.test(text) && /^\s*\d+(\s+\d+){8,}\s*$/m.test(text))) return parse3dl(lines, name);
    let size = 0, min = [0, 0, 0], max = [1, 1, 1];
    const vals = [];
    for (const raw of lines) {
      const s = raw.trim(); if (!s || s[0] === '#') continue;
      const up = s.toUpperCase();
      if (up.startsWith('LUT_3D_SIZE')) { size = parseInt(s.split(/\s+/)[1], 10); continue; }
      if (up.startsWith('LUT_1D_SIZE')) throw new Error('1D LUTs aren\'t supported — use a 3D .cube file.');
      if (up.startsWith('DOMAIN_MIN')) { min = s.split(/\s+/).slice(1, 4).map(Number); continue; }
      if (up.startsWith('DOMAIN_MAX')) { max = s.split(/\s+/).slice(1, 4).map(Number); continue; }
      if (/^[A-Z_]/.test(up)) continue; // TITLE etc.
      const p = s.split(/\s+/).map(Number);
      if (p.length >= 3 && p.slice(0, 3).every(Number.isFinite)) vals.push(p[0], p[1], p[2]);
    }
    if (!size) size = Math.round(Math.cbrt(vals.length / 3));
    if (size < 2 || vals.length < size ** 3 * 3) throw new Error('This LUT file looks incomplete.');
    const data = new Float32Array(vals.slice(0, size ** 3 * 3));
    return { name, size, data, min, max };
  }
  function parse3dl(lines, name) {
    let rows = lines.map(s => s.trim()).filter(s => s && !s.startsWith('#')).map(s => s.split(/\s+/).map(Number)).filter(p => p.every(Number.isFinite));
    if (rows[0] && rows[0].length > 3) rows = rows.slice(1); // input range header
    const size = Math.round(Math.cbrt(rows.length));
    if (size < 2) throw new Error('This .3dl file looks incomplete.');
    const peak = Math.max(...rows.flat()) > 4095 ? 65535 : Math.max(...rows.flat()) > 1023 ? 4095 : 1023;
    // .3dl is blue-fastest; convert to red-fastest
    const data = new Float32Array(size ** 3 * 3);
    let k = 0;
    for (let r = 0; r < size; r++) for (let g = 0; g < size; g++) for (let b = 0; b < size; b++) {
      const o = ((b * size + g) * size + r) * 3, p = rows[k++];
      data[o] = p[0] / peak; data[o + 1] = p[1] / peak; data[o + 2] = p[2] / peak;
    }
    return { name, size, data, min: [0, 0, 0], max: [1, 1, 1] };
  }
  /** Trilinear sample of a red-fastest LUT. */
  function sampleLut(L, r, g, b) {
    const N = L.size, d = L.data, mn = L.min || [0, 0, 0], mx = L.max || [1, 1, 1];
    const fx = clamp01((r - mn[0]) / (mx[0] - mn[0])) * (N - 1), fy = clamp01((g - mn[1]) / (mx[1] - mn[1])) * (N - 1), fz = clamp01((b - mn[2]) / (mx[2] - mn[2])) * (N - 1);
    const x0 = Math.min(N - 2, Math.floor(fx)), y0 = Math.min(N - 2, Math.floor(fy)), z0 = Math.min(N - 2, Math.floor(fz));
    const tx = fx - x0, ty = fy - y0, tz = fz - z0;
    const at = (x, y, z, c) => d[((z * N + y) * N + x) * 3 + c];
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const c00 = at(x0, y0, z0, c) * (1 - tx) + at(x0 + 1, y0, z0, c) * tx;
      const c10 = at(x0, y0 + 1, z0, c) * (1 - tx) + at(x0 + 1, y0 + 1, z0, c) * tx;
      const c01 = at(x0, y0, z0 + 1, c) * (1 - tx) + at(x0 + 1, y0, z0 + 1, c) * tx;
      const c11 = at(x0, y0 + 1, z0 + 1, c) * (1 - tx) + at(x0 + 1, y0 + 1, z0 + 1, c) * tx;
      out[c] = (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
    }
    return out;
  }
  /** Bake a grade into an N³ LUT (red-fastest Float32Array). */
  function bake(g, N = 33) {
    const f = fn(g), data = new Float32Array(N * N * N * 3);
    let o = 0;
    for (let b = 0; b < N; b++) for (let gg = 0; gg < N; gg++) for (let r = 0; r < N; r++) {
      const c = f(r / (N - 1), gg / (N - 1), b / (N - 1));
      data[o++] = c[0]; data[o++] = c[1]; data[o++] = c[2];
    }
    return { size: N, data };
  }
  function toCube(L, title = 'RO3 grade') {
    const out = [`TITLE "${title}"`, `LUT_3D_SIZE ${L.size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
    for (let i = 0; i < L.data.length; i += 3) out.push(`${L.data[i].toFixed(6)} ${L.data[i + 1].toFixed(6)} ${L.data[i + 2].toFixed(6)}`);
    return out.join('\n') + '\n';
  }
  /** Apply a colour function to RGBA pixel data in place (alpha untouched), via a 33³ LUT for speed. */
  function applyToPixels(g, d, amount = 1) {
    const L = bake(g, 33);
    for (let i = 0; i < d.length; i += 4) {
      const c = sampleLut(L, d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
      d[i] += (c[0] * 255 - d[i]) * amount; d[i + 1] += (c[1] * 255 - d[i + 1]) * amount; d[i + 2] += (c[2] * 255 - d[i + 2]) * amount;
    }
  }
  /** Stable key for caching baked LUTs. */
  const key = g => JSON.stringify({ ...g, lut: g && g.lut ? { n: g.lut.name, s: g.lut.size, a: g.lut.amount, len: g.lut.data && g.lut.data.length, sig: g.lut.data ? g.lut.data[Math.floor(g.lut.data.length / 2)] : 0 } : null });

  return { DEFAULT, LOOKS, isColorActive, fn, bake, toCube, parseLut, sampleLut, applyToPixels, curveTable, key };
})();
if (typeof module !== 'undefined') module.exports = ColorGrade;
