// A tiny "analytics site" for end-to-end runs: a sign-in form, a reports page with a date-range picker,
// an Export CSV button that downloads a file, and a table. `node test/e2e/site.js` to try it by hand.
'use strict';
const http = require('http');

const PASSWORD = 'demo-password';
function csv(range) {
  const rows = range === 'last-week'
    ? [['Meta', 1840, 6120.5], ['Google Search', 1312, 5280], ['Email', 604, 0], ['TikTok', 455, 2210], ['Referral', 238, 0]]
    : [['Meta', 1702, 6050], ['Google Search', 1405, 5310], ['Email', 512, 0], ['TikTok', 301, 1980], ['Referral', 251, 0]];
  const days = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
  const out = ['Channel,Date,Signups,Spend'];
  for (const [ch, total, spend] of rows) days.forEach((d, i) => { const share = [0.16, 0.17, 0.15, 0.15, 0.14, 0.11, 0.12][i]; out.push(`${ch},${d},${Math.round(total * share)},${(spend * share).toFixed(2)}`); });
  return out.join('\n') + '\n';
}
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font:15px system-ui;margin:40px;max-width:720px}label{display:block;margin:10px 0 4px}input,select{padding:8px;width:260px}button{margin-top:14px;padding:9px 16px;border-radius:8px;border:0;background:#3a4cf0;color:#fff;font-weight:600;cursor:pointer}table{border-collapse:collapse;margin-top:20px}td,th{border:1px solid #ddd;padding:6px 10px}</style></head><body>${body}</body></html>`;

function start(port = 0) {
  const server = http.createServer((req, res) => {
    const cookie = req.headers.cookie || '';
    const authed = /session=ok/.test(cookie);
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/login' && req.method === 'POST') {
      let b = ''; req.on('data', (d) => (b += d)).on('end', () => {
        const p = new URLSearchParams(b);
        if (p.get('password') === PASSWORD) { res.writeHead(302, { 'Set-Cookie': 'session=ok; Path=/; HttpOnly', Location: '/reports' }); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page('Sign in', '<p>Wrong password</p>'));
      });
      return;
    }
    if (u.pathname === '/login' || (!authed && u.pathname !== '/export')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(page('Sign in', `<h1>Acme Analytics</h1><form method="post" action="/login"><label for="e">Email</label><input id="e" name="email" type="email"><label for="p">Password</label><input id="p" name="password" type="password"><br><button type="submit">Sign in</button></form>`));
    }
    if (u.pathname === '/reports') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(page('Reports', `<h1>Sign-ups</h1><label for="r">Date range</label><select id="r"><option value="this-week">This week</option><option value="last-week">Last week</option></select><br><button id="exp" onclick="setTimeout(()=>{location.href='/export?range='+document.getElementById('r').value},300)">Export CSV</button>
        <table id="summary"><tr><th>Channel</th><th>Sign-ups</th></tr><tr><td>Meta</td><td>1,840</td></tr><tr><td>Google Search</td><td>1,312</td></tr></table>`));
    }
    if (u.pathname === '/export') {
      if (!authed) { res.writeHead(401); return res.end('sign in'); }
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="signups.csv"' });
      return res.end(csv(u.searchParams.get('range')));
    }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}
module.exports = { start, PASSWORD };
if (require.main === module) start(4477).then(() => console.log('http://127.0.0.1:4477/login'));
