/* Slate — shared state, helpers, UI primitives and finance logic */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  const S = { store: null, catalog: [], catalogMeta: {}, overrides: {}, statements: [], paths: {} };

  /* ---------- dates ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => iso(new Date());
  const ym = (d) => (typeof d === 'string' ? d.slice(0, 7) : `${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const addMonths = (ymStr, n) => { const [y, m] = ymStr.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return ym(d); };
  const monthEnd = (ymStr) => { const [y, m] = ymStr.split('-').map(Number); return iso(new Date(y, m, 0)); };
  const monthStart = (ymStr) => `${ymStr}-01`;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MON = MONTHS.map(m => m.slice(0, 3));
  const monthLabel = (ymStr, short) => { const [y, m] = ymStr.split('-').map(Number); return `${(short ? MON : MONTHS)[m - 1]} ${y}`; };
  const dateLabel = (s, withYear) => { const d = parse(s); return `${MON[d.getMonth()]} ${d.getDate()}${withYear || d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : ''}`; };
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };

  /* ---------- money ---------- */
  const fmt = (n, { cents = false, sign = false, compact = false } = {}) => {
    if (n == null || isNaN(n)) return '—';
    const v = Math.abs(n);
    let s;
    if (compact && v >= 1e6) s = '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M';
    else if (compact && v >= 1e4) s = '$' + (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + 'k';
    else s = '$' + v.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
    return (n < 0 ? '−' : sign && n > 0 ? '+' : '') + s;
  };
  // big display number with small cents
  const bigMoney = (n) => {
    if (n == null || isNaN(n)) return '—';
    const neg = n < 0, v = Math.abs(n);
    const whole = Math.floor(v), c = Math.round((v - whole) * 100);
    return `${neg ? '−' : ''}$${whole.toLocaleString('en-US')}<span class="cents">.${pad(c === 100 ? 0 : c)}</span>`;
  };
  const num = (s) => { if (s === '' || s == null) return null; const v = Number(String(s).replace(/[$,\s]/g, '')); return isNaN(v) ? null : v; };

  /* ---------- accounts ---------- */
  const TYPES = {
    checking: { label: 'Checking', group: 'cash' }, savings: { label: 'Savings', group: 'cash' }, hysa: { label: 'High-yield savings', group: 'cash' },
    brokerage: { label: 'Brokerage', group: 'invest' }, crypto: { label: 'Crypto', group: 'invest' }, '529': { label: '529 plan', group: 'invest' },
    '401k': { label: '401(k)', group: 'retire' }, '403b': { label: '403(b)', group: 'retire' }, 'roth-ira': { label: 'Roth IRA', group: 'retire' },
    'trad-ira': { label: 'Traditional IRA', group: 'retire' }, 'rollover-ira': { label: 'Rollover IRA', group: 'retire' }, hsa: { label: 'HSA', group: 'retire' },
    credit: { label: 'Credit card', group: 'credit', liability: true }, loan: { label: 'Loan', group: 'loans', liability: true },
    'auto-loan': { label: 'Car loan', group: 'loans', liability: true }, 'student-loan': { label: 'Student loan', group: 'loans', liability: true },
    mortgage: { label: 'Mortgage', group: 'loans', liability: true }, other: { label: 'Other asset', group: 'other' }
  };
  const GROUPS = {
    cash: { label: 'Cash', color: 'var(--s1)' }, invest: { label: 'Investments', color: 'var(--s2)' }, retire: { label: 'Retirement', color: 'var(--s3)' },
    other: { label: 'Other assets', color: 'var(--muted)' }, credit: { label: 'Credit cards', color: 'var(--neg)' }, loans: { label: 'Loans', color: 'var(--neg)' }
  };
  const isLiability = (a) => !!TYPES[a.type]?.liability;
  const accounts = () => S.store.accounts;
  const account = (id) => S.store.accounts.find(a => a.id === id);
  const balances = (a) => (a.balances || []).slice().sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const balanceAt = (a, date) => { let v = null; for (const b of balances(a)) { if (b.date <= date) v = b.amount; else break; } return v; };
  const latest = (a) => { const b = balances(a); return b.length ? b[b.length - 1] : null; };
  const signed = (a, v) => (v == null ? null : isLiability(a) ? -Math.abs(v) : v);
  function netWorthAt(date) {
    let assets = 0, debts = 0, any = false;
    for (const a of accounts()) { const v = balanceAt(a, date); if (v == null) continue; any = true; if (isLiability(a)) debts += Math.abs(v); else assets += v; }
    return any ? { assets, debts, net: assets - debts } : null;
  }
  function byGroup(date) {
    const out = {};
    for (const a of accounts()) { const v = balanceAt(a, date); if (v == null) continue; const g = TYPES[a.type]?.group || 'other'; out[g] = (out[g] || 0) + Math.abs(v); }
    return out;
  }
  // Money saved into an account during a month: the user's own figure, else the change in balance
  function savedIn(a, month) {
    const p = S.store.plans[month]?.[a.id];
    if (p && p.actual != null) return { value: p.actual, auto: false };
    const end = balanceAt(a, monthEnd(month));
    const start = balanceAt(a, monthEnd(addMonths(month, -1)));
    const inMonth = balances(a).some(b => b.date >= monthStart(month) && b.date <= monthEnd(month));
    if (end == null || start == null || !inMonth) return { value: null, auto: true };
    return { value: Math.round((end - start) * 100) / 100, auto: true };
  }
  const plannerAccounts = () => accounts().filter(a => a.inPlanner ?? (!isLiability(a) && a.type !== 'checking'));

  /* ---------- card catalog ---------- */
  const allCards = () => [...S.catalog, ...S.store.customCards].map(c => ({ ...c, ...(S.store.cardEdits[c.id] || {}) }));
  const card = (id) => { const c = S.catalog.find(x => x.id === id) || S.store.customCards.find(x => x.id === id); return c ? { ...c, ...(S.store.cardEdits[c.id] || {}) } : null; };
  const cardImg = (c) => {
    if (!c) return '';
    if (S.overrides[c.id]) return 'file://' + S.overrides[c.id].split('?')[0] + '?v=' + (S.overrides[c.id].split('?v=')[1] || '');
    return c.image ? '../data/cards/' + c.image + '?v=' + encodeURIComponent(S.catalogMeta.imagesVersion || '1') : '';
  };
  const ccHTML = (c, w = 240, extra = '') => {
    const src = cardImg(c);
    return `<div class="cc ${extra}${c && S.overrides[c.id] ? ' custom' : ''}" style="--w:${w}px" data-card="${esc(c?.id || '')}">${src ? `<img src="${esc(src)}" alt="${esc((c.issuer || '') + ' ' + (c.name || ''))}" draggable="false">` : `<div class="cc-fallback"><small>${esc(c?.issuer || '')}</small><span>${esc(c?.name || 'Card')}</span></div>`}</div>`;
  };
  const CAT_LABEL = { dining: 'Dining', travel: 'Travel', groceries: 'Groceries', gas: 'Gas', shopping: 'Online shopping', streaming: 'Streaming', transit: 'Transit', base: 'Everything else', portal: 'Issuer travel portal', rotating: 'Rotating 5% categories', drugstore: 'Drugstores', amazon: 'Amazon & Whole Foods', entertainment: 'Entertainment', top: 'Top spending category', costco: 'Costco', choice: 'Category you choose', airline: 'Airline', hotel: 'Hotel brand', phone: 'Phone plans', apple: 'Apple', applepay: 'Apple Pay' };
  const rateStr = (r) => (r.unit === '%' ? `${r.rate}%` : `${r.rate}x`);
  const rateFor = (c, cat) => { const r = (c.rewards || []).find(x => x.cat === cat); const b = (c.rewards || []).find(x => x.cat === 'base'); return r || b || null; };
  const PER_YEAR = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1, every4years: 0.25 };
  const PERIOD_LABEL = { monthly: 'every month', quarterly: 'every quarter', semiannual: 'twice a year', annual: 'once a year', every4years: 'every 4 years' };
  const creditYearValue = (c) => (c.credits || []).reduce((s, x) => s + x.amount * (PER_YEAR[x.period] || 0), 0);

  /* ---------- wallet: fees & credits ---------- */
  const wallet = () => S.store.wallet;
  // the day the annual fee posts in a given year
  function feeDate(w, year) {
    const opened = w.opened ? parse(w.opened) : null;
    const m = w.feeMonth || (opened ? opened.getMonth() + 1 : 1);
    const d = Math.min(opened ? opened.getDate() : 1, 28);
    return `${year}-${pad(m)}-${pad(d)}`;
  }
  function feeOn(w, date) {
    const c = card(w.cardId);
    if (!c) return 0;
    if (w.feeOverride != null) return w.feeOverride;
    const firstYear = w.opened && daysBetween(w.opened, date) < 300; // the fee charged at opening
    if (firstYear && c.firstYearFee === 0) return 0;
    return c.annualFee ?? c.fee ?? 0;
  }
  // card year: from the most recent fee date on/before `date` to the next one
  function cardYear(w, date = today()) {
    const y = Number(date.slice(0, 4));
    let start = feeDate(w, y);
    if (start > date) start = feeDate(w, y - 1);
    if (w.opened && start < w.opened) start = w.opened;
    const end = addDays(feeDate(w, Number(start.slice(0, 4)) + 1), -1);
    return { start, end };
  }
  function periodOf(credit, w, date = today()) {
    const d = parse(date), y = d.getFullYear(), m = d.getMonth() + 1;
    if (credit.period === 'monthly') { const k = `${y}-${pad(m)}`; return { key: k, start: monthStart(k), end: monthEnd(k) }; }
    if (credit.period === 'quarterly') { const q = Math.ceil(m / 3); return { key: `${y}-Q${q}`, start: `${y}-${pad(q * 3 - 2)}-01`, end: monthEnd(`${y}-${pad(q * 3)}`) }; }
    if (credit.period === 'semiannual') { const h = m <= 6 ? 1 : 2; return { key: `${y}-H${h}`, start: h === 1 ? `${y}-01-01` : `${y}-07-01`, end: h === 1 ? `${y}-06-30` : `${y}-12-31` }; }
    if (credit.period === 'annual') {
      if (credit.resets === 'cardmember' && w) { const cy = cardYear(w, date); return { key: 'CY' + cy.start, start: cy.start, end: cy.end }; }
      return { key: String(y), start: `${y}-01-01`, end: `${y}-12-31` };
    }
    if (credit.period === 'every4years') {
      const base = w?.opened ? Number(w.opened.slice(0, 4)) : y;
      const s = base + Math.floor((y - base) / 4) * 4;
      return { key: `${s}-4Y`, start: `${s}-01-01`, end: `${s + 3}-12-31` };
    }
    return { key: String(y), start: `${y}-01-01`, end: `${y}-12-31` };
  }
  const used = (w, creditId, key) => (w.usage || []).filter(u => u.creditId === creditId && u.period === key).reduce((s, u) => s + u.amount, 0);
  function capturedIn(w, start, end) { return (w.usage || []).filter(u => u.date >= start && u.date <= end).reduce((s, u) => s + u.amount, 0); }

  /* ---------- calendar events ---------- */
  function eventsBetween(start, end) {
    const out = [];
    const lead = S.store.settings.renewalLeadDays ?? 45;
    const y0 = Number(start.slice(0, 4)), y1 = Number(end.slice(0, 4));
    for (const w of wallet()) {
      const c = card(w.cardId);
      if (!c) continue;
      const nm = w.nickname || `${c.issuer === 'American Express' ? 'Amex' : c.issuer} ${c.name}`;
      // no open date and no fee month yet → we don't know when the fee posts, so don't guess
      for (let y = y0 - 1; y <= y1 + 1 && (w.opened || w.feeMonth); y++) {
        const fd = feeDate(w, y);
        if (w.opened && fd < w.opened) continue;
        const fee = feeOn(w, fd);
        if (fee > 0 && fd >= start && fd <= end) out.push({ date: fd, kind: 'fee', title: `${nm} annual fee`, amount: fee, walletId: w.id });
        const rd = addDays(fd, -lead);
        if (fee > 0 && rd >= start && rd <= end && (!w.opened || rd > w.opened)) out.push({ date: rd, kind: 'renew', title: `Decide on ${nm}`, sub: `${fmt(fee)} fee posts ${dateLabel(fd)}`, walletId: w.id });
      }
      // credits that reset — shown on the last day of each period, only if money is still on the table
      for (const cr of c.credits || []) {
        if (cr.period === 'every4years') continue;
        let cursor = start;
        const seen = new Set();
        while (cursor <= end) {
          const p = periodOf(cr, w, cursor);
          if (!seen.has(p.key)) {
            seen.add(p.key);
            const left = cr.amount - used(w, cr.id, p.key);
            if (p.end >= start && p.end <= end && left > 0.009 && (!w.opened || p.end >= w.opened)) out.push({ date: p.end, kind: 'credit', title: `${cr.name}`, sub: `${nm} · ${fmt(left, { cents: left % 1 !== 0 })} left`, amount: left, walletId: w.id, creditId: cr.id, period: p.key });
          }
          cursor = addDays(p.end, 1);
        }
      }
    }
    // statement reminders per account
    for (const a of accounts()) {
      if (!a.statementDay) continue;
      let m = ym(start);
      while (monthStart(m) <= end) {
        const d = `${m}-${pad(Math.min(a.statementDay, Number(monthEnd(m).slice(8))))}`;
        if (d >= start && d <= end) out.push({ date: d, kind: 'stmt', title: `${a.name} statement`, sub: a.institution, accountId: a.id });
        m = addMonths(m, 1);
      }
    }
    // payment due dates recorded for cards and loans (a.card.dueDate)
    for (const a of accounts()) {
      const d = a.card?.dueDate;
      if (d && d >= start && d <= end) out.push({ date: d, kind: 'due', title: `${a.name} payment due`, sub: a.card.minimumPayment ? `Minimum ${fmt(a.card.minimumPayment, { cents: a.card.minimumPayment % 1 !== 0 })}${a.card.lastStatementBalance ? ' · statement ' + fmt(a.card.lastStatementBalance) : ''}` : a.institution, amount: a.card.lastStatementBalance || null, accountId: a.id });
    }
    for (const e of S.store.events || []) {
      if (!e.date) continue;
      if (e.repeat === 'monthly') {
        let m = ym(start);
        while (monthStart(m) <= end) {
          const d = `${m}-${pad(Math.min(Number(e.date.slice(8)), Number(monthEnd(m).slice(8))))}`;
          if (d >= start && d <= end && d >= e.date) out.push({ ...e, date: d, kind: 'custom', eventId: e.id });
          m = addMonths(m, 1);
        }
      } else if (e.repeat === 'yearly') {
        for (let y = y0; y <= y1; y++) { const d = `${y}${e.date.slice(4)}`; if (d >= start && d <= end && d >= e.date) out.push({ ...e, date: d, kind: 'custom', eventId: e.id }); }
      } else if (e.date >= start && e.date <= end) out.push({ ...e, kind: 'custom', eventId: e.id });
    }
    const order = { fee: 0, due: 1, renew: 2, stmt: 3, custom: 4, credit: 5 };
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : order[a.kind] - order[b.kind]));
  }

  /* ---------- credit scores ---------- */
  const BUREAUS = [
    { id: 'equifax', label: 'Equifax', color: 'var(--s1)' },
    { id: 'experian', label: 'Experian', color: 'var(--s2)' },
    { id: 'transunion', label: 'TransUnion', color: 'var(--s3)' }
  ];
  const MODELS = ['FICO 8', 'FICO 9', 'FICO 10T', 'VantageScore 3.0', 'VantageScore 4.0', 'Other'];
  const scoresFor = (bureau, model) => S.store.scores.filter(s => s.bureau === bureau && (!model || s.model === model)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const latestScore = (bureau, model) => { const l = scoresFor(bureau, model); return l[l.length - 1] || null; };
  const scoreBand = (n) => (n >= 800 ? 'Exceptional' : n >= 740 ? 'Very good' : n >= 670 ? 'Good' : n >= 580 ? 'Fair' : 'Poor');
  function myScore() {
    const vals = BUREAUS.map(b => latestScore(b.id)).filter(Boolean).map(s => s.score);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }

  /* ---------- persistence ---------- */
  let saveT = {};
  function save(...keys) {
    for (const k of keys) {
      clearTimeout(saveT[k]);
      saveT[k] = setTimeout(() => slate.save({ [k]: S.store[k] }), 120);
    }
  }

  /* ---------- UI primitives ---------- */
  function toast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind === 'error' ? ' error' : '');
    t.textContent = msg;
    $('#toastRoot').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, kind === 'error' ? 5200 : 3200);
  }
  function modal({ title, sub = '', body = '', wide = false, actions = [{ label: 'Close' }], onMount, left = '' }) {
    const root = $('#modalRoot');
    root.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2>${sub ? `<p>${sub}</p>` : ''}</div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">${left ? `<div class="left">${left}</div>` : ''}${actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-a="${i}">${esc(a.label)}</button>`).join('')}</div></div>`;
    root.classList.add('on');
    const m = $('.modal', root);
    const close = () => { root.classList.remove('on'); root.innerHTML = ''; document.removeEventListener('keydown', key); };
    const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && e.target.tagName === 'INPUT' && actions.length) { const p = actions.findIndex(a => /primary/.test(a.cls || '')); if (p >= 0) { e.preventDefault(); $(`[data-a="${p}"]`, m).click(); } } };
    document.addEventListener('keydown', key);
    root.onmousedown = (e) => { if (e.target === root) close(); };
    actions.forEach((a, i) => $(`[data-a="${i}"]`, m).onclick = async () => { if (a.onClick) { try { const r = await a.onClick(m); if (r === false) return; } catch (err) { toast(err.message || String(err), 'error'); return; } } close(); });
    onMount?.(m, close);
    setTimeout(() => $('input:not([type=checkbox]):not([type=hidden]), select, textarea', m)?.focus(), 30);
    return { el: m, close };
  }
  const confirmBox = (title, sub, label = 'Delete', cls = 'danger') => new Promise(res => modal({ title, sub, actions: [{ label: 'Cancel', onClick: () => res(false) }, { label, cls: 'primary ' + cls, onClick: () => res(true) }] }));
  function menu(x, y, items) {
    const root = $('#menuRoot');
    root.innerHTML = `<div class="menu">${items.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon ? ic(it.icon, 15) : ''}<span>${esc(it.label)}</span></button>`).join('')}</div>`;
    root.classList.add('on');
    const m = $('.menu', root);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
    const close = () => { root.classList.remove('on'); root.innerHTML = ''; };
    root.onmousedown = (e) => { if (e.target === root) close(); };
    $$('[data-i]', m).forEach(b => b.onclick = () => { close(); items[b.dataset.i].onClick?.(); });
  }
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const accountOptions = (sel, filter = () => true, none = 'No account') => `<option value="">${esc(none)}</option>` + accounts().filter(filter).map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}${a.institution ? ' · ' + esc(a.institution) : ''}</option>`).join('');

  /* ---------- charts (hand-drawn SVG, hover on every chart) ---------- */
  function niceTicks(min, max, n = 4) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => span / s <= n) || 10 * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const t = []; for (let v = lo; v <= hi + step / 2; v += step) t.push(Math.round(v * 1e6) / 1e6);
    return t;
  }
  // series: [{ name, color, points: [{ x: 'YYYY-MM-DD', y }] }]
  function lineChart(el, { series, height = 230, yFmt = (v) => String(v), yMin, yMax, xFmt = (d) => dateLabel(d) }) {
    const W = Math.max(el.clientWidth || 600, 300), H = height, L = 46, R = 14, T = 12, B = 26;
    const pts = series.flatMap(s => s.points);
    if (!pts.length) { el.innerHTML = '<div class="muted small" style="padding:30px 0">Nothing to chart yet.</div>'; return; }
    const xs = pts.map(p => parse(p.x).getTime());
    let x0 = Math.min(...xs), x1 = Math.max(...xs);
    if (x0 === x1) { x0 -= 15 * 864e5; x1 += 15 * 864e5; }
    const ys = pts.map(p => p.y);
    const ticks = niceTicks(yMin ?? Math.min(...ys), yMax ?? Math.max(...ys));
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const X = (t) => L + (t - x0) / (x1 - x0) * (W - L - R);
    const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    // x ticks: up to 6 month boundaries
    const xt = [];
    const d0 = new Date(x0); let mcur = ym(d0);
    const months = Math.max(1, Math.round((x1 - x0) / (30.4 * 864e5)));
    const every = Math.max(1, Math.ceil(months / 6));
    for (let i = 0; i <= months + 1; i += every) { const k = addMonths(mcur, i); const t = parse(monthStart(k)).getTime(); if (t >= x0 && t <= x1) xt.push(t); }
    if (!xt.length) xt.push(x0, x1);
    const path = (s) => s.points.map((p, i) => `${i ? 'L' : 'M'}${X(parse(p.x).getTime()).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    el.innerHTML = `<div class="chart"><svg height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart">
      <g class="axis">${ticks.map(v => `<line class="gridline" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${esc(yFmt(v))}</text>`).join('')}
      ${xt.map(t => `<text x="${X(t)}" y="${H - 6}" text-anchor="middle">${esc(MON[new Date(t).getMonth()] + (new Date(t).getMonth() === 0 || months > 14 ? " ’" + String(new Date(t).getFullYear()).slice(2) : ''))}</text>`).join('')}</g>
      ${series.map(s => `<path d="${path(s)}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${s.points.map(p => `<circle cx="${X(parse(p.x).getTime())}" cy="${Y(p.y)}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`).join('')}`).join('')}
      <line class="xhair" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--line-strong)" stroke-dasharray="3 3" visibility="hidden"/>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" class="hit"/></svg><div class="tip" hidden></div></div>`;
    const svg = $('svg', el), tip = $('.tip', el), xh = $('.xhair', el);
    const all = [...new Set(pts.map(p => p.x))].sort();
    $('.hit', el).onmousemove = (e) => {
      const r = svg.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (W / r.width);
      let best = all[0], bd = Infinity;
      for (const d of all) { const dd = Math.abs(X(parse(d).getTime()) - mx); if (dd < bd) { bd = dd; best = d; } }
      const px = X(parse(best).getTime());
      xh.setAttribute('x1', px); xh.setAttribute('x2', px); xh.setAttribute('visibility', 'visible');
      const rows = series.map(s => { const p = s.points.find(q => q.x === best); return p ? `<div class="tr"><i style="--c:${s.color}"></i>${esc(s.name)} <b>${esc(yFmt(p.y))}</b>${p.note ? ` <span style="opacity:.7">${esc(p.note)}</span>` : ''}</div>` : ''; }).join('');
      tip.innerHTML = `<div style="opacity:.7;margin-bottom:3px">${esc(xFmt(best))}</div>${rows}`;
      tip.hidden = false;
      const topY = Math.min(...series.map(s => s.points.find(q => q.x === best)).filter(Boolean).map(p => Y(p.y)));
      tip.style.left = (px / W * r.width) + 'px'; tip.style.top = (topY / H * r.height) + 'px';
    };
    $('.hit', el).onmouseleave = () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); };
  }

  // Planned (outline) vs saved (filled) per month
  function planChart(el, { months, planned, actual, height = 210 }) {
    const W = Math.max(el.clientWidth || 600, 300), H = height, L = 50, R = 8, T = 10, B = 26;
    const max = Math.max(1, ...planned.map(v => v || 0), ...actual.map(v => v || 0));
    const minV = Math.min(0, ...actual.map(v => v || 0));
    const ticks = niceTicks(minV, max);
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const slot = (W - L - R) / months.length, bw = Math.min(18, slot / 3.2);
    el.innerHTML = `<div class="chart"><svg height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Planned versus saved by month">
      <g class="axis">${ticks.map(v => `<line class="gridline" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${esc(fmt(v, { compact: true }))}</text>`).join('')}
      ${months.map((m, i) => `<text x="${L + slot * i + slot / 2}" y="${H - 6}" text-anchor="middle">${MON[Number(m.slice(5)) - 1]}</text>`).join('')}</g>
      <line class="baseline" x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}"/>
      ${months.map((m, i) => {
        const cx = L + slot * i + slot / 2, p = planned[i], a = actual[i];
        const bar = (v, x, filled) => { if (v == null || v === 0) return ''; const y1 = Y(Math.max(v, 0)), y2 = Y(Math.min(v, 0)); const h = Math.max(1.5, y2 - y1);
          return filled ? `<rect x="${x}" y="${y1}" width="${bw}" height="${h}" rx="3" fill="${v < 0 ? 'var(--neg)' : 'var(--s3)'}"/>` : `<rect x="${x + .75}" y="${y1 + .75}" width="${bw - 1.5}" height="${Math.max(0, h - 1.5)}" rx="3" fill="none" stroke="var(--text-2)" stroke-width="1.5"/>`; };
        return `<g>${bar(p, cx - bw - 1, false)}${bar(a, cx + 1, true)}<rect x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent" data-i="${i}" class="hit"/></g>`;
      }).join('')}</svg><div class="tip" hidden></div></div>`;
    const svg = $('svg', el), tip = $('.tip', el);
    $$('.hit', el).forEach(h => {
      h.onmouseenter = () => {
        const i = +h.dataset.i, r = svg.getBoundingClientRect();
        tip.innerHTML = `<div style="opacity:.7;margin-bottom:3px">${monthLabel(months[i])}</div><div class="tr"><i style="--c:var(--text-2)"></i>Planned <b>${fmt(planned[i])}</b></div><div class="tr"><i style="--c:var(--s3)"></i>Saved <b>${actual[i] == null ? '—' : fmt(actual[i])}</b></div>`;
        tip.hidden = false;
        tip.style.left = ((L + slot * i + slot / 2) / W * r.width) + 'px';
        tip.style.top = (Y(Math.max(planned[i] || 0, actual[i] || 0)) / H * r.height) + 'px';
      };
      h.onmouseleave = () => { tip.hidden = true; };
    });
  }

  function sparkline(values, { w = 110, h = 30, color = 'var(--text-2)' } = {}) {
    const v = values.filter(x => x != null);
    if (v.length < 2) return '';
    const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
    const p = v.map((y, i) => `${(i / (v.length - 1) * (w - 4) + 2).toFixed(1)},${(h - 3 - (y - min) / span * (h - 6)).toFixed(1)}`).join(' ');
    const last = p.split(' ').pop().split(',');
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${p}" fill="none" stroke="${color}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="${color}"/></svg>`;
  }

  window.Slate = {
    S, $, $$, esc, uid, save, toast, modal, confirm: confirmBox, menu, opts, accountOptions,
    pad, iso, today, ym, parse, addMonths, monthEnd, monthStart, monthLabel, dateLabel, daysBetween, addDays, MONTHS, MON,
    fmt, bigMoney, num,
    TYPES, GROUPS, isLiability, accounts, account, balances, balanceAt, latest, signed, netWorthAt, byGroup, savedIn, plannerAccounts,
    allCards, card, cardImg, ccHTML, CAT_LABEL, rateStr, rateFor, PER_YEAR, PERIOD_LABEL, creditYearValue,
    wallet, feeDate, feeOn, cardYear, periodOf, used, capturedIn, eventsBetween,
    BUREAUS, MODELS, scoresFor, latestScore, scoreBand, myScore,
    lineChart, planChart, sparkline,
    views: {}
  };
})();
