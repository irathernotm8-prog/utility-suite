// Onward — what each connector tool does inside the app (used by Claude, Codex / ChatGPT, or any MCP client).
const fs = require('fs');
const path = require('path');
const D = require('./data');
const Docs = require('./documents');
const B = require('./browserctl');
const Actions = require('./actions');
const Disc = require('./discover');
const AF = require('./autofill');

let notify = () => {};     // (kind, payload) → renderer
const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });
const error = (t) => ({ content: [{ type: 'text', text: t }], isError: true });
const S = () => D.store;

const ACTIVITY = {
  onward_get_profile: () => 'Reading your profile',
  onward_update_profile: () => 'Updating your profile',
  onward_get_document: (a) => a.id === 'base_resume' ? 'Reading your base resume' : 'Reading a credential',
  onward_list_jobs: () => 'Looking at your job board',
  onward_get_job: () => 'Opening a job',
  onward_save_job: (a) => a.listingId ? 'Saving a listing to your board' : `Saving ${a.title || 'a job'}${a.company ? ' at ' + a.company : ''}`,
  onward_set_job_status: (a) => `Moving a job to ${a.status}`,
  onward_add_note: () => 'Adding a note',
  onward_save_contact: (a) => `Saving ${a.name || 'a contact'}`,
  onward_save_message: () => 'Drafting a message for you to review',
  onward_save_tailored_resume: () => 'Writing a tailored resume',
  onward_save_cover_letter: () => 'Writing a cover letter',
  onward_record_application: (a) => a.submitted ? 'Recording your application' : 'Recording what was filled in',
  onward_search_jobs: (a) => `Searching for ${a.keywords}${a.location ? ' in ' + a.location : ''}`,
  onward_get_listing: () => 'Reading a job posting',
  onward_autofill: () => 'Filling in what Onward knows',
  onward_browser_open: (a) => 'Opening ' + host(a.url),
  onward_browser_read: () => 'Reading the page',
  onward_browser_fill: (a) => `Filling ${a.fields?.length || 0} field${a.fields?.length === 1 ? '' : 's'}`,
  onward_browser_type: () => 'Typing',
  onward_browser_key: (a) => 'Pressing ' + a.key,
  onward_browser_click: () => 'Clicking',
  onward_browser_upload: (a) => 'Attaching ' + String(a.file || 'a file').replace(/_/g, ' '),
  onward_browser_scroll: () => 'Scrolling',
  onward_browser_back: () => 'Going back',
  onward_browser_screenshot: () => 'Looking at the page'
};
const host = (u) => { try { return new URL(/^https?:/.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, ''); } catch { return 'a page'; } };

function jobLine(j) {
  const pay = j.pay?.text || (j.pay?.min ? `${j.pay.min}${j.pay.max ? '–' + j.pay.max : ''} ${j.pay.currency || ''}/${j.pay.period || ''}` : '');
  const sub = j.submitted || {};
  const files = [sub.resume && 'tailored resume', sub.coverLetter && 'cover letter'].filter(Boolean).join(', ');
  const people = (j.contacts || []).length;
  return `- ${j.id} · [${j.status}] ${j.title || '?'} — ${j.company || '?'}${j.location ? ' · ' + j.location : ''}${j.workplace ? ' · ' + j.workplace : ''}${pay ? ' · ' + pay : ''}${files ? ' · has ' + files : ''}${people ? ` · ${people} contact${people > 1 ? 's' : ''}` : ''}${sub.appliedAt ? ' · applied ' + sub.appliedAt.slice(0, 10) : ''}`;
}
function listingLine(r) {
  return `- ${r.id} · ${r.title} — ${r.company} · ${r.location || '?'}${r.pay?.text ? ' · ' + r.pay.text : ''}${r.postedAt ? ' · ' + r.postedAt : ''}${r.applyType === 'easy' || r.easyApply ? ' · Easy Apply' : ''}${r.badges?.length ? ' · ' + r.badges.join(', ') : ''}${r.saved ? ' · ON BOARD as ' + r.saved : ''}`;
}

// Fill everything Onward can answer from the profile; report what's left (compact, few tokens)
async function autofill(jobId) {
  const scan = await B.scan();
  if (!scan) throw new Error('No browser tab is open.');
  const job = D.findJob(jobId || scan.jobId);
  const vals = AF.profileValues(S().profile, { source: job?.source });
  const plan = AF.plan(scan.fields, vals);
  const todo = plan.filter(f => f.state === 'canFill').map(f => ({ ref: f.ref, value: f.suggestion.value }));
  const res = todo.length ? await B.fill(todo) : [];
  const failed = new Set(res.filter(r => !r.ok).map(r => r.ref));
  return { scan, plan, filled: todo.filter(t => !failed.has(t.ref)), failed: res.filter(r => !r.ok) };
}

const tools = {
  async onward_get_profile() {
    const s = S();
    const p = s.profile;
    const missing = ['name', 'email', 'phone', 'city', 'state', 'workAuthorization', 'needsSponsorship'].filter(k => !p[k]);
    return text({
      profile: p,
      missingForApplications: missing,
      baseResume: s.baseResume ? { file: s.baseResume.name, updatedAt: s.baseResume.updatedAt, text: s.baseResume.text || '(no text could be read — use onward_get_document)' } : null,
      credentials: s.credentials.map(c => ({ id: c.id, type: c.type, title: c.title, issuer: c.issuer, date: c.date, file: c.name, excerpt: c.text ? c.text.slice(0, 400) : (Docs.isImage(c.file) ? '(image — use onward_get_document to see it)' : '(no text)') })),
      jobsOnBoard: s.jobs.length
    });
  },

  async onward_update_profile(a) { return text({ ok: true, profile: D.updateProfile(a) }); },

  async onward_get_document({ id }) {
    const s = S();
    const doc = id === 'base_resume' ? s.baseResume : s.credentials.find(c => c.id === id);
    if (!doc) return error('No document with id ' + id);
    if (!fs.existsSync(doc.file)) return error('The file is missing from disk: ' + doc.file);
    if (Docs.isImage(doc.file)) {
      const ext = path.extname(doc.file).slice(1).toLowerCase();
      if (ext === 'heic') return error('HEIC images can\'t be shown; ask the user for a JPG or PDF.');
      return { content: [{ type: 'text', text: `${doc.title || doc.name}` }, { type: 'image', data: fs.readFileSync(doc.file).toString('base64'), mimeType: ext === 'jpg' ? 'image/jpeg' : 'image/' + ext }] };
    }
    const t = doc.text || await Docs.extractText(doc.file);
    return text(t ? `${doc.title || doc.name}\n\n${t}` : 'No text could be read from this file (it may be a scanned image).');
  },

  async onward_list_jobs({ status, query } = {}) {
    let jobs = S().jobs;
    if (status) jobs = jobs.filter(j => j.status === status);
    if (query) { const q = query.toLowerCase(); jobs = jobs.filter(j => `${j.title} ${j.company}`.toLowerCase().includes(q)); }
    return text(jobs.length ? jobs.slice(0, 100).map(jobLine).join('\n') : 'No jobs match.');
  },

  async onward_get_job({ id }) {
    const j = D.findJob(id);
    if (!j) return error('No job with id or url ' + id);
    const { description, ...rest } = j;
    return text({ ...rest, description: description ? description.slice(0, 6000) : undefined });
  },

  async onward_save_job(a) {
    if (a.listingId) {
      const id = /^(li|in):/.test(a.listingId) ? a.listingId : 'li:' + a.listingId;
      const { job, created } = await Disc.save(id, { by: 'claude' });
      const { listingId, ...rest } = a;
      if (Object.keys(rest).some(k => rest[k] !== undefined)) D.saveJob({ ...rest, id: job.id, by: 'claude' });
      notify('job', { id: job.id, created });
      return text(`${created ? 'Saved' : 'Updated'} job ${job.id}: ${job.title} — ${job.company}${job.contacts?.length ? ` (with ${job.contacts.length} contact${job.contacts.length > 1 ? 's' : ''})` : ''}`);
    }
    if (!a.id && !a.title && !a.url) return error('Give a listingId from onward_search_jobs, or at least a title or url.');
    if (a.id && !D.findJob(a.id)) return error('No job with id ' + a.id);
    const { job, created } = D.saveJob({ ...a, by: 'claude' });
    notify('job', { id: job.id, created });
    B.linkJob(job.id);
    return text(`${created ? 'Saved' : 'Updated'} job ${job.id}: ${job.title} — ${job.company}`);
  },

  async onward_set_job_status({ id, status, note }) {
    const j = D.setStatus(id, status, note, 'claude');
    notify('job', { id: j.id });
    return text(`${j.title} is now "${status}".`);
  },

  async onward_add_note({ id, text: t }) {
    const j = D.addNote(id, t, 'claude');
    notify('job', { id: j.id });
    return text('Note added.');
  },

  async onward_save_contact({ jobId, ...c }) {
    if (!c.name && !c.email && !c.linkedin) return error('Give at least a name, email or LinkedIn URL.');
    const { job, contact, created } = D.addContact(jobId, { source: c.source || 'Added by AI', ...c });
    notify('job', { id: job.id });
    return text(`${created ? 'Saved' : 'Updated'} contact ${contact.id}: ${contact.name || contact.email} on ${job.title} — ${job.company}`);
  },

  async onward_save_message({ jobId, contactId, channel = 'email', subject = '', body }) {
    if (!body) return error('Give the message body.');
    if (channel === 'connect' && body.length > 300) return error('LinkedIn connection notes must be 300 characters or fewer.');
    const { job, contact, message } = D.saveMessage(jobId, contactId, { channel, subject, body });
    notify('job', { id: job.id });
    notify('message', { jobId: job.id, contactId: contact.id, messageId: message.id });
    return text(`Saved a draft ${channel} message to ${contact.name || contact.email}. The user reviews and sends it from the job in Onward — tell them it's ready.`);
  },

  async onward_save_tailored_resume({ jobId, resume, changes }) {
    const out = await Actions.saveTailoredResume(jobId, resume, changes, 'claude');
    notify('job', { id: out.job.id });
    return text(`Saved the tailored resume (PDF + Word) to the job's folder.\nUpload it with onward_browser_upload (file "tailored_resume", jobId "${out.job.id}").`);
  },

  async onward_save_cover_letter({ jobId, text: body }) {
    const out = await Actions.saveCoverLetter(jobId, body, 'claude');
    notify('job', { id: out.job.id });
    return text('Saved the cover letter (PDF + Word) to the job\'s folder.');
  },

  async onward_record_application(a) {
    const j = D.recordSubmission(a.jobId, a, 'claude');
    notify('job', { id: j.id });
    return text(a.submitted ? `Marked ${j.title} at ${j.company} as applied.` : 'Recorded. The job card shows what was filled in.');
  },

  async onward_search_jobs(a) {
    const q = { ...a, sources: a.sources || (a.site ? [a.site] : ['linkedin']), posted: a.posted || a.postedWithin, page: a.page || 0 };
    const r = await Disc.search(q);
    notify('discover', { q, results: r.results, errors: r.errors });
    const lines = r.results.map(listingLine);
    return text([
      `${r.results.length} listings${q.page ? ' (page ' + (q.page + 1) + ')' : ''}. Use onward_get_listing for details, onward_save_job with listingId to put one on the board.`,
      ...lines,
      ...r.errors.map(e => `! ${e.source}: ${e.message}`)
    ].join('\n'));
  },

  async onward_get_listing({ id }) {
    const d = await Disc.detail(/^(li|in):/.test(id) ? id : 'li:' + id);
    const lines = [
      `${d.title} — ${d.company}`, `Location: ${d.location || '?'}${d.workplace ? ' (' + d.workplace + ')' : ''}`,
      d.pay?.text && `Pay: ${d.pay.text}`, d.experience && `Experience: ${d.experience}`, d.seniority && `Seniority: ${d.seniority}`,
      d.employmentType && `Type: ${d.employmentType}`, d.industry && `Industry: ${d.industry}`, d.postedAt && `Posted: ${d.postedAt}${d.applicants ? ' · ' + d.applicants : ''}`,
      `How to apply: ${d.applyType === 'easy' ? 'LinkedIn Easy Apply' : d.applyType === 'indeed' ? 'Indeed Apply' : d.applyType === 'offsite' ? 'on the company\'s site (open the posting and press Apply)' : 'see posting'}`,
      d.match && `Keyword match with resume: ${d.match.score}% (matched: ${d.match.matched.join(', ')}; missing: ${d.match.missing.join(', ')})`,
      d.contacts?.length && 'Contacts: ' + d.contacts.map(c => [c.name, c.title, c.email, c.linkedin].filter(Boolean).join(' / ')).join('; '),
      d.saved && `Already on the board as ${d.saved}`,
      '', d.description ? d.description.slice(0, 7000) : '(no description)'
    ].filter(x => x !== undefined && x !== false && x !== null && x !== '');
    return text(lines.join('\n'));
  },

  async onward_autofill({ jobId } = {}) {
    if (jobId) B.linkJob(jobId);
    const r = await autofill(jobId);
    const left = r.plan.filter(f => f.state === 'needsYou');
    const fmt = (f) => `[${f.ref}] ${f.type} "${f.label}"${f.required ? ' *required' : ''}${f.options?.length ? ' options: ' + f.options.map(o => typeof o === 'string' ? o : o.label).slice(0, 25).join(' | ') : ''}${f.maxLength ? ` (max ${f.maxLength})` : ''}`;
    return text([
      `Page: ${r.scan.heading || r.scan.title} (${host(r.scan.url)}) · portal: ${AF.portalFor(r.scan.url).name}`,
      `Filled ${r.filled.length} field(s) from the profile.`,
      ...r.failed.map(f => `! couldn't fill ${f.ref}: ${f.note}`),
      ...(r.scan.errors.length ? ['Messages on the page:', ...r.scan.errors.map(e => '  ! ' + e)] : []),
      left.length ? `Still empty (${left.length}) — answer these with onward_browser_fill / onward_browser_upload, asking the user when the profile doesn't say:` : 'Nothing left empty on this page.',
      ...left.map(fmt),
      'Buttons: ' + r.scan.buttons.filter(b => b.type === 'button').slice(0, 15).map(b => `[${b.ref}] ${b.label}`).join(' · ')
    ].join('\n'));
  },

  async onward_browser_open({ url, newTab, jobId }) {
    if (jobId && !D.findJob(jobId)) return error('No job with id ' + jobId);
    const o = await B.open(url, { newTab, jobId });
    return text((o.loadError ? `The page didn't load cleanly (${o.loadError}).\n` : '') + await B.read({ maxText: 6000 }));
  },

  async onward_browser_read(a) { return text(await B.read({ maxText: 8000, ...a })); },

  async onward_browser_fill({ fields, jobId }) {
    if (jobId) B.linkJob(jobId);
    const res = await B.fill(fields);
    const bad = res.filter(r => !r.ok);
    return text(`Filled ${res.length - bad.length} of ${res.length}.` + (bad.length ? '\nProblems:\n' + bad.map(b => `- ${b.ref}: ${b.note}${b.options ? ' (options: ' + b.options.join(' | ') + ')' : ''}`).join('\n') : '') + '\nRead the page again to check for errors or new fields.');
  },

  async onward_browser_type({ ref, text: t, thenKey }) {
    const r = await B.type(ref, t, thenKey);
    return r.ok ? text(r.note || 'Typed. Read the page to pick from any suggestions that appeared.') : error(r.note);
  },

  async onward_browser_key({ key }) { const r = await B.key(key); return text(r.held ? r.note : 'Pressed ' + key + '.'); },

  async onward_browser_click({ ref }) {
    const r = await B.click(ref, { allowSubmit: false });
    if (!r.ok) return error(r.note);
    if (r.held) return text(r.note);
    return text(`Clicked "${r.clicked}".${r.navigated ? ' Now on ' + r.navigated : ''} Read the page to see what changed.`);
  },

  async onward_browser_upload({ ref, file, jobId, format = 'pdf' }) {
    const r = await uploadFile(ref, file, jobId, format);
    return r.ok ? text(`Attached ${r.name}. Read the page to confirm the site accepted it.`) : error(r.note);
  },

  async onward_browser_scroll(a) { await B.scroll(a); return text('Scrolled. Read the page to see the new content.'); },
  async onward_browser_back() { const r = await B.back(); return r.ok ? text('Back on ' + r.url) : error(r.note); },
  async onward_browser_screenshot() {
    const data = await B.screenshot();
    return { content: [{ type: 'image', data, mimeType: 'image/jpeg' }] };
  }
};

// Shared with the Apply Guide
async function uploadFile(ref, file, jobId, format = 'pdf') {
  const s = S();
  let p = null;
  if (file === 'base_resume') p = s.baseResume?.file;
  else if (String(file).startsWith('credential:')) p = s.credentials.find(c => c.id === file.slice(11))?.file;
  else if (file === 'tailored_resume' || file === 'cover_letter') {
    const j = D.findJob(jobId || B.current()?.tab.jobId);
    if (!j) return { ok: false, note: 'Pass the jobId of the job this file belongs to.' };
    const f = j.submitted?.[file === 'tailored_resume' ? 'resume' : 'coverLetter'];
    if (!f) return { ok: false, note: `There's no ${file.replace('_', ' ')} for this job yet — make one first.` };
    p = format === 'docx' ? f.docx : f.pdf;
  }
  if (!p || !fs.existsSync(p)) return { ok: false, note: 'That file isn\'t available.' };
  if (!D.insideFiles(p)) return { ok: false, note: 'Only files inside the Onward Files folder can be uploaded.' };
  const ext = path.extname(p).toLowerCase();
  const mime = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.doc': 'application/msword', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.txt': 'text/plain' }[ext] || 'application/octet-stream';
  const r = await B.upload(ref, { name: path.basename(p), mime, b64: fs.readFileSync(p).toString('base64') });
  if (!r.ok) return r;
  const job = D.findJob(jobId || B.current()?.tab.jobId);
  if (job) {
    const kind = file === 'tailored_resume' ? 'tailored' : file === 'base_resume' ? 'base' : null;
    D.recordSubmission(job.id, { attachments: [path.basename(p)], ...(kind ? { resumeUsed: kind } : {}), ...(file === 'cover_letter' ? { coverLetterUsed: true } : {}) });
  }
  return { ok: true, name: path.basename(p) };
}

async function handle(name, args) {
  const fn = tools[name];
  if (!fn) return error('Unknown tool ' + name);
  const label = (ACTIVITY[name] || (() => name))(args || {});
  const id = Date.now() + Math.random();
  notify('activity', { id, tool: name, label, state: 'start' });
  try {
    const r = await fn(args || {});
    notify('activity', { id, tool: name, label, state: r.isError ? 'error' : 'done' });
    return r;
  } catch (e) {
    notify('activity', { id, tool: name, label, state: 'error' });
    return error(e.message || String(e));
  }
}

module.exports = { handle, autofill, uploadFile, setNotify: (fn) => { notify = fn; } };
