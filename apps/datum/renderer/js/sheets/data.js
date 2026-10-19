// Datum - Data Sheet (spreadsheet)
(function () {
  const h = D.h;
  const F = () => D.f;
  const ROW_H = 26, COL_W = 104, RH_W = 52, HDR_H = 26, BUF = 12;
  const BORDER = '1.5px solid #1F2937';
  // a border side is `true` (thin dark line) or { w: 1|2|3, s: 'solid'|'dashed'|'dotted'|'double', c: '#hex' }
  const borderCss = (b) => {
    if (b === true || !b || typeof b !== 'object') return BORDER;
    const w = b.s === 'double' ? 3.5 : b.w === 3 ? 3 : b.w === 2 ? 2 : 1.5;
    return `${w}px ${b.s === 'dashed' || b.s === 'dotted' || b.s === 'double' ? b.s : 'solid'} ${b.c || '#1F2937'}`;
  };
  // little 3×3 cell previews for the border picker
  const BORDER_ICON = (mode) => {
    const L = { t: [[2, 2, 22, 2]], b: [[2, 22, 22, 22]], l: [[2, 2, 2, 22]], r: [[22, 2, 22, 22]], h: [[2, 12, 22, 12]], v: [[12, 2, 12, 22]] };
    const sets = { all: 'tblrhv', outer: 'tblr', inner: 'hv', innerH: 'h', innerV: 'v', t: 't', b: 'b', l: 'l', r: 'r', tb: 'tb', thickOuter: 'tblr', thickB: 'b', doubleB: 'b', none: '' };
    const on = new Set((sets[mode] || '').split(''));
    let svg = '<svg viewBox="0 0 24 24" width="22" height="22">';
    for (const k of 'tblrhv') for (const [x1, y1, x2, y2] of L[k]) svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${on.has(k) ? 'currentColor' : '#5B6B8C'}" stroke-width="${on.has(k) ? (mode.startsWith('thick') ? 3 : 1.8) : 1}" ${on.has(k) ? '' : 'stroke-dasharray="1.5 2"'} />`;
    if (mode === 'doubleB') svg += '<line x1="2" y1="19" x2="22" y2="19" stroke="currentColor" stroke-width="1.4"/>';
    return svg + '</svg>';
  };

  const emptyGrid = (r, c) => Array.from({ length: r }, () => Array(c).fill(''));

  // ------------------------------------------------ reference shifting (insert/delete rows & cols)
  function shiftRefs(target, axis, at, delta) {
    const move = (i) => (i >= at ? (delta < 0 && i < at - delta ? at : Math.max(0, i + delta)) : i);
    const gone = (i) => delta < 0 && i >= at && i < at - delta;
    remapRefs(target, axis === 'r' ? { r: move, goneR: gone } : { c: move, goneC: gone });
  }
  // Rewrite every reference to rows/columns of `target` (in all sheets, links, docs and ranges) through
  // m.r / m.c (old index -> new index); m.goneR / m.goneC say which rows/columns no longer exist.
  function remapRefs(target, m) {
    const mr = m.r || ((i) => i), mc = m.c || ((i) => i);
    const goneR = m.goneR || (() => false), goneC = m.goneC || (() => false);
    const p = D.project();
    const tName = target.name.toLowerCase();
    const fix = (src, ownerIsTarget) => src.replace(/"[^"]*"|((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(])/g, (mm, pre, d1, col, d2, row) => {
      if (mm.startsWith('"')) return mm;
      const sn = pre ? pre.slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'").toLowerCase() : null;
      if (sn ? sn !== tName : !ownerIsTarget) return mm;
      const r = mr(+row - 1), c = mc(F().colIndex(col));
      return (pre || '') + d1 + F().colName(c) + d2 + (r + 1);
    });
    for (const s of p.sheets) {
      if (s.type === 'data') s.cells.forEach((row) => row.forEach((v, i) => { if (typeof v === 'string' && v.startsWith('=')) row[i] = fix(v, s === target); }));
      const els = s.type === 'slide' ? s.slides.flatMap((x) => x.elements) : s.type === 'report' ? s.elements : [];
      els.forEach((e) => {
        if (e.link && e.link.sheetId === target.id) e.link.range = fix(e.link.range, true);
        ['text', 'label'].forEach((k) => { if (typeof e[k] === 'string') e[k] = e[k].replace(/\{\{([^}]*)\}\}/g, (_, x) => `{{${fix(x, false)}}}`); });
        ['expr', 'compareExpr'].forEach((k) => { if (e[k]) e[k] = fix(e[k], false); });
      });
      if (s.type === 'docu' && s.html) {
        s.html = s.html.replace(/data-sheet="([^"]+)" data-range="([^"]+)"/g, (mm, id, rg) => (id === target.id ? `data-sheet="${id}" data-range="${fix(rg, true)}"` : mm))
          .replace(/data-expr="([^"]*)"/g, (mm, ex) => `data-expr="${fix(ex.replace(/&#39;/g, "'"), false).replace(/'/g, '&#39;')}"`);
      }
    }
    const ns = {};
    for (const [k, v] of Object.entries(target.styles || {})) { const [r, c] = k.split(',').map(Number); if (!goneR(r) && !goneC(c)) ns[mr(r) + ',' + mc(c)] = v; }
    target.styles = ns;
    if (target.cached) { const nc = {}; for (const [k, v] of Object.entries(target.cached)) { const [r, c] = k.split(',').map(Number); if (!goneR(r) && !goneC(c)) nc[mr(r) + ',' + mc(c)] = v; } target.cached = nc; }
    const remap = (obj, f, gone) => { const o = {}; for (const [k, v] of Object.entries(obj || {})) { const i = +k; if (gone(i)) continue; o[f(i)] = v; } return o; };
    target.colWidths = remap(target.colWidths, mc, goneC);
    target.rowHeights = remap(target.rowHeights, mr, goneR);
    // ranges: merges, conditional formats, filter
    const fixRange = (rg) => fix(rg, true);
    if (target.merges) target.merges = target.merges.map(fixRange);
    if (target.cf) target.cf.forEach((rule) => { rule.range = fixRange(rule.range); });
    if (target.filter) { target.filter.range = fixRange(target.filter.range); target.filter.cols = remap(target.filter.cols, mc, goneC); }
  }

  // Decide, per formula cell, what goes into the .xlsx: a formula Excel can compute, or (null) the plain value.
  // Values are used when the formula points at another Datum sheet, a project name, an external workbook,
  // spills an array, or uses a Datum-only function - so the Excel file never opens with #REF! or #NAME?.
  function excelFormulas(sheet) {
    const out = {};
    const own = sheet.name.toLowerCase();
    const ownPrefix = new RegExp("(^|[^\\w'])(?:'" + sheet.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "''") + "'|" + sheet.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')!', 'gi');
    const datumOnly = new Set([...F().DATUM_ONLY, 'GROWTH']);
    sheet.cells.forEach((row, r) => row.forEach((raw, c) => {
      if (typeof raw !== 'string' || raw[0] !== '=') return;
      let keep = true;
      try {
        const walk = (n) => {
          if (!n || !keep) return;
          if (n.k === 'extref' || n.k === 'name') keep = false;
          else if (n.k === 'ref' && n.sheet && n.sheet.toLowerCase() !== own) keep = false;
          else if (n.k === 'fn') { if (datumOnly.has(n.name) || F().ARRAY_FNS.has(n.name) && n.name !== 'OFFSET' && n.name !== 'INDIRECT') keep = false; n.args.forEach(walk); }
          else if (n.k === 'bin' || n.k === 'span') { walk(n.l); walk(n.r); }
          else if (n.k === 'neg') walk(n.e);
        };
        walk(F().compile(raw.slice(1)));
      } catch { keep = !!(sheet.cached && (r + ',' + c) in sheet.cached); }
      const sp = F().spillInfo(sheet, r, c);
      if (sp && sp.isSource) keep = false;
      out[r + ',' + c] = keep ? raw.slice(1).replace(ownPrefix, '$1') : null;
    }));
    return out;
  }

  // ------------------------------------------------ sheet type
  const T = {
    label: 'Data Sheet',
    create(name) {
      return { id: D.uid(), type: 'data', name, cells: emptyGrid(100, 16), styles: {}, colWidths: {}, rowHeights: {}, merges: [], cf: [], filter: null, frozen: 0 };
    },
    exportPayload(sheet) {
      const hidden = [...F().hiddenRows(sheet)];
      return { values: F().sheetValues(sheet), hiddenRows: hidden, formulas: excelFormulas(sheet) };
    },
    usedRange(sheet) { return D.links.autoRange(sheet); },
    printHtml(sheet) {
      const g = F().parseRange(D.links.usedRange(sheet));
      const hidden = F().hiddenRows(sheet);
      const cfm = F().cfMap(sheet);
      let html = `<table class="print-grid"><tr><th></th>`;
      for (let c = g.c1; c <= g.c2; c++) html += `<th>${F().colName(c)}</th>`;
      html += '</tr>';
      for (let r = 0; r <= g.r2; r++) {
        if (hidden.has(r)) continue;
        html += `<tr><th>${r + 1}</th>`;
        for (let c = 0; c <= g.c2; c++) {
          const m = F().mergeAt(sheet, r, c);
          if (m && (m.r1 !== r || m.c1 !== c)) continue;
          const st = { ...((sheet.styles || {})[`${r},${c}`] || {}), ...(cfm.get(r + ',' + c) || {}) };
          const v = F().cellValue(sheet, r, c);
          const css = [st.b ? 'font-weight:700' : '', st.i ? 'font-style:italic' : '', st.fill ? `background:${st.fill}` : '', st.color ? `color:${st.color}` : '', `text-align:${st.align || (typeof v === 'number' ? 'right' : 'left')}`, st.wrap ? 'white-space:normal' : ''].filter(Boolean).join(';');
          const span = m ? ` colspan="${m.c2 - m.c1 + 1}" rowspan="${m.r2 - m.r1 + 1}"` : '';
          html += `<td${span} style="${css}">${D.esc(F().display(sheet, r, c))}</td>`;
        }
        html += '</tr>';
      }
      return html + '</table>';
    },
    mount(host, sheet) { return new DataView(host, sheet); },
    shiftRefs,
    remapRefs
  };
  D.sheetTypes.data = T;

  // presets used by the conditional-formatting menus
  const CF_STYLES = [
    { id: 'red', label: 'Light red fill, dark red text', fill: '#FFC7CE', color: '#9C0006' },
    { id: 'green', label: 'Green fill, dark green text', fill: '#C6EFCE', color: '#006100' },
    { id: 'yellow', label: 'Yellow fill, dark yellow text', fill: '#FFEB9C', color: '#9C5700' },
    { id: 'blue', label: 'Blue fill, dark blue text', fill: '#DCE8FF', color: '#1D4FD1' },
    { id: 'redtext', label: 'Red text', color: '#C00000' },
    { id: 'bold', label: 'Bold', bold: true }
  ];
  const CF_TYPES = {
    gt: { label: 'Greater than', n: 1 }, lt: { label: 'Less than', n: 1 }, gte: { label: 'Greater than or equal to', n: 1 }, lte: { label: 'Less than or equal to', n: 1 },
    between: { label: 'Between', n: 2 }, eq: { label: 'Equal to', n: 1 }, neq: { label: 'Not equal to', n: 1 }, text: { label: 'Text contains', n: 1 },
    blank: { label: 'Blank cells', n: 0 }, notblank: { label: 'Non-blank cells', n: 0 }, neg: { label: 'Negative numbers', n: 0 },
    dup: { label: 'Duplicate values', n: 0 }, unique: { label: 'Unique values', n: 0 },
    top: { label: 'Top N values', n: 1, def: 10 }, bottom: { label: 'Bottom N values', n: 1, def: 10 }, above: { label: 'Above average', n: 0 }, below: { label: 'Below average', n: 0 },
    formula: { label: 'Custom formula is true', n: 1, formula: true },
    scale2: { label: '2-color scale', n: 0, scale: true }, scale3: { label: '3-color scale', n: 0, scale: true }, bars: { label: 'Data bars', n: 0, bars: true }
  };
  const SCALES = [
    { label: 'Green - Yellow - Red', type: 'scale3', colors: ['#63BE7B', '#FFEB84', '#F8696B'] },
    { label: 'Red - Yellow - Green', type: 'scale3', colors: ['#F8696B', '#FFEB84', '#63BE7B'] },
    { label: 'White - Blue', type: 'scale2', colors: ['#FFFFFF', '#5A8AC6'] },
    { label: 'White - Green', type: 'scale2', colors: ['#FFFFFF', '#63BE7B'] },
    { label: 'White - Red', type: 'scale2', colors: ['#FFFFFF', '#F8696B'] }
  ];
  const BARS = [['Blue', '#5B8DEF'], ['Green', '#3FB37F'], ['Orange', '#F5A04A'], ['Purple', '#9B7BEA'], ['Red', '#EF6B6B']];
  const FMTS = [
    ['', 'General', '1234.5'], ['num', 'Number', '1,234.50'], ['int', 'Whole number', '1,235'], ['cur', 'Currency', '$1,234.50'], ['acct', 'Accounting', '($1,234.50)'],
    ['pct', 'Percent', '12.3%'], ['sci', 'Scientific', '1.23E+3'], ['date', 'Date', 'Oct 8, 2026'], ['text', 'Plain text', 'as typed']
  ];

  class DataView {
    constructor(host, sheet) {
      this.sheet = sheet;
      this.host = host;
      sheet.styles ||= {}; sheet.colWidths ||= {}; sheet.rowHeights ||= {}; sheet.merges ||= []; sheet.cf ||= [];
      this.sel = { r1: 0, c1: 0, r2: 0, c2: 0 };
      this.act = { r: 0, c: 0 };
      this.anchor = { r: 0, c: 0 };
      this.extra = []; // more areas added with Ctrl/Cmd+click
      this.start = -1;
      this.tdMap = new Map();
      this.ensureSize();
      this.build();
      this._key = this.onKey.bind(this);
      this._copy = this.onCopy.bind(this);
      this._paste = this.onPaste.bind(this);
      this._cut = (e) => { if (this.onCopy(e)) this.clear(); };
      document.addEventListener('keydown', this._key);
      document.addEventListener('copy', this._copy);
      document.addEventListener('paste', this._paste);
      document.addEventListener('cut', this._cut);
      this.unsub = D.on('changed', () => { if (!this.editing) this.renderBody(true); });
      if (sheet._jump) { const g = F().parseRange(sheet._jump); delete sheet._jump; if (g) { this.sel = g; this.act = { r: g.r1, c: g.c1 }; this.anchor = { ...this.act }; requestAnimationFrame(() => this.scrollTo(g.r1, g.c1)); } }
      this.paintSel();
      setTimeout(() => this.scroller.focus({ preventScroll: true }), 0);
    }
    destroy() {
      this.commitEdit();
      this.closePop();
      document.removeEventListener('keydown', this._key);
      document.removeEventListener('copy', this._copy);
      document.removeEventListener('paste', this._paste);
      document.removeEventListener('cut', this._cut);
      this.unsub();
    }
    get rows() { return this.sheet.cells.length; }
    get cols() { return this.sheet.cells[0].length; }
    colW(c) { return this.sheet.colWidths[c] || COL_W; }
    baseRowH(r) { return this.sheet.rowHeights[r] || ROW_H; }
    ensureSize(r = 0, c = 0) {
      const s = this.sheet;
      const needR = Math.max(r + 30, 100), needC = Math.max(c + 6, 16);
      let grew = false;
      if (s.cells[0].length < needC) { s.cells.forEach((row) => { while (row.length < needC) row.push(''); }); grew = true; }
      while (s.cells.length < needR) { s.cells.push(Array(s.cells[0].length).fill('')); grew = true; }
      return grew;
    }

    // ------------------------------------------------ geometry (variable row heights, filtered rows)
    computeTops() {
      this.hidden = F().hiddenRows(this.sheet);
      const n = this.rows;
      const tops = new Float64Array(n + 1);
      for (let r = 0; r < n; r++) tops[r + 1] = tops[r] + (this.hidden.has(r) ? 0 : this.baseRowH(r));
      this.tops = tops;
    }
    rowH(r) { return this.tops[r + 1] - this.tops[r]; }
    rowAt(y) { // first row whose bottom is below y
      let lo = 0, hi = this.rows - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (this.tops[mid + 1] <= y) lo = mid + 1; else hi = mid; }
      return lo;
    }
    colX(c) { let x = RH_W; for (let i = 0; i < c; i++) x += this.colW(i); return x; }

    // ------------------------------------------------ layout
    build() {
      this.host.innerHTML = '';
      this.toolbar = h('div', { class: 'sheet-toolbar' });
      this.nameBox = h('input', { class: 'name-box mono', value: 'A1', spellcheck: 'false' });
      this.fx = h('input', { class: 'fx-input mono', spellcheck: 'false', placeholder: 'Type a value or a formula like =SUM(B2:B9)' });
      const fxBtn = h('button', { class: 'fx-ic', title: 'Browse functions', onclick: () => this.functionBrowser() }, 'fx');
      this.fxBar = h('div', { class: 'formula-bar' }, this.nameBox, fxBtn, this.fx);
      this.scroller = h('div', { class: 'grid-scroller', tabindex: '0' });
      this.table = h('table', { class: 'grid' });
      this.scroller.append(this.table);
      this.host.append(this.toolbar, this.fxBar, h('div', { class: 'grid-wrap' }, this.scroller));
      this.buildToolbar();
      this.renderGrid();

      this.scroller.addEventListener('scroll', () => { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = null; this.renderBody(); this.placeEditor(); }); });
      this.scroller.addEventListener('mousedown', (e) => this.onMouseDown(e));
      this.scroller.addEventListener('dblclick', (e) => this.onDbl(e));
      this.scroller.addEventListener('contextmenu', (e) => this.onContext(e));
      this.nameBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { const g = F().parseRange(this.nameBox.value); if (g) { this.ensureSize(g.r2, g.c2); this.sel = g; this.act = { r: g.r1, c: g.c1 }; this.anchor = { ...this.act }; this.renderGrid(); this.scrollTo(g.r1, g.c1); this.paintSel(); this.scroller.focus(); } }
        if (e.key === 'Escape') { this.paintSel(); this.scroller.focus(); }
      });
      this.fx.addEventListener('focus', () => { this.fxEditing = true; });
      this.fx.addEventListener('input', () => { if (this.editor) this.editor.value = this.fx.value; });
      this.fx.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.setCell(this.act.r, this.act.c, this.fx.value); this.fx.blur(); this.move(1, 0); this.scroller.focus(); }
        if (e.key === 'Escape') { this.fx.value = this.raw(this.act.r, this.act.c); this.fx.blur(); this.scroller.focus(); }
      });
      this.fx.addEventListener('blur', () => { this.fxEditing = false; });
    }

    effFmt(r, c) {
      const st = this.styleAt(r, c);
      const fmt = F().styleFmt(this.sheet, r, c);
      const def = F().FMT_DEFAULTS[fmt] || [null, null];
      let dec = st.dec != null ? st.dec : def[0];
      if (dec == null) { const v = F().cellValue(this.sheet, r, c); const t = typeof v === 'number' ? F().format(v) : ''; dec = t.includes('.') ? t.split('.')[1].replace(/\D/g, '').length : 0; }
      let comma = st.comma != null ? st.comma : def[1];
      if (comma == null) { const v = F().cellValue(this.sheet, r, c); comma = typeof v === 'number' && Math.abs(v) >= 10000; }
      return { fmt, dec, comma };
    }

    buildToolbar() {
      const tb = this.toolbar;
      tb.innerHTML = '';
      const st = () => this.styleAt(this.act.r, this.act.c);
      const menuBtn = (icon, title, items, opts = {}) => { const b = D.btn(icon, title, () => D.menu(b, typeof items === 'function' ? items() : items), { caret: true, ...opts }); return b; };
      const toggle = (key) => () => { const v = !st()[key]; this.applyStyle((s) => { s[key] = v; }); };
      const fmtBtn = menuBtn(null, 'Number format', () => FMTS.map(([v, l, ex]) => ({ label: l, kbd: ex, checked: (st().fmt || '') === v, onClick: () => this.applyStyle((s) => { if (v) s.fmt = v; else delete s.fmt; delete s.dec; }) })), { label: '123' });
      const decBy = (d) => () => { const e = this.effFmt(this.act.r, this.act.c); const nd = D.clamp(e.dec + d, 0, 10); this.applyStyle((s) => { s.dec = nd; if (!s.fmt && d > 0 && e.fmt == null) s.fmt = 'num'; if (s.fmt === 'int') s.fmt = 'num'; }); };
      const comma = () => { const e = this.effFmt(this.act.r, this.act.c); this.applyStyle((s) => { if (!s.fmt && !e.fmt) { s.fmt = 'num'; s.comma = true; } else s.comma = !e.comma; }); };
      const bordersBtn = D.btn('border', 'Borders - pick where, line style and color', () => this.borderPicker(bordersBtn), { caret: true });
      const mergeBtn = menuBtn('layers', 'Merge cells', () => [
        { label: 'Merge & center', onClick: () => this.mergeCells('center') },
        { label: 'Merge cells', onClick: () => this.mergeCells('all') },
        { label: 'Merge across (each row)', onClick: () => this.mergeCells('across') },
        { sep: true },
        { label: 'Unmerge', disabled: !this.mergesIn(this.sel).length, onClick: () => this.unmerge() }
      ]);
      const sumBtn = menuBtn('sigma', 'AutoSum and quick functions (Alt+=)', ['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN', 'MEDIAN'].map((f) => ({ label: f[0] + f.slice(1).toLowerCase(), kbd: f === 'SUM' ? 'Alt+=' : '', onClick: () => this.autoSum(f) })).concat([{ sep: true }, { label: 'More functions…', icon: 'search', onClick: () => this.functionBrowser() }]));
      const sortBtn = menuBtn('sortAsc', 'Sort', [
        { label: 'Sort A → Z / smallest first', icon: 'sortAsc', onClick: () => this.quickSort(1) },
        { label: 'Sort Z → A / largest first', icon: 'sortDesc', onClick: () => this.quickSort(-1) },
        { sep: true },
        { label: 'Custom sort…', icon: 'rows', onClick: () => this.sortDialog() },
        { sep: true },
        { label: 'Find duplicates…', icon: 'copy', onClick: () => D.dupes.open(this.sheet, this.sel.r2 > this.sel.r1 ? this.selRange() : null) }
      ]);
      const filterBtn = D.btn('filter', this.sheet.filter ? 'Remove filter (Ctrl+Shift+L)' : 'Filter the table (Ctrl+Shift+L)', () => this.toggleFilter(), { active: !!this.sheet.filter, label: 'Filter' });
      const cfBtn = menuBtn('palette', 'Conditional formatting - highlight, data bars, color scales', () => this.cfMenu());
      const freezeBtn = menuBtn('freeze', 'Freeze rows', () => [
        { label: 'No frozen rows', checked: !this.sheet.frozen, onClick: () => this.setFrozen(0) },
        { label: 'Top row', checked: this.sheet.frozen === 1, onClick: () => this.setFrozen(1) },
        { label: 'Top 2 rows', checked: this.sheet.frozen === 2, onClick: () => this.setFrozen(2) },
        { label: `Up to row ${this.act.r + 1}`, disabled: this.act.r < 1, onClick: () => this.setFrozen(this.act.r + 1) }
      ], { active: !!this.sheet.frozen });
      tb.append(
        D.btn('undo', 'Undo (Ctrl+Z)', () => D.undo()), D.btn('redo', 'Redo (Ctrl+Y)', () => D.redo()), D.sep(),
        D.btn('bold', 'Bold (Ctrl+B)', toggle('b')),
        D.btn('italic', 'Italic (Ctrl+I)', toggle('i')),
        D.btn('underline', 'Underline (Ctrl+U)', toggle('u')),
        D.btn('strike', 'Strikethrough', toggle('s')),
        D.sep(),
        D.btn('alignLeft', 'Align left', () => this.applyStyle((s) => { s.align = 'left'; })),
        D.btn('alignCenter', 'Align center', () => this.applyStyle((s) => { s.align = 'center'; })),
        D.btn('alignRight', 'Align right', () => this.applyStyle((s) => { s.align = 'right'; })),
        D.btn('wrap', 'Wrap text', toggle('wrap'), { active: !!st().wrap }),
        mergeBtn, bordersBtn,
        h('span', { class: 'tb-label' }, 'Fill'), D.colorInput('#FFFFFF', (v, done) => { if (done) this.applyStyle((s) => { if (v.toUpperCase() === '#FFFFFF') delete s.fill; else s.fill = v; }); }, 'Cell fill'),
        h('span', { class: 'tb-label' }, 'Text'), D.colorInput('#111827', (v, done) => { if (done) this.applyStyle((s) => { s.color = v; }); }, 'Text color'),
        D.sep(),
        fmtBtn,
        D.btn(null, 'Currency', () => this.applyStyle((s) => { s.fmt = 'cur'; delete s.dec; }), { label: '$' }),
        D.btn(null, 'Percent', () => this.applyStyle((s) => { s.fmt = 'pct'; delete s.dec; }), { label: '%' }),
        D.btn(null, 'Thousands separator on/off', comma, { label: ',' }),
        D.btn('decLess', 'Fewer decimal places', decBy(-1)),
        D.btn('decMore', 'More decimal places', decBy(1)),
        D.sep(),
        sumBtn, sortBtn, filterBtn, D.btn('copy', 'Find duplicate records (same ID, email, order number…)', () => D.dupes.open(this.sheet, this.sel.r2 > this.sel.r1 ? this.selRange() : null), { label: 'Duplicates' }), cfBtn, freezeBtn,
        menuBtn('rows', 'Rows & columns', () => this.structureItems()),
        h('div', { class: 'tb-spacer' }),
        this.sheet.dataset ? D.btn('layers', 'This sheet combines several files - see the files or refresh', () => D.dataset.info(this.sheet), { label: `${new Set((this.sheet.dataset.files || []).map((f) => f.path)).size} files` }) : null,
        this.sheet.dataset ? D.btn('refresh', 'Re-read the files now. Datum also picks up new and changed files on its own', () => D.dataset.refresh(this.sheet), { label: 'Refresh' }) : null,
        (() => { const b = D.btn('send', 'Send the selected range to a slide, report or document - it stays linked', () => D.links.sendTo(b, this.sheet.id, this.selRange(true)), { label: 'Send to', caret: true, cls: 'accent' }); return b; })(),
        D.btn('chart', 'Chart the selection on a Report Sheet', () => this.quickChart(), { label: 'Chart' }),
        D.btn('sparkles', 'Build a report from this table', () => D.sheetTypes.report.quickDashboard(this.sheet, this.selRange(true)), { label: 'Report' }),
        D.btn('grid', 'Build an interactive dashboard (filters, date range) from this sheet', () => D.sheetTypes.dash.createFor([this.sheet.id]), { label: 'Dashboard' })
      );
    }
    setFrozen(n) { this.sheet.frozen = n; D.commit({ data: false }); this.renderGrid(); this.buildToolbar(); }

    structureItems() {
      const { r1, r2, c1, c2 } = this.sel;
      const nr = r2 - r1 + 1, nc = c2 - c1 + 1;
      return [
        { label: `Insert ${nr > 1 ? nr + ' rows' : 'row'} above`, icon: 'arrowUp', onClick: () => this.insertRows(r1, nr) },
        { label: `Insert ${nr > 1 ? nr + ' rows' : 'row'} below`, icon: 'arrowDown', onClick: () => this.insertRows(r2 + 1, nr) },
        { label: `Insert ${nc > 1 ? nc + ' columns' : 'column'} left`, icon: 'cols', onClick: () => this.insertCols(c1, nc) },
        { label: `Insert ${nc > 1 ? nc + ' columns' : 'column'} right`, icon: 'cols', onClick: () => this.insertCols(c2 + 1, nc) },
        { sep: true },
        { label: 'Row height…', icon: 'rows', onClick: () => this.promptRowHeight() },
        { label: 'Auto-fit row height', onClick: () => this.autoFitRows(r1, r2) },
        { label: 'Column width…', icon: 'cols', onClick: () => this.promptColWidth() },
        { label: 'Auto-fit column width', onClick: () => { for (let c = c1; c <= c2; c++) this.autoFitCol(c, false); D.commit({ data: false }); this.renderGrid(); } },
        { sep: true },
        { label: `Delete ${nr > 1 ? nr + ' rows' : 'row'}`, icon: 'trash', danger: true, onClick: () => this.deleteRows(r1, nr) },
        { label: `Delete ${nc > 1 ? nc + ' columns' : 'column'}`, icon: 'trash', danger: true, onClick: () => this.deleteCols(c1, nc) }
      ];
    }

    renderGrid() {
      const t = this.table;
      t.innerHTML = '';
      const cg = h('colgroup', null, h('col', { style: { width: RH_W + 'px' } }));
      let total = RH_W;
      for (let c = 0; c < this.cols; c++) { cg.append(h('col', { style: { width: this.colW(c) + 'px' } })); total += this.colW(c); }
      t.style.width = total + 'px';
      const thead = h('thead');
      const hr = h('tr', null, h('th', { class: 'corner', title: 'Select all' }));
      for (let c = 0; c < this.cols; c++) hr.append(h('th', { class: 'ch', dataset: { c } }, F().colName(c), h('div', { class: 'col-resizer', dataset: { c }, title: 'Drag to resize · double-click to fit' })));
      thead.append(hr);
      this.tbody = h('tbody');
      t.append(cg, thead, this.tbody);
      this.start = -1;
      this.renderBody(true);
    }

    linkedSet() {
      if (this._linkedVer === D.dataVersion && this._linked) return this._linked;
      const set = new Set();
      const p = D.project();
      const add = (rg) => { const g = F().parseRange(rg); if (!g) return; for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 2000); r++) for (let c = g.c1; c <= g.c2; c++) set.add(r + ',' + c); };
      for (const s of p.sheets) {
        const els = s.type === 'slide' ? s.slides.flatMap((x) => x.elements) : s.type === 'report' ? s.elements : [];
        els.forEach((e) => { if (e.link && e.link.sheetId === this.sheet.id) add(e.link.range); });
        if (s.type === 'docu' && s.html) s.html.replace(new RegExp(`data-sheet="${this.sheet.id}" data-range="([^"]+)"`, 'g'), (_, rg) => add(rg));
      }
      this._linked = set; this._linkedVer = D.dataVersion;
      return set;
    }

    cellTd(r, c, ctx) {
      const s = this.sheet;
      const m = F().mergeAt(s, r, c);
      if (m && (m.r1 !== r || m.c1 !== c)) return null;
      const td = document.createElement('td');
      td.className = 'c';
      td.dataset.r = r; td.dataset.c = c;
      if (m) {
        td.colSpan = m.c2 - m.c1 + 1;
        let n = 0; for (let rr = m.r1; rr <= m.r2; rr++) if (!this.hidden.has(rr)) n++;
        td.rowSpan = Math.max(1, n);
        td.classList.add('merged');
      }
      const raw = s.cells[r][c];
      const sty = s.styles[r + ',' + c] || {};
      const cf = ctx.cfm.get(r + ',' + c);
      let text = '';
      if (raw !== '') {
        const v = F().cellValue(s, r, c);
        text = F().format(v, F().styleFmt(s, r, c), sty);
        if (typeof v === 'number' && sty.fmt !== 'text') td.classList.add('n');
        if (F().isErr(v)) td.classList.add('err');
        if (raw[0] === '=') td.classList.add('f');
      }
      if (sty.wrap) { td.classList.add('wrap'); const d = document.createElement('div'); d.className = 'cw'; d.style.maxHeight = (m ? this.tops[m.r2 + 1] - this.tops[m.r1] : this.rowH(r)) - 4 + 'px'; d.textContent = text; td.append(d); }
      else td.textContent = text;
      if (sty.b || (cf && cf.b)) td.style.fontWeight = '700';
      if (sty.i) td.style.fontStyle = 'italic';
      if (sty.u || sty.s) td.style.textDecoration = [sty.u ? 'underline' : '', sty.s ? 'line-through' : ''].join(' ').trim();
      const fill = (cf && cf.fill) || sty.fill;
      if (fill) td.style.backgroundColor = fill;
      if (cf && cf.bar != null) td.style.backgroundImage = `linear-gradient(90deg, ${cf.barColor}cc 0, ${cf.barColor}66 ${Math.round(cf.bar * 100)}%, transparent ${Math.round(cf.bar * 100)}%)`;
      if ((cf && cf.color) || sty.color) td.style.color = (cf && cf.color) || sty.color;
      if (sty.align) td.style.textAlign = sty.align;
      if (sty.valign) td.style.verticalAlign = sty.valign;
      if (sty.bd) {
        if (sty.bd.t) td.style.borderTop = borderCss(sty.bd.t);
        if (sty.bd.b) td.style.borderBottom = borderCss(sty.bd.b);
        if (sty.bd.l) td.style.borderLeft = borderCss(sty.bd.l);
        if (sty.bd.r) td.style.borderRight = borderCss(sty.bd.r);
      }
      if (ctx.linked.has(r + ',' + c)) td.classList.add('lk');
      const sp = raw === '' || raw[0] === '=' ? F().spillInfo(s, r, c) : null;
      if (sp) { td.classList.add(sp.isSource ? 'spill-src' : 'spill'); if (!sp.isSource) td.title = 'Spilled from ' + F().addr(...sp.src.split(',').map(Number)); }
      if (raw[0] === '=' && F().usesFallback(s, r, c)) { td.classList.add('xlcached'); td.title = 'Datum can’t calculate this formula, so it shows the value Excel saved. Edit the cell to recalculate.'; }
      if (ctx.fg && r === ctx.fg.r1 && c >= ctx.fg.c1 && c <= ctx.fg.c2) {
        td.classList.add('fhead');
        const on = this.sheet.filter.cols && this.sheet.filter.cols[c];
        td.append(h('span', { class: `fbtn ${on ? 'on' : ''}`, dataset: { fc: c }, title: on ? 'Filtered - click to change' : 'Filter / sort this column', html: D.icon(on ? 'filter' : 'down', 11) }));
      }
      this.tdMap.set(r + ',' + c, td);
      return td;
    }

    renderBody(force = false) {
      const s = this.sheet;
      if (force || !this.tops || this.tops.length !== this.rows + 1) this.computeTops();
      const fr = Math.min(s.frozen || 0, this.rows);
      const y0 = Math.max(0, this.scroller.scrollTop - BUF * ROW_H);
      const y1 = this.scroller.scrollTop + (this.scroller.clientHeight || 800) + BUF * ROW_H;
      let st = Math.max(fr, this.rowAt(y0));
      let end = Math.min(this.rows, this.rowAt(y1) + 1);
      for (const g of F().merges(s)) if (g.r2 >= st && g.r1 < end) { st = Math.min(st, Math.max(fr, g.r1)); end = Math.max(end, Math.min(this.rows, g.r2 + 1)); }
      if (!force && st === this.start && end === this.end) return;
      this.start = st; this.end = end;
      const ctx = { linked: this.linkedSet(), cfm: F().cfMap(s), fg: s.filter ? F().parseRange(s.filter.range) : null };
      this.tdMap = new Map();
      const frag = document.createDocumentFragment();
      const rowEl = (r, frozen) => {
        const tr = h('tr', { class: frozen ? 'frozen' : null });
        tr.style.height = this.rowH(r) + 'px';
        if (frozen) tr.style.setProperty('--top', HDR_H + this.tops[r] + 'px');
        tr.append(h('th', { class: 'rh', dataset: { r } }, r + 1, h('div', { class: 'row-resizer', dataset: { r }, title: 'Drag to resize · double-click to fit' })));
        for (let c = 0; c < this.cols; c++) { const td = this.cellTd(r, c, ctx); if (td) tr.append(td); }
        return tr;
      };
      for (let r = 0; r < fr; r++) if (!this.hidden.has(r)) frag.append(rowEl(r, true));
      frag.append(h('tr', { class: 'spacer', style: { height: (this.tops[st] - this.tops[fr]) + 'px' } }));
      for (let r = st; r < end; r++) if (!this.hidden.has(r)) frag.append(rowEl(r, false));
      frag.append(h('tr', { class: 'spacer', style: { height: (this.tops[this.rows] - this.tops[end]) + 'px' } }));
      this.tbody.innerHTML = '';
      this.tbody.append(frag);
      this.paintSel(false);
    }

    paintSel(updateBars = true) {
      const areas = this.areas();
      this.tbody.querySelectorAll('td.sel').forEach((td) => td.classList.remove('sel', 'act', 'sel-t', 'sel-b', 'sel-l', 'sel-r', 'sel-x'));
      for (const th of this.tbody.querySelectorAll('th.rh')) { const r = +th.dataset.r; th.classList.toggle('hl', areas.some((a) => r >= a.r1 && r <= a.r2)); }
      for (const [k, td] of this.tdMap) {
        const i = k.indexOf(',');
        const r = +k.slice(0, i), c = +k.slice(i + 1);
        let hit = false;
        const m = td.classList.contains('merged') ? F().mergeAt(this.sheet, r, c) : null;
        const rb = m ? m.r2 : r, cb = m ? m.c2 : c;
        for (const a of areas) {
          if (r < a.r1 || r > a.r2 || c < a.c1 || c > a.c2) continue;
          hit = true;
          if (r === a.r1) td.classList.add('sel-t');
          if (rb >= a.r2) td.classList.add('sel-b');
          if (c === a.c1) td.classList.add('sel-l');
          if (cb >= a.c2) td.classList.add('sel-r');
          if (a !== this.sel) td.classList.add('sel-x');
        }
        if (!hit) continue;
        td.classList.add('sel');
        if (r === this.act.r && c === this.act.c) td.classList.add('act');
      }
      // fill handle on the bottom-right corner of the selection (drag to fill, double-click to fill down)
      this.tbody.querySelectorAll('.fill-handle').forEach((x) => x.remove());
      this.tbody.querySelectorAll('td.fill-anchor').forEach((x) => x.classList.remove('fill-anchor'));
      if (!this.extra.length && !this.editor) {
        const td = this.tdMap.get(this.sel.r2 + ',' + this.sel.c2) || (() => { const m = F().mergeAt(this.sheet, this.sel.r2, this.sel.c2); return m ? this.tdMap.get(m.r1 + ',' + m.c1) : null; })();
        if (td) { td.classList.add('fill-anchor'); td.append(h('div', { class: 'fill-handle', title: 'Drag to fill or continue a series · double-click to fill down' })); }
      }
      this.tbody.querySelectorAll('td.fill-prev').forEach((td) => td.classList.remove('fill-prev', 'fp-t', 'fp-b', 'fp-l', 'fp-r'));
      const fp = this._fillPrev;
      if (fp) for (const [k, td] of this.tdMap) {
        const i = k.indexOf(','); const r = +k.slice(0, i), c = +k.slice(i + 1);
        if (r < fp.r1 || r > fp.r2 || c < fp.c1 || c > fp.c2) continue;
        td.classList.add('fill-prev');
        if (r === fp.r1) td.classList.add('fp-t'); if (r === fp.r2) td.classList.add('fp-b'); if (c === fp.c1) td.classList.add('fp-l'); if (c === fp.c2) td.classList.add('fp-r');
      }
      const { c1, c2 } = this.sel;
      this.table.querySelectorAll('thead th.ch').forEach((th) => { const c = +th.dataset.c; th.classList.toggle('hl', areas.some((a) => c >= a.c1 && c <= a.c2)); });
      if (updateBars) {
        this.nameBox.value = this.selRange();
        if (!this.fxEditing) this.fx.value = this.raw(this.act.r, this.act.c);
        this.updateStatus();
        const w = this.toolbar.querySelector('[title="Wrap text"]');
        if (w) w.classList.toggle('active', !!this.styleAt(this.act.r, this.act.c).wrap);
      }
    }
    updateStatus() {
      let sum = 0, n = 0, cnt = 0; const ns = [];
      this.eachCell((r, c) => {
        if (this.hidden && this.hidden.has(r)) return;
        const v = F().cellValue(this.sheet, r, c);
        if (v !== '' && v != null) cnt++;
        if (typeof v === 'number') { sum += v; n++; ns.push(v); }
      }, 100000);
      this._statNums = ns.length ? ns : [0];
      const parts = [];
      const fs = (x) => F().format(Math.round(x * 100) / 100, null, { comma: true });
      if (this.extra.length) parts.push(`<b>${this.extra.length + 1}</b> areas`);
      if (n > 1 || (n && cnt > 1)) { const ns = this._statNums; parts.push(`Sum <b>${fs(sum)}</b>`, `Avg <b>${fs(sum / n)}</b>`, `Min-Max <b>${fs(Math.min(...ns))} - ${fs(Math.max(...ns))}</b>`); }
      if (cnt > 1) parts.push(`Count <b>${cnt}</b>`);
      if (this.sheet.filter) {
        const g = F().parseRange(this.sheet.filter.range);
        const total = g ? g.r2 - g.r1 : 0;
        parts.push(`<span class="st-link">${D.icon('filter', 12)} Showing ${total - this.hidden.size} of ${total} rows</span>`);
      }
      const uses = F().usages(this.sheet.id);
      if (uses.length) parts.push(`<span class="st-link">${D.icon('link', 12)} Linked into ${uses.length} place${uses.length > 1 ? 's' : ''}</span>`);
      D.app.setStatus(parts.join('<span class="st-sep"></span>'));
    }
    selNums() {
      const { r1, r2, c1, c2 } = this.sel; const out = [];
      for (let r = r1; r <= Math.min(r2, r1 + 5000); r++) { if (this.hidden.has(r)) continue; for (let c = c1; c <= c2; c++) { const v = F().cellValue(this.sheet, r, c); if (typeof v === 'number') out.push(v); } }
      return out.length ? out : [0];
    }
    raw(r, c) { return (this.sheet.cells[r] && this.sheet.cells[r][c]) ?? ''; }
    selRange(expandSingle = false) {
      if (this.extra.length) return F().areasStr(this.areas());
      if (expandSingle && this.sel.r1 === this.sel.r2 && this.sel.c1 === this.sel.c2) return this.currentRegion(this.act.r, this.act.c);
      const m = F().mergeAt(this.sheet, this.sel.r1, this.sel.c1);
      if (expandSingle && m && m.r1 === this.sel.r1 && m.c1 === this.sel.c1 && m.r2 === this.sel.r2 && m.c2 === this.sel.c2) return this.currentRegion(this.act.r, this.act.c);
      return F().rangeStr(this.sel);
    }
    currentRegion(r, c) {
      const s = this.sheet;
      const filled = (rr, cc) => rr >= 0 && cc >= 0 && rr < this.rows && cc < this.cols && s.cells[rr][cc] !== '';
      if (!filled(r, c)) return D.links.autoRange(s);
      return D.links.region(s, r, c);
    }
    styleAt(r, c) { return this.sheet.styles[r + ',' + c] || {}; }
    areas() { return [...this.extra, this.sel]; }
    eachCell(fn, limit = 200000) {
      const seen = new Set(); let n = 0;
      for (const a of this.areas()) for (let r = a.r1; r <= a.r2; r++) for (let c = a.c1; c <= a.c2; c++) { const k = r + ',' + c; if (seen.has(k)) continue; seen.add(k); if (++n > limit) return false; fn(r, c, a); }
      return true;
    }
    mergesIn(g) { return F().merges(this.sheet).filter((m) => m.r1 <= g.r2 && m.r2 >= g.r1 && m.c1 <= g.c2 && m.c2 >= g.c1); }
    expandForMerges(g) {
      let grew = true;
      while (grew) {
        grew = false;
        for (const m of this.mergesIn(g)) {
          if (m.r1 < g.r1) { g.r1 = m.r1; grew = true; }
          if (m.r2 > g.r2) { g.r2 = m.r2; grew = true; }
          if (m.c1 < g.c1) { g.c1 = m.c1; grew = true; }
          if (m.c2 > g.c2) { g.c2 = m.c2; grew = true; }
        }
      }
      return g;
    }

    scrollTo(r, c) {
      const sc = this.scroller;
      const frH = this.tops[Math.min(this.sheet.frozen || 0, this.rows)];
      const y = this.tops[r], hgt = this.rowH(r) || ROW_H;
      if (y < sc.scrollTop + frH) sc.scrollTop = Math.max(0, y - frH);
      else if (HDR_H + y + hgt > sc.scrollTop + sc.clientHeight) sc.scrollTop = HDR_H + y + hgt - sc.clientHeight + 4;
      const x = this.colX(c), w = this.colW(c);
      if (x - RH_W < sc.scrollLeft) sc.scrollLeft = x - RH_W;
      else if (x + w > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = x + w - sc.clientWidth + 4;
      this.renderBody();
    }

    // ------------------------------------------------ mouse
    onMouseDown(e) {
      if (e.button === 0 && e.target.classList.contains('fill-handle')) return this.startFill(e);
      const fb = e.target.closest('.fbtn');
      if (fb) { e.preventDefault(); e.stopPropagation(); return this.filterPopover(+fb.dataset.fc, fb); }
      if (e.button === 2) {
        const td = e.target.closest('td.c');
        if (td) { const r = +td.dataset.r, c = +td.dataset.c; if (!F().inAreas(this.areas(), r, c)) this.setActive(r, c); }
        return;
      }
      if (e.target.classList.contains('col-resizer')) return this.startColResize(e, +e.target.dataset.c);
      if (e.target.classList.contains('row-resizer')) return this.startRowResize(e, +e.target.dataset.r);
      const td = e.target.closest('td.c');
      const ch = e.target.closest('th.ch');
      const rh = e.target.closest('th.rh');
      if (e.target.closest('th.corner')) { this.extra = []; this.sel = { r1: 0, c1: 0, r2: this.rows - 1, c2: this.cols - 1 }; this.paintSel(); return; }
      if (this.editor && td && this.editor.value.startsWith('=') && this.refInsertable()) { e.preventDefault(); return this.dragRefInsert(+td.dataset.r, +td.dataset.c); }
      this.commitEdit();
      if (td) {
        e.preventDefault();
        this.scroller.focus({ preventScroll: true });
        const r = +td.dataset.r, c = +td.dataset.c;
        const add = (e.ctrlKey || e.metaKey) && !e.shiftKey;
        if (add) { this.extra.push({ ...this.sel }); this.setActive(r, c, true); }
        else if (e.shiftKey) this.extendTo(r, c);
        else { this.extra = []; this.setActive(r, c); }
        this.dragSelect((rr, cc) => this.extendTo(rr, cc));
      } else if (ch) {
        const c = +ch.dataset.c;
        if (e.ctrlKey || e.metaKey) this.extra.push({ ...this.sel }); else if (!e.shiftKey) this.extra = [];
        if (e.shiftKey) this.sel = { r1: 0, r2: this.rows - 1, c1: Math.min(this.anchor.c, c), c2: Math.max(this.anchor.c, c) };
        else { this.anchor = { r: 0, c }; this.act = { r: 0, c }; this.sel = { r1: 0, r2: this.rows - 1, c1: c, c2: c }; }
        this.paintSel();
      } else if (rh) {
        const r = +rh.dataset.r;
        if (e.ctrlKey || e.metaKey) this.extra.push({ ...this.sel }); else if (!e.shiftKey) this.extra = [];
        if (e.shiftKey) this.sel = { c1: 0, c2: this.cols - 1, r1: Math.min(this.anchor.r, r), r2: Math.max(this.anchor.r, r) };
        else { this.anchor = { r, c: 0 }; this.act = { r, c: 0 }; this.sel = { r1: r, r2: r, c1: 0, c2: this.cols - 1 }; }
        this.paintSel();
      }
    }
    // Drag over cells; scrolls the sheet when the pointer nears or leaves an edge so a selection can keep growing.
    dragSelect(onCell, onEnd) {
      const sc = this.scroller;
      let last = null, raf = null, done = false;
      const cellAt = (x, y) => {
        const rect = sc.getBoundingClientRect();
        const frH = this.tops[Math.min(this.sheet.frozen || 0, this.rows)];
        const cx = D.clamp(x, rect.left + RH_W + 2, rect.right - 14);
        const cy = D.clamp(y, rect.top + HDR_H + frH + 2, rect.bottom - 14);
        const el = document.elementFromPoint(cx, cy);
        const t2 = el && el.closest && el.closest('td.c');
        if (t2 && sc.contains(t2)) onCell(+t2.dataset.r, +t2.dataset.c);
      };
      const tick = () => {
        raf = null;
        if (done || !last) return;
        const rect = sc.getBoundingClientRect();
        const edge = 28;
        const speed = (d) => Math.sign(d) * Math.min(60, Math.ceil(Math.abs(d) / 3) + 4);
        let dx = 0, dy = 0;
        if (last.y > rect.bottom - edge) dy = speed(last.y - (rect.bottom - edge));
        else if (last.y < rect.top + HDR_H + edge) dy = speed(last.y - (rect.top + HDR_H + edge));
        if (last.x > rect.right - edge) dx = speed(last.x - (rect.right - edge));
        else if (last.x < rect.left + RH_W + edge) dx = speed(last.x - (rect.left + RH_W + edge));
        if (dy > 0 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4) {
          const r = this.rowAt(sc.scrollTop + sc.clientHeight);
          if (this.ensureSize(r + 10, 0)) { this.renderGrid(); }
        }
        if (dx > 0 && sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 4) { if (this.ensureSize(0, this.cols)) this.renderGrid(); }
        if (dx || dy) {
          sc.scrollTop += dy; sc.scrollLeft += dx;
          this.renderBody();
          cellAt(last.x, last.y);
          raf = requestAnimationFrame(tick);
        }
      };
      const mv = (e2) => {
        last = { x: e2.clientX, y: e2.clientY };
        cellAt(last.x, last.y);
        if (!raf) raf = requestAnimationFrame(tick);
      };
      const up = () => { done = true; window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); if (raf) cancelAnimationFrame(raf); onEnd && onEnd(); };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    }
    // ------------------------------------------------ fill handle
    startFill(e) {
      e.preventDefault(); e.stopPropagation();
      this.commitEdit();
      const base = { ...this.sel };
      let tgt = null;
      this.dragSelect((r, c) => {
        const down = r - base.r2, up = base.r1 - r, right = c - base.c2, left = base.c1 - c;
        const vert = Math.max(down, up), hor = Math.max(right, left);
        if (vert <= 0 && hor <= 0) tgt = null;
        else if (vert >= hor) tgt = down > 0 ? { r1: base.r1, r2: r, c1: base.c1, c2: base.c2, dir: 'down' } : { r1: r, r2: base.r2, c1: base.c1, c2: base.c2, dir: 'up' };
        else tgt = right > 0 ? { r1: base.r1, r2: base.r2, c1: base.c1, c2: c, dir: 'right' } : { r1: base.r1, r2: base.r2, c1: c, c2: base.c2, dir: 'left' };
        this._fillPrev = tgt;
        this.paintSel(false);
      }, () => { this._fillPrev = null; if (tgt) this.fillSeries(base, tgt, { copy: e.altKey }); else this.paintSel(false); });
    }
    // double-click the handle: fill down as far as the column beside it goes (like Excel)
    fillToEnd() {
      const b = { ...this.sel };
      const filled = (r, c) => c >= 0 && c < this.cols && this.raw(r, c) !== '';
      const side = [b.c1 - 1, b.c2 + 1].find((c) => filled(b.r2 + 1, c));
      if (side == null) return;
      let last = b.r2;
      while (last + 1 < this.rows && filled(last + 1, side)) last++;
      if (last > b.r2) this.fillSeries(b, { r1: b.r1, r2: last, c1: b.c1, c2: b.c2, dir: 'down' });
    }
    fillSeries(base, tgt, opt = {}) {
      const s = this.sheet;
      this.ensureSize(tgt.r2, tgt.c2);
      const vertical = tgt.dir === 'down' || tgt.dir === 'up';
      const n = vertical ? base.r2 - base.r1 + 1 : base.c2 - base.c1 + 1;
      const lines = vertical ? [base.c1, base.c2] : [base.r1, base.r2];
      for (let L = lines[0]; L <= lines[1]; L++) {
        const at = (i) => (vertical ? [base.r1 + i, L] : [L, base.c1 + i]);
        const src = Array.from({ length: n }, (_, i) => this.raw(...at(i)));
        const next = D.fill.series(src, opt);
        const from = vertical ? (tgt.dir === 'down' ? base.r2 + 1 : tgt.r1) : (tgt.dir === 'right' ? base.c2 + 1 : tgt.c1);
        const to = vertical ? (tgt.dir === 'down' ? tgt.r2 : base.r1 - 1) : (tgt.dir === 'right' ? tgt.c2 : base.c1 - 1);
        for (let p = from; p <= to; p++) {
          const k = p - (vertical ? base.r1 : base.c1); // position relative to the first source cell (negative going up/left)
          const j = ((k % n) + n) % n;
          const [sr, sc] = at(j);
          const [r, c] = vertical ? [p, L] : [L, p];
          const raw = src[j];
          s.cells[r][c] = typeof raw === 'string' && raw.startsWith('=') && raw.length > 1 ? F().offsetFormula(raw, r - sr, c - sc) : next(k);
          if (s.cached) delete s.cached[r + ',' + c];
          const st = s.styles[sr + ',' + sc];
          if (st) s.styles[r + ',' + c] = D.clone(st); else delete s.styles[r + ',' + c];
        }
      }
      this.sel = { r1: tgt.r1, c1: tgt.c1, r2: tgt.r2, c2: tgt.c2 };
      D.commit();
      this.renderBody(true);
      this.paintSel();
    }
    onDbl(e) {
      if (e.target.classList.contains('fill-handle')) return this.fillToEnd();
      if (e.target.classList.contains('col-resizer')) { const c = +e.target.dataset.c; const cs = this.sel.r2 - this.sel.r1 > this.rows - 3 && c >= this.sel.c1 && c <= this.sel.c2 ? [this.sel.c1, this.sel.c2] : [c, c]; for (let x = cs[0]; x <= cs[1]; x++) this.autoFitCol(x, false); D.commit({ data: false }); this.renderGrid(); return; }
      if (e.target.classList.contains('row-resizer')) { const r = +e.target.dataset.r; this.autoFitRows(r, r); return; }
      if (e.target.closest('td.c')) this.startEdit(null);
    }
    startColResize(e, c) {
      e.preventDefault(); e.stopPropagation();
      const x0 = e.clientX, w0 = this.colW(c);
      const col = this.table.querySelectorAll('col')[c + 1];
      const multi = this.sel.r2 - this.sel.r1 > this.rows - 3 && c >= this.sel.c1 && c <= this.sel.c2 && this.sel.c2 > this.sel.c1;
      const mv = (e2) => { const w = Math.max(24, w0 + e2.clientX - x0); this.sheet.colWidths[c] = w; col.style.width = w + 'px'; this.table.style.width = [...this.table.querySelectorAll('col')].reduce((s, x) => s + parseFloat(x.style.width), 0) + 'px'; };
      const up = () => {
        window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up);
        if (multi) for (let x = this.sel.c1; x <= this.sel.c2; x++) this.sheet.colWidths[x] = this.sheet.colWidths[c];
        D.commit({ data: false }); if (multi) this.renderGrid();
      };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    }
    startRowResize(e, r) {
      e.preventDefault(); e.stopPropagation();
      const y0 = e.clientY, h0 = this.baseRowH(r);
      const multi = this.sel.c2 - this.sel.c1 > this.cols - 3 && r >= this.sel.r1 && r <= this.sel.r2 && this.sel.r2 > this.sel.r1;
      const guide = h('div', { class: 'row-guide' });
      this.scroller.append(guide);
      const place = (hh) => { guide.style.top = HDR_H + this.tops[r] + hh + 'px'; guide.style.width = this.table.style.width; };
      place(h0);
      let hh = h0;
      const mv = (e2) => { hh = Math.max(14, Math.round(h0 + e2.clientY - y0)); place(hh); };
      const up = () => {
        window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up);
        guide.remove();
        const rows = multi ? Array.from({ length: this.sel.r2 - this.sel.r1 + 1 }, (_, i) => this.sel.r1 + i) : [r];
        rows.forEach((x) => { if (hh === ROW_H) delete this.sheet.rowHeights[x]; else this.sheet.rowHeights[x] = hh; });
        D.commit({ data: false }); this.renderBody(true);
      };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    }
    measure() { if (!this._mctx) this._mctx = document.createElement('canvas').getContext('2d'); return this._mctx; }
    autoFitCol(c, commit = true) {
      const ctx = this.measure();
      let w = 40;
      const last = Math.min(this.rows - 1, Math.max(F().parseRange(D.links.usedRange(this.sheet)).r2, 0));
      for (let r = 0; r <= last; r++) {
        if (this.sheet.cells[r][c] === '' || this.hidden.has(r)) continue;
        const m = F().mergeAt(this.sheet, r, c); if (m && m.c2 > m.c1) continue;
        const st = this.styleAt(r, c);
        ctx.font = `${st.b ? 700 : 400} 12.5px 'Inter Variable', Inter, sans-serif`;
        w = Math.max(w, ctx.measureText(F().display(this.sheet, r, c)).width + 22);
      }
      this.sheet.colWidths[c] = Math.min(Math.ceil(w), 520);
      if (commit) { D.commit({ data: false }); this.renderGrid(); }
    }
    autoFitRows(r1, r2) {
      const probe = h('div', { class: 'fit-probe' });
      document.body.append(probe);
      for (let r = r1; r <= r2; r++) {
        let hh = ROW_H;
        for (let c = 0; c < this.cols; c++) {
          const st = this.styleAt(r, c);
          if (!st.wrap || this.sheet.cells[r][c] === '') continue;
          probe.style.width = this.colW(c) - 14 + 'px';
          probe.style.fontWeight = st.b ? 700 : 400;
          probe.textContent = F().display(this.sheet, r, c);
          hh = Math.max(hh, probe.offsetHeight + 10);
        }
        if (hh === ROW_H) delete this.sheet.rowHeights[r]; else this.sheet.rowHeights[r] = hh;
      }
      probe.remove();
      D.commit({ data: false }); this.renderBody(true);
    }
    async promptRowHeight() {
      const v = await D.prompt('Row height (pixels)', String(this.baseRowH(this.sel.r1)));
      const n = parseInt(v); if (!n || n < 8) return;
      for (let r = this.sel.r1; r <= this.sel.r2; r++) { if (n === ROW_H) delete this.sheet.rowHeights[r]; else this.sheet.rowHeights[r] = Math.min(n, 600); }
      D.commit({ data: false }); this.renderBody(true);
    }
    async promptColWidth() {
      const v = await D.prompt('Column width (pixels)', String(this.colW(this.sel.c1)));
      const n = parseInt(v); if (!n || n < 16) return;
      for (let c = this.sel.c1; c <= this.sel.c2; c++) this.sheet.colWidths[c] = Math.min(n, 1200);
      D.commit({ data: false }); this.renderGrid();
    }
    setActive(r, c, keepExtra = false) {
      if (!keepExtra) this.extra = [];
      if (this.ensureSize(r, c)) this.renderGrid();
      const m = F().mergeAt(this.sheet, r, c);
      if (m) { r = m.r1; c = m.c1; }
      this.act = { r, c }; this.anchor = { r, c };
      this.sel = m ? { r1: m.r1, c1: m.c1, r2: m.r2, c2: m.c2 } : { r1: r, c1: c, r2: r, c2: c };
      this.paintSel();
    }
    extendTo(r, c) {
      if (this.ensureSize(r, c)) this.renderGrid();
      this.sel = this.expandForMerges({ r1: Math.min(this.anchor.r, r), c1: Math.min(this.anchor.c, c), r2: Math.max(this.anchor.r, r), c2: Math.max(this.anchor.c, c) });
      this.paintSel();
    }

    onContext(e) {
      e.preventDefault();
      const range = this.selRange();
      const onHeader = e.target.closest('th.ch'), onRow = e.target.closest('th.rh');
      D.menu({ x: e.clientX, y: e.clientY }, [
        { label: 'Cut', kbd: 'Ctrl+X', onClick: () => { document.execCommand('cut'); } },
        { label: 'Copy', icon: 'copy', kbd: 'Ctrl+C', onClick: () => { document.execCommand('copy'); } },
        { label: 'Paste', kbd: 'Ctrl+V', onClick: () => navigator.clipboard.readText().then((t) => this.pasteText(t)).catch(() => D.toast('Use Ctrl+V to paste', 'warn')) },
        { label: 'Clear contents', kbd: 'Del', onClick: () => this.clear() },
        { label: 'Clear formatting', onClick: () => this.clearFormatting() },
        { sep: true },
        { label: `Send ${range} to…`, icon: 'send', onClick: () => D.links.sendTo({ x: e.clientX, y: e.clientY }, this.sheet.id, this.selRange(true)) },
        { label: 'Copy reference', icon: 'link', onClick: () => { navigator.clipboard.writeText(`${F().quoteSheet(this.sheet.name)}!${range}`); D.toast('Reference copied - paste it into any formula or {{live value}}', 'ok'); } },
        { sep: true },
        onHeader ? { label: 'Column width…', icon: 'cols', onClick: () => this.promptColWidth() } : null,
        onRow ? { label: 'Row height…', icon: 'rows', onClick: () => this.promptRowHeight() } : null,
        { label: 'Merge & center', icon: 'layers', onClick: () => this.mergeCells('center') },
        this.mergesIn(this.sel).length ? { label: 'Unmerge', onClick: () => this.unmerge() } : null,
        { label: 'Insert / delete', icon: 'rows', sub: () => this.structureItems() },
        { sep: true },
        { label: 'Sort A → Z', icon: 'sortAsc', onClick: () => this.quickSort(1) },
        { label: 'Sort Z → A', icon: 'sortDesc', onClick: () => this.quickSort(-1) },
        { label: 'Custom sort…', onClick: () => this.sortDialog() },
        { label: this.sheet.filter ? 'Remove filter' : 'Filter', icon: 'filter', onClick: () => this.toggleFilter() },
        { label: 'Conditional formatting', icon: 'palette', sub: () => this.cfMenu() }
      ]);
    }

    // ------------------------------------------------ editing
    startEdit(initial) {
      if (this.editor) return;
      const { r, c } = this.act;
      this.scrollTo(r, c);
      const ed = h('input', { class: 'cell-editor', spellcheck: 'false' });
      ed.value = initial != null ? initial : this.raw(r, c);
      this.editor = ed;
      this.editing = { r, c };
      this.scroller.append(ed);
      this.placeEditor();
      ed.focus();
      if (initial == null) ed.setSelectionRange(ed.value.length, ed.value.length);
      this.fx.value = ed.value;
      this.refStart = null;
      ed.addEventListener('input', () => { this.fx.value = ed.value; this.refStart = null; this.showFnHint(); });
      ed.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (this.hint && (e.key === 'Tab' || (e.key === 'Enter' && this.hint.querySelector('.on')))) { e.preventDefault(); (this.hint.querySelector('.on') || this.hint.firstChild).dispatchEvent(new MouseEvent('mousedown')); return; }
        if (this.hint && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); const items = [...this.hint.children]; let i = items.findIndex((x) => x.classList.contains('on')); items.forEach((x) => x.classList.remove('on')); i = D.clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1); items[i].classList.add('on'); return; }
        if (e.key === 'Enter') { e.preventDefault(); this.commitEdit(); this.move(e.shiftKey ? -1 : 1, 0); }
        else if (e.key === 'Tab') { e.preventDefault(); this.commitEdit(); this.move(0, e.shiftKey ? -1 : 1); }
        else if (e.key === 'Escape') { this.cancelEdit(); }
        else if (e.key.startsWith('Arrow') && initial != null && !ed.value.startsWith('=')) { e.preventDefault(); this.commitEdit(); this.move(...{ ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]); }
      });
      ed.addEventListener('blur', () => setTimeout(() => { if (this.editor === ed && document.activeElement !== this.fx && !this._refDrag && !document.querySelector('.modal-back')) this.commitEdit(); }, 0));
    }
    showFnHint() {
      const ed = this.editor; if (!ed) return;
      this.hint && this.hint.remove(); this.hint = null;
      const m = /([A-Za-z][A-Za-z.]+)$/.exec(ed.value.slice(0, ed.selectionStart));
      if (!ed.value.startsWith('=') || !m) return;
      const q = m[1].toUpperCase();
      const list = F().functions.filter((f) => f.startsWith(q)).slice(0, 7);
      if (!list.length) return;
      this.hint = h('div', { class: 'fn-hint' }, list.map((f) => h('div', { onmousedown: (e) => { e.preventDefault(); ed.value = ed.value.slice(0, ed.selectionStart - m[1].length) + f + '(' + ed.value.slice(ed.selectionStart); this.fx.value = ed.value; this.hint.remove(); this.hint = null; ed.focus(); } }, h('b', null, f), h('span', null, (F().FN_HELP[f] || '').split(' · ')[0]))));
      this.scroller.append(this.hint);
      this.hint.style.left = ed.style.left; this.hint.style.top = parseFloat(ed.style.top) + ed.offsetHeight + 2 + 'px';
    }
    refInsertable() {
      const ed = this.editor;
      if (this.refStart != null) return true;
      return /[=+\-*/(,:<>&^]\s*$/.test(ed.value.slice(0, ed.selectionStart));
    }
    dragRefInsert(r, c) {
      const ed = this.editor;
      this._refDrag = true;
      const anchor = { r, c };
      if (this.refStart == null) this.refStart = ed.selectionStart;
      const tail = ed.value.slice(ed.selectionEnd);
      const head = ed.value.slice(0, this.refStart);
      const put = (g) => {
        const ref = F().rangeStr(g);
        ed.value = head + ref + tail;
        const pos = head.length + ref.length;
        ed.setSelectionRange(pos, pos);
        this.fx.value = ed.value;
        this.tbody.querySelectorAll('td.refsel').forEach((t) => t.classList.remove('refsel'));
        this.tdMap.forEach((td, k) => { const [rr, cc] = k.split(',').map(Number); if (rr >= g.r1 && rr <= g.r2 && cc >= g.c1 && cc <= g.c2) td.classList.add('refsel'); });
      };
      put({ r1: r, c1: c, r2: r, c2: c });
      this.dragSelect((rr, cc) => put({ r1: Math.min(anchor.r, rr), c1: Math.min(anchor.c, cc), r2: Math.max(anchor.r, rr), c2: Math.max(anchor.c, cc) }), () => { this._refDrag = false; ed.focus(); this.placeEditor(); });
    }
    placeEditor() {
      if (!this.editor) return;
      const { r, c } = this.editing;
      const m = F().mergeAt(this.sheet, r, c);
      const w = m ? this.colX(m.c2 + 1) - this.colX(m.c1) : this.colW(c);
      const hh = m ? this.tops[m.r2 + 1] - this.tops[m.r1] : this.rowH(r);
      Object.assign(this.editor.style, { left: this.colX(c) + 'px', top: HDR_H + this.tops[r] + 'px', minWidth: w + 'px', height: Math.max(hh, ROW_H) + 'px' });
    }
    commitEdit() {
      if (!this.editor) return;
      const { r, c } = this.editing;
      const v = this.editor.value;
      this.editor.remove(); this.editor = null; this.editing = null;
      this.hint && this.hint.remove(); this.hint = null;
      this.tbody.querySelectorAll('td.refsel').forEach((t) => t.classList.remove('refsel'));
      if (v !== this.raw(r, c)) this.setCell(r, c, v);
      this.scroller.focus({ preventScroll: true });
    }
    cancelEdit() {
      if (!this.editor) return;
      this.editor.remove(); this.editor = null; this.editing = null;
      this.hint && this.hint.remove(); this.hint = null;
      this.paintSel();
      this.scroller.focus({ preventScroll: true });
    }
    setCell(r, c, v) {
      this.ensureSize(r, c);
      let val = v;
      if (/^=/.test(val)) val = '=' + val.slice(1).replace(/"[^"]*"|\b([a-z][a-z.]*)\(/gi, (m0, fn) => (fn ? fn.toUpperCase() + '(' : m0));
      this.sheet.cells[r][c] = val;
      if (this.sheet.cached) delete this.sheet.cached[r + ',' + c];
      D.commit();
      this.renderBody(true);
      this.paintSel();
    }
    move(dr, dc) {
      const cur = F().mergeAt(this.sheet, this.act.r, this.act.c);
      let r = this.act.r, c = this.act.c;
      if (dr > 0) r = (cur ? cur.r2 : r) + dr; else if (dr < 0) r = r + dr;
      if (dc > 0) c = (cur ? cur.c2 : c) + dc; else if (dc < 0) c = c + dc;
      r = D.clamp(r, 0, 1e6); c = D.clamp(c, 0, 1e4);
      while (dr && this.hidden && this.hidden.has(r) && r > 0 && r < this.rows - 1) r += dr > 0 ? 1 : -1;
      this.setActive(r, c);
      this.scrollTo(this.act.r, this.act.c);
    }
    edgeJump(dr, dc) {
      const s = this.sheet;
      let { r, c } = this.act;
      const filled = (rr, cc) => rr >= 0 && cc >= 0 && rr < this.rows && cc < this.cols && s.cells[rr][cc] !== '';
      const cur = filled(r, c), nxt = filled(r + dr, c + dc);
      if (cur && nxt) { while (filled(r + dr, c + dc)) { r += dr; c += dc; } }
      else { r += dr; c += dc; while (r > 0 && c > 0 && r < this.rows - 1 && c < this.cols - 1 && !filled(r, c)) { r += dr; c += dc; } }
      return { r: D.clamp(r, 0, this.rows - 1), c: D.clamp(c, 0, this.cols - 1) };
    }

    onKey(e) {
      if (!this.host.isConnected || D.active() !== this.sheet) return;
      if (this.editor || this.pop) return;
      const t = e.target;
      if (t !== this.scroller && t !== document.body && !this.scroller.contains(t)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      const dirs = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (dirs[k]) {
        e.preventDefault();
        const [dr, dc] = dirs[k];
        if (e.shiftKey) {
          const focus = { r: this.sel.r1 === this.anchor.r ? this.sel.r2 : this.sel.r1, c: this.sel.c1 === this.anchor.c ? this.sel.c2 : this.sel.c1 };
          const nf = mod ? (() => { const sv = this.act; this.act = focus; const j = this.edgeJump(dr, dc); this.act = sv; return j; })() : { r: Math.max(0, focus.r + dr), c: Math.max(0, focus.c + dc) };
          this.extendTo(nf.r, nf.c);
          this.scrollTo(nf.r, nf.c);
        } else if (mod) { const j = this.edgeJump(dr, dc); this.setActive(j.r, j.c); this.scrollTo(j.r, j.c); }
        else { this.extra = []; this.move(dr, dc); }
        return;
      }
      const lk = k.toLowerCase();
      if (k === 'Escape' && this.extra.length) { this.extra = []; this.paintSel(); return; }
      if (k === 'Enter') { e.preventDefault(); this.move(e.shiftKey ? -1 : 1, 0); return; }
      if (k === 'Tab') { e.preventDefault(); this.move(0, e.shiftKey ? -1 : 1); return; }
      if (k === 'F2') { e.preventDefault(); this.startEdit(null); return; }
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.clear(); return; }
      if (k === 'Home') { e.preventDefault(); this.setActive(mod ? 0 : this.act.r, 0); this.scrollTo(this.act.r, 0); return; }
      if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); const n = Math.floor(this.scroller.clientHeight / ROW_H) - 2; this.move(k === 'PageDown' ? n : -n, 0); return; }
      if (mod && e.shiftKey && lk === 'l') { e.preventDefault(); this.toggleFilter(); return; }
      if (mod && lk === 'b') { e.preventDefault(); const v = !this.styleAt(this.act.r, this.act.c).b; this.applyStyle((s) => { s.b = v; }); return; }
      if (mod && lk === 'i') { e.preventDefault(); const v = !this.styleAt(this.act.r, this.act.c).i; this.applyStyle((s) => { s.i = v; }); return; }
      if (mod && lk === 'u') { e.preventDefault(); const v = !this.styleAt(this.act.r, this.act.c).u; this.applyStyle((s) => { s.u = v; }); return; }
      if (mod && lk === 'a') { e.preventDefault(); this.sel = F().parseRange(this.currentRegion(this.act.r, this.act.c)); this.paintSel(); return; }
      if (mod && lk === 'd') { e.preventDefault(); this.fillDown(); return; }
      if (e.altKey && k === '=') { e.preventDefault(); this.autoSum('SUM'); return; }
      if (!mod && !e.altKey && k.length === 1) { e.preventDefault(); this.startEdit(k); }
    }

    applyStyle(fn) {
      if (this.areas().reduce((n, a) => n + (a.r2 - a.r1 + 1) * (a.c2 - a.c1 + 1), 0) > 200000) return D.toast('Selection too large to format', 'warn');
      this.eachCell((r, c) => {
        const k = r + ',' + c;
        const s = { ...(this.sheet.styles[k] || {}) };
        fn(s, r, c);
        Object.keys(s).forEach((x) => { if (s[x] == null || (s[x] === false && x !== 'comma')) delete s[x]; });
        if (s.bd && !s.bd.t && !s.bd.b && !s.bd.l && !s.bd.r) delete s.bd;
        if (Object.keys(s).length) this.sheet.styles[k] = s; else delete this.sheet.styles[k];
      });
      D.commit();
      this.renderBody(true);
    }
    clearFormatting() { this.applyStyle((s) => { Object.keys(s).forEach((k) => delete s[k]); }); }
    setBorders(mode, line) {
      const areas = this.areas();
      const pen = this.borderPen || { w: 1, s: 'solid', c: '#1F2937' };
      let L = line || (pen.w === 1 && pen.s === 'solid' && pen.c === '#1F2937' ? true : { ...pen });
      if (mode === 'thickOuter' || mode === 'thickB') L = { w: 3, s: 'solid', c: pen.c };
      if (mode === 'doubleB') L = { w: 3, s: 'double', c: pen.c };
      this.applyStyle((s, r, c) => {
        const { r1, r2, c1, c2 } = areas.find((a) => r >= a.r1 && r <= a.r2 && c >= a.c1 && c <= a.c2) || this.sel;
        const bd = { ...(s.bd || {}) };
        if (mode === 'none') { delete s.bd; return; }
        const outer = () => { if (r === r1) bd.t = L; if (r === r2) bd.b = L; if (c === c1) bd.l = L; if (c === c2) bd.r = L; };
        if (mode === 'all') { bd.b = L; bd.r = L; if (r === r1) bd.t = L; if (c === c1) bd.l = L; } // shared edges drawn once
        if (mode === 'outer' || mode === 'thickOuter') outer();
        if (mode === 'inner' || mode === 'innerH') { if (r < r2) bd.b = L; }
        if (mode === 'inner' || mode === 'innerV') { if (c < c2) bd.r = L; }
        if ((mode === 'b' || mode === 'thickB' || mode === 'doubleB') && r === r2) bd.b = L;
        if (mode === 't' && r === r1) bd.t = L;
        if (mode === 'l' && c === c1) bd.l = L;
        if (mode === 'r' && c === c2) bd.r = L;
        if (mode === 'tb') { if (r === r1) bd.t = L; if (r === r2) bd.b = L; }
        if (mode === 'recolor') ['t', 'b', 'l', 'r'].forEach((k) => { if (bd[k]) bd[k] = { ...(bd[k] === true ? { w: 1, s: 'solid' } : bd[k]), c: pen.c }; });
        if (Object.keys(bd).length) s.bd = bd; else delete s.bd;
      });
    }
    borderPicker(anchor) {
      D.closeMenus();
      document.querySelectorAll('.border-pop').forEach((x) => x.remove());
      const pen = this.borderPen || (this.borderPen = { w: 1, s: 'solid', c: '#1F2937' });
      const pop = h('div', { class: 'border-pop menu' });
      const close = () => { pop.remove(); document.removeEventListener('mousedown', outside, true); };
      const outside = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
      const MODES = [['all', 'All borders'], ['outer', 'Outside borders'], ['inner', 'Inside borders'], ['innerH', 'Inside horizontal'], ['innerV', 'Inside vertical'], ['none', 'No borders'],
        ['t', 'Top'], ['b', 'Bottom'], ['l', 'Left'], ['r', 'Right'], ['tb', 'Top and bottom'], ['thickOuter', 'Thick outside'], ['thickB', 'Thick bottom'], ['doubleB', 'Double bottom']];
      const grid = h('div', { class: 'bp-grid' }, MODES.map(([m, label]) => h('button', { class: `bp-btn ${m === 'none' ? 'none' : ''}`, title: label, html: BORDER_ICON(m) + `<span>${label}</span>`, onclick: () => { this.setBorders(m); } })));
      const STYLES = [[{ w: 1, s: 'solid' }, 'Thin'], [{ w: 2, s: 'solid' }, 'Medium'], [{ w: 3, s: 'solid' }, 'Thick'], [{ w: 1, s: 'dashed' }, 'Dashed'], [{ w: 1, s: 'dotted' }, 'Dotted'], [{ w: 3, s: 'double' }, 'Double']];
      const styleRow = h('div', { class: 'bp-styles' });
      const drawStyles = () => {
        styleRow.innerHTML = '';
        STYLES.forEach(([st, label]) => {
          const on = pen.w === st.w && pen.s === st.s;
          const sample = h('span', { class: 'bp-sample', style: { borderTop: borderCss({ ...st, c: pen.c }) } });
          styleRow.append(h('button', { class: `bp-style ${on ? 'on' : ''}`, title: label, onclick: () => { Object.assign(pen, st); drawStyles(); } }, sample, h('em', null, label)));
        });
      };
      drawStyles();
      const COLORS = ['#1F2937', '#64748B', '#CBD5E1', '#1F6BFF', '#00A3FF', '#10B981', '#F59E0B', '#EF4444', '#7C3AED', '#FFFFFF'];
      const colorRow = h('div', { class: 'bp-colors' });
      const drawColors = () => {
        colorRow.innerHTML = '';
        COLORS.forEach((c) => colorRow.append(h('button', { class: `bp-sw ${pen.c.toUpperCase() === c ? 'on' : ''}`, style: { background: c }, title: c, onclick: () => { pen.c = c; drawColors(); drawStyles(); } })));
        const custom = h('input', { type: 'color', value: pen.c, title: 'Custom color' });
        custom.addEventListener('input', () => { pen.c = custom.value.toUpperCase(); drawStyles(); });
        colorRow.append(custom, h('button', { class: 'btn xs ghost', title: 'Give the borders already in the selection this color', onclick: () => this.setBorders('recolor') }, 'Recolor'));
      };
      drawColors();
      pop.append(h('div', { class: 'menu-head' }, 'Borders'), grid, h('div', { class: 'menu-head' }, 'Line'), styleRow, h('div', { class: 'menu-head' }, 'Color'), colorRow,
        h('div', { class: 'bp-hint' }, 'Pick a line and color first, then click where the borders go.'));
      document.body.append(pop);
      const r = anchor.getBoundingClientRect();
      pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + 'px';
      pop.style.top = r.bottom + 4 + 'px';
      setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
    }
    clear() {
      this.eachCell((r, c) => { if (r < this.rows && c < this.cols) { this.sheet.cells[r][c] = ''; if (this.sheet.cached) delete this.sheet.cached[r + ',' + c]; } });
      D.commit();
      this.renderBody(true);
      this.paintSel();
    }
    fillDown() {
      const { r1, r2, c1, c2 } = this.sel;
      if (r2 === r1) return;
      for (let c = c1; c <= c2; c++) {
        const src = this.raw(r1, c);
        const st = this.sheet.styles[r1 + ',' + c];
        for (let r = r1 + 1; r <= r2; r++) {
          this.sheet.cells[r][c] = src.startsWith('=') ? F().offsetFormula(src, r - r1, 0) : src;
          if (st) this.sheet.styles[r + ',' + c] = D.clone(st);
        }
      }
      D.commit(); this.renderBody(true);
    }
    autoSum(fn = 'SUM') {
      const s = this.sheet;
      const { r1, r2, c1, c2 } = this.sel;
      if (r2 > r1) {
        for (let c = c1; c <= c2; c++) { this.ensureSize(r2 + 1, c); s.cells[r2 + 1][c] = `=${fn}(${F().addr(r1, c)}:${F().addr(r2, c)})`; }
      } else {
        const c = this.act.c; const r = this.act.r - 1; let top = r;
        while (top >= 0 && typeof F().cellValue(s, top, c) === 'number') top--;
        if (top === r) return D.toast('No numbers directly above to use', 'warn');
        s.cells[this.act.r][c] = `=${fn}(${F().addr(top + 1, c)}:${F().addr(r, c)})`;
      }
      D.commit(); this.renderBody(true); this.paintSel();
    }

    // ------------------------------------------------ merging
    async mergeCells(mode) {
      const g = { ...this.sel };
      if (g.r1 === g.r2 && g.c1 === g.c2) return D.toast('Select two or more cells to merge', 'warn');
      if (this.sheet.filter) { const f = F().parseRange(this.sheet.filter.range); if (f && g.r1 <= f.r2 && g.r2 >= f.r1 && g.c1 <= f.c2 && g.c2 >= f.c1 && g.r2 > g.r1) return D.toast('Remove the filter before merging rows inside it', 'warn'); }
      const groups = mode === 'across' ? Array.from({ length: g.r2 - g.r1 + 1 }, (_, i) => ({ r1: g.r1 + i, r2: g.r1 + i, c1: g.c1, c2: g.c2 })) : [g];
      let lost = 0;
      groups.forEach((x) => { for (let r = x.r1; r <= x.r2; r++) for (let c = x.c1; c <= x.c2; c++) if ((r !== x.r1 || c !== x.c1) && this.raw(r, c) !== '') lost++; });
      if (lost && !(await D.confirm('Merge cells', `Merging keeps only the top-left value${mode === 'across' ? ' of each row' : ''}. ${lost} other value${lost > 1 ? 's' : ''} will be cleared.`, 'Merge'))) return;
      const keep = (this.sheet.merges || []).filter((m) => { const mg = F().parseRange(m); return !(mg.r1 <= g.r2 && mg.r2 >= g.r1 && mg.c1 <= g.c2 && mg.c2 >= g.c1); });
      groups.forEach((x) => {
        if (x.r1 === x.r2 && x.c1 === x.c2) return;
        for (let r = x.r1; r <= x.r2; r++) for (let c = x.c1; c <= x.c2; c++) if (r !== x.r1 || c !== x.c1) this.sheet.cells[r][c] = '';
        keep.push(F().rangeStr(x));
        if (mode === 'center') { const k = x.r1 + ',' + x.c1; this.sheet.styles[k] = { ...(this.sheet.styles[k] || {}), align: 'center', valign: 'middle' }; }
      });
      this.sheet.merges = keep;
      D.commit();
      this.renderBody(true);
      this.setActive(g.r1, g.c1);
      this.sel = this.expandForMerges({ ...g }); this.paintSel();
    }
    unmerge() {
      const g = this.sel;
      this.sheet.merges = (this.sheet.merges || []).filter((m) => { const mg = F().parseRange(m); return !(mg.r1 <= g.r2 && mg.r2 >= g.r1 && mg.c1 <= g.c2 && mg.c2 >= g.c1); });
      D.commit(); this.renderBody(true); this.paintSel();
    }

    // ------------------------------------------------ sorting
    headerGuess(g) {
      const s = this.sheet;
      if (g.r2 <= g.r1) return false;
      let textTop = 0, numBelow = 0;
      for (let c = g.c1; c <= g.c2; c++) {
        if (typeof F().cellValue(s, g.r1, c) === 'string' && s.cells[g.r1][c] !== '') textTop++;
        if (typeof F().cellValue(s, g.r1 + 1, c) === 'number') numBelow++;
      }
      return textTop === g.c2 - g.c1 + 1 || (textTop > 0 && numBelow > 0) || !!(s.styles[g.r1 + ',' + g.c1] || {}).b;
    }
    sortRange() {
      if (this.sheet.filter) return F().parseRange(this.sheet.filter.range);
      return F().parseRange(this.selRange(true));
    }
    quickSort(dir) {
      const g = this.sortRange();
      this.sortBy(g, [{ c: D.clamp(this.act.c, g.c1, g.c2), dir }], this.sheet.filter ? true : this.headerGuess(g));
    }
    sortBy(g, keys, hasHeader) {
      const s = this.sheet;
      if (this.mergesIn(g).some((m) => m.r2 > m.r1)) return D.toast('Unmerge cells that span rows before sorting', 'warn');
      const r0 = hasHeader ? g.r1 + 1 : g.r1;
      const rows = [];
      for (let r = r0; r <= g.r2; r++) rows.push({ from: r, cells: s.cells[r].slice(g.c1, g.c2 + 1), keys: keys.map((k) => F().cellValue(s, r, k.c)), styles: Array.from({ length: g.c2 - g.c1 + 1 }, (_, i) => s.styles[r + ',' + (g.c1 + i)]), height: s.rowHeights[r] });
      const cmp = (x, y) => {
        if ((x === '' || x == null) && y !== '' && y != null) return 1;
        if ((y === '' || y == null) && x !== '' && x != null) return -1;
        if (typeof x === 'number' && typeof y === 'number') return x - y;
        const dx = typeof x === 'string' && /\d/.test(x) ? F().toDate(x) : null, dy = typeof y === 'string' && /\d/.test(y) ? F().toDate(y) : null;
        if (dx && dy && /[-/]/.test(x) && /[-/]/.test(y)) return dx - dy;
        return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
      };
      rows.sort((a, b) => { for (let i = 0; i < keys.length; i++) { const x = a.keys[i], y = b.keys[i]; const blank = (v) => v === '' || v == null; if (blank(x) !== blank(y)) return blank(x) ? 1 : -1; const d = cmp(x, y) * keys[i].dir; if (d) return d; } return 0; });
      rows.forEach((row, i) => {
        const r = r0 + i;
        row.cells.forEach((v, j) => {
          s.cells[r][g.c1 + j] = typeof v === 'string' && v.startsWith('=') ? F().offsetFormula(v, r - row.from, 0) : v;
          const k = r + ',' + (g.c1 + j);
          if (row.styles[j]) s.styles[k] = row.styles[j]; else delete s.styles[k];
        });
        if (row.height) s.rowHeights[r] = row.height; else delete s.rowHeights[r];
      });
      D.commit(); this.renderBody(true);
      const names = keys.map((k) => (hasHeader ? `“${F().display(s, g.r1, k.c)}”` : `column ${F().colName(k.c)}`) + (k.dir > 0 ? ' ↑' : ' ↓')).join(', then ');
      D.toast(`Sorted by ${names}`, 'ok');
    }
    sortDialog() {
      const g = this.sortRange();
      let hasHeader = this.sheet.filter ? true : this.headerGuess(g);
      const keys = [{ c: D.clamp(this.act.c, g.c1, g.c2), dir: 1 }];
      const list = h('div', { class: 'sort-levels' });
      const colName = (c) => (hasHeader && F().display(this.sheet, g.r1, c) ? `${F().display(this.sheet, g.r1, c)} (${F().colName(c)})` : `Column ${F().colName(c)}`);
      const draw = () => {
        list.innerHTML = '';
        keys.forEach((k, i) => {
          const colSel = h('select', { class: 'input sm' }, Array.from({ length: g.c2 - g.c1 + 1 }, (_, j) => g.c1 + j).map((c) => h('option', { value: c, selected: c === k.c ? true : null }, colName(c))));
          colSel.addEventListener('change', () => { k.c = +colSel.value; });
          const dirSel = h('select', { class: 'input sm' }, [[1, 'A → Z / smallest first'], [-1, 'Z → A / largest first']].map(([v, l]) => h('option', { value: v, selected: v === k.dir ? true : null }, l)));
          dirSel.addEventListener('change', () => { k.dir = +dirSel.value; });
          list.append(h('div', { class: 'sort-row' }, h('span', { class: 'muted small' }, i ? 'then by' : 'Sort by'), colSel, dirSel, i ? h('button', { class: 'icon-btn', html: D.icon('x', 14), onclick: () => { keys.splice(i, 1); draw(); } }) : h('span')));
        });
      };
      draw();
      const hdr = h('input', { type: 'checkbox' }); hdr.checked = hasHeader;
      hdr.addEventListener('change', () => { hasHeader = hdr.checked; draw(); });
      D.modal({ title: `Sort ${F().rangeStr(g)}`, width: 560, body: h('div', { class: 'stack' },
        list,
        h('div', { class: 'row-between' }, h('button', { class: 'btn sm ghost', onclick: () => { if (keys.length < 4) { keys.push({ c: g.c1, dir: 1 }); draw(); } } }, '+ Add level'), h('label', { class: 'chk' }, hdr, h('span', null, 'My data has a header row')))),
        actions: [{ label: 'Cancel' }, { label: 'Sort', primary: true, onClick: () => this.sortBy(g, keys, hasHeader) }] });
    }

    // ------------------------------------------------ filtering
    toggleFilter() {
      if (this.sheet.filter) { this.sheet.filter = null; D.commit(); this.renderGrid(); this.buildToolbar(); this.paintSel(); return; }
      const g = F().parseRange(this.selRange(true));
      if (!g || g.r2 <= g.r1) return D.toast('Select a table with a header row to filter', 'warn');
      this.sheet.filter = { range: F().rangeStr(g), cols: {} };
      D.commit({ data: false });
      this.renderGrid(); this.buildToolbar(); this.paintSel();
      D.toast('Filter on - use the ▾ buttons in the header row', 'info');
    }
    closePop() { if (this.pop) { this.pop.remove(); this.pop = null; document.removeEventListener('mousedown', this._popOut, true); } }
    filterPopover(c, anchor) {
      this.closePop();
      const f = this.sheet.filter;
      const g = F().parseRange(f.range);
      const crit = { ...(f.cols[c] || {}) };
      const counts = new Map();
      for (let r = g.r1 + 1; r <= g.r2; r++) { const d = F().display(this.sheet, r, c); counts.set(d, (counts.get(d) || 0) + 1); }
      const values = [...counts.keys()].sort((a, b) => { const x = F().parseLiteral(a), y = F().parseLiteral(b); return typeof x === 'number' && typeof y === 'number' ? x - y : String(a).localeCompare(String(b), undefined, { numeric: true }); });
      const hidden = new Set(crit.hide || []);
      const listEl = h('div', { class: 'fp-list' });
      const search = h('input', { class: 'input sm', placeholder: 'Search values' });
      const all = h('input', { type: 'checkbox' });
      const drawList = () => {
        listEl.innerHTML = '';
        const q = search.value.toLowerCase();
        values.filter((v) => String(v).toLowerCase().includes(q)).slice(0, 500).forEach((v) => {
          const cb = h('input', { type: 'checkbox' }); cb.checked = !hidden.has(String(v).toLowerCase());
          cb.addEventListener('change', () => { if (cb.checked) hidden.delete(String(v).toLowerCase()); else hidden.add(String(v).toLowerCase()); all.checked = !hidden.size; });
          listEl.append(h('label', { class: 'fp-row' }, cb, h('span', null, v === '' ? '(Blanks)' : v), h('span', { class: 'muted small' }, counts.get(v))));
        });
        all.checked = !hidden.size;
      };
      all.addEventListener('change', () => { hidden.clear(); if (!all.checked) values.forEach((v) => hidden.add(String(v).toLowerCase())); drawList(); });
      search.addEventListener('input', drawList);
      const opSel = h('select', { class: 'input sm' }, [['', 'No condition'], ['gt', 'Greater than'], ['gte', 'At least'], ['lt', 'Less than'], ['lte', 'At most'], ['between', 'Between'], ['eq', 'Equals'], ['neq', 'Does not equal'], ['contains', 'Contains'], ['notcontains', 'Does not contain'], ['begins', 'Begins with'], ['top', 'Top N'], ['blank', 'Is blank'], ['notblank', 'Is not blank']].map(([v, l]) => h('option', { value: v, selected: (crit.op || '') === v ? true : null }, l)));
      const v1 = h('input', { class: 'input sm', placeholder: 'Value', value: crit.val ?? '' });
      const v2 = h('input', { class: 'input sm', placeholder: 'and', value: crit.val2 ?? '' });
      const syncOp = () => { v1.style.display = ['', 'blank', 'notblank'].includes(opSel.value) ? 'none' : ''; v2.style.display = opSel.value === 'between' ? '' : 'none'; if (opSel.value === 'top' && !v1.value) v1.value = '10'; };
      opSel.addEventListener('change', syncOp);
      const apply = () => {
        const nc = {};
        if (hidden.size) nc.hide = [...hidden];
        if (opSel.value) { nc.op = opSel.value; nc.val = v1.value; if (opSel.value === 'between') nc.val2 = v2.value; }
        if (Object.keys(nc).length) f.cols[c] = nc; else delete f.cols[c];
        this.closePop();
        D.commit(); this.renderGrid(); this.paintSel();
      };
      const pop = h('div', { class: 'filter-pop' },
        h('div', { class: 'fp-title' }, F().display(this.sheet, g.r1, c) || `Column ${F().colName(c)}`),
        h('div', { class: 'fp-sort' },
          h('button', { class: 'btn sm', onclick: () => { this.closePop(); this.sortBy(g, [{ c, dir: 1 }], true); }, html: D.icon('sortAsc', 14) + '<span>Sort A → Z</span>' }),
          h('button', { class: 'btn sm', onclick: () => { this.closePop(); this.sortBy(g, [{ c, dir: -1 }], true); }, html: D.icon('sortDesc', 14) + '<span>Sort Z → A</span>' })),
        h('div', { class: 'fp-sec' }, h('div', { class: 'fp-label' }, 'Filter by condition'), opSel, h('div', { class: 'fp-vals' }, v1, v2)),
        h('div', { class: 'fp-sec' }, h('div', { class: 'fp-label' }, 'Filter by values'), search, h('label', { class: 'fp-row all' }, all, h('span', null, 'Select all')), listEl),
        h('div', { class: 'fp-foot' },
          h('button', { class: 'btn sm ghost', onclick: () => { delete f.cols[c]; this.closePop(); D.commit(); this.renderGrid(); this.paintSel(); } }, 'Clear'),
          h('button', { class: 'btn sm primary', onclick: apply }, 'Apply')));
      pop.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') apply(); if (e.key === 'Escape') this.closePop(); });
      drawList(); syncOp();
      document.body.append(pop);
      const r = anchor.getBoundingClientRect();
      pop.style.left = D.clamp(r.right - 260, 8, innerWidth - pop.offsetWidth - 8) + 'px';
      pop.style.top = D.clamp(r.bottom + 4, 8, innerHeight - pop.offsetHeight - 8) + 'px';
      this.pop = pop;
      this._popOut = (e) => { if (!e.target.closest('.filter-pop') && !e.target.closest('.menu')) this.closePop(); };
      setTimeout(() => document.addEventListener('mousedown', this._popOut, true), 0);
      search.focus();
    }

    // ------------------------------------------------ conditional formatting
    cfMenu() {
      const range = F().rangeStr(this.sel.r1 === this.sel.r2 && this.sel.c1 === this.sel.c2 ? F().parseRange(this.selRange(true)) : this.sel);
      const add = (rule) => { this.sheet.cf = [...(this.sheet.cf || []), { id: D.uid(), range, ...rule }]; D.commit(); this.renderBody(true); D.toast(`Rule added to ${range}`, 'ok'); };
      const ask = (type) => () => this.cfEditor({ type, range });
      return [
        { header: `Apply to ${range}` },
        { label: 'Highlight cells', icon: 'fill', sub: [
          { label: 'Greater than…', onClick: ask('gt') }, { label: 'Less than…', onClick: ask('lt') }, { label: 'Between…', onClick: ask('between') },
          { label: 'Equal to…', onClick: ask('eq') }, { label: 'Text contains…', onClick: ask('text') }, { sep: true },
          { label: 'Duplicate values', onClick: () => add({ type: 'dup', ...CF_STYLES[0] }) },
          { label: 'Negative numbers', onClick: () => add({ type: 'neg', color: '#C00000' }) },
          { label: 'Blank cells', onClick: () => add({ type: 'blank', fill: '#FFEB9C' }) }
        ] },
        { label: 'Top / bottom', icon: 'sortDesc', sub: [
          { label: 'Top 10…', onClick: ask('top') }, { label: 'Bottom 10…', onClick: ask('bottom') },
          { label: 'Above average', onClick: () => add({ type: 'above', ...CF_STYLES[1] }) },
          { label: 'Below average', onClick: () => add({ type: 'below', ...CF_STYLES[0] }) }
        ] },
        { label: 'Data bars', icon: 'chart', sub: BARS.map(([l, col]) => ({ label: l, swatch: col, onClick: () => add({ type: 'bars', barColor: col }) })) },
        { label: 'Color scales', icon: 'palette', sub: SCALES.map((sc) => ({ label: sc.label, swatch: `linear-gradient(90deg, ${sc.colors.join(',')})`, onClick: () => add({ type: sc.type, colors: sc.colors }) })) },
        { label: 'Custom formula…', icon: 'sigma', onClick: ask('formula') },
        { sep: true },
        { label: 'Manage rules…', icon: 'rows', onClick: () => this.cfManager() },
        { label: 'Clear rules from selection', disabled: !(this.sheet.cf || []).length, onClick: () => { const g = this.sel; this.sheet.cf = this.sheet.cf.filter((r) => { const rg = F().parseRange(r.range); return !(rg.r1 <= g.r2 && rg.r2 >= g.r1 && rg.c1 <= g.c2 && rg.c2 >= g.c1); }); D.commit(); this.renderBody(true); } },
        { label: 'Clear all rules on this sheet', danger: true, disabled: !(this.sheet.cf || []).length, onClick: () => { this.sheet.cf = []; D.commit(); this.renderBody(true); } }
      ];
    }
    cfEditor(rule, onDone) {
      const r = { fill: CF_STYLES[0].fill, color: CF_STYLES[0].color, ...D.clone(rule) };
      const isNew = !rule.id;
      const typeSel = h('select', { class: 'input' }, Object.entries(CF_TYPES).map(([k, t]) => h('option', { value: k, selected: k === r.type ? true : null }, t.label)));
      const rangeIn = h('input', { class: 'input mono', value: r.range });
      const v1 = h('input', { class: 'input', value: r.v1 ?? '' });
      const v2 = h('input', { class: 'input', value: r.v2 ?? '' });
      const styleSel = h('select', { class: 'input' }, [...CF_STYLES.map((s) => h('option', { value: s.id }, s.label)), h('option', { value: 'custom' }, 'Custom colors…')]);
      const fillIn = D.colorInput(r.fill || '#FFFFFF', (v) => { r.fill = v; preview(); }, 'Fill');
      const colorIn = D.colorInput(r.color || '#111827', (v) => { r.color = v; preview(); }, 'Text');
      const custom = h('div', { class: 'swatch-row' }, h('span', { class: 'muted small' }, 'Fill'), fillIn, h('span', { class: 'muted small' }, 'Text'), colorIn);
      const scaleSel = h('select', { class: 'input' }, SCALES.map((s, i) => h('option', { value: i }, s.label)));
      const barSel = h('select', { class: 'input' }, BARS.map(([l, c]) => h('option', { value: c, selected: c === r.barColor ? true : null }, l)));
      const prev = h('div', { class: 'cf-preview' }, '1,234');
      const preset = CF_STYLES.find((s) => s.fill === r.fill && s.color === r.color && !!s.bold === !!r.bold);
      styleSel.value = preset ? preset.id : (r.fill || r.color || r.bold ? 'custom' : 'red');
      const preview = () => { prev.style.background = r.fill || '#fff'; prev.style.color = r.color || '#111827'; prev.style.fontWeight = r.bold ? 700 : 400; };
      const sync = () => {
        const t = CF_TYPES[typeSel.value];
        v1.parentElement.style.display = t.n >= 1 ? '' : 'none';
        v2.parentElement.style.display = t.n >= 2 ? '' : 'none';
        v1.placeholder = t.formula ? `=${F().addr(F().parseRange(rangeIn.value)?.r1 || 0, F().parseRange(rangeIn.value)?.c1 || 0)}>100` : (t.def ? String(t.def) : 'Value');
        if (t.def && !v1.value) v1.value = String(t.def);
        styleSel.parentElement.style.display = t.scale || t.bars ? 'none' : '';
        custom.style.display = !t.scale && !t.bars && styleSel.value === 'custom' ? '' : 'none';
        scaleSel.parentElement.style.display = t.scale ? '' : 'none';
        barSel.parentElement.style.display = t.bars ? '' : 'none';
        prev.style.display = t.scale || t.bars ? 'none' : '';
      };
      styleSel.addEventListener('change', () => { const s = CF_STYLES.find((x) => x.id === styleSel.value); if (s) { r.fill = s.fill; r.color = s.color; r.bold = s.bold; } sync(); preview(); });
      typeSel.addEventListener('change', sync);
      rangeIn.addEventListener('input', sync);
      const field = (l, ctl) => h('div', { class: 'field' }, h('label', null, l), ctl);
      const body = h('div', null,
        h('div', { class: 'row2' }, field('Apply to range', rangeIn), field('Format cells if…', typeSel)),
        h('div', { class: 'row2' }, field('Value', v1), field('And', v2)),
        field('Style', styleSel), custom,
        field('Color scale', scaleSel), field('Bar color', barSel),
        h('div', { class: 'field' }, h('label', null, 'Preview'), prev));
      sync(); preview();
      D.modal({ title: isNew ? 'New conditional format' : 'Edit conditional format', width: 560, body, actions: [{ label: 'Cancel' }, { label: isNew ? 'Add rule' : 'Save', primary: true, onClick: () => {
        if (!F().parseRange(rangeIn.value)) { D.toast('Enter a valid range like B2:B20', 'warn'); return false; }
        const t = CF_TYPES[typeSel.value];
        const out = { id: r.id || D.uid(), range: rangeIn.value.toUpperCase(), type: typeSel.value };
        if (t.n >= 1) out.v1 = v1.value; if (t.n >= 2) out.v2 = v2.value;
        if (t.scale) { const sc = SCALES[+scaleSel.value]; out.type = sc.type; out.colors = sc.colors; }
        else if (t.bars) out.barColor = barSel.value;
        else { if (r.fill && r.fill.toUpperCase() !== '#FFFFFF') out.fill = r.fill; if (r.color) out.color = r.color; if (r.bold) out.bold = true; }
        const list = this.sheet.cf || [];
        const i = list.findIndex((x) => x.id === out.id);
        if (i >= 0) list[i] = out; else list.push(out);
        this.sheet.cf = list;
        D.commit(); this.renderBody(true);
        onDone && onDone();
      } }] });
    }
    cfManager() {
      const draw = (host) => {
        host.innerHTML = '';
        const rules = this.sheet.cf || [];
        if (!rules.length) { host.append(h('div', { class: 'muted', style: { padding: '18px 4px' } }, 'No conditional formatting on this sheet yet.')); return; }
        rules.forEach((rule, i) => {
          const t = CF_TYPES[rule.type] || { label: rule.type };
          const desc = `${t.label}${rule.v1 != null && rule.v1 !== '' ? ' ' + rule.v1 : ''}${rule.v2 ? ' and ' + rule.v2 : ''}`;
          const sw = h('span', { class: 'cf-sw', style: { background: rule.colors ? `linear-gradient(90deg, ${rule.colors.join(',')})` : rule.barColor ? `linear-gradient(90deg, ${rule.barColor} 60%, #fff 60%)` : rule.fill || '#fff', color: rule.color || '#111', fontWeight: rule.bold ? 700 : 400 } }, rule.colors || rule.barColor ? '' : 'Aa');
          host.append(h('div', { class: 'cf-row' }, sw, h('div', { class: 'cf-desc' }, h('div', null, desc), h('div', { class: 'muted small mono' }, rule.range)),
            h('button', { class: 'icon-btn', title: 'Higher priority', html: D.icon('arrowUp', 14), onclick: () => { if (!i) return; [rules[i - 1], rules[i]] = [rules[i], rules[i - 1]]; D.commit(); this.renderBody(true); draw(host); } }),
            h('button', { class: 'icon-btn', title: 'Edit', html: D.icon('edit', 14), onclick: () => { close(); this.cfEditor(rule, () => this.cfManager()); } }),
            h('button', { class: 'icon-btn', title: 'Delete', html: D.icon('trash', 14), onclick: () => { rules.splice(i, 1); D.commit(); this.renderBody(true); draw(host); } })));
        });
      };
      const host = h('div', { class: 'cf-list' });
      draw(host);
      const close = D.modal({ title: 'Conditional formatting rules', width: 600, body: h('div', null, h('p', { class: 'muted small' }, 'Rules higher in the list win when two apply to the same cell.'), host), actions: [
        { label: 'New rule', onClick: () => { this.cfEditor({ type: 'gt', range: this.selRange(true) }, () => this.cfManager()); } },
        { label: 'Done', primary: true }
      ] });
    }

    // ------------------------------------------------ function browser
    functionBrowser() {
      const search = h('input', { class: 'input', placeholder: `Search ${F().functions.length} functions - e.g. "lookup", "date", "filter"` });
      const list = h('div', { class: 'fn-list' });
      const cats = F().CATS;
      let close;
      const insert = (fn) => {
        close();
        if (this.editor) { const ed = this.editor; const p = ed.selectionStart; ed.value = ed.value.slice(0, p) + fn + '(' + ed.value.slice(p); ed.focus(); ed.setSelectionRange(p + fn.length + 1, p + fn.length + 1); this.fx.value = ed.value; }
        else { this.startEdit(`=${fn}(`); }
      };
      const draw = () => {
        list.innerHTML = '';
        const q = search.value.trim().toLowerCase();
        for (const [cat, fns] of Object.entries(cats)) {
          const hits = fns.filter((f) => !q || f.toLowerCase().includes(q) || (F().FN_HELP[f] || '').toLowerCase().includes(q) || cat.toLowerCase().includes(q));
          if (!hits.length) continue;
          list.append(h('div', { class: 'fn-cat' }, cat));
          hits.forEach((f) => { const [d, ex] = (F().FN_HELP[f] || '').split(' · '); list.append(h('div', { class: 'fn-item', onclick: () => insert(f) }, h('b', { class: 'mono' }, f), h('span', null, d || ''), ex ? h('code', null, ex) : null)); });
        }
        if (!list.children.length) list.append(h('div', { class: 'muted', style: { padding: '16px' } }, 'No matching functions'));
      };
      search.addEventListener('input', draw);
      search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); const first = list.querySelector('.fn-item b'); if (first) insert(first.textContent); } });
      draw();
      close = D.modal({ title: 'Functions', width: 720, body: h('div', { class: 'stack' }, search, list) });
    }

    // ------------------------------------------------ structure
    insertRows(at, n) {
      shiftRefs(this.sheet, 'r', at, n);
      for (let i = 0; i < n; i++) this.sheet.cells.splice(at, 0, Array(this.cols).fill(''));
      D.commit(); this.renderGrid(); this.paintSel();
    }
    deleteRows(at, n) {
      this.sheet.merges = (this.sheet.merges || []).filter((m) => { const g = F().parseRange(m); return !(g.r1 >= at && g.r2 < at + n); });
      shiftRefs(this.sheet, 'r', at + n, -n);
      this.sheet.cells.splice(at, n);
      this.ensureSize();
      D.commit(); this.renderGrid(); this.setActive(Math.min(at, this.rows - 1), this.act.c);
    }
    insertCols(at, n) {
      shiftRefs(this.sheet, 'c', at, n);
      this.sheet.cells.forEach((row) => row.splice(at, 0, ...Array(n).fill('')));
      D.commit(); this.renderGrid(); this.paintSel();
    }
    deleteCols(at, n) {
      this.sheet.merges = (this.sheet.merges || []).filter((m) => { const g = F().parseRange(m); return !(g.c1 >= at && g.c2 < at + n); });
      shiftRefs(this.sheet, 'c', at + n, -n);
      this.sheet.cells.forEach((row) => row.splice(at, n));
      this.ensureSize();
      D.commit(); this.renderGrid(); this.setActive(this.act.r, Math.min(at, this.cols - 1));
    }

    // ------------------------------------------------ clipboard
    onCopy(e) {
      if (!this.host.isConnected || D.active() !== this.sheet || this.editor) return false;
      const a = document.activeElement;
      if (a && a !== this.scroller && a !== document.body && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return false;
      let areas = this.areas();
      if (areas.length > 1) {
        const sameRows = areas.every((a) => a.r1 === areas[0].r1 && a.r2 === areas[0].r2);
        if (!sameRows) { D.toast('Copied the last area only - areas must share the same rows to copy together', 'warn'); areas = [this.sel]; }
        else {
          areas = [...areas].sort((a, b) => a.c1 - b.c1);
          const lines = [];
          for (let r = areas[0].r1; r <= areas[0].r2; r++) { if (this.hidden.has(r)) continue; const row = []; areas.forEach((a) => { for (let c = a.c1; c <= a.c2; c++) row.push(F().display(this.sheet, r, c)); }); lines.push(row.join('\t')); }
          e.clipboardData.setData('text/plain', lines.join('\n'));
          e.preventDefault();
          D.toast(`Copied ${areas.length} areas`, 'info', 1400);
          return true;
        }
      }
      const { r1, r2, c1, c2 } = this.sel;
      const lines = [], htmlRows = [];
      for (let r = r1; r <= Math.min(r2, this.rows - 1); r++) {
        if (this.hidden.has(r)) continue;
        const row = [], hr = [];
        for (let c = c1; c <= c2; c++) { const d = F().display(this.sheet, r, c); row.push(d); hr.push(`<td>${D.esc(d)}</td>`); }
        lines.push(row.join('\t')); htmlRows.push(`<tr>${hr.join('')}</tr>`);
      }
      const styles = {};
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const s = this.sheet.styles[r + ',' + c]; if (s) styles[(r - r1) + ',' + (c - c1)] = s; }
      e.clipboardData.setData('text/plain', lines.join('\n'));
      e.clipboardData.setData('text/html', `<table>${htmlRows.join('')}</table>`);
      e.clipboardData.setData('application/x-datum-cells', JSON.stringify({ sheetId: this.sheet.id, sel: this.sel, raw: this.sheet.cells.slice(r1, r2 + 1).map((row) => row.slice(c1, c2 + 1)), styles }));
      e.preventDefault();
      D.toast(`Copied ${F().rangeStr(this.sel)}`, 'info', 1400);
      return true;
    }
    onPaste(e) {
      if (!this.host.isConnected || D.active() !== this.sheet || this.editor) return;
      const a = document.activeElement;
      if (a && a !== this.scroller && a !== document.body && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
      e.preventDefault();
      const internal = e.clipboardData.getData('application/x-datum-cells');
      if (internal) {
        const d = JSON.parse(internal);
        const dr = this.act.r - d.sel.r1, dc = this.act.c - d.sel.c1;
        d.raw.forEach((row, i) => row.forEach((v, j) => {
          const r = this.act.r + i, c = this.act.c + j;
          this.ensureSize(r, c);
          this.sheet.cells[r][c] = String(v).startsWith('=') ? F().offsetFormula(v, dr, dc) : v;
          const st = d.styles && d.styles[i + ',' + j];
          if (st) this.sheet.styles[r + ',' + c] = D.clone(st);
        }));
        this.sel = { r1: this.act.r, c1: this.act.c, r2: this.act.r + d.raw.length - 1, c2: this.act.c + d.raw[0].length - 1 };
        D.commit(); this.renderGrid(); this.paintSel();
        return;
      }
      this.pasteText(e.clipboardData.getData('text/plain'));
    }
    pasteText(text) {
      if (!text) return;
      const rows = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
      rows.forEach((row, i) => row.forEach((v, j) => { this.ensureSize(this.act.r + i, this.act.c + j); this.sheet.cells[this.act.r + i][this.act.c + j] = v; }));
      this.sel = { r1: this.act.r, c1: this.act.c, r2: this.act.r + rows.length - 1, c2: this.act.c + Math.max(...rows.map((r) => r.length)) - 1 };
      D.commit(); this.renderGrid(); this.paintSel();
    }

    quickChart() {
      const range = this.selRange(true);
      const reps = D.project().sheets.filter((s) => s.type === 'report');
      const target = reps[0] || D.app.addSheet('report', { activate: false });
      const link = { sheetId: this.sheet.id, range };
      D.sheetTypes.report.insertLinked(target, { kind: 'chart', chartType: 'bar', link, title: D.links.defaultTitle(link) });
      D.app.activate(target.id);
      D.toast(`Charted ${range} on ${target.name}`, 'ok');
    }
  }
})();
