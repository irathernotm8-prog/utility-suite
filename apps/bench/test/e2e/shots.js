// Bench — screenshots of every screen (demo mode, a sample app running, a run and findings). Linux: xvfb-run.
//   node test/e2e/shots.js [outDir] [theme]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { ElectronApp } = require('../../src/core/electron-app');

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.argv[2] || path.join(ROOT, 'test', 'shots'); fs.mkdirSync(OUT, { recursive: true });
const THEME = process.argv[3] || 'dark';
const USER = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-shots-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bridge;
const tool = (name, args = {}) => new Promise((resolve, reject) => { const data = JSON.stringify({ name, args, client: 'claude-code' }); const req = http.request({ host: '127.0.0.1', port: bridge.port, path: '/call', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Authorization: 'Bearer ' + bridge.token } }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => resolve(JSON.parse(s))); }); req.on('error', reject); req.end(data); });

(async () => {
  fs.writeFileSync(path.join(USER, 'settings.json'), JSON.stringify({ theme: THEME, background: false, liveFps: 8 }));
  const bench = new ElectronApp({ id: 'b', name: 'Bench', exec: require(path.join(ROOT, 'node_modules', 'electron')), args: [ROOT], cwd: ROOT, env: { BENCH_USER_DATA: USER, BENCH_DEMO: '1' }, userData: USER, hidden: false });
  await bench.start(); await bench.waitForWindow();
  for (let i = 0; i < 100 && !bridge; i++) { try { bridge = JSON.parse(fs.readFileSync(path.join(USER, 'bridge.json'), 'utf8')); } catch { await sleep(200); } }
  await bench.call('setSize', null, 1440, 900); await sleep(800);
  const js = (code) => bench.page(null, code);
  const shot = async (name, wait = 900) => { await sleep(wait); const s = await bench.screenshot(); fs.writeFileSync(path.join(OUT, `${name}.png`), s.buffer); console.log('shot', name); };
  const sample = path.join(USER, 'Sample'); fs.cpSync(path.join(ROOT, 'test', 'fixtures', 'sample-app'), sample, { recursive: true });
  fs.mkdirSync(path.join(sample, 'node_modules'), { recursive: true }); fs.symlinkSync(path.join(ROOT, 'node_modules', 'electron'), path.join(sample, 'node_modules', 'electron'));
  await shot('01-desks');
  await tool('launch', { path: sample });
  await tool('click', { text: 'Throw' });
  await tool('type', { ref: 'e1', text: 'Ship Bench' }).catch(() => {});
  const ins = await tool('inspect', {}); const ref = (/(e\d+) textbox/.exec(ins.content[0].text) || [])[1]; if (ref) await tool('type', { ref, text: 'Ship Bench', submit: true });
  await js("document.querySelector('[data-act=open-desk]').click()");
  await shot('02-desk-live', 2200);
  await tool('click', { text: 'Add' }); await shot('03-desk-ghost', 500);
  await js("document.querySelector('#rTabs [data-tab=logs]').click()"); await shot('04-desk-logs', 500);
  await tool('click', { text: 'Open file' }); await shot('05-desk-dialog', 1200);
  await tool('answer_dialog', { cancel: true });
  await js("document.querySelector('#rTabs [data-tab=details]').click()"); await shot('06-desk-details', 500);
  await js("document.querySelector('[data-act=launch]').click()"); await shot('07-launch-sheet', 900);
  await js("Sheets.close()");
  await tool('run_tests', { projects: [sample] });
  await js("go('runs')"); await shot('08-runs', 1500);
  await js("go('findings')"); await shot('09-findings', 1200);
  await js("go('claude')"); await shot('10-claude', 900);
  await js("go('engines')"); await shot('11-vms', 1500);
  await js("go('settings')"); await shot('12-settings', 900);
  await js("go('desks')"); await js("Sheets.newDesk()"); await shot('13-new-desk', 1200);
  await js("document.querySelector('#kinds [data-k=vnc]').click()"); await shot('14-new-desk-vnc', 500);
  await js("Sheets.close()");
  await tool('desk_control', { desk: 'Demo desktop', action: 'start' });
  await tool('click', { desk: 'Demo desktop', x: 640, y: 462 });
  await js("go('desks', { desk: S.desks.find((d) => d.kind === 'vnc').id })"); await shot('15-vnc-desk', 2500);
  await tool('click', { desk: 'Demo desktop', x: 600, y: 360 }); await shot('16-vnc-ghost', 600);
  await js("go('desks')"); await shot('17-desks-busy', 7000);
  await bench.quit();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
