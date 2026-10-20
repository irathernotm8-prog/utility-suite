// Google Analytics 4 — sessions, engaged sessions, key events and revenue by channel and by campaign (Data API v1beta).
// Useful for checking Meta's reported results against your own tracking.
const { gget } = require('../google-auth');
const BASE = 'https://analyticsdata.googleapis.com/v1beta';
const prop = (id) => 'properties/' + String(id || '').trim().replace(/^properties\//, '').replace(/[^0-9]/g, '');
const ymd = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

async function report(cfg, body, fetchImpl) {
  const rows = []; let offset = 0;
  for (let i = 0; i < 50; i++) {
    const r = await gget(`${BASE}/${prop(cfg.propertyId)}:runReport`, cfg.accessToken, fetchImpl, { method: 'POST', body: { ...body, limit: 100000, offset } });
    rows.push(...(r.rows || []));
    offset += (r.rows || []).length;
    if (!r.rowCount || offset >= r.rowCount) break;
  }
  return rows;
}

module.exports = {
  kind: 'ga4', name: 'Google Analytics 4', category: 'analytics', google: true, status: 'ready',
  fields: [{ key: 'propertyId', label: 'GA4 property ID', placeholder: 'Numbers only, from Admin → Property details' }],

  async test(cfg, fetchImpl = fetch) {
    if (!cfg.propertyId) throw new Error('Enter the GA4 property ID.');
    const r = await gget(`${BASE}/${prop(cfg.propertyId)}:runReport`, cfg.accessToken, fetchImpl, { method: 'POST', body: { dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }], metrics: [{ name: 'sessions' }] } });
    return { ok: true, detail: `${prop(cfg.propertyId)} · ${r.rows && r.rows[0] ? r.rows[0].metricValues[0].value : 0} sessions in 7 days` };
  },

  async sync(cfg, { since, until }, fetchImpl = fetch) {
    const dateRanges = [{ startDate: since, endDate: until }];
    const series = [];
    const byChannel = await report(cfg, { dateRanges, dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
      metrics: ['sessions', 'engagedSessions', 'keyEvents', 'totalRevenue'].map((name) => ({ name })) }, fetchImpl);
    const names = ['sessions', 'engaged_sessions', 'key_events', 'revenue'];
    for (const r of byChannel) names.forEach((m, i) => series.push({ metric: m, dim: r.dimensionValues[1].value, date: ymd(r.dimensionValues[0].value), value: +r.metricValues[i].value || 0 }));
    const byCampaign = await report(cfg, { dateRanges, dimensions: [{ name: 'date' }, { name: 'sessionCampaignName' }],
      metrics: ['sessions', 'keyEvents'].map((name) => ({ name })) }, fetchImpl);
    for (const r of byCampaign) {
      const c = r.dimensionValues[1].value; if (!c || c === '(not set)' || c === '(direct)') continue;
      series.push({ metric: 'campaign_sessions', dim: c, date: ymd(r.dimensionValues[0].value), value: +r.metricValues[0].value || 0 });
      series.push({ metric: 'campaign_key_events', dim: c, date: ymd(r.dimensionValues[0].value), value: +r.metricValues[1].value || 0 });
    }
    return { series };
  }
};
