// Helm's pretend computer (Linux, tests, HELM_DEMO=1): records every event instead of sending it.
'use strict';
function create() {
  const log = [];
  let front = { pid: 1, id: 'com.apple.finder', name: 'Finder', title: '', bounds: null, full: false, path: '' };
  const rec = (...a) => { log.push(a); if (log.length > 5000) log.splice(0, 1000); };
  return {
    name: 'demo', demo: true, log,
    supports: { touchpadGestures: true, xinput: false },
    start() {}, stop() {}, ready: true, trusted: true,
    moveTo(x, y) { rec('move', Math.round(x), Math.round(y)); },
    mouse(btn, down) { rec('mouse', btn, down); },
    wheel(dy, dx) { rec('wheel', dy, dx); },
    key(name, mods, down) { rec('key', name, (mods || []).join('+'), down); },
    combo(name, mods) { rec('combo', name, (mods || []).join('+')); },
    text(s) { rec('text', s); },
    media(name) { rec('media', name); },
    async command(name) { rec('command', name); return true; },
    async front() { return front; },
    setFront(f) { front = { ...front, ...f }; },
    onXInput() {}
  };
}
module.exports = { create };
