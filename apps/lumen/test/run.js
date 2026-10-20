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

  const j = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

  await t('series store: upsert, zero-filled daily totals, previous window, dimension breakdown, cascade delete', () => {
    const S = store(open(':memory:')); const ws = S.addWorkspace('x'); const cn = S.addConnection(ws, 'ga4', 'g', {});
    const rows = [];
    for (let i = 0; i < 10; i++) { const d = addDays('2026-10-01', i); rows.push({ metric: 'sessions', dim: 'Paid Social', date: d, value: 10 }, { metric: 'sessions', dim: 'Direct', date: d, value: 5 }); }
    S.upsertSeries(ws, 'ga4', cn, rows); S.upsertSeries(ws, 'ga4', cn, rows);
    const r = S.seriesSummary(ws, 'ga4', '2026-10-06', '2026-10-10');
    assert.strictEqual(r.metrics.sessions.total, 75); assert.strictEqual(r.metrics.sessions.previous, 75);
    assert.strictEqual(r.metrics.sessions.daily.length, 5); assert.strictEqual(r.dims.sessions[0].dim, 'Paid Social');
    S.upsertSnapshot(ws, cn, 'k', 'ga4', 'N', { columns: ['a'], rows: [] }); assert.strictEqual(S.snapshots(ws).length, 1);
    S.removeConnection(cn); assert.strictEqual(S.snapshots(ws).length, 0); assert.deepStrictEqual(S.seriesSummary(ws, 'ga4', '2026-10-06', '2026-10-10').metrics, {});
  });

  await t('Overview totals only count ad sources (GA4/YouTube/Salesforce never inflate spend or conversions)', () => {
    const S = store(open(':memory:')); const ws = S.addWorkspace('x');
    S.upsertFacts(ws, 'meta', 'c1', [{ campaign_id: 'a', date: '2026-10-01', spend: 10, conversions: 2 }]);
    S.upsertFacts(ws, 'google-ads', 'c2', [{ campaign_id: 'b', date: '2026-10-01', spend: 5, conversions: 1 }]);
    S.upsertFacts(ws, 'ga4', 'c3', [{ campaign_id: 'z', date: '2026-10-01', spend: 99, conversions: 99 }]);
    const s = S.summary(ws, '2026-10-01', '2026-10-01'); assert.strictEqual(s.current.spend, 15); assert.strictEqual(s.current.conversions, 3);
  });

  await t('meta is pinned to a current API version and still overridable', async () => {
    assert.strictEqual(meta._test.ver({}), '/' + meta.API_VERSION); assert.strictEqual(meta._test.ver({ apiVersion: 'v99.0' }), '/v99.0');
    let url; await meta.test({ accountId: '1', token: 't' }, async (u) => { url = u; return j({ name: 'A', currency: 'USD' }); });
    assert.ok(url.includes('/' + meta.API_VERSION + '/act_1'));
  });

  await t('GA4 maps channel + campaign reports into series and pages by offset', async () => {
    const ga4 = require('../src/connectors/ga4'); let calls = 0;
    const f = async (u, o) => { calls++; const b = JSON.parse(o.body);
      assert.strictEqual(o.headers.authorization, 'Bearer tok'); assert.ok(u.includes('properties/123:runReport'));
      if (b.dimensions[1].name === 'sessionDefaultChannelGroup') return j({ rowCount: 1, rows: [{ dimensionValues: [{ value: '20261001' }, { value: 'Paid Social' }], metricValues: [{ value: '10' }, { value: '8' }, { value: '2' }, { value: '30.5' }] }] });
      return j({ rowCount: 2, rows: [{ dimensionValues: [{ value: '20261001' }, { value: 'Referral Promo' }], metricValues: [{ value: '4' }, { value: '1' }] }, { dimensionValues: [{ value: '20261001' }, { value: '(not set)' }], metricValues: [{ value: '9' }, { value: '0' }] }] }); };
    const out = await ga4.sync({ propertyId: 'properties/123', accessToken: 'tok' }, { since: '2026-10-01', until: '2026-10-01' }, f);
    assert.ok(out.series.find((x) => x.metric === 'key_events' && x.dim === 'Paid Social' && x.value === 2 && x.date === '2026-10-01'));
    assert.ok(out.series.find((x) => x.metric === 'campaign_key_events' && x.dim === 'Referral Promo'));
    assert.ok(!out.series.find((x) => x.dim === '(not set)')); assert.strictEqual(calls, 2);
  });

  await t('Google Ads converts micros, sends developer-token + login-customer-id, and follows page tokens', async () => {
    const ga = require('../src/connectors/google-ads'); const seen = []; let page = 0;
    const f = async (u, o) => { seen.push({ u, h: o.headers }); page++;
      const row = (id) => ({ campaign: { id, name: 'C' + id }, segments: { date: '2026-10-01' }, metrics: { costMicros: '12500000', impressions: '1000', clicks: '40', conversions: 3.5, conversionsValue: 100 } });
      return j(page === 1 ? { results: [row('1')], nextPageToken: 'n' } : { results: [row('2')] }); };
    const out = await ga.sync({ customerId: '123-456-7890', developerToken: 'dev', loginCustomerId: '999-888-7777', accessToken: 'tok' }, { since: '2026-10-01', until: '2026-10-01' }, f);
    assert.strictEqual(out.facts.length, 2); assert.strictEqual(out.facts[0].spend, 12.5); assert.strictEqual(out.facts[0].conversions, 3.5);
    assert.ok(seen[0].u.includes('/customers/1234567890/googleAds:search') && seen[0].u.includes('/' + ga.DEFAULT_VERSION + '/'));
    assert.strictEqual(seen[0].h['developer-token'], 'dev'); assert.strictEqual(seen[0].h['login-customer-id'], '9998887777');
    await assert.rejects(() => ga.test({ customerId: '1', developerToken: 'd', accessToken: 't' }, async () => j({ error: { message: 'Google Ads API has not been used in project 1' } }, false, 403)), /enable this API/);
  });

  await t('YouTube builds daily series and a top-videos table with titles', async () => {
    const yt = require('../src/connectors/youtube');
    const f = async (u) => {
      if (u.includes('dimensions=day')) return j({ columnHeaders: [{ name: 'day' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }, { name: 'subscribersGained' }, { name: 'subscribersLost' }, { name: 'likes' }, { name: 'comments' }, { name: 'shares' }], rows: [['2026-10-01', 100, 250, 3, 1, 9, 2, 1]] });
      if (u.includes('dimensions=video')) return j({ rows: [['vid1', 90, 200, 8]] });
      return j({ items: [{ id: 'vid1', snippet: { title: 'Install day' } }] }); };
    const out = await yt.sync({ accessToken: 't' }, { since: '2026-10-01', until: '2026-10-01' }, f);
    assert.ok(out.series.find((x) => x.metric === 'watch_minutes' && x.value === 250));
    assert.deepStrictEqual(out.snapshots[0].payload.rows[0], ['Install day', 90, 200, 8]);
  });

  await t('Salesforce: client-credentials login, newest API version, tabular and summary reports', async () => {
    const sf = require('../src/connectors/salesforce'); const hits = [];
    const f = async (u, o) => { hits.push(u);
      if (u.endsWith('/services/oauth2/token')) { assert.ok(String(o.body).includes('grant_type=client_credentials')); return j({ access_token: 'sf', instance_url: 'https://acme.my.salesforce.com' }); }
      if (u.endsWith('/services/data/')) return j([{ version: '58.0' }, { version: '66.0' }, { version: '62.0' }]);
      if (u.includes('/00OTAB')) return j({ reportMetadata: { name: 'Leads', detailColumns: ['NAME', 'STATUS'] }, reportExtendedMetadata: { detailColumnInfo: { NAME: { label: 'Name' }, STATUS: { label: 'Status' } } }, factMap: { 'T!T': { rows: [{ dataCells: [{ label: 'Ann' }, { label: 'New' }] }] } } });
      if (u.includes('/00OSUM')) return j({ reportMetadata: { name: 'By source', aggregates: ['RowCount'], groupingsDown: [{ name: 'LEAD_SOURCE' }] }, reportExtendedMetadata: { aggregateColumnInfo: { RowCount: { label: 'Record Count' } }, groupingColumnInfo: { LEAD_SOURCE: { label: 'Lead Source' } } }, groupingsDown: { groupings: [{ key: '0', label: 'Meta' }, { key: '1', label: 'Referral' }] }, factMap: { '0!T': { aggregates: [{ label: '12' }] }, '1!T': { aggregates: [{ label: '5' }] }, 'T!T': { aggregates: [{ label: '17' }] } } });
      return j([{ message: 'The requested resource does not exist' }], false, 404); };
    const out = await sf.sync({ instanceUrl: 'acme.my.salesforce.com/', clientId: 'a', clientSecret: 'b', reportIds: '00OTAB, 00OSUM, 00OBAD' }, {}, f);
    assert.ok(hits.some((u) => u.includes('/services/data/v66.0/analytics/reports/00OTAB')));
    assert.deepStrictEqual(out.snapshots[0].payload.rows, [['Ann', 'New']]);
    assert.deepStrictEqual(out.snapshots[1].payload, { columns: ['Lead Source', 'Record Count'], rows: [['Meta', '12'], ['Referral', '5']], truncated: false, headline: [{ label: 'Record Count', value: '17' }] });
    assert.ok(/00OBAD/.test(out.warning));
  });

  await t('Google sign-in: PKCE URL, loopback callback, refresh token returned; wrong state rejected; access token cached', async () => {
    const ga = require('../src/google-auth'); let tokenCalls = 0;
    const f = async (u, o) => { tokenCalls++; const p = new URLSearchParams(o.body); return p.get('grant_type') === 'authorization_code' ? j({ refresh_token: 'RT', access_token: 'AT', expires_in: 3600, scope: 'x' }) : j({ access_token: 'AT2', expires_in: 3600 }); };
    const r = await ga.signIn({ clientId: 'id', clientSecret: 'sec', fetchImpl: f, openExternal: async (url) => {
      const u = new URL(url); assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256'); assert.strictEqual(u.searchParams.get('access_type'), 'offline');
      assert.ok(u.searchParams.get('scope').includes('analytics.readonly') && u.searchParams.get('scope').includes('yt-analytics.readonly'));
      assert.ok(u.searchParams.get('redirect_uri').startsWith('http://127.0.0.1:'));
      setTimeout(() => fetch(u.searchParams.get('redirect_uri') + '/?code=abc&state=' + u.searchParams.get('state')), 20); } });
    assert.strictEqual(r.refreshToken, 'RT');
    await assert.rejects(ga.signIn({ clientId: 'id', clientSecret: 'sec', fetchImpl: f, openExternal: async (url) => { const u = new URL(url); setTimeout(() => fetch(u.searchParams.get('redirect_uri') + '/?code=abc&state=WRONG'), 20); } }), /state/);
    const a1 = await ga.accessToken({ clientId: 'id', clientSecret: 's', refreshToken: 'RT' }, f), c = tokenCalls, a2 = await ga.accessToken({ clientId: 'id', clientSecret: 's', refreshToken: 'RT' }, f);
    assert.strictEqual(a1, 'AT2'); assert.strictEqual(a2, 'AT2'); assert.strictEqual(tokenCalls, c);
    await assert.rejects(ga.accessToken({}, f), /Sign in to Google/);
  });

  await t('AI via Claude CLI and Codex CLI: prompt on stdin, read-only flags, clear sign-in / install errors', async () => {
    const S = store(open(':memory:')); const ws = S.addWorkspace('x'); const cn = S.addConnection(ws, 'demo', 'd', {});
    S.upsertFacts(ws, 'demo', cn, demo.generate({ days: 5, end: '2026-10-05' })); const summary = S.summary(ws, '2026-10-01', '2026-10-05');
    let seen;
    const claudeRun = async (cmd, args, input) => { seen = { cmd, args, input }; return { code: 0, stdout: ' Spend is up.\n', stderr: '' }; };
    assert.strictEqual(await ai.ask({ provider: 'claude-cli', question: 'why?', summary, workspace: 'W' }, null, { run: claudeRun }), 'Spend is up.');
    assert.strictEqual(seen.cmd, 'claude'); assert.ok(seen.args.includes('-p') && seen.args.join(' ').includes('--disallowedTools Bash,Edit,Write')); assert.ok(seen.input.includes('DATA (JSON)') && seen.input.includes('why?'));
    const codexRun = async (cmd, args, input) => { const out = args[args.indexOf('--output-last-message') + 1]; require('fs').writeFileSync(out, 'Leads are flat.'); assert.ok(args.includes('read-only') && args[args.length - 1] === '-'); return { code: 0, stdout: 'noise', stderr: '' }; };
    assert.strictEqual(await ai.ask({ provider: 'codex-cli', question: 'q', summary, workspace: 'W' }, null, { run: codexRun }), 'Leads are flat.');
    await assert.rejects(ai.ask({ provider: 'claude-cli', question: 'q', summary, workspace: 'W' }, null, { run: async () => ({ code: 1, stdout: '', stderr: 'Please log in' }) }), /isn't signed in/);
    await assert.rejects(ai.ask({ provider: 'codex-cli', question: 'q', summary, workspace: 'W' }, null, { run: async () => ({ code: 127, stdout: '', stderr: 'codex: command not found' }) }), /isn't installed/);
    assert.deepStrictEqual(await ai.detect('claude-cli', { run: async () => ({ code: 0, stdout: '2.1.0\n', stderr: '' }) }), { installed: true, version: '2.1.0' });
    const real = await ai.runCli('cat', [], 'hello via shell'); assert.strictEqual(real.stdout, 'hello via shell');
    const withAnalytics = ai.compact({ ...summary, analytics: { ga4: { totals: { sessions: { now: 1, previous: 2 } } } } }); assert.ok(withAnalytics.analytics.ga4);
  });

  await t('publisher: Facebook text/link post, scheduled post, photo upload, and per-platform failure isolation', async () => {
    const pub = require('../src/publisher'); const calls = [];
    const f = async (u, o = {}) => { calls.push({ u, o });
      if (/\/111\?/.test(u)) return j({ name: 'Lyte Fiber', access_token: 'PT', instagram_business_account: { id: '999', username: 'lytefiber' } });
      if (u.endsWith('/111/feed')) return j({ id: '111_1' });
      if (u.endsWith('/111/photos')) return j({ id: 'ph1', post_id: '111_2' });
      return j({ error: { message: 'nope', code: 100 } }, false, 400); };
    const cfg = { pageId: '111', token: 'T' };
    const r = await pub.publishNow({ body: 'Hello', link: 'https://x.com' }, cfg, ['facebook'], f, {});
    assert.strictEqual(r.facebook.status, 'published'); assert.strictEqual(r.facebook.url, 'https://www.facebook.com/111_1');
    const feed = calls.find((c) => c.u.endsWith('/feed')); assert.ok(String(feed.o.body).includes('message=Hello') && String(feed.o.body).includes('access_token=PT'));
    assert.ok(feed.u.includes('/' + require('../src/connectors/meta').API_VERSION + '/'));
    const at = new Date(Date.now() + 3 * 3600e3).toISOString();
    const sch = await pub.scheduleFacebook({ body: 'Later', scheduled_at: at }, cfg, f, {});
    assert.strictEqual(sch.status, 'scheduled'); assert.ok(String(calls.filter((c) => c.u.endsWith('/feed')).pop().o.body).includes('published=false') && String(calls.filter((c) => c.u.endsWith('/feed')).pop().o.body).includes('scheduled_publish_time='));
    await assert.rejects(pub.scheduleFacebook({ body: 'x', scheduled_at: new Date(Date.now() + 5 * 60e3).toISOString() }, cfg, f, {}), /10 minutes and 30 days/);
    const ph = await pub.publishNow({ body: 'Pic', media_path: '/m/a.jpg' }, cfg, ['facebook'], f, { readMedia: async () => ({ data: Buffer.from('jpg'), type: 'image/jpeg', name: 'a.jpg' }) });
    assert.strictEqual(ph.facebook.url, 'https://www.facebook.com/111_2');
    const bad = await pub.publishNow({ body: 'x' }, cfg, ['facebook', 'instagram'], f, {});
    assert.strictEqual(bad.facebook.status, 'published'); assert.strictEqual(bad.instagram.status, 'failed'); assert.match(bad.instagram.error, /photo/);
  });

  await t('publisher: Instagram container → status poll → publish, via a Facebook-hosted copy of a local photo', async () => {
    const pub = require('../src/publisher'); const order = []; let polls = 0;
    const f = async (u, o = {}) => { order.push(u.replace(/^.*v[\d.]+\//, '').split('?')[0]);
      if (/\/111\?fields=name/.test(u)) return j({ name: 'P', access_token: 'PT', instagram_business_account: { id: '999', username: 'ig' } });
      if (u.endsWith('/111/photos')) return j({ id: 'tmp1' });
      if (/\/tmp1\?/.test(u)) return j({ images: [{ source: 'https://cdn.example/x.jpg' }] });
      if (u.endsWith('/999/media')) { assert.ok(String(o.body).includes('image_url=https%3A%2F%2Fcdn.example%2Fx.jpg')); return j({ id: 'cont1' }); }
      if (/\/cont1\?/.test(u)) return j({ status_code: ++polls < 2 ? 'IN_PROGRESS' : 'FINISHED' });
      if (u.endsWith('/999/media_publish')) return j({ id: 'media1' });
      if (/\/media1\?/.test(u)) return j({ permalink: 'https://www.instagram.com/p/abc/' });
      return j({ error: { message: 'unexpected ' + u } }, false, 400); };
    const r = await pub.publishNow({ body: 'Cap', media_path: '/m/a.jpg' }, { pageId: '111', token: 'T' }, ['instagram'], f, { readMedia: async () => ({ data: Buffer.from('x'), type: 'image/jpeg', name: 'a.jpg' }), sleep: async () => {} });
    assert.deepStrictEqual([r.instagram.status, r.instagram.id, r.instagram.url], ['published', 'media1', 'https://www.instagram.com/p/abc/']); assert.strictEqual(polls, 2);
    const err = await pub.publishNow({ body: 'c', media_url: 'https://x/y.jpg' }, { pageId: '111', token: 'T' }, ['instagram'], async (u) => (/\/111\?/.test(u) ? j({ name: 'P', access_token: 'PT' }) : j({})), {});
    assert.match(err.instagram.error, /no Instagram/);
    const expired = await pub.publishNow({ body: 'c' }, { pageId: '111', token: 'T' }, ['facebook'], async () => j({ error: { message: 'bad', code: 190 } }, false, 401), {});
    assert.match(expired.facebook.error, /Sources → Edit/);
  });

  await t('posts lifecycle: schedule (native + queued), edit lock, unschedule, publish-now, missed, partial, scheduler tick', async () => {
    const { makePosts } = require('../src/posts');
    const S = store(open(':memory:')); const ws = S.addWorkspace('x'); let T = Date.parse('2026-11-01T12:00:00Z'); const log = [];
    const pub = { canNativeSchedule: (iso, n) => { const d = Date.parse(iso) - n; return d >= 11 * 60e3 && d <= 29 * 864e5; },
      scheduleFacebook: async (p) => { log.push('sched'); return { status: 'scheduled', native: true, id: 'fb1', due: p.scheduled_at }; }, cancelFacebook: async (id) => { log.push('cancel:' + id); },
      checkFacebook: async () => ({ state: 'published', url: 'https://fb/1' }),
      publishNow: async (p, c, plats) => { log.push('now:' + plats.join('+')); return Object.fromEntries(plats.map((x) => [x, x === 'instagram' && p.body === 'boom' ? { status: 'failed', error: 'x' } : { status: 'published', id: x + '1' }])); } };
    const P = makePosts({ S, cfgFor: () => ({}), pub, now: () => T });
    const d = P.save(ws, { body: 'Hi', media_path: '/m/a.jpg', platforms: ['facebook', 'instagram'], scheduled_at: new Date(T + 3 * 3600e3).toISOString() });
    assert.strictEqual(d.status, 'draft');
    await assert.rejects(P.save(ws, { id: d.id, platforms: [], body: '' }) && P.schedule(P.save(ws, { id: d.id, body: 'Hi', platforms: [], scheduled_at: d.scheduled_at }).id), /Pick Facebook/);
    P.save(ws, { id: d.id, body: 'Hi', media_path: '/m/a.jpg', platforms: ['facebook', 'instagram'], scheduled_at: d.scheduled_at });
    let s = await P.schedule(d.id); assert.strictEqual(s.status, 'scheduled'); assert.strictEqual(s.results.facebook.native, true); assert.strictEqual(s.results.instagram.status, 'queued');
    assert.throws(() => P.save(ws, { id: d.id, body: 'edit', platforms: ['facebook'] }), /Unschedule/);
    s = await P.unschedule(d.id); assert.strictEqual(s.status, 'draft'); assert.ok(log.includes('cancel:fb1'));
    await P.schedule(d.id); T += 3 * 3600e3 + 10 * 60e3;
    const ch = await P.tick(); assert.strictEqual(ch.length, 1); s = S.post(d.id); assert.strictEqual(s.results.instagram.status, 'published'); assert.strictEqual(s.results.facebook.status, 'published'); assert.strictEqual(s.status, 'published');
    // stale queued post → missed, never posted late
    const m = P.save(ws, { body: 'Old', media_path: '/m/a.jpg', platforms: ['instagram'], scheduled_at: new Date(T + 5 * 60e3).toISOString() }); await P.schedule(m.id); T += 3 * 3600e3;
    log.length = 0; await P.tick(); s = S.post(m.id); assert.strictEqual(s.results.instagram.status, 'missed'); assert.strictEqual(s.status, 'failed'); assert.ok(!log.some((x) => x.startsWith('now')));
    // partial: IG fails after FB succeeds; retrying only re-sends what failed
    const q = P.save(ws, { body: 'boom', media_path: '/m/a.jpg', platforms: ['facebook', 'instagram'] }); s = await P.publishNow(q.id); assert.strictEqual(s.status, 'partial');
    log.length = 0; await P.publishNow(q.id); assert.deepStrictEqual(log, ['now:instagram']);
    await P.remove(q.id); assert.ok(!S.post(q.id));
  });

  await t('AI caption drafts return three options, tolerate chatter, and refuse an empty brief', async () => {
    const ok = async (text) => ({ ok: true, json: async () => ({ content: [{ type: 'text', text }] }) });
    const r = await ai.draft({ key: 'k', brief: 'Referral credit', platforms: ['facebook', 'instagram'], workspace: 'Lyte' }, async () => ok('Sure!\n["A","B","C","D"]'));
    assert.deepStrictEqual(r, ['A', 'B', 'C']);
    assert.deepStrictEqual(await ai.draft({ key: 'k', brief: 'x' }, async () => ok('just one caption')), ['just one caption']);
    await assert.rejects(ai.draft({ key: 'k', brief: ' ' }), /Describe/);
    let sys; await ai.draft({ provider: 'claude-cli', brief: 'b' }, null, { run: async (c, a, input) => { sys = input; return { code: 0, stdout: '["x"]', stderr: '' }; } }); assert.ok(/Never invent prices/.test(sys));
  });

  const adsApi = require('../src/ads');
  const mockMeta = () => {
    const calls = [];
    const f = async (u, o = {}) => {
      const path = u.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+/, '').split('?')[0]; const body = o.body && o.body.get ? Object.fromEntries(o.body.entries()) : o.body && typeof o.body === 'string' ? Object.fromEntries(new URLSearchParams(o.body)) : null;
      calls.push({ path, method: o.method || 'GET', body, u });
      if (path === '/act_1') return j({ name: 'Lyte', currency: 'USD', timezone_name: 'America/Chicago' });
      if (path === '/act_1/campaigns' && !o.method) return j({ data: [{ id: 'c1', name: 'Referral', objective: 'OUTCOME_LEADS', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '5000' }, { id: 'c2', name: 'Old', status: 'PAUSED', effective_status: 'PAUSED', lifetime_budget: '100000' }] });
      if (path === '/act_1/adsets' && !o.method) return j({ data: [{ id: 's1', name: 'Set 1', campaign_id: 'c1', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '2500', end_time: '0', optimization_goal: 'LANDING_PAGE_VIEWS' }] });
      if (path === '/act_1/ads' && !o.method) return j({ data: [{ id: 'a1', name: 'Ad 1', adset_id: 's1', campaign_id: 'c1', status: 'ACTIVE', effective_status: 'ACTIVE', creative: { id: 'k1', title: 'Hi', body: 'Body' } }] });
      if (path === '/act_1/insights') { const lvl = /level=(\w+)/.exec(u)[1]; return j({ data: [lvl === 'campaign' ? { campaign_id: 'c1', spend: '120.5', impressions: '9000', clicks: '300', inline_link_clicks: '200', actions: [{ action_type: 'lead', value: '10' }] } : lvl === 'adset' ? { adset_id: 's1', spend: '60', impressions: '4000', clicks: '100' } : { ad_id: 'a1', spend: '60', impressions: '4000', clicks: '100' }] }); }
      if (/^\/(c|s|a)\d$/.test(path) && o.method === 'POST') return j({ success: true });
      if (/^\/(c|s|a)\d$/.test(path)) return j({ name: 'Referral', status: body && body.status || 'PAUSED', effective_status: 'PAUSED', daily_budget: '7500' });
      if (path === '/c1/copies') return j({ copied_campaign_id: 'c9' });
      if (path === '/search') return j({ data: [{ key: '2420379', name: 'Kingsville', type: 'city', region: 'Texas', country_code: 'US' }] });
      if (path === '/act_1/campaigns') return j({ id: 'nc1' });
      if (path === '/act_1/adsets') return j({ id: 'ns1' });
      if (path === '/act_1/adimages') return j({ images: { 'a.jpg': { hash: 'HASH1' } } });
      if (path === '/act_1/adcreatives') return j({ id: 'nk1' });
      if (path === '/act_1/ads') return j({ id: 'na1' });
      return j({ error: { message: 'unexpected ' + path } }, false, 400);
    };
    return { f, calls };
  };
  const adsCfg = { accountId: '1', token: 'T' };

  await t('ads: tree merges structure with results; budgets come back in dollars; lifetime budgets stay null for daily', async () => {
    const { f } = mockMeta(); const tr = await adsApi.fetchTree(adsCfg, { since: '2026-10-01', until: '2026-10-07' }, f);
    assert.strictEqual(tr.account.currency, 'USD'); const c = tr.campaigns[0];
    assert.deepStrictEqual([c.id, c.dailyBudget, c.metrics.spend, c.metrics.conversions, c.metrics.clicks], ['c1', 50, 120.5, 10, 200]);
    assert.strictEqual(tr.campaigns[1].dailyBudget, null); assert.strictEqual(tr.campaigns[1].lifetimeBudget, 1000);
    assert.strictEqual(tr.adsets[0].dailyBudget, 25); assert.strictEqual(tr.adsets[0].endTime, null); assert.strictEqual(tr.ads[0].headline, 'Hi');
  });

  await t('ads: update sends minor units, status and names; copy is always paused; zero-decimal currencies; geo search', async () => {
    const m = mockMeta();
    const r = await adsApi.update(adsCfg, 'c1', 'campaign', { dailyBudget: 75, status: 'PAUSED', name: 'New name' }, 'USD', m.f);
    const post = m.calls.find((c) => c.method === 'POST'); assert.strictEqual(post.body.daily_budget, '7500'); assert.strictEqual(post.body.status, 'PAUSED'); assert.strictEqual(post.body.name, 'New name'); assert.strictEqual(r.dailyBudget, 75);
    assert.strictEqual(adsApi.toMinor(5000, 'JPY'), 5000); assert.strictEqual(adsApi.toMinor(19.99, 'USD'), 1999);
    await adsApi.update(adsCfg, 's1', 'adset', { endTime: null }, 'USD', m.f); assert.strictEqual(m.calls.filter((c) => c.method === 'POST').pop().body.end_time, '0');
    await assert.rejects(adsApi.update(adsCfg, 'c1', 'campaign', {}, 'USD', m.f), /Nothing to change/);
    const cp = await adsApi.copyCampaign(adsCfg, 'c1', m.f); assert.strictEqual(cp.id, 'c9'); assert.strictEqual(m.calls.find((c) => c.path === '/c1/copies').body.status_option, 'PAUSED');
    assert.strictEqual((await adsApi.geoSearch(adsCfg, 'Kingsville', m.f))[0].key, '2420379');
    await assert.rejects(adsApi.update(adsCfg, 'c1', 'campaign', { status: 'PAUSED' }, 'USD', async () => j({ error: { message: 'perm', code: 200 } }, false, 403)), /ads_management/);
  });

  const campSpec = (o = {}) => ({ name: 'Kingsville Referral', objective: 'OUTCOME_TRAFFIC', dailyBudget: 20, special: 'NONE', audience: { cities: [{ key: '2420379', radius: 10 }], ageMin: 21, ageMax: 60 },
    creative: { pageId: '111', message: 'Hello', headline: 'Fiber', link: 'https://lytefiber.com', cta: 'LEARN_MORE', mediaPath: '/m/a.jpg' }, ...o });
  const rm = async () => ({ data: Buffer.from('x'), type: 'image/jpeg', name: 'a.jpg' });

  await t('ads: campaign builder creates campaign + ad set + creative + ad, all PAUSED, with correct payloads', async () => {
    const m = mockMeta(); const made = await adsApi.createCampaign(adsCfg, campSpec(), 'USD', m.f, rm);
    assert.deepStrictEqual(made, { campaignId: 'nc1', adsetId: 'ns1', creativeId: 'nk1', adId: 'na1' });
    const by = (p) => m.calls.find((c) => c.path === p && c.method === 'POST').body;
    assert.strictEqual(by('/act_1/campaigns').status, 'PAUSED'); assert.strictEqual(by('/act_1/campaigns').special_ad_categories, '[]'); assert.strictEqual(by('/act_1/campaigns').is_adset_budget_sharing_enabled, 'false');
    const as = by('/act_1/adsets'); assert.strictEqual(as.status, 'PAUSED'); assert.strictEqual(as.daily_budget, '2000'); assert.strictEqual(as.optimization_goal, 'LANDING_PAGE_VIEWS');
    const tg = JSON.parse(as.targeting); assert.deepStrictEqual(tg.geo_locations.cities, [{ key: '2420379', radius: 10, distance_unit: 'mile' }]); assert.strictEqual(tg.age_min, 21);
    const sp = JSON.parse(by('/act_1/adcreatives').object_story_spec); assert.strictEqual(sp.page_id, '111'); assert.strictEqual(sp.link_data.image_hash, 'HASH1'); assert.strictEqual(sp.link_data.call_to_action.type, 'LEARN_MORE');
    assert.strictEqual(by('/act_1/ads').status, 'PAUSED'); assert.strictEqual(JSON.parse(by('/act_1/ads').creative).creative_id, 'nk1');
  });

  await t('ads: builder validates before touching Meta, and reports what exists if a later step fails', async () => {
    const m = mockMeta();
    await assert.rejects(adsApi.createCampaign(adsCfg, campSpec({ objective: 'OUTCOME_LEADS' }), 'USD', m.f, rm), /Pixel/);
    await assert.rejects(adsApi.createCampaign(adsCfg, campSpec({ audience: {} }), 'USD', m.f, rm), /location/);
    await assert.rejects(adsApi.createCampaign(adsCfg, campSpec({ dailyBudget: 0 }), 'USD', m.f, rm), /daily budget/);
    assert.strictEqual(m.calls.length, 0);
    const failing = async (u, o = {}) => (u.includes('/adcreatives') ? j({ error: { message: 'Bad image', code: 100 } }, false, 400) : m.f(u, o));
    try { await adsApi.createCampaign(adsCfg, campSpec(), 'USD', failing, rm); assert.fail('should throw'); } catch (e) { assert.match(e.message, /Bad image/); assert.deepStrictEqual(e.created, { campaignId: 'nc1', adsetId: 'ns1' }); }
    const hp = adsApi.targetingFor({ countries: ['US'], ageMin: 25, genders: [1] }, 'HOUSING'); assert.strictEqual(hp.age_min, 18); assert.strictEqual(hp.genders, undefined); assert.strictEqual(hp.targeting_automation.advantage_audience, 0);
  });

  await t('ads manager: activation needs confirmation, budget cap, audit trail and undo', async () => {
    const { makeAds } = require('../src/adsmgr'); const S = store(open(':memory:')); const ws = S.addWorkspace('x'); const m = mockMeta(); let T = Date.parse('2026-10-20T12:00:00Z');
    const api = { fetchTree: (c, r) => adsApi.fetchTree(c, r, m.f), update: (c, id, k, p, cur) => adsApi.update(c, id, k, p, cur, m.f), copyCampaign: (c, id) => adsApi.copyCampaign(c, id, m.f), geoSearch: (c, q) => adsApi.geoSearch(c, q, m.f), createCampaign: (c, s, cur, r) => adsApi.createCampaign(c, s, cur, m.f, r) };
    const A = makeAds({ S, cfgFor: () => adsCfg, api, readMedia: rm, getCap: () => 100, now: () => T });
    await assert.rejects(A.change(ws, 'c1', { status: 'PAUSED' }), /Refresh/);
    await A.tree(ws, { since: '2026-10-01', until: '2026-10-07' });
    await assert.rejects(A.change(ws, 'c2', { status: 'ACTIVE' }), /confirmation/);
    await assert.rejects(A.change(ws, 'c1', { dailyBudget: 150 }), /limit of 100/);
    await assert.rejects(A.change(ws, 'c2', { dailyBudget: 10 }), /no daily budget/);
    await assert.rejects(A.change(ws, 'c1', { name: '  ' }), /name/);
    const r = await A.change(ws, 'c1', { dailyBudget: 75, status: 'PAUSED' }); assert.strictEqual(r.dailyBudget, 75);
    const log = A.audit(ws); assert.strictEqual(log[0].action, 'update'); assert.deepStrictEqual(log[0].before, { dailyBudget: 50, status: 'ACTIVE' }); assert.deepStrictEqual(log[0].after, { dailyBudget: 75, status: 'PAUSED' });
    await assert.rejects(A.revert(ws, log[0].id), /confirmation/);
    await A.revert(ws, log[0].id, { confirmedActivate: true }); assert.strictEqual(S.auditEntry(log[0].id).reverted, true);
    assert.strictEqual(A.audit(ws)[0].action, 'revert'); await assert.rejects(A.revert(ws, log[0].id, { confirmedActivate: true }), /already/);
    await assert.rejects(A.create(ws, campSpec({ dailyBudget: 500 })), /limit of 100/);
    const made = await A.create(ws, campSpec({ dailyBudget: 30 })); assert.strictEqual(made.campaignId, 'nc1'); assert.strictEqual(A.audit(ws)[0].action, 'create');
    await A.tree(ws, { since: '2026-10-01', until: '2026-10-07' }, true); const cp = await A.copy(ws, 'c1'); assert.strictEqual(cp.id, 'c9');
    await A.tree(ws, { since: '2026-10-01', until: '2026-10-07' }, true); await assert.rejects(A.copy(ws, 's1'), /Only campaigns/);
  });

  await t('ads: read, preview and edit an existing ad creative; edit is undoable', async () => {
    const { makeAds } = require('../src/adsmgr'); const S = store(open(':memory:')); const ws = S.addWorkspace('x'); const calls = []; let cur = 'cr1';
    const spec = { page_id: 'P1', link_data: { link: 'https://a.com', message: 'Old text', name: 'Old head', image_hash: 'H1', call_to_action: { type: 'LEARN_MORE', value: { link: 'https://a.com' } } } };
    const f = async (url, o = {}) => { const u = String(url), body = o.body && o.body.get ? Object.fromEntries(o.body) : {}; calls.push({ u, body });
      const ok = (j) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => Buffer.from('img') });
      if (/\/previews/.test(u)) return ok({ data: [{ body: '<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=1&amp;t=2"></iframe>' }] });
      if (/adcreatives/.test(u)) return ok({ id: 'cr2' });
      if (/\/ad1$/.test(u) && o.method === 'POST') { cur = JSON.parse(body.creative).creative_id; return ok({ success: true }); }
      if (/\/ad2\?/.test(u)) return ok({ name: 'Boost', creative: { id: 'x', object_story_id: '1_2' } });
      if (/\/ad1\?/.test(u)) return ok({ name: 'Ad one', creative: { id: cur, object_story_spec: spec, image_url: 'https://scontent.fbcdn.net/a.jpg' } });
      return ok({}); };
    const tree = { account: { id: 'act_1', currency: 'USD' }, campaigns: [], adsets: [], ads: [{ id: 'ad1', kind: 'ad', name: 'Ad one', status: 'ACTIVE', effective: 'ACTIVE' }, { id: 'ad2', kind: 'ad', name: 'Boost', status: 'PAUSED', effective: 'PAUSED' }] };
    const api = { fetchTree: async () => tree, fetchAdCreative: (c, id) => adsApi.fetchAdCreative(c, id, f), previewLinks: (c, id) => adsApi.previewLinks(c, id, f), editAdCreative: (c, id, p, rm) => adsApi.editAdCreative(c, id, p, f, rm), setAdCreative: (c, id, cid) => adsApi.setAdCreative(c, id, cid, f), imageData: (u) => adsApi.imageData(u, f) };
    const A = makeAds({ S, cfgFor: () => adsCfg, api, readMedia: rm, getCap: () => 100 }); await A.tree(ws, { since: 'a', until: 'b' });
    const c = await A.creative(ws, 'ad1'); assert.strictEqual(c.message, 'Old text'); assert.strictEqual(c.cta, 'LEARN_MORE'); assert.strictEqual(c.editable, true); assert.ok(c.image.startsWith('data:image/jpeg;base64,'));
    const pv = await A.preview(ws, 'ad1'); assert.strictEqual(pv.facebook, 'https://www.facebook.com/ads/api/preview_iframe.php?d=1&t=2');
    assert.strictEqual((await A.creative(ws, 'ad2')).editable, false);
    await assert.rejects(A.editCreative(ws, 'ad2', { message: 'x' }), /promotes an existing post/);
    await assert.rejects(A.editCreative(ws, 'ad1', { message: 'New' }), /live/);
    await assert.rejects(A.editCreative(ws, 'ad1', { link: 'nope' }, { confirmedLive: true }), /full web address/);
    const r = await A.editCreative(ws, 'ad1', { message: 'New text', cta: 'SIGN_UP', headline: 'New head' }, { confirmedLive: true });
    assert.deepStrictEqual([r.oldCreativeId, r.newCreativeId, cur], ['cr1', 'cr2', 'cr2']);
    const made = JSON.parse(calls.find((x) => /adcreatives/.test(x.u)).body.object_story_spec).link_data; assert.deepStrictEqual([made.message, made.name, made.image_hash, made.call_to_action.type, made.call_to_action.value.link], ['New text', 'New head', 'H1', 'SIGN_UP', 'https://a.com']);
    const log = A.audit(ws)[0]; assert.strictEqual(log.action, 'creative'); assert.strictEqual(log.before.message, 'Old text'); assert.strictEqual(log.after.creativeId, 'cr2');
    await assert.rejects(A.revert(ws, log.id), /live/); await A.revert(ws, log.id, { confirmedLive: true }); assert.strictEqual(cur, 'cr1'); assert.strictEqual(S.auditEntry(log.id).reverted, true);
  });

  await t('AI campaign draft: parses, clamps to the budget ceiling, drops unknown values', async () => {
    const reply = '{"name":"Kingsville Referral","objective":"OUTCOME_WEIRD","dailyBudget":9999,"locations":["Kingsville, TX"],"radiusMiles":12,"ageMin":15,"ageMax":70,"headline":"' + 'x'.repeat(60) + '","message":"Hi","description":"d","cta":"BOGUS","special":"NONE","notes":"n"}';
    const r = await ai.campaignDraft({ key: 'k', brief: 'Referral promo in Kingsville', cap: 100, ctas: ['LEARN_MORE', 'SIGN_UP'] }, async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'Here you go: ' + reply }] }) }));
    assert.deepStrictEqual([r.objective, r.dailyBudget, r.ageMin, r.ageMax, r.headline.length, r.cta, r.radiusMiles], ['OUTCOME_TRAFFIC', 100, 18, 65, 40, 'LEARN_MORE', 12]);
    await assert.rejects(ai.campaignDraft({ key: 'k', brief: 'x' }, async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'no json' }] }) })), /usable draft/);
    await assert.rejects(ai.campaignDraft({ key: 'k', brief: '' }), /Describe/);
  });

  console.log(`\n${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
