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
    if (ov) {
      const c = O.clone(src), x = O.cx(c);
      x.globalCompositeOperation = 'source-atop'; x.globalAlpha = ov.opacity / 100; x.fillStyle = ov.color; x.fillRect(0, 0, c.width, c.height);
      f.drawImage(c, pad, pad);
    } else f.drawImage(src, pad, pad);
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

  function drawPixel(ctx, l, tf) {
    const B = styled(l, pixels(l, tf));
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
            ctx.globalAlpha = G.opacity; ctx.globalCompositeOperation = G.blend === 'pass' ? 'source-over' : G.blend;
            ctx.drawImage(C, 0, 0); ctx.restore();
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

  return { renderStack, bounds, key, fxOn, styled, pixels };
})();
