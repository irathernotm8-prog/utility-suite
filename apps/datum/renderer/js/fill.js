// Datum - fill handle series: what comes next when you drag a selection down or across.
// Works like Excel: numbers and dates continue their step, "Week 1" becomes "Week 2", Jan becomes Feb,
// and anything else repeats. Formulas are handled by the grid (their references shift instead).
(function () {
  const FL = (D.fill = {});
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const mod = (a, n) => ((a % n) + n) % n;
  const NUM = /^\s*-?(\d+(\.\d+)?|\.\d+)\s*$/;
  const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
  const TAIL = /^(.*?)(\d+)(\D*)$/;

  const isoOf = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const dateOf = (s) => { const m = ISO.exec(s); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
  const clean = (x) => { const r = Math.round(x * 1e10) / 1e10; return String(Object.is(r, -0) ? 0 : r); };

  // a word from a list (month or weekday, full or 3-letter), keeping its capitalisation
  function listWord(s) {
    const t = String(s).trim(), low = t.toLowerCase();
    for (const list of [MONTHS, DAYS]) {
      let i = list.indexOf(low), short = false;
      if (i < 0 && low.length >= 3) { i = list.findIndex((w) => w.slice(0, 3) === low.replace(/\.$/, '')); short = i >= 0; }
      if (i >= 0) {
        const cas = t === t.toUpperCase() ? 'up' : t[0] === t[0].toUpperCase() ? 'cap' : 'low';
        return { list, i, short, cas, dot: /\.$/.test(t) };
      }
    }
    return null;
  }
  const wordOut = (w, i) => {
    let x = w.list[mod(i, w.list.length)];
    if (w.short) x = x.slice(0, 3) + (w.dot ? '.' : '');
    return w.cas === 'up' ? x.toUpperCase() : w.cas === 'cap' ? x[0].toUpperCase() + x.slice(1) : x;
  };

  // returns next(k): the value at position k, where 0 is the first source cell (k < 0 goes up/left)
  FL.series = (src, opt = {}) => {
    const n = src.length;
    const repeat = (k) => src[mod(k, n)];
    if (opt.copy || !n || src.some((v) => v === '' || v == null)) return repeat;

    // numbers: one number repeats (like Excel); two or more continue the trend
    if (src.every((v) => NUM.test(String(v)))) {
      if (n === 1) return repeat;
      const ys = src.map(Number), xs = ys.map((_, i) => i);
      const mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
      let num = 0, den = 0;
      xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
      const b = den ? num / den : 0, a = my - b * mx;
      return (k) => clean(a + b * k);
    }

    // dates: one date counts up by day; two or more keep their step (days, months or years)
    const ds = src.map((v) => dateOf(String(v)));
    if (ds.every(Boolean)) {
      if (n === 1) return (k) => isoOf(new Date(ds[0].getTime() + k * 86400000));
      const sameDay = ds.every((d) => d.getUTCDate() === ds[0].getUTCDate());
      const months = ds.map((d) => d.getUTCFullYear() * 12 + d.getUTCMonth());
      const mStep = months[1] - months[0];
      if (sameDay && mStep && months.every((m, i) => m - months[0] === i * mStep)) {
        return (k) => { const m = months[0] + k * mStep; const y = Math.floor(m / 12), mo = mod(m, 12); const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate(); return isoOf(new Date(Date.UTC(y, mo, Math.min(ds[0].getUTCDate(), last)))); };
      }
      const dStep = (ds[n - 1] - ds[0]) / 86400000 / (n - 1);
      if (Number.isInteger(dStep) && ds.every((d, i) => (d - ds[0]) / 86400000 === i * dStep)) return (k) => isoOf(new Date(ds[0].getTime() + k * dStep * 86400000));
      return repeat;
    }

    // months and weekdays
    const ws = src.map(listWord);
    if (ws.every(Boolean) && ws.every((w) => w.list === ws[0].list)) {
      const step = n === 1 ? 1 : mod(ws[1].i - ws[0].i, ws[0].list.length) || 1;
      if (ws.every((w, i) => mod(w.i - ws[0].i, w.list.length) === mod(i * step, w.list.length))) return (k) => wordOut(ws[0], ws[0].i + k * step);
      return repeat;
    }

    // quarters cycle Q1..Q4
    if (src.every((v) => /^q[1-4]$/i.test(String(v).trim()))) {
      const q = src.map((v) => +String(v).trim()[1] - 1), up = String(src[0]).trim()[0];
      const step = n === 1 ? 1 : mod(q[1] - q[0], 4) || 1;
      return (k) => up + (mod(q[0] + k * step, 4) + 1);
    }

    // text ending in a number: "Week 1" -> "Week 2", "Store 007" -> "Store 008"
    const ts = src.map((v) => TAIL.exec(String(v)));
    if (ts.every(Boolean) && ts.every((m) => m[1] === ts[0][1] && m[3] === ts[0][3])) {
      const nums = ts.map((m) => +m[2]);
      const step = n === 1 ? 1 : (nums[n - 1] - nums[0]) / (n - 1);
      if (Number.isInteger(step) && nums.every((x, i) => x === nums[0] + i * step)) {
        const width = ts[0][2].length, pad = ts[0][2][0] === '0' && width > 1;
        return (k) => { const x = nums[0] + k * step; const t = String(Math.abs(x)); return ts[0][1] + (x < 0 ? '-' : '') + (pad ? t.padStart(width, '0') : t) + ts[0][3]; };
      }
    }
    return repeat;
  };
})();
