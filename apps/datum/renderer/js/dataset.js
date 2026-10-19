// Datum - Data Sets: combine many spreadsheets that share a layout into one Data Sheet
(function () {
  const DSET = (D.dataset = {});
  const h = D.h;
  const F = () => D.f;
  const N = () => window.native;

  // evaluated grids per file, reused while the file is unchanged (path + mtime)
  const memo = new Map();

  // ---------------------------------------------------------------- reading
  const isNumStr = (v) => typeof v === 'string' && /^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?%?$/.test(v.trim()) && /\d/.test(v);
  const blank = (v) => v === '' || v == null;
  const ID_RE = /(\bid\b|_id$|^id$|number|\bno\.?$|#|code$|email|account|order|invoice|ticket|sku|serial|reference|object|customer)/i;

  // import a file with Datum's own importer, then compute every cell (formulas included) in a scratch project
  async function readFile(f) {
    const key = `${f.path}|${f.mtime}`;
    if (memo.has(key)) return memo.get(key);
    let list;
    try { list = await N().importFile(f.path); } catch (e) { const r = { error: String((e && e.message) || 'Could not read this file').replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '') }; memo.set(key, r); return r; }
    const sheets = list.filter((s) => s.type === 'data');
    if (!sheets.length) { const r = { error: 'No worksheets with data' }; memo.set(key, r); return r; }
    const names = Object.assign({}, ...sheets.map((s) => s.names || {}));
    const tmp = { id: 'tmp', name: 'tmp', sheets, names, brand: D.brand() };
    const prev = D.state.project;
    const out = [];
    D.dataVersion++;
    D.state.project = tmp;
    try {
      for (const s of sheets) {
        // hidden worksheets are lookup tables for the visible ones: computed on demand, never stacked
        if (s.hidden) { out.push({ name: s.name, wsName: s.wsName || s.name, hidden: true, vals: [], fmts: [], colWidths: {} }); continue; }
        let maxR = -1, maxC = -1;
        s.cells.forEach((row, r) => row.forEach((v, c) => { if (!blank(v)) { if (r > maxR) maxR = r; if (c > maxC) maxC = c; } }));
        // a records table with summary blocks / helper formulas beside it: only compute the table
        let t = null;
        try { t = D.links && D.links.tableRange ? D.links.tableRange(s) : null; } catch { t = null; }
        const tg = t && F().parseRange(t);
        const lo = tg ? tg.areas[0].c1 : 0;
        if (tg) { maxR = Math.min(maxR, tg.areas[0].r2); maxC = Math.min(maxC, tg.areas[0].c2); }
        const vals = [];
        const fmts = [];
        for (let r = 0; r <= maxR; r++) {
          const row = [], frow = [];
          for (let c = 0; c <= maxC; c++) {
            let v = c < lo ? '' : s.cells[r][c];
            if (!blank(v)) {
              try { v = F().cellValue(s, r, c); } catch { v = s.cells[r][c]; }
              if (v && typeof v === 'object') v = v.code || v.message || '#VALUE!';
              const st = s.styles && s.styles[`${r},${c}`];
              if (st && st.fmt === 'date' && typeof v === 'number' && v > 0 && v < 2958466) v = F().isoDate(F().fromSerial(v));
              frow.push(st && (st.fmt || st.dec != null || st.comma != null) ? { fmt: st.fmt, dec: st.dec, comma: st.comma } : null);
            } else { v = ''; frow.push(null); }
            row.push(v);
          }
          vals.push(row); fmts.push(frow);
        }
        out.push({ name: s.name, wsName: s.wsName || s.name, vals, fmts, colWidths: s.colWidths || {} });
      }
    } finally {
      D.state.project = prev;
      D.dataVersion++;
    }
    const r = { sheets: out };
    memo.set(key, r);
    return r;
  }

  // ---------------------------------------------------------------- understanding a sheet
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9%#$€£]+/g, ' ').trim();
  const isText = (v) => typeof v === 'string' && v.trim() !== '' && !isNumStr(v) && !/^\d{4}-\d{2}-\d{2}/.test(v);
  const TOTAL_RE = /^(grand\s*)?(sub\s*)?totals?\b|^sum$|^overall\b|^all\s+(regions|products|items)$/i;

  function detectHeader(vals) {
    let best = 0, bestScore = 0;
    const lim = Math.min(vals.length - 1, 30);
    for (let r = 0; r < lim; r++) {
      const ne = vals[r].filter((v) => !blank(v));
      if (ne.length < 2) continue;
      const txt = ne.filter(isText).length;
      if (txt / ne.length < 0.6) continue;
      const next = vals.slice(r + 1, r + 6).filter((rr) => rr.some((v) => !blank(v)));
      if (!next.length) continue;
      const under = next[0].filter((v) => !blank(v)).length;
      const nums = next.some((rr) => rr.some((v) => typeof v === 'number'));
      const score = txt + (under >= ne.length * 0.5 ? 2 : 0) + (nums ? 1 : 0);
      if (score > bestScore) { best = r; bestScore = score; }
    }
    return best;
  }

  // header row → columns, data rows → records
  function shape(sh, o, forcedHeader) {
    const vals = sh.vals;
    if (!vals.length) return { cols: [], rows: [], hr: 0, skipped: 0 };
    const hr = forcedHeader != null ? Math.min(forcedHeader, vals.length - 1) : detectHeader(vals);
    const head = vals[hr] || [];
    let c1 = head.findIndex((v) => !blank(v)); if (c1 < 0) c1 = 0;
    let c2 = head.length - 1; while (c2 > c1 && blank(head[c2])) c2--;
    // extend right over unnamed columns that hold data
    const width = Math.max(...vals.slice(hr + 1, hr + 50).map((r) => { let e = r.length - 1; while (e >= 0 && blank(r[e])) e--; return e; }), c2);
    c2 = Math.max(c2, width);
    const cols = [];
    const seen = {};
    for (let c = c1; c <= c2; c++) {
      let name = blank(head[c]) ? `Column ${F().colName(c)}` : String(head[c]).trim();
      const k = norm(name) || `col ${c}`;
      seen[k] = (seen[k] || 0) + 1;
      if (seen[k] > 1) name = `${name} (${seen[k]})`;
      cols.push({ c, name, key: seen[k] > 1 ? `${k} ${seen[k]}` : k, fmt: null });
    }
    const headKeys = cols.map((x) => norm(x.name));
    const rows = [];
    let skipped = 0;
    for (let r = hr + 1; r < vals.length; r++) {
      const row = cols.map((x) => vals[r][x.c]);
      if (row.every(blank)) continue;
      const firstText = row.slice(0, 3).find((v) => typeof v === 'string' && v.trim());
      if (o.skipTotals && firstText && TOTAL_RE.test(firstText.trim())) { skipped++; continue; }
      if (row.filter((v, i) => !blank(v) && norm(v) === headKeys[i]).length >= Math.max(2, cols.length * 0.6)) { skipped++; continue; } // repeated header
      rows.push(row);
      if (rows.length === 1) cols.forEach((x, i) => { x.fmt = sh.fmts[r] && sh.fmts[r][x.c]; });
    }
    return { cols, rows, hr, skipped };
  }

  // ---------------------------------------------------------------- dates in file names
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const yr = (s) => { const n = +s; return n < 100 ? 2000 + n : n; };
  const iso = (y, m, d = 1) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  DSET.periodFromName = (file) => {
    const s = String(file).replace(/\.[a-z0-9]+$/i, '');
    const B = '(?<![A-Za-z0-9])', A = '(?![A-Za-z0-9])';
    let m;
    if ((m = new RegExp(`${B}(19|20)(\\d{2})[-_. ]?(0[1-9]|1[0-2])[-_. ]?(0[1-9]|[12]\\d|3[01])${A}`).exec(s))) return { date: iso(+(m[1] + m[2]), +m[3] - 1, +m[4]), grain: 'day' };
    // US-style month-day-year, as in weekly tab names such as 10-04-26 or 9-7-2025
    if ((m = new RegExp(`${B}(0?[1-9]|1[0-2])[-_./](0?[1-9]|[12]\\d|3[01])[-_./]((?:19|20)?\\d{2})${A}`).exec(s))) return { date: iso(yr(m[3]), +m[1] - 1, +m[2]), grain: 'day' };
    if ((m = new RegExp(`${B}(19|20)(\\d{2})[-_. ]?q([1-4])${A}`, 'i').exec(s)) || (m = new RegExp(`${B}q([1-4])[-_. ']?((?:19|20)?\\d{2})${A}`, 'i').exec(s))) {
      const q = m[3] ? +m[3] : +m[1]; const y = m[3] ? +(m[1] + m[2]) : yr(m[2]);
      return { date: iso(y, (q - 1) * 3), grain: 'quarter' };
    }
    if ((m = new RegExp(`${B}${MON_RE}[-_. ']*((?:19|20)?\\d{2})${A}`, 'i').exec(s))) return { date: iso(yr(m[2]), MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())), grain: 'month' };
    if ((m = new RegExp(`${B}((?:19|20)\\d{2})[-_. ]?${MON_RE}${A}`, 'i').exec(s))) return { date: iso(+m[1], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())), grain: 'month' };
    if ((m = new RegExp(`${B}(19|20)(\\d{2})[-_. ](0?[1-9]|1[0-2])${A}`).exec(s))) return { date: iso(+(m[1] + m[2]), +m[3] - 1), grain: 'month' };
    if ((m = new RegExp(`${B}(0?[1-9]|1[0-2])[-_. ]((?:19|20)\\d{2})${A}`).exec(s))) return { date: iso(+m[2], +m[1] - 1), grain: 'month' };
    if ((m = new RegExp(`${B}(?:fy|cy)?[-_ ]?((?:19|20)\\d{2})${A}`, 'i').exec(s))) return { date: iso(+m[1], 0), grain: 'year' };
    return null;
  };

  // ---------------------------------------------------------------- combining
  // files: [{path,name,mtime}] → { columns, rows, report, ... }
  async function analyse(files, o, onProgress) {
    const loaded = [];
    for (let i = 0; i < files.length; i++) {
      onProgress && onProgress(i, files.length, files[i].name);
      loaded.push({ file: files[i], data: await readFile(files[i]) });
    }
    return loaded;
  }

  function combine(loaded, o) {
    const ok = loaded.filter((x) => x.data && x.data.sheets);
    // reference layout: the worksheet the user picked, or the first file's first sheet with data
    // "dated": every tab whose name holds a date (one tab per week or month), other tabs left out
    const dated = o.sheetMode === 'dated';
    const isDated = (s) => s.vals.length && !s.hidden && !!DSET.periodFromName(s.wsName);
    const pickName = o.sheetMode && !['auto', 'all', 'dated'].includes(o.sheetMode) ? o.sheetMode : null;
    const firstWs = ok.length ? ((dated && ok.map((x) => x.data.sheets.find(isDated)).find(Boolean)) || ok[0].data.sheets.find((s) => s.vals.length) || ok[0].data.sheets[0]) : null;
    const refName = pickName || (firstWs && firstWs.wsName);
    const ref = firstWs ? shape(dated ? firstWs : ok[0].data.sheets.find((s) => s.wsName === refName) || firstWs, o, o.headerRow) : { cols: [] };
    const refKeys = ref.cols.map((c) => c.key);
    const columns = ref.cols.map((c) => ({ key: c.key, name: c.name, fmt: c.fmt }));
    const byKey = new Map(columns.map((c, i) => [c.key, i]));
    const records = [];
    const report = [];
    const periods = [];
    for (const { file, data } of loaded) {
      const per = DSET.periodFromName(file.name);
      periods.push(per);
      if (!data || data.error) { report.push({ file, error: (data && data.error) || 'Could not read' }); continue; }
      let targets;
      if (o.sheetMode === 'all') targets = data.sheets.filter((s) => s.vals.length);
      else if (dated) targets = data.sheets.filter(isDated);
      else {
        const exact = data.sheets.find((s) => refName && s.wsName.toLowerCase() === String(refName).toLowerCase());
        if (exact) targets = [exact];
        else if (pickName) targets = [];
        else {
          // best header overlap with the reference layout
          let best = null, bestN = -1;
          for (const s of data.sheets) { if (!s.vals.length) continue; const sh = shape(s, o, o.headerRow); const n = sh.cols.filter((c) => refKeys.includes(c.key)).length; if (n > bestN) { best = s; bestN = n; } }
          targets = best ? [best] : [];
        }
      }
      if (!targets.length) { report.push({ file, error: pickName ? `No worksheet named “${pickName}”` : dated ? 'No tabs with a date in their name' : 'No data found' }); continue; }
      for (const s of targets) {
        const sh = shape(s, o, o.headerRow);
        let map;
        const missing = [], extra = [];
        if (o.match === 'position') {
          map = sh.cols.map((c, i) => (i < columns.length ? i : -1));
          sh.cols.forEach((c, i) => { if (i >= columns.length) extra.push(c.name); });
          if (sh.cols.length < columns.length) missing.push(...columns.slice(sh.cols.length).map((c) => c.name));
        } else {
          map = sh.cols.map((c) => {
            if (byKey.has(c.key)) return byKey.get(c.key);
            extra.push(c.name);
            if (o.union === false) return -1;
            columns.push({ key: c.key, name: c.name, fmt: c.fmt, added: true });
            byKey.set(c.key, columns.length - 1);
            return columns.length - 1;
          });
          const have = new Set(sh.cols.map((c) => c.key));
          columns.forEach((c) => { if (!have.has(c.key) && !c.added) missing.push(c.name); });
        }
        const sper = dated ? DSET.periodFromName(s.wsName) || per : per;
        for (const row of sh.rows) records.push({ file, sheet: s.wsName, per: sper, vals: row, map });
        report.push({ file, sheet: s.wsName, headerRow: sh.hr + 1, rows: sh.rows.length, skipped: sh.skipped, missing, extra });
      }
    }
    // unnamed spacer columns that never hold anything are left out
    const used = columns.map(() => false);
    for (const rec of records) rec.vals.forEach((v, i) => { const j = rec.map[i]; if (j >= 0 && !blank(v)) used[j] = true; });
    const keep = columns.map((c, j) => used[j] || !/^Column [A-Z]+$/.test(c.name));
    if (keep.some((k) => !k)) {
      const to = []; let n = 0; keep.forEach((k, j) => { to[j] = k ? n++ : -1; });
      for (let j = columns.length - 1; j >= 0; j--) if (!keep[j]) columns.splice(j, 1);
      const seenMaps = new Set();
      for (const rec of records) { if (seenMaps.has(rec.map)) continue; seenMaps.add(rec.map); rec.map.forEach((j, i) => { rec.map[i] = j >= 0 ? to[j] : -1; }); }
    }
    const allDated = dated ? records.length > 0 && records.every((r) => r.per) : loaded.length > 1 && periods.every(Boolean);
    const grain = allDated ? (dated ? records[0].per.grain : periods[0].grain) : null;
    // columns that identify each record, and repeats of them across files or worksheets
    const valIn = (rec, j) => { const i = rec.map.indexOf(j); const v = i >= 0 ? rec.vals[i] : ''; return blank(v) || /^\s*[-–—.]?\s*$/.test(String(v)) ? '' : String(v).trim().toLowerCase(); };
    const idCands = [];
    columns.forEach((c, j) => {
      if (!ID_RE.test(c.name) || /referral|promo|zip|postal|phone|mobile/i.test(c.name)) return;
      let n = 0; const seen = new Set(); let dups = 0;
      for (const rec of records) { const v = valIn(rec, j); if (!v) continue; n++; if (seen.has(v)) dups++; else seen.add(v); }
      if (n >= Math.max(2, records.length * 0.6) && seen.size / n >= 0.6) idCands.push({ key: c.key, name: c.name, dups, ratio: seen.size / n });
    });
    idCands.sort((a, b) => b.ratio - a.ratio);
    let dupRemoved = 0;
    const dj = o.dedupe ? columns.findIndex((c) => c.key === o.dedupe) : -1;
    if (dj >= 0) {
      // keep the copy from the newest file (by the date in its name, then when it was saved) or the first one found
      const idx = records.map((_, i) => i);
      if (o.keep !== 'first') idx.sort((a, b) => { const A = records[a], B = records[b]; const pa = (A.per && A.per.date) || '', pb = (B.per && B.per.date) || ''; return pa < pb ? 1 : pa > pb ? -1 : (B.file.mtime || 0) - (A.file.mtime || 0) || a - b; });
      const seen = new Set(); const drop = new Set();
      for (const i of idx) { const v = valIn(records[i], dj); if (!v) continue; if (seen.has(v)) drop.add(i); else seen.add(v); }
      dupRemoved = drop.size;
      if (drop.size) { const kept = records.filter((_, i) => !drop.has(i)); records.length = 0; records.push(...kept); }
    }
    return { columns, records, report, allDated, grain, refName, idCands, dupRemoved, sheetNames: [...new Set(ok.flatMap((x) => x.data.sheets.filter((s) => !s.hidden).map((s) => s.wsName)))] };
  }

  const toCell = (v) => {
    if (blank(v)) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return String(Math.round(v * 1e10) / 1e10);
    const s = String(v);
    return s[0] === '=' ? ' ' + s : s; // text that looks like a formula stays text
  };

  // table of strings for the sheet
  function table(res, o) {
    const pre = [];
    if (o.period && res.allDated) pre.push({ name: 'Period', get: (rec) => rec.per.date });
    // the added columns step aside when the data already has a field with that name (e.g. a "Source" of leads)
    const taken = new Set(res.columns.map((c) => String(c.name).toLowerCase()));
    if (o.source) pre.push({ name: taken.has('source') ? 'Source file' : 'Source', get: (rec) => rec.file.name.replace(/\.(xlsx|xlsm|csv|tsv)$/i, '') });
    if (o.sheetMode === 'all' || o.sheetMode === 'dated') pre.push({ name: taken.has('worksheet') ? 'Worksheet tab' : 'Worksheet', get: (rec) => String(rec.sheet).trim() });
    const header = [...pre.map((p) => p.name), ...res.columns.map((c) => c.name)];
    // sort by period (oldest first) then file order, so histories read top to bottom
    const recs = res.allDated && o.period ? [...res.records].map((r, i) => [r, i]).sort((a, b) => (a[0].per.date < b[0].per.date ? -1 : a[0].per.date > b[0].per.date ? 1 : a[1] - b[1])).map((x) => x[0]) : res.records;
    const rows = recs.map((rec) => {
      const out = Array(header.length).fill('');
      pre.forEach((p, i) => { out[i] = toCell(p.get(rec)); });
      rec.vals.forEach((v, i) => { const j = rec.map[i]; if (j >= 0) out[pre.length + j] = toCell(v); });
      return out;
    });
    return { header, rows, pre: pre.length };
  }

  // ---------------------------------------------------------------- writing the sheet
  function fill(sheet, res, o) {
    const t = table(res, o);
    const n = t.rows.length;
    const ncol = t.header.length;
    const keepCols = sheet.dataset ? Math.max(0, (sheet.cells[0] || []).length) : 0;
    const prevW = sheet.dataset ? sheet.dataset.width : 0;
    // columns the user added to the right of the data set: keep them, filling formulas down to the new length
    const extra = [];
    if (sheet.dataset && prevW) {
      for (let c = prevW; c < keepCols; c++) {
        const col = sheet.cells.map((r) => r[c]);
        if (col.every(blank)) continue;
        extra.push({ c, head: col[0], first: col[1], all: col, style: sheet.styles[`1,${c}`] });
      }
    }
    const totalCols = Math.max(ncol + extra.length + 2, 14);
    const cells = Array.from({ length: Math.max(n + 30, 100) }, () => Array(totalCols).fill(''));
    t.header.forEach((v, c) => { cells[0][c] = v; });
    t.rows.forEach((row, r) => row.forEach((v, c) => { cells[r + 1][c] = v; }));
    const styles = {};
    for (let c = 0; c < ncol; c++) styles[`0,${c}`] = { b: true, fill: '#EAF1FF' };
    // number formats from the first file
    res.columns.forEach((col, i) => {
      const c = t.pre + i;
      if (!col.fmt) return;
      for (let r = 1; r <= n; r++) styles[`${r},${c}`] = { ...col.fmt };
    });
    if (t.header[0] === 'Period') for (let r = 1; r <= n; r++) styles[`${r},0`] = { fmt: 'date' };
    // re-attach user columns
    extra.forEach((x) => {
      const c = ncol + extra.indexOf(x);
      cells[0][c] = x.head || '';
      if (sheet.styles[`0,${x.c}`]) styles[`0,${c}`] = sheet.styles[`0,${x.c}`];
      const f = x.first;
      for (let r = 1; r <= n; r++) {
        if (typeof f === 'string' && f[0] === '=') cells[r][c] = r === 1 ? f : F().offsetFormula(f, r - 1, 0);
        else cells[r][c] = x.all[r] || '';
        if (x.style) styles[`${r},${c}`] = { ...x.style };
      }
    });
    sheet.cells = cells;
    sheet.styles = styles;
    sheet.cached = {};
    sheet.merges = [];
    sheet.cf = sheet.cf || [];
    sheet.frozen = 1;
    const lastCol = F().colName(Math.max(ncol, ncol + extra.length) - 1);
    sheet.filter = { range: `A1:${lastCol}${n + 1}`, cols: {} };
    const widths = {};
    t.header.forEach((hd, c) => {
      const money = c >= t.pre && res.columns[c - t.pre] && res.columns[c - t.pre].fmt && /cur|acct/.test(res.columns[c - t.pre].fmt.fmt || '');
      const dataLen = Math.max(0, ...t.rows.slice(0, 300).map((r) => String(r[c]).length)) + (money ? 5 : 0);
      const w = Math.max(76, Math.min(280, 40 + 7.4 * Math.max(String(hd).length, t.header[c] === 'Period' ? 12 : dataLen)));
      widths[c] = Math.round(w);
    });
    sheet.colWidths = { ...widths };
    return { n, ncol };
  }

  // ---------------------------------------------------------------- UI
  DSET.start = () => {
    let recursive = false;
    const chk = h('input', { type: 'checkbox' }); chk.addEventListener('change', () => { recursive = chk.checked; });
    let close;
    const go = async (mode) => {
      const picked = await N().openDataFiles(mode);
      if (!picked || !picked.length) return;
      close && close();
      const src = mode === 'folder' ? { mode: 'folder', dir: picked[0], recursive } : { mode: 'files', paths: picked };
      DSET.preview(src);
    };
    const card = (icon, title, sub, on) => h('button', { class: 'dset-pick', onclick: on }, h('span', { class: 'dp-ic', html: D.icon(icon, 22) }), h('b', null, title), h('span', null, sub));
    const body = h('div', { class: 'dset-start' },
      h('p', { class: 'muted' }, 'Combine many spreadsheets that share the same layout - monthly exports, weekly reports, one file per region - into a single Data Sheet you can chart, filter and build dashboards from. Files are read, not opened as separate sheets.'),
      h('div', { class: 'dset-picks' },
        card('fileUp', 'Choose files…', 'Pick any number of .xlsx or .csv files', () => go('files')),
        card('folderOpen', 'Choose a folder…', 'Every spreadsheet inside. Refresh later to pick up new files', () => go('folder'))),
      h('label', { class: 'chk' }, chk, h('span', null, 'Include subfolders')));
    close = D.modal({ title: 'New data set', width: 560, body, actions: [{ label: 'Cancel' }] });
  };

  async function listFiles(src) {
    if (src.mode === 'folder') return N().scanDataset({ dir: src.dir, recursive: !!src.recursive });
    return N().scanDataset({ paths: src.paths });
  }

  function progressModal(title) {
    const bar = h('div', { class: 'dset-bar' }, h('i'));
    const txt = h('div', { class: 'muted small' }, 'Starting…');
    const close = D.modal({ title, width: 420, body: h('div', null, bar, txt) });
    return { set: (i, n, name) => { bar.firstChild.style.width = Math.round((i / Math.max(n, 1)) * 100) + '%'; txt.textContent = `Reading ${i + 1} of ${n} · ${name}`; }, close };
  }

  DSET.preview = async (src, opts = {}) => {
    const files = await listFiles(src);
    if (!files.length) return D.toast(src.mode === 'folder' ? 'No .xlsx or .csv files in that folder' : 'No spreadsheets selected', 'warn');
    const pm = progressModal(`Reading ${files.length} file${files.length > 1 ? 's' : ''}`);
    let loaded;
    try { loaded = await analyse(files, {}, pm.set); } finally { pm.close(); }
    const folderName = src.mode === 'folder' ? src.dir.split(/[\\/]/).filter(Boolean).pop() : '';
    // a shared file-name prefix ("Sales 2024-01", "Sales 2024-02" → "Sales") usually names the set best
    const stems = files.map((f) => f.name.replace(/\.[a-z0-9]+$/i, ''));
    let pre = stems[0] || '';
    for (const st of stems) while (pre && !st.startsWith(pre)) pre = pre.slice(0, -1);
    pre = pre.replace(/[\s\d_.\-–—()]+$/, '').trim();
    const base = files.length > 1 && pre.length >= 3 ? pre : folderName && folderName.length > 2 ? folderName : 'Data Set';
    // one workbook with a tab per week or month: stack those tabs (the dashboard's Sheet filter then picks weeks)
    const datedTabs = (x) => (x.data && x.data.sheets ? x.data.sheets.filter((s) => s.vals.length && !s.hidden && DSET.periodFromName(s.wsName)).length : 0);
    const autoMode = files.length === 1 && datedTabs(loaded[0]) >= 3 ? 'dated' : 'auto';
    const o = { name: opts.name || `${base}`, sheetMode: autoMode, match: 'name', source: autoMode !== 'dated', period: true, skipTotals: true, dashboard: false, board: true, headerRow: null, ...opts };
    let res = combine(loaded, o);
    if (!res.allDated) o.period = false; else o.period = opts.period !== false;

    const summary = h('div', { class: 'dset-summary' });
    const dupBox = h('div', { class: 'field' });
    const fileList = h('div', { class: 'dset-files' });
    const colsBox = h('div', { class: 'dset-cols' });
    const draw = () => {
      res = combine(loaded, o);
      const t = table(res, o);
      const bad = res.report.filter((r) => r.error).length;
      const warn = res.report.filter((r) => !r.error && (r.missing.length || r.extra.length)).length;
      summary.innerHTML = '';
      summary.append(
        h('span', { html: D.icon('layers', 16) }),
        h('span', null, h('b', null, `${t.rows.length.toLocaleString()} rows`), ` from ${loaded.length - bad} of ${loaded.length} files · ${t.header.length} columns`, res.allDated && o.period ? ` · dated by ${res.grain} from ${o.sheetMode === 'dated' ? 'tab' : 'file'} names` : ''),
        bad ? h('span', { class: 'pill err' }, `${bad} skipped`) : null,
        warn ? h('span', { class: 'pill warn' }, `${warn} with different columns`) : null,
        res.dupRemoved ? h('span', { class: 'pill warn' }, `${res.dupRemoved.toLocaleString()} repeats removed`) : (res.idCands[0] && res.idCands[0].dups ? h('span', { class: 'pill warn' }, `${res.idCands[0].dups.toLocaleString()} repeated ${res.idCands[0].name}s`) : null));
      dupBox.innerHTML = '';
      if (res.idCands.length) {
        const s1 = h('select', { class: 'input' }, [['', 'Keep every row'], ...res.idCands.map((c) => [c.key, `Remove repeats of ${c.name}${o.dedupe === c.key ? '' : ` (${c.dups.toLocaleString()} found)`}`])].map(([v, l]) => h('option', { value: v, selected: (o.dedupe || '') === v ? true : null }, l)));
        s1.addEventListener('change', () => { o.dedupe = s1.value || null; draw(); });
        const s2 = h('select', { class: 'input', disabled: o.dedupe ? null : true }, [['last', 'Keep the copy from the newest file'], ['first', 'Keep the first copy found']].map(([v, l]) => h('option', { value: v, selected: (o.keep || 'last') === v ? true : null }, l)));
        s2.addEventListener('change', () => { o.keep = s2.value; draw(); });
        dupBox.append(h('label', null, 'Duplicates'), h('div', { class: 'row2' }, s1, s2));
      }
      colsBox.innerHTML = '';
      colsBox.append(...t.header.map((nm, i) => h('span', { class: `col-chip ${i < t.pre ? 'auto' : ''}` }, nm)));
      fileList.innerHTML = '';
      fileList.append(h('div', { class: 'df-row df-head' }, h('span', null, 'File'), h('span', null, 'Worksheet'), h('span', null, 'Header'), h('span', null, 'Rows'), h('span', null, 'Notes')));
      res.report.forEach((r) => {
        const notes = r.error ? r.error : [r.missing.length ? `missing ${r.missing.slice(0, 3).join(', ')}${r.missing.length > 3 ? '…' : ''}` : '', r.extra.length ? `extra ${r.extra.slice(0, 3).join(', ')}${r.extra.length > 3 ? '…' : ''}` : '', r.skipped ? `${r.skipped} total/header rows skipped` : ''].filter(Boolean).join(' · ') || 'Matches';
        fileList.append(h('div', { class: `df-row ${r.error ? 'is-err' : r.missing.length || r.extra.length ? 'is-warn' : 'is-ok'}`, title: r.file.path },
          h('span', { class: 'df-name' }, h('i'), r.file.name), h('span', null, r.sheet || '-'), h('span', null, r.headerRow ? `row ${r.headerRow}` : '-'), h('span', null, r.rows != null ? r.rows.toLocaleString() : '-'), h('span', { class: 'df-note' }, notes)));
      });
    };
    const field = (label, ctl) => h('div', { class: 'field' }, h('label', null, label), ctl);
    const sel = (list, cur, on) => { const s = h('select', { class: 'input' }, list.map(([v, l]) => h('option', { value: v, selected: v === cur ? true : null }, l))); s.addEventListener('change', () => { on(s.value); draw(); }); return s; };
    const chk = (key, label, disabled) => { const c = h('input', { type: 'checkbox' }); c.checked = !!o[key]; c.disabled = !!disabled; c.addEventListener('change', () => { o[key] = c.checked; draw(); }); return h('label', { class: 'chk', title: disabled || '' }, c, h('span', null, label)); };
    const nameIn = h('input', { class: 'input', value: o.name }); nameIn.addEventListener('input', () => { o.name = nameIn.value; });
    const headIn = h('input', { class: 'input', type: 'number', min: 1, placeholder: 'Auto' }); headIn.addEventListener('change', () => { const v = parseInt(headIn.value, 10); o.headerRow = v > 0 ? v - 1 : null; draw(); });
    const body = h('div', { class: 'dset-dlg' },
      summary,
      h('div', { class: 'row2' }, field('Data set name', nameIn),
        field('Worksheet in each file', sel([['auto', 'Match automatically'], ...res.sheetNames.slice(0, 40).map((n) => [n, `“${n}” in every file`]), ['all', 'All worksheets, stacked'], ['dated', 'Every tab with a date in its name, stacked']], o.sheetMode, (v) => { o.sheetMode = v; }))),
      h('div', { class: 'row2' },
        field('Line columns up', sel([['name', 'By header name (any order)'], ['position', 'By position (same layout)']], o.match, (v) => { o.match = v; })),
        field('Header row', headIn)),
      h('div', { class: 'dset-checks' },
        chk('source', 'Add a “Source” column'),
        chk('period', res.allDated ? `Add a “Period” column from ${o.sheetMode === 'dated' ? 'tab' : 'file'} names` : 'Add a “Period” column (no dates found in file names)', !res.allDated && 'File names need a date, month, quarter or year in them, e.g. Sales 2024-03.xlsx'),
        chk('skipTotals', 'Skip total rows'),
        chk('board', 'Build a dashboard next'),
        chk('dashboard', 'Build a quick report next')),
      dupBox,
      h('div', { class: 'field' }, h('label', null, 'Columns'), colsBox),
      h('div', { class: 'field' }, h('label', null, 'Files'), fileList));
    draw();
    D.modal({ title: 'Combine into a data set', width: 760, body, actions: [{ label: 'Cancel' }, { label: 'Create data set', primary: true, onClick: () => { setTimeout(() => DSET.create(src, files, res, o), 0); } }] });
  };

  DSET.create = async (src, files, res, o) => {
    if (!res.records.length) return D.toast('No rows found to combine', 'warn');
    if (!D.project()) {
      await D.io.newProject('blank');
      if (!D.project()) return;
      D.project().sheets = [];
      D.project().name = o.name || 'Data Set';
    }
    const sheet = D.app.addSheet('data', { activate: false, name: D.uniqueSheetName(o.name || 'Data Set') });
    const { n, ncol } = fill(sheet, res, o);
    sheet.dataset = describe(src, files, res, o, ncol);
    D.dataVersion++;
    D.commit();
    D.app.activate(sheet.id, true);
    D.toast(`Data set ready: ${n.toLocaleString()} rows from ${files.length} file${files.length > 1 ? 's' : ''}`, 'ok', 4500);
    if (o.board) setTimeout(() => D.sheetTypes.dash.createFor([sheet.id], `${sheet.name} Dashboard`), 150);
    if (o.dashboard && D.dash) setTimeout(() => D.dash.open(sheet, `A1:${F().colName(ncol - 1)}${n + 1}`), o.board ? 600 : 250);
    return sheet;
  };

  function describe(src, files, res, o, ncol) {
    return {
      mode: src.mode, dir: src.dir || null, recursive: !!src.recursive, paths: src.mode === 'files' ? files.map((f) => f.path) : null,
      opts: { sheetMode: o.sheetMode, match: o.match, source: o.source, period: o.period, skipTotals: o.skipTotals, headerRow: o.headerRow, dedupe: o.dedupe || null, dedupeName: o.dedupe ? ((res.columns.find((c) => c.key === o.dedupe) || {}).name || null) : null, keep: o.keep || 'last' },
      files: res.report.map((r) => ({ path: r.file.path, name: r.file.name, mtime: r.file.mtime, rows: r.rows || 0, error: r.error || null })),
      width: ncol, builtAt: Date.now()
    };
  }

  // the project's own saved files never count as data set files (a set built from the project folder would feed on itself)
  const ownFile = (fp) => { const d = D.project() && D.project().dir; return !!d && String(fp).startsWith(String(d).replace(/[\\/]$/, '') + (String(d).includes('\\') ? '\\' : '/')); };
  const srcOf = (ds) => (ds.mode === 'folder' ? { mode: 'folder', dir: ds.dir, recursive: ds.recursive } : { mode: 'files', paths: ds.paths || [] });

  DSET.refresh = async (sheet, how = {}) => {
    const ds = sheet && sheet.dataset;
    if (!ds) return;
    const src = srcOf(ds);
    const files = (await listFiles(src)).filter((f) => !ownFile(f.path));
    if (!files.length) return how.quiet ? null : D.toast(ds.mode === 'folder' ? `No spreadsheets found in ${ds.dir}` : 'None of the data set’s files could be found', 'warn', 5000);
    const pm = how.quiet ? { set: () => {}, close: () => {} } : progressModal('Refreshing data set');
    let loaded;
    try { loaded = await analyse(files, {}, pm.set); } finally { pm.close(); }
    const o = { ...ds.opts };
    const res = combine(loaded, o);
    // nothing readable (a workbook half-saved by Excel or still syncing): keep the rows we have and wait for the next save
    if (!res.records.length && res.report.some((r) => r.error)) {
      const err = res.report.find((r) => r.error);
      sheet.dataset = { ...ds, files: files.map((f) => ({ path: f.path, name: f.name, mtime: f.mtime, rows: 0, error: err.error })) };
      D.toast(`“${sheet.name}” couldn't read ${err.file.name} (${err.error}), so it kept its last ${Math.max(0, D.f.usedRows ? D.f.usedRows(sheet) - 1 : 0).toLocaleString()} rows. It will try again the next time the file is saved.`, 'warn', 9000);
      return;
    }
    if (!res.allDated) o.period = false;
    const before = Math.max(0, D.f.usedRows ? D.f.usedRows(sheet) - 1 : 0);
    const prevFiles = new Set((ds.files || []).map((f) => f.path));
    const added = files.filter((f) => !prevFiles.has(f.path)).length;
    const changed = files.filter((f) => { const p = (ds.files || []).find((x) => x.path === f.path); return p && p.mtime !== f.mtime; }).length;
    const { n, ncol } = fill(sheet, res, o);
    sheet.dataset = { ...describe(src, files, res, o, ncol), ...(ds.auto === false ? { auto: false } : {}), ...(ds.autoRebuild === false ? { autoRebuild: false } : {}) };
    // anything that pointed at the whole column of data (e.g. E2:E63) now reaches the new last row
    if (before && before !== n) growRefs(sheet, before + 1, n + 1);
    D.dataVersion++;
    D.commit();
    D.app.renderAll();
    const dashes = D.dash ? D.dash.dashboardsOf(sheet) : [];
    const rebuilt = how.quiet && dashes.length && ds.autoRebuild !== false;
    if (rebuilt) { dashes.forEach((d) => D.dash.rebuild(d)); D.dataVersion++; D.commit(); D.app.renderAll(); }
    else if (dashes.length && !how.quiet) {
      D.modal({ title: 'Update reports?', width: 460,
        body: h('p', { class: 'muted' }, `${dashes.map((d) => `“${d.name}”`).join(', ')} ${dashes.length > 1 ? 'were' : 'was'} built from this data set. Rebuild ${dashes.length > 1 ? 'them' : 'it'} so new periods and categories show up? Manual changes on ${dashes.length > 1 ? 'those dashboards' : 'that dashboard'} will be replaced.`),
        actions: [{ label: 'Keep as is' }, { label: `Rebuild ${dashes.length > 1 ? dashes.length + ' reports' : 'report'}`, primary: true, onClick: () => { dashes.forEach((d) => D.dash.rebuild(d)); D.dataVersion++; D.commit(); D.app.renderAll(); D.toast('Reports rebuilt with the latest data', 'ok'); } }] });
    }
    const bits = [`${n.toLocaleString()} rows`];
    if (added) bits.push(`${added} new file${added > 1 ? 's' : ''}`);
    if (changed) bits.push(`${changed} updated`);
    const missing = (ds.paths || []).length && ds.mode === 'files' ? (ds.paths.length - files.length) : 0;
    if (missing > 0) bits.push(`${missing} missing`);
    if (rebuilt) bits.push(`${dashes.length} report${dashes.length > 1 ? 's' : ''} rebuilt`);
    D.toast(`${how.quiet ? `“${sheet.name}” updated from its ${ds.mode === 'folder' ? 'folder' : 'files'}` : 'Data set refreshed'} · ${bits.join(' · ')}${before && before !== n ? ` (was ${before.toLocaleString()})` : ''}`, 'ok', 6000);
  };

  // ---------------------------------------------------------------- staying current
  // Data sets watch their folder (or files): when a file is added, changed or removed, the set re-reads
  // itself, and every dashboard and report built on it follows. Checked every 20 s and when Datum regains focus.
  const sig = (list) => [...new Set(list.map((f) => `${f.path}|${Math.round(f.mtime || 0)}`))].sort().join('\n');
  let checking = false;
  DSET.check = async () => {
    if (checking || !D.project() || document.hidden) return;
    const sets = D.project().sheets.filter((s) => s.dataset && s.dataset.auto !== false);
    if (!sets.length) return;
    // never pull data out from under someone who is typing or answering a dialog
    const v = D.app.view && D.app.view();
    if (document.querySelector('.modal-back') || (v && v.editor)) return;
    checking = true;
    try {
      for (const s of sets) {
        const ds = s.dataset;
        let files;
        try { files = (await listFiles(srcOf(ds))).filter((f) => !ownFile(f.path)); } catch { continue; }
        if (!files.length) continue; // folder offline or unplugged: keep what we have
        if (sig(files) === sig(ds.files || [])) continue;
        if (!D.project() || !D.project().sheets.includes(s)) continue;
        await DSET.refresh(s, { quiet: true });
      }
    } finally { checking = false; }
  };
  setInterval(() => { DSET.check(); }, 20000);
  window.addEventListener('focus', () => setTimeout(() => DSET.check(), 400));

  function growRefs(target, oldLast, newLast) {
    const p = D.project();
    const tName = target.name.toLowerCase();
    const re = /"[^"]*"|((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?[A-Za-z]{1,3}\$?)(\d+):(\$?[A-Za-z]{1,3})(\$?)(\d+)(?![\w(])/g;
    const fix = (src, ownerIsTarget) => String(src).replace(re, (m, pre, a, r1, b, d2, r2) => {
      if (m[0] === '"') return m;
      const sn = pre ? pre.slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'").toLowerCase() : null;
      if (sn ? sn !== tName : !ownerIsTarget) return m;
      if (+r2 !== oldLast || +r1 > 2) return m;
      return `${pre || ''}${a}${r1}:${b}${d2}${newLast}`;
    });
    for (const s of p.sheets) {
      if (s.type === 'data') s.cells.forEach((row) => row.forEach((v, i) => { if (typeof v === 'string' && v[0] === '=') row[i] = fix(v, s === target); }));
      const els = s.type === 'slide' ? s.slides.flatMap((x) => x.elements) : s.type === 'report' ? s.elements : [];
      els.forEach((e) => {
        if (e.link && e.link.sheetId === target.id) e.link.range = e.link.range.split(',').map((rg) => fix(rg, true)).join(',');
        ['text', 'label'].forEach((k) => { if (typeof e[k] === 'string') e[k] = e[k].replace(/\{\{([^}]*)\}\}/g, (_, x) => `{{${fix(x, false)}}}`); });
        ['expr', 'compareExpr'].forEach((k) => { if (e[k]) e[k] = fix(e[k], false); });
      });
      if (s.type === 'docu' && s.html) s.html = s.html.replace(/data-sheet="([^"]+)" data-range="([^"]+)"/g, (m, id, rg) => (id === target.id ? `data-sheet="${id}" data-range="${fix(rg, true)}"` : m));
      if (s.dashSource && s.dashSource.sheetId === target.id) s.dashSource.range = fix(s.dashSource.range, true);
    }
    if (target.cf) target.cf.forEach((rule) => { rule.range = fix(rule.range, true); });
  }

  DSET.info = (sheet) => {
    const ds = sheet.dataset;
    if (!ds) return;
    const tog = (key, label) => { const c = h('input', { type: 'checkbox' }); c.checked = ds[key] !== false; c.addEventListener('change', () => { ds[key] = c.checked; D.commit({ data: false }); }); return h('label', { class: 'chk' }, c, h('span', null, label)); };
    const list = h('div', { class: 'dset-files' },
      h('div', { class: 'df-row df-head' }, h('span', null, 'File'), h('span', null, 'Rows'), h('span', null, 'Modified'), h('span'), h('span')),
      ...(ds.files || []).map((f) => h('div', { class: `df-row ${f.error ? 'is-err' : 'is-ok'}`, title: f.path }, h('span', { class: 'df-name' }, h('i'), f.name), h('span', null, f.error ? f.error : f.rows.toLocaleString()), h('span', null, f.mtime ? new Date(f.mtime).toLocaleDateString() : ''), h('span'), h('span'))));
    D.modal({ title: `${sheet.name} · data set`, width: 640,
      body: h('div', { class: 'dset-dlg' },
        h('p', { class: 'muted' }, ds.mode === 'folder' ? `Every spreadsheet in ${ds.dir}${ds.recursive ? ' and its subfolders' : ''}.` : `${(ds.paths || []).length} chosen files.`, ` Last updated ${new Date(ds.builtAt).toLocaleString()}.`),
        h('div', { class: 'dset-checks' },
          tog('auto', ds.mode === 'folder' ? 'Update automatically when files are added to the folder or changed' : 'Update automatically when these files change'),
          tog('autoRebuild', 'Rebuild reports made from it when it updates (dashboards always stay live)')),
        ds.opts && ds.opts.dedupe ? h('p', { class: 'muted small' }, `Repeats of the same ${(ds.opts.dedupeName || 'ID')} are removed, keeping ${ds.opts.keep === 'first' ? 'the first copy found' : 'the copy from the newest file'}.`) : null,
        list),
      actions: [{ label: 'Close' }, { label: 'Refresh now', primary: true, onClick: () => { setTimeout(() => DSET.refresh(sheet), 0); } }] });
  };
})();
