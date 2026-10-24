// Quick Node checks for Droid's core (no Electron, no real emulator). Run: npm test
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const catalog = require('../src/core/catalog');
const repo = require('../src/core/repo');
const avd = require('../src/core/avd');
const emu = require('../src/core/emulator');
const devices = require('../src/core/devices');
const apk = require('../src/core/apk');
const adb = require('../src/core/adb');
const location = require('../src/core/location');

let n = 0, failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ───────── catalog
test('sizes follow each style', () => {
  assert.deepStrictEqual(catalog.sizeFor('pixel', 1080), { w: 1080, h: 2400 });
  assert.deepStrictEqual(catalog.sizeFor('tablet', 1600), { w: 2560, h: 1600 });
  const g = catalog.sizeFor('galaxy', 1440); assert.strictEqual(g.w, 1440); assert.ok(g.h > 3000);
});
test('density snaps to Android buckets', () => {
  assert.strictEqual(catalog.densityFor(1080, 2400, 6.3), 420);
  assert.strictEqual(catalog.densityFor(2560, 1600, 11), 280);
});
test('Android names', () => {
  assert.strictEqual(catalog.androidName('36'), 'Android 16');
  assert.strictEqual(catalog.androidName('36.1'), 'Android 16 (36.1)');
  assert.strictEqual(catalog.androidName('37.0'), 'Android 17');
  assert.strictEqual(catalog.androidName('32'), 'Android 12L');
});

// ───────── repository manifests
const REPO = `<sdk:sdk-repository><license id="android-sdk-license" type="text">Terms &amp; conditions</license>
<channel id="channel-0">stable</channel><channel id="channel-2">dev</channel>
<remotePackage path="emulator"><revision><major>37</major><minor>3</minor><micro>5</micro></revision><display-name>Android Emulator</display-name><uses-license ref="android-sdk-license"/><channelRef ref="channel-2"/><archives>
 <archive><complete><size>10</size><checksum type="sha1">aa</checksum><url>emulator-darwin_aarch64-NEW.zip</url></complete><host-os>macosx</host-os><host-arch>aarch64</host-arch></archive></archives></remotePackage>
<remotePackage path="emulator"><revision><major>37</major><minor>2</minor><micro>12</micro></revision><display-name>Android Emulator</display-name><uses-license ref="android-sdk-license"/><channelRef ref="channel-0"/><archives>
 <archive><complete><size>11</size><checksum type="sha1">bb</checksum><url>emulator-darwin_aarch64-1.zip</url></complete><host-os>macosx</host-os><host-arch>aarch64</host-arch></archive>
 <archive><complete><size>12</size><checksum type="sha1">cc</checksum><url>emulator-windows_x64-1.zip</url></complete><host-os>windows</host-os><host-arch>x64</host-arch></archive></archives></remotePackage>
<remotePackage path="platform-tools"><revision><major>37</major><minor>0</minor><micro>1</micro></revision><channelRef ref="channel-0"/><archives>
 <archive><complete><size>5</size><checksum type="sha1">dd</checksum><url>platform-tools_r37.0.1-darwin.zip</url></complete><host-os>macosx</host-os></archive>
 <archive><complete><size>6</size><checksum type="sha1">ee</checksum><url>platform-tools_r37.0.1-win.zip</url></complete><host-os>windows</host-os></archive></archives></remotePackage>
</sdk:sdk-repository>`;
const img = (p, api, tag, abi, extra = '', url = 'x.zip', hostOs = '') => `<remotePackage path="${p}"><type-details><api-level>${api}</api-level>${extra}<tag><id>${tag}</id><display>T</display></tag><abi>${abi}</abi></type-details><revision><major>7</major></revision><display-name>D</display-name><uses-license ref="android-sdk-arm-dbt-license"/><channelRef ref="channel-0"/><archives><archive><complete><size>100</size><checksum type="sha1">ff</checksum><url>${url}</url></complete>${hostOs ? `<host-os>${hostOs}</host-os>` : ''}</archive></archives></remotePackage>`;
const PLAY = `<x><channel id="channel-0">stable</channel>
${img('system-images;android-36;google_apis_playstore;arm64-v8a', 36, 'google_apis_playstore', 'arm64-v8a')}
${img('system-images;android-36;google_apis_playstore;x86_64', 36, 'google_apis_playstore', 'x86_64')}
${img('system-images;android-37.2;google_apis_playstore_ps16k;arm64-v8a', '37.2', 'google_apis_playstore_ps16k', 'arm64-v8a')}
${img('system-images;android-CANARY;google_apis_playstore;arm64-v8a', '37.1', 'google_apis_playstore', 'arm64-v8a', '<codename>CANARY</codename>')}
${img('system-images;android-35-ext15;google_apis_playstore;arm64-v8a', '35x', 'google_apis_playstore', 'arm64-v8a', '<extension-level>15</extension-level>')}
${img('system-images;android-30;google_apis_playstore;arm64-v8a', 30, 'google_apis_playstore', 'arm64-v8a', '', 'a-darwin.zip', 'macosx')}
${img('system-images;android-30;google_apis_playstore;arm64-v8a', 30, 'google_apis_playstore', 'arm64-v8a', '', 'a-linux.zip', 'linux')}
</x>`;
const mac = repo.hostOf('darwin', 'arm64'), win = repo.hostOf('win32', 'x64');
test('host maps to the right system image processor', () => { assert.strictEqual(mac.abi, 'arm64-v8a'); assert.strictEqual(win.abi, 'x86_64'); });
test('picks the newest stable emulator for each computer', () => {
  const m = repo.latestTool(REPO, 'emulator', mac);
  assert.strictEqual(m.version, '37.2.12'); assert.ok(m.url.endsWith('emulator-darwin_aarch64-1.zip')); assert.strictEqual(m.sha1, 'bb');
  assert.ok(repo.latestTool(REPO, 'emulator', win).url.endsWith('windows_x64-1.zip'));
  assert.ok(repo.latestTool(REPO, 'platform-tools', win).url.endsWith('-win.zip'));
  assert.strictEqual(repo.parseLicenses(REPO)['android-sdk-license'], 'Terms & conditions');
});
test('stable images hide previews, 16 KB and extension builds; per-host archives', () => {
  const list = repo.systemImages({ google_apis_playstore: PLAY }, mac);
  assert.deepStrictEqual(list.map((i) => i.path), ['system-images;android-36;google_apis_playstore;arm64-v8a', 'system-images;android-30;google_apis_playstore;arm64-v8a']);
  assert.ok(list[1].url.endsWith('a-darwin.zip'));
  assert.ok(list[0].url.startsWith('https://dl.google.com/android/repository/sys-img/google_apis_playstore/'));
  assert.strictEqual(repo.systemImages({ google_apis_playstore: PLAY }, win).length, 1);
  assert.ok(repo.systemImages({ google_apis_playstore: PLAY }, mac, { stable: false }).length >= 4);
  assert.strictEqual(repo.recommended(list).path, 'system-images;android-36;google_apis_playstore;arm64-v8a');
});

// ───────── devices + AVD
const host = { ramMB: 16384, cores: 8 };
const IMG = { path: 'system-images;android-36;google_apis_playstore;arm64-v8a', api: '36', tag: 'google_apis_playstore', tagName: 'Google Play', abi: 'arm64-v8a', name: 'Android 16' };
test('device records are normalized and capped to the computer', () => {
  const d = devices.normalize({ style: 'nope', image: IMG, ramMB: 999999, cores: 64, storageGB: 3, network: { mode: 'proxy' } }, host);
  assert.strictEqual(d.style, 'pixel'); assert.strictEqual(d.ramMB, 16384); assert.strictEqual(d.cores, 8); assert.strictEqual(d.storageGB, 8);
  assert.strictEqual(d.network.mode, 'internet', 'proxy without an address falls back');
  assert.deepStrictEqual([d.screen.w, d.screen.h, d.screen.dpi], [1080, 2400, 420]);
  assert.throws(() => devices.normalize({ style: 'pixel' }, host), /Android version/);
});
test('device store: create, update, duplicate, remove', () => {
  const f = path.join(os.tmpdir(), `droid-test-${process.pid}.json`);
  const st = new devices.DeviceStore(f, host);
  const a = st.create({ name: 'A', image: IMG, location: { mode: 'manual', lat: 10, lng: 20 } });
  const b = st.duplicate(a.id);
  assert.strictEqual(b.name, 'A copy');
  const u = st.update(a.id, { ramMB: 8192, location: { motion: 'walk' } });
  assert.strictEqual(u.ramMB, 8192); assert.strictEqual(u.location.lat, 10); assert.strictEqual(u.location.motion, 'walk');
  st.remove(b.id);
  assert.strictEqual(new devices.DeviceStore(f, host).all().length, 1);
  fs.rmSync(f, { force: true });
});
test('AVD config carries every hardware choice', () => {
  const d = devices.normalize({ id: 'abc', name: 'My Phone', style: 'galaxy', image: IMG, screen: { w: 1440, h: 3120, dpi: 500 }, ramMB: 8192, cores: 6, storageGB: 128 }, host);
  const ini = avd.configIni(d);
  for (const line of ['hw.lcd.width=1440', 'hw.lcd.height=3120', 'hw.lcd.density=500', 'hw.ramSize=8192', 'hw.cpu.ncore=6', 'disk.dataPartition.size=128G', 'PlayStore.enabled=true', 'image.sysdir.1=system-images/android-36/google_apis_playstore/arm64-v8a/', 'hw.cpu.arch=arm64', 'avd.ini.displayname=My Phone', 'hw.keyboard=yes'])
    assert.ok(ini.includes(line + '\n'), `missing ${line}`);
  const t = devices.normalize({ id: 't', style: 'tablet', image: { ...IMG, abi: 'x86_64', tag: 'default' } }, host);
  assert.ok(avd.configIni(t).includes('hw.initialOrientation=landscape'));
  assert.ok(avd.configIni(t).includes('hw.cpu.arch=x86_64'));
});
test('writing an AVD keeps lines the emulator added', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'droid-avd-'));
  const d = devices.normalize({ id: 'k1', name: 'K', image: IMG }, host);
  const { dir: avdPath } = avd.writeAvd(dir, d);
  fs.appendFileSync(path.join(avdPath, 'config.ini'), 'firstboot.saved=yes\n');
  avd.writeAvd(dir, { ...d, ramMB: 6144 });
  const cfg = fs.readFileSync(path.join(avdPath, 'config.ini'), 'utf8');
  assert.ok(cfg.includes('hw.ramSize=6144')); assert.ok(cfg.includes('firstboot.saved=yes')); assert.ok(!cfg.includes('hw.ramSize=4096'));
  assert.ok(fs.readFileSync(path.join(dir, 'droid_k1.ini'), 'utf8').includes(`path=${avdPath}`));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ───────── emulator command line
test('network and boot choices become emulator flags', () => {
  const base = devices.normalize({ id: 'z', image: IMG }, host);
  const a = emu.buildArgs(base, { port: 5556, grpcPort: 8555 });
  assert.deepStrictEqual(a.slice(0, 7), ['-avd', 'droid_z', '-port', '5556', '-grpc', '8555', '-grpc-use-token']);
  assert.ok(a.includes('-qt-hide-window'));
  const iso = emu.buildArgs({ ...base, network: { mode: 'isolated' } }, { port: 1, grpcPort: 2 });
  assert.ok(iso.join(' ').includes('-wifi-user-mode-options restrict=on'));
  const px = emu.buildArgs({ ...base, network: { mode: 'proxy', proxy: 'user:pw@10.0.0.2:3128' } }, { port: 1, grpcPort: 2 });
  assert.strictEqual(px[px.indexOf('-http-proxy') + 1], 'http://user:pw@10.0.0.2:3128');
  const cold = emu.buildArgs({ ...base, options: { ...base.options, quickBoot: false, audio: false } }, { port: 1, grpcPort: 2, wipe: true, window: 'none' });
  for (const f of ['-no-snapshot-load', '-no-snapshot-save', '-no-audio', '-wipe-data', '-no-window']) assert.ok(cold.includes(f), f);
});
test('emulator errors are explained in plain words', () => {
  assert.match(emu.explainFailure('ERROR | x86_64 emulation currently requires hardware acceleration!', 'win32'), /Windows Hypervisor Platform/);
  assert.match(emu.explainFailure('ERROR | Not enough space to create userdata partition'), /disk is full/);
  assert.strictEqual(emu.explainFailure('all good'), null);
});
test('discovery files are matched by console port', () => {
  const ini = emu.parseIni('grpc.port=8554\ngrpc.token=abc==\nport.serial=5554\n');
  assert.deepStrictEqual([ini['grpc.port'], ini['grpc.token'], ini['port.serial']], ['8554', 'abc==', '5554']);
});

test('stale discovery files from dead emulators are ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'droid-disc-'));
  const stale = path.join(dir, 'pid_999999.ini');                // no such process
  fs.writeFileSync(stale, 'port.serial=5998\ngrpc.token=OLD\n');
  assert.strictEqual(emu.findDiscovery(5998, stale, 0), null);
  const live = path.join(dir, `pid_${process.pid}.ini`);
  fs.writeFileSync(live, 'port.serial=5998\ngrpc.token=NEW\n');
  assert.strictEqual(emu.findDiscovery(5998, live, Date.now() - 1000)['grpc.token'], 'NEW');
  assert.strictEqual(emu.findDiscovery(5998, live, Date.now() + 60000), null, 'older than this start');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ───────── touch mapping (verified against a real emulator: rotated frames, natural-orientation touches)
test('screen points map back to the panel in every rotation', () => {
  global.window = {}; global.document = {};
  require('../src/renderer/frames.js');
  const { toDevice, layoutFrame } = global.window.Frames;
  const W = 540, H = 1200;
  assert.deepStrictEqual(toDevice(0.25, 0.5, 'PORTRAIT', W, H), { x: 135, y: 600 });
  // LANDSCAPE frame is H wide, W tall; the real emulator opened the icon at (W - ry, rx)
  const rx = 1027, ry = 164; const p = toDevice(rx / H, ry / W, 'LANDSCAPE', W, H);
  assert.deepStrictEqual([Math.round(p.x), Math.round(p.y)], [W - ry, rx]);
  const q = toDevice(0, 0, 'REVERSE_PORTRAIT', W, H); assert.deepStrictEqual(q, { x: W, y: H });
  const L1 = layoutFrame('pixel', 1080, 2400, 'PORTRAIT', { w: 400, h: 800 });
  const L2 = layoutFrame('pixel', 1080, 2400, 'LANDSCAPE', { w: 800, h: 400 });
  assert.ok(L1.screen.h > L1.screen.w && L2.screen.w > L2.screen.h);
});

// ───────── adb output
test('device folder listings are parsed (toybox ls)', () => {
  const out = `total 40\ndrwxrwx--x 2 root sdcard_rw 3488 2025-03-01 12:34 Download\n-rw-rw---- 1 u0_a1 sdcard_rw 12345 2025-03-02 09:00 my photo.jpg\nlrwxrwxrwx 1 root root 21 2025-01-01 00:00 sdcard -> /storage/self/primary\n`;
  const l = adb.parseLs(out, '/sdcard/');
  assert.deepStrictEqual(l.map((i) => [i.name, i.dir, i.size]), [['Download', true, 3488], ['sdcard', true, 21], ['my photo.jpg', false, 12345]]);
  assert.strictEqual(l[2].path, '/sdcard/my photo.jpg');
});
test('install failures are explained', () => {
  assert.match(adb.explainInstall('INSTALL_FAILED_NO_MATCHING_ABIS: Failed to extract native libraries'), /different processor/);
  assert.match(adb.explainInstall('INSTALL_FAILED_MISSING_SPLIT'), /several pieces/);
  assert.strictEqual(adb.q("it's"), `'it'\\''s'`);
});

// ───────── app files
function makeZip(entries) {   // entries: [{ name, data, store }]
  const locals = [], centrals = []; let off = 0;
  for (const e of entries) {
    const raw = Buffer.from(e.data); const comp = e.store ? raw : zlib.deflateRawSync(raw);
    const name = Buffer.from(e.name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(e.store ? 0 : 8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(e.store ? 0 : 8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    centrals.push(ch, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
// a tiny binary AndroidManifest.xml with package + versionName + uses-sdk
function makeManifest(pkg, ver) {
  const strings = ['manifest', 'package', 'versionName', 'versionCode', 'uses-sdk', 'minSdkVersion', pkg, ver];
  const pool = Buffer.concat(strings.map((s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([Buffer.from([s.length, b.length]), b, Buffer.from([0])]); }));
  const pad = (4 - (pool.length % 4)) % 4;
  const hdr = 28, offs = Buffer.alloc(strings.length * 4); let o = 0;
  strings.forEach((s, i) => { offs.writeUInt32LE(o, i * 4); o += Buffer.byteLength(s) + 3; });
  const sp = Buffer.alloc(hdr); const spSize = hdr + offs.length + pool.length + pad;
  sp.writeUInt16LE(1, 0); sp.writeUInt16LE(hdr, 2); sp.writeUInt32LE(spSize, 4); sp.writeUInt32LE(strings.length, 8); sp.writeUInt32LE(0x100, 16); sp.writeUInt32LE(hdr + offs.length, 20);
  const el = (tag, attrs) => { const b = Buffer.alloc(36 + attrs.length * 20); b.writeUInt16LE(0x0102, 0); b.writeUInt16LE(16, 2); b.writeUInt32LE(b.length, 4); b.writeUInt32LE(0xffffffff, 16); b.writeUInt32LE(tag, 20); b.writeUInt16LE(20, 24); b.writeUInt16LE(20, 26); b.writeUInt16LE(attrs.length, 28);
    attrs.forEach(([name, raw, type, data], i) => { const a = 36 + i * 20; b.writeUInt32LE(0xffffffff, a); b.writeUInt32LE(name, a + 4); b.writeUInt32LE(raw, a + 8); b.writeUInt16LE(8, a + 12); b[a + 15] = type; b.writeUInt32LE(data, a + 16); }); return b; };
  const body = Buffer.concat([Buffer.concat([sp, offs, pool, Buffer.alloc(pad)]), el(0, [[1, 6, 3, 6], [2, 7, 3, 7], [3, 0xffffffff, 0x10, 42]]), el(4, [[5, 0xffffffff, 0x10, 24]])]);
  const head = Buffer.alloc(8); head.writeUInt16LE(3, 0); head.writeUInt16LE(8, 2); head.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}
test('reads package and version from an APK', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'droid-apk-'));
  const f = path.join(dir, 'app.apk');
  fs.writeFileSync(f, makeZip([{ name: 'AndroidManifest.xml', data: makeManifest('com.example.hello', '1.2.3') }, { name: 'lib/arm64-v8a/libx.so', data: 'x' }, { name: 'classes.dex', data: 'dex', store: true }]));
  const i = apk.inspect(f);
  assert.deepStrictEqual([i.kind, i.package, i.versionName, i.versionCode, i.minSdk], ['apk', 'com.example.hello', '1.2.3', 42, 24]);
  assert.deepStrictEqual(i.abis, ['arm64-v8a']);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('opens XAPK/APKM bundles and drops splits for other processors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'droid-xapk-'));
  const base = makeZip([{ name: 'AndroidManifest.xml', data: makeManifest('com.game.x', '9.0') }]);
  const f = path.join(dir, 'game.xapk');
  fs.writeFileSync(f, makeZip([
    { name: 'manifest.json', data: JSON.stringify({ package_name: 'com.game.x', name: 'Game X', version_name: '9.0' }) },
    { name: 'base.apk', data: base, store: true }, { name: 'config.arm64_v8a.apk', data: base, store: true }, { name: 'config.x86_64.apk', data: base, store: true }, { name: 'config.en.apk', data: base, store: true },
    { name: 'Android/obb/com.game.x/main.1.com.game.x.obb', data: 'OBBDATA' },
  ]));
  const i = apk.inspect(f);
  assert.deepStrictEqual([i.kind, i.package, i.label, i.splits.length, i.obb.length], ['bundle', 'com.game.x', 'Game X', 4, 1]);
  const out = await apk.unpackBundle(f, path.join(dir, 'u'), { abi: 'arm64-v8a' });
  assert.deepStrictEqual(out.apks.map((p) => path.basename(p)).sort(), ['base.apk', 'config.arm64_v8a.apk', 'config.en.apk']);
  assert.strictEqual(out.obb[0].remote, '/sdcard/Android/obb/com.game.x/main.1.com.game.x.obb');
  assert.strictEqual(fs.readFileSync(out.obb[0].local, 'utf8'), 'OBBDATA');
  const m = apk.inspect(path.join(dir, 'u', 'base.apk')); assert.strictEqual(m.package, 'com.game.x');
  fs.rmSync(dir, { recursive: true, force: true });
});
test('real APK from F-Droid parses (when present)', () => {
  const f = '/tmp/claude-0/files.apk';
  if (!fs.existsSync(f)) return;
  const i = apk.inspect(f);
  assert.strictEqual(i.package, 'me.zhanghai.android.files');
});

// ───────── location
test('simulated movement loops around the city', () => {
  const c = { lat: 29.76, lng: -95.37 };
  const still = location.mover(c, 'still')(100); assert.deepStrictEqual([still.lat, still.lng, still.speed], [29.76, -95.37, 0]);
  const walk = location.mover(c, 'walk');
  const a = walk(0), b = walk(60);
  const dist = Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos(c.lat * Math.PI / 180));
  assert.ok(dist > 40 && dist < 120, `walked ${dist} m in a minute`);
  assert.ok(Math.abs(walk(0).lat - c.lat) < 0.01);
});

// ───────── full lifecycle against the pretend emulator (gRPC + discovery + adb + stop)
test('runner: start, boot, stream, install, stop (demo emulator)', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'droid-home-'));
  const avdHome = path.join(home, 'avd');
  const prevHome = process.env.HOME;
  process.env.HOME = home;    // discovery files go under ~/.android
  const realHomedir = os.homedir; os.homedir = () => home;
  try {
    const d = devices.normalize({ id: 'demo1', name: 'Demo', image: IMG, screen: { w: 540, h: 1200, dpi: 240 } }, host);
    avd.writeAvd(avdHome, d);
    const env = { ...process.env, HOME: home, ANDROID_AVD_HOME: avdHome, DROID_DEMO_BOOT_MS: '400' };
    const sdk = { root: home, emulatorBin: process.execPath, protoDir: null, emulatorCmd: () => ({ cmd: process.execPath, pre: [path.join(__dirname, '..', 'src', 'demo', 'fake-emulator.js')], env: { HOME: home, ANDROID_AVD_HOME: avdHome, DROID_DEMO_BOOT_MS: '400' }, cwd: home }) };
    const a = new adb.Adb(process.execPath, env, [path.join(__dirname, '..', 'src', 'demo', 'fake-adb.js')]);
    const runner = new emu.Runner({ sdk, avdHome, adb: a, settings: () => ({}) });
    const states = [];
    runner.on('state', (s) => states.push(s.state));
    const booted = new Promise((r) => runner.once('booted', r));
    await runner.start(d);
    await Promise.race([booted, new Promise((_, rej) => setTimeout(() => rej(new Error('boot timeout')), 20000))]);
    assert.deepStrictEqual(states.slice(0, 3), ['starting', 'booting', 'running']);
    const s = runner.session('demo1');
    const frame = await new Promise((res) => { const h = s.client.streamScreen({ width: 270, height: 600 }, (f) => { if (f.data) { h.cancel(); res(f); } }); });
    assert.deepStrictEqual([frame.width, frame.height, frame.data.length], [270, 600, 270 * 600 * 3]);
    await s.client.setGps({ lat: 1.5, lng: 2.5 });
    await s.client.rotate(90);
    const rot = await new Promise((res) => { const h = s.client.streamScreen({}, (f) => { if (f.data) { h.cancel(); res(f); } }); });
    assert.deepStrictEqual([rot.width, rot.height, rot.rotation], [1200, 540, 'LANDSCAPE']);
    const tmpApk = path.join(home, 'x.apk');
    fs.writeFileSync(tmpApk, makeZip([{ name: 'AndroidManifest.xml', data: makeManifest('com.example.demo', '1') }]));
    await a.install(s.serial, tmpApk);
    assert.deepStrictEqual((await a.packages(s.serial)).map((p) => p.id), ['com.example.demo']);
    const exited = new Promise((r) => runner.once('exit', r));
    await runner.stop('demo1');
    const ex = await exited;
    assert.strictEqual(ex.failed, false); assert.strictEqual(ex.crashed, false);
    assert.strictEqual(runner.session('demo1'), null);
  } finally {
    process.env.HOME = prevHome; os.homedir = realHomedir;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

(async () => {
  for (const [name, fn] of tests) {
    n++;
    try { await fn(); console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}\n      ${e.stack.split('\n').slice(0, 3).join('\n      ')}`); }
  }
  console.log(`\n${n - failed}/${n} passed`);
  process.exit(failed ? 1 : 0);
})();
