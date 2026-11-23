// Mural — color helpers shared by the scene and particles.
const lerp = (a, b, t) => a + (b - a) * t;
export function hexToRgb(h, fallback = [255, 255, 255]) {
  const s = String(h || '').trim().replace('#', '');
  if (s.length === 3) return s.split('').map((c) => parseInt(c + c, 16));
  if (s.length >= 6) { const n = parseInt(s.slice(0, 6), 16); if (Number.isFinite(n)) return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  return fallback;
}
export const rgba = (rgb, a = 1) => `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${a})`;
export const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
