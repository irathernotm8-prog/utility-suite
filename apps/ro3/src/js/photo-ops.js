// Stateless canvas operations used by the photo editor.
const PhotoOps = (() => {
  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }
  const cx = c => c.getContext('2d');
  function clone(c) { const n = mk(c.width, c.height); cx(n).drawImage(c, 0, 0); return n; }
  function data(c) { return cx(c).getImageData(0, 0, c.width, c.height); }

  /** Translate a doc-sized selection into a canvas the size of `target`, at layer offset. */
  function selIn(sel, w, h, ox, oy) {
    if (!sel) return null;
    const c = mk(w, h);
    cx(c).drawImage(sel, -ox, -oy);
    return c;
  }

  /** Blend `effect` into `base` only where `mask` is opaque. Returns a new canvas. */
  function mixMasked(base, effect, mask) {
    if (!mask) return clone(effect);
    const a = clone(base), b = clone(effect);
    const ac = cx(a), bc = cx(b);
    ac.globalCompositeOperation = 'destination-out'; ac.drawImage(mask, 0, 0);
    bc.globalCompositeOperation = 'destination-in'; bc.drawImage(mask, 0, 0);
    ac.globalCompositeOperation = 'lighter'; ac.drawImage(b, 0, 0);
    return a;
  }

  function isOpaqueEdges(c) {
    const ctx = cx(c), w = c.width, h = c.height;
    const pts = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [w >> 1, 0], [0, h >> 1]];
    return pts.every(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] === 255);
  }

  function cssFilter(src, filter, keepEdges = true) {
    const out = mk(src.width, src.height), o = cx(out);
    o.filter = filter; o.drawImage(src, 0, 0); o.filter = 'none';
    if (keepEdges && /blur/.test(filter) && isOpaqueEdges(src)) {
      o.globalCompositeOperation = 'destination-over'; o.drawImage(src, 0, 0);
    }
    return out;
  }

  /** Colour adjustments. v = { exposure, contrast, saturation, hue, temperature, tint, shadows, highlights } in -100..100 (hue -180..180) */
  function adjust(src, v) {
    const f = [];
    if (v.exposure) f.push(`brightness(${(1 + v.exposure / 100).toFixed(3)})`);
    if (v.contrast) f.push(`contrast(${(1 + v.contrast / 100).toFixed(3)})`);
    if (v.saturation) f.push(`saturate(${(1 + v.saturation / 100).toFixed(3)})`);
    if (v.hue) f.push(`hue-rotate(${v.hue}deg)`);
    let out = f.length ? cssFilter(src, f.join(' '), false) : clone(src);
    if (v.temperature || v.tint || v.shadows || v.highlights) {
      const id = data(out), d = id.data;
      const t = (v.temperature || 0) / 100 * 40, tn = (v.tint || 0) / 100 * 40;
      const sh = (v.shadows || 0) / 100 * 90, hl = (v.highlights || 0) / 100 * 90;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        let r = d[i], g = d[i + 1], b = d[i + 2];
        if (sh || hl) {
          const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          const add = sh * (1 - l) * (1 - l) + hl * l * l;
          r += add; g += add; b += add;
        }
        r += t; b -= t; g -= tn; r += tn * 0.5; b += tn * 0.5;
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
      cx(out).putImageData(id, 0, 0);
    }
    return out;
  }

  const FILTERS = {
    blur: (src, p) => cssFilter(src, `blur(${p.radius}px)`),
    grayscale: src => cssFilter(src, 'grayscale(1)'),
    sepia: src => cssFilter(src, 'sepia(1)'),
    invert: src => cssFilter(src, 'invert(1)'),
    sharpen(src, p) {
      const blurred = cssFilter(src, 'blur(1.2px)');
      const a = data(src), b = data(blurred).data, d = a.data, k = p.amount / 100 * 2;
      for (let i = 0; i < d.length; i += 4) {
        d[i] += (d[i] - b[i]) * k; d[i + 1] += (d[i + 1] - b[i + 1]) * k; d[i + 2] += (d[i + 2] - b[i + 2]) * k;
      }
      const out = mk(src.width, src.height); cx(out).putImageData(a, 0, 0); return out;
    },
    noise(src, p) {
      const a = data(src), d = a.data, amt = p.amount * 1.3;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * amt;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      const out = mk(src.width, src.height); cx(out).putImageData(a, 0, 0); return out;
    },
    pixelate(src, p) {
      const s = Math.max(2, p.size), w = Math.ceil(src.width / s), hh = Math.ceil(src.height / s);
      const small = mk(w, hh), sc = cx(small);
      sc.imageSmoothingQuality = 'high'; sc.drawImage(src, 0, 0, w, hh);
      const out = mk(src.width, src.height), o = cx(out);
      o.imageSmoothingEnabled = false; o.drawImage(small, 0, 0, w * s, hh * s);
      return out;
    },
    posterize(src, p) {
      const a = data(src), d = a.data, lv = Math.max(2, p.levels), step = 255 / (lv - 1);
      for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.round(d[i] / step) * step; d[i + 1] = Math.round(d[i + 1] / step) * step; d[i + 2] = Math.round(d[i + 2] / step) * step;
      }
      const out = mk(src.width, src.height); cx(out).putImageData(a, 0, 0); return out;
    },
    vignette(src, p) {
      const out = clone(src), o = cx(out), w = out.width, hh = out.height;
      const g = o.createRadialGradient(w / 2, hh / 2, Math.min(w, hh) * (0.62 - p.size / 250), w / 2, hh / 2, Math.hypot(w, hh) / 2);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${p.strength / 100})`);
      o.globalCompositeOperation = 'source-atop'; o.fillStyle = g; o.fillRect(0, 0, w, hh);
      return out;
    },
    autotone(src) {
      const a = data(src), d = a.data, hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
      let n = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 8) continue; hist[0][d[i]]++; hist[1][d[i + 1]]++; hist[2][d[i + 2]]++; n++; }
      const cut = n * 0.004;
      const lut = hist.map(hh => {
        let lo = 0, hi = 255, acc = 0;
        while (lo < 255 && (acc += hh[lo]) < cut) lo++;
        acc = 0; while (hi > 0 && (acc += hh[hi]) < cut) hi--;
        if (hi <= lo) { lo = 0; hi = 255; }
        const t = new Uint8ClampedArray(256);
        for (let i = 0; i < 256; i++) t[i] = (i - lo) * 255 / (hi - lo);
        return t;
      });
      for (let i = 0; i < d.length; i += 4) { d[i] = lut[0][d[i]]; d[i + 1] = lut[1][d[i + 1]]; d[i + 2] = lut[2][d[i + 2]]; }
      const out = mk(src.width, src.height); cx(out).putImageData(a, 0, 0); return out;
    },
  };

  /**
   * Flood region from (x,y) on canvas. Returns Uint8Array mask (1 = in region).
   * tolerance 0..255, contiguous boolean.
   */
  function region(c, x, y, tolerance, contiguous) {
    const w = c.width, hh = c.height;
    x = Math.floor(x); y = Math.floor(y);
    const out = new Uint8Array(w * hh);
    if (x < 0 || y < 0 || x >= w || y >= hh) return out;
    const d = data(c).data;
    const i0 = (y * w + x) * 4;
    const r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2], a0 = d[i0 + 3];
    const tol = tolerance * tolerance * 4;
    const match = i => {
      const dr = d[i] - r0, dg = d[i + 1] - g0, db = d[i + 2] - b0, da = d[i + 3] - a0;
      return dr * dr + dg * dg + db * db + da * da <= tol;
    };
    if (!contiguous) {
      for (let p = 0; p < w * hh; p++) if (match(p * 4)) out[p] = 1;
      return out;
    }
    const stack = [x, y];
    while (stack.length) {
      let sy = stack.pop(), sx = stack.pop();
      let p = sy * w + sx;
      while (sx >= 0 && !out[p] && match(p * 4)) { sx--; p--; }
      sx++; p++;
      let up = false, dn = false;
      while (sx < w && !out[p] && match(p * 4)) {
        out[p] = 1;
        if (sy > 0) { const q = p - w; if (!out[q] && match(q * 4)) { if (!up) { stack.push(sx, sy - 1); up = true; } } else up = false; }
        if (sy < hh - 1) { const q = p + w; if (!out[q] && match(q * 4)) { if (!dn) { stack.push(sx, sy + 1); dn = true; } } else dn = false; }
        sx++; p++;
      }
    }
    return out;
  }

  function maskToCanvas(mask, w, hh) {
    const c = mk(w, hh), id = cx(c).createImageData(w, hh), d = id.data;
    for (let p = 0; p < mask.length; p++) if (mask[p]) d[p * 4 + 3] = 255;
    cx(c).putImageData(id, 0, 0);
    return c;
  }

  /** Edge pixels of a selection mask, for marching ants. Returns canvas or null when empty. */
  function edges(sel, thickness = 1) {
    const w = sel.width, hh = sel.height, d = data(sel).data;
    const out = cx(sel).createImageData(w, hh), o = out.data;
    let any = false, edge = false;
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (d[p * 4 + 3] < 128) continue;
        any = true;
        if (x === 0 || y === 0 || x === w - 1 || y === hh - 1 || d[(p - 1) * 4 + 3] < 128 || d[(p + 1) * 4 + 3] < 128 || d[(p - w) * 4 + 3] < 128 || d[(p + w) * 4 + 3] < 128) {
          o[p * 4 + 3] = 255; edge = true;
        }
      }
    }
    if (!any) return null;
    let c = mk(w, hh); cx(c).putImageData(out, 0, 0);
    if (thickness > 1) {
      const t = mk(w, hh), tc = cx(t);
      for (let dx = -thickness + 1; dx < thickness; dx++) for (let dy = -thickness + 1; dy < thickness; dy++) if (Math.abs(dx) + Math.abs(dy) < thickness) tc.drawImage(c, dx, dy);
      c = t;
    }
    return edge ? c : null;
  }

  function bounds(c) {
    const w = c.width, hh = c.height, d = data(c).data;
    let x0 = w, y0 = hh, x1 = -1, y1 = -1;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /** Homography mapping the unit square to quad [TL, TR, BR, BL]. Returns (u, v) → {x, y}. */
  function quadMap(q) {
    const [p0, p1, p2, p3] = q;
    const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
    let a, b, c, d, e, f, g, hh;
    if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
      a = p1.x - p0.x; b = p3.x - p0.x; c = p0.x; d = p1.y - p0.y; e = p3.y - p0.y; f = p0.y; g = 0; hh = 0;
    } else {
      const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, den = dx1 * dy2 - dx2 * dy1 || 1e-9;
      g = (sx * dy2 - dx2 * sy) / den; hh = (dx1 * sy - sx * dy1) / den;
      a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + hh * p3.x; c = p0.x;
      d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + hh * p3.y; f = p0.y;
    }
    return (u, v) => { const w = g * u + hh * v + 1; return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w }; };
  }
  /** Draw `src` warped onto quad (doc coords) into a new W×H canvas whose origin is (ox, oy). */
  function warpQuad(src, quad, W, H, ox = 0, oy = 0, N = 24) {
    const out = mk(W, H), x = cx(out), map = quadMap(quad), sw = src.width, sh = src.height;
    x.imageSmoothingQuality = 'high';
    const P = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const p = map(i / N, j / N); P.push({ x: p.x - ox, y: p.y - oy }); }
    const tri = (s0, s1, s2, d0, d1, d2) => {
      // affine taking source triangle to destination triangle
      const sx1 = s1.x - s0.x, sy1 = s1.y - s0.y, sx2 = s2.x - s0.x, sy2 = s2.y - s0.y;
      const dx1 = d1.x - d0.x, dy1 = d1.y - d0.y, dx2 = d2.x - d0.x, dy2 = d2.y - d0.y, det = (sx1 * sy2 - sx2 * sy1) || 1e-9;
      const a = (dx1 * sy2 - dx2 * sy1) / det, c = (dx2 * sx1 - dx1 * sx2) / det;
      const b = (dy1 * sy2 - dy2 * sy1) / det, d = (dy2 * sx1 - dy1 * sx2) / det;
      const e = d0.x - a * s0.x - c * s0.y, f = d0.y - b * s0.x - d * s0.y;
      // clip slightly enlarged destination triangle to hide seams
      const mx = (d0.x + d1.x + d2.x) / 3, my = (d0.y + d1.y + d2.y) / 3, grow = q => { const vx = q.x - mx, vy = q.y - my, l = Math.hypot(vx, vy) || 1; return { x: q.x + vx / l, y: q.y + vy / l }; };
      const [g0, g1, g2] = [grow(d0), grow(d1), grow(d2)];
      x.save(); x.beginPath(); x.moveTo(g0.x, g0.y); x.lineTo(g1.x, g1.y); x.lineTo(g2.x, g2.y); x.closePath(); x.clip();
      x.setTransform(a, b, c, d, e, f); x.drawImage(src, 0, 0); x.restore();
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * (N + 1) + i, s = (ii, jj) => ({ x: ii / N * sw, y: jj / N * sh });
      const A = P[k], B = P[k + 1], C = P[k + N + 2], D = P[k + N + 1];
      tri(s(i, j), s(i + 1, j), s(i + 1, j + 1), A, B, C);
      tri(s(i, j), s(i + 1, j + 1), s(i, j + 1), A, C, D);
    }
    return out;
  }

  function rotate90(c, cw = true) {
    const out = mk(c.height, c.width), o = cx(out);
    if (cw) { o.translate(c.height, 0); o.rotate(Math.PI / 2); }
    else { o.translate(0, c.width); o.rotate(-Math.PI / 2); }
    o.drawImage(c, 0, 0);
    return out;
  }
  function rotate180(c) {
    const out = mk(c.width, c.height), o = cx(out);
    o.translate(c.width, c.height); o.rotate(Math.PI); o.drawImage(c, 0, 0);
    return out;
  }
  function flip(c, horizontal) {
    const out = mk(c.width, c.height), o = cx(out);
    if (horizontal) { o.translate(c.width, 0); o.scale(-1, 1); } else { o.translate(0, c.height); o.scale(1, -1); }
    o.drawImage(c, 0, 0);
    return out;
  }
  function scaled(c, w, hh) {
    const out = mk(w, hh), o = cx(out);
    o.imageSmoothingQuality = 'high';
    // Step down in halves for quality when shrinking a lot.
    let src = c;
    while (src.width / 2 > w && src.height / 2 > hh) {
      const s = mk(src.width / 2, src.height / 2), sc = cx(s);
      sc.imageSmoothingQuality = 'high'; sc.drawImage(src, 0, 0, s.width, s.height); src = s;
    }
    o.drawImage(src, 0, 0, w, hh);
    return out;
  }

  /** Brush dab with soft edge. */
  function stamp(size, hardness, color) {
    const s = Math.max(1, Math.ceil(size)), c = mk(s, s), o = cx(c), r = s / 2;
    if (hardness >= 0.99) { o.fillStyle = color; o.beginPath(); o.arc(r, r, r, 0, Math.PI * 2); o.fill(); return c; }
    const g = o.createRadialGradient(r, r, r * hardness, r, r, r);
    g.addColorStop(0, color);
    g.addColorStop(1, color.startsWith('#') ? color + '00' : 'rgba(0,0,0,0)');
    o.fillStyle = g; o.fillRect(0, 0, s, s);
    return c;
  }

  /** Draw a frame onto a doc-sized canvas. */
  function drawFrame(style, w, hh, T, color, inset) {
    const c = mk(w, hh), o = cx(c);
    const { l, t, r, b } = inset; // how much of the frame is "grown" on each side (image area is inset)
    o.fillStyle = color;
    const ring = (x, y, ww, hh2, rad = 0) => {
      o.beginPath(); o.rect(0, 0, w, hh);
      if (rad) o.roundRect(x, y, ww, hh2, rad); else o.rect(x, y, ww, hh2);
      o.fill('evenodd');
    };
    switch (style) {
      case 'border': ring(T, T, w - 2 * T, hh - 2 * T); break;
      case 'rounded': ring(T, T, w - 2 * T, hh - 2 * T, T * 2.5); break;
      case 'polaroid': ring(T, T, w - 2 * T, hh - T - Math.max(b, T * 3.5)); break;
      case 'double': {
        ring(T, T, w - 2 * T, hh - 2 * T);
        const g = Math.max(2, T * 0.35), lw = Math.max(1, T * 0.12);
        o.strokeStyle = color; o.lineWidth = lw;
        o.strokeRect(T + g + lw / 2, T + g + lw / 2, w - 2 * (T + g) - lw, hh - 2 * (T + g) - lw);
        break;
      }
      case 'film': {
        ring(T * 0.6, T * 1.6, w - T * 1.2, hh - T * 3.2);
        o.globalCompositeOperation = 'destination-out';
        const hole = T * 0.55, pitch = hole * 2.2;
        for (let x = pitch * 0.6; x < w - hole; x += pitch) {
          o.beginPath(); o.roundRect(x, T * 0.5, hole, hole * 0.75, hole * 0.15); o.roundRect(x, hh - T * 0.5 - hole * 0.75, hole, hole * 0.75, hole * 0.15); o.fill();
        }
        o.globalCompositeOperation = 'source-over';
        break;
      }
      case 'mat': {
        ring(T, T, w - 2 * T, hh - 2 * T);
        o.save();
        o.beginPath(); o.rect(T, T, w - 2 * T, hh - 2 * T); o.clip();
        o.shadowColor = 'rgba(0,0,0,.55)'; o.shadowBlur = T * 0.35; o.shadowOffsetX = T * 0.08; o.shadowOffsetY = T * 0.08;
        o.beginPath(); o.rect(-T, -T, w + 2 * T, hh + 2 * T); o.rect(T, T, w - 2 * T, hh - 2 * T); o.fill('evenodd');
        o.restore();
        o.strokeStyle = 'rgba(255,255,255,.35)'; o.lineWidth = Math.max(1, T * 0.04);
        o.strokeRect(T - o.lineWidth / 2, T - o.lineWidth / 2, w - 2 * T + o.lineWidth, hh - 2 * T + o.lineWidth);
        break;
      }
    }
    return c;
  }

  function fromImage(img) {
    const c = mk(img.naturalWidth || img.width, img.naturalHeight || img.height);
    cx(c).drawImage(img, 0, 0);
    return c;
  }
  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not decode image')); i.src = src; });
  }
  function toBytes(c, type = 'image/png', q) {
    return new Promise((res, rej) => c.toBlob(b => b ? b.arrayBuffer().then(a => res(new Uint8Array(a))) : rej(new Error('Image too large to encode')), type, q));
  }

  return { quadMap, warpQuad, mk, cx, clone, data, selIn, mixMasked, cssFilter, adjust, FILTERS, region, maskToCanvas, edges, bounds, rotate90, rotate180, flip, scaled, stamp, drawFrame, fromImage, loadImage, toBytes };
})();
