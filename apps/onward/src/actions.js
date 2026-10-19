// Onward — actions shared by the in-app AI and connected assistants (Claude, Codex)
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const D = require('./data');
const Docs = require('./documents');

async function saveTailoredResume(jobId, resume, changes, by = 'ai') {
  const j = D.findJob(jobId);
  if (!j) throw new Error('No job with id ' + jobId + ' — save the job first.');
  const r = Docs.normResume(resume, D.store.profile);
  if (!r.experience.length) throw new Error('The resume has no experience section.');
  const dir = D.jobFolder(j);
  const base = D.safeName(`${r.name || 'Resume'} - Resume - ${j.company || 'Company'}`, 90);
  const letter = D.store.settings.pageLetter !== false;
  const pdf = path.join(dir, base + '.pdf'), docx = path.join(dir, base + '.docx');
  await Docs.htmlToPdf(Docs.resumeHtml(r, { letter }), pdf, app.getPath('temp'));
  await Docs.resumeDocx(r, docx, { letter });
  fs.writeFileSync(path.join(dir, 'resume.json'), JSON.stringify(resume, null, 2));
  j.submitted = { ...(j.submitted || {}), resume: { pdf, docx, at: D.now(), changes: changes || '' } };
  if (j.status === 'saved') j.status = 'tailoring';
  j.timeline.push({ at: D.now(), text: `${by === 'claude' ? 'Your AI' : 'AI'} tailored the resume${changes ? ': ' + changes : ''}` });
  D.writeJobSnapshot(j);
  D.save('jobs');
  return { job: j, pdf, docx };
}

async function saveCoverLetter(jobId, body, by = 'ai') {
  const j = D.findJob(jobId);
  if (!j) throw new Error('No job with id ' + jobId);
  const p = D.store.profile;
  const dir = D.jobFolder(j);
  const base = D.safeName(`${p.name || 'Cover Letter'} - Cover Letter - ${j.company || 'Company'}`, 90);
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const letter = D.store.settings.pageLetter !== false;
  const o = { text: body, profile: p, company: j.company, title: j.title, date };
  const pdf = path.join(dir, base + '.pdf'), docx = path.join(dir, base + '.docx');
  await Docs.htmlToPdf(Docs.letterHtml(o, { letter }), pdf, app.getPath('temp'));
  await Docs.letterDocx(o, docx, { letter });
  fs.writeFileSync(path.join(dir, 'cover-letter.txt'), body);
  j.submitted = { ...(j.submitted || {}), coverLetter: { pdf, docx, at: D.now() } };
  j.timeline.push({ at: D.now(), text: `${by === 'claude' ? 'Your AI' : 'AI'} wrote a cover letter` });
  D.save('jobs');
  return { job: j, pdf, docx };
}

module.exports = { saveTailoredResume, saveCoverLetter };
