// Datum - "Ask Datum": a side panel that turns plain requests into report, dashboard, chart and insight actions.
// Numbers always come from Datum's own formulas. An optional offline language model (downloaded once, runs on
// the graphics chip, nothing leaves the computer) understands looser requests and writes the replies; without it,
// a built-in planner handles the common requests.
(function () {
  const h = D.h;
  const AI = (D.ai = {});
  const DS = () => D.dash;
  const F = () => D.f;

  AI.MODELS = [
    { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', name: 'Swift', meta: 'Llama 3.2 1B · about 0.9 GB', note: 'Fastest. Fine on older laptops.' },
    { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Balanced', meta: 'Qwen 2.5 1.5B · about 1.6 GB', note: 'Recommended. Good at following instructions.' },
    { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', name: 'Sharp', meta: 'Llama 3.2 3B · about 2.3 GB', note: 'Best writing. Needs 8 GB+ of memory.' }
  ];
  const LS = { get: (k, d) => { try { const v = localStorage.getItem('datum.ai.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('datum.ai.' + k, JSON.stringify(v)); } catch {} } };
  const st = AI.state = { open: false, engine: null, loaded: null, loading: null, busy: false, msgs: [], history: [], cached: {}, model: LS.get('model', AI.MODELS[1].id), useModel: LS.get('useModel', true) };
  const hasGPU = () => !!(navigator.gpu);
  let lib = null;
  const loadLib = async () => (lib ||= await import(new URL('vendor/web-llm/web-llm.js', location.href).href));

  // ------------------------------------------------------------------ model management
  AI.refreshCache = async () => {
    if (!hasGPU()) return;
    try { const l = await loadLib(); for (const m of AI.MODELS) st.cached[m.id] = await l.hasModelInCache(m.id).catch(() => false); } catch (e) { console.warn('web-llm unavailable', e); }
  };
  AI.ensureEngine = async (onProgress) => {
    if (st.engine && st.loaded === st.model) return st.engine;
    if (st.loading) return st.loading;
    st.loading = (async () => {
      const l = await loadLib();
      const cb = (p) => onProgress && onProgress(p);
      if (st.engine) { st.engine.setInitProgressCallback(cb); await st.engine.reload(st.model); }
      else {
        const worker = new Worker(new URL('js/ai-worker.js', location.href), { type: 'module' });
        st.engine = await l.CreateWebWorkerMLCEngine(worker, st.model, { initProgressCallback: cb });
      }
      st.loaded = st.model; st.cached[st.model] = true;
      return st.engine;
    })();
    try { return await st.loading; } finally { st.loading = null; }
  };
  AI.removeModels = async () => {
    const l = await loadLib();
    for (const m of AI.MODELS) await l.deleteModelAllInfoInCache(m.id).catch(() => {});
    st.engine = null; st.loaded = null; st.cached = {};
  };
  const modelReady = () => st.useModel && hasGPU() && (st.loaded === st.model || st.cached[st.model]);

  // ------------------------------------------------------------------ context: what the assistant knows (all computed by Datum)
  function sourceSheet() {
    const a = D.active();
    if (!a) return null;
    if (a.type === 'data') return a;
    if (a.dashSource) return D.sheet(a.dashSource.sheetId);
    return D.dataSheets().find((s) => !s.calcOf && D.f.usedRows(s) > 1) || null;
  }
  const factCache = new Map();
  AI.context = (sheet) => {
    if (!sheet) return null;
    const key = sheet.id + ':' + D.dataVersion;
    if (factCache.has(key)) return factCache.get(key);
    let ctx = null;
    try {
      const f = DS().facts(sheet);
      const p = f.p;
      const metrics = f.metrics || [];
      const sugg = metrics.length ? DS().suggest(p, metrics) : [];
      ctx = { sheet, p, metrics, sugg, kpis: f.kpis, facts: f.lines };
    } catch (e) { console.error(e); ctx = null; }
    factCache.clear(); factCache.set(key, ctx);
    return ctx;
  };

  // ------------------------------------------------------------------ actions
  const findMetric = (ctx, name) => {
    if (!name) return null;
    const n = String(name).toLowerCase().replace(/\(.*?\)/g, '').trim();
    return ctx.metrics.find((m) => m.name.toLowerCase() === String(name).toLowerCase()) || ctx.metrics.find((m) => m.name.toLowerCase().replace(/\(.*?\)/g, '').trim() === n) || ctx.metrics.find((m) => n && (m.name.toLowerCase().includes(n) || n.includes(m.name.toLowerCase().replace(/\(.*?\)/g, '').trim()))) || null;
  };
  const findBy = (ctx, name) => {
    const p = ctx.p;
    if (!name) return p.entity ? 'entity' : p.dims[0] ? p.dims[0].c : p.time ? 'time' : null;
    const n = String(name).toLowerCase();
    if (/time|month|week|day|year|quarter|period|trend|date/.test(n) && p.time) return 'time';
    if (p.entity && (n.includes(p.entity.name.toLowerCase()) || n.includes(p.noun.one))) return 'entity';
    const d = p.dims.find((x) => n.includes(x.name.toLowerCase()) || n.includes(DS().noun(x.name).one));
    return d ? d.c : p.entity ? 'entity' : p.dims[0] ? p.dims[0].c : p.time ? 'time' : null;
  };
  const LABEL = { report: 'Build a report', board: 'Build a dashboard', chart: 'Add a chart', kpi: 'Add a headline number', insights: 'Add written insights', summary: 'Write a summary', dataset: 'Combine files into a data set', customize: 'Open Quick dashboard' };

  // turn a loose action into a concrete, checked one (or null if it can't be done)
  AI.resolve = (a, ctx) => {
    if (!a || !LABEL[a.type]) return null;
    const out = { ...a };
    if (a.type === 'dataset') return { type: 'dataset', title: LABEL.dataset };
    if (!ctx) return null;
    out.sheetId = ctx.sheet.id;
    if (a.type === 'board') { out.desc = `Interactive grid over ${ctx.sheet.name}${ctx.p.time ? ', with a date range filter' : ''}`; out.title = a.title || `${ctx.sheet.name} Dashboard`; return out; }
    if (a.type === 'report') {
      out.layout = ['landscape', 'portrait', 'slides'].includes(a.layout) ? a.layout : 'landscape';
      const focus = findMetric(ctx, a.focus);
      let picks = (a.questions || []).map((id) => ctx.sugg.find((s) => s.id === id)).filter(Boolean);
      if (!picks.length && focus) picks = ctx.sugg.filter((s) => (s.view.metrics || []).includes(focus.key) || s.view.kind === 'table');
      if (!picks.length) picks = ctx.sugg.filter((s) => s.rec);
      out.views = picks.map((s) => s.view);
      out.title = a.title || `${ctx.sheet.name} Report`;
      out.desc = `${out.layout === 'slides' ? 'Slides' : out.layout[0].toUpperCase() + out.layout.slice(1)} · ${picks.map((s) => s.q.replace(/\?$/, '')).slice(0, 3).join(' · ')}${picks.length > 3 ? ' …' : ''}`;
      return out;
    }
    if (a.type === 'chart') {
      const m = findMetric(ctx, a.metric) || DS().pickMain(ctx.p, ctx.metrics).primary;
      if (!m) return null;
      const m2 = findMetric(ctx, a.metric2);
      let by = findBy(ctx, a.by);
      let kind = a.chart === 'scatter' ? 'scatter' : a.chart === 'doughnut' || a.chart === 'pie' ? 'share' : a.chart === 'combo' ? 'compare' : by === 'time' ? 'trend' : 'rank';
      if (kind === 'scatter' && !m2) kind = by === 'time' ? 'trend' : 'rank';
      if (kind === 'share' && !(m.role === 'measure' && m.allPositive)) kind = 'rank';
      if (kind !== 'trend' && by === 'time') by = ctx.p.entity ? 'entity' : ctx.p.dims[0] ? ctx.p.dims[0].c : null;
      if (kind === 'trend' && !ctx.p.time) kind = by != null ? 'rank' : 'trend';
      const view = { kind, metrics: [m.key, m2 && m2.key].filter(Boolean), by: kind === 'trend' ? undefined : by, chartType: ['bar', 'hbar', 'line', 'area'].includes(a.chart) ? a.chart : undefined, dir: m.role === 'ratio' && m.lowerBetter ? 'asc' : undefined };
      if (kind === 'trend' && m2) view.metrics = [m.key, m2.key];
      if (m.def) view.calcMetrics = [m.def];
      out.view = view;
      const byName = by === 'entity' ? ctx.p.noun.one : by === 'time' || kind === 'trend' ? 'time' : (ctx.p.cols.find((c) => c.c === by) || {}).name;
      out.desc = kind === 'scatter' ? `${m2.name} vs ${m.name}` : `${m.name}${m2 ? ' and ' + m2.name : ''} ${kind === 'trend' ? 'over time' : 'by ' + (byName || 'row')}${kind === 'share' ? ' (share)' : ''}`;
      return out;
    }
    if (a.type === 'kpi') {
      const m = findMetric(ctx, a.metric) || DS().pickMain(ctx.p, ctx.metrics).primary;
      if (!m || m.def) return null;
      out.metric = m.key; out.desc = m.role === 'ratio' ? `${m.name} (overall)` : `Total ${m.name}`;
      return out;
    }
    if (a.type === 'insights' || a.type === 'summary' || a.type === 'customize') { out.desc = ctx.sheet.name; return out; }
    return null;
  };

  // where new charts / numbers go: the open report or deck, or a report made for the purpose
  function targetFor(src) {
    const a = D.active();
    if (a && (a.type === 'report' || a.type === 'slide')) return a;
    const p = D.project();
    let rep = p.sheets.find((s) => s.type === 'report' && s.aiFor === src.id);
    if (!rep) { rep = D.app.addSheet('report', { activate: false, name: D.uniqueSheetName(`${src.name} Charts`) }); rep.aiFor = src.id; rep.elements.push(...D.sheetTypes.report.header(`${src.name}`, `Charts and notes · ${new Date().toLocaleDateString()}`, D.sheetTypes.report.dims(rep).w)); }
    return rep;
  }
  const tokenSpan = (expr) => `<span class="dtoken" contenteditable="false" data-expr="${D.esc(expr).replace(/"/g, '&quot;')}">${D.esc(D.f.displayExpr(expr))}</span>`;
  const liveHtml = (line) => D.esc(line).replace(/\{\{([^}]*)\}\}/g, (_, ex) => tokenSpan(ex.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')));

  AI.run = async (a) => {
    if (a.type === 'dataset') { D.dataset.start(); return 'Opened Combine files'; }
    const src = D.sheet(a.sheetId);
    if (!src) throw new Error('That sheet is no longer in the project');
    if (a.type === 'customize') { DS().open(src, D.links.autoRange(src)); return 'Opened Quick report'; }
    if (a.type === 'board') { const made = D.sheetTypes.dash.createFor([src.id], a.title); return made ? `Built “${made.name}”` : 'Nothing built'; }
    if (a.type === 'report') { const made = DS().build(src, D.links.autoRange(src), { layout: a.layout, views: a.views, title: a.title }); return made ? `Built “${made.name}”` : 'Nothing built'; }
    if (a.type === 'chart') {
      const r = DS().chartFor(src, a.view);
      if (!r) throw new Error('Couldn’t make that chart from this data');
      const t = targetFor(src);
      if (t.type === 'slide') {
        D.sheetTypes.slide.insertLinked(t, { kind: 'chart', chartType: r.chart.chartType, link: r.chart.link, title: r.chart.title, where: 'new' });
        const sl = t.slides[t.current || 0]; const e = sl.elements[sl.elements.length - 1];
        Object.assign(e, { showValues: r.chart.showValues, valueFormat: r.chart.vf, legend: ['doughnut', 'pie', 'combo'].includes(r.chart.chartType) || undefined });
        D.commit();
      } else {
        const tall = r.chart.tall ? 420 : 300;
        D.sheetTypes.report.addElement(t, DS().chartEl(r.chart, 0, 0, r.chart.size === 'wide' ? 976 : 480, tall));
      }
      D.dataVersion++; D.app.activate(t.id, true);
      return `Added “${r.chart.title}” to ${t.name}`;
    }
    if (a.type === 'kpi') {
      const r = DS().kpiFor(src, a.metric);
      if (!r) throw new Error('Couldn\u2019t work out that number');
      const t = targetFor(src);
      if (t.type === 'slide') { D.sheetTypes.slide.insertLinked(t, { kind: 'kpi', expr: r.expr, label: r.label }); const sl = t.slides[t.current || 0]; sl.elements[sl.elements.length - 1].format = r.format; D.commit(); }
      else D.sheetTypes.report.addElement(t, D.newElement('kpi', { ...r, w: 230, h: 118, style: { fontSize: 28, fill: '#F4F7FD' } }));
      D.app.activate(t.id, true);
      return `Added “${r.label}” to ${t.name}`;
    }
    if (a.type === 'insights') {
      const lines = DS().liveInsights(src);
      if (!lines.length) throw new Error('No insights found for this data');
      const t = D.active();
      if (t && t.type === 'docu') { t.html = (t.html || '') + `<h2>Key insights</h2><ul>${lines.map((l) => `<li>${liveHtml(l)}</li>`).join('')}</ul>`; D.commit(); D.app.activate(t.id, true); return `Added ${lines.length} live insights to ${t.name}`; }
      const tg = targetFor(src);
      if (tg.type === 'slide') { const S = D.sheetTypes.slide; tg.slides.splice((tg.current || 0) + 1, 0, S.newSlide('content', { title: 'Key insights', body: lines.slice(0, 5).join('\n') })); tg.current = (tg.current || 0) + 1; D.commit(); D.app.activate(tg.id, true); return 'Added a Key insights slide'; }
      const W = D.sheetTypes.report.dims(tg).w - 80;
      D.sheetTypes.report.addElement(tg, D.newElement('text', { w: W, h: 26, text: 'Key insights', style: { fontSize: 13, bold: true, color: D.brand().dark } }));
      D.sheetTypes.report.addElement(tg, D.newElement('text', { w: W, h: 30 + lines.length * 26, text: lines.join('\n'), style: { fontSize: 11.5, color: '#1F2937', bullets: true, lineHeight: 1.45 } }));
      D.app.activate(tg.id, true);
      return `Added ${lines.length} live insights to ${tg.name}`;
    }
    if (a.type === 'summary') {
      const text = a.text || '';
      if (!text) throw new Error('No summary text');
      let doc = D.active() && D.active().type === 'docu' ? D.active() : D.project().sheets.find((s) => s.type === 'docu' && s.aiFor === src.id);
      if (!doc) { doc = D.app.addSheet('docu', { activate: false, name: D.uniqueSheetName(`${src.name} Summary`) }); doc.aiFor = src.id; doc.html = `<h1>${D.esc(src.name)} summary</h1>`; }
      doc.html = (doc.html || '') + text.split(/\n{2,}/).map((para) => `<p>${D.esc(para.trim())}</p>`).join('');
      D.commit(); D.app.activate(doc.id, true);
      return `Wrote the summary into ${doc.name}`;
    }
    return 'Done';
  };

  // ------------------------------------------------------------------ number checking: the reply may only quote numbers Datum produced
  const numsIn = (s) => (String(s).match(/-?\$?\d[\d,]*(?:\.\d+)?%?/g) || []).map((t) => ({ t, v: parseFloat(t.replace(/[$,%]/g, '')), pct: /%$/.test(t) })).filter((x) => isFinite(x.v));
  AI.verify = (text, ctx, userText = '') => {
    const pool = [...(ctx ? [...ctx.facts, ...ctx.kpis, String(ctx.p.n), ...ctx.p.cols.map((c) => c.name)] : []), userText].join(' ');
    const allowed = numsIn(pool).map((x) => x.v);
    const bad = [];
    for (const x of numsIn(text)) {
      if (Math.abs(x.v) <= 12 && Number.isInteger(x.v)) continue; // small counts ("3 campaigns")
      if (x.v >= 1900 && x.v <= 2100 && Number.isInteger(x.v)) continue; // years
      const ok = allowed.some((a) => Math.abs(a - x.v) <= Math.max(0.005 * Math.abs(a), 0.0051) || Math.abs(a * 100 - x.v) < 0.051 || Math.abs(a - x.v * 100) < 0.051);
      if (!ok) bad.push(x.t);
    }
    return bad;
  };

  // metrics mentioned in a sentence, in the order they appear ("spend vs results" → Amount spent, Results)
  const STOP = new Set(['amount', 'total', 'number', 'of', 'the', 'per', 'all', 'usd', 'count', 'sum', 'avg', 'average', 'and', 'eur', 'gbp']);
  const stemOk = (a, b) => a.length >= 3 && b.length >= 3 && (a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4) && Math.abs(a.length - b.length) <= 3));
  AI.metricsIn = (text, ctx) => {
    const toks = String(text).toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean);
    const scored = ctx.metrics.map((m) => {
      const words = m.name.toLowerCase().replace(/\(.*?\)/g, ' ').split(/[^a-z0-9%]+/).filter((w) => w && !STOP.has(w));
      const hits = words.map((w) => toks.findIndex((tk) => stemOk(w, tk)));
      const n = hits.filter((i) => i >= 0).length;
      return { m, full: words.length && n === words.length, part: n, pos: Math.min(...hits.filter((i) => i >= 0), 999), len: words.length };
    }).filter((x) => x.part > 0);
    const full = scored.filter((x) => x.full);
    const pick = (full.length ? full : scored.filter((x) => x.part === Math.max(...scored.map((y) => y.part))));
    return pick.sort((a, b) => a.pos - b.pos || b.len - a.len).map((x) => x.m);
  };
  // which Datum facts answer a question best (rare words count more; a few everyday synonyms)
  const SYN = { efficient: ['best', 'better', 'weakest', 'cost'], efficiency: ['best', 'better', 'cost'], cheapest: ['best', 'cost'], cheap: ['best', 'cost'], best: ['leads', 'best'], top: ['leads', 'top'], most: ['leads', 'most'], biggest: ['leads', 'share'], worst: ['weakest'], lowest: ['weakest'], trend: ['trending', 'changed'], growing: ['trending', 'changed', 'up'], growth: ['changed', 'trending'], latest: ['latest'], spend: ['spent'], spending: ['spent'], related: ['correlation', 'together'], relationship: ['correlation', 'together'], concentrated: ['top', 'account'], share: ['share', 'account'] };
  AI.answer = (text, ctx) => {
    const words = String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['which', 'what', 'the', 'are', 'how', 'does', 'did', 'this', 'that', 'with', 'for', 'and', 'our', 'have', 'has'].includes(w));
    const exp = [...new Set(words.flatMap((w) => [w, ...(SYN[w] || [])]))];
    const N = ctx.facts.length;
    const df = (w) => ctx.facts.filter((l) => l.toLowerCase().includes(w)).length;
    const scored = ctx.facts.map((l) => { const L = l.toLowerCase(); return { l, s: exp.reduce((a, w) => a + (L.includes(w) ? Math.log((N + 1) / (df(w) + 0.5)) : 0), 0) }; }).filter((x) => x.s > 0.4).sort((a, b) => b.s - a.s);
    return scored.slice(0, 3).map((x) => x.l);
  };

  // ------------------------------------------------------------------ built-in planner (no model needed)
  AI.rulePlan = (text, ctx) => {
    const t = text.toLowerCase();
    const acts = [];
    const ms = ctx ? AI.metricsIn(t, ctx) : [];
    let reply = '';
    if (/combine|merge (my |the )?files|data ?set|stack .*files|folder of/.test(t)) { acts.push({ type: 'dataset' }); reply = 'I can stack files that share a layout into one Data Sheet.'; }
    else if (!ctx) reply = 'Open or select a Data Sheet with some numbers first, and I’ll take it from there.';
    else if (/dashboard|interactive|filter by|date range|slice/.test(t) && !/chart|graph|report|deck|slides/.test(t)) {
      acts.push({ type: 'board' });
      reply = `Here\u2019s an interactive dashboard over ${ctx.sheet.name}. Use its date range and filter widgets to slice the data.`;
    } else if (/report|overview|one.?pager|deck|slides|presentation|summary page/.test(t) && !/chart|graph/.test(t)) {
      const layout = /slide|deck|presentation/.test(t) ? 'slides' : /portrait|vertical|scroll/.test(t) ? 'portrait' : 'landscape';
      acts.push({ type: 'report', layout, focus: ms[0] && ms[0].name });
      reply = `Here’s a ${layout === 'slides' ? 'deck' : layout + ' report'} built around ${ms[0] ? ms[0].name : 'your main numbers'}.`;
      if (/custom|choose|pick|myself/.test(t)) acts.push({ type: 'customize' });
    } else if (/chart|graph|plot|visual|compare|vs\.?|versus|against|over time|trend|share|breakdown|split/.test(t)) {
      const chart = /scatter|vs\.?|versus|against|relationship|correlat/.test(t) ? 'scatter' : /pie|donut|doughnut|share|split|portion/.test(t) ? 'doughnut' : /line|trend|over time/.test(t) ? 'line' : /bar/.test(t) ? 'hbar' : undefined;
      const by = /over time|trend|by (month|week|day|year|quarter)|monthly|weekly/.test(t) ? 'time' : (t.match(/\bby ([a-z ]+?)(?:$|[,.?!]| and | with )/) || [])[1];
      const two = chart === 'scatter' || /\bvs\.?\b|versus|against|\band\b|side by side|together/.test(t);
      acts.push({ type: 'chart', metric: ms[0] && ms[0].name, metric2: two && ms[1] ? ms[1].name : undefined, chart: chart || (two && ms[1] && !/over time|trend/.test(t) ? 'combo' : undefined), by });
      reply = 'Here’s that chart - it stays linked to the data.';
    } else if (/kpi|headline|card|big number/.test(t)) { acts.push({ type: 'kpi', metric: ms[0] && ms[0].name }); reply = 'A headline number card, linked to the data.'; }
    else if (/insight|takeaway|what (stands out|happened|changed)|highlights|key points|notable/.test(t)) {
      reply = ctx.facts.slice(0, 4).map((l) => '• ' + l).join('\n');
      acts.push({ type: 'insights' });
    } else if (ctx) {
      // a question: answer with the facts that share the most words with it
      const hits = AI.answer(t, ctx);
      if (hits.length) reply = hits.map((l) => '• ' + l).join('\n');
      else { reply = `Here’s what stands out in ${ctx.sheet.name}:\n` + ctx.facts.slice(0, 3).map((l) => '• ' + l).join('\n'); }
    }
    return { reply, actions: acts };
  };

  // ------------------------------------------------------------------ model planner
  const SCHEMA = {
    type: 'object',
    properties: {
      reply: { type: 'string' },
      actions: { type: 'array', items: { type: 'object', properties: {
        type: { type: 'string', enum: ['report', 'board', 'chart', 'kpi', 'insights', 'summary', 'dataset', 'customize'] },
        layout: { type: 'string', enum: ['landscape', 'portrait', 'slides'] },
        focus: { type: 'string' }, questions: { type: 'array', items: { type: 'string' } },
        metric: { type: 'string' }, metric2: { type: 'string' }, by: { type: 'string' },
        chart: { type: 'string', enum: ['bar', 'hbar', 'line', 'area', 'doughnut', 'scatter', 'combo'] },
        title: { type: 'string' }, text: { type: 'string' }
      }, required: ['type'] } }
    },
    required: ['reply', 'actions']
  };
  function systemPrompt(ctx) {
    const lines = [];
    lines.push('You are Datum’s report assistant. Datum is a desktop app with Data Sheets (spreadsheets), Report Sheets (printable report pages), Dashboard Sheets (interactive widget grids with date and sheet filters), Slide Sheets and Docu Sheets.');
    lines.push('You help the person turn their data into clear reports. Reply with JSON only: {"reply": string, "actions": [...]}.');
    lines.push('RULES: Only quote numbers that appear in FACTS or KPIS, copied exactly. Never calculate or invent numbers. Keep "reply" under 90 words, plain and friendly. Suggest at most 3 actions, only ones that fit the request. Use exact metric and column names from CONTEXT.');
    lines.push('ACTIONS:');
    lines.push('- {"type":"report","layout":"landscape|portrait|slides","focus":metric,"questions":[ids from QUESTIONS],"title":string} builds a full report.');
    lines.push('- {"type":"board","title":string} builds an interactive dashboard with date range and filter widgets.');
    lines.push('- {"type":"chart","metric":metric,"metric2":optional second metric,"by":column name or "time","chart":"bar|hbar|line|area|doughnut|scatter|combo"} adds one linked chart.');
    lines.push('- {"type":"kpi","metric":metric} adds a headline number card.');
    lines.push('- {"type":"insights"} adds Datum’s live insight sentences. {"type":"summary","text":string} writes an executive summary (only numbers from FACTS).');
    lines.push('- {"type":"customize"} opens the report builder. {"type":"dataset"} combines many files into one sheet.');
    lines.push('For questions about the data, answer in "reply" from FACTS and use no actions.');
    if (ctx) {
      const p = ctx.p;
      lines.push(`CONTEXT: sheet "${ctx.sheet.name}", ${p.n} rows, ${p.mode === 'trend' ? 'data over time' : p.entity ? `one row per ${p.noun.one}` : 'a table'}${p.context ? ` (${p.context})` : ''}.`);
      lines.push('COLUMNS: ' + p.cols.filter((c) => !['empty', 'constant', 'ignored'].includes(c.role)).map((c) => `${c.name} [${c.role}]`).join('; '));
      lines.push('METRICS: ' + ctx.metrics.map((m) => m.name + (m.def ? ' (calculated)' : '')).join('; '));
      lines.push('QUESTIONS: ' + ctx.sugg.map((s) => `${s.id}: ${s.q}`).join(' | '));
      lines.push('KPIS: ' + ctx.kpis.join('; '));
      lines.push('FACTS:\n' + ctx.facts.map((f) => '- ' + f).join('\n'));
    } else lines.push('CONTEXT: no Data Sheet with numbers is open.');
    return lines.join('\n');
  }
  async function modelPlan(text, ctx, onText) {
    const engine = await AI.ensureEngine((p) => progress(p));
    const messages = [{ role: 'system', content: systemPrompt(ctx) }, ...st.history.slice(-4), { role: 'user', content: text }];
    let out = '';
    const stream = await engine.chat.completions.create({ messages, stream: true, temperature: 0.3, max_tokens: 600, response_format: { type: 'json_object', schema: JSON.stringify(SCHEMA) } });
    for await (const chunk of stream) { out += chunk.choices[0]?.delta?.content || ''; const m = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(out); if (m && onText) onText(m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')); }
    let obj;
    try { obj = JSON.parse(out); } catch { obj = { reply: out.replace(/[{}"]/g, '').slice(0, 400), actions: [] }; }
    st.history.push({ role: 'user', content: text }, { role: 'assistant', content: JSON.stringify({ reply: obj.reply, actions: obj.actions }) });
    return obj;
  }

  // ------------------------------------------------------------------ panel
  let panel, list, input, statusEl;
  AI.toggle = (force) => { st.open = force != null ? force : !st.open; render(); if (st.open) setTimeout(() => input && input.focus(), 50); };
  AI.open = () => AI.toggle(true);
  function progress(p) {
    if (!statusEl) return;
    const pct = Math.round((p.progress || 0) * 100);
    const m = String(p.text || '').match(/(\d+)MB fetched/i);
    statusEl.innerHTML = '';
    statusEl.append(h('div', { class: 'ai-bar' }, h('i', { style: { width: pct + '%' } })), h('span', null, m ? `${m[1]} MB downloaded · ${pct}%` : /shader|compil/i.test(p.text) ? 'Preparing your graphics chip…' : /cache/i.test(p.text) ? 'Loading from this computer…' : 'Starting the model…'));
  }
  function render() {
    const was = document.body.classList.contains('ai-open');
    document.body.classList.toggle('ai-open', st.open);
    if (was !== st.open) setTimeout(() => window.dispatchEvent(new Event('resize')), 30);
    if (!st.open) { if (panel) panel.remove(); panel = null; return; }
    if (!panel) {
      panel = h('aside', { class: 'ai-panel' });
      document.body.append(panel);
    }
    panel.innerHTML = '';
    const m = AI.MODELS.find((x) => x.id === st.model) || AI.MODELS[1];
    const chip = !hasGPU() ? h('span', { class: 'ai-chip off', title: 'This computer can’t run the offline model, so Datum’s built-in planner is used.' }, 'Built-in') : modelReady() ? h('span', { class: 'ai-chip on', title: m.meta }, `${m.name} · offline`) : h('span', { class: 'ai-chip', title: 'Using Datum’s built-in planner' }, 'Built-in');
    panel.append(h('div', { class: 'ai-head' }, h('span', { class: 'ai-mark', html: D.icon('sparkles', 16) }), h('b', null, 'Ask Datum'), chip,
      h('button', { class: 'icon-btn ghost', title: 'Assistant settings', html: D.icon('more', 15), onclick: () => settings() }),
      h('button', { class: 'icon-btn ghost', title: 'Close (Ctrl+J)', html: D.icon('x', 15), onclick: () => AI.toggle(false) })));
    statusEl = h('div', { class: 'ai-status' });
    panel.append(statusEl);
    list = h('div', { class: 'ai-list' });
    if (!st.msgs.length) list.append(welcome());
    st.msgs.forEach((x) => list.append(bubble(x)));
    panel.append(list);
    input = h('textarea', { class: 'ai-input', rows: 2, placeholder: 'Ask about your data, or say what you want built…' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); } e.stopPropagation(); });
    panel.append(h('div', { class: 'ai-foot' }, input, h('button', { class: 'btn primary sm', html: D.icon('send', 14), title: 'Send (Enter)', onclick: () => send(input.value) })));
    list.scrollTop = list.scrollHeight;
  }
  function welcome() {
    const src = sourceSheet();
    const ctx = src ? AI.context(src) : null;
    const chips = [];
    if (ctx && ctx.metrics.length) {
      const k = DS().pickMain(ctx.p, ctx.metrics);
      chips.push('Build me a report', 'Make an interactive dashboard', ctx.p.mode === 'trend' ? `How has ${k.primary.name} changed?` : `Which ${ctx.p.noun.many} perform best?`, 'What stands out in this data?');
      if (k.spend && k.primary && k.spend !== k.primary) chips.push(`Chart ${k.spend.name} vs ${k.primary.name}`);
      chips.push('Make it a slide deck');
    } else chips.push('Combine a folder of files into a data set');
    return h('div', { class: 'ai-welcome' },
      h('p', null, ctx ? `I’m looking at “${ctx.sheet.name}” - ${DS().describe(ctx.p)}.` : 'Open a Data Sheet and I’ll help turn it into a report.'),
      h('p', { class: 'muted small' }, 'Every number I place is a live formula from your data, so nothing is made up.' + (hasGPU() && !modelReady() ? ' Download an offline model in ⋯ for looser requests and written summaries.' : '')),
      h('div', { class: 'ai-chips' }, chips.map((c) => h('button', { class: 'chip-t', onclick: () => send(c) }, c))));
  }
  function bubble(x) {
    if (x.role === 'user') return h('div', { class: 'ai-msg me' }, x.text);
    const box = h('div', { class: 'ai-msg bot' });
    const txt = h('div', { class: 'ai-text' }, x.text || (x.pending ? '…' : ''));
    box.append(txt);
    if (x.bad && x.bad.length) box.append(h('div', { class: 'ai-warn', html: D.icon('zap', 12) + `<span>Couldn’t match ${x.bad.join(', ')} to your data - check before using.</span>` }));
    (x.actions || []).forEach((a) => {
      const btn = h('button', { class: `btn sm ${a.done ? 'ghost' : 'primary'}`, disabled: a.done || a.running ? true : null }, a.done ? 'Done' : a.running ? 'Working…' : (a.type === 'summary' ? 'Add to a document' : 'Do it'));
      btn.addEventListener('click', async () => {
        a.running = true; render();
        try { a.result = await AI.run(a); a.done = true; } catch (e) { console.error(e); a.result = e.message || 'Something went wrong'; a.failed = true; }
        a.running = false; render();
      });
      box.append(h('div', { class: `ai-act ${a.failed ? 'failed' : ''}` }, h('span', { class: 'aa-ic', html: D.icon(a.type === 'chart' ? 'chart' : a.type === 'kpi' ? 'kpi' : a.type === 'report' ? 'report' : a.type === 'board' ? 'grid' : a.type === 'dataset' ? 'layers' : a.type === 'summary' ? 'docu' : 'sparkles', 15) }),
        h('span', { class: 'aa-t' }, h('b', null, a.label || LABEL[a.type]), h('span', null, a.result || a.desc || '')), btn));
    });
    return box;
  }
  async function send(text) {
    text = String(text || '').trim();
    if (!text || st.busy) return;
    if (input) input.value = '';
    st.msgs.push({ role: 'user', text });
    const bot = { role: 'bot', text: '', pending: true, actions: [] };
    st.msgs.push(bot);
    st.busy = true; render();
    const src = sourceSheet();
    const ctx = src ? AI.context(src) : null;
    try {
      let plan;
      if (modelReady()) {
        try { plan = await modelPlan(text, ctx, (t) => { bot.text = t; const el = list && list.lastChild && list.lastChild.querySelector('.ai-text'); if (el) el.textContent = t; }); }
        catch (e) { console.error(e); D.toast('The offline model couldn’t answer - using the built-in planner', 'warn'); plan = AI.rulePlan(text, ctx); }
        if (statusEl) statusEl.innerHTML = '';
      } else plan = AI.rulePlan(text, ctx);
      bot.text = plan.reply || (plan.actions && plan.actions.length ? 'Here’s what I can do:' : 'I couldn’t find anything for that - try asking about a specific number or chart.');
      bot.bad = AI.verify(bot.text, ctx, text);
      bot.actions = (plan.actions || []).map((a) => AI.resolve(a, ctx)).filter(Boolean).slice(0, 3);
      bot.actions.forEach((a) => { a.label = (a.type === 'report' || a.type === 'board') && a.title ? `Build “${a.title}”` : LABEL[a.type]; if (a.type === 'summary') { a.bad = AI.verify(a.text, ctx, text); a.desc = (a.text || '').slice(0, 140) + ((a.text || '').length > 140 ? '…' : '') + (a.bad.length ? ` (unverified: ${a.bad.join(', ')})` : ''); } });
    } catch (e) { console.error(e); bot.text = 'Something went wrong: ' + (e.message || e); }
    bot.pending = false; st.busy = false; render();
  }
  AI.send = send;

  function settings() {
    const gpu = hasGPU();
    const use = h('input', { type: 'checkbox' }); use.checked = st.useModel;
    use.addEventListener('change', () => { st.useModel = use.checked; LS.set('useModel', st.useModel); });
    const cards = h('div', { class: 'ai-models' }, AI.MODELS.map((m) => {
      const on = st.model === m.id;
      return h('button', { class: `ai-model ${on ? 'on' : ''}`, disabled: gpu ? null : true, onclick: () => { st.model = m.id; LS.set('model', m.id); D.closeModals && D.closeModals(); settings(); } },
        h('b', null, m.name, st.cached[m.id] ? h('em', null, ' · downloaded') : null), h('span', null, m.meta), h('span', { class: 'muted small' }, m.note));
    }));
    const body = h('div', { class: 'ai-settings' },
      h('p', null, 'An optional language model can run entirely on this computer to understand looser requests and write summaries. It downloads once, then works offline - nothing you type or any data leaves your Mac.'),
      gpu ? null : h('p', { class: 'ai-warn' }, 'This computer’s graphics chip isn’t available to Datum, so only the built-in planner can be used.'),
      cards,
      h('label', { class: 'chk' }, use, h('span', null, 'Use the offline model when it’s downloaded')),
      h('p', { class: 'muted small' }, 'Either way, numbers come from Datum’s formulas, and the assistant flags any figure it can’t match to your data.'));
    let closeFn;
    closeFn = D.modal({ title: 'Ask Datum settings', width: 560, body, actions: [
      { label: 'Remove downloaded models', danger: true, onClick: () => { AI.removeModels().then(() => D.toast('Downloaded models removed', 'ok')); } },
      { label: 'Close' },
      gpu ? { label: st.cached[st.model] ? 'Load model now' : 'Download model', primary: true, onClick: () => { AI.toggle(true); st.useModel = true; LS.set('useModel', true); AI.ensureEngine(progress).then(() => { if (statusEl) statusEl.innerHTML = ''; D.toast('Offline model ready', 'ok'); render(); }).catch((e) => { console.error(e); if (statusEl) statusEl.innerHTML = ''; D.toast(/memory|allocate/i.test(String(e)) ? 'Not enough memory - try the Swift model' : navigator.onLine ? 'Couldn’t load the model' : 'You’re offline and this model isn’t downloaded yet', 'warn', 6000); }); } } : null
    ].filter(Boolean) });
  }
  AI.settings = settings;

  // ------------------------------------------------------------------ wiring
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'j') { e.preventDefault(); AI.toggle(); } });
  setTimeout(() => AI.refreshCache(), 2500);
})();
