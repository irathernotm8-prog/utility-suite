// Datum - application shell
(function () {
  const h = D.h;
  const A = (D.app = {});
  let view = null; // mounted sheet controller
  let mountedId = null;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------ status / busy
  A.setStatus = (html) => { const s = $('status-left'); if (s) s.innerHTML = html || ''; };
  A.busy = (msg) => {
    const b = $('busy');
    if (!msg) { b.classList.remove('on'); return; }
    b.querySelector('span').textContent = msg;
    b.classList.add('on');
  };
  A.flashSaved = (r) => {
    D.project().savedAt = r.savedAt;
    A.renderTop();
  };

  // ------------------------------------------------ sheets
  A.addSheet = (type, { activate = true, name } = {}) => {
    const p = D.project();
    const base = { data: 'Data', slide: 'Slides', docu: 'Document', report: 'Report', dash: 'Dashboard' }[type];
    const s = D.sheetTypes[type].create(name || D.uniqueSheetName(base));
    const idx = p.sheets.findIndex((x) => x.id === p.activeId);
    p.sheets.splice(idx + 1, 0, s);
    D.commit({ data: false });
    if (activate) A.activate(s.id); else A.renderTabs();
    return s;
  };
  A.view = () => view;
  A.flushActive = () => { if (view && view.save) view.save(true); };
  A.activate = (id, force = false) => {
    const p = D.project();
    if (!p || !D.sheet(id)) return;
    if (!force && mountedId === id && view) { A.renderTabs(); return; }
    if (view) { try { view.destroy(); } catch (e) { console.error(e); } view = null; }
    p.activeId = id;
    mountedId = id;
    const sheet = D.sheet(id);
    const host = $('sheet-host');
    host.innerHTML = '';
    host.className = `sheet-host t-${sheet.type}`;
    A.setStatus('');
    try { view = D.sheetTypes[sheet.type].mount(host, sheet); }
    catch (err) { console.error(err); host.append(h('div', { class: 'empty-note' }, `This sheet could not be displayed: ${err.message}`)); }
    A.renderTabs();
    A.renderStatusRight();
  };
  A.goToRange = (sheetId, range) => {
    const s = D.sheet(sheetId);
    if (!s) return D.toast('That data sheet no longer exists', 'warn');
    s._jump = range;
    A.activate(sheetId, true);
  };
  A.renameSheet = async (s) => {
    const n = await D.prompt('Rename sheet', s.name);
    if (!n || n === s.name) return;
    if (D.project().sheets.some((x) => x !== s && x.name.toLowerCase() === n.toLowerCase())) return D.toast('Another sheet already has that name', 'warn');
    if (s.type === 'data') D.f.renameRefs(s.name, n);
    s.name = n;
    D.commit();
    A.activate(D.project().activeId, true);
  };
  A.deleteSheet = async (s) => {
    const p = D.project();
    const uses = s.type === 'data' ? D.f.usages(s.id) : [];
    const msg = uses.length ? `“${s.name}” feeds ${uses.length} linked item${uses.length > 1 ? 's' : ''} (${[...new Set(uses.map((u) => u.where))].slice(0, 3).join(', ')}). They will lose their data.` : `Delete “${s.name}”? You can undo this.`;
    if (!(await D.confirm('Delete sheet', msg, 'Delete', true))) return;
    const i = p.sheets.indexOf(s);
    p.sheets.splice(i, 1);
    if (!p.sheets.length) { D.commit(); mountedId = null; if (view) view.destroy(); view = null; A.renderAll(); return; }
    D.commit();
    A.activate(p.sheets[Math.max(0, i - 1)].id, true);
  };
  A.duplicateSheet = (s) => {
    const c = D.clone(s);
    c.id = D.uid(); c.name = D.uniqueSheetName(`${s.name} copy`);
    delete c.source;
    const p = D.project();
    p.sheets.splice(p.sheets.indexOf(s) + 1, 0, c);
    D.commit();
    A.activate(c.id);
  };

  A.newSheetMenu = (anchor) => D.menu(anchor, [
    { header: 'New sheet' },
    ...['data', 'slide', 'docu', 'report', 'dash'].map((t) => ({ label: `${D.TYPE_META[t].label}`, icon: D.TYPE_META[t].icon, kbd: '.' + (t === 'docu' ? 'docx' : D.TYPE_META[t].ext), onClick: () => A.addSheet(t) })),
    { sep: true },
    { label: 'Data set (combine files)…', icon: 'layers', onClick: () => D.dataset.start() },
    { label: 'Open file as sheet…', icon: 'fileUp', kbd: 'Ctrl+Shift+O', onClick: () => D.io.openFiles() }
  ]);

  // ------------------------------------------------ rendering
  A.renderAll = () => {
    const p = D.project();
    document.body.classList.toggle('has-project', !!p);
    if (!p) {
      if (view) { view.destroy(); view = null; }
      mountedId = null;
      A.renderHome();
      A.renderTop();
      return;
    }
    $('home').innerHTML = '';
    A.renderTop();
    if (!p.sheets.length) {
      $('tabs').innerHTML = '';
      A.renderTabs();
      const host = $('sheet-host');
      if (view) { view.destroy(); view = null; } mountedId = null;
      host.innerHTML = '';
      host.append(h('div', { class: 'empty-project' }, h('div', { class: 'ep-title' }, 'Add your first sheet'), h('div', { class: 'type-cards' }, ['data', 'slide', 'docu', 'report', 'dash'].map((t) => typeCard(t, () => A.addSheet(t))))));
      return;
    }
    A.activate(p.activeId, true);
  };

  function typeCard(t, onClick) {
    const m = D.TYPE_META[t];
    return h('button', { class: 'type-card', style: { '--tc': m.color }, onclick: onClick },
      h('span', { class: 'tc-icon', html: D.icon(m.icon, 22) }), h('span', { class: 'tc-name' }, m.label), h('span', { class: 'tc-hint' }, m.hint));
  }

  A.renderTop = () => {
    const p = D.project();
    const top = $('topbar');
    top.innerHTML = '';
    const logo = h('div', { class: 'logo', title: 'Home', onclick: () => p && D.io.closeProject() }, h('span', { class: 'logo-mark', html: '<svg viewBox="0 0 32 32" width="22" height="22"><defs><linearGradient id="dmT" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1C2A4A"/><stop offset="1" stop-color="#060A14"/></linearGradient><linearGradient id="dmD" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7AA6FF"/><stop offset="1" stop-color="#2F6BFF"/></linearGradient></defs><rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="url(#dmT)" stroke="#2F4A80" stroke-width="1"/><path fill="url(#dmD)" fill-rule="evenodd" d="M8.75 8.54H15.8C20.3 8.54 23 11.92 23 16C23 20.08 20.3 23.47 15.8 23.47H8.75ZM12.34 12.06V19.95H15.58C17.7 19.95 19.25 18.25 19.25 16C19.25 13.75 17.7 12.06 15.58 12.06Z"/><circle cx="23.25" cy="9.17" r="1.76" fill="#00C2FF"/></svg>' }), h('span', { class: 'logo-word' }, 'datum'));
    top.append(logo);
    if (p) {
      const name = h('button', { class: 'proj-name', title: 'Rename project', onclick: async () => { const n = await D.prompt('Project name', p.name); if (n) { p.name = n; D.markDirty(); A.renderTop(); } } }, p.name);
      const saved = h('div', { class: `save-state ${D.state.dirty ? 'dirty' : ''}` }, h('span', { class: 'ss-dot' }), D.state.dirty ? 'Unsaved changes' : p.savedAt ? `Saved ${new Date(p.savedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : p.dir ? 'Opened from folder' : 'Not saved yet');
      if (p.dir) saved.title = p.dir;
      top.append(h('div', { class: 'proj' }, name, saved));
    }
    top.append(h('div', { class: 'top-spacer' }));
    const palBtn = h('button', { class: 'palette-btn', onclick: () => A.palette() }, h('span', { html: D.icon('search', 14) }), h('span', null, p ? 'Search sheets, slides & commands' : 'Search commands'), h('kbd', null, 'Ctrl K'));
    top.append(palBtn);
    top.append(h('div', { class: 'top-spacer' }));
    top.append(D.btn('sparkles', 'Ask Datum: build reports, dashboards, charts and insights by asking (Ctrl+J)', () => D.ai.toggle(), { label: 'Ask Datum', cls: 'top ai-top' }));
    const openBtn = D.btn('folderOpen', 'Open', () => openMenu(openBtn), { label: 'Open', caret: true, cls: 'top' });
    top.append(openBtn);
    if (p) {
      const exportBtn = D.btn('download', 'Export', () => exportMenu(exportBtn), { label: 'Export', caret: true, cls: 'top' });
      top.append(
        D.btn('palette', 'Brand kit - colors, fonts and logo used across the project', () => A.brandKit(), { label: 'Brand', cls: 'top' }),
        exportBtn,
        D.btn('save', 'Save project folder (Ctrl+S)', () => D.io.save(), { label: 'Save', cls: 'top primary' })
      );
    }
    document.title = p ? `${p.name}${D.state.dirty ? ' •' : ''} - Datum` : 'Datum';
  };

  function openMenu(anchor) {
    D.native.recent().then((rec) => D.menu(anchor, [
      { label: 'Open project folder…', icon: 'folderOpen', kbd: 'Ctrl+O', onClick: () => D.io.openFolder() },
      { label: 'Open files as sheets…', icon: 'fileUp', kbd: 'Ctrl+Shift+O', onClick: () => D.io.openFiles() },
      { label: 'New project', icon: 'plus', sub: D.templates.list.map((t) => ({ label: t.name, onClick: () => D.io.newProject(t.id).then(() => D.templates.after(D.project())) })) },
      rec.length ? { sep: true } : null,
      rec.length ? { header: 'Recent' } : null,
      ...rec.slice(0, 6).map((r) => ({ label: r.name, icon: 'folder', onClick: () => D.io.openFolder(r.path) })),
      D.project() ? { sep: true } : null,
      D.project() ? { label: 'Close project', icon: 'x', onClick: () => D.io.closeProject() } : null
    ]));
  }
  function exportMenu(anchor) {
    const s = D.active();
    const p = D.project();
    const m = s && D.TYPE_META[s.type];
    D.menu(anchor, [
      s ? { header: s.name } : null,
      s && s.type === 'data' ? { label: 'Excel workbook (.xlsx)', icon: 'data', onClick: () => D.io.exportSheet(s, 'xlsx') } : null,
      s && s.type === 'slide' ? { label: 'PowerPoint (.pptx)', icon: 'slide', onClick: () => D.io.exportSheet(s, 'pptx') } : null,
      s && s.type === 'docu' ? { label: 'Word document (.docx)', icon: 'docu', onClick: () => D.io.exportSheet(s, 'docx') } : null,
      s ? { label: 'PDF', icon: 'pdf', onClick: () => D.io.exportSheet(s, 'pdf') } : null,
      { sep: true },
      { header: 'Whole project' },
      { label: 'Save as new project folder…', icon: 'save', kbd: 'Ctrl+Shift+S', onClick: () => D.io.save(true) },
      { label: 'Combine sheets into one PDF…', icon: 'pdf', onClick: () => D.io.exportAllPdf() },
      p.dir ? { label: 'Show project folder', icon: 'folder', onClick: () => D.native.reveal(p.dir) } : null
    ]);
  }

  A.renderTabs = () => {
    const p = D.project();
    const bar = $('tabs');
    bar.innerHTML = '';
    if (!p) return;
    p.sheets.forEach((s, i) => {
      const m = D.TYPE_META[s.type];
      const ext = s.type === 'docu' ? (s.format === 'pdf' ? 'pdf' : 'docx') : m.ext;
      const tab = h('div', { class: `tab ${s.id === p.activeId ? 'on' : ''}`, draggable: 'true', style: { '--tc': m.color }, title: `${m.label} · saves as .${ext}` },
        h('span', { class: 'tab-ic', html: D.icon(m.icon, 14) }),
        h('span', { class: 'tab-name' }, s.name),
        h('span', { class: 'tab-ext' }, ext),
        h('button', { class: 'tab-x', title: 'Delete sheet', html: D.icon('x', 12), onclick: (e) => { e.stopPropagation(); A.deleteSheet(s); } }));
      tab.addEventListener('mousedown', (e) => { if (e.button === 0 && !e.target.closest('.tab-x')) A.activate(s.id); });
      tab.addEventListener('dblclick', () => A.renameSheet(s));
      tab.addEventListener('contextmenu', (e) => { e.preventDefault(); D.menu({ x: e.clientX, y: e.clientY }, [
        { label: 'Rename', icon: 'edit', onClick: () => A.renameSheet(s) },
        { label: 'Duplicate', icon: 'copy', onClick: () => A.duplicateSheet(s) },
        { label: `Export .${ext}`, icon: 'download', onClick: () => D.io.exportSheet(s, ext) },
        s.type !== 'data' && ext !== 'pdf' ? { label: 'Export PDF', icon: 'pdf', onClick: () => D.io.exportSheet(s, 'pdf') } : null,
        s.type === 'docu' ? { label: 'Turn into a slide deck', icon: 'wand', onClick: () => D.sheetTypes.docu.toDeck(s) } : null,
        s.dataset ? { label: 'Refresh data set', icon: 'refresh', onClick: () => D.dataset.refresh(s) } : null,
        s.type === 'data' ? { label: 'Build dashboard', icon: 'grid', onClick: () => D.sheetTypes.dash.createFor([s.id]) } : null,
        s.type === 'data' && D.board.siblings(s).length > 1 ? { label: `Build dashboard from all ${D.board.siblings(s).length} tabs like this`, icon: 'grid', onClick: () => { const sib = D.board.siblings(s); D.sheetTypes.dash.createFor(sib.map((x) => x.id), `${String(s.name).split(' · ')[0]} Dashboard`); } } : null,
        s.type === 'data' ? { label: 'Build report', icon: 'sparkles', onClick: () => D.sheetTypes.report.quickDashboard(s, D.links.autoRange(s)) } : null,
        { sep: true },
        { label: 'Move left', icon: 'arrowUp', disabled: i === 0, onClick: () => moveTab(i, i - 1) },
        { label: 'Move right', icon: 'arrowDown', disabled: i === p.sheets.length - 1, onClick: () => moveTab(i, i + 1) },
        { sep: true },
        { label: 'Delete sheet', icon: 'trash', danger: true, onClick: () => A.deleteSheet(s) }
      ]); });
      tab.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-tab', String(i)); tab.classList.add('dragging'); });
      tab.addEventListener('dragend', () => tab.classList.remove('dragging'));
      tab.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-tab')) { e.preventDefault(); const r = tab.getBoundingClientRect(); tab.classList.toggle('drop-l', e.clientX < r.left + r.width / 2); tab.classList.toggle('drop-r', e.clientX >= r.left + r.width / 2); } });
      tab.addEventListener('dragleave', () => tab.classList.remove('drop-l', 'drop-r'));
      tab.addEventListener('drop', (e) => {
        e.preventDefault(); tab.classList.remove('drop-l', 'drop-r');
        const from = +e.dataTransfer.getData('text/x-tab');
        const r = tab.getBoundingClientRect();
        let to = e.clientX < r.left + r.width / 2 ? i : i + 1;
        if (from < to) to--;
        moveTab(from, to);
      });
      bar.append(tab);
    });
    const add = h('button', { class: 'tab-add', title: 'New sheet (Ctrl+T)', html: D.icon('plus', 15) });
    add.addEventListener('click', () => A.newSheetMenu(add));
    bar.append(add);
    const on = bar.querySelector('.tab.on');
    on && on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  function moveTab(from, to) {
    const p = D.project();
    if (from === to || to < 0 || to >= p.sheets.length) return;
    const [s] = p.sheets.splice(from, 1);
    p.sheets.splice(to, 0, s);
    D.commit({ data: false });
    A.renderTabs();
  }

  A.renderStatusRight = () => {
    const p = D.project(); const s = D.active();
    const el = $('status-right');
    if (!p || !s) { el.innerHTML = ''; return; }
    const m = D.TYPE_META[s.type];
    const ext = s.type === 'docu' ? (s.format === 'pdf' ? 'PDF' : 'Word (.docx)') : { xlsx: 'Excel (.xlsx)', pptx: 'PowerPoint (.pptx)', pdf: 'PDF' }[m.ext];
    el.innerHTML = '';
    el.append(h('span', { class: 'st-type', style: { color: m.color }, html: D.icon(m.icon, 12) + D.esc(m.label) }), h('span', { class: 'st-sep' }), h('span', null, `Saves as ${ext}`));
    if (p.dir) el.append(h('span', { class: 'st-sep' }), h('button', { class: 'st-folder', title: p.dir, onclick: () => D.native.reveal(p.dir), html: D.icon('folder', 12) + D.esc(p.dir.split(/[\\/]/).pop()) }));
  };

  // ------------------------------------------------ home
  A.renderHome = async () => {
    const home = $('home');
    home.innerHTML = '';
    const rec = await D.native.recent();
    const tplCard = (t) => h('button', { class: 'tpl-card', onclick: async () => { await D.io.newProject(t.id); if (D.project()) D.templates.after(D.project()); } },
      h('div', { class: 'tpl-icons' }, t.icons.map((i) => h('span', { style: { color: (D.TYPE_META[i] || {}).color }, html: D.icon((D.TYPE_META[i] || {}).icon || i, 18) }))),
      h('div', { class: 'tpl-name' }, t.name), h('div', { class: 'tpl-desc' }, t.desc));
    home.append(h('div', { class: 'home-inner' },
      h('div', { class: 'hero' },
        h('div', { class: 'hero-mark', html: '<svg viewBox="0 0 32 32" width="56" height="56"><defs><linearGradient id="dmT" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1C2A4A"/><stop offset="1" stop-color="#060A14"/></linearGradient><linearGradient id="dmD" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7AA6FF"/><stop offset="1" stop-color="#2F6BFF"/></linearGradient></defs><rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="url(#dmT)" stroke="#2F4A80" stroke-width="1"/><path fill="url(#dmD)" fill-rule="evenodd" d="M8.75 8.54H15.8C20.3 8.54 23 11.92 23 16C23 20.08 20.3 23.47 15.8 23.47H8.75ZM12.34 12.06V19.95H15.58C17.7 19.95 19.25 18.25 19.25 16C19.25 13.75 17.7 12.06 15.58 12.06Z"/><circle cx="23.25" cy="9.17" r="1.76" fill="#00C2FF"/></svg>' }),
        h('h1', null, 'datum'),
        h('p', null, 'Spreadsheets, slides, documents, reports and dashboards in one project, all linked, so a number changed once updates everywhere.'),
        h('div', { class: 'hero-actions' },
          h('button', { class: 'btn primary lg', onclick: async () => { await D.io.newProject('blank'); } , html: D.icon('plus', 16) + '<span>New project</span>' }),
          h('button', { class: 'btn lg', onclick: () => D.io.openFolder(), html: D.icon('folderOpen', 16) + '<span>Open project folder</span>' }),
          h('button', { class: 'btn lg ghost', onclick: () => D.io.openFiles(), html: D.icon('fileUp', 16) + '<span>Open files</span>' }),
          h('button', { class: 'btn lg ghost', title: 'Combine many spreadsheets with the same layout into one Data Sheet', onclick: () => D.dataset.start(), html: D.icon('layers', 16) + '<span>Combine files</span>' }))),
      h('div', { class: 'home-cols' },
        h('div', { class: 'home-col' },
          h('div', { class: 'home-h' }, 'Start from a template'),
          h('div', { class: 'tpl-grid' }, D.templates.list.map(tplCard))),
        h('div', { class: 'home-col narrow' },
          h('div', { class: 'home-h' }, 'Recent projects'),
          rec.length ? h('div', { class: 'recent' }, rec.map((r) => h('button', { class: 'recent-row', onclick: () => D.io.openFolder(r.path), title: r.path },
            h('span', { class: 'rr-ic', html: D.icon('folder', 16) }),
            h('span', { class: 'rr-main' }, h('span', { class: 'rr-name' }, r.name), h('span', { class: 'rr-path' }, r.path)),
            h('span', { class: 'rr-time' }, D.fmtTime(r.openedAt))))) : h('div', { class: 'recent-empty' }, 'Projects you save or open show up here. Drop any folder or files onto this window to open them.'))),
      h('div', { class: 'home-h' }, 'Four sheets, one project'),
      h('div', { class: 'type-cards' }, ['data', 'slide', 'docu', 'report', 'dash'].map((t) => typeCard(t, async () => { await D.io.newProject('blank'); if (D.project()) { D.project().sheets = []; A.addSheet(t); } })))
    ));
  };

  // ------------------------------------------------ brand kit
  const PRESETS = [
    { name: 'Electric', primary: '#1F6BFF', accent: '#00C2FF', dark: '#0B1530', palette: ['#1F6BFF', '#00C2FF', '#7C5CFF', '#14B8A6', '#F59E0B', '#EF4444', '#64748B'] },
    { name: 'Midnight', primary: '#3B4CCA', accent: '#8EA2FF', dark: '#0F1226', palette: ['#3B4CCA', '#8EA2FF', '#22C3E6', '#F2B84B', '#E5677A', '#4BC59C', '#7A819C'] },
    { name: 'Emerald', primary: '#0E9F6E', accent: '#34D399', dark: '#06281E', palette: ['#0E9F6E', '#34D399', '#0EA5E9', '#F59E0B', '#8B5CF6', '#EF4444', '#64748B'] },
    { name: 'Ember', primary: '#E4572E', accent: '#F3A712', dark: '#29110A', palette: ['#E4572E', '#F3A712', '#2E86AB', '#76B041', '#A23B72', '#4A4E69', '#8D99AE'] },
    { name: 'Graphite', primary: '#334155', accent: '#0EA5E9', dark: '#0F172A', palette: ['#334155', '#0EA5E9', '#94A3B8', '#22C55E', '#F97316', '#E11D48', '#64748B'] }
  ];
  A.brandKit = () => {
    const b = D.clone(D.brand());
    const prev = h('div', { class: 'brand-preview' });
    const draw = () => {
      prev.innerHTML = '';
      prev.append(
        h('div', { class: 'bp-band', style: { background: b.dark } }, b.logo ? h('img', { src: b.logo }) : h('span', { style: { fontFamily: b.font } }, 'Your title'), h('span', { class: 'bp-bar', style: { background: b.primary } })),
        h('div', { class: 'bp-body', style: { fontFamily: `'${b.font}', 'Inter Variable', sans-serif` } },
          h('div', { class: 'bp-h', style: { color: b.dark } }, 'Heading in brand font'),
          h('div', { class: 'bp-bars' }, b.palette.slice(0, 6).map((c, i) => h('span', { style: { background: c, height: [60, 82, 48, 70, 38, 90][i] + '%' } }))),
          h('div', { class: 'bp-kpi', style: { borderColor: b.primary } }, h('small', null, 'KPI'), h('b', null, '1,240'))));
    };
    const field = (label, ctl) => h('div', { class: 'field' }, h('label', null, label), ctl);
    const colorsRow = h('div', { class: 'row3' });
    const palRow = h('div', { class: 'swatch-row' });
    const drawColors = () => {
      colorsRow.innerHTML = '';
      ['primary', 'accent', 'dark'].forEach((k) => colorsRow.append(field(k[0].toUpperCase() + k.slice(1), D.colorInput(b[k], (v) => { b[k] = v; if (k === 'primary') b.palette[0] = v; if (k === 'accent') b.palette[1] = v; drawPal(); draw(); }))));
    };
    const drawPal = () => { palRow.innerHTML = ''; b.palette.forEach((c, i) => palRow.append(D.colorInput(c, (v) => { b.palette[i] = v; draw(); }))); };
    const fonts = ['Inter', 'Calibri', 'Arial', 'Segoe UI', 'Helvetica', 'Georgia', 'Verdana', 'Trebuchet MS', 'Times New Roman'];
    const fontSel = h('select', { class: 'input' }, fonts.map((f) => h('option', { value: f, selected: f === b.font ? true : null }, f)));
    fontSel.addEventListener('change', () => { b.font = fontSel.value; draw(); });
    const docFontSel = h('select', { class: 'input' }, fonts.map((f) => h('option', { value: f, selected: f === b.docFont ? true : null }, f)));
    docFontSel.addEventListener('change', () => { b.docFont = docFontSel.value; });
    const logoBox = h('div', { class: 'logo-box' });
    const drawLogo = () => { logoBox.innerHTML = ''; logoBox.append(b.logo ? h('img', { src: b.logo }) : h('span', { class: 'muted small' }, 'No logo'), h('button', { class: 'btn sm', onclick: async () => { const src = await D.native.pickImage(); if (src) { b.logo = src; drawLogo(); draw(); } } }, b.logo ? 'Replace' : 'Upload'), b.logo ? h('button', { class: 'btn sm ghost', onclick: () => { b.logo = null; drawLogo(); draw(); } }, 'Remove') : null); };
    drawColors(); drawPal(); drawLogo(); draw();
    const body = h('div', { class: 'brand-kit' },
      h('div', { class: 'bk-left' },
        h('div', { class: 'presets' }, PRESETS.map((p) => h('button', { class: 'preset', title: p.name, onclick: () => { Object.assign(b, D.clone({ primary: p.primary, accent: p.accent, dark: p.dark, palette: p.palette })); drawColors(); drawPal(); draw(); } }, h('span', { style: { background: p.primary } }), h('span', { style: { background: p.accent } }), h('span', { style: { background: p.dark } }), h('em', null, p.name)))),
        colorsRow,
        field('Chart palette', palRow),
        h('div', { class: 'row2' }, field('Slides & reports font', fontSel), field('Document font', docFontSel)),
        field('Logo', logoBox),
        h('p', { class: 'muted small' }, 'Inter is exported as Calibri in PowerPoint so decks look right on any machine. Use “Apply brand” on a Slide Sheet to restyle existing slides.')),
      prev);
    D.modal({ title: 'Brand kit', body, width: 780, actions: [
      { label: 'Cancel' },
      { label: 'Save brand', primary: true, onClick: () => { D.project().brand = b; D.commit(); A.activate(D.project().activeId, true); D.toast('Brand updated', 'ok'); } }
    ] });
  };

  // ------------------------------------------------ command palette
  A.palette = () => {
    if (document.querySelector('.palette')) return;
    const p = D.project();
    const items = [];
    const add = (label, icon, run, hint = '', group = 'Commands') => items.push({ label, icon, run, hint, group });
    if (p) {
      p.sheets.forEach((s) => {
        add(s.name, D.TYPE_META[s.type].icon, () => A.activate(s.id), D.TYPE_META[s.type].label, 'Sheets');
        const T = D.sheetTypes[s.type];
        if (T.outline) T.outline(s).forEach((o) => add(o.label, s.type === 'slide' ? 'slide' : 'heading', o.go, s.name, 'Inside sheets'));
      });
      ['data', 'slide', 'docu', 'report', 'dash'].forEach((t) => add(`New ${D.TYPE_META[t].label}`, D.TYPE_META[t].icon, () => A.addSheet(t), D.TYPE_META[t].ext));
      add('Save project', 'save', () => D.io.save(), 'Ctrl+S');
      add('Save as new folder…', 'save', () => D.io.save(true), 'Ctrl+Shift+S');
      add('Export whole project as one PDF', 'pdf', () => D.io.exportAllPdf());
      const a = D.active();
      if (a) add(`Export ${a.name}`, 'download', () => D.io.exportSheet(a));
      add('Brand kit', 'palette', () => A.brandKit());
      add('Insert live value (copy to clipboard)', 'zap', () => D.links.pickToken((tok) => { navigator.clipboard.writeText(tok); D.toast(`Copied ${tok} - paste it into any text`, 'ok'); }));
      D.dataSheets().filter((s) => !s.calcOf).forEach((s) => add(`Build dashboard from ${s.name}`, 'grid', () => D.sheetTypes.dash.createFor([s.id])));
      D.dataSheets().filter((s) => !s.calcOf).forEach((s) => add(`Find duplicates in ${s.name}`, 'copy', () => { D.app.activate(s.id, true); D.dupes.open(s); }));
      D.dataSheets().forEach((s) => add(`Build report from ${s.name}`, 'sparkles', () => D.sheetTypes.report.quickDashboard(s, D.links.autoRange(s))));
      p.sheets.filter((s) => s.type === 'docu').forEach((s) => add(`Turn ${s.name} into a deck`, 'wand', () => D.sheetTypes.docu.toDeck(s)));
      p.sheets.filter((s) => s.type === 'slide').forEach((s) => add(`Present ${s.name}`, 'play', () => D.sheetTypes.slide.present(s, 0), 'F5'));
      if (p.dir) add('Show project folder', 'folder', () => D.native.reveal(p.dir));
      add('Close project', 'x', () => D.io.closeProject());
    }
    add('Open project folder…', 'folderOpen', () => D.io.openFolder(), 'Ctrl+O');
    add('Open files as sheets…', 'fileUp', () => D.io.openFiles(), 'Ctrl+Shift+O');
    add('Ask Datum (assistant)', 'sparkles', () => D.ai.open(), 'Ctrl+J');
    add('Ask Datum settings - offline model', 'sparkles', () => D.ai.settings());
    add('New data set (combine files)…', 'layers', () => D.dataset.start());
    if (p) p.sheets.filter((s) => s.dataset).forEach((s) => add(`Refresh data set ${s.name}`, 'refresh', () => D.dataset.refresh(s)));
    D.templates.list.forEach((t) => add(`New project: ${t.name}`, 'plus', async () => { await D.io.newProject(t.id); if (D.project()) D.templates.after(D.project()); }, '', 'New project'));
    add('Keyboard shortcuts', 'command', () => A.shortcuts());

    const input = h('input', { class: 'pal-input', placeholder: 'Jump to a sheet, slide or heading - or run a command…' });
    const list = h('div', { class: 'pal-list' });
    const back = h('div', { class: 'palette-back' });
    const box = h('div', { class: 'palette' }, h('div', { class: 'pal-head', html: D.icon('search', 16) }, input), list);
    back.append(box);
    document.body.append(back);
    let sel = 0, shown = [];
    const score = (q, s) => {
      if (!q) return 1;
      s = s.toLowerCase(); q = q.toLowerCase();
      const i = s.indexOf(q);
      if (i >= 0) return 100 - i;
      let j = 0, sc = 0;
      for (const ch of s) { if (ch === q[j]) { j++; sc++; } }
      return j === q.length ? sc : 0;
    };
    const draw = () => {
      const q = input.value.trim();
      shown = items.map((it) => ({ it, s: score(q, it.label + ' ' + it.hint) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 40).map((x) => x.it);
      if (!q) shown.sort((a, b) => ['Sheets', 'Commands', 'Inside sheets', 'New project'].indexOf(a.group) - ['Sheets', 'Commands', 'Inside sheets', 'New project'].indexOf(b.group));
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.innerHTML = '';
      let g = null;
      shown.forEach((it, i) => {
        if (!q && it.group !== g) { g = it.group; list.append(h('div', { class: 'pal-group' }, g)); }
        const row = h('div', { class: `pal-item ${i === sel ? 'on' : ''}`, onmousemove: () => { if (sel !== i) { sel = i; draw(); } }, onclick: () => run(it) }, h('span', { html: D.icon(it.icon, 15) }), h('span', { class: 'pal-label' }, it.label), h('span', { class: 'pal-hint' }, it.hint));
        list.append(row);
      });
      if (!shown.length) list.append(h('div', { class: 'pal-empty' }, 'No matches'));
      const on = list.querySelector('.pal-item.on'); on && on.scrollIntoView({ block: 'nearest' });
    };
    const close = () => back.remove();
    const run = (it) => { close(); setTimeout(() => it.run(), 0); };
    input.addEventListener('input', () => { sel = 0; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); shown[sel] && run(shown[sel]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      e.stopPropagation();
    });
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    draw();
    input.focus();
  };

  A.shortcuts = () => {
    const rows = [
      ['Ctrl K', 'Command palette'], ['Ctrl J', 'Ask Datum'], ['Ctrl S', 'Save project folder'], ['Ctrl Shift S', 'Save as new folder'], ['Ctrl O', 'Open project folder'], ['Ctrl Shift O', 'Open files as sheets'],
      ['Ctrl T', 'New sheet'], ['Ctrl Tab', 'Next sheet'], ['Ctrl 1-9', 'Jump to sheet'], ['Ctrl Z / Ctrl Y', 'Undo / redo'], ['F5', 'Present the current deck'],
      ['Data: type =', 'Start a formula - click cells to insert references'], ['Data: Alt =', 'AutoSum'], ['Data: Ctrl D', 'Fill down'], ['Data: Ctrl Arrow', 'Jump to edge of data'],
      ['Canvas: Ctrl D', 'Duplicate'], ['Canvas: Ctrl [ ]', 'Send back / bring forward'], ['Canvas: Shift drag', 'Constrain'], ['Canvas: Alt drag', 'Move without snapping'],
      ['Docu: paste cells', 'Paste a copied data range as a linked table or chart']
    ];
    D.modal({ title: 'Keyboard shortcuts', width: 560, body: h('div', { class: 'shortcuts' }, rows.map(([k, l]) => h('div', { class: 'sc-row' }, h('kbd', null, k), h('span', null, l)))) });
  };

  // ------------------------------------------------ global keys + drop
  function onKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const inField = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
    if (document.querySelector('.modal-back, .presenter')) return;
    if (mod && k === 'k') { e.preventDefault(); A.palette(); return; }
    if (mod && k === 's') { e.preventDefault(); D.io.save(e.shiftKey); return; }
    if (mod && k === 'o') { e.preventDefault(); e.shiftKey ? D.io.openFiles() : D.io.openFolder(); return; }
    if (!D.project()) return;
    if (mod && k === 't') { e.preventDefault(); A.newSheetMenu(document.querySelector('.tab-add')); return; }
    if (mod && e.key === 'Tab') { e.preventDefault(); const p = D.project(); const i = p.sheets.findIndex((s) => s.id === p.activeId); A.activate(p.sheets[(i + (e.shiftKey ? -1 : 1) + p.sheets.length) % p.sheets.length].id); return; }
    if (mod && /^[1-9]$/.test(e.key)) { const s = D.project().sheets[+e.key - 1]; if (s) { e.preventDefault(); A.activate(s.id); } return; }
    if (e.key === 'F5') { e.preventDefault(); const a = D.active(); const deck = a && a.type === 'slide' ? a : D.project().sheets.find((s) => s.type === 'slide'); if (deck) D.sheetTypes.slide.present(deck, a === deck ? deck.current || 0 : 0); return; }
    if (inField) return;
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); D.undo(); return; }
    if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); D.redo(); return; }
  }

  function setupDrop() {
    const ov = $('drop-overlay');
    let depth = 0;
    window.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { depth++; ov.classList.add('on'); } });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) ov.classList.remove('on'); });
    window.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    window.addEventListener('drop', async (e) => {
      depth = 0; ov.classList.remove('on');
      if (e.defaultPrevented || !e.dataTransfer.files.length) return;
      e.preventDefault();
      const files = [...e.dataTransfer.files];
      const paths = files.map((f) => D.native.pathForFile(f)).filter(Boolean);
      // a single folder (no type, no extension) opens as a project
      if (files.length === 1 && !files[0].type && !/\.[a-z0-9]{2,5}$/i.test(files[0].name)) return D.io.openFolder(paths[0]);
      D.io.importPaths(paths);
    });
    // FreeCanvas / docu handle their own drops first
    ['dragover', 'drop'].forEach((ev) => document.addEventListener(ev, () => ov.classList.remove('on'), true));
  }

  // ------------------------------------------------ boot
  A.init = async () => {
    D.native = window.native;
    document.body.classList.add(`os-${D.native.platform}`);
    document.addEventListener('keydown', onKey);
    setupDrop();
    D.on('dirty', () => A.renderTop());
    D.on('changed', () => { if (D.state.dirty && !document.title.endsWith('• - Datum')) A.renderTop(); });
    D.native.onBeforeClose(async () => {
      if (await D.io.guardUnsaved()) { await D.native.recoveryWrite(null); D.native.closeConfirmed(); }
    });
    A.renderAll();
    D.io.startRecovery();
    D.io.checkRecovery();
  };
  window.addEventListener('DOMContentLoaded', () => A.init());
  // anything that goes wrong without being handled shows up as a short message instead of failing silently
  D.errText = (err) => String((err && (err.message || err.reason)) || err || 'Unknown error').replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace(/^Error: /, '');
  let lastErr = 0;
  const report = (err) => {
    const msg = D.errText(err);
    if (/ResizeObserver loop|Script error\.?$|AbortError/i.test(msg)) return;
    console.error(err);
    if (Date.now() - lastErr < 4000) return;
    lastErr = Date.now();
    try { D.toast(`Something didn't work: ${msg.slice(0, 160)}. Your work is safe; try again or undo.`, 'err', 7000); } catch { /* toasts not ready */ }
  };
  window.addEventListener('error', (e) => report(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => report(e.reason));
})();
