// Bench — quick checks for the core modules (no window, no network). `npm test`
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const tests = []; const test = (name, fn) => tests.push({ name, fn });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bench-test-'));

test('DES matches the standard test vector, VNC response is deterministic', () => {
  const { desEncrypt, vncResponse } = require('../src/core/des');
  assert.strictEqual(desEncrypt(Buffer.from('133457799BBCDFF1', 'hex'), Buffer.from('0123456789ABCDEF', 'hex')).toString('hex'), '85e813540f0ab405');
  const ch = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  assert.deepStrictEqual(vncResponse('secret', ch), vncResponse('secret', ch));
  assert.notDeepStrictEqual(vncResponse('secret', ch), vncResponse('Secret', ch));
});

test('PNG encoder writes a valid header and size', () => {
  const { encodePng, pngSize, scaleRgba } = require('../src/core/png');
  const px = Buffer.alloc(4 * 4 * 3, 200); const png = encodePng(px, 4, 3);
  assert.deepStrictEqual(pngSize(png), { width: 4, height: 3 });
  assert.strictEqual(scaleRgba(Buffer.alloc(10 * 10 * 4), 10, 10, 5, 5).length, 100);
});

test('key names parse into every desk’s language', () => {
  const k = require('../src/core/keys');
  assert.deepStrictEqual(k.parseCombo('cmd+shift+s', { mac: true }), { mods: ['meta', 'shift'], key: 's' });
  assert.deepStrictEqual(k.parseCombo('mod+z', { mac: false }), { mods: ['control'], key: 'z' });
  assert.deepStrictEqual(k.parseCombo('Enter'), { mods: [], key: 'Enter' });
  assert.deepStrictEqual(k.parseCombo('ctrl++'), { mods: ['control'], key: '+' });
  assert.strictEqual(k.parseCombo('F5').key, 'F5');
  assert.throws(() => k.parseCombo('hyper+x'));
  assert.strictEqual(k.keysymFor('Enter'), 0xff0d); assert.strictEqual(k.keysymFor('F1'), 0xffbe); assert.strictEqual(k.keysymFor('a'), 0x61); assert.strictEqual(k.keysymFor('€'), 0x01000000 + 0x20ac);
  assert.strictEqual(k.vkFor('a'), 0x41); assert.strictEqual(k.vkFor('F2'), 0x71); assert.strictEqual(k.vkFor('Down'), 0x28);
  const sa = k.cdpKeyEvents('cmd+a', { mac: true }); assert.deepStrictEqual(sa.down.commands, ['selectAll']); assert.strictEqual(sa.down.type, 'rawKeyDown'); assert.strictEqual(sa.down.modifiers, 4);
  const bs = k.cdpKeyEvents('Backspace', { mac: true }); assert.deepStrictEqual(bs.down.commands, ['deleteBackward']);
  assert.strictEqual(k.cdpKeyEvents('Backspace', { mac: false }).down.commands, undefined);
  const A = k.cdpKeyEvents('shift+a', { mac: false }); assert.strictEqual(A.down.text, 'A'); assert.strictEqual(A.down.code, 'KeyA');
  assert.strictEqual(k.acceleratorKey('CmdOrCtrl+Shift+S', { mac: true }), k.comboKey(['meta', 'shift'], 's'));
  assert.strictEqual(k.acceleratorKey('CmdOrCtrl+S', { mac: false }), k.comboKey(['control'], 's'));
});

test('VNC client: sign-in, screen, clicks, typing, wrong password', async () => {
  const { createFakeScreen } = require('../src/demo/fake-vnc');
  const { RfbClient, parseVncUrl } = require('../src/core/rfb');
  const s = createFakeScreen({ password: 'pw' }); const port = await s.listen();
  const c = new RfbClient({ port, password: 'pw' }); await c.connect(); await c.settle(600);
  assert.strictEqual(c.width, 1280);
  await c.click(s.button.x + 5, s.button.y + 5); await c.settle(400);
  assert.strictEqual(s.state.clicks, 1);
  const i = ((s.button.y + 3) * c.width + s.button.x + 3) * 4; assert.deepStrictEqual([...c.fb.subarray(i, i + 3)], [46, 196, 112]);
  await c.type('Ab c'); await c.press('Backspace'); await c.settle(300); assert.strictEqual(s.state.typed, 'Ab ');
  await c.scroll(100, 100, 0, 300); assert.ok(s.state.scrolls >= 1);
  const snap = c.snapshot({ maxSide: 640 }); assert.strictEqual(snap.width, 640); assert.strictEqual(snap.scale, 2);
  c.close();
  await assert.rejects(new RfbClient({ port, password: 'nope' }).connect(), /Wrong password|sign-in failed/);
  s.close();
  assert.deepStrictEqual(parseVncUrl('vnc://:a%3Ab@127.0.0.1:61000'), { host: '127.0.0.1', port: 61000, password: 'a:b', username: '' });
  assert.strictEqual(parseVncUrl('vnc://10.0.0.2:1').port, 5901);
});

test('ScreenDesk (VNC desk) drives a screen and scales coordinates', async () => {
  const { createFakeScreen } = require('../src/demo/fake-vnc');
  const { ScreenDesk } = require('../src/core/screen-desk');
  const s = createFakeScreen({ password: 'x' }); const port = await s.listen();
  const d = new ScreenDesk({ id: 'd1', name: 'Demo', kind: 'vnc', remote: { host: '127.0.0.1', vncPort: port, vncPassword: 'x' } }, { dir: tmp() });
  await d.start();
  assert.strictEqual(d.state, 'running');
  const shot = await d.screenshot({ maxSide: 640 }); assert.strictEqual(shot.width, 640);
  await d.click({ x: (s.button.x + 10) / 2, y: (s.button.y + 10) / 2 }); await d.rfb.settle(300);
  assert.strictEqual(s.state.clicks, 1);
  await assert.rejects(d.run('ls'), /no command access/);
  await d.stop(); assert.strictEqual(d.state, 'stopped'); s.close();
});

test('Tart output parsing and VM image list', () => {
  const { IMAGES } = require('../src/core/tart');
  assert.ok(IMAGES.find((i) => i.id === 'macos-tahoe') && IMAGES.find((i) => i.id === 'ubuntu'));
  const re = /(vnc:\/\/[^\s]+?)(?:\.\.\.|\s|$)/;
  assert.strictEqual(re.exec('Opening vnc://:secret@127.0.0.1:59123...\n')[1], 'vnc://:secret@127.0.0.1:59123');
  assert.strictEqual(re.exec('VNC server is running at vnc://:p@127.0.0.1:5901\n')[1], 'vnc://:p@127.0.0.1:5901');
});

test('Windows Sandbox config and the shared-folder agent protocol', async () => {
  const { wsbConfig, AgentClient } = require('../src/core/winsandbox');
  const x = wsbConfig({ share: 'C:\\Users\\b\\Bench & co\\share', memoryMB: 8192, network: false });
  assert.ok(x.includes('<HostFolder>C:\\Users\\b\\Bench &amp; co\\share</HostFolder>') && x.includes('<Networking>Disable</Networking>') && x.includes('<MemoryInMB>8192</MemoryInMB>') && x.includes('bench-agent.ps1'));
  const share = tmp(); const a = new AgentClient(share); a.reset();
  // a pretend agent: answers jobs the way bench-agent.ps1 does (UTF-8 with a BOM, tmp then rename)
  const stop = setInterval(() => {
    fs.writeFileSync(path.join(share, 'agent.json'), '\uFEFF' + JSON.stringify({ ready: true, t: Date.now(), width: 1920, height: 1080 }));
    for (const f of fs.readdirSync(a.inDir)) {
      if (!f.endsWith('.json')) continue; const j = JSON.parse(fs.readFileSync(path.join(a.inDir, f), 'utf8')); fs.rmSync(path.join(a.inDir, f));
      const res = j.op === 'run' ? { ok: true, result: { code: 0, output: 'hi\r\n', ms: 5 } } : j.op === 'bad' ? { ok: false, error: 'nope' } : { ok: true, result: { pong: true } };
      fs.writeFileSync(path.join(a.outDir, j.id + '.tmp'), '\uFEFF' + JSON.stringify(res)); fs.renameSync(path.join(a.outDir, j.id + '.tmp'), path.join(a.outDir, j.id + '.json'));
    }
  }, 30);
  try {
    const hb = await a.waitReady(3000); assert.strictEqual(hb.width, 1920);
    assert.deepStrictEqual((await a.send('ping')).result, { pong: true });
    assert.strictEqual((await a.send('run', { command: 'echo hi' })).result.output, 'hi\r\n');
    await assert.rejects(a.send('bad'), /nope/);
  } finally { clearInterval(stop); }
  const ps = fs.readFileSync(path.join(__dirname, '..', 'src', 'assets', 'bench-agent.ps1'), 'utf8');
  for (const op of ['screenshot', 'click', 'drag', 'scroll', 'type', 'key', 'run', 'launch', 'install', 'windows', 'copyout', 'shutdown']) assert.ok(ps.includes(`'${op}'`), `agent handles ${op}`);
});

test('store: collections and refusing to delete outside Bench’s folders', () => {
  const { Collection, safeRemove } = require('../src/core/store');
  const dir = tmp(); const c = new Collection(path.join(dir, 'x.json'));
  c.add({ id: 'a', n: 1 }); c.update('a', { n: 2 });
  assert.strictEqual(new Collection(path.join(dir, 'x.json')).get('a').n, 2);
  assert.throws(() => safeRemove(os.homedir(), [dir]), /won’t delete/);
  fs.mkdirSync(path.join(dir, 'sub')); safeRemove(path.join(dir, 'sub'), [dir]); assert.ok(!fs.existsSync(path.join(dir, 'sub')));
});

test('findings: file, number, copy as Markdown, close', () => {
  const { Findings } = require('../src/core/findings');
  const f = new Findings(tmp());
  const a = f.add({ title: 'Save does nothing', app: 'Lumen', version: '1.2.0', steps: '1. Open Lumen\n2. Press Cmd+S', expected: 'Saved', actual: 'Nothing', screenshots: [{ buffer: Buffer.from('x'), mime: 'image/png' }], logs: '[error] boom\n[info] ok' });
  const b = f.add({ title: 'Second', severity: 'low' });
  assert.strictEqual(a.number, 1); assert.strictEqual(b.number, 2); assert.deepStrictEqual(a.steps, ['Open Lumen', 'Press Cmd+S']);
  const md = f.markdown(a.id); assert.ok(md.includes('## Save does nothing') && md.includes('1. Open Lumen') && md.includes('[error] boom') && md.includes('Lumen 1.2.0'));
  f.update('1', { status: 'fixed' }); assert.strictEqual(f.list({ status: 'open' }).length, 1);
  assert.throws(() => f.add({ title: ' ' }));
});

function fakePackage() {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'suite.json'), JSON.stringify({ apps: [{ id: 'alpha', name: 'Alpha', description: 'A' }, { id: 'beta', name: 'Beta' }, { id: 'hub', name: 'Utility Hub', role: 'hub' }] }));
  const mk = (id, withElectron, scripts) => {
    const d = path.join(root, 'apps', id); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: id, productName: id[0].toUpperCase() + id.slice(1), version: '1.0.0', scripts }));
    if (withElectron) { const e = path.join(d, 'node_modules', 'electron'); fs.mkdirSync(path.join(e, 'dist'), { recursive: true }); fs.writeFileSync(path.join(e, 'path.txt'), 'electron'); fs.writeFileSync(path.join(e, 'dist', 'electron'), ''); fs.writeFileSync(path.join(e, 'package.json'), '{"version":"44.7.0"}'); }
  };
  mk('alpha', true, { test: 'node -e "console.log(\'5 passed\')"' }); mk('beta', false, { test: 'node -e "console.error(\'FAIL one\');process.exit(1)"' }); mk('hub', true, {});
  return root;
}
test('apps: Utility Package sources and how to start them', () => {
  const apps = require('../src/core/apps');
  const root = fakePackage();
  assert.strictEqual(apps.packageDir(root), root);
  const p = apps.projects(root); assert.deepStrictEqual(p.map((x) => x.id), ['alpha', 'beta', 'hub']);
  assert.strictEqual(p[0].electron, '44.7.0'); assert.strictEqual(p[1].electron, null);
  const a = apps.resolveLaunch({ project: 'alpha' }, { pkgDir: root }); assert.strictEqual(a.kind, 'electron'); assert.ok(a.exec.endsWith(path.join('dist', 'electron'))); assert.strictEqual(a.args[0], path.join(root, 'apps', 'alpha'));
  assert.ok(apps.resolveLaunch({ project: 'beta' }, { pkgDir: root }).needsInstall);
  const viaApp = apps.resolveLaunch({ app: 'Alpha' }, { pkgDir: root }); assert.ok(viaApp.note && viaApp.note.includes('from its source'));
  assert.throws(() => apps.resolveLaunch({ project: 'nope' }, { pkgDir: root }), /No app source/);
});

test('runs: smoke-test app picking and test runs side by side', async () => {
  const { Runs } = require('../src/core/runs');
  const root = fakePackage(); const data = tmp();
  const r = new Runs({ dataDir: data, ctx: { pkgDir: () => root, limits: () => ({ apps: 2, tests: 2 }), installDeps: async () => {} } });
  const picked = r.pickApps('all', 'projects'); assert.deepStrictEqual(picked.map((x) => x.id), ['alpha', 'beta']);
  assert.deepStrictEqual(r.pickApps(['beta', 'zeta'], 'projects').map((x) => [x.id, x.source]), [['beta', 'project'], ['zeta', 'missing']]);
  fs.mkdirSync(path.join(root, 'apps', 'beta', 'node_modules'), { recursive: true });
  const run = await r.tests({ projects: 'all' }); await run.promise;
  const got = r.get(run.id);
  assert.strictEqual(got.state, 'done');
  assert.deepStrictEqual(got.items.map((i) => [i.id, i.status]), [['alpha', 'pass'], ['beta', 'fail']]);
  assert.ok(got.items[0].summary.includes('5 passed')); assert.ok(got.items[1].errors.some((e) => e.includes('FAIL one')));
});

test('inspect output reads well', () => {
  const { formatSnapshot } = require('../src/core/page-scripts');
  const t = formatSnapshot({ title: 'Lumen', url: 'file:///x/index.html', width: 1200, height: 800, scrollY: 0, scrollH: 800, headings: ['Campaigns'], dialogs: [], alerts: ['Saved'], items: [{ ref: 'e1', role: 'button', name: 'New campaign', x: 10, y: 20 }, { ref: 'e2', role: 'textbox', name: 'Search', value: 'abc', focused: true, x: 30, y: 40 }, { ref: 'e3', role: 'checkbox', name: 'Paused', checked: false, x: 1, y: 2, off: true }] }, { id: 1 });
  assert.ok(t.includes('e1 button “New campaign” at 10,20') && t.includes('value=“abc”') && t.includes('[focused]') && t.includes('(off-screen, 1,2)') && t.includes('Messages on screen: “Saved”'));
});

test('MCP server: handshake, tool list, and calls forwarded to Bench’s bridge', async () => {
  const { TOOLS, INSTRUCTIONS } = require('../mcp/tools');
  assert.ok(INSTRUCTIONS.length > 200);
  const names = new Set();
  for (const t of TOOLS) { assert.ok(t.name && t.description && t.inputSchema && t.inputSchema.type === 'object', t.name); assert.ok(!names.has(t.name)); names.add(t.name); for (const r of t.inputSchema.required || []) assert.ok(t.inputSchema.properties[r], `${t.name}.${r}`); }
  const { makeHandlers } = require('../src/mcp-handlers');
  // every tool has a handler
  const h = makeHandlers({ desks: { find: () => null }, runs: {}, findings: {} });
  for (const t of TOOLS) { const r = await h(t.name, {}); assert.ok(!(r.content[0].text || '').startsWith('Error: Unknown tool'), t.name); }
  const dir = tmp(); const token = 'tok';
  const seen = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { seen.push([req.url, req.headers.authorization, JSON.parse(b)]); res.end(JSON.stringify(req.url === '/call' ? { content: [{ type: 'text', text: 'ok ' + JSON.parse(b).name }] } : { ok: true })); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  fs.writeFileSync(path.join(dir, 'bridge.json'), JSON.stringify({ port: srv.address().port, token, pid: process.pid }));
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'bench-mcp.js')], { env: { ...process.env, BENCH_BRIDGE: path.join(dir, 'bridge.json') }, stdio: ['pipe', 'pipe', 'ignore'] });
  const replies = []; let buf = '';
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { replies.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (m) => p.stdin.write(JSON.stringify(m) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code' } } });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bench_overview', arguments: {} } });
  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } });
  const t0 = Date.now(); while (replies.length < 4 && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 30));
  p.kill(); srv.close();
  const by = Object.fromEntries(replies.map((r) => [r.id, r]));
  assert.strictEqual(by[1].result.serverInfo.name, 'bench'); assert.strictEqual(by[2].result.tools.length, TOOLS.length);
  assert.strictEqual(by[3].result.content[0].text, 'ok bench_overview'); assert.ok(by[4].error);
  const call = seen.find((s) => s[0] === '/call'); assert.strictEqual(call[1], 'Bearer tok'); assert.strictEqual(call[2].client, 'claude-code');
});

(async () => {
  let failed = 0; const only = process.argv[2];
  for (const t of tests) {
    if (only && !t.name.toLowerCase().includes(only.toLowerCase())) continue;
    const t0 = Date.now();
    try { await t.fn(); console.log(`  ✓ ${t.name} (${Date.now() - t0} ms)`); }
    catch (e) { failed++; console.log(`  ✗ ${t.name}\n    ${(e.stack || e.message).split('\n').slice(0, 6).join('\n    ')}`); }
  }
  console.log(failed ? `\n${failed} failed` : `\nAll ${tests.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
