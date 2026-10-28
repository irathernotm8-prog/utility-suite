// Bench — a pretend VNC screen for the demo and the tests: a little desktop with a window, a button that turns green
// when clicked, a text field that fills with a block per key typed, and a clock bar that ticks. Speaks RFB 3.8 with
// VNC password sign-in. Run on its own: `node src/demo/fake-vnc.js 5999 secret`.
'use strict';
const net = require('net');
const crypto = require('crypto');
const { vncResponse } = require('../core/des');

function createFakeScreen({ width = 1280, height = 800, password = 'bench', name = 'Bench demo desktop' } = {}) {
  const fb = Buffer.alloc(width * height * 4);
  const st = { clicks: 0, typed: '', pressed: false, keys: [], tick: 0, last: null, scrolls: 0, rightClicks: 0 };
  const BTN = { x: 520, y: 430, w: 240, h: 64 }; const FIELD = { x: 420, y: 340, w: 440, h: 44 };
  const rect = (x, y, w, h, [r, g, b]) => {
    for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx++) { const i = (yy * width + xx) * 4; fb[i] = r; fb[i + 1] = g; fb[i + 2] = b; fb[i + 3] = 255; }
  };
  function draw() {
    for (let y = 0; y < height; y++) { const t = y / height; for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; fb[i] = 30 + 60 * t; fb[i + 1] = 20 + 30 * (x / width); fb[i + 2] = 70 + 90 * (1 - t); fb[i + 3] = 255; } }
    rect(0, 0, width, 28, [24, 24, 30]);
    rect(width - 120, 8, 12 + (st.tick % 10) * 10, 12, [200, 200, 210]); // the "clock"
    rect(360, 240, 560, 320, [236, 238, 242]); rect(360, 240, 560, 36, [210, 213, 220]);
    rect(376, 252, 12, 12, [255, 95, 87]); rect(396, 252, 12, 12, [255, 189, 46]); rect(416, 252, 12, 12, [39, 201, 63]);
    rect(FIELD.x, FIELD.y, FIELD.w, FIELD.h, [255, 255, 255]); rect(FIELD.x, FIELD.y + FIELD.h - 2, FIELD.w, 2, [120, 130, 150]);
    [...st.typed].slice(0, 40).forEach((c, i) => rect(FIELD.x + 10 + i * 10, FIELD.y + 14, 7, 16, /[A-Z]/.test(c) ? [200, 40, 120] : [40, 40, 60]));
    rect(BTN.x, BTN.y, BTN.w, BTN.h, st.clicks % 2 ? [46, 196, 112] : [70, 110, 240]);
    for (let i = 0; i < Math.min(st.clicks, 20); i++) rect(380 + i * 14, 530, 10, 10, [255, 92, 168]);
  }
  draw();
  const clients = new Set();
  const changed = () => { draw(); for (const c of clients) c.dirty = true, c.flush(); };
  const tick = setInterval(() => { st.tick++; changed(); }, 1000); tick.unref();

  const server = net.createServer((sock) => {
    const c = { sock, dirty: true, want: null, ready: false };
    let buf = Buffer.alloc(0); let stage = 'version'; let challenge;
    c.flush = () => {
      if (!c.ready || !c.want || (c.want.incremental && !c.dirty)) return;
      c.want = null; c.dirty = false;
      const head = Buffer.alloc(4 + 12); head[0] = 0; head.writeUInt16BE(1, 2); head.writeUInt16BE(0, 4); head.writeUInt16BE(0, 6); head.writeUInt16BE(width, 8); head.writeUInt16BE(height, 10); head.writeInt32BE(0, 12);
      sock.write(Buffer.concat([head, fb]));
    };
    clients.add(c); sock.on('close', () => clients.delete(c)); sock.on('error', () => {});
    sock.write('RFB 003.008\n');
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (stage === 'version') { if (buf.length < 12) return; buf = buf.subarray(12); sock.write(Buffer.from([1, 2])); stage = 'sectype'; continue; }
        if (stage === 'sectype') { if (buf.length < 1) return; buf = buf.subarray(1); challenge = crypto.randomBytes(16); sock.write(challenge); stage = 'auth'; continue; }
        if (stage === 'auth') {
          if (buf.length < 16) return; const resp = buf.subarray(0, 16); buf = buf.subarray(16);
          if (!vncResponse(password, challenge).equals(resp)) { const why = Buffer.from('Wrong password'); const b = Buffer.alloc(8); b.writeUInt32BE(1, 0); b.writeUInt32BE(why.length, 4); sock.end(Buffer.concat([b, why])); return; }
          sock.write(Buffer.from([0, 0, 0, 0])); stage = 'init'; continue;
        }
        if (stage === 'init') {
          if (buf.length < 1) return; buf = buf.subarray(1);
          const nm = Buffer.from(name); const si = Buffer.alloc(24); si.writeUInt16BE(width, 0); si.writeUInt16BE(height, 2);
          si[4] = 32; si[5] = 24; si[6] = 0; si[7] = 1; si.writeUInt16BE(255, 8); si.writeUInt16BE(255, 10); si.writeUInt16BE(255, 12); si[14] = 0; si[15] = 8; si[16] = 16; si.writeUInt32BE(nm.length, 20);
          sock.write(Buffer.concat([si, nm])); stage = 'msgs'; c.ready = true; continue;
        }
        if (buf.length < 1) return;
        const t = buf[0];
        if (t === 0) { if (buf.length < 20) return; buf = buf.subarray(20); continue; }
        if (t === 2) { if (buf.length < 4) return; const n = buf.readUInt16BE(2); if (buf.length < 4 + n * 4) return; buf = buf.subarray(4 + n * 4); continue; }
        if (t === 3) { if (buf.length < 10) return; c.want = { incremental: !!buf[1] }; buf = buf.subarray(10); c.flush(); continue; }
        if (t === 4) {
          if (buf.length < 8) return; const down = buf[1]; const ks = buf.readUInt32BE(4); buf = buf.subarray(8);
          if (down) { st.keys.push(ks); if (ks === 0xff08) st.typed = st.typed.slice(0, -1); else if (ks >= 0x20 && ks < 0x100) st.typed += String.fromCharCode(ks); changed(); }
          continue;
        }
        if (t === 5) {
          if (buf.length < 6) return; const mask = buf[1]; const x = buf.readUInt16BE(2), y = buf.readUInt16BE(4); buf = buf.subarray(6);
          st.last = { x, y, mask };
          if (mask & 1 && !st.pressed) { st.pressed = true; if (x >= BTN.x && x < BTN.x + BTN.w && y >= BTN.y && y < BTN.y + BTN.h) { st.clicks++; changed(); } }
          if (!(mask & 1)) st.pressed = false;
          if (mask & 4) st.rightClicks++;
          if (mask & (8 | 16)) st.scrolls++;
          continue;
        }
        if (t === 6) { if (buf.length < 8) return; const n = buf.readUInt32BE(4); if (buf.length < 8 + n) return; st.clip = buf.subarray(8, 8 + n).toString('latin1'); buf = buf.subarray(8 + n); continue; }
        sock.destroy(); return;
      }
    });
  });
  return {
    server, state: st, button: BTN, field: FIELD, width, height,
    listen: (port = 0) => new Promise((res) => server.listen(port, '127.0.0.1', () => res(server.address().port))),
    close: () => { clearInterval(tick); for (const c of clients) c.sock.destroy(); server.close(); },
  };
}

if (require.main === module) {
  const s = createFakeScreen({ password: process.argv[3] || 'bench' });
  s.listen(+process.argv[2] || 5999).then((p) => console.log(`fake VNC screen on vnc://:${process.argv[3] || 'bench'}@127.0.0.1:${p}`));
}
module.exports = { createFakeScreen };
