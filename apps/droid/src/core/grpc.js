// Talks to a running emulator over its gRPC endpoint (the same channel Android Studio's embedded
// emulator uses): screen frames, touch, keys, location, clipboard, audio, rotation and snapshots.
'use strict';
const fs = require('fs');
const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

let cached = null;
function loadProtos(protoDir) {
  const dir = protoDir && fs.existsSync(path.join(protoDir, 'emulator_controller.proto')) ? protoDir : path.join(__dirname, '..', 'proto');
  if (cached && cached.dir === dir) return cached.pkg;
  const files = ['emulator_controller.proto', 'snapshot_service.proto'].filter((f) => fs.existsSync(path.join(dir, f)));
  const def = protoLoader.loadSync(files, { keepCase: true, longs: Number, enums: String, defaults: true, oneofs: true, includeDirs: [dir] });
  const pkg = grpc.loadPackageDefinition(def);
  cached = { dir, pkg };
  return pkg;
}

class EmulatorClient {
  constructor({ port, token, protoDir, host = '127.0.0.1' }) {
    let pkg;
    try { pkg = loadProtos(protoDir); } catch { pkg = loadProtos(null); }   // fall back to Droid's bundled copy
    const ctl = pkg.android.emulation.control;
    let creds = grpc.credentials.createInsecure();
    const opts = { 'grpc.max_receive_message_length': 64 * 1024 * 1024, 'grpc.max_send_message_length': 16 * 1024 * 1024 };
    this.meta = new grpc.Metadata();
    if (token) this.meta.add('authorization', `Bearer ${token}`);
    this.addr = `${host}:${port}`;
    this.ctl = new ctl.EmulatorController(this.addr, creds, opts);
    this.snap = ctl.SnapshotService ? new ctl.SnapshotService(this.addr, creds, opts) : null;
    this.streams = new Set();
    this.wheel = null;
  }

  call(method, req = {}, { timeout = 8000, svc } = {}) {
    const c = svc === 'snap' ? this.snap : this.ctl;
    if (!c || !c[method]) return Promise.reject(new Error(`This emulator has no ${method}`));
    return new Promise((resolve, reject) => {
      c[method](req, this.meta, { deadline: Date.now() + timeout }, (err, res) => (err ? reject(err) : resolve(res)));
    });
  }

  waitReady(ms = 15000) {
    return new Promise((resolve, reject) => this.ctl.waitForReady(Date.now() + ms, (e) => (e ? reject(e) : resolve())));
  }

  // ---- screen
  // onFrame({ width, height, rotation, seq, data: Buffer RGB888 top-down }) for every new frame.
  streamScreen({ width = 0, height = 0, display = 0 }, onFrame, onEnd) {
    const st = this.ctl.streamScreenshot({ format: 'RGB888', width, height, display }, this.meta);
    st.on('data', (img) => {
      const f = img.format || {};
      const w = f.width || img.width, h = f.height || img.height;
      if (!w || !h || !img.image || !img.image.length) return onFrame({ width: 0, height: 0, rotation: f.rotation?.rotation || 'PORTRAIT', seq: img.seq, data: null });
      onFrame({ width: w, height: h, rotation: f.rotation?.rotation || 'PORTRAIT', seq: img.seq, data: img.image });
    });
    const done = (e) => { this.streams.delete(st); onEnd && onEnd(e); onEnd = null; };
    st.on('error', done);
    st.on('end', () => done(null));
    this.streams.add(st);
    return { cancel: () => { try { st.cancel(); } catch {} this.streams.delete(st); } };
  }

  screenshotPng() { return this.call('getScreenshot', { format: 'PNG' }, { timeout: 15000 }).then((i) => ({ width: i.format?.width, height: i.format?.height, data: i.image })); }

  // ---- input (coordinates are in device pixels, in the display's natural orientation)
  touch(touches, display = 0) { return this.call('sendTouch', { touches, display }).catch(() => {}); }
  mouse(x, y, buttons, display = 0) { return this.call('sendMouse', { x: Math.round(x), y: Math.round(y), buttons, display }).catch(() => {}); }
  key(key, eventType = 'keypress') { return this.call('sendKey', { key, eventType }).catch(() => {}); }
  text(text) { return this.call('sendKey', { text }).catch(() => {}); }
  keyCode(code, eventType = 'keypress', codeType = 'Evdev') { return this.call('sendKey', { codeType, eventType, keyCode: code }).catch(() => {}); }
  wheelEvent(dx, dy, display = 0) {
    if (!this.ctl.injectWheel) return Promise.resolve(false);
    if (!this.wheel) {
      this.wheel = this.ctl.injectWheel(this.meta, () => { this.wheel = null; });
      this.wheel.on('error', () => { this.wheel = null; });
    }
    try { this.wheel.write({ dx: Math.round(dx), dy: Math.round(dy), display }); return Promise.resolve(true); } catch { this.wheel = null; return Promise.resolve(false); }
  }

  // ---- device state
  status() { return this.call('getStatus', {}); }
  setGps({ lat, lng, alt = 10, speed = 0, bearing = 0 }) {
    return this.call('setGps', { passiveUpdate: false, latitude: lat, longitude: lng, altitude: alt, speed, bearing, satellites: 12 });
  }
  setClipboard(text) { return this.call('setClipboard', { text }); }
  getClipboard() { return this.call('getClipboard', {}).then((c) => c.text || ''); }
  streamClipboard(onText) {
    const st = this.ctl.streamClipboard({}, this.meta);
    st.on('data', (c) => onText(c.text || ''));
    st.on('error', () => {});
    this.streams.add(st);
    return { cancel: () => { try { st.cancel(); } catch {} } };
  }
  setBattery({ level = 100, charging = true }) {
    return this.call('setBattery', { hasBattery: true, isPresent: true, charger: charging ? 'AC' : 'NONE', chargeLevel: level, health: 'GOOD', status: charging ? (level >= 100 ? 'FULL' : 'CHARGING') : 'DISCHARGING' });
  }
  // Rotates the virtual device like turning it in your hand (z axis, degrees: 0, 90, 180, -90).
  rotate(z) { return this.call('setPhysicalModel', { target: 'ROTATION', value: { data: [0, 0, z] } }); }
  vmState(state) { return this.call('setVmState', { state }); }   // RUNNING, PAUSED, SHUTDOWN, RESET ...
  sendSms(from, text) { return this.call('sendSms', { srcAddress: from, text }); }
  streamNotifications(onNote) {
    if (!this.ctl.streamNotification) return { cancel() {} };
    const st = this.ctl.streamNotification({}, this.meta);
    st.on('data', (n) => onNote(n));
    st.on('error', () => {});
    this.streams.add(st);
    return { cancel: () => { try { st.cancel(); } catch {} } };
  }

  // ---- audio: 16-bit stereo PCM at 44.1 kHz, delivered roughly every 20-30 ms
  streamAudio(onPacket) {
    const st = this.ctl.streamAudio({ samplingRate: 44100, channels: 'Stereo', format: 'AUD_FMT_S16', mode: 'MODE_REAL_TIME' }, this.meta);
    st.on('data', (p) => p.audio && p.audio.length && onPacket(p.audio));
    st.on('error', () => {});
    this.streams.add(st);
    return { cancel: () => { try { st.cancel(); } catch {} this.streams.delete(st); } };
  }

  // ---- snapshots
  listSnapshots() { return this.call('ListSnapshots', { statusFilter: 'All' }, { svc: 'snap', timeout: 15000 }).then((r) => (r.snapshots || []).map((s) => ({ id: s.snapshot_id, size: s.size, status: s.status, created: s.details?.creation_time, description: s.details?.description || '' }))); }
  saveSnapshot(id) { return this.call('SaveSnapshot', { snapshot_id: id }, { svc: 'snap', timeout: 180000 }).then(okSnap); }
  loadSnapshot(id) { return this.call('LoadSnapshot', { snapshot_id: id }, { svc: 'snap', timeout: 180000 }).then(okSnap); }
  deleteSnapshot(id) { return this.call('DeleteSnapshot', { snapshot_id: id }, { svc: 'snap', timeout: 60000 }).then(okSnap); }

  close() {
    for (const s of this.streams) { try { s.cancel(); } catch {} }
    this.streams.clear();
    try { this.wheel && this.wheel.end(); } catch {}
    try { this.ctl.close(); } catch {}
    try { this.snap && this.snap.close(); } catch {}
  }
}

function okSnap(r) {
  if (r && r.success === false) throw new Error(r.err ? Buffer.from(r.err).toString() : 'Snapshot failed');
  return r;
}

module.exports = { EmulatorClient, loadProtos };
