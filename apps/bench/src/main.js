// Bench — entry point. The same program is also Bench's small browser for testing web pages on a desk
// (started with --bench-shell), so web pages get the same control as any Electron app.
'use strict';
if (process.argv.includes('--bench-shell')) require('./shell');
else require('./app-main');
