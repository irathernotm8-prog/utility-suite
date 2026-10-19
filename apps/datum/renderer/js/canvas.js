// Datum - freeform canvas (slides + reports): element rendering, editing, inspector
(function () {
  const h = D.h;
  const PT = 96 / 72;

  // ---------------------------------------------------------------- element rendering
  D.tableRows = (e) => {
    let rows = e.link ? D.f.trimRows(D.f.linkRows(e.link)) : e.staticRows;
    if (!rows) return null;
    if (e.maxRows && rows.length > e.maxRows + 1) rows = rows.slice(0, e.maxRows + 1);
    return rows;
  };
  D.kpiParts = (e) => {
    const value = e.expr ? D.f.displayExpr(e.expr, e.format) : (e.value || '-');
    let delta = null, up = true;
    if (e.compareExpr) {
      const a = D.f.safeEval(e.expr), b = D.f.safeEval(e.compareExpr);
      if (typeof a === 'number' && typeof b === 'number' && b !== 0) {
        const g = (a - b) / Math.abs(b);
        const rising = g >= 0;
        up = e.lowerIsBetter ? !rising : rising;
        delta = `${rising ? '▲' : '▼'} ${Math.abs(g * 100).toFixed(1)}% ${e.compareLabel || 'vs prior'}`;
      }
    }
    return { label: D.f.resolveTokens(e.label || ''), value, delta, up };
  };

  D.renderElementContent = (node, e, opts = {}) => {
    const st = e.style || {};
    const brand = D.brand();
    node.innerHTML = '';
    node.className = `el el-${e.type}`;
    node.style.cssText = `left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;z-index:${e.z || 1};` + (e.rotate ? `transform:rotate(${e.rotate}deg);` : '') + (e.opacity != null ? `opacity:${e.opacity};` : '');
    const font = st.fontFace || brand.font || 'Inter';
    const textCss = `font-family:'${font}', 'Inter Variable', Inter, sans-serif;font-size:${(st.fontSize || 18) * PT}px;color:${st.color || '#111827'};font-weight:${st.bold ? 700 : 400};font-style:${st.italic ? 'italic' : 'normal'};text-decoration:${st.underline ? 'underline' : 'none'};text-align:${st.align || 'left'};line-height:${st.lineHeight || 1.2};`;
    const vAlign = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[st.valign || (e.type === 'shape' ? 'middle' : 'top')];
    switch (e.type) {
      case 'text': {
        const box = h('div', { class: 'el-text-inner', style: { justifyContent: vAlign } });
        box.style.cssText += textCss + (st.fill ? `background:${st.fill};` : '') + (st.radius ? `border-radius:${st.radius}px;` : '');
        const text = D.f.resolveTokens(e.text || '');
        if (st.bullets) {
          const ul = h('ul', { class: 'el-bullets' });
          text.split('\n').forEach((t) => ul.append(h('li', null, t || ' ')));
          box.append(ul);
        } else {
          box.append(h('div', { class: 'el-text-body' }, text || (opts.editable ? '' : '')));
          if (!text && opts.editable) box.append(h('div', { class: 'el-placeholder' }, 'Double-click to type'));
        }
        if (D.f.hasTokens(e.text) && opts.editable) node.append(h('div', { class: 'el-live', title: 'Contains live values', html: D.icon('zap', 11) }));
        node.prepend(box);
        break;
      }
      case 'shape': {
        const box = h('div', { class: 'el-shape-inner', style: { justifyContent: vAlign } });
        const radius = e.shape === 'ellipse' ? '50%' : e.shape === 'roundRect' ? Math.min(e.w, e.h) * 0.14 + 'px' : (st.radius || 0) + 'px';
        if (e.shape === 'line') {
          box.style.cssText = `position:absolute;left:0;right:0;top:50%;height:${st.strokeWidth || 3}px;margin-top:-${(st.strokeWidth || 3) / 2}px;background:${st.fill || brand.primary};`;
        } else {
          box.style.cssText += `background:${st.fill || brand.primary};border-radius:${radius};` + (st.stroke ? `border:${st.strokeWidth || 1}px solid ${st.stroke};` : '') + textCss + `color:${st.color || '#FFFFFF'};text-align:${st.align || 'center'};`;
          box.append(h('div', { class: 'el-text-body' }, D.f.resolveTokens(e.text || '')));
        }
        node.append(box);
        break;
      }
      case 'image': {
        if (e.src) {
          const frame = h('div', { class: 'el-img-frame', style: { borderRadius: (st.radius || 0) + 'px', border: st.borderWidth ? `${st.borderWidth}px solid ${st.borderColor || '#FFFFFF'}` : 'none', boxShadow: st.shadow ? '0 10px 28px rgba(15,23,42,.28), 0 2px 6px rgba(15,23,42,.18)' : 'none', background: st.borderWidth && st.matte ? st.borderColor : 'transparent' } },
            h('img', { src: e.src, draggable: 'false', style: { objectFit: e.fit || 'contain' } }));
          node.append(frame);
        }
        else node.append(h('div', { class: 'el-empty', html: D.icon('image', 22) + '<span>Image</span>' }));
        break;
      }
      case 'table': {
        const rows = D.tableRows(e);
        if (!rows || !rows.length) { node.append(h('div', { class: 'el-empty', html: D.icon('table', 22) + '<span>Link a data range</span>' })); break; }
        const fs = (st.fontSize || 12) * PT;
        const hdr = st.headerFill || brand.primary;
        const t = h('table', { class: 'el-table', style: { fontSize: fs + 'px', fontFamily: `'${font}', 'Inter Variable', sans-serif` } });
        rows.forEach((row, ri) => {
          const tr = h('tr');
          row.forEach((v) => {
            const isHead = ri === 0 && st.header !== false;
            const numeric = /^[-$(]?[\d,.]+%?\)?$/.test(String(v).trim());
            tr.append(h(isHead ? 'th' : 'td', { style: isHead ? { background: hdr, color: '#fff' } : { textAlign: numeric ? 'right' : 'left' } }, v));
          });
          t.append(tr);
        });
        node.append(h('div', { class: 'el-table-wrap' }, t));
        break;
      }
      case 'chart': {
        const host = h('div', { class: 'el-chart-host' });
        node.append(host);
        if (opts.lazyCharts) {
          const png = D.charts.toPng(e, e.w, e.h, Math.min(1.6, Math.max(0.6, e.w / 520)));
          if (png) host.append(h('img', { src: png, style: { width: '100%', height: '100%' } }));
        } else {
          requestAnimationFrame(() => D.charts.render(host, e, { w: e.w, h: e.h, scale: Math.min(1.6, Math.max(0.6, e.w / 520)) }));
        }
        break;
      }
      case 'kpi': {
        const k = D.kpiParts(e);
        const fs = Math.min((st.fontSize || 32) * PT, (e.w - 40) / Math.max(1, String(k.value).length * 0.6), (e.h - 30) * 0.6);
        const box = h('div', { class: 'el-kpi-inner', style: { justifyContent: vAlign, textAlign: st.align || 'left', background: st.fill || 'transparent', fontFamily: `'${font}', 'Inter Variable', sans-serif` } });
        if (st.fill) box.classList.add('filled');
        if (st.accent !== false) box.style.borderLeft = `4px solid ${st.accentColor || brand.primary}`;
        box.append(
          h('div', { class: 'kpi-label', style: { fontSize: Math.max(11, fs * 0.36) + 'px' } }, k.label),
          h('div', { class: 'kpi-value', style: { fontSize: fs + 'px', color: st.color || '#0B1530' } }, k.value),
          k.delta ? h('div', { class: `kpi-delta ${k.up ? 'up' : 'down'}`, style: { fontSize: Math.max(10, fs * 0.33) + 'px' } }, k.delta) : null
        );
        node.append(box);
        break;
      }
    }
    if (e.link && opts.editable) node.append(h('div', { class: 'el-link-badge', title: `Linked to ${(D.sheet(e.link.sheetId) || {}).name || 'missing sheet'} ${e.link.range}`, html: D.icon('link', 11) }));
    return node;
  };

  // Static, non-interactive render of a whole page (thumbnails, presenter, print)
  D.renderPage = (model, { scale = 1, lazyCharts = false, cls = '' } = {}) => {
    const stage = h('div', { class: `page-static ${cls}`, style: { width: model.w + 'px', height: model.h + 'px', background: model.bg || '#fff', transform: `scale(${scale})` } });
    if (model.bgImage) stage.style.backgroundImage = `url(${model.bgImage})`;
    [...model.elements].sort((a, b) => (a.z || 1) - (b.z || 1)).forEach((e) => stage.append(D.renderElementContent(h('div'), e, { lazyCharts })));
    const wrap = h('div', { class: 'page-static-wrap', style: { width: model.w * scale + 'px', height: model.h * scale + 'px' } }, stage);
    return wrap;
  };

  // Element factory with sensible defaults
  D.newElement = (type, props = {}) => {
    const b = D.brand();
    const base = { id: D.uid(), type, x: 80, y: 80, w: 320, h: 120, z: 1, style: {} };
    const defs = {
      text: { w: 420, h: 80, text: '', style: { fontSize: 20, color: '#111827' } },
      shape: { shape: 'roundRect', w: 220, h: 120, text: '', style: { fill: b.primary, color: '#FFFFFF', fontSize: 18 } },
      image: { w: 320, h: 220, src: null, fit: 'contain' },
      table: { w: 460, h: 220, style: { fontSize: 12 } },
      chart: { w: 480, h: 300, chartType: 'bar', title: '' },
      kpi: { w: 230, h: 120, label: 'Metric', expr: '', format: 'auto', style: { fontSize: 32 } }
    };
    const d = D.clone(defs[type] || {});
    return { ...base, ...d, ...props, style: { ...base.style, ...d.style, ...(props.style || {}) } };
  };

  // ---------------------------------------------------------------- FreeCanvas
  class FreeCanvas {
    constructor(host, opts) {
      this.host = host;
      this.o = opts;
      this.sel = new Set();
      this.zoom = 'fit';
      this.scale = 1;
      this.viewport = h('div', { class: 'fc-viewport', tabindex: '0' });
      this.scaler = h('div', { class: 'fc-scaler' });
      this.stage = h('div', { class: 'fc-stage' });
      this.overlay = h('div', { class: 'fc-overlay' });
      this.scaler.append(this.stage);
      this.viewport.append(this.scaler);
      host.append(this.viewport);
      this.nodes = new Map();
      this._onKey = this.onKey.bind(this);
      document.addEventListener('keydown', this._onKey);
      this.viewport.addEventListener('mousedown', (ev) => this.onDown(ev));
      this.viewport.addEventListener('dblclick', (ev) => this.onDbl(ev));
      this.viewport.addEventListener('contextmenu', (ev) => this.onContext(ev));
      this.viewport.addEventListener('wheel', (ev) => { if (ev.ctrlKey) { ev.preventDefault(); this.setZoom(D.clamp(this.scale * (ev.deltaY < 0 ? 1.1 : 0.9), 0.2, 3)); } }, { passive: false });
      this.ro = new ResizeObserver(() => { if (this.zoom === 'fit') this.layout(); });
      this.ro.observe(this.viewport);
      this.viewport.addEventListener('dragover', (ev) => { if ([...ev.dataTransfer.types].includes('Files')) { ev.preventDefault(); ev.stopPropagation(); } });
      this.viewport.addEventListener('drop', (ev) => this.onDropFiles(ev));
    }
    destroy() { document.removeEventListener('keydown', this._onKey); this.ro.disconnect(); this.stage.querySelectorAll('.el-chart-host').forEach((x) => x._chart && x._chart.destroy()); }
    model() { return this.o.model(); }
    els() { return this.model().elements; }
    get(id) { return this.els().find((e) => e.id === id); }
    selected() { return this.els().filter((e) => this.sel.has(e.id)); }

    setZoom(z) { this.zoom = z; this.layout(); this.o.onZoom && this.o.onZoom(this.scale); }
    layout() {
      const m = this.model();
      const vw = this.viewport.clientWidth - 64, vh = this.viewport.clientHeight - 64;
      if (this.zoom === 'fit') this.scale = Math.max(0.15, Math.min(vw / m.w, this.o.fitWidth ? 10 : vh / m.h, this.o.maxFit || 1.6));
      else if (this.zoom === 'width') this.scale = Math.max(0.15, vw / m.w);
      else this.scale = this.zoom;
      this.stage.style.transform = `scale(${this.scale})`;
      this.stage.style.width = m.w + 'px';
      this.stage.style.height = m.h + 'px';
      this.scaler.style.width = m.w * this.scale + 'px';
      this.scaler.style.height = m.h * this.scale + 'px';
      this.stage.style.setProperty('--inv', 1 / this.scale);
      this.drawSelection();
    }

    render() {
      const m = this.model();
      this.stage.querySelectorAll('.el-chart-host').forEach((x) => x._chart && x._chart.destroy());
      this.stage.innerHTML = '';
      this.stage.style.background = m.bg || '#FFFFFF';
      this.stage.style.backgroundImage = m.bgImage ? `url(${m.bgImage})` : '';
      if (this.o.pageHeight) {
        for (let y = this.o.pageHeight; y < m.h; y += this.o.pageHeight) this.stage.append(h('div', { class: 'fc-pagebreak', style: { top: y + 'px' } }, h('span', null, `Page ${Math.round(y / this.o.pageHeight) + 1}`)));
      }
      this.nodes.clear();
      for (const e of [...m.elements].sort((a, b) => (a.z || 1) - (b.z || 1))) {
        const n = D.renderElementContent(h('div'), e, { editable: true });
        n.dataset.id = e.id;
        this.nodes.set(e.id, n);
        this.stage.append(n);
      }
      for (const id of [...this.sel]) if (!this.get(id)) this.sel.delete(id);
      this.stage.append(this.overlay);
      this.layout();
    }
    refreshEl(e) {
      const n = this.nodes.get(e.id);
      if (!n) return this.render();
      if (n.querySelector('.el-chart-host')) n.querySelector('.el-chart-host')._chart?.destroy();
      D.renderElementContent(n, e, { editable: true });
      n.dataset.id = e.id;
      this.drawSelection();
    }

    select(ids, add = false) {
      if (!add) this.sel.clear();
      (Array.isArray(ids) ? ids : [ids]).forEach((id) => id && this.sel.add(id));
      this.drawSelection();
      this.o.onSelect && this.o.onSelect(this.selected());
    }
    clearSel() { if (!this.sel.size) return; this.sel.clear(); this.drawSelection(); this.o.onSelect && this.o.onSelect([]); }

    drawSelection() {
      this.overlay.innerHTML = '';
      this.nodes.forEach((n, id) => n.classList.toggle('selected', this.sel.has(id)));
      const s = this.selected();
      if (!s.length) return;
      const bx = this.bounds(s);
      const box = h('div', { class: 'fc-selbox', style: { left: bx.x + 'px', top: bx.y + 'px', width: bx.w + 'px', height: bx.h + 'px' } });
      if (s.length === 1 && !s[0].locked) {
        ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((d) => box.append(h('div', { class: `fc-handle h-${d}`, dataset: { dir: d } })));
        box.append(h('div', { class: 'fc-dims' }, `${Math.round(s[0].w)} × ${Math.round(s[0].h)}`));
      }
      this.overlay.append(box);
    }
    bounds(list) {
      const x = Math.min(...list.map((e) => e.x)), y = Math.min(...list.map((e) => e.y));
      const r = Math.max(...list.map((e) => e.x + e.w)), b = Math.max(...list.map((e) => e.y + e.h));
      return { x, y, w: r - x, h: b - y };
    }
    toModel(ev) {
      const r = this.stage.getBoundingClientRect();
      return { x: (ev.clientX - r.left) / this.scale, y: (ev.clientY - r.top) / this.scale };
    }

    onDown(ev) {
      if (ev.button !== 0) return;
      if (ev.target.closest('[contenteditable="true"]')) return;
      this.viewport.focus({ preventScroll: true });
      const handle = ev.target.closest('.fc-handle');
      if (handle) return this.startResize(ev, handle.dataset.dir);
      const node = ev.target.closest('.el');
      if (node && node.dataset.id) {
        const id = node.dataset.id;
        if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
          if (this.sel.has(id)) { this.sel.delete(id); this.drawSelection(); this.o.onSelect(this.selected()); return; }
          this.select(id, true);
        } else if (!this.sel.has(id)) this.select(id);
        return this.startDrag(ev);
      }
      if (ev.target.closest('.fc-selbox')) return this.startDrag(ev);
      // marquee
      const start = this.toModel(ev);
      if (!ev.shiftKey) this.clearSel();
      const mq = h('div', { class: 'fc-marquee' });
      this.stage.append(mq);
      const move = (e2) => {
        const p = this.toModel(e2);
        const x = Math.min(p.x, start.x), y = Math.min(p.y, start.y), w = Math.abs(p.x - start.x), hh = Math.abs(p.y - start.y);
        Object.assign(mq.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
        const hit = this.els().filter((e) => e.x < x + w && e.x + e.w > x && e.y < y + hh && e.y + e.h > y && !e.locked).map((e) => e.id);
        this.sel = new Set(hit);
        this.drawSelection();
      };
      const up = () => { mq.remove(); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); this.o.onSelect(this.selected()); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    }

    snapTargets(excludeIds) {
      const m = this.model();
      const xs = [0, m.w / 2, m.w], ys = [0, m.h / 2, m.h];
      if (this.o.margins) { xs.push(this.o.margins, m.w - this.o.margins); ys.push(this.o.margins); }
      this.els().forEach((e) => { if (excludeIds.has(e.id)) return; xs.push(e.x, e.x + e.w / 2, e.x + e.w); ys.push(e.y, e.y + e.h / 2, e.y + e.h); });
      return { xs, ys };
    }
    showGuides(gx, gy) {
      this.overlay.querySelectorAll('.fc-guide').forEach((g) => g.remove());
      const m = this.model();
      if (gx != null) this.overlay.append(h('div', { class: 'fc-guide v', style: { left: gx + 'px', height: m.h + 'px' } }));
      if (gy != null) this.overlay.append(h('div', { class: 'fc-guide hz', style: { top: gy + 'px', width: m.w + 'px' } }));
    }

    startDrag(ev) {
      const sel = this.selected().filter((e) => !e.locked);
      if (!sel.length) return;
      const start = this.toModel(ev);
      const orig = sel.map((e) => ({ e, x: e.x, y: e.y }));
      const bx0 = this.bounds(sel);
      const targets = this.snapTargets(this.sel);
      const T = 6 / this.scale;
      let moved = false;
      const move = (e2) => {
        const p = this.toModel(e2);
        let dx = p.x - start.x, dy = p.y - start.y;
        if (!moved && Math.hypot(dx, dy) < 2 / this.scale) return;
        moved = true;
        if (e2.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        let gx = null, gy = null;
        if (!e2.altKey) {
          const cx = [bx0.x + dx, bx0.x + dx + bx0.w / 2, bx0.x + dx + bx0.w];
          let best = T, bd = 0;
          for (const t of targets.xs) cx.forEach((c) => { const d = t - c; if (Math.abs(d) < best) { best = Math.abs(d); gx = t; bd = d; } });
          dx += bd;
          const cy = [bx0.y + dy, bx0.y + dy + bx0.h / 2, bx0.y + dy + bx0.h];
          best = T; bd = 0;
          for (const t of targets.ys) cy.forEach((c) => { const d = t - c; if (Math.abs(d) < best) { best = Math.abs(d); gy = t; bd = d; } });
          dy += bd;
        }
        orig.forEach((o) => { o.e.x = Math.round(o.x + dx); o.e.y = Math.round(o.y + dy); const n = this.nodes.get(o.e.id); if (n) { n.style.left = o.e.x + 'px'; n.style.top = o.e.y + 'px'; } });
        this.drawSelection();
        this.showGuides(gx, gy);
      };
      const up = () => {
        window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
        this.showGuides(null, null);
        if (moved) { this.o.onChange(); this.o.onSelect(this.selected()); }
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    }

    startResize(ev, dir) {
      ev.stopPropagation();
      const e = this.selected()[0];
      if (!e) return;
      const start = this.toModel(ev);
      const o = { x: e.x, y: e.y, w: e.w, h: e.h };
      const ratio = o.w / o.h;
      const keep = e.type === 'image' || e.type === 'kpi' && false;
      const targets = this.snapTargets(new Set([e.id]));
      const T = 6 / this.scale;
      const move = (e2) => {
        const p = this.toModel(e2);
        let dx = p.x - start.x, dy = p.y - start.y;
        let { x, y, w, h: hh } = o;
        if (dir.includes('e')) w = o.w + dx;
        if (dir.includes('s')) hh = o.h + dy;
        if (dir.includes('w')) { w = o.w - dx; x = o.x + dx; }
        if (dir.includes('n')) { hh = o.h - dy; y = o.y + dy; }
        let gx = null, gy = null;
        if (!e2.altKey) {
          if (dir.includes('e')) for (const t of targets.xs) if (Math.abs(x + w - t) < T) { w = t - x; gx = t; break; }
          if (dir.includes('w')) for (const t of targets.xs) if (Math.abs(x - t) < T) { w += x - t; x = t; gx = t; break; }
          if (dir.includes('s')) for (const t of targets.ys) if (Math.abs(y + hh - t) < T) { hh = t - y; gy = t; break; }
          if (dir.includes('n')) for (const t of targets.ys) if (Math.abs(y - t) < T) { hh += y - t; y = t; gy = t; break; }
        }
        if ((keep ? !e2.shiftKey : e2.shiftKey) && dir.length === 2) {
          if (w / hh > ratio) w = hh * ratio; else hh = w / ratio;
          if (dir.includes('w')) x = o.x + o.w - w;
          if (dir.includes('n')) y = o.y + o.h - hh;
        }
        e.x = Math.round(x); e.y = Math.round(y); e.w = Math.round(Math.max(12, w)); e.h = Math.round(Math.max(12, hh));
        const n = this.nodes.get(e.id);
        Object.assign(n.style, { left: e.x + 'px', top: e.y + 'px', width: e.w + 'px', height: e.h + 'px' });
        this.drawSelection();
        this.showGuides(gx, gy);
      };
      const up = () => {
        window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
        this.showGuides(null, null);
        this.refreshEl(e);
        this.o.onChange();
        this.o.onSelect(this.selected());
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    }

    onDbl(ev) {
      const node = ev.target.closest('.el');
      if (!node) return;
      const e = this.get(node.dataset.id);
      if (!e) return;
      if (e.type === 'text' || e.type === 'shape') this.editText(e);
      else if (e.type === 'image') this.o.onImagePick && this.o.onImagePick(e);
      else this.o.onEditData && this.o.onEditData(e);
    }
    editText(e) {
      const n = this.nodes.get(e.id);
      if (!n) return;
      this.select(e.id);
      const inner = n.querySelector('.el-text-inner, .el-shape-inner') || n;
      inner.innerHTML = '';
      const ed = h('div', { class: 'el-editor', contenteditable: 'true', spellcheck: 'true' });
      ed.innerText = e.text || '';
      if ((e.style || {}).bullets) ed.classList.add('bulleted');
      inner.append(ed);
      n.classList.add('editing');
      ed.focus();
      const range = document.createRange(); range.selectNodeContents(ed); window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
      const finish = () => {
        ed.removeEventListener('blur', finish);
        const txt = ed.innerText.replace(/\n$/, '').replace(/ /g, ' ');
        n.classList.remove('editing');
        const changed = txt !== (e.text || '');
        e.text = txt;
        this.refreshEl(e);
        if (changed) this.o.onChange();
      };
      ed.addEventListener('blur', finish);
      ed.addEventListener('keydown', (k) => {
        k.stopPropagation();
        if (k.key === 'Escape') { ed.blur(); }
        if (k.key === 'Enter' && (k.ctrlKey || k.metaKey)) { k.preventDefault(); ed.blur(); }
      });
      ed.addEventListener('paste', (p) => { p.preventDefault(); document.execCommand('insertText', false, p.clipboardData.getData('text/plain')); });
    }

    onContext(ev) {
      ev.preventDefault();
      const node = ev.target.closest('.el');
      if (node && !this.sel.has(node.dataset.id)) this.select(node.dataset.id);
      const s = this.selected();
      const items = s.length ? [
        { label: 'Edit text', icon: 'edit', disabled: !(s.length === 1 && (s[0].type === 'text' || s[0].type === 'shape')), onClick: () => this.editText(s[0]) },
        s.length === 1 && ['chart', 'table'].includes(s[0].type) ? { label: 'Change data range…', icon: 'link', onClick: () => this.o.onEditData(s[0]) } : null,
        { label: 'Duplicate', icon: 'copy', kbd: 'Ctrl+D', onClick: () => this.duplicate() },
        { sep: true },
        { label: 'Bring to front', icon: 'front', kbd: 'Ctrl+]', onClick: () => this.zorder(1) },
        { label: 'Send to back', icon: 'back', kbd: 'Ctrl+[', onClick: () => this.zorder(-1) },
        s.length > 1 ? { label: 'Align', icon: 'alignLeft', sub: this.alignItems() } : null,
        { sep: true },
        ...(this.o.contextExtra ? this.o.contextExtra(s) : []),
        { label: 'Delete', icon: 'trash', kbd: 'Del', danger: true, onClick: () => this.remove() }
      ] : (this.o.contextEmpty ? this.o.contextEmpty(this.toModel(ev)) : []);
      if (items.length) D.menu({ x: ev.clientX, y: ev.clientY }, items);
    }
    alignItems() {
      const a = (fn) => () => { const s = this.selected(); const b = this.bounds(s); s.forEach((e) => fn(e, b)); this.render(); this.o.onChange(); };
      return [
        { label: 'Left', onClick: a((e, b) => { e.x = b.x; }) },
        { label: 'Center', onClick: a((e, b) => { e.x = Math.round(b.x + b.w / 2 - e.w / 2); }) },
        { label: 'Right', onClick: a((e, b) => { e.x = b.x + b.w - e.w; }) },
        { label: 'Top', onClick: a((e, b) => { e.y = b.y; }) },
        { label: 'Middle', onClick: a((e, b) => { e.y = Math.round(b.y + b.h / 2 - e.h / 2); }) },
        { label: 'Bottom', onClick: a((e, b) => { e.y = b.y + b.h - e.h; }) },
        { sep: true },
        { label: 'Distribute horizontally', onClick: () => { const s = this.selected().sort((p, q) => p.x - q.x); if (s.length < 3) return; const b = this.bounds(s); const gap = (b.w - s.reduce((t, e) => t + e.w, 0)) / (s.length - 1); let x = b.x; s.forEach((e) => { e.x = Math.round(x); x += e.w + gap; }); this.render(); this.o.onChange(); } },
        { label: 'Match widths', onClick: a((e) => { e.w = this.selected()[0].w; }) }
      ];
    }

    onKey(ev) {
      if (!this.host.isConnected || !this.o.isActive()) return;
      const t = ev.target;
      if (t.closest && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('.modal-back'))) return;
      const s = this.selected();
      const mod = ev.ctrlKey || ev.metaKey;
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && s.length) { ev.preventDefault(); this.remove(); }
      else if (mod && ev.key.toLowerCase() === 'd' && s.length) { ev.preventDefault(); this.duplicate(); }
      else if (mod && ev.key.toLowerCase() === 'a') { ev.preventDefault(); this.select(this.els().map((e) => e.id)); }
      else if (mod && ev.key.toLowerCase() === 'c' && s.length) { D.clipboardEls = D.clone(s); }
      else if (mod && ev.key.toLowerCase() === 'x' && s.length) { D.clipboardEls = D.clone(s); this.remove(); }
      else if (mod && ev.key.toLowerCase() === 'v' && D.clipboardEls && D.clipboardEls.length) { ev.preventDefault(); this.paste(D.clipboardEls); }
      else if (mod && ev.key === ']') { ev.preventDefault(); this.zorder(1); }
      else if (mod && ev.key === '[') { ev.preventDefault(); this.zorder(-1); }
      else if (ev.key === 'Escape') this.clearSel();
      else if (ev.key === 'Enter' && s.length === 1 && (s[0].type === 'text' || s[0].type === 'shape')) { ev.preventDefault(); this.editText(s[0]); }
      else if (ev.key.startsWith('Arrow') && s.length) {
        ev.preventDefault();
        const d = ev.shiftKey ? 10 : 1;
        s.forEach((e) => { if (ev.key === 'ArrowLeft') e.x -= d; if (ev.key === 'ArrowRight') e.x += d; if (ev.key === 'ArrowUp') e.y -= d; if (ev.key === 'ArrowDown') e.y += d; const n = this.nodes.get(e.id); n.style.left = e.x + 'px'; n.style.top = e.y + 'px'; });
        this.drawSelection();
        this.o.onChange(true);
      }
    }

    add(e, { select = true } = {}) {
      const m = this.model();
      e.z = Math.max(0, ...m.elements.map((x) => x.z || 1)) + 1;
      m.elements.push(e);
      this.render();
      if (select) this.select(e.id);
      this.o.onChange();
      return e;
    }
    remove() {
      const m = this.model();
      m.elements.splice(0, m.elements.length, ...m.elements.filter((e) => !this.sel.has(e.id)));
      this.sel.clear();
      this.render();
      this.o.onSelect([]);
      this.o.onChange();
    }
    duplicate() { this.paste(D.clone(this.selected()), 20); }
    paste(list, off = 20) {
      const m = this.model();
      let z = Math.max(0, ...m.elements.map((x) => x.z || 1));
      const ids = list.map((e) => { const c = D.clone(e); c.id = D.uid(); c.x += off; c.y += off; c.z = ++z; m.elements.push(c); return c.id; });
      this.render();
      this.select(ids);
      this.o.onChange();
    }
    zorder(dir) {
      const m = this.model();
      const zs = m.elements.map((e) => e.z || 1);
      const top = Math.max(...zs), bot = Math.min(...zs);
      this.selected().forEach((e, i) => { e.z = dir > 0 ? top + 1 + i : bot - 1 - i; });
      this.render();
      this.o.onChange();
    }

    async onDropFiles(ev) {
      ev.preventDefault(); ev.stopPropagation();
      const p = this.toModel(ev);
      for (const f of ev.dataTransfer.files) {
        if (/^image\//.test(f.type)) {
          const src = await D.fileToDataUrl(f);
          const img = await D.loadImage(src);
          const m = this.model();
          let w = Math.min(img.naturalWidth, m.w * 0.5), hh = w * img.naturalHeight / img.naturalWidth;
          this.add(D.newElement('image', { src, x: Math.round(p.x - w / 2), y: Math.round(p.y - hh / 2), w: Math.round(w), h: Math.round(hh) }));
        } else {
          D.io.importPaths([window.native.pathForFile(f)]);
        }
      }
    }
  }
  D.FreeCanvas = FreeCanvas;

  // ---------------------------------------------------------------- inspector
  D.buildInspector = (panel, fc, extra = {}) => {
    panel.innerHTML = '';
    const sel = fc.selected();
    const changed = (rerender = true, commitNow = true) => {
      sel.forEach((e) => (rerender ? fc.refreshEl(e) : null));
      if (commitNow) fc.o.onChange(); else D.commitSoon();
    };
    const section = (title, ...kids) => h('div', { class: 'insp-sec' }, title ? h('div', { class: 'insp-title' }, title) : null, ...kids);
    const row = (label, ...kids) => h('div', { class: 'insp-row' }, h('label', null, label), h('div', { class: 'insp-ctl' }, ...kids));
    const num = (val, on, opts = {}) => {
      const i = h('input', { class: 'input sm', type: 'number', value: Math.round(val * 100) / 100, step: opts.step || 1, min: opts.min });
      i.addEventListener('change', () => on(+i.value));
      return i;
    };
    const sel1 = (val, options, on) => {
      const s = h('select', { class: 'input sm' }, options.map(([v, l]) => h('option', { value: v, selected: v === val ? true : null }, l)));
      s.addEventListener('change', () => on(s.value));
      return s;
    };
    const toggle = (icon, title, on, active) => D.btn(icon, title, on, { active, cls: 'sm' });

    if (!sel.length) {
      if (extra.none) extra.none(panel, section, row);
      return;
    }
    const e = sel[0];
    const multi = sel.length > 1;
    const typeName = { text: 'Text', shape: 'Shape', image: 'Image', table: 'Table', chart: 'Chart', kpi: 'KPI card' }[e.type];
    panel.append(h('div', { class: 'insp-head' }, h('span', { html: D.icon({ text: 'text', shape: 'shape', image: 'image', table: 'table', chart: 'chart', kpi: 'kpi' }[e.type], 15) }), multi ? `${sel.length} items` : typeName));

    if (!multi) {
      panel.append(section('Position',
        h('div', { class: 'insp-grid4' },
          h('span', null, 'X'), num(e.x, (v) => { e.x = v; changed(); }),
          h('span', null, 'Y'), num(e.y, (v) => { e.y = v; changed(); }),
          h('span', null, 'W'), num(e.w, (v) => { e.w = Math.max(8, v); changed(); }),
          h('span', null, 'H'), num(e.h, (v) => { e.h = Math.max(8, v); changed(); }))));
    }

    // ---- data link
    if (!multi && (e.type === 'chart' || e.type === 'table')) {
      const sh = e.link && D.sheet(e.link.sheetId);
      const srcLabel = e.link ? (sh ? `${sh.name} · ${e.link.range}` : 'Missing sheet') : e.staticData || e.staticRows ? 'Imported (static)' : 'Not linked';
      panel.append(section('Data',
        h('div', { class: `insp-link ${e.link && sh ? 'ok' : ''}` }, h('span', { html: D.icon('link', 13) }), h('span', null, srcLabel)),
        h('div', { class: 'insp-btns' },
          h('button', { class: 'btn sm', onclick: () => fc.o.onEditData(e) }, e.link ? 'Change range' : 'Link to data'),
          (e.staticData || e.staticRows) && !e.link ? h('button', { class: 'btn sm ghost', title: 'Copy this data into a new Data Sheet and link to it', onclick: () => D.links.extractStatic(e, () => { fc.refreshEl(e); fc.o.onChange(); D.buildInspector(panel, fc, extra); }) }, 'Make editable') : null,
          e.link && sh ? h('button', { class: 'btn sm ghost', onclick: () => D.app.goToRange(e.link.sheetId, e.link.range) }, 'Open source') : null)));
    }

    if (!multi && e.type === 'chart') {
      panel.append(section('Chart',
        row('Type', sel1(e.chartType || 'bar', D.charts.TYPES.map((t) => [t.id, t.label]), (v) => { e.chartType = v; changed(); })),
        row('Title', (() => { const i = h('input', { class: 'input sm', value: e.title || '', placeholder: 'Chart title' }); i.addEventListener('input', () => { e.title = i.value; fc.refreshEl(e); D.commitSoon(); }); return i; })()),
        (() => {
          const all = D.charts.allSeries(e);
          if (all.length < 2 || e.seriesIn === 'rows') return null;
          const on = new Set(e.seriesCols && e.seriesCols.length ? e.seriesCols : all.map((s) => s.col));
          return row('Plot', h('div', { class: 'series-picks' }, all.map((s) => h('label', { class: 'chk' }, (() => { const c = h('input', { type: 'checkbox' }); c.checked = on.has(s.col); c.addEventListener('change', () => { if (c.checked) on.add(s.col); else on.delete(s.col); if (!on.size) { c.checked = true; on.add(s.col); return; } e.seriesCols = on.size === all.length ? undefined : [...on]; changed(); }); return c; })(), h('span', null, s.name)))));
        })(),
        row('Series', sel1(e.seriesIn || 'cols', [['cols', 'By column'], ['rows', 'By row']], (v) => { e.seriesIn = v; changed(); })),
        row('Values', h('label', { class: 'switch' }, (() => { const c = h('input', { type: 'checkbox' }); c.checked = !!e.showValues; c.addEventListener('change', () => { e.showValues = c.checked; changed(); }); return c; })(), h('span'))),
        row('Legend', h('label', { class: 'switch' }, (() => { const c = h('input', { type: 'checkbox' }); c.checked = e.legend !== false; c.addEventListener('change', () => { e.legend = c.checked; changed(); }); return c; })(), h('span'))),
        row('Colors', h('div', { class: 'swatch-row' }, D.charts.palette(e).slice(0, 4).map((c, i) => D.colorInput(c, (v, done) => { e.colors = D.charts.palette(e).slice(); e.colors[i] = v; fc.refreshEl(e); if (done) fc.o.onChange(); })), h('button', { class: 'btn xs ghost', title: 'Use brand palette', onclick: () => { delete e.colors; changed(); D.buildInspector(panel, fc, extra); } }, 'Reset')))));
    }

    if (!multi && e.type === 'kpi') {
      const exprIn = h('input', { class: 'input sm mono', value: e.expr || '', placeholder: '=SUM(Data!B2:B13)' });
      exprIn.addEventListener('change', () => { e.expr = exprIn.value.trim(); changed(); });
      const cmpIn = h('input', { class: 'input sm mono', value: e.compareExpr || '', placeholder: 'optional, e.g. =Data!B12' });
      cmpIn.addEventListener('change', () => { e.compareExpr = cmpIn.value.trim(); changed(); });
      const lab = h('input', { class: 'input sm', value: e.label || '' });
      lab.addEventListener('input', () => { e.label = lab.value; fc.refreshEl(e); D.commitSoon(); });
      panel.append(section('KPI',
        row('Label', lab),
        row('Value', exprIn),
        row('Compare', cmpIn),
        e.compareExpr ? row('Better when', sel1(e.lowerIsBetter ? 'down' : 'up', [['up', 'Higher (green ▲)'], ['down', 'Lower (green ▼)']], (v) => { e.lowerIsBetter = v === 'down'; changed(); })) : null,
        row('Format', sel1(e.format || 'auto', [['auto', 'Auto'], ['int', '1,234'], ['num', '1,234.00'], ['cur', '$1,234.00'], ['cur0', '$1,234'], ['pct', '12.3%'], ['compact', '1.2K']], (v) => { e.format = v; changed(); })),
        h('div', { class: 'insp-hint' }, 'Use any formula. Pick a cell on a Data Sheet and use “Send to → KPI” to fill this automatically.')));
    }

    if (!multi && e.type === 'image') {
      e.style ||= {};
      panel.append(section('Image',
        row('Fit', sel1(e.fit || 'contain', [['contain', 'Fit'], ['cover', 'Fill / crop'], ['fill', 'Stretch']], (v) => { e.fit = v; changed(); })),
        row('Border', h('div', { class: 'inline' },
          sel1(String(e.style.borderWidth || 0), (() => { const o = [['0', 'None'], ['1', 'Hairline'], ['2', 'Thin'], ['4', 'Medium'], ['6', 'Bold'], ['10', 'Photo frame'], ['16', 'Wide frame']]; const cur = String(e.style.borderWidth || 0); if (!o.some(([v]) => v === cur)) o.push([cur, cur + ' px']); return o; })(), (v) => { e.style.borderWidth = +v || undefined; changed(); D.buildInspector(panel, fc, extra); }),
          D.colorInput(e.style.borderColor || '#FFFFFF', (v, done) => { e.style.borderColor = v; fc.refreshEl(e); if (done) fc.o.onChange(); }, 'Border color'))),
        row('Corners', h('div', { class: 'inline' }, num(e.style.radius || 0, (v) => { e.style.radius = Math.max(0, v) || undefined; changed(); }, { min: 0 }), h('span', { class: 'muted small' }, 'px'))),
        row('Shadow', h('label', { class: 'switch' }, (() => { const c = h('input', { type: 'checkbox' }); c.checked = !!e.style.shadow; c.addEventListener('change', () => { e.style.shadow = c.checked || undefined; changed(); }); return c; })(), h('span'))),
        row('Presets', h('div', { class: 'img-presets' }, [
          ['Plain', {}], ['Frame', { borderWidth: 2, borderColor: '#1F2937' }], ['Photo', { borderWidth: 10, borderColor: '#FFFFFF', shadow: true }],
          ['Card', { radius: 14, shadow: true }], ['Brand', { borderWidth: 4, borderColor: D.brand().primary, radius: 8 }], ['Circle', { radius: 9999 }]
        ].map(([l, p]) => h('button', { class: 'btn xs', onclick: () => { ['borderWidth', 'borderColor', 'radius', 'shadow'].forEach((k) => delete e.style[k]); Object.assign(e.style, p); if (l === 'Circle') { const m = Math.min(e.w, e.h); e.w = m; e.h = m; e.fit = 'cover'; } changed(); D.buildInspector(panel, fc, extra); } }, l)))),
        h('div', { class: 'insp-btns' }, h('button', { class: 'btn sm', onclick: () => fc.o.onImagePick(e) }, 'Replace image'))));
    }

    if (!multi && e.type === 'shape') {
      panel.append(section('Shape',
        row('Kind', sel1(e.shape || 'rect', [['rect', 'Rectangle'], ['roundRect', 'Rounded'], ['ellipse', 'Ellipse'], ['line', 'Line']], (v) => { e.shape = v; changed(); }))));
    }

    // ---- text styling
    if (sel.some((x) => ['text', 'shape', 'kpi', 'table'].includes(x.type))) {
      const st = e.style || (e.style = {});
      const apply = (fn, rer = true) => { sel.forEach((x) => { x.style = x.style || {}; fn(x.style, x); }); changed(rer); };
      const fontSel = sel1(st.fontFace || '', [['', `Brand (${D.brand().font})`], ['Inter', 'Inter'], ['Calibri', 'Calibri'], ['Arial', 'Arial'], ['Georgia', 'Georgia'], ['Segoe UI', 'Segoe UI'], ['Helvetica', 'Helvetica'], ['Times New Roman', 'Times New Roman'], ['Courier New', 'Courier New']], (v) => apply((s) => { if (v) s.fontFace = v; else delete s.fontFace; }));
      panel.append(section('Text',
        row('Font', fontSel),
        row('Size', h('div', { class: 'inline' }, num(st.fontSize || (e.type === 'kpi' ? 32 : e.type === 'table' ? 12 : 18), (v) => apply((s) => { s.fontSize = Math.max(4, v); }), { min: 4 }), D.btn('minus', 'Smaller', () => apply((s, x) => { s.fontSize = Math.max(4, (s.fontSize || 18) - 2); }), { cls: 'sm' }), D.btn('plus', 'Larger', () => apply((s) => { s.fontSize = (s.fontSize || 18) + 2; }), { cls: 'sm' }))),
        row('Style', h('div', { class: 'inline' },
          toggle('bold', 'Bold', () => apply((s) => { s.bold = !st.bold; }), st.bold),
          toggle('italic', 'Italic', () => apply((s) => { s.italic = !st.italic; }), st.italic),
          toggle('underline', 'Underline', () => apply((s) => { s.underline = !st.underline; }), st.underline),
          e.type === 'text' ? toggle('list', 'Bullets', () => apply((s) => { s.bullets = !st.bullets; }), st.bullets) : null)),
        e.type !== 'table' ? row('Align', h('div', { class: 'inline' },
          toggle('alignLeft', 'Left', () => apply((s) => { s.align = 'left'; }), (st.align || 'left') === 'left'),
          toggle('alignCenter', 'Center', () => apply((s) => { s.align = 'center'; }), st.align === 'center'),
          toggle('alignRight', 'Right', () => apply((s) => { s.align = 'right'; }), st.align === 'right'),
          h('span', { class: 'tb-gap' }),
          sel1(st.valign || (e.type === 'shape' ? 'middle' : 'top'), [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']], (v) => apply((s) => { s.valign = v; })))) : null,
        row('Color', h('div', { class: 'swatch-row' },
          D.colorInput(st.color || (e.type === 'shape' ? '#FFFFFF' : '#111827'), (v, done) => { sel.forEach((x) => { x.style.color = v; fc.refreshEl(x); }); if (done) fc.o.onChange(); }, 'Text color'),
          [D.brand().primary, D.brand().dark, '#111827', '#6B7280', '#FFFFFF'].map((c) => h('button', { class: 'sw-dot', style: { background: c }, title: c, onclick: () => apply((s) => { s.color = c; }) }))))));
    }
    if (sel.some((x) => ['text', 'shape', 'kpi'].includes(x.type)) || e.type === 'table') {
      const st = e.style || {};
      const label = e.type === 'table' ? 'Header' : 'Fill';
      const key = e.type === 'table' ? 'headerFill' : 'fill';
      panel.append(section(e.type === 'table' ? 'Table' : 'Fill',
        row(label, h('div', { class: 'swatch-row' },
          D.colorInput(st[key] || (e.type === 'shape' || e.type === 'table' ? D.brand().primary : '#FFFFFF'), (v, done) => { sel.forEach((x) => { x.style[key] = v; fc.refreshEl(x); }); if (done) fc.o.onChange(); }, label),
          [D.brand().primary, D.brand().accent, D.brand().dark, '#EEF3FF', '#F3F4F6'].map((c) => h('button', { class: 'sw-dot', style: { background: c }, onclick: () => { sel.forEach((x) => { x.style[key] = c; }); changed(); } })),
          e.type !== 'table' && e.type !== 'shape' ? h('button', { class: 'btn xs ghost', onclick: () => { sel.forEach((x) => { delete x.style.fill; }); changed(); } }, 'None') : null)),
        e.type === 'table' ? row('Max rows', num(e.maxRows || 0, (v) => { e.maxRows = v > 0 ? v : undefined; changed(); }, { min: 0 })) : null,
        e.type === 'kpi' ? row('Accent bar', h('label', { class: 'switch' }, (() => { const c = h('input', { type: 'checkbox' }); c.checked = st.accent !== false; c.addEventListener('change', () => { sel.forEach((x) => { x.style.accent = c.checked; }); changed(); }); return c; })(), h('span'))) : null));
    }

    if (sel.some((x) => x.type === 'text') && !multi) {
      panel.append(section('Live values', h('div', { class: 'insp-hint' }, 'Type ', h('code', null, '{{Sheet!B4}}'), ' or ', h('code', null, '{{SUM(Sheet!B2:B9)}}'), ' anywhere in a text box to show a value that updates with your data.'),
        h('div', { class: 'insp-btns' }, h('button', { class: 'btn sm ghost', onclick: () => D.links.pickToken((tok) => { e.text = (e.text || '') + tok; changed(); D.buildInspector(panel, fc, extra); }) }, 'Insert live value…'))));
    }

    panel.append(section('Arrange', h('div', { class: 'insp-btns' },
      D.btn('front', 'Bring to front', () => fc.zorder(1), { cls: 'sm' }),
      D.btn('back', 'Send to back', () => fc.zorder(-1), { cls: 'sm' }),
      D.btn('copy', 'Duplicate', () => fc.duplicate(), { cls: 'sm' }),
      D.btn('trash', 'Delete', () => fc.remove(), { cls: 'sm danger' }))));
    if (extra.after) extra.after(panel, section, row);
  };
})();
