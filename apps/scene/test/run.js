// Node checks for the parts that don't need a screen: planning, matching, templates, the Mac and Windows parsers,
// the switch engine on the pretend computer, and (with SCENE_PWSH=/path/to/pwsh) the Windows C# helper compiling.
'use strict';
const assert = require('assert');
const P = require('../src/core/plan');
const T = require('../src/core/templates');
const mac = require('../src/platform/mac');
const win = require('../src/platform/win');
const demo = require('../src/platform/demo');
const { Engine } = require('../src/core/engine');
const { PowerShell } = require('../src/platform/run');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const D1 = P.describeDisplay({ id: 1, label: 'Built-in Retina Display', bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 33, width: 1512, height: 949 }, scaleFactor: 2, internal: true, primary: true }, 0);
const D2 = P.describeDisplay({ id: 2, label: 'LG UltraFine', bounds: { x: 1512, y: -458, width: 2560, height: 1440 }, workArea: { x: 1512, y: -433, width: 2560, height: 1415 }, scaleFactor: 1, internal: false, primary: false }, 1);

// ---------------------------------------------------------------- displays
test('display keys use name and size', () => { assert.strictEqual(D2.key, 'lg ultrafine|2560x1440'); assert.strictEqual(D1.id, '1'); });
test('matchDisplays: same ids map straight', () => { const { map, fallback } = P.matchDisplays([D1, D2], [D1, D2]); assert.strictEqual(map['2'].id, '2'); assert.deepStrictEqual(fallback, []); });
test('matchDisplays: monitor on a new port (new id) still matches by name and size', () => {
  const moved = { ...D2, id: '77' }; const { map } = P.matchDisplays([D1, D2], [D1, moved]); assert.strictEqual(map['2'].id, '77');
});
test('matchDisplays: unplugged monitor falls back to the main display', () => {
  const { map, fallback } = P.matchDisplays([D1, D2], [D1]); assert.strictEqual(map['2'].id, '1'); assert.deepStrictEqual(fallback, ['2']);
});
test('matchDisplays: a different external monitor takes the external slot', () => {
  const other = P.describeDisplay({ id: 9, label: 'DELL U2723QE', bounds: { x: 1512, y: 0, width: 3840, height: 2160 }, workArea: { x: 1512, y: 25, width: 3840, height: 2135 }, internal: false }, 1);
  const { map, fallback } = P.matchDisplays([D1, D2], [{ ...D1, id: '5' }, other]); assert.strictEqual(map['1'].id, '5'); assert.strictEqual(map['2'].id, '9'); assert.deepStrictEqual(fallback, []);
});
test('fractions round-trip and stay on screen', () => {
  const r = { x: 1512 + 853, y: -433, width: 1707, height: 1415 };
  const f = P.toFrac(r, D2); const back = P.fromFrac(f, D2);
  assert.ok(Math.abs(back.x - r.x) <= 1 && Math.abs(back.width - r.width) <= 1, JSON.stringify(back));
  const off = P.fromFrac({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, D1); assert.ok(off.x + off.width <= 1512 && off.y + off.height <= 982, JSON.stringify(off));
  const small = P.fromFrac({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, { workArea: { x: 0, y: 0, width: 1000, height: 600 } }); assert.deepStrictEqual(small, { x: 500, y: 300, width: 500, height: 300 });
});
test('displayForRect picks the display with most of the window', () => {
  assert.strictEqual(P.displayForRect({ x: 1400, y: 0, width: 600, height: 400 }, [D1, D2]).id, '2');
  assert.strictEqual(P.displayForRect({ x: -5000, y: 0, width: 100, height: 100 }, [D1, D2]).id, '1');
});

// ---------------------------------------------------------------- apps & windows
test('sameApp across bundle ids, paths, Store ids and names', () => {
  assert.ok(P.sameApp({ bundleId: 'com.google.Chrome' }, { bundleId: 'com.google.chrome', name: 'x' }));
  assert.ok(!P.sameApp({ bundleId: 'com.google.Chrome' }, { bundleId: 'com.microsoft.edgemac' }));
  assert.ok(P.sameApp({ path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }, { path: 'c:\\program files\\google\\chrome\\application\\CHROME.EXE' }));
  assert.ok(P.sameApp({ path: 'D:\\Games\\Steam\\steam.exe' }, { path: 'C:\\Program Files (x86)\\Steam\\steam.exe' }), 'same exe name in another folder');
  assert.ok(P.sameApp({ name: 'Spotify', aumid: 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify' }, { aumid: 'spotifyab.spotifymusic_zpdnekdrzrea0!spotify' }));
  assert.ok(P.sameApp({ name: 'Spotify' }, { name: 'x', path: 'C:\\Users\\b\\AppData\\Roaming\\Spotify\\Spotify.exe' }));
  assert.ok(P.sameApp({ path: '/Applications/Slack.app', name: 'Slack' }, { name: 'Slack', path: '/Applications/Slack.app' }));
});
test('matchWindows: exact titles, then similar titles, then in order', () => {
  const rules = [{ id: 'a', title: 'Inbox (3) - Gmail - Google Chrome' }, { id: 'b', title: 'GA4 Reports - Google Chrome' }, { id: 'c', title: 'Something gone' }];
  const wins = [{ id: 1, title: 'Lyte Fiber — GA4 Reports - Google Chrome' }, { id: 2, title: 'Inbox (5) - Gmail - Google Chrome' }, { id: 3, title: 'New Tab - Google Chrome' }];
  const m = Object.fromEntries(P.matchWindows(rules, wins, { appName: 'Google Chrome' }).map((p) => [p.rule.id, p.win.id]));
  assert.deepStrictEqual(m, { a: 2, b: 1, c: 3 });
});
test('matchWindows: a rule that opens a link takes the newly opened window', () => {
  const rules = [{ id: 'a', title: '', match: 'any', fresh: true }];
  const wins = [{ id: 1, title: 'Old' }, { id: 2, title: 'New one' }];
  assert.strictEqual(P.matchWindows(rules, wins, { fresh: new Set([2]) })[0].win.id, 2);
});
test('matchWindows: more rules than windows leaves the rest unmatched', () => {
  assert.strictEqual(P.matchWindows([{ id: 'a' }, { id: 'b' }], [{ id: 1, title: 'x' }]).length, 1);
});
test('captureApps groups windows by app, skips the system and keeps minimised state', () => {
  const snap = { displays: [D1, D2], windows: [
    { app: { name: 'Finder', bundleId: 'com.apple.finder' }, title: 'Downloads', bounds: { x: 10, y: 40, width: 500, height: 400 }, state: 'normal' },
    { app: { name: 'Google Chrome', bundleId: 'com.google.Chrome', path: '/Applications/Google Chrome.app' }, title: 'A', bounds: { x: 1512, y: -433, width: 1280, height: 1415 }, state: 'normal' },
    { app: { name: 'Google Chrome', bundleId: 'com.google.Chrome' }, title: 'B', bounds: { x: 2792, y: -433, width: 1280, height: 1415 }, state: 'normal' },
    { app: { name: 'Spotify', bundleId: 'com.spotify.client' }, title: 'Spotify', bounds: { x: 100, y: 100, width: 800, height: 600 }, state: 'minimized' },
    { app: { name: 'Scene', bundleId: 'com.bilal.scene' }, title: 'Scene', bounds: { x: 0, y: 0, width: 800, height: 600 }, state: 'normal' }
  ] };
  const apps = P.captureApps(snap);
  assert.deepStrictEqual(apps.map((a) => a.name), ['Google Chrome', 'Spotify']);
  assert.strictEqual(apps[0].windows.length, 2); assert.strictEqual(apps[0].windows[1].display, '2'); assert.strictEqual(apps[0].windows[1].frac.x, 0.5);
  assert.strictEqual(apps[1].windows[0].state, 'minimized');
});
test('Windows system processes are protected', () => {
  assert.ok(P.isProtected({ name: 'Explorer', path: 'C:\\Windows\\explorer.exe' }));
  assert.ok(!P.isProtected({ name: 'Steam', path: 'C:\\Program Files (x86)\\Steam\\steam.exe' }));
});
test('planSwitch: what launches, what is already open, what gets hidden', () => {
  const scene = { displays: [D1, D2], apps: [
    { id: 'c', name: 'Google Chrome', bundleId: 'com.google.Chrome', windows: [{ id: 'w1', display: '2', frac: { x: 0, y: 0, w: 2 / 3, h: 1 }, state: 'normal' }] },
    { id: 's', name: 'Slack', bundleId: 'com.tinyspeck.slackmacgap', windows: [{ id: 'w2', display: '2', frac: { x: 2 / 3, y: 0, w: 1 / 3, h: 1 }, state: 'maximized' }] },
    { id: 'o', name: 'Optional', bundleId: 'x.optional', launch: false, windows: [] }
  ] };
  const snap = { displays: [D1], windows: [
    { app: { name: 'Google Chrome', bundleId: 'com.google.Chrome' }, title: 'x', bounds: { x: 0, y: 33, width: 800, height: 600 } },
    { app: { name: 'Notes', bundleId: 'com.apple.Notes' }, title: 'n', bounds: { x: 0, y: 33, width: 800, height: 600 } },
    { app: { name: 'Finder', bundleId: 'com.apple.finder' }, title: 'f', bounds: { x: 0, y: 33, width: 800, height: 600 } }
  ] };
  const pl = P.planSwitch(scene, snap, { running: [{ name: 'Music', bundleId: 'com.apple.Music' }], keep: [{ name: 'Music', bundleId: 'com.apple.Music' }] });
  assert.deepStrictEqual(pl.launch.map((a) => a.name), ['Slack']);
  assert.deepStrictEqual(pl.already.map((a) => a.name), ['Google Chrome']);
  assert.deepStrictEqual(pl.others.map((a) => a.name), ['Notes']);
  assert.deepStrictEqual(pl.displayFallback, ['2']);
  const sl = pl.placements.find((p) => p.rule.id === 'w2'); assert.deepStrictEqual(sl.rect, D1.workArea);
});
test('autoZones tile without gaps', () => {
  for (let n = 1; n <= 7; n++) { const z = P.autoZones(n); assert.strictEqual(z.length, n); const area = z.reduce((a, b) => a + b.w * b.h, 0); assert.ok(Math.abs(area - 1) < 1e-9, `n=${n} area=${area}`); }
});

// ---------------------------------------------------------------- triggers & keys
test('schedule triggers fire once, inside their minute window, on chosen days', () => {
  const t = { kind: 'schedule', time: '09:00', days: [1, 2, 3, 4, 5] };
  const mon = new Date(2026, 9, 19, 9, 1); const sat = new Date(2026, 9, 24, 9, 1); const late = new Date(2026, 9, 19, 9, 5);
  assert.ok(P.scheduleDue(t, mon, null)); assert.ok(!P.scheduleDue(t, sat, null)); assert.ok(!P.scheduleDue(t, late, null));
  assert.ok(!P.scheduleDue(t, mon, P.scheduleStamp(t, mon)));
});
test('display triggers match by name or any display', () => {
  assert.ok(P.displayTriggerMatches({ kind: 'display', when: 'connected', display: { label: 'LG UltraFine', key: 'x' } }, { type: 'connected', display: D2 }));
  assert.ok(!P.displayTriggerMatches({ kind: 'display', when: 'disconnected', display: { label: 'LG UltraFine' } }, { type: 'connected', display: D2 }));
  assert.ok(P.displayTriggerMatches({ kind: 'display', when: 'connected', display: null }, { type: 'connected', display: D2 }));
});
test('accelerators from key presses', () => {
  assert.strictEqual(P.accelFromKey({ key: '1', code: 'Digit1', metaKey: true, altKey: true }, 'darwin'), 'CommandOrControl+Alt+1');
  assert.strictEqual(P.accelFromKey({ key: 'g', code: 'KeyG', ctrlKey: true, shiftKey: true }, 'win32'), 'CommandOrControl+Shift+G');
  assert.strictEqual(P.accelFromKey({ key: 'a', code: 'KeyA' }, 'win32'), null, 'needs a modifier');
  assert.strictEqual(P.accelFromKey({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }, 'win32'), null);
  assert.strictEqual(P.prettyAccel('Control+Alt+Space', 'darwin'), '⌃⌥Space'); assert.strictEqual(P.prettyAccel('CommandOrControl+Alt+1', 'win32'), 'Ctrl+Alt+1');
});

// ---------------------------------------------------------------- templates
const INSTALLED_MAC = [
  { name: 'Google Chrome', bundleId: 'com.google.Chrome', path: '/Applications/Google Chrome.app' },
  { name: 'Slack', bundleId: 'com.tinyspeck.slackmacgap', path: '/Applications/Slack.app' },
  { name: 'Relay', bundleId: 'com.bilal.relay', path: '/Applications/Relay.app' },
  { name: 'Docket', bundleId: 'com.bilal.docket', path: '/Applications/Docket.app' },
  { name: 'Touchline', bundleId: 'com.bilal.touchline', path: '/Applications/Touchline.app' },
  { name: 'Steam', bundleId: 'com.valvesoftware.steam', path: '/Applications/Steam.app' }
];
test('templates pick installed apps and use the second display', () => {
  const s = T.fromTemplate('work', INSTALLED_MAC, [D1, D2], { platform: 'darwin' });
  assert.deepStrictEqual(s.apps.map((a) => a.name), ['Google Chrome', 'Slack', 'Relay', 'Docket']);
  assert.strictEqual(s.apps[0].windows[0].display, '2'); assert.strictEqual(s.apps[2].windows[0].display, '1');
  assert.ok(new Set(s.apps.flatMap((a) => a.windows.map((w) => w.id))).size === 4, 'unique window ids');
});
test('templates on one display drop the side apps and fit the rest', () => {
  const s = T.fromTemplate('work', INSTALLED_MAC, [D1], { platform: 'darwin' });
  assert.deepStrictEqual(s.apps.map((a) => a.name), ['Google Chrome', 'Slack']);
  assert.strictEqual(s.apps[1].windows[0].frac.x, 2 / 3);
});
test('match day opens a stream and keeps the screen awake; Windows has no full screen', () => {
  const s = T.fromTemplate('matchday', INSTALLED_MAC, [D1, D2], { platform: 'darwin' });
  assert.ok(s.system.keepAwake); assert.strictEqual(s.apps[0].open[0].target, 'https://www.youtube.com/');
  assert.ok(s.apps.some((a) => a.name === 'Touchline'));
  const m = T.fromTemplate('movie', INSTALLED_MAC, [D1], { platform: 'win32' }); assert.strictEqual(m.apps[0].windows[0].state, 'maximized');
  const mm = T.fromTemplate('movie', INSTALLED_MAC, [D1], { platform: 'darwin' }); assert.strictEqual(mm.apps[0].windows[0].state, 'fullscreen');
});
test('Windows templates find apps by exe name', () => {
  const s = T.fromTemplate('gaming', [{ name: 'Steam', aumid: 'x', path: 'C:\\Program Files (x86)\\Steam\\steam.exe' }, { name: 'Discord', aumid: 'com.squirrel.Discord.Discord', path: null }], [D1, D2], { platform: 'win32' });
  assert.deepStrictEqual(s.apps.map((a) => a.name), ['Steam']); assert.strictEqual(s.others, 'quit');
});

// ---------------------------------------------------------------- Mac parser
test('mac: System Events listing becomes windows (panels skipped, minimised and full screen kept)', () => {
  const json = JSON.stringify([
    { pid: 101, name: 'Google Chrome', bundleId: 'com.google.Chrome', frontmost: true, visible: true, windows: [
      { index: 0, title: 'Inbox', x: 1512, y: -433, w: 1280, h: 1415, subrole: 'AXStandardWindow', minimized: false, fullscreen: false },
      { index: 1, title: '', x: 20, y: 40, w: 300, h: 30, subrole: 'AXFloatingWindow', minimized: false, fullscreen: false }] },
    { pid: 102, name: 'Notes', bundleId: 'com.apple.Notes', frontmost: false, visible: false, windows: [{ index: 0, title: 'Notes', x: 10, y: 50, w: 800, h: 600, subrole: 'AXStandardWindow', minimized: true, fullscreen: false }] },
    { pid: 103, name: 'TV', bundleId: 'com.apple.TV', frontmost: false, visible: true, windows: [{ index: 0, title: 'TV', x: 0, y: 0, w: 1512, h: 982, subrole: 'AXStandardWindow', minimized: false, fullscreen: true }] },
    { pid: 999, name: 'Scene', bundleId: 'com.bilal.scene', windows: [{ index: 0, title: 'Scene', x: 0, y: 0, w: 900, h: 700, subrole: 'AXStandardWindow' }] }
  ]);
  const r = mac.parseList(json, { 101: '/Applications/Google Chrome.app' }, 999);
  assert.strictEqual(r.windows.length, 3);
  assert.strictEqual(r.windows[0].app.path, '/Applications/Google Chrome.app'); assert.ok(r.windows[0].focused);
  assert.strictEqual(r.windows[1].state, 'minimized'); assert.ok(r.windows[1].hidden);
  assert.strictEqual(r.windows[2].state, 'fullscreen');
  assert.deepStrictEqual(r.windows[0].bounds, { x: 1512, y: -433, width: 1280, height: 1415 });
});
test('mac: executable paths map to their outer app bundle', () => {
  assert.strictEqual(mac.bundleOf('/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper'), '/Applications/Google Chrome.app');
  assert.strictEqual(mac.bundleOf('/usr/sbin/cfprefsd'), null);
});
test('mac: the System Events scripts are valid JavaScript', () => {
  for (const src of [mac.LIST_JXA, mac.PLACE_JXA]) new Function('Application', 'delay', src + '; return run;');
});

// ---------------------------------------------------------------- Windows parser
test('windows: helper output becomes windows, Scene and tiny windows skipped', () => {
  const out = 'junk\n' + JSON.stringify([
    { h: 131234, pid: 4400, path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', title: 'Inbox - Gmail - Google Chrome', cls: 'Chrome_WidgetWin_1', x: 2560, y: 0, w: 2560, hh: 1392, state: 'maximized', fg: true, z: 0 },
    { h: 5555, pid: 5000, path: 'C:\\Users\\b\\AppData\\Local\\Discord\\app-1.0\\Discord.exe', title: 'Discord', cls: 'Chrome_WidgetWin_1', x: -32000, y: -32000, w: 160, hh: 28, state: 'minimized', fg: false, z: 1 },
    { h: 7777, pid: 6000, path: 'C:\\x\\tiny.exe', title: 'tiny', cls: 'x', x: 0, y: 0, w: 40, hh: 20, state: 'normal', fg: false, z: 2 },
    { h: 8888, pid: 42, path: 'C:\\Scene\\Scene.exe', title: 'Scene', cls: 'x', x: 0, y: 0, w: 900, hh: 700, state: 'normal', fg: false, z: 3 }
  ]) + '\n';
  const r = win.parseList(out, 42);
  assert.strictEqual(r.length, 2); assert.strictEqual(r[0].app.name, 'Chrome'); assert.strictEqual(r[0].handle, 131234); assert.strictEqual(r[0].state, 'maximized');
  assert.strictEqual(r[1].state, 'minimized'); assert.deepStrictEqual(r[0].physical, { x: 2560, y: 0, width: 2560, height: 1392 });
});
test('windows: Start menu ids resolve to exe paths', () => {
  assert.ok(/Steam\\steam\.exe$/i.test(win.resolveAppId('{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}\\Steam\\steam.exe').replace(/\//g, '\\')));
  assert.strictEqual(win.resolveAppId('Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'), null);
  assert.strictEqual(win.resolveAppId('C:\\Tools\\thing.exe'), 'C:\\Tools\\thing.exe');
});

// ---------------------------------------------------------------- engine on the pretend computer
test('engine: a switch launches, opens a link, places windows, hides others and sets the system', async () => {
  const displays = () => demo.DISPLAYS.map((d, i) => P.describeDisplay(d, i));
  let awake = null;
  const eng = new Engine({ platform: demo, displays, openDefault: async () => {}, keepAwake: (on) => { awake = on; }, appIndex: () => new Map(), settings: () => ({ waitSeconds: 5, keepApps: [] }) });
  const ds = displays();
  const scene = { id: 's1', name: 'Test', displays: ds, others: 'hide', system: { volume: 30, appearance: 'light', keepAwake: true }, actions: [{ kind: 'command', value: 'echo hi' }], extras: [],
    apps: [
      { id: 'a1', name: 'Google Chrome', bundleId: 'com.google.Chrome', open: [{ target: 'https://example.com' }], windows: [{ id: 'w1', title: '', match: 'any', display: '2', frac: { x: 0, y: 0, w: 0.5, h: 1 }, state: 'normal' }] },
      { id: 'a2', name: 'Discord', bundleId: 'com.hnc.Discord', windows: [{ id: 'w2', title: '', match: 'any', display: '1', frac: { x: 0.5, y: 0, w: 0.5, h: 1 }, state: 'normal' }] }
    ], focusApp: 'a2' };
  const res = await eng.activate(scene);
  assert.ok(res.ok, JSON.stringify(res.steps));
  const snap = await demo.snapshot();
  const ex = snap.windows.find((w) => /example\.com/.test(w.title)); assert.ok(ex, 'new Chrome window');
  assert.deepStrictEqual(ex.bounds, P.fromFrac({ x: 0, y: 0, w: 0.5, h: 1 }, ds[1]));
  const dc = snap.windows.find((w) => w.app.name === 'Discord'); assert.deepStrictEqual(dc.bounds, P.fromFrac({ x: 0.5, y: 0, w: 0.5, h: 1 }, ds[0]));
  assert.ok(snap.windows.filter((w) => w.app.name === 'Slack').every((w) => w.state === 'minimized'));
  assert.ok(snap.windows[0].app.name === 'Discord', 'front app raised last');
  assert.strictEqual((await demo.getVolume()).volume, 30); assert.strictEqual(await demo.getAppearance(), 'light'); assert.strictEqual(awake, true);
  assert.ok(demo.log.some((l) => l[0] === 'command' && l[1] === 'echo hi'));
  assert.deepStrictEqual(res.previous.quitApps.map((a) => a.name), ['Discord']);
  // restore: Discord (opened by the scene) quits, Slack comes back
  const back = await eng.activate(res.previous);
  assert.ok(back.ok, JSON.stringify(back.steps));
  const s2 = await demo.snapshot();
  assert.ok(!s2.windows.some((w) => w.app.name === 'Discord'));
  assert.ok(s2.windows.some((w) => w.app.name === 'Slack' && w.state === 'normal'));
});

// ---------------------------------------------------------------- Windows helper compiles (needs pwsh)
test('windows: the C# helper compiles and the PowerShell runner answers', async () => {
  if (!process.env.SCENE_PWSH) return 'skipped (set SCENE_PWSH)';
  process.env.SCENE_PWSH = process.env.SCENE_PWSH;
  const shell = new PowerShell('t');
  const r = await shell.exec(win.PRELUDE + "[SceneWin].FullName; [SceneAudio].FullName; 'a\"b'", { timeout: 60000 });
  shell.stop();
  assert.ok(r.ok, r.stdout + r.error); assert.deepStrictEqual(r.stdout.trim().split('\n'), ['SceneWin', 'SceneAudio', 'a"b']);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { const r = await t.fn(); console.log(`ok   ${t.name}${typeof r === 'string' ? ' — ' + r : ''}`); }
    catch (e) { failed++; console.log(`FAIL ${t.name}\n     ${String(e.stack || e).split('\n').slice(0, 4).join('\n     ')}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
