// A pretend DualSense for the demo / tests: shows up like a real one and plays whatever frames it's given.
'use strict';
const P = require('./core/parse');
function attach(controllers) {
  const d = { key: 'demo:1', kind: 'dualsense', name: 'DualSense', conn: 'bt', last: 0, frame: P.blank('dualsense', 'bt'), open: null };
  d.frame.battery = 80;
  controllers.devices.set(d.key, d); controllers.activeKey = d.key; controllers.changed();
  controllers.demo = {
    device: d,
    push(fn) { const f = P.blank('dualsense', 'bt'); f.battery = 80; if (fn) fn(f); d.frame = f; controllers.emit('frame', f, d); return f; }
  };
  // keep the frame fresh like a real controller does (so the window's live view is alive)
  setInterval(() => controllers.emit('frame', d.frame, d), 16);
  return controllers.demo;
}
module.exports = { attach };
