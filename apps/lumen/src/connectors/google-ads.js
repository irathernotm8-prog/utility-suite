// Google Ads — daily campaign performance through the REST API (GAQL). Search, Performance Max and YouTube video campaigns all appear here.
// Needs a developer token (Google Ads → Tools → API Center, on a manager account). Basic access is enough for your own accounts.
const { gget } = require('../google-auth');
const DEFAULT_VERSION = 'v24'; // Google Ads versions sunset roughly yearly; override per connection if this one is retired.
const cid = (s) => String(s || '').replace(/[^0-9]/g, '');
const base = (cfg) => `https://googleads.googleapis.com/${String(cfg.apiVersion || DEFAULT_VERSION).trim().replace(/^\/?/, '')}`;
const headers = (cfg) => ({ 'developer-token': cfg.developerToken, ...(cfg.loginCustomerId ? { 'login-customer-id': cid(cfg.loginCustomerId) } : {}) });

async function query(cfg, gaql, fetchImpl) {
  const out = []; let pageToken;
  for (let i = 0; i < 100; i++) {
    const r = await gget(`${base(cfg)}/customers/${cid(cfg.customerId)}/googleAds:search`, cfg.accessToken, fetchImpl, { method: 'POST', headers: headers(cfg), body: { query: gaql, ...(pageToken ? { pageToken } : {}) } });
    out.push(...(r.results || []));
    pageToken = r.nextPageToken; if (!pageToken) break;
  }
  return out;
}

function toRow(r) {
  const m = r.metrics || {};
  return { campaign_id: r.campaign.id, campaign_name: r.campaign.name, date: r.segments.date,
    spend: (+m.costMicros || 0) / 1e6, impressions: +m.impressions || 0, clicks: +m.clicks || 0, conversions: +m.conversions || 0, revenue: +m.conversionsValue || 0 };
}

module.exports = {
  kind: 'google-ads', name: 'Google Ads', category: 'ads', google: true, status: 'ready',
  fields: [
    { key: 'customerId', label: 'Customer ID', placeholder: '123-456-7890' },
    { key: 'developerToken', label: 'Developer token', secret: true, placeholder: 'From the Google Ads API Center' },
    { key: 'loginCustomerId', label: 'Manager (MCC) ID — only if you sign in through a manager account', placeholder: 'Optional' },
    { key: 'apiVersion', label: 'API version (optional)', placeholder: 'Blank uses ' + DEFAULT_VERSION }
  ],
  async test(cfg, fetchImpl = fetch) {
    if (!cfg.customerId || !cfg.developerToken) throw new Error('Enter the customer ID and developer token.');
    const r = await query(cfg, 'SELECT customer.descriptive_name, customer.currency_code FROM customer LIMIT 1', fetchImpl);
    const c = (r[0] && r[0].customer) || {};
    return { ok: true, detail: `${c.descriptiveName || cid(cfg.customerId)} · ${c.currencyCode || ''}` };
  },
  async sync(cfg, { since, until }, fetchImpl = fetch) {
    const rows = await query(cfg, `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`, fetchImpl);
    return { facts: rows.map(toRow) };
  },
  DEFAULT_VERSION,
  _test: { toRow, cid }
};
