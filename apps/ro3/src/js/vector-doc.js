// Vector workspace — document model: presets, artboards, history, (de)serialization, selection,
// transforms, arrange/align, pathfinder & path operations, clipboard, appearance, paper.js draw patches.
(() => {
  const S = VX.S;
  const P = paper;

  // ---------- presets ----------
  VX.PRESETS = [
    { id: 'ig-post', label: 'Instagram post', sub: '1080 × 1080 px', w: 1080, h: 1080, cat: 'Social', quick: true },
    { id: 'ig-portrait', label: 'Portrait post', sub: '1080 × 1350 px', w: 1080, h: 1350, cat: 'Social', quick: true },
    { id: 'story', label: 'Story / Reel', sub: '1080 × 1920 px', w: 1080, h: 1920, cat: 'Social', quick: true },
    { id: 'link', label: 'Link / Facebook ad', sub: '1200 × 628 px', w: 1200, h: 628, cat: 'Social', quick: true },
    { id: 'yt-thumb', label: 'YouTube thumbnail', sub: '1280 × 720 px', w: 1280, h: 720, cat: 'Social' },
    { id: 'li-banner', label: 'LinkedIn banner', sub: '1584 × 396 px', w: 1584, h: 396, cat: 'Social' },
    { id: 'hd', label: 'Full HD', sub: '1920 × 1080 px', w: 1920, h: 1080, cat: 'Screen', quick: true },
    { id: 'web', label: 'Web banner', sub: '728 × 90 px', w: 728, h: 90, cat: 'Screen' },
    { id: 'icon', label: 'Icon', sub: '512 × 512 px', w: 512, h: 512, cat: 'Screen' },
    { id: 'logo', label: 'Logo', sub: '1000 × 1000 px', w: 1000, h: 1000, cat: 'Screen' },
    { id: 'letter', label: 'Letter', sub: '8.5 × 11 in', w: 612, h: 792, units: 'in', cat: 'Print', quick: true },
    { id: 'a4', label: 'A4', sub: '210 × 297 mm', w: 595.276, h: 841.89, units: 'mm', cat: 'Print', quick: true },
    { id: 'half-letter', label: 'Flyer (half letter)', sub: '5.5 × 8.5 in', w: 396, h: 612, units: 'in', cat: 'Print' },
    { id: 'tabloid', label: 'Tabloid poster', sub: '11 × 17 in', w: 792, h: 1224, units: 'in', cat: 'Print' },
    { id: 'poster', label: 'Poster', sub: '18 × 24 in', w: 1296, h: 1728, units: 'in', cat: 'Print' },
    { id: 'card', label: 'Business card', sub: '3.5 × 2 in', w: 252, h: 144, units: 'in', cat: 'Print', quick: true },
    { id: 'a5', label: 'A5', sub: '148 × 210 mm', w: 419.528, h: 595.276, units: 'mm', cat: 'Print' },
  ];
  const DEFAULT_SWATCHES = ['#ffffff', '#000000', '#2fd67f', '#0f3d27', '#1f6feb', '#ff5c5c', '#f2c14e', '#a58bff', '#ff8a3d', '#3fd2ff', '#e4ece7', '#7f9488', '#4d5d54', '#17211b'];

  // ---------- new document ----------
  function freshDocMeta({ name = 'Untitled', w = 1080, h = 1080, units = 'px', count = 1, cols = 0, gap = 60 } = {}) {
    const artboards = [];
    cols = cols || Math.min(count, 4);
    for (let i = 0; i < count; i++) artboards.push({ id: uid('ab'), name: `Artboard ${i + 1}`, x: (i % cols) * (w + gap), y: Math.floor(i / cols) * (h + gap), w, h });
    const grid = units === 'in' ? { size: 72, sub: 8 } : units === 'mm' ? { size: 72 / 25.4 * 10, sub: 10 } : { size: 50, sub: 5 };
    return { name, path: null, dirty: false, units, artboards, ab: 0, guides: [], grid, swatches: DEFAULT_SWATCHES.map(c => ({ color: c })), fonts: [] };
  }
  VX.createDoc = (opts = {}) => {
    resetDoc(freshDocMeta(opts));
    new P.Layer({ name: 'Layer 1' });
    VX.pushInitial();
    afterDocLoad();
  };
  function resetDoc(meta) {
    if (VX.textEditing && VX.textEditing()) VX.cancelTextEdit();
    S.project.activate();
    S.project.clear();
    S.doc = meta;
    S.sel = []; S.key = null; S.pts.clear(); S.isolation = null; S.lastTf = null; S.hover = null; S.smart = null; S.measure = null;
    S.hist = { stack: [], i: -1 };
    S.viewTouched = false;
  }
  function afterDocLoad() {
    VX.renderEmpty();
    const { w, h } = VX.stageSize();
    S.view.viewSize = new P.Size(w, h);
    VX.fitArtboard();
    VX.setTool(S.tool || 'select');
    VX.refreshPanels(true);
    VX.req();
  }
  VX.afterDocLoad = afterDocLoad;
  VX.resetDoc = resetDoc;
  VX.freshDocMeta = freshDocMeta;

  async function confirmDiscard() {
    if (!S.doc || !S.doc.dirty) return true;
    return confirmBox('Discard unsaved changes?', `“${S.doc.name}” has unsaved changes. Opening another design replaces it.`, 'Discard changes', 'danger');
  }
  VX.confirmDiscard = confirmDiscard;

  VX.newDocDialog = () => {
    const presets = VX.PRESETS;
    let units = 'px', cur = presets[0];
    const body = h(`<div class="vx-newdoc">
      <div class="vx-nd-presets">${['Social', 'Screen', 'Print'].map(cat => `<h4>${cat}</h4>${presets.filter(p => p.cat === cat).map(p => `<button class="vx-nd-p" data-id="${p.id}"><span class="vx-pv" style="aspect-ratio:${p.w}/${p.h}"></span><span><strong>${esc(p.label)}</strong><em>${esc(p.sub)}</em></span></button>`).join('')}`).join('')}</div>
      <div class="vx-nd-form stack">
        <label class="field"><span>Name</span><input type="text" data-k="name" value="Untitled"></label>
        <div class="row"><label class="field"><span>Width</span><input type="number" data-k="w" step="any" min="0.01"></label><label class="field"><span>Height</span><input type="number" data-k="h" step="any" min="0.01"></label></div>
        <div class="row"><label class="field"><span>Units</span><select data-k="units"><option value="px">Pixels</option><option value="pt">Points</option><option value="in">Inches</option><option value="mm">Millimeters</option></select></label>
          <label class="field"><span>Artboards</span><input type="number" data-k="count" value="1" min="1" max="100" step="1"></label></div>
        <div class="seg vx-orient"><button data-o="p" class="on">Portrait</button><button data-o="l">Landscape</button></div>
        <p class="hint vx-nd-px"></p>
      </div></div>`);
    const q = k => $(`[data-k="${k}"]`, body);
    const show = () => {
      const u = q('units').value, f = VX.UNIT[u];
      const W = Number(q('w').value) * f, H = Number(q('h').value) * f;
      const at = ppi => `${Math.round(W / 72 * ppi)} × ${Math.round(H / 72 * ppi)} px`;
      $('.vx-nd-px', body).textContent = u === 'px' ? `Exports at ${Math.round(W)} × ${Math.round(H)} px at 1×. Use 2× or 3× for retina.` : `${(W / 72).toFixed(2)} × ${(H / 72).toFixed(2)} in · exports at ${at(72)} (72 ppi) or ${at(300)} (300 ppi, print).`;
      $$('.vx-orient button', body).forEach(b => b.classList.toggle('on', (b.dataset.o === 'l') === (W > H)));
    };
    const setPreset = p => {
      cur = p; units = p.units || 'px';
      q('units').value = units;
      const f = VX.UNIT[units];
      q('w').value = +(p.w / f).toFixed(units === 'in' ? 3 : 2); q('h').value = +(p.h / f).toFixed(units === 'in' ? 3 : 2);
      $$('.vx-nd-p', body).forEach(b => b.classList.toggle('on', b.dataset.id === p.id));
      show();
    };
    $$('.vx-nd-p', body).forEach(b => b.addEventListener('click', () => setPreset(presets.find(p => p.id === b.dataset.id))));
    q('units').addEventListener('change', () => {
      const nu = q('units').value, f0 = VX.UNIT[units], f1 = VX.UNIT[nu];
      q('w').value = +(Number(q('w').value) * f0 / f1).toFixed(3); q('h').value = +(Number(q('h').value) * f0 / f1).toFixed(3); units = nu; show();
    });
    ['w', 'h'].forEach(k => q(k).addEventListener('input', () => { $$('.vx-nd-p', body).forEach(b => b.classList.remove('on')); show(); }));
    $$('.vx-orient button', body).forEach(b => b.addEventListener('click', () => { const W = q('w').value, H = q('h').value; if ((b.dataset.o === 'l') !== (Number(W) > Number(H))) { q('w').value = H; q('h').value = W; } show(); }));
    setPreset(cur);
    modal({ title: 'New document', body, width: 680, actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Create', kind: 'primary', onClick: async () => {
        const f = VX.UNIT[q('units').value];
        const w = Number(q('w').value) * f, hh = Number(q('h').value) * f;
        if (!(w > 0 && hh > 0)) { toast('Enter a width and height.', 'error'); return false; }
        if (!await confirmDiscard()) return false;
        VX.createDoc({ name: q('name').value.trim() || 'Untitled', w, h: hh, units: q('units').value, count: clamp(Math.round(Number(q('count').value) || 1), 1, 100) });
      } },
    ] });
  };

  VX.docSetupDialog = () => {
    if (!S.doc) return;
    const d = S.doc;
    const body = h(`<div class="stack">
      <label class="field"><span>Name</span><input type="text" data-k="name" value="${esc(d.name)}"></label>
      <div class="row"><label class="field"><span>Units</span><select data-k="units">${['px', 'pt', 'in', 'mm'].map(u => `<option value="${u}" ${u === d.units ? 'selected' : ''}>${{ px: 'Pixels', pt: 'Points', in: 'Inches', mm: 'Millimeters' }[u]}</option>`).join('')}</select></label>
      <label class="field"><span>Gridline every</span><input type="number" data-k="grid" step="any" value="${VX.fmtU(d.grid.size)}"></label><label class="field"><span>Subdivisions</span><input type="number" data-k="sub" min="1" max="20" value="${d.grid.sub}"></label></div>
      <label class="field"><span>Artboard background</span><select data-k="bg"><option value="">White (exports transparent if chosen)</option><option value="transparent">Transparency grid</option></select></label></div>`);
    $('[data-k="bg"]', body).value = (d.artboards[0] && d.artboards[0].bg) || '';
    modal({ title: 'Document setup', body, width: 460, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'OK', kind: 'primary', onClick: () => {
      const g = Number($('[data-k="grid"]', body).value);
      d.name = $('[data-k="name"]', body).value.trim() || d.name;
      d.units = $('[data-k="units"]', body).value;
      if (g > 0) d.grid.size = VX.fromU(g);
      d.grid.sub = clamp(Math.round(Number($('[data-k="sub"]', body).value) || 1), 1, 20);
      const bg = $('[data-k="bg"]', body).value;
      d.artboards.forEach(a => { if (bg) a.bg = bg; else delete a.bg; });
      VX.commit('Document setup');
    } }] });
  };

  // ---------- history ----------
  // [layerIndex, childIndex, …] — a Layer's own parent is null in paper.js, so stop there.
  const itemPath = it => { const p = []; while (it) { p.unshift(it.index); if (it.className === 'Layer') break; it = it.parent; } return p; };
  const itemAt = path => { let it = S.project.layers[path[0]]; for (let i = 1; it && i < path.length; i++) it = it.children && it.children[path[i]]; return it || null; };
  VX.itemPath = itemPath; VX.itemAt = itemAt;
  function docState() { const d = S.doc; return JSON.stringify({ artboards: d.artboards, ab: d.ab, guides: d.guides, swatches: d.swatches, grid: d.grid, units: d.units }); }
  function snapshot(label) {
    const te = VX.textEditItem && VX.textEditItem(); // hidden while its on-canvas editor is open
    if (te) te.visible = true;
    try { return { label, json: S.project.exportJSON({ asString: true, precision: 4 }), doc: docState(), sel: S.sel.map(itemPath), layer: S.project.activeLayer ? S.project.activeLayer.index : 0, iso: S.isolation ? itemPath(S.isolation) : null }; }
    finally { if (te) te.visible = false; }
  }
  function restore(st) {
    if (VX.textEditing && VX.textEditing()) VX.cancelTextEdit();
    S.project.activate();
    S.project.clear();
    S.project.importJSON(st.json);
    Object.assign(S.doc, JSON.parse(st.doc));
    if (!S.project.layers.length) new P.Layer({ name: 'Layer 1' });
    const L = S.project.layers[st.layer] || S.project.layers[S.project.layers.length - 1];
    L.activate();
    S.isolation = st.iso ? itemAt(st.iso) : null;
    S.sel = st.sel.map(itemAt).filter(Boolean);
    S.key = null; S.pts.clear();
    VX.onRestore && VX.onRestore();
    VX.selectionChanged(true);
  }
  VX.pushInitial = () => {
    S.hist = { stack: [snapshot('Open')], i: 0 }; S.doc.dirty = false;
    // A fresh or opened document replaces whatever the crash-recovery copy held (unless that copy is what we just opened).
    if (!S.recovering) ro3.autosaveClear('vector.ro3d').catch(() => {});
  };
  VX.commit = (label = 'Edit') => {
    if (!S.doc) return;
    if (VX.relayoutPathTexts) VX.relayoutPathTexts(); // type on a path follows its (possibly edited) guide
    const H = S.hist;
    H.stack.length = H.i + 1;
    H.stack.push(snapshot(label));
    // Keep at least 60 steps, but cap memory for heavy (raster-laden) documents.
    let total = H.stack.reduce((n, s) => n + s.json.length, 0);
    while (H.stack.length > 120 || (H.stack.length > 60 && total > 400e6)) { total -= H.stack[0].json.length; H.stack.shift(); }
    H.i = H.stack.length - 1;
    S.doc.dirty = true;
    VX.refreshPanels(); VX.req();
  };
  VX.undo = () => {
    if (!S.doc) return;
    if (VX.tools[S.tool] && VX.tools[S.tool].cancel && VX.tools[S.tool].cancel()) { VX.req(); return; }
    const H = S.hist; if (H.i <= 0) { toast('Nothing to undo', 'info', 1200); return; }
    H.i--; restore(H.stack[H.i]); S.doc.dirty = true;
  };
  VX.redo = () => {
    if (!S.doc) return;
    const H = S.hist; if (H.i >= H.stack.length - 1) return;
    H.i++; restore(H.stack[H.i]); S.doc.dirty = true;
  };
  VX.historyLabels = () => S.hist.stack.map((s, i) => ({ label: s.label, i, current: i === S.hist.i }));
  VX.goHistory = i => { if (i < 0 || i >= S.hist.stack.length) return; S.hist.i = i; restore(S.hist.stack[i]); S.doc.dirty = true; };

  // ---------- serialization (.ro3d) ----------
  VX.serialize = () => {
    const d = S.doc;
    const te = VX.textEditItem && VX.textEditItem();
    if (te) te.visible = true;
    try { return serializeNow(d); } finally { if (te) te.visible = false; }
  };
  const serializeNow = d => {
    return JSON.stringify({ app: 'RO3', kind: 'vector', version: 1, name: d.name, units: d.units, artboards: d.artboards, ab: d.ab, guides: d.guides, grid: d.grid, swatches: d.swatches,
      fonts: VX.io.embeddedFonts(), project: JSON.parse(S.project.exportJSON({ asString: true, precision: 5 })) });
  };
  VX.deserialize = async (text, path, { recovered = false } = {}) => {
    let j;
    try { j = JSON.parse(text); } catch (_) { throw new Error('This file is damaged or is not an RO3 design.'); }
    if (j.kind !== 'vector' || !j.project) throw new Error('This is not an RO3 vector design.');
    await VX.io.registerEmbeddedFonts(j.fonts || []);
    const meta = freshDocMeta({ name: j.name || 'Untitled', units: j.units || 'px' });
    Object.assign(meta, { artboards: j.artboards && j.artboards.length ? j.artboards : meta.artboards, ab: j.ab || 0, guides: j.guides || [], grid: j.grid || meta.grid, swatches: j.swatches || meta.swatches, path });
    resetDoc(meta);
    S.project.importJSON(JSON.stringify(j.project));
    if (!S.project.layers.length) new P.Layer({ name: 'Layer 1' });
    S.project.layers[S.project.layers.length - 1].activate();
    await VX.io.waitRasters();
    S.recovering = recovered;
    try { VX.pushInitial(); } finally { S.recovering = false; }
    if (recovered) S.doc.dirty = true;
    afterDocLoad();
  };

  // ---------- selection ----------
  const isLayer = it => it && it.className === 'Layer';
  VX.isLayer = isLayer;
  VX.selectable = it => {
    for (let x = it; x; x = x.parent) { if (!x.visible || x.locked) return false; if (isLayer(x)) break; }
    return true;
  };
  /** The object the Selection tool picks for a hit item: the child of the layer (or of the isolated group). */
  VX.topOf = it => {
    if (!it) return null;
    const ctx = S.isolation;
    let x = it;
    while (x.parent && !isLayer(x.parent) && x.parent !== ctx) x = x.parent;
    if (ctx && !ctx.isAncestor(x) && x !== ctx) return null;
    return x;
  };
  /** The leaf the Direct Selection tool picks (compound paths act as one path). */
  VX.leafOf = it => { let x = it; if (x && x.parent && x.parent.className === 'CompoundPath') x = x.parent; return x; };
  VX.select = (items, { add = false, toggle = false } = {}) => {
    items = (Array.isArray(items) ? items : [items]).filter(Boolean);
    if (!add && !toggle) S.sel = [];
    for (const it of items) {
      const i = S.sel.indexOf(it);
      if (i >= 0) { if (toggle) S.sel.splice(i, 1); }
      else S.sel.push(it);
    }
    // A parent and its child can't both be selected (walk up instead of comparing every pair — imports can be huge).
    const set = new Set(S.sel);
    S.sel = S.sel.filter(it => { for (let p = it.parent; p; p = p.parent) if (set.has(p)) return false; return true; });
    VX.selectionChanged();
  };
  VX.deselect = () => { S.sel = []; S.key = null; S.pts.clear(); VX.selectionChanged(); };
  VX.selectAll = () => {
    if (!S.doc) return;
    const scope = S.isolation ? [S.isolation] : S.project.layers;
    const items = [];
    for (const L of scope) if (L.visible && !L.locked) for (const c of L.children) if (VX.selectable(c)) items.push(c);
    S.pts.clear(); VX.select(items);
  };
  VX.selectSame = kind => {
    const ref = S.sel[0]; if (!ref) return toast('Select an object first.', 'info');
    const col = kind === 'fill' ? ref.fillColor : ref.strokeColor; const key = col ? col.toCSS(true) + col.alpha : 'none';
    const out = [];
    for (const L of S.project.layers) L.getItems({ match: it => (it.className === 'Path' || it.className === 'CompoundPath' || it.className === 'PointText') && !(it.parent && it.parent.className === 'CompoundPath') }).forEach(it => {
      const c = kind === 'fill' ? it.fillColor : it.strokeColor; const k = c ? c.toCSS(true) + c.alpha : 'none';
      if (k === key && VX.selectable(it)) out.push(it);
    });
    VX.select(out);
  };
  let selTimer = 0;
  VX.selectionChanged = (now) => {
    S.sel = S.sel.filter(it => it.parent || isLayer(it));
    if (S.key && !S.sel.includes(S.key)) S.key = null;
    for (const seg of [...S.pts]) if (!seg.path || !seg.path.parent) S.pts.delete(seg);
    if (S.isolation && !S.isolation.parent) S.isolation = null;
    const first = S.sel[0];
    if (first && first.layer && first.layer !== S.project.activeLayer) first.layer.activate();
    VX.req();
    clearTimeout(selTimer);
    if (now) VX.refreshPanels(true); else selTimer = setTimeout(() => VX.refreshPanels(true), 16);
  };
  VX.selBounds = (items = S.sel) => {
    let r = null;
    for (const it of items) { const b = it.className === 'Layer' ? null : it.bounds; if (b && (b.width || b.height || it.className === 'Path')) r = r ? r.unite(b) : b.clone(); }
    return r;
  };
  VX.enterIsolation = g => { S.isolation = g; S.sel = []; S.pts.clear(); VX.selectionChanged(); toast('Isolation mode — Esc or double-click outside to exit', 'info', 2200); };
  VX.exitIsolation = () => { const g = S.isolation; S.isolation = null; S.sel = g && g.parent ? [g] : []; VX.selectionChanged(); };

  // ---------- item description ----------
  VX.kindOf = it => {
    switch (it.className) {
      case 'Layer': return 'Layer';
      case 'Group': return it.data && it.data.pathText ? 'Type on a Path' : it.clipped ? 'Clip Group' : 'Group';
      case 'CompoundPath': return 'Compound Path';
      case 'PointText': return it.data && it.data.area ? 'Area Type' : 'Type';
      case 'Raster': return 'Image';
      case 'Shape': return it.type === 'circle' || it.type === 'ellipse' ? 'Ellipse' : 'Rectangle';
      case 'SymbolItem': return 'Symbol';
      default: return it.data && it.data.shape ? it.data.shape : it.data && it.data.live ? 'Rectangle' : it.clipMask ? 'Clipping Path' : 'Path';
    }
  };
  VX.nameOf = it => it.name || (it.className === 'PointText' ? (VX.textOf(it).replace(/\s+/g, ' ').slice(0, 28) || '<Type>') : `<${VX.kindOf(it)}>`);
  VX.textOf = it => (it.data && it.data.text != null ? it.data.text : it.content) || '';

  // ---------- transforms ----------
  const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
  /** Apply a matrix (project space) to items, keeping live rectangles and area-type boxes intact. */
  VX.transformItems = (items, m, { scaleStrokes = false } = {}) => {
    for (const it of items) applyTo(it, m, scaleStrokes);
  };
  function applyTo(it, m, scaleStrokes) {
    // Express m in the item's parent space.
    const pm = it.parent && !isLayer(it.parent) ? it.parent.globalMatrix : null;
    const lm = pm && !pm.isIdentity() ? pm.inverted().appended(m).appended(pm) : m;
    if (it.className === 'PointText' && it.data && it.data.area && near(lm.b, 0) && near(lm.c, 0) && near(it.matrix.b, 0) && near(it.matrix.c, 0)) {
      // Area type: resize the box instead of stretching the letters.
      const box = VX.areaBox(it);
      const tl = lm.transform(box.topLeft), br = lm.transform(box.bottomRight);
      const r = new P.Rectangle(tl, br);
      it.data.area.w = Math.max(4, r.width / Math.abs(it.matrix.a || 1)); it.data.area.h = Math.max(4, r.height / Math.abs(it.matrix.d || 1));
      VX.layoutAreaText(it, r.topLeft);
      return;
    }
    const sw = it.strokeWidth;
    it.transform(lm);
    if (it.data && it.data.pathText) it.data.pathText.size *= Math.sqrt(Math.abs(lm.a * lm.d - lm.b * lm.c)) || 1;
    if (scaleStrokes && sw && (it.className === 'Path' || it.className === 'CompoundPath')) it.strokeWidth = sw * Math.sqrt(Math.abs(lm.a * lm.d - lm.b * lm.c));
    trackLive(it, lm);
  }
  function trackLive(it, m) {
    const walk = x => {
      const L = x.data && x.data.live;
      if (L && L.kind === 'rect') {
        const det = m.a * m.d - m.b * m.c;
        const sim = near(m.a, m.d, 1e-4) && near(m.b, -m.c, 1e-4); // rotation + uniform scale
        const ortho = near(m.b, 0, 1e-6) && near(m.c, 0, 1e-6);
        const ang = ((L.angle % 90) + 90) % 90;
        if (sim && det > 0) { L.angle = (L.angle + Math.atan2(m.b, m.a) * 180 / Math.PI) % 360; }
        else if (ortho && (near(ang, 0, 1e-3) || near(ang, 90, 1e-3))) { if (m.a < 0 !== m.d < 0) L.angle = -L.angle; }
        else delete x.data.live;
        // keep the corner radius instead of letting it stretch
        if (x.data.live && x.data.live.r > 0 && !(near(Math.abs(det), 1, 1e-9) && sim)) VX.setCornerRadius(x, x.data.live.r);
      }
      if (x.children && x.className !== 'CompoundPath') x.children.forEach(walk);
    };
    walk(it);
  }
  /** Rebuild a live rectangle with a new corner radius. */
  VX.setCornerRadius = (it, r) => {
    const L = it.data && it.data.live; if (!L) return;
    const c = it.bounds.center;
    const probe = it.clone({ insert: false }); probe.rotate(-L.angle, c);
    const b = probe.bounds;
    r = Math.max(0, Math.min(r, b.width / 2, b.height / 2));
    const np = new P.Path.Rectangle({ rectangle: new P.Rectangle(c.x - b.width / 2, c.y - b.height / 2, b.width, b.height), radius: r, insert: false });
    if (L.angle) np.rotate(L.angle, c);
    it.segments = np.segments; it.closed = true; L.r = r;
  };
  VX.cornerRadiusOf = it => it.data && it.data.live ? it.data.live.r || 0 : null;

  // ---------- operations ----------
  const ops = VX.ops = {};
  const needSel = (n = 1, msg) => { if (S.sel.length < n) { toast(msg || (n > 1 ? `Select at least ${n} objects.` : 'Select an object first.'), 'info'); return false; } return true; };
  const isPathish = it => it.className === 'Path' || it.className === 'CompoundPath';
  const sortByZ = items => items.slice().sort((a, b) => cmpZ(a, b));
  function cmpZ(a, b) { // -1 if a is below b
    const pa = itemPath(a), pb = itemPath(b);
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return pa.length - pb.length;
  }
  VX.sortByZ = sortByZ;
  VX.isPathish = isPathish;

  ops.del = () => {
    if (S.pts.size) return ops.deletePoints();
    if (!S.sel.length) return;
    for (const it of S.sel) it.remove();
    S.sel = []; VX.selectionChanged(); VX.commit('Delete');
  };
  ops.deletePoints = () => {
    const byPath = new Map();
    for (const s of S.pts) { if (!s.path) continue; (byPath.get(s.path) || byPath.set(s.path, []).get(s.path)).push(s.index); }
    for (const [path, idx] of byPath) {
      idx.sort((a, b) => b - a).forEach(i => path.removeSegment(i));
      if (path.segments.length < 2) { const parent = path.parent; path.remove(); if (parent && parent.className === 'CompoundPath' && !parent.children.length) parent.remove(); }
    }
    S.pts.clear(); VX.selectionChanged(); VX.commit('Delete anchor points');
  };
  ops.duplicate = () => {
    if (!needSel()) return;
    const out = sortByZ(S.sel).map(it => { const c = it.clone(); c.translate(new P.Point(10, 10).divide(1)); return c; });
    VX.select(out); VX.commit('Duplicate');
  };
  let nudgeTimer = 0;
  ops.nudge = (dx, dy, dup) => {
    if (S.pts.size) {
      for (const s of S.pts) s.point = s.point.add([dx, dy]);
    } else {
      if (!S.sel.length) return;
      if (dup && !nudgeTimer) { const c = sortByZ(S.sel).map(it => it.clone()); S.sel = c; }
      VX.transformItems(S.sel, new P.Matrix().translate(dx, dy));
      S.lastTf = { m: new P.Matrix().translate(dx, dy), copy: !!dup };
    }
    VX.req(); VX.refreshPanels();
    clearTimeout(nudgeTimer); nudgeTimer = setTimeout(() => { nudgeTimer = 0; VX.commit('Nudge'); }, 350);
  };
  ops.transformAgain = () => {
    if (!S.lastTf || !S.sel.length) return toast('Nothing to repeat yet.', 'info');
    if (S.lastTf.copy) S.sel = sortByZ(S.sel).map(it => it.clone());
    const c = S.lastTf.center ? S.lastTf.center(VX.selBounds()) : null;
    const m = c ? S.lastTf.at(c) : S.lastTf.m;
    VX.transformItems(S.sel, m);
    VX.selectionChanged(); VX.commit('Transform again');
  };
  /** Record a transform for Transform Again. `at(center)` rebuilds rotation/scale about a new center. */
  VX.recordTf = (m, copy, rel) => { S.lastTf = rel ? { copy, center: b => b && b.center, at: rel } : { m, copy }; };
  ops.flip = axis => {
    if (!needSel()) return;
    const c = VX.selBounds().center;
    const m = new P.Matrix().scale(axis === 'h' ? -1 : 1, axis === 'h' ? 1 : -1, c);
    VX.transformItems(S.sel, m);
    VX.recordTf(null, false, cc => new P.Matrix().scale(axis === 'h' ? -1 : 1, axis === 'h' ? 1 : -1, cc));
    VX.commit(axis === 'h' ? 'Flip horizontal' : 'Flip vertical');
  };
  ops.rotateBy = (deg, copy) => {
    if (!needSel()) return;
    if (copy) S.sel = sortByZ(S.sel).map(it => it.clone());
    const c = VX.selBounds().center;
    VX.transformItems(S.sel, new P.Matrix().rotate(deg, c));
    VX.recordTf(null, !!copy, cc => new P.Matrix().rotate(deg, cc));
    VX.selectionChanged(); VX.commit('Rotate');
  };
  ops.scaleBy = (sx, sy, copy, strokes) => {
    if (!needSel()) return;
    if (copy) S.sel = sortByZ(S.sel).map(it => it.clone());
    const c = VX.selBounds().center;
    VX.transformItems(S.sel, new P.Matrix().scale(sx, sy, c), { scaleStrokes: strokes });
    VX.recordTf(null, !!copy, cc => new P.Matrix().scale(sx, sy, cc));
    VX.selectionChanged(); VX.commit('Scale');
  };
  ops.moveBy = (dx, dy, copy) => {
    if (!needSel()) return;
    if (copy) S.sel = sortByZ(S.sel).map(it => it.clone());
    VX.transformItems(S.sel, new P.Matrix().translate(dx, dy));
    VX.recordTf(new P.Matrix().translate(dx, dy), !!copy);
    VX.selectionChanged(); VX.commit(copy ? 'Move copy' : 'Move');
  };
  function tfDialog(title, fields, apply) {
    const body = h(`<div class="stack">${fields.map(f => f.check ? `<label class="check"><input type="checkbox" data-k="${f.k}" ${f.v ? 'checked' : ''}><span class="check-box">${icon('check')}</span><span>${esc(f.label)}</span></label>` : `<label class="field"><span>${esc(f.label)}</span><span class="num-wrap"><input type="number" step="any" data-k="${f.k}" value="${f.v}">${f.unit ? `<em>${esc(f.unit)}</em>` : ''}</span></label>`).join('')}</div>`);
    const val = () => Object.fromEntries(fields.map(f => [f.k, f.check ? $(`[data-k="${f.k}"]`, body).checked : Number($(`[data-k="${f.k}"]`, body).value) || 0]));
    modal({ title, body, width: 340, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Copy', onClick: () => apply(val(), true) }, { label: 'OK', kind: 'primary', onClick: () => apply(val(), false) }] });
  }
  ops.moveDialog = () => { if (!needSel()) return; const u = VX.unitLabel(); tfDialog('Move', [{ k: 'x', label: 'Horizontal', v: 0, unit: u }, { k: 'y', label: 'Vertical', v: 0, unit: u }], (v, copy) => ops.moveBy(VX.fromU(v.x), VX.fromU(v.y), copy)); };
  ops.rotateDialog = () => { if (!needSel()) return; tfDialog('Rotate', [{ k: 'a', label: 'Angle', v: 90, unit: '°' }], (v, copy) => ops.rotateBy(-v.a, copy)); };
  ops.scaleDialog = () => { if (!needSel()) return; tfDialog('Scale', [{ k: 'x', label: 'Horizontal', v: 100, unit: '%' }, { k: 'y', label: 'Vertical', v: 100, unit: '%' }, { k: 's', label: 'Scale strokes & effects', v: false, check: true }], (v, copy) => ops.scaleBy((v.x || 100) / 100, (v.y || 100) / 100, copy, v.s)); };

  // arrange
  ops.arrange = dir => {
    if (!needSel()) return;
    const items = sortByZ(S.sel);
    if (dir === 'front') items.forEach(it => it.bringToFront());
    else if (dir === 'back') items.slice().reverse().forEach(it => it.sendToBack());
    else if (dir === 'forward') items.slice().reverse().forEach(it => { const n = it.nextSibling; if (n && !S.sel.includes(n)) it.insertAbove(n); });
    else if (dir === 'backward') items.forEach(it => { const p = it.previousSibling; if (p && !S.sel.includes(p)) it.insertBelow(p); });
    VX.commit({ front: 'Bring to front', back: 'Send to back', forward: 'Bring forward', backward: 'Send backward' }[dir]);
  };
  ops.group = () => {
    if (!needSel()) return;
    const items = sortByZ(S.sel);
    const top = items[items.length - 1];
    const g = new P.Group();
    g.insertAbove(top);
    g.addChildren(items);
    VX.select([g]); VX.commit('Group');
  };
  ops.ungroup = () => {
    const groups = S.sel.filter(it => it.className === 'Group');
    if (!groups.length) return toast('Select a group to ungroup.', 'info');
    const out = [];
    for (const g of groups) {
      if (g.clipped) { out.push(...releaseClipGroup(g)); continue; }
      const kids = g.removeChildren();
      for (const k of kids) {
        k.insertBelow(g);
        if (!g.matrix.isIdentity()) k.transform(g.matrix);
        if (g.opacity < 1) k.opacity *= g.opacity;
        out.push(k);
      }
      g.remove();
    }
    VX.select([...S.sel.filter(it => !groups.includes(it)), ...out]); VX.commit('Ungroup');
  };
  ops.lock = () => { if (!needSel()) return; S.sel.forEach(it => { it.locked = true; }); S.sel = []; VX.selectionChanged(); VX.commit('Lock'); };
  ops.unlockAll = () => { const out = []; S.project.getItems({ match: it => it.locked && !isLayer(it) }).forEach(it => { it.locked = false; out.push(it); }); VX.select(out); VX.commit('Unlock all'); };
  ops.hide = () => { if (!needSel()) return; S.sel.forEach(it => { it.visible = false; }); S.sel = []; VX.selectionChanged(); VX.commit('Hide'); };
  ops.showAll = () => { const out = []; S.project.getItems({ match: it => !it.visible && !isLayer(it) }).forEach(it => { it.visible = true; out.push(it); }); VX.select(out); VX.commit('Show all'); };

  // align & distribute
  S.alignTo = 'selection';
  ops.align = kind => {
    const items = S.sel.filter(it => !it.locked);
    let ref;
    if (S.alignTo === 'artboard' || items.length === 1) { const a = S.doc.artboards[S.doc.ab]; ref = new P.Rectangle(a.x, a.y, a.w, a.h); }
    else if (S.alignTo === 'key' && S.key) ref = S.key.bounds;
    else ref = VX.selBounds(items);
    if (!items.length || !ref) return toast('Select objects to align.', 'info');
    for (const it of items) {
      if (S.alignTo === 'key' && it === S.key) continue;
      const b = it.bounds; let dx = 0, dy = 0;
      if (kind === 'left') dx = ref.left - b.left; if (kind === 'right') dx = ref.right - b.right; if (kind === 'hcenter') dx = ref.center.x - b.center.x;
      if (kind === 'top') dy = ref.top - b.top; if (kind === 'bottom') dy = ref.bottom - b.bottom; if (kind === 'vcenter') dy = ref.center.y - b.center.y;
      if (dx || dy) VX.transformItems([it], new P.Matrix().translate(dx, dy));
    }
    VX.commit('Align');
  };
  ops.distribute = kind => {
    const items = S.sel.filter(it => !it.locked);
    if (items.length < 3 && !(S.alignTo === 'artboard' && items.length >= 2)) return toast('Select at least 3 objects to distribute.', 'info');
    const horiz = /h$|left|right|hcenter/.test(kind) && kind !== 'space-v';
    const key = { left: b => b.left, hcenter: b => b.center.x, right: b => b.right, top: b => b.top, vcenter: b => b.center.y, bottom: b => b.bottom }[kind];
    const ab = S.doc.artboards[S.doc.ab];
    if (kind === 'space-h' || kind === 'space-v') {
      const H = kind === 'space-h';
      const sorted = items.slice().sort((a, b) => H ? a.bounds.left - b.bounds.left : a.bounds.top - b.bounds.top);
      let start = H ? sorted[0].bounds.left : sorted[0].bounds.top, end = H ? sorted[sorted.length - 1].bounds.right : sorted[sorted.length - 1].bounds.bottom;
      if (S.alignTo === 'artboard') { start = H ? ab.x : ab.y; end = H ? ab.x + ab.w : ab.y + ab.h; }
      const total = sorted.reduce((n, it) => n + (H ? it.bounds.width : it.bounds.height), 0);
      const gap = (end - start - total) / (sorted.length - 1 + (S.alignTo === 'artboard' ? 0 : 0));
      let pos = start;
      for (const it of sorted) { const b = it.bounds; const d = pos - (H ? b.left : b.top); VX.transformItems([it], new P.Matrix().translate(H ? d : 0, H ? 0 : d)); pos += (H ? b.width : b.height) + gap; }
    } else {
      const sorted = items.slice().sort((a, b) => key(a.bounds) - key(b.bounds));
      let a0 = key(sorted[0].bounds), a1 = key(sorted[sorted.length - 1].bounds);
      const step = (a1 - a0) / (sorted.length - 1);
      sorted.forEach((it, i) => { const d = a0 + step * i - key(it.bounds); VX.transformItems([it], new P.Matrix().translate(horiz ? d : 0, horiz ? 0 : d)); });
    }
    VX.commit('Distribute');
  };

  // ---------- compound paths & clipping masks ----------
  ops.makeCompound = () => {
    const items = sortByZ(S.sel.filter(isPathish));
    if (items.length < 1) return toast('Select paths to combine into a compound path.', 'info');
    const bottom = items[0];
    const cp = new P.CompoundPath({ insert: false });
    cp.insertAbove(items[items.length - 1]);
    cp.style = bottom.style;
    cp.fillRule = 'evenodd';
    for (const it of items) {
      const kids = it.className === 'CompoundPath' ? it.removeChildren() : [it];
      if (it.className === 'CompoundPath') it.remove();
      for (const k of kids) { if (k.parent) k.remove(); cp.addChild(k); }
    }
    cp.children.forEach(c => { c.style = null; });
    VX.select([cp]); VX.commit('Make compound path');
  };
  ops.releaseCompound = () => {
    const cps = S.sel.filter(it => it.className === 'CompoundPath');
    if (!cps.length) return toast('Select a compound path.', 'info');
    const out = [];
    for (const cp of cps) {
      const style = cp.style.clone ? cp.style : cp.style;
      const kids = cp.removeChildren();
      for (const k of kids.reverse()) { k.insertAbove(cp); k.style = style; if (!cp.matrix.isIdentity()) k.transform(cp.matrix); out.push(k); }
      cp.remove();
    }
    VX.select(out); VX.commit('Release compound path');
  };
  ops.makeClip = () => {
    if (!needSel(2, 'Select the artwork and a shape above it to use as the mask.')) return;
    const items = sortByZ(S.sel);
    const mask = items[items.length - 1];
    if (!isPathish(mask) && mask.className !== 'PointText' && mask.className !== 'Group') return toast('The top object must be a path, compound path or text.', 'error');
    const g = new P.Group({ insert: false });
    g.insertAbove(mask);
    g.addChild(mask);
    g.addChildren(items.slice(0, -1));
    g.clipped = true;
    mask.clipMask = true;
    VX.select([g]); VX.commit('Make clipping mask');
  };
  function releaseClipGroup(g) {
    const out = [];
    const mask = g.children.find(c => c.clipMask) || g.firstChild;
    g.clipped = false;
    if (mask) { mask.clipMask = false; mask.fillColor = null; mask.strokeColor = null; }
    const kids = g.removeChildren();
    for (const k of kids) { k.insertBelow(g); if (!g.matrix.isIdentity()) k.transform(g.matrix); out.push(k); }
    // mask goes to the top, like Illustrator
    if (mask) mask.insertAbove(kids[kids.length - 1] || mask);
    g.remove();
    return out;
  }
  ops.releaseClip = () => {
    let g = S.sel.find(it => it.className === 'Group' && it.clipped) || (S.isolation && S.isolation.clipped ? S.isolation : null);
    if (!g) return toast('Select a clip group.', 'info');
    if (g === S.isolation) S.isolation = null;
    const out = releaseClipGroup(g);
    VX.select(out); VX.commit('Release clipping mask');
  };

  // ---------- pathfinder ----------
  /** A closed, global-space path copy of an item for boolean operations (null if it has no area). */
  function shapeOf(it) {
    let s = null;
    if (it.className === 'Path' || it.className === 'CompoundPath') {
      s = it.clone({ insert: false });
      if (s.className === 'Path' && !s.closed) s.closed = true;
      if (s.className === 'CompoundPath') s.children.forEach(c => { if (!c.closed) c.closed = true; });
    } else if (it.className === 'Shape') s = it.toPath(false);
    else if (it.className === 'Group') {
      if (it.clipped) { const m = it.children.find(c => c.clipMask); const ms = m ? shapeOf(m) : null; let acc = null; for (const c of it.children) { if (c === m) continue; const cs = shapeOf(c); if (cs) acc = acc ? acc.unite(cs, { insert: false }) : cs; } s = acc && ms ? acc.intersect(ms, { insert: false }) : acc; }
      else for (const c of it.children) { const cs = shapeOf(c); if (cs) s = s ? s.unite(cs, { insert: false }) : cs; }
      if (s && !it.matrix.isIdentity()) s.transform(it.matrix);
      return s;
    } else return null;
    if (s && it.parent && !isLayer(it.parent)) s.transform(it.parent.globalMatrix);
    return s;
  }
  VX.shapeOf = shapeOf;
  // Unsigned: boolean results may hold separate regions with opposite windings.
  const area = s => s ? (s.className === 'CompoundPath' ? s.children.reduce((n, c) => n + Math.abs(c.area), 0) : Math.abs(s.area)) : 0;
  const empty = s => !s || area(s) < 0.01 || (s.className === 'CompoundPath' && !s.children.length) || (s.className === 'Path' && s.segments.length < 2);
  function leafStyleOf(it) {
    if (isPathish(it) || it.className === 'Shape') return it;
    if (it.children) for (const c of it.children) { const s = leafStyleOf(c); if (s) return s; }
    return it;
  }
  function styled(shape, from, { noStroke = false } = {}) {
    const src = leafStyleOf(from);
    shape.data = {}; // boolean results are plain paths (no live corners)
    shape.fillColor = src.fillColor ? src.fillColor.clone() : null;
    shape.strokeColor = noStroke ? null : src.strokeColor ? src.strokeColor.clone() : null;
    shape.strokeWidth = src.strokeWidth; shape.strokeCap = src.strokeCap; shape.strokeJoin = src.strokeJoin; shape.dashArray = src.dashArray;
    shape.opacity = from.opacity; shape.blendMode = from.blendMode;
    if (!shape.fillColor && !shape.strokeColor) shape.fillColor = new P.Color('#000');
    return shape;
  }
  /** Split a compound path into separate regions (outer contours with their holes). */
  function splitRegions(s) {
    if (!s) return [];
    if (s.className === 'Path') return [s];
    const kids = s.children.slice();
    if (kids.length <= 1) { const k = kids[0]; if (k) { k.remove(); k.style = s.style; } return k ? [k] : []; }
    const outers = [], holes = [];
    for (const k of kids) {
      const pt = k.interiorPoint || k.bounds.center;
      let depth = 0; for (const o of kids) if (o !== k && o.contains(pt) && o.bounds.contains(k.bounds)) depth++;
      (depth % 2 ? holes : outers).push(k);
    }
    return outers.map(o => {
      const mine = holes.filter(hh => o.contains(hh.interiorPoint || hh.bounds.center) && o.bounds.contains(hh.bounds));
      if (!mine.length) { o.remove(); o.style = s.style; return o; }
      const cp = new P.CompoundPath({ insert: false }); o.remove(); cp.addChild(o); mine.forEach(hh => { hh.remove(); cp.addChild(hh); }); cp.style = s.style; cp.fillRule = 'evenodd'; return cp;
    });
  }
  VX.splitRegions = splitRegions;
  ops.pathfinder = kind => {
    const items = sortByZ(S.sel.filter(it => !it.locked));
    if (items.some(it => it.className === 'PointText')) return toast('Convert text with Type › Create Outlines first.', 'error');
    if (items.some(it => it.className === 'Raster')) return toast('Pathfinder works on shapes, not images. Use Image Trace first.', 'error');
    if (items.length < 2 && !(kind === 'divide' && items.length === 1) && kind !== 'unite') return toast('Select at least two shapes.', 'info');
    if (!items.length) return toast('Select shapes first.', 'info');
    const shapes = items.map(shapeOf);
    if (shapes.some(s => !s)) return toast('Pathfinder needs shapes (paths, compound paths or groups of them).', 'error');
    const parent = items[items.length - 1].parent;
    const toParent = s => { if (parent && !isLayer(parent)) s.transform(parent.globalMatrix.inverted()); return s; };
    const top = items[items.length - 1], bottom = items[0];
    let results = []; // [shape, styleFrom, opts]
    const uniteAll = list => list.reduce((acc, s) => acc ? acc.unite(s, { insert: false }) : s.clone({ insert: false }), null);
    try {
      if (kind === 'unite') results = [[uniteAll(shapes), top]];
      else if (kind === 'minus-front') { let r = shapes[0]; for (const s of shapes.slice(1)) r = r.subtract(s, { insert: false }); results = [[r, bottom]]; }
      else if (kind === 'minus-back') { let r = shapes[shapes.length - 1]; for (const s of shapes.slice(0, -1)) r = r.subtract(s, { insert: false }); results = [[r, top]]; }
      else if (kind === 'intersect') { let r = shapes[0]; for (const s of shapes.slice(1)) r = r.intersect(s, { insert: false }); results = [[r, top]]; }
      else if (kind === 'exclude') { let r = shapes[0]; for (const s of shapes.slice(1)) r = r.exclude(s, { insert: false }); results = [[r, top]]; }
      else if (kind === 'divide') {
        let pieces = [];
        shapes.forEach((s, i) => {
          const next = [];
          let rest = s;
          for (const p of pieces) {
            const inter = p.shape.intersect(s, { insert: false });
            const outside = p.shape.subtract(s, { insert: false });
            if (!empty(outside)) next.push({ shape: outside, from: p.from });
            if (!empty(inter)) next.push({ shape: inter, from: items[i] });
            rest = rest.subtract(p.shape, { insert: false });
          }
          if (!empty(rest)) next.push({ shape: rest, from: items[i] });
          pieces = next;
        });
        for (const p of pieces) for (const r of splitRegions(p.shape)) if (!empty(r)) results.push([r, p.from]);
        results.group = true;
      } else if (kind === 'trim' || kind === 'merge' || kind === 'crop') {
        const upto = kind === 'crop' ? shapes.length - 1 : shapes.length; // crop: the cutter doesn't hide what's below it
        const vis = shapes.map((s, i) => { let v = s; for (const above of shapes.slice(i + 1, upto)) v = v.subtract(above, { insert: false }); return v; });
        if (kind === 'crop') {
          const cutter = shapes[shapes.length - 1];
          vis.slice(0, -1).forEach((v, i) => { const r = v.intersect(cutter, { insert: false }); for (const piece of splitRegions(r)) if (!empty(piece)) results.push([piece, items[i], { noStroke: true }]); });
        } else if (kind === 'merge') {
          const byColor = new Map();
          vis.forEach((v, i) => { if (empty(v)) return; const c = leafStyleOf(items[i]).fillColor; const k = c ? c.toCSS(true) + c.alpha : 'none'; const e = byColor.get(k); byColor.set(k, e ? { shape: e.shape.unite(v, { insert: false }), from: e.from } : { shape: v, from: items[i] }); });
          for (const { shape, from } of byColor.values()) for (const piece of splitRegions(shape)) if (!empty(piece)) results.push([piece, from, { noStroke: true }]);
        } else vis.forEach((v, i) => { for (const piece of splitRegions(v)) if (!empty(piece)) results.push([piece, items[i], { noStroke: true }]); });
        results.group = true;
      }
    } catch (e) { console.error(e); return toast('That shape combination could not be computed: ' + e.message, 'error'); }
    const asGroup = !!results.group;
    results = results.filter(([s]) => !empty(s));
    const made = results.map(([s, from, o]) => styled(toParent(s), from, o));
    const anchor = top;
    let out;
    if (asGroup && made.length > 1) { const g = new P.Group({ insert: false }); g.insertAbove(anchor); g.addChildren(made); out = [g]; }
    else { made.forEach(m => m.insertAbove(anchor)); out = made; }
    items.forEach(it => it.remove());
    if (!out.length) { VX.deselect(); VX.commit('Pathfinder'); return toast('The result is empty.', 'info'); }
    VX.select(out); VX.commit({ unite: 'Unite', 'minus-front': 'Minus front', 'minus-back': 'Minus back', intersect: 'Intersect', exclude: 'Exclude', divide: 'Divide', trim: 'Trim', merge: 'Merge', crop: 'Crop' }[kind]);
  };

  // ---------- path operations ----------
  VX.needOffset = async () => { await VX.loadScript('vendor/paperjs-offset.min.js'); return window.paperjsOffset; };
  const pathLeaves = items => { const out = []; const walk = it => { if (isPathish(it)) out.push(it); else if (it.children && it.className !== 'CompoundPath') it.children.forEach(walk); }; items.forEach(walk); return out; };
  VX.pathLeaves = pathLeaves;
  ops.offsetDialog = async () => {
    const paths = pathLeaves(S.sel);
    if (!paths.length) return toast('Select paths to offset.', 'info');
    const O = await VX.needOffset();
    const u = VX.unitLabel();
    const body = h(`<div class="stack"><label class="field"><span>Offset</span><span class="num-wrap"><input type="number" step="any" data-k="d" value="${VX.fmtU(10)}"><em>${u}</em></span></label>
      <label class="field"><span>Joins</span><select data-k="j"><option value="miter">Miter</option><option value="round" selected>Round</option><option value="bevel">Bevel</option></select></label>
      <label class="field"><span>Miter limit</span><input type="number" data-k="l" value="4" min="1" max="50"></label><p class="hint">Negative values shrink the shape. The original stays; the offset copy is placed behind it.</p></div>`);
    modal({ title: 'Offset path', body, width: 340, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'OK', kind: 'primary', onClick: () => {
      const d = VX.fromU(Number($('[data-k="d"]', body).value) || 0); const join = $('[data-k="j"]', body).value; const limit = Number($('[data-k="l"]', body).value) || 4;
      const out = [];
      for (const p of paths) {
        try {
          const src = p.className === 'Path' && !p.closed ? null : p;
          const r = src ? O.offset(src, d, { join, limit, insert: false }) : O.offsetStroke(p, Math.abs(d), { join, cap: 'round', limit, insert: false });
          if (!r) continue;
          r.style = p.style; if (!src) { r.fillColor = p.strokeColor || p.fillColor; r.strokeColor = null; }
          r.insertBelow(p); out.push(r);
        } catch (e) { console.warn(e); }
      }
      if (!out.length) { toast('Could not offset the selected paths.', 'error'); return; }
      VX.select(out); VX.commit('Offset path');
    } }] });
  };
  ops.outlineStroke = async () => {
    const paths = pathLeaves(S.sel).filter(p => p.strokeColor && p.strokeWidth > 0);
    if (!paths.length) return toast('Select paths with a stroke.', 'info');
    const O = await VX.needOffset();
    const out = [];
    for (const p of paths) {
      try {
        const res = outlineOf(O, p);
        res.insertAbove(p); p.remove(); out.push(res);
        S.sel = S.sel.filter(x => x !== p);
      } catch (e) { console.warn(e); toast('Could not outline one of the strokes.', 'error'); }
    }
    VX.select([...S.sel.filter(it => it.parent), ...out]); VX.commit('Outline stroke');
  };
  function outlineOf(O, p) {
    const w = p.strokeWidth / 2;
    const al = p.data && p.data.strokeAlign;
    let band = O.offsetStroke(p, al && al !== 'center' ? w * 2 : w, { join: p.strokeJoin, cap: p.strokeCap === 'square' ? 'butt' : p.strokeCap, limit: p.miterLimit, insert: false });
    if (al === 'inside' || al === 'outside') { const sh = p.clone({ insert: false }); sh.strokeColor = null; band = al === 'inside' ? band.intersect(sh, { insert: false }) : band.subtract(sh, { insert: false }); }
    band.fillColor = p.strokeColor.clone(); band.strokeColor = null; band.opacity = 1;
    const arrows = arrowPaths(p);
    if (!p.fillColor && !arrows.length) { band.opacity = p.opacity; band.blendMode = p.blendMode; return band; }
    const g = new P.Group({ insert: false });
    if (p.fillColor) { const f = p.clone({ insert: false }); f.strokeColor = null; f.opacity = 1; delete f.data.arrows; delete f.data.strokeAlign; g.addChild(f); }
    g.addChild(band); arrows.forEach(a => g.addChild(a));
    g.opacity = p.opacity; g.blendMode = p.blendMode;
    return g;
  }
  VX.outlineOf = outlineOf;
  ops.simplifyDialog = () => {
    const paths = pathLeaves(S.sel);
    if (!paths.length) return toast('Select paths to simplify.', 'info');
    const orig = paths.map(p => p.exportJSON({ asString: false }));
    const before = paths.reduce((n, p) => n + (p.segments ? p.segments.length : p.children.reduce((m, c) => m + c.segments.length, 0)), 0);
    const sl = slider({ label: 'Simplify', min: 0, max: 100, value: 40, unit: '%' });
    const info = h('<p class="hint"></p>');
    const apply = () => {
      paths.forEach((p, i) => { p.importJSON(orig[i]); const t = 0.05 + Math.pow(sl.get() / 100, 2) * 12 / Math.max(0.2, VX.zoom()); (p.className === 'CompoundPath' ? p.children : [p]).forEach(c => c.simplify(t)); });
      const after = paths.reduce((n, p) => n + (p.segments ? p.segments.length : p.children.reduce((m, c) => m + c.segments.length, 0)), 0);
      info.textContent = `Anchor points: ${before} → ${after}`; VX.req();
    };
    sl.input.addEventListener('input', apply); apply();
    const body = h('<div class="stack"></div>'); body.append(sl, info);
    modal({ title: 'Simplify', body, width: 360, onClose: v => { if (v !== 'ok') { paths.forEach((p, i) => p.importJSON(orig[i])); VX.req(); } }, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'OK', kind: 'primary', value: 'ok', onClick: () => { VX.commit('Simplify'); } }] });
  };
  ops.smoothPaths = () => { const paths = pathLeaves(S.sel); if (!paths.length) return; paths.forEach(p => (p.className === 'CompoundPath' ? p.children : [p]).forEach(c => c.smooth({ type: 'catmull-rom', factor: 0.5 }))); VX.commit('Smooth'); };
  ops.addAnchors = () => {
    const paths = pathLeaves(S.sel); if (!paths.length) return;
    for (const p of paths) for (const c of (p.className === 'CompoundPath' ? p.children : [p])) { const curves = c.curves.slice(); for (let i = curves.length - 1; i >= 0; i--) curves[i].divideAtTime(0.5); }
    VX.commit('Add anchor points');
  };
  ops.reverse = () => { const paths = pathLeaves(S.sel); if (!paths.length) return toast('Select a path.', 'info'); paths.forEach(p => p.reverse()); VX.commit('Reverse path'); };
  ops.join = () => {
    // Two selected endpoints (Direct Selection) or two open paths: connect the nearest ends. One open path: close it.
    const open = pathLeaves(S.sel).filter(p => p.className === 'Path' && !p.closed);
    if (open.length === 1) { open[0].closed = true; VX.commit('Join'); return; }
    if (open.length < 2) { const pts = [...S.pts]; if (pts.length === 2 && pts[0].path === pts[1].path && !pts[0].path.closed) { pts[0].path.closed = true; VX.commit('Join'); } else toast('Select an open path, or two open paths to join.', 'info'); return; }
    let [a, b] = open;
    const ends = [[a.lastSegment, b.firstSegment, false, false], [a.lastSegment, b.lastSegment, false, true], [a.firstSegment, b.firstSegment, true, false], [a.firstSegment, b.lastSegment, true, true]];
    ends.sort((x, y) => x[0].point.getDistance(x[1].point) - y[0].point.getDistance(y[1].point));
    const [, , revA, revB] = ends[0];
    if (revA) a.reverse(); if (revB) b.reverse();
    const touching = a.lastSegment.point.getDistance(b.firstSegment.point) < 0.01;
    const segs = b.segments.map(s => s.clone());
    if (touching) { a.lastSegment.handleOut = segs[0].handleOut; segs.shift(); }
    a.addSegments(segs);
    b.remove();
    VX.select([a, ...open.slice(2)]); VX.commit('Join');
  };
  ops.roundCornersDialog = () => {
    const paths = pathLeaves(S.sel);
    if (!paths.length) return toast('Select shapes to round.', 'info');
    const orig = paths.map(p => p.exportJSON({ asString: false }));
    const live = S.sel.filter(it => it.data && it.data.live);
    const sl = slider({ label: 'Radius', min: 0, max: 200, value: 12, unit: ' ' + VX.unitLabel() });
    const apply = () => { paths.forEach((p, i) => { p.importJSON(orig[i]); const r = VX.fromU(sl.get()); if (p.data && p.data.live) VX.setCornerRadius(p, r); else roundCorners(p, r); }); VX.req(); };
    sl.input.addEventListener('input', apply); apply();
    const body = h('<div class="stack"></div>'); body.append(sl);
    if (live.length) body.append(h('<p class="hint">Rectangles keep live corners you can change later in Properties.</p>'));
    modal({ title: 'Round corners', body, width: 340, onClose: v => { if (v !== 'ok') { paths.forEach((p, i) => p.importJSON(orig[i])); VX.req(); } }, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'OK', kind: 'primary', value: 'ok', onClick: () => VX.commit('Round corners') }] });
  };
  function roundCorners(p, r) {
    for (const c of (p.className === 'CompoundPath' ? p.children : [p])) {
      const segs = c.segments.slice();
      const out = [];
      segs.forEach((s, i) => {
        const prev = segs[(i - 1 + segs.length) % segs.length], next = segs[(i + 1) % segs.length];
        const isEnd = !c.closed && (i === 0 || i === segs.length - 1);
        if (isEnd || s.hasHandles() || r <= 0) { out.push(s.clone()); return; }
        const a = prev.point.subtract(s.point), b = next.point.subtract(s.point);
        const la = a.length, lb = b.length; if (!la || !lb) { out.push(s.clone()); return; }
        const ang = Math.acos(clamp(a.dot(b) / (la * lb), -1, 1)); if (ang > Math.PI - 0.01) { out.push(s.clone()); return; }
        const t = Math.min(r / Math.tan(ang / 2), la / 2, lb / 2);
        const rr = t * Math.tan(ang / 2); // effective radius after clamping to the edge lengths
        const p1 = s.point.add(a.normalize(t)), p2 = s.point.add(b.normalize(t));
        const hl = rr * 4 / 3 * Math.tan((Math.PI - ang) / 4);
        out.push(new P.Segment(p1, null, s.point.subtract(p1).normalize(hl)));
        out.push(new P.Segment(p2, s.point.subtract(p2).normalize(hl), null));
      });
      c.segments = out;
    }
  }
  ops.expandAppearance = async () => {
    if (!needSel()) return;
    const O = await VX.needOffset();
    const out = [];
    for (const it of S.sel) {
      if (it.className === 'PointText') { out.push(it); continue; }
      const leaves = pathLeaves([it]).filter(p => (p.data && (p.data.arrows || (p.data.strokeAlign && p.data.strokeAlign !== 'center'))) || p.strokeColor);
      for (const p of leaves) { if (!p.strokeColor || !(p.strokeWidth > 0)) continue; const r = outlineOf(O, p); r.insertAbove(p); p.remove(); if (p === it) out.push(r); }
      if (it.parent) out.push(it);
    }
    VX.select(out.filter(x => x.parent)); VX.commit('Expand appearance');
  };

  // ---------- clipboard ----------
  ops.copy = (cd) => {
    if (!S.sel.length) return;
    const items = sortByZ(S.sel);
    S.clip = { json: items.map(it => it.exportJSON({ asString: true })), bounds: VX.selBounds(items).clone(), n: 0 };
    // Also put SVG markup on the system clipboard so the artwork pastes into other apps.
    try {
      const svg = VX.io.selectionSVG(items);
      S.clip.svg = svg;
      if (cd && cd.setData) cd.setData('text/plain', svg); else navigator.clipboard.writeText(svg).catch(() => {});
    } catch (_) {}
    toast(`Copied ${items.length} object${items.length > 1 ? 's' : ''}`, 'ok', 1100);
  };
  ops.cut = (cd) => { if (!S.sel.length) return; ops.copy(cd); for (const it of S.sel) it.remove(); S.sel = []; VX.selectionChanged(); VX.commit('Cut'); };
  ops.paste = async (mode = 'center', data) => {
    if (!S.doc) return;
    // Outside content (SVG markup or an image) wins when it isn't what we copied ourselves.
    let text = data ? data.getData('text/plain') : null;
    if (text == null && mode === 'center') try { text = await navigator.clipboard.readText(); } catch (_) {}
    if (text && /<svg[\s>]/i.test(text) && (!S.clip || text !== S.clip.svg)) { await VX.io.importSVGText(text, { place: true }); return; }
    if (data && [...data.items].some(i => i.type.startsWith('image/')) && (!S.clip || !text || text !== S.clip.svg)) {
      const f = [...data.items].find(i => i.type.startsWith('image/')).getAsFile();
      const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      await VX.io.placeDataURL(url, 'Pasted image'); return;
    }
    if (!S.clip) {
      const img = mode === 'center' ? await ro3.clipboardReadImage().catch(() => null) : null;
      if (img) { await VX.io.placeDataURL(img.dataUrl, 'Pasted image'); return; }
      if (text && text.trim() && mode === 'center') { VX.io.addText(text.trim()); return; }
      return toast('The clipboard is empty.', 'info');
    }
    const layer = S.isolation || S.project.activeLayer;
    const ref = S.sel.length ? sortByZ(S.sel) : null;
    const items = S.clip.json.map(j => { const it = P.Base.importJSON(j); return it; });
    if (mode === 'back' && ref) items.forEach(it => it.insertBelow(ref[0]));
    else if (mode === 'front' && ref) items.slice().reverse().forEach(it => it.insertAbove(ref[ref.length - 1]));
    else items.forEach(it => layer.addChild(it));
    if (mode === 'center') {
      const vb = S.view.bounds; const b = S.clip.bounds;
      const vis = vb.contains(b.center);
      S.clip.n = vis ? S.clip.n + 1 : 0;
      const target = vis ? b.center.add(new P.Point(10, 10).multiply(S.clip.n)) : vb.center;
      VX.transformItems(items, new P.Matrix().translate(target.subtract(b.center)));
    }
    VX.select(items); VX.commit('Paste');
  };

  // ---------- appearance ----------
  VX.paintOf = (kind, items = S.sel) => {
    // Common fill/stroke color of the selection: Color, null (none), or 'mixed'.
    const leaves = [];
    const walk = it => { if (it.data && it.data.pathText) it.children.slice(1).forEach(walk); else if (it.className === 'Group' || it.className === 'Layer') it.children.forEach(walk); else leaves.push(it); };
    items.forEach(walk);
    const vals = leaves.filter(l => l.className !== 'Raster' && !l.clipMask).map(l => kind === 'fill' ? l.fillColor : l.strokeColor);
    if (!vals.length) return undefined;
    const key = c => c ? (c.type === 'gradient' ? 'g' + JSON.stringify(c.gradient.stops.map(s => [s.color.toCSS(true), s.offset])) : c.toCSS(false)) : 'none';
    const k0 = key(vals[0]);
    return vals.every(v => key(v) === k0) ? vals[0] : 'mixed';
  };
  const paintTargets = (items) => { const out = []; const walk = it => { if (it.data && it.data.pathText) it.children.slice(1).forEach(walk); else if (it.className === 'Group' || it.className === 'Layer') it.children.forEach(c => { if (!c.clipMask) walk(c); }); else if (it.className !== 'Raster') out.push(it); }; items.forEach(walk); return out; };
  VX.paintTargets = paintTargets;
  /** Set fill or stroke of the selection (and the current color for new objects). color: paper.Color | null */
  VX.applyPaint = (kind, color, { commit = true, label } = {}) => {
    if (kind === 'fill') S.fill = color ? color.clone() : null; else S.stroke = color ? color.clone() : null;
    const targets = paintTargets(S.pts.size ? [...new Set([...S.pts].map(s => VX.leafOf(s.path)))] : S.sel);
    for (const t of targets) {
      let c = color ? color.clone() : null;
      if (c && c.type === 'gradient' && t.bounds) c = VX.fitGradient(c, t);
      if (kind === 'fill') t.fillColor = c; else { t.strokeColor = c; if (c && !(t.strokeWidth > 0)) t.strokeWidth = S.strokeStyle.width || 1; }
    }
    VX.syncColorWidget && VX.syncColorWidget();
    if (targets.length && commit) VX.commit(label || (kind === 'fill' ? 'Fill color' : 'Stroke color'));
    VX.req();
  };
  /** Place a gradient's origin/destination across an item's bounds, keeping the gradient's angle. */
  VX.fitGradient = (c, item, angleDeg) => {
    const b = item.bounds;
    const radial = c.gradient.radial;
    let ang = angleDeg;
    if (ang == null) ang = c.origin && c.destination ? c.destination.subtract(c.origin).angle : 0;
    const out = new P.Color({ gradient: { stops: c.gradient.stops.map(s => [s.color.clone(), s.offset]), radial }, origin: b.center, destination: b.center.add([b.width / 2, 0]) });
    if (radial) { out.origin = b.center; out.destination = b.center.add(new P.Point({ length: Math.max(b.width, b.height) / 2, angle: ang })); }
    else {
      const dir = new P.Point({ length: 1, angle: ang });
      const half = Math.abs(dir.x) * b.width / 2 + Math.abs(dir.y) * b.height / 2;
      out.origin = b.center.subtract(dir.multiply(half)); out.destination = b.center.add(dir.multiply(half));
    }
    return out;
  };
  VX.applyStyle = (props, { commit = true, label = 'Stroke' } = {}) => {
    const targets = paintTargets(S.sel);
    for (const t of targets) for (const [k, v] of Object.entries(props)) {
      if (k === 'strokeAlign' || k === 'arrows') { if (v == null || v === 'center') delete t.data[k]; else t.data[k] = JSON.parse(JSON.stringify(v)); t.changed && t._changed && t._changed(1); }
      else t[k] = v;
    }
    if (props.strokeWidth != null) S.strokeStyle.width = props.strokeWidth;
    if (props.strokeCap) S.strokeStyle.cap = props.strokeCap;
    if (props.strokeJoin) S.strokeStyle.join = props.strokeJoin;
    if ('dashArray' in props) S.strokeStyle.dash = props.dashArray && props.dashArray.length ? props.dashArray : null;
    VX.savePrefs();
    if (targets.length && commit) VX.commit(label);
    VX.req();
  };
  VX.applyItemProps = (props, label = 'Appearance') => {
    if (!S.sel.length) return;
    for (const it of S.sel) Object.assign(it, props);
    VX.commit(label);
  };
  /** Give a new object the current fill/stroke. */
  VX.styleNew = (it, { fill = true, stroke = true } = {}) => {
    it.fillColor = fill && S.fill ? S.fill.clone() : null;
    it.strokeColor = stroke && S.stroke ? S.stroke.clone() : null;
    it.strokeWidth = S.strokeStyle.width; it.strokeCap = S.strokeStyle.cap; it.strokeJoin = S.strokeStyle.join; it.miterLimit = S.strokeStyle.miter;
    if (S.strokeStyle.dash) it.dashArray = S.strokeStyle.dash;
    if (it.fillColor && it.fillColor.type === 'gradient') it.fillColor = VX.fitGradient(it.fillColor, it);
    if (it.strokeColor && it.strokeColor.type === 'gradient') it.strokeColor = VX.fitGradient(it.strokeColor, it);
    return it;
  };
  ops.swapColors = () => {
    const f = S.fill, s = S.stroke; S.fill = s; S.stroke = f;
    const targets = paintTargets(S.sel);
    for (const t of targets) { const tf = t.fillColor, ts = t.strokeColor; t.fillColor = ts; t.strokeColor = tf; if (t.strokeColor && !(t.strokeWidth > 0)) t.strokeWidth = 1; }
    VX.syncColorWidget(); if (targets.length) VX.commit('Swap fill and stroke'); VX.req();
  };
  ops.defaultColors = () => {
    S.fill = new P.Color('#ffffff'); S.stroke = new P.Color('#000000'); S.strokeStyle.width = 1;
    const targets = paintTargets(S.sel);
    for (const t of targets) { t.fillColor = S.fill.clone(); t.strokeColor = S.stroke.clone(); t.strokeWidth = 1; }
    VX.syncColorWidget(); if (targets.length) VX.commit('Default colors'); VX.req();
  };
  ops.noneColor = () => VX.applyPaint(S.focus, null);
  ops.setFocusType = type => {
    const cur = S.focus === 'fill' ? S.fill : S.stroke;
    if (type === 'solid') VX.applyPaint(S.focus, cur && cur.type !== 'gradient' ? cur : new P.Color(cur && cur.type === 'gradient' ? cur.gradient.stops[0].color : '#000000'));
    else VX.applyPaint(S.focus, cur && cur.type === 'gradient' ? cur : new P.Color({ gradient: { stops: [[cur && cur.type !== 'gradient' ? cur : '#ffffff', 0], ['#000000', 1]] }, origin: [0, 0], destination: [100, 0] }));
  };

  // ---------- artboards ----------
  const ab = VX.ab = {};
  const abRect = a => new P.Rectangle(a.x, a.y, a.w, a.h);
  VX.abRect = abRect;
  ab.at = pt => { for (let i = S.doc.artboards.length - 1; i >= 0; i--) if (abRect(S.doc.artboards[i]).contains(pt)) return i; return -1; };
  ab.activate = (i, fit) => { if (!S.doc.artboards[i]) return; S.doc.ab = i; if (fit) VX.fitArtboard(i); VX.refreshPanels(); VX.req(); };
  ab.artwork = (i, all = false) => {
    const r = abRect(S.doc.artboards[i]); const out = [];
    for (const L of S.project.layers) if (all || (L.visible && !L.locked)) for (const c of L.children) if (r.contains(c.bounds.center)) out.push(c);
    return out;
  };
  ab.freeSpot = (w, hh) => {
    const all = S.doc.artboards; let maxR = -Infinity, top = 0;
    for (const a of all) if (a.x + a.w > maxR) { maxR = a.x + a.w; top = a.y; }
    return { x: maxR + 60, y: top };
  };
  ab.add = (rect) => {
    const cur = S.doc.artboards[S.doc.ab] || { w: 1080, h: 1080 };
    const r = rect || { ...ab.freeSpot(cur.w, cur.h), w: cur.w, h: cur.h };
    S.doc.artboards.push({ id: uid('ab'), name: `Artboard ${S.doc.artboards.length + 1}`, x: r.x, y: r.y, w: r.w, h: r.h, bg: cur.bg });
    S.doc.ab = S.doc.artboards.length - 1;
    VX.commit('New artboard'); if (!rect) VX.fitAll();
  };
  ab.duplicate = (i = S.doc.ab) => {
    const a = S.doc.artboards[i]; if (!a) return;
    const spot = ab.freeSpot(a.w, a.h);
    const dx = spot.x - a.x, dy = spot.y - a.y;
    const art = ab.artwork(i);
    const copies = art.map(it => { const c = it.clone(); c.translate(new P.Point(dx, dy)); return c; });
    S.doc.artboards.push({ ...JSON.parse(JSON.stringify(a)), id: uid('ab'), name: a.name + ' copy', x: spot.x, y: spot.y });
    S.doc.ab = S.doc.artboards.length - 1;
    VX.select(copies); VX.commit('Duplicate artboard'); VX.fitAll();
  };
  ab.remove = (i = S.doc.ab) => {
    if (S.doc.artboards.length <= 1) return toast('A document needs at least one artboard.', 'info');
    S.doc.artboards.splice(i, 1); S.doc.ab = Math.min(S.doc.ab, S.doc.artboards.length - 1);
    VX.commit('Delete artboard');
  };
  ab.rename = (i, name) => { const a = S.doc.artboards[i]; if (!a || !name) return; a.name = name; VX.commit('Rename artboard'); };
  ab.setRect = (i, r, { moveArt = false, commit = true } = {}) => {
    const a = S.doc.artboards[i]; if (!a) return;
    if (moveArt && (r.x !== a.x || r.y !== a.y) && r.w === a.w && r.h === a.h) { const art = ab.artwork(i); VX.transformItems(art, new P.Matrix().translate(r.x - a.x, r.y - a.y)); }
    Object.assign(a, { x: r.x, y: r.y, w: Math.max(1, r.w), h: Math.max(1, r.h) });
    if (commit) VX.commit('Artboard'); else VX.req();
  };
  ab.fitToArt = (i = S.doc.ab) => {
    const a = S.doc.artboards[i]; const r = abRect(a);
    let b = null; for (const L of S.project.layers) for (const c of L.children) if (c.visible && c.bounds.intersects(r)) b = b ? b.unite(c.strokeBounds) : c.strokeBounds.clone();
    if (!b) return toast('There is no artwork on this artboard.', 'info');
    ab.setRect(i, { x: b.x, y: b.y, w: b.width, h: b.height });
  };
  ab.move = (from, to) => { const A = S.doc.artboards; if (to < 0 || to >= A.length) return; const [x] = A.splice(from, 1); A.splice(to, 0, x); S.doc.ab = to; VX.commit('Reorder artboards'); };

  // ---------- guides ----------
  VX.clearGuides = () => { if (!S.doc) return; S.doc.guides = []; VX.commit('Clear guides'); };

  // ---------- paper.js draw patches: stroke alignment and arrowheads ----------
  function arrowGeom(p, end, kind, w) {
    const len = p.length; if (!len) return null;
    const at = end === 'end' ? len : 0;
    const pt = p.getPointAt(at), tan = p.getTangentAt(at);
    if (!pt || !tan) return null;
    const dir = end === 'end' ? tan : tan.multiply(-1);
    const nrm = new P.Point(-dir.y, dir.x);
    const L = Math.max(w * 4, 6), W = L * 0.55;
    if (kind === 'circle') return { circle: pt, r: Math.max(w * 1.8, 3) };
    if (kind === 'square') { const s = Math.max(w * 1.8, 3); return { poly: [pt.add(dir.multiply(s)).add(nrm.multiply(s)), pt.add(dir.multiply(s)).subtract(nrm.multiply(s)), pt.subtract(dir.multiply(s)).subtract(nrm.multiply(s)), pt.subtract(dir.multiply(s)).add(nrm.multiply(s))] }; }
    if (kind === 'bar') { const s = Math.max(w * 2.5, 4), t = Math.max(w * 0.6, 1); return { poly: [pt.add(nrm.multiply(s)).add(dir.multiply(t)), pt.add(nrm.multiply(s)).subtract(dir.multiply(t)), pt.subtract(nrm.multiply(s)).subtract(dir.multiply(t)), pt.subtract(nrm.multiply(s)).add(dir.multiply(t))] }; }
    if (kind === 'open') { const t = Math.max(w * 0.9, 1), tip = pt.add(dir.multiply(L * 0.35)); const b1 = tip.subtract(dir.multiply(L)).add(nrm.multiply(W)), b2 = tip.subtract(dir.multiply(L)).subtract(nrm.multiply(W)); return { poly: [tip.add(dir.multiply(t)), b1.add(nrm.multiply(-t * 0.2)).subtract(dir.multiply(0)), b1.subtract(dir.multiply(t * 1.4)), tip.subtract(dir.multiply(t * 1.8)), b2.subtract(dir.multiply(t * 1.4)), b2] }; }
    // filled triangle that starts at the end of the path
    return { poly: [pt.add(dir.multiply(L)), pt.add(nrm.multiply(W)), pt.subtract(nrm.multiply(W))] };
  }
  function arrowPaths(p) {
    const a = p.data && p.data.arrows; if (!a || p.closed || !p.strokeColor || p.className !== 'Path') return [];
    const out = [];
    for (const end of ['start', 'end']) {
      const kind = a[end]; if (!kind || kind === 'none') continue;
      const g = arrowGeom(p, end, kind, p.strokeWidth * (a.scale || 1)); if (!g) continue;
      const shape = g.circle ? new P.Path.Circle({ center: g.circle, radius: g.r, insert: false }) : new P.Path({ segments: g.poly, closed: true, insert: false });
      shape.fillColor = p.strokeColor.type === 'gradient' ? p.strokeColor.gradient.stops[end === 'end' ? p.strokeColor.gradient.stops.length - 1 : 0].color.clone() : p.strokeColor.clone();
      shape.strokeColor = null;
      out.push(shape);
    }
    return out;
  }
  VX.arrowPaths = arrowPaths;
  VX.installPatches = () => {
    if (P.Path.prototype._ro3Patched) return;
    const wrap = Cls => {
      const orig = Cls.prototype._draw;
      Cls.prototype._draw = function (ctx, param, viewMatrix, strokeMatrix) {
        const d = this._data;
        const al = d && d.strokeAlign;
        const closed = this.className === 'Path' ? this._closed : (this._children || []).every(c => c._closed);
        if (!al || al === 'center' || param.clip || param.dontStart || !closed || !this.hasStroke()) {
          orig.call(this, ctx, param, viewMatrix, strokeMatrix);
        } else {
          const v = this._style._values;
          const sc = v.strokeColor, sw = this.getStrokeWidth(), fc = v.fillColor, swRaw = v.strokeWidth;
          const local = new Path2D(this.getPathData(null, 6));
          let clipPath = local;
          if (strokeMatrix) { const m = strokeMatrix; clipPath = new Path2D(); clipPath.addPath(local, new DOMMatrix([m.a, m.b, m.c, m.d, m.tx, m.ty])); }
          const rule = this.getFillRule ? this.getFillRule() : 'nonzero';
          const setV = (k, val) => { if (val === undefined) delete v[k]; else v[k] = val; };
          if (al === 'inside') {
            setV('strokeColor', null); orig.call(this, ctx, param, viewMatrix, strokeMatrix); setV('strokeColor', sc);
            setV('fillColor', null); setV('strokeWidth', sw * 2);
            ctx.save(); ctx.clip(clipPath, rule); orig.call(this, ctx, param, viewMatrix, strokeMatrix); ctx.restore();
            setV('fillColor', fc); setV('strokeWidth', swRaw);
          } else {
            setV('fillColor', null); setV('strokeWidth', sw * 2);
            const out = new Path2D(); out.rect(-1e7, -1e7, 2e7, 2e7); out.addPath(clipPath);
            ctx.save(); ctx.clip(out, 'evenodd'); orig.call(this, ctx, param, viewMatrix, strokeMatrix); ctx.restore();
            setV('fillColor', fc); setV('strokeWidth', swRaw);
            setV('strokeColor', null); orig.call(this, ctx, param, viewMatrix, strokeMatrix); setV('strokeColor', sc);
          }
        }
        if (d && d.arrows && this.className === 'Path' && !param.clip && !param.dontStart && this.hasStroke()) {
          const shapes = arrowPaths(this);
          for (const s of shapes) {
            const pd = new Path2D(s.getPathData(null, 4));
            let p2 = pd;
            if (strokeMatrix) { const m = strokeMatrix; p2 = new Path2D(); p2.addPath(pd, new DOMMatrix([m.a, m.b, m.c, m.d, m.tx, m.ty])); }
            ctx.save(); ctx.fillStyle = s.fillColor.toCanvasStyle(ctx); ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.fill(p2); ctx.restore();
          }
        }
      };
    };
    wrap(P.Path); wrap(P.CompoundPath);
    P.Path.prototype._ro3Patched = true;
  };

  /** Turn appearance the export formats can't express (stroke alignment, arrowheads) into plain geometry. */
  VX.expandForExport = async (root) => {
    const need = root.getItems({ match: it => it.className === 'Path' || it.className === 'CompoundPath' }).filter(p => p.data && ((p.data.strokeAlign && p.data.strokeAlign !== 'center') || p.data.arrows) && p.strokeColor && p.strokeWidth > 0);
    if (!need.length) return;
    const O = await VX.needOffset();
    for (const p of need) {
      if (p.data.strokeAlign && p.data.strokeAlign !== 'center') { try { const r = outlineOf(O, p); r.insertAbove(p); p.remove(); } catch (e) { console.warn(e); } continue; }
      const arrows = arrowPaths(p); if (!arrows.length) continue;
      const g = new P.Group({ insert: false }); g.insertAbove(p); const op = p.opacity; p.opacity = 1; g.addChild(p); arrows.forEach(a => g.addChild(a)); g.opacity = op; delete p.data.arrows;
    }
  };
})();
