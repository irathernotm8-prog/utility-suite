'use strict';
/* Live document previews: PDF pages, Word, Excel/CSV tables, slide outlines, Markdown, RTF.
   Everything is rebuilt as plain DOM — no document HTML or scripts are ever executed. */
(function (g) {
  const {el} = U;
  const DOC_EXT = new Set(['pdf', 'docx', 'docm', 'xlsx', 'xlsm', 'csv', 'tsv', 'pptx', 'md', 'markdown', 'rtf']);
  const handles = e => !e.isDir && DOC_EXT.has(e.ext) && (e.size == null || e.size < 60e6);

  // ---------- PDF via the bundled pdf.js
  let pdfjs = null;
  function loadPdf() {
    if (!pdfjs) pdfjs = import('../node_modules/pdfjs-dist/build/pdf.min.mjs').then(m => {
      m.GlobalWorkerOptions.workerSrc = '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs';
      return m;
    });
    return pdfjs;
  }
  async function pdf(box, e, {big, alive}) {
    const [m, data] = await Promise.all([loadPdf(), desk.readBytes(e.path)]);
    if (!alive()) return;
    const doc = await m.getDocument({data, isEvalSupported: false, enableXfa: false, standardFontDataUrl: '../node_modules/pdfjs-dist/standard_fonts/', cMapUrl: '../node_modules/pdfjs-dist/cmaps/', cMapPacked: true}).promise;
    if (!alive()) { doc.destroy(); return; }
    const pages = el('div', {class: 'doc-pdf'});
    const count = el('div', {class: 'doc-count', text: `${doc.numPages} page${doc.numPages === 1 ? '' : 's'}`});
    box.replaceChildren(count, pages);
    const max = Math.min(doc.numPages, big ? 300 : 60);
    const width = () => Math.max(160, (big ? box.clientWidth - 48 : box.clientWidth - 16) || 260);
    // Pages render as they scroll into view.
    const io = new IntersectionObserver(entries => {
      for (const it of entries) if (it.isIntersecting && !it.target.dataset.done) { it.target.dataset.done = '1'; draw(+it.target.dataset.page, it.target); }
    }, {root: box, rootMargin: '400px'});
    async function draw(n, holder) {
      try {
        const page = await doc.getPage(n);
        const base = page.getViewport({scale: 1});
        const scale = width() / base.width;
        const vp = page.getViewport({scale: scale * devicePixelRatio});
        const canvas = el('canvas', {class: 'doc-page-canvas'});
        canvas.width = vp.width; canvas.height = vp.height;
        canvas.style.width = `${Math.round(base.width * scale)}px`;
        holder.style.minHeight = '';
        holder.replaceChildren(canvas);
        await page.render({canvasContext: canvas.getContext('2d'), viewport: vp}).promise;
      } catch (x) { holder.replaceChildren(el('div', {class: 'doc-note', text: `Page ${n} couldn’t be shown.`})); }
    }
    const first = await doc.getPage(1);
    const ratio = first.getViewport({scale: 1}).height / first.getViewport({scale: 1}).width;
    for (let n = 1; n <= max; n++) {
      const holder = el('div', {class: 'doc-page', dataset: {page: n}});
      holder.style.minHeight = `${Math.round(width() * ratio)}px`;
      pages.append(holder);
      io.observe(holder);
    }
    if (doc.numPages > max) pages.append(el('div', {class: 'doc-note', text: `Showing the first ${max} pages — press Open for the rest.`}));
  }

  // ---------- safe HTML (from Word documents)
  const ALLOWED = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'br', 'blockquote', 'pre', 'code', 'img', 'a', 'span', 'hr']);
  function cleanNode(node, out) {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { out.append(document.createTextNode(child.nodeValue)); continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED.has(tag)) { cleanNode(child, out); continue; }
      const n = document.createElement(tag === 'a' ? 'span' : tag);
      if (tag === 'a') n.className = 'doc-link';
      if (tag === 'img') { const src = child.getAttribute('src') || ''; if (!/^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,/i.test(src)) continue; n.src = src; n.alt = ''; }
      for (const a of ['colspan', 'rowspan', 'start']) if (child.hasAttribute(a) && /^\d{1,3}$/.test(child.getAttribute(a))) n.setAttribute(a, child.getAttribute(a));
      cleanNode(child, n);
      out.append(n);
    }
    return out;
  }
  function safeHtml(html) { return cleanNode(new DOMParser().parseFromString(html, 'text/html').body, el('div', {class: 'doc-flow'})); }

  // ---------- tables
  function table(rows, {header = true} = {}) {
    const t = el('table', {class: 'doc-table'});
    rows.forEach((r, i) => t.append(el('tr', {}, r.map(v => el(i === 0 && header ? 'th' : 'td', {text: v, title: v.length > 40 ? v : null})))));
    return el('div', {class: 'doc-table-wrap'}, t);
  }
  function parseCsv(text, sep, max = 300) {
    const rows = []; let row = [], v = '', q = false;
    for (let i = 0; i < text.length && rows.length < max; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { v += '"'; i++; } else q = false; } else v += c; continue; }
      if (c === '"') q = true; else if (c === sep) { row.push(v); v = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(v); rows.push(row.slice(0, 40)); row = []; v = ''; }
      else v += c;
    }
    if (v || row.length) { row.push(v); rows.push(row.slice(0, 40)); }
    return rows;
  }

  // ---------- Markdown → DOM (no HTML strings involved)
  function inline(text, parent) {
    const re = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)]+\))/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      const s = m[0];
      if (m[1]) parent.append(el('code', {text: s.slice(1, -1)}));
      else if (m[2]) inline(s.slice(2, -2), parent.appendChild(el('strong')));
      else if (m[3]) inline(s.slice(1, -1), parent.appendChild(el('em')));
      else if (m[4]) parent.append(el('span', {class: 'doc-link', text: s.slice(1, s.indexOf(']'))}));
      last = m.index + s.length;
    }
    if (last < text.length) parent.append(text.slice(last));
    return parent;
  }
  function markdown(src) {
    const out = el('div', {class: 'doc-flow md'});
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    let i = 0, list = null, para = [];
    const flush = () => { if (para.length) { out.append(inline(para.join(' '), el('p'))); para = []; } };
    while (i < lines.length) {
      const l = lines[i];
      if (/^```/.test(l)) { flush(); list = null; const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); out.append(el('pre', {}, el('code', {text: buf.join('\n')}))); i++; continue; }
      const h = l.match(/^(#{1,6})\s+(.*)/);
      if (h) { flush(); list = null; out.append(inline(h[2], el('h' + h[1].length))); i++; continue; }
      if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(l)) { flush(); list = null; out.append(el('hr')); i++; continue; }
      if (/^\|.*\|\s*$/.test(l) && /^\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
        flush(); list = null; const rows = [l.split('|').slice(1, -1).map(s => s.trim())]; i += 2;
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++].split('|').slice(1, -1).map(s => s.trim()));
        out.append(table(rows)); continue;
      }
      const li = l.match(/^\s*([-*+]|\d+[.)])\s+(.*)/);
      if (li) {
        flush(); const ordered = /\d/.test(li[1]);
        if (!list || list.ordered !== ordered) { list = {ordered, node: el(ordered ? 'ol' : 'ul')}; out.append(list.node); }
        const item = li[2].replace(/^\[( |x)\]\s+/i, (_, x) => x.trim() ? '☑ ' : '☐ ');
        list.node.append(inline(item, el('li'))); i++; continue;
      }
      if (/^>\s?/.test(l)) { flush(); list = null; const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); out.append(inline(buf.join(' '), el('blockquote'))); continue; }
      if (!l.trim()) { flush(); list = null; i++; continue; }
      list = null; para.push(l.trim()); i++;
    }
    flush();
    return out;
  }

  function slides(list) {
    const wrap = el('div', {class: 'doc-slides'});
    list.forEach((s, i) => wrap.append(el('div', {class: 'doc-slide'}, el('span', {class: 'doc-slide-n', text: i + 1}),
      el('div', {class: 'doc-slide-title', text: s.title || 'Untitled slide'}), s.lines.length ? el('ul', {}, s.lines.map(t => el('li', {text: t}))) : null)));
    if (!list.length) wrap.append(el('div', {class: 'doc-note', text: 'No slide text found.'}));
    return wrap;
  }

  // Renders a live preview of e into box. Returns false if this file type isn't a document we handle.
  async function render(box, e, {big = false, alive = () => true} = {}) {
    if (!handles(e)) return false;
    box.classList.add('doc');
    if (big) box.classList.add('big');
    box.replaceChildren(el('div', {class: 'doc-note', text: 'Opening preview…'}));
    try {
      if (e.ext === 'pdf') { await pdf(box, e, {big, alive}); return true; }
      if (['md', 'markdown', 'csv', 'tsv'].includes(e.ext)) {
        const r = await desk.readText(e.path);
        if (!alive()) return true;
        if (r.binary) throw Error('This file isn’t text.');
        const content = e.ext.startsWith('m') ? el('div', {class: 'doc-paper'}, markdown(r.text)) : table(parseCsv(r.text, e.ext === 'tsv' ? '\t' : ','));
        box.replaceChildren(content);
        if (r.truncated) box.append(el('div', {class: 'doc-note', text: 'Showing the start of this file.'}));
        return true;
      }
      const sheetBar = el('div', {class: 'doc-sheets'});
      const show = async sheet => {
        const r = await desk.docPreview(e.path, {sheet});
        if (!alive()) return;
        if (!r || r.type === 'none') { box.replaceChildren(el('div', {class: 'doc-note', text: r?.note || 'No preview for this file.'})); return; }
        if (r.type === 'html') box.replaceChildren(el('div', {class: 'doc-paper'}, safeHtml(r.html)));
        else if (r.type === 'text') box.replaceChildren(el('div', {class: 'doc-paper'}, el('div', {class: 'doc-flow', text: r.text})));
        else if (r.type === 'slides') box.replaceChildren(slides(r.slides));
        else if (r.type === 'table') {
          sheetBar.replaceChildren(...(r.sheets.length > 1 ? r.sheets.map((s, i) => el('button', {class: 'chip' + (s === r.sheet ? ' on' : ''), text: s, onclick: () => show(i)})) : []));
          box.replaceChildren(...[r.sheets.length > 1 ? sheetBar : null, r.rows.length ? table(r.rows) : el('div', {class: 'doc-note', text: 'This sheet is empty.'}),
            r.truncated ? el('div', {class: 'doc-note', text: 'Showing the top-left of this sheet.'}) : null].filter(Boolean));
        }
      };
      await show(0);
    } catch (x) {
      if (alive()) box.replaceChildren(el('div', {class: 'doc-note', text: `No live preview: ${String(x.message || x).replace(/^Error invoking remote method '\w+': (Error: )?/, '')}`}));
    }
    return true;
  }
  g.DocView = {render, handles, markdown, parseCsv, safeHtml};
})(globalThis);
