// Lumen — local store. One SQLite file per computer (node:sqlite, no native modules to build).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, demo INTEGER DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'new', last_sync TEXT, last_error TEXT);
    CREATE TABLE IF NOT EXISTS facts (
      workspace_id TEXT NOT NULL, source TEXT NOT NULL, connection_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL, campaign_name TEXT NOT NULL, date TEXT NOT NULL,
      spend REAL DEFAULT 0, impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, conversions REAL DEFAULT 0, revenue REAL DEFAULT 0,
      PRIMARY KEY (workspace_id, source, campaign_id, date));
    CREATE INDEX IF NOT EXISTS facts_ws_date ON facts (workspace_id, date);
    CREATE TABLE IF NOT EXISTS series (
      workspace_id TEXT NOT NULL, source TEXT NOT NULL, connection_id TEXT NOT NULL,
      metric TEXT NOT NULL, dim TEXT NOT NULL DEFAULT '', date TEXT NOT NULL, value REAL DEFAULT 0,
      PRIMARY KEY (workspace_id, source, metric, dim, date));
    CREATE INDEX IF NOT EXISTS series_ws_date ON series (workspace_id, source, date);
    CREATE TABLE IF NOT EXISTS snapshots (
      workspace_id TEXT NOT NULL, connection_id TEXT NOT NULL, key TEXT NOT NULL, source TEXT NOT NULL,
      name TEXT NOT NULL, fetched_at TEXT NOT NULL, payload TEXT NOT NULL,
      PRIMARY KEY (connection_id, key));
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
      media_path TEXT NOT NULL DEFAULT '', media_url TEXT NOT NULL DEFAULT '', platforms TEXT NOT NULL DEFAULT '[]',
      scheduled_at TEXT, status TEXT NOT NULL DEFAULT 'draft', results TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS posts_ws ON posts (workspace_id, scheduled_at);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, workspace_id TEXT NOT NULL, action TEXT NOT NULL, kind TEXT, target_id TEXT, target_name TEXT,
      before TEXT, after TEXT, ok INTEGER NOT NULL DEFAULT 1, error TEXT, reverted INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS audit_ws ON audit (workspace_id, id);
    CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
  `);
  return db;
}

// Sources that spend money. Their numbers add up into the Overview; analytics sources (GA4, YouTube, Salesforce) never do.
const AD_SOURCES = ['demo', 'meta', 'google-ads'];
const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 10);
const iso = (d) => d.toISOString().slice(0, 10);
// The person's own calendar day (iso() is UTC, which is already "tomorrow" on a US evening).
const localToday = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);

const auditRow = (r) => ({ ...r, ok: !!r.ok, reverted: !!r.reverted, before: r.before ? JSON.parse(r.before) : null, after: r.after ? JSON.parse(r.after) : null });
const fromRow = (r) => ({ ...r, platforms: JSON.parse(r.platforms), results: JSON.parse(r.results) });

function store(db) {
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);

  return {
    db,
    getSetting(k, d = null) { const r = one('SELECT v FROM settings WHERE k=?', k); return r ? JSON.parse(r.v) : d; },
    setSetting(k, v) { run('INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, JSON.stringify(v)); },

    workspaces: () => q('SELECT * FROM workspaces ORDER BY created_at'),
    addWorkspace(name, demo = 0) { const id = uid('ws'); run('INSERT INTO workspaces VALUES (?,?,?,?)', id, name, demo ? 1 : 0, new Date().toISOString()); return id; },
    renameWorkspace(id, name) { run('UPDATE workspaces SET name=? WHERE id=?', name, id); },
    removeWorkspace(id) {
      db.exec('BEGIN');
      try { run('DELETE FROM audit WHERE workspace_id=?', id); run('DELETE FROM posts WHERE workspace_id=?', id); run('DELETE FROM series WHERE workspace_id=?', id); run('DELETE FROM snapshots WHERE workspace_id=?', id); run('DELETE FROM facts WHERE workspace_id=?', id); run('DELETE FROM connections WHERE workspace_id=?', id); run('DELETE FROM workspaces WHERE id=?', id); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },

    connections: (ws) => q('SELECT * FROM connections WHERE workspace_id=? ORDER BY label', ws).map((c) => ({ ...c, config: JSON.parse(c.config) })),
    connection: (id) => { const c = one('SELECT * FROM connections WHERE id=?', id); return c && { ...c, config: JSON.parse(c.config) }; },
    addConnection(ws, kind, label, config) { const id = uid('cn'); run('INSERT INTO connections (id,workspace_id,kind,label,config) VALUES (?,?,?,?,?)', id, ws, kind, label, JSON.stringify(config || {})); return id; },
    updateConnection(id, patch) {
      const c = this.connection(id); if (!c) return;
      const m = { ...c, ...patch };
      run('UPDATE connections SET label=?, config=?, status=?, last_sync=?, last_error=? WHERE id=?', m.label, JSON.stringify(m.config || {}), m.status, m.last_sync || null, m.last_error || null, id);
    },
    removeConnection(id) { run('DELETE FROM series WHERE connection_id=?', id); run('DELETE FROM snapshots WHERE connection_id=?', id); run('DELETE FROM facts WHERE connection_id=?', id); run('DELETE FROM connections WHERE id=?', id); },

    upsertFacts(ws, source, connectionId, rows) {
      const st = db.prepare(`INSERT INTO facts (workspace_id,source,connection_id,campaign_id,campaign_name,date,spend,impressions,clicks,conversions,revenue)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(workspace_id,source,campaign_id,date) DO UPDATE SET campaign_name=excluded.campaign_name, connection_id=excluded.connection_id,
          spend=excluded.spend, impressions=excluded.impressions, clicks=excluded.clicks, conversions=excluded.conversions, revenue=excluded.revenue`);
      db.exec('BEGIN');
      try {
        for (const r of rows) st.run(ws, source, connectionId, String(r.campaign_id), r.campaign_name || String(r.campaign_id), r.date, +r.spend || 0, Math.round(+r.impressions || 0), Math.round(+r.clicks || 0), +r.conversions || 0, +r.revenue || 0);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return rows.length;
    },

    upsertSeries(ws, source, connectionId, rows) {
      const st = db.prepare(`INSERT INTO series (workspace_id,source,connection_id,metric,dim,date,value) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(workspace_id,source,metric,dim,date) DO UPDATE SET value=excluded.value, connection_id=excluded.connection_id`);
      db.exec('BEGIN');
      try { for (const r of rows) st.run(ws, source, connectionId, r.metric, String(r.dim ?? ''), r.date, +r.value || 0); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
      return rows.length;
    },

    // Daily totals per metric (zero-filled), the same window one step back for comparison, and a breakdown by dimension.
    seriesSummary(ws, source, from, to) {
      const span = daysBetween(from, to) + 1, prevTo = addDays(from, -1), prevFrom = addDays(from, -span);
      const rows = q('SELECT metric, dim, date, value FROM series WHERE workspace_id=? AND source=? AND date BETWEEN ? AND ?', ws, source, prevFrom, to);
      const metrics = {}, dims = {};
      for (const r of rows) {
        const m = metrics[r.metric] || (metrics[r.metric] = { total: 0, previous: 0, byDate: new Map() });
        if (r.date >= from) { m.total += r.value; m.byDate.set(r.date, (m.byDate.get(r.date) || 0) + r.value); const d = dims[r.metric] || (dims[r.metric] = new Map()); if (r.dim) d.set(r.dim, (d.get(r.dim) || 0) + r.value); }
        else m.previous += r.value;
      }
      const out = { from, to, span, metrics: {}, dims: {} };
      for (const [k, m] of Object.entries(metrics)) {
        const daily = []; for (let i = 0; i < span; i++) { const d = addDays(from, i); daily.push({ date: d, value: m.byDate.get(d) || 0 }); }
        out.metrics[k] = { total: m.total, previous: m.previous, daily };
      }
      for (const [k, d] of Object.entries(dims)) out.dims[k] = [...d.entries()].map(([dim, total]) => ({ dim, total })).sort((a, b) => b.total - a.total);
      return out;
    },

    upsertSnapshot(ws, connectionId, key, source, name, payload) {
      run(`INSERT INTO snapshots (workspace_id,connection_id,key,source,name,fetched_at,payload) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(connection_id,key) DO UPDATE SET name=excluded.name, fetched_at=excluded.fetched_at, payload=excluded.payload`,
        ws, connectionId, key, source, name, new Date().toISOString(), JSON.stringify(payload));
    },
    snapshots: (ws, source) => q('SELECT * FROM snapshots WHERE workspace_id=?' + (source ? ' AND source=?' : '') + ' ORDER BY name', ...(source ? [ws, source] : [ws])).map((r) => ({ ...r, payload: JSON.parse(r.payload) })),
    clearSnapshots(connectionId) { run('DELETE FROM snapshots WHERE connection_id=?', connectionId); },

    // ---- ad-account changes made through Lumen (every write is logged here) ----
    addAudit(ws, e) {
      const r = run('INSERT INTO audit (ts,workspace_id,action,kind,target_id,target_name,before,after,ok,error) VALUES (?,?,?,?,?,?,?,?,?,?)',
        new Date().toISOString(), ws, e.action, e.kind || null, e.target_id || null, e.target_name || null, e.before ? JSON.stringify(e.before) : null, e.after ? JSON.stringify(e.after) : null, e.ok === false ? 0 : 1, e.error || null);
      return Number(r.lastInsertRowid);
    },
    audit: (ws, limit = 200) => q('SELECT * FROM audit WHERE workspace_id=? ORDER BY id DESC LIMIT ?', ws, limit).map(auditRow),
    auditEntry: (id) => { const r = one('SELECT * FROM audit WHERE id=?', id); return r && auditRow(r); },
    markReverted(id) { run('UPDATE audit SET reverted=1 WHERE id=?', id); },

    // ---- social posts / calendar ----
    posts: (ws) => q('SELECT * FROM posts WHERE workspace_id=? ORDER BY COALESCE(scheduled_at, created_at)', ws).map(fromRow),
    post: (id) => { const r = one('SELECT * FROM posts WHERE id=?', id); return r && fromRow(r); },
    allDuePosts: () => q("SELECT * FROM posts WHERE status='scheduled'").map(fromRow),
    savePost(ws, p) {
      const now = new Date().toISOString(), id = p.id || uid('po'), cur = p.id ? one('SELECT * FROM posts WHERE id=?', p.id) : null;
      const m = { body: '', link: '', media_path: '', media_url: '', platforms: [], scheduled_at: null, status: 'draft', results: {}, ...(cur ? fromRow(cur) : {}), ...p };
      run(`INSERT INTO posts (id,workspace_id,body,link,media_path,media_url,platforms,scheduled_at,status,results,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET body=excluded.body, link=excluded.link, media_path=excluded.media_path, media_url=excluded.media_url, platforms=excluded.platforms,
          scheduled_at=excluded.scheduled_at, status=excluded.status, results=excluded.results, updated_at=excluded.updated_at`,
        id, ws, m.body, m.link, m.media_path, m.media_url, JSON.stringify(m.platforms), m.scheduled_at, m.status, JSON.stringify(m.results), cur ? cur.created_at : now, now);
      return this.post(id);
    },
    deletePost(id) { run('DELETE FROM posts WHERE id=?', id); },

    // Everything the dashboard needs for one window, plus the window just before it for deltas.
    summary(ws, from, to, sources = AD_SOURCES) {
      const inS = ' AND source IN (' + sources.map(() => '?').join(',') + ')';
      const span = daysBetween(from, to) + 1;
      const prevTo = addDays(from, -1), prevFrom = addDays(from, -span);
      const tot = (a, b) => one(`SELECT COALESCE(SUM(spend),0) spend, COALESCE(SUM(impressions),0) impressions, COALESCE(SUM(clicks),0) clicks,
        COALESCE(SUM(conversions),0) conversions, COALESCE(SUM(revenue),0) revenue FROM facts WHERE workspace_id=? AND date BETWEEN ? AND ?${inS}`, ws, a, b, ...sources);
      const daily = q(`SELECT date, SUM(spend) spend, SUM(impressions) impressions, SUM(clicks) clicks, SUM(conversions) conversions, SUM(revenue) revenue
        FROM facts WHERE workspace_id=? AND date BETWEEN ? AND ?${inS} GROUP BY date ORDER BY date`, ws, from, to, ...sources);
      const byDate = new Map(daily.map((d) => [d.date, d]));
      const series = [];
      for (let i = 0; i < span; i++) { const d = addDays(from, i); series.push(byDate.get(d) || { date: d, spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 }); }
      const campaigns = q(`SELECT source, campaign_id, campaign_name name, SUM(spend) spend, SUM(impressions) impressions, SUM(clicks) clicks, SUM(conversions) conversions, SUM(revenue) revenue
        FROM facts WHERE workspace_id=? AND date BETWEEN ? AND ?${inS} GROUP BY source, campaign_id ORDER BY spend DESC`, ws, from, to, ...sources);
      const bySource = q(`SELECT source, SUM(spend) spend, SUM(conversions) conversions FROM facts WHERE workspace_id=? AND date BETWEEN ? AND ?${inS} GROUP BY source`, ws, from, to, ...sources);
      const last = one('SELECT MAX(date) d FROM facts WHERE workspace_id=?' + inS.replace('AND source','AND source'), ws, ...sources);
      const firstRow = one('SELECT MIN(date) d FROM facts WHERE workspace_id=?' + inS, ws, ...sources);
      return { from, to, span, current: tot(from, to), previous: tot(prevFrom, prevTo), series, campaigns, bySource, latestData: last && last.d, earliestData: firstRow && firstRow.d };
    }
  };
}

module.exports = { open, store, iso, localToday, addDays, daysBetween, AD_SOURCES };
