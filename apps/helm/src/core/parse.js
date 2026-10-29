// Helm — controller report parsers. Pure functions: a raw HID report in, one normalized frame out.
//
// A frame is the same shape for every controller:
//   { kind, conn, b: { cross, circle, square, triangle, l1, r1, l2, r2, l3, r3, create, options, ps, pad, mute,
//                      up, down, left, right, fnL, fnR, paddleL, paddleR },
//     a: { lx, ly, rx, ry, lt, rt },            sticks -1..1 (y grows downward), triggers 0..1
//     t: [ { down, id, x, y }, … ],              touchpad points, 0..1 across and down the pad (empty if none)
//     hasTouch, battery (0..100 | null), charging }
// Layouts follow the Linux hid-playstation driver and SDL's HIDAPI drivers.
'use strict';

const SONY = 0x054c, MSFT = 0x045e;
const DEVICES = {
  [`${SONY}:${0x0ce6}`]: { kind: 'dualsense', name: 'DualSense' },
  [`${SONY}:${0x0df2}`]: { kind: 'edge', name: 'DualSense Edge' },
  [`${SONY}:${0x05c4}`]: { kind: 'ds4', name: 'DualShock 4' },
  [`${SONY}:${0x09cc}`]: { kind: 'ds4', name: 'DualShock 4' },
  [`${SONY}:${0x0ba0}`]: { kind: 'ds4', name: 'DualShock 4 (wireless adapter)' },
  // Xbox controllers over Bluetooth (newer firmware). On Windows these come through XInput instead.
  [`${MSFT}:${0x0b13}`]: { kind: 'xbox', name: 'Xbox Wireless Controller' },
  [`${MSFT}:${0x0b20}`]: { kind: 'xbox', name: 'Xbox One S Controller' },
  [`${MSFT}:${0x0b05}`]: { kind: 'xbox', name: 'Xbox Elite Controller 2' },
  [`${MSFT}:${0x0b22}`]: { kind: 'xbox', name: 'Xbox Elite Controller 2' },
  [`${MSFT}:${0x0b21}`]: { kind: 'xbox', name: 'Xbox Adaptive Controller' }
};
const identify = (vid, pid) => DEVICES[`${vid}:${pid}`] || null;

const BUTTONS = ['cross', 'circle', 'square', 'triangle', 'l1', 'r1', 'l2', 'r2', 'l3', 'r3', 'create', 'options', 'ps', 'pad', 'mute',
  'up', 'down', 'left', 'right', 'fnL', 'fnR', 'paddleL', 'paddleR'];
function blank(kind = 'none', conn = 'usb') {
  const b = {}; for (const k of BUTTONS) b[k] = false;
  return { kind, conn, b, a: { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 }, t: [], hasTouch: kind === 'dualsense' || kind === 'edge' || kind === 'ds4', battery: null, charging: false };
}
const stick = (v) => Math.max(-1, Math.min(1, (v - 128) / 127.5));
// hat: 0 up, 1 up-right … 7 up-left, 8 (or anything else) centred
function hat(f, h) {
  f.b.up = h === 0 || h === 1 || h === 7; f.b.right = h === 1 || h === 2 || h === 3;
  f.b.down = h === 3 || h === 4 || h === 5; f.b.left = h === 5 || h === 6 || h === 7;
}
function touchPoint(buf, o, w, h) {
  const c = buf[o]; const x = buf[o + 1] | ((buf[o + 2] & 0x0f) << 8); const y = (buf[o + 2] >> 4) | (buf[o + 3] << 4);
  return { down: !(c & 0x80), id: c & 0x7f, x: Math.min(1, x / w), y: Math.min(1, y / h) };
}

// ---------------------------------------------------------------- DualSense / DualSense Edge
// USB report 0x01 (64 bytes) and Bluetooth report 0x31 (78 bytes, one extra byte up front). Bluetooth starts in a short
// "simple" 0x01 report until feature report 0x05 is read; parseDualSense flags that so the reader can ask for it.
function parseDualSense(buf, kind = 'dualsense') {
  const id = buf[0];
  let o, conn;
  if (id === 0x01 && buf.length >= 54) { o = 1; conn = 'usb'; }
  else if (id === 0x31 && buf.length >= 55) { o = 2; conn = 'bt'; }
  else if (id === 0x01 && buf.length >= 10) return parseSimple(buf, kind);
  else return null;
  const f = blank(kind, conn);
  f.a.lx = stick(buf[o]); f.a.ly = stick(buf[o + 1]); f.a.rx = stick(buf[o + 2]); f.a.ry = stick(buf[o + 3]);
  f.a.lt = buf[o + 4] / 255; f.a.rt = buf[o + 5] / 255;
  const b0 = buf[o + 7], b1 = buf[o + 8], b2 = buf[o + 9];
  hat(f, b0 & 0x0f);
  f.b.square = !!(b0 & 0x10); f.b.cross = !!(b0 & 0x20); f.b.circle = !!(b0 & 0x40); f.b.triangle = !!(b0 & 0x80);
  f.b.l1 = !!(b1 & 0x01); f.b.r1 = !!(b1 & 0x02); f.b.l2 = !!(b1 & 0x04); f.b.r2 = !!(b1 & 0x08);
  f.b.create = !!(b1 & 0x10); f.b.options = !!(b1 & 0x20); f.b.l3 = !!(b1 & 0x40); f.b.r3 = !!(b1 & 0x80);
  f.b.ps = !!(b2 & 0x01); f.b.pad = !!(b2 & 0x02); f.b.mute = !!(b2 & 0x04);
  if (kind === 'edge') { f.b.fnL = !!(b2 & 0x10); f.b.fnR = !!(b2 & 0x20); f.b.paddleL = !!(b2 & 0x40); f.b.paddleR = !!(b2 & 0x80); }
  // touch points start 32 bytes into the data; status (battery) at 52
  const p0 = touchPoint(buf, o + 32, 1920, 1080), p1 = touchPoint(buf, o + 36, 1920, 1080);
  f.t = [p0, p1].filter((p) => p.down);
  const st = buf[o + 52];
  if (st != null) {
    const cap = st & 0x0f, chg = (st & 0xf0) >> 4;
    f.charging = chg === 0x1; f.battery = chg === 0x2 ? 100 : Math.min(100, cap * 10 + 5);
  }
  return f;
}
// Bluetooth "simple" report (DualSense and DualShock 4 before full mode): sticks, buttons, triggers; no touchpad.
function parseSimple(buf, kind) {
  const f = blank(kind, 'bt'); f.simple = true;
  f.a.lx = stick(buf[1]); f.a.ly = stick(buf[2]); f.a.rx = stick(buf[3]); f.a.ry = stick(buf[4]);
  const b0 = buf[5], b1 = buf[6], b2 = buf[7];
  hat(f, b0 & 0x0f);
  f.b.square = !!(b0 & 0x10); f.b.cross = !!(b0 & 0x20); f.b.circle = !!(b0 & 0x40); f.b.triangle = !!(b0 & 0x80);
  f.b.l1 = !!(b1 & 0x01); f.b.r1 = !!(b1 & 0x02); f.b.l2 = !!(b1 & 0x04); f.b.r2 = !!(b1 & 0x08);
  f.b.create = !!(b1 & 0x10); f.b.options = !!(b1 & 0x20); f.b.l3 = !!(b1 & 0x40); f.b.r3 = !!(b1 & 0x80);
  f.b.ps = !!(b2 & 0x01); f.b.pad = !!(b2 & 0x02);
  f.a.lt = (buf[8] || 0) / 255; f.a.rt = (buf[9] || 0) / 255;
  return f;
}

// ---------------------------------------------------------------- DualShock 4
// USB report 0x01 (64 bytes), Bluetooth report 0x11 (78 bytes, two extra bytes up front).
function parseDS4(buf) {
  const id = buf[0];
  let o, conn;
  if (id === 0x01 && buf.length >= 43) { o = 1; conn = 'usb'; }
  else if (id === 0x11 && buf.length >= 45) { o = 3; conn = 'bt'; }
  else if (id === 0x01 && buf.length >= 10) return parseSimple(buf, 'ds4');
  else return null;
  const f = blank('ds4', conn);
  f.a.lx = stick(buf[o]); f.a.ly = stick(buf[o + 1]); f.a.rx = stick(buf[o + 2]); f.a.ry = stick(buf[o + 3]);
  const b0 = buf[o + 4], b1 = buf[o + 5], b2 = buf[o + 6];
  hat(f, b0 & 0x0f);
  f.b.square = !!(b0 & 0x10); f.b.cross = !!(b0 & 0x20); f.b.circle = !!(b0 & 0x40); f.b.triangle = !!(b0 & 0x80);
  f.b.l1 = !!(b1 & 0x01); f.b.r1 = !!(b1 & 0x02); f.b.l2 = !!(b1 & 0x04); f.b.r2 = !!(b1 & 0x08);
  f.b.create = !!(b1 & 0x10); f.b.options = !!(b1 & 0x20); f.b.l3 = !!(b1 & 0x40); f.b.r3 = !!(b1 & 0x80);
  f.b.ps = !!(b2 & 0x01); f.b.pad = !!(b2 & 0x02);
  f.a.lt = buf[o + 7] / 255; f.a.rt = buf[o + 8] / 255;
  const st = buf[o + 29];
  if (st != null) { const cable = !!(st & 0x10), cap = st & 0x0f; f.charging = cable && cap < 11; f.battery = cable ? Math.min(100, cap * 10 + 5) : Math.min(100, cap * 10 + 5); }
  // first touch report: count at o+32, then timestamp, then two points
  const tp = o + 34;
  if (buf.length >= tp + 8) {
    const p0 = touchPoint(buf, tp, 1920, 943), p1 = touchPoint(buf, tp + 4, 1920, 943);
    f.t = [p0, p1].filter((p) => p.down);
  }
  return f;
}

// ---------------------------------------------------------------- Xbox over Bluetooth (HID report 0x01, 17 bytes)
function parseXboxBT(buf) {
  if (buf[0] !== 0x01 || buf.length < 16) return null;
  const f = blank('xbox', 'bt');
  const u16 = (i) => buf[i] | (buf[i + 1] << 8);
  const ax = (v) => Math.max(-1, Math.min(1, (v - 32768) / 32767.5));
  f.a.lx = ax(u16(1)); f.a.ly = ax(u16(3)); f.a.rx = ax(u16(5)); f.a.ry = ax(u16(7));
  f.a.lt = Math.min(1, u16(9) / 1023); f.a.rt = Math.min(1, u16(11) / 1023);
  const h = buf[13]; hat(f, h >= 1 && h <= 8 ? h - 1 : 8);
  const b0 = buf[14], b1 = buf[15], b2 = buf[16] || 0;
  f.b.cross = !!(b0 & 0x01); f.b.circle = !!(b0 & 0x02); f.b.square = !!(b0 & 0x08); f.b.triangle = !!(b0 & 0x10);
  f.b.l1 = !!(b0 & 0x40); f.b.r1 = !!(b0 & 0x80);
  f.b.create = !!(b1 & 0x04); f.b.options = !!(b1 & 0x08); f.b.ps = !!(b1 & 0x10); f.b.l3 = !!(b1 & 0x20); f.b.r3 = !!(b1 & 0x40);
  f.b.mute = !!(b2 & 0x01); // the Share button
  f.b.l2 = f.a.lt > 0.5; f.b.r2 = f.a.rt > 0.5;
  f.hasTouch = false;
  return f;
}

// ---------------------------------------------------------------- XInput (Windows), from the helper's "X" lines
function parseXInput(btn, lt, rt, lx, ly, rx, ry) {
  const f = blank('xinput', 'xinput'); f.hasTouch = false;
  const s = (v) => Math.max(-1, Math.min(1, v / 32767));
  f.a.lx = s(lx); f.a.ly = -s(ly); f.a.rx = s(rx); f.a.ry = -s(ry);
  f.a.lt = lt / 255; f.a.rt = rt / 255;
  f.b.up = !!(btn & 0x0001); f.b.down = !!(btn & 0x0002); f.b.left = !!(btn & 0x0004); f.b.right = !!(btn & 0x0008);
  f.b.options = !!(btn & 0x0010); f.b.create = !!(btn & 0x0020); f.b.l3 = !!(btn & 0x0040); f.b.r3 = !!(btn & 0x0080);
  f.b.l1 = !!(btn & 0x0100); f.b.r1 = !!(btn & 0x0200); f.b.ps = !!(btn & 0x0400);
  f.b.cross = !!(btn & 0x1000); f.b.circle = !!(btn & 0x2000); f.b.square = !!(btn & 0x4000); f.b.triangle = !!(btn & 0x8000);
  f.b.l2 = f.a.lt > 0.5; f.b.r2 = f.a.rt > 0.5;
  return f;
}

function parseReport(kind, buf) {
  if (kind === 'dualsense' || kind === 'edge') return parseDualSense(buf, kind);
  if (kind === 'ds4') return parseDS4(buf);
  if (kind === 'xbox') return parseXboxBT(buf);
  return null;
}

// ---------------------------------------------------------------- output reports (lightbar, player lights, rumble)
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
// Bluetooth output reports end with a CRC-32 over [prefix, …report], little endian
function sealCrc(buf, prefix) {
  const body = buf.subarray(0, buf.length - 4);
  let c = 0xffffffff; c = CRC_TABLE[(c ^ prefix) & 0xff] ^ (c >>> 8);
  for (const b of body) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  buf.writeUInt32LE((c ^ 0xffffffff) >>> 0, buf.length - 4);
  return buf;
}

/** DualSense output: { rgb:[r,g,b], players:0..31 bitmask, rumble:[left,right] 0..255, seq } -> Buffer */
function dualSenseOutput(conn, { rgb = null, players = null, rumble = null, seq = 0 } = {}) {
  const common = Buffer.alloc(47);
  if (rumble) { common[0] = 0x01 | 0x02; common[2] = rumble[1] & 0xff; common[3] = rumble[0] & 0xff; }
  if (rgb) { common[1] |= 0x04; common[44] = rgb[0]; common[45] = rgb[1]; common[46] = rgb[2]; }
  if (players != null) { common[1] |= 0x10; common[43] = players & 0x1f; common[42] = 0x00; }
  if (conn === 'bt') {
    const b = Buffer.alloc(78); b[0] = 0x31; b[1] = (seq & 0x0f) << 4; b[2] = 0x10; common.copy(b, 3);
    return sealCrc(b, 0xa2);
  }
  const b = Buffer.alloc(48); b[0] = 0x02; common.copy(b, 1); return b;
}
/** DualShock 4 output, same options (no player lights). */
function ds4Output(conn, { rgb = null, rumble = null } = {}) {
  const common = Buffer.alloc(10);
  if (rumble) { common[0] |= 0x01; common[3] = rumble[1] & 0xff; common[4] = rumble[0] & 0xff; }
  if (rgb) { common[0] |= 0x02; common[5] = rgb[0]; common[6] = rgb[1]; common[7] = rgb[2]; }
  if (conn === 'bt') {
    const b = Buffer.alloc(78); b[0] = 0x11; b[1] = 0xc0; b[2] = 0x00; common.copy(b, 3);
    return sealCrc(b, 0xa2);
  }
  const b = Buffer.alloc(32); b[0] = 0x05; common.copy(b, 1); return b;
}

module.exports = { SONY, MSFT, DEVICES, identify, BUTTONS, blank, parseDualSense, parseDS4, parseXboxBT, parseXInput, parseReport, dualSenseOutput, ds4Output, crc32, sealCrc };
