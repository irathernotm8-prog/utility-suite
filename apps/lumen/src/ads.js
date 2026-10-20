// Meta ad account management: read the campaign tree with results, and make changes through the Marketing API.
// Pure API calls with an injected fetch. The safety rules (approvals, budget cap, audit trail) live in adsmgr.js.
const { API_VERSION, DEFAULT_RESULTS, _test: { sumActions, actAccount, ver } } = require('./connectors/meta');

const base = (cfg) => `https://graph.facebook.com${ver(cfg)}`;
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'PYG', 'ISK', 'UGX']);
const offsetFor = (currency) => (ZERO_DECIMAL.has(String(currency || '').toUpperCase()) ? 1 : 100);
const toMinor = (amount, cur) => Math.round(+amount * offsetFor(cur));
const num = (x) => (x === undefined || x === null || x === '' ? null : +x);
const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]));

async function call(url, opts, f) {
  const res = await f(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const e = body.error || {};
    const hint = e.code === 190 ? ' (token expired or revoked: Sources → Edit and paste a new one)'
      : e.code === 200 || e.code === 10 || e.code === 3 ? ' (the token is missing ads_management, or the system user lacks full control of this ad account)'
      : e.code === 17 || e.code === 4 || e.code === 613 ? ' (Meta is rate limiting requests; wait a minute and retry)' : '';
    const detail = e.error_user_msg ? `${e.error_user_title ? e.error_user_title + ': ' : ''}${e.error_user_msg}` : e.message;
    throw new Error((detail || `HTTP ${res.status}`) + hint);
  }
  return body;
}
async function all(url, f, max = 60) {
  const out = [];
  for (let i = 0; url && i < max; i++) { const b = await call(url, {}, f); out.push(...(b.data || [])); url = b.paging && b.paging.next; }
  return out;
}

const CAMPAIGN_FIELDS = 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time,special_ad_categories';
const ADSET_FIELDS = 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,start_time,end_time,targeting{geo_locations,age_min,age_max,genders}';
const AD_FIELDS = 'id,name,adset_id,campaign_id,status,effective_status,creative{id,name,title,body}';

function metricsOf(r, types) {
  if (!r) return { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
  return { spend: +r.spend || 0, impressions: +r.impressions || 0, clicks: +r.inline_link_clicks || +r.clicks || 0, conversions: sumActions(r.actions, types) };
}

// Campaigns, ad sets and ads with their results for the window. Budgets are returned in the account currency (not minor units).
async function fetchTree(cfg, range, f) {
  const acct = actAccount(cfg.accountId), B = base(cfg), tok = encodeURIComponent(cfg.token);
  const types = (cfg.resultActions || '').split(',').map((x) => x.trim()).filter(Boolean); const use = types.length ? types : DEFAULT_RESULTS;
  const info = await call(`${B}/${acct}?fields=name,currency,account_status,timezone_name&access_token=${tok}`, {}, f);
  const off = offsetFor(info.currency);
  const eff = encodeURIComponent(JSON.stringify(['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'PENDING_REVIEW', 'DISAPPROVED']));
  const edge = (name, fields) => `${B}/${acct}/${name}?fields=${encodeURIComponent(fields)}&limit=200&effective_status=${eff}&access_token=${tok}`;
  const ins = (level, idf) => `${B}/${acct}/insights?level=${level}&fields=${idf},spend,impressions,clicks,inline_link_clicks,actions&time_range=${encodeURIComponent(JSON.stringify(range))}&limit=500&access_token=${tok}`;
  const [camps, sets, ads, ic, is, ia] = await Promise.all([all(edge('campaigns', CAMPAIGN_FIELDS), f), all(edge('adsets', ADSET_FIELDS), f), all(edge('ads', AD_FIELDS), f),
    all(ins('campaign', 'campaign_id'), f), all(ins('adset', 'adset_id'), f), all(ins('ad', 'ad_id'), f)]);
  const byId = (rows, k) => new Map(rows.map((r) => [r[k], r]));
  const mc = byId(ic, 'campaign_id'), ms = byId(is, 'adset_id'), ma = byId(ia, 'ad_id');
  const money = (x) => (num(x) === null ? null : num(x) / off);
  const common = (kind, r, m) => ({ id: r.id, kind, name: r.name, status: r.status, effective: r.effective_status, dailyBudget: money(r.daily_budget), lifetimeBudget: money(r.lifetime_budget), metrics: metricsOf(m, use) });
  return {
    account: { id: acct, name: info.name, currency: info.currency, timezone: info.timezone_name }, range, fetchedAt: new Date().toISOString(),
    campaigns: camps.map((r) => ({ ...common('campaign', r, mc.get(r.id)), objective: r.objective, startTime: r.start_time, endTime: r.stop_time, special: r.special_ad_categories || [] })),
    adsets: sets.map((r) => ({ ...common('adset', r, ms.get(r.id)), campaignId: r.campaign_id, optimization: r.optimization_goal, startTime: r.start_time, endTime: r.end_time && r.end_time !== '0' ? r.end_time : null, targeting: r.targeting })),
    ads: ads.map((r) => ({ ...common('ad', r, ma.get(r.id)), adsetId: r.adset_id, campaignId: r.campaign_id, headline: r.creative && r.creative.title, text: r.creative && r.creative.body }))
  };
}

// patch: { status, name, dailyBudget, endTime } with budgets in the account currency. kind: 'campaign' | 'adset' | 'ad'.
async function update(cfg, id, kind, patch, currency, f) {
  const body = { access_token: cfg.token };
  if (patch.status) body.status = patch.status;
  if (patch.name) body.name = patch.name;
  if ('dailyBudget' in patch) body.daily_budget = toMinor(patch.dailyBudget, currency);
  if ('endTime' in patch) { if (kind === 'campaign') body.stop_time = patch.endTime; else if (kind === 'adset') body.end_time = patch.endTime || 0; }
  if (Object.keys(body).length === 1) throw new Error('Nothing to change.');
  const r = await call(`${base(cfg)}/${encodeURIComponent(id)}`, { method: 'POST', body: form(body) }, f);
  if (r.success === false) throw new Error('Meta did not apply the change.');
  const n = await call(`${base(cfg)}/${encodeURIComponent(id)}?${form({ fields: 'name,status,effective_status,daily_budget,end_time,stop_time', access_token: cfg.token })}`, {}, f);
  const off = offsetFor(currency);
  return { id, name: n.name, status: n.status, effective: n.effective_status, dailyBudget: num(n.daily_budget) === null ? null : num(n.daily_budget) / off, endTime: n.end_time && n.end_time !== '0' ? n.end_time : n.stop_time || null };
}

// A copy of a campaign (with its ad sets and ads), always created paused.
async function copyCampaign(cfg, id, f) {
  const r = await call(`${base(cfg)}/${encodeURIComponent(id)}/copies`, { method: 'POST', body: form({ deep_copy: true, status_option: 'PAUSED', rename_options: { rename_suffix: ' (copy)' }, access_token: cfg.token }) }, f);
  return { id: r.copied_campaign_id || (r.ad_object_ids && r.ad_object_ids[0] && r.ad_object_ids[0].copied_id) || null };
}

async function geoSearch(cfg, q, f) {
  const r = await call(`${base(cfg)}/search?${form({ type: 'adgeolocation', q, location_types: ['city', 'region', 'zip'], limit: 8, access_token: cfg.token })}`, {}, f);
  return (r.data || []).map((x) => ({ key: x.key, name: x.name, type: x.type, region: x.region, country: x.country_code, label: [x.name, x.type === 'zip' ? x.primary_city : null, x.region, x.country_code].filter(Boolean).join(', ') + ` (${x.type})` }));
}

const OBJECTIVES = {
  OUTCOME_TRAFFIC: { label: 'Traffic (visits to your website)', goal: 'LANDING_PAGE_VIEWS', destination: 'WEBSITE' },
  OUTCOME_LEADS: { label: 'Leads (website, needs a Meta Pixel)', goal: 'OFFSITE_CONVERSIONS', destination: 'WEBSITE', needsPixel: true },
  OUTCOME_AWARENESS: { label: 'Awareness (reach as many people as possible)', goal: 'REACH' }
};
const CTAS = ['LEARN_MORE', 'SIGN_UP', 'GET_QUOTE', 'CONTACT_US', 'APPLY_NOW', 'CALL_NOW', 'BOOK_TRAVEL', 'SHOP_NOW', 'NO_BUTTON'];
const SPECIAL = ['NONE', 'HOUSING', 'CREDIT', 'EMPLOYMENT', 'ISSUES_ELECTIONS_POLITICS'];

function targetingFor(a, special) {
  const geo = {};
  if (a.countries && a.countries.length) geo.countries = a.countries;
  if (a.cities && a.cities.length) geo.cities = a.cities.map((c) => ({ key: c.key, radius: c.radius || 10, distance_unit: 'mile' }));
  if (a.regions && a.regions.length) geo.regions = a.regions.map((r) => ({ key: r.key }));
  if (a.zips && a.zips.length) geo.zips = a.zips.map((z) => ({ key: z.key }));
  if (!Object.keys(geo).length) throw new Error('Pick at least one location.');
  const t = { geo_locations: geo };
  if (special && special !== 'NONE') { t.age_min = 18; t.targeting_automation = { advantage_audience: 0 }; return t; } // special categories can't target by age or gender
  if (a.ageMin) t.age_min = Math.max(18, +a.ageMin); if (a.ageMax) t.age_max = Math.min(65, +a.ageMax);
  if (a.genders && a.genders.length === 1) t.genders = a.genders;
  return t;
}

// Creates a campaign, one ad set and one ad, ALL PAUSED. If a later step fails, what was created is reported on the error (still paused).
async function createCampaign(cfg, spec, currency, f, readMedia) {
  const acct = actAccount(cfg.accountId), B = base(cfg), tok = cfg.token, made = {};
  const obj = OBJECTIVES[spec.objective]; if (!obj) throw new Error('Pick an objective.');
  if (!spec.name || !spec.name.trim()) throw new Error('Give the campaign a name.');
  if (!(+spec.dailyBudget > 0)) throw new Error('Enter a daily budget.');
  if (obj.needsPixel && !spec.pixelId) throw new Error('Lead campaigns optimize on your Meta Pixel. Add the Pixel ID, or choose Traffic.');
  const c = spec.creative || {};
  if (!c.pageId) throw new Error('Enter the Facebook Page ID the ad runs from.');
  if (!c.link && spec.objective !== 'OUTCOME_AWARENESS') throw new Error('Enter the website link for the ad.');
  if (!(c.message || c.headline)) throw new Error('Write the ad text or a headline.');
  const targeting = targetingFor(spec.audience || {}, spec.special);
  try {
    const camp = await call(`${B}/${acct}/campaigns`, { method: 'POST', body: form({ name: spec.name.trim(), objective: spec.objective, status: 'PAUSED', special_ad_categories: spec.special && spec.special !== 'NONE' ? [spec.special] : [], buying_type: 'AUCTION', is_adset_budget_sharing_enabled: false, access_token: tok }) }, f);
    made.campaignId = camp.id;
    const adset = await call(`${B}/${acct}/adsets`, { method: 'POST', body: form({
      name: `${spec.name.trim()} · Ad set`, campaign_id: camp.id, daily_budget: toMinor(spec.dailyBudget, currency), billing_event: 'IMPRESSIONS', optimization_goal: obj.goal, bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting, destination_type: obj.destination, status: 'PAUSED', start_time: spec.startTime, end_time: spec.endTime,
      promoted_object: obj.needsPixel ? { pixel_id: spec.pixelId, custom_event_type: 'LEAD' } : undefined, access_token: tok }) }, f);
    made.adsetId = adset.id;
    let hash;
    if (c.mediaPath) {
      const media = await readMedia(c.mediaPath); const fd = new FormData(); fd.append('access_token', tok); fd.append('filename', new Blob([media.data], { type: media.type }), media.name);
      const up = await call(`${B}/${acct}/adimages`, { method: 'POST', body: fd }, f);
      hash = up.images && Object.values(up.images)[0] && Object.values(up.images)[0].hash;
      if (!hash) throw new Error('Meta did not accept the image.');
    }
    const link = c.link || undefined;
    const link_data = { link: link || `https://www.facebook.com/${c.pageId}`, message: c.message, name: c.headline, description: c.description, ...(hash ? { image_hash: hash } : c.imageUrl ? { picture: c.imageUrl } : {}),
      ...(c.cta && c.cta !== 'NO_BUTTON' ? { call_to_action: { type: c.cta, value: { link: link || `https://www.facebook.com/${c.pageId}` } } } : {}) };
    const cr = await call(`${B}/${acct}/adcreatives`, { method: 'POST', body: form({ name: `${spec.name.trim()} · Creative`, object_story_spec: { page_id: c.pageId, ...(c.instagramUserId ? { instagram_user_id: c.instagramUserId } : {}), link_data }, access_token: tok }) }, f);
    made.creativeId = cr.id;
    const ad = await call(`${B}/${acct}/ads`, { method: 'POST', body: form({ name: `${spec.name.trim()} · Ad`, adset_id: adset.id, creative: { creative_id: cr.id }, status: 'PAUSED', access_token: tok }) }, f);
    made.adId = ad.id;
    return made;
  } catch (e) { e.created = made; throw e; }
}

// ---- Existing ads: read the creative, preview it, and edit it ----
// Meta creatives are immutable: an edit makes a new creative and points the ad at it (the ad goes back into review).
const CREATIVE_FIELDS = 'id,name,title,body,object_story_id,object_story_spec,asset_feed_spec,image_url,thumbnail_url,call_to_action_type';
const PREVIEWS = { facebook: 'DESKTOP_FEED_STANDARD', mobile: 'MOBILE_FEED_STANDARD', instagram: 'INSTAGRAM_STANDARD' };

async function fetchAdCreative(cfg, adId, f) {
  const r = await call(`${base(cfg)}/${encodeURIComponent(adId)}?${form({ fields: `name,status,effective_status,creative{${CREATIVE_FIELDS}}`, access_token: cfg.token })}`, {}, f);
  const cr = r.creative || {}, spec = cr.object_story_spec || {}, ld = spec.link_data;
  let editable = true, reason = '';
  if (cr.asset_feed_spec) { editable = false; reason = 'This ad uses Meta’s flexible/dynamic creative, which can only be edited in Ads Manager.'; }
  else if (cr.object_story_id && !ld) { editable = false; reason = 'This ad promotes an existing post, so its text lives on the post. Edit the post, or use Ads Manager.'; }
  else if (!ld) { editable = false; reason = 'This ad is a video, carousel or other format Lumen can show but not edit yet.'; }
  else if (ld.child_attachments) { editable = false; reason = 'Carousel ads can only be edited in Ads Manager.'; }
  const cta = (ld && ld.call_to_action && ld.call_to_action.type) || cr.call_to_action_type || '';
  return { adId, adName: r.name, creativeId: cr.id, editable, reason, pageId: spec.page_id || '', instagramUserId: spec.instagram_user_id || '',
    message: (ld && ld.message) || cr.body || '', headline: (ld && ld.name) || cr.title || '', description: (ld && ld.description) || '',
    link: (ld && ld.link) || '', cta, imageUrl: cr.image_url || cr.thumbnail_url || '', _spec: spec };
}

// Meta's own rendering of the ad. The body is an iframe tag; we hand back its address to open in a browser.
async function previewLinks(cfg, adId, f) {
  const out = {};
  await Promise.all(Object.entries(PREVIEWS).map(async ([k, fmt]) => {
    try {
      const r = await call(`${base(cfg)}/${encodeURIComponent(adId)}/previews?${form({ ad_format: fmt, access_token: cfg.token })}`, {}, f);
      const m = r.data && r.data[0] && /src="([^"]+)"/.exec(r.data[0].body || '');
      if (m) out[k] = m[1].replace(/&amp;/g, '&');
    } catch (_) { /* some placements are not available for every ad */ }
  }));
  return out;
}

// patch: { message, headline, description, link, cta, mediaPath }. Returns the old and new creative ids.
async function editAdCreative(cfg, adId, patch, f, readMedia) {
  const cur = await fetchAdCreative(cfg, adId, f);
  if (!cur.editable) throw new Error(cur.reason);
  const spec = JSON.parse(JSON.stringify(cur._spec)), ld = spec.link_data, acct = actAccount(cfg.accountId), B = base(cfg), tok = cfg.token;
  if (patch.message !== undefined) ld.message = patch.message;
  if (patch.headline !== undefined) ld.name = patch.headline;
  if (patch.description !== undefined) ld.description = patch.description;
  if (patch.link !== undefined) { ld.link = patch.link; if (ld.call_to_action && ld.call_to_action.value) ld.call_to_action.value.link = patch.link; }
  if (patch.cta !== undefined) {
    if (patch.cta === 'NO_BUTTON') delete ld.call_to_action;
    else ld.call_to_action = { type: patch.cta, value: { ...((ld.call_to_action && ld.call_to_action.value) || {}), link: ld.link } };
  }
  if (patch.mediaPath) {
    const media = await readMedia(patch.mediaPath); const fd = new FormData(); fd.append('access_token', tok); fd.append('filename', new Blob([media.data], { type: media.type }), media.name);
    const up = await call(`${B}/${acct}/adimages`, { method: 'POST', body: fd }, f);
    const hash = up.images && Object.values(up.images)[0] && Object.values(up.images)[0].hash;
    if (!hash) throw new Error('Meta did not accept the image.');
    ld.image_hash = hash; delete ld.picture; delete ld.image_crops;
  }
  const cr = await call(`${B}/${acct}/adcreatives`, { method: 'POST', body: form({ name: `${(cur.adName || 'Ad').slice(0, 80)} · edited ${new Date().toISOString().slice(0, 10)}`, object_story_spec: spec, access_token: tok }) }, f);
  await setAdCreative(cfg, adId, cr.id, f);
  return { oldCreativeId: cur.creativeId, newCreativeId: cr.id };
}
async function setAdCreative(cfg, adId, creativeId, f) {
  const r = await call(`${base(cfg)}/${encodeURIComponent(adId)}`, { method: 'POST', body: form({ creative: { creative_id: creativeId }, access_token: cfg.token }) }, f);
  if (r.success === false) throw new Error('Meta did not apply the change.');
}

// Meta serves ad images from its CDN; the app can't load remote images, so fetch a copy as a data URI (small images only).
async function imageData(url, f) {
  if (!/^https:\/\/[^/]*(fbcdn\.net|facebook\.com|fbsbx\.com)\//.test(url || '')) return '';
  const res = await f(url); if (!res.ok) return '';
  const buf = Buffer.from(await res.arrayBuffer()); if (buf.length > 4e6) return '';
  return `data:${res.headers.get('content-type') || 'image/jpeg'};base64,${buf.toString('base64')}`;
}


module.exports = { fetchAdCreative, previewLinks, editAdCreative, setAdCreative, imageData, fetchTree, update, copyCampaign, geoSearch, createCampaign, targetingFor, toMinor, offsetFor, OBJECTIVES, CTAS, SPECIAL, API_VERSION };
