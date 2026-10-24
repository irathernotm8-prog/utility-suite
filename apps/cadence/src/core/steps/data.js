// Cadence — data steps: read, shape, compare with last run, save as spreadsheet, set values.
'use strict';
const fs = require('fs');
const path = require('path');
const T = require('../table');
const { fileList } = require('./files')._;

function needTable(v, what = 'Data') {
  if (typeof v === 'string') throw new Error(`${what} should point at an earlier step’s table, like {{steps.read.table}} (got text instead)`);
  if (v == null) throw new Error(`${what} is empty. Point it at an earlier step’s table.`);
  return T.asTable(v);
}
const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

module.exports = {
  'data.read': async (w, x) => {
    const files = fileList(w.file);
    if (!files.length) throw new Error('Choose a file to read');
    const opts = { sheet: w.sheet || undefined, skip: Number(w.skip) || 0, header: w.header !== false, jsonPath: w.jsonPath || undefined };
    let t = null;
    for (const file of files) {
      if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
      const one = await T.readDataFile(file, opts);
      x.log(`Read ${one.rows.length} rows × ${one.columns.length} columns from ${path.basename(file)}`);
      if (files.length > 1) { one.rows.forEach((r) => { r['Source file'] = path.basename(file); }); one.columns.push('Source file'); }
      if (!t) t = one;
      else { for (const c of one.columns) if (!t.columns.includes(c)) t.columns.push(c); t.rows.push(...one.rows); }
    }
    if (files.length > 1) x.log(`Combined ${files.length} files: ${t.rows.length} rows`);
    if (t.columns.length) x.log(`Columns: ${t.columns.slice(0, 20).join(', ')}${t.columns.length > 20 ? '…' : ''}`);
    return { table: t, row: t.rows[0] || {}, count: t.rows.length, columns: t.columns };
  },

  'data.transform': async (w, x) => {
    const src = needTable(w.table);
    const t = T.transform(src, Array.isArray(w.ops) ? w.ops : []);
    x.log(`${src.rows.length} rows in → ${t.rows.length} rows out`);
    return { table: t, row: t.rows[0] || {}, count: t.rows.length, columns: t.columns };
  },

  'data.compare': async (w, x) => {
    const cur = needTable(w.table);
    const key = w.memory || x.step.id;
    const prev = x.recall('compare:' + key);
    const res = T.compare(cur, prev ? prev.table : null, { key: w.key || undefined, columns: list(w.columns) });
    x.remember('compare:' + key, { table: cur, at: Date.now() });
    if (prev) x.log(`Compared with the run from ${new Date(prev.at).toLocaleString()}`);
    else x.log('No earlier run to compare with yet — this run becomes the baseline.', 'warn');
    return { table: res.table, totals: res.totals, hadPrevious: res.hadPrevious, previousAt: prev ? new Date(prev.at).toISOString() : null };
  },

  'data.write': async (w, x) => {
    const p = x.resolvePath(w.path);
    if (!p) throw new Error('Choose where to save');
    let sheets = Array.isArray(w.sheets) ? w.sheets : [];
    sheets = sheets.filter((s) => s && s.table != null).map((s, i) => ({ name: s.name || `Sheet ${i + 1}`, table: needTable(s.table, `Table ${i + 1}`) }));
    if (!sheets.length) throw new Error('Add at least one table to save');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const ext = path.extname(p).toLowerCase();
    if (ext === '.csv' || ext === '.tsv') fs.writeFileSync(p, '﻿' + T.toCSV(sheets[0].table, { delimiter: ext === '.tsv' ? '\t' : ',' }));
    else if (ext === '.json') fs.writeFileSync(p, JSON.stringify(sheets.length === 1 ? sheets[0].table.rows : Object.fromEntries(sheets.map((s) => [s.name, s.table.rows])), null, 2));
    else if (ext === '.xlsx') await T.writeXLSX(p, sheets);
    else throw new Error('Save as .xlsx, .csv, .tsv or .json');
    x.log(`Saved ${path.basename(p)}`);
    return { file: p };
  },

  'data.set': async (w) => {
    const values = {};
    const kv = w.values;
    if (Array.isArray(kv)) for (const r of kv) { if (r && r.key) values[r.key] = r.value; }
    else if (kv && typeof kv === 'object') Object.assign(values, kv);
    return { values };
  },
};
