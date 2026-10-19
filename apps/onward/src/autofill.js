// Onward — local autofill. Matches form fields (by their label) to the user's profile.
// Runs entirely on this computer: no AI, no tokens. Anything it can't answer is left for the user
// (or for "Ask AI" in the Apply Guide).

const US_STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };

const yesNo = (v) => {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  if (/^(no|n|false|not\b|none|never)/.test(s) || /\bnot (authorized|eligible)\b/.test(s)) return 'No';
  if (/^(yes|y|true|authorized|eligible|citizen|us citizen|green card|permanent resident|open|willing)/.test(s)) return 'Yes';
  return '';
};

// Values derived from the profile
function profileValues(p = {}, ctx = {}) {
  const parts = String(p.name || '').trim().split(/\s+/).filter(Boolean);
  const first = parts[0] || '', last = parts.length > 1 ? parts[parts.length - 1] : '';
  const state = p.state || '';
  return {
    firstName: first, lastName: last, name: p.name || '',
    email: p.email || '', phone: p.phone || '',
    street: p.street || '', city: p.city || '', state, stateFull: US_STATES[state.toUpperCase()] || state, zip: p.zip || '',
    country: p.country || '', location: p.location || [p.city, p.state].filter(Boolean).join(', '),
    linkedin: p.links?.linkedin || '', github: p.links?.github || '', website: p.links?.portfolio || p.links?.website || '',
    currentTitle: p.currentTitle || p.headline || '', currentCompany: p.currentCompany || '',
    yearsExperience: p.yearsExperience || '', salary: p.salaryExpectation || '', notice: p.noticePeriod || '',
    education: p.highestEducation || '',
    workAuth: yesNo(p.workAuthorization), sponsorship: yesNo(p.needsSponsorship), relocate: yesNo(p.willingToRelocate) || (p.willingToRelocate ? 'Yes' : ''),
    howHeard: p.howHeard || ctx.source || '',
    eeo: p.eeo || 'decline'
  };
}

// label pattern → value key (first match wins). "skip" means never fill.
const RULES = [
  [/password|passcode|\bpin\b|security (question|answer)|social security|\bssn\b|date of birth|birth ?date|\bdob\b|credit card|card number|bank/, 'skip'],
  [/middle (name|initial)/, 'skip'],
  [/pronoun/, 'skip'],
  [/first ?name|given name|legal first|\bfname\b|forename/, 'firstName'],
  [/last ?name|surname|family name|legal last|\blname\b/, 'lastName'],
  [/preferred (first )?name|nick ?name|known as/, 'firstName'],
  [/full name|^name\b|your name|legal name|^name \*?$|candidate name/, 'name'],
  [/e-?mail/, 'email'],
  [/phone|mobile|cell|telephone/, 'phone'],
  [/linked ?in/, 'linkedin'],
  [/github/, 'github'],
  [/portfolio|personal (web)?site|website|web site|blog|other (url|link)|^url$/, 'website'],
  [/address (line )?(1|one)|street|^address\b|mailing address|home address/, 'street'],
  [/address (line )?(2|two)|\bapt\b|\bsuite\b|\bunit\b/, 'skip'],
  [/\bcity\b|town/, 'city'],
  [/\bstate\b|province|region/, 'state'],
  [/zip|postal|post code/, 'zip'],
  [/country(?! code)/, 'country'],
  [/(current|present|most recent) (job )?(title|position|role)|^job title|^title$/, 'currentTitle'],
  [/(current|present|most recent) (company|employer)|^employer|company name/, 'currentCompany'],
  [/years? of (relevant |professional )?experience|how many years|experience \(years\)|total experience/, 'yearsExperience'],
  [/salary|compensation|pay (expectation|requirement)|desired pay|expected pay|rate expectation/, 'salary'],
  [/notice period|start date|available to start|when can you start|earliest start|availability/, 'notice'],
  [/highest (level of )?education|degree level|education level/, 'education'],
  [/(legally )?(authori[sz]ed|eligible|permitted) to work|right to work|work authori[sz]ation|employment eligibility/, 'workAuth'],
  [/sponsor/, 'sponsorship'],
  [/relocat/, 'relocate'],
  [/how did you (hear|find|learn)|where did you (hear|find|see)|source of (this )?application|referral source|how did you come across/, 'howHeard'],
  [/\bgender\b|\bsex\b/, 'eeo'],
  [/race|ethnic|hispanic|latino/, 'eeo'],
  [/veteran|military status|protected veteran/, 'eeo'],
  [/disabilit/, 'eeo'],
  [/(^|\b)location\b|where are you (located|based)|current location/, 'location']
];
const DECLINE = /decline|prefer not|don.?t wish|do not wish|not to (say|answer|disclose|identify|self)|choose not|i do not want|rather not/i;

function norm(s) { return String(s || '').replace(/\s+/g, ' ').replace(/\*/g, '').trim().toLowerCase(); }

// el: { type, label, value, checked, options?: [string] | [{label}], required }
function suggest(el, vals) {
  if (!el || ['button', 'link', 'file', 'tab', 'option', 'menuitem'].includes(el.type)) return null;
  const label = norm(el.label);
  if (!label) return null;
  let key = null;
  for (const [re, k] of RULES) if (re.test(label)) { key = k; break; }
  if (!key || key === 'skip') return null;
  // email confirmation / phone extension / country code etc.
  if (key === 'phone' && /extension|\bext\b|country code|type|device/.test(label)) return null;
  if (key === 'country' && /code/.test(label)) return null;
  if (key === 'state' && /statement/.test(label)) return null;
  if (key === 'name' && /company|school|reference|manager|employer|emergency|referr/.test(label)) return null;
  if (key === 'email' && /reference|manager|referr/.test(label)) return null;

  const opts = (el.options || []).map(o => typeof o === 'string' ? o : o.label).filter(Boolean);
  const pick = (want) => {
    if (!opts.length) return want;
    const w = norm(want);
    return opts.find(o => norm(o) === w) || opts.find(o => norm(o).startsWith(w)) || opts.find(o => w && norm(o).includes(w)) || null;
  };

  if (key === 'eeo') {
    if (vals.eeo !== 'decline' || !opts.length) return null;
    const o = opts.find(x => DECLINE.test(x));
    return o ? { key, value: o, why: 'You chose not to self-identify' } : null;
  }
  let v = vals[key];
  if (key === 'state' && opts.length) v = pick(vals.stateFull) || pick(vals.state);
  else if (key === 'state' && /full|name/.test(label)) v = vals.stateFull;
  else if (['workAuth', 'sponsorship', 'relocate'].includes(key) && opts.length) {
    if (!v) return null;
    v = opts.find(o => new RegExp('^\\s*' + v + '\\b', 'i').test(o)) || pick(v);
  } else if (opts.length) v = pick(v);
  if (!v) return null;
  if (el.type === 'checkbox' || el.type === 'switch') return null;
  if (el.maxLength && String(v).length > el.maxLength) return null;
  return { key, value: String(v) };
}

const isEmpty = (el) => {
  if (el.type === 'radio') return !(el.options || []).some(o => o.checked);
  if (el.type === 'checkbox' || el.type === 'switch') return !el.checked;
  if (el.type === 'file') return !el.value;
  if (el.type === 'select') { const v = norm(el.value); return !v || /^(select|choose|please|--|—|none)/.test(v); }
  return !String(el.value || '').trim();
};

// Put every field in a bucket: done / canFill / needsYou
function plan(elements, vals) {
  const out = [];
  for (const el of elements) {
    if (['button', 'link', 'tab', 'option', 'menuitem'].includes(el.type)) continue;
    const empty = isEmpty(el);
    const s = empty ? suggest(el, vals) : null;
    out.push({ ...el, empty, suggestion: s, state: !empty ? 'done' : s ? 'canFill' : 'needsYou' });
  }
  return out;
}

// Application portals and what to expect on each
const PORTALS = [
  { id: 'workday', name: 'Workday', test: /myworkdayjobs\.com|myworkday\.com|wd\d+\.myworkday/i, tips: ['Workday asks you to create an account for each company. Use your preferred email; Onward never sees the password.', 'Choose “Autofill with Resume” and attach your tailored resume — then check the dates and titles it guessed.', 'It’s several pages (My Information → Experience → Questions → Disclosures → Review). Onward rescans each page.'] },
  { id: 'greenhouse', name: 'Greenhouse', test: /greenhouse\.io/i, tips: ['One page, no account needed.', 'Attach your resume first — the rest is usually basic details and a few questions.'] },
  { id: 'lever', name: 'Lever', test: /lever\.co/i, tips: ['One page, no account needed.', 'The “Additional information” box is a good place for a short, tailored note.'] },
  { id: 'ashby', name: 'Ashby', test: /ashbyhq\.com/i, tips: ['One page, no account needed. Resume upload may pre-fill some fields — check them.'] },
  { id: 'icims', name: 'iCIMS', test: /icims\.com/i, tips: ['iCIMS usually asks for an account and has several steps.', 'It may re-ask for details already in your resume — Onward fills what it can on each page.'] },
  { id: 'smartrecruiters', name: 'SmartRecruiters', test: /smartrecruiters\.com/i, tips: ['You can apply without an account. Attach your resume, then review the profile it builds.'] },
  { id: 'taleo', name: 'Taleo', test: /taleo\.net/i, tips: ['Taleo needs an account and has many pages. Save as you go.'] },
  { id: 'successfactors', name: 'SuccessFactors', test: /successfactors|jobs\.sap\.com|sapsf/i, tips: ['Needs an account. Several pages with profile, questions and documents.'] },
  { id: 'bamboohr', name: 'BambooHR', test: /bamboohr\.com/i, tips: ['One page, no account needed.'] },
  { id: 'jobvite', name: 'Jobvite', test: /jobvite\.com/i, tips: ['Usually one or two pages, no account needed.'] },
  { id: 'workable', name: 'Workable', test: /workable\.com/i, tips: ['One page, no account needed.'] },
  { id: 'ukg', name: 'UKG', test: /ultipro|ukg\.com|recruiting\.ultipro/i, tips: ['May ask you to sign in or continue as a guest.'] },
  { id: 'adp', name: 'ADP', test: /workforcenow\.adp\.com|adp\.com/i, tips: ['ADP usually asks for an account and has several steps.'] },
  { id: 'paylocity', name: 'Paylocity', test: /paylocity\.com/i, tips: ['One or two pages, no account needed.'] },
  { id: 'linkedin', name: 'LinkedIn Easy Apply', test: /linkedin\.com/i, tips: ['Easy Apply opens in a window on the job page. Your LinkedIn profile fills most of it — Onward handles the questions.'] },
  { id: 'indeed', name: 'Indeed Apply', test: /indeed\.com/i, tips: ['Indeed Apply walks through contact info, resume, questions and review.'] }
];
function portalFor(url) {
  return PORTALS.find(p => p.test.test(String(url || ''))) || { id: 'site', name: 'Company site', tips: ['This is the company’s own application page. Onward fills what it knows and lists the rest for you.'] };
}

module.exports = { profileValues, suggest, plan, portalFor, PORTALS, US_STATES, yesNo };
