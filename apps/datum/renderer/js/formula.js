// Datum - formula engine + cell addressing + live links
(function () {
  const F = (D.f = {});
  const ERR = (code) => ({ err: code });
  const isErr = (v) => v && typeof v === 'object' && 'err' in v;
  F.isErr = isErr;


  // ---------- addressing
  F.colName = (c) => { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
  F.colIndex = (s) => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  F.addr = (r, c) => F.colName(c) + (r + 1);
  F.parseAddr = (a) => { const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(a).trim()); return m ? { r: +m[2] - 1, c: F.colIndex(m[1]) } : null; };
  const MAXR = 1048575, MAXC = 16383;
  // one area: A1, A1:B5, A:C (whole columns), 3:5 (whole rows)
  F.parseArea = (s) => {
    const t = String(s || '').trim().replace(/\$/g, '');
    let m;
    if ((m = /^([A-Za-z]{1,3})(\d+)(?::([A-Za-z]{1,3})(\d+))?$/.exec(t))) {
      const r1 = +m[2] - 1, c1 = F.colIndex(m[1]);
      const r2 = m[3] ? +m[4] - 1 : r1, c2 = m[3] ? F.colIndex(m[3]) : c1;
      return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
    }
    if ((m = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})$/.exec(t))) { const a = F.colIndex(m[1]), b = F.colIndex(m[2]); return { r1: 0, r2: MAXR, c1: Math.min(a, b), c2: Math.max(a, b), wholeCol: true }; }
    if ((m = /^(\d+):(\d+)$/.exec(t))) { const a = +m[1] - 1, b = +m[2] - 1; return { r1: Math.min(a, b), r2: Math.max(a, b), c1: 0, c2: MAXC, wholeRow: true }; }
    return null;
  };
  // A range string may hold several areas ("A1:A9,C1:C9"). Returns the bounding box with .areas attached.
  F.parseRange = (s) => {
    if (!s) return null;
    const parts = String(s).split(',').map((x) => x.trim()).filter(Boolean);
    const areas = parts.map(F.parseArea);
    if (!areas.length || areas.some((a) => !a)) return null;
    const g = { r1: Math.min(...areas.map((a) => a.r1)), c1: Math.min(...areas.map((a) => a.c1)), r2: Math.max(...areas.map((a) => a.r2)), c2: Math.max(...areas.map((a) => a.c2)) };
    Object.defineProperty(g, 'areas', { value: areas, enumerable: false });
    return g;
  };
  F.areas = (s) => { const g = F.parseRange(s); return g ? g.areas : []; };
  F.rangeStr = (g) => {
    if (g.areas && g.areas.length > 1) return g.areas.map(F.rangeStr).join(',');
    if (g.wholeCol) return `${F.colName(g.c1)}:${F.colName(g.c2)}`;
    return g.r1 === g.r2 && g.c1 === g.c2 ? F.addr(g.r1, g.c1) : `${F.addr(g.r1, g.c1)}:${F.addr(g.r2, g.c2)}`;
  };
  F.areasStr = (list) => list.map((a) => F.rangeStr(a)).join(',');
  F.inAreas = (list, r, c) => list.some((a) => r >= a.r1 && r <= a.r2 && c >= a.c1 && c <= a.c2);
  F.quoteSheet = (name) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

  // ---------- value cache (per dataVersion)
  let cacheVer = -1;
  let cache = new Map();
  let cycleHits = 0;
  let cacheLog = null; // keys cached while a spill candidate is evaluated
  const rangeCache = new Map(); // big ranges are read once per calc (lookups over 40k rows were rebuilding them per cell)
  const visiting = new Set();
  const spillState = new Map(); // sheetId -> { map: Map("r,c" -> value), blocked: Set(srcKey) }
  const usedCache = new Map();
  function checkCache() { if (cacheVer !== D.dataVersion) { cache = new Map(); rangeCache.clear(); spillState.clear(); usedCache.clear(); cacheVer = D.dataVersion; } }

  F.parseLiteral = (raw) => {
    const s = String(raw).trim();
    if (s === '') return '';
    if (/^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?([eE][-+]?\d+)?$/.test(s) && /\d/.test(s)) return +s.replace(/,/g, '');
    if (/^-?\$\s?[\d,]+(\.\d+)?$/.test(s)) return +s.replace(/[$,\s]/g, '');
    if (/^\(\$?[\d,]+(\.\d+)?\)$/.test(s)) return -s.replace(/[()$,]/g, '');
    if (/^[-+]?[\d.]+%$/.test(s)) return parseFloat(s) / 100;
    if (/^true$/i.test(s)) return true;
    if (/^false$/i.test(s)) return false;
    if (/^#(N\/A|DIV\/0!|REF!|VALUE!|NAME\?|NUM!|NULL!|SPILL!|CALC!)$/.test(s)) return ERR(s);
    return raw;
  };

  // last used row per sheet (bounds whole-column references)
  F.usedRows = (sheet) => {
    checkCache();
    if (usedCache.has(sheet.id)) return usedCache.get(sheet.id);
    let n = 0;
    for (let r = sheet.cells.length - 1; r >= 0; r--) { if (sheet.cells[r].some((v) => v !== '' && v != null)) { n = r + 1; break; } }
    usedCache.set(sheet.id, n);
    return n;
  };
  const usedCols = (sheet) => (sheet.cells[0] ? sheet.cells[0].length : 0);

  // which formula ASTs can produce an array (and so might spill)
  const ARRAY_FNS = new Set(['FILTER', 'SORT', 'SORTBY', 'UNIQUE', 'SEQUENCE', 'TRANSPOSE', 'TAKE', 'DROP', 'CHOOSECOLS', 'CHOOSEROWS', 'VSTACK', 'HSTACK', 'TEXTSPLIT', 'TOCOL', 'TOROW', 'RANDARRAY', 'MMULT', 'FREQUENCY', 'EXPAND', 'WRAPROWS', 'WRAPCOLS', 'OFFSET', 'INDIRECT']);
  F.ARRAY_FNS = ARRAY_FNS;
  const mayArray = (n) => {
    if (!n) return false;
    if (n.k === 'ref') return n.multi;
    if (n.k === 'arr') return true;
    if (n.k === 'fn') return ARRAY_FNS.has(n.name) || (n.name === 'IF' && n.args.some(mayArray)) || (n.name === 'INDEX' && n.args.length > 1 && n.args.slice(1).some((a) => a.k === 'num' && a.v === 0)) || (n.name === 'LET' && mayArray(n.args[n.args.length - 1]));
    if (n.k === 'bin') return mayArray(n.l) || mayArray(n.r);
    if (n.k === 'neg') return mayArray(n.e);
    return false;
  };
  // build spill map for a sheet: evaluate array-capable formulas once per data version
  function spills(sheet) {
    checkCache();
    let st = spillState.get(sheet.id);
    if (st && st.dirty && !visiting.size && !st.building) { spillState.delete(sheet.id); st = null; }
    if (st) return st;
    st = { map: new Map(), blocked: new Set(), src: new Map(), absorbed: new Set(), building: true };
    spillState.set(sheet.id, st);
    const cells = sheet.cells;
    const cand = [];
    for (let r = 0; r < cells.length; r++) {
      const row = cells[r];
      for (let c = 0; c < row.length; c++) {
        const raw = row[c];
        if (typeof raw !== 'string' || raw[0] !== '=') continue;
        try { if (mayArray(F.compile(cleanSrc(raw.slice(1))))) cand.push([r, c]); } catch { /* ignore */ }
      }
    }
    st.building = false;
    for (const [r, c] of cand) {
      // a candidate that runs into a formula still being worked out (this map was asked for mid-calculation)
      // gets a #CYCLE! that isn't real: forget what it cached and build the map again once the calc is done
      const before = cycleHits, outer = cacheLog;
      cacheLog = [];
      const v = evalCell(sheet, r, c);
      const added = cacheLog;
      cacheLog = outer ? outer.concat(added) : null;
      if (cycleHits !== before) { for (const k of added) cache.delete(k); st.dirty = true; continue; }
      if (!v || !v.range) continue;
      const arr = v.range;
      if (arr.length === 1 && arr[0].length === 1) continue;
      let blocked = false;
      const absorb = [];
      for (let i = 0; i < arr.length && !blocked; i++) for (let j = 0; j < arr[i].length; j++) {
        if (!i && !j) continue;
        const rr = r + i, cc = c + j;
        const raw = cells[rr] && cells[rr][cc];
        if (st.map.has(rr + ',' + cc)) { blocked = true; break; }
        if (raw !== '' && raw != null) {
          // first open after importing an Excel file: Excel saved the spilled values as plain cells
          const want = arr[i][j];
          if (sheet.absorbSpill && (String(raw) === String(want) || (typeof want === 'number' && Math.abs(+raw - want) < 1e-9))) { absorb.push([rr, cc]); continue; }
          blocked = true; break;
        }
      }
      const key = r + ',' + c;
      if (blocked) { st.blocked.add(key); continue; }
      absorb.forEach(([rr, cc]) => st.absorbed.add(rr + ',' + cc));
      for (let i = 0; i < arr.length; i++) for (let j = 0; j < arr[i].length; j++) {
        if (!i && !j) continue;
        st.map.set((r + i) + ',' + (c + j), arr[i][j] == null ? '' : arr[i][j]);
        st.src.set((r + i) + ',' + (c + j), key);
      }
      st.src.set(key, key);
    }
    return st;
  }
  F.spillInfo = (sheet, r, c) => { const st = spills(sheet); const src = st.src.get(r + ',' + c); return src ? { src, isSource: src === r + ',' + c } : null; };

  function cleanSrc(src) { return src; }
  function evalCell(sheet, r, c) {
    const key = sheet.id + ':' + r + ':' + c + ':raw';
    if (cache.has(key)) return cache.get(key);
    const raw = sheet.cells[r][c];
    const ckey = sheet.id + ':' + r + ':' + c;
    if (visiting.has(ckey)) { cycleHits++; return ERR('#CYCLE!'); }
    visiting.add(ckey);
    let v;
    try { v = ev(F.compile(raw.slice(1)), { sheet, r, c }); }
    catch (e) { v = ERR(e.code || '#ERROR!'); if (e.ext) v.ext = true; }
    visiting.delete(ckey);
    if (typeof v === 'number' && !isFinite(v)) v = ERR('#NUM!');
    cache.set(key, v); if (cacheLog) cacheLog.push(key);
    return v;
  }
  const FALLBACK_ERRS = new Set(['#NAME?', '#PARSE!', '#ERROR!']);
  F.cellValue = (sheet, r, c) => {
    checkCache();
    const key = sheet.id + ':' + r + ':' + c;
    if (cache.has(key)) return cache.get(key);
    const raw = (sheet.cells[r] && sheet.cells[r][c]) ?? '';
    let v;
    if (typeof raw === 'string' && raw.startsWith('=') && raw.length > 1) {
      if (visiting.has(key)) { cycleHits++; return ERR('#CYCLE!'); }
      v = evalCell(sheet, r, c);
      if (v && v.range) {
        const st = spillState.get(sheet.id);
        if (st && !st.building && st.blocked.has(r + ',' + c)) v = ERR('#SPILL!');
        else v = v.range.length && v.range[0].length ? v.range[0][0] : ERR('#CALC!');
        if (v == null) v = '';
      }
      // a function or reference Datum can't compute (e.g. an external workbook): keep Excel's saved result
      if (isErr(v) && (FALLBACK_ERRS.has(v.err) || v.ext) && sheet.cached && (r + ',' + c) in sheet.cached) {
        const cv = sheet.cached[r + ',' + c];
        v = typeof cv === 'string' ? F.parseLiteral(cv) : cv;
        if (v && typeof v === 'object' && !isErr(v)) v = String(v);
        markFallback(sheet, r, c);
      }
    } else if (raw === '' || raw == null) {
      const st = spills(sheet);
      v = st.map.has(r + ',' + c) ? st.map.get(r + ',' + c) : '';
    } else {
      v = F.parseLiteral(raw);
      // Excel saved this cell as part of a spill: follow the live spilled value
      if (sheet.absorbSpill) { const st = spills(sheet); if (st.absorbed.has(r + ',' + c)) v = st.map.get(r + ',' + c); }
    }
    cache.set(key, v); if (cacheLog) cacheLog.push(key);
    return v;
  };
  const fallbackCells = new Map();
  function markFallback(sheet, r, c) { let s = fallbackCells.get(sheet.id); if (!s) fallbackCells.set(sheet.id, (s = new Set())); s.add(r + ',' + c); }
  F.usesFallback = (sheet, r, c) => { const s = fallbackCells.get(sheet.id); return !!(s && s.has(r + ',' + c)); };

  F.sheetValues = (sheet) => sheet.cells.map((row, r) => row.map((_, c) => {
    const v = F.cellValue(sheet, r, c);
    return isErr(v) ? v.err : v;
  }));

  // values of an area, clipped to the sheet's used size for whole-column/row refs
  F.rangeValues = (sheet, g) => {
    checkCache();
    const rk = sheet.id + ':' + g.r1 + ':' + g.c1 + ':' + g.r2 + ':' + g.c2 + ':' + (g.wholeCol ? 1 : 0) + (g.wholeRow ? 1 : 0);
    const hit = rangeCache.get(rk);
    if (hit) return hit;
    const before = cycleHits;
    const out = readRange(sheet, g);
    if (out.length * out[0].length >= 64 && cycleHits === before) rangeCache.set(rk, out);
    return out;
  };
  function readRange(sheet, g) {
    const r2 = g.wholeCol || g.r2 > 100000 ? Math.min(g.r2, Math.max(F.usedRows(sheet), g.r1 + 1) - 1) : g.r2;
    const c2 = g.wholeRow ? Math.min(g.c2, usedCols(sheet) - 1) : g.c2;
    const out = [];
    for (let r = g.r1; r <= r2; r++) {
      const row = [];
      for (let c = g.c1; c <= c2; c++) row.push(F.cellValue(sheet, r, c));
      out.push(row);
    }
    if (!out.length) out.push(Array(Math.max(1, c2 - g.c1 + 1)).fill(''));
    return out;
  }
  // exact-match index over one column (or row) of a cached range: key -> first/last position
  const lookupIdx = new WeakMap();
  F.lookupIndex = (rows, which, keysOf) => {
    let m = lookupIdx.get(rows);
    if (!m) lookupIdx.set(rows, (m = new Map()));
    let ix = m.get(which);
    if (!ix) {
      const keys = keysOf(), first = new Map(), last = new Map();
      for (let i = 0; i < keys.length; i++) { const k = String(keys[i] ?? '').toLowerCase(); if (!first.has(k)) first.set(k, i); last.set(k, i); }
      m.set(which, (ix = { first, last, n: keys.length }));
    }
    return ix;
  };

  // ---------- formatting
  // fmt: null|'num'|'int'|'cur'|'cur0'|'acct'|'pct'|'sci'|'date'|'text'|'compact'
  // opts: { dec: decimal places, comma: thousands separator on/off }
  const FMT_DEFAULTS = { num: [2, true], int: [0, true], cur: [2, true], cur0: [0, true], acct: [2, true], pct: [1, false], sci: [2, false] };
  F.FMT_DEFAULTS = FMT_DEFAULTS;
  F.format = (v, fmt, opts = {}) => {
    if (isErr(v)) return v.err;
    if (v === '' || v == null) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (fmt === 'date') { const d = F.toDate(v); return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : String(v); }
    if (typeof v !== 'number') return String(v);
    if (!isFinite(v)) return '#NUM!';
    if (fmt === 'text') return String(v);
    const def = FMT_DEFAULTS[fmt] || [null, null];
    const dec = opts.dec != null ? opts.dec : def[0];
    const comma = opts.comma != null ? opts.comma : def[1];
    const n = (x, d, g) => x.toLocaleString(undefined, d == null ? { maximumFractionDigits: 6, useGrouping: g } : { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: g });
    switch (fmt) {
      case 'cur': case 'cur0': return (v < 0 ? '-$' : '$') + n(Math.abs(v), dec, comma);
      case 'acct': return v < 0 ? `($${n(Math.abs(v), dec, comma)})` : `$${n(v, dec, comma)}`;
      case 'pct': return n(v * 100, dec, comma) + '%';
      case 'sci': return v.toExponential(dec);
      case 'num': case 'int': return n(fmt === 'int' && opts.dec == null ? Math.round(v) : v, dec, comma);
      case 'compact': return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(v);
      default: {
        if (dec != null) return n(v, dec, comma ?? false);
        if (Number.isInteger(v)) return comma === true || (comma == null && Math.abs(v) >= 10000) ? v.toLocaleString() : String(v);
        return n(+v.toPrecision(10), null, comma ?? true);
      }
    }
  };
  F.styleAt = (sheet, r, c) => (sheet.styles && sheet.styles[`${r},${c}`]) || {};
  F.styleFmt = (sheet, r, c) => {
    const st = F.styleAt(sheet, r, c);
    if (st.fmt) return st.fmt;
    const raw = String((sheet.cells[r] && sheet.cells[r][c]) || '').trim();
    if (/^-?\$/.test(raw)) return 'cur';
    if (/%$/.test(raw)) return 'pct';
    return null;
  };
  // dates: ISO strings, common US formats, or Excel serial numbers
  F.toDate = (v) => {
    if (v instanceof Date) return v;
    if (typeof v === 'number' && v > 59 && v < 2958466) return new Date(Math.round((v - 25569) * 86400000));
    if (typeof v !== 'string' || !v.trim()) return null;
    const s = v.trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
    if (m) return new Date(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2]);
    const t = Date.parse(s);
    return isNaN(t) || !/\d/.test(s) ? null : new Date(t);
  };
  F.isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  F.display = (sheet, r, c) => { const st = F.styleAt(sheet, r, c); return F.format(F.cellValue(sheet, r, c), F.styleFmt(sheet, r, c), st); };

  // ================================================================ tokenizer
  // Excel-compatible: sheet refs, whole columns/rows, array constants, error literals, _xlfn. prefixes, @, names
  const RE = {
    ws: /\s+/y,
    str: /"((?:[^"]|"")*)"/y,
    num: /(\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/y,
    err: /#(?:N\/A|DIV\/0!|REF!|VALUE!|NAME\?|NUM!|NULL!|SPILL!|CALC!|GETTING_DATA)/y,
    sheet: /(?:'((?:[^']|'')+)'|([A-Za-z_À-￿][\w.À-￿]*))!/y,
    ext: /(?:'?\[[^\]]+\][^!]*'?|\[\d+\][\w. ]*)!/y,
    cellRange: /\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?(?![\w(])/y,
    colRange: /\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}(?![\w(])/y,
    rowRange: /\$?\d+:\$?\d+(?![\w.(])/y,
    ident: /(?:_xlfn\.|_xlws\.|_xlpm\.)*([A-Za-z_\\À-￿][\w.À-￿]*)/y,
    op: /<>|<=|>=|[-+*/^&=<>%(),;:{}@]/y
  };
  const at = (re, src, i) => { re.lastIndex = i; const m = re.exec(src); return m && m.index === i ? m : null; };
  function tokenize(src) {
    const out = [];
    let i = 0;
    const prevAllowsRef = () => { const p = out[out.length - 1]; return !p || (p.t === 'op' && p.v !== ')' && p.v !== '}'); };
    while (i < src.length) {
      let m;
      if ((m = at(RE.ws, src, i))) { i += m[0].length; continue; }
      if ((m = at(RE.str, src, i))) { out.push({ t: 'str', v: m[1].replace(/""/g, '"') }); i += m[0].length; continue; }
      if ((m = at(RE.err, src, i))) { out.push({ t: 'err', v: m[0] }); i += m[0].length; continue; }
      if ((m = at(RE.ext, src, i))) { // reference to another workbook - can't be resolved here
        i += m[0].length;
        const r = at(RE.cellRange, src, i) || at(RE.colRange, src, i) || at(RE.ident, src, i);
        if (r) i += r[0].length;
        out.push({ t: 'extref' });
        continue;
      }
      if ((m = at(RE.sheet, src, i))) {
        const sheetName = m[1] != null ? m[1].replace(/''/g, "'") : m[2];
        const j = i + m[0].length;
        const r = at(RE.cellRange, src, j) || at(RE.colRange, src, j) || at(RE.rowRange, src, j);
        if (r) { out.push({ t: 'ref', sheet: sheetName.trim(), ref: r[0].replace(/\$/g, '') }); i = j + r[0].length; continue; }
        const nm = at(RE.ident, src, j);
        if (nm) { out.push({ t: 'name', sheet: sheetName.trim(), v: nm[1] }); i = j + nm[0].length; continue; }
        throw { code: '#PARSE!' };
      }
      if ((m = at(RE.cellRange, src, i))) { out.push({ t: 'ref', sheet: null, ref: m[0].replace(/\$/g, '') }); i += m[0].length; continue; }
      if (prevAllowsRef() && (m = at(RE.colRange, src, i))) { out.push({ t: 'ref', sheet: null, ref: m[0].replace(/\$/g, '') }); i += m[0].length; continue; }
      if (prevAllowsRef() && (m = at(RE.rowRange, src, i))) { out.push({ t: 'ref', sheet: null, ref: m[0].replace(/\$/g, '') }); i += m[0].length; continue; }
      if ((m = at(RE.num, src, i))) { out.push({ t: 'num', v: +m[0] }); i += m[0].length; continue; }
      if ((m = at(RE.ident, src, i))) {
        let name = m[1];
        i += m[0].length;
        // structured table references (Table1[Column]) aren't supported - Excel's saved value is used instead
        if (src[i] === '[') { let depth = 0; while (i < src.length) { if (src[i] === '[') depth++; if (src[i] === ']') { depth--; if (!depth) { i++; break; } } i++; } out.push({ t: 'extref' }); continue; }
        out.push({ t: 'id', v: name.toUpperCase() });
        continue;
      }
      if ((m = at(RE.op, src, i))) { if (m[0] !== '@') out.push({ t: 'op', v: m[0] }); i += m[0].length; continue; }
      throw { code: '#PARSE!' };
    }
    return out;
  }

  // ================================================================ parser -> AST
  function parse(tokens) {
    let p = 0;
    const peek = () => tokens[p];
    const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
    const eat = (v) => { if (!isOp(v)) throw { code: '#PARSE!' }; p++; };
    const cmp = () => {
      let l = cat();
      while (peek() && peek().t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) { const op = tokens[p++].v; l = { k: 'bin', op, l, r: cat() }; }
      return l;
    };
    const cat = () => { let l = add(); while (isOp('&')) { p++; l = { k: 'bin', op: '&', l, r: add() }; } return l; };
    const add = () => { let l = mul(); while (isOp('+') || isOp('-')) { const op = tokens[p++].v; l = { k: 'bin', op, l, r: mul() }; } return l; };
    const mul = () => { let l = pow(); while (isOp('*') || isOp('/')) { const op = tokens[p++].v; l = { k: 'bin', op, l, r: pow() }; } return l; };
    const pow = () => { let l = un(); while (isOp('^')) { p++; l = { k: 'bin', op: '^', l, r: un() }; } return l; };
    const un = () => {
      if (isOp('-')) { p++; return { k: 'neg', e: un() }; }
      if (isOp('+')) { p++; return un(); }
      let e = rng();
      while (isOp('%')) { p++; e = { k: 'bin', op: '/', l: e, r: { k: 'num', v: 100 } }; }
      return e;
    };
    // range operator between two references or ref-returning functions: A1:INDEX(...)
    const rng = () => {
      let e = prim();
      while (isOp(':')) { p++; const r = prim(); e = { k: 'span', l: e, r }; }
      return e;
    };
    const literal = () => {
      const t = tokens[p++];
      if (!t) throw { code: '#PARSE!' };
      if (t.t === 'op' && t.v === '-') { const n = tokens[p++]; if (!n || n.t !== 'num') throw { code: '#PARSE!' }; return -n.v; }
      if (t.t === 'num' || t.t === 'str') return t.v;
      if (t.t === 'err') return ERR(t.v);
      if (t.t === 'id' && (t.v === 'TRUE' || t.v === 'FALSE')) return t.v === 'TRUE';
      throw { code: '#PARSE!' };
    };
    const prim = () => {
      const t = tokens[p++];
      if (!t) throw { code: '#PARSE!' };
      if (t.t === 'num') return { k: 'num', v: t.v };
      if (t.t === 'str') return { k: 'str', v: t.v };
      if (t.t === 'err') return { k: 'errlit', v: t.v };
      if (t.t === 'extref') return { k: 'extref' };
      if (t.t === 'ref') { const multi = t.ref.includes(':') && !/^[A-Z]+\d+$/i.test(t.ref); return { k: 'ref', sheet: t.sheet, ref: t.ref, multi }; }
      if (t.t === 'name') return { k: 'name', sheet: t.sheet, v: t.v };
      if (t.t === 'id') {
        if (isOp('(')) {
          p++;
          const args = [];
          if (!isOp(')')) {
            const arg = () => (isOp(',') || isOp(')') ? { k: 'missing' } : cmp());
            args.push(arg());
            while (isOp(',') || isOp(';')) { p++; args.push(arg()); }
          }
          eat(')');
          return { k: 'fn', name: t.v.replace(/^_XLFN\.|^_XLWS\./g, ''), args };
        }
        if (t.v === 'TRUE') return { k: 'bool', v: true };
        if (t.v === 'FALSE') return { k: 'bool', v: false };
        return { k: 'name', sheet: null, v: t.v };
      }
      if (t.t === 'op' && t.v === '(') { const e = cmp(); eat(')'); return e; }
      if (t.t === 'op' && t.v === '{') {
        const rows = [[]];
        if (!isOp('}')) {
          rows[0].push(literal());
          while (isOp(',') || isOp(';')) { const sep = tokens[p++].v; if (sep === ';') rows.push([]); rows[rows.length - 1].push(literal()); }
        }
        eat('}');
        return { k: 'arr', v: rows };
      }
      throw { code: '#PARSE!' };
    };
    const ast = cmp();
    if (p < tokens.length) throw { code: '#PARSE!' };
    return ast;
  }
  const astCache = new Map();
  F.compile = (src) => {
    if (astCache.has(src)) return astCache.get(src);
    const a = parse(tokenize(src));
    if (astCache.size > 20000) astCache.clear();
    astCache.set(src, a);
    return a;
  };
  F.tokenize = tokenize;

  // ================================================================ evaluator
  // values: number | string | boolean | {err} | {range: 2D array, ref?: {sheet, r1, c1, r2, c2}}
  function resolveSheet(name, sheet) {
    if (!name) return sheet || D.dataSheets()[0];
    const s = D.sheetByName(name, sheet);
    if (!s || s.type !== 'data') throw { code: '#REF!' };
    return s;
  }
  F.resolveSheet = resolveSheet;
  function refRange(sh, g) {
    const r2 = g.wholeCol ? Math.max(g.r1, F.usedRows(sh) - 1) : g.r2;
    const c2 = g.wholeRow ? Math.max(g.c1, usedCols(sh) - 1) : g.c2;
    return { range: F.rangeValues(sh, g), ref: { sheet: sh, r1: g.r1, c1: g.c1, r2, c2 } };
  }
  F.refRange = refRange;
  function refValue(node, ctx) {
    const sh = resolveSheet(node.sheet, ctx.sheet);
    if (!sh) throw { code: '#REF!' };
    const g = F.parseArea(node.ref);
    if (!g) throw { code: '#REF!' };
    if (!node.multi) {
      const v = F.cellValue(sh, g.r1, g.c1);
      if (ctx.wantRef) return { range: [[v]], ref: { sheet: sh, r1: g.r1, c1: g.c1, r2: g.r1, c2: g.c1 } };
      return v;
    }
    return refRange(sh, g);
  }
  // named ranges: project.names = { NAME: "'Sheet'!A1:B5" | "=formula" }
  function nameValue(node, ctx) {
    if (ctx.vars && node.v in ctx.vars) return ctx.vars[node.v];
    const names = (D.project() && D.project().names) || {};
    const key = Object.keys(names).find((k) => k.toUpperCase() === node.v);
    if (!key) throw { code: '#NAME?' };
    const def = String(names[key]).replace(/^=/, '');
    if (ctx.nameDepth > 8) throw { code: '#CYCLE!' };
    return ev(F.compile(def), { ...ctx, nameDepth: (ctx.nameDepth || 0) + 1 });
  }

  const isArr = (v) => v && typeof v === 'object' && v.range;
  const toNum = (v) => {
    if (isErr(v)) throw { code: v.err };
    if (isArr(v)) { const f = flat([v]); if (f.length >= 1) return toNum(f[0]); throw { code: '#VALUE!' }; }
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v === '' || v == null) return 0;
    const n = F.parseLiteral(v);
    if (typeof n === 'number') return n;
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(String(v).trim())) return F.serial(F.toDate(v));
    throw { code: '#VALUE!' };
  };
  const toStr = (v) => {
    if (isErr(v)) throw { code: v.err };
    if (isArr(v)) return toStr(flat([v])[0]);
    if (typeof v === 'number') return (+v.toPrecision(15)).toString().replace(/e\+?/, 'E+').replace('E+-', 'E-');
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v ?? '');
  };
  const truthy = (v) => {
    if (isErr(v)) throw { code: v.err };
    if (isArr(v)) return truthy(flat([v])[0]);
    if (typeof v === 'string') { if (/^true$/i.test(v)) return true; if (/^false$/i.test(v) || v === '') return false; const n = F.parseLiteral(v); if (typeof n === 'number') return n !== 0; throw { code: '#VALUE!' }; }
    return !!toNum(v);
  };
  function flat(args) {
    const out = [];
    for (const a of args) {
      if (isArr(a)) { for (const row of a.range) for (const v of row) out.push(v); }
      else out.push(a);
    }
    return out;
  }
  // dates live in cells as ISO text; in a range they count as numbers like Excel's date serials (=MIN(A:A))
  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
  const nums = (args) => {
    const out = [];
    for (const a of args) {
      if (isArr(a)) { for (const row of a.range) for (const v of row) { if (isErr(v)) throw { code: v.err }; if (typeof v === 'number') out.push(v); else if (typeof v === 'string' && ISO_DAY.test(v)) out.push(toNum(v)); } }
      else if (isErr(a)) throw { code: a.err };
      else if (typeof a === 'number') out.push(a);
      else if (typeof a === 'boolean') out.push(a ? 1 : 0);
      else if (a !== '' && a != null) { const n = F.parseLiteral(a); if (typeof n === 'number') out.push(n); else throw { code: '#VALUE!' }; }
    }
    return out;
  };
  const wildRe = (b) => new RegExp('^' + b.replace(/~([*?])|[.+^${}()|[\]\\]|([*?])/g, (m, esc, wc) => (esc ? '\\' + esc : wc === '*' ? '.*' : wc === '?' ? '.' : '\\' + m)) + '$', 'i');
  function criteria(crit) {
    if (isArr(crit)) crit = flat([crit])[0];
    if (typeof crit === 'number') return (v) => v === crit || (typeof v === 'string' && F.parseLiteral(v) === crit);
    if (typeof crit === 'boolean') return (v) => v === crit;
    if (isErr(crit)) return (v) => isErr(v) && v.err === crit.err;
    const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(String(crit ?? ''));
    const op = m[1] || '=', rhsRaw = m[2];
    let rhs = F.parseLiteral(rhsRaw);
    const rhsDate = typeof rhs !== 'number' && /^\d{4}-\d{1,2}-\d{1,2}$/.test(rhsRaw.trim()) ? F.serial(F.toDate(rhsRaw)) : null;
    if (rhsDate != null) rhs = rhsDate;
    const rx = typeof rhs === 'string' && /[*?]/.test(rhsRaw) ? wildRe(rhsRaw) : null;
    return (v) => {
      if (typeof rhs === 'number') {
        let x = v;
        if (typeof x === 'string') { const n = F.parseLiteral(x); x = typeof n === 'number' ? n : (rhsDate != null && /^\d{4}-/.test(x) ? F.serial(F.toDate(x)) : x); }
        if (typeof x !== 'number') return op === '<>';
        return { '=': x === rhs, '<>': x !== rhs, '<': x < rhs, '>': x > rhs, '<=': x <= rhs, '>=': x >= rhs }[op];
      }
      if (typeof rhs === 'boolean') return op === '<>' ? v !== rhs : v === rhs;
      const a = isErr(v) ? v.err : String(v ?? '');
      if (rhsRaw === '' && op === '=') return a === '';
      if (rhsRaw === '' && op === '<>') return a !== '';
      if (op === '=' || op === '<>') { const hit = rx ? rx.test(a) : a.toLowerCase() === rhsRaw.toLowerCase(); return op === '=' ? hit : !hit; }
      if (typeof v === 'number') return false;
      const cmpv = a.localeCompare(rhsRaw, undefined, { sensitivity: 'base' });
      return { '<': cmpv < 0, '>': cmpv > 0, '<=': cmpv <= 0, '>=': cmpv >= 0 }[op];
    };
  }
  F.serial = (d) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 25569);
  F.fromSerial = (n) => { const d = new Date(Math.round((n - 25569) * 86400000)); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

  // element-wise ops with Excel broadcasting
  const dims = (v) => (isArr(v) ? [v.range.length, v.range[0] ? v.range[0].length : 0] : [1, 1]);
  const elem = (v, i, j) => { if (!isArr(v)) return v; const R = v.range; const r = R.length === 1 ? 0 : i, c = R[0].length === 1 ? 0 : j; return R[r] && R[r][c] !== undefined ? R[r][c] : ERR('#N/A'); };
  function broadcast(l, r, fn) {
    if (!isArr(l) && !isArr(r)) return fn(l, r);
    const [lr, lc] = dims(l), [rr, rc] = dims(r);
    const R = Math.max(lr, rr), C = Math.max(lc, rc);
    const out = [];
    for (let i = 0; i < R; i++) { const row = []; for (let j = 0; j < C; j++) { try { row.push(fn(elem(l, i, j), elem(r, i, j))); } catch (e) { row.push(ERR(e.code || '#VALUE!')); } } out.push(row); }
    return { range: out };
  }
  F.mapArr = (v, fn) => (isArr(v) ? { range: v.range.map((row) => row.map((x) => { try { return fn(x); } catch (e) { return ERR(e.code || '#VALUE!'); } })) } : fn(v));
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  function binop(op, a, b) {
    if (isErr(a)) throw { code: a.err };
    if (isErr(b)) throw { code: b.err };
    switch (op) {
      case '+': case '-': {
        // date arithmetic keeps dates as dates: date ± days -> date, date - date -> days
        const ad = typeof a === 'string' && ISO.test(a.trim()), bd = typeof b === 'string' && ISO.test(b.trim());
        if (ad && !bd && typeof b !== 'string') return F.isoDate(F.fromSerial(F.serial(F.toDate(a)) + (op === '+' ? toNum(b) : -toNum(b))));
        if (bd && !ad && op === '+' && typeof a !== 'string') return F.isoDate(F.fromSerial(F.serial(F.toDate(b)) + toNum(a)));
        return op === '+' ? toNum(a) + toNum(b) : toNum(a) - toNum(b);
      }
      case '*': return toNum(a) * toNum(b);
      case '/': { const d = toNum(b); if (d === 0) throw { code: '#DIV/0!' }; return toNum(a) / d; }
      case '^': return toNum(a) ** toNum(b);
      case '&': return toStr(a) + toStr(b);
      default: {
        const blank = (x) => x === '' || x == null;
        let x = a, y = b;
        if (blank(x) && typeof y === 'number') x = 0; if (blank(y) && typeof x === 'number') y = 0;
        if (blank(x) && typeof y === 'boolean') x = false; if (blank(y) && typeof x === 'boolean') y = false;
        if (typeof x === 'string' && typeof y === 'number') { const n = F.parseLiteral(x); if (typeof n === 'number') x = n; }
        if (typeof y === 'string' && typeof x === 'number') { const n = F.parseLiteral(y); if (typeof n === 'number') y = n; }
        const rank = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
        let c;
        if (rank(x) !== rank(y)) c = rank(x) - rank(y);
        else if (typeof x === 'string') c = x.localeCompare(y, undefined, { sensitivity: 'base' });
        else c = x === y ? 0 : x < y ? -1 : 1;
        return { '=': c === 0, '<>': c !== 0, '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[op];
      }
    }
  }

  // shared helpers exposed to the function library (functions.js)
  F.lib = { ERR, isErr, isArr, num: toNum, str: toStr, truthy, flat, nums, criteria, broadcast, wildRe, refRange, resolveSheet };
  F.FN = {};            // name -> (args, ctx) => value
  F.LAZY = {};          // name -> (argNodes, ctx, ev) => value   (IF, IFERROR, LET, ROW…)
  F.FN_HELP = {};
  F.CATS = {};

  const CATCH_ARGS = new Set(['ISERROR', 'ISERR', 'ISNA', 'ISNUMBER', 'ISTEXT', 'ISNONTEXT', 'ISBLANK', 'ISLOGICAL', 'TYPE', 'ERROR.TYPE', 'ERROR_TYPE']);
  const GIVEN_ARGS = new Set(['XLOOKUP']);
  const REF_AS_RANGE = new Set(['SUM', 'AVERAGE', 'AVG', 'MIN', 'MAX', 'PRODUCT', 'COUNT', 'MEDIAN', 'SUMSQ', 'STDEV', 'STDEV.S', 'STDEV.P', 'STDEVP', 'VAR', 'VAR.S', 'VAR.P', 'VARP']);
  function ev(n, ctx) {
    switch (n.k) {
      case 'num': case 'str': case 'bool': return n.v;
      case 'errlit': return ERR(n.v);
      case 'missing': return '';
      case 'arr': return { range: n.v.map((row) => row.slice()) };
      case 'extref': { const e = { code: '#REF!', ext: true }; throw e; }
      case 'ref': return refValue(n, ctx);
      case 'name': return nameValue(n, ctx);
      case 'span': {
        const a = ev(n.l, { ...ctx, wantRef: true }), b = ev(n.r, { ...ctx, wantRef: true });
        if (!a.ref || !b.ref || a.ref.sheet !== b.ref.sheet) throw { code: '#REF!' };
        const g = { r1: Math.min(a.ref.r1, b.ref.r1), c1: Math.min(a.ref.c1, b.ref.c1), r2: Math.max(a.ref.r2, b.ref.r2), c2: Math.max(a.ref.c2, b.ref.c2) };
        return refRange(a.ref.sheet, g);
      }
      case 'neg': { const v = ev(n.e, ctx); return isArr(v) ? F.mapArr(v, (x) => -toNum(x)) : -toNum(v); }
      case 'fn': {
        if (ctx.vars && ctx.vars[n.name] && ctx.vars[n.name].lambda) return F.callLambda(ctx.vars[n.name], n.args.map((a) => ev(a, ctx)), ctx);
        const lazy = F.LAZY[n.name] || F.LAZY[n.name.replace(/\./g, '_')];
        if (lazy) return lazy(n.args, ctx, ev);
        const f = F.FN[n.name] || F.FN[n.name.replace(/\./g, '_')];
        if (!f) throw { code: '#NAME?' };
        // IS* functions look at an error instead of failing with it (=ISNUMBER(SEARCH("x", A1)))
        if (CATCH_ARGS.has(n.name)) return f(n.args.map((a) => { try { return ev(a, ctx); } catch (e) { if (e && e.code && !e.ext && !FALLBACK_ERRS.has(e.code)) return ERR(e.code); throw e; } }), ctx);
        // functions that treat an explicit "" differently from a left-out argument
        // a referenced cell holding text is skipped by SUM/AVERAGE/MIN… (typed text like SUM(1,"2") still counts)
        if (REF_AS_RANGE.has(n.name)) return f(n.args.map((a) => (a.k === 'ref' && !a.multi ? ev(a, { ...ctx, wantRef: true }) : ev(a, ctx))), ctx);
        if (GIVEN_ARGS.has(n.name)) return f(n.args.map((a) => ev(a, ctx)), { ...ctx, given: n.args.map((a) => a.k !== 'missing') });
        return f(n.args.map((a) => ev(a, ctx)), ctx);
      }
      case 'bin': {
        const l = ev(n.l, ctx), r = ev(n.r, ctx);
        if (isArr(l) || isArr(r)) return broadcast(l, r, (x, y) => binop(n.op, x, y));
        return binop(n.op, l, r);
      }
    }
    throw { code: '#ERROR!' };
  }
  F.ev = ev;

  F.evaluate = (src, ctxSheet, cell) => {
    const v = ev(F.compile(src), { sheet: ctxSheet, r: cell ? cell.r : 0, c: cell ? cell.c : 0 });
    if (v && typeof v === 'object' && (v.lambda || v.builtin)) return ERR('#CALC!');
    if (isArr(v)) { const f = flat([v]); return f.length ? f[0] : ''; }
    if (typeof v === 'number' && !isFinite(v)) return ERR('#NUM!');
    return v;
  };
  F.evaluateArray = (src, ctxSheet) => ev(F.compile(src), { sheet: ctxSheet, r: 0, c: 0 });
  F.safeEval = (expr, ctxSheet) => {
    try {
      const src = String(expr).trim().replace(/^=/, '');
      if (!src) return '';
      return F.evaluate(src, ctxSheet);
    } catch (e) { return ERR(e.code || '#ERROR!'); }
  };

  // Guess a format for an expression: single-cell ref inherits its cell format
  F.exprFormat = (expr) => {
    try {
      const ast = F.compile(String(expr).replace(/^=/, ''));
      const findRef = (n) => {
        if (!n) return null;
        if (n.k === 'ref') return n;
        if (n.k === 'fn') { for (const a of n.args) { const r = findRef(a); if (r) return r; } }
        if (n.k === 'bin') return findRef(n.l) || findRef(n.r);
        if (n.k === 'neg') return findRef(n.e);
        return null;
      };
      const ref = findRef(ast);
      if (!ref) return null;
      const sh = resolveSheet(ref.sheet, null);
      const g = F.parseRange(ref.ref);
      if (ast.k === 'fn' && ['COUNT', 'COUNTA', 'COUNTIF'].includes(ast.name)) return 'int';
      if (ast.k === 'fn' && (ast.name === 'GROWTH' || ast.name === 'PCTCHANGE' || ast.name === 'CAGR')) return 'pct';
      return F.styleFmt(sh, g.r2, g.c2) || F.styleFmt(sh, g.r1, g.c1) || null;
    } catch { return null; }
  };
  F.displayExpr = (expr, fmt) => {
    const v = F.safeEval(expr);
    const f = fmt && fmt !== 'auto' ? fmt : F.exprFormat(expr);
    if (typeof v === 'number' && !f) return F.format(v, Math.abs(v) >= 1000 ? 'int' : null);
    return F.format(v, f);
  };

  // ---------- shift relative references (fill down, paste, conditional formulas)
  F.offsetFormula = (src, dr, dc) => src.replace(/"[^"]*"|((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(])/g, (m, pre, d1, col, d2, row) => {
    if (m.startsWith('"')) return m;
    const c = d1 ? F.colIndex(col) : Math.max(0, F.colIndex(col) + dc);
    const r = d2 ? +row - 1 : Math.max(0, +row - 1 + dr);
    return (pre || '') + d1 + F.colName(c) + d2 + (r + 1);
  });

  // ---------- merged cells
  F.merges = (sheet) => {
    const key = (sheet.merges || []).join('|');
    if (sheet.__mk !== key) {
      Object.defineProperty(sheet, '__mk', { value: key, writable: true, configurable: true, enumerable: false });
      Object.defineProperty(sheet, '__mg', { value: (sheet.merges || []).map(F.parseRange).filter(Boolean), writable: true, configurable: true, enumerable: false });
    }
    return sheet.__mg;
  };
  F.mergeAt = (sheet, r, c) => F.merges(sheet).find((g) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2) || null;

  // ---------- filters: rows hidden by the sheet's filter criteria
  const hidCache = new WeakMap();
  F.rowPasses = (v, disp, crit) => {
    if (!crit) return true;
    if (crit.hide && crit.hide.length && crit.hide.includes(String(disp).toLowerCase())) return false;
    if (crit.op) {
      const n = typeof v === 'number' ? v : null;
      const a = crit.val, an = parseFloat(a), bn = parseFloat(crit.val2);
      const t = String(disp).toLowerCase(), q = String(a ?? '').toLowerCase();
      switch (crit.op) {
        case 'gt': return n != null && n > an;
        case 'lt': return n != null && n < an;
        case 'gte': return n != null && n >= an;
        case 'lte': return n != null && n <= an;
        case 'between': return n != null && n >= an && n <= bn;
        case 'eq': return n != null && !isNaN(an) ? n === an : t === q;
        case 'neq': return n != null && !isNaN(an) ? n !== an : t !== q;
        case 'contains': return t.includes(q);
        case 'notcontains': return !t.includes(q);
        case 'begins': return t.startsWith(q);
        case 'blank': return t === '';
        case 'notblank': return t !== '';
        case 'top': return crit._top ? crit._top.has(v) : true;
      }
    }
    return true;
  };
  F.hiddenRows = (sheet) => {
    const f = sheet.filter;
    if (!f || !f.cols || !Object.keys(f.cols).length) return new Set();
    const key = D.dataVersion + '|' + JSON.stringify(f);
    const c0 = hidCache.get(sheet);
    if (c0 && c0.key === key) return c0.set;
    const g = F.parseRange(f.range);
    const set = new Set();
    if (g) {
      const crits = Object.entries(f.cols).map(([c, cr]) => [+c, { ...cr }]);
      crits.forEach(([c, cr]) => {
        if (cr.op === 'top') {
          const vals = [];
          for (let r = g.r1 + 1; r <= g.r2; r++) { const v = F.cellValue(sheet, r, c); if (typeof v === 'number') vals.push(v); }
          cr._top = new Set(vals.sort((a, b) => b - a).slice(0, Math.max(1, parseInt(cr.val) || 10)));
        }
      });
      for (let r = g.r1 + 1; r <= g.r2; r++) {
        for (const [c, cr] of crits) {
          if (!F.rowPasses(F.cellValue(sheet, r, c), F.display(sheet, r, c), cr)) { set.add(r); break; }
        }
      }
    }
    hidCache.set(sheet, { key, set });
    return set;
  };

  // ---------- conditional formatting -> Map("r,c" -> {fill,color,b,bar,barColor})
  const cfCache = new WeakMap();
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const hex2 = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (c1, c2, t) => { const a = hex2(c1), b = hex2(c2); return `rgb(${lerp(a[0], b[0], t)},${lerp(a[1], b[1], t)},${lerp(a[2], b[2], t)})`; };
  F.cfMap = (sheet) => {
    const rules = sheet.cf || [];
    const out = new Map();
    if (!rules.length) return out;
    const key = D.dataVersion + '|' + JSON.stringify(rules);
    const c0 = cfCache.get(sheet);
    if (c0 && c0.key === key) return c0.map;
    for (const rule of [...rules].reverse()) { // first rule wins: apply in reverse so earlier overwrite later
      const g = F.parseRange(rule.range);
      if (!g) continue;
      const cells = [];
      for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 20000); r++) for (let c = g.c1; c <= g.c2; c++) cells.push([r, c, F.cellValue(sheet, r, c)]);
      const numsIn = cells.map((x) => x[2]).filter((v) => typeof v === 'number');
      const lo = Math.min(...numsIn), hi = Math.max(...numsIn), avg = numsIn.reduce((a, b) => a + b, 0) / (numsIn.length || 1);
      const style = { fill: rule.fill, color: rule.color, b: rule.bold };
      let test = null;
      const v1 = parseFloat(rule.v1), v2 = parseFloat(rule.v2);
      switch (rule.type) {
        case 'gt': test = (v) => typeof v === 'number' && v > v1; break;
        case 'lt': test = (v) => typeof v === 'number' && v < v1; break;
        case 'gte': test = (v) => typeof v === 'number' && v >= v1; break;
        case 'lte': test = (v) => typeof v === 'number' && v <= v1; break;
        case 'between': test = (v) => typeof v === 'number' && v >= Math.min(v1, v2) && v <= Math.max(v1, v2); break;
        case 'eq': test = (v) => (isNaN(v1) ? String(v).toLowerCase() === String(rule.v1 ?? '').toLowerCase() : v === v1); break;
        case 'neq': test = (v) => (isNaN(v1) ? String(v).toLowerCase() !== String(rule.v1 ?? '').toLowerCase() : v !== v1); break;
        case 'text': test = (v) => String(v ?? '').toLowerCase().includes(String(rule.v1 ?? '').toLowerCase()); break;
        case 'blank': test = (v) => v === '' || v == null; break;
        case 'notblank': test = (v) => v !== '' && v != null; break;
        case 'neg': test = (v) => typeof v === 'number' && v < 0; break;
        case 'top': { const t = new Set([...numsIn].sort((a, b) => b - a).slice(0, parseInt(rule.v1) || 10)); test = (v) => typeof v === 'number' && t.has(v); break; }
        case 'bottom': { const t = new Set([...numsIn].sort((a, b) => a - b).slice(0, parseInt(rule.v1) || 10)); test = (v) => typeof v === 'number' && t.has(v); break; }
        case 'above': test = (v) => typeof v === 'number' && v > avg; break;
        case 'below': test = (v) => typeof v === 'number' && v < avg; break;
        case 'dup': case 'unique': {
          const cnt = new Map(); cells.forEach(([, , v]) => { if (v !== '' && v != null) { const k = String(v).toLowerCase(); cnt.set(k, (cnt.get(k) || 0) + 1); } });
          test = (v) => v !== '' && v != null && (rule.type === 'dup' ? cnt.get(String(v).toLowerCase()) > 1 : cnt.get(String(v).toLowerCase()) === 1);
          break;
        }
        case 'formula': {
          const src = String(rule.v1 || '').replace(/^=/, '');
          test = (_v, r, c) => { try { const x = F.evaluate(F.offsetFormula(src, r - g.r1, c - g.c1), sheet); return x === true || (typeof x === 'number' && x !== 0); } catch { return false; } };
          break;
        }
        case 'scale2': case 'scale3': {
          const cols = rule.colors || (rule.type === 'scale3' ? ['#F8696B', '#FFEB84', '#63BE7B'] : ['#FFFFFF', '#5A8AC6']);
          cells.forEach(([r, c, v]) => {
            if (typeof v !== 'number' || hi === lo) return;
            const t = (v - lo) / (hi - lo);
            const fill = rule.type === 'scale3' ? (t < 0.5 ? mix(cols[0], cols[1], t * 2) : mix(cols[1], cols[2], (t - 0.5) * 2)) : mix(cols[0], cols[1], t);
            out.set(r + ',' + c, { ...(out.get(r + ',' + c) || {}), fill });
          });
          continue;
        }
        case 'bars': {
          const base = Math.min(0, lo);
          cells.forEach(([r, c, v]) => {
            if (typeof v !== 'number' || hi === base) return;
            out.set(r + ',' + c, { ...(out.get(r + ',' + c) || {}), bar: Math.max(0, (v - base) / (hi - base)), barColor: rule.barColor || '#5B8DEF' });
          });
          continue;
        }
      }
      if (!test) continue;
      cells.forEach(([r, c, v]) => { if (test(v, r, c)) { const k = r + ',' + c; const cur = out.get(k) || {}; out.set(k, { ...cur, ...Object.fromEntries(Object.entries(style).filter(([, x]) => x != null && x !== false)) }); } });
    }
    cfCache.set(sheet, { key, map: out });
    return out;
  };

  // ---------- {{ tokens }} inside text
  F.TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
  F.resolveTokens = (text) => String(text ?? '').replace(F.TOKEN_RE, (_, ex) => F.displayExpr(ex));
  F.hasTokens = (text) => /\{\{[^}]+\}\}/.test(String(text || ''));

  // ---------- links: an element bound to {sheetId, range}
  F.linkRows = (link, { display = true } = {}) => {
    if (!link) return null;
    const sh = D.sheet(link.sheetId);
    const g = F.parseRange(link.range);
    if (!sh || !g) return null;
    const hidden = F.hiddenRows(sh); // filtered-out rows drop out of linked charts and tables
    const val = (r, c) => (display ? F.display(sh, r, c) : F.cellValue(sh, r, c));
    const clip = (a) => (a.wholeCol ? { ...a, r2: Math.max(a.r1, F.usedRows(sh) - 1) } : a);
    const areas = g.areas.map(clip);
    if (areas.length === 1) {
      const a = areas[0]; const out = [];
      for (let r = a.r1; r <= a.r2; r++) { if (hidden.has(r)) continue; const row = []; for (let c = a.c1; c <= a.c2; c++) row.push(val(r, c)); out.push(row); }
      return out;
    }
    // several areas (Ctrl-selected): same rows -> columns side by side (like Excel charts); same columns -> stacked
    const sameRows = areas.every((a) => a.r1 === areas[0].r1 && a.r2 === areas[0].r2);
    const sameCols = areas.every((a) => a.c1 === areas[0].c1 && a.c2 === areas[0].c2);
    if (sameCols && !sameRows) {
      const out = [];
      areas.forEach((a) => { for (let r = a.r1; r <= a.r2; r++) { if (hidden.has(r)) continue; const row = []; for (let c = a.c1; c <= a.c2; c++) row.push(val(r, c)); out.push(row); } });
      return out;
    }
    const cols = [...areas].sort((a, b) => a.c1 - b.c1);
    const R = Math.max(...cols.map((a) => a.r2 - a.r1 + 1));
    const out = [];
    for (let i = 0; i < R; i++) {
      if (sameRows && hidden.has(cols[0].r1 + i)) continue;
      const row = [];
      cols.forEach((a) => { for (let c = a.c1; c <= a.c2; c++) row.push(a.r1 + i <= a.r2 ? val(a.r1 + i, c) : ''); });
      out.push(row);
    }
    return out;
  };
  // trailing all-empty rows/cols trimmed
  F.trimRows = (rows) => {
    if (!rows) return rows;
    let r = rows.slice();
    while (r.length && r[r.length - 1].every((v) => v === '' || v == null)) r.pop();
    let maxC = 0;
    r.forEach((row) => row.forEach((v, i) => { if (v !== '' && v != null) maxC = Math.max(maxC, i + 1); }));
    return r.map((row) => row.slice(0, maxC));
  };
  // Turn a range into chart data: first row headers (if text), first col labels (if text)
  F.chartData = (link, opts = {}) => {
    const raw = F.trimRows(F.linkRows(link, { display: false }));
    if (!raw || !raw.length) return null;
    const disp = F.linkRows(link, { display: true });
    const isNum = (v) => typeof v === 'number';
    const hasHeader = raw[0].some((v, i) => (i > 0 || raw[0].length === 1) && v !== '' && !isNum(v)) || (raw.length > 1 && raw[0].every((v) => !isNum(v)));
    const body = hasHeader ? raw.slice(1) : raw;
    const hasLabels = body.some((r) => r[0] !== '' && !isNum(r[0])) || (raw[0].length > 1 && hasHeader && !isNum(raw[0][0]) && body.every((r) => isNum(r[0])) && /date|week|month|year|period|day|quarter/i.test(String(raw[0][0])));
    const c0 = hasLabels ? 1 : 0;
    const dispBody = (hasHeader ? disp.slice(1) : disp).slice(0, body.length);
    let labels = body.map((r, i) => (hasLabels ? String(dispBody[i][0]) : String(i + 1)));
    let series = [];
    const cols = raw[0].length;
    for (let c = c0; c < cols; c++) {
      const name = hasHeader ? String(raw[0][c] ?? `Series ${c}`) : `Series ${c - c0 + 1}`;
      const values = body.map((r) => (isNum(r[c]) ? r[c] : (typeof r[c] === 'string' && typeof F.parseLiteral(r[c]) === 'number' ? F.parseLiteral(r[c]) : null)));
      if (values.some((v) => v != null)) series.push({ name, values, col: c });
    }
    if (opts.cols && opts.cols.length) { const keep = series.filter((x) => opts.cols.includes(x.col)); if (keep.length) series = keep; }
    if (opts.seriesIn === 'rows' && series.length) {
      const newLabels = series.map((s) => s.name);
      series = labels.map((l, i) => ({ name: l, values: series.map((s) => s.values[i]) }));
      labels = newLabels;
    }
    return { labels, series };
  };

  // usages of a data sheet across the project
  F.usages = (sheetId) => {
    const out = [];
    const sh = D.sheet(sheetId);
    const p = D.project();
    if (!p || !sh) return out;
    const nameRe = new RegExp(`(^|[^\\w'])('?${sh.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'?)!`, 'i');
    const walkEls = (els, where) => els.forEach((e) => {
      if (e.link && e.link.sheetId === sheetId) out.push({ where, range: e.link.range, kind: e.type });
      if ((e.expr && nameRe.test(e.expr)) || (e.text && nameRe.test(e.text))) out.push({ where, kind: e.type });
    });
    for (const s of p.sheets) {
      if (s.type === 'slide') s.slides.forEach((sl, i) => walkEls(sl.elements, `${s.name} · slide ${i + 1}`));
      if (s.type === 'report') walkEls(s.elements, s.name);
      if (s.type === 'docu' && s.html) {
        const re = new RegExp(`data-sheet="${sheetId}"`, 'g');
        const n = (s.html.match(re) || []).length;
        if (n || nameRe.test(s.html)) out.push({ where: s.name, kind: 'docu', count: n });
      }
    }
    return out;
  };

  // Renaming a sheet rewrites references across the project
  F.renameRefs = (oldName, newName) => {
    const p = D.project();
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^\\w'.])(?:'${esc(oldName.replace(/'/g, "''"))}'|${esc(oldName)})!`, 'gi');
    const fix = (s) => (typeof s === 'string' ? s.replace(re, (_, pre) => pre + F.quoteSheet(newName) + '!') : s);
    for (const s of p.sheets) {
      if (s.type === 'data') s.cells.forEach((row) => row.forEach((v, i) => { if (typeof v === 'string' && v.startsWith('=')) row[i] = fix(v); }));
      const els = s.type === 'slide' ? s.slides.flatMap((x) => x.elements) : s.type === 'report' ? s.elements : [];
      els.forEach((e) => { e.text = fix(e.text); e.expr = fix(e.expr); e.compareExpr = fix(e.compareExpr); });
      if (s.type === 'docu' && s.html) s.html = s.html.replace(/data-expr="([^"]*)"/g, (m, ex) => `data-expr="${fix(ex.replace(/&#39;/g, "'")).replace(/'/g, '&#39;')}"`).replace(/\{\{([^}]*)\}\}/g, (m, ex) => `{{${fix(ex)}}}`);
    }
  };
})();
