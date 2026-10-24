// A pretend emulator for DROID_DEMO=1 and the tests: serves the same gRPC API as the real one, draws a
// simple home screen, reacts to taps, and answers "emu kill" on its console port like the real thing.
// Run with: node fake-emulator.js -avd <name> -port <p> -grpc <g> ...
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const avd = arg('-avd', 'droid_demo');
const port = +arg('-port', 5554);
const grpcPort = +arg('-grpc', 8554);
const avdHome = process.env.ANDROID_AVD_HOME || path.join(os.homedir(), '.android', 'avd');
const cfgText = (() => { try { return fs.readFileSync(path.join(avdHome, `${avd}.avd`, 'config.ini'), 'utf8'); } catch { return ''; } })();
const cfg = Object.fromEntries(cfgText.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const W = +cfg['hw.lcd.width'] || 1080, H = +cfg['hw.lcd.height'] || 2400;
const stateDir = path.join(avdHome, `${avd}.avd`, 'demo');
fs.mkdirSync(stateDir, { recursive: true });
const BOOT_MS = +(process.env.DROID_DEMO_BOOT_MS || 2500);
const t0 = Date.now();

// ── drawing (natural orientation, RGB888)
const fb = Buffer.alloc(W * H * 3);
const ripples = [];
let rotation = 0, screenOn = true, page = 'home', clip = '', gps = { lat: 0, lng: 0 }, lastKey = '';
let seq = 0;
const apps = () => { try { return JSON.parse(fs.readFileSync(path.join(stateDir, 'apps.json'), 'utf8')); } catch { return []; } };
function rect(x0, y0, x1, y1, r, g, b) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(W, x1 | 0); y1 = Math.min(H, y1 | 0);
  for (let y = y0; y < y1; y++) { let o = (y * W + x0) * 3; for (let x = x0; x < x1; x++) { fb[o++] = r; fb[o++] = g; fb[o++] = b; } }
}
function circle(cx, cy, rad, r, g, b, a = 1) {
  for (let y = Math.max(0, cy - rad | 0); y < Math.min(H, cy + rad); y++) for (let x = Math.max(0, cx - rad | 0); x < Math.min(W, cx + rad); x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 > rad * rad) continue;
    const o = (y * W + x) * 3; fb[o] = fb[o] * (1 - a) + r * a; fb[o + 1] = fb[o + 1] * (1 - a) + g * a; fb[o + 2] = fb[o + 2] * (1 - a) + b * a;
  }
}
function rrect(x0, y0, x1, y1, rad, r, g, b) {
  rect(x0 + rad, y0, x1 - rad, y1, r, g, b); rect(x0, y0 + rad, x1, y1 - rad, r, g, b);
  for (const [cx, cy] of [[x0 + rad, y0 + rad], [x1 - rad, y0 + rad], [x0 + rad, y1 - rad], [x1 - rad, y1 - rad]]) circle(cx, cy, rad, r, g, b);
}
// 5x7 digits and a few letters for the clock and labels
const FONT = { '0': '0e1113151911 0e', '1': '04 0c 04 04 04 04 0e', '2': '0e 11 01 02 04 08 1f', '3': '1f 02 04 02 01 11 0e', '4': '02 06 0a 12 1f 02 02', '5': '1f 10 1e 01 01 11 0e', '6': '06 08 10 1e 11 11 0e', '7': '1f 01 02 04 08 08 08', '8': '0e 11 11 0e 11 11 0e', '9': '0e 11 11 0f 01 02 0c', ':': '00 0c 0c 00 0c 0c 00' };
function text(str, x, y, s, r, g, b) {
  for (const ch of str) {
    const f = FONT[ch];
    if (f) { const rows = f.replace(/\s/g, '').match(/../g).map((h) => parseInt(h, 16)); rows.slice(0, 7).forEach((bits, ry) => { for (let rx = 0; rx < 5; rx++) if (bits & (16 >> rx)) rect(x + rx * s, y + ry * s, x + rx * s + s, y + ry * s + s, r, g, b); }); }
    x += 6 * s;
  }
}
const COLORS = [[255, 112, 67], [66, 165, 245], [102, 187, 106], [171, 71, 188], [255, 202, 40], [38, 198, 218], [236, 64, 122], [141, 110, 99]];
function draw() {
  const u = W / 1080;
  if (!screenOn) { fb.fill(0); return; }
  const booting = Date.now() - t0 < BOOT_MS;
  if (booting) { fb.fill(0); const p = ((Date.now() - t0) / BOOT_MS); circle(W / 2, H / 2, 60 * u + 20 * u * Math.sin(p * 12), 61, 220, 132); return; }
  if (!draw.bg) { for (let y = 0; y < H; y++) { const k = y / H; rect(0, y, W, y + 1, 24 + 40 * k, 30 + 90 * (1 - k), 60 + 120 * k); } draw.bg = Buffer.from(fb); }
  draw.bg.copy(fb);
  const d = new Date(); text(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, 40 * u, 26 * u, Math.max(2, 5 * u | 0), 255, 255, 255);
  if (page === 'home') {
    text(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, W / 2 - 150 * u, H * 0.18, Math.max(4, 18 * u | 0), 255, 255, 255);
    const list = [{ c: 0 }, { c: 1 }, { c: 2 }, { c: 3 }, ...apps().map((a, i) => ({ c: 4 + (i % 4), pkg: a }))];
    const cols = W > H ? 8 : 4, cell = W / cols, sz = Math.min(cell * 0.62, 170 * u);
    list.forEach((a, i) => {
      const cx = (i % cols) * cell + cell / 2, cy = H * (W > H ? 0.45 : 0.55) + Math.floor(i / cols) * cell;
      const [r, g, b] = COLORS[a.c % COLORS.length];
      rrect(cx - sz / 2, cy - sz / 2, cx + sz / 2, cy + sz / 2, sz * 0.28, r, g, b);
    });
    rrect(W * 0.08, H - 230 * u, W * 0.92, H - 110 * u, 60 * u, 240, 240, 245);       // search bar
  } else {
    rect(0, 90 * u, W, H, 248, 248, 250);
    rect(0, 90 * u, W, 260 * u, 61, 220, 132);
    for (let i = 0; i < 8; i++) rrect(40 * u, (320 + i * 170) * u, W - 40 * u, (450 + i * 170) * u, 24 * u, 230, 232, 236);
  }
  rrect(W / 2 - 110 * u, H - 50 * u, W / 2 + 110 * u, H - 34 * u, 8 * u, 255, 255, 255);   // gesture bar
  const now = Date.now();
  for (const rp of ripples) { const age = (now - rp.t) / 450; if (age < 1) circle(rp.x, rp.y, 40 * u + 90 * u * age, 255, 255, 255, 0.35 * (1 - age)); }
  while (ripples.length && now - ripples[0].t > 500) ripples.shift();
}

// rotated copy of the framebuffer as the device is held, scaled to fit the request (nearest neighbour)
function frame(reqW, reqH) {
  const rot = ((rotation % 360) + 360) % 360;
  const fw = rot === 90 || rot === 270 ? H : W, fh = rot === 90 || rot === 270 ? W : H;
  let s = 1;
  if (reqW && reqW < fw) s = Math.min(s, reqW / fw);
  if (reqH && reqH < fh) s = Math.min(s, reqH / fh);
  const ow = Math.max(1, Math.round(fw * s)), oh = Math.max(1, Math.round(fh * s));
  const rname0 = { 0: 'PORTRAIT', 90: 'LANDSCAPE', 180: 'REVERSE_PORTRAIT', 270: 'REVERSE_LANDSCAPE' }[rot];
  if (rot === 0 && s === 1) return { w: W, h: H, data: Buffer.from(fb), rotation: rname0 };   // fast path
  const out = Buffer.alloc(ow * oh * 3);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const rx = Math.min(fw - 1, (x / s) | 0), ry = Math.min(fh - 1, (y / s) | 0);
    let nx, ny;
    if (rot === 0) { nx = rx; ny = ry; } else if (rot === 90) { nx = W - 1 - ry; ny = rx; } else if (rot === 180) { nx = W - 1 - rx; ny = H - 1 - ry; } else { nx = ry; ny = H - 1 - rx; }
    const si = (ny * W + nx) * 3, di = (y * ow + x) * 3;
    out[di] = fb[si]; out[di + 1] = fb[si + 1]; out[di + 2] = fb[si + 2];
  }
  const rname = { 0: 'PORTRAIT', 90: 'LANDSCAPE', 180: 'REVERSE_PORTRAIT', 270: 'REVERSE_LANDSCAPE' }[rot];
  return { w: ow, h: oh, data: out, rotation: rname };
}

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ── gRPC
const protoDir = process.env.DROID_PROTO_DIR || path.join(__dirname, '..', 'proto');
const def = protoLoader.loadSync(['emulator_controller.proto', 'snapshot_service.proto'], { keepCase: true, longs: Number, enums: String, defaults: true, oneofs: true, includeDirs: [protoDir] });
const ctl = grpc.loadPackageDefinition(def).android.emulation.control;
const token = crypto.randomBytes(24).toString('base64');
const authed = (call) => { const a = call.metadata.get('authorization')[0]; return a === `Bearer ${token}`; };
const deny = (cb) => cb({ code: grpc.status.UNAUTHENTICATED, details: 'bad token' });
const ok = (cb, v = {}) => cb(null, v);
const streams = new Set();
let down = null;
function pointer(x, y, pressed) {
  if (pressed && !down) { down = { x, y }; ripples.push({ x, y, t: Date.now() }); }
  if (!pressed && down) {
    if (Math.abs(down.y - y) > H * 0.15) page = 'home';
    else if (page === 'home' && y > H * 0.45) page = 'app';
    down = null;
  }
}
const snaps = new Map();
const server = new grpc.Server();
server.addService(ctl.EmulatorController.service, {
  getStatus: (call, cb) => authed(call) ? ok(cb, { version: '99.0.0 (demo)', uptime: Date.now() - t0, booted: Date.now() - t0 > BOOT_MS, vmConfig: { hypervisorType: 'HVF', numberOfCpuCores: +cfg['hw.cpu.ncore'] || 4, ramSizeBytes: (+cfg['hw.ramSize'] || 4096) * 1048576 } }) : deny(cb),
  streamScreenshot(call) {
    if (!authed(call)) return call.destroy(new Error('bad token'));
    const req = call.request; streams.add(call);
    const tick = () => { draw(); const f = frame(req.width, req.height); call.write({ format: { format: 'RGB888', width: f.w, height: f.h, rotation: { rotation: f.rotation } }, image: f.data, seq: seq++ }); };
    tick(); const iv = setInterval(tick, 1000 / 12);
    call.on('cancelled', () => { clearInterval(iv); streams.delete(call); });
    call.on('close', () => clearInterval(iv));
  },
  getScreenshot(call, cb) { if (!authed(call)) return deny(cb); draw(); const f = frame(call.request.width, call.request.height); ok(cb, { format: { format: call.request.format, width: f.w, height: f.h, rotation: { rotation: f.rotation } }, image: call.request.format === 'PNG' ? png(f.w, f.h, f.data) : f.data }); },
  sendMouse(call, cb) { pointer(call.request.x, call.request.y, call.request.buttons > 0); ok(cb); },
  sendTouch(call, cb) { const t = call.request.touches[0]; if (t) pointer(t.x, t.y, t.pressure > 0); ok(cb); },
  sendKey(call, cb) { lastKey = call.request.key || call.request.text; if (call.request.key === 'GoHome' || call.request.key === 'GoBack') page = 'home'; if (call.request.key === 'Power') screenOn = !screenOn; fs.writeFileSync(path.join(stateDir, 'lastkey'), String(lastKey)); ok(cb); },
  streamInputEvent(call, cb) {
    if (!authed(call)) return cb({ code: grpc.status.UNAUTHENTICATED, details: 'bad token' });
    call.on('data', (ev) => {
      if (ev.touch_event) { const t = ev.touch_event.touches[0]; if (t) pointer(t.x, t.y, t.pressure > 0); fs.appendFileSync(path.join(stateDir, 'input.log'), `touch ${t && t.x},${t && t.y},${t && t.pressure}\n`); }
      if (ev.mouse_event) pointer(ev.mouse_event.x, ev.mouse_event.y, ev.mouse_event.buttons > 0);
      if (ev.key_event) { const k = ev.key_event.key || ev.key_event.text; if (k === 'GoHome' || k === 'GoBack') page = 'home'; if (k === 'Power') screenOn = !screenOn; fs.writeFileSync(path.join(stateDir, 'lastkey'), String(k)); }
    });
    call.on('end', () => ok(cb));
  },
  injectWheel(call, cb) { call.on('data', () => {}); call.on('end', () => ok(cb)); },
  setGps(call, cb) { gps = { lat: call.request.latitude, lng: call.request.longitude }; fs.writeFileSync(path.join(stateDir, 'gps.json'), JSON.stringify(gps)); ok(cb); },
  getGps: (call, cb) => ok(cb, { latitude: gps.lat, longitude: gps.lng }),
  setClipboard(call, cb) { clip = call.request.text; ok(cb); },
  getClipboard: (call, cb) => ok(cb, { text: clip }),
  streamClipboard(call) { call.write({ text: clip }); call.on('cancelled', () => {}); },
  setBattery: (call, cb) => ok(cb),
  getBattery: (call, cb) => ok(cb, { hasBattery: true, chargeLevel: 100 }),
  setPhysicalModel(call, cb) { if (call.request.target === 'ROTATION') rotation = Math.round(call.request.value?.data?.[2] || 0); ok(cb); },
  setVmState(call, cb) { ok(cb); if (call.request.state === 'SHUTDOWN') setTimeout(() => process.exit(0), 200); },
  streamAudio(call) { const iv = setInterval(() => call.write({ format: {}, timestamp: Date.now() * 1000, audio: Buffer.alloc(44100 * 4 * 0.03) }), 30); call.on('cancelled', () => clearInterval(iv)); },
  streamNotification(call) { call.on('cancelled', () => {}); },
  sendSms: (call, cb) => ok(cb, { response: 'OK' }),
});
if (ctl.SnapshotService) server.addService(ctl.SnapshotService.service, {
  ListSnapshots: (call, cb) => ok(cb, { snapshots: [...snaps.entries()].map(([id, s]) => ({ snapshot_id: id, size: 123456789, status: 'Compatible', details: { creation_time: s.t, description: '' } })) }),
  SaveSnapshot: (call, cb) => { snaps.set(call.request.snapshot_id, { t: Math.floor(Date.now() / 1000), page }); ok(cb, { snapshot_id: call.request.snapshot_id, success: true }); },
  LoadSnapshot: (call, cb) => { const s = snaps.get(call.request.snapshot_id); if (s) page = s.page; ok(cb, { snapshot_id: call.request.snapshot_id, success: !!s, err: s ? undefined : Buffer.from('No such snapshot') }); },
  DeleteSnapshot: (call, cb) => { snaps.delete(call.request.snapshot_id); ok(cb, { success: true }); },
});

server.bindAsync(`127.0.0.1:${grpcPort}`, grpc.ServerCredentials.createInsecure(), (err) => {
  if (err) { console.error('ERROR | gRPC bind failed: ' + err.message); process.exit(1); }
  const dir = path.join(os.homedir(), '.android', 'avd', 'running');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `pid_${process.pid}.ini`);
  fs.writeFileSync(file, `grpc.port=${grpcPort}\ngrpc.token=${token}\nport.serial=${port}\nport.adb=${port + 1}\navd.id=${avd}\navd.name=${avd}\n`);
  console.log(`INFO | Started GRPC server at 127.0.0.1:${grpcPort}, security: Local, auth: +token`);
  console.log(`INFO | Advertising in: ${file}`);
  const bye = () => { try { fs.rmSync(file, { force: true }); } catch {} process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
  // console port: "kill" like the real emulator console; also used by fake adb for state
  net.createServer((s) => {
    s.on('data', (d) => {
      const cmd = String(d).trim();
      if (cmd === 'kill') { s.end('OK\n'); setTimeout(bye, 150); }
      else if (cmd === 'status') s.end(JSON.stringify({ booted: Date.now() - t0 > BOOT_MS }) + '\n');
      else s.end('OK\n');
    });
  }).listen(port, '127.0.0.1');
});
