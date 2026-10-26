// Cadence — engine checks (plain Node, no Electron, no network). `npm test`
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-test-'));
const HOME = path.join(ROOT, 'home'); fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME; process.env.USERPROFILE = HOME;

// A stand-in for `claude -p`: echoes JSON built from the prompt so the AI step can be checked offline.
const FAKE = path.join(ROOT, process.platform === 'win32' ? 'claude.cmd' : 'claude');
if (process.platform === 'win32') fs.writeFileSync(FAKE, `@node "${path.join(ROOT, 'fake.js')}" %*\r\n`);
else { fs.writeFileSync(FAKE, `#!/bin/sh\nexec "${process.execPath}" "${path.join(ROOT, 'fake.js')}" "$@"\n`); fs.chmodSync(FAKE, 0o755); }
fs.writeFileSync(path.join(ROOT, 'fake.js'), `
let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
  if (process.argv.includes('--version')) { console.log('9.9.9 (Claude Code)'); return; }
  if (/write automations for Cadence/.test(s)) { console.log(JSON.stringify({ name: 'Drafted', trigger: { type: 'schedule', every: 'week', days: [1], time: '08:00' }, steps: [{ type: 'folder.make', name: 'Week folder', with: { path: '~/Out/{{week.label}}' } }, { type: 'logic.notify', with: { title: 'Made {{steps.week_folder.folder}}' } }] })); return; }
  const rows = (s.match(/\\n[A-Za-z]+,\\d/g)||[]).length;
  console.log('Sure! \\n\`\`\`json\\n' + JSON.stringify({ headline: 'Sign-ups up', bullets: ['Rows seen: ' + rows, 'Meta leads', 'Spend flat'] }) + '\\n\`\`\`');
});`);
process.env.CADENCE_CLAUDE = FAKE;
process.env.CADENCE_CODEX = path.join(ROOT, 'no-codex');

const { render } = require('../src/core/template');
const { dateContext, weekInfo, format } = require('../src/core/dates');
const { nextRun, describe } = require('../src/core/schedule');
const T = require('../src/core/table');
const { Engine } = require('../src/core/engine');
const { validate, normalize } = require('../src/core/validate');
const { TEMPLATES } = require('../src/core/templates');
const { STEPS, referenceText } = require('../src/core/catalog');
const docs = require('../src/core/steps/docs')._;
const aiBuild = require('../src/core/ai-build');

let passed = 0; const fails = [];
async function check(name, fn) { try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { fails.push(name); console.log('  ✗ ' + name + '\n    ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n    ')); } }

(async () => {
  console.log('Cadence checks');

  await check('dates: weeks, ISO numbers, labels', () => {
    const w = weekInfo(new Date(2026, 9, 24), 1);
    assert.strictEqual(w.start, '2026-10-19'); assert.strictEqual(w.end, '2026-10-25'); assert.strictEqual(w.iso, '2026-W43'); assert.strictEqual(w.label, 'Week of 2026-10-19'); assert.strictEqual(w.range, 'Oct 19 – 25, 2026');
    assert.strictEqual(weekInfo(new Date(2026, 9, 24), 0).start, '2026-10-18');
    assert.strictEqual(weekInfo(new Date(2027, 0, 1), 1).iso, '2026-W53');
    assert.strictEqual(weekInfo(new Date(2026, 8, 30), 1).range, 'Sep 28 – Oct 4, 2026');
    assert.strictEqual(format(new Date(2026, 0, 5, 14, 7), 'ddd MMM D, h:mm A [wk] WW'), 'Mon Jan 5, 2:07 PM wk 02');
  });

  await check('templates: paths, filters, raw values, errors', () => {
    const ctx = { ...dateContext(new Date(2026, 9, 24, 9)), steps: { a: { table: { columns: ['n', 'Name'], rows: [{ n: 1200, Name: 'x' }, { n: 34.5, Name: 'y' }] }, file: '/x/My File.csv', list: ['a', 'b'] } } };
    assert.strictEqual(render('{{week.label}}/{{ steps.a.file | stem }}.{{steps.a.file|ext}}', ctx), 'Week of 2026-10-19/My File.csv');
    assert.deepStrictEqual(render('{{steps.a.table}}', ctx).rows.length, 2);
    assert.strictEqual(render('{{steps.a.table | sum:"n" | currency:"$",2}}', ctx), '$1,234.50');
    assert.strictEqual(render("{{ today | addDays:-7 | date:'MMM D' }}", ctx), 'Oct 17');
    assert.strictEqual(render('{{0.1234 | change}} {{ -0.05 | change:0 }} {{ nothing | change }}|', ctx), '+12.3% −5% |');
    assert.strictEqual(render('{{steps.a.list}}', ctx).length, 2);
    assert.strictEqual(render('[{{steps.a.list | join:" / "}}]', ctx), '[a / b]');
    assert.strictEqual(render('{{ steps.a.table.rows[-1].Name | upper }}', ctx), 'Y');
    assert.strictEqual(render('{{ "Q3 Report!" | slug }}', ctx), 'q3-report');
    assert.throws(() => render('{{ x | nope }}', ctx), /Unknown filter/);
  });

  await check('schedules: next run and wording', () => {
    const at = new Date(2026, 9, 24, 0, 18); // Sat
    assert.strictEqual(nextRun({ type: 'schedule', every: 'week', days: [1], time: '08:00' }, at).toString(), new Date(2026, 9, 26, 8, 0).toString());
    assert.strictEqual(nextRun({ type: 'schedule', every: 'day', days: [1, 2, 3, 4, 5], time: '07:30' }, at).getDate(), 26);
    assert.strictEqual(nextRun({ type: 'schedule', every: 'day', time: '23:59' }, at).getDate(), 24);
    assert.strictEqual(nextRun({ type: 'schedule', every: 'month', dayOfMonth: 'last', time: '09:00' }, at).getDate(), 31);
    assert.strictEqual(nextRun({ type: 'schedule', every: 'month', dayOfMonth: 31, time: '09:00' }, new Date(2026, 10, 2)).getDate(), 30);
    assert.strictEqual(nextRun({ type: 'schedule', every: 'month', dayOfMonth: 'firstWeekday', time: '09:00' }, new Date(2026, 10, 2, 10)).toDateString(), new Date(2026, 11, 1).toDateString());
    assert.strictEqual(nextRun({ type: 'schedule', every: 'minutes', interval: 15 }, new Date(2026, 9, 24, 10, 7)).getMinutes(), 15);
    assert.strictEqual(nextRun({ type: 'schedule', every: 'hours', interval: 4, time: '00:30' }, new Date(2026, 9, 24, 10, 7)).getHours(), 12);
    assert.strictEqual(describe({ type: 'schedule', every: 'week', days: [1], time: '08:00' }), 'Every Monday at 8:00 AM');
    assert.strictEqual(describe({ type: 'schedule', every: 'day', days: [1, 2, 3, 4, 5], time: '17:05' }), 'Weekdays at 5:05 PM');
    assert.strictEqual(describe({ type: 'schedule', every: 'week', days: [1, 3, 5], time: '09:00', interval: 2 }), 'Every 2 weeks on Mon, Wed and Fri at 9:00 AM');
  });

  await check('tables: CSV quirks, types, Excel round trip', async () => {
    const t = T.parseCSV('\uFEFFName;Amount;Zip;Pct\n"Smith, J";"1.204,5";02139;12%\n"Line\nbreak";(300);10001;5%\n');
    assert.deepStrictEqual(t.columns, ['Name', 'Amount', 'Zip', 'Pct']);
    assert.strictEqual(t.rows[1].Name, 'Line\nbreak'); assert.strictEqual(t.rows[0].Zip, '02139'); assert.strictEqual(t.rows[1].Amount, -300); assert.strictEqual(t.rows[0].Pct, 0.12);
    const c = T.parseCSV('Report title\nGenerated today\nA,B\n1,2\n', { skip: 2 }); assert.deepStrictEqual(c.columns, ['A', 'B']); assert.strictEqual(c.rows[0].B, 2);
    const f = path.join(ROOT, 'x.xlsx');
    await T.writeXLSX(f, [{ name: 'Data', table: { columns: ['Ch', 'N'], rows: [{ Ch: 'Meta', N: 5 }, { Ch: 'Google', N: 7.25 }] } }]);
    const back = await T.readXLSX(f); assert.deepStrictEqual(back.rows, [{ Ch: 'Meta', N: 5 }, { Ch: 'Google', N: 7.25 }]);
    assert.ok(T.toCSV({ columns: ['a'], rows: [{ a: 'x,"y"' }] }).includes('"x,""y"""'));
  });

  await check('tables: transforms, formulas, totals, compare', () => {
    const t = { columns: ['Channel', 'Date', 'Signups', 'Spend'], rows: [{ Channel: 'Meta', Date: '2026-10-19', Signups: 10, Spend: 100 }, { Channel: 'Google', Date: '2026-10-20', Signups: 30, Spend: 60 }, { Channel: 'Meta', Date: '2026-10-21', Signups: 20, Spend: 50 }, { Channel: 'Email', Date: '2026-10-28', Signups: 5, Spend: 0 }] };
    const r = T.transform(t, [{ op: 'filter', column: 'Date', test: 'between', value: '2026-10-19', value2: '2026-10-25' }, { op: 'group', by: ['Channel'] }, { op: 'compute', as: 'CPS', formula: 'round([Spend] / [Signups], 2)' }, { op: 'sort', column: 'Signups', dir: 'desc' }, { op: 'totalRow' }]);
    assert.deepStrictEqual(r.rows.map((x) => x.Channel), ['Meta', 'Google', 'Total']);
    assert.strictEqual(r.rows[2].Signups, 60); assert.strictEqual(r.rows[2].CPS, 3.5);
    assert.strictEqual(T.compileFormula('if([a] > 2, "big", "small") & "!"')({ a: 3 }), 'big!');
    assert.strictEqual(T.compileFormula('[a] / [b]')({ a: 1, b: 0 }), 0);
    assert.throws(() => T.transform(t, [{ op: 'sort', column: 'Nope' }]), /no column “Nope”/);
    const cmp = T.compare(r, { columns: ['Channel', 'Signups'], rows: [{ Channel: 'Meta', Signups: 20 }] }, { key: 'Channel', columns: ['Signups'] });
    assert.strictEqual(cmp.table.rows[0]['Signups change %'], 0.5); assert.strictEqual(cmp.table.rows[1]['Signups (previous)'], '');
    const tot = T.transform(t, [{ op: 'total', aggregates: [{ column: 'Signups', fn: 'sum' }, { column: 'Channel', fn: 'countDistinct', as: 'Channels' }] }]);
    assert.deepStrictEqual(tot.rows[0], { Signups: 65, Channels: 3 });
  });

  await check('catalog and starter templates are valid', () => {
    for (const tpl of TEMPLATES) { const v = validate(normalize(tpl.flow)); assert.ok(v.ok, tpl.id + ': ' + JSON.stringify(v.errors)); }
    assert.ok(referenceText().length > 3000);
    for (const [k, s] of Object.entries(STEPS)) assert.ok(s.label && s.fields && s.outputs && s.group, k);
  });

  await check('validation: order, unknown steps, missing fields, id fixing', () => {
    const f = normalize({ name: 'x', steps: [{ type: 'data.read', with: { file: '{{steps.later.file}}' } }, { id: 'later', type: 'web.download', with: {} }, { type: 'nope' }, { id: 'Bad Id!', type: 'folder.make', path: '~/a' }] });
    const v = validate(f);
    assert.ok(v.errors.some((e) => /before that step has run/.test(e.msg)));
    assert.ok(v.errors.some((e) => /Link is needed/.test(e.msg)));
    assert.ok(v.errors.some((e) => /Unknown step type/.test(e.msg)));
    assert.strictEqual(f.steps[3].id, 'make_a_folder'); assert.strictEqual(f.steps[3].with.path, '~/a');
  });

  // ───────── whole runs against a local "reporting site"
  let week = 1;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/export.csv')) {
      if (req.headers.authorization !== 'Bearer s3cret') { res.writeHead(401); return res.end('no'); }
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="signups-export.csv"' });
      return res.end(week === 1 ? 'Channel,Date,Signups,Spend\nMeta,2026-10-12,100,500\nGoogle,2026-10-13,80,400\nMeta,2026-10-14,20,100\n' : 'Channel,Date,Signups,Spend\nMeta,2026-10-19,150,520\nGoogle,2026-10-20,60,380\nEmail,2026-10-21,30,0\n');
    }
    if (req.url === '/api') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: { items: [{ id: 1, user: { name: 'A' } }, { id: 2, user: { name: 'B' } }] } })); }
    if (req.url === '/hook') { let b = ''; req.on('data', (d) => (b += d)).on('end', () => { server.lastHook = JSON.parse(b); res.end('ok'); }); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const notes = []; const pdfs = [];
  const engine = new Engine({ root: path.join(ROOT, 'data'), settings: () => ({ weekStart: 1 }), services: { documents: path.join(HOME, 'Documents'), notify: (t, b, o) => notes.push({ t, b, o }), trash: async (p) => fs.rmSync(p, { recursive: true }), pdf: async (html, dest) => { pdfs.push(dest); fs.writeFileSync(dest, html); } } });
  engine.store.secrets.set('REPORT_TOKEN', 's3cret');

  const flow = {
    name: 'Weekly sign-ups', trigger: { type: 'schedule', every: 'week', days: [1], time: '08:00' },
    steps: [
      { id: 'pull', type: 'web.download', with: { url: base + '/export.csv', headers: [{ key: 'Authorization', value: 'Bearer {{secrets.REPORT_TOKEN}}' }] } },
      { id: 'folder', type: 'folder.make', with: { path: '~/Reports/{{week.label}}' } },
      { id: 'save', type: 'file.save', with: { files: '{{steps.pull.files}}', to: '{{steps.folder.folder}}', rename: 'Signups {{week.start}}', mode: 'copy' } },
      { id: 'read', type: 'data.read', with: { file: '{{steps.save.file}}' } },
      { id: 'gate', type: 'logic.if', with: { left: '{{steps.read.count}}', test: 'gt', right: '0', otherwise: 'fail' } },
      { id: 'by_channel', type: 'data.transform', with: { table: '{{steps.read.table}}', ops: [{ op: 'group', by: ['Channel'], aggregates: [{ column: 'Signups', fn: 'sum' }, { column: 'Spend', fn: 'sum' }] }, { op: 'sort', column: 'Signups', dir: 'desc' }] } },
      { id: 'compare', type: 'data.compare', with: { table: '{{steps.by_channel.table}}', key: 'Channel', columns: ['Signups', 'Spend'] } },
      { id: 'summary', type: 'ai.ask', with: { provider: 'claude', prompt: 'Summarize', attach: ['{{steps.compare.table}}'], json: true } },
      { id: 'slides', type: 'doc.slides', with: { path: '{{steps.folder.folder}}/Weekly {{week.start}}.pptx', theme: 'midnight', accent: '#7C5CFF', footer: '{{week.range}}', slides: [
        { layout: 'title', title: 'Weekly sign-ups', subtitle: '{{week.range}}' },
        { layout: 'kpis', title: '{{steps.summary.json.headline}}', items: [{ label: 'Sign-ups', value: '{{steps.compare.totals.Signups.now | number}}', delta: '{{steps.compare.totals.Signups.changePct | change}}', note: 'vs last week' }, { label: 'Spend', value: '{{steps.compare.totals.Spend.now | currency}}', good: 'down', delta: '{{steps.compare.totals.Spend.changePct | change}}' }] },
        { layout: 'chart', title: 'By channel', table: '{{steps.by_channel.table}}', chart: 'column', x: 'Channel', y: ['Signups'], notes: '{{steps.summary.json.bullets}}' },
        { layout: 'chart', title: 'Spend mix', table: '{{steps.by_channel.table}}', chart: 'doughnut', x: 'Channel', y: ['Spend'] },
        { layout: 'table', title: 'Week over week', table: '{{steps.compare.table}}', columns: ['Channel', 'Signups', 'Signups (previous)', 'Signups change %'] },
        { layout: 'bullets', title: 'Takeaways', bullets: '{{steps.summary.json.bullets}}' },
      ] } },
      { id: 'report', type: 'doc.report', with: { path: '{{steps.folder.folder}}/Weekly {{week.start}}.pdf', title: 'Weekly sign-ups', subtitle: '{{week.range}}', sections: [{ layout: 'kpis', items: [{ label: 'Sign-ups', value: '{{steps.compare.totals.Signups.now}}' }] }, { layout: 'chart', title: 'By channel', table: '{{steps.by_channel.table}}', chart: 'line' }, { layout: 'table', table: '{{steps.compare.table}}' }] } },
      { id: 'md', type: 'doc.report', with: { path: '{{steps.folder.folder}}/notes.md', title: 'Notes', sections: [{ layout: 'table', title: 'By channel', table: '{{steps.by_channel.table}}' }] } },
      { id: 'xlsx', type: 'data.write', with: { path: '{{steps.folder.folder}}/Data.xlsx', sheets: [{ name: 'By channel', table: '{{steps.by_channel.table}}' }, { name: 'Raw', table: '{{steps.read.table}}' }] } },
      { id: 'hook', type: 'web.post', with: { url: base + '/hook', text: 'Report ready: {{steps.slides.file | basename}}' } },
      { id: 'tell', type: 'logic.notify', with: { title: 'Done', open: '{{steps.slides.file}}' } },
    ],
  };
  const { flow: saved, problems } = engine.save(flow);

  await check('a whole weekly run: download → week folder → data → compare → AI → PowerPoint, PDF, Excel', async () => {
    assert.ok(problems.ok, JSON.stringify(problems.errors));
    const run = await engine.runAndWait(saved.id);
    const s = run.snapshot({ full: true });
    assert.strictEqual(s.status, 'done', s.error + '\n' + JSON.stringify(s.steps.filter((x) => x.status === 'failed'), null, 1));
    const wk = dateContext(new Date()).week;
    const folder = path.join(HOME, 'Reports', wk.label);
    for (const f of [`Signups ${wk.start}.csv`, `Weekly ${wk.start}.pptx`, `Weekly ${wk.start}.pdf`, 'Data.xlsx', 'notes.md']) assert.ok(fs.existsSync(path.join(folder, f)), 'missing ' + f);
    assert.strictEqual(run.outputs.read.count, 3);
    assert.strictEqual(run.outputs.compare.hadPrevious, false);
    assert.strictEqual(run.outputs.summary.json.headline, 'Sign-ups up');
    assert.strictEqual(run.outputs.slides.count, 6);
    assert.ok(fs.statSync(path.join(folder, `Weekly ${wk.start}.pptx`)).size > 30000);
    assert.ok(server.lastHook.text.startsWith('Report ready: Weekly'));
    assert.strictEqual(notes[0].o, path.join(folder, `Weekly ${wk.start}.pptx`));
    assert.ok(!JSON.stringify(s).includes('s3cret'), 'secret leaked into the run log');
    const { unzipSync, strFromU8 } = require('fflate');
    const z = unzipSync(new Uint8Array(fs.readFileSync(path.join(folder, `Weekly ${wk.start}.pptx`))));
    assert.ok(Object.keys(z).some((k) => /charts\/chart\d+\.xml$/.test(k)), 'deck should contain real charts');
    assert.ok(strFromU8(z['ppt/slides/slide2.xml']).includes('Sign-ups up'));
    assert.ok(fs.readFileSync(path.join(folder, `Weekly ${wk.start}.pdf`), 'utf8').includes('<svg'));
  });

  await check('second run compares with the first (week over week)', async () => {
    week = 2;
    const run = await engine.runAndWait(saved.id);
    assert.strictEqual(run.status, 'done', run.error);
    assert.strictEqual(run.outputs.compare.hadPrevious, true);
    const meta = run.outputs.compare.table.rows.find((r) => r.Channel === 'Meta');
    assert.strictEqual(meta['Signups (previous)'], 120); assert.strictEqual(meta['Signups change'], 30);
    assert.strictEqual(run.outputs.compare.totals.Signups.now, 240); assert.strictEqual(run.outputs.compare.totals.Signups.previous, 200);
    assert.strictEqual(engine.runs({ flowId: saved.id }).length, 2);
  });

  await check('failures: clear message, retries, keep-going, condition stop', async () => {
    const f = engine.save({ name: 'Fails', steps: [
      { id: 'bad', type: 'web.download', retries: 1, continueOnError: true, with: { url: base + '/missing.csv' } },
      { id: 'gate', type: 'logic.if', with: { left: '{{steps.bad.error}}', test: 'contains', right: '404', otherwise: 'fail' } },
      { id: 'stop', type: 'logic.if', with: { left: '1', test: 'gt', right: '5', otherwise: 'stop' } },
      { id: 'never', type: 'folder.make', with: { path: '~/never' } },
    ] }).flow;
    const run = await engine.runAndWait(f.id);
    assert.strictEqual(run.status, 'done', run.error);
    assert.strictEqual(run.steps[0].status, 'failed'); assert.strictEqual(run.steps[0].attempt, 2);
    assert.strictEqual(run.steps[3].status, 'skipped'); assert.ok(!fs.existsSync(path.join(HOME, 'never')));
    const f2 = engine.save({ name: 'Fails hard', steps: [{ id: 'r', type: 'data.read', with: { file: '~/nope.csv' } }, { id: 'after', type: 'folder.make', with: { path: '~/after' } }] }).flow;
    const r2 = await engine.runAndWait(f2.id);
    assert.strictEqual(r2.status, 'failed'); assert.ok(/File not found/.test(r2.error)); assert.strictEqual(r2.steps[1].status, 'skipped');
  });

  await check('API step, unzip, find, cleanup, script, write, run another automation', async () => {
    const { zipSync, strToU8 } = require('fflate');
    const zp = path.join(HOME, 'in.zip'); fs.writeFileSync(zp, zipSync({ 'a/x.csv': strToU8('k,v\na,1\n'), 'b.txt': strToU8('hi'), '__MACOSX/._b': strToU8('') }));
    const old = path.join(HOME, 'old'); fs.mkdirSync(old); fs.writeFileSync(path.join(old, 'stale.log'), 'x'); fs.utimesSync(path.join(old, 'stale.log'), new Date(2020, 1, 1), new Date(2020, 1, 1)); fs.writeFileSync(path.join(old, 'fresh.log'), 'x');
    const child = engine.save({ name: 'Child', steps: [{ id: 'v', type: 'data.set', with: { values: [{ key: 'greet', value: 'hello {{inputs.who}}' }] } }] }).flow;
    const f = engine.save({ name: 'Misc', steps: [
      { id: 'api', type: 'web.request', with: { url: base + '/api', jsonPath: 'data.items' } },
      { id: 'unz', type: 'file.unzip', with: { file: zp } },
      { id: 'find', type: 'file.find', with: { folder: '{{steps.unz.folder}}', pattern: '*.csv', subfolders: true, pick: 'newest' } },
      { id: 'clean', type: 'file.cleanup', with: { folder: old, pattern: '*.log', days: 30 } },
      { id: 'sh', type: 'logic.script', with: { language: 'node', code: 'const c=require(process.env.CADENCE_CONTEXT); console.log(JSON.stringify({n: c.steps.api.table.rows.length}))' } },
      { id: 'w', type: 'file.write', with: { path: '~/out/{{flow.name | slug}}.txt', content: 'api rows {{steps.sh.json.n}}; user {{steps.api.table.rows[1]["user.name"]}}' } },
      { id: 'kid', type: 'logic.run', with: { flow: child.id, inputs: [{ key: 'who', value: '{{flow.name}}' }] } },
    ] }).flow;
    const run = await engine.runAndWait(f.id);
    assert.strictEqual(run.status, 'done', run.error + JSON.stringify(run.steps.map((s) => [s.id, s.status, s.error])));
    assert.strictEqual(run.outputs.api.table.rows.length, 2);
    assert.strictEqual(run.outputs.unz.files.length, 2);
    assert.strictEqual(path.basename(run.outputs.find.file), 'x.csv');
    assert.strictEqual(run.outputs.clean.count, 1); assert.ok(fs.existsSync(path.join(old, 'fresh.log')));
    assert.strictEqual(fs.readFileSync(path.join(HOME, 'out', 'misc.txt'), 'utf8'), 'api rows 2; user B');
    assert.strictEqual(run.outputs.kid.outputs.v.values.greet, 'hello Misc');
  });

  await check('scheduler: fires when due, catches up after sleep, skips when told not to', async () => {
    const f = engine.save({ name: 'Sched', trigger: { type: 'schedule', every: 'day', time: '06:00', catchUp: true }, steps: [{ id: 'n', type: 'logic.notify', with: { title: 'tick' } }] }).flow;
    const st = engine.store.state(f.id);
    st.nextAt = Date.now() - 3 * 3600e3; // missed by three hours (computer was asleep)
    const before = notes.length;
    engine.tick();
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(notes.length, before + 1);
    assert.ok(engine.store.state(f.id).nextAt > Date.now());
    const g = engine.save({ name: 'NoCatch', trigger: { type: 'schedule', every: 'day', time: '06:00', catchUp: false }, steps: [{ id: 'n', type: 'logic.notify', with: { title: 'nope' } }] }).flow;
    engine.store.state(g.id).nextAt = Date.now() - 3 * 3600e3;
    engine.tick(); await new Promise((r) => setTimeout(r, 300));
    assert.ok(!notes.some((n) => n.t === 'nope'));
  });

  await check('folder watch: a new file starts a run with it', async () => {
    const inbox = path.join(HOME, 'Inbox'); fs.mkdirSync(inbox);
    fs.writeFileSync(path.join(inbox, 'already.csv'), 'x');
    engine.timer = setInterval(() => {}, 1e6);
    const f = engine.save({ name: 'Watch', trigger: { type: 'watch', folder: inbox, pattern: '*.csv', every: 1 }, steps: [{ id: 'folder', type: 'folder.make', with: { path: '~/Filed/{{week.label}}' } }, { id: 'mv', type: 'file.save', with: { files: '{{inputs.files}}', to: '{{steps.folder.folder}}', mode: 'move' } }] }).flow;
    await new Promise((r) => setTimeout(r, 1300));
    fs.writeFileSync(path.join(inbox, 'new.csv'), 'a,b\n1,2\n'); fs.writeFileSync(path.join(inbox, 'skip.txt'), 'x');
    const t0 = Date.now(); while (!fs.existsSync(path.join(HOME, 'Filed', dateContext().week.label, 'new.csv')) && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 200));
    assert.ok(fs.existsSync(path.join(HOME, 'Filed', dateContext().week.label, 'new.csv')));
    assert.ok(fs.existsSync(path.join(inbox, 'already.csv')) && fs.existsSync(path.join(inbox, 'skip.txt')));
    engine.setEnabled(f.id, false); clearInterval(engine.timer); engine.timer = null; engine.syncWatchers();
  });

  await check('cancel stops a run', async () => {
    const f = engine.save({ name: 'Slow', steps: [{ id: 'w', type: 'logic.wait', with: { seconds: 30 } }, { id: 'x', type: 'folder.make', with: { path: '~/slow' } }] }).flow;
    const run = engine.start(f.id); await new Promise((r) => setTimeout(r, 200)); engine.cancel(run.id);
    await new Promise((r) => run.once('end', r));
    assert.strictEqual(run.status, 'cancelled'); assert.ok(!fs.existsSync(path.join(HOME, 'slow')));
  });

  await check('test a single step and run up to a step', async () => {
    const r1 = await engine.runAndWait(saved.id, { upTo: 'read', trigger: { kind: 'test' } });
    assert.strictEqual(r1.status, 'done'); assert.strictEqual(r1.steps.find((s) => s.id === 'compare').status, 'skipped');
    const r2 = await engine.runAndWait(saved.id, { only: 'folder', trigger: { kind: 'test' } });
    assert.strictEqual(r2.steps.length, 1); assert.ok(r2.outputs.folder.folder);
  });

  await check('AI builder: a sentence becomes a valid automation', async () => {
    const r = await aiBuild.draft({ description: 'every monday make a week folder', secrets: engine.store.secrets, dir: path.join(ROOT, 'ai') });
    assert.ok(r.problems.ok, JSON.stringify(r.problems)); assert.strictEqual(r.flow.steps[0].id, 'week_folder'); assert.strictEqual(r.flow.trigger.every, 'week');
  });

  await check('report helpers: chart picking, numbers, deltas', () => {
    const s = docs.chartSeries({ columns: ['Ch', 'A', 'A change'], rows: [{ Ch: 'x', A: 1, 'A change': 2 }] });
    assert.deepStrictEqual(s.yCols, ['A']);
    assert.strictEqual(docs.fmtCell(0.125, 'Signups change %'), '12.5%'); assert.strictEqual(docs.fmtCell(1234.5, 'Spend'), '1,234.5');
    assert.strictEqual(docs.deltaTone('+5%', 'down'), 'bad'); assert.strictEqual(docs.deltaTone('−5%', 'down'), 'good'); assert.strictEqual(docs.deltaTone('0.0%'), 'flat');
  });

  await check('Claude/Codex plugin: MCP server lists tools, builds, tests and runs an automation', async () => {
    const crypto = require('crypto'); const { spawn } = require('child_process');
    const { makeHandlers } = require('../src/mcp-handlers');
    const handle = makeHandlers(engine);
    const token = crypto.randomBytes(8).toString('hex');
    const bridge = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)).on('end', async () => { if (req.headers.authorization !== 'Bearer ' + token) { res.writeHead(401); return res.end('{}'); } const m = JSON.parse(b); res.end(JSON.stringify(req.url === '/hello' ? { ok: true } : await handle(m.name, m.args, m.client))); }); });
    await new Promise((r) => bridge.listen(0, '127.0.0.1', r));
    const bf = path.join(ROOT, 'bridge.json'); fs.writeFileSync(bf, JSON.stringify({ port: bridge.address().port, token, pid: process.pid }));
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'cadence-mcp.js')], { env: { ...process.env, CADENCE_BRIDGE: bf } });
    let buf = ''; const waiting = new Map();
    child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } });
    let n = 0; const rpc = (method, params) => new Promise((r) => { const id = ++n; waiting.set(id, r); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
    const tool = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); const t = r.result.content[0].text; if (r.result.isError) throw new Error(t); try { return JSON.parse(t); } catch { return t; } };
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code' } });
    assert.strictEqual(init.result.serverInfo.name, 'cadence'); assert.ok(init.result.instructions.includes('cadence_reference'));
    const list = await rpc('tools/list', {}); assert.ok(list.result.tools.length >= 12);
    assert.ok((await tool('cadence_reference', {})).includes('web.browser'));
    const ctx = await tool('cadence_context', {}); assert.ok(ctx.secrets.includes('REPORT_TOKEN')); assert.ok(!JSON.stringify(ctx).includes('s3cret'));
    const made = await tool('create_automation', { automation: { name: 'From Claude', trigger: { type: 'schedule', every: 'week', days: [5], time: '16:00' }, steps: [{ id: 'get', type: 'web.download', with: { url: base + '/export.csv', headers: [{ key: 'Authorization', value: 'Bearer {{secrets.REPORT_TOKEN}}' }] } }, { id: 'read', type: 'data.read', with: { file: '{{steps.get.file}}' } }, { id: 'oops', type: 'data.transform', with: { table: '{{steps.nothing.table}}' } }] } });
    assert.strictEqual(made.enabled, false); assert.ok(made.problems.some((p) => /no step “nothing”/.test(p.msg)));
    const flow = await tool('get_automation', { id: made.id });
    flow.steps[2].with.table = '{{steps.read.table}}'; flow.steps[2].with.ops = [{ op: 'group', by: ['Channel'] }];
    const upd = await tool('update_automation', { id: made.id, automation: flow }); assert.strictEqual(upd.problems.length, 0);
    const t = await tool('test_step', { id: made.id, step_id: 'read' }); assert.strictEqual(t.status, 'done'); assert.deepStrictEqual(t.step_output.columns, ['Channel', 'Date', 'Signups', 'Spend']);
    const r = await tool('run_automation', { id: made.id }); assert.strictEqual(r.status, 'done'); assert.strictEqual(r.steps[2].status, 'done');
    const on = await tool('set_enabled', { id: made.id, enabled: true }); assert.ok(on.next_run);
    const runs = await tool('list_runs', { id: made.id }); assert.strictEqual(runs.length, 2);
    assert.strictEqual(engine.getRun(r.run_id).trigger.client, 'claude-code');
    child.kill(); bridge.close();
  });

  // ───────── PowerPoint templates
  const pptx = require('../src/core/pptx');
  const tplFile = await require('./fixtures/make-template')(path.join(ROOT, 'template.pptx'));
  const chanTable = { columns: ['Channel', 'Signups', 'Spend', 'Signups change %'], rows: [{ Channel: 'Meta', Signups: 1990, Spend: 6400.5, 'Signups change %': 0.08 }, { Channel: 'Google', Signups: 1200, Spend: 5100, 'Signups change %': -0.09 }, { Channel: 'TikTok', Signups: 455, Spend: 2210, 'Signups change %': 0.51 }] };

  await check('PowerPoint template: read slides, boxes, tables, charts, theme', () => {
    const a = pptx.inspect(tplFile);
    assert.strictEqual(a.slideCount, 4); assert.strictEqual(a.theme.headFont, 'Georgia');
    const s2 = a.slides[1]; const val = s2.shapes.find((x) => x.name === 'KPI value'); const tbl = s2.shapes.find((x) => x.kind === 'table');
    assert.strictEqual(val.text, '4,450'); assert.ok(val.box.x > 0.05 && val.box.x < 0.1);
    assert.deepStrictEqual(tbl.table.header, ['Channel', 'Sign-ups', 'Spend']); assert.ok(tbl.table.totalRow);
    const ch = a.slides[2].shapes.find((x) => x.kind === 'chart'); assert.deepStrictEqual(ch.chart.series, ['This week', 'Last week']); assert.strictEqual(ch.chart.type, 'column');
    assert.deepStrictEqual(a.slides[0].shapes[1].tokens, ['{{lastWeek.start | date:"MMMM D"}}']);
  });

  await check('PowerPoint template: fill keeps formatting; tables, totals, charts, repeats, notes, pictures', async () => {
    const shot = path.join(ROOT, 'shot.png'); fs.writeFileSync(shot, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP8z8DwnwEIGAAZBAP/5yS5xAAAAABJRU5ErkJggg==', 'base64'));
    const a = pptx.inspect(tplFile); const id = (sl, name) => a.slides[sl - 1].shapes.find((x) => x.name === name || x.kind === name).id;
    const { render: R } = require('../src/core/template');
    const scope = { ...dateContext(new Date(2026, 9, 26)), steps: { t: { table: chanTable, total: 3645, pct: 0.091 }, pic: { file: shot } } };
    const out = path.join(ROOT, 'filled.pptx');
    const r = await pptx.fill({ template: tplFile, out, render: (v, extra) => R(v, { ...scope, ...extra }), fills: [
      { slide: 2, shape: { id: id(2, 'KPI value'), name: 'KPI value' }, kind: 'text', value: '{{steps.t.total}}' },
      { slide: 2, shape: { id: id(2, 'KPI delta'), name: 'KPI delta' }, kind: 'replace', find: '6.7%', value: '{{steps.t.pct}}' },
      { slide: 2, shape: { id: id(2, 'table'), name: 'Channel table' }, kind: 'table', table: '{{steps.t.table}}', columns: ['Channel', 'Signups', 'Spend'] },
      { slide: 3, shape: { id: id(3, 'chart'), name: 'Signups chart' }, kind: 'chart', table: '{{steps.t.table}}', x: 'Channel', y: ['Signups', 'Spend'], title: 'Sign-ups and spend' },
    ], repeat: [{ slide: 4, table: '{{steps.t.table}}' }] });
    assert.strictEqual(r.slides, 6); assert.strictEqual(r.counts.chart, 1);
    const b = pptx.inspect(out);
    assert.strictEqual(b.slides[0].shapes[1].text, 'Week of October 19');
    const s2 = b.slides[1];
    assert.strictEqual(s2.shapes.find((x) => x.name === 'KPI value').text, '3,645');
    assert.strictEqual(s2.shapes.find((x) => x.name === 'KPI delta').text, 'Up 9.1% on the prior week');
    const t = s2.shapes.find((x) => x.kind === 'table').table;
    assert.deepStrictEqual(t.cells, [['Channel', 'Sign-ups', 'Spend'], ['Meta', '1,990', '$6,401'], ['Google', '1,200', '$5,100'], ['TikTok', '455', '$2,210'], ['Total', '3,645', '$13,711']]);
    const ch = b.slides[2].shapes.find((x) => x.kind === 'chart').chart;
    assert.deepStrictEqual(ch.series, ['Signups', 'Spend']); assert.deepStrictEqual(ch.categories, ['Meta', 'Google', 'TikTok']); assert.deepStrictEqual(ch.values[1], [6400.5, 5100, 2210]); assert.strictEqual(ch.title, 'Sign-ups and spend');
    assert.deepStrictEqual(b.slides.slice(3).map((s) => s.title), ['Meta', 'Google', 'TikTok']);
    assert.strictEqual(b.slides[4].shapes[1].text, '1,200 sign-ups · −9.0% vs last week');
    assert.strictEqual(b.slides[5].notes, 'Speaker note for TikTok');
    // the run style of the swapped number survives (bold green), and the rest of the sentence keeps its grey
    const { unzipSync, strFromU8 } = require('fflate'); const z = unzipSync(new Uint8Array(fs.readFileSync(out)));
    const x2 = strFromU8(z['ppt/slides/slide2.xml']); assert.ok(/<a:rPr[^>]*b="1"[^>]*>(?:(?!<\/a:r>).)*1A7F37(?:(?!<\/a:r>).)*<a:t>9\.1%<\/a:t>/s.test(x2), 'swapped number lost its formatting');
    // embedded chart workbook updated for "Edit data"
    const ExcelJS = require('exceljs'); const wbPart = Object.keys(z).find((k) => /embeddings\/.*\.xlsx$/.test(k));
    if (wbPart) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(z[wbPart])); assert.strictEqual(wb.worksheets[0].getCell('A4').value, 'TikTok'); }
    // picture swap + empty repeat drops the slide
    const out2 = path.join(ROOT, 'filled2.pptx');
    const tplWithPic = path.join(ROOT, 'pic.pptx');
    { const P = require('pptxgenjs'); const p = new P(); const sl = p.addSlide(); sl.addImage({ path: shot, x: 1, y: 1, w: 4, h: 4, objectName: 'Chart image' }); p.addSlide().addText('{{row.Channel}}', { x: 1, y: 1, w: 4, h: 1 }); await p.writeFile({ fileName: tplWithPic }); }
    const r2 = await pptx.fill({ template: tplWithPic, out: out2, render: (v, e) => R(v, { ...scope, ...e, steps: { ...scope.steps, empty: { table: { columns: ['Channel'], rows: [] } } } }), fills: [{ slide: 1, shape: { name: 'Chart image' }, kind: 'picture', value: '{{steps.pic.file}}' }], repeat: [{ slide: 2, table: '{{steps.empty.table}}' }] });
    assert.strictEqual(r2.slides, 1); assert.strictEqual(r2.counts.picture, 1);
    const pz = unzipSync(new Uint8Array(fs.readFileSync(out2))); assert.ok(Object.keys(pz).some((k) => /media\/cadence1\.png$/.test(k)));
    const pic = pptx.inspect(out2).slides[0].shapes[0]; assert.ok(Math.abs(pic.box.w / pic.box.h - (2 * a.size.ratio) / (a.size.ratio)) < 0.05 || pic.box.w > pic.box.h, 'picture should keep its 2:1 shape');
  });

  await check('PowerPoint template: a deck re-saved by another app (LibreOffice) still fills', async () => {
    const { execFileSync } = require('child_process');
    let soffice = null; try { soffice = execFileSync('which', ['soffice']).toString().trim(); } catch {}
    if (!soffice) { console.log('    (skipped: LibreOffice not installed)'); return; }
    const dir = path.join(ROOT, 'lo'); fs.mkdirSync(dir, { recursive: true });
    execFileSync(soffice, ['--headless', '--convert-to', 'pptx', '--outdir', dir, tplFile], { timeout: 120000, stdio: 'ignore' });
    const re = path.join(dir, 'template.pptx');
    const a = pptx.inspect(re);
    const s2 = a.slides[1]; const val = s2.shapes.find((x) => x.text === '4,450'); const tbl = s2.shapes.find((x) => x.kind === 'table');
    const { render: R } = require('../src/core/template');
    const out = path.join(ROOT, 'lo-filled.pptx');
    await pptx.fill({ template: re, out, render: (v, e) => R(v, { ...dateContext(), steps: { t: { table: chanTable, total: 3645 } }, ...e }), fills: [{ slide: 2, shape: { id: val.id, name: val.name }, kind: 'text', value: '{{steps.t.total}}' }, { slide: 2, shape: { id: tbl.id, name: tbl.name }, kind: 'table', table: '{{steps.t.table}}' }] });
    const b = pptx.inspect(out).slides[1];
    assert.ok(b.shapes.some((x) => x.text === '3,645'));
    assert.strictEqual(b.shapes.find((x) => x.kind === 'table').table.cells[1][0], 'Meta');
  });

  await check('Fill a PowerPoint template step inside a run', async () => {
    const f = engine.save({ name: 'Template run', steps: [
      { id: 'v', type: 'data.set', with: { values: [{ key: 'total', value: '{{ 1234 }}' }] } },
      { id: 'deck', type: 'doc.template', with: { template: tplFile, path: '~/Decks/Update {{today}}.pptx', fills: [{ slide: 2, shape: { name: 'KPI value' }, kind: 'text', value: '{{vars.total}}' }], repeat: [] } },
    ] }).flow;
    const run = await engine.runAndWait(f.id);
    assert.strictEqual(run.status, 'done', run.error);
    assert.strictEqual(pptx.inspect(run.outputs.deck.file).slides[1].shapes.find((x) => x.name === 'KPI value').text, '1,234');
    const bad = engine.save({ name: 'Same file', steps: [{ id: 'deck', type: 'doc.template', with: { template: tplFile, path: tplFile } }] }).flow;
    const r2 = await engine.runAndWait(bad.id); assert.ok(/different file/.test(r2.error));
  });

  await check('Make PowerPoint can borrow a template’s colours and fonts', async () => {
    const f = engine.save({ name: 'Look', steps: [{ id: 's', type: 'doc.slides', with: { path: '~/Decks/look.pptx', lookFrom: tplFile, slides: [{ layout: 'title', title: 'Hi' }, { layout: 'bullets', title: 'B', bullets: 'a\nb' }] } }] }).flow;
    const run = await engine.runAndWait(f.id); assert.strictEqual(run.status, 'done', run.error);
    const { unzipSync, strFromU8 } = require('fflate'); const z = unzipSync(new Uint8Array(fs.readFileSync(run.outputs.s.file)));
    assert.ok(strFromU8(z['ppt/slides/slide1.xml']).includes('Georgia')); assert.ok(strFromU8(z['ppt/slides/slide2.xml']).includes('Verdana'));
  });

  // ───────── apps: drive a real Chromium window over its debugging port, like Cadence does with Lumen
  await check('Use an app: open a Chromium-based app, click, copy cards and a table, screenshot, close it', async () => {
    let chrome = null; try { chrome = require('playwright').chromium.executablePath(); } catch {}
    if (!chrome || !fs.existsSync(chrome)) { console.log('    (skipped: no Chromium here)'); return; }
    const appSite = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><title>Dash</title><body><button id="rp">Last 30 days</button><div id="pop" hidden><button>Last 7 days</button></div>
      <div class="kpis"></div><table id="t"><thead><tr><th>Campaign ↓</th><th>Spend</th><th>CTR</th></tr></thead><tbody></tbody></table>
      <script>const draw=(d)=>{document.querySelector('.kpis').innerHTML='<div class="kpi"><div class="l">Spend</div><div class="v">$'+(d*100).toLocaleString()+'</div><span class="d">▲ 4.1%</span></div><div class="kpi"><div class="l">Conversions</div><div class="v">'+d*3+'</div><span class="d">flat</span></div>';document.querySelector('tbody').innerHTML='<tr><td>Fall promo<span class="tag">meta</span></td><td>$1,234.50</td><td>1.95%</td></tr><tr><td>Brand</td><td>$530</td><td>0.78%</td></tr>';};draw(30);
      document.getElementById('rp').onclick=()=>{document.getElementById('pop').hidden=false};document.querySelector('#pop button').onclick=()=>{document.getElementById('rp').textContent='Last 7 days';document.getElementById('pop').hidden=true;draw(7)};</script></body>`); });
    await new Promise((r) => appSite.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${appSite.address().port}/`;
    process.env.CADENCE_APPS = JSON.stringify([{ name: 'Dash', exec: chrome, args: ['--headless=new', '--no-sandbox', `--user-data-dir=${path.join(ROOT, 'chr')}`, url], kind: 'chromium' }]);
    const apps = require('../src/apps');
    assert.ok(apps.listApps({ fresh: true }).some((a) => a.name === 'Dash'));
    const f = engine.save({ name: 'Dash pull', steps: [{ id: 'dash', type: 'app.use', with: { app: 'Dash', control: 'inside', waitFor: '.kpi', afterwards: 'quit', actions: [
      { do: 'click', target: '#rp' }, { do: 'click', target: 'text=Last 7 days' }, { do: 'waitText', value: '$700' },
      { do: 'extractList', target: '.kpi', fields: 'Metric=.l, Value=.v, Change=.d', name: 'kpis' },
      { do: 'extractTable', target: '#t', name: 'campaigns' },
      { do: 'script', code: 'document.title', name: 'title' },
      { do: 'screenshot', target: '.kpis', saveAs: 'kpis' },
    ] } }, { id: 'k', type: 'data.set', with: { values: [{ key: 'spend', value: '{{steps.dash.values.kpis.Spend}}' }] } }] }).flow;
    const run = await engine.runAndWait(f.id);
    appSite.close();
    assert.strictEqual(run.status, 'done', run.error + JSON.stringify(run.steps[0].log.slice(-5)));
    const o = run.outputs.dash;
    assert.deepStrictEqual(o.tables.kpis.rows, [{ Metric: 'Spend', Value: 700, Change: '▲ 4.1%' }, { Metric: 'Conversions', Value: 21, Change: 'flat' }]);
    assert.deepStrictEqual(o.tables.campaigns.columns, ['Campaign', 'Spend', 'CTR']);
    assert.deepStrictEqual(o.tables.campaigns.rows[0], { Campaign: 'Fall promo meta', Spend: 1234.5, CTR: 0.0195 });
    assert.strictEqual(o.text.title, 'Dash'); assert.strictEqual(run.vars.spend, 700);
    assert.ok(fs.statSync(o.file).size > 500);
    assert.strictEqual((await apps._.pids(apps.findApp('Dash'))).length, 0, 'app should be closed afterwards');
  });

  await check('Use an app: keyboard shortcuts parse for Mac and Windows', () => {
    const { parseCombo } = require('../src/native');
    const c = parseCombo('Cmd+Shift+E'); assert.strictEqual(c.key, 'e'); assert.ok(c.mods.has('cmd') && c.mods.has('shift'));
    assert.strictEqual(parseCombo('enter').key, 'enter');
  });

  engine.shutdown(); server.close();
  console.log(`\n${passed} passed${fails.length ? `, ${fails.length} failed: ${fails.join(', ')}` : ''}`);
  if (process.env.KEEP) console.log('kept', ROOT); else try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
  process.exit(fails.length ? 1 : 0);
})();
