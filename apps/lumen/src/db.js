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
    CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
  `);
  return db;
}

const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 10);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);

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
      try { run('DELETE FROM facts WHERE workspace_id=?', id); run('DELETE FROM connections WHERE workspace_id=?', id); run('DELETE FROM workspaces WHERE id=?', id); db.exec('COMMIT'); }
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
    removeConnection(id) { run('DELETE FROM facts WHERE connection_id=?', id); run('DELETE FROM connections WHERE id=?', id); },

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

    // Everything the dashboard needs for one window, plus the window just before it for deltas.
    summary(ws, from, to) {
      const span = daysBetween(from, to) + 1;
      const prevTo = addDays(from, -1), prevFrom = addDays(from, -span);
      const tot = (a, b) => one(`SELECT COALESCE(SUM(spend),0) spend, COALESCE(SUM(impressions),0) impressions, COALESCE(SUM(clicks),0) clicks,
        COALESCE(SUM(conversions),0) conversions, COALESCE(SUM(revenue),0) revenue FROM facts WHERE workspace_id=? AND date BETWEEN ? AND ?`, ws, a, b);
      const daily = q(`SELECT date, SUM(spend) spend, SUM(impressions) impressions, SUM(clicks) clicks, SUM(conversions) conversions, SUM(revenue) revenue
        FROM facts WHERE workspace_id=? AND date BETWEEN ? AND ? GROUP BY date ORDER BY date`, ws, from, to);
      const byDate = new Map(daily.map((d) => [d.date, d]));
      const series = [];
      for (let i = 0; i < span; i++) { const d = addDays(from, i); series.push(byDate.get(d) || { date: d, spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 }); }
      const campaigns = q(`SELECT source, campaign_id, campaign_name name, SUM(spend) spend, SUM(impressions) impressions, SUM(clicks) clicks, SUM(conversions) conversions, SUM(revenue) revenue
        FROM facts WHERE workspace_id=? AND date BETWEEN ? AND ? GROUP BY source, campaign_id ORDER BY spend DESC`, ws, from, to);
      const bySource = q(`SELECT source, SUM(spend) spend, SUM(conversions) conversions FROM facts WHERE workspace_id=? AND date BETWEEN ? AND ? GROUP BY source`, ws, from, to);
      const last = one('SELECT MAX(date) d FROM facts WHERE workspace_id=?', ws);
      return { from, to, span, current: tot(from, to), previous: tot(prevFrom, prevTo), series, campaigns, bySource, latestData: last && last.d };
    }
  };
}

module.exports = { open, store, iso, addDays, daysBetween };
