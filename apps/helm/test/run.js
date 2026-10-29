// Helm — Node checks for the parts that don't need a real controller or a real computer.
'use strict';
const assert = require('assert');
const P = require('../src/core/parse');
const { Mapper } = require('../src/core/mapper');
const { Touchpad } = require('../src/core/touchpad');
const { Keyboard } = require('../src/core/keyboard');
const { Panel } = require('../src/core/panel');
const { ACTIONS, BY_ID, DEFAULT_BINDINGS, specFor } = require('../src/core/actions');
const { macChar, macFlags, WIN } = require('../src/core/keys');
const { GameGuard, matches } = require('../src/games');
const { Output } = require('../src/output');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  \u2713 ' + name); } catch (e) { fail++; console.log('  \u2717 ' + name + '\n     ' + (e.stack || e).split('\n').slice(0, 3).join('\n     ')); } }
async function ta(name, fn) { try { await fn(); pass++; console.log('  \u2713 ' + name); } catch (e) { fail++; console.log('  \u2717 ' + name + '\n     ' + (e.stack || e).split('\n').slice(0, 3).join('\n     ')); } }

// ------------------------------------------------------------ report builders
function dsReport({ conn = 'usb', lx = 128, ly = 128, rx = 128, ry = 128, l2 = 0, r2 = 0, hat = 8, face = 0, b1 = 0, b2 = 0, touches = [], status = 0x08 } = {}) {
  const o = conn === 'usb' ? 1 : 2; const buf = Buffer.alloc(conn === 'usb' ? 64 : 78);
  buf[0] = conn === 'usb' ? 0x01 : 0x31;
  buf[o] = lx; buf[o + 1] = ly; buf[o + 2] = rx; buf[o + 3] = ry; buf[o + 4] = l2; buf[o + 5] = r2;
  buf[o + 7] = (hat & 0x0f) | face; buf[o + 8] = b1; buf[o + 9] = b2;
  for (let i = 0; i < 2; i++) {
    const p = touches[i]; const at = o + 32 + i * 4;
    if (!p) { buf[at] = 0x80; continue; }
    const x = Math.round(p.x * 1919), y = Math.round(p.y * 1079);
    buf[at] = p.id & 0x7f; buf[at + 1] = x & 0xff; buf[at + 2] = ((x >> 8) & 0x0f) | ((y & 0x0f) << 4); buf[at + 3] = y >> 4;
  }
  buf[o + 52] = status;
  return buf;
}

console.log('parse');
t('DualSense USB: sticks, face buttons, d-pad, triggers', () => {
  const f = P.parseDualSense(dsReport({ lx: 255, ly: 0, hat: 2, face: 0x20 | 0x80, l2: 255, b1: 0x08 | 0x20, b2: 0x01 }));
  assert.strictEqual(f.conn, 'usb'); assert.ok(f.a.lx > 0.99 && f.a.ly < -0.99);
  assert.ok(f.b.cross && f.b.triangle && !f.b.square && !f.b.circle); assert.ok(f.b.right && !f.b.up);
  assert.ok(f.a.lt === 1 && f.b.r2 && f.b.options && f.b.ps && !f.b.create);
});
t('DualSense touch points and battery', () => {
  const f = P.parseDualSense(dsReport({ touches: [{ id: 3, x: 0.25, y: 0.5 }, { id: 4, x: 0.75, y: 0.1 }], status: 0x07 }));
  assert.strictEqual(f.t.length, 2); assert.ok(Math.abs(f.t[0].x - 0.25) < 0.002 && Math.abs(f.t[0].y - 0.5) < 0.002);
  assert.strictEqual(f.t[1].id, 4); assert.strictEqual(f.battery, 75); assert.ok(!f.charging);
  const g = P.parseDualSense(dsReport({ status: 0x15 })); assert.ok(g.charging); assert.strictEqual(g.battery, 55);
});
t('DualSense Bluetooth full report is offset by one', () => {
  const f = P.parseDualSense(dsReport({ conn: 'bt', rx: 0, face: 0x40, touches: [{ id: 1, x: 1, y: 1 }] }));
  assert.strictEqual(f.conn, 'bt'); assert.ok(f.a.rx < -0.99 && f.b.circle && f.t.length === 1 && f.t[0].x > 0.99);
});
t('Bluetooth simple report parses and asks for full mode', () => {
  const b = Buffer.alloc(10); b[0] = 1; b[1] = 128; b[2] = 128; b[3] = 128; b[4] = 128; b[5] = 0x08 | 0x20; b[6] = 0x02; b[7] = 0x01;
  const f = P.parseDualSense(b); assert.ok(f.simple && f.b.cross && f.b.r1 && f.b.ps);
});
t('DualShock 4 USB with a touch', () => {
  const b = Buffer.alloc(64); b[0] = 1; b[1] = 0; b[2] = 128; b[3] = 128; b[4] = 255; b[5] = 0x38; b[6] = 0x30; b[7] = 0x02; b[30] = 0x1a;
  const x = 960, y = 470; b[35] = 0x05; b[36] = x & 0xff; b[37] = ((x >> 8) & 0x0f) | ((y & 0x0f) << 4); b[38] = y >> 4; b[39] = 0x80;
  const f = P.parseDS4(b);
  assert.ok(f.a.lx < -0.99 && f.a.ry > 0.99 && f.b.square && f.b.cross && f.b.create && f.b.options && f.b.pad);
  assert.strictEqual(f.t.length, 1); assert.ok(Math.abs(f.t[0].x - 0.5) < 0.01 && Math.abs(f.t[0].y - 0.5) < 0.01);
  assert.ok(f.charging);
});
t('Xbox Bluetooth', () => {
  const b = Buffer.alloc(17); b[0] = 1; b.writeUInt16LE(65535, 1); b.writeUInt16LE(32768, 3); b.writeUInt16LE(32768, 5); b.writeUInt16LE(0, 7);
  b.writeUInt16LE(1023, 9); b[13] = 1; b[14] = 0x01 | 0x10; b[15] = 0x08 | 0x10;
  const f = P.parseXboxBT(b);
  assert.ok(f.a.lx > 0.99 && f.a.ry < -0.99 && f.a.lt === 1 && f.b.l2 && f.b.up && f.b.cross && f.b.triangle && f.b.options && f.b.ps && !f.hasTouch);
});
t('XInput', () => {
  const f = P.parseXInput(0x1000 | 0x0200 | 0x0010 | 0x0400, 0, 255, 32767, 32767, 0, -32768);
  assert.ok(f.b.cross && f.b.r1 && f.b.options && f.b.ps && f.b.r2 && f.a.lx > 0.99 && f.a.ly < -0.99 && f.a.ry > 0.99);
});
t('output reports: sizes, colour bytes and CRC', () => {
  const u = P.dualSenseOutput('usb', { rgb: [1, 2, 3], players: 4 }); assert.strictEqual(u.length, 48); assert.strictEqual(u[0], 2); assert.deepStrictEqual([...u.subarray(45, 48)], [1, 2, 3]); assert.strictEqual(u[44], 4);
  const b = P.dualSenseOutput('bt', { rgb: [9, 8, 7], rumble: [10, 20] }); assert.strictEqual(b.length, 78); assert.strictEqual(b[0], 0x31);
  const crc = P.crc32(Buffer.concat([Buffer.from([0xa2]), b.subarray(0, 74)])); assert.strictEqual(b.readUInt32LE(74), crc);
  assert.strictEqual(P.crc32(Buffer.from('123456789')), 0xcbf43926);
  const d = P.ds4Output('usb', { rgb: [5, 6, 7] }); assert.strictEqual(d.length, 32); assert.deepStrictEqual([...d.subarray(6, 9)], [5, 6, 7]);
});

// ------------------------------------------------------------ mapper with fakes
function rig(settings = {}, platform = 'darwin') {
  const log = []; const ui = { log: [] };
  const out = {
    moveBy: (dx, dy) => log.push(['move', dx, dy]), mouse: (b, d) => log.push(['mouse', b, d]), scroll: (dx, dy) => log.push(['scroll', dx, dy]),
    key: (k, m, d) => log.push(['key', k, m.join('+'), d]), combo: (k, m) => log.push(['combo', k, m.join('+')]), text: (s) => log.push(['text', s]),
    media: (m) => log.push(['media', m]), command: (c) => log.push(['command', c])
  };
  const uiFns = { hud: (s) => ui.log.push(['hud', s]), keyboard: (v) => ui.log.push(['kb', !!v]), panel: (v) => ui.log.push(['panel', !!v]), layerHint: (v) => ui.log.push(['hint', !!v]), state: (s) => ui.log.push(['state', s]), haptic: () => {} };
  const m = new Mapper({ out, ui: uiFns, settings: () => settings, platform });
  let now = 1000;
  const frame = (fn) => { const f = P.blank('dualsense'); if (fn) fn(f); return f; };
  const step = (f, ms = 8) => { m.update(f); now += ms; m.tick(now); };
  const hold = (f, ms) => { for (let i = 0; i < ms / 8; i++) step(f); };
  return { m, log, ui, frame, step, hold, get now() { return now; } };
}
const sum = (log, type) => log.filter((e) => e[0] === type).reduce((a, e) => [a[0] + e[1], a[1] + e[2]], [0, 0]);

console.log('mapper');
t('left stick moves the pointer smoothly and stops inside the deadzone', () => {
  const r = rig(); const right = r.frame((f) => { f.a.lx = 1; });
  r.hold(right, 500);
  const [dx, dy] = sum(r.log, 'move'); assert.ok(dx > 400 && dx < 900 && Math.abs(dy) < 1, `moved ${dx}`);
  r.log.length = 0; r.hold(r.frame((f) => { f.a.lx = 0.1; }), 400);
  assert.ok(Math.abs(sum(r.log, 'move')[0]) < 40);
  r.log.length = 0; r.hold(r.frame(), 200); assert.strictEqual(r.log.filter((e) => e[0] === 'move').length, 0);
});
t('holding L2 slows the pointer', () => {
  const a = rig(); a.hold(a.frame((f) => { f.a.lx = 1; }), 300);
  const b = rig(); b.hold(b.frame((f) => { f.a.lx = 1; f.a.lt = 1; f.b.l2 = true; }), 300);
  assert.ok(sum(b.log, 'move')[0] < sum(a.log, 'move')[0] * 0.45);
});
t('Cross is a held left button (drag works)', () => {
  const r = rig(); r.step(r.frame((f) => { f.b.cross = true; })); r.step(r.frame((f) => { f.b.cross = true; f.a.lx = 1; })); r.step(r.frame());
  const m = r.log.filter((e) => e[0] === 'mouse'); assert.deepStrictEqual(m, [['mouse', 'left', true], ['mouse', 'left', false]]);
});
t('right stick scrolls; up shows what is above', () => {
  const r = rig(); r.hold(r.frame((f) => { f.a.ry = -1; }), 200);
  const [, dy] = sum(r.log, 'scroll'); assert.ok(dy < -150, `dy ${dy}`);
  const i = rig({ invertScroll: true }); i.hold(i.frame((f) => { f.a.ry = -1; }), 200); assert.ok(sum(i.log, 'scroll')[1] > 150);
});
t('Circle sends Escape held, d-pad arrows repeat', () => {
  const r = rig(); r.step(r.frame((f) => { f.b.circle = true; })); r.step(r.frame());
  assert.deepStrictEqual(r.log.filter((e) => e[0] === 'key'), [['key', 'escape', '', true], ['key', 'escape', '', false]]);
  r.log.length = 0; r.hold(r.frame((f) => { f.b.down = true; }), 800); r.step(r.frame());
  const downs = r.log.filter((e) => e[0] === 'key' && e[1] === 'down' && e[3]); assert.ok(downs.length >= 5, `repeats ${downs.length}`);
});
t('L1 / R1 are back and forward (per platform)', () => {
  const r = rig(); r.step(r.frame((f) => { f.b.l1 = true; })); r.step(r.frame());
  assert.deepStrictEqual(r.log.find((e) => e[0] === 'combo'), ['combo', '[', 'cmd']);
  const w = rig({}, 'win32'); w.step(w.frame((f) => { f.b.r1 = true; })); w.step(w.frame());
  assert.deepStrictEqual(w.log.find((e) => e[0] === 'combo'), ['combo', 'right', 'alt']);
});
t('Options opens Mission Control on release; Create + Options held turns Helm off and fires neither', () => {
  const r = rig(); r.step(r.frame((f) => { f.b.options = true; })); assert.ok(!r.log.some((e) => e[0] === 'command'));
  r.step(r.frame()); assert.deepStrictEqual(r.log.find((e) => e[0] === 'command'), ['command', 'missionControl']);
  const c = rig(); c.hold(c.frame((f) => { f.b.create = true; f.b.options = true; }), 800); c.step(c.frame());
  assert.ok(!c.m.enabled); assert.ok(!c.log.some((e) => e[0] === 'command' || e[0] === 'combo'));
  c.log.length = 0; c.hold(c.frame((f) => { f.a.lx = 1; }), 100); assert.strictEqual(c.log.length, 0, 'nothing happens while off');
  c.hold(c.frame((f) => { f.b.create = true; f.b.options = true; }), 800); c.step(c.frame()); assert.ok(c.m.enabled);
});
t('hold R2: d-pad switches desktops, hint appears, R1 runs the app switcher holding \u2318', () => {
  const r = rig();
  r.step(r.frame((f) => { f.b.r2 = true; f.a.rt = 1; }));
  r.step(r.frame((f) => { f.b.r2 = true; f.b.right = true; })); r.step(r.frame((f) => { f.b.r2 = true; }));
  assert.deepStrictEqual(r.log.find((e) => e[0] === 'combo'), ['combo', 'right', 'ctrl']);
  r.hold(r.frame((f) => { f.b.r2 = true; }), 500); assert.ok(r.ui.log.some((e) => e[0] === 'hint' && e[1]));
  r.log.length = 0;
  r.step(r.frame((f) => { f.b.r2 = true; f.b.r1 = true; })); r.step(r.frame((f) => { f.b.r2 = true; }));
  r.step(r.frame((f) => { f.b.r2 = true; f.b.r1 = true; })); r.step(r.frame((f) => { f.b.r2 = true; }));
  assert.deepStrictEqual(r.log.slice(0, 2), [['key', 'cmd', '', true], ['combo', 'tab', 'cmd']]);
  assert.ok(!r.log.some((e) => e[0] === 'key' && !e[3]), 'still holding');
  r.step(r.frame()); assert.deepStrictEqual(r.log[r.log.length - 1], ['key', 'cmd', '', false]);
  assert.ok(r.ui.log.some((e) => e[0] === 'hint' && !e[1]));
});
t('hold R2 + right stick is the volume', () => {
  const r = rig(); r.hold(r.frame((f) => { f.b.r2 = true; f.a.ry = -1; }), 700);
  const ups = r.log.filter((e) => e[0] === 'media' && e[1] === 'volumeup').length; assert.ok(ups >= 4 && ups <= 12, `ups ${ups}`);
  assert.ok(!r.log.some((e) => e[0] === 'scroll'));
});
t('paused for a game: nothing reaches the computer, held buttons are let go', () => {
  const r = rig(); r.step(r.frame((f) => { f.b.cross = true; }));
  r.m.setPaused('Skyline Protocol'); assert.deepStrictEqual(r.log[r.log.length - 1], ['mouse', 'left', false]);
  r.log.length = 0; r.hold(r.frame((f) => { f.a.lx = 1; f.b.cross = true; }), 200); assert.strictEqual(r.log.length, 0);
  r.m.setPaused(null); r.step(r.frame()); r.hold(r.frame((f) => { f.a.lx = 1; }), 50); assert.ok(r.log.length > 0);
});
t('unbound or unavailable actions say so instead of failing', () => {
  const r = rig({ bindings: { base: { cross: 'notifications' } } });
  r.step(r.frame((f) => { f.b.cross = true; })); r.step(r.frame());
  assert.ok(r.ui.log.some((e) => e[0] === 'hud' && /isn.t available/.test(e[1])));
});

console.log('touchpad');
function pad(settings = {}) { const tp = new Touchpad(() => settings); let now = 0; return { tp, go: (touches, down = false, ms = 8) => { now += ms; return tp.update(touches, down, now); } }; }
t('one finger moves; a quick tap clicks', () => {
  const { go } = pad(); go([{ id: 1, x: 0.5, y: 0.5 }]); const ev = go([{ id: 1, x: 0.52, y: 0.5 }]);
  assert.ok(ev[0].type === 'move' && ev[0].dx > 20);
  const p2 = pad(); p2.go([{ id: 1, x: 0.5, y: 0.5 }]); p2.go([{ id: 1, x: 0.5, y: 0.5 }]); const e2 = p2.go([]);
  assert.deepStrictEqual(e2, [{ type: 'tap', button: 'left' }]);
});
t('pressing the pad clicks and moving while pressed drags; two-finger press right-clicks', () => {
  const { go } = pad();
  const a = go([{ id: 1, x: 0.3, y: 0.5 }], true); assert.deepStrictEqual(a[0], { type: 'button', button: 'left', down: true });
  const b = go([{ id: 1, x: 0.4, y: 0.5 }], true); assert.ok(b.some((e) => e.type === 'move'));
  const c = go([], false); assert.ok(c.some((e) => e.type === 'button' && !e.down) && !c.some((e) => e.type === 'tap'));
  const p2 = pad(); const r = p2.go([{ id: 1, x: 0.3, y: 0.5 }, { id: 2, x: 0.6, y: 0.5 }], true); assert.strictEqual(r[0].button, 'right');
});
t('two fingers scroll (naturally) with momentum, and a two-finger tap right-clicks', () => {
  const { go } = pad(); let y = 0.7; go([{ id: 1, x: 0.4, y }, { id: 2, x: 0.6, y }]);
  let s = 0; for (let i = 0; i < 10; i++) { y -= 0.04; for (const e of go([{ id: 1, x: 0.4, y }, { id: 2, x: 0.6, y }])) if (e.type === 'scroll') s += e.dy; }
  assert.ok(s > 200, `fingers up shows what's below: ${s}`);
  let m = 0; for (let i = 0; i < 40; i++) for (const e of go([])) if (e.type === 'scroll') m += e.dy;
  assert.ok(m > 20, `momentum ${m}`);
  const p2 = pad(); p2.go([{ id: 3, x: 0.4, y: 0.5 }, { id: 4, x: 0.6, y: 0.5 }]); p2.go([{ id: 3, x: 0.4, y: 0.5 }, { id: 4, x: 0.6, y: 0.5 }]);
  assert.deepStrictEqual(p2.go([]), [{ type: 'tap', button: 'right' }]);
});
t('two-finger swipe sideways switches desktops once', () => {
  const { go } = pad(); let x = 0.7; const all = [];
  go([{ id: 1, x, y: 0.4 }, { id: 2, x: x - 0.1, y: 0.6 }]);
  for (let i = 0; i < 12; i++) { x -= 0.04; all.push(...go([{ id: 1, x, y: 0.4 }, { id: 2, x: x - 0.1, y: 0.6 }])); }
  all.push(...go([]));
  const sw = all.filter((e) => e.type === 'swipe'); assert.strictEqual(sw.length, 1); assert.strictEqual(sw[0].dir, 'left');
  assert.ok(!all.some((e) => e.type === 'scroll' || e.type === 'tap'));
});
t('mapper: swiping left goes to the desktop on the right', () => {
  const r = rig(); let x = 0.8;
  for (let i = 0; i < 14; i++) { x -= 0.04; r.step(r.frame((f) => { f.t = [{ down: true, id: 1, x, y: 0.4 }, { down: true, id: 2, x: x - 0.1, y: 0.6 }]; })); }
  r.step(r.frame()); assert.deepStrictEqual(r.log.find((e) => e[0] === 'combo'), ['combo', 'right', 'ctrl']);
});

console.log('keyboard and quick panel');
t('keyboard types letters, shift once, caps, symbols and \u2318 shortcuts', () => {
  const kb = new Keyboard('darwin');
  kb.row = 1; kb.col = 1; assert.deepStrictEqual(kb.press(), { type: 'text', text: 'q' });
  kb.press('shift'); kb.row = 1; kb.col = 2; assert.deepStrictEqual(kb.press(), { type: 'text', text: 'W' }); assert.deepStrictEqual(kb.press(), { type: 'text', text: 'w' });
  kb.press('caps'); assert.strictEqual(kb.press().text, 'W'); kb.press('caps');
  kb.press('mod'); kb.row = 2; kb.col = 1; assert.deepStrictEqual(kb.press(), { type: 'combo', key: 'a', mods: ['cmd'] });
  kb.press('mode'); assert.strictEqual(kb.layout, 'sym'); kb.row = 0; kb.col = 0; assert.strictEqual(kb.press().text, '!');
  assert.deepStrictEqual(kb.press('backspace'), { type: 'key', key: 'backspace' });
  assert.deepStrictEqual(kb.press(' '), { type: 'text', text: ' ' });
});
t('keyboard navigation keeps the column under the finger and the touchpad points at keys', () => {
  const kb = new Keyboard('win32'); kb.row = 0; kb.col = 10; kb.move('down'); const k = kb.key(); assert.ok(k.k === "'" || k.k === 'p', k.k);
  kb.move('right'); kb.move('right'); assert.strictEqual(kb.col, (kb.rows()[1].length + 1) % kb.rows()[1].length === 0 ? 0 : kb.col);
  kb.pointAt(0.02, 0.99); assert.strictEqual(kb.key().type, 'mode'); kb.pointAt(0.5, 0.99); assert.strictEqual(kb.key().k, ' ');
  kb.pointAt(0.99, 0.01); assert.strictEqual(kb.key().k, 'backspace');
});
t('mapper: Triangle opens the keyboard, Cross types, Circle closes', () => {
  const r = rig(); r.step(r.frame((f) => { f.b.triangle = true; })); r.step(r.frame()); assert.strictEqual(r.m.mode, 'keyboard');
  r.m.kb.row = 1; r.m.kb.col = 3; r.step(r.frame((f) => { f.b.cross = true; })); r.step(r.frame());
  assert.deepStrictEqual(r.log.find((e) => e[0] === 'text'), ['text', 'e']);
  r.step(r.frame((f) => { f.b.square = true; })); r.step(r.frame()); assert.ok(r.log.some((e) => e[0] === 'combo' && e[1] === 'backspace'));
  r.log.length = 0; r.hold(r.frame((f) => { f.a.lx = 1; }), 100); assert.ok(!r.log.some((e) => e[0] === 'move'), 'stick moves the highlight, not the pointer');
  r.step(r.frame((f) => { f.b.circle = true; })); r.step(r.frame()); assert.strictEqual(r.m.mode, 'pointer');
  assert.ok(!r.log.some((e) => e[0] === 'key' && e[1] === 'escape'), 'closing the keyboard is not an Escape');
});
t('mapper: PS opens the quick panel; a tile runs and closes it', () => {
  const r = rig(); r.step(r.frame((f) => { f.b.ps = true; })); r.step(r.frame()); assert.strictEqual(r.m.mode, 'panel');
  r.step(r.frame((f) => { f.b.right = true; })); r.step(r.frame()); r.step(r.frame((f) => { f.b.right = true; })); r.step(r.frame());
  assert.strictEqual(r.m.panel.current().id, 'overview');
  r.step(r.frame((f) => { f.b.cross = true; })); r.step(r.frame());
  assert.deepStrictEqual(r.log.find((e) => e[0] === 'command'), ['command', 'missionControl']); assert.strictEqual(r.m.mode, 'pointer');
  const p = new Panel('win32'); assert.strictEqual(p.tiles()[2].label, 'Task View');
});

console.log('actions and keys');
t('every binding names a real action that works on both systems or says why not', () => {
  for (const layer of ['base', 'layer']) for (const [b, id] of Object.entries(DEFAULT_BINDINGS[layer])) assert.ok(BY_ID[id], `${layer}.${b} -> ${id}`);
  for (const a of ACTIONS) if (['key', 'combo'].includes(a.kind)) { assert.ok(specFor(a, 'darwin') && specFor(a, 'win32'), a.id); }
});
t('Mac typing map and arrow flags', () => {
  assert.deepStrictEqual(macChar('A'), { code: 0, shift: true }); assert.deepStrictEqual(macChar('?'), { code: 44, shift: true });
  assert.strictEqual(macChar('\u00e9'), null);
  assert.ok(macFlags(['ctrl'], 'right') & 0x800000); assert.ok(macFlags(['ctrl'], 'right') & 0x40000);
  assert.strictEqual(WIN.a, 0x41); assert.strictEqual(WIN.f5, 0x74);
});

console.log('games and output');
t('the games list matches by name, bundle or exe', () => {
  assert.ok(matches(['Skyline Protocol'], { name: 'Skyline Protocol', id: 'com.bilal.skyline' }));
  assert.ok(matches(['skyline'], { name: 'Electron', id: '', path: 'C:\\Games\\Skyline.exe' }));
  assert.ok(!matches(['Game Hub'], { name: 'Finder', id: 'com.apple.finder' }));
});
async function guardCase() {
  let reason = null; const plat = { front: async () => front }; let front = { pid: 9, name: 'Finder', id: 'com.apple.finder', bounds: { x: 0, y: 0, width: 800, height: 600 } };
  const g = new GameGuard({ platform: plat, settings: () => ({ gameApps: ['Game Hub'], keepApps: ['Safari'] }), screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1512, height: 982 } }] }, onChange: (r) => { reason = r; }, selfPid: 1 });
  await g.check(); assert.strictEqual(reason, null);
  front = { pid: 10, name: 'Game Hub', id: 'com.bilal.gamehub', bounds: { x: 0, y: 0, width: 800, height: 600 } }; await g.check(); assert.strictEqual(reason, 'Game Hub');
  g.overrideNow(); assert.strictEqual(reason, null); await g.check(); assert.strictEqual(reason, null, 'override sticks while the same app is in front');
  front = { pid: 11, name: 'Some Game', id: 'x', bounds: { x: 0, y: 0, width: 1512, height: 982 } }; await g.check(); assert.strictEqual(reason, 'Some Game', 'full screen app pauses');
  front = { pid: 12, name: 'Safari', id: 'com.apple.Safari', bounds: { x: 0, y: 0, width: 1512, height: 982 } }; await g.check(); assert.strictEqual(reason, null, 'but not a full-screen browser');
  g.claim('gamehub', 5, 'Game Hub'); assert.strictEqual(reason, 'Game Hub'); g.release('gamehub'); assert.strictEqual(reason, null);
}
t('Output keeps sub-pixel motion, follows the real mouse and stays on screen', () => {
  const sent = []; let cur = { x: 100, y: 100 };
  const o = new Output({ name: 'mac', moveTo: (x, y) => { sent.push([x, y]); cur = { x: Math.round(x), y: Math.round(y) }; } }, { getCursorScreenPoint: () => cur, getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1000, height: 800 } }] });
  for (let i = 0; i < 10; i++) o.moveBy(0.3, 0); assert.ok(Math.abs(sent[sent.length - 1][0] - 103) < 0.01);
  cur = { x: 500, y: 500 }; o.moveBy(1, 0); assert.deepStrictEqual(sent[sent.length - 1], [501, 500]);
  o.moveBy(5000, 0); assert.strictEqual(sent[sent.length - 1][0], 999);
  const w = []; const ow = new Output({ name: 'win', wheel: (dy, dx) => w.push([dy, dx]) }, {}); for (let i = 0; i < 4; i++) ow.scroll(0, 0.4); assert.deepStrictEqual(w, [[1, 0], [1, 0]]);
});

(async () => {
  await ta('game guard: list, full screen, keep list, override, claims', guardCase);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
