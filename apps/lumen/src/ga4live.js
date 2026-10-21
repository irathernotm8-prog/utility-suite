// Live GA4 reporting for the Overview: totals with a previous-period comparison, a daily series, and breakdowns by channel
// (with the new-vs-returning split), city, region, source/medium, campaign, landing page, device and key event name.
// Read-only (analytics.readonly).
const { report } = require('./connectors/ga4');
const { prevRange } = require('./insights');

const TOTAL = ['sessions', 'totalUsers', 'newUsers', 'engagedSessions', 'keyEvents', 'totalRevenue', 'screenPageViews', 'averageSessionDuration', 'bounceRate'];
const BASE = ['sessions', 'totalUsers', 'newUsers', 'engagedSessions', 'keyEvents', 'totalRevenue'];
const ymd = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const num = (x) => +x || 0;
const NAMES = { sessions: 'sessions', totalUsers: 'users', newUsers: 'newUsers', engagedSessions: 'engaged', keyEvents: 'keyEvents', totalRevenue: 'revenue', screenPageViews: 'pageviews', averageSessionDuration: 'avgDuration', bounceRate: 'bounceRate' };
const pack = (r, dims, mets) => { const o = {}; dims.forEach((d, i) => { o[d] = r.dimensionValues[i].value; }); mets.forEach((m, i) => { o[NAMES[m] || m] = num(r.metricValues[i].value); }); return o; };

async function fetchGa4(cfg, range, f) {
  const warnings = [], pr = prevRange(range);
  const rng = (r) => [{ startDate: r.since, endDate: r.until }];
  const safe = async (label, p) => { try { return await p; } catch (e) { warnings.push(`${label}: ${e.message}`); return null; } };
  const run = (dims, mets, extra = {}, r = range) => report(cfg, { dateRanges: rng(r), dimensions: dims.map((name) => ({ name })), metrics: mets.map((name) => ({ name })), ...extra }, f);
  const top = (n) => ({ orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: n });
  const table = async (label, dims, mets, extra) => { const rows = await safe(label, run(dims, mets, extra)); return rows ? rows.map((r) => pack(r, dims, mets)) : []; };
  const [cur, prev, daily, chan, split, city, region, medium, camp, pages, device, events, visitors] = await Promise.all([
    safe('Totals', run([], TOTAL)), safe('Previous period', run([], TOTAL, {}, pr)),
    safe('Daily', run(['date'], ['sessions', 'totalUsers', 'newUsers', 'engagedSessions', 'keyEvents', 'totalRevenue'])),
    table('Channels', ['sessionDefaultChannelGroup'], BASE, top(50)),
    safe('New vs returning by channel', run(['sessionDefaultChannelGroup', 'newVsReturning'], ['sessions', 'keyEvents', 'engagedSessions'])),
    table('Cities', ['city', 'region'], BASE, top(250)), table('Regions', ['region', 'country'], BASE, top(100)),
    table('Source / medium', ['sessionSourceMedium'], BASE, top(50)), table('Campaigns', ['sessionCampaignName'], BASE, top(50)),
    table('Landing pages', ['landingPagePlusQueryString'], BASE, top(50)), table('Devices', ['deviceCategory'], BASE, top(10)),
    table('Key events', ['eventName'], ['keyEvents', 'totalRevenue'], { metricFilter: { filter: { fieldName: 'keyEvents', numericFilter: { operation: 'GREATER_THAN', value: { int64Value: '0' } } } }, orderBys: [{ metric: { metricName: 'keyEvents' }, desc: true }], limit: 50 }),
    table('New vs returning', ['newVsReturning'], ['sessions', 'totalUsers', 'engagedSessions', 'keyEvents', 'totalRevenue'])]);
  if (!cur && !daily) throw new Error(warnings[0] || 'Google Analytics returned nothing.');
  const tot = (rows) => (rows && rows[0] ? pack(rows[0], [], TOTAL) : {});
  // fold the new-vs-returning split into each channel
  const by = new Map(chan.map((c) => [c.sessionDefaultChannelGroup, { ...c, name: c.sessionDefaultChannelGroup, newSessions: 0, returningSessions: 0, newKeyEvents: 0, returningKeyEvents: 0, newEngaged: 0 }]));
  for (const r of split || []) {
    const c = by.get(r.dimensionValues[0].value); if (!c) continue; const nv = r.dimensionValues[1].value, ss = num(r.metricValues[0].value), ke = num(r.metricValues[1].value);
    if (nv === 'new') { c.newSessions += ss; c.newKeyEvents += ke; c.newEngaged += num(r.metricValues[2].value); } else if (nv === 'returning') { c.returningSessions += ss; c.returningKeyEvents += ke; }
  }
  return { property: String(cfg.propertyId || ''), range, previous: pr, fetchedAt: new Date().toISOString(), warnings, totals: tot(cur), prevTotals: tot(prev),
    daily: (daily || []).map((r) => ({ date: ymd(r.dimensionValues[0].value), ...pack(r, [], BASE) })).sort((a, b) => a.date.localeCompare(b.date)),
    channels: [...by.values()], cities: city.map((c) => ({ name: c.city, region: c.region, ...c })), regions: region.map((c) => ({ name: c.region, country: c.country, ...c })),
    sources: medium.map((c) => ({ name: c.sessionSourceMedium, ...c })), campaigns: camp.map((c) => ({ name: c.sessionCampaignName, ...c })), pages: pages.map((c) => ({ name: c.landingPagePlusQueryString, ...c })),
    devices: device.map((c) => ({ name: c.deviceCategory, ...c })), keyEventNames: events.map((c) => ({ name: c.eventName, count: c.keyEvents, revenue: c.revenue })), visitors: visitors.map((c) => ({ name: c.newVsReturning, ...c })) };
}
module.exports = { fetchGa4 };
