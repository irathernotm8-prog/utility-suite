// Datum - project templates
(function () {
  const TPL = (D.templates = {});
  const grid = (rows, cols = 16, minRows = 100) => {
    const g = Array.from({ length: Math.max(minRows, rows.length + 20) }, () => Array(cols).fill(''));
    rows.forEach((r, i) => r.forEach((v, j) => { g[i][j] = v; }));
    return g;
  };
  const boldRow = (n, r = 0) => Object.fromEntries(Array.from({ length: n }, (_, c) => [`${r},${c}`, { b: true, fill: '#EAF1FF' }]));

  TPL.list = [
    { id: 'blank', name: 'Blank project', desc: 'A Data Sheet and a Slide Sheet to start from', icons: ['data', 'slide'] },
    { id: 'all', name: 'Full workspace', desc: 'One of every sheet type, ready to link together', icons: ['data', 'slide', 'docu', 'report', 'dash'] },
    { id: 'weekly', name: 'Weekly performance pack', desc: 'Sample weekly numbers driving a deck, report, dashboard and summary memo', icons: ['data', 'slide', 'report', 'dash', 'docu'] },
    { id: 'pitch', name: 'Pitch deck', desc: 'Eight-slide story with a linked market chart and traction KPIs', icons: ['data', 'slide'] }
  ];

  TPL.build = (id) => {
    const p = D.io.blankProject(id === 'weekly' ? 'Weekly Performance' : id === 'pitch' ? 'Pitch Deck' : 'Untitled project');
    const S = D.sheetTypes;
    const prevProject = D.state.project;
    D.state.project = p; // so helpers (brand, names) resolve against the new project
    try {
      if (id === 'blank') {
        p.sheets.push(S.data.create('Data'), S.slide.create('Slides'));
      } else if (id === 'all') {
        p.sheets.push(S.data.create('Data'), S.slide.create('Slides'), S.docu.create('Document'), S.report.create('Report'), S.dash.create('Dashboard'));
      } else if (id === 'weekly') {
        const data = S.data.create('Weekly Data');
        const weeks = ['Aug 4', 'Aug 11', 'Aug 18', 'Aug 25', 'Sep 1', 'Sep 8', 'Sep 15', 'Sep 22'];
        const su = [142, 158, 151, 176, 189, 203, 197, 224], spend = [4200, 4350, 4100, 4800, 5100, 5300, 5050, 5600], visits = [6100, 6600, 6350, 7200, 7550, 8000, 7900, 8650];
        const rows = [['Week', 'Sign-ups', 'Ad Spend', 'Site Visits', 'Cost per Sign-up', 'Conversion']];
        weeks.forEach((w, i) => rows.push([w, String(su[i]), String(spend[i]), String(visits[i]), `=C${i + 2}/B${i + 2}`, `=B${i + 2}/D${i + 2}`]));
        rows.push([], ['Total', '=SUM(B2:B9)', '=SUM(C2:C9)', '=SUM(D2:D9)', '=C11/B11', '=B11/D11']);
        data.cells = grid(rows);
        data.styles = { ...boldRow(6), '10,0': { b: true }, '10,1': { b: true }, '10,2': { b: true, fmt: 'cur' }, '10,3': { b: true, fmt: 'int' }, '10,4': { b: true, fmt: 'cur' }, '10,5': { b: true, fmt: 'pct' } };
        for (let r = 1; r <= 8; r++) { data.styles[`${r},2`] = { fmt: 'cur' }; data.styles[`${r},4`] = { fmt: 'cur' }; data.styles[`${r},5`] = { fmt: 'pct' }; data.styles[`${r},3`] = { fmt: 'int' }; }
        data.colWidths = { 0: 90, 1: 96, 2: 104, 3: 100, 4: 128, 5: 104 };
        data.frozen = 1;
        p.sheets.push(data);
        const link = (range) => ({ sheetId: data.id, range });
        const q = "'Weekly Data'";

        const deck = S.slide.create('Weekly Update');
        deck.slides = [S.slide.newSlide('title', { title: 'Weekly Performance Update', subtitle: 'Week of Sep 22 · Marketing' })];
        const k = S.slide.newSlide('kpis', { title: 'This week at a glance' });
        const kp = k.elements.filter((e) => e.type === 'kpi');
        Object.assign(kp[0], { label: 'Sign-ups this week', expr: `=${q}!B9`, compareExpr: `=${q}!B8`, compareLabel: 'vs last week' });
        Object.assign(kp[1], { label: 'Cost per sign-up', expr: `=${q}!E9`, compareExpr: `=${q}!E8`, compareLabel: 'vs last week', lowerIsBetter: true });
        Object.assign(kp[2], { label: '8-week sign-ups', expr: `=${q}!B11`, format: 'int' });
        k.elements.find((e) => e.type === 'text' && e.style.fontSize === 16).text = 'Sign-ups are up {{GROWTH(' + q + '!B9,' + q + '!B2)}} since early August while cost per sign-up held near {{' + q + '!E11}}.';
        deck.slides.push(k);
        const c1 = S.slide.newSlide('chart', { title: 'Sign-ups by week', subtitle: 'Best week yet: {{MAX(' + q + '!B2:B9)}} sign-ups' });
        Object.assign(c1.elements.find((e) => e.type === 'chart'), { link: link('A1:B9'), chartType: 'bar', showValues: true });
        deck.slides.push(c1);
        const c2 = S.slide.newSlide('chart', { title: 'Efficiency trend', subtitle: 'Cost per sign-up by week' });
        Object.assign(c2.elements.find((e) => e.type === 'chart'), { link: link('A1:F9'), seriesCols: [4], chartType: 'line', showValues: true });
        deck.slides.push(c2);
        const t = S.slide.newSlide('blank');
        t.elements.push(D.newElement('text', { x: 60, y: 30, w: 840, h: 60, text: 'Full weekly detail', style: { fontSize: 28, bold: true, color: p.brand.dark, valign: 'middle' } }));
        t.elements.push(D.newElement('table', { x: 60, y: 110, w: 840, h: 380, link: link('A1:F9'), style: { fontSize: 13 } }));
        deck.slides.push(t);
        deck.slides.push(S.slide.newSlide('content', { title: 'Next steps', body: 'Scale the best-performing channel\nTest new creative on the weakest week\nReview cost per sign-up target' }));
        deck.current = 0;
        p.sheets.push(deck);

        const doc = S.docu.create('Weekly Summary');
        doc.html = `<h1>Weekly Performance Summary</h1><p>Prepared for the Operations Update · week of Sep 22</p>`
          + `<h2>Headline</h2><p>We signed up <span class="dtoken" contenteditable="false" data-expr="${q.replace(/'/g, '&#39;')}!B9">224</span>&nbsp;customers this week, against <span class="dtoken" contenteditable="false" data-expr="${q.replace(/'/g, '&#39;')}!B8">197</span>&nbsp;the week before. Over eight weeks the total reached <span class="dtoken" contenteditable="false" data-expr="${q.replace(/'/g, '&#39;')}!B11">1,640</span>&nbsp;on <span class="dtoken" contenteditable="false" data-expr="${q.replace(/'/g, '&#39;')}!C11">$38,500</span>&nbsp;of ad spend.</p>`
          + `<h2>What moved</h2><ul><li>Cost per sign-up this week: <span class="dtoken" contenteditable="false" data-expr="${q.replace(/'/g, '&#39;')}!E9">$25.00</span></li><li>Conversion rate: <span class="dtoken" contenteditable="false" data-expr="${q.replace(/'/g, '&#39;')}!F9">2.6%</span></li><li>Best week: <span class="dtoken" contenteditable="false" data-expr="MAX(${q.replace(/'/g, '&#39;')}!B2:B9)">224</span>&nbsp;sign-ups</li></ul>`
          + `<h2>Sign-ups by week</h2><figure class="dlive" contenteditable="false" data-kind="chart" data-sheet="${data.id}" data-range="A1:B9" data-chart="bar" data-title="Weekly sign-ups"></figure><p><br></p>`
          + `<h2>Detail</h2><figure class="dlive" contenteditable="false" data-kind="table" data-sheet="${data.id}" data-range="A1:F9" data-chart="bar" data-title=""></figure><p>Edit the Weekly Data sheet and every number above updates.</p>`;
        p.sheets.push(doc);
        p._after = 'weekly';
      } else if (id === 'pitch') {
        const data = S.data.create('Market');
        data.cells = grid([['Year', 'Market size ($B)'], ['2023', '4.2'], ['2024', '5.1'], ['2025', '6.3'], ['2026', '7.8'], ['2027', '9.6'], [], ['Metric', 'Value'], ['Customers', '1240'], ['MRR', '86000'], ['MoM growth', '0.14'], ['Net retention', '1.18']]);
        data.styles = { ...boldRow(2), ...boldRow(2, 7), '9,1': { fmt: 'cur' }, '10,1': { fmt: 'pct' }, '11,1': { fmt: 'pct' } };
        data.colWidths = { 0: 120, 1: 140 };
        p.sheets.push(data);
        const deck = S.slide.create('Pitch');
        const N = S.slide.newSlide;
        const q = 'Market';
        deck.slides = [
          N('title', { title: 'Company Name', subtitle: 'One line that says what you do · 2026' }),
          N('content', { title: 'The problem', body: 'Who hurts, and how much\nWhat they do today instead\nWhy that is not good enough' }),
          N('two', { title: 'Our solution' }),
          (() => { const s = N('chart', { title: 'A market growing fast', subtitle: 'Reaching ${{' + q + '!B6}}B by 2027' }); Object.assign(s.elements.find((e) => e.type === 'chart'), { link: { sheetId: data.id, range: 'A1:B6' }, chartType: 'bar', showValues: true }); return s; })(),
          (() => { const s = N('kpis', { title: 'Traction' }); const k = s.elements.filter((e) => e.type === 'kpi'); Object.assign(k[0], { label: 'Customers', expr: `=${q}!B9`, format: 'int' }); Object.assign(k[1], { label: 'MRR', expr: `=${q}!B10`, format: 'cur0' }); Object.assign(k[2], { label: 'MoM growth', expr: `=${q}!B11`, format: 'pct' }); s.elements.find((e) => e.type === 'text' && e.style.fontSize === 16).text = 'Net revenue retention of {{' + q + '!B12}}'; return s; })(),
          N('content', { title: 'Business model', body: 'How we charge\nUnit economics\nPath to profitability' }),
          N('content', { title: 'Team', body: 'Founder - background\nFounder - background\nKey hire - background' }),
          N('section', { title: 'The ask', subtitle: 'Raising $X to reach Y by Z' })
        ];
        p.sheets.push(deck);
        p.activeId = deck.id;
      }
    } finally { D.state.project = prevProject; }
    if (!p.activeId) p.activeId = p.sheets[0].id;
    return p;
  };

  TPL.after = (p) => {
    if (p._after === 'weekly') {
      delete p._after;
      const data = p.sheets[0];
      D.sheetTypes.report.quickDashboard(data, 'A1:F9', { auto: true, layout: 'landscape', title: 'Weekly Performance Report' });
      // keep sheets in a sensible order: Data, Deck, Report, Dashboard, Summary
      const rep = p.sheets.find((s) => s.type === 'report');
      const deck = p.sheets.find((s) => s.type === 'slide');
      const board = D.sheetTypes.dash.create('Weekly Dashboard');
      board.sources = [data.id];
      p.sheets.push(board);
      board.widgets = D.board.autoBuild(board);
      const first = [data, deck, rep, board];
      p.sheets = [...first, ...p.sheets.filter((s) => !first.includes(s))];
      D.resetHistory();
      D.app.activate(deck.id, true);
    }
  };
})();
