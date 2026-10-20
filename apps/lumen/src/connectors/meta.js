// Meta (Facebook + Instagram) ads — read-only Insights.
// You paste an access token for your own ad account (a System User token from Business Settings is the
// durable choice; a Graph API Explorer token works for a quick try but expires). Nothing leaves this computer
// except calls to graph.facebook.com.
const GRAPH = 'https://graph.facebook.com';

// Which "actions" count as a conversion. Override per connection with the "Result action" field.
const DEFAULT_RESULTS = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'purchase', 'offsite_conversion.fb_pixel_purchase', 'complete_registration', 'offsite_conversion.fb_pixel_complete_registration'];

const actAccount = (id) => 'act_' + String(id || '').trim().replace(/^act_/, '').replace(/[^0-9]/g, '');

function sumActions(list, types) {
  if (!Array.isArray(list)) return 0;
  const want = new Set(types);
  // Meta reports the same lead under several action types; take the largest single match per row
  // instead of summing them, so a lead isn't counted two or three times.
  let best = 0;
  for (const a of list) if (want.has(a.action_type)) best = Math.max(best, +a.value || 0);
  return best;
}

function toRow(r, types) {
  return {
    campaign_id: r.campaign_id, campaign_name: r.campaign_name, date: r.date_start,
    spend: +r.spend || 0, impressions: +r.impressions || 0, clicks: +r.inline_link_clicks || +r.clicks || 0,
    conversions: sumActions(r.actions, types), revenue: sumActions(r.action_values, types)
  };
}

async function get(url, fetchImpl) {
  const res = await fetchImpl(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const e = body.error || {};
    const hint = e.code === 190 ? ' (the token expired or was revoked — paste a new one)' : e.code === 17 || e.code === 4 || e.code === 613 ? ' (rate limited — Lumen will retry on the next sync)' : '';
    throw new Error((e.message || `HTTP ${res.status}`) + hint);
  }
  return body;
}

module.exports = {
  kind: 'meta', name: 'Meta Ads', status: 'ready',
  fields: [
    { key: 'accountId', label: 'Ad account ID', placeholder: '1234567890 (the number after act_)' },
    { key: 'token', label: 'Access token', secret: true, placeholder: 'Needs ads_read' },
    { key: 'resultActions', label: 'Result action types (optional)', placeholder: 'lead, purchase — blank uses the usual lead/purchase types' },
    { key: 'apiVersion', label: 'API version (optional)', placeholder: 'e.g. v23.0 — blank uses your app default' }
  ],

  async test(cfg, fetchImpl = fetch) {
    if (!cfg.accountId || !cfg.token) throw new Error('Enter the ad account ID and an access token.');
    const v = cfg.apiVersion ? '/' + cfg.apiVersion.replace(/^\/?/, '') : '';
    const u = `${GRAPH}${v}/${actAccount(cfg.accountId)}?fields=name,currency,account_status&access_token=${encodeURIComponent(cfg.token)}`;
    const a = await get(u, fetchImpl);
    return { ok: true, detail: `${a.name} · ${a.currency}`, currency: a.currency };
  },

  async sync(cfg, { since, until }, fetchImpl = fetch) {
    const types = (cfg.resultActions || '').split(',').map((s) => s.trim()).filter(Boolean);
    const use = types.length ? types : DEFAULT_RESULTS;
    const v = cfg.apiVersion ? '/' + cfg.apiVersion.replace(/^\/?/, '') : '';
    const qs = new URLSearchParams({
      level: 'campaign', time_increment: '1', limit: '500', access_token: cfg.token,
      fields: 'campaign_id,campaign_name,spend,impressions,clicks,inline_link_clicks,actions,action_values',
      time_range: JSON.stringify({ since, until })
    });
    let url = `${GRAPH}${v}/${actAccount(cfg.accountId)}/insights?${qs}`;
    const rows = [];
    for (let page = 0; url && page < 200; page++) {
      const body = await get(url, fetchImpl);
      for (const r of body.data || []) rows.push(toRow(r, use));
      url = body.paging && body.paging.next;
    }
    return rows;
  },
  _test: { toRow, sumActions, actAccount }
};
