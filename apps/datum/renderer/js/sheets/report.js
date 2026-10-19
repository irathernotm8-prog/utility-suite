// Datum - Report Sheet (report pages)
(function () {
  const h = D.h;
  const PW = 1056, PH = 816, M = 40;
  // page sizes in inches (portrait); 96 px per inch
  const PAGE_SIZES = {
    letter: { label: 'Letter', w: 8.5, h: 11 }, legal: { label: 'Legal', w: 8.5, h: 14 }, tabloid: { label: 'Tabloid / Ledger', w: 11, h: 17 },
    a4: { label: 'A4', w: 8.27, h: 11.69 }, a3: { label: 'A3', w: 11.69, h: 16.54 }, a5: { label: 'A5', w: 5.83, h: 8.27 },
    wide: { label: 'Widescreen 16:9', w: 7.5, h: 13.333 }, standard: { label: 'Standard 4:3', w: 7.5, h: 10 },
    square: { label: 'Square', w: 8, h: 8 }, custom: { label: 'Custom', w: 8.5, h: 11 }
  };
  const dims = (sheet) => {
    const pg = sheet.page || { size: 'letter', orient: 'landscape' };
    const base = pg.size === 'custom' ? { w: pg.w || 8.5, h: pg.h || 11 } : PAGE_SIZES[pg.size] || PAGE_SIZES.letter;
    let w = base.w, hh = base.h;
    if (pg.size !== 'custom' && (pg.orient || 'landscape') === 'landscape') [w, hh] = [Math.max(w, hh), Math.min(w, hh)];
    if (pg.size !== 'custom' && pg.orient === 'portrait') [w, hh] = [Math.min(w, hh), Math.max(w, hh)];
    return { w: Math.round(w * 96), h: Math.round(hh * 96), inW: w, inH: hh };
  };
  const pageLabel = (sheet) => { const pg = sheet.page || { size: 'letter', orient: 'landscape' }; const d = dims(sheet); return pg.size === 'custom' ? `Custom ${+d.inW.toFixed(2)} × ${+d.inH.toFixed(2)} in` : `${PAGE_SIZES[pg.size].label} · ${d.w >= d.h ? 'landscape' : 'portrait'}`; };

  function freeSpot(sheet, w, hh) {
    const { w: PW, h: PH } = dims(sheet);
    w = Math.min(w, PW - 2 * M);
    const els = sheet.elements;
    const overlaps = (x, y) => els.some((e) => x < e.x + e.w + 12 && x + w + 12 > e.x && y < e.y + e.h + 12 && y + hh + 12 > e.y);
    for (let y = M; y < 40 * PH; y += 16) {
      for (let x = M; x + w <= PW - M; x += 16) {
        const pageEnd = (Math.floor(y / PH) + 1) * PH - M;
        if (y + hh > pageEnd && hh < PH - 2 * M) continue;
        if (!overlaps(x, y)) return { x, y };
      }
    }
    return { x: M, y: M };
  }
  function ensurePages(sheet) {
    const bottom = Math.max(0, ...sheet.elements.map((e) => e.y + e.h));
    sheet.pages = Math.max(sheet.pages || 1, Math.ceil((bottom - 2) / dims(sheet).h));
  }
  function addElement(sheet, e) {
    const p = freeSpot(sheet, e.w, e.h);
    e.x = p.x; e.y = p.y;
    e.z = Math.max(1, ...sheet.elements.map((x) => x.z || 1)) + 1;
    sheet.elements.push(e);
    ensurePages(sheet);
    D.commit();
    return e;
  }

  const T = {
    label: 'Report Sheet',
    PW, PH, PAGE_SIZES, dims,
    create(name) { return { id: D.uid(), type: 'report', name, pages: 1, bg: '#FFFFFF', elements: [] }; },
    addElement,
    insertLinked(sheet, spec) {
      let e;
      if (spec.kind === 'chart') e = D.newElement('chart', { chartType: spec.chartType || 'bar', link: spec.link, title: spec.title || '', w: 488, h: 300 });
      else if (spec.kind === 'table') e = D.newElement('table', { link: spec.link, w: 488, h: 280, style: { fontSize: 10 } });
      else if (spec.kind === 'kpi') e = D.newElement('kpi', { expr: spec.expr, label: spec.label, w: 230, h: 118, style: { fontSize: 30, fill: '#F4F7FD' } });
      else e = D.newElement('text', { text: `${spec.label}: {{${spec.expr.replace(/^=/, '')}}}`, w: 488, h: 44, style: { fontSize: 16 } });
      return addElement(sheet, e);
    },
    printPages(sheet) {
      const pages = [];
      const n = sheet.pages || 1;
      const { w: PW, h: PH } = dims(sheet);
      for (let i = 0; i < n; i++) {
        const wrap = D.renderPage({ w: PW, h: PH * n, bg: sheet.bg, elements: sheet.elements }, { lazyCharts: true });
        wrap.style.height = PH + 'px';
        wrap.style.overflow = 'hidden';
        wrap.firstChild.style.marginTop = -i * PH + 'px';
        pages.push({ w: PW, h: PH, html: wrap.outerHTML });
      }
      return pages;
    },
    exportPayload() { return {}; },
    mount(host, sheet) { return new ReportView(host, sheet); },
    header: (...a) => header(...a),
    classicDashboard: (...a) => quickDashboard(...a),
    quickDashboard: (s, range, opts) => (D.dash ? (opts && opts.auto ? D.dash.build(s, range, opts) : D.dash.open(s, range)) : quickDashboard(s, range))
  };
  D.sheetTypes.report = T;

  function header(title, sub, PW = 1056) {
    const b = D.brand();
    const els = [
      D.newElement('shape', { shape: 'rect', x: 0, y: 0, w: PW, h: 96, style: { fill: b.dark }, locked: false }),
      D.newElement('shape', { shape: 'rect', x: 0, y: 96, w: PW, h: 4, style: { fill: b.primary } }),
      D.newElement('text', { x: M, y: 18, w: 700, h: 42, text: title, style: { fontSize: 24, bold: true, color: '#FFFFFF', valign: 'middle' } }),
      D.newElement('text', { x: M, y: 56, w: 700, h: 26, text: sub || new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }), style: { fontSize: 11, color: '#AFC3E8' } })
    ];
    if (b.logo) els.push(D.newElement('image', { src: b.logo, x: PW - M - 150, y: 24, w: 150, h: 48, isLogo: true }));
    return els;
  }

  function quickDashboard(dataSheet, range) {
    const F = D.f;
    const link = { sheetId: dataSheet.id, range };
    const cd = F.chartData(link);
    if (!cd || !cd.series.length) return D.toast('Select a table with at least one numeric column', 'warn');
    const g = F.parseRange(range);
    const q = F.quoteSheet(dataSheet.name);
    const raw = F.trimRows(F.linkRows(link, { display: false }));
    const width = raw[0].length;
    const hasHeader = raw[0].some((v) => typeof v === 'string' && v !== '');
    const r0 = hasHeader ? g.r1 + 1 : g.r1;
    const rLast = g.r1 + raw.length - 1;
    const hasLabels = cd.labels.some((l, i) => l !== String(i + 1));
    const c0 = hasLabels ? g.c1 + 1 : g.c1;
    const labelHead = hasLabels && hasHeader ? String(F.cellValue(dataSheet, g.r1, g.c1) || '').toLowerCase() : '';
    // classify numeric columns: additive totals vs ratios/rates (never summed)
    const cols = [];
    for (let c = c0; c < g.c1 + width; c++) {
      let numeric = false, ratio = false;
      for (let r = r0; r <= rLast; r++) {
        if (typeof F.cellValue(dataSheet, r, c) === 'number') numeric = true;
        const rawv = String(dataSheet.cells[r][c] || '');
        if (rawv.startsWith('=') && /\//.test(rawv) && !/^=SUM/i.test(rawv)) ratio = true;
      }
      const fmt = F.styleFmt(dataSheet, rLast, c);
      if (fmt === 'pct' || /rate|%|per |avg|average|ratio|cpa|ctr/i.test(String(F.cellValue(dataSheet, g.r1, c)))) ratio = true;
      if (numeric) cols.push({ c, rel: c - g.c1, name: hasHeader ? String(F.cellValue(dataSheet, g.r1, c)) : `Column ${F.colName(c)}`, ratio, fmt });
    }
    const sums = cols.filter((x) => !x.ratio), ratios = cols.filter((x) => x.ratio);
    const colRef = (c) => `${q}!${F.addr(r0, c)}:${F.addr(rLast, c)}`;
    const kfmt = (col, big) => (col.fmt === 'cur' ? (big ? 'cur0' : 'cur') : col.fmt === 'pct' ? 'pct' : 'auto');
    const last = cd.labels[cd.labels.length - 1];
    const total = (col) => ({ label: `Total ${col.name}`, expr: `=SUM(${colRef(col.c)})`, format: kfmt(col, true) });
    const latest = (col) => ({ label: `${col.name}${hasLabels ? ' · ' + last : ' · latest'}`, expr: `=${q}!${F.addr(rLast, col.c)}`, compareExpr: rLast > r0 ? `=${q}!${F.addr(rLast - 1, col.c)}` : undefined, lowerIsBetter: /cost|cpa|cpc|cpl|spend|churn|expense|bounce|refund|complaint/i.test(col.name), compareLabel: labelHead.includes('week') ? 'vs prior week' : labelHead.includes('month') ? 'vs prior month' : 'vs prior', format: kfmt(col, false) });
    let kpis = [];
    if (sums.length <= 2) { sums.forEach((col) => kpis.push(total(col), latest(col))); ratios.forEach((col) => kpis.push(latest(col))); }
    else { sums.slice(0, 3).forEach((col) => kpis.push(total(col))); kpis.push(ratios[0] ? latest(ratios[0]) : total(sums[3])); }
    kpis = kpis.slice(0, 4);

    const sheet = D.app.addSheet('report', { activate: false, name: D.uniqueSheetName(`${dataSheet.name} Report`) });
    const els = header(`${dataSheet.name} Report`, `${hasLabels ? `${cd.labels[0]} - ${last} · ` : ''}Updated ${new Date().toLocaleDateString()}`);
    const n = kpis.length;
    const kw = (PW - 2 * M - (n - 1) * 16) / n;
    kpis.forEach((k, i) => els.push(D.newElement('kpi', { ...k, x: Math.round(M + i * (kw + 16)), y: 124, w: Math.round(kw), h: 110, style: { fontSize: 28, fill: '#F4F7FD' } })));
    const by = labelHead ? ` by ${labelHead}` : '';
    const many = cd.labels.length > 12;
    const half = (PW - 2 * M - 16) / 2;
    const primary = sums[0] || cols[0];
    const secondary = sums[1] || ratios[0] || null;
    els.push(D.newElement('chart', { x: M, y: 256, w: Math.round(secondary ? half : PW - 2 * M), h: 290, chartType: many ? 'area' : 'bar', link, seriesCols: [primary.rel], title: `${primary.name}${by}`, showValues: !many && cd.labels.length <= 10, legend: false }));
    if (secondary) els.push(D.newElement('chart', { x: Math.round(M + half + 16), y: 256, w: Math.round(half), h: 290, chartType: 'line', link, seriesCols: [secondary.rel], title: `${secondary.name}${by}`, showValues: cd.labels.length <= 10, legend: false, colors: [D.brand().accent] }));
    const rowsFit = Math.max(3, Math.floor((PH - 566 - M + 8) / 22) - 1);
    els.push(D.newElement('table', { x: M, y: 566, w: PW - 2 * M, h: PH - 566 - M + 8, link, maxRows: Math.min(rowsFit, raw.length - 1), style: { fontSize: 9.5 } }));
    if (raw.length - 1 > rowsFit) els.push(D.newElement('text', { x: M, y: PH - 30, w: 400, h: 20, text: `Showing ${rowsFit} of ${raw.length - 1} rows - the table updates with ${dataSheet.name}`, style: { fontSize: 8, color: '#94A3B8' } }));
    els.forEach((e, i) => { e.z = i + 1; });
    sheet.elements = els;
    ensurePages(sheet);
    D.commit();
    D.app.activate(sheet.id);
    D.toast('Report built. Every number is linked to your data', 'ok');
  }

  class ReportView {
    constructor(host, sheet) {
      this.sheet = sheet; this.host = host;
      host.innerHTML = '';
      this.toolbar = h('div', { class: 'sheet-toolbar' });
      this.canvasHost = h('div', { class: 'canvas-host report' });
      this.insp = h('div', { class: 'inspector' });
      host.append(this.toolbar, h('div', { class: 'sheet-body two' }, this.canvasHost, this.insp));
      this.fc = new D.FreeCanvas(this.canvasHost, {
        model: () => { const d = dims(sheet); return { w: d.w, h: d.h * (sheet.pages || 1), bg: sheet.bg || '#FFFFFF', elements: sheet.elements }; },
        get pageHeight() { return dims(sheet).h; },
        fitWidth: true,
        maxFit: 1.25,
        margins: M,
        onChange: (soon) => { ensurePages(sheet); soon ? D.commitSoon() : D.commit({ data: false }); },
        onSelect: () => this.inspect(),
        isActive: () => D.active() === sheet,
        onEditData: (e) => this.editData(e),
        onImagePick: (e) => this.pickImage(e),
        contextEmpty: (p) => [
          { label: 'Add chart…', icon: 'chart', onClick: () => this.insert('chart') },
          { label: 'Add KPI…', icon: 'kpi', onClick: () => this.insert('kpi') },
          { label: 'Add text here', icon: 'text', onClick: () => this.fc.add(D.newElement('text', { x: Math.round(p.x), y: Math.round(p.y), text: 'Text' })) },
          { label: 'Paste', disabled: !D.clipboardEls, onClick: () => this.fc.paste(D.clipboardEls, 0) }
        ]
      });
      this.buildToolbar();
      this.fc.render();
      this.inspect();
      D.app.setStatus(`${sheet.pages || 1} page${(sheet.pages || 1) > 1 ? 's' : ''} · ${pageLabel(sheet)}<span class="st-sep"></span>${sheet.elements.filter((e) => e.link || e.expr).length} linked widget(s)`);
    }
    destroy() { this.fc.destroy(); }
    buildToolbar() {
      const tb = this.toolbar;
      tb.innerHTML = '';
      const shapeBtn = D.btn('shape', 'Shape', () => D.menu(shapeBtn, [['rect', 'Rectangle'], ['roundRect', 'Rounded rectangle'], ['ellipse', 'Ellipse'], ['line', 'Divider line']].map(([s, l]) => ({ label: l, onClick: () => this.add(D.newElement('shape', { shape: s, ...(s === 'line' ? { w: 976, h: 10, style: { fill: '#DCE3F0', strokeWidth: 2 } } : { style: { fill: '#F4F7FD', color: '#1F2937' } }) })) }))), { caret: true });
      tb.append(
        D.btn('undo', 'Undo', () => D.undo()), D.btn('redo', 'Redo', () => D.redo()), D.sep(),
        D.btn('chart', 'Chart from data', () => this.insert('chart'), { label: 'Chart', cls: 'accent' }),
        D.btn('kpi', 'KPI card', () => this.insert('kpi'), { label: 'KPI' }),
        D.btn('table', 'Table from data', () => this.insert('table'), { label: 'Table' }),
        D.btn('text', 'Text', () => this.add(D.newElement('text', { text: 'Commentary', w: 488, h: 60, style: { fontSize: 14 } })), { label: 'Text' }),
        D.btn('image', 'Image', () => this.pickImage(null), { label: 'Image' }),
        shapeBtn,
        D.sep(),
        D.btn('heading', 'Add a branded header band to page 1', () => this.addHeader(), { label: 'Header' }),
        this.sheet.dashSource ? D.btn('edit', 'Change what this report shows: questions, numbers, charts, layout', () => D.dash.edit(this.sheet), { label: 'Edit report', cls: 'accent' }) : D.btn('sparkles', 'Build a report from a data range', () => this.quick(), { label: 'Quick report' }),
        D.btn('palette', 'Apply the project brand - colors, fonts and logo - to this report', () => this.applyBrand(), { label: 'Apply brand' }),
        D.sep(),
        D.btn('plus', 'Add page', () => { this.sheet.pages = (this.sheet.pages || 1) + 1; D.commit({ data: false }); this.fc.render(); }, { label: 'Page' }),
        D.btn('minus', 'Remove last empty page', () => this.removePage()),
        h('div', { class: 'tb-spacer' }),
        (() => { const s = h('select', { class: 'input sm zoom-sel' }, [['fit', 'Fit width'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%']].map(([v, l]) => h('option', { value: v }, l))); s.addEventListener('change', () => this.fc.setZoom(s.value === 'fit' ? 'fit' : +s.value)); return s; })(),
        D.btn('pdf', 'Export this report as PDF', () => D.io.exportSheet(this.sheet, 'pdf'), { label: 'PDF', cls: 'primary' })
      );
    }
    add(e) { const p = freeSpot(this.sheet, e.w, e.h); e.x = p.x; e.y = p.y; ensurePages(this.sheet); this.fc.add(e); }
    async insert(kind) {
      const r = await D.links.insertDialog({ kind });
      if (!r) return;
      const e = T.insertLinked(this.sheet, r);
      this.fc.render(); this.fc.select(e.id);
      const node = this.fc.nodes.get(e.id); node && node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    async editData(e) {
      if (e.type === 'kpi') return this.inspect();
      const r = await D.links.insertDialog({ kind: e.type, link: e.link, allowKinds: [e.type] });
      if (!r) return;
      e.link = r.link; if (e.type === 'chart' && r.chartType) e.chartType = r.chartType; if (r.title) e.title = r.title;
      delete e.staticData; delete e.staticRows;
      this.fc.refreshEl(e); D.commit(); this.inspect();
    }
    async pickImage(target) {
      const src = await window.native.pickImage();
      if (!src) return;
      if (target) { target.src = src; this.fc.refreshEl(target); D.commit({ data: false }); return; }
      const img = await D.loadImage(src);
      let w = Math.min(img.naturalWidth, 488), hh = w * img.naturalHeight / img.naturalWidth;
      this.add(D.newElement('image', { src, w: Math.round(w), h: Math.round(hh) }));
    }
    addHeader() {
      const s = this.sheet;
      if (s.elements.some((e) => e.y < 100)) s.elements.forEach((e) => { e.y += 110; });
      const hd = header(s.name, null, dims(s).w);
      hd.forEach((e, i) => { e.z = -10 + i; });
      s.elements.push(...hd);
      ensurePages(s);
      D.commit({ data: false });
      this.fc.render();
    }
    setPage(page, scale) {
      const before = dims(this.sheet);
      this.sheet.page = page;
      const after = dims(this.sheet);
      if (scale && before.w !== after.w) {
        const f = after.w / before.w;
        this.sheet.elements.forEach((e) => {
          e.x = Math.round(e.x * f); e.y = Math.round(e.y * f); e.w = Math.round(e.w * f); e.h = Math.round(e.h * f);
          if (e.style && e.style.fontSize && e.type !== 'chart') e.style.fontSize = Math.max(6, Math.round(e.style.fontSize * f * 10) / 10);
          if (e.type === 'chart') e.fontScale = (e.fontScale || 1) * f;
        });
      }
      const bottom = Math.max(0, ...this.sheet.elements.map((e) => e.y + e.h));
      this.sheet.pages = Math.max(1, Math.ceil((bottom - 2) / after.h));
      D.commit({ data: false });
      this.fc.render();
      this.inspect();
      D.app.setStatus(`${this.sheet.pages} page${this.sheet.pages > 1 ? 's' : ''} · ${pageLabel(this.sheet)}`);
    }
    removePage() {
      const n = this.sheet.pages || 1;
      if (n <= 1) return;
      if (this.sheet.elements.some((e) => e.y + e.h > (n - 1) * dims(this.sheet).h)) return D.toast('The last page has content on it', 'warn');
      this.sheet.pages = n - 1; D.commit({ data: false }); this.fc.render();
    }
    applyBrand() {
      const b = D.brand();
      const { w: PW } = dims(this.sheet);
      const lum = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 1; const n = parseInt(m[1], 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
      const sat = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 0; const n = parseInt(m[1], 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, bl = n & 255; return (Math.max(r, g, bl) - Math.min(r, g, bl)) / 255; };
      let header = null;
      this.sheet.elements.forEach((e) => {
        if (e.style) delete e.style.fontFace;
        if (e.type === 'shape' && e.style) {
          const f = e.style.fill;
          if (e.y <= 2 && e.w >= PW - 4 && e.h >= 40) { e.style.fill = b.dark; header = e; }
          else if (e.h <= 8 || e.w <= 8) e.style.fill = e.y < 140 ? b.primary : b.accent;
          else if (lum(f) < 0.3) e.style.fill = b.dark;
          else if (sat(f) > 0.35) e.style.fill = b.primary;
        }
        if (e.type === 'text' && e.style) {
          const c = (e.style.color || '').toUpperCase();
          if (c !== '#FFFFFF' && c !== '#AFC3E8' && (e.style.bold || (e.style.fontSize || 0) >= 18)) e.style.color = b.dark;
        }
        if (e.type === 'chart') { if (e.colors && e.colors.length === 1) e.colors = [b.accent]; else delete e.colors; }
        if (e.type === 'table' && e.style) delete e.style.headerFill;
        if (e.type === 'kpi' && e.style) e.style.accentColor = b.primary;
      });
      if (b.logo && header && !this.sheet.elements.some((e) => e.isLogo)) {
        this.sheet.elements.push(D.newElement('image', { src: b.logo, isLogo: true, x: PW - M - 150, y: header.y + Math.max(8, (header.h - 48) / 2), w: 150, h: 48, z: 999 }));
      }
      D.commit({ data: false });
      this.fc.render();
      D.toast(b.logo ? 'Brand colors, fonts and logo applied' : 'Brand colors and fonts applied - add a logo in Brand Kit to stamp it on the header', 'ok');
    }
    async quick() {
      const r = await D.links.pickRangeOnly(null, 'Build a report from…');
      if (!r) return;
      T.quickDashboard(D.sheet(r.sheetId), r.range);
    }
    inspect() {
      D.buildInspector(this.insp, this.fc, {
        none: (panel, section, row) => {
          panel.append(h('div', { class: 'insp-head' }, h('span', { html: D.icon('report', 15) }), 'Report'));
          const pg = this.sheet.page || { size: 'letter', orient: 'landscape' };
          const d = dims(this.sheet);
          const sizeSel = h('select', { class: 'input sm' }, Object.entries(PAGE_SIZES).map(([k, v]) => h('option', { value: k, selected: k === pg.size ? true : null }, v.label)));
          const scaleCb = h('input', { type: 'checkbox' }); scaleCb.checked = this.sheet.scaleOnResize !== false;
          scaleCb.addEventListener('change', () => { this.sheet.scaleOnResize = scaleCb.checked; });
          sizeSel.addEventListener('change', () => this.setPage({ ...pg, size: sizeSel.value, ...(sizeSel.value === 'custom' ? { w: d.inW, h: d.inH } : {}) }, scaleCb.checked));
          const orientBtns = pg.size === 'custom' ? null : h('div', { class: 'seg sm' },
            h('button', { class: d.w >= d.h ? 'on' : '', onclick: () => this.setPage({ ...pg, orient: 'landscape' }, scaleCb.checked) }, 'Landscape'),
            h('button', { class: d.w < d.h ? 'on' : '', onclick: () => this.setPage({ ...pg, orient: 'portrait' }, scaleCb.checked) }, 'Portrait'));
          const inch = (val, key) => { const i = h('input', { class: 'input sm', type: 'number', step: '0.25', min: '2', max: '60', value: +val.toFixed(2) }); i.addEventListener('change', () => this.setPage({ ...pg, size: 'custom', w: key === 'w' ? +i.value : d.inW, h: key === 'h' ? +i.value : d.inH }, scaleCb.checked)); return i; };
          panel.append(section('Page',
            row('Size', sizeSel),
            orientBtns ? row('Orientation', orientBtns) : null,
            pg.size === 'custom' ? row('Inches', h('div', { class: 'inline' }, inch(d.inW, 'w'), h('span', { class: 'muted' }, '×'), inch(d.inH, 'h'))) : row('Dimensions', h('span', { class: 'muted' }, `${+d.inW.toFixed(2)} × ${+d.inH.toFixed(2)} in`)),
            row('Pages', h('span', { class: 'muted' }, String(this.sheet.pages || 1))),
            row('Background', D.colorInput(this.sheet.bg || '#FFFFFF', (v, done) => { this.sheet.bg = v; this.fc.render(); if (done) D.commit({ data: false }); })),
            h('label', { class: 'chk', style: { marginTop: '4px' } }, scaleCb, h('span', null, 'Scale content when the page size changes'))));
          const linked = this.sheet.elements.filter((e) => e.link || e.expr);
          panel.append(section('Linked widgets', linked.length ? h('div', { class: 'insp-list' }, linked.map((e) => h('div', { class: 'insp-li', onclick: () => this.fc.select(e.id) }, h('span', { html: D.icon(e.type === 'kpi' ? 'kpi' : e.type === 'table' ? 'table' : 'chart', 13) }), h('span', null, e.title || e.label || e.type), h('span', { class: 'muted small' }, e.link ? e.link.range : 'formula')))) : h('div', { class: 'insp-hint' }, 'Nothing linked yet. Add a chart or KPI, or use Quick report.')));
        }
      });
    }
  }
})();
