// Vantage — quick checks that run in plain Node (no window): vault crypto helpers and 2FA codes,
// CSV import, WireGuard config handling, history ranking and the browser identity.
const assert = require('assert');
const path = require('path');
let pass = 0, fail = 0;
// the core modules ask Electron for a few things at load time; give them a stand-in
const os = require('os'); const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-test-'));
const Module = require('module');
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? 'electron-stub' : realResolve.call(this, req, ...rest); };
require.cache['electron-stub'] = { id: 'electron-stub', filename: 'electron-stub', loaded: true, exports: { app: { getPath: () => tmp }, ipcMain: { handle() {}, on() {} }, session: {}, safeStorage: {}, webContents: {} } };
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n   ', e.message); } };

const vault = require('../src/core/vault')._test;
t('TOTP matches the RFC 6238 test vector', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.strictEqual(vault.totp(`otpauth://totp/x?secret=${secret}&digits=8`, 59000).code, '94287082');
  assert.strictEqual(vault.totp(`otpauth://totp/x?secret=${secret}&digits=8`, 1111111109000).code, '07081804');
  assert.strictEqual(vault.totp(secret, 59000).code, '287082');
  assert.strictEqual(vault.totp('gezd gnbv gy3t qojq gezd gnbv gy3t qojq', 59000).code, '287082');
});
t('TOTP rejects a bad key', () => assert.throws(() => vault.totp('not!valid', 0)));
t('password CSV from Google/Chrome imports', () => {
  const rows = vault.parseCSV('name,url,username,password,note\n"Netflix","https://netflix.com","me@x.com","p,a""ss",\nExample,https://ex.com,bob,hunter2,"multi\nline"\n');
  const list = vault.mapRows(rows);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].password, 'p,a"ss');
  assert.strictEqual(list[1].notes, 'multi\nline');
});
t('password strength', () => { assert.strictEqual(vault.strength('password123'), 1); assert.ok(vault.strength('V8#kq-2mPz!rT4xW') >= 3); });

const vpn = require('../src/core/vpn')._test;
const CONF = `[Interface]\n# Proton NL\nPrivateKey = aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd28=\nAddress = 10.2.0.2/32\nDNS = 10.2.0.1\n\n[Peer]\nPublicKey = c2VydmVyIGtleSBzZXJ2ZXIga2V5IHNlcnZlciBrZXk=\nAllowedIPs = 0.0.0.0/0\nEndpoint = 185.1.2.3:51820\n`;
t('WireGuard config is read', () => {
  const p = vpn.parseConf(CONF);
  assert.strictEqual(p.iface.address, '10.2.0.2/32');
  assert.strictEqual(p.peers[0].endpoint, '185.1.2.3:51820');
});
t('tunnel config adds a local SOCKS5 port and keepalive', () => {
  const out = vpn.proxyConf(vpn.parseConf(CONF), 41234);
  assert.ok(out.includes('[Socks5]\nBindAddress = 127.0.0.1:41234'));
  assert.ok(out.includes('PersistentKeepalive = 25'));
  assert.ok(out.includes('DNS = 10.2.0.1'));
});
t('a config without keys is refused', () => { assert.throws(() => vpn.parseConf('[Interface]\nAddress = 1.2.3.4/32')); assert.throws(() => vpn.parseConf('hello')); });
t('WARP keys are 32-byte X25519', () => { const k = vpn.keypair(); assert.strictEqual(Buffer.from(k.pub, 'base64').length, 32); assert.strictEqual(Buffer.from(k.priv, 'base64').length, 32); });

t('identity: Chrome UA without Electron, Firefox for Google sign-in', () => {
  const id = require('../src/core/identity');
  assert.ok(!/Electron|Vantage/.test(id.IDENTITIES.chrome.ua));
  assert.strictEqual(id.identityFor('https://accounts.google.com/signin').kind, 'firefox');
  assert.strictEqual(id.identityFor('https://example.com').kind, 'chrome');
  const h = id.rewriteHeaders({ 'User-Agent': 'x Electron/44', 'sec-ch-ua': '"Electron"' }, id.IDENTITIES.chrome);
  assert.ok(!/Electron/.test(JSON.stringify(h)));
});

// history ranking, with a pretend app-data folder
const store = require('../src/core/store');
t('settings load with defaults', () => { store.load(); assert.strictEqual(store.settings().downloadConnections, 8); assert.strictEqual(store.settings().adblock.enabled, true); });
t('history ranks often-visited sites first and completes hosts', () => {
  for (let i = 0; i < 5; i++) store.addVisit({ url: `https://www.youtube.com/watch?v=${i}`, title: 'YouTube' });
  store.addVisit({ url: 'https://yolo.example/', title: 'Yolo' });
  const r = store.frecent('yo', 5);
  assert.ok(r[0].url.includes('youtube'));
  assert.strictEqual(store.topSites(3)[0].host, 'youtube.com');
});
t('settings merge keeps nested defaults', () => {
  const m = store.merge(store.DEFAULT_SETTINGS, { adblock: { strict: false } });
  assert.strictEqual(m.adblock.enabled, true); assert.strictEqual(m.adblock.strict, false);
});
t('every renderer script and stylesheet the page loads exists', () => {
  const dir = path.join(__dirname, '..', 'src', 'renderer');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) if (!m[1].includes('node_modules')) assert.ok(fs.existsSync(path.join(dir, m[1])), m[1]);
});
t('every icon the UI asks for exists', () => {
  const dir = path.join(__dirname, '..', 'src', 'renderer');
  const icons = fs.readFileSync(path.join(dir, 'icons.js'), 'utf8') + fs.readFileSync(path.join(dir, 'shell.js'), 'utf8');
  const names = new Set([...icons.matchAll(/^\s+([a-zA-Z0-9]+): '</gm)].map(m => m[1]));
  const missing = new Set();
  for (const f of ['tabs.js', 'toolbar.js', 'pages.js', 'boot.js', 'newtab.js']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/\bic\('([a-zA-Z0-9]+)'/g)) if (!names.has(m[1])) missing.add(`${m[1]} (${f})`);
    for (const m of src.matchAll(/icon: '([a-zA-Z0-9]+)'/g)) if (!names.has(m[1])) missing.add(`${m[1]} (${f})`);
  }
  // the symbols offered in the bookmark icon picker and New Tab's search modes
  const tb = fs.readFileSync(path.join(dir, 'toolbar.js'), 'utf8');
  for (const g of JSON.parse(/const GLYPHS = (\[[^\]]+\])/.exec(tb)[1].replace(/'/g, '"'))) if (!names.has(g)) missing.add(`${g} (GLYPHS)`);
  const nt = fs.readFileSync(path.join(dir, 'newtab.js'), 'utf8');
  for (const m of nt.matchAll(/\['[a-z]+', (?:null|'[^']+'), '([a-zA-Z0-9]+)', \(q\)/g)) if (!names.has(m[1])) missing.add(`${m[1]} (MODES)`);
  assert.deepStrictEqual([...missing], []);
});
t('sign-in pages are never ad-blocked; YouTube skips scriptlets', () => {
  const ab = require('../src/core/adblock');
  assert.ok(ab.isAuthHost('accounts.google.com'));
  assert.ok(ab.isAuthHost('login.microsoftonline.com'));
  assert.ok(!ab.isAuthHost('google.com.evil.example'));
  assert.ok(!ab.isAuthHost('example.com'));
});
t('Firefox identity carries a current version number', () => {
  const id = require('../src/core/identity');
  assert.ok(parseInt(id.FIREFOX_V, 10) >= 150);
  assert.ok(id.IDENTITIES.firefox.ua.includes('Firefox/' + id.FIREFOX_V));
});
t('new settings have defaults (accent, New Tab, mini player, sign-in)', () => {
  const st = store.settings();
  assert.strictEqual(st.accent, 'ocean'); assert.strictEqual(st.signinMode, 'auto');
  assert.strictEqual(st.newtab.bg, 'aurora'); assert.strictEqual(st.newtab.widgets.notes, true);
  assert.strictEqual(st.miniPlayer.auto, true); assert.strictEqual(st.engineSuggestions, true);
  assert.deepStrictEqual(store.get().readLater, []);
});
t('suite link copy matches the Utility Package', () => {
  const canon = path.join(__dirname, '..', '..', '..', 'tools', 'suitelink.js');
  if (fs.existsSync(canon)) assert.strictEqual(fs.readFileSync(canon, 'utf8'), fs.readFileSync(path.join(__dirname, '..', 'src', 'suitelink.js'), 'utf8'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
