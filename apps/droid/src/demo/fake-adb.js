// A pretend adb for DROID_DEMO=1 and the tests. Each demo device's /sdcard is a real folder inside
// its AVD folder, so copying files in and out behaves like the real thing.
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');

const a = process.argv.slice(2);
let serial = null;
if (a[0] === '-s') { serial = a[1]; a.splice(0, 2); }
const avdHome = process.env.ANDROID_AVD_HOME || path.join(os.homedir(), '.android', 'avd');
const runDir = path.join(os.homedir(), '.android', 'avd', 'running');

function sessions() {
  const out = [];
  try {
    for (const f of fs.readdirSync(runDir)) {
      const ini = Object.fromEntries(fs.readFileSync(path.join(runDir, f), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
      const pid = +f.replace(/\D/g, '');
      try { process.kill(pid, 0); } catch { continue; }
      out.push({ serial: `emulator-${ini['port.serial']}`, port: +ini['port.serial'], avd: ini['avd.id'] });
    }
  } catch {}
  return out;
}
const me = () => sessions().find((s) => s.serial === serial);
const stateDir = () => { const s = me(); if (!s) { console.error(`adb: device '${serial}' not found`); process.exit(1); } return path.join(avdHome, `${s.avd}.avd`, 'demo'); };
const sdcard = () => { const d = path.join(stateDir(), 'sdcard'); for (const x of ['Download', 'DCIM', 'Pictures', 'Movies', 'Music', 'Documents']) fs.mkdirSync(path.join(d, x), { recursive: true }); return d; };
const local = (remote) => path.join(sdcard(), remote.replace(/^\/(sdcard|storage\/emulated\/0)\/?/, ''));
const consoleCmd = (port, cmd) => new Promise((res) => { const s = net.connect(port, '127.0.0.1', () => s.write(cmd + '\n')); let o = ''; s.on('data', (d) => (o += d)); s.on('close', () => res(o)); s.on('error', () => res('')); });

(async () => {
  const cmd = a[0];
  if (cmd === 'start-server' || cmd === 'kill-server' || cmd === 'connect') return;
  if (cmd === 'devices') { console.log('List of devices attached'); for (const s of sessions()) console.log(`${s.serial}\tdevice`); return; }
  if (cmd === 'emu') { const s = me(); if (s) await consoleCmd(s.port, a.slice(1).join(' ')); console.log('OK'); return; }
  if (cmd === 'install' || cmd === 'install-multiple') {
    const files = a.slice(1).filter((x) => !x.startsWith('-'));
    if (!files.length || files.some((f) => !/\.apk$/i.test(f))) { console.error("adb: filename doesn't end .apk"); process.exit(1); }
    await new Promise((r) => setTimeout(r, 600));
    const apps = (() => { try { return JSON.parse(fs.readFileSync(path.join(stateDir(), 'apps.json'), 'utf8')); } catch { return []; } })();
    let pkg = path.basename(files[0], '.apk');
    try { const apk = require('../core/apk'); pkg = apk.apkInfo(files.find((f) => /base/i.test(f)) || files[0]).package || pkg; } catch {}
    if (!apps.includes(pkg)) apps.push(pkg);
    fs.writeFileSync(path.join(stateDir(), 'apps.json'), JSON.stringify(apps));
    console.log('Performing Streamed Install'); console.log('Success'); return;
  }
  if (cmd === 'uninstall') { const f = path.join(stateDir(), 'apps.json'); const apps = JSON.parse(fs.readFileSync(f, 'utf8')).filter((x) => x !== a[1]); fs.writeFileSync(f, JSON.stringify(apps)); console.log('Success'); return; }
  if (cmd === 'push') { const dst = local(a[2]); const tgt = a[2].endsWith('/') ? path.join(dst, path.basename(a[1])) : dst; fs.mkdirSync(path.dirname(tgt), { recursive: true }); fs.copyFileSync(a[1], tgt); console.log(`${a[1]}: 1 file pushed. 100%`); return; }
  if (cmd === 'pull') { const src = local(a[1]); const dst = fs.existsSync(a[2]) && fs.statSync(a[2]).isDirectory() ? path.join(a[2], path.basename(src)) : a[2]; fs.copyFileSync(src, dst); console.log('1 file pulled.'); return; }
  if (cmd === 'exec-out') { process.stdout.write(Buffer.alloc(0)); return; }
  if (cmd === 'shell') {
    const sh = a.slice(1).join(' ');
    if (/getprop sys.boot_completed/.test(sh)) { const s = me(); const st = s ? await consoleCmd(s.port, 'status') : ''; console.log(/"booted":true/.test(st) ? '1' : ''); return; }
    if (/pm list packages/.test(sh)) { let apps = []; try { apps = JSON.parse(fs.readFileSync(path.join(stateDir(), 'apps.json'), 'utf8')); } catch {} apps.forEach((p, i) => console.log(`package:${p} versionCode:${100 + i}`)); return; }
    const ls = sh.match(/ls -lA '([^']*)'/);
    if (ls) {
      const d = local(ls[1]);
      if (!fs.existsSync(d)) return;
      for (const n of fs.readdirSync(d)) {
        const st = fs.statSync(path.join(d, n)); const t = new Date(st.mtimeMs);
        const ds = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
        console.log(`${st.isDirectory() ? 'd' : '-'}rwxrwx--x 2 root sdcard_rw ${st.isDirectory() ? 4096 : st.size} ${ds} ${n}`);
      }
      return;
    }
    const mk = sh.match(/mkdir -p '([^']*)'/); if (mk) { fs.mkdirSync(local(mk[1]), { recursive: true }); return; }
    const rm = sh.match(/rm -rf '([^']*)'/); if (rm) { fs.rmSync(local(rm[1]), { recursive: true, force: true }); return; }
    if (/screenrecord/.test(sh)) { await new Promise((r) => { process.on('SIGINT', r); process.on('SIGTERM', r); setTimeout(r, 180000); }); fs.writeFileSync(local('/sdcard/droid-rec.mp4'), Buffer.alloc(16)); return; }
    return;   // everything else (settings, svc, am, monkey) succeeds quietly
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
