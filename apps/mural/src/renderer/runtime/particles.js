// Mural — particle layers: snow, rain, fireflies, stars, bokeh, dust, petals, bubbles, embers. Positions live in typed
// arrays and every soft dot is a pre-rendered sprite (no canvas blur), so a few hundred cost well under a millisecond.
// The cursor pushes particles away or draws them in through a springy offset that eases back; clicks give them a kick.
import { hexToRgb, rgba } from './color.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

function sprite(rgb, kind) {
  const s = 64; const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(s, s) : Object.assign(document.createElement('canvas'), { width: s, height: s });
  const g = c.getContext('2d'); const h = s / 2;
  if (kind === 'ring') { g.strokeStyle = rgba(rgb, 0.8); g.lineWidth = 3; g.beginPath(); g.arc(h, h, h - 4, 0, TAU); g.stroke(); g.fillStyle = rgba([255, 255, 255], 0.5); g.beginPath(); g.arc(h - h * 0.35, h - h * 0.35, h * 0.14, 0, TAU); g.fill(); return c; }
  if (kind === 'petal') { g.fillStyle = rgba(rgb, 1); g.beginPath(); g.ellipse(h, h, h * 0.9, h * 0.45, 0, 0, TAU); g.fill(); g.fillStyle = rgba([255, 255, 255], 0.25); g.beginPath(); g.ellipse(h - h * 0.2, h - h * 0.1, h * 0.4, h * 0.15, 0, 0, TAU); g.fill(); return c; }
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  if (kind === 'soft') { grad.addColorStop(0, rgba(rgb, 1)); grad.addColorStop(0.7, rgba(rgb, 0.9)); grad.addColorStop(1, rgba(rgb, 0)); }
  else if (kind === 'disc') { grad.addColorStop(0, rgba(rgb, 1)); grad.addColorStop(0.55, rgba(rgb, 1)); grad.addColorStop(0.75, rgba(rgb, 0.4)); grad.addColorStop(1, rgba(rgb, 0)); }
  else { grad.addColorStop(0, rgba([255, 255, 255], 1)); grad.addColorStop(0.12, rgba(rgb, 1)); grad.addColorStop(0.35, rgba(rgb, 0.35)); grad.addColorStop(1, rgba(rgb, 0)); }
  g.fillStyle = grad; g.fillRect(0, 0, s, s); return c;
}

const PRESETS = {
  //            size range (px @1x)   speed (px/s)                      sprite   alpha
  snow:      { r: [0.8, 2.6], vy: [18, 55], vx: [-6, 6], sprite: 'disc', a: [0.45, 0.95], sway: 1 },
  rain:      { r: [0.6, 1.2], vy: [650, 950], vx: [60, 90], sprite: null, a: [0.18, 0.4] },
  fireflies: { r: [2.5, 5.5], vy: [-8, 8], vx: [-10, 10], sprite: 'glow', a: [0.4, 1], wander: 1, pulse: 1 },
  stars:     { r: [0.6, 2.2], vy: [0, 0], vx: [0, 0], sprite: 'glow', a: [0.35, 1], twinkle: 1 },
  bokeh:     { r: [14, 60], vy: [-12, -3], vx: [-4, 4], sprite: 'soft', a: [0.05, 0.18] },
  dust:      { r: [0.5, 1.5], vy: [-4, 4], vx: [-5, 5], sprite: 'disc', a: [0.15, 0.55], wander: 0.5 },
  petals:    { r: [4.5, 8], vy: [25, 60], vx: [8, 25], sprite: 'petal', a: [0.7, 1], spin: 1, sway: 1.5 },
  bubbles:   { r: [3, 12], vy: [-70, -25], vx: [-4, 4], sprite: 'ring', a: [0.35, 0.8], sway: 0.8 },
  embers:    { r: [1, 3], vy: [-110, -40], vx: [-12, 12], sprite: 'glow', a: [0.5, 1], fade: 1, wander: 0.6, pulse: 0.5 }
};

export function createParticles(L, W, H) {
  const dpr = Math.max(0.25, Math.min(W, H) / 1000); // sizes and speeds follow the screen, so previews match the desktop
  const P = PRESETS[L.preset] || PRESETS.snow;
  const n = Math.max(0, Math.min(3000, L.count | 0));
  const rgb = hexToRgb(L.color);
  const spr = P.sprite ? sprite(rgb, P.sprite) : null;
  const top = Math.min(L.top, L.bottom) * H, bot = Math.max(L.top, L.bottom) * H, span = Math.max(1, bot - top);
  const x = new Float32Array(n), y = new Float32Array(n), vx = new Float32Array(n), vy = new Float32Array(n), r = new Float32Array(n), a = new Float32Array(n), ph = new Float32Array(n);
  const ox = new Float32Array(n), oy = new Float32Array(n), ovx = new Float32Array(n), ovy = new Float32Array(n);
  const scale = dpr * L.size;
  const sp = L.speed;
  const R = Math.min(W, H) * 0.14;
  function spawn(i, anywhere) {
    x[i] = Math.random() * W;
    y[i] = anywhere ? top + Math.random() * span : (P.vy[0] + P.vy[1] >= 0 ? top - 10 * scale : bot + 10 * scale);
    vx[i] = rand(P.vx[0], P.vx[1]) * sp * dpr; vy[i] = rand(P.vy[0], P.vy[1]) * sp * dpr;
    r[i] = rand(P.r[0], P.r[1]) * scale; a[i] = rand(P.a[0], P.a[1]); ph[i] = Math.random() * TAU;
    if (L.preset === 'snow') vy[i] *= 0.6 + r[i] / (P.r[1] * scale) * 0.6; // nearer (bigger) flakes fall faster
  }
  for (let i = 0; i < n; i++) spawn(i, true);
  const wind = L.wind * 60 * dpr;

  return {
    count: n,
    step(dt, t, cx, cy) {
      dt = Math.min(dt, 0.1);
      const mode = L.cursor;
      for (let i = 0; i < n; i++) {
        let mvx = vx[i] + wind * (P.vy[1] > 300 ? 3 : 1), mvy = vy[i];
        if (P.sway) mvx += Math.sin(t * 0.9 + ph[i]) * 14 * P.sway * dpr;
        if (P.wander) { ph[i] += dt * (0.5 + Math.random()); mvx += Math.cos(ph[i] * 0.7) * 16 * P.wander * dpr * sp; mvy += Math.sin(ph[i]) * 12 * P.wander * dpr * sp; }
        x[i] += mvx * dt; y[i] += mvy * dt;
        // cursor: a springy offset so the field always relaxes back
        if (mode !== 'none') {
          const px = x[i] + ox[i], py = y[i] + oy[i], dx = px - cx, dy = py - cy, d2 = dx * dx + dy * dy;
          if (d2 < R * R) {
            const d = Math.sqrt(d2) || 1, f = (1 - d / R); const k = f * f * 1400 * dpr;
            if (mode === 'repel') { ovx[i] += dx / d * k * dt; ovy[i] += dy / d * k * dt; }
            else { ovx[i] -= dx / d * k * 0.35 * dt; ovy[i] -= dy / d * k * 0.35 * dt; }
          }
        }
        ovx[i] += -ox[i] * 4 * dt; ovy[i] += -oy[i] * 4 * dt; ovx[i] *= 1 - Math.min(1, 3.2 * dt); ovy[i] *= 1 - Math.min(1, 3.2 * dt);
        ox[i] += ovx[i] * dt; oy[i] += ovy[i] * dt;
        // wrap
        if (P.twinkle) continue;
        const m = r[i] * 4 + 20;
        if (y[i] > bot + m || y[i] < top - m) spawn(i, false);
        if (x[i] > W + m) x[i] -= W + 2 * m; else if (x[i] < -m) x[i] += W + 2 * m;
      }
    },
    burst(bx, by) {
      for (let i = 0; i < n; i++) {
        const dx = x[i] + ox[i] - bx, dy = y[i] + oy[i] - by, d = Math.hypot(dx, dy) || 1;
        if (d < R * 2.2) { const f = (1 - d / (R * 2.2)) * 900 * dpr; ovx[i] += dx / d * f; ovy[i] += dy / d * f; }
      }
    },
    draw(ctx, t) {
      const base = ctx.globalAlpha;
      if (!spr) { // rain: one batched stroke
        ctx.strokeStyle = rgba(rgb, 0.32); ctx.lineWidth = Math.max(1, dpr * L.size * 0.9); ctx.beginPath();
        const len = 0.022 * L.size;
        for (let i = 0; i < n; i++) { const px = x[i] + ox[i], py = y[i] + oy[i]; ctx.moveTo(px, py); ctx.lineTo(px - (vx[i] + wind * 3) * len, py - vy[i] * len); }
        ctx.stroke(); return;
      }
      for (let i = 0; i < n; i++) {
        let al = a[i];
        if (P.twinkle) al *= 0.55 + 0.45 * Math.sin(t * (0.8 + (i % 7) * 0.31) + ph[i]);
        if (P.pulse) al *= 0.35 + 0.65 * Math.max(0, Math.sin(t * 1.6 * P.pulse + ph[i] * 3));
        if (P.fade) al *= Math.max(0, Math.min(1, (y[i] - top) / span));
        if (al < 0.01) continue;
        ctx.globalAlpha = base * al;
        const s = r[i] * (P.sprite === 'glow' ? 5 : 2), px = x[i] + ox[i], py = y[i] + oy[i];
        if (P.spin) { ctx.save(); ctx.translate(px, py); ctx.rotate(t * 0.8 + ph[i] * 4); ctx.scale(1, 0.55 + 0.45 * Math.sin(t * 2 + ph[i])); ctx.drawImage(spr, -s, -s / 2, s * 2, s); ctx.restore(); }
        else ctx.drawImage(spr, px - s, py - s, s * 2, s * 2);
      }
      ctx.globalAlpha = base;
    }
  };
}
