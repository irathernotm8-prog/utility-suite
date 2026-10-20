// Demo data so every screen has something real-looking before any account is connected.
// Deterministic (seeded) so the numbers don't jump around between syncs.
const { addDays, iso } = require('../db');

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const CAMPAIGNS = [
  { id: 'demo_1', name: 'Neighborhood Referral: $100 Credit', base: 46, ctr: 0.021, cvr: 0.062, value: 0 },
  { id: 'demo_2', name: 'Door Knocker Follow-up', base: 28, ctr: 0.017, cvr: 0.044, value: 0 },
  { id: 'demo_3', name: 'Always-on Brand Awareness', base: 62, ctr: 0.008, cvr: 0.008, value: 0 },
  { id: 'demo_4', name: 'Website Visitors Retargeting', base: 22, ctr: 0.034, cvr: 0.071, value: 0 },
  { id: 'demo_5', name: 'Fall Install Promo', base: 38, ctr: 0.019, cvr: 0.038, value: 0 }
];

function generate({ days = 90, end = iso(new Date()) } = {}) {
  const rows = [];
  CAMPAIGNS.forEach((c, ci) => {
    const r = rng(1000 + ci * 77);
    for (let i = days - 1; i >= 0; i--) {
      const date = addDays(end, -i);
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      const weekend = dow === 0 || dow === 6 ? 0.8 : 1;
      const trend = 1 + (days - i) / days * 0.25;
      const spend = Math.max(0, c.base * weekend * trend * (0.85 + r() * 0.3));
      const cpm = 9 + r() * 5 + ci;
      const impressions = Math.round((spend / cpm) * 1000);
      const clicks = Math.round(impressions * c.ctr * (0.85 + r() * 0.3));
      const conversions = Math.round(clicks * c.cvr * (0.7 + r() * 0.6));
      rows.push({ campaign_id: c.id, campaign_name: c.name, date, spend: +spend.toFixed(2), impressions, clicks, conversions, revenue: 0 });
    }
  });
  return rows;
}

module.exports = {
  kind: 'demo', name: 'Demo data', status: 'ready', fields: [],
  async test() { return { ok: true, detail: 'Generated locally.' }; },
  async sync() { return generate(); },
  generate
};
