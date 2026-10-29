// Helm — finds controllers and reads them. PlayStation controllers (and Xbox controllers over Bluetooth on a Mac) are
// read straight from HID, shared with any game (never opened exclusively), so the touchpad, battery and lightbar all
// work. On Windows, Xbox-style controllers come through XInput from the input helper.
// Emits 'frame' (frame, device), 'devices' (list) and 'log'.
'use strict';
const { EventEmitter } = require('events');
const P = require('./core/parse');

let HID = null;
function loadHid(log) {
  if (HID !== null) return HID;
  try { HID = require('node-hid'); } catch (e) { log('node-hid unavailable: ' + e.message); HID = false; }
  return HID;
}

class Controllers extends EventEmitter {
  constructor({ platform, log = () => {} }) {
    super();
    this.platform = platform; this.log = log;
    this.devices = new Map(); // key -> { key, kind, name, conn, open, last, frame, seq }
    this.activeKey = null; this.timer = null; this.scanning = false; this.stopped = false;
  }
  start() {
    this.stopped = false;
    if (process.platform === 'win32' && this.platform.onXInput) this.platform.onXInput((line) => this.onXInput(line));
    this.scan(); this.timer = setInterval(() => this.scan(), 2500);
  }
  stop() { this.stopped = true; clearInterval(this.timer); for (const d of this.devices.values()) this.close(d); this.devices.clear(); }
  list() {
    return [...this.devices.values()].map((d) => ({ key: d.key, kind: d.kind, name: d.name, conn: d.conn, battery: d.frame ? d.frame.battery : null, charging: d.frame ? d.frame.charging : false, active: d.key === this.activeKey, touch: d.kind !== 'xbox' && d.kind !== 'xinput' }));
  }
  active() { return this.activeKey ? this.devices.get(this.activeKey) : null; }

  async scan() {
    if (this.scanning || this.stopped) return;
    const hid = loadHid(this.log); if (!hid) return;
    this.scanning = true;
    try {
      const all = await hid.devicesAsync();
      const seen = new Set();
      for (const info of all) {
        const id = P.identify(info.vendorId, info.productId); if (!id) continue;
        if (id.kind === 'xbox' && process.platform === 'win32') continue;     // XInput covers these on Windows
        if (info.usagePage && info.usagePage !== 1) continue;
        if (info.usage && info.usage !== 5 && info.usage !== 4) continue;
        const key = 'hid:' + info.path; seen.add(key);
        if (this.devices.has(key)) continue;
        const d = { key, kind: id.kind, name: id.name, conn: (info.busType === 2 || /bluetooth|bth|{00001124/i.test(info.path)) ? 'bt' : 'usb', info, open: null, last: 0, frame: null, seq: 0, opening: true };
        this.devices.set(key, d);
        this.open(d);
      }
      for (const [key, d] of this.devices) if (key.startsWith('hid:') && !seen.has(key)) { this.close(d); this.devices.delete(key); this.changed(); }
    } catch (e) { this.log('scan: ' + e.message); }
    this.scanning = false;
  }
  async open(d) {
    try {
      const dev = await HID.HIDAsync.open(d.info.path, { nonExclusive: true });
      d.open = dev; d.opening = false;
      dev.on('data', (buf) => this.onReport(d, buf));
      dev.on('error', (e) => { this.log(`${d.name}: ${e.message || e}`); this.close(d); this.devices.delete(d.key); this.changed(); });
      // Bluetooth PlayStation controllers send a short report until their calibration is read; that switches them to full
      if (d.kind === 'dualsense' || d.kind === 'edge') dev.getFeatureReport(0x05, 41).catch(() => {});
      else if (d.kind === 'ds4') dev.getFeatureReport(0x02, 37).catch(() => {});
      this.log(`connected ${d.name}`);
      this.changed();
    } catch (e) {
      this.log(`${d.name}: couldn't open (${e.message || e})`);
      d.opening = false; d.failed = (d.failed || 0) + 1;
      // forget it so the next scan tries again
      setTimeout(() => { if (this.devices.get(d.key) === d && !d.open) this.devices.delete(d.key); }, 4000);
    }
  }
  close(d) { if (d.open) { const o = d.open; d.open = null; o.close().catch(() => {}); } if (this.activeKey === d.key) { this.activeKey = null; this.emit('frame', null, null); } }
  changed() { this.emit('devices', this.list()); }

  onReport(d, buf) {
    const f = P.parseReport(d.kind, buf); if (!f) return;
    if (f.simple && !d.askedFull && d.open) {
      d.askedFull = true;
      d.open.getFeatureReport(d.kind === 'ds4' ? 0x02 : 0x05, d.kind === 'ds4' ? 37 : 41).catch(() => {});
    }
    if (f.conn !== d.conn) { d.conn = f.conn; this.changed(); }
    const prevBattery = d.frame ? d.frame.battery : null;
    d.frame = f;
    if (f.battery !== prevBattery) this.changed();
    this.offer(d, f);
  }
  /** One controller drives Helm at a time: the last one used. Another takes over once it's touched and the current
   *  one has been still for a moment (so a controller seen twice, as HID and XInput, never fights itself). */
  offer(d, f) {
    const moving = f.t.length || P.BUTTONS.some((k) => f.b[k]) || Math.abs(f.a.lx) > 0.3 || Math.abs(f.a.ly) > 0.3 || Math.abs(f.a.rx) > 0.3 || Math.abs(f.a.ry) > 0.3;
    const now = Date.now();
    if (moving) d.last = now;
    if (this.activeKey !== d.key) {
      const cur = this.active();
      if (!cur || (moving && now - cur.last > 1500 && !(d.key.startsWith('xinput:') && this.hasSony()))) { this.activeKey = d.key; this.changed(); }
      else return;
    }
    this.emit('frame', f, d);
  }
  hasSony() { for (const d of this.devices.values()) if (d.open && d.kind !== 'xbox' && d.kind !== 'xinput') return true; return false; }

  onXInput(line) {
    const a = line.split(' ');
    if (a[0] === 'XD') {
      const key = 'xinput:' + a[1]; const d = this.devices.get(key);
      if (d) { if (this.activeKey === key) { this.activeKey = null; this.emit('frame', null, null); } this.devices.delete(key); this.changed(); }
      return;
    }
    if (a[0] !== 'X' || a.length < 9) return;
    const key = 'xinput:' + a[1];
    let d = this.devices.get(key);
    if (!d) { d = { key, kind: 'xinput', name: 'Xbox controller', conn: 'xinput', last: 0, frame: null }; this.devices.set(key, d); this.log('connected ' + d.name + ' ' + a[1]); this.changed(); }
    const n = a.slice(2).map(Number);
    const f = P.parseXInput(n[0], n[1], n[2], n[3], n[4], n[5], n[6]);
    d.frame = f; this.offer(d, f);
  }

  /** Lightbar colour, player lights and a short rumble on the active PlayStation controller. */
  feedback(opts) {
    const d = this.active(); if (!d || !d.open) return;
    try {
      let buf = null;
      if (d.kind === 'dualsense' || d.kind === 'edge') buf = P.dualSenseOutput(d.conn, { ...opts, seq: (d.seq = ((d.seq || 0) + 1) & 0x0f) });
      else if (d.kind === 'ds4') buf = P.ds4Output(d.conn, opts);
      if (buf) d.open.write([...buf]).catch(() => {});
    } catch (_) {}
  }
}

module.exports = { Controllers };
