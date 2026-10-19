// A pretend SimpleFIN Bridge for tests. Everything here is made up.
// node test/mock-simplefin.js <port>  → prints a Setup Token on stdout
const http = require('http');
const port = Number(process.argv[2] || 0);
const USER = 'demo', PASS = 'not-a-real-secret';
let claimed = false, hits = 0;
const now = Math.floor(Date.now() / 1000);
const accounts = () => ({
  errors: [],
  errlist: [],
  connections: [{ conn_id: 'c1', name: 'Example Bank', org_id: 'o1' }, { conn_id: 'c2', name: 'Sample Card Co', org_id: 'o2' }],
  accounts: [
    { id: 'ACT-1111', name: 'Everyday Checking (...1111)', conn_id: 'c1', currency: 'USD', balance: '1250.75', 'available-balance': '1250.75', 'balance-date': now, transactions: [] },
    { id: 'ACT-2222', name: 'Online Savings (...2222)', conn_id: 'c1', currency: 'USD', balance: '5000.00', 'balance-date': now, transactions: [] },
    { id: 'ACT-3333', name: 'Sapphire Preferred® Visa Signature® (...3333)', org: { name: 'Chase', domain: 'chase.com' }, currency: 'USD', balance: '-432.10', 'balance-date': now, transactions: [] },
    { id: 'ACT-4444', name: 'Rewards (...4444)', conn_id: 'c2', currency: 'USD', balance: '-75.00', 'balance-date': now, transactions: [] }
  ]
});
const srv = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/claim/demo-token') {
    if (claimed) { res.writeHead(403); return res.end('Forbidden'); }
    claimed = true;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(`http://${USER}:${encodeURIComponent(PASS)}@127.0.0.1:${srv.address().port}/simplefin`);
  }
  if (req.method === 'GET' && req.url.startsWith('/simplefin/accounts')) {
    const ok = req.headers.authorization === 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
    if (!ok) { res.writeHead(403); return res.end('Forbidden'); }
    hits++;
    if (!req.url.includes('balances-only=1')) { res.writeHead(400); return res.end('expected balances-only'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(accounts()));
  }
  if (req.url === '/hits') { res.writeHead(200); return res.end(String(hits)); }
  res.writeHead(404); res.end();
}).listen(port, '127.0.0.1', () => {
  console.log(Buffer.from(`http://127.0.0.1:${srv.address().port}/claim/demo-token`).toString('base64'));
});
