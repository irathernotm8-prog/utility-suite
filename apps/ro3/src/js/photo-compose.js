// Layer compositor: pixel layers, layer masks, layer styles (fx), clipping masks and adjustment layers.
// Expensive results are cached per layer and invalidated through each layer's `rev` counter.
const PhotoCompose = (() => {
  const O = PhotoOps;
  let oidN = 0;
  const oid = o => o._oid || (o._oid = ++oidN);
  const fxOn = fx => !!fx && Object.values(fx).some(e => e && e.on);

  function key(l) {
    return `${oid(l)}.${l.rev || 0}.${l.x},${l.y},${l.opacity},${l.blend},${l.visible ? 1 : 0},${l.maskOn ? 1 : 0},${l.clip ? 1 : 0}` +
      (fxOn(l.fx) ? '|' + JSON.stringify(l.fx) : '') + (l.adj ? '|' + JSON.stringify(l.adj) : '');
  }

  /** Layer pixels with its mask applied → {canvas, x, y}. tf: live transform override. */
  function pixels(l, tf) {
    if (tf && tf.layer === l && tf.quad) return { canvas: O.warpQuad(tf.baked, tf.quad, tf.docW, tf.docH, 0, 0, 12), x: 0, y: 0, live: true };
    if (tf && tf.layer === l) {
      const W = tf.docW, H = tf.docH, c = O.mk(W, H), x = O.cx(c);
      x.imageSmoothingQuality = 'high';
      x.translate(tf.cx, tf.cy); x.rotate(tf.rot); x.scale(tf.sx, tf.sy); x.drawImage(tf.baked, -tf.w / 2, -tf.h / 2);
      return { canvas: c, x: 0, y: 0, live: true };
    }
    if (!(l.mask && l.maskOn)) return { canvas: l.canvas, x: l.x, y: l.y };
    const k = `${oid(l)}.${l.rev || 0}`;
    if (l._mpCache && l._mpCache.k === k) return { canvas: l._mpCache.c, x: l.x, y: l.y };
    const c = O.clone(l.canvas), x = O.cx(c);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(l.mask, 0, 0);
    l._mpCache = { k, c };
    return { canvas: c, x: l.x, y: l.y };
  }

  function silhouette(src, color) {
    const c = O.clone(src), x = O.cx(c);
    x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    return c;
  }
  /** Grow an alpha shape outward by `r` px (blur + threshold). */
  function dilate(src, r) {
    const pad = Math.ceil(r) + 2;
    const c = O.mk(src.width + pad * 2, src.height + pad * 2), x = O.cx(c);
    x.filter = `blur(${Math.max(0.5, r / 2)}px)`; x.drawImage(src, pad, pad); x.filter = 'none';
    const id = x.getImageData(0, 0, c.width, c.height), d = id.data;
    for (let i = 3; i < d.length; i += 4) { const a = d[i]; d[i] = a <= 3 ? 0 : a >= 9 ? 255 : (a - 3) * 42; }
    x.putImageData(id, 0, 0);
    return { canvas: c, pad };
  }

  // ----- inner styles (drawn on top of the layer's own pixels, clipped to them) -----
  const on = e => e && e.on;
  /** Alpha of `src` shifted by (dx,dy), inverted, blurred by `size`: the classic inner-shadow / inner-glow matte. */
  function innerMatte(src, dx, dy, size, choke = 0) {
    const w = src.width, h = src.height, m = O.mk(w, h), x = O.cx(m);
    x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'destination-out'; x.drawImage(src, dx, dy);
    if (choke > 0) { x.globalCompositeOperation = 'source-over'; for (let k = 0; k < 2; k++) x.drawImage(m, 0, 0); }
    if (size > 0) { const b = O.mk(w, h), bx = O.cx(b); bx.filter = `blur(${size / 2}px)`; bx.drawImage(m, 0, 0); return b; }
    return m;
  }
  function tint(matte, color, alpha) { const c = O.clone(matte), x = O.cx(c); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height); c._alpha = alpha; return c; }
  /** Bevel & Emboss: height map from blurred alpha, lit from angle/altitude. */
  function bevelMaps(src, e) {
    const w = src.width, h = src.height, size = Math.max(1, e.size), depth = (e.depth || 100) / 100 * (e.direction === 'down' ? -1 : 1);
    const hm = O.mk(w, h), hx = O.cx(hm); hx.filter = `blur(${size / 2}px)`; hx.drawImage(src, 0, 0);
    const H = hx.getImageData(0, 0, w, h).data, A = O.cx(src).getImageData(0, 0, w, h).data;
    const a = (e.angle ?? 120) * Math.PI / 180, el = (e.altitude ?? 30) * Math.PI / 180;
    const L = [Math.cos(a) * Math.cos(el), -Math.sin(a) * Math.cos(el), Math.sin(el)], se = Math.sin(el);
    const hi = new ImageData(w, h), lo = new ImageData(w, h), hd = hi.data, ld = lo.data, k = depth * size * 0.5 / 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4; if (!A[i + 3]) continue;
      const gx = (H[(y * w + Math.min(w - 1, x + 1)) * 4 + 3] - H[(y * w + Math.max(0, x - 1)) * 4 + 3]) * k;
      const gy = (H[(Math.min(h - 1, y + 1) * w + x) * 4 + 3] - H[(Math.max(0, y - 1) * w + x) * 4 + 3]) * k;
      const n = Math.hypot(gx, gy, 1), dot = (-gx * L[0] - gy * L[1] + L[2]) / n - se;
      const al = A[i + 3] / 255;
      if (dot > 0) { hd[i] = hd[i + 1] = hd[i + 2] = 255; hd[i + 3] = Math.min(1, dot / Math.max(0.05, 1 - se)) * 255 * al; }
      else { ld[i + 3] = Math.min(1, -dot / Math.max(0.05, se)) * 255 * al; }
    }
    const hc = O.mk(w, h), lc = O.mk(w, h); O.cx(hc).putImageData(hi, 0, 0); O.cx(lc).putImageData(lo, 0, 0);
    return { hi: hc, lo: lc };
  }
  /** Returns the layer's pixels with inner styles applied, or null if none are on. */
  function innerEffects(src, fx) {
    const isd = on(fx.innerShadow) && fx.innerShadow, ig = on(fx.innerGlow) && fx.innerGlow, sat = on(fx.satin) && fx.satin, gr = on(fx.gradient) && fx.gradient, bv = on(fx.bevel) && fx.bevel;
    if (!isd && !ig && !sat && !gr && !bv) return null;
    const w = src.width, h = src.height, out = O.clone(src), x = O.cx(out);
    const clipDraw = (layer, mode, alpha) => {
      const c = O.clone(layer), cx = O.cx(c); cx.globalCompositeOperation = 'destination-in'; cx.drawImage(src, 0, 0);
      x.save(); x.globalCompositeOperation = mode; x.globalAlpha = alpha; x.drawImage(c, 0, 0); x.restore();
      x.save(); x.globalCompositeOperation = 'destination-in'; x.drawImage(src, 0, 0); x.restore(); // keep original alpha
    };
    if (gr) {
      const g = O.mk(w, h), gx = O.cx(g), a = (gr.angle ?? 90) * Math.PI / 180, r = Math.hypot(w, h) / 2 * (gr.scale ?? 100) / 100;
      const grad = gr.style === 'radial' ? gx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r)
        : gx.createLinearGradient(w / 2 - Math.cos(a) * r, h / 2 + Math.sin(a) * r, w / 2 + Math.cos(a) * r, h / 2 - Math.sin(a) * r);
      grad.addColorStop(0, gr.reverse ? gr.color2 : gr.color); grad.addColorStop(1, gr.reverse ? gr.color : gr.color2);
      gx.fillStyle = grad; gx.fillRect(0, 0, w, h); clipDraw(g, 'source-atop', gr.opacity / 100);
    }
    if (sat) {
      const a = (sat.angle ?? 19) * Math.PI / 180, dx = Math.cos(a) * sat.distance, dy = -Math.sin(a) * sat.distance;
      const s1 = O.mk(w, h), c1 = O.cx(s1); c1.filter = `blur(${sat.size / 2}px)`; c1.drawImage(src, dx, dy);
      const s2 = O.mk(w, h), c2 = O.cx(s2); c2.filter = `blur(${sat.size / 2}px)`; c2.drawImage(src, -dx, -dy);
      c1.filter = 'none'; c1.globalCompositeOperation = 'xor'; c1.drawImage(s2, 0, 0);
      let m = s1; if (sat.invert) { const iv = O.mk(w, h), ix = O.cx(iv); ix.fillStyle = '#000'; ix.fillRect(0, 0, w, h); ix.globalCompositeOperation = 'destination-out'; ix.drawImage(s1, 0, 0); m = iv; }
      clipDraw(tint(m, sat.color), 'multiply', sat.opacity / 100);
    }
    if (ig) clipDraw(tint(innerMatte(src, 0, 0, ig.size, ig.choke), ig.color), 'screen', ig.opacity / 100);
    if (isd) {
      const a = (isd.angle ?? 120) * Math.PI / 180, dx = Math.cos(a) * isd.distance, dy = -Math.sin(a) * isd.distance;
      // the matte comes from the shape shifted *against* the light so the shadow sits on the near edge
      clipDraw(tint(innerMatte(src, -dx, -dy, isd.size, isd.choke), isd.color), 'multiply', isd.opacity / 100);
    }
    if (bv) {
      const m = bevelMaps(src, bv);
      clipDraw(tint(m.hi, bv.highlight || '#ffffff'), 'screen', (bv.hiOpacity ?? 75) / 100);
      clipDraw(tint(m.lo, bv.shadowColor || '#000000'), 'multiply', (bv.loOpacity ?? 75) / 100);
    }
    return out;
  }

  /** Bitmap of a pixel layer with its styles → {canvas, x, y}. */
  function styled(l, P) {
    const fx = l.fx;
    if (!fxOn(fx)) return P;
    const k = key(l);
    if (!P.live && l._fxCache && l._fxCache.k === k) return l._fxCache.v;
    const sh = fx.shadow && fx.shadow.on ? fx.shadow : null, gl = fx.glow && fx.glow.on ? fx.glow : null;
    const st = fx.stroke && fx.stroke.on ? fx.stroke : null, ov = fx.overlay && fx.overlay.on ? fx.overlay : null;
    let pad = 2;
    if (sh) pad = Math.max(pad, sh.distance + sh.size * 1.6 + 4);
    if (gl) pad = Math.max(pad, gl.size * 1.6 + 4);
    if (st) pad = Math.max(pad, st.size + 4);
    pad = Math.ceil(pad);
    const src = P.canvas;
    const F = O.mk(src.width + pad * 2, src.height + pad * 2), f = O.cx(F);
    if (sh) {
      const a = sh.angle * Math.PI / 180, dx = -Math.cos(a) * sh.distance, dy = Math.sin(a) * sh.distance;
      f.save(); f.globalAlpha = sh.opacity / 100; f.filter = `blur(${sh.size / 2}px)`;
      f.drawImage(silhouette(src, sh.color), pad + dx, pad + dy); f.restore();
    }
    if (gl) {
      f.save(); f.globalAlpha = gl.opacity / 100; f.filter = `blur(${gl.size / 2}px)`;
      const s = silhouette(src, gl.color); f.drawImage(s, pad, pad); f.globalAlpha = gl.opacity / 200; f.drawImage(s, pad, pad); f.restore();
    }
    if (st) {
      const D = dilate(src, st.size), ring = silhouette(D.canvas, st.color), rx = O.cx(ring);
      rx.globalCompositeOperation = 'destination-out'; rx.drawImage(src, D.pad, D.pad);
      f.save(); f.globalAlpha = st.opacity / 100; f.drawImage(ring, pad - D.pad, pad - D.pad); f.restore();
    }
    const inner = innerEffects(src, fx);
    if (ov) {
      const c = O.clone(src), x = O.cx(c);
      x.globalCompositeOperation = 'source-atop'; x.globalAlpha = ov.opacity / 100; x.fillStyle = ov.color; x.fillRect(0, 0, c.width, c.height);
      if (inner) { x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.drawImage(inner, 0, 0); }
      f.drawImage(c, pad, pad);
    } else f.drawImage(inner || src, pad, pad);
    const v = { canvas: F, x: P.x - pad, y: P.y - pad };
    if (!P.live) l._fxCache = { k, v };
    return v;
  }

  /** Apply an adjustment layer onto everything already drawn in ctx (alpha preserved). */
  function applyAdjust(ctx, l, belowKey) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const k = belowKey == null ? null : belowKey + '#' + key(l) + `@${W}x${H}`;
    let out;
    if (k && l._adjCache && l._adjCache.k === k) out = l._adjCache.c;
    else {
      out = O.mk(W, H);
      const ox = O.cx(out);
      ox.drawImage(ctx.canvas, 0, 0);
      const id = ox.getImageData(0, 0, W, H), d = id.data;
      PhotoAdjust.apply(l.adj, d);
      for (let i = 3; i < d.length; i += 4) d[i] = 255;
      ox.putImageData(id, 0, 0);
      if (l.mask && l.maskOn) {
        const t = ctx.getTransform();
        ox.globalCompositeOperation = 'destination-in';
        ox.setTransform(t); ox.drawImage(l.mask, l.x, l.y); ox.setTransform(1, 0, 0, 1, 0, 0);
      }
      if (k) l._adjCache = { k, c: out };
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = l.opacity; ctx.globalCompositeOperation = 'source-atop';
    ctx.drawImage(out, 0, 0); ctx.restore();
  }

  // Blend modes canvas can't do natively (standard Photoshop formulas).
  const burn = (b, s) => b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min((1 - b) / s, 1);
  const dodge = (b, s) => b <= 0 ? 0 : s >= 1 ? 1 : Math.min(b / (1 - s), 1);
  const vivid = (b, s) => s <= 0.5 ? burn(b, 2 * s) : dodge(b, 2 * (s - 0.5));
  const SEP = {
    'linear-burn': (b, s) => Math.max(b + s - 1, 0),
    'linear-dodge': (b, s) => Math.min(b + s, 1),
    'vivid-light': vivid,
    'linear-light': (b, s) => Math.min(1, Math.max(0, b + 2 * s - 1)),
    'pin-light': (b, s) => s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1),
    'hard-mix': (b, s) => b >= 1 - 1e-4 ? 1 : b <= 1e-4 ? 0 : vivid(b, s) >= 0.5 ? 1 : 0,
    'subtract': (b, s) => Math.max(b - s, 0),
    'divide': (b, s) => s <= 0 ? (b <= 0 ? 0 : 1) : Math.min(b / s, 1),
  };
  const EXTRA_BLENDS = [...Object.keys(SEP), 'darker-color', 'lighter-color', 'dissolve'];
  /** Composite source canvas S (already in device space, same size as ctx) onto ctx with an extra blend mode. */
  function blendExtra(ctx, S, mode, alpha, box) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y)), x1 = Math.min(W, Math.ceil(box.x + box.w)), y1 = Math.min(H, Math.ceil(box.y + box.h));
    if (x1 <= x0 || y1 <= y0) return;
    const w = x1 - x0, h = y1 - y0;
    const dst = ctx.getImageData(x0, y0, w, h), d = dst.data, s = O.cx(S).getImageData(x0, y0, w, h).data;
    const f = SEP[mode], lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
    for (let i = 0; i < d.length; i += 4) {
      const as = s[i + 3] / 255 * alpha; if (as <= 0) continue;
      const ab = d[i + 3] / 255;
      if (mode === 'dissolve') {
        const px = (i >> 2) % w + x0, py = ((i >> 2) / w | 0) + y0, hsh = ((Math.imul(px, 73856093) ^ Math.imul(py, 19349663)) >>> 0) / 4294967296;
        if (hsh < as) { d[i] = s[i]; d[i + 1] = s[i + 1]; d[i + 2] = s[i + 2]; d[i + 3] = 255; }
        continue;
      }
      let br, bg, bb;
      const cb = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255], cs = [s[i] / 255, s[i + 1] / 255, s[i + 2] / 255];
      if (f) { br = f(cb[0], cs[0]); bg = f(cb[1], cs[1]); bb = f(cb[2], cs[2]); }
      else { const pickS = mode === 'darker-color' ? lum(...cs) < lum(...cb) : lum(...cs) > lum(...cb); [br, bg, bb] = pickS ? cs : cb; }
      const ao = as + ab * (1 - as), mix = (c0, c1, B) => ((1 - as) * ab * c0 + as * ((1 - ab) * c1 + ab * B)) / ao;
      d[i] = mix(cb[0], cs[0], br) * 255; d[i + 1] = mix(cb[1], cs[1], bg) * 255; d[i + 2] = mix(cb[2], cs[2], bb) * 255; d[i + 3] = ao * 255;
    }
    ctx.putImageData(dst, x0, y0);
  }
  /** Draw bitmap B ({canvas,x,y}) with layer opacity/blend, supporting the extra modes. */
  function drawBlended(ctx, B, opacity, blend) {
    if (EXTRA_BLENDS.includes(blend)) {
      const T = ctx.getTransform(), W = ctx.canvas.width, H = ctx.canvas.height;
      const S = O.mk(W, H), sx = O.cx(S); sx.setTransform(T); sx.drawImage(B.canvas, B.x, B.y);
      const pts = [[B.x, B.y], [B.x + B.canvas.width, B.y], [B.x, B.y + B.canvas.height], [B.x + B.canvas.width, B.y + B.canvas.height]].map(([x, y]) => [T.a * x + T.c * y + T.e, T.b * x + T.d * y + T.f]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      blendExtra(ctx, S, blend, opacity, { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
      return;
    }
    ctx.globalAlpha = opacity; ctx.globalCompositeOperation = blend;
    ctx.drawImage(B.canvas, B.x, B.y);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function drawPixel(ctx, l, tf) {
    const B = styled(l, pixels(l, tf));
    if (EXTRA_BLENDS.includes(l.blend)) return drawBlended(ctx, B, l.opacity, l.blend);
    ctx.globalAlpha = l.opacity; ctx.globalCompositeOperation = l.blend;
    ctx.drawImage(B.canvas, B.x, B.y);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  /** Draw a clipping group: base + layers clipped to it. */
  function drawGroup(ctx, base, group, tf) {
    const W = ctx.canvas.width, H = ctx.canvas.height, T = ctx.getTransform();
    const G = O.mk(W, H), g = O.cx(G); g.setTransform(T);
    const P = pixels(base, tf);
    // base styles that sit outside the pixels (shadow, glow, stroke) go underneath the group
    if (fxOn(base.fx)) {
      const lite = { ...base, fx: { ...base.fx, overlay: null } };
      lite._fxCache = base._fxBehind; const S = styled(lite, P); base._fxBehind = lite._fxCache;
      const cut = O.clone(S.canvas), cx = O.cx(cut); cx.globalCompositeOperation = 'destination-out'; cx.drawImage(P.canvas, P.x - S.x, P.y - S.y);
      ctx.globalAlpha = base.opacity; ctx.drawImage(cut, S.x, S.y); ctx.globalAlpha = 1;
      const ov = base.fx.overlay && base.fx.overlay.on ? base.fx.overlay : null;
      g.drawImage(P.canvas, P.x, P.y);
      if (ov) { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-atop'; g.globalAlpha = ov.opacity / 100; g.fillStyle = ov.color; g.fillRect(0, 0, W, H); g.restore(); }
    } else g.drawImage(P.canvas, P.x, P.y);
    const baseAlpha = O.clone(G);
    for (const c of group) {
      if (!c.visible || c.opacity <= 0) continue;
      if (c.type === 'adjust') { applyAdjust(g, c, null); continue; }
      const C = O.mk(W, H), cc = O.cx(C); cc.setTransform(T);
      const B = styled(c, pixels(c, tf));
      cc.drawImage(B.canvas, B.x, B.y);
      cc.setTransform(1, 0, 0, 1, 0, 0); cc.globalCompositeOperation = 'destination-in'; cc.drawImage(baseAlpha, 0, 0);
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = c.opacity; g.globalCompositeOperation = c.blend; g.drawImage(C, 0, 0); g.restore();
    }
    if (EXTRA_BLENDS.includes(base.blend)) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); drawBlended(ctx, { canvas: G, x: 0, y: 0 }, base.opacity, base.blend); ctx.restore(); return; }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = base.opacity; ctx.globalCompositeOperation = base.blend; ctx.drawImage(G, 0, 0); ctx.restore();
  }

  /**
   * Composite `layers` (bottom → top) onto ctx. ctx may carry a translate (e.g. for merging off-canvas content).
   * opts.tf: live transform session; opts.noCache: skip adjustment caches.
   */
  function renderStack(ctx, layers, opts = {}) {
    const groups = opts.groups || null;
    let belowKey = opts.noCache ? null : (opts.belowKey != null ? opts.belowKey : `${ctx.canvas.width}x${ctx.canvas.height}:${ctx.getTransform().e},${ctx.getTransform().f}:`);
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      // layer group: a contiguous run sharing l.group
      const G = groups && l.group && groups[l.group];
      if (G) {
        let j = i + 1;
        while (j < layers.length && layers[j].group === l.group) j++;
        const run = layers.slice(i, j);
        const gKey = `G${G.id}:${G.visible ? 1 : 0},${G.opacity},${G.blend}|`;
        if (G.visible && G.opacity > 0) {
          if (G.blend === 'pass' && G.opacity >= 1) {
            renderStack(ctx, run, { ...opts, groups: null, belowKey: belowKey == null ? null : belowKey + gKey });
          } else {
            const W = ctx.canvas.width, H = ctx.canvas.height;
            const C = O.mk(W, H), cc = O.cx(C); cc.setTransform(ctx.getTransform());
            renderStack(cc, run, { ...opts, groups: null, noCache: true });
            ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
            drawBlended(ctx, { canvas: C, x: 0, y: 0 }, G.opacity, G.blend === 'pass' ? 'source-over' : G.blend); ctx.restore();
          }
        }
        if (belowKey != null) belowKey += gKey + run.map(key).join('');
        if (opts.tf && run.includes(opts.tf.layer)) belowKey = null;
        i = j - 1;
        continue;
      }
      const group = [];
      let j = i + 1;
      if (l.type !== 'adjust') while (j < layers.length && layers[j].clip && (!groups || layers[j].group === l.group)) group.push(layers[j++]);
      if (l.visible && l.opacity > 0) {
        if (l.type === 'adjust') applyAdjust(ctx, l, opts.tf ? null : belowKey);
        else if (group.length) drawGroup(ctx, l, group, opts.tf);
        else drawPixel(ctx, l, opts.tf);
      }
      if (belowKey != null) belowKey += key(l) + group.map(key).join('');
      if (opts.tf && (opts.tf.layer === l || group.includes(opts.tf.layer))) belowKey = null;
      i = j - 1;
    }
  }

  /** Bounds of a layer's rendered content in doc coords (approx; adjustment layers cover the document). */
  function bounds(l, docW, docH) {
    if (l.type === 'adjust') return { x: 0, y: 0, w: docW, h: docH };
    const S = styled(l, pixels(l));
    return { x: S.x, y: S.y, w: S.canvas.width, h: S.canvas.height };
  }

  return { renderStack, bounds, key, fxOn, styled, pixels, EXTRA_BLENDS };
})();
