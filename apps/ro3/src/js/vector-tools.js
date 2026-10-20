// Vector workspace — canvas tools, overlay drawing (selection, anchors, guides, smart guides), text editing.
(() => {
  const S = VX.S;
  const P = paper;
  const T = VX.tools = {};
  const pt = (x, y) => new P.Point(x, y);

  VX.TOOL_LIST = [
    { id: 'select', name: 'Selection', icon: 'vSelect', key: 'v' },
    { id: 'direct', name: 'Direct Selection', icon: 'vDirect', key: 'a' },
    { id: 'lasso', name: 'Lasso', icon: 'vLasso', key: 'q' },
    { id: 'pen', name: 'Pen', icon: 'vPen', key: 'p' },
    { id: 'addAnchor', name: 'Add Anchor Point', icon: 'vAddAnchor', key: '+', key2: 'shift++', label: '+' },
    { id: 'delAnchor', name: 'Delete Anchor Point', icon: 'vDelAnchor', key: '-', label: '−' },
    { id: 'convert', name: 'Anchor Point', icon: 'vConvert', key: 'shift+c' },
    { id: 'curvature', name: 'Curvature', icon: 'vCurvature', key: 'shift+`', label: 'Shift+~' },
    { id: 'text', name: 'Type', icon: 'vText', key: 't' },
    { id: 'line', name: 'Line Segment', icon: 'vLine', key: '\\' },
    { id: 'arc', name: 'Arc', icon: 'vArc', label: '—' },
    { id: 'spiral', name: 'Spiral', icon: 'vSpiral', label: '—' },
    { id: 'rect', name: 'Rectangle', icon: 'vRect', key: 'm' },
    { id: 'ellipse', name: 'Ellipse', icon: 'vEllipse', key: 'l' },
    { id: 'polygon', name: 'Polygon', icon: 'vPolygon', label: '—' },
    { id: 'star', name: 'Star', icon: 'vStar', label: '—' },
    { id: 'pencil', name: 'Pencil', icon: 'vPencil', key: 'n' },
    { id: 'brush', name: 'Paintbrush', icon: 'vBrush', key: 'b' },
    { id: 'eraser', name: 'Eraser', icon: 'vEraser', key: 'shift+e' },
    { id: 'scissors', name: 'Scissors', icon: 'vScissors', key: 'c' },
    { id: 'knife', name: 'Knife', icon: 'vKnife', label: '—' },
    { id: 'rotate', name: 'Rotate', icon: 'vRotate', key: 'r' },
    { id: 'reflect', name: 'Reflect', icon: 'vReflect', key: 'o' },
    { id: 'scale', name: 'Scale', icon: 'vScale', key: 's' },
    { id: 'gradient', name: 'Gradient', icon: 'vGradient', key: 'g' },
    { id: 'eyedropper', name: 'Eyedropper', icon: 'vDropper', key: 'i' },
    { id: 'artboard', name: 'Artboard', icon: 'vArtboard', key: 'shift+o' },
    { id: 'hand', name: 'Hand', icon: 'vHand', key: 'h', label: 'H / Space' },
    { id: 'zoom', name: 'Zoom', icon: 'vZoom', key: 'z' },
  ];
  VX.GROUPS = [['select'], ['direct'], ['lasso'], 'sep', ['pen', 'addAnchor', 'delAnchor', 'convert'], ['curvature'], ['text'], ['line', 'arc', 'spiral'], ['rect', 'ellipse', 'polygon', 'star'], ['pencil', 'brush', 'eraser'], ['scissors', 'knife'], 'sep',
    ['rotate', 'reflect'], ['scale'], ['gradient'], ['eyedropper'], 'sep', ['artboard'], ['hand'], ['zoom']];
  // Tool options (shown in the options bar).
  const O = VX.T = {
    rect: { radius: 0 }, polygon: { sides: 6 }, star: { points: 5, ratio: 50 }, spiral: { decay: 80, turns: 4 }, arc: { concave: false, closed: false },
    pencil: { smooth: 50, fill: false }, brush: { smooth: 60, width: 4 }, eraser: { size: 24 }, knife: {},
    artboard: { moveArt: true }, select: {}, line: {},
  };

  VX.setTool = id => {
    if (!T[id]) return;
    const prev = T[S.tool];
    if (prev && prev.deactivate && S.tool !== id) prev.deactivate();
    if (VX.textEditing() && id !== 'text') VX.commitTextEdit();
    S.tool = id;
    if (id !== 'direct' && id !== 'lasso' && id !== 'pen' && id !== 'convert' && id !== 'curvature' && id !== 'addAnchor' && id !== 'delAnchor' && S.pts.size) { S.pts.clear(); }
    if ((id === 'select') && S.sel.length) { // selection tool works on whole objects
      const tops = [...new Set(S.sel.map(it => VX.topOf(it) || it))];
      if (tops.length !== S.sel.length || tops.some((t, i) => t !== S.sel[i])) { S.sel = tops; VX.selectionChanged(); }
    }
    T[id].activate && T[id].activate();
    VX.markTool && VX.markTool(); VX.renderOptions(); VX.updateCursor(); VX.req();
  };
  VX.updateCursor = () => {
    const st = S.el.stage; if (!st) return;
    let c = S.space || S.tool === 'hand' ? 'grab' : (T[S.tool] && T[S.tool].cursor) || 'default';
    if (S.hoverCursor && !S.space && S.tool !== 'hand') c = S.hoverCursor;
    st.dataset.cursor = c;
  };
  const setHoverCursor = c => { if (S.hoverCursor !== c) { S.hoverCursor = c; VX.updateCursor(); } };

  // ---------- hit testing ----------
  const inScope = it => !S.isolation || S.isolation.isAncestor(it) || it === S.isolation;
  VX.hit = (point, { tol = 4, segments = false, fill = true, stroke = true, match } = {}) => {
    const r = S.project.hitTest(point, { fill, stroke, segments, tolerance: VX.tol(tol), match: h => h.item.className !== 'Layer' && VX.selectable(h.item) && inScope(h.item) && (!match || match(h)) });
    return r;
  };
  const hitObject = point => { const r = VX.hit(point); return r ? VX.topOf(r.item) : null; };
  VX.hitObject = hitObject;

  // ---------- snapping & smart guides ----------
  let targets = null;
  function collectTargets(exclude = []) {
    const xs = [], ys = [], vb = S.view.bounds.expand(S.view.bounds.width);
    const skip = it => exclude.some(e => e === it || e.isAncestor(it) || it.isAncestor(e));
    const add = (r, kind) => { xs.push({ v: r.left, r, kind }, { v: r.center.x, r, kind, c: 1 }, { v: r.right, r, kind }); ys.push({ v: r.top, r, kind }, { v: r.center.y, r, kind, c: 1 }, { v: r.bottom, r, kind }); };
    for (const a of S.doc.artboards) add(VX.abRect(a), 'ab');
    let n = 0;
    const scopeKids = S.isolation ? S.isolation.children : S.project.layers.flatMap(L => L.visible ? L.children : []);
    for (const it of scopeKids) { if (n > 3000) break; if (!it.visible || skip(it)) continue; const b = it.bounds; if (!b.intersects(vb)) continue; add(b, 'obj'); n++; }
    if (S.show.guides) for (const g of S.doc.guides) (g.axis === 'x' ? xs : ys).push({ v: g.pos, kind: 'guide' });
    return { xs, ys };
  }
  const gridSnap = v => { const g = S.doc.grid.size / (S.doc.grid.sub || 1); return Math.round(v / g) * g; };
  /** Snap a moving rectangle; returns the correction and guide lines to draw. */
  function snapRect(rect, tg, { x = true, y = true } = {}) {
    const res = { dx: 0, dy: 0, lines: [] };
    if (S.show.snapGrid) {
      if (x) res.dx = gridSnap(rect.left) - rect.left;
      if (y) res.dy = gridSnap(rect.top) - rect.top;
      return res;
    }
    if (!S.show.smart || !tg) return res;
    const tol = VX.tol(6);
    const pick = (edges, list) => { let best = null; for (const e of edges) for (const t of list) { const d = t.v - e; if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d) - 1e-9)) best = { d, t }; } return best; };
    const bx = x && pick([rect.left, rect.center.x, rect.right], tg.xs), by = y && pick([rect.top, rect.center.y, rect.bottom], tg.ys);
    if (bx) res.dx = bx.d; if (by) res.dy = by.d;
    const r2 = new P.Rectangle(rect.x + res.dx, rect.y + res.dy, rect.width, rect.height);
    if (bx) for (const t of tg.xs) if (Math.abs(t.v - (r2.left)) < 1e-6 || Math.abs(t.v - r2.center.x) < 1e-6 || Math.abs(t.v - r2.right) < 1e-6) { const a = t.r ? Math.min(t.r.top, r2.top) : r2.top - 4000, b = t.r ? Math.max(t.r.bottom, r2.bottom) : r2.bottom + 4000; res.lines.push([pt(t.v, a), pt(t.v, b), t.kind]); }
    if (by) for (const t of tg.ys) if (Math.abs(t.v - r2.top) < 1e-6 || Math.abs(t.v - r2.center.y) < 1e-6 || Math.abs(t.v - r2.bottom) < 1e-6) { const a = t.r ? Math.min(t.r.left, r2.left) : r2.left - 4000, b = t.r ? Math.max(t.r.right, r2.right) : r2.right + 4000; res.lines.push([pt(a, t.v), pt(b, t.v), t.kind]); }
    return res;
  }
  /** Snap a drawing point to anchors, guides, grid, artboard/object edges. */
  function snapPoint(p, { exclude = [], tg = targets } = {}) {
    S.smart = null;
    if (S.show.snapGrid) return pt(gridSnap(p.x), gridSnap(p.y));
    if (!S.show.smart) return p;
    const h = S.project.hitTest(p, { segments: true, fill: false, stroke: false, tolerance: VX.tol(6), match: r => r.type === 'segment' && VX.selectable(r.item) && !exclude.some(e => e === r.item || e.isAncestor(r.item)) });
    if (h && h.segment) { const q = h.item.localToGlobal ? h.item.localToGlobal(h.segment.point) : h.segment.point; S.smart = { lines: [], label: 'anchor', at: q }; return q; }
    const tgt = tg || collectTargets(exclude);
    const r = snapRect(new P.Rectangle(p, p), tgt);
    if (r.dx || r.dy || r.lines.length) { const q = p.add([r.dx, r.dy]); S.smart = { lines: r.lines, label: r.lines.some(l => l[2] === 'ab') ? 'artboard' : r.lines.some(l => l[2] === 'guide') ? 'guide' : 'align', at: q }; return q; }
    return p;
  }
  VX.snapPoint = snapPoint;
  const constrain = (from, to, step = 45) => { const v = to.subtract(from); const a = Math.round(v.angle / step) * step; return from.add(new P.Point({ length: v.length * Math.cos((v.angle - a) * Math.PI / 180), angle: a })); };

  // ---------- geometry helpers for overlay ----------
  const gm = it => S.view.matrix.appended(it.globalMatrix);
  function tracePath(ctx, path, m) {
    const segs = path.segments; if (!segs.length) return;
    const p0 = m.transform(segs[0].point); ctx.moveTo(p0.x, p0.y);
    const n = path.closed ? segs.length : segs.length - 1;
    for (let i = 0; i < n; i++) {
      const a = segs[i], b = segs[(i + 1) % segs.length];
      const c1 = m.transform(a.point.add(a.handleOut)), c2 = m.transform(b.point.add(b.handleIn)), e = m.transform(b.point);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y);
    }
    if (path.closed) ctx.closePath();
  }
  function traceItem(ctx, it, depth = 0) {
    if (!it.visible) return;
    if (it.className === 'Path') tracePath(ctx, it, gm(it));
    else if (it.className === 'CompoundPath') it.children.forEach(c => tracePath(ctx, c, gm(c)));
    else if ((it.className === 'Group' || it.className === 'Layer') && depth < 6 && it.children.length < 400) it.children.forEach(c => { if (!c.clipMask || it.clipped) traceItem(ctx, c, depth + 1); });
    else traceBox(ctx, it);
  }
  function traceBox(ctx, it) {
    const r = it.className === 'PointText' || it.className === 'Raster' || it.className === 'Shape' ? it.internalBounds : null;
    if (r) { const m = gm(it); const q = [r.topLeft, r.topRight, r.bottomRight, r.bottomLeft].map(p => m.transform(p)); ctx.moveTo(q[0].x, q[0].y); q.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath(); }
    else { const b = it.bounds; const a = VX.p2v(b.topLeft), c = VX.p2v(b.bottomRight); ctx.rect(a.x, a.y, c.x - a.x, c.y - a.y); }
  }
  VX.traceItem = traceItem;
  const LAYER_COLORS = ['#4c8dff', '#ff4f6d', '#2fd67f', '#ffb020', '#b46bff', '#00c4d6', '#ff7ae1', '#9cd23f'];
  VX.layerColor = L => { if (!L) return LAYER_COLORS[0]; if (!L.data.color) L.data.color = LAYER_COLORS[(L.index || 0) % LAYER_COLORS.length]; return L.data.color; };
  const colorOf = it => VX.layerColor(it.layer);
  const square = (ctx, p, s, fill, stroke) => { ctx.fillStyle = fill; ctx.fillRect(Math.round(p.x - s / 2) + .5, Math.round(p.y - s / 2) + .5, s, s); ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(Math.round(p.x - s / 2) + .5, Math.round(p.y - s / 2) + .5, s, s); };
  const dot = (ctx, p, r, fill, stroke) => { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } };

  /** Screen-space handles of the selection bounding box. */
  function bboxHandles(b) {
    if (!b) return [];
    const a = VX.p2v(b.topLeft), c = VX.p2v(b.bottomRight), mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2;
    const hs = [['nw', a.x, a.y], ['n', mx, a.y], ['ne', c.x, a.y], ['e', c.x, my], ['se', c.x, c.y], ['s', mx, c.y], ['sw', a.x, c.y], ['w', a.x, my]];
    // hide edge handles on tiny boxes
    return hs.filter(([id]) => (c.x - a.x > 24 && c.y - a.y > 24) || id.length === 2 || (id === 'n' || id === 's' ? c.x - a.x > 24 : c.y - a.y > 24)).map(([id, x, y]) => ({ id, p: pt(x, y) }));
  }
  function handleAt(v, b) {
    if (!b || !S.show.bounds) return null;
    for (const hd of bboxHandles(b)) if (hd.p.getDistance(v) <= 6) return { kind: 'scale', id: hd.id };
    const a = VX.p2v(b.topLeft), c = VX.p2v(b.bottomRight);
    for (const [id, x, y] of [['nw', a.x, a.y], ['ne', c.x, a.y], ['se', c.x, c.y], ['sw', a.x, c.y]]) { const d = pt(x, y).getDistance(v); if (d > 6 && d < 22 && !(v.x > a.x && v.x < c.x && v.y > a.y && v.y < c.y)) return { kind: 'rotate', id }; }
    return null;
  }
  const RESIZE_CURSOR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };

  // ---------- overlay ----------
  VX.drawOverlay = () => {
    const { w, h } = VX.stageSize();
    const ctx = VX.sizeCanvas(S.el.over, w, h);
    ctx.clearRect(0, 0, w, h);
    const z = VX.zoom();
    // artboard frames & names
    ctx.font = '600 11px Manrope, sans-serif'; ctx.textBaseline = 'bottom';
    S.doc.artboards.forEach((a, i) => {
      const p = VX.p2v(pt(a.x, a.y)), on = i === S.doc.ab;
      ctx.strokeStyle = on ? 'rgba(47,214,127,.9)' : 'rgba(0,0,0,.35)'; ctx.lineWidth = on ? 1.5 : 1;
      ctx.strokeRect(Math.round(p.x) + .5, Math.round(p.y) + .5, Math.round(a.w * z), Math.round(a.h * z));
      ctx.fillStyle = on ? '#e4ece7' : '#7f9488'; ctx.fillText(`${i + 1}  ${a.name}`, Math.round(p.x), Math.round(p.y) - 4);
    });
    // outline view
    if (S.show.outline) {
      ctx.save(); ctx.beginPath();
      for (const L of S.project.layers) if (L.visible) for (const c of L.children) traceItem(ctx, c);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
    }
    // guides
    if (S.show.guides) {
      ctx.strokeStyle = '#3fd2ff'; ctx.lineWidth = 1; ctx.beginPath();
      for (const g of S.doc.guides) { const p = VX.p2v(pt(g.pos, g.pos)); if (g.axis === 'x') { ctx.moveTo(Math.round(p.x) + .5, 0); ctx.lineTo(Math.round(p.x) + .5, h); } else { ctx.moveTo(0, Math.round(p.y) + .5); ctx.lineTo(w, Math.round(p.y) + .5); } }
      ctx.stroke();
    }
    // hover highlight
    if (S.hover && S.hover.parent && !S.sel.includes(S.hover) && !VX.dragging()) {
      ctx.beginPath(); traceItem(ctx, S.hover); ctx.strokeStyle = colorOf(S.hover); ctx.lineWidth = 2; ctx.stroke();
    }
    // selection
    const direct = ['direct', 'lasso', 'pen', 'convert', 'addAnchor', 'delAnchor', 'curvature'].includes(S.tool);
    for (const it of S.sel) {
      if (!it.parent) continue;
      ctx.beginPath(); traceItem(ctx, it); ctx.strokeStyle = colorOf(it); ctx.lineWidth = it === S.key ? 2.5 : 1; ctx.stroke();
      if (it.className === 'PointText') drawTextMarks(ctx, it);
    }
    if (direct) drawAnchors(ctx);
    else if (S.sel.length && S.show.bounds && !textEdit && ['select', 'rotate', 'reflect', 'scale', 'gradient', 'eyedropper', 'text'].includes(S.tool)) {
      const b = VX.selBounds();
      if (b) {
        const col = colorOf(S.sel[0]);
        const a = VX.p2v(b.topLeft), c = VX.p2v(b.bottomRight);
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(Math.round(a.x) + .5, Math.round(a.y) + .5, Math.round(c.x - a.x), Math.round(c.y - a.y));
        if (S.tool === 'select') for (const hd of bboxHandles(b)) square(ctx, hd.p, 7, '#fff', col);
        // live corner widgets for single live rectangles
        if (S.tool === 'select' && S.sel.length === 1 && S.sel[0].data && S.sel[0].data.live && c.x - a.x > 40 && c.y - a.y > 40) {
          for (const q of liveCornerHandles(S.sel[0])) dot(ctx, q.v, 4, '#fff', col);
        }
      }
    }
    if (S.key && S.key.parent) { ctx.beginPath(); traceBox(ctx, S.key); ctx.strokeStyle = colorOf(S.key); ctx.lineWidth = 2.5; ctx.stroke(); }
    if (S.isolation) { ctx.fillStyle = 'rgba(10,15,12,.88)'; ctx.fillRect(0, 0, w, 24 + (S.show.rulers ? VX.RULER : 0)); ctx.fillStyle = '#2fd67f'; ctx.font = '600 12px Manrope, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText(`◀  Isolation: ${VX.nameOf(S.isolation)} — press Esc to exit`, (S.show.rulers ? VX.RULER : 0) + 12, (S.show.rulers ? VX.RULER : 0) + 12); }
    // tool overlay
    const t = T[S.tool]; t && t.overlay && t.overlay(ctx);
    // marquee / lasso
    if (S.marquee) { const a = VX.p2v(S.marquee.topLeft), c = VX.p2v(S.marquee.bottomRight); ctx.fillStyle = 'rgba(76,141,255,.08)'; ctx.fillRect(a.x, a.y, c.x - a.x, c.y - a.y); ctx.setLineDash([4, 3]); ctx.strokeStyle = '#4c8dff'; ctx.strokeRect(Math.round(a.x) + .5, Math.round(a.y) + .5, Math.round(c.x - a.x), Math.round(c.y - a.y)); ctx.setLineDash([]); }
    if (S.lassoPts && S.lassoPts.length > 1) { ctx.beginPath(); S.lassoPts.forEach((p, i) => { const v = VX.p2v(p); i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y); }); ctx.setLineDash([4, 3]); ctx.strokeStyle = '#4c8dff'; ctx.stroke(); ctx.setLineDash([]); }
    const zm = VX.zoomMarquee(); if (zm) { const a = VX.p2v(zm[0]), c = VX.p2v(zm[1]); ctx.setLineDash([4, 3]); ctx.strokeStyle = '#fff'; ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y); ctx.setLineDash([]); }
    // smart guides
    if (S.smart) {
      ctx.strokeStyle = '#ff3dbb'; ctx.lineWidth = 1; ctx.beginPath();
      for (const [a, b] of S.smart.lines || []) { const p = VX.p2v(a), q = VX.p2v(b); ctx.moveTo(Math.round(p.x) + .5, Math.round(p.y) + .5); ctx.lineTo(Math.round(q.x) + .5, Math.round(q.y) + .5); }
      ctx.stroke();
      if (S.smart.label && S.smart.at) { const v = VX.p2v(S.smart.at); label(ctx, S.smart.label, v.x + 10, v.y + 18, '#ff3dbb'); }
    }
    if (S.measure && S.cursorV) label(ctx, S.measure, S.cursorV.x + 14, S.cursorV.y + 26, '#3a4741');
  };
  function label(ctx, text, x, y, bg) {
    ctx.font = '600 11px Manrope, sans-serif'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x, y - 10, w, 20, 4); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(text, x + 6, y + .5);
  }
  function drawTextMarks(ctx, it) {
    // baseline + anchor of each line, and the frame of area type
    const m = gm(it);
    const n = Math.max(1, String(it.content).split('\n').length), lead = it.leading;
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const b = it.internalBounds; const y = i * lead; const a = m.transform(pt(b.left, y)), c = m.transform(pt(b.right, y)); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); }
    ctx.strokeStyle = colorOf(it); ctx.lineWidth = 1; ctx.stroke();
    if (it.data.area) {
      const r = VX.areaBox(it); const a = VX.p2v(r.topLeft), c = VX.p2v(r.bottomRight);
      ctx.setLineDash([3, 3]); ctx.strokeStyle = colorOf(it); ctx.strokeRect(a.x + .5, a.y + .5, c.x - a.x, c.y - a.y); ctx.setLineDash([]);
      if (it.data.overflow) { square(ctx, pt(c.x - 6, c.y), 9, '#ff4f6d', '#fff'); ctx.fillStyle = '#fff'; ctx.fillRect(c.x - 9, c.y - .5, 6, 1); ctx.fillRect(c.x - 6.5, c.y - 3, 1, 6); }
    }
  }
  function drawAnchors(ctx) {
    const leaves = [];
    const walk = it => { if (it.className === 'Path') leaves.push(it); else if (it.className === 'CompoundPath') leaves.push(...it.children); else if (it.children && it.className !== 'Layer' && it.children.length < 300) it.children.forEach(walk); };
    S.sel.forEach(walk);
    const allSel = !S.pts.size;
    for (const p of leaves) {
      if (!p.parent) continue;
      const m = gm(p), col = colorOf(p);
      const selSegs = p.segments.filter(s => allSel || S.pts.has(s));
      // handles for selected anchors and their neighbours' facing handles
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      const showH = new Set();
      for (const s of selSegs) { showH.add(s); if (s.previous) showH.add(s.previous); if (s.next) showH.add(s.next); }
      if (allSel && p.segments.length > 60) showH.clear();
      for (const s of showH) {
        const a = m.transform(s.point);
        for (const [hk, ok] of [['handleIn', selSegs.includes(s) || selSegs.includes(s.previous)], ['handleOut', selSegs.includes(s) || selSegs.includes(s.next)]]) {
          if (!ok || s[hk].isZero()) continue;
          const q = m.transform(s.point.add(s[hk]));
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(q.x, q.y); ctx.stroke(); dot(ctx, q, 3, col);
        }
      }
      if (p.segments.length > 4000) continue;
      for (const s of p.segments) { const a = m.transform(s.point); const on = allSel || S.pts.has(s); square(ctx, a, 6, on ? col : '#fff', col); }
    }
  }

  // ---------- live corner handles (rectangles) ----------
  function liveCornerHandles(it) {
    const L = it.data.live; const c = it.bounds.center;
    const probe = it.clone({ insert: false }); probe.rotate(-L.angle, c); const b = probe.bounds;
    const r = Math.max(L.r || 0, 0), inset = Math.max(r, 14 / VX.zoom()) * 0.72 + Math.min(r, 0) ;
    const corners = [[b.left + inset, b.top + inset], [b.right - inset, b.top + inset], [b.right - inset, b.bottom - inset], [b.left + inset, b.bottom - inset]];
    const m = new P.Matrix().rotate(L.angle, c);
    return corners.map(([x, y]) => { const p = m.transform(pt(x, y)); return { p, v: VX.p2v(p) }; });
  }

  // ---------- transform drag shared by Selection & friends ----------
  function beginTransform(kind, start, extra = {}) {
    const b = VX.selBounds();
    return { kind, b0: b.clone(), start, applied: new P.Matrix(), ...extra };
  }
  function applyIncremental(tf, M) {
    const inc = M.appended(tf.applied.inverted());
    VX.transformItems(S.sel, inc);
    tf.applied = M;
  }
  function anchorOfHandle(b, id, alt) {
    if (alt) return b.center;
    const x = id.includes('w') ? b.right : id.includes('e') ? b.left : b.center.x;
    const y = id.includes('n') ? b.bottom : id.includes('s') ? b.top : b.center.y;
    return pt(x, y);
  }
  function handlePoint(b, id) {
    const x = id.includes('w') ? b.left : id.includes('e') ? b.right : b.center.x;
    const y = id.includes('n') ? b.top : id.includes('s') ? b.bottom : b.center.y;
    return pt(x, y);
  }
  function scaleMatrix(tf, ev) {
    const id = tf.id, b = tf.b0;
    const anchor = anchorOfHandle(b, id, ev.alt), h0 = handlePoint(b, id);
    let p = ev.point;
    if (!ev.shift) p = snapPoint(p, { exclude: S.sel, tg: tf.tg });
    let sx = id === 'n' || id === 's' ? 1 : (p.x - anchor.x) / ((h0.x - anchor.x) || 1e-9);
    let sy = id === 'e' || id === 'w' ? 1 : (p.y - anchor.y) / ((h0.y - anchor.y) || 1e-9);
    const allText = S.sel.every(it => it.className === 'PointText' && !it.data.area);
    if (ev.shift || (allText && id.length === 2)) {
      if (id.length === 2) { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s; }
      else if (id === 'n' || id === 's') sx = Math.abs(sy); else sy = Math.abs(sx);
    }
    const fix = v => Math.abs(v) < 1e-3 ? 1e-3 * Math.sign(v || 1) : v;
    sx = fix(sx); sy = fix(sy);
    S.measure = `W: ${VX.fmtU(Math.abs(b.width * sx))}  H: ${VX.fmtU(Math.abs(b.height * sy))}`;
    return new P.Matrix().scale(sx, sy, anchor);
  }

  // ---------- Selection tool ----------
  T.select = {
    cursor: 'default',
    hover(ev) {
      const b = S.sel.length ? VX.selBounds() : null;
      const hd = handleAt(ev.v, b);
      if (hd) { setHoverCursor(hd.kind === 'rotate' ? 'rotate' : RESIZE_CURSOR[hd.id]); S.hover = null; return; }
      if (guideAt(ev.v)) { setHoverCursor(guideAt(ev.v).axis === 'x' ? 'col-resize' : 'row-resize'); S.hover = null; return; }
      const it = hitObject(ev.point);
      S.hover = it;
      setHoverCursor(it ? 'move-obj' : null);
    },
    down(ev) {
      S.measure = null; S.smart = null;
      const b = S.sel.length ? VX.selBounds() : null;
      // live corners
      if (S.sel.length === 1 && S.sel[0].data && S.sel[0].data.live && b) {
        const lc = liveCornerHandles(S.sel[0]).find(q => q.v.getDistance(ev.v) < 7);
        if (lc) { this.st = { kind: 'corner', it: S.sel[0], r0: S.sel[0].data.live.r || 0, p0: ev.point, c: S.sel[0].bounds.center }; return; }
      }
      const hd = handleAt(ev.v, b);
      if (hd) { this.st = beginTransform(hd.kind, ev.point, { id: hd.id, center: b.center, tg: collectTargets(S.sel) }); return; }
      const g = guideAt(ev.v);
      const it = hitObject(ev.point);
      if (g && !it) { this.st = { kind: 'guide' }; VX.startGuideDrag(ev.e, g.axis, g); return; }
      if (it) {
        if (ev.shift) { const was = S.sel.includes(it); VX.select([it], { toggle: true }); if (was) { this.st = null; return; } }
        else if (!S.sel.includes(it)) VX.select([it]);
        else this.maybeKey = it;
        this.st = beginTransform('move', ev.point, { dup: ev.alt, tg: collectTargets(S.sel) });
        return;
      }
      if (b && b.contains(ev.point) && !ev.shift) { this.st = beginTransform('move', ev.point, { dup: ev.alt, tg: collectTargets(S.sel) }); return; }
      this.st = { kind: 'marquee', add: ev.shift };
      if (!ev.shift && S.sel.length) VX.deselect();
    },
    drag(ev) {
      const st = this.st; if (!st) return;
      this.maybeKey = null;
      if (st.kind === 'corner') {
        const L = st.it.data.live; const d = ev.point.subtract(st.p0);
        const toC = st.c.subtract(st.p0).normalize();
        const r = Math.max(0, st.r0 + d.dot(toC) * 0.75);
        VX.setCornerRadius(st.it, r); S.measure = `Radius: ${VX.fmtU(L.r)}`; return;
      }
      if (st.kind === 'marquee') { S.marquee = new P.Rectangle(ev.start, ev.point); return; }
      if (st.kind === 'move') {
        if (st.dup && !st.duped) { st.duped = true; const clones = VX.sortByZ(S.sel).map(it => it.clone()); S.sel = clones; }
        let d = ev.point.subtract(ev.start);
        if (ev.shift) d = constrain(pt(0, 0), d);
        const moved = st.b0.clone(); moved.x += d.x; moved.y += d.y;
        const sn = snapRect(moved, st.tg, { x: !ev.shift || Math.abs(d.x) > 1e-9, y: !ev.shift || Math.abs(d.y) > 1e-9 });
        d = d.add([sn.dx, sn.dy]);
        S.smart = sn.lines.length ? { lines: sn.lines } : null;
        S.measure = `dX: ${VX.fmtU(d.x)}  dY: ${VX.fmtU(d.y)}`;
        applyIncremental(st, new P.Matrix().translate(d));
        VX.refreshPanels();
        return;
      }
      if (st.kind === 'scale') { applyIncremental(st, scaleMatrix(st, ev)); S.smart = S.smart; VX.refreshPanels(); return; }
      if (st.kind === 'rotate') {
        const a0 = ev.start.subtract(st.center).angle, a1 = ev.point.subtract(st.center).angle;
        let a = a1 - a0; if (ev.shift) a = Math.round(a / 45) * 45;
        S.measure = `${Math.round(-a * 10) / 10}°`;
        applyIncremental(st, new P.Matrix().rotate(a, st.center)); VX.refreshPanels();
      }
    },
    up(ev) {
      const st = this.st; this.st = null; S.smart = null; S.measure = null;
      if (this.maybeKey && !ev.moved) { const k = this.maybeKey; this.maybeKey = null; if (S.sel.length > 1) { S.key = S.key === k ? null : k; VX.refreshPanels(true); } return; }
      this.maybeKey = null;
      if (!st) return;
      if (st.kind === 'marquee') {
        const r = S.marquee; S.marquee = null;
        if (r && (r.width > 0 || r.height > 0)) VX.select(itemsInRect(r), { add: st.add });
        return;
      }
      if (st.kind === 'corner') { VX.commit('Corner radius'); return; }
      if (!ev.moved) return;
      const M = st.applied;
      if (st.kind === 'move') VX.recordTf(M.clone(), !!st.duped);
      else { const c0 = st.b0.center; const rel = M.clone(); VX.recordTf(null, false, cc => new P.Matrix().translate(cc.subtract(c0)).appended(rel).appended(new P.Matrix().translate(c0.subtract(cc)))); }
      VX.commit(st.kind === 'move' ? (st.duped ? 'Duplicate' : 'Move') : st.kind === 'scale' ? 'Scale' : 'Rotate');
    },
    dblclick(ev) {
      const r = VX.hit(ev.point);
      if (!r) { if (S.isolation) VX.exitIsolation(); return; }
      const it = VX.topOf(r.item);
      if (!it) return;
      if (VX.isPathText(it)) { VX.editPathText(it); return; }
      if (it.className === 'PointText') { VX.setTool('text'); VX.editText(it); return; }
      if (it.className === 'Group' && it.children.length) {
        VX.enterIsolation(it);
        const inner = VX.topOf(r.item); if (inner) VX.select([inner]);
      }
    },
    cancel() { if (this.st && this.st.kind !== 'marquee') return false; return false; },
  };
  function itemsInRect(r) {
    const out = []; const rp = new P.Path.Rectangle({ rectangle: r, insert: false });
    const kids = S.isolation ? S.isolation.children : S.project.layers.flatMap(L => L.visible && !L.locked ? L.children : []);
    for (const it of kids) {
      if (!VX.selectable(it)) continue;
      const b = it.bounds; if (!b.intersects(r)) continue;
      if (r.contains(b) || it.className === 'PointText' || it.className === 'Raster' || it.className === 'Group' ? true : it.intersects(rp) || it.contains(r.center) || (it.hitTest && it.hitTest(r.center))) out.push(it);
      else if (it.className === 'Path' || it.className === 'CompoundPath') { if (it.getIntersections && it.getIntersections(rp).length) out.push(it); }
    }
    return out;
  }
  function guideAt(v) {
    if (!S.show.guides || !S.doc) return null;
    for (const g of S.doc.guides) { const p = VX.p2v(pt(g.pos, g.pos)); if (g.axis === 'x' ? Math.abs(p.x - v.x) < 4 : Math.abs(p.y - v.y) < 4) return g; }
    return null;
  }
  VX.startGuideDrag = (e, axis, existing) => {
    const g = existing || { axis, pos: 0 };
    if (!existing) S.doc.guides.push(g);
    S.show.guides = true;
    const move = ev => {
      const r = S.el.over.getBoundingClientRect(); const p = VX.v2p(ev.clientX - r.left, ev.clientY - r.top);
      let v = axis === 'x' ? p.x : p.y;
      if (!ev.shiftKey) v = Math.round(v); else { const gs = S.doc.grid.size / (S.doc.grid.sub || 1); v = Math.round(v / gs) * gs; }
      g.pos = v; S.measure = `${axis === 'x' ? 'X' : 'Y'}: ${VX.fmtU(v - (axis === 'x' ? S.doc.artboards[S.doc.ab].x : S.doc.artboards[S.doc.ab].y))}`; S.cursorV = pt(ev.clientX - r.left, ev.clientY - r.top); VX.req();
    };
    const up = ev => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
      const r = S.el.over.getBoundingClientRect(); const x = ev.clientX - r.left, y = ev.clientY - r.top;
      S.measure = null;
      if ((axis === 'x' && x < VX.RULER) || (axis === 'y' && y < VX.RULER) || x < 0 || y < 0 || x > r.width || y > r.height) { S.doc.guides.splice(S.doc.guides.indexOf(g), 1); VX.commit('Delete guide'); }
      else VX.commit(existing ? 'Move guide' : 'Add guide');
    };
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
  };

  // ---------- Direct Selection ----------
  const leavesOfSel = () => { const out = []; const walk = it => { if (it.className === 'Path') out.push(it); else if (it.className === 'CompoundPath') out.push(...it.children); else if (it.children && it.className !== 'Layer') it.children.forEach(walk); }; S.sel.forEach(walk); return out; };
  function handleHit(v) {
    for (const p of leavesOfSel()) {
      const m = gm(p);
      const sel = S.pts.size ? p.segments.filter(s => S.pts.has(s)) : p.segments.length <= 60 ? p.segments : [];
      const cand = new Set(); sel.forEach(s => { cand.add(s); s.previous && cand.add(s.previous); s.next && cand.add(s.next); });
      for (const s of cand) for (const hk of ['handleIn', 'handleOut']) {
        if (s[hk].isZero()) continue;
        const owner = hk === 'handleIn' ? (sel.includes(s) || sel.includes(s.previous)) : (sel.includes(s) || sel.includes(s.next));
        if (!owner) continue;
        if (m.transform(s.point.add(s[hk])).getDistance(v) < 6) return { seg: s, hk, path: p };
      }
    }
    return null;
  }
  function anchorHit(point) {
    // anchors of selected paths first, then any selectable path
    const v = VX.p2v(point);
    for (const p of leavesOfSel()) { const m = gm(p); for (const s of p.segments) if (m.transform(s.point).getDistance(v) < 6) return { seg: s, path: p }; }
    const r = VX.hit(point, { segments: true, fill: false, stroke: false, tol: 5 });
    if (r && r.segment) return { seg: r.segment, path: r.item };
    return null;
  }
  const smoothish = s => !s.handleIn.isZero() && !s.handleOut.isZero() && Math.abs(s.handleIn.normalize().dot(s.handleOut.normalize()) + 1) < 0.02;
  T.direct = {
    cursor: 'direct',
    hover(ev) {
      S.hover = null;
      if (handleHit(ev.v)) return setHoverCursor('direct-pt');
      if (anchorHit(ev.point)) return setHoverCursor('direct-pt');
      const r = VX.hit(ev.point); S.hover = r ? VX.leafOf(r.item) : null;
      setHoverCursor(r ? 'direct-obj' : null);
    },
    down(ev) {
      S.smart = null; S.measure = null;
      const hh = handleHit(ev.v);
      if (hh) { this.st = { kind: 'handle', ...hh, smooth: smoothish(hh.seg) }; return; }
      const ah = anchorHit(ev.point);
      if (ah) {
        const leaf = VX.leafOf(ah.path);
        if (ev.shift) { if (S.pts.has(ah.seg)) S.pts.delete(ah.seg); else { if (!S.pts.size) leavesOfSel().forEach(p => { if (S.sel.includes(VX.leafOf(p)) && !S.pts.size) {} }); S.pts.add(ah.seg); } if (!S.sel.includes(leaf)) S.sel.push(leaf); }
        else if (!S.pts.has(ah.seg)) { S.pts.clear(); S.pts.add(ah.seg); S.sel = [leaf]; }
        VX.selectionChanged();
        this.st = { kind: 'points', last: pt(0, 0), anchor: ah.seg, tg: null };
        return;
      }
      const r = VX.hit(ev.point);
      if (r) {
        const leaf = VX.leafOf(r.item);
        const isPath = leaf.className === 'Path' || leaf.className === 'CompoundPath';
        if (isPath && r.type === 'stroke' && S.sel.includes(leaf) && S.pts.size && r.location) {
          // drag the curve segment itself to reshape it
          const loc = r.location; this.st = { kind: 'bend', curve: loc.curve, t: loc.time, last: ev.point }; return;
        }
        if (ev.shift) { const i = S.sel.indexOf(leaf); if (i >= 0) S.sel.splice(i, 1); else S.sel.push(leaf); }
        else if (!S.sel.includes(leaf) || S.pts.size) { S.sel = [leaf]; }
        S.pts.clear();
        VX.selectionChanged();
        this.st = { kind: 'objects', last: pt(0, 0), tg: collectTargets(S.sel) };
        return;
      }
      this.st = { kind: 'marquee', add: ev.shift };
      if (!ev.shift) { S.pts.clear(); S.sel = []; VX.selectionChanged(); }
    },
    drag(ev) {
      const st = this.st; if (!st) return;
      if (st.kind === 'marquee') { S.marquee = new P.Rectangle(ev.start, ev.point); return; }
      if (st.kind === 'handle') {
        const s = st.seg, m = s.path.globalMatrix.inverted();
        let p = ev.point; if (ev.shift) p = constrain(s.path.globalMatrix.transform(s.point), p);
        const local = m.transform(p).subtract(s.point);
        const other = st.hk === 'handleIn' ? 'handleOut' : 'handleIn';
        s[st.hk] = local;
        if (st.smooth && !ev.alt) s[other] = local.normalize(-s[other].length);
        return;
      }
      if (st.kind === 'bend') {
        const d = ev.point.subtract(st.last); st.last = ev.point;
        const c = st.curve, t = st.t, w1 = 3 * (1 - t) * (1 - t) * t, w2 = 3 * (1 - t) * t * t, n = w1 * w1 + w2 * w2 || 1;
        const inv = c.path.globalMatrix.inverted(); const dl = inv.transform(d).subtract(inv.transform(pt(0, 0)));
        c.handle1 = c.handle1.add(dl.multiply(w1 / n)); c.handle2 = c.handle2.add(dl.multiply(w2 / n));
        return;
      }
      if (st.kind === 'points') {
        let d = ev.point.subtract(ev.start); if (ev.shift) d = constrain(pt(0, 0), d);
        if (!ev.shift && st.anchor && st.anchor.path) { const a0 = st.anchor.path.globalMatrix.transform(st.anchor.point).subtract(st.last); const sp = snapPoint(a0.add(d), { exclude: [st.anchor.path] }); d = sp.subtract(a0); }
        const inc = d.subtract(st.last); st.last = d;
        for (const s of S.pts) { const inv = s.path.globalMatrix.inverted(); s.point = s.point.add(inv.transform(inc).subtract(inv.transform(pt(0, 0)))); }
        S.measure = `dX: ${VX.fmtU(d.x)}  dY: ${VX.fmtU(d.y)}`;
        return;
      }
      if (st.kind === 'objects') {
        let d = ev.point.subtract(ev.start); if (ev.shift) d = constrain(pt(0, 0), d);
        if (ev.alt && !st.duped) { st.duped = true; S.sel = S.sel.map(it => it.clone()); }
        const b = VX.selBounds(); if (b) { const moved = b.clone(); moved.x += d.x - st.last.x; moved.y += d.y - st.last.y; const sn = snapRect(moved, st.tg); d = d.add([sn.dx, sn.dy]); S.smart = sn.lines.length ? { lines: sn.lines } : null; }
        const inc = d.subtract(st.last); st.last = d;
        VX.transformItems(S.sel, new P.Matrix().translate(inc));
        S.measure = `dX: ${VX.fmtU(d.x)}  dY: ${VX.fmtU(d.y)}`;
      }
    },
    up(ev) {
      const st = this.st; this.st = null; S.measure = null; S.smart = null;
      if (!st) return;
      if (st.kind === 'marquee') {
        const r = S.marquee; S.marquee = null; if (!r) return;
        selectPointsIn(p => r.contains(p), st.add);
        return;
      }
      if (ev.moved) { for (const it of S.sel) if (it.data && it.data.live) delete it.data.live; VX.commit({ handle: 'Edit handle', bend: 'Reshape curve', points: 'Move anchor points', objects: st.duped ? 'Duplicate' : 'Move' }[st.kind]); }
      VX.refreshPanels();
    },
    dblclick(ev) { const r = VX.hit(ev.point); if (r && r.item.className === 'PointText') { VX.setTool('text'); VX.editText(r.item); } },
  };
  function selectPointsIn(test, add) {
    if (!add) S.pts.clear();
    const paths = [];
    for (const L of S.project.layers) if (L.visible && !L.locked) L.getItems({ class: P.Path, match: p => VX.selectable(p) && inScope(p) }).forEach(p => paths.push(p));
    const sel = new Set(add ? S.sel : []);
    for (const p of paths) {
      const m = p.globalMatrix; let any = false;
      for (const s of p.segments) if (test(m.transform(s.point))) { S.pts.add(s); any = true; }
      if (any) sel.add(VX.leafOf(p));
    }
    S.sel = [...sel];
    VX.selectionChanged();
  }

  // ---------- Lasso ----------
  T.lasso = {
    cursor: 'lasso',
    down(ev) { S.lassoPts = [ev.point]; this.add = ev.shift; },
    drag(ev) { S.lassoPts.push(ev.point); },
    up() {
      const pts = S.lassoPts || []; S.lassoPts = null;
      if (pts.length < 3) return;
      const poly = new P.Path({ segments: pts, closed: true, insert: false });
      selectPointsIn(p => poly.contains(p), this.add);
    },
  };

  // ---------- Pen ----------
  const pen = { path: null, mode: null };
  VX.pen = pen;
  function penFinish(commit = true) {
    const p = pen.path; pen.path = null; pen.mode = null; S.smart = null;
    if (!p) return;
    if (p.segments.length < 2) { p.remove(); S.sel = S.sel.filter(x => x !== p); VX.selectionChanged(); if (commit) VX.commit('Pen'); return; }
    if (commit) VX.commit('Pen path');
    VX.req();
  }
  VX.penFinish = penFinish;
  function penHint(ev) {
    if (pen.path) {
      const first = pen.path.firstSegment;
      if (pen.path.segments.length > 1 && VX.p2v(pen.path.globalMatrix.transform(first.point)).getDistance(ev.v) < 7) return { kind: 'close' };
      const last = pen.path.lastSegment;
      if (VX.p2v(pen.path.globalMatrix.transform(last.point)).getDistance(ev.v) < 7) return { kind: 'convert-last' };
      return { kind: 'add-point' };
    }
    // endpoints of selected open paths: continue
    for (const p of leavesOfSel()) if (!p.closed) for (const s of [p.firstSegment, p.lastSegment]) if (VX.p2v(p.globalMatrix.transform(s.point)).getDistance(ev.v) < 7) return { kind: 'continue', path: p, seg: s };
    const ah = anchorHit(ev.point);
    if (ah && S.sel.includes(VX.leafOf(ah.path))) return { kind: 'delete', ...ah };
    const r = VX.hit(ev.point, { fill: false, stroke: true, tol: 4 });
    if (r && r.location && S.sel.includes(VX.leafOf(r.item))) return { kind: 'add', loc: r.location, path: r.item };
    return { kind: 'new' };
  }
  T.pen = {
    cursor: 'pen',
    activate() { pen.mode = null; },
    deactivate() { penFinish(true); },
    cancel() { if (pen.path) { penFinish(true); return true; } return false; },
    hover(ev) {
      const hnt = penHint(ev); this.hint = hnt;
      setHoverCursor({ close: 'pen-close', 'convert-last': 'pen-convert', continue: 'pen-cont', delete: 'pen-del', add: 'pen-add', new: pen.path ? 'pen' : 'pen-new', 'add-point': 'pen' }[hnt.kind]);
      if (pen.path && hnt.kind === 'add-point') { let p = ev.point; if (ev.shift) p = constrain(pen.path.globalMatrix.transform(pen.path.lastSegment.point), p); else p = snapPoint(p, { exclude: [pen.path] }); this.preview = p; } else { this.preview = null; S.smart = null; }
    },
    down(ev) {
      const hnt = penHint(ev);
      if (hnt.kind === 'close') { pen.path.closed = true; pen.mode = 'close'; return; }
      if (hnt.kind === 'convert-last') { pen.path.lastSegment.handleOut = null; pen.mode = 'convert-last'; return; }
      if (hnt.kind === 'continue') {
        pen.path = hnt.path; if (hnt.seg === hnt.path.firstSegment) hnt.path.reverse();
        S.sel = [VX.leafOf(hnt.path)]; S.pts = new Set([pen.path.lastSegment]); pen.mode = 'drag-cont'; VX.selectionChanged(); return;
      }
      if (hnt.kind === 'delete') { hnt.path.removeSegment(hnt.seg.index); if (hnt.path.segments.length < 2) hnt.path.remove(); VX.commit('Delete anchor point'); pen.mode = null; return; }
      if (hnt.kind === 'add') { const s = hnt.path.divideAt(hnt.loc); if (s) { S.pts = new Set([s]); } VX.commit('Add anchor point'); pen.mode = null; return; }
      let p = ev.point;
      if (pen.path) { if (ev.shift) p = constrain(pen.path.globalMatrix.transform(pen.path.lastSegment.point), p); else p = snapPoint(p, { exclude: [pen.path] }); }
      else p = snapPoint(p);
      if (!pen.path) {
        const path = new P.Path({ segments: [p] });
        (S.isolation || S.project.activeLayer).addChild(path);
        VX.styleNew(path, { fill: true, stroke: true });
        if (!path.strokeColor && !path.fillColor) path.strokeColor = new P.Color('#000');
        pen.path = path; S.sel = [path]; S.pts = new Set([path.firstSegment]);
      } else {
        const local = pen.path.globalMatrix.inverted().transform(p);
        pen.path.add(local); S.pts = new Set([pen.path.lastSegment]);
      }
      pen.mode = 'drag-new'; S.smart = null;
      VX.selectionChanged();
    },
    drag(ev) {
      if (!pen.path) return;
      const inv = pen.path.globalMatrix.inverted();
      const seg = pen.mode === 'close' ? pen.path.firstSegment : pen.path.lastSegment;
      if (!seg) return;
      let target = ev.point; if (ev.shift) target = constrain(pen.path.globalMatrix.transform(seg.point), target);
      const v = inv.transform(target).subtract(seg.point);
      if (pen.mode === 'close') { seg.handleIn = v.multiply(-1); if (!ev.alt) seg.handleOut = v; return; }
      if (pen.mode === 'convert-last') { seg.handleOut = v; return; }
      seg.handleOut = v; if (!ev.alt) seg.handleIn = v.multiply(-1);
    },
    up() {
      if (pen.mode === 'close') { penFinish(true); return; }
      if (pen.path) VX.commit('Pen point');
      pen.mode = null;
    },
    key(e) {
      if (!pen.path) return false;
      if (e.key === 'Enter' || e.key === 'Escape') { penFinish(true); VX.req(); return true; }
      if ((e.key === 'Backspace' || e.key === 'Delete') && pen.path.segments.length) { pen.path.removeSegment(pen.path.segments.length - 1); if (!pen.path.segments.length) { pen.path.remove(); pen.path = null; } VX.commit('Delete anchor point'); return true; }
      return false;
    },
    overlay(ctx) {
      if (!pen.path || !this.preview || VX.dragging()) return;
      const last = pen.path.lastSegment, m = pen.path.globalMatrix;
      const a = VX.p2v(m.transform(last.point)), c1 = VX.p2v(m.transform(last.point.add(last.handleOut))), b = VX.p2v(this.preview);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(c1.x, c1.y, b.x, b.y, b.x, b.y); ctx.strokeStyle = '#4c8dff'; ctx.lineWidth = 1; ctx.stroke();
    },
  };
  VX.onRestore = () => { pen.path = null; pen.mode = null; curv.path = null; };

  // Add / delete / convert anchor tools
  T.addAnchor = {
    cursor: 'pen-add',
    down(ev) {
      const r = VX.hit(ev.point, { fill: false, stroke: true, tol: 5 });
      if (!r || !r.location || !(r.item.className === 'Path')) return toast('Click on a path segment to add an anchor point.', 'info', 1600);
      const s = r.item.divideAt(r.location); if (s) { S.sel = [VX.leafOf(r.item)]; S.pts = new Set([s]); }
      if (r.item.data.live) delete r.item.data.live;
      VX.selectionChanged(); VX.commit('Add anchor point');
    },
  };
  T.delAnchor = {
    cursor: 'pen-del',
    down(ev) {
      const ah = anchorHit(ev.point);
      if (!ah) return;
      ah.path.removeSegment(ah.seg.index); if (ah.path.data.live) delete ah.path.data.live;
      if (ah.path.segments.length < 2) ah.path.remove();
      S.pts.clear(); VX.selectionChanged(); VX.commit('Delete anchor point');
    },
  };
  T.convert = {
    cursor: 'convert',
    down(ev) {
      const hh = handleHit(ev.v);
      if (hh) { this.st = { kind: 'handle', ...hh }; return; }
      const ah = anchorHit(ev.point);
      if (!ah) { this.st = null; return; }
      if (ah.path.data.live) delete ah.path.data.live;
      S.sel = [VX.leafOf(ah.path)]; S.pts = new Set([ah.seg]); VX.selectionChanged();
      this.st = { kind: 'anchor', seg: ah.seg };
    },
    drag(ev) {
      const st = this.st; if (!st) return;
      const s = st.seg, inv = s.path.globalMatrix.inverted();
      const v = inv.transform(ev.point).subtract(s.point);
      if (st.kind === 'handle') { s[st.hk] = v; return; }
      s.handleOut = v; s.handleIn = v.multiply(-1);
    },
    up(ev) {
      const st = this.st; this.st = null; if (!st) return;
      if (!ev.moved && st.kind === 'anchor') { const s = st.seg; if (s.hasHandles()) { s.handleIn = null; s.handleOut = null; } else s.smooth({ type: 'catmull-rom' }); }
      VX.commit('Convert anchor point');
    },
  };

  // ---------- Curvature ----------
  const curv = { path: null };
  function curvRebuild(p) {
    const corners = p.data.corners || [];
    if (p.segments.length > 2 || (p.closed && p.segments.length > 1)) p.smooth({ type: 'catmull-rom', factor: 0.5 });
    p.segments.forEach((s, i) => { if (corners[i]) { s.handleIn = null; s.handleOut = null; } });
    if (!p.closed && p.segments.length) { p.firstSegment.handleIn = null; p.lastSegment.handleOut = null; }
  }
  T.curvature = {
    cursor: 'pen',
    deactivate() { if (curv.path) { if (curv.path.segments.length < 2) curv.path.remove(); curv.path = null; VX.commit('Curvature'); } },
    cancel() { if (curv.path) { this.deactivate(); return true; } return false; },
    hover(ev) { this.preview = curv.path ? snapPoint(ev.point, { exclude: [curv.path] }) : null; const a = anchorHit(ev.point); setHoverCursor(a ? 'direct-pt' : curv.path && curv.path.segments.length > 1 && VX.p2v(curv.path.firstSegment.point).getDistance(ev.v) < 7 ? 'pen-close' : 'pen'); },
    down(ev) {
      const a = anchorHit(ev.point);
      if (a && (a.path === curv.path || S.sel.includes(VX.leafOf(a.path)))) {
        if (curv.path && a.seg === curv.path.firstSegment && curv.path.segments.length > 2 && !curv.path.closed) { curv.path.closed = true; curvRebuild(curv.path); curv.path = null; VX.commit('Close path'); return; }
        this.st = { seg: a.seg, path: a.path }; if (a.path.data.live) delete a.path.data.live; S.pts = new Set([a.seg]); return;
      }
      const p = snapPoint(ev.point, { exclude: curv.path ? [curv.path] : [] });
      if (!curv.path) {
        const path = new P.Path({ segments: [p] }); (S.isolation || S.project.activeLayer).addChild(path);
        VX.styleNew(path); if (!path.strokeColor) { path.strokeColor = new P.Color('#000'); path.strokeWidth = path.strokeWidth || 1; }
        path.fillColor = null; path.data.corners = [ev.alt];
        curv.path = path; S.sel = [path];
      } else {
        curv.path.add(curv.path.globalMatrix.inverted().transform(p)); curv.path.data.corners = [...(curv.path.data.corners || []), ev.alt];
        curvRebuild(curv.path);
      }
      S.pts = new Set([curv.path.lastSegment]); VX.selectionChanged();
    },
    drag(ev) { const st = this.st; if (!st) return; st.seg.point = st.path.globalMatrix.inverted().transform(snapPoint(ev.point, { exclude: [st.path] })); if (st.path.data.corners) curvRebuild(st.path); },
    up() { if (this.st) { this.st = null; VX.commit('Move point'); } else if (curv.path) VX.commit('Curvature point'); },
    dblclick(ev) { const a = anchorHit(ev.point); if (!a) return; const p = a.path; const c = p.data.corners || (p.data.corners = p.segments.map(() => false)); c[a.seg.index] = !c[a.seg.index]; curvRebuild(p); VX.commit('Toggle corner'); },
    key(e) { if (curv.path && (e.key === 'Enter' || e.key === 'Escape')) { this.deactivate(); VX.req(); return true; } return false; },
    overlay(ctx) {
      if (!curv.path || !this.preview || VX.dragging()) return;
      const tmp = curv.path.clone({ insert: false }); tmp.add(curv.path.globalMatrix.inverted().transform(this.preview)); tmp.data.corners = [...(curv.path.data.corners || []), false]; curvRebuild(tmp);
      ctx.beginPath(); tracePath(ctx, tmp, gm(curv.path)); ctx.strokeStyle = '#4c8dff'; ctx.lineWidth = 1; ctx.stroke();
    },
  };

  // ---------- shapes ----------
  function shapeRect(ev, square) {
    let a = ev.start, b = ev.shift && !square ? null : null;
    let p = ev.point;
    if (!ev.shift) p = snapPoint(p);
    let d = p.subtract(a);
    if (ev.shift) { const m = Math.max(Math.abs(d.x), Math.abs(d.y)); d = pt(Math.sign(d.x || 1) * m, Math.sign(d.y || 1) * m); }
    void b;
    if (ev.alt) return new P.Rectangle(a.subtract(d), a.add(d));
    return new P.Rectangle(a, a.add(d));
  }
  function makeShape(kind, r, ev) {
    const o = O[kind] || {};
    switch (kind) {
      case 'rect': { const path = new P.Path.Rectangle({ rectangle: r, radius: Math.min(o.radius || 0, r.width / 2, r.height / 2), insert: false }); path.data.live = { kind: 'rect', angle: 0, r: Math.min(o.radius || 0, r.width / 2, r.height / 2) }; return path; }
      case 'ellipse': { const p = new P.Path.Ellipse({ rectangle: r, insert: false }); p.data.shape = 'Ellipse'; return p; }
      case 'polygon': {
        const c = ev.start, rad = Math.max(1, ev.point.getDistance(c));
        const p = new P.Path.RegularPolygon({ center: c, sides: clamp(o.sides | 0, 3, 100), radius: rad, insert: false });
        if (!ev.shift) p.rotate(ev.point.subtract(c).angle + 90, c);
        p.data.shape = 'Polygon'; return p;
      }
      case 'star': {
        const c = ev.start, rad = Math.max(1, ev.point.getDistance(c));
        const p = new P.Path.Star({ center: c, points: clamp(o.points | 0, 3, 100), radius1: rad, radius2: rad * clamp(o.ratio, 1, 99) / 100, insert: false });
        if (!ev.shift) p.rotate(ev.point.subtract(c).angle + 90, c);
        p.data.shape = 'Star'; return p;
      }
      case 'line': { let b = ev.shift ? constrain(ev.start, ev.point) : snapPoint(ev.point); return new P.Path({ segments: [ev.start, b], insert: false }); }
      case 'arc': {
        const a = ev.start, b = ev.shift ? (() => { const d = ev.point.subtract(a); const m = Math.max(Math.abs(d.x), Math.abs(d.y)); return a.add([Math.sign(d.x || 1) * m, Math.sign(d.y || 1) * m]); })() : ev.point;
        const k = 0.5523, corner = o.concave ? pt(a.x, b.y) : pt(b.x, a.y);
        const p = new P.Path({ insert: false });
        p.add(new P.Segment(a, null, corner.subtract(a).multiply(k)));
        p.add(new P.Segment(b, corner.subtract(b).multiply(k), null));
        if (o.closed) { p.add(corner); p.closed = true; }
        p.data.shape = 'Arc'; return p;
      }
      case 'spiral': {
        const c = ev.start, rad = Math.max(1, ev.point.getDistance(c)), turns = clamp(o.turns, 1, 20), decay = clamp(o.decay, 5, 99) / 100;
        const p = new P.Path({ insert: false });
        const start = ev.point.subtract(c).angle;
        let r = rad; const steps = turns * 4;
        const pts = [];
        for (let i = 0; i <= steps; i++) { const ang = start + i * 90; pts.push(c.add(new P.Point({ length: r, angle: ang }))); r *= Math.pow(decay, 0.25); }
        p.addSegments(pts); p.smooth({ type: 'catmull-rom' });
        p.data.shape = 'Spiral'; return p;
      }
    }
    return null;
  }
  const shapeTool = kind => ({
    cursor: 'crosshair',
    hover(ev) { snapPoint(ev.point); },
    down(ev) { this.start = snapPoint(ev.point); ev.start = this.start; this.preview = null; S.smart = null; },
    drag(ev) {
      ev.start = this.start;
      const r = shapeRect(ev);
      const shp = makeShape(kind, r, ev);
      this.preview = shp;
      if (kind === 'rect' || kind === 'ellipse') S.measure = `W: ${VX.fmtU(r.width)}  H: ${VX.fmtU(r.height)}`;
      else S.measure = kind === 'line' ? `L: ${VX.fmtU(ev.point.getDistance(this.start))}  ${Math.round(-ev.point.subtract(this.start).angle)}°` : null;
    },
    up(ev) {
      S.measure = null; S.smart = null;
      const shp = this.preview; this.preview = null;
      if (!ev.moved) return clickShapeDialog(kind, this.start);
      if (!shp || shp.bounds.width + shp.bounds.height < 0.5) return;
      place(shp, kind);
    },
    overlay(ctx) { if (this.preview && VX.dragging()) { ctx.beginPath(); traceItem(ctx, this.preview); ctx.strokeStyle = '#4c8dff'; ctx.lineWidth = 1; ctx.stroke(); } },
  });
  function place(shp, kind) {
    (S.isolation || S.project.activeLayer).addChild(shp);
    const open = kind === 'line' || (kind === 'arc' && !O.arc.closed) || kind === 'spiral';
    VX.styleNew(shp, { fill: !open, stroke: true });
    if (open && !shp.strokeColor) { shp.strokeColor = new P.Color('#000'); shp.strokeWidth = shp.strokeWidth || 1; }
    if (!shp.fillColor && !shp.strokeColor) shp.strokeColor = new P.Color('#000');
    VX.select([shp]); VX.commit({ rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', line: 'Line', arc: 'Arc', spiral: 'Spiral' }[kind]);
  }
  function clickShapeDialog(kind, at) {
    const u = VX.unitLabel();
    const F = { rect: [['w', 'Width', 100], ['h', 'Height', 100], ['r', 'Corner radius', O.rect.radius]], ellipse: [['w', 'Width', 100], ['h', 'Height', 100]], polygon: [['r', 'Radius', 50], ['n', 'Sides', O.polygon.sides, true]], star: [['r1', 'Radius 1', 50], ['r2', 'Radius 2', 25], ['n', 'Points', O.star.points, true]], line: [['l', 'Length', 100], ['a', 'Angle', 0, true]], arc: [['w', 'Length X', 100], ['h', 'Length Y', 100]], spiral: [['r', 'Radius', 50], ['d', 'Decay %', O.spiral.decay, true], ['t', 'Turns', O.spiral.turns, true]] }[kind];
    if (!F) return;
    const body = h(`<div class="stack">${F.map(([k, l, v, raw]) => `<label class="field"><span>${l}</span><span class="num-wrap"><input type="number" step="any" data-k="${k}" value="${raw ? v : VX.fmtU(v)}"><em>${raw ? (k === 'a' ? '°' : '') : u}</em></span></label>`).join('')}</div>`);
    modal({ title: { rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', line: 'Line segment', arc: 'Arc', spiral: 'Spiral' }[kind], body, width: 320, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'OK', kind: 'primary', onClick: () => {
      const v = Object.fromEntries(F.map(([k, , , raw]) => [k, raw ? Number($(`[data-k="${k}"]`, body).value) : VX.fromU(Number($(`[data-k="${k}"]`, body).value))]));
      let shp;
      if (kind === 'rect') { const r = new P.Rectangle(at.x, at.y, Math.max(0.1, v.w), Math.max(0.1, v.h)); shp = new P.Path.Rectangle({ rectangle: r, radius: v.r, insert: false }); shp.data.live = { kind: 'rect', angle: 0, r: v.r }; }
      else if (kind === 'ellipse') { shp = new P.Path.Ellipse({ rectangle: new P.Rectangle(at.x, at.y, v.w, v.h), insert: false }); shp.data.shape = 'Ellipse'; }
      else if (kind === 'polygon') { O.polygon.sides = clamp(v.n | 0, 3, 100); shp = makeShape('polygon', null, { start: at, point: at.add([0, -v.r]), shift: true }); }
      else if (kind === 'star') { O.star.points = clamp(v.n | 0, 3, 100); O.star.ratio = clamp(v.r2 / v.r1 * 100, 1, 99); shp = makeShape('star', null, { start: at, point: at.add([0, -v.r1]), shift: true }); }
      else if (kind === 'line') shp = new P.Path({ segments: [at, at.add(new P.Point({ length: v.l, angle: -v.a }))], insert: false });
      else if (kind === 'arc') shp = makeShape('arc', null, { start: at, point: at.add([v.w, v.h]) });
      else if (kind === 'spiral') { O.spiral.decay = v.d; O.spiral.turns = v.t; shp = makeShape('spiral', null, { start: at, point: at.add([v.r, 0]) }); }
      if (shp) place(shp, kind);
    } }] });
  }
  for (const k of ['rect', 'ellipse', 'polygon', 'star', 'line', 'arc', 'spiral']) T[k] = shapeTool(k);

  // ---------- Pencil / Paintbrush ----------
  const freehand = kind => ({
    cursor: kind === 'brush' ? 'brush' : 'pencil',
    down(ev) { this.pts = [ev.point]; },
    drag(ev) { this.pts.push(ev.point); },
    up(ev) {
      const pts = this.pts || []; this.pts = null;
      if (pts.length < 2) return;
      const p = new P.Path({ segments: pts, insert: false });
      const o = O[kind];
      p.simplify(0.3 + Math.pow((o.smooth || 0) / 100, 1.6) * 14 / Math.max(0.15, VX.zoom()));
      const closeIt = VX.p2v(pts[0]).getDistance(VX.p2v(pts[pts.length - 1])) < 10 && pts.length > 8;
      if (closeIt) { p.closed = true; }
      (S.isolation || S.project.activeLayer).addChild(p);
      VX.styleNew(p, { fill: kind === 'pencil' ? (o.fill || closeIt) && !!S.fill : false, stroke: true });
      if (!p.strokeColor) p.strokeColor = S.fill && kind === 'brush' ? S.fill.clone() : new P.Color('#000');
      if (kind === 'brush') { p.strokeCap = 'round'; p.strokeJoin = 'round'; p.strokeWidth = o.width || p.strokeWidth; }
      if (!(p.strokeWidth > 0)) p.strokeWidth = 1;
      VX.select([p]); VX.commit(kind === 'brush' ? 'Paintbrush' : 'Pencil');
    },
    overlay(ctx) {
      if (!this.pts || this.pts.length < 2) return;
      ctx.beginPath(); this.pts.forEach((p, i) => { const v = VX.p2v(p); i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y); });
      const c = S.stroke && S.stroke.type !== 'gradient' ? S.stroke.toCSS(true) : '#000';
      ctx.strokeStyle = c; ctx.lineCap = ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1, (kind === 'brush' ? O.brush.width : S.strokeStyle.width) * VX.zoom()); ctx.stroke();
    },
  });
  T.pencil = freehand('pencil');
  T.brush = freehand('brush');

  // ---------- Eraser & Knife (boolean cuts along a freehand stroke) ----------
  const targetShapes = r => {
    const pool = S.sel.length ? VX.pathLeaves(S.sel) : S.project.layers.flatMap(L => L.visible && !L.locked ? L.getItems({ match: it => (it.className === 'Path' || it.className === 'CompoundPath') && !(it.parent && it.parent.className === 'CompoundPath') && !it.clipMask }) : []);
    return pool.filter(p => VX.selectable(p) && inScope(p) && p.bounds.intersects(r));
  };
  T.eraser = {
    cursor: 'eraser',
    down(ev) { this.pts = [ev.point]; },
    drag(ev) { this.pts.push(ev.point); },
    async up() {
      const pts = this.pts || []; this.pts = null; if (pts.length < 2) pts.push(pts[0].add([0.1, 0]));
      const O2 = await VX.needOffset();
      const line = new P.Path({ segments: pts, insert: false }); line.simplify(0.5 / VX.zoom());
      const rad = O.eraser.size / 2 / VX.zoom();
      let cutter; try { cutter = O2.offsetStroke(line, rad, { join: 'round', cap: 'round', insert: false }); } catch (e) { return; }
      const hit = targetShapes(cutter.bounds);
      const out = [];
      for (const p of hit) {
        const local = cutter.clone({ insert: false }); if (p.parent && !VX.isLayer(p.parent)) local.transform(p.parent.globalMatrix.inverted());
        if (p.className === 'Path' && !p.closed) { continue; }
        const r = p.subtract(local, { insert: false });
        r.style = p.style; r.opacity = p.opacity; r.blendMode = p.blendMode;
        r.insertAbove(p); p.remove();
        const style = r.style, pieces = VX.splitRegions(r);
        for (const piece of pieces) { if (piece !== r) { piece.insertAbove(r); piece.style = style; piece.opacity = r.opacity; } out.push(piece); }
        if (!pieces.includes(r)) r.remove();
      }
      if (hit.length) { VX.select(out.filter(x => x.parent && Math.abs(x.area || 1) > 0.01)); VX.commit('Erase'); }
    },
    overlay(ctx) {
      if (S.cursorV) { ctx.beginPath(); ctx.arc(S.cursorV.x, S.cursorV.y, O.eraser.size / 2, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1; ctx.stroke(); ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.beginPath(); ctx.arc(S.cursorV.x, S.cursorV.y, O.eraser.size / 2 + 1, 0, Math.PI * 2); ctx.stroke(); }
      if (this.pts && this.pts.length > 1) { ctx.beginPath(); this.pts.forEach((p, i) => { const v = VX.p2v(p); i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y); }); ctx.strokeStyle = 'rgba(255,79,109,.35)'; ctx.lineCap = ctx.lineJoin = 'round'; ctx.lineWidth = O.eraser.size; ctx.stroke(); }
    },
  };
  T.knife = {
    cursor: 'knife',
    down(ev) { this.pts = [ev.point]; },
    drag(ev) { this.pts.push(ev.alt ? constrain(this.pts[0], ev.point) : ev.point); if (ev.alt) this.pts = [this.pts[0], this.pts[this.pts.length - 1]]; },
    async up() {
      const pts = this.pts || []; this.pts = null; if (pts.length < 2) return;
      const O2 = await VX.needOffset();
      const line = new P.Path({ segments: pts, insert: false }); if (pts.length > 2) line.simplify(0.5 / VX.zoom());
      let cutter; try { cutter = O2.offsetStroke(line, 0.15 / VX.zoom(), { join: 'miter', cap: 'butt', insert: false }); } catch (e) { return; }
      const hit = targetShapes(cutter.bounds).filter(p => p.className === 'CompoundPath' || p.closed);
      const out = [];
      for (const p of hit) {
        const local = cutter.clone({ insert: false }); if (p.parent && !VX.isLayer(p.parent)) local.transform(p.parent.globalMatrix.inverted());
        const r = p.subtract(local, { insert: false });
        const pieces = VX.splitRegions(r);
        if (pieces.length < 2) continue;
        for (const piece of pieces) { piece.insertAbove(p); piece.style = p.style; piece.opacity = p.opacity; out.push(piece); }
        p.remove();
      }
      if (out.length) { VX.select(out); VX.commit('Knife'); }
    },
    overlay(ctx) { if (this.pts && this.pts.length > 1) { ctx.beginPath(); this.pts.forEach((p, i) => { const v = VX.p2v(p); i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y); }); ctx.strokeStyle = '#ff4f6d'; ctx.lineWidth = 1.2; ctx.stroke(); } },
  };

  // ---------- Scissors ----------
  T.scissors = {
    cursor: 'scissors',
    down(ev) {
      const r = VX.hit(ev.point, { fill: false, stroke: true, segments: true, tol: 5, match: h => h.item.className === 'Path' });
      if (!r || r.item.className !== 'Path') return toast('Click on a path to cut it.', 'info', 1600);
      const path = r.item;
      const loc = r.location || path.getNearestLocation(path.globalMatrix.inverted().transform(ev.point));
      if (!loc) return;
      if (path.data.live) delete path.data.live;
      const wasClosed = path.closed;
      const other = path.splitAt(loc);
      const sel = [path]; if (other && other !== path) sel.push(other);
      if (wasClosed) path.fillColor = path.fillColor; // stays filled but open
      VX.select(sel); S.pts.clear(); VX.commit('Cut path');
    },
  };

  // ---------- Rotate / Reflect / Scale tools ----------
  const pivotTool = kind => ({
    cursor: 'crosshair',
    activate() { S.pivot = null; },
    pivotPoint() { return S.pivot || (S.sel.length ? VX.selBounds().center : null); },
    down(ev) { if (!S.sel.length) return toast('Select objects first.', 'info', 1400); this.st = { piv: this.pivotPoint(), applied: new P.Matrix(), dup: ev.alt }; },
    drag(ev) {
      const st = this.st; if (!st || !st.piv) return;
      if (st.dup && !st.duped) { st.duped = true; S.sel = VX.sortByZ(S.sel).map(it => it.clone()); }
      let M;
      if (kind === 'rotate') { let a = ev.point.subtract(st.piv).angle - ev.start.subtract(st.piv).angle; if (ev.shift) a = Math.round(a / 45) * 45; M = new P.Matrix().rotate(a, st.piv); S.measure = `${Math.round(-a * 10) / 10}°`; }
      else if (kind === 'reflect') { let a = ev.point.subtract(st.piv).angle; if (ev.shift) a = Math.round(a / 45) * 45; M = new P.Matrix().rotate(a, st.piv).scale(1, -1, st.piv).rotate(-a, st.piv); S.measure = `Axis ${Math.round(-a)}°`; }
      else { const d0 = ev.start.subtract(st.piv), d1 = ev.point.subtract(st.piv); let sx = Math.abs(d0.x) > 1e-6 ? d1.x / d0.x : 1, sy = Math.abs(d0.y) > 1e-6 ? d1.y / d0.y : 1; if (ev.shift) { const s = d1.length / (d0.length || 1); sx = sy = s; } sx = Math.abs(sx) < 1e-3 ? 1e-3 : sx; sy = Math.abs(sy) < 1e-3 ? 1e-3 : sy; M = new P.Matrix().scale(sx, sy, st.piv); S.measure = `${Math.round(sx * 100)}% × ${Math.round(sy * 100)}%`; }
      VX.transformItems(S.sel, M.appended(st.applied.inverted())); st.applied = M;
    },
    up(ev) {
      const st = this.st; this.st = null; S.measure = null;
      if (!ev.moved) { S.pivot = ev.point; VX.req(); return; }
      if (st) { const piv = st.piv, M = st.applied.clone(); VX.recordTf(null, !!st.duped, cc => { const t = cc.subtract(piv); return new P.Matrix().translate(t).appended(M).appended(new P.Matrix().translate(t.multiply(-1))); }); VX.commit({ rotate: 'Rotate', reflect: 'Reflect', scale: 'Scale' }[kind]); }
    },
    dblclick() { (kind === 'rotate' ? VX.ops.rotateDialog : kind === 'scale' ? VX.ops.scaleDialog : () => VX.ops.flip('h'))(); },
    overlay(ctx) {
      const p = this.pivotPoint(); if (!p) return; const v = VX.p2v(p);
      ctx.strokeStyle = '#4c8dff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(v.x, v.y, 5, 0, Math.PI * 2); ctx.moveTo(v.x - 9, v.y); ctx.lineTo(v.x + 9, v.y); ctx.moveTo(v.x, v.y - 9); ctx.lineTo(v.x, v.y + 9); ctx.stroke();
    },
  });
  T.rotate = pivotTool('rotate'); T.reflect = pivotTool('reflect'); T.scale = pivotTool('scale');

  // ---------- Gradient tool ----------
  T.gradient = {
    cursor: 'crosshair',
    gradItem() { return VX.paintTargets(S.sel).find(t => t.fillColor && t.fillColor.type === 'gradient') || null; },
    down(ev) {
      if (!S.sel.length) { const it = hitObject(ev.point); if (it) VX.select([it]); else return; }
      const g = this.gradItem();
      if (g) { const c = g.fillColor; const m = g.globalMatrix; for (const k of ['origin', 'destination']) if (VX.p2v(m.transform(c[k])).getDistance(ev.v) < 8) { this.st = { kind: k, item: g }; return; } }
      this.st = { kind: 'new' };
    },
    drag(ev) {
      const st = this.st; if (!st) return;
      if (st.kind === 'new') {
        let end = ev.shift ? constrain(ev.start, ev.point) : ev.point;
        for (const t of VX.paintTargets(S.sel)) {
          let c = t.fillColor;
          if (!c || c.type !== 'gradient') c = new P.Color({ gradient: { stops: [[c && c.type !== 'gradient' ? c : '#ffffff', 0], ['#000000', 1]] }, origin: [0, 0], destination: [1, 0] });
          const inv = t.globalMatrix.inverted();
          const nc = new P.Color({ gradient: { stops: c.gradient.stops.map(s => [s.color.clone(), s.offset]), radial: c.gradient.radial }, origin: inv.transform(ev.start), destination: inv.transform(end) });
          t.fillColor = nc;
        }
      } else {
        const c = st.item.fillColor; const inv = st.item.globalMatrix.inverted();
        const nc = new P.Color({ gradient: { stops: c.gradient.stops.map(s => [s.color.clone(), s.offset]), radial: c.gradient.radial }, origin: c.origin, destination: c.destination });
        nc[st.kind] = inv.transform(ev.point);
        st.item.fillColor = nc;
      }
    },
    up(ev) { if (this.st && ev.moved) { VX.commit('Gradient'); VX.refreshPanels(true); } this.st = null; },
    overlay(ctx) {
      const g = this.gradItem(); if (!g) return;
      const c = g.fillColor, m = g.globalMatrix;
      const a = VX.p2v(m.transform(c.origin)), b = VX.p2v(m.transform(c.destination));
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      if (c.gradient.radial) { ctx.beginPath(); ctx.arc(a.x, a.y, a.getDistance(b), 0, Math.PI * 2); ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
      for (const s of c.gradient.stops) { const q = a.add(b.subtract(a).multiply(s.offset)); ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, Math.PI * 2); ctx.fillStyle = s.color.toCSS(true); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
      square(ctx, a, 9, '#fff', '#000'); dot(ctx, b, 4.5, '#fff', '#000');
    },
  };

  // ---------- Eyedropper ----------
  T.eyedropper = {
    cursor: 'eyedropper',
    down(ev) {
      const r = VX.hit(ev.point); if (!r) return;
      const src = VX.leafOf(r.item);
      if (src.className === 'Raster') {
        const c = src.getAverageColor(new P.Rectangle(ev.point.subtract([1, 1]), new P.Size(2, 2)));
        if (c) { c.alpha = 1; VX.applyPaint(S.focus, c); } return;
      }
      if (ev.shift) { VX.applyPaint(S.focus, src.fillColor ? src.fillColor.clone() : null); return; }
      const targets = VX.paintTargets(S.sel).filter(t => t !== src);
      S.fill = src.fillColor ? src.fillColor.clone() : null; S.stroke = src.strokeColor ? src.strokeColor.clone() : null;
      S.strokeStyle.width = src.strokeWidth || S.strokeStyle.width;
      for (const t of targets) {
        t.fillColor = src.fillColor ? (src.fillColor.type === 'gradient' ? VX.fitGradient(src.fillColor, t) : src.fillColor.clone()) : null;
        t.strokeColor = src.strokeColor ? src.strokeColor.clone() : null;
        for (const k of ['strokeWidth', 'strokeCap', 'strokeJoin', 'dashArray', 'miterLimit']) t[k] = src[k];
        t.opacity = src.opacity; t.blendMode = src.blendMode;
        if (src.className === 'PointText' && t.className === 'PointText') { for (const k of ['fontFamily', 'fontWeight', 'fontSize', 'leading', 'tracking', 'justification']) t[k] = src[k]; if (t.data.area) VX.layoutAreaText(t); }
      }
      VX.syncColorWidget();
      if (targets.length) VX.commit('Eyedropper'); else VX.refreshPanels(true);
    },
  };

  // ---------- Artboard tool ----------
  function abHandles(a) { const r = VX.abRect(a); return bboxHandles(r); }
  T.artboard = {
    cursor: 'crosshair',
    hover(ev) {
      const a = S.doc.artboards[S.doc.ab];
      const hd = abHandles(a).find(x => x.p.getDistance(ev.v) < 7);
      if (hd) return setHoverCursor(RESIZE_CURSOR[hd.id]);
      setHoverCursor(VX.ab.at(ev.point) >= 0 ? 'move-obj' : null);
    },
    down(ev) {
      const a = S.doc.artboards[S.doc.ab];
      const hd = abHandles(a).find(x => x.p.getDistance(ev.v) < 7);
      if (hd) { this.st = { kind: 'resize', id: hd.id, r0: VX.abRect(a), i: S.doc.ab }; return; }
      const i = VX.ab.at(ev.point);
      if (i >= 0) { if (ev.alt) { VX.ab.duplicate(i); this.st = null; return; } VX.ab.activate(i); this.st = { kind: 'move', i, x0: S.doc.artboards[i].x, y0: S.doc.artboards[i].y, art: O.artboard.moveArt ? VX.ab.artwork(i) : [], applied: pt(0, 0) }; return; }
      this.st = { kind: 'new' };
    },
    drag(ev) {
      const st = this.st; if (!st) return;
      if (st.kind === 'new') { this.preview = new P.Rectangle(ev.start, snapPoint(ev.point)); S.measure = `W: ${VX.fmtU(this.preview.width)}  H: ${VX.fmtU(this.preview.height)}`; return; }
      const a = S.doc.artboards[st.i];
      if (st.kind === 'move') {
        let d = ev.point.subtract(ev.start); if (ev.shift) d = constrain(pt(0, 0), d);
        d = pt(Math.round(d.x), Math.round(d.y));
        a.x = st.x0 + d.x; a.y = st.y0 + d.y;
        if (st.art.length) { VX.transformItems(st.art, new P.Matrix().translate(d.subtract(st.applied))); st.applied = d; }
        S.measure = `X: ${VX.fmtU(a.x)}  Y: ${VX.fmtU(a.y)}`; return;
      }
      const r0 = st.r0, id = st.id; let p = snapPoint(ev.point);
      let l = r0.left, t = r0.top, r = r0.right, b = r0.bottom;
      if (id.includes('w')) l = p.x; if (id.includes('e')) r = p.x; if (id.includes('n')) t = p.y; if (id.includes('s')) b = p.y;
      if (ev.shift && id.length === 2) { const s = Math.max(Math.abs(r - l) / r0.width, Math.abs(b - t) / r0.height); if (id.includes('w')) l = r - r0.width * s; else r = l + r0.width * s; if (id.includes('n')) t = b - r0.height * s; else b = t + r0.height * s; }
      const rr = new P.Rectangle(pt(l, t), pt(r, b));
      Object.assign(a, { x: Math.round(rr.x * 100) / 100, y: Math.round(rr.y * 100) / 100, w: Math.max(1, Math.round(rr.width * 100) / 100), h: Math.max(1, Math.round(rr.height * 100) / 100) });
      S.measure = `W: ${VX.fmtU(a.w)}  H: ${VX.fmtU(a.h)}`;
      VX.refreshPanels();
    },
    up(ev) {
      const st = this.st; this.st = null; S.measure = null; S.smart = null;
      if (!st) return;
      if (st.kind === 'new') { const r = this.preview; this.preview = null; if (r && r.width > 2 && r.height > 2) VX.ab.add({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }); return; }
      if (ev.moved) VX.commit(st.kind === 'move' ? 'Move artboard' : 'Resize artboard');
      VX.refreshPanels(true);
    },
    overlay(ctx) {
      const a = S.doc.artboards[S.doc.ab]; if (!a) return;
      for (const hd of abHandles(a)) square(ctx, hd.p, 8, '#fff', '#2fd67f');
      if (this.preview) { const p = VX.p2v(this.preview.topLeft), q = VX.p2v(this.preview.bottomRight); ctx.setLineDash([5, 4]); ctx.strokeStyle = '#2fd67f'; ctx.strokeRect(p.x, p.y, q.x - p.x, q.y - p.y); ctx.setLineDash([]); }
    },
    key(e) { if ((e.key === 'Delete' || e.key === 'Backspace') && !S.sel.length) { VX.ab.remove(); return true; } return false; },
  };
  T.hand = { cursor: 'grab' };
  T.zoom = { cursor: 'zoom-in', dblclick() { VX.actualSize(); } };

  // ---------- Type tool & on-canvas text editing ----------
  const measureCtx = document.createElement('canvas').getContext('2d');
  const fontCss = it => `${it.fontWeight || 'normal'} ${it.fontSize}px ${cssFamily(it.fontFamily)}`;
  const cssFamily = f => /[\s,'"]/.test(f) && !/^["']/.test(f) && !f.includes(',') ? `"${f}"` : f;
  VX.cssFamily = cssFamily;
  VX.ascentOf = it => { measureCtx.font = fontCss(it); const m = measureCtx.measureText('Hg'); return m.fontBoundingBoxAscent || it.fontSize * 0.8; };
  /** Wrap area type into its box; `topLeft` (parent coords) moves the box. */
  VX.layoutAreaText = (it, topLeft) => {
    const A = it.data.area; if (!A) return;
    const box = topLeft ? null : VX.areaBox(it);
    const tl = topLeft || box.topLeft;
    measureCtx.font = fontCss(it);
    try { measureCtx.letterSpacing = (it.tracking || 0) / 1000 + 'em'; } catch (_) {}
    const lines = [];
    for (const para of String(it.data.text != null ? it.data.text : it.content).split('\n')) {
      const words = para.split(/(\s+)/); let line = '';
      for (const w of words) {
        const test = line + w;
        if (line && measureCtx.measureText(test.trimEnd()).width > A.w) { lines.push(line.trimEnd()); line = w.trimStart(); }
        else line = test;
        while (measureCtx.measureText(line).width > A.w && line.length > 1) { // break very long words
          let k = line.length - 1; while (k > 1 && measureCtx.measureText(line.slice(0, k)).width > A.w) k--;
          lines.push(line.slice(0, k)); line = line.slice(k);
        }
      }
      lines.push(line);
    }
    it.content = lines.join('\n');
    const asc = VX.ascentOf(it);
    const j = it.justification;
    const ox = j === 'center' ? A.w / 2 : j === 'right' ? A.w : 0;
    const sx = it.matrix.a || 1, sy = it.matrix.d || 1;
    it.point = pt(tl.x + ox * sx, tl.y + asc * sy);
    it.data.overflow = lines.length * it.leading > A.h + 0.5;
  };
  VX.areaBox = it => {
    const A = it.data.area; const asc = VX.ascentOf(it);
    const j = it.justification; const ox = j === 'center' ? A.w / 2 : j === 'right' ? A.w : 0;
    const sx = it.matrix.a || 1, sy = it.matrix.d || 1;
    return new P.Rectangle(it.point.x - ox * sx, it.point.y - asc * sy, A.w * sx, A.h * sy);
  };
  let textEdit = null;
  VX.textEditing = () => !!textEdit;
  VX.textEditItem = () => textEdit ? textEdit.it : null;
  function newText(at, area) {
    const ts = S.textStyle;
    const t = new P.PointText({ point: at, content: '', fontFamily: ts.family, fontWeight: ts.weight, fontSize: ts.size, justification: ts.justification, insert: false });
    if (ts.leading) t.leading = ts.leading;
    t.tracking = ts.tracking || 0;
    t.fillColor = S.fill && S.fill.type !== 'gradient' ? S.fill.clone() : new P.Color('#000');
    if (t.fillColor && VX.hex(t.fillColor) === '#ffffff' && !S.sel.length) t.fillColor = new P.Color('#000'); // white text on a white artboard is invisible
    t.strokeColor = null;
    (S.isolation || S.project.activeLayer).addChild(t);
    if (area) { t.data.area = { w: Math.max(10, area.width), h: Math.max(10, area.height) }; t.data.text = ''; VX.layoutAreaText(t, area.topLeft); }
    return t;
  }
  VX.addText = (text, at) => {
    const vb = S.view.bounds; const t = newText(at || vb.center, null); t.content = text; if (!at) t.position = vb.center;
    VX.select([t]); VX.commit('Type');
  };
  VX.editText = (it, isNew) => {
    if (textEdit) VX.commitTextEdit();
    const ta = h('<textarea class="vx-text-edit" spellcheck="false"></textarea>');
    ta.value = VX.textOf(it);
    S.el.stage.appendChild(ta);
    textEdit = { it, ta, isNew, before: it.exportJSON({ asString: true }) };
    it.visible = false;
    VX.select([it]);
    VX.positionTextEditor();
    ta.addEventListener('input', () => VX.positionTextEditor());
    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); VX.commitTextEdit(); VX.setTool('select'); }
    });
    ta.addEventListener('blur', () => setTimeout(() => { if (textEdit && textEdit.ta === ta && document.activeElement !== ta && !document.querySelector('.vx-fontpick')) VX.commitTextEdit(); }, 120));
    setTimeout(() => { ta.focus(); if (!isNew) ta.select(); }, 0);
    VX.req();
  };
  VX.positionTextEditor = () => {
    if (!textEdit) return;
    const { it, ta } = textEdit;
    const z = VX.zoom(), m = it.matrix, sc = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1, ang = Math.atan2(m.b, m.a) * 180 / Math.PI;
    const fs = it.fontSize * z * sc;
    const asc = VX.ascentOf(it) * z * sc;
    const col = it.fillColor && it.fillColor.type !== 'gradient' ? it.fillColor.toCSS(true) : '#000';
    Object.assign(ta.style, { font: `${it.fontWeight || 'normal'} ${fs}px ${cssFamily(it.fontFamily)}`, lineHeight: (it.leading * z * sc) + 'px', letterSpacing: (it.tracking || 0) / 1000 + 'em', color: col, textAlign: it.justification, transform: ang ? `rotate(${ang}deg)` : '' });
    const anchor = VX.p2v(it.parent ? it.parent.localToGlobal(it.point) : it.point);
    let left, width;
    if (it.data.area) {
      const box = VX.areaBox(it); const a = VX.p2v(it.parent && !VX.isLayer(it.parent) ? it.parent.localToGlobal(box.topLeft) : box.topLeft);
      width = it.data.area.w * z * sc; left = a.x; ta.style.whiteSpace = 'pre-wrap';
      ta.style.width = width + 'px'; ta.style.height = Math.max(it.data.area.h * z * sc, ta.scrollHeight) + 'px';
      ta.style.left = left + 'px'; ta.style.top = a.y + 'px'; ta.style.transformOrigin = '0 0';
      return;
    }
    ta.style.whiteSpace = 'pre'; ta.style.width = '10px'; ta.style.height = '10px';
    width = Math.max(ta.scrollWidth + fs * 0.6, fs);
    left = it.justification === 'center' ? anchor.x - width / 2 : it.justification === 'right' ? anchor.x - width : anchor.x;
    ta.style.width = width + 'px'; ta.style.height = Math.max(ta.scrollHeight, it.leading * z * sc) + 'px';
    ta.style.left = left + 'px'; ta.style.top = (anchor.y - asc) + 'px';
    ta.style.transformOrigin = `${anchor.x - left}px ${asc}px`;
  };
  VX.commitTextEdit = () => {
    if (!textEdit) return;
    const { it, ta, isNew, before } = textEdit; textEdit = null;
    const v = ta.value; ta.remove();
    it.visible = true;
    if (!v.trim()) { it.remove(); S.sel = S.sel.filter(x => x !== it); VX.selectionChanged(); if (!isNew) VX.commit('Delete type'); VX.req(); return; }
    if (it.data.area) { it.data.text = v; VX.layoutAreaText(it); } else it.content = v;
    if (it.exportJSON({ asString: true }) !== before || isNew) VX.commit('Type');
    VX.refreshPanels(true); VX.req();
  };
  VX.cancelTextEdit = () => { if (!textEdit) return; const { it, ta, isNew } = textEdit; textEdit = null; ta.remove(); it.visible = true; if (isNew) it.remove(); VX.req(); };
  // ---------- Type on a path ----------
  // A group { data.pathText } holding the guide path (unpainted) and one PointText per glyph, re-laid out on every commit.
  VX.isPathText = it => !!(it && it.className === 'Group' && it.data && it.data.pathText);
  VX.layoutPathText = g => {
    const D = g.data.pathText, guide = g.firstChild;
    if (!guide || guide.className !== 'Path') return;
    const glyphs = g.children.slice(1);
    const g0 = glyphs.find(c => c.className === 'PointText');
    if (g0) { D.fill = g0.fillColor ? g0.fillColor.toCSS(false) : null; D.stroke = g0.strokeColor ? g0.strokeColor.toCSS(false) : null; D.strokeWidth = g0.strokeWidth; }
    glyphs.forEach(c => c.remove());
    const proto = { fontFamily: D.family, fontWeight: D.weight, fontSize: D.size };
    measureCtx.font = fontCss(proto);
    try { measureCtx.letterSpacing = '0px'; } catch (_) {}
    const chars = [...String(D.text || '')];
    const widths = chars.map(ch => measureCtx.measureText(ch).width);
    const track = (D.tracking || 0) / 1000 * D.size;
    const total = widths.reduce((a, b) => a + b, 0) + track * Math.max(0, chars.length - 1);
    const len = guide.length;
    let s = (D.offset || 0) + (D.align === 'center' ? (len - total) / 2 : D.align === 'right' ? len - total : 0);
    let overflow = false;
    chars.forEach((ch, i) => {
      const mid = s + widths[i] / 2;
      if (mid > len || mid < 0) { overflow = overflow || mid > len; s += widths[i] + track; return; }
      if (ch.trim()) {
        const p = guide.getPointAt(mid), t = guide.getTangentAt(mid);
        const gl = new P.PointText({ point: [0, 0], content: ch, fontFamily: D.family, fontWeight: D.weight, fontSize: D.size, justification: 'center', insert: false });
        gl.fillColor = D.fill ? new P.Color(D.fill) : null; gl.strokeColor = D.stroke ? new P.Color(D.stroke) : null; if (D.strokeWidth) gl.strokeWidth = D.strokeWidth;
        if (D.baseline) gl.translate([0, -D.baseline]);
        gl.rotate(t.angle, new P.Point(0, 0)); gl.translate(p);
        g.addChild(gl);
      }
      s += widths[i] + track;
    });
    g.data.overflow = overflow;
  };
  VX.relayoutPathTexts = () => { if (!S.project) return; for (const g of S.project.getItems({ match: VX.isPathText })) VX.layoutPathText(g); };
  VX.makePathText = async (path) => {
    const text = await promptBox('Type on a path', 'Text', 'Type on a path');
    if (text == null || !text.trim()) return;
    const ts = S.textStyle;
    const g = new P.Group({ insert: false }); g.insertAbove(path);
    if (path.data.live) delete path.data.live;
    g.addChild(path); path.fillColor = null; path.strokeColor = null;
    const fill = S.fill && S.fill.type !== 'gradient' ? S.fill.toCSS(false) : '#000000';
    g.data.pathText = { text, family: ts.family, weight: ts.weight, size: ts.size, tracking: ts.tracking || 0, offset: 0, align: 'left', baseline: 0, fill: fill === 'rgb(255,255,255)' ? '#000000' : fill };
    g.name = text.slice(0, 28);
    VX.layoutPathText(g);
    VX.select([g]); VX.commit('Type on a path');
  };
  VX.editPathText = async g => {
    const text = await promptBox('Edit type on a path', 'Text', g.data.pathText.text);
    if (text == null) return;
    g.data.pathText.text = text; g.name = text.slice(0, 28); VX.layoutPathText(g); VX.commit('Edit type on a path');
  };

  T.text = {
    cursor: 'text',
    hover(ev) { const r = VX.hit(ev.point); setHoverCursor(r && r.item.className === 'PointText' ? 'text-edit' : r && r.item.className === 'Path' && (r.type === 'stroke' || r.type === 'segment') ? 'text-path' : null); },
    down(ev) {
      const r = VX.hit(ev.point);
      if (r && r.item.className === 'PointText' && VX.isPathText(r.item.parent)) { this.st = { pathText: r.item.parent }; return; }
      if (r && r.item.className === 'PointText') { this.st = { edit: r.item }; return; }
      if (r && r.item.className === 'Path' && (r.type === 'stroke' || r.type === 'segment') && !VX.isPathText(r.item.parent)) { this.st = { onPath: r.item, start: ev.point }; return; }
      this.st = { start: snapPoint(ev.point) };
    },
    drag(ev) { if (this.st && this.st.start) { this.preview = new P.Rectangle(this.st.start, ev.point); S.measure = `W: ${VX.fmtU(this.preview.width)}  H: ${VX.fmtU(this.preview.height)}`; } },
    up(ev) {
      const st = this.st; this.st = null; S.measure = null; S.smart = null;
      if (!st) return;
      if (st.edit) { VX.editText(st.edit); return; }
      if (st.pathText) { VX.editPathText(st.pathText); return; }
      if (st.onPath && !ev.moved) { VX.makePathText(st.onPath); return; }
      const r = this.preview; this.preview = null;
      const area = ev.moved && r && r.width > 8 && r.height > 8 ? r : null;
      const t = newText(area ? area.topLeft : st.start, area);
      VX.editText(t, true);
    },
    overlay(ctx) { if (this.preview) { const a = VX.p2v(this.preview.topLeft), c = VX.p2v(this.preview.bottomRight); ctx.setLineDash([4, 3]); ctx.strokeStyle = '#4c8dff'; ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y); ctx.setLineDash([]); } },
  };
  VX.applyTextStyle = (props, { commit = true } = {}) => {
    Object.assign(S.textStyle, Object.fromEntries(Object.entries(props).map(([k, v]) => [{ fontFamily: 'family', fontWeight: 'weight', fontSize: 'size' }[k] || k, v])));
    VX.savePrefs();
    const texts = [], paths = []; const walk = it => { if (VX.isPathText(it)) paths.push(it); else if (it.className === 'PointText') texts.push(it); else if (it.children) it.children.forEach(walk); };
    S.sel.forEach(walk);
    if (textEdit && !texts.includes(textEdit.it)) texts.push(textEdit.it);
    for (const t of texts) { Object.assign(t, props); if (t.data.area) VX.layoutAreaText(t); }
    for (const g of paths) { const D = g.data.pathText; if (props.fontFamily) D.family = props.fontFamily; if (props.fontWeight) D.weight = props.fontWeight; if (props.fontSize) D.size = props.fontSize; if (props.tracking != null) D.tracking = props.tracking; if (props.justification) D.align = props.justification; VX.layoutPathText(g); texts.push(g); }
    if (textEdit) VX.positionTextEditor();
    if (texts.length && commit) VX.commit('Type style');
    VX.req();
  };

  // ---------- context menu ----------
  VX.contextMenu = ev => {
    const it = hitObject(ev.point);
    if (it && !S.sel.includes(it)) VX.select([it]);
    const anchor = h(`<div style="position:fixed;left:${ev.e.clientX}px;top:${ev.e.clientY}px;width:1px;height:1px"></div>`);
    document.body.appendChild(anchor);
    const o = VX.ops, has = S.sel.length > 0, mod = ro3.platform === 'darwin' ? '⌘' : 'Ctrl+';
    const items = [
      { label: 'Undo', kbd: mod + 'Z', onClick: VX.undo, disabled: S.hist.i <= 0 },
      { label: 'Redo', kbd: mod + 'Shift+Z', onClick: VX.redo, disabled: S.hist.i >= S.hist.stack.length - 1 },
      'sep',
      { label: 'Cut', kbd: mod + 'X', onClick: o.cut, disabled: !has }, { label: 'Copy', kbd: mod + 'C', onClick: o.copy, disabled: !has }, { label: 'Paste', kbd: mod + 'V', onClick: () => o.paste('center') },
      { label: 'Paste in Place', kbd: mod + 'Shift+V', onClick: () => o.paste('inplace') },
      'sep',
      ...(has ? [
        { label: 'Group', kbd: mod + 'G', onClick: o.group },
        ...(S.sel.some(x => x.className === 'Group') ? [{ label: 'Ungroup', kbd: mod + 'Shift+G', onClick: o.ungroup }] : []),
        ...(S.sel.length > 1 ? [{ label: 'Make Clipping Mask', kbd: mod + '7', onClick: o.makeClip }, { label: 'Make Compound Path', kbd: mod + '8', onClick: o.makeCompound }] : []),
        ...(S.sel.some(x => x.className === 'Group' && x.clipped) ? [{ label: 'Release Clipping Mask', onClick: o.releaseClip }] : []),
        ...(S.sel.some(x => x.className === 'PointText') ? [{ label: 'Create Outlines', kbd: mod + 'Shift+O', onClick: () => VX.io.outlineText() }] : []),
        ...(S.sel.some(x => x.className === 'Raster') ? [{ label: 'Image Trace…', onClick: () => VX.io.traceDialog() }] : []),
        'sep',
        { label: 'Bring to Front', kbd: mod + 'Shift+]', onClick: () => o.arrange('front') }, { label: 'Bring Forward', kbd: mod + ']', onClick: () => o.arrange('forward') },
        { label: 'Send Backward', kbd: mod + '[', onClick: () => o.arrange('backward') }, { label: 'Send to Back', kbd: mod + 'Shift+[', onClick: () => o.arrange('back') },
        'sep',
        { label: 'Flip Horizontal', onClick: () => o.flip('h') }, { label: 'Flip Vertical', onClick: () => o.flip('v') },
        { label: 'Lock', kbd: mod + '/', onClick: o.lock }, { label: 'Hide', kbd: mod + 'Shift+/', onClick: o.hide },
        { label: 'Delete', kbd: 'Del', onClick: o.del },
      ] : [{ label: 'Select All', kbd: mod + 'A', onClick: VX.selectAll }, { label: 'Unlock All', onClick: o.unlockAll }, { label: 'Show All', onClick: o.showAll }]),
      ...(S.isolation ? ['sep', { label: 'Exit Isolation Mode', onClick: VX.exitIsolation }] : []),
    ];
    menuAt(anchor, items);
    setTimeout(() => anchor.remove(), 0);
  };
})();
