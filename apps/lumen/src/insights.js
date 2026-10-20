// Deep Meta reporting for the Overview: totals with a previous-period comparison, a daily series, breakdowns
// (age/gender, placement, device, region, hour of day), and per-campaign / per-ad rows. Read-only (ads_read is enough).
const { _net: { call, all, base }, } = require('./ads');
const { DEFAULT_RESULTS, _test: { sumActions, actAccount } } = require('./connectors/meta');

const FIELDS = 'spend,impressions,reach,clicks,inline_link_clicks,inline_post_engagement,actions';
const n = (x) => (+x || 0);
const one = (list, type) => { const a = (list || []).find((x) => x.action_type === type); return a ? n(a.value) : 0; };

// One Insights row -> the plain numbers the screen works from. Rates (CTR, CPC, CPM, cost per result) are derived on the screen.
function norm(r, types) {
  r = r || {};
  return { spend: n(r.spend), impressions: n(r.impressions), reach: n(r.reach), clicks: n(r.clicks), linkClicks: n(r.inline_link_clicks) || one(r.actions, 'link_click'),
    results: sumActions(r.actions, types), landingViews: one(r.actions, 'landing_page_view'), engagement: n(r.inline_post_engagement) || one(r.actions, 'post_engagement'),
    reactions: one(r.actions, 'post_reaction'), comments: one(r.actions, 'comment'), shares: one(r.actions, 'post'), saves: one(r.actions, 'onsite_conversion.post_save'), videoViews: one(r.actions, 'video_view') };
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
  const [cur, prev, daily, age, place, device, region, hour, camps, ads] = await Promise.all([
    safe('Totals', all(url('level=account'), f)), safe('Previous period', all(url('level=account', FIELDS, pr), f)),
    safe('Daily', all(url('time_increment=1'), f)),
    brk('Age and gender', 'age,gender', (r) => ({ age: r.age, gender: r.gender })),
    brk('Placement', 'publisher_platform,platform_position', (r) => `${r.publisher_platform}|${r.platform_position}`),
    brk('Device', 'device_platform', (r) => r.device_platform),
    brk('Region', 'region', (r) => r.region),
    brk('Hour of day', 'hourly_stats_aggregated_by_advertiser_time_zone', (r) => r.hourly_stats_aggregated_by_advertiser_time_zone),
    safe('Campaigns', all(url('level=campaign', 'campaign_id,campaign_name,' + FIELDS), f)),
    safe('Ads', all(url('level=ad', 'ad_id,ad_name,campaign_name,adset_name,' + FIELDS), f))]);
  if (!cur && !daily) throw new Error(warnings[0] || 'Meta returned no insights.');
  return { account: { id: acct, name: info.name, currency: info.currency, timezone: info.timezone_name }, range, previous: pr, fetchedAt: new Date().toISOString(), warnings,
    totals: norm((cur || [])[0], use), prevTotals: norm((prev || [])[0], use),
    daily: (daily || []).map((r) => ({ date: r.date_start, ...norm(r, use) })).sort((a, b) => a.date.localeCompare(b.date)),
    age, placement: place, device, region, hour,
    campaigns: (camps || []).map((r) => ({ id: r.campaign_id, name: r.campaign_name, ...norm(r, use) })),
    ads: (ads || []).map((r) => ({ id: r.ad_id, name: r.ad_name, campaign: r.campaign_name, adset: r.adset_name, ...norm(r, use) })) };
}

module.exports = { fetchInsights, norm, prevRange };
