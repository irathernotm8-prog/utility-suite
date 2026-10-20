// YouTube — your channel's daily views, watch time, subscribers and engagement, plus top videos.
// (Paid YouTube video ads show up in Google Ads.)
const { gget } = require('../google-auth');
const DATA = 'https://www.googleapis.com/youtube/v3', AN = 'https://youtubeanalytics.googleapis.com/v2/reports';
const METRICS = { views: 'views', estimatedMinutesWatched: 'watch_minutes', subscribersGained: 'subs_gained', subscribersLost: 'subs_lost', likes: 'likes', comments: 'comments', shares: 'shares' };

async function analytics(cfg, params, fetchImpl) {
  return gget(`${AN}?${new URLSearchParams({ ids: 'channel==MINE', ...params })}`, cfg.accessToken, fetchImpl);
}

module.exports = {
  kind: 'youtube', name: 'YouTube', category: 'analytics', google: true, status: 'ready', fields: [],
  async test(cfg, fetchImpl = fetch) {
    const r = await gget(`${DATA}/channels?part=snippet,statistics&mine=true`, cfg.accessToken, fetchImpl);
    const c = r.items && r.items[0]; if (!c) throw new Error('This Google account has no YouTube channel. Sign in with the account that owns it.');
    return { ok: true, detail: `${c.snippet.title} · ${(+c.statistics.subscriberCount || 0).toLocaleString()} subscribers` };
  },
  async sync(cfg, { since, until }, fetchImpl = fetch) {
    const keys = Object.keys(METRICS);
    const r = await analytics(cfg, { startDate: since, endDate: until, dimensions: 'day', metrics: keys.join(','), sort: 'day' }, fetchImpl);
    const cols = (r.columnHeaders || []).map((c) => c.name), series = [];
    for (const row of r.rows || []) {
      const date = row[cols.indexOf('day')];
      for (const k of keys) series.push({ metric: METRICS[k], dim: '', date, value: +row[cols.indexOf(k)] || 0 });
    }
    // Top videos in the window, as a small table.
    const top = await analytics(cfg, { startDate: since, endDate: until, dimensions: 'video', metrics: 'views,estimatedMinutesWatched,likes', sort: '-views', maxResults: '10' }, fetchImpl);
    const ids = (top.rows || []).map((x) => x[0]); let titles = {};
    if (ids.length) { const v = await gget(`${DATA}/videos?part=snippet&id=${ids.join(',')}`, cfg.accessToken, fetchImpl); for (const it of v.items || []) titles[it.id] = it.snippet.title; }
    const snapshots = [{ key: 'top-videos', name: 'Top videos', payload: { columns: ['Video', 'Views', 'Minutes watched', 'Likes'], rows: (top.rows || []).map((x) => [titles[x[0]] || x[0], x[1], x[2], x[3]]) } }];
    return { series, snapshots };
  }
};
