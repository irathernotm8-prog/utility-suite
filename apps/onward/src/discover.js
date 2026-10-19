// Onward — Discover: search job listings inside the app.
// LinkedIn's public listing pages are fetched and parsed here; Indeed runs in a hidden tab in the
// window (it needs a real browser) and is reached through rpc().
const { session, ipcMain } = require('electron');
const L = require('./listings');
const D = require('./data');
const { IDENTITIES } = require('./identity');

let rpcSend = null, ensureUi = async () => {};
const pending = new Map();
let seq = 0;
function init({ send, ensureWindow }) { rpcSend = send; ensureUi = ensureWindow || ensureUi; }
ipcMain.handle('rpc:reply', (_e, { id, result, error }) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  error ? p.reject(new Error(error)) : p.resolve(result);
});
async function rpc(method, args, timeout = 60000) {
  await ensureUi();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    rpcSend('rpc', { id, method, args });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('Onward took too long — is the window open?')); } }, timeout);
  });
}

function guest() {
  const ses = session.fromPartition('onward-guest');
  if (!ses.__onward) { ses.__onward = true; ses.setUserAgent(IDENTITIES.chrome.ua); }
  return ses;
}

const cache = new Map(); // listing id -> detail
async function fetchText(url) {
  const res = await guest().fetch(url, { headers: { 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html,*/*' }, credentials: 'omit' });
  if (res.status === 429) throw new Error('LinkedIn is rate-limiting searches for a minute. Try again shortly.');
  if (!res.ok) throw new Error(`LinkedIn returned ${res.status}`);
  return res.text();
}

// q: { keywords, location, posted, workplace[], easyApply, experience[], jobTypes[], sort, sources[], page }
async function search(q = {}) {
  const sources = q.sources?.length ? q.sources : ['linkedin'];
  const page = Number(q.page || 0);
  const out = { results: [], errors: [] };
  const tasks = [];
  if (sources.includes('linkedin')) tasks.push((async () => {
    // two pages of LinkedIn per "page" (10 each)
    for (const start of [page * 20, page * 20 + 10]) {
      try {
        const html = await fetchText(L.linkedinSearchUrl(q, start));
        const items = L.parseLinkedinSearch(html);
        out.results.push(...items);
        if (items.length < 10) break;
      } catch (e) { out.errors.push({ source: 'LinkedIn', message: e.message }); break; }
    }
  })());
  if (sources.includes('indeed')) tasks.push(rpc('indeed:search', { ...q, page }).then(r => {
    if (r.blocked) out.errors.push({ source: 'Indeed', message: 'Indeed wants a quick “are you human” check — open Indeed in the Browser tab once, then search again.', blocked: true });
    else if (r.empty) out.errors.push({ source: 'Indeed', message: 'No Indeed results came back. Open Indeed in the Browser tab once (and sign in if asked), then search again.', blocked: true });
    out.results.push(...(r.results || []));
  }).catch(e => out.errors.push({ source: 'Indeed', message: e.message })));
  await Promise.all(tasks);
  // de-dupe, mark what's already on the board
  const seen = new Set();
  out.results = out.results.filter(r => !seen.has(r.id) && seen.add(r.id)).map(r => ({ ...r, saved: savedId(r) }));
  D.store.discover.last = { q, at: D.now() };
  const key = [q.keywords, q.location].filter(Boolean).join(' · ');
  if (key) D.store.discover.recent = [{ ...q, page: 0, label: key }, ...(D.store.discover.recent || []).filter(x => [x.keywords, x.location].filter(Boolean).join(' · ') !== key)].slice(0, 8);
  D.save('discover');
  return out;
}

function savedId(r) {
  const j = D.store.jobs.find(j => (j.listingId && j.listingId === r.listingId) || (j.url && D.normUrl(j.url) === D.normUrl(r.url)));
  return j ? j.id : null;
}

async function detail(id) {
  if (cache.has(id)) return { ...cache.get(id), saved: savedId(cache.get(id)) };
  let d;
  if (id.startsWith('li:')) {
    const n = id.slice(3);
    d = L.parseLinkedinDetail(await fetchText(L.linkedinDetailUrl(n)), n);
  } else if (id.startsWith('in:')) {
    d = await rpc('indeed:detail', { jk: id.slice(3) });
    if (d?.blocked) throw new Error('Indeed wants a quick “are you human” check — open the job in the Browser tab.');
    d.contacts = [...(d.contacts || []), ...L.contactsFromText(d.description)];
  } else throw new Error('Unknown listing ' + id);
  d.workplace = d.workplace || L.guessWorkplace(d);
  d.experience = d.experience || L.guessExperience(d.description);
  d.match = L.matchScore(d.description, D.store.baseResume?.text || '');
  cache.set(id, d);
  return { ...d, saved: savedId(d) };
}

// Save a listing to the board (with its description, apply type and any contacts)
async function save(id, extra = {}) {
  const d = await detail(id);
  const { job, created } = D.saveJob({
    title: d.title, company: d.company, url: d.url, source: d.source, listingId: d.listingId, logo: d.logo,
    location: d.location, workplace: d.workplace, employmentType: d.employmentType, pay: d.pay || undefined,
    experience: d.experience, seniority: d.seniority, industry: d.industry, jobFunction: d.jobFunction,
    applicants: d.applicants, postedAt: d.postedAt, description: d.description, applyType: d.applyType, applyUrl: d.applyUrl,
    summary: d.description ? d.description.replace(/\s+/g, ' ').slice(0, 280) + (d.description.length > 280 ? '…' : '') : '',
    companyInfo: { linkedin: d.companyUrl || undefined, about: d.companyAbout || undefined },
    fit: d.match ? { keywordMatch: d.match.score, matched: d.match.matched, missing: d.match.missing } : undefined,
    contacts: d.contacts || [], by: extra.by || 'discover'
  });
  return { job, created };
}

module.exports = { init, rpc, search, detail, save };
