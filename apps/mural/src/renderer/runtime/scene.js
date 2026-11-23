// Mural — draws a layered scene onto one canvas. Built to be cheap:
//  • runs of layers that never move are flattened into one cached bitmap, redrawn only when the time of day or the
//    clock text changes (about once a minute);
//  • layers that shift with the cursor keep their own cached bitmap and are only moved, never redrawn;
//  • only particles, waves, video and click effects draw every frame, with pre-rendered sprites instead of blur;
//  • frame() says whether anything is still moving, so a still scene stops drawing entirely.
import { KINDS, normalizeScene } from './schema.js';
import { whenWeight } from './sun.js';
import { createParticles } from './particles.js';
import { hexToRgb, rgba, mix } from './color.js';
export { hexToRgb, rgba, mix };

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;


// ------------------------------------------------------------------------------------------------- noise for hills
function rng(seed) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function noise1(seed, n = 256) { const r = rng(seed); const v = Array.from({ length: n + 1 }, r); v[n] = v[0]; return (x) => { const i = Math.floor(x) % n, f = x - Math.floor(x), u = f * f * (3 - 2 * f); const a = v[(i + n) % n], b = v[(i + 1 + n) % n]; return a + (b - a) * u; }; }

const FONTS = {
  system: '-apple-system, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Segoe UI Variable Display", "Nunito", system-ui, sans-serif',
  serif: 'ui-serif, "New York", "Iowan Old Style", Georgia, serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace',
  condensed: '"Avenir Next Condensed", "Bahnschrift", "Arial Narrow", sans-serif'
};

export function fillText(tpl, now = new Date()) {
  const h = now.getHours();
  const greet = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
  return String(tpl || '')
    .replace(/\{time\}/g, now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
    .replace(/\{time24\}/g, String(h).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'))
    .replace(/\{seconds\}/g, String(now.getSeconds()).padStart(2, '0'))
    .replace(/\{date\}/g, now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }))
    .replace(/\{day\}/g, now.toLocaleDateString([], { weekday: 'long' }))
    .replace(/\{greeting\}/g, greet);
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, h | 0));
  const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c;
}

/** Fit a source of sw×sh into box bx,by,bw,bh. */
function fitRect(fit, sw, sh, bx, by, bw, bh) {
  if (fit === 'stretch' || !sw || !sh) return [bx, by, bw, bh];
  const s = fit === 'contain' ? Math.min(bw / sw, bh / sh) : Math.max(bw / sw, bh / sh);
  const w = sw * s, h = sh * s; return [bx + (bw - w) / 2, by + (bh - h) / 2, w, h];
}

// -------------------------------------------------------------------------------------------- static layer painters
// Each paints the layer at full opacity into ctx (W×H), given the sky. Used for caches (and directly for previews).
const PAINT = {
  sky(ctx, L, W, H, R) {
    const ph = R.sky.phases;
    const c = (k) => hexToRgb(L[k]);
    let top = [0, 0, 0], bot = [0, 0, 0];
    for (const p of ['night', 'dawn', 'day', 'dusk']) { const w = ph[p]; const t = c(p + 'Top'), b = c(p + 'Bottom'); top = top.map((v, i) => v + t[i] * w); bot = bot.map((v, i) => v + b[i] * w); }
    const hz = H * L.horizon;
    const g = ctx.createLinearGradient(0, 0, 0, hz); g.addColorStop(0, rgba(top)); g.addColorStop(1, rgba(bot));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = rgba(bot); ctx.fillRect(0, hz, W, H - hz);
    const sunR = Math.min(W, H) * L.sunSize;
    const pos = (frac, alt) => [W * clamp(frac, -0.2, 1.2), hz - (alt / 70) * hz * 0.95];
    if (L.sun && R.sky.altitude > -4) {
      const [x, y] = pos(R.sky.dayFrac, R.sky.altitude);
      const warm = 1 - clamp(R.sky.altitude / 25);
      const col = mix([255, 250, 230], [255, 160, 90], warm);
      const halo = ctx.createRadialGradient(x, y, 0, x, y, sunR * 7);
      halo.addColorStop(0, rgba(col, 0.55)); halo.addColorStop(0.25, rgba(col, 0.18)); halo.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = rgba(col, 1); ctx.beginPath(); ctx.arc(x, y, sunR, 0, TAU); ctx.fill();
    }
    if (L.moon && ph.night + ph.dusk * 0.5 + ph.dawn * 0.5 > 0.2) {
      const moonAlt = -R.sky.altitude; const [x, y] = pos((R.sky.dayFrac + 0.5) % 1, Math.max(8, moonAlt));
      const a = clamp(ph.night + (ph.dawn + ph.dusk) * 0.4);
      const r = sunR * 0.8;
      const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 6); halo.addColorStop(0, `rgba(200,215,255,${0.22 * a})`); halo.addColorStop(1, 'rgba(200,215,255,0)');
      ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(236,240,255,${0.95 * a})`; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba(top, 0.9 * a); ctx.beginPath(); ctx.arc(x + r * 0.42, y - r * 0.18, r * 0.86, 0, TAU); ctx.fill();
    }
  },
  gradient(ctx, L, W, H) {
    let g;
    if (L.style === 'radial') g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
    else { const a = (L.angle - 90) * Math.PI / 180, r = Math.hypot(W, H) / 2, cx = W / 2, cy = H / 2; g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    g.addColorStop(0, rgba(hexToRgb(L.from))); if (L.via) g.addColorStop(0.5, rgba(hexToRgb(L.via))); g.addColorStop(1, rgba(hexToRgb(L.to)));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  },
  image(ctx, L, W, H, R) {
    const img = R.assets.get(L.src); if (!img || !img.width) return;
    const [x, y, w, h] = fitRect(L.fit, img.naturalWidth || img.width, img.naturalHeight || img.height, L.x * W, L.y * H, L.w * W, L.h * H);
    ctx.drawImage(img, x, y, w, h);
  },
  hills(ctx, L, W, H, R, ext = {}) {
    const X0 = ext.x0 ?? 0, X1 = ext.x1 ?? W, YB = ext.y1 ?? H;
    const ph = R.sky.phases; let col = hexToRgb(L.color);
    if (L.nightColor) col = mix(col, hexToRgb(L.nightColor), clamp(ph.night + 0.5 * (ph.dawn + ph.dusk)));
    const base = H * L.base, amp = H * (0.05 + 0.25 * L.rough), n = noise1(L.seed | 0), n2 = noise1((L.seed | 0) + 101);
    ctx.fillStyle = rgba(col);
    const step = Math.max(2, W / 600);
    if (L.style === 'skyline') {
      const r = rng(L.seed | 0); let x = X0 - 10; const lit = clamp(L.lightsOn) * clamp(1 - R.sky.daylight * 1.2 + 0.15);
      const lc = hexToRgb(L.lights); const unit = Math.max(4, W / 320);
      while (x < X1 + 10) {
        const bw = unit * (6 + r() * 14), bh = amp * (0.4 + r() * 1.6) + H * 0.04; const top = base - bh + amp * 0.6;
        ctx.fillStyle = rgba(col); ctx.fillRect(x, top, bw - unit * 0.6, YB - top);
        if (r() > 0.75) ctx.fillRect(x + bw * 0.4, top - unit * 3, unit * 0.6, unit * 3);
        if (lit > 0.01) {
          ctx.fillStyle = rgba(lc, 0.85 * lit);
          for (let wy = top + unit * 1.5; wy < YB - unit; wy += unit * 2.2) for (let wx = x + unit; wx < x + bw - unit * 1.6; wx += unit * 1.8) if (r() < 0.32) ctx.fillRect(wx, wy, unit * 0.8, unit * 1.1);
        }
        x += bw;
      }
      return;
    }
    ctx.beginPath(); ctx.moveTo(X0, YB);
    const f = L.style === 'mountains' ? 3.2 : L.style === 'dunes' ? 1.4 : 2;
    for (let x = X0; x <= X1 + step; x += step) {
      const u = (x + W * 8) / W * f;
      let y;
      if (L.style === 'mountains') { let v = 0, a = 1, fr = 1; for (let o = 0; o < 5; o++) { v += a * (1 - Math.abs(n(u * fr + o * 17) * 2 - 1)); a *= 0.5; fr *= 2.1; } y = base - amp * (v / 1.9 - 0.3) * 1.6; }
      else if (L.style === 'dunes') { const s = Math.sin(u * 3 + n(u) * 4); y = base - amp * (0.5 + 0.5 * Math.sign(s) * Math.pow(Math.abs(s), 0.7)) * 0.7 - amp * 0.3 * n2(u * 2); }
      else { y = base - amp * (n(u) * 0.7 + n2(u * 2.3) * 0.3); }
      ctx.lineTo(x, y);
    }
    ctx.lineTo(X1 + step, YB); ctx.closePath(); ctx.fill();
    if (L.style === 'forest') {
      const r = rng((L.seed | 0) + 7); const th = amp * 0.5;
      for (let x = X0; x < X1; x += Math.max(3, W / 260) * (0.6 + r())) {
        const u = (x + W * 8) / W * f, y = base - amp * (n(u) * 0.7 + n2(u * 2.3) * 0.3), h = th * (0.5 + r()), w = h * 0.32;
        ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + w, y + 2); ctx.lineTo(x - w, y + 2); ctx.closePath(); ctx.fill();
      }
    }
  },
  glow(ctx, L, W, H, R) {
    let x = L.x * W, y = L.y * H, col = hexToRgb(L.color);
    if (L.sun) { const hz = H * 0.72; x = W * R.sky.dayFrac; y = hz - (R.sky.altitude / 70) * hz * 0.95; col = mix(col, [255, 140, 80], 1 - clamp(R.sky.altitude / 25)); if (R.sky.altitude < -6) return; }
    const r = L.r * Math.max(W, H);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(col, L.strength)); g.addColorStop(0.4, rgba(col, L.strength * 0.35)); g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  },
  text(ctx, L, W, H, R) {
    const s = fillText(L.text, R.now()); if (!s) return;
    const px = Math.max(6, L.size * H);
    ctx.font = `${L.weight} ${px}px ${FONTS[L.font] || FONTS.system}`;
    try { ctx.letterSpacing = (L.spacing * px) + 'px'; } catch (_) {}
    ctx.textAlign = L.align; ctx.textBaseline = 'middle'; ctx.fillStyle = L.color;
    if (L.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = px * 0.25; ctx.shadowOffsetY = px * 0.04; }
    const lines = s.split('\\n').join('\n').split('\n');
    lines.forEach((ln, i) => ctx.fillText(ln, L.x * W, L.y * H + (i - (lines.length - 1) / 2) * px * 1.15));
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  },
  shape(ctx, L, W, H) {
    const x = L.x * W, y = L.y * H, w = L.w * W, h = L.h * H; ctx.fillStyle = L.fill; ctx.strokeStyle = L.fill;
    if (L.shape === 'box') { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, L.radius * Math.min(W, H)) : ctx.rect(x, y, w, h); ctx.fill(); }
    else { ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, TAU); if (L.shape === 'ring') { ctx.lineWidth = L.line * Math.min(W, H); ctx.stroke(); } else ctx.fill(); }
  }
};

/** The cache key that, when it changes, means a static layer must be repainted. */
function paintKey(L, R) {
  const ph = R.sky.phases, q = (v) => Math.round(v * 50);
  switch (L.kind) {
    case 'sky': return `${q(ph.night)}|${q(ph.dawn)}|${q(ph.dusk)}|${Math.round(R.sky.altitude * 2)}|${Math.round(R.sky.dayFrac * 400)}`;
    case 'hills': return L.nightColor || L.style === 'skyline' ? `${q(ph.night)}|${q(ph.dawn + ph.dusk)}|${q(R.sky.daylight)}` : '';
    case 'glow': return L.sun ? `${Math.round(R.sky.altitude * 2)}|${Math.round(R.sky.dayFrac * 400)}` : '';
    case 'text': return fillText(L.text, R.now());
    case 'image': { const a = R.assets.get(L.src); return a && a.width ? 'ok' : 'wait'; }
    default: return '';
  }
}

// ------------------------------------------------------------------------------------------------------ the scene
export class Scene {
  /** opts: { resolve(src) -> url, transparent, now() -> Date } */
  constructor(canvas, scene, opts = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: !!opts.transparent });
    this.opts = opts; this.transparent = !!opts.transparent;
    this.def = normalizeScene(scene);
    this.W = 1; this.H = 1; this.dpr = 1;
    this.assets = new Map(); this.videos = [];
    this.sky = { phases: { night: 0, dawn: 0, day: 1, dusk: 0 }, altitude: 45, azimuth: 180, dayFrac: 0.5, daylight: 1, morning: false };
    this.pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, inside: false, moved: 0 };
    this.effects = []; this.systems = new Map(); this.plan = null; this.dirty = true; this.t = 0;
    this.R = { sky: this.sky, assets: this.assets, now: opts.now || (() => new Date()) };
  }
  get layers() { return this.def.layers; }

  async load() {
    const jobs = [];
    for (const L of this.def.layers) {
      if (L.kind === 'image' && L.src && !this.assets.has(L.src)) {
        const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async';
        this.assets.set(L.src, img);
        jobs.push(new Promise((res) => { img.onload = () => { this.dirty = true; res(); }; img.onerror = () => res(); img.src = this.opts.resolve ? this.opts.resolve(L.src) : L.src; }));
      }
      if (L.kind === 'video' && L.src && !this.assets.has(L.src)) {
        const v = document.createElement('video'); v.muted = true; v.loop = true; v.playsInline = true; v.crossOrigin = 'anonymous'; v.preload = 'auto';
        v.src = this.opts.resolve ? this.opts.resolve(L.src) : L.src; v.playbackRate = L.speed || 1;
        this.assets.set(L.src, v); this.videos.push(v);
        jobs.push(new Promise((res) => { v.oncanplay = () => res(); v.onerror = () => res(); setTimeout(res, 4000); }));
        v.play().catch(() => {});
      }
    }
    await Promise.all(jobs);
    this.plan = null;
  }

  /** Replace the scene (Studio edits) without reloading what's already loaded. */
  async update(scene) { this.def = normalizeScene(scene); this.plan = null; this.systems.clear(); this.dirty = true; await this.load(); }

  resize(cssW, cssH, dpr) {
    const W = Math.max(1, Math.round(cssW * dpr)), H = Math.max(1, Math.round(cssH * dpr));
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H; this.dpr = dpr; this.canvas.width = W; this.canvas.height = H;
    this.plan = null; this.systems.clear(); this.dirty = true;
  }
  setSky(sky) { Object.assign(this.sky, sky); this.R.sky = this.sky; this.dirty = true; }
  setPointer(x, y, inside = true) { this.pointer.tx = x; this.pointer.ty = y; this.pointer.inside = inside; this.pointer.moved = this.t; }
  click(x, y) {
    const e = this.def.effects, col = hexToRgb(e.clickColor);
    if (e.click === 'ripple') this.effects.push({ kind: 'ripple', x, y, t0: this.t, life: 1.4, col });
    if (e.click === 'shockwave') this.effects.push({ kind: 'shock', x, y, t0: this.t, life: 0.9, col });
    if (e.click === 'sparkle') { const parts = Array.from({ length: 28 }, () => { const a = Math.random() * TAU, s = 0.08 + Math.random() * 0.25; return { a, s, r: 0.6 + Math.random() }; }); this.effects.push({ kind: 'sparkle', x, y, t0: this.t, life: 1.1, col, parts }); }
    for (const sys of this.systems.values()) sys.burst(x * this.W, y * this.H);
  }

  /** Decide how to draw: flatten runs of still layers into one bitmap, keep moving ones separate. */
  build() {
    const live = (L) => KINDS[L.kind].animated || (L.motion && L.motion !== 'none') || L.depth > 0 || (L.kind === 'glow' && L.follow) || (L.kind === 'text' && /\{seconds\}/.test(L.text));
    const plan = []; let run = null;
    for (const L of this.def.layers) {
      if (L.hidden) continue;
      if (live(L)) { run = null; plan.push({ live: true, layer: L, cache: null, key: null }); }
      else { if (!run) { run = { live: false, layers: [], cache: null, key: null }; plan.push(run); } run.layers.push(L); }
    }
    this.plan = plan;
  }

  layerAlpha(L) { return clamp(L.opacity) * whenWeight(L.when, this.sky.phases); }

  ensureCache(item, W, H) {
    if (!item.cache || item.cache.width !== W || item.cache.height !== H) { item.cache = makeCanvas(W, H); item.key = null; }
  }

  /** Paint group bitmaps whose content changed (time of day, clock text, a picture finishing loading). */
  refreshStatic() {
    const { W, H } = this;
    for (const item of this.plan) {
      if (!item.live) {
        const key = item.layers.map((L) => paintKey(L, this.R) + '@' + this.layerAlpha(L).toFixed(2)).join(';');
        this.ensureCache(item, W, H);
        if (item.key === key) continue;
        const c = item.cache.getContext('2d'); c.clearRect(0, 0, W, H);
        for (const L of item.layers) { const a = this.layerAlpha(L); if (a < 0.005) continue; c.globalAlpha = a; c.globalCompositeOperation = L.blend || 'source-over'; PAINT[L.kind](c, L, W, H, this.R); }
        c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
        item.key = key; this.dirty = true;
      } else if (PAINT[item.layer.kind] && !KINDS[item.layer.kind].animated && !(item.layer.kind === 'glow' && item.layer.follow) && !(item.layer.kind === 'text' && /\{seconds\}/.test(item.layer.text))) {
        // a still layer that only moves (depth / motion): cached with a margin so moving it never shows an edge
        const L = item.layer, m = this.margin(L), cw = Math.round(W * (1 + 2 * m)), ch = Math.round(H * (1 + 2 * m));
        const key = paintKey(L, this.R);
        this.ensureCache(item, cw, ch);
        if (item.key === key) continue;
        const c = item.cache.getContext('2d'); c.clearRect(0, 0, cw, ch);
        c.save(); c.translate(W * m, H * m); PAINT[L.kind](c, L, W, H, this.R, { x0: -W * m, x1: W * (1 + m), y1: H * (1 + m) }); c.restore();
        if (m > 0 && (L.kind === 'sky' || L.kind === 'gradient' || L.kind === 'image')) this.bleed(c, cw, ch, W * m, H * m, W, H);
        item.key = key; item.margin = m; this.dirty = true;
      }
    }
  }
  margin(L) { return L.depth > 0 || (L.motion && L.motion !== 'none') ? 0.06 * Math.max(L.depth, L.motion !== 'none' ? L.motionAmount : 0) + 0.01 : 0; }
  /** Stretch the edge pixels into the margin so a full-screen layer never shows a gap when it shifts. */
  bleed(c, cw, ch, mx, my, W, H) {
    const src = c.canvas || c;
    c.drawImage(src, mx, my, 1, H, 0, my, mx, H); c.drawImage(src, mx + W - 1, my, 1, H, mx + W, my, cw - mx - W, H);
    c.drawImage(src, 0, my, cw, 1, 0, 0, cw, my); c.drawImage(src, 0, my + H - 1, cw, 1, 0, my + H, cw, ch - my - H);
  }

  /** Transform for a layer's depth (cursor parallax) and motion. */
  place(ctx, L, t) {
    const { W, H } = this; const p = this.pointer;
    let dx = 0, dy = 0, rot = 0, sc = 1, aMul = 1;
    if (L.depth > 0) { dx = -(p.x - 0.5) * L.depth * W * 0.06; dy = -(p.y - 0.5) * L.depth * H * 0.06; }
    const sp = L.motionSpeed || 1, am = L.motionAmount || 0;
    switch (L.motion) {
      case 'drift': dx += Math.sin(t * 0.07 * sp) * am * W * 0.05; break;
      case 'float': dy += Math.sin(t * 0.5 * sp) * am * H * 0.02; dx += Math.cos(t * 0.31 * sp) * am * W * 0.006; break;
      case 'sway': rot = Math.sin(t * 0.6 * sp) * am * 0.04; break;
      case 'pulse': sc = 1 + Math.sin(t * 1.2 * sp) * am * 0.04; aMul = 1 - am * 0.25 + Math.sin(t * 1.2 * sp) * am * 0.25; break;
      case 'spin': rot = t * 0.05 * sp * (0.2 + am); break;
    }
    if (rot || sc !== 1) { ctx.translate(W / 2 + dx, H / 2 + dy); ctx.rotate(rot); ctx.scale(sc, sc); ctx.translate(-W / 2, -H / 2); }
    else ctx.translate(dx, dy);
    return aMul;
  }

  /** Draw one frame. Returns true while something is still moving (the caller keeps the loop going). */
  frame(t, dt) {
    this.t = t;
    if (!this.plan) this.build();
    const { W, H } = this; const ctx = this.ctx; const p = this.pointer;
    // ease the pointer so depth feels smooth; stop once it has settled
    const ease = 1 - Math.exp(-dt * 6);
    const pdx = p.tx - p.x, pdy = p.ty - p.y; p.x += pdx * ease; p.y += pdy * ease;
    const settling = Math.abs(pdx) + Math.abs(pdy) > 0.0008;
    this.refreshStatic();
    let moving = settling;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (this.transparent) ctx.clearRect(0, 0, W, H); else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
    for (const item of this.plan) {
      if (!item.live) { if (item.cache) ctx.drawImage(item.cache, 0, 0); continue; }
      const L = item.layer; const a = this.layerAlpha(L); if (a < 0.005) continue;
      ctx.save(); ctx.globalCompositeOperation = L.blend || 'source-over';
      const aMul = this.place(ctx, L, t); ctx.globalAlpha = clamp(a * aMul);
      if (L.motion && L.motion !== 'none') moving = true;
      if (item.cache) { const m = item.margin || 0; ctx.drawImage(item.cache, -W * m, -H * m); }
      else moving = this.drawLive(ctx, L, t, dt) || moving;
      ctx.restore();
    }
    moving = this.drawEffects(ctx, t) || moving;
    this.dirty = false;
    return moving;
  }

  drawLive(ctx, L, t, dt) {
    const { W, H } = this;
    switch (L.kind) {
      case 'particles': {
        let sys = this.systems.get(L.id);
        if (!sys || sys.sig !== sigOf(L)) { sys = createParticles(L, W, H); sys.sig = sigOf(L); this.systems.set(L.id, sys); }
        const p = this.pointer;
        sys.step(dt, t, p.inside ? p.x * W : -1e5, p.inside ? p.y * H : -1e5);
        sys.draw(ctx, t);
        return true;
      }
      case 'waves': {
        const col = hexToRgb(L.color), crest = hexToRgb(L.crest), n = Math.max(1, L.count | 0), step = Math.max(4, W / 240);
        for (let i = 0; i < n; i++) {
          const k = i / Math.max(1, n - 1), y0 = H * L.y + (H * (1 - L.y)) * Math.pow(k, 1.4) * 0.85, amp = H * L.amp * (0.6 + k * 0.8), ph = t * L.speed * (0.5 + k * 0.4) + i * 1.7;
          ctx.beginPath(); ctx.moveTo(0, H);
          for (let x = 0; x <= W + step; x += step) { const u = x / W * TAU; ctx.lineTo(x, y0 + Math.sin(u * (2 + i) + ph) * amp + Math.sin(u * (5 + i) - ph * 1.3) * amp * 0.35); }
          ctx.lineTo(W, H); ctx.closePath();
          ctx.fillStyle = rgba(mix(col, [0, 0, 0], k * 0.35), 0.75 + k * 0.25); ctx.fill();
          ctx.strokeStyle = rgba(crest, 0.35 * (1 - k * 0.6)); ctx.lineWidth = Math.max(1, H * 0.0015); ctx.stroke();
        }
        return true;
      }
      case 'video': {
        const v = this.assets.get(L.src); if (!v || v.readyState < 2) return true;
        const [x, y, w, h] = fitRect(L.fit, v.videoWidth, v.videoHeight, L.x * W, L.y * H, L.w * W, L.h * H); ctx.drawImage(v, x, y, w, h); return true;
      }
      case 'glow': {
        const p = this.pointer; if (L.follow && !p.inside) return false;
        const g = { ...L }; if (L.follow) { g.x = p.x; g.y = p.y; }
        PAINT.glow(ctx, g, W, H, this.R); return false;
      }
      case 'text': PAINT.text(ctx, L, W, H, this.R); return true;
      default: if (PAINT[L.kind]) PAINT[L.kind](ctx, L, W, H, this.R); return false;
    }
  }

  drawEffects(ctx, t) {
    const { W, H } = this; const e = this.def.effects; const p = this.pointer; let moving = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    if (e.cursorGlow && p.inside) {
      const col = hexToRgb(e.cursorColor), r = Math.min(W, H) * 0.22, x = p.x * W, y = p.y * H;
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(col, 0.28)); g.addColorStop(1, rgba(col, 0)); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    const S = Math.min(W, H);
    this.effects = this.effects.filter((f) => t - f.t0 < f.life);
    for (const f of this.effects) {
      const k = (t - f.t0) / f.life, x = f.x * W, y = f.y * H; moving = true;
      if (f.kind === 'ripple') {
        ctx.lineWidth = Math.max(1, S * 0.003);
        for (let i = 0; i < 3; i++) { const kk = k - i * 0.12; if (kk <= 0) continue; ctx.strokeStyle = rgba(f.col, 0.5 * (1 - kk) * (1 - i * 0.25)); ctx.beginPath(); ctx.arc(x, y, S * 0.16 * Math.sqrt(kk), 0, TAU); ctx.stroke(); }
      } else if (f.kind === 'shock') {
        ctx.lineWidth = S * 0.012 * (1 - k); ctx.strokeStyle = rgba(f.col, 0.6 * (1 - k)); ctx.beginPath(); ctx.arc(x, y, S * 0.3 * (1 - Math.pow(1 - k, 3)), 0, TAU); ctx.stroke();
        if (k < 0.2) { const g = ctx.createRadialGradient(x, y, 0, x, y, S * 0.15); g.addColorStop(0, rgba(f.col, 0.3 * (1 - k / 0.2))); g.addColorStop(1, rgba(f.col, 0)); ctx.fillStyle = g; ctx.fillRect(x - S * 0.15, y - S * 0.15, S * 0.3, S * 0.3); }
      } else if (f.kind === 'sparkle') {
        ctx.fillStyle = rgba(f.col, 1 - k);
        for (const q of f.parts) { const d = q.s * S * (1 - Math.pow(1 - k, 2)); const px = x + Math.cos(q.a) * d, py = y + Math.sin(q.a) * d + k * k * S * 0.08; const r = Math.max(0.8, S * 0.0035 * q.r * (1 - k)); ctx.fillRect(px - r, py - r, r * 2, r * 2); }
      }
    }
    return moving;
  }

  stats() { let n = 0; for (const s of this.systems.values()) n += s.count; return { particles: n, caches: (this.plan || []).filter((i) => i.cache).length }; }
  pauseMedia() { for (const v of this.videos) v.pause(); }
  resumeMedia() { for (const v of this.videos) v.play().catch(() => {}); }
  destroy() { this.pauseMedia(); for (const v of this.videos) { v.removeAttribute('src'); v.load(); } this.videos = []; this.assets.clear(); this.systems.clear(); this.plan = null; }
}

const sigOf = (L) => [L.preset, L.count, L.color, L.size, L.speed, L.wind, L.cursor, L.top, L.bottom].join('|');
