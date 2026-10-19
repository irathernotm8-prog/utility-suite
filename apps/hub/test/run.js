'use strict';
// Logic tests that run anywhere (the install steps use the Linux code path).
//   node test/run.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { compareVersions } = require('../lib/sys');
const { Library } = require('../lib/library');
const { Apps } = require('../lib/apps');
const { Sources } = require('../lib/sources');
const { archCompatible, compatibility } = require('../lib/catalog');
const { parseCommand, nameRe } = require('../lib/legacy-win');
const { Feed } = require('../lib/feed');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hubtest-'));
const home = path.join(tmp, 'home');
const userData = path.join(tmp, 'userData');
fs.mkdirSync(path.join(home, 'Downloads'), { recursive: true });
fs.mkdirSync(path.join(home, 'Desktop'), { recursive: true });
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };

// Build a suite folder like `./utility suite` makes: <root>/Packages/{catalog.json, *.zip, icons/}
function makeSuite(root, suiteVersion, apps, { platform = 'linux', hub } = {}) {
  const pk = path.join(root, 'Packages');
  fs.mkdirSync(path.join(pk, 'icons'), { recursive: true });
  const entries = apps.map((a) => {
    const stage = fs.mkdtempSync(path.join(tmp, 'stage-'));
    fs.mkdirSync(path.join(stage, a.name));
    fs.writeFileSync(path.join(stage, a.name, a.name), `#!/bin/sh\necho ${a.name} ${a.version}\n`);
    fs.writeFileSync(path.join(stage, a.name, 'VERSION'), a.version);
    const file = `${a.id}-${a.version}-${platform}-x64.zip`;
    execFileSync('zip', ['-qry', path.join(pk, file), a.name], { cwd: stage });
    const buf = fs.readFileSync(path.join(pk, file));
    fs.writeFileSync(path.join(pk, 'icons', `${a.id}.png`), 'png');
    return { id: a.id, name: a.name, version: a.version, arch: a.arch || 'x64', description: `${a.name} app`, appId: `com.test.${a.id}`,
      file, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length, icon: `icons/${a.id}.png`, folder: a.name, exe: a.name, notes: a.notes || [] };
  });
  fs.writeFileSync(path.join(pk, 'catalog.json'), JSON.stringify({ format: 1, suiteName: 'Utility Suite', suiteVersion, platform, publisher: 'Bilal', apps: entries, ...(hub ? { hub } : {}) }, null, 2));
  return root;
}

(async () => {
  console.log('Utility Hub logic tests');

  await test('version comparison', () => {
    assert.strictEqual(compareVersions('1.10.0', '1.9.9'), 1);
    assert.strictEqual(compareVersions('1.0.0', '1.0.0'), 0);
    assert.strictEqual(compareVersions('1.0.0-beta', '1.0.0'), -1);
    assert.strictEqual(compareVersions('2026.10.16-2', '2026.10.16'), 1);
    assert.strictEqual(compareVersions('2026.10.16-3', '2026.10.16-10'), -1);
    assert.strictEqual(compareVersions('2026.10.20', '2026.10.16-5'), 1);
    assert.strictEqual(compareVersions(null, '1.0.0'), -1);
  });

  await test('architecture compatibility', () => {
    assert.ok(archCompatible('universal', 'x64', 'darwin'));
    assert.ok(!archCompatible('arm64', 'x64', 'darwin'));
    assert.ok(archCompatible('x64', 'arm64', 'win32'));
    assert.ok(!compatibility({ platform: 'mac' }, { arch: 'arm64' }, { platform: 'win32', arch: 'x64' }).ok);
  });

  await test('Windows uninstall command parsing and name matching', () => {
    assert.deepStrictEqual(parseCommand('"C:\\P\\Uninstall RO3.exe" /currentuser'), { exe: 'C:\\P\\Uninstall RO3.exe', args: '/currentuser /S' });
    assert.deepStrictEqual(parseCommand('C:\\P q\\Uninstall Datum.exe /S'), { exe: 'C:\\P q\\Uninstall Datum.exe', args: '/S' });
    assert.ok(nameRe('Relay').test('Relay 1.5.0'));
    assert.ok(!nameRe('Relay').test('Relay Messenger'));
  });

  const library = new Library(path.join(userData, 'library'), { platform: 'linux', arch: 'x64' });
  const settings = { desktopShortcuts: true, keepPackages: true, scanDownloads: true, watchFolders: [], dismissed: [] };
  const ctx = { platform: 'linux', home, userData, env: {}, publisher: 'Bilal', settings: () => settings,
    shell: { trashItem: async (p) => fs.rmSync(p, { recursive: true, force: true }), openPath: async () => {}, showItemInFolder: () => {} } };
  const apps = new Apps(ctx, library);
  const sources = new Sources({ ...ctx, downloads: path.join(home, 'Downloads'), desktop: path.join(home, 'Desktop'), hubVersion: '1.0.0' }, library);

  const v1 = makeSuite(path.join(home, 'Downloads', 'Utility-Suite-2026.10.16-linux'), '2026.10.16', [
    { id: 'datum', name: 'Datum', version: '1.5.1' },
    { id: 'ro3', name: 'RO3', version: '1.2.0', notes: ['Faster exports'] },
    { id: 'relay', name: 'Relay', version: '2.0.0', arch: 'arm64' },
  ]);

  await test('finds new packages in Downloads', async () => {
    const found = await sources.scan();
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].suiteVersion, '2026.10.16');
    assert.deepStrictEqual(found[0].news.map((n) => n.id).sort(), ['datum', 'ro3']); // relay is arm64-only
    assert.strictEqual(found[0].apps.find((a) => a.id === 'relay').reason, 'Needs an ARM (arm64) PC');
  });

  await test('imports packages and verifies checksums', async () => {
    const r = await library.importFrom(v1);
    assert.deepStrictEqual(r.imported.map((i) => i.id).sort(), ['datum', 'ro3']);
    assert.ok(library.hasPackage('datum'));
    assert.strictEqual((await sources.scan()).length, 0, 'nothing new after import');
    const again = await library.importFrom(v1);
    assert.strictEqual(again.imported.length, 0);
  });

  await test('rejects a damaged package', async () => {
    const bad = makeSuite(path.join(tmp, 'bad'), '2026.10.17', [{ id: 'datum', name: 'Datum', version: '1.6.0' }]);
    fs.appendFileSync(path.join(bad, 'Packages', 'datum-1.6.0-linux-x64.zip'), 'garbage');
    const r = await library.importFrom(bad);
    assert.strictEqual(r.imported.length, 0);
    assert.strictEqual(r.skipped.find((s) => s.id === 'datum').action, 'damaged');
    assert.strictEqual(library.get('datum').version, '1.5.1');
  });

  await test('installs apps and reports them as installed', async () => {
    const steps = [];
    const res = await apps.install('datum', { onStep: (s) => steps.push(s.step) });
    assert.strictEqual(res.version, '1.5.1');
    assert.ok(fs.existsSync(path.join(res.path, 'Datum')));
    assert.ok(steps.includes('Unpacking'));
    await apps.install('ro3');
    const rows = await apps.rows();
    assert.strictEqual(rows.find((r) => r.id === 'datum').status, 'installed');
    assert.strictEqual(rows.find((r) => r.id === 'ro3').installedVersion, '1.2.0');
  });

  await test('a newer suite shows as an update, and updating replaces the files', async () => {
    makeSuite(path.join(home, 'Desktop', 'Utility-Suite-2026.10.20-linux'), '2026.10.20', [
      { id: 'datum', name: 'Datum', version: '1.6.0', notes: ['Pivot tables'] },
      { id: 'ro3', name: 'RO3', version: '1.2.0' },
      { id: 'fresh-desk', name: 'Fresh Desk', version: '0.3.0' },
    ]);
    const found = await sources.scan();
    assert.strictEqual(found.length, 1);
    assert.deepStrictEqual(found[0].news.map((n) => `${n.id}@${n.version}`).sort(), ['datum@1.6.0', 'fresh-desk@0.3.0']);
    await library.importFrom(found[0].path);
    let rows = await apps.rows();
    const d = rows.find((r) => r.id === 'datum');
    assert.strictEqual(d.status, 'update');
    assert.deepStrictEqual([d.installedVersion, d.availableVersion], ['1.5.1', '1.6.0']);
    assert.deepStrictEqual(d.notes, ['Pivot tables']);
    assert.strictEqual(rows.find((r) => r.id === 'fresh-desk').status, 'available');
    const res = await apps.install('datum');
    assert.strictEqual(res.updatedFrom, '1.5.1');
    assert.strictEqual(fs.readFileSync(path.join(res.path, 'VERSION'), 'utf8'), '1.6.0');
    assert.ok(!fs.readdirSync(path.dirname(res.path)).some((n) => n.includes('.old-')), 'old copy cleaned up');
    rows = await apps.rows();
    assert.strictEqual(rows.find((r) => r.id === 'datum').status, 'installed');
  });

  await test('an older suite is not offered', async () => {
    makeSuite(path.join(home, 'Downloads', 'old'), '2026.10.01', [{ id: 'datum', name: 'Datum', version: '1.0.0' }]);
    const found = await sources.scan();
    assert.ok(!found.some((f) => f.suiteVersion === '2026.10.01'));
  });

  await test('unopened suite downloads are noticed by name', async () => {
    fs.writeFileSync(path.join(home, 'Downloads', 'Utility-Suite-2026.11.01-linux.zip'), 'x');
    fs.writeFileSync(path.join(home, 'Downloads', 'Utility-Suite-2026.10.02-linux.zip'), 'x');
    const found = await sources.scan();
    const z = found.filter((f) => f.unopened).map((f) => f.suiteVersion);
    assert.deepStrictEqual(z, ['2026.11.01']);
  });

  await test('opening a suite zip extracts and finds its packages', async () => {
    const src = makeSuite(path.join(tmp, 'zipme', 'Utility-Suite-2026.11.05-linux'), '2026.11.05', [{ id: 'ro3', name: 'RO3', version: '1.3.0' }]);
    const zip = path.join(home, 'Downloads', 'Utility-Suite-2026.11.05-linux.zip');
    execFileSync('zip', ['-qry', zip, path.basename(src)], { cwd: path.dirname(src) });
    const dir = await sources.open(zip);
    const r = await library.importFrom(dir);
    assert.deepStrictEqual(r.imported.map((i) => `${i.id}@${i.version}`), ['ro3@1.3.0']);
  });

  await test('removing a package keeps the installed app visible', async () => {
    await library.remove('ro3');
    const rows = await apps.rows();
    const r = rows.find((x) => x.id === 'ro3');
    assert.strictEqual(r.status, 'installed');
    assert.strictEqual(r.availableVersion, null);
    await assert.rejects(apps.install('ro3'), /no package/);
  });

  await test('uninstall removes the app but keeps the package', async () => {
    const before = (await apps.rows()).find((r) => r.id === 'datum').path;
    await apps.uninstall('datum');
    assert.ok(!fs.existsSync(before));
    const r = (await apps.rows()).find((x) => x.id === 'datum');
    assert.strictEqual(r.status, 'available');
    assert.strictEqual(r.availableVersion, '1.6.0');
  });

  await test('dismissed sources stay hidden', async () => {
    fs.writeFileSync(path.join(home, 'Downloads', 'Utility-Suite-2026.12.31-linux.zip'), 'x');
    const z = (await sources.scan()).find((f) => f.suiteVersion === '2026.12.31');
    assert.ok(z);
    settings.dismissed.push(z.stamp);
    assert.ok(!(await sources.scan()).some((f) => f.suiteVersion === '2026.12.31'));
  });

  await test('hub update is detected from the catalog', async () => {
    const root = path.join(home, 'Desktop', 'Utility-Suite-2026.12.01-linux');
    fs.mkdirSync(path.join(root, 'Utility Hub'), { recursive: true });
    makeSuite(root, '2026.12.01', [{ id: 'datum', name: 'Datum', version: '1.6.0' }], { hub: { version: '1.1.0', path: '../Utility Hub' } });
    const f = (await sources.scan()).find((x) => x.suiteVersion === '2026.12.01');
    assert.ok(f, 'listed because of the hub update alone');
    assert.strictEqual(f.hubUpdate.version, '1.1.0');
    assert.strictEqual(f.hubUpdate.path, path.join(root, 'Utility Hub'));
  });

  // ── online updates ──
  // a tiny web server stands in for the GitHub release
  const feedDir = path.join(tmp, 'feed');
  fs.mkdirSync(feedDir, { recursive: true });
  const server = http.createServer((req, res) => {
    const f = path.join(feedDir, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(feedDir) || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-length', fs.statSync(f).size);
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(tmp, 'feed.json'), JSON.stringify({ base }));
  const feed = new Feed({ platform: 'linux', arch: 'x64', fetch, settings: () => settings, configFile: path.join(tmp, 'feed.json') });

  // publish like `./utility publish --local`: flat files + catalog-linux.json
  function publishOnline(apps, hubVersion) {
    const src = makeSuite(path.join(tmp, `pub-${Date.now()}-${Math.random()}`), 'online', apps);
    const cat = JSON.parse(fs.readFileSync(path.join(src, 'Packages', 'catalog.json'), 'utf8'));
    for (const a of cat.apps) {
      fs.copyFileSync(path.join(src, 'Packages', a.file), path.join(feedDir, a.file));
      fs.copyFileSync(path.join(src, 'Packages', a.icon), path.join(feedDir, `${a.id}.png`));
      a.icon = `${a.id}.png`;
    }
    const old = fs.existsSync(path.join(feedDir, 'catalog-linux.json')) ? JSON.parse(fs.readFileSync(path.join(feedDir, 'catalog-linux.json'), 'utf8')).apps : [];
    const merged = [...old.filter((o) => !cat.apps.some((a) => a.id === o.id)), ...cat.apps];
    fs.writeFileSync(path.join(feedDir, 'catalog-linux.json'), JSON.stringify({ format: 1, feed: true, platform: 'linux', apps: merged, ...(hubVersion ? { hub: { version: hubVersion, file: 'hub.zip', folder: 'Utility Hub' } } : {}) }));
  }

  await test('online: nothing published yet is not an error', async () => {
    await feed.check();
    assert.strictEqual(feed.error, null);
    assert.strictEqual(feed.entries().size, 0);
  });

  await test('online: a newer published version shows as an update without any download', async () => {
    await apps.install('ro3').catch(() => {}); // ro3 package was deleted earlier; make sure it's installed from a fresh import
    publishOnline([{ id: 'datum', name: 'Datum', version: '1.7.0', notes: ['Online notes'] }, { id: 'slate', name: 'Slate', version: '1.0.1' }, { id: 'relay', name: 'Relay', version: '2.1.0', arch: 'arm64' }]);
    await feed.check();
    assert.strictEqual(feed.error, null);
    apps.remote = feed.entries();
    assert.ok(!apps.remote.has('relay'), 'arm64-only app filtered out on an x64 computer');
    await apps.install('datum'); // reinstall the hub copy (1.6.0)
    const rows = await apps.rows();
    const d = rows.find((r) => r.id === 'datum');
    assert.deepStrictEqual([d.status, d.installedVersion, d.availableVersion, d.online], ['update', '1.6.0', '1.7.0', true]);
    assert.deepStrictEqual(d.notes, ['Online notes']);
    const sl = rows.find((r) => r.id === 'slate');
    assert.deepStrictEqual([sl.status, sl.online], ['available', true]);
    assert.ok(/^http/.test(sl.icon), 'remote icon until downloaded');
  });

  await test('online: updating downloads, verifies and installs just that app', async () => {
    const before = fs.readdirSync(path.join(userData, 'library', 'packages')).sort();
    let fractions = [];
    await library.importRemote(apps.remote.get('datum'), feed, { onProgress: (f) => fractions.push(f) });
    assert.ok(fractions.length && fractions[fractions.length - 1] === 1, 'progress reported');
    const res = await apps.install('datum');
    assert.strictEqual(res.updatedFrom, '1.6.0');
    assert.strictEqual(fs.readFileSync(path.join(res.path, 'VERSION'), 'utf8'), '1.7.0');
    const after = fs.readdirSync(path.join(userData, 'library', 'packages')).sort();
    assert.ok(after.includes('datum-1.7.0-x64.zip') && !after.includes('datum-1.6.0-x64.zip'), 'old package replaced');
    assert.ok(fs.existsSync(path.join(userData, 'library', 'icons', 'datum.png')), 'icon downloaded');
    const d = (await apps.rows()).find((r) => r.id === 'datum');
    assert.deepStrictEqual([d.status, d.online], ['installed', false]);
    assert.ok(!before.includes('slate-1.0.1-x64.zip') && !after.includes('slate-1.0.1-x64.zip'), 'other apps not downloaded');
  });

  await test('online: a damaged download is rejected and nothing changes', async () => {
    publishOnline([{ id: 'datum', name: 'Datum', version: '1.8.0' }]);
    fs.appendFileSync(path.join(feedDir, 'datum-1.8.0-linux-x64.zip'), 'tampered');
    await feed.check(); apps.remote = feed.entries();
    await assert.rejects(library.importRemote(apps.remote.get('datum'), feed), /damaged/);
    assert.strictEqual(library.get('datum').version, '1.7.0');
    assert.ok(!fs.readdirSync(path.join(userData, 'library', 'packages')).some((n) => n.includes('partial')), 'no partial file left');
  });

  await test('online: hub update is offered from the catalog', async () => {
    publishOnline([{ id: 'slate', name: 'Slate', version: '1.0.2' }], '9.9.9');
    await feed.check();
    assert.deepStrictEqual([feed.hub().version, feed.hub().file], ['9.9.9', 'hub.zip']);
  });

  await test('online: offline is reported plainly, and the switch turns checking off', async () => {
    const bad = new Feed({ platform: 'linux', arch: 'x64', fetch, settings: () => ({ ...settings, feedUrl: 'http://127.0.0.1:9/nothing' }), configFile: '/nope' });
    await bad.check();
    assert.strictEqual(bad.error, 'offline');
    const off = new Feed({ platform: 'linux', arch: 'x64', fetch, settings: () => ({ ...settings, onlineUpdates: false }), configFile: path.join(tmp, 'feed.json') });
    assert.strictEqual(off.enabled, false);
  });
  server.close();

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed`);
})().catch((e) => { console.error('\n✗', e); process.exit(1); });
