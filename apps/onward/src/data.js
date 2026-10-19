// Onward — data: the store (profile, credentials, jobs, people) and the "Onward Files" folder on disk.
//
//   ~/Downloads/Onward/Onward Files/
//     Profile/                 base resume + certificates, degrees, licenses…
//     Applications/<date> <Company> — <Role>/
//                              tailored resume (.pdf + .docx), cover letter, job.json, application.json
//
// App state lives in <userData>/onward-data.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const uid = (p = '') => p + crypto.randomBytes(5).toString('hex');
const now = () => new Date().toISOString();

const STATUSES = ['saved', 'tailoring', 'ready', 'applied', 'interview', 'offer', 'rejected', 'withdrawn'];

const DEFAULT_PROFILE = {
  name: '', headline: '', email: '', phone: '', location: '',
  street: '', city: '', state: '', zip: '', country: 'United States',
  currentTitle: '', currentCompany: '', highestEducation: '',
  links: { linkedin: '', portfolio: '', github: '', website: '' },
  workAuthorization: '', needsSponsorship: '', willingToRelocate: '',
  salaryExpectation: '', noticePeriod: '', yearsExperience: '',
  howHeard: '', eeo: 'decline',
  targetRoles: [], targetLocations: [], workplace: [], minSalary: '',
  notes: ''
};

const DEFAULT_STORE = {
  profile: DEFAULT_PROFILE,
  baseResume: null,          // { file, name, text, updatedAt }
  credentials: [],           // { id, type, title, issuer, date, file, name, text, addedAt }
  jobs: [],
  settings: {
    filesRoot: '', theme: 'dark', pageLetter: true,
    ai: { engine: 'web', site: 'chatgpt', openaiModel: 'gpt-5-mini', anthropicModel: 'claude-haiku-5-5', openaiKey: '', anthropicKey: '' },
    emailVia: 'mailapp',
    guide: true
  },
  browser: { tabs: [], bookmarks: [
    { id: 'bm1', title: 'LinkedIn Jobs', url: 'https://www.linkedin.com/jobs/' },
    { id: 'bm2', title: 'Indeed', url: 'https://www.indeed.com/' },
    { id: 'bm3', title: 'Glassdoor', url: 'https://www.glassdoor.com/Job/index.htm' },
    { id: 'bm4', title: 'Wellfound', url: 'https://wellfound.com/jobs' },
    { id: 'bm5', title: 'Google Jobs', url: 'https://www.google.com/search?q=jobs+near+me&ibp=htl;jobs' }
  ] },
  discover: { last: null, recent: [] },
  ui: { view: 'jobs', filter: 'active' }
};

let store = null;
let onChange = () => {};
const storePath = () => path.join(app.getPath('userData'), 'onward-data.json');

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    store = {
      ...clone(DEFAULT_STORE), ...raw,
      profile: { ...clone(DEFAULT_PROFILE), ...(raw.profile || {}), links: { ...DEFAULT_PROFILE.links, ...(raw.profile?.links || {}) } },
      settings: { ...clone(DEFAULT_STORE.settings), ...(raw.settings || {}), ai: { ...DEFAULT_STORE.settings.ai, ...(raw.settings?.ai || {}) } },
      browser: { ...clone(DEFAULT_STORE.browser), ...(raw.browser || {}) },
      discover: { ...clone(DEFAULT_STORE.discover), ...(raw.discover || {}) },
      ui: { ...DEFAULT_STORE.ui, ...(raw.ui || {}) }
    };
  } catch { store = clone(DEFAULT_STORE); }
  migrate();
  ensureFolders();
  return store;
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }

// v0.1 → v0.2: a single job.contact becomes job.contacts[]; city/state from "Denver, CO"
function migrate() {
  for (const j of store.jobs) {
    if (!Array.isArray(j.contacts)) j.contacts = [];
    if (j.contact && (j.contact.name || j.contact.email)) {
      j.contacts.push({ id: uid('p_'), ...j.contact, linkedin: j.contact.url || '', source: 'saved', messages: [] });
      delete j.contact;
    }
    for (const c of j.contacts) if (!Array.isArray(c.messages)) c.messages = [];
  }
  const p = store.profile;
  if (!p.city && p.location) {
    const [city, state] = p.location.split(',').map(s => s.trim());
    p.city = city || ''; if (state && state.length <= 3) p.state = state;
  }
}

let saveTimer = null;
function save(kind = 'all') {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = storePath() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
      fs.renameSync(tmp, storePath());
    } catch (e) { console.error('save failed', e); }
  }, 120);
  onChange(kind);
}
function flush() {
  clearTimeout(saveTimer);
  try { fs.writeFileSync(storePath(), JSON.stringify(store, null, 2)); } catch {}
}

// ---------- folders ----------
function filesRoot() {
  return store.settings.filesRoot || path.join(app.getPath('downloads'), 'Onward', 'Onward Files');
}
const profileDir = () => path.join(filesRoot(), 'Profile');
const credentialsDir = () => path.join(profileDir(), 'Credentials');
const applicationsDir = () => path.join(filesRoot(), 'Applications');
function ensureFolders() {
  for (const d of [filesRoot(), profileDir(), credentialsDir(), applicationsDir()]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch {}
  }
}
const safeName = (s, max = 60) => String(s || '').replace(/[\/\\:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim() || 'Untitled';

function uniquePath(dir, base, ext) {
  let p = path.join(dir, base + ext), i = 2;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`);
  return p;
}

function jobFolder(job) {
  if (job.folder && fs.existsSync(job.folder)) return job.folder;
  const date = (job.createdAt || now()).slice(0, 10);
  const name = safeName(`${date} ${job.company || 'Company'} — ${job.title || 'Role'}`, 110);
  let dir = path.join(applicationsDir(), name), i = 2;
  while (fs.existsSync(dir)) dir = path.join(applicationsDir(), `${name} (${i++})`);
  fs.mkdirSync(dir, { recursive: true });
  job.folder = dir;
  return dir;
}

function insideFiles(p) {
  const rel = path.relative(filesRoot(), path.resolve(p));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// ---------- jobs ----------
const JOB_FIELDS = ['title', 'company', 'url', 'applyUrl', 'applyType', 'source', 'listingId', 'logo', 'location', 'workplace', 'employmentType', 'pay', 'experience',
  'seniority', 'industry', 'jobFunction', 'applicants', 'postedAt', 'summary', 'description', 'highlights', 'requirements', 'companyInfo', 'status', 'notes', 'fit', 'deadline'];

function findJob(idOrUrl) {
  if (!idOrUrl) return null;
  return store.jobs.find(j => j.id === idOrUrl)
    || store.jobs.find(j => j.listingId && j.listingId === idOrUrl)
    || store.jobs.find(j => j.url && normUrl(j.url) === normUrl(idOrUrl)) || null;
}
function normUrl(u) {
  try {
    const x = new URL(u);
    const li = x.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})/) || (x.searchParams.get('currentJobId') && [0, x.searchParams.get('currentJobId')]);
    if (/linkedin\.com$/.test(x.hostname.replace(/^www\./, '')) && li) return 'linkedin:' + li[1];
    const jk = x.searchParams.get('jk') || x.searchParams.get('vjk');
    if (/indeed\./.test(x.hostname) && jk) return 'indeed:' + jk;
    return (x.hostname.replace(/^www\./, '') + x.pathname).replace(/\/$/, '').toLowerCase();
  } catch { return String(u).trim().toLowerCase(); }
}

function saveJob(input = {}) {
  let job = input.id ? findJob(input.id) : (input.listingId && findJob(input.listingId)) || (input.url ? findJob(input.url) : null);
  const created = !job;
  if (!job) {
    job = { id: uid('job_'), createdAt: now(), status: 'saved', submitted: {}, timeline: [], contacts: [] };
    store.jobs.unshift(job);
  }
  for (const k of JOB_FIELDS) {
    if (input[k] === undefined || input[k] === null || input[k] === '') continue;
    if (k === 'companyInfo' || k === 'pay' || k === 'fit') job[k] = { ...(job[k] || {}), ...input[k] };
    else job[k] = input[k];
  }
  if (job.status && !STATUSES.includes(job.status)) job.status = 'saved';
  if (!job.source && job.url) job.source = sourceOf(job.url);
  job.updatedAt = now();
  if (created) job.timeline.push({ at: now(), text: 'Saved' + (input.by === 'claude' ? ' by your AI' : input.by === 'discover' ? ' from Discover' : '') });
  // People that came with the posting (e.g. LinkedIn's "hiring team")
  for (const c of input.contacts || []) addContact(job.id, c, { silent: true });
  if (input.contact && (input.contact.name || input.contact.email)) addContact(job.id, input.contact, { silent: true });
  if (job.folder) writeJobSnapshot(job);
  save('jobs');
  return { job, created };
}

function sourceOf(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    const known = { 'linkedin.com': 'LinkedIn', 'indeed.com': 'Indeed', 'glassdoor.com': 'Glassdoor', 'wellfound.com': 'Wellfound', 'greenhouse.io': 'Greenhouse', 'lever.co': 'Lever', 'myworkdayjobs.com': 'Workday', 'ashbyhq.com': 'Ashby', 'smartrecruiters.com': 'SmartRecruiters', 'ziprecruiter.com': 'ZipRecruiter' };
    for (const [k, v] of Object.entries(known)) if (h === k || h.endsWith('.' + k)) return v;
    return h;
  } catch { return ''; }
}

function setStatus(id, status, note, by) {
  const job = findJob(id);
  if (!job) throw new Error('No job with id ' + id);
  if (!STATUSES.includes(status)) throw new Error('Status must be one of: ' + STATUSES.join(', '));
  job.status = status;
  if (status === 'applied' && !job.submitted?.appliedAt) job.submitted = { ...(job.submitted || {}), appliedAt: now() };
  job.updatedAt = now();
  job.timeline.push({ at: now(), text: `Status → ${status}${note ? ': ' + note : ''}${by === 'claude' ? ' (AI)' : ''}` });
  if (job.folder) writeJobSnapshot(job);
  save('jobs');
  return job;
}

function addNote(id, text, by) {
  const job = findJob(id);
  if (!job) throw new Error('No job with id ' + id);
  job.timeline.push({ at: now(), text: (by === 'claude' ? 'AI: ' : '') + text });
  job.updatedAt = now();
  save('jobs');
  return job;
}

function removeJob(id) {
  store.jobs = store.jobs.filter(j => j.id !== id);
  save('jobs');
}

function recordSubmission(id, sub = {}, by) {
  const job = findJob(id);
  if (!job) throw new Error('No job with id ' + id);
  const s = job.submitted = { ...(job.submitted || {}) };
  if (sub.answers?.length) s.answers = [...(s.answers || []).filter(a => !sub.answers.some(b => b.question === a.question)), ...sub.answers];
  if (sub.attachments?.length) s.attachments = [...new Set([...(s.attachments || []), ...sub.attachments])];
  if (sub.portal) s.portal = sub.portal;
  if (sub.resumeUsed) s.resumeUsed = sub.resumeUsed;
  if (sub.coverLetterUsed !== undefined) s.coverLetterUsed = !!sub.coverLetterUsed;
  if (sub.emailUsed) s.emailUsed = sub.emailUsed;
  if (sub.submitted) {
    const first = !s.appliedAt;
    s.appliedAt = s.appliedAt || now();
    job.status = ['interview', 'offer'].includes(job.status) ? job.status : 'applied';
    if (first) job.timeline.push({ at: now(), text: 'Application submitted' + (s.portal ? ' via ' + s.portal : '') });
  } else if (sub.answers?.length || sub.attachments?.length) {
    const t = `Application filled in${by === 'claude' ? ' by your AI' : ''} — waiting for you to submit`;
    if (job.timeline[job.timeline.length - 1]?.text !== t && !s.appliedAt) job.timeline.push({ at: now(), text: t });
    if (['saved', 'tailoring'].includes(job.status)) job.status = 'ready';
  }
  job.updatedAt = now();
  jobFolder(job);
  try { fs.writeFileSync(path.join(job.folder, 'application.json'), JSON.stringify(s, null, 2)); } catch {}
  writeJobSnapshot(job);
  save('jobs');
  return job;
}

function writeJobSnapshot(job) {
  try {
    const { submitted, timeline, ...rest } = job;
    fs.writeFileSync(path.join(job.folder, 'job.json'), JSON.stringify(rest, null, 2));
  } catch {}
}

// ---------- people & messages ----------
const CONTACT_FIELDS = ['name', 'title', 'email', 'phone', 'linkedin', 'notes', 'source', 'role'];
function addContact(jobId, c = {}, { silent } = {}) {
  const job = findJob(jobId);
  if (!job) throw new Error('No job with id ' + jobId);
  job.contacts = job.contacts || [];
  const key = (x) => (x.linkedin ? 'li:' + String(x.linkedin).replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase() : '') || (x.email ? 'em:' + x.email.toLowerCase() : '') || 'nm:' + String(x.name || '').toLowerCase();
  let p = (c.id && job.contacts.find(x => x.id === c.id)) || job.contacts.find(x => key(x) === key(c) && key(c) !== 'nm:');
  const isNew = !p;
  if (!p) { p = { id: uid('p_'), messages: [], addedAt: now() }; job.contacts.push(p); }
  for (const k of CONTACT_FIELDS) if (c[k] !== undefined && c[k] !== '') p[k] = c[k];
  if (isNew) job.timeline.push({ at: now(), text: `Added ${p.name || p.email || 'a contact'}${p.title ? ' (' + p.title + ')' : ''}` });
  if (!silent) save('jobs');
  return { job, contact: p, created: isNew };
}
function removeContact(jobId, contactId) {
  const job = findJob(jobId);
  if (!job) return;
  job.contacts = (job.contacts || []).filter(c => c.id !== contactId);
  save('jobs');
  return job;
}
function saveMessage(jobId, contactId, m = {}) {
  const job = findJob(jobId);
  if (!job) throw new Error('No job with id ' + jobId);
  const c = (job.contacts || []).find(x => x.id === contactId);
  if (!c) throw new Error('No contact with id ' + contactId + ' on this job');
  let msg = m.id && c.messages.find(x => x.id === m.id);
  if (!msg) { msg = { id: uid('m_'), status: 'draft', createdAt: now() }; c.messages.push(msg); }
  for (const k of ['channel', 'subject', 'body']) if (m[k] !== undefined) msg[k] = m[k];
  msg.updatedAt = now();
  if (m.status === 'sent' && msg.status !== 'sent') {
    msg.status = 'sent'; msg.sentAt = now(); c.lastContacted = msg.sentAt;
    job.timeline.push({ at: now(), text: `Messaged ${c.name || c.email} on ${{ email: 'email', linkedin: 'LinkedIn', connect: 'LinkedIn (connection note)' }[msg.channel] || msg.channel}` });
  }
  save('jobs');
  return { job, contact: c, message: msg };
}
function removeMessage(jobId, contactId, messageId) {
  const job = findJob(jobId);
  const c = job?.contacts?.find(x => x.id === contactId);
  if (c) { c.messages = c.messages.filter(m => m.id !== messageId); save('jobs'); }
  return job;
}

// ---------- profile ----------
const PROFILE_KEYS = Object.keys(DEFAULT_PROFILE);
function updateProfile(patch = {}) {
  for (const k of PROFILE_KEYS) {
    if (patch[k] === undefined) continue;
    if (k === 'links') store.profile.links = { ...store.profile.links, ...patch.links };
    else store.profile[k] = patch[k];
  }
  save('profile');
  return store.profile;
}

module.exports = {
  STATUSES, load, save, flush, get store() { return store; }, set onChange(fn) { onChange = fn; },
  uid, now, filesRoot, profileDir, credentialsDir, applicationsDir, ensureFolders, safeName, uniquePath, insideFiles,
  findJob, saveJob, setStatus, addNote, removeJob, recordSubmission, jobFolder, writeJobSnapshot, updateProfile, sourceOf, normUrl,
  addContact, removeContact, saveMessage, removeMessage
};
