// Datum - the smart half of dashboards: written insights from the filtered rows, the latest-period card,
// building a dashboard from Quick report choices, linked (range) widgets, and turning old Report pages into dashboards.
(function () {
  const h = D.h;
  const F = () => D.f;
  const E = D.board;
  const DS = () => D.dash;
  const DAY = 86400000;
  const label = (c) => E.label(c);
  const esc = (x) => D.esc(String(x));
  const B = (x) => `<b>${esc(x)}</b>`;
  const pct = (x) => F().format(x, 'pct');
  const plural = (w) => (/(s|x|ch|sh)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's');
  // "Amount spent (USD)" → "amount spent"
  const lower = (s) => String(s).replace(/\s*\((usd|eur|gbp|cad|aud|\$|€|£|all|total|#|%)\)/gi, '').replace(/\b([A-Z])([a-z]+)/g, (m, a, b) => a.toLowerCase() + b).trim();
  const EMPTY = { cols: [], metrics: [], dateCols: [], periodCols: [], groupCols: [], sheetCols: [], byName: {}, rows: [] };

  // what one record is called: sign-ups, leads, orders… (from the sheet or folder name)
  E.recordsName = (sheet) => {
    const src = (sheet.sources || []).map((id) => D.sheet(id)).filter(Boolean)[0];
    try { return src && DS() ? DS().recordsName({ sheet: src }) : 'Records'; } catch { return 'Records'; }
  };

  // ---- the period line: "Sign-up date: Sep 1 - Oct 11, 2026 · Market: Atlanta · 1,204 rows · Updated 11/16/2026"
  E.subtitle = (sheet, t) => {
    const parts = [];
    const r = E.activeRange(sheet, t);
    const fd = (ms) => E.fmtDate(ms);
    if (r) parts.push(`${label(t.byName[r.col])}: ${isFinite(r.from) ? fd(r.from) : 'start'} - ${isFinite(r.to) ? fd(r.to) : 'end'}`);
    else if (t.dateCols.length && isFinite(t.minDate) && isFinite(t.maxDate)) parts.push(`${fd(t.minDate)} - ${fd(t.maxDate)}`);
    for (const [c, l] of Object.entries(E.filtersOf(sheet).vals || {})) if (l && l.length && t.byName[c]) parts.push(`${label(t.byName[c])}: ${l.length > 3 ? l.length + ' selected' : l.join(', ')}`);
    let n = 0; try { n = E.rows(sheet, t).length; } catch { n = t.rows.length; }
    parts.push(`${n.toLocaleString()} rows`);
    parts.push(`Updated ${new Date().toLocaleDateString()}`);
    return parts.join(' · ');
  };

  // ---- the latest period (week, month…) of the filtered rows, and the one before it.
  // A period still running is compared with the same days of the previous one, never called a drop.
  const nextKey = (k, b) => { const d = new Date(k); if (b === 'day') return k + DAY; if (b === 'week') return k + 7 * DAY; if (b === 'month') return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); if (b === 'quarter') return new Date(d.getFullYear(), d.getMonth() + 3, 1).getTime(); return new Date(d.getFullYear() + 1, 0, 1).getTime(); };
  const UNIT = { day: 'day', week: 'week', month: 'month', quarter: 'quarter', year: 'year' };
  E.latest = (sheet, t, rows, w = {}) => {
    const dc = t.byName[(E.filtersOf(sheet).date || {}).col] || t.byName[w.dateCol] || t.dateCols[0];
    if (!dc) return null;
    const all = t.rows.filter((r) => r[dc.name] != null);
    const vals = rows.map((r) => r[dc.name]).filter((v) => v != null);
    if (!vals.length) return null;
    const b = !w.bucket || w.bucket === 'auto' ? E.autoBucket(all.length ? all.map((r) => r[dc.name]) : vals) : w.bucket;
    const maxD = Math.max(...vals);
    const lastK = E.bucketKey(maxD, b);
    const end = nextKey(lastK, b) - DAY;
    const prevK = E.bucketKey(lastK - DAY, b);
    const len = (end - lastK) / DAY + 1, covered = Math.round((E.bucketKey(maxD, 'day') - lastK) / DAY) + 1;
    const partial = len - covered >= Math.max(2, Math.ceil(len * 0.1));
    const cur = rows.filter((r) => r[dc.name] != null && E.bucketKey(r[dc.name], b) === lastK);
    const limit = partial ? prevK + (covered - 1) * DAY + DAY - 1 : Infinity;
    // the previous period comes from the same filters except the date range (it may sit outside it)
    let base = rows;
    try { base = E.where(E.rows(sheet, t, { range: null }), w); } catch { /* use rows */ }
    const prev = base.filter((r) => r[dc.name] != null && E.bucketKey(r[dc.name], b) === prevK && r[dc.name] <= limit);
    const L = E.bucketLabel(lastK, b), P = E.bucketLabel(prevK, b);
    return { cur, prev, bucket: b, unit: UNIT[b], partial, days: covered, label: partial ? `${L} so far (${covered} days)` : `Latest ${UNIT[b]} (${L})`, prevLabel: partial ? `the same days of ${P}` : P, curName: L, prevName: P, through: maxD };
  };

  // ---- columns worth breaking things down by (well filled, a handful to a few dozen values, not names/emails)
  const PERSONAL = /first.?name|last.?name|full.?name|^name$|e-?mail|phone|mobile|street|address|zip|postal|\bid\b|number$|notes?|comment|description|url|link/i;
  E.bestDims = (t) => t.groupCols
    .filter((c) => c.name !== '__sheet' && !/^Column [A-Z]+$/.test(c.name) && (c.distinct || 0) >= 2 && (c.distinct || 0) <= 80 && (c.fill == null || c.fill >= 0.3) && !PERSONAL.test(c.name))
    .sort((a, b) => sc(b) - sc(a));
  const sc = (c) => (c.fill || 0) * 2 + (c.distinct <= 12 ? 1.5 : c.distinct <= 40 ? 1 : 0.2) + (c.role === 'entity' ? 0.6 : 0) + (/market|region|source|channel|status|type|category|segment|area|team|city|state|stage|product|plan|campaign|rep|owner|country/i.test(c.name) ? 0.8 : 0);

  // ---- written insights, worked out from the rows that pass the filters (no AI)
  E.insightLines = (sheet, t, rows, w = {}) => {
    const m = t.byName[w.metric] || null;
    const how = m ? w.how || 'auto' : 'count';
    const agg = (rs) => E.agg(rs, m, how);
    const counted = !m || how === 'count' || how === 'distinct';
    const fv = (x) => (x == null || !isFinite(x) ? '-' : counted ? Math.round(x).toLocaleString() : E.fmt(m, x));
    const recs = lower(E.recordsName(sheet));
    const what = m ? (how === 'distinct' ? `different ${plural(lower(label(m)))}` : lower(label(m))) : recs;
    const ratio = m && how === 'auto' && m.role === 'ratio';
    const lowerBetter = m && m.lowerBetter;
    const out = [];
    if (!rows.length) return out;
    const total = agg(rows);
    const dc = t.byName[(E.filtersOf(sheet).date || {}).col] || t.dateCols[0];
    // 1. the headline, with the change on the previous stretch when a date range is set
    let head = ratio ? `${label(m)} overall: ${B(fv(total))}${m.derived ? ' (worked out from the totals)' : ''}` : counted && !m ? `${B(fv(total))} ${recs}` : `${how === 'distinct' ? 'Different ' + plural(lower(label(m))) : 'Total ' + lower(label(m))}: ${B(fv(total))}`;
    if (dc) { const ds = rows.map((r) => r[dc.name]).filter((v) => v != null); if (ds.length) head += ` from ${E.fmtDate(Math.min(...ds))} to ${E.fmtDate(Math.max(...ds))}`; }
    const prevR = E.previousRange(sheet, t);
    if (prevR) {
      const pv = agg(E.where(E.rows(sheet, t, { range: prevR }), w));
      if (pv && total != null) { const g = (total - pv) / Math.abs(pv); head += `, ${g >= 0 ? 'up' : 'down'} ${pct(Math.abs(g))} on the ${Math.round((prevR.to - prevR.from) / DAY) + 1} days before (${fv(pv)})`; }
    }
    out.push(head + '.');
    // 2. over time: the latest full period, the one in progress, the best
    if (dc) {
      const gs = E.group(rows, t, '@date', { dateCol: dc.name });
      const L = E.latest(sheet, t, rows, { ...w, dateCol: dc.name });
      if (gs.length >= 3 && L) {
        const vals = gs.map((g) => agg(g.rows));
        const complete = L.partial ? gs.slice(0, -1) : gs;
        const cv = L.partial ? vals.slice(0, -1) : vals;
        if (L.partial) {
          const a = agg(L.cur), pv = agg(L.prev);
          out.push(`So far this ${L.unit} (${esc(L.curName)}, through ${E.fmtDate(L.through)}): ${B(fv(a))}${pv ? `, ${a >= pv ? 'up' : 'down'} ${pct(Math.abs((a - pv) / pv))} on the same ${L.days} days of ${esc(L.prevName)} (${fv(pv)})` : ''}.`);
        }
        if (complete.length >= 2) {
          const a = cv[cv.length - 1], pv = cv[cv.length - 2];
          const good = lowerBetter ? a <= pv : a >= pv;
          out.push(`Last full ${L.unit} (${esc(complete[complete.length - 1].label)}): ${B(fv(a))}${pv ? `, <span class="${good ? 'up' : 'down'}">${a >= pv ? 'up' : 'down'} ${pct(Math.abs((a - pv) / (pv || 1)))}</span> on ${esc(complete[complete.length - 2].label)}` : ''}.`);
          const bi = cv.reduce((bi2, v, i) => ((lowerBetter ? v < cv[bi2] : v > cv[bi2]) ? i : bi2), 0);
          if (complete.length >= 4) {
            // direction over the complete periods (least-squares slope)
            const n = cv.length, mx = (n - 1) / 2, my = cv.reduce((s, v) => s + (v || 0), 0) / n;
            let num = 0, den = 0; cv.forEach((v, i) => { num += (i - mx) * ((v || 0) - my); den += (i - mx) ** 2; });
            const slope = den ? num / den : 0;
            const dir = Math.abs(slope) < Math.abs(my) * 0.02 ? 'holding steady' : (slope > 0) !== !!lowerBetter ? 'trending the right way' : 'trending the wrong way';
            out.push(`Best ${L.unit}: ${B(complete[bi].label)} at ${fv(cv[bi])}. Across ${n} complete ${plural(L.unit)}, ${what} ${n > 1 ? 'are' : 'is'} ${dir}.`);
          }
        }
      }
    }
    // 3. who leads, and how concentrated it is
    const dims = E.bestDims(t);
    const by = t.byName[w.by] || dims.find((c) => { const f = (E.filtersOf(sheet).vals || {})[c.name]; return !(f && f.length === 1); }) || null;
    if (by) {
      const fl = (E.filtersOf(sheet).vals || {})[by.name];
      const gs = E.group(rows, t, by.name).map((g) => ({ ...g, v: agg(g.rows) })).filter((g) => g.v != null);
      if (gs.length >= 2 && !(fl && fl.length === 1)) {
        const nm = lower(label(by)), many = plural(nm);
        if (ratio) {
          // rates: only groups with real volume count
          const minRows = Math.max(3, Math.round(rows.length / gs.length / 4));
          const ok = gs.filter((g) => g.rows.length >= minRows).sort((a, b) => (lowerBetter ? a.v - b.v : b.v - a.v));
          if (ok.length >= 2) out.push(`Best ${lower(label(m))} by ${nm}: ${B(ok[0].label)} (${fv(ok[0].v)}); weakest: ${B(ok[ok.length - 1].label)} (${fv(ok[ok.length - 1].v)}), against ${fv(total)} overall.`);
        } else {
          gs.sort((a, b) => b.v - a.v);
          const share = total ? gs[0].v / total : null;
          out.push(`${B(gs[0].label)} leads the ${many} with ${fv(gs[0].v)}${share != null ? ` (${pct(share)})` : ''}, ahead of ${esc(gs[1].label)} (${fv(gs[1].v)})${gs[2] ? ` and ${esc(gs[2].label)} (${fv(gs[2].v)})` : ''}.`);
          if (gs.length >= 5 && total) {
            const top3 = (gs[0].v + gs[1].v + gs[2].v) / total;
            out.push(`The top 3 of ${gs.length} ${many} make up ${B(pct(top3))} of ${what}${top3 > 0.75 ? ' - most of it' : ''}.`);
          }
          // 4. the biggest movers between the last two complete periods
          if (dc) {
            const L = E.latest(sheet, t, rows, { ...w, dateCol: dc.name });
            if (L && !L.partial && L.prev.length) {
              const cur = new Map(), prv = new Map();
              E.group(L.cur, t, by.name).forEach((g) => cur.set(g.label, agg(g.rows) || 0));
              E.group(L.prev, t, by.name).forEach((g) => prv.set(g.label, agg(g.rows) || 0));
              const deltas = [...new Set([...cur.keys(), ...prv.keys()])].map((k) => ({ k, d: (cur.get(k) || 0) - (prv.get(k) || 0), p: prv.get(k) || 0 })).filter((x) => x.d).sort((a, b) => b.d - a.d);
              const up = deltas[0], dn = deltas[deltas.length - 1];
              const fmtD = (x) => `${x.d > 0 ? '+' : '-'}${fv(Math.abs(x.d))}${x.p ? ` (${x.d > 0 ? '+' : '-'}${pct(Math.abs(x.d / x.p))})` : ''}`;
              if (up && up.d > 0) out.push(`Biggest rise in ${esc(L.curName)}: ${B(up.k)} ${fmtD(up)} on ${esc(L.prevName)}${dn && dn.d < 0 ? `; biggest drop: ${B(dn.k)} ${fmtD(dn)}` : ''}.`);
            }
          }
          // 5. the mix inside the leader
          const by2 = dims.find((c) => c !== by && (c.distinct || 0) <= 12);
          if (by2) {
            const inner = E.group(gs[0].rows, t, by2.name).map((g) => ({ ...g, v: agg(g.rows) })).sort((a, b) => b.v - a.v);
            if (inner.length >= 2 && gs[0].v) out.push(`Within ${esc(gs[0].label)}, ${B(inner[0].label)} is the biggest ${lower(label(by2))} at ${pct(inner[0].v / gs[0].v)}.`);
          }
        }
      }
    }
    // 6. repeated IDs, when they're being counted
    if (t.idCol && t.dupExtra && sheet.dedupe !== t.idCol && out.length < (w.max || 6)) out.push(`${t.dupExtra.toLocaleString()} rows repeat a ${esc(t.idCol)} seen earlier and are counted again (the Duplicates button can leave them out).`);
    return out.slice(0, w.max || 6);
  };

  // ---- linked widgets (a chart / table / KPI on an exact cell range), the way Report pages worked
  E.elementFromSpec = (r) => {
    if (r.kind === 'table') return D.newElement('table', { link: r.link, style: { fontSize: 10 } });
    if (r.kind === 'kpi') return D.newElement('kpi', { expr: r.expr, label: r.label, w: 230, h: 120, style: { fontSize: 30, fill: '#F4F7FD' } });
    if (r.kind === 'value') return D.newElement('text', { text: `${r.label}: {{${String(r.expr).replace(/^=/, '')}}}`, w: 420, h: 50, style: { fontSize: 16 } });
    return D.newElement('chart', { chartType: r.chartType || 'bar', link: r.link, title: r.title || '', w: 520, h: 320 });
  };
  E.addElement = (sheet, el, { kind = 'element', x = 0, y = null } = {}) => {
    sheet.widgets ||= [];
    const w = Math.max(1, Math.min(12, Math.round((el.w || 480) / 105))), hh = Math.max(1, Math.min(16, Math.round((el.h || 300) / 56)));
    const wd = { id: D.uid(), kind: el.type === 'image' && kind === 'element' ? 'image' : kind, x: Math.min(x, 12 - w), y: y == null ? E.bottom(sheet.widgets) : y, w, h: hh, el };
    if (el.type === 'text') { Object.assign(wd, { kind: 'text', text: el.text || '', size: (el.style && el.style.fontSize) >= 24 ? 'heading' : (el.style && el.style.fontSize) >= 16 ? 'subheading' : 'body', bullets: !!(el.style && el.style.bullets) }); delete wd.el; }
    sheet.widgets.push(wd);
    E.settle(sheet.widgets, wd);
    return wd;
  };

  // ---- every element-like thing in a sheet (for renames, "used by" counts, live tokens)
  D.elementsOf = (s) => {
    if (!s) return [];
    if (s.type === 'slide') return s.slides.flatMap((x) => x.elements);
    if (s.type === 'report') return s.elements || [];
    if (s.type === 'dash') return (s.widgets || []).flatMap((w) => (w.el ? [w.el] : w.kind === 'text' ? [w] : []));
    return [];
  };

  // ================================================================== Quick report → dashboard
  // o: the Quick report builder's choices { title, layout, views, kpiKeys, calcMetrics, roles, grain, insights, table }
  // the Quick builder's view of a table: profile, metrics and the helpers that turn its keys into dashboard settings
  const quickCtx = (src, range, o = {}) => {
    const p = DS().profile(src, range, o.roles || {});
    if (o.grain && o.grain !== 'auto') p.grain = o.grain;
    const metrics = DS().metrics(p, o.calcMetrics || []);
    const colName = (c) => { const x = p.cols.find((y) => y.c === Number(c)); return x ? x.name : null; };
    const calc = (o.calcMetrics || []).map((d) => ({ name: d.name, a: colName(d.a), b: colName(d.b), op: d.op || '/', k: d.k || 1, fmt: d.fmt || null, lowerBetter: !!d.lowerBetter, money: !!d.money })).filter((d) => d.a && d.b);
    const mOf = (key) => { const m = metrics.find((x) => x.key === String(key)); if (!m) return null; return m.count ? { metric: '', how: 'count' } : { metric: m.name, how: 'auto' }; };
    const k = DS().pickMain(p, metrics);
    const prim = (k.primary && mOf(k.primary.key)) || { metric: '', how: 'count' };
    const dimName = (by) => (by === 'entity' || by == null ? (p.entity ? p.entity.name : null) : colName(by));
    const dated = !!(p.time && p.time.type === 'date');
    return { p, metrics, colName, calc, mOf, prim, dimName, dated, grain: o.grain && o.grain !== 'auto' ? o.grain : 'auto' };
  };
  // one builder question (a "view") → a dashboard widget's settings: ['chart' | 'table', cfg] or null
  const viewCfg = (C, v, t) => {
    const { p, metrics, mOf, prim, dimName, dated } = C;
    const mm = (v.metrics || []).map(mOf).filter(Boolean);
    const m0 = mm[0] || prim;
    const by = dimName(v.by);
    const ratio = t.byName[m0.metric] && t.byName[m0.metric].role === 'ratio';
    if (v.kind === 'trend') {
      if (dated) return ['chart', { chartType: v.chartType || (ratio ? 'line' : 'bar'), ...m0, ...(mm[1] ? { metric2: mm[1].metric } : {}), by: '@date', bucket: C.grain, showValues: false }];
      if (p.time) return ['chart', { chartType: v.chartType || 'bar', ...m0, by: p.time.name, sort: 'order', top: 0, showValues: true }];
      if (p.entity) return ['chart', { chartType: 'bar', ...m0, by: p.entity.name, sort: 'order', top: 0, showValues: true }];
      return null;
    }
    if (v.kind === 'rank' && by) return ['chart', { chartType: v.chartType && v.chartType !== 'line' ? v.chartType : 'hbar', ...m0, by, top: v.top || 10, sort: v.dir === 'asc' ? 'asc' : 'desc', showValues: true }];
    if (v.kind === 'share' && by) return ['chart', { chartType: 'doughnut', ...m0, by, top: 6, showValues: true }];
    if (v.kind === 'compare' && by && mm[1]) return ['chart', { chartType: 'combo', ...m0, metric2: mm[1].metric, by, top: 12, showValues: false }];
    if (v.kind === 'cross' && by && dimName(v.by2)) return ['chart', { chartType: v.chartType || 'stacked', ...m0, by, split: dimName(v.by2), splitTop: 6, top: v.top || 10, showValues: false }];
    if (v.kind === 'scatter' && mm[1]) return ['chart', { chartType: 'scatter', metric: mm[0].metric, metric2: mm[1].metric, how: 'auto', by: dimName(v.by || 'entity'), showValues: true }];
    if (v.kind === 'table') {
      const ms = (v.metrics || []).map((kk) => metrics.find((x) => x.key === String(kk))).filter((x) => x && !x.count).map((x) => x.name);
      return ['table', by ? { mode: 'summary', by, metrics: ms, top: v.top || 0, sortBy: ms[0] } : { mode: 'rows', sortBy: '', top: 50 }];
    }
    return null;
  };
  // add one builder question to a dashboard over `src` (Ask Datum, the AI tools)
  E.addView = (sheet, src, view, { calcMetrics } = {}) => {
    const C = quickCtx(src, (sheet.ranges && sheet.ranges[src.id]) || D.links.autoRange(src), { roles: (sheet.roles && sheet.roles[src.id]) || {}, calcMetrics });
    if (!sheet.sources.includes(src.id)) sheet.sources.push(src.id);
    if (C.calc.length) { sheet.calcMetrics = [...(sheet.calcMetrics || []).filter((d) => !C.calc.some((x) => x.name === d.name)), ...C.calc]; }
    const t = E.table(sheet);
    const r = viewCfg(C, view, t);
    if (!r) return null;
    const [kind, cfg] = r;
    const wd = { id: D.uid(), kind, x: 0, y: E.bottom(sheet.widgets || []), w: kind === 'table' ? 12 : 6, h: 7, ...cfg };
    // sit next to a half-width card on the last row when there's room
    const last = (sheet.widgets || []).filter((q) => q.y + q.h === wd.y && q.x + q.w <= 6 && q.w <= 6);
    if (kind === 'chart' && last.length && !(sheet.widgets || []).some((q) => q.x >= 6 && q.y + q.h > last[0].y)) { wd.x = 6; wd.y = last[0].y; }
    (sheet.widgets ||= []).push(wd);
    E.settle(sheet.widgets, wd);
    return wd;
  };
  E.quickCtx = quickCtx;

  E.fromQuick = (src, range, o = {}, { into = null, silent = false } = {}) => {
    const C = quickCtx(src, range, o);
    const { p, metrics, colName, calc, mOf, prim, dated } = C;
    if (p.n < 2) { D.toast('Need at least two rows of data', 'warn'); return null; }
    const s = into || D.app.addSheet('dash', { activate: false, name: D.uniqueSheetName(o.title || `${src.name} Dashboard`) });
    s.sources = [src.id];
    const autoR = D.links.autoRange(src);
    s.ranges = range && range !== autoR ? { [src.id]: range } : undefined;
    s.roles = o.roles && Object.keys(o.roles).length ? { [src.id]: o.roles } : undefined;
    s.calcMetrics = calc.length ? calc : undefined;
    s.header = { show: true, title: o.title || s.name };
    s.pdf = { size: 'letter', orient: o.layout === 'portrait' ? 'portrait' : 'landscape' };
    s.filters = { date: null, vals: {} };
    s.quick = { sheetId: src.id, range, opts: { ...o } };
    const t = E.table(s);
    const out = [];
    let x = 0, y = 0;
    const put = (kind, w, hh, cfg) => { if (x + w > 12) { x = 0; y = Math.max(y + 1, ...out.filter((q) => q.y + q.h > y).map((q) => q.y + q.h)); } out.push({ id: D.uid(), kind, x, y, w, h: hh, ...cfg }); x += w; };
    const rowEnd = () => { y = Math.max(y, ...out.map((q) => q.y + q.h)); x = 0; };
    const dims = E.bestDims(t);
    // filters
    const ctl = [];
    if (dated && t.dateCols.length) ctl.push(['daterange', { col: (t.byName[p.time.name] || t.dateCols[0]).name }]);
    if (dims[0]) ctl.push(['filter', { col: dims[0].name }]);
    if (dims[1] && ctl.length < 3) ctl.push(['filter', { col: dims[1].name }]);
    ctl.forEach(([kind, cfg]) => put(kind, 4, 4, cfg));
    rowEnd();
    // headline numbers
    const keys = (o.showKpis === false ? [] : o.kpiKeys || DS().defaultKpis(p, metrics)).slice(0, 8);
    const kp = [];
    for (const key of keys) {
      const kk = String(key);
      if (kk === 'count') kp.push({ metric: '', how: 'count', compare: !!dated });
      else if (kk.startsWith('latest:')) { const mm = mOf(kk.slice(7)); if (mm && dated) kp.push({ ...mm, span: 'latest', bucket: o.grain && o.grain !== 'auto' ? o.grain : 'auto' }); }
      else if (kk.startsWith('top:')) { const d = colName(kk.slice(4)); if (d) kp.push({ ...prim, leader: d, compare: false }); }
      else { const mm = mOf(kk); if (mm) kp.push({ ...mm, compare: !!dated }); }
    }
    const per = kp.length > 4 ? 3 : 12 / Math.max(1, kp.length);
    kp.forEach((cfg) => put('kpi', per, 3, cfg));
    rowEnd();
    // written insights
    if (o.insights !== false) { put('insights', 12, 4, { ...prim, max: 6 }); rowEnd(); }
    // the questions picked in the builder, as charts and tables
    let views = o.views;
    if (!views) views = DS().suggest(p, metrics).filter((v) => v.rec).map((v) => v.view);
    const charts = [], tables = [];
    for (const v of views || []) {
      const r = viewCfg(C, v, t);
      if (r) (r[0] === 'table' ? tables : charts).push(r[1]);
    }
    charts.forEach((cfg, i) => put('chart', charts.length === 1 || (i === charts.length - 1 && i % 2 === 0) ? 12 : 6, 7, cfg));
    rowEnd();
    if (o.table !== false) tables.forEach((cfg) => { put('table', 12, Math.min(10, 4 + Math.ceil(Math.min(t.byName[cfg.by] ? t.byName[cfg.by].distinct || 8 : 10, 12) / 2)), cfg); rowEnd(); });
    s.widgets = out;
    D.dataVersion++;
    if (silent) return s;
    D.commit();
    D.app.activate(s.id, true);
    D.toast('Dashboard ready. Filters change every chart, number and sentence; PDF exports it as it looks.', 'ok', 5000);
    return s;
  };

  // ================================================================== Report pages → dashboard
  E.convertReport = (rep, { silent = false } = {}) => {
    const all = D.project().sheets;
    const at = all.indexOf(rep);
    let dash;
    const srcSheet = rep.dashSource && D.sheet(rep.dashSource.sheetId);
    if (srcSheet) {
      // built by Quick report: rebuild it live from the same choices
      dash = E.fromQuick(srcSheet, rep.dashSource.range, { ...(rep.dashSource.opts || {}), title: rep.dashSource.opts && rep.dashSource.opts.title || rep.name }, { silent: true });
    } else {
      dash = D.app.addSheet('dash', { activate: false, name: D.uniqueSheetName(rep.name) });
      const d = D.sheetTypes.report.dims(rep);
      const sf = 1280 / d.w, unit = 56;
      dash.widgets = [];
      dash.header = { show: false };
      const els = [...(rep.elements || [])].sort((a, b) => a.y - b.y || a.x - b.x);
      for (const e of els) {
        // page decoration (bands, rules) has no place on a dashboard; titles become the title band
        if (e.type === 'shape' && !(e.text || '').trim()) continue;
        if (e.type === 'text' && e.y < 90 && (e.style || {}).fontSize >= 22 && !dash.header.title) { dash.header = { show: true, title: D.f.resolveTokens(e.text || '').split('\n')[0] }; continue; }
        if (e.type === 'text' && e.y < 90 && (e.style || {}).color && /#(f|e|d|c)/i.test(e.style.color) && dash.header.title) continue;
        const el = e.type === 'shape' ? { ...D.newElement('text', { text: e.text, style: { fontSize: (e.style || {}).fontSize || 14 } }) } : D.clone(e);
        const page = Math.floor(e.y / d.h);
        const gx = Math.max(0, Math.min(11, Math.round((e.x / d.w) * 12)));
        const gy = Math.max(0, Math.round(((e.y - page * d.h) * sf + page * d.h * sf) / unit));
        el.w = e.w * sf; el.h = e.h * sf;
        E.addElement(dash, el, { x: gx, y: gy });
      }
    }
    if (!dash) return null;
    // the dashboard takes the report's place; Ctrl+Z brings the report back
    all.splice(all.indexOf(dash), 1);
    all.splice(at, 1, dash);
    dash.name = rep.name;
    if (dash.header && dash.header.title && srcSheet) dash.header.title = (rep.dashSource.opts && rep.dashSource.opts.title) || rep.name;
    D.dataVersion++;
    if (!silent) { D.commit(); D.app.activate(dash.id, true); D.toast(`“${rep.name}” is now a dashboard. Undo (Ctrl+Z) brings the report back.`, 'ok', 6000); }
    return dash;
  };

  // ---- what other sheets call on a dashboard (Send to…, images from docs and slides)
  const T = D.sheetTypes.dash;
  T.insertLinked = (sheet, spec) => {
    const w = E.addElement(sheet, E.elementFromSpec(spec));
    D.commit();
    return w;
  };
  T.addElement = (sheet, el) => { const w = E.addElement(sheet, el); D.commit(); return w; };
})();
