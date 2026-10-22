// A stand-in for Instagram, Patreon, a CDN and an ordinary gallery site, answering by Host header.
// Electron is pointed here with --host-resolver-rules, so the app sees the real hostnames.
const https = require('https');
const fs = require('fs');
const path = require('path');
const A = (f) => path.join(__dirname, 'assets', f);
const PORT = Number(process.env.MOCK_PORT || 443);

// 20 Instagram posts, newest first; post 0 is a 3-photo carousel, post 4 a reel. /__addpost adds a newer one.
let posts = [];
const mkPost = (n, t) => ({ n, code: 'C' + String(n).padStart(4, '0') + 'xYz', taken_at: t, kind: n % 7 === 0 ? 'carousel' : n % 9 === 4 ? 'reel' : 'photo' });
for (let i = 0; i < 20; i++) posts.push(mkPost(100 - i, 1760000000 - i * 86400));
const img = (id, n) => ({ candidates: [1080, 640, 320].map(w => ({ url: `https://scontent.cdninstagram.com/v/t51.2885-15/${id}_n.jpg?stp=dst-jpg_p${w}x${w}&c=${n % 12}`, width: w, height: Math.round(w * 1.25) })) });
function igItem(p) {
  const id = 900000000 + p.n * 10;
  const base = { code: p.code, pk: String(id), id: id + '_1', taken_at: p.taken_at, user: { username: 'clientbrand', full_name: 'Client Brand Co.' }, caption: { text: `Post number ${p.n}\nShot on location #brand` } };
  if (p.kind === 'carousel') return { ...base, media_type: 8, carousel_media: [0, 1, 2].map(k => ({ id: 'k' + k, media_type: 1, image_versions2: img(id + k, p.n + k) })) };
  if (p.kind === 'reel') return { ...base, media_type: 2, product_type: 'clips', image_versions2: img(id, p.n), video_versions: [{ url: `https://scontent.cdninstagram.com/o1/v/t16/reel_${id}.mp4`, width: 1080, height: 1920 }] };
  return { ...base, media_type: 1, image_versions2: img(id, p.n) };
}
const PAGE = 6;
function feed(maxId) { const start = Number(maxId) || 0; const items = posts.slice(start, start + PAGE).map(igItem); return { items, more_available: start + PAGE < posts.length, next_max_id: String(start + PAGE), status: 'ok' }; }

const igProfile = () => `<!doctype html><html><head><title>Client Brand Co. (@clientbrand) • Instagram photos and videos</title>
<style>body{font-family:sans-serif;margin:0;background:#fff} header{display:flex;gap:20px;align-items:center;padding:30px 60px} .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;max-width:900px;margin:auto} .grid img{width:100%;aspect-ratio:4/5;object-fit:cover;display:block} .sugg img{width:40px}</style></head>
<body><header><img src="https://scontent.cdninstagram.com/v/t51.2885-19/avatar_123456789.jpg" width="150" height="150" style="border-radius:50%"><div><h2>clientbrand</h2><p>Client Brand Co. · ${posts.length} posts</p></div></header>
<div class="grid" id="grid"></div><p id="end" style="text-align:center;padding:40px">Loading…</p>
<script type="application/json" data-sjs>${JSON.stringify({ require: [['ScheduledServerJS', 'handle', null, [{ __bbox: { result: { data: { xdt_api__v1__feed__user_timeline_graphql_connection: { edges: feed(0).items.map(node => ({ node })) } } } } }]]] })}</script>
<script>
let next = ${PAGE}, more = ${posts.length > PAGE}, busy = false;
const add = (items) => { for (const it of items) { const m = it.carousel_media ? it.carousel_media[0] : it; const a = document.createElement('a'); a.href = (it.product_type === 'clips' ? '/reel/' : '/p/') + it.code + '/'; const i = document.createElement('img'); i.src = m.image_versions2.candidates[2].url; a.appendChild(i); document.getElementById('grid').appendChild(a); } };
add(${JSON.stringify(feed(0).items)});
async function load() { if (busy || !more) return; busy = true; const r = await fetch('/api/v1/feed/user/1/?count=${PAGE}&max_id=' + next, { headers: { 'x-ig-app-id': '1' } }); const j = await r.json(); add(j.items); next = Number(j.next_max_id); more = j.more_available; busy = false; if (!more) document.getElementById('end').textContent = 'That is everything'; }
addEventListener('scroll', () => { if (innerHeight + scrollY > document.body.scrollHeight - 300) load(); });
</script></body></html>`;

// Patreon: two pages of posts, one webp, one locked post.
const patreonPosts = (page) => {
  const data = [], included = [{ id: '9', type: 'campaign', attributes: { name: 'Artist Studio', url: 'https://www.patreon.com/artist' } }];
  const ids = page === 0 ? [501, 502, 503] : [504, 505];
  for (const id of ids) {
    const locked = id === 503;
    const media = locked ? [] : (id === 502 ? ['m' + id + 'a', 'm' + id + 'b'] : ['m' + id + 'a']);
    data.push({ id: String(id), type: 'post', attributes: { title: `Release ${id}`, content: `<p>Notes for ${id}</p>`, published_at: `2026-0${9 - (id - 500) % 5}-1${id % 10}T12:00:00.000+00:00`, url: `/posts/release-${id}`, current_user_can_view: !locked },
      relationships: { images: { data: media.map(m => ({ id: m, type: 'media' })) }, campaign: { data: { id: '9', type: 'campaign' } } } });
    for (const m of media) {
      const webp = m === 'm502b';
      included.push({ id: m, type: 'media', attributes: { mimetype: webp ? 'image/webp' : 'image/jpeg', file_name: `${m}.${webp ? 'webp' : 'jpg'}`, metadata: { dimensions: { w: 1080, h: 1350 } },
        image_urls: { original: `https://c10.patreonusercontent.com/4/patreon-media/p/post/${id}/${m}/original/${webp ? 'x.webp' : 'x.jpg'}?token-time=1`, thumbnail: `https://c10.patreonusercontent.com/4/patreon-media/p/post/${id}/${m}/thumb/x.jpg` } } });
    }
  }
  return { data, included, meta: { pagination: { total: 5 } }, links: page === 0 ? { next: '/api/posts?page=1' } : {} };
};
const patreonPage = () => `<!doctype html><html><head><title>Artist Studio | Patreon</title></head><body style="font-family:sans-serif;padding:30px"><h1>Artist Studio</h1><div id="list"></div>
<script>
async function load(p){ const j = await (await fetch('/api/posts?filter[campaign_id]=9&page=' + p)).json(); for (const d of j.data) { const el = document.createElement('div'); el.style.height='700px'; el.innerHTML = '<h3>' + d.attributes.title + '</h3>' + (d.attributes.current_user_can_view ? '' : '<p>Locked</p>'); document.getElementById('list').appendChild(el); } }
load(0); let more = true; addEventListener('scroll', () => { if (more && innerHeight + scrollY > document.body.scrollHeight - 200) { more = false; load(1); } });
</script></body></html>`;

const gallery = () => `<!doctype html><html><head><title>Spring Lookbook – Example Studio</title><meta property="og:image" content="https://example.org/img/c5_big.jpg"></head><body style="font-family:sans-serif;padding:30px">
<h1>Spring Lookbook</h1>
<img src="https://example.org/img/c6_small.jpg" srcset="https://example.org/img/c6_small.jpg 320w, https://example.org/img/c6_big.jpg 1080w" sizes="300px" width="300">
<img src="https://example.org/img/c7_big.jpg" width="300">
<div style="width:300px;height:375px;background-image:url('https://example.org/img/c8_big.jpg');background-size:cover"></div>
<a href="https://example.org/img/c9_big.jpg">Download the hi-res cover</a>
<img src="https://example.org/img/avatar.jpg" width="40">
</body></html>`;

const server = https.createServer({ key: fs.readFileSync(process.env.MOCK_KEY), cert: fs.readFileSync(process.env.MOCK_CERT) }, (req, res) => {
  const host = (req.headers.host || '').split(':')[0]; const u = new URL(req.url, 'https://' + host);
  const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
  const file = (f, type) => send(200, type, fs.readFileSync(A(f)));
  log.push(host + u.pathname);
  if (u.pathname === '/__addpost') { const top = posts[0]; posts.unshift(mkPost(top.n + 1, top.taken_at + 86400)); return send(200, 'text/plain', 'ok ' + posts[0].code); }
  if (u.pathname === '/__log') return send(200, 'application/json', JSON.stringify(log));
  if (host === 'www.instagram.com') {
    if (u.pathname.startsWith('/api/v1/feed/user/')) return send(200, 'application/json; charset=utf-8', JSON.stringify(feed(u.searchParams.get('max_id'))));
    if (u.pathname === '/clientbrand/') return send(200, 'text/html; charset=utf-8', igProfile());
    if (/^\/(p|reel)\//.test(u.pathname)) return send(200, 'text/html', '<title>Post</title><p>A post</p>');
    return send(200, 'text/html', '<title>Instagram</title><a href="/clientbrand/">clientbrand</a>');
  }
  if (host === 'scontent.cdninstagram.com') {
    if (u.pathname.endsWith('.mp4')) return send(200, 'video/mp4', Buffer.alloc(200000, 7));
    if (u.pathname.includes('avatar')) return file('avatar.jpg', 'image/jpeg');
    const c = Number(u.searchParams.get('c') || 0) % 12; const small = /p(320|640)x/.test(u.searchParams.get('stp') || '');
    return file(`c${c}_${small ? 'small' : 'big'}.jpg`, 'image/jpeg');
  }
  if (host === 'www.patreon.com') {
    if (u.pathname === '/api/posts') return send(200, 'application/vnd.api+json', JSON.stringify(patreonPosts(Number(u.searchParams.get('page') || 0))));
    return send(200, 'text/html; charset=utf-8', patreonPage());
  }
  if (host === 'c10.patreonusercontent.com') {
    if (u.pathname.endsWith('.webp')) return file('c3_big.webp', 'image/webp');
    return file(u.pathname.includes('/thumb/') ? 'c4_small.jpg' : 'c4_big.jpg', 'image/jpeg');
  }
  if (host === 'example.org') {
    if (u.pathname.startsWith('/img/')) return file(u.pathname.slice(5), 'image/jpeg');
    return send(200, 'text/html; charset=utf-8', gallery());
  }
  send(404, 'text/plain', 'not here');
});
const log = [];
server.listen(PORT, '127.0.0.1', () => console.log('mock on ' + PORT));
