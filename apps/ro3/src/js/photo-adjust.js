// Non-destructive adjustment layers: maths, defaults and the property editors.
const PhotoAdjust = (() => {
  const clamp255 = v => v < 0 ? 0 : v > 255 ? 255 : v;
  const hexRgb = h => { const n = parseInt(String(h || '#000000').slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const lvl = () => ({ inB: 0, inW: 255, gamma: 1, outB: 0, outW: 255 });
  const line = () => [[0, 0], [255, 255]];

  const KINDS = {
    levels:       { name: 'Levels', icon: 'levels', make: () => ({ rgb: lvl(), r: lvl(), g: lvl(), b: lvl() }) },
    curves:       { name: 'Curves', icon: 'curves', make: () => ({ rgb: line(), r: line(), g: line(), b: line() }) },
    brightness:   { name: 'Brightness/Contrast', icon: 'sun', make: () => ({ brightness: 0, contrast: 0 }) },
    exposure:     { name: 'Exposure', icon: 'sun', make: () => ({ exposure: 0, offset: 0, gamma: 1 }) },
    vibrance:     { name: 'Vibrance', icon: 'drop', make: () => ({ vibrance: 0, saturation: 0 }) },
    huesat:       { name: 'Hue/Saturation', icon: 'drop', make: () => ({ hue: 0, sat: 0, light: 0, colorize: false }) },
    colorbalance: { name: 'Color Balance', icon: 'balance', make: () => ({ shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserve: true }) },
    bw:           { name: 'Black & White', icon: 'invert', make: () => ({ reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, tint: false, tintColor: '#e1b77d' }) },
    photofilter:  { name: 'Photo Filter', icon: 'drop', make: () => ({ color: '#ec8a00', density: 25, preserve: true }) },
    gradientmap:  { name: 'Gradient Map', icon: 'gradient', make: () => ({ c1: '#000000', c2: '#ffffff', reverse: false }) },
    invert:       { name: 'Invert', icon: 'invert', make: () => ({}) },
    posterize:    { name: 'Posterize', icon: 'levels', make: () => ({ levels: 4 }) },
    threshold:    { name: 'Threshold', icon: 'invert', make: () => ({ level: 128 }) },
  };
  const ORDER = ['brightness', 'levels', 'curves', 'exposure', 'vibrance', 'huesat', 'colorbalance', 'bw', 'photofilter', 'gradientmap', 'invert', 'posterize', 'threshold'];
  const make = kind => ({ kind, ...KINDS[kind].make() });

  // ---------- lookup tables ----------
  function levelsLut(c) {
    const t = new Uint8ClampedArray(256), span = Math.max(1, c.inW - c.inB), g = 1 / Math.max(0.01, c.gamma);
    for (let i = 0; i < 256; i++) {
      const x = Math.min(1, Math.max(0, (i - c.inB) / span));
      t[i] = c.outB + (c.outW - c.outB) * Math.pow(x, g);
    }
    return t;
  }
  /** Monotone cubic (Fritsch–Carlson) through curve points → 256-entry table. */
  function curveLut(pts) {
    const p = [...pts].sort((a, b) => a[0] - b[0]);
    const t = new Uint8ClampedArray(256);
    if (p.length < 2) { for (let i = 0; i < 256; i++) t[i] = i; return t; }
    const n = p.length, xs = p.map(q => q[0]), ys = p.map(q => q[1]);
    const d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
    }
    let k = 0;
    for (let x = 0; x < 256; x++) {
      if (x <= xs[0]) { t[x] = ys[0]; continue; }
      if (x >= xs[n - 1]) { t[x] = ys[n - 1]; continue; }
      while (k < n - 2 && x > xs[k + 1]) k++;
      const h = xs[k + 1] - xs[k], u = (x - xs[k]) / h, u2 = u * u, u3 = u2 * u;
      t[x] = (2 * u3 - 3 * u2 + 1) * ys[k] + (u3 - 2 * u2 + u) * h * m[k] + (-2 * u3 + 3 * u2) * ys[k + 1] + (u3 - u2) * h * m[k + 1];
    }
    return t;
  }
  function chain(a, b) { const t = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) t[i] = b[a[i]]; return t; }
  const ident = () => { const t = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) t[i] = i; return t; };
  function luts(a) {
    let f;
    switch (a.kind) {
      case 'levels': { const m = levelsLut(a.rgb); return [chain(levelsLut(a.r), m), chain(levelsLut(a.g), m), chain(levelsLut(a.b), m)]; }
      case 'curves': { const m = curveLut(a.rgb); return [chain(curveLut(a.r), m), chain(curveLut(a.g), m), chain(curveLut(a.b), m)]; }
      case 'brightness': {
        const g = Math.pow(2, -a.brightness / 100), k = a.contrast >= 0 ? 1 + a.contrast / 40 : 1 + a.contrast / 100;
        f = i => 128 + (255 * Math.pow(i / 255, g) - 128) * k; break;
      }
      case 'exposure': {
        const mul = Math.pow(2, a.exposure), ig = 1 / Math.max(0.01, a.gamma);
        f = i => { let x = Math.pow(i / 255, 2.2) * mul + a.offset; x = Math.max(0, x); return 255 * Math.pow(Math.pow(x, ig), 1 / 2.2); }; break;
      }
      case 'invert': f = i => 255 - i; break;
      case 'posterize': { const n = Math.max(2, a.levels | 0), s = 255 / (n - 1); f = i => Math.round(Math.round(i / 255 * (n - 1)) * s); break; }
      default: return null;
    }
    const t = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) t[i] = f(i);
    return [t, t, t];
  }

  // ---------- colour helpers ----------
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function hue2(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }
  function hsl2rgb(h, s, l, out) {
    if (s <= 0) { out[0] = out[1] = out[2] = l * 255; return; }
    h = ((h % 360) + 360) % 360 / 360;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    out[0] = hue2(p, q, h + 1 / 3) * 255; out[1] = hue2(p, q, h) * 255; out[2] = hue2(p, q, h - 1 / 3) * 255;
  }

  /** Apply an adjustment to RGBA pixel data in place. Alpha is left alone. */
  function apply(a, d) {
    const L = luts(a);
    const n = d.length;
    if (L) {
      const [R, G, B] = L;
      for (let i = 0; i < n; i += 4) { d[i] = R[d[i]]; d[i + 1] = G[d[i + 1]]; d[i + 2] = B[d[i + 2]]; }
      return;
    }
    const o = [0, 0, 0];
    switch (a.kind) {
      case 'threshold': for (let i = 0; i < n; i += 4) { const v = lum(d[i], d[i + 1], d[i + 2]) >= a.level ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; } return;
      case 'gradientmap': {
        let c1 = hexRgb(a.c1), c2 = hexRgb(a.c2); if (a.reverse) [c1, c2] = [c2, c1];
        const t = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];
        for (let i = 0; i < 256; i++) for (let k = 0; k < 3; k++) t[k][i] = c1[k] + (c2[k] - c1[k]) * i / 255;
        for (let i = 0; i < n; i += 4) { const v = lum(d[i], d[i + 1], d[i + 2]) | 0; d[i] = t[0][v]; d[i + 1] = t[1][v]; d[i + 2] = t[2][v]; }
        return;
      }
      case 'huesat': {
        const sat = a.sat / 100, li = a.light / 100;
        for (let i = 0; i < n; i += 4) {
          let [h, s, l] = rgb2hsl(d[i], d[i + 1], d[i + 2]);
          if (a.colorize) { h = a.hue < 0 ? a.hue + 360 : a.hue; s = Math.max(0, 0.25 + sat * 0.75); }
          else { h += a.hue; s = sat > 0 ? s + (1 - s) * sat * s : s * (1 + sat); }
          l = li > 0 ? l + (1 - l) * li : l * (1 + li);
          hsl2rgb(h, Math.min(1, Math.max(0, s)), l, o);
          d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2];
        }
        return;
      }
      case 'vibrance': {
        const vib = a.vibrance / 100, sat = a.saturation / 100;
        for (let i = 0; i < n; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), avg = (r + g + b) / 3;
          const amt = (sat + vib * (1 - (mx - Math.min(r, g, b)) / 255)) ;
          d[i] = clamp255(r + (r - avg) * amt); d[i + 1] = clamp255(g + (g - avg) * amt); d[i + 2] = clamp255(b + (b - avg) * amt);
        }
        return;
      }
      case 'colorbalance': {
        const S = a.shadows, M = a.midtones, H = a.highlights, k = 0.55;
        for (let i = 0; i < n; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2], l = lum(r, g, b) / 255;
          const ws = (1 - l) * (1 - l), wh = l * l, wm = Math.max(0, 1 - ws - wh);
          const cr = (S[0] * ws + M[0] * wm + H[0] * wh) * k, mg = (S[1] * ws + M[1] * wm + H[1] * wh) * k, yb = (S[2] * ws + M[2] * wm + H[2] * wh) * k;
          let nr = r + cr, ng = g + mg, nb = b + yb;
          if (a.preserve) { const dl = lum(r, g, b) - lum(nr, ng, nb); nr += dl; ng += dl; nb += dl; }
          d[i] = clamp255(nr); d[i + 1] = clamp255(ng); d[i + 2] = clamp255(nb);
        }
        return;
      }
      case 'bw': {
        const w = { r: a.reds / 100, y: a.yellows / 100, g: a.greens / 100, c: a.cyans / 100, b: a.blues / 100, m: a.magentas / 100 };
        const tint = a.tint ? rgb2hsl(...hexRgb(a.tintColor)) : null;
        for (let i = 0; i < n; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          let mx, md, mn, wp, ws;
          if (r >= g && r >= b) { mx = r; if (g >= b) { md = g; mn = b; ws = w.y; } else { md = b; mn = g; ws = w.m; } wp = w.r; }
          else if (g >= r && g >= b) { mx = g; if (r >= b) { md = r; mn = b; ws = w.y; } else { md = b; mn = r; ws = w.c; } wp = w.g; }
          else { mx = b; if (r >= g) { md = r; mn = g; ws = w.m; } else { md = g; mn = r; ws = w.c; } wp = w.b; }
          const v = clamp255(mn + (mx - md) * wp + (md - mn) * ws);
          if (tint) { hsl2rgb(tint[0], tint[1], v / 255, o); d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; }
          else d[i] = d[i + 1] = d[i + 2] = v;
        }
        return;
      }
      case 'photofilter': {
        const c = hexRgb(a.color), k = a.density / 100;
        for (let i = 0; i < n; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          let nr = r + (r * c[0] / 255 * 1.6 - r) * k, ng = g + (g * c[1] / 255 * 1.6 - g) * k, nb = b + (b * c[2] / 255 * 1.6 - b) * k;
          if (a.preserve) { const dl = lum(r, g, b) - lum(nr, ng, nb); nr += dl; ng += dl; nb += dl; }
          d[i] = clamp255(nr); d[i + 1] = clamp255(ng); d[i + 2] = clamp255(nb);
        }
      }
    }
  }

  /** Histogram of RGBA data → {r,g,b,l} Uint32Array(256) */
  function histogram(data) {
    const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) continue;
      r[data[i]]++; g[data[i + 1]]++; b[data[i + 2]]++; l[lum(data[i], data[i + 1], data[i + 2]) | 0]++;
    }
    return { r, g, b, l };
  }
  function drawHistogram(ctx, w, h, arr, color) {
    let mx = 1; const sorted = Array.from(arr).sort((a, b) => b - a); mx = Math.max(1, sorted[2] || sorted[0]);
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, h);
    for (let i = 0; i < 256; i++) ctx.lineTo(i / 255 * w, h - Math.min(1, arr[i] / mx) * h * 0.95);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  }

  // ---------- editors ----------
  const CH = [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']];
  const histArr = (hist, ch) => ch === 'rgb' ? hist.l : hist[ch];
  const histColor = ch => ({ rgb: 'rgba(228,236,231,.28)', r: 'rgba(255,90,90,.4)', g: 'rgba(90,230,120,.4)', b: 'rgba(90,150,255,.45)' }[ch]);

  /**
   * Build the editor for an adjustment.
   * ctx = { adj, hist, onInput(), onCommit(label) }
   */
  function editor(ctx) {
    const a = ctx.adj;
    const wrap = h('<div class="adj-editor stack"></div>');
    const live = () => ctx.onInput();
    const done = () => ctx.onCommit('Edit ' + KINDS[a.kind].name);
    const sl = (label, obj, key, min, max, step = 1, fmt) => {
      const s = slider({ label, min, max, step, value: obj[key], fmt });
      s.input.addEventListener('input', () => { obj[key] = s.get(); live(); });
      s.input.addEventListener('change', done);
      s.input.addEventListener('dblclick', () => { obj[key] = s.get(); live(); done(); });
      return s;
    };
    const col = (label, obj, key) => {
      const c = h(`<label class="field" style="flex:none"><span>${esc(label)}</span><input type="color" value="${obj[key]}"></label>`);
      $('input', c).addEventListener('input', e => { obj[key] = e.target.value; live(); });
      $('input', c).addEventListener('change', done);
      return c;
    };
    const chk = (label, obj, key) => { const c = checkField(label, obj[key]); c.input.addEventListener('change', () => { obj[key] = c.get(); live(); done(); }); return c; };
    const sgn = v => (v > 0 ? '+' : '') + v;
    switch (a.kind) {
      case 'levels': return levelsEditor(ctx, wrap);
      case 'curves': return curvesEditor(ctx, wrap);
      case 'brightness': wrap.append(sl('Brightness', a, 'brightness', -150, 150, 1, sgn), sl('Contrast', a, 'contrast', -50, 100, 1, sgn)); break;
      case 'exposure': wrap.append(sl('Exposure', a, 'exposure', -5, 5, 0.05, v => sgn(+v.toFixed(2))), sl('Offset', a, 'offset', -0.5, 0.5, 0.005, v => sgn(+v.toFixed(3))), sl('Gamma', a, 'gamma', 0.1, 4, 0.01, v => v.toFixed(2))); break;
      case 'vibrance': wrap.append(sl('Vibrance', a, 'vibrance', -100, 100, 1, sgn), sl('Saturation', a, 'saturation', -100, 100, 1, sgn)); break;
      case 'huesat': wrap.append(sl('Hue', a, 'hue', -180, 180, 1, v => sgn(v) + '°'), sl('Saturation', a, 'sat', -100, 100, 1, sgn), sl('Lightness', a, 'light', -100, 100, 1, sgn), chk('Colorize', a, 'colorize')); break;
      case 'colorbalance': {
        let tone = 'midtones';
        const seg = h(`<div class="seg">${[['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']].map(([v, l]) => `<button data-v="${v}" class="${v === tone ? 'on' : ''}">${l}</button>`).join('')}</div>`);
        const box = h('<div class="stack"></div>');
        const paint = () => {
          box.innerHTML = '';
          const arr = a[tone], o = { cr: arr[0], mg: arr[1], yb: arr[2] };
          const mk = (label, k, i) => { const s = slider({ label, min: -100, max: 100, value: o[k], fmt: sgn }); s.input.addEventListener('input', () => { arr[i] = s.get(); live(); }); s.input.addEventListener('change', done); return s; };
          box.append(mk('Cyan ↔ Red', 'cr', 0), mk('Magenta ↔ Green', 'mg', 1), mk('Yellow ↔ Blue', 'yb', 2));
        };
        $$('button', seg).forEach(b => b.addEventListener('click', () => { tone = b.dataset.v; $$('button', seg).forEach(x => x.classList.toggle('on', x === b)); paint(); }));
        paint();
        wrap.append(seg, box, chk('Preserve luminosity', a, 'preserve'));
        break;
      }
      case 'bw': {
        wrap.append(sl('Reds', a, 'reds', -200, 300, 1, v => v + '%'), sl('Yellows', a, 'yellows', -200, 300, 1, v => v + '%'), sl('Greens', a, 'greens', -200, 300, 1, v => v + '%'),
          sl('Cyans', a, 'cyans', -200, 300, 1, v => v + '%'), sl('Blues', a, 'blues', -200, 300, 1, v => v + '%'), sl('Magentas', a, 'magentas', -200, 300, 1, v => v + '%'));
        const row = h('<div class="row" style="align-items:center"></div>'); row.append(chk('Tint', a, 'tint'), col('Tint color', a, 'tintColor'));
        wrap.append(row); break;
      }
      case 'photofilter': { const row = h('<div class="row" style="align-items:flex-end"></div>'); row.append(col('Filter color', a, 'color')); wrap.append(row, sl('Density', a, 'density', 0, 100, 1, v => v + '%'), chk('Preserve luminosity', a, 'preserve')); break; }
      case 'gradientmap': { const row = h('<div class="row" style="align-items:flex-end"></div>'); row.append(col('Shadows', a, 'c1'), col('Highlights', a, 'c2')); wrap.append(row, chk('Reverse', a, 'reverse')); break; }
      case 'posterize': wrap.append(sl('Levels', a, 'levels', 2, 32)); break;
      case 'threshold': wrap.append(sl('Threshold level', a, 'level', 1, 255)); break;
      case 'invert': wrap.append(h('<p class="hint">Inverts every color below this layer. Paint on the layer to limit where it applies.</p>')); break;
    }
    return wrap;
  }

  function levelsEditor(ctx, wrap) {
    const a = ctx.adj;
    let ch = 'rgb';
    const chSel = selectField('Channel', CH, ch);
    const cv = h('<canvas class="adj-hist" width="512" height="200"></canvas>');
    const inRow = h('<div class="lv-row"><input type="range" class="lv lv-b" min="0" max="253"><input type="range" class="lv lv-g" min="0.1" max="9.99" step="0.01"><input type="range" class="lv lv-w" min="2" max="255"></div>');
    const nums = h('<div class="row lv-nums"></div>');
    const nB = numberField('Black', 0, { min: 0, max: 253 }), nG = numberField('Gamma', 1, { min: 0.1, max: 9.99, step: 0.01 }), nW = numberField('White', 255, { min: 2, max: 255 });
    nums.append(nB, nG, nW);
    const outT = h('<div class="field"><span>Output levels</span></div>');
    const outRow = h('<div class="row"></div>');
    const oB = numberField('Black', 0, { min: 0, max: 255 }), oW = numberField('White', 255, { min: 0, max: 255 });
    outRow.append(oB, oW);
    const auto = h(`<button class="btn btn-sm">Auto</button>`);
    const paintHist = () => {
      const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
      if (ctx.hist) drawHistogram(g, cv.width, cv.height, histArr(ctx.hist, ch), histColor(ch));
      const c = a[ch];
      g.strokeStyle = 'rgba(47,214,127,.9)'; g.lineWidth = 2;
      g.beginPath(); for (let i = 0; i < 256; i++) { const x = i / 255 * cv.width, y = cv.height - levelsLut(c)[i] / 255 * cv.height; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    };
    const [rB, rG, rW] = $$('input', inRow);
    const sync = () => {
      const c = a[ch];
      rB.value = c.inB; rW.value = c.inW; rG.value = c.gamma;
      nB.set(c.inB); nW.set(c.inW); nG.set(+c.gamma.toFixed(2)); oB.set(c.outB); oW.set(c.outW);
      paintHist();
    };
    const setv = (k, v, commit) => {
      const c = a[ch];
      if (k === 'inB') v = Math.min(v, c.inW - 2);
      if (k === 'inW') v = Math.max(v, c.inB + 2);
      c[k] = v; sync(); ctx.onInput(); if (commit) ctx.onCommit('Edit Levels');
    };
    rB.addEventListener('input', () => setv('inB', +rB.value)); rB.addEventListener('change', () => ctx.onCommit('Edit Levels'));
    rW.addEventListener('input', () => setv('inW', +rW.value)); rW.addEventListener('change', () => ctx.onCommit('Edit Levels'));
    rG.addEventListener('input', () => setv('gamma', +rG.value)); rG.addEventListener('change', () => ctx.onCommit('Edit Levels'));
    [[nB, 'inB'], [nG, 'gamma'], [nW, 'inW'], [oB, 'outB'], [oW, 'outW']].forEach(([f, k]) => f.input.addEventListener('change', () => setv(k, f.get(), true)));
    chSel.select.addEventListener('change', () => { ch = chSel.get(); sync(); });
    auto.addEventListener('click', () => {
      if (!ctx.hist) return;
      for (const [key, arr] of [['r', ctx.hist.r], ['g', ctx.hist.g], ['b', ctx.hist.b]]) {
        let total = 0; for (let i = 0; i < 256; i++) total += arr[i];
        const cut = total * 0.001; let lo = 0, hi = 255, acc = 0;
        while (lo < 254 && (acc += arr[lo]) < cut) lo++;
        acc = 0; while (hi > lo + 2 && (acc += arr[hi]) < cut) hi--;
        Object.assign(a[key], { inB: lo, inW: hi });
      }
      Object.assign(a.rgb, lvl());
      sync(); ctx.onInput(); ctx.onCommit('Auto Levels');
    });
    const top = h('<div class="row" style="align-items:flex-end"></div>'); top.append(chSel, auto); auto.style.flex = 'none';
    wrap.append(top, cv, inRow, nums, outT, outRow);
    sync();
    return wrap;
  }

  function curvesEditor(ctx, wrap) {
    const a = ctx.adj;
    let ch = 'rgb', drag = -1;
    const chSel = selectField('Channel', CH, ch);
    const reset = h(`<button class="btn btn-sm">Reset channel</button>`);
    const S = 512;
    const cv = h(`<canvas class="adj-curve" width="${S}" height="${S}" tabindex="0"></canvas>`);
    const info = h('<p class="hint">Click to add a point, drag to shape. Drag a point off the graph to remove it.</p>');
    const toPx = ([x, y]) => [x / 255 * S, S - y / 255 * S];
    const fromEv = e => { const r = cv.getBoundingClientRect(); return [Math.round(clamp((e.clientX - r.left) / r.width * 255, 0, 255)), Math.round(clamp((1 - (e.clientY - r.top) / r.height) * 255, 0, 255))]; };
    const paint = () => {
      const g = cv.getContext('2d'); g.clearRect(0, 0, S, S);
      g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
      for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * S / 4, 0); g.lineTo(i * S / 4, S); g.moveTo(0, i * S / 4); g.lineTo(S, i * S / 4); g.stroke(); }
      if (ctx.hist) drawHistogram(g, S, S, histArr(ctx.hist, ch), histColor(ch));
      g.strokeStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(0, S); g.lineTo(S, 0); g.stroke();
      if (ch !== 'rgb') { const t = curveLut(a.rgb); g.strokeStyle = 'rgba(255,255,255,.25)'; g.beginPath(); for (let i = 0; i < 256; i++) { const [x, y] = toPx([i, t[i]]); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
      const t = curveLut(a[ch]);
      g.strokeStyle = { rgb: '#e4ece7', r: '#ff6b6b', g: '#5cf08a', b: '#6aa5ff' }[ch]; g.lineWidth = 3;
      g.beginPath(); for (let i = 0; i < 256; i++) { const [x, y] = toPx([i, t[i]]); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
      a[ch].forEach(p => { const [x, y] = toPx(p); g.fillStyle = '#000'; g.strokeStyle = '#2fd67f'; g.lineWidth = 3; g.beginPath(); g.rect(x - 7, y - 7, 14, 14); g.fill(); g.stroke(); });
    };
    cv.addEventListener('pointerdown', e => {
      const p = fromEv(e), pts = a[ch];
      let i = pts.findIndex(q => Math.abs(q[0] - p[0]) < 8 && Math.abs(q[1] - p[1]) < 10);
      if (i < 0) { if (pts.some(q => q[0] === p[0])) return; pts.push(p); pts.sort((x, y) => x[0] - y[0]); i = pts.indexOf(p); }
      drag = i; try { cv.setPointerCapture(e.pointerId); } catch (_) {}
      paint(); ctx.onInput();
    });
    cv.addEventListener('pointermove', e => {
      if (drag < 0) return;
      const pts = a[ch], r = cv.getBoundingClientRect();
      const out = e.clientX < r.left - 20 || e.clientX > r.right + 20 || e.clientY < r.top - 20 || e.clientY > r.bottom + 20;
      const p = fromEv(e);
      const lo = drag > 0 ? pts[drag - 1][0] + 1 : 0, hi = drag < pts.length - 1 ? pts[drag + 1][0] - 1 : 255;
      pts[drag] = [clamp(p[0], lo, hi), p[1]];
      pts[drag]._out = out && pts.length > 2;
      cv.style.cursor = pts[drag]._out ? 'no-drop' : '';
      paint(); ctx.onInput();
    });
    cv.addEventListener('pointerup', () => {
      if (drag < 0) return;
      const pts = a[ch];
      if (pts[drag] && pts[drag]._out) pts.splice(drag, 1);
      pts.forEach(p => delete p._out);
      a[ch] = pts.map(p => [p[0], p[1]]);
      drag = -1; cv.style.cursor = '';
      paint(); ctx.onInput(); ctx.onCommit('Edit Curves');
    });
    chSel.select.addEventListener('change', () => { ch = chSel.get(); paint(); });
    reset.addEventListener('click', () => { a[ch] = line(); paint(); ctx.onInput(); ctx.onCommit('Reset curve'); });
    const presets = selectField('Preset', [['', 'Choose a preset…'], ['contrast', 'Increase contrast'], ['soft', 'Lower contrast'], ['lighter', 'Lighter'], ['darker', 'Darker'], ['negative', 'Negative'], ['fade', 'Faded film']], '');
    presets.select.addEventListener('change', () => {
      const P = { contrast: [[0, 0], [64, 48], [192, 208], [255, 255]], soft: [[0, 0], [64, 76], [192, 180], [255, 255]], lighter: [[0, 0], [128, 160], [255, 255]], darker: [[0, 0], [128, 96], [255, 255]], negative: [[0, 255], [255, 0]], fade: [[0, 36], [128, 128], [255, 236]] }[presets.get()];
      if (!P) return;
      a.rgb = P.map(p => [...p]); ch = 'rgb'; chSel.select.value = 'rgb'; presets.select.value = '';
      paint(); ctx.onInput(); ctx.onCommit('Curves preset');
    });
    const top = h('<div class="row" style="align-items:flex-end"></div>'); top.append(chSel, reset); reset.style.flex = 'none';
    wrap.append(top, cv, presets, info);
    paint();
    return wrap;
  }

  return { KINDS, ORDER, make, apply, histogram, editor, levelsLut, curveLut, hexRgb };
})();
