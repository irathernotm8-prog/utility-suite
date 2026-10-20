// Photo editor: layers, selections, masks, painting, colour, frames and export.
const PhotoEditor = (() => {
  const O = PhotoOps;
  const BLENDS = [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['darken', 'Darken'], ['lighten', 'Lighten'],
    ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'], ['hard-light', 'Hard light'], ['soft-light', 'Soft light'], ['difference', 'Difference'],
    ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity'],
    ['linear-burn', 'Linear burn'], ['linear-dodge', 'Linear dodge (add)'], ['vivid-light', 'Vivid light'], ['linear-light', 'Linear light'], ['pin-light', 'Pin light'],
    ['hard-mix', 'Hard mix'], ['subtract', 'Subtract'], ['divide', 'Divide'], ['darker-color', 'Darker color'], ['lighter-color', 'Lighter color'], ['dissolve', 'Dissolve']];
  const TOOLS = [
    { id: 'move', icon: 'move', name: 'Move', key: 'v' },
    { id: 'transform', icon: 'transform', name: 'Transform', key: 'ctrl+t', label: 'Ctrl+T' },
    { id: 'rect', icon: 'rect', name: 'Rectangle select', key: 'm' },
    { id: 'ellipse', icon: 'ellipse', name: 'Ellipse select', key: 'shift+m' },
    { id: 'lasso', icon: 'lasso', name: 'Lasso select', key: 'l' },
    { id: 'polylasso', icon: 'polylasso', name: 'Polygonal lasso', key: 'shift+l' },
    { id: 'selbrush', icon: 'selbrush', name: 'Selection brush', key: 'q' },
    { id: 'quick', icon: 'quick', name: 'Quick selection', key: 'w' },
    { id: 'wand', icon: 'wand', name: 'Magic wand', key: 'shift+w' },
    { id: 'crop', icon: 'crop', name: 'Crop', key: 'c' },
    { id: 'perspcrop', icon: 'perspcrop', name: 'Perspective crop', key: 'shift+c' },
    'sep',
    { id: 'brush', icon: 'brush', name: 'Brush', key: 'b' },
    { id: 'pencil', icon: 'pencil', name: 'Pencil (hard edge)', key: 'shift+b' },
    { id: 'colorreplace', icon: 'colorreplace', name: 'Color replacement', key: 'alt+b' },
    { id: 'eraser', icon: 'eraser', name: 'Eraser', key: 'e' },
    { id: 'bgeraser', icon: 'bgeraser', name: 'Background eraser', key: 'shift+e' },
    { id: 'magiceraser', icon: 'magiceraser', name: 'Magic eraser', key: 'alt+e' },
    { id: 'heal', icon: 'heal', name: 'Spot healing brush', key: 'j' },
    { id: 'healbrush', icon: 'healbrush', name: 'Healing brush', key: 'shift+j' },
    { id: 'patch', icon: 'patch', name: 'Patch', key: 'alt+j' },
    { id: 'camove', icon: 'camove', name: 'Content-aware move', key: '', label: 'J' },
    { id: 'redeye', icon: 'redeye', name: 'Red eye', key: '', label: 'J' },
    { id: 'clone', icon: 'clone', name: 'Clone stamp', key: 's' },
    { id: 'historybrush', icon: 'historybrush', name: 'History brush', key: 'y' },
    { id: 'blur', icon: 'blur', name: 'Blur brush', key: 'r' },
    { id: 'sharpenbrush', icon: 'sharpenbrush', name: 'Sharpen brush', key: 'alt+r' },
    { id: 'smudge', icon: 'smudge', name: 'Smudge', key: 'shift+r' },
    { id: 'liquify', icon: 'liquify', name: 'Liquify', key: 'ctrl+shift+x', label: 'Ctrl+Shift+X' },
    { id: 'dodge', icon: 'dodge', name: 'Dodge (lighten)', key: 'o' },
    { id: 'burn', icon: 'burn', name: 'Burn (darken)', key: 'shift+o' },
    { id: 'sponge', icon: 'sponge', name: 'Sponge (saturation)', key: 'alt+o' },
    { id: 'gradient', icon: 'gradient', name: 'Gradient', key: 'shift+g' },
    { id: 'fill', icon: 'fill', name: 'Fill', key: 'g' },
    { id: 'shape', icon: 'shape', name: 'Shapes', key: 'u' },
    { id: 'text', icon: 'text', name: 'Text', key: 't' },
    { id: 'pen', icon: 'pen', name: 'Pen (paths)', key: 'p' },
    { id: 'dropper', icon: 'dropper', name: 'Eyedropper', key: 'i' },
    { id: 'sampler', icon: 'sampler', name: 'Color sampler', key: 'shift+i' },
    { id: 'ruler', icon: 'ruler', name: 'Ruler (straighten)', key: 'alt+i' },
    'sep',
    { id: 'hand', icon: 'hand', name: 'Hand', key: 'h' },
    { id: 'zoom', icon: 'zoom', name: 'Zoom', key: 'z' },
  ];
  const PAINT_TOOLS = ['brush', 'pencil', 'colorreplace', 'eraser', 'bgeraser', 'blur', 'sharpenbrush', 'clone', 'historybrush', 'selbrush', 'heal', 'healbrush', 'smudge', 'dodge', 'burn', 'sponge', 'quick'];
  // Rail slots: related tools share one button (right-click or long-press to switch, like Photoshop).
  const GROUPS = [['move', 'transform'], ['rect', 'ellipse'], ['lasso', 'polylasso', 'selbrush'], ['quick', 'wand'], ['crop', 'perspcrop'], 'sep',
    ['brush', 'pencil', 'colorreplace'], ['eraser', 'bgeraser', 'magiceraser'], ['heal', 'healbrush', 'patch', 'camove', 'redeye'], ['clone', 'historybrush'], ['blur', 'sharpenbrush', 'smudge', 'liquify'], ['dodge', 'burn', 'sponge'], ['gradient', 'fill'], ['shape', 'pen'], ['text'], ['dropper', 'sampler', 'ruler'], 'sep', ['hand'], ['zoom']];
  const groupOf = id => GROUPS.find(g => g !== 'sep' && g.includes(id));
  const groupCurrent = new Map();
  const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 11a7 7 0 1 0-2 5" fill="none" stroke="black" stroke-width="4" stroke-linecap="round"/><path d="M19 11a7 7 0 1 0-2 5" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"/><path d="M15 9.5h5.5V4z" fill="white" stroke="black" stroke-width="1"/></svg>')}") 12 12, crosshair`;
  const FONTS = ['Manrope', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Trebuchet MS', 'Verdana', 'system-ui'];

  // ---------- state ----------
  let doc = null;
  let tool = 'move';
  const T = {
    brush: { size: 24, hardness: 0.8, opacity: 1, flow: 1, smoothing: 0 },
    eraser: { size: 40, hardness: 0.6, opacity: 1 },
    blur: { size: 60, strength: 4 },
    fill: { tolerance: 32, contiguous: true },
    wand: { tolerance: 32, contiguous: true, sampleAll: false },
    select: { mode: 'new', feather: 0 },
    crop: { ratio: 'free' },
    selbrush: { size: 40, hardness: 0.7, mode: 'add' },
    quick: { size: 30, sensitivity: 45, sampleAll: true, enhance: true },
    clone: { size: 60, hardness: 0.6, opacity: 1, aligned: true },
    heal: { size: 40, hardness: 0.7, mode: 'content' },
    smudge: { size: 40, strength: 60 },
    pencil: { size: 4, opacity: 1 },
    colorreplace: { size: 40, hardness: 0.6, tolerance: 30, mode: 'color' },
    bgeraser: { size: 60, hardness: 0.8, tolerance: 50, sampling: 'continuous', limits: 'contiguous', protect: false },
    magiceraser: { tolerance: 32, contiguous: true, opacity: 1 },
    healbrush: { size: 40, hardness: 0.6 },
    patch: { mode: 'source' },
    camove: { mode: 'move' },
    redeye: { pupil: 30, darken: 50 },
    historybrush: { size: 50, hardness: 0.5, opacity: 1, source: 0 },
    sharpenbrush: { size: 60, hardness: 0.4, strength: 50 },
    dodge: { size: 80, hardness: 0.3, exposure: 30 },
    burn: { size: 80, hardness: 0.3, exposure: 30 },
    sponge: { size: 80, hardness: 0.3, flow: 40, mode: 'desaturate' },
    gradient: { type: 'linear', mode: 'fgbg', opacity: 1 },
    shape: { kind: 'rect', fill: true, stroke: false, width: 8, radius: 0, sides: 5, inner: 50 },
    transform: { mode: 'free' },
    liquify: { size: 120, pressure: 50, mode: 'push' },
  };
  let fg = '#2fd67f', bg = '#000000';
  const view = { zoom: 1, x: 0, y: 0 };
  let showThirds = false;
  const history = { stack: [], index: -1 };
  let crop = null;          // {x,y,w,h} while crop tool active
  let draft = null;         // in-progress selection shape for the overlay
  let antsEdge = null, antsTimer = null, antsOffset = 0;
  let adj = null;           // live adjustment session
  let renderQueued = false;
  let spaceDown = false;
  let sideTab = 'adjust';
  let el = {};
  let altDown = false;
  const DROPPER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 6l4 4M4 20l1.5-4.5L14 7l3 3-8.5 8.5z" stroke="black" stroke-width="3.5"/><path d="M14 6l4 4M4 20l1.5-4.5L14 7l3 3-8.5 8.5z" stroke="white" stroke-width="1.6"/><path d="M15.5 4.5a2.1 2.1 0 013 3L17 9l-3-3z" fill="white" stroke="black"/></svg>')}") 2 21, crosshair`;
  let tf = null;            // live transform session
  let guides = [];          // snapping guide lines shown while dragging
  let snapOn = true;
  let cloneSrc = null, cloneOffset = null, cloneMark = null;
  let clip = null;          // last copied pixels {canvas, x, y}
  let gradDraft = null, shapeDraft = null;

  // ---------- document model ----------
  function newLayer(canvas, name, x = 0, y = 0) {
    return { id: uid('L'), name, canvas, x, y, opacity: 1, blend: 'source-over', visible: true, mask: null, maskOn: true, editMask: false, text: null,
      type: 'pixel', adj: null, fx: null, clip: false, locked: false, rev: 0, dirty: true, maskDirty: true };
  }
  const active = () => doc && doc.layers.find(l => l.id === doc.activeId);
  const markDirty = (l) => { l.dirty = true; l.rev = (l.rev || 0) + 1; };
  const markMask = (l) => { l.maskDirty = true; l.rev = (l.rev || 0) + 1; };
  const deep = o => o == null ? null : JSON.parse(JSON.stringify(o));
  const isAdj = l => l && l.type === 'adjust';
  /** Returns false (and explains) when the active layer can't be painted or moved. */
  function editable(l, { pixelsOnly = false } = {}) {
    if (!l) { toast('Select a layer first.', 'error'); return false; }
    if (l.locked) { toast(`"${l.name}" is locked. Unlock it in the Layers panel to edit it.`, 'error'); return false; }
    if (pixelsOnly && isAdj(l)) { toast('This works on pixel layers. Select a regular layer, or paint on the adjustment layer to mask it.', 'error'); return false; }
    return true;
  }

  function createDoc(w, h, name, firstLayer) {
    commitAdjust();
    tf = null; guides = [];
    doc = { width: w, height: h, layers: [], groups: {}, activeGroup: null, activeId: null, selection: null, name: name || 'Untitled', path: null, dirty: false };
    selIds.clear();
    if (firstLayer) { doc.layers.push(firstLayer); doc.activeId = firstLayer.id; }
    history.stack = []; history.index = -1;
    crop = null; draft = null; setSelection(null);
    el.composite.width = w; el.composite.height = h;
    el.ants.width = w; el.ants.height = h; el.selPaint.width = w; el.selPaint.height = h;
    el.overlay.setAttribute('viewBox', `0 0 ${w} ${h}`);
    el.overlay.setAttribute('width', w); el.overlay.setAttribute('height', h);
    el.world.style.width = w + 'px'; el.world.style.height = h + 'px';
    el.empty.hidden = true;
    fitView();
    pushHistory('Open');
    refreshAll();
  }

  // ---------- history ----------
  function pushHistory(label) {
    if (!doc) return;
    const prev = history.stack[history.index];
    const prevLayers = prev ? new Map(prev.layers.map(s => [s.id, s])) : new Map();
    const state = {
      label, width: doc.width, height: doc.height, activeId: doc.activeId, groups: deep(doc.groups || {}),
      selection: doc.selection ? O.clone(doc.selection) : null,
      layers: doc.layers.map(l => {
        const p = prevLayers.get(l.id);
        const canvas = (!l.dirty && l._snap) ? l._snap : (l._snap = O.clone(l.canvas));
        const mask = l.mask ? ((!l.maskDirty && l._maskSnap) ? l._maskSnap : (l._maskSnap = O.clone(l.mask))) : null;
        l.dirty = false; l.maskDirty = false;
        return { id: l.id, name: l.name, x: l.x, y: l.y, opacity: l.opacity, blend: l.blend, visible: l.visible, maskOn: l.maskOn, text: l.text ? { ...l.text } : null, canvas, mask, _p: p,
          type: l.type || 'pixel', adj: deep(l.adj), fx: deep(l.fx), clip: !!l.clip, locked: !!l.locked, group: l.group || null };
      }),
    };
    state.layers.forEach(s => delete s._p);
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(state);
    if (history.stack.length > 40) history.stack.shift();
    history.index = history.stack.length - 1;
    if (label !== 'Open') { doc.dirty = true; scheduleAutosave(); }
    renderHistory();
  }

  function restore(i) {
    if (!doc || i < 0 || i >= history.stack.length) return;
    commitAdjust(true);
    const s = history.stack[i];
    history.index = i;
    const sizeChanged = s.width !== doc.width || s.height !== doc.height;
    doc.width = s.width; doc.height = s.height; doc.activeId = s.activeId; doc.groups = deep(s.groups || {}); selIds.clear();
    if (doc.activeGroup && !doc.groups[doc.activeGroup]) doc.activeGroup = null;
    doc.layers = s.layers.map(x => ({ group: x.group || null,
      id: x.id, name: x.name, x: x.x, y: x.y, opacity: x.opacity, blend: x.blend, visible: x.visible, maskOn: x.maskOn,
      text: x.text ? { ...x.text } : null, editMask: x.type === 'adjust',
      type: x.type || 'pixel', adj: deep(x.adj), fx: deep(x.fx), clip: !!x.clip, locked: !!x.locked, rev: 0,
      canvas: O.clone(x.canvas), _snap: x.canvas, dirty: false,
      mask: x.mask ? O.clone(x.mask) : null, _maskSnap: x.mask, maskDirty: false,
    }));
    if (sizeChanged) resizeSurfaces();
    crop = null;
    setSelection(s.selection ? O.clone(s.selection) : null);
    refreshAll();
  }
  const undo = () => restore(history.index - 1);
  const redo = () => restore(history.index + 1);

  /** Keep adjustment layers covering the whole document after crops / canvas changes. */
  function normalizeAdjustLayers() {
    for (const l of doc.layers) {
      if (!isAdj(l)) continue;
      if (l.x === 0 && l.y === 0 && l.canvas.width === doc.width && l.canvas.height === doc.height && l.mask && l.mask.width === doc.width && l.mask.height === doc.height) continue;
      const m = O.mk(doc.width, doc.height), mc = O.cx(m);
      mc.fillStyle = '#fff'; mc.fillRect(0, 0, doc.width, doc.height);
      if (l.mask) { mc.clearRect(l.x, l.y, l.mask.width, l.mask.height); mc.drawImage(l.mask, l.x, l.y); }
      l.mask = m; l.canvas = O.mk(doc.width, doc.height); l.x = 0; l.y = 0; markDirty(l); markMask(l);
    }
  }
  function resizeSurfaces() {
    normalizeAdjustLayers();
    const { width: w, height: h } = doc;
    el.composite.width = w; el.composite.height = h; el.ants.width = w; el.ants.height = h; el.selPaint.width = w; el.selPaint.height = h;
    el.overlay.setAttribute('viewBox', `0 0 ${w} ${h}`); el.overlay.setAttribute('width', w); el.overlay.setAttribute('height', h);
    el.world.style.width = w + 'px'; el.world.style.height = h + 'px';
    fitView();
  }

  // ---------- rendering ----------
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }
  function render() {
    if (!doc) return;
    const c = el.composite, ctx = O.cx(c);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, c.width, c.height);
    if (tf) { tf.docW = c.width; tf.docH = c.height; }
    PhotoCompose.renderStack(ctx, doc.layers, { tf, groups: doc.groups });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    renderOverlay();
  }

  function renderOverlay() {
    if (!doc) return;
    const { width: w, height: h } = doc;
    let s = '';
    const thirds = (x, y, ww, hh) => {
      const p = `M${x + ww / 3} ${y}v${hh}M${x + 2 * ww / 3} ${y}v${hh}M${x} ${y + hh / 3}h${ww}M${x} ${y + 2 * hh / 3}h${ww}`;
      return `<path class="thirds-shadow" d="${p}"/><path class="thirds" d="${p}"/>`;
    };
    if (showThirds && !crop) s += thirds(0, 0, w, h);
    if (showGuides && doc.guides) for (const g of doc.guides) s += g.x != null ? `<line class="user-guide" x1="${g.x}" y1="-100000" x2="${g.x}" y2="100000"/>` : `<line class="user-guide" x1="-100000" y1="${g.y}" x2="100000" y2="${g.y}"/>`;
    if (draft) {
      if (draft.type === 'rect') s += `<rect class="sel-draft" x="${draft.x}" y="${draft.y}" width="${draft.w}" height="${draft.h}"/>`;
      if (draft.type === 'ellipse') s += `<ellipse class="sel-draft" cx="${draft.x + draft.w / 2}" cy="${draft.y + draft.h / 2}" rx="${draft.w / 2}" ry="${draft.h / 2}"/>`;
      if (draft.type === 'lasso' && draft.pts.length > 1) s += `<path class="sel-draft" d="M${draft.pts.map(p => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join('L')}Z"/>`;
    }
    if (crop) {
      const { x, y, w: cw, h: ch } = crop;
      s += `<path class="crop-shade" fill-rule="evenodd" d="M0 0H${w}V${h}H0Z M${x} ${y}h${cw}v${ch}h${-cw}Z"/>`;
      s += thirds(x, y, cw, ch);
      s += `<rect class="crop-box" x="${x}" y="${y}" width="${cw}" height="${ch}"/>`;
      const hs = 9 / view.zoom;
      for (const [hx, hy] of [[x, y], [x + cw, y], [x, y + ch], [x + cw, y + ch]]) s += `<rect class="crop-handle" x="${hx - hs / 2}" y="${hy - hs / 2}" width="${hs}" height="${hs}"/>`;
    }
    if (poly) {
      const pts = [...poly.pts, poly.hover];
      s += `<polyline class="sel-draft" fill="none" points="${pts.map(p => p.x + ',' + p.y).join(' ')}"/>`;
      s += `<circle class="tf-handle" cx="${poly.pts[0].x}" cy="${poly.pts[0].y}" r="${4 / view.zoom}"/>`;
    }
    if (pen && pen.pts.length && (tool === 'pen' || pen.closed)) {
      s += `<path class="pen-path" d="${pathD(pen)}"/>`;
      if (tool === 'pen') for (const a of pen.pts) {
        for (const k of ['hin', 'hout']) if (a[k]) s += `<line class="pen-handle-line" x1="${a.x}" y1="${a.y}" x2="${a[k].x}" y2="${a[k].y}"/><circle class="pen-handle" cx="${a[k].x}" cy="${a[k].y}" r="${3 / view.zoom}"/>`;
        const hs = 6 / view.zoom; s += `<rect class="pen-anchor" x="${a.x - hs / 2}" y="${a.y - hs / 2}" width="${hs}" height="${hs}"/>`;
      }
    }
    for (const g of guides) s += g.x != null ? `<line class="guide${g.smart ? ' smart' : ''}" x1="${g.x}" y1="0" x2="${g.x}" y2="${h}"/>` : `<line class="guide${g.smart ? ' smart' : ''}" x1="0" y1="${g.y}" x2="${w}" y2="${g.y}"/>`;
    if (tf && tf.quad) {
      const q = tf.quad, hs = 8 / view.zoom;
      s += `<polygon class="tf-box" points="${q.map(p => p.x + ',' + p.y).join(' ')}"/>`;
      for (const p of q) s += `<rect class="tf-handle" x="${p.x - hs / 2}" y="${p.y - hs / 2}" width="${hs}" height="${hs}"/>`;
      for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; s += `<rect class="tf-handle edge" x="${(a.x + b.x) / 2 - hs * 0.35}" y="${(a.y + b.y) / 2 - hs * 0.35}" width="${hs * 0.7}" height="${hs * 0.7}"/>`; }
    } else if (tf) {
      const cs = tfCorners(), hs = 8 / view.zoom, top = tfPoint(0, -1), rh = tfRotHandle();
      s += `<polygon class="tf-box" points="${cs.map(p => p.x + ',' + p.y).join(' ')}"/>`;
      s += `<line class="tf-box" x1="${top.x}" y1="${top.y}" x2="${rh.x}" y2="${rh.y}"/><circle class="tf-handle" cx="${rh.x}" cy="${rh.y}" r="${hs * 0.62}"/>`;
      for (const [a, b] of TF_HANDLES) { const q = tfPoint(a, b); s += `<rect class="tf-handle" x="${q.x - hs / 2}" y="${q.y - hs / 2}" width="${hs}" height="${hs}"/>`; }
      s += `<circle class="tf-center" cx="${tf.cx}" cy="${tf.cy}" r="${3 / view.zoom}"/>`;
    }
    if (gradDraft) s += `<line class="grad-line" x1="${gradDraft.x0}" y1="${gradDraft.y0}" x2="${gradDraft.x1}" y2="${gradDraft.y1}"/><circle class="tf-handle" cx="${gradDraft.x0}" cy="${gradDraft.y0}" r="${4 / view.zoom}"/><circle class="tf-handle" cx="${gradDraft.x1}" cy="${gradDraft.y1}" r="${4 / view.zoom}"/>`;
    if (shapeDraft) {
      const d = shapeDraft, o = T.shape, x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), sw = Math.abs(d.x1 - d.x0), sh = Math.abs(d.y1 - d.y0);
      const paint = `fill="${o.fill ? fg : 'none'}" stroke="${o.stroke ? bg : 'none'}" stroke-width="${o.width}" opacity=".85"`;
      if (d.kind === 'rect') s += `<rect x="${x}" y="${y}" width="${sw}" height="${sh}" rx="${Math.min(o.radius, sw / 2, sh / 2)}" ${paint}/>`;
      else if (d.kind === 'ellipse') s += `<ellipse cx="${x + sw / 2}" cy="${y + sh / 2}" rx="${sw / 2}" ry="${sh / 2}" ${paint}/>`;
      else if (['polygon', 'star', 'triangle'].includes(d.kind)) s += `<polygon points="${polyPoints(d).map(q => q.join(',')).join(' ')}" ${paint}/>`;
      else s += `<line x1="${d.x0}" y1="${d.y0}" x2="${d.x1}" y2="${d.y1}" stroke="${fg}" stroke-width="${o.width}" stroke-linecap="round" opacity=".85"/>`;
    }
    if (patchDraft && doc.selection && antsEdge) s += `<image href="${patchOutline()}" x="${patchDraft.dx}" y="${patchDraft.dy}" width="${doc.width}" height="${doc.height}" opacity=".9"/>`;
    if (doc.samplers && (tool === 'sampler' || tool === 'dropper')) doc.samplers.forEach((sp, i) => { const r = 6 / view.zoom; s += `<g class="sampler"><circle cx="${sp.x}" cy="${sp.y}" r="${r}"/><path d="M${sp.x - r * 1.8} ${sp.y}h${r * 3.6}M${sp.x} ${sp.y - r * 1.8}v${r * 3.6}"/><text x="${sp.x + r * 1.4}" y="${sp.y - r * 1.2}" font-size="${12 / view.zoom}">${i + 1}</text></g>`; });
    if (ruler && tool === 'ruler') s += `<line class="ruler-line" x1="${ruler.x0}" y1="${ruler.y0}" x2="${ruler.x1}" y2="${ruler.y1}"/><circle class="tf-handle" cx="${ruler.x0}" cy="${ruler.y0}" r="${3 / view.zoom}"/><circle class="tf-handle" cx="${ruler.x1}" cy="${ruler.y1}" r="${3 / view.zoom}"/>`;
    if (pcrop && tool === 'perspcrop') {
      s += `<polygon class="tf-box" points="${pcrop.map(p => p.x + ',' + p.y).join(' ')}"/>`;
      for (let k = 1; k < 3; k++) { const at = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); const t = k / 3, p1 = at(pcrop[0], pcrop[1], t), p2 = at(pcrop[3], pcrop[2], t), p3 = at(pcrop[0], pcrop[3], t), p4 = at(pcrop[1], pcrop[2], t); s += `<line class="thirds" x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}"/><line class="thirds" x1="${p3.x}" y1="${p3.y}" x2="${p4.x}" y2="${p4.y}"/>`; }
      const hs = 9 / view.zoom; for (const p of pcrop) s += `<rect class="tf-handle" x="${p.x - hs / 2}" y="${p.y - hs / 2}" width="${hs}" height="${hs}"/>`;
    }
    if ((tool === 'clone' || tool === 'healbrush') && (cloneMark || cloneSrc)) {
      const m = cloneMark || cloneSrc, r = Math.max(6 / view.zoom, T[tool].size / 2);
      s += `<circle class="clone-src" cx="${m.x}" cy="${m.y}" r="${r}"/><path class="clone-src" d="M${m.x - r * 0.4} ${m.y}h${r * 0.8}M${m.x} ${m.y - r * 0.4}v${r * 0.8}"/>`;
    }
    const a = active();
    if (a && a.text && tool === 'text') s += `<rect class="text-box" x="${a.x}" y="${a.y}" width="${a.canvas.width}" height="${a.canvas.height}"/>`;
    el.overlay.innerHTML = s;
  }

  // ---------- selection ----------
  function setSelection(c) {
    if (!doc) return;
    doc.selection = c;
    antsEdge = c ? O.edges(c, Math.max(1, Math.round(1.2 / Math.min(1, view.zoom)))) : null;
    if (c && !antsEdge) { doc.selection = null; } // empty selection
    clearInterval(antsTimer);
    const actx = O.cx(el.ants); actx.clearRect(0, 0, el.ants.width, el.ants.height);
    if (antsEdge) { drawAnts(); antsTimer = setInterval(drawAnts, 140); }
    updateStatus();
  }
  let stripe = null;
  function drawAnts() {
    if (!antsEdge) return;
    if (!stripe) {
      stripe = O.mk(8, 8); const sc = O.cx(stripe);
      sc.fillStyle = '#000'; sc.fillRect(0, 0, 8, 8); sc.strokeStyle = '#fff'; sc.lineWidth = 2.5;
      sc.beginPath(); sc.moveTo(-2, 10); sc.lineTo(10, -2); sc.moveTo(-2, 2); sc.lineTo(2, -2); sc.moveTo(6, 10); sc.lineTo(10, 6); sc.stroke();
    }
    antsOffset = (antsOffset + 1) % 8;
    const ctx = O.cx(el.ants), w = el.ants.width, h = el.ants.height;
    ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, w, h);
    ctx.drawImage(antsEdge, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    const pat = ctx.createPattern(stripe, 'repeat');
    pat.setTransform(new DOMMatrix().translate(antsOffset, 0));
    ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  function combineSelection(shape, mode) {
    const feather = T.select.feather;
    if (feather > 0) shape = O.cssFilter(shape, `blur(${feather}px)`, false);
    let out;
    if (mode === 'new' || !doc.selection) {
      if (mode === 'sub') return; // nothing to subtract from
      if (mode === 'int' && !doc.selection) return;
      out = shape;
    } else {
      out = O.clone(doc.selection);
      const c = O.cx(out);
      c.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'sub' ? 'destination-out' : 'destination-in';
      c.drawImage(shape, 0, 0);
    }
    setSelection(out);
    pushHistory(mode === 'new' ? 'Select' : mode === 'add' ? 'Add to selection' : mode === 'sub' ? 'Subtract from selection' : 'Intersect selection');
  }
  function shapeCanvas(drawFn) {
    const c = O.mk(doc.width, doc.height), ctx = O.cx(c);
    ctx.fillStyle = '#fff'; ctx.beginPath(); drawFn(ctx); ctx.fill();
    return c;
  }
  function selectAll() { if (!doc) return; setSelection(shapeCanvas(c => c.rect(0, 0, doc.width, doc.height))); pushHistory('Select all'); }
  function deselect() { if (!doc || !doc.selection) return; doc.lastSelection = O.clone(doc.selection); setSelection(null); pushHistory('Deselect'); }
  function invertSelection() {
    if (!doc) return;
    const c = shapeCanvas(x => x.rect(0, 0, doc.width, doc.height));
    if (doc.selection) { const ctx = O.cx(c); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(doc.selection, 0, 0); }
    setSelection(c); pushHistory('Invert selection');
  }
  function selModeFrom(e) {
    if (e.shiftKey && e.altKey) return 'int';
    if (e.shiftKey) return 'add';
    if (e.altKey) return 'sub';
    return T.select.mode;
  }

  // ---------- view ----------
  function applyView() {
    el.world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    el.world.classList.toggle('pixelated', view.zoom >= 2);
    updateStatus();
    renderOverlay();
    updateCursor();
    drawRulers();
  }
  function fitView() {
    if (!doc) return;
    const r = el.stage.getBoundingClientRect();
    const z = Math.min((r.width - 60) / doc.width, (r.height - 60) / doc.height, 4);
    view.zoom = Math.max(0.02, z || 1);
    view.x = (r.width - doc.width * view.zoom) / 2; view.y = (r.height - doc.height * view.zoom) / 2;
    view.userMoved = false;
    applyView();
    if (doc.selection) refreshAnts();
  }
  function zoomTo(z, cxp, cyp) {
    const r = el.stage.getBoundingClientRect();
    if (cxp == null) { cxp = r.width / 2; cyp = r.height / 2; }
    z = clamp(z, 0.02, 32);
    const dx = (cxp - view.x) / view.zoom, dy = (cyp - view.y) / view.zoom;
    view.zoom = z; view.x = cxp - dx * z; view.y = cyp - dy * z;
    view.userMoved = true;
    applyView();
    if (doc && doc.selection) refreshAnts();
  }
  let antsDebounce = null;
  function refreshAnts() { clearTimeout(antsDebounce); antsDebounce = setTimeout(() => doc && doc.selection && setSelection(doc.selection), 180); }
  function docPoint(e) {
    const r = el.stage.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.zoom, y: (e.clientY - r.top - view.y) / view.zoom };
  }

  // ---------- painting ----------
  function targetOf(l) { return (l.editMask || isAdj(l)) && l.mask ? l.mask : l.canvas; }

  function beginStroke(p, e) {
    const l = active();
    if (!l) return toast('Add or select a layer first.', 'error');
    if (!editable(l)) return;
    if (!l.visible) return toast('This layer is hidden. Show it to paint on it.', 'error');
    commitAdjust();
    const onMask = (l.editMask || isAdj(l)) && l.mask;
    if (isAdj(l) && ['blur', 'clone', 'smudge', 'heal', 'healbrush', 'dodge', 'burn', 'sponge', 'colorreplace', 'bgeraser', 'historybrush', 'sharpenbrush'].includes(tool)) return toast('Use the brush or eraser to paint an adjustment layer\'s mask.', 'error');
    if (l.text && !onMask) l.text = null; // painting turns text into pixels
    const target = targetOf(l);
    const o = tool === 'blur' ? T.blur : T[tool];
    let offset = null;
    if (tool === 'clone' || tool === 'healbrush') {
      if (!cloneSrc) { toast(`Alt-click (Option-click on Mac) to choose where to ${tool === 'clone' ? 'clone' : 'sample'} from.`, 'error'); return; }
      if (!T.clone.aligned || !cloneOffset) cloneOffset = { x: cloneSrc.x - p.x, y: cloneSrc.y - p.y };
      offset = cloneOffset;
    }
    const st = {
      l, target, onMask, snap: O.clone(target),
      stroke: O.mk(target.width, target.height),
      sel: O.selIn(doc.selection, target.width, target.height, l.x, l.y),
      last: null, size: o.size, pending: false, offset,
    };
    if (['dodge', 'burn', 'sponge'].includes(tool)) st.effect = retouchEffect(st.snap, e && e.altKey);
    if (tool === 'sharpenbrush') {
      const id0 = O.cx(st.snap).getImageData(0, 0, st.snap.width, st.snap.height);
      const r = PhotoFilters.run('unsharp', { width: id0.width, height: id0.height, data: id0.data }, { amount: 40 + T.sharpenbrush.strength * 2.6, radius: 1.2, threshold: 2 });
      st.effect = O.mk(r.width, r.height); O.cx(st.effect).putImageData(new ImageData(r.data, r.width, r.height), 0, 0);
    }
    if (tool === 'historybrush') {
      const snap = history.stack[clamp(T.historybrush.source, 0, history.stack.length - 1)], sl = snap && snap.layers.find(x => x.id === l.id);
      if (!sl) { toast('This layer didn\'t exist in the chosen history state. Pick a later state in the options bar.', 'error'); return; }
      st.effect = O.mk(target.width, target.height); O.cx(st.effect).drawImage(sl.canvas, sl.x - l.x, sl.y - l.y);
      st.replace = true;
    }
    if (tool === 'colorreplace') {
      const sx = clamp(Math.round(p.x - l.x), 0, target.width - 1), sy = clamp(Math.round(p.y - l.y), 0, target.height - 1);
      const sd = O.cx(st.snap).getImageData(0, 0, target.width, target.height), d = sd.data, k = (sy * target.width + sx) * 4, s0 = [d[k], d[k + 1], d[k + 2]], tol = T.colorreplace.tolerance / 100 * 255;
      const rec = O.clone(st.snap), rc = O.cx(rec); rc.globalCompositeOperation = T.colorreplace.mode; rc.fillStyle = fg; rc.fillRect(0, 0, rec.width, rec.height);
      const rd = rc.getImageData(0, 0, rec.width, rec.height), q = rd.data;
      for (let i = 0; i < d.length; i += 4) { const dist = Math.max(Math.abs(d[i] - s0[0]), Math.abs(d[i + 1] - s0[1]), Math.abs(d[i + 2] - s0[2])), m = clamp((tol - dist) / Math.max(1, tol * 0.25), 0, 1); for (let c = 0; c < 3; c++) q[i + c] = d[i + c] + (q[i + c] - d[i + c]) * m; q[i + 3] = d[i + 3]; }
      rc.globalCompositeOperation = 'source-over'; rc.putImageData(rd, 0, 0); st.effect = rec;
    }
    if (tool === 'bgeraser') { st.snapData = O.cx(st.snap).getImageData(0, 0, target.width, target.height).data; st.erase = new Uint8Array(target.width * target.height); if (st.sel) st.selData = O.cx(st.sel).getImageData(0, 0, target.width, target.height).data; }
    if (tool === 'heal') { const sp = el.selPaint; O.cx(sp).clearRect(0, 0, sp.width, sp.height); sp.hidden = false; st.healPreview = O.stamp(o.size, o.hardness, '#ff5fd2'); }
    if (tool === 'smudge') st.blurStamp = O.stamp(o.size, 0.5, '#000000');
    if (tool !== 'blur' && tool !== 'smudge') {
      // On a mask: light colours reveal, dark colours hide. Eraser on a mask hides.
      let color = fg;
      if (onMask || ['clone', 'heal', 'healbrush', 'dodge', 'burn', 'sponge', 'colorreplace', 'historybrush', 'sharpenbrush', 'bgeraser'].includes(tool)) color = '#000000';
      st.reveal = onMask ? ((tool === 'brush' || tool === 'pencil') && luminance(fg) > 0.5) : null;
      st.dab = O.stamp(o.size, tool === 'pencil' ? 1 : (o.hardness ?? 1), color);
    } else {
      st.blurStamp = O.stamp(o.size, 0.3, '#000000');
    }
    dabTo(st, p.x - l.x, p.y - l.y);
    return st;
  }
  function dabTo(st, x, y) {
    const r = st.size / 2;
    const spacing = Math.max(1, st.size * (tool === 'blur' ? 0.3 : tool === 'smudge' ? 0.08 : 0.12));
    const pts = [];
    if (!st.last) pts.push([x, y]);
    else {
      const dx = x - st.last[0], dy = y - st.last[1], d = Math.hypot(dx, dy);
      if (d < spacing) return;
      for (let t = spacing; t <= d; t += spacing) pts.push([st.last[0] + dx * t / d, st.last[1] + dy * t / d]);
    }
    if (!pts.length) return;
    st.last = pts[pts.length - 1];
    if (tool === 'smudge') {
      for (const [px, py] of pts) smudgeDab(st, px, py);
      markDirty(st.l); requestRender();
      return;
    }
    if (tool === 'heal') {
      const sc = O.cx(st.stroke), pc = O.cx(el.selPaint);
      for (const [px, py] of pts) { sc.drawImage(st.dab, px - r, py - r); pc.drawImage(st.healPreview, px - r + st.l.x, py - r + st.l.y); }
      return;
    }
    if (tool === 'bgeraser') {
      for (const [px, py] of pts) bgEraseDab(st, px, py);
      if (!st.pending) { st.pending = true; requestAnimationFrame(() => { st.pending = false; composeBgErase(st); }); }
      return;
    }
    if (tool === 'blur') {
      for (const [px, py] of pts) blurDab(st, px, py);
      O.cx(st.target); markDirty(st.l); requestRender();
      return;
    }
    const sc = O.cx(st.stroke);
    // pen pressure: size and/or flow follow the stylus (Brush and Eraser options)
    const pr = st.pressure ?? 1, pm = (T[tool] && T[tool].pressure) || 'off';
    const k = pm === 'size' || pm === 'both' ? Math.max(0.08, pr) : 1, fa = pm === 'opacity' || pm === 'both' ? pr : 1;
    sc.globalAlpha = (tool === 'brush' ? (T.brush.flow ?? 1) : 1) * fa;
    if (k === 1) for (const [px, py] of pts) sc.drawImage(st.dab, px - r, py - r);
    else for (const [px, py] of pts) sc.drawImage(st.dab, px - r * k, py - r * k, st.size * k, st.size * k);
    sc.globalAlpha = 1;
    if (!st.pending) { st.pending = true; requestAnimationFrame(() => { st.pending = false; composeStroke(st); }); }
  }
  function composeStroke(st) {
    const tc = O.cx(st.target);
    let stroke = st.stroke;
    if (st.sel) { stroke = O.clone(st.stroke); const s = O.cx(stroke); s.globalCompositeOperation = 'destination-in'; s.drawImage(st.sel, 0, 0); }
    tc.globalCompositeOperation = 'copy'; tc.globalAlpha = 1; tc.drawImage(st.snap, 0, 0);
    const o = T[tool];
    if (st.effect) {
      const src = O.clone(st.effect), sc = O.cx(src);
      sc.globalCompositeOperation = 'destination-in'; sc.drawImage(stroke, 0, 0);
      tc.globalCompositeOperation = 'source-atop'; tc.drawImage(src, 0, 0); tc.globalCompositeOperation = 'source-over';
      markDirty(st.l); requestRender();
      return;
    }
    if (st.replace) {
      // history brush: reveal the old state, including transparency
      const src = O.clone(st.effect), sc = O.cx(src); sc.globalCompositeOperation = 'destination-in'; sc.drawImage(stroke, 0, 0);
      tc.globalAlpha = o.opacity ?? 1; tc.globalCompositeOperation = 'destination-out'; tc.drawImage(stroke, 0, 0);
      tc.globalCompositeOperation = 'source-over'; tc.drawImage(src, 0, 0); tc.globalAlpha = 1;
      markDirty(st.l); requestRender(); return;
    }
    if (tool === 'clone' || tool === 'healbrush') {
      const src = O.mk(st.target.width, st.target.height), sc = O.cx(src);
      sc.drawImage(st.snap, -st.offset.x, -st.offset.y);
      sc.globalCompositeOperation = 'destination-in'; sc.drawImage(stroke, 0, 0);
      tc.globalCompositeOperation = 'source-over'; tc.globalAlpha = o.opacity ?? 1; tc.drawImage(src, 0, 0); tc.globalAlpha = 1;
      if (st.onMask) markMask(st.l); else markDirty(st.l);
      requestRender();
      return;
    }
    tc.globalAlpha = o.opacity ?? 1;
    const erase = tool === 'eraser' || (st.onMask && !st.reveal);
    tc.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    tc.drawImage(stroke, 0, 0);
    tc.globalAlpha = 1; tc.globalCompositeOperation = 'source-over';
    if (st.onMask) markMask(st.l); else markDirty(st.l);
    requestRender();
  }
  function blurDab(st, x, y) {
    const s = st.size, r = s / 2, pad = Math.ceil(T.blur.strength * 3);
    const sx = Math.round(x - r - pad), sy = Math.round(y - r - pad), sw = Math.ceil(s + pad * 2);
    const region = O.mk(sw, sw), rc = O.cx(region);
    rc.filter = `blur(${T.blur.strength}px)`; rc.drawImage(st.target, -sx, -sy); rc.filter = 'none';
    rc.globalCompositeOperation = 'destination-in';
    rc.drawImage(st.blurStamp, x - r - sx, y - r - sy);
    if (st.sel) rc.drawImage(st.sel, -sx, -sy);
    const tc = O.cx(st.target);
    tc.globalAlpha = 0.6; tc.drawImage(region, sx, sy); tc.globalAlpha = 1;
  }
  function endStroke(st) {
    if (!st) return;
    if (tool === 'heal') {
      const sp = el.selPaint;
      const hole = O.clone(st.stroke);
      if (st.sel) { const hc = O.cx(hole); hc.globalCompositeOperation = 'destination-in'; hc.drawImage(st.sel, 0, 0); }
      el.stage.classList.add('busy');
      const done = ok => {
        O.cx(sp).clearRect(0, 0, sp.width, sp.height); sp.hidden = true; el.stage.classList.remove('busy');
        if (!ok) return toast('Couldn\'t find matching texture nearby — try a smaller spot or use the clone stamp.', 'error');
        markDirty(st.l); requestRender(); pushHistory('Spot healing'); renderLayers();
      };
      const mode = T.heal.mode || 'content';
      if (mode === 'content') inpaintInto(st.target, hole, { margin: Math.max(24, Math.round(T.heal.size * 1.6)) }).then(done, () => done(healRegion(st.target, st.stroke, st.sel)));
      else done(healRegion(st.target, st.stroke, st.sel));
      return;
    }
    if (tool === 'smudge') { pushHistory('Smudge'); renderLayers(); return; }
    if (tool === 'bgeraser') { composeBgErase(st); pushHistory('Background eraser'); renderLayers(); return; }
    if (tool === 'healbrush') { finishHealBrush(st); markDirty(st.l); requestRender(); pushHistory('Healing brush'); renderLayers(); return; }
    if (tool !== 'blur') composeStroke(st);
    pushHistory({ brush: st.onMask ? 'Paint mask' : 'Brush', pencil: 'Pencil', eraser: 'Erase', clone: 'Clone stamp', dodge: 'Dodge', burn: 'Burn', sponge: 'Sponge', colorreplace: 'Color replacement', historybrush: 'History brush', sharpenbrush: 'Sharpen' }[tool] || 'Blur brush');
    renderLayers();
  }
  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
  }

  // ---------- tools: pointer handling ----------
  function stagePointerDown(e) {
    if (!doc) return;
    if (e.button === 1 || spaceDown || tool === 'hand') return startPan(e);
    // Brush size gesture: Alt + right-drag (Windows) / Ctrl + Option + drag (Mac)
    if (PAINT_TOOLS.includes(tool) && ((e.button === 2 && e.altKey) || (e.button === 0 && e.ctrlKey && e.altKey && ro3.platform === 'darwin'))) { e.preventDefault(); return brushResizeGesture(e); }
    if (e.button !== 0) return;
    if (canvasPick) { canvasPick(docPoint(e)); return; }
    if (e.altKey && ALT_PICK_TOOLS.includes(tool)) return altPick(docPoint(e), e);
    if ((tool === 'move' || e.ctrlKey || e.metaKey) && !tf) { const gi = guideNear(e); if (gi >= 0) return dragGuide(e, gi); }
    const p = docPoint(e);
    const handlers = {
      move: startMove, transform: transformDown, rect: startShapeSel, ellipse: startShapeSel, lasso: startLasso, wand: wandAt, crop: startCrop,
      selbrush: startSelBrush, quick: startQuickSelect, polylasso: polyClick, pen: penDown, brush: startPaint, eraser: startPaint, blur: startPaint, clone: startPaint,
      heal: startPaint, healbrush: startPaint, pencil: startPaint, colorreplace: startPaint, bgeraser: startPaint, historybrush: startPaint, sharpenbrush: startPaint,
      patch: startPatch, camove: startContentMove, redeye: redEyeAt, magiceraser: magicEraseAt, sampler: samplerClick, ruler: startRuler, perspcrop: startPerspCrop,
      smudge: startPaint, liquify: startLiquify, dodge: startPaint, burn: startPaint, sponge: startPaint, gradient: startGradient, shape: startShape,
      fill: fillAt, dropper: pickColor, text: textAt, zoom: zoomClick,
    };
    const fn = handlers[tool];
    if (fn) fn(p, e);
  }
  function track(e, move, up) {
    e.preventDefault();
    try { el.stage.setPointerCapture(e.pointerId); } catch (_) {}
    const mv = ev => move(ev);
    const done = ev => {
      el.stage.removeEventListener('pointermove', mv); el.stage.removeEventListener('pointerup', done); el.stage.removeEventListener('pointercancel', done);
      up && up(ev);
    };
    el.stage.addEventListener('pointermove', mv); el.stage.addEventListener('pointerup', done); el.stage.addEventListener('pointercancel', done);
  }
  function startPan(e) {
    const sx = e.clientX, sy = e.clientY, vx = view.x, vy = view.y;
    el.stage.style.cursor = 'grabbing';
    track(e, ev => { view.x = vx + ev.clientX - sx; view.y = vy + ev.clientY - sy; view.userMoved = true; applyView(); }, () => updateCursor());
  }
  function startMove(p, e) {
    let l = active();
    if (!l) return;
    if (!editable(l)) return;
    if (isAdj(l)) return toast('Adjustment layers cover the whole image and can\'t be moved.', 'info');
    commitAdjust();
    // Dragging inside a selection moves just the selected pixels.
    if (doc.selection && !e.altKey) {
      const px = Math.floor(p.x), py = Math.floor(p.y);
      if (px >= 0 && py >= 0 && px < doc.width && py < doc.height && O.cx(doc.selection).getImageData(px, py, 1, 1).data[3] > 0) {
        if (startTransform()) tfMoveDrag(p, e, () => finishTransform(true, 'Move selection'));
        return;
      }
    }
    if (e.altKey) { duplicateLayer(); l = active(); }
    const movers = (doc.activeGroup ? groupMembers(doc.activeGroup) : selectedLayers()).filter(x => !isAdj(x) && !x.locked);
    if (!movers.includes(l)) movers.push(l);
    const start = movers.map(x => ({ l: x, x: x.x, y: x.y }));
    const boxes = movers.map(layerBox).filter(Boolean);
    const cb = boxes.length ? (() => { const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y)); return { x: x0, y: y0, w: Math.max(...boxes.map(b => b.x + b.w)) - x0, h: Math.max(...boxes.map(b => b.y + b.h)) - y0 }; })() : { x: l.x, y: l.y, w: l.canvas.width, h: l.canvas.height };
    const smart = smartTargets(movers);
    let moved = false;
    track(e, ev => {
      const q = docPoint(ev);
      let dx = q.x - p.x, dy = q.y - p.y;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const sn = (ev.ctrlKey || ev.metaKey) ? { dx: 0, dy: 0, lines: [] } : snapBox({ x: cb.x + dx, y: cb.y + dy, w: cb.w, h: cb.h }, smart);
      for (const s of start) { s.l.x = Math.round(s.x + dx + sn.dx); s.l.y = Math.round(s.y + dy + sn.dy); }
      moved = true;
      guides = sn.lines; requestRender(); renderOverlay();
    }, () => { guides = []; renderOverlay(); if (moved) pushHistory(e.altKey ? 'Duplicate and move' : movers.length > 1 ? 'Move layers' : 'Move layer'); });
  }
  function startShapeSel(p, e) {
    const mode = selModeFrom(e);
    const type = tool;
    draft = { type, x: p.x, y: p.y, w: 0, h: 0 };
    track(e, ev => {
      const q = docPoint(ev);
      let w = q.x - p.x, h = q.y - p.y;
      if (ev.shiftKey && mode === 'new') { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
      draft = { type, x: Math.min(p.x, p.x + w), y: Math.min(p.y, p.y + h), w: Math.abs(w), h: Math.abs(h) };
      renderOverlay();
    }, () => {
      const d = draft; draft = null; renderOverlay();
      if (!d || d.w < 2 || d.h < 2) { if (mode === 'new' && doc.selection) deselect(); return; }
      combineSelection(shapeCanvas(c => type === 'rect' ? c.rect(d.x, d.y, d.w, d.h) : c.ellipse(d.x + d.w / 2, d.y + d.h / 2, d.w / 2, d.h / 2, 0, 0, Math.PI * 2)), mode);
    });
  }
  function startLasso(p, e) {
    const mode = selModeFrom(e);
    draft = { type: 'lasso', pts: [p] };
    track(e, ev => {
      const q = docPoint(ev); const last = draft.pts[draft.pts.length - 1];
      if (Math.hypot(q.x - last.x, q.y - last.y) * view.zoom > 2) { draft.pts.push(q); renderOverlay(); }
    }, () => {
      const pts = draft.pts; draft = null; renderOverlay();
      if (pts.length < 3) { if (mode === 'new' && doc.selection) deselect(); return; }
      combineSelection(shapeCanvas(c => { c.moveTo(pts[0].x, pts[0].y); pts.forEach(q => c.lineTo(q.x, q.y)); c.closePath(); }), mode);
    });
  }
  function wandAt(p, e) {
    const l = active();
    const mode = selModeFrom(e);
    let src, ox = 0, oy = 0;
    if (T.wand.sampleAll || !l) { src = el.composite; }
    else { src = l.canvas; ox = l.x; oy = l.y; }
    const m = O.region(src, p.x - ox, p.y - oy, T.wand.tolerance, T.wand.contiguous);
    const regionCanvas = O.maskToCanvas(m, src.width, src.height);
    const shape = O.mk(doc.width, doc.height); O.cx(shape).drawImage(regionCanvas, ox, oy);
    combineSelection(shape, mode);
  }
  function startPaint(p, e) {
    if ((tool === 'clone' || tool === 'healbrush') && e.altKey) {
      cloneSrc = { x: p.x, y: p.y }; cloneOffset = null; renderOverlay(); renderOptions();
      toast('Clone source set. Now paint where you want the copy.', 'info', 2200);
      return;
    }
    const st = beginStroke(p, e);
    if (!st) return;
    const smooth = tool === 'brush' || tool === 'eraser' ? (T[tool].smoothing || 0) / 100 : 0;
    let sm = { x: p.x, y: p.y };
    track(e, ev => {
      const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
      for (const ce of evs) {
        let q = docPoint(ce);
        if (smooth) { sm = { x: sm.x + (q.x - sm.x) * (1 - smooth * 0.92), y: sm.y + (q.y - sm.y) * (1 - smooth * 0.92) }; q = sm; }
        st.pressure = ce.pointerType === 'pen' && ce.pressure > 0 ? ce.pressure : 1;
        dabTo(st, q.x - st.l.x, q.y - st.l.y);
      }
      if (st.offset) { const q = docPoint(ev); cloneMark = { x: q.x + st.offset.x, y: q.y + st.offset.y }; renderOverlay(); }
      moveCursor(ev);
    }, () => { cloneMark = null; endStroke(st); renderOverlay(); });
  }
  function fillAt(p) {
    const l = active();
    if (!editable(l)) return;
    commitAdjust();
    const onMask = (l.editMask || isAdj(l)) && l.mask;
    const target = targetOf(l);
    if (!onMask && l.text) l.text = null;
    const lx = p.x - l.x, ly = p.y - l.y;
    let region;
    if (doc.selection && !(lx >= 0 && ly >= 0 && lx < target.width && ly < target.height && O.cx(doc.selection).getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data[3] > 0)) return;
    if (onMask) region = O.mk(target.width, target.height), O.cx(region).fillRect(0, 0, target.width, target.height);
    else region = O.maskToCanvas(O.region(target, lx, ly, T.fill.tolerance, T.fill.contiguous), target.width, target.height);
    const sel = O.selIn(doc.selection, target.width, target.height, l.x, l.y);
    const rc = O.cx(region);
    if (sel) { rc.globalCompositeOperation = 'destination-in'; rc.drawImage(sel, 0, 0); }
    rc.globalCompositeOperation = 'source-in'; rc.fillStyle = onMask ? '#000' : fg; rc.fillRect(0, 0, region.width, region.height);
    const tc = O.cx(target);
    tc.globalCompositeOperation = onMask && luminance(fg) <= 0.5 ? 'destination-out' : 'source-over';
    tc.drawImage(region, 0, 0); tc.globalCompositeOperation = 'source-over';
    if (onMask) markMask(l); else markDirty(l);
    requestRender(); pushHistory('Fill'); renderLayers();
  }
  function pickColor(p, e) {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
    const d = O.cx(el.composite).getImageData(x, y, 1, 1).data;
    const hex = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    if (e.altKey) bg = hex; else { fg = hex; addRecentColor(hex); }
    syncColors();
  }
  function zoomClick(p, e) {
    const r = el.stage.getBoundingClientRect();
    zoomTo(view.zoom * (e.altKey ? 1 / 1.6 : 1.6), e.clientX - r.left, e.clientY - r.top);
  }

  // ----- crop -----
  function cropRatio() {
    const r = T.crop.ratio;
    if (r === 'free') return 0;
    if (r === 'orig') return doc.width / doc.height;
    const [a, b] = r.split(':').map(Number); return a / b;
  }
  function startCrop(p, e) {
    const hs = 12 / view.zoom;
    if (crop) {
      const corners = { nw: [crop.x, crop.y], ne: [crop.x + crop.w, crop.y], sw: [crop.x, crop.y + crop.h], se: [crop.x + crop.w, crop.y + crop.h] };
      const hit = Object.entries(corners).find(([, [x, y]]) => Math.abs(p.x - x) < hs && Math.abs(p.y - y) < hs);
      if (hit) {
        const k = hit[0]; const fx = k.includes('w') ? crop.x + crop.w : crop.x; const fy = k.includes('n') ? crop.y + crop.h : crop.y;
        return dragCropFrom(fx, fy, e);
      }
      if (p.x > crop.x && p.x < crop.x + crop.w && p.y > crop.y && p.y < crop.y + crop.h) {
        const c0 = { ...crop };
        return track(e, ev => {
          const q = docPoint(ev);
          crop.x = Math.round(clamp(c0.x + q.x - p.x, 0, doc.width - c0.w)); crop.y = Math.round(clamp(c0.y + q.y - p.y, 0, doc.height - c0.h));
          renderOverlay();
        });
      }
    }
    dragCropFrom(p.x, p.y, e);
  }
  function dragCropFrom(fx, fy, e) {
    const ratio = cropRatio();
    track(e, ev => {
      const q = docPoint(ev);
      let w = q.x - fx, h = q.y - fy;
      if (ratio) { if (Math.abs(w) / ratio > Math.abs(h)) h = Math.sign(h || 1) * Math.abs(w) / ratio; else w = Math.sign(w || 1) * Math.abs(h) * ratio; }
      let x = Math.min(fx, fx + w), y = Math.min(fy, fy + h);
      w = Math.abs(w); h = Math.abs(h);
      x = clamp(x, 0, doc.width); y = clamp(y, 0, doc.height);
      w = Math.min(w, doc.width - x); h = Math.min(h, doc.height - y);
      crop = { x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
      renderOverlay(); renderOptions();
    }, () => { if (crop && (crop.w < 4 || crop.h < 4)) crop = null; renderOverlay(); renderOptions(); });
  }
  function applyCrop() {
    if (!crop || !doc) return;
    const { x, y, w, h } = crop;
    doc.layers.forEach(l => { l.x -= x; l.y -= y; });
    if (doc.selection) { const s = O.mk(w, h); O.cx(s).drawImage(doc.selection, -x, -y); doc.selection = s; }
    doc.width = w; doc.height = h;
    crop = null;
    resizeSurfaces(); setSelection(doc.selection);
    pushHistory('Crop'); refreshAll();
  }

  // ----- text -----
  function textAt(p) {
    const l = active();
    if (l && l.text && p.x >= l.x && p.y >= l.y && p.x <= l.x + l.canvas.width && p.y <= l.y + l.canvas.height) return editText(l);
    editText(null, p);
  }
  function renderText(t) {
    const val = t.caps ? t.value.toUpperCase() : t.value;
    const lines = val.split('\n');
    const font = `${t.italic ? 'italic ' : ''}${t.weight} ${t.size}px "${t.font}"`;
    const spacing = `${((t.tracking || 0) / 1000) * t.size}px`;
    const m = O.cx(O.mk(1, 1)); m.font = font; m.letterSpacing = spacing;
    const lh = t.size * (t.leading || 120) / 100;
    const pad = Math.ceil(t.size * 0.2);
    const width = Math.ceil(Math.max(...lines.map(s => m.measureText(s).width), 1)) + pad;
    const c = O.mk(width, Math.max(1, Math.ceil(lh * (lines.length - 1) + t.size * 1.35))), ctx = O.cx(c);
    ctx.font = font; ctx.letterSpacing = spacing; ctx.fillStyle = t.color; ctx.textBaseline = 'top'; ctx.textAlign = t.align;
    const ax = t.align === 'center' ? c.width / 2 : t.align === 'right' ? c.width - t.size * 0.1 : t.size * 0.1;
    lines.forEach((s, i) => {
      const y = i * lh + t.size * 0.1;
      ctx.fillText(s, ax, y);
      if (t.underline && s) {
        const w = ctx.measureText(s).width, x0 = t.align === 'center' ? ax - w / 2 : t.align === 'right' ? ax - w : ax;
        ctx.fillRect(x0, y + t.size * 0.98, w, Math.max(1, t.size * 0.06));
      }
    });
    return c;
  }
  function editText(layer, p) {
    const t = layer ? { ...layer.text } : { value: '', font: 'Manrope', size: Math.max(24, Math.round(Math.min(doc.width, doc.height) / 12)), weight: 700, italic: false, color: fg, align: 'left' };
    const body = h(`<div class="stack">
      <label class="field"><span>Text</span><textarea rows="3" placeholder="Type something"></textarea></label>
      <div class="row"></div><div class="row r2"></div></div>`);
    $('textarea', body).value = t.value;
    const font = selectField('Font', FONTS.map(f => [f, f]), t.font);
    const size = numberField('Size', t.size, { min: 4, max: 2000, suffix: 'px' });
    const weight = selectField('Weight', [[400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold']], t.weight);
    const align = selectField('Align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], t.align);
    const color = h(`<label class="field" style="flex:none"><span>Color</span><input type="color" value="${t.color}"></label>`);
    const italic = checkField('Italic', t.italic);
    const tracking = numberField('Tracking', t.tracking || 0, { min: -200, max: 1000, step: 10, suffix: '‰' });
    const leading = numberField('Line height', t.leading || 120, { min: 50, max: 400, step: 5, suffix: '%' });
    const caps = checkField('All caps', !!t.caps), underline = checkField('Underline', !!t.underline);
    $('.row', body).append(font, size, weight);
    $('.r2', body).append(align, color, h('<div style="align-self:center"></div>'));
    $('.r2 > div:last-child', body).appendChild(italic);
    const r3 = h('<div class="row"></div>'); r3.append(tracking, leading, h('<div class="stack" style="align-self:end;gap:4px"></div>'));
    $('.stack', r3).append(caps, underline); body.appendChild(r3);
    modal({ title: layer ? 'Edit text' : 'Add text', body, width: 520, actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: layer ? 'Update' : 'Add text', kind: 'primary', onClick: () => {
        Object.assign(t, { value: $('textarea', body).value, font: font.get(), size: size.get(), weight: Number(weight.get()), align: align.get(), color: $('input[type=color]', color).value, italic: italic.get(),
          tracking: tracking.get(), leading: leading.get(), caps: caps.get(), underline: underline.get() });
        if (!t.value.trim()) return;
        const c = renderText(t);
        if (layer) { layer.canvas = c; layer.text = t; layer.mask = null; markDirty(layer); pushHistory('Edit text'); }
        else {
          const l = newLayer(c, t.value.split('\n')[0].slice(0, 24) || 'Text', Math.round(p.x), Math.round(p.y - t.size * 0.6));
          l.text = t; insertLayer(l); pushHistory('Add text');
        }
        refreshAll();
      } },
    ] });
  }

  // ---------- layers ----------
  // ---------- multi-select, groups, align ----------
  let selIds = new Set(); // extra layers selected alongside the active one
  const groupsOf = () => doc.groups || (doc.groups = {});
  const shown = l => l.visible && (!l.group || !doc.groups || !doc.groups[l.group] || doc.groups[l.group].visible);
  /** Active layer plus any Shift/Ctrl-clicked layers, bottom → top. */
  function selectedLayers() {
    if (!doc) return [];
    return doc.layers.filter(l => l.id === doc.activeId || selIds.has(l.id));
  }
  function groupMembers(gid) { return doc.layers.filter(l => l.group === gid); }
  /** Keep group members contiguous and drop empty groups. */
  function tidyGroups() {
    if (!doc.groups) return;
    const seen = new Set(); const out = [];
    for (const l of doc.layers) {
      if (l.group && !doc.groups[l.group]) l.group = null;
      if (!l.group || seen.has(l.group)) { if (!l.group) out.push(l); continue; }
      seen.add(l.group);
      out.push(...doc.layers.filter(x => x.group === l.group));
    }
    doc.layers = out;
    for (const id of Object.keys(doc.groups)) if (!seen.has(id)) delete doc.groups[id];
  }
  function groupLayers() {
    if (!doc) return;
    const run = selectedLayers(); if (!run.length) return toast('Select the layers to group first (Shift- or Ctrl/Cmd-click in the Layers panel).', 'error');
    commitAdjust();
    const id = uid('g'), n = Object.keys(groupsOf()).length + 1;
    groupsOf()[id] = { id, name: `Group ${n}`, visible: true, opacity: 1, blend: 'pass', collapsed: false };
    const top = doc.layers.indexOf(run[run.length - 1]);
    const rest = doc.layers.filter(l => !run.includes(l));
    const at = rest.indexOf(doc.layers.slice(top + 1).find(l => !run.includes(l)));
    run.forEach(l => { l.group = id; });
    rest.splice(at < 0 ? rest.length : at, 0, ...run);
    doc.layers = rest; doc.activeGroup = id; tidyGroups();
    pushHistory('Group layers'); refreshAll();
  }
  function ungroupLayers() {
    if (!doc) return;
    const gid = doc.activeGroup || (active() && active().group);
    if (!gid) return toast('Select a group (or a layer inside one) to ungroup.', 'error');
    commitAdjust();
    doc.layers.forEach(l => { if (l.group === gid) l.group = null; });
    delete groupsOf()[gid]; doc.activeGroup = null;
    pushHistory('Ungroup layers'); refreshAll();
  }
  function groupSettings(gid) {
    const g = groupsOf()[gid]; if (!g) return;
    const name = h(`<label class="field"><span>Name</span><input type="text" value="${esc(g.name)}"></label>`);
    modal({ title: 'Group', body: h('<div class="stack"></div>').appendChild(name).parentNode, width: 360, actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Rename', kind: 'primary', onClick: () => { g.name = $('input', name).value.trim() || g.name; pushHistory('Rename group'); renderLayers(); } },
    ] });
  }
  /** Content bounds of a layer in doc space (ignores fully transparent margins). */
  function layerBox(l) {
    if (isAdj(l)) return null;
    const k = l.rev + ':' + l.canvas.width + 'x' + l.canvas.height;
    if (!l._bb || l._bb.k !== k) l._bb = { k, b: O.bounds(l.canvas) };
    const b = l._bb.b; return b ? { x: l.x + b.x, y: l.y + b.y, w: b.w, h: b.h } : null;
  }
  function alignLayers(how) {
    if (!doc) return;
    const run = selectedLayers().filter(l => !isAdj(l) && !l.locked);
    if (!run.length) return toast('Select a layer to align.', 'error');
    commitAdjust();
    let ref;
    if (doc.selection) ref = O.bounds(doc.selection);
    else if (run.length > 1) { const bs = run.map(layerBox).filter(Boolean); if (bs.length) { const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y)); ref = { x: x0, y: y0, w: Math.max(...bs.map(b => b.x + b.w)) - x0, h: Math.max(...bs.map(b => b.y + b.h)) - y0 }; } }
    if (!ref) ref = { x: 0, y: 0, w: doc.width, h: doc.height };
    for (const l of run) {
      const b = layerBox(l); if (!b) continue;
      if (how === 'left') l.x += ref.x - b.x;
      if (how === 'right') l.x += ref.x + ref.w - (b.x + b.w);
      if (how === 'hcenter') l.x += Math.round(ref.x + ref.w / 2 - (b.x + b.w / 2));
      if (how === 'top') l.y += ref.y - b.y;
      if (how === 'bottom') l.y += ref.y + ref.h - (b.y + b.h);
      if (how === 'vcenter') l.y += Math.round(ref.y + ref.h / 2 - (b.y + b.h / 2));
    }
    pushHistory('Align layers'); refreshAll();
  }
  function distributeLayers(axis) {
    const run = selectedLayers().filter(l => !isAdj(l) && !l.locked).map(l => ({ l, b: layerBox(l) })).filter(o => o.b);
    if (run.length < 3) return toast('Select three or more layers to distribute them.', 'error');
    commitAdjust();
    const c = o => axis === 'h' ? o.b.x + o.b.w / 2 : o.b.y + o.b.h / 2;
    run.sort((a, b) => c(a) - c(b));
    const a = c(run[0]), z = c(run[run.length - 1]), step = (z - a) / (run.length - 1);
    run.forEach((o, i) => { const d = Math.round(a + step * i - c(o)); if (axis === 'h') o.l.x += d; else o.l.y += d; });
    pushHistory('Distribute layers'); refreshAll();
  }
  /** Edges and centers of other visible layers, for smart guides while moving. */
  function smartTargets(exclude) {
    const xs = [], ys = [];
    if (!doc) return { xs, ys };
    for (const l of doc.layers) {
      if (exclude.includes(l) || !shown(l)) continue;
      const b = layerBox(l); if (!b || (b.w >= doc.width && b.h >= doc.height)) continue;
      xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    return { xs, ys };
  }

  function insertLayer(l, above = active()) {
    const i = above ? doc.layers.indexOf(above) + 1 : doc.layers.length;
    if (above && above.group && l.group === undefined) l.group = above.group;
    doc.layers.splice(i, 0, l);
    doc.activeId = l.id; selIds.clear(); doc.activeGroup = null;
  }
  function addEmptyLayer() {
    if (!doc) return;
    commitAdjust();
    insertLayer(newLayer(O.mk(doc.width, doc.height), `Layer ${doc.layers.length + 1}`));
    pushHistory('New layer'); refreshAll();
  }
  function duplicateLayer() {
    const l = active(); if (!l) return;
    commitAdjust();
    const n = newLayer(O.clone(l.canvas), l.name + ' copy', l.x, l.y);
    Object.assign(n, { opacity: l.opacity, blend: l.blend, mask: l.mask ? O.clone(l.mask) : null, maskOn: l.maskOn, text: l.text ? { ...l.text } : null,
      type: l.type, adj: deep(l.adj), fx: deep(l.fx), clip: l.clip, editMask: l.editMask, group: l.group || null });
    insertLayer(n, l); pushHistory('Duplicate layer'); refreshAll();
  }
  function deleteLayer() {
    const l = active(); if (!l) return;
    commitAdjust();
    const gone = doc.activeGroup ? groupMembers(doc.activeGroup) : selectedLayers();
    if (gone.length > 1) {
      const i = doc.layers.indexOf(gone[0]);
      doc.layers = doc.layers.filter(x => !gone.includes(x));
      doc.activeId = (doc.layers[i] || doc.layers[i - 1] || {}).id || null; selIds.clear(); doc.activeGroup = null; tidyGroups();
      pushHistory(gone.length > 1 ? 'Delete layers' : 'Delete layer'); return refreshAll();
    }
    const i = doc.layers.indexOf(l);
    doc.layers.splice(i, 1);
    doc.activeId = (doc.layers[i] || doc.layers[i - 1] || {}).id || null; tidyGroups();
    pushHistory('Delete layer'); refreshAll();
  }
  function moveLayer(dir) {
    const l = active(); if (!l) return;
    const i = doc.layers.indexOf(l), j = i + dir;
    if (j < 0 || j >= doc.layers.length) { if (l.group) { l.group = null; tidyGroups(); pushHistory('Move out of group'); refreshAll(); } return; }
    const nb = doc.layers[j];
    if ((nb.group || null) !== (l.group || null)) {
      // crossing a group boundary: leave the current group, or step into the neighbouring one
      if (l.group) l.group = null; else l.group = nb.group;
      tidyGroups(); pushHistory(l.group ? 'Move into group' : 'Move out of group'); return refreshAll();
    }
    doc.layers.splice(i, 1); doc.layers.splice(j, 0, l);
    pushHistory(dir > 0 ? 'Move layer up' : 'Move layer down'); refreshAll();
  }
  function bakeLayer(l) {
    // Layer pixels with its mask applied, in doc space size of its own canvas.
    if (!l.mask || !l.maskOn) return O.clone(l.canvas);
    const c = O.clone(l.canvas), x = O.cx(c); x.globalCompositeOperation = 'destination-in'; x.drawImage(l.mask, 0, 0);
    return c;
  }
  /** Render a run of layers into one new pixel canvas covering all of their content. */
  function flattenRun(run) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of run) { const b = PhotoCompose.bounds(l, doc.width, doc.height); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    if (!isFinite(x0)) return null;
    const c = O.mk(x1 - x0, y1 - y0), ctx = O.cx(c);
    ctx.translate(-x0, -y0);
    PhotoCompose.renderStack(ctx, run.map(l => ({ ...l, visible: true, clip: run.indexOf(l) ? l.clip : false })), { noCache: true, groups: doc.groups });
    return { canvas: c, x: x0, y: y0 };
  }
  function mergeDown() {
    const l = active(); if (!l) return;
    const many = selectedLayers();
    if (many.length > 1) {
      if (many.some(isAdj)) return toast('Adjustment layers can\'t be merged. Deselect them first.', 'error');
      commitAdjust();
      const merged = flattenRun(many); if (!merged) return;
      const top = many[many.length - 1];
      const n = newLayer(merged.canvas, top.name, merged.x, merged.y); n.group = top.group || null;
      doc.layers = doc.layers.filter(x => !many.includes(x) || x === top).map(x => x === top ? n : x);
      doc.activeId = n.id; selIds.clear(); tidyGroups();
      pushHistory('Merge layers'); return refreshAll();
    }
    const i = doc.layers.indexOf(l);
    const below = doc.layers[i - 1];
    if (!below) return toast('There is no layer below to merge into.', 'error');
    if (isAdj(below)) return toast('The layer below is an adjustment layer. Merge it into a pixel layer first, or move this layer.', 'error');
    commitAdjust();
    const merged = flattenRun([below, l]);
    if (!merged) return;
    // keep the lower layer's opacity semantics: the merged result carries the combined look at 100%
    Object.assign(below, { canvas: merged.canvas, x: merged.x, y: merged.y, opacity: 1, blend: 'source-over', mask: null, text: null, editMask: false, fx: null, clip: below.clip });
    markDirty(below);
    doc.layers.splice(i, 1); doc.activeId = below.id; tidyGroups();
    pushHistory('Merge down'); refreshAll();
  }
  function mergeVisible() {
    if (!doc) return;
    commitAdjust();
    const vis = doc.layers.filter(shown);
    if (vis.length < 2) return toast('Show at least two layers to merge them.', 'error');
    const merged = flattenRun(vis);
    const n = newLayer(merged.canvas, 'Merged', merged.x, merged.y);
    const top = doc.layers.indexOf(vis[vis.length - 1]);
    doc.layers = doc.layers.filter((l, k) => !vis.includes(l) || k === top).map(l => l === vis[vis.length - 1] ? n : l);
    n.group = null; tidyGroups();
    doc.activeId = n.id;
    pushHistory('Merge visible'); refreshAll();
  }
  function flattenImage() {
    if (!doc || doc.layers.length < 1) return;
    commitAdjust();
    const c = O.clone(el.composite);
    const l = newLayer(c, 'Background');
    doc.layers = [l]; doc.activeId = l.id; doc.groups = {}; doc.activeGroup = null; selIds.clear();
    pushHistory('Flatten image'); refreshAll();
  }
  function addMask() {
    const l = active(); if (!l) return;
    if (isAdj(l)) return toast('Adjustment layers already have a mask — paint on the layer to change where it applies.', 'info');
    if (l.mask) return;
    commitAdjust();
    const m = O.mk(l.canvas.width, l.canvas.height), mc = O.cx(m);
    if (doc.selection) mc.drawImage(doc.selection, -l.x, -l.y);
    else { mc.fillStyle = '#000'; mc.fillRect(0, 0, m.width, m.height); }
    l.mask = m; l.maskOn = true; l.editMask = true; markMask(l);
    pushHistory(doc.selection ? 'Mask from selection' : 'Add mask'); refreshAll();
    toast('Mask added. Paint black to hide and white to reveal.', 'info');
  }
  function maskMenu(anchor) {
    const l = active(); if (!l) return;
    if (!l.mask) return addMask();
    menuAt(anchor, [
      { heading: 'Layer mask' },
      { label: l.editMask ? 'Edit layer pixels' : 'Edit mask', onClick: () => { l.editMask = !l.editMask; refreshAll(); } },
      { label: l.maskOn ? 'Disable mask' : 'Enable mask', onClick: () => { l.maskOn = !l.maskOn; pushHistory(l.maskOn ? 'Enable mask' : 'Disable mask'); refreshAll(); } },
      { label: 'Invert mask', onClick: () => {
        const n = O.mk(l.mask.width, l.mask.height), c = O.cx(n);
        c.fillRect(0, 0, n.width, n.height); c.globalCompositeOperation = 'destination-out'; c.drawImage(l.mask, 0, 0);
        l.mask = n; markMask(l); pushHistory('Invert mask'); refreshAll();
      } },
      { label: 'Selection from mask', onClick: () => { const s = O.mk(doc.width, doc.height); O.cx(s).drawImage(l.mask, l.x, l.y); setSelection(s); pushHistory('Selection from mask'); } },
      'sep',
      { label: 'Apply mask', onClick: () => { l.canvas = bakeLayer(l); l.mask = null; l.editMask = false; markDirty(l); pushHistory('Apply mask'); refreshAll(); } },
      { label: 'Delete mask', onClick: () => { l.mask = null; l.editMask = false; pushHistory('Delete mask'); refreshAll(); } },
    ]);
  }
  function layerMenu(anchor) {
    const l = active();
    const mk = window.ro3 && ro3.platform === 'darwin' ? 'Cmd' : 'Ctrl';
    menuAt(anchor, [
      { label: 'Copy', kbd: mk + '+C', onClick: () => copyToClipboard(false, false), disabled: !l },
      { label: 'Copy merged', kbd: mk + '+Shift+C', onClick: () => copyToClipboard(true, false), disabled: !doc },
      { label: 'Paste as new layer', kbd: mk + '+V', onClick: () => pasteFromClipboard(false) },
      { label: 'Paste as new image', kbd: mk + '+Shift+V', onClick: () => pasteFromClipboard(true) },
      'sep',
      { label: 'Transform…', kbd: mk + '+T', onClick: () => setTool('transform'), disabled: !l },
      { label: 'New layer', kbd: mk + '+Shift+N', onClick: addEmptyLayer },
      { label: 'Duplicate layer', kbd: 'Ctrl+J', onClick: duplicateLayer, disabled: !l },
      { label: 'Rename…', onClick: renameLayer, disabled: !l },
      { label: 'Edit text…', onClick: () => editText(l), disabled: !l || !l.text },
      'sep',
      { label: 'Flip layer horizontal', onClick: () => transformLayer(c => O.flip(c, true), 'Flip layer'), disabled: !l },
      { label: 'Flip layer vertical', onClick: () => transformLayer(c => O.flip(c, false), 'Flip layer'), disabled: !l },
      { label: 'Rotate layer 90° clockwise', onClick: () => transformLayer(c => O.rotate90(c, true), 'Rotate layer'), disabled: !l },
      { label: 'Scale layer…', onClick: scaleLayer, disabled: !l },
      { label: 'Center layer', onClick: () => { l.x = Math.round((doc.width - l.canvas.width) / 2); l.y = Math.round((doc.height - l.canvas.height) / 2); pushHistory('Center layer'); refreshAll(); }, disabled: !l },
      'sep',
      { label: 'Layer style…', onClick: () => layerStyleDialog(), disabled: !l || isAdj(l) },
      { label: l && l.clip ? 'Release clipping mask' : 'Create clipping mask', kbd: mk + '+Alt+G', onClick: toggleClip, disabled: !l || doc.layers.indexOf(l) === 0 },
      { label: l && l.locked ? 'Unlock layer' : 'Lock layer', kbd: mk + '+/', onClick: toggleLock, disabled: !l },
      { label: 'Rasterize style', onClick: rasterizeLayer, disabled: !l || isAdj(l) || !PhotoCompose.fxOn(l.fx) },
      'sep',
      { label: 'Merge down', onClick: mergeDown, disabled: !l },
      { label: 'Merge visible', kbd: mk + '+Shift+E', onClick: mergeVisible, disabled: !doc },
      { label: 'Flatten image', onClick: flattenImage, disabled: !doc },
      { label: 'Delete layer', onClick: deleteLayer, disabled: !l },
    ]);
  }
  function transformLayer(fn, label) {
    const l = active(); if (!editable(l, { pixelsOnly: true })) return;
    commitAdjust();
    const cxm = l.x + l.canvas.width / 2, cym = l.y + l.canvas.height / 2;
    l.canvas = fn(l.canvas); if (l.mask) { l.mask = fn(l.mask); markMask(l); }
    l.x = Math.round(cxm - l.canvas.width / 2); l.y = Math.round(cym - l.canvas.height / 2);
    l.text = null; markDirty(l); pushHistory(label); refreshAll();
  }
  async function scaleLayer() {
    const l = active(); if (!l) return;
    const v = await promptBox('Scale layer', 'Scale (%)', '100', 'Scale');
    const pct = Number(v);
    if (!pct || pct <= 0 || pct === 100) return;
    transformLayer(c => O.scaled(c, Math.max(1, c.width * pct / 100), Math.max(1, c.height * pct / 100)), 'Scale layer');
  }
  async function renameLayer() {
    const l = active(); if (!l) return;
    const n = await promptBox('Rename layer', 'Name', l.name, 'Rename');
    if (n && n.trim()) { l.name = n.trim(); pushHistory('Rename layer'); renderLayers(); }
  }
  function clearSelectionArea(label = 'Clear') {
    const l = active(); if (!l || !doc.selection || !editable(l)) return;
    commitAdjust();
    const t = targetOf(l), c = O.cx(t);
    c.globalCompositeOperation = 'destination-out'; c.drawImage(doc.selection, -l.x, -l.y); c.globalCompositeOperation = 'source-over';
    if ((l.editMask || isAdj(l)) && l.mask) markMask(l); else { l.text = null; markDirty(l); }
    pushHistory(label); refreshAll();
  }
  function fillSelection() {
    const l = active(); if (!editable(l, { pixelsOnly: true })) return;
    commitAdjust();
    const sel = doc.selection || shapeCanvas(c => c.rect(0, 0, doc.width, doc.height));
    const f = O.clone(sel), fc = O.cx(f); fc.globalCompositeOperation = 'source-in'; fc.fillStyle = fg; fc.fillRect(0, 0, f.width, f.height);
    O.cx(l.canvas).drawImage(f, -l.x, -l.y);
    l.text = null; markDirty(l); pushHistory('Fill selection'); refreshAll();
  }
  function selectionToLayer(cut) {
    const l = active(); if (!l || !doc.selection) return toast('Make a selection first.', 'error');
    commitAdjust();
    const piece = O.mk(doc.width, doc.height), pc = O.cx(piece);
    pc.drawImage(bakeLayer(l), l.x, l.y); pc.globalCompositeOperation = 'destination-in'; pc.drawImage(doc.selection, 0, 0);
    if (cut) { const c = O.cx(l.canvas); c.globalCompositeOperation = 'destination-out'; c.drawImage(doc.selection, -l.x, -l.y); c.globalCompositeOperation = 'source-over'; l.text = null; markDirty(l); }
    insertLayer(newLayer(piece, cut ? 'Cut layer' : 'Copied layer'), l);
    pushHistory(cut ? 'Cut to layer' : 'Copy to layer'); refreshAll();
  }

  // ---------- adjustment layers, styles, clipping, locking ----------
  function addAdjustmentLayer(kind) {
    if (!doc) return toast('Open or create an image first.', 'error');
    commitAdjust();
    const l = newLayer(O.mk(doc.width, doc.height), PhotoAdjust.KINDS[kind].name);
    l.type = 'adjust'; l.adj = PhotoAdjust.make(kind); l.editMask = true;
    const m = O.mk(doc.width, doc.height), mc = O.cx(m);
    if (doc.selection) mc.drawImage(doc.selection, 0, 0); else { mc.fillStyle = '#fff'; mc.fillRect(0, 0, doc.width, doc.height); }
    l.mask = m;
    insertLayer(l);
    pushHistory('New ' + PhotoAdjust.KINDS[kind].name + ' layer');
    if (doc.selection) setSelection(null);
    sideTab = 'adjust'; buildSide();
    refreshAll();
  }
  function adjustmentMenu(anchor) {
    if (!doc) return toast('Open or create an image first.', 'error');
    menuAt(anchor, [{ heading: 'New adjustment layer' }, ...PhotoAdjust.ORDER.map(k => ({ label: PhotoAdjust.KINDS[k].name, onClick: () => addAdjustmentLayer(k) }))]);
  }
  function toggleClip() {
    const l = active(); if (!l || doc.layers.indexOf(l) === 0) return;
    l.clip = !l.clip; pushHistory(l.clip ? 'Create clipping mask' : 'Release clipping mask'); refreshAll();
  }
  function toggleLock() {
    const l = active(); if (!l) return;
    if (tf && tf.layer === l) finishTransform(true);
    l.locked = !l.locked; pushHistory(l.locked ? 'Lock layer' : 'Unlock layer'); renderLayers();
  }
  function rasterizeLayer() {
    const l = active(); if (!l || isAdj(l)) return;
    const S = PhotoCompose.styled(l, PhotoCompose.pixels(l));
    Object.assign(l, { canvas: O.clone(S.canvas), x: S.x, y: S.y, fx: null, mask: null, editMask: false, text: null });
    markDirty(l); pushHistory('Rasterize layer style'); refreshAll();
  }

  const FX_DEFAULTS = () => ({
    shadow: { on: false, color: '#000000', opacity: 60, angle: 120, distance: 12, size: 18 },
    glow: { on: false, color: '#2fd67f', opacity: 75, size: 24 },
    stroke: { on: false, color: '#ffffff', size: 6, opacity: 100 },
    overlay: { on: false, color: '#2fd67f', opacity: 100 },
    gradient: { on: false, color: '#000000', color2: '#2fd67f', opacity: 100, angle: 90, scale: 100, style: 'linear', reverse: false },
    satin: { on: false, color: '#000000', opacity: 50, angle: 19, distance: 11, size: 14, invert: true },
    innerGlow: { on: false, color: '#ffffbe', opacity: 75, size: 10, choke: 0 },
    innerShadow: { on: false, color: '#000000', opacity: 75, angle: 120, distance: 5, size: 5, choke: 0 },
    bevel: { on: false, color: '#ffffff', shadowColor: '#000000', hiOpacity: 75, loOpacity: 75, size: 8, depth: 100, angle: 120, altitude: 30, direction: 'up' },
  });
  let styleClipboard = null;
  function copyStyle() { const l = active(); if (!l || !PhotoCompose.fxOn(l.fx)) return toast('This layer has no style to copy.', 'info'); styleClipboard = deep(l.fx); toast('Layer style copied.', 'ok'); }
  function pasteStyle() {
    if (!styleClipboard) return toast('Copy a layer style first.', 'info');
    const ls = selectedLayers().filter(l => !isAdj(l)); if (!ls.length) return;
    ls.forEach(l => { l.fx = deep(styleClipboard); markDirty(l); }); pushHistory('Paste layer style'); refreshAll();
  }
  function clearStyle() { const ls = selectedLayers().filter(l => l.fx); if (!ls.length) return; ls.forEach(l => { l.fx = null; markDirty(l); }); pushHistory('Clear layer style'); refreshAll(); }
  function layerStyleDialog(focus) {
    const l = active();
    if (!l) return toast('Select a layer first.', 'error');
    if (isAdj(l)) return toast('Layer styles apply to pixel layers.', 'error');
    commitAdjust();
    const before = deep(l.fx);
    const fx = Object.assign(FX_DEFAULTS(), deep(l.fx) || {});
    const body = h('<div class="fx-dialog"></div>');
    let q = false;
    const live = () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; l.fx = deep(fx); requestRender(); }); };
    const section = (key, title, controls) => {
      const e = fx[key];
      const sec = h(`<div class="fx-sec ${e.on ? 'on' : ''}"><div class="fx-head"></div><div class="fx-body stack"></div></div>`);
      const c = checkField(title, e.on); $('.fx-head', sec).appendChild(c);
      c.input.addEventListener('change', () => { e.on = c.get(); sec.classList.toggle('on', e.on); live(); });
      const b = $('.fx-body', sec);
      const row = h('<div class="row" style="align-items:flex-end"></div>');
      const turnOn = () => { e.on = true; c.input.checked = true; sec.classList.add('on'); };
      const colorField = (k, label) => { const col = h(`<label class="field" style="flex:none"><span>${label}</span><input type="color" value="${e[k]}"></label>`); $('input', col).addEventListener('input', ev => { e[k] = ev.target.value; turnOn(); live(); }); row.appendChild(col); };
      colorField('color', key === 'bevel' ? 'Highlight' : key === 'gradient' ? 'From' : 'Color');
      if (key === 'gradient') colorField('color2', 'To');
      if (key === 'bevel') colorField('shadowColor', 'Shadow');
      controls.forEach(([k, label, min, max, unit]) => {
        if (Array.isArray(min)) { const s = selectField(label, min, e[k]); s.select.addEventListener('change', () => { e[k] = s.get(); turnOn(); live(); }); row.appendChild(s); return; }
        if (min === 'check') { const ch = checkField(label, !!e[k]); ch.input.addEventListener('change', () => { e[k] = ch.get(); turnOn(); live(); }); b.appendChild(ch); return; }
        const s = slider({ label, min, max, value: e[k], unit: unit || '' });
        s.input.addEventListener('input', () => { e[k] = s.get(); if (!e.on) { e.on = true; c.input.checked = true; sec.classList.add('on'); } live(); });
        b.appendChild(s);
      });
      b.prepend(row);
      return sec;
    };
    body.append(
      section('shadow', 'Drop shadow', [['opacity', 'Opacity', 0, 100, '%'], ['angle', 'Angle', -180, 180, '°'], ['distance', 'Distance', 0, 200, 'px'], ['size', 'Softness', 0, 120, 'px']]),
      section('glow', 'Outer glow', [['opacity', 'Opacity', 0, 100, '%'], ['size', 'Size', 1, 150, 'px']]),
      section('stroke', 'Stroke (outside)', [['size', 'Size', 1, 60, 'px'], ['opacity', 'Opacity', 0, 100, '%']]),
      section('overlay', 'Color overlay', [['opacity', 'Opacity', 0, 100, '%']]),
      section('gradient', 'Gradient overlay', [['style', 'Style', [['linear', 'Linear'], ['radial', 'Radial']]], ['opacity', 'Opacity', 0, 100, '%'], ['angle', 'Angle', -180, 180, '°'], ['scale', 'Scale', 10, 150, '%'], ['reverse', 'Reverse', 'check']]),
      section('innerShadow', 'Inner shadow', [['opacity', 'Opacity', 0, 100, '%'], ['angle', 'Angle', -180, 180, '°'], ['distance', 'Distance', 0, 100, 'px'], ['size', 'Size', 0, 100, 'px'], ['choke', 'Choke', 0, 100, '%']]),
      section('innerGlow', 'Inner glow', [['opacity', 'Opacity', 0, 100, '%'], ['size', 'Size', 1, 100, 'px'], ['choke', 'Choke', 0, 100, '%']]),
      section('satin', 'Satin', [['opacity', 'Opacity', 0, 100, '%'], ['angle', 'Angle', -180, 180, '°'], ['distance', 'Distance', 1, 100, 'px'], ['size', 'Size', 1, 100, 'px'], ['invert', 'Invert', 'check']]),
      section('bevel', 'Bevel & emboss', [['direction', 'Direction', [['up', 'Up'], ['down', 'Down']]], ['size', 'Size', 1, 60, 'px'], ['depth', 'Depth', 10, 500, '%'], ['angle', 'Angle', -180, 180, '°'], ['altitude', 'Altitude', 0, 90, '°'], ['hiOpacity', 'Highlight opacity', 0, 100, '%'], ['loOpacity', 'Shadow opacity', 0, 100, '%']]),
    );
    let ok = false;
    modal({ title: `Layer style — ${l.name}`, body, width: 560, actions: [
      { label: 'Clear all', kind: 'ghost', onClick: () => { Object.values(fx).forEach(e => e.on = false); $$('.fx-sec', body).forEach(s => { s.classList.remove('on'); $('input[type=checkbox]', s).checked = false; }); live(); return false; } },
      { label: 'Cancel', kind: 'ghost' },
      { label: 'OK', kind: 'primary', onClick: () => { ok = true; } },
    ], onClose: () => {
      if (ok) { l.fx = PhotoCompose.fxOn(fx) ? deep(fx) : null; markDirty(l); pushHistory('Layer style'); }
      else { l.fx = before; }
      requestRender(); renderLayers();
    } });
    if (focus) { const s = body.querySelector(`.fx-sec:nth-child(${['shadow', 'glow', 'stroke', 'overlay', 'gradient', 'innerShadow', 'innerGlow', 'satin', 'bevel'].indexOf(focus) + 1})`); s && s.scrollIntoView(); }
  }

  /** Histogram of everything beneath layer `l` (downscaled for speed). */
  function histogramBelow(l) {
    const i = doc.layers.indexOf(l);
    const k = Math.min(1, 480 / Math.max(doc.width, doc.height));
    const c = O.mk(doc.width * k, doc.height * k), x = O.cx(c);
    x.scale(k, k);
    PhotoCompose.renderStack(x, doc.layers.slice(0, i), { noCache: true, groups: doc.groups });
    return PhotoAdjust.histogram(O.data(c).data);
  }
  function adjustmentPanel(l) {
    const wrap = h('<div class="ph-adjust"></div>');
    const head = h(`<div class="adj-head"><span class="adj-title">${icon(PhotoAdjust.KINDS[l.adj.kind].icon)}${esc(PhotoAdjust.KINDS[l.adj.kind].name)}</span><button class="btn btn-sm btn-ghost">Reset</button></div>`);
    $('button', head).addEventListener('click', () => { l.adj = PhotoAdjust.make(l.adj.kind); markDirty(l); pushHistory('Reset ' + PhotoAdjust.KINDS[l.adj.kind].name); renderSideBody(); requestRender(); });
    let q = false;
    const ed = PhotoAdjust.editor({
      adj: l.adj, hist: histogramBelow(l),
      onInput: () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; markDirty(l); requestRender(); }); },
      onCommit: (label) => { markDirty(l); pushHistory(label); },
      rebuild: () => renderSideBody(),
    });
    wrap.append(head, ed, h('<p class="hint">Non-destructive: changes everything below this layer. Paint black on it to hide the effect, white to bring it back. Use Layer ▸ Create clipping mask to affect only the layer beneath.</p>'));
    return wrap;
  }

  // ---------- adjustments & filters ----------
  const ADJ = [
    { key: 'exposure', label: 'Exposure', min: -100, max: 100 },
    { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
    { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
    { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
    { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
    { key: 'hue', label: 'Hue', min: -180, max: 180, unit: '°' },
    { key: 'temperature', label: 'Temperature', min: -100, max: 100 },
    { key: 'tint', label: 'Tint', min: -100, max: 100 },
  ];
  const adjValues = () => Object.fromEntries(ADJ.map(a => [a.key, el.adjSliders[a.key].get()]));
  function startAdjust() {
    const l = active();
    if (!editable(l, { pixelsOnly: true })) return null;
    if (adj && adj.layer === l) return adj;
    commitAdjust();
    if (l.text) l.text = null;
    adj = { layer: l, backup: O.clone(l.canvas), sel: O.selIn(doc.selection, l.canvas.width, l.canvas.height, l.x, l.y), changed: false, queued: false };
    return adj;
  }
  function previewAdjust() {
    const a = startAdjust(); if (!a) return;
    a.changed = true;
    if (a.queued) return;
    a.queued = true;
    requestAnimationFrame(() => {
      a.queued = false;
      if (adj !== a) return;
      const res = O.mixMasked(a.backup, O.adjust(a.backup, adjValues()), a.sel);
      const c = O.cx(a.layer.canvas); c.globalCompositeOperation = 'copy'; c.drawImage(res, 0, 0); c.globalCompositeOperation = 'source-over';
      markDirty(a.layer); requestRender();
    });
  }
  function commitAdjust(discard = false) {
    if (tf) finishTransform(!discard);
    if (!adj) return;
    const a = adj; adj = null;
    if (discard && a.changed) { const c = O.cx(a.layer.canvas); c.globalCompositeOperation = 'copy'; c.drawImage(a.backup, 0, 0); c.globalCompositeOperation = 'source-over'; }
    else if (a.changed) {
      const res = O.mixMasked(a.backup, O.adjust(a.backup, adjValues()), a.sel);
      const c = O.cx(a.layer.canvas); c.globalCompositeOperation = 'copy'; c.drawImage(res, 0, 0); c.globalCompositeOperation = 'source-over';
      markDirty(a.layer); pushHistory('Adjust colors');
    }
    if (el.adjSliders) Object.values(el.adjSliders).forEach(s => s.set(0));
    requestRender(); renderLayers();
  }

  /** Run a filter on the active layer (inside the selection). params: [{key,label,min,max,value,unit}] */
  function runFilter(name, label, params = []) {
    const l = active(); if (!editable(l, { pixelsOnly: true })) return;
    commitAdjust();
    const backup = O.clone(l.canvas);
    const sel = O.selIn(doc.selection, l.canvas.width, l.canvas.height, l.x, l.y);
    const write = (p) => {
      const res = O.mixMasked(backup, O.FILTERS[name](backup, p), sel);
      const c = O.cx(l.canvas); c.globalCompositeOperation = 'copy'; c.drawImage(res, 0, 0); c.globalCompositeOperation = 'source-over';
      markDirty(l); requestRender();
    };
    const done = () => { l.text = null; markDirty(l); pushHistory(label); renderLayers(); };
    if (!params.length) { write({}); done(); return; }
    const body = h('<div class="stack"></div>');
    const sliders = params.map(p => { const s = slider({ ...p, value: p.value }); body.appendChild(s); return s; });
    const values = () => Object.fromEntries(params.map((p, i) => [p.key, sliders[i].get()]));
    let q = false;
    const live = () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; write(values()); }); };
    sliders.forEach(s => s.input.addEventListener('input', live));
    body.appendChild(h(`<p class="hint">Changes preview live on the canvas${sel ? ', inside the selection' : ''}.</p>`));
    write(values());
    let applied = false;
    modal({ title: label, body, width: 360, actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Apply', kind: 'primary', onClick: () => { applied = true; write(values()); done(); } },
    ], onClose: () => { if (!applied) { const c = O.cx(l.canvas); c.globalCompositeOperation = 'copy'; c.drawImage(backup, 0, 0); c.globalCompositeOperation = 'source-over'; requestRender(); } } });
  }

  /** For PSD export: the look of everything up to an adjustment layer, limited by its mask. */
  function bakeAdjustForPsd(l) {
    const i = doc.layers.indexOf(l), c = O.mk(doc.width, doc.height), x = O.cx(c);
    PhotoCompose.renderStack(x, doc.layers.slice(0, i + 1).map((q, k) => k === i ? { ...q, opacity: 1, visible: true } : q), { noCache: true, groups: doc.groups });
    if (l.mask && l.maskOn) { x.globalCompositeOperation = 'destination-in'; x.drawImage(l.mask, l.x, l.y); }
    return c;
  }
  /** Info panel: histogram with stats (PhotoCraft's Histogram panel) and colour sampler readouts. */
  function infoPanel() {
    const wrap = h('<div class="ph-adjust info-panel"></div>');
    if (!doc) { wrap.appendChild(h('<p class="hint">Open an image to see its histogram.</p>')); return wrap; }
    render();
    const src = h('<div class="row"></div>'), chSel = selectField('Channel', [['l', 'Luminosity'], ['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']], infoPanel.ch || 'rgb');
    const from = selectField('Source', [['image', 'Entire image'], ['layer', 'Selected layer']], infoPanel.from || 'image');
    src.append(chSel, from);
    const cv = h('<canvas class="info-hist" width="512" height="200"></canvas>'), stats = h('<div class="info-stats"></div>');
    const paint = () => {
      infoPanel.ch = chSel.get(); infoPanel.from = from.get();
      let c = el.composite; const l = active();
      if (infoPanel.from === 'layer' && l && !isAdj(l)) c = bakeLayer(l);
      const k = Math.min(1, 900 / Math.max(c.width, c.height)), sm = O.mk(Math.max(1, c.width * k), Math.max(1, c.height * k)); O.cx(sm).drawImage(c, 0, 0, sm.width, sm.height);
      let data = O.data(sm).data;
      if (doc.selection && infoPanel.from === 'image') { const m = O.mk(sm.width, sm.height), mc = O.cx(m); mc.drawImage(sm, 0, 0); mc.globalCompositeOperation = 'destination-in'; mc.drawImage(doc.selection, 0, 0, sm.width, sm.height); data = O.data(m).data; }
      const H = PhotoAdjust.histogram(data), g = cv.getContext('2d'); g.clearRect(0, 0, 512, 200);
      const draw = (arr, color) => { const sorted = Array.from(arr).sort((a, b) => b - a), mx = Math.max(1, sorted[2] || sorted[0]); g.fillStyle = color; g.beginPath(); g.moveTo(0, 200); for (let i = 0; i < 256; i++) g.lineTo(i * 2, 200 - Math.min(1, arr[i] / mx) * 190); g.lineTo(512, 200); g.fill(); };
      const ch = infoPanel.ch;
      if (ch === 'rgb') { g.globalCompositeOperation = 'screen'; draw(H.r, 'rgba(255,70,70,.75)'); draw(H.g, 'rgba(70,230,110,.75)'); draw(H.b, 'rgba(80,140,255,.8)'); g.globalCompositeOperation = 'source-over'; }
      else draw(ch === 'l' ? H.l : H[ch], { l: 'rgba(228,236,231,.7)', r: 'rgba(255,90,90,.8)', g: 'rgba(90,230,120,.8)', b: 'rgba(90,150,255,.85)' }[ch]);
      const arr = ch === 'rgb' || ch === 'l' ? H.l : H[ch]; let n = 0, sum = 0, sq = 0; for (let i = 0; i < 256; i++) { n += arr[i]; sum += i * arr[i]; sq += i * i * arr[i]; }
      const mean = n ? sum / n : 0, sd = n ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : 0; let acc = 0, med = 0; for (let i = 0; i < 256; i++) { acc += arr[i]; if (2 * acc >= n) { med = i; break; } }
      const clipLo = n ? arr[0] / n * 100 : 0, clipHi = n ? arr[255] / n * 100 : 0;
      stats.innerHTML = `<span>Mean</span><b>${mean.toFixed(1)}</b><span>Std dev</span><b>${sd.toFixed(1)}</b><span>Median</span><b>${med}</b><span>Pixels</span><b>${Math.round(n / k / k).toLocaleString()}</b><span>Shadows clipped</span><b>${clipLo.toFixed(2)}%</b><span>Highlights clipped</span><b>${clipHi.toFixed(2)}%</b>`;
    };
    chSel.select.addEventListener('change', paint); from.select.addEventListener('change', paint);
    const refresh = h(`<button class="btn btn-sm btn-ghost">${icon('redo')}Refresh</button>`); refresh.addEventListener('click', paint);
    wrap.append(src, cv, stats, refresh);
    const rs = samplerReadouts();
    wrap.append(h('<h4>Color samplers</h4>'), rs.length ? h(`<div class="info-samplers">${rs.map(r => `<div><i style="background:${r.hex}"></i><b>#${r.i}</b> R ${r.r} · G ${r.g} · B ${r.b} <span>${r.hex}</span></div>`).join('')}</div>`) : h('<p class="hint">Use the Color Sampler tool (Shift+I) to pin up to four readouts.</p>'));
    wrap.append(h('<h4>Document</h4>'), h(`<div class="info-stats"><span>Size</span><b>${doc.width} × ${doc.height}px</b><span>Megapixels</span><b>${(doc.width * doc.height / 1e6).toFixed(1)}</b><span>Layers</span><b>${doc.layers.length}</b></div>`));
    paint();
    return wrap;
  }
  // ---------- pixel filters (Blur / Sharpen / Noise / Distort / Stylize / Render galleries) ----------
  // Heavy maths runs in filter-worker.js. While dragging sliders, big layers preview on a reduced copy;
  // Apply always renders at full resolution.
  let filterWorker = null, fwSeq = 0;
  const fwPending = new Map();
  function filterJob(msg, transfer) {
    if (!filterWorker) {
      filterWorker = new Worker('js/filter-worker.js');
      filterWorker.onmessage = e => { const p = fwPending.get(e.data.id); if (!p) return; fwPending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data); };
      filterWorker.onerror = e => { for (const p of fwPending.values()) p.reject(new Error(e.message || 'Filter failed')); fwPending.clear(); filterWorker = null; };
    }
    const id = ++fwSeq;
    return new Promise((resolve, reject) => { fwPending.set(id, { resolve, reject }); filterWorker.postMessage({ ...msg, id }, transfer); });
  }
  const hexRgb = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  /** Run filter `id` on canvas `src` (optionally scaled by k for previews). Resolves to a canvas the size of src. */
  async function filterCanvas(id, src, params, k = 1) {
    const f = PhotoFilters.F[id];
    let w = src.width, hh = src.height, work = src;
    const p = { ...params };
    if (k < 1) {
      w = Math.max(1, Math.round(src.width * k)); hh = Math.max(1, Math.round(src.height * k));
      work = O.mk(w, hh); const wc = O.cx(work); wc.imageSmoothingQuality = 'high'; wc.drawImage(src, 0, 0, w, hh);
      for (const q of f.params) if (q.unit === 'px') p[q.key] = Math.max(q.min, p[q.key] * k);
    }
    const id0 = O.cx(work).getImageData(0, 0, w, hh);
    const r = await filterJob({ filter: id, w, h: hh, data: id0.data.buffer, params: p, ctx: { fg: hexRgb(fg), bg: hexRgb(bg) } }, [id0.data.buffer]);
    const out = O.mk(r.w, r.h); O.cx(out).putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
    if (k >= 1) return out;
    const up = O.mk(src.width, src.height), uc = O.cx(up); uc.imageSmoothingQuality = 'high'; uc.drawImage(out, 0, 0, src.width, src.height);
    return up;
  }
  let lastFilter = null;
  /** Filter dialog: live preview on the canvas, click the image to place centre-based effects. */
  function pixelFilter(id, opts = {}) {
    const f = PhotoFilters.F[id]; if (!f) return;
    const l = active(); if (!editable(l, { pixelsOnly: true })) return;
    commitAdjust();
    const backup = O.clone(l.canvas);
    const sel = O.selIn(doc.selection, l.canvas.width, l.canvas.height, l.x, l.y);
    const vals = Object.fromEntries(f.params.map(q => [q.key, opts.params && opts.params[q.key] != null ? opts.params[q.key] : (T.filters && T.filters[id] && T.filters[id][q.key] != null ? T.filters[id][q.key] : q.value)]));
    const write = res => {
      const out = sel ? O.mixMasked(backup, res, sel) : res;
      const c = O.cx(l.canvas); c.globalCompositeOperation = 'copy'; c.drawImage(out, 0, 0); c.globalCompositeOperation = 'source-over';
      markDirty(l); requestRender();
    };
    const finish = async () => {
      el.stage.classList.add('busy');
      try { write(await filterCanvas(id, backup, vals, 1)); }
      catch (e) { toast('Filter failed: ' + e.message, 'error'); const c = O.cx(l.canvas); c.globalCompositeOperation = 'copy'; c.drawImage(backup, 0, 0); c.globalCompositeOperation = 'source-over'; requestRender(); return; }
      finally { el.stage.classList.remove('busy'); }
      l.text = null; markDirty(l); (T.filters = T.filters || {})[id] = { ...vals }; lastFilter = { id, params: { ...vals } };
      pushHistory(f.name.replace('…', '')); renderLayers();
    };
    if (!f.params.length || opts.repeat) return finish();
    const px = backup.width * backup.height, k = px > 1.6e6 ? Math.sqrt(1.6e6 / px) : 1;
    let seq = 0, busy = false, again = false;
    const preview = async () => {
      if (busy) { again = true; return; }
      busy = true; const my = ++seq;
      try { const res = await filterCanvas(id, backup, vals, k); if (my === seq && open) write(res); } catch (e) { toast('Filter failed: ' + e.message, 'error'); }
      busy = false; if (again) { again = false; preview(); }
    };
    const body = h('<div class="stack"></div>');
    const ctrls = {};
    for (const q of f.params) {
      if (q.options) {
        const s = selectField(q.label, q.options.map(([v, n]) => [String(v), n]), String(vals[q.key]));
        s.select.addEventListener('change', () => { vals[q.key] = Number(s.get()); preview(); }); body.appendChild(s); ctrls[q.key] = s;
      } else {
        const s = slider({ label: q.label, min: q.min, max: q.max, step: q.step || 1, value: vals[q.key], unit: q.unit && q.unit !== 'levels' ? (q.unit === 'px' ? ' px' : q.unit) : '' });
        s.input.addEventListener('input', () => { vals[q.key] = s.get(); preview(); }); body.appendChild(s); ctrls[q.key] = s;
      }
    }
    const hasCenter = f.params.some(q => q.key === 'cx');
    body.appendChild(h(`<p class="hint">${hasCenter ? 'Click the image to set the centre. ' : ''}Previews live on the canvas${sel ? ', inside the selection' : ''}${k < 1 ? ' (at reduced size while you adjust; Apply renders full size)' : ''}.</p>`));
    let open = true, applied = false;
    if (hasCenter) canvasPick = q => {
      vals.cx = clamp(Math.round((q.x - l.x) / backup.width * 100), 0, 100); vals.cy = clamp(Math.round((q.y - l.y) / backup.height * 100), 0, 100);
      ctrls.cx && ctrls.cx.set(vals.cx); ctrls.cy && ctrls.cy.set(vals.cy); preview();
    };
    preview();
    modal({ title: f.name.replace('…', ''), body, width: 340, side: true, actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Apply', kind: 'primary', onClick: () => { applied = true; } },
    ], onClose: () => {
      open = false; canvasPick = null; seq++;
      if (applied) return finish();
      const c = O.cx(l.canvas); c.globalCompositeOperation = 'copy'; c.drawImage(backup, 0, 0); c.globalCompositeOperation = 'source-over'; markDirty(l); requestRender();
    } });
  }
  let canvasPick = null;

  // ---------- image-level operations ----------
  function transformDoc(kind) {
    if (!doc) return;
    commitAdjust();
    const W = doc.width, H = doc.height;
    for (const l of doc.layers) {
      const w = l.canvas.width, hh = l.canvas.height;
      if (kind === 'cw') { l.canvas = O.rotate90(l.canvas, true); if (l.mask) l.mask = O.rotate90(l.mask, true); [l.x, l.y] = [H - (l.y + hh), l.x]; }
      if (kind === 'ccw') { l.canvas = O.rotate90(l.canvas, false); if (l.mask) l.mask = O.rotate90(l.mask, false); [l.x, l.y] = [l.y, W - (l.x + w)]; }
      if (kind === '180') { l.canvas = O.rotate180(l.canvas); if (l.mask) l.mask = O.rotate180(l.mask); [l.x, l.y] = [W - (l.x + w), H - (l.y + hh)]; }
      if (kind === 'fh') { l.canvas = O.flip(l.canvas, true); if (l.mask) l.mask = O.flip(l.mask, true); l.x = W - (l.x + w); }
      if (kind === 'fv') { l.canvas = O.flip(l.canvas, false); if (l.mask) l.mask = O.flip(l.mask, false); l.y = H - (l.y + hh); }
      l.text = null; markDirty(l); markMask(l);
    }
    let sel = doc.selection;
    if (sel) sel = kind === 'cw' ? O.rotate90(sel, true) : kind === 'ccw' ? O.rotate90(sel, false) : kind === '180' ? O.rotate180(sel) : O.flip(sel, kind === 'fh');
    if (kind === 'cw' || kind === 'ccw') { doc.width = H; doc.height = W; resizeSurfaces(); }
    setSelection(sel);
    pushHistory({ cw: 'Rotate 90° clockwise', ccw: 'Rotate 90° counter-clockwise', '180': 'Rotate 180°', fh: 'Flip horizontal', fv: 'Flip vertical' }[kind]);
    refreshAll();
  }
  function resizeImageDialog() {
    if (!doc) return;
    const w = numberField('Width', doc.width, { min: 1, suffix: 'px' }), hh = numberField('Height', doc.height, { min: 1, suffix: 'px' });
    const lock = checkField('Keep proportions', true);
    const ratio = doc.width / doc.height;
    w.input.addEventListener('input', () => { if (lock.get()) hh.set(Math.max(1, Math.round(w.get() / ratio))); });
    hh.input.addEventListener('input', () => { if (lock.get()) w.set(Math.max(1, Math.round(hh.get() * ratio))); });
    const body = h('<div class="stack"><div class="row"></div></div>'); $('.row', body).append(w, hh); body.append(lock);
    modal({ title: 'Resize image', body, width: 380, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Resize', kind: 'primary', onClick: () => {
      const nw = Math.round(w.get()), nh = Math.round(hh.get());
      if (!(nw > 0 && nh > 0) || (nw === doc.width && nh === doc.height)) return;
      commitAdjust();
      const sx = nw / doc.width, sy = nh / doc.height;
      for (const l of doc.layers) {
        l.canvas = O.scaled(l.canvas, Math.max(1, Math.round(l.canvas.width * sx)), Math.max(1, Math.round(l.canvas.height * sy)));
        if (l.mask) l.mask = O.scaled(l.mask, l.canvas.width, l.canvas.height);
        l.x = Math.round(l.x * sx); l.y = Math.round(l.y * sy);
        if (l.text) { l.text.size = Math.round(l.text.size * sy); }
        markDirty(l); markMask(l);
      }
      const sel = doc.selection ? O.scaled(doc.selection, nw, nh) : null;
      doc.width = nw; doc.height = nh; resizeSurfaces(); setSelection(sel);
      pushHistory('Resize image'); refreshAll();
    } }] });
  }
  function canvasSizeDialog() {
    if (!doc) return;
    const w = numberField('Width', doc.width, { min: 1, suffix: 'px' }), hh = numberField('Height', doc.height, { min: 1, suffix: 'px' });
    let anchor = 4;
    const grid = h(`<div class="field"><span>Anchor</span><div class="anchor-grid">${Array.from({ length: 9 }, (_, i) => `<button data-i="${i}" class="${i === anchor ? 'on' : ''}" aria-label="Anchor ${i + 1}"></button>`).join('')}</div></div>`);
    $$('button', grid).forEach(b => b.addEventListener('click', () => { anchor = Number(b.dataset.i); $$('button', grid).forEach(x => x.classList.toggle('on', x === b)); }));
    const body = h('<div class="stack"><div class="row"></div></div>'); $('.row', body).append(w, hh); body.append(grid);
    modal({ title: 'Canvas size', body, width: 380, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Apply', kind: 'primary', onClick: () => {
      const nw = Math.round(w.get()), nh = Math.round(hh.get());
      if (!(nw > 0 && nh > 0)) return;
      expandCanvas(nw, nh, [0, 0.5, 1][anchor % 3], [0, 0.5, 1][Math.floor(anchor / 3)]);
      pushHistory('Canvas size'); refreshAll();
    } }] });
  }
  function expandCanvas(nw, nh, ax, ay, exact) {
    commitAdjust();
    const dx = exact ? exact.dx : Math.round((nw - doc.width) * ax), dy = exact ? exact.dy : Math.round((nh - doc.height) * ay);
    doc.layers.forEach(l => { l.x += dx; l.y += dy; });
    let sel = null;
    if (doc.selection) { sel = O.mk(nw, nh); O.cx(sel).drawImage(doc.selection, dx, dy); }
    doc.width = nw; doc.height = nh; resizeSurfaces(); setSelection(sel);
  }

  // ---------- frames ----------
  const FRAME_STYLES = [
    { id: 'border', label: 'Border', svg: '<rect x="3" y="3" width="24" height="24" fill="none" stroke="currentColor" stroke-width="4"/>' },
    { id: 'rounded', label: 'Rounded', svg: '<path fill="currentColor" fill-rule="evenodd" d="M1 1h28v28H1z M5 11a6 6 0 016-6h8a6 6 0 016 6v8a6 6 0 01-6 6h-8a6 6 0 01-6-6z"/>' },
    { id: 'polaroid', label: 'Polaroid', svg: '<path fill="currentColor" fill-rule="evenodd" d="M3 1h24v28H3z M6 4h18v17H6z"/>' },
    { id: 'double', label: 'Double', svg: '<rect x="2.5" y="2.5" width="25" height="25" fill="none" stroke="currentColor" stroke-width="3"/><rect x="7" y="7" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1"/>' },
    { id: 'film', label: 'Film', svg: '<path fill="currentColor" fill-rule="evenodd" d="M1 4h28v22H1z M2 8h26v14H2z"/><g fill="var(--black)"><rect x="3" y="5" width="2.5" height="2"/><rect x="9" y="5" width="2.5" height="2"/><rect x="15" y="5" width="2.5" height="2"/><rect x="21" y="5" width="2.5" height="2"/><rect x="3" y="23" width="2.5" height="2"/><rect x="9" y="23" width="2.5" height="2"/><rect x="15" y="23" width="2.5" height="2"/><rect x="21" y="23" width="2.5" height="2"/></g>' },
    { id: 'mat', label: 'Mat', svg: '<path fill="currentColor" fill-rule="evenodd" opacity=".75" d="M1 1h28v28H1z M7 7h16v16H7z"/><path d="M7 23V7h16" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".9"/>' },
  ];
  let frameStyle = 'border', frameColor = '#ffffff', frameSize = 4, frameGrow = true;
  function applyFrame() {
    if (!doc) return;
    commitAdjust();
    const T0 = Math.max(2, Math.round(Math.min(doc.width, doc.height) * frameSize / 100));
    if (frameGrow) {
      let l = T0, r = T0, t = T0, b = T0;
      if (frameStyle === 'polaroid') b = Math.round(T0 * 3.5);
      if (frameStyle === 'film') { l = r = Math.round(T0 * 0.6); t = b = Math.round(T0 * 1.6); }
      expandCanvas(doc.width + l + r, doc.height + t + b, 0, 0, { dx: l, dy: t });
    }
    const f = O.drawFrame(frameStyle, doc.width, doc.height, T0, frameColor, { l: 0, t: 0, r: 0, b: frameStyle === 'polaroid' ? Math.round(T0 * 3.5) : T0 });
    const layer = newLayer(f, `Frame (${FRAME_STYLES.find(s => s.id === frameStyle).label.toLowerCase()})`);
    doc.layers.push(layer); doc.activeId = layer.id;
    pushHistory('Add frame'); refreshAll();
  }

  // ---------- open / save / export ----------
  const imageFilters = () => [{ name: 'Images & RO3 projects', extensions: [...FORMATS.IMAGE_IN, 'ora', 'ro3'] }, { name: 'RO3 project', extensions: ['ro3'] }];
  async function openDialog(asLayer) {
    const paths = await ro3.openDialog({ title: asLayer ? 'Place image as layer' : 'Open image', multi: asLayer, filters: imageFilters() });
    for (const p of paths) await openPath(p, asLayer);
  }
  async function openPath(p, asLayer) {
    try {
      if (/\.ro3$/i.test(p)) return loadProject(p);
      if (!asLayer && doc && doc.dirty && !(await confirmBox('Replace the open image?', 'Unsaved changes to the current image will be lost. Use Place to add it as a layer instead.', 'Open anyway', 'danger'))) return;
      if (/\.ora$/i.test(p) && !asLayer) {
        const r = await ro3.oraRead(p), layers = [];
        for (const s of r.layers) {
          const url = URL.createObjectURL(new Blob([s.png], { type: 'image/png' }));
          const c = O.fromImage(await O.loadImage(url)); URL.revokeObjectURL(url);
          const l = newLayer(c, s.name || 'Layer', s.x || 0, s.y || 0); l.opacity = s.opacity ?? 1; l.visible = s.visible !== false; l.blend = s.blend || 'source-over'; layers.push(l);
        }
        openLayers(r.width, r.height, stripExt(baseName(p)), layers);
        doc.path = p; ro3.addRecent(p); refreshAll(); toast(`Opened ${layers.length} layer${layers.length === 1 ? '' : 's'} from OpenRaster.`, 'ok');
        return;
      }
      if (/\.psd$/i.test(p) && !asLayer) {
        const r = await PhotoPSD.load(p, newLayer);
        openLayers(r.width, r.height, stripExt(baseName(p)), r.layers, null, r.groups);
        doc.path = p; ro3.addRecent(p); refreshAll();
        if (r.notes.length) toast(`Opened with ${r.layers.length} layers. Not supported here: ${r.notes.join(', ')}.`, 'info', 7000);
        return;
      }
      const r = await ro3.decodeImage(p);
      const img = await O.loadImage(r.dataUrl);
      const c = O.fromImage(img);
      const name = baseName(p);
      if (asLayer && doc) {
        commitAdjust();
        const l = newLayer(c, stripExt(name), Math.round((doc.width - c.width) / 2), Math.round((doc.height - c.height) / 2));
        insertLayer(l); pushHistory('Place image'); refreshAll();
      } else {
        createDoc(c.width, c.height, stripExt(name), newLayer(c, 'Background'));
        doc.path = p; ro3.addRecent(p);
      }
    } catch (e) { toast(e.message, 'error', 6000); }
  }
  function newDocDialog() {
    const presets = [['1920x1080', 'HD 1920 × 1080'], ['3840x2160', '4K 3840 × 2160'], ['1080x1080', 'Square 1080 × 1080'], ['1080x1350', 'Portrait 1080 × 1350'], ['1080x1920', 'Story 1080 × 1920'], ['2480x3508', 'A4 at 300 dpi'], ['custom', 'Custom']];
    const pre = selectField('Preset', presets, '1920x1080');
    const w = numberField('Width', 1920, { min: 1, max: 16000, suffix: 'px' }), hh = numberField('Height', 1080, { min: 1, max: 16000, suffix: 'px' });
    const bgSel = selectField('Background', [['white', 'White'], ['black', 'Black'], ['transparent', 'Transparent'], ['fg', 'Foreground color']], 'white');
    pre.select.addEventListener('change', () => { const v = pre.get(); if (v !== 'custom') { const [a, b] = v.split('x').map(Number); w.set(a); hh.set(b); } });
    [w, hh].forEach(f => f.input.addEventListener('input', () => { pre.select.value = 'custom'; }));
    const body = h('<div class="stack"></div>'); body.append(pre); const row = h('<div class="row"></div>'); row.append(w, hh); body.append(row, bgSel);
    modal({ title: 'New image', body, width: 400, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Create', kind: 'primary', onClick: async () => {
      if (doc && doc.dirty && !(await confirmBox('Discard the open image?', 'Unsaved changes will be lost.', 'Discard', 'danger'))) return false;
      const W = clamp(Math.round(w.get()), 1, 16000), H = clamp(Math.round(hh.get()), 1, 16000);
      const c = O.mk(W, H), b = bgSel.get();
      if (b !== 'transparent') { const x = O.cx(c); x.fillStyle = b === 'white' ? '#fff' : b === 'black' ? '#000' : fg; x.fillRect(0, 0, W, H); }
      createDoc(W, H, 'Untitled', newLayer(c, 'Background'));
    } }] });
  }
  function projectData() {
    const luts = {};
    for (const l of doc.layers) { const k = l.adj && l.adj.lut && l.adj.lut.key; if (k && PhotoAdjust.LUTS.has(k)) luts[k] = { name: PhotoAdjust.LUTS.get(k).name, text: PhotoAdjust.LUTS.get(k).text }; }
    return { app: 'RO3', version: 2, width: doc.width, height: doc.height, activeId: doc.activeId, guides: doc.guides || [], groups: doc.groups || {}, luts,
      layers: doc.layers.map(l => ({ id: l.id, name: l.name, x: l.x, y: l.y, opacity: l.opacity, blend: l.blend, visible: l.visible, maskOn: l.maskOn, text: l.text,
        type: l.type || 'pixel', adj: l.adj, fx: l.fx, clip: !!l.clip, locked: !!l.locked, group: l.group || null,
        png: isAdj(l) ? null : l.canvas.toDataURL('image/png'), mask: l.mask ? l.mask.toDataURL('image/png') : null })) };
  }
  /** Save. Uses the known .ro3 path unless `as` is set or the image came from elsewhere. PSD saves go through Export. */
  async function saveProject(as = false) {
    if (!doc) return;
    commitAdjust();
    let out = !as && doc.projectPath;
    if (!out) out = await ro3.saveDialog({ title: 'Save RO3 project', defaultPath: (doc.name || 'Untitled') + '.ro3', filters: [{ name: 'RO3 project', extensions: ['ro3'] }, { name: 'Photoshop (layers kept)', extensions: ['psd'] }] });
    if (!out) return;
    try {
      if (/\.psd$/i.test(out)) { await PhotoPSD.save(out, doc, el.composite, { bake: bakeAdjustForPsd }); }
      else { await ro3.writeText(out, JSON.stringify(projectData())); doc.projectPath = out; }
      doc.dirty = false; doc.name = stripExt(baseName(out));
      ro3.addRecent && ro3.addRecent(out);
      clearAutosave();
      toast(`Saved ${baseName(out)}.`, 'ok');
    } catch (e) { toast('Could not save: ' + e.message, 'error', 7000); }
  }
  /** Replace the document with a ready-made layer stack (used by .ro3 and .psd loaders). */
  function openLayers(w, h, name, layers, activeId, groups) {
    createDoc(w, h, name);
    doc.layers = layers; doc.groups = groups || {}; tidyGroups(); doc.activeId = activeId && layers.some(l => l.id === activeId) ? activeId : (layers[layers.length - 1] || {}).id;
    normalizeAdjustLayers();
    history.stack = []; history.index = -1; pushHistory('Open');
    doc.dirty = false;
  }
  async function loadProject(p, opts = {}) {
    try {
      const j = JSON.parse(opts.text || await ro3.readText(p));
      if (j.app !== 'RO3') throw new Error('This is not an RO3 project file.');
      for (const v of Object.values(j.luts || {})) { try { PhotoAdjust.registerLut(v.text, v.name); } catch (_) {} }
      const layers = [];
      for (const s of j.layers) {
        const canvas = s.png ? O.fromImage(await O.loadImage(s.png)) : O.mk(j.width, j.height);
        const l = newLayer(canvas, s.name, s.x, s.y);
        Object.assign(l, { id: s.id, opacity: s.opacity, blend: s.blend, visible: s.visible, maskOn: s.maskOn ?? true, text: s.text,
          type: s.type || 'pixel', adj: s.adj || null, fx: s.fx || null, clip: !!s.clip, locked: !!s.locked, editMask: s.type === 'adjust', group: s.group || null });
        if (s.mask) l.mask = O.fromImage(await O.loadImage(s.mask));
        layers.push(l);
      }
      openLayers(j.width, j.height, opts.name || stripExt(baseName(p)), layers, j.activeId, j.groups);
      doc.guides = j.guides || [];
      if (!opts.recovered) { doc.projectPath = p; doc.dirty = false; ro3.addRecent && ro3.addRecent(p); }
      else doc.dirty = true;
      refreshAll();
    } catch (e) { toast('Could not open project: ' + e.message, 'error', 6000); }
  }

  function exportDialog() {
    if (!doc) return toast('Open or create an image first.', 'error');
    commitAdjust(); render();
    const fmt = selectField('Format', [...FORMATS.IMAGE_OUT, { ext: 'ora', label: 'OpenRaster (layers for Krita/GIMP)' }], 'png');
    const quality = slider({ label: 'Quality', min: 30, max: 100, value: 90, unit: '%' });
    const w = numberField('Width', doc.width, { min: 1, suffix: 'px' }), hh = numberField('Height', doc.height, { min: 1, suffix: 'px' });
    const ratio = doc.width / doc.height;
    w.input.addEventListener('input', () => hh.set(Math.max(1, Math.round(w.get() / ratio))));
    hh.input.addEventListener('input', () => w.set(Math.max(1, Math.round(hh.get() * ratio))));
    const bgc = h(`<label class="field" style="flex:none"><span>Background</span><input type="color" value="#ffffff"></label>`);
    const sizeRow = h('<div class="row"></div>'); sizeRow.append(w, hh, bgc);
    const mode = selectField('Trace style', [['color', 'Full color'], ['bw', 'Black & white'], ['posterize', 'Posterized grays']], 'color');
    const preset = selectField('Detail', [['logo', 'Logo — clean shapes'], ['balanced', 'Balanced'], ['detailed', 'Detailed']], 'balanced');
    const colors = slider({ label: 'Colors', min: 2, max: 64, value: 16 });
    const thresh = slider({ label: 'Threshold', min: 0, max: 255, value: 128, fmt: v => v === 0 ? 'Auto' : v });
    const fill = h(`<label class="field" style="flex:none"><span>Fill</span><input type="color" value="#000000"></label>`);
    const svgBox = h('<div class="stack"></div>');
    const r1 = h('<div class="row"></div>'); r1.append(mode, preset);
    const r2 = h('<div class="row"></div>'); r2.append(colors, thresh, fill);
    const prev = h(`<div class="trace-preview">Preview shows here</div>`);
    const prevBtn = h(`<button class="btn btn-sm" style="align-self:flex-start">${icon('eye')}Preview trace</button>`);
    svgBox.append(r1, r2, prevBtn, prev);
    const info = h('<p class="hint"></p>');
    const body = h('<div class="stack"></div>'); body.append(fmt, quality, sizeRow, svgBox, info);
    const paint = () => {
      const f = fmt.get();
      quality.style.display = ['jpg', 'webp', 'avif', 'pdf'].includes(f) ? '' : 'none';
      bgc.style.display = ['jpg', 'bmp', 'pdf'].includes(f) ? '' : 'none';
      svgBox.style.display = f === 'svg' ? '' : 'none';
      sizeRow.style.display = f === 'psd' || f === 'ora' ? 'none' : '';
      const m = mode.get();
      colors.style.display = m === 'bw' ? 'none' : ''; thresh.style.display = m === 'bw' ? '' : 'none'; fill.style.display = m === 'color' ? 'none' : '';
      $('.sf-top span', colors).textContent = m === 'posterize' ? 'Gray levels' : 'Colors';
      if (m === 'posterize' && colors.get() > 8) colors.set(4);
      info.textContent = {
        svg: 'Traces the image into vector shapes. Logos, icons and flat art trace best; photos become stylised.',
        psd: 'Keeps layers, groups, masks, blend modes, clipping masks, adjustment layers and layer styles so the file opens editable in Photoshop. Color Lookup and Color Grade layers are flattened.',
        ora: 'OpenRaster keeps each layer with its position, opacity and blend mode — the open layered format used by Krita, GIMP and MyPaint. Masks and styles are baked into the pixels.',
        ico: 'Builds a multi-size Windows/web icon (16–256 px). Square images work best.',
        pdf: 'Single page sized to the image. Transparency is filled with the background color.',
        gif: 'GIF is limited to 256 colors.',
        jpg: 'JPG has no transparency; see-through areas get the background color.',
        bmp: 'BMP has no transparency; see-through areas get the background color.',
      }[f] || '';
    };
    [fmt, mode].forEach(x => x.select.addEventListener('change', paint));
    paint();
    const job = () => {
      const f = fmt.get();
      if (f === 'psd') return { format: 'psd' };
      const j = { format: f, quality: quality.get(), background: $('input', bgc).value };
      if (w.get() !== doc.width || hh.get() !== doc.height) j.resize = { width: Math.round(w.get()), height: Math.round(hh.get()), fit: 'fill' };
      if (f === 'svg') j.trace = { mode: mode.get(), preset: preset.get(), colors: colors.get(), threshold: thresh.get() || null, fill: $('input', fill).value };
      return j;
    };
    prevBtn.addEventListener('click', async () => {
      prev.textContent = 'Tracing…'; prevBtn.disabled = true;
      try {
        const bytes = await O.toBytes(el.composite);
        const j = job(); j.preview = true; j.trace.maxSide = 700; delete j.resize;
        const svg = await ro3.exportImage(bytes, j);
        prev.innerHTML = ''; const img = new Image(); img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))); prev.appendChild(img);
        prev.title = `${fmtBytes(svg.length)} SVG`;
      } catch (e) { prev.textContent = e.message; }
      prevBtn.disabled = false;
    });
    modal({ title: 'Export image', body, width: 520, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Export…', kind: 'primary', onClick: async (close, btn) => {
      const j = job();
      const out = await ro3.saveDialog({ title: 'Export image', defaultPath: (doc.name || 'image') + '.' + j.format, filters: [{ name: j.format.toUpperCase(), extensions: [j.format] }] });
      if (!out) return false;
      btn.disabled = true; btn.textContent = j.format === 'svg' ? 'Tracing…' : 'Exporting…';
      try {
        if (j.format === 'psd') { await PhotoPSD.save(out, doc, el.composite, { bake: bakeAdjustForPsd }); toast(`Exported ${baseName(out)} with ${doc.layers.length} layers`, 'ok'); return; }
        if (j.format === 'ora') {
          const layers = [];
          for (const l of doc.layers) {
            const c = isAdj(l) ? bakeAdjustForPsd(l) : bakeLayer(l);
            layers.push({ name: l.name + (isAdj(l) ? ' (flattened)' : ''), png: await O.toBytes(c), x: isAdj(l) ? 0 : l.x, y: isAdj(l) ? 0 : l.y, opacity: l.opacity, visible: l.visible, blend: PhotoCompose.EXTRA_BLENDS.includes(l.blend) ? 'source-over' : l.blend });
          }
          await ro3.oraWrite(out, { width: doc.width, height: doc.height, layers, merged: await O.toBytes(el.composite) });
          toast(`Exported ${baseName(out)} with ${layers.length} layers (opens in Krita, GIMP and MyPaint)`, 'ok'); return;
        }
        const bytes = await O.toBytes(el.composite);
        const r = await ro3.exportImage(bytes, { ...j, output: out });
        toast(`Exported ${baseName(out)} (${fmtBytes(r.bytes)})`, 'ok');
        doc.lastExport = out;
      } catch (e) { toast(e.message, 'error', 6000); btn.disabled = false; btn.textContent = 'Export…'; return false; }
    } }] });
  }

  // ---------- transform ----------
  function tfPoint(lx, ly, t = tf) {
    const hw = t.w * t.sx / 2, hh = t.h * t.sy / 2, c = Math.cos(t.rot), s = Math.sin(t.rot);
    const x = lx * hw, y = ly * hh;
    return { x: t.cx + x * c - y * s, y: t.cy + x * s + y * c };
  }
  const tfCorners = (t = tf) => t.quad ? t.quad.map(p => ({ ...p })) : [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => tfPoint(a, b, t));
  function inPoly(p, pts) {
    let ins = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) ins = !ins;
    }
    return ins;
  }
  /** Switch the live transform into free-corner mode (distort / perspective / skew). */
  function tfToQuad() { if (tf && !tf.quad) { tf.quad = tfCorners(); renderOptions(); } }
  function toLocal(p, t = tf) {
    const dx = p.x - t.cx, dy = p.y - t.cy, c = Math.cos(-t.rot), s = Math.sin(-t.rot);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }
  function tfRotHandle(t = tf) {
    const top = tfPoint(0, -1, t), sg = Math.sign(t.sy) || 1, d = 30 / view.zoom;
    return { x: top.x + Math.sin(t.rot) * sg * d, y: top.y - Math.cos(t.rot) * sg * d };
  }
  function insideTf(p, t = tf) {
    if (t.quad) return inPoly(p, t.quad);
    const q = toLocal(p, t);
    return Math.abs(q.x) <= Math.abs(t.w * t.sx) / 2 && Math.abs(q.y) <= Math.abs(t.h * t.sy) / 2;
  }
  const TF_HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  function tfHit(p) {
    const hs = 9 / view.zoom;
    if (tf.quad) {
      const ci = tf.quad.findIndex(q => Math.hypot(q.x - p.x, q.y - p.y) < hs);
      if (ci >= 0) return { type: 'corner', i: ci };
      for (let i = 0; i < 4; i++) { const a = tf.quad[i], b = tf.quad[(i + 1) % 4]; if (Math.hypot((a.x + b.x) / 2 - p.x, (a.y + b.y) / 2 - p.y) < hs) return { type: 'edge', i }; }
      return insideTf(p) ? { type: 'move' } : { type: 'none' };
    }
    const r = tfRotHandle();
    if (Math.hypot(r.x - p.x, r.y - p.y) < hs) return { type: 'rotate' };
    const h0 = TF_HANDLES.find(([a, b]) => { const q = tfPoint(a, b); return Math.hypot(q.x - p.x, q.y - p.y) < hs; });
    if (h0) return { type: 'scale', hx: h0[0], hy: h0[1] };
    return insideTf(p) ? { type: 'move' } : { type: 'rotate' };
  }

  /** Begin transforming the active layer; with a selection, its pixels are lifted onto their own layer first. */
  function startTransform() {
    const l = active();
    if (!doc || !l) { toast('Select a layer to transform.', 'error'); return false; }
    if (!editable(l, { pixelsOnly: true })) return false;
    if (!l.visible) { toast('This layer is hidden. Show it to transform it.', 'error'); return false; }
    commitAdjust();
    let layer = l, floated = false, src, mask = null, x0, y0;
    if (doc.selection) {
      const piece = O.mk(doc.width, doc.height), pc = O.cx(piece);
      pc.drawImage(l.canvas, l.x, l.y); pc.globalCompositeOperation = 'destination-in'; pc.drawImage(doc.selection, 0, 0);
      const b = O.bounds(piece);
      if (!b) { toast('The selected area of this layer is empty.', 'error'); return false; }
      src = O.mk(b.w, b.h); O.cx(src).drawImage(piece, -b.x, -b.y);
      const c = O.cx(l.canvas); c.globalCompositeOperation = 'destination-out'; c.drawImage(doc.selection, -l.x, -l.y); c.globalCompositeOperation = 'source-over';
      l.text = null; markDirty(l);
      layer = newLayer(O.clone(src), l.name + ' selection', b.x, b.y);
      layer.opacity = l.opacity; layer.blend = l.blend;
      insertLayer(layer, l);
      setSelection(null);
      floated = true; x0 = b.x; y0 = b.y;
    } else {
      const b = O.bounds(l.canvas);
      if (!b) { toast('This layer is empty — nothing to transform.', 'error'); return false; }
      src = O.mk(b.w, b.h); O.cx(src).drawImage(l.canvas, -b.x, -b.y);
      if (l.mask) { mask = O.mk(b.w, b.h); O.cx(mask).drawImage(l.mask, -b.x, -b.y); }
      x0 = l.x + b.x; y0 = l.y + b.y;
    }
    let baked = src;
    if (mask && layer.maskOn) { baked = O.clone(src); const bc = O.cx(baked); bc.globalCompositeOperation = 'destination-in'; bc.drawImage(mask, 0, 0); }
    tf = { layer, src, mask, baked, w: src.width, h: src.height, cx: x0 + src.width / 2, cy: y0 + src.height / 2, sx: 1, sy: 1, rot: 0, floated, x0, y0 };
    refreshAll();
    return true;
  }
  function finishTransform(apply, label) {
    if (!tf) return;
    const t = tf; tf = null; guides = [];
    if (!apply) {
      if (t.floated) restore(history.index); else { requestRender(); refreshAll(); }
      return;
    }
    const moved = Math.round(t.cx - t.w / 2) !== t.x0 || Math.round(t.cy - t.h / 2) !== t.y0 || !!t.quad;
    const shaped = t.sx !== 1 || t.sy !== 1 || Math.abs(t.rot) > 1e-6 || !!t.quad;
    if (!moved && !shaped && !t.floated) { requestRender(); refreshAll(); return; }
    const cs = tfCorners(t);
    const bx = Math.floor(Math.min(...cs.map(p => p.x))), by = Math.floor(Math.min(...cs.map(p => p.y)));
    const bw = Math.max(1, Math.ceil(Math.max(...cs.map(p => p.x))) - bx), bh = Math.max(1, Math.ceil(Math.max(...cs.map(p => p.y))) - by);
    const draw = src => {
      const c = O.mk(bw, bh), x = O.cx(c);
      x.imageSmoothingQuality = 'high';
      if (t.quad) return O.warpQuad(src, t.quad, bw, bh, bx, by, 32);
      if (!shaped) { x.drawImage(src, Math.round(t.cx - t.w / 2) - bx, Math.round(t.cy - t.h / 2) - by); return c; }
      x.translate(t.cx - bx, t.cy - by); x.rotate(t.rot); x.scale(t.sx, t.sy); x.drawImage(src, -t.w / 2, -t.h / 2);
      return c;
    };
    const l = t.layer;
    l.canvas = draw(t.src);
    if (t.mask) { l.mask = draw(t.mask); markMask(l); }
    l.x = bx; l.y = by;
    if (shaped) l.text = null;
    markDirty(l);
    pushHistory(label || (t.floated ? 'Transform selection' : shaped ? 'Transform' : 'Move layer'));
    refreshAll();
  }
  function transformDown(p, e) {
    if (!tf && !startTransform()) return;
    let hit = tfHit(p);
    // Ctrl/Cmd-dragging a corner (or picking a warp mode) switches to free corners
    if (!tf.quad && hit.type === 'scale' && hit.hx && hit.hy && (e.ctrlKey || e.metaKey || T.transform.mode !== 'free')) {
      tfToQuad(); hit = tfHit(p);
    }
    if (hit.type === 'move') return tfMoveDrag(p, e);
    if (hit.type === 'none') return;
    if (hit.type === 'corner' || hit.type === 'edge') {
      const q0 = tf.quad.map(q => ({ ...q })), i = hit.i;
      return track(e, ev => {
        const q = docPoint(ev), dx = q.x - p.x, dy = q.y - p.y, Q = q0.map(o => ({ ...o }));
        const mode = (ev.ctrlKey || ev.metaKey) && ev.altKey && ev.shiftKey ? 'perspective' : (ev.ctrlKey || ev.metaKey) && ev.shiftKey ? 'skew' : T.transform.mode === 'free' ? 'distort' : T.transform.mode;
        if (hit.type === 'edge') {
          // dragging an edge slides it (skew) — or with distort, moves both of its corners
          const a = i, b = (i + 1) % 4, ex = q0[b].x - q0[a].x, ey = q0[b].y - q0[a].y, L = Math.hypot(ex, ey) || 1;
          let mx = dx, my = dy;
          if (mode === 'skew') { const t = (dx * ex + dy * ey) / L; mx = ex / L * t; my = ey / L * t; }
          Q[a].x += mx; Q[a].y += my; Q[b].x += mx; Q[b].y += my;
        } else if (mode === 'perspective') {
          // move the corner and mirror the motion on its neighbour along the dominant axis
          const horiz = Math.abs(dx) >= Math.abs(dy), nb = horiz ? [1, 0, 3, 2][i] : [3, 2, 1, 0][i];
          Q[i].x += dx; Q[i].y += dy;
          if (horiz) Q[nb].x -= dx; else Q[nb].y -= dy;
        } else if (mode === 'skew') {
          if (Math.abs(dx) >= Math.abs(dy)) Q[i].x += dx; else Q[i].y += dy;
        } else { Q[i].x += dx; Q[i].y += dy; }
        tf.quad = Q; tfChanged();
      });
    }
    const t0 = { ...tf };
    if (hit.type === 'rotate') {
      const a0 = Math.atan2(p.y - t0.cy, p.x - t0.cx);
      return track(e, ev => {
        const q = docPoint(ev);
        let r = t0.rot + Math.atan2(q.y - t0.cy, q.x - t0.cx) - a0;
        if (ev.shiftKey) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
        tf.rot = r; tfChanged();
      });
    }
    const { hx, hy } = hit;
    const W0 = t0.w * t0.sx, H0 = t0.h * t0.sy;
    track(e, ev => {
      const q = docPoint(ev);
      const fromCenter = ev.altKey;
      const anchor = fromCenter ? { x: t0.cx, y: t0.cy } : tfPoint(-hx, -hy, t0);
      const c = Math.cos(-t0.rot), s = Math.sin(-t0.rot);
      const vx = q.x - anchor.x, vy = q.y - anchor.y;
      let dx = vx * c - vy * s, dy = vx * s + vy * c;
      if (fromCenter) { dx *= 2; dy *= 2; }
      let nw = hx ? dx * hx : W0, nh = hy ? dy * hy : H0;
      if (hx && hy && !ev.shiftKey) { const f = (dx * hx * W0 + dy * hy * H0) / (W0 * W0 + H0 * H0); nw = W0 * f; nh = H0 * f; }
      if (Math.abs(nw) < 1) nw = Math.sign(nw || 1); if (Math.abs(nh) < 1) nh = Math.sign(nh || 1);
      tf.sx = nw / t0.w; tf.sy = nh / t0.h;
      if (fromCenter) { tf.cx = t0.cx; tf.cy = t0.cy; }
      else {
        const ox = hx ? hx * nw / 2 : 0, oy = hy ? hy * nh / 2 : 0, cc = Math.cos(t0.rot), ss = Math.sin(t0.rot);
        tf.cx = anchor.x + ox * cc - oy * ss; tf.cy = anchor.y + ox * ss + oy * cc;
      }
      tfChanged();
    });
  }
  function tfBox(t = tf) {
    const cs = tfCorners(t), xs = cs.map(p => p.x), ys = cs.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  function tfMoveDrag(p, e, done) {
    const c0 = { x: tf.cx, y: tf.cy }, b0 = tfBox(), q0 = tf.quad && tf.quad.map(q => ({ ...q }));
    track(e, ev => {
      const q = docPoint(ev);
      let dx = q.x - p.x, dy = q.y - p.y;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const sn = (ev.ctrlKey || ev.metaKey) ? { dx: 0, dy: 0, lines: [] } : snapBox({ x: b0.x + dx, y: b0.y + dy, w: b0.w, h: b0.h });
      tf.cx = c0.x + dx + sn.dx; tf.cy = c0.y + dy + sn.dy; guides = sn.lines;
      if (q0) tf.quad = q0.map(q => ({ x: q.x + dx + sn.dx, y: q.y + dy + sn.dy }));
      tfChanged();
    }, () => { guides = []; renderOverlay(); done && done(); });
  }
  function tfChanged() { requestRender(); renderOverlay(); updateTfInputs(); }
  function updateTfInputs() {
    if (!el.tfInputs || !tf) return;
    const { w, hh, a } = el.tfInputs;
    if (document.activeElement !== w) w.value = Math.round(tf.sx * 1000) / 10;
    if (document.activeElement !== hh) hh.value = Math.round(tf.sy * 1000) / 10;
    if (document.activeElement !== a) { let deg = tf.rot * 180 / Math.PI; deg = ((deg + 180) % 360 + 360) % 360 - 180; a.value = Math.round(deg * 10) / 10; }
  }

  // ---------- snapping (edges, centre and the thirds lines) ----------
  function snapBox(box, smart) {
    if (!snapOn || !doc) return { dx: 0, dy: 0, lines: [] };
    const tol = 8 / view.zoom;
    const best = (targets, edges) => {
      let r = null;
      for (const g of targets) for (const e of edges) { const d = g - e; if (Math.abs(d) < tol && (!r || Math.abs(d) < Math.abs(r.d))) r = { d, g }; }
      return r;
    };
    const W = doc.width, H = doc.height;
    const gx = showGuides && doc.guides ? doc.guides.filter(g => g.x != null).map(g => g.x) : [], gy = showGuides && doc.guides ? doc.guides.filter(g => g.y != null).map(g => g.y) : [];
    const sx = smart ? smart.xs : [], sy = smart ? smart.ys : [];
    const bx = best([0, W / 3, W / 2, 2 * W / 3, W, ...gx, ...sx], [box.x, box.x + box.w / 2, box.x + box.w]);
    const by = best([0, H / 3, H / 2, 2 * H / 3, H, ...gy, ...sy], [box.y, box.y + box.h / 2, box.y + box.h]);
    const lines = [];
    if (bx) lines.push({ x: bx.g, smart: sx.includes(bx.g) }); if (by) lines.push({ y: by.g, smart: sy.includes(by.g) });
    return { dx: bx ? bx.d : 0, dy: by ? by.d : 0, lines };
  }

  // ---------- quick selection ----------
  /** Working copy of the image (downscaled for speed) with an edge map, rebuilt when the image changes. */
  let qsCache = null;
  function quickSource() {
    const all = T.quick.sampleAll, l = active();
    const key = (all ? 'all' : (l && l.id)) + ':' + history.index + ':' + doc.width + 'x' + doc.height;
    if (qsCache && qsCache.key === key) return qsCache;
    let src = el.composite;
    if (!all && l && !isAdj(l)) { src = O.mk(doc.width, doc.height); O.cx(src).drawImage(bakeLayer(l), l.x, l.y); }
    else render();
    const k = Math.min(1, 1400 / Math.max(doc.width, doc.height));
    const w = Math.max(1, Math.round(doc.width * k)), hh = Math.max(1, Math.round(doc.height * k));
    const c = O.mk(w, hh), cx = O.cx(c); cx.imageSmoothingQuality = 'high'; cx.drawImage(src, 0, 0, w, hh);
    const d = cx.getImageData(0, 0, w, hh).data, n = w * hh;
    const R = new Uint8ClampedArray(n), G = new Uint8ClampedArray(n), B = new Uint8ClampedArray(n), A = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) { R[i] = d[i * 4]; G[i] = d[i * 4 + 1]; B[i] = d[i * 4 + 2]; A[i] = d[i * 4 + 3]; }
    // Sobel edge strength on all three channels
    const E = new Uint8ClampedArray(n);
    for (let y = 1; y < hh - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      let m = 0;
      for (const C of [R, G, B]) {
        const gx = -C[i - w - 1] - 2 * C[i - 1] - C[i + w - 1] + C[i - w + 1] + 2 * C[i + 1] + C[i + w + 1];
        const gy = -C[i - w - 1] - 2 * C[i - w] - C[i - w + 1] + C[i + w - 1] + 2 * C[i + w] + C[i + w + 1];
        m = Math.max(m, Math.abs(gx) + Math.abs(gy));
      }
      E[i] = Math.min(255, m / 4);
    }
    qsCache = { key, k, w, h: hh, R, G, B, A, E, stamp: new Int32Array(n), stampN: 0, queue: new Int32Array(n) };
    return qsCache;
  }
  function startQuickSelect(p, e) {
    const Q = quickSource(), { k, w, h: hh, R, G, B, A, E } = Q;
    const sub = e.altKey;
    const mode = sub ? 'sub' : (doc.selection && !e.shiftKey && T.quick.fresh === false ? 'add' : doc.selection ? 'add' : 'new');
    const mask = new Uint8Array(w * hh);
    const samples = [];
    const sp = el.selPaint, pc = O.cx(sp);
    pc.clearRect(0, 0, sp.width, sp.height); sp.hidden = false;
    const tint = sub ? [255, 107, 94] : [47, 214, 127];
    const sens = T.quick.sensitivity / 100;
    const colTol = 18 + sens * 70, edgeStop = 30 + sens * 90;
    const dist = (i, s) => { const dr = R[i] - s[0], dg = G[i] - s[1], db = B[i] - s[2], rm = (R[i] + s[0]) / 2; return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db) / 3; };
    let last = null;
    const dab = (q) => {
      const cxp = q.x * k, cyp = q.y * k, r = Math.max(2, T.quick.size * k / 2), Rg = r * 3.2;
      const x0 = Math.max(0, Math.floor(cxp - Rg)), x1 = Math.min(w - 1, Math.ceil(cxp + Rg)), y0 = Math.max(0, Math.floor(cyp - Rg)), y1 = Math.min(hh - 1, Math.ceil(cyp + Rg));
      if (x0 > x1 || y0 > y1) return;
      // colour samples under the brush
      let sr = 0, sg = 0, sb = 0, cnt = 0;
      for (let y = Math.max(0, Math.floor(cyp - r)); y <= Math.min(hh - 1, Math.ceil(cyp + r)); y++) for (let x = Math.max(0, Math.floor(cxp - r)); x <= Math.min(w - 1, Math.ceil(cxp + r)); x++) {
        if ((x - cxp) ** 2 + (y - cyp) ** 2 > r * r) continue;
        const i = y * w + x; sr += R[i]; sg += G[i]; sb += B[i]; cnt++;
      }
      if (!cnt) return;
      samples.push([sr / cnt, sg / cnt, sb / cnt]);
      if (samples.length > 24) samples.splice(1, 1);
      const stamp = ++Q.stampN, st = Q.stamp, qu = Q.queue;
      let qh = 0, qt = 0;
      for (let y = Math.max(0, Math.floor(cyp - r)); y <= Math.min(hh - 1, Math.ceil(cyp + r)); y++) for (let x = Math.max(0, Math.floor(cxp - r)); x <= Math.min(w - 1, Math.ceil(cxp + r)); x++) {
        if ((x - cxp) ** 2 + (y - cyp) ** 2 > r * r) continue;
        const i = y * w + x; st[i] = stamp; mask[i] = 1; qu[qt++] = i;
      }
      while (qh < qt) {
        const i = qu[qh++], x = i % w, y = (i / w) | 0;
        for (const j of [i - 1, i + 1, i - w, i + w]) {
          const jx = j % w, jy = (j / w) | 0;
          if (j < 0 || j >= w * hh || Math.abs(jx - x) > 1 || jx < x0 || jx > x1 || jy < y0 || jy > y1 || st[j] === stamp) continue;
          st[j] = stamp;
          if (A[j] < 10 || E[j] > edgeStop) continue;
          let ok = false;
          for (let s = 0; s < samples.length && !ok; s++) if (dist(j, samples[s]) < colTol) ok = true;
          if (!ok) continue;
          mask[j] = 1; qu[qt++] = j;
        }
      }
      // live overlay of the region found so far (dirty box only)
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1, id = new ImageData(bw, bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (mask[(y + y0) * w + x + x0]) { const o = (y * bw + x) * 4; id.data[o] = tint[0]; id.data[o + 1] = tint[1]; id.data[o + 2] = tint[2]; id.data[o + 3] = 200; }
      const t = O.mk(bw, bh); O.cx(t).putImageData(id, 0, 0);
      pc.clearRect(x0 / k, y0 / k, bw / k, bh / k); pc.imageSmoothingEnabled = false; pc.drawImage(t, x0 / k, y0 / k, bw / k, bh / k);
    };
    const step = Math.max(2, T.quick.size * 0.35);
    const go = q => {
      if (!last) { dab(q); last = q; return; }
      const d = Math.hypot(q.x - last.x, q.y - last.y);
      if (d < step) return;
      for (let s = step; s <= d; s += step) dab({ x: last.x + (q.x - last.x) * s / d, y: last.y + (q.y - last.y) * s / d });
      last = q;
    };
    go(p);
    track(e, ev => { go(docPoint(ev)); moveCursor(ev); }, () => {
      pc.clearRect(0, 0, sp.width, sp.height); sp.hidden = true;
      const id = new ImageData(w, hh);
      for (let i = 0; i < mask.length; i++) if (mask[i]) id.data[i * 4 + 3] = 255;
      const small = O.mk(w, hh); O.cx(small).putImageData(id, 0, 0);
      let shape = O.mk(doc.width, doc.height);
      const sc = O.cx(shape); sc.imageSmoothingQuality = 'high'; sc.drawImage(small, 0, 0, doc.width, doc.height);
      if (T.quick.enhance) shape = selMorph(shape, Math.max(1.2, 1.5 / k), 'smooth');
      combineSelection(shape, mode);
    });
  }

  // ---------- Alt = eyedropper, brush resize gesture ----------
  const ALT_PICK_TOOLS = ['brush', 'fill', 'gradient', 'shape', 'text'];
  function sampleAt(p) {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
    const d = O.cx(el.composite).getImageData(x, y, 1, 1).data;
    return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  /** Hold Alt with a painting tool and click/drag to pick a colour, with a before/after ring like Photoshop. */
  function altPick(p, e) {
    render();
    const before = fg;
    const ring = el.pickRing;
    const show = (ev, q) => {
      const hex = sampleAt(q); if (!hex) return;
      fg = hex; syncColors();
      const r = el.stage.getBoundingClientRect();
      ring.style.display = 'block'; ring.style.left = (ev.clientX - r.left) + 'px'; ring.style.top = (ev.clientY - r.top) + 'px';
      ring.style.setProperty('--new', hex); ring.style.setProperty('--old', before);
    };
    show(e, p);
    track(e, ev => show(ev, docPoint(ev)), () => { ring.style.display = 'none'; addRecentColor(fg); });
  }
  function brushResizeGesture(e) {
    const o = T[tool]; if (!o || !o.size) return false;
    const sx = e.clientX, sy = e.clientY, s0 = o.size, h0 = o.hardness ?? null;
    track(e, ev => {
      o.size = clamp(Math.round(s0 + (ev.clientX - sx) / view.zoom * 2), 1, 1000);
      if (h0 != null) o.hardness = clamp(h0 - (ev.clientY - sy) / 200, 0, 1);
      updateCursor(); const r = el.stage.getBoundingClientRect();
      el.cursor.style.display = 'block'; el.cursor.style.left = (sx - r.left) + 'px'; el.cursor.style.top = (sy - r.top) + 'px';
    }, () => renderOptions());
    return true;
  }

  // ---------- colours: recent + swatches ----------
  const SWATCHES = ['#000000', '#ffffff', '#2fd67f', '#0f3d27', '#7f9488', '#e4ece7', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#30b0ff', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#a2845e', '#8e8e93'];
  let recentColors = [];
  try { recentColors = JSON.parse(localStorage.getItem('ro3.recentColors') || '[]'); } catch (_) {}
  function addRecentColor(c) {
    if (!c) return;
    recentColors = [c, ...recentColors.filter(x => x !== c)].slice(0, 12);
    try { localStorage.setItem('ro3.recentColors', JSON.stringify(recentColors)); } catch (_) {}
    if (sideTab === 'color') renderSideBody();
  }
  function colorPanel() {
    const wrap = h('<div class="ph-adjust color-panel"></div>');
    const row = h(`<div class="row" style="align-items:flex-end"><label class="field" style="flex:none"><span>Foreground</span><input type="color" class="cp-fg" value="${fg}"></label><label class="field"><span>Hex</span><input type="text" class="cp-hex" value="${fg}" spellcheck="false"></label><label class="field" style="flex:none"><span>Background</span><input type="color" class="cp-bg" value="${bg}"></label></div>`);
    $('.cp-fg', row).addEventListener('input', e => { fg = e.target.value; $('.cp-hex', row).value = fg; syncColors(); });
    $('.cp-fg', row).addEventListener('change', () => addRecentColor(fg));
    $('.cp-bg', row).addEventListener('input', e => { bg = e.target.value; syncColors(); });
    $('.cp-hex', row).addEventListener('change', e => { const v = e.target.value.trim(); const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v); if (!m) return toast('Use a hex color like #2fd67f.', 'error'); let x = m[1]; if (x.length === 3) x = x.split('').map(c => c + c).join(''); fg = '#' + x.toLowerCase(); syncColors(); addRecentColor(fg); renderSideBody(); });
    const sw = list => { const g = h('<div class="swatches"></div>'); list.forEach(c => { const b = h(`<button style="background:${c}" title="${c} — click for foreground, Alt-click for background" aria-label="${c}"></button>`); b.addEventListener('click', ev => { if (ev.altKey) bg = c; else { fg = c; addRecentColor(c); } syncColors(); renderSideBody(); }); g.appendChild(b); }); return g; };
    wrap.append(row);
    if (recentColors.length) wrap.append(h('<h4>Recent</h4>'), sw(recentColors));
    wrap.append(h('<h4>Swatches</h4>'), sw(SWATCHES), h('<p class="hint">Hold Alt (Option) with the brush, fill, gradient, shape or text tool and click the image to pick a color.</p>'));
    return wrap;
  }

  // ---------- content-aware fill (PatchMatch in a worker) ----------
  let inpaintWorker = null, inpaintSeq = 0;
  const inpaintJobs = new Map();
  function worker() {
    if (inpaintWorker) return inpaintWorker;
    inpaintWorker = new Worker('js/inpaint-worker.js');
    inpaintWorker.onmessage = e => {
      const j = inpaintJobs.get(e.data.id); if (!j) return;
      if (e.data.progress != null) return j.progress && j.progress(e.data.progress);
      inpaintJobs.delete(e.data.id);
      e.data.error ? j.reject(new Error(e.data.error)) : j.resolve(e.data.data);
    };
    inpaintWorker.onerror = e => { for (const j of inpaintJobs.values()) j.reject(new Error(e.message || 'Fill failed')); inpaintJobs.clear(); inpaintWorker = null; };
    return inpaintWorker;
  }
  /**
   * Fill the opaque area of `hole` (same size as `target`) with surrounding texture.
   * Writes into `target` and resolves true on success.
   */
  async function inpaintInto(target, hole, { margin, onProgress } = {}) {
    const b = O.bounds(hole);
    if (!b) return false;
    const W = target.width, H = target.height, big = Math.max(b.w, b.h);
    let m = margin ?? Math.max(32, Math.round(big * 1.3));
    // keep the work area reasonable (~3 MP)
    while ((b.w + 2 * m) * (b.h + 2 * m) > 3e6 && m > 16) m = Math.round(m * 0.8);
    const rx = Math.max(0, b.x - m), ry = Math.max(0, b.y - m), rw = Math.min(W, b.x + b.w + m) - rx, rh = Math.min(H, b.y + b.h + m) - ry;
    const tid = O.cx(target).getImageData(rx, ry, rw, rh), hid = O.cx(hole).getImageData(rx, ry, rw, rh);
    const alpha = new Uint8Array(rw * rh), hm = new Uint8Array(rw * rh);
    for (let i = 0; i < alpha.length; i++) alpha[i] = hid.data[i * 4 + 3];
    // grow the hole by 2px so the fill replaces the object's fringe too
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      if (alpha[y * rw + x] < 16) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < rw && yy < rh) hm[yy * rw + xx] = 1; }
    }
    const id = ++inpaintSeq;
    const out = await new Promise((resolve, reject) => {
      inpaintJobs.set(id, { resolve, reject, progress: onProgress });
      worker().postMessage({ id, w: rw, h: rh, data: tid.data, hole: hm, opts: { patch: big < 24 ? 2 : 3 } });
    });
    const d = tid.data;
    for (let i = 0; i < hm.length; i++) {
      if (!hm[i]) continue;
      const a = Math.max(alpha[i], 200) / 255; // solid inside, soft only at the grown fringe
      const k = alpha[i] >= 16 ? 1 : a * 0.85;
      for (let c = 0; c < 4; c++) d[i * 4 + c] = d[i * 4 + c] * (1 - k) + out[i * 4 + c] * k;
    }
    O.cx(target).putImageData(tid, rx, ry);
    return true;
  }
  async function contentAwareFill() {
    const l = active();
    if (!doc || !doc.selection) return toast('Select what you want to remove first (any selection tool), then run Content-Aware Fill.', 'error');
    if (!editable(l, { pixelsOnly: true })) return;
    commitAdjust();
    const hole = O.selIn(doc.selection, l.canvas.width, l.canvas.height, l.x, l.y);
    if (!O.bounds(hole)) return toast('The selection doesn\'t overlap this layer.', 'error');
    el.stage.classList.add('busy');
    const pb = progressBox('Content-Aware Fill');
    try {
      const ok = await inpaintInto(l.canvas, hole, { onProgress: p => pb.set(p, 'Matching texture…') });
      pb.close();
      if (!ok) return;
      l.text = null; markDirty(l); requestRender(); pushHistory('Content-Aware Fill'); renderLayers();
      toast('Filled. Ctrl/Cmd+D to deselect, or run it again for a different result.', 'ok', 3500);
    } catch (e) { pb.close(); toast('Content-Aware Fill failed: ' + e.message, 'error', 6000); }
    finally { el.stage.classList.remove('busy'); }
  }

  // ---------- retouching & utility tools ported from PhotoCraft ----------
  let patchUrl = null, patchKey = null;
  /** Data URL of the current selection's outline, used to preview a Patch / Content-Aware Move drag. */
  function patchOutline() {
    if (patchKey === history.index + ':' + (doc.selection && doc.selection.width)) return patchUrl;
    const c = O.mk(doc.width, doc.height), x = O.cx(c); x.drawImage(antsEdge, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = '#ff3dbb'; x.fillRect(0, 0, c.width, c.height);
    patchUrl = c.toDataURL(); patchKey = history.index + ':' + (doc.selection && doc.selection.width); return patchUrl;
  }
  /** Seamless (Poisson) blend: replace `dst` inside mask with `src` but keep dst's boundary colours.
   *  Solves Δh = 0 inside the mask with h = dst − src on its edge (SOR, ω≈1.7) — PhotoCraft algo/src/poisson.rs. */
  function poissonBlend(dst, src, mask, bbox) {
    const W = dst.width, x0 = Math.max(0, bbox.x - 2), y0 = Math.max(0, bbox.y - 2), x1 = Math.min(W, bbox.x + bbox.w + 2), y1 = Math.min(dst.height, bbox.y + bbox.h + 2);
    const w = x1 - x0, hh = y1 - y0; if (w < 3 || hh < 3) return;
    const D = O.cx(dst).getImageData(x0, y0, w, hh), S = O.cx(src).getImageData(x0, y0, w, hh).data, M = O.cx(mask).getImageData(x0, y0, w, hh).data, d = D.data;
    const n = w * hh, inside = new Uint8Array(n), H = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i++) inside[i] = M[i * 4 + 3] > 8 && (i % w) > 0 && (i % w) < w - 1 && i >= w && i < n - w ? 1 : 0;
    for (let i = 0; i < n; i++) if (!inside[i]) for (let c = 0; c < 3; c++) H[c][i] = d[i * 4 + c] - S[i * 4 + c];
    const iters = Math.min(400, 60 + Math.round(Math.sqrt(n) * 1.5)), om = 1.7;
    for (let it = 0; it < iters; it++) for (let i = w; i < n - w; i++) {
      if (!inside[i]) continue;
      for (let c = 0; c < 3; c++) { const Hc = H[c], v = (Hc[i - 1] + Hc[i + 1] + Hc[i - w] + Hc[i + w]) * 0.25; Hc[i] += om * (v - Hc[i]); }
    }
    for (let i = 0; i < n; i++) {
      const a = M[i * 4 + 3] / 255; if (!a) continue;
      for (let c = 0; c < 3; c++) d[i * 4 + c] = d[i * 4 + c] * (1 - a) + (S[i * 4 + c] + H[c][i]) * a;
      d[i * 4 + 3] = Math.max(d[i * 4 + 3], S[i * 4 + 3] * a);
    }
    O.cx(dst).putImageData(D, x0, y0);
  }
  /** Healing brush end of stroke: clone source pixels into the stroke, then Poisson-match them to the surroundings. */
  function finishHealBrush(st) {
    const mask = O.clone(st.stroke);
    if (st.sel) { const mc = O.cx(mask); mc.globalCompositeOperation = 'destination-in'; mc.drawImage(st.sel, 0, 0); }
    const b = O.bounds(mask); if (!b) return false;
    const src = O.mk(st.target.width, st.target.height); O.cx(src).drawImage(st.snap, -st.offset.x, -st.offset.y);
    const out = O.clone(st.snap); poissonBlend(out, src, mask, b);
    const tc = O.cx(st.target); tc.globalCompositeOperation = 'copy'; tc.drawImage(out, 0, 0); tc.globalCompositeOperation = 'source-over';
    return true;
  }
  /** Patch tool: drag a selection to a clean area; that texture is healed into the selection. */
  let patchDraft = null;
  function startPatch(p, e) {
    const l = active(); if (!editable(l, { pixelsOnly: true })) return;
    const inSel = doc.selection && O.cx(doc.selection).getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data[3] > 0;
    if (!inSel) return startLasso(p, e);
    commitAdjust();
    const selC = doc.selection;
    track(e, ev => { const q = docPoint(ev); patchDraft = { dx: q.x - p.x, dy: q.y - p.y }; renderOverlay(); }, () => {
      const d = patchDraft; patchDraft = null; renderOverlay();
      if (!d || Math.hypot(d.dx, d.dy) < 2) return;
      const mask = O.mk(l.canvas.width, l.canvas.height); O.cx(mask).drawImage(selC, -l.x, -l.y);
      const b = O.bounds(mask); if (!b) return;
      const mode = T.patch.mode;
      const src = O.mk(l.canvas.width, l.canvas.height), sc = O.cx(src);
      // Source mode: the selection is the damaged area, healed from where you drop it.
      // Destination mode: the selected pixels are copied to where you drop them, and blended in there.
      if (mode === 'source') { sc.drawImage(l.canvas, -Math.round(d.dx), -Math.round(d.dy)); poissonBlend(l.canvas, src, mask, b); }
      else {
        sc.drawImage(l.canvas, Math.round(d.dx), Math.round(d.dy));
        const m2 = O.mk(mask.width, mask.height); O.cx(m2).drawImage(mask, Math.round(d.dx), Math.round(d.dy));
        poissonBlend(l.canvas, src, m2, { x: b.x + Math.round(d.dx), y: b.y + Math.round(d.dy), w: b.w, h: b.h });
      }
      l.text = null; markDirty(l); pushHistory('Patch'); refreshAll();
    });
  }
  /** Content-Aware Move: drag the selection; the pixels move (or are copied, in Extend mode) and the gap is filled. */
  function startContentMove(p, e) {
    const l = active(); if (!editable(l, { pixelsOnly: true })) return;
    const inSel = doc.selection && O.cx(doc.selection).getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data[3] > 0;
    if (!inSel) return startLasso(p, e);
    commitAdjust();
    const selC = doc.selection;
    track(e, ev => { const q = docPoint(ev); patchDraft = { dx: q.x - p.x, dy: q.y - p.y }; renderOverlay(); }, async () => {
      const d = patchDraft; patchDraft = null; renderOverlay();
      if (!d || Math.hypot(d.dx, d.dy) < 2) return;
      const dx = Math.round(d.dx), dy = Math.round(d.dy);
      const mask = O.mk(l.canvas.width, l.canvas.height); O.cx(mask).drawImage(selC, -l.x, -l.y);
      const piece = O.clone(l.canvas), pc = O.cx(piece); pc.globalCompositeOperation = 'destination-in'; pc.drawImage(mask, 0, 0);
      const hole = O.clone(mask), hc = O.cx(hole); hc.globalCompositeOperation = 'destination-out'; hc.drawImage(mask, dx, dy);
      el.stage.classList.add('busy');
      try {
        if (T.camove.mode === 'move') await inpaintInto(l.canvas, hole, { margin: 48 });
        const lc = O.cx(l.canvas); lc.drawImage(piece, dx, dy);
        const moved = O.mk(doc.width, doc.height); O.cx(moved).drawImage(selC, dx, dy); setSelection(moved);
      } catch (err) { toast('Content-aware move failed: ' + err.message, 'error'); }
      finally { el.stage.classList.remove('busy'); }
      l.text = null; markDirty(l); pushHistory(T.camove.mode === 'move' ? 'Content-aware move' : 'Content-aware extend'); refreshAll();
    });
  }
  /** Red Eye: find the red pupil nearest the click, flood it, and desaturate/darken it (PhotoCraft algo/src/redeye.rs). */
  function redEyeAt(p) {
    const l = active(); if (!editable(l, { pixelsOnly: true })) return;
    commitAdjust();
    const cx0 = Math.round(p.x - l.x), cy0 = Math.round(p.y - l.y), R = clamp(Math.round(4 + 1.2 * T.redeye.pupil), 8, 160);
    const x0 = Math.max(0, cx0 - R), y0 = Math.max(0, cy0 - R), x1 = Math.min(l.canvas.width, cx0 + R), y1 = Math.min(l.canvas.height, cy0 + R);
    const w = x1 - x0, hh = y1 - y0; if (w < 2 || hh < 2) return;
    const img = O.cx(l.canvas).getImageData(x0, y0, w, hh), d = img.data;
    const red = i => { const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255; return r > g + 0.15 && r > b + 0.15 && (0.2126 * r + 0.7152 * g + 0.0722 * b) < 0.92 && Math.max(r, g, b) - Math.min(r, g, b) >= 0.08; };
    let seed = -1, best = 1e9;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (!red(i)) continue; const dd = (x + x0 - cx0) ** 2 + (y + y0 - cy0) ** 2; if (dd < best) { best = dd; seed = y * w + x; } }
    if (seed < 0) return toast('No red eye found there — click right on the red pupil, or raise the pupil size.', 'info');
    const m = new Float32Array(w * hh), stack = [seed]; m[seed] = 1;
    while (stack.length) { const q = stack.pop(), x = q % w, y = (q / w) | 0; for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + ax, ny = y + ay; if (nx < 0 || ny < 0 || nx >= w || ny >= hh) continue; const k = ny * w + nx; if (m[k] || !red(k * 4)) continue; m[k] = 1; stack.push(k); } }
    // soften the mask edge a little
    const s = new Float32Array(m); for (let y = 1; y < hh - 1; y++) for (let x = 1; x < w - 1; x++) { const k = y * w + x; s[k] = (m[k] * 4 + m[k - 1] + m[k + 1] + m[k - w] + m[k + w]) / 8; }
    const dk = T.redeye.darken / 100;
    for (let k = 0; k < w * hh; k++) {
      const t = s[k] * dk; if (!t) continue; const i = k * 4;
      const r = d[i]; d[i] = r + ((d[i + 1] + d[i + 2]) / 2 - r) * Math.min(1, s[k] * 1.2);
      for (let c = 0; c < 3; c++) d[i + c] *= 1 - 0.45 * t;
    }
    O.cx(l.canvas).putImageData(img, x0, y0);
    l.text = null; markDirty(l); pushHistory('Red eye'); renderLayers(); requestRender();
  }
  /** Magic Eraser: erase the colour region under the click (tolerance / contiguous like the wand). */
  function magicEraseAt(p) {
    const l = active(); if (!editable(l, { pixelsOnly: true })) return;
    commitAdjust();
    const lx = p.x - l.x, ly = p.y - l.y;
    if (lx < 0 || ly < 0 || lx >= l.canvas.width || ly >= l.canvas.height) return;
    const region = O.maskToCanvas(O.region(l.canvas, lx, ly, T.magiceraser.tolerance, T.magiceraser.contiguous), l.canvas.width, l.canvas.height);
    const sel = O.selIn(doc.selection, l.canvas.width, l.canvas.height, l.x, l.y);
    const rc = O.cx(region); if (sel) { rc.globalCompositeOperation = 'destination-in'; rc.drawImage(sel, 0, 0); }
    const lc = O.cx(l.canvas); lc.globalAlpha = T.magiceraser.opacity; lc.globalCompositeOperation = 'destination-out'; lc.drawImage(region, 0, 0); lc.globalCompositeOperation = 'source-over'; lc.globalAlpha = 1;
    l.text = null; markDirty(l); pushHistory('Magic eraser'); renderLayers(); requestRender();
  }
  // Color samplers and ruler
  function samplerClick(p) {
    if (!doc) return;
    doc.samplers = doc.samplers || [];
    const hit = doc.samplers.findIndex(s => Math.hypot(s.x - p.x, s.y - p.y) * view.zoom < 8);
    if (hit >= 0) doc.samplers.splice(hit, 1);
    else { if (doc.samplers.length >= 4) doc.samplers.shift(); doc.samplers.push({ x: Math.round(p.x), y: Math.round(p.y) }); }
    renderOverlay(); renderOptions();
  }
  function samplerReadouts() {
    if (!doc || !doc.samplers || !doc.samplers.length) return [];
    render();
    return doc.samplers.map((s, i) => { const d = O.cx(el.composite).getImageData(clamp(s.x, 0, doc.width - 1), clamp(s.y, 0, doc.height - 1), 1, 1).data; return { i: i + 1, r: d[0], g: d[1], b: d[2], hex: '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('') }; });
  }
  let ruler = null;
  function startRuler(p, e) { ruler = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; track(e, ev => { const q = docPoint(ev); let x1 = q.x, y1 = q.y; if (ev.shiftKey) { const a = Math.round(Math.atan2(y1 - p.y, x1 - p.x) / (Math.PI / 4)) * Math.PI / 4, dd = Math.hypot(x1 - p.x, y1 - p.y); x1 = p.x + Math.cos(a) * dd; y1 = p.y + Math.sin(a) * dd; } ruler = { x0: p.x, y0: p.y, x1, y1 }; renderOverlay(); renderOptions(); }); }
  const rulerInfo = () => { if (!ruler) return null; const dx = ruler.x1 - ruler.x0, dy = ruler.y1 - ruler.y0; let a = -Math.atan2(dy, dx) * 180 / Math.PI; return { len: Math.hypot(dx, dy), angle: a, dx, dy }; };
  /** Rotate every layer so the ruler line becomes level (or plumb, whichever is nearer). */
  function straighten() {
    const r = rulerInfo(); if (!r || r.len < 3) return toast('Drag along something that should be level first.', 'info');
    let a = r.angle; while (a > 45) a -= 90; while (a < -45) a += 90;
    const rad = a * Math.PI / 180; commitAdjust();
    const cx0 = doc.width / 2, cy0 = doc.height / 2;
    for (const l of doc.layers) {
      if (isAdj(l)) continue;
      const w = l.canvas.width, hh = l.canvas.height, cw = Math.ceil(Math.abs(w * Math.cos(rad)) + Math.abs(hh * Math.sin(rad))), ch = Math.ceil(Math.abs(w * Math.sin(rad)) + Math.abs(hh * Math.cos(rad)));
      const rot = c => { const o = O.mk(cw, ch), x = O.cx(o); x.imageSmoothingQuality = 'high'; x.translate(cw / 2, ch / 2); x.rotate(rad); x.drawImage(c, -w / 2, -hh / 2); return o; };
      const lcx = l.x + w / 2 - cx0, lcy = l.y + hh / 2 - cy0, nx = lcx * Math.cos(rad) - lcy * Math.sin(rad), ny = lcx * Math.sin(rad) + lcy * Math.cos(rad);
      l.canvas = rot(l.canvas); if (l.mask) l.mask = rot(l.mask);
      l.x = Math.round(cx0 + nx - cw / 2); l.y = Math.round(cy0 + ny - ch / 2); l.text = null; markDirty(l); markMask(l);
    }
    ruler = null; setSelection(null); pushHistory('Straighten'); refreshAll();
    toast(`Rotated ${a.toFixed(1)}°. Crop away the corners with the Crop tool (C).`, 'ok', 4000);
  }
  // Perspective crop: drag four corners over something rectangular, Enter flattens it.
  let pcrop = null;
  function startPerspCrop(p, e) {
    if (pcrop) {
      const i = pcrop.findIndex(q => Math.hypot(q.x - p.x, q.y - p.y) * view.zoom < 10);
      if (i >= 0) return track(e, ev => { const q = docPoint(ev); pcrop[i] = { x: q.x, y: q.y }; renderOverlay(); });
    }
    const p0 = p;
    track(e, ev => { const q = docPoint(ev); pcrop = [{ x: p0.x, y: p0.y }, { x: q.x, y: p0.y }, { x: q.x, y: q.y }, { x: p0.x, y: q.y }]; renderOverlay(); renderOptions(); });
  }
  function applyPerspCrop() {
    if (!pcrop) return;
    const q = pcrop, len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const W = Math.max(2, Math.round((len(q[0], q[1]) + len(q[3], q[2])) / 2)), H = Math.max(2, Math.round((len(q[0], q[3]) + len(q[1], q[2])) / 2));
    commitAdjust();
    const map = O.quadMap(q);
    for (const l of doc.layers) {
      if (isAdj(l)) continue;
      const un = c => {
        const src = O.cx(c).getImageData(0, 0, c.width, c.height), sd = src.data, sw = c.width, sh = c.height, out = new ImageData(W, H), d = out.data;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const s = map((x + 0.5) / W, (y + 0.5) / H), fx = s.x - l.x - 0.5, fy = s.y - l.y - 0.5;
          if (fx < -1 || fy < -1 || fx > sw || fy > sh) continue;
          const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, o = (y * W + x) * 4;
          for (let ch = 0; ch < 4; ch++) {
            const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= sw || yy >= sh) ? 0 : sd[(yy * sw + xx) * 4 + ch];
            d[o + ch] = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
          }
        }
        const oc = O.mk(W, H); O.cx(oc).putImageData(out, 0, 0); return oc;
      };
      l.canvas = un(l.canvas); if (l.mask) l.mask = un(l.mask); l.x = 0; l.y = 0; l.text = null; markDirty(l); markMask(l);
    }
    doc.width = W; doc.height = H; pcrop = null;
    resizeSurfaces(); setSelection(null); pushHistory('Perspective crop'); refreshAll();
  }
  /** Background eraser: erase pixels close to the colour under the brush centre. */
  function bgEraseDab(st, x, y) {
    const r = st.size / 2, o = T.bgeraser, W = st.target.width, H = st.target.height, sd = st.snapData;
    const sx = clamp(Math.round(x), 0, W - 1), sy = clamp(Math.round(y), 0, H - 1);
    if (o.sampling === 'continuous' || !st.sample) { const i = (sy * W + sx) * 4; if (sd[i + 3] > 8) st.sample = [sd[i], sd[i + 1], sd[i + 2]]; }
    if (!st.sample) return;
    const tol = o.tolerance / 100 * 255, x0 = Math.max(0, Math.floor(x - r)), y0 = Math.max(0, Math.floor(y - r)), x1 = Math.min(W, Math.ceil(x + r)), y1 = Math.min(H, Math.ceil(y + r));
    const fg3 = o.protect ? PhotoAdjust.hexRgb(fg) : null;
    let reach = null;
    if (o.limits === 'contiguous') {
      // flood from the centre through matching pixels inside the brush circle
      const bw = x1 - x0, bh = y1 - y0; reach = new Uint8Array(bw * bh);
      const ok = (px, py) => { const i = (py * W + px) * 4; return Math.max(Math.abs(sd[i] - st.sample[0]), Math.abs(sd[i + 1] - st.sample[1]), Math.abs(sd[i + 2] - st.sample[2])) <= tol && (px - x) ** 2 + (py - y) ** 2 <= r * r; };
      if (sx >= x0 && sx < x1 && sy >= y0 && sy < y1 && ok(sx, sy)) { const stack = [(sy - y0) * bw + (sx - x0)]; reach[stack[0]] = 1; while (stack.length) { const k = stack.pop(), px = k % bw, py = (k / bw) | 0; for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = px + ax, ny = py + ay; if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue; const kk = ny * bw + nx; if (reach[kk] || !ok(nx + x0, ny + y0)) continue; reach[kk] = 1; stack.push(kk); } } }
    }
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
      const dd = (px - x) ** 2 + (py - y) ** 2; if (dd > r * r) continue;
      if (reach && !reach[(py - y0) * (x1 - x0) + (px - x0)]) continue;
      const i = (py * W + px) * 4, dist = Math.max(Math.abs(sd[i] - st.sample[0]), Math.abs(sd[i + 1] - st.sample[1]), Math.abs(sd[i + 2] - st.sample[2]));
      if (fg3 && Math.max(Math.abs(sd[i] - fg3[0]), Math.abs(sd[i + 1] - fg3[1]), Math.abs(sd[i + 2] - fg3[2])) < 24) continue;
      const wgt = clamp((tol - dist) / Math.max(1, 0.25 * tol), 0, 1) * 255;
      const k = py * W + px; if (wgt > st.erase[k]) st.erase[k] = wgt;
    }
    st.dirty = st.dirty ? { x0: Math.min(st.dirty.x0, x0), y0: Math.min(st.dirty.y0, y0), x1: Math.max(st.dirty.x1, x1), y1: Math.max(st.dirty.y1, y1) } : { x0, y0, x1, y1 };
  }
  function composeBgErase(st) {
    if (!st.dirty) return;
    const { x0, y0, x1, y1 } = st.dirty, w = x1 - x0, hh = y1 - y0, W = st.target.width;
    const img = O.cx(st.target).getImageData(x0, y0, w, hh), d = img.data, sd = st.snapData;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const k = (y + y0) * W + (x + x0), i = (y * w + x) * 4, a = st.erase[k] / 255;
      let s = 1; if (st.sel) s = st.selData[k * 4 + 3] / 255;
      d[i + 3] = sd[k * 4 + 3] * (1 - a * s);
    }
    O.cx(st.target).putImageData(img, x0, y0); markDirty(st.l); requestRender();
  }

  // ---------- liquify ----------
  // A displacement field over the layer: out(p) = original(p + D(p)). It persists between strokes on the same
  // layer so Reconstruct can relax earlier pushes; switching layer or tool, or any other edit, bakes it in.
  let liq = null;
  function liqSession(l) {
    if (liq && liq.layer === l && liq.rev === l.rev && liq.hist === history.index) return liq;
    const w = l.canvas.width, hh = l.canvas.height, f = Math.max(1, Math.ceil(Math.sqrt(w * hh / 1.5e6)));
    const fw = Math.ceil(w / f) + 1, fh = Math.ceil(hh / f) + 1;
    liq = { layer: l, w, h: hh, f, fw, fh, dx: new Float32Array(fw * fh), dy: new Float32Array(fw * fh),
      orig: O.cx(l.canvas).getImageData(0, 0, w, hh), rev: l.rev, hist: history.index };
    return liq;
  }
  function liqRender(L, x0, y0, x1, y1) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(L.w, Math.ceil(x1)); y1 = Math.min(L.h, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) return;
    const rw = x1 - x0, rh = y1 - y0, out = new ImageData(rw, rh), o = out.data, s = L.orig.data, W = L.w, H = L.h, f = L.f, fw = L.fw;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      // bilinear sample of the field
      const gx = x / f, gy = y / f, ix = Math.floor(gx), iy = Math.floor(gy), tx = gx - ix, ty = gy - iy, k = iy * fw + ix;
      const ddx = (L.dx[k] * (1 - tx) + L.dx[k + 1] * tx) * (1 - ty) + (L.dx[k + fw] * (1 - tx) + L.dx[k + fw + 1] * tx) * ty;
      const ddy = (L.dy[k] * (1 - tx) + L.dy[k + 1] * tx) * (1 - ty) + (L.dy[k + fw] * (1 - tx) + L.dy[k + fw + 1] * tx) * ty;
      const sx = Math.min(W - 1.001, Math.max(0, x + ddx)), sy = Math.min(H - 1.001, Math.max(0, y + ddy));
      const px = Math.floor(sx), py = Math.floor(sy), ax = sx - px, ay = sy - py;
      const i00 = (py * W + px) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4, d = ((y - y0) * rw + (x - x0)) * 4;
      for (let c = 0; c < 4; c++) o[d + c] = (s[i00 + c] * (1 - ax) + s[i10 + c] * ax) * (1 - ay) + (s[i01 + c] * (1 - ax) + s[i11 + c] * ax) * ay;
    }
    O.cx(L.layer.canvas).putImageData(out, x0, y0);
  }
  function startLiquify(p, e) {
    const l = active();
    if (!editable(l, { pixelsOnly: true })) return;
    commitAdjust();
    const L = liqSession(l), o = T.liquify, r = o.size / 2, k = o.pressure / 100;
    let last = { x: p.x - l.x, y: p.y - l.y };
    const apply = (cx, cy, mvx, mvy) => {
      const f = L.f, g0x = Math.max(0, Math.floor((cx - r) / f)), g1x = Math.min(L.fw - 1, Math.ceil((cx + r) / f));
      const g0y = Math.max(0, Math.floor((cy - r) / f)), g1y = Math.min(L.fh - 1, Math.ceil((cy + r) / f));
      for (let gy = g0y; gy <= g1y; gy++) for (let gx = g0x; gx <= g1x; gx++) {
        const x = gx * f, y = gy * f, d = Math.hypot(x - cx, y - cy); if (d >= r) continue;
        const fall = 0.5 + 0.5 * Math.cos(Math.PI * d / r), i = gy * L.fw + gx;
        if (o.mode === 'push') { L.dx[i] -= mvx * fall * k; L.dy[i] -= mvy * fall * k; }
        else if (o.mode === 'bloat') { L.dx[i] -= (x - cx) * fall * k * 0.05; L.dy[i] -= (y - cy) * fall * k * 0.06; }
        else if (o.mode === 'pucker') { L.dx[i] += (x - cx) * fall * k * 0.05; L.dy[i] += (y - cy) * fall * k * 0.06; }
        else if (o.mode === 'twirl') { const a = 0.1 * k * fall * (e.altKey ? -1 : 1); L.dx[i] += -(y - cy) * a; L.dy[i] += (x - cx) * a; }
        else { L.dx[i] *= 1 - 0.25 * k * fall; L.dy[i] *= 1 - 0.25 * k * fall; }
      }
      liqRender(L, cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2);
    };
    const continuous = o.mode !== 'push';
    let timer = null, cur = last;
    if (continuous) { apply(cur.x, cur.y, 0, 0); markDirty(l); requestRender(); timer = setInterval(() => { apply(cur.x, cur.y, 0, 0); markDirty(l); requestRender(); }, 40); }
    track(e, ev => {
      const q = docPoint(ev), c = { x: q.x - l.x, y: q.y - l.y };
      if (continuous) { cur = c; return; }
      const mvx = c.x - last.x, mvy = c.y - last.y, dist = Math.hypot(mvx, mvy);
      if (dist < 1) return;
      const steps = Math.ceil(dist / Math.max(2, r / 6));
      for (let s = 1; s <= steps; s++) apply(last.x + mvx * s / steps, last.y + mvy * s / steps, mvx / steps, mvy / steps);
      last = c; markDirty(l); requestRender();
    }, () => {
      clearInterval(timer); markDirty(l); l.text = null;
      pushHistory('Liquify'); L.rev = l.rev; L.hist = history.index; renderLayers();
    });
  }

  // ---------- Select and Mask ----------
  function refineSelection(base, o) {
    let s = base;
    if (o.smooth > 0) s = selMorph(s, o.smooth, 'smooth');
    if (o.shift > 0) s = selMorph(s, o.shift, 'expand');
    if (o.shift < 0) s = selMorph(s, -o.shift, 'contract');
    if (o.feather > 0) s = selMorph(s, o.feather, 'feather');
    if (o.contrast > 0) {
      const c = O.clone(s), x = O.cx(c), id = x.getImageData(0, 0, c.width, c.height), d = id.data, k = 1 + o.contrast / 10;
      for (let i = 3; i < d.length; i += 4) d[i] = Math.max(0, Math.min(255, (d[i] - 128) * k + 128));
      x.putImageData(id, 0, 0); s = c;
    }
    return s;
  }
  function paintMaskView(sel, view) {
    const sp = el.selPaint, c = O.cx(sp);
    c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, sp.width, sp.height);
    if (view === 'ants') { sp.hidden = true; return; }
    clearInterval(antsTimer); O.cx(el.ants).clearRect(0, 0, el.ants.width, el.ants.height);
    sp.hidden = false; sp.classList.add('solid');
    c.fillStyle = view === 'black' ? '#000' : view === 'white' ? '#fff' : 'rgba(255,40,60,.55)';
    c.fillRect(0, 0, sp.width, sp.height);
    c.globalCompositeOperation = 'destination-out'; c.drawImage(sel, 0, 0);
    c.globalCompositeOperation = 'source-over';
  }
  /** Photoshop-style Select and Mask: refine the current selection with a live view, then output it. */
  function selectAndMask() {
    if (!doc) return;
    if (!doc.selection) return toast('Make a selection first — Quick Selection (W) is the fastest way.', 'error');
    commitAdjust();
    const base = O.clone(doc.selection);
    const o = { smooth: 0, feather: 0, contrast: 0, shift: 0, view: 'overlay', output: 'mask' };
    const body = h('<div class="stack"></div>');
    const viewSel = selectField('View', [['overlay', 'Overlay (red = not selected)'], ['black', 'On black'], ['white', 'On white'], ['ants', 'Marching ants']], o.view);
    const S = (label, key, min, max, unit) => { const s = slider({ label, min, max, value: o[key], unit }); s.input.addEventListener('input', () => { o[key] = s.get(); live(); }); return s; };
    const out = selectField('Output to', [['mask', 'Layer mask'], ['selection', 'Selection'], ['layer', 'New layer'], ['layermask', 'New layer with mask']], o.output);
    body.append(viewSel, S('Smooth', 'smooth', 0, 50, 'px'), S('Feather', 'feather', 0, 100, 'px'), S('Contrast', 'contrast', 0, 100, '%'), S('Shift edge', 'shift', -50, 50, 'px'), out,
      h('<p class="hint">Smooth removes jagged edges, Feather softens them, Contrast firms them up, and Shift Edge grows or shrinks the selection.</p>'));
    let q = null, cur = base;
    const live = () => { clearTimeout(q); q = setTimeout(() => { cur = refineSelection(base, o); paintMaskView(cur, o.view); if (o.view === 'ants') setSelection(cur); }, 50); };
    viewSel.select.addEventListener('change', () => { o.view = viewSel.get(); live(); });
    out.select.addEventListener('change', () => { o.output = out.get(); });
    clearInterval(antsTimer); O.cx(el.ants).clearRect(0, 0, el.ants.width, el.ants.height);
    paintMaskView(cur, o.view);
    let ok = false;
    modal({ title: 'Select and Mask', body, width: 340, side: true, actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'OK', kind: 'primary', onClick: () => { ok = true; } },
    ], onClose: () => {
      clearTimeout(q);
      const sp = el.selPaint; O.cx(sp).clearRect(0, 0, sp.width, sp.height); sp.hidden = true; sp.classList.remove('solid');
      if (!ok) { setSelection(base); return; }
      const final = refineSelection(base, o);
      const l = active();
      if (o.output === 'selection' || !l || isAdj(l)) { setSelection(final); pushHistory('Select and Mask'); return; }
      if (o.output === 'mask') {
        const m = O.mk(l.canvas.width, l.canvas.height); O.cx(m).drawImage(final, -l.x, -l.y);
        l.mask = m; l.maskOn = true; l.editMask = false; markMask(l); setSelection(null); pushHistory('Layer mask from Select and Mask');
      } else {
        const piece = O.mk(doc.width, doc.height), pc = O.cx(piece); pc.drawImage(bakeLayer(l), l.x, l.y);
        const n = newLayer(piece, l.name + ' (cut out)');
        if (o.output === 'layer') { pc.globalCompositeOperation = 'destination-in'; pc.drawImage(final, 0, 0); }
        else { n.mask = O.clone(final); }
        insertLayer(n, l); setSelection(null); pushHistory('Select and Mask to new layer');
      }
      refreshAll();
    } });
  }

  // ---------- polygonal lasso ----------
  let poly = null;
  function polyClick(p, e) {
    if (!poly) { poly = { pts: [p], mode: selModeFrom(e), hover: p }; renderOverlay(); return; }
    const first = poly.pts[0];
    if (poly.pts.length > 2 && Math.hypot(p.x - first.x, p.y - first.y) * view.zoom < 9) return finishPoly();
    poly.pts.push(p); renderOverlay();
  }
  function finishPoly() {
    if (!poly) return;
    const { pts, mode } = poly; poly = null; renderOverlay();
    if (pts.length < 3) return;
    combineSelection(shapeCanvas(c => { c.moveTo(pts[0].x, pts[0].y); pts.forEach(q => c.lineTo(q.x, q.y)); c.closePath(); }), mode);
  }

  // ---------- pen tool & paths ----------
  let pen = null; // { pts: [{x,y,hin,hout}], closed }
  const tracePath = (c, P) => {
    const a = P.pts; if (!a.length) return;
    c.moveTo(a[0].x, a[0].y);
    const seg = (p, q) => c.bezierCurveTo(p.hout ? p.hout.x : p.x, p.hout ? p.hout.y : p.y, q.hin ? q.hin.x : q.x, q.hin ? q.hin.y : q.y, q.x, q.y);
    for (let i = 1; i < a.length; i++) seg(a[i - 1], a[i]);
    if (P.closed && a.length > 2) { seg(a[a.length - 1], a[0]); c.closePath(); }
  };
  const pathD = P => {
    const a = P.pts; if (!a.length) return '';
    let d = `M${a[0].x} ${a[0].y}`;
    const seg = (p, q) => `C${p.hout ? p.hout.x : p.x} ${p.hout ? p.hout.y : p.y} ${q.hin ? q.hin.x : q.x} ${q.hin ? q.hin.y : q.y} ${q.x} ${q.y}`;
    for (let i = 1; i < a.length; i++) d += seg(a[i - 1], a[i]);
    if (P.closed && a.length > 2) d += seg(a[a.length - 1], a[0]) + 'Z';
    return d;
  };
  function penDown(p, e) {
    if (!pen) pen = { pts: [], closed: false };
    const hs = 7 / view.zoom;
    // drag an existing handle
    for (const a of pen.pts) for (const k of ['hin', 'hout']) if (a[k] && Math.hypot(a[k].x - p.x, a[k].y - p.y) < hs) {
      return track(e, ev => {
        const q = docPoint(ev); a[k] = q;
        if (!ev.altKey) { const o = k === 'hin' ? 'hout' : 'hin'; a[o] = { x: 2 * a.x - q.x, y: 2 * a.y - q.y }; }
        renderOverlay();
      });
    }
    // Ctrl/Cmd-drag an anchor to move it; click the first anchor to close
    const hit = pen.pts.findIndex(a => Math.hypot(a.x - p.x, a.y - p.y) < hs);
    if (hit >= 0 && (e.ctrlKey || e.metaKey || pen.closed)) {
      const a = pen.pts[hit], ox = a.x, oy = a.y, hi = a.hin && { ...a.hin }, ho = a.hout && { ...a.hout };
      return track(e, ev => { const q = docPoint(ev), dx = q.x - p.x, dy = q.y - p.y; a.x = ox + dx; a.y = oy + dy; if (hi) a.hin = { x: hi.x + dx, y: hi.y + dy }; if (ho) a.hout = { x: ho.x + dx, y: ho.y + dy }; renderOverlay(); });
    }
    if (hit === 0 && pen.pts.length > 2 && !pen.closed) { pen.closed = true; renderOverlay(); renderOptions(); return; }
    if (pen.closed) { pen = { pts: [], closed: false }; }
    const a = { x: p.x, y: p.y, hin: null, hout: null };
    pen.pts.push(a); renderOverlay(); renderOptions();
    track(e, ev => {
      const q = docPoint(ev);
      if (Math.hypot(q.x - a.x, q.y - a.y) * view.zoom < 3) return;
      a.hout = q; a.hin = { x: 2 * a.x - q.x, y: 2 * a.y - q.y }; renderOverlay();
    });
  }
  function pathToSelection(mode = 'new') {
    if (!pen || pen.pts.length < 2) return toast('Draw a path with the Pen tool first.', 'error');
    const closed = { ...pen, closed: true };
    combineSelection(shapeCanvas(c => tracePath(c, closed)), mode);
  }
  function pathPaint(how) {
    if (!pen || pen.pts.length < 2) return toast('Draw a path with the Pen tool first.', 'error');
    commitAdjust();
    const c = O.mk(doc.width, doc.height), x = O.cx(c);
    x.beginPath(); tracePath(x, how === 'fill' ? { ...pen, closed: true } : pen);
    if (how === 'fill') { x.fillStyle = fg; x.fill(); }
    else { x.strokeStyle = fg; x.lineWidth = Math.max(1, T.brush.size * 0.5); x.lineCap = 'round'; x.lineJoin = 'round'; x.stroke(); }
    const b = O.bounds(c); if (!b) return;
    const piece = O.mk(b.w, b.h); O.cx(piece).drawImage(c, -b.x, -b.y);
    insertLayer(newLayer(piece, how === 'fill' ? 'Path fill' : 'Path stroke', b.x, b.y));
    pushHistory(how === 'fill' ? 'Fill path' : 'Stroke path'); refreshAll();
  }

  // ---------- selection brush ----------
  function startSelBrush(p, e) {
    const o = T.selbrush;
    const mode = e.altKey ? (o.mode === 'add' ? 'sub' : 'add') : o.mode;
    const sp = el.selPaint, pc = O.cx(sp);
    pc.clearRect(0, 0, sp.width, sp.height); sp.hidden = false;
    const stamp = O.stamp(o.size, o.hardness, mode === 'sub' ? '#ff6b5e' : '#2fd67f');
    const spacing = Math.max(1, o.size * 0.15);
    let last = null;
    const dab = q => {
      const pts = [];
      if (!last) pts.push(q);
      else { const dx = q.x - last.x, dy = q.y - last.y, d = Math.hypot(dx, dy); if (d < spacing) return; for (let t = spacing; t <= d; t += spacing) pts.push({ x: last.x + dx * t / d, y: last.y + dy * t / d }); }
      if (!pts.length) return;
      last = pts[pts.length - 1];
      for (const pt of pts) pc.drawImage(stamp, pt.x - o.size / 2, pt.y - o.size / 2);
    };
    dab(p);
    track(e, ev => {
      for (const ce of (ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev])) dab(docPoint(ce));
      moveCursor(ev);
    }, () => {
      const shape = O.clone(sp);
      pc.clearRect(0, 0, sp.width, sp.height); sp.hidden = true;
      combineSelection(shape, mode);
    });
  }

  // ---------- gradient ----------
  function startGradient(p, e) {
    const l = active();
    if (!editable(l)) return;
    commitAdjust();
    const onMask = (l.editMask || isAdj(l)) && l.mask;
    if (!onMask && l.text) l.text = null;
    const target = targetOf(l), snap = O.clone(target);
    const sel = O.selIn(doc.selection, target.width, target.height, l.x, l.y);
    let moved = false;
    track(e, ev => {
      let q = docPoint(ev);
      if (ev.shiftKey) {
        const a = Math.round(Math.atan2(q.y - p.y, q.x - p.x) / (Math.PI / 4)) * (Math.PI / 4), d = Math.hypot(q.x - p.x, q.y - p.y);
        q = { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
      }
      if (Math.hypot(q.x - p.x, q.y - p.y) < 2) return;
      moved = true;
      gradDraft = { x0: p.x, y0: p.y, x1: q.x, y1: q.y };
      const gc = O.mk(target.width, target.height), g = O.cx(gc);
      const x0 = p.x - l.x, y0 = p.y - l.y, x1 = q.x - l.x, y1 = q.y - l.y;
      const grad = T.gradient.type === 'radial' ? g.createRadialGradient(x0, y0, 0, x0, y0, Math.hypot(x1 - x0, y1 - y0)) : g.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, onMask ? 'rgba(0,0,0,1)' : fg);
      grad.addColorStop(1, onMask ? 'rgba(0,0,0,0)' : T.gradient.mode === 'fgbg' ? bg : fg + '00');
      g.fillStyle = grad; g.fillRect(0, 0, gc.width, gc.height);
      const tc = O.cx(target);
      if (onMask) { const res = O.mixMasked(snap, gc, sel); tc.globalCompositeOperation = 'copy'; tc.drawImage(res, 0, 0); markMask(l); }
      else {
        if (sel) { g.globalCompositeOperation = 'destination-in'; g.drawImage(sel, 0, 0); }
        tc.globalCompositeOperation = 'copy'; tc.drawImage(snap, 0, 0);
        tc.globalCompositeOperation = 'source-over'; tc.globalAlpha = T.gradient.opacity; tc.drawImage(gc, 0, 0); tc.globalAlpha = 1;
        markDirty(l);
      }
      tc.globalCompositeOperation = 'source-over';
      requestRender(); renderOverlay();
    }, () => { gradDraft = null; renderOverlay(); if (moved) { pushHistory(onMask ? 'Gradient on mask' : 'Gradient'); renderLayers(); } });
  }

  // ---------- shapes ----------
  function shapeGeom(p, q, shift) {
    const k = T.shape.kind;
    if (shift) {
      if (k === 'line' || k === 'arrow') {
        const a = Math.round(Math.atan2(q.y - p.y, q.x - p.x) / (Math.PI / 4)) * (Math.PI / 4), d = Math.hypot(q.x - p.x, q.y - p.y);
        q = { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
      } else { const m = Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y)); q = { x: p.x + Math.sign(q.x - p.x || 1) * m, y: p.y + Math.sign(q.y - p.y || 1) * m }; }
    }
    return { kind: k, x0: p.x, y0: p.y, x1: q.x, y1: q.y };
  }
  /** Vertices of a polygon / star / triangle inscribed in the drag box (PhotoCraft vector/src/shapes.rs). */
  function polyPoints(d) {
    const o = T.shape, x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0), hh = Math.abs(d.y1 - d.y0);
    if (d.kind === 'triangle') return [[x + w / 2, y], [x + w, y + hh], [x, y + hh]];
    const n = Math.max(3, o.sides || 5), star = d.kind === 'star', cnt = star ? n * 2 : n, inner = (o.inner ?? 50) / 100, pts = [];
    for (let i = 0; i < cnt; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / cnt, r = star && i % 2 ? inner : 1; pts.push([x + w / 2 + Math.cos(a) * w / 2 * r, y + hh / 2 + Math.sin(a) * hh / 2 * r]); }
    return pts;
  }
  function drawShape(ctx, d) {
    const o = T.shape;
    const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0), hh = Math.abs(d.y1 - d.y0);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (d.kind === 'line' || d.kind === 'arrow') {
      const lw = Math.max(1, o.width);
      ctx.strokeStyle = fg; ctx.fillStyle = fg; ctx.lineWidth = lw;
      let ex = d.x1, ey = d.y1;
      const ang = Math.atan2(d.y1 - d.y0, d.x1 - d.x0), head = lw * 3.2;
      if (d.kind === 'arrow') { ex -= Math.cos(ang) * head * 0.8; ey -= Math.sin(ang) * head * 0.8; }
      ctx.beginPath(); ctx.moveTo(d.x0, d.y0); ctx.lineTo(ex, ey); ctx.stroke();
      if (d.kind === 'arrow') {
        ctx.beginPath(); ctx.moveTo(d.x1, d.y1);
        ctx.lineTo(d.x1 - Math.cos(ang - 0.45) * head, d.y1 - Math.sin(ang - 0.45) * head);
        ctx.lineTo(d.x1 - Math.cos(ang + 0.45) * head, d.y1 - Math.sin(ang + 0.45) * head);
        ctx.closePath(); ctx.fill();
      }
      return;
    }
    ctx.beginPath();
    if (d.kind === 'ellipse') ctx.ellipse(x + w / 2, y + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2);
    else if (['polygon', 'star', 'triangle'].includes(d.kind)) { polyPoints(d).forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath(); }
    else ctx.roundRect(x, y, w, hh, Math.min(o.radius, w / 2, hh / 2));
    if (o.fill) { ctx.fillStyle = fg; ctx.fill(); }
    if (o.stroke) { ctx.strokeStyle = bg; ctx.lineWidth = o.width; ctx.stroke(); }
  }
  function startShape(p, e) {
    if (!doc) return;
    commitAdjust();
    if (!T.shape.fill && !T.shape.stroke && !['line', 'arrow'].includes(T.shape.kind)) return toast('Turn on Fill or Outline for this shape.', 'error');
    track(e, ev => { shapeDraft = shapeGeom(p, docPoint(ev), ev.shiftKey); renderOverlay(); }, () => {
      const d = shapeDraft; shapeDraft = null; renderOverlay();
      if (!d || Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 3) return;
      const pad = Math.ceil(T.shape.width * (d.kind === 'arrow' ? 3.5 : 1)) + 2;
      const x0 = Math.floor(Math.min(d.x0, d.x1) - pad), y0 = Math.floor(Math.min(d.y0, d.y1) - pad);
      const c = O.mk(Math.ceil(Math.max(d.x0, d.x1) + pad) - x0, Math.ceil(Math.max(d.y0, d.y1) + pad) - y0), cc = O.cx(c);
      cc.translate(-x0, -y0); drawShape(cc, d);
      const names = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow', triangle: 'Triangle', polygon: 'Polygon', star: 'Star' };
      insertLayer(newLayer(c, names[d.kind], x0, y0));
      pushHistory('Add ' + names[d.kind].toLowerCase()); refreshAll();
    });
  }

  // ---------- clipboard ----------
  async function copyToClipboard(merged, cut) {
    if (!doc) return;
    commitAdjust();
    const l = active();
    if (!merged && !l) return toast('Select a layer to copy from.', 'error');
    const piece = O.mk(doc.width, doc.height), pc = O.cx(piece);
    if (merged) { render(); pc.drawImage(el.composite, 0, 0); } else pc.drawImage(bakeLayer(l), l.x, l.y);
    if (doc.selection) { pc.globalCompositeOperation = 'destination-in'; pc.drawImage(doc.selection, 0, 0); }
    const b = O.bounds(piece);
    if (!b) return toast('Nothing to copy — that area is empty.', 'error');
    const c = O.mk(b.w, b.h); O.cx(c).drawImage(piece, -b.x, -b.y);
    clip = { canvas: c, x: b.x, y: b.y };
    try { await ro3.clipboardWriteImage(await O.toBytes(c)); } catch (_) { /* internal clipboard still works */ }
    if (cut && !merged) {
      if (doc.selection) clearSelectionArea('Cut');
      else { O.cx(l.canvas).clearRect(0, 0, l.canvas.width, l.canvas.height); l.text = null; markDirty(l); pushHistory('Cut'); refreshAll(); }
    }
    toast(cut ? 'Cut — paste puts it on a new layer.' : merged ? 'Copied all visible layers.' : 'Copied — paste puts it on a new layer.', 'ok', 1800);
  }
  async function pasteFromClipboard(asNew) {
    let c = null, x = null, y = null;
    const sys = await ro3.clipboardReadImage().catch(() => null);
    if (sys && clip && clip.canvas.width === sys.width && clip.canvas.height === sys.height) { c = clip.canvas; x = clip.x; y = clip.y; }
    else if (sys) c = O.fromImage(await O.loadImage(sys.dataUrl));
    else if (clip) { c = clip.canvas; x = clip.x; y = clip.y; }
    if (!c) return toast('The clipboard has no image to paste.', 'error');
    c = O.clone(c);
    if (asNew || !doc) {
      if (doc && doc.dirty && !(await confirmBox('Replace the open image?', 'Unsaved changes will be lost. Use Paste (Ctrl/Cmd+V) to add it as a layer instead.', 'Replace', 'danger'))) return;
      createDoc(c.width, c.height, 'Pasted image', newLayer(c, 'Background'));
      return;
    }
    commitAdjust(); finishTransform(true);
    if (x == null || x >= doc.width || y >= doc.height || x + c.width <= 0 || y + c.height <= 0) {
      const r = el.stage.getBoundingClientRect();
      const vc = docPoint({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
      x = Math.round(clamp(vc.x, 0, doc.width) - c.width / 2); y = Math.round(clamp(vc.y, 0, doc.height) - c.height / 2);
    }
    insertLayer(newLayer(c, 'Pasted layer', x, y));
    pushHistory('Paste'); refreshAll();
  }

  // ---------- retouching: dodge / burn / sponge effect sources ----------
  function retouchEffect(src, swap) {
    const id = O.data(src), d = id.data;
    if (tool === 'dodge' || tool === 'burn') {
      const k = T[tool].exposure / 100, lighten = (tool === 'dodge') !== !!swap;
      const a = PhotoAdjust.make('levels');
      a.rgb.gamma = lighten ? 1 + k * 1.4 : 1 / (1 + k * 1.4);
      if (!lighten) a.rgb.outW = 255 - k * 30;
      PhotoAdjust.apply(a, d);
    } else {
      const a = PhotoAdjust.make('huesat');
      a.sat = (T.sponge.mode === 'saturate' ? 1 : -1) * T.sponge.flow;
      PhotoAdjust.apply(a, d);
    }
    const out = O.mk(src.width, src.height); O.cx(out).putImageData(id, 0, 0);
    return out;
  }

  /** Smudge: drag colour along the stroke. */
  function smudgeDab(st, x, y) {
    const s = Math.max(2, Math.round(st.size)), r = s / 2, tc = O.cx(st.target);
    const sx = Math.round(x - r), sy = Math.round(y - r);
    if (!st.carry) { st.carry = O.mk(s, s); O.cx(st.carry).drawImage(st.target, -sx, -sy); return; }
    const t = O.clone(st.carry), c = O.cx(t);
    c.globalCompositeOperation = 'destination-in'; c.drawImage(st.blurStamp, 0, 0);
    if (st.sel) { c.drawImage(st.sel, -sx, -sy); }
    tc.globalAlpha = T.smudge.strength / 100; tc.drawImage(t, sx, sy); tc.globalAlpha = 1;
    const cc = O.cx(st.carry);
    cc.globalAlpha = 1 - T.smudge.strength / 100; cc.drawImage(st.target, -sx, -sy); cc.globalAlpha = 1;
  }

  /** Spot healing: replace the painted area with nearby texture, colour-matched to its surroundings. */
  function healRegion(target, mask, sel) {
    const b = O.bounds(mask);
    if (!b) return false;
    const big = Math.max(b.w, b.h), pad = Math.max(6, Math.round(big * 0.35));
    const W = target.width, H = target.height;
    const rx = Math.max(0, b.x - pad), ry = Math.max(0, b.y - pad);
    const rw = Math.min(W, b.x + b.w + pad) - rx, rh = Math.min(H, b.y + b.h + pad) - ry;
    if (rw < 3 || rh < 3) return false;
    const T0 = O.cx(target).getImageData(0, 0, W, H).data;
    const M = O.cx(mask).getImageData(rx, ry, rw, rh).data;
    const m = new Float32Array(rw * rh);
    for (let i = 0; i < m.length; i++) m[i] = M[i * 4 + 3] / 255;
    if (sel) { const S = O.cx(sel).getImageData(rx, ry, rw, rh).data; for (let i = 0; i < m.length; i++) m[i] *= S[i * 4 + 3] / 255; }
    // ring of known pixels around the spot, sampled sparsely
    const ring = [];
    const step = Math.max(1, Math.round(Math.sqrt(rw * rh / 1600)));
    for (let y = 0; y < rh; y += step) for (let x = 0; x < rw; x += step) if (m[y * rw + x] === 0) ring.push(x, y);
    const at = (x, y) => (y * W + x) * 4;
    let best = null;
    for (const dist of [1.1, 1.6, 2.3, 3.2]) {
      const dd = big * dist + pad * 0.5;
      for (let k = 0; k < 24; k++) {
        const a = k / 24 * Math.PI * 2, dx = Math.round(Math.cos(a) * dd), dy = Math.round(Math.sin(a) * dd);
        if (rx + dx < 0 || ry + dy < 0 || rx + dx + rw > W || ry + dy + rh > H) continue;
        let e = 0;
        for (let i = 0; i < ring.length; i += 2) {
          const p = at(rx + ring[i], ry + ring[i + 1]), q = at(rx + ring[i] + dx, ry + ring[i + 1] + dy);
          const e0 = T0[p] - T0[q], e1 = T0[p + 1] - T0[q + 1], e2 = T0[p + 2] - T0[q + 2], e3 = T0[p + 3] - T0[q + 3];
          e += e0 * e0 + e1 * e1 + e2 * e2 + e3 * e3;
        }
        e *= 1 + dist * 0.08; // mild preference for nearby texture
        if (!best || e < best.e) best = { e, dx, dy };
      }
      if (best && best.e / Math.max(1, ring.length / 2) < 300) break;
    }
    if (!best) return false;
    // colour correction field: diffuse the boundary difference inward (normalised blur)
    const n = rw * rh, D = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)], K = new Float32Array(n);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const i = y * rw + x; if (m[i] > 0) continue;
      const p = at(rx + x, ry + y), q = at(rx + x + best.dx, ry + y + best.dy);
      K[i] = 1; for (let c = 0; c < 4; c++) D[c][i] = T0[p + c] - T0[q + c];
    }
    const rad = Math.max(2, Math.round(big * 0.3));
    const boxBlur = (A) => {
      const tmp = new Float32Array(n);
      for (let pass = 0; pass < 3; pass++) {
        for (let y = 0; y < rh; y++) { let acc = 0; const row = y * rw; for (let x = -rad; x < rw; x++) { if (x + rad < rw) acc += A[row + x + rad]; if (x - rad - 1 >= 0) acc -= A[row + x - rad - 1]; if (x >= 0) tmp[row + x] = acc; } }
        for (let x = 0; x < rw; x++) { let acc = 0; for (let y = -rad; y < rh; y++) { if (y + rad < rh) acc += tmp[(y + rad) * rw + x]; if (y - rad - 1 >= 0) acc -= tmp[(y - rad - 1) * rw + x]; if (y >= 0) A[y * rw + x] = acc; } }
      }
    };
    D.forEach(boxBlur); boxBlur(K);
    const out = O.cx(target).getImageData(rx, ry, rw, rh), od = out.data;
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const i = y * rw + x, w = m[i]; if (w <= 0) continue;
      const q = at(rx + x + best.dx, ry + y + best.dy), k = K[i] > 1e-6 ? 1 / K[i] : 0;
      for (let c = 0; c < 4; c++) { const v = T0[q + c] + D[c][i] * k; od[i * 4 + c] = od[i * 4 + c] * (1 - w) + v * w; }
    }
    O.cx(target).putImageData(out, rx, ry);
    return true;
  }

  // ---------- selection commands ----------
  function selMorph(sel, r, mode) {
    const W = sel.width, H = sel.height, c = O.mk(W, H), x = O.cx(c);
    x.filter = `blur(${Math.max(0.5, mode === 'feather' ? r : r / 2)}px)`; x.drawImage(sel, 0, 0); x.filter = 'none';
    if (mode === 'feather') return c;
    const id = x.getImageData(0, 0, W, H), d = id.data;
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i];
      d[i] = mode === 'expand' ? (a <= 3 ? 0 : a >= 9 ? 255 : (a - 3) * 42) : mode === 'contract' ? (a >= 252 ? 255 : a <= 246 ? 0 : (a - 246) * 42) : (a >= 128 ? 255 : 0);
    }
    x.putImageData(id, 0, 0);
    return c;
  }
  async function modifySelection(mode) {
    if (!doc || !doc.selection) return toast('Make a selection first.', 'error');
    const labels = { expand: 'Expand by', contract: 'Contract by', feather: 'Feather radius', border: 'Border width', smooth: 'Smooth radius' };
    const v = Number(await promptBox(`${mode[0].toUpperCase() + mode.slice(1)} selection`, labels[mode] + ' (px)', mode === 'feather' ? '10' : '5', 'OK'));
    if (!v || v <= 0) return;
    let out;
    if (mode === 'border') {
      out = selMorph(doc.selection, v / 2, 'expand');
      const inner = selMorph(doc.selection, v / 2, 'contract'), c = O.cx(out);
      c.globalCompositeOperation = 'destination-out'; c.drawImage(inner, 0, 0);
    } else out = selMorph(doc.selection, v, mode);
    setSelection(out); pushHistory(`${mode[0].toUpperCase() + mode.slice(1)} selection`);
  }
  function selectLayerPixels(l = active()) {
    if (!l || isAdj(l)) return;
    const s = O.mk(doc.width, doc.height), c = O.cx(s); c.drawImage(bakeLayer(l), l.x, l.y);
    setSelection(s); pushHistory('Select layer pixels');
  }
  function reselect() { if (doc && doc.lastSelection) { setSelection(O.clone(doc.lastSelection)); pushHistory('Reselect'); } }
  function selectionToMask() {
    const l = active();
    if (!l || !doc.selection) return toast('Make a selection, then choose a layer to mask.', 'error');
    if (l.mask && !isAdj(l)) {
      const m = O.mk(l.mask.width, l.mask.height); O.cx(m).drawImage(doc.selection, -l.x, -l.y);
      l.mask = m; markMask(l); l.editMask = true; pushHistory('Mask from selection'); refreshAll();
    } else if (isAdj(l)) { l.mask = O.clone(doc.selection); markMask(l); pushHistory('Mask from selection'); refreshAll(); }
    else addMask();
  }
  function colorRangeDialog() {
    if (!doc) return;
    const before = doc.selection ? O.clone(doc.selection) : null;
    const col = h(`<label class="field" style="flex:none"><span>Color</span><input type="color" value="${fg}"></label>`);
    const fuzz = slider({ label: 'Fuzziness', min: 1, max: 200, value: 40 });
    const src = selectField('Sample from', [['all', 'All visible layers'], ['layer', 'Active layer']], 'all');
    const inv = checkField('Invert', false);
    const row = h('<div class="row" style="align-items:flex-end"></div>'); row.append(col, src);
    const body = h('<div class="stack"></div>'); body.append(row, fuzz, inv, h('<p class="hint">Tip: pick the color with the eyedropper (I) first — it becomes the default here.</p>'));
    let q = false;
    const compute = () => {
      const l = active();
      const base = src.get() === 'layer' && l && !isAdj(l) ? (() => { const c = O.mk(doc.width, doc.height); O.cx(c).drawImage(bakeLayer(l), l.x, l.y); return c; })() : el.composite;
      const d = O.data(base).data, [r0, g0, b0] = PhotoAdjust.hexRgb($('input', col).value), f = fuzz.get(), invert = inv.get();
      const out = O.cx(O.mk(1, 1)).createImageData(doc.width, doc.height), o = out.data;
      for (let i = 0; i < d.length; i += 4) {
        const dr = d[i] - r0, dg = d[i + 1] - g0, db = d[i + 2] - b0;
        let a = d[i + 3] < 8 ? 0 : Math.max(0, 1 - Math.sqrt(dr * dr + dg * dg + db * db) / (f * 1.6));
        if (invert) a = 1 - a;
        o[i + 3] = Math.min(255, a * 255 * 1.4);
      }
      const c = O.mk(doc.width, doc.height); O.cx(c).putImageData(out, 0, 0);
      setSelection(c);
    };
    const live = () => { if (q) return; q = true; setTimeout(() => { q = false; compute(); }, 60); };
    [$('input', col), fuzz.input, src.select, inv.input].forEach(x => x.addEventListener('input', live));
    [src.select, inv.input].forEach(x => x.addEventListener('change', live));
    compute();
    let ok = false;
    modal({ title: 'Select color range', body, width: 400, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'OK', kind: 'primary', onClick: () => { ok = true; } }],
      onClose: () => { if (ok) { compute(); pushHistory('Color range'); } else setSelection(before); } });
  }
  function cropToRect(b, label) {
    if (!b || b.w < 1 || b.h < 1) return;
    crop = { x: Math.max(0, b.x), y: Math.max(0, b.y), w: Math.min(doc.width, b.x + b.w) - Math.max(0, b.x), h: Math.min(doc.height, b.y + b.h) - Math.max(0, b.y) };
    applyCrop(); history.stack[history.index].label = label;
    renderHistory();
  }
  function cropToSelection() { if (!doc || !doc.selection) return toast('Make a selection first.', 'error'); commitAdjust(); cropToRect(O.bounds(doc.selection), 'Crop to selection'); }
  function trimTransparent() { if (!doc) return; commitAdjust(); render(); const b = O.bounds(el.composite); if (!b) return toast('The image is empty.', 'error'); if (b.w === doc.width && b.h === doc.height) return toast('There are no transparent edges to trim.', 'info'); cropToRect(b, 'Trim'); }

  // ---------- rulers & guides ----------
  let showRulers = false, showGuides = true;
  try { showRulers = localStorage.getItem('ro3.rulers') === '1'; } catch (_) {}
  const RULER = 20;
  function drawRulers() {
    if (!el.rulerH) return;
    el.rulerH.hidden = el.rulerV.hidden = el.rulerCorner.hidden = !showRulers || !doc;
    el.stage.classList.toggle('with-rulers', showRulers && !!doc);
    if (!showRulers || !doc) return;
    const r = el.stage.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    const major = steps.find(s => s * view.zoom >= 64) || 5000, minor = major / (major % 5 === 0 ? 5 : 4);
    const paint = (cv, len, horiz) => {
      cv.width = Math.round(len * dpr); cv.height = Math.round(RULER * dpr);
      if (horiz) { cv.style.width = len + 'px'; cv.style.height = RULER + 'px'; } else { cv.style.width = RULER + 'px'; cv.style.height = len + 'px'; cv.width = Math.round(RULER * dpr); cv.height = Math.round(len * dpr); }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#0a0f0c'; g.fillRect(0, 0, horiz ? len : RULER, horiz ? RULER : len);
      g.strokeStyle = '#3a4a40'; g.fillStyle = '#7f9488'; g.font = '10px Manrope, sans-serif'; g.lineWidth = 1;
      const off = horiz ? view.x : view.y, startDoc = Math.floor((-off) / view.zoom / minor) * minor, endDoc = (len - off) / view.zoom;
      g.beginPath();
      for (let v = startDoc; v <= endDoc; v += minor) {
        const p = Math.round(off + v * view.zoom) + 0.5, isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6, t = isMajor ? RULER - 2 : 5;
        if (horiz) { g.moveTo(p, RULER); g.lineTo(p, RULER - t); } else { g.moveTo(RULER, p); g.lineTo(RULER - t, p); }
        if (isMajor) {
          if (horiz) g.fillText(String(Math.round(v)), p + 3, 10);
          else { g.save(); g.translate(10, p + 3); g.rotate(-Math.PI / 2); g.fillText(String(Math.round(v)), -g.measureText(String(Math.round(v))).width - 3, 0); g.restore(); }
        }
      }
      g.stroke();
      g.strokeStyle = '#1b2620'; g.beginPath(); if (horiz) { g.moveTo(0, RULER - 0.5); g.lineTo(len, RULER - 0.5); } else { g.moveTo(RULER - 0.5, 0); g.lineTo(RULER - 0.5, len); } g.stroke();
    };
    paint(el.rulerH, r.width, true); paint(el.rulerV, r.height, false);
  }
  function toggleRulers() { showRulers = !showRulers; try { localStorage.setItem('ro3.rulers', showRulers ? '1' : '0'); } catch (_) {} drawRulers(); }
  function toggleGuides() { showGuides = !showGuides; renderOverlay(); toast(showGuides ? 'Guides shown' : 'Guides hidden', 'info', 1200); }
  function guideNear(e) {
    if (!doc || !doc.guides || !showGuides) return -1;
    const p = docPoint(e), tol = 5 / view.zoom;
    return doc.guides.findIndex(g => g.x != null ? Math.abs(p.x - g.x) < tol : Math.abs(p.y - g.y) < tol);
  }
  /** Drag a guide (existing index, or a new one from a ruler). Dropping it back on a ruler / outside deletes it. */
  function dragGuide(e, idx, axis) {
    if (!doc.guides) doc.guides = [];
    if (idx < 0) { doc.guides.push(axis === 'x' ? { x: docPoint(e).x } : { y: docPoint(e).y }); idx = doc.guides.length - 1; }
    const g = doc.guides[idx];
    showGuides = true;
    const target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
    const mv = ev => {
      const p = docPoint(ev);
      if (g.x != null) g.x = ev.shiftKey ? Math.round(p.x / 10) * 10 : Math.round(p.x); else g.y = ev.shiftKey ? Math.round(p.y / 10) * 10 : Math.round(p.y);
      renderOverlay();
    };
    const up = ev => {
      target.removeEventListener('pointermove', mv); target.removeEventListener('pointerup', up);
      const r = el.stage.getBoundingClientRect();
      const off = ev.clientX < r.left + (showRulers ? RULER : 0) || ev.clientY < r.top + (showRulers ? RULER : 0) || ev.clientX > r.right || ev.clientY > r.bottom;
      if (off) doc.guides.splice(doc.guides.indexOf(g), 1);
      renderOverlay();
    };
    target.addEventListener('pointermove', mv); target.addEventListener('pointerup', up);
  }
  async function newGuideDialog() {
    if (!doc) return;
    const v = await promptBox('New guide', 'Position — e.g. 540 for a vertical guide at x=540, or y:300 for horizontal', '', 'Add');
    if (!v) return;
    const m = /^\s*(y\s*:)?\s*(-?\d+(?:\.\d+)?)\s*(%)?\s*$/i.exec(v);
    if (!m) return toast('Use a number like 540, 50% or y:300.', 'error');
    const horiz = !!m[1], n = Number(m[2]) * (m[3] ? (horiz ? doc.height : doc.width) / 100 : 1);
    (doc.guides = doc.guides || []).push(horiz ? { y: n } : { x: n }); showGuides = true; renderOverlay();
  }

  // ---------- autosave & recovery ----------
  let autosaveTimer = null, lastAutosaveIdx = -1;
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      if (!doc || !doc.dirty || history.index === lastAutosaveIdx || tf || adj) return scheduleAutosave();
      try { await ro3.autosaveWrite('photo.ro3', JSON.stringify({ ...projectData(), name: doc.name, savedAt: Date.now() })); lastAutosaveIdx = history.index; } catch (_) {}
      scheduleAutosave();
    }, 45000);
  }
  function clearAutosave() { lastAutosaveIdx = -1; ro3.autosaveClear('photo.ro3').catch(() => {}); }
  async function recover(text) {
    const j = JSON.parse(text);
    await loadProject(null, { text, recovered: true, name: (j.name || 'Recovered image') });
    toast('Recovered your unsaved image. Save it to keep it.', 'ok', 5000);
  }

  // ---------- UI building ----------
  function init(root) {
    root.innerHTML = '';
    const ws = h(`<div class="ws-photo">
      <div class="ph-rail" role="toolbar" aria-label="Tools"></div>
      <div class="ph-opts"></div>
      <div class="ph-stage" tabindex="0">
        <div class="ph-world"><div class="ph-checker"></div><canvas class="composite"></canvas><canvas class="ants"></canvas><canvas class="selpaint" hidden></canvas><svg class="ph-overlay"></svg></div>
        <div class="ph-cursor"></div>
        <canvas class="ruler ruler-h" hidden></canvas><canvas class="ruler ruler-v" hidden></canvas><div class="ruler-corner" hidden title="Rulers (Ctrl/Cmd+R)"></div>
        <div class="ph-empty"><div class="empty">${icon('photo', 'ico-xl')}<h3>Open an image to start editing</h3>
          <p>Layers, masks, selections, colour and frames. Export to any format, including SVG vectors.</p>
          <div class="row"><button class="btn btn-primary" data-act="open">${icon('open')}Open image</button><button class="btn" data-act="new">${icon('plus')}New blank</button></div>
          <p class="kbd">Or drop an image here, or paste one</p></div></div>
      </div>
      <div class="ph-status"></div>
      <aside class="ph-side panel">
        <div class="section"><div class="sec-tabs" role="tablist"></div><div class="sec-body"></div></div>
        <div class="section grow"><div class="panel-head"><h3>Layers</h3><button class="icon-btn" data-act="layer-menu" aria-label="Layer menu" title="Layer options">${icon('sliders')}</button></div>
          <div class="layers-head"></div><div class="layer-list" role="list"></div><div class="layer-tools"></div></div>
      </aside></div>`);
    root.appendChild(ws);
    el = {
      root: ws, rail: $('.ph-rail', ws), opts: $('.ph-opts', ws), stage: $('.ph-stage', ws), world: $('.ph-world', ws),
      composite: $('canvas.composite', ws), ants: $('canvas.ants', ws), selPaint: $('canvas.selpaint', ws), overlay: $('.ph-overlay', ws), cursor: $('.ph-cursor', ws),
      empty: $('.ph-empty', ws), status: $('.ph-status', ws), secTabs: $('.sec-tabs', ws), secBody: $('.sec-body', ws),
      layersHead: $('.layers-head', ws), layerList: $('.layer-list', ws), layerTools: $('.layer-tools', ws),
    };
    $('[data-act="open"]', ws).addEventListener('click', () => openDialog(false));
    $('[data-act="new"]', ws).addEventListener('click', newDocDialog);
    $('[data-act="layer-menu"]', ws).addEventListener('click', e => layerMenu(e.currentTarget));
    buildRail(); buildSide(); renderOptions(); updateStatus(); renderLayers();

    const st = el.stage;
    st.addEventListener('pointerdown', e => { st.focus({ preventScroll: true }); stagePointerDown(e); });
    st.addEventListener('contextmenu', e => e.preventDefault());
    el.pickRing = h('<div class="pick-ring" aria-hidden="true"><i></i></div>'); st.appendChild(el.pickRing);
    st.addEventListener('pointermove', moveCursor);
    st.addEventListener('pointerleave', () => { el.cursor.style.display = 'none'; });
    st.addEventListener('dblclick', e => { if (tool === 'hand') fitView(); if (tool === 'crop' && crop) applyCrop(); if (tool === 'polylasso' && poly) { poly.pts.pop(); finishPoly(); } });
    st.addEventListener('wheel', e => {
      if (!doc) return;
      e.preventDefault();
      const r = st.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomTo(view.zoom * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
      else { view.x -= e.deltaX; view.y -= e.deltaY; view.userMoved = true; applyView(); }
    }, { passive: false });
    st.addEventListener('dragover', e => { e.preventDefault(); st.classList.add('drop-over'); });
    st.addEventListener('dragleave', () => st.classList.remove('drop-over'));
    st.addEventListener('drop', async e => {
      e.preventDefault(); st.classList.remove('drop-over');
      const paths = Array.from(e.dataTransfer.files).map(f => ro3.pathOf(f)).filter(Boolean);
      for (const p of paths) await openPath(p, !!doc && !/\.ro3$/i.test(p));
    });
    new ResizeObserver(() => { if (doc && !view.userMoved) fitView(); else drawRulers(); }).observe(st);
    el.rulerH = $('.ruler-h', ws); el.rulerV = $('.ruler-v', ws); el.rulerCorner = $('.ruler-corner', ws);
    el.rulerH.addEventListener('pointerdown', e => { if (doc) { e.stopPropagation(); dragGuide(e, -1, 'y'); } });
    el.rulerV.addEventListener('pointerdown', e => { if (doc) { e.stopPropagation(); dragGuide(e, -1, 'x'); } });
    el.rulerCorner.addEventListener('click', newGuideDialog);
    document.addEventListener('paste', onPaste);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; updateCursor(); } if (e.key === 'Alt') { altDown = false; updateCursor(); } });
    document.addEventListener('keydown', e => { if (e.key === 'Alt' && RO3App.active === 'photo' && ALT_PICK_TOOLS.includes(tool)) { e.preventDefault(); altDown = true; updateCursor(); } });
    window.addEventListener('blur', () => { altDown = false; spaceDown = false; });
  }

  function buildRail() {
    el.rail.innerHTML = '';
    const info = id => TOOLS.find(t => t !== 'sep' && t.id === id);
    const keyLabel = t => t.label || t.key.replace('shift+', 'Shift+').replace('alt+', 'Alt+').toUpperCase().replace('SHIFT+', 'Shift+').replace('ALT+', 'Alt+');
    GROUPS.forEach(g => {
      if (g === 'sep') return el.rail.appendChild(h('<div class="sep"></div>'));
      const cur = groupCurrent.get(g[0]) || g[0], t = info(cur);
      const b = h(`<button class="icon-btn ${g.length > 1 ? 'has-group' : ''}" data-group="${g[0]}" data-tool="${cur}" title="${t.name} (${keyLabel(t)})${g.length > 1 ? ' — right-click for more' : ''}" aria-label="${t.name}">${icon(t.icon)}</button>`);
      const flyout = () => menuAt(b, g.map(id => { const x = info(id); return { label: x.name, kbd: keyLabel(x), onClick: () => setTool(id) }; }));
      let hold = null;
      b.addEventListener('pointerdown', () => { if (g.length > 1) hold = setTimeout(() => { hold = 'shown'; flyout(); }, 380); });
      b.addEventListener('pointerup', () => { if (hold !== 'shown') clearTimeout(hold); });
      b.addEventListener('click', () => { if (hold === 'shown') { hold = null; return; } setTool(b.dataset.tool); });
      b.addEventListener('contextmenu', e => { e.preventDefault(); if (g.length > 1) flyout(); });
      el.rail.appendChild(b);
    });
    const colors = h(`<div class="ph-colors" title="Foreground / background (X swaps)"><input type="color" class="fg" aria-label="Foreground color"><input type="color" class="bg" aria-label="Background color"></div>`);
    $('.fg', colors).addEventListener('input', e => { fg = e.target.value; });
    $('.bg', colors).addEventListener('input', e => { bg = e.target.value; });
    el.rail.appendChild(colors);
    el.colors = colors;
    syncColors(); markTool();
  }
  function syncColors() { $('.fg', el.colors).value = fg; $('.bg', el.colors).value = bg; }
  function markTool() {
    const g = groupOf(tool);
    if (g && (groupCurrent.get(g[0]) || g[0]) !== tool) { groupCurrent.set(g[0], tool); buildRail(); return; }
    $$('[data-tool]', el.rail).forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
  }

  function setTool(t) {
    if (tool === 'crop' && t !== 'crop') { crop = null; }
    if (t !== 'polylasso') poly = null;
    if (t !== 'perspcrop') pcrop = null;
    if (tool === 'transform' && t !== 'transform' && tf) finishTransform(true);
    if (t === 'transform' && !tf && doc && !startTransform()) return;
    tool = t; markTool(); renderOptions(); updateCursor(); renderOverlay();
  }

  function optSlider(label, obj, key, min, max, step = 1, fmt) {
    const id = uid('o');
    const o = h(`<label class="opt" for="${id}">${esc(label)} <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${obj[key]}"><output>${fmt ? fmt(obj[key]) : obj[key]}</output></label>`);
    const inp = $('input', o), out = $('output', o);
    const paint = () => { inp.style.setProperty('--p', ((inp.value - min) / (max - min) * 100) + '%'); out.textContent = fmt ? fmt(Number(inp.value)) : inp.value; };
    inp.addEventListener('input', () => { obj[key] = Number(inp.value); paint(); updateCursor(); });
    paint();
    return o;
  }
  function optCheck(label, obj, key) {
    const c = checkField(label, obj[key]); c.classList.add('opt'); c.input.addEventListener('change', () => obj[key] = c.get()); return c;
  }
  function renderOptions() {
    const o = el.opts; o.innerHTML = '';
    const info = TOOLS.find(t => t.id === tool);
    o.appendChild(h(`<span class="tool-name">${esc(info.name)}</span>`));
    const pct = v => Math.round(v * 100) + '%';
    if (tool === 'brush' || tool === 'eraser') {
      o.append(optSlider('Size', T[tool], 'size', 1, 500), optSlider('Hardness', T[tool], 'hardness', 0, 1, 0.01, pct), optSlider('Opacity', T[tool], 'opacity', 0.01, 1, 0.01, pct));
      if (tool === 'brush') o.append(optSlider('Flow', T.brush, 'flow', 0.01, 1, 0.01, pct));
      T[tool].smoothing = T[tool].smoothing || 0;
      o.append(optSlider('Smoothing', T[tool], 'smoothing', 0, 100, 1, v => v + '%'));
      const l = active();
      if (l && l.editMask) o.appendChild(h(`<span class="opt" style="color:var(--green)">Painting on mask — white reveals, black hides</span>`));
    }
    if (tool === 'blur') o.append(optSlider('Size', T.blur, 'size', 4, 400), optSlider('Strength', T.blur, 'strength', 1, 20));
    if (tool === 'polylasso') o.append(h('<span class="opt">Click to add corners. Double-click, Enter or click the first point to close. Backspace removes the last point, Esc cancels. Shift adds, Alt subtracts.</span>'));
    if (tool === 'pen') {
      const sb = (label, fn, kind = 'btn-ghost') => { const b = h(`<button class="btn btn-sm ${kind}">${label}</button>`); b.addEventListener('click', fn); return b; };
      o.append(h(`<span class="opt">${pen && pen.pts.length ? `${pen.pts.length} point${pen.pts.length > 1 ? 's' : ''}${pen.closed ? ' · closed' : ''}` : 'Click for corners, click-drag for curves. Click the first point to close.'}</span>`),
        h('<span class="opt muted">Ctrl/Cmd-drag moves a point · Alt-drag a handle breaks it</span>'), h('<span class="grow"></span>'),
        sb('Make selection', () => pathToSelection()), sb('Fill', () => pathPaint('fill')), sb('Stroke', () => pathPaint('stroke')), sb('Clear', () => { pen = null; renderOverlay(); renderOptions(); }));
    }
    if (tool === 'quick') {
      const sbtn2 = (label, fn, kind = 'btn-ghost') => { const b = h(`<button class="btn btn-sm ${kind}">${label}</button>`); b.addEventListener('click', fn); return b; };
      o.append(optSlider('Size', T.quick, 'size', 4, 300), optSlider('Sensitivity', T.quick, 'sensitivity', 1, 100), optCheck('All layers', T.quick, 'sampleAll'), optCheck('Smooth edges', T.quick, 'enhance'),
        h('<span class="opt">Paint over what you want. Alt subtracts.</span>'), h('<span class="grow"></span>'),
        sbtn2('Select and Mask…', () => selectAndMask(), 'btn'), sbtn2('Deselect', deselect), sbtn2('Invert', invertSelection));
    }
    if (tool === 'fill') o.append(optSlider('Tolerance', T.fill, 'tolerance', 0, 255), optCheck('Contiguous', T.fill, 'contiguous'));
    if (['rect', 'ellipse', 'lasso', 'wand'].includes(tool)) {
      const seg = h(`<div class="seg" role="radiogroup" aria-label="Selection mode">${[['new', 'New'], ['add', 'Add'], ['sub', 'Subtract'], ['int', 'Intersect']].map(([v, l]) => `<button data-v="${v}" class="${T.select.mode === v ? 'on' : ''}">${l}</button>`).join('')}</div>`);
      $$('button', seg).forEach(b => b.addEventListener('click', () => { T.select.mode = b.dataset.v; $$('button', seg).forEach(x => x.classList.toggle('on', x === b)); }));
      o.appendChild(seg);
      if (tool === 'wand') o.append(optSlider('Tolerance', T.wand, 'tolerance', 0, 255), optCheck('Contiguous', T.wand, 'contiguous'), optCheck('All layers', T.wand, 'sampleAll'));
      else o.append(optSlider('Feather', T.select, 'feather', 0, 100, 1, v => v + 'px'));
      o.appendChild(h('<span class="grow"></span>'));
      const btn = (label, fn) => { const b = h(`<button class="btn btn-sm btn-ghost">${label}</button>`); b.addEventListener('click', fn); return b; };
      o.append(btn('All', selectAll), btn('Deselect', deselect), btn('Invert', invertSelection), btn('To new layer', () => selectionToLayer(false)));
    }
    if (tool === 'crop') {
      const ratios = selectField('', [['free', 'Free'], ['orig', 'Original'], ['1:1', '1:1'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['4:5', '4:5'], ['9:16', '9:16']], T.crop.ratio);
      ratios.classList.add('opt'); ratios.querySelector('span').remove(); ratios.select.style.width = '110px';
      ratios.select.addEventListener('change', () => { T.crop.ratio = ratios.get(); });
      o.append(h('<span class="opt">Ratio</span>'), ratios);
      o.appendChild(h(`<span class="opt">${crop ? `${crop.w} × ${crop.h}px` : 'Drag on the image to set the crop'}</span>`));
      o.appendChild(h('<span class="grow"></span>'));
      if (crop) {
        const cancel = h(`<button class="btn btn-sm btn-ghost">Cancel</button>`); cancel.addEventListener('click', () => { crop = null; renderOverlay(); renderOptions(); });
        const ok = h(`<button class="btn btn-sm btn-primary">${icon('check')}Apply crop</button>`); ok.addEventListener('click', applyCrop);
        o.append(cancel, ok);
      }
    }
    const seg = (pairs, obj, key, after) => {
      const g = h(`<div class="seg" role="radiogroup">${pairs.map(([v, l]) => `<button data-v="${v}" class="${obj[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`);
      $$('button', g).forEach(b => b.addEventListener('click', () => { obj[key] = b.dataset.v; $$('button', g).forEach(x => x.classList.toggle('on', x === b)); after && after(); }));
      return g;
    };
    const sbtn = (label, fn, kind = 'btn-ghost') => { const b = h(`<button class="btn btn-sm ${kind}">${label}</button>`); b.addEventListener('click', fn); return b; };
    if (tool === 'transform') {
      el.tfInputs = null;
      if (!tf) o.appendChild(h(`<span class="opt">Drag on the image to transform the active layer${doc && doc.selection ? ' (just the selected pixels)' : ''}.</span>`));
      else {
        const num = (label, suffix) => { const x = h(`<label class="opt">${label} <input class="inline" type="number" step="0.1" style="width:76px;height:26px"> ${suffix}</label>`); return x; };
        const W = num('W', '%'), H = num('H', '%'), A = num('Angle', '°');
        el.tfInputs = { w: $('input', W), hh: $('input', H), a: $('input', A) };
        const lock = checkField('Keep proportions', true); lock.classList.add('opt');
        el.tfInputs.w.addEventListener('change', () => { const v = Number(el.tfInputs.w.value) / 100 || 0.01; if (lock.get()) tf.sy = tf.sy * (v / tf.sx); tf.sx = v; tfChanged(); });
        el.tfInputs.hh.addEventListener('change', () => { const v = Number(el.tfInputs.hh.value) / 100 || 0.01; if (lock.get()) tf.sx = tf.sx * (v / tf.sy); tf.sy = v; tfChanged(); });
        el.tfInputs.a.addEventListener('change', () => { tf.rot = (Number(el.tfInputs.a.value) || 0) * Math.PI / 180; tfChanged(); });
        const modeSeg = h(`<div class="seg opt" role="radiogroup" aria-label="Transform mode">${[['free', 'Free'], ['distort', 'Distort'], ['perspective', 'Perspective'], ['skew', 'Skew']].map(([v, l]) => `<button data-v="${v}" class="${T.transform.mode === v ? 'on' : ''}">${l}</button>`).join('')}</div>`);
        modeSeg.addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; T.transform.mode = b.dataset.v; if (b.dataset.v !== 'free') tfToQuad(); renderOptions(); renderOverlay(); });
        if (tf.quad) {
          o.append(modeSeg, h('<span class="opt muted">Drag corners. Ctrl/Cmd+Shift = skew, Ctrl/Cmd+Alt+Shift = perspective.</span>'), h('<span class="grow"></span>'),
            sbtn('Reset', () => { tf.quad = null; T.transform.mode = 'free'; Object.assign(tf, { sx: 1, sy: 1, rot: 0, cx: tf.x0 + tf.w / 2, cy: tf.y0 + tf.h / 2 }); tfChanged(); renderOptions(); }),
            sbtn('Cancel', () => { finishTransform(false); setTool('move'); }),
            sbtn(`${icon('check')}Apply`, () => { finishTransform(true); setTool('move'); }, 'btn-primary'));
          el.tfInputs = null;
        } else {
        o.append(modeSeg, W, H, lock, A,
          sbtn(`${icon('rotate')}`, () => { tf.rot += Math.PI / 2; tfChanged(); }),
          sbtn(`${icon('flipH')}`, () => { tf.sx = -tf.sx; tfChanged(); }),
          sbtn(`${icon('flipV')}`, () => { tf.sy = -tf.sy; tfChanged(); }),
          h('<span class="grow"></span>'),
          sbtn('Reset', () => { Object.assign(tf, { sx: 1, sy: 1, rot: 0, cx: tf.x0 + tf.w / 2, cy: tf.y0 + tf.h / 2 }); tfChanged(); }),
          sbtn('Cancel', () => { finishTransform(false); setTool('move'); }),
          sbtn(`${icon('check')}Apply`, () => { finishTransform(true); setTool('move'); }, 'btn-primary'));
        const btns = $$('.btn', o); btns[0].title = 'Rotate 90°'; btns[1].title = 'Flip horizontal'; btns[2].title = 'Flip vertical';
        updateTfInputs();
        }
      }
    }
    if (tool === 'liquify') {
      o.append(seg([['push', 'Push'], ['bloat', 'Bloat'], ['pucker', 'Pucker'], ['twirl', 'Twirl'], ['reconstruct', 'Reconstruct']], T.liquify, 'mode'),
        optSlider('Size', T.liquify, 'size', 10, 800), optSlider('Pressure', T.liquify, 'pressure', 1, 100, 1, v => v + '%'),
        h('<span class="opt muted">Hold the mouse still to bloat, pucker or twirl (Alt reverses twirl).</span>'));
    }
    if (tool === 'selbrush') {
      o.append(seg([['add', 'Add'], ['sub', 'Subtract']], T.selbrush, 'mode'), optSlider('Size', T.selbrush, 'size', 2, 500), optSlider('Hardness', T.selbrush, 'hardness', 0, 1, 0.01, pct),
        h('<span class="grow"></span>'), sbtn('Deselect', deselect), sbtn('Invert', invertSelection), sbtn('To new layer', () => selectionToLayer(false)));
    }
    if (tool === 'heal') o.append(seg([['content', 'Content-aware'], ['proximity', 'Proximity match']], T.heal, 'mode'), optSlider('Size', T.heal, 'size', 2, 400), optSlider('Hardness', T.heal, 'hardness', 0, 1, 0.01, pct),
      h('<span class="opt">Paint over a blemish, wire, person or object — RO3 rebuilds it from the surroundings. For bigger areas, select it and press Shift+Backspace.</span>'));
    if (tool === 'smudge') o.append(optSlider('Size', T.smudge, 'size', 2, 300), optSlider('Strength', T.smudge, 'strength', 1, 100, 1, v => v + '%'));
    if (tool === 'dodge' || tool === 'burn') o.append(optSlider('Size', T[tool], 'size', 2, 500), optSlider('Hardness', T[tool], 'hardness', 0, 1, 0.01, pct), optSlider('Exposure', T[tool], 'exposure', 1, 100, 1, v => v + '%'),
      h(`<span class="opt">${tool === 'dodge' ? 'Lightens' : 'Darkens'} where you paint. Each stroke builds on the last.</span>`));
    if (tool === 'sponge') o.append(seg([['desaturate', 'Desaturate'], ['saturate', 'Saturate']], T.sponge, 'mode'), optSlider('Size', T.sponge, 'size', 2, 500), optSlider('Hardness', T.sponge, 'hardness', 0, 1, 0.01, pct), optSlider('Flow', T.sponge, 'flow', 1, 100, 1, v => v + '%'));
    if ((tool === 'brush' || tool === 'eraser') && navigator.maxTouchPoints >= 0) {
      const ps = selectField('', [['off', 'Pen pressure: off'], ['size', 'Pressure → size'], ['opacity', 'Pressure → opacity'], ['both', 'Pressure → both']], T[tool].pressure || 'off');
      ps.classList.add('opt'); ps.querySelector('span').remove(); ps.select.style.width = '170px'; ps.select.addEventListener('change', () => { T[tool].pressure = ps.get(); }); o.append(ps);
    }
    if (tool === 'pencil') o.append(optSlider('Size', T.pencil, 'size', 1, 200), optSlider('Opacity', T.pencil, 'opacity', 0.01, 1, 0.01, pct), h('<span class="opt">Hard-edged strokes, ideal for pixel art and crisp masks.</span>'));
    if (tool === 'colorreplace') o.append(seg([['color', 'Color'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['luminosity', 'Luminosity']], T.colorreplace, 'mode'), optSlider('Size', T.colorreplace, 'size', 2, 500), optSlider('Tolerance', T.colorreplace, 'tolerance', 1, 100, 1, v => v + '%'),
      h('<span class="opt">Paints the foreground colour over the colour under the first click, keeping the shading.</span>'));
    if (tool === 'bgeraser') o.append(optSlider('Size', T.bgeraser, 'size', 2, 500), optSlider('Tolerance', T.bgeraser, 'tolerance', 1, 100, 1, v => v + '%'),
      seg([['continuous', 'Sample continuously'], ['once', 'Sample once']], T.bgeraser, 'sampling'), seg([['contiguous', 'Contiguous'], ['discontiguous', 'Discontiguous']], T.bgeraser, 'limits'), optCheck('Protect foreground color', T.bgeraser, 'protect'));
    if (tool === 'magiceraser') o.append(optSlider('Tolerance', T.magiceraser, 'tolerance', 0, 255), optCheck('Contiguous', T.magiceraser, 'contiguous'), optSlider('Opacity', T.magiceraser, 'opacity', 0.01, 1, 0.01, pct), h('<span class="opt">Click a colour to erase it.</span>'));
    if (tool === 'healbrush') o.append(optSlider('Size', T.healbrush, 'size', 2, 500), optSlider('Hardness', T.healbrush, 'hardness', 0, 1, 0.01, pct), h(`<span class="opt">${cloneSrc ? 'Paint over the flaw — texture comes from the marked spot and blends into the surroundings.' : 'Alt-click (Option on Mac) a clean area first.'}</span>`));
    if (tool === 'patch') o.append(seg([['source', 'Source'], ['destination', 'Destination']], T.patch, 'mode'), h(`<span class="opt">${doc && doc.selection ? (T.patch.mode === 'source' ? 'Drag the selection onto clean texture — it heals the selected area.' : 'Drag the selection to where you want a seamless copy.') : 'Draw around the area first (this tool lassos when nothing is selected).'}</span>`));
    if (tool === 'camove') o.append(seg([['move', 'Move'], ['extend', 'Extend']], T.camove, 'mode'), h(`<span class="opt">${doc && doc.selection ? 'Drag the selection. The gap it leaves is filled automatically.' : 'Draw around an object first (this tool lassos when nothing is selected).'}</span>`));
    if (tool === 'redeye') o.append(optSlider('Pupil size', T.redeye, 'pupil', 1, 100, 1, v => v + '%'), optSlider('Darken', T.redeye, 'darken', 1, 100, 1, v => v + '%'), h('<span class="opt">Click each red pupil.</span>'));
    if (tool === 'historybrush') {
      const src = selectField('', history.stack.map((s, i) => [String(i), `${i + 1}. ${s.label}`]), String(clamp(T.historybrush.source, 0, history.stack.length - 1)));
      src.classList.add('opt'); src.querySelector('span').remove(); src.select.style.width = '200px';
      src.select.addEventListener('change', () => { T.historybrush.source = Number(src.get()); });
      o.append(h('<span class="opt">Paint back from:</span>'), src, optSlider('Size', T.historybrush, 'size', 2, 500), optSlider('Opacity', T.historybrush, 'opacity', 0.01, 1, 0.01, pct));
    }
    if (tool === 'sharpenbrush') o.append(optSlider('Size', T.sharpenbrush, 'size', 2, 500), optSlider('Strength', T.sharpenbrush, 'strength', 1, 100, 1, v => v + '%'));
    if (tool === 'sampler') {
      const rs = samplerReadouts();
      o.append(h(`<span class="opt">${rs.length ? rs.map(r => `<span class="samp"><b>#${r.i}</b> <i style="background:${r.hex}"></i>R${r.r} G${r.g} B${r.b}</span>`).join('') : 'Click to pin up to four colour readouts; click a pin to remove it.'}</span>`));
      if (rs.length) o.append(h('<span class="grow"></span>'), sbtn('Clear', () => { doc.samplers = []; renderOverlay(); renderOptions(); }));
    }
    if (tool === 'ruler') {
      const r = rulerInfo();
      o.append(h(`<span class="opt">${r ? `Length ${r.len.toFixed(1)} px · Angle ${r.angle.toFixed(1)}° · W ${Math.abs(r.dx).toFixed(0)} · H ${Math.abs(r.dy).toFixed(0)}` : 'Drag to measure. Drag along a horizon, then Straighten.'}</span>`), h('<span class="grow"></span>'));
      if (r) o.append(sbtn('Straighten', straighten, 'btn-primary'), sbtn('Clear', () => { ruler = null; renderOverlay(); renderOptions(); }));
    }
    if (tool === 'perspcrop') {
      o.append(h(`<span class="opt">${pcrop ? 'Drag the corners onto the edges of something rectangular, then press Enter.' : 'Drag a box, then move its corners to match the perspective.'}</span>`), h('<span class="grow"></span>'));
      if (pcrop) o.append(sbtn('Cancel', () => { pcrop = null; renderOverlay(); renderOptions(); }), sbtn(`${icon('check')}Crop`, applyPerspCrop, 'btn-primary'));
    }
    if (tool === 'clone') {
      o.append(optSlider('Size', T.clone, 'size', 2, 500), optSlider('Hardness', T.clone, 'hardness', 0, 1, 0.01, pct), optSlider('Opacity', T.clone, 'opacity', 0.01, 1, 0.01, pct), optCheck('Aligned', T.clone, 'aligned'),
        h(`<span class="opt">${cloneSrc ? 'Paint to copy from the marked spot.' : 'Alt-click (Option on Mac) to set the source.'}</span>`));
    }
    if (tool === 'gradient') {
      const modeSel = selectField('', [['fgbg', 'Foreground → background'], ['fgclear', 'Foreground → transparent']], T.gradient.mode);
      modeSel.classList.add('opt'); modeSel.querySelector('span').remove(); modeSel.select.style.width = '200px';
      modeSel.select.addEventListener('change', () => T.gradient.mode = modeSel.get());
      o.append(seg([['linear', 'Linear'], ['radial', 'Radial']], T.gradient, 'type'), modeSel, optSlider('Opacity', T.gradient, 'opacity', 0.01, 1, 0.01, pct),
        h(`<span class="opt">Drag to draw. On a mask it fades from shown to hidden.</span>`));
    }
    if (tool === 'shape') {
      o.append(seg([['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['triangle', 'Triangle'], ['polygon', 'Polygon'], ['star', 'Star'], ['line', 'Line'], ['arrow', 'Arrow']], T.shape, 'kind', () => renderOptions()));
      if (!['line', 'arrow'].includes(T.shape.kind)) o.append(optCheck('Fill', T.shape, 'fill'), optCheck('Outline', T.shape, 'stroke'));
      if (T.shape.kind === 'polygon' || T.shape.kind === 'star') o.append(optSlider(T.shape.kind === 'star' ? 'Points' : 'Sides', T.shape, 'sides', 3, 24));
      if (T.shape.kind === 'star') o.append(optSlider('Inner radius', T.shape, 'inner', 10, 95, 1, v => v + '%'));
      o.append(optSlider(['line', 'arrow'].includes(T.shape.kind) ? 'Thickness' : 'Outline', T.shape, 'width', 1, 120));
      if (T.shape.kind === 'rect') o.append(optSlider('Corners', T.shape, 'radius', 0, 400));
      o.append(h(`<span class="opt">${['line', 'arrow'].includes(T.shape.kind) ? 'Uses the foreground color.' : 'Fill = foreground, outline = background.'} Each shape gets its own layer.</span>`));
    }
    if (tool === 'text') o.appendChild(h(`<span class="opt">Click to add text. Click an existing text layer to edit it.</span>`));
    if (tool === 'move') o.appendChild(h(`<span class="opt">Drag to move the layer (inside a selection: just those pixels). Alt-drag duplicates. Snaps to edges, center and thirds — hold Ctrl/Cmd to stop snapping.</span>`));
    if (tool === 'dropper') o.appendChild(h(`<span class="opt">Click to pick the foreground color. Alt-click picks background.</span>`));
    if (tool === 'hand') o.appendChild(h(`<span class="opt">Drag to pan. Double-click to fit. Hold Space with any tool to pan.</span>`));
    if (tool === 'zoom') o.appendChild(h(`<span class="opt">Click to zoom in, Alt-click to zoom out.</span>`));
  }

  function updateCursor() {
    const st = el.stage; if (!st) return;
    const cursors = { move: 'move', hand: 'grab', zoom: 'zoom-in', text: 'text', crop: 'crosshair', rect: 'crosshair', ellipse: 'crosshair', lasso: 'crosshair', wand: 'crosshair', fill: 'crosshair', dropper: 'crosshair', gradient: 'crosshair', shape: 'crosshair', transform: 'default' };
    if (spaceDown) { st.style.cursor = 'grab'; el.cursor.style.display = 'none'; return; }
    if (altDown && ALT_PICK_TOOLS.includes(tool)) { st.style.cursor = DROPPER_CURSOR; el.cursor.style.display = 'none'; return; }
    const painting = PAINT_TOOLS.includes(tool);
    st.style.cursor = painting ? 'none' : (cursors[tool] || 'default');
    if (painting) { const s = T[tool].size * view.zoom; el.cursor.style.width = s + 'px'; el.cursor.style.height = s + 'px'; }
    else el.cursor.style.display = 'none';
  }
  function moveCursor(e) {
    if (!doc) return;
    const p = docPoint(e);
    if (poly && tool === 'polylasso') { poly.hover = p; renderOverlay(); }
    if ((tool === 'move' || e.ctrlKey || e.metaKey) && !tf && e.buttons === 0) {
      const gi = guideNear(e);
      if (gi >= 0) { el.stage.style.cursor = doc.guides[gi].x != null ? 'col-resize' : 'row-resize'; el.hoverGuide = true; }
      else if (el.hoverGuide) { el.hoverGuide = false; updateCursor(); }
    }
    el.statusPos && (el.statusPos.textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`);
    if (tool === 'transform' && tf && !spaceDown) {
      const hit = tfHit(p);
      if (hit.type === 'move') el.stage.style.cursor = 'move';
      else if (hit.type === 'rotate') el.stage.style.cursor = ROTATE_CURSOR;
      else { const ang = (Math.atan2(hit.hy, hit.hx) + tf.rot) * 180 / Math.PI; const a = ((Math.round(ang / 45) % 4) + 4) % 4; el.stage.style.cursor = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][a]; }
      return;
    }
    if (!PAINT_TOOLS.includes(tool) || spaceDown) return;
    const r = el.stage.getBoundingClientRect();
    el.cursor.style.display = 'block';
    el.cursor.style.left = (e.clientX - r.left) + 'px'; el.cursor.style.top = (e.clientY - r.top) + 'px';
  }

  function updateStatus() {
    if (!el.status) return;
    if (!doc) { el.status.innerHTML = '<span>No image open</span>'; return; }
    if (!el.statusBuilt) {
      el.status.innerHTML = '';
      el.statusDoc = h('<span></span>');
      el.statusZoom = h(`<select aria-label="Zoom">${[['fit', 'Fit'], [0.25, '25%'], [0.5, '50%'], [1, '100%'], [2, '200%'], [4, '400%'], ['cur', '']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`);
      el.statusZoom.addEventListener('change', () => { const v = el.statusZoom.value; if (v === 'fit') fitView(); else if (v !== 'cur') zoomTo(Number(v)); });
      el.statusPos = h('<span></span>');
      el.statusSel = h('<span></span>');
      const thirdsBtn = h(`<button class="icon-btn" title="Rule of thirds grid (')" aria-label="Rule of thirds grid" style="width:24px;height:22px">${icon('grid')}</button>`);
      thirdsBtn.addEventListener('click', () => { showThirds = !showThirds; thirdsBtn.classList.toggle('on', showThirds); renderOverlay(); });
      el.thirdsBtn = thirdsBtn;
      const snapBtn = h(`<button class="icon-btn on" title="Snap to edges, center and thirds" aria-label="Snapping" style="width:24px;height:22px">${icon('magnet')}</button>`);
      snapBtn.addEventListener('click', () => { snapOn = !snapOn; snapBtn.classList.toggle('on', snapOn); });
      el.status.append(el.statusDoc, el.statusZoom, el.statusPos, el.statusSel, h('<span class="grow"></span>'), snapBtn, thirdsBtn);
      el.statusBuilt = true;
    }
    el.statusDoc.textContent = `${doc.width} × ${doc.height}px`;
    const curOpt = el.statusZoom.querySelector('option[value="cur"]');
    curOpt.textContent = Math.round(view.zoom * 100) + '%'; el.statusZoom.value = 'cur';
    el.statusSel.textContent = doc.selection ? 'Selection active' : '';
    el.thirdsBtn.classList.toggle('on', showThirds);
  }

  function buildSide() {
    const tabs = [['adjust', 'sliders', 'Adjust'], ['filters', 'blur', 'Filters'], ['color', 'drop', 'Color'], ['info', 'levels', 'Info'], ['frames', 'frame', 'Frames'], ['history', 'undo', 'History']];
    el.secTabs.innerHTML = '';
    tabs.forEach(([id, ic, label]) => {
      const b = h(`<button role="tab" data-sec="${id}" class="${sideTab === id ? 'on' : ''}">${icon(ic)}${label}</button>`);
      b.addEventListener('click', () => { commitAdjust(); sideTab = id; $$('button', el.secTabs).forEach(x => x.classList.toggle('on', x === b)); renderSideBody(); });
      el.secTabs.appendChild(b);
    });
    renderSideBody();
  }
  function renderSideBody() {
    const b = el.secBody; b.innerHTML = '';
    if (sideTab === 'adjust' && isAdj(active())) {
      b.appendChild(adjustmentPanel(active())); b.style.maxHeight = '460px'; b.style.overflow = 'auto';
    } else if (sideTab === 'adjust') {
      const wrap = h('<div class="ph-adjust"></div>');
      const nb = h(`<div class="adj-new"><span>Non-destructive</span><button class="btn btn-sm">${icon('plus')}Adjustment layer</button></div>`);
      $('button', nb).addEventListener('click', e => adjustmentMenu(e.currentTarget));
      wrap.appendChild(nb);
      el.adjSliders = {};
      ADJ.forEach(a => {
        const s = slider({ label: a.label, min: a.min, max: a.max, value: 0, unit: a.unit || '', fmt: v => (v > 0 ? '+' : '') + v + (a.unit || '') });
        s.input.addEventListener('input', previewAdjust);
        el.adjSliders[a.key] = s; wrap.appendChild(s);
      });
      const act = h(`<div class="adj-actions"><button class="btn" data-a="reset">Reset</button><button class="btn btn-primary" data-a="apply">${icon('check')}Apply</button></div>`);
      $('[data-a="reset"]', act).addEventListener('click', () => commitAdjust(true));
      $('[data-a="apply"]', act).addEventListener('click', () => commitAdjust());
      wrap.appendChild(act);
      wrap.appendChild(h('<p class="hint">These sliders change the active layer\'s pixels (inside the selection if there is one). For changes you can tweak later, add an adjustment layer.</p>'));
      b.appendChild(wrap); b.style.maxHeight = '420px'; b.style.overflow = 'auto';
    }
    if (sideTab === 'filters') {
      const wrap = h('<div class="ph-adjust"></div>');
      const f = (label, fn) => { const x = h(`<button class="btn">${label}</button>`); x.addEventListener('click', fn); return x; };
      const g1 = h('<div class="filter-grid"></div>');
      g1.append(
        f('Gaussian blur', () => runFilter('blur', 'Gaussian blur', [{ key: 'radius', label: 'Radius', min: 0.5, max: 80, step: 0.5, value: 6, unit: 'px' }])),
        f('Sharpen', () => runFilter('sharpen', 'Sharpen', [{ key: 'amount', label: 'Amount', min: 1, max: 200, value: 60, unit: '%' }])),
        f('Auto tone', () => runFilter('autotone', 'Auto tone')),
        f('Vignette', () => runFilter('vignette', 'Vignette', [{ key: 'strength', label: 'Strength', min: 0, max: 100, value: 55, unit: '%' }, { key: 'size', label: 'Spread', min: 0, max: 100, value: 40 }])),
        f('Black & white', () => runFilter('grayscale', 'Black & white')),
        f('Sepia', () => runFilter('sepia', 'Sepia')),
        f('Invert', () => runFilter('invert', 'Invert colors')),
        f('Posterize', () => runFilter('posterize', 'Posterize', [{ key: 'levels', label: 'Levels', min: 2, max: 16, value: 5 }])),
        f('Pixelate', () => runFilter('pixelate', 'Pixelate', [{ key: 'size', label: 'Block size', min: 2, max: 120, value: 14, unit: 'px' }])),
        f('Add noise', () => runFilter('noise', 'Add noise', [{ key: 'amount', label: 'Amount', min: 1, max: 100, value: 20 }])),
      );
      const search = h('<input class="filter-search" type="search" placeholder="Search filters…">');
      wrap.append(search, h('<h4>Quick</h4>'), g1);
      const groups = {};
      for (const fl of Object.values(PhotoFilters.F)) (groups[fl.group] = groups[fl.group] || []).push(fl);
      for (const [gname, list] of Object.entries(groups)) {
        const gg = h('<div class="filter-grid"></div>');
        list.forEach(fl => { const x = f(esc(fl.name.replace('…', '')), () => pixelFilter(fl.id)); x.dataset.name = fl.name.toLowerCase(); gg.appendChild(x); });
        wrap.append(h(`<h4>${esc(gname)}</h4>`), gg);
      }
      search.addEventListener('input', () => { const q = search.value.trim().toLowerCase(); $$('.filter-grid .btn', wrap).forEach(x => { x.hidden = q && !(x.dataset.name || x.textContent.toLowerCase()).includes(q); }); $$('h4', wrap).forEach(hh => { const gr = hh.nextElementSibling; hh.hidden = gr && [...gr.children].every(c => c.hidden); }); });
      const g2 = h('<div class="filter-grid"></div>');
      g2.append(
        f('Rotate 90° ↻', () => transformDoc('cw')), f('Rotate 90° ↺', () => transformDoc('ccw')),
        f('Flip horizontal', () => transformDoc('fh')), f('Flip vertical', () => transformDoc('fv')),
        f('Resize image…', resizeImageDialog), f('Canvas size…', canvasSizeDialog),
      );
      wrap.append(h('<h4>Whole image</h4>'), g2);
      b.appendChild(wrap); b.style.maxHeight = '420px'; b.style.overflow = 'auto';
    }
    if (sideTab === 'info') b.appendChild(infoPanel()), b.style.maxHeight = '460px', b.style.overflow = 'auto';
    if (sideTab === 'frames') {
      const wrap = h('<div class="ph-adjust"></div>');
      const grid = h('<div class="frame-grid"></div>');
      FRAME_STYLES.forEach(s => {
        const x = h(`<button class="frame-opt ${frameStyle === s.id ? 'on' : ''}"><svg viewBox="0 0 30 30">${s.svg}</svg>${s.label}</button>`);
        x.addEventListener('click', () => { frameStyle = s.id; $$('.frame-opt', grid).forEach(y => y.classList.toggle('on', y === x)); });
        grid.appendChild(x);
      });
      const size = slider({ label: 'Thickness', min: 1, max: 20, step: 0.5, value: frameSize, unit: '%' });
      size.input.addEventListener('input', () => frameSize = size.get());
      const color = h(`<label class="field"><span>Color</span><div class="row" style="align-items:center"><input type="color" value="${frameColor}"><span class="muted" style="flex:none">Applied as its own layer</span></div></label>`);
      $('input', color).addEventListener('input', e => frameColor = e.target.value);
      const grow = checkField('Grow canvas to fit the frame', frameGrow);
      grow.input.addEventListener('change', () => frameGrow = grow.get());
      const go = h(`<button class="btn btn-primary" style="justify-content:center">${icon('frame')}Add frame</button>`);
      go.addEventListener('click', applyFrame);
      wrap.append(grid, size, color, grow, go);
      b.appendChild(wrap); b.style.maxHeight = '420px'; b.style.overflow = 'auto';
    }
    if (sideTab === 'color') { b.appendChild(colorPanel()); b.style.maxHeight = '420px'; b.style.overflow = 'auto'; }
    if (sideTab === 'history') {
      el.historyList = h('<div class="history-list" style="max-height:340px"></div>');
      b.appendChild(el.historyList); b.style.maxHeight = ''; renderHistory();
    }
  }
  function renderHistory() {
    if (sideTab !== 'history' || !el.historyList) return;
    el.historyList.innerHTML = '';
    if (!history.stack.length) { el.historyList.appendChild(h('<div class="history-item">Nothing yet</div>')); return; }
    history.stack.forEach((s, i) => {
      const x = h(`<div class="history-item ${i === history.index ? 'current' : i > history.index ? 'future' : ''}">${esc(s.label)}</div>`);
      x.addEventListener('click', () => restore(i));
      el.historyList.appendChild(x);
    });
    el.historyList.scrollTop = el.historyList.scrollHeight;
  }

  function thumbOf(c, w = 76, hh = 60, asMask = false) {
    const t = O.mk(w, hh), x = O.cx(t);
    const s = Math.min(w / c.width, hh / c.height);
    const dw = c.width * s, dh = c.height * s;
    if (asMask) {
      x.fillStyle = '#000'; x.fillRect(0, 0, w, hh);
      const m = O.mk(c.width, c.height), mc = O.cx(m); mc.fillStyle = '#fff'; mc.fillRect(0, 0, m.width, m.height); mc.globalCompositeOperation = 'destination-in'; mc.drawImage(c, 0, 0);
      x.drawImage(m, (w - dw) / 2, (hh - dh) / 2, dw, dh);
    } else x.drawImage(c, (w - dw) / 2, (hh - dh) / 2, dw, dh);
    return t;
  }

  function renderLayers() {
    const list = el.layerList; if (!list) return;
    list.innerHTML = '';
    el.layersHead.innerHTML = '';
    el.layerTools.innerHTML = '';
    const l = active();
    if (!doc) { list.appendChild(h('<div class="empty" style="padding:24px 10px"><span>No layers yet</span></div>')); return; }
    const grp = doc.activeGroup && doc.groups && doc.groups[doc.activeGroup];
    const tgt = grp || l;
    const blendList = grp ? [['pass', 'Pass through'], ...BLENDS] : BLENDS;
    const blend = h(`<select aria-label="Blend mode">${blendList.map(([v, n]) => `<option value="${v}" ${tgt && tgt.blend === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`);
    blend.disabled = !tgt || (!grp && isAdj(l));
    blend.addEventListener('change', () => { tgt.blend = blend.value; requestRender(); pushHistory('Blend mode'); });
    const opId = uid('op');
    const op = h(`<label class="op" for="${opId}">Opacity <input id="${opId}" type="range" min="0" max="100" value="${tgt ? Math.round(tgt.opacity * 100) : 100}"><output>${tgt ? Math.round(tgt.opacity * 100) : 100}%</output></label>`);
    const opIn = $('input', op);
    const paintOp = () => opIn.style.setProperty('--p', opIn.value + '%');
    paintOp();
    opIn.disabled = !tgt;
    opIn.addEventListener('input', () => { tgt.opacity = opIn.value / 100; $('output', op).textContent = opIn.value + '%'; paintOp(); requestRender(); });
    opIn.addEventListener('change', () => pushHistory('Layer opacity'));
    el.layersHead.append(blend, h('<span class="grow"></span>'), op);
    if (selIds.size || doc.activeGroup) {
      const n = doc.activeGroup ? groupMembers(doc.activeGroup).length : selIds.size + 1;
      const bar = h(`<div class="align-bar"><span>${n} layers</span></div>`);
      const ab = (ic, t, fn) => { const b = h(`<button class="icon-btn" title="${t}">${icon(ic)}</button>`); b.addEventListener('click', fn); bar.appendChild(b); };
      const al = how => () => { if (doc.activeGroup) { selIds = new Set(groupMembers(doc.activeGroup).map(x => x.id)); } alignLayers(how); };
      ab('alignL', 'Align left edges', al('left')); ab('alignCH', 'Align horizontal centers', al('hcenter')); ab('alignR', 'Align right edges', al('right'));
      ab('alignT', 'Align top edges', al('top')); ab('alignCV', 'Align vertical centers', al('vcenter')); ab('alignB', 'Align bottom edges', al('bottom'));
      ab('distH', 'Distribute horizontally', () => { if (doc.activeGroup) selIds = new Set(groupMembers(doc.activeGroup).map(x => x.id)); distributeLayers('h'); });
      ab('distV', 'Distribute vertically', () => { if (doc.activeGroup) selIds = new Set(groupMembers(doc.activeGroup).map(x => x.id)); distributeLayers('v'); });
      el.layersHead.appendChild(bar);
    }

    const emitted = new Set();
    const groupRow = g => {
      const n = groupMembers(g.id).length;
      const row = h(`<div class="layer group-row ${doc.activeGroup === g.id ? 'active' : ''} ${g.visible ? '' : 'hidden-layer'}" role="listitem" data-group="${g.id}">
        <button class="icon-btn" aria-label="${g.visible ? 'Hide' : 'Show'} group">${icon(g.visible ? 'eye' : 'eyeOff')}</button>
        <button class="icon-btn gchev ${g.collapsed ? 'closed' : ''}" aria-label="${g.collapsed ? 'Expand' : 'Collapse'} group">${icon('chevron')}</button>
        <span class="gicon">${icon('group')}</span><span class="lname">${esc(g.name)} <em class="gcount">${n}</em></span></div>`);
      const [eye, chev] = row.querySelectorAll('.icon-btn');
      eye.addEventListener('click', e => { e.stopPropagation(); g.visible = !g.visible; pushHistory(g.visible ? 'Show group' : 'Hide group'); requestRender(); renderLayers(); });
      chev.addEventListener('click', e => { e.stopPropagation(); g.collapsed = !g.collapsed; renderLayers(); });
      row.addEventListener('click', () => { commitAdjust(); doc.activeGroup = g.id; selIds.clear(); const top = groupMembers(g.id).pop(); if (top) doc.activeId = top.id; renderLayers(); renderOptions(); renderOverlay(); });
      row.addEventListener('dblclick', () => groupSettings(g.id));
      row.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/ro3-layer')) { e.preventDefault(); e.stopPropagation(); } });
      row.addEventListener('drop', e => {
        const id = e.dataTransfer.getData('text/ro3-layer'); const src = doc.layers.find(x => x.id === id); if (!src) return;
        e.preventDefault(); e.stopPropagation();
        const mem = groupMembers(g.id); doc.layers.splice(doc.layers.indexOf(src), 1);
        src.group = g.id; const top = mem.filter(x => x !== src).pop();
        doc.layers.splice(top ? doc.layers.indexOf(top) + 1 : doc.layers.length, 0, src);
        tidyGroups(); pushHistory('Move into group'); refreshAll();
      });
      return row;
    };
    [...doc.layers].reverse().forEach(layer => {
      const adjL = isAdj(layer);
      const g = layer.group && doc.groups && doc.groups[layer.group];
      if (g && !emitted.has(g.id)) { emitted.add(g.id); list.appendChild(groupRow(g)); }
      if (g && g.collapsed) return;
      const picked = layer.id === doc.activeId || selIds.has(layer.id);
      const row = h(`<div class="layer ${picked ? 'active' : ''} ${g ? 'in-group' : ''} ${layer.visible ? '' : 'hidden-layer'} ${layer.clip ? 'clipped' : ''}" role="listitem" draggable="true" data-id="${layer.id}">
        <button class="icon-btn" aria-label="${layer.visible ? 'Hide' : 'Show'} layer">${icon(layer.visible ? 'eye' : 'eyeOff')}</button>
        ${layer.clip ? `<span class="clip-arrow" title="Clipped to the layer below">${icon('clipArrow')}</span>` : ''}<div class="lthumb ${adjL ? 'adj' : ''} ${layer.mask && !layer.editMask && layer.id === doc.activeId ? 'target' : ''}"></div>
        ${layer.mask ? `<div class="lmask ${(layer.editMask || adjL) && layer.id === doc.activeId ? 'target' : ''}" title="Layer mask${layer.maskOn ? '' : ' (disabled)'}" style="${layer.maskOn ? '' : 'opacity:.4'}"></div>` : '<span></span>'}
        <span class="lname">${layer.text ? 'T  ' : ''}${esc(layer.name)}</span>
        <span class="lbadges">${PhotoCompose.fxOn(layer.fx) ? '<button class="fx-badge" title="Edit layer style">fx</button>' : ''}${layer.locked ? `<span class="lock-badge" title="Locked">${icon('lock')}</span>` : ''}</span></div>`);
      if (adjL) $('.lthumb', row).insertAdjacentHTML('afterbegin', icon(PhotoAdjust.KINDS[layer.adj.kind].icon));
      else $('.lthumb', row).appendChild(thumbOf(layer.canvas));
      const fxb = $('.fx-badge', row); if (fxb) fxb.addEventListener('click', e => { e.stopPropagation(); doc.activeId = layer.id; layerStyleDialog(); });
      if (layer.mask) $('.lmask', row).appendChild(thumbOf(layer.mask, 30, 30, true));
      $('.icon-btn', row).addEventListener('click', e => { e.stopPropagation(); layer.visible = !layer.visible; pushHistory(layer.visible ? 'Show layer' : 'Hide layer'); requestRender(); renderLayers(); });
      row.addEventListener('click', e => {
        doc.activeGroup = null;
        if ((e.ctrlKey || e.metaKey) && !e.target.closest('.lthumb')) {
          if (layer.id === doc.activeId) { const other = [...selIds].pop(); if (other) { selIds.delete(other); doc.activeId = other; } }
          else if (selIds.has(layer.id)) selIds.delete(layer.id);
          else { selIds.add(doc.activeId); doc.activeId = layer.id; }
          renderLayers(); renderOptions(); return;
        }
        if (e.shiftKey && doc.activeId) {
          const a = doc.layers.findIndex(x => x.id === doc.activeId), b = doc.layers.indexOf(layer);
          selIds = new Set(doc.layers.slice(Math.min(a, b), Math.max(a, b) + 1).map(x => x.id)); selIds.delete(layer.id);
          doc.activeId = layer.id; renderLayers(); renderOptions(); return;
        }
        selIds.clear();
        const changed = doc.activeId !== layer.id;
        if (changed) { commitAdjust(); doc.activeId = layer.id; }
        renderLayers(); renderOptions(); renderOverlay();
        if (changed && (sideTab === 'adjust' || adjL)) { if (adjL) { sideTab = 'adjust'; buildSide(); } else renderSideBody(); }
      });
      $('.lthumb', row).addEventListener('click', () => { layer.editMask = false; });
      if (layer.mask) $('.lmask', row).addEventListener('click', () => { layer.editMask = true; });
      row.addEventListener('dblclick', e => {
        if (e.target.closest('.lname')) return renameLayer();
        if (layer.text) editText(layer); else if (adjL) { sideTab = 'adjust'; buildSide(); } else layerStyleDialog();
      });
      $('.lthumb', row).addEventListener('click', e => { if (e.ctrlKey || e.metaKey) { e.stopPropagation(); selectLayerPixels(layer); } });
      row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/ro3-layer', layer.id); e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/ro3-layer')) { e.preventDefault(); e.stopPropagation(); } });
      row.addEventListener('drop', e => {
        const id = e.dataTransfer.getData('text/ro3-layer'); if (!id || id === layer.id) return;
        e.preventDefault(); e.stopPropagation();
        const src = doc.layers.find(x => x.id === id);
        const r = row.getBoundingClientRect(); const above = e.clientY < r.top + r.height / 2;
        doc.layers.splice(doc.layers.indexOf(src), 1);
        const ti = doc.layers.indexOf(layer);
        doc.layers.splice(above ? ti + 1 : ti, 0, src);
        src.group = layer.group || null; tidyGroups();
        pushHistory('Reorder layers'); refreshAll();
      });
      list.appendChild(row);
    });

    const tb = (ic, label, fn, disabled) => { const b = h(`<button class="icon-btn" title="${label}" aria-label="${label}" ${disabled ? 'disabled' : ''}>${icon(ic)}</button>`); b.addEventListener('click', e => fn(e.currentTarget)); return b; };
    el.layerTools.append(
      tb('plus', 'New layer', addEmptyLayer),
      tb('invert', 'New adjustment layer', adjustmentMenu),
      tb('fx', 'Layer style', () => layerStyleDialog(), !l || isAdj(l)),
      tb('copy', 'Duplicate layer', duplicateLayer, !l),
      tb('group', 'Group layers (Ctrl/Cmd+G)', groupLayers, !l),
      tb('mask', l && l.mask ? 'Mask options' : 'Add mask (from selection if any)', maskMenu, !l || isAdj(l)),
      tb(l && l.locked ? 'lock' : 'unlock', l && l.locked ? 'Unlock layer' : 'Lock layer', toggleLock, !l),
      tb('layers', 'Merge down', mergeDown, !l || doc.layers.indexOf(l) === 0),
      tb('up', 'Move up', () => moveLayer(1), !l || doc.layers.indexOf(l) === doc.layers.length - 1),
      tb('down', 'Move down', () => moveLayer(-1), !l || doc.layers.indexOf(l) === 0),
      tb('trash', 'Delete layer', deleteLayer, !l),
    );
  }

  function refreshAll() {
    requestRender(); renderLayers(); renderOptions(); updateStatus(); renderHistory();
  }

  // ---------- keyboard & clipboard ----------
  const clipboardActive = () => RO3App.active === 'photo' && !isTyping() && !document.querySelector('.modal-backdrop');
  function onCopy(e) { if (!clipboardActive() || !doc) return; e.preventDefault(); copyToClipboard(false, false); }
  function onCut(e) { if (!clipboardActive() || !doc) return; e.preventDefault(); copyToClipboard(false, true); }
  function onPaste(e) { if (!clipboardActive()) return; e.preventDefault(); pasteFromClipboard(false); }
  function onKey(e) {
    if (RO3App.active !== 'photo' || isTyping() || document.querySelector('.modal-backdrop')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.code === 'Space') { if (!spaceDown) { spaceDown = true; updateCursor(); } e.preventDefault(); return; }
    if (mod) {
      if (k === 't') { e.preventDefault(); setTool('transform'); }
      else if (k === 'c' && e.shiftKey) { e.preventDefault(); copyToClipboard(true, false); }
      else if (k === 'v' && e.shiftKey) { e.preventDefault(); pasteFromClipboard(true); }
      else if (k === 'a') { e.preventDefault(); selectAll(); }
      else if (k === 'd' && !e.shiftKey) { e.preventDefault(); deselect(); }
      else if (k === 'i' && e.shiftKey && !e.altKey) { e.preventDefault(); invertSelection(); }
      else if (k === 'j') { e.preventDefault(); doc && doc.selection ? selectionToLayer(false) : duplicateLayer(); }
      else if (k === 'n' && e.shiftKey) { e.preventDefault(); addEmptyLayer(); }
      else if (k === 'n') { e.preventDefault(); newDocDialog(); }
      else if (k === '0') { e.preventDefault(); fitView(); }
      else if (k === '1' && e.altKey) { e.preventDefault(); zoomTo(1); }
      else if (k === '=' || k === '+') { e.preventDefault(); zoomTo(view.zoom * 1.25); }
      else if (k === '-') { e.preventDefault(); zoomTo(view.zoom / 1.25); }
      else if (k === 'backspace' || k === 'delete') { e.preventDefault(); fillSelection(); }
      else if (k === 'r') { e.preventDefault(); toggleRulers(); }
      else if (k === ';') { e.preventDefault(); toggleGuides(); }
      else if (k === 'g' && e.altKey) { e.preventDefault(); toggleClip(); }
      else if (e.code === 'KeyG' && !e.altKey && e.shiftKey) { e.preventDefault(); ungroupLayers(); }
      else if (e.code === 'KeyG' && !e.altKey) { e.preventDefault(); groupLayers(); }
      else if (e.code === 'KeyG' && e.altKey) { e.preventDefault(); toggleClip(); }
      else if (k === '/') { e.preventDefault(); toggleLock(); }
      else if (k === 'e' && e.shiftKey) { e.preventDefault(); mergeVisible(); }
      else if (k === 'e' && !e.altKey) { e.preventDefault(); mergeDown(); }
      else if (k === 'd' && e.shiftKey) { e.preventDefault(); reselect(); }
      else if (k === 'r' && e.altKey) { e.preventDefault(); selectAndMask(); }
      else if (e.code === 'KeyX' && e.shiftKey) { e.preventDefault(); setTool('liquify'); }
      else if (e.code === 'KeyR' && e.altKey) { e.preventDefault(); selectAndMask(); }
      else if (k === 'i' && !e.shiftKey && !e.altKey) { e.preventDefault(); runFilter('invert', 'Invert colors'); }
      else if (e.code === 'KeyI' && e.altKey) { e.preventDefault(); resizeImageDialog(); }
      else if (e.code === 'KeyC' && e.altKey) { e.preventDefault(); canvasSizeDialog(); }
      return;
    }
    if (e.altKey && (k === 'backspace' || k === 'delete') && doc) { e.preventDefault(); fillSelection(); return; }
    if (e.shiftKey && (k === 'backspace' || k === 'delete') && doc) { e.preventDefault(); contentAwareFill(); return; }
    if (e.shiftKey && e.key === 'F6') { e.preventDefault(); modifySelection('feather'); return; }
    if (poly && (k === 'enter' || k === 'escape' || k === 'backspace')) { e.preventDefault(); if (k === 'enter') finishPoly(); else if (k === 'escape') { poly = null; renderOverlay(); } else { poly.pts.pop(); if (!poly.pts.length) poly = null; renderOverlay(); } return; }
    if (tool === 'pen' && pen && (k === 'enter' || k === 'escape' || k === 'backspace')) { e.preventDefault(); if (k === 'escape') pen = null; else if (k === 'backspace') { pen.pts.pop(); if (!pen.pts.length) pen = null; } else pathToSelection(); renderOverlay(); renderOptions(); return; }
    if (tf && (k === 'enter' || k === 'escape')) { e.preventDefault(); finishTransform(k === 'enter'); setTool('move'); return; }
    if (tf && k.startsWith('arrow')) {
      e.preventDefault(); const n = e.shiftKey ? 10 : 1;
      if (k === 'arrowleft') tf.cx -= n; if (k === 'arrowright') tf.cx += n; if (k === 'arrowup') tf.cy -= n; if (k === 'arrowdown') tf.cy += n;
      tfChanged(); return;
    }
    if (pcrop && (k === 'enter' || k === 'escape')) { e.preventDefault(); if (k === 'enter') applyPerspCrop(); else { pcrop = null; renderOverlay(); renderOptions(); } return; }
    if (k === 'escape') { if (crop) { crop = null; renderOverlay(); renderOptions(); } else if (doc && doc.selection) deselect(); return; }
    if (k === 'enter' && crop) { applyCrop(); return; }
    if ((k === 'delete' || k === 'backspace') && doc) { e.preventDefault(); if (doc.selection) clearSelectionArea(); else if (active()) deleteLayer(); return; }
    if (k === 'x') { [fg, bg] = [bg, fg]; syncColors(); return; }
    if (k === 'd') { fg = '#000000'; bg = '#ffffff'; syncColors(); return; }
    if (k === "'") { showThirds = !showThirds; renderOverlay(); updateStatus(); return; }
    if (k === '[' || k === ']') {
      const o = T[tool]; if (o && o.size) { o.size = clamp(Math.round(o.size * (k === ']' ? 1.2 : 1 / 1.2)) || 1, 1, 500); renderOptions(); updateCursor(); }
      return;
    }
    if (k.startsWith('arrow') && tool === 'move' && active()) {
      e.preventDefault();
      const n = e.shiftKey ? 10 : 1;
      for (const l of (doc.activeGroup ? groupMembers(doc.activeGroup) : selectedLayers()).filter(x => !isAdj(x) && !x.locked)) {
        if (k === 'arrowleft') l.x -= n; if (k === 'arrowright') l.x += n; if (k === 'arrowup') l.y -= n; if (k === 'arrowdown') l.y += n;
      }
      requestRender(); clearTimeout(onKey._t); onKey._t = setTimeout(() => pushHistory('Nudge layer'), 400);
      return;
    }
    const combo = (e.altKey ? 'alt+' : '') + (e.shiftKey ? 'shift+' : '') + (e.code && e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : k);
    const t = TOOLS.find(t => t !== 'sep' && t.key === combo);
    if (t) setTool(t.id);
  }

  // ---------- module interface ----------
  function activate(bar) {
    const b = (ic, label, fn, kind = '') => { const x = h(`<button class="btn ${kind}">${icon(ic)}${label}</button>`); x.addEventListener('click', e => fn(e.currentTarget)); return x; };
    bar.append(
      b('open', 'Open', () => openDialog(false), 'btn-ghost'),
      b('plus', 'Place', () => doc ? openDialog(true) : openDialog(false), 'btn-ghost'),
      b('undo', '', undo, 'btn-ghost'), b('redo', '', redo, 'btn-ghost'),
      b('save', 'Save', () => saveProject(false), 'btn-ghost'),
      b('export', 'Export', exportDialog, 'btn-primary'),
    );
    const [, , u, r] = bar.children; u.title = 'Undo'; u.setAttribute('aria-label', 'Undo'); r.title = 'Redo'; r.setAttribute('aria-label', 'Redo');
    u.style.padding = r.style.padding = '0 8px';
    requestAnimationFrame(() => { if (doc && !view.userMoved) fitView(); });
  }
  function deactivate() { commitAdjust(); el.cursor && (el.cursor.style.display = 'none'); }
  const FILTER_PARAMS = {
    blur: ['Gaussian blur', [{ key: 'radius', label: 'Radius', min: 0.5, max: 80, step: 0.5, value: 6, unit: 'px' }]],
    sharpen: ['Sharpen', [{ key: 'amount', label: 'Amount', min: 1, max: 200, value: 60, unit: '%' }]],
    noise: ['Add noise', [{ key: 'amount', label: 'Amount', min: 1, max: 100, value: 20 }]],
    pixelate: ['Pixelate', [{ key: 'size', label: 'Block size', min: 2, max: 120, value: 14, unit: 'px' }]],
    vignette: ['Vignette', [{ key: 'strength', label: 'Strength', min: 0, max: 100, value: 55, unit: '%' }, { key: 'size', label: 'Spread', min: 0, max: 100, value: 40 }]],
    posterize: ['Posterize', [{ key: 'levels', label: 'Levels', min: 2, max: 16, value: 5 }]],
    autotone: ['Auto tone', []], grayscale: ['Black & white', []], sepia: ['Sepia', []], invert: ['Invert colors', []],
  };
  function menu(cmd) {
    if (cmd === 'open') return openDialog(false);
    if (cmd === 'save') return saveProject(false);
    if (cmd === 'save-as') return saveProject(true);
    if (cmd === 'export') return exportDialog();
    if (cmd === 'undo') { if (tf) { finishTransform(false); setTool('move'); return; } commitAdjust(); return undo(); }
    if (cmd === 'redo') return redo();
    if (!cmd.startsWith('photo:')) return;
    const c = cmd.slice(6);
    if (c === 'new') return newDocDialog();
    if (c === 'paste-new') return pasteFromClipboard(true);
    if (!doc) return toast('Open or create an image first.', 'error');
    const [a, b] = c.split(':');
    const map = {
      'copy-merged': () => copyToClipboard(true, false), fill: fillSelection, 'content-aware': contentAwareFill, transform: () => setTool('transform'),
      'image-size': resizeImageDialog, 'canvas-size': canvasSizeDialog, trim: trimTransparent, 'crop-selection': cropToSelection,
      rot: () => transformDoc(b), 'new-layer': addEmptyLayer, duplicate: duplicateLayer, 'delete-layer': deleteLayer,
      adjlayer: () => addAdjustmentLayer(b), 'layer-style': () => layerStyleDialog(), 'add-mask': addMask, clip: toggleClip, lock: toggleLock,
      'merge-down': mergeDown, 'merge-visible': mergeVisible, flatten: flattenImage,
      group: groupLayers, ungroup: ungroupLayers, 'copy-style': copyStyle, 'paste-style': pasteStyle, 'clear-style': clearStyle, align: () => alignLayers(b), distribute: () => distributeLayers(b),
      'select-all': selectAll, deselect, reselect, 'select-mask': selectAndMask, inverse: invertSelection, 'color-range': colorRangeDialog, 'layer-pixels': () => selectLayerPixels(),
      sel: () => modifySelection(b), 'sel-to-mask': selectionToMask,
      filter: () => { if (PhotoFilters.F[b]) return pixelFilter(b); const [label, params] = FILTER_PARAMS[b]; runFilter(b, label, params); },
      'last-filter': () => lastFilter ? pixelFilter(lastFilter.id, { params: lastFilter.params, repeat: true }) : toast('No filter has been used yet.', 'info'),
      panel: () => { sideTab = b; buildSide(); },
      rulers: toggleRulers, guides: toggleGuides, 'clear-guides': () => { doc.guides = []; renderOverlay(); }, 'new-guide': newGuideDialog,
      liquify: () => setTool('liquify'),
      thirds: () => { showThirds = !showThirds; renderOverlay(); updateStatus(); }, fit: fitView, actual: () => zoomTo(1),
    };
    if (map[a]) map[a]();
  }
  const unsaved = () => doc && doc.dirty ? ['The open image'] : [];

  /** Palette entries: every tool (menus are added by the app). */
  const commands = () => TOOLS.filter(t => t !== 'sep').map(t => ({ label: t.name, path: 'Photo › Tools', accel: t.label || t.key.toUpperCase(), run: () => { RO3App.show('photo'); setTool(t.id); } }));
  return { init, activate, deactivate, menu, openPath, recover, unsaved, commands, _debug: () => ({ doc, history, view, setTool, pixelFilter, get T() { return T; }, straighten, applyPerspCrop, get ruler() { return ruler; }, set ruler(v) { ruler = v; }, get pcrop() { return pcrop; }, set pcrop(v) { pcrop = v; }, buildSide, set sideTab(v) { sideTab = v; }, groupLayers, ungroupLayers, alignLayers, distributeLayers, get selIds() { return selIds; }, set selIds(v) { selIds = v; }, renderLayers, startTransform, finishTransform, get tf() { return tf; }, get liq() { return liq; }, tfToQuad, renderText, selectAndMask, contentAwareFill, get pen() { return pen; }, get fg() { return fg; }, addAdjustmentLayer, toggleClip, layerStyleDialog, mergeDown, modifySelection, colorRangeDialog, selectLayerPixels }) };
})();
