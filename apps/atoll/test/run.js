// Atoll — quick Node checks (no Electron, no network). Run: npm test
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert/strict');

const { Timers, parseDuration, fmt, nameFor } = require('../src/modules/timers');
const { choose } = require('../src/modules/media');
const win = require('../src/modules/media/win');
const mac = require('../src/modules/media/mac');
const { MatchWatch, shape, abbreviate, pickerRows } = require('../src/modules/match');
const { Shelf, kindOf } = require('../src/modules/shelf');
const { describe, shapeWeather, weatherUrl } = require('../src/modules/glance');
const { Store, DEFAULTS } = require('../src/store');
const N = require('../src/touchline/vendor/normalize');

const fx = (n) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', n))).toString());
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atoll-test-'));

test('durations: minutes, m:ss, h:mm:ss, words', () => {
  assert.equal(parseDuration('5'), 300e3);
  assert.equal(parseDuration('1.5'), 90e3);
  assert.equal(parseDuration('1:30'), 90e3);
  assert.equal(parseDuration('1:02:00'), 3720e3);
  assert.equal(parseDuration('90s'), 90e3);
  assert.equal(parseDuration('1h 15m'), 4500e3);
  assert.equal(parseDuration('2 hours'), 7200e3);
  assert.equal(parseDuration('10 min 30 sec'), 630e3);
  assert.equal(parseDuration('1:75'), null);
  assert.equal(parseDuration('soon'), null);
  assert.equal(parseDuration('5 apples'), null);
  assert.equal(parseDuration(''), null);
});

test('formatting: countdowns round up, names read naturally', () => {
  assert.equal(fmt(65000), '1:05'); assert.equal(fmt(64001), '1:05'); assert.equal(fmt(3725000), '1:02:05'); assert.equal(fmt(0), '0:00');
  assert.equal(nameFor(300e3), '5 min'); assert.equal(nameFor(30e3), '30 sec'); assert.equal(nameFor(5400e3), '1 h 30 min'); assert.equal(nameFor(3600e3), '1 h');
});

test('timers: pause, resume, extend, finish, restore after a restart', async () => {
  let now = 1_000_000; const clock = () => now;
  const T = new Timers({ now: clock });
  const t = T.add(60e3, 'Tea');
  assert.equal(T.snapshot().list[0].left, 60e3);
  now += 20e3; T.pause(t.id);
  assert.equal(T.get(t.id).left, 40e3);
  now += 100e3; T.resume(t.id);
  assert.equal(T.get(t.id).endsAt, now + 40e3);
  T.extend(t.id, 60e3); assert.equal(T.get(t.id).endsAt, now + 100e3);
  const saved = JSON.parse(JSON.stringify(T.serialize())); T.dispose();
  now += 200e3;   // Atoll was closed past the end
  const R = new Timers({ now: clock, saved });
  assert.equal(R.get(t.id).state, 'done');
  assert.equal(R.lead().kind, 'timer'); assert.equal(R.lead().state, 'done');
  R.dismissDone(); assert.equal(R.list.length, 0); R.dispose();
});

test('timers: a real one rings once, on time', async () => {
  const T = new Timers();
  const done = [];
  T.on('done', (e) => done.push(e));
  T.add(1000, 'quick');
  await sleep(1250);
  assert.equal(done.length, 1); assert.equal(done[0].timer.label, 'quick');
  assert.equal(T.list[0].state, 'done'); T.dispose();
});

test('stopwatch and focus cycles (work → short → … → long)', () => {
  let now = 0; const T = new Timers({ now: () => now, focusPlan: () => ({ work: 25, short: 5, long: 15, every: 2 }) });
  T.watchToggle(); now += 5000; T.watchLap(); now += 3000; T.watchLap(); T.watchToggle();
  assert.equal(T.watchElapsed(), 8000); assert.deepEqual(T.watch.laps.map((l) => l.split), [3000, 5000]);
  T.watchReset(); assert.equal(T.watchElapsed(), 0);
  const seen = []; T.on('done', (e) => seen.push(e.to));
  T.focusStart(); assert.equal(T.focus.phase, 'work'); assert.equal(T.focus.duration, 25 * 60e3);
  T.nextPhase(); assert.equal(T.focus.phase, 'short');
  T.nextPhase(); assert.equal(T.focus.phase, 'work'); assert.equal(T.focus.cycle, 2);
  T.nextPhase(); assert.equal(T.focus.phase, 'long');
  assert.deepEqual(seen, ['short', 'work', 'long']);
  T.focusPause(); assert.equal(T.focus.running, false); T.focusStop(); assert.equal(T.focus, null); T.dispose();
});

test('media: picks the playing player, else the one shown before', () => {
  const list = [{ player: 'Music', state: 'paused', title: 'A' }, { player: 'Spotify', state: 'playing', title: 'B' }];
  assert.equal(choose(list, 'Music').player, 'Spotify');
  assert.equal(choose([{ player: 'Music', state: 'paused', title: 'A' }, { player: 'Spotify', state: 'paused', title: 'B' }], 'Spotify').player, 'Spotify');
  assert.equal(choose([{ player: 'Music', state: 'stopped' }, { error: 'x' }], null), null);
});

test('media: Windows app names and scripts', () => {
  assert.equal(win.appName('Spotify.exe'), 'Spotify');
  assert.equal(win.appName('Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic'), 'Media Player');
  assert.equal(win.appName('AppleInc.AppleMusicWin_nzyj5cx40ttqa!App'), 'Apple Music');
  assert.equal(win.appName('MSEdge'), 'Edge'); assert.equal(win.appName('Chrome'), 'Chrome');
  assert.equal(win.appName('com.example.Thing'), 'Thing');
  assert.match(win.PRELUDE, /IAsyncOperation`1/);
  assert.match(win.PRELUDE, /GlobalSystemMediaTransportControlsSessionManager/);
  assert.ok(!/=>|\$"|\?\./.test(win.CS), 'C# stays C# 5 (Windows PowerShell 5.1)');
  assert.match(mac.POLL, /running\(\)/, 'never launches Music or Spotify');
});

test('match: shape a finished Touchline match, abbreviations, picker rows', () => {
  const raw = N.match(fx('match.json.gz'));
  const s = shape(raw);
  assert.equal(s.state, 'post'); assert.equal(s.home.score, 5); assert.equal(s.away.score, 0);
  assert.ok(s.events.some((e) => e.kind === 'goal' && e.player));
  assert.ok(s.home.logo.startsWith('https://images.fotmob.com/'));
  assert.equal(abbreviate('Manchester United'), 'MUN'); assert.equal(abbreviate('Arsenal'), 'ARS'); assert.equal(abbreviate('Real Madrid CF'), 'RMA');
  const rows = pickerRows(N.matchDay(fx('day.json.gz')));
  assert.ok(rows.length >= 5); assert.ok(rows[0].matches[0].home.short);
});

test('match: following a team finds today’s game, notices goals, kick-off and full-time', async () => {
  const dayRaw = N.matchDay(fx('day.json.gz'));
  const pick = dayRaw.leagues[0].matches[0];
  let state = 'pre', hs = 0, as = 0;
  const base = N.match(fx('match.json.gz'));
  const data = {
    today: () => '2026-10-23',
    day: async () => dayRaw,
    team: async () => ({ next: null }),
    searchTeams: async () => [],
    match: async (id) => ({ ...base, id, state, label: state === 'live' ? "67'" : '', home: { ...base.home, id: pick.home.id, score: hs }, away: { ...base.away, id: pick.away.id, score: as }, _meta: {} })
  };
  let follow = { mode: 'team', team: { id: pick.home.id, name: pick.home.name } };
  const W = new MatchWatch({ data, getFollow: () => follow, setFollow: (f) => { follow = f; } });
  const moments = []; W.on('moment', (m) => moments.push(m.kind + (m.side ? ':' + m.side : '')));
  await W.tick(); assert.equal(W.cur.id, pick.id); assert.equal(W.cur.home.short, pick.home.short);
  state = 'live'; await W.tick();
  hs = 1; await W.tick();
  as = 1; hs = 2; await W.tick();
  state = 'post'; await W.tick();
  assert.deepEqual(moments, ['kickoff', 'goal:home', 'goal:home', 'goal:away', 'fulltime']);
  W.clear(); assert.equal(follow, null);
});

test('shelf: Electron 44 async clipboard (readText returns a Promise) and odd values never crash', async () => {
  let text = Promise.resolve('hello'); const cb = { readText: () => text, writeText: async (t) => { text = Promise.resolve(t); } };
  const S = new Shelf({ clipboard: cb, size: () => 5 });
  await S.sample(); assert.deepEqual(S.clips.map((c) => c.text), ['hello']);
  text = Promise.resolve({}); await S.sample();
  text = Promise.resolve(null); await S.sample();
  cb.readText = () => { throw new Error('busy'); }; await S.sample();
  cb.readText = () => Promise.reject(new Error('busy')); await S.sample();
  assert.equal(S.clips.length, 2); // '[object Object]' is text too, but nothing threw
});

test('shelf: keeps paths, skips duplicates and missing files, prunes moved ones', () => {
  const d = tmp(); const a = path.join(d, 'a.png'), b = path.join(d, 'notes.md');
  fs.writeFileSync(a, 'x'); fs.writeFileSync(b, 'y');
  let saved = null; const S = new Shelf({ save: (v) => { saved = v; } });
  assert.equal(S.add([a, b, a, path.join(d, 'nope.txt')]), 2);
  assert.equal(saved.length, 2); assert.equal(S.items.find((i) => i.path === a).kind, 'image');
  fs.rmSync(a); S.prune(); assert.equal(S.items.length, 1);
  assert.equal(kindOf('x.MOV'), 'video'); assert.equal(kindOf('x', true), 'folder');
});

test('shelf: clipboard history, newest first, no repeats, copy back without re-adding', async () => {
  let text = ''; const cb = { readText: () => text, writeText: (t) => { text = t; } };
  const S = new Shelf({ clipboard: cb, size: () => 3 });
  for (const t of ['one', 'two', 'three', 'two', 'four']) { text = t; await S.sample(); }
  assert.deepEqual(S.clips.map((c) => c.text), ['four', 'two', 'three']);
  const three = S.clips.find((c) => c.text === 'three'); await S.copy(three.id); await S.sample();
  assert.equal(text, 'three'); assert.deepEqual(S.clips.map((c) => c.text), ['three', 'four', 'two']);
});

test('weather: codes, night icons, shaping an Open-Meteo answer', () => {
  assert.deepEqual(describe(0, 1), { label: 'Clear', icon: 'sun' });
  assert.equal(describe(0, 0).icon, 'moon'); assert.equal(describe(63, 1).icon, 'rain');
  const j = { current: { time: '2026-10-25T19:00', temperature_2m: 71.4, apparent_temperature: 70, weather_code: 2, is_day: 1, wind_speed_10m: 8.2, relative_humidity_2m: 60 },
    daily: { temperature_2m_max: [78.1], temperature_2m_min: [61.9], weather_code: [2], precipitation_probability_max: [10], sunrise: ['x'], sunset: ['y'] },
    hourly: { time: ['2026-10-25T18:00', '2026-10-25T19:00', '2026-10-25T20:00', '2026-10-25T21:00'], temperature_2m: [72, 71, 69, 67], weather_code: [2, 2, 1, 0], is_day: [1, 1, 0, 0] } };
  const w = shapeWeather(j, { name: 'Houston' }, 'f');
  assert.equal(w.temp, 71); assert.equal(w.hi, 78); assert.equal(w.icon, 'partly'); assert.equal(w.hours[0].temp, 69); assert.equal(w.hours[1].icon, 'moon');
  assert.match(weatherUrl({ lat: 29.76, lon: -95.36 }, 'f'), /temperature_unit=fahrenheit/);
  assert.doesNotMatch(weatherUrl({ lat: 1, lon: 1 }, 'c'), /fahrenheit/);
});

test('suite link: calls, errors, events, reconnect after the app restarts, stale socket', async () => {
  process.env.SUITELINK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atoll-link-'));
  delete require.cache[require.resolve('../src/suitelink')];
  const L = require('../src/suitelink');
  let srv = L.serve('scene', { version: '9.9', calls: { list: () => ({ scenes: [{ id: 'w', name: 'Work' }] }), activate: (id) => { if (id === 'x') throw new Error('no such scene'); return { ok: true, id }; } } });
  const c = L.connect('scene', { retryMs: 100 });
  await new Promise((r) => c.once('up', r));
  assert.equal(c.info.version, '9.9'); assert.deepEqual(c.info.calls, ['list', 'activate']);
  assert.equal((await c.call('list')).scenes[0].name, 'Work');
  await assert.rejects(c.call('activate', 'x'), /no such scene/);
  await assert.rejects(c.call('nope'), /has no "nope"/);
  const got = []; c.on('switched', (d) => got.push(d)); srv.emit('switched', { id: 'w' }); await sleep(50);
  assert.deepEqual(got, [{ id: 'w' }]);
  if (process.platform !== 'win32') assert.equal(fs.statSync(srv.address).mode & 0o777, 0o600);
  srv.close(); await new Promise((r) => c.once('down', r));
  await assert.rejects(c.call('list'), /isn't running/);
  fs.writeFileSync(L.address('scene'), '');   // a leftover from a crash
  srv = L.serve('scene', { calls: { ping: () => 'pong' } });
  await new Promise((r) => c.once('up', r));
  assert.equal(await c.call('ping'), 'pong');
  c.stop(); srv.close();
});

test('add-ons: off by default, connect when on, moments for meetings and mail, launch needs the app installed', async () => {
  process.env.SUITELINK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atoll-addons-'));
  delete require.cache[require.resolve('../src/suitelink')]; delete require.cache[require.resolve('../src/addons')];
  const L = require('../src/suitelink');
  const { Addons, installPaths } = require('../src/addons');
  let on = {};
  const H = new Addons({ enabled: () => on, exists: () => false, linkOptions: { retryMs: 100 } });
  H.sync();
  assert.equal(Object.keys(H.links).length, 0, 'nothing connects while every add-on is off');
  const docket = L.serve('docket', { version: '0.1.3', calls: { status: () => ({ recording: false, detected: null }), start: () => true } });
  const relay = L.serve('relay', { calls: { unread: () => [{ id: 'g', name: 'Work', unread: 3, platform: 'gmail' }], recent: () => [] } });
  on = { docket: true, relay: true }; H.sync();
  await sleep(400);
  const snap = H.snapshot();
  assert.equal(snap.docket.up, true); assert.equal(snap.docket.version, '0.1.3'); assert.equal(snap.relay.data.accounts[0].unread, 3); assert.equal(snap.scene.enabled, false);
  const moments = []; H.on('moment', (m) => moments.push(m.kind));
  docket.emit('detected', { app: 'Zoom', title: 'Standup' });
  docket.emit('status', { recording: true, paused: false, elapsed: 12, at: Date.now() });
  relay.emit('mail', { accountId: 'g', from: 'Kim', subject: 'Q4 numbers' });
  await sleep(100);
  assert.deepEqual(moments, ['meeting', 'docket-start', 'mail']);
  assert.equal(H.snapshot().relay.data.recent[0].from, 'Kim');
  assert.equal(await H.call('docket', 'start'), true);
  await assert.rejects(H.call('scene', 'list'), /isn’t running/);
  assert.throws(() => { on.scene = true; H.sync(); H.launch('scene'); }, /isn’t installed/);
  on = {}; H.sync(); assert.equal(Object.keys(H.links).length, 0);
  docket.close(); relay.close();
  assert.match(installPaths('beam', { platform: 'darwin', home: '/Users/b' })[0], /\/Applications\/Beam\.app$/);
  assert.match(installPaths('beam', { platform: 'win32', env: { LOCALAPPDATA: 'C:\\L' }, home: 'C:\\U' })[0], /Programs.Utility Suite.Beam.Beam\.exe$/);
});

test('settings: defaults merge, nested modules and focus keep the rest', () => {
  const s = new Store(tmp());
  assert.equal(s.settings().style, DEFAULTS.style);
  s.setSettings({ modules: { match: false }, focus: { work: 50 } });
  const v = s.settings();
  assert.equal(v.modules.match, false); assert.equal(v.modules.media, true); assert.equal(v.focus.work, 50); assert.equal(v.focus.short, 5);
});

test('renderer: island and settings scripts parse; every icon used exists', () => {
  const vm = require('vm');
  const dir = path.join(__dirname, '..', 'src', 'renderer');
  for (const f of ['island.js', 'settings.js', 'icons.js']) new vm.Script(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f });
  const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(dir, 'icons.js'), 'utf8'), ctx);
  const names = new Set(ctx.window.ICON_NAMES);
  const used = new Set();
  for (const f of ['island.js', 'settings.js']) for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/icon\('([a-zA-Z]+)'/g)) used.add(m[1]);
  const missing = [...used].filter((n) => !names.has(n));
  assert.deepEqual(missing, []);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`  ✓ ${t.name}`); }
    catch (e) { failed++; console.log(`  ✗ ${t.name}\n    ${e.stack.split('\n').slice(0, 4).join('\n    ')}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
