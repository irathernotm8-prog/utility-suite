// Helm on Windows: real input and XInput controllers through helm-input.exe, a small C# helper compiled on the PC
// the first time Helm runs (and again whenever its source changes).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { Helper } = require('./helper');
const { WIN } = require('../core/keys');

function compile(src, exe, log) {
  return new Promise((resolve) => {
    const win = process.env.WINDIR || 'C:\\Windows';
    const cscs = [path.join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), path.join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')].filter((p) => fs.existsSync(p));
    const viaPs = () => {
      const ps = `Add-Type -TypeDefinition ([IO.File]::ReadAllText('${src.replace(/'/g, "''")}')) -OutputAssembly '${exe.replace(/'/g, "''")}' -OutputType ConsoleApplication`;
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, timeout: 60000 }, (err, _o, e) => {
        if (err) log('Add-Type: ' + (e || err.message)); resolve(!err && fs.existsSync(exe));
      });
    };
    if (!cscs.length) return viaPs();
    execFile(cscs[0], ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', `/out:${exe}`, src], { windowsHide: true, timeout: 60000 }, (err, o) => {
      if (err || !fs.existsSync(exe)) { log('csc: ' + (o || (err && err.message))); return viaPs(); }
      resolve(true);
    });
  });
}

function create({ dataDir, log = () => {} }) {
  const srcText = fs.readFileSync(path.join(__dirname, 'helpers', 'win-helper.cs'), 'utf8');
  const hash = crypto.createHash('sha1').update(srcText).digest('hex').slice(0, 10);
  const binDir = path.join(dataDir, 'bin'); const src = path.join(binDir, 'helm-input.cs'); const exe = path.join(binDir, `helm-input-${hash}.exe`);
  let built = fs.existsSync(exe), building = null, inPowerShell = false;
  let toScreen = (p) => p;

  async function build() {
    if (built) return true;
    if (!building) building = (async () => {
      fs.mkdirSync(binDir, { recursive: true }); fs.writeFileSync(src, srcText);
      for (const f of fs.readdirSync(binDir)) if (/^helm-input-.*\.exe$/.test(f) && f !== path.basename(exe)) { try { fs.unlinkSync(path.join(binDir, f)); } catch (_) {} }
      built = await compile(src, exe, log); building = null; return built;
    })();
    return building;
  }
  const helper = new Helper('windows input', () => {
    if (!built && !inPowerShell) { build().then((ok) => { if (!ok) inPowerShell = true; helper.retry(); }); return null; }
    if (inPowerShell || !built) {
      // last resort: compile in memory and run inside PowerShell
      const ps = `Add-Type -TypeDefinition ([IO.File]::ReadAllText('${src.replace(/'/g, "''")}')); [HelmInput]::Main()`;
      return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps] };
    }
    return { cmd: exe, args: [], onFail: () => { inPowerShell = true; } };
  });
  helper.on('log', log);
  let xinputWanted = false;
  helper.on('ready', () => { if (xinputWanted) helper.send('x 1'); });

  const vk = (name) => WIN[name];
  function key(name, mods = [], down = true) {
    const code = vk(name); if (code == null) return;
    if (down) for (const m of mods) { const c = vk(m === 'cmd' ? 'ctrl' : m); if (c != null) helper.send(`k ${c} 1`); }
    helper.send(`k ${code} ${down ? 1 : 0}`);
    if (!down) for (const m of [...mods].reverse()) { const c = vk(m === 'cmd' ? 'ctrl' : m); if (c != null) helper.send(`k ${c} 0`); }
  }
  function combo(name, mods = []) {
    const code = vk(name); if (code == null) return;
    const ms = mods.map((m) => vk(m === 'cmd' ? 'ctrl' : m)).filter((c) => c != null);
    for (const c of ms) helper.send(`k ${c} 1`);
    helper.send(`k ${code} 1`); helper.send(`k ${code} 0`);
    for (const c of ms.reverse()) helper.send(`k ${c} 0`);
  }
  return {
    name: 'win',
    supports: { touchpadGestures: true, xinput: true },
    start() { helper.start(); },
    stop() { helper.stop(); },
    get ready() { return helper.ready; },
    trusted: true,
    setConverter(fn) { toScreen = fn; },
    moveTo(x, y) { const p = toScreen({ x, y }); helper.send(`m ${p.x.toFixed(1)} ${p.y.toFixed(1)}`); },
    mouse(btn, down) { helper.send(`b ${btn === 'right' ? 'r' : btn === 'middle' ? 'm' : 'l'} ${down ? 1 : 0}`); },
    wheel(dy, dx) { helper.send(`w ${dy} ${dx}`); },
    key, combo,
    text(s) { helper.send('u ' + Buffer.from(s, 'utf8').toString('base64')); },
    media(name) { const c = vk(name); if (c != null) { helper.send(`k ${c} 1`); helper.send(`k ${c} 0`); } },
    async command(name) {
      if (name === 'lock') { spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); return true; }
      return false;
    },
    async front() {
      const r = await helper.ask('f', 'F'); if (!r) return null;
      const [pid, name, title, full, p] = r.split('\t');
      return { pid: Number(pid) || 0, id: (name || '').toLowerCase(), name: name || '', title: title || '', bounds: null, full: full === '1', path: p || '' };
    },
    onXInput(fn) { xinputWanted = true; helper.on('xinput', fn); if (helper.ready) helper.send('x 1'); }
  };
}

module.exports = { create };
