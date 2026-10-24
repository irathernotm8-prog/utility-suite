// Cadence — end-to-end: starts the app on demo data against a local "analytics site", runs the weekly report
// for real (browser sign-in, export, week folder, compare, AI stand-in, PowerPoint), and screenshots every screen.
// xvfb-run node test/e2e/shots.js [outDir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron } = require('playwright');
const site = require('./site');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'shots'));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await site.start();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-e2e-'));
  // stand-in for `claude -p` so the AI step works offline
  const fake = path.join(tmp, 'claude');
  fs.writeFileSync(path.join(tmp, 'fake.js'), `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{ if(process.argv.includes('--version')){console.log('2.1.0 (Claude Code)');return;} console.log(JSON.stringify({headline:'Sign-ups up 6% week over week, led by TikTok',bullets:['TikTok sign-ups jumped 51% on 12% more spend — best cost per sign-up gain this week.','Email grew 18% with no spend; the Thursday newsletter drove most of it.','Google Search slipped 7% while spend held flat — worth a bid review.']}));});`);
  fs.writeFileSync(fake, `#!/bin/sh\nexec node "${path.join(tmp, 'fake.js')}" "$@"\n`); fs.chmodSync(fake, 0o755);
  const outDir = path.join(tmp, 'Reports');
  const app = await _electron.launch({
    executablePath: require('electron'), args: ['--no-sandbox', path.join(__dirname, '..', '..')],
    env: { ...process.env, CADENCE_DEMO: '1', CADENCE_E2E: '1', CADENCE_USER_DATA: path.join(tmp, 'data'), CADENCE_DEMO_SITE: base, CADENCE_DEMO_OUT: outDir, CADENCE_CLAUDE: fake, CADENCE_CODEX: path.join(tmp, 'none'), HOME: tmp },
  });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1360, height: 860 });
  await win.waitForSelector('body.ready');
  const theme = async (t) => { await win.evaluate((x) => { document.documentElement.dataset.theme = x; }, t); };
  const shot = async (name) => { await win.waitForTimeout(450); await win.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot', name); };
  const go = (v, a) => win.evaluate(([v, a]) => go(v, a), [v, a]);

  await theme('dark');
  await shot('01-automations');

  // run the weekly report for real: first week, then "next week" with a different export
  const id = await win.evaluate(() => S.flows.find((f) => f.name === 'Weekly sign-ups report').id);
  const runOnce = async () => {
    const snap = await win.evaluate((id) => call('run:start', id, {}), id);
    for (let i = 0; i < 240; i++) { const st = await win.evaluate((rid) => call('runs:get', rid).then((r) => r.status), snap.id); if (!['running', 'queued'].includes(st)) break; await win.waitForTimeout(500); }
    return win.evaluate((rid) => call('runs:get', rid), snap.id);
  };
  // week 1 uses "This week" as the baseline, then the real "Last week" export compares against it
  await win.evaluate((id) => call('flows:get', id).then((f) => { f.steps[0].with.actions[4].value = 'This week'; return call('flows:save', f); }), id);
  const r1 = await runOnce();
  console.log('run 1:', r1.status, r1.error || '');
  await win.evaluate((id) => call('flows:get', id).then((f) => { f.steps[0].with.actions[4].value = 'Last week'; return call('flows:save', f); }), id);
  const r2 = await runOnce();
  console.log('run 2:', r2.status, r2.error || '', r2.files);
  if (r2.status !== 'done') console.log(JSON.stringify(r2.steps.filter((s) => s.status === 'failed'), null, 1));

  await go('flows'); await shot('02-automations-after-run');
  await go('editor', id); await win.waitForSelector('.node'); await shot('03-editor-trigger');
  await win.evaluate(() => Editor.select('pull')); await shot('04-editor-browser');
  await win.evaluate(() => Editor.select('by_channel')); await shot('05-editor-transform');
  await win.evaluate(() => Editor.select('compare')); await shot('06-editor-compare');
  await win.evaluate(() => Editor.select('slides')); await shot('07-editor-slides');
  await win.evaluate(() => { const b = document.querySelector('.ins'); stepPicker(3); }); await shot('08-step-picker');
  await win.evaluate(() => closeSheet());
  await go('run', r2.id); await shot('09-run');
  await go('runs'); await shot('10-runs');
  await go('templates'); await shot('11-templates');
  await go('connections'); await win.waitForSelector('.conn'); await shot('12-connections');
  await go('settings'); await shot('13-settings');
  await win.evaluate(() => describeSheet()); await shot('14-describe');
  await win.evaluate(() => closeSheet());
  await theme('light');
  await go('flows'); await shot('15-light-automations');
  await go('editor', id); await win.waitForSelector('.node'); await win.evaluate(() => Editor.select('slides')); await shot('16-light-editor');
  await go('run', r2.id); await shot('17-light-run');

  // recorder: click through the sign-in page in the Record window and check the actions it writes
  await win.evaluate((u) => { window.__rec = []; C.on('record:event', (e) => window.__rec.push(e)); return call('record:start', 'rec-test', u); }, base + '/login');
  let rw = null; for (let i = 0; i < 40 && !rw; i++) { rw = app.windows().find((w) => w.url().includes('/login') && w !== win); if (!rw) await win.waitForTimeout(250); }
  await rw.waitForLoadState(); await rw.fill('#e', 'me@example.com'); await rw.fill('#p', site.PASSWORD); await rw.click('text=Sign in');
  await rw.waitForURL(/reports/); await rw.selectOption('#r', 'last-week'); await rw.click('#exp'); await rw.waitForTimeout(1500);
  await win.evaluate(() => call('record:stop')); await win.waitForTimeout(800);
  const rec = await win.evaluate(() => window.__rec);
  console.log('recorded:', JSON.stringify(rec.filter((e) => e.type !== 'nav').map((e) => e.type === 'action' ? e.action : e)));
  // plugin: write Claude Desktop and Codex settings into the scratch home
  const cs = await win.evaluate(() => call('connectors:desktop').then(() => call('connectors:codex')));
  console.log('desktop added:', cs.desktop.added, 'codex added:', cs.codex.added);
  console.log(fs.readFileSync(path.join(tmp, '.codex', 'config.toml'), 'utf8'));

  // copy the deck so it can be looked at
  for (const f of r2.files || []) if (/\.(pptx|pdf|xlsx)$/.test(f) && fs.existsSync(f)) fs.copyFileSync(f, path.join(OUT, path.basename(f)));
  fs.writeFileSync(path.join(OUT, 'run2.json'), JSON.stringify(r2, null, 1));
  await app.close(); srv.close();
  process.exit(r1.status === 'done' && r2.status === 'done' ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
