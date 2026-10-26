// Cadence — demo data for `npm run demo` and screenshots (CADENCE_DEMO=1, ideally with CADENCE_USER_DATA pointing
// at a scratch folder). Never runs in normal use.
'use strict';
const { TEMPLATES } = require('./core/templates');

function seed(engine) {
  if (engine.store.listFlows().length) return;
  const site = process.env.CADENCE_DEMO_SITE || 'https://analytics.example.com';
  const tpl = (id) => { const t = TEMPLATES.find((x) => x.id === id); return { ...JSON.parse(JSON.stringify(t.flow)), color: t.color, icon: t.icon }; };

  const weekly = tpl('weekly-report');
  weekly.name = 'Weekly sign-ups report';
  weekly.description = 'Exports last week’s sign-ups from the analytics site, files it by week and builds the leadership deck.';
  weekly.enabled = true; weekly.color = 'violet'; weekly.icon = 'slides';
  const pull = weekly.steps.find((s) => s.id === 'pull');
  pull.with.url = site + '/login';
  pull.with.profile = 'work';
  pull.with.actions = [
    { do: 'type', target: 'label=Email', value: 'bilal@example.com' },
    { do: 'type', target: 'label=Password', value: '{{secrets.ANALYTICS_PASSWORD}}' },
    { do: 'click', target: 'text=Sign in' },
    { do: 'waitFor', target: 'text=Export CSV' },
    { do: 'select', target: 'label=Date range', value: 'Last week' },
    { do: 'download', target: 'text=Export CSV', saveAs: 'Sign-ups {{lastWeek.start}}' },
  ];
  weekly.steps.find((s) => s.id === 'folder').with.path = (process.env.CADENCE_DEMO_OUT || '~/Documents/Reports') + '/{{week.label}}';
  engine.store.secrets.set('ANALYTICS_PASSWORD', 'demo-password');
  engine.store.saveProfiles([{ id: 'default', name: 'Default' }, { id: 'work', name: 'Work', signedInAt: Date.now() - 3 * 864e5, site }]);
  const w = engine.save(weekly).flow;

  const daily = tpl('daily-download'); daily.name = 'Morning ad spend export'; daily.enabled = true; daily.color = 'sky';
  daily.steps[0].with.url = 'https://ads.example.com/export.csv?date={{yesterday}}';
  const d = engine.save(daily).flow;
  const filer = tpl('file-downloads'); filer.enabled = true; filer.trigger.folder = process.env.CADENCE_DEMO_WATCH || '~/Downloads';
  const fl = engine.save(filer).flow;
  const monthly = tpl('monthly-rollup'); monthly.enabled = true;
  const m = engine.save(monthly).flow;
  const digest = tpl('ai-digest'); digest.enabled = false;
  engine.save(digest);
  if (process.env.CADENCE_DEMO_PPTX) {
    const lumen = tpl('lumen-weekly'); lumen.enabled = true;
    lumen.steps.find((s) => s.id === 'deck').with.template = process.env.CADENCE_DEMO_PPTX;
    lumen.steps.find((s) => s.id === 'folder').with.path = (process.env.CADENCE_DEMO_OUT || '~/Documents/Reports') + '/{{week.label}}';
    engine.save(lumen);
  }
  engine.save({ name: 'Clear out old screenshots', trigger: { type: 'manual' }, enabled: false, steps: [{ id: 'tidy', type: 'file.cleanup', name: 'Screenshots older than 30 days', with: { folder: '~/Desktop', pattern: 'Screenshot*.png, Screen Shot*.png', days: 30 } }] });

  // a believable history
  const now = Date.now(); const H = 3600e3;
  const fake = (flow, ago, status, opts = {}) => {
    const start = now - ago; const steps = flow.steps.map((s, i) => ({ id: s.id, type: s.type, name: s.name || s.type, status: opts.failAt === i ? 'failed' : opts.failAt != null && i > opts.failAt ? 'skipped' : 'done', startedAt: start + i * 1500, endedAt: start + i * 1500 + 1200, log: [], error: opts.failAt === i ? opts.error : null, summary: '' }));
    engine.store.addRun({ id: new Date(start).toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + Math.random().toString(16).slice(2, 8), flowId: flow.id, flowName: flow.name, status, trigger: opts.trigger || { kind: 'schedule' }, error: opts.failAt != null ? `${steps[opts.failAt].name}: ${opts.error}` : null, startedAt: start, endedAt: start + steps.length * 1500, dir: '', steps, outputs: {}, files: opts.files || [] });
  };
  for (let i = 1; i <= 5; i++) fake(d, i * 24 * H - 2 * H, 'done', { files: ['/Users/you/Documents/Daily exports/Export.csv'] });
  fake(d, 6 * 24 * H - 2 * H, 'failed', { failAt: 0, error: 'The site answered 503 Service Unavailable' });
  fake(fl, 5 * H, 'done', { trigger: { kind: 'watch' } });
  fake(fl, 30 * H, 'done', { trigger: { kind: 'watch' } });
  fake(m, 23 * 24 * H, 'done', { files: ['/Users/you/Documents/Roll-ups/September 2026.xlsx', '/Users/you/Documents/Roll-ups/September 2026.pdf'] });
  fake(w, 7 * 24 * H - 16 * H, 'done', { files: ['/Users/you/Documents/Reports/Week of 2026-10-12/Weekly Report 2026-10-05.pptx'] });
  engine.store.flushRuns();
}

module.exports = { seed };
