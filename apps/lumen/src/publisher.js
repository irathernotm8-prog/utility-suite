// Publishing to a Facebook Page and its linked Instagram professional account through the Graph API.
// Everything takes an injected fetch (and media reader) so it can be tested without touching Meta.
const { API_VERSION } = require('./connectors/meta');
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;
const MIN_LEAD = 11 * 60 * 1000, MAX_LEAD = 29 * 24 * 3600 * 1000; // Meta accepts scheduled Page posts 10 minutes to 30 days ahead

async function call(url, opts, f) {
  const res = await f(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const e = body.error || {};
    const hint = e.code === 190 ? ' (token expired or revoked: Sources → Edit and paste a new one)'
      : e.code === 200 || e.code === 10 ? ' (the token is missing a posting permission, or the system user is not assigned this Page with full control)'
      : e.code === 368 ? ' (Facebook temporarily blocked posting from this account)' : '';
    throw new Error((e.error_user_msg || e.message || `HTTP ${res.status}`) + hint);
  }
  return body;
}
const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
const pid = (s) => String(s || '').trim().replace(/[^0-9]/g, '');

// Resolves the Page's own access token and the Instagram account linked to it.
async function pageContext(cfg, f) {
  if (!cfg.pageId || !cfg.token) throw new Error('Enter the Page ID and a token.');
  const q = new URLSearchParams({ fields: 'name,access_token,instagram_business_account{id,username}', access_token: cfg.token });
  const p = await call(`${GRAPH}/${pid(cfg.pageId)}?${q}`, {}, f);
  return { pageId: pid(cfg.pageId), name: p.name, pageToken: p.access_token || cfg.token, igId: p.instagram_business_account && p.instagram_business_account.id, igUser: p.instagram_business_account && p.instagram_business_account.username };
}

const canNativeSchedule = (iso, now = Date.now()) => { const d = Date.parse(iso) - now; return d >= MIN_LEAD && d <= MAX_LEAD; };
const fbUrl = (id) => `https://www.facebook.com/${id}`;

async function facebookPost(ctx, post, f, deps, scheduleAt) {
  const sched = scheduleAt ? { published: 'false', scheduled_publish_time: Math.floor(Date.parse(scheduleAt) / 1000) } : {};
  const media = post.media_path ? await deps.readMedia(post.media_path) : null;
  let body;
  if (media || post.media_url) {
    const fd = new FormData();
    fd.append('access_token', ctx.pageToken); fd.append('caption', post.body || '');
    if (media) fd.append('source', new Blob([media.data], { type: media.type }), media.name); else fd.append('url', post.media_url);
    for (const [k, v] of Object.entries(sched)) fd.append(k, String(v));
    body = await call(`${GRAPH}/${ctx.pageId}/photos`, { method: 'POST', body: fd }, f);
    return { id: body.post_id || body.id, url: fbUrl(body.post_id || body.id) };
  }
  if (!(post.body || post.link)) throw new Error('A Facebook post needs text, a link or a photo.');
  body = await call(`${GRAPH}/${ctx.pageId}/feed`, { method: 'POST', body: form({ message: post.body, link: post.link, access_token: ctx.pageToken, ...sched }) }, f);
  return { id: body.id, url: fbUrl(body.id) };
}

// Instagram only accepts a public JPEG URL. For a local file we park an unpublished copy on the Page and use the URL Facebook gives it.
async function instagramImageUrl(ctx, post, f, deps) {
  if (post.media_url) return post.media_url;
  if (!post.media_path) throw new Error('Instagram posts need a photo.');
  const media = await deps.readMedia(post.media_path);
  const fd = new FormData(); fd.append('access_token', ctx.pageToken); fd.append('published', 'false');
  fd.append('source', new Blob([media.data], { type: media.type }), media.name);
  const up = await call(`${GRAPH}/${ctx.pageId}/photos`, { method: 'POST', body: fd }, f);
  const info = await call(`${GRAPH}/${up.id}?${form({ fields: 'images', access_token: ctx.pageToken })}`, {}, f);
  const src = info.images && info.images[0] && info.images[0].source;
  if (!src) throw new Error('Facebook did not return a public URL for the photo. Paste a public image URL instead.');
  return src;
}

async function instagramPost(ctx, post, f, deps) {
  if (!ctx.igId) throw new Error('This Page has no Instagram professional account linked (or the token cannot see it).');
  const image = await instagramImageUrl(ctx, post, f, deps);
  const c = await call(`${GRAPH}/${ctx.igId}/media`, { method: 'POST', body: form({ image_url: image, caption: post.body, access_token: ctx.pageToken }) }, f);
  for (let i = 0; i < 12; i++) {
    const s = await call(`${GRAPH}/${c.id}?${form({ fields: 'status_code', access_token: ctx.pageToken })}`, {}, f);
    if (s.status_code === 'FINISHED' || s.status_code === undefined) break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error('Instagram could not process the image. It must be a JPEG that meets Instagram’s size and ratio rules.');
    await deps.sleep(i < 3 ? 1500 : 5000);
  }
  const m = await call(`${GRAPH}/${ctx.igId}/media_publish`, { method: 'POST', body: form({ creation_id: c.id, access_token: ctx.pageToken }) }, f);
  let url; try { url = (await call(`${GRAPH}/${m.id}?${form({ fields: 'permalink', access_token: ctx.pageToken })}`, {}, f)).permalink; } catch (_) {}
  return { id: m.id, url };
}

const defaults = (d = {}) => ({ readMedia: d.readMedia || (async () => { throw new Error('No media reader'); }), sleep: d.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))), now: d.now || Date.now() });

// Posts to the requested platforms right now. Each platform succeeds or fails on its own.
async function publishNow(post, cfg, platforms, f, d) {
  const deps = defaults(d), res = {}; let ctx;
  try { ctx = await pageContext(cfg, f); } catch (e) { for (const p of platforms) res[p] = { status: 'failed', error: e.message }; return res; }
  for (const p of platforms) {
    try { const r = p === 'facebook' ? await facebookPost(ctx, post, f, deps) : await instagramPost(ctx, post, f, deps); res[p] = { status: 'published', ...r, at: new Date().toISOString() }; }
    catch (e) { res[p] = { status: 'failed', error: e.message }; }
  }
  return res;
}

// Hands a Facebook post to Meta to publish at the chosen time, so it goes out even if Lumen is closed.
async function scheduleFacebook(post, cfg, f, d) {
  const deps = defaults(d);
  if (!canNativeSchedule(post.scheduled_at, deps.now)) throw new Error('Meta only schedules Page posts between 10 minutes and 30 days ahead.');
  const ctx = await pageContext(cfg, f);
  const r = await facebookPost(ctx, post, f, deps, post.scheduled_at);
  return { status: 'scheduled', native: true, ...r, due: post.scheduled_at };
}

async function cancelFacebook(id, cfg, f) {
  const ctx = await pageContext(cfg, f);
  await call(`${GRAPH}/${id}?${form({ access_token: ctx.pageToken })}`, { method: 'DELETE' }, f);
}

// After the due time: did Meta actually publish it? (Returns 'published' | 'pending' | 'unknown'.)
async function checkFacebook(id, cfg, f) {
  const ctx = await pageContext(cfg, f);
  try {
    const r = await call(`${GRAPH}/${id}?${form({ fields: 'is_published,permalink_url', access_token: ctx.pageToken })}`, {}, f);
    if (r.is_published === true) return { state: 'published', url: r.permalink_url };
    if (r.is_published === false) return { state: 'pending' };
  } catch (_) {}
  return { state: 'unknown' };
}

module.exports = { pageContext, publishNow, scheduleFacebook, cancelFacebook, checkFacebook, canNativeSchedule, MIN_LEAD, MAX_LEAD };
