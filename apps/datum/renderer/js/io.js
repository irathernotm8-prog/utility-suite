// Datum - project I/O, import/export, printing, recovery
(function () {
  const h = D.h;
  const IO = (D.io = {});
  const N = () => window.native;

  // ---------- hashing (detect untouched imported sheets)
  const normHtml = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; return d.innerHTML; };
  const strip = (s) => {
    const o = { ...s };
    delete o.source; delete o.current; delete o.view; delete o._jump;
    if (o.type === 'data') {
      // empty padding rows/cols added by the grid are not content
      const t = D.f.trimRows(o.cells.map((r) => r.slice()));
      o.cells = t;
      o.frozen = o.frozen || 0;
    }
    if (o.type === 'docu') o.html = normHtml(o.html);
    return o;
  };
  IO.hash = (sheet) => { const s = JSON.stringify(strip(sheet)); let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36) + ':' + s.length; };

  // ---------- project lifecycle
  IO.blankProject = (name = 'Untitled project') => ({ id: D.uid(), name, dir: null, brand: D.clone(D.DEFAULT_BRAND), sheets: [], activeId: null, createdAt: Date.now() });

  IO.load = (project, { dirty = false } = {}) => {
    project.brand = { ...D.clone(D.DEFAULT_BRAND), ...(project.brand || {}) };
    if (!project.activeId || !project.sheets.find((s) => s.id === project.activeId)) project.activeId = project.sheets[0] && project.sheets[0].id;
    D.state.project = project;
    D.state.dirty = dirty;
    D.dataVersion++;
    D.resetHistory();
    D.app.renderAll();
    D.emit('dirty');
  };

  IO.guardUnsaved = async () => {
    if (!D.state.project || !D.state.dirty) return true;
    const r = await D.choose('Save changes?', `“${D.project().name}” has unsaved changes.`, [
      { label: 'Cancel', value: 'cancel' },
      { label: "Don't save", value: 'discard', danger: true },
      { label: 'Save', value: 'save', primary: true }
    ]);
    if (r === 'save') return IO.save();
    return r === 'discard';
  };

  IO.newProject = async (templateId = 'blank') => {
    if (!(await IO.guardUnsaved())) return;
    const p = D.templates.build(templateId);
    IO.load(p, { dirty: templateId !== 'blank' });
    N().recoveryWrite(null);
  };

  IO.closeProject = async () => {
    if (!(await IO.guardUnsaved())) return;
    D.state.project = null; D.state.dirty = false;
    N().recoveryWrite(null);
    D.app.renderAll();
  };

  // ---------- open
  IO.openFolder = async (dir) => {
    if (!dir) dir = await N().openFolder();
    if (!dir) return;
    if (!(await IO.guardUnsaved())) return;
    D.app.busy('Opening folder…');
    try {
      const r = await N().openProjectFolder(dir);
      if (r.project) {
        r.project.dir = r.dir;
        const extra = await IO.prepareImported(r.extra || []);
        IO.mergeNames(r.project, extra);
        IO.load(r.project);
        if (extra.length) { D.project().sheets.push(...extra); D.markDirty(); D.app.renderTabs(); D.toast(`Added ${extra.length} new file${extra.length > 1 ? 's' : ''} found in the folder`, 'info'); }
        if (r.updates && r.updates.length) { D.markDirty(); D.toast(`Picked up Excel edits made outside Datum: ${r.updates.join(', ')}`, 'ok', 5000); }
        else D.toast(`Opened ${r.project.name}`, 'ok');
        if (r.notes && r.notes.length) D.toast(r.notes.join(' · '), 'warn', 9000);
      } else {
        if (!r.sheets.length) { D.toast('No supported files in that folder (xlsx, csv, pptx, docx, pdf, txt, md, images)', 'warn', 5000); return; }
        const p = IO.blankProject(r.name);
        p.dir = r.dir;
        p.fromFolder = true;
        p.sheets = await IO.prepareImported(r.sheets);
        IO.mergeNames(p, p.sheets);
        IO.load(p);
        D.toast(`Opened ${p.sheets.length} file${p.sheets.length > 1 ? 's' : ''} as sheets${r.skipped.length ? ` · skipped ${r.skipped.length}` : ''}`, 'ok', 4000);
        if (r.notes && r.notes.length) D.toast(r.notes.join(' · '), 'warn', 9000);
      }
    } catch (err) {
      console.error(err);
      D.toast(`Couldn't open folder: ${err.message}`, 'err', 6000);
    } finally { D.app.busy(false); }
  };

  // normalise sheets coming back from the main-process importer
  IO.prepareImported = async (list) => {
    const out = [];
    const images = [];
    const names = {};
    for (const s of list) {
      if (s.type === 'image') { images.push(s); continue; }
      if (s.names) { Object.assign(names, s.names); delete s.names; }
      if (D.project() || out.length) s.name = IO.uniqueAmong(s.name, [...(D.project()?.sheets || []), ...out]);
      if (s.type === 'slide') s.current = 0;
      const src = s.sourcePath;
      delete s.sourcePath;
      if (src) s.source = { path: src, hash: IO.hash(s) };
      out.push(s);
    }
    if (images.length) {
      const rep = D.sheetTypes.report.create(IO.uniqueAmong('Images', [...(D.project()?.sheets || []), ...out]));
      for (const im of images) {
        const img = await D.loadImage(im.src).catch(() => null);
        const w = 300, hh = img ? Math.round(300 * img.naturalHeight / img.naturalWidth) : 200;
        const e = D.newElement('image', { src: im.src, w, h: hh });
        const n = rep.elements.length;
        e.x = 40 + (n % 3) * 330; e.y = 40 + Math.floor(n / 3) * (hh + 20);
        rep.elements.push(e);
      }
      rep.pages = Math.max(1, Math.ceil((Math.max(...rep.elements.map((e) => e.y + e.h)) + 40) / 816));
      out.push(rep);
    }
    Object.defineProperty(out, 'names', { value: names, enumerable: false });
    return out;
  };
  IO.mergeNames = (p, list) => { if (list && list.names && Object.keys(list.names).length) p.names = { ...(p.names || {}), ...list.names }; };
  IO.uniqueAmong = (base, sheets) => {
    const names = new Set(sheets.map((s) => s.name.toLowerCase()));
    let n = base, i = 2;
    while (names.has(n.toLowerCase())) n = `${base} ${i++}`;
    return n;
  };

  IO.openFiles = async () => {
    const paths = await N().openFiles();
    if (paths.length) IO.importPaths(paths);
  };
  IO.importPaths = async (paths) => {
    D.app.busy(`Importing ${paths.length} file${paths.length > 1 ? 's' : ''}…`);
    const sheets = [];
    const errors = [];
    for (const p of paths) {
      try { sheets.push(...(await N().importFile(p))); } catch (err) { errors.push(`${p.split(/[\\/]/).pop()}: ${err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`); }
    }
    D.app.busy(false);
    errors.forEach((e) => D.toast(e, 'err', 6000));
    if (!sheets.length) return;
    // image-only drop onto an open canvas sheet goes straight in
    const a = D.active();
    if (sheets.every((s) => s.type === 'image') && a && (a.type === 'slide' || a.type === 'report')) {
      for (const im of sheets) {
        const img = await D.loadImage(im.src);
        const w = Math.min(img.naturalWidth, 480), hh = Math.round(w * img.naturalHeight / img.naturalWidth);
        const e = D.newElement('image', { src: im.src, w, h: hh });
        if (a.type === 'slide') { e.x = Math.round((960 - w) / 2); e.y = Math.round((540 - hh) / 2); a.slides[a.current || 0].elements.push(e); }
        else D.sheetTypes.report.addElement(a, e);
      }
      D.commit({ data: false });
      D.app.activate(a.id, true);
      return;
    }
    if (!D.project()) {
      const p = IO.blankProject(sheets.length === 1 ? sheets[0].name : 'Untitled project');
      p.sheets = await IO.prepareImported(sheets);
      IO.mergeNames(p, p.sheets);
      IO.load(p, { dirty: true });
    } else {
      const add = await IO.prepareImported(sheets);
      IO.mergeNames(D.project(), add);
      D.project().sheets.push(...add);
      D.commit();
      D.app.activate(add[0].id);
    }
    D.toast(`Opened ${sheets.length} sheet${sheets.length > 1 ? 's' : ''}`, 'ok');
  };

  // ---------- printing
  let elementsCss = null;
  IO.elementsCss = async () => elementsCss || (elementsCss = await (await fetch('app://datum/renderer/css/elements.css')).text());
  const FONT_LINK = '<link rel="stylesheet" href="app://datum/node_modules/@fontsource-variable/inter/index.css">';

  // pages: [{w,h,html}] fixed-size pages and/or {doc: html} flowing letter-portrait sections and {grid: html}
  IO.buildPrint = async (parts, title = 'Datum') => {
    const css = await IO.elementsCss();
    const sizes = new Map();
    let body = '';
    for (const p of parts) {
      if (p.doc != null) { body += `<section class="pp-doc">${p.doc}</section>`; continue; }
      if (p.grid != null) { body += `<section class="pp-grid"><h2>${D.esc(p.title || '')}</h2>${p.grid}</section>`; continue; }
      const key = `p${Math.round(p.w)}x${Math.round(p.h)}`;
      sizes.set(key, p);
      body += `<section class="pp-fixed ${key}">${p.html}</section>`;
    }
    let pageCss = '@page doc { size: 8.5in 11in; margin: 1in; } @page grid { size: 11in 8.5in; margin: 0.5in; }';
    for (const [key, p] of sizes) pageCss += `@page ${key} { size: ${p.w / 96}in ${p.h / 96}in; margin: 0; } .${key} { page: ${key}; width: ${p.w}px; height: ${p.h}px; }`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>${D.esc(title)}</title>${FONT_LINK}<style>${css}
      html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      ${pageCss}
      section{break-after:page;overflow:hidden;position:relative}
      section:last-child{break-after:auto}
      .pp-doc{page:doc;overflow:visible} .pp-grid{page:grid;overflow:visible}
      .pp-grid h2{font:600 14px 'Inter Variable',sans-serif;margin:0 0 8px;color:#0B1530}
      .page-static{transform:none!important}
    </style></head><body>${body}</body></html>`;
  };
  IO.printPartsFor = async (sheet) => {
    const T = D.sheetTypes[sheet.type];
    if (sheet.type === 'slide' || sheet.type === 'report' || sheet.type === 'dash') return T.printPages(sheet);
    if (sheet.type === 'docu') { await T.ensureHtml(sheet); return [{ doc: `<div class="doc-print">${T.printBody(sheet)}</div>` }]; }
    if (sheet.type === 'data') return [{ grid: T.printHtml(sheet), title: sheet.name }];
    return [];
  };

  IO.pageToPng = async (model) => {
    const html = await IO.buildPrint([{ w: model.w, h: model.h, html: D.renderPage(model, { lazyCharts: true }).outerHTML }]);
    return N().renderPng ? N().renderPng(html, model.w, model.h) : null;
  };

  // ---------- save
  IO.flush = () => { D.app.flushActive(); if (D._commitT) D.commit(); };

  IO.buildExports = async () => {
    const p = D.project();
    const exports = {};
    const srcCount = {};
    p.sheets.forEach((s) => { if (s.source) srcCount[s.source.path] = (srcCount[s.source.path] || 0) + 1; });
    for (const s of p.sheets) {
      const T = D.sheetTypes[s.type];
      if (s.source && srcCount[s.source.path] === 1 && IO.hash(s) === s.source.hash) { exports[s.id] = { keepOriginal: s.source.path }; continue; }
      const ex = T.exportPayload(s);
      if (s.type === 'report' || s.type === 'dash' || (s.type === 'docu' && s.format === 'pdf' && (s.edited || !s.pdfOriginal))) ex.printHtml = await IO.buildPrint(await IO.printPartsFor(s), s.name);
      exports[s.id] = ex;
    }
    return exports;
  };

  IO.save = async (saveAs = false) => {
    const p = D.project();
    if (!p) return false;
    IO.flush();
    let parentDir = null;
    let folder = saveAs ? null : p.dir;
    if (folder && p.fromFolder && !p.confirmedFolderSave) {
      const c = await D.choose('Save into this folder?', `“${p.name}” was opened from an existing folder. Saving writes Datum's versions of any sheets you changed back into that folder, replacing those files. Untouched files are left exactly as they were.`, [
        { label: 'Cancel', value: null },
        { label: 'Save as new folder…', value: 'new' },
        { label: 'Save into folder', value: 'here', primary: true }
      ]);
      if (!c) return false;
      if (c === 'new') folder = null; else p.confirmedFolderSave = true;
    }
    if (!folder) {
      if (saveAs || !p.dir) {
        const nm = await D.prompt('Project name', p.name === 'Untitled project' ? '' : p.name, 'e.g. Q3 Marketing Review');
        if (!nm) return false;
        if (nm !== p.name) { p.name = nm; D.app.renderTop(); }
      }
      parentDir = await N().pickSaveParent(p.name);
      if (!parentDir) return false;
    }
    D.app.busy('Saving project…');
    try {
      const exports = await IO.buildExports();
      const project = D.clone(p);
      delete project.dir;
      const r = await N().saveProject({ project, parentDir, folder, exports });
      if (!r.ok) { D.toast(r.error, 'err', 7000); return false; }
      p.dir = r.dir;
      p.fromFolder = false;
      // after saving, every sheet's file now matches its state
      const failed = new Set((r.failed || []).map((x) => x.id));
      p.sheets.forEach((s) => { if (failed.has(s.id)) return; const f = r.fileMap && r.fileMap[s.id]; if (f) s.source = { path: r.dir.replace(/[\\/]$/, '') + (r.dir.includes('\\') ? '\\' : '/') + f, hash: null }; });
      p.sheets.forEach((s) => { if (s.source && !failed.has(s.id)) s.source.hash = IO.hash(s); });
      if (failed.size) {
        // the rest is saved; these sheets keep their last saved file and stay unsaved
        D.toast(`Saved, except ${r.failed.map((x) => x.msg).join(' · ')}`, 'warn', 9000);
        D.emit('dirty');
        D.app.flashSaved(r);
        return false;
      }
      D.state.dirty = false;
      D.emit('dirty');
      N().recoveryWrite(null);
      const t = D.toast(`Saved ${r.files.length} file${r.files.length > 1 ? 's' : ''} to ${r.dir.split(/[\\/]/).pop()}`, 'ok', 4500);
      D.app.flashSaved(r);
      return true;
    } catch (err) {
      console.error(err);
      D.toast(`Save failed: ${err.message}`, 'err', 7000);
      return false;
    } finally { D.app.busy(false); }
  };

  // ---------- export single sheet / everything
  IO.exportSheet = async (sheet, fmt) => {
    IO.flush();
    const T = D.sheetTypes[sheet.type];
    fmt = fmt || D.TYPE_META[sheet.type].ext;
    if (sheet.type === 'docu' && !fmt) fmt = sheet.format === 'pdf' ? 'pdf' : 'docx';
    const fp = await N().saveFileDialog(`${sheet.name}.${fmt}`, fmt);
    if (!fp) return;
    D.app.busy('Exporting…');
    try {
      if (fmt === 'pdf') await N().exportPdf(await IO.buildPrint(await IO.printPartsFor(sheet), sheet.name), fp);
      else { if (sheet.type === 'docu') await T.ensureHtml(sheet); await N().exportSheet({ sheet: D.clone(sheet), ex: T.exportPayload(sheet), brand: D.brand(), filePath: fp }); }
      D.toast(`Exported ${fp.split(/[\\/]/).pop()}`, 'ok');
      N().reveal(fp);
    } catch (err) { console.error(err); D.toast(`Export failed: ${err.message}`, 'err', 6000); }
    finally { D.app.busy(false); }
  };

  IO.exportAllPdf = async () => {
    const p = D.project();
    if (!p) return;
    IO.flush();
    const order = await pickSheetsForBundle();
    if (!order) return;
    const fp = await N().saveFileDialog(`${p.name}.pdf`, 'pdf');
    if (!fp) return;
    D.app.busy('Building PDF…');
    try {
      const parts = [];
      for (const s of order) parts.push(...(await IO.printPartsFor(s)));
      await N().exportPdf(await IO.buildPrint(parts, p.name), fp);
      D.toast(`Exported ${order.length} sheet${order.length > 1 ? 's' : ''} into one PDF`, 'ok');
      N().reveal(fp);
    } catch (err) { console.error(err); D.toast(`Export failed: ${err.message}`, 'err', 6000); }
    finally { D.app.busy(false); }
  };
  function pickSheetsForBundle() {
    return new Promise((res) => {
      const p = D.project();
      const checks = p.sheets.map((s) => ({ s, on: s.type !== 'data' }));
      let done = false;
      const list = h('div', { class: 'bundle-list' }, checks.map((c) => {
        const cb = h('input', { type: 'checkbox' }); cb.checked = c.on;
        cb.addEventListener('change', () => { c.on = cb.checked; });
        return h('label', { class: 'bundle-row' }, cb, h('span', { class: 'type-dot', style: { background: D.TYPE_META[c.s.type].color } }), h('span', null, c.s.name), h('span', { class: 'muted small' }, D.TYPE_META[c.s.type].short));
      }));
      D.modal({ title: 'Export project as one PDF', width: 460, onClose: () => { if (!done) res(null); }, body: h('div', null, h('p', { class: 'muted small' }, 'Sheets are combined in tab order. Slides and reports keep their page size; documents print on Letter.'), list), actions: [
        { label: 'Cancel' }, { label: 'Export PDF', primary: true, onClick: () => { done = true; res(checks.filter((c) => c.on).map((c) => c.s)); } }
      ] });
    });
  }

  // ---------- recovery
  IO.startRecovery = () => {
    setInterval(() => {
      if (D.state.project && D.state.dirty) {
        try { N().recoveryWrite(JSON.stringify({ at: Date.now(), project: D.state.project })); } catch (e) { console.error(e); }
      }
    }, 30000);
  };
  IO.checkRecovery = async () => {
    const raw = await N().recoveryRead();
    if (!raw) return;
    let data; try { data = JSON.parse(raw); } catch { return; }
    if (!data || !data.project) return;
    const ok = await D.confirm('Recover unsaved work?', `Datum found unsaved changes to “${data.project.name}” from ${D.fmtTime(data.at)}.`, 'Recover');
    if (ok) IO.load(data.project, { dirty: true });
    else N().recoveryWrite(null);
  };
})();
