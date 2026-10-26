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
  fs.copyFileSync(path.join(__dirname, 'fake-ai.js'), path.join(tmp, 'fake.js'));
  const deckTpl = await require('../fixtures/make-lumen-template')(path.join(tmp, 'Weekly Ads Update.pptx'));
  const electronBin = require('electron');
  const lumenDir = process.env.LUMEN_DIR || path.join(__dirname, '..', '..', '..', 'lumen');
  fs.writeFileSync(fake, `#!/bin/sh\nexec node "${path.join(tmp, 'fake.js')}" "$@"\n`); fs.chmodSync(fake, 0o755);
  const outDir = path.join(tmp, 'Reports');
  const app = await _electron.launch({
    executablePath: require('electron'), args: ['--no-sandbox', path.join(__dirname, '..', '..')],
    env: { ...process.env, CADENCE_DEMO: '1', CADENCE_E2E: '1', CADENCE_USER_DATA: path.join(tmp, 'data'), CADENCE_DEMO_SITE: base, CADENCE_DEMO_OUT: outDir, CADENCE_CLAUDE: fake, CADENCE_CODEX: path.join(tmp, 'none'), HOME: tmp, CADENCE_DEMO_PPTX: deckTpl,
      CADENCE_APPS: JSON.stringify(fs.existsSync(lumenDir) ? [{ name: 'Lumen', exec: electronBin, args: ['--no-sandbox', lumenDir], env: { LUMEN_USER_DATA: path.join(tmp, 'lumen-data') }, kind: 'electron' }] : []) },
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

  // ───── Lumen → the team's PowerPoint template
  const lid = await win.evaluate(() => (S.flows.find((f) => f.name === 'Weekly Lumen deck') || {}).id);
  if (lid) {
    await go('editor', lid); await win.waitForSelector('.node'); await win.evaluate(() => Editor.select('lumen')); await shot('18-lumen-step');
    const wait = async (rid) => { for (let i = 0; i < 300; i++) { const st = await win.evaluate((r) => call('runs:get', r).then((x) => x.status), rid); if (!['running', 'queued'].includes(st)) break; await win.waitForTimeout(500); } return win.evaluate((r) => call('runs:get', r), rid); };
    // test up to the Lumen step so its tables are known to the editor
    await win.evaluate(() => Editor.test('lumen'));
    const t1 = await win.evaluate(() => Editor.run && Editor.run.id);
    const tr = await wait(t1);
    console.log('lumen test:', tr.status, tr.error || '', JSON.stringify(tr.outputs.lumen && tr.outputs.lumen.values));
    await win.waitForTimeout(800); await shot('19-lumen-result');
    await win.evaluate(() => Editor.select('deck')); await win.waitForSelector('.pm-slide'); await shot('20-template-map');
    await win.click('text=Map with AI'); await win.waitForSelector('.pm-box.on', { timeout: 20000 });
    await win.evaluate(() => { const b = document.querySelectorAll('.pm-box.on')[1]; if (b) b.click(); }); await shot('21-template-mapped');
    await win.evaluate(() => Editor.flush());
    const snap = await win.evaluate((id) => call('run:start', id, {}), lid);
    const lr = await wait(snap.id);
    console.log('lumen run:', lr.status, lr.error || '', lr.files);
    if (lr.status !== 'done') console.log(JSON.stringify(lr.steps.filter((s) => s.status === 'failed'), null, 1));
    await go('run', lr.id); await shot('22-lumen-run');
    for (const f of lr.files || []) if (/\.(pptx|xlsx|png)$/.test(f) && fs.existsSync(f)) fs.copyFileSync(f, path.join(OUT, 'lumen-' + path.basename(f)));
    fs.copyFileSync(deckTpl, path.join(OUT, 'lumen-template.pptx'));
  } else console.log('no Lumen flow (set LUMEN_DIR)');

  // copy the deck so it can be looked at
  for (const f of r2.files || []) if (/\.(pptx|pdf|xlsx)$/.test(f) && fs.existsSync(f)) fs.copyFileSync(f, path.join(OUT, path.basename(f)));
  fs.writeFileSync(path.join(OUT, 'run2.json'), JSON.stringify(r2, null, 1));
  await app.close(); srv.close();
  process.exit(r1.status === 'done' && r2.status === 'done' ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
