// Cadence — templates. "{{ week.label }}", "{{ steps.pull.file | basename }}", "{{ today | addDays:-7 | date:'MMM D' }}".
// A field that is exactly one {{ }} keeps the value's type (a table, a list, a number); anything else becomes text.
'use strict';
const path = require('path');
const { format, parseDate, addDays } = require('./dates');

const TOKEN = /\{\{\s*([\s\S]+?)\s*\}\}/g;

// Split "a.b[0]['c d'].e" into ['a','b',0,'c d','e']
function parsePath(p) {
  const out = []; let i = 0; const s = String(p).trim();
  while (i < s.length) {
    if (s[i] === '.') { i++; continue; }
    if (s[i] === '[') {
      const end = s.indexOf(']', i);
      if (end < 0) throw new Error(`Missing ] in ${p}`);
      let k = s.slice(i + 1, end).trim();
      if (/^['"].*['"]$/.test(k)) k = k.slice(1, -1); else if (/^-?\d+$/.test(k)) k = Number(k);
      out.push(k); i = end + 1; continue;
    }
    let j = i; while (j < s.length && s[j] !== '.' && s[j] !== '[') j++;
    out.push(s.slice(i, j)); i = j;
  }
  return out;
}

function get(obj, p) {
  let cur = obj;
  for (const k of parsePath(p)) {
    if (cur == null) return undefined;
    if (typeof k === 'number' && Array.isArray(cur) && k < 0) cur = cur[cur.length + k];
    else if (typeof cur === 'function') cur = cur(k);
    else cur = cur[k];
  }
  return cur;
}

// split on | outside quotes
function splitPipes(expr) {
  const parts = []; let cur = ''; let q = null;
  for (const ch of expr) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '|') { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}
function parseArgs(s) {
  if (s == null) return [];
  const out = []; let cur = ''; let q = null; let quoted = false;
  for (const ch of s) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; quoted = true; continue; }
    if (ch === ',') { out.push(quoted ? cur : lit(cur.trim())); cur = ''; quoted = false; continue; }
    cur += ch;
  }
  out.push(quoted ? cur : lit(cur.trim()));
  return out;
}
const lit = (s) => (s === '' ? '' : s === 'true' ? true : s === 'false' ? false : /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s);

const toNum = (v) => { if (typeof v === 'number') return v; const n = Number(String(v ?? '').replace(/[$,%\s£€]/g, '')); return isNaN(n) ? 0 : n; };
function fmtNumber(v, dp = 0) { return toNum(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
function compact(v) { const n = toNum(v); const a = Math.abs(n); if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'; if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; if (a >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; return fmtNumber(n, Number.isInteger(n) ? 0 : 1); }

const FILTERS = {
  date: (v, f = 'YYYY-MM-DD') => format(parseDate(v ?? new Date()), f),
  addDays: (v, n = 0) => format(addDays(parseDate(v ?? new Date()), toNum(n))),
  upper: (v) => String(v ?? '').toUpperCase(),
  lower: (v) => String(v ?? '').toLowerCase(),
  title: (v) => String(v ?? '').replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
  trim: (v) => String(v ?? '').trim(),
  slug: (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  safe: (v) => String(v ?? '').replace(/[\\/:*?"<>|]+/g, '-').trim(),
  default: (v, d = '') => (v === undefined || v === null || v === '' ? d : v),
  json: (v) => JSON.stringify(v, null, 2),
  number: (v, dp = 0) => fmtNumber(v, toNum(dp)),
  compact: (v) => compact(v),
  round: (v, dp = 0) => { const m = 10 ** toNum(dp); return Math.round(toNum(v) * m) / m; },
  currency: (v, sym = '$', dp = 0) => (toNum(v) < 0 ? '-' : '') + sym + fmtNumber(Math.abs(toNum(v)), toNum(dp)),
  percent: (v, dp = 1) => (v === null || v === undefined || v === '' ? '' : (toNum(v) * 100).toFixed(toNum(dp)) + '%'),
  change: (v, dp = 1) => (v === null || v === undefined || v === '' ? '' : (toNum(v) > 0 ? '+' : toNum(v) < 0 ? '−' : '') + Math.abs(toNum(v) * 100).toFixed(toNum(dp)) + '%'),
  signed: (v, dp = 0) => (v === null || v === undefined || v === '' ? '' : (toNum(v) > 0 ? '+' : '') + fmtNumber(v, toNum(dp))),
  abs: (v) => Math.abs(toNum(v)),
  plus: (v, n) => toNum(v) + toNum(n), minus: (v, n) => toNum(v) - toNum(n), times: (v, n) => toNum(v) * toNum(n), dividedBy: (v, n) => (toNum(n) ? toNum(v) / toNum(n) : 0),
  join: (v, sep = ', ') => (Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)).join(sep) : String(v ?? '')),
  lines: (v) => (Array.isArray(v) ? v.join('\n') : String(v ?? '')),
  first: (v) => (Array.isArray(v) ? v[0] : v), last: (v) => (Array.isArray(v) ? v[v.length - 1] : v),
  count: (v) => (Array.isArray(v) ? v.length : v && Array.isArray(v.rows) ? v.rows.length : v ? Object.keys(v).length : 0),
  basename: (v) => path.basename(String(v ?? '')), dirname: (v) => path.dirname(String(v ?? '')),
  stem: (v) => path.basename(String(v ?? ''), path.extname(String(v ?? ''))), ext: (v) => path.extname(String(v ?? '')).replace(/^\./, ''),
  replace: (v, a = '', b = '') => String(v ?? '').split(a).join(b),
  truncate: (v, n = 80) => { const s = String(v ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; },
  column: (v, name) => (v && Array.isArray(v.rows) ? v.rows.map((r) => r[name]) : []),
  sum: (v, name) => { const arr = v && Array.isArray(v.rows) ? v.rows.map((r) => r[name]) : Array.isArray(v) ? v : []; return arr.reduce((a, x) => a + toNum(x), 0); },
  avg: (v, name) => { const arr = v && Array.isArray(v.rows) ? v.rows.map((r) => r[name]) : Array.isArray(v) ? v : []; return arr.length ? arr.reduce((a, x) => a + toNum(x), 0) / arr.length : 0; },
};

class TemplateError extends Error {}

function evalExpr(expr, ctx) {
  const [head, ...pipes] = splitPipes(expr);
  let v;
  if (/^(['"]).*\1$/.test(head)) v = head.slice(1, -1);
  else if (/^-?\d+(\.\d+)?$/.test(head)) v = Number(head);
  else v = get(ctx, head);
  for (const p of pipes) {
    const m = /^(\w+)\s*(?::\s*([\s\S]*))?$/.exec(p);
    if (!m) throw new TemplateError(`Can’t read “${p}”`);
    const f = FILTERS[m[1]];
    if (!f) throw new TemplateError(`Unknown filter “${m[1]}”`);
    v = f(v, ...parseArgs(m[2]));
  }
  return v;
}

const asText = (v) => (v === undefined || v === null ? '' : typeof v === 'object' ? (Array.isArray(v) && v.every((x) => typeof x !== 'object') ? v.join(', ') : JSON.stringify(v)) : String(v));

// Render one value. Strings get templated; arrays/objects are walked.
function render(value, ctx, opts = {}) {
  if (typeof value === 'string') {
    const whole = /^\s*\{\{\s*([\s\S]+?)\s*\}\}\s*$/.exec(value);
    if (whole && !opts.text && !whole[1].includes('}}')) return evalExpr(whole[1], ctx);
    return value.replace(TOKEN, (_, e) => asText(evalExpr(e, ctx)));
  }
  if (Array.isArray(value)) return value.map((v) => render(v, ctx, opts));
  if (value && typeof value === 'object') { const o = {}; for (const [k, v] of Object.entries(value)) o[k] = render(v, ctx, opts); return o; }
  return value;
}
const renderText = (value, ctx) => asText(render(value, ctx, { text: true }));

// Which {{ }} roots a value uses ("steps.pull", "secrets.KEY") — for validation and the editor.
function refs(value, out = new Set()) {
  if (typeof value === 'string') { for (const m of value.matchAll(TOKEN)) { const head = splitPipes(m[1])[0]; try { const p = parsePath(head); if (p[0] === 'steps' && p[1] != null) out.add('steps.' + p[1]); else if (p[0] === 'secrets' && p[1] != null) out.add('secrets.' + p[1]); else out.add(String(p[0])); } catch {} } }
  else if (Array.isArray(value)) value.forEach((v) => refs(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => refs(v, out));
  return out;
}

module.exports = { render, renderText, get, refs, FILTERS, toNum, fmtNumber, compact, TemplateError, parsePath };
