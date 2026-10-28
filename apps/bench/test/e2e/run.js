// Bench — end to end: starts the real Bench (driven by Bench's own ElectronApp driver, so its window can be
// screenshotted), then uses the Claude tools through the bridge exactly as Claude would: launch an app from a
// pretend Utility Package, inspect, click, type, shortcuts, dialogs, logs, findings, a parallel smoke test, test
// suites, and a VNC + SSH desk when x11vnc / sshd are available. Linux: run under xvfb-run.
//   node test/e2e/run.js [outDir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execSync } = require('child_process');
const { ElectronApp } = require('../../src/core/electron-app');

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.argv[2] || path.join(ROOT, 'test', 'e2e-out'); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-e2e-'));
const USER = path.join(TMP, 'user'); const PKG = path.join(TMP, 'Utility Package');
const ELECTRON = require(path.join(ROOT, 'node_modules', 'electron'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const results = [];
function check(name, ok, detail = '') { (ok ? pass++ : fail++); results.push(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + String(detail).slice(0, 300).replace(/\n/g, ' ⏎ ') : ''}`); console.log(results[results.length - 1]); }

// ── a pretend Utility Package: three copies of the sample app, one with a startup error, one that crashes
function makePackage() {
  const sample = path.join(ROOT, 'test', 'fixtures', 'sample-app');
  fs.mkdirSync(path.join(PKG, 'apps'), { recursive: true });
  fs.writeFileSync(path.join(PKG, 'suite.json'), JSON.stringify({ apps: [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }, { id: 'gamma', name: 'Gamma' }] }));
  for (const id of ['alpha', 'beta', 'gamma']) {
    const d = path.join(PKG, 'apps', id); fs.cpSync(sample, d, { recursive: true });
    const pkg = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')); pkg.name = id; pkg.productName = id[0].toUpperCase() + id.slice(1); pkg.version = '0.9.' + id.length; pkg.scripts = { test: id === 'beta' ? 'node -e "console.log(\'not ok 2 - saves\');process.exit(1)"' : 'node -e "console.log(\'3 passed\')"' };
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify(pkg, null, 2));
    fs.mkdirSync(path.join(d, 'node_modules'), { recursive: true }); fs.symlinkSync(path.join(ROOT, 'node_modules', 'electron'), path.join(d, 'node_modules', 'electron'));
    if (id === 'beta') fs.appendFileSync(path.join(d, 'index.html'), '<script>setTimeout(() => { null.boom(); }, 300);</script>');
    if (id === 'gamma') fs.appendFileSync(path.join(d, 'main.js'), '\nsetTimeout(() => process.exit(7), 1500);\n');
  }
}

// ── calling Bench like Claude does
let bridge = null;
function callTool(name, args = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ name, args, client: 'claude-code' });
    const req = http.request({ host: '127.0.0.1', port: bridge.port, path: '/call', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Authorization: 'Bearer ' + bridge.token } }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } }); });
    req.on('error', reject); req.end(data);
  });
}
const txt = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const imgs = (r) => (r.content || []).filter((c) => c.type === 'image');
let shotN = 0;
function saveImgs(r, label) { for (const im of imgs(r)) fs.writeFileSync(path.join(OUT, `${String(++shotN).padStart(2, '0')}-${label}.${im.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`), Buffer.from(im.data, 'base64')); }
async function tool(name, args, label) { const r = await callTool(name, args); if (label) saveImgs(r, label); fs.appendFileSync(path.join(OUT, 'transcript.txt'), `\n### ${name} ${JSON.stringify(args)}\n${txt(r)}\n${imgs(r).length ? `[${imgs(r).length} image(s)]\n` : ''}`); return r; }

async function main() {
  makePackage();
  fs.mkdirSync(USER, { recursive: true });
  fs.writeFileSync(path.join(USER, 'settings.json'), JSON.stringify({ packageDir: PKG, background: false, liveFps: 6 }));

  // Bench itself, driven by Bench's driver (so we can screenshot and click its window)
  const bench = new ElectronApp({ id: 'bench', name: 'Bench', exec: ELECTRON, args: [ROOT], cwd: ROOT, env: { BENCH_USER_DATA: USER, BENCH_DEMO: '1' }, userData: USER, hidden: false });
  bench.on('log', (e) => { if (e.level === 'error') fs.appendFileSync(path.join(OUT, 'bench-errors.txt'), `[${e.source}] ${e.text}\n`); });
  await bench.start();
  check('Bench starts under its own driver', bench.controlled);
  await bench.waitForWindow({ timeout: 30000 });
  for (let i = 0; i < 100 && !bridge; i++) { try { bridge = JSON.parse(fs.readFileSync(path.join(USER, 'bridge.json'), 'utf8')); } catch { await sleep(200); } }
  check('Claude bridge is up', !!bridge);
  await sleep(1200);
  const ui = async (label) => { try { const s = await bench.screenshot(); fs.writeFileSync(path.join(OUT, `ui-${label}.png`), s.buffer); } catch (e) { console.log('ui shot failed', e.message); } };
  await bench.call('setSize', null, 1400, 900).catch(() => {});
  await sleep(600); await ui('01-desks');

  // overview
  let r = await tool('bench_overview', {});
  check('overview lists desks, power, sources', /Desks:/.test(txt(r)) && /App sources/.test(txt(r)) && /alpha 0.9.5/.test(txt(r)), txt(r).split('\n')[0]);

  // launch from source
  r = await tool('launch', { project: 'alpha' }, 'launch-alpha');
  const sid = (/session (s[0-9a-f]+)/.exec(txt(r)) || [])[1];
  check('launch runs an app from its source with a first screenshot', !!sid && imgs(r).length === 1, txt(r).split('\n')[0]);
  r = await tool('inspect', {});
  const insp = txt(r); const ref = (/(e\d+) textbox “New to-do”/.exec(insp) || [])[1];
  check('inspect lists elements with refs', !!ref && /button “Add”/.test(insp));
  r = await tool('type', { ref, text: 'Write the Bench handoff', submit: true });
  r = await tool('wait_for', { text: 'Write the Bench handoff (Low)' });
  check('type by ref + Enter adds a to-do', /appeared/.test(txt(r)), txt(r));
  r = await tool('click', { text: 'Throw' });
  check('click by text reports the new console error', /New error/.test(txt(r)) && /undefinedFunction/.test(txt(r)), txt(r));
  r = await tool('press_keys', { keys: 'mod+s' });
  check('a menu shortcut goes through the app menu', /menu item “File › Save”/.test(txt(r)), txt(r));
  r = await tool('evaluate', { code: "document.querySelector('#status').textContent" });
  check('evaluate reads page state', /Saved!/.test(txt(r)), txt(r));
  r = await tool('click', { text: 'Open file' });
  check('a native Open dialog is caught and reported', /Open dialog is waiting/.test(txt(r)), txt(r));
  await ui('02-dialog');
  r = await tool('answer_dialog', { paths: ['/tmp/report.csv'] });
  r = await tool('evaluate', { code: "document.querySelector('#status').textContent" });
  check('answer_dialog answers it', /Opened \/tmp\/report.csv/.test(txt(r)), txt(r));
  r = await tool('answer_dialog', { kind: 'message', button: 0 });
  r = await tool('click', { text: 'Ask' });
  r = await tool('evaluate', { code: "document.querySelector('#status').textContent" });
  check('a queued answer handles the next message box', /Answer 0/.test(txt(r)), txt(r));
  r = await tool('menu', {});
  check('menu lists the app menu', /Save {2}\(CmdOrCtrl\+S\)/.test(txt(r)), txt(r).slice(0, 120));
  r = await tool('screenshot', {}, 'alpha-after');
  check('screenshot returns a picture', imgs(r).length === 1, txt(r));
  const box = (/(e\d+) button “Add” at (\d+),(\d+)/.exec(insp) || []);
  r = await tool('click', { x: +box[2], y: +box[3] });
  check('click by coordinates', /Clicked/.test(txt(r)), txt(r));
  r = await tool('scroll', { dy: 200 });
  check('scroll', /Scrolled/.test(txt(r)), txt(r));
  r = await tool('logs', { level: 'errors' });
  check('logs show errors with sources', /undefinedFunction/.test(txt(r)), txt(r).split('\n').slice(0, 3).join(' | '));
  r = await tool('list_sessions', {});
  check('list_sessions shows windows', /window 1 “Sample”/.test(txt(r)), txt(r));
  r = await tool('set_window', { width: 900, height: 600 });
  check('set_window resizes', /900×600/.test(txt(r)), txt(r));
  r = await tool('report_finding', { title: 'Throw raises a ReferenceError', severity: 'high', steps: ['Open Alpha', 'Click Throw'], expected: 'No error', actual: 'Uncaught ReferenceError: undefinedFunction is not defined' });
  check('report_finding files it with a screenshot and logs', /Filed finding #\d+/.test(txt(r)) && /with a screenshot and logs/.test(txt(r)), txt(r));
  r = await tool('list_findings', {});
  check('list_findings', /Throw raises a ReferenceError/.test(txt(r)));

  // web page in Bench's browser
  const page = path.join(TMP, 'page.html'); fs.writeFileSync(page, '<title>Local page</title><h1>Hello from a page</h1><button onclick="document.title=\'clicked\';console.error(\'page error\')">Press</button>');
  r = await tool('launch', { url: 'file://' + page }, 'web');
  check('a web page opens in Bench’s browser', /Launched/.test(txt(r)) && imgs(r).length === 1, txt(r).split('\n')[0]);
  r = await tool('click', { text: 'Press' });
  check('…and can be clicked, with its console error reported', /page error/.test(txt(r)), txt(r));

  // commands
  r = await tool('run_command', { command: 'echo bench-ok && node -v', cwd: PKG });
  check('run_command runs in a folder', /Exit code 0/.test(txt(r)) && /bench-ok/.test(txt(r)), txt(r));

  // the live desk view in the window
  await bench.clickText(null, 'Sandbox').catch(() => {});
  await sleep(1800); await ui('03-desk-live');
  await tool('click', { text: 'Add' }); await sleep(700); await ui('04-desk-ghost');

  // parallel smoke test from source (3 apps, 3 at once)
  const t0 = Date.now();
  r = await tool('smoke_test', { source: 'projects', parallel: 3, wait_seconds: 2 }, 'smoke');
  const st = txt(r);
  check('smoke test runs apps in parallel', /Smoke test · 3 apps — done/.test(st), `${Date.now() - t0} ms`);
  check('…alpha passes with a window and console noise only', /[✓!] Alpha 0\.9\.5/.test(st), (/.*Alpha.*/.exec(st) || [''])[0]);
  check('…beta reports its renderer error', /! Beta[\s\S]*boom/.test(st), (/.*Beta.*/.exec(st) || [''])[0]);
  check('…gamma is caught crashing', /✗ Gamma/.test(st), (/.*Gamma[\s\S]{0,200}/.exec(st) || [''])[0]);
  r = await tool('run_tests', { projects: ['alpha', 'beta'] });
  check('run_tests runs suites side by side', /✓ Alpha.*3 passed/.test(txt(r)) && /✗ Beta/.test(txt(r)), txt(r));
  await bench.clickText(null, 'Runs').catch(() => {}); await sleep(1200); await ui('05-runs');
  await bench.clickText(null, 'Findings').catch(() => {}); await sleep(800); await ui('06-findings');
  await bench.clickText(null, 'Claude').catch(() => {}); await sleep(800); await ui('07-claude');
  await bench.clickText(null, 'Virtual machines').catch(() => {}); await sleep(1200); await ui('08-vms');
  await bench.clickText(null, 'Settings').catch(() => {}); await sleep(800); await ui('09-settings');

  // VNC desk (the demo's pretend screen is always there)
  r = await tool('desk_control', { desk: 'Demo desktop', action: 'start' });
  check('a VNC desk connects', /running/.test(txt(r)), txt(r));
  r = await tool('screenshot', { desk: 'Demo desktop', max_side: 800 }, 'vnc');
  check('VNC desk screenshot is scaled for Claude', /coordinates refer to this picture/.test(txt(r)), txt(r));
  r = await tool('click', { desk: 'Demo desktop', x: 640 * 800 / 1280 / 1, y: 462 * 800 / 1280 });
  r = await tool('type', { desk: 'Demo desktop', text: 'Hi' });
  check('VNC desk takes clicks and typing', /Typed 2/.test(txt(r)), txt(r));
  await bench.clickText(null, 'Desks').catch(() => {}); await sleep(500); await bench.clickText(null, 'Demo desktop').catch(() => {}); await sleep(1500); await ui('10-vnc-desk');

  // real x11vnc + sshd (when available) — a desk exactly like a Tart VM: screen over VNC, commands over SSH
  const haveX = fs.existsSync('/usr/bin/x11vnc') && fs.existsSync('/usr/bin/Xvfb') && fs.existsSync('/usr/sbin/sshd');
  if (haveX && process.getuid && process.getuid() === 0) {
    try {
      execSync('id benchtest >/dev/null 2>&1 || (useradd -m benchtest && echo "benchtest:benchpw" | chpasswd)');
      execSync('mkdir -p /run/sshd && ssh-keygen -A >/dev/null 2>&1; (pgrep -x sshd -a | grep -q "\-p 2222") || /usr/sbin/sshd -p 2222 -o PasswordAuthentication=yes -o KbdInteractiveAuthentication=yes');
      const xv = spawn('Xvfb', [':77', '-screen', '0', '1024x700x24'], { stdio: 'ignore' }); await sleep(800);
      execSync('x11vnc -storepasswd vncpw /tmp/bench-vncpw >/dev/null 2>&1');
      const vnc = spawn('x11vnc', ['-display', ':77', '-rfbport', '5977', '-rfbauth', '/tmp/bench-vncpw', '-forever', '-shared', '-quiet'], { stdio: 'ignore' });
      spawn('xterm', ['-display', ':77', '-geometry', '80x20+40+40'], { stdio: 'ignore' }).on('error', () => {});
      await sleep(1500);
      r = await tool('create_desk', { kind: 'vnc', name: 'Linux box', host: '127.0.0.1', vnc_port: 5977, vnc_password: 'vncpw', ssh_user: 'benchtest', ssh_password: 'benchpw', ssh_port: 2222 });
      r = await tool('desk_control', { desk: 'Linux box', action: 'start' });
      check('real x11vnc desk connects', /running/.test(txt(r)), txt(r));
      await sleep(2500);
      r = await tool('run_command', { desk: 'Linux box', command: 'whoami && echo ssh-works' });
      check('commands run over SSH', /benchtest/.test(txt(r)) && /ssh-works/.test(txt(r)), txt(r));
      const f = path.join(TMP, 'build.txt'); fs.writeFileSync(f, 'build 1');
      r = await tool('copy_files', { desk: 'Linux box', direction: 'in', from: f, to: '/tmp/bench-copied.txt' });
      r = await tool('run_command', { desk: 'Linux box', command: 'cat /tmp/bench-copied.txt' });
      check('copy_files in over SFTP', /build 1/.test(txt(r)), txt(r));
      r = await tool('copy_files', { desk: 'Linux box', direction: 'out', from: '/tmp/bench-copied.txt', to: path.join(TMP, 'back.txt') });
      check('copy_files out', fs.existsSync(path.join(TMP, 'back.txt')), txt(r));
      r = await tool('screenshot', { desk: 'Linux box' }, 'x11vnc');
      check('real VNC screenshot', imgs(r).length === 1, txt(r));
      await tool('desk_control', { desk: 'Linux box', action: 'stop' });
      vnc.kill(); xv.kill();
    } catch (e) { check('real VNC + SSH desk', false, e.message); }
  } else console.log('(skipping real VNC + SSH: needs root, Xvfb, x11vnc and sshd)');

  r = await tool('stop_session', { session: sid });
  check('stop_session quits the app', /Stopped Alpha/.test(txt(r)), txt(r));
  r = await tool('desk_control', { action: 'reset' });
  check('reset wipes the sandbox desk', /wiped/.test(txt(r)), txt(r));

  const errs = fs.existsSync(path.join(OUT, 'bench-errors.txt')) ? fs.readFileSync(path.join(OUT, 'bench-errors.txt'), 'utf8').split('\n').filter((l) => l && !/Fontconfig|dbus|gpu|GLES|viz|ssl_client|Autofill|SharedImage|angle|Vulkan|libva/i.test(l)) : [];
  check('Bench itself logged no errors', !errs.length, errs.slice(0, 5).join(' | '));
  await bench.quit();
  fs.writeFileSync(path.join(OUT, 'results.txt'), results.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  console.log(`\n${pass} passed, ${fail} failed — pictures and transcript in ${OUT}`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('E2E crashed:', e); process.exit(2); });
