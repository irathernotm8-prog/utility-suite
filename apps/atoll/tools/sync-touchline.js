// Refreshes src/touchline/vendor from Touchline's data layer (apps/touchline/src/data), so Atoll's live match
// reads FotMob exactly the way Touchline does. Run after Touchline changes http.js, cache.js, normalize.js or espn.js:
//   npm run sync-touchline
'use strict';
const fs = require('fs');
const path = require('path');
const from = path.resolve(__dirname, '..', '..', 'touchline', 'src', 'data');
const to = path.resolve(__dirname, '..', 'src', 'touchline', 'vendor');
const HEAD = '// Vendored from apps/touchline/src/data by `npm run sync-touchline`. Edit it in Touchline, not here.\n';
if (!fs.existsSync(from)) { console.error(`Touchline not found at ${from}`); process.exit(1); }
for (const f of ['http.js', 'cache.js', 'normalize.js', 'espn.js']) {
  const src = fs.readFileSync(path.join(from, f), 'utf8');
  const out = HEAD + src.replace(/^\/\/ Vendored from.*\n/, '');
  const dest = path.join(to, f);
  const same = fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === out;
  if (!same) fs.writeFileSync(dest, out);
  console.log(`${same ? '  same   ' : '  updated'} ${f}`);
}
