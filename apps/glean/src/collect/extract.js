// Glean — turns what a page loads (API JSON, inline JSON, DOM scans, network images) into media items.
// Pure functions, no Electron: test/run.js exercises them directly.
//
// Media item shape:
//   { key, url, kind: 'image'|'video', width, height, thumb, bytes,
//     site, account, postId, postUrl, postIndex, caption, date (ms), source: 'api'|'dom'|'net'|'link' }

const IMG_EXT = /\.(jpe?g|png|gif|webp|avif|heic|heif|bmp|tiff?|jfif)$/i;
const VID_EXT = /\.(mp4|m4v|mov|webm)$/i;
const SOURCE_RANK = { api: 3, link: 2, dom: 1, net: 0 };

function host(u) { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } }

function siteOf(url) {
  const h = host(url);
  if (/(^|\.)instagram\.com$|(^|\.)cdninstagram\.com$/.test(h)) return 'instagram';
  if (/(^|\.)facebook\.com$|(^|\.)fbcdn\.net$|(^|\.)fb\.com$/.test(h)) return 'facebook';
  if (/(^|\.)patreon\.com$|(^|\.)patreonusercontent\.com$/.test(h)) return 'patreon';
  if (/(^|\.)x\.com$|(^|\.)twitter\.com$|(^|\.)twimg\.com$/.test(h)) return 'x';
  if (/(^|\.)pinterest\.[a-z.]+$|(^|\.)pinimg\.com$/.test(h)) return 'pinterest';
  if (/(^|\.)tiktok\.com$/.test(h)) return 'tiktok';
  if (/(^|\.)threads\.(net|com)$/.test(h)) return 'threads';
  return h.replace(/^www\./, '') || 'web';
}
const SITE_NAMES = { instagram: 'Instagram', facebook: 'Facebook', patreon: 'Patreon', x: 'X', pinterest: 'Pinterest', tiktok: 'TikTok', threads: 'Threads' };
const siteName = (s) => SITE_NAMES[s] || s;

// Account a page URL is "about", when the address says so (a profile, creator or page).
const RESERVED = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct', 'home', 'search', 'login', 'settings', 'notifications',
  'messages', 'i', 'watch', 'groups', 'marketplace', 'gaming', 'photo', 'photo.php', 'permalink.php', 'story.php', 'posts', 'c', 'cw', 'checkout', 'join', 'user',
  'profile.php', 'hashtag', 'compose', 'intent', 'share', 'web', 'about', 'privacy', 'terms', 'help', 'legal', 'bookmarks', 'friends', 'saved', 'pin', 'ideas', 'today']);
function accountFromUrl(url) {
  let u; try { u = new URL(url); } catch { return null; }
  const site = siteOf(url);
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (site === 'patreon') {
    if ((parts[0] === 'c' || parts[0] === 'cw') && parts[1]) return parts[1].toLowerCase();
    if (parts[0] && !RESERVED.has(parts[0].toLowerCase())) return parts[0].toLowerCase();
    return null;
  }
  if (site === 'facebook' && parts[0] === 'profile.php') return u.searchParams.get('id') || null;
  if (site === 'instagram' && parts[0] === 'stories' && parts[1]) return parts[1].toLowerCase();
  if (['instagram', 'facebook', 'x', 'pinterest', 'threads', 'tiktok'].includes(site) && parts[0] && !RESERVED.has(parts[0].toLowerCase())) {
    return parts[0].replace(/^@/, '').toLowerCase();
  }
  return null;
}

// Same picture at different sizes shares a file name on the big CDNs; that name is the dedupe key.
function keyOf(url) {
  let u; try { u = new URL(url); } catch { return String(url); }
  const h = u.hostname;
  if (h === 'pbs.twimg.com' && u.pathname.startsWith('/media/')) return 'tw:' + u.pathname.split('/').pop().replace(/\.\w+$/, '');
  if (/pinimg\.com$/.test(h)) return 'pin:' + u.pathname.split('/').pop().replace(/\.\w+$/, '');
  const base = u.pathname.split('/').pop() || '';
  const stem = base.replace(/\.\w{2,5}$/, '');
  if (stem.length >= 12 && /\d/.test(stem)) return stem.toLowerCase();
  return (h + u.pathname).toLowerCase();
}

// Ask the CDN for the original when the address says which size it is.
function upgradeUrl(url) {
  let u; try { u = new URL(url); } catch { return url; }
  if (u.hostname === 'pbs.twimg.com' && u.pathname.startsWith('/media/')) {
    if (!u.searchParams.get('format')) { const m = /\.(\w+)$/.exec(u.pathname); if (m) { u.pathname = u.pathname.replace(/\.\w+$/, ''); u.searchParams.set('format', m[1]); } }
    u.searchParams.set('name', 'orig'); return u.toString();
  }
  if (/(^|\.)pinimg\.com$/.test(u.hostname)) { u.pathname = u.pathname.replace(/^\/(\d+x\d*|\d+x)\//, '/originals/'); return u.toString(); }
  if (/(^|\.)wp\.com$/.test(u.hostname) || /\/wp-content\/uploads\//.test(u.pathname)) {
    u.pathname = u.pathname.replace(/-\d{2,4}x\d{2,4}(\.\w+)$/, '$1');
    ['w', 'h', 'resize', 'fit'].forEach(k => u.searchParams.delete(k)); return u.toString();
  }
  return url;
}

function kindOf(url, mime) {
  if (mime) { if (/^video\//.test(mime)) return 'video'; if (/^image\//.test(mime)) return 'image'; }
  let p = ''; try { p = new URL(url).pathname; } catch { p = String(url); }
  if (VID_EXT.test(p)) return 'video';
  if (IMG_EXT.test(p)) return 'image';
  return null;
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : 0));
const area = (m) => (m.width || 0) * (m.height || 0);
function best(cands) {
  let top = null;
  for (const c of cands || []) { if (!c || !c.url) continue; if (!top || num(c.width) * num(c.height) > num(top.width) * num(top.height)) top = c; }
  return top;
}
function smallestAtLeast(cands, min = 240) {
  const sorted = (cands || []).filter(c => c && c.url).sort((a, b) => num(a.width) - num(b.width));
  return (sorted.find(c => num(c.width) >= min) || sorted[sorted.length - 1] || null);
}
const tsToMs = (t) => { const n = num(t); if (!n) return 0; return n < 1e12 ? n * 1000 : n; };
const isoToMs = (s) => { const t = Date.parse(s || ''); return isNaN(t) ? 0 : t; };

function mk(o) {
  const m = { key: keyOf(o.url), url: o.url, kind: o.kind || kindOf(o.url) || 'image', width: num(o.width), height: num(o.height), thumb: o.thumb || null,
    bytes: num(o.bytes), site: o.site || siteOf(o.url), account: o.account || null, accountName: o.accountName || null, postId: o.postId ? String(o.postId) : null, postUrl: o.postUrl || null,
    postIndex: num(o.postIndex), caption: o.caption || '', date: num(o.date), source: o.source || 'api', name: o.name || null };
  if (o.key) m.key = o.key;
  return m;
}

// ---------------------------------------------------------------- Instagram
function igCaption(n) {
  if (n.caption && typeof n.caption === 'object') return n.caption.text || '';
  if (typeof n.caption === 'string') return n.caption;
  const e = n.edge_media_to_caption && n.edge_media_to_caption.edges; return (e && e[0] && e[0].node && e[0].node.text) || '';
}
function igOne(n) {
  // one picture or video inside a post: returns { url, kind, width, height, thumb }
  const imgs = (n.image_versions2 && n.image_versions2.candidates) || (n.display_resources ? n.display_resources.map(r => ({ url: r.src, width: r.config_width, height: r.config_height })) : null)
    || (n.display_url ? [{ url: n.display_url, width: n.dimensions && n.dimensions.width, height: n.dimensions && n.dimensions.height }] : []);
  const bi = best(imgs); const th = smallestAtLeast(imgs);
  const vids = n.video_versions || (n.video_url ? [{ url: n.video_url, width: n.dimensions && n.dimensions.width, height: n.dimensions && n.dimensions.height }] : null);
  if ((n.media_type === 2 || n.is_video || vids) && vids && vids.length) {
    const bv = best(vids) || vids[0];
    return { url: bv.url, kind: 'video', width: num(bv.width) || num(n.original_width) || (bi && num(bi.width)), height: num(bv.height) || num(n.original_height) || (bi && num(bi.height)), thumb: th && th.url, cover: bi && bi.url };
  }
  if (!bi) return null;
  return { url: bi.url, kind: 'image', width: num(bi.width) || num(n.original_width), height: num(bi.height) || num(n.original_height), thumb: th && th.url };
}
function isIgPost(n) {
  return n && typeof n === 'object' && (n.image_versions2 || n.display_url || n.display_resources || n.carousel_media || n.edge_sidecar_to_children)
    && (n.code || n.shortcode || n.pk || n.id) && (n.taken_at || n.taken_at_timestamp || n.code || n.shortcode || n.carousel_media || n.edge_sidecar_to_children);
}
function igPost(n, out) {
  const code = n.code || n.shortcode || null;
  const user = n.user || n.owner || {};
  const account = (user.username || '').toLowerCase() || null;
  const isClip = n.product_type === 'clips' || n.product_type === 'igtv';
  const postUrl = code ? `https://www.instagram.com/${isClip ? 'reel' : 'p'}/${code}/` : (account && (n.pk || n.id) ? `https://www.instagram.com/stories/${account}/${String(n.pk || n.id).split('_')[0]}/` : null);
  const base = { site: 'instagram', account, accountName: user.full_name || null, postId: code || String(n.pk || n.id).split('_')[0], postUrl, caption: igCaption(n), date: tsToMs(n.taken_at || n.taken_at_timestamp), source: 'api' };
  const kids = n.carousel_media || (n.edge_sidecar_to_children && n.edge_sidecar_to_children.edges.map(e => e.node));
  const parts = kids && kids.length ? kids : [n];
  parts.forEach((k, i) => {
    const one = igOne(k); if (!one) return;
    // a video is keyed by its cover picture, so the grid thumbnail and the video are one item
    out.push(mk({ ...base, ...one, postIndex: i + 1, key: one.cover ? keyOf(one.cover) : undefined }));
  });
}

// ---------------------------------------------------------------- Patreon (JSON:API)
function patreonDoc(doc, out) {
  const data = Array.isArray(doc.data) ? doc.data : (doc.data ? [doc.data] : []);
  const inc = new Map();
  for (const x of doc.included || []) inc.set(x.type + ':' + x.id, x);
  for (const p of data) {
    if (!p || p.type !== 'post' || !p.attributes) continue;
    const a = p.attributes, rel = p.relationships || {};
    let account = null, accountName = null;
    const camp = rel.campaign && rel.campaign.data && inc.get('campaign:' + rel.campaign.data.id);
    const usr = rel.user && rel.user.data && inc.get('user:' + rel.user.data.id);
    if (camp && camp.attributes) { accountName = camp.attributes.name || null; account = accountFromUrl(camp.attributes.url || '') || (camp.attributes.vanity || '').toLowerCase() || null; }
    if (!account && usr && usr.attributes) { account = (usr.attributes.vanity || '').toLowerCase() || accountFromUrl(usr.attributes.url || '') || null; accountName = accountName || usr.attributes.full_name || null; }
    const postUrl = a.url ? (a.url.startsWith('http') ? a.url : 'https://www.patreon.com' + a.url) : (a.patreon_url ? 'https://www.patreon.com' + a.patreon_url : null);
    if (!account && postUrl) account = null;
    const caption = [a.title, stripHtml(a.content || a.teaser_text || '')].filter(Boolean).join('\n\n').trim();
    const base = { site: 'patreon', account, accountName, postId: String(p.id), postUrl, caption, date: isoToMs(a.published_at || a.created_at), source: 'api' };
    const seen = new Set(); let idx = 0;
    const push = (o) => { if (!o || !o.url || seen.has(keyOf(o.url))) return; seen.add(keyOf(o.url)); out.push(mk({ ...base, ...o, postIndex: ++idx })); };
    const ids = []; for (const r of ['images', 'media', 'attachments_media', 'audio']) { const d = rel[r] && rel[r].data; if (Array.isArray(d)) ids.push(...d); }
    for (const ref of ids) {
      const m = inc.get((ref.type || 'media') + ':' + ref.id); if (!m || !m.attributes) continue;
      const ma = m.attributes, mime = ma.mimetype || '';
      const iu = ma.image_urls || {};
      if (/^video\//.test(mime) && ma.download_url) push({ url: ma.download_url, kind: 'video', width: ma.metadata && ma.metadata.dimensions && ma.metadata.dimensions.w, height: ma.metadata && ma.metadata.dimensions && ma.metadata.dimensions.h, thumb: iu.thumbnail || iu.default || null, name: ma.file_name });
      else if (/^image\//.test(mime) || iu.original || iu.default) {
        const dims = (ma.metadata && ma.metadata.dimensions) || {};
        push({ url: ma.download_url || iu.original || iu.default || iu.url, kind: 'image', width: dims.w, height: dims.h, thumb: iu.thumbnail || iu.thumbnail_small || iu.default_small || iu.default || null, name: ma.file_name });
      }
    }
    if (a.post_file && a.post_file.url && (kindOf(a.post_file.url) || /image|video/.test(a.post_file.mimetype || '') || a.post_type === 'image_file')) {
      push({ url: a.post_file.url, kind: kindOf(a.post_file.url, a.post_file.mimetype) || (a.post_type === 'video_external_file' ? 'video' : 'image'), width: a.post_file.width, height: a.post_file.height, name: a.post_file.name });
    }
    for (const src of imgSrcs(a.content || '')) push({ url: src, kind: 'image' });
    if (!idx && a.image && (a.image.large_url || a.image.url)) push({ url: a.image.large_url || a.image.url, kind: 'image', width: a.image.width, height: a.image.height, thumb: a.image.thumb_url || null });
  }
}
function stripHtml(s) { return String(s).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim(); }
function imgSrcs(html) { const r = []; const re = /<img[^>]+src="([^"]+)"/gi; let m; while ((m = re.exec(html))) if (/^https?:/.test(m[1])) r.push(m[1].replace(/&amp;/g, '&')); return r; }

// ---------------------------------------------------------------- Facebook (GraphQL, best effort)
const FB_IMG_FIELDS = ['image', 'viewer_image', 'photo_image', 'full_image', 'large_share_image', 'massive_image', 'image_high_res', 'preferred_image'];
function fbPhoto(n) {
  const c = FB_IMG_FIELDS.map(f => n[f]).filter(x => x && typeof x === 'object' && x.uri).map(x => ({ url: x.uri, width: x.width, height: x.height }));
  return best(c) ? { pick: best(c), thumb: smallestAtLeast(c) } : null;
}
function fbVideo(n) {
  const url = n.browser_native_hd_url || n.playable_url_quality_hd || n.browser_native_sd_url || n.playable_url;
  if (!url) return null;
  const th = n.preferred_thumbnail && n.preferred_thumbnail.image ? n.preferred_thumbnail.image.uri : (n.thumbnailImage && n.thumbnailImage.uri) || (n.image && n.image.uri) || null;
  return { url, width: n.width || n.original_width, height: n.height || n.original_height, thumb: th };
}
function fbStoryInfo(s) {
  const info = { postId: s.post_id || s.id || null, postUrl: s.url || s.permalink_url || s.wwwURL || null, date: tsToMs(s.creation_time || s.publish_time), caption: '', account: null, accountName: null };
  let budget = 4000; const stack = [s];
  while (stack.length && budget-- > 0) {
    const o = stack.pop(); if (!o || typeof o !== 'object') continue;
    if (!info.caption && o.message && typeof o.message === 'object' && typeof o.message.text === 'string') info.caption = o.message.text;
    if (!info.date && (o.creation_time || o.publish_time)) info.date = tsToMs(o.creation_time || o.publish_time);
    if (!info.accountName && Array.isArray(o.actors) && o.actors[0]) { info.accountName = o.actors[0].name || null; info.account = accountFromUrl(o.actors[0].url || o.actors[0].profile_url || '') || null; }
    if (!info.postUrl && typeof o.url === 'string' && /facebook\.com\/.+\/(posts|photos|videos)\//.test(o.url)) info.postUrl = o.url;
    for (const k in o) { const v = o[k]; if (v && typeof v === 'object') stack.push(v); }
  }
  return info;
}
function facebookWalk(root, out) {
  const seen = new Set();
  const walk = (n, story, depth) => {
    if (!n || typeof n !== 'object' || depth > 80) return;
    if (Array.isArray(n)) { for (const x of n) walk(x, story, depth + 1); return; }
    const t = n.__typename;
    if (t === 'Story' && (n.post_id || n.id) && !story) story = fbStoryInfo(n);
    if ((t === 'Photo' || (!t && n.id && (n.viewer_image || n.photo_image))) && n.id && !seen.has('p' + n.id)) {
      const ph = fbPhoto(n);
      if (ph) {
        seen.add('p' + n.id);
        const own = n.owner || {};
        out.push(mk({ site: 'facebook', url: ph.pick.url, kind: 'image', width: ph.pick.width, height: ph.pick.height, thumb: ph.thumb && ph.thumb.url,
          account: (story && story.account) || accountFromUrl(own.url || '') || null, accountName: (story && story.accountName) || own.name || null,
          postId: (story && story.postId) || String(n.id), postUrl: (story && story.postUrl) || n.url || `https://www.facebook.com/photo/?fbid=${n.id}`,
          caption: (story && story.caption) || (n.message && n.message.text) || (n.accessibility_caption || ''), date: (story && story.date) || tsToMs(n.created_time), source: 'api' }));
      }
    }
    if (t === 'Video' && n.id && !seen.has('v' + n.id)) {
      const v = fbVideo(n);
      if (v) { seen.add('v' + n.id); out.push(mk({ site: 'facebook', ...v, key: v.thumb ? keyOf(v.thumb) : undefined, kind: 'video', account: story && story.account, accountName: story && story.accountName, postId: (story && story.postId) || String(n.id), postUrl: (story && story.postUrl) || n.permalink_url || null, caption: (story && story.caption) || '', date: (story && story.date) || tsToMs(n.publish_time), source: 'api' })); }
    }
    for (const k in n) { const v = n[k]; if (v && typeof v === 'object') walk(v, story, depth + 1); }
  };
  walk(root, null, 0);
}

// ---------------------------------------------------------------- X / Twitter
function xTweet(t, out, user) {
  const lg = t.legacy || t; const media = (lg.extended_entities && lg.extended_entities.media) || [];
  if (!media.length) return;
  const sn = user || (t.core && t.core.user_results && t.core.user_results.result && ((t.core.user_results.result.legacy && t.core.user_results.result.legacy.screen_name) || (t.core.user_results.result.core && t.core.user_results.result.core.screen_name))) || null;
  const id = lg.id_str || t.rest_id;
  const base = { site: 'x', account: sn ? sn.toLowerCase() : null, accountName: sn, postId: id, postUrl: sn && id ? `https://x.com/${sn}/status/${id}` : null, caption: (lg.full_text || '').replace(/\s*https:\/\/t\.co\/\w+$/, ''), date: isoToMs(lg.created_at), source: 'api' };
  media.forEach((m, i) => {
    const oi = m.original_info || {};
    if ((m.type === 'video' || m.type === 'animated_gif') && m.video_info) {
      const v = (m.video_info.variants || []).filter(x => x.content_type === 'video/mp4').sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      if (v) out.push(mk({ ...base, url: v.url, kind: 'video', width: oi.width, height: oi.height, thumb: m.media_url_https, postIndex: i + 1, key: keyOf(m.media_url_https) }));
    } else if (m.media_url_https) out.push(mk({ ...base, url: upgradeUrl(m.media_url_https), kind: 'image', width: oi.width, height: oi.height, thumb: m.media_url_https + (m.media_url_https.includes('?') ? '&' : '?') + 'name=small', postIndex: i + 1 }));
  });
}
function xWalk(root, out) {
  const walk = (n, d) => {
    if (!n || typeof n !== 'object' || d > 60) return;
    if (Array.isArray(n)) { for (const x of n) walk(x, d + 1); return; }
    if ((n.__typename === 'Tweet' || n.rest_id) && n.legacy && n.legacy.extended_entities) { xTweet(n, out); }
    for (const k in n) { const v = n[k]; if (v && typeof v === 'object') walk(v, d + 1); }
  };
  walk(root, 0);
}

// ---------------------------------------------------------------- anything else: {url,width,height} objects
const URL_FIELDS = ['url', 'uri', 'src', 'source', 'image_url', 'imageUrl', 'original', 'download_url', 'full', 'large', 'orig'];
function genericWalk(root, out, pageUrl) {
  const site = siteOf(pageUrl || '');
  const walk = (n, d) => {
    if (!n || typeof n !== 'object' || d > 50) return;
    if (Array.isArray(n)) { for (const x of n) walk(x, d + 1); return; }
    for (const f of URL_FIELDS) {
      const v = n[f];
      if (typeof v === 'string' && /^https?:\/\//.test(v)) {
        const kind = kindOf(v, n.mime || n.mimetype || n.content_type || n.type);
        const w = num(n.width || n.w), h = num(n.height || n.h);
        if (kind && (w >= 200 || h >= 200)) out.push(mk({ site, url: upgradeUrl(v), kind, width: w, height: h, source: 'api' }));
      }
    }
    for (const k in n) { const v = n[k]; if (v && typeof v === 'object') walk(v, d + 1); }
  };
  walk(root, 0);
}

function instagramWalk(root, out) {
  const walk = (n, d) => {
    if (!n || typeof n !== 'object' || d > 80) return;
    if (Array.isArray(n)) { for (const x of n) walk(x, d + 1); return; }
    if (isIgPost(n)) { igPost(n, out); return; }
    for (const k in n) { const v = n[k]; if (v && typeof v === 'object') walk(v, d + 1); }
  };
  walk(root, 0);
}

// Response bodies: Facebook prefixes "for (;;);" and some endpoints stream one JSON object per line.
function parseBody(text) {
  if (typeof text !== 'string') return [];
  let t = text.replace(/^﻿/, '').replace(/^\s*for\s*\(;;\);\s*/, '').replace(/^\)\]\}',?\s*/, '').trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return [];
  try { return [JSON.parse(t)]; } catch {}
  const r = [];
  for (const line of t.split(/\n(?=[{[])/)) { try { r.push(JSON.parse(line)); } catch {} }
  return r;
}

// Harvest one JSON document. `from` is the URL the JSON came from (API or page), `pageUrl` the page the user is on.
function harvestJson(doc, from, pageUrl) {
  const out = [];
  const site = siteOf(from || pageUrl || '');
  const page = siteOf(pageUrl || from || '');
  try {
    if (site === 'patreon' || page === 'patreon' || (doc && doc.data && doc.included)) patreonDoc(doc, out);
    if (site === 'instagram' || page === 'instagram' || site === 'threads' || page === 'threads') instagramWalk(doc, out);
    if (site === 'facebook' || page === 'facebook') facebookWalk(doc, out);
    if (site === 'x' || page === 'x') xWalk(doc, out);
    if (!out.length && !['instagram', 'facebook', 'patreon', 'x', 'threads'].includes(page)) genericWalk(doc, out, pageUrl || from);
  } catch (e) { /* a strange document never stops collecting */ }
  if (page === 'threads') out.forEach(m => { m.site = 'threads'; if (m.postId && m.account) m.postUrl = `https://www.threads.net/@${m.account}/post/${m.postId}`; });
  return out;
}
function harvestText(text, from, pageUrl) { const r = []; for (const d of parseBody(text)) r.push(...harvestJson(d, from, pageUrl)); return r; }

// ---------------------------------------------------------------- DOM scan results (see dom-scan.js)
function postFromLink(href, site) {
  if (!href) return null;
  let u; try { u = new URL(href); } catch { return null; }
  const p = u.pathname;
  let m;
  if (site === 'instagram' && (m = /\/(p|reel|tv)\/([\w-]+)/.exec(p))) return { postId: m[2], postUrl: `https://www.instagram.com/${m[1] === 'tv' ? 'reel' : m[1]}/${m[2]}/` };
  if (site === 'x' && (m = /^\/([^/]+)\/status\/(\d+)/.exec(p))) return { postId: m[2], postUrl: `https://x.com/${m[1]}/status/${m[2]}`, account: m[1].toLowerCase() };
  if (site === 'patreon' && (m = /^\/posts\/(?:[\w-]*-)?(\d+)/.exec(p))) return { postId: m[1], postUrl: u.origin + p };
  if (site === 'facebook' && (m = /\/(?:posts|videos|reel)\/([\w.-]+)/.exec(p))) return { postId: m[1], postUrl: u.origin + p };
  if (site === 'facebook' && u.searchParams.get('fbid')) return { postId: u.searchParams.get('fbid'), postUrl: `https://www.facebook.com/photo/?fbid=${u.searchParams.get('fbid')}` };
  if (site === 'pinterest' && (m = /^\/pin\/(\d+)/.exec(p))) return { postId: m[1], postUrl: `https://www.pinterest.com/pin/${m[1]}/` };
  return null;
}
const SOCIAL = new Set(['instagram', 'facebook', 'patreon', 'x', 'pinterest', 'tiktok', 'threads']);
// On ordinary websites the page itself is the "account": its title names the folder.
function pageAccountOf(pageUrl, title) {
  const site = siteOf(pageUrl);
  if (SOCIAL.has(site)) return { account: accountFromUrl(pageUrl), accountName: null };
  const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 70);
  return { account: t || site, accountName: t || null };
}
function harvestDom(scan, pageUrl) {
  const out = []; const site = siteOf(pageUrl); const pa = pageAccountOf(pageUrl, scan.title); const pageAccount = pa.account;
  const add = (o) => {
    if (!o.url || !/^https?:/.test(o.url)) return;
    const kind = o.kind || kindOf(o.url) || 'image';
    const post = postFromLink(o.link, site) || {};
    out.push(mk({ site, account: post.account || pageAccount, accountName: pa.accountName, ...post, url: upgradeUrl(o.url), kind, width: o.w, height: o.h, thumb: o.thumb || (kind === 'image' ? o.url : null), caption: o.alt || '', source: 'dom' }));
  };
  for (const i of scan.images || []) add({ url: i.src, w: i.w, h: i.h, link: i.link, alt: i.alt, thumb: i.thumb });
  for (const v of scan.videos || []) if (v.src && !/^blob:/.test(v.src)) add({ url: v.src, kind: 'video', w: v.w, h: v.h, link: v.link, thumb: v.poster });
  for (const b of scan.backgrounds || []) add({ url: b.src, w: b.w, h: b.h, link: b.link });
  for (const l of scan.links || []) add({ url: l.href, kind: kindOf(l.href), link: null, alt: l.text });
  return out;
}

// Network-only sightings: an image or video the page downloaded.
function harvestNet(r, pageUrl, pageTitle) {
  const kind = kindOf(r.url, r.mime); if (!kind) return null;
  if (/^data:|^blob:/.test(r.url)) return null;
  if (kind === 'video' && /\.(m4s|ts)$|bytestart=|range=/.test(r.url)) return null; // pieces of a stream, not a file
  const pa = pageAccountOf(pageUrl, pageTitle);
  return mk({ site: siteOf(pageUrl), account: pa.account, accountName: pa.accountName, url: upgradeUrl(r.url), kind, bytes: r.bytes, thumb: kind === 'image' ? r.url : null, source: 'net' });
}

// Merge a newer sighting into what we already have: keep the biggest file, keep the richest post info.
function merge(a, b) {
  const big = area(b) > area(a) || (!area(a) && !area(b) && (b.bytes || 0) > (a.bytes || 0)) || (area(b) === area(a) && SOURCE_RANK[b.source] > SOURCE_RANK[a.source] && b.kind === a.kind);
  const r = { ...a };
  if (big) { r.url = b.url; r.width = b.width || a.width; r.height = b.height || a.height; r.bytes = b.bytes || a.bytes; r.kind = b.kind; }
  if (a.kind === 'image' && b.kind === 'video') { r.kind = 'video'; r.url = b.url; r.width = b.width || a.width; r.height = b.height || a.height; }
  const richer = SOURCE_RANK[b.source] > SOURCE_RANK[a.source];
  for (const f of ['postId', 'postUrl', 'account', 'accountName', 'caption', 'date', 'postIndex', 'name']) {
    if (b[f] && (!a[f] || (richer && f !== 'caption') || (f === 'caption' && richer && b.caption))) r[f] = b[f];
  }
  if (!r.thumb || (b.thumb && richer)) r.thumb = b.thumb || r.thumb;
  if (richer) r.source = b.source;
  return r;
}

const SIZE_FLOOR = 25000; // bytes: network-only images below this are icons and avatars
function isSmall(m, minSide) {
  if (m.width && m.height) return Math.max(m.width, m.height) < minSide;
  if (m.source === 'net' && m.bytes) return m.bytes < SIZE_FLOOR;
  return false;
}

function extFor(url, kind, mime) {
  const fromMime = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/heic': 'heic', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }[String(mime || '').split(';')[0].trim().toLowerCase()];
  if (fromMime) return fromMime;
  let p = ''; try { const u = new URL(url); p = u.pathname; const f = u.searchParams.get('format'); if (f && /^(jpg|jpeg|png|webp|gif)$/.test(f)) return f === 'jpeg' ? 'jpg' : f; } catch {}
  const m = /\.(\w{2,4})$/.exec(p);
  if (m && (IMG_EXT.test('.' + m[1]) || VID_EXT.test('.' + m[1]))) return m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  return kind === 'video' ? 'mp4' : 'jpg';
}

module.exports = { SOCIAL, pageAccountOf, siteOf, siteName, accountFromUrl, keyOf, upgradeUrl, kindOf, parseBody, harvestJson, harvestText, harvestDom, harvestNet, merge, isSmall, extFor, stripHtml, postFromLink };
