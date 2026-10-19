// Datum - native file format engine (runs in the main process)
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const ExcelJS = require('exceljs');
const PptxGenJS = require('pptxgenjs');
const JSZip = require('jszip');
const mammoth = require('mammoth');
const { XMLParser } = require('fast-xml-parser');
const { parse: parseHtml } = require('node-html-parser');
const docx = require('docx');

const uid = () => Math.random().toString(36).slice(2, 10);
const SUPPORTED = ['xlsx', 'xlsm', 'csv', 'tsv', 'pptx', 'docx', 'pdf', 'txt', 'md', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };

const extOf = (f) => path.extname(f).slice(1).toLowerCase();
const baseOf = (f) => path.basename(f, path.extname(f));
function isSupported(f) { return SUPPORTED.includes(extOf(f)); }

async function imageToDataUrl(fp) {
  const buf = await fsp.readFile(fp);
  return `data:${MIME[extOf(fp)] || 'application/octet-stream'};base64,${buf.toString('base64')}`;
}

// ============================================================ IMPORT
async function importFile(fp) {
  const list = await importFileInner(fp);
  list.forEach((s) => { if (s.type !== 'image') s.sourcePath = fp; });
  return list;
}
async function importFileInner(fp) {
  const ext = extOf(fp);
  const name = baseOf(fp);
  switch (ext) {
    case 'xlsx': case 'xlsm': return readXlsx(fp, name);
    case 'csv': case 'tsv': return [readCsv(await fsp.readFile(fp, 'utf8'), name, ext === 'tsv' ? '\t' : null)];
    case 'pptx': return [await readPptx(fp, name)];
    case 'docx': return [await readDocx(fp, name)];
    case 'pdf': return [{ id: uid(), type: 'docu', name, format: 'pdf', pdfOriginal: (await fsp.readFile(fp)).toString('base64'), html: '', view: 'pdf', edited: false }];
    case 'txt': case 'md': return [readText(await fsp.readFile(fp, 'utf8'), name, ext)];
    default:
      if (MIME[ext]) return [{ type: 'image', name, src: await imageToDataUrl(fp) }];
      throw new Error(`Unsupported file type .${ext}`);
  }
}

function emptyGrid(r, c) { return Array.from({ length: r }, () => Array(c).fill('')); }

const XL_PREFIX = /_xlfn\._xlws\.|_xlfn\.|_xlws\.|_xlpm\./g;
const cleanFormula = (f) => String(f).replace(XL_PREFIX, '').replace(/"(?:[^"]|"")*"|\b([A-Za-z][\w.]*)\(/g, (m, fn) => (fn ? fn.toUpperCase() + '(' : m));
// Excel dates arrive as JS Dates; broken ones (an invalid date in a formula result) become blank instead of failing the import
const isoDay = (d) => (d instanceof Date && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '');
function cellToRaw(cell) {
  const v = cell.value;
  if (v == null) return '';
  if (cell.formula) return '=' + cleanFormula(cell.formula);
  if (typeof v === 'object') {
    if (v.formula || v.sharedFormula) return '=' + cleanFormula(v.formula || cell.formula || '');
    if (v instanceof Date) return isoDay(v);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.error) return v.error;
    if (v.result != null) return String(v.result);
    return '';
  }
  return String(v);
}
// the value Excel last calculated for a formula cell (used if Datum can't compute that formula)
function cachedResult(cell) {
  const v = cell.value;
  if (!v || typeof v !== 'object' || !('result' in v)) return undefined;
  const r = v.result;
  if (r == null) return undefined;
  if (r instanceof Date) return isNaN(r.getTime()) ? undefined : isoDay(r);
  if (typeof r === 'object') { if (r.error) return r.error; if (r.richText) return r.richText.map((t) => t.text).join(''); if (r.text != null) return String(r.text); return undefined; }
  return r;
}
const quoteSheet = (name) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);
// rewrite Sheet1!A1 / 'My Sheet'!A1 to the names the sheets get inside Datum
function remapSheetRefs(formula, map) {
  return formula.replace(/"(?:[^"]|"")*"|'((?:[^']|'')+)'!|([A-Za-z_À-￿][\w.À-￿]*)!/g, (m, q, plain) => {
    if (m[0] === '"') return m;
    const nm = q != null ? q.replace(/''/g, "'") : plain;
    const to = map.get(nm.toLowerCase());
    return to ? quoteSheet(to) + '!' : m;
  });
}
const DYN_ARRAY = /\b(FILTER|SORT|SORTBY|UNIQUE|SEQUENCE|TRANSPOSE|TAKE|DROP|CHOOSECOLS|CHOOSEROWS|VSTACK|HSTACK|TEXTSPLIT|TOCOL|TOROW|RANDARRAY)\s*\(/i;
// Excel number format -> Datum style { fmt, dec, comma }
function numFmtToStyle(nf) {
  if (!nf || /^general$/i.test(nf)) return {};
  if (nf === '@') return { fmt: 'text' };
  const sec = nf.split(';')[0];
  const decM = /0\.(0+)/.exec(sec);
  const dec = decM ? decM[1].length : 0;
  const comma = /#,##|,0/.test(sec);
  if (/E\+/i.test(sec)) return { fmt: 'sci', dec };
  if (/%/.test(sec)) return { fmt: 'pct', dec };
  if (/[ymd]/i.test(sec.replace(/"[^"]*"/g, '')) && !/0/.test(sec.replace(/"[^"]*"/g, ''))) return { fmt: 'date' };
  if (/[$€£¥]/.test(sec)) return { fmt: /\(|_\(/.test(nf) ? 'acct' : 'cur', dec, comma };
  if (/0/.test(sec)) return dec ? { fmt: 'num', dec, comma } : { fmt: comma ? 'int' : 'num', dec: 0, comma };
  return {};
}
// Datum style -> Excel number format
function styleToNumFmt(st) {
  if (!st || !st.fmt) {
    if (st && st.dec != null) return '0' + (st.dec ? '.' + '0'.repeat(st.dec) : '');
    if (st && st.comma) return '#,##0.##';
    return null;
  }
  const d = (n) => (n ? '.' + '0'.repeat(n) : '');
  const defs = { num: [2, true], int: [0, true], cur: [2, true], cur0: [0, true], acct: [2, true], pct: [1, false], sci: [2, false] };
  const [dd, dc] = defs[st.fmt] || [0, false];
  const dec = st.dec != null ? st.dec : dd;
  const base = (st.comma != null ? st.comma : dc) ? '#,##0' : '0';
  switch (st.fmt) {
    case 'num': case 'int': return base + d(dec);
    case 'cur': case 'cur0': return '"$"' + base + d(dec);
    case 'acct': return `"$"${base}${d(dec)}_);("$"${base}${d(dec)})`;
    case 'pct': return '0' + d(dec) + '%';
    case 'sci': return '0' + d(dec) + 'E+00';
    case 'date': return 'mmm d, yyyy';
    case 'text': return '@';
  }
  return null;
}
function argbToHex(c) {
  if (!c || !c.argb) return null;
  return '#' + c.argb.slice(-6);
}

const CF_OPS = { greaterThan: 'gt', lessThan: 'lt', greaterThanOrEqual: 'gte', lessThanOrEqual: 'lte', between: 'between', equal: 'eq', notEqual: 'neq' };
const unq = (f) => (f == null ? '' : String(f).replace(/^"(.*)"$/, '$1'));
function importCf(ws) {
  const out = [];
  for (const cf of ws.conditionalFormattings || []) {
    for (const rule of cf.rules || []) {
      const st = rule.style || {};
      const fill = st.fill && argbToHex(st.fill.bgColor || st.fill.fgColor);
      const color = st.font && argbToHex(st.font.color);
      const base = { id: uid(), range: String(cf.ref).split(' ')[0] };
      const look = {}; if (fill) look.fill = fill; if (color) look.color = color; if (st.font && st.font.bold) look.bold = true;
      if (rule.type === 'cellIs' && CF_OPS[rule.operator]) out.push({ ...base, type: CF_OPS[rule.operator], v1: unq(rule.formulae && rule.formulae[0]), v2: unq(rule.formulae && rule.formulae[1]), ...look });
      else if (rule.type === 'containsText') out.push({ ...base, type: 'text', v1: rule.text, ...look });
      else if (rule.type === 'top10') out.push({ ...base, type: rule.bottom ? 'bottom' : 'top', v1: String(rule.rank || 10), ...look });
      else if (rule.type === 'aboveAverage') out.push({ ...base, type: rule.aboveAverage === false ? 'below' : 'above', ...look });
      else if (rule.type === 'expression') out.push({ ...base, type: 'formula', v1: '=' + ((rule.formulae && rule.formulae[0]) || 'FALSE'), ...look });
      else if (rule.type === 'colorScale') { const cols = (rule.color || []).map(argbToHex).filter(Boolean); if (cols.length >= 2) out.push({ ...base, type: cols.length >= 3 ? 'scale3' : 'scale2', colors: cols.slice(0, 3) }); }
      else if (rule.type === 'dataBar') out.push({ ...base, type: 'bars', barColor: argbToHex(rule.color) || '#5B8DEF' });
    }
  }
  return out;
}

async function readXlsx(fp, name) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fp);
  const sheets = [];
  const visible = wb.worksheets.filter((ws) => ws.state !== 'veryHidden');
  const multi = visible.length > 1;
  const nameMap = new Map(visible.map((ws) => [ws.name.toLowerCase(), multi ? `${name} · ${ws.name}` : name]));
  wb.worksheets.forEach((ws) => {
    if (ws.state === 'veryHidden') return;
    const cached = {};
    let dynamic = false;
    const rows = Math.min(Math.max(ws.actualRowCount ? ws.rowCount : 0, 1), 150000);
    const cols = Math.min(Math.max(ws.columnCount, 1), 200);
    const cells = emptyGrid(Math.max(rows + 10, 60), Math.max(cols + 2, 14));
    const styles = {};
    const rowHeights = {};
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      if (r > 150000) return;
      if (row.height && Math.abs(row.height - 15) > 0.6) rowHeights[r - 1] = Math.round(row.height * 96 / 72);
      row.eachCell({ includeEmpty: false }, (cell, c) => { try { readCell(cell, c); } catch (e) { console.error('Skipped cell', ws.name, r, c, e.message); } });
      function readCell(cell, c) {
        if (c > 200) return;
        let raw = cellToRaw(cell);
        if (raw[0] === '=') {
          raw = remapSheetRefs(raw, nameMap);
          const cv = cachedResult(cell);
          if (cv !== undefined) cached[`${r - 1},${c - 1}`] = cv;
          if (DYN_ARRAY.test(raw)) dynamic = true;
        }
        cells[r - 1][c - 1] = raw;
        const st = {};
        const font = cell.font || {};
        if (font.bold) st.b = true;
        if (font.italic) st.i = true;
        if (font.underline) st.u = true;
        if (font.strike) st.s = true;
        const fc = argbToHex(font.color);
        if (fc && fc !== '#000000') st.color = fc;
        if (cell.fill && cell.fill.type === 'pattern' && cell.fill.pattern === 'solid') {
          const bg = argbToHex(cell.fill.fgColor);
          if (bg && bg !== '#FFFFFF') st.fill = bg;
        }
        Object.assign(st, numFmtToStyle(cell.numFmt));
        const al = cell.alignment || {};
        if (['center', 'right', 'left'].includes(al.horizontal)) st.align = al.horizontal;
        if (al.vertical === 'middle' || al.vertical === 'top') st.valign = al.vertical;
        if (al.wrapText) st.wrap = true;
        const bd = cell.border || {};
        const has = (x) => x && x.style && x.style !== 'none';
        if (has(bd.top) || has(bd.bottom) || has(bd.left) || has(bd.right)) {
          const side = (x) => {
            if (!has(x)) return undefined;
            const c = argbToHex(x.color);
            const st2 = x.style;
            if (st2 === 'thin' && (!c || c === '#000000')) return true;
            return { w: /thick/.test(st2) ? 3 : /medium/.test(st2) ? 2 : 1, s: st2 === 'double' ? 'double' : /dash/i.test(st2) ? 'dashed' : /dot|hair/i.test(st2) ? 'dotted' : 'solid', c: c || '#1F2937' };
          };
          st.bd = {};
          [['t', bd.top], ['b', bd.bottom], ['l', bd.left], ['r', bd.right]].forEach(([k, x]) => { const v = side(x); if (v) st.bd[k] = v; });
        }
        if (Object.keys(st).length) styles[`${r - 1},${c - 1}`] = st;
      }
    });
    const colWidths = {};
    (ws.columns || []).forEach((col, i) => { if (col && col.width) colWidths[i] = Math.round(Math.min(Math.max(col.width * 7.5, 30), 600)); });
    const merges = ((ws.model && ws.model.merges) || []).filter((m) => /^[A-Z]+\d+:[A-Z]+\d+$/.test(m));
    const colIdx = (s) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    for (const m of merges) { // merged-away cells hold copies of the anchor in exceljs - clear them
      const g = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m);
      const r1 = +g[2] - 1, r2 = +g[4] - 1, c1 = colIdx(g[1]), c2 = colIdx(g[3]);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { if (r === r1 && c === c1) continue; if (cells[r]) cells[r][c] = ''; delete styles[`${r},${c}`]; }
    }
    let filter = null;
    if (ws.autoFilter) {
      const af = typeof ws.autoFilter === 'string' ? ws.autoFilter : ws.autoFilter.from && ws.autoFilter.to ? `${typeof ws.autoFilter.from === 'string' ? ws.autoFilter.from : ''}:${typeof ws.autoFilter.to === 'string' ? ws.autoFilter.to : ''}` : '';
      if (/^[A-Z]+\d+:[A-Z]+\d+$/.test(af)) filter = { range: af, cols: {} };
    }
    let cf = [];
    try { cf = importCf(ws); } catch (e) { console.error('cf import', e.message); }
    sheets.push({
      id: uid(), type: 'data',
      name: multi ? `${name} · ${ws.name}` : name,
      wsName: ws.name,
      ...(ws.state === 'hidden' || ws.state === 'veryHidden' ? { hidden: true } : {}),
      cells, styles, colWidths, rowHeights, merges, cf, filter, cached,
      ...(dynamic ? { absorbSpill: true } : {}),
      frozen: ws.views && ws.views[0] && ws.views[0].state === 'frozen' ? (ws.views[0].ySplit || 0) : 0
    });
  });
  // workbook-level named ranges (e.g. TaxRate, SalesData) become project names
  try {
    const names = {};
    for (const dn of (wb.definedNames && wb.definedNames.model) || []) {
      if (!dn.name || /^_xlnm\./i.test(dn.name) || !dn.ranges || !dn.ranges.length) continue;
      names[dn.name] = remapSheetRefs(dn.ranges[0], nameMap);
    }
    if (Object.keys(names).length && sheets[0]) sheets[0].names = names;
  } catch (e) { console.error('names', e.message); }
  if (!sheets.length) sheets.push({ id: uid(), type: 'data', name, cells: emptyGrid(60, 14), styles: {}, colWidths: {} });
  return sheets;
}

function parseDelimited(text, delim) {
  if (!delim) {
    const first = text.split(/\r?\n/, 1)[0] || '';
    delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t'
      : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  }
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function readCsv(text, name, delim) {
  const rows = parseDelimited(text.replace(/^﻿/, ''), delim).slice(0, 150000);
  const cols = Math.max(14, ...rows.map((r) => r.length));
  const cells = emptyGrid(Math.max(60, rows.length + 10), cols);
  rows.forEach((r, i) => r.forEach((v, j) => { cells[i][j] = v; }));
  const styles = {};
  if (rows.length) rows[0].forEach((_, j) => { styles[`0,${j}`] = { b: true }; });
  return { id: uid(), type: 'data', name, cells, styles, colWidths: {} };
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function readText(text, name, ext) {
  let html = '';
  if (ext === 'md') {
    let list = null;
    for (const line of text.split(/\r?\n/)) {
      const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
      const li = line.match(/^\s*[-*]\s+(.*)/) || null;
      const oli = line.match(/^\s*\d+\.\s+(.*)/) || null;
      if ((li || oli) && !list) { list = li ? 'ul' : 'ol'; html += `<${list}>`; }
      if (!(li || oli) && list) { html += `</${list}>`; list = null; }
      const h = line.match(/^(#{1,3})\s+(.*)/);
      if (h) html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
      else if (li || oli) html += `<li>${inline((li || oli)[1])}</li>`;
      else if (line.trim()) html += `<p>${inline(line)}</p>`;
    }
    if (list) html += `</${list}>`;
  } else {
    html = text.split(/\r?\n\s*\r?\n/).map((p) => `<p>${esc(p).replace(/\r?\n/g, '<br>')}</p>`).join('');
  }
  return { id: uid(), type: 'docu', name, format: 'docx', html };
}

async function readDocx(fp, name) {
  const r = await mammoth.convertToHtml({ path: fp }, {
    styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='Quote'] => blockquote:fresh"]
  });
  return { id: uid(), type: 'docu', name, format: 'docx', html: r.value || '<p></p>' };
}

// ---------------- PPTX reader
const ARR = new Set(['p:sp', 'p:pic', 'p:graphicFrame', 'p:grpSp', 'p:cxnSp', 'a:p', 'a:r', 'a:fld', 'a:br', 'a:tr', 'a:tc', 'a:gridCol', 'c:ser', 'c:pt', 'Relationship', 'p:sldId']);
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', isArray: (n) => ARR.has(n), textNodeName: '#t', parseTagValue: false, trimValues: false });
const asArr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

async function zipXml(zip, p) {
  const f = zip.file(p);
  if (!f) return null;
  return xml.parse(await f.async('string'));
}
function relsPath(p) { const d = path.posix.dirname(p); return `${d}/_rels/${path.posix.basename(p)}.rels`; }
async function readRels(zip, p) {
  const r = await zipXml(zip, relsPath(p));
  const map = {};
  for (const rel of asArr(r && r.Relationships && r.Relationships.Relationship)) {
    const t = rel['@Target'] || '';
    map[rel['@Id']] = { target: t.startsWith('/') ? t.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(p), t)), type: rel['@Type'] || '', external: rel['@TargetMode'] === 'External' };
  }
  return map;
}

function colorOf(node, theme) {
  if (!node) return null;
  if (node['a:srgbClr']) return '#' + node['a:srgbClr']['@val'];
  if (node['a:schemeClr']) {
    const v = node['a:schemeClr']['@val'];
    const alias = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' }[v] || v;
    return theme[alias] || null;
  }
  if (node['a:sysClr']) return '#' + (node['a:sysClr']['@lastClr'] || '000000');
  return null;
}

async function readTheme(zip) {
  const files = Object.keys(zip.files).filter((f) => /^ppt\/theme\/theme\d+\.xml$/.test(f)).sort();
  const theme = { dk1: '#000000', lt1: '#FFFFFF', dk2: '#1F2937', lt2: '#E5E7EB', accent1: '#1F6BFF', accent2: '#00A3FF', accent3: '#7C3AED', accent4: '#10B981', accent5: '#F59E0B', accent6: '#EF4444' };
  if (!files.length) return theme;
  const t = await zipXml(zip, files[0]);
  const cs = t && t['a:theme'] && t['a:theme']['a:themeElements'] && t['a:theme']['a:themeElements']['a:clrScheme'];
  if (cs) for (const k of Object.keys(theme)) { const c = colorOf(cs[`a:${k}`], {}); if (c) theme[k] = c; }
  return theme;
}

function xfrmOf(spPr) {
  const x = spPr && (spPr['a:xfrm'] || spPr['p:xfrm']);
  if (!x || !x['a:off']) return null;
  return { x: +x['a:off']['@x'], y: +x['a:off']['@y'], w: +x['a:ext']['@cx'], h: +x['a:ext']['@cy'] };
}
function phOf(sp) {
  const nv = sp['p:nvSpPr'] || sp['p:nvPicPr'] || sp['p:nvGraphicFramePr'];
  const ph = nv && nv['p:nvPr'] && nv['p:nvPr']['p:ph'];
  if (!ph) return null;
  return { type: ph['@type'] || 'body', idx: ph['@idx'] };
}
async function placeholderMap(zip, layoutPath) {
  const map = { byIdx: {}, byType: {} };
  const add = (tree) => {
    for (const sp of asArr(tree && tree['p:sp'])) {
      const ph = phOf(sp); const xf = xfrmOf(sp['p:spPr']);
      if (!ph || !xf) continue;
      const lvl1 = sp['p:txBody'] && sp['p:txBody']['a:lstStyle'] && sp['p:txBody']['a:lstStyle']['a:lvl1pPr'];
      const sz = lvl1 && lvl1['a:defRPr'] && lvl1['a:defRPr']['@sz'];
      const info = { ...xf, sz: sz ? +sz / 100 : null };
      if (ph.idx != null && !map.byIdx[ph.idx]) map.byIdx[ph.idx] = info;
      if (!map.byType[ph.type]) map.byType[ph.type] = info;
    }
  };
  if (!layoutPath) return map;
  const lay = await zipXml(zip, layoutPath);
  add(lay && lay['p:sldLayout'] && lay['p:sldLayout']['p:cSld'] && lay['p:sldLayout']['p:cSld']['p:spTree']);
  const lrels = await readRels(zip, layoutPath);
  const master = Object.values(lrels).find((r) => /slideMaster/.test(r.type));
  if (master) {
    const m = await zipXml(zip, master.target);
    add(m && m['p:sldMaster'] && m['p:sldMaster']['p:cSld'] && m['p:sldMaster']['p:cSld']['p:spTree']);
  }
  return map;
}

function textOfBody(txBody, theme) {
  const lines = [];
  let style = {};
  let bullets = false;
  for (const p of asArr(txBody && txBody['a:p'])) {
    const runs = [...asArr(p['a:r']), ...asArr(p['a:fld'])];
    const t = runs.map((r) => (typeof r['a:t'] === 'object' ? (r['a:t']['#t'] || '') : (r['a:t'] ?? ''))).join('');
    lines.push(t);
    const ppr = p['a:pPr'] || {};
    if (ppr['a:buChar'] || ppr['a:buAutoNum']) bullets = true;
    if (!style.align && ppr['@algn']) style.align = { ctr: 'center', r: 'right', just: 'left', l: 'left' }[ppr['@algn']] || 'left';
    const rpr = (runs[0] && runs[0]['a:rPr']) || {};
    if (!style.fontSize && rpr['@sz']) style.fontSize = Math.round(+rpr['@sz'] / 100);
    if (style.bold == null && rpr['@b'] != null) style.bold = rpr['@b'] === '1';
    if (style.italic == null && rpr['@i'] != null) style.italic = rpr['@i'] === '1';
    if (!style.color) { const c = colorOf(rpr['a:solidFill'], theme); if (c) style.color = c; }
    if (!style.fontFace && rpr['a:latin'] && !/^\+/.test(rpr['a:latin']['@typeface'])) style.fontFace = rpr['a:latin']['@typeface'];
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const bp = txBody && txBody['a:bodyPr'];
  if (bp && bp['@anchor']) style.valign = { t: 'top', ctr: 'middle', b: 'bottom' }[bp['@anchor']] || 'top';
  return { text: lines.join('\n'), style, bullets };
}

async function readChartPart(zip, target) {
  const c = await zipXml(zip, target);
  const pa = c && c['c:chartSpace'] && c['c:chartSpace']['c:chart'] && c['c:chartSpace']['c:chart']['c:plotArea'];
  if (!pa) return null;
  const kinds = { 'c:barChart': 'bar', 'c:bar3DChart': 'bar', 'c:lineChart': 'line', 'c:line3DChart': 'line', 'c:pieChart': 'pie', 'c:pie3DChart': 'pie', 'c:doughnutChart': 'doughnut', 'c:areaChart': 'area', 'c:area3DChart': 'area' };
  for (const [k, type] of Object.entries(kinds)) {
    const node = pa[k];
    if (!node) continue;
    let chartType = type;
    if (type === 'bar' && node['c:barDir'] && node['c:barDir']['@val'] === 'bar') chartType = 'hbar';
    const series = [];
    let labels = [];
    for (const s of asArr(node['c:ser'])) {
      const nameRef = s['c:tx'] && (s['c:tx']['c:strRef'] && s['c:tx']['c:strRef']['c:strCache']);
      const name = nameRef ? asArr(nameRef['c:pt']).map((p) => p['c:v']).join(' ') : `Series ${series.length + 1}`;
      const ccat = s['c:cat'] || {};
      const cat = ccat['c:strRef'] || ccat['c:numRef'] || ccat['c:strLit'] || ccat['c:numLit'] || ccat['c:multiLvlStrRef'];
      let catCache = cat && (cat['c:strCache'] || cat['c:numCache'] || cat['c:multiLvlStrCache'] || cat);
      if (catCache && catCache['c:lvl']) catCache = asArr(catCache['c:lvl'])[0];
      if (catCache && !labels.length) labels = asArr(catCache['c:pt']).sort((a, b) => a['@idx'] - b['@idx']).map((p) => String(p['c:v']));
      const val = s['c:val'] && (s['c:val']['c:numRef'] || s['c:val']['c:numLit']);
      const vc = val && (val['c:numCache'] || val);
      series.push({ name, values: asArr(vc && vc['c:pt']).sort((a, b) => a['@idx'] - b['@idx']).map((p) => +p['c:v']) });
    }
    const titleNode = c['c:chartSpace']['c:chart']['c:title'];
    let title = '';
    if (titleNode) {
      const rich = titleNode['c:tx'] && titleNode['c:tx']['c:rich'];
      if (rich) title = textOfBody(rich, {}).text;
    }
    if (!labels.length && series[0]) labels = series[0].values.map((_, i) => String(i + 1));
    return { chartType, labels, series, title };
  }
  return null;
}

async function readPptx(fp, name) {
  const zip = await JSZip.loadAsync(await fsp.readFile(fp));
  const pres = await zipXml(zip, 'ppt/presentation.xml');
  const sz = pres['p:presentation']['p:sldSz'];
  const cx = +(sz && sz['@cx']) || 12192000, cy = +(sz && sz['@cy']) || 6858000;
  const S = 960 / cx;
  const size = { w: 960, h: Math.round(cy * S) };
  const theme = await readTheme(zip);
  const prels = await readRels(zip, 'ppt/presentation.xml');
  const ids = asArr(pres['p:presentation']['p:sldIdLst'] && pres['p:presentation']['p:sldIdLst']['p:sldId']);
  const slides = [];
  const px = (v) => Math.round(v * S);

  for (const sid of ids) {
    const rel = prels[sid['@r:id']];
    if (!rel) continue;
    const sp = rel.target;
    const sx = await zipXml(zip, sp);
    const sld = sx['p:sld'];
    if (sld['@show'] === '0') continue;
    const rels = await readRels(zip, sp);
    const layout = Object.values(rels).find((r) => /slideLayout/.test(r.type));
    const phMap = await placeholderMap(zip, layout && layout.target);
    const slide = { id: uid(), bg: '#FFFFFF', elements: [], notes: '' };
    const bgPr = sld['p:cSld']['p:bg'] && sld['p:cSld']['p:bg']['p:bgPr'];
    const bgc = bgPr && colorOf(bgPr['a:solidFill'], theme);
    if (bgc) slide.bg = bgc;

    const walk = async (tree, tf) => {
      const T = (b) => (tf ? { x: tf.ox + (b.x - tf.cx) * tf.sx, y: tf.oy + (b.y - tf.cy) * tf.sy, w: b.w * tf.sx, h: b.h * tf.sy } : b);
      const box = (b) => ({ x: px(b.x), y: px(b.y), w: Math.max(px(b.w), 8), h: Math.max(px(b.h), 8) });
      for (const pic of asArr(tree['p:pic'])) {
        const xf = xfrmOf(pic['p:spPr']) || (() => { const ph = phOf(pic); return ph && (phMap.byIdx[ph.idx] || phMap.byType[ph.type]); })();
        const blip = pic['p:blipFill'] && pic['p:blipFill']['a:blip'];
        const r = blip && rels[blip['@r:embed']];
        if (!xf || !r || r.external) continue;
        const f = zip.file(r.target);
        const ext = extOf(r.target);
        if (!f || !MIME[ext]) continue;
        slide.elements.push({ id: uid(), type: 'image', ...box(T(xf)), src: `data:${MIME[ext]};base64,${await f.async('base64')}` });
      }
      for (const s of asArr(tree['p:sp'])) {
        const ph = phOf(s);
        let xf = xfrmOf(s['p:spPr']);
        const phInfo = ph && (phMap.byIdx[ph.idx] || phMap.byType[ph.type]);
        if (!xf && phInfo) xf = phInfo;
        if (!xf) continue;
        const { text, style, bullets } = textOfBody(s['p:txBody'], theme);
        const fill = colorOf(s['p:spPr'] && s['p:spPr']['a:solidFill'], theme);
        const geom = s['p:spPr'] && s['p:spPr']['a:prstGeom'] && s['p:spPr']['a:prstGeom']['@prst'];
        const isTitle = ph && /title|ctrTitle/i.test(ph.type);
        if (!style.fontSize) style.fontSize = (phInfo && phInfo.sz) || (isTitle ? 36 : ph ? 20 : 18);
        if (isTitle && style.bold == null) style.bold = true;
        if (!style.color) style.color = '#111827';
        if (ph && ph.type === 'body' && text) style.bullets = bullets || true;
        else if (bullets) style.bullets = true;
        if (!text.trim()) {
          if (!fill || ph) continue;
          slide.elements.push({ id: uid(), type: 'shape', shape: geom === 'ellipse' ? 'ellipse' : geom === 'roundRect' ? 'roundRect' : 'rect', ...box(T(xf)), style: { fill, color: '#FFFFFF', fontSize: 18 }, text: '' });
          continue;
        }
        if (fill) style.fill = fill;
        if (isTitle && !style.valign) style.valign = 'middle';
        slide.elements.push({ id: uid(), type: 'text', ...box(T(xf)), text, style });
      }
      for (const g of asArr(tree['p:graphicFrame'])) {
        const xf = xfrmOf({ 'a:xfrm': g['p:xfrm'] });
        if (!xf) continue;
        const gd = g['a:graphic'] && g['a:graphic']['a:graphicData'];
        if (gd && gd['a:tbl']) {
          const rows = asArr(gd['a:tbl']['a:tr']).map((tr) => asArr(tr['a:tc']).map((tc) => textOfBody(tc['a:txBody'], theme).text));
          slide.elements.push({ id: uid(), type: 'table', ...box(T(xf)), staticRows: rows, style: { fontSize: 12 } });
        } else if (gd && gd['c:chart']) {
          const r = rels[gd['c:chart']['@r:id']];
          const ch = r && (await readChartPart(zip, r.target));
          if (ch) slide.elements.push({ id: uid(), type: 'chart', ...box(T(xf)), chartType: ch.chartType, title: ch.title, staticData: { labels: ch.labels, series: ch.series } });
        }
      }
      for (const grp of asArr(tree['p:grpSp'])) {
        const gx = grp['p:grpSpPr'] && grp['p:grpSpPr']['a:xfrm'];
        if (!gx || !gx['a:off']) { await walk(grp, tf); continue; }
        const o = T({ x: +gx['a:off']['@x'], y: +gx['a:off']['@y'], w: +gx['a:ext']['@cx'], h: +gx['a:ext']['@cy'] });
        const ch = { x: +gx['a:chOff']['@x'], y: +gx['a:chOff']['@y'], w: +gx['a:chExt']['@cx'] || 1, h: +gx['a:chExt']['@cy'] || 1 };
        await walk(grp, { ox: o.x, oy: o.y, cx: ch.x, cy: ch.y, sx: o.w / ch.w, sy: o.h / ch.h });
      }
    };
    await walk(sld['p:cSld']['p:spTree'], null);

    const notesRel = Object.values(rels).find((r) => /notesSlide/.test(r.type));
    if (notesRel) {
      const n = await zipXml(zip, notesRel.target);
      const tree = n && n['p:notes'] && n['p:notes']['p:cSld']['p:spTree'];
      for (const s of asArr(tree && tree['p:sp'])) {
        const ph = phOf(s);
        if (ph && ph.type === 'body') slide.notes = textOfBody(s['p:txBody'], theme).text;
      }
    }
    slides.push(slide);
  }
  if (!slides.length) slides.push({ id: uid(), bg: '#FFFFFF', elements: [], notes: '' });
  return { id: uid(), type: 'slide', name, size, slides };
}

// ============================================================ EXPORT: XLSX
const argb = (hex) => 'FF' + String(hex || '#000000').replace('#', '').slice(0, 6).toUpperCase();
const CF_OUT = { gt: 'greaterThan', lt: 'lessThan', gte: 'greaterThanOrEqual', lte: 'lessThanOrEqual', between: 'between', eq: 'equal', neq: 'notEqual' };
const colLetters = (c) => { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
function cfRuleOut(rule, priority) {
  const style = {};
  if (rule.color || rule.bold) style.font = { color: rule.color ? { argb: argb(rule.color) } : undefined, bold: !!rule.bold };
  if (rule.fill) style.fill = { type: 'pattern', pattern: 'solid', bgColor: { argb: argb(rule.fill) } };
  const lit = (v) => (v !== '' && v != null && !isNaN(+v) ? String(+v) : `"${String(v ?? '').replace(/"/g, '""')}"`);
  const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i.exec(rule.range || '');
  const tl = m ? `${m[1]}${m[2]}` : 'A1';
  const absR = m ? `$${m[1]}$${m[2]}:$${m[3] || m[1]}$${m[4] || m[2]}` : '$A$1';
  switch (rule.type) {
    case 'gt': case 'lt': case 'gte': case 'lte': case 'eq': case 'neq': return { type: 'cellIs', operator: CF_OUT[rule.type], formulae: [lit(rule.v1)], style, priority };
    case 'between': return { type: 'cellIs', operator: 'between', formulae: [lit(rule.v1), lit(rule.v2)], style, priority };
    case 'neg': return { type: 'cellIs', operator: 'lessThan', formulae: ['0'], style, priority };
    case 'text': return { type: 'containsText', operator: 'containsText', text: String(rule.v1 || ''), style, priority };
    case 'top': case 'bottom': return { type: 'top10', rank: parseInt(rule.v1) || 10, bottom: rule.type === 'bottom', style, priority };
    case 'above': case 'below': return { type: 'aboveAverage', aboveAverage: rule.type === 'above', style, priority };
    case 'dup': return { type: 'expression', formulae: [`AND(${tl}<>"",COUNTIF(${absR},${tl})>1)`], style, priority };
    case 'unique': return { type: 'expression', formulae: [`AND(${tl}<>"",COUNTIF(${absR},${tl})=1)`], style, priority };
    case 'blank': return { type: 'expression', formulae: [`LEN(TRIM(${tl}))=0`], style, priority };
    case 'notblank': return { type: 'expression', formulae: [`LEN(TRIM(${tl}))>0`], style, priority };
    case 'formula': return { type: 'expression', formulae: [String(rule.v1 || 'FALSE').replace(/^=/, '')], style, priority };
    case 'scale2': return { type: 'colorScale', priority, cfvo: [{ type: 'min' }, { type: 'max' }], color: (rule.colors || ['#FFFFFF', '#5A8AC6']).map((c) => ({ argb: argb(c) })) };
    case 'scale3': return { type: 'colorScale', priority, cfvo: [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }], color: (rule.colors || ['#F8696B', '#FFEB84', '#63BE7B']).map((c) => ({ argb: argb(c) })) };
    case 'bars': return { type: 'dataBar', priority, minLength: 0, maxLength: 100, cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: argb(rule.barColor || '#5B8DEF') }, gradient: true };
  }
  return null;
}

// newer Excel functions must carry the _xlfn. prefix inside the file or Excel shows #NAME?
const XLFN = ['T.DIST', 'T.DIST.RT', 'T.DIST.2T', 'T.INV', 'T.INV.2T', 'T.TEST', 'CHISQ.DIST', 'CHISQ.DIST.RT', 'CHISQ.INV', 'CHISQ.INV.RT', 'CHISQ.TEST', 'F.DIST', 'F.DIST.RT', 'F.INV', 'F.INV.RT', 'GAMMA', 'GAMMA.DIST', 'GAMMA.INV', 'GAMMALN.PRECISE', 'BETA.DIST', 'BETA.INV', 'LOGNORM.DIST', 'LOGNORM.INV', 'WEIBULL.DIST', 'BINOM.INV', 'BINOM.DIST.RANGE', 'NEGBINOM.DIST', 'HYPGEOM.DIST', 'PHI', 'GAUSS', 'SKEW.P', 'Z.TEST', 'CONFIDENCE.T', 'PERCENTRANK.EXC', 'PERMUTATIONA', 'COMBINA', 'ACOT', 'ACOTH', 'COTH', 'CSCH', 'SECH', 'MUNIT', 'BITAND', 'BITOR', 'BITXOR', 'BITLSHIFT', 'BITRSHIFT', 'ENCODEURL', 'SHEET', 'ERF.PRECISE', 'ERFC.PRECISE', 'ISO.CEILING', 'WORKDAY.INTL', 'PERCENTOF', 'TRIMRANGE', 'WRAPCOLS', 'CONCAT', 'TEXTJOIN', 'IFS', 'SWITCH', 'MAXIFS', 'MINIFS', 'XLOOKUP', 'XMATCH', 'IFNA', 'FORMULATEXT', 'ISFORMULA', 'DAYS', 'ISOWEEKNUM', 'CEILING.MATH', 'FLOOR.MATH', 'CEILING.PRECISE', 'FLOOR.PRECISE', 'NUMBERVALUE', 'UNICHAR', 'UNICODE', 'STDEV.S', 'STDEV.P', 'VAR.S', 'VAR.P', 'MODE.SNGL', 'MODE.MULT', 'PERCENTILE.INC', 'PERCENTILE.EXC', 'QUARTILE.INC', 'QUARTILE.EXC', 'PERCENTRANK.INC', 'RANK.EQ', 'RANK.AVG', 'NORM.DIST', 'NORM.INV', 'NORM.S.DIST', 'NORM.S.INV', 'COVARIANCE.P', 'COVARIANCE.S', 'FORECAST.LINEAR', 'CONFIDENCE.NORM', 'EXPON.DIST', 'POISSON.DIST', 'BINOM.DIST', 'LET', 'AGGREGATE', 'BASE', 'DECIMAL', 'ARABIC', 'COT', 'CSC', 'SEC', 'PDURATION', 'RRI', 'TEXTBEFORE', 'TEXTAFTER', 'VALUETOTEXT', 'ARRAYTOTEXT', 'REGEXTEST', 'REGEXEXTRACT', 'REGEXREPLACE', 'NETWORKDAYS.INTL'];
const XLFN_RE = new RegExp('"(?:[^"]|"")*"|\\b(' + XLFN.map((f) => f.replace('.', '\\.')).sort((a, b) => b.length - a.length).join('|') + ')\\s*\\(', 'gi');
const xlPrefix = (f) => String(f).replace(XLFN_RE, (m, fn) => (fn ? '_xlfn.' + fn.toUpperCase() + '(' : m));

async function writeXlsx(sheet, ex) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Datum';
  const ws = wb.addWorksheet(sheet.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  const values = (ex && ex.values) || [];
  const cells = sheet.cells || [];
  const styles = sheet.styles || {};
  let maxR = 0, maxC = 0;
  cells.forEach((row, r) => row.forEach((v, c) => { if ((v !== '' && v != null) || styles[`${r},${c}`]) { maxR = Math.max(maxR, r + 1); maxC = Math.max(maxC, c + 1); } }));
  (sheet.merges || []).forEach((m) => { const g = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m); if (g) maxR = Math.max(maxR, +g[4]); });
  for (let r = 0; r < maxR; r++) {
    for (let c = 0; c < maxC; c++) {
      const raw = (cells[r] && cells[r][c]) ?? '';
      const st = styles[`${r},${c}`];
      const spilled = raw === '' && values[r] && values[r][c] !== '' && values[r][c] != null;
      if (raw === '' && !st && !spilled) continue;
      const cell = ws.getCell(r + 1, c + 1);
      const val = values[r] && values[r][c];
      const t = String(raw).trim();
      if (spilled) cell.value = typeof val === 'number' ? val : String(val);
      else if (raw === '') { /* styled empty cell */ }
      else if (st && st.fmt === 'text') cell.value = raw;
      else if (raw.startsWith('=')) {
        const result = typeof val === 'number' || typeof val === 'boolean' ? val : (val == null ? '' : /^#/.test(String(val)) ? { error: String(val) } : String(val));
        const out = ex && ex.formulas ? ex.formulas[`${r},${c}`] : raw.slice(1);
        if (out) cell.value = { formula: xlPrefix(out), result: typeof result === 'object' ? undefined : result };
        else cell.value = typeof result === 'object' ? result.error : result;
      } else if (/^[-+]?[\d,]*\.?\d+(e[-+]?\d+)?$/i.test(t) && !isNaN(+t.replace(/,/g, ''))) {
        cell.value = +t.replace(/,/g, '');
      } else if (/^-?\$[\d,]+(\.\d+)?$/.test(t)) {
        cell.value = +t.replace(/[$,]/g, '');
        if (!st || !st.fmt) cell.numFmt = '"$"#,##0.00';
      } else if (/^-?[\d.]+%$/.test(t)) {
        cell.value = parseFloat(t) / 100;
        if (!st || !st.fmt) cell.numFmt = '0.0%';
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
        const [y, mo, d] = t.split('-').map(Number);
        cell.value = new Date(Date.UTC(y, mo - 1, d));
        cell.numFmt = st && st.fmt === 'date' ? 'mmm d, yyyy' : 'yyyy-mm-dd';
      } else cell.value = raw;
      if (st) {
        if (st.b || st.i || st.u || st.s || st.color) cell.font = { bold: !!st.b, italic: !!st.i, underline: !!st.u, strike: !!st.s, color: st.color ? { argb: argb(st.color) } : undefined };
        if (st.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(st.fill) } };
        const nf = styleToNumFmt(st);
        if (nf) cell.numFmt = nf;
        if (st.align || st.valign || st.wrap) cell.alignment = { horizontal: st.align, vertical: st.valign, wrapText: !!st.wrap };
        if (st.bd) {
          const line = (b) => {
            if (!b) return undefined;
            if (b === true) return { style: 'thin', color: { argb: 'FF1F2937' } };
            const style = b.s === 'double' ? 'double' : b.s === 'dashed' ? (b.w >= 2 ? 'mediumDashed' : 'dashed') : b.s === 'dotted' ? 'dotted' : b.w === 3 ? 'thick' : b.w === 2 ? 'medium' : 'thin';
            return { style, color: { argb: argb(b.c || '#1F2937') } };
          };
          cell.border = { top: line(st.bd.t), bottom: line(st.bd.b), left: line(st.bd.l), right: line(st.bd.r) };
        }
      }
    }
  }
  for (let c = 0; c < maxC; c++) {
    const w = (sheet.colWidths || {})[c];
    ws.getColumn(c + 1).width = w ? Math.round(w / 7.5) : 13;
  }
  for (const [r, px] of Object.entries(sheet.rowHeights || {})) ws.getRow(+r + 1).height = Math.round(px * 72 / 96);
  for (const r of (ex && ex.hiddenRows) || []) ws.getRow(r + 1).hidden = true;
  for (const m of sheet.merges || []) { try { ws.mergeCells(m); } catch (e) { console.error('merge', m, e.message); } }
  if (sheet.filter && sheet.filter.range) ws.autoFilter = sheet.filter.range;
  (sheet.cf || []).forEach((rule, i) => {
    const out = cfRuleOut(rule, i + 1);
    if (out && rule.range) ws.addConditionalFormatting({ ref: rule.range, rules: [out] });
  });
  if (sheet.frozen) ws.views = [{ state: 'frozen', ySplit: sheet.frozen }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ============================================================ EXPORT: PPTX
const hex = (c, d = '000000') => (c ? String(c).replace('#', '').slice(0, 6).toUpperCase() : d);
async function writePptx(sheet, ex, brand = {}) {
  const pres = new PptxGenJS();
  const size = sheet.size || { w: 960, h: 540 };
  const W = size.w / 96, H = size.h / 96;
  pres.defineLayout({ name: 'DATUM', width: W, height: H });
  pres.layout = 'DATUM';
  pres.author = 'Datum';
  pres.title = sheet.name;
  const I = (v) => v / 96;
  const slides = (ex && ex.slides) || [];
  for (const s of slides) {
    const slide = pres.addSlide();
    slide.background = s.bgImage ? { data: s.bgImage } : { color: hex(s.bg, 'FFFFFF') };
    if (s.notes) slide.addNotes(s.notes);
    for (const e of s.elements) {
      const pos = { x: I(e.x), y: I(e.y), w: I(e.w), h: I(e.h) };
      const st = e.style || {};
      const textOpts = {
        ...pos,
        fontSize: st.fontSize || 18,
        color: hex(st.color, '111827'),
        bold: !!st.bold,
        italic: !!st.italic,
        underline: st.underline ? { style: 'sng' } : undefined,
        align: st.align || 'left',
        valign: st.valign || 'top',
        fontFace: st.fontFace || brand.font || 'Calibri',
        margin: 6,
        lineSpacingMultiple: st.lineHeight || 1.1
      };
      if (e.rotate) textOpts.rotate = e.rotate;
      try {
        if (e.type === 'text') {
          if (st.fill) textOpts.fill = { color: hex(st.fill) };
          if (st.bullets) {
            const parts = e.text.split('\n').map((t) => ({ text: t, options: { bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 6 } }));
            slide.addText(parts, textOpts);
          } else slide.addText(e.text, textOpts);
        } else if (e.type === 'shape') {
          const shapeName = { rect: pres.ShapeType.rect, roundRect: pres.ShapeType.roundRect, ellipse: pres.ShapeType.ellipse, line: pres.ShapeType.line }[e.shape] || pres.ShapeType.rect;
          const opts = { ...textOpts, fill: e.shape === 'line' ? undefined : { color: hex(st.fill, '1F6BFF') }, line: st.stroke ? { color: hex(st.stroke), width: st.strokeWidth || 1 } : (e.shape === 'line' ? { color: hex(st.fill, '1F6BFF'), width: st.strokeWidth || 2 } : undefined), rectRadius: e.shape === 'roundRect' ? 0.12 : undefined, color: hex(st.color, 'FFFFFF'), align: st.align || 'center', valign: st.valign || 'middle' };
          if (e.text) slide.addText(e.text, { ...opts, shape: shapeName });
          else slide.addShape(shapeName, opts);
        } else if (e.type === 'image' && e.src) {
          const img = { ...pos, data: e.src };
          if (e.fit === 'cover') img.sizing = { type: 'cover', w: pos.w, h: pos.h };
          const minDim = Math.min(pos.w, pos.h);
          if (st.radius && st.radius >= Math.min(e.w, e.h) / 2) img.rounding = true;
          if (st.shadow) img.shadow = { type: 'outer', blur: 10, offset: 4, angle: 90, color: '0F172A', opacity: 0.3 };
          slide.addImage(img);
          if (st.borderWidth) {
            const circle = st.radius && st.radius >= Math.min(e.w, e.h) / 2;
            const bw = st.borderWidth * 0.75; // px -> pt
            slide.addShape(circle ? pres.ShapeType.ellipse : st.radius ? pres.ShapeType.roundRect : pres.ShapeType.rect, {
              x: pos.x + bw / 144, y: pos.y + bw / 144, w: pos.w - bw / 72, h: pos.h - bw / 72,
              fill: { color: 'FFFFFF', transparency: 100 },
              line: { color: hex(st.borderColor, 'FFFFFF'), width: bw },
              rectRadius: st.radius && !circle ? Math.min(st.radius / 96, minDim / 2) : undefined
            });
          }
        } else if (e.type === 'table' && e.rows && e.rows.length) {
          const hdrFill = hex(st.headerFill || brand.primary, '1F6BFF');
          const rows = e.rows.map((row, ri) => row.map((cell) => ({
            text: String(cell ?? ''),
            options: ri === 0 && st.header !== false
              ? { bold: true, color: 'FFFFFF', fill: { color: hdrFill } }
              : { color: '1F2937', fill: { color: ri % 2 === 0 ? 'F3F6FB' : 'FFFFFF' } }
          })));
          slide.addTable(rows, { ...pos, fontSize: st.fontSize || 12, fontFace: textOpts.fontFace, border: { type: 'solid', pt: 0.5, color: 'D6DDEA' }, autoPage: false, margin: 4 });
        } else if (e.type === 'chart' && e.data && e.data.series && e.data.series.length) {
          const t = e.chartType || 'bar';
          const map = { bar: 'bar', hbar: 'bar', stacked: 'bar', line: 'line', area: 'area', pie: 'pie', doughnut: 'doughnut', scatter: 'scatter', combo: 'bar' };
          const series = (t === 'pie' || t === 'doughnut') ? e.data.series.slice(0, 1) : e.data.series;
          const data = series.map((s) => ({ name: s.name, labels: e.data.labels.map(String), values: s.values.map((v) => (isFinite(v) ? +v : 0)) }));
          let colors = (e.colors || []).map((c) => hex(c));
          if (series.length === 1 && !(t === 'pie' || t === 'doughnut')) colors = [colors[0] || '1F6BFF'];
          slide.addChart(pres.ChartType[map[t]], data, {
            ...pos,
            barDir: t === 'hbar' ? 'bar' : 'col',
            barGrouping: t === 'stacked' ? 'stacked' : 'clustered',
            chartColors: colors.length ? colors : ['1F6BFF', '00A3FF', '7C3AED', '10B981', 'F59E0B', 'EF4444'],
            showLegend: series.length > 1 || t === 'pie' || t === 'doughnut',
            legendPos: 'b',
            legendFontSize: 10,
            showTitle: !!e.title,
            title: e.title || undefined,
            titleFontSize: 13,
            titleColor: '1F2937',
            catAxisLabelFontSize: 10,
            valAxisLabelFontSize: 10,
            valGridLine: { color: 'E5E9F2', size: 0.5 },
            catGridLine: { style: 'none' },
            showValue: !!e.showValues,
            dataLabelFontSize: 9,
            lineSize: 2,
            lineDataSymbolSize: 6,
            holeSize: 60
          });
        } else if (e.type === 'kpi') {
          if (st.fill) textOpts.fill = { color: hex(st.fill) };
          const parts = [
            { text: e.label || '', options: { fontSize: Math.max(10, Math.round((st.fontSize || 32) * 0.36)), color: '6B7280', breakLine: true, bold: false } },
            { text: e.value || '-', options: { fontSize: st.fontSize || 32, bold: true, color: hex(st.color, '111827'), breakLine: !!e.delta } }
          ];
          if (e.delta) parts.push({ text: e.delta, options: { fontSize: Math.max(10, Math.round((st.fontSize || 32) * 0.36)), color: e.deltaUp ? '059669' : 'DC2626' } });
          slide.addText(parts, { ...textOpts, valign: 'middle' });
        }
      } catch (err) {
        console.error('pptx element failed', e.type, err.message);
      }
    }
  }
  return Buffer.from(await pres.write({ outputType: 'nodebuffer' }));
}

// ============================================================ EXPORT: DOCX
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, ImageRun, PageBreak, ShadingType, BorderStyle, LevelFormat, ExternalHyperlink } = docx;

function dataUrlInfo(src) {
  const m = /^data:image\/(png|jpe?g|gif|bmp);base64,(.*)$/i.exec(src || '');
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  let w = 600, h = 400;
  const t = m[1].toLowerCase();
  try {
    if (t === 'png') { w = buf.readUInt32BE(16); h = buf.readUInt32BE(20); }
    else if (t === 'gif') { w = buf.readUInt16LE(6); h = buf.readUInt16LE(8); }
    else if (t.startsWith('jp')) {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) break;
        const mk = buf[i + 1], len = buf.readUInt16BE(i + 2);
        if (mk >= 0xc0 && mk <= 0xc3) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; }
        i += 2 + len;
      }
    }
  } catch {}
  return { buf, type: t === 'jpeg' ? 'jpg' : t, w, h };
}
function styleOf(el) {
  const s = (el.getAttribute && el.getAttribute('style')) || '';
  const o = {};
  s.split(';').forEach((kv) => { const [k, v] = kv.split(':'); if (k && v) o[k.trim().toLowerCase()] = v.trim(); });
  return o;
}
function alignOf(el) {
  const a = styleOf(el)['text-align'] || (el.getAttribute && el.getAttribute('align'));
  return { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED }[a] || undefined;
}
function cssColor(c) {
  if (!c) return undefined;
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.slice(1);
  if (/^#[0-9a-f]{3}$/i.test(c)) return c.slice(1).split('').map((x) => x + x).join('');
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if (m) return [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('');
  return undefined;
}

function inlineRuns(node, fmt = {}) {
  const out = [];
  for (const ch of node.childNodes) {
    if (ch.nodeType === 3) {
      const t = ch.text.replace(/\s+/g, ' ');
      if (t) out.push(new TextRun({ text: decodeEntities(t), bold: fmt.b, italics: fmt.i, underline: fmt.u ? {} : undefined, color: fmt.color, strike: fmt.s, size: fmt.size }));
      continue;
    }
    if (ch.nodeType !== 1) continue;
    const tag = ch.rawTagName && ch.rawTagName.toLowerCase();
    const st = styleOf(ch);
    const f = { ...fmt };
    if (tag === 'b' || tag === 'strong' || /bold|[6-9]00/.test(st['font-weight'] || '')) f.b = true;
    if (tag === 'i' || tag === 'em' || st['font-style'] === 'italic') f.i = true;
    if (tag === 'u' || /underline/.test(st['text-decoration'] || '')) f.u = true;
    if (tag === 's' || tag === 'strike' || tag === 'del') f.s = true;
    if (st.color) f.color = cssColor(st.color) || f.color;
    if (tag === 'br') { out.push(new TextRun({ text: '', break: 1 })); continue; }
    if (tag === 'img') { const im = imageRun(ch, 300); if (im) out.push(im); continue; }
    if (tag === 'a') {
      const href = ch.getAttribute('href');
      if (href && /^https?:/.test(href)) { out.push(new ExternalHyperlink({ link: href, children: [new TextRun({ text: decodeEntities(ch.text), style: 'Hyperlink' })] })); continue; }
    }
    out.push(...inlineRuns(ch, f));
  }
  return out;
}
function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
function imageRun(img, maxW = 600) {
  const info = dataUrlInfo(img.getAttribute('src'));
  if (!info) return null;
  let w = +img.getAttribute('width') || +(styleOf(img).width || '').replace('px', '') || info.w;
  let h = info.h * (w / info.w);
  if (w > maxW) { h = h * (maxW / w); w = maxW; }
  return new ImageRun({ type: info.type, data: info.buf, transformation: { width: Math.round(w), height: Math.round(h) } });
}
function tableOf(tbl) {
  const rows = tbl.querySelectorAll('tr');
  if (!rows.length) return null;
  const n = Math.max(...rows.map((r) => r.querySelectorAll('td,th').length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((tr, ri) => new TableRow({
      tableHeader: ri === 0,
      children: [...tr.querySelectorAll('td,th'), ...Array(Math.max(0, n - tr.querySelectorAll('td,th').length)).fill(null)].map((td) => {
        const head = td && (td.rawTagName.toLowerCase() === 'th' || ri === 0 && tbl.classList && tbl.classList.contains('dt'));
        return new TableCell({
          shading: head ? { type: ShadingType.CLEAR, color: 'auto', fill: '1F6BFF' } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({ children: td ? (head ? [new TextRun({ text: decodeEntities(td.text.trim()), bold: true, color: 'FFFFFF' })] : inlineRuns(td)) : [] })]
        });
      })
    })),
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'D6DDEA' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D6DDEA' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'D6DDEA' }, right: { style: BorderStyle.SINGLE, size: 4, color: 'D6DDEA' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'D6DDEA' }, insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'D6DDEA' }
    }
  });
}

function blocksOf(node, out, ctx = {}) {
  for (const el of node.childNodes) {
    if (el.nodeType === 3) {
      const t = el.text.trim();
      if (t) out.push(new Paragraph({ children: [new TextRun(decodeEntities(t))] }));
      continue;
    }
    if (el.nodeType !== 1) continue;
    const tag = el.rawTagName.toLowerCase();
    const cls = el.classList ? [...el.classList.values()] : [];
    if (/^h[1-6]$/.test(tag)) {
      const lvl = Math.min(+tag[1], 4);
      out.push(new Paragraph({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][lvl - 1], alignment: alignOf(el), children: inlineRuns(el) }));
    } else if (tag === 'p' || (tag === 'div' && !cls.includes('pagebreak') && !el.querySelector('p,h1,h2,h3,table,ul,ol,figure,div'))) {
      out.push(new Paragraph({ alignment: alignOf(el), spacing: { after: 120 }, children: inlineRuns(el) }));
    } else if (tag === 'blockquote') {
      out.push(new Paragraph({ style: 'Quote', children: inlineRuns(el, { i: true }) }));
    } else if (tag === 'ul' || tag === 'ol') {
      for (const li of el.childNodes.filter((c) => c.nodeType === 1 && c.rawTagName.toLowerCase() === 'li')) {
        const nested = li.childNodes.filter((c) => c.nodeType === 1 && /^(ul|ol)$/i.test(c.rawTagName));
        nested.forEach((n) => n.remove());
        const lvl = ctx.level || 0;
        out.push(new Paragraph(tag === 'ol'
          ? { numbering: { reference: 'datum-num', level: lvl }, children: inlineRuns(li) }
          : { bullet: { level: lvl }, children: inlineRuns(li) }));
        nested.forEach((n) => blocksOf({ childNodes: [n] }, out, { level: (ctx.level || 0) + 1 }));
      }
    } else if (tag === 'table') {
      const t = tableOf(el); if (t) { out.push(t); out.push(new Paragraph({ children: [] })); }
    } else if (tag === 'img') {
      const im = imageRun(el); if (im) out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [im] }));
    } else if (tag === 'hr' || cls.includes('pagebreak')) {
      out.push(new Paragraph({ children: [new PageBreak()] }));
    } else if (tag === 'figure') {
      blocksOf(el, out, ctx);
    } else if (tag === 'figcaption') {
      out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: inlineRuns(el, { i: true, color: '6B7280', size: 18 }) }));
    } else if (tag === 'br') {
      out.push(new Paragraph({ children: [] }));
    } else {
      blocksOf(el, out, ctx);
    }
  }
  return out;
}

async function writeDocx(html, brand = {}) {
  const root = parseHtml(`<div>${html || ''}</div>`);
  const children = blocksOf(root.firstChild, []);
  const font = brand.docFont || 'Calibri';
  const accent = hex(brand.primary, '1F6BFF');
  const doc = new Document({
    creator: 'Datum',
    styles: {
      default: { document: { run: { font, size: 22, color: '1F2937' } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', run: { size: 40, bold: true, color: '0B1530', font }, paragraph: { spacing: { before: 240, after: 160 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', run: { size: 30, bold: true, color: accent, font }, paragraph: { spacing: { before: 220, after: 120 } } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', run: { size: 25, bold: true, color: '0B1530', font }, paragraph: { spacing: { before: 180, after: 100 } } },
        { id: 'Quote', name: 'Quote', basedOn: 'Normal', run: { italics: true, color: '4B5563' }, paragraph: { indent: { left: 540 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: accent, space: 12 } } } }
      ]
    },
    numbering: {
      config: [{ reference: 'datum-num', levels: [0, 1, 2].map((l) => ({ level: l, format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][l], text: `%${l + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (l + 1), hanging: 360 } } } })) }]
    },
    sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children: children.length ? children : [new Paragraph('')] }]
  });
  return Packer.toBuffer(doc);
}

module.exports = { importFile, isSupported, imageToDataUrl, writeXlsx, writePptx, writeDocx, parseDelimited };
