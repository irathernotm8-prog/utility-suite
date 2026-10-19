// Datum - Docu Sheet (Word / PDF)
(function () {
  const h = D.h;
  const PAGE_W = 816;

  const ALLOWED = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'BR', 'IMG', 'A', 'BLOCKQUOTE', 'SPAN', 'DIV', 'FIGURE', 'FIGCAPTION', 'HR']);
  function sanitize(html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const walk = (node) => {
      [...node.childNodes].forEach((ch) => {
        if (ch.nodeType === 8) return ch.remove();
        if (ch.nodeType !== 1) return;
        if (['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'XML'].includes(ch.tagName) || ch.tagName.includes(':')) return ch.remove();
        walk(ch);
        if (!ALLOWED.has(ch.tagName)) { ch.replaceWith(...ch.childNodes); return; }
        const keep = {};
        if (ch.tagName === 'IMG') keep.src = ch.getAttribute('src');
        if (ch.tagName === 'A') keep.href = ch.getAttribute('href');
        const align = ch.style && ch.style.textAlign;
        const isLive = ch.classList.contains('dlive') || ch.classList.contains('dtoken') || ch.classList.contains('pagebreak');
        if (isLive) return;
        [...ch.attributes].forEach((a) => ch.removeAttribute(a.name));
        Object.entries(keep).forEach(([k, v]) => v && ch.setAttribute(k, v));
        if (align && /^(center|right|justify)$/.test(align)) ch.style.textAlign = align;
        if (ch.tagName === 'SPAN' && !ch.attributes.length) ch.replaceWith(...ch.childNodes);
      });
    };
    walk(doc.body);
    return doc.body.innerHTML;
  }
  const escAttr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');

  // ------------------------------------------------ live blocks
  function figureHtml(spec) {
    const kind = spec.kind === 'table' ? 'table' : 'chart';
    return `<figure class="dlive" contenteditable="false" data-kind="${kind}" data-sheet="${spec.link.sheetId}" data-range="${spec.link.range}" data-chart="${spec.chartType || 'bar'}" data-title="${escAttr(spec.title || '')}"></figure><p><br></p>`;
  }
  function tokenHtml(expr) {
    return `<span class="dtoken" contenteditable="false" data-expr="${escAttr(expr.replace(/^=/, ''))}">${D.esc(D.f.displayExpr(expr))}</span>&nbsp;`;
  }
  function refreshLive(root) {
    root.querySelectorAll('figure.dlive').forEach((f) => {
      const link = { sheetId: f.dataset.sheet, range: f.dataset.range };
      const ok = !!D.sheet(link.sheetId);
      const cap = f.dataset.title ? `<figcaption>${D.esc(f.dataset.title)}</figcaption>` : '';
      if (!ok) { f.innerHTML = `<div class="dlive-missing">Linked data sheet was removed</div>`; return; }
      if (f.dataset.kind === 'table') {
        const rows = D.f.trimRows(D.f.linkRows(link)) || [];
        f.innerHTML = `<table class="dt">${rows.map((r, i) => `<tr>${r.map((v) => (i === 0 ? `<th>${D.esc(v)}</th>` : `<td>${D.esc(v)}</td>`)).join('')}</tr>`).join('')}</table>${cap}`;
      } else {
        const png = D.charts.toPng({ chartType: f.dataset.chart, link, title: '' }, 620, 320, 1);
        f.innerHTML = (png ? `<img src="${png}" width="620">` : '<div class="dlive-missing">No numeric data in range</div>') + cap;
      }
    });
    root.querySelectorAll('span.dtoken').forEach((s) => { s.textContent = D.f.displayExpr(s.dataset.expr); });
  }
  function exportHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    refreshLive(div);
    div.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
    div.querySelectorAll('.dlive-tools').forEach((n) => n.remove());
    return div.innerHTML;
  }

  // ------------------------------------------------ pdf helpers
  let pdfReady = null;
  const pdfjs = () => (pdfReady ||= import('app://datum/node_modules/pdfjs-dist/build/pdf.min.mjs').then((m) => { m.GlobalWorkerOptions.workerSrc = 'app://datum/node_modules/pdfjs-dist/build/pdf.worker.min.mjs'; return m; }));
  const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  async function pdfDoc(sheet) {
    if (sheet._pdf && sheet._pdfKey === sheet.pdfOriginal.length) return sheet._pdf;
    const lib = await pdfjs();
    Object.defineProperty(sheet, '_pdf', { value: await lib.getDocument({ data: b64ToBytes(sheet.pdfOriginal), isEvalSupported: false }).promise, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(sheet, '_pdfKey', { value: sheet.pdfOriginal.length, writable: true, configurable: true, enumerable: false });
    return sheet._pdf;
  }
  async function pdfPageToPng(sheet, n, scale = 2) {
    const doc = await pdfDoc(sheet);
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = vp.width; cv.height = vp.height;
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    return { url: cv.toDataURL('image/png'), w: vp.width / scale, h: vp.height / scale };
  }
  async function pdfToHtml(sheet) {
    const doc = await pdfDoc(sheet);
    let html = '';
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      const items = tc.items.filter((i) => i.str !== undefined);
      if (!items.filter((i) => i.str.trim()).length) {
        const img = await pdfPageToPng(sheet, n, 1.5);
        html += `<p><img src="${img.url}" width="620"></p>`;
        if (n < doc.numPages) html += '<div class="pagebreak" contenteditable="false"></div>';
        continue;
      }
      // group into lines
      const lines = [];
      items.forEach((it) => {
        const y = Math.round(it.transform[5]);
        const size = Math.round(Math.hypot(it.transform[2], it.transform[3]));
        let L = lines.find((l) => Math.abs(l.y - y) <= Math.max(2, size * 0.3));
        if (!L) { L = { y, size, parts: [] }; lines.push(L); }
        L.size = Math.max(L.size, size);
        L.parts.push({ x: it.transform[4], s: it.str, w: it.width });
      });
      lines.sort((a, b) => b.y - a.y);
      const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
      const body = sizes[Math.floor(sizes.length / 2)] || 11;
      let para = null, prevY = null;
      const flush = () => { if (para) { html += para.tag === 'li' ? `<ul><li>${D.esc(para.text.replace(/^[•▪●◦\-–]\s*/, ''))}</li></ul>` : `<${para.tag}>${D.esc(para.text)}</${para.tag}>`; para = null; } };
      for (const L of lines) {
        L.parts.sort((a, b) => a.x - b.x);
        let text = '';
        let lastEnd = null;
        L.parts.forEach((p) => { if (lastEnd != null && p.x - lastEnd > L.size * 0.25 && !text.endsWith(' ')) text += ' '; text += p.s; lastEnd = p.x + p.w; });
        text = text.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const tag = L.size >= body * 1.6 ? 'h1' : L.size >= body * 1.25 ? 'h2' : /^[•▪●◦]\s|^[-–]\s/.test(text) ? 'li' : 'p';
        const gap = prevY == null ? 0 : prevY - L.y;
        if (para && (tag !== para.tag || tag === 'li' || gap > L.size * 1.75 || tag !== 'p')) flush();
        if (para) para.text = para.text.endsWith('-') ? para.text.slice(0, -1) + text : para.text + ' ' + text;
        else para = { tag, text };
        prevY = L.y;
      }
      flush();
      if (n < doc.numPages) html += '<div class="pagebreak" contenteditable="false"></div>';
    }
    return html.replace(/<\/ul><ul>/g, '');
  }

  const T = {
    label: 'Docu Sheet',
    create(name) { return { id: D.uid(), type: 'docu', name, format: 'docx', html: `<h1>${D.esc(name)}</h1><p></p>` }; },
    exportPayload(sheet) { const html = exportHtml(sheet.html || ''); return { html }; },
    printBody(sheet) { return exportHtml(sheet.html || ''); },
    async ensureHtml(sheet) { if (sheet.format === 'pdf' && !sheet.html && sheet.pdfOriginal) sheet.html = await pdfToHtml(sheet); },
    insertLinked(sheet, spec) {
      const add = spec.kind === 'value' || spec.kind === 'kpi'
        ? `<p><b>${D.esc(spec.label)}:</b> ${tokenHtml(spec.expr)}</p>`
        : (spec.title ? `<h3>${D.esc(spec.title)}</h3>` : '') + figureHtml(spec);
      if (D._docInsert && D._docInsert.sheet === sheet) D._docInsert.insert(add);
      else sheet.html = (sheet.html || '') + add;
      if (sheet.format === 'pdf') sheet.edited = true;
      if (sheet.view === 'pdf') sheet.view = 'edit';
      D.commit();
    },
    mount(host, sheet) { return new DocView(host, sheet); },
    outline(sheet) {
      const div = document.createElement('div'); div.innerHTML = sheet.html || '';
      return [...div.querySelectorAll('h1,h2,h3')].map((x, i) => ({ label: x.textContent.slice(0, 60), level: +x.tagName[1], go: () => { D.app.activate(sheet.id, true); setTimeout(() => { const t = document.querySelectorAll('.doc-page h1, .doc-page h2, .doc-page h3')[i]; t && t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60); } }));
    },
    pdfPageToPng, pdfDoc, sanitize, refreshLive, toDeck
  };
  D.sheetTypes.docu = T;

  // ------------------------------------------------ Doc -> Deck
  async function toDeck(sheet) {
    if (sheet.format === 'pdf' && !sheet.html && sheet.pdfOriginal) { D.toast('Extracting PDF text…', 'info', 1500); sheet.html = await pdfToHtml(sheet); }
    const div = document.createElement('div');
    div.innerHTML = sheet.html || '';
    const deck = D.app.addSheet('slide', { activate: false, name: D.uniqueSheetName(`${sheet.name} Deck`) });
    const S = D.sheetTypes.slide;
    deck.slides = [];
    let cur = null;
    const flushBody = () => { if (cur && cur.body.length) { const t = cur.slide.elements.find((e) => e.type === 'text' && e.style.bullets); if (t) t.text = cur.body.slice(0, 8).join('\n'); } };
    const blocks = [...div.children];
    const firstH1 = blocks.find((b) => b.tagName === 'H1');
    if (firstH1) {
      const next = blocks[blocks.indexOf(firstH1) + 1];
      deck.slides.push(S.newSlide('title', { title: firstH1.textContent.trim(), subtitle: next && next.tagName === 'P' ? next.textContent.trim().slice(0, 120) : new Date().toLocaleDateString() }));
    }
    for (const b of blocks) {
      if (b === firstH1) continue;
      if (/^H[1-3]$/.test(b.tagName)) {
        flushBody();
        const title = b.textContent.trim();
        if (b.tagName === 'H1') { deck.slides.push(S.newSlide('section', { title })); cur = null; continue; }
        const sl = S.newSlide('content', { title, body: '' });
        deck.slides.push(sl);
        cur = { slide: sl, body: [] };
      } else if (b.tagName === 'FIGURE' && b.classList.contains('dlive')) {
        const link = { sheetId: b.dataset.sheet, range: b.dataset.range };
        const title = b.dataset.title || (cur ? cur.slide.elements[0].text : 'Data');
        const sl = S.newSlide('chart', { title, subtitle: '' });
        const ch = sl.elements.find((e) => e.type === 'chart');
        sl.elements = sl.elements.filter((e) => e.type !== 'text' || e.style.fontSize > 20);
        if (b.dataset.kind === 'table') Object.assign(ch, { type: 'table', link, style: { fontSize: 13 } });
        else Object.assign(ch, { link, chartType: b.dataset.chart || 'bar', y: 110, h: 400 });
        flushBody();
        deck.slides.push(sl);
        cur = null;
      } else if (b.tagName === 'UL' || b.tagName === 'OL') {
        if (!cur) { const sl = S.newSlide('content', { title: 'Key points', body: '' }); deck.slides.push(sl); cur = { slide: sl, body: [] }; }
        b.querySelectorAll(':scope > li').forEach((li) => cur.body.push(li.textContent.trim()));
      } else if (b.tagName === 'P' && b.textContent.trim()) {
        if (!cur) { if (deck.slides.length && !blocks.some((x) => /^H[23]$/.test(x.tagName))) { const sl = S.newSlide('content', { title: 'Overview', body: '' }); deck.slides.push(sl); cur = { slide: sl, body: [] }; } else continue; }
        const t = b.textContent.trim();
        const tokens = [...b.querySelectorAll('span.dtoken')];
        let txt = b.innerText.trim();
        tokens.forEach((s) => { txt = txt.replace(s.textContent, `{{${s.dataset.expr}}}`); });
        const sentence = t.length > 160 ? txt.split(/(?<=[.!?])\s/)[0] : txt;
        cur.body.push(sentence);
      } else if (b.querySelector && b.querySelector('img') && !b.classList.contains('dlive')) {
        const img = b.querySelector('img');
        const sl = S.newSlide('imageText', { title: cur ? cur.slide.elements[0].text : 'Image', body: '' });
        sl.elements.find((e) => e.type === 'image').src = img.getAttribute('src');
        deck.slides.push(sl);
      }
    }
    flushBody();
    deck.slides.forEach((s) => s.elements.forEach((e) => { if (e.type === 'text' && e.style.bullets && !e.text) e.text = ' '; }));
    deck.slides = deck.slides.filter((s) => s.elements.length);
    if (!deck.slides.length) deck.slides.push(S.newSlide('title', { title: sheet.name }));
    deck.current = 0;
    D.commit();
    D.app.activate(deck.id);
    D.toast(`Built ${deck.slides.length} slide${deck.slides.length === 1 ? '' : 's'} from “${sheet.name}” - linked charts came along`, 'ok');
  }

  // ------------------------------------------------ view
  class DocView {
    constructor(host, sheet) {
      this.sheet = sheet; this.host = host;
      if (!sheet.view) sheet.view = sheet.format === 'pdf' && !sheet.edited ? 'pdf' : 'edit';
      host.innerHTML = '';
      this.toolbar = h('div', { class: 'sheet-toolbar' });
      this.body = h('div', { class: 'sheet-body two' });
      this.scroll = h('div', { class: 'doc-scroll' });
      this.side = h('div', { class: 'inspector doc-side' });
      this.body.append(this.scroll, this.side);
      host.append(this.toolbar, this.body);
      this.mountView();
      this.unsub = D.on('changed', () => { if (this.page && D.active() === sheet && document.activeElement !== this.page) { refreshLive(this.page); } });
    }
    destroy() { this.save(true); this.unsub(); if (D._docInsert && D._docInsert.sheet === this.sheet) D._docInsert = null; }
    async mountView() {
      if (this.sheet.view === 'pdf' && this.sheet.pdfOriginal) return this.mountPdf();
      this.buildToolbar();
      this.page = h('div', { class: 'doc-page', contenteditable: 'true', spellcheck: 'true' });
      this.page.innerHTML = this.sheet.html || '<p><br></p>';
      refreshLive(this.page);
      this.scroll.innerHTML = '';
      this.scroll.append(h('div', { class: 'doc-paper-wrap' }, this.page));
      this.page.addEventListener('input', () => this.onInput());
      this.page.addEventListener('keyup', () => this.saveSel());
      this.page.addEventListener('mouseup', () => this.saveSel());
      this.page.addEventListener('paste', (e) => this.onPaste(e));
      this.page.addEventListener('click', (e) => this.onClick(e));
      this.page.addEventListener('keydown', (e) => this.onKey(e));
      this.page.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
      this.page.addEventListener('drop', (e) => this.onDrop(e));
      D._docInsert = { sheet: this.sheet, insert: (html) => this.insertHtml(html) };
      this.renderSide();
      this.updateStatus();
    }
    async mountPdf() {
      const tb = this.toolbar;
      tb.innerHTML = '';
      tb.append(
        h('div', { class: 'pdf-badge', html: D.icon('pdf', 15) + '<span>PDF · original</span>' }),
        D.btn('edit', 'Convert the PDF text into an editable document', () => this.editPdf(), { label: 'Edit as document', cls: 'accent' }),
        D.sep(),
        h('span', { class: 'tb-label' }, 'Click a page to send it to a slide or report'),
        h('div', { class: 'tb-spacer' }),
        D.btn('download', 'Export', () => D.io.exportSheet(this.sheet, 'pdf'), { label: 'Export PDF' })
      );
      this.scroll.innerHTML = '';
      const wrap = h('div', { class: 'pdf-pages' });
      this.scroll.append(wrap);
      this.side.innerHTML = '';
      this.side.append(h('div', { class: 'insp-head' }, h('span', { html: D.icon('pdf', 15) }), 'PDF'), h('div', { class: 'insp-sec' }, h('div', { class: 'insp-hint' }, 'This PDF is shown exactly as the original and is saved unchanged unless you edit it.'), h('div', { class: 'insp-hint' }, 'Edit as document pulls the text into an editable page; saving then writes a fresh PDF (or Word file).')));
      try {
        const doc = await pdfDoc(this.sheet);
        D.app.setStatus(`${doc.numPages} page${doc.numPages > 1 ? 's' : ''} · PDF`);
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const vp = page.getViewport({ scale: 1.5 });
          const cv = h('canvas', { width: vp.width, height: vp.height });
          cv.style.width = vp.width / 1.5 + 'px';
          const card = h('div', { class: 'pdf-page' }, cv, h('div', { class: 'pdf-page-tools' },
            h('span', null, `Page ${n}`),
            h('button', { class: 'btn xs', onclick: () => this.pageTo('slide', n) }, 'To slide'),
            h('button', { class: 'btn xs', onclick: () => this.pageTo('report', n) }, 'To report')));
          wrap.append(card);
          await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          if (!this.host.isConnected) return;
        }
      } catch (err) { console.error(err); wrap.append(h('div', { class: 'empty-note' }, 'This PDF could not be displayed.')); }
    }
    async pageTo(kind, n) {
      const img = await pdfPageToPng(this.sheet, n, 2);
      if (kind === 'slide') {
        const decks = D.project().sheets.filter((s) => s.type === 'slide');
        const deck = decks[0] || D.app.addSheet('slide', { activate: false });
        const s = D.sheetTypes.slide.newSlide('blank');
        const sz = deck.size || { w: 960, h: 540 };
        let w = sz.w - 80, hh = w * img.h / img.w;
        if (hh > sz.h - 40) { hh = sz.h - 40; w = hh * img.w / img.h; }
        s.elements.push(D.newElement('image', { src: img.url, x: Math.round((sz.w - w) / 2), y: Math.round((sz.h - hh) / 2), w: Math.round(w), h: Math.round(hh) }));
        deck.slides.push(s); deck.current = deck.slides.length - 1;
        D.commit({ data: false });
        D.toast(`Page ${n} added as slide ${deck.slides.length} in ${deck.name}`, 'ok');
      } else {
        const rep = D.project().sheets.find((s) => s.type === 'report') || D.app.addSheet('report', { activate: false });
        D.sheetTypes.report.addElement(rep, D.newElement('image', { src: img.url, w: 360, h: Math.round(360 * img.h / img.w) }));
        D.toast(`Page ${n} added to ${rep.name}`, 'ok');
      }
      D.app.renderTabs();
    }
    async editPdf() {
      D.toast('Extracting text…', 'info', 1500);
      if (!this.sheet.html) this.sheet.html = await pdfToHtml(this.sheet);
      this.sheet.view = 'edit';
      D.commit({ data: false });
      this.mountView();
    }

    buildToolbar() {
      const tb = this.toolbar;
      tb.innerHTML = '';
      const cmd = (c, v) => () => { this.restoreSel(); document.execCommand(c, false, v); this.page.focus(); this.onInput(); };
      const style = h('select', { class: 'input sm style-sel', title: 'Paragraph style' }, [['p', 'Normal'], ['h1', 'Title'], ['h2', 'Heading 1'], ['h3', 'Heading 2'], ['blockquote', 'Quote']].map(([v, l]) => h('option', { value: v }, l)));
      style.addEventListener('mousedown', () => this.saveSel());
      style.addEventListener('change', () => { this.restoreSel(); document.execCommand('formatBlock', false, style.value); this.page.focus(); this.onInput(); });
      this.styleSel = style;
      const insertBtn = D.btn('plus', 'Insert', () => D.menu(insertBtn, [
        { label: 'Linked table from data…', icon: 'table', onClick: () => this.insertData('table') },
        { label: 'Linked chart from data…', icon: 'chart', onClick: () => this.insertData('chart') },
        { label: 'Live value…', icon: 'zap', onClick: () => D.links.pickToken((tok, ex) => this.insertHtml(tokenHtml(ex))) },
        { sep: true },
        { label: 'Image…', icon: 'image', onClick: () => this.insertImage() },
        { label: 'Blank table (3 × 3)', icon: 'grid', onClick: () => this.insertHtml('<table class="dt"><tr><th>Header</th><th>Header</th><th>Header</th></tr><tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr></table><p><br></p>') },
        { label: 'Divider', icon: 'minus', onClick: () => this.insertHtml('<hr><p><br></p>') },
        { label: 'Page break', icon: 'pagebreak', onClick: () => this.insertHtml('<div class="pagebreak" contenteditable="false"></div><p><br></p>') }
      ]), { label: 'Insert', caret: true, cls: 'accent' });
      const fmtSel = h('select', { class: 'input sm', title: 'File type this sheet saves as' }, [['docx', 'Saves as Word'], ['pdf', 'Saves as PDF']].map(([v, l]) => h('option', { value: v, selected: v === this.sheet.format ? true : null }, l)));
      fmtSel.addEventListener('change', () => { this.sheet.format = fmtSel.value; if (fmtSel.value === 'pdf') this.sheet.edited = true; D.commit({ data: false }); D.app.renderTabs(); });
      tb.append(
        D.btn('undo', 'Undo', () => D.undo()), D.btn('redo', 'Redo', () => D.redo()), D.sep(),
        style,
        D.btn('bold', 'Bold (Ctrl+B)', cmd('bold')), D.btn('italic', 'Italic (Ctrl+I)', cmd('italic')), D.btn('underline', 'Underline (Ctrl+U)', cmd('underline')),
        D.colorInput('#1F2937', (v, done) => { if (done) { this.restoreSel(); document.execCommand('foreColor', false, v); this.onInput(); } }, 'Text color'),
        D.sep(),
        D.btn('alignLeft', 'Align left', cmd('justifyLeft')), D.btn('alignCenter', 'Center', cmd('justifyCenter')), D.btn('alignRight', 'Align right', cmd('justifyRight')),
        D.btn('list', 'Bulleted list', cmd('insertUnorderedList')), D.btn('listOl', 'Numbered list', cmd('insertOrderedList')),
        D.sep(),
        insertBtn,
        (() => { const b = D.btn('send', 'Send the selected text to a slide', () => this.sendSelection(b), { label: 'To slide' }); return b; })(),
        D.btn('wand', 'Turn this document into a slide deck (headings become slides, linked charts carry over)', () => toDeck(this.sheet), { label: 'Doc → Deck' }),
        h('div', { class: 'tb-spacer' }),
        this.sheet.pdfOriginal ? D.btn('eye', 'View the original PDF', () => { this.save(true); this.sheet.view = 'pdf'; this.mountView(); }, { label: 'Original' }) : null,
        fmtSel
      );
    }
    saveSel() {
      const s = window.getSelection();
      if (s.rangeCount && this.page && this.page.contains(s.anchorNode)) this.range = s.getRangeAt(0).cloneRange();
      this.syncStyleSel();
    }
    restoreSel() {
      if (!this.range) { this.page.focus(); return; }
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(this.range);
    }
    syncStyleSel() {
      if (!this.styleSel) return;
      let n = window.getSelection().anchorNode;
      while (n && n !== this.page && !(n.nodeType === 1 && /^(P|H1|H2|H3|BLOCKQUOTE|LI)$/.test(n.tagName))) n = n.parentNode;
      if (n && n !== this.page) this.styleSel.value = { P: 'p', H1: 'h1', H2: 'h2', H3: 'h3', BLOCKQUOTE: 'blockquote' }[n.tagName] || 'p';
    }
    insertHtml(html) {
      this.page.focus();
      if (this.range && this.page.contains(this.range.startContainer)) this.restoreSel();
      else { const r = document.createRange(); r.selectNodeContents(this.page); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
      document.execCommand('insertHTML', false, html);
      refreshLive(this.page);
      this.onInput(true);
    }
    async insertData(kind) {
      this.saveSel();
      const r = await D.links.insertDialog({ kind, allowKinds: ['chart', 'table', 'kpi'] });
      if (!r) return;
      if (r.kind === 'kpi') this.insertHtml(`<p><b>${D.esc(r.label)}:</b> ${tokenHtml(r.expr)}</p>`);
      else this.insertHtml(figureHtml(r));
    }
    async insertImage() {
      this.saveSel();
      const src = await window.native.pickImage();
      if (src) this.insertHtml(`<p><img src="${src}" style="max-width:100%"></p>`);
    }
    onInput(now = false) {
      if (this.sheet.format === 'pdf') this.sheet.edited = true;
      clearTimeout(this._t);
      if (now) this.save(); else { D.markDirty(); this._t = setTimeout(() => this.save(), 500); }
    }
    save(silent = false) {
      if (!this.page) return;
      clearTimeout(this._t);
      const html = this.page.innerHTML;
      if (html === this.sheet.html) return;
      this.sheet.html = html;
      if (!silent) { D.commit({ data: false }); this.renderSide(); this.updateStatus(); }
      else D.commit({ data: false });
    }
    onKey(e) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); this.save(true); D.undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); D.redo(); }
      else if (e.key === 'Tab') { e.preventDefault(); document.execCommand(e.shiftKey ? 'outdent' : 'indent'); }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const sel = this.page.querySelector('figure.dlive.selected');
        if (sel) { e.preventDefault(); sel.remove(); this.onInput(true); }
      }
    }
    onClick(e) {
      this.page.querySelectorAll('figure.dlive.selected').forEach((f) => f.classList.remove('selected'));
      this.page.querySelectorAll('.dlive-tools').forEach((t) => t.remove());
      const f = e.target.closest('figure.dlive');
      const tok = e.target.closest('span.dtoken');
      if (tok) {
        D.menu({ x: e.clientX, y: e.clientY }, [
          { header: `{{${tok.dataset.expr}}}` },
          { label: 'Edit formula…', icon: 'edit', onClick: async () => { const v = await D.prompt('Live value formula', tok.dataset.expr); if (v) { tok.dataset.expr = v.replace(/^=/, ''); refreshLive(this.page); this.onInput(true); } } },
          { label: 'Convert to plain text', onClick: () => { tok.replaceWith(document.createTextNode(tok.textContent)); this.onInput(true); } },
          { label: 'Remove', icon: 'trash', danger: true, onClick: () => { tok.remove(); this.onInput(true); } }
        ]);
        return;
      }
      if (!f) return;
      f.classList.add('selected');
      const tools = h('div', { class: 'dlive-tools', contenteditable: 'false' },
        h('span', { class: 'dlive-src', html: D.icon('link', 12) + D.esc(`${(D.sheet(f.dataset.sheet) || {}).name || '?'} · ${f.dataset.range}`) }),
        f.dataset.kind === 'chart' ? (() => { const s = h('select', { class: 'input xs' }, D.charts.TYPES.map((t) => h('option', { value: t.id, selected: t.id === f.dataset.chart ? true : null }, t.label))); s.addEventListener('change', () => { f.dataset.chart = s.value; refreshLive(this.page); this.onInput(true); }); return s; })() : null,
        h('button', { class: 'btn xs', onclick: async (ev) => { ev.stopPropagation(); const r = await D.links.insertDialog({ kind: f.dataset.kind, link: { sheetId: f.dataset.sheet, range: f.dataset.range }, allowKinds: [f.dataset.kind] }); if (r) { f.dataset.sheet = r.link.sheetId; f.dataset.range = r.link.range; if (r.chartType) f.dataset.chart = r.chartType; f.dataset.title = r.title || f.dataset.title; refreshLive(this.page); this.onInput(true); } } }, 'Range…'),
        h('button', { class: 'btn xs ghost', onclick: (ev) => { ev.stopPropagation(); D.app.goToRange(f.dataset.sheet, f.dataset.range); } }, 'Source'),
        h('button', { class: 'btn xs danger', onclick: (ev) => { ev.stopPropagation(); f.remove(); this.onInput(true); }, html: D.icon('trash', 12) }));
      f.append(tools);
    }
    onPaste(e) {
      const cd = e.clipboardData;
      const cells = cd.getData('application/x-datum-cells');
      if (cells) {
        e.preventDefault();
        const d = JSON.parse(cells);
        const link = { sheetId: d.sheetId, range: D.f.rangeStr(d.sel) };
        this.saveSel();
        D.menu({ x: innerWidth / 2 - 100, y: innerHeight / 3 }, [
          { header: `Paste ${link.range} as…` },
          { label: 'Linked table (updates with data)', icon: 'table', onClick: () => this.insertHtml(figureHtml({ kind: 'table', link })) },
          { label: 'Linked chart', icon: 'chart', onClick: () => this.insertHtml(figureHtml({ kind: 'chart', link, chartType: 'bar' })) },
          { label: 'Live total', icon: 'zap', onClick: () => this.insertHtml(tokenHtml(D.links.defaultExpr(link))) },
          { label: 'Plain values', onClick: () => this.insertHtml(D.esc(cd.getData('text/plain')).replace(/\n/g, '<br>')) }
        ]);
        return;
      }
      const files = [...cd.files].filter((f) => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); D.fileToDataUrl(files[0]).then((src) => this.insertHtml(`<p><img src="${src}" style="max-width:100%"></p>`)); return; }
      const html = cd.getData('text/html');
      if (html) { e.preventDefault(); document.execCommand('insertHTML', false, sanitize(html)); this.onInput(true); }
    }
    async onDrop(e) {
      const files = [...e.dataTransfer.files];
      if (!files.length) return;
      e.preventDefault();
      for (const f of files) {
        if (f.type.startsWith('image/')) {
          const src = await D.fileToDataUrl(f);
          const r = document.caretRangeFromPoint(e.clientX, e.clientY);
          if (r) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); this.range = r; }
          this.insertHtml(`<img src="${src}" style="max-width:100%">`);
        } else D.io.importPaths([window.native.pathForFile(f)]);
      }
    }
    sendSelection(anchor) {
      const text = String(window.getSelection()).trim() || (this.range && String(this.range).trim());
      if (!text) return D.toast('Select some text in the document first', 'warn');
      const decks = D.project().sheets.filter((s) => s.type === 'slide');
      const make = (deck) => {
        const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
        const title = lines.length > 1 ? lines.shift() : 'From ' + this.sheet.name;
        const s = D.sheetTypes.slide.newSlide('content', { title, body: lines.join('\n') || text });
        deck.slides.push(s); deck.current = deck.slides.length - 1;
        D.commit({ data: false });
        D.app.renderTabs();
        D.toast(`Added slide ${deck.slides.length} to ${deck.name}`, 'ok');
      };
      D.menu(anchor, [
        { header: 'Add as a new slide in…' },
        ...decks.map((d) => ({ label: d.name, icon: 'slide', onClick: () => make(d) })),
        { label: 'New Slide Sheet', icon: 'plus', onClick: () => { const d = D.app.addSheet('slide', { activate: false }); d.slides = []; make(d); } }
      ]);
    }
    renderSide() {
      const side = this.side;
      side.innerHTML = '';
      const heads = [...this.page.querySelectorAll('h1,h2,h3')];
      side.append(h('div', { class: 'insp-head' }, h('span', { html: D.icon('list', 15) }), 'Outline'));
      side.append(h('div', { class: 'insp-sec' }, heads.length ? h('div', { class: 'outline' }, heads.map((x) => h('div', { class: `ol-item l${x.tagName[1]}`, onclick: () => x.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, x.textContent || '(empty heading)'))) : h('div', { class: 'insp-hint' }, 'Headings you add appear here. Doc → Deck turns each heading into a slide.')));
      const live = [...this.page.querySelectorAll('figure.dlive, span.dtoken')];
      side.append(h('div', { class: 'insp-title pad' }, 'Linked content'), h('div', { class: 'insp-sec' }, live.length ? h('div', { class: 'insp-list' }, live.map((n) => h('div', { class: 'insp-li', onclick: () => n.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, h('span', { html: D.icon(n.tagName === 'SPAN' ? 'zap' : n.dataset.kind === 'table' ? 'table' : 'chart', 13) }), h('span', null, n.tagName === 'SPAN' ? n.textContent : (n.dataset.title || n.dataset.kind)), h('span', { class: 'muted small mono' }, n.tagName === 'SPAN' ? '' : n.dataset.range)))) : h('div', { class: 'insp-hint' }, 'Copy a range in a Data Sheet and paste it here to drop in a linked table or chart.')));
    }
    updateStatus() {
      const words = (this.page.innerText.match(/\S+/g) || []).length;
      const pages = Math.max(1, Math.ceil(this.page.scrollHeight / 1056));
      D.app.setStatus(`${words.toLocaleString()} words<span class="st-sep"></span>~${pages} page${pages > 1 ? 's' : ''}<span class="st-sep"></span>Saves as ${this.sheet.format === 'pdf' ? 'PDF' : 'Word (.docx)'}`);
    }
  }
})();
