// The post lifecycle behind the calendar: draft → scheduled → published (or partial / failed), plus the minute-by-minute scheduler.
// Facebook posts due 10+ minutes ahead are handed to Meta to publish (so they go out even if Lumen is closed).
// Everything else is held by Lumen and published when it is due; if Lumen was closed for over an hour past the time, the post
// is marked "missed" instead of going out unexpectedly late.
const PLATFORMS = ['facebook', 'instagram'];
const GRACE_MS = 60 * 60 * 1000, VERIFY_AFTER_MS = 2 * 60 * 1000, OVERDUE_MS = 30 * 60 * 1000, MIN_AHEAD_MS = 60 * 1000;

function derive(p) {
  const st = p.platforms.map((x) => (p.results[x] || {}).status);
  if (st.some((s) => s === 'scheduled' || s === 'queued')) return 'scheduled';
  if (st.length && st.every((s) => s === 'published')) return 'published';
  if (st.some((s) => s === 'published')) return 'partial';
  if (st.some((s) => s === 'failed' || s === 'missed')) return 'failed';
  return 'draft';
}

function validate(p) {
  if (!p.platforms.length) throw new Error('Pick Facebook, Instagram or both.');
  if (p.platforms.includes('facebook') && !(p.body.trim() || p.link.trim() || p.media_path || p.media_url)) throw new Error('A Facebook post needs text, a link or a photo.');
  if (p.platforms.includes('instagram') && !(p.media_path || p.media_url)) throw new Error('Instagram posts need a photo (JPEG).');
}

function makePosts({ S, cfgFor, pub, now = Date.now }) {
  const need = (id) => { const p = S.post(id); if (!p) throw new Error('Post not found.'); return p; };
  const finish = (p, results) => { const m = { ...p, results }; m.status = derive(m); return S.savePost(p.workspace_id, { id: p.id, results, status: m.status }); };
  const todo = (p) => p.platforms.filter((x) => (p.results[x] || {}).status !== 'published');

  return {
    derive,
    save(ws, d) {
      const cur = d.id ? need(d.id) : null;
      if (cur && cur.status === 'scheduled') throw new Error('Unschedule this post before editing it.');
      const at = d.scheduled_at ? new Date(d.scheduled_at) : null;
      if (at && isNaN(at)) throw new Error('That date and time is not valid.');
      return S.savePost(ws, { ...(cur ? { id: cur.id } : {}), body: String(d.body || ''), link: String(d.link || '').trim(), media_path: d.media_path || '', media_url: String(d.media_url || '').trim(),
        platforms: (d.platforms || []).filter((x) => PLATFORMS.includes(x)), scheduled_at: at ? at.toISOString() : null, ...(cur ? {} : { status: 'draft', results: {} }) });
    },

    async schedule(id) {
      const p = need(id); validate(p);
      const at = Date.parse(p.scheduled_at);
      if (!at || at < now() + MIN_AHEAD_MS) throw new Error('Pick a time at least a minute from now.');
      const cfg = cfgFor(p.workspace_id), results = { ...p.results };
      for (const x of todo(p)) {
        if (x === 'facebook' && pub.canNativeSchedule(p.scheduled_at, now())) results.facebook = await pub.scheduleFacebook(p, cfg);
        else results[x] = { status: 'queued', due: p.scheduled_at };
      }
      return finish(p, results);
    },

    async publishNow(id) {
      const p = need(id); validate(p); const cfg = cfgFor(p.workspace_id), results = { ...p.results };
      if (results.facebook && results.facebook.native && results.facebook.status === 'scheduled') { await pub.cancelFacebook(results.facebook.id, cfg); delete results.facebook; }
      const r = await pub.publishNow(p, cfg, todo(p));
      return finish(p, { ...results, ...r });
    },

    async unschedule(id) {
      const p = need(id); const cfg = p.status === 'scheduled' ? cfgFor(p.workspace_id) : null, results = { ...p.results };
      for (const x of p.platforms) {
        const r = results[x]; if (!r || r.status === 'published') continue;
        if (r.native && r.status === 'scheduled') await pub.cancelFacebook(r.id, cfg);
        delete results[x];
      }
      return finish(p, results);
    },

    async remove(id) {
      const p = S.post(id); if (!p) return;
      const f = p.results.facebook;
      if (f && f.native && f.status === 'scheduled') {
        try { await pub.cancelFacebook(f.id, cfgFor(p.workspace_id)); }
        catch (e) { throw new Error('Could not cancel the scheduled Facebook post (' + e.message + '). Nothing was deleted, so it is not forgotten; try again or remove it in Facebook’s Publishing Tools.'); }
      }
      S.deletePost(id);
    },

    // Runs every minute and once at start-up.
    async tick() {
      const changed = [];
      for (const p of S.allDuePosts()) {
        const at = Date.parse(p.scheduled_at); if (!at) continue;
        const results = { ...p.results }; let dirty = false;
        const queued = p.platforms.filter((x) => (results[x] || {}).status === 'queued' && at <= now());
        const stale = queued.filter((x) => now() - at > GRACE_MS), live = queued.filter((x) => !stale.includes(x));
        for (const x of stale) { results[x] = { status: 'missed', error: 'Lumen was closed at the scheduled time, so this was not posted. Publish it now or pick a new time.' }; dirty = true; }
        if (live.length) { Object.assign(results, await pub.publishNow(p, cfgFor(p.workspace_id), live)); dirty = true; }
        const f = results.facebook;
        if (f && f.native && f.status === 'scheduled' && now() > at + VERIFY_AFTER_MS) {
          const c = await pub.checkFacebook(f.id, cfgFor(p.workspace_id)).catch(() => ({ state: 'unknown' }));
          if (c.state === 'published') { results.facebook = { ...f, status: 'published', url: c.url || f.url, at: new Date().toISOString() }; dirty = true; }
          else if (now() > at + OVERDUE_MS && !f.overdue) { results.facebook = { ...f, overdue: true }; dirty = true; }
        }
        if (dirty) changed.push(finish(p, results));
      }
      return changed;
    }
  };
}

module.exports = { makePosts, derive, validate, PLATFORMS };
