// Cadence — slides and reports. One "slide spec" drives both PowerPoint (real, editable charts via pptxgenjs)
// and the PDF/HTML/Markdown report (inline SVG charts, printed by Electron).
'use strict';
const fs = require('fs');
const path = require('path');
const T = require('../table');

// ───────── shared helpers
const hex = (c, d = '7C5CFF') => (String(c || '').replace('#', '').match(/^[0-9a-f]{6}$/i) ? String(c).replace('#', '').toUpperCase() : d);
const isPctCol = (c) => /%|percent|rate|share/i.test(c);
function fmtCell(v, col = '') {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    if (isPctCol(col) && Math.abs(v) <= 10 && /change %|%$|rate|share/i.test(col)) return (v * 100).toFixed(1) + '%';
    return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  return String(v);
}
function chartSeries(t, x, y) {
  t = T.asTable(t);
  const numeric = t.columns.filter((c) => t.rows.length && t.rows.every((r) => r[c] === '' || typeof r[c] === 'number'));
  const xCol = x || t.columns.find((c) => !numeric.includes(c)) || t.columns[0];
  let yCols = (Array.isArray(y) ? y : typeof y === 'string' && y ? y.split(',').map((s) => s.trim()) : []).filter(Boolean);
  if (!yCols.length) yCols = numeric.filter((c) => c !== xCol && !/change|previous/i.test(c)).slice(0, 4);
  for (const c of [xCol, ...yCols]) if (!t.columns.includes(c)) throw new Error(`Chart: no column “${c}”. Columns: ${t.columns.join(', ')}`);
  const rows = t.rows.slice(0, 60);
  return { labels: rows.map((r) => String(r[xCol] ?? '')), series: yCols.map((c) => ({ name: c, values: rows.map((r) => { const n = T.num(r[c]); return isNaN(n) ? 0 : n; }) })), xCol, yCols };
}
function normSlides(list) {
  let arr = list;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { throw new Error('Slides from the AI step weren’t valid JSON'); } }
  if (arr && !Array.isArray(arr) && Array.isArray(arr.slides)) arr = arr.slides;
  if (arr && !Array.isArray(arr) && Array.isArray(arr.sections)) arr = arr.sections;
  if (!Array.isArray(arr)) return [];
  return arr.filter((s) => s && typeof s === 'object' && !s.off).map((s) => ({ layout: s.layout || (s.bullets ? 'bullets' : s.items ? 'kpis' : s.table ? 'table' : 'text'), ...s }));
}
const asList = (v) => (Array.isArray(v) ? v.map((b) => (typeof b === 'object' ? b.text || JSON.stringify(b) : String(b))) : String(v || '').split('\n')).map((s) => s.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);
function deltaTone(delta, good = 'up') {
  const s = String(delta ?? '').trim(); if (!s) return 'flat';
  const neg = s.startsWith('-') || s.startsWith('−') || (typeof delta === 'number' && delta < 0);
  const zero = /^[+-]?0(\.0+)?%?$/.test(s);
  if (zero) return 'flat';
  return (neg ? good === 'down' : good !== 'down') ? 'good' : 'bad';
}

// ───────── PowerPoint
const THEMES = {
  midnight: { bg: '110F1A', panel: '1C1929', text: 'F3F0FF', muted: 'A39DBD', line: '2E2A40', grid: '2A2639' },
  paper: { bg: 'FFFFFF', panel: 'F5F4F8', text: '1B1A24', muted: '6E6B80', line: 'E3E1EA', grid: 'E9E7EF' },
  slate: { bg: 'F6F7FA', panel: 'FFFFFF', text: '161A23', muted: '5F6576', line: 'DDE1E8', grid: 'E4E7ED', band: true },
};
const GOOD = '1FAE6A', BAD = 'E5484D';

async function makeSlides(w, x) {
  const PptxGen = require('pptxgenjs');
  const pres = new PptxGen();
  pres.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 in
  pres.author = 'Cadence'; pres.company = ''; pres.title = (w.slides && w.slides[0] && w.slides[0].title) || x.run.flow.name;
  const th = THEMES[w.theme] || THEMES.paper; const acc = hex(w.accent); const font = w.font || 'Aptos';
  const logo = w.logo && fs.existsSync(x.resolvePath(w.logo)) ? x.resolvePath(w.logo) : null;
  const W = 13.333, H = 7.5, M = 0.6;
  const slides = [...normSlides(w.slides), ...normSlides(w.slidesFrom)];
  if (!slides.length) throw new Error('Add at least one slide');
  const footer = w.footer ? String(w.footer) : '';
  const palette = [acc, '22B8CF', 'F59F00', 'E64980', '51CF66', '845EF7', '339AF0', 'FF922B'];

  slides.forEach((s, i) => {
    const sl = pres.addSlide();
    sl.background = { color: th.bg };
    const layout = s.layout;
    const isCover = layout === 'title' || layout === 'section';
    if (isCover) {
      sl.background = { color: w.theme === 'midnight' ? th.bg : th.bg };
      sl.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.28, h: H, fill: { color: acc }, line: { color: acc } });
      sl.addShape(pres.ShapeType.ellipse, { x: W - 4.6, y: -1.8, w: 6.4, h: 6.4, fill: { color: acc, transparency: 88 }, line: { color: acc, transparency: 100 } });
      sl.addText(String(s.title || ''), { x: M + 0.4, y: layout === 'title' ? 2.35 : 2.8, w: W - 2.4, h: 1.5, fontFace: font, fontSize: layout === 'title' ? 44 : 36, bold: true, color: th.text, valign: 'bottom', margin: 0, fit: 'shrink' });
      if (s.subtitle) sl.addText(String(s.subtitle), { x: M + 0.4, y: (layout === 'title' ? 2.35 : 2.8) + 1.6, w: W - 2.4, h: 0.7, fontFace: font, fontSize: 20, color: th.muted, valign: 'top', margin: 0 });
      if (logo) sl.addImage({ path: logo, x: M + 0.4, y: 0.55, h: 0.6, w: 0.6, sizing: { type: 'contain', w: 1.8, h: 0.6 } });
    } else {
      if (th.band) sl.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: W, h: 1.1, fill: { color: acc }, line: { color: acc } });
      else sl.addShape(pres.ShapeType.rect, { x: M, y: 0.5, w: 0.5, h: 0.07, fill: { color: acc }, line: { color: acc } });
      sl.addText(String(s.title || ''), { x: M, y: th.band ? 0.18 : 0.62, w: W - 2 * M - (logo ? 1.6 : 0), h: 0.75, fontFace: font, fontSize: 26, bold: true, color: th.band ? 'FFFFFF' : th.text, margin: 0, valign: 'middle', fit: 'shrink' });
      if (logo) sl.addImage({ path: logo, x: W - M - 1.4, y: th.band ? 0.25 : 0.55, w: 1.4, h: 0.6, sizing: { type: 'contain', w: 1.4, h: 0.6 } });
    }
    const top = th.band ? 1.45 : 1.55, bodyH = H - top - 0.8;

    if (layout === 'kpis') {
      const items = (Array.isArray(s.items) ? s.items : []).slice(0, 6);
      const n = Math.max(1, items.length); const cols = n <= 3 ? n : Math.ceil(n / 2); const rows = n <= 3 ? 1 : 2;
      const gap = 0.3; const cw = (W - 2 * M - gap * (cols - 1)) / cols; const ch = rows === 1 ? Math.min(3.2, bodyH - 0.4) : (bodyH - gap - 0.2) / 2;
      const y0 = rows === 1 ? top + Math.max(0.2, (bodyH - ch) / 2 - 0.25) : top + 0.1;
      items.forEach((it, k) => {
        const cx = M + (k % cols) * (cw + gap); const cy = y0 + Math.floor(k / cols) * (ch + gap); const big = rows === 1;
        sl.addShape(pres.ShapeType.roundRect, { x: cx, y: cy, w: cw, h: ch, rectRadius: 0.12, fill: { color: th.panel }, line: { color: th.line, width: 0.75 } });
        sl.addText(String(it.label ?? ''), { x: cx + 0.35, y: cy + (big ? 0.4 : 0.25), w: cw - 0.7, h: 0.45, fontFace: font, fontSize: big ? 16 : 14, color: th.muted, margin: 0 });
        sl.addText(String(it.value ?? ''), { x: cx + 0.35, y: cy + (big ? 0.95 : 0.7), w: cw - 0.7, h: big ? 1.2 : 1.0, fontFace: font, fontSize: big ? 54 : 40, bold: true, color: th.text, margin: 0, fit: 'shrink' });
        if (it.delta != null && it.delta !== '') {
          const tone = deltaTone(it.delta, it.good); const col = tone === 'good' ? GOOD : tone === 'bad' ? BAD : th.muted;
          sl.addText([{ text: String(it.delta), options: { bold: true, color: col } }, ...(it.note ? [{ text: `  ${it.note}`, options: { bold: false, color: th.muted } }] : [])], { x: cx + 0.35, y: cy + (big ? 2.3 : 1.75), w: cw - 0.7, h: 0.45, fontFace: font, fontSize: 14, bold: true, color: col, margin: 0 });
        }
      });
    } else if (layout === 'chart') {
      if (s.table == null || typeof s.table === 'string') throw new Error(`Slide ${i + 1}: the chart needs a table, like {{steps.read.table}}`);
      const { labels, series } = chartSeries(s.table, s.x, s.y);
      const kind = String(s.chart || 'column');
      const type = { bar: 'bar', column: 'bar', line: 'line', area: 'area', pie: 'pie', doughnut: 'doughnut' }[kind] || 'bar';
      const data = (type === 'pie' || type === 'doughnut') ? [{ name: series[0].name, labels, values: series[0].values }] : series.map((se) => ({ name: se.name, labels, values: se.values }));
      const hasNotes = s.notes && String(s.notes).trim() && s.showNotes !== false;
      const cw = hasNotes ? (W - 2 * M) * 0.66 : W - 2 * M;
      sl.addChart(type, data, {
        x: M, y: top, w: cw, h: bodyH, barDir: kind === 'bar' ? 'bar' : 'col', barGapWidthPct: 60,
        chartColors: type === 'pie' || type === 'doughnut' ? palette : palette.slice(0, series.length),
        showLegend: series.length > 1 || type === 'pie' || type === 'doughnut', legendPos: 'b', legendColor: th.muted, legendFontFace: font, legendFontSize: 11,
        catAxisLabelColor: th.muted, valAxisLabelColor: th.muted, catAxisLabelFontFace: font, valAxisLabelFontFace: font, catAxisLabelFontSize: 11, valAxisLabelFontSize: 11,
        valGridLine: { color: th.grid, size: 0.75 }, catGridLine: { style: 'none' }, catAxisLineShow: false, valAxisLineShow: false,
        ...(type === 'pie' || type === 'doughnut' ? { showPercent: true, showValue: false, showLegend: true, dataLabelColor: 'FFFFFF', dataLabelFontSize: 12, dataLabelFontBold: true } : { showValue: series.length === 1 && labels.length <= 12 && type !== 'line' && type !== 'area', dataLabelColor: th.text, dataLabelFontSize: 10, dataLabelFormatCode: '#,##0' }), lineSize: 3, lineDataSymbol: 'circle', lineDataSymbolSize: 7, holeSize: 58,
        valAxisLabelFormatCode: '#,##0',
      });
      if (hasNotes) {
        sl.addShape(pres.ShapeType.roundRect, { x: M + cw + 0.3, y: top, w: W - 2 * M - cw - 0.3, h: bodyH, rectRadius: 0.1, fill: { color: th.panel }, line: { color: th.line, width: 0.75 } });
        sl.addText(asList(s.notes).map((t) => ({ text: t, options: { bullet: { indent: 14 }, breakLine: true } })), { x: M + cw + 0.5, y: top + 0.25, w: W - 2 * M - cw - 0.7, h: bodyH - 0.5, fontFace: font, fontSize: 14, color: th.text, valign: 'top', paraSpaceAfter: 8, fit: 'shrink' });
      }
    } else if (layout === 'table') {
      if (s.table == null || typeof s.table === 'string') throw new Error(`Slide ${i + 1}: the table slide needs a table, like {{steps.read.table}}`);
      const t = T.asTable(s.table);
      const cols = (Array.isArray(s.columns) ? s.columns : typeof s.columns === 'string' && s.columns ? s.columns.split(',').map((c) => c.trim()) : t.columns).filter((c) => t.columns.includes(c)).slice(0, 9);
      const max = Math.max(1, Number(s.maxRows) || 12);
      const body = t.rows.slice(0, max);
      const numCol = (c) => body.every((r) => r[c] === '' || typeof r[c] === 'number');
      const rows = [cols.map((c) => ({ text: c, options: { bold: true, color: 'FFFFFF', fill: { color: acc }, align: numCol(c) ? 'right' : 'left' } })),
        ...body.map((r, k) => cols.map((c) => { const v = r[c]; const tone = /change/i.test(c) && typeof v === 'number' && v !== 0 ? (v > 0 ? GOOD : BAD) : th.text; return { text: fmtCell(v, c), options: { color: tone, align: numCol(c) ? 'right' : 'left', fill: { color: k % 2 ? th.panel : th.bg } } }; }))];
      sl.addTable(rows, { x: M, y: top, w: W - 2 * M, fontFace: font, fontSize: body.length > 10 ? 11 : 13, border: { type: 'solid', pt: 0.5, color: th.line }, rowH: Math.min(0.45, (bodyH - 0.3) / (body.length + 1)), valign: 'middle', margin: [3, 8, 3, 8], autoPage: false });
      if (t.rows.length > max) sl.addText(`+ ${t.rows.length - max} more rows`, { x: M, y: H - 0.85, w: 4, h: 0.3, fontFace: font, fontSize: 11, color: th.muted, margin: 0 });
    } else if (layout === 'bullets') {
      const b = asList(s.bullets);
      sl.addText(b.map((t) => ({ text: t, options: { bullet: { indent: 18 }, breakLine: true } })), { x: M, y: top, w: W - 2 * M, h: bodyH, fontFace: font, fontSize: b.length > 6 ? 18 : 22, color: th.text, valign: 'top', paraSpaceAfter: 14, fit: 'shrink' });
    } else if (layout === 'text') {
      sl.addText(String(s.text || ''), { x: M, y: top, w: W - 2 * M, h: bodyH, fontFace: font, fontSize: 20, color: th.text, valign: 'top', paraSpaceAfter: 10, fit: 'shrink' });
    } else if (layout === 'image') {
      const p = s.image && x.resolvePath(typeof s.image === 'object' ? s.image.file : s.image);
      if (!p || !fs.existsSync(p)) throw new Error(`Slide ${i + 1}: picture not found (${s.image || 'none'})`);
      sl.addImage({ path: p, x: M, y: top, w: W - 2 * M, h: bodyH, sizing: { type: 'contain', w: W - 2 * M, h: bodyH } });
    } else if (!isCover) throw new Error(`Slide ${i + 1}: unknown layout “${layout}”`);

    if (!isCover && (footer || slides.length > 1)) {
      if (footer) sl.addText(footer, { x: M, y: H - 0.5, w: 8, h: 0.3, fontFace: font, fontSize: 10, color: th.muted, margin: 0 });
      sl.addText(String(i + 1), { x: W - M - 1, y: H - 0.5, w: 1, h: 0.3, fontFace: font, fontSize: 10, color: th.muted, align: 'right', margin: 0 });
    }
    if (s.speakerNotes || (s.notes && layout !== 'chart')) sl.addNotes(String(s.speakerNotes || s.notes));
  });

  const dest = x.resolvePath(w.path);
  if (!/\.pptx$/i.test(dest)) throw new Error('Save the deck as a .pptx file');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const buf = await pres.write({ outputType: 'nodebuffer' });
  fs.writeFileSync(dest, buf);
  x.log(`Made ${slides.length} slide${slides.length === 1 ? '' : 's'}: ${path.basename(dest)}`);
  return { file: dest, count: slides.length };
}

// ───────── report (HTML → PDF)
const escH = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function svgChart(t, s, acc) {
  const { labels, series } = chartSeries(t, s.x, s.y);
  const kind = s.chart || 'column';
  const pal = ['#' + acc, '#22B8CF', '#F59F00', '#E64980', '#51CF66', '#845EF7'];
  const Wd = 720, Hd = 300, pl = 56, pb = 46, pt = 14, pr = 16;
  if (kind === 'pie' || kind === 'doughnut') {
    const vals = series[0].values.map((v) => Math.max(0, v)); const tot = vals.reduce((a, b) => a + b, 0) || 1;
    let a0 = -Math.PI / 2; const cx = 150, cy = 150, r = 120, ri = kind === 'doughnut' ? 70 : 0;
    const arcs = vals.map((v, k) => { const a1 = a0 + (v / tot) * Math.PI * 2; const large = a1 - a0 > Math.PI ? 1 : 0; const p = (a, rr) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
      const d = ri ? `M${p(a0, r)} A${r},${r} 0 ${large} 1 ${p(a1, r)} L${p(a1, ri)} A${ri},${ri} 0 ${large} 0 ${p(a0, ri)}Z` : `M${cx},${cy} L${p(a0, r)} A${r},${r} 0 ${large} 1 ${p(a1, r)}Z`; a0 = a1; return `<path d="${d}" fill="${pal[k % pal.length]}" stroke="#fff" stroke-width="2"/>`; });
    const legend = labels.map((l, k) => `<div class="lg"><i style="background:${pal[k % pal.length]}"></i>${escH(l)} <b>${((vals[k] / tot) * 100).toFixed(1)}%</b></div>`).join('');
    return `<div class="pie"><svg viewBox="0 0 300 300" width="260" height="260">${arcs.join('')}</svg><div class="legend">${legend}</div></div>`;
  }
  const all = series.flatMap((se) => se.values); const max = Math.max(0, ...all); const min = Math.min(0, ...all);
  const nice = (v) => { if (v === 0) return 0; const e = 10 ** Math.floor(Math.log10(Math.abs(v))); return Math.ceil(v / e) * e; };
  const hi = nice(max) || 1, lo = min < 0 ? -nice(-min) : 0;
  const y = (v) => pt + (Hd - pt - pb) * (1 - (v - lo) / (hi - lo));
  const iw = Wd - pl - pr; const n = labels.length || 1; const bw = iw / n;
  const grid = [0, 1, 2, 3, 4].map((k) => { const v = lo + ((hi - lo) * k) / 4; return `<line x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}" stroke="#e7e5ee"/><text x="${pl - 8}" y="${y(v) + 4}" text-anchor="end">${escH(compactNum(v))}</text>`; }).join('');
  const skip = Math.ceil(n / 14);
  const xl = labels.map((l, k) => (k % skip ? '' : `<text x="${pl + bw * k + bw / 2}" y="${Hd - pb + 18}" text-anchor="middle">${escH(String(l).slice(0, 14))}</text>`)).join('');
  let marks = '';
  if (kind === 'line' || kind === 'area') {
    series.forEach((se, si) => { const pts = se.values.map((v, k) => `${pl + bw * k + bw / 2},${y(v)}`); const c = pal[si % pal.length];
      if (kind === 'area') marks += `<path d="M${pl + bw / 2},${y(lo)} L${pts.join(' L')} L${pl + bw * (n - 1) + bw / 2},${y(lo)}Z" fill="${c}" opacity=".18"/>`;
      marks += `<polyline points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/>` + se.values.map((v, k) => `<circle cx="${pl + bw * k + bw / 2}" cy="${y(v)}" r="3.5" fill="${c}"/>`).join(''); });
  } else {
    const gw = bw * 0.7; const sw = gw / series.length;
    series.forEach((se, si) => { se.values.forEach((v, k) => { const x0 = pl + bw * k + (bw - gw) / 2 + sw * si; const y0 = y(Math.max(0, v)); const h = Math.abs(y(v) - y(0)); marks += `<rect x="${x0}" y="${y0}" width="${Math.max(1, sw - 2)}" height="${Math.max(0.5, h)}" rx="3" fill="${pal[si % pal.length]}"/>`; if (series.length === 1 && n <= 12) marks += `<text x="${x0 + sw / 2 - 1}" y="${y0 - 5}" text-anchor="middle" class="dl">${escH(compactNum(v))}</text>`; }); });
  }
  const legend = series.length > 1 ? `<div class="legend row">${series.map((se, k) => `<div class="lg"><i style="background:${pal[k % pal.length]}"></i>${escH(se.name)}</div>`).join('')}</div>` : '';
  return `<svg class="chart" viewBox="0 0 ${Wd} ${Hd}" width="100%">${grid}${marks}${xl}</svg>${legend}`;
}
function compactNum(v) { const a = Math.abs(v); if (a >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'; if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; if (a >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; return Number.isInteger(v) ? String(v) : v.toFixed(1); }

function reportHTML(w, x) {
  const acc = hex(w.accent);
  const secs = [...normSlides(w.sections), ...normSlides(w.sectionsFrom)];
  const body = secs.map((s, i) => {
    const h = s.title ? `<h2>${escH(s.title)}</h2>` : '';
    switch (s.layout) {
      case 'title': return `<header class="cover"><h1>${escH(s.title)}</h1>${s.subtitle ? `<p>${escH(s.subtitle)}</p>` : ''}</header>`;
      case 'section': return `<div class="sect"><h2 class="big">${escH(s.title)}</h2>${s.subtitle ? `<p class="muted">${escH(s.subtitle)}</p>` : ''}</div>`;
      case 'kpis': return `<section>${h}<div class="kpis">${(s.items || []).map((it) => `<div class="kpi"><span>${escH(it.label)}</span><b>${escH(it.value)}</b>${it.delta != null && it.delta !== '' ? `<em class="${deltaTone(it.delta, it.good)}">${escH(it.delta)}${it.note ? ` <small>${escH(it.note)}</small>` : ''}</em>` : ''}</div>`).join('')}</div></section>`;
      case 'chart': if (s.table == null || typeof s.table === 'string') throw new Error(`Section ${i + 1}: the chart needs a table`); return `<section class="keep">${h}${svgChart(s.table, s, acc)}${s.notes ? `<ul class="notes">${asList(s.notes).map((n) => `<li>${escH(n)}</li>`).join('')}</ul>` : ''}</section>`;
      case 'table': { if (s.table == null || typeof s.table === 'string') throw new Error(`Section ${i + 1}: the table needs data`); const t = T.asTable(s.table); const cols = (Array.isArray(s.columns) ? s.columns : typeof s.columns === 'string' && s.columns ? s.columns.split(',').map((c) => c.trim()) : t.columns).filter((c) => t.columns.includes(c)); const max = Number(s.maxRows) || 50; const rows = t.rows.slice(0, max); const num = (c) => rows.every((r) => r[c] === '' || typeof r[c] === 'number');
        return `<section>${h}<table><thead><tr>${cols.map((c) => `<th class="${num(c) ? 'n' : ''}">${escH(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => { const v = r[c]; const cls = [num(c) ? 'n' : '', /change/i.test(c) && typeof v === 'number' && v ? (v > 0 ? 'good' : 'bad') : ''].join(' '); return `<td class="${cls}">${escH(fmtCell(v, c))}</td>`; }).join('')}</tr>`).join('')}</tbody></table>${t.rows.length > max ? `<p class="muted">+ ${t.rows.length - max} more rows</p>` : ''}</section>`; }
      case 'bullets': return `<section>${h}<ul>${asList(s.bullets).map((b) => `<li>${escH(b)}</li>`).join('')}</ul></section>`;
      case 'text': return `<section>${h}${String(s.text || '').split(/\n{2,}/).map((p) => `<p>${escH(p).replace(/\n/g, '<br>')}</p>`).join('')}</section>`;
      case 'image': { const p = s.image && x.resolvePath(s.image); if (!p || !fs.existsSync(p)) throw new Error(`Section ${i + 1}: picture not found`); const ext = path.extname(p).slice(1).toLowerCase().replace('jpg', 'jpeg'); return `<section class="keep">${h}<img src="data:image/${ext};base64,${fs.readFileSync(p).toString('base64')}"></section>`; }
      default: throw new Error(`Section ${i + 1}: unknown layout “${s.layout}”`);
    }
  }).join('\n');
  const head = (w.title || w.subtitle) ? `<header class="cover"><h1>${escH(w.title || '')}</h1>${w.subtitle ? `<p>${escH(w.subtitle)}</p>` : ''}</header>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escH(w.title || x.run.flow.name)}</title><style>
  @page { size: A4; margin: 16mm 15mm; }
  :root { --acc: #${acc}; }
  body { font: 11pt/1.5 -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #1b1a24; margin: 0 auto; max-width: 900px; padding: 28px; }
  @media print { body { padding: 0; } }
  .cover { border-left: 6px solid var(--acc); padding: 6px 0 6px 18px; margin: 0 0 26px; }
  .cover h1 { font-size: 26pt; margin: 0; letter-spacing: -.02em; } .cover p { margin: 4px 0 0; color: #6e6b80; font-size: 13pt; }
  h2 { font-size: 14pt; margin: 26px 0 10px; letter-spacing: -.01em; } h2.big { font-size: 20pt; color: var(--acc); }
  .muted { color: #6e6b80; } section { margin-bottom: 8px; } .keep { break-inside: avoid; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .kpi { border: 1px solid #e3e1ea; border-radius: 12px; padding: 12px 14px; background: #faf9fc; break-inside: avoid; }
  .kpi span { display: block; color: #6e6b80; font-size: 9.5pt; } .kpi b { display: block; font-size: 20pt; letter-spacing: -.02em; margin: 2px 0; }
  .kpi em, td.good, td.bad { font-style: normal; font-weight: 600; } .good { color: #1a9a5e; } .bad { color: #d6363b; } .flat { color: #6e6b80; } .kpi small { color: #6e6b80; font-weight: 400; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; } th { background: var(--acc); color: #fff; text-align: left; padding: 6px 8px; font-weight: 600; }
  td { padding: 5px 8px; border-bottom: 1px solid #ecebf1; } tr:nth-child(even) td { background: #faf9fc; } .n { text-align: right; font-variant-numeric: tabular-nums; }
  .chart text { font-size: 11px; fill: #6e6b80; } .chart .dl { fill: #1b1a24; font-weight: 600; font-size: 10.5px; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 9.5pt; } .lg { display: flex; align-items: center; gap: 6px; } .lg i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .pie { display: flex; align-items: center; gap: 24px; } .pie .legend { flex-direction: column; }
  ul.notes { margin-top: 8px; } img { max-width: 100%; border-radius: 8px; }
  footer { margin-top: 30px; color: #9a97aa; font-size: 8.5pt; }
  </style></head><body>${head}${body}<footer>Made by Cadence · ${escH(x.run.flow.name)} · ${new Date().toLocaleString()}</footer></body></html>`;
}
function reportMarkdown(w) {
  const secs = [...normSlides(w.sections), ...normSlides(w.sectionsFrom)];
  const out = [];
  if (w.title) out.push(`# ${w.title}`, ''); if (w.subtitle) out.push(`_${w.subtitle}_`, '');
  for (const s of secs) {
    if (s.layout === 'title') { out.push(`# ${s.title || ''}`, s.subtitle ? `_${s.subtitle}_` : '', ''); continue; }
    if (s.title) out.push(`## ${s.title}`, '');
    if (s.layout === 'kpis') out.push(...(s.items || []).map((it) => `- **${it.label}:** ${it.value}${it.delta ? ` (${it.delta})` : ''}`), '');
    if (s.layout === 'bullets') out.push(...asList(s.bullets).map((b) => `- ${b}`), '');
    if (s.layout === 'text') out.push(String(s.text || ''), '');
    if ((s.layout === 'table' || s.layout === 'chart') && s.table && typeof s.table === 'object') {
      const t = T.asTable(s.table); const cols = (Array.isArray(s.columns) && s.columns.length ? s.columns : t.columns);
      out.push(`| ${cols.join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`, ...t.rows.slice(0, Number(s.maxRows) || 50).map((r) => `| ${cols.map((c) => fmtCell(r[c], c)).join(' | ')} |`), '');
      if (s.notes) out.push(...asList(s.notes).map((b) => `- ${b}`), '');
    }
  }
  return out.join('\n');
}

async function makeReport(w, x) {
  const dest = x.resolvePath(w.path);
  if (!dest) throw new Error('Choose where to save the report');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ext = path.extname(dest).toLowerCase();
  if (ext === '.md') { fs.writeFileSync(dest, reportMarkdown(w)); x.log(`Wrote ${path.basename(dest)}`); return { file: dest }; }
  const html = reportHTML(w, x);
  if (ext === '.html' || ext === '.htm') { fs.writeFileSync(dest, html); x.log(`Wrote ${path.basename(dest)}`); return { file: dest }; }
  if (ext !== '.pdf') throw new Error('Save the report as .pdf, .html or .md');
  if (!x.services.pdf) throw new Error('PDF making isn’t available here');
  await x.services.pdf(html, dest);
  x.log(`Made ${path.basename(dest)}`);
  return { file: dest };
}

module.exports = { 'doc.slides': makeSlides, 'doc.report': makeReport };
module.exports._ = { reportHTML, reportMarkdown, chartSeries, normSlides, fmtCell, deltaTone };
