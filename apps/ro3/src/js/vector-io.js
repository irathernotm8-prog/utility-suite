// Vector workspace — files & fonts: .ro3d save/open, SVG import/export, PDF/AI import (pdf.js operator lists → paper.js),
// PNG/JPG/WebP/AVIF/TIFF/SVG/PDF export, Export for Screens, place images, Image Trace, font loading & Create Outlines.
(() => {
  const S = VX.S;
  const P = paper;
  const io = VX.io = {};
  const pt = (x, y) => new P.Point(x, y);
  const IMG_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif', 'ico'];
  const safeFile = s => String(s || 'untitled').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'untitled';
  const extOf = p => (String(p).split('.').pop() || '').toLowerCase();

  // =====================================================================
  // Fonts
  // =====================================================================
  const loaded = new Map(); // `${family}|${weight}|${style}` -> { family, weight, style, bytes, path, format }
  const otCache = new Map();
  const COMMON = ['Arial', 'Arial Black', 'Helvetica', 'Helvetica Neue', 'Times New Roman', 'Georgia', 'Garamond', 'Palatino', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Calibri', 'Cambria', 'Futura', 'Gill Sans', 'Avenir', 'Avenir Next', 'Optima', 'Didot', 'Baskerville', 'Rockwell', 'Impact', 'Courier New', 'Menlo', 'Consolas', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Inter', 'Source Sans Pro', 'Noto Sans', 'DejaVu Sans', 'Liberation Sans'];
  let localFonts = null; // FontData[] from the Local Font Access API, when allowed
  const weightOfStyle = s => { s = String(s || '').toLowerCase().replace(/[\s_-]/g, ''); return /thin|hairline/.test(s) ? 100 : /extralight|ultralight/.test(s) ? 200 : /light/.test(s) ? 300 : /semibold|demibold/.test(s) ? 600 : /extrabold|ultrabold/.test(s) ? 800 : /black|heavy/.test(s) ? 900 : /bold/.test(s) ? 700 : /medium/.test(s) ? 500 : 400; };
  VX.weightOfStyle = weightOfStyle;
  async function opentype() { await VX.loadScript('vendor/opentype.min.js'); return window.opentype; }
  async function queryLocal() {
    if (localFonts) return localFonts;
    localFonts = [];
    try { if (window.queryLocalFonts) localFonts = await window.queryLocalFonts(); } catch (e) { console.warn('local fonts unavailable', e.message); }
    return localFonts;
  }
  io.fontFamilies = async () => {
    const out = new Map();
    out.set('Manrope', 'bundled');
    for (const f of loaded.values()) if (!out.has(f.family)) out.set(f.family, f.embedded ? 'in document' : 'loaded');
    const lf = await queryLocal();
    for (const f of lf) if (!out.has(f.family)) out.set(f.family, 'system');
    if (!lf.length) for (const c of COMMON) if (!out.has(c)) out.set(c, 'system');
    const order = { bundled: 0, loaded: 1, 'in document': 1, system: 2 };
    return [...out].map(([family, source]) => ({ family, source })).sort((a, b) => order[a.source] - order[b.source] || a.family.localeCompare(b.family));
  };
  /** Register font bytes (ttf/otf/woff/woff2) with the page and remember them for outlines/embedding. */
  async function registerBytes(bytes, { path = null, family = null, weight = null, style = null, embedded = false } = {}) {
    let fam = family, w = weight, st = style, format = 'truetype';
    const sig = String.fromCharCode(...bytes.subarray(0, 4));
    if (sig === 'wOF2') format = 'woff2'; else if (sig === 'wOFF') format = 'woff'; else if (sig === 'OTTO') format = 'opentype';
    if (!fam && format !== 'woff2') {
      try {
        const ot = await opentype();
        const font = ot.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        const n = font.names;
        fam = (n.preferredFamily && (n.preferredFamily.en || Object.values(n.preferredFamily)[0])) || (n.fontFamily && (n.fontFamily.en || Object.values(n.fontFamily)[0]));
        const sub = (n.preferredSubfamily && (n.preferredSubfamily.en || Object.values(n.preferredSubfamily)[0])) || (n.fontSubfamily && (n.fontSubfamily.en || Object.values(n.fontSubfamily)[0])) || '';
        w = font.tables.os2 && font.tables.os2.usWeightClass ? font.tables.os2.usWeightClass : weightOfStyle(sub);
        st = /italic|oblique/i.test(sub) ? 'italic' : 'normal';
        otCache.set(`${fam}|${w}|${st}`, font);
      } catch (e) { console.warn('font parse failed', e); }
    }
    if (!fam) fam = path ? stripExt(baseName(path)).replace(/[-_](regular|bold|light|medium|black|thin|italic|semibold|extrabold|extralight).*$/i, '') : 'Custom font';
    if (!w) w = path ? weightOfStyle(stripExt(baseName(path))) : 400;
    st = st || 'normal';
    const face = new FontFace(fam, bytes, { weight: String(w), style: st });
    await face.load();
    document.fonts.add(face);
    const key = `${fam}|${w}|${st}`;
    loaded.set(key, { family: fam, weight: Number(w), style: st, bytes, path, format, embedded });
    return { family: fam, weight: w, style: st, format };
  }
  io.registerBytes = registerBytes;
  const PATHS_KEY = 'ro3.vector.fontPaths';
  io.initFonts = async () => {
    let paths = []; try { paths = JSON.parse(localStorage.getItem(PATHS_KEY) || '[]'); } catch (_) {}
    const keep = [];
    for (const p of paths) { try { await registerBytes(await ro3.readBytes(p), { path: p }); keep.push(p); } catch (e) { console.warn('font missing', p); } }
    if (keep.length !== paths.length) try { localStorage.setItem(PATHS_KEY, JSON.stringify(keep)); } catch (_) {}
  };
  io.loadFontPath = async p => {
    const r = await registerBytes(await ro3.readBytes(p), { path: p });
    let paths = []; try { paths = JSON.parse(localStorage.getItem(PATHS_KEY) || '[]'); } catch (_) {}
    if (!paths.includes(p)) { paths.push(p); try { localStorage.setItem(PATHS_KEY, JSON.stringify(paths)); } catch (_) {} }
    return r;
  };
  io.loadFontDialog = async () => {
    const ps = await ro3.openDialog({ title: 'Load font', multi: true, filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }] });
    let last = null;
    for (const p of ps || []) {
      try { last = await io.loadFontPath(p); toast(`Loaded ${last.family} ${last.weight}${last.format === 'woff2' ? ' (WOFF2 can’t be outlined — use the TTF/OTF to create outlines)' : ''}`, 'ok', 3600); }
      catch (e) { toast(`Couldn't load ${baseName(p)}: ${e.message}`, 'error'); }
    }
    VX.refreshPanels(true);
    return last && last.family;
  };
  /** Fonts used by text in the document, as base64 for portable .ro3d files. */
  io.embeddedFonts = () => {
    const used = new Set();
    S.project.getItems({ class: P.PointText }).forEach(t => used.add(t.fontFamily));
    const out = [];
    for (const f of loaded.values()) if (used.has(f.family)) out.push({ family: f.family, weight: f.weight, style: f.style, format: f.format, data: VX.b64(f.bytes) });
    return out;
  };
  io.registerEmbeddedFonts = async list => {
    for (const f of list || []) {
      if (loaded.has(`${f.family}|${f.weight}|${f.style}`)) continue;
      try { await registerBytes(VX.unb64(f.data), { family: f.family, weight: f.weight, style: f.style, embedded: true }); } catch (e) { console.warn('embedded font failed', f.family, e); }
    }
  };
  /** An opentype.js font for a family/weight, for outlines. */
  async function otFont(family, weight, italic) {
    const w = Number(VX.normW(String(weight)));
    const st = italic ? 'italic' : 'normal';
    const ot = await opentype();
    const parse = bytes => ot.parse(bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes);
    // 1. fonts loaded by the user / embedded in the document
    const cands = [...loaded.values()].filter(f => f.family.toLowerCase() === String(family).toLowerCase() && f.format !== 'woff2');
    if (cands.length) {
      const best = cands.sort((a, b) => (Math.abs(a.weight - w) + (a.style === st ? 0 : 500)) - (Math.abs(b.weight - w) + (b.style === st ? 0 : 500)))[0];
      const key = `${best.family}|${best.weight}|${best.style}`;
      if (!otCache.has(key)) otCache.set(key, parse(best.bytes));
      return otCache.get(key);
    }
    // 2. bundled Manrope (vendored WOFF files)
    if (/^manrope$/i.test(family)) {
      const ws = [200, 300, 400, 500, 600, 700, 800];
      const bw = ws.reduce((a, b) => Math.abs(b - w) < Math.abs(a - w) ? b : a);
      const key = `Manrope|${bw}|normal`;
      if (!otCache.has(key)) otCache.set(key, parse(await VX.readAppFile(`vendor/manrope/manrope-latin-${bw}-normal.woff`)));
      return otCache.get(key);
    }
    // 3. system fonts through the Local Font Access API
    const lf = (await queryLocal()).filter(f => f.family.toLowerCase() === String(family).toLowerCase());
    if (lf.length) {
      const scored = lf.map(f => ({ f, s: Math.abs(weightOfStyle(f.style) - w) + ((/italic|oblique/i.test(f.style)) === !!italic ? 0 : 500) })).sort((a, b) => a.s - b.s);
      const f = scored[0].f; const key = `local|${f.postscriptName}`;
      if (!otCache.has(key)) { const blob = await f.blob(); otCache.set(key, parse(new Uint8Array(await blob.arrayBuffer()))); }
      return otCache.get(key);
    }
    return null;
  }
  io.otFont = otFont;

  /** Type › Create Outlines: replace text with compound paths (exact glyph shapes). */
  io.outlineText = async (items) => {
    const texts = [];
    const walk = it => { if (it.className === 'PointText') texts.push(it); else if (it.children && it.className !== 'CompoundPath') it.children.forEach(walk); };
    (items || S.sel).forEach(walk);
    if (!texts.length) { if (!items) toast('Select text to convert to outlines.', 'info'); return []; }
    if (VX.textEditing()) VX.commitTextEdit();
    const failed = new Set(), out = [];
    for (const t of texts) {
      const cp = await textToPaths(t).catch(e => { console.warn(e); return null; });
      if (!cp) { failed.add(t.fontFamily); continue; }
      const pg = t.parent;
      if (pg && pg.data && pg.data.pathText) { delete pg.data.pathText; pg.name = pg.name || 'Outlined type on a path'; }
      cp.insertAbove(t); t.remove(); out.push(cp);
    }
    if (!items) {
      S.sel = S.sel.filter(x => x.parent).concat(out.filter(o => !S.sel.some(s => s.isAncestor(o))));
      VX.selectionChanged(); if (out.length) VX.commit('Create outlines');
      if (failed.size) modal({ title: 'Some text wasn’t outlined', body: `<p class="muted">RO3 needs the font file to trace exact letter shapes for: <strong>${[...failed].map(esc).join(', ')}</strong>.</p><p class="muted">Load the .ttf or .otf with Type › Load Font File… (or the button in the Character panel) and try again. WOFF2 web fonts can be used for type but not outlined.</p>`, actions: [{ label: 'Close', kind: 'ghost' }, { label: 'Load font…', kind: 'primary', onClick: () => io.loadFontDialog() }] });
      else if (out.length) toast(`Converted ${out.length} text object${out.length > 1 ? 's' : ''} to outlines`, 'ok');
    }
    return out;
  };
  async function textToPaths(t) {
    const font = await otFont(t.fontFamily, t.fontWeight, /italic/i.test(String(t.fontWeight)));
    if (!font) return null;
    const lines = String(t.content).split('\n');
    const size = t.fontSize, lead = t.leading, j = t.justification, opts = { kerning: true, tracking: t.tracking || 0 };
    let d = '';
    lines.forEach((line, i) => {
      if (!line) return;
      const adv = font.getAdvanceWidth(line, size, opts);
      const x = j === 'center' ? -adv / 2 : j === 'right' ? -adv : 0;
      d += font.getPath(line, x, i * lead, size, opts).toPathData(3);
    });
    const cp = new P.CompoundPath({ pathData: d || 'M0 0', insert: false });
    cp.fillRule = 'nonzero';
    cp.transform(t.matrix);
    cp.fillColor = t.fillColor ? t.fillColor.clone() : null;
    cp.strokeColor = t.strokeColor ? t.strokeColor.clone() : null;
    cp.strokeWidth = t.strokeWidth; cp.opacity = t.opacity; cp.blendMode = t.blendMode;
    if (cp.fillColor && cp.fillColor.type === 'gradient') { /* gradient geometry is in text space; refit to the outlines */ cp.fillColor = VX.fitGradient(cp.fillColor, cp); }
    cp.name = t.name || null;
    return cp;
  }

  // =====================================================================
  // Open / save
  // =====================================================================
  io.open = async () => {
    const ps = await ro3.openDialog({ title: 'Open design', filters: [{ name: 'Designs', extensions: ['ro3d', 'svg', 'ai', 'pdf', 'eps'] }, { name: 'All files', extensions: ['*'] }] });
    if (ps && ps[0]) return io.openPath(ps[0]);
  };
  io.openPath = async (p, opts = {}) => {
    const ext = extOf(p);
    try {
      if (ext === 'eps' || ext === 'ps') return epsHelp(p);
      if (!['ro3d', 'svg', 'ai', 'pdf'].includes(ext)) { if (IMG_EXT.includes(ext)) { if (!S.doc) VX.createDoc({ name: stripExt(baseName(p)) }); return io.placePath(p); } return toast(`RO3 Vector can't open .${ext} files.`, 'error'); }
      if (!await VX.confirmDiscard()) return;
      if (ext === 'ro3d') { await VX.deserialize(await ro3.readText(p), p); }
      else if (ext === 'svg') { await io.importSVGText(await ro3.readText(p), { newDoc: true, name: stripExt(baseName(p)) }); }
      else {
        const bytes = await ro3.readBytes(p);
        if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
          return modal({ title: 'This Illustrator file has no PDF content', body: `<p class="muted">“${esc(baseName(p))}” was saved without PDF compatibility, so RO3 can’t read it.</p><p class="muted">In Illustrator: <strong>File › Save As › Illustrator</strong> with <strong>Create PDF Compatible File</strong> checked — or export it as PDF or SVG.</p>`, actions: [{ label: 'OK', kind: 'primary' }] });
        }
        const o = opts.pdf || await pdfOptionsDialog(bytes, baseName(p));
        if (!o) return;
        await io.importPDF(bytes, { ...o, newDoc: true, name: stripExt(baseName(p)) });
      }
      if (ext === 'ro3d') S.doc.path = p;
      ro3.addRecent(p);
    } catch (e) { console.error(e); toast(`Couldn't open ${baseName(p)}: ${e.message}`, 'error', 6000); }
  };
  function epsHelp(p) {
    modal({ title: 'EPS files aren’t supported', body: `<p class="muted">RO3 can’t read Encapsulated PostScript (“${esc(baseName(p))}”).</p><p class="muted">Ask for the file as <strong>PDF</strong>, <strong>SVG</strong> or <strong>AI with PDF compatibility</strong> — or open the EPS in Illustrator, Affinity or Inkscape and save it as PDF/SVG. Those open here with paths, colors and layers intact.</p>`, actions: [{ label: 'OK', kind: 'primary' }] });
  }
  io.save = async (asNew) => {
    if (!S.doc) return;
    if (VX.textEditing()) VX.commitTextEdit();
    let p = S.doc.path;
    if (!p || asNew || extOf(p) !== 'ro3d') {
      p = await ro3.saveDialog({ title: 'Save design', defaultPath: safeFile(S.doc.name) + '.ro3d', filters: [{ name: 'RO3 Vector Design', extensions: ['ro3d'] }] });
      if (!p) return false;
      if (!/\.ro3d$/i.test(p)) p += '.ro3d';
    }
    try {
      await ro3.writeText(p, VX.serialize());
      S.doc.path = p; S.doc.name = stripExt(baseName(p)); S.doc.dirty = false;
      ro3.addRecent(p); ro3.autosaveClear('vector.ro3d');
      VX.refreshPanels(); toast(`Saved ${baseName(p)}`, 'ok');
      return true;
    } catch (e) { toast(`Couldn't save: ${e.message}`, 'error'); return false; }
  };
  io.waitRasters = () => Promise.all(S.project.getItems({ class: P.Raster }).map(r => r.loaded ? null : new Promise(res => { const t = setTimeout(res, 4000); r.onLoad = () => { clearTimeout(t); res(); }; r.onError = () => { clearTimeout(t); res(); }; })));

  // =====================================================================
  // Place
  // =====================================================================
  io.place = async () => {
    const ps = await ro3.openDialog({ title: 'Place', multi: true, filters: [{ name: 'Images & vectors', extensions: [...IMG_EXT, 'svg', 'pdf', 'ai'] }] });
    if (!ps || !ps.length) return;
    if (!S.doc) { VX.createDoc({ name: 'Untitled' }); }
    for (const p of ps) await io.placePath(p);
  };
  io.placePath = async (p, at) => {
    const ext = extOf(p);
    try {
      if (ext === 'ro3d') return io.openPath(p);
      if (ext === 'eps') return epsHelp(p);
      if (ext === 'svg') return io.importSVGText(await ro3.readText(p), { place: true, at, name: stripExt(baseName(p)) });
      if (ext === 'pdf' || ext === 'ai') { const bytes = await ro3.readBytes(p); if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') return toast('This .ai file has no PDF content. Re-save it with “Create PDF Compatible File”.', 'error', 6000); return io.importPDF(bytes, { place: true, at, name: stripExt(baseName(p)), text: 'outline', pages: [1] }); }
      let url;
      if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) { const b = await ro3.readBytes(p); url = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${VX.b64(b)}`; }
      else url = (await ro3.decodeImage(p)).dataUrl;
      return io.placeDataURL(url, stripExt(baseName(p)), at);
    } catch (e) { console.error(e); toast(`Couldn't place ${baseName(p)}: ${e.message}`, 'error'); }
  };
  io.placeDataURL = async (url, name, at) => {
    if (!S.doc) VX.createDoc({ name: 'Untitled' });
    const r = new P.Raster({ source: url, insert: false });
    await new Promise((res, rej) => { if (r.loaded) return res(); r.onLoad = res; r.onError = () => rej(new Error('The image could not be decoded.')); });
    (S.isolation || S.project.activeLayer).addChild(r);
    r.name = name || null;
    const ab = S.doc.artboards[S.doc.ab];
    const fit = Math.min(1, ab.w / r.width, ab.h / r.height);
    if (fit < 1) r.scale(fit);
    r.position = at || (VX.abRect(ab).intersects(S.view.bounds) ? VX.abRect(ab).center : S.view.center);
    VX.select([r]); VX.commit('Place image');
    return r;
  };

  // =====================================================================
  // SVG import
  // =====================================================================
  function inlineStyles(doc) {
    // Illustrator & Figma SVGs style through <style> classes, which paper.js ignores: copy rules onto the elements.
    const sheets = [...doc.querySelectorAll('style')];
    for (const st of sheets) {
      const css = st.textContent.replace(/\/\*[\s\S]*?\*\//g, '');
      const rules = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)];
      rules.forEach(([, sels, decls]) => {
        for (const sel of sels.split(',').map(s => s.trim()).filter(Boolean)) {
          let els = []; try { els = [...doc.querySelectorAll(sel)]; } catch (_) { continue; }
          for (const el of els) el.setAttribute('style', decls.trim().replace(/;?$/, ';') + (el.getAttribute('style') || ''));
        }
      });
      st.remove();
    }
    doc.querySelectorAll('script, foreignObject').forEach(n => n.remove());
    splitTspans(doc);
  }
  /** Illustrator positions runs of one <text> with absolutely placed <tspan>s; make each run its own <text>. */
  function splitTspans(doc) {
    for (const t of [...doc.querySelectorAll('text')]) {
      const spans = [...t.children].filter(c => c.nodeName === 'tspan');
      if (!spans.some(s => s.hasAttribute('x') || s.hasAttribute('y'))) continue;
      let cur = { x: parseFloat(t.getAttribute('x')) || 0, y: parseFloat(t.getAttribute('y')) || 0, text: '', el: null };
      const runs = [cur];
      for (const n of t.childNodes) {
        if (n.nodeType === 3) { cur.text += n.textContent; continue; }
        if (n.nodeName !== 'tspan') continue;
        const nx = n.hasAttribute('x') ? parseFloat(n.getAttribute('x')) : null, ny = n.hasAttribute('y') ? parseFloat(n.getAttribute('y')) : null;
        if (nx != null || ny != null) { cur = { x: nx != null ? nx : cur.x, y: ny != null ? ny : cur.y, text: '', el: n }; runs.push(cur); }
        else if (!cur.el) cur.el = n;
        cur.text += n.textContent;
      }
      for (const r of runs) {
        if (!r.text.trim()) continue;
        const nt = t.cloneNode(false);
        nt.setAttribute('x', r.x); nt.setAttribute('y', r.y);
        if (r.el) for (const a of r.el.attributes) { if (['x', 'y', 'dx', 'dy'].includes(a.name)) continue; nt.setAttribute(a.name, a.name === 'style' ? (nt.getAttribute('style') || '') + ';' + a.value : a.value); }
        nt.textContent = r.text;
        t.parentNode.insertBefore(nt, t);
      }
      t.remove();
    }
  }
  io.importSVGText = async (text, { newDoc = false, place = false, at = null, name = 'Imported' } = {}) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (doc.querySelector('parsererror') || !doc.documentElement || doc.documentElement.nodeName.toLowerCase() !== 'svg') throw new Error('This SVG file could not be read.');
    inlineStyles(doc);
    const root = doc.documentElement;
    const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const len = v => { const m = /^([\d.]+)\s*(px|pt|in|mm|cm|pc)?$/.exec(String(v || '').trim()); if (!m) return null; const f = { px: 1, pt: 4 / 3, in: 96, mm: 96 / 25.4, cm: 96 / 2.54, pc: 16 }[m[2] || 'px']; return Number(m[1]) * f; };
    let w = len(root.getAttribute('width')), hh = len(root.getAttribute('height'));
    if ((!w || !hh) && vb.length === 4 && vb[2] > 0) { w = vb[2]; hh = vb[3]; }
    w = w || 1000; hh = hh || 1000;
    if (newDoc) { VX.resetDoc(VX.freshDocMeta({ name, w, h: hh, units: 'px' })); new P.Layer({ name: 'Layer 1' }); }
    const item = S.project.importSVG(root, { expandShapes: true, insert: false });
    if (!item) throw new Error('Nothing could be imported from this SVG.');
    // drop the viewBox clip that wraps the whole drawing
    const clip = item.children && item.children.find(c => c.clipMask && c.className === 'Shape');
    if (clip) { clip.remove(); item.clipped = false; }
    clean(item);
    if (newDoc) {
      const L = S.project.activeLayer;
      const kids = item.removeChildren();
      // Top-level SVG groups named like layers (Illustrator exports layers as <g id="Layer_1">) become layers.
      const layerish = kids.length >= 1 && kids.every(k => k.className === 'Group' && !k.clipped && k.matrix.isIdentity() && k.opacity === 1 && (k.name || kids.length === 1));
      if (layerish) { L.remove(); for (const k of kids) { const nl = new P.Layer({ name: (k.name || 'Layer 1').replace(/_/g, ' ') }); nl.addChildren(k.removeChildren()); } }
      else L.addChildren(kids);
      S.project.layers[S.project.layers.length - 1].activate();
      await io.waitRasters();
      VX.pushInitial(); VX.afterDocLoad();
      toast(`Opened ${name}`, 'ok');
      return;
    }
    if (!S.doc) VX.createDoc({ name });
    (S.isolation || S.project.activeLayer).addChild(item);
    item.name = name;
    if (item.children.length === 1 && !item.clipped) { const only = item.firstChild; only.insertAbove(item); item.remove(); return finishPlace(only, at, place); }
    return finishPlace(item, at, place);
  };
  async function finishPlace(item, at, place) {
    await io.waitRasters();
    const ab = S.doc.artboards[S.doc.ab];
    if (place) {
      const target = at || (VX.abRect(ab).intersects(S.view.bounds) ? VX.abRect(ab).center : S.view.center);
      item.position = target;
    }
    VX.select([item]); VX.commit('Place');
    return item;
  }
  function clean(item) {
    // paper.js may import empty groups and default black fills on <g>; tidy a little
    for (const c of item.getItems({ class: P.Group })) if (!c.children.length) c.remove();
    for (const r of item.getItems({ class: P.Shape })) { const p = r.toPath(false); p.insertAbove(r); r.remove(); }
  }

  // =====================================================================
  // Export helpers
  // =====================================================================
  /** A prepared copy of the document in a temporary paper.js project (hidden items removed, appearance expanded). */
  async function exportProject({ outline = false, rect = null, items = null } = {}) {
    const json = items ? null : S.project.exportJSON({ asString: true });
    const itemJson = items ? items.map(it => it.exportJSON({ asString: true })) : null;
    const main = S.project;
    const tmp = new P.Project(document.createElement('canvas'));
    try {
      if (json) tmp.importJSON(json); else { const L = new P.Layer(); itemJson.forEach(j => L.addChild(P.Base.importJSON(j))); }
      tmp.getItems({ match: it => !it.visible }).forEach(it => it.remove());
      for (const L of tmp.layers) if (!L.visible) L.remove();
      if (rect) for (const L of tmp.layers) for (const c of L.children.slice()) if (!c.strokeBounds.intersects(rect.expand(1))) c.remove();
      await VX.expandForExport(tmp);
      if (outline) { const texts = tmp.getItems({ class: P.PointText }); for (const t of texts) { const cp = await textToPaths(t).catch(() => null); if (cp) { cp.insertAbove(t); t.remove(); } } }
      // clean SVG: no paper.js data attributes
      tmp.getItems({}).forEach(it => { it.data = {}; });
      for (const L of tmp.layers) { L.data = {}; if (!L.name) L.name = null; }
      await new Promise(r => setTimeout(r, 0));
      return tmp;
    } finally { main.activate(); }
  }
  function fontFaceCss(families) {
    let css = '';
    for (const f of loaded.values()) if (families.has(f.family)) css += `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:${f.style};src:url(data:font/${f.format === 'opentype' ? 'otf' : f.format === 'truetype' ? 'ttf' : f.format};base64,${VX.b64(f.bytes)}) format("${f.format}");}`;
    return css;
  }
  async function manropeCss(weights) {
    let css = '';
    for (const w of weights) { try { const b = await VX.readAppFile(`fonts/manrope-latin-${w}-normal.woff2`); css += `@font-face{font-family:"Manrope";font-weight:${w};src:url(data:font/woff2;base64,${VX.b64(b)}) format("woff2");}`; } catch (_) {} }
    return css;
  }
  async function svgString(tmp, rect, { precision = 3, minify = false, embedFonts = true } = {}) {
    let svg = tmp.exportSVG({ asString: true, bounds: rect, precision, embedImages: true, matchShapes: false });
    const texts = tmp.getItems({ class: P.PointText });
    if (embedFonts && texts.length) {
      const fams = new Set(texts.map(t => t.fontFamily));
      let css = fontFaceCss(fams);
      if (fams.has('Manrope') && ![...loaded.values()].some(f => f.family === 'Manrope')) css += await manropeCss([...new Set(texts.filter(t => t.fontFamily === 'Manrope').map(t => { const w = Number(VX.normW(String(t.fontWeight))); return [400, 500, 600, 700, 800].reduce((a, b) => Math.abs(b - w) < Math.abs(a - w) ? b : a); }))]);
      if (css) svg = svg.replace(/(<svg[^>]*>)/, `$1<style>${css}</style>`);
    }
    if (minify) svg = svg.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').replace(/(\d)\.0+(?=[\s,"LMCZlmcz])/g, '$1');
    else if (!svg.startsWith('<?xml')) svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg;
    return svg;
  }
  io.selectionSVG = (items) => {
    const tmp = new P.Project(document.createElement('canvas'));
    try {
      const L = new P.Layer(); items.forEach(it => L.addChild(P.Base.importJSON(it.exportJSON({ asString: true }))));
      tmp.getItems({}).forEach(it => { it.data = {}; });
      return tmp.exportSVG({ asString: true, bounds: 'content', precision: 3, embedImages: true });
    } finally { tmp.remove(); S.project.activate(); }
  };
  /** Render a rectangle of the document to a canvas at `scale` (1 = 1 px per unit). */
  async function renderCanvas(rect, scale, { transparent = false, bg = '#ffffff', items = null } = {}) {
    if (VX.textEditing()) VX.commitTextEdit();
    await document.fonts.ready;
    let w = Math.max(1, Math.round(rect.width * scale)), hh = Math.max(1, Math.round(rect.height * scale));
    const maxSide = 16384, maxArea = 16384 * 16384 / 2;
    const k = Math.min(1, maxSide / w, maxSide / hh, Math.sqrt(maxArea / (w * hh)));
    if (k < 1) { scale *= k; w = Math.round(rect.width * scale); hh = Math.round(rect.height * scale); toast('The export was limited to ' + w + ' × ' + hh + ' px (canvas size limit).', 'info', 5000); }
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    const ctx = c.getContext('2d');
    if (!transparent) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, hh); }
    const m = new P.Matrix().scale(w / rect.width, hh / rect.height).translate(-rect.x, -rect.y);
    let hidden = [];
    if (items) { // only these items: hide everything else temporarily
      const keep = new Set(); items.forEach(it => { for (let x = it; x; x = x.parent) keep.add(x); });
      S.project.getItems({}).forEach(it => { if (!keep.has(it) && !items.some(s => s.isAncestor(it)) && it.visible) { hidden.push(it); it.visible = false; } });
    }
    try { S.project.draw(ctx, m, 1); } finally { hidden.forEach(it => { it.visible = true; }); VX.req(); }
    return c;
  }
  io.renderCanvas = renderCanvas;
  const canvasBytes = (c, type = 'image/png', q) => new Promise((res, rej) => c.toBlob(b => b ? b.arrayBuffer().then(a => res(new Uint8Array(a))) : rej(new Error('Rendering failed')), type, q));
  async function writeRaster(canvas, out, format, quality, transparent) {
    const png = await canvasBytes(canvas);
    if (format === 'png') { await ro3.writeBytes(out, png); return; }
    await ro3.exportImage(png, { format, output: out, quality, background: transparent ? undefined : '#ffffff' });
  }
  const abBg = a => a && a.bg && a.bg !== 'transparent' ? a.bg : '#ffffff';
  /** Common export: format, scope, scale. Returns the written paths. */
  io.exportTo = async ({ format = 'png', scope = 'artboard', scale = 1, transparent = false, quality = 90, outline = false, minify = false, embedFonts = true, out, abIndex = null, suffix = '' }) => {
    const d = S.doc;
    const targets = scope === 'selection' ? [{ name: 'selection', rect: VX.selBounds() && (VX.selBounds().clone()), items: S.sel.slice() }]
      : (scope === 'all' ? d.artboards.map((a, i) => ({ a, i })) : [{ a: d.artboards[abIndex == null ? d.ab : abIndex], i: abIndex == null ? d.ab : abIndex }]).map(({ a, i }) => ({ name: a.name, rect: VX.abRect(a), ab: a, i }));
    if (scope === 'selection') { if (!S.sel.length) throw new Error('Select something to export first.'); const sb = S.sel.reduce((r, it) => r ? r.unite(it.strokeBounds) : it.strokeBounds.clone(), null); targets[0].rect = sb; }
    const written = [];
    const multi = targets.length > 1;
    const pathFor = (t, ext) => { if (!multi) return out; const base = out.replace(/\.[^.\\/]+$/, ''); return `${base}-${safeFile(t.name)}${suffix}.${ext}`; };
    if (format === 'pdf') {
      const tmp = await exportProject({ outline });
      try {
        const pages = [];
        for (const t of targets) pages.push({ svg: await svgString(tmp, t.rect, { precision: 3, embedFonts: true }), w: +t.rect.width.toFixed(3), h: +t.rect.height.toFixed(3) });
        await ro3.vectorPdf(pages, out, { title: (S.doc && S.doc.name) || 'RO3 Vector' }); written.push(out);
      } finally { tmp.remove(); S.project.activate(); }
      return written;
    }
    if (format === 'svg') {
      const tmp = scope === 'selection' ? await exportProject({ outline, items: targets[0].items }) : await exportProject({ outline });
      try {
        for (const t of targets) { const p = pathFor(t, 'svg'); await ro3.writeText(p, await svgString(tmp, t.rect, { precision: minify ? 2 : 3, minify, embedFonts })); written.push(p); }
      } finally { tmp.remove(); S.project.activate(); }
      return written;
    }
    for (const t of targets) {
      const c = await renderCanvas(t.rect, scale, { transparent, bg: abBg(t.ab), items: t.items });
      const p = pathFor(t, format === 'jpeg' ? 'jpg' : format);
      await writeRaster(c, p, format, quality, transparent); written.push(p);
    }
    return written;
  };

  // ---------- Export dialog ----------
  io.exportDialog = async (fmt) => {
    if (!S.doc) return toast('Create or open a design first.', 'error');
    if (VX.textEditing()) VX.commitTextEdit();
    const d = S.doc, a = d.artboards[d.ab];
    let st = { format: fmt || localStorage.getItem('ro3.vector.expfmt') || 'png', scope: S.sel.length && !fmt ? 'artboard' : 'artboard', scaleMode: '1', custom: 100, transparent: false, quality: 90, outline: false, minify: false, embedFonts: true };
    const body = h(`<div class="stack vx-export">
      <div class="seg vx-fmt">${['png', 'jpg', 'webp', 'avif', 'tiff', 'svg', 'pdf'].map(f => `<button data-f="${f}">${f.toUpperCase()}</button>`).join('')}</div>
      <label class="field"><span>Export</span><select data-k="scope"><option value="artboard">Current artboard — ${esc(a.name)}</option><option value="all">All artboards (${d.artboards.length})</option><option value="selection" ${S.sel.length ? '' : 'disabled'}>Selection</option></select></label>
      <div class="vx-x-raster stack">
        <label class="field"><span>Size</span><select data-k="scale"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2× (retina)</option><option value="3">3×</option><option value="4">4×</option><option value="150ppi">150 ppi</option><option value="300ppi">300 ppi (print)</option><option value="custom">Custom…</option></select></label>
        <label class="field vx-x-custom" hidden><span>Scale</span><span class="num-wrap"><input type="number" data-k="custom" value="100" min="1" max="5000"><em>%</em></span></label>
        <label class="check vx-x-transp"><input type="checkbox" data-k="transparent"><span class="check-box">${icon('check')}</span><span>Transparent background</span></label>
        <div class="vx-x-quality"></div>
      </div>
      <div class="vx-x-vector stack">
        <label class="check"><input type="checkbox" data-k="outline"><span class="check-box">${icon('check')}</span><span>Convert text to outlines</span></label>
        <label class="check vx-x-svgonly"><input type="checkbox" data-k="embedFonts" checked><span class="check-box">${icon('check')}</span><span>Embed custom fonts</span></label>
        <label class="check vx-x-svgonly"><input type="checkbox" data-k="minify"><span class="check-box">${icon('check')}</span><span>Minify</span></label>
      </div>
      <p class="hint vx-x-info"></p></div>`);
    const q = k => $(`[data-k="${k}"]`, body);
    if (d.units === 'in' || d.units === 'mm') q('scale').value = '300ppi'; // print documents: export at print resolution
    const qs = slider({ label: 'Quality', min: 30, max: 100, value: 90, unit: '%' });
    $('.vx-x-quality', body).appendChild(qs);
    const scaleOf = () => { const v = q('scale').value; if (v === 'custom') return Math.max(0.01, Number(q('custom').value) / 100); if (v.endsWith('ppi')) return parseInt(v, 10) / 72; return Number(v); };
    const paint = () => {
      const f = st.format, raster = !['svg', 'pdf'].includes(f);
      $$('.vx-fmt button', body).forEach(b => b.classList.toggle('on', b.dataset.f === f));
      $('.vx-x-raster', body).hidden = !raster; $('.vx-x-vector', body).hidden = raster;
      $$('.vx-x-svgonly', body).forEach(x => { x.hidden = f !== 'svg'; });
      $('.vx-x-transp', body).hidden = f === 'jpg';
      $('.vx-x-quality', body).hidden = !['jpg', 'webp', 'avif'].includes(f);
      $('.vx-x-custom', body).hidden = q('scale').value !== 'custom';
      if (f === 'pdf') q('scope').querySelector('[value="selection"]').disabled = true;
      else q('scope').querySelector('[value="selection"]').disabled = !S.sel.length;
      if (f === 'pdf' && q('scope').value === 'selection') q('scope').value = 'artboard';
      const s = scaleOf(); const r = q('scope').value === 'selection' && S.sel.length ? VX.selBounds() : VX.abRect(a);
      const sizes = d.artboards.map(x => `${Math.round(x.w)}×${Math.round(x.h)}`);
      $('.vx-x-info', body).textContent = raster ? `${Math.round(r.width * s)} × ${Math.round(r.height * s)} px${q('scope').value === 'all' ? ' (current artboard)' : ''}`
        : f === 'pdf' ? `Vector PDF, ${q('scope').value === 'all' ? d.artboards.length + ' pages' : '1 page'} at ${(a.w / 72).toFixed(2)} × ${(a.h / 72).toFixed(2)} in.${q('scope').value === 'all' && new Set(sizes).size > 1 ? ' Each page keeps its own artboard’s size.' : ''}` : 'Each artboard becomes its own SVG file, cropped to the artboard.';
    };
    $$('.vx-fmt button', body).forEach(b => b.addEventListener('click', () => { st.format = b.dataset.f; paint(); }));
    ['scope', 'scale', 'custom'].forEach(k => q(k).addEventListener('change', paint));
    q('custom').addEventListener('input', paint);
    paint();
    modal({ title: 'Export', body, width: 460, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Export…', kind: 'primary', onClick: async () => {
      const f = st.format, scope = q('scope').value;
      try { localStorage.setItem('ro3.vector.expfmt', f); } catch (_) {}
      const ext = f === 'jpg' ? 'jpg' : f;
      const nm = scope === 'all' ? safeFile(d.name) : scope === 'selection' ? safeFile(d.name) + '-selection' : safeFile(d.artboards.length > 1 ? `${d.name}-${a.name}` : d.name);
      const out = await ro3.saveDialog({ title: 'Export', defaultPath: `${nm}.${ext}`, filters: [{ name: f.toUpperCase(), extensions: [ext] }] });
      if (!out) return false;
      try {
        const written = await io.exportTo({ format: f, scope, scale: scaleOf(), transparent: q('transparent').checked, quality: qs.get(), outline: q('outline').checked, minify: q('minify').checked, embedFonts: q('embedFonts').checked, out: /\.[a-z0-9]+$/i.test(out) ? out : out + '.' + ext });
        toast(`Exported ${written.length > 1 ? written.length + ' files' : baseName(written[0])}`, 'ok', 4000);
      } catch (e) { console.error(e); toast(`Export failed: ${e.message}`, 'error', 6000); return false; }
    } }] });
  };

  // ---------- Export for Screens ----------
  io.exportScreens = async () => {
    if (!S.doc) return toast('Create or open a design first.', 'error');
    const d = S.doc;
    const rows = JSON.parse(localStorage.getItem('ro3.vector.screens') || 'null') || [{ scale: 1, suffix: '', format: 'png' }, { scale: 2, suffix: '@2x', format: 'png' }];
    const body = h(`<div class="stack vx-screens"><div class="vx-sc-abs">${d.artboards.map((a, i) => `<label class="check"><input type="checkbox" data-ab="${i}" checked><span class="check-box">${icon('check')}</span><span>${i + 1}. ${esc(a.name)} <em class="muted">${Math.round(a.w)}×${Math.round(a.h)}</em></span></label>`).join('')}</div>
      <h4>Formats</h4><div class="vx-sc-rows"></div><button class="btn btn-sm vx-sc-add">${icon('plus')}Add scale</button>
      <label class="field"><span>File name prefix</span><input type="text" data-k="prefix" value="${esc(safeFile(d.name))}-"></label>
      <label class="check"><input type="checkbox" data-k="transparent"><span class="check-box">${icon('check')}</span><span>Transparent background (PNG/WebP)</span></label></div>`);
    const paintRows = () => {
      const box = $('.vx-sc-rows', body); box.innerHTML = '';
      rows.forEach((r, i) => {
        const el = h(`<div class="vx-sc-row"><select data-r="scale">${[0.5, 1, 1.5, 2, 3, 4].map(s => `<option value="${s}" ${s === r.scale ? 'selected' : ''}>${s}×</option>`).join('')}</select><input data-r="suffix" class="inline" value="${esc(r.suffix)}" placeholder="suffix"><select data-r="format">${['png', 'jpg', 'webp', 'svg', 'pdf'].map(f => `<option value="${f}" ${f === r.format ? 'selected' : ''}>${f.toUpperCase()}</option>`).join('')}</select><button class="icon-btn" title="Remove">${icon('x')}</button></div>`);
        $$('[data-r]', el).forEach(x => x.addEventListener('change', () => { r[x.dataset.r] = x.dataset.r === 'scale' ? Number(x.value) : x.value; }));
        $('button', el).addEventListener('click', () => { rows.splice(i, 1); paintRows(); });
        box.appendChild(el);
      });
    };
    $('.vx-sc-add', body).addEventListener('click', () => { rows.push({ scale: 3, suffix: '@3x', format: 'png' }); paintRows(); });
    paintRows();
    modal({ title: 'Export for screens', body, width: 480, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Export artboards…', kind: 'primary', onClick: async () => {
      const abs = $$('[data-ab]', body).filter(x => x.checked).map(x => Number(x.dataset.ab));
      if (!abs.length || !rows.length) { toast('Choose at least one artboard and one format.', 'error'); return false; }
      try { localStorage.setItem('ro3.vector.screens', JSON.stringify(rows)); } catch (_) {}
      const prefix = $('[data-k="prefix"]', body).value;
      let dir = ro3.folderDialog ? await ro3.folderDialog() : null;
      if (!dir) { const p = await ro3.saveDialog({ title: 'Choose where to export', defaultPath: prefix + 'artboards.png' }); if (!p) return false; dir = dirName(p); }
      return io.exportScreensTo(dir, { abs, rows, prefix, transparent: $('[data-k="transparent"]', body).checked });
    } }] });
  };
  io.exportScreensTo = async (dir, { abs, rows, prefix = '', transparent = false }) => {
    const d = S.doc; const written = [];
    const prog = progressBox('Exporting artboards');
    try {
      let n = 0; const total = abs.length * rows.length;
      for (const i of abs) for (const r of rows) {
        const a = d.artboards[i];
        const ext = r.format;
        const out = joinPath(dir, `${prefix}${safeFile(a.name)}${r.suffix || ''}.${ext}`);
        const w = await io.exportTo({ format: r.format, scope: 'artboard', abIndex: i, scale: r.scale, transparent, out });
        written.push(...w);
        prog.set(++n / total, `${a.name} ${r.scale}×`);
      }
    } catch (e) { prog.close(); toast(`Export failed: ${e.message}`, 'error', 6000); return written; }
    prog.close();
    toast(`Exported ${written.length} files`, 'ok', 4000);
    if (written[0] && !window.RO3_SMOKE_NOSHOW) ro3.showInFolder(written[0]).catch(() => {});
    return written;
  };

  // ---------- Rasterize ----------
  io.rasterizeSelection = async () => {
    if (!S.sel.length) return toast('Select objects to rasterize.', 'info');
    const items = VX.sortByZ(S.sel);
    const r = items.reduce((a, it) => a ? a.unite(it.strokeBounds) : it.strokeBounds.clone(), null);
    const c = await renderCanvas(r, 300 / 72, { transparent: true, items });
    const ras = new P.Raster({ source: c.toDataURL('image/png'), insert: false });
    await new Promise(res => { if (ras.loaded) res(); else ras.onLoad = res; });
    ras.insertAbove(items[items.length - 1]);
    ras.scale(r.width / ras.width, r.height / ras.height); ras.position = r.center;
    items.forEach(it => it.remove());
    VX.select([ras]); VX.commit('Rasterize');
  };

  // =====================================================================
  // Image Trace
  // =====================================================================
  const TRACE_PRESETS = {
    bw: { label: 'Black & white logo', mode: 'bw', threshold: 128, detail: 60, smooth: 40, ignoreWhite: true },
    silhouette: { label: 'Silhouette', mode: 'bw', threshold: 200, detail: 40, smooth: 60, ignoreWhite: true },
    logo: { label: 'Logo (few colors)', mode: 'color', colors: 4, detail: 60, smooth: 40, ignoreWhite: false },
    color: { label: 'Color (16)', mode: 'color', colors: 16, detail: 70, smooth: 20, ignoreWhite: false },
    detailed: { label: 'Detailed color (32)', mode: 'color', colors: 32, detail: 90, smooth: 10, ignoreWhite: false },
    gray: { label: 'Grayscale', mode: 'gray', colors: 8, detail: 70, smooth: 20, ignoreWhite: false },
  };
  io.TRACE_PRESETS = TRACE_PRESETS;
  let traceWorker = null;
  function traceSvg(imageData, opts) {
    if (!traceWorker) traceWorker = new Worker('js/vector-trace-worker.js');
    return new Promise((res, rej) => {
      const id = uid('tr');
      const on = e => { if (e.data.id !== id) return; traceWorker.removeEventListener('message', on); if (e.data.error) rej(new Error(e.data.error)); else res(e.data.svg); };
      traceWorker.addEventListener('message', on);
      traceWorker.postMessage({ id, imageData, opts });
    });
  }
  function rasterPixels(r, maxSide) {
    const src = r.getSubCanvas ? r.getSubCanvas(new P.Rectangle(0, 0, r.width, r.height)) : r.canvas;
    const k = Math.min(1, maxSide / Math.max(r.width, r.height));
    // Upscale small images: the tracer works on whole pixels, so more pixels give smoother, truer curves.
    const side = Math.max(r.width, r.height);
    const up = side < maxSide * 0.6 ? Math.min(4, (maxSide * 0.65) / side) : 1;
    const s = k < 1 ? k : up;
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(r.width * s)); c.height = Math.max(1, Math.round(r.height * s));
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, c.width, c.height);
    return { data: ctx.getImageData(0, 0, c.width, c.height), scale: s };
  }
  function preprocess(img, o) {
    const d = img.data;
    if (o.mode === 'bw') {
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3] / 255, l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * a + 255 * (1 - a);
        const v = l < o.threshold ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
    } else if (o.mode === 'gray') {
      for (let i = 0; i < d.length; i += 4) { const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = l; }
    }
    return img;
  }
  function tracerOptions(o) {
    const det = clamp(o.detail, 0, 100) / 100, sm = clamp(o.smooth, 0, 100) / 100;
    // Detail drops specks; smoothness trades exact corners for fewer, rounder curves.
    const base = { ltres: 0.6 + sm * 2.4, qtres: 0.6 + sm * 2.4, pathomit: Math.round(2 + (1 - det) * 24), rightangleenhance: sm < 0.7, colorsampling: 2, numberofcolors: o.colors || 16, mincolorratio: o.mode === 'color' && (o.colors || 16) <= 8 ? 0.01 : 0, colorquantcycles: 3, strokewidth: 0, linefilter: det < 0.4, roundcoords: 2, viewbox: true, blurradius: sm > 0.75 ? 1 : 0, blurdelta: 20 };
    if (o.mode === 'bw') { base.pal = [{ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }]; base.colorquantcycles = 1; base.blurradius = 0; }
    if (o.mode === 'gray') { base.colorsampling = 0; base.colorquantcycles = 1; }
    return base;
  }
  async function runTrace(r, o, maxSide) {
    const { data, scale } = rasterPixels(r, maxSide);
    const svg = await traceSvg(preprocess(data, o), tracerOptions(o));
    return { svg, scale, w: data.width, h: data.height };
  }
  /** Build vector paths from a trace result, placed over raster `r`. */
  function buildTrace(res, r, o) {
    const doc = new DOMParser().parseFromString(res.svg, 'image/svg+xml');
    const g = S.project.importSVG(doc.documentElement, { insert: false, expandShapes: true });
    const clip = g.children.find(c => c.clipMask); if (clip) { clip.remove(); g.clipped = false; }
    const paths = g.getItems({ match: it => it.className === 'Path' || it.className === 'CompoundPath' });
    for (const p of paths) {
      const op = p.opacity; const c = p.fillColor;
      if (!c || op === 0 || (c.alpha != null && c.alpha === 0)) { p.remove(); continue; }
      if (o.ignoreWhite && c.red > 0.94 && c.green > 0.94 && c.blue > 0.94) { p.remove(); continue; }
      p.strokeColor = null; p.opacity = 1;
      if (o.smooth > 80) (p.className === 'CompoundPath' ? p.children : [p]).forEach(k => { if (k.segments.length > 8) k.simplify((o.smooth - 80) / 20 * 1.2 * res.scale); });
    }
    // merge same-colored regions into compound paths per color (cleaner, editable result)
    const byColor = new Map(), reps = [];
    const near = (a, b) => Math.hypot(a.red - b.red, a.green - b.green, a.blue - b.blue) < 0.045; // anti-aliasing leftovers
    for (const p of g.getItems({ match: it => (it.className === 'Path' || it.className === 'CompoundPath') && it.parent && it.parent.className !== 'CompoundPath' })) {
      let rep = reps.find(c => near(c, p.fillColor));
      if (!rep) { rep = p.fillColor.clone(); reps.push(rep); }
      // Geometry is only merged for identical colors (holes stay holes); near-identical ones just share the color.
      const k = p.fillColor.toCSS(true); if (!byColor.has(k)) byColor.set(k, { rep, list: [] }); byColor.get(k).list.push(p);
    }
    const out = new P.Group({ insert: false });
    for (const [, { rep, list }] of byColor) {
      const cp = new P.CompoundPath({ insert: false }); cp.fillColor = rep.clone(); cp.fillRule = 'evenodd';
      for (const p of list) { const kids = p.className === 'CompoundPath' ? p.removeChildren() : [p]; for (const kid of kids) { if (kid.parent) kid.remove(); cp.addChild(kid); } }
      cp.children.forEach(c => { c.style = null; });
      out.addChild(cp);
    }
    // map tracer pixel space onto the raster's placement
    const m = r.globalMatrix.clone().append(new P.Matrix().translate(-r.width / 2, -r.height / 2)).append(new P.Matrix().scale(1 / res.scale));
    if (r.parent && !VX.isLayer(r.parent)) m.prepend(r.parent.globalMatrix.inverted());
    out.transform(m);
    out.name = (r.name ? r.name + ' ' : '') + 'trace';
    return out;
  }
  io.trace = async (r, o) => {
    const res = await runTrace(r, o, o.maxSide || 1600);
    const g = buildTrace(res, r, o);
    g.insertAbove(r);
    if (!o.keepImage) r.remove(); else r.visible = false;
    VX.select([g]); VX.commit('Image trace');
    return g;
  };
  io.traceDialog = async () => {
    const r = S.sel.find(it => it.className === 'Raster');
    if (!r) return toast('Select a placed image to trace.', 'info');
    let o = { ...TRACE_PRESETS.bw, preset: 'bw', keepImage: false };
    try { const saved = JSON.parse(localStorage.getItem('ro3.vector.trace') || 'null'); if (saved) o = { ...o, ...saved }; } catch (_) {}
    const body = h(`<div class="vx-trace"><div class="vx-trace-prev trace-preview"><span>Tracing…</span></div><div class="stack vx-trace-opts">
      <label class="field"><span>Preset</span><select data-k="preset">${Object.entries(TRACE_PRESETS).map(([k, p]) => `<option value="${k}" ${k === o.preset ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label>
      <div class="vx-tr-sliders"></div>
      <label class="check"><input type="checkbox" data-k="ignoreWhite" ${o.ignoreWhite ? 'checked' : ''}><span class="check-box">${icon('check')}</span><span>Ignore white</span></label>
      <label class="check"><input type="checkbox" data-k="keepImage" ${o.keepImage ? 'checked' : ''}><span class="check-box">${icon('check')}</span><span>Keep the original image (hidden)</span></label>
      <p class="hint vx-tr-info"></p></div></div>`);
    const sl = $('.vx-tr-sliders', body);
    let sliders = {};
    const build = () => {
      sl.innerHTML = ''; sliders = {};
      const add = (k, label, min, max, unit = '') => { const s = slider({ label, min, max, value: o[k], unit }); s.input.addEventListener('change', () => { o[k] = s.get(); schedule(); }); sliders[k] = s; sl.appendChild(s); };
      if (o.mode === 'bw') add('threshold', 'Threshold', 1, 254); else add('colors', 'Colors', 2, 64);
      add('detail', 'Detail', 0, 100, '%'); add('smooth', 'Smoothness', 0, 100, '%');
    };
    $('[data-k="preset"]', body).addEventListener('change', e => { o = { ...o, ...TRACE_PRESETS[e.target.value], preset: e.target.value }; $('[data-k="ignoreWhite"]', body).checked = o.ignoreWhite; build(); schedule(); });
    $('[data-k="ignoreWhite"]', body).addEventListener('change', e => { o.ignoreWhite = e.target.checked; schedule(); });
    $('[data-k="keepImage"]', body).addEventListener('change', e => { o.keepImage = e.target.checked; });
    let timer = 0, seq = 0;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(preview, 150); };
    const preview = async () => {
      const my = ++seq; const prev = $('.vx-trace-prev', body);
      prev.classList.add('busy');
      try {
        const res = await runTrace(r, o, 700);
        if (my !== seq) return;
        // show the tracer's SVG with the same cleanup rules
        const g = buildTrace(res, r, o);
        const tmp = new P.Project(document.createElement('canvas'));
        let svg; try { const L = new P.Layer(); g.matrix = new P.Matrix(); g.fitBounds(new P.Rectangle(0, 0, 400, 400)); L.addChild(g); svg = tmp.exportSVG({ asString: true, bounds: 'content', precision: 1 }); } finally { tmp.remove(); S.project.activate(); }
        prev.innerHTML = ''; const img = new Image(); img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))); prev.appendChild(img);
        const n = g.getItems({ class: P.Path }).length;
        const nc = new Set(g.children.map(c => c.fillColor.toCSS(true))).size;
        $('.vx-tr-info', body).textContent = `${nc} color${nc === 1 ? '' : 's'} · ${n} paths`;
      } catch (e) { prev.textContent = 'Trace failed: ' + e.message; }
      prev.classList.remove('busy');
    };
    build();
    modal({ title: 'Image Trace', body, width: 720, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Trace', kind: 'primary', onClick: async (close, btn) => {
      btn.disabled = true; btn.textContent = 'Tracing…';
      try { localStorage.setItem('ro3.vector.trace', JSON.stringify(o)); } catch (_) {}
      try { await io.trace(r, o); toast('Traced to vector paths', 'ok'); } catch (e) { toast('Trace failed: ' + e.message, 'error'); }
    } }] });
    preview();
  };

  // =====================================================================
  // PDF / AI import (pdf.js operator list → paper.js)
  // =====================================================================
  async function pdfjs() {
    await VX.loadScript('vendor/pdf.min.js');
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.js', location.href).href;
    return lib;
  }
  async function openPdf(bytes) {
    const lib = await pdfjs();
    const task = lib.getDocument({ data: bytes.slice(), disableFontFace: true, isEvalSupported: false, fontExtraProperties: true, useSystemFonts: false, isOffscreenCanvasSupported: false, standardFontDataUrl: new URL('vendor/pdf-standard-fonts/', location.href).href, verbosity: 0 });
    return task.promise;
  }
  function pdfOptionsDialog(bytes, name) {
    return new Promise(async res => {
      let n = 1; try { const pdf = await openPdf(bytes); n = pdf.numPages; pdf.destroy(); } catch (e) { toast(`Couldn't read ${name}: ${e.message}`, 'error'); return res(null); }
      const body = h(`<div class="stack"><p class="muted">${esc(name)} — ${n} page${n > 1 ? 's' : ''}${/\.ai$/i.test(name) ? ' (Illustrator, read through its PDF content)' : ''}</p>
        <label class="field"><span>Text</span><select data-k="text"><option value="outline">Outlines — looks exactly like the original</option><option value="text">Editable text — uses fonts installed here</option></select></label>
        <label class="field"><span>Pages</span><select data-k="pages"><option value="all">All pages as artboards</option>${Array.from({ length: Math.min(n, 200) }, (_, i) => `<option value="${i + 1}">Page ${i + 1} only</option>`).join('')}</select></label>
        <p class="hint">Paths, colors, gradients, clipping masks, images and layers are imported. Effects that PDF stores as images (shadows, blurs) come in as images.</p></div>`);
      modal({ title: 'Open PDF', body, width: 440, onClose: v => res(v || null), actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Open', kind: 'primary', onClick: (close) => { const p = $('[data-k="pages"]', body).value; close({ text: $('[data-k="text"]', body).value, pages: p === 'all' ? null : [Number(p)] }); return false; } }] });
    });
  }
  io.importPDF = async (bytes, { newDoc = false, place = false, at = null, name = 'PDF', text = 'outline', pages = null } = {}) => {
    const prog = progressBox('Importing ' + name);
    let pdf;
    try {
      pdf = await openPdf(bytes);
      const lib = window.pdfjsLib;
      const list = pages || Array.from({ length: Math.min(pdf.numPages, 100) }, (_, i) => i + 1);
      let oc = null; try { oc = await pdf.getOptionalContentConfig(); } catch (_) {}
      const results = [];
      for (let k = 0; k < list.length; k++) {
        prog.set(k / list.length, `Page ${list[k]} of ${pdf.numPages}`);
        const page = await pdf.getPage(list[k]);
        const vp = page.getViewport({ scale: 1 });
        const ops = await page.getOperatorList({ annotationMode: lib.AnnotationMode.DISABLE });
        results.push({ vp, page, ops });
      }
      if (newDoc) {
        const meta = VX.freshDocMeta({ name, units: 'pt' });
        let x = 0;
        meta.artboards = results.map((r, i) => { const a = { id: uid('ab'), name: list.length > 1 ? `Page ${list[i]}` : 'Artboard 1', x, y: 0, w: Math.round(r.vp.width * 1000) / 1000, h: Math.round(r.vp.height * 1000) / 1000 }; x += a.w + 60; return a; });
        VX.resetDoc(meta);
      } else if (!S.doc) VX.createDoc({ name });
      const placed = [];
      const stats = { paths: 0, texts: 0, images: 0, skipped: new Set(), missingGlyphs: 0 };
      for (let k = 0; k < results.length; k++) {
        prog.set((k + 0.5) / results.length, `Converting page ${list[k]}`);
        const r = results[k];
        const origin = newDoc ? S.doc.artboards[k] : { x: 0, y: 0 };
        const conv = new PdfConverter(r.page, r.ops, r.vp, { origin, text, oc, stats, lib, newDoc, pageNo: list[k] });
        await conv.run();
        placed.push(...conv.roots);
        await new Promise(res2 => setTimeout(res2, 0));
      }
      prog.close();
      if (newDoc) {
        if (!S.project.layers.length) new P.Layer({ name: 'Layer 1' });
        // remove empty layers
        for (const L of S.project.layers.slice()) if (!L.children.length && S.project.layers.length > 1) L.remove();
        S.project.layers[S.project.layers.length - 1].activate();
        await io.waitRasters();
        VX.pushInitial(); VX.afterDocLoad();
      } else {
        const roots = placed.filter(p => p.children && p.children.length);
        let g;
        if (roots.length === 1) g = roots[0];
        else { g = new P.Group({ insert: false }); g.addChildren(roots); }
        (S.isolation || S.project.activeLayer).addChild(g); g.name = name;
        await finishPlace(g, at, place || true);
      }
      const notes = [];
      if (stats.skipped.size) notes.push('skipped: ' + [...stats.skipped].join(', '));
      if (stats.missingGlyphs) notes.push(`${stats.missingGlyphs} glyph run${stats.missingGlyphs > 1 ? 's' : ''} without font outlines came in as editable text`);
      toast(`Imported ${stats.paths} paths, ${stats.texts} text runs, ${stats.images} images${notes.length ? ' — ' + notes.join('; ') : ''}`, 'ok', 6000);
      io.lastImportStats = { paths: stats.paths, texts: stats.texts, images: stats.images, skipped: [...stats.skipped], missingGlyphs: stats.missingGlyphs };
    } catch (e) { prog.close(); console.error(e); throw e; }
    finally { if (pdf) pdf.destroy(); }
  };

  /** Records canvas-style path commands into SVG path data through a matrix stack. */
  class PathRecorder {
    constructor(m) { this.m = m; this.stack = []; this.d = []; this.cx = 0; this.cy = 0; }
    save() { this.stack.push(this.m); } restore() { this.m = this.stack.pop() || this.m; }
    transform(a, b, c, d, e, f) { this.m = this.m.appended(new P.Matrix(a, b, c, d, e, f)); }
    scale(x, y) { this.m = this.m.appended(new P.Matrix(x, 0, 0, y, 0, 0)); }
    translate(x, y) { this.m = this.m.appended(new P.Matrix(1, 0, 0, 1, x, y)); }
    p(x, y) { const q = this.m.transform(new P.Point(x, y)); return `${+q.x.toFixed(3)} ${+q.y.toFixed(3)}`; }
    beginPath() {} closePath() { this.d.push('Z'); }
    moveTo(x, y) { this.d.push('M' + this.p(x, y)); this.cx = x; this.cy = y; }
    lineTo(x, y) { this.d.push('L' + this.p(x, y)); this.cx = x; this.cy = y; }
    bezierCurveTo(a, b, c, d, x, y) { this.d.push(`C${this.p(a, b)} ${this.p(c, d)} ${this.p(x, y)}`); this.cx = x; this.cy = y; }
    quadraticCurveTo(a, b, x, y) { const c1x = this.cx + 2 / 3 * (a - this.cx), c1y = this.cy + 2 / 3 * (b - this.cy), c2x = x + 2 / 3 * (a - x), c2y = y + 2 / 3 * (b - y); this.bezierCurveTo(c1x, c1y, c2x, c2y, x, y); }
    rect(x, y, w, hh) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + hh); this.lineTo(x, y + hh); this.closePath(); }
    fill() {} stroke() {} clip() {}
  }

  class PdfConverter {
    constructor(page, ops, vp, { origin, text, oc, stats, lib, newDoc, pageNo }) {
      Object.assign(this, { page, ops, vp, text, oc, stats, lib, newDoc, pageNo });
      this.OPS = lib.OPS;
      this.base = new P.Matrix(1, 0, 0, 1, origin.x, origin.y).appended(new P.Matrix(...vp.transform));
      this.st = this.fresh();
      this.stack = [];
      this.path = [];
      this.roots = [];
      this.layerStack = [];
      this.defaultLayer = null;
      this.clipGroups = new Map();
    }
    fresh() { return { ctm: new P.Matrix(), fill: new P.Color(0, 0, 0), stroke: new P.Color(0, 0, 0), fillAlpha: 1, strokeAlpha: 1, lw: 1, cap: 'butt', join: 'miter', miter: 10, dash: null, blend: 'normal', clip: null, clipId: 0, font: null, size: 0, tm: new P.Matrix(), x: 0, y: 0, lineX: 0, lineY: 0, cs: 0, ws: 0, hs: 1, lead: 0, rise: 0, mode: 0, fillPat: null, strokePat: null, baseM: new P.Matrix(), fontDir: 1 }; }
    clone(s) { return { ...s, ctm: s.ctm.clone(), tm: s.tm.clone(), baseM: s.baseM.clone() }; }
    target() {
      const top = this.layerStack.length ? this.layerStack[this.layerStack.length - 1] : null;
      if (top) return top;
      if (!this.defaultLayer) {
        if (this.newDoc) this.defaultLayer = S.project.layers.find(l => l.name === 'Layer 1') || new P.Layer({ name: 'Layer 1' });
        else { this.defaultLayer = new P.Group({ insert: false }); this.defaultLayer.name = 'Page ' + this.pageNo; }
        if (!this.roots.includes(this.defaultLayer)) this.roots.push(this.defaultLayer);
      }
      return this.defaultLayer;
    }
    layerFor(name) {
      if (this.newDoc) {
        let L = S.project.layers.find(l => l.name === name);
        if (!L) { L = new P.Layer({ name }); if (!this.roots.includes(L)) this.roots.push(L); }
        return L;
      }
      let g = this.roots.find(r => r.name === name);
      if (!g) { g = new P.Group({ insert: false }); g.name = name; this.roots.push(g); }
      return g;
    }
    M() { return this.base.appended(this.st.ctm); }
    // ---- output ----
    add(item) {
      const st = this.st;
      if (st.blend && st.blend !== 'normal' && st.blend !== 'source-over') item.blendMode = st.blend;
      const container = this.target();
      if (st.clip) {
        const cb = st.clip.bounds;
        // Skip clips that don't cut anything (very common page-size clips).
        const inside = cb.contains(item.strokeBounds) && st.clipRect;
        if (!inside) {
          let g = this.clipGroups.get(st.clipId);
          if (!g || g.parent !== container || g !== container.lastChild) {
            g = new P.Group({ insert: false }); const mask = st.clip.clone({ insert: false }); mask.clipMask = true; g.addChild(mask); g.clipped = true;
            container.addChild(g); this.clipGroups.set(st.clipId, g);
          }
          g.addChild(item); return;
        }
      }
      container.addChild(item);
    }
    pathItem(fillRule) {
      if (!this.path.length) return null;
      const d = this.path.join(' ');
      const it = this.path.filter(x => x[0] === 'M').length > 1 ? new P.CompoundPath({ pathData: d, insert: false }) : new P.Path({ pathData: d, insert: false });
      if (fillRule) it.fillRule = fillRule;
      return it;
    }
    paint(fill, stroke, rule = 'nonzero', close = false) {
      const st = this.st;
      if (close && this.path.length) this.path.push('Z');
      const it = this.pathItem(rule);
      if (it) {
        if (fill) it.fillColor = this.paintColor(st.fill, st.fillPat, st.fillAlpha, it); else it.fillColor = null;
        if (stroke) {
          it.strokeColor = this.paintColor(st.stroke, st.strokePat, st.strokeAlpha, it);
          const sc = Math.sqrt(Math.abs(this.M().a * this.M().d - this.M().b * this.M().c)) || 1;
          it.strokeWidth = Math.max(st.lw * sc, st.lw === 0 ? 0.25 : 0);
          it.strokeCap = st.cap; it.strokeJoin = st.join; it.miterLimit = st.miter;
          if (st.dash && st.dash.length) it.dashArray = st.dash.map(v => v * sc);
        }
        if (it.fillColor || it.strokeColor) { this.add(it); this.stats.paths++; }
      }
      this.endPath();
    }
    paintColor(c, pat, alpha, item) {
      if (pat) { const g = this.gradient(pat, item); if (g) return g; }
      const out = c.clone(); out.alpha = (c.alpha == null ? 1 : c.alpha) * alpha; return out;
    }
    gradient(pat, item) {
      const ir = pat.ir;
      if (!ir || ir[0] !== 'RadialAxial') return null;
      const [, type, , stops, p0, p1, r0, r1] = ir;
      const m = this.base.appended(pat.base).appended(pat.matrix ? new P.Matrix(...pat.matrix) : new P.Matrix());
      const a = m.transform(new P.Point(p0)), b = m.transform(new P.Point(p1));
      const gstops = stops.map(([o, col]) => [new P.Color(col), o]);
      if (type === 'axial') return new P.Color({ gradient: { stops: gstops }, origin: a, destination: b });
      const sc = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
      const rr = Math.max(r1, r0) * sc;
      return new P.Color({ gradient: { stops: gstops, radial: true }, origin: b, destination: b.add([rr, 0]) });
    }
    endPath() {
      const st = this.st;
      if (this.pendingClip) {
        const clipPath = this.pathItem(this.pendingClip);
        if (clipPath) {
          let c = clipPath;
          const isRect = clipPath.className === 'Path' && clipPath.segments.length >= 4 && clipPath.segments.length <= 5 && clipPath.segments.every(s => !s.hasHandles()) && Math.abs(Math.abs(clipPath.area) - clipPath.bounds.area) < 0.01 * clipPath.bounds.area + 0.01;
          if (st.clip) { try { c = st.clip.intersect(clipPath, { insert: false }); } catch (_) { c = clipPath; } }
          st.clip = c; st.clipRect = isRect && (!st.clipRect ? true : st.clipRect); st.clipId = ++PdfConverter.ids;
          if (c.bounds.width < 1e-6 && c.bounds.height < 1e-6) st.clipRect = false;
        }
        this.pendingClip = null;
      }
      this.path = [];
    }
    // ---- path construction ----
    construct(ops, args) {
      const O = this.OPS, M = this.M();
      const f = (x, y) => { const q = M.transform(new P.Point(x, y)); return `${+q.x.toFixed(3)} ${+q.y.toFixed(3)}`; };
      let x = this.cx || 0, y = this.cy || 0, j = 0;
      for (let i = 0; i < ops.length; i++) {
        switch (ops[i] | 0) {
          case O.rectangle: { x = args[j++]; y = args[j++]; const w = args[j++], hh = args[j++]; this.path.push(`M${f(x, y)}`, `L${f(x + w, y)}`, `L${f(x + w, y + hh)}`, `L${f(x, y + hh)}`, 'Z'); break; }
          case O.moveTo: x = args[j++]; y = args[j++]; this.path.push('M' + f(x, y)); break;
          case O.lineTo: x = args[j++]; y = args[j++]; this.path.push('L' + f(x, y)); break;
          case O.curveTo: this.path.push(`C${f(args[j], args[j + 1])} ${f(args[j + 2], args[j + 3])} ${f(args[j + 4], args[j + 5])}`); x = args[j + 4]; y = args[j + 5]; j += 6; break;
          case O.curveTo2: this.path.push(`C${f(x, y)} ${f(args[j], args[j + 1])} ${f(args[j + 2], args[j + 3])}`); x = args[j + 2]; y = args[j + 3]; j += 4; break;
          case O.curveTo3: this.path.push(`C${f(args[j], args[j + 1])} ${f(args[j + 2], args[j + 3])} ${f(args[j + 2], args[j + 3])}`); x = args[j + 2]; y = args[j + 3]; j += 4; break;
          case O.closePath: this.path.push('Z'); break;
        }
      }
      this.cx = x; this.cy = y;
    }
    // ---- text ----
    fontInfo(font) {
      let name = String(font.name || font.loadedName || 'sans-serif').replace(/^[A-Z]{6}\+/, '');
      const parts = name.split(/[-,]/); const raw = parts[0]; const style = parts.slice(1).join(' ');
      const weight = font.black ? 900 : font.bold ? 700 : weightOfStyle(style || name);
      // Match PostScript names ("OpenSans", "ArialMT") to installed families ("Open Sans", "Arial").
      const key = s => s.toLowerCase().replace(/[\s_-]/g, '');
      const cands = [raw, raw.replace(/(MT|PS|Std|Pro|LT)$/, ''), raw.replace(/(Bold|Regular|Light|Medium|Black|Italic|Semibold|SemiBold)+$/, '')];
      let fam = null;
      for (const c of cands) { const hit = this.fams && this.fams.get(key(c)); if (hit) { fam = hit; break; } }
      if (!fam) fam = /serif/i.test(font.fallbackName || '') && !/sans/i.test(font.fallbackName || '') ? 'Georgia, serif' : /mono/i.test(font.fallbackName || '') ? 'monospace' : raw.replace(/(MT|PS|Std|Pro)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || 'sans-serif';
      return { family: fam, weight, italic: font.italic || /italic|oblique/i.test(style) };
    }
    showText(glyphs) {
      const st = this.st, font = st.font;
      if (!font || st.size === 0) return;
      const mode = st.mode & 3;
      const invisible = mode === 3;
      const fontSize = st.size, fm = font.fontMatrix || [0.001, 0, 0, 0.001, 0, 0];
      const hs = st.hs * st.fontDir, vertical = font.vertical;
      const was = fontSize * fm[0];
      const textStart = this.M().appended(st.tm).appended(new P.Matrix(1, 0, 0, 1, st.x, st.y + st.rise)).appended(new P.Matrix(hs, 0, 0, st.fontDir > 0 ? -1 : 1, 0, 0));
      const rec = new PathRecorder(textStart);
      let x = 0, gotPaths = false, missing = false, str = '';
      for (const g of glyphs) {
        if (typeof g === 'number') { x += (vertical ? 1 : -1) * g * fontSize / 1000; if (g < -200) str += ' '; continue; }
        const spacing = (g.isSpace ? st.ws : 0) + st.cs;
        str += g.unicode || '';
        if (!invisible && (g.isInFont || font.missingFile) && this.text !== 'text') {
          let gen = null;
          try { gen = font.getPathGenerator(this.page.commonObjs, g.fontChar); } catch (_) { gen = null; }
          if (gen) {
            const before = rec.d.length;
            rec.save(); rec.translate(x, 0); try { gen(rec, fontSize); } catch (_) {} rec.restore();
            if (rec.d.length > before) gotPaths = true; else if (String(g.unicode || '').trim()) missing = true;
          } else if (String(g.unicode || '').trim()) missing = true;
        }
        x += vertical ? -(g.vmetric ? g.vmetric[0] : g.width) * was - spacing * st.fontDir : g.width * was + spacing * st.fontDir;
      }
      if (!invisible) {
        if (this.text !== 'text' && gotPaths && !missing) {
          const cp = new P.CompoundPath({ pathData: rec.d.join(' '), insert: false }); cp.fillRule = 'nonzero';
          if (mode === 0 || mode === 2) cp.fillColor = this.paintColor(st.fill, st.fillPat, st.fillAlpha, cp); else cp.fillColor = null;
          if (mode === 1 || mode === 2) { cp.strokeColor = this.paintColor(st.stroke, null, st.strokeAlpha, cp); const sc = Math.sqrt(Math.abs(textStart.a * textStart.d - textStart.b * textStart.c)) / fontSize || 1; cp.strokeWidth = st.lw * sc; }
          this.add(cp); this.stats.texts++;
        } else if (str.trim()) {
          if (this.text !== 'text') this.stats.missingGlyphs++;
          const info = this.fontInfo(font);
          const t = new P.PointText({ content: str.replace(/\s+$/, ''), fontFamily: info.family, fontWeight: String(info.weight), fontSize, insert: false });
          t.fillColor = mode === 1 ? null : this.paintColor(st.fill, null, st.fillAlpha, t);
          if (mode === 1 || mode === 2) { t.strokeColor = this.paintColor(st.stroke, null, st.strokeAlpha, t); t.strokeWidth = st.lw; }
          const tm = this.M().appended(st.tm).appended(new P.Matrix(1, 0, 0, 1, st.x, st.y + st.rise)).appended(new P.Matrix(st.hs, 0, 0, -1, 0, 0));
          const s = Math.sqrt(Math.abs(tm.a * tm.d - tm.b * tm.c)) || 1;
          t.fontSize = fontSize * s;
          t.matrix = tm.appended(new P.Matrix(1 / s, 0, 0, 1 / s, 0, 0));
          if (st.cs) t.tracking = st.cs / fontSize * 1000;
          this.add(t); this.stats.texts++;
        }
      }
      if (vertical) st.y -= x; else st.x += x * hs;
    }
    // ---- images ----
    imageItem(img, fillForMask) {
      const w = img.width, hh = img.height; if (!w || !hh) return;
      const c = document.createElement('canvas'); c.width = w; c.height = hh;
      const ctx = c.getContext('2d');
      if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
      else if (img.data) {
        const id = ctx.createImageData(w, hh), dst = id.data, src = img.data;
        if (fillForMask) {
          const col = fillForMask; const r = Math.round(col.red * 255), g = Math.round(col.green * 255), b = Math.round(col.blue * 255), a = Math.round((col.alpha == null ? 1 : col.alpha) * 255);
          const rowBytes = (w + 7) >> 3;
          for (let yy = 0; yy < hh; yy++) for (let xx = 0; xx < w; xx++) { const bit = (src[yy * rowBytes + (xx >> 3)] >> (7 - (xx & 7))) & 1; const o = (yy * w + xx) * 4; if (!bit) { dst[o] = r; dst[o + 1] = g; dst[o + 2] = b; dst[o + 3] = a; } }
        } else if (img.kind === 3 || src.length === w * hh * 4) dst.set(src.subarray(0, dst.length));
        else if (img.kind === 2 || src.length === w * hh * 3) { for (let i = 0, k = 0; i < dst.length; i += 4, k += 3) { dst[i] = src[k]; dst[i + 1] = src[k + 1]; dst[i + 2] = src[k + 2]; dst[i + 3] = 255; } }
        else if (img.kind === 1) { const rowBytes = (w + 7) >> 3; for (let yy = 0; yy < hh; yy++) for (let xx = 0; xx < w; xx++) { const v = (src[yy * rowBytes + (xx >> 3)] >> (7 - (xx & 7))) & 1 ? 255 : 0; const o = (yy * w + xx) * 4; dst[o] = dst[o + 1] = dst[o + 2] = v; dst[o + 3] = 255; } }
        ctx.putImageData(id, 0, 0);
      } else return;
      const r = new P.Raster({ source: c.toDataURL('image/png'), insert: false });
      r.matrix = this.M().appended(new P.Matrix(1 / w, 0, 0, -1 / hh, 0, 0)).appended(new P.Matrix(1, 0, 0, 1, w / 2, -hh / 2));
      if (this.st.fillAlpha < 1) r.opacity = this.st.fillAlpha;
      this.add(r); this.stats.images++;
    }
    getObj(id) { try { return String(id).startsWith('g_') ? this.page.commonObjs.get(id) : this.page.objs.get(id); } catch (_) { return null; } }
    async run() {
      const O = this.OPS, { fnArray, argsArray } = this.ops;
      PdfConverter.ids = PdfConverter.ids || 0;
      if (this.text === 'text') { try { this.fams = new Map((await io.fontFamilies()).map(f => [f.family.toLowerCase().replace(/[\s_-]/g, ''), f.family])); } catch (_) {} }
      // wait for fonts/images the operator list depends on
      for (let i = 0; i < fnArray.length; i++) if (fnArray[i] === O.dependency) for (const id of argsArray[i]) { const objs = String(id).startsWith('g_') ? this.page.commonObjs : this.page.objs; await new Promise(res => { try { objs.get(id, res); } catch (_) { res(); } setTimeout(res, 3000); }); }
      const name = Object.fromEntries(Object.entries(O).map(([k, v]) => [v, k]));
      for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i], a = argsArray[i];
        const st = this.st;
        try {
          switch (fn) {
            case O.save: this.stack.push(this.clone(st)); break;
            case O.restore: if (this.stack.length) this.st = this.stack.pop(); break;
            case O.transform: st.ctm = st.ctm.appended(new P.Matrix(...a)); break;
            case O.constructPath: this.construct(a[0], a[1]); break;
            case O.fill: this.paint(true, false, 'nonzero'); break;
            case O.eoFill: this.paint(true, false, 'evenodd'); break;
            case O.stroke: this.paint(false, true); break;
            case O.closeStroke: this.paint(false, true, 'nonzero', true); break;
            case O.fillStroke: this.paint(true, true, 'nonzero'); break;
            case O.eoFillStroke: this.paint(true, true, 'evenodd'); break;
            case O.closeFillStroke: this.paint(true, true, 'nonzero', true); break;
            case O.closeEOFillStroke: this.paint(true, true, 'evenodd', true); break;
            case O.endPath: this.endPath(); break;
            case O.clip: this.pendingClip = 'nonzero'; break;
            case O.eoClip: this.pendingClip = 'evenodd'; break;
            case O.setLineWidth: st.lw = a[0]; break;
            case O.setLineCap: st.cap = ['butt', 'round', 'square'][a[0]] || 'butt'; break;
            case O.setLineJoin: st.join = ['miter', 'round', 'bevel'][a[0]] || 'miter'; break;
            case O.setMiterLimit: st.miter = a[0]; break;
            case O.setDash: st.dash = a[0] && a[0].length ? a[0].slice() : null; break;
            case O.setGState:
              for (const [k, v] of a[0]) {
                if (k === 'LW') st.lw = v; else if (k === 'LC') st.cap = ['butt', 'round', 'square'][v] || 'butt'; else if (k === 'LJ') st.join = ['miter', 'round', 'bevel'][v] || 'miter';
                else if (k === 'ML') st.miter = v; else if (k === 'D') st.dash = v[0] && v[0].length ? v[0].slice() : null; else if (k === 'ca') st.fillAlpha = v; else if (k === 'CA') st.strokeAlpha = v;
                else if (k === 'BM') st.blend = v === 'source-over' ? 'normal' : v; else if (k === 'Font') { st.font = this.getObj(v[0]); st.size = v[1]; }
                else if (k === 'SMask' && v) this.stats.skipped.add('soft masks');
              }
              break;
            case O.setFillRGBColor: st.fill = new P.Color(a[0] / 255, a[1] / 255, a[2] / 255); st.fillPat = null; break;
            case O.setStrokeRGBColor: st.stroke = new P.Color(a[0] / 255, a[1] / 255, a[2] / 255); st.strokePat = null; break;
            case O.setFillColorN: case O.setStrokeColorN: {
              const key = fn === O.setFillColorN ? 'fillPat' : 'strokePat';
              if (a[0] === 'TilingPattern') { this.stats.skipped.add('pattern fills (shown as their base color)'); st[key] = null; const c = a[1]; if (c) st[fn === O.setFillColorN ? 'fill' : 'stroke'] = new P.Color(c[0] / 255, c[1] / 255, c[2] / 255); else st[fn === O.setFillColorN ? 'fill' : 'stroke'] = new P.Color(0.5, 0.5, 0.5); break; }
              const ir = this.getObj(a[1]);
              if (ir && ir[0] === 'RadialAxial') st[key] = { ir, matrix: a[2], base: st.baseM.clone() };
              else { st[key] = null; if (ir && ir[0] === 'Mesh') this.stats.skipped.add('mesh gradients (shown as gray)'); st[fn === O.setFillColorN ? 'fill' : 'stroke'] = new P.Color(0.6, 0.6, 0.6); }
              break;
            }
            case O.shadingFill: {
              const ir = this.getObj(a[0]);
              if (!ir || ir[0] !== 'RadialAxial') { this.stats.skipped.add('mesh gradients'); break; }
              const vb = this.vp.viewBox;
              const area = st.clip ? st.clip.bounds : new P.Rectangle(this.base.transform(new P.Point(vb[0], vb[1])), this.base.transform(new P.Point(vb[2], vb[3])));
              const rect = new P.Path.Rectangle({ rectangle: area, insert: false });
              rect.fillColor = this.gradient({ ir, matrix: null, base: st.ctm.clone() }, rect);
              if (st.fillAlpha < 1) rect.opacity = st.fillAlpha;
              this.add(rect); this.stats.paths++;
              break;
            }
            case O.beginText: st.tm = new P.Matrix(); st.x = st.lineX = 0; st.y = st.lineY = 0; break;
            case O.endText: break;
            case O.setFont: { const f = this.getObj(a[0]); st.font = f; let size = a[1]; st.fontDir = size < 0 ? -1 : 1; st.size = Math.abs(size); break; }
            case O.setCharSpacing: st.cs = a[0]; break;
            case O.setWordSpacing: st.ws = a[0]; break;
            case O.setHScale: st.hs = a[0] / 100; break;
            case O.setLeading: st.lead = -a[0]; break;
            case O.setTextRenderingMode: st.mode = a[0]; break;
            case O.setTextRise: st.rise = a[0]; break;
            case O.moveText: st.x = st.lineX += a[0]; st.y = st.lineY += a[1]; break;
            case O.setLeadingMoveText: st.lead = a[1]; st.x = st.lineX += a[0]; st.y = st.lineY += a[1]; break;
            case O.setTextMatrix: st.tm = new P.Matrix(...a); st.x = st.lineX = 0; st.y = st.lineY = 0; break;
            case O.nextLine: st.x = st.lineX += 0; st.y = st.lineY += st.lead; break;
            case O.showText: this.showText(a[0]); break;
            case O.showSpacedText: this.showText(a[0]); break;
            case O.nextLineShowText: st.y = st.lineY += st.lead; st.x = st.lineX; this.showText(a[0]); break;
            case O.nextLineSetSpacingShowText: st.ws = a[0]; st.cs = a[1]; st.y = st.lineY += st.lead; st.x = st.lineX; this.showText(a[2]); break;
            case O.paintImageXObject: { const img = this.getObj(a[0]); if (img) this.imageItem(img); break; }
            case O.paintInlineImageXObject: this.imageItem(a[0]); break;
            case O.paintImageMaskXObject: { const img = a[0] && a[0].data && typeof a[0].data !== 'string' ? a[0] : this.getObj(a[0] && a[0].data) || a[0]; if (img) this.imageItem(img, st.fill); break; }
            case O.paintSolidColorImageMask: { const rr = new P.Path({ pathData: `M${this.M().transform(new P.Point(0, 0)).x} ${this.M().transform(new P.Point(0, 0)).y}`, insert: false }); const M = this.M(); rr.segments = [[0, 0], [1, 0], [1, 1], [0, 1]].map(p => M.transform(new P.Point(p))); rr.closed = true; rr.fillColor = this.paintColor(st.fill, null, st.fillAlpha, rr); this.add(rr); break; }
            case O.paintImageXObjectRepeat: case O.paintImageMaskXObjectRepeat: case O.paintInlineImageXObjectGroup: case O.paintImageMaskXObjectGroup: this.stats.skipped.add('repeated image masks'); break;
            case O.paintFormXObjectBegin: {
              this.stack.push(this.clone(st));
              if (a[0] && a[0].length === 6) st.ctm = st.ctm.appended(new P.Matrix(...a[0]));
              st.baseM = st.ctm.clone();
              const bb = a[1];
              if (bb) { const M = this.M(); const q = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]].map(p => M.transform(new P.Point(p))); this.path = [`M${q[0].x} ${q[0].y}`, ...q.slice(1).map(p => `L${p.x} ${p.y}`), 'Z']; this.pendingClip = 'nonzero'; this.endPath(); }
              break;
            }
            case O.paintFormXObjectEnd: if (this.stack.length) this.st = this.stack.pop(); break;
            case O.beginGroup: this.stack.push(this.clone(st)); if (a[0] && a[0].smask) this.stats.skipped.add('soft masks'); break;
            case O.endGroup: if (this.stack.length) this.st = this.stack.pop(); break;
            case O.beginMarkedContentProps: {
              let L = null;
              if (a[0] === 'OC' && a[1] && this.oc) { try { const g = this.oc.getGroup(a[1].id); if (g && g.name) L = this.layerFor(g.name); } catch (_) {} }
              this.layerStack.push(L || (this.layerStack.length ? this.layerStack[this.layerStack.length - 1] : null));
              break;
            }
            case O.beginMarkedContent: this.layerStack.push(this.layerStack.length ? this.layerStack[this.layerStack.length - 1] : null); break;
            case O.endMarkedContent: this.layerStack.pop(); break;
            default:
              if (![O.dependency, O.setRenderingIntent, O.setFlatness, O.beginCompat, O.endCompat, O.beginAnnotation, O.endAnnotation, O.setStrokeColorSpace, O.setFillColorSpace, O.markPoint, O.markPointProps, O.setCharWidth, O.setCharWidthAndBounds].includes(fn)) this.stats.skipped.add(name[fn] || 'op ' + fn);
          }
        } catch (e) { console.warn('PDF op failed', name[fn], e); }
      }
      // drop nulls in layerStack roots & empty containers
      this.roots = this.roots.filter(Boolean);
    }
  }
})();
