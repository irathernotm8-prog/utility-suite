// Cadence — PowerPoint templates. Reads a .pptx you made (text boxes, tables, charts, pictures, where each sits,
// theme colours and fonts) and writes a copy with new data in the same places, keeping every bit of formatting:
//   • {{ }} typed straight into the deck are filled in (text, table cells, chart titles, notes)
//   • a "fill" points at one element: replace its text (or just part of it), refill a table, re-plot a chart, swap a picture
//   • a slide can repeat once per row of a table ({{row.Column}} inside), or be dropped when a table is empty
'use strict';
const fs = require('fs');
const path = require('path');
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const EMU_IN = 914400;
const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
};
const REL_SLIDE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';

// ───────── package
class Pkg {
  constructor(buf) {
    this.files = unzipSync(new Uint8Array(buf));
    this.docs = new Map();
  }
  static open(file) {
    if (!fs.existsSync(file)) throw new Error(`PowerPoint file not found: ${file}`);
    if (!/\.(pptx|potx)$/i.test(file)) throw new Error('The template should be a .pptx (or .potx) file. Save older .ppt files as .pptx first.');
    try { return new Pkg(fs.readFileSync(file)); } catch (e) { throw new Error(`Couldn’t open ${path.basename(file)} as a PowerPoint file (${e.message})`); }
  }
  has(p) { return !!this.files[p]; }
  text(p) { return this.files[p] ? strFromU8(this.files[p]) : null; }
  xml(p) {
    if (this.docs.has(p)) return this.docs.get(p);
    const t = this.text(p); if (t == null) return null;
    const d = new DOMParser({ onError: () => {} }).parseFromString(t, 'text/xml');
    this.docs.set(p, d); return d;
  }
  setXml(p, doc) { this.docs.set(p, doc); }
  setBytes(p, u8) { this.files[p] = u8; this.docs.delete(p); }
  remove(p) { delete this.files[p]; this.docs.delete(p); }
  save() {
    for (const [p, d] of this.docs) this.files[p] = strToU8(new XMLSerializer().serializeToString(d));
    return Buffer.from(zipSync(this.files, { level: 6 }));
  }
  relsPath(part) { return path.posix.join(path.posix.dirname(part), '_rels', path.posix.basename(part) + '.rels'); }
  rels(part) {
    const d = this.xml(this.relsPath(part)); if (!d) return [];
    return els(d, 'Relationship').map((r) => ({ el: r, id: r.getAttribute('Id'), type: r.getAttribute('Type'), target: r.getAttribute('Target'), external: r.getAttribute('TargetMode') === 'External', part: r.getAttribute('TargetMode') === 'External' ? null : resolve(part, r.getAttribute('Target')) }));
  }
  slideParts() {
    const pres = this.xml('ppt/presentation.xml'); if (!pres) throw new Error('This file has no slides (ppt/presentation.xml is missing)');
    const rels = this.rels('ppt/presentation.xml');
    return els(pres, 'p:sldId').map((s) => { const rid = s.getAttribute('r:id'); const rel = rels.find((r) => r.id === rid); return { el: s, rid, part: rel && rel.part }; }).filter((s) => s.part && this.has(s.part));
  }
  size() { const pres = this.xml('ppt/presentation.xml'); const s = els(pres, 'p:sldSz')[0]; return s ? { cx: +s.getAttribute('cx'), cy: +s.getAttribute('cy') } : { cx: 12192000, cy: 6858000 }; }
  contentType(part, type) {
    const d = this.xml('[Content_Types].xml'); const root = d.documentElement;
    const name = '/' + part;
    if (els(d, 'Override').some((o) => o.getAttribute('PartName') === name)) return;
    const o = d.createElementNS(root.namespaceURI, 'Override'); o.setAttribute('PartName', name); o.setAttribute('ContentType', type); root.appendChild(o);
  }
  defaultType(ext, type) {
    const d = this.xml('[Content_Types].xml'); const root = d.documentElement;
    if (els(d, 'Default').some((o) => o.getAttribute('Extension').toLowerCase() === ext)) return;
    const o = d.createElementNS(root.namespaceURI, 'Default'); o.setAttribute('Extension', ext); o.setAttribute('ContentType', type); root.insertBefore(o, root.firstChild);
  }
  typeOf(part) { const d = this.xml('[Content_Types].xml'); const o = els(d, 'Override').find((x) => x.getAttribute('PartName') === '/' + part); return o ? o.getAttribute('ContentType') : null; }
  freeName(dir, base, ext) { for (let i = 1; i < 100000; i++) { const p = `${dir}/${base}${i}${ext}`; if (!this.has(p)) return p; } throw new Error('Too many parts'); }
}
const resolve = (from, target) => (target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(from), target)));
const relTarget = (from, to) => path.posix.relative(path.posix.dirname(from), to);
const els = (node, tag) => (node ? Array.from(node.getElementsByTagName(tag)) : []);
const kids = (node, tag) => (node ? Array.from(node.childNodes).filter((n) => n.nodeType === 1 && (!tag || n.nodeName === tag)) : []);
const kid = (node, tag) => kids(node, tag)[0] || null;
const attr = (n, a) => (n ? n.getAttribute(a) : null);

// ───────── text helpers
function paraText(p) { return kids(p).map((n) => (n.nodeName === 'a:r' || n.nodeName === 'a:fld' ? (kid(n, 'a:t') ? kid(n, 'a:t').textContent : '') : n.nodeName === 'a:br' ? '\n' : '')).join(''); }
function bodyText(body) { return body ? kids(body, 'a:p').map(paraText).join('\n') : ''; }
function runsOf(p) { return kids(p).filter((n) => n.nodeName === 'a:r' || n.nodeName === 'a:fld').map((n) => ({ n, t: kid(n, 'a:t') })).filter((r) => r.t); }
const setT = (t, s) => { while (t.firstChild) t.removeChild(t.firstChild); t.appendChild(t.ownerDocument.createTextNode(s)); if (/^\s|\s$/.test(s)) t.setAttribute('xml:space', 'preserve'); };

// Replace text[s, e) in a paragraph, keeping the formatting of the run where the match starts.
function replaceRange(p, s, e, value) {
  const runs = runsOf(p); let off = 0; let i = -1, j = -1, oi = 0, oj = 0;
  for (let k = 0; k < runs.length; k++) { const len = runs[k].t.textContent.length; if (i < 0 && s < off + len) { i = k; oi = off; } if (e <= off + len) { j = k; oj = off; break; } off += len; }
  if (i < 0) return false; if (j < 0) { j = runs.length - 1; oj = off - runs[j].t.textContent.length; }
  const a = runs[i].t.textContent, b = runs[j].t.textContent;
  setT(runs[i].t, a.slice(0, s - oi) + value + b.slice(Math.max(0, e - oj)));
  for (let k = i + 1; k <= j; k++) if (runs[k].n.parentNode) p.removeChild(runs[k].n);
  if (runs[i].n.nodeName === 'a:fld') { // a field (slide number, date) becomes plain text once we change it
    const r = p.ownerDocument.createElementNS(NS.a, 'a:r'); const rpr = kid(runs[i].n, 'a:rPr'); if (rpr) r.appendChild(rpr.cloneNode(true)); r.appendChild(runs[i].t.cloneNode(true)); p.replaceChild(r, runs[i].n);
  }
  return true;
}
// Fill every {{ … }} in a text body.
const TOKEN = /\{\{[\s\S]*?\}\}/g;
function fillTokens(body, render) {
  let changed = false;
  for (const p of kids(body, 'a:p')) {
    for (let guard = 0; guard < 200; guard++) {
      const txt = runsOf(p).map((r) => r.t.textContent).join('');
      const m = [...txt.matchAll(TOKEN)].pop(); if (!m) break;
      replaceRange(p, m.index, m.index + m[0].length, asText(render(m[0])));
      changed = true;
    }
  }
  return changed;
}
// Replace a whole text body, keeping the first paragraph's (and first run's) formatting. Lists become one paragraph each.
function setBodyText(body, value) {
  const doc = body.ownerDocument; const paras = kids(body, 'a:p');
  const lines = (Array.isArray(value) ? value.map(asText) : asText(value).split('\n'));
  const tplP = paras.find((p) => runsOf(p).length) || paras[0];
  const tplR = tplP ? runsOf(tplP)[0] : null;
  const make = (line, k) => {
    const src = paras[Math.min(k, paras.length - 1)] && runsOf(paras[Math.min(k, paras.length - 1)]).length ? paras[Math.min(k, paras.length - 1)] : tplP;
    const p = doc.createElementNS(NS.a, 'a:p');
    const ppr = src ? kid(src, 'a:pPr') : null; if (ppr) p.appendChild(ppr.cloneNode(true));
    const srcRun = (src && runsOf(src)[0]) || tplR;
    const r = doc.createElementNS(NS.a, 'a:r');
    const rpr = srcRun ? kid(srcRun.n, 'a:rPr') : null; if (rpr) r.appendChild(rpr.cloneNode(true));
    const t = doc.createElementNS(NS.a, 'a:t'); setT(t, line); r.appendChild(t); p.appendChild(r);
    const end = src ? kid(src, 'a:endParaRPr') : null; if (end) p.appendChild(end.cloneNode(true));
    return p;
  };
  const fresh = lines.map(make);
  for (const p of paras) body.removeChild(p);
  for (const p of fresh) body.appendChild(p);
}
function asText(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (Array.isArray(v)) return v.map(asText).join('\n');
  if (typeof v === 'object') return v.rows ? `${v.rows.length} rows` : JSON.stringify(v);
  return String(v);
}

// ───────── geometry (shapes inherit position from the layout / master when the slide doesn't say)
function xfrmOf(node) { const sp = kid(node, 'p:spPr') || kid(node, 'p:grpSpPr'); const x = sp ? kid(sp, 'a:xfrm') : kid(node, 'p:xfrm'); if (!x) return null; const off = kid(x, 'a:off'), ext = kid(x, 'a:ext'); if (!off || !ext) return null; return { x: +off.getAttribute('x'), y: +off.getAttribute('y'), w: +ext.getAttribute('cx'), h: +ext.getAttribute('cy'), chOff: kid(x, 'a:chOff'), chExt: kid(x, 'a:chExt') }; }
function phOf(node) { const nv = kid(node, 'p:nvSpPr') || kid(node, 'p:nvPicPr') || kid(node, 'p:nvGraphicFramePr'); const pr = nv && kid(nv, 'p:nvPr'); const ph = pr && kid(pr, 'p:ph'); return ph ? { type: ph.getAttribute('type') || 'body', idx: ph.getAttribute('idx') } : null; }
function cNvPr(node) { for (const nv of ['p:nvSpPr', 'p:nvPicPr', 'p:nvGraphicFramePr', 'p:nvGrpSpPr', 'p:nvCxnSpPr']) { const n = kid(node, nv); if (n) return kid(n, 'p:cNvPr'); } return null; }
function inheritedBox(pkg, slidePart, ph) {
  if (!ph) return null;
  const layoutRel = pkg.rels(slidePart).find((r) => /slideLayout$/.test(r.type)); if (!layoutRel) return null;
  const find = (part) => { const d = pkg.xml(part); if (!d) return null; for (const sp of els(d, 'p:sp')) { const p2 = phOf(sp); if (!p2) continue; if ((ph.idx != null && p2.idx === ph.idx) || (p2.type === ph.type) || (ph.type === 'ctrTitle' && p2.type === 'title') || (ph.type === 'title' && p2.type === 'ctrTitle')) { const b = xfrmOf(sp); if (b) return b; } } return null; };
  const fromLayout = find(layoutRel.part); if (fromLayout) return fromLayout;
  const masterRel = pkg.rels(layoutRel.part).find((r) => /slideMaster$/.test(r.type));
  return masterRel ? find(masterRel.part) : null;
}

// ───────── inspect
const CHART_TYPES = ['c:barChart', 'c:bar3DChart', 'c:lineChart', 'c:line3DChart', 'c:pieChart', 'c:pie3DChart', 'c:doughnutChart', 'c:areaChart', 'c:area3DChart', 'c:scatterChart', 'c:radarChart', 'c:bubbleChart', 'c:ofPieChart'];
function chartInfo(pkg, part) {
  const d = pkg.xml(part); if (!d) return null;
  const plot = els(d, 'c:plotArea')[0]; if (!plot) return null;
  const groups = kids(plot).filter((n) => CHART_TYPES.includes(n.nodeName));
  const sers = groups.flatMap((g) => kids(g, 'c:ser'));
  const nameOf = (ser) => { const tx = kid(ser, 'c:tx'); if (!tx) return ''; return els(tx, 'c:v').map((v) => v.textContent).join('') || els(tx, 'a:t').map((t) => t.textContent).join(''); };
  const cats = sers[0] ? els(kid(sers[0], 'c:cat') || kid(sers[0], 'c:xVal'), 'c:pt').map((p) => kid(p, 'c:v') ? kid(p, 'c:v').textContent : '') : [];
  const title = els(d, 'c:title')[0];
  let type = groups[0] ? groups[0].nodeName.replace('c:', '').replace('Chart', '') : 'chart';
  if (type === 'bar') { const dir = kid(groups[0], 'c:barDir'); type = dir && dir.getAttribute('val') === 'bar' ? 'bar' : 'column'; }
  return { type, series: sers.map(nameOf), categories: cats.slice(0, 40), points: cats.length, title: title ? els(title, 'a:t').map((t) => t.textContent).join('') : '', values: sers.map((s) => els(kid(s, 'c:val') || kid(s, 'c:yVal'), 'c:pt').slice(0, 40).map((p) => +(kid(p, 'c:v') || { textContent: 0 }).textContent)) };
}
function tableInfo(tbl) {
  const rows = kids(tbl, 'a:tr');
  const cells = rows.map((r) => kids(r, 'a:tc').map((tc) => bodyText(kid(tc, 'a:txBody'))));
  const pr = kid(tbl, 'a:tblPr');
  return { rows: rows.length, cols: kids(kid(tbl, 'a:tblGrid'), 'a:gridCol').length, header: pr && pr.getAttribute('firstRow') === '1' ? cells[0] : cells[0], hasHeader: !pr || pr.getAttribute('firstRow') !== '0', cells: cells.slice(0, 12), totalRow: /^\s*(grand\s+)?total/i.test((cells[cells.length - 1] || [])[0] || '') && rows.length > 2 };
}

function walkShapes(pkg, slidePart, root, fn, tf = null) {
  for (const n of kids(root)) {
    if (n.nodeName === 'p:grpSp') {
      const g = xfrmOf(n); let next = tf;
      if (g && g.chOff && g.chExt) { const sx = (+g.chExt.getAttribute('cx') || 1), sy = (+g.chExt.getAttribute('cy') || 1); const t = { ox: +g.chOff.getAttribute('x'), oy: +g.chOff.getAttribute('y'), kx: g.w / sx, ky: g.h / sy, x: g.x, y: g.y }; next = (b) => { const b2 = { x: t.x + (b.x - t.ox) * t.kx, y: t.y + (b.y - t.oy) * t.ky, w: b.w * t.kx, h: b.h * t.ky }; return tf ? tf(b2) : b2; }; }
      walkShapes(pkg, slidePart, n, fn, next);
    } else if (['p:sp', 'p:graphicFrame', 'p:pic', 'p:cxnSp'].includes(n.nodeName)) fn(n, tf);
  }
}

function inspect(file) {
  const pkg = Pkg.open(file);
  return inspectPkg(pkg, path.basename(file));
}
function inspectPkg(pkg, name = '') {
  const size = pkg.size();
  const slides = pkg.slideParts().map((s, i) => {
    const d = pkg.xml(s.part); const tree = els(d, 'p:spTree')[0];
    const shapes = [];
    walkShapes(pkg, s.part, tree, (n, tf) => {
      const pr = cNvPr(n); if (!pr) return;
      const ph = phOf(n);
      let b = xfrmOf(n) || inheritedBox(pkg, s.part, ph);
      if (b && tf) b = tf(b);
      const o = { id: pr.getAttribute('id'), name: pr.getAttribute('name') || '', alt: pr.getAttribute('descr') || '', ph: ph ? ph.type : null, box: b ? { x: b.x / size.cx, y: b.y / size.cy, w: b.w / size.cx, h: b.h / size.cy } : null };
      if (n.nodeName === 'p:sp') {
        const body = kid(n, 'p:txBody'); const text = bodyText(body);
        if (!text.trim() && !ph) { if (!body) return; o.kind = 'shape'; } else o.kind = 'text';
        o.text = text.slice(0, 600); o.isTitle = !!ph && /title/i.test(ph.type);
        const r1 = body && els(body, 'a:rPr')[0]; if (r1) { o.size = r1.getAttribute('sz') ? +r1.getAttribute('sz') / 100 : null; o.bold = r1.getAttribute('b') === '1'; }
      } else if (n.nodeName === 'p:graphicFrame') {
        const tbl = els(n, 'a:tbl')[0]; const chartRef = els(n, 'c:chart')[0];
        if (tbl) { o.kind = 'table'; o.table = tableInfo(tbl); }
        else if (chartRef) { const rel = pkg.rels(s.part).find((r) => r.id === chartRef.getAttribute('r:id')); o.kind = 'chart'; o.chart = rel ? chartInfo(pkg, rel.part) : null; o.part = rel && rel.part; }
        else o.kind = 'other';
      } else if (n.nodeName === 'p:pic') o.kind = 'picture';
      else return;
      o.tokens = [...new Set((o.text || '').match(TOKEN) || [])];
      if (o.kind === 'table') o.tokens = [...new Set(o.table.cells.flat().join(' ').match(TOKEN) || [])];
      shapes.push(o);
    });
    const title = shapes.find((x) => x.isTitle && x.text) || shapes.filter((x) => x.kind === 'text' && x.text).sort((a, b) => (a.box ? a.box.y : 1) - (b.box ? b.box.y : 1))[0];
    const notesRel = pkg.rels(s.part).find((r) => /notesSlide$/.test(r.type));
    const notes = notesRel ? els(pkg.xml(notesRel.part), 'p:sp').filter((sp) => (phOf(sp) || {}).type === 'body').map((sp) => bodyText(kid(sp, 'p:txBody'))).join('\n') : '';
    return { index: i + 1, title: title ? title.text.split('\n')[0].slice(0, 120) : `Slide ${i + 1}`, shapes, notes: notes.slice(0, 400), hidden: d.documentElement.getAttribute('show') === '0' };
  });
  return { name, slideCount: slides.length, size: { w: size.cx / EMU_IN, h: size.cy / EMU_IN, ratio: size.cx / size.cy }, theme: themeOf(pkg), slides };
}

// Theme colours and fonts (for "Make PowerPoint" → match a template's look)
function themeOf(pkg) {
  const masterRel = pkg.rels('ppt/presentation.xml').find((r) => /slideMaster$/.test(r.type));
  const themeRel = masterRel ? pkg.rels(masterRel.part).find((r) => /theme$/.test(r.type)) : null;
  const d = pkg.xml(themeRel ? themeRel.part : 'ppt/theme/theme1.xml'); if (!d) return null;
  const scheme = els(d, 'a:clrScheme')[0]; const colors = {};
  for (const c of kids(scheme)) { const v = kid(c, 'a:srgbClr') || kid(c, 'a:sysClr'); if (v) colors[c.nodeName.replace('a:', '')] = (v.getAttribute('val') === 'windowText' ? '000000' : v.getAttribute('val') === 'window' ? 'FFFFFF' : v.getAttribute('lastClr') || v.getAttribute('val')).toUpperCase(); }
  const font = (tag) => { const f = els(d, tag)[0]; const l = f && kid(f, 'a:latin'); return l ? l.getAttribute('typeface') : null; };
  return { colors, headFont: font('a:majorFont'), bodyFont: font('a:minorFont') };
}

// Format a number the way the template showed it: "$6,120" → "$6,400", "6.7%" → "9.1%", "1.2K" stays compact.
function patternOf(sample) {
  const m = /^(\D*?)(-?[\d,]*\.?\d+)(\s?[KMB]?)(\D*)$/.exec(String(sample || '').trim());
  if (!m) return null;
  return { pre: m[1].replace(/[+\u2212-]$/, ''), dec: (m[2].split('.')[1] || '').length, unit: m[3].trim(), post: m[4], signed: /^[+\u2212-]/.test(String(sample).trim().replace(/^\D*?(?=[+\u2212-])/, '')) };
}
function formatLike(v, sample, col = '') {
  const p = patternOf(sample);
  if (typeof v !== 'number' || !p) return null;
  let n = v;
  if (p.post.startsWith('%') && Math.abs(n) <= 10 && (/%|rate|share|change|ctr|percent/i.test(col) || Math.abs(n) < 1)) n *= 100;
  if (p.unit) n /= { K: 1e3, M: 1e6, B: 1e9 }[p.unit.toUpperCase()] || 1;
  const body = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: p.dec, maximumFractionDigits: p.dec });
  const sign = n < 0 ? '-' : p.signed && n > 0 ? '+' : '';
  return `${sign}${p.pre}${body}${p.unit}${p.post}`;
}

// ───────── fill: tables
function fillTable(frame, data, opts, fmt) {
  const tbl = els(frame, 'a:tbl')[0]; if (!tbl) throw new Error('That element isn’t a table');
  const rows = kids(tbl, 'a:tr'); const ncol = kids(kid(tbl, 'a:tblGrid'), 'a:gridCol').length;
  const pr = kid(tbl, 'a:tblPr'); const hasHeader = opts.header !== false && (!pr || pr.getAttribute('firstRow') !== '0');
  const head = hasHeader ? rows[0] : null;
  let body = hasHeader ? rows.slice(1) : rows.slice();
  const lastText = body.length ? bodyText(kid(kids(body[body.length - 1], 'a:tc')[0], 'a:txBody')) : '';
  const totalTpl = opts.totals !== false && body.length > 1 && /^\s*(grand\s+)?total/i.test(lastText) ? body[body.length - 1] : null;
  if (totalTpl) body = body.slice(0, -1);
  if (!body.length) body = head ? [head] : rows;
  const headTexts = head ? kids(head, 'a:tc').map((tc) => bodyText(kid(tc, 'a:txBody')).trim()) : [];
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9%]/g, '');
  let cols = Array.isArray(opts.columns) && opts.columns.length ? opts.columns.slice(0, ncol) : null;
  if (!cols) {
    const byHead = headTexts.map((h) => data.columns.find((c) => norm(c) === norm(h)) || data.columns.find((c) => norm(h) && (norm(c).includes(norm(h)) || norm(h).includes(norm(c)))));
    cols = byHead.filter(Boolean).length >= Math.ceil(headTexts.length / 2) ? byHead.map((c, i) => c || data.columns[i]) : data.columns.slice(0, ncol);
  }
  if (head && opts.headerText) kids(head, 'a:tc').forEach((tc, i) => { if (cols[i] != null) { const b = kid(tc, 'a:txBody'); if (b) setBodyText(b, cols[i]); } });
  for (const r of [...body, ...(totalTpl ? [totalTpl] : [])]) if (r.parentNode && r !== head) tbl.removeChild(r);
  const max = Number(opts.maxRows) > 0 ? Number(opts.maxRows) : 500;
  const list = data.rows.slice(0, max);
  const tplRows = body.filter((r) => r !== head);
  const fill = (tr, getVal) => kids(tr, 'a:tc').forEach((tc, i) => { const b = kid(tc, 'a:txBody'); if (b && !tc.getAttribute('hMerge') && !tc.getAttribute('vMerge')) setBodyText(b, getVal(i)); });
  const sampleRow = tplRows[0] ? kids(tplRows[0], 'a:tc').map((tc) => bodyText(kid(tc, 'a:txBody'))) : [];
  const show = (v, c, i) => formatLike(v, sampleRow[i], c) ?? fmt(v, c);
  list.forEach((row, k) => { const tr = (tplRows.length ? tplRows[k % tplRows.length] : head).cloneNode(true); fill(tr, (i) => (cols[i] != null ? show(row[cols[i]], cols[i], i) : '')); tbl.appendChild(tr); });
  if (totalTpl) {
    const tr = totalTpl.cloneNode(true); const firstLabel = lastText.trim();
    fill(tr, (i) => { if (i === 0) return firstLabel; const c = cols[i]; if (!c) return ''; const nums = list.map((r) => r[c]).filter((v) => typeof v === 'number'); return nums.length === list.length && list.length && !/%|rate|change/i.test(c) ? show(nums.reduce((a, b) => a + b, 0), c, i) : ''; });
    tbl.appendChild(tr);
  }
  // keep the frame height in step with the rows
  const xf = kid(frame, 'p:xfrm'); const ext = xf && kid(xf, 'a:ext');
  if (ext) { const h = kids(tbl, 'a:tr').reduce((a, r) => a + (+r.getAttribute('h') || 0), 0); if (h) ext.setAttribute('cy', String(h)); }
  return list.length;
}

// ───────── fill: charts
function colLetter(n) { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function setCache(doc, parent, tag, values, isNum, sheet, col, n, formatCode) {
  // parent is c:tx / c:cat / c:val; rebuild its ref + cache
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  const ref = doc.createElementNS(NS.c, isNum ? 'c:numRef' : 'c:strRef');
  const f = doc.createElementNS(NS.c, 'c:f'); f.appendChild(doc.createTextNode(tag === 'tx' ? `${sheet}!$${col}$1` : `${sheet}!$${col}$2:$${col}$${n + 1}`)); ref.appendChild(f);
  const cache = doc.createElementNS(NS.c, isNum ? 'c:numCache' : 'c:strCache');
  if (isNum) { const fc = doc.createElementNS(NS.c, 'c:formatCode'); fc.appendChild(doc.createTextNode(formatCode || 'General')); cache.appendChild(fc); }
  const pc = doc.createElementNS(NS.c, 'c:ptCount'); pc.setAttribute('val', String(values.length)); cache.appendChild(pc);
  values.forEach((v, i) => { if (isNum && (v === '' || v == null || isNaN(v))) return; const pt = doc.createElementNS(NS.c, 'c:pt'); pt.setAttribute('idx', String(i)); const vv = doc.createElementNS(NS.c, 'c:v'); vv.appendChild(doc.createTextNode(String(v))); pt.appendChild(vv); cache.appendChild(pt); });
  ref.appendChild(cache); parent.appendChild(ref);
}
async function fillChart(pkg, chartPart, data, opts, num) {
  const doc = pkg.xml(chartPart); if (!doc) throw new Error('Chart part missing');
  const plot = els(doc, 'c:plotArea')[0];
  const groups = kids(plot).filter((n) => CHART_TYPES.includes(n.nodeName));
  if (!groups.length) throw new Error('This chart type can’t be refilled');
  const numericCols = data.columns.filter((c) => data.rows.length && data.rows.every((r) => r[c] === '' || typeof r[c] === 'number'));
  const xCol = opts.x || data.columns.find((c) => !numericCols.includes(c)) || data.columns[0];
  let yCols = (Array.isArray(opts.y) ? opts.y : typeof opts.y === 'string' && opts.y ? opts.y.split(',').map((s) => s.trim()) : []).filter(Boolean);
  const sers = groups.flatMap((g) => kids(g, 'c:ser').map((s) => ({ g, s })));
  if (!yCols.length) yCols = numericCols.filter((c) => c !== xCol && !/change|previous/i.test(c)).slice(0, Math.max(1, sers.length));
  for (const c of [xCol, ...yCols]) if (!data.columns.includes(c)) throw new Error(`Chart: no column “${c}”. Columns: ${data.columns.join(', ')}`);
  const rows = data.rows.slice(0, Number(opts.maxRows) > 0 ? Number(opts.maxRows) : 100);
  const labels = rows.map((r) => String(r[xCol] ?? ''));
  const isScatter = groups[0].nodeName === 'c:scatterChart' || groups[0].nodeName === 'c:bubbleChart';
  // match series count: clone the last series (same group) or drop extras
  let list = sers.slice();
  while (list.length < yCols.length) { const last = list[list.length - 1]; const c = last.s.cloneNode(true); last.g.insertBefore(c, last.s.nextSibling); list.push({ g: last.g, s: c }); /* keep series in order */ list = groups.flatMap((g) => kids(g, 'c:ser').map((s) => ({ g, s }))); }
  for (const extra of list.slice(yCols.length)) extra.g.removeChild(extra.s);
  list = list.slice(0, yCols.length);
  // pick a sheet name from an existing formula, else Sheet1
  const anyF = els(doc, 'c:f')[0]; const sheet = anyF ? (anyF.textContent.split('!')[0] || 'Sheet1') : 'Sheet1';
  list.forEach(({ s }, i) => {
    const set = (k, v) => { const n = kid(s, k); if (n) n.setAttribute('val', String(v)); };
    set('c:idx', i); set('c:order', i);
    let tx = kid(s, 'c:tx'); if (!tx) { tx = doc.createElementNS(NS.c, 'c:tx'); const order = kid(s, 'c:order'); s.insertBefore(tx, order ? order.nextSibling : s.firstChild); }
    setCache(doc, tx, 'tx', [yCols[i]], false, sheet, colLetter(i + 1), 1);
    const catTag = isScatter ? 'c:xVal' : 'c:cat'; const valTag = isScatter ? 'c:yVal' : 'c:val';
    let cat = kid(s, catTag); if (!cat) { cat = doc.createElementNS(NS.c, catTag); const v = kid(s, valTag); s.insertBefore(cat, v); }
    const catNumeric = isScatter && labels.every((l) => !isNaN(Number(l)) && l !== '');
    setCache(doc, cat, 'cat', catNumeric ? labels.map(Number) : labels, catNumeric, sheet, 'A', rows.length);
    const val = kid(s, valTag); const oldFmt = val ? els(val, 'c:formatCode')[0] : null;
    if (val) setCache(doc, val, 'val', rows.map((r) => { const n = num(r[yCols[i]]); return isNaN(n) ? '' : n; }), true, sheet, colLetter(i + 1), rows.length, oldFmt ? oldFmt.textContent : 'General');
    for (const dpt of kids(s, 'c:dPt')) { const ix = kid(dpt, 'c:idx'); if (ix && +ix.getAttribute('val') >= rows.length) s.removeChild(dpt); }
    const dls = kid(s, 'c:dLbls'); if (dls) for (const dl of kids(dls, 'c:dLbl')) { const ix = kid(dl, 'c:idx'); if (ix && +ix.getAttribute('val') >= rows.length) dls.removeChild(dl); }
  });
  if (opts.title != null && opts.title !== '') { const t = els(doc, 'c:title')[0]; const tb = t && els(t, 'c:rich')[0]; if (tb) setBodyText(tb, opts.title); }
  // the embedded workbook ("Edit data" in PowerPoint)
  const wbRel = pkg.rels(chartPart).find((r) => /package$|oleObject$/.test(r.type) && r.part && /\.xlsx$/i.test(r.part));
  if (wbRel && pkg.has(wbRel.part)) {
    try {
      const ExcelJS = require('exceljs'); const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(pkg.files[wbRel.part]));
      const name = sheet.replace(/^'|'$/g, '');
      let ws = wb.getWorksheet(name) || wb.worksheets[0];
      if (ws) { const nm = ws.name; wb.removeWorksheet(ws.id); ws = wb.addWorksheet(nm); } else ws = wb.addWorksheet(name || 'Sheet1');
      ws.addRow([xCol, ...yCols]);
      rows.forEach((r) => ws.addRow([r[xCol], ...yCols.map((c) => { const n = num(r[c]); return isNaN(n) ? null : n; })]));
      if (wb.worksheets.length > 1) { const first = wb.worksheets.indexOf(ws); if (first > 0) ws.orderNo = 0; }
      pkg.setBytes(wbRel.part, new Uint8Array(await wb.xlsx.writeBuffer()));
    } catch { /* the cached values above are what PowerPoint shows; the workbook is a bonus */ }
  }
  return rows.length;
}

// ───────── fill: pictures
function fillPicture(pkg, slidePart, pic, file) {
  if (!file || !fs.existsSync(file)) throw new Error(`Picture not found: ${file || '(none)'}`);
  const ext = path.extname(file).slice(1).toLowerCase().replace('jpeg', 'jpg');
  if (!['png', 'jpg', 'gif', 'bmp'].includes(ext)) throw new Error('Pictures must be PNG, JPG, GIF or BMP');
  const blip = els(pic, 'a:blip')[0]; if (!blip) throw new Error('That picture can’t be replaced');
  const media = pkg.freeName('ppt/media', 'cadence', '.' + ext);
  pkg.setBytes(media, new Uint8Array(fs.readFileSync(file)));
  pkg.defaultType(ext, { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' }[ext]);
  const relsDoc = pkg.xml(pkg.relsPath(slidePart));
  const id = 'rIdCad' + Math.random().toString(36).slice(2, 8);
  const r = relsDoc.createElementNS(NS.rel, 'Relationship'); r.setAttribute('Id', id); r.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'); r.setAttribute('Target', relTarget(slidePart, media));
  relsDoc.documentElement.appendChild(r);
  blip.setAttribute('r:embed', id);
  // keep the picture inside its box without stretching
  const size = imageSize(fs.readFileSync(file));
  const b = xfrmOf(pic);
  if (size && b) {
    const box = b.w / b.h, img = size.w / size.h; let w = b.w, h = b.h;
    if (img > box) h = Math.round(b.w / img); else w = Math.round(b.h * img);
    const x = kid(kid(pic, 'p:spPr'), 'a:xfrm'); kid(x, 'a:off').setAttribute('x', String(Math.round(b.x + (b.w - w) / 2))); kid(x, 'a:off').setAttribute('y', String(Math.round(b.y + (b.h - h) / 2))); kid(x, 'a:ext').setAttribute('cx', String(w)); kid(x, 'a:ext').setAttribute('cy', String(h));
    const src = els(pic, 'a:srcRect')[0]; if (src) src.parentNode.removeChild(src);
  }
}
function imageSize(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) { let i = 2; while (i < b.length) { if (b[i] !== 0xff) return null; const m = b[i + 1]; const len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; i += 2 + len; } }
  if (b.slice(0, 3).toString() === 'GIF') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  return null;
}

// ───────── slides: copy and drop
const CT_SLIDE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
function cloneSlide(pkg, slide) {
  const newPart = pkg.freeName('ppt/slides', 'slide', '.xml');
  pkg.setBytes(newPart, pkg.files[slide.part].slice());
  pkg.contentType(newPart, CT_SLIDE);
  const relsSrc = pkg.relsPath(slide.part);
  if (pkg.has(relsSrc)) {
    const rd = new DOMParser().parseFromString(pkg.text(relsSrc), 'text/xml');
    for (const r of els(rd, 'Relationship')) {
      const type = r.getAttribute('Type'); if (r.getAttribute('TargetMode') === 'External') continue;
      if (/notesSlide$/.test(type)) { const src = resolve(slide.part, r.getAttribute('Target')); if (!pkg.has(src)) { r.parentNode.removeChild(r); continue; } const copy = cloneNotes(pkg, src, newPart); r.setAttribute('Target', relTarget(newPart, copy)); continue; }
      if (/chart$/.test(type)) { const src = resolve(slide.part, r.getAttribute('Target')); const copy = cloneChart(pkg, src); r.setAttribute('Target', relTarget(newPart, copy)); }
    }
    pkg.setXml(pkg.relsPath(newPart), rd);
  }
  // register in presentation.xml right after the original
  const pres = pkg.xml('ppt/presentation.xml'); const presRels = pkg.xml('ppt/_rels/presentation.xml.rels');
  const rid = 'rIdCad' + Math.random().toString(36).slice(2, 8);
  const rel = presRels.createElementNS(NS.rel, 'Relationship'); rel.setAttribute('Id', rid); rel.setAttribute('Type', REL_SLIDE); rel.setAttribute('Target', relTarget('ppt/presentation.xml', newPart)); presRels.documentElement.appendChild(rel);
  const ids = els(pres, 'p:sldId').map((s) => +s.getAttribute('id'));
  const sid = pres.createElementNS(NS.p, 'p:sldId'); sid.setAttribute('id', String(Math.max(255, ...ids) + 1)); sid.setAttribute('r:id', rid);
  slide.el.parentNode.insertBefore(sid, slide.after ? slide.after.nextSibling : slide.el.nextSibling);
  return { el: sid, rid, part: newPart };
}
function cloneNotes(pkg, src, slidePart) {
  const dst = pkg.freeName('ppt/notesSlides', 'notesSlide', '.xml');
  pkg.setBytes(dst, pkg.files[src].slice()); pkg.contentType(dst, 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml');
  const rs = pkg.relsPath(src);
  if (pkg.has(rs)) { const rd = new DOMParser().parseFromString(pkg.text(rs), 'text/xml'); for (const r of els(rd, 'Relationship')) if (/\/slide$/.test(r.getAttribute('Type'))) r.setAttribute('Target', relTarget(dst, slidePart)); pkg.setXml(pkg.relsPath(dst), rd); }
  return dst;
}
function cloneChart(pkg, src) {
  const dst = pkg.freeName('ppt/charts', 'chart', '.xml');
  pkg.setBytes(dst, pkg.files[src].slice()); pkg.contentType(dst, pkg.typeOf(src) || 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml');
  const rs = pkg.relsPath(src);
  if (pkg.has(rs)) {
    const rd = new DOMParser().parseFromString(pkg.text(rs), 'text/xml');
    for (const r of els(rd, 'Relationship')) {
      if (r.getAttribute('TargetMode') === 'External') continue;
      const part = resolve(src, r.getAttribute('Target')); if (!pkg.has(part)) continue;
      const ext = path.posix.extname(part); const dir = path.posix.dirname(part); const base = path.posix.basename(part, ext).replace(/\d+$/, '');
      const copy = pkg.freeName(dir, base, ext); pkg.setBytes(copy, pkg.files[part].slice());
      const t = pkg.typeOf(part); if (t) pkg.contentType(copy, t);
      r.setAttribute('Target', relTarget(dst, copy));
    }
    pkg.setXml(pkg.relsPath(dst), rd);
  }
  return dst;
}
function dropSlide(pkg, slide) {
  slide.el.parentNode.removeChild(slide.el);
  const presRels = pkg.xml('ppt/_rels/presentation.xml.rels');
  for (const r of els(presRels, 'Relationship')) if (r.getAttribute('Id') === slide.rid) r.parentNode.removeChild(r);
  const ct = pkg.xml('[Content_Types].xml');
  for (const o of els(ct, 'Override')) if (o.getAttribute('PartName') === '/' + slide.part) o.parentNode.removeChild(o);
  pkg.remove(slide.part); pkg.remove(pkg.relsPath(slide.part));
}

// ───────── find a shape on a slide by id (or name)
function findShape(pkg, part, ref, kind) {
  // ids are usually unique, but some tools repeat them: score id + name + element type together
  const d = pkg.xml(part); const want = { text: 'p:sp', replace: 'p:sp', table: 'p:graphicFrame', chart: 'p:graphicFrame', picture: 'p:pic' }[kind];
  let best = null, bestScore = 0;
  walkShapes(pkg, part, els(d, 'p:spTree')[0], (n) => {
    const pr = cNvPr(n); if (!pr) return;
    let sc = 0;
    if (ref.id != null && pr.getAttribute('id') === String(ref.id)) sc += 2;
    if (ref.name && pr.getAttribute('name') === ref.name) sc += 2;
    if (!sc) return;
    if (want && n.nodeName === want) sc += 1;
    if (kind === 'table' && els(n, 'a:tbl').length) sc += 1;
    if (kind === 'chart' && els(n, 'c:chart').length) sc += 1;
    if (sc > bestScore) { best = n; bestScore = sc; }
  });
  return best;
}

// ───────── the whole fill
// fills: [{ slide, shape: {id, name}, kind: 'text'|'replace'|'table'|'chart'|'picture', value, find, table, columns, x, y, maxRows, headerText }]
// repeat: [{ slide, table, max }]  — one copy of the slide per row; {{row.X}} and {{index}} inside
// render(text, extra) → value   (Cadence's template engine; extra adds row/index)
async function fill({ template, out, fills = [], repeat = [], render, num, fmt, tokens = true, log = () => {} }) {
  const pkg = Pkg.open(template);
  num = num || ((v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,%\s]/g, ''))));
  fmt = fmt || ((v) => asText(v));
  const asTable = (v, what) => { if (!v || typeof v !== 'object' || !Array.isArray(v.columns)) throw new Error(`${what} needs a table, like {{steps.read.table}}`); return v; };
  let slides = pkg.slideParts().map((s, i) => ({ ...s, n: i + 1, extra: {} }));
  const counts = { text: 0, table: 0, chart: 0, picture: 0, tokens: 0, slides: 0 };

  // repeated slides first, so fills apply to every copy
  for (const rp of repeat.filter((r) => r && r.slide)) {
    const at = slides.findIndex((s) => s.n === Number(rp.slide) && !s.copy);
    if (at < 0) throw new Error(`Repeat: there’s no slide ${rp.slide}`);
    const data = asTable(render(rp.table, {}), `Repeat on slide ${rp.slide}`);
    const rows = data.rows.slice(0, Number(rp.max) > 0 ? Number(rp.max) : 200);
    const base = slides[at];
    if (!rows.length) { dropSlide(pkg, base); slides.splice(at, 1); log(`Slide ${rp.slide}: no rows, so it was left out`); continue; }
    const copies = [{ ...base, extra: { row: rows[0], index: 1, count: rows.length } }];
    let prev = base;
    for (let k = 1; k < rows.length; k++) { const c = cloneSlide(pkg, { ...base, after: prev.el }); prev = c; copies.push({ ...c, n: base.n, copy: true, extra: { row: rows[k], index: k + 1, count: rows.length } }); }
    slides.splice(at, 1, ...copies);
    counts.slides += rows.length - 1;
    log(`Slide ${rp.slide}: one per row (${rows.length})`);
  }

  for (const s of slides) {
    const part = s.part; const extra = s.extra;
    const r = (v) => render(v, extra);
    for (const f of fills.filter((x) => x && Number(x.slide) === s.n)) {
      const shape = findShape(pkg, part, f.shape || {}, f.kind || 'text');
      if (!shape) throw new Error(`Slide ${s.n}: can’t find “${(f.shape && (f.shape.name || f.shape.id)) || '?'}” — was the template changed? Load it again in the step.`);
      const kind = f.kind || 'text';
      if (kind === 'text' || kind === 'replace') {
        const body = kid(shape, 'p:txBody'); if (!body) throw new Error(`Slide ${s.n}: “${f.shape.name}” has no text`);
        const v = r(f.value);
        if (kind === 'replace' && f.find) {
          let done = false;
          for (const p of kids(body, 'a:p')) { const t = runsOf(p).map((x) => x.t.textContent).join(''); const i = t.indexOf(f.find); if (i >= 0) { replaceRange(p, i, i + f.find.length, typeof v === 'number' ? (formatLike(v, f.find) ?? asText(v)) : asText(v)); done = true; break; } }
          if (!done) log(`Slide ${s.n}: “${f.find}” wasn’t in “${f.shape.name}”, so nothing was replaced`, 'warn');
        } else setBodyText(body, typeof v === 'number' && f.keepFormat !== false ? (formatLike(v, bodyText(body)) ?? v) : v);
        counts.text++;
      } else if (kind === 'table') { const n = fillTable(shape, asTable(r(f.table), `Slide ${s.n} table`), { columns: f.columns, maxRows: f.maxRows, headerText: f.headerText, totals: f.totals }, fmt); counts.table++; log(`Slide ${s.n}: table with ${n} rows`); }
      else if (kind === 'chart') {
        const ref = els(shape, 'c:chart')[0]; if (!ref) throw new Error(`Slide ${s.n}: “${f.shape.name}” isn’t a chart`);
        const rel = pkg.rels(part).find((x) => x.id === ref.getAttribute('r:id'));
        const n = await fillChart(pkg, rel.part, asTable(r(f.table), `Slide ${s.n} chart`), { x: f.x, y: f.y, maxRows: f.maxRows, title: f.title ? asText(r(f.title)) : null }, num);
        counts.chart++; log(`Slide ${s.n}: chart with ${n} points`);
      } else if (kind === 'picture') {
        const v = r(f.value); const file = typeof v === 'object' && v ? v.file : v;
        fillPicture(pkg, part, shape, String(file || '')); counts.picture++;
      } else throw new Error(`Unknown fill kind “${kind}”`);
    }
    // {{ }} typed into the deck: text, table cells, chart titles, notes
    if (tokens) {
      const d = pkg.xml(part);
      for (const body of [...els(d, 'p:txBody'), ...els(d, 'a:txBody')]) if (fillTokens(body, r)) counts.tokens++;
      for (const rel of pkg.rels(part)) {
        if (/chart$/.test(rel.type) && rel.part) { const cd = pkg.xml(rel.part); if (cd) for (const rich of els(cd, 'c:rich')) if (fillTokens(rich, r)) counts.tokens++; }
        if (/notesSlide$/.test(rel.type) && rel.part) { const nd = pkg.xml(rel.part); if (nd) for (const body of els(nd, 'p:txBody')) if (fillTokens(body, r)) counts.tokens++; }
      }
    }
  }
  // drop leftover [[ ]]-style hints? no — keep the template's own text untouched unless asked
  const buf = pkg.save();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  return { file: out, slides: pkg.slideParts().length, counts };
}

module.exports = { inspect, inspectPkg, fill, themeOf, Pkg, _: { formatLike, setBodyText, fillTokens, replaceRange, bodyText, asText } };
