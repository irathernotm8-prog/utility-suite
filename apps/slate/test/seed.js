// node test/seed.js <userDataDir> <statementsDir> — writes made-up sample data for screenshots/testing (no real people or accounts)
const fs = require('fs');
const path = require('path');
const [dir, stmtDir] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(path.join(stmtDir, 'Inbox'), { recursive: true });
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const monthsBack = (n, day = 28) => { const d = new Date(now.getFullYear(), now.getMonth() - n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))}`; };
const series = (start, step, wobble, n = 12, day = 28) => Array.from({ length: n }, (_, i) => ({ date: monthsBack(n - 1 - i, i === n - 1 ? Math.min(day, now.getDate()) : day), amount: Math.round((start + step * i + Math.sin(i * 1.7) * wobble) * 100) / 100, source: 'manual' }));
const acc = (id, name, institution, type, balances, extra = {}) => ({ id, name, institution, type, balances, ...extra });
const accounts = [
  acc('chk', 'Total Checking', 'Chase', 'checking', series(3200, 60, 700), { last4: '1234', loginUrl: 'https://www.chase.com', statementDay: 3 }),
  acc('hysa', 'High-yield savings', 'Ally', 'hysa', series(8200, 520, 40), { loginUrl: 'https://www.ally.com', inPlanner: true }),
  acc('k401', 'Employer 401(k)', 'Fidelity', '401k', series(21400, 880, 900), { loginUrl: 'https://www.fidelity.com', inPlanner: true }),
  acc('roth', 'Roth IRA', 'Fidelity', 'roth-ira', series(9600, 560, 380), { inPlanner: true }),
  acc('brk', 'Brokerage', 'Robinhood', 'brokerage', series(4100, 150, 300), { inPlanner: true }),
  acc('csp', 'Sapphire Preferred', 'Chase', 'credit', series(1400, 20, 500), { last4: '3333', inPlanner: false }),
  acc('gold', 'Amex Gold', 'American Express', 'credit', series(900, 10, 350), { inPlanner: false })
];
const thisM = monthsBack(0).slice(0, 7), lastM = monthsBack(1).slice(0, 7);
const plans = {};
for (let i = 0; i < 10; i++) { const m = monthsBack(i).slice(0, 7); plans[m] = { hysa: { planned: 500 }, k401: { planned: 650 }, roth: { planned: 583 }, brk: { planned: 150 } }; }
plans[thisM].roth.actual = 583;
const yr = now.getFullYear();
const wallet = [
  { id: 'w1', cardId: 'chase-sapphire-preferred', accountId: 'csp', opened: `${yr - 2}-05-12`, feeMonth: 5, usage: [{ creditId: 'hotel', period: 'CY' + `${yr - 1}-05-12`, amount: 50, date: `${yr}-03-14` }] },
  { id: 'w2', cardId: 'amex-gold', accountId: 'gold', opened: `${yr - 1}-03-15`, usage: [
    { creditId: 'uber', period: thisM, amount: 10, date: monthsBack(0, 5) }, { creditId: 'dining', period: lastM, amount: 10, date: monthsBack(1, 12) },
    { creditId: 'uber', period: lastM, amount: 10, date: monthsBack(1, 3) }, { creditId: 'resy', period: `${yr}-H1`, amount: 50, date: `${yr}-04-20` },
    { creditId: 'dunkin', period: thisM, amount: 4.5, date: monthsBack(0, 9) }, ...Array.from({ length: 6 }, (_, i) => ({ creditId: 'dining', period: monthsBack(i + 2).slice(0, 7), amount: 10, date: monthsBack(i + 2, 10) })) ] },
  { id: 'w3', cardId: 'chase-freedom-unlimited', opened: `${yr - 4}-07-15`, usage: [] }
];
const scores = [];
['equifax', 'experian', 'transunion'].forEach((b, bi) => { for (let i = 0; i < 9; i++) scores.push({ id: `${b}${i}`, date: monthsBack(8 - i, 12 + bi), bureau: b, score: 712 + i * 4 + bi * 6 + (i % 3 === 0 ? -5 : 0), model: 'FICO 8', source: 'Bank or card app' }); });
scores.push({ id: 'v1', date: monthsBack(0, 2), bureau: 'transunion', score: 761, model: 'VantageScore 3.0', source: 'Credit Karma' });
const events = [{ id: 'e1', title: 'Rent', date: `${monthsBack(3).slice(0, 7)}-01`, repeat: 'monthly', amount: 1650 }];
const store = { accounts, wallet, customCards: [], cardEdits: {}, plans, scores, events, notes: {}, statements: [],
  browser: { tabs: [] }, settings: { name: 'Sample Person', theme: 'dark', statementsDir: stmtDir, monthlyGoal: 2000, renewalLeadDays: 45 }, ui: { view: 'overview' } };
// two sample statements waiting in the inbox
const fx = path.join(__dirname, 'fixtures');
const inbox = [['Statement_Sep2026.pdf', 'secure.chase.com'], ['Chase1234_Activity_20261015.CSV', 'secure.chase.com']];
store.statements = inbox.map(([f, host], i) => { const p = path.join(stmtDir, 'Inbox', f); fs.copyFileSync(path.join(fx, f), p); return { id: 's' + i, name: f, path: p, status: 'inbox', addedAt: Date.now() - i * 3600e3, source: 'browser', sourceHost: host, institution: 'Chase', period: null, accountId: null, kind: f.endsWith('.pdf') ? 'pdf' : 'csv' }; });
fs.writeFileSync(path.join(dir, 'slate-data.json'), JSON.stringify(store, null, 1));
console.log('seeded', dir);
