// Slate — reads statement files (CSV, OFX/QFX, PDF) and pulls out what Slate needs:
// the institution, the statement month, the ending balance and a transaction count.
// Nothing here talks to the network.
const fs = require('fs');
const path = require('path');
const E = require('./extract');

const INSTITUTIONS = [
  ['Chase', /chase|jpmorgan/i, /(^|\.)chase\.com$/],
  ['American Express', /american\s*express|amex/i, /(^|\.)americanexpress\.com$/],
  ['Capital One', /capital\s*one/i, /(^|\.)capitalone\.com$/],
  ['Citi', /\bciti(bank|cards)?\b/i, /(^|\.)citi(bank|cards)?\.com$/],
  ['Bank of America', /bank\s*of\s*america|bofa/i, /(^|\.)bankofamerica\.com$/],
  ['Discover', /discover/i, /(^|\.)discover\.com$/],
  ['Wells Fargo', /wells\s*fargo/i, /(^|\.)wellsfargo\.com$/],
  ['Barclays', /barclay/i, /(^|\.)barclay(s|cardus)\.com$/],
  ['Credit One', /credit\s*one/i, /(^|\.)creditonebank\.com$/],
  ['Apple', /apple\s*card|goldman/i, /(^|\.)card\.apple\.com$/],
  ['Fidelity', /fidelity/i, /(^|\.)fidelity\.com$/],
  ['Vanguard', /vanguard/i, /(^|\.)vanguard\.com$/],
  ['Charles Schwab', /schwab/i, /(^|\.)schwab\.com$/],
  ['Empower', /empower/i, /(^|\.)empower(-retirement)?\.com$/],
  ['Principal', /principal/i, /(^|\.)principal\.com$/],
  ['Robinhood', /robinhood/i, /(^|\.)robinhood\.com$/],
  ['Ally', /\bally\b/i, /(^|\.)ally\.com$/],
  ['Marcus', /marcus/i, /(^|\.)marcus\.com$/],
  ['SoFi', /sofi/i, /(^|\.)sofi\.com$/],
  ['US Bank', /u\.?s\.?\s*bank/i, /(^|\.)usbank\.com$/],
  ['PNC', /\bpnc\b/i, /(^|\.)pnc\.com$/],
  ['Truist', /truist/i, /(^|\.)truist\.com$/],
  ['Navy Federal', /navy\s*federal/i, /(^|\.)navyfederal\.org$/],
  ['USAA', /\busaa\b/i, /(^|\.)usaa\.com$/]
];

function institutionFrom({ host = '', name = '', text = '' } = {}) {
  host = String(host).replace(/^www\./, '');
  for (const [label, , hostRe] of INSTITUTIONS) if (host && hostRe.test(host)) return label;
  for (const [label, re] of INSTITUTIONS) if (re.test(name)) return label;
  const head = String(text).slice(0, 4000);
  for (const [label, re] of INSTITUTIONS) if (re.test(head)) return label;
  return '';
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const fullYear = (y) => { y = Number(y); return y < 100 ? 2000 + y : y; };

// Any date string → 'YYYY-MM-DD' (or null)
function toISO(s) {
  if (!s) return null;
  s = String(s).trim();
  let m;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;                // OFX 20261014120000
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) return `${fullYear(m[3])}-${pad(m[1])}-${pad(m[2])}`; // US M/D/Y
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/))) { const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()]; if (mo) return `${m[3]}-${pad(mo)}-${pad(m[2])}`; }
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/))) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo) return `${m[3]}-${pad(mo)}-${pad(m[1])}`; }
  return null;
}

function money(s) {
  if (s == null) return null;
  let t = String(s).trim();
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || /^\$?\s?[-−]/.test(t) || /[-−]$/.test(t);
  t = t.replace(/[^0-9.]/g, '');
  if (!t || isNaN(Number(t))) return null;
  return neg ? -Number(t) : Number(t);
}

/* ---------- CSV ---------- */
function splitCSV(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}

function parseCSV(text) {
  const rows = splitCSV(text.replace(/^﻿/, ''));
  // the header is the first row that names a date column
  const hi = rows.findIndex(r => r.some(c => /date/i.test(c)) && r.length >= 3);
  if (hi < 0) return { kind: 'csv', transactions: 0, note: 'No date column found' };
  const head = rows[hi].map(h => h.trim().toLowerCase());
  const col = (...res) => head.findIndex(h => res.some(re => re.test(h)));
  const iDate = col(/^(posting |transaction |trans\.? |post )?date$/, /date/);
  const iAmt = col(/^amount$/, /amount/);
  const iDebit = col(/debit|withdraw/), iCredit = col(/credit|deposit/);
  const iBal = col(/balance/);
  const iDesc = col(/description|payee|merchant|details|name|memo/);
  const tx = [];
  for (const r of rows.slice(hi + 1)) {
    const date = toISO(r[iDate]);
    if (!date) continue;
    let amount = iAmt >= 0 ? money(r[iAmt]) : null;
    if (amount == null && (iDebit >= 0 || iCredit >= 0)) amount = (money(r[iCredit]) || 0) - Math.abs(money(r[iDebit]) || 0);
    tx.push({ date, amount: amount ?? 0, balance: iBal >= 0 ? money(r[iBal]) : null, description: iDesc >= 0 ? (r[iDesc] || '').trim() : '' });
  }
  if (!tx.length) return { kind: 'csv', transactions: 0, note: 'No rows with dates found' };
  const dates = tx.map(t => t.date).sort();
  const latest = [...tx].filter(t => t.balance != null).sort((a, b) => a.date < b.date ? 1 : -1)[0];
  return {
    kind: 'csv',
    transactions: tx.length,
    from: dates[0], to: dates[dates.length - 1],
    endingBalance: latest ? latest.balance : null,
    endingDate: latest ? latest.date : dates[dates.length - 1],
    net: Math.round(tx.reduce((s, t) => s + t.amount, 0) * 100) / 100
  };
}

/* ---------- OFX / QFX ---------- */
function ofxTag(text, tag) { const m = text.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i')); return m ? m[1].trim() : null; }
function parseOFX(text) {
  const trn = (text.match(/<STMTTRN>/gi) || []).length + (text.match(/<INVBANKTRAN>|<BUYMF>|<SELLMF>|<BUYSTOCK>|<SELLSTOCK>|<REINVEST>|<INCOME>/gi) || []).length;
  const out = { kind: 'ofx', transactions: trn, org: ofxTag(text, 'ORG') || '' };
  out.from = toISO(ofxTag(text, 'DTSTART'));
  out.to = toISO(ofxTag(text, 'DTEND'));
  const ledger = text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)[\s\S]*?<DTASOF>([^<\r\n]+)/i);
  if (ledger) { out.endingBalance = money(ledger[1]); out.endingDate = toISO(ledger[2]); }
  else if (/<INVSTMTRS>/i.test(text)) {
    // investment account: positions' market value + cash
    const vals = [...text.matchAll(/<MKTVAL>([^<\r\n]+)/gi)].map(m => money(m[1]) || 0);
    const cash = money(ofxTag(text, 'AVAILCASH')) || 0;
    if (vals.length || cash) { out.endingBalance = Math.round((vals.reduce((a, b) => a + b, 0) + cash) * 100) / 100; out.endingDate = toISO(ofxTag(text, 'DTASOF')) || out.to; }
  }
  // credit cards report what you owe as a negative balance
  if (/<CCSTMTRS>/i.test(text) && out.endingBalance != null) out.owed = -out.endingBalance;
  return out;
}

/* ---------- PDF ---------- */
let pdfjs = null;
async function pdfText(file, maxPages = 6) {
  if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(file));
  const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true, verbosity: 0 });
  const doc = await task.promise;
  const total = doc.numPages;
  const pages = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const c = await page.getTextContent();
    // keep visual lines together so "New Balance ........ $1,234.56" stays on one line
    let line = '', lastY = null;
    const lines = [];
    for (const it of c.items) {
      const y = it.transform ? Math.round(it.transform[5]) : lastY;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
      line += (line && !line.endsWith(' ') ? ' ' : '') + it.str;
      lastY = y;
    }
    lines.push(line);
    pages.push(lines.join('\n'));
  }
  try { await task.destroy(); } catch {}
  return { text: pages.join('\n'), pages: total };
}

const AMT = String.raw`\(?-?\$?\s?-?[\d,]+\.\d{2}\)?`;
const BALANCE_LABELS = [
  /new balance/i, /statement balance/i, /ending balance/i, /closing balance/i,
  /total account value/i, /ending (account |portfolio )?value/i, /your (account|portfolio) value/i,
  /ending vested balance/i, /total balance/i, /balance as of/i, /current balance/i
];
function findBalance(text) {
  const lines = text.split('\n');
  for (const label of BALANCE_LABELS) {
    for (let i = 0; i < lines.length; i++) {
      const hit = lines[i].match(label);
      if (!hit) continue;
      const after = lines[i].slice(hit.index + hit[0].length);
      let m = after.match(new RegExp(AMT)) || (lines[i + 1] || '').match(new RegExp(`^\\s*${AMT}`));
      if (m) { const v = money(m[0]); if (v != null) return { value: v, label: label.source.replace(/\\/g, '') }; }
    }
  }
  return null;
}
function findPeriodEnd(text) {
  const D = String.raw`(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|[A-Z][a-z]{2,8}\.? \d{1,2},? \d{4})`;
  const pats = [
    new RegExp(`(?:statement|billing) (?:period|cycle)[^\\n]*?${D}\\s*(?:-|–|to|through)\\s*${D}`, 'i'),
    new RegExp(`${D}\\s*(?:-|–|to|through)\\s*${D}`, 'i'),
    new RegExp(`(?:closing date|statement date|period ending|as of)[^\\n\\d]*${D}`, 'i')
  ];
  for (const re of pats) { const m = text.match(re); if (m) { const d = toISO(m[2] || m[1]); if (d) return d; } }
  return null;
}
async function parsePDF(file) {
  const { text, pages } = await pdfText(file);
  const bal = findBalance(text);
  return {
    kind: 'pdf', pages,
    endingBalance: bal ? bal.value : null,
    balanceLabel: bal ? bal.label : null,
    endingDate: findPeriodEnd(text),
    textChars: text.trim().length,
    _text: text
  };
}

/* ---------- entry point ---------- */
function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.csv') return 'csv';
  if (ext === '.ofx' || ext === '.qfx' || ext === '.qbo') return 'ofx';
  return 'other';
}

// Month from a filename like "Statement_2026-09.pdf", "20260914-statements-1234.pdf" or "Sep 2026.pdf"
function monthFromName(name) {
  let m;
  if ((m = name.match(/(20\d{2})[-_. ]?(0[1-9]|1[0-2])(?:[-_. ]?([0-3]\d))?/))) return `${m[1]}-${m[2]}`;
  if ((m = name.match(/(0[1-9]|1[0-2])[-_.](20\d{2})/))) return `${m[2]}-${m[1]}`;
  if ((m = name.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-_ ]?(20\d{2})/i))) return `${m[2]}-${pad(MONTHS[m[1].toLowerCase()])}`;
  return null;
}

async function parseFile(file, hint = {}) {
  const kind = kindOf(file);
  const name = path.basename(file);
  let r = { kind };
  try {
    if (kind === 'csv') r = parseCSV(fs.readFileSync(file, 'utf8'));
    else if (kind === 'ofx') r = parseOFX(fs.readFileSync(file, 'utf8'));
    else if (kind === 'pdf') r = await parsePDF(file);
  } catch (e) { r = { kind, error: 'Couldn’t read this file: ' + (e.message || e) }; }
  const text = r._text || '';
  delete r._text;
  Object.defineProperty(r, 'text', { value: text, enumerable: false });
  r.institution = institutionFrom({ host: hint.host, name: `${name} ${r.org || ''}`, text });
  const endMonth = r.endingDate ? r.endingDate.slice(0, 7) : null;
  r.period = endMonth || (r.to ? r.to.slice(0, 7) : null) || monthFromName(name);
  if (text) {
    // a credit report rather than a statement?
    if (/date opened|opened on/i.test(text) && /(experian|equifax|transunion|credit report|annualcreditreport)/i.test(text)) {
      r.report = true;
      r.tradelines = E.creditReport(text);
    } else {
      const card = E.cardDetails(text);
      if (card) {
        r.card = card;
        r.accounts = [{ name: '', last4: card.last4, type: 'credit', ending: card.newBalance ?? r.endingBalance, creditLimit: card.creditLimit, closingDate: card.closingDate || r.endingDate, dueDate: card.dueDate }];
        r.products = E.productsIn(text, r.institution);
      } else {
        r.accounts = E.accountsIn(text);
        if (!r.accounts.length && r.endingBalance != null) {
          const l4 = text.match(/(?:account (?:number|ending(?: in)?)|ending in)\s*:?\s*[xX*•.\s-]*\d*?(\d{4})\b/i);
          r.accounts = [{ name: '', last4: l4 ? l4[1] : null, type: E.typeFromName(text.slice(0, 1500)), ending: r.endingBalance }];
        }
        r.paidCards = E.paidCards(text);
      }
    }
  }
  return r;
}

// Read a credit report from a file or from page text (the browser's "Read accounts from this page")
async function parseReport(fileOrText, isText) {
  let text = fileOrText;
  if (!isText) {
    const k = kindOf(fileOrText);
    text = k === 'pdf' ? (await pdfText(fileOrText, 40)).text : fs.readFileSync(fileOrText, 'utf8');
  }
  return E.creditReport(text);
}

module.exports = { parseFile, parseReport, parseCSV, parseOFX, parsePDF, findBalance, findPeriodEnd, institutionFrom, monthFromName, toISO, money, kindOf, INSTITUTIONS };
