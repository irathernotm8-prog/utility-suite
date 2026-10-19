// Datum - Quick Dashboard dialog: "Suggested for you" (plain-language questions) or "Build your own" (full control)
(function () {
  const h = D.h;
  const DS = D.dash;
  const ROLE_LABEL = { time: 'timeline', measure: 'amount', ratio: 'rate', dimension: 'group', entity: 'name', label: 'label', id: 'id', text: 'text', constant: 'same in every row', empty: 'empty', attr: 'date', ignored: 'ignored' };
  const KIND = {
    trend: { label: 'Over time', icon: 'line' },
    rank: { label: 'Ranking', icon: 'chart' },
    share: { label: 'Share of total', icon: 'pie' },
    compare: { label: 'Bar + line', icon: 'chart' },
    scatter: { label: 'Scatter', icon: 'line' },
    table: { label: 'Table', icon: 'table' }
  };

  DS.open = (sheet, range, preset = {}, target = null) => {
    const st = {
      tab: preset.tab || 'suggested',
      layout: preset.layout || 'landscape',
      title: preset.title || `${sheet.name} Report`,
      roles: { ...(preset.roles || {}) },
      grain: preset.grain || 'auto',
      insights: preset.insights !== false,
      showKpis: preset.showKpis !== false,
      calcMetrics: [...(preset.calcMetrics || [])],
      picks: null, kpiKeys: preset.kpiKeys ? [...preset.kpiKeys] : null, charts: preset.views ? preset.views.map((v) => ({ ...v })) : null
    };
    let p, metrics, sugg;
    const recompute = () => {
      p = DS.profile(sheet, range, st.roles);
      metrics = DS.metrics(p, st.calcMetrics);
      sugg = DS.suggest(p, metrics);
      if (!st.picks) st.picks = new Set(sugg.filter((s) => s.rec).map((s) => s.id));
      else st.picks = new Set([...st.picks].filter((id) => sugg.some((s) => s.id === id)));
      if (!st.kpiKeys) st.kpiKeys = DS.defaultKpis(p, metrics);
      st.kpiKeys = st.kpiKeys.filter((k) => kpiChoices().some((c) => c.key === k));
      if (!st.charts) st.charts = sugg.filter((s) => s.rec).map((s) => ({ ...s.view }));
    };
    try { recompute(); } catch (e) { console.error(e); }
    if (!p || (!metrics.length)) return D.toast('Select a table with at least one numeric column', 'warn');

    const body = h('div', { class: 'dash-dlg' });
    const field = (label, ctl, hint) => h('div', { class: 'field' }, h('label', null, label, hint ? h('span', { class: 'muted small' }, ' · ' + hint) : null), ctl);
    const sel = (opts, cur, on, cls = '') => { const s = h('select', { class: `input ${cls}` }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(cur) ? true : null }, l))); s.addEventListener('change', () => on(s.value)); return s; };
    const metricOpts = (filter) => metrics.filter(filter || (() => true)).map((m) => [m.key, m.name + (m.def ? ' (calculated)' : m.role === 'ratio' ? ' (rate)' : '')]);
    const byOpts = () => [...(p.entity ? [['entity', `Each ${p.noun.one} (${p.entity.name})`]] : []), ...p.dims.map((d) => [String(d.c), `${d.name} (grouped)`])];

    function kpiChoices() {
      const out = [];
      metrics.forEach((m) => out.push({ key: m.key, label: m.role === 'ratio' ? (m.derived || m.def ? `${m.name} (overall)` : `Avg ${m.name}`) : `Total ${m.name}` }));
      if (p.time) metrics.forEach((m) => out.push({ key: 'latest:' + m.key, label: `${m.name}: latest vs prior` }));
      if (p.entity) out.push({ key: 'count', label: `Number of ${p.noun.many}` });
      p.dims.forEach((d) => out.push({ key: 'top:' + d.c, label: `Top ${DS.noun(d.name).one}` }));
      if (p.entity && !p.time) out.push({ key: 'top:entity', label: `Top ${p.noun.one}` });
      return out;
    }

    const draw = () => {
      const scrollTop = body.parentElement ? body.parentElement.scrollTop : 0;
      body.innerHTML = '';
      // what Datum sees - click a column to correct it
      const detected = h('div', { class: 'dash-detected' }, h('span', { html: D.icon('sparkles', 14) }), h('span', null, DS.describe(p)));
      const roles = h('div', { class: 'dash-roles' }, p.cols.map((c) => {
        const chip = h('button', { class: `role r-${c.role} ${['constant', 'empty', 'ignored'].includes(c.role) ? 'dim' : ''}`, title: 'Click to change how this column is used' }, h('b', null, c.name), h('em', null, ROLE_LABEL[c.role] || c.role), c.derived ? h('i', { title: `${c.derived.a.name} ${c.derived.kind === 'margin' ? '−' : '÷'} ${c.derived.b.name}` }, '÷') : null);
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          const set = (role) => () => { if (role) st.roles[c.c] = role; else delete st.roles[c.c]; recompute(); draw(); };
          const cur = st.roles[c.c];
          D.menu(chip, [{ header: c.name },
            { label: 'Let Datum decide', icon: 'sparkles', checked: !cur, onClick: set(null) },
            { sep: true },
            { label: 'Names each row (campaign, product…)', checked: cur === 'entity', onClick: set('entity') },
            { label: 'Group (category to add up by)', checked: cur === 'dimension', onClick: set('dimension') },
            { label: 'Timeline (dates or periods)', checked: cur === 'time', onClick: set('time') },
            { label: 'Amount to add up', checked: cur === 'measure', onClick: set('measure') },
            { label: 'Rate or average', checked: cur === 'ratio', onClick: set('ratio') },
            { label: 'Ignore this column', checked: cur === 'ignore', onClick: set('ignore') }
          ]);
        });
        return chip;
      }));
      const tabs = h('div', { class: 'dash-tabs' },
        h('button', { class: st.tab === 'suggested' ? 'on' : '', onclick: () => { st.tab = 'suggested'; draw(); } }, h('b', null, 'Suggested for you'), h('span', null, 'Pick the questions you want answered')),
        h('button', { class: st.tab === 'custom' ? 'on' : '', onclick: () => { st.tab = 'custom'; draw(); } }, h('b', null, 'Build your own'), h('span', null, 'Choose every number and chart')));
      body.append(detected, roles, tabs, st.tab === 'suggested' ? suggestedPane() : customPane(), commonPane());
      if (body.parentElement) body.parentElement.scrollTop = scrollTop;
    };

    function suggestedPane() {
      const grid = h('div', { class: 'dash-qs' }, sugg.map((s) => {
        const on = st.picks.has(s.id);
        const k = KIND[s.view.kind] || KIND.rank;
        const card = h('button', { class: `dash-q ${on ? 'on' : ''}` },
          h('span', { class: 'dq-check', html: on ? D.icon('check', 13) : '' }),
          h('span', { class: 'dq-ic', html: D.icon(k.icon, 16) }),
          h('span', { class: 'dq-text' }, h('b', null, s.q), h('span', null, s.why)),
          s.rec ? h('span', { class: 'dq-rec' }, 'Recommended') : null);
        card.addEventListener('click', () => { if (on) st.picks.delete(s.id); else st.picks.add(s.id); draw(); });
        return card;
      }));
      const kp = DS.defaultKpis(p, metrics).map((k) => (kpiChoices().find((c) => c.key === k) || {}).label).filter(Boolean);
      return h('div', { class: 'dash-pane' },
        grid,
        h('div', { class: 'dash-kpi-preview' }, h('span', { class: 'muted small' }, 'Headline numbers: '), ...kp.map((l) => h('span', { class: 'chip' }, l)),
          h('button', { class: 'linklike', onclick: () => { st.tab = 'custom'; st.charts = sugg.filter((s) => st.picks.has(s.id)).map((s) => ({ ...s.view })); draw(); } }, 'Customize these →')));
    }

    function customPane() {
      // headline numbers
      const choices = kpiChoices();
      const kpis = h('div', { class: 'dash-chipset' }, choices.map((c) => {
        const idx = st.kpiKeys.indexOf(c.key);
        const b = h('button', { class: `chip-t ${idx >= 0 ? 'on' : ''}` }, idx >= 0 ? h('i', null, String(idx + 1)) : null, c.label);
        b.addEventListener('click', () => { if (idx >= 0) st.kpiKeys.splice(idx, 1); else if (st.kpiKeys.length < 8) st.kpiKeys.push(c.key); else D.toast('Up to 8 headline numbers', 'warn'); draw(); });
        return b;
      }));
      // charts
      const rows = h('div', { class: 'dash-rows' });
      st.charts.forEach((v, i) => {
        const k = v.kind;
        const needsBy = ['rank', 'share', 'compare', 'table'].includes(k) && byOpts().length;
        const two = k === 'compare' || k === 'scatter' || k === 'trend';
        const m1 = (v.metrics || [])[0] || (metrics[0] && metrics[0].key);
        const m2 = (v.metrics || [])[1] || '';
        const update = (patch) => { Object.assign(v, patch); draw(); };
        const typeOpts = { trend: [['', 'Auto'], ['bar', 'Columns'], ['line', 'Line'], ['area', 'Area'], ['combo', 'Bars + line']], rank: [['', 'Auto'], ['hbar', 'Bars'], ['bar', 'Columns'], ['doughnut', 'Doughnut'], ['line', 'Line']], share: [['', 'Doughnut'], ['pie', 'Pie'], ['hbar', 'Bars']], compare: [['', 'Bars + line'], ['bar', 'Grouped columns'], ['hbar', 'Grouped bars']], scatter: [['', 'Scatter']], table: [['', 'Table']] }[k] || [['', 'Auto']];
        rows.append(h('div', { class: 'dash-row' },
          h('span', { class: 'dr-n' }, String(i + 1)),
          sel(Object.entries(KIND).filter(([id]) => id !== 'trend' || p.time || true).map(([id, x]) => [id, x.label]), k, (val) => update({ kind: val, chartType: undefined, by: v.by || (byOpts()[0] || [])[0] }), 'sm'),
          k === 'table' && !needsBy ? h('span', { class: 'muted small dr-fill' }, p.time ? 'Latest rows of your data' : 'Your rows') : sel(metricOpts(), m1, (val) => update({ metrics: [val, ...(v.metrics || []).slice(1)].filter(Boolean) }), 'sm'),
          two ? sel([['', k === 'trend' ? '+ another line (optional)' : 'second metric…'], ...metricOpts((m) => m.key !== m1)], m2, (val) => update({ metrics: [m1, val].filter(Boolean) }), 'sm') : null,
          needsBy ? sel(byOpts(), v.by != null ? v.by : byOpts()[0][0], (val) => update({ by: val }), 'sm') : null,
          ['rank'].includes(k) ? sel([['desc', 'Highest first'], ['asc', 'Lowest first']], v.dir || 'desc', (val) => update({ dir: val }), 'sm xs') : null,
          k !== 'table' && k !== 'scatter' ? sel(typeOpts, v.chartType || '', (val) => update({ chartType: val || undefined }), 'sm') : null,
          h('button', { class: 'icon-btn ghost', title: 'Remove', html: D.icon('x', 14), onclick: () => { st.charts.splice(i, 1); draw(); } })));
      });
      const addRow = h('div', { class: 'dash-add' },
        h('button', { class: 'btn sm', html: D.icon('plus', 14) + '<span>Add chart</span>', onclick: () => { const m = DS.pickMain(p, metrics).primary; st.charts.push(p.time ? { kind: 'trend', metrics: [m.key] } : { kind: 'rank', by: (byOpts()[0] || [])[0], metrics: [m.key] }); draw(); } }),
        h('button', { class: 'btn sm ghost', onclick: () => { st.charts = sugg.filter((s) => s.rec).map((s) => ({ ...s.view })); draw(); } }, 'Reset to recommended'));
      // calculated metrics
      const auto = DS.autoMetrics(p).filter((a) => !st.calcMetrics.some((c) => c.id === a.id));
      const nums = p.cols.filter((c) => c.type === 'number' && !['id', 'time', 'ignored', 'constant'].includes(c.role));
      const cm = { name: '', a: nums[0] && nums[0].c, op: '/', b: nums[1] && nums[1].c, k: 1 };
      const nameIn = h('input', { class: 'input sm', placeholder: 'Name, e.g. CTR' }); nameIn.addEventListener('input', () => { cm.name = nameIn.value; });
      const numOpts = nums.map((c) => [c.c, c.name]);
      const calcBox = h('div', { class: 'dash-calc' },
        st.calcMetrics.length ? h('div', { class: 'dash-chipset' }, st.calcMetrics.map((c, i) => h('span', { class: 'chip-t on' }, `${c.name} = ${(p.cols.find((x) => x.c === c.a) || {}).name} ${{ '/': '÷', '-': '−', '+': '+', '*': '×' }[c.op]} ${(p.cols.find((x) => x.c === c.b) || {}).name}${c.k !== 1 ? ' × ' + c.k : ''}`, h('button', { class: 'chip-x', html: D.icon('x', 11), onclick: () => { st.calcMetrics.splice(i, 1); recompute(); draw(); } })))) : null,
        auto.length ? h('div', { class: 'dash-chipset' }, h('span', { class: 'muted small' }, 'Suggested: '), auto.map((a) => h('button', { class: 'chip-t add', title: `${(p.cols.find((x) => x.c === a.a) || {}).name} ÷ ${(p.cols.find((x) => x.c === a.b) || {}).name}${a.k !== 1 ? ' × ' + a.k : ''}`, onclick: () => { st.calcMetrics.push(a); recompute(); st.kpiKeys.length < 8 && st.kpiKeys.push('x:' + a.id); draw(); } }, '+ ' + a.name))) : null,
        nums.length >= 2 ? h('div', { class: 'dash-calc-row' }, nameIn, h('span', null, '='),
          sel(numOpts, cm.a, (v) => { cm.a = +v; }, 'sm'), sel([['/', '÷'], ['-', '−'], ['+', '+'], ['*', '×']], '/', (v) => { cm.op = v; }, 'sm xs'), sel(numOpts, cm.b, (v) => { cm.b = +v; }, 'sm'),
          sel([[1, '× 1'], [100, '× 100'], [1000, '× 1000']], 1, (v) => { cm.k = +v; }, 'sm xs'),
          h('button', { class: 'btn sm', onclick: () => { if (!cm.name.trim()) return D.toast('Give the metric a name', 'warn'); const id = 'c' + Date.now().toString(36); st.calcMetrics.push({ id, name: cm.name.trim(), a: cm.a, b: cm.b, op: cm.op, k: cm.k, fmt: /%|rate|ctr/i.test(cm.name) ? 'pct' : null, lowerBetter: /cost|cp[a-z]/i.test(cm.name), money: /cost|cp[a-z]|\$|spend/i.test(cm.name) }); recompute(); draw(); } }, 'Add')) : null);
      return h('div', { class: 'dash-pane' },
        field('Headline numbers', kpis, 'click in the order you want them, up to 8'),
        field('Charts and tables', h('div', null, rows, addRow)),
        field('Calculated metrics', calcBox, 'new numbers from two columns'));
    }

    function commonPane() {
      const art = (w, hh, blocks) => `<svg viewBox="0 0 ${w} ${hh}" width="${w}" height="${hh}"><rect width="${w}" height="${hh}" rx="3" fill="#fff"/>${blocks}</svg>`;
      const layoutCard = (id, label, sub, svg) => h('button', { class: `dash-layout ${st.layout === id ? 'on' : ''}`, onclick: () => { st.layout = id; draw(); } }, h('span', { class: 'dl-art', html: svg }), h('b', null, label), h('span', null, sub));
      const cards = h('div', { class: 'dash-layouts' },
        layoutCard('landscape', 'Landscape', 'Report pages', art(76, 58, '<rect width="76" height="9" fill="#0B1530"/><rect x="5" y="13" width="14" height="8" rx="1.5" fill="#DCE8FF"/><rect x="22" y="13" width="14" height="8" rx="1.5" fill="#DCE8FF"/><rect x="39" y="13" width="14" height="8" rx="1.5" fill="#DCE8FF"/><rect x="56" y="13" width="15" height="8" rx="1.5" fill="#DCE8FF"/><rect x="5" y="25" width="40" height="15" rx="1.5" fill="#2F6BFF" opacity=".75"/><rect x="48" y="25" width="23" height="15" rx="1.5" fill="#00C2FF" opacity=".6"/><rect x="5" y="44" width="66" height="10" rx="1.5" fill="#E5EAF3"/>')),
        layoutCard('portrait', 'Portrait', 'Vertical, scrolls down', art(46, 58, '<rect width="46" height="7" fill="#0B1530"/><rect x="3" y="10" width="9" height="6" rx="1" fill="#DCE8FF"/><rect x="13.5" y="10" width="9" height="6" rx="1" fill="#DCE8FF"/><rect x="24" y="10" width="9" height="6" rx="1" fill="#DCE8FF"/><rect x="34.5" y="10" width="8.5" height="6" rx="1" fill="#DCE8FF"/><rect x="3" y="19" width="40" height="13" rx="1.5" fill="#2F6BFF" opacity=".75"/><rect x="3" y="35" width="19" height="10" rx="1.5" fill="#00C2FF" opacity=".6"/><rect x="24" y="35" width="19" height="10" rx="1.5" fill="#7C5CFF" opacity=".5"/><rect x="3" y="48" width="40" height="7" rx="1.5" fill="#E5EAF3"/>')),
        layoutCard('slides', 'Slides', 'A deck, one idea per slide', art(76, 58, '<rect x="2" y="4" width="34" height="21" rx="2" fill="#EEF3FF" stroke="#C9D6F2"/><rect x="40" y="4" width="34" height="21" rx="2" fill="#EEF3FF" stroke="#C9D6F2"/><rect x="2" y="31" width="34" height="21" rx="2" fill="#EEF3FF" stroke="#C9D6F2"/><rect x="40" y="31" width="34" height="21" rx="2" fill="#EEF3FF" stroke="#C9D6F2"/><rect x="6" y="11" width="20" height="3" fill="#0B1530"/><rect x="44" y="9" width="26" height="12" rx="1" fill="#2F6BFF" opacity=".7"/><rect x="6" y="37" width="12" height="9" rx="1" fill="#DCE8FF"/><rect x="20" y="37" width="12" height="9" rx="1" fill="#DCE8FF"/><rect x="44" y="36" width="26" height="2.5" fill="#94A3B8"/><rect x="44" y="41" width="22" height="2.5" fill="#94A3B8"/><rect x="44" y="46" width="24" height="2.5" fill="#94A3B8"/>')));
      const titleIn = h('input', { class: 'input', value: st.title }); titleIn.addEventListener('input', () => { st.title = titleIn.value; });
      const chk = (key, label) => { const c = h('input', { type: 'checkbox' }); c.checked = st[key]; c.addEventListener('change', () => { st[key] = c.checked; }); return h('label', { class: 'chk' }, c, h('span', null, label)); };
      const isDate = p.time && p.time.type === 'date';
      return h('div', { class: 'dash-common' },
        field('Layout', cards),
        h('div', { class: 'row2' }, field('Title', titleIn),
          isDate ? field('Group dates by', sel([['auto', `Automatic (${p.grain === 'row' ? 'each row' : p.grain})`], ['row', 'Each row'], ['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']], st.grain, (v) => { st.grain = v; })) : h('div')),
        h('div', { class: 'dash-checks' }, chk('showKpis', 'Headline number cards'), chk('insights', 'Written insights')),
        h('p', { class: 'muted small' }, 'Groupings, rankings and calculated metrics live as formulas on a “Calc” sheet, so the report updates when your data does.'));
    }

    const build = () => {
      const views = st.tab === 'custom' ? st.charts.filter((v) => v.kind) : sugg.filter((s) => st.picks.has(s.id)).map((s) => s.view);
      if (!views.length && !st.showKpis) { D.toast('Pick at least one question or chart', 'warn'); return false; }
      const o = { layout: st.layout, title: st.title, roles: st.roles, grain: st.grain, insights: st.insights, showKpis: st.showKpis, calcMetrics: st.calcMetrics, views, kpiKeys: st.tab === 'custom' ? st.kpiKeys : null };
      setTimeout(() => (target ? DS.rebuild(target, o) : DS.build(sheet, range, o)), 0);
      return true;
    };
    draw();
    D.modal({ title: target ? `Edit “${target.name}”` : 'Quick report', width: 760, body, className: 'dash-modal', actions: [{ label: 'Cancel' }, { label: target ? 'Update report' : 'Build report', primary: true, onClick: build }] });
  };
  DS.edit = (dash) => {
    const ds = dash && dash.dashSource;
    const src = ds && D.sheet(ds.sheetId);
    if (!src) return D.toast('The data this report was built from is no longer in the project', 'warn');
    DS.open(src, D.links.autoRange(src), { ...ds.opts, layout: dash.type === 'slide' ? 'slides' : ds.opts.layout, title: ds.opts.title || dash.name, tab: ds.opts.views ? 'custom' : 'suggested' }, dash);
  };
})();
