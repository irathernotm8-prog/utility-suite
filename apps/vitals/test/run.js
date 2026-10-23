// Node checks for the parsers and grouping (no Electron needed): node test/run.js
const assert = require('assert');
const P = require('../src/sys/parse');
const { reportHtml } = require('../src/report');
const checkup = require('../src/sys/checkup');
const fs = require('fs'); const os = require('os'); const path = require('path');
let n = 0, failed = 0;
const t = (name, fn) => { n++; try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } };

t('vm_stat → Activity Monitor buckets', () => {
  const vm = P.parseVmStat(`Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                3870.
Pages active:                            196842.
Pages inactive:                          193004.
Pages speculative:                         2210.
Pages throttled:                              0.
Pages wired down:                         96651.
Pages purgeable:                           9035.
"Translation faults":                 512413392.
Pages copy-on-write:                   10822035.
Pages zero filled:                    245913009.
Pages reactivated:                      9020245.
Pages purged:                           2402929.
File-backed pages:                       124317.
Anonymous pages:                         267739.
Pages stored in compressor:              318839.
Pages occupied by compressor:            101210.`);
  assert.equal(vm.pageSize, 16384); assert.equal(vm.wired, 96651); assert.equal(vm.compressed, 101210);
  const m = P.macMemory(vm, 8 * 1024 ** 3);
  assert.equal(m.app, (267739 - 9035) * 16384); assert.equal(m.wired, 96651 * 16384);
  assert(m.used > 0 && m.used <= m.total);
});
t('swap usage', () => { const s = P.parseSwapUsage('total = 2048.00M  used = 1023.25M  free = 1024.75M  (encrypted)'); assert.equal(s.total, 2048 * 1048576); assert.equal(Math.round(s.used / 1048576), 1023); });
t('ps on macOS keeps paths with spaces', () => {
  const l = P.parsePsMac(`    1     0   0.0  13456 root             /sbin/launchd
  612     1  12.3 412000 bilal            /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  640   612   3,5  98000 bilal            /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/130/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)`);
  assert.equal(l.length, 3); assert.equal(l[1].name, 'Google Chrome'); assert.equal(l[2].cpu, 3.5); assert.equal(l[1].mem, 412000 * 1024);
  assert.equal(P.macBundleOf(l[2].path), '/Applications/Google Chrome.app');
});
t('top memory column', () => {
  const m = P.parseTopMem(`Processes: 512 total, 3 running, 509 sleeping, 2311 threads
Load Avg: 2.10, 2.20, 2.31

PID    MEM
612    1203M+
640    85M
99     980K-
3      2G`);
  assert.equal(m.get(612), 1203 * 1048576); assert.equal(m.get(99), 980 * 1024); assert.equal(m.get(3), 2 * 1024 ** 3);
});
t('lsappinfo list', () => {
  const m = P.parseLsappinfo(`  1) "loginwindow" ASN:0x0-0x1001:
    bundleID="com.apple.loginwindow"
    bundle path="/System/Library/CoreServices/loginwindow.app"
    executable path="/System/Library/CoreServices/loginwindow.app/Contents/MacOS/loginwindow"
    pid = 403 type="UIElement" flavor=3 Version="9.0" fileType="APPL" creator="lgnw" Arch=ARM64
  2) "Google Chrome" ASN:0x0-0x2e02e:
    bundleID="com.google.Chrome"
    bundle path="/Applications/Google Chrome.app"
    pid = 612 type="Foreground" flavor=3 Version="130.0" fileType="APPL" creator="rimZ" Arch=ARM64`);
  assert.equal(m.get(612).type, 'Foreground'); assert.equal(m.get(612).bundleId, 'com.google.Chrome'); assert.equal(m.get(403).type, 'UIElement');
});
t('lsappinfo front app', () => {
  const a = P.parseLsappFront(`"LSDisplayName"="Visual Studio Code"\n"CFBundleIdentifier"="com.microsoft.VSCode"\n"LSBundlePath"="/Applications/Visual Studio Code.app"\n"pid"=7781`);
  assert.equal(a.name, 'Visual Studio Code'); assert.equal(a.pid, 7781); assert.equal(a.bundleId, 'com.microsoft.VSCode'); assert.equal(a.path, '/Applications/Visual Studio Code.app');
});
t('grouping puts helpers under their app and labels kinds', () => {
  const procs = [
    { pid: 1, ppid: 0, name: 'launchd', path: '/sbin/launchd', cpu: 0, mem: 1e6, user: 'root' },
    { pid: 612, ppid: 1, name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', cpu: 10, mem: 4e8, user: 'bilal' },
    { pid: 640, ppid: 612, name: 'Google Chrome Helper (Renderer)', path: '/Applications/Google Chrome.app/Contents/Frameworks/X.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)', cpu: 4, mem: 2e8, user: 'bilal' },
    { pid: 700, ppid: 1, name: 'Docket', path: '/Applications/Docket.app/Contents/MacOS/Docket', cpu: 1, mem: 1e8, user: 'bilal' },
    { pid: 701, ppid: 700, name: 'whisper', path: '/Users/bilal/Library/Application Support/Docket/bin/whisper', cpu: 80, mem: 9e8, user: 'bilal' },
    { pid: 800, ppid: 1, name: 'mds_stores', path: '/System/Library/Frameworks/CoreServices.framework/Frameworks/Metadata.framework/Support/mds_stores', cpu: 2, mem: 5e7, user: 'root' },
    { pid: 900, ppid: 1, name: 'node', path: '/opt/homebrew/bin/node', cpu: 0, mem: 6e7, user: 'bilal' }
  ];
  const g = P.groupProcesses(procs, { platform: 'darwin', lsapp: new Map([[612, { type: 'Foreground', bundleId: 'com.google.Chrome', name: 'Google Chrome' }]]) });
  const chrome = g.find((x) => x.name === 'Google Chrome'); assert.equal(chrome.count, 2); assert.equal(chrome.mem, 6e8); assert.equal(chrome.kind, 'app');
  const docket = g.find((x) => x.name === 'Docket'); assert.equal(docket.count, 2, 'whisper joins Docket');
  assert.equal(g.find((x) => x.name === 'mds_stores').kind, 'system');
  assert.equal(g.find((x) => x.name === 'node').kind, 'background');
});
t('Windows grouping uses descriptions and windows', () => {
  const g = P.groupProcesses([
    { pid: 10, ppid: 4, name: 'chrome.exe', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', cpu: 5, mem: 3e8, user: '' },
    { pid: 11, ppid: 10, name: 'chrome.exe', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', cpu: 2, mem: 1e8, user: '' },
    { pid: 20, ppid: 4, name: 'svchost.exe', path: '', cpu: 0, mem: 2e7, user: '' },
    { pid: 30, ppid: 4, name: 'OneDrive.exe', path: 'C:\\Users\\b\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe', cpu: 0, mem: 5e7, user: '' }
  ], { platform: 'win32', windows: new Set([10]), descriptions: new Map([[10, 'Google Chrome'], [30, 'Microsoft OneDrive']]) });
  const c = g.find((x) => x.name === 'Google Chrome'); assert.equal(c.count, 2); assert.equal(c.kind, 'app');
  assert.equal(g.find((x) => x.key === 'exe:svchost.exe').kind, 'system');
  assert.equal(g.find((x) => x.name === 'Microsoft OneDrive').kind, 'background');
});
t('ioreg GPU utilisation', () => {
  const g = P.parseIoregGpu(`+-o AGXAcceleratorG14G  <class AGXAcceleratorG14G, id 0x100000282>
    {
      "model" = "Apple M2"
      "PerformanceStatistics" = {"In use system memory (driver)"=0,"Alloc system memory"=1984036864,"Tiler Utilization %"=8,"Renderer Utilization %"=11,"Device Utilization %"=14,"In use system memory"=412418048}
    }`);
  assert.equal(g.util, 14); assert.equal(g.mem, 412418048); assert.equal(g.name, 'Apple M2');
});
t('ioreg battery', () => {
  const o = P.parseIoregProps(`+-o AppleSmartBattery  <class AppleSmartBattery>
    {
      "AppleRawMaxCapacity" = 3871
      "DesignCapacity" = 4382
      "CycleCount" = 312
      "Temperature" = 3012
      "IsCharging" = No
      "ExternalConnected" = Yes
      "CurrentCapacity" = 76
      "MaxCapacity" = 100
      "Voltage" = 12601
      "Amperage" = 18446744073709550796
      "TimeRemaining" = 388
    }`);
  const b = P.macBatteryFromIoreg(o);
  assert.equal(b.cycles, 312); assert.equal(b.health, 88); assert.equal(b.temperature, 30.12); assert.equal(b.percent, 76); assert.equal(b.plugged, true); assert.equal(b.charging, false); assert(b.amperage < 0);
});
t('mdls raw output', () => {
  const files = ['/Applications/A.app', '/Applications/B.app'];
  const r = P.parseMdlsRaw(['2026-10-01 14:03:11 +0000', '12', '(null)', '2025-01-02 09:00:00 +0000', '(null)', '1000'].join('\0'), files, ['kMDItemLastUsedDate', 'kMDItemUseCount', 'kMDItemPhysicalSize']);
  assert.equal(P.mdDate(r[files[0]].kMDItemLastUsedDate), Date.parse('2026-10-01T14:03:11Z')); assert.equal(r[files[0]].kMDItemPhysicalSize, null); assert.equal(r[files[1]].kMDItemPhysicalSize, '1000');
});
t('launchctl list and print-disabled', () => {
  const l = P.parseLaunchctlList('PID\tStatus\tLabel\n-\t0\tcom.google.keystone.agent\n812\t0\tcom.adobe.AdobeCreativeCloud\n');
  assert.equal(l.get('com.adobe.AdobeCreativeCloud').pid, 812); assert.equal(l.get('com.google.keystone.agent').pid, null);
  const d = P.parsePrintDisabled('disabled services = {\n\t"com.docker.helper" => disabled\n\t"com.apple.x" => enabled\n\t"com.old" => true\n}');
  assert.equal(d.get('com.docker.helper'), true); assert.equal(d.get('com.apple.x'), false); assert.equal(d.get('com.old'), true);
});
t('login items', () => { const l = P.parseLoginItems('Docket\t/Applications/Docket.app\nRectangle\t\n'); assert.equal(l.length, 2); assert.equal(l[0].path, '/Applications/Docket.app'); assert.equal(l[1].path, null); });
t('TCC rows', () => {
  const r = P.parseTccRows('kTCCServiceCamera|us.zoom.xos|0|2|1700000000|UNUSED\nkTCCServiceMicrophone|com.tinyspeck.slackmacgap|0|0|1700000000|\nkTCCServiceAppleEvents|com.bilal.vitals|0|2|1700000000|com.apple.systemevents\nkTCCServiceWeird|x|0|2|0|', 'user');
  assert.equal(r.length, 3); assert.equal(r[0].label, 'Camera'); assert.equal(r[0].allowed, true); assert.equal(r[1].allowed, false); assert.equal(r[2].target, 'com.apple.systemevents');
});
const REG = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\7-Zip
    DisplayName    REG_SZ    7-Zip 23.01 (x64)
    DisplayVersion    REG_SZ    23.01
    Publisher    REG_SZ    Igor Pavlov
    UninstallString    REG_SZ    "C:\\Program Files\\7-Zip\\Uninstall.exe"
    EstimatedSize    REG_DWORD    0x1600
    InstallDate    REG_SZ    20240131

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{23170F69-40C1-2702-2301-000001000000}
    DisplayName    REG_SZ    Node.js
    DisplayVersion    REG_SZ    22.11.0
    UninstallString    REG_EXPAND_SZ    MsiExec.exe /I{23170F69-40C1-2702-2301-000001000000}

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\KB5005463
    DisplayName    REG_SZ    KB5005463
    UninstallString    REG_SZ    x

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Component
    DisplayName    REG_SZ    Some runtime part
    SystemComponent    REG_DWORD    0x1
    UninstallString    REG_SZ    x
`;
t('Windows uninstall entries', () => {
  const a = P.winUninstallEntries(P.parseRegQuery(REG), 'machine');
  assert.equal(a.length, 2); assert.equal(a[0].name, '7-Zip 23.01 (x64)'); assert.equal(a[0].size, 0x1600 * 1024); assert.equal(new Date(a[0].installed).getMonth(), 0);
  assert.equal(P.winUninstallCommand(a[1]), 'MsiExec.exe /X{23170F69-40C1-2702-2301-000001000000}');
  assert.equal(P.dedupeApps([...a, ...a]).length, 2);
});
t('StartupApproved and Run commands', () => {
  assert.equal(P.approvedEnabled('020000000000000000000000'), true); assert.equal(P.approvedEnabled('03000000A1B2C3D4E5F60708'), false); assert.equal(P.approvedEnabled(undefined), true); assert.equal(P.approvedEnabled('06000000'), true);
  assert.equal(P.exeOfCommand('"C:\\Program Files\\Steam\\steam.exe" -silent'), 'C:\\Program Files\\Steam\\steam.exe');
  assert.equal(P.exeOfCommand('C:\\Windows\\system32\\SecurityHealthSystray.exe'), 'C:\\Windows\\system32\\SecurityHealthSystray.exe');
});
t('ConsentStore permissions', () => {
  const keys = P.parseRegQuery(`
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam
    Value    REG_SZ    Allow

HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam\\Microsoft.WindowsCamera_8wekyb3d8bbwe
    Value    REG_SZ    Allow
    LastUsedTimeStart    REG_QWORD    0x1db1f0a4c3b2a00
    LastUsedTimeStop    REG_QWORD    0x1db1f0a5c3b2a00

HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam\\NonPackaged

HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam\\NonPackaged\\C:#Program Files#Zoom#bin#Zoom.exe
    LastUsedTimeStart    REG_QWORD    0x1db1f0a4c3b2a00
    LastUsedTimeStop    REG_QWORD    0x0

HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\Discord
    Value    REG_SZ    Deny
`);
  const r = P.parseConsentStore(keys, 'HKCU');
  assert.equal(r.length, 4); assert(r[0].global);
  const zoom = r.find((x) => /Zoom\.exe$/.test(x.client)); assert.equal(zoom.client, 'C:\\Program Files\\Zoom\\bin\\Zoom.exe'); assert.equal(zoom.inUse, true);
  assert.equal(r.find((x) => x.client === 'Discord').allowed, false);
  assert(r[1].lastUsed > Date.parse('2024-01-01'));
});
t('package names read nicely', () => { assert.equal(P.prettyPackage('Microsoft.WindowsCalculator'), 'Windows Calculator'); assert.equal(P.prettyPackage('SpotifyAB.SpotifyMusic'), 'Spotify Music'); });

t('focus tracker: sessions, switches and score', () => {
  const { FocusTracker } = require('../src/sys/focus');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitals-focus-'));
  const ft = new FocusTracker({ dir, settings: () => ({ focusTracking: true, focusSessionMinutes: 25, idleMinutes: 3, focusCategories: {} }), idleTime: () => 0 });
  const start = new Date(); start.setHours(9, 0, 0, 0); let t0 = start.getTime();
  if (t0 > Date.now() - 3 * 3600e3) t0 = Date.now() - 3 * 3600e3;
  const code = { name: 'Code', bundleId: 'com.microsoft.VSCode' }, chat = { name: 'Slack', bundleId: 'com.tinyspeck.slackmacgap' };
  let t = t0;
  for (; t < t0 + 40 * 60e3; t += 5000) ft.record(code, t, false);
  for (let k = 0; k < 10; k++) { const a = k % 2 ? code : chat; const e = t + 2 * 60e3; for (; t < e; t += 5000) ft.record(a, t, false); }
  for (let k = 0; k < 20; k++) { t += 5000; ft.record(null, t, true); }
  ft.endSession(t);
  const d = ft.summary(1)[0];
  assert(Math.abs(d.active - 60 * 60) < 30, 'about an hour active: ' + d.active);
  assert.equal(d.focusSessions, 1); assert.equal(d.switches, 10);
  assert(d.score > 30 && d.score < 100, 'score ' + d.score);
  assert.equal(d.apps[0].key, 'com.microsoft.vscode');
  ft.flush(); assert(fs.existsSync(path.join(dir, d.day + '.json')));
  assert(ft.lastSeen()['com.tinyspeck.slackmacgap']);
});
t('checkup findings and score', () => {
  const r = checkup.run({ platform: 'darwin', sample: { volumes: [{ name: 'Macintosh HD', mount: '/', size: 500e9, free: 5e9 }], mem: { pressure: 'warning', used: 7e9, total: 8e9, swap: { used: 3e9 } }, thermal: { state: 'nominal' }, battery: { present: true, health: 76, cycles: 900 }, uptime: 20 * 86400 },
    procs: [], startup: Array.from({ length: 18 }, (_, i) => ({ name: 'x' + i, enabled: true, missing: i === 0 })), apps: [{ name: 'Old', lastUsed: Date.now() - 400 * 86400e3, size: 1e9 }, { name: 'Old2', lastUsed: Date.now() - 400 * 86400e3 }, { name: 'Old3', lastUsed: Date.now() - 300 * 86400e3 }], history: { cpu: [] } });
  assert.equal(r.findings[0].level, 'bad'); assert(r.findings.some((f) => f.id === 'bat')); assert(r.findings.some((f) => f.id === 'unused')); assert(r.findings.some((f) => f.id === 'startup-broken'));
  assert(r.score < 70);
});
t('report renders', () => {
  const html = reportHtml({ specs: { model: 'MacBook Air', cpu: { name: 'Apple M2', cores: 8, threads: 8 }, memory: { total: 8e9 }, gpus: [], os: { name: 'macOS', version: '26.1' } }, sample: { cpu: { total: 12 }, mem: { used: 5e9, total: 8e9, pressure: 'normal' }, volumes: [] }, checkup: { score: 88, findings: [{ level: 'ok', title: 'Fine', detail: '' }] }, procs: [{ name: '<b>x</b>', mem: 1e9, cpu: 3 }], startup: [], focus: [], version: '0.1.0' });
  assert(html.includes('MacBook Air')); assert(html.includes('&lt;b&gt;x&lt;/b&gt;'));
});
console.log(`\n${n - failed}/${n} checks passed`); process.exit(failed ? 1 : 0);
