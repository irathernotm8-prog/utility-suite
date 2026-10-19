// Datum - duplicates: find the column that identifies each record (an ID, order number, email…),
// show which records appear more than once, and flag, filter or remove them.
(function () {
  const DU = (D.dupes = {});
  const h = D.h;
  const F = () => D.f;
  const ID_RE = /(\bid\b|_id$|^id$|number|\bno\.?$|\bnum\b|#|code|email|e-mail|account|order|invoice|ticket|sku|serial|reference|\bref\b|object|customer|member|policy|case|phone|mobile)/i;
  const blank = (v) => v === '' || v == null || /^\s*[-–—.]?\s*$/.test(String(v)); // "-" placeholders aren't IDs
  const keyOf = (v) => String(v).trim().toLowerCase();

  // columns that look like they name each record once
  DU.candidates = (p) => {
    const out = [];
    for (const c of p.cols) {
      if (c.type === 'empty' || c.type === 'date' || c.role === 'constant' || c.role === 'measure' || c.role === 'ratio' || c.role === 'time') continue;
      if (!c.n || c.n < Math.max(2, p.n * 0.6)) continue;
      const ratio = c.distinct / c.n;
      const named = ID_RE.test(c.name);
      if (ratio < (named ? 0.5 : 0.85)) continue;
      const counts = new Map();
      c.vals.forEach((v) => { if (!blank(v)) { const k = keyOf(v); counts.set(k, (counts.get(k) || 0) + 1); } });
      let groups = 0, extra = 0;
      for (const x of counts.values()) if (x > 1) { groups++; extra += x - 1; }
      const score = ratio * 2 + (named ? 1.5 : 0) + (c.role === 'id' || c.role === 'entity' || c.role === 'label' ? 0.5 : 0) + c.n / p.n - (/name$/i.test(c.name) && !/user ?name/i.test(c.name) ? 0.8 : 0) - (/street|address/i.test(c.name) ? 0.4 : 0);
      out.push({ c: c.c, name: c.name, n: c.n, distinct: c.distinct, groups, extra, score });
    }
    return out.sort((a, b) => b.score - a.score);
  };

  // records grouped by the chosen key column(s)
  DU.scan = (sheet, p, cols) => {
    const map = new Map();
    for (let r = p.r0; r <= p.rN; r++) {
      const parts = cols.map((c) => F().cellValue(sheet, r, c));
      if (parts.every(blank)) continue;
      const k = parts.map((v) => (blank(v) ? '' : keyOf(v))).join('\u0001');
      if (!map.has(k)) map.set(k, { shown: parts.map((v) => String(v ?? '').trim()).join(' · '), rows: [] });
      map.get(k).rows.push(r);
    }
    const groups = [...map.values()].filter((g) => g.rows.length > 1).map((g) => ({ key: g.shown, rows: g.rows }));
    groups.sort((a, b) => b.rows.length - a.rows.length || a.rows[0] - b.rows[0]);
    return { groups, extra: groups.reduce((a, g) => a + g.rows.length - 1, 0), unique: map.size };
  };

  DU.open = (sheet, range) => {
    range = range && F().parseRange(range) && F().parseRange(range).areas[0].r2 > F().parseRange(range).areas[0].r1 ? range : D.links.autoRange(sheet);
    let p;
    try { p = D.dash.profile(sheet, range); } catch { return D.toast('Could not read a table on this sheet', 'warn'); }
    if (!p.hasHeader || p.n < 2) return D.toast('Select a table with a header row first', 'warn');
    const cands = DU.candidates(p);
    const usable = p.cols.filter((c) => c.type !== 'empty');
    let keys = cands.length ? [cands[0].c] : [usable[0].c];
    const nameOf = (c) => (p.cols.find((x) => x.c === c) || {}).name || F().colName(c);
    const result = h('div', { class: 'dup-result' });
    const keyBox = h('div', { class: 'dup-keys' });
    const drawKeys = () => {
      keyBox.innerHTML = '';
      usable.forEach((c) => {
        const cb = h('input', { type: 'checkbox' }); cb.checked = keys.includes(c.c);
        cb.addEventListener('change', () => { keys = cb.checked ? [...keys, c.c] : keys.filter((x) => x !== c.c); if (!keys.length) { keys = [c.c]; cb.checked = true; } run(); });
        const cand = cands.find((x) => x.c === c.c);
        keyBox.append(h('label', { class: 'chk dup-key' + (cand && cand === cands[0] ? ' is-best' : '') }, cb, h('span', null, c.name), cand && cand === cands[0] ? h('em', { class: 'muted small' }, ' likely ID') : null));
      });
    };
    let res = null;
    const run = () => {
      res = DU.scan(sheet, p, keys);
      result.innerHTML = '';
      const what = keys.map(nameOf).join(' + ');
      if (!res.groups.length) {
        result.append(h('div', { class: 'dup-ok' }, h('b', null, 'No duplicates. '), `Every one of the ${p.n.toLocaleString()} rows has a different ${what}.`));
        return;
      }
      result.append(h('div', { class: 'dup-sum' }, h('b', null, `${res.extra.toLocaleString()} duplicate row${res.extra > 1 ? 's' : ''}`), ` · ${res.groups.length.toLocaleString()} ${what} value${res.groups.length > 1 ? 's appear' : ' appears'} more than once · ${res.unique.toLocaleString()} unique of ${p.n.toLocaleString()} rows`));
      const list = h('div', { class: 'dup-list' },
        h('div', { class: 'dup-row dup-head' }, h('span', null, what), h('span', null, 'Times'), h('span', null, 'Rows')),
        ...res.groups.slice(0, 200).map((g) => h('div', { class: 'dup-row', title: 'Click to go to the first copy', onclick: () => { const v = D.app.view && D.app.view(); if (v && v.sheet === sheet && v.setActive) { v.setActive(g.rows[1], keys[0]); v.scrollTo && v.scrollTo(g.rows[1], keys[0]); } } },
          h('span', null, g.key || '(blank)'), h('span', null, String(g.rows.length)), h('span', { class: 'muted' }, g.rows.slice(0, 6).map((r) => r + 1).join(', ') + (g.rows.length > 6 ? '…' : '')))));
      result.append(list);
      if (res.groups.length > 200) result.append(h('p', { class: 'muted small' }, `Showing the 200 biggest groups of ${res.groups.length.toLocaleString()}.`));
    };
    drawKeys(); run();
    const lastCol = Math.max(...p.cols.map((c) => c.c));
    const actions = [
      { label: 'Close' },
      { label: 'Highlight', title: 'Shade every copy with conditional formatting', onClick: () => DU.highlight(sheet, p, keys) },
      { label: 'Add a check column', title: 'A live column that says Unique, First or Repeat on every row (filter it to see the repeats)', onClick: () => DU.checkColumn(sheet, p, keys, lastCol) },
      { label: 'Remove repeats…', primary: true, onClick: () => { if (!res || !res.extra) { D.toast('Nothing to remove', 'info'); return false; } return DU.remove(sheet, p, res); } }
    ];
    D.modal({ title: 'Duplicates', width: 640, body: h('div', { class: 'dup-dlg' },
      h('p', { class: 'muted small' }, `Rows ${p.r0 + 1}-${p.rN + 1} of ${sheet.name}. A row counts as a duplicate when it has the same value as an earlier row in the column${keys.length > 1 ? 's' : ''} you tick (capitals and spaces ignored).`),
      h('div', { class: 'field' }, h('label', null, 'Identify each record by'), keyBox),
      result), actions });
  };

  DU.highlight = (sheet, p, keys) => {
    if (keys.length > 1) { D.toast('Highlighting works on one column - shading the first one ticked', 'info'); }
    const c = keys[0];
    const range = `${F().colName(c)}${p.r0 + 1}:${F().colName(c)}${p.rN + 1}`;
    sheet.cf = (sheet.cf || []).filter((r) => !(r.type === 'dup' && r.range === range));
    sheet.cf.push({ id: D.uid(), range, type: 'dup', fill: '#FFC7CE', color: '#9C0006' });
    D.commit(); D.app.renderAll && D.app.renderAll();
    D.toast(`Duplicates in ${range} are shaded red`, 'ok');
  };

  // a live Excel-compatible column: Unique / First / Repeat
  DU.checkColumn = (sheet, p, keys, lastCol) => {
    let c = lastCol + 1;
    while (sheet.cells.some((row, r) => r >= p.hr && r <= p.rN && !blank(row[c]))) c++;
    const col = F().colName(c);
    const a = (k, r) => `$${F().colName(k)}$${r}`;
    for (let r = p.hr; r <= p.rN; r++) { while ((sheet.cells[r] || []).length <= c) sheet.cells[r].push(''); }
    if (sheet.cells[0].length <= c) sheet.cells.forEach((row) => { while (row.length <= c) row.push(''); });
    sheet.cells[p.hr][c] = 'Duplicate?';
    const first = p.r0 + 1, last = p.rN + 1;
    for (let r = p.r0; r <= p.rN; r++) {
      const R = r + 1;
      let f;
      if (keys.length === 1) {
        const k = F().colName(keys[0]);
        f = `=IF(${k}${R}="","",IF(COUNTIF(${a(keys[0], first)}:$${k}$${last},${k}${R})=1,"Unique",IF(COUNTIF(${a(keys[0], first)}:${k}${R},${k}${R})=1,"First","Repeat")))`;
      } else {
        const all = keys.map((k) => `${a(k, first)}:$${F().colName(k)}$${last},${F().colName(k)}${R}`).join(',');
        const upto = keys.map((k) => `${a(k, first)}:${F().colName(k)}${R},${F().colName(k)}${R}`).join(',');
        f = `=IF(COUNTIFS(${all})=1,"Unique",IF(COUNTIFS(${upto})=1,"First","Repeat"))`;
      }
      sheet.cells[r][c] = f;
    }
    const st = sheet.styles[`${p.hr},${keys[0]}`];
    if (st) sheet.styles[`${p.hr},${c}`] = D.clone(st);
    sheet.cf = sheet.cf || [];
    sheet.cf.push({ id: D.uid(), range: `${col}${first}:${col}${last}`, type: 'text', v1: 'Repeat', fill: '#FFC7CE', color: '#9C0006' });
    D.commit(); D.app.renderAll && D.app.renderAll();
    D.toast(`Added “Duplicate?” in column ${col}. Filter it to Repeat to see only the copies.`, 'ok', 5000);
  };

  // delete every copy after the first (one undo step)
  DU.remove = (sheet, p, res) => {
    const drop = new Set(res.groups.flatMap((g) => g.rows.slice(1)));
    D.modal({ title: 'Remove repeats?', width: 460,
      body: h('p', null, `Delete ${drop.size.toLocaleString()} row${drop.size > 1 ? 's' : ''} that repeat an earlier record? The first copy of each stays. You can undo this (Ctrl+Z).`),
      actions: [{ label: 'Cancel' }, { label: `Delete ${drop.size.toLocaleString()} rows`, danger: true, primary: true, onClick: () => {
        // formulas, links, styles and ranges follow their rows; references to a removed row slide to the next one
        const before = []; let kept = 0;
        for (let r = 0; r <= sheet.cells.length; r++) { before[r] = kept; if (!drop.has(r)) kept++; }
        D.sheetTypes.data.remapRefs(sheet, { r: (r) => (r < before.length ? before[r] : r - drop.size), goneR: (r) => drop.has(r) });
        const width = sheet.cells[0].length;
        const keep = sheet.cells.filter((_, r) => !drop.has(r));
        while (keep.length < sheet.cells.length) keep.push(Array(width).fill(''));
        sheet.cells = keep;
        D.dataVersion++; D.commit(); D.app.renderAll && D.app.renderAll();
        D.toast(`Removed ${drop.size.toLocaleString()} repeated rows`, 'ok');
      } }] });
  };
})();
