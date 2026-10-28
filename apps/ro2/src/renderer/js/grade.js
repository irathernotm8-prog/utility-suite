// Colour grades: one-click looks that change a picture's colours, a hue shift that moves its whole colour scheme,
// and a palette swap that recolours its main colours one by one (or to the brand kit's colours).
// Everything works on RGB 0..255 data; gradeFn(settings) returns a per-pixel function used for pictures and for
// single colours (shape and text fills) alike.

export const LOOKS = [
  { id: 'none', name: 'Original' }, { id: 'vivid', name: 'Vivid' }, { id: 'warm', name: 'Warm' }, { id: 'cool', name: 'Cool' },
  { id: 'tealorange', name: 'Teal & orange' }, { id: 'golden', name: 'Golden hour' }, { id: 'film', name: 'Film' }, { id: 'vintage', name: 'Vintage' },
  { id: 'matte', name: 'Matte' }, { id: 'pastel', name: 'Pastel' }, { id: 'moody', name: 'Moody' }, { id: 'cyber', name: 'Neon night' },
  { id: 'sepia', name: 'Sepia' }, { id: 'mono', name: 'Black & white' }, { id: 'noir', name: 'Noir' }, { id: 'duotone', name: 'Duotone' },
];
export const DEFAULT = { look: 'none', amount: 100, hue: 0, sat: 0, swaps: [], duo: ['#1b1f4a', '#ff7ab6'] };
export const isIdentity = (g) => !g || ((g.look === 'none' || !g.amount) && !g.hue && !g.sat && !(g.swaps || []).some((s) => s.to && s.to !== s.from));

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const mix = (a, b, t) => a + (b - a) * t;
const scurve = (v, k) => clamp01(k >= 1 ? mix(v, v * v * (3 - 2 * v), Math.min(1, (k - 1) * 2)) : 0.5 + (v - 0.5) * k); // contrast: an S-curve above 1, flatter below
function sat3(r, g, b, s) { const l = luma(r, g, b); return [l + (r - l) * s, l + (g - l) * s, l + (b - l) * s]; }
function split(r, g, b, sh, hi, k) { const l = luma(r, g, b); const ws = (1 - l) * (1 - l) * k, wh = l * l * k; return [r + (sh[0] - 0.5) * ws + (hi[0] - 0.5) * wh, g + (sh[1] - 0.5) * ws + (hi[1] - 0.5) * wh, b + (sh[2] - 0.5) * ws + (hi[2] - 0.5) * wh]; }
const lift = (v, lo, hi) => lo + v * (hi - lo);
const hexRgb = (h) => { const v = parseInt(String(h).replace('#', '').slice(0, 6), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };

// the looks, on 0..1 RGB
function looks(id, r, g, b, duo) {
  switch (id) {
    case 'vivid': { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); [r, g, b] = sat3(r, g, b, 1.2 + 0.3 * (1 - (mx - mn))); return [scurve(r, 1.15), scurve(g, 1.15), scurve(b, 1.15)]; } // vibrance: dull colours gain most
    case 'warm': return sat3(r * 1.06 + 0.02, g * 1.01 + 0.005, b * 0.88, 1.05);
    case 'cool': return sat3(r * 0.9, g * 0.98 + 0.01, b * 1.08 + 0.03, 1.02);
    case 'tealorange': { [r, g, b] = split(r, g, b, [0.25, 0.62, 0.68], [0.95, 0.62, 0.38], 0.55); [r, g, b] = sat3(r, g, b, 1.12); return [scurve(r, 1.1), scurve(g, 1.1), scurve(b, 1.1)]; }
    case 'golden': { [r, g, b] = split(r * 1.05, g * 1.0, b * 0.86, [0.55, 0.45, 0.42], [1, 0.75, 0.4], 0.45); return sat3(r, g, b, 1.08); }
    case 'film': { [r, g, b] = [scurve(r, 1.22), scurve(g, 1.18), scurve(b, 1.14)]; [r, g, b] = split(r, g, b, [0.42, 0.56, 0.54], [0.58, 0.52, 0.44], 0.3); return [lift(r, 0.03, 0.97), lift(g, 0.03, 0.97), lift(b, 0.04, 0.95)]; }
    case 'vintage': { [r, g, b] = sat3(r, g, b, 0.72); [r, g, b] = split(r, g, b, [0.44, 0.55, 0.5], [0.62, 0.55, 0.42], 0.45); return [lift(r, 0.09, 0.95), lift(g, 0.08, 0.93), lift(b, 0.08, 0.86)]; }
    case 'matte': { [r, g, b] = [scurve(r, 0.9), scurve(g, 0.9), scurve(b, 0.9)]; return sat3(lift(r, 0.1, 0.96), lift(g, 0.1, 0.96), lift(b, 0.11, 0.96), 0.92); }
    case 'pastel': { [r, g, b] = sat3(r, g, b, 0.6); [r, g, b] = split(r, g, b, [0.5, 0.48, 0.58], [0.6, 0.5, 0.52], 0.3); return [lift(r, 0.16, 1), lift(g, 0.15, 0.99), lift(b, 0.17, 1)]; }
    case 'moody': { [r, g, b] = sat3(Math.pow(r, 1.15), Math.pow(g, 1.15), Math.pow(b, 1.12), 0.78); return split(r, g, b, [0.38, 0.48, 0.6], [0.55, 0.52, 0.48], 0.4); }
    case 'cyber': { [r, g, b] = split(r, g, b, [0.3, 0.28, 0.85], [0.95, 0.38, 0.8], 0.7); [r, g, b] = sat3(r, g, b, 1.3); return [scurve(r, 1.15), scurve(g, 1.1), scurve(b, 1.15)]; }
    case 'sepia': { const l = luma(r, g, b); return [l * 1.07 + 0.08, l * 0.95 + 0.04, l * 0.78]; }
    case 'mono': { const l = luma(r, g, b); return [l, l, l]; }
    case 'noir': { const l = scurve(Math.pow(luma(r, g, b), 1.1), 1.55); return [l, l, l]; }
    case 'duotone': { const l = luma(r, g, b); const a = duo[0], c = duo[1]; return [mix(a[0], c[0], l), mix(a[1], c[1], l), mix(a[2], c[2], l)]; }
    default: return [r, g, b];
  }
}

// ── Lab (D65) for the palette swap ──
const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const gam = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const fL = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
const fLi = (t) => (t > 0.206893 ? t * t * t : (t - 16 / 116) / 7.787);
export function toLab(r, g, b) { // 0..1
  r = lin(r); g = lin(g); b = lin(b);
  const x = fL((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = fL(0.2126 * r + 0.7152 * g + 0.0722 * b), z = fL((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function fromLab(L, A, B) {
  const y = (L + 16) / 116, x = A / 500 + y, z = y - B / 200;
  const X = fLi(x) * 0.95047, Y = fLi(y), Z = fLi(z) * 1.08883;
  return [gam(3.2406 * X - 1.5372 * Y - 0.4986 * Z), gam(-0.9689 * X + 1.8758 * Y + 0.0415 * Z), gam(0.0557 * X - 0.204 * Y + 1.057 * Z)].map(clamp01);
}
function hueRot(r, g, b, deg) { // rotate hue in Lab (keeps lightness)
  const [L, A, B] = toLab(r, g, b); const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  return fromLab(L, A * c - B * s, A * s + B * c);
}

// settings → (r,g,b 0..255) → [r,g,b] 0..255
export function gradeFn(gs) {
  const g = { ...DEFAULT, ...(gs || {}) }; const amt = (g.amount ?? 100) / 100; const duo = (g.duo || DEFAULT.duo).map(hexRgb);
  const swaps = (g.swaps || []).filter((s) => s.to && s.to.toLowerCase() !== s.from.toLowerCase()).map((s) => { const f = toLab(...hexRgb(s.from)), t = toLab(...hexRgb(s.to)); return { f, d: [t[0] - f[0], t[1] - f[1], t[2] - f[2]], sig: s.reach || 22 }; });
  const sat = 1 + (g.sat || 0) / 100; const hue = g.hue || 0; const look = g.look || 'none';
  return (R, G, B) => {
    let r = R / 255, gg = G / 255, b = B / 255;
    if (swaps.length) {
      const [L, A, Bb] = toLab(r, gg, b); let dl = 0, da = 0, db = 0, ws = 0;
      for (const s of swaps) { const d2 = (L - s.f[0]) ** 2 * 0.5 + (A - s.f[1]) ** 2 + (Bb - s.f[2]) ** 2; const w = Math.exp(-d2 / (2 * s.sig * s.sig)); if (w < 0.002) continue; dl += s.d[0] * w; da += s.d[1] * w; db += s.d[2] * w; ws += w; }
      if (ws > 0) { const k = 1 / Math.max(1, ws); [r, gg, b] = fromLab(L + dl * k, A + da * k, Bb + db * k); }
    }
    if (hue) [r, gg, b] = hueRot(r, gg, b, hue);
    if (sat !== 1) [r, gg, b] = sat3(r, gg, b, sat);
    if (look !== 'none' && amt > 0) { const [lr, lg, lb] = looks(look, r, gg, b, duo); r = mix(r, lr, amt); gg = mix(gg, lg, amt); b = mix(b, lb, amt); }
    return [clamp01(r) * 255, clamp01(gg) * 255, clamp01(b) * 255];
  };
}
// apply to RGBA data in place (alpha untouched). A 32³ lookup table makes big pictures fast and keeps results identical
export async function gradeData(data, gs, onProgress) {
  const f = gradeFn(gs); const N = 33; const lut = new Float32Array(N * N * N * 3);
  for (let i = 0, q = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++, q += 3) { const o = f((i / (N - 1)) * 255, (j / (N - 1)) * 255, (k / (N - 1)) * 255); lut[q] = o[0]; lut[q + 1] = o[1]; lut[q + 2] = o[2]; }
  const S = (N - 1) / 255; const n = data.length / 4; const chunk = 1 << 19;
  for (let p0 = 0; p0 < n; p0 += chunk) {
    const p1 = Math.min(n, p0 + chunk);
    for (let p = p0; p < p1; p++) {
      const i4 = p * 4; const r = data[i4] * S, g = data[i4 + 1] * S, b = data[i4 + 2] * S;
      const r0 = r | 0, g0 = g | 0, b0 = b | 0; const r1 = Math.min(N - 1, r0 + 1), g1 = Math.min(N - 1, g0 + 1), b1 = Math.min(N - 1, b0 + 1); const fr = r - r0, fg = g - g0, fb = b - b0;
      for (let c = 0; c < 3; c++) { // trilinear
        const v = (a, bb, cc) => lut[((a * N + bb) * N + cc) * 3 + c];
        const c00 = v(r0, g0, b0) * (1 - fr) + v(r1, g0, b0) * fr, c01 = v(r0, g0, b1) * (1 - fr) + v(r1, g0, b1) * fr, c10 = v(r0, g1, b0) * (1 - fr) + v(r1, g1, b0) * fr, c11 = v(r0, g1, b1) * (1 - fr) + v(r1, g1, b1) * fr;
        data[i4 + c] = (c00 * (1 - fg) + c10 * fg) * (1 - fb) + (c01 * (1 - fg) + c11 * fg) * fb;
      }
    }
    if (onProgress) { onProgress(p1 / n); await new Promise((r) => setTimeout(r, 0)); }
  }
  return data;
}
export function gradeHex(hex, gs) { const [r, g, b] = hexRgb(hex).map((v) => v * 255); const o = gradeFn(gs)(r, g, b); return '#' + o.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''); }

// the main colours of a picture (k-means in Lab on a sample), biggest first: [{hex, share}]
export function paletteOf(data, w, h, k = 6) {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 12000))); const px = [];
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) { const i = (y * w + x) * 4; if (data[i + 3] < 128) continue; px.push(toLab(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255)); }
  if (!px.length) return [];
  let cs = []; cs.push(px[0]);
  while (cs.length < k) { let best = null, bd = -1; for (let i = 0; i < px.length; i += 7) { const p = px[i]; let d = Infinity; for (const c of cs) d = Math.min(d, (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2); if (d > bd) { bd = d; best = p; } } if (!best || bd < 30) break; cs.push(best.slice()); }
  let as = new Int32Array(px.length);
  for (let it = 0; it < 10; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < px.length; i++) { const p = px[i]; let bi = 0, bd = Infinity; for (let j = 0; j < cs.length; j++) { const c = cs[j]; const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = j; } } as[i] = bi; const s = sum[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; }
    cs = cs.map((c, j) => (sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] : c));
  }
  const cnt = cs.map(() => 0); for (const a of as) cnt[a]++;
  const out = cs.map((c, j) => ({ hex: '#' + fromLab(...c).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join(''), share: cnt[j] / px.length, lab: c }))
    .filter((c) => c.share > 0.01).sort((a, b) => b.share - a.share);
  // merge near-duplicates
  const kept = []; for (const c of out) { const near = kept.find((q) => Math.hypot(q.lab[0] - c.lab[0], q.lab[1] - c.lab[1], q.lab[2] - c.lab[2]) < 9); if (near) near.share += c.share; else kept.push(c); }
  return kept.map(({ hex, share }) => ({ hex, share }));
}
// brand colours onto a palette: each picture colour goes to the brand colour closest in lightness order
export function brandSwaps(pal, brand) {
  if (!brand.length) return [];
  const L = (h) => toLab(...hexRgb(h))[0];
  const ps = pal.slice().sort((a, b) => L(a.hex) - L(b.hex)), bs = brand.slice().sort((a, b) => L(a) - L(b));
  return ps.map((p, i) => ({ from: p.hex, to: bs[Math.round((i / Math.max(1, ps.length - 1)) * (bs.length - 1))] }));
}
