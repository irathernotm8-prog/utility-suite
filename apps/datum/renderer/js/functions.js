// Datum - Excel-compatible function library (registered into D.f.FN / D.f.LAZY)
(function () {
  const F = D.f;
  const { ERR, isErr, isArr, num, str, truthy, flat, nums, criteria, broadcast, wildRe, refRange, resolveSheet } = F.lib;
  const FN = F.FN, LAZY = F.LAZY;
  const E = (c) => { throw { code: c }; };
  const A = (rows) => ({ range: rows });
  const grid = (v) => (isArr(v) ? v.range : [[v]]);
  const has = (a, i) => a.length > i && a[i] !== '' && a[i] != null;
  const opt = (a, i, d) => (has(a, i) ? num(a[i]) : d);
  const optB = (a, i, d) => (has(a, i) ? truthy(a[i]) : d);
  const sum = (xs) => xs.reduce((s, x) => s + x, 0);
  const mean = (xs) => (xs.length ? sum(xs) / xs.length : E('#DIV/0!'));
  const eq = (x, y) => (typeof x === 'number' && typeof y === 'number' ? x === y : String(x ?? '').toLowerCase() === String(y ?? '').toLowerCase());
  const vec = (v) => flat([v]);

  // scalar functions lift element-wise over arrays (=ROUND(B2:B9, 1) spills like Excel)
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

  // ---------------- dates
  const dt = (v) => {
    if (isArr(v)) v = flat([v])[0];
    if (typeof v === 'number') return F.fromSerial(v);
    if (v instanceof Date) return v;
    const d = F.toDate(v); if (!d) E('#VALUE!'); return d;
  };
  const iso = (d) => F.isoDate(d);
  const ser = (v) => F.serial(dt(v));
  const timeFrac = (v) => {
    if (typeof v === 'number') return v - Math.floor(v);
    const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i.exec(String(v));
    if (!m) return 0;
    let hh = +m[1]; if (m[4]) { if (/pm/i.test(m[4]) && hh < 12) hh += 12; if (/am/i.test(m[4]) && hh === 12) hh = 0; }
    return (hh * 3600 + +m[2] * 60 + +(m[3] || 0)) / 86400;
  };
  const holidays = (v) => new Set(v == null || v === '' ? [] : vec(v).filter((x) => x !== '').map(ser));
  const isWorkday = (s, hol) => { const d = F.fromSerial(s).getDay(); return d !== 0 && d !== 6 && !hol.has(s); };

  // ---------------- math
  const roundHalfAway = (x, d) => { const f = 10 ** d; const y = Math.abs(x) * f; const r = Math.round(y + 1e-9 * Math.max(1, y)); return Math.sign(x) * r / f; };
  const fact = (n) => { n = Math.floor(n); if (n < 0) E('#NUM!'); let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
  const gcd2 = (x, y) => { x = Math.abs(Math.floor(x)); y = Math.abs(Math.floor(y)); while (y) [x, y] = [y, x % y]; return x; };
  def({
    ABS: (a) => Math.abs(num(a[0])),
    SIGN: (a) => Math.sign(num(a[0])),
    SQRT: (a) => { const x = num(a[0]); if (x < 0) E('#NUM!'); return Math.sqrt(x); },
    SQRTPI: (a) => Math.sqrt(num(a[0]) * Math.PI),
    POWER: (a) => num(a[0]) ** num(a[1]),
    EXP: (a) => Math.exp(num(a[0])),
    LN: (a) => { const x = num(a[0]); if (x <= 0) E('#NUM!'); return Math.log(x); },
    LOG: (a) => { const x = num(a[0]); if (x <= 0) E('#NUM!'); return Math.log(x) / Math.log(opt(a, 1, 10)); },
    LOG10: (a) => Math.log10(num(a[0])),
    MOD: (a) => { const n = num(a[0]), d = num(a[1]); if (d === 0) E('#DIV/0!'); return n - d * Math.floor(n / d); },
    QUOTIENT: (a) => { const d = num(a[1]); if (d === 0) E('#DIV/0!'); return Math.trunc(num(a[0]) / d); },
    INT: (a) => Math.floor(num(a[0])),
    TRUNC: (a) => { const f = 10 ** opt(a, 1, 0); return Math.trunc(num(a[0]) * f) / f; },
    ROUND: (a) => roundHalfAway(num(a[0]), opt(a, 1, 0)),
    ROUNDUP: (a) => { const f = 10 ** opt(a, 1, 0); const x = num(a[0]); return Math.sign(x) * Math.ceil(Math.abs(x) * f - 1e-9) / f; },
    ROUNDDOWN: (a) => { const f = 10 ** opt(a, 1, 0); const x = num(a[0]); return Math.sign(x) * Math.floor(Math.abs(x) * f + 1e-9) / f; },
    MROUND: (a) => { const m = num(a[1]); if (!m) return 0; return roundHalfAway(num(a[0]) / m, 0) * m; },
    CEILING: (a) => { const x = num(a[0]), s = opt(a, 1, 1); if (!s) return 0; return Math.ceil(x / s - 1e-12) * s; },
    'CEILING.MATH': (a) => { const x = num(a[0]), s = Math.abs(opt(a, 1, 1)) || 1; return x < 0 && optB(a, 2, false) ? Math.floor(x / s) * s : Math.ceil(x / s - 1e-12) * s; },
    'CEILING.PRECISE': (a) => { const s = Math.abs(opt(a, 1, 1)) || 1; return Math.ceil(num(a[0]) / s - 1e-12) * s; },
    FLOOR: (a) => { const x = num(a[0]), s = opt(a, 1, 1); if (!s) E('#DIV/0!'); return Math.floor(x / s + 1e-12) * s; },
    'FLOOR.MATH': (a) => { const x = num(a[0]), s = Math.abs(opt(a, 1, 1)) || 1; return x < 0 && optB(a, 2, false) ? Math.ceil(x / s) * s : Math.floor(x / s + 1e-12) * s; },
    'FLOOR.PRECISE': (a) => { const s = Math.abs(opt(a, 1, 1)) || 1; return Math.floor(num(a[0]) / s + 1e-12) * s; },
    EVEN: (a) => { const x = num(a[0]); const r = Math.ceil(Math.abs(x) / 2) * 2; return Math.sign(x) * r || 0; },
    ODD: (a) => { const x = num(a[0]); let r = Math.ceil(Math.abs(x)); if (r % 2 === 0) r++; return x < 0 ? -r : r; },
    FACT: (a) => fact(num(a[0])),
    FACTDOUBLE: (a) => { let n = Math.floor(num(a[0])), r = 1; while (n > 1) { r *= n; n -= 2; } return r; },
    COMBIN: (a) => { const n = Math.floor(num(a[0])), k = Math.floor(num(a[1])); if (k > n || k < 0) E('#NUM!'); let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); },
    PERMUT: (a) => { const n = Math.floor(num(a[0])), k = Math.floor(num(a[1])); if (k > n || k < 0) E('#NUM!'); let r = 1; for (let i = 0; i < k; i++) r *= n - i; return r; },
    PI: () => Math.PI,
    RAND: () => Math.random(),
    RANDBETWEEN: (a) => { const lo = Math.ceil(num(a[0])), hi = Math.floor(num(a[1])); return lo + Math.floor(Math.random() * (hi - lo + 1)); },
    DEGREES: (a) => num(a[0]) * 180 / Math.PI,
    RADIANS: (a) => num(a[0]) * Math.PI / 180,
    SIN: (a) => Math.sin(num(a[0])), COS: (a) => Math.cos(num(a[0])), TAN: (a) => Math.tan(num(a[0])),
    ASIN: (a) => Math.asin(num(a[0])), ACOS: (a) => Math.acos(num(a[0])), ATAN: (a) => Math.atan(num(a[0])),
    ATAN2: (a) => Math.atan2(num(a[1]), num(a[0])),
    SINH: (a) => Math.sinh(num(a[0])), COSH: (a) => Math.cosh(num(a[0])), TANH: (a) => Math.tanh(num(a[0])),
    ASINH: (a) => Math.asinh(num(a[0])), ACOSH: (a) => Math.acosh(num(a[0])), ATANH: (a) => Math.atanh(num(a[0])),
    COT: (a) => 1 / Math.tan(num(a[0])), CSC: (a) => 1 / Math.sin(num(a[0])), SEC: (a) => 1 / Math.cos(num(a[0])),
    BASE: (a) => { const s = Math.floor(num(a[0])).toString(opt(a, 1, 10)).toUpperCase(); return s.padStart(opt(a, 2, 0), '0'); },
    DECIMAL: (a) => { const v = parseInt(str(a[0]), num(a[1])); if (isNaN(v)) E('#NUM!'); return v; },
    ROMAN: (a) => { let n = Math.floor(num(a[0])); if (n < 0 || n > 3999) E('#VALUE!'); const t = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = ''; for (const [v, r] of t) while (n >= v) { s += r; n -= v; } return s; },
    ARABIC: (a) => { const m = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }; const s = str(a[0]).toUpperCase().trim(); let t = 0; for (let i = 0; i < s.length; i++) { const v = m[s[i]], n = m[s[i + 1]]; if (!v) E('#VALUE!'); t += n > v ? -v : v; } return t; }
  });
  agg({
    SUM: (a) => sum(nums(a)),
    SUMSQ: (a) => sum(nums(a).map((x) => x * x)),
    PRODUCT: (a) => nums(a).reduce((x, y) => x * y, 1),
    GCD: (a) => nums(a).reduce((x, y) => gcd2(x, y), 0),
    LCM: (a) => nums(a).reduce((x, y) => (x && y ? Math.abs(x * y) / gcd2(x, y) : 0), 1),
    SUMPRODUCT: (a) => {
      const gs = a.map(grid);
      const R = gs[0].length, C = gs[0][0].length;
      if (gs.some((g) => g.length !== R || g[0].length !== C)) E('#VALUE!');
      let s = 0;
      for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) { let p = 1; for (const g of gs) { const v = g[i][j]; if (isErr(v)) E(v.err); p *= typeof v === 'number' ? v : typeof v === 'boolean' ? +v : 0; } s += p; }
      return s;
    },
    SUMX2MY2: (a) => { const x = vec(a[0]), y = vec(a[1]); let s = 0; x.forEach((v, i) => { if (typeof v === 'number' && typeof y[i] === 'number') s += v * v - y[i] * y[i]; }); return s; },
    SUMX2PY2: (a) => { const x = vec(a[0]), y = vec(a[1]); let s = 0; x.forEach((v, i) => { if (typeof v === 'number' && typeof y[i] === 'number') s += v * v + y[i] * y[i]; }); return s; },
    SUMXMY2: (a) => { const x = vec(a[0]), y = vec(a[1]); let s = 0; x.forEach((v, i) => { if (typeof v === 'number' && typeof y[i] === 'number') s += (v - y[i]) ** 2; }); return s; },
    MMULT: (a) => {
      const x = grid(a[0]), y = grid(a[1]);
      if (x[0].length !== y.length) E('#VALUE!');
      return A(x.map((row) => y[0].map((_, j) => row.reduce((s, v, k) => s + num(v) * num(y[k][j]), 0))));
    },
    RANDARRAY: (a) => { const R = opt(a, 0, 1), C = opt(a, 1, 1), lo = opt(a, 2, 0), hi = opt(a, 3, 1), whole = optB(a, 4, false); return A(Array.from({ length: R }, () => Array.from({ length: C }, () => (whole ? lo + Math.floor(Math.random() * (hi - lo + 1)) : lo + Math.random() * (hi - lo))))); }
  });

  // ---------------- statistics
  const numsA = (a) => flat(a).filter((v) => v !== '' && v != null).map((v) => (typeof v === 'number' ? v : typeof v === 'boolean' ? +v : isErr(v) ? E(v.err) : 0));
  const sorted = (xs) => xs.slice().sort((x, y) => x - y);
  const variance = (xs, sample) => { const n = xs.length; if (n < (sample ? 2 : 1)) E('#DIV/0!'); const m = mean(xs); return sum(xs.map((x) => (x - m) ** 2)) / (n - (sample ? 1 : 0)); };
  const pctInc = (xs, p) => { const s = sorted(xs); if (!s.length || p < 0 || p > 1) E('#NUM!'); const i = p * (s.length - 1); const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
  const pctExc = (xs, p) => { const s = sorted(xs); const n = s.length; const i = p * (n + 1) - 1; if (i < 0 || i > n - 1) E('#NUM!'); const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, n - 1)] - s[lo]) * (i - lo); };
  const pairs = (a, b) => { const x = vec(a), y = vec(b); if (x.length !== y.length) E('#N/A'); const px = [], py = []; x.forEach((v, i) => { if (typeof v === 'number' && typeof y[i] === 'number') { px.push(v); py.push(y[i]); } }); return [px, py]; };
  const linreg = (ys, xs) => { const [py, px] = pairs(ys, xs); const n = px.length; if (n < 2) E('#DIV/0!'); const mx = mean(px), my = mean(py); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (px[i] - mx) * (py[i] - my); sxx += (px[i] - mx) ** 2; syy += (py[i] - my) ** 2; } if (!sxx) E('#DIV/0!'); const slope = sxy / sxx; return { slope, intercept: my - slope * mx, r: syy ? sxy / Math.sqrt(sxx * syy) : 0, n, sxx, syy, sxy, mx, my }; };
  const rankOf = (v, xs, asc) => xs.filter((x) => (asc ? x < v : x > v)).length + 1;
  // normal distribution helpers
  const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
  const ncdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
  const npdf = (z) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  const ninv = (p) => {
    if (p <= 0 || p >= 1) E('#NUM!');
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    let q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  };
  agg({
    AVERAGE: (a) => mean(nums(a)),
    AVERAGEA: (a) => mean(numsA(a)),
    MIN: (a) => { const n = nums(a); return n.length ? Math.min(...n) : 0; },
    MAX: (a) => { const n = nums(a); return n.length ? Math.max(...n) : 0; },
    MINA: (a) => { const n = numsA(a); return n.length ? Math.min(...n) : 0; },
    MAXA: (a) => { const n = numsA(a); return n.length ? Math.max(...n) : 0; },
    COUNT: (a) => a.reduce((n, x) => n + (isArr(x) ? flat([x]).filter((v) => typeof v === 'number').length : (typeof x === 'number' || typeof x === 'boolean' || (typeof x === 'string' && x !== '' && typeof F.parseLiteral(x) === 'number') ? 1 : 0)), 0),
    COUNTA: (a) => flat(a).filter((v) => v !== '' && v != null).length,
    COUNTBLANK: (a) => flat(a).filter((v) => v === '' || v == null).length,
    COUNTUNIQUE: (a) => new Set(flat(a).filter((v) => v !== '' && v != null).map((v) => String(v).toLowerCase())).size,
    MEDIAN: (a) => { const s = sorted(nums(a)); if (!s.length) E('#NUM!'); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; },
    MODE: (a) => { const c = new Map(); let best = null, bc = 1; nums(a).forEach((v) => { const k = (c.get(v) || 0) + 1; c.set(v, k); if (k > bc) { bc = k; best = v; } }); if (best == null) E('#N/A'); return best; },
    'MODE.MULT': (a) => { const c = new Map(); nums(a).forEach((v) => c.set(v, (c.get(v) || 0) + 1)); const mx = Math.max(...c.values()); if (mx < 2) E('#N/A'); return A([...c].filter(([, k]) => k === mx).map(([v]) => [v])); },
    LARGE: (a) => { const s = sorted(nums([a[0]])).reverse(); const k = Math.floor(num(a[1])); if (k < 1 || k > s.length) E('#NUM!'); return s[k - 1]; },
    SMALL: (a) => { const s = sorted(nums([a[0]])); const k = Math.floor(num(a[1])); if (k < 1 || k > s.length) E('#NUM!'); return s[k - 1]; },
    RANK: (a) => { const v = num(a[0]), xs = nums([a[1]]); if (!xs.includes(v)) E('#N/A'); return rankOf(v, xs, optB(a, 2, false)); },
    'RANK.AVG': (a) => { const v = num(a[0]), xs = nums([a[1]]); const k = xs.filter((x) => x === v).length; if (!k) E('#N/A'); return rankOf(v, xs, optB(a, 2, false)) + (k - 1) / 2; },
    PERCENTILE: (a) => pctInc(nums([a[0]]), num(a[1])),
    'PERCENTILE.EXC': (a) => pctExc(nums([a[0]]), num(a[1])),
    QUARTILE: (a) => pctInc(nums([a[0]]), Math.floor(num(a[1])) / 4),
    'QUARTILE.EXC': (a) => pctExc(nums([a[0]]), Math.floor(num(a[1])) / 4),
    PERCENTRANK: (a) => { const s = sorted(nums([a[0]])), x = num(a[1]); const n = s.length; if (!n || x < s[0] || x > s[n - 1]) E('#N/A'); let i = s.findIndex((v) => v >= x); let r; if (s[i] === x) r = i / (n - 1); else r = (i - 1 + (x - s[i - 1]) / (s[i] - s[i - 1])) / (n - 1); const f = 10 ** opt(a, 2, 3); return Math.floor(r * f) / f; },
    STDEV: (a) => Math.sqrt(variance(nums(a), true)),
    STDEVP: (a) => Math.sqrt(variance(nums(a), false)),
    STDEVA: (a) => Math.sqrt(variance(numsA(a), true)),
    VAR: (a) => variance(nums(a), true),
    VARP: (a) => variance(nums(a), false),
    AVEDEV: (a) => { const n = nums(a); const m = mean(n); return mean(n.map((x) => Math.abs(x - m))); },
    DEVSQ: (a) => { const n = nums(a); const m = mean(n); return sum(n.map((x) => (x - m) ** 2)); },
    GEOMEAN: (a) => { const n = nums(a); if (!n.length || n.some((x) => x <= 0)) E('#NUM!'); return Math.exp(mean(n.map(Math.log))); },
    HARMEAN: (a) => { const n = nums(a); if (!n.length || n.some((x) => x <= 0)) E('#NUM!'); return n.length / sum(n.map((x) => 1 / x)); },
    TRIMMEAN: (a) => { const s = sorted(nums([a[0]])); const k = Math.floor(s.length * num(a[1]) / 2); return mean(s.slice(k, s.length - k)); },
    SKEW: (a) => { const n = nums(a); const N = n.length; if (N < 3) E('#DIV/0!'); const m = mean(n), sd = Math.sqrt(variance(n, true)); return N / ((N - 1) * (N - 2)) * sum(n.map((x) => ((x - m) / sd) ** 3)); },
    KURT: (a) => { const n = nums(a); const N = n.length; if (N < 4) E('#DIV/0!'); const m = mean(n), sd = Math.sqrt(variance(n, true)); return N * (N + 1) / ((N - 1) * (N - 2) * (N - 3)) * sum(n.map((x) => ((x - m) / sd) ** 4)) - 3 * (N - 1) ** 2 / ((N - 2) * (N - 3)); },
    CORREL: (a) => linreg(a[0], a[1]).r,
    PEARSON: (a) => linreg(a[0], a[1]).r,
    RSQ: (a) => linreg(a[0], a[1]).r ** 2,
    SLOPE: (a) => linreg(a[0], a[1]).slope,
    INTERCEPT: (a) => linreg(a[0], a[1]).intercept,
    STEYX: (a) => { const L = linreg(a[0], a[1]); if (L.n < 3) E('#DIV/0!'); return Math.sqrt((L.syy - L.sxy ** 2 / L.sxx) / (L.n - 2)); },
    COVAR: (a) => { const [x, y] = pairs(a[0], a[1]); const mx = mean(x), my = mean(y); return sum(x.map((v, i) => (v - mx) * (y[i] - my))) / x.length; },
    'COVARIANCE.S': (a) => { const [x, y] = pairs(a[0], a[1]); if (x.length < 2) E('#DIV/0!'); const mx = mean(x), my = mean(y); return sum(x.map((v, i) => (v - mx) * (y[i] - my))) / (x.length - 1); },
    FORECAST: (a) => { const L = linreg(a[1], a[2]); return F.mapArr(a[0], (x) => L.intercept + L.slope * num(x)); },
    TREND: (a) => {
      const ys = vec(a[0]);
      const xs = has(a, 1) ? vec(a[1]) : ys.map((_, i) => i + 1);
      const L = linreg(A(ys.map((v) => [v])), A(xs.map((v) => [v])));
      const nx = has(a, 2) ? a[2] : A(xs.map((v) => [v]));
      return F.mapArr(nx, (x) => L.intercept + L.slope * num(x));
    },
    STANDARDIZE: (a) => (num(a[0]) - num(a[1])) / num(a[2]),
    'NORM.DIST': (a) => { const z = (num(a[0]) - num(a[1])) / num(a[2]); return truthy(a[3]) ? ncdf(z) : npdf(z) / num(a[2]); },
    'NORM.S.DIST': (a) => { const z = num(a[0]); return optB(a, 1, true) ? ncdf(z) : npdf(z); },
    NORMSDIST: (a) => ncdf(num(a[0])),
    'NORM.INV': (a) => num(a[1]) + num(a[2]) * ninv(num(a[0])),
    'NORM.S.INV': (a) => ninv(num(a[0])),
    'CONFIDENCE.NORM': (a) => -ninv(num(a[0]) / 2) * num(a[1]) / Math.sqrt(num(a[2])),
    'EXPON.DIST': (a) => { const x = num(a[0]), l = num(a[1]); return truthy(a[2]) ? 1 - Math.exp(-l * x) : l * Math.exp(-l * x); },
    'POISSON.DIST': (a) => { const k = Math.floor(num(a[0])), m = num(a[1]); const p = (i) => Math.exp(-m) * m ** i / fact(i); if (!truthy(a[2])) return p(k); let s = 0; for (let i = 0; i <= k; i++) s += p(i); return s; },
    'BINOM.DIST': (a) => { const k = Math.floor(num(a[0])), n = Math.floor(num(a[1])), p = num(a[2]); const c = (i) => { let r = 1; for (let j = 1; j <= i; j++) r = r * (n - i + j) / j; return r * p ** i * (1 - p) ** (n - i); }; if (!truthy(a[3])) return c(k); let s = 0; for (let i = 0; i <= k; i++) s += c(i); return s; },
    FREQUENCY: (a) => { const d = nums([a[0]]), b = sorted(nums([a[1]])); const out = b.map(() => 0).concat([0]); d.forEach((v) => { const i = b.findIndex((x) => v <= x); out[i < 0 ? b.length : i]++; }); return A(out.map((x) => [x])); }
  });
  ['NORMDIST', 'NORM_DIST'].forEach((k) => { FN[k] = FN['NORM.DIST']; });
  FN.NORMINV = FN['NORM.INV']; FN.NORMSINV = FN['NORM.S.INV'];
  Object.assign(FN, { 'STDEV.S': FN.STDEV, 'STDEV.P': FN.STDEVP, 'VAR.S': FN.VAR, 'VAR.P': FN.VARP, 'MODE.SNGL': FN.MODE, 'RANK.EQ': FN.RANK, 'PERCENTILE.INC': FN.PERCENTILE, 'QUARTILE.INC': FN.QUARTILE, 'PERCENTRANK.INC': FN.PERCENTRANK, 'COVARIANCE.P': FN.COVAR, 'FORECAST.LINEAR': FN.FORECAST, AVG: FN.AVERAGE, CONFIDENCE: FN['CONFIDENCE.NORM'], EXPONDIST: FN['EXPON.DIST'], POISSON: FN['POISSON.DIST'], BINOMDIST: FN['BINOM.DIST'] });

  // ---------------- conditional aggregates
  const multiCrit = (a, start) => {
    const tests = [];
    for (let i = start; i + 1 < a.length; i += 2) tests.push([vec(a[i]), criteria(a[i + 1])]);
    return (idx) => tests.every(([rng, t]) => t(rng[idx]));
  };
  const pickIf = (a, start, valuesIdx) => { const vals = vec(a[valuesIdx]); const ok = multiCrit(a, start); return vals.filter((v, i) => ok(i) && typeof v === 'number'); };
  agg({
    SUMIF: (a) => { const rng = vec(a[0]), t = criteria(a[1]), sr = has(a, 2) ? vec(a[2]) : rng; let s = 0; rng.forEach((v, i) => { if (t(v) && typeof sr[i] === 'number') s += sr[i]; }); return s; },
    COUNTIF: (a) => { const t = criteria(a[1]); return vec(a[0]).filter((v) => t(v)).length; },
    AVERAGEIF: (a) => { const rng = vec(a[0]), t = criteria(a[1]), sr = has(a, 2) ? vec(a[2]) : rng; return mean(rng.map((v, i) => (t(v) && typeof sr[i] === 'number' ? sr[i] : null)).filter((x) => x != null)); },
    SUMIFS: (a) => sum(pickIf(a, 1, 0)),
    AVERAGEIFS: (a) => mean(pickIf(a, 1, 0)),
    MAXIFS: (a) => { const v = pickIf(a, 1, 0); return v.length ? Math.max(...v) : 0; },
    MINIFS: (a) => { const v = pickIf(a, 1, 0); return v.length ? Math.min(...v) : 0; },
    COUNTIFS: (a) => { const n = vec(a[0]).length; const ok = multiCrit(a, 0); let c = 0; for (let i = 0; i < n; i++) if (ok(i)) c++; return c; }
  });
  // a range given as the criteria returns one answer per criterion (=COUNTIFS(L:L, Q12:Q27) spills 16 counts)
  const critLift = (name, critIdx) => {
    const f = FN[name];
    FN[name] = (a, ctx) => {
      const ci = critIdx(a).filter((i) => isArr(a[i]));
      if (!ci.length) return f(a, ctx);
      const g = a[ci[0]].range, R = g.length, C = g[0].length;
      return A(Array.from({ length: R }, (_, r) => Array.from({ length: C }, (_, c) => {
        const b = a.slice(); ci.forEach((i) => { const gi = a[i].range; b[i] = (gi[r] || gi[0] || [''])[gi[0].length === 1 ? 0 : c] ?? ''; });
        try { return f(b, ctx); } catch (e) { return ERR(e.code || '#VALUE!'); }
      })));
    };
  };
  const odd = (from) => (a) => a.map((_, i) => i).filter((i) => i >= from && (i - from) % 2 === 1);
  critLift('COUNTIFS', odd(0)); critLift('SUMIFS', odd(1)); critLift('AVERAGEIFS', odd(1)); critLift('MAXIFS', odd(1)); critLift('MINIFS', odd(1));
  critLift('COUNTIF', () => [1]); critLift('SUMIF', () => [1]); critLift('AVERAGEIF', () => [1]);

  // ---------------- logic & info
  def({
    NOT: (a) => !truthy(a[0]),
    ISBLANK: (a) => a[0] === '' || a[0] == null,
    ISNUMBER: (a) => typeof a[0] === 'number',
    ISTEXT: (a) => typeof a[0] === 'string' && a[0] !== '',
    ISNONTEXT: (a) => !(typeof a[0] === 'string' && a[0] !== ''),
    ISLOGICAL: (a) => typeof a[0] === 'boolean',
    ISERROR: (a) => isErr(a[0]),
    ISERR: (a) => isErr(a[0]) && a[0].err !== '#N/A',
    ISNA: (a) => isErr(a[0]) && a[0].err === '#N/A',
    ISEVEN: (a) => Math.trunc(num(a[0])) % 2 === 0,
    ISODD: (a) => Math.abs(Math.trunc(num(a[0])) % 2) === 1,
    N: (a) => (typeof a[0] === 'number' ? a[0] : typeof a[0] === 'boolean' ? +a[0] : isErr(a[0]) ? E(a[0].err) : 0),
    T: (a) => (typeof a[0] === 'string' ? a[0] : ''),
    TYPE: (a) => (typeof a[0] === 'number' ? 1 : typeof a[0] === 'string' ? 2 : typeof a[0] === 'boolean' ? 4 : isErr(a[0]) ? 16 : 1),
    'ERROR.TYPE': (a) => { if (!isErr(a[0])) E('#N/A'); return ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'].indexOf(a[0].err) + 1 || 8; },
    SINGLE: (a) => (isArr(a[0]) ? flat([a[0]])[0] : a[0])
  });
  FN.ISBLANK = (a) => (isArr(a[0]) ? F.mapArr(a[0], (v) => v === '' || v == null) : a[0] === '' || a[0] == null);
  agg({
    AND: (a) => { const v = flat(a).filter((x) => x !== '' && x != null && typeof x !== 'string'); if (!v.length) E('#VALUE!'); return v.every(truthy); },
    OR: (a) => { const v = flat(a).filter((x) => x !== '' && x != null && typeof x !== 'string'); if (!v.length) E('#VALUE!'); return v.some(truthy); },
    XOR: (a) => flat(a).filter((x) => x !== '' && x != null && typeof x !== 'string').filter(truthy).length % 2 === 1,
    TRUE: () => true,
    FALSE: () => false,
    NA: () => ERR('#N/A')
  });
  // lazy: only the needed branch is evaluated (and IF works element-wise on arrays)
  LAZY.IF = (n, ctx, ev) => {
    const c = ev(n[0], ctx);
    const val = (i, dflt) => (n[i] && n[i].k !== 'missing' ? ev(n[i], ctx) : n.length > i ? 0 : dflt);
    if (isArr(c)) {
      const t = val(1, true), f = val(2, false);
      return broadcast(broadcast(c, t, (x, y) => [x, y]), f, (xy, z) => { if (isErr(xy[0])) return xy[0]; return truthy(xy[0]) ? xy[1] : z; });
    }
    return truthy(c) ? val(1, true) : val(2, false);
  };
  const tryEv = (node, ctx, ev) => { try { return ev(node, ctx); } catch (e) { return ERR(e.code || '#ERROR!'); } };
  const fallbackOn = (test) => (n, ctx, ev) => {
    const v = tryEv(n[0], ctx, ev);
    if (isArr(v)) { let fb; return F.mapArr(v, (x) => (test(x) ? (fb ??= ev(n[1], ctx)) : x)); }
    return test(v) ? ev(n[1], ctx) : v;
  };
  LAZY.IFERROR = fallbackOn((x) => isErr(x));
  LAZY.IFNA = fallbackOn((x) => isErr(x) && x.err === '#N/A');
  LAZY.IFS = (n, ctx, ev) => { for (let i = 0; i + 1 < n.length; i += 2) if (truthy(ev(n[i], ctx))) return ev(n[i + 1], ctx); E('#N/A'); };
  LAZY.SWITCH = (n, ctx, ev) => {
    const v = ev(n[0], ctx);
    for (let i = 1; i + 1 < n.length; i += 2) if (eq(isArr(v) ? flat([v])[0] : v, ev(n[i], ctx))) return ev(n[i + 1], ctx);
    if (n.length % 2 === 0) return ev(n[n.length - 1], ctx);
    E('#N/A');
  };
  LAZY.CHOOSE = (n, ctx, ev) => {
    const iv = ev(n[0], ctx);
    if (isArr(iv)) return F.mapArr(iv, (x) => { const i = Math.floor(num(x)); if (i < 1 || i >= n.length) E('#VALUE!'); return flat([ev(n[i], ctx)])[0]; });
    const i = Math.floor(num(iv)); if (i < 1 || i >= n.length) E('#VALUE!');
    return ev(n[i], ctx);
  };
  LAZY.LET = (n, ctx, ev) => {
    const vars = { ...(ctx.vars || {}) };
    let c = { ...ctx, vars };
    for (let i = 0; i + 1 < n.length; i += 2) {
      const nm = n[i]; if (nm.k !== 'name') E('#VALUE!');
      vars[nm.v] = ev(n[i + 1], c);
    }
    return ev(n[n.length - 1], c);
  };

  // ---------------- references (need the reference, not just its values)
  const asRef = (node, ctx, ev) => { const v = ev(node, { ...ctx, wantRef: true }); if (!v || !v.ref) E('#REF!'); return v.ref; };
  LAZY.ROW = (n, ctx, ev) => { if (!n.length || n[0].k === 'missing') return ctx.r + 1; const r = asRef(n[0], ctx, ev); return r.r1 === r.r2 ? r.r1 + 1 : A(Array.from({ length: r.r2 - r.r1 + 1 }, (_, i) => [r.r1 + i + 1])); };
  LAZY.COLUMN = (n, ctx, ev) => { if (!n.length || n[0].k === 'missing') return ctx.c + 1; const r = asRef(n[0], ctx, ev); return r.c1 === r.c2 ? r.c1 + 1 : A([Array.from({ length: r.c2 - r.c1 + 1 }, (_, i) => r.c1 + i + 1)]); };
  LAZY.ROWS = (n, ctx, ev) => { const v = ev(n[0], { ...ctx, wantRef: true }); return v && v.ref ? v.ref.r2 - v.ref.r1 + 1 : grid(v).length; };
  LAZY.COLUMNS = (n, ctx, ev) => { const v = ev(n[0], { ...ctx, wantRef: true }); return v && v.ref ? v.ref.c2 - v.ref.c1 + 1 : grid(v)[0].length; };
  LAZY.ISREF = (n, ctx, ev) => { try { const v = ev(n[0], { ...ctx, wantRef: true }); return !!(v && v.ref); } catch { return false; } };
  LAZY.ISFORMULA = (n, ctx, ev) => { const r = asRef(n[0], ctx, ev); const raw = r.sheet.cells[r.r1] && r.sheet.cells[r.r1][r.c1]; return typeof raw === 'string' && raw[0] === '='; };
  LAZY.FORMULATEXT = (n, ctx, ev) => { const r = asRef(n[0], ctx, ev); const raw = r.sheet.cells[r.r1] && r.sheet.cells[r.r1][r.c1]; if (!(typeof raw === 'string' && raw[0] === '=')) E('#N/A'); return raw; };
  LAZY.OFFSET = (n, ctx, ev) => {
    const r = asRef(n[0], ctx, ev);
    const a = n.slice(1).map((x) => (x.k === 'missing' ? '' : ev(x, ctx)));
    const dr = opt(a, 0, 0), dc = opt(a, 1, 0);
    const hh = has(a, 2) ? num(a[2]) : r.r2 - r.r1 + 1, ww = has(a, 3) ? num(a[3]) : r.c2 - r.c1 + 1;
    const r1 = r.r1 + dr, c1 = r.c1 + dc;
    if (r1 < 0 || c1 < 0 || hh < 1 || ww < 1) E('#REF!');
    return refRange(r.sheet, { r1, c1, r2: r1 + hh - 1, c2: c1 + ww - 1 });
  };
  const parseRefText = (text, ctx) => {
    const t = String(text).trim();
    const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(t);
    const sheet = resolveSheet(m ? (m[1] != null ? m[1].replace(/''/g, "'") : m[2]) : null, ctx.sheet);
    const area = F.parseArea(m ? m[3] : t);
    if (!area) {
      const names = (D.project() && D.project().names) || {};
      const key = Object.keys(names).find((k) => k.toUpperCase() === t.toUpperCase());
      if (key) return parseRefText(String(names[key]).replace(/^=/, ''), ctx);
      E('#REF!');
    }
    return refRange(sheet, area);
  };
  FN.INDIRECT = (a, ctx) => parseRefText(str(a[0]), ctx);
  LAZY.SUBTOTAL = (n, ctx, ev) => aggregateRefs(Math.floor(num(ev(n[0], ctx))) % 100, n.slice(1), ctx, ev, { skipHidden: true, skipErrors: false });
  LAZY.AGGREGATE = (n, ctx, ev) => {
    const fnum = Math.floor(num(ev(n[0], ctx))), o = Math.floor(num(ev(n[1], ctx)));
    return aggregateRefs(fnum, n.slice(2), ctx, ev, { skipHidden: [1, 3, 5, 7].includes(o), skipErrors: [2, 3, 6, 7].includes(o), k: fnum >= 14 });
  };
  const AGG_FN = { 1: 'AVERAGE', 2: 'COUNT', 3: 'COUNTA', 4: 'MAX', 5: 'MIN', 6: 'PRODUCT', 7: 'STDEV', 8: 'STDEVP', 9: 'SUM', 10: 'VAR', 11: 'VARP', 12: 'MEDIAN', 13: 'MODE', 14: 'LARGE', 15: 'SMALL', 16: 'PERCENTILE', 17: 'QUARTILE', 18: 'PERCENTILE.EXC', 19: 'QUARTILE.EXC' };
  function aggregateRefs(code, nodes, ctx, ev, o) {
    const name = AGG_FN[code]; if (!name) E('#VALUE!');
    const kNode = o.k ? nodes.pop() : null;
    const vals = [];
    for (const node of nodes) {
      const v = ev(node, { ...ctx, wantRef: true });
      if (v && v.ref) {
        const hid = o.skipHidden ? F.hiddenRows(v.ref.sheet) : new Set();
        v.range.forEach((row, i) => row.forEach((x, j) => {
          const r = v.ref.r1 + i, c = v.ref.c1 + j;
          if (hid.has(r)) return;
          const raw = v.ref.sheet.cells[r] && v.ref.sheet.cells[r][c];
          if (typeof raw === 'string' && /^=\s*(SUBTOTAL|AGGREGATE)\(/i.test(raw)) return; // no double counting
          if (o.skipErrors && isErr(x)) return;
          vals.push(x);
        }));
      } else flat([v]).forEach((x) => { if (!(o.skipErrors && isErr(x))) vals.push(x); });
    }
    const args = [A([vals.length ? vals : ['']])];
    if (kNode) args.push(ev(kNode, ctx));
    return FN[name](args, ctx);
  }

  // ---------------- lookup & arrays
  const isWild = (k) => typeof k === 'string' && /[*?~]/.test(k);
  // exact match through a cached index when the keys come straight from a sheet range
  const fastFind = (src, which, keysOf, k, last) => {
    if (!isArr(src) || isArr(k) || !F.lookupIndex) return null;
    const ix = F.lookupIndex(src.range, which, keysOf);
    const m = last ? ix.last : ix.first;
    const i = m.get(String(k ?? '').toLowerCase());
    return i == null ? -1 : i;
  };
  const findExact = (keys, k) => keys.findIndex((v) => (typeof k === 'string' && /[*?~]/.test(k) ? typeof v === 'string' && wildRe(k).test(v) : eq(v, k)));
  const approx = (keys, k, mode) => { // mode 1: largest <= k (sorted asc), -1: smallest >= k (sorted desc)
    let best = -1;
    for (let i = 0; i < keys.length; i++) {
      const v = keys[i];
      if (v === '' || v == null) continue;
      const c = typeof v === typeof k ? (typeof v === 'number' ? v - k : String(v).localeCompare(String(k), undefined, { sensitivity: 'base' })) : null;
      if (c == null) continue;
      if (mode === 1) { if (c <= 0) best = i; else break; }
      else { if (c >= 0) best = i; else break; }
    }
    return best;
  };
  agg({
    VLOOKUP: (a) => {
      const t = grid(a[1]); const col = Math.floor(num(a[2])) - 1;
      if (col < 0 || col >= t[0].length) E('#REF!');
      const exact = !optB(a, 3, true);
      const fast = exact && !isWild(a[0]) ? fastFind(a[1], 'c0', () => t.map((r) => r[0]), a[0]) : null;
      const i = fast != null ? fast : exact ? findExact(t.map((r) => r[0]), a[0]) : approx(t.map((r) => r[0]), a[0], 1);
      if (i < 0) E('#N/A');
      return t[i][col] ?? '';
    },
    HLOOKUP: (a) => {
      const t = grid(a[1]); const row = Math.floor(num(a[2])) - 1;
      if (row < 0 || row >= t.length) E('#REF!');
      const i = !optB(a, 3, true) ? findExact(t[0], a[0]) : approx(t[0], a[0], 1);
      if (i < 0) E('#N/A');
      return t[row][i] ?? '';
    },
    LOOKUP: (a) => {
      const keys = has(a, 2) ? vec(a[1]) : (() => { const g = grid(a[1]); return g.length >= g[0].length ? g.map((r) => r[0]) : g[0]; })();
      const res = has(a, 2) ? vec(a[2]) : (() => { const g = grid(a[1]); return g.length >= g[0].length ? g.map((r) => r[r.length - 1]) : g[g.length - 1]; })();
      const i = approx(keys, a[0], 1); if (i < 0) E('#N/A');
      return res[i] ?? E('#N/A');
    },
    MATCH: (a) => {
      const t = opt(a, 2, 1);
      const fast = t === 0 && !isWild(a[0]) ? fastFind(a[1], 'v', () => vec(a[1]), a[0]) : null;
      const i = fast != null ? fast : t === 0 ? findExact(vec(a[1]), a[0]) : approx(vec(a[1]), a[0], t > 0 ? 1 : -1);
      if (i < 0) E('#N/A'); return i + 1;
    },
    XMATCH: (a) => {
      const mode = opt(a, 2, 0), dir = opt(a, 3, 1);
      if (mode === 0 && Math.abs(dir) === 1) { const f = fastFind(a[1], 'v', () => vec(a[1]), a[0], dir < 0); if (f != null) { if (f < 0) E('#N/A'); return f + 1; } }
      const keys = vec(a[1]);
      const order = dir < 0 ? keys.map((_, i) => keys.length - 1 - i) : keys.map((_, i) => i);
      return xfind(keys, order, a[0], mode) + 1;
    },
    XLOOKUP: (a, ctx) => {
      const ret = grid(a[2]);
      const mode = opt(a, 4, 0), dir = opt(a, 5, 1);
      // if_not_found counts when it was written, even as "" (Excel returns the blank)
      const nf = a.length > 3 && (ctx && ctx.given ? ctx.given[3] : has(a, 3));
      let i = mode === 0 && Math.abs(dir) === 1 ? fastFind(a[1], 'v', () => vec(a[1]), a[0], dir < 0) : null;
      let keys = null;
      if (i == null) {
        keys = vec(a[1]);
        const order = dir < 0 ? keys.map((_, j) => keys.length - 1 - j) : keys.map((_, j) => j);
        try { i = xfind(keys, order, a[0], mode); } catch (e) { if (nf) return a[3]; throw e; }
      } else if (i < 0) { if (nf) return a[3]; E('#N/A'); }
      const nKeys = keys ? keys.length : F.lookupIndex(a[1].range, 'v', () => vec(a[1])).n;
      const vertical = ret.length === nKeys;
      if (vertical) return ret[i].length === 1 ? ret[i][0] : A([ret[i]]);
      return ret.length === 1 ? ret[0][i] : A(ret.map((r) => [r[i]]));
    },
    INDEX: (a) => {
      const t = grid(a[0]);
      let r = opt(a, 1, 0), c = opt(a, 2, 0);
      if (t.length === 1 && !has(a, 2) && r) { c = r; r = 1; }
      if (r < 0 || c < 0 || r > t.length || c > t[0].length) E('#REF!');
      if (r === 0 && c === 0) return A(t);
      if (r === 0) return A(t.map((row) => [row[c - 1]]));
      if (c === 0) return t[0].length === 1 ? t[r - 1][0] : A([t[r - 1]]);
      return t[r - 1][c - 1];
    },
    ADDRESS: (a) => { const r = num(a[0]), c = num(a[1]), abs = opt(a, 2, 1); const cs = (abs === 1 || abs === 3 ? '$' : '') + F.colName(c - 1), rs = (abs === 1 || abs === 2 ? '$' : '') + r; const sheet = has(a, 4) ? F.quoteSheet(str(a[4])) + '!' : ''; return sheet + cs + rs; },
    HYPERLINK: (a) => (has(a, 1) ? a[1] : str(a[0])),
    TRANSPOSE: (a) => { const t = grid(a[0]); return A(t[0].map((_, j) => t.map((row) => row[j]))); },
    SEQUENCE: (a) => { const R = Math.floor(opt(a, 0, 1)), C = Math.floor(opt(a, 1, 1)), s0 = opt(a, 2, 1), st = opt(a, 3, 1); if (R < 1 || C < 1) E('#CALC!'); return A(Array.from({ length: R }, (_, i) => Array.from({ length: C }, (_, j) => s0 + (i * C + j) * st))); },
    FILTER: (a) => {
      const t = grid(a[0]), inc = grid(a[1]);
      const byRow = inc.length === t.length && inc[0].length === 1;
      let out;
      if (byRow) out = t.filter((_, i) => truthy(inc[i][0]));
      else if (inc.length === 1 && inc[0].length === t[0].length) { const keep = inc[0].map(truthy); out = t.map((row) => row.filter((_, j) => keep[j])); if (!out[0].length) out = []; }
      else E('#VALUE!');
      if (!out.length) { if (has(a, 2) || a.length > 2) return a[2]; E('#CALC!'); }
      return A(out);
    },
    UNIQUE: (a) => {
      const t = grid(a[0]); const byCol = optB(a, 1, false), once = optB(a, 2, false);
      const rows = byCol ? t[0].map((_, j) => t.map((r) => r[j])) : t;
      const key = (r) => r.map((v) => String(v ?? '').toLowerCase()).join('\u0001');
      const cnt = new Map(); rows.forEach((r) => cnt.set(key(r), (cnt.get(key(r)) || 0) + 1));
      const seen = new Set(); const out = [];
      rows.forEach((r) => { const k = key(r); if (seen.has(k)) return; seen.add(k); if (!once || cnt.get(k) === 1) out.push(r); });
      if (!out.length) E('#CALC!');
      return A(byCol ? out[0].map((_, i) => out.map((r) => r[i])) : out);
    },
    SORT: (a) => {
      const t = grid(a[0]).map((r) => r.slice()); const idx = Math.floor(opt(a, 1, 1)) - 1, ord = opt(a, 2, 1), byCol = optB(a, 3, false);
      if (byCol) { const cols = t[0].map((_, j) => t.map((r) => r[j])); cols.sort((x, y) => cmpVals(x[idx], y[idx]) * ord); return A(t.map((_, i) => cols.map((c) => c[i]))); }
      return A(t.sort((x, y) => cmpVals(x[idx], y[idx]) * ord));
    },
    SORTBY: (a) => {
      const t = grid(a[0]);
      const keys = []; for (let i = 1; i < a.length; i += 2) keys.push([vec(a[i]), opt(a, i + 1, 1)]);
      const ix = t.map((_, i) => i).sort((x, y) => { for (const [k, o] of keys) { const c = cmpVals(k[x], k[y]) * o; if (c) return c; } return 0; });
      return A(ix.map((i) => t[i]));
    },
    TAKE: (a) => { let t = grid(a[0]); const r = has(a, 1) ? num(a[1]) : t.length, c = has(a, 2) ? num(a[2]) : t[0].length; t = r >= 0 ? t.slice(0, r) : t.slice(r); t = t.map((row) => (c >= 0 ? row.slice(0, c) : row.slice(c))); if (!t.length || !t[0].length) E('#CALC!'); return A(t); },
    DROP: (a) => { let t = grid(a[0]); const r = opt(a, 1, 0), c = opt(a, 2, 0); t = r >= 0 ? t.slice(r) : t.slice(0, r); t = t.map((row) => (c >= 0 ? row.slice(c) : row.slice(0, c))); if (!t.length || !t[0].length) E('#CALC!'); return A(t); },
    CHOOSECOLS: (a) => { const t = grid(a[0]); const ix = a.slice(1).flatMap((x) => vec(x)).map((x) => { const i = num(x); return i < 0 ? t[0].length + i : i - 1; }); return A(t.map((r) => ix.map((i) => (r[i] === undefined ? E('#VALUE!') : r[i])))); },
    CHOOSEROWS: (a) => { const t = grid(a[0]); const ix = a.slice(1).flatMap((x) => vec(x)).map((x) => { const i = num(x); return i < 0 ? t.length + i : i - 1; }); return A(ix.map((i) => t[i] || E('#VALUE!'))); },
    VSTACK: (a) => { const gs = a.map(grid); const C = Math.max(...gs.map((g) => g[0].length)); return A(gs.flatMap((g) => g.map((r) => r.concat(Array(C - r.length).fill(ERR('#N/A')))))); },
    HSTACK: (a) => { const gs = a.map(grid); const R = Math.max(...gs.map((g) => g.length)); return A(Array.from({ length: R }, (_, i) => gs.flatMap((g) => g[i] || Array(g[0].length).fill(ERR('#N/A'))))); },
    TOCOL: (a) => A(flat([a[0]]).filter((v) => !(opt(a, 1, 0) & 1 && (v === '' || v == null))).map((v) => [v])),
    TOROW: (a) => A([flat([a[0]]).filter((v) => !(opt(a, 1, 0) & 1 && (v === '' || v == null)))]),
    WRAPROWS: (a) => { const v = flat([a[0]]), w = num(a[1]); const out = []; for (let i = 0; i < v.length; i += w) out.push(v.slice(i, i + w).concat(Array(Math.max(0, w - (v.length - i))).fill(has(a, 2) ? a[2] : ERR('#N/A')))); return A(out); },
    EXPAND: (a) => { const t = grid(a[0]); const R = opt(a, 1, t.length), C = opt(a, 2, t[0].length); const pad = has(a, 3) ? a[3] : ERR('#N/A'); return A(Array.from({ length: R }, (_, i) => Array.from({ length: C }, (_, j) => (t[i] && t[i][j] !== undefined ? t[i][j] : pad)))); }
  });
  function xfind(keys, order, k, mode) {
    if (mode === 2 || (typeof k === 'string' && mode === 0 && false)) { const rx = wildRe(String(k)); for (const i of order) if (typeof keys[i] === 'string' && rx.test(keys[i])) return i; E('#N/A'); }
    for (const i of order) if (eq(keys[i], k)) return i;
    if (mode === -1 || mode === 1) {
      let best = -1, bd = Infinity;
      for (const i of order) {
        const v = keys[i]; if (typeof v !== typeof k || v === '') continue;
        const d = typeof v === 'number' ? v - k : String(v).localeCompare(String(k));
        if (mode === -1 && d < 0 && -d < bd) { bd = -d; best = i; }
        if (mode === 1 && d > 0 && d < bd) { bd = d; best = i; }
      }
      if (best >= 0) return best;
    }
    E('#N/A');
  }
  function cmpVals(x, y) {
    const blank = (v) => v === '' || v == null;
    if (blank(x) && !blank(y)) return 1; if (blank(y) && !blank(x)) return -1;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    if (typeof x === 'number') return -1; if (typeof y === 'number') return 1;
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
  }

  // ---------------- text
  const textFmt = (v, f) => {
    f = String(f);
    const lf = f.toLowerCase();
    if (/^@$/.test(f)) return str(v);
    if (/[ymdhs]/i.test(lf.replace(/"[^"]*"/g, '')) && !/[0#]/.test(lf.replace(/"[^"]*"/g, ''))) {
      const n = typeof v === 'number' ? v : (() => { const d = dt(v); return F.serial(d) + timeFrac(v); })();
      const d = F.fromSerial(Math.floor(n)); const secs = Math.round((n - Math.floor(n)) * 86400);
      const H = Math.floor(secs / 3600), Mi = Math.floor(secs / 60) % 60, S = secs % 60;
      const ampm = /am\/pm/i.test(f);
      const tokens = [['yyyy', () => d.getFullYear()], ['yy', () => String(d.getFullYear()).slice(2)], ['mmmm', () => d.toLocaleString('en-US', { month: 'long' })], ['mmm', () => d.toLocaleString('en-US', { month: 'short' })], ['dddd', () => d.toLocaleString('en-US', { weekday: 'long' })], ['ddd', () => d.toLocaleString('en-US', { weekday: 'short' })], ['dd', () => String(d.getDate()).padStart(2, '0')], ['d', () => d.getDate()], ['hh', () => String(ampm ? ((H + 11) % 12) + 1 : H).padStart(2, '0')], ['h', () => (ampm ? ((H + 11) % 12) + 1 : H)], ['ss', () => String(S).padStart(2, '0')], ['am/pm', () => (H < 12 ? 'AM' : 'PM')]];
      let out = '', i = 0, lastWasHour = false;
      while (i < f.length) {
        if (f[i] === '"') { const j = f.indexOf('"', i + 1); out += f.slice(i + 1, j < 0 ? f.length : j); i = j < 0 ? f.length : j + 1; continue; }
        const rest = f.slice(i).toLowerCase();
        if (rest.startsWith('mm') || rest.startsWith('m')) {
          const isMin = lastWasHour || /^m{1,2}:?s/.test(rest.replace(/^m+:?/, (x) => x + 's').slice(0, 0)) || /^mm?:ss/.test(rest) || (f.slice(0, i).toLowerCase().trim().endsWith(':'));
          if (!rest.startsWith('mmm') && isMin) { const two = rest.startsWith('mm'); out += two ? String(Mi).padStart(2, '0') : Mi; i += two ? 2 : 1; lastWasHour = false; continue; }
          if (!rest.startsWith('mmm')) { const two = rest.startsWith('mm'); out += two ? String(d.getMonth() + 1).padStart(2, '0') : d.getMonth() + 1; i += two ? 2 : 1; continue; }
        }
        const tk = tokens.find(([t]) => rest.startsWith(t));
        if (tk) { out += tk[1](); lastWasHour = tk[0][0] === 'h'; i += tk[0].length; continue; }
        out += f[i]; i++;
      }
      return out;
    }
    const n = num(v);
    const sec = f.split(';');
    let fmt = n < 0 && sec[1] ? sec[1] : n === 0 && sec[2] ? sec[2] : sec[0];
    const neg = n < 0 && !sec[1];
    const pct = /%/.test(fmt);
    let x = Math.abs(n) * (pct ? 100 : 1);
    const lit = fmt.replace(/"([^"]*)"/g, '$1');
    const m = /[0#?,.]+/.exec(lit.replace(/\\(.)/g, '$1'));
    if (!m) return lit;
    const body = m[0];
    const scaleCommas = /,+$/.exec(body.replace(/\.$/, '')); if (scaleCommas && !/\./.test(body.slice(scaleCommas.index))) x /= 1000 ** scaleCommas[0].length;
    const dec = (body.split('.')[1] || '').replace(/[^0#?]/g, '');
    const minDec = (dec.match(/0/g) || []).length, maxDec = dec.length;
    const intPart = body.split('.')[0].replace(/,+$/, '');
    const minInt = (intPart.match(/0/g) || []).length;
    let s = x.toLocaleString('en-US', { minimumFractionDigits: minDec, maximumFractionDigits: maxDec, useGrouping: /,/.test(intPart) });
    if (minInt === 0 && s.startsWith('0') && x < 1 && (minDec || maxDec)) s = s.slice(1);
    const [ip, fp] = s.split('.'); if (ip.replace(/,/g, '').length < minInt) s = ip.padStart(minInt, '0') + (fp != null ? '.' + fp : '');
    return (neg ? '-' : '') + lit.slice(0, m.index) + s + lit.slice(m.index + body.length);
  };
  F.textFormat = textFmt;
  def({
    LEFT: (a) => str(a[0]).slice(0, Math.max(0, opt(a, 1, 1))),
    RIGHT: (a) => { const s = str(a[0]); const n = Math.max(0, opt(a, 1, 1)); return n ? s.slice(-n) : ''; },
    MID: (a) => str(a[0]).substr(Math.max(0, num(a[1]) - 1), Math.max(0, num(a[2]))),
    LEN: (a) => str(a[0]).length,
    UPPER: (a) => str(a[0]).toUpperCase(),
    LOWER: (a) => str(a[0]).toLowerCase(),
    PROPER: (a) => str(a[0]).toLowerCase().replace(/(^|[^a-z'])([a-z])/g, (m0, p, c) => p + c.toUpperCase()),
    TRIM: (a) => str(a[0]).trim().replace(/ +/g, ' '),
    CLEAN: (a) => str(a[0]).replace(/[\x00-\x1F]/g, ''),
    FIND: (a) => { const i = str(a[1]).indexOf(str(a[0]), opt(a, 2, 1) - 1); if (i < 0) E('#VALUE!'); return i + 1; },
    SEARCH: (a) => { const needle = str(a[0]), hay = str(a[1]); const st = opt(a, 2, 1) - 1; if (/[*?]/.test(needle)) { const rx = new RegExp(wildRe(needle).source.slice(1, -1), 'i'); const m = rx.exec(hay.slice(st)); if (!m) E('#VALUE!'); return st + m.index + 1; } const i = hay.toLowerCase().indexOf(needle.toLowerCase(), st); if (i < 0) E('#VALUE!'); return i + 1; },
    SUBSTITUTE: (a) => { const s = str(a[0]), o = str(a[1]), nw = str(a[2]); if (!o) return s; if (!has(a, 3)) return s.split(o).join(nw); let k = num(a[3]), i = -1; while (k-- > 0) { i = s.indexOf(o, i + 1); if (i < 0) return s; } return s.slice(0, i) + nw + s.slice(i + o.length); },
    REPLACE: (a) => { const s0 = str(a[0]); const st = num(a[1]) - 1; return s0.slice(0, st) + str(a[3]) + s0.slice(st + num(a[2])); },
    REPT: (a) => str(a[0]).repeat(Math.max(0, Math.floor(num(a[1])))),
    EXACT: (a) => str(a[0]) === str(a[1]),
    VALUE: (a) => { if (typeof a[0] === 'number') return a[0]; const s = str(a[0]).trim(); const v = F.parseLiteral(s); if (typeof v === 'number') return v; const d = F.toDate(s); if (d && /\d/.test(s)) return F.serial(d) + timeFrac(s); E('#VALUE!'); },
    NUMBERVALUE: (a) => { const dsep = has(a, 1) ? str(a[1]) : '.', gsep = has(a, 2) ? str(a[2]) : ','; let s = str(a[0]).split(gsep).join('').replace(dsep, '.').replace(/\s/g, ''); let pct = 0; while (s.endsWith('%')) { pct++; s = s.slice(0, -1); } const n = +s; if (isNaN(n)) E('#VALUE!'); return n / 100 ** pct; },
    TEXT: (a) => textFmt(a[0], str(a[1])),
    FIXED: (a) => num(a[0]).toLocaleString('en-US', { minimumFractionDigits: Math.max(0, opt(a, 1, 2)), maximumFractionDigits: Math.max(0, opt(a, 1, 2)), useGrouping: !optB(a, 2, false) }),
    DOLLAR: (a) => { const n = num(a[0]), d = opt(a, 1, 2); const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Math.max(0, d), maximumFractionDigits: Math.max(0, d) }); return n < 0 ? `($${s})` : `$${s}`; },
    CHAR: (a) => String.fromCharCode(num(a[0])),
    UNICHAR: (a) => String.fromCodePoint(num(a[0])),
    CODE: (a) => { const s = str(a[0]); if (!s) E('#VALUE!'); return s.charCodeAt(0); },
    UNICODE: (a) => { const s = str(a[0]); if (!s) E('#VALUE!'); return s.codePointAt(0); },
    TEXTBEFORE: (a) => { const s = str(a[0]), d = str(a[1]); let n = opt(a, 2, 1); const ci = opt(a, 3, 0) === 1; const hay = ci ? s.toLowerCase() : s, nd = ci ? d.toLowerCase() : d; let i = -1; if (n > 0) { for (let k = 0; k < n; k++) { i = hay.indexOf(nd, i + 1); if (i < 0) break; } } else { i = hay.length; for (let k = 0; k < -n; k++) { i = hay.lastIndexOf(nd, i - 1); if (i < 0) break; } } if (i < 0) { if (has(a, 5)) return a[5]; E('#N/A'); } return s.slice(0, i); },
    TEXTAFTER: (a) => { const s = str(a[0]), d = str(a[1]); let n = opt(a, 2, 1); const ci = opt(a, 3, 0) === 1; const hay = ci ? s.toLowerCase() : s, nd = ci ? d.toLowerCase() : d; let i = -1; if (n > 0) { for (let k = 0; k < n; k++) { i = hay.indexOf(nd, i + 1); if (i < 0) break; } } else { i = hay.length; for (let k = 0; k < -n; k++) { i = hay.lastIndexOf(nd, i - 1); if (i < 0) break; } } if (i < 0) { if (has(a, 5)) return a[5]; E('#N/A'); } return s.slice(i + d.length); },
    REGEXTEST: (a) => new RegExp(str(a[1]), opt(a, 2, 0) === 1 ? 'i' : '').test(str(a[0])),
    REGEXMATCH: (a) => new RegExp(str(a[1])).test(str(a[0])),
    REGEXEXTRACT: (a) => { const m = new RegExp(str(a[1]), opt(a, 3, 0) === 1 ? 'i' : '').exec(str(a[0])); if (!m) E('#N/A'); return m[1] !== undefined ? m[1] : m[0]; },
    REGEXREPLACE: (a) => str(a[0]).replace(new RegExp(str(a[1]), 'g' + (opt(a, 4, 0) === 1 ? 'i' : '')), str(a[2]))
  });
  agg({
    CONCAT: (a) => flat(a).map(str).join(''),
    CONCATENATE: (a) => a.map(str).join(''),
    TEXTJOIN: (a) => { const skip = truthy(a[1]); return flat(a.slice(2)).filter((v) => !skip || (v !== '' && v != null)).map(str).join(str(a[0])); },
    TEXTSPLIT: (a) => {
      const s = str(a[0]); const cd = has(a, 1) ? vec(a[1]).map(str) : [], rd = has(a, 2) ? vec(a[2]).map(str) : [];
      const split = (t, ds) => (ds.length ? t.split(new RegExp(ds.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'))) : [t]);
      let rows = split(s, rd).map((r) => split(r, cd));
      if (optB(a, 3, false)) rows = rows.map((r) => r.filter((x) => x !== ''));
      const C = Math.max(...rows.map((r) => r.length));
      return A(rows.map((r) => r.concat(Array(C - r.length).fill(has(a, 5) ? a[5] : ERR('#N/A')))));
    },
    ARRAYTOTEXT: (a) => flat([a[0]]).map(str).join(', '),
    VALUETOTEXT: (a) => str(a[0])
  });

  // ---------------- dates & times (dates are ISO text: 2026-10-08)
  def({
    TODAY: () => iso(new Date()),
    DATE: (a) => { const y = num(a[0]); return iso(new Date(y < 1900 ? 1900 + y : y, num(a[1]) - 1, num(a[2]))); },
    DATEVALUE: (a) => ser(str(a[0])),
    TIME: (a) => ((num(a[0]) * 3600 + num(a[1]) * 60 + num(a[2])) / 86400) % 1,
    TIMEVALUE: (a) => timeFrac(str(a[0])),
    YEAR: (a) => dt(a[0]).getFullYear(),
    MONTH: (a) => dt(a[0]).getMonth() + 1,
    DAY: (a) => dt(a[0]).getDate(),
    HOUR: (a) => Math.floor(timeFrac(a[0]) * 24 + 1e-9),
    MINUTE: (a) => Math.floor(timeFrac(a[0]) * 1440 + 1e-9) % 60,
    SECOND: (a) => Math.round(timeFrac(a[0]) * 86400) % 60,
    WEEKDAY: (a) => { const d = dt(a[0]).getDay(); const t = opt(a, 1, 1); if (t === 2) return ((d + 6) % 7) + 1; if (t === 3) return (d + 6) % 7; if (t >= 11 && t <= 17) return ((d - (t - 10) % 7 + 7) % 7) + 1; return d + 1; },
    WEEKNUM: (a) => { const d = dt(a[0]); const startMon = opt(a, 1, 1) === 2 || opt(a, 1, 1) === 11; const j = new Date(d.getFullYear(), 0, 1); const off = startMon ? (j.getDay() + 6) % 7 : j.getDay(); return Math.floor(((d - j) / 86400000 + off) / 7) + 1; },
    ISOWEEKNUM: (a) => { const d = dt(a[0]); const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / 86400000 + 1) / 7); },
    DAYS: (a) => ser(a[0]) - ser(a[1]),
    DAYS360: (a) => { const s = dt(a[0]), e = dt(a[1]); let d1 = Math.min(30, s.getDate()), d2 = e.getDate(); if (d2 === 31 && d1 >= 30) d2 = 30; return (e.getFullYear() - s.getFullYear()) * 360 + (e.getMonth() - s.getMonth()) * 30 + d2 - d1; },
    DATEDIF: (a) => {
      const s = dt(a[0]), e = dt(a[1]), u = str(a[2]).toUpperCase();
      if (s > e) E('#NUM!');
      const months = (e.getFullYear() - s.getFullYear()) * 12 + e.getMonth() - s.getMonth() - (e.getDate() < s.getDate() ? 1 : 0);
      if (u === 'D') return F.serial(e) - F.serial(s);
      if (u === 'M') return months;
      if (u === 'Y') return Math.floor(months / 12);
      if (u === 'YM') return months % 12;
      if (u === 'MD') { const ref = new Date(e.getFullYear(), e.getMonth() - (e.getDate() < s.getDate() ? 1 : 0), s.getDate()); return Math.round((e - ref) / 86400000); }
      if (u === 'YD') { let ref = new Date(e.getFullYear(), s.getMonth(), s.getDate()); if (ref > e) ref = new Date(e.getFullYear() - 1, s.getMonth(), s.getDate()); return Math.round((e - ref) / 86400000); }
      E('#NUM!');
    },
    EDATE: (a) => { const d = dt(a[0]); const t = new Date(d.getFullYear(), d.getMonth() + num(a[1]), 1); return iso(new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()))); },
    EOMONTH: (a) => { const d = dt(a[0]); return iso(new Date(d.getFullYear(), d.getMonth() + num(a[1]) + 1, 0)); },
    YEARFRAC: (a) => { const s = dt(a[0]), e = dt(a[1]); const b = opt(a, 2, 0); const days = Math.abs(F.serial(e) - F.serial(s)); if (b === 0 || b === 4) return Math.abs(FN.DAYS360([a[1], a[0]])) / 360; if (b === 2) return days / 360; if (b === 3) return days / 365; return days / 365.25; }
  });
  agg({
    NOW: () => { const d = new Date(); return `${iso(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; },
    NETWORKDAYS: (a) => { let s = ser(a[0]), e = ser(a[1]); const hol = holidays(has(a, 2) ? a[2] : null); const sign = s <= e ? 1 : -1; if (sign < 0) [s, e] = [e, s]; let n = 0; for (let x = s; x <= e; x++) if (isWorkday(x, hol)) n++; return n * sign; },
    'NETWORKDAYS.INTL': (a) => { let s = ser(a[0]), e = ser(a[1]); const wk = has(a, 2) ? a[2] : 1; const hol = holidays(has(a, 3) ? a[3] : null); const off = typeof wk === 'string' && /^[01]{7}$/.test(wk) ? wk.split('').map((x, i) => (x === '1' ? (i + 1) % 7 : -1)) : ({ 1: [6, 0], 2: [0, 1], 3: [1, 2], 4: [2, 3], 5: [3, 4], 6: [4, 5], 7: [5, 6], 11: [0], 12: [1], 13: [2], 14: [3], 15: [4], 16: [5], 17: [6] }[num(wk)] || [6, 0]); let n = 0; const sign = s <= e ? 1 : -1; if (sign < 0) [s, e] = [e, s]; for (let x = s; x <= e; x++) if (!off.includes(F.fromSerial(x).getDay()) && !hol.has(x)) n++; return n * sign; },
    WORKDAY: (a) => { let s = ser(a[0]); let k = Math.trunc(num(a[1])); const hol = holidays(has(a, 2) ? a[2] : null); const st = k >= 0 ? 1 : -1; while (k) { s += st; if (isWorkday(s, hol)) k -= st; } return iso(F.fromSerial(s)); }
  });

  // ---------------- finance
  const pmtCalc = (r, n, pv, fv = 0, type = 0) => (r === 0 ? -(pv + fv) / n : -(r * (pv * (1 + r) ** n + fv)) / ((1 + type * r) * ((1 + r) ** n - 1)));
  const fvCalc = (r, n, p, pv = 0, type = 0) => (r === 0 ? -(pv + p * n) : -(pv * (1 + r) ** n + p * (1 + r * type) * ((1 + r) ** n - 1) / r));
  const ipmtCalc = (r, per, n, pv, fv = 0, type = 0) => { const p = pmtCalc(r, n, pv, fv, type); if (per === 1 && type === 1) return 0; const bal = fvCalc(r, per - 1, p, pv, type); return (type === 1 ? bal / (1 + r) : bal) * r; };
  const solve = (f, guess) => { let x = guess; for (let i = 0; i < 100; i++) { const y = f(x), d = (f(x + 1e-7) - y) / 1e-7; if (!d) break; const nx = x - y / d; if (!isFinite(nx)) break; if (Math.abs(nx - x) < 1e-10) return nx; x = nx; } if (Math.abs(f(x)) < 1e-6) return x; E('#NUM!'); };
  agg({
    PMT: (a) => pmtCalc(num(a[0]), num(a[1]), num(a[2]), opt(a, 3, 0), opt(a, 4, 0)),
    IPMT: (a) => ipmtCalc(num(a[0]), num(a[1]), num(a[2]), num(a[3]), opt(a, 4, 0), opt(a, 5, 0)),
    PPMT: (a) => pmtCalc(num(a[0]), num(a[2]), num(a[3]), opt(a, 4, 0), opt(a, 5, 0)) - ipmtCalc(num(a[0]), num(a[1]), num(a[2]), num(a[3]), opt(a, 4, 0), opt(a, 5, 0)),
    CUMIPMT: (a) => { let s = 0; for (let p = num(a[3]); p <= num(a[4]); p++) s += ipmtCalc(num(a[0]), p, num(a[1]), num(a[2]), 0, num(a[5])); return s; },
    CUMPRINC: (a) => { let s = 0; const pm = pmtCalc(num(a[0]), num(a[1]), num(a[2]), 0, num(a[5])); for (let p = num(a[3]); p <= num(a[4]); p++) s += pm - ipmtCalc(num(a[0]), p, num(a[1]), num(a[2]), 0, num(a[5])); return s; },
    FV: (a) => fvCalc(num(a[0]), num(a[1]), num(a[2]), opt(a, 3, 0), opt(a, 4, 0)),
    PV: (a) => { const r = num(a[0]), n = num(a[1]), p = num(a[2]), fv = opt(a, 3, 0), t = opt(a, 4, 0); return r === 0 ? -(fv + p * n) : -(fv + p * (1 + r * t) * ((1 + r) ** n - 1) / r) / (1 + r) ** n; },
    NPER: (a) => { const r = num(a[0]), p = num(a[1]), pv = num(a[2]), fv = opt(a, 3, 0), t = opt(a, 4, 0); if (r === 0) return -(pv + fv) / p; const z = p * (1 + r * t) / r; return Math.log((z - fv) / (z + pv)) / Math.log(1 + r); },
    RATE: (a) => { const n = num(a[0]), p = num(a[1]), pv = num(a[2]), fv = opt(a, 3, 0), t = opt(a, 4, 0); return solve((r) => (Math.abs(r) < 1e-12 ? pv + p * n + fv : pv * (1 + r) ** n + p * (1 + r * t) * ((1 + r) ** n - 1) / r + fv), opt(a, 5, 0.1)); },
    NPV: (a) => { const r = num(a[0]); return nums(a.slice(1)).reduce((s, v, i) => s + v / (1 + r) ** (i + 1), 0); },
    IRR: (a) => { const cf = nums([a[0]]); return solve((r) => cf.reduce((s, v, i) => s + v / (1 + r) ** i, 0), opt(a, 1, 0.1)); },
    XNPV: (a) => { const r = num(a[0]); const v = nums([a[1]]), d = vec(a[2]).map(ser); return v.reduce((s, x, i) => s + x / (1 + r) ** ((d[i] - d[0]) / 365), 0); },
    XIRR: (a) => { const v = nums([a[0]]), d = vec(a[1]).map(ser); return solve((r) => v.reduce((s, x, i) => s + x / (1 + r) ** ((d[i] - d[0]) / 365), 0), opt(a, 2, 0.1)); },
    MIRR: (a) => { const cf = nums([a[0]]), fr = num(a[1]), rr = num(a[2]); const n = cf.length; const pvNeg = cf.reduce((s, v, i) => s + (v < 0 ? v / (1 + fr) ** i : 0), 0); const fvPos = cf.reduce((s, v, i) => s + (v > 0 ? v * (1 + rr) ** (n - 1 - i) : 0), 0); return (fvPos / -pvNeg) ** (1 / (n - 1)) - 1; },
    SLN: (a) => (num(a[0]) - num(a[1])) / num(a[2]),
    SYD: (a) => { const c = num(a[0]), s = num(a[1]), l = num(a[2]), p = num(a[3]); return (c - s) * (l - p + 1) * 2 / (l * (l + 1)); },
    DDB: (a) => { const c = num(a[0]), s = num(a[1]), l = num(a[2]), p = num(a[3]), f = opt(a, 4, 2); let book = c, dep = 0; for (let i = 1; i <= p; i++) { dep = Math.min(book * f / l, Math.max(0, book - s)); book -= dep; } return dep; },
    EFFECT: (a) => { const r = num(a[0]), n = Math.floor(num(a[1])); return (1 + r / n) ** n - 1; },
    NOMINAL: (a) => { const r = num(a[0]), n = Math.floor(num(a[1])); return n * ((1 + r) ** (1 / n) - 1); },
    PDURATION: (a) => (Math.log(num(a[2])) - Math.log(num(a[1]))) / Math.log(1 + num(a[0])),
    RRI: (a) => (num(a[2]) / num(a[1])) ** (1 / num(a[0])) - 1,
    // Datum extras (exported to Excel as values)
    CAGR: (a) => { const b = num(a[0]), e = num(a[1]), n = num(a[2]); if (b <= 0 || n <= 0) E('#NUM!'); return (e / b) ** (1 / n) - 1; },
    PCTCHANGE: (a) => { const n = num(a[0]), o = num(a[1]); if (!o) E('#DIV/0!'); return (n - o) / Math.abs(o); },
    LAST: (a) => { const f = flat(a).filter((v) => v !== '' && v != null); return f.length ? f[f.length - 1] : ''; },
    FIRST: (a) => { const f = flat(a).filter((v) => v !== '' && v != null); return f.length ? f[0] : ''; },
    // Excel's GROWTH (exponential trend) when given ranges; Datum's % change when given two numbers
    GROWTH: (a) => {
      if (!isArr(a[0])) return FN.PCTCHANGE(a);
      const ys = vec(a[0]); const xs = has(a, 1) ? vec(a[1]) : ys.map((_, i) => i + 1);
      if (ys.some((y) => typeof y === 'number' && y <= 0)) E('#NUM!');
      const L = linreg(A(ys.map((v) => [typeof v === 'number' ? Math.log(v) : v])), A(xs.map((v) => [v])));
      const nx = has(a, 2) ? a[2] : A(xs.map((v) => [v]));
      return F.mapArr(nx, (x) => Math.exp(L.intercept + L.slope * num(x)));
    }
  });

  F.functions = [...new Set([...Object.keys(FN), ...Object.keys(LAZY).filter((k) => LAZY[k])])].filter((k) => !k.includes('_')).sort();
  // functions Excel doesn't know - written to .xlsx as values
  F.DATUM_ONLY = ['CAGR', 'PCTCHANGE', 'LAST', 'FIRST', 'COUNTUNIQUE', 'REGEXMATCH'];

  // ---------------- help text & categories (function browser)
  const HELP = `
Math|SUM|Adds numbers|SUM(B2:B9)
Math|PRODUCT|Multiplies numbers|PRODUCT(B2:B5)
Math|SUMPRODUCT|Multiply ranges row by row and add|SUMPRODUCT(B2:B9, C2:C9)
Math|SUMSQ|Sum of squares|SUMSQ(B2:B9)
Math|ROUND|Round to n places|ROUND(A1, 2)
Math|ROUNDUP|Round away from zero|ROUNDUP(A1, 0)
Math|ROUNDDOWN|Round toward zero|ROUNDDOWN(A1, 0)
Math|MROUND|Round to a multiple|MROUND(A1, 5)
Math|CEILING|Round up to a multiple|CEILING(A1, 10)
Math|CEILING.MATH|Round up to a multiple (modern)|CEILING.MATH(A1, 5)
Math|FLOOR|Round down to a multiple|FLOOR(A1, 10)
Math|FLOOR.MATH|Round down to a multiple (modern)|FLOOR.MATH(A1, 5)
Math|INT|Round down to a whole number|INT(A1)
Math|TRUNC|Cut off decimals|TRUNC(A1, 1)
Math|EVEN|Round up to the next even number|EVEN(A1)
Math|ODD|Round up to the next odd number|ODD(A1)
Math|ABS|Absolute value|ABS(A1)
Math|SIGN|-1, 0 or 1|SIGN(A1)
Math|MOD|Remainder after division|MOD(A1, 7)
Math|QUOTIENT|Whole part of a division|QUOTIENT(A1, 7)
Math|POWER|x to the power y|POWER(2, 10)
Math|SQRT|Square root|SQRT(A1)
Math|EXP|e to the power x|EXP(1)
Math|LN|Natural log|LN(A1)
Math|LOG|Log, base 10 or given|LOG(A1, 2)
Math|LOG10|Log base 10|LOG10(A1)
Math|PI|π|PI()
Math|RAND|Random number 0 to 1|RAND()
Math|RANDBETWEEN|Random whole number in a range|RANDBETWEEN(1, 100)
Math|RANDARRAY|Array of random numbers|RANDARRAY(5, 1, 1, 100, TRUE)
Math|FACT|Factorial|FACT(5)
Math|COMBIN|Combinations|COMBIN(10, 3)
Math|PERMUT|Permutations|PERMUT(10, 3)
Math|GCD|Greatest common divisor|GCD(12, 18)
Math|LCM|Least common multiple|LCM(4, 6)
Math|DEGREES|Radians to degrees|DEGREES(PI())
Math|RADIANS|Degrees to radians|RADIANS(180)
Math|SIN|Sine|SIN(A1)
Math|COS|Cosine|COS(A1)
Math|TAN|Tangent|TAN(A1)
Math|ATAN2|Angle from x and y|ATAN2(1, 1)
Math|MMULT|Matrix product|MMULT(A1:B2, D1:E2)
Math|BASE|Number to another base|BASE(255, 16)
Math|DECIMAL|Text in a base to a number|DECIMAL("FF", 16)
Math|ROMAN|Roman numerals|ROMAN(2026)
Math|SUBTOTAL|Total that ignores filtered rows (9 = sum, 1 = average…)|SUBTOTAL(9, B2:B100)
Math|AGGREGATE|Total that can skip errors and hidden rows|AGGREGATE(9, 6, B2:B100)
Conditional|SUMIF|Sum where one condition is met|SUMIF(A2:A9, "West", C2:C9)
Conditional|SUMIFS|Sum with several conditions|SUMIFS(C2:C9, A2:A9, "West", B2:B9, ">100")
Conditional|COUNTIF|Count where a condition is met|COUNTIF(A2:A9, "West")
Conditional|COUNTIFS|Count with several conditions|COUNTIFS(A2:A9, "West", B2:B9, ">100")
Conditional|AVERAGEIF|Average where a condition is met|AVERAGEIF(A2:A9, "West", C2:C9)
Conditional|AVERAGEIFS|Average with several conditions|AVERAGEIFS(C2:C9, A2:A9, "West")
Conditional|MAXIFS|Largest value meeting conditions|MAXIFS(C2:C9, A2:A9, "West")
Conditional|MINIFS|Smallest value meeting conditions|MINIFS(C2:C9, A2:A9, "West")
Statistics|AVERAGE|Mean of numbers|AVERAGE(B2:B9)
Statistics|AVERAGEA|Mean counting text as 0|AVERAGEA(B2:B9)
Statistics|MEDIAN|Middle value|MEDIAN(B2:B9)
Statistics|MODE|Most frequent number|MODE(B2:B9)
Statistics|MIN|Smallest value|MIN(B2:B9)
Statistics|MAX|Largest value|MAX(B2:B9)
Statistics|COUNT|Count of numbers|COUNT(B2:B9)
Statistics|COUNTA|Count of non-empty cells|COUNTA(A2:A9)
Statistics|COUNTBLANK|Count of empty cells|COUNTBLANK(A2:A9)
Statistics|COUNTUNIQUE|Count of distinct values (Datum)|COUNTUNIQUE(A2:A9)
Statistics|LARGE|k-th largest|LARGE(B2:B9, 2)
Statistics|SMALL|k-th smallest|SMALL(B2:B9, 2)
Statistics|RANK|Rank of a value in a list|RANK(B2, B$2:B$9)
Statistics|RANK.AVG|Rank, averaging ties|RANK.AVG(B2, B$2:B$9)
Statistics|PERCENTILE|Value at a percentile|PERCENTILE(B2:B9, 0.9)
Statistics|PERCENTRANK|Percentile of a value|PERCENTRANK(B2:B9, B4)
Statistics|QUARTILE|Quartile 0 to 4|QUARTILE(B2:B9, 1)
Statistics|STDEV|Sample standard deviation|STDEV(B2:B9)
Statistics|STDEVP|Population standard deviation|STDEVP(B2:B9)
Statistics|VAR|Sample variance|VAR(B2:B9)
Statistics|VARP|Population variance|VARP(B2:B9)
Statistics|AVEDEV|Average distance from the mean|AVEDEV(B2:B9)
Statistics|GEOMEAN|Geometric mean|GEOMEAN(B2:B9)
Statistics|HARMEAN|Harmonic mean|HARMEAN(B2:B9)
Statistics|TRIMMEAN|Mean without the extremes|TRIMMEAN(B2:B9, 0.2)
Statistics|SKEW|Skewness|SKEW(B2:B9)
Statistics|KURT|Kurtosis|KURT(B2:B9)
Statistics|CORREL|Correlation of two ranges|CORREL(B2:B9, C2:C9)
Statistics|RSQ|R-squared of a fit|RSQ(C2:C9, B2:B9)
Statistics|SLOPE|Slope of the trend line|SLOPE(C2:C9, B2:B9)
Statistics|INTERCEPT|Intercept of the trend line|INTERCEPT(C2:C9, B2:B9)
Statistics|FORECAST|Predict a value on the trend line|FORECAST(10, C2:C9, B2:B9)
Statistics|TREND|Values along a linear trend|TREND(C2:C9)
Statistics|GROWTH|Exponential trend (ranges) or % change (two numbers)|GROWTH(B9, B8)
Statistics|COVAR|Covariance|COVAR(B2:B9, C2:C9)
Statistics|STANDARDIZE|z-score|STANDARDIZE(B2, AVERAGE(B2:B9), STDEV(B2:B9))
Statistics|NORM.DIST|Normal distribution|NORM.DIST(x, mean, sd, TRUE)
Statistics|NORM.INV|Inverse normal|NORM.INV(0.95, mean, sd)
Statistics|NORM.S.DIST|Standard normal|NORM.S.DIST(1.96, TRUE)
Statistics|CONFIDENCE.NORM|Confidence interval half-width|CONFIDENCE.NORM(0.05, sd, n)
Statistics|BINOM.DIST|Binomial distribution|BINOM.DIST(3, 10, 0.5, FALSE)
Statistics|POISSON.DIST|Poisson distribution|POISSON.DIST(2, 3, TRUE)
Statistics|FREQUENCY|Counts per bin|FREQUENCY(B2:B99, E2:E5)
Logic|IF|IF(test, then, else)|IF(B2>100, "High", "Low")
Logic|IFS|First true test wins|IFS(A1>90, "A", A1>80, "B", TRUE, "C")
Logic|IFERROR|Fallback when a formula errors|IFERROR(B2/C2, 0)
Logic|IFNA|Fallback when a lookup finds nothing|IFNA(VLOOKUP(…), "Missing")
Logic|SWITCH|Match a value against cases|SWITCH(A1, 1, "One", 2, "Two", "Other")
Logic|CHOOSE|Pick the n-th option|CHOOSE(2, "a", "b", "c")
Logic|AND|True if all are true|AND(A1>0, B1>0)
Logic|OR|True if any is true|OR(A1>0, B1>0)
Logic|NOT|Flip true/false|NOT(A1)
Logic|XOR|True if an odd number are true|XOR(A1, B1)
Logic|LET|Name parts of a formula|LET(x, A1*2, x + x)
Info|ISBLANK|Is the cell empty?|ISBLANK(A1)
Info|ISNUMBER|Is it a number?|ISNUMBER(A1)
Info|ISTEXT|Is it text?|ISTEXT(A1)
Info|ISERROR|Is it any error?|ISERROR(A1)
Info|ISNA|Is it #N/A?|ISNA(A1)
Info|ISLOGICAL|Is it TRUE/FALSE?|ISLOGICAL(A1)
Info|ISEVEN|Is it even?|ISEVEN(A1)
Info|ISODD|Is it odd?|ISODD(A1)
Info|ISFORMULA|Does the cell hold a formula?|ISFORMULA(A1)
Info|FORMULATEXT|The formula in a cell, as text|FORMULATEXT(A1)
Info|N|Value as a number|N(A1)
Info|TYPE|Type of a value|TYPE(A1)
Info|NA|The #N/A error|NA()
Lookup|XLOOKUP|Find a key in one range, return from another|XLOOKUP(key, A2:A9, C2:C9, "None")
Lookup|VLOOKUP|Find in first column, return column n|VLOOKUP(key, A2:D9, 3, FALSE)
Lookup|HLOOKUP|Find in first row, return row n|HLOOKUP(key, A1:H4, 2, FALSE)
Lookup|LOOKUP|Approximate lookup in a sorted list|LOOKUP(85, A2:A9, B2:B9)
Lookup|INDEX|Value at a row/column of a range|INDEX(A2:D9, 3, 2)
Lookup|MATCH|Position of a value in a list|MATCH("West", A2:A9, 0)
Lookup|XMATCH|Position of a value (modern)|XMATCH("West", A2:A9)
Lookup|OFFSET|Range shifted from a starting cell|SUM(OFFSET(B1, 1, 0, 12))
Lookup|INDIRECT|Reference from text|INDIRECT("B" & E1)
Lookup|ADDRESS|Cell address as text|ADDRESS(2, 3)
Lookup|ROW|Row number|ROW()
Lookup|COLUMN|Column number|COLUMN()
Lookup|ROWS|Rows in a range|ROWS(A2:A9)
Lookup|COLUMNS|Columns in a range|COLUMNS(A1:F1)
Lookup|HYPERLINK|Link label|HYPERLINK("https://…", "Open")
Arrays|FILTER|Rows that meet a condition (spills)|FILTER(A2:C99, B2:B99>100)
Arrays|SORT|Sorted copy of a range (spills)|SORT(A2:C99, 2, -1)
Arrays|SORTBY|Sort by another range (spills)|SORTBY(A2:A99, B2:B99, -1)
Arrays|UNIQUE|Distinct values (spills)|UNIQUE(A2:A99)
Arrays|SEQUENCE|List of numbers (spills)|SEQUENCE(12)
Arrays|TRANSPOSE|Swap rows and columns (spills)|TRANSPOSE(A1:D2)
Arrays|TAKE|First or last rows/columns|TAKE(SORT(A2:B99, 2, -1), 5)
Arrays|DROP|Skip rows/columns|DROP(A1:C99, 1)
Arrays|CHOOSECOLS|Pick columns|CHOOSECOLS(A2:F99, 1, 4)
Arrays|CHOOSEROWS|Pick rows|CHOOSEROWS(A2:F99, 1, -1)
Arrays|VSTACK|Stack ranges vertically|VSTACK(A2:B5, D2:E5)
Arrays|HSTACK|Join ranges side by side|HSTACK(A2:A9, C2:C9)
Arrays|TOCOL|Range into one column|TOCOL(A1:C3)
Arrays|TEXTSPLIT|Split text into cells|TEXTSPLIT(A1, ",")
Text|CONCAT|Join text|CONCAT(A1, " ", B1)
Text|TEXTJOIN|Join with a separator|TEXTJOIN(", ", TRUE, A2:A9)
Text|LEFT|First n characters|LEFT(A1, 3)
Text|RIGHT|Last n characters|RIGHT(A1, 3)
Text|MID|Characters from the middle|MID(A1, 2, 4)
Text|LEN|Length of text|LEN(A1)
Text|FIND|Position of text (case-sensitive)|FIND("-", A1)
Text|SEARCH|Position of text (wildcards ok)|SEARCH("fiber", A1)
Text|SUBSTITUTE|Replace text|SUBSTITUTE(A1, "old", "new")
Text|REPLACE|Replace by position|REPLACE(A1, 1, 3, "New")
Text|UPPER|UPPER CASE|UPPER(A1)
Text|LOWER|lower case|LOWER(A1)
Text|PROPER|Title Case|PROPER(A1)
Text|TRIM|Remove extra spaces|TRIM(A1)
Text|CLEAN|Remove non-printing characters|CLEAN(A1)
Text|TEXT|Format a number or date as text|TEXT(A1, "$#,##0.00")
Text|TEXTBEFORE|Text before a delimiter|TEXTBEFORE(A1, "@")
Text|TEXTAFTER|Text after a delimiter|TEXTAFTER(A1, "@")
Text|VALUE|Text to number|VALUE(A1)
Text|NUMBERVALUE|Text to number with custom separators|NUMBERVALUE("1.234,5", ",", ".")
Text|FIXED|Number to text with fixed decimals|FIXED(A1, 2)
Text|DOLLAR|Number to currency text|DOLLAR(A1)
Text|REPT|Repeat text|REPT("★", 4)
Text|EXACT|Exact text match?|EXACT(A1, B1)
Text|CHAR|Character from code|CHAR(65)
Text|CODE|Code of the first character|CODE("A")
Text|REGEXTEST|Does text match a pattern?|REGEXTEST(A1, "^\\d+$")
Text|REGEXEXTRACT|Pull out the part that matches|REGEXEXTRACT(A1, "\\d+")
Text|REGEXREPLACE|Replace by pattern|REGEXREPLACE(A1, "\\s+", " ")
Date|TODAY|Today's date|TODAY()
Date|NOW|Current date and time|NOW()
Date|DATE|Build a date|DATE(2026, 10, 8)
Date|DATEVALUE|Text to a date serial|DATEVALUE("2026-10-08")
Date|TIME|Build a time|TIME(9, 30, 0)
Date|YEAR|Year of a date|YEAR(A1)
Date|MONTH|Month of a date|MONTH(A1)
Date|DAY|Day of a date|DAY(A1)
Date|HOUR|Hour of a time|HOUR(A1)
Date|MINUTE|Minute of a time|MINUTE(A1)
Date|WEEKDAY|Day of week (1 = Sunday)|WEEKDAY(A1)
Date|WEEKNUM|Week of the year|WEEKNUM(A1)
Date|ISOWEEKNUM|ISO week of the year|ISOWEEKNUM(A1)
Date|DAYS|Days between dates|DAYS(B1, A1)
Date|DATEDIF|Difference in "D", "M", "Y", "YM", "MD"|DATEDIF(A1, B1, "M")
Date|EDATE|Date n months away|EDATE(A1, 3)
Date|EOMONTH|Month-end n months away|EOMONTH(A1, 0)
Date|WORKDAY|Date n working days away|WORKDAY(A1, 10)
Date|NETWORKDAYS|Working days between dates|NETWORKDAYS(A1, B1)
Date|YEARFRAC|Fraction of a year between dates|YEARFRAC(A1, B1)
Date|DAYS360|Days on a 360-day calendar|DAYS360(A1, B1)
Finance|PMT|Loan payment|PMT(5%/12, 36, 20000)
Finance|IPMT|Interest part of a payment|IPMT(5%/12, 1, 36, 20000)
Finance|PPMT|Principal part of a payment|PPMT(5%/12, 1, 36, 20000)
Finance|FV|Future value|FV(5%/12, 60, -200)
Finance|PV|Present value|PV(5%/12, 60, -200)
Finance|NPER|Number of payment periods|NPER(5%/12, -400, 20000)
Finance|RATE|Interest rate per period|RATE(36, -600, 20000)
Finance|NPV|Net present value|NPV(8%, B2:B9)
Finance|IRR|Internal rate of return|IRR(B2:B9)
Finance|XNPV|NPV with dates|XNPV(8%, B2:B9, A2:A9)
Finance|XIRR|IRR with dates|XIRR(B2:B9, A2:A9)
Finance|MIRR|Modified IRR|MIRR(B2:B9, 8%, 6%)
Finance|SLN|Straight-line depreciation|SLN(10000, 1000, 5)
Finance|DDB|Declining-balance depreciation|DDB(10000, 1000, 5, 1)
Finance|EFFECT|Effective annual rate|EFFECT(5%, 12)
Finance|CAGR|Compound growth rate (Datum)|CAGR(start, end, years)
Finance|PCTCHANGE|% change (Datum)|PCTCHANGE(B9, B8)
Finance|LAST|Last non-empty value (Datum)|LAST(B2:B99)
Finance|FIRST|First non-empty value (Datum)|FIRST(B2:B99)
`;
  HELP.trim().split('\n').forEach((line) => {
    const [cat, name, desc, ex] = line.split('|');
    F.FN_HELP[name] = ex ? `${desc} · ${ex}` : desc;
    (F.CATS[cat] ||= []).push(name);
  });
  F.CATS['More'] = F.functions.filter((f) => !F.FN_HELP[f]);
})();
