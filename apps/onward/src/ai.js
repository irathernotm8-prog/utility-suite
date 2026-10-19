// Onward — the in-app AI. Builds prompts from the user's profile + the job, and turns replies into
// resumes, letters, messages and answers. The model is either:
//   • a chat site the user is signed in to (ChatGPT, Claude or Gemini) in Onward's AI panel — no API key, or
//   • an API key (OpenAI or Anthropic), stored encrypted with the system keychain.
const { safeStorage } = require('electron');
const D = require('./data');
const Actions = require('./actions');

const OPENAI_BASE = process.env.ONWARD_OPENAI_BASE || 'https://api.openai.com';
const ANTHROPIC_BASE = process.env.ONWARD_ANTHROPIC_BASE || 'https://api.anthropic.com';

// ---------- keys ----------
function encryptKey(plain) {
  if (!plain) return '';
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(plain).toString('base64');
  return 'raw:' + Buffer.from(plain).toString('base64');
}
function decryptKey(stored) {
  if (!stored) return '';
  try {
    if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    if (stored.startsWith('raw:')) return Buffer.from(stored.slice(4), 'base64').toString();
  } catch {}
  return '';
}
function setKey(provider, key) {
  const k = provider === 'openai' ? 'openaiKey' : 'anthropicKey';
  D.store.settings.ai = { ...D.store.settings.ai, [k]: key ? encryptKey(key.trim()) : '' };
  D.save('settings');
}
function publicSettings() {
  const a = D.store.settings.ai;
  return { ...a, openaiKey: undefined, anthropicKey: undefined, hasOpenaiKey: !!a.openaiKey, hasAnthropicKey: !!a.anthropicKey };
}

// ---------- API calls ----------
async function callApi(prompt, { system, maxTokens = 4000 } = {}) {
  const a = D.store.settings.ai;
  if (a.engine === 'openai') {
    const key = decryptKey(a.openaiKey);
    if (!key) throw new Error('Add your OpenAI API key in Connect AI.');
    const res = await fetch(OPENAI_BASE + '/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: a.openaiModel || 'gpt-5-mini', messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }] })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('OpenAI: ' + (j.error?.message || res.statusText));
    return j.choices?.[0]?.message?.content || '';
  }
  if (a.engine === 'anthropic') {
    const key = decryptKey(a.anthropicKey);
    if (!key) throw new Error('Add your Anthropic API key in Connect AI.');
    const res = await fetch(ANTHROPIC_BASE + '/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: a.anthropicModel || 'claude-haiku-5-5', max_tokens: maxTokens, ...(system ? { system } : {}), messages: [{ role: 'user', content: prompt }] })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Anthropic: ' + (j.error?.message || res.statusText));
    return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  }
  throw new Error('No API engine selected.');
}

// ---------- prompts ----------
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '\n…' : s; };
function profileBlock() {
  const p = D.store.profile;
  const lines = [
    `Name: ${p.name}`, p.headline && `Headline: ${p.headline}`, `Email: ${p.email}`, p.phone && `Phone: ${p.phone}`,
    `Location: ${p.location || [p.city, p.state].filter(Boolean).join(', ')}`,
    ...Object.entries(p.links || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
    p.currentTitle && `Current title: ${p.currentTitle}${p.currentCompany ? ' at ' + p.currentCompany : ''}`,
    p.yearsExperience && `Years of experience: ${p.yearsExperience}`,
    p.workAuthorization && `Work authorization: ${p.workAuthorization}`, p.needsSponsorship && `Needs sponsorship: ${p.needsSponsorship}`,
    p.willingToRelocate && `Willing to relocate: ${p.willingToRelocate}`, p.salaryExpectation && `Salary expectation: ${p.salaryExpectation}`,
    p.noticePeriod && `Notice/start: ${p.noticePeriod}`, p.targetRoles?.length && `Target roles: ${p.targetRoles.join(', ')}`,
    p.notes && `Notes from the candidate: ${p.notes}`
  ].filter(Boolean);
  return lines.join('\n');
}
function credentialsBlock() {
  const c = D.store.credentials;
  if (!c.length) return 'None listed.';
  return c.map(x => `- ${x.type}: ${x.title}${x.issuer ? ', ' + x.issuer : ''}${x.date ? ' (' + x.date + ')' : ''}${x.text ? '\n  ' + clip(x.text.replace(/\s+/g, ' '), 300) : ''}`).join('\n');
}
function jobBlock(j) {
  const desc = j.description || [j.summary, j.highlights?.length && 'Highlights:\n- ' + j.highlights.join('\n- '), j.requirements?.length && 'Requirements:\n- ' + j.requirements.join('\n- ')].filter(Boolean).join('\n\n');
  return [`Title: ${j.title}`, `Company: ${j.company}`, j.location && `Location: ${j.location}${j.workplace ? ' (' + j.workplace + ')' : ''}`,
    j.pay?.text && `Pay: ${j.pay.text}`, j.experience && `Experience: ${j.experience}`, j.seniority && `Seniority: ${j.seniority}`,
    j.companyInfo?.about && `About the company: ${j.companyInfo.about}`, '', 'Posting:', clip(desc || '(no description saved)', 9000)].filter(x => x !== undefined && x !== false && x !== null).join('\n');
}
const RESUME_SHAPE = `{"name":"","headline":"","contact":{"email":"","phone":"","location":"","links":[{"label":"LinkedIn","url":""}]},"summary":"","experience":[{"title":"","company":"","location":"","start":"","end":"","bullets":[""]}],"projects":[],"education":[{"degree":"","field":"","school":"","start":"","end":"","details":""}],"certifications":[{"name":"","issuer":"","date":""}],"skills":[{"group":"","items":[""]}],"sectionOrder":["summary","experience","skills","education","certifications"],"changes":"one sentence on what you tailored"}`;
const TRUTH = 'Use ONLY facts from the candidate\'s resume, credentials and profile. Never invent employers, titles, dates, degrees, certifications, numbers or skills. You may reword, reorder and emphasise.';

function build(kind, args = {}) {
  const j = args.jobId ? D.findJob(args.jobId) : null;
  if (args.jobId && !j) throw new Error('That job is no longer on your board.');
  const resume = clip(D.store.baseResume?.text || '(no base resume uploaded)', 12000);
  switch (kind) {
    case 'tailor': return { json: true, title: 'Tailoring your resume', prompt:
`You are an expert resume writer. Tailor this candidate's resume to the job below so it passes applicant-tracking systems and reads well to a hiring manager.
${TRUTH} Keep it to one page worth of content: 3–6 strong bullets for recent roles, fewer for older ones. Mirror the posting's key terms where they are true for the candidate.

Reply with ONLY one JSON object in this shape (no commentary):
${RESUME_SHAPE}

CANDIDATE PROFILE
${profileBlock()}

BASE RESUME
${resume}

CREDENTIALS
${credentialsBlock()}

JOB
${jobBlock(j)}` };
    case 'cover': return { json: false, title: 'Writing a cover letter', prompt:
`Write a concise, specific cover letter (220–320 words) for this candidate and job. ${TRUTH}
Open with why this role/company, connect 2–3 concrete achievements to the job's needs, close with a confident call to action. Plain text, paragraphs separated by blank lines, from "Dear …" to the sign-off with the candidate's name. Reply with ONLY the letter.

CANDIDATE PROFILE
${profileBlock()}

BASE RESUME
${resume}

JOB
${jobBlock(j)}` };
    case 'message': {
      const c = (j?.contacts || []).find(x => x.id === args.contactId) || {};
      const ch = args.channel || 'email';
      const limits = { email: 'Email: subject line plus a 90–150 word body.', linkedin: 'LinkedIn message: no subject, 60–110 words.', connect: 'LinkedIn connection note: no subject, MAXIMUM 280 characters including spaces.' };
      return { json: true, title: 'Writing your message', prompt:
`Write a short, warm, professional outreach message from the candidate to ${c.name || 'the hiring contact'}${c.title ? ' (' + c.title + ')' : ''} about the ${j.title} role at ${j.company}.
${limits[ch] || limits.email} Goal: ${args.goal || (j.submitted?.appliedAt ? 'follow up on the application they already submitted' : 'introduce themselves and express interest before/while applying')}.
Be specific: mention one or two relevant achievements from the resume and something concrete from the posting. No flattery, no clichés, no placeholders like [Company]. ${TRUTH}${args.tone ? ' Tone: ' + args.tone + '.' : ''}
Reply with ONLY JSON: {"subject":"","body":""}

CANDIDATE PROFILE
${profileBlock()}

BASE RESUME
${clip(resume, 6000)}

JOB
${jobBlock(j)}` };
    }
    case 'answer': return { json: false, title: 'Drafting an answer', prompt:
`Answer this job application question in the candidate's voice, first person.
${TRUTH} ${args.options?.length ? 'It is multiple choice — reply with exactly one of these options: ' + args.options.join(' | ') + '.' : args.maxLength ? `Keep it under ${args.maxLength} characters.` : 'Keep it to 2–5 sentences unless the question asks for more.'}
If the answer isn't in the candidate's information, give your best honest, general answer and keep it short. Reply with ONLY the answer text.

QUESTION
${args.question}

CANDIDATE PROFILE
${profileBlock()}

BASE RESUME
${clip(resume, 7000)}

JOB
${j ? jobBlock(j) : '(not linked to a saved job)'}` };
    case 'fit': return { json: true, title: 'Checking your fit', prompt:
`Assess honestly how well this candidate fits the job. Reply with ONLY JSON:
{"score":0-100,"reasons":["up to 4 short reasons it fits"],"gaps":["up to 3 short gaps or risks, with how to address each"]}

CANDIDATE PROFILE
${profileBlock()}

BASE RESUME
${clip(resume, 7000)}

JOB
${jobBlock(j)}` };
    default: throw new Error('Unknown AI task ' + kind);
  }
}

// Pull the JSON object out of a chat reply (code fences, "json Copy code" headers, chatter…)
function parseJson(text) {
  const s = String(text || '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const candidates = [fenced && fenced[1], s];
  for (const c of candidates) {
    if (!c) continue;
    const a = c.indexOf('{'), b = c.lastIndexOf('}');
    if (a < 0 || b <= a) continue;
    const raw = c.slice(a, b + 1);
    for (const attempt of [raw, raw.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1')]) {
      try { return JSON.parse(attempt); } catch {}
    }
  }
  throw new Error('The AI\'s reply wasn\'t in the expected format. Try again.');
}
const cleanText = (t) => String(t || '').replace(/^```[a-z]*\n?|```$/g, '').replace(/^(here(’|')s|sure[,!]?|certainly[,!]?)[^\n]*\n+/i, '').trim();

async function finish(kind, args, reply) {
  switch (kind) {
    case 'tailor': {
      const r = parseJson(reply);
      const { changes, ...resume } = r;
      const out = await Actions.saveTailoredResume(args.jobId, resume, changes);
      return { ok: true, pdf: out.pdf, docx: out.docx, changes };
    }
    case 'cover': {
      const body = cleanText(reply);
      const out = await Actions.saveCoverLetter(args.jobId, body);
      return { ok: true, pdf: out.pdf, docx: out.docx, text: body };
    }
    case 'message': {
      const m = parseJson(reply);
      let body = String(m.body || '').trim();
      if (args.channel === 'connect' && body.length > 300) body = body.slice(0, 297).replace(/\s+\S*$/, '') + '…';
      const saved = D.saveMessage(args.jobId, args.contactId, { id: args.messageId, channel: args.channel || 'email', subject: (args.channel || 'email') === 'email' ? (m.subject || '') : '', body });
      return { ok: true, message: saved.message };
    }
    case 'answer': return { ok: true, text: cleanText(reply) };
    case 'fit': {
      const f = parseJson(reply);
      const j = D.findJob(args.jobId);
      j.fit = { score: Math.max(0, Math.min(100, Number(f.score) || 0)), reasons: f.reasons || [], gaps: f.gaps || [] };
      D.save('jobs');
      return { ok: true, fit: j.fit };
    }
  }
  throw new Error('Unknown AI task ' + kind);
}

module.exports = { build, finish, callApi, setKey, publicSettings, parseJson };
