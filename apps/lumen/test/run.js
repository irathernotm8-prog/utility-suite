const assert = require('assert');
const { open, store, addDays } = require('../src/db');
const demo = require('../src/connectors/demo');
const meta = require('../src/connectors/meta');
const ai = require('../src/ai');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok -', name); };

(async () => {
  await t('demo generator is deterministic and covers the window', () => {
    const a = demo.generate({ days: 30, end: '2026-10-01' }), b = demo.generate({ days: 30, end: '2026-10-01' });
    assert.deepStrictEqual(a, b); assert.ok(a.length >= 30);
    assert.ok(a.every((r) => r.date >= '2026-09-02' && r.date <= '2026-10-01'));
  });

  await t('upsert is idempotent and summary compares to the previous window', () => {
    const S = store(open(':memory:')); const ws = S.addWorkspace('x'); const cn = S.addConnection(ws, 'demo', 'd', {});
    const rows = demo.generate({ days: 20, end: '2026-10-20' });
    S.upsertFacts(ws, 'demo', cn, rows); S.upsertFacts(ws, 'demo', cn, rows);
    const s = S.summary(ws, '2026-10-11', '2026-10-20');
    assert.strictEqual(s.span, 10); assert.strictEqual(s.series.length, 10);
    assert.ok(s.current.spend > 0 && s.previous.spend > 0);
    const manual = rows.filter((r) => r.date >= '2026-10-11').reduce((a, r) => a + r.spend, 0);
    assert.ok(Math.abs(manual - s.current.spend) < 1e-6);
    assert.strictEqual(S.summary(ws, '2026-01-01', '2026-01-03').series.every((d) => d.spend === 0), true);
  });

  await t('workspaces and secrets-free connection config round-trip; removal cascades', () => {
    const S = store(open(':memory:')); const ws = S.addWorkspace('a'); const cn = S.addConnection(ws, 'meta', 'M', { accountId: '1' });
    S.upsertFacts(ws, 'meta', cn, [{ campaign_id: 'c', date: '2026-10-01', spend: 5 }]);
    S.removeConnection(cn); assert.strictEqual(S.summary(ws, '2026-10-01', '2026-10-01').current.spend, 0);
    S.removeWorkspace(ws); assert.strictEqual(S.workspaces().length, 0);
  });

  await t('meta toRow sums the biggest matching action type, not all of them', () => {
    const { toRow } = meta._test;
    const r = toRow({ campaign_id: '9', campaign_name: 'C', date_start: '2026-10-01', spend: '12.5', impressions: '1000', clicks: '50', inline_link_clicks: '30',
      actions: [{ action_type: 'lead', value: '4' }, { action_type: 'onsite_conversion.lead_grouped', value: '4' }, { action_type: 'link_click', value: '30' }],
      action_values: [] }, ['lead', 'onsite_conversion.lead_grouped']);
    assert.strictEqual(r.conversions, 4); assert.strictEqual(r.spend, 12.5); assert.strictEqual(r.clicks, 30);
  });

  await t('meta sync paginates and surfaces API errors with a hint', async () => {
    const pages = [
      { data: [{ campaign_id: '1', campaign_name: 'A', date_start: '2026-10-01', spend: '1', impressions: '10', clicks: '1' }], paging: { next: 'https://graph.facebook.com/next' } },
      { data: [{ campaign_id: '2', campaign_name: 'B', date_start: '2026-10-01', spend: '2', impressions: '20', clicks: '2' }] }];
    let i = 0; const f = async () => ({ ok: true, status: 200, json: async () => pages[i++] });
    const rows = await meta.sync({ accountId: '123', token: 't' }, { since: '2026-10-01', until: '2026-10-01' }, f);
    assert.strictEqual(rows.length, 2);
    const bad = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'expired', code: 190 } }) });
    await assert.rejects(() => meta.test({ accountId: '1', token: 't' }, bad), /expired|token/i);
  });

  await t('ai.compact trims campaigns and ask calls the API with the key header', async () => {
    const S = store(open(':memory:')); const ws = S.addWorkspace('x'); const cn = S.addConnection(ws, 'demo', 'd', {});
    S.upsertFacts(ws, 'demo', cn, demo.generate({ days: 10, end: '2026-10-10' }));
    const sum = S.summary(ws, '2026-10-01', '2026-10-10');
    assert.ok(ai.compact(sum).totals.spend > 0);
    let seen; const f = async (u, o) => { seen = { u, o }; return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'hi' }] }) }; };
    assert.strictEqual(await ai.ask({ key: 'k', question: 'q', summary: sum, workspace: 'w' }, f), 'hi');
    assert.strictEqual(seen.o.headers['x-api-key'], 'k');
    await assert.rejects(() => ai.ask({ question: 'q', summary: sum }, f), /API key/);
  });

  console.log(`\n${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
