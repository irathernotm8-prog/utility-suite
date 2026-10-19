// Datum - Quick Dashboard engine: reads a table, works out what each column is, suggests the questions worth
// answering and lays the answers out (landscape, portrait or slides). Every number it places is a live formula.
(function () {
  const F = () => D.f;
  const DS = (D.dash = {});
  const M = 40;

  // ------------------------------------------------------------------ vocabulary
  const RX = {
    ratio: /rate|ratio|%|percent|\bper\b|\bavg\b|average|margin|conversion|\bctr\b|\bcp[acmlrv]\b|\bcpc\b|roas|\broi\b|share|yield|score|index|frequency/i,
    lowerBetter: /cost|\bcp[acmlrv]\b|\bcpc\b|expense|spend per|churn|bounce|refund|complaint|return|defect|latency|delay|downtime|cancel|error|loss|debt|frequency/i,
    id: /(^id$|\bid\b|_id$|zip|postal|phone|code$|sku|account (number|id)|number$|#$)/i,
    time: /date|week|month|period|day|quarter|qtr|\byear\b|\bfy\b|time|\bwk\b/i,
    count: /count|qty|quantity|units|orders|sign.?ups|visits|sessions|leads|clicks|impressions|customers|users|installs|tickets|calls|results|conversions|purchases|reach|views|engagements|subscribers|followers|shares|likes|comments|messages|registrations|downloads|applications/i,
    outcome: /results|conversions|purchases|leads|sign.?ups|orders|sales|registrations|installs|applications|bookings|customers|revenue/i,
    revenue: /revenue|sales|income|profit|gmv|bookings value|mrr|arr/i,
    spend: /spend|spent|cost|budget|expense|investment/i,
    money: /revenue|sales|spend|spent|cost|price|amount|income|profit|budget|mrr|arr|usd|eur|gbp|\$|€|£/i,
    entity: /name|campaign|title|product|item|store|location|market|city|ad set|adset|\bad\b|creative|customer|client|account|keyword|page|channel|source|vendor|employee|\brep\b|team|brand|project|branch|site|region|country|state/i
  };
  const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d{0,4}$|^q[1-4]\b|^w(?:ee)?k\s*\d+|^\d{4}-\d{2}$|^fy\d{2,4}/i;
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const blank = (v) => v === '' || v == null;

  // "Campaign name" → { one: 'campaign', many: 'campaigns' }
  DS.noun = (name) => {
    let s = String(name || '').replace(/\(.*?\)/g, '').replace(/\b(name|names|title|label|id)\b/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!s) s = 'item';
    const many = /(s|x|ch|sh)$/.test(s) ? s + 'es' : /[^aeiou]y$/.test(s) ? s.slice(0, -1) + 'ies' : s + 's';
    return { one: s, many };
  };

  // ------------------------------------------------------------------ profiling
  // overrides: { [col]: role } lets the person correct a guess (time, measure, ratio, dimension, entity, ignore)
  DS.profile = (sheet, range, overrides = {}) => {
    const all = F().parseRange(range);
    const g = all.areas.length > 1 ? all.areas.reduce((a, b) => ({ r1: Math.min(a.r1, b.r1), c1: Math.min(a.c1, b.c1), r2: Math.max(a.r2, b.r2), c2: Math.max(a.c2, b.c2) })) : all.areas[0];
    const cv = (r, c) => F().cellValue(sheet, r, c);
    let hr = g.r1;
    const isText = (v) => typeof v === 'string' && v.trim() !== '' && typeof F().parseLiteral(v) !== 'number';
    const textCount = (r) => { let n = 0; for (let c = g.c1; c <= g.c2; c++) if (isText(cv(r, c))) n++; return n; };
    const width = g.c2 - g.c1 + 1;
    if (textCount(g.r1) < Math.ceil(width / 2) && textCount(g.r1 + 1) >= Math.ceil(width / 2)) hr = g.r1 + 1;
    const hasHeader = textCount(hr) >= Math.max(1, Math.ceil(width / 2));
    const r0 = hasHeader ? hr + 1 : g.r1;
    let rN = r0;
    const used = Math.min(g.r2, F().usedRows(sheet) - 1);
    for (let r = r0; r <= used; r++) {
      let any = false; for (let c = g.c1; c <= g.c2; c++) if (!blank(cv(r, c))) { any = true; break; }
      if (!any) break;
      const first = String(cv(r, g.c1) ?? '');
      if (/^(grand )?totals?\b|^sum$|^average$/i.test(first.trim()) && r > r0) break;
      rN = r;
    }
    const n = rN - r0 + 1;
    const cols = [];
    for (let c = g.c1; c <= g.c2; c++) {
      const name = hasHeader ? String(cv(hr, c) ?? '').trim() || `Column ${F().colName(c)}` : `Column ${F().colName(c)}`;
      const vals = []; let nums = 0, dates = 0, texts = 0, blanks = 0, periodish = 0;
      for (let r = r0; r <= rN; r++) {
        let v = cv(r, c);
        if (typeof v === 'string' && typeof F().parseLiteral(v) === 'number' && !/^\d{4}-\d{1,2}-\d{1,2}/.test(v)) v = F().parseLiteral(v);
        else if (typeof v === 'string' && /^\d{1,2}\/\d{1,2}\/(\d{2}|\d{4})$/.test(v.trim())) { // 9/5/2026 typed as text
          const m = v.trim().split('/'); const y = m[2].length === 2 ? 2000 + +m[2] : +m[2];
          if (+m[0] <= 12 && +m[1] <= 31) v = `${y}-${String(m[0]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
        }
        vals.push(v);
        if (blank(v)) { blanks++; continue; }
        if (isNum(v)) nums++;
        else if (typeof v === 'string' && /^\d{4}-\d{1,2}-\d{1,2}/.test(v)) dates++;
        else { texts++; if (MONTHS.test(String(v).trim()) || /^[A-Za-z]{3,9}\.?\s+\d{1,2}$/.test(String(v).trim())) periodish++; }
      }
      const filled = n - blanks;
      const distinct = new Set(vals.filter((v) => !blank(v)).map((v) => String(v).toLowerCase())).size;
      const fmt = F().styleFmt(sheet, rN, c) || F().styleFmt(sheet, r0, c);
      const col = { c, name, fmt, distinct, n: filled, vals };
      const f = filled || 1;
      if (filled === 0) { col.type = 'empty'; col.role = 'empty'; }
      else if (dates / f >= 0.8) { col.type = 'date'; col.role = distinct >= 3 ? 'time' : distinct === 1 && n > 1 ? 'constant' : 'attr'; }
      else if (nums / f >= 0.8) {
        col.type = 'number';
        const xs = vals.filter(isNum);
        const yearLike = xs.every((v) => Number.isInteger(v) && v >= 1900 && v <= 2100);
        if (RX.id.test(name)) col.role = 'id';
        else if (yearLike && (RX.time.test(name) || distinct === xs.length) && distinct >= 3) { col.role = 'time'; col.type = 'period'; }
        else if (distinct === 1 && n > 2) col.role = 'constant';
        else if (fmt === 'pct' || RX.ratio.test(name)) col.role = 'ratio';
        else col.role = 'measure';
        col.lowerBetter = RX.lowerBetter.test(name);
        col.money = fmt === 'cur' || fmt === 'acct' || RX.money.test(name);
        col.sum = xs.reduce((a, b) => a + b, 0); col.min = Math.min(...xs); col.max = Math.max(...xs);
        col.first = xs[0]; col.last = xs[xs.length - 1]; col.avg = xs.length ? col.sum / xs.length : 0;
        col.allPositive = xs.every((v) => v >= 0);
      } else {
        col.type = 'text';
        if (distinct === 1 && n > 1) col.role = 'constant';
        else if (periodish / f >= 0.6 || (RX.time.test(name) && distinct === filled && periodish > 0)) col.role = 'time';
        else if (distinct === filled && filled >= 2) col.role = 'entity';
        else if (distinct >= 2 && distinct <= Math.max(25, n * 0.5)) col.role = 'dimension';
        else col.role = 'text';
      }
      if (overrides[c]) col.role = overrides[c] === 'ignore' ? 'ignored' : overrides[c];
      cols.push(col);
    }
    // ratios that are really A ÷ B (cost per result = spend ÷ results) get weighted totals, not averages
    detectDerived(cols);
    for (const col of cols) {
      if (col.type !== 'number' || overrides[col.c]) continue;
      if (col.derived && col.role === 'measure') col.role = 'ratio';
    }
    const pickTime = cols.filter((x) => x.role === 'time');
    const time = pickTime.sort((a, b) => (b.type === 'date') - (a.type === 'date') || b.distinct - a.distinct)[0] || null;
    // the column that names each row: campaign, product, store…
    const entities = cols.filter((x) => x.role === 'entity');
    const entity = entities.sort((a, b) => (RX.entity.test(b.name) - RX.entity.test(a.name)) || a.c - b.c)[0] || null;
    entities.forEach((x) => { if (x !== entity) x.role = 'label'; });
    const measures = cols.filter((x) => x.role === 'measure');
    const ratios = cols.filter((x) => x.role === 'ratio');
    const dims = cols.filter((x) => x.role === 'dimension' && x !== time).sort((a, b) => a.distinct - b.distinct);
    let grain = 'row';
    if (time && time.type === 'date') {
      const ds = []; for (let r = r0; r <= rN; r++) { const d = F().toDate(cv(r, time.c)); if (d) ds.push(d); }
      const span = ds.length ? (Math.max(...ds) - Math.min(...ds)) / 86400000 : 0;
      time.from = ds.length ? new Date(Math.min(...ds)) : null; time.to = ds.length ? new Date(Math.max(...ds)) : null;
      time.span = span;
      if (time.distinct < n || n > 36) grain = span <= 70 ? 'week' : span <= 800 ? 'month' : span <= 2200 ? 'quarter' : 'year';
    }
    const corr = [];
    const nums = [...measures, ...ratios];
    for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) {
      const r = pearson(nums[i].vals, nums[j].vals);
      if (r != null && Math.abs(r) >= 0.7) corr.push({ a: nums[i], b: nums[j], r });
    }
    corr.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
    const p = { sheet, range, g, hr, hasHeader, r0, rN, n, cols, time, entity, measures, ratios, dims, grain, corr, overrides };
    p.mode = time ? 'trend' : entity || dims.length ? 'compare' : 'summary';
    p.context = contextLine(p);
    p.noun = entity ? DS.noun(entity.name) : { one: 'row', many: 'rows' };
    return p;
  };

  function pearson(a, b) {
    const xs = [], ys = [];
    a.forEach((v, i) => { if (isNum(v) && isNum(b[i])) { xs.push(v); ys.push(b[i]); } });
    const n = xs.length; if (n < 4) return null;
    const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
  }

  function detectDerived(cols) {
    const nums = cols.filter((x) => x.type === 'number' && !['id', 'time', 'constant', 'ignored'].includes(x.role));
    const countish = (c) => (RX.count.test(c.name) || (RX.money.test(c.name) && !/price|cost per|\bper\b/i.test(c.name))) && !RX.ratio.test(c.name.replace(/\(.*?\)/g, ''));
    for (const x of nums) {
      if (countish(x)) continue; // results, clicks, spend… are amounts even when they equal another pair's ratio
      let found = null;
      outer: for (const a of nums) {
        if (a === x) continue;
        for (const b of nums) {
          if (b === x || b === a || (RX.ratio.test(b.name) && !countish(b))) continue;
          if (b.vals.filter(isNum).every((v) => v === 1)) continue;
          for (const k of [1, 100, 1000]) {
            let ok = 0, tot = 0;
            x.vals.forEach((xv, i) => { const av = a.vals[i], bv = b.vals[i]; if (!isNum(xv) || !isNum(av) || !isNum(bv) || bv === 0) return; tot++; if (Math.abs(av / bv * k - xv) <= Math.max(1e-6, Math.abs(xv) * 0.02)) ok++; });
            if (tot >= 2 && ok / tot >= 0.8) { found = { a, b, k, kind: 'div' }; break outer; }
          }
          // (a - b) ÷ a, e.g. margin
          let ok = 0, tot = 0;
          x.vals.forEach((xv, i) => { const av = a.vals[i], bv = b.vals[i]; if (!isNum(xv) || !isNum(av) || !isNum(bv) || av === 0) return; tot++; const e = (av - bv) / av; if (Math.abs(e - xv) <= 0.002 || Math.abs(e * 100 - xv) <= 0.2) ok++; });
          if (tot >= 2 && ok / tot >= 0.8 && RX.ratio.test(x.name)) { found = { a, b, k: Math.abs(x.max) > 1.5 ? 100 : 1, kind: 'margin' }; break outer; }
        }
      }
      if (found) x.derived = found;
    }
  }

  function contextLine(p) {
    const bits = [];
    const consts = p.cols.filter((x) => x.role === 'constant');
    const dc = consts.filter((x) => x.type === 'date');
    const nice = (v) => { const d = F().toDate(v); return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : String(v); };
    if (dc.length) {
      const start = dc.find((x) => /start|from|begin/i.test(x.name)) || dc[0];
      const end = dc.find((x) => x !== start && /end|to\b|through|until/i.test(x.name));
      const sv = start.vals.find((v) => !blank(v));
      bits.push(end ? `${nice(sv)} - ${nice(end.vals.find((v) => !blank(v)))}` : nice(sv));
    }
    return bits.join(' · ');
  }

  DS.describe = (p) => {
    const bits = [];
    if (p.time && p.time.type === 'date' && p.time.from) bits.push(`${p.n} rows from ${p.time.from.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} to ${p.time.to.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`);
    else if (p.time) bits.push(`${p.n} ${/week/i.test(p.time.name) ? 'weeks' : /month/i.test(p.time.name) ? 'months' : 'periods'} (${F().display(p.sheet, p.r0, p.time.c)} - ${F().display(p.sheet, p.rN, p.time.c)})`);
    else if (p.entity) bits.push(`${p.n} ${p.noun.many}${p.context ? ` (${p.context})` : ''}, one per row`);
    else bits.push(`${p.n} rows`);
    if (p.measures.length) bits.push(`${p.measures.length} measure${p.measures.length > 1 ? 's' : ''}`);
    if (p.ratios.length) bits.push(`${p.ratios.length} rate${p.ratios.length > 1 ? 's' : ''}`);
    const weighted = p.ratios.filter((r) => r.derived);
    if (weighted.length) bits.push(`${weighted.map((r) => r.name).slice(0, 2).join(' and ')} worked out from the totals`);
    if (p.dims.length) bits.push(`groups: ${p.dims.map((d) => d.name).slice(0, 2).join(', ')}`);
    if (p.grain !== 'row') bits.push(`summarised by ${p.grain}`);
    const skipped = p.cols.filter((x) => ['constant', 'empty'].includes(x.role)).length;
    if (skipped) bits.push(`${skipped} column${skipped > 1 ? 's' : ''} that never change set aside`);
    return bits.join(' · ');
  };

  // ------------------------------------------------------------------ metrics (columns + calculated)
  // A metric is anything numeric the dashboard can total, rank or chart.
  const metricOfCol = (col) => ({ key: String(col.c), c: col.c, name: col.name, role: col.role, fmt: col.fmt, money: col.money, lowerBetter: col.lowerBetter, derived: col.derived, allPositive: col.allPositive, sum: col.sum, max: col.max, min: col.min, avg: col.avg, first: col.first, last: col.last, col });
  // suggested calculated metrics the data supports but doesn't contain yet (CTR, CPM, ROAS…)
  DS.autoMetrics = (p) => {
    const ms = p.measures;
    const find = (re) => ms.find((m) => re.test(m.name));
    const has = (re) => p.cols.some((c) => re.test(c.name));
    const spend = ms.find((m) => RX.spend.test(m.name) && m.money) || find(/spend|spent|cost/i);
    const impr = find(/impression/i), clicks = find(/click/i), revenue = find(RX.revenue);
    const outcome = ms.find((m) => RX.outcome.test(m.name) && !RX.money.test(m.name) && m !== clicks);
    const out = [];
    const add = (id, name, a, b, k, fmt, lowerBetter, money) => { if (a && b) out.push({ id, name, a: a.c, b: b.c, op: '/', k, fmt, lowerBetter, money }); };
    if (!has(/\bctr\b|click.?through/i)) add('ctr', 'CTR', clicks, impr, 1, 'pct', false, false);
    if (!has(/\bcpm\b/i)) add('cpm', 'CPM', spend, impr, 1000, 'cur', true, true);
    if (!has(/\bcpc\b|cost per click/i)) add('cpc', 'Cost per click', spend, clicks, 1, 'cur', true, true);
    if (outcome && !has(new RegExp(`cost per ${outcome.name.split(/\s/)[0]}|\\bcp[alr]\\b|cost per result`, 'i'))) add('cpo', `Cost per ${outcome.name.toLowerCase().replace(/s$/, '')}`, spend, outcome, 1, 'cur', true, true);
    if (revenue && spend && revenue !== spend && !has(/roas|return on ad/i)) add('roas', 'ROAS', revenue, spend, 1, 'num', false, false);
    if (outcome && clicks && !has(/conversion rate|conv\.? rate/i)) add('cvr', 'Conversion rate', outcome, clicks, 1, 'pct', false, false);
    return out;
  };

  DS.metrics = (p, calcDefs = []) => {
    const list = [...p.measures, ...p.ratios].sort((a, b) => a.c - b.c).map(metricOfCol);
    for (const d of calcDefs) {
      const a = p.cols.find((x) => x.c === d.a), b = p.cols.find((x) => x.c === d.b);
      if (!a || !b) continue;
      const vals = a.vals.map((av, i) => { const bv = b.vals[i]; if (!isNum(av) || !isNum(bv)) return null; if (d.op === '/') return bv ? av / bv * (d.k || 1) : null; if (d.op === '-') return av - bv; if (d.op === '+') return av + bv; return av * bv; });
      const xs = vals.filter(isNum);
      list.push({ key: 'x:' + d.id, def: d, a, b, name: d.name, role: d.op === '/' ? 'ratio' : 'measure', fmt: d.fmt || null, money: !!d.money, lowerBetter: !!d.lowerBetter, allPositive: xs.every((v) => v >= 0), sum: xs.reduce((s, v) => s + v, 0), max: Math.max(...xs), min: Math.min(...xs), avg: xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0, first: xs[0], last: xs[xs.length - 1], col: { vals } });
    }
    return list;
  };

  // ------------------------------------------------------------------ formula helpers
  const q = (s) => F().quoteSheet(s.name);
  const A = (r, c) => F().addr(r, c);
  const colRng = (p, c) => `${q(p.sheet)}!${A(p.r0, c)}:${A(p.rN, c)}`;
  const moneyFmt = (m) => (Math.abs(m.max || 0) >= 100 ? '$#,##0' : '$#,##0.00');
  const textFmtFor = (m) => (m.fmt === 'pct' ? '0.0%' : m.fmt === 'cur' || m.fmt === 'cur0' || m.fmt === 'acct' || m.money ? moneyFmt(m) : Math.abs(m.max || 0) < 10 && !Number.isInteger(m.avg) ? '#,##0.00' : '#,##0');
  const T = (expr, m) => `{{TEXT(${expr},"${textFmtFor(m).replace(/"/g, '""')}")}}`;
  const kfmt = (m) => {
    if (!m) return 'auto';
    const big = Math.max(Math.abs(m.max || 0), Math.abs(m.sum || 0)) >= 1000;
    if (m.fmt === 'pct') return 'pct';
    if (/^(cur|acct)$/.test(m.fmt || '') || (!m.fmt && m.money)) return m.role === 'ratio' ? 'cur' : big ? 'cur0' : 'cur';
    if (m.fmt) return m.fmt;
    return m.role === 'ratio' || !Number.isInteger(m.sum || 0) ? 'num' : 'int';
  };
  const vfOf = (m) => (m.fmt === 'pct' ? 'pct' : m.money || /^(cur|acct)/.test(m.fmt || '') ? (Math.abs(m.max || 0) >= 100 && m.role !== 'ratio' ? 'cur0' : 'cur') : m.role === 'ratio' || !Number.isInteger(m.sum || 0) ? 'num' : 'int');
  const cellFmt = (m) => (m.fmt ? { fmt: m.fmt } : m.money ? { fmt: 'cur' } : m.role === 'ratio' ? { fmt: 'num' } : null);
  // names inside sentences: "Amount spent (USD)" → "amount spent", "Clicks (all)" → "clicks", CTR stays CTR
  const lower = (s) => String(s).replace(/\s*\((usd|eur|gbp|cad|aud|\$|€|£|all|total|#|%)\)/gi, '').replace(/\b([A-Z])([a-z]+)/g, (m, a, b) => a.toLowerCase() + b).trim();

  // ------------------------------------------------------------------ the helper "Calc" sheet
  // Grouped periods, breakdowns, live-sorted rankings and calculated columns - all formulas.
  function Calc(p) {
    const src = p.sheet;
    let sheet = null, col = 0;
    const helpers = {};
    const ensure = () => {
      if (!sheet) { sheet = D.sheetTypes.data.create(D.uniqueSheetName(`${src.name} · Calc`)); sheet.calcOf = src.id; sheet.frozen = 1; sheet.note = `Built by Quick report from ${src.name}. Values are live formulas.`; sheet.colWidths = {}; }
      return sheet;
    };
    const set = (r, c, v, st) => { const s = ensure(); while (s.cells.length <= r + 1) s.cells.push(Array(s.cells[0].length).fill('')); while (s.cells[0].length <= c + 1) s.cells.forEach((row) => row.push('')); s.cells[r][c] = String(v); if (st) s.styles[`${r},${c}`] = st; else delete s.styles[`${r},${c}`]; };
    const hdr = { b: true, fill: '#EAF1FF' };
    const block = (w) => { ensure(); const c0 = col; col += w + 1; return c0; };
    const ref = (r, c) => `${q(ensure())}!${A(r, c)}`;
    const rng = (r1, c, r2) => `${q(ensure())}!${A(r1, c)}:${A(r2, c)}`;
    const api = {
      get sheet() { return sheet; },
      used: () => !!sheet,
      // per-row values for a calculated metric, aligned with the source rows
      helper(m) {
        if (helpers[m.key]) return helpers[m.key];
        const c0 = block(1);
        set(0, c0, m.name, hdr);
        const d = m.def;
        for (let i = 0; i < p.n; i++) {
          const a = `${q(src)}!${A(p.r0 + i, d.a)}`, b = `${q(src)}!${A(p.r0 + i, d.b)}`;
          const f = d.op === '/' ? `=IFERROR(${a}/${b}${d.k && d.k !== 1 ? '*' + d.k : ''},"")` : `=IFERROR(${a}${d.op === '-' ? '-' : d.op === '+' ? '+' : '*'}${b},"")`;
          set(i + 1, c0, f, cellFmt(m));
        }
        sheet.colWidths[c0] = 110;
        return (helpers[m.key] = rng(1, c0, p.n));
      },
      ref, rng, set, block, hdr
    };
    return api;
  }

  // expressions for one metric: per-row range, whole-table total, and conditional total
  function exprs(p, calc) {
    const rows = (m) => (m.c != null ? colRng(p, m.c) : calc.helper(m));
    const agg = (m) => {
      if (m.def) {
        const a = colRng(p, m.def.a), b = colRng(p, m.def.b);
        if (m.def.op === '/') return `IFERROR(SUM(${a})/SUM(${b})${m.def.k !== 1 ? '*' + m.def.k : ''},0)`;
        if (m.def.op === '-') return `SUM(${a})-SUM(${b})`;
        if (m.def.op === '+') return `SUM(${a})+SUM(${b})`;
        return `SUM(${rows(m)})`;
      }
      if (m.derived) {
        const a = colRng(p, m.derived.a.c), b = colRng(p, m.derived.b.c);
        return m.derived.kind === 'margin' ? `IFERROR((SUM(${a})-SUM(${b}))/SUM(${a})${m.derived.k !== 1 ? '*' + m.derived.k : ''},0)` : `IFERROR(SUM(${a})/SUM(${b})${m.derived.k !== 1 ? '*' + m.derived.k : ''},0)`;
      }
      return m.role === 'ratio' ? `AVERAGE(${rows(m)})` : `SUM(${rows(m)})`;
    };
    const aggIf = (m, crit) => {
      const S = (r) => `SUMIFS(${r},${crit})`;
      if (m.def) {
        const a = colRng(p, m.def.a), b = colRng(p, m.def.b);
        if (m.def.op === '/') return `IFERROR(${S(a)}/${S(b)}${m.def.k !== 1 ? '*' + m.def.k : ''},0)`;
        if (m.def.op === '-') return `${S(a)}-${S(b)}`;
        if (m.def.op === '+') return `${S(a)}+${S(b)}`;
        return S(rows(m));
      }
      if (m.derived) {
        const a = colRng(p, m.derived.a.c), b = colRng(p, m.derived.b.c);
        return m.derived.kind === 'margin' ? `IFERROR((${S(a)}-${S(b)})/${S(a)}${m.derived.k !== 1 ? '*' + m.derived.k : ''},0)` : `IFERROR(${S(a)}/${S(b)}${m.derived.k !== 1 ? '*' + m.derived.k : ''},0)`;
      }
      return m.role === 'ratio' ? `IFERROR(AVERAGEIFS(${rows(m)},${crit}),0)` : S(rows(m));
    };
    return { rows, agg, aggIf, additive: (m) => m.role === 'measure' && m.allPositive };
  }

  // ------------------------------------------------------------------ suggestions (the plain-language questions)
  DS.pickMain = (p, metrics) => {
    const ms = metrics.filter((m) => m.role === 'measure');
    const rs = metrics.filter((m) => m.role === 'ratio');
    const revenue = ms.find((m) => RX.revenue.test(m.name));
    const spend = ms.find((m) => RX.spend.test(m.name) && m.money) || ms.find((m) => RX.spend.test(m.name));
    const outcome = ms.find((m) => RX.outcome.test(m.name) && !RX.money.test(m.name) && !/click|impression/i.test(m.name)) || ms.find((m) => RX.outcome.test(m.name) && m !== spend);
    const primary = revenue || outcome || spend || ms.find((m) => !m.lowerBetter) || ms[0] || rs[0];
    const efficiency = rs.filter((r) => r.derived || r.def).sort((a, b) => (outcome && (b.derived?.b === outcome.col || b.def?.b === outcome.c)) - (outcome && (a.derived?.b === outcome.col || a.def?.b === outcome.c)))[0] || rs.find((r) => r.lowerBetter) || rs[0] || null;
    return { primary, spend, outcome, revenue, efficiency, secondary: (spend && spend !== primary ? spend : null) || ms.find((m) => m !== primary) || rs.find((r) => r !== primary) || null };
  };

  DS.suggest = (p, metrics) => {
    const k = DS.pickMain(p, metrics);
    const out = [];
    const add = (id, qtext, why, view, rec) => out.push({ id, q: qtext, why, view, rec: !!rec });
    const N = p.noun, by = p.entity ? 'entity' : p.dims[0] ? p.dims[0].c : null;
    const groupName = p.entity ? N.one : p.dims[0] ? DS.noun(p.dims[0].name).one : '';
    const groupMany = p.entity ? N.many : p.dims[0] ? DS.noun(p.dims[0].name).many : '';
    const prim = k.primary;
    if (!prim) return out;
    if (p.mode === 'trend') {
      add('trend', `How has ${lower(prim.name)} changed over time?`, `Charts ${prim.name} for each ${p.grain === 'row' ? 'period' : p.grain}, with the latest compared to the one before.`, { kind: 'trend', metrics: [prim.key] }, true);
      if (k.secondary) add('trend2', `Is ${lower(k.secondary.name)} keeping pace?`, `${k.secondary.name} over the same periods${k.secondary.lowerBetter ? ' (lower is better)' : ''}.`, { kind: 'trend', metrics: [k.secondary.key], chartType: 'line' }, true);
      if (k.efficiency && k.efficiency !== k.secondary && k.efficiency !== prim) add('trendEff', `Are we getting more efficient?`, `${k.efficiency.name} over time${k.efficiency.lowerBetter ? ' - falling is good' : ''}.`, { kind: 'trend', metrics: [k.efficiency.key], chartType: 'line' }, false);
      if (p.dims[0]) add('breakdown', `Which ${DS.noun(p.dims[0].name).one} contributes the most?`, `${prim.name} split by ${p.dims[0].name}, with each one's share.`, { kind: 'rank', by: p.dims[0].c, metrics: [prim.key] }, true);
      if (p.dims[1]) add('breakdown2', `How does ${p.dims[1].name} compare?`, `${prim.name} by ${p.dims[1].name}.`, { kind: 'share', by: p.dims[1].c, metrics: [prim.key] }, false);
      const c = p.corr.find((x) => x.a.c === prim.c || x.b.c === prim.c);
      if (c) add('relation', `Do ${lower(c.a.name)} and ${lower(c.b.name)} move together?`, `A scatter of the two, with how closely they track.`, { kind: 'scatter', metrics: [String(c.a.c), String(c.b.c)] }, false);
      add('table', 'Show me the detail', 'The latest rows of your data as a table.', { kind: 'table' }, true);
    } else if (by != null) {
      const spend = k.spend && k.spend !== prim ? k.spend : null;
      if (spend) add('spend', `Where is the ${lower(spend.name)} going?`, `Ranks ${groupMany} by ${spend.name}${p.n <= 8 ? ', with each one\'s share' : ''}.`, { kind: p.n <= 6 ? 'share' : 'rank', by, metrics: [spend.key] }, true);
      add('rank', `Which ${groupMany} get the most ${lower(prim.name)}?`, `Ranks every ${groupName} by ${prim.name}, highest first.`, { kind: 'rank', by, metrics: [prim.key] }, true);
      if (k.efficiency) add('efficiency', `Which ${groupMany} are most efficient?`, `Ranks ${groupMany} by ${k.efficiency.name}${k.efficiency.lowerBetter ? ', lowest (best) first' : ', best first'}, against the overall figure.`, { kind: 'rank', by, metrics: [k.efficiency.key], dir: k.efficiency.lowerBetter ? 'asc' : 'desc' }, true);
      if (spend && prim) add('relation', `Does more ${lower(spend.name)} bring more ${lower(prim.name)}?`, `Plots each ${groupName} by ${spend.name} and ${prim.name}, so outliers stand out.`, { kind: 'scatter', by, metrics: [spend.key, prim.key] }, p.entity && p.n >= 5);
      else { const c = p.corr[0]; if (c) add('relation', `Do ${lower(c.a.name)} and ${lower(c.b.name)} go together?`, `A scatter of every ${groupName}.`, { kind: 'scatter', by, metrics: [String(c.a.c), String(c.b.c)] }, false); }
      if (spend && k.efficiency) add('combo', `${spend.name} vs ${k.efficiency.name}, side by side`, `Bars for ${spend.name}, a line for ${k.efficiency.name}, for every ${groupName}.`, { kind: 'compare', by, metrics: [spend.key, k.efficiency.key] }, false);
      if (prim.role === 'measure' && prim.allPositive && p.n > 6) add('share', `How concentrated is ${lower(prim.name)}?`, `The top ${groupMany} against everyone else.`, { kind: 'share', by, metrics: [prim.key] }, false);
      if (p.entity && p.dims[0]) add('group', `How does each ${DS.noun(p.dims[0].name).one} do?`, `${prim.name} added up by ${p.dims[0].name}.`, { kind: 'rank', by: p.dims[0].c, metrics: [prim.key] }, false);
      add('table', `Give me the full ranking`, `A table of every ${groupName} with the key numbers, sorted by ${prim.name}.`, { kind: 'table', by, metrics: [prim.key, spend && spend.key, k.efficiency && k.efficiency.key].filter(Boolean) }, true);
    } else {
      add('rows', `How does ${lower(prim.name)} vary?`, `${prim.name} for each row.`, { kind: 'trend', metrics: [prim.key] }, true);
      add('table', 'Show me the detail', 'Your rows as a table.', { kind: 'table' }, true);
    }
    return out;
  };

  DS.defaultKpis = (p, metrics) => {
    const k = DS.pickMain(p, metrics);
    const list = [];
    const push = (x) => { if (x && !list.includes(x)) list.push(x); };
    if (p.mode === 'trend') {
      if (k.primary) { push(k.primary.key); push('latest:' + k.primary.key); }
      if (k.secondary) push('latest:' + k.secondary.key);
      if (k.efficiency && k.efficiency !== k.secondary) push(k.efficiency.key);
      else if (p.dims[0]) push('top:' + p.dims[0].c);
    } else {
      if (k.spend && k.spend !== k.primary) push(k.spend.key);
      if (k.primary) push(k.primary.key);
      if (k.efficiency) push(k.efficiency.key);
      const more = metrics.filter((m) => m.role === 'ratio' && m.key !== (k.efficiency && k.efficiency.key) && (m.derived || m.def));
      if (more[0]) push(more[0].key);
      if (list.length < 4 && p.entity) push('count');
      if (list.length < 4) { const m = metrics.find((x) => x.role === 'measure' && !list.includes(x.key)); if (m) push(m.key); }
    }
    return list.slice(0, 4);
  };

  // ------------------------------------------------------------------ the story: views → charts, KPIs, insights, tables
  function plan(p, o, metrics) {
    const calc = Calc(p);
    const X = exprs(p, calc);
    const byKey = (key) => metrics.find((m) => m.key === String(key)) || null;
    const story = { calc, kpis: [], sections: [], headline: [], tables: [] };
    const N = p.noun;
    const dimCol = (by) => (by === 'entity' || by == null ? p.entity : p.cols.find((c) => c.c === Number(by))) || null;
    const grouped = (by) => { const d = dimCol(by); return d && d !== p.entity && d.role !== 'entity'; };

    // --- time series (period table when dates repeat)
    let period = null;
    const periodTable = () => {
      if (period) return period;
      if (p.grain === 'row' || !p.time) return (period = { rows: false });
      const ds = []; for (let r = p.r0; r <= p.rN; r++) { const d = F().toDate(F().cellValue(p.sheet, r, p.time.c)); if (d) ds.push(d); }
      const lo = new Date(Math.min(...ds)), hi = new Date(Math.max(...ds));
      const startOf = (d) => (p.grain === 'week' ? (() => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; })() : p.grain === 'month' ? new Date(d.getFullYear(), d.getMonth(), 1) : p.grain === 'quarter' ? new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1) : new Date(d.getFullYear(), 0, 1));
      const next = (d) => (p.grain === 'week' ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7) : p.grain === 'month' ? new Date(d.getFullYear(), d.getMonth() + 1, 1) : p.grain === 'quarter' ? new Date(d.getFullYear(), d.getMonth() + 3, 1) : new Date(d.getFullYear() + 1, 0, 1));
      const periods = [];
      for (let d = startOf(lo); d <= hi && periods.length < 400; d = next(d)) periods.push([d, new Date(next(d).getTime() - 86400000)]);
      const label = (d) => (p.grain === 'week' ? 'Wk of ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : p.grain === 'month' ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : p.grain === 'quarter' ? `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}` : String(d.getFullYear()));
      const used = metrics.filter((m) => m.role === 'measure' || m.role === 'ratio').slice(0, 10);
      const c0 = calc.block(3 + used.length + 1);
      calc.set(0, c0, p.grain[0].toUpperCase() + p.grain.slice(1), calc.hdr); calc.set(0, c0 + 1, 'Start', calc.hdr); calc.set(0, c0 + 2, 'End', calc.hdr);
      used.forEach((m, i) => calc.set(0, c0 + 3 + i, m.name, calc.hdr));
      calc.set(0, c0 + 3 + used.length, 'Rows', calc.hdr);
      const dR = colRng(p, p.time.c);
      periods.forEach(([a, b], i) => {
        const r = i + 1;
        calc.set(r, c0, label(a)); calc.set(r, c0 + 1, F().isoDate(a), { fmt: 'date' }); calc.set(r, c0 + 2, F().isoDate(b), { fmt: 'date' });
        const crit = `${dR},">="&${A(r, c0 + 1)},${dR},"<="&${A(r, c0 + 2)}`;
        used.forEach((m, k) => calc.set(r, c0 + 3 + k, '=' + X.aggIf(m, crit), cellFmt(m)));
        calc.set(r, c0 + 3 + used.length, `=COUNTIFS(${crit})`);
      });
      calc.sheet.colWidths[c0] = 110; calc.sheet.colWidths[c0 + 1] = 96; calc.sheet.colWidths[c0 + 2] = 96;
      return (period = { rows: true, c0, n: periods.length, col: (m) => c0 + 3 + used.indexOf(m), has: (m) => used.includes(m) });
    };
    const series = (m) => {
      const pt = periodTable();
      if (pt.rows && pt.has(m)) return { vals: calc.rng(1, pt.col(m), pt.n), labels: calc.rng(1, pt.c0, pt.n), count: pt.n, link: { sheetId: calc.sheet.id, range: `${A(0, pt.c0)}:${A(pt.n, pt.c0)},${A(0, pt.col(m))}:${A(pt.n, pt.col(m))}` } };
      const top = p.hasHeader ? p.hr : p.r0;
      if (m.c == null) { const r = calc.helper(m); const hc = F().parseRange(r.split('!')[1]).c1; return { vals: r, labels: p.time ? colRng(p, p.time.c) : null, count: p.n, link: null, helperCol: hc }; }
      return { vals: colRng(p, m.c), labels: p.time ? colRng(p, p.time.c) : null, count: p.n, link: { sheetId: p.sheet.id, range: p.time ? `${A(top, p.time.c)}:${A(p.rN, p.time.c)},${A(top, m.c)}:${A(p.rN, m.c)}` : `${A(top, m.c)}:${A(p.rN, m.c)}` } };
    };
    const unit = () => (periodTable().rows ? p.grain : /week/i.test(p.time ? p.time.name : '') ? 'week' : /month/i.test(p.time ? p.time.name : '') ? 'month' : /quarter|qtr/i.test(p.time ? p.time.name : '') ? 'quarter' : /year|fy/i.test(p.time ? p.time.name : '') ? 'year' : 'period');

    // --- live-sorted ranking of rows (one row per entity)
    const rankBlock = (metricsIn, sortM, dir, topN) => {
      const labels = colRng(p, p.entity.c);
      const nRows = Math.min(topN || p.n, p.n);
      const c0 = calc.block(1 + metricsIn.length);
      const s = dir === 'asc' ? 1 : -1;
      calc.set(0, c0, p.entity.name, calc.hdr);
      const sortBy = X.rows(sortM);
      calc.set(1, c0, `=TAKE(SORTBY(${labels},${sortBy},${s}),${nRows})`);
      metricsIn.forEach((m, i) => { calc.set(0, c0 + 1 + i, m.name, calc.hdr); calc.set(1, c0 + 1 + i, `=TAKE(SORTBY(${X.rows(m)},${sortBy},${s}),${nRows})`, cellFmt(m)); for (let r = 2; r <= nRows; r++) { const st = cellFmt(m); if (st) calc.sheet.styles[`${r},${c0 + 1 + i}`] = st; } });
      calc.sheet.colWidths[c0] = 170;
      return { c0, n: nRows, col: (m) => c0 + 1 + metricsIn.indexOf(m), labels: calc.rng(1, c0, nRows), vals: (m) => calc.rng(1, c0 + 1 + metricsIn.indexOf(m), nRows) };
    };
    // --- grouped totals for a category column (static order, live values)
    const groupBlock = (d, metricsIn, sortM, dir, topN) => {
      const groups = new Map();
      const sv = sortM.col.vals;
      d.vals.forEach((v, i) => { if (blank(v)) return; const k2 = String(v); const g = groups.get(k2) || { n: 0, s: 0, w: 0 }; g.n++; if (isNum(sv[i])) g.s += sv[i]; groups.set(k2, g); });
      const score = (g) => (sortM.role === 'ratio' ? g.s / (g.n || 1) : g.s);
      let cats = [...groups.entries()].sort((a, b) => (dir === 'asc' ? score(a[1]) - score(b[1]) : score(b[1]) - score(a[1]))).map(([k2]) => k2);
      const top = cats.slice(0, topN || 12);
      const other = cats.length > top.length && metricsIn.every((m) => m.role === 'measure');
      const c0 = calc.block(2 + metricsIn.length);
      calc.set(0, c0, d.name, calc.hdr);
      metricsIn.forEach((m, i) => calc.set(0, c0 + 1 + i, m.name, calc.hdr));
      calc.set(0, c0 + 1 + metricsIn.length, 'Rows', calc.hdr);
      const dR = colRng(p, d.c);
      top.forEach((k2, i) => {
        const r = i + 1;
        calc.set(r, c0, k2);
        metricsIn.forEach((m, j) => calc.set(r, c0 + 1 + j, '=' + X.aggIf(m, `${dR},${A(r, c0)}`), cellFmt(m)));
        calc.set(r, c0 + 1 + metricsIn.length, `=COUNTIFS(${dR},${A(r, c0)})`);
      });
      let rows = top.length;
      if (other) {
        const r = top.length + 1;
        calc.set(r, c0, `Other (${cats.length - top.length})`);
        metricsIn.forEach((m, j) => calc.set(r, c0 + 1 + j, `=${X.agg(m)}-SUM(${A(1, c0 + 1 + j)}:${A(r - 1, c0 + 1 + j)})`, cellFmt(m)));
        calc.set(r, c0 + 1 + metricsIn.length, `=COUNTA(${dR})-SUM(${A(1, c0 + 1 + metricsIn.length)}:${A(r - 1, c0 + 1 + metricsIn.length)})`);
        rows++;
      }
      calc.sheet.colWidths[c0] = 150;
      return { c0, n: rows, col: (m) => c0 + 1 + metricsIn.indexOf(m), labels: calc.rng(1, c0, rows), vals: (m) => calc.rng(1, c0 + 1 + metricsIn.indexOf(m), rows), countCol: c0 + 1 + metricsIn.length };
    };
    const linkOf = (b, ms, withCount) => ({ sheetId: calc.sheet.id, range: [`${A(0, b.c0)}:${A(b.n, b.c0)}`, ...ms.map((m) => `${A(0, b.col(m))}:${A(b.n, b.col(m))}`), ...(withCount ? [`${A(0, b.countCol)}:${A(b.n, b.countCol)}`] : [])].join(',') });

    // ---- KPIs
    const kpiList = (o.kpiKeys && o.kpiKeys.length ? o.kpiKeys : DS.defaultKpis(p, metrics)).slice(0, 8);
    for (const key of kpiList) {
      if (key === 'count') { story.kpis.push({ label: `${N.many[0].toUpperCase()}${N.many.slice(1)}`, expr: `=COUNTA(${colRng(p, p.entity ? p.entity.c : p.cols[0].c)})`, format: 'int' }); continue; }
      if (String(key).startsWith('top:')) {
        const d = dimCol(key.slice(4) === 'entity' ? 'entity' : Number(key.slice(4)));
        const main = DS.pickMain(p, metrics).primary;
        if (!d || !main) continue;
        if (d === p.entity) story.kpis.push({ label: `Top ${DS.noun(d.name).one} by ${lower(main.name)}`, expr: `=INDEX(${colRng(p, d.c)},MATCH(MAX(${X.rows(main)}),${X.rows(main)},0))`, format: 'auto' });
        else { const b = groupBlock(d, [main], main, 'desc', 12); story.kpis.push({ label: `Top ${DS.noun(d.name).one}`, expr: `=${calc.ref(1, b.c0)}`, format: 'auto' }); }
        continue;
      }
      const latest = String(key).startsWith('latest:');
      const m = byKey(latest ? key.slice(7) : key);
      if (!m) continue;
      if (latest && p.time) {
        const s = series(m); const u = unit();
        if (s.count < 2) continue;
        story.kpis.push({ label: `${m.name} · latest ${u}`, expr: `=INDEX(${s.vals},${s.count})`, compareExpr: `=INDEX(${s.vals},${s.count - 1})`, compareLabel: `vs prior ${u}`, lowerIsBetter: m.lowerBetter, format: kfmt(m) });
      } else {
        const label = m.role === 'ratio' ? (m.derived || m.def ? `${m.name} · overall` : (/^(avg|average|mean)\b/i.test(m.name) ? m.name : `Avg ${m.name}`)) : `Total ${m.name}`;
        story.kpis.push({ label, expr: '=' + X.agg(m), format: kfmt(m) });
      }
    }

    // ---- headline sentence
    const main = DS.pickMain(p, metrics);
    if (p.mode !== 'trend' && p.entity) {
      const ms = [main.spend, main.primary !== main.spend ? main.primary : null].filter(Boolean);
      if (ms.length) {
        let s = `Across ${p.n} ${N.many}${p.context ? ` (${p.context})` : ''}: ${ms.map((m) => `${T(X.agg(m), m)} ${lower(m.name)}`).join(' and ')}`;
        if (main.efficiency) s += `, at ${T(X.agg(main.efficiency), main.efficiency)} ${lower(main.efficiency.name)} overall`;
        story.headline.push(s + '.');
      }
    }

    // ---- views
    const views = (o.views && o.views.length) ? o.views : DS.suggest(p, metrics).filter((s) => s.rec).map((s) => s.view);
    for (const v of views) {
      const ms = (v.metrics || []).map(byKey).filter(Boolean);
      const m = ms[0] || main.primary;
      const sec = { charts: [], insights: [], title: v.title, kind: v.kind };
      try {
        if (v.kind === 'trend') {
          if (!m) continue;
          const u = unit();
          const list = ms.length ? ms : [m];
          if (list.length === 1 || !p.time) {
            const s = series(m);
            let link = s.link;
            if (!link) { const hc = s.helperCol; link = p.time ? { sheetId: p.sheet.id, range: `${A(p.hasHeader ? p.hr : p.r0, p.time.c)}:${A(p.rN, p.time.c)}` } : null; if (link) { // time on source, values on calc: mirror the labels
                const c0 = calc.block(1); calc.set(0, c0, p.time.name, calc.hdr); for (let i = 0; i < p.n; i++) calc.set(i + 1, c0, `=${q(p.sheet)}!${A(p.r0 + i, p.time.c)}`);
                link = { sheetId: calc.sheet.id, range: `${A(0, c0)}:${A(p.n, c0)},${A(0, hc)}:${A(p.n, hc)}` }; } }
            const many = s.count > 14;
            const follow = story.sections.some((x) => x.kind === 'trend');
            sec.charts.push({ title: v.title || `${m.name}${p.time ? ' by ' + (periodTable().rows ? p.grain : lower(p.time.name)) : ''}`, link, chartType: v.chartType || (p.time ? (many ? 'area' : (m.role === 'ratio' ? 'line' : 'bar')) : 'bar'), showValues: s.count <= 12, colors: v.chartType === 'line' && story.sections.length ? [D.brand().accent] : undefined, size: follow && s.count <= 16 ? 'half' : 'wide' });
            if (p.time && s.count >= 2) { const ti = trendInsights(m, s, u); sec.insights.push(...(follow ? ti.slice(0, 2) : ti)); }
          } else {
            const ss = list.map(series);
            const sameLink = ss.every((s) => s.link && s.link.sheetId === ss[0].link.sheetId);
            if (sameLink) {
              const labelArea = ss[0].link.range.split(',')[0];
              const link = { sheetId: ss[0].link.sheetId, range: [labelArea, ...ss.map((s) => s.link.range.split(',')[1])].join(',') };
              const scales = list.map((x) => Math.abs(x.max || 1));
              const mixed = Math.max(...scales) / Math.max(1e-9, Math.min(...scales)) > 8 || list.some((x) => x.role === 'ratio') !== list.every((x) => x.role === 'ratio');
              sec.charts.push({ title: v.title || list.map((x) => x.name).join(' vs '), link, chartType: v.chartType || (mixed ? 'combo' : 'line'), showValues: false, size: 'wide' });
            }
            sec.insights.push(...trendInsights(list[0], ss[0], u).slice(0, 2));
            if (ss[1] && ss[1].count >= 2) sec.insights.push(`${list[1].name} was ${T(`INDEX(${ss[1].vals},${ss[1].count})`, list[1])} in the latest ${u} - {{IF(INDEX(${ss[1].vals},${ss[1].count})${list[1].lowerBetter ? '<=' : '>='}INDEX(${ss[1].vals},${ss[1].count - 1}),"an improvement","a step back")}} from ${T(`INDEX(${ss[1].vals},${ss[1].count - 1})`, list[1])}.`);
          }
        } else if (v.kind === 'rank' || v.kind === 'share' || v.kind === 'compare') {
          const d = dimCol(v.by);
          if (!d || !m) continue;
          const isEnt = !grouped(v.by);
          const dn = DS.noun(d.name);
          const dir = v.dir || (m.role === 'ratio' && m.lowerBetter ? 'asc' : 'desc');
          const list = v.kind === 'compare' ? (ms.length >= 2 ? ms.slice(0, 3) : [m, metrics.find((x) => x !== m && x.role === 'ratio')].filter(Boolean)) : [m];
          if (v.kind === 'share') {
            if (!(m.role === 'measure' && m.allPositive)) continue;
            const topN = Math.min(isEnt ? 5 : 6, Math.max(1, (isEnt ? p.n : d.distinct) - 1));
            let b;
            if (isEnt) {
              b = rankBlock([m], m, 'desc', topN);
              const r = b.n + 1;
              if (p.n > topN) { calc.set(r, b.c0, `Other (${p.n - topN})`); calc.set(r, b.col(m), `=${X.agg(m)}-SUM(${A(1, b.col(m))}:${A(b.n, b.col(m))})`, cellFmt(m)); b = { ...b, n: r }; }
            } else b = groupBlock(d, [m], m, 'desc', topN);
            sec.charts.push({ title: v.title || `Share of ${lower(m.name)} by ${dn.one}`, link: linkOf(b, [m]), chartType: v.chartType || 'doughnut', showValues: true, size: 'half' });
            sec.insights.push(`{{${calc.ref(1, b.c0)}}} has the biggest share of ${lower(m.name)}: {{TEXT(${calc.ref(1, b.col(m))}/${X.agg(m)},"0%")}}${b.n > 1 ? `, followed by {{${calc.ref(2, b.c0)}}} at {{TEXT(${calc.ref(2, b.col(m))}/${X.agg(m)},"0%")}}` : ''}.`);
          } else {
            const topN = v.top || (isEnt ? (p.n <= 15 ? p.n : 10) : 12);
            const b = isEnt ? rankBlock(list, m, dir, topN) : groupBlock(d, list, m, dir, topN);
            const ct = v.chartType || (v.kind === 'compare' ? 'combo' : 'hbar');
            const title = v.title || (v.kind === 'compare' ? `${list.map((x) => x.name).join(' vs ')} by ${dn.one}` : `${m.name} by ${dn.one}${isEnt && p.n > topN ? ` (top ${topN})` : ''}`);
            sec.charts.push({ title, link: linkOf(b, list), chartType: ct, showValues: b.n <= 16 && ct !== 'combo', size: v.kind === 'compare' || b.n > 16 ? 'wide' : 'half', tall: ct === 'hbar' && b.n > 8 });
            const first = calc.ref(1, b.c0), firstV = calc.ref(1, b.col(m));
            if (m.role === 'ratio') {
              const overall = X.agg(m);
              const better = m.lowerBetter ? '<' : '>';
              sec.insights.push(`Best ${lower(m.name)}: {{${first}}} at ${T(firstV, m)}${b.n > 2 ? `; weakest: {{${calc.ref(b.n, b.c0)}}} at ${T(calc.ref(b.n, b.col(m)), m)}` : ''}. Overall it's ${T(overall, m)}.`);
              if (isEnt) sec.insights.push(`{{COUNTIF(${X.rows(m)},"${better}"&${overall})}} of ${p.n} ${dn.many} do better than the overall ${lower(m.name)}.`);
            } else {
              sec.insights.push(`{{${first}}} leads ${dn.many} on ${lower(m.name)} with ${T(firstV, m)}${b.n > 1 ? `, ahead of {{${calc.ref(2, b.c0)}}} (${T(calc.ref(2, b.col(m)), m)})` : ''}.`);
              if (isEnt && X.additive(m) && p.n >= 6) sec.insights.push(`The top 3 ${dn.many} account for {{TEXT(SUM(TAKE(SORTBY(${X.rows(m)},${X.rows(m)},-1),3))/${X.agg(m)},"0%")}} of all ${lower(m.name)}.`);
              if (v.kind === 'compare' && list[1] && list[1].role === 'ratio') sec.insights.push(`Among them, ${list[1].name.toLowerCase()} ranges from ${T(`MIN(${b.vals(list[1])})`, list[1])} to ${T(`MAX(${b.vals(list[1])})`, list[1])}.`);
            }
          }
        } else if (v.kind === 'scatter') {
          const [mx, my] = ms.length >= 2 ? ms : [];
          if (!mx || !my) continue;
          const lab = p.entity || p.time;
          const top = p.hasHeader ? p.hr : p.r0;
          let link;
          if (mx.c != null && my.c != null && (!lab || lab.c < mx.c) && mx.c < my.c) link = { sheetId: p.sheet.id, range: [lab ? `${A(top, lab.c)}:${A(p.rN, lab.c)}` : null, `${A(top, mx.c)}:${A(p.rN, mx.c)}`, `${A(top, my.c)}:${A(p.rN, my.c)}`].filter(Boolean).join(',') };
          else { // columns in the wrong order for x / y: mirror them on the Calc sheet
            const c0 = calc.block(3);
            if (lab) { calc.set(0, c0, lab.name, calc.hdr); for (let i = 0; i < p.n; i++) calc.set(i + 1, c0, `=${q(p.sheet)}!${A(p.r0 + i, lab.c)}`); }
            [mx, my].forEach((mm, j) => { calc.set(0, c0 + 1 + j, mm.name, calc.hdr); for (let i = 0; i < p.n; i++) calc.set(i + 1, c0 + 1 + j, mm.c != null ? `=${q(p.sheet)}!${A(p.r0 + i, mm.c)}` : `=INDEX(${calc.helper(mm)},${i + 1})`); });
            link = { sheetId: calc.sheet.id, range: `${A(0, c0)}:${A(p.n, c0 + 2)}` };
          }
          sec.charts.push({ title: v.title || `${my.name} vs ${mx.name}`, link, chartType: 'scatter', showValues: p.n <= 16, size: 'half' });
          const r = pearson(mx.col.vals, my.col.vals);
          if (r != null) sec.insights.push(`${mx.name} and ${lower(my.name)} ${Math.abs(r) >= 0.7 ? (r > 0 ? 'rise and fall together' : 'move in opposite directions') : Math.abs(r) >= 0.4 ? 'are loosely related' : 'barely move together'} (correlation {{TEXT(CORREL(${X.rows(mx)},${X.rows(my)}),"0.00")}}).`);
          if (p.entity && my.role === 'measure' && mx.role === 'measure' && mx.allPositive) sec.insights.push(`Most ${lower(my.name)} per ${lower(mx.name).replace(/\s*\(.*\)/, '')}: {{INDEX(${colRng(p, p.entity.c)},MATCH(MAX(${X.rows(my)}/${X.rows(mx)}),${X.rows(my)}/${X.rows(mx)},0))}}.`);
        } else if (v.kind === 'table') {
          const d = dimCol(v.by);
          if (d && p.mode !== 'trend') {
            const list = (ms.length ? ms : [main.primary, main.spend, main.efficiency].filter(Boolean)).filter((x, i, a) => a.indexOf(x) === i);
            const extra = metrics.filter((x) => !list.includes(x) && (x.role === 'measure' || x.derived || x.def)).slice(0, Math.max(0, 6 - list.length));
            const all = [...list, ...extra];
            const isEnt = !grouped(v.by);
            const b = isEnt ? rankBlock(all, all[0], all[0].role === 'ratio' && all[0].lowerBetter ? 'asc' : 'desc', p.n) : groupBlock(d, all, all[0], 'desc', 20);
            story.tables.push({ title: v.title || `${DS.noun(d.name).many[0].toUpperCase()}${DS.noun(d.name).many.slice(1)}, ranked by ${lower(all[0].name)}`, link: linkOf(b, all), rows: b.n + 1 });
          } else {
            const top = p.hasHeader ? p.hr : p.r0;
            const keep = p.cols.filter((x) => !['constant', 'empty', 'ignored'].includes(x.role)).map((x) => x.c);
            const area = (r1, r2) => contiguous(keep).map(([a, b]) => `${A(r1, a)}:${A(r2, b)}`);
            const lastN = Math.min(p.n, 12);
            const latest = p.n > 12 && p.time;
            const range = latest ? [...area(top, top), ...area(p.rN - lastN + 1, p.rN)] : area(top, Math.min(p.rN, top + 14));
            story.tables.push({ title: v.title || (latest ? `Latest ${lastN} rows` : 'Data'), link: { sheetId: p.sheet.id, range: range.join(',') }, raw: true, rows: Math.min(p.n, 14) + 1 });
          }
          continue;
        }
      } catch (err) { console.error('dashboard view', v, err); continue; }
      sec.charts.forEach((ch) => { if (!ch.vf && m) ch.vf = vfOf(m); });
      if (sec.charts.length || sec.insights.length) story.sections.push(sec);
    }
    // relationships worth a sentence even without a chart
    if (p.mode === 'trend' && main.primary) {
      const c = p.corr.find((x) => (x.a.c === main.primary.c || x.b.c === main.primary.c));
      if (c && !story.sections.some((s) => s.charts.some((ch) => ch.chartType === 'scatter'))) story.sections.push({ charts: [], kind: 'note', insights: [] }), story.sections[story.sections.length - 1].insights.push(`${c.a.name} and ${lower(c.b.name)} ${c.r > 0 ? 'rise and fall together' : 'move in opposite directions'} (correlation {{TEXT(CORREL(${colRng(p, c.a.c)},${colRng(p, c.b.c)}),"0.00")}}).`);
    }
    return story;

    function trendInsights(m, s, u) {
      const out = [];
      const v = s.vals, n = s.count, last = `INDEX(${v},${n})`, prev = `INDEX(${v},${n - 1})`;
      const lab = s.labels;
      const best = m.lowerBetter ? 'MIN' : 'MAX', worst = m.lowerBetter ? 'MAX' : 'MIN';
      out.push(`${m.name} ${m.role === 'ratio' ? 'averaged' : 'totaled'} ${T(m.role === 'ratio' ? X.agg(m) : `SUM(${v})`, m)} across ${n} ${u}s, {{IF(SLOPE(${v},SEQUENCE(${n}))${m.lowerBetter ? '<' : '>'}0,"trending in the right direction","trending the wrong way")}}.`);
      if (lab) out.push(`Latest ${u} ({{INDEX(${lab},${n})}}): ${T(last, m)}, {{IF(${last}>=${prev},"up","down")}} {{TEXT(ABS(PCTCHANGE(${last},${prev})),"0.0%")}} on the prior ${u} and {{IF(${last}>=AVERAGE(${v}),"above","below")}} the ${n}-${u} average of ${T(`AVERAGE(${v})`, m)}.`);
      if (lab) out.push(`Best ${u}: {{INDEX(${lab},MATCH(${best}(${v}),${v},0))}} at ${T(`${best}(${v})`, m)}. Weakest: {{INDEX(${lab},MATCH(${worst}(${v}),${v},0))}} at ${T(`${worst}(${v})`, m)}.`);
      if (n >= 3 && m.role !== 'ratio' && (m.first || 0) > 0) out.push(`From first to latest ${u}, ${lower(m.name)} changed {{TEXT(PCTCHANGE(${last},INDEX(${v},1)),"+0.0%;-0.0%")}}.`);
      return out;
    }
  }
  const contiguous = (cs) => { const out = []; cs.forEach((c) => { const l = out[out.length - 1]; if (l && l[1] === c - 1) l[1] = c; else out.push([c, c]); }); return out; };

  // ------------------------------------------------------------------ layout
  const kpiEl = (k, x, y, w, hh, fs) => D.newElement('kpi', { ...k, x, y, w, h: hh, style: { fontSize: fs, fill: '#F4F7FD' } });
  const chartEl = (c, x, y, w, hh) => D.newElement('chart', { x, y, w, h: hh, chartType: c.chartType, link: c.link, title: c.title, showValues: c.showValues, valueFormat: c.vf, legend: ['doughnut', 'pie', 'combo'].includes(c.chartType) || undefined, colors: c.colors });
  const tableEl = (t, x, y, w, hh, rows) => D.newElement('table', { x, y, w, h: hh, link: t.link, maxRows: rows, style: { fontSize: 9.5 } });
  const textH = (lines, w, fs = 11.5) => {
    const px = fs * 96 / 72, perLine = Math.max(10, Math.floor((w - 28) / (px * 0.5)));
    let n = 0;
    for (const l of lines) { let t = l; try { t = D.f.resolveTokens(l); } catch {} n += Math.max(1, Math.ceil(String(t).length / perLine)); }
    return Math.ceil(n * px * 1.45 + lines.length * 4 + 10);
  };
  const tableRowsFor = (t, max) => { try { const r = D.tableRows({ link: t.link, maxRows: max }); return r ? r.length : max + 1; } catch { return max + 1; } };
  const tableH = (t, max) => 30 * tableRowsFor(t, max) + 8;
  const heading = (text, x, y, w) => D.newElement('text', { x, y, w, h: 24, text, style: { fontSize: 13, bold: true, color: D.brand().dark } });
  const bullets = (lines, x, y, w, hh, fs) => D.newElement('text', { x, y, w, h: hh, text: lines.join('\n'), style: { fontSize: fs, color: '#1F2937', bullets: true, lineHeight: 1.45 } });

  function layoutPage(p, story, o, W, H) {
    const els = D.sheetTypes.report.header(o.title, o.subtitle, W);
    const portrait = H > W;
    const inner = W - 2 * M;
    let y = 120;
    const pageBottom = (yy) => Math.ceil((yy + 1) / H) * H - M;
    const nextPage = (yy) => Math.ceil((yy + 1) / H) * H + M;
    const room = (hh) => { if (y + hh > pageBottom(y)) y = nextPage(y); };
    // KPI rows
    const ks = o.showKpis === false ? [] : story.kpis;
    if (ks.length) {
      const perRow = ks.length <= 4 || (ks.length === 5 && !portrait) ? ks.length : Math.ceil(ks.length / 2);
      const kh = portrait ? 96 : 104;
      for (let i = 0; i < ks.length; i += perRow) {
        const row = ks.slice(i, i + perRow);
        const kw = (inner - (perRow - 1) * 14) / perRow;
        row.forEach((k, j) => els.push(kpiEl(k, Math.round(M + j * (kw + 14)), y, Math.round(kw), kh, perRow > 4 || ks.length > 4 ? (portrait ? 18 : 22) : portrait ? 22 : 26)));
        y += kh + 14;
      }
      y += 8;
    }
    // charts: wide ones get a row; half ones pair up (landscape: the first wide chart can share with a half one)
    const charts = story.sections.flatMap((s) => s.charts);
    const queue = [...charts];
    const H1 = portrait ? 290 : 300, H2 = portrait ? 260 : 280;
    while (queue.length) {
      const c = queue.shift();
      const tallH = c.tall ? Math.min(420, 120 + 24 * 12) : null;
      if (c.size === 'wide') {
        const partner = !portrait && !c.tall && queue.find((x) => x.size === 'half' && !x.tall);
        if (partner) {
          queue.splice(queue.indexOf(partner), 1);
          const hh = tallH || H1; room(hh);
          const left = Math.round(inner * 0.6);
          els.push(chartEl(c, M, y, left, hh), chartEl(partner, M + left + 16, y, inner - left - 16, hh));
          y += hh + 20;
        } else { const hh = tallH || H1; room(hh); els.push(chartEl(c, M, y, inner, hh)); y += hh + 20; }
      } else {
        const partner = queue.find((x) => x.size === 'half');
        const hh = Math.max(tallH || H2, partner && partner.tall ? 360 : 0);
        room(hh);
        if (partner) { queue.splice(queue.indexOf(partner), 1); const w2 = (inner - 16) / 2; els.push(chartEl(c, M, y, Math.round(w2), hh), chartEl(partner, Math.round(M + w2 + 16), y, Math.round(w2), hh)); }
        else els.push(chartEl(c, M, y, inner, hh));
        y += hh + 20;
      }
    }
    // insights: split across pages rather than leave a gap
    const lines = o.insights === false ? [] : [...story.headline, ...story.sections.flatMap((s) => s.insights)];
    if (lines.length) {
      let rest = lines, first = true;
      while (rest.length) {
        let avail = pageBottom(y) - y - 30;
        let take = [];
        for (const l of rest) { if (textH([...take, l], inner) > avail) break; take.push(l); }
        if (take.length < Math.min(2, rest.length)) { y = nextPage(y); continue; }
        els.push(heading(first ? 'Key insights' : 'Key insights (continued)', M, y, inner));
        const hh = textH(take, inner);
        els.push(bullets(take, M, y + 28, inner, hh, 11.5));
        y += 28 + hh + 16;
        rest = rest.slice(take.length); first = false;
      }
    }
    // tables
    const tables = o.table === false ? story.tables.filter((t) => !t.raw) : story.tables;
    tables.forEach((t) => {
      let rows = Math.min(t.rows ? t.rows - 1 : 14, 20);
      let hh = 28 + tableH(t, rows);
      const avail = pageBottom(y) - y;
      if (hh > avail) {
        const fit = Math.floor((avail - 28 - 8) / 30) - 1;
        if (fit >= 5 && fit >= rows * 0.6) { rows = fit; hh = 28 + tableH(t, rows); } else y = nextPage(y);
      }
      els.push(heading(t.title, M, y, inner), tableEl(t, M, y + 26, inner, hh - 28, rows));
      y += hh + 16;
    });
    els.forEach((e, i) => { e.z = i + 1; });
    return els;
  }

  function buildSlides(p, story, o) {
    const S = D.sheetTypes.slide;
    const deck = D.app.addSheet('slide', { activate: false, name: D.uniqueSheetName(`${o.title}`) });
    const b = D.brand();
    deck.slides = [S.newSlide('title', { title: o.title, subtitle: o.subtitle })];
    const ks = o.showKpis === false ? [] : story.kpis;
    if (ks.length) {
      const sl = S.newSlide('blank');
      sl.elements.push(D.newElement('text', { x: 60, y: 36, w: 840, h: 60, text: 'At a glance', style: { fontSize: 30, bold: true, color: b.dark, valign: 'middle' } }));
      const rows = ks.length <= 4 ? [ks] : [ks.slice(0, Math.ceil(ks.length / 2)), ks.slice(Math.ceil(ks.length / 2))];
      rows.forEach((row, ri) => { const w = (840 - (row.length - 1) * 20) / row.length; row.forEach((x, i) => sl.elements.push(kpiEl(x, Math.round(60 + i * (w + 20)), rows.length > 1 ? 120 + ri * 140 : 150, Math.round(w), rows.length > 1 ? 120 : 150, rows.length > 1 ? 26 : 34))); });
      const lead = story.headline[0] || (story.sections[0] && story.sections[0].insights[1]);
      if (lead && rows.length === 1) sl.elements.push(D.newElement('text', { x: 60, y: 340, w: 840, h: 120, text: lead, style: { fontSize: 17, color: '#475569', lineHeight: 1.4 } }));
      deck.slides.push(sl);
    }
    story.sections.forEach((sec) => sec.charts.forEach((c, i) => {
      const sub = sec.insights[i === 0 ? 0 : i] || '';
      const sl = S.newSlide('chart', { title: c.title, subtitle: sub });
      const ch = sl.elements.find((e) => e.type === 'chart');
      Object.assign(ch, { chartType: c.chartType, link: c.link, showValues: c.showValues, valueFormat: c.vf, legend: ['doughnut', 'pie', 'combo'].includes(c.chartType) || undefined, colors: c.colors });
      if (!sub) { sl.elements = sl.elements.filter((e) => !(e.type === 'text' && e.style.fontSize === 15)); ch.y = 110; ch.h = 400; }
      deck.slides.push(sl);
    }));
    const lines = [...story.headline, ...story.sections.flatMap((s) => s.insights)];
    if (o.insights !== false && lines.length) {
      for (let i = 0; i < lines.length; i += 5) deck.slides.push(S.newSlide('content', { title: i ? 'Key insights (continued)' : 'Key insights', body: lines.slice(i, i + 5).join('\n') }));
    }
    const tables = o.table === false ? story.tables.filter((t) => !t.raw) : story.tables;
    tables.forEach((t) => {
      const sl = S.newSlide('blank');
      sl.elements.push(D.newElement('text', { x: 60, y: 30, w: 840, h: 60, text: t.title, style: { fontSize: 28, bold: true, color: b.dark, valign: 'middle' } }));
      sl.elements.push(D.newElement('table', { x: 60, y: 110, w: 840, h: 390, link: t.link, maxRows: 12, style: { fontSize: 12 } }));
      deck.slides.push(sl);
    });
    deck.slides.forEach((s) => s.elements.forEach((e) => { if (e.style && e.style.bullets && e.text) e.style.fontSize = Math.min(e.style.fontSize || 20, 17); }));
    deck.current = 0;
    return deck;
  }

  // ------------------------------------------------------------------ build
  // o: { layout, title, views, kpiKeys, calcMetrics, roles, grain, insights, table, showKpis, silent }
  DS.build = (sheet, range, o = {}) => {
    const p = DS.profile(sheet, range, o.roles || {});
    if (!p.measures.length && !p.ratios.length && !(o.calcMetrics || []).length) { D.toast('No numeric columns found in that range', 'warn'); return null; }
    if (p.n < 2) { D.toast('Need at least two rows of data', 'warn'); return null; }
    if (o.grain && o.grain !== 'auto') p.grain = o.grain;
    if (!p.time || p.time.type !== 'date') p.grain = 'row';
    const metrics = DS.metrics(p, o.calcMetrics || []);
    // older dashboards stored a primary / secondary / breakdown instead of views
    let views = o.views;
    if (!views && (o.primary != null || o.dim != null)) {
      const key = (c) => (c == null ? null : String(c));
      views = [];
      if (o.primary != null) views.push(p.time ? { kind: 'trend', metrics: [key(o.primary)] } : { kind: 'rank', by: 'entity', metrics: [key(o.primary)] });
      if (o.secondary != null) views.push(p.time ? { kind: 'trend', metrics: [key(o.secondary)], chartType: 'line' } : { kind: 'rank', by: 'entity', metrics: [key(o.secondary)] });
      if (o.dim != null) views.push({ kind: 'rank', by: o.dim, metrics: [key(o.primary)] });
      views.push({ kind: 'table', by: p.mode === 'trend' ? undefined : 'entity' });
      if (!views.length) views = null;
    }
    const opts = { layout: 'landscape', insights: true, table: true, ...o, views };
    opts.title = opts.title || `${sheet.name} Report`;
    const niceDate = (r) => { const v = F().cellValue(sheet, r, p.time.c); const d = p.time.type === 'date' ? F().toDate(v) : null; return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : F().display(sheet, r, p.time.c); };
    const rangeTxt = p.time ? `${niceDate(p.r0)} - ${niceDate(p.rN)}` : p.entity ? `${p.n} ${p.noun.many}${p.context ? ' · ' + p.context : ''}` : p.context || `${p.n} rows`;
    opts.subtitle = o.subtitle || (opts.layout === 'slides' ? rangeTxt : `${rangeTxt} · Updated ${new Date().toLocaleDateString()}`);
    const story = plan(p, opts, metrics);
    let calcSheet = attachCalc(sheet, story);
    let made;
    if (opts.layout === 'slides') made = buildSlides(p, story, opts);
    else {
      const rep = D.app.addSheet('report', { activate: false, name: D.uniqueSheetName(opts.title) });
      rep.page = { size: 'letter', orient: opts.layout === 'portrait' ? 'portrait' : 'landscape' };
      const d = D.sheetTypes.report.dims(rep);
      rep.elements = layoutPage(p, story, opts, d.w, d.h);
      const bottom = Math.max(...rep.elements.map((e) => e.y + e.h));
      rep.pages = Math.max(1, Math.ceil((bottom - 2) / d.h));
      made = rep;
    }
    made.dashSource = { sheetId: sheet.id, range, opts: { layout: opts.layout, title: opts.title, views: opts.views || null, kpiKeys: o.kpiKeys || null, calcMetrics: o.calcMetrics || [], roles: o.roles || {}, grain: o.grain || 'auto', insights: opts.insights, table: opts.table, showKpis: opts.showKpis } };
    D.dataVersion++;
    if (o.silent) return made;
    D.commit();
    D.app.activate(made.id, true);
    D.toast(`Report built${calcSheet ? ` - summaries live in “${calcSheet.name}”` : ''}. Every number is linked to your data.`, 'ok', 5000);
    return made;
  };

  // put a story's Calc sheet into the project (or reuse an identical one) and return it
  function attachCalc(sheet, story, merge = false) {
    let calcSheet = story.calc.used() ? story.calc.sheet : null;
    if (calcSheet) {
      const all = D.project().sheets;
      const sig = (x) => JSON.stringify([x.cells.map((r) => r.join('\u0001')).join('\u0002'), x.styles]);
      const twin = all.find((x) => x.type === 'data' && x.calcOf === sheet.id && sig(x) === sig(calcSheet));
      if (twin) {
        const swap = (str) => (typeof str === 'string' ? str.split(F().quoteSheet(calcSheet.name) + '!').join(F().quoteSheet(twin.name) + '!') : str);
        const fix = (o2) => { if (!o2 || typeof o2 !== 'object') return; for (const k of Object.keys(o2)) { if (k === 'calc') continue; const v = o2[k]; if (typeof v === 'string') o2[k] = swap(v); else if (v && typeof v === 'object') { if (k === 'link' && v.sheetId === calcSheet.id) v.sheetId = twin.id; fix(v); } } };
        fix(story);
        calcSheet = twin;
      } else if (merge && all.some((x) => x.type === 'data' && x.calcOf === sheet.id)) {
        // add these few formulas to the existing summary sheet instead of starting another one
        const target = all.filter((x) => x.type === 'data' && x.calcOf === sheet.id).pop();
        let width = 0; target.cells.forEach((row) => row.forEach((v, c) => { if (v !== '' && v != null) width = Math.max(width, c + 1); }));
        const off = width + 1;
        const re = /"[^"]*"|((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?(?![\w(])/g;
        const sc = (c) => F().colName(F().colIndex(c) + off);
        const shift = (str, own) => String(str).replace(re, (m, pre, d1, col, d2, row, e1, col2, e2, row2) => {
          if (m[0] === '"') return m;
          const sn = pre ? pre.slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'") : null;
          if (sn ? sn.toLowerCase() !== calcSheet.name.toLowerCase() : !own) return m;
          return (sn ? F().quoteSheet(target.name) + '!' : '') + d1 + sc(col) + d2 + row + (col2 ? ':' + e1 + sc(col2) + e2 + row2 : '');
        });
        const need = Math.max(...calcSheet.cells.map((r) => r.length)) + off + 2;
        calcSheet.cells.forEach((row, r) => {
          while (target.cells.length <= r + 1) target.cells.push(Array(target.cells[0].length).fill(''));
          row.forEach((v, c) => { if (v === '' || v == null) return; target.cells.forEach((tr) => { while (tr.length < need) tr.push(''); }); target.cells[r][c + off] = v[0] === '=' ? shift(v, true) : v; });
        });
        Object.entries(calcSheet.styles).forEach(([k, v]) => { const [r, c] = k.split(',').map(Number); target.styles[`${r},${c + off}`] = v; });
        Object.entries(calcSheet.colWidths || {}).forEach(([c, w]) => { target.colWidths = target.colWidths || {}; target.colWidths[+c + off] = w; });
        const fix = (o2) => { if (!o2 || typeof o2 !== 'object') return; for (const k of Object.keys(o2)) { if (k === 'calc') continue; const v = o2[k]; if (typeof v === 'string') o2[k] = shift(v, false); else if (v && typeof v === 'object') { if (k === 'link' && v.sheetId === calcSheet.id) { v.sheetId = target.id; v.range = shift(v.range, true); } else fix(v); } } };
        fix(story);
        calcSheet = target;
      } else {
        all.splice(all.indexOf(sheet) + 1, 0, calcSheet);
      }
    }
    return calcSheet;
  }

  // ---- building blocks for the assistant
  // Facts: every headline number and insight sentence for a sheet, worked out by Datum (not by a language model)
  DS.facts = (sheet, range) => {
    range = range || D.links.autoRange(sheet);
    const p = DS.profile(sheet, range);
    if (!p.measures.length && !p.ratios.length) return { p, lines: [], kpis: [] };
    const metrics = DS.metrics(p, DS.autoMetrics(p));
    const views = DS.suggest(p, metrics).map((s) => s.view).filter((v) => v.kind !== 'table');
    const story = plan(p, { views, kpiKeys: [...DS.defaultKpis(p, metrics), ...metrics.filter((m) => m.def).map((m) => m.key)] }, metrics);
    const all = D.project().sheets;
    const temp = story.calc.used() ? story.calc.sheet : null;
    if (temp) all.push(temp);
    D.dataVersion++;
    let lines = [], kpis = [];
    try {
      kpis = story.kpis.map((k) => `${k.label}: ${D.f.displayExpr(k.expr, k.format)}`);
      lines = [...story.headline, ...story.sections.flatMap((s) => s.insights)].map((l) => D.f.resolveTokens(l));
    } finally { if (temp) all.splice(all.indexOf(temp), 1); D.dataVersion++; }
    return { p, metrics, kpis, lines };
  };
  // one chart (plus its Calc formulas) for a view, ready to drop on a report or slide
  DS.chartFor = (sheet, view) => {
    const p = DS.profile(sheet, D.links.autoRange(sheet));
    const metrics = DS.metrics(p, view.calcMetrics || []);
    const story = plan(p, { views: [view], kpiKeys: ['__none__'] }, metrics);
    const ch = story.sections.flatMap((s) => s.charts)[0];
    if (!ch) return null;
    attachCalc(sheet, story, true);
    return { chart: ch, insights: story.sections.flatMap((s) => s.insights) };
  };
  DS.chartEl = (c, x, y, w, hh) => chartEl(c, x, y, w, hh);
  DS.kpiFor = (sheet, key) => {
    const p = DS.profile(sheet, D.links.autoRange(sheet));
    const story = plan(p, { views: [{ kind: 'none' }], kpiKeys: [key] }, DS.metrics(p, []));
    attachCalc(sheet, story, true);
    return story.kpis[0];
  };
  DS.liveInsights = (sheet) => {
    const p = DS.profile(sheet, D.links.autoRange(sheet));
    const metrics = DS.metrics(p, []);
    const story = plan(p, { views: null, kpiKeys: ['__none__'] }, metrics);
    attachCalc(sheet, story, true);
    D.dataVersion++;
    return [...story.headline, ...story.sections.flatMap((s) => s.insights)];
  };

  // ------------------------------------------------------------------ rebuild in place (after the data grows)
  DS.gcCalc = (src) => {
    const p = D.project();
    const calcs = p.sheets.filter((x) => x.type === 'data' && x.calcOf === src.id);
    for (const c of calcs) {
      const re = new RegExp(`(^|[^\\w'])('?${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "''")}'?)!`, 'i');
      let used = F().usages(c.id).length > 0;
      if (!used) for (const s of p.sheets) {
        if (s === c) continue;
        if (s.type === 'data' && s.cells.some((row) => row.some((v) => typeof v === 'string' && v[0] === '=' && re.test(v)))) { used = true; break; }
        const els = s.type === 'slide' ? s.slides.flatMap((x) => x.elements) : s.type === 'report' ? s.elements : [];
        if (els.some((e) => ['compareExpr', 'label'].some((k) => typeof e[k] === 'string' && re.test(e[k])))) { used = true; break; }
      }
      if (!used) p.sheets.splice(p.sheets.indexOf(c), 1);
    }
    const base = `${src.name} · Calc`;
    const left = p.sheets.filter((x) => x.type === 'data' && x.calcOf === src.id);
    if (left.length === 1 && left[0].name !== base && !p.sheets.some((x) => x.name.toLowerCase() === base.toLowerCase())) { F().renameRefs(left[0].name, base); left[0].name = base; }
  };
  DS.rebuild = (dash, newOpts) => {
    const ds = dash && dash.dashSource;
    const src = ds && D.sheet(ds.sheetId);
    if (!src) return null;
    const p = D.project();
    const o = newOpts ? { ...newOpts } : { ...ds.opts, layout: dash.type === 'slide' ? 'slides' : ds.opts.layout, title: ds.opts.title || dash.name };
    if (newOpts && (newOpts.layout === 'slides') !== (dash.type === 'slide')) { // switching between a page and a deck: build a new one instead
      const made = DS.build(src, D.links.autoRange(src), newOpts);
      return made;
    }
    const made = DS.build(src, D.links.autoRange(src), { ...o, silent: true });
    if (!made) return null;
    if (dash.type === 'slide') { dash.slides = made.slides; dash.current = 0; }
    else { dash.elements = made.elements; dash.pages = made.pages; dash.page = made.page; }
    dash.dashSource = made.dashSource;
    if (newOpts && newOpts.title && dash.name !== newOpts.title && !p.sheets.some((x) => x !== dash && x !== made && x.name === newOpts.title)) dash.name = newOpts.title;
    p.sheets.splice(p.sheets.indexOf(made), 1);
    DS.gcCalc(src);
    if (newOpts) { D.dataVersion++; D.commit(); D.app.activate(dash.id, true); D.toast('Report updated', 'ok'); }
    return dash;
  };
  DS.dashboardsOf = (src) => D.project().sheets.filter((x) => x.dashSource && x.dashSource.sheetId === src.id);
})();
