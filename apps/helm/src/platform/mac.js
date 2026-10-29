// Helm on macOS: real input through a long-running JXA helper (Quartz events), commands through `open`.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { Helper } = require('./helper');
const { MAC, macFlags, macChar } = require('../core/keys');

const MOD_CODE = { cmd: 55, win: 55, shift: 56, alt: 58, ctrl: 59 };
const NX = { volumeup: 0, volumedown: 1, volumemute: 7, playpause: 16, nexttrack: 17, prevtrack: 18 };

function create({ dataDir, clipboard = null, log = () => {} }) {
  const script = path.join(dataDir, 'helm-input.js');
  const helper = new Helper('mac input', () => {
    try {
      const src = fs.readFileSync(path.join(__dirname, 'helpers', 'mac-helper.js'), 'utf8');
      if (!fs.existsSync(script) || fs.readFileSync(script, 'utf8') !== src) fs.writeFileSync(script, src);
    } catch (e) { log('helper script: ' + e.message); return null; }
    return { cmd: '/usr/bin/osascript', args: ['-l', 'JavaScript', script] };
  });
  helper.on('log', log);
  // a second copy answers "what's in front?" so those slower lookups never hold up input
  const watcher = new Helper('mac watcher', () => (fs.existsSync(script) ? { cmd: '/usr/bin/osascript', args: ['-l', 'JavaScript', script] } : null));
  watcher.on('log', log);
  let flags = 0; // modifiers Helm is holding (app switcher)

  const send = (l) => helper.send(l);
  function keyRaw(code, down, f) { send(`k ${code} ${down ? 1 : 0} ${f}`); }
  function key(name, mods = [], down = true) {
    const code = MOD_CODE[name] != null && !mods.length ? MOD_CODE[name] : MAC[name];
    if (code == null) return;
    if (MOD_CODE[name] != null && !mods.length) {
      const bit = macFlags([name]); flags = down ? flags | bit : flags & ~bit;
      keyRaw(code, down, flags); return;
    }
    keyRaw(code, down, flags | macFlags(mods, name));
  }
  function combo(name, mods = []) {
    const code = MAC[name]; if (code == null) return;
    // press the modifier keys too: some system shortcuts look at the keys, not just the flags
    let f = flags; const pressed = [];
    for (const m of mods) { const c = MOD_CODE[m]; if (c == null) continue; f |= macFlags([m]); if (!(flags & macFlags([m]))) { keyRaw(c, true, f); pressed.push([c, m]); } }
    const kf = f | macFlags([], name);
    keyRaw(code, true, kf); keyRaw(code, false, kf);
    for (const [c, m] of pressed.reverse()) { f &= ~macFlags([m]); keyRaw(c, false, f); }
  }
  let pasteTimer = null;
  function text(s) {
    let rest = '';
    const flushPaste = () => {
      if (!rest || !clipboard) { rest = ''; return; }
      const before = clipboard.readText(); clipboard.writeText(rest); rest = '';
      combo('v', ['cmd']);
      clearTimeout(pasteTimer); pasteTimer = setTimeout(() => { try { clipboard.writeText(before); } catch (_) {} }, 600);
    };
    for (const ch of s) {
      const k = macChar(ch);
      if (!k) { rest += ch; continue; }
      flushPaste();
      if (k.shift) { keyRaw(56, true, flags | 0x20000); keyRaw(k.code, true, flags | 0x20000); keyRaw(k.code, false, flags | 0x20000); keyRaw(56, false, flags); }
      else { keyRaw(k.code, true, flags); keyRaw(k.code, false, flags); }
    }
    flushPaste();
  }
  const open = (args) => new Promise((res) => execFile('/usr/bin/open', args, { timeout: 5000 }, (err) => res(!err)));
  async function command(name) {
    if (name === 'missionControl') { if (!(await open(['-b', 'com.apple.exposelauncher']))) combo('up', ['ctrl']); return true; }
    if (name === 'launchpad') {
      if (await open(['-b', 'com.apple.launchpad.launcher'])) return true;
      if (await open(['-a', 'Apps'])) return true;
      combo('space', ['cmd']); return true;
    }
    return false;
  }
  return {
    name: 'mac',
    supports: { touchpadGestures: true, xinput: false },
    start() { helper.start(); setTimeout(() => watcher.start(), 1500); },
    stop() { helper.stop(); watcher.stop(); },
    get ready() { return helper.ready; },
    get trusted() { return helper.info === '1' ? true : helper.info === '0' ? false : null; },
    moveTo(x, y) { send(`m ${x.toFixed(2)} ${y.toFixed(2)}`); },
    mouse(btn, down) { send(`b ${btn === 'right' ? 'r' : btn === 'middle' ? 'm' : 'l'} ${down ? 1 : 0}`); },
    wheel(dy, dx, cont) { send(`w ${dy} ${dx} ${cont ? 1 : 0}`); },
    key, combo, text, command,
    media(name) { if (NX[name] != null) send(`n ${NX[name]}`); },
    async front() {
      const r = await watcher.ask('f', 'F', 2500); if (!r) return null;
      const [pid, bundle, name, bounds] = r.split('\t');
      const [x, y, w, h] = (bounds || '').split(',').map(Number);
      return { pid: Number(pid) || 0, id: bundle || '', name: name || '', title: '', bounds: w ? { x, y, width: w, height: h } : null, full: null, path: '' };
    },
    onXInput() {}
  };
}

module.exports = { create };
