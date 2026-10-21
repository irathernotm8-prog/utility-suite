// Trace — chart layout and edge routing. Pure functions; runs in the window and in Node tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.T = root.T || {}).layout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // nodes: [{id, w, h}], edges: [{from, to}] in display order. Returns { pos: Map id -> {x, y}, rank, parent, back: Set(edgeIndex), bounds }.
  // Layered layout: rank = longest path from a root (so a step that several branches lead into sits below all of them),
  // cross-axis position from packing each node's subtree side by side (tidy tree on a spanning tree).
  function layout(nodes, edges, opts) {
    const o = Object.assign({ orientation: 'vertical', rankGap: 76, siblingGap: 28, rootGap: 72, compact: true }, opts || {});
    const V = o.orientation !== 'horizontal';
    const ids = nodes.map((n) => n.id);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const out = new Map(ids.map((id) => [id, []]));
    const inc = new Map(ids.map((id) => [id, []]));
    const valid = [];
    edges.forEach((e, i) => {
      if (!byId.has(e.from) || !byId.has(e.to) || e.from === e.to) return;
      valid.push(i);
      out.get(e.from).push({ to: e.to, i });
      inc.get(e.to).push({ from: e.from, i });
    });

    // 1. break cycles with a DFS from the natural roots (then from anything unvisited)
    const back = new Set();
    const state = new Map();
    const visit = (id) => {
      state.set(id, 1);
      for (const { to, i } of out.get(id)) {
        const s = state.get(to);
        if (s === 1) back.add(i);
        else if (!s) visit(to);
      }
      state.set(id, 2);
    };
    ids.filter((id) => !inc.get(id).length).forEach((id) => { if (!state.get(id)) visit(id); });
    ids.forEach((id) => { if (!state.get(id)) visit(id); });

    const dout = new Map(ids.map((id) => [id, out.get(id).filter((x) => !back.has(x.i)).map((x) => x.to)]));
    const din = new Map(ids.map((id) => [id, inc.get(id).filter((x) => !back.has(x.i)).map((x) => x.from)]));

    // 2. ranks by longest path (Kahn's order)
    const rank = new Map(ids.map((id) => [id, 0]));
    const deg = new Map(ids.map((id) => [id, din.get(id).length]));
    const queue = ids.filter((id) => !deg.get(id));
    const topo = [];
    while (queue.length) {
      const id = queue.shift();
      topo.push(id);
      for (const to of dout.get(id)) {
        rank.set(to, Math.max(rank.get(to), rank.get(id) + 1));
        deg.set(to, deg.get(to) - 1);
        if (!deg.get(to)) queue.push(to);
      }
    }

    // 3. spanning tree: each node hangs under its closest (highest-ranked) parent
    const parent = new Map();
    const kids = new Map(ids.map((id) => [id, []]));
    for (const id of ids) {
      const ps = din.get(id);
      if (!ps.length) continue;
      let best = ps[0];
      for (const p of ps) if (rank.get(p) > rank.get(best)) best = p;
      parent.set(id, best);
    }
    // keep children in edge order
    for (const i of valid) {
      const e = edges[i];
      if (parent.get(e.to) === e.from && !kids.get(e.from).includes(e.to)) kids.get(e.from).push(e.to);
    }
    const roots = ids.filter((id) => !parent.has(id));

    const cs = (id) => (V ? byId.get(id).w : byId.get(id).h);
    const ms = (id) => (V ? byId.get(id).h : byId.get(id).w);

    // Compact leaves: when a node has 4+ children that are all leaves (vertical org charts), stack them in a column under it.
    const stacked = new Set();
    if (o.compact && V) {
      for (const id of ids) {
        const k = kids.get(id);
        if (k.length >= 4 && k.every((c) => !kids.get(c).length && din.get(c).length === 1)) stacked.add(id);
      }
    }

    // 4. subtree spans along the cross axis
    const span = new Map();
    const measure = (id) => {
      const k = kids.get(id);
      let s = cs(id);
      if (k.length) {
        k.forEach(measure);
        if (stacked.has(id)) s = Math.max(s, Math.max(...k.map(cs)) + 24);
        else s = Math.max(s, k.reduce((a, c) => a + span.get(c), 0) + o.siblingGap * (k.length - 1));
      }
      span.set(id, s);
    };
    roots.forEach(measure);

    const center = new Map();
    const stackOffset = new Map(); // extra main-axis offset for stacked leaves
    const stackStart = new Map();
    const place = (id, start) => {
      const k = kids.get(id), s = span.get(id);
      if (!k.length) { center.set(id, start + s / 2); return; }
      if (stacked.has(id)) {
        center.set(id, start + cs(id) / 2);
        let off = 0;
        for (const ch of k) { stackStart.set(ch, start + 24); center.set(ch, start + 24 + cs(ch) / 2); stackOffset.set(ch, off); off += ms(ch) + 14; }
        return;
      }
      const total = k.reduce((a, c) => a + span.get(c), 0) + o.siblingGap * (k.length - 1);
      let at = start + (s - total) / 2;
      for (const ch of k) { place(ch, at); at += span.get(ch) + o.siblingGap; }
      let c = (center.get(k[0]) + center.get(k[k.length - 1])) / 2;
      c = Math.max(start + cs(id) / 2, Math.min(start + s - cs(id) / 2, c));
      center.set(id, c);
    };
    let at = 0;
    for (const r of roots) { place(r, at); at += span.get(r) + o.rootGap; }

    // 5. main axis: each rank is as deep as its deepest node; stacked leaves extend their rank
    const maxRank = Math.max(0, ...ids.map((id) => rank.get(id)));
    const depth = new Array(maxRank + 1).fill(0);
    for (const id of ids) {
      const extra = stackOffset.has(id) ? stackOffset.get(id) : 0;
      depth[rank.get(id)] = Math.max(depth[rank.get(id)], ms(id) + extra);
    }
    const rankPos = [];
    let acc = 0;
    for (let r = 0; r <= maxRank; r++) { rankPos[r] = acc; acc += depth[r] + o.rankGap; }

    const pos = new Map();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const n = byId.get(id), r = rank.get(id), extra = stackOffset.get(id) || 0;
      let x, y;
      if (stackOffset.has(id)) {
        // stacked leaf: left-aligned column under its parent
        x = stackStart.get(id); y = rankPos[r] + extra;
      } else if (V) { x = center.get(id) - n.w / 2; y = rankPos[r]; }
      else { x = rankPos[r]; y = center.get(id) - n.h / 2; }
      pos.set(id, { x: Math.round(x), y: Math.round(y) });
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + n.w); maxY = Math.max(maxY, y + n.h);
    }
    return { pos, rank, parent, back, stacked, roots, bounds: ids.length ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : { x: 0, y: 0, w: 0, h: 0 } };
  }

  // ---- routing ----
  // a, b: {x, y, w, h}. Returns { d, lx, ly } (path and label anchor).
  function rounded(pts, r) {
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const l1 = Math.hypot(x1 - x0, y1 - y0), l2 = Math.hypot(x2 - x1, y2 - y1);
      const rr = Math.min(r, l1 / 2, l2 / 2);
      if (rr < 0.5) { d += ` L${x1},${y1}`; continue; }
      const ax = x1 - ((x1 - x0) / l1) * rr, ay = y1 - ((y1 - y0) / l1) * rr;
      const bx = x1 + ((x2 - x1) / l2) * rr, by = y1 + ((y2 - y1) / l2) * rr;
      d += ` L${ax},${ay} Q${x1},${y1} ${bx},${by}`;
    }
    const last = pts[pts.length - 1];
    return d + ` L${last[0]},${last[1]}`;
  }
  function route(a, b, opts) {
    const o = Object.assign({ orientation: 'vertical', style: 'elbow', rankGap: 76, stackedFrom: false }, opts || {});
    const V = o.orientation !== 'horizontal';
    const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    // stacked leaf: drop from the parent's left side down a rail
    if (o.stackedFrom) {
      const sx = a.x + 12, sy = a.y + a.h, ex = b.x, ey = b.y + b.h / 2;
      return { d: rounded([[sx, sy], [sx, ey], [ex, ey]], 8), lx: (sx + ex) / 2, ly: ey - 8, end: 'h' };
    }
    const forward = V ? b.y >= a.y + a.h - 2 : b.x >= a.x + a.w - 2;
    if (forward) {
      if (V) {
        const sx = acx, sy = a.y + a.h, ex = bcx, ey = b.y;
        if (o.style === 'curve') {
          const k = Math.max(24, (ey - sy) * 0.5);
          return { d: `M${sx},${sy} C${sx},${sy + k} ${ex},${ey - k} ${ex},${ey}`, lx: sx + (ex - sx) * 0.72, ly: sy + (ey - sy) * 0.62, end: 'v' };
        }
        if (o.style === 'straight') return { d: `M${sx},${sy} L${ex},${ey}`, lx: (sx + ex) / 2, ly: (sy + ey) / 2, end: 'v' };
        const my = sy + Math.min(o.rankGap / 2, (ey - sy) / 2);
        return { d: rounded([[sx, sy], [sx, my], [ex, my], [ex, ey]], 10), lx: ex, ly: my + (ey - my) / 2, end: 'v' };
      }
      const sx = a.x + a.w, sy = acy, ex = b.x, ey = bcy;
      if (o.style === 'curve') {
        const k = Math.max(24, (ex - sx) * 0.5);
        return { d: `M${sx},${sy} C${sx + k},${sy} ${ex - k},${ey} ${ex},${ey}`, lx: sx + (ex - sx) * 0.62, ly: sy + (ey - sy) * 0.72, end: 'h' };
      }
      if (o.style === 'straight') return { d: `M${sx},${sy} L${ex},${ey}`, lx: (sx + ex) / 2, ly: (sy + ey) / 2, end: 'h' };
      const mx = sx + Math.min(o.rankGap / 2, (ex - sx) / 2);
      return { d: rounded([[sx, sy], [mx, sy], [mx, ey], [ex, ey]], 10), lx: mx + (ex - mx) / 2, ly: ey, end: 'h' };
    }
    // anything else (loops back, free layout going sideways): pick the sides that face each other
    const dx = bcx - acx, dy = bcy - acy;
    let s, e, ns, ne;
    if (Math.abs(dx) * (a.h + b.h) > Math.abs(dy) * (a.w + b.w)) {
      s = [dx > 0 ? a.x + a.w : a.x, acy]; e = [dx > 0 ? b.x : b.x + b.w, bcy]; ns = [Math.sign(dx), 0]; ne = [-Math.sign(dx), 0];
    } else {
      s = [acx, dy > 0 ? a.y + a.h : a.y]; e = [bcx, dy > 0 ? b.y : b.y + b.h]; ns = [0, Math.sign(dy)]; ne = [0, -Math.sign(dy)];
    }
    const back = !forward && (V ? b.y + b.h <= a.y : b.x + b.w <= a.x);
    if (back && o.style !== 'straight') {
      // loop around the side so it doesn't run through the nodes in between
      if (V) {
        const side = Math.max(a.x + a.w, b.x + b.w) + 36;
        s = [a.x + a.w, acy]; e = [b.x + b.w, bcy];
        return { d: rounded([s, [side, acy], [side, bcy], e], 12), lx: side, ly: (acy + bcy) / 2, end: 'h', back: true };
      }
      const side = Math.max(a.y + a.h, b.y + b.h) + 36;
      s = [acx, a.y + a.h]; e = [bcx, b.y + b.h];
      return { d: rounded([s, [acx, side], [bcx, side], e], 12), lx: (acx + bcx) / 2, ly: side, end: 'v', back: true };
    }
    const dist = Math.hypot(e[0] - s[0], e[1] - s[1]);
    const k = Math.max(30, dist * 0.4);
    if (o.style === 'straight') return { d: `M${s[0]},${s[1]} L${e[0]},${e[1]}`, lx: (s[0] + e[0]) / 2, ly: (s[1] + e[1]) / 2, end: ne[0] ? 'h' : 'v' };
    if (o.style === 'elbow') {
      const pts = ns[0] ? [s, [(s[0] + e[0]) / 2, s[1]], [(s[0] + e[0]) / 2, e[1]], e] : [s, [s[0], (s[1] + e[1]) / 2], [e[0], (s[1] + e[1]) / 2], e];
      return { d: rounded(pts, 10), lx: (s[0] + e[0]) / 2, ly: (s[1] + e[1]) / 2, end: ne[0] ? 'h' : 'v' };
    }
    return { d: `M${s[0]},${s[1]} C${s[0] + ns[0] * k},${s[1] + ns[1] * k} ${e[0] + ne[0] * k},${e[1] + ne[1] * k} ${e[0]},${e[1]}`, lx: (s[0] + e[0]) / 2, ly: (s[1] + e[1]) / 2, end: ne[0] ? 'h' : 'v' };
  }

  // Shortest path from any root to `target`, following edges forward. Returns node ids, or null.
  function pathTo(nodes, edges, target, from) {
    const ids = new Set(nodes.map((n) => n.id));
    if (!ids.has(target)) return null;
    const inc = new Map();
    for (const e of edges) { if (!ids.has(e.from) || !ids.has(e.to)) continue; if (!inc.has(e.to)) inc.set(e.to, []); inc.get(e.to).push(e.from); }
    const isStart = from ? (id) => id === from : (id) => !(inc.get(id) || []).length;
    // BFS backwards from the target
    const prev = new Map([[target, null]]);
    const q = [target];
    while (q.length) {
      const id = q.shift();
      if (isStart(id)) {
        const path = [id];
        let cur = id;
        // walk forward along the recorded chain
        const fwd = new Map(); for (const [k, v] of prev) if (v) fwd.set(k, v);
        while (cur !== target) { cur = fwd.get(cur); path.push(cur); }
        return path;
      }
      for (const p of inc.get(id) || []) if (!prev.has(p)) { prev.set(p, id); q.push(p); }
    }
    return from ? null : [target];
  }

  // d3's smooth zoom (van Wijk & Nuij): p = [centerX, centerY, viewWidth]
  function interpolateZoom(p0, p1, rho = Math.SQRT2) {
    const rho2 = rho * rho, rho4 = rho2 * rho2;
    const [ux0, uy0, w0] = p0, [ux1, uy1, w1] = p1, dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
    let i, S;
    if (d2 < 1e-12) {
      S = Math.log(w1 / w0) / rho;
      i = (t) => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S)];
    } else {
      const d1 = Math.sqrt(d2);
      const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1), b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
      const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
      S = (r1 - r0) / rho;
      i = (t) => {
        const s = t * S, c0 = Math.cosh(r0), u = (w0 / (rho2 * d1)) * (c0 * Math.tanh(rho * s + r0) - Math.sinh(r0));
        return [ux0 + u * dx, uy0 + u * dy, (w0 * c0) / Math.cosh(rho * s + r0)];
      };
    }
    i.duration = Math.abs(S) * 1000 * rho / Math.SQRT2;
    return i;
  }

  return { layout, route, rounded, pathTo, interpolateZoom };
});
