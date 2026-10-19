// Datum - cross-sheet linking: range picker, insert-from-data, send-to, live values
(function () {
  const h = D.h;
  const L = (D.links = {});
  const F = () => D.f;

  // Detect the populated block around a cell (like Ctrl+A in Excel)
  L.region = (sheet, r, c) => {
    const rows = sheet.cells.length, cols = sheet.cells[0].length;
    const filled = (rr, cc) => rr >= 0 && cc >= 0 && rr < rows && cc < cols && sheet.cells[rr][cc] !== '' && sheet.cells[rr][cc] != null;
    const g = { r1: r, r2: r, c1: c, c2: c };
    let grew = true;
    while (grew) {
      grew = false;
      const rowHas = (rr) => { for (let cc = g.c1; cc <= g.c2; cc++) if (filled(rr, cc)) return true; return false; };
      const colHas = (cc) => { for (let rr = g.r1; rr <= g.r2; rr++) if (filled(rr, cc)) return true; return false; };
      if (rowHas(g.r1 - 1)) { g.r1--; grew = true; }
      if (rowHas(g.r2 + 1)) { g.r2++; grew = true; }
      if (colHas(g.c1 - 1)) { g.c1--; grew = true; }
      if (colHas(g.c2 + 1)) { g.c2++; grew = true; }
    }
    return F().rangeStr(g);
  };
  // The records table on a sheet that also holds summary blocks and helper columns beside it:
  // header row = first row with 2+ typed labels; columns run right from there across labelled columns;
  // rows end at the last row with typed data (formulas filled down past the data don't count).
  L.tableRange = (sheet) => {
    const cells = sheet.cells, R = cells.length;
    if (!R) return null;
    const lit = (v) => v !== '' && v != null && !(typeof v === 'string' && v[0] === '=' && v.length > 1);
    const any = (v) => v !== '' && v != null;
    const label = (v) => typeof v === 'string' && v.trim() !== '' && v[0] !== '=' && isNaN(+v);
    let hr = -1;
    for (let r = 0; r < Math.min(R, 30) && hr < 0; r++) { const row = cells[r] || []; let n = 0; for (const v of row) if (label(v)) n++; if (n >= 2) hr = r; }
    if (hr < 0) return null;
    const head = cells[hr];
    let c1 = head.findIndex((v) => label(v));
    // last row with typed values in the first few header columns
    // rows run down until two rows in a row have nothing typed in the first few columns
    const keyCols = []; for (let c = c1; c < Math.min(head.length, c1 + 4); c++) if (label(head[c])) keyCols.push(c);
    const placeholder = (v) => typeof v === 'string' && /^\s*[-–—.]?\s*$/.test(v); // rows of "-" waiting for data
    const typed = (r) => keyCols.some((c) => lit(cells[r] && cells[r][c]) && !placeholder(cells[r][c]));
    let rN = hr;
    for (let r = hr + 1; r < R; r++) { if (typed(r)) rN = r; else if (r + 1 >= R || !typed(r + 1)) break; }
    if (rN <= hr) return null;
    const fill = (c) => { let n = 0; for (let r = hr + 1; r <= rN; r++) if (any(cells[r] && cells[r][c])) n++; return n / (rN - hr); };
    // labelled columns side by side belong to the table (even sparse ones); past one empty spacer column,
    // a run of 2+ labelled columns ending in another blank column continues it (a summary block is usually
    // one title cell over unlabelled columns, so it doesn't)
    const W = Math.max(...cells.slice(hr, rN + 1).map((row) => (row ? row.length : 0)));
    const blankCol = (c) => c >= W || (!any(head[c]) && fill(c) === 0);
    let c2 = c1, c = c1 + 1;
    while (c < W) {
      if (label(head[c])) { c2 = c++; continue; }
      if (!blankCol(c)) { if ((c + 1 < W && label(head[c + 1]) && fill(c) >= 0.5) || fill(c) >= 0.8) { c2 = c++; continue; } break; } // a filled column missing its header

      let e = c + 1; while (e < W && label(head[e])) e++;
      if (e - (c + 1) >= 2 && blankCol(e) && fill(c + 1) > 0) { c2 = e - 1; c = e; continue; }
      break;
    }
    if (c2 === c1) return null;
    return F().rangeStr({ r1: hr, c1, r2: rN, c2 });
  };
  // The first contiguous table on the sheet (like Excel's current region from its top-left cell)
  L.autoRange = (sheet) => {
    // a sheet with summary blocks or helper formulas beside its records: pick out the records table
    const region = L.firstRegion(sheet);
    let t = null;
    try { t = L.tableRange(sheet); } catch { /* fall back to the plain region */ }
    const g = F().parseRange(region), tg = t && F().parseRange(t);
    if (g && tg && g.areas.length === 1) {
      const a = g.areas[0], b = tg.areas[0];
      if (b.r1 >= a.r1 && b.r1 <= a.r2 && b.c1 >= a.c1 && b.c1 <= a.c2) return t;
    }
    return region;
  };
  L.firstRegion = (sheet) => {
    for (let r = 0; r < sheet.cells.length; r++) for (let c = 0; c < sheet.cells[r].length; c++) {
      if (sheet.cells[r][c] !== '' && sheet.cells[r][c] != null) return L.region(sheet, r, c);
    }
    return 'A1:B5';
  };
  L.usedRange = (sheet) => {
    let maxR = -1, maxC = -1;
    sheet.cells.forEach((row, r) => row.forEach((v, c) => { if (v !== '' && v != null) { maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); } }));
    return maxR < 0 ? 'A1' : F().rangeStr({ r1: 0, c1: 0, r2: maxR, c2: maxC });
  };

  // ------------------------------------------------ mini grid used by pickers
  function miniGrid(sheet, range, onPick) {
    const wrap = h('div', { class: 'mini-grid' });
    const g0 = F().parseRange(range);
    const used = F().parseRange(L.usedRange(sheet));
    const rows = Math.min(Math.max((used ? used.r2 : 10) + 4, 12), 300);
    const cols = Math.min(Math.max((used ? used.c2 : 6) + 2, 8), 40);
    const t = h('table');
    const head = h('tr', null, h('th', { class: 'corner' }));
    for (let c = 0; c < cols; c++) head.append(h('th', null, F().colName(c)));
    t.append(head);
    const cells = [];
    for (let r = 0; r < rows; r++) {
      const tr = h('tr', null, h('th', null, r + 1));
      cells[r] = [];
      for (let c = 0; c < cols; c++) {
        const td = h('td', { dataset: { r, c } }, F().display(sheet, r, c));
        cells[r][c] = td;
        tr.append(td);
      }
      t.append(tr);
    }
    wrap.append(t);
    let a = null;
    let areas = g0 ? g0.areas.map((x) => ({ ...x })) : [];
    const paint = () => cells.forEach((row, r) => row.forEach((td, c) => td.classList.toggle('in', F().inAreas(areas, r, c))));
    paint();
    t.addEventListener('mousedown', (e) => {
      const td = e.target.closest('td'); if (!td) return;
      e.preventDefault();
      a = { r: +td.dataset.r, c: +td.dataset.c };
      const keep = (e.ctrlKey || e.metaKey) ? areas : [];
      const cur = { r1: a.r, c1: a.c, r2: a.r, c2: a.c };
      areas = [...keep, cur];
      paint(); onPick(F().areasStr(areas));
      let last = null, raf = null;
      const host = wrap.parentElement || wrap;
      const at = (x, y) => {
        const rect = host.getBoundingClientRect();
        const el = document.elementFromPoint(D.clamp(x, rect.left + 40, rect.right - 12), D.clamp(y, rect.top + 26, rect.bottom - 12));
        const td2 = el && el.closest && el.closest('.mini-grid td');
        if (!td2) return;
        const b = { r: +td2.dataset.r, c: +td2.dataset.c };
        Object.assign(cur, { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) });
        paint(); onPick(F().areasStr(areas));
      };
      const tick = () => {
        raf = null; if (!last) return;
        const rect = host.getBoundingClientRect();
        let dy = 0, dx = 0;
        if (last.y > rect.bottom - 20) dy = Math.min(30, (last.y - rect.bottom + 20) / 2 + 4); else if (last.y < rect.top + 30) dy = -Math.min(30, (rect.top + 30 - last.y) / 2 + 4);
        if (last.x > rect.right - 20) dx = Math.min(30, (last.x - rect.right + 20) / 2 + 4); else if (last.x < rect.left + 40) dx = -Math.min(30, (rect.left + 40 - last.x) / 2 + 4);
        if (dx || dy) { host.scrollTop += dy; host.scrollLeft += dx; at(last.x, last.y); raf = requestAnimationFrame(tick); }
      };
      const mv = (e2) => { last = { x: e2.clientX, y: e2.clientY }; at(last.x, last.y); if (!raf) raf = requestAnimationFrame(tick); };
      const up = () => { last = null; window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    });
    wrap.setRange = (r) => { const g = F().parseRange(r); areas = g ? g.areas.map((x) => ({ ...x })) : []; paint(); };
    return wrap;
  }

  function sheetSelect(sheetId, onChange) {
    const ds = D.dataSheets();
    const s = h('select', { class: 'input' }, ds.map((x) => h('option', { value: x.id, selected: x.id === sheetId ? true : null }, x.name)));
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  function requireData() {
    if (!D.dataSheets().length) {
      D.toast('Add a Data Sheet first - that is where linked numbers live.', 'warn');
      return false;
    }
    return true;
  }

  // ------------------------------------------------ insert-from-data dialog
  // returns { kind, chartType, link, title, expr, label }
  L.insertDialog = ({ kind = 'chart', link = null, allowKinds = ['chart', 'table', 'kpi'], title = 'Insert from data' } = {}) => new Promise((resolve) => {
    if (!requireData()) return resolve(null);
    const active = D.active();
    let sheetId = (link && link.sheetId) || (active && active.type === 'data' ? active.id : D.dataSheets()[0].id);
    let range = (link && link.range) || L.autoRange(D.sheet(sheetId));
    let chartType = 'bar';
    let chartTitle = '';
    let done = false;
    const kinds = { chart: 'Chart', table: 'Table', kpi: 'KPI card', value: 'Live value' };
    const kindSeg = h('div', { class: 'seg' });
    const chartSeg = h('div', { class: 'chart-types' });
    const preview = h('div', { class: 'insert-preview' });
    const rangeIn = h('input', { class: 'input mono', value: range });
    const titleIn = h('input', { class: 'input', placeholder: 'Optional title', value: '' });
    let grid;
    const gridHost = h('div', { class: 'grid-host' });
    const buildGrid = () => { gridHost.innerHTML = ''; grid = miniGrid(D.sheet(sheetId), range, (r) => { range = r; rangeIn.value = r; refresh(); }); gridHost.append(grid); };
    const refresh = () => {
      kindSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === kind));
      chartSeg.style.display = kind === 'chart' ? '' : 'none';
      chartSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === chartType));
      preview.innerHTML = '';
      const ln = { sheetId, range };
      if (kind === 'chart') {
        const host = h('div', { style: { width: '100%', height: '100%' } });
        preview.append(host);
        D.charts.render(host, { chartType, link: ln, title: titleIn.value }, { w: 380, h: 220, scale: 0.8 });
      } else if (kind === 'table') {
        const e = { type: 'table', link: ln, x: 0, y: 0, w: 380, h: 220, style: { fontSize: 9 } };
        const n = D.renderElementContent(h('div'), e, {});
        n.style.position = 'relative'; n.style.left = n.style.top = '0';
        preview.append(n);
      } else {
        const v = F().displayExpr(defaultExpr(ln));
        preview.append(h('div', { class: 'kpi-preview' }, h('div', { class: 'kpi-label' }, titleIn.value || defaultLabel(ln)), h('div', { class: 'kpi-value' }, v), h('div', { class: 'muted small mono' }, defaultExpr(ln))));
      }
    };
    allowKinds.forEach((k) => kindSeg.append(h('button', { dataset: { k }, onclick: () => { kind = k; refresh(); } }, kinds[k])));
    D.charts.TYPES.forEach((t) => chartSeg.append(h('button', { dataset: { t: t.id }, title: t.label, onclick: () => { chartType = t.id; refresh(); }, html: D.icon(t.icon, 15) + `<span>${t.label}</span>` })));
    rangeIn.addEventListener('change', () => { if (F().parseRange(rangeIn.value)) { range = rangeIn.value.toUpperCase().replace(/\s+/g, ''); grid.setRange(range); refresh(); } });
    titleIn.addEventListener('input', D.debounce(refresh, 200));
    const body = h('div', { class: 'insert-dlg' },
      h('div', { class: 'insert-left' },
        h('div', { class: 'field' }, h('label', null, 'Data sheet'), sheetSelect(sheetId, (v) => { sheetId = v; range = L.autoRange(D.sheet(v)); rangeIn.value = range; buildGrid(); refresh(); })),
        h('div', { class: 'field' }, h('label', null, 'Range - drag on the grid · Ctrl/⌘-click to add columns'), rangeIn),
        gridHost),
      h('div', { class: 'insert-right' },
        allowKinds.length > 1 ? h('div', { class: 'field' }, h('label', null, 'Show as'), kindSeg) : null,
        chartSeg,
        h('div', { class: 'field' }, h('label', null, 'Title'), titleIn),
        h('div', { class: 'field grow' }, h('label', null, 'Preview · stays linked to the data'), preview)));
    buildGrid();
    refresh();
    D.modal({ title, body, width: 920, className: 'wide', onClose: () => { if (!done) resolve(null); }, actions: [
      { label: 'Cancel' },
      { label: 'Insert', primary: true, onClick: () => {
        done = true;
        const ln = { sheetId, range };
        resolve({ kind, chartType, link: ln, title: titleIn.value.trim(), expr: defaultExpr(ln), label: titleIn.value.trim() || defaultLabel(ln) });
      } }
    ] });
  });

  function defaultExpr(link) {
    const sh = D.sheet(link.sheetId);
    const all = F().parseRange(link.range);
    const g = all.areas[all.areas.length - 1];
    const q = F().quoteSheet(sh.name);
    if (g.r1 === g.r2 && g.c1 === g.c2) return `=${q}!${F().addr(g.r1, g.c1)}`;
    // skip a text header row
    const first = F().cellValue(sh, g.r1, g.c2);
    const r1 = typeof first === 'string' && first !== '' && g.r2 > g.r1 ? g.r1 + 1 : g.r1;
    return `=SUM(${q}!${F().rangeStr({ r1, c1: g.c2, r2: g.r2, c2: g.c2 })})`;
  }
  function defaultLabel(link) {
    const sh = D.sheet(link.sheetId);
    const all = F().parseRange(link.range);
    const g = all.areas[all.areas.length - 1];
    const head = F().cellValue(sh, g.r1, g.c2);
    if (g.r1 !== g.r2 && typeof head === 'string' && head) return `Total ${head}`;
    if (g.r1 === g.r2 && g.c1 === g.c2 && g.c1 > 0) {
      const left = F().cellValue(sh, g.r1, g.c1 - 1);
      if (typeof left === 'string' && left) return left;
    }
    return 'Metric';
  }
  L.defaultExpr = defaultExpr;
  L.defaultLabel = defaultLabel;

  // ------------------------------------------------ simple range picker
  L.pickRange = (link, title = 'Choose data range') => L.insertDialog({ link, allowKinds: [], title }).then((r) => r && r.link);

  L.pickRangeOnly = (link, title = 'Choose data range') => new Promise((resolve) => {
    if (!requireData()) return resolve(null);
    let sheetId = (link && D.sheet(link.sheetId) && link.sheetId) || D.dataSheets()[0].id;
    let range = (link && link.range) || L.autoRange(D.sheet(sheetId));
    let done = false;
    const rangeIn = h('input', { class: 'input mono', value: range });
    const gridHost = h('div', { class: 'grid-host tall' });
    let grid;
    const build = () => { gridHost.innerHTML = ''; grid = miniGrid(D.sheet(sheetId), range, (r) => { range = r; rangeIn.value = r; }); gridHost.append(grid); };
    rangeIn.addEventListener('change', () => { if (F().parseRange(rangeIn.value)) { range = rangeIn.value.toUpperCase(); grid.setRange(range); } });
    build();
    D.modal({ title, width: 760, onClose: () => { if (!done) resolve(null); }, body: h('div', { class: 'stack' },
      h('div', { class: 'row2' }, h('div', { class: 'field' }, h('label', null, 'Data sheet'), sheetSelect(sheetId, (v) => { sheetId = v; range = L.autoRange(D.sheet(v)); rangeIn.value = range; build(); })), h('div', { class: 'field' }, h('label', null, 'Range'), rangeIn)),
      gridHost), actions: [{ label: 'Cancel' }, { label: 'Use range', primary: true, onClick: () => { done = true; resolve({ sheetId, range }); } }] });
  });

  // ------------------------------------------------ live value (token) builder
  L.pickToken = (cb) => {
    if (!requireData()) return;
    let sheetId = (D.active() && D.active().type === 'data' ? D.active().id : D.dataSheets()[0].id);
    let range = 'B2';
    let agg = 'value';
    const out = h('div', { class: 'token-out mono' });
    const val = h('div', { class: 'token-val' });
    const rangeIn = h('input', { class: 'input mono', value: range });
    const gridHost = h('div', { class: 'grid-host' });
    let grid;
    const expr = () => {
      const q = F().quoteSheet(D.sheet(sheetId).name);
      const g = F().parseRange(range);
      const single = g && g.r1 === g.r2 && g.c1 === g.c2;
      if (agg === 'value' || single) return `${q}!${F().addr(g.r1, g.c1)}`;
      return `${agg.toUpperCase()}(${q}!${range})`;
    };
    const refresh = () => { out.textContent = `{{${expr()}}}`; val.textContent = F().displayExpr(expr()); };
    const build = () => { gridHost.innerHTML = ''; grid = miniGrid(D.sheet(sheetId), range, (r) => { range = r; rangeIn.value = r; refresh(); }); gridHost.append(grid); };
    rangeIn.addEventListener('change', () => { if (F().parseRange(rangeIn.value)) { range = rangeIn.value.toUpperCase().replace(/\s+/g, ''); grid.setRange(range); refresh(); } });
    const aggSel = h('select', { class: 'input' }, [['value', 'Cell value'], ['sum', 'Sum'], ['average', 'Average'], ['min', 'Min'], ['max', 'Max'], ['count', 'Count'], ['last', 'Latest (last value)']].map(([v, l]) => h('option', { value: v }, l)));
    aggSel.addEventListener('change', () => { agg = aggSel.value; refresh(); });
    build(); refresh();
    D.modal({ title: 'Insert live value', width: 760, body: h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, 'A live value is a small formula in your text. It recalculates whenever the data changes, and is written as plain text when you save.'),
      h('div', { class: 'row3' },
        h('div', { class: 'field' }, h('label', null, 'Data sheet'), sheetSelect(sheetId, (v) => { sheetId = v; build(); refresh(); })),
        h('div', { class: 'field' }, h('label', null, 'Cell or range'), rangeIn),
        h('div', { class: 'field' }, h('label', null, 'Show'), aggSel)),
      gridHost,
      h('div', { class: 'token-preview' }, out, h('span', { html: D.icon('right', 14) }), val)),
      actions: [{ label: 'Cancel' }, { label: 'Insert', primary: true, onClick: () => cb(`{{${expr()}}}`, expr()) }] });
  };

  // ------------------------------------------------ send a selected range somewhere
  L.sendTo = (anchor, sheetId, range) => {
    const p = D.project();
    const targets = p.sheets.filter((s) => s.type !== 'data');
    const reps = (spec) => [
      { header: 'Show as' },
      { label: 'Chart', icon: 'chart', sub: D.charts.TYPES.map((t) => ({ label: t.label, icon: t.icon, onClick: () => spec({ kind: 'chart', chartType: t.id }) })) },
      { label: 'Table', icon: 'table', onClick: () => spec({ kind: 'table' }) },
      { label: 'KPI card', icon: 'kpi', onClick: () => spec({ kind: 'kpi' }) },
      { label: 'Live value (text)', icon: 'zap', onClick: () => spec({ kind: 'value' }) }
    ];
    const go = (target, extra) => (rep) => {
      const link = { sheetId, range };
      const spec = { ...rep, link, expr: defaultExpr(link), label: defaultLabel(link), title: rep.kind === 'chart' ? defaultTitle(link) : '' , ...extra };
      let sh = target;
      if (typeof target === 'string') {
        sh = D.app.addSheet(target, { activate: false });
      }
      D.sheetTypes[sh.type].insertLinked(sh, spec);
      D.app.activate(sh.id);
      D.toast(`Linked ${D.sheet(sheetId).name} ${range} → ${sh.name}`, 'ok');
    };
    const items = [
      { header: `Send ${range} to…` },
      ...targets.map((t) => ({
        label: t.name, icon: D.TYPE_META[t.type].icon,
        sub: t.type === 'slide'
          ? [{ label: 'Current slide', icon: 'slide', sub: reps(go(t, { where: 'current' })) }, { label: 'New slide', icon: 'plus', sub: reps(go(t, { where: 'new' })) }]
          : reps(go(t))
      })),
      targets.length ? { sep: true } : null,
      { label: 'New Slide Sheet', icon: 'slide', sub: reps(go('slide', { where: 'new' })) },
      { label: 'New Report Sheet', icon: 'report', sub: reps(go('report')) },
      { label: 'New Docu Sheet', icon: 'docu', sub: reps(go('docu')) }
    ];
    D.menu(anchor, items);
  };
  function defaultTitle(link) {
    const sh = D.sheet(link.sheetId);
    const top = (F().linkRows(link, { display: false }) || [[]])[0];
    const heads = top.slice(1).filter((v) => typeof v === 'string' && v);
    const first = top[0];
    if (heads.length === 1) return typeof first === 'string' && first ? `${heads[0]} by ${first}` : heads[0];
    if (heads.length > 1) return heads.slice(0, 3).join(' vs ');
    return sh.name;
  }
  L.defaultTitle = defaultTitle;

  // ------------------------------------------------ make imported static data editable
  L.extractStatic = (e, done) => {
    let rows;
    if (e.staticData) {
      rows = [['', ...e.staticData.series.map((s) => s.name)], ...e.staticData.labels.map((l, i) => [l, ...e.staticData.series.map((s) => (s.values[i] == null ? '' : String(s.values[i])))])];
    } else rows = e.staticRows;
    if (!rows) return;
    const sh = D.app.addSheet('data', { activate: false, name: D.uniqueSheetName(e.title || (e.type === 'chart' ? 'Chart data' : 'Table data')) });
    rows.forEach((r, i) => r.forEach((v, j) => { while (sh.cells.length <= i) sh.cells.push(Array(sh.cells[0].length).fill('')); sh.cells[i][j] = String(v ?? ''); }));
    rows[0].forEach((_, j) => { sh.styles[`0,${j}`] = { b: true }; });
    e.link = { sheetId: sh.id, range: F().rangeStr({ r1: 0, c1: 0, r2: rows.length - 1, c2: rows[0].length - 1 }) };
    delete e.staticData; delete e.staticRows;
    D.dataVersion++;
    D.app.renderTabs();
    D.toast(`Created “${sh.name}” - edit it there and this ${e.type} follows.`, 'ok');
    done && done();
  };
})();
