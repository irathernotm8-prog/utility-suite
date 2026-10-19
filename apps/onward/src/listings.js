// Onward — job listings without a visible browser.
// LinkedIn: its public job-search pages (the ones shown to signed-out visitors) are small HTML fragments
// we fetch and parse here. Indeed: loaded in a hidden tab in the renderer (it needs a real browser),
// see renderer/discover.js. Results are compact objects, so they're cheap to show and cheap for AI to read.

const LI_BASE = process.env.ONWARD_LINKEDIN_BASE || 'https://www.linkedin.com';

// ---------- tiny HTML helpers (no DOM in the main process) ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·' };
const decode = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isNaN(n) ? m : String.fromCodePoint(n); }
  return ENT[e.toLowerCase()] ?? m;
});
const squash = (s) => decode(String(s || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Inner HTML of the first element whose class list contains cls (handles nesting of the same tag)
function inner(html, cls, from = 0) {
  const re = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bclass="[^"]*(?<![\\w-])${cls.replace(/[-]/g, '\\-')}(?![\\w-])[^"]*"[^>]*>`, 'i');
  const m = re.exec(html.slice(from));
  if (!m) return null;
  const tag = m[1].toLowerCase();
  const start = from + m.index + m[0].length;
  if (/^(img|br|input|meta|link|hr)$/.test(tag)) return '';
  const open = new RegExp(`<${tag}\\b`, 'gi'), close = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 1, pos = start;
  while (depth > 0) {
    open.lastIndex = pos; close.lastIndex = pos;
    const o = open.exec(html), c = close.exec(html);
    if (!c) return html.slice(start);
    if (o && o.index < c.index) { depth++; pos = o.index + 1; }
    else { depth--; pos = c.index + c[0].length; if (depth === 0) return html.slice(start, c.index); }
  }
  return null;
}
function allInner(html, cls) {
  const out = [];
  const re = new RegExp(`class="[^"]*(?<![\\w-])${cls.replace(/[-]/g, '\\-')}(?![\\w-])[^"]*"`, 'gi');
  let m;
  while ((m = re.exec(html))) {
    const tagStart = html.lastIndexOf('<', m.index);
    const x = inner(html, cls, tagStart);
    if (x !== null) out.push(x);
    re.lastIndex = m.index + 10;
  }
  return out;
}
const attr = (html, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(html || ''); return m ? decode(m[1]) : ''; };
const tagWithClass = (html, cls) => { const m = new RegExp(`<[a-z0-9]+\\b[^>]*class="[^"]*(?<![\\w-])${cls}(?![\\w-])[^"]*"[^>]*>`, 'i').exec(html || ''); return m ? m[0] : ''; };

// Rich text → readable plain text with paragraphs and bullets
function htmlToText(html) {
  return decode(String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|ul|ol|section)>/gi, '\n\n')
    .replace(/<(strong|b)>/gi, '').replace(/<\/(strong|b)>/gi, '')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- LinkedIn ----------
const TPR = { day: 'r86400', week: 'r604800', month: 'r2592000' };
const WT = { onsite: '1', remote: '2', hybrid: '3' };
const EXP = { internship: '1', entry: '2', associate: '3', mid: '4', director: '5', executive: '6' };
const JT = { 'full-time': 'F', 'part-time': 'P', contract: 'C', temporary: 'T', internship: 'I' };

function linkedinSearchUrl(q = {}, start = 0) {
  const u = new URL(LI_BASE + '/jobs-guest/jobs/api/seeMoreJobPostings/search');
  u.searchParams.set('keywords', q.keywords || '');
  if (q.location) u.searchParams.set('location', q.location);
  if (TPR[q.posted]) u.searchParams.set('f_TPR', TPR[q.posted]);
  const wt = (q.workplace || []).map(w => WT[String(w).toLowerCase().replace(/[^a-z]/g, '')]).filter(Boolean);
  if (wt.length) u.searchParams.set('f_WT', wt.join(','));
  const ex = (q.experience || []).map(e => EXP[e]).filter(Boolean);
  if (ex.length) u.searchParams.set('f_E', ex.join(','));
  const jt = (q.jobTypes || []).map(t => JT[String(t).toLowerCase()]).filter(Boolean);
  if (jt.length) u.searchParams.set('f_JT', jt.join(','));
  if (q.easyApply) u.searchParams.set('f_AL', 'true');
  if (q.sort === 'recent') u.searchParams.set('sortBy', 'DD');
  u.searchParams.set('start', String(start));
  return u.toString();
}

function parseLinkedinSearch(html) {
  const out = [];
  for (const chunk of String(html || '').split(/<li\b[^>]*>/i).slice(1)) {
    const urn = /data-entity-urn="urn:li:jobPosting:(\d+)"/.exec(chunk) || /jobPosting:(\d+)/.exec(chunk);
    if (!urn) continue;
    const link = attr(tagWithClass(chunk, 'base-card__full-link'), 'href') || '';
    const companyHtml = inner(chunk, 'base-search-card__subtitle') || '';
    const time = /<time[^>]*datetime="([^"]+)"[^>]*>([\s\S]*?)<\/time>/i.exec(chunk);
    const benefits = allInner(chunk, 'job-posting-benefits__text').map(squash).filter(Boolean);
    const salary = squash(inner(chunk, 'job-search-card__salary-info'));
    out.push({
      source: 'LinkedIn',
      id: 'li:' + urn[1],
      listingId: urn[1],
      title: squash(inner(chunk, 'base-search-card__title')),
      company: squash(companyHtml),
      companyUrl: attr(companyHtml, 'href').replace(/\?.*$/, ''),
      location: squash(inner(chunk, 'job-search-card__location')),
      postedAt: time ? squash(time[2]) : '',
      postedDate: time ? time[1] : '',
      pay: salary ? { text: salary } : null,
      logo: attr(tagWithClass(chunk, 'artdeco-entity-image'), 'data-delayed-url'),
      url: `https://www.linkedin.com/jobs/view/${urn[1]}/`,
      href: link.replace(/\?.*$/, ''),
      badges: benefits,
      isNew: /job-search-card__listdate--new/.test(chunk)
    });
  }
  return out;
}

function linkedinDetailUrl(id) { return `${LI_BASE}/jobs-guest/jobs/api/jobPosting/${id}`; }

function parseLinkedinDetail(html, id) {
  html = String(html || '');
  const criteria = {};
  for (const item of allInner(html, 'description__job-criteria-item')) {
    const k = squash(inner(item, 'description__job-criteria-subheader'));
    const v = squash(inner(item, 'description__job-criteria-text'));
    if (k) criteria[k.toLowerCase()] = v;
  }
  const descHtml = inner(html, 'show-more-less-html__markup') || inner(html, 'description__text') || '';
  const description = htmlToText(descHtml);
  const orgLink = tagWithClass(html, 'topcard__org-name-link');
  const flavor = allInner(html, 'topcard__flavor--bullet').map(squash).filter(Boolean);
  const offsite = /apply-link-offsite|offsite-apply-icon/.test(html);
  const easy = !offsite && /apply-link-onsite|apply-button--default/.test(html);
  const pay = squash(inner(html, 'compensation__salary')) || squash(inner(html, 'salary'));
  // "Meet the hiring team" (shown on some postings)
  const contacts = [];
  const team = inner(html, 'message-the-recruiter') || inner(html, 'hiring-team') || '';
  if (team) {
    const name = squash(inner(team, 'base-main-card__title'));
    if (name) contacts.push({ name, title: squash(inner(team, 'base-main-card__subtitle')), linkedin: (attr(tagWithClass(team, 'base-card__full-link'), 'href') || (/href="([^"]*\/in\/[^"]*)"/.exec(team) || [])[1] || '').replace(/\?.*$/, ''), source: 'LinkedIn hiring team', role: 'Hiring team' });
  }
  contacts.push(...contactsFromText(description));
  return {
    source: 'LinkedIn',
    id: 'li:' + id,
    listingId: String(id),
    title: squash(inner(html, 'top-card-layout__title')) || squash(inner(html, 'topcard__title')),
    company: squash(orgLink ? inner(html, 'topcard__org-name-link') : ''),
    companyUrl: attr(orgLink, 'href').replace(/\?.*$/, ''),
    location: flavor.find(f => !/applicant|ago|over \d/i.test(f)) || '',
    postedAt: squash(inner(html, 'posted-time-ago__text')),
    applicants: squash(inner(html, 'num-applicants__caption')),
    pay: pay ? { text: pay } : null,
    seniority: criteria['seniority level'] || '',
    employmentType: criteria['employment type'] || '',
    jobFunction: criteria['job function'] || '',
    industry: criteria['industries'] || '',
    description,
    applyType: offsite ? 'offsite' : easy ? 'easy' : '',
    url: `https://www.linkedin.com/jobs/view/${id}/`,
    logo: attr(tagWithClass(html, 'artdeco-entity-image'), 'data-delayed-url'),
    contacts
  };
}

// Emails / named contacts mentioned in a posting ("Reporting To: Jane Doe", "send resumes to …")
function contactsFromText(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text || '').matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) {
    const email = m[0].replace(/[.,;:]+$/, '');
    if (seen.has(email) || /noreply|no-reply|donotreply|privacy|accommodat|example\.com/i.test(email)) continue;
    seen.add(email);
    out.push({ name: '', email, source: 'Job posting', role: 'Email in posting' });
  }
  for (const m of String(text || '').matchAll(/(?:[Rr]eport(?:s|ing)? (?:[Dd]irectly )?[Tt]o|[Hh]iring [Mm]anager|[Rr]ecruiter|[Cc]ontact)\s*[:\-–]\s*([A-Z][a-zA-Z'’-]+(?: [A-Z][a-zA-Z'’-]+){1,2})/g)) {
    const name = m[1].trim().replace(/ (Contact|Send|Apply|Email|Phone|Location|Department|Description)$/, '');
    if (seen.has(name) || /^(The|Our|Director|Vice|Chief|Head|Senior|Manager)\b/.test(name)) continue;
    seen.add(name);
    out.push({ name, source: 'Job posting', role: /report/i.test(m[0]) ? 'Hiring manager (reports to)' : 'Mentioned in posting' });
  }
  return out;
}

// Workplace hint from the location/title/description
function guessWorkplace(x) {
  const s = `${x.location || ''} ${x.title || ''}`.toLowerCase();
  if (/\bremote\b/.test(s)) return 'Remote';
  if (/\bhybrid\b/.test(s)) return 'Hybrid';
  if (/on-?site/.test(s)) return 'On-site';
  const d = String(x.description || '').toLowerCase();
  if (/\bfully remote\b|\b100% remote\b/.test(d)) return 'Remote';
  if (/\bhybrid\b/.test(d)) return 'Hybrid';
  return '';
}

// Experience asked for, from the description ("5+ years in project management")
function guessExperience(text) {
  const t = String(text || '');
  for (const m of t.matchAll(/(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*)?\+?\s*years?\b/gi)) {
    const before = t.slice(Math.max(0, m.index - 14), m.index).toLowerCase();
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 40).toLowerCase();
    if (/(nearly|over|than|almost|about|for|past|last)\s*$/.test(before)) continue;
    if (/^\s*(ago|old|of (history|service|business)|in business)/.test(after)) continue;
    if (Number(m[1]) > 15) continue;
    if (!/experience|in |of |managing|leading|working|with /.test(after.slice(0, 30))) continue;
    return m[2] ? `${m[1]}–${m[2]} years` : `${m[1]}+ years`;
  }
  return '';
}

// Quick, token-free match between a posting and the user's resume
const STOP = new Set('a an and are as at be by for from has have in is it its of on or our the to we will with you your this that these those who what when where how all any can may must should able including include etc per via within across about into over under such other more most new well work working team teams role job position company candidate candidates experience years year strong excellent ability skills skill knowledge preferred required requirements responsibilities qualifications plus bonus opportunity business support help using use based'.split(' '));
function matchScore(description, resumeText) {
  const words = (s) => (String(s || '').toLowerCase().match(/[a-z][a-z0-9+#./-]{1,30}/g) || []).map(w => w.replace(/[./-]+$/, '')).filter(w => w.length > 2 && !STOP.has(w));
  const res = new Set(words(resumeText));
  if (!res.size || !description) return null;
  const freq = new Map();
  for (const w of words(description)) freq.set(w, (freq.get(w) || 0) + 1);
  const terms = [...freq.entries()].filter(([w, n]) => n >= 2 || /[A-Z]{2,}|\d/.test(w) || w.length >= 6).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([w]) => w);
  if (!terms.length) return null;
  const hit = terms.filter(t => res.has(t));
  return { score: Math.round((hit.length / terms.length) * 100), matched: hit.slice(0, 12), missing: terms.filter(t => !res.has(t)).slice(0, 10) };
}

module.exports = { linkedinSearchUrl, parseLinkedinSearch, linkedinDetailUrl, parseLinkedinDetail, contactsFromText, guessWorkplace, guessExperience, matchScore, htmlToText, squash };
