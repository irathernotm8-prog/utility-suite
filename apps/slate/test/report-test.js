const E = require('../src/extract');
const fs = require('fs');
for (const f of ['report-experian.txt', 'report-equifax.txt', 'report-ck.txt']) {
  const t = E.creditReport(fs.readFileSync(__dirname + '/fixtures/' + f, 'utf8'));
  console.log('\n' + f); console.table(t.map(x => ({ creditor: x.creditor, issuer: x.issuer, kind: x.kind, opened: x.opened, closed: x.closed, limit: x.limit, bal: x.balance, last4: x.last4, au: x.authorizedUser })));
}
