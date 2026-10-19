// node test/run.js — checks the statement parser against sample files
const path = require('path');
const assert = require('assert');
const P = require('../src/parse');
const F = (n) => path.join(__dirname, 'fixtures', n);
(async () => {
  const csv = await P.parseFile(F('Chase1234_Activity_20261015.CSV'));
  console.log('csv', csv);
  assert.equal(csv.transactions, 3); assert.equal(csv.endingBalance, 4210.55); assert.equal(csv.period, '2026-10'); assert.equal(csv.institution, 'Chase');
  const ofx = await P.parseFile(F('amex.ofx'));
  console.log('ofx', ofx);
  assert.equal(ofx.owed, 1234.56); assert.equal(ofx.period, '2026-10'); assert.equal(ofx.institution, 'American Express');
  const pdf = await P.parseFile(F('fidelity-statement.pdf'));
  console.log('pdf', pdf);
  assert.equal(pdf.endingBalance, 48210.33); assert.equal(pdf.period, '2026-09'); assert.equal(pdf.institution, 'Fidelity');
  const pdf2 = await P.parseFile(F('Statement_Sep2026.pdf'), { host: 'secure.chase.com' });
  console.log('pdf2', pdf2);
  assert.equal(pdf2.endingBalance, 2315.08); assert.equal(pdf2.period, '2026-09'); assert.equal(pdf2.institution, 'Chase');
  assert.equal(P.money('(1,200.50)'), -1200.5); assert.equal(P.money('$-5.00'), -5);
  assert.equal(P.monthFromName('20260914-statements-1234-.pdf'), '2026-09');
  console.log('\nAll parser checks passed');
})().catch(e => { console.error(e); process.exit(1); });

// statements with several accounts, card payments, credit reports
(async () => {
  const E = require('../src/extract');
  const fs = require('fs');
  const t = 'CONSOLIDATED BALANCE SUMMARY\nChase Total Checking  000000000001111  $100.00  $250.00\nChase Savings  000000000002222  1,000.00  1,200.00\nTotal  $1,100.00  $1,450.00\nCHASE TOTAL CHECKING\nJANE DOE  Account Number:  000000000001111\nEnding Balance  $250.00\nCHASE SAVINGS\nJANE DOE  Account Number:  000000000002222\nEnding Balance $1,200.00\nAnnual Percentage Yield Earned This Period 0.01%\n08/31  08/29 Payment To Chase Card Ending IN 3333  -50.00\n08/31 Applecard Gsbank Payment 123 Web ID: 9  -25.00';
  const accts = E.accountsIn(t);
  assert.deepEqual(accts.map(a => [a.type, a.last4, a.ending]), [['checking', '1111', 250], ['savings', '2222', 1200]]);
  assert.equal(accts[1].apy, 0.01);
  assert.deepEqual(E.paidCards(t).map(p => p.issuer + (p.last4 || '')), ['Chase3333', 'Apple']);
  const rep = E.creditReport(fs.readFileSync(path.join(__dirname, 'fixtures', 'report-experian.txt'), 'utf8'));
  assert.equal(rep.length, 5); assert.equal(rep.filter(r => r.closed).length, 1);
  assert.equal(rep.find(r => r.opened === '2024-04-12').limit, 10000);
  const eq = E.creditReport(fs.readFileSync(path.join(__dirname, 'fixtures', 'report-equifax.txt'), 'utf8'));
  assert.equal(eq.find(r => r.last4 === '4444').authorizedUser, true);
  console.log('All statement and credit report checks passed');
})().catch(e => { console.error(e); process.exit(1); });

// SimpleFIN helpers (made-up names and numbers)
(async () => {
  const SF = require('../src/simplefin');
  assert.equal(SF.last4Of('Everyday Checking (...1111)'), '1111');
  assert.equal(SF.last4Of('Rewards Card ending in 2222'), '2222');
  assert.equal(SF.last4Of('Savings xxxx3333'), '3333');
  assert.equal(SF.last4Of('Brokerage'), '');
  assert.equal(SF.cleanName('Sapphire Preferred® Visa Signature® (...3333)'), 'Sapphire Preferred');
  const claim = 'https://bridge.example.test/simplefin/claim/abc';
  assert.equal(SF.decodeToken(Buffer.from(claim).toString('base64')).claim, claim);
  assert.equal(SF.decodeToken(Buffer.from(claim).toString('base64url')).claim, claim);
  assert.equal(SF.decodeToken('https://u:p@bridge.example.test/simplefin').access, 'https://u:p@bridge.example.test/simplefin');
  assert.throws(() => SF.decodeToken('hello'));
  const pa = SF.parseAccess('https://us%40er:p%3Ass@bridge.example.test/simplefin/');
  assert.equal(pa.base, 'https://bridge.example.test/simplefin');
  assert.equal(pa.auth, 'Basic ' + Buffer.from('us@er:p:ss').toString('base64'));
  assert.throws(() => SF.parseAccess('http://u:p@bridge.example.test/simplefin'));
  console.log('All SimpleFIN checks passed');
})().catch(e => { console.error(e); process.exit(1); });
