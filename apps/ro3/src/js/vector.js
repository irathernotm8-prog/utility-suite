// Vector workspace (Illustrator replacement) — core: state, view, UI shell, input routing, commands, module interface.
// The workspace is split over several classic scripts that all hang off the global `VX`:
//   vector.js         core (this file): state, canvas stack, zoom/pan/rulers, input routing, keyboard, commands
//   vector-doc.js     document model: artboards, history, selection, transforms, arrange/align, pathfinder, clipboard, appearance
//   vector-tools.js   canvas tools (select, direct, pen, shapes, type…), overlay drawing, smart guides, text editing
//   vector-panels.js  tool rail, options bar, side panels (properties, layers, artboards, swatches), color picker
//   vector-io.js      .ro3d/SVG/PDF/AI open & save, raster/PDF/screens export, fonts & outlines, place & image trace
// paper.js (src/vendor/paper-core.min.js) is the vector engine.

Object.assign(ICONS, {
  vSelect: '<path d="M6 3.5l12 8.2-5.3 1.1 3.3 6.2-2.4 1.3-3.3-6.3L6 18z" fill="currentColor" stroke-linejoin="round"/>',
  vDirect: '<path d="M6 3.5l12 8.2-5.3 1.1 3.3 6.2-2.4 1.3-3.3-6.3L6 18z" stroke-linejoin="round"/>',
  vLasso: '<path d="M6.5 15.5C3.5 13.5 3.8 8 9 6s11 .5 10.6 4.8C19.3 15 12 16.5 8.4 15.6"/><path d="M7.2 15.2c-1 1.4-.4 3.2 1 3.8"/><circle cx="7.6" cy="15.3" r="1.3"/>',
  vPen: '<path d="M12 2.8l5.5 9.4-2.4 7.3H8.9l-2.4-7.3z"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2.8v7.7M8.7 21h6.6"/>',
  vAddAnchor: '<path d="M10 3l4.6 7.8-2 6.1H7.4l-2-6.1z"/><circle cx="10" cy="10.6" r="1.2"/><path d="M18.5 14v6M15.5 17h6"/>',
  vDelAnchor: '<path d="M10 3l4.6 7.8-2 6.1H7.4l-2-6.1z"/><circle cx="10" cy="10.6" r="1.2"/><path d="M15.5 17h6"/>',
  vConvert: '<path d="M4 19L12 5l8 14"/><rect x="10.3" y="3.3" width="3.4" height="3.4" fill="currentColor"/>',
  vCurvature: '<path d="M4 17c3-9 7-11 8-11s5 2 8 11"/><circle cx="4" cy="17" r="1.6"/><circle cx="12" cy="6" r="1.6"/><circle cx="20" cy="17" r="1.6"/>',
  vPencil: '<path d="M15 4.5l4.5 4.5L9 19.5H4.5V15z"/><path d="M12.5 7l4.5 4.5"/>',
  vBrush: '<path d="M14.5 4.5l5 5-8.5 8.5-5-5z"/><path d="M6 13l-2.2 2.2c-1 1-.8 3.5-.8 4.8 1.3 0 3.8.2 4.8-.8L10 17"/>',
  vEraser: '<path d="M8 20h12M5.5 15.5L14 7l5 5-8 8H8.5z"/><path d="M9.5 11l5 5"/>',
  vRect: '<rect x="4" y="5.5" width="16" height="13" rx="1"/>',
  vEllipse: '<ellipse cx="12" cy="12" rx="8.5" ry="7"/>',
  vPolygon: '<path d="M12 3.5l8 5.8-3 9.2H7l-3-9.2z"/>',
  vStar: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z"/>',
  vLine: '<path d="M5 19L19 5"/>',
  vArc: '<path d="M5 19C5 10.5 10.5 5 19 5"/>',
  vSpiral: '<path d="M12 12.5c0-1 1.6-1 1.6.3 0 1.8-2.6 2-3.4.3-1.1-2.3 1.3-4.6 3.8-4 3.4.8 3.8 5.4 1.1 7.4-3.4 2.6-8.3.5-8.6-3.8C6.2 7.5 10 4.5 14 5"/>',
  vText: '<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>',
  vScissors: '<circle cx="6.5" cy="17" r="2.6"/><circle cx="17.5" cy="17" r="2.6"/><path d="M8.3 15.2L18 4M15.7 15.2L6 4"/>',
  vKnife: '<path d="M4 20L18.5 5.5c1.2 1.2 1.6 4-.8 6.4L11 18.6"/><path d="M4 20l3.5-1"/>',
  vRotate: '<path d="M19 12a7 7 0 11-2.1-5"/><path d="M19 4v4h-4"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
  vReflect: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9.5 6L4 17h5.5zM14.5 6L20 17h-5.5z"/>',
  vScale: '<rect x="3.5" y="10.5" width="10" height="10" rx="1"/><path d="M10.5 3.5h10v10" stroke-dasharray="2.4 2"/><path d="M12 12l6-6M14 6h4v4"/>',
  vGradient: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7.5 5v14"/><path d="M11.5 5v14" opacity=".7"/><path d="M15.5 5v14" opacity=".4"/>',
  vDropper: '<path d="M14 6l4 4M4 20l1.5-4.5L14 7l3 3-8.5 8.5z"/><path d="M15.5 4.5a2.1 2.1 0 013 3L17 9l-3-3z"/>',
  vArtboard: '<rect x="6" y="6" width="12" height="12"/><path d="M3 6h2M19 6h2M3 18h2M19 18h2M6 3v2M6 19v2M18 3v2M18 19v2"/>',
  vHand: '<path d="M8 13V6.5a1.5 1.5 0 013 0V11m0-5.5a1.5 1.5 0 013 0V11m0-4a1.5 1.5 0 013 0v6.5a6.5 6.5 0 01-6.5 6.5c-3 0-4.4-1.6-6-4l-2-3.2a1.5 1.5 0 012.5-1.7L8 13"/>',
  vZoom: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5M10.5 8v5"/>',
  vSwap: '<path d="M7 4h9a3 3 0 013 3v9"/><path d="M16.5 13.5L19 16l2.5-2.5M9.5 1.5L7 4l2.5 2.5"/>',
  vNone: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M5 19L19 5" stroke="#ff6b5e"/>',
  pfUnite: '<path d="M4 4h10v6h6v10H10v-6H4z" fill="currentColor" fill-opacity=".85"/>',
  pfMinus: '<path d="M4 4h10v6h-4v4H4z" fill="currentColor" fill-opacity=".85"/><rect x="10" y="10" width="10" height="10" stroke-dasharray="2 1.6"/>',
  pfIntersect: '<rect x="4" y="4" width="10" height="10" stroke-dasharray="2 1.6"/><rect x="10" y="10" width="10" height="10" stroke-dasharray="2 1.6"/><rect x="10" y="10" width="4" height="4" fill="currentColor"/>',
  pfExclude: '<path d="M4 4h10v6h-4v4H4zM14 14v-4h6v10H10v-6z" fill="currentColor" fill-opacity=".85"/>',
  pfDivide: '<rect x="4" y="4" width="10" height="10"/><rect x="10" y="10" width="10" height="10"/><path d="M10 10h4v4h-4z" fill="currentColor"/>',
  pfTrim: '<path d="M4 4h10v6h-4v4H4z" fill="currentColor" fill-opacity=".5"/><rect x="10" y="10" width="10" height="10" fill="currentColor" fill-opacity=".85"/>',
  pfCrop: '<rect x="4" y="4" width="10" height="10" stroke-dasharray="2 1.6"/><path d="M10 10h4v4h-4z" fill="currentColor"/><rect x="10" y="10" width="10" height="10"/>',
  pfMinusBack: '<rect x="4" y="4" width="10" height="10" stroke-dasharray="2 1.6"/><path d="M14 10h6v10H10v-6h4z" fill="currentColor" fill-opacity=".85"/>',
  vOffset: '<rect x="7.5" y="7.5" width="9" height="9" rx="1"/><rect x="3.5" y="3.5" width="17" height="17" rx="4" stroke-dasharray="2.4 2"/>',
  vOutline: '<path d="M4 16c4-9 12-9 16 0" stroke-width="5" opacity=".35"/><path d="M4 16c4-9 12-9 16 0"/>',
  vSimplify: '<path d="M3 15c2-2 2.5-6 4.5-6s2 4 4 4 2-6 4-6 3 6 5 8" opacity=".4"/><path d="M3 15c5-9 13-9 18 0"/>',
  vCompound: '<rect x="3.5" y="3.5" width="17" height="17" rx="2" fill="currentColor" fill-opacity=".3"/><circle cx="12" cy="12" r="4.5"/>',
  vClip: '<rect x="3.5" y="3.5" width="17" height="17" rx="2" stroke-dasharray="2.4 2"/><circle cx="12" cy="12" r="5.5" fill="currentColor" fill-opacity=".35"/>',
  vPlace: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-5 4 4 3-3 4 4"/>',
  vTrace: '<rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="2.4 2"/><path d="M6 16c2-6 4-8 6-8s4 3 6 8"/><circle cx="12" cy="8" r="1.3" fill="currentColor"/>',
  vOutlineText: '<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" stroke-width="3.4" opacity=".35"/><path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>',
  vOutlineMode: '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="12" cy="12" r="4"/>',
  vSmart: '<path d="M4 12h16M12 4v16" stroke="#ff3dbb"/><rect x="8" y="8" width="8" height="8"/>',
  vSnap: '<path d="M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z"/><path d="M6 8h4M14 8h4"/>',
  vRepeat: '<path d="M4 10a7 7 0 0112.5-4M20 14a7 7 0 01-12.5 4"/><path d="M17 2.5V6h-3.5M7 21.5V18h3.5"/>',
  vDistSpaceH: '<path d="M3 4v16M21 4v16"/><rect x="6" y="8" width="4" height="8"/><rect x="14" y="8" width="4" height="8"/>',
  vDistSpaceV: '<path d="M4 3h16M4 21h16"/><rect x="8" y="6" width="8" height="4"/><rect x="8" y="14" width="8" height="4"/>',
  vJoin: '<path d="M4 18c2-8 5-10 8-10M20 18c-2-8-5-10-8-10"/><circle cx="12" cy="8" r="1.8" fill="currentColor"/>',
  vReverse: '<path d="M4 12h15M15 8l4 4-4 4"/><path d="M8 5L4 9" opacity=".5"/>',
  vFonts: '<path d="M4 19l5-14h1l5 14M6 14h7"/><path d="M16 19v-7a2.5 2.5 0 015 0v7M16 15h5" opacity=".7"/>',
});

const VX = window.VX = {};

const VectorEditor = (() => {
  const UNIT = { px: 1, pt: 1, in: 72, mm: 72 / 25.4 };
  const S = VX.S = {
    root: null, el: {}, scope: null, project: null, view: null,
    doc: null, sel: [], key: null, pts: new Set(), tool: 'select', tempTool: null,
    fill: new paper.Color('#2fd67f'), stroke: null, focus: 'fill',
    strokeStyle: { width: 1, cap: 'butt', join: 'miter', miter: 10, dash: null },
    textStyle: { family: 'Manrope', weight: '700', size: 48, leading: 0, tracking: 0, justification: 'left' },
    show: { rulers: true, guides: true, grid: false, smart: true, outline: false, snapGrid: false, bounds: true },
    isolation: null, hist: { stack: [], i: -1 }, lastTf: null, clip: null, hover: null,
    space: false, active: false, sideTop: 'props', sideBottom: 'layers',
  };
  VX.UNIT = UNIT;

  // ---------- small helpers shared by every vector file ----------
  VX.unitLabel = () => S.doc ? S.doc.units : 'px';
  VX.toU = v => v / UNIT[VX.unitLabel()];
  VX.fromU = v => v * UNIT[VX.unitLabel()];
  VX.fmtU = (v, unit = VX.unitLabel()) => { const x = v / UNIT[unit]; const d = unit === 'in' ? 3 : unit === 'mm' ? 2 : 2; return String(Math.round(x * 10 ** d) / 10 ** d); };
  VX.zoom = () => S.view ? S.view.zoom : 1;
  VX.tol = (px = 5) => px / VX.zoom();
  VX.isMod = e => e.ctrlKey || e.metaKey;
  VX.cssColor = c => !c ? 'none' : c.type === 'gradient' ? 'gradient' : c.toCSS(c.alpha >= 1);
  VX.hex = c => { if (!c || c.type === 'gradient') return null; const k = c.convert ? c.convert('rgb') : c; const h2 = v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0'); return '#' + h2(k.red) + h2(k.green) + h2(k.blue); };
  VX.appPath = rel => { const u = new URL(rel, location.href); let p = decodeURIComponent(u.pathname); if (/^\/[a-z]:\//i.test(p)) p = p.slice(1); return p; };
  VX.readAppFile = rel => ro3.readBytes(VX.appPath(rel));
  VX.loadScript = (() => { const cache = {}; return src => cache[src] || (cache[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete cache[src]; rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); })); })();
  VX.b64 = bytes => { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };
  VX.unb64 = b64 => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

  // ---------- rendering ----------
  let raf = 0;
  VX.req = () => { if (!raf) raf = requestAnimationFrame(renderNow); };
  function renderNow() {
    raf = 0;
    if (!S.doc || !S.view) return;
    const dimmed = [];
    if (S.isolation && S.isolation.parent) {
      // Dim everything outside the isolated group while drawing, then put it back (never reaches history or export).
      let node = S.isolation;
      while (node && node.parent && node.className !== 'Layer') {
        for (const sib of node.parent.children) if (sib !== node) { dimmed.push([sib, sib.opacity]); sib.opacity = sib.opacity * 0.35; }
        node = node.parent;
      }
      for (const L of S.project.layers) if (L !== node) { dimmed.push([L, L.opacity]); L.opacity = L.opacity * 0.35; }
    }
    S.el.paper.style.visibility = S.show.outline ? 'hidden' : '';
    S.view.update(true);
    for (const [it, o] of dimmed) it.opacity = o;
    drawBg(); VX.drawOverlay && VX.drawOverlay(); drawRulers();
    VX.updateStatus && VX.updateStatus();
  }
  VX.renderNow = renderNow;

  function sizeCanvas(c, w, h) {
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    c.style.width = w + 'px'; c.style.height = h + 'px';
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return ctx;
  }
  VX.sizeCanvas = sizeCanvas;
  VX.stageSize = () => { const r = S.el.stage.getBoundingClientRect(); return { w: Math.max(1, r.width), h: Math.max(1, r.height) }; };
  VX.v2p = (x, y) => S.view.viewToProject(new paper.Point(x, y));
  VX.p2v = p => S.view.projectToView(p);

  function drawBg() {
    const { w, h } = VX.stageSize();
    const ctx = sizeCanvas(S.el.bg, w, h);
    ctx.fillStyle = S.show.outline ? '#d9dcda' : '#16191a';
    ctx.fillRect(0, 0, w, h);
    const z = VX.zoom();
    S.doc.artboards.forEach((ab, i) => {
      const p = VX.p2v(new paper.Point(ab.x, ab.y));
      const x = Math.round(p.x), y = Math.round(p.y), aw = Math.round(ab.w * z), ah = Math.round(ab.h * z);
      if (!S.show.outline) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4; ctx.fillStyle = '#fff'; ctx.fillRect(x, y, aw, ah); ctx.restore(); }
      if (ab.bg && ab.bg !== 'transparent') { ctx.fillStyle = ab.bg; ctx.fillRect(x, y, aw, ah); }
      else if (ab.bg === 'transparent') { checker(ctx, x, y, aw, ah); }
      else if (S.show.outline) { ctx.fillStyle = '#fff'; ctx.fillRect(x, y, aw, ah); }
    });
    if (S.show.grid) {
      const g = S.doc.grid || { size: 20, sub: 4 };
      const step = g.size * z, sub = step / (g.sub || 1);
      const o = VX.p2v(new paper.Point(0, 0));
      const lines = (st, col) => {
        if (st < 4) return;
        ctx.beginPath();
        for (let x = ((o.x % st) + st) % st; x < w; x += st) { ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, h); }
        for (let y = ((o.y % st) + st) % st; y < h; y += st) { ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(w, Math.round(y) + .5); }
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
      };
      lines(sub, 'rgba(120,140,130,.14)'); lines(step, 'rgba(110,130,120,.32)');
    }
  }
  function checker(ctx, x, y, w, h) {
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h); ctx.fillStyle = '#e4e4e4';
    for (let yy = y; yy < y + h; yy += 8) for (let xx = x + (((yy - y) / 8) % 2 ? 8 : 0); xx < x + w; xx += 16) ctx.fillRect(xx, yy, 8, 8);
    ctx.restore();
  }

  // ---------- rulers ----------
  const RULER = 20;
  function niceStep(minPx, z, unit) {
    const u = UNIT[unit];
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
    const fr = unit === 'in' ? [0.0625, 0.125, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100] : steps;
    for (const s of fr) if (s * u * z >= minPx) return s;
    return fr[fr.length - 1];
  }
  function drawRulers() {
    const on = S.show.rulers && !!S.doc;
    S.el.rulerH.hidden = S.el.rulerV.hidden = S.el.rulerCorner.hidden = !on;
    S.el.stage.classList.toggle('with-rulers', on);
    if (!on) return;
    const { w, h } = VX.stageSize();
    const unit = VX.unitLabel(), u = UNIT[unit], z = VX.zoom();
    const ab = S.doc.artboards[S.doc.ab] || { x: 0, y: 0 };
    const step = niceStep(70, z, unit);
    const minor = unit === 'in' ? 8 : step % 5 === 0 ? 5 : step % 2 === 0 ? 4 : 2;
    const sel = S.sel.length && VX.selBounds ? VX.selBounds(S.sel) : null;
    const draw = (c, len, horiz) => {
      const ctx = sizeCanvas(c, horiz ? len : RULER, horiz ? RULER : len);
      ctx.fillStyle = '#0a0f0c'; ctx.fillRect(0, 0, c.width, c.height);
      const origin = VX.p2v(new paper.Point(ab.x, ab.y));
      const o = horiz ? origin.x : origin.y;
      if (sel) { // highlight selection extent
        const a = VX.p2v(sel.topLeft), b = VX.p2v(sel.bottomRight);
        ctx.fillStyle = 'rgba(47,214,127,.16)';
        if (horiz) ctx.fillRect(a.x, 0, b.x - a.x, RULER); else ctx.fillRect(0, a.y, RULER, b.y - a.y);
      }
      ctx.strokeStyle = '#4d5d54'; ctx.fillStyle = '#7f9488'; ctx.font = '500 9.5px Manrope, sans-serif'; ctx.lineWidth = 1;
      const px = step * u * z, mpx = px / minor;
      const first = Math.floor(-o / px) - 1, last = Math.ceil((len - o) / px) + 1;
      ctx.beginPath();
      for (let i = first; i <= last; i++) {
        const pos = Math.round(o + i * px) + .5;
        if (horiz) { ctx.moveTo(pos, RULER); ctx.lineTo(pos, 2); } else { ctx.moveTo(RULER, pos); ctx.lineTo(2, pos); }
        for (let k = 1; k < minor; k++) {
          const mp = Math.round(o + i * px + k * mpx) + .5, l = k === minor / 2 ? 7 : 4;
          if (horiz) { ctx.moveTo(mp, RULER); ctx.lineTo(mp, RULER - l); } else { ctx.moveTo(RULER, mp); ctx.lineTo(RULER - l, mp); }
        }
        const label = String(+(i * step).toFixed(4));
        if (horiz) ctx.fillText(label, pos + 3, 9);
        else { ctx.save(); ctx.translate(9, pos + 3); ctx.rotate(-Math.PI / 2); ctx.fillText(label, 0, 0); ctx.restore(); }
      }
      ctx.stroke();
      ctx.fillStyle = '#1b2620'; if (horiz) ctx.fillRect(0, RULER - 1, len, 1); else ctx.fillRect(RULER - 1, 0, 1, len);
      if (S.cursorV) { ctx.strokeStyle = '#2fd67f'; ctx.beginPath(); const cp = horiz ? Math.round(S.cursorV.x) + .5 : Math.round(S.cursorV.y) + .5; if (horiz) { ctx.moveTo(cp, 0); ctx.lineTo(cp, RULER); } else { ctx.moveTo(0, cp); ctx.lineTo(RULER, cp); } ctx.stroke(); }
    };
    draw(S.el.rulerH, w, true); draw(S.el.rulerV, h, false);
  }
  VX.RULER = RULER;

  // ---------- view: zoom / pan / fit ----------
  VX.zoomTo = (z, anchor) => {
    if (!S.view) return;
    z = clamp(z, 0.02, 640);
    const { w, h } = VX.stageSize();
    anchor = anchor || new paper.Point(w / 2, h / 2);
    const before = S.view.viewToProject(anchor);
    S.view.zoom = z;
    const after = S.view.viewToProject(anchor);
    S.view.center = S.view.center.add(before.subtract(after));
    VX.req(); VX.onViewChange && VX.onViewChange();
  };
  VX.panBy = (dx, dy) => { S.view.center = S.view.center.subtract(new paper.Point(dx, dy).divide(VX.zoom())); VX.req(); VX.onViewChange && VX.onViewChange(); };
  VX.fitRect = (r, pad = 48) => {
    if (!S.view || !r) return;
    const { w, h } = VX.stageSize();
    const off = S.show.rulers ? RULER : 0;
    const z = Math.min((w - off - pad * 2) / Math.max(r.width, 1), (h - off - pad * 2) / Math.max(r.height, 1));
    S.view.zoom = clamp(z, 0.02, 640);
    const c = new paper.Point(r.x + r.width / 2, r.y + r.height / 2);
    S.view.center = c.subtract(new paper.Point(off / 2, off / 2).divide(S.view.zoom));
    VX.req(); VX.onViewChange && VX.onViewChange();
  };
  VX.fitArtboard = (i = S.doc && S.doc.ab) => { if (!S.doc) return; const ab = S.doc.artboards[i]; if (ab) VX.fitRect(new paper.Rectangle(ab.x, ab.y, ab.w, ab.h)); };
  VX.fitAll = () => {
    if (!S.doc) return;
    let r = null;
    for (const ab of S.doc.artboards) { const x = new paper.Rectangle(ab.x, ab.y, ab.w, ab.h); r = r ? r.unite(x) : x; }
    VX.fitRect(r);
  };
  VX.actualSize = () => VX.zoomTo(1);

  // ---------- input routing ----------
  function evAt(e, start) {
    const r = S.el.over.getBoundingClientRect();
    const v = new paper.Point(e.clientX - r.left, e.clientY - r.top);
    const point = S.view.viewToProject(v);
    return { e, v, point, raw: point, shift: e.shiftKey, alt: e.altKey, mod: VX.isMod(e), start: start ? start.point : point, startV: start ? start.v : v, delta: start ? point.subtract(start.point) : new paper.Point(0, 0), button: e.button };
  }
  VX.evAt = evAt;
  let drag = null;
  function onDown(e) {
    if (!S.doc) return;
    S.el.stage.focus({ preventScroll: true });
    if (VX.commitTextEdit && VX.textEditing && VX.textEditing()) VX.commitTextEdit();
    const ev = evAt(e);
    const panning = e.button === 1 || (e.button === 0 && (S.space || S.tool === 'hand'));
    if (e.button === 2) { VX.contextMenu && VX.contextMenu(ev); return; }
    if (e.button !== 0 && !panning) return;
    e.preventDefault();
    try { S.el.over.setPointerCapture(e.pointerId); } catch (_) {}
    if (panning) { drag = { pan: true, last: ev.v }; S.el.stage.classList.add('panning'); return; }
    if (S.tool === 'zoom' && !S.space) { drag = { zoom: true, start: ev }; return; }
    const t = VX.tools[S.tool];
    drag = { start: ev, tool: t, moved: false };
    t && t.down && t.down(ev);
    VX.req();
  }
  function onMove(e) {
    if (!S.doc) return;
    const ev = evAt(e, drag && drag.start);
    S.cursorV = ev.v; S.cursorP = ev.point;
    if (drag && drag.pan) { VX.panBy(ev.v.x - drag.last.x, ev.v.y - drag.last.y); drag.last = ev.v; return; }
    if (drag && drag.zoom) { drag.cur = ev; VX.req(); return; }
    if (drag && drag.tool) {
      if (!drag.moved && ev.v.getDistance(drag.start.v) < 3) return;
      drag.moved = true; ev.moved = true;
      drag.tool.drag && drag.tool.drag(ev);
      autoScroll(ev);
      VX.req(); return;
    }
    const t = VX.tools[S.tool];
    t && t.hover && t.hover(ev);
    VX.req();
  }
  function onUp(e) {
    if (!drag) return;
    const d = drag; drag = null;
    S.el.stage.classList.remove('panning');
    try { S.el.over.releasePointerCapture(e.pointerId); } catch (_) {}
    clearInterval(scrollTimer); scrollTimer = 0;
    if (d.pan) return;
    const ev = evAt(e, d.start); ev.moved = d.moved;
    if (d.zoom) {
      if (d.cur && d.cur.v.getDistance(d.start.v) > 6) { VX.fitRect(new paper.Rectangle(d.start.point, ev.point), 4); }
      else VX.zoomTo(VX.zoom() * (e.altKey ? 1 / 1.5 : 1.5), ev.v);
      return;
    }
    d.tool && d.tool.up && d.tool.up(ev);
    VX.req();
  }
  VX.dragging = () => drag;
  VX.zoomMarquee = () => drag && drag.zoom && drag.cur ? [drag.start.point, drag.cur.point] : null;
  let scrollTimer = 0;
  function autoScroll(ev) {
    const { w, h } = VX.stageSize(), m = 18;
    const dx = ev.v.x < m ? 12 : ev.v.x > w - m ? -12 : 0, dy = ev.v.y < m + (S.show.rulers ? RULER : 0) ? 12 : ev.v.y > h - m ? -12 : 0;
    if (!dx && !dy) { clearInterval(scrollTimer); scrollTimer = 0; return; }
    if (!scrollTimer) scrollTimer = setInterval(() => { if (!drag) { clearInterval(scrollTimer); scrollTimer = 0; return; } VX.panBy(dx, dy); }, 30);
  }

  // ---------- UI shell ----------
  function init(root) {
    S.root = root; root.innerHTML = '';
    const ws = h(`<div class="ws-vector">
      <div class="vx-rail" role="toolbar" aria-label="Vector tools"></div>
      <div class="vx-opts"></div>
      <div class="vx-stage" tabindex="0">
        <canvas class="vx-bg"></canvas><canvas class="vx-paper" data-paper-hidpi="on"></canvas><canvas class="vx-over"></canvas>
        <canvas class="vx-ruler vx-ruler-h" hidden></canvas><canvas class="vx-ruler vx-ruler-v" hidden></canvas><div class="vx-ruler-corner" hidden title="Rulers (Ctrl/Cmd+R)"></div>
        <div class="vx-empty"></div>
      </div>
      <div class="vx-status"></div>
      <aside class="vx-side panel">
        <div class="vx-sec vx-sec-top"><div class="vx-tabs" role="tablist"></div><div class="vx-sec-body"></div></div>
        <div class="vx-sec vx-sec-bottom"><div class="vx-tabs" role="tablist"></div><div class="vx-sec-body"></div></div>
      </aside></div>`);
    root.appendChild(ws);
    const el = S.el = {
      ws, rail: $('.vx-rail', ws), opts: $('.vx-opts', ws), stage: $('.vx-stage', ws), bg: $('.vx-bg', ws), paper: $('.vx-paper', ws), over: $('.vx-over', ws),
      rulerH: $('.vx-ruler-h', ws), rulerV: $('.vx-ruler-v', ws), rulerCorner: $('.vx-ruler-corner', ws), empty: $('.vx-empty', ws), status: $('.vx-status', ws),
      side: $('.vx-side', ws), topTabs: $('.vx-sec-top .vx-tabs', ws), topBody: $('.vx-sec-top .vx-sec-body', ws), botTabs: $('.vx-sec-bottom .vx-tabs', ws), botBody: $('.vx-sec-bottom .vx-sec-body', ws),
    };
    // paper.js scope bound to the document canvas; we draw on demand only.
    S.scope = paper; // the global scope: nothing else in RO3 uses paper.js
    paper.setup(el.paper);
    S.scope.settings.insertItems = true;
    S.scope.settings.handleSize = 6;
    S.project = S.scope.project; S.view = S.scope.view;
    S.view.autoUpdate = false;
    VX.installPatches && VX.installPatches();

    el.over.addEventListener('pointerdown', onDown);
    el.over.addEventListener('pointermove', onMove);
    el.over.addEventListener('pointerup', onUp);
    el.over.addEventListener('pointercancel', onUp);
    el.over.addEventListener('pointerleave', () => { S.cursorV = null; S.hover = null; if (!drag) VX.req(); });
    el.over.addEventListener('dblclick', e => { if (!S.doc) return; const t = VX.tools[S.tool]; t && t.dblclick && t.dblclick(evAt(e)); VX.req(); });
    el.over.addEventListener('contextmenu', e => e.preventDefault());
    el.stage.addEventListener('wheel', e => {
      if (!S.doc) return;
      e.preventDefault();
      const r = el.over.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) VX.zoomTo(VX.zoom() * Math.exp(-e.deltaY * 0.0022), new paper.Point(e.clientX - r.left, e.clientY - r.top));
      else if (e.altKey) VX.zoomTo(VX.zoom() * Math.exp(-e.deltaY * 0.0022), new paper.Point(e.clientX - r.left, e.clientY - r.top));
      else VX.panBy(e.shiftKey ? -e.deltaY : -e.deltaX, e.shiftKey ? 0 : -e.deltaY);
    }, { passive: false });
    el.stage.addEventListener('dragover', e => { e.preventDefault(); el.stage.classList.add('drop-over'); });
    el.stage.addEventListener('dragleave', () => el.stage.classList.remove('drop-over'));
    el.stage.addEventListener('drop', async e => {
      e.preventDefault(); el.stage.classList.remove('drop-over');
      const paths = Array.from(e.dataTransfer.files).map(f => ro3.pathOf(f)).filter(Boolean);
      for (const p of paths) { if (S.doc && !/\.ro3d$/i.test(p)) await VX.io.placePath(p, evAt(e).point); else await VX.io.openPath(p); }
    });
    // Rulers: drag out guides; corner toggles.
    const guideDrag = axis => e => { if (!S.doc) return; e.preventDefault(); e.stopPropagation(); VX.startGuideDrag && VX.startGuideDrag(e, axis, null); };
    el.rulerH.addEventListener('pointerdown', guideDrag('y'));
    el.rulerV.addEventListener('pointerdown', guideDrag('x'));
    el.rulerCorner.addEventListener('dblclick', () => { if (S.doc) { S.show.rulers = !S.show.rulers; VX.req(); } });

    new ResizeObserver(() => {
      const { w, h } = VX.stageSize();
      S.view.viewSize = new paper.Size(w, h);
      if (S.doc && !S.viewTouched) VX.fitArtboard(); else VX.req();
    }).observe(el.stage);
    VX.onViewChange = () => { S.viewTouched = true; VX.positionTextEditor && VX.positionTextEditor(); };

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', () => { if (S.space) { S.space = false; VX.updateCursor && VX.updateCursor(); } });
    document.addEventListener('copy', e => { if (!clipOk()) return; e.preventDefault(); VX.ops.copy(e.clipboardData); });
    document.addEventListener('cut', e => { if (!clipOk()) return; e.preventDefault(); VX.ops.cut(e.clipboardData); });
    document.addEventListener('paste', e => { if (!clipOk(true)) return; e.preventDefault(); VX.ops.paste('center', e.clipboardData); });

    VX.buildRail(); VX.buildSide(); VX.renderOptions(); VX.updateStatus(); renderEmpty();
    VX.io.initFonts().catch(e => console.warn('fonts', e));
    try { const prefs = JSON.parse(localStorage.getItem('ro3.vector.prefs') || '{}'); Object.assign(S.show, prefs.show || {}); if (prefs.strokeStyle) Object.assign(S.strokeStyle, prefs.strokeStyle, { dash: null }); if (prefs.textStyle) Object.assign(S.textStyle, prefs.textStyle); } catch (_) {}
    setInterval(autosaveTick, 4000);
    setTimeout(checkRecovery, 1500);
  }
  const clipOk = (paste) => RO3App.active === 'vector' && !isTyping() && !document.querySelector('.modal-backdrop, .palette-backdrop') && (paste || (S.doc && S.sel.length));
  VX.savePrefs = () => { try { localStorage.setItem('ro3.vector.prefs', JSON.stringify({ show: { rulers: S.show.rulers, grid: S.show.grid, smart: S.show.smart, snapGrid: S.show.snapGrid, guides: S.show.guides }, strokeStyle: { width: S.strokeStyle.width, cap: S.strokeStyle.cap, join: S.strokeStyle.join }, textStyle: S.textStyle })); } catch (_) {} };

  function renderEmpty() {
    const el = S.el;
    el.empty.hidden = !!S.doc;
    el.ws.classList.toggle('no-doc', !S.doc);
    if (S.doc) return;
    const P = VX.PRESETS || [];
    el.empty.innerHTML = `<div class="vx-start">
      <div class="vx-start-head">${icon('vPen', 'ico-xl')}<div><h3>Start a design</h3><p class="muted">Logos, social graphics, flyers and icons. Opens .ai (PDF-compatible), .pdf, .svg and .ro3d files.</p></div></div>
      <div class="vx-presets">${P.filter(p => p.quick).map(p => `<button class="vx-preset" data-p="${esc(p.id)}"><span class="vx-pv" style="aspect-ratio:${p.w}/${p.h}"></span><strong>${esc(p.label)}</strong><em>${esc(p.sub)}</em></button>`).join('')}</div>
      <div class="row"><button class="btn btn-primary" data-act="new">${icon('plus')}New document…</button><button class="btn" data-act="open">${icon('open')}Open…</button></div>
      <p class="kbd">Or drop an SVG, PDF or AI file here</p></div>`;
    $('[data-act="new"]', el.empty).addEventListener('click', () => VX.newDocDialog());
    $('[data-act="open"]', el.empty).addEventListener('click', () => VX.io.open());
    $$('.vx-preset', el.empty).forEach(b => b.addEventListener('click', () => { const p = P.find(x => x.id === b.dataset.p); VX.createDoc({ name: 'Untitled', w: p.w, h: p.h, units: p.units || 'px' }); }));
  }
  VX.renderEmpty = renderEmpty;

  // ---------- keyboard ----------
  function modalOpen() { return !!document.querySelector('.modal-backdrop, .palette-backdrop'); }
  function onKey(e) {
    if (RO3App.active !== 'vector' || modalOpen() || isTyping()) return;
    const mod = VX.isMod(e), k = e.key.toLowerCase(), code = e.code;
    if (code === 'Space' && !mod) { if (!S.space) { S.space = true; VX.updateCursor && VX.updateCursor(); } e.preventDefault(); return; }
    // Document-independent shortcuts
    if (mod && !e.altKey && k === 'n') { e.preventDefault(); VX.newDocDialog(); return; }
    if (mod && e.shiftKey && !e.altKey && k === 'p') { e.preventDefault(); VX.io.place(); return; }
    if (!S.doc) return;
    const t = VX.tools[S.tool];
    if (t && t.key && t.key(e) === true) { e.preventDefault(); return; }
    const run = (fn) => { e.preventDefault(); e.stopPropagation(); fn(); };
    if (mod) {
      const digit = code.startsWith('Digit') ? code.slice(5) : null;
      const mac = ro3.platform === 'darwin';
      if (k === 'z' && !e.shiftKey) return run(VX.undo);
      if ((k === 'z' && e.shiftKey) || (code === 'KeyY' && !mac && !e.altKey && !e.shiftKey)) return run(VX.redo);
      if (code === 'KeyY' && (mac || e.altKey)) return run(() => VX.toggleShow('outline'));
      if (k === 'a' && !e.shiftKey) return run(VX.selectAll);
      if (k === 'a' && e.shiftKey) return run(VX.deselect);
      if (code === 'KeyG' && e.shiftKey) return run(VX.ops.ungroup);
      if (code === 'KeyG') return run(VX.ops.group);
      if (code === 'KeyD' && !e.shiftKey) return run(VX.ops.transformAgain);
      if (code === 'KeyF' && !e.shiftKey) return run(() => VX.ops.paste('front'));
      if (code === 'KeyB' && !e.shiftKey) return run(() => VX.ops.paste('back'));
      if (code === 'KeyV' && e.shiftKey) return run(() => VX.ops.paste('inplace'));
      if (code === 'KeyO' && e.shiftKey) return run(() => VX.io.outlineText());
      if (code === 'KeyJ' && !e.shiftKey) return run(VX.ops.join);
      if (code === 'KeyR' && !e.altKey) return run(() => VX.toggleShow('rulers'));
      if (code === 'Semicolon' && !e.shiftKey) return run(() => VX.toggleShow('guides'));
      if (code === 'Quote' && e.shiftKey) return run(() => VX.toggleShow('snapGrid'));
      if (code === 'Quote') return run(() => VX.toggleShow('grid'));
      if (code === 'KeyU') return run(() => VX.toggleShow('smart'));
      if (code === 'KeyH' && e.shiftKey) return run(() => VX.toggleShow('bounds'));
      if (code === 'BracketRight') return run(() => VX.ops.arrange(e.shiftKey ? 'front' : 'forward'));
      if (code === 'BracketLeft') return run(() => VX.ops.arrange(e.shiftKey ? 'back' : 'backward'));
      if (digit === '0' && e.altKey) return run(VX.fitAll);
      if (digit === '0') return run(() => VX.fitArtboard());
      if (digit === '1' && e.altKey) return run(VX.actualSize);
      if (digit === '7' && e.altKey) return run(VX.ops.releaseClip);
      if (digit === '7') return run(VX.ops.makeClip);
      if (digit === '8' && e.altKey && e.shiftKey) return run(VX.ops.releaseCompound);
      if (digit === '8') return run(VX.ops.makeCompound);
      if (code === 'Equal' || code === 'NumpadAdd') return run(() => VX.zoomTo(VX.zoom() * 1.25));
      if (code === 'Minus' || code === 'NumpadSubtract') return run(() => VX.zoomTo(VX.zoom() / 1.25));
      if (code === 'Slash' && e.altKey) return run(VX.ops.unlockAll);
      if (code === 'Slash' && e.shiftKey) return run(VX.ops.hide);
      if (code === 'Slash') return run(VX.ops.lock);
      if (code === 'Backslash' && e.altKey) return run(VX.ops.showAll);
      if (code === 'KeyE' && e.altKey && e.shiftKey) return run(() => VX.io.exportScreens());
      if (code === 'KeyE' && e.shiftKey) return run(() => VX.io.exportDialog());
      return;
    }
    if (k === 'escape') return run(() => { if (S.isolation) VX.exitIsolation(); else if (S.pts.size) { S.pts.clear(); VX.req(); } else VX.deselect(); });
    if (k === 'delete' || k === 'backspace') return run(VX.ops.del);
    if (k.startsWith('arrow')) {
      const n = e.shiftKey ? 10 : 1;
      const d = { arrowleft: [-n, 0], arrowright: [n, 0], arrowup: [0, -n], arrowdown: [0, n] }[k];
      return run(() => VX.ops.nudge(d[0], d[1], e.altKey));
    }
    if (code === 'KeyX' && e.shiftKey) return run(VX.ops.swapColors);
    if (code === 'KeyX') return run(() => { S.focus = S.focus === 'fill' ? 'stroke' : 'fill'; VX.syncColorWidget(); });
    if (code === 'KeyD' && !e.shiftKey) return run(VX.ops.defaultColors);
    if (code === 'Slash' && !e.shiftKey) return run(VX.ops.noneColor);
    if (code === 'Comma' && !e.shiftKey) return run(() => VX.ops.setFocusType('solid'));
    if (code === 'Period' && !e.shiftKey) return run(() => VX.ops.setFocusType('gradient'));
    if (code === 'Enter' && S.sel.length && S.tool === 'select') return run(VX.ops.moveDialog);
    if (code === 'Tab') return run(() => S.el.ws.classList.toggle('panels-hidden'));
    // Tool shortcuts (Illustrator letters)
    const combo = (e.shiftKey ? 'shift+' : '') + (code.startsWith('Key') ? code.slice(3).toLowerCase() : code === 'Equal' ? '+' : code === 'Minus' ? '-' : code === 'Backslash' ? '\\' : code === 'Backquote' ? '`' : code === 'NumpadAdd' ? '+' : code === 'NumpadSubtract' ? '-' : k);
    const tool = VX.TOOL_LIST.find(x => x.key === combo || (x.key2 && x.key2 === combo));
    if (tool) return run(() => VX.setTool(tool.id));
  }
  function onKeyUp(e) {
    if (e.code === 'Space' && S.space) { S.space = false; VX.updateCursor && VX.updateCursor(); }
    const t = VX.tools && VX.tools[S.tool];
    if (t && t.keyup && RO3App.active === 'vector') t.keyup(e);
  }
  VX.toggleShow = (key, val) => {
    S.show[key] = val == null ? !S.show[key] : val;
    if (key === 'rulers') { const { w, h } = VX.stageSize(); S.view.viewSize = new paper.Size(w, h); }
    VX.savePrefs(); VX.req(); VX.updateStatus(); VX.renderOptions();
    const names = { rulers: 'Rulers', guides: 'Guides', grid: 'Grid', snapGrid: 'Snap to grid', smart: 'Smart guides', outline: 'Outline view', bounds: 'Bounding box' };
    if (key !== 'rulers') toast(`${names[key]} ${S.show[key] ? 'on' : 'off'}`, 'info', 1400);
  };

  // ---------- autosave & recovery ----------
  let lastAutosave = 0;
  async function autosaveTick() {
    if (!S.doc || !S.doc.dirty || S.doc.autosaved === S.hist.i + ':' + S.hist.stack.length) return;
    if (Date.now() - lastAutosave < 3500) return;
    lastAutosave = Date.now();
    try { await ro3.autosaveWrite('vector.ro3d', VX.serialize()); S.doc.autosaved = S.hist.i + ':' + S.hist.stack.length; } catch (e) { console.warn('autosave failed', e); }
  }
  VX.autosaveNow = async () => { lastAutosave = 0; if (S.doc) S.doc.autosaved = null; await autosaveTick(); };
  async function checkRecovery(force) {
    if (window.RO3_NO_RECOVERY && !force) return;
    const r = await ro3.autosaveRead('vector.ro3d').catch(() => null);
    if (!r || !r.text) return;
    // Wait for any other startup dialog (e.g. photo/video recovery) to close first.
    for (let i = 0; i < 600 && document.querySelector('.modal-backdrop'); i++) await new Promise(res => setTimeout(res, 500));
    if (window.RO3_NO_RECOVERY && !force) return;
    let name = 'Vector design';
    try { name = JSON.parse(r.text).name || name; } catch (_) {}
    const m = Math.round((Date.now() - r.mtime) / 60000);
    modal({ title: 'Recover unsaved design?', body: `<p class="muted">RO3 closed before this was saved:</p><ul class="recover-list"><li><strong>${esc(name)}</strong> — autosaved ${m < 1 ? 'moments ago' : m < 60 ? m + ' min ago' : new Date(r.mtime).toLocaleString()}</li></ul>`,
      actions: [
        { label: 'Discard', kind: 'ghost', onClick: () => { ro3.autosaveClear('vector.ro3d'); } },
        { label: 'Recover', kind: 'primary', onClick: async () => { RO3App.show('vector'); try { await VX.deserialize(r.text, null, { recovered: true }); toast('Recovered your unsaved design. Save it to keep it.', 'ok', 5000); } catch (e) { toast(`Couldn't recover the design: ${e.message}`, 'error'); } } },
      ] });
  }
  VX.checkRecovery = checkRecovery;

  // ---------- commands (menu ids, palette) ----------
  const ops = n => (...a) => VX.ops[n](...a);
  const COMMANDS = [
    // File
    ['new', 'New Document…', 'File', 'CmdOrCtrl+N', () => VX.newDocDialog(), true],
    ['open', 'Open…', 'File', 'CmdOrCtrl+O', () => VX.io.open(), true],
    ['save', 'Save', 'File', 'CmdOrCtrl+S', () => VX.io.save(false)],
    ['save-as', 'Save As…', 'File', 'CmdOrCtrl+Shift+S', () => VX.io.save(true)],
    ['place', 'Place…', 'File', 'CmdOrCtrl+Shift+P', () => VX.io.place()],
    ['export', 'Export As (PNG, JPG, WebP, SVG, PDF)…', 'File › Export', 'CmdOrCtrl+Shift+E', () => VX.io.exportDialog()],
    ['export-png', 'Export PNG…', 'File › Export', '', () => VX.io.exportDialog('png')],
    ['export-svg', 'Export SVG…', 'File › Export', '', () => VX.io.exportDialog('svg')],
    ['export-pdf', 'Export PDF…', 'File › Export', '', () => VX.io.exportDialog('pdf')],
    ['export-screens', 'Export for Screens…', 'File › Export', 'CmdOrCtrl+Alt+Shift+E', () => VX.io.exportScreens()],
    ['doc-setup', 'Document Setup…', 'File', '', () => VX.docSetupDialog()],
    // Edit
    ['undo', 'Undo', 'Edit', 'CmdOrCtrl+Z', () => VX.undo()],
    ['redo', 'Redo', 'Edit', 'CmdOrCtrl+Shift+Z', () => VX.redo()],
    ['copy', 'Copy', 'Edit', 'CmdOrCtrl+C', ops('copy')],
    ['cut', 'Cut', 'Edit', 'CmdOrCtrl+X', ops('cut')],
    ['paste', 'Paste', 'Edit', 'CmdOrCtrl+V', () => VX.ops.paste('center')],
    ['paste-front', 'Paste in Front', 'Edit', 'CmdOrCtrl+F', () => VX.ops.paste('front')],
    ['paste-back', 'Paste in Back', 'Edit', 'CmdOrCtrl+B', () => VX.ops.paste('back')],
    ['paste-in-place', 'Paste in Place', 'Edit', 'CmdOrCtrl+Shift+V', () => VX.ops.paste('inplace')],
    ['duplicate', 'Duplicate', 'Edit', '', ops('duplicate')],
    ['delete', 'Delete', 'Edit', 'Delete', ops('del')],
    ['select-all', 'Select All', 'Select', 'CmdOrCtrl+A', () => VX.selectAll()],
    ['deselect', 'Deselect', 'Select', 'CmdOrCtrl+Shift+A', () => VX.deselect()],
    ['select-same-fill', 'Select Same Fill Color', 'Select › Same', '', () => VX.selectSame('fill')],
    ['select-same-stroke', 'Select Same Stroke Color', 'Select › Same', '', () => VX.selectSame('stroke')],
    // Object
    ['transform-again', 'Transform Again', 'Object › Transform', 'CmdOrCtrl+D', ops('transformAgain')],
    ['move', 'Move…', 'Object › Transform', 'Enter', ops('moveDialog')],
    ['rotate', 'Rotate…', 'Object › Transform', '', ops('rotateDialog')],
    ['scale', 'Scale…', 'Object › Transform', '', ops('scaleDialog')],
    ['flip-h', 'Flip Horizontal', 'Object › Transform', '', () => VX.ops.flip('h')],
    ['flip-v', 'Flip Vertical', 'Object › Transform', '', () => VX.ops.flip('v')],
    ['front', 'Bring to Front', 'Object › Arrange', 'CmdOrCtrl+Shift+]', () => VX.ops.arrange('front')],
    ['forward', 'Bring Forward', 'Object › Arrange', 'CmdOrCtrl+]', () => VX.ops.arrange('forward')],
    ['backward', 'Send Backward', 'Object › Arrange', 'CmdOrCtrl+[', () => VX.ops.arrange('backward')],
    ['back', 'Send to Back', 'Object › Arrange', 'CmdOrCtrl+Shift+[', () => VX.ops.arrange('back')],
    ['group', 'Group', 'Object', 'CmdOrCtrl+G', ops('group')],
    ['ungroup', 'Ungroup', 'Object', 'CmdOrCtrl+Shift+G', ops('ungroup')],
    ['lock', 'Lock Selection', 'Object', 'CmdOrCtrl+/', ops('lock')],
    ['unlock-all', 'Unlock All', 'Object', 'CmdOrCtrl+Alt+/', ops('unlockAll')],
    ['hide', 'Hide Selection', 'Object', 'CmdOrCtrl+Shift+/', ops('hide')],
    ['show-all', 'Show All', 'Object', 'CmdOrCtrl+Alt+\\', ops('showAll')],
    ['compound', 'Make Compound Path', 'Object › Compound Path', 'CmdOrCtrl+8', ops('makeCompound')],
    ['release-compound', 'Release Compound Path', 'Object › Compound Path', 'CmdOrCtrl+Alt+Shift+8', ops('releaseCompound')],
    ['clip', 'Make Clipping Mask', 'Object › Clipping Mask', 'CmdOrCtrl+7', ops('makeClip')],
    ['release-clip', 'Release Clipping Mask', 'Object › Clipping Mask', 'CmdOrCtrl+Alt+7', ops('releaseClip')],
    ['join', 'Join', 'Object › Path', 'CmdOrCtrl+J', ops('join')],
    ['reverse', 'Reverse Path Direction', 'Object › Path', '', ops('reverse')],
    ['offset', 'Offset Path…', 'Object › Path', '', ops('offsetDialog')],
    ['outline-stroke', 'Outline Stroke', 'Object › Path', '', ops('outlineStroke')],
    ['simplify', 'Simplify…', 'Object › Path', '', ops('simplifyDialog')],
    ['smooth', 'Smooth Path', 'Object › Path', '', ops('smoothPaths')],
    ['add-anchors', 'Add Anchor Points', 'Object › Path', '', ops('addAnchors')],
    ['flatten', 'Expand Appearance', 'Object', '', ops('expandAppearance')],
    ['corner-radius', 'Round Corners…', 'Object › Path', '', ops('roundCornersDialog')],
    ['pathfinder:unite', 'Unite', 'Object › Pathfinder', '', () => VX.ops.pathfinder('unite')],
    ['pathfinder:minus-front', 'Minus Front', 'Object › Pathfinder', '', () => VX.ops.pathfinder('minus-front')],
    ['pathfinder:intersect', 'Intersect', 'Object › Pathfinder', '', () => VX.ops.pathfinder('intersect')],
    ['pathfinder:exclude', 'Exclude', 'Object › Pathfinder', '', () => VX.ops.pathfinder('exclude')],
    ['pathfinder:divide', 'Divide', 'Object › Pathfinder', '', () => VX.ops.pathfinder('divide')],
    ['pathfinder:trim', 'Trim', 'Object › Pathfinder', '', () => VX.ops.pathfinder('trim')],
    ['pathfinder:merge', 'Merge', 'Object › Pathfinder', '', () => VX.ops.pathfinder('merge')],
    ['pathfinder:crop', 'Crop', 'Object › Pathfinder', '', () => VX.ops.pathfinder('crop')],
    ['pathfinder:minus-back', 'Minus Back', 'Object › Pathfinder', '', () => VX.ops.pathfinder('minus-back')],
    ['align:left', 'Align Left', 'Object › Align', '', () => VX.ops.align('left')],
    ['align:hcenter', 'Align Horizontal Centers', 'Object › Align', '', () => VX.ops.align('hcenter')],
    ['align:right', 'Align Right', 'Object › Align', '', () => VX.ops.align('right')],
    ['align:top', 'Align Top', 'Object › Align', '', () => VX.ops.align('top')],
    ['align:vcenter', 'Align Vertical Centers', 'Object › Align', '', () => VX.ops.align('vcenter')],
    ['align:bottom', 'Align Bottom', 'Object › Align', '', () => VX.ops.align('bottom')],
    ['distribute:h', 'Distribute Horizontal Spacing', 'Object › Distribute', '', () => VX.ops.distribute('space-h')],
    ['distribute:v', 'Distribute Vertical Spacing', 'Object › Distribute', '', () => VX.ops.distribute('space-v')],
    ['place-image', 'Place Image…', 'Object', '', () => VX.io.place()],
    ['trace', 'Image Trace…', 'Object', '', () => VX.io.traceDialog()],
    ['rasterize', 'Rasterize…', 'Object', '', () => VX.io.rasterizeSelection()],
    // Type
    ['outline-text', 'Create Outlines', 'Type', 'CmdOrCtrl+Shift+O', () => VX.io.outlineText()],
    ['load-font', 'Load Font File…', 'Type', '', () => VX.io.loadFontDialog()],
    // Artboards
    ['artboard-new', 'New Artboard', 'Artboards', '', () => VX.ab.add()],
    ['artboard-duplicate', 'Duplicate Artboard', 'Artboards', '', () => VX.ab.duplicate()],
    ['artboard-delete', 'Delete Artboard', 'Artboards', '', () => VX.ab.remove()],
    ['artboard-fit', 'Fit Artboard to Artwork', 'Artboards', '', () => VX.ab.fitToArt()],
    // View
    ['fit-artboard', 'Fit Artboard in Window', 'View', 'CmdOrCtrl+0', () => VX.fitArtboard()],
    ['fit-all', 'Fit All in Window', 'View', 'CmdOrCtrl+Alt+0', () => VX.fitAll()],
    ['actual-size', 'Actual Size', 'View', 'CmdOrCtrl+Alt+1', () => VX.actualSize()],
    ['zoom-in', 'Zoom In', 'View', 'CmdOrCtrl+=', () => VX.zoomTo(VX.zoom() * 1.25)],
    ['zoom-out', 'Zoom Out', 'View', 'CmdOrCtrl+-', () => VX.zoomTo(VX.zoom() / 1.25)],
    ['rulers', 'Show / Hide Rulers', 'View', 'CmdOrCtrl+R', () => VX.toggleShow('rulers')],
    ['guides', 'Show / Hide Guides', 'View', 'CmdOrCtrl+;', () => VX.toggleShow('guides')],
    ['clear-guides', 'Clear Guides', 'View', '', () => VX.clearGuides()],
    ['grid', 'Show / Hide Grid', 'View', "CmdOrCtrl+'", () => VX.toggleShow('grid')],
    ['snap-grid', 'Snap to Grid', 'View', 'CmdOrCtrl+Shift+\'', () => VX.toggleShow('snapGrid')],
    ['smart-guides', 'Smart Guides', 'View', 'CmdOrCtrl+U', () => VX.toggleShow('smart')],
    ['outline-mode', 'Outline / Preview', 'View', 'CmdOrCtrl+Alt+Y', () => VX.toggleShow('outline')],
    ['bounding-box', 'Show / Hide Bounding Box', 'View', 'CmdOrCtrl+Shift+H', () => VX.toggleShow('bounds')],
    // Panels
    ['panel:props', 'Properties Panel', 'Window', '', () => VX.showPanel('props')],
    ['panel:align', 'Align & Pathfinder Panel', 'Window', '', () => VX.showPanel('align')],
    ['panel:swatches', 'Swatches Panel', 'Window', '', () => VX.showPanel('swatches')],
    ['panel:layers', 'Layers Panel', 'Window', '', () => VX.showPanel('layers')],
    ['panel:artboards', 'Artboards Panel', 'Window', '', () => VX.showPanel('artboards')],
  ];
  VX.COMMANDS = COMMANDS;
  const NEEDS_NO_DOC = new Set(['new', 'open', 'place', 'load-font']);

  function menu(cmd) {
    if (cmd === 'open') return VX.io.open();
    if (cmd === 'save') return S.doc ? VX.io.save(false) : null;
    if (cmd === 'save-as') return S.doc ? VX.io.save(true) : null;
    if (cmd === 'export') return S.doc ? VX.io.exportDialog() : toast('Create or open a design first.', 'error');
    if (cmd === 'undo') { if (VX.textEditing && VX.textEditing()) return; return VX.undo(); }
    if (cmd === 'redo') return VX.redo();
    if (!cmd.startsWith('vector:')) return;
    const id = cmd.slice(7);
    if (id.startsWith('tool:')) return VX.setTool(id.slice(5));
    const c = COMMANDS.find(x => x[0] === id);
    if (!c) return;
    if (!S.doc && !NEEDS_NO_DOC.has(id)) return toast('Create or open a design first.', 'error');
    return c[4]();
  }

  const commands = () => {
    const tools = (VX.TOOL_LIST || []).map(t => ({ label: t.name, path: 'Vector › Tools', accel: t.label || (t.key || '').replace('shift+', 'Shift+').toUpperCase().replace('SHIFT+', 'Shift+'), run: () => { RO3App.show('vector'); VX.setTool(t.id); } }));
    const cmds = COMMANDS.map(([id, label, path, accel, run]) => ({ label, path: 'Vector › ' + path, accel, cmd: 'vector:' + id, run: () => { RO3App.show('vector'); if (!S.doc && !NEEDS_NO_DOC.has(id)) return toast('Create or open a design first.', 'error'); run(); } }));
    return [...tools, ...cmds];
  };

  function activate(bar) {
    S.active = true;
    const b = (ic, label, fn, kind = '', title = '') => { const x = h(`<button class="btn ${kind}" title="${esc(title || label)}">${icon(ic)}${label}</button>`); x.addEventListener('click', e => fn(e.currentTarget)); return x; };
    const u = b('undo', '', () => VX.undo(), 'btn-ghost', 'Undo (Ctrl/Cmd+Z)'), r = b('redo', '', () => VX.redo(), 'btn-ghost', 'Redo (Ctrl/Cmd+Shift+Z)');
    u.style.padding = r.style.padding = '0 8px';
    bar.append(
      b('plus', 'New', () => VX.newDocDialog(), 'btn-ghost', 'New document (Ctrl/Cmd+N)'),
      b('open', 'Open', () => VX.io.open(), 'btn-ghost', 'Open .ro3d, .svg, .pdf or .ai (Ctrl/Cmd+O)'),
      b('vPlace', 'Place', () => VX.io.place(), 'btn-ghost', 'Place an image, SVG or PDF (Ctrl/Cmd+Shift+P)'),
      u, r,
      b('save', 'Save', () => S.doc && VX.io.save(false), 'btn-ghost', 'Save (Ctrl/Cmd+S)'),
      b('export', 'Export', () => S.doc ? VX.io.exportDialog() : toast('Create or open a design first.', 'error'), 'btn-primary', 'Export PNG, JPG, SVG or PDF (Ctrl/Cmd+Shift+E)'),
    );
    requestAnimationFrame(() => { const { w, h } = VX.stageSize(); S.view.viewSize = new paper.Size(w, h); if (S.doc && !S.viewTouched) VX.fitArtboard(); VX.req(); });
  }
  function deactivate() { S.active = false; if (VX.commitTextEdit && VX.textEditing && VX.textEditing()) VX.commitTextEdit(); S.space = false; }
  function openPath(p) { return VX.io.openPath(p); }
  const unsaved = () => S.doc && S.doc.dirty ? [`The vector design “${S.doc.name}”`] : [];

  return { init, activate, deactivate, menu, openPath, unsaved, commands, _debug: () => VX };
})();
