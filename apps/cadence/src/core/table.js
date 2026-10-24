// Cadence — tables. A table is { columns: [...], rows: [{ col: value }] }.
// Reading CSV / Excel / JSON, writing CSV / Excel, transforms (filter, group, compute…) and week-over-week compares.
'use strict';
const fs = require('fs');
const path = require('path');
const { parseDate } = require('./dates');

const isTable = (t) => !!t && Array.isArray(t.columns) && Array.isArray(t.rows);
function asTable(v) {
  if (isTable(v)) return v;
  if (v && isTable(v.table)) return v.table;
  if (Array.isArray(v)) return fromObjects(v);
  if (v && typeof v === 'object') return fromObjects([v]);
  throw new Error('Expected a table here. Pick a step that outputs data (Read data, Transform, Browser › Extract table).');
}
function fromObjects(arr) {
  const cols = []; const seen = new Set();
  const rows = arr.map((o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : { value: o }));
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  return { columns: cols, rows };
}

// ───────── values
function num(v) {
  if (typeof v === 'number') return v;
  if (v == null || v === '') return NaN;
  let s = String(v).trim();
  const neg = /^\(.*\)$/.test(s); if (neg) s = s.slice(1, -1);
  const pct = s.endsWith('%');
  s = s.replace(/[$£€¥,\s%]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
  let n = Number(s); if (pct) n /= 100; return neg ? -n : n;
}
const isNum = (v) => !isNaN(num(v));
function autoType(v) {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (s === '' || !/\d/.test(s) || s.length > 30) return v;
  if (!/^\(?[-+]?[$£€]?\s*(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?\)?%?$/.test(s)) return v;
  const digits = s.replace(/[^\d.]/g, '');
  if (/^0\d/.test(digits)) return v; // zip codes, IDs with leading zeros stay text
  const n = num(s);
  return isNaN(n) ? v : n;
}
const cmpVals = (a, b) => {
  const na = num(a), nb = num(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  const da = looksDate(a) ? parseDate(a) : null, db = looksDate(b) ? parseDate(b) : null;
  if (da && db && !isNaN(da) && !isNaN(db)) return da - db;
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
};
const looksDate = (v) => v instanceof Date || /^\d{4}-\d{2}-\d{2}|^\d{1,2}\/\d{1,2}\/\d{2,4}|^[A-Z][a-z]{2,8} \d{1,2},? \d{4}/.test(String(v ?? ''));

// ───────── CSV
function detectDelimiter(text) {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n');
  const c = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let q = false; for (const ch of head) { if (ch === '"') q = !q; else if (!q && ch in c) c[ch]++; }
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] : ',';
}
function parseCSV(text, { delimiter, header = true, types = true, skip = 0 } = {}) {
  text = String(text).replace(/^﻿/, '');
  const d = delimiter || detectDelimiter(text);
  const rows = []; let row = []; let f = ''; let q = false; let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
      f += ch; i++; continue;
    }
    if (ch === '"' && f === '') { q = true; i++; continue; }
    if (ch === d) { row.push(f); f = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++; continue; }
    f += ch; i++;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const data = rows.slice(skip).filter((r) => r.some((x) => String(x).trim() !== ''));
  return fromMatrix(data, { header, types });
}
function fromMatrix(data, { header = true, types = true } = {}) {
  if (!data.length) return { columns: [], rows: [] };
  const width = Math.max(...data.map((r) => r.length));
  let cols = header ? data[0].map((c, i) => String(c ?? '').trim() || `Column ${i + 1}`) : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  while (cols.length < width) cols.push(`Column ${cols.length + 1}`);
  const seen = {}; cols = cols.map((c) => { if (seen[c]) { seen[c]++; return `${c} ${seen[c]}`; } seen[c] = 1; return c; });
  const body = header ? data.slice(1) : data;
  return { columns: cols, rows: body.map((r) => Object.fromEntries(cols.map((c, i) => [c, types ? autoType(r[i] ?? '') : (r[i] ?? '')]))) };
}
function toCSV(t, { delimiter = ',' } = {}) {
  t = asTable(t);
  const cell = (v) => { if (v == null) return ''; if (v instanceof Date) v = v.toISOString().slice(0, 10); const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n\r]/.test(s) || s.includes(delimiter) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [t.columns.map(cell).join(delimiter), ...t.rows.map((r) => t.columns.map((c) => cell(r[c])).join(delimiter))].join('\n') + '\n';
}

// ───────── Excel (exceljs)
async function readXLSX(file, { sheet, header = true, types = true, skip = 0 } = {}) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = sheet ? (wb.getWorksheet(sheet) || wb.worksheets[Number(sheet) - 1]) : wb.worksheets[0];
  if (!ws) throw new Error(`No sheet called “${sheet}” in ${path.basename(file)}. Sheets: ${wb.worksheets.map((w) => w.name).join(', ')}`);
  const data = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = [];
    row.eachCell({ includeEmpty: true }, (c, col) => { vals[col - 1] = cellValue(c.value); });
    data.push(Array.from(vals, (v) => (v === undefined ? '' : v)));
  });
  return fromMatrix(data.slice(skip), { header, types });
}
function cellValue(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);
    if (v.richText) return v.richText.map((x) => x.text).join('');
    if ('text' in v) return v.text;
    if (v.error) return '';
  }
  return v;
}
async function writeXLSX(file, sheets) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook(); wb.creator = 'Cadence'; wb.created = new Date();
  for (const { name, table } of sheets) {
    const t = asTable(table);
    const ws = wb.addWorksheet(String(name || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = t.columns.map((c) => ({ header: c, key: c, width: Math.min(48, Math.max(10, String(c).length + 2, ...t.rows.slice(0, 200).map((r) => String(r[c] ?? '').length + 2))) }));
    for (const r of t.rows) ws.addRow(Object.fromEntries(t.columns.map((c) => [c, r[c]])));
    const head = ws.getRow(1); head.font = { bold: true, color: { argb: 'FFFFFFFF' } }; head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4B3A8C' } };
    t.columns.forEach((c, i) => { if (t.rows.length && t.rows.every((r) => r[c] === '' || typeof r[c] === 'number')) ws.getColumn(i + 1).numFmt = t.rows.some((r) => typeof r[c] === 'number' && !Number.isInteger(r[c])) ? '#,##0.00' : '#,##0'; });
    if (t.columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columns.length } };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await wb.xlsx.writeFile(file);
  return file;
}

// ───────── read any data file
async function readDataFile(file, opts = {}) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.xlsx' || ext === '.xlsm') return readXLSX(file, opts);
  if (ext === '.xls') throw new Error('Old .xls files can’t be read. Save it as .xlsx or CSV first (or have the site export CSV).');
  if (ext === '.json') {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const pick = opts.jsonPath ? require('./template').get(j, opts.jsonPath) : j;
    const arr = Array.isArray(pick) ? pick : Array.isArray(pick?.data) ? pick.data : Array.isArray(pick?.rows) ? pick.rows : Array.isArray(pick?.items) ? pick.items : [pick];
    return fromObjects(arr.map(flatten));
  }
  return parseCSV(fs.readFileSync(file, 'utf8'), { delimiter: ext === '.tsv' ? '\t' : opts.delimiter, header: opts.header !== false, types: opts.types !== false, skip: opts.skip || 0 });
}
function flatten(o, pre = '', out = {}) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) { out[pre || 'value'] = Array.isArray(o) ? o.join(', ') : o; return out; }
  for (const [k, v] of Object.entries(o)) { const key = pre ? `${pre}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out); else out[key] = Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)).join(', ') : v; }
  return out;
}

// ───────── safe formulas: [Revenue] / [Orders] * 100, round([A] / [B], 2), if([A] > 0, [B], 0)
function compileFormula(src) {
  const toks = []; const s = String(src); let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '[') { const e = s.indexOf(']', i); if (e < 0) throw new Error('Missing ] in formula'); toks.push({ t: 'col', v: s.slice(i + 1, e) }); i = e + 1; continue; }
    if (/[\d.]/.test(ch)) { let j = i; while (j < s.length && /[\d.]/.test(s[j])) j++; toks.push({ t: 'num', v: Number(s.slice(i, j)) }); i = j; continue; }
    if (/["']/.test(ch)) { const e = s.indexOf(ch, i + 1); if (e < 0) throw new Error('Unclosed quote in formula'); toks.push({ t: 'str', v: s.slice(i + 1, e) }); i = e + 1; continue; }
    if (/[A-Za-z_]/.test(ch)) { let j = i; while (j < s.length && /\w/.test(s[j])) j++; toks.push({ t: 'id', v: s.slice(i, j).toLowerCase() }); i = j; continue; }
    const two = s.slice(i, i + 2);
    if (['>=', '<=', '==', '!=', '<>', '&&', '||'].includes(two)) { toks.push({ t: 'op', v: two === '<>' ? '!=' : two }); i += 2; continue; }
    if ('+-*/%()<>,&='.includes(ch)) { toks.push({ t: 'op', v: ch === '=' ? '==' : ch }); i++; continue; }
    throw new Error(`Can’t read “${ch}” in formula`);
  }
  let p = 0;
  const peek = () => toks[p]; const take = () => toks[p++];
  const expect = (v) => { const t = take(); if (!t || t.v !== v) throw new Error(`Expected “${v}” in formula`); };
  const FN = {
    round: (a, d = 0) => { const m = 10 ** d; return Math.round(a * m) / m; }, abs: Math.abs, min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil,
    if: (c, a, b) => (c ? a : b), pct: (a, b) => (b ? (a / b) * 100 : 0), change: (a, b) => (b ? (a - b) / Math.abs(b) : 0), len: (a) => String(a ?? '').length,
    upper: (a) => String(a ?? '').toUpperCase(), lower: (a) => String(a ?? '').toLowerCase(), concat: (...a) => a.join(''), num: (a) => (isNaN(num(a)) ? 0 : num(a)),
  };
  const prec = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '&': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7 };
  function primary() {
    const t = take(); if (!t) throw new Error('Formula ends too soon');
    if (t.t === 'num') return () => t.v;
    if (t.t === 'str') return () => t.v;
    if (t.t === 'col') return (r) => { const v = r[t.v]; const n = num(v); return isNaN(n) ? (v ?? '') : n; };
    if (t.t === 'op' && t.v === '(') { const e = expr(0); expect(')'); return e; }
    if (t.t === 'op' && t.v === '-') { const e = primary(); return (r) => -e(r); }
    if (t.t === 'id') {
      if (t.v === 'true') return () => true; if (t.v === 'false') return () => false;
      const f = FN[t.v]; if (!f) throw new Error(`Unknown function “${t.v}”`);
      expect('('); const args = [];
      if (!(peek() && peek().v === ')')) { args.push(expr(0)); while (peek() && peek().v === ',') { take(); args.push(expr(0)); } }
      expect(')');
      return (r) => f(...args.map((a) => a(r)));
    }
    throw new Error(`Unexpected “${t.v}” in formula`);
  }
  function expr(minP) {
    let left = primary();
    while (peek() && peek().t === 'op' && prec[peek().v] && prec[peek().v] > minP) {
      const op = take().v; const right = expr(prec[op]); const l = left;
      left = (r) => { const a = l(r), b = right(r); switch (op) {
        case '+': return (typeof a === 'string' || typeof b === 'string') && (isNaN(num(a)) || isNaN(num(b))) ? String(a) + String(b) : (num(a) || 0) + (num(b) || 0);
        case '-': return (num(a) || 0) - (num(b) || 0); case '*': return (num(a) || 0) * (num(b) || 0);
        case '/': return num(b) ? (num(a) || 0) / num(b) : 0; case '%': return num(b) ? (num(a) || 0) % num(b) : 0;
        case '&': return String(a ?? '') + String(b ?? '');
        case '==': return cmpVals(a, b) === 0; case '!=': return cmpVals(a, b) !== 0; case '<': return cmpVals(a, b) < 0; case '>': return cmpVals(a, b) > 0; case '<=': return cmpVals(a, b) <= 0; case '>=': return cmpVals(a, b) >= 0;
        case '&&': return a && b; case '||': return a || b; default: return 0; } };
    }
    return left;
  }
  const fn = expr(0);
  if (p < toks.length) throw new Error(`Unexpected “${toks[p].v}” in formula`);
  return (row) => { const v = fn(row); return typeof v === 'number' && !isFinite(v) ? 0 : v; };
}

// ───────── aggregation
const AGG = {
  sum: (vs) => vs.reduce((a, v) => a + (isNum(v) ? num(v) : 0), 0),
  avg: (vs) => { const n = vs.filter(isNum); return n.length ? n.reduce((a, v) => a + num(v), 0) / n.length : 0; },
  min: (vs) => { const n = vs.filter(isNum).map(num); return n.length ? Math.min(...n) : ''; },
  max: (vs) => { const n = vs.filter(isNum).map(num); return n.length ? Math.max(...n) : ''; },
  count: (vs) => vs.length,
  countDistinct: (vs) => new Set(vs.map((v) => String(v))).size,
  first: (vs) => vs[0] ?? '', last: (vs) => vs[vs.length - 1] ?? '',
  median: (vs) => { const n = vs.filter(isNum).map(num).sort((a, b) => a - b); if (!n.length) return ''; const m = n.length >> 1; return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; },
};
const roundish = (v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v);

function group(t, by = [], aggregates = []) {
  by = (Array.isArray(by) ? by : [by]).filter(Boolean);
  const aggs = aggregates.length ? aggregates : t.columns.filter((c) => !by.includes(c) && t.rows.some((r) => typeof r[c] === 'number')).map((c) => ({ column: c, fn: 'sum' }));
  const groups = new Map();
  for (const r of t.rows) { const k = JSON.stringify(by.map((b) => r[b])); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  if (!by.length && !groups.size) groups.set('[]', []);
  const name = (a) => a.as || (a.fn === 'sum' || !a.fn ? a.column : a.fn === 'count' ? (a.column ? `${a.column} (count)` : 'Count') : `${a.column} (${a.fn})`);
  const cols = [...by, ...aggs.map(name)];
  const rows = [...groups.values()].map((rs) => {
    const o = {}; by.forEach((b) => { o[b] = rs[0][b]; });
    for (const a of aggs) { const f = AGG[a.fn || 'sum']; if (!f) throw new Error(`Unknown total “${a.fn}”`); o[name(a)] = roundish(f(a.column ? rs.map((r) => r[a.column]) : rs)); }
    return o;
  });
  return { columns: cols, rows };
}

// ───────── transforms
function testRow(r, f) {
  const v = r[f.column]; const want = f.value;
  switch (f.test || 'equals') {
    case 'equals': return cmpVals(v, want) === 0 || String(v).toLowerCase() === String(want).toLowerCase();
    case 'notEquals': return !(cmpVals(v, want) === 0 || String(v).toLowerCase() === String(want).toLowerCase());
    case 'contains': return String(v ?? '').toLowerCase().includes(String(want ?? '').toLowerCase());
    case 'notContains': return !String(v ?? '').toLowerCase().includes(String(want ?? '').toLowerCase());
    case 'startsWith': return String(v ?? '').toLowerCase().startsWith(String(want ?? '').toLowerCase());
    case 'gt': return cmpVals(v, want) > 0; case 'gte': return cmpVals(v, want) >= 0;
    case 'lt': return cmpVals(v, want) < 0; case 'lte': return cmpVals(v, want) <= 0;
    case 'between': return cmpVals(v, want) >= 0 && cmpVals(v, f.value2) <= 0;
    case 'empty': return v == null || String(v).trim() === ''; case 'notEmpty': return !(v == null || String(v).trim() === '');
    case 'in': return String(want ?? '').split(',').map((x) => x.trim().toLowerCase()).includes(String(v ?? '').toLowerCase());
    case 'matches': try { return new RegExp(want, 'i').test(String(v ?? '')); } catch { throw new Error(`“${want}” isn’t a valid pattern`); }
    default: throw new Error(`Unknown test “${f.test}”`);
  }
}
function needCols(t, cols, op) { for (const c of cols) if (c && !t.columns.includes(c)) throw new Error(`${op}: there’s no column “${c}”. Columns: ${t.columns.join(', ')}`); }

function transform(table, ops = []) {
  let t = { columns: [...asTable(table).columns], rows: asTable(table).rows.map((r) => ({ ...r })) };
  const formulas = {}; // computed columns are re-computed on total rows instead of summed
  for (const o of ops) {
    if (!o || o.off) continue;
    switch (o.op) {
      case 'filter': needCols(t, [o.column], 'Keep rows'); t.rows = t.rows.filter((r) => testRow(r, o)); break;
      case 'exclude': needCols(t, [o.column], 'Remove rows'); t.rows = t.rows.filter((r) => !testRow(r, o)); break;
      case 'select': { const cs = (o.columns || []).filter(Boolean); needCols(t, cs, 'Pick columns'); t.columns = cs; t.rows = t.rows.map((r) => Object.fromEntries(cs.map((c) => [c, r[c]]))); break; }
      case 'drop': { const cs = o.columns || []; t.columns = t.columns.filter((c) => !cs.includes(c)); t.rows = t.rows.map((r) => Object.fromEntries(t.columns.map((c) => [c, r[c]]))); break; }
      case 'rename': needCols(t, [o.from], 'Rename'); t.columns = t.columns.map((c) => (c === o.from ? o.to : c)); t.rows = t.rows.map((r) => { const x = {}; for (const [k, v] of Object.entries(r)) x[k === o.from ? o.to : k] = v; return x; }); break;
      case 'sort': needCols(t, [o.column], 'Sort'); t.rows.sort((a, b) => cmpVals(a[o.column], b[o.column]) * (o.dir === 'desc' ? -1 : 1)); break;
      case 'limit': t.rows = o.from === 'bottom' ? t.rows.slice(-Math.max(0, Number(o.count) || 0)) : t.rows.slice(0, Math.max(0, Number(o.count) || 0)); break;
      case 'group': for (const k of Object.keys(formulas)) delete formulas[k]; needCols(t, [...(o.by || []), ...(o.aggregates || []).map((a) => a.column)], 'Group'); t = group(t, o.by || [], o.aggregates || []); break;
      case 'total': needCols(t, (o.aggregates || []).map((a) => a.column), 'Totals'); t = group(t, [], o.aggregates || []); break;
      case 'compute': { if (!o.as) throw new Error('New column needs a name'); const f = compileFormula(o.formula || '0'); formulas[o.as] = f; t.rows.forEach((r) => { r[o.as] = roundish(f(r)); }); if (!t.columns.includes(o.as)) t.columns.push(o.as); break; }
      case 'dedupe': { const cs = (o.columns && o.columns.length ? o.columns : t.columns); const seen = new Set(); t.rows = t.rows.filter((r) => { const k = JSON.stringify(cs.map((c) => r[c])); if (seen.has(k)) return false; seen.add(k); return true; }); break; }
      case 'fill': needCols(t, [o.column], 'Fill blanks'); { let last = ''; t.rows.forEach((r) => { if (r[o.column] === '' || r[o.column] == null) r[o.column] = o.value != null && o.value !== '' ? o.value : last; else last = r[o.column]; }); } break;
      case 'totalRow': { const label = o.label || 'Total'; const row = {}; t.columns.forEach((c, i) => { row[c] = formulas[c] ? '' : t.rows.length && t.rows.every((r) => r[c] === '' || typeof r[c] === 'number') && i > 0 ? roundish(AGG.sum(t.rows.map((r) => r[c]))) : i === 0 ? label : ''; }); for (const [c, f] of Object.entries(formulas)) if (t.columns.includes(c)) row[c] = roundish(f(row)); t.rows.push(row); break; }
      case 'percentOfTotal': { needCols(t, [o.column], '% of total'); const tot = AGG.sum(t.rows.map((r) => r[o.column])); const as = o.as || `${o.column} %`; t.rows.forEach((r) => { r[as] = tot ? roundish((num(r[o.column]) || 0) / tot) : 0; }); if (!t.columns.includes(as)) t.columns.push(as); break; }
      case 'skipRows': t.rows = t.rows.slice(Math.max(0, Number(o.count) || 0)); break;
      default: throw new Error(`Unknown transform “${o.op}”`);
    }
  }
  return t;
}

// ───────── compare against an earlier table (last run)
function compare(current, previous, { key, columns } = {}) {
  const cur = asTable(current); const prev = previous ? asTable(previous) : { columns: cur.columns, rows: [] };
  const valueCols = (columns && columns.length ? columns : cur.columns.filter((c) => c !== key && cur.rows.some((r) => typeof r[c] === 'number')));
  const idx = new Map(); if (key) prev.rows.forEach((r) => idx.set(String(r[key]), r));
  const outCols = [...(key ? [key] : []), ...valueCols.flatMap((c) => [c, `${c} (previous)`, `${c} change`, `${c} change %`])];
  const rows = cur.rows.map((r, i) => {
    const p = key ? idx.get(String(r[key])) : prev.rows[i];
    const o = key ? { [key]: r[key] } : {};
    for (const c of valueCols) {
      const a = num(r[c]); const b = p ? num(p[c]) : NaN;
      o[c] = r[c]; o[`${c} (previous)`] = isNaN(b) ? '' : b;
      o[`${c} change`] = isNaN(a) || isNaN(b) ? '' : roundish(a - b);
      o[`${c} change %`] = isNaN(a) || isNaN(b) || b === 0 ? '' : roundish((a - b) / Math.abs(b));
    }
    return o;
  });
  // headline numbers: totals of each value column, now vs before
  const totals = {};
  for (const c of valueCols) {
    const a = AGG.sum(cur.rows.map((r) => r[c])); const b = prev.rows.length ? AGG.sum(prev.rows.map((r) => r[c])) : null;
    totals[c] = { now: roundish(a), previous: b == null ? null : roundish(b), change: b == null ? null : roundish(a - b), changePct: b ? roundish((a - b) / Math.abs(b)) : null };
  }
  return { table: { columns: outCols, rows }, totals, hadPrevious: prev.rows.length > 0 };
}

function preview(t, n = 50) { t = asTable(t); return { columns: t.columns, rows: t.rows.slice(0, n), total: t.rows.length }; }

module.exports = { _testRow: testRow, isTable, asTable, fromObjects, parseCSV, toCSV, readXLSX, writeXLSX, readDataFile, transform, group, compare, compileFormula, num, cmpVals, preview, AGG };
