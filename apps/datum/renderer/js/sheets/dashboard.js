// Datum - Dashboard Sheet: a grid of widgets (KPIs, charts, tables, date range and filters) over one or more
// Data Sheets or a data set. Filters apply to every widget, so a year of data can be sliced live.
(function () {
  const h = D.h;
  const F = () => D.f;
  const DS = () => D.dash;
  const COLS = 12, ROW = 44, GAP = 12;
  const DAY = 86400000;

  // =================================================================== data engine
  const E = (D.board = {});
  const SHEETISH = /^(worksheet|worksheet tab|sheet|file|file ?name|source file)$/i, SOURCEISH = /^source$/i;
  const tableCache = new Map();
  E.table = (sheet) => {
    const ids = (sheet.sources || []).filter((id) => D.sheet(id));
    const key = ids.join('|') + ':' + D.dataVersion + ':' + (sheet.dedupe || '');
    if (tableCache.has(key)) return tableCache.get(key);
    const cols = new Map(); const rows = [];
    const multi = ids.length > 1;
    for (const id of ids) {
      const s = D.sheet(id);
      let p;
      try { p = DS().profile(s, D.links.autoRange(s)); } catch { continue; }
      for (const c of p.cols) {
        if (!cols.has(c.name)) cols.set(c.name, { name: c.name, type: c.type === 'date' ? 'date' : c.type === 'number' ? 'number' : 'text', role: c.role, fmt: c.fmt, money: c.money, lowerBetter: c.lowerBetter, derived: c.derived ? { a: c.derived.a.name, b: c.derived.b.name, k: c.derived.k, kind: c.derived.kind } : null, distinct: c.distinct });
      }
      for (let i = 0; i < p.n; i++) {
        const row = {};
        for (const c of p.cols) {
          let v = c.vals[i];
          if (cols.get(c.name).type === 'date') { const d = F().toDate(v); v = d ? d.getTime() : null; }
          row[c.name] = v;
        }
        if (multi) row.__sheet = s.wsName || s.name;
        rows.push(row);
      }
    }
    if (multi) cols.set('__sheet', { name: '__sheet', label: 'Sheet', type: 'text', role: 'dimension', distinct: ids.length });
    // the column that names each record (Object Number, Order ID, Email…) and how many rows repeat it
    const idc = idColumn([...cols.values()], rows);
    let allRows = rows, dupExtra = 0;
    if (idc) {
      const seen = new Set(); const keep = [];
      for (const r of rows) { const v = r[idc.name]; if (v === '' || v == null || /^\s*[-–—.]?\s*$/.test(String(v))) { keep.push(r); continue; } const k = String(v).trim().toLowerCase(); if (seen.has(k)) { dupExtra++; continue; } seen.add(k); keep.push(r); }
      if (sheet.dedupe === idc.name) allRows = keep;
    }
    const t = { cols: [...cols.values()], rows: allRows, byName: Object.fromEntries([...cols.entries()]), idCol: idc ? idc.name : null, dupExtra, totalRows: rows.length };
    t.dateCols = t.cols.filter((c) => c.type === 'date' && (c.role === 'time' || (c.distinct || 0) >= 3));
    t.metrics = t.cols.filter((c) => c.type === 'number' && ['measure', 'ratio'].includes(c.role));
    t.groupCols = t.cols.filter((c) => c.type === 'text' && ['dimension', 'entity', 'label'].includes(c.role));
    // several sheets: the Sheet filter is the tab; a "Source" column in the records is just a field then
    t.sheetCols = multi ? t.cols.filter((c) => c.name === '__sheet') : (t.cols.some((c) => SHEETISH.test(c.name)) ? t.cols.filter((c) => SHEETISH.test(c.name)) : t.cols.filter((c) => SOURCEISH.test(c.name) && (c.distinct || 0) <= 60)).sort((a, b) => (b.distinct || 0) - (a.distinct || 0));
    t.cols.forEach((c) => { let n = 0; for (const r of rows) if (r[c.name] !== '' && r[c.name] != null) n++; c.fill = rows.length ? n / rows.length : 0; });
    t.periodCols = t.cols.filter((c) => c.role === 'time' && c.type !== 'date'); // "Aug 4", "Week 12", 2024… kept in data order
    t.metrics.forEach((c) => { const xs = rows.map((r) => r[c.name]).filter((v) => typeof v === 'number'); c.max = xs.length ? Math.max(...xs.map(Math.abs)) : 0; });
    t.maxDate = Math.max(...t.dateCols.flatMap((c) => rows.map((r) => r[c.name]).filter((v) => v != null)), -Infinity);
    t.minDate = Math.min(...t.dateCols.flatMap((c) => rows.map((r) => r[c.name]).filter((v) => v != null)), Infinity);
    tableCache.clear(); tableCache.set(key, t);
    return t;
  };
  const label = (c) => (c ? c.label || c.name : '');
  const ID_RE = /(\bid\b|_id$|^id$|number|\bno\.?$|#|code$|email|account|order|invoice|ticket|sku|serial|reference|object|customer)/i;
  function idColumn(cols, rows) {
    let best = null, bestScore = 0;
    for (const c of cols) {
      if (c.name === '__sheet' || c.type === 'date' || !ID_RE.test(c.name) || /referral|promo|zip|postal|phone|mobile/i.test(c.name)) continue;
      let n = 0; const set = new Set();
      for (const r of rows) { const v = r[c.name]; if (v === '' || v == null || /^\s*[-–—.]?\s*$/.test(String(v))) continue; n++; set.add(String(v).trim().toLowerCase()); }
      if (n < Math.max(2, rows.length * 0.6)) continue;
      const ratio = set.size / n;
      if (ratio < 0.6) continue;
      const score = ratio + n / rows.length;
      if (score > bestScore) { best = c; bestScore = score; }
    }
    return best;
  }
  // tabs imported from the same workbook that hold the same kind of table (one tab per week, month…)
  const bookOf = (s) => (s.wsName && String(s.name).includes(' · ') ? String(s.name).split(' · ')[0] : null);
  const headerOf = (s) => { try { const t = D.links.tableRange(s) || D.links.autoRange(s); const g = F().parseRange(t).areas[0]; return (s.cells[g.r1] || []).slice(g.c1, g.c2 + 1).map((v) => String(v ?? '').trim().toLowerCase()).filter(Boolean); } catch { return []; } };
  E.siblings = (s) => {
    const book = bookOf(s); if (!book) return [];
    const mine = new Set(headerOf(s)); if (!mine.size) return [];
    return D.dataSheets().filter((x) => !x.calcOf && !x.hidden && bookOf(x) === book).filter((x) => { const hd = headerOf(x); const shared = hd.filter((k) => mine.has(k)).length; return x === s || shared >= Math.min(mine.size, hd.length) * 0.5; });
  };

  // ---- dates
  const startOfDay = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const PRESETS = [
    ['all', 'All time'], ['ytd', 'Year to date'], ['thisYear', 'This year'], ['lastYear', 'Last year'],
    ['thisQuarter', 'This quarter'], ['lastQuarter', 'Last quarter'], ['thisMonth', 'This month'], ['lastMonth', 'Last month'],
    ['last7', 'Last 7 days'], ['last30', 'Last 30 days'], ['last90', 'Last 90 days'], ['last12m', 'Last 12 months'], ['custom', 'Custom range']
  ];
  // relative ranges count back from today, or from the newest date in the data when the data is historical
  E.anchor = (t) => { const today = startOfDay(Date.now()); return isFinite(t.maxDate) && t.maxDate < today - 30 * DAY ? startOfDay(t.maxDate) : today; };
  E.range = (preset, anchorMs, from, to) => {
    const a = new Date(anchorMs), y = a.getFullYear(), m = a.getMonth(), q = Math.floor(m / 3) * 3;
    const T = (yy, mm, dd) => new Date(yy, mm, dd).getTime();
    switch (preset) {
      case 'ytd': return [T(y, 0, 1), anchorMs];
      case 'thisYear': return [T(y, 0, 1), T(y, 11, 31)];
      case 'lastYear': return [T(y - 1, 0, 1), T(y - 1, 11, 31)];
      case 'thisQuarter': return [T(y, q, 1), T(y, q + 3, 0)];
      case 'lastQuarter': return [T(y, q - 3, 1), T(y, q, 0)];
      case 'thisMonth': return [T(y, m, 1), T(y, m + 1, 0)];
      case 'lastMonth': return [T(y, m - 1, 1), T(y, m, 0)];
      case 'last7': return [anchorMs - 6 * DAY, anchorMs];
      case 'last30': return [anchorMs - 29 * DAY, anchorMs];
      case 'last90': return [anchorMs - 89 * DAY, anchorMs];
      case 'last12m': return [T(y, m - 11, 1), T(y, m + 1, 0)];
      case 'custom': return [from ? startOfDay(F().toDate(from).getTime()) : -Infinity, to ? startOfDay(F().toDate(to).getTime()) : Infinity];
      default: return null;
    }
  };
  const fmtDate = (ms, opts = { month: 'short', day: 'numeric', year: 'numeric' }) => new Date(ms).toLocaleDateString(undefined, opts);

  // ---- filters (stored on the sheet so they save with the project)
  const filtersOf = (sheet) => (sheet.filters ||= { date: null, vals: {} });
  E.activeRange = (sheet, t) => {
    const f = filtersOf(sheet).date;
    if (!f || !f.preset || f.preset === 'all' || !t.byName[f.col]) return null;
    const r = E.range(f.preset, E.anchor(t), f.from, f.to);
    return r ? { col: f.col, from: r[0], to: r[1] } : null;
  };
  E.rows = (sheet, t, { skip = null, range = undefined } = {}) => {
    const f = filtersOf(sheet);
    const r = range === undefined ? E.activeRange(sheet, t) : range;
    const vals = Object.entries(f.vals || {}).filter(([c, list]) => c !== skip && list && list.length && t.byName[c]);
    return t.rows.filter((row) => {
      if (r) { const v = row[r.col]; if (v == null || v < r.from || v > r.to) return false; }
      for (const [c, list] of vals) if (!list.includes(String(row[c] ?? ''))) return false;
      return true;
    });
  };
  E.previousRange = (sheet, t) => {
    const r = E.activeRange(sheet, t);
    if (!r || !isFinite(r.from) || !isFinite(r.to)) return null;
    const len = r.to - r.from + DAY;
    return { col: r.col, from: r.from - len, to: r.from - DAY };
  };

  // ---- aggregation
  const nums = (rows, c) => rows.map((r) => r[c]).filter((v) => typeof v === 'number' && isFinite(v));
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  E.agg = (rows, col, how = 'auto') => {
    if (!col) return rows.length; // no column: count the records
    if (how === 'count') return rows.filter((r) => r[col.name] !== '' && r[col.name] != null).length;
    if (how === 'distinct') return new Set(rows.map((r) => r[col.name]).filter((v) => v !== '' && v != null)).size;
    if (how === 'auto' && col.derived) {
      const A = sum(nums(rows, col.derived.a)), B = sum(nums(rows, col.derived.b));
      if (col.derived.kind === 'margin') return A ? (A - B) / A * (col.derived.k || 1) : null;
      return B ? A / B * (col.derived.k || 1) : null;
    }
    const xs = nums(rows, col.name);
    if (!xs.length) return null;
    if (how === 'min') return Math.min(...xs);
    if (how === 'max') return Math.max(...xs);
    if (how === 'avg' || (how === 'auto' && col.role === 'ratio')) return sum(xs) / xs.length;
    return sum(xs);
  };
  E.fmtOf = (col, v) => {
    if (!col) return 'int';
    if (col.fmt === 'pct') return 'pct';
    if (col.money || /^(cur|acct)/.test(col.fmt || '')) return Math.abs(v ?? col.max ?? 0) >= 1000 || (col.role !== 'ratio' && (v == null || Number.isInteger(v) || Math.abs(v) >= 100)) ? 'cur0' : 'cur';
    if (col.fmt) return col.fmt;
    return col.role === 'ratio' || (typeof v === 'number' && !Number.isInteger(v)) ? 'num' : 'int';
  };
  E.fmt = (col, v) => (v == null || !isFinite(v) ? '-' : F().format(v, Math.abs(v) >= 1e6 && !(col && col.fmt === 'pct') ? 'compact' : E.fmtOf(col, v)));

  // ---- grouping
  const bucketOf = (span) => (span <= 45 * DAY ? 'day' : span <= 200 * DAY ? 'week' : span <= 1100 * DAY ? 'month' : span <= 2600 * DAY ? 'quarter' : 'year');
  // the coarser of "what fits the span" and "how often the data is recorded" (monthly files stay monthly)
  const ORDER = ['day', 'week', 'month', 'quarter', 'year'];
  const autoBucket = (vals) => {
    const span = Math.max(...vals) - Math.min(...vals);
    const days = [...new Set(vals.map(startOfDay))].sort((a, b) => a - b);
    let gap = Infinity; for (let i = 1; i < days.length; i++) gap = Math.min(gap, days[i] - days[i - 1]);
    const firsts = days.every((d) => new Date(d).getDate() === 1);
    const grain = gap >= 360 * DAY ? 'year' : gap >= 89 * DAY && firsts ? 'quarter' : gap >= 28 * DAY && firsts ? 'month' : gap >= 7 * DAY ? 'week' : 'day';
    const bySpan = bucketOf(span);
    return ORDER[Math.max(ORDER.indexOf(grain), ORDER.indexOf(bySpan))];
  };
  const bucketKey = (ms, b) => {
    const d = new Date(ms);
    if (b === 'day') return startOfDay(ms);
    if (b === 'week') { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)); return x.getTime(); }
    if (b === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    if (b === 'quarter') return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime();
    return new Date(d.getFullYear(), 0, 1).getTime();
  };
  const bucketLabel = (ms, b) => { const d = new Date(ms); return b === 'day' ? fmtDate(ms, { month: 'short', day: 'numeric' }) : b === 'week' ? 'Wk ' + fmtDate(ms, { month: 'short', day: 'numeric' }) : b === 'month' ? fmtDate(ms, { month: 'short', year: '2-digit' }) : b === 'quarter' ? `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}` : String(d.getFullYear()); };
  // returns [{ key, label, rows }]
  E.group = (rows, t, by, opt = {}) => {
    if (by === '@date') {
      const dc = t.byName[opt.dateCol] || t.dateCols[0];
      if (!dc) return [];
      const vals = rows.map((r) => r[dc.name]).filter((v) => v != null);
      if (!vals.length) return [];
      const b = !opt.bucket || opt.bucket === 'auto' ? autoBucket(vals) : opt.bucket;
      const m = new Map();
      rows.forEach((r) => { const v = r[dc.name]; if (v == null) return; const k = bucketKey(v, b); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
      return [...m.entries()].sort((a, b2) => a[0] - b2[0]).map(([k, rs]) => ({ key: k, label: bucketLabel(k, b), rows: rs }));
    }
    const c = t.byName[by];
    if (!c) return [{ key: 'all', label: 'All', rows }];
    const m = new Map();
    rows.forEach((r) => { const k = String(r[c.name] ?? ''); if (k === '') return; if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
    return [...m.entries()].map(([k, rs]) => ({ key: k, label: k, rows: rs }));
  };

  // ---- what a chart shows: groups along one axis, one series per metric or per value of a "split" column
  E.chartData = (w, t, rows, dateCol) => {
    const m = t.byName[w.metric], m2 = t.byName[w.metric2];
    const how = w.how || 'auto';
    if (w.chartType === 'scatter') {
      const lab = t.byName[w.by] || t.groupCols.find((c) => c.role === 'entity');
      const gs = lab ? E.group(rows, t, lab.name) : rows.map((r, i) => ({ label: String(i + 1), rows: [r] }));
      return { labels: gs.map((g) => g.label), series: [{ name: label(m), values: gs.map((g) => E.agg(g.rows, m, 'auto')) }, { name: label(m2 || m), values: gs.map((g) => E.agg(g.rows, m2 || m, 'auto')) }] };
    }
    const round = ['doughnut', 'pie'].includes(w.chartType);
    const split = !round && w.split && w.split !== w.by && t.byName[w.split] ? t.byName[w.split] : null;
    let gs = E.group(rows, t, w.by || '@date', { bucket: w.bucket, dateCol });
    const val = (rs, c) => E.agg(rs, c, how);
    if (w.by !== '@date') {
      gs = gs.map((g) => ({ ...g, v: val(g.rows, m) }));
      if (w.sort !== 'order') gs.sort((a, b) => (w.sort === 'asc' ? a.v - b.v : w.sort === 'label' ? String(a.label).localeCompare(String(b.label), undefined, { numeric: true }) : b.v - a.v));
      const top = w.top || 0;
      if (top && gs.length > top) {
        const rest = gs.slice(top);
        gs = gs.slice(0, top);
        if (round && (!m || m.role === 'measure')) gs.push({ label: `Other (${rest.length})`, rows: rest.flatMap((g) => g.rows) });
      }
    }
    let series;
    if (split) {
      // one series per value of the split column (the biggest ones; the rest become "Other")
      const key = (r) => String(r[split.name] ?? '');
      const order = E.group(rows, t, split.name).map((g) => ({ label: g.label, v: val(g.rows, m) })).sort((a, b) => (b.v ?? 0) - (a.v ?? 0));
      const maxS = w.splitTop || 8;
      const keep = order.slice(0, maxS).map((x) => x.label);
      const keepSet = new Set(keep);
      series = keep.map((lab) => ({ name: lab, values: gs.map((g) => val(g.rows.filter((r) => key(r) === lab), m) ?? 0) }));
      if (order.length > maxS) series.push({ name: `Other (${order.length - maxS})`, values: gs.map((g) => val(g.rows.filter((r) => key(r) !== '' && !keepSet.has(key(r))), m) ?? 0) });
      // series with nothing in the groups shown (after filters / top N) just clutter the legend
      const nz = series.filter((x) => x.values.some((v) => v));
      if (nz.length) series = nz;
    } else {
      series = [{ name: measureLabel(w, t), values: gs.map((g) => val(g.rows, m)) }];
      if (m2) series.push({ name: label(m2), values: gs.map((g) => E.agg(g.rows, m2, 'auto')) });
    }
    // show as a share: of each group (100% stacked) when split, otherwise of the whole
    if (w.showAs === 'pct') {
      if (split) gs.forEach((_, i) => { const tot = series.reduce((a, s2) => a + (s2.values[i] || 0), 0); series.forEach((s2) => { s2.values[i] = tot ? (s2.values[i] || 0) / tot : 0; }); });
      else series.forEach((s2) => { const tot = s2.values.reduce((a, v) => a + (v || 0), 0); s2.values = s2.values.map((v) => (tot ? (v || 0) / tot : 0)); });
    }
    return { labels: gs.map((g) => g.label), series, pct: w.showAs === 'pct' };
  };
  // where a widget's numbers come from, in words
  const measureLabel = (w, t) => {
    const m = t.byName[w.metric];
    if (!m) return 'Records';
    if (w.how === 'distinct') return `Different ${plural(label(m).toLowerCase())}`;
    if (w.how === 'count') return `${label(m)} (count)`;
    return label(m);
  };
  // a widget can count only some rows ("Source is D2D")
  E.where = (rows, w) => {
    const wh = w && w.where;
    if (!wh || !wh.col || !wh.vals || !wh.vals.length) return rows;
    const set = new Set(wh.vals.map(String));
    return rows.filter((r) => set.has(String(r[wh.col] ?? '')) !== !!wh.not);
  };
  // colours a widget picks for itself (otherwise the brand palette)
  E.colorsOf = (w) => (w.colors && w.colors.length ? w.colors : null);
  // chart settings shared by the live widget and the PDF
  E.chartSpec = (w, t, data) => {
    const m = t.byName[w.metric];
    const counted = !m || w.how === 'count' || w.how === 'distinct';
    const round = ['doughnut', 'pie'].includes(w.chartType);
    const e = { chartType: w.chartType === 'pie' ? 'pie' : w.chartType || 'bar', staticData: data, title: '', showValues: w.showValues,
      valueFormat: data.pct ? 'pct' : counted ? 'int' : E.fmtOf(m, m && m.max), legend: data.series.length > 1 || round ? undefined : false };
    const cols = E.colorsOf(w);
    if (cols) e.colors = cols;
    if (w.colorEach && !round && data.series.length === 1) e.colorEach = true;
    if (data.pct && w.split && w.chartType === 'stacked') e.max100 = true;
    return e;
  };

  // =================================================================== widgets
  const KINDS = {
    kpi: { label: 'Metric (KPI)', icon: 'kpi', w: 3, h: 3, minW: 2, minH: 2 },
    chart: { label: 'Chart', icon: 'chart', w: 6, h: 7, minW: 3, minH: 4 },
    table: { label: 'Table', icon: 'table', w: 6, h: 7, minW: 3, minH: 3 },
    daterange: { label: 'Date range', icon: 'clock', w: 4, h: 4, minW: 3, minH: 3 },
    sheetfilter: { label: 'Sheet filter', icon: 'layers', w: 4, h: 4, minW: 2, minH: 2 },
    filter: { label: 'Filter', icon: 'filter', w: 4, h: 4, minW: 2, minH: 2 },
    text: { label: 'Text', icon: 'text', w: 4, h: 2, minW: 2, minH: 1 }
  };
  const uid = () => D.uid();
  const pickMain = (t) => {
    const m = t.metrics;
    const by = (re) => m.find((c) => re.test(c.name));
    const revenue = by(/revenue|sales|income|profit/i), spend = m.find((c) => /spend|spent|cost|budget/i.test(c.name) && c.role === 'measure');
    const outcome = m.find((c) => c.role === 'measure' && /results|conversions|purchases|leads|sign.?ups|orders|registrations|installs|bookings|customers/i.test(c.name));
    const primary = revenue || outcome || spend || m.find((c) => c.role === 'measure' && !c.lowerBetter) || m[0];
    const eff = m.find((c) => c.derived && c.role === 'ratio') || m.find((c) => c.role === 'ratio');
    return { primary, spend: spend !== primary ? spend : null, eff, secondary: m.find((c) => c !== primary && c.role === 'measure') };
  };
  E.defaults = (kind, t) => {
    const k = pickMain(t);
    const g = t.groupCols.find((c) => c.role === 'entity') || t.groupCols.sort((a, b) => (a.distinct || 99) - (b.distinct || 99))[0];
    // with nothing to add up, widgets count records
    const mm = k.primary ? { metric: k.primary.name, how: 'auto' } : { metric: '', how: 'count' };
    switch (kind) {
      case 'kpi': return { ...mm, compare: true };
      case 'chart': return t.dateCols.length ? { chartType: 'bar', ...mm, by: '@date', bucket: 'auto', top: 0, showValues: false } : { chartType: 'hbar', ...mm, by: g && g.name, top: 10, showValues: true };
      case 'table': return { mode: g ? 'summary' : 'rows', by: g && g.name, metrics: [k.primary, k.spend, k.eff].filter(Boolean).map((c) => c.name), top: 15 };
      case 'daterange': return { col: t.dateCols[0] && t.dateCols[0].name };
      case 'sheetfilter': return { col: (t.sheetCols[0] || {}).name };
      case 'filter': return { col: g && g.name };
      case 'text': return { text: 'Notes' };
      default: return {};
    }
  };
  const plural = (w) => (/(s|x|ch|sh)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's');
  const titleFor = (w, t) => {
    if (w.title) return w.title;
    const m = t.byName[w.metric];
    const only = w.where && w.where.col && w.where.vals && w.where.vals.length ? ` (${w.where.not ? 'not ' : ''}${w.where.vals.length > 2 ? w.where.vals.length + ' ' + plural(label(t.byName[w.where.col] || { name: w.where.col }).toLowerCase()) : w.where.vals.join(', ')})` : '';
    if (w.kind === 'kpi') return (m ? (w.how === 'distinct' ? `Different ${plural(label(m).toLowerCase())}` : w.how === 'count' ? `${label(m)} (count)` : m.role === 'ratio' ? label(m) : `Total ${label(m)}`) : 'Records') + only;
    if (w.kind === 'chart') {
      const by = w.by === '@date' ? 'over time' : w.by ? 'by ' + label(t.byName[w.by]).toLowerCase() : '';
      const sp = w.split && t.byName[w.split] && !['doughnut', 'pie', 'scatter'].includes(w.chartType) ? `${w.by === '@date' ? ' by' : ' and'} ${label(t.byName[w.split]).toLowerCase()}` : '';
      const what = m || w.how === 'count' || !w.metric ? measureLabel(w, t) : 'Chart';
      return `${w.showAs === 'pct' ? 'Share of ' + what.toLowerCase() : what}${w.metric2 && t.byName[w.metric2] && !sp ? ' and ' + label(t.byName[w.metric2]) : ''} ${by}${sp}`.trim() + only;
    }
    if (w.kind === 'table') {
      if (w.mode === 'pivot' && t.byName[w.by] && t.byName[w.split]) return `${measureLabel(w, t)} by ${label(t.byName[w.by]).toLowerCase()} and ${label(t.byName[w.split]).toLowerCase()}${only}`;
      return (w.mode === 'summary' && t.byName[w.by] ? `By ${label(t.byName[w.by]).toLowerCase()}` : 'Records') + only;
    }
    if (w.kind === 'daterange') return 'Date range';
    if (w.kind === 'sheetfilter') return 'Sheets';
    if (w.kind === 'filter') return label(t.byName[w.col]) || 'Filter';
    return '';
  };

  // ---- starter layout from the data
  E.autoBuild = (sheet) => {
    const t = E.table(sheet);
    const out = [];
    let x = 0, y = 0;
    const put = (kind, w, hh, cfg) => { if (x + w > COLS) { x = 0; y = Math.max(...out.filter((o) => o.y + o.h > y).map((o) => o.y + o.h), y + 1); } out.push({ id: uid(), kind, x, y, w, h: hh, ...E.defaults(kind, t), ...cfg }); x += w; };
    const rowEnd = () => { y = Math.max(y, ...out.map((o) => o.y + o.h)); x = 0; };
    const k = pickMain(t);
    const g = t.groupCols.find((c) => c.role === 'entity') || t.groupCols.filter((c) => !t.sheetCols.includes(c)).sort((a, b) => (a.distinct || 99) - (b.distinct || 99))[0];
    const dimCol = t.groupCols.filter((c) => c.role === 'dimension' && !t.sheetCols.includes(c) && !/^Column [A-Z]+$/.test(c.name) && (c.fill == null || c.fill >= 0.4)).sort((a, b) => (a.distinct || 99) - (b.distinct || 99))[0];
    // controls row
    const controls = [];
    if (t.dateCols.length) controls.push(['daterange', {}]);
    if (t.sheetCols.length) controls.push(['sheetfilter', {}]);
    if (dimCol) controls.push(['filter', { col: dimCol.name }]);
    else if (g) controls.push(['filter', { col: g.name }]);
    controls.forEach(([kind, cfg]) => put(kind, Math.floor(COLS / Math.max(controls.length, 3)), 4, cfg));
    rowEnd();
    // headline numbers
    const kpis = [k.primary, k.spend, k.eff, k.secondary, ...t.metrics].filter((c, i, a) => c && a.indexOf(c) === i).slice(0, 4);
    kpis.forEach((c) => put('kpi', COLS / kpis.length, 3, { metric: c.name, compare: t.dateCols.length > 0 }));
    rowEnd();
    // charts
    const per = !t.dateCols.length && t.periodCols[0];
    if (k.primary && per) {
      put('chart', 8, 7, { chartType: 'bar', metric: k.primary.name, by: per.name, sort: 'order', top: 0, showValues: true });
      const other = k.spend || k.secondary || k.eff;
      if (other) put('chart', 4, 7, { chartType: 'line', metric: other.name, by: per.name, sort: 'order', top: 0, showValues: false });
      rowEnd();
      if (k.eff && k.eff !== other) { put('chart', 12, 6, { chartType: 'line', metric: k.eff.name, by: per.name, sort: 'order', top: 0, showValues: true }); rowEnd(); }
      put('table', 12, 7, { mode: 'rows', sortBy: '' });
      return out;
    }
    if (k.primary) {
      if (t.dateCols.length) put('chart', g ? 8 : 12, 7, { chartType: 'bar', metric: k.primary.name, by: '@date', showValues: false });
      if (g) put('chart', t.dateCols.length ? 4 : 6, 7, { chartType: (g.distinct || 99) <= 6 && k.primary.role === 'measure' ? 'doughnut' : 'hbar', metric: k.primary.name, by: g.name, top: 10, showValues: true });
      if (t.dateCols.length) rowEnd();
      if (k.eff && g) put('chart', 6, 7, { chartType: 'hbar', metric: k.eff.name, by: g.name, top: 10, sort: k.eff.lowerBetter ? 'asc' : 'desc', showValues: true });
      if (t.dateCols.length && (k.spend || k.secondary)) put('chart', 6, 7, { chartType: k.spend && k.primary ? 'combo' : 'line', metric: (k.spend || k.secondary).name, metric2: k.spend ? k.primary.name : undefined, by: '@date' });
      else if (dimCol && dimCol !== g) put('chart', 6, 7, { chartType: 'bar', metric: k.primary.name, by: dimCol.name, top: 12, showValues: true });
      else if (g && k.spend && k.primary) put('chart', 6, 7, { chartType: 'scatter', metric: k.spend.name, metric2: k.primary.name, by: g.name, showValues: true });
      if (!t.dateCols.length && g && k.spend && x > 0 && x < COLS) put('chart', COLS - x, 7, { chartType: 'hbar', metric: k.spend.name, by: g.name, top: 10, showValues: true });
      rowEnd();
    }
    if (!k.primary) {
      // records with nothing to add up (sign-ups, tickets, orders…): count them
      const dims = t.groupCols.filter((c) => c.role === 'dimension' && !t.sheetCols.includes(c) && !/^Column [A-Z]+$/.test(c.name) && (c.distinct || 0) >= 2 && (c.fill || 0) >= 0.4)
        .sort((a, b) => score(b) - score(a));
      const small = dims.filter((c) => c.distinct <= 6);
      const kp = dims.filter((c) => !small.includes(c)).slice(0, 3);
      put('kpi', kp.length ? 3 : 4, 3, { metric: '', how: 'count', compare: t.dateCols.length > 0 });
      kp.forEach((c) => put('kpi', 9 / kp.length, 3, { metric: c.name, how: 'distinct', compare: false }));
      rowEnd();
      const pie = small[0];
      // over time, stacked by the field people compare most (source, channel, type…)
      const cmp = small.find((c) => /source|channel|type|category|segment/i.test(c.name)) || small[1] || null;
      if (t.dateCols.length) put('chart', pie ? 8 : 12, 7, { chartType: cmp ? 'stacked' : 'bar', metric: '', how: 'count', by: '@date', bucket: 'auto', showValues: false, ...(cmp && cmp !== pie ? { split: cmp.name, splitTop: 6 } : {}) });
      else if (t.sheetCols.length) put('chart', pie ? 8 : 12, 7, { chartType: 'bar', metric: '', how: 'count', by: t.sheetCols[0].name, sort: 'order', top: 0, showValues: true });
      if (pie) put('chart', 4, 7, { chartType: 'doughnut', metric: '', how: 'count', by: pie.name, top: 6, showValues: true });
      rowEnd();
      const bars = dims.filter((c) => c !== pie).slice(0, 2);
      bars.forEach((c) => put('chart', bars.length > 1 ? 6 : 12, 7, { chartType: 'hbar', metric: '', how: 'count', by: c.name, top: 10, showValues: true }));
      rowEnd();
      const sumBy = bars[0] || pie;
      const across = cmp && cmp !== sumBy ? cmp : pie && pie !== sumBy ? pie : null;
      put('table', 12, 7, sumBy && across ? { mode: 'pivot', by: sumBy.name, split: across.name, metric: '', how: 'count', top: 15 } : sumBy ? { mode: 'summary', by: sumBy.name } : { mode: 'rows', sortBy: '' });
      return out;
    }
    if (g || t.cols.length) put('table', 12, 7, { mode: g ? 'summary' : 'rows', by: g && g.name });
    return out;
  };
  // a good column to break records down by: well filled, a handful to a few dozen values
  const score = (c) => (c.fill || 0) * 2 + (c.distinct <= 12 ? 1.5 : c.distinct <= 40 ? 1 : 0.2) + (/market|region|source|channel|status|type|category|segment|area|team|city|state/i.test(c.name) ? 0.8 : 0);

  // ---- layout helpers (gridstack-style: moved items push others down, then everything floats up)
  const overlap = (a, b) => a !== b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  function settle(list, moved) {
    const push = (it, depth = 0) => { if (depth > 200) return; for (const o of list) if (o !== it && overlap(o, it)) { o.y = it.y + it.h; push(o, depth + 1); } };
    if (moved) push(moved);
    const sorted = [...list].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const it of sorted) { while (it.y > 0) { it.y--; if (list.some((o) => overlap(o, it))) { it.y++; break; } } }
  }

  // =================================================================== view
  class DashView {
    constructor(host, sheet) {
      this.sheet = sheet; this.host = host;
      sheet.widgets ||= []; sheet.sources ||= []; filtersOf(sheet);
      host.innerHTML = '';
      this.toolbar = h('div', { class: 'sheet-toolbar' });
      this.fbar = h('div', { class: 'db-filterbar' });
      this.scroll = h('div', { class: 'db-scroll' });
      this.gridEl = h('div', { class: 'db-grid' });
      this.scroll.append(this.gridEl);
      host.append(this.toolbar, this.fbar, this.scroll);
      this.buildToolbar();
      this.render();
      this.ro = new ResizeObserver(() => { clearTimeout(this._rt); this._rt = setTimeout(() => this.render(), 120); });
      this.ro.observe(this.scroll);
      this.unsub = D.on('changed', () => { if (D.active() === sheet && !this._self) this.render(); });
    }
    destroy() { this.ro.disconnect(); this.unsub && this.unsub(); this.charts().forEach((c) => c.destroy()); }
    charts() { return [...this.gridEl.querySelectorAll('.db-chart')].map((x) => x._chart).filter(Boolean); }
    commit(data = false) { this._self = true; D.commit({ data }); this._self = false; }
    buildToolbar() {
      const tb = this.toolbar; tb.innerHTML = '';
      const addBtn = D.btn('plus', 'Add a widget', () => D.menu(addBtn, Object.entries(KINDS).map(([k, v]) => ({ label: v.label, icon: v.icon, onClick: () => this.addWidget(k) }))), { label: 'Widget', caret: true, cls: 'accent' });
      tb.append(
        D.btn('undo', 'Undo', () => D.undo()), D.btn('redo', 'Redo', () => D.redo()), D.sep(),
        addBtn,
        D.btn('data', 'Choose the Data Sheets or data set this dashboard reads', () => this.pickSources(), { label: this.sourceLabel() }),
        D.btn('sparkles', 'Lay out a starter dashboard from the data', () => this.autoBuild(), { label: 'Build from data' }),
        this.dupButton(),
        D.sep(),
        D.btn('x', 'Clear every filter', () => { this.sheet.filters = { date: this.sheet.filters.date ? { ...this.sheet.filters.date, preset: 'all' } : null, vals: {} }; this.commit(); this.render(); }, { label: 'Clear filters' }),
        h('div', { class: 'tb-spacer' }),
        D.btn('pdf', 'Export this dashboard as it looks now, filters included, as a PDF', () => D.io.exportSheet(this.sheet, 'pdf'), { label: 'PDF', cls: 'primary' }));
    }
    // repeated records (same ID in two weeks' exports, say): count each once, or every row
    dupButton() {
      let t = null;
      try { if ((this.sheet.sources || []).length) t = E.table(this.sheet); } catch { t = null; }
      if (!t || !t.idCol || !t.dupExtra) return null;
      const on = this.sheet.dedupe === t.idCol;
      const b = D.btn('copy', `${t.dupExtra.toLocaleString()} rows repeat a ${t.idCol} that appears earlier`, () => D.menu(b, [
        { header: `${t.dupExtra.toLocaleString()} repeated ${t.idCol}${t.dupExtra > 1 ? 's' : ''}` },
        { label: `Count each ${t.idCol} once`, checked: on, onClick: () => { this.sheet.dedupe = t.idCol; this.commit(); this.buildToolbar(); this.render(); D.toast(`Counting each ${t.idCol} once: ${t.dupExtra.toLocaleString()} repeated rows left out`, 'ok'); } },
        { label: 'Count every row', checked: !on, onClick: () => { delete this.sheet.dedupe; this.commit(); this.buildToolbar(); this.render(); } },
        ...(this.sheet.sources.length === 1 ? [{ sep: true }, { label: 'See the duplicates…', icon: 'search', onClick: () => { const src = D.sheet(this.sheet.sources[0]); if (src) { D.app.activate(src.id, true); D.dupes.open(src); } } }] : [])
      ]), { label: on ? `${t.idCol}: each once` : `${t.dupExtra.toLocaleString()} duplicates`, caret: true, active: on });
      return b;
    }
    sourceLabel() { const s = (this.sheet.sources || []).map((id) => D.sheet(id)).filter(Boolean); return s.length ? (s.length === 1 ? s[0].name : `${s.length} sheets`) : 'Choose data'; }
    pickSources() {
      const list = D.dataSheets().filter((s) => !s.calcOf && !s.hidden);
      const sel = new Set(this.sheet.sources);
      const boxes = new Map();
      const item = (s, short) => { const c = h('input', { type: 'checkbox' }); c.checked = sel.has(s.id); boxes.set(s.id, c); c.addEventListener('change', () => { if (c.checked) sel.add(s.id); else sel.delete(s.id); }); return h('label', { class: 'chk db-src' }, c, h('span', { html: D.icon(s.dataset ? 'layers' : 'data', 14) }), h('span', null, short ? s.wsName : s.name), s.dataset ? h('em', { class: 'muted small' }, ` data set · ${new Set((s.dataset.files || []).map((f) => f.path)).size} files`) : null); };
      // tabs from one workbook are grouped, with a switch to take them all
      const groups = []; const seen = new Map();
      for (const s of list) { const b = bookOf(s); if (b && list.filter((x) => bookOf(x) === b).length > 1) { if (!seen.has(b)) { const g = { book: b, items: [] }; seen.set(b, g); groups.push(g); } seen.get(b).items.push(s); } else groups.push({ items: [s] }); }
      const body = h('div', { class: 'db-sources' },
        h('p', { class: 'muted small' }, 'Pick one sheet or data set, or several sheets that share the same columns (for example one per week or month). With several, a “Sheet” filter lets you switch between them.'),
        ...groups.map((g) => {
          if (!g.book) return item(g.items[0]);
          const all = h('button', { class: 'btn sm', onclick: () => { const on = !g.items.every((s) => sel.has(s.id)); g.items.forEach((s) => { if (on) sel.add(s.id); else sel.delete(s.id); boxes.get(s.id).checked = on; }); } }, 'All / none');
          return h('div', { class: 'db-book' }, h('div', { class: 'db-book-head' }, h('span', { html: D.icon('file', 14) }), h('b', null, g.book), h('span', { class: 'muted small' }, ` ${g.items.length} tabs`), all), h('div', { class: 'db-book-list' }, ...g.items.map((s) => item(s, true))));
        }));
      D.modal({ title: 'Dashboard data', width: 480, body, actions: [{ label: 'Cancel' }, { label: 'Use these', primary: true, onClick: () => {
        const before = this.sheet.sources.join();
        this.sheet.sources = list.filter((s) => sel.has(s.id)).map((s) => s.id);
        if (before !== this.sheet.sources.join() && this.sheet.sources.length && !this.sheet.widgets.length) this.sheet.widgets = E.autoBuild(this.sheet);
        this.commit(); this.buildToolbar(); this.render();
      } }] });
    }
    autoBuild() {
      if (!this.sheet.sources.length) return this.pickSources();
      const go = () => { this.sheet.widgets = E.autoBuild(this.sheet); this.sheet.filters = { date: null, vals: {} }; this.commit(); this.render(); D.toast('Starter dashboard ready. Drag headers to move widgets, drag corners to resize.', 'ok', 4500); };
      if (!this.sheet.widgets.length) return go();
      D.choose('Replace the current layout?', 'Building from data lays out a fresh set of widgets. You can undo this.', [{ label: 'Cancel', value: null }, { label: 'Replace', value: 'y', primary: true }]).then((v) => v && go());
    }
    addWidget(kind) {
      if (!this.sheet.sources.length && !['text'].includes(kind)) { D.toast('Choose the data for this dashboard first', 'warn'); return this.pickSources(); }
      const t = E.table(this.sheet);
      const k = KINDS[kind];
      const y = Math.max(0, ...this.sheet.widgets.map((w) => w.y + w.h));
      const w = { id: uid(), kind, x: 0, y, w: k.w, h: k.h, ...E.defaults(kind, t) };
      this.sheet.widgets.push(w); settle(this.sheet.widgets, w);
      this.commit(); this.render();
      this.edit(w);
      setTimeout(() => { const el = this.gridEl.querySelector(`[data-id="${w.id}"]`); el && el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 50);
    }

    // ---- rendering
    metrics() {
      const W = Math.max(480, this.scroll.clientWidth - 40);
      const colW = (W - GAP * (COLS - 1)) / COLS;
      return { W, colW, px: (w) => ({ left: w.x * (colW + GAP), top: w.y * (ROW + GAP), width: w.w * colW + (w.w - 1) * GAP, height: w.h * ROW + (w.h - 1) * GAP }) };
    }
    render() {
      const s = this.sheet;
      this.charts().forEach((c) => c.destroy());
      this.gridEl.innerHTML = '';
      this.renderFilterBar();
      if (!s.sources.length || !s.sources.some((id) => D.sheet(id))) return this.empty();
      if (!s.widgets.length) return this.empty(true);
      const t = E.table(s);
      const M = this.metrics();
      this.M = M;
      const height = Math.max(...s.widgets.map((w) => M.px(w).top + M.px(w).height)) + 40;
      this.gridEl.style.width = M.W + 'px'; this.gridEl.style.height = height + 'px';
      for (const w of s.widgets) this.gridEl.append(this.card(w, t, M));
      const rows = E.rows(s, t);
      D.app.setStatus(`${rows.length.toLocaleString()} of ${t.rows.length.toLocaleString()} rows shown${s.dedupe === t.idCol && t.dupExtra ? ` (${t.dupExtra.toLocaleString()} repeats left out)` : ''}<span class="st-sep"></span>${s.widgets.length} widgets`);
    }
    renderFilterBar() {
      const s = this.sheet, bar = this.fbar; bar.innerHTML = '';
      if (!s.sources.length) return;
      const t = E.table(s);
      const chips = [];
      const r = E.activeRange(s, t);
      if (r) chips.push(h('span', { class: 'db-chip' }, h('b', null, label(t.byName[r.col])), ` ${isFinite(r.from) ? fmtDate(r.from) : 'start'} - ${isFinite(r.to) ? fmtDate(r.to) : 'end'}`, h('button', { html: D.icon('x', 11), title: 'Remove', onclick: () => { s.filters.date.preset = 'all'; this.commit(); this.render(); } })));
      for (const [c, list] of Object.entries(s.filters.vals || {})) if (list && list.length && t.byName[c]) chips.push(h('span', { class: 'db-chip' }, h('b', null, label(t.byName[c])), ' ' + (list.length > 2 ? `${list.length} selected` : list.join(', ')), h('button', { html: D.icon('x', 11), title: 'Remove', onclick: () => { delete s.filters.vals[c]; this.commit(); this.render(); } })));
      bar.classList.toggle('on', chips.length > 0);
      if (chips.length) bar.append(h('span', { class: 'muted small' }, 'Filtered by'), ...chips);
    }
    empty(hasData) {
      const list = D.dataSheets().filter((x) => !x.calcOf);
      this.gridEl.style.width = ''; this.gridEl.style.height = '';
      this.gridEl.append(h('div', { class: 'db-empty' },
        h('div', { class: 'db-empty-ic', html: D.icon('grid', 30) }),
        h('h2', null, hasData ? 'Lay out your dashboard' : 'Point this dashboard at your data'),
        h('p', null, hasData ? 'Build a starter layout from the data, or add widgets one at a time.' : 'Pick a Data Sheet or data set. Date range and sheet filters then let you slice everything at once, for example a whole year of exports.'),
        h('div', { class: 'db-empty-actions' },
          hasData ? h('button', { class: 'btn primary', html: D.icon('sparkles', 15) + '<span>Build from data</span>', onclick: () => this.autoBuild() }) : h('button', { class: 'btn primary', html: D.icon('data', 15) + '<span>Choose data…</span>', onclick: () => this.pickSources() }),
          hasData ? h('button', { class: 'btn', html: D.icon('plus', 15) + '<span>Add a widget</span>', onclick: (e) => D.menu(e.currentTarget, Object.entries(KINDS).map(([k, v]) => ({ label: v.label, icon: v.icon, onClick: () => this.addWidget(k) }))) }) : (list.length ? null : h('button', { class: 'btn', html: D.icon('layers', 15) + '<span>Combine files into a data set…</span>', onclick: () => D.dataset.start() })))));
    }
    card(w, t, M) {
      const p = M.px(w);
      const el = h('div', { class: `db-card k-${w.kind}`, dataset: { id: w.id }, style: { left: p.left + 'px', top: p.top + 'px', width: p.width + 'px', height: p.height + 'px' } });
      const head = h('div', { class: 'db-head', title: 'Drag to move' }, h('span', { class: 'db-title' }, titleFor(w, t)),
        h('button', { class: 'db-more', title: 'Widget options', html: D.icon('more', 14), onclick: (e) => { e.stopPropagation(); D.menu(e.currentTarget, [
          { label: 'Edit…', icon: 'edit', onClick: () => this.edit(w) },
          { label: 'Duplicate', icon: 'copy', onClick: () => { const c = { ...D.clone(w), id: uid(), y: w.y + w.h }; this.sheet.widgets.push(c); settle(this.sheet.widgets, c); this.commit(); this.render(); } },
          { sep: true },
          { label: 'Remove', icon: 'trash', danger: true, onClick: () => { this.sheet.widgets = this.sheet.widgets.filter((x) => x !== w); settle(this.sheet.widgets); this.commit(); this.render(); } }
        ]); } }));
      const body = h('div', { class: 'db-body' });
      el.append(head, body, h('div', { class: 'db-resize', title: 'Drag to resize' }));
      head.addEventListener('mousedown', (e) => { if (e.button === 0 && !e.target.closest('button')) this.drag(e, w, el, 'move'); });
      el.lastChild.addEventListener('mousedown', (e) => { if (e.button === 0) this.drag(e, w, el, 'size'); });
      head.addEventListener('dblclick', () => this.edit(w));
      try { this.fill(body, w, t, p); } catch (err) { console.error(err); body.append(h('div', { class: 'db-msg' }, 'This widget could not be drawn: ' + err.message)); }
      return el;
    }
    // ---- drag to move / resize with a snapping placeholder
    drag(e, w, el, mode) {
      e.preventDefault();
      const M = this.M, start = { x: e.clientX, y: e.clientY, w: { ...w } };
      const ph = h('div', { class: 'db-ghost' });
      this.gridEl.append(ph);
      el.classList.add('dragging');
      const k = KINDS[w.kind] || { minW: 2, minH: 2 };
      const place = (g) => { const p = M.px(g); Object.assign(ph.style, { left: p.left + 'px', top: p.top + 'px', width: p.width + 'px', height: p.height + 'px' }); };
      let target = { ...w };
      place(target);
      const move = (ev) => {
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        if (mode === 'move') {
          el.style.transform = `translate(${dx}px, ${dy}px)`;
          target = { ...w, x: Math.max(0, Math.min(COLS - w.w, start.w.x + Math.round(dx / (M.colW + GAP)))), y: Math.max(0, start.w.y + Math.round(dy / (ROW + GAP))) };
        } else {
          const nw = Math.max(k.minW, Math.min(COLS - w.x, start.w.w + Math.round(dx / (M.colW + GAP))));
          const nh = Math.max(k.minH, start.w.h + Math.round(dy / (ROW + GAP)));
          el.style.width = M.px({ ...w, w: Math.max(1, (start.w.w * (M.colW + GAP) + dx) / (M.colW + GAP)) }).width + 'px';
          el.style.height = Math.max(ROW, M.px(start.w).height + dy) + 'px';
          target = { ...w, w: nw, h: nh };
        }
        place(target);
        const sr = this.scroll.getBoundingClientRect();
        if (ev.clientY > sr.bottom - 30) this.scroll.scrollTop += 14; else if (ev.clientY < sr.top + 30) this.scroll.scrollTop -= 14;
      };
      const up = () => {
        window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
        Object.assign(w, { x: target.x, y: target.y, w: target.w, h: target.h });
        settle(this.sheet.widgets, w);
        this.commit(); this.render();
      };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    }

    // ---- widget bodies
    setFilter(col, values) { const f = filtersOf(this.sheet); if (!values || !values.length) delete f.vals[col]; else f.vals[col] = values.map(String); this.commit(); this.render(); }
    fill(body, w, t, p) {
      const s = this.sheet;
      const innerW = p.width - 24, innerH = p.height - 44;
      if (w.kind === 'text') {
        const tx = h('div', { class: 'db-text', contenteditable: 'true' }); tx.innerText = w.text || '';
        tx.addEventListener('blur', () => { if (tx.innerText !== w.text) { w.text = tx.innerText; this.commit(); } });
        tx.addEventListener('keydown', (e) => e.stopPropagation());
        return body.append(tx);
      }
      if (w.kind === 'daterange') return this.dateWidget(body, w, t);
      if (w.kind === 'filter' || w.kind === 'sheetfilter') return this.filterWidget(body, w, t);
      // a column this widget uses is gone (renamed in the source, or a different data set): say so plainly
      const gone = [w.metric, w.kind === 'chart' ? w.metric2 : null, w.by && w.by !== '@date' && w.kind !== 'kpi' ? w.by : null, w.split, w.where && w.where.col].filter((n) => n && !t.byName[n]);
      if (gone.length) {
        return body.append(h('div', { class: 'db-msg' }, `“${gone[0]}” isn't in the data any more.`, h('br'), h('button', { class: 'btn sm', style: { marginTop: '8px' }, onclick: () => this.edit(w) }, 'Choose another column')));
      }
      const rows = E.where(E.rows(s, t), w);
      if (w.kind === 'kpi') {
        const m = t.byName[w.metric];
        const how = w.how || 'auto';
        const v = E.agg(rows, m, how);
        body.classList.add('db-kpi');
        body.append(h('div', { class: 'db-kv', style: { fontSize: Math.max(18, Math.min(44, innerH * 0.42, innerW / 6)) + 'px' } }, how === 'count' || how === 'distinct' ? (v ?? 0).toLocaleString() : E.fmt(m, v)));
        const prev = w.compare !== false ? E.previousRange(s, t) : null;
        if (prev) {
          const pv = E.agg(E.where(E.rows(s, t, { range: prev }), w), m, how);
          if (pv != null && v != null && pv !== 0) {
            const g = (v - pv) / Math.abs(pv);
            const lower = w.lowerBetter != null ? w.lowerBetter : m && m.lowerBetter;
            const good = lower ? g <= 0 : g >= 0;
            body.append(h('div', { class: `db-delta ${good ? 'up' : 'down'}` }, `${g >= 0 ? '▲' : '▼'} ${Math.abs(g * 100).toFixed(1)}%`, h('span', null, ` vs previous ${Math.round((prev.to - prev.from) / DAY) + 1} days (${how === 'count' || how === 'distinct' ? pv.toLocaleString() : E.fmt(m, pv)})`)));
          } else body.append(h('div', { class: 'db-sub' }, `No data in the previous ${Math.round((prev.to - prev.from) / DAY) + 1} days to compare with`));
        } else body.append(h('div', { class: 'db-sub' }, `${rows.length.toLocaleString()} rows${how === 'auto' && m && m.derived ? ` · ${m.derived.a} ÷ ${m.derived.b}` : ''}`));
        return;
      }
      if (w.kind === 'chart') {
        const data = this.chartData(w, t, rows);
        if (!data.labels.length) return body.append(h('div', { class: 'db-msg' }, 'No data for the current filters'));
        const host = h('div', { class: 'db-chart' });
        body.append(host);
        const e = E.chartSpec(w, t, data);
        e.showValues = w.showValues && data.labels.length <= 24;
        const ch = D.charts.render(host, e, { w: innerW, h: innerH, scale: 0.85 });
        host._chart = ch;
        // click a bar or slice to filter the whole dashboard by it
        const by = w.by;
        if (ch && by && by !== '@date' && w.chartType !== 'scatter') {
          ch.options.onClick = (evt, els) => { if (!els.length) return; const lab = data.labels[els[0].index]; if (/^Other \(/.test(lab)) return; const cur = filtersOf(s).vals[by] || []; this.setFilter(by, cur.length === 1 && cur[0] === lab ? [] : [lab]); };
          ch.options.onHover = (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; };
          ch.update('none');
        }
        return;
      }
      if (w.kind === 'table') return this.tableWidget(body, w, t, rows);
    }
    chartData(w, t, rows) { return E.chartData(w, t, rows, (filtersOf(this.sheet).date || {}).col); }
    tableWidget(body, w, t, rows) {
      // columns: number columns (totalled) and "different X" counts; the number of records is always last
      const ms = (w.metrics || []).map((n) => (n[0] === '~' ? (t.byName[n.slice(1)] ? { m: t.byName[n.slice(1)], how: 'distinct', name: `Different ${plural(label(t.byName[n.slice(1)]).toLowerCase())}` } : null) : t.byName[n] ? { m: t.byName[n], how: 'auto', name: label(t.byName[n]) } : null)).filter(Boolean);
      const show = (x, v) => (x.how === 'distinct' || x.how === 'count' || !x.m ? (v ?? 0).toLocaleString() : E.fmt(x.m, v));
      const filterTo = (col, val) => { const cur = filtersOf(this.sheet).vals[col] || []; this.setFilter(col, cur.length === 1 && cur[0] === val ? [] : [val]); };
      const tbl = h('table', { class: 'db-table' });
      if (w.mode === 'pivot' && t.byName[w.by] && t.byName[w.split]) {
        // a grid: one row per value of "Rows", one column per value of "Columns", counts or totals in the cells
        const rb = t.byName[w.by], cb = t.byName[w.split], m = t.byName[w.metric], how = w.how || (m ? 'auto' : 'count');
        const x = { m, how: m ? how : 'count' };
        const agg = (rs) => E.agg(rs, m, x.how);
        let cgs = E.group(rows, t, cb.name).map((g) => ({ ...g, v: agg(g.rows) })).sort((a, b) => (b.v ?? 0) - (a.v ?? 0));
        const maxC = 12, otherC = cgs.length > maxC ? cgs.slice(maxC) : null;
        cgs = cgs.slice(0, maxC);
        const colKeys = new Set(cgs.map((g) => g.label));
        let rgs = E.group(rows, t, rb.name).map((g) => ({ ...g, v: agg(g.rows) })).sort((a, b) => (b.v ?? 0) - (a.v ?? 0));
        if (w.top) rgs = rgs.slice(0, w.top);
        const cell = (rs, lab) => agg(rs.filter((r) => String(r[cb.name] ?? '') === lab));
        tbl.classList.add('pivot');
        tbl.append(h('thead', null, h('tr', null, h('th', null, `${label(rb)} / ${label(cb)}`), ...cgs.map((g) => h('th', { class: 'num click', title: `Filter the dashboard to ${g.label}`, onclick: () => filterTo(cb.name, g.label) }, g.label)), otherC ? h('th', { class: 'num' }, `Other (${otherC.length})`) : null, h('th', { class: 'num' }, 'Total'))));
        const tb = h('tbody');
        const maxV = Math.max(1, ...rgs.flatMap((g) => cgs.map((c) => cell(g.rows, c.label) || 0)));
        rgs.forEach((g) => {
          const tr = h('tr', null, h('td', { class: 'click', title: `Filter the dashboard to ${g.label}`, onclick: () => filterTo(rb.name, g.label) }, g.label),
            ...cgs.map((c) => { const v = cell(g.rows, c.label); const td = h('td', { class: 'num heat', title: `${g.label} · ${c.label}` }, v ? show(x, v) : '·'); if (v && typeof v === 'number') td.style.setProperty('--heat', String(Math.min(1, v / maxV))); return td; }),
            otherC ? (() => { const v = agg(g.rows.filter((r) => !colKeys.has(String(r[cb.name] ?? '')) && String(r[cb.name] ?? '') !== '')); return h('td', { class: 'num' }, v ? show(x, v) : '·'); })() : null,
            h('td', { class: 'num tot' }, show(x, g.v)));
          tb.append(tr);
        });
        tb.append(h('tr', { class: 'total' }, h('td', null, 'Total'), ...cgs.map((c) => h('td', { class: 'num' }, show(x, c.v))), otherC ? h('td', { class: 'num' }, show(x, agg(otherC.flatMap((g) => g.rows)))) : null, h('td', { class: 'num' }, show(x, agg(rows)))));
        tbl.append(tb);
      } else if ((w.mode === 'summary' || w.mode === 'pivot') && t.byName[w.by]) {
        const by = t.byName[w.by];
        let gs = E.group(rows, t, by.name).map((g) => ({ ...g, vals: ms.map((x) => E.agg(g.rows, x.m, x.how)) }));
        const si = ms.findIndex((x) => x.m.name === w.sortBy);
        const asc = si >= 0 && ms[si].m.role === 'ratio' && ms[si].m.lowerBetter;
        if (si >= 0 || ms.length) { const k = Math.max(0, si); gs.sort((a, b) => (asc ? a.vals[k] - b.vals[k] : b.vals[k] - a.vals[k])); } else gs.sort((a, b) => b.rows.length - a.rows.length);
        if (w.top) gs = gs.slice(0, w.top);
        tbl.append(h('thead', null, h('tr', null, h('th', null, label(by)), ...ms.map((x) => h('th', { class: 'num' }, x.name)), h('th', { class: 'num' }, 'Records'), h('th', { class: 'num' }, 'Share'))));
        const tb = h('tbody');
        gs.forEach((g) => {
          const tr = h('tr', { class: 'click', title: `Filter the dashboard to ${g.label}` }, h('td', null, g.label), ...g.vals.map((v, i) => h('td', { class: 'num' }, show(ms[i], v))), h('td', { class: 'num' }, g.rows.length.toLocaleString()), h('td', { class: 'num muted' }, rows.length ? F().format(g.rows.length / rows.length, 'pct') : '-'));
          tr.addEventListener('click', () => filterTo(by.name, g.label));
          tb.append(tr);
        });
        const tot = h('tr', { class: 'total' }, h('td', null, 'Total'), ...ms.map((x) => h('td', { class: 'num' }, show(x, E.agg(rows, x.m, x.how)))), h('td', { class: 'num' }, rows.length.toLocaleString()), h('td', { class: 'num' }, rows.length ? '100%' : '-'));
        tb.append(tot);
        tbl.append(tb);
      } else {
        const cols = (w.columns && w.columns.length ? w.columns.map((n) => t.byName[n]).filter(Boolean) : t.cols.filter((c) => !['constant', 'empty', 'ignored'].includes(c.role) && c.name !== '__sheet')).slice(0, 10);
        let rs = rows;
        const sc = t.byName[w.sortBy] || t.dateCols[0];
        if (sc) rs = [...rs].sort((a, b) => (b[sc.name] ?? -Infinity) - (a[sc.name] ?? -Infinity) || String(b[sc.name]).localeCompare(String(a[sc.name])));
        rs = rs.slice(0, w.top || 50);
        tbl.append(h('thead', null, h('tr', null, ...cols.map((c) => h('th', { class: c.type === 'number' ? 'num' : '' }, label(c))))));
        tbl.append(h('tbody', null, rs.map((r) => h('tr', null, ...cols.map((c) => h('td', { class: c.type === 'number' ? 'num' : '' }, c.type === 'date' ? (r[c.name] != null ? fmtDate(r[c.name]) : '') : c.type === 'number' ? E.fmt(c, r[c.name]) : String(r[c.name] ?? '')))))));
      }
      body.append(h('div', { class: 'db-tablewrap' }, tbl));
    }
    dateWidget(body, w, t) {
      const s = this.sheet;
      const col = t.byName[w.col] || t.dateCols[0];
      if (!col) return body.append(h('div', { class: 'db-msg' }, 'No date column in this data'));
      const f = filtersOf(s);
      const cur = f.date && f.date.col === col.name ? f.date : { col: col.name, preset: 'all' };
      const anchor = E.anchor(t);
      const set = (patch) => { f.date = { ...cur, ...patch, col: col.name }; this.commit(); this.render(); };
      const sel = h('select', { class: 'input sm' }, PRESETS.map(([v, l]) => h('option', { value: v, selected: v === cur.preset ? true : null }, l)));
      sel.addEventListener('change', () => { const v = sel.value; if (v === 'custom') { const r = E.range(cur.preset, anchor) || [t.minDate, t.maxDate]; set({ preset: 'custom', from: F().isoDate(new Date(isFinite(r[0]) ? r[0] : t.minDate)), to: F().isoDate(new Date(isFinite(r[1]) ? r[1] : t.maxDate)) }); } else set({ preset: v }); });
      const r = E.activeRange(s, t);
      const fromI = h('input', { type: 'date', class: 'input sm', value: cur.preset === 'custom' ? cur.from || '' : r && isFinite(r.from) ? F().isoDate(new Date(r.from)) : isFinite(t.minDate) ? F().isoDate(new Date(t.minDate)) : '' });
      const toI = h('input', { type: 'date', class: 'input sm', value: cur.preset === 'custom' ? cur.to || '' : r && isFinite(r.to) ? F().isoDate(new Date(r.to)) : isFinite(t.maxDate) ? F().isoDate(new Date(t.maxDate)) : '' });
      const onDate = () => set({ preset: 'custom', from: fromI.value, to: toI.value });
      fromI.addEventListener('change', onDate); toI.addEventListener('change', onDate);
      [fromI, toI, sel].forEach((x) => x.addEventListener('keydown', (e) => e.stopPropagation()));
      const quick = h('div', { class: 'db-quick' }, [['last30', '30d'], ['last90', '90d'], ['ytd', 'YTD'], ['last12m', '12m'], ['all', 'All']].map(([v, l]) => h('button', { class: cur.preset === v ? 'on' : '', onclick: () => set({ preset: v }) }, l)));
      body.append(h('div', { class: 'db-date' }, sel, quick, h('div', { class: 'db-dates' }, fromI, h('span', null, 'to'), toI),
        h('div', { class: 'db-sub' }, `${label(col)} · data runs ${isFinite(t.minDate) ? fmtDate(t.minDate) : '?'} to ${isFinite(t.maxDate) ? fmtDate(t.maxDate) : '?'}${anchor !== startOfDay(Date.now()) ? ' · ranges count back from the latest data' : ''}`)));
    }
    filterWidget(body, w, t) {
      const s = this.sheet;
      const col = t.byName[w.col] || (w.kind === 'sheetfilter' ? t.sheetCols[0] : t.groupCols[0]);
      if (!col) return body.append(h('div', { class: 'db-msg' }, w.kind === 'sheetfilter' ? 'Add more than one sheet, or use a data set with a Source column, to filter by sheet' : 'No text column to filter by'));
      const selected = new Set((filtersOf(s).vals[col.name] || []));
      const counts = new Map();
      E.rows(s, t, { skip: col.name }).forEach((r) => { const k = String(r[col.name] ?? ''); if (k) counts.set(k, (counts.get(k) || 0) + 1); });
      const all = [...new Set(t.rows.map((r) => String(r[col.name] ?? '')).filter(Boolean))];
      if (w.kind === 'sheetfilter' || col.name === '__sheet') {
        // tabs named by date (10-04-26, Sales 2024-03…): newest first; otherwise A to Z
        const when = (v) => { const p = D.dataset && D.dataset.periodFromName ? D.dataset.periodFromName(v) : null; return p ? p.date : null; };
        if (all.length && all.every((v) => when(v))) all.sort((a, b) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0));
        else all.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      } else all.sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
      const listEl = h('div', { class: 'db-opts' });
      const search = all.length > 8 ? h('input', { class: 'input sm', placeholder: `Search ${all.length}…` }) : null;
      const draw = (q = '') => {
        listEl.innerHTML = '';
        all.filter((v) => !q || v.toLowerCase().includes(q.toLowerCase())).forEach((v) => {
          const on = selected.has(v);
          const b = h('button', { class: `db-opt ${on ? 'on' : ''} ${counts.get(v) ? '' : 'none'}` }, h('span', { class: 'db-box', html: on ? D.icon('check', 11) : '' }), h('span', { class: 'db-ov' }, v), h('em', null, (counts.get(v) || 0).toLocaleString()));
          b.addEventListener('click', (e) => { const next = new Set(selected); if (e.metaKey || e.ctrlKey || w.multi !== false) { if (on) next.delete(v); else next.add(v); } else { next.clear(); if (!on) next.add(v); } this.setFilter(col.name, [...next]); });
          listEl.append(b);
        });
      };
      if (search) { search.addEventListener('input', () => draw(search.value)); search.addEventListener('keydown', (e) => e.stopPropagation()); }
      draw();
      body.append(h('div', { class: 'db-filter' }, h('div', { class: 'db-frow' }, search, h('button', { class: `db-all ${selected.size ? '' : 'on'}`, onclick: () => this.setFilter(col.name, []) }, selected.size ? `Clear (${selected.size})` : 'All')), listEl));
    }

    // ---- widget editor
    edit(w) {
      const t = E.table(this.sheet);
      const o = D.clone(w);
      const field = (lab, ctl) => h('div', { class: 'field' }, h('label', null, lab), ctl);
      const sel = (opts, cur, on) => { const s = h('select', { class: 'input' }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(cur ?? '') ? true : null }, l))); s.addEventListener('change', () => on(s.value)); return s; };
      const textCols = t.cols.filter((c) => c.type === 'text' && !['empty', 'ignored'].includes(c.role));
      const tOpts = textCols.map((c) => [c.name, label(c)]);
      // what to count or add up: the records themselves, the different values of a column, or a number column
      const measures = [['|count', 'Number of records'],
        ...t.metrics.map((c) => [`${c.name}|auto`, label(c) + (c.derived ? ' (worked out from totals)' : c.role === 'ratio' ? ' (rate)' : '')]),
        ...textCols.filter((c) => c.name !== '__sheet').map((c) => [`${c.name}|distinct`, `Different ${plural(label(c).toLowerCase())}`])];
      const mVal = (x) => (!x.metric ? '|count' : x.how === 'distinct' ? `${x.metric}|distinct` : `${x.metric}|auto`);
      const setM = (x, v) => { const k = v.lastIndexOf('|'); const m = v.slice(0, k), how = v.slice(k + 1); x.metric = m; x.how = how === 'auto' ? (['count', 'distinct'].includes(x.how) ? 'auto' : x.how || 'auto') : how; };
      const title = h('input', { class: 'input', value: o.title || '', placeholder: titleFor({ ...o, title: '' }, t) }); title.addEventListener('input', () => { o.title = title.value; });
      const chk = (key, lab, def, after) => { const c = h('input', { type: 'checkbox' }); c.checked = o[key] != null ? !!o[key] : def; c.addEventListener('change', () => { o[key] = c.checked; if (after) after(); }); return h('label', { class: 'chk' }, c, h('span', null, lab)); };
      const box = h('div', { class: 'db-edit' });
      const allRows = E.rows(this.sheet, t);
      const refreshTitle = () => { title.placeholder = titleFor({ ...o, title: '' }, t); };

      // "only count rows where …" for KPIs, charts and tables
      const whereField = () => {
        const wh = o.where || {};
        const wrap = h('div', { class: 'db-where' });
        const colSel = sel([['', 'All rows'], ...tOpts], wh.col || '', (v) => { o.where = v ? { col: v, vals: [], not: false } : null; draw(); });
        wrap.append(h('div', { class: 'row2' }, colSel, wh.col ? sel([['', 'is one of'], ['not', 'is not one of']], wh.not ? 'not' : '', (v) => { o.where.not = v === 'not'; refreshTitle(); }) : h('span')));
        if (wh.col) {
          const counts = new Map();
          allRows.forEach((r) => { const k = String(r[wh.col] ?? ''); if (k) counts.set(k, (counts.get(k) || 0) + 1); });
          const vals = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
          const chosen = new Set(wh.vals || []);
          wrap.append(h('div', { class: 'dash-chipset db-where-vals' }, vals.map(([v, n]) => { const b = h('button', { class: `chip-t ${chosen.has(v) ? 'on' : ''}`, title: `${n.toLocaleString()} rows` }, v); b.addEventListener('click', () => { if (chosen.has(v)) chosen.delete(v); else chosen.add(v); o.where.vals = [...chosen]; b.classList.toggle('on'); refreshTitle(); }); return b; })));
        }
        return field('Only count rows where', wrap);
      };

      // chart colours: brand palette, a preset, or your own per series / per bar
      const PRESETS = { Brand: null, Vivid: ['#2563EB', '#F97316', '#10B981', '#E11D48', '#8B5CF6', '#F59E0B', '#06B6D4', '#84CC16'], Ocean: ['#0B3C5D', '#1D70A2', '#2FA4D9', '#7FD1EA', '#14B8A6', '#0E7490', '#93C5FD', '#334155'], Sunset: ['#F43F5E', '#F97316', '#FACC15', '#FB7185', '#C2410C', '#9F1239', '#FDBA74', '#7C2D12'], Forest: ['#166534', '#22C55E', '#84CC16', '#A3E635', '#0F766E', '#65A30D', '#4D7C0F', '#BBF7D0'], Grays: ['#111827', '#374151', '#6B7280', '#9CA3AF', '#D1D5DB', '#4B5563', '#1F2937', '#E5E7EB'], Pastel: ['#93C5FD', '#FCA5A5', '#86EFAC', '#FDE68A', '#C4B5FD', '#FBCFE8', '#A5F3FC', '#FED7AA'] };
      const brandPal = () => D.brand().palette || D.DEFAULT_BRAND.palette;
      const colorField = () => {
        const wrap = h('div', { class: 'db-colors' });
        let data = { labels: [], series: [] };
        try { data = E.chartData(o, t, E.where(allRows, o), (filtersOf(this.sheet).date || {}).col); } catch { /* preview only */ }
        const round = ['doughnut', 'pie'].includes(o.chartType);
        const perBar = round || (o.colorEach && data.series.length === 1);
        const names = perBar ? data.labels.slice(0, 12) : data.series.map((x) => x.name).slice(0, 12);
        const cur = o.colors && o.colors.length ? o.colors : brandPal();
        const presetRow = h('div', { class: 'db-pal-row' }, Object.entries(PRESETS).map(([nm, pal]) => {
          const p = pal || brandPal();
          const on = pal ? JSON.stringify(o.colors || []) === JSON.stringify(pal) : !o.colors;
          return h('button', { class: `db-pal ${on ? 'on' : ''}`, title: nm === 'Brand' ? 'Use the project brand palette' : nm, onclick: () => { o.colors = pal ? pal.slice() : null; draw(); } }, h('span', { class: 'db-pal-sw' }, p.slice(0, 5).map((c) => h('i', { style: { background: c } }))), nm);
        }));
        const sw = h('div', { class: 'db-swatches' }, names.map((nm, i) => h('label', { class: 'db-sw' }, D.colorInput(cur[i % cur.length], (v, done) => { if (!o.colors) o.colors = brandPal().slice(); while (o.colors.length <= i) o.colors.push(brandPal()[o.colors.length % brandPal().length]); o.colors[i] = v; if (done) draw(); }, `Color for ${nm}`), h('span', null, String(nm)))));
        wrap.append(presetRow, names.length ? sw : h('p', { class: 'muted small' }, 'No data to colour yet'));
        if (!round && data.series.length === 1 && o.chartType !== 'line' && o.chartType !== 'area') wrap.append(h('div', { class: 'dash-checks' }, chk('colorEach', 'A different colour for each bar', false, draw)));
        return field('Colours', wrap);
      };

      const draw = () => {
        box.innerHTML = '';
        refreshTitle();
        box.append(field('Title', title));
        if (o.kind === 'kpi') {
          const m = t.byName[o.metric];
          box.append(h('div', { class: 'row2' }, field('Shows', sel(measures, mVal(o), (v) => { setM(o, v); draw(); })),
            m && m.type === 'number' ? field('Calculation', sel([['auto', 'Automatic'], ['sum', 'Sum'], ['avg', 'Average'], ['min', 'Minimum'], ['max', 'Maximum'], ['count', 'Count of filled rows']], o.how || 'auto', (v) => { o.how = v; refreshTitle(); })) : h('span')),
          whereField(),
          h('div', { class: 'dash-checks' }, chk('compare', 'Compare with the previous period', true), chk('lowerBetter', 'Lower is better', !!(m || {}).lowerBetter)));
        }
        if (o.kind === 'chart') {
          const scatter = o.chartType === 'scatter';
          const round = ['doughnut', 'pie'].includes(o.chartType);
          const byOpts = [...(t.dateCols.length ? [['@date', 'Date (over time)']] : []), ...t.periodCols.map((c) => [c.name, `${label(c)} (in order)`]), ...tOpts];
          box.append(h('div', { class: 'row2' }, field('Chart type', sel([['bar', 'Columns'], ['hbar', 'Bars'], ['stacked', 'Stacked columns'], ['line', 'Line'], ['area', 'Area'], ['combo', 'Bars + line'], ['doughnut', 'Doughnut'], ['pie', 'Pie'], ['scatter', 'Scatter']], o.chartType, (v) => { o.chartType = v; draw(); })),
            field(scatter ? 'Points' : 'Group by', sel(byOpts, o.by, (v) => { o.by = v; if (o.split === v) o.split = ''; draw(); }))));
          if (scatter) {
            const nOpts = t.metrics.map((c) => [c.name, label(c)]);
            box.append(h('div', { class: 'row2' }, field('Across (x)', sel(nOpts, o.metric, (v) => { o.metric = v; o.how = 'auto'; })), field('Up (y)', sel(nOpts, o.metric2 || '', (v) => { o.metric2 = v; }))));
          } else {
            box.append(h('div', { class: 'row2' }, field('Shows', sel(measures, mVal(o), (v) => { setM(o, v); draw(); })),
              round ? h('span') : field('Split into series by', sel([['', 'Nothing (one series)'], ...tOpts.filter(([v]) => v !== o.by)], o.split || '', (v) => { o.split = v || undefined; if (v) o.metric2 = undefined; if (v && o.chartType === 'bar' && o.showAs === 'pct') o.chartType = 'stacked'; draw(); }))));
            box.append(h('div', { class: 'row2' },
              field('Values as', sel([['', 'Numbers'], ['pct', o.split ? 'Share of each group (%)' : 'Share of the total (%)']], o.showAs || '', (v) => { o.showAs = v || undefined; if (v && o.split && o.chartType === 'bar') o.chartType = 'stacked'; draw(); })),
              !o.split && !round && t.metrics.length ? field('Second metric', sel([['', 'None'], ...t.metrics.map((c) => [c.name, label(c)])], o.metric2 || '', (v) => { o.metric2 = v || undefined; draw(); })) : h('span')));
            box.append(o.by === '@date' ? field('Date grouping', sel([['auto', 'Automatic'], ['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']], o.bucket || 'auto', (v) => { o.bucket = v; draw(); }))
              : h('div', { class: 'row2' }, field('Show', sel([[0, 'All'], [5, 'Top 5'], [10, 'Top 10'], [15, 'Top 15'], [20, 'Top 20'], [30, 'Top 30']], o.top || 0, (v) => { o.top = +v; draw(); })), field('Sort', sel([['desc', 'Highest first'], ['asc', 'Lowest first'], ['label', 'A to Z'], ['order', 'As in the data']], o.sort || (t.periodCols.some((c) => c.name === o.by) ? 'order' : 'desc'), (v) => { o.sort = v; }))));
            if (o.split) box.append(field('Series to show', sel([[3, 'Biggest 3'], [5, 'Biggest 5'], [8, 'Biggest 8'], [12, 'Biggest 12']], o.splitTop || 8, (v) => { o.splitTop = +v; draw(); })));
          }
          box.append(whereField());
          if (!scatter) box.append(colorField());
          box.append(h('div', { class: 'dash-checks' }, chk('showValues', 'Show values on the chart', false)));
        }
        if (o.kind === 'table') {
          box.append(h('div', { class: 'row2' }, field('Shows', sel([['summary', 'Totals for each group'], ['pivot', 'Counts / totals in a grid (rows × columns)'], ['rows', 'Individual rows']], o.mode, (v) => { o.mode = v; draw(); })),
            o.mode === 'rows' ? field('Sort newest / largest by', sel([['', 'Automatic'], ...t.cols.filter((c) => c.type !== 'text').map((c) => [c.name, label(c)])], o.sortBy || '', (v) => { o.sortBy = v; })) : field(o.mode === 'pivot' ? 'Rows' : 'Group by', sel(tOpts, o.by, (v) => { o.by = v; draw(); }))));
          if (o.mode === 'pivot') {
            box.append(h('div', { class: 'row2' }, field('Columns', sel(tOpts.filter(([v]) => v !== o.by), o.split || '', (v) => { o.split = v; })), field('In each cell', sel(measures, mVal(o), (v) => { setM(o, v); }))));
            box.append(field('Rows to show', sel([[0, 'All'], [10, 'Top 10'], [25, 'Top 25'], [50, 'Top 50']], o.top || 0, (v) => { o.top = +v; })));
          } else {
            const pick = o.mode === 'summary'
              ? [...t.metrics.map((c) => [c.name, label(c)]), ...textCols.filter((c) => c.name !== '__sheet' && c.name !== o.by).map((c) => [`~${c.name}`, `Different ${plural(label(c).toLowerCase())}`])]
              : t.cols.filter((c) => !['constant', 'empty'].includes(c.role)).map((c) => [c.name, label(c)]);
            const chosen = new Set(o.mode === 'summary' ? o.metrics || [] : o.columns || []);
            box.append(field(o.mode === 'summary' ? 'Columns to show (the number of records is always shown)' : 'Columns (up to 10)', h('div', { class: 'dash-chipset' }, pick.map(([v, l]) => { const b = h('button', { class: `chip-t ${chosen.has(v) ? 'on' : ''}` }, l); b.addEventListener('click', () => { if (chosen.has(v)) chosen.delete(v); else chosen.add(v); const list = pick.filter(([x]) => chosen.has(x)).map(([x]) => x); if (o.mode === 'summary') o.metrics = list; else o.columns = list; b.classList.toggle('on'); }); return b; }))),
              field('Show', sel([[0, 'All'], [5, 'Top 5'], [10, 'Top 10'], [15, 'Top 15'], [25, 'Top 25'], [50, 'Top 50']], o.top || 0, (v) => { o.top = +v; })));
          }
          box.append(whereField());
        }
        if (o.kind === 'daterange') box.append(field('Date column', sel(t.dateCols.map((c) => [c.name, label(c)]), o.col, (v) => { o.col = v; })));
        if (o.kind === 'filter' || o.kind === 'sheetfilter') box.append(field('Filter by', sel((o.kind === 'sheetfilter' ? [...t.sheetCols, ...textCols.filter((c) => !t.sheetCols.includes(c))] : textCols).map((c) => [c.name, label(c)]), o.col, (v) => { o.col = v; })), h('div', { class: 'dash-checks' }, chk('multi', 'Allow several values at once', true)));
        if (o.kind === 'text') { const ta = h('textarea', { class: 'input', rows: 4 }); ta.value = o.text || ''; ta.addEventListener('input', () => { o.text = ta.value; }); box.append(field('Text', ta)); }
      };
      draw();
      D.modal({ title: `${KINDS[w.kind].label} widget`, width: 600, body: box, actions: [{ label: 'Cancel' }, { label: 'Apply', primary: true, onClick: () => { Object.keys(w).forEach((k) => { if (!(k in o)) delete w[k]; }); Object.assign(w, o); this.commit(); this.render(); } }] });
    }
  }

  // =================================================================== PDF
  function printPages(sheet) {
    const t = E.table(sheet);
    const W = 1280, colW = (W - 64 - GAP * (COLS - 1)) / COLS;
    const px = (w) => ({ left: 32 + w.x * (colW + GAP), top: 120 + w.y * (ROW + GAP), width: w.w * colW + (w.w - 1) * GAP, height: w.h * ROW + (w.h - 1) * GAP });
    const b = D.brand();
    const rows = E.rows(sheet, t);
    const r = E.activeRange(sheet, t);
    const filt = [r ? `${label(t.byName[r.col])}: ${isFinite(r.from) ? fmtDate(r.from) : 'start'} - ${isFinite(r.to) ? fmtDate(r.to) : 'end'}` : null, ...Object.entries(filtersOf(sheet).vals || {}).filter(([c, l]) => l && l.length && t.byName[c]).map(([c, l]) => `${label(t.byName[c])}: ${l.join(', ')}`)].filter(Boolean);
    let html = `<div style="position:absolute;left:0;top:0;width:${W}px;height:96px;background:${b.dark}"></div><div style="position:absolute;left:0;top:96px;width:${W}px;height:4px;background:${b.primary}"></div>
      <div style="position:absolute;left:32px;top:20px;font:700 26px 'Inter Variable',sans-serif;color:#fff">${D.esc(sheet.name)}</div>
      <div style="position:absolute;left:32px;top:60px;font:400 12px 'Inter Variable',sans-serif;color:#AFC3E8">${D.esc([filt.length ? filt.join(' · ') : 'All data', `${rows.length.toLocaleString()} rows`, new Date().toLocaleDateString()].join(' · '))}</div>`;
    let maxY = 0;
    // filter controls don't print (the active filters are in the subtitle), so close the gaps they leave
    const printed = (sheet.widgets || []).filter((w) => !['daterange', 'filter', 'sheetfilter'].includes(w.kind)).map((w) => ({ ...w }));
    settle(printed);
    for (const w of printed) {
      const p = px(w); maxY = Math.max(maxY, p.top + p.height);
      let inner = '';
      const iw = p.width - 24, ih = p.height - 44;
      const wr = E.where(rows, w);
      if (w.kind === 'kpi') { const m = t.byName[w.metric]; const v = E.agg(wr, m, w.how || 'auto'); inner = `<div style="font:700 ${Math.max(18, Math.min(40, ih * 0.42))}px 'Inter Variable',sans-serif;color:#0B1530;margin-top:4px">${D.esc(w.how === 'count' || w.how === 'distinct' ? String(v ?? 0) : E.fmt(m, v))}</div>`; }
      else if (w.kind === 'chart') { const data = E.chartData(w, t, wr, (filtersOf(sheet).date || {}).col); const png = data.labels.length ? D.charts.toPng(E.chartSpec(w, t, data), Math.round(iw), Math.round(ih), 0.85) : null; inner = png ? `<img src="${png}" style="width:${iw}px;height:${ih}px">` : '<div style="color:#94A3B8;font-size:12px">No data</div>'; }
      else if (w.kind === 'table') { const holder = document.createElement('div'); DashView.prototype.tableWidget.call({ sheet }, holder, w, t, wr); inner = holder.innerHTML; }
      else if (w.kind === 'text') inner = `<div style="font-size:13px;color:#1F2937;white-space:pre-wrap">${D.esc(w.text || '')}</div>`;
      html += `<div class="db-pcard" style="position:absolute;left:${p.left}px;top:${p.top}px;width:${p.width}px;height:${p.height}px"><div class="db-ptitle">${D.esc(titleFor(w, t))}</div><div style="padding:0 12px;overflow:hidden;height:${ih}px">${inner}</div></div>`;
    }
    const css = `<style>.db-pcard{background:#fff;border:1px solid #E2E8F0;border-radius:10px;box-sizing:border-box;overflow:hidden;font-family:'Inter Variable',sans-serif}.db-ptitle{font:600 12.5px 'Inter Variable',sans-serif;color:#334155;padding:10px 12px 6px}.db-table{width:100%;border-collapse:collapse;font-size:11px}.db-table th{text-align:left;color:#64748B;font-weight:600;border-bottom:1px solid #E2E8F0;padding:4px 6px}.db-table td{padding:4px 6px;border-bottom:1px solid #F1F5F9;color:#1F2937}.db-table .num{text-align:right}.db-table tr.total td{font-weight:700;border-top:1px solid #CBD5E1}</style>`;
    const H = Math.max(720, maxY + 32);
    return [{ w: W, h: H, html: `<div style="position:relative;width:${W}px;height:${H}px;background:#F5F7FB">${css}${html}</div>` }];
  }

  D.sheetTypes.dash = {
    label: 'Dashboard Sheet',
    create(name) { return { id: D.uid(), type: 'dash', name, sources: [], widgets: [], filters: { date: null, vals: {} } }; },
    exportPayload() { return {}; },
    printPages,
    mount(host, sheet) { return new DashView(host, sheet); },
    // a dashboard over these sheets with a starter layout
    createFor(sources, name) {
      const s = D.app.addSheet('dash', { activate: false, name: D.uniqueSheetName(name || `${D.sheet(sources[0]).name} Dashboard`) });
      s.sources = sources;
      s.widgets = E.autoBuild(s);
      D.commit();
      D.app.activate(s.id, true);
      return s;
    }
  };
})();
