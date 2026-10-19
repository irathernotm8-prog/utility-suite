// Datum - more Excel functions: LAMBDA & friends, database functions, distributions, engineering, finance extras
(function () {
  const F = D.f;
  const { ERR, isErr, isArr, num, str, truthy, flat, criteria } = F.lib;
  const FN = F.FN, LAZY = F.LAZY;
  const E = (c) => { throw { code: c }; };
  const A = (rows) => ({ range: rows });
  const grid = (v) => (isArr(v) ? v.range : [[v]]);
  const has = (a, i) => a.length > i && a[i] !== '' && a[i] != null;
  const opt = (a, i, d) => (has(a, i) ? num(a[i]) : d);
  const optB = (a, i, d) => (has(a, i) ? truthy(a[i]) : d);
  const nums = (v) => flat([v]).filter((x) => typeof x === 'number' && isFinite(x));
  const sum = (xs) => xs.reduce((s, x) => s + x, 0);
  const mean = (xs) => (xs.length ? sum(xs) / xs.length : E('#DIV/0!'));
  const sc = (f) => (a, ctx) => {
    if (!a.some(isArr)) return f(a, ctx);
    let R = 1, C = 1;
    a.forEach((x) => { if (isArr(x)) { R = Math.max(R, x.range.length); C = Math.max(C, x.range[0].length); } });
    const pick = (x, i, j) => { if (!isArr(x)) return x; const g = x.range; return (g[g.length === 1 ? 0 : i] || [])[g[0].length === 1 ? 0 : j] ?? ERR('#N/A'); };
    const out = [];
    for (let i = 0; i < R; i++) { const row = []; for (let j = 0; j < C; j++) { try { row.push(f(a.map((x) => pick(x, i, j)), ctx)); } catch (e) { row.push(ERR(e.code || '#VALUE!')); } } out.push(row); }
    return A(out);
  };
  const def = (map, lift = true) => { for (const [k, f] of Object.entries(map)) FN[k] = lift ? sc(f) : f; };
  const agg = (map) => def(map, false);
  const fin = (x) => (isFinite(x) ? x : E('#NUM!'));

  // =============================================================== LAMBDA, MAP, REDUCE, SCAN, BYROW, BYCOL, MAKEARRAY
  const OMIT = { omitted: true };
  LAZY.LAMBDA = (n, ctx) => {
    if (!n.length) E('#VALUE!');
    const params = n.slice(0, -1).map((p) => (p.k === 'name' ? p.v : E('#VALUE!')));
    return { lambda: true, params, body: n[n.length - 1], vars: { ...(ctx.vars || {}) } };
  };
  const call = (fnv, args, ctx) => {
    if (!fnv || !fnv.lambda) {
      if (fnv && fnv.builtin) return fnv.builtin(args, ctx);
      E('#VALUE!');
    }
    if (args.length > fnv.params.length) E('#VALUE!');
    const vars = { ...fnv.vars };
    fnv.params.forEach((p, i) => { vars[p] = i < args.length ? args[i] : OMIT; });
    return F.ev(fnv.body, { ...ctx, vars });
  };
  F.callLambda = call;
  // the last argument may be a LAMBDA, a LET name holding one, or a bare function name like SUM (Excel's "eta" form)
  const fnArg = (node, ctx) => {
    if (node.k === 'name' && !(ctx.vars && node.v in ctx.vars)) {
      const f = FN[node.v] || FN[node.v.replace(/\./g, '_')];
      if (f) return { builtin: (args, c) => f(args, c) };
    }
    return F.ev(node, ctx);
  };
  LAZY.ISOMITTED = (n, ctx) => !!(n[0] && n[0].k === 'name' && ctx.vars && ctx.vars[n[0].v] === OMIT);
  const scalar = (v) => (isArr(v) ? flat([v])[0] : v);
  LAZY.MAP = (n, ctx) => {
    const f = fnArg(n[n.length - 1], ctx);
    const arrs = n.slice(0, -1).map((x) => grid(F.ev(x, ctx)));
    const R = Math.max(...arrs.map((g) => g.length)), C = Math.max(...arrs.map((g) => g[0].length));
    const out = [];
    for (let i = 0; i < R; i++) { const row = []; for (let j = 0; j < C; j++) { try { row.push(scalar(call(f, arrs.map((g) => (g[g.length === 1 ? 0 : i] || [])[g[0].length === 1 ? 0 : j]), ctx))); } catch (e) { row.push(ERR(e.code || '#VALUE!')); } } out.push(row); }
    return A(out);
  };
  LAZY.REDUCE = (n, ctx) => {
    let acc = n.length > 2 ? F.ev(n[0], ctx) : 0;
    const f = fnArg(n[n.length - 1], ctx);
    for (const v of flat([F.ev(n[n.length - 2], ctx)])) acc = call(f, [acc, v], ctx);
    return acc;
  };
  LAZY.SCAN = (n, ctx) => {
    let acc = n.length > 2 ? F.ev(n[0], ctx) : 0;
    const f = fnArg(n[n.length - 1], ctx);
    const g = grid(F.ev(n[n.length - 2], ctx));
    return A(g.map((row) => row.map((v) => (acc = scalar(call(f, [acc, v], ctx))))));
  };
  LAZY.BYROW = (n, ctx) => { const g = grid(F.ev(n[0], ctx)); const f = fnArg(n[1], ctx); return A(g.map((row) => [scalar(call(f, [A([row])], ctx))])); };
  LAZY.BYCOL = (n, ctx) => { const g = grid(F.ev(n[0], ctx)); const f = fnArg(n[1], ctx); return A([g[0].map((_, j) => scalar(call(f, [A(g.map((r) => [r[j]]))], ctx)))]); };
  LAZY.MAKEARRAY = (n, ctx) => {
    const R = Math.floor(num(F.ev(n[0], ctx))), C = Math.floor(num(F.ev(n[1], ctx)));
    if (R < 1 || C < 1 || R * C > 1e6) E('#VALUE!');
    const f = fnArg(n[2], ctx);
    return A(Array.from({ length: R }, (_, i) => Array.from({ length: C }, (_2, j) => scalar(call(f, [i + 1, j + 1], ctx)))));
  };

  // GROUPBY(row_fields, values, function, [field_headers], [total_depth], [sort_order])
  LAZY.GROUPBY = (n, ctx) => {
    const keys = grid(F.ev(n[0], ctx)), vals = grid(F.ev(n[1], ctx));
    const f = fnArg(n[2], ctx);
    const headers = n[3] && n[3].k !== 'missing' ? Math.floor(num(F.ev(n[3], ctx))) : 0;
    const total = n[4] && n[4].k !== 'missing' ? Math.floor(num(F.ev(n[4], ctx))) : 1;
    const sortOrder = n[5] && n[5].k !== 'missing' ? Math.floor(num(F.ev(n[5], ctx))) : 1;
    let kRows = keys, vRows = vals, head = null;
    if (headers === 1 || headers === 3) { head = [...kRows[0], ...vRows[0]]; kRows = kRows.slice(1); vRows = vRows.slice(1); }
    const groups = new Map();
    kRows.forEach((kr, i) => { if (kr.every((x) => x === '' || x == null)) return; const k = JSON.stringify(kr.map((x) => (typeof x === 'string' ? x.toLowerCase() : x))); if (!groups.has(k)) groups.set(k, { key: kr, rows: [] }); groups.get(k).rows.push(vRows[i] || []); });
    const W = vRows[0] ? vRows[0].length : 1;
    const aggCol = (rows, j) => scalar(call(f, [A(rows.map((r) => [r[j]]))], ctx));
    let out = [...groups.values()].map((g) => [...g.key, ...Array.from({ length: W }, (_, j) => aggCol(g.rows, j))]);
    const sc2 = Math.abs(sortOrder) - 1, dir = sortOrder < 0 ? -1 : 1;
    out.sort((a, b) => { const x = a[sc2], y = b[sc2]; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir; });
    if (total) out.push(['Total', ...Array(kRows[0].length - 1).fill(''), ...Array.from({ length: W }, (_, j) => aggCol(vRows, j))]);
    if (head) out.unshift(head);
    return A(out);
  };

  // =============================================================== database functions D*(database, field, criteria)
  const dbRows = (a) => {
    const db = grid(a[0]), cr = grid(a[2]);
    const head = db[0].map((x) => String(x).trim().toLowerCase());
    let field = null;
    if (has(a, 1)) { const fv = a[1]; field = typeof fv === 'number' ? fv - 1 : head.indexOf(String(fv).trim().toLowerCase()); if (field < 0 || field >= head.length) E('#VALUE!'); }
    const ch = cr[0].map((x) => String(x).trim().toLowerCase());
    const tests = cr.slice(1).filter((r) => r.some((x) => x !== '' && x != null)).map((r) => r.map((c, j) => (c === '' || c == null ? null : { col: head.indexOf(ch[j]), t: criteria(c) })).filter(Boolean));
    const rows = db.slice(1).filter((row) => !tests.length || tests.some((conds) => conds.every(({ col, t }) => col >= 0 && t(row[col]))));
    return { rows, field };
  };
  const dcol = (a) => { const { rows, field } = dbRows(a); return rows.map((r) => (field == null ? r : r[field])); };
  agg({
    DSUM: (a) => sum(dcol(a).filter((x) => typeof x === 'number')),
    DAVERAGE: (a) => mean(dcol(a).filter((x) => typeof x === 'number')),
    DCOUNT: (a) => dcol(a).filter((x) => typeof x === 'number').length,
    DCOUNTA: (a) => dcol(a).filter((x) => x !== '' && x != null).length,
    DMAX: (a) => { const xs = dcol(a).filter((x) => typeof x === 'number'); return xs.length ? Math.max(...xs) : 0; },
    DMIN: (a) => { const xs = dcol(a).filter((x) => typeof x === 'number'); return xs.length ? Math.min(...xs) : 0; },
    DPRODUCT: (a) => dcol(a).filter((x) => typeof x === 'number').reduce((p, x) => p * x, 1),
    DGET: (a) => { const xs = dcol(a); if (!xs.length) E('#VALUE!'); if (xs.length > 1) E('#NUM!'); return xs[0]; },
    DSTDEV: (a) => sd(dcol(a).filter((x) => typeof x === 'number'), 1),
    DSTDEVP: (a) => sd(dcol(a).filter((x) => typeof x === 'number'), 0),
    DVAR: (a) => vr(dcol(a).filter((x) => typeof x === 'number'), 1),
    DVARP: (a) => vr(dcol(a).filter((x) => typeof x === 'number'), 0)
  });
  function vr(xs, ddof) { if (xs.length - ddof <= 0) E('#DIV/0!'); const m = mean(xs); return sum(xs.map((x) => (x - m) ** 2)) / (xs.length - ddof); }
  function sd(xs, ddof) { return Math.sqrt(vr(xs, ddof)); }

  // =============================================================== special functions for distributions
  function gammaln(x) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t);
    let s = 1.000000000190015; for (const k of c) s += k / ++y;
    return -t + Math.log(2.5066282746310005 * s / x);
  }
  const gammaFn = (x) => (x < 0.5 ? Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x)) : Math.exp(gammaln(x)));
  function gammaP(a, x) { // regularized lower incomplete gamma
    if (x <= 0) return 0;
    if (x < a + 1) { let ap = a, s = 1 / a, d = s; for (let i = 0; i < 500; i++) { ap++; d *= x / ap; s += d; if (Math.abs(d) < Math.abs(s) * 1e-15) break; } return s * Math.exp(-x + a * Math.log(x) - gammaln(a)); }
    let b = x + 1 - a, c = 1e300, d = 1 / b, hh = d;
    for (let i = 1; i < 500; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; hh *= del; if (Math.abs(del - 1) < 1e-15) break; }
    return 1 - Math.exp(-x + a * Math.log(x) - gammaln(a)) * hh;
  }
  function betacf(a, b, x) {
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < 1e-300) d = 1e-300; d = 1 / d; let hh = d;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; hh *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; hh *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return hh;
  }
  function betaI(x, a, b) { // regularized incomplete beta
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  const erf = (x) => { // high-precision erf via the incomplete gamma function
    const v = gammaP(0.5, x * x); return x >= 0 ? v : -v;
  };
  const ncdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
  const npdf = (z) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  const invert = (cdf, p, lo, hi) => { // monotone bisection
    if (!(p >= 0 && p <= 1)) E('#NUM!');
    for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (cdf(mid) < p) lo = mid; else hi = mid; if (hi - lo < 1e-12 * Math.max(1, Math.abs(mid))) break; }
    return (lo + hi) / 2;
  };
  const tcdf = (t, df) => { const x = df / (df + t * t); const p = 0.5 * betaI(x, df / 2, 0.5); return t >= 0 ? 1 - p : p; };
  const tpdf = (t, df) => Math.exp(gammaln((df + 1) / 2) - gammaln(df / 2)) / Math.sqrt(df * Math.PI) * Math.pow(1 + t * t / df, -(df + 1) / 2);
  const chicdf = (x, k) => gammaP(k / 2, x / 2);
  const chipdf = (x, k) => (x < 0 ? 0 : Math.exp((k / 2 - 1) * Math.log(x) - x / 2 - (k / 2) * Math.log(2) - gammaln(k / 2)));
  const fcdf = (x, d1, d2) => (x <= 0 ? 0 : betaI(d1 * x / (d1 * x + d2), d1 / 2, d2 / 2));
  const fpdf = (x, d1, d2) => (x <= 0 ? 0 : Math.exp(0.5 * (d1 * Math.log(d1 * x) + d2 * Math.log(d2) - (d1 + d2) * Math.log(d1 * x + d2)) - Math.log(x) - (gammaln(d1 / 2) + gammaln(d2 / 2) - gammaln((d1 + d2) / 2))));
  const lnComb = (n, k) => gammaln(n + 1) - gammaln(k + 1) - gammaln(n - k + 1);
  const pos = (x) => (x > 0 ? x : E('#NUM!'));

  def({
    ERF: (a) => (has(a, 1) ? erf(num(a[1])) - erf(num(a[0])) : erf(num(a[0]))),
    ERFC: (a) => 1 - erf(num(a[0])),
    'ERF.PRECISE': (a) => erf(num(a[0])),
    'ERFC.PRECISE': (a) => 1 - erf(num(a[0])),
    GAMMA: (a) => { const x = num(a[0]); if (x <= 0 && Number.isInteger(x)) E('#NUM!'); return fin(gammaFn(x)); },
    GAMMALN: (a) => gammaln(pos(num(a[0]))),
    'GAMMALN.PRECISE': (a) => gammaln(pos(num(a[0]))),
    'GAMMA.DIST': (a) => { const x = num(a[0]), al = pos(num(a[1])), be = pos(num(a[2])); if (x < 0) E('#NUM!'); return optB(a, 3, true) ? gammaP(al, x / be) : Math.exp((al - 1) * Math.log(x) - x / be - gammaln(al) - al * Math.log(be)); },
    'GAMMA.INV': (a) => { const p = num(a[0]), al = pos(num(a[1])), be = pos(num(a[2])); return invert((x) => gammaP(al, x / be), p, 0, al * be * 50 + 100); },
    PHI: (a) => npdf(num(a[0])),
    GAUSS: (a) => ncdf(num(a[0])) - 0.5,
    FISHER: (a) => { const x = num(a[0]); if (x <= -1 || x >= 1) E('#NUM!'); return 0.5 * Math.log((1 + x) / (1 - x)); },
    FISHERINV: (a) => { const y = num(a[0]); return (Math.exp(2 * y) - 1) / (Math.exp(2 * y) + 1); },
    'T.DIST': (a) => { const t = num(a[0]), df = pos(num(a[1])); return optB(a, 2, true) ? tcdf(t, df) : tpdf(t, df); },
    'T.DIST.RT': (a) => 1 - tcdf(num(a[0]), pos(num(a[1]))),
    'T.DIST.2T': (a) => { const t = num(a[0]); if (t < 0) E('#NUM!'); return 2 * (1 - tcdf(t, pos(num(a[1])))); },
    'T.INV': (a) => { const p = num(a[0]), df = pos(num(a[1])); if (p <= 0 || p >= 1) E('#NUM!'); return invert((t) => tcdf(t, df), p, -1e4, 1e4); },
    'T.INV.2T': (a) => { const p = num(a[0]), df = pos(num(a[1])); if (p <= 0 || p > 1) E('#NUM!'); return invert((t) => tcdf(t, df), 1 - p / 2, -1e4, 1e4); },
    TDIST: (a) => { const t = num(a[0]), df = pos(num(a[1])), tails = num(a[2]); if (t < 0) E('#NUM!'); return tails === 1 ? 1 - tcdf(t, df) : 2 * (1 - tcdf(t, df)); },
    TINV: (a) => { const p = num(a[0]), df = pos(num(a[1])); return invert((t) => tcdf(t, df), 1 - p / 2, -1e4, 1e4); },
    'CHISQ.DIST': (a) => { const x = num(a[0]), k = pos(num(a[1])); if (x < 0) E('#NUM!'); return optB(a, 2, true) ? chicdf(x, k) : chipdf(x, k); },
    'CHISQ.DIST.RT': (a) => 1 - chicdf(num(a[0]), pos(num(a[1]))),
    CHIDIST: (a) => 1 - chicdf(num(a[0]), pos(num(a[1]))),
    'CHISQ.INV': (a) => { const k = pos(num(a[1])); return invert((x) => chicdf(x, k), num(a[0]), 0, 1e4 + k * 20); },
    'CHISQ.INV.RT': (a) => { const k = pos(num(a[1])); return invert((x) => chicdf(x, k), 1 - num(a[0]), 0, 1e4 + k * 20); },
    CHIINV: (a) => { const k = pos(num(a[1])); return invert((x) => chicdf(x, k), 1 - num(a[0]), 0, 1e4 + k * 20); },
    'F.DIST': (a) => { const x = num(a[0]), d1 = pos(num(a[1])), d2 = pos(num(a[2])); return optB(a, 3, true) ? fcdf(x, d1, d2) : fpdf(x, d1, d2); },
    'F.DIST.RT': (a) => 1 - fcdf(num(a[0]), pos(num(a[1])), pos(num(a[2]))),
    FDIST: (a) => 1 - fcdf(num(a[0]), pos(num(a[1])), pos(num(a[2]))),
    'F.INV': (a) => { const d1 = pos(num(a[1])), d2 = pos(num(a[2])); return invert((x) => fcdf(x, d1, d2), num(a[0]), 0, 1e5); },
    'F.INV.RT': (a) => { const d1 = pos(num(a[1])), d2 = pos(num(a[2])); return invert((x) => fcdf(x, d1, d2), 1 - num(a[0]), 0, 1e5); },
    'BETA.DIST': (a) => { const lo = opt(a, 4, 0), hi = opt(a, 5, 1); const x = (num(a[0]) - lo) / (hi - lo), al = pos(num(a[1])), be = pos(num(a[2])); if (x < 0 || x > 1) E('#NUM!'); return optB(a, 3, true) ? betaI(x, al, be) : Math.exp((al - 1) * Math.log(x) + (be - 1) * Math.log(1 - x) - (gammaln(al) + gammaln(be) - gammaln(al + be))) / (hi - lo); },
    'BETA.INV': (a) => { const lo = opt(a, 3, 0), hi = opt(a, 4, 1); const al = pos(num(a[1])), be = pos(num(a[2])); return lo + (hi - lo) * invert((x) => betaI(x, al, be), num(a[0]), 0, 1); },
    'LOGNORM.DIST': (a) => { const x = pos(num(a[0])), m = num(a[1]), s = pos(num(a[2])); const z = (Math.log(x) - m) / s; return optB(a, 3, true) ? ncdf(z) : npdf(z) / (x * s); },
    LOGNORMDIST: (a) => { const x = pos(num(a[0])); return ncdf((Math.log(x) - num(a[1])) / pos(num(a[2]))); },
    'LOGNORM.INV': (a) => { const m = num(a[1]), s = pos(num(a[2])); return Math.exp(m + s * invert(ncdf, num(a[0]), -40, 40)); },
    'WEIBULL.DIST': (a) => { const x = num(a[0]), k = pos(num(a[1])), l = pos(num(a[2])); if (x < 0) E('#NUM!'); return optB(a, 3, true) ? 1 - Math.exp(-((x / l) ** k)) : (k / l) * (x / l) ** (k - 1) * Math.exp(-((x / l) ** k)); },
    WEIBULL: (a) => { const x = num(a[0]), k = pos(num(a[1])), l = pos(num(a[2])); return optB(a, 3, true) ? 1 - Math.exp(-((x / l) ** k)) : (k / l) * (x / l) ** (k - 1) * Math.exp(-((x / l) ** k)); },
    GAMMADIST: (a) => { const x = num(a[0]), al = pos(num(a[1])), be = pos(num(a[2])); return optB(a, 3, true) ? gammaP(al, x / be) : Math.exp((al - 1) * Math.log(x) - x / be - gammaln(al) - al * Math.log(be)); },
    'BINOM.INV': (a) => { const n = Math.floor(num(a[0])), p = num(a[1]), al = num(a[2]); let c = 0; for (let k = 0; k <= n; k++) { c += Math.exp(lnComb(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p)); if (c >= al - 1e-12) return k; } return n; },
    'BINOM.DIST.RANGE': (a) => { const n = Math.floor(num(a[0])), p = num(a[1]), s1 = Math.floor(num(a[2])), s2 = has(a, 3) ? Math.floor(num(a[3])) : s1; let c = 0; for (let k = s1; k <= s2; k++) c += Math.exp(lnComb(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p)); return c; },
    'NEGBINOM.DIST': (a) => { const f = Math.floor(num(a[0])), s = Math.floor(num(a[1])), p = num(a[2]); const pmf = (k) => Math.exp(lnComb(k + s - 1, k) + s * Math.log(p) + k * Math.log(1 - p)); if (!optB(a, 3, false)) return pmf(f); let c = 0; for (let k = 0; k <= f; k++) c += pmf(k); return c; },
    'HYPGEOM.DIST': (a) => { const x = Math.floor(num(a[0])), n = Math.floor(num(a[1])), K = Math.floor(num(a[2])), N = Math.floor(num(a[3])); const pmf = (k) => Math.exp(lnComb(K, k) + lnComb(N - K, n - k) - lnComb(N, n)); if (!optB(a, 4, false)) return pmf(x); let c = 0; for (let k = Math.max(0, n - (N - K)); k <= x; k++) c += pmf(k); return c; },
    COMBINA: (a) => { const n = Math.floor(num(a[0])), k = Math.floor(num(a[1])); return Math.round(Math.exp(lnComb(n + k - 1, k))); },
    PERMUTATIONA: (a) => Math.pow(Math.floor(num(a[0])), Math.floor(num(a[1]))),
    ACOT: (a) => Math.PI / 2 - Math.atan(num(a[0])),
    ACOTH: (a) => { const x = num(a[0]); if (Math.abs(x) <= 1) E('#NUM!'); return 0.5 * Math.log((x + 1) / (x - 1)); },
    COTH: (a) => { const x = num(a[0]); if (x === 0) E('#DIV/0!'); return 1 / Math.tanh(x); },
    CSCH: (a) => { const x = num(a[0]); if (x === 0) E('#DIV/0!'); return 1 / Math.sinh(x); },
    SECH: (a) => 1 / Math.cosh(num(a[0])),
    'ISO.CEILING': (a) => { const x = num(a[0]), s = Math.abs(opt(a, 1, 1)); return s ? Math.ceil(x / s) * s : 0; },
    DELTA: (a) => (num(a[0]) === opt(a, 1, 0) ? 1 : 0),
    GESTEP: (a) => (num(a[0]) >= opt(a, 1, 0) ? 1 : 0),
    BITAND: (a) => Number(BigInt(Math.floor(num(a[0]))) & BigInt(Math.floor(num(a[1])))),
    BITOR: (a) => Number(BigInt(Math.floor(num(a[0]))) | BigInt(Math.floor(num(a[1])))),
    BITXOR: (a) => Number(BigInt(Math.floor(num(a[0]))) ^ BigInt(Math.floor(num(a[1])))),
    BITLSHIFT: (a) => { const s = Math.floor(num(a[1])); const v = BigInt(Math.floor(num(a[0]))); return Number(s >= 0 ? v << BigInt(s) : v >> BigInt(-s)); },
    BITRSHIFT: (a) => { const s = Math.floor(num(a[1])); const v = BigInt(Math.floor(num(a[0]))); return Number(s >= 0 ? v >> BigInt(s) : v << BigInt(-s)); },
    ENCODEURL: (a) => encodeURIComponent(str(a[0])),
    ISPMT: (a) => { const r = num(a[0]), per = num(a[1]), n = num(a[2]), pv = num(a[3]); return -pv * r * (1 - per / n); },
    DOLLARDE: (a) => { const v = num(a[0]), f = Math.floor(num(a[1])); if (f <= 0) E('#NUM!'); const ip = Math.trunc(v), digits = Math.ceil(Math.log10(f + 1e-12)); return ip + (v - ip) * Math.pow(10, digits) / f; },
    DOLLARFR: (a) => { const v = num(a[0]), f = Math.floor(num(a[1])); if (f <= 0) E('#NUM!'); const ip = Math.trunc(v), digits = Math.ceil(Math.log10(f + 1e-12)); return ip + (v - ip) * f / Math.pow(10, digits); }
  });

  // ---- base conversions (Excel uses 10-character two's complement for negatives)
  const toBase = (n, b, places, bits) => {
    n = Math.floor(n);
    const lim = Math.pow(b, 10) / 2;
    if (n < -lim || n >= lim) E('#NUM!');
    let s = (n < 0 ? Math.pow(b, 10) + n : n).toString(b).toUpperCase();
    if (places != null && n >= 0) { if (s.length > places) E('#NUM!'); s = s.padStart(places, '0'); }
    return s;
  };
  const fromBase = (s, b) => {
    s = String(s).trim(); if (!s) return 0; if (s.length > 10) E('#NUM!');
    const v = parseInt(s, b); if (isNaN(v)) E('#NUM!');
    return s.length === 10 && v >= Math.pow(b, 10) / 2 ? v - Math.pow(b, 10) : v;
  };
  def({
    BIN2DEC: (a) => fromBase(a[0], 2), OCT2DEC: (a) => fromBase(a[0], 8), HEX2DEC: (a) => fromBase(a[0], 16),
    DEC2BIN: (a) => toBase(num(a[0]), 2, has(a, 1) ? num(a[1]) : null), DEC2OCT: (a) => toBase(num(a[0]), 8, has(a, 1) ? num(a[1]) : null), DEC2HEX: (a) => toBase(num(a[0]), 16, has(a, 1) ? num(a[1]) : null),
    BIN2HEX: (a) => toBase(fromBase(a[0], 2), 16, has(a, 1) ? num(a[1]) : null), BIN2OCT: (a) => toBase(fromBase(a[0], 2), 8, has(a, 1) ? num(a[1]) : null),
    HEX2BIN: (a) => toBase(fromBase(a[0], 16), 2, has(a, 1) ? num(a[1]) : null), HEX2OCT: (a) => toBase(fromBase(a[0], 16), 8, has(a, 1) ? num(a[1]) : null),
    OCT2BIN: (a) => toBase(fromBase(a[0], 8), 2, has(a, 1) ? num(a[1]) : null), OCT2HEX: (a) => toBase(fromBase(a[0], 8), 16, has(a, 1) ? num(a[1]) : null)
  });

  // ---- CONVERT(number, from, to)
  const U = {};
  const add = (group, list) => list.forEach(([names, f]) => names.split(' ').forEach((n) => { U[n] = { g: group, f }; }));
  add('len', [['m', 1], ['km', 1000], ['cm', 0.01], ['mm', 0.001], ['in', 0.0254], ['ft', 0.3048], ['yd', 0.9144], ['mi', 1609.344], ['Nmi', 1852], ['ang', 1e-10], ['ly', 9.4607304725808e15]]);
  add('mass', [['g', 1], ['kg', 1000], ['mg', 0.001], ['lbm', 453.59237], ['ozm', 28.349523125], ['ton', 907184.74], ['uk_ton LTON brton', 1016046.9088], ['stone', 6350.29318]]);
  add('time', [['sec s', 1], ['mn min', 60], ['hr', 3600], ['day d', 86400], ['wk', 604800], ['yr', 31557600]]);
  add('vol', [['l L lt', 1], ['ml mL', 0.001], ['gal', 3.785411784], ['qt', 0.946352946], ['pt us_pt', 0.473176473], ['cup', 0.2365882365], ['oz', 0.0295735295625], ['tbs', 0.01478676478125], ['tsp', 0.00492892159375], ['m3', 1000], ['ft3', 28.316846592], ['in3', 0.016387064], ['uk_gal', 4.54609]]);
  add('area', [['m2', 1], ['km2', 1e6], ['ft2', 0.09290304], ['in2', 0.00064516], ['yd2', 0.83612736], ['mi2', 2589988.110336], ['ha', 10000], ['uk_acre us_acre', 4046.8564224]]);
  add('speed', [['m/s m/sec', 1], ['m/h m/hr', 1 / 3600], ['mph', 0.44704], ['kn', 0.514444444444444], ['km/h', 1 / 3.6]]);
  add('energy', [['J', 1], ['kJ', 1000], ['cal', 4.1868], ['kcal', 4186.8], ['Wh', 3600], ['kWh', 3.6e6], ['BTU btu', 1055.05585262], ['eV ev', 1.602176634e-19]]);
  add('power', [['W w', 1], ['kW', 1000], ['HP h', 745.69987158227], ['PS', 735.49875]]);
  add('pressure', [['Pa p', 1], ['kPa', 1000], ['atm at', 101325], ['mmHg', 133.322387415], ['psi', 6894.75729316836], ['bar', 100000]]);
  add('info', [['bit', 1], ['byte', 8], ['kbyte', 8000], ['Mbyte', 8e6], ['Gbyte', 8e9], ['Tbyte', 8e12], ['kibyte', 8192], ['Mibyte', 8388608], ['Gibyte', 8589934592]]);
  const TEMP = { C: 'C', cel: 'C', F: 'F', fah: 'F', K: 'K', kel: 'K', Rank: 'R', Reau: 'Re' };
  const toK = (v, u) => (u === 'C' ? v + 273.15 : u === 'F' ? (v - 32) * 5 / 9 + 273.15 : u === 'R' ? v * 5 / 9 : u === 'Re' ? v * 1.25 + 273.15 : v);
  const fromK = (k, u) => (u === 'C' ? k - 273.15 : u === 'F' ? (k - 273.15) * 9 / 5 + 32 : u === 'R' ? k * 9 / 5 : u === 'Re' ? (k - 273.15) * 0.8 : k);
  def({
    CONVERT: (a) => {
      const v = num(a[0]), f = str(a[1]), t = str(a[2]);
      if (TEMP[f] && TEMP[t]) return fromK(toK(v, TEMP[f]), TEMP[t]);
      const x = U[f], y = U[t];
      if (!x || !y || x.g !== y.g) E('#N/A');
      return v * x.f / y.f;
    }
  });

  // =============================================================== statistics on ranges
  const allA = (v) => flat([v]).filter((x) => x !== '' && x != null).map((x) => (typeof x === 'number' ? x : x === true ? 1 : 0));
  agg({
    PERCENTOF: (a) => { const t = sum(nums(a[1])); if (!t) E('#DIV/0!'); return sum(nums(a[0])) / t; },
    VARA: (a) => vr(a.flatMap(allA), 1), VARPA: (a) => vr(a.flatMap(allA), 0), STDEVPA: (a) => sd(a.flatMap(allA), 0),
    'SKEW.P': (a) => { const xs = a.flatMap(nums); const m = mean(xs), s = Math.sqrt(vr(xs, 0)); if (!s) E('#DIV/0!'); return sum(xs.map((x) => ((x - m) / s) ** 3)) / xs.length; },
    'Z.TEST': (a) => { const xs = nums(a[0]); const m = mean(xs), sg = has(a, 2) ? num(a[2]) : sd(xs, 1); return 1 - ncdf((m - num(a[1])) / (sg / Math.sqrt(xs.length))); },
    ZTEST: (a) => FN['Z.TEST'](a),
    'CONFIDENCE.T': (a) => { const al = num(a[0]), s = num(a[1]), n = Math.floor(num(a[2])); if (n < 2) E('#DIV/0!'); return invert((t) => tcdf(t, n - 1), 1 - al / 2, -1e4, 1e4) * s / Math.sqrt(n); },
    'T.TEST': (a) => {
      const x = nums(a[0]), y = nums(a[1]), tails = num(a[2]), type = num(a[3]);
      let t, df;
      if (type === 1) { if (x.length !== y.length) E('#N/A'); const d = x.map((v, i) => v - y[i]); t = mean(d) / (sd(d, 1) / Math.sqrt(d.length)); df = d.length - 1; }
      else if (type === 2) { const nx = x.length, ny = y.length; const sp = ((nx - 1) * vr(x, 1) + (ny - 1) * vr(y, 1)) / (nx + ny - 2); t = (mean(x) - mean(y)) / Math.sqrt(sp * (1 / nx + 1 / ny)); df = nx + ny - 2; }
      else { const vx = vr(x, 1) / x.length, vy = vr(y, 1) / y.length; t = (mean(x) - mean(y)) / Math.sqrt(vx + vy); df = (vx + vy) ** 2 / (vx * vx / (x.length - 1) + vy * vy / (y.length - 1)); }
      const p = 1 - tcdf(Math.abs(t), df);
      return tails === 1 ? p : 2 * p;
    },
    TTEST: (a) => FN['T.TEST'](a),
    'CHISQ.TEST': (a) => {
      const o = grid(a[0]), e = grid(a[1]);
      let chi = 0; o.forEach((row, i) => row.forEach((v, j) => { const ex = num(e[i][j]); chi += (num(v) - ex) ** 2 / ex; }));
      const R = o.length, C = o[0].length; const df = R > 1 && C > 1 ? (R - 1) * (C - 1) : Math.max(R, C) - 1;
      return 1 - chicdf(chi, df);
    },
    CHITEST: (a) => FN['CHISQ.TEST'](a),
    'PERCENTRANK.EXC': (a) => { const xs = nums(a[0]).sort((p, q) => p - q), x = num(a[1]), sig = opt(a, 2, 3); const n = xs.length; let i = xs.findIndex((v) => v >= x); if (i < 0 || x < xs[0]) E('#N/A'); let r; if (xs[i] === x) r = (i + 1) / (n + 1); else r = (i + (x - xs[i - 1]) / (xs[i] - xs[i - 1])) / (n + 1); const f = Math.pow(10, sig); return Math.floor(r * f) / f; },
    MULTINOMIAL: (a) => { const xs = a.flatMap(nums).map(Math.floor); return Math.round(Math.exp(gammaln(sum(xs) + 1) - sum(xs.map((x) => gammaln(x + 1))))); },
    SERIESSUM: (a) => { const x = num(a[0]), n = num(a[1]), m = num(a[2]); return nums(a[3]).reduce((s, c, i) => s + c * Math.pow(x, n + i * m), 0); },
    FVSCHEDULE: (a) => nums(a[1]).reduce((p, r) => p * (1 + r), num(a[0])),
    PROB: (a) => { const xs = flat([a[0]]), ps = flat([a[1]]); const lo = num(a[2]), hi = has(a, 3) ? num(a[3]) : lo; let s = 0; xs.forEach((x, i) => { if (typeof x === 'number' && x >= lo && x <= hi) s += num(ps[i]); }); return s; }
  });
  // LINEST / LOGEST (single x): returns slope and intercept (and stats when asked)
  const linfit = (ys, xs) => {
    const n = ys.length; if (n < 2) E('#DIV/0!');
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    const m = sxy / sxx, b = my - m * mx;
    return { m, b, n, mx, my, sxx };
  };
  agg({
    LINEST: (a) => {
      const ys = nums(a[0]); const xs = has(a, 1) ? nums(a[1]) : ys.map((_, i) => i + 1);
      const useConst = optB(a, 2, true);
      let m, b;
      if (useConst) ({ m, b } = linfit(ys, xs)); else { m = sum(xs.map((x, i) => x * ys[i])) / sum(xs.map((x) => x * x)); b = 0; }
      if (!optB(a, 3, false)) return A([[m, b]]);
      const n = ys.length, df = n - (useConst ? 2 : 1);
      const fit = xs.map((x) => m * x + b); const my = mean(ys);
      const ssr = sum(fit.map((f) => (f - (useConst ? my : 0)) ** 2)), sse = sum(ys.map((y, i) => (y - fit[i]) ** 2));
      const sey = Math.sqrt(sse / df), mx = mean(xs), sxx = sum(xs.map((x) => (x - mx) ** 2));
      const sem = sey / Math.sqrt(useConst ? sxx : sum(xs.map((x) => x * x))), seb = useConst ? sey * Math.sqrt(1 / n + mx * mx / sxx) : ERR('#N/A');
      const r2 = ssr / (ssr + sse);
      return A([[m, b], [sem, seb], [r2, sey], [ssr / 1 / (sse / df), df], [ssr, sse]]);
    },
    LOGEST: (a) => { const ys = nums(a[0]).map((y) => Math.log(pos(y))); const xs = has(a, 1) ? nums(a[1]) : ys.map((_, i) => i + 1); const { m, b } = linfit(ys, xs); return A([[Math.exp(m), Math.exp(b)]]); }
  });

  // =============================================================== matrices
  const sq = (v) => { const g = grid(v).map((r) => r.map(num)); if (g.length !== g[0].length) E('#VALUE!'); return g; };
  const det = (m) => { const n = m.length; const a = m.map((r) => r.slice()); let d = 1; for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r; if (Math.abs(a[p][i]) < 1e-14) return 0; if (p !== i) { [a[p], a[i]] = [a[i], a[p]]; d = -d; } d *= a[i][i]; for (let r = i + 1; r < n; r++) { const f = a[r][i] / a[i][i]; for (let c = i; c < n; c++) a[r][c] -= f * a[i][c]; } } return d; };
  agg({
    MDETERM: (a) => det(sq(a[0])),
    MINVERSE: (a) => {
      const m = sq(a[0]); const n = m.length;
      const aug = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
      for (let i = 0; i < n; i++) {
        let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(aug[r][i]) > Math.abs(aug[p][i])) p = r;
        if (Math.abs(aug[p][i]) < 1e-14) E('#NUM!');
        [aug[p], aug[i]] = [aug[i], aug[p]];
        const pv = aug[i][i]; for (let c = 0; c < 2 * n; c++) aug[i][c] /= pv;
        for (let r = 0; r < n; r++) if (r !== i) { const f = aug[r][i]; for (let c = 0; c < 2 * n; c++) aug[r][c] -= f * aug[i][c]; }
      }
      return A(aug.map((r) => r.slice(n)));
    },
    MUNIT: (a) => { const n = Math.floor(num(a[0])); if (n < 1) E('#VALUE!'); return A(Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_2, j) => (i === j ? 1 : 0)))); },
    WRAPCOLS: (a) => { const xs = flat([a[0]]); const k = Math.floor(num(a[1])); if (k < 1) E('#VALUE!'); const pad = has(a, 2) ? a[2] : ERR('#N/A'); const cols = Math.ceil(xs.length / k); return A(Array.from({ length: k }, (_, i) => Array.from({ length: cols }, (_2, j) => (j * k + i < xs.length ? xs[j * k + i] : pad)))); },
    TRIMRANGE: (a) => { let g = grid(a[0]); const blank = (x) => x === '' || x == null; while (g.length > 1 && g[g.length - 1].every(blank)) g = g.slice(0, -1); while (g.length > 1 && g[0].every(blank)) g = g.slice(1); let c2 = g[0].length - 1; while (c2 > 0 && g.every((r) => blank(r[c2]))) c2--; let c1 = 0; while (c1 < c2 && g.every((r) => blank(r[c1]))) c1++; return A(g.map((r) => r.slice(c1, c2 + 1))); }
  });

  // =============================================================== workbook info
  LAZY.SHEET = (n, ctx) => {
    const ps = (D.project() && D.project().sheets) || [];
    if (!n.length) return Math.max(1, ps.indexOf(ctx.sheet) + 1);
    const node = n[0];
    if (node.k === 'ref') { const s = node.sheet ? F.resolveSheet(node.sheet) : ctx.sheet; return Math.max(1, ps.indexOf(s) + 1); }
    const v = F.ev(node, ctx); const i = ps.findIndex((s) => s.name.toLowerCase() === String(v).toLowerCase()); if (i < 0) E('#NA'); return i + 1;
  };
  LAZY.SHEETS = () => ((D.project() && D.project().sheets) || []).filter((s) => s.type === 'data').length || 1;
  LAZY.AREAS = (n) => (n[0] && n[0].k === 'ref' ? String(n[0].ref).split(',').length : 1);

  // =============================================================== finance extras
  const yearDays = (basis) => (basis === 1 || basis === 3 ? 365 : 360);
  const dser = (v) => (typeof v === 'number' ? v : F.serial(F.toDate(v) || E('#VALUE!')));
  def({
    DB: (a) => {
      const cost = num(a[0]), salv = num(a[1]), life = num(a[2]), per = num(a[3]), month = opt(a, 4, 12);
      const rate = Math.round((1 - Math.pow(salv / cost, 1 / life)) * 1000) / 1000;
      let total = 0, dep = 0;
      for (let p = 1; p <= per; p++) { dep = p === 1 ? cost * rate * month / 12 : p === Math.floor(life) + 1 ? (cost - total) * rate * (12 - month) / 12 : (cost - total) * rate; total += dep; }
      return dep;
    },
    VDB: (a) => {
      const cost = num(a[0]), salv = num(a[1]), life = num(a[2]), s = num(a[3]), e = num(a[4]), factor = opt(a, 5, 2), noSwitch = optB(a, 6, false);
      let book = cost, total = 0;
      for (let p = 0; p < Math.ceil(e); p++) {
        const ddb = book * factor / life, sl = (book - salv) / (life - p);
        let dep = !noSwitch && sl > ddb ? sl : ddb;
        dep = Math.max(0, Math.min(dep, book - salv));
        const from = Math.max(p, s), to = Math.min(p + 1, e);
        if (to > from) total += dep * (to - from);
        book -= dep;
      }
      return total;
    },
    INTRATE: (a) => { const s = dser(a[0]), m = dser(a[1]), inv = num(a[2]), red = num(a[3]), b = opt(a, 4, 0); return (red - inv) / inv * yearDays(b) / (m - s); },
    RECEIVED: (a) => { const s = dser(a[0]), m = dser(a[1]), inv = num(a[2]), disc = num(a[3]), b = opt(a, 4, 0); return inv / (1 - disc * (m - s) / yearDays(b)); },
    DISC: (a) => { const s = dser(a[0]), m = dser(a[1]), pr = num(a[2]), red = num(a[3]), b = opt(a, 4, 0); return (red - pr) / red * yearDays(b) / (m - s); },
    PRICEDISC: (a) => { const s = dser(a[0]), m = dser(a[1]), disc = num(a[2]), red = num(a[3]), b = opt(a, 4, 0); return red - disc * red * (m - s) / yearDays(b); },
    TBILLPRICE: (a) => { const d = dser(a[1]) - dser(a[0]); return 100 * (1 - num(a[2]) * d / 360); },
    TBILLYIELD: (a) => { const d = dser(a[1]) - dser(a[0]), p = num(a[2]); return (100 - p) / p * 360 / d; },
    TBILLEQ: (a) => { const d = dser(a[1]) - dser(a[0]), r = num(a[2]); return 365 * r / (360 - r * d); }
  });
  // WORKDAY.INTL(start, days, [weekend], [holidays])
  const weekendMask = (w) => {
    if (w === '' || w == null) w = 1;
    if (typeof w === 'string' && /^[01]{7}$/.test(w)) return w.split('').map((c) => c === '1'); // Monday first
    const m = { 1: [5, 6], 2: [6, 0], 3: [0, 1], 4: [1, 2], 5: [2, 3], 6: [3, 4], 7: [4, 5], 11: [6], 12: [0], 13: [1], 14: [2], 15: [3], 16: [4], 17: [5] }[num(w)];
    if (!m) E('#NUM!');
    const out = Array(7).fill(false); m.forEach((i) => { out[i] = true; }); return out;
  };
  FN['WORKDAY.INTL'] = (a) => {
    let d = F.toDate(typeof a[0] === 'number' ? F.isoDate(F.fromSerial(a[0])) : a[0]); if (!d) E('#VALUE!');
    let n = Math.trunc(num(a[1]));
    const mask = weekendMask(has(a, 2) ? a[2] : 1);
    const hol = new Set(flat([has(a, 3) ? a[3] : []]).map((x) => (typeof x === 'number' ? x : F.toDate(x) ? F.serial(F.toDate(x)) : null)).filter((x) => x != null));
    const step = n >= 0 ? 1 : -1;
    while (n !== 0) { d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + step); const wd = (d.getDay() + 6) % 7; if (!mask[wd] && !hol.has(F.serial(d))) n -= step; }
    return F.isoDate(d);
  };

  // =============================================================== help entries + browser categories
  const HELP = `
Logic|LAMBDA|Make a reusable function|LAMBDA(x, x*2)
Logic|MAP|Apply a LAMBDA to every value|MAP(B2:B9, LAMBDA(v, v*1.1))
Logic|REDUCE|Fold values into one result|REDUCE(0, B2:B9, LAMBDA(a, v, a+v))
Logic|SCAN|Running results of a LAMBDA|SCAN(0, B2:B9, LAMBDA(a, v, a+v))
Logic|BYROW|One result per row|BYROW(B2:D9, LAMBDA(r, SUM(r)))
Logic|BYCOL|One result per column|BYCOL(B2:D9, LAMBDA(c, MAX(c)))
Logic|MAKEARRAY|Build an array from a LAMBDA|MAKEARRAY(3, 3, LAMBDA(r, c, r*c))
Logic|ISOMITTED|Was a LAMBDA argument left out?|ISOMITTED(x)
Lookup|GROUPBY|Group rows and summarise|GROUPBY(A2:A99, C2:C99, SUM)
Lookup|TRIMRANGE|Drop empty edges of a range|TRIMRANGE(A:D)
Lookup|WRAPCOLS|Wrap a list into columns|WRAPCOLS(A2:A20, 5)
Database|DSUM|Sum matching records|DSUM(A1:D99, "Sales", F1:G2)
Database|DAVERAGE|Average of matching records|DAVERAGE(A1:D99, "Sales", F1:G2)
Database|DCOUNT|Count numbers in matching records|DCOUNT(A1:D99, "Sales", F1:G2)
Database|DCOUNTA|Count non-blank in matching records|DCOUNTA(A1:D99, "Rep", F1:G2)
Database|DMAX|Largest value in matching records|DMAX(A1:D99, "Sales", F1:G2)
Database|DMIN|Smallest value in matching records|DMIN(A1:D99, "Sales", F1:G2)
Database|DGET|The single matching value|DGET(A1:D99, "Sales", F1:G2)
Database|DPRODUCT|Product of matching records|DPRODUCT(A1:D99, "Qty", F1:G2)
Database|DSTDEV|Std dev of matching records|DSTDEV(A1:D99, "Sales", F1:G2)
Database|DVAR|Variance of matching records|DVAR(A1:D99, "Sales", F1:G2)
Statistics|T.DIST|Student's t distribution|T.DIST(1.5, 10, TRUE)
Statistics|T.INV.2T|Two-tailed t critical value|T.INV.2T(5%, 10)
Statistics|T.TEST|t-test p-value|T.TEST(A2:A20, B2:B20, 2, 3)
Statistics|CHISQ.TEST|Chi-squared test p-value|CHISQ.TEST(B2:C4, E2:F4)
Statistics|CHISQ.DIST.RT|Chi-squared right tail|CHISQ.DIST.RT(3.84, 1)
Statistics|F.DIST|F distribution|F.DIST(2.5, 3, 20, TRUE)
Statistics|Z.TEST|z-test p-value|Z.TEST(A2:A50, 100)
Statistics|CONFIDENCE.T|Confidence interval (t)|CONFIDENCE.T(5%, 12, 30)
Statistics|LINEST|Line of best fit (slope, intercept)|LINEST(C2:C13, A2:A13)
Statistics|LOGEST|Exponential fit|LOGEST(C2:C13, A2:A13)
Statistics|GAMMA.DIST|Gamma distribution|GAMMA.DIST(5, 2, 3, TRUE)
Statistics|BETA.DIST|Beta distribution|BETA.DIST(0.4, 2, 5, TRUE)
Statistics|LOGNORM.DIST|Lognormal distribution|LOGNORM.DIST(4, 1, 0.5, TRUE)
Statistics|WEIBULL.DIST|Weibull distribution|WEIBULL.DIST(10, 2, 15, TRUE)
Statistics|BINOM.INV|Smallest k with cumulative ≥ α|BINOM.INV(50, 0.3, 0.9)
Statistics|HYPGEOM.DIST|Hypergeometric distribution|HYPGEOM.DIST(2, 10, 8, 40, FALSE)
Statistics|FISHER|Fisher transformation|FISHER(0.75)
Statistics|PERCENTOF|Share of a total|PERCENTOF(B2, B2:B9)
Math|GAMMA|Gamma function|GAMMA(4.5)
Math|ERF|Error function|ERF(1)
Math|MDETERM|Matrix determinant|MDETERM(A1:C3)
Math|MINVERSE|Matrix inverse|MINVERSE(A1:C3)
Math|MUNIT|Identity matrix|MUNIT(3)
Math|MULTINOMIAL|Multinomial coefficient|MULTINOMIAL(2, 3, 4)
Math|COMBINA|Combinations with repetition|COMBINA(4, 3)
Math|CONVERT|Convert units|CONVERT(5, "mi", "km")
Math|DEC2HEX|Decimal to hexadecimal|DEC2HEX(255)
Math|HEX2DEC|Hexadecimal to decimal|HEX2DEC("FF")
Math|DEC2BIN|Decimal to binary|DEC2BIN(10, 8)
Math|BITAND|Bitwise AND|BITAND(12, 10)
Date|WORKDAY.INTL|Workday with custom weekends|WORKDAY.INTL(A1, 10, 7)
Finance|DB|Fixed-declining depreciation|DB(10000, 1000, 5, 1)
Finance|VDB|Variable declining balance|VDB(10000, 1000, 5, 0, 1)
Finance|FVSCHEDULE|Future value with changing rates|FVSCHEDULE(1000, B2:B5)
Finance|DISC|Discount rate of a security|DISC(A1, B1, 97, 100)
Finance|TBILLYIELD|Treasury bill yield|TBILLYIELD(A1, B1, 98.5)
Text|ENCODEURL|URL-encode text|ENCODEURL(A1)
Info|SHEET|Sheet number|SHEET()
Info|SHEETS|Number of data sheets|SHEETS()
`;
  HELP.trim().split('\n').forEach((line) => {
    const [cat, name, desc, ex] = line.split('|');
    F.FN_HELP[name] = ex ? `${desc} · ${ex}` : desc;
    (F.CATS[cat] ||= []).push(name);
  });
  F.functions = [...new Set([...Object.keys(FN), ...Object.keys(LAZY).filter((k) => LAZY[k])])].filter((k) => !k.includes('_')).sort();
  F.CATS['More'] = F.functions.filter((f) => !F.FN_HELP[f]);
  // LAMBDA-based formulas are written to Excel as their values (Excel needs _xlpm. parameter names Datum doesn't track)
  ['MAP', 'SCAN', 'BYROW', 'BYCOL', 'MAKEARRAY', 'GROUPBY', 'MINVERSE', 'MUNIT', 'WRAPCOLS', 'TRIMRANGE', 'LINEST', 'LOGEST'].forEach((f) => F.ARRAY_FNS && F.ARRAY_FNS.add(f));
  F.DATUM_ONLY.push('LAMBDA', 'MAP', 'REDUCE', 'SCAN', 'BYROW', 'BYCOL', 'MAKEARRAY', 'ISOMITTED', 'GROUPBY', 'SHEETS');
})();
