// Deep Meta reporting for the Overview: totals with a previous-period comparison, a daily series, breakdowns
// (age/gender, placement, device, region, hour of day), and per-campaign / per-ad rows. Read-only (ads_read is enough).
const { _net: { call, all, base }, } = require('./ads');
const { DEFAULT_RESULTS, _test: { sumActions, actAccount } } = require('./connectors/meta');

const FIELDS = 'spend,impressions,reach,clicks,inline_link_clicks,inline_post_engagement,actions';
const RICH = FIELDS + ',cost_per_action_type,action_values,unique_clicks,outbound_clicks,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions';
const RANK = 'ad_id,ad_name,campaign_name,impressions,spend,quality_ranking,engagement_rate_ranking,conversion_rate_ranking';
const n = (x) => (+x || 0);
const vsum = (list) => (list || []).reduce((a, x) => a + n(x.value), 0);
const one = (list, type) => { const a = (list || []).find((x) => x.action_type === type); return a ? n(a.value) : 0; };

// One Insights row -> the plain numbers the screen works from. Rates (CTR, CPC, CPM, cost per result) are derived on the screen.
function norm(r, types) {
  r = r || {};
  return { spend: n(r.spend), impressions: n(r.impressions), reach: n(r.reach), clicks: n(r.clicks), linkClicks: n(r.inline_link_clicks) || one(r.actions, 'link_click'),
    results: sumActions(r.actions, types), landingViews: one(r.actions, 'landing_page_view'), engagement: n(r.inline_post_engagement) || one(r.actions, 'post_engagement'),
    reactions: one(r.actions, 'post_reaction'), comments: one(r.actions, 'comment'), shares: one(r.actions, 'post'), saves: one(r.actions, 'onsite_conversion.post_save'), videoViews: one(r.actions, 'video_view'),
    thruplays: vsum(r.video_thruplay_watched_actions), p25: vsum(r.video_p25_watched_actions), p50: vsum(r.video_p50_watched_actions), p75: vsum(r.video_p75_watched_actions), p95: vsum(r.video_p95_watched_actions),
    outbound: vsum(r.outbound_clicks), uniqueClicks: n(r.unique_clicks) };
}
// Every action type Meta reports for the window, with its count, cost per action and value.
function actionTable(r) {
  if (!r) return [];
  const cost = new Map((r.cost_per_action_type || []).map((x) => [x.action_type, n(x.value)])), val = new Map((r.action_values || []).map((x) => [x.action_type, n(x.value)]));
  return (r.actions || []).map((a) => ({ type: a.action_type, count: n(a.value), cost: cost.has(a.action_type) ? cost.get(a.action_type) : null, value: val.has(a.action_type) ? val.get(a.action_type) : null })).sort((a, b) => b.count - a.count);
}
const shift = (d, k) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
const span = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
const prevRange = (r) => { const k = span(r.since, r.until); return { since: shift(r.since, -k), until: shift(r.since, -1) }; };

async function fetchInsights(cfg, range, f) {
  const acct = actAccount(cfg.accountId), B = base(cfg), tok = encodeURIComponent(cfg.token), warnings = [];
  const types = (cfg.resultActions || '').split(',').map((x) => x.trim()).filter(Boolean); const use = types.length ? types : DEFAULT_RESULTS;
  const url = (extra, fields = FIELDS, r = range) => `${B}/${acct}/insights?fields=${encodeURIComponent(fields)}&time_range=${encodeURIComponent(JSON.stringify(r))}&limit=500&${extra}&access_token=${tok}`;
  const info = await call(`${B}/${acct}?fields=name,currency,timezone_name&access_token=${tok}`, {}, f);
  const pr = prevRange(range);
  const safe = async (label, p) => { try { return await p; } catch (e) { warnings.push(`${label}: ${e.message}`); return null; } };
  const brk = async (label, by, labelOf) => {
    const rows = await safe(label, all(url(`breakdowns=${by}`), f)); if (!rows) return [];
    return rows.map((r) => ({ key: labelOf(r), ...norm(r, use) }));
  };
  const [cur, prev, daily, age, place, device, region, hour, camps, sets, ranks, ads] = await Promise.all([
    safe('Totals', all(url('level=account', RICH), f)), safe('Previous period', all(url('level=account', FIELDS, pr), f)),
    safe('Daily', all(url('time_increment=1'), f)),
    brk('Age and gender', 'age,gender', (r) => ({ age: r.age, gender: r.gender })),
    brk('Placement', 'publisher_platform,platform_position', (r) => `${r.publisher_platform}|${r.platform_position}`),
    brk('Device', 'device_platform', (r) => r.device_platform),
    brk('Region', 'region', (r) => r.region),
    brk('Hour of day', 'hourly_stats_aggregated_by_advertiser_time_zone', (r) => r.hourly_stats_aggregated_by_advertiser_time_zone),
    safe('Campaigns', all(url('level=campaign', 'campaign_id,campaign_name,' + RICH), f)),
    safe('Ad sets', all(url('level=adset', 'adset_id,adset_name,campaign_name,' + FIELDS), f)),
    safe('Quality rankings', all(url('level=ad', RANK), f)),
    safe('Ads', all(url('level=ad', 'ad_id,ad_name,campaign_name,adset_name,' + FIELDS), f))]);
  if (!cur && !daily) throw new Error(warnings[0] || 'Meta returned no insights.');
  return { account: { id: acct, name: info.name, currency: info.currency, timezone: info.timezone_name }, range, previous: pr, fetchedAt: new Date().toISOString(), warnings,
    totals: norm((cur || [])[0], use), prevTotals: norm((prev || [])[0], use),
    daily: (daily || []).map((r) => ({ date: r.date_start, ...norm(r, use) })).sort((a, b) => a.date.localeCompare(b.date)),
    actions: actionTable((cur || [])[0]), adsets: (sets || []).map((r) => ({ id: r.adset_id, name: r.adset_name, campaign: r.campaign_name, ...norm(r, use) })),
    rankings: (ranks || []).filter((r) => r.quality_ranking || r.engagement_rate_ranking || r.conversion_rate_ranking).map((r) => ({ id: r.ad_id, name: r.ad_name, campaign: r.campaign_name, impressions: n(r.impressions), spend: n(r.spend), quality: r.quality_ranking, engagement: r.engagement_rate_ranking, conversion: r.conversion_rate_ranking })),
    age, placement: place, device, region, hour,
    campaigns: (camps || []).map((r) => ({ id: r.campaign_id, name: r.campaign_name, ...norm(r, use) })),
    ads: (ads || []).map((r) => ({ id: r.ad_id, name: r.ad_name, campaign: r.campaign_name, adset: r.adset_name, ...norm(r, use) })) };
}

module.exports = { fetchInsights, norm, prevRange, actionTable };
