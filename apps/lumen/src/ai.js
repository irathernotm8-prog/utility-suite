// "Ask Lumen" — answers questions about the numbers on screen using your own Anthropic key.
// Read-only for now: it sees a compact summary of the selected window and can't change anything.
const API = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5-5';

function compact(s) {
  const r = (n, d = 2) => +(+n).toFixed(d);
  const t = (x) => ({ spend: r(x.spend), impressions: x.impressions, clicks: x.clicks, conversions: r(x.conversions, 1), ctr_pct: x.impressions ? r(x.clicks / x.impressions * 100) : 0, cost_per_conversion: x.conversions ? r(x.spend / x.conversions) : null });
  return {
    window: { from: s.from, to: s.to, days: s.span },
    totals: t(s.current), previous_period: t(s.previous),
    campaigns: s.campaigns.slice(0, 40).map((c) => ({ name: c.name, source: c.source, ...t(c) })),
    daily: s.series.map((d) => ({ date: d.date, spend: r(d.spend), conversions: r(d.conversions, 1) }))
  };
}

async function ask({ key, model, question, history = [], summary, workspace }, fetchImpl = fetch) {
  if (!key) throw new Error('Add an Anthropic API key in Settings first.');
  const system = [
    'You are Lumen, an analytics assistant inside a personal ads dashboard.',
    'Answer only from the data below. If the data cannot answer the question, say so plainly instead of guessing.',
    'Be concise. Show your numbers. Say when a sample is small or a comparison is shaky.',
    'You are read-only: you cannot change campaigns or budgets, only advise.',
    `Workspace: ${workspace}.`, '', 'DATA (JSON):', JSON.stringify(compact(summary))
  ].join('\n');
  const messages = [...history.slice(-10).map((m) => ({ role: m.role, content: String(m.text || '') })), { role: 'user', content: question }];
  const res = await fetchImpl(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: model || DEFAULT_MODEL, max_tokens: 1200, system, messages })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || `Anthropic returned HTTP ${res.status}`);
  return (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

module.exports = { ask, compact, DEFAULT_MODEL };
