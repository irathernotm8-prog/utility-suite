// Datum - Slide Sheet (presentation)
(function () {
  const h = D.h;
  const W = 960, H = 540;

  // ------------------------------------------------ layouts
  const LAYOUTS = {
    title: { label: 'Title', make: (b, t = {}) => ({ bg: '#FFFFFF', elements: [
      D.newElement('shape', { shape: 'rect', x: 0, y: 0, w: 14, h: H, style: { fill: b.primary } }),
      D.newElement('text', { x: 80, y: 110, w: 800, h: 170, text: t.title || 'Presentation title', style: { fontSize: 44, bold: true, color: b.dark, valign: 'bottom', lineHeight: 1.1 } }),
      D.newElement('text', { x: 80, y: 304, w: 800, h: 50, text: t.subtitle || 'Subtitle · Date', style: { fontSize: 20, color: '#6B7280' } }),
      D.newElement('shape', { shape: 'rect', x: 84, y: 290, w: 90, h: 4, style: { fill: b.accent } })
    ] }) },
    content: { label: 'Title + content', make: (b, t = {}) => ({ bg: '#FFFFFF', elements: [
      D.newElement('text', { x: 60, y: 36, w: 840, h: 64, text: t.title || 'Slide title', style: { fontSize: 30, bold: true, color: b.dark, valign: 'middle' } }),
      D.newElement('shape', { shape: 'rect', x: 62, y: 102, w: 56, h: 4, style: { fill: b.primary } }),
      D.newElement('text', { x: 60, y: 130, w: 840, h: 360, text: t.body || 'First point\nSecond point\nThird point', style: { fontSize: 20, color: '#1F2937', bullets: true, lineHeight: 1.45 } })
    ] }) },
    two: { label: 'Two columns', make: (b, t = {}) => ({ bg: '#FFFFFF', elements: [
      D.newElement('text', { x: 60, y: 36, w: 840, h: 64, text: t.title || 'Comparison', style: { fontSize: 30, bold: true, color: b.dark, valign: 'middle' } }),
      D.newElement('shape', { shape: 'rect', x: 62, y: 102, w: 56, h: 4, style: { fill: b.primary } }),
      D.newElement('text', { x: 60, y: 130, w: 400, h: 360, text: 'Left point\nAnother point', style: { fontSize: 18, color: '#1F2937', bullets: true, lineHeight: 1.45 } }),
      D.newElement('text', { x: 500, y: 130, w: 400, h: 360, text: 'Right point\nAnother point', style: { fontSize: 18, color: '#1F2937', bullets: true, lineHeight: 1.45 } })
    ] }) },
    section: { label: 'Section header', make: (b, t = {}) => ({ bg: b.dark, elements: [
      D.newElement('text', { x: 80, y: 200, w: 800, h: 90, text: t.title || 'Section title', style: { fontSize: 40, bold: true, color: '#FFFFFF', valign: 'bottom' } }),
      D.newElement('shape', { shape: 'rect', x: 82, y: 300, w: 90, h: 5, style: { fill: b.accent } }),
      D.newElement('text', { x: 80, y: 316, w: 800, h: 50, text: t.subtitle || '', style: { fontSize: 18, color: '#AFC3E8' } })
    ] }) },
    chart: { label: 'Chart focus', make: (b, t = {}) => ({ bg: '#FFFFFF', elements: [
      D.newElement('text', { x: 60, y: 30, w: 840, h: 60, text: t.title || 'Chart title', style: { fontSize: 28, bold: true, color: b.dark, valign: 'middle' } }),
      D.newElement('text', { x: 60, y: 88, w: 840, h: 34, text: t.subtitle || 'One-line takeaway goes here', style: { fontSize: 15, color: '#6B7280' } }),
      D.newElement('chart', { x: 60, y: 136, w: 840, h: 370, chartType: 'bar' })
    ] }) },
    kpis: { label: 'KPI row', make: (b, t = {}) => ({ bg: '#FFFFFF', elements: [
      D.newElement('text', { x: 60, y: 36, w: 840, h: 64, text: t.title || 'Key numbers', style: { fontSize: 30, bold: true, color: b.dark, valign: 'middle' } }),
      ...[0, 1, 2].map((i) => D.newElement('kpi', { x: 60 + i * 290, y: 170, w: 260, h: 150, label: ['Metric one', 'Metric two', 'Metric three'][i], style: { fontSize: 40, fill: '#F4F7FD' } })),
      D.newElement('text', { x: 60, y: 360, w: 840, h: 120, text: 'Context for these numbers', style: { fontSize: 16, color: '#6B7280' } })
    ] }) },
    imageText: { label: 'Image + text', make: (b, t = {}) => ({ bg: '#FFFFFF', elements: [
      D.newElement('image', { x: 0, y: 0, w: 440, h: H, fit: 'cover' }),
      D.newElement('text', { x: 490, y: 90, w: 420, h: 80, text: t.title || 'Headline', style: { fontSize: 32, bold: true, color: b.dark, valign: 'bottom' } }),
      D.newElement('text', { x: 490, y: 190, w: 420, h: 280, text: t.body || 'Supporting detail\nAnother detail', style: { fontSize: 18, color: '#1F2937', bullets: true, lineHeight: 1.45 } })
    ] }) },
    blank: { label: 'Blank', make: () => ({ bg: '#FFFFFF', elements: [] }) }
  };
  const newSlide = (layout = 'content', t) => { const m = LAYOUTS[layout].make(D.brand(), t); return { id: D.uid(), layout, bg: m.bg, elements: m.elements, notes: '' }; };

  function resolveEl(e) {
    const o = D.clone(e);
    const b = D.brand();
    o.style = o.style || {};
    if (!o.style.fontFace) o.style.fontFace = b.font === 'Inter' ? 'Calibri' : b.font;
    if (o.style.fontFace === 'Inter') o.style.fontFace = 'Calibri';
    if (e.type === 'text' || e.type === 'shape') o.text = D.f.resolveTokens(e.text || '');
    if (e.type === 'table') o.rows = D.tableRows(e) || [];
    if (e.type === 'chart') { o.data = D.charts.dataFor(e); o.colors = D.charts.palette(e); }
    if (e.type === 'kpi') { const k = D.kpiParts(e); o.label = k.label; o.value = k.value; o.delta = k.delta; o.deltaUp = k.up; if (o.style.accent !== false && !o.style.fill) o.style.fill = undefined; }
    if (e.type === 'shape' && !o.style.fill) o.style.fill = b.primary;
    delete o.link; delete o.staticData; delete o.staticRows;
    return o;
  }

  const T = {
    label: 'Slide Sheet',
    LAYOUTS,
    newSlide,
    create(name) { return { id: D.uid(), type: 'slide', name, size: { w: W, h: H }, slides: [newSlide('title')], current: 0 }; },
    exportPayload(sheet) {
      return { slides: sheet.slides.map((s) => ({ bg: s.bg, notes: s.notes, elements: [...s.elements].sort((a, b) => (a.z || 1) - (b.z || 1)).map(resolveEl) })) };
    },
    printPages(sheet) {
      const sz = sheet.size || { w: W, h: H };
      return sheet.slides.map((s) => ({ w: sz.w, h: sz.h, html: D.renderPage({ ...sz, bg: s.bg, elements: s.elements }, { lazyCharts: true }).outerHTML }));
    },
    insertLinked(sheet, spec) {
      if (spec.where === 'new' || !sheet.slides.length) {
        const s = newSlide('blank');
        s.elements.push(D.newElement('text', { x: 60, y: 30, w: 840, h: 60, text: spec.title || spec.label || 'Slide', style: { fontSize: 28, bold: true, color: D.brand().dark, valign: 'middle' } }));
        sheet.slides.splice((sheet.current || 0) + 1, 0, s);
        sheet.current = Math.min((sheet.current || 0) + 1, sheet.slides.length - 1);
        if (sheet.slides.length === 2 && spec.where === 'new' && sheet.slides[0].elements.length === 4 && sheet.slides[0].layout === 'title') { /* keep title slide */ }
      }
      const slide = sheet.slides[sheet.current || 0];
      const fresh = slide.elements.length <= 1;
      const top = fresh ? 110 : 120;
      let e;
      if (spec.kind === 'chart') e = D.newElement('chart', { chartType: spec.chartType || 'bar', link: spec.link, title: fresh ? '' : spec.title, x: 60, y: top, w: 840, h: 540 - top - 30 });
      else if (spec.kind === 'table') e = D.newElement('table', { link: spec.link, x: 60, y: top, w: 840, h: 540 - top - 30, style: { fontSize: 13 } });
      else if (spec.kind === 'kpi') {
        const n = slide.elements.filter((x) => x.type === 'kpi').length;
        e = D.newElement('kpi', { expr: spec.expr, label: spec.label, x: 60 + (n % 3) * 290, y: 150 + Math.floor(n / 3) * 170, w: 260, h: 140, style: { fontSize: 40, fill: '#F4F7FD' } });
      } else e = D.newElement('text', { text: `${spec.label}: {{${spec.expr.replace(/^=/, '')}}}`, x: 60, y: 440, w: 840, h: 50, style: { fontSize: 20, color: '#1F2937' } });
      e.z = Math.max(1, ...slide.elements.map((x) => x.z || 1)) + 1;
      slide.elements.push(e);
      D.commit();
      return e;
    },
    mount(host, sheet) { return new SlideView(host, sheet); },
    outline(sheet) { return sheet.slides.map((s, i) => ({ label: `${i + 1}. ${slideTitle(s)}`, go: () => { sheet.current = i; D.app.activate(sheet.id, true); } })); },
    present: (sheet, i) => present(sheet, i)
  };
  D.sheetTypes.slide = T;
  const slideTitle = (s) => { const t = [...s.elements].filter((e) => e.type === 'text' && e.text).sort((a, b) => (b.style.fontSize || 18) - (a.style.fontSize || 18))[0]; return t ? D.f.resolveTokens(t.text).split('\n')[0].slice(0, 60) : 'Untitled slide'; };

  class SlideView {
    constructor(host, sheet) {
      this.sheet = sheet; this.host = host;
      if (sheet.current == null || sheet.current >= sheet.slides.length) sheet.current = 0;
      host.innerHTML = '';
      this.toolbar = h('div', { class: 'sheet-toolbar' });
      this.rail = h('div', { class: 'slide-rail' });
      this.center = h('div', { class: 'slide-center' });
      this.canvasHost = h('div', { class: 'canvas-host' });
      this.notes = h('textarea', { class: 'notes', placeholder: 'Speaker notes…' });
      this.insp = h('div', { class: 'inspector' });
      this.center.append(this.canvasHost, h('div', { class: 'notes-wrap' }, this.notes));
      host.append(this.toolbar, h('div', { class: 'sheet-body three' }, this.rail, this.center, this.insp));
      this.fc = new D.FreeCanvas(this.canvasHost, {
        model: () => ({ w: (sheet.size || {}).w || W, h: (sheet.size || {}).h || H, bg: this.slide().bg, elements: this.slide().elements }),
        onChange: (soon) => { soon ? D.commitSoon() : D.commit({ data: false }); this.refreshThumb(); },
        onSelect: () => this.inspect(),
        isActive: () => D.active() === sheet,
        onEditData: (e) => this.editData(e),
        onImagePick: (e) => this.pickImage(e),
        margins: 60,
        contextEmpty: (p) => [
          { label: 'Add text here', icon: 'text', onClick: () => this.fc.add(D.newElement('text', { x: Math.round(p.x), y: Math.round(p.y), text: 'Text' })) },
          { label: 'Insert from data…', icon: 'chart', onClick: () => this.insertData() },
          { label: 'Paste', disabled: !D.clipboardEls, onClick: () => this.fc.paste(D.clipboardEls, 0) },
          { sep: true },
          { label: 'Slide background', icon: 'palette', onClick: () => this.inspect() }
        ]
      });
      this.notes.addEventListener('input', () => { this.slide().notes = this.notes.value; D.commitSoon(); });
      this.buildToolbar();
      this.renderRail();
      this.show();
      this.unsub = D.on('changed', D.debounce(() => { if (D.active() === sheet && !document.querySelector('.el.editing')) this.renderRail(); }, 600));
    }
    destroy() { this.fc.destroy(); this.unsub(); }
    slide() { return this.sheet.slides[this.sheet.current]; }

    buildToolbar() {
      const tb = this.toolbar;
      tb.innerHTML = '';
      const addLayoutBtn = D.btn('plus', 'New slide', (ev) => this.layoutGallery(ev.currentTarget, (k) => this.addSlide(k)), { label: 'New slide', caret: true, cls: 'accent' });
      const shapeBtn = D.btn('shape', 'Shape', () => D.menu(shapeBtn, [['rect', 'Rectangle'], ['roundRect', 'Rounded rectangle'], ['ellipse', 'Ellipse'], ['line', 'Line']].map(([s, l]) => ({ label: l, onClick: () => this.fc.add(D.newElement('shape', { shape: s, x: 370, y: 210, ...(s === 'line' ? { w: 300, h: 12 } : {}) })) }))), { caret: true });
      tb.append(
        D.btn('undo', 'Undo', () => D.undo()), D.btn('redo', 'Redo', () => D.redo()), D.sep(),
        addLayoutBtn,
        D.btn('text', 'Text box', () => this.fc.add(D.newElement('text', { x: 260, y: 220, text: 'New text' })), { label: 'Text' }),
        shapeBtn,
        D.btn('image', 'Image', () => this.pickImage(null), { label: 'Image' }),
        D.sep(),
        D.btn('chart', 'Chart from data', () => this.insertData('chart'), { label: 'Chart' }),
        D.btn('table', 'Table from data', () => this.insertData('table'), { label: 'Table' }),
        D.btn('kpi', 'KPI card from data', () => this.insertData('kpi'), { label: 'KPI' }),
        D.btn('zap', 'Insert a live value into a text box', () => D.links.pickToken((tok) => this.fc.add(D.newElement('text', { x: 260, y: 220, text: tok, style: { fontSize: 24, bold: true } })))),
        D.sep(),
        (() => { const b = D.btn('layers', 'Change layout of this slide', () => this.layoutGallery(b, (k) => this.applyLayout(k)), { label: 'Layout', caret: true }); return b; })(),
        D.btn('palette', 'Apply brand colors & fonts to every slide', () => this.applyBrand(), { label: 'Apply brand' }),
        h('div', { class: 'tb-spacer' }),
        this.zoomCtl(),
        D.btn('play', 'Present from this slide (F5)', () => present(this.sheet, this.sheet.current), { label: 'Present', cls: 'primary' })
      );
    }
    zoomCtl() {
      const s = h('select', { class: 'input sm zoom-sel' }, [['fit', 'Fit'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.5', '150%']].map(([v, l]) => h('option', { value: v }, l)));
      s.addEventListener('change', () => this.fc.setZoom(s.value === 'fit' ? 'fit' : +s.value));
      return s;
    }

    layoutGallery(anchor, onPick) {
      D.closeMenus();
      const pop = h('div', { class: 'menu layout-pop' });
      Object.entries(LAYOUTS).forEach(([k, L]) => {
        const m = L.make(D.brand());
        const card = h('div', { class: 'layout-card', onclick: () => { D.closeMenus(); onPick(k); } }, D.renderPage({ w: W, h: H, bg: m.bg, elements: m.elements }, { scale: 150 / W, lazyCharts: true, cls: 'mini' }), h('span', null, L.label));
        pop.append(card);
      });
      document.body.append(pop);
      const r = anchor.getBoundingClientRect();
      pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + 'px';
      pop.style.top = r.bottom + 4 + 'px';
      setTimeout(() => document.addEventListener('mousedown', D._menuOut, true), 0);
    }

    addSlide(layout = 'content', after = this.sheet.current) {
      const s = newSlide(layout);
      this.sheet.slides.splice(after + 1, 0, s);
      this.sheet.current = after + 1;
      D.commit({ data: false });
      this.renderRail(); this.show();
    }
    applyLayout(k) {
      const sl = this.slide();
      const texts = sl.elements.filter((e) => e.type === 'text').sort((a, b) => (b.style.fontSize || 0) - (a.style.fontSize || 0));
      const keep = sl.elements.filter((e) => e.type !== 'text' && e.type !== 'shape');
      const m = LAYOUTS[k].make(D.brand(), { title: texts[0] && texts[0].text, body: texts[1] && texts[1].text });
      sl.bg = m.bg; sl.layout = k;
      // carry over data elements into the layout's chart slot when possible
      const slot = m.elements.find((e) => e.type === 'chart');
      if (slot && keep.find((e) => e.type === 'chart')) { const c = keep.find((e) => e.type === 'chart'); Object.assign(c, { x: slot.x, y: slot.y, w: slot.w, h: slot.h }); m.elements = m.elements.filter((e) => e !== slot); }
      sl.elements = [...m.elements, ...keep];
      D.commit({ data: false });
      this.show(); this.refreshThumb();
    }
    applyBrand() {
      const b = D.brand();
      this.sheet.slides.forEach((s) => s.elements.forEach((e) => {
        if (e.style) delete e.style.fontFace;
        if (e.type === 'shape' && e.style) e.style.fill = e.shape === 'line' || e.h <= 8 || e.w <= 16 ? b.accent : b.primary;
        if (e.type === 'text' && (e.style.fontSize || 0) >= 26 && !['#FFFFFF', '#ffffff'].includes(e.style.color)) e.style.color = b.dark;
        if (e.type === 'chart') delete e.colors;
        if (e.type === 'table') delete e.style.headerFill;
        if (e.type === 'kpi') e.style.accentColor = b.primary;
      }));
      if (b.logo) this.sheet.slides.forEach((s, i) => {
        if (i === 0 || s.elements.some((e) => e.isLogo)) return;
        s.elements.push(D.newElement('image', { src: b.logo, isLogo: true, x: W - 130, y: H - 50, w: 100, h: 32, z: 999 }));
      });
      D.commit({ data: false });
      this.show(); this.renderRail();
      D.toast(b.logo ? 'Brand colors, fonts and logo applied to every slide' : 'Brand colors and fonts applied - add a logo in Brand Kit to stamp it on slides', 'ok');
    }

    async insertData(kind = 'chart', replace = null) {
      const r = await D.links.insertDialog({ kind, link: replace && replace.link, allowKinds: replace ? [replace.type] : ['chart', 'table', 'kpi'] });
      if (!r) return;
      if (replace) { replace.link = r.link; if (r.chartType && replace.type === 'chart') replace.chartType = r.chartType; if (r.title) replace.title = r.title; delete replace.staticData; delete replace.staticRows; this.fc.refreshEl(replace); D.commit(); this.inspect(); this.refreshThumb(); return; }
      const slot = this.slide().elements.find((e) => e.type === r.kind && !e.link && !e.staticData && !e.staticRows && !(r.kind === 'kpi' && e.expr));
      if (slot) {
        if (r.kind === 'kpi') { slot.expr = r.expr; slot.label = r.label; } else { slot.link = r.link; if (r.chartType) slot.chartType = r.chartType; if (r.title) slot.title = r.title; }
        this.fc.render(); this.fc.select(slot.id); D.commit(); this.refreshThumb(); return;
      }
      const e = r.kind === 'kpi'
        ? D.newElement('kpi', { expr: r.expr, label: r.label, x: 360, y: 200, w: 260, h: 140, style: { fontSize: 40, fill: '#F4F7FD' } })
        : D.newElement(r.kind, { link: r.link, chartType: r.chartType, title: r.title, x: 120, y: 110, w: 720, h: 390 });
      this.fc.add(e);
    }
    editData(e) { if (e.type === 'kpi') return this.inspect(); this.insertData(e.type, e); }
    async pickImage(target) {
      const src = await window.native.pickImage();
      if (!src) return;
      const img = await D.loadImage(src);
      if (target) { target.src = src; this.fc.refreshEl(target); D.commit({ data: false }); this.refreshThumb(); return; }
      let w = Math.min(img.naturalWidth, 600), hh = w * img.naturalHeight / img.naturalWidth;
      if (hh > 440) { hh = 440; w = hh * img.naturalWidth / img.naturalHeight; }
      this.fc.add(D.newElement('image', { src, w: Math.round(w), h: Math.round(hh), x: Math.round((W - w) / 2), y: Math.round((H - hh) / 2) }));
    }

    show() {
      this.fc.render();
      this.notes.value = this.slide().notes || '';
      this.inspect();
      this.rail.querySelectorAll('.thumb').forEach((t, i) => t.classList.toggle('on', i === this.sheet.current));
      D.app.setStatus(`Slide <b>${this.sheet.current + 1}</b> of ${this.sheet.slides.length}<span class="st-sep"></span>${this.slide().elements.filter((e) => e.link || e.expr || D.f.hasTokens(e.text)).length} linked element(s)`);
    }
    go(i) {
      this.sheet.current = D.clamp(i, 0, this.sheet.slides.length - 1);
      this.show();
      const t = this.rail.querySelectorAll('.thumb')[this.sheet.current];
      t && t.scrollIntoView({ block: 'nearest' });
    }

    renderRail() {
      const rail = this.rail;
      const st = rail.scrollTop;
      rail.innerHTML = '';
      const sz = this.sheet.size || { w: W, h: H };
      const scale = 168 / sz.w;
      this.sheet.slides.forEach((s, i) => {
        const t = h('div', { class: `thumb ${i === this.sheet.current ? 'on' : ''}`, draggable: 'true', dataset: { i } },
          h('span', { class: 'thumb-n' }, i + 1),
          D.renderPage({ ...sz, bg: s.bg, elements: s.elements }, { scale, lazyCharts: true }));
        t.addEventListener('click', () => this.go(i));
        t.addEventListener('contextmenu', (e) => { e.preventDefault(); this.go(i); D.menu({ x: e.clientX, y: e.clientY }, [
          { label: 'New slide after', icon: 'plus', onClick: () => this.addSlide('content', i) },
          { label: 'Duplicate', icon: 'copy', onClick: () => { const c = D.clone(s); c.id = D.uid(); c.elements.forEach((x) => { x.id = D.uid(); }); this.sheet.slides.splice(i + 1, 0, c); this.sheet.current = i + 1; D.commit({ data: false }); this.renderRail(); this.show(); } },
          { label: 'Move up', icon: 'arrowUp', disabled: i === 0, onClick: () => this.moveSlide(i, i - 1) },
          { label: 'Move down', icon: 'arrowDown', disabled: i === this.sheet.slides.length - 1, onClick: () => this.moveSlide(i, i + 1) },
          { label: 'Send slide to report (as image)', icon: 'report', onClick: () => this.slideToReport(s) },
          { sep: true },
          { label: 'Delete slide', icon: 'trash', danger: true, disabled: this.sheet.slides.length === 1, onClick: () => this.deleteSlide(i) }
        ]); });
        t.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-slide', String(i)); t.classList.add('dragging'); });
        t.addEventListener('dragend', () => t.classList.remove('dragging'));
        t.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-slide')) { e.preventDefault(); const r = t.getBoundingClientRect(); t.classList.toggle('drop-before', e.clientY < r.top + r.height / 2); t.classList.toggle('drop-after', e.clientY >= r.top + r.height / 2); } });
        t.addEventListener('dragleave', () => t.classList.remove('drop-before', 'drop-after'));
        t.addEventListener('drop', (e) => {
          e.preventDefault();
          const from = +e.dataTransfer.getData('text/x-slide');
          const r = t.getBoundingClientRect();
          let to = e.clientY < r.top + r.height / 2 ? i : i + 1;
          if (from < to) to--;
          t.classList.remove('drop-before', 'drop-after');
          this.moveSlide(from, to);
        });
        rail.append(t);
      });
      rail.append(h('button', { class: 'rail-add', onclick: () => this.addSlide('content', this.sheet.slides.length - 1), html: D.icon('plus', 16) + '<span>Add slide</span>' }));
      rail.scrollTop = st;
    }
    refreshThumb() {
      const t = this.rail.querySelectorAll('.thumb')[this.sheet.current];
      if (!t) return;
      const sz = this.sheet.size || { w: W, h: H };
      const s = this.slide();
      t.querySelector('.page-static-wrap').replaceWith(D.renderPage({ ...sz, bg: s.bg, elements: s.elements }, { scale: 168 / sz.w, lazyCharts: true }));
    }
    moveSlide(from, to) {
      if (from === to || to < 0 || to >= this.sheet.slides.length) return;
      const [s] = this.sheet.slides.splice(from, 1);
      this.sheet.slides.splice(to, 0, s);
      this.sheet.current = to;
      D.commit({ data: false }); this.renderRail(); this.show();
    }
    deleteSlide(i) {
      if (this.sheet.slides.length === 1) return;
      this.sheet.slides.splice(i, 1);
      this.sheet.current = Math.min(i, this.sheet.slides.length - 1);
      D.commit({ data: false }); this.renderRail(); this.show();
    }
    async slideToReport(s) {
      const sz = this.sheet.size || { w: W, h: H };
      const png = await D.io.pageToPng({ ...sz, bg: s.bg, elements: s.elements });
      const rep = D.project().sheets.find((x) => x.type === 'report') || D.app.addSheet('report', { activate: false });
      D.sheetTypes.report.addElement(rep, D.newElement('image', { src: png, w: 480, h: 270 }));
      D.toast(`Slide added to ${rep.name}`, 'ok');
    }

    inspect() {
      D.buildInspector(this.insp, this.fc, {
        none: (panel, section, row) => {
          const sl = this.slide();
          panel.append(h('div', { class: 'insp-head' }, h('span', { html: D.icon('slide', 15) }), `Slide ${this.sheet.current + 1}`));
          panel.append(section('Background',
            row('Color', h('div', { class: 'swatch-row' },
              D.colorInput(sl.bg || '#FFFFFF', (v, done) => { sl.bg = v; this.fc.render(); if (done) { D.commit({ data: false }); this.refreshThumb(); } }),
              ['#FFFFFF', '#F4F7FD', D.brand().dark, D.brand().primary, '#111827'].map((c) => h('button', { class: 'sw-dot', style: { background: c }, onclick: () => { sl.bg = c; this.fc.render(); D.commit({ data: false }); this.refreshThumb(); } })))),
            h('div', { class: 'insp-btns' }, h('button', { class: 'btn sm ghost', onclick: () => { this.sheet.slides.forEach((x) => { x.bg = sl.bg; }); D.commit({ data: false }); this.renderRail(); D.toast('Background applied to all slides', 'ok'); } }, 'Apply to all slides'))));
          panel.append(section('Deck',
            row('Slides', h('span', { class: 'muted' }, String(this.sheet.slides.length))),
            row('Size', h('span', { class: 'muted' }, (this.sheet.size || {}).h && Math.abs(this.sheet.size.w / this.sheet.size.h - 4 / 3) < 0.02 ? '4:3' : '16:9 widescreen'))));
          panel.append(section('Tips', h('div', { class: 'insp-hint' },
            h('div', null, h('b', null, 'Double-click'), ' text to edit · ', h('b', null, 'Shift'), ' to constrain'),
            h('div', null, h('b', null, 'Alt'), '-drag to skip snapping'),
            h('div', null, 'Drop images straight onto the slide'),
            h('div', null, 'Charts & tables update when their data changes'))));
        }
      });
    }
  }

  // ------------------------------------------------ presenter
  function present(sheet, start = 0) {
    let i = start;
    const sz = sheet.size || { w: W, h: H };
    const ov = h('div', { class: 'presenter' });
    const stage = h('div', { class: 'presenter-stage' });
    const bar = h('div', { class: 'presenter-bar' });
    ov.append(stage, bar);
    document.body.append(ov);
    let black = false;
    const draw = () => {
      const sc = Math.min(innerWidth / sz.w, innerHeight / sz.h);
      stage.innerHTML = '';
      if (black) return;
      const s = sheet.slides[i];
      const page = D.renderPage({ ...sz, bg: s.bg, elements: s.elements }, { scale: sc });
      stage.append(page);
      bar.textContent = `${i + 1} / ${sheet.slides.length}  ·  ← → to move · B to black out · Esc to exit`;
    };
    const key = (e) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { i = Math.min(i + 1, sheet.slides.length - 1); black = false; draw(); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { i = Math.max(i - 1, 0); black = false; draw(); }
      else if (e.key === 'Home') { i = 0; draw(); }
      else if (e.key === 'End') { i = sheet.slides.length - 1; draw(); }
      else if (e.key.toLowerCase() === 'b') { black = !black; draw(); }
      else if (e.key === 'Escape') { close(); return; }
      e.preventDefault(); e.stopPropagation();
    };
    const close = () => { document.removeEventListener('keydown', key, true); window.removeEventListener('resize', draw); ov.remove(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
    ov.addEventListener('click', (e) => { if (e.clientX > innerWidth / 3) { i = Math.min(i + 1, sheet.slides.length - 1); } else i = Math.max(0, i - 1); draw(); });
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', draw);
    document.documentElement.requestFullscreen().catch(() => {}).finally(() => setTimeout(draw, 80));
    draw();
  }
})();
