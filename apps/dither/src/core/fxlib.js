// Dither — starter effects. Each is real, editable effect code: a reference for Claude, a starting point for drafts,
// and a quick way to see the drawing kit in use. Keep them readable; they double as examples in the guide.
'use strict';

const LIB = [
  {
    id: 'pickup-sparkle', name: 'Pickup sparkle', group: 'Feedback', blurb: 'Coin or item collect: a pop, a twinkle and sparks that fade by dithering.',
    code: `effect({
  name: 'Pickup sparkle', size: [32, 32], frames: 14, fps: 18, palette: 'pico8', loop: false, seed: 4,
  holds: [1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  params: { sparks: { value: 8, min: 4, max: 14, step: 1 }, reach: { value: 12, min: 6, max: 15, step: 1 } },
  setup({ params, rnd, TAU }) {
    return { sparks: Array.from({ length: params.sparks }, (_, i) => ({ a: i / params.sparks * TAU + rnd(-0.2, 0.2), d: rnd(0.65, 1), big: i % 2 === 0 })) };
  },
  draw(g, { f, n, cx, cy, ease, range, state, params }) {
    const t = f / (n - 1);
    // 1-2: a hard white pop, then the gold body
    if (f === 0) { g.fillCircle(cx, cy, 2, 7); return; }
    if (f === 1) { g.fillCircle(cx, cy, 4, 10).fillCircle(cx, cy, 2, 7); }
    // a four-point star that grows, then thins to a cross and shrinks away
    const st = range(t, 0.08, 0.75);
    if (st > 0 && st < 1) {
      const L = Math.round(3 + Math.sin(st * Math.PI) * 8), core = st < 0.45 ? 7 : 10, edge = st < 0.45 ? 10 : 9;
      g.line(cx - L, cy, cx + L, cy, edge).line(cx, cy - L, cx, cy + L, edge);
      if (st < 0.6) { g.line(cx - L + 2, cy, cx + L - 2, cy, core).line(cx, cy - L + 2, cx, cy + L - 2, core); g.fillRect(cx - 1, cy - 1, 3, 3, core); }
      const D = Math.round(L * 0.45); if (st < 0.7) g.line(cx - D, cy - D, cx + D, cy + D, 9).line(cx - D, cy + D, cx + D, cy - D, 9).px(cx, cy, 7);
    }
    // a thin ring that races out and breaks up
    const rg = range(t, 0.1, 0.5);
    if (rg > 0 && rg < 1) for (let a = 0; a < 6.283; a += 0.07) { const r = 4 + ease.outCubic(rg) * 11; g.ditherPx(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rg < 0.5 ? 10 : 9, 1.25 - rg); }
    // sparks fly out with a short trail, ease to a stop and blink out
    const sp = range(t, 0.12, 1);
    if (sp > 0) for (const s of state.sparks) {
      const d = 3 + ease.outQuart(sp) * params.reach * s.d, x = Math.round(cx + Math.cos(s.a) * d), y = Math.round(cy + Math.sin(s.a) * d + sp * sp * 2);
      if (sp > 0.7 && (f + (s.big ? 1 : 0)) % 2) continue;                        // blink before vanishing
      g.px(x, y, sp < 0.5 ? 7 : 10);
      if (s.big && sp < 0.65) g.px(x + 1, y, 10).px(x - 1, y, 10).px(x, y + 1, 10).px(x, y - 1, 10);
      if (sp < 0.4) g.px(Math.round(x - Math.cos(s.a) * 2), Math.round(y - Math.sin(s.a) * 2), 9);
    }
  }
})`,
  },
  {
    id: 'explosion', name: 'Explosion', group: 'Combat', blurb: 'Flash frame, a fireball shaded from the fire ramp, rolling smoke and debris.',
    code: `effect({
  name: 'Explosion', size: [48, 48], frames: 18, fps: 14, palette: 'ember', loop: false, seed: 11,
  holds: [1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
  params: { size: { value: 15, min: 8, max: 20, step: 1 }, debris: { value: 10, min: 0, max: 20, step: 1 } },
  setup({ params, rnd, TAU }) {
    return {
      puffs: [{ a: 0, d: 0, r: 0.62, rise: 1.3 }, ...Array.from({ length: 7 }, (_, i) => ({ a: i / 7 * TAU + rnd(-0.3, 0.3), d: rnd(0.35, 0.75), r: rnd(0.45, 0.62), rise: rnd(0.6, 1.2) }))],
      debris: Array.from({ length: params.debris }, () => ({ a: rnd(TAU), v: rnd(0.8, 1.4), up: rnd(4, 9) })),
    };
  },
  draw(g, { f, n, w, h, cx, cy, ease, range, state, params, noise, bayer }) {
    const t = f / (n - 1), S = params.size, by = cy + 5;
    if (f === 0) { g.fillCircle(cx, by, 4, 7); return; }                                    // white-hot flash
    if (f === 1) { g.fillCircle(cx, by, 11, 6).fillCircle(cx, by, 8, 7); return; }
    const grow = ease.outCubic(range(t, 0.08, 0.5)), fade = range(t, 0.3, 1);
    // one density field from overlapping puffs, so the cloud reads as one mass
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let dens = 0;
      for (const p of state.puffs) {
        const d = S * p.d * (0.35 + grow * 0.85), px = cx + Math.cos(p.a) * d, py = by + Math.sin(p.a) * d * 0.65 - fade * 9 * p.rise;
        const r = S * p.r * (0.55 + grow * 0.55);
        dens = Math.max(dens, 1 - Math.hypot(x - px, y - py) / r);
      }
      if (dens <= 0) continue;
      const nz = noise(x * 0.18, y * 0.18 + f * 0.25, f * 0.15);
      // erode from the edges as it dies: a dithered threshold that rises over time
      if (dens + nz * 0.25 < fade * 0.95 + bayer(x, y) * 0.22) continue;
      const heat = dens * 1.15 + nz * 0.3 - fade * 1.25 + (1 - grow) * 0.3;
      g.px(x, y, heat > 0.95 ? 7 : heat > 0.72 ? 6 : heat > 0.5 ? 5 : heat > 0.3 ? 4 : heat > 0.12 ? 3 : heat > -0.1 ? 2 : 1);
    }
    // debris arcs
    for (const d of state.debris) {
      const k = range(t, 0.06, 0.85); if (k <= 0 || k >= 1) continue;
      const x = cx + Math.cos(d.a) * S * 1.4 * d.v * ease.outQuad(k), y = by + Math.sin(d.a) * S * 0.9 * d.v * ease.outQuad(k) - d.up * Math.sin(k * Math.PI) + k * k * 6;
      g.px(x, y, k < 0.45 ? 6 : 4); if (k < 0.35) g.px(x, y + 1, 4);
    }
  }
})`,
  },
  {
    id: 'slash', name: 'Sword slash', group: 'Combat', blurb: 'A crescent smear with a hot leading edge that thins and breaks into specks.',
    code: `effect({
  name: 'Sword slash', size: [48, 40], frames: 9, fps: 20, palette: 'pico8', loop: false, seed: 3,
  holds: [1, 1, 1, 2, 1, 1, 1, 1, 1],
  params: { radius: { value: 16, min: 10, max: 19, step: 1 }, sweep: { value: 2.4, min: 1.2, max: 3.2, step: 0.1 } },
  draw(g, { f, n, cx, cy, ease, range, params }) {
    const t = f / (n - 1), R = params.radius, start = -2.7;
    const head = start + params.sweep * ease.outCubic(range(t, 0, 0.4) * 0.9 + 0.1);
    const tail = start + params.sweep * ease.inQuad(range(t, 0.2, 1));
    if (head - tail < 0.02) return;
    const thick = 6 * (1 - range(t, 0.35, 1)) + 1;
    for (let a = tail; a <= head; a += 0.01) {
      const k = (a - tail) / (head - tail);                 // 0 at the tail, 1 at the leading edge
      const w = Math.max(1, thick * Math.pow(Math.sin(k * Math.PI * 0.92 + 0.12), 0.8));
      for (let i = 0; i < w; i++) {
        const r = R - i, x = cx + Math.cos(a) * r, y = cy + 4 + Math.sin(a) * r * 0.85;
        const col = i < 1 ? 7 : i < w * 0.45 ? 6 : 13;          // white edge, light body, cool falloff
        g.ditherPx(x, y, col, k < 0.3 ? k / 0.3 + 0.05 : 1);
      }
    }
    // specks shed by the fading tail
    if (t > 0.4) for (let i = 0; i < 6; i++) { const a = tail - 0.12 - i * 0.13, r = R + 1 + (i % 3) * 2; if ((i + f) % 3) g.px(cx + Math.cos(a) * r, cy + 4 + Math.sin(a) * r * 0.85, t < 0.7 ? 7 : 6); }
  }
})`,
  },
  {
    id: 'fire-loop', name: 'Campfire flame', group: 'Elements', blurb: 'A seamless looping flame: noise scrolled upward and banded into the fire ramp.',
    code: `effect({
  name: 'Campfire flame', size: [24, 32], frames: 16, fps: 12, palette: 'ember', loop: true, seed: 8,
  params: { height: { value: 0.85, min: 0.5, max: 1, step: 0.05 }, flicker: { value: 0.35, min: 0, max: 0.8, step: 0.05 } },
  draw(g, { t, w, h, noise, params, TAU }) {
    const cx = (w - 1) / 2, base = h - 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const up = (base - y) / (h * params.height);           // 0 at the base, 1 at the top
      if (up < -0.08) continue;
      const spread = 1 - Math.abs(x - cx) / (w * 0.42) - up * 0.75;
      // loop: sample noise around a circle so frame n meets frame 0
      const a = t * TAU, n1 = noise(x * 0.32 + Math.cos(a) * 1.5, y * 0.22 + t * 6, Math.sin(a) * 1.5);
      const heat = spread * 1.25 + n1 * params.flicker * 1.6 - up * 0.45 - 0.15;
      if (heat <= 0.08) continue;
      const col = heat > 0.9 ? 7 : heat > 0.68 ? 6 : heat > 0.48 ? 5 : heat > 0.3 ? 4 : heat > 0.17 ? 3 : 2;
      g.px(x, y, col);
    }
    // logs
    g.line(cx - 7, base + 1, cx + 6, base - 1, 1).line(cx - 6, base + 2, cx + 7, base + 2, 1).line(cx - 6, base - 1, cx + 7, base + 1, 1);
    // an ember that leaves the flame each loop
    const e = (t * 2) % 1; g.ditherPx(cx + Math.sin(t * TAU * 2) * 3, base - 10 - e * 16, 6, 1.2 - e);
  }
})`,
  },
  {
    id: 'lightning', name: 'Lightning strike', group: 'Elements', blurb: 'A jagged bolt with branches, a full-bright strike frame, then a flickering afterglow.',
    code: `effect({
  name: 'Lightning strike', size: [40, 64], frames: 12, fps: 18, palette: 'energy', loop: false, seed: 21,
  holds: [1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 2],
  params: { jag: { value: 4, min: 1, max: 7, step: 1 }, branches: { value: 3, min: 0, max: 5, step: 1 } },
  setup({ w, h, params, rnd, irnd }) {
    const bolt = (x, y, len, dir, jag) => { const pts = [[x, y]]; for (let i = 0; i < len; i++) { y += irnd(3, 5); x += dir * rnd(0.5, 2) + rnd(-jag, jag) * 0.4; pts.push([Math.round(x), y]); } return pts; };
    const main = [[Math.round(w / 2 + rnd(-4, 4)), 0]]; let x = main[0][0], y = 0;
    while (y < h - 6) { y += irnd(3, 6); x += rnd(-params.jag, params.jag); x = Math.max(4, Math.min(w - 5, x)); main.push([Math.round(x), Math.min(h - 6, y)]); }
    const branches = Array.from({ length: params.branches }, () => { const p = main[irnd(2, main.length - 4)]; return bolt(p[0], p[1], irnd(2, 4), rnd() < 0.5 ? -1 : 1, params.jag); });
    return { main, branches };
  },
  draw(g, { f, state, h, rand }) {
    const ground = h - 6, strike = state.main, end = strike[strike.length - 1];
    if (f === 0) { g.polyline(strike.slice(0, Math.ceil(strike.length / 2)), 2); return; }      // the leader feels its way down
    if (f === 1 || f === 2) {                                                                    // the strike
      const big = f === 1;
      for (const [x, y] of strike) g.ditherCircle(x, y, big ? 5 : 3, 4, 0.3);               // dithered halo, no blur
      g.ditherCircle(end[0], ground, big ? 9 : 6, 3, 0.45);
      for (const b of state.branches) g.polyline(b, 2);
      g.polyline(strike.map(([x, y]) => [x - 1, y]), 1).polyline(strike.map(([x, y]) => [x + 1, y]), 1).polyline(strike, 0);
      g.fillEllipse(end[0], ground + 1, big ? 8 : 6, 2, 1).fillEllipse(end[0], ground + 1, 4, 1, 0);
      return;
    }
    // afterglow: the channel flickers dimmer and breaks into pieces
    const k = (f - 3) / 8;
    for (let i = 0; i < strike.length - 1; i++) if (rand() < 0.85 - k * 0.7) g.line(strike[i][0], strike[i][1], strike[i + 1][0], strike[i + 1][1], k < 0.25 ? 1 : k < 0.55 ? 2 : 3);
    if (k < 0.6) g.fillEllipse(end[0], ground + 1, 5 - k * 5, 1, k < 0.3 ? 2 : 3);
    for (let i = 0; i < 4; i++) if (rand() < 0.6 - k * 0.5) g.px(end[0] + Math.round((rand() - 0.5) * 12), ground - Math.round(rand() * 5 * (1 - k)), 2);
  }
})`,
  },
  {
    id: 'heal', name: 'Heal', group: 'Feedback', blurb: 'A ground ring and rising plus signs that bob and fade, ready to sit under a character.',
    code: `effect({
  name: 'Heal', size: [32, 40], frames: 20, fps: 14, palette: 'sweetie16', loop: true, seed: 5,
  params: { pluses: { value: 5, min: 2, max: 9, step: 1 } },
  setup({ params, rnd }) { return { p: Array.from({ length: params.pluses }, (_, i) => ({ x: rnd(-9, 9), o: i / params.pluses, big: i % 2 === 0 })) }; },
  draw(g, { t, w, h, state, TAU }) {
    const cx = (w - 1) / 2, gy = h - 6;
    // a ground ring that breathes, with a dithered pool inside
    const b = 0.5 + 0.5 * Math.sin(t * TAU);
    for (let y = -4; y <= 4; y++) for (let x = -12; x <= 12; x++) { const q = (x * x) / 121 + (y * y) / 9; if (q < 1) g.ditherPx(cx + x, gy + y, 6, (1 - q) * (0.35 + b * 0.3)); }
    g.ellipse(cx, gy, 11 + b, 3 + b * 0.5, 5);
    for (const p of state.p) {
      const k = (t + p.o) % 1, x = Math.round(cx + p.x + Math.sin((k + p.o) * TAU) * 1.5), y = Math.round(gy - 3 - k * (h - 12));
      // fade by stepping colours and shrinking, not by breaking the shape apart
      const c = k < 0.45 ? 12 : k < 0.75 ? 5 : 6; if (k > 0.9) { g.px(x, y, 6); continue; }
      const arm = p.big && k < 0.75 ? 2 : 1;
      for (let i = -arm; i <= arm; i++) { g.px(x + i, y, c); g.px(x, y + i, c); }
      if (k < 0.2) g.px(x, y, 12);
    }
  }
})`,
  },
  {
    id: 'black-hole', name: 'Black hole', group: 'Magic', blurb: 'A looping vortex: spiral arms banded through the arcane palette around a hard black core.',
    code: `effect({
  name: 'Black hole', size: [48, 48], frames: 24, fps: 15, palette: 'arcane', loop: true, seed: 2,
  params: { arms: { value: 3, min: 2, max: 5, step: 1 }, twist: { value: 3.2, min: 1, max: 6, step: 0.1 } },
  draw(g, { t, w, h, params, noise, TAU }) {
    const cx = (w - 1) / 2, cy = (h - 1) / 2, R = w * 0.46;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = (y - cy) * 1.15, d = Math.hypot(dx, dy) / R; if (d > 1) continue;
      const a = Math.atan2(dy, dx), swirl = a * params.arms + d * params.twist * TAU / 2 - t * TAU * params.arms / 2;
      const arm = 0.5 + 0.5 * Math.cos(swirl), n = noise(x * 0.2, y * 0.2, Math.sin(t * TAU) + 2);
      const v = arm * (1 - d) * 1.6 + n * 0.25 - d * 0.35;
      if (v < 0.12) continue;
      g.px(x, y, v > 0.95 ? 6 : v > 0.75 ? 5 : v > 0.55 ? 4 : v > 0.38 ? 3 : v > 0.22 ? 2 : 1);
    }
    g.fillCircle(cx, cy, 5, 0).ring(cx, cy, 6, 1, 7);
    // matter falling in
    for (let i = 0; i < 6; i++) { const k = (t + i / 6) % 1, a = i * 1.7 + k * 4, r = R * (1 - k); g.ditherPx(cx + Math.cos(a) * r, cy + Math.sin(a) * r / 1.15, 6, 1 - k * 0.5); }
  }
})`,
  },
  {
    id: 'rain', name: 'Rain', group: 'Environment', blurb: 'A seamless tile of slanted rain with splashes; set the size to cover your scene.',
    code: `effect({
  name: 'Rain', size: [64, 48], frames: 12, fps: 16, palette: 'frost', loop: true, seed: 9, background: '#0b1626',
  params: { drops: { value: 26, min: 6, max: 60, step: 1 }, slant: { value: 0.35, min: 0, max: 1, step: 0.05 } },
  setup({ params, rnd, irnd, w, h }) { return { d: Array.from({ length: params.drops }, () => ({ x: rnd(w), o: rnd(), len: irnd(3, 5), c: irnd(3, 5) })), s: Array.from({ length: 6 }, () => ({ x: irnd(2, w - 3), o: rnd() })) }; },
  draw(g, { t, w, h, state, params }) {
    for (const d of state.d) {
      const k = (t + d.o) % 1, y = k * (h + 10) - 8, x = ((d.x - k * params.slant * h) % w + w) % w;
      g.line(x, y, x + params.slant * d.len, y + d.len, d.c);
    }
    for (const s of state.s) { const k = (t * 2 + s.o) % 1; if (k < 0.4) { const r = Math.round(k * 7); g.px(s.x - r, h - 3 - (r > 1 ? 1 : 0), 5).px(s.x + r, h - 3 - (r > 1 ? 1 : 0), 5); if (k < 0.15) g.px(s.x, h - 4, 6); } }
  }
})`,
  },
  {
    id: 'impact', name: 'Hit impact', group: 'Combat', blurb: 'A punchy hit spark with a hold on the brightest frame and directional streaks.',
    code: `effect({
  name: 'Hit impact', size: [32, 32], frames: 8, fps: 20, palette: 'pico8', loop: false, seed: 6,
  holds: [1, 3, 1, 1, 1, 1, 1, 1],
  params: { rays: { value: 8, min: 4, max: 12, step: 1 } },
  setup({ params, rnd, TAU }) { return { rays: Array.from({ length: params.rays }, (_, i) => ({ a: i / params.rays * TAU + rnd(-0.2, 0.2), l: rnd(0.6, 1) })) }; },
  draw(g, { f, cx, cy, state, ease }) {
    const k = f / 7;
    if (f === 0) { g.fillCircle(cx, cy, 2, 7); return; }
    if (f === 1) { g.poly([[cx, cy - 11], [cx + 3, cy - 3], [cx + 11, cy], [cx + 3, cy + 3], [cx, cy + 11], [cx - 3, cy + 3], [cx - 11, cy], [cx - 3, cy - 3]], 7); g.fillCircle(cx, cy, 3, 10); return; }
    const r = 4 + ease.outCubic(k) * 10;
    for (const s of state.rays) { const r0 = r * 0.6, r1 = r * s.l + 3 * (1 - k); g.line(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0, cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1, k < 0.5 ? 10 : 9); }
    if (k < 0.6) g.ring(cx, cy, r * 0.55, k < 0.3 ? 2 : 1, k < 0.3 ? 7 : 10);
    if (f === 2) g.fillCircle(cx, cy, 2, 7);
  }
})`,
  },
];

module.exports = { LIB };
