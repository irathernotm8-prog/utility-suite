// Onward — the tools Claude sees. Shared by the MCP server (mcp/onward-mcp.js) and the app.

const INSTRUCTIONS = `Onward is the user's job-hunting app. It holds their profile, base resume and credentials, a board of jobs with contacts, and a built-in browser (signed in to LinkedIn, Indeed, etc.).

Save tokens: prefer Onward's structured tools over reading web pages.
1. Start with onward_get_profile. Ask the user for anything important that's missing and save it with onward_update_profile.
2. Finding jobs: onward_search_jobs returns compact listings (no browser needed). onward_get_listing gives the full posting. Save a good one with onward_save_job {listingId} — it brings the description, pay, apply type and any hiring contacts along. Add your honest fit read with onward_save_job {id, fit}.
3. Tailoring: write a tailored resume from the base resume and credentials and save it with onward_save_tailored_resume. Reorder, re-word and emphasise to match the posting, but NEVER invent employers, titles, dates, degrees, certifications, metrics or skills. Offer a cover letter (onward_save_cover_letter) when asked for one.
4. People: save recruiters/hiring managers with onward_save_contact. Draft outreach with onward_save_message — the user reviews and sends it from Onward. Never claim a message was sent.
5. Applying: open the application with onward_browser_open {url, jobId}. Call onward_autofill first — it fills everything the profile answers (no tokens) and lists only what's left. Answer the rest with onward_browser_fill, attach files with onward_browser_upload, then onward_autofill again on each new page. Use onward_browser_read only when you need the page text.
6. Never press the final submit button yourself. Call onward_browser_click on it — Onward highlights it for the user instead — and tell the user to review and press it. Onward records the application automatically when they do.
7. Never type passwords or payment details. If a site needs a sign-in, ask the user to sign in inside Onward's browser.
Refs (like "e12" or "f3:e12") come from onward_autofill / onward_browser_read and are only valid until the page changes.`;

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const JOB_PROPS = {
  title: str('Job title'),
  company: str('Company name'),
  url: str('Link to the posting'),
  location: str('City, State / Country as posted'),
  workplace: str('Remote, Hybrid or On-site', { enum: ['Remote', 'Hybrid', 'On-site', 'Unknown'] }),
  employmentType: str('Full-time, Part-time, Contract, Internship, Temporary'),
  pay: { type: 'object', description: 'Pay exactly as posted', properties: { min: { type: 'number' }, max: { type: 'number' }, currency: str('e.g. USD'), period: str('year, hour, month'), text: str('Pay as written in the posting, e.g. "$85K–$100K/yr + bonus"') } },
  experience: str('Experience asked for, e.g. "5+ years in project management"'),
  seniority: str('Entry, Associate, Mid-Senior, Director, Executive'),
  postedAt: str('When it was posted, e.g. "3 days ago" or a date'),
  deadline: str('Application deadline if stated'),
  summary: str('2–4 sentence summary of the role'),
  highlights: { type: 'array', items: { type: 'string' }, description: 'Key responsibilities / selling points (short)' },
  requirements: { type: 'array', items: { type: 'string' }, description: 'Key requirements and nice-to-haves (short)' },
  companyInfo: { type: 'object', properties: { about: str('What the company does (1–3 sentences)'), industry: str(), size: str('e.g. 51–200 employees'), website: str(), hq: str('Headquarters') } },
  contact: { type: 'object', description: 'Recruiter / hiring manager if listed (also see onward_save_contact)', properties: { name: str(), title: str(), email: str(), linkedin: str() } },
  description: str('Full posting text, if you have it'),
  fit: { type: 'object', description: 'Your honest read on how well the user fits', properties: { score: { type: 'number', description: '0–100' }, reasons: { type: 'array', items: { type: 'string' } }, gaps: { type: 'array', items: { type: 'string' } } } },
  notes: str('Anything else worth keeping')
};

const RESUME = {
  type: 'object',
  description: 'The full tailored resume. Only use facts from the user\'s base resume, credentials and profile.',
  properties: {
    name: str(), headline: str('One-line professional title under the name'),
    contact: { type: 'object', properties: { email: str(), phone: str(), location: str(), links: { type: 'array', items: { type: 'object', properties: { label: str(), url: str() } } } } },
    summary: str('2–4 sentence summary tailored to the role'),
    experience: { type: 'array', items: { type: 'object', properties: { title: str(), company: str(), location: str(), start: str('e.g. Jan 2024'), end: str('e.g. Present'), bullets: { type: 'array', items: { type: 'string' } } }, required: ['title', 'company'] } },
    projects: { type: 'array', items: { type: 'object', properties: { name: str(), description: str(), date: str(), bullets: { type: 'array', items: { type: 'string' } } } } },
    education: { type: 'array', items: { type: 'object', properties: { degree: str(), field: str(), school: str(), start: str(), end: str(), details: str() } } },
    certifications: { type: 'array', items: { type: 'object', properties: { name: str(), issuer: str(), date: str() } } },
    skills: { type: 'array', items: { type: 'object', properties: { group: str('e.g. "Platforms"'), items: { type: 'array', items: { type: 'string' } } } } },
    extra: { type: 'array', items: { type: 'object', properties: { heading: str(), items: { type: 'array', items: { type: 'string' } } } } },
    sectionOrder: { type: 'array', items: { type: 'string', enum: ['summary', 'experience', 'projects', 'skills', 'education', 'certifications', 'extra'] } }
  },
  required: ['name', 'experience']
};

const TOOLS = [
  { name: 'onward_get_profile', description: 'Get the user\'s profile (contact info, preferred email, links, work authorisation, targets), their base resume text, and their list of certificates, degrees and other credentials.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'onward_update_profile', description: 'Save profile details the user told you (contact info, preferred email, targets, work authorisation, salary expectation, etc.). Only fields you pass are changed.', inputSchema: { type: 'object', properties: {
    name: str(), headline: str(), email: str('Preferred email for applications'), phone: str(), location: str(),
    street: str(), city: str(), state: str('2-letter, e.g. CO'), zip: str(), country: str(), currentTitle: str(), currentCompany: str(), highestEducation: str(),
    howHeard: str('Default answer to "How did you hear about us?"'), eeo: str('"decline" to decline voluntary self-identification questions, or "ask"'),
    links: { type: 'object', properties: { linkedin: str(), portfolio: str(), github: str(), website: str() } },
    workAuthorization: str(), needsSponsorship: str(), willingToRelocate: str(), salaryExpectation: str(), noticePeriod: str(), yearsExperience: str(),
    targetRoles: { type: 'array', items: { type: 'string' } }, targetLocations: { type: 'array', items: { type: 'string' } },
    workplace: { type: 'array', items: { type: 'string' } }, minSalary: str(), notes: str() } } },
  { name: 'onward_get_document', description: 'Read one of the user\'s documents in full: "base_resume" or a credential id from onward_get_profile. Images come back as images.', inputSchema: { type: 'object', properties: { id: str('"base_resume" or a credential id') }, required: ['id'] }, annotations: { readOnlyHint: true } },

  { name: 'onward_list_jobs', description: 'List the jobs on the Onward board (newest first) with status and key details.', inputSchema: { type: 'object', properties: { status: str('Only this status: saved, tailoring, ready, applied, interview, offer, rejected, withdrawn'), query: str('Filter by text in title/company') } }, annotations: { readOnlyHint: true } },
  { name: 'onward_get_job', description: 'Get everything saved about one job, including what was submitted and its files.', inputSchema: { type: 'object', properties: { id: str('Job id or posting URL') }, required: ['id'] }, annotations: { readOnlyHint: true } },
  { name: 'onward_save_job', description: 'Put a job on the Onward board. Easiest: pass listingId from onward_search_jobs (everything is filled in for you). Or pass the details yourself, or id to update an existing job. Returns the job id.', inputSchema: { type: 'object', properties: { listingId: str('Listing id from onward_search_jobs, e.g. "li:4473112151"'), id: str('Existing job id to update'), ...JOB_PROPS }, required: [] } },
  { name: 'onward_set_job_status', description: 'Move a job to a new status.', inputSchema: { type: 'object', properties: { id: str(), status: str('', { enum: ['saved', 'tailoring', 'ready', 'applied', 'interview', 'offer', 'rejected', 'withdrawn'] }), note: str('Optional note for the timeline') }, required: ['id', 'status'] } },
  { name: 'onward_save_contact', description: 'Save a person for a job (recruiter, hiring manager, referral). Updates them if already saved.', inputSchema: { type: 'object', properties: { jobId: str(), name: str(), title: str('Their job title'), email: str(), phone: str(), linkedin: str('LinkedIn profile URL'), role: str('e.g. Recruiter, Hiring manager, Referral'), notes: str() }, required: ['jobId'] } },
  { name: 'onward_save_message', description: 'Save a tailored outreach message draft to a contact. The user reviews and sends it from Onward (email or LinkedIn).', inputSchema: { type: 'object', properties: { jobId: str(), contactId: str(), channel: str('email, linkedin (message) or connect (connection note, ≤300 chars)', { enum: ['email', 'linkedin', 'connect'] }), subject: str('Email subject'), body: str() }, required: ['jobId', 'contactId', 'body'] } },
  { name: 'onward_add_note', description: 'Add a note to a job\'s timeline (e.g. recruiter call, follow-up date).', inputSchema: { type: 'object', properties: { id: str(), text: str() }, required: ['id', 'text'] } },

  { name: 'onward_save_tailored_resume', description: 'Save a resume tailored to a job. Onward writes it as PDF and Word (.docx) into that job\'s folder and shows it on the job card.', inputSchema: { type: 'object', properties: { jobId: str(), resume: RESUME, changes: str('Short summary of what you tailored and why') }, required: ['jobId', 'resume'] } },
  { name: 'onward_save_cover_letter', description: 'Save a cover letter for a job (PDF + .docx in the job\'s folder). Paragraphs separated by blank lines; no address block needed.', inputSchema: { type: 'object', properties: { jobId: str(), text: str('Letter body from greeting to sign-off') }, required: ['jobId', 'text'] } },
  { name: 'onward_record_application', description: 'Record what went into an application: answers you filled, files attached, which resume/email was used. Set submitted=true only after the user has pressed submit.', inputSchema: { type: 'object', properties: {
    jobId: str(), answers: { type: 'array', items: { type: 'object', properties: { question: str(), answer: str() } } },
    attachments: { type: 'array', items: { type: 'string' }, description: 'File names attached' },
    resumeUsed: str('tailored or base', { enum: ['tailored', 'base'] }), coverLetterUsed: { type: 'boolean' }, emailUsed: str(), portal: str('e.g. LinkedIn Easy Apply, Greenhouse, Workday'),
    submitted: { type: 'boolean' } }, required: ['jobId'] } },

  { name: 'onward_search_jobs', description: 'Search job listings inside Onward (LinkedIn, optionally Indeed). Returns a compact list with listing ids — no browser needed.', inputSchema: { type: 'object', properties: {
    keywords: str(), location: str('City, state or "United States"'), posted: str('', { enum: ['day', 'week', 'month', 'any'] }),
    workplace: { type: 'array', items: { type: 'string', enum: ['Remote', 'Hybrid', 'On-site'] } },
    experience: { type: 'array', items: { type: 'string', enum: ['internship', 'entry', 'associate', 'mid', 'director', 'executive'] } },
    easyApply: { type: 'boolean', description: 'LinkedIn Easy Apply only' }, sort: str('', { enum: ['relevant', 'recent'] }),
    sources: { type: 'array', items: { type: 'string', enum: ['linkedin', 'indeed'] }, description: 'Default ["linkedin"]' },
    page: { type: 'number', description: '0 for the first 20 results, 1 for the next…' } }, required: ['keywords'] }, annotations: { readOnlyHint: true } },
  { name: 'onward_get_listing', description: 'Full details of a listing from onward_search_jobs: description, pay, experience, apply type, contacts, keyword match with the resume.', inputSchema: { type: 'object', properties: { id: str('Listing id, e.g. "li:4473112151"') }, required: ['id'] }, annotations: { readOnlyHint: true } },
  { name: 'onward_autofill', description: 'On the open application page: fill every field Onward can answer from the profile (name, contact, address, links, work authorization, sponsorship, salary, EEO "decline"…) and list only the fields still empty, with refs. Run it on each page of an application.', inputSchema: { type: 'object', properties: { jobId: str('The job this application is for') } } },
  { name: 'onward_browser_open', description: 'Open a URL in Onward\'s browser (the user watches it happen). Pass jobId when this is the application for a saved job.', inputSchema: { type: 'object', properties: { url: str(), newTab: { type: 'boolean' }, jobId: str() }, required: ['url'] } },
  { name: 'onward_browser_read', description: 'Read the current page: text plus interactive elements with refs (fields with labels, current values, options and required flags; buttons; links when asked). Works across embedded application iframes.', inputSchema: { type: 'object', properties: {
    include: { type: 'array', items: { type: 'string', enum: ['fields', 'buttons', 'links'] }, description: 'Default ["fields","buttons"]. Add "links" for search results.' },
    text: { type: 'boolean', description: 'Include page text (default true)' }, maxText: { type: 'number', description: 'Max characters of text (default 12000)' } } }, annotations: { readOnlyHint: true } },
  { name: 'onward_browser_fill', description: 'Fill form fields by ref. Text inputs, textareas, selects (match by option text), checkboxes (true/false), radio groups (option text) and rich text boxes.', inputSchema: { type: 'object', properties: { fields: { type: 'array', items: { type: 'object', properties: { ref: str(), value: { type: ['string', 'number', 'boolean'] } }, required: ['ref', 'value'] } }, jobId: str() }, required: ['fields'] } },
  { name: 'onward_browser_type', description: 'Type text with real keystrokes into a field (for autocomplete boxes like location or school that ignore normal filling). Optionally press a key after.', inputSchema: { type: 'object', properties: { ref: str(), text: str(), thenKey: str('e.g. Enter, ArrowDown, Tab') }, required: ['ref', 'text'] } },
  { name: 'onward_browser_key', description: 'Press a key in the page: Enter, Tab, Escape, ArrowDown, ArrowUp, Backspace.', inputSchema: { type: 'object', properties: { key: str() }, required: ['key'] } },
  { name: 'onward_browser_click', description: 'Click a button, link, tab or option by ref. Final "Submit application" buttons are highlighted for the user instead of clicked.', inputSchema: { type: 'object', properties: { ref: str() }, required: ['ref'] } },
  { name: 'onward_browser_upload', description: 'Attach a file to a file field / dropzone: the tailored resume or cover letter for a job, the base resume, or a credential.', inputSchema: { type: 'object', properties: {
    ref: str('File input or dropzone ref'), file: str('"tailored_resume", "cover_letter", "base_resume" or "credential:<id>"'), jobId: str('Needed for tailored_resume / cover_letter'), format: str('pdf (default) or docx', { enum: ['pdf', 'docx'] }) }, required: ['ref', 'file'] } },
  { name: 'onward_browser_scroll', description: 'Scroll the page (or the biggest scrolling list, e.g. LinkedIn results, with inner=true), or scroll an element into view.', inputSchema: { type: 'object', properties: { direction: str('', { enum: ['down', 'up'] }), pages: { type: 'number' }, inner: { type: 'boolean' }, ref: str() } } },
  { name: 'onward_browser_back', description: 'Go back one page in Onward\'s browser.', inputSchema: { type: 'object', properties: {} } },
  { name: 'onward_browser_screenshot', description: 'See the current page as an image (use when the text read is confusing).', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }
];

module.exports = { TOOLS, INSTRUCTIONS };
