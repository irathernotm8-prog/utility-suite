// Dither — starter effects built on the 0.4 toolkit (particles, trails, shockwaves, bolts, flames, Fluid, cycle,
// flash, dissolve, shake). Same rules as fxlib.js: real, editable code that reads well as an example.
'use strict';

const LIB2 = [
  {
    id: 'fireball', name: 'Fireball', group: 'Combat', blurb: 'A looping projectile: a hot core with flames licking back, a dithered trail and embers shed behind it.',
    code: `effect({
  name: 'Fireball', size: [48, 24], frames: 8, fps: 14, loop: true, seed: 3,
  palette: [...RAMPS.fire, '#1b0f1f'],
  draw(g, { t, f }) {
    // the tail: flames laid on their side, pointing left (drawn upright, then the canvas is rotated by hand below)
    for (let i = 0; i < 26; i++) { const x = 30 - i, w = Math.max(0, 9 - i * 0.33), wob = Math.sin((i * 0.7) - t * Math.PI * 2 * 2) * (i * 0.08);
      for (let y = -w; y <= w; y++) { const lvl = 1 - i / 26 - Math.abs(y) / (w + 1) * 0.6; if (lvl > 0.1) g.ditherPx(x, 12 + y + wob, RAMPS.fire[Math.min(6, Math.floor((1 - lvl) * 7))], Math.min(1, lvl * 1.8)); } }
    // embers drift off the back and fall slightly
    g.particles({ x: 26, y: 12, emit: 'stream', count: 14, angle: [Math.PI * 0.85, Math.PI * 1.15], speed: [10, 22], life: [0.5, 1], gravity: 3, colors: 'fire', seed: 5 }, t);
    // the core: a bright ball with a pulsing rim
    const r = 6 + (f % 2);
    g.fillCircle(32, 12, r, RAMPS.fire[3]).fillCircle(32, 12, r - 2, RAMPS.fire[1]).fillCircle(33, 11, r - 4, RAMPS.fire[0]);
  }
})`,
  },
  {
    id: 'meteor-impact', name: 'Meteor impact', group: 'Combat', blurb: 'A rock streaks in, the screen flashes and shakes, a squashed shockwave runs along the ground and debris flies.',
    code: `effect({
  name: 'Meteor impact', size: [96, 64], frames: 22, fps: 16, loop: false, seed: 11,
  palette: [...RAMPS.fire, ...RAMPS.smoke, '#2b1d14'],
  holds: [1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
  draw(g, { f, n, range, ease, shake }) {
    const fall = range(f, 0, 5), hit = f >= 5, a = range(f, 5, n - 1);
    if (!hit) {
      const x = 10 + ease.inQuad(fall) * 38, y = -6 + ease.inQuad(fall) * 56;
      g.trail((u) => [10 + ease.inQuad(u) * 38, -6 + ease.inQuad(u) * 56], fall, { length: 0.5, colors: 'fire', width: 5 });
      g.fillCircle(x, y, 3, '#2b1d14').px(x - 1, y - 1, RAMPS.fire[2]);
      return;
    }
    if (f === 5) { g.clear(RAMPS.fire[0]); return; }                                         // the white frame
    g.shockwave(48, 56, 4 + ease.outCubic(a) * 44, { thickness: 4, squash: 0.28, colors: [RAMPS.fire[0], RAMPS.fire[2], RAMPS.fire[4]], breakup: a * 0.6, fade: a > 0.6 ? (a - 0.6) * 2 : 0 });
    g.glow(48, 54, 18 * (1 - a) + 2, [RAMPS.fire[0], RAMPS.fire[1], RAMPS.fire[3]], 1 - a * 0.7);
    g.particles({ x: 48, y: 54, count: 26, angle: [Math.PI * 1.05, Math.PI * 1.95], speed: [16, 44], life: [0.6, 1], gravity: 34, drag: 1.5, colors: ['#2b1d14', '#2b1d14', RAMPS.smoke[3]], shape: 'square', size: [0.5, 1.4], seed: 2 }, a);
    g.particles({ x: 48, y: 52, count: 18, angle: [Math.PI * 1.1, Math.PI * 1.9], speed: [6, 20], life: [0.7, 1], gravity: -10, drag: 3, colors: 'smoke', shape: 'dot', size: [2, 4], grow: 0.8, seed: 9 }, a);
    const [dx, dy] = shake(Math.round(5 * (1 - a) ** 2)); g.shift(dx, dy);
  }
})`,
  },
  {
    id: 'portal', name: 'Portal', group: 'Magic', blurb: 'A looping swirl: spiral arms cycled through the arcane ramp, a rim that shimmers and motes pulled inward.',
    code: `effect({
  name: 'Portal', size: [48, 64], frames: 12, fps: 12, loop: true, seed: 8, palette: 'arcane',
  draw(g, { t, cx, cy, TAU, bayer }) {
    for (let y = 0; y < 64; y++) for (let x = 0; x < 48; x++) {
      const dx = (x - cx) / 18, dy = (y - cy) / 28, d = Math.sqrt(dx * dx + dy * dy); if (d > 1) continue;
      const a = Math.atan2(dy, dx), arm = (Math.sin(a * 3 + d * 9 - t * TAU) + 1) / 2, v = arm * (1 - d * 0.55) + (1 - d) * 0.35;
      g.px(x, y, d > 0.86 ? 6 : v > 0.78 ? 5 : v > 0.55 ? 4 : v > 0.38 ? 3 : v > 0.22 ? 2 : 1);
    }
    g.cycle([6, 5, 6, 7], Math.floor(t * 4));                                                // the rim shimmers
    g.particles({ x: cx, y: cy, emit: 'stream', count: 16, radius: 30, speed: [0, 0], wind: [0, 0], life: [0.6, 1], colors: [6, 5, 4], seed: 4, fade: true }, t);
  }
})`,
  },
  {
    id: 'shield-bubble', name: 'Shield bubble', group: 'Magic', blurb: 'A looping energy shield: a dithered dome, a bright rim, a highlight and hex shimmer sweeping across it.',
    code: `effect({
  name: 'Shield bubble', size: [48, 48], frames: 12, fps: 12, loop: true, seed: 2, palette: 'energy',
  draw(g, { t, cx, cy, TAU, bayer }) {
    const R = 21;
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
      const dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy) / R; if (d > 1) continue;
      const edge = Math.pow(d, 4), sweep = Math.max(0, 1 - Math.abs(((x + y) / 96) - t) * 7), hex = ((x + (y % 6 < 3 ? 3 : 0)) % 6 === 0 || y % 6 === 0) ? 0.25 : 0;
      const v = edge * 0.9 + sweep * 0.5 * (0.4 + hex * 2.4);
      if (bayer(x, y) < v) g.px(x, y, v > 0.85 ? 1 : v > 0.55 ? 2 : 3);
    }
    g.ring(cx, cy, R, 1, 2);
    g.fillEllipse(cx - 9, cy - 11, 3, 2, 0).px(cx - 5, cy - 14, 1);                          // the glint
  }
})`,
  },
  {
    id: 'level-up', name: 'Level up', group: 'Feedback', blurb: 'Light pillars rise, a golden ring bursts out, sparkles stream up and LEVEL UP pops in with a bounce.',
    code: `effect({
  name: 'Level up', size: [64, 64], frames: 20, fps: 16, loop: false, seed: 6,
  palette: [...RAMPS.holy, '#ffffff', '#1a1c2c'],
  draw(g, { f, n, range, ease }) {
    const t = f / (n - 1);
    const rise = range(t, 0, 0.5), fade = range(t, 0.7, 1);
    for (const [x, w] of [[20, 2], [32, 4], [44, 2]]) { const top = 60 - ease.outCubic(rise) * 56; for (let y = Math.round(top); y < 60; y++) g.ditherPx(x, y, RAMPS.holy[1], (1 - fade) * (0.4 + (y - top) / 60)); if (w > 2) g.fillRect(x - 1, Math.round(top), 3, 60 - Math.round(top), RAMPS.holy[0]); }
    const ring = range(t, 0.1, 0.55); if (ring > 0 && ring < 1) g.shockwave(32, 58, 4 + ease.outCubic(ring) * 28, { thickness: 3, squash: 0.3, colors: [RAMPS.holy[0], RAMPS.holy[2], RAMPS.holy[4]], fade: ring > 0.6 ? (ring - 0.6) * 2.5 : 0 });
    g.particles({ x: 32, y: 58, count: 30, area: [40, 4], angle: [-Math.PI * 0.55, -Math.PI * 0.45], speed: [20, 48], life: [0.5, 0.9], spread: 0.4, start: 0.05, colors: [RAMPS.holy[0], RAMPS.holy[2], RAMPS.holy[3]], shape: 'spark', streak: 0.06, seed: 3 }, t);
    const pop = range(t, 0.3, 0.6); if (pop > 0) { const s = pop < 1 ? Math.max(1, Math.round(ease.outBack(pop) * 2)) : 2, w = g.textWidth('LEVEL UP', s), y = 20 - Math.round(ease.outBack(pop) * 4);
      g.text('LEVEL UP', 32 - w / 2 + 1, y + 1, 7, s).text('LEVEL UP', 32 - w / 2, y, f % 4 < 2 && pop >= 1 ? 6 : 1, s); if (fade) g.dissolve(fade, { seed: 2, scale: 3 }); }
  }
})`,
  },
  {
    id: 'tornado', name: 'Tornado', group: 'Elements', blurb: 'A looping funnel of banded wind, dust whipped round the base and debris orbiting the column.',
    code: `effect({
  name: 'Tornado', size: [48, 64], frames: 12, fps: 14, loop: true, seed: 12,
  palette: [...RAMPS.smoke, '#6b4a2a'],
  draw(g, { t, TAU, lnoise }) {
    for (let y = 2; y < 60; y++) {
      const u = y / 60, w = 3 + (1 - u) ** 1.6 * 16, sway = Math.sin(u * 4 + t * TAU) * 3 * (1 - u);
      for (let x = Math.floor(-w); x <= Math.ceil(w); x++) {
        const a = x / w, band = Math.sin(a * 2.2 + y * 0.45 - t * TAU * 2) * 0.5 + 0.5, n = lnoise(x / 4, y / 6, t, 1.2);
        const v = (1 - a * a) * 0.55 + band * 0.35 + (n - 0.5) * 0.5; if (v < 0.35) continue;
        g.px(24 + x + sway, y, v > 0.85 ? 1 : v > 0.65 ? 2 : v > 0.5 ? 3 : 4);
      }
    }
    for (let i = 0; i < 6; i++) { const a = t * TAU * 2 + i * 1.05, y = 12 + i * 8, r = 6 + (1 - y / 60) * 14; if (Math.sin(a) > -0.2) g.fillRect(24 + Math.cos(a) * r, y + Math.sin(a) * 2, 2, 1, 6); }
    g.particles({ x: 24, y: 60, emit: 'stream', count: 22, area: [30, 2], angle: [Math.PI * 1.1, Math.PI * 1.9], speed: [3, 10], life: [0.4, 0.8], colors: [3, 4, 5], shape: 'dot', size: [0.5, 1.5], seed: 1 }, t);
  }
})`,
  },
  {
    id: 'ice-shatter', name: 'Ice shatter', group: 'Elements', blurb: 'A crystal flashes, cracks and bursts into tumbling shards that fall, with frost mist and glints.',
    code: `effect({
  name: 'Ice shatter', size: [64, 64], frames: 18, fps: 16, loop: false, seed: 14, palette: 'frost',
  holds: [2, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  draw(g, { f, n, range, ease, rnd }) {
    const t = f / (n - 1);
    if (f < 3) { g.poly([[32, 14], [44, 32], [32, 50], [20, 32]], 3).poly([[32, 14], [44, 32], [32, 32]], 4).line(32, 18, 32, 46, 5);
      if (f >= 1) g.line(26, 26, 34, 34, 6).line(34, 34, 30, 44, 6).line(34, 34, 40, 30, 6); if (f === 1) g.flash(7, 0.6); return; }
    const a = range(t, 0.12, 1);
    g.particles({ x: 32, y: 32, count: 16, radius: 8, speed: [14, 34], life: [0.8, 1], gravity: 30, drag: 1.2, colors: [6, 5, 4, 3], shape: 'square', size: [1, 2.2], grow: -0.6, seed: 4 }, a);
    g.particles({ x: 32, y: 32, count: 24, speed: [6, 30], life: [0.5, 1], drag: 2, colors: [7, 6, 5], shape: 'spark', streak: 0.08, seed: 6 }, a);
    g.particles({ x: 32, y: 36, count: 14, radius: 10, speed: [2, 8], life: [0.8, 1], gravity: -6, colors: [5, 4, 3], shape: 'dot', size: [2, 3.5], grow: 0.6, seed: 8 }, a);
    if (a < 0.25) g.shockwave(32, 32, 6 + a * 60, { thickness: 2, colors: [7, 6] });
  }
})`,
  },
  {
    id: 'poison-cloud', name: 'Poison cloud', group: 'Elements', blurb: 'A toxic cloud from the fluid simulation (warmed up first, so it plays as a near-seamless loop), with rising bubbles.',
    code: `effect({
  name: 'Poison cloud', size: [64, 48], frames: 16, fps: 12, loop: true, seed: 5,
  palette: [...RAMPS.poison, '#b04fd1'],
  setup({ Fluid }) {
    const fl = new Fluid(64, 48, { scale: 2, buoyancy: 0.08, cooling: 0.02, fade: 0.035, turbulence: 0.6 });
    const feed = (fl, i) => { fl.add(32 + Math.sin(i * 0.4) * 10, 40, 7, { density: 0.35, heat: 0.4, vx: Math.cos(i * 0.7) * 0.6 }); };
    fl.warm(60, feed); return { fl, feed, i: 60 };
  },
  draw(g, { t, state }) {
    state.feed(state.fl, state.i++); state.fl.step();
    g.fluid(state.fl, [1, 2, 3, 4, 5], { threshold: 0.12 });
    g.particles({ x: 32, y: 42, emit: 'stream', count: 8, area: [36, 6], angle: [-Math.PI / 2, -Math.PI / 2], speed: [8, 18], life: [0.4, 0.7], colors: [0, 1, 6], shape: 'dot', size: [0.6, 1.4], seed: 3 }, t);
  }
})`,
  },
  {
    id: 'smoke-puff', name: 'Smoke puff', group: 'Environment', blurb: 'A soft puff for landings, poofs and vanishing: dots that grow, drift up and thin out by dithering.',
    code: `effect({
  name: 'Smoke puff', size: [48, 40], frames: 14, fps: 16, loop: false, seed: 7, palette: [...RAMPS.smoke],
  draw(g, { f, n }) {
    const t = f / (n - 1);
    g.particles({ x: 24, y: 30, count: 14, radius: 4, angle: [Math.PI * 1.05, Math.PI * 1.95], speed: [8, 18], life: [0.75, 1], drag: 3, gravity: -6, colors: [1, 2, 3, 4], shape: 'dot', size: [2.5, 4.5], grow: 0.7, seed: 4 }, t);
    g.particles({ x: 24, y: 32, count: 10, angle: [Math.PI * 0.9, Math.PI * 1.1], speed: [14, 20], life: [0.6, 0.8], drag: 4, colors: [0, 1, 2], shape: 'dot', size: [1.5, 2.5], grow: 0.4, seed: 2 }, t);
    g.particles({ x: 24, y: 32, count: 10, angle: [-Math.PI * 0.1, Math.PI * 0.1], speed: [14, 20], life: [0.6, 0.8], drag: 4, colors: [0, 1, 2], shape: 'dot', size: [1.5, 2.5], grow: 0.4, seed: 5 }, t);
  }
})`,
  },
  {
    id: 'dust-landing', name: 'Dust landing', group: 'Environment', blurb: 'Two low dust waves kick out from the feet with a few pebbles; sits under a character that just landed.',
    code: `effect({
  name: 'Dust landing', size: [64, 24], frames: 10, fps: 18, loop: false, seed: 9, palette: ['#e9dcc3', '#c7b28e', '#9a8466', '#6b5a46'],
  draw(g, { f, n, ease }) {
    const t = f / (n - 1);
    for (const dir of [-1, 1]) g.particles({ x: 32 + dir * 3, y: 20, count: 9, area: [4, 2], angle: dir < 0 ? [Math.PI * 1.02, Math.PI * 1.25] : [-Math.PI * 0.25, -Math.PI * 0.02], speed: [12, 26], life: [0.7, 1], drag: 4, gravity: 2, colors: [0, 1, 2, 3], shape: 'dot', size: [1, 2.5], grow: 0.6, seed: dir < 0 ? 1 : 2 }, t);
    g.particles({ x: 32, y: 21, count: 5, angle: [Math.PI * 1.2, Math.PI * 1.8], speed: [8, 14], life: [0.6, 0.9], gravity: 16, colors: [3], seed: 4, fade: false }, t);
    if (t < 0.3) g.line(26 - t * 20, 21, 38 + t * 20, 21, 1);
  }
})`,
  },
  {
    id: 'water-splash', name: 'Water splash', group: 'Environment', blurb: 'A crown of droplets, a ring on the surface and a column that collapses back down.',
    code: `effect({
  name: 'Water splash', size: [48, 48], frames: 14, fps: 16, loop: false, seed: 4, palette: ['#ffffff', '#a5ecff', '#5cc8f0', '#2f8fc4', '#22598c'],
  draw(g, { f, n, ease, range }) {
    const t = f / (n - 1);
    const col = range(t, 0, 0.6), h = Math.sin(col * Math.PI) * 16; if (col > 0 && col < 1) g.fillEllipse(24, 40 - h / 2, 2, h / 2, 2).fillRect(24, 40 - h, 1, h * 0.6, 0);
    g.particles({ x: 24, y: 40, count: 16, angle: [Math.PI * 1.15, Math.PI * 1.85], speed: [14, 26], life: [0.7, 1], gravity: 34, colors: [0, 1, 2], shape: 'dot', size: [0.6, 1.4], seed: 3 }, t);
    g.shockwave(24, 41, 3 + ease.outCubic(t) * 18, { thickness: 2, squash: 0.25, colors: [1, 3], fade: t > 0.5 ? (t - 0.5) * 2 : 0 });
  }
})`,
  },
  {
    id: 'waterfall', name: 'Waterfall loop', group: 'Environment', blurb: 'A seamless waterfall tile: streaks scrolled with palette cycling, foam at the base and mist.',
    code: `effect({
  name: 'Waterfall loop', size: [32, 64], frames: 8, fps: 12, loop: true, seed: 1, palette: ['#ffffff', '#a5ecff', '#5cc8f0', '#2f8fc4', '#22598c', '#173357'],
  draw(g, { t, f, pnoise }) {
    for (let y = 0; y < 56; y++) for (let x = 4; x < 28; x++) {
      const n = pnoise(x / 1.7, y / 8 - f, 1e9, 8);                 // the streaks scroll down one noise cell a frame
      g.px(x, y, n > 0.78 ? 1 : n > 0.55 ? 2 : n > 0.3 ? 3 : 4);
      if (x === 4 || x === 27) g.px(x, y, 5);
    }
    g.cycle([1, 2, 3, 2], f);                                       // a little shimmer on top of the scroll
    g.particles({ x: 16, y: 57, emit: 'stream', count: 26, area: [24, 2], angle: [Math.PI * 1.15, Math.PI * 1.85], speed: [3, 9], life: [0.3, 0.7], colors: [0, 1, 2], shape: 'dot', size: [1, 2.5], seed: 5 }, t);
    g.fillRect(2, 58, 28, 6, 3).dither(2, 57, 28, 2, 1, 0.5);
  }
})`,
  },
  {
    id: 'lava-pool', name: 'Lava pool', group: 'Environment', blurb: 'A looping lava tile: cells banded through the fire ramp and moved by palette cycling, with bubbles.',
    code: `effect({
  name: 'Lava pool', size: [48, 32], frames: 8, fps: 8, loop: true, seed: 6, palette: [...RAMPS.fire],
  setup({ noise }) {
    const cells = []; for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) { const v = noise(x / 6, y / 4) * 0.7 + noise(x / 2, y / 2, 3) * 0.3; cells.push(Math.min(7, Math.floor(v * 8))); } return { cells };
  },
  draw(g, { t, f, state }) {
    const ring = [0, 1, 2, 3, 4, 3, 2, 1];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) g.px(x, y, ring[(state.cells[y * 48 + x] + f) % 8]);
    g.particles({ x: 24, y: 16, emit: 'stream', count: 5, area: [40, 24], speed: [0, 0], life: [0.25, 0.4], colors: [0, 0, 1], shape: 'dot', size: [1, 2], grow: 0.8, seed: 2 }, t);
  }
})`,
  },
  {
    id: 'torch', name: 'Torch flame', group: 'Elements', blurb: 'A small looping torch built on g.flames: periodic noise, so it loops with no seam, plus a few sparks.',
    code: `effect({
  name: 'Torch flame', size: [16, 32], frames: 10, fps: 12, loop: true, seed: 2, palette: [...RAMPS.fire, '#5a3a24', '#3b2414'],
  draw(g, { t }) {
    g.flames(3, 4, 10, 18, t, { scale: 3, turbulence: 1 });
    g.particles({ x: 8, y: 10, emit: 'stream', count: 4, angle: [-Math.PI * 0.6, -Math.PI * 0.4], speed: [6, 10], life: [0.4, 0.6], colors: [0, 1, 2], seed: 3 }, t);
    g.fillRect(6, 21, 4, 11, 7).fillRect(5, 20, 6, 2, 8).px(6, 22, 8);
  }
})`,
  },
  {
    id: 'electric-arc', name: 'Electric arc', group: 'Elements', blurb: 'A looping arc between two nodes: a new bolt every frame, with forks, sparks and a glow on each end.',
    code: `effect({
  name: 'Electric arc', size: [64, 32], frames: 8, fps: 16, loop: true, seed: 3, palette: 'energy',
  draw(g, { f, t }) {
    g.glow(6, 16, 6, [1, 2, 3]).glow(58, 16, 6, [1, 2, 3]);
    g.bolt(6, 16, 58, 16, { seed: f * 7 + 1, jag: 0.35, branches: f % 3, colors: [0, 2, 3] });
    if (f % 2) g.bolt(6, 16, 58, 16, { seed: f * 13 + 5, jag: 0.5, colors: [3], width: 1 });
    g.fillCircle(6, 16, 2, 0).fillCircle(58, 16, 2, 0);
    g.particles({ x: 32, y: 16, emit: 'stream', count: 10, area: [44, 6], speed: [3, 7], life: [0.2, 0.4], colors: [0, 1, 2], seed: 9 }, t);
  }
})`,
  },
  {
    id: 'healing-aura', name: 'Healing aura', group: 'Feedback', blurb: 'A looping aura for buffs: motes rise in a stream, a ground ellipse pulses and the edges twinkle.',
    code: `effect({
  name: 'Healing aura', size: [48, 64], frames: 16, fps: 12, loop: true, seed: 7, palette: ['#f4ffbf', '#cdf56a', '#8fdc3a', '#4fa52a', '#2f6b1c'],
  draw(g, { t, TAU }) {
    const p = (Math.sin(t * TAU) + 1) / 2;
    g.shockwave(24, 56, 14 + p * 2, { thickness: 2, squash: 0.3, colors: [1, 3] });
    g.particles({ x: 24, y: 56, emit: 'stream', count: 22, area: [26, 4], angle: [-Math.PI / 2, -Math.PI / 2], speed: [30, 46], life: [0.6, 1], wind: [0, 0], colors: [0, 1, 2, 3], seed: 2 }, t);
    g.particles({ x: 24, y: 56, emit: 'stream', count: 6, area: [20, 4], angle: [-Math.PI / 2, -Math.PI / 2], speed: [24, 36], life: [0.7, 1], colors: [0, 1, 2], shape: 'spark', streak: 0.08, seed: 5 }, t);
  }
})`,
  },
  {
    id: 'confetti', name: 'Confetti burst', group: 'Feedback', blurb: 'A celebratory pop: squares and streamers in every colour fly up, flutter and drift down.',
    code: `effect({
  name: 'Confetti burst', size: [64, 64], frames: 24, fps: 18, loop: false, seed: 10, palette: 'sweetie16',
  draw(g, { f, n }) {
    const t = f / (n - 1);
    for (const [c, s] of [[[2, 3], 1], [[4, 5], 2], [[9, 10], 3], [[11, 12], 4], [[1, 3], 5]])
      g.particles({ x: 32, y: 56, count: 12, angle: [Math.PI * 1.25, Math.PI * 1.75], speed: [40, 62], life: [0.85, 1], drag: 2.4, gravity: 26, wind: [Math.sin(s + f * 0.6) * 4, 0], colors: c.concat(c), shape: (f + s) % 3 ? 'square' : 'px', size: [0.6, 1.1], fade: true, seed: s }, t);
  }
})`,
  },
  {
    id: 'teleport', name: 'Teleport', group: 'Magic', blurb: 'A figure dissolves upward with a burning edge into a beam of light, which then narrows and fades.',
    code: `effect({
  name: 'Teleport', size: [32, 48], frames: 18, fps: 16, loop: false, seed: 4, palette: [...RAMPS.magic, '#3b5dc9', '#e8b796', '#1a1c2c'],
  draw(g, { f, n, range, ease }) {
    const t = f / (n - 1), d = range(t, 0.1, 0.65), beam = range(t, 0.35, 1);
    // a stand-in figure (blit your own sprite here)
    g.fillRect(12, 20, 8, 14, 6).fillCircle(15.5, 15, 4, 7).fillRect(12, 34, 3, 8, 8).fillRect(17, 34, 3, 8, 8).px(14, 14, 8).px(17, 14, 8);
    if (d > 0) g.dissolve(d * 1.15, { seed: 3, scale: 3, edge: [0, 1, 2], width: 0.1 });
    if (beam > 0) { const w = Math.max(0, Math.round((1 - ease.inCubic(beam)) * 7)); for (let y = 0; y < 44; y++) for (let x = 16 - w; x <= 16 + w; x++) g.ditherPx(x, y, Math.abs(x - 16) < w * 0.4 ? 0 : 2, (1 - Math.abs(x - 16) / (w + 1)) * (1 - beam * 0.6));
      g.particles({ x: 16, y: 42, count: 16, area: [12, 2], angle: [-Math.PI / 2, -Math.PI / 2], speed: [20, 40], life: [0.5, 0.9], colors: [0, 1, 2], shape: 'spark', streak: 0.06, seed: 6 }, beam); }
  }
})`,
  },
  {
    id: 'magic-circle', name: 'Magic circle', group: 'Magic', blurb: 'A looping summoning circle seen at an angle: rings, rotating runes and a pulse of light.',
    code: `effect({
  name: 'Magic circle', size: [64, 32], frames: 16, fps: 12, loop: true, seed: 1, palette: 'arcane',
  draw(g, { t, TAU, cx }) {
    const cy = 16, sq = 0.45, P = (Math.sin(t * TAU) + 1) / 2;
    g.shockwave(cx, cy, 28, { thickness: 1, squash: sq, colors: [5] }).shockwave(cx, cy, 24, { thickness: 1, squash: sq, colors: [4] }).shockwave(cx, cy, 13, { thickness: 1, squash: sq, colors: [4] });
    for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + t * TAU / 5, b = (k + 2) / 5 * TAU + t * TAU / 5; g.line(cx + Math.cos(a) * 24, cy + Math.sin(a) * 24 * sq, cx + Math.cos(b) * 24, cy + Math.sin(b) * 24 * sq, 3); }
    for (let k = 0; k < 12; k++) { const a = k / 12 * TAU - t * TAU / 3, x = cx + Math.cos(a) * 26, y = cy + Math.sin(a) * 26 * sq; g.px(x, y, 6).px(x + 1, y, k % 2 ? 6 : 5); }
    g.glow(cx, cy, 8 + P * 6, [6, 5, 4], 0.6 + P * 0.3);
  }
})`,
  },
  {
    id: 'snowfall', name: 'Snowfall', group: 'Environment', blurb: 'A seamless snow tile in three depths: big slow flakes in front, small fast ones behind, all drifting.',
    code: `effect({
  name: 'Snowfall', size: [64, 64], frames: 24, fps: 12, loop: true, seed: 3, palette: ['#ffffff', '#d7e8f5', '#9fb6cc'],
  draw(g, { t }) {
    // a stream wraps every particle within the loop, and wind/speed are whole canvas heights so the tile tiles too
    for (const [n, c, sp, sz, s] of [[40, 2, 64, 0, 1], [26, 1, 64, 0, 2], [12, 0, 64, 0.8, 3]])
      g.particles({ x: 32, y: -2, emit: 'stream', count: n, area: [64, 2], angle: [Math.PI / 2, Math.PI / 2], speed: [sp, sp], life: [1, 1], wind: [8, 0], colors: [c], shape: sz ? 'dot' : 'px', size: sz, fade: false, seed: s }, t);
  }
})`,
  },
  {
    id: 'campfire-smoke', name: 'Campfire with smoke', group: 'Elements', blurb: 'Seamless flames plus a smoke plume from the fluid simulation that bends in a light wind (the smoke loops near-seamlessly).',
    code: `effect({
  name: 'Campfire with smoke', size: [48, 80], frames: 16, fps: 12, loop: true, seed: 2, palette: [...RAMPS.fire, ...RAMPS.smoke.slice(1), '#4a2e1c'],
  setup({ Fluid }) { const fl = new Fluid(48, 64, { scale: 2, buoyancy: 0.3, fade: 0.03, wind: 1.2, turbulence: 0.5 }); fl.warm(80, (fl) => fl.add(24, 60, 4, { density: 0.55, heat: 0.6 })); return { fl }; },
  draw(g, { t, state }) {
    state.fl.add(24, 60, 4, { density: 0.55, heat: 0.6 }); state.fl.step();
    g.fluid(state.fl, RAMPS.smoke.slice(1, 5), { threshold: 0.1 });
    g.flames(14, 52, 20, 22, t, { scale: 4 });
    g.fillRect(10, 74, 28, 3, 12).fillRect(14, 72, 20, 2, 12);
  }
})`,
  },
];

module.exports = { LIB2 };
