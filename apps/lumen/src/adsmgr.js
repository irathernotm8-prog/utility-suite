// The rules around changing a live ad account. Lumen's promises:
//  - nothing is created active; turning something on is a separate, explicitly confirmed step
//  - a daily-budget ceiling (Settings) that Lumen refuses to exceed, which also catches typos
//  - every change is logged with what it was before, so it can be undone
const TTL_MS = 60 * 1000;
const STATUSES = ['ACTIVE', 'PAUSED', 'ARCHIVED'];

function makeAds({ S, cfgFor, api, readMedia, getCap, now = Date.now }) {
  const cache = new Map();
  const cap = () => { const c = +getCap(); return c > 0 ? c : 500; };

  async function tree(ws, range, force) {
    const key = range.since + '|' + range.until, hit = cache.get(ws);
    if (!force && hit && hit.key === key && now() - hit.at < TTL_MS) return hit.tree;
    const t = await api.fetchTree(cfgFor(ws), range);
    cache.set(ws, { key, at: now(), tree: t }); return t;
  }
  const find = (ws, id) => {
    const t = (cache.get(ws) || {}).tree; if (!t) throw new Error('Refresh the list and try again.');
    const n = [...t.campaigns, ...t.adsets, ...t.ads].find((x) => x.id === id);
    if (!n) throw new Error('That item is no longer in the list. Refresh and try again.');
    return { node: n, currency: t.account.currency };
  };
  const overCap = (v) => { if (v > cap()) throw new Error(`That is above your Lumen daily budget limit of ${cap()}. Raise the limit in Settings if you really mean it.`); };

  async function change(ws, id, patch, opts = {}) {
    const { node, currency } = find(ws, id);
    const p = {};
    if (patch.status !== undefined) {
      if (!STATUSES.includes(patch.status)) throw new Error('Unknown status.');
      if (patch.status === 'ACTIVE' && !opts.confirmedActivate) throw new Error('Turning something on needs your confirmation.');
      p.status = patch.status;
    }
    if (patch.name !== undefined) { const n = String(patch.name).trim(); if (!n || n.length > 400) throw new Error('Enter a name (up to 400 characters).'); p.name = n; }
    if (patch.dailyBudget !== undefined) {
      const v = +patch.dailyBudget; if (!(v > 0)) throw new Error('Enter a budget above zero.');
      if (node.dailyBudget === null || node.dailyBudget === undefined) throw new Error('This item has no daily budget of its own (it uses a lifetime budget, or the budget is set on its campaign).');
      overCap(v); p.dailyBudget = Math.round(v * 100) / 100;
    }
    if (patch.endTime !== undefined) {
      if (node.kind === 'ad') throw new Error('Ads inherit their schedule from the ad set.');
      if (patch.endTime && !(Date.parse(patch.endTime) > now())) throw new Error('The end time must be in the future.');
      p.endTime = patch.endTime || null;
    }
    if (!Object.keys(p).length) throw new Error('Nothing to change.');
    const before = {}; for (const k of Object.keys(p)) before[k] = k === 'status' ? node.status : node[k] === undefined ? null : node[k];
    const e = { action: opts.action || 'update', kind: node.kind, target_id: id, target_name: node.name, before };
    try {
      const r = await api.update(cfgFor(ws), id, node.kind, p, currency);
      Object.assign(node, { name: r.name || node.name, status: r.status || node.status, effective: r.effective || node.effective, dailyBudget: r.dailyBudget === null ? node.dailyBudget : r.dailyBudget, endTime: r.endTime });
      S.addAudit(ws, { ...e, after: p }); return node;
    } catch (err) { S.addAudit(ws, { ...e, after: p, ok: false, error: err.message }); throw err; }
  }

  async function copy(ws, id) {
    const { node } = find(ws, id); if (node.kind !== 'campaign') throw new Error('Only campaigns can be duplicated.');
    const e = { action: 'copy', kind: 'campaign', target_id: id, target_name: node.name };
    try { const r = await api.copyCampaign(cfgFor(ws), id); cache.delete(ws); S.addAudit(ws, { ...e, after: { newId: r.id, status: 'PAUSED' } }); return r; }
    catch (err) { S.addAudit(ws, { ...e, ok: false, error: err.message }); throw err; }
  }

  async function create(ws, spec) {
    overCap(+spec.dailyBudget);
    const t = cache.get(ws), currency = (t && t.tree.account.currency) || spec.currency || 'USD';
    const e = { action: 'create', kind: 'campaign', target_name: spec.name, before: null };
    try {
      const made = await api.createCampaign(cfgFor(ws), { ...spec, creative: { ...spec.creative } }, currency, readMedia);
      cache.delete(ws); S.addAudit(ws, { ...e, target_id: made.campaignId, after: { ...made, status: 'PAUSED', dailyBudget: +spec.dailyBudget } }); return made;
    } catch (err) {
      const c = err.created || {}, have = Object.keys(c).length;
      S.addAudit(ws, { ...e, target_id: c.campaignId, after: c, ok: false, error: err.message });
      if (have) err.message += ` (Created so far, all paused: ${Object.entries(c).map(([k, v]) => `${k.replace('Id', '')} ${v}`).join(', ')}. Archive the campaign from the Ads tab to clean up.)`;
      throw err;
    }
  }

  async function revert(ws, auditId, opts = {}) {
    const e = S.auditEntry(auditId);
    if (!e || e.workspace_id !== ws || e.action !== 'update' || !e.ok || !e.before) throw new Error('This change cannot be undone automatically.');
    if (e.reverted) throw new Error('This change was already undone.');
    if (!cache.get(ws)) throw new Error('Refresh the list and try again.');
    const r = await change(ws, e.target_id, e.before, { ...opts, action: 'revert' });
    S.markReverted(auditId); return r;
  }

  return { tree, change, copy, create, revert, geo: (ws, q) => api.geoSearch(cfgFor(ws), q), audit: (ws) => S.audit(ws), cap, _cache: cache };
}

module.exports = { makeAds, STATUSES };
