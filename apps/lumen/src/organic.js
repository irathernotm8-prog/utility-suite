// Organic Facebook Page and Instagram numbers: followers and recent posts with engagement. Read-only.
// Needs the posting token to include pages_read_engagement (and instagram_basic for Instagram).
const { API_VERSION } = require('./connectors/meta');
const { pageContext } = require('./publisher');
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;
const n = (x) => +x || 0;

async function get(path, params, f) {
  const res = await f(`${GRAPH}/${path}?${new URLSearchParams(params)}`); const b = await res.json().catch(() => ({}));
  if (!res.ok || b.error) throw new Error((b.error && b.error.message) || `HTTP ${res.status}`);
  return b;
}

async function fetchOrganic(cfg, f, imageData) {
  const ctx = await pageContext(cfg, f), tok = ctx.pageToken, warnings = [];
  const safe = async (label, p) => { try { return await p; } catch (e) { warnings.push(`${label}: ${e.message}`); return null; } };
  const [page, posts, ig, igm] = await Promise.all([
    safe('Page', get(ctx.pageId, { fields: 'name,fan_count,followers_count,link', access_token: tok }, f)),
    safe('Page posts', get(`${ctx.pageId}/published_posts`, { fields: 'message,created_time,permalink_url,full_picture,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)', limit: 15, access_token: tok }, f)),
    ctx.igId ? safe('Instagram', get(ctx.igId, { fields: 'username,followers_count,follows_count,media_count', access_token: tok }, f)) : null,
    ctx.igId ? safe('Instagram posts', get(`${ctx.igId}/media`, { fields: 'caption,timestamp,media_type,permalink,like_count,comments_count,thumbnail_url,media_url', limit: 15, access_token: tok }, f)) : null]);
  if (!page && !posts && !ig) throw new Error(warnings[0] || 'Meta returned nothing for this Page.');
  const fb = ((posts && posts.data) || []).map((p) => ({ id: p.id, text: p.message || '', at: p.created_time, url: p.permalink_url, imageUrl: p.full_picture, reactions: n(p.reactions && p.reactions.summary && p.reactions.summary.total_count), comments: n(p.comments && p.comments.summary && p.comments.summary.total_count), shares: n(p.shares && p.shares.count) }));
  const igp = ((igm && igm.data) || []).map((p) => ({ id: p.id, text: p.caption || '', at: p.timestamp, url: p.permalink, type: p.media_type, imageUrl: p.thumbnail_url || p.media_url, likes: n(p.like_count), comments: n(p.comments_count) }));
  if (imageData) await Promise.all([...fb.slice(0, 8), ...igp.slice(0, 8)].map(async (p) => { p.image = await imageData(p.imageUrl).catch(() => ''); }));
  for (const p of [...fb, ...igp]) delete p.imageUrl;
  return { fetchedAt: new Date().toISOString(), warnings,
    page: page ? { name: page.name, fans: n(page.fan_count), followers: n(page.followers_count), url: page.link } : { name: ctx.name },
    instagram: ig ? { username: ig.username, followers: n(ig.followers_count), follows: n(ig.follows_count), media: n(ig.media_count) } : null, posts: fb, igPosts: igp };
}
module.exports = { fetchOrganic };
