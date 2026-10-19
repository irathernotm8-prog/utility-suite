// Slate — pulls structured facts out of statement and credit-report text:
//   accountsIn(text)      every account a statement covers (Chase, BofA, Wells… bundle checking + savings)
//   cardDetails(text)     credit card statement facts: last 4, credit line, due date, annual fee
//   paidCards(text)       credit cards paid from a bank account ("Payment To Chase Card Ending IN 1234")
//   productsIn(text)      catalog cards named on a statement
//   creditReport(text)    tradelines from an Experian / Equifax / TransUnion / Credit Karma report:
//                         creditor, type, partial number, date opened, limit, balance, status
const fs = require('fs');
const path = require('path');

const AMT = String.raw`\(?-?\$?\s?[\d,]+\.\d{2}\)?`;
const num = (s) => {
  if (s == null) return null;
  const t = String(s).trim();
  const neg = /^\(.*\)$/.test(t) || /^\$?\s?[-−]/.test(t) || /[-−]$/.test(t);
  const v = Number(t.replace(/[^0-9.]/g, ''));
  return isNaN(v) || t.replace(/[^0-9]/g, '') === '' ? null : neg ? -v : v;
};
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
function date(s) {
  if (!s) return null;
  s = String(s).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[1])}-${pad(m[2])}`;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{4})/))) return `${m[2]}-${pad(m[1])}-01`;                     // 06/2021
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/)) && MON[m[1].slice(0, 3).toLowerCase()]) return `${m[3]}-${pad(MON[m[1].slice(0, 3).toLowerCase()])}-${pad(m[2])}`;
  if ((m = s.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})/)) && MON[m[1].slice(0, 3).toLowerCase()]) return `${m[2]}-${pad(MON[m[1].slice(0, 3).toLowerCase()])}-01`; // Jun 2021
  return null;
}
const DATE = String.raw`(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}[/.-]\d{4}|[A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4}|[A-Z][a-z]{2,8}\.?,?\s+\d{4})`;

function typeFromName(n = '') {
  n = n.toLowerCase();
  if (/money market|high[- ]yield|premier savings|online savings/.test(n)) return 'hysa';
  if (/savings/.test(n)) return 'savings';
  if (/checking/.test(n)) return 'checking';
  if (/roth/.test(n)) return 'roth-ira';
  if (/rollover/.test(n)) return 'rollover-ira';
  if (/\bira\b|traditional/.test(n)) return 'trad-ira';
  if (/401\s?\(?k|retirement savings plan/.test(n)) return '401k';
  if (/403\s?\(?b/.test(n)) return '403b';
  if (/\bhsa\b|health savings/.test(n)) return 'hsa';
  if (/brokerage|individual|investment/.test(n)) return 'brokerage';
  if (/card|visa|mastercard|amex|sapphire|freedom|venture|quicksilver/.test(n)) return 'credit';
  if (/mortgage/.test(n)) return 'mortgage';
  if (/auto|vehicle/.test(n)) return 'auto-loan';
  if (/student/.test(n)) return 'student-loan';
  if (/loan|line of credit/.test(n)) return 'loan';
  return 'checking';
}
const titleCase = (s) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bIra\b/g, 'IRA').replace(/\bHsa\b/g, 'HSA').replace(/\b401\(K\)/g, '401(k)');

/* ---------- every account in a statement ---------- */
function accountsIn(text) {
  const lines = text.split('\n');
  const found = new Map(); // last4 -> account
  const put = (a) => {
    const k = a.last4 || a.name;
    const cur = found.get(k) || {};
    for (const [key, v] of Object.entries(a)) if (v != null && v !== '' && (cur[key] == null || cur[key] === '')) cur[key] = v;
    found.set(k, cur);
  };
  // 1. summary tables: "Chase Total Checking   000000000001111   $100.00   $250.00"
  const row = new RegExp(String.raw`^\s*([A-Za-z][A-Za-z0-9 &'®.\/-]{3,60}?)\s+(?:[xX*•.]+\s?)?(\d{4,17})\s+(${AMT})\s+(${AMT})\s*$`);
  for (const l of lines) {
    const m = l.match(row);
    if (m && !/\b(total|primary|page)\b/i.test(m[1])) put({ name: m[1].trim(), last4: m[2].slice(-4), beginning: num(m[3]), ending: num(m[4]) });
  }
  // 2. per-account sections anchored on "Account Number: …1111"
  const anchors = [];
  lines.forEach((l, i) => {
    if (/primary account/i.test(l)) return;
    const m = l.match(/account (?:number|#|no\.?)\s*:?\s*(?:[xX*•.\s-]*\d{0,4}[\s-]){0,3}?[xX*•.\s-]*(\d{4,17})\b/i);
    if (m) anchors.push({ i, last4: m[1].slice(-4) });
  });
  anchors.forEach((a, k) => {
    const end = anchors[k + 1]?.i ?? lines.length;
    const section = lines.slice(a.i, end).join('\n');
    let name = '';
    for (let j = a.i; j >= Math.max(0, a.i - 3); j--) {
      const cand = (j === a.i ? lines[j].split(/account (?:number|#|no)/i)[0] : lines[j]).trim();
      if (/checking|savings|money market|card|ira|401|403|brokerage|hsa|loan|mortgage|account/i.test(cand) && cand.length < 70) { name = cand; break; }
    }
    const ending = section.match(new RegExp(`(?:ending|closing|new) balance\\s*:?\\s*(${AMT})`, 'i'));
    const beginning = section.match(new RegExp(`(?:beginning|opening|previous) balance\\s*:?\\s*(${AMT})`, 'i'));
    const apy = section.match(/annual percentage yield(?: earned)?[^\d\n]{0,40}([\d.]+)\s*%/i);
    put({ last4: a.last4, name: name ? titleCase(name) : '', ending: ending ? num(ending[1]) : null, beginning: beginning ? num(beginning[1]) : null, apy: apy ? Number(apy[1]) : null });
  });
  const ORDER = ['checking', 'savings', 'hysa', 'credit'];
  const rank = (t) => (ORDER.indexOf(t) + 1) || 9;
  return [...found.values()].filter(a => a.last4 && (a.ending != null || a.name)).map(a => ({ ...a, name: a.name || `Account ••${a.last4}`, type: typeFromName(a.name) })).sort((a, b) => rank(a.type) - rank(b.type));
}

/* ---------- credit card statement facts ---------- */
function cardDetails(text) {
  const isCard = /minimum payment due|credit (access )?line|credit limit|new balance/i.test(text) && /payment due date|minimum payment/i.test(text);
  if (!isCard) return null;
  const g = (re) => { const m = text.match(re); return m ? m[1] : null; };
  const last4 = g(/account (?:number|ending(?: in)?)\s*:?\s*(?:[xX*•\d]{4}[\s-]?){0,3}[xX*•\s-]*(\d{4})\b/i) || g(/ending in\s+(\d{4})/i);
  const out = {
    last4,
    newBalance: num(g(new RegExp(`new balance\\s*:?\\s*(${AMT})`, 'i'))),
    creditLimit: num(g(new RegExp(`credit (?:access )?(?:line|limit)\\s*:?\\s*(\\$?[\\d,]+(?:\\.\\d{2})?)`, 'i'))),
    minPayment: num(g(new RegExp(`minimum payment due\\s*:?\\s*(${AMT})`, 'i'))),
    dueDate: date(g(new RegExp(`payment due date\\s*:?\\s*${DATE}`, 'i'))),
    closingDate: date(g(new RegExp(`(?:closing date|statement closing date|opening\\/closing date\\s+\\S+\\s*[-–]\\s*)\\s*:?\\s*${DATE}`, 'i')))
  };
  // "09/14  ANNUAL MEMBERSHIP FEE   95.00"
  const fee = text.match(new RegExp(`(\\d{1,2}/\\d{1,2})?[^\\n]{0,30}annual (?:membership )?fee[^\\n\\d$]{0,30}(${AMT})`, 'i'));
  if (fee && num(fee[2]) > 0) out.annualFee = { amount: num(fee[2]), md: fee[1] || null };
  return out;
}

/* ---------- credit cards paid from a bank account ---------- */
const PAYEES = [
  ['Chase', /payment to chase card ending in (\d{4})|chase credit crd (?:autopay|epay)/i],
  ['American Express', /american express (?:ach pmt|transfer|epayment)|amex epayment/i],
  ['Capital One', /capital one (?:crcardpmt|mobile pmt|online pmt)/i],
  ['Citi', /citi (?:card online|autopay)|citicard/i],
  ['Discover', /discover (?:e-payment|dc pymnts)/i],
  ['Bank of America', /bk of amer (?:visa|mc) online pmt|bank of america credit card bill payment/i],
  ['Wells Fargo', /wf credit card|wells fargo card ccpymt/i],
  ['Apple', /applecard gsbank|apple card gs payment/i],
  ['Barclays', /barclaycard us creditcard/i]
];
function paidCards(text) {
  const out = new Map();
  for (const line of text.split('\n')) for (const [issuer, re] of PAYEES) {
    const m = line.match(re);
    if (!m) continue;
    if (/transfer/i.test(line) && issuer === 'American Express' && !/pmt|payment/i.test(line)) continue; // money coming in from Amex savings
    const k = issuer + (m[1] || '');
    out.set(k, { issuer, last4: m[1] || null, count: (out.get(k)?.count || 0) + 1 });
  }
  return [...out.values()];
}

/* ---------- catalog cards named on a statement ---------- */
let catalog = null;
function productsIn(text, institution) {
  if (!catalog) { try { catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'cards.json'), 'utf8')).cards; } catch { catalog = []; } }
  const t = text.slice(0, 8000).toLowerCase().replace(/[®™℠]/g, '');
  return catalog.filter(c => {
    const nm = c.name.toLowerCase().replace(/ card$/, '');
    if (nm.length < 5) return false;
    if (institution && c.issuer !== institution && !(c.issuer === 'Goldman Sachs' && institution === 'Apple')) return false;
    return t.includes(nm);
  }).map(c => c.id);
}

/* ---------- credit reports ---------- */
const CREDITORS = [
  ['Chase', /jpmcb|chase|jp morgan/i], ['American Express', /amex|american express|amer exp/i], ['Capital One', /capital one|cap one|capone/i],
  ['Citi', /citi|cbna|citibank/i], ['Bank of America', /bk of amer|bank of america|bofa|boa\b/i], ['Discover', /discover/i],
  ['Wells Fargo', /wells fargo|wf crd|wfbna|wf bank/i], ['Barclays', /barclay/i], ['Credit One', /credit one/i], ['Apple', /gs bank|goldman|apple card/i],
  ['Synchrony', /syncb|synchrony/i], ['US Bank', /us bank|usbank|u\.s\. bank/i], ['PNC', /\bpnc\b/i], ['Navy Federal', /navy fcu|navy federal/i], ['USAA', /usaa/i],
  ['Toyota', /toyota/i], ['Honda', /honda/i], ['Ally', /\bally\b/i], ['Navient', /navient/i], ['Nelnet', /nelnet/i], ['MOHELA', /mohela/i], ['Dept of Education', /dept of ed|us dept ed|ed financial/i],
  ['SoFi', /sofi/i], ['Affirm', /affirm/i], ['Upstart', /upstart/i]
];
const issuerOf = (s) => (CREDITORS.find(([, re]) => re.test(s)) || [null])[0];
const LABEL = /^(account|date|status|balance|credit|high|payment|terms|responsibility|type|owner|monthly|original|recent|last|past|remarks|comments|loan|limit|amount|reported|opened|closed|company|address|phone|creditor|term|open\/closed|condition|worst|pay status|months)/i;

function creditReport(text) {
  const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const anchors = [];
  lines.forEach((l, i) => { if (/(date opened|opened on|^opened\b|open date)/i.test(l)) anchors.push(i); });
  // find each account's lender line (searching up from its "Date opened", never past the previous account)
  const heads = anchors.map((ai, k) => {
    const floor = k ? anchors[k - 1] + 1 : Math.max(0, ai - 14);
    for (let j = ai - 1; j >= floor; j--) {
      const l = lines[j];
      if (LABEL.test(l) || /^\$?[\d,./ -]+$/.test(l) || l.length > 60 || /·/.test(l)) continue;
      if (issuerOf(l) || /^[A-Z0-9 &.\/'-]{3,40}$/.test(l)) return j;
    }
    return Math.max(floor, ai - 3);
  });
  const out = [];
  anchors.forEach((ai, k) => {
    const from = heads[k], to = k + 1 < anchors.length ? heads[k + 1] : Math.min(lines.length, ai + 16);
    const block = lines.slice(from, to);
    const blockText = block.join('\n');
    const pick = (re) => { const m = blockText.match(re); return m ? m[1].trim() : null; };
    const dl = lines[ai] + ' ' + (lines[ai + 1] || '');
    const dm = dl.match(new RegExp(`(?:date opened|opened on|opened|open date)\\s*:?\\s*${DATE}`, 'i'));
    const opened = dm ? date(dm[1]) : null;
    if (!opened) return;
    let creditor = lines[from] && !LABEL.test(lines[from]) ? lines[from].replace(/\s*(account|acct)\b.*$/i, '').trim() : '';
    if (!creditor) { const m = blockText.match(/(?:company|creditor|lender|account name)\s*(?:name)?\s*:?\s*([^\n]{3,40})/i); if (m) creditor = m[1].trim(); }
    const acct = pick(/account (?:number|#)\s*:?\s*([*xX\d -]{4,24})/i);
    const digits = acct ? acct.replace(/[^\dxX*]/g, '') : '';
    const typeTxt = [pick(/(?:account type|loan type|kind of business|terms)\s*:?\s*([^\n]{3,40})/i), block.find(l => /revolving|installment|credit card|mortgage|auto loan|student loan/i.test(l))].filter(Boolean).join(' ');
    const kind = /mortgage|real estate/i.test(typeTxt) ? 'mortgage' : /student|education/i.test(typeTxt + ' ' + creditor) ? 'student-loan' : /auto/i.test(typeTxt) ? 'auto-loan'
      : /installment|loan/i.test(typeTxt) ? 'loan' : 'credit';
    const status = pick(/(?:account status|status|open\/closed|condition)\s*:?\s*([^\n]{3,60})/i) || '';
    const closed = /closed|transferred|paid in full/i.test(status) || /date closed\s*:?\s*\d/i.test(blockText) || /closed accounts?/i.test(lines.slice(Math.max(0, from - 3), from).join(' '));
    const limit = num(pick(/(?:credit limit|high credit|original amount|loan amount)\s*:?\s*(\$?[\d,]+(?:\.\d{2})?)/i));
    const balance = num(pick(/(?:^|\n)(?:balance|current balance|amount owed)\s*:?\s*(\$?[\d,]+(?:\.\d{2})?)/i));
    const responsibility = pick(/(?:responsibility|owner|ownership)\s*:?\s*([^\n]{3,30})/i);
    out.push({
      creditor: creditor || 'Unknown lender', issuer: issuerOf(creditor) || null,
      kind, opened, closed, limit: limit || null, balance,
      last4: digits && /\d{4}$/.test(digits) ? digits.slice(-4) : null, partial: digits || null,
      authorizedUser: /authorized user/i.test(responsibility || ''), source: 'report'
    });
  });
  // the same account listed by several bureaus collapses into one
  const seen = new Map();
  for (const t of out) {
    const k = `${t.issuer || t.creditor}|${t.opened}|${t.last4 || ''}`;
    if (!seen.has(k)) seen.set(k, t); else { const s = seen.get(k); for (const [kk, v] of Object.entries(t)) if (s[kk] == null) s[kk] = v; }
  }
  return [...seen.values()].sort((a, b) => (a.closed - b.closed) || (a.opened < b.opened ? 1 : -1));
}

module.exports = { accountsIn, cardDetails, paidCards, productsIn, creditReport, typeFromName, date, issuerOf };
