// Salesforce — runs the reports you choose and keeps their latest results as tables.
// Auth is the OAuth client-credentials flow: create an External Client App (or Connected App) with that flow on, and pick a "run as" user.
// Dashboards are built from reports, so point Lumen at the reports behind the dashboard you care about.
const text = (s) => String(s ?? '').trim();
const inst = (cfg) => text(cfg.instanceUrl).replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://');

async function json(url, opts, fetchImpl) {
  const res = await fetchImpl(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = Array.isArray(body) ? body[0] : body;
    throw new Error(`Salesforce: ${(e && (e.message || e.error_description || e.error)) || 'HTTP ' + res.status}`);
  }
  return body;
}

async function login(cfg, fetchImpl) {
  if (!cfg.instanceUrl || !cfg.clientId || !cfg.clientSecret) throw new Error('Enter the instance URL, client ID and client secret.');
  const t = await json(`${inst(cfg)}/services/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: text(cfg.clientId), client_secret: text(cfg.clientSecret) }).toString() }, fetchImpl);
  const base = (t.instance_url || inst(cfg)).replace(/\/+$/, '');
  const versions = await json(`${base}/services/data/`, { headers: { authorization: 'Bearer ' + t.access_token } }, fetchImpl);
  const latest = (Array.isArray(versions) ? versions : []).map((v) => v.version).sort((a, b) => parseFloat(a) - parseFloat(b)).pop() || '60.0';
  return { base, token: t.access_token, api: `${base}/services/data/v${latest}` };
}

// Tabular reports give detail rows; summary reports give one row per grouping with its aggregates.
function toTable(rep) {
  const meta = rep.reportMetadata || {}, ext = rep.reportExtendedMetadata || {}, fm = rep.factMap || {};
  const cap = 200;
  const aggCols = (meta.aggregates || []).map((a) => (ext.aggregateColumnInfo && ext.aggregateColumnInfo[a] && ext.aggregateColumnInfo[a].label) || a);
  const grand = fm['T!T'] || {};
  const headline = (grand.aggregates || []).map((a, i) => ({ label: aggCols[i] || 'Value', value: a.label }));
  const groups = rep.groupingsDown && rep.groupingsDown.groupings;
  if (groups && groups.length) {
    const gl = (meta.groupingsDown && meta.groupingsDown[0] && ext.groupingColumnInfo && ext.groupingColumnInfo[meta.groupingsDown[0].name] && ext.groupingColumnInfo[meta.groupingsDown[0].name].label) || 'Group';
    const rows = groups.map((g) => [g.label, ...(((fm[g.key + '!T'] || {}).aggregates) || []).map((a) => a.label)]);
    return { columns: [gl, ...aggCols], rows: rows.slice(0, cap), truncated: rows.length > cap, headline };
  }
  const cols = (meta.detailColumns || []).map((c) => (ext.detailColumnInfo && ext.detailColumnInfo[c] && ext.detailColumnInfo[c].label) || c);
  const rows = ((grand.rows) || []).map((r) => r.dataCells.map((c) => c.label ?? c.value));
  return { columns: cols, rows: rows.slice(0, cap), truncated: rows.length > cap || rep.allData === false, headline };
}

module.exports = {
  kind: 'salesforce', name: 'Salesforce reports', category: 'crm', status: 'ready',
  fields: [
    { key: 'instanceUrl', label: 'Instance URL', placeholder: 'https://yourcompany.my.salesforce.com' },
    { key: 'clientId', label: 'Consumer key (client ID)', placeholder: '' },
    { key: 'clientSecret', label: 'Consumer secret', secret: true, placeholder: '' },
    { key: 'reportIds', label: 'Report IDs (comma separated)', placeholder: 'From each report’s URL: …/Report/00O…/view' }
  ],
  async test(cfg, fetchImpl = fetch) {
    const s = await login(cfg, fetchImpl);
    return { ok: true, detail: `Signed in · API ${s.api.split('/').pop()}` };
  },
  async sync(cfg, _range, fetchImpl = fetch) {
    const ids = text(cfg.reportIds).split(/[\s,]+/).filter(Boolean);
    if (!ids.length) throw new Error('Add at least one report ID to pull.');
    const s = await login(cfg, fetchImpl), snapshots = [], problems = [];
    for (const id of ids) {
      try {
        const rep = await json(`${s.api}/analytics/reports/${encodeURIComponent(id)}?includeDetails=true`, { headers: { authorization: 'Bearer ' + s.token } }, fetchImpl);
        snapshots.push({ key: id, name: (rep.reportMetadata && rep.reportMetadata.name) || id, payload: toTable(rep) });
      } catch (e) { problems.push(`${id}: ${e.message}`); }
    }
    if (!snapshots.length) throw new Error(problems.join('; '));
    return { snapshots, warning: problems.length ? problems.join('; ') : undefined };
  },
  _test: { toTable, inst }
};
