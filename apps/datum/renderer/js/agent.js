// Datum - the tools Claude, Codex/ChatGPT and the in-app assistant use (see mcp/tools.js for their descriptions).
// Calls arrive from the main process (the plugin bridge or an API-key assistant); each runs on the open project
// and answers with MCP-style content: { content: [{ type: 'text', text }], isError? }.
(function () {
  const AG = (D.agent = {});
  const N = () => window.native;
  const F = () => D.f;
  const E = () => D.board;
  const ok = (x) => ({ content: [{ type: 'text', text: typeof x === 'string' ? x : JSON.stringify(x) }] });
  const fail = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });
  class Oops extends Error {}
  const need = (c, msg) => { if (!c) throw new Oops(msg); return c; };
  const project = () => need(D.project(), 'No project is open in Datum. Use new_project, open_project or import_files first.');

  // sheets by id or name ("Weekly · 10-04-26", or just the tab "10-04-26" when that is unique)
  function find(ref, types) {
    const p = project();
    const ok2 = (s) => !types || types.includes(s.type);
    if (!ref) { const a = D.active(); if (a && ok2(a)) return a; const all = p.sheets.filter(ok2); if (all.length === 1) return all[0]; throw new Oops(`Say which sheet: ${all.map((s) => `"${s.name}"`).slice(0, 12).join(', ') || 'there are none of that type yet'}`); }
    const r = String(ref).trim().toLowerCase();
    const list = p.sheets.filter(ok2);
    const s = list.find((x) => x.id === ref) || list.find((x) => x.name.toLowerCase() === r)
      || (() => { const m = list.filter((x) => x.name.toLowerCase().endsWith(' · ' + r) || x.wsName === ref); return m.length === 1 ? m[0] : null; })()
      || (() => { const m = list.filter((x) => x.name.toLowerCase().includes(r)); return m.length === 1 ? m[0] : null; })();
    return need(s, `No ${types ? types.map((t) => (t === 'dash' ? 'dashboard' : t + ' sheet')).join(' or ') : 'sheet'} called "${ref}". Sheets: ${list.map((x) => `"${x.name}"`).slice(0, 15).join(', ')}`);
  }
  const dashOf = (ref) => find(ref, ['dash']);
  const dataOf = (ref) => find(ref, ['data']);
  const typeName = (t) => ({ data: 'data', dash: 'dashboard', docu: 'document', slide: 'slides', report: 'report (old style)' }[t] || t);
  const show = (s) => { if (D.active() !== s) D.app.activate(s.id, true); };
  const done = (s) => { D.dataVersion++; D.commit(); if (D.active() === s) D.app.activate(s.id, true); else show(s); };
  const stub = { cols: [], metrics: [], dateCols: [], periodCols: [], groupCols: [], sheetCols: [], byName: {}, rows: [] };
  const tableOf = (s) => ((s.sources || []).some((id) => D.sheet(id)) ? E().table(s) : stub);
  const usedRange = (s) => D.links.autoRange(s);
  const plain = (html) => String(html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

  // ---- what an AI may set on a widget
  const WFIELDS = ['title', 'metric', 'how', 'by', 'bucket', 'chartType', 'metric2', 'split', 'top', 'sort', 'showValues', 'showAs', 'compare', 'span', 'leader', 'mode', 'metrics', 'columns', 'col', 'where', 'max', 'text', 'size', 'bullets', 'align', 'colors', 'x', 'y', 'w', 'h', 'sortBy'];
  function applyFields(w, a, t) {
    for (const k of WFIELDS) {
      if (!(k in a)) continue;
      if (a[k] === null) { delete w[k]; continue; }
      w[k] = a[k];
    }
    if (a.how === 'count' && !a.metric) w.metric = '';
    // check column names so a typo fails loudly instead of drawing an empty card
    const cols = [w.metric, w.metric2, w.by !== '@date' ? w.by : null, w.split, w.leader, w.col, w.where && w.where.col, ...(w.metrics || [])].filter((c) => c && c !== '@date');
    if (t && t.cols.length) {
      const bad = cols.filter((c) => !t.byName[c]);
      if (bad.length) throw new Oops(`No column called ${bad.map((b) => `"${b}"`).join(', ')}. Columns: ${t.cols.map((c) => c.name).join(', ')}`);
    }
    for (const k of ['x', 'y', 'w', 'h']) if (k in w) w[k] = Math.max(k === 'w' || k === 'h' ? 1 : 0, Math.round(+w[k] || 0));
    if (w.w > 12) w.w = 12;
    if (w.x + w.w > 12) w.x = 12 - w.w;
  }
  function widgetInfo(w, t) {
    const { id, kind, x, y, w: ww, h, el, ...cfg } = w;
    const out = { id, kind, x, y, w: ww, h, title: E().titleFor(w, t) };
    if (el) out.linked = el.type + (el.link ? ` from ${(D.sheet(el.link.sheetId) || {}).name || '?'}!${el.link.range}` : el.src ? ' (picture)' : '');
    for (const [k, v] of Object.entries(cfg)) if (v !== undefined && k !== 'el') out[k] = v;
    return out;
  }

  // the numbers each widget shows right now, drawn by the same code as the screen
  function widgetData(s, w, t) {
    const V = Object.create(D.sheetTypes.dash.View.prototype); V.sheet = s; V.static = true;
    const title = E().titleFor(w, t);
    if (['daterange', 'filter', 'sheetfilter', 'image'].includes(w.kind)) return null;
    if (w.kind === 'chart') {
      const rows = E().where(E().rows(s, t), w);
      const d = E().chartData(w, t, rows, (E().filtersOf(s).date || {}).col);
      return { id: w.id, title, chart: w.chartType, labels: d.labels.slice(0, 60), series: d.series.map((x) => ({ name: x.name, values: x.values.slice(0, 60).map((v) => (v == null ? null : Math.round(v * 1000) / 1000)) })) };
    }
    const body = D.h('div', { class: 'db-body' });
    try { V.fill(body, w, t, { width: 900, height: 500 }); } catch (e) { return { id: w.id, title, error: e.message }; }
    if (w.kind === 'insights') return { id: w.id, title, lines: [...body.querySelectorAll('li')].map((li) => li.textContent) };
    if (w.kind === 'table') return { id: w.id, title, rows: [...body.querySelectorAll('tr')].slice(0, 40).map((tr) => [...tr.children].map((c) => c.textContent.trim())) };
    return { id: w.id, title, shows: [...body.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ') };
  }

  // ===================================================================================== tools
  const T = {};
  T.project_context = () => {
    const p = D.project();
    if (!p) return ok({ project: null, note: 'No project open. new_project, open_project {path} or import_files {paths} to start.' });
    const a = D.active();
    const v = D.app.view && D.app.view();
    return ok({
      project: { name: p.name, folder: p.dir || null, saved: !!p.dir && !D.state.dirty, unsavedChanges: !!D.state.dirty },
      open: a ? { id: a.id, name: a.name, type: typeName(a.type), selection: a.type === 'data' && v && v.selRange ? v.selRange(true) : undefined } : null,
      sheets: p.sheets.map((s) => {
        const o = { id: s.id, name: s.name, type: typeName(s.type) };
        if (s.type === 'data') { o.range = usedRange(s); if (s.dataset) o.dataSet = true; if (s.calcOf) o.helperFor = (D.sheet(s.calcOf) || {}).name; }
        if (s.type === 'dash') { o.widgets = (s.widgets || []).length; o.sources = (s.sources || []).map((id) => (D.sheet(id) || {}).name).filter(Boolean); }
        if (s.type === 'slide') o.slides = s.slides.length;
        return o;
      }),
    });
  };

  T.open_project = async ({ path }) => {
    need(path, 'Give the folder path');
    if (D.project() && D.state.dirty) throw new Oops(`“${D.project().name}” has unsaved changes. Call save_project first (or ask the user what to do with them).`);
    D.state.dirty = false;
    await D.io.openFolder(path);
    const p = need(D.project() && D.project().dir && D.project().dir.replace(/[\\/]+$/, '') === String(path).replace(/[\\/]+$/, '') && D.project(), `Couldn’t open ${path}`);
    return T.project_context();
  };
  T.new_project = async ({ name }) => {
    if (D.project() && D.state.dirty) throw new Oops(`“${D.project().name}” has unsaved changes. Call save_project first (or ask the user what to do with them).`);
    const p = D.io.blankProject(name || 'Untitled project');
    D.io.load(p);
    N().recoveryWrite(null);
    return ok(`New project “${p.name}” is open (empty). Add data with import_files or create_sheet.`);
  };
  T.save_project = async ({ parent_dir, name, __documents }) => {
    const p = project();
    if (p.dir && p.fromFolder && !p.confirmedFolderSave) throw new Oops('This project was opened from a folder of the user’s own files, and saving writes over the ones that changed. Ask the user to save it once themselves (Save button), then you can save.');
    if (p.dir) { const r = await D.io.save(false); return r ? ok(`Saved to ${p.dir}`) : fail('Save didn’t finish (see the message in Datum)'); }
    const parent = parent_dir || (__documents ? __documents.replace(/[\\/]$/, '') + (/\\/.test(__documents) ? '\\' : '/') + 'Datum' : null);
    need(parent, 'Give parent_dir: the folder to save the project folder in');
    const r = await D.io.save(false, { parentDir: parent, name });
    return r ? ok(`Saved “${p.name}” to ${p.dir}`) : fail('Save didn’t finish (see the message in Datum)');
  };
  T.import_files = async ({ paths }) => {
    need(paths && paths.length, 'Give one or more file paths');
    if (!D.project()) { D.io.load(D.io.blankProject(String(paths[0]).split(/[\\/]/).pop().replace(/\.[^.]+$/, ''))); D.project().sheets = []; }
    const before = new Set(D.project().sheets.map((s) => s.id));
    await D.io.importPaths(paths);
    const added = D.project().sheets.filter((s) => !before.has(s.id));
    if (!added.length) return fail('Nothing was imported (unsupported file, or it couldn’t be read). Supported: xlsx, xls, csv, tsv, docx, pdf, pptx, txt, md, images.');
    return ok({ imported: added.map((s) => ({ id: s.id, name: s.name, type: typeName(s.type), range: s.type === 'data' ? usedRange(s) : undefined })) });
  };

  T.read_sheet = ({ sheet, range, limit = 200, formulas }) => {
    const s = dataOf(sheet);
    const g = need(F().parseRange(range || usedRange(s)), `Bad range "${range}"`);
    const a = g.areas ? g.areas[0] : g;
    const r2 = Math.min(a.r2, a.r1 + Math.max(1, Math.min(2000, limit)) - 1);
    const rows = [];
    for (let r = a.r1; r <= r2; r++) {
      const row = [];
      for (let c = a.c1; c <= a.c2; c++) {
        const raw = (s.cells[r] || [])[c];
        if (formulas && typeof raw === 'string' && raw.startsWith('=')) { row.push(raw); continue; }
        let v = F().cellValue(s, r, c);
        if (F().isErr(v)) v = String(v.code || v.message || '#ERR');
        else if (v instanceof Date) v = F().isoDate(v);
        else if (typeof v === 'number' && /date/i.test(F().styleFmt(s, r, c) || '')) v = F().display(s, r, c);
        row.push(v === '' ? null : v);
      }
      rows.push(row);
    }
    return ok({ sheet: s.name, range: `${F().colName(a.c1)}${a.r1 + 1}:${F().colName(a.c2)}${r2 + 1}`, totalRows: a.r2 - a.r1 + 1, rows });
  };
  T.profile_sheet = ({ sheet, range }) => {
    const s = dataOf(sheet);
    const rg = range || usedRange(s);
    const DS = D.dash;
    const p = DS.profile(s, rg);
    if (p.n < 2) return ok({ sheet: s.name, range: rg, rows: p.n, note: 'Fewer than two rows of data here' });
    const metrics = DS.metrics(p, DS.autoMetrics ? DS.autoMetrics(p) : []);
    const ctx = D.ai.context(s);
    const kpis = [];
    metrics.forEach((m) => kpis.push({ key: m.key, label: m.role === 'ratio' ? `${m.name} (overall)` : `Total ${m.name}` }));
    if (p.time && p.time.type === 'date') metrics.forEach((m) => kpis.push({ key: 'latest:' + m.key, label: `${m.name}: latest period vs the one before` }));
    p.dims.forEach((d) => kpis.push({ key: 'top:' + d.c, label: `Top ${d.name}` }));
    return ok({
      sheet: s.name, range: rg, summary: DS.describe(p), rows: p.n,
      columns: p.cols.map((c) => ({ name: c.name, type: c.type, role: c.role, distinct: c.distinct })),
      date: p.time ? p.time.name : null, groups: p.dims.map((d) => d.name), entity: p.entity ? p.entity.name : null,
      measures: metrics.map((m) => ({ key: m.key, name: m.name, role: m.role })),
      questions: DS.suggest(p, metrics).map((q) => ({ id: q.id, question: q.q, recommended: !!q.rec })),
      kpis, recommendedKpis: DS.defaultKpis(p, metrics),
      facts: ctx ? ctx.facts.map((f) => F().resolveTokens(f)) : [],
    });
  };
  T.write_cells = ({ sheet, start, values }) => {
    const s = dataOf(sheet);
    const a = need(F().parseAddr(start || 'A1'), `Bad start cell "${start}"`);
    need(Array.isArray(values) && values.every(Array.isArray), 'values must be rows of cells, e.g. [["Region","Sales"],["North",120]]');
    const needR = a.r + values.length, needC = a.c + Math.max(...values.map((r) => r.length));
    while (s.cells.length < needR + 20) s.cells.push(Array((s.cells[0] || []).length || 16).fill(''));
    s.cells.forEach((row) => { while (row.length < needC + 2) row.push(''); });
    values.forEach((row, i) => row.forEach((v, j) => { s.cells[a.r + i][a.c + j] = v == null ? '' : typeof v === 'string' ? v : String(v); }));
    done(s);
    return ok(`Wrote ${values.length} row(s) to ${s.name}!${F().addr(a.r, a.c)}:${F().addr(a.r + values.length - 1, needC - 1)}`);
  };
  T.create_sheet = ({ type = 'data', name, values, sources, html }) => {
    project();
    need(['data', 'dash', 'docu', 'slide'].includes(type), 'type must be data, dash, docu or slide');
    const s = D.app.addSheet(type, { activate: false, name: name ? D.uniqueSheetName(name) : undefined });
    if (type === 'data' && values) T.write_cells({ sheet: s.id, start: 'A1', values });
    if (type === 'dash' && sources) { s.sources = sources.map((x) => dataOf(x).id); s.header = { show: true, title: s.name }; }
    if (type === 'docu' && html) s.html = html;
    done(s);
    return ok({ created: { id: s.id, name: s.name, type: typeName(type) } });
  };

  T.quick_dashboard = (a) => {
    const s = dataOf(a.sheet);
    const into = a.into ? dashOf(a.into) : null;
    const range = a.range || (into && into.quick && into.quick.range) || usedRange(s);
    const DS = D.dash;
    const p = DS.profile(s, range);
    need(p.n >= 2, 'Need at least two rows of data');
    // calculated rates come in by column name; the builder works in column positions
    const calc = (a.calc_metrics || []).map((d) => {
      const ca = p.cols.find((c) => c.name.toLowerCase() === String(d.a || '').toLowerCase()), cb = p.cols.find((c) => c.name.toLowerCase() === String(d.b || '').toLowerCase());
      need(ca && cb, `calc_metrics "${d.name}": columns ${d.a} / ${d.b} not found`);
      return { id: 'x' + D.uid().slice(0, 5), name: d.name, a: ca.c, b: cb.c, op: d.op || '/', k: d.k || 1, fmt: d.fmt || (d.k === 100 ? 'pct' : null), lowerBetter: !!d.lowerBetter, money: !!d.money };
    });
    const metrics = DS.metrics(p, calc);
    const sugg = DS.suggest(p, metrics);
    let views;
    if (a.questions && a.questions.length) {
      views = a.questions.map((id) => { const q = sugg.find((x) => x.id === id); need(q, `Unknown question "${id}". From profile_sheet: ${sugg.map((x) => x.id).join(', ')}`); return q.view; });
    }
    const o = { title: a.title || (into ? (into.header && into.header.title) || into.name : `${s.name.split(' · ').pop()} Dashboard`), layout: ['portrait', 'slides'].includes(a.layout) ? a.layout : 'landscape', views, kpiKeys: a.kpis, calcMetrics: calc.length ? calc : undefined, insights: a.insights !== false, table: a.table !== false };
    if (o.layout === 'slides') { const made = DS.build(s, range, { ...o, auto: true }); return made ? ok({ built: { id: made.id, name: made.name, type: 'slides' } }) : fail('Couldn’t build the deck'); }
    const made = need(E().fromQuick(s, range, o, { into, silent: true }), 'Couldn’t build a dashboard from that');
    done(made);
    const t = E().table(made);
    return ok({ built: { id: made.id, name: made.name }, widgets: made.widgets.map((w) => ({ id: w.id, kind: w.kind, title: E().titleFor(w, t) })), next: 'screenshot it and read dashboard_data; refine with update_widget / add_widget' });
  };

  T.get_dashboard = ({ dashboard }) => {
    const s = dashOf(dashboard); const t = tableOf(s);
    return ok({
      id: s.id, name: s.name, title: (s.header && s.header.title) || s.name, showTitle: !!(s.header && s.header.show), pdf: { size: 'letter', orient: 'landscape', ...(s.pdf || {}) },
      sources: (s.sources || []).map((id) => (D.sheet(id) || { name: '(missing)' }).name),
      rows: t.rows.length, filteredRows: t.rows.length ? E().rows(s, t).length : 0,
      columns: t.cols.map((c) => ({ name: c.name, type: c.type, role: c.role, distinct: c.distinct })),
      filters: E().filtersOf(s), subtitle: t.rows.length ? E().subtitle(s, t) : '',
      widgets: (s.widgets || []).slice().sort((a, b) => a.y - b.y || a.x - b.x).map((w) => widgetInfo(w, t)),
    });
  };
  T.add_widget = async (a) => {
    const s = dashOf(a.dashboard);
    need(E().KINDS[a.kind] && a.kind !== 'element', `kind must be one of ${Object.keys(E().KINDS).filter((k) => k !== 'element').join(', ')}`);
    const t = tableOf(s);
    if (!['text', 'image'].includes(a.kind)) need(t.cols.length, 'This dashboard has no data yet: update_dashboard {sources:[...]} first (or use quick_dashboard)');
    const K = E().KINDS[a.kind];
    const w = { id: D.uid(), kind: a.kind, x: 0, y: E().bottom(s.widgets || []), w: K.w, h: K.h, ...(t.cols.length || a.kind === 'text' ? E().defaults(a.kind, t) : {}) };
    if (a.kind === 'image') {
      need(a.image_path, 'Give image_path');
      const sheets = await N().importFile(a.image_path);
      const im = need(sheets.find((x) => x.type === 'image'), 'That file isn’t a picture Datum can read');
      w.el = D.newElement('image', { src: im.src, fit: 'contain' });
    }
    if ('x' in a && !('y' in a)) a = { ...a, y: w.y };
    applyFields(w, a, t);
    (s.widgets ||= []).push(w);
    E().settle(s.widgets, w);
    done(s);
    return ok({ added: widgetInfo(w, t) });
  };
  T.update_widget = (a) => {
    const s = dashOf(a.dashboard); const t = tableOf(s);
    const w = need((s.widgets || []).find((x) => x.id === a.id), `No widget "${a.id}" (get_dashboard lists them)`);
    const { dashboard, id, kind, ...rest } = a;
    applyFields(w, rest, t);
    if ('x' in rest || 'y' in rest || 'w' in rest || 'h' in rest) E().settle(s.widgets, w);
    done(s);
    return ok({ updated: widgetInfo(w, t) });
  };
  T.remove_widget = ({ dashboard, id }) => {
    const s = dashOf(dashboard);
    const i = (s.widgets || []).findIndex((x) => x.id === id);
    need(i >= 0, `No widget "${id}"`);
    s.widgets.splice(i, 1);
    done(s);
    return ok(`Removed. ${s.widgets.length} widget(s) left.`);
  };
  T.update_dashboard = (a) => {
    const s = dashOf(a.dashboard);
    if (a.name && a.name !== s.name) { need(!D.project().sheets.some((x) => x !== s && x.name.toLowerCase() === a.name.toLowerCase()), `A sheet is already called "${a.name}"`); s.name = a.name; }
    if (a.title != null || a.show_title != null) { s.header = { ...(s.header || {}), ...(a.title != null ? { title: a.title } : {}), show: a.show_title != null ? !!a.show_title : (s.header && s.header.show) || a.title != null }; }
    if (a.pdf_size || a.pdf_orient) { need(!a.pdf_size || ['letter', 'a4', 'legal', 'tabloid', 'a3', 'fit'].includes(a.pdf_size), 'pdf_size: letter, a4, legal, tabloid, a3 or fit'); s.pdf = { size: 'letter', orient: 'landscape', ...(s.pdf || {}), ...(a.pdf_size ? { size: a.pdf_size } : {}), ...(a.pdf_orient ? { orient: a.pdf_orient === 'portrait' ? 'portrait' : 'landscape' } : {}) }; }
    if (a.sources) s.sources = a.sources.map((x) => dataOf(x).id);
    if (a.tidy) E().compact(s.widgets || []);
    done(s);
    return T.get_dashboard({ dashboard: s.id });
  };
  T.set_filters = ({ dashboard, date, values, clear }) => {
    const s = dashOf(dashboard); const t = tableOf(s);
    const f = E().filtersOf(s);
    if (clear) { f.date = null; f.vals = {}; }
    if (date) {
      const col = date.col || (f.date && f.date.col) || (t.dateCols[0] || {}).name;
      need(col && t.byName[col], 'No date column to filter on');
      need(!date.preset || date.preset === 'all' || E().PRESETS.some(([k]) => k === date.preset), `preset must be one of all, ${E().PRESETS.map(([k]) => k).join(', ')}`);
      f.date = { col, preset: date.preset || (date.from || date.to ? 'custom' : 'all'), from: date.from, to: date.to };
    }
    for (const [c, list] of Object.entries(values || {})) { need(t.byName[c], `No column "${c}"`); if (!list || !list.length) delete f.vals[c]; else f.vals[c] = list.map(String); }
    done(s);
    return ok({ filters: f, showing: `${E().rows(s, t).length} of ${t.rows.length} rows`, subtitle: E().subtitle(s, t) });
  };
  T.dashboard_data = ({ dashboard, widget }) => {
    const s = dashOf(dashboard); const t = tableOf(s);
    const list = (s.widgets || []).filter((w) => !widget || w.id === widget).sort((a, b) => a.y - b.y || a.x - b.x);
    need(list.length, widget ? `No widget "${widget}"` : 'The dashboard is empty');
    return ok({ dashboard: s.name, period: t.rows.length ? E().subtitle(s, t) : '', widgets: list.map((w) => widgetData(s, w, t)).filter(Boolean) });
  };

  T.write_document = ({ document, html, append }) => {
    project();
    let s = null;
    try { s = document ? find(document, ['docu']) : null; } catch { s = null; }
    if (!s) s = D.app.addSheet('docu', { activate: false, name: D.uniqueSheetName(document || 'Summary') });
    if (s.format === 'pdf') throw new Oops('That document is an imported PDF; write to a new document instead');
    s.html = append ? (s.html || '') + html : html;
    s.edited = true;
    done(s);
    return ok(`${append ? 'Added to' : 'Wrote'} “${s.name}”`);
  };
  T.show_sheet = ({ sheet }) => { const s = find(sheet); D.app.activate(s.id, true); return ok(`Showing “${s.name}”`); };
  T.screenshot = async ({ sheet }) => {
    const s = sheet ? find(sheet) : need(D.active(), 'Nothing is open');
    D.app.activate(s.id, true);
    await new Promise((r) => setTimeout(r, 400));
    // when Datum is in the background the main process draws the first PDF page instead
    let page = null;
    if (s.type === 'dash' || s.type === 'slide' || s.type === 'report') { const pp = D.sheetTypes[s.type].printPages(s); if (pp[0]) page = { html: await D.io.buildPrint([pp[0]], s.name), w: pp[0].w, h: pp[0].h }; }
    return { content: [{ type: 'text', text: `“${s.name}” (${typeName(s.type)})` }], page };
  };
  T.export_pdf = async ({ sheet, path, __downloads }) => {
    const s = sheet ? find(sheet) : need(D.active(), 'Nothing is open');
    need(['dash', 'docu', 'slide', 'report', 'data'].includes(s.type), 'This sheet can’t be exported as PDF');
    const p = D.project();
    const sep = /\\/.test(p.dir || __downloads || '') ? '\\' : '/';
    const fp = path || `${(p.dir || __downloads).replace(/[\\/]$/, '')}${sep}${s.name.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`;
    await D.io.exportSheet(s, 'pdf', { filePath: fp });
    return ok({ saved: fp });
  };

  // ===================================================================================== wiring
  AG.tools = T;
  AG.call = async (name, args = {}) => {
    const fn = T[name];
    if (!fn) return fail(`Unknown tool ${name}`);
    try { return await fn(args || {}); }
    catch (e) { if (!(e instanceof Oops)) console.error(e); return fail(e.message || String(e)); }
  };
  // a quiet note in the corner while an outside AI works, so changes never seem to come from nowhere
  let pill = null, pillT = null;
  const working = (client, name) => {
    if (!pill) { pill = D.h('div', { class: 'agent-pill' }); document.body.append(pill); }
    pill.innerHTML = `${D.icon('sparkles', 13)}<span>${D.esc(client || 'AI')} · ${D.esc(String(name).replace(/_/g, ' '))}</span>`;
    pill.classList.add('on');
    clearTimeout(pillT); pillT = setTimeout(() => pill.classList.remove('on'), 4000);
  };
  if (N() && N().agent) {
    N().agent.onCall(async ({ id, name, args, client }) => {
      if (client && name !== 'screenshot') working(client, name);
      const r = await AG.call(name, args);
      N().agent.result(id, JSON.parse(JSON.stringify(r)));
    });
    N().agent.ready();
  }
})();
