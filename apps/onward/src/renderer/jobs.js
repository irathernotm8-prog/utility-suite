/* Onward — Jobs board and job details */
(() => {
  const A = window.App;
  const { $, $$, esc } = A;
  const root = () => $('#view-jobs');
  let filter = 'active', query = '', openId = null;

  const FILTERS = {
    active: { label: 'Active', test: j => ['saved', 'tailoring', 'ready'].includes(j.status) },
    applied: { label: 'Applied', test: j => j.status === 'applied' },
    interview: { label: 'Interviewing', test: j => ['interview', 'offer'].includes(j.status) },
    closed: { label: 'Closed', test: j => ['rejected', 'withdrawn'].includes(j.status) },
    all: { label: 'All', test: () => true }
  };

  function init() {
    filter = A.state.ui.filter || 'active';
    root().innerHTML = `
      <div class="topbar drag"><h1>Your search</h1><div class="spacer"></div>
        <div class="searchbox no-drag">${icon('search')}<input class="input" id="jobSearch" placeholder="Search jobs"></div>
        <button class="btn primary" id="addJob">${icon('plus')}Add job</button></div>
      <div class="scroll"><div class="page" id="jobsPage"></div></div>`;
    $('#jobSearch').addEventListener('input', (e) => { query = e.target.value.toLowerCase(); renderList(); });
    $('#addJob').addEventListener('click', () => editJob());
    $('#scrim').addEventListener('click', close);
  }

  function render() {
    renderList();
    if (openId) openDrawer(openId, true);
  }

  function renderList() {
    const jobs = A.state.jobs;
    const page = $('#jobsPage');
    if (!page) return;
    const count = (k) => jobs.filter(FILTERS[k].test).length;
    const n = (st) => jobs.filter(j => st.includes(j.status)).length;
    if (!jobs.length) { page.innerHTML = emptyState(); bindEmpty(page); return; }
    const list = jobs.filter(FILTERS[filter].test).filter(j => !query || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(query));
    page.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="n">${n(['saved', 'tailoring', 'ready'])}</div><div class="l">In progress</div></div>
        <div class="stat"><div class="n">${n(['applied', 'interview', 'offer', 'rejected'])}</div><div class="l">Applications sent</div></div>
        <div class="stat hot"><div class="n">${n(['interview'])}</div><div class="l">Interviewing</div></div>
        <div class="stat"><div class="n">${n(['offer'])}</div><div class="l">Offers</div></div>
      </div>
      <div class="toolbar"><div class="seg" id="jobFilter">${Object.entries(FILTERS).map(([k, f]) => `<button data-f="${k}" class="${k === filter ? 'active' : ''}">${f.label}<span class="n">${count(k)}</span></button>`).join('')}</div></div>
      ${list.length ? `<div class="grid">${list.map(card).join('')}</div>` : `<div class="empty"><p>No ${FILTERS[filter].label.toLowerCase()} jobs${query ? ' match your search' : ''}.</p></div>`}`;
    $$('#jobFilter button', page).forEach(b => b.addEventListener('click', () => { filter = b.dataset.f; onward.saveUi({ filter }); renderList(); }));
    $$('.card', page).forEach(c => c.addEventListener('click', () => openDrawer(c.dataset.id)));
  }

  function card(j) {
    const s = j.submitted || {};
    const pay = A.pay(j.pay);
    const loc = [j.location, j.workplace && j.workplace !== 'Unknown' ? j.workplace : ''].filter(Boolean).join(' · ');
    const answers = s.answers?.length || 0;
    const people = (j.contacts || []).length;
    const sent = (j.contacts || []).filter(c => c.messages?.some(m => m.status === 'sent')).length;
    return `<article class="card ${A.fresh.has(j.id) ? 'fresh' : ''}" data-id="${j.id}">
      <div class="card-head">${A.logo(j)}<div style="min-width:0"><div class="company">${esc(j.company || 'Unknown company')}</div><div class="source">${esc(j.source || '')}${j.postedAt ? ' · ' + esc(j.postedAt) : ''}</div></div>
        <span class="status s-${j.status}">${esc(j.status)}</span></div>
      <h3 class="card-title">${esc(j.title || 'Untitled role')}</h3>
      <div class="chips">
        ${loc ? `<span class="chip">${icon('pin')}${esc(loc)}</span>` : ''}
        ${pay ? `<span class="chip pay">${icon('money')}${esc(pay)}</span>` : ''}
        ${j.experience ? `<span class="chip" title="${esc(j.experience)}">${icon('clock')}${esc(j.experience)}</span>` : ''}
        ${j.employmentType ? `<span class="chip">${icon('brief')}${esc(j.employmentType)}</span>` : ''}
      </div>
      ${j.fit?.score != null ? `<div class="fitbar" title="Fit ${Math.round(j.fit.score)}%"><i style="width:${Math.max(4, Math.min(100, j.fit.score))}%"></i></div>` : ''}
      <div class="submitted">
        <span class="sub ${s.resume ? 'on' : ''}" title="${s.resume ? 'Tailored resume saved' : 'No tailored resume yet'}">${icon('doc')}Resume</span>
        <span class="sub ${s.coverLetter ? 'on' : ''}" title="${s.coverLetter ? 'Cover letter saved' : 'No cover letter'}">${icon('letter')}Cover letter</span>
        <span class="sub ${answers ? 'on' : ''}" title="Answers filled in">${icon('list')}${answers ? answers + ' answers' : 'Answers'}</span>
        <span class="sub applied ${s.appliedAt ? 'on' : ''}" title="${s.appliedAt ? 'Applied ' + A.date(s.appliedAt) : 'Not applied yet'}">${icon('send')}${s.appliedAt ? A.date(s.appliedAt) : 'Not sent'}</span>
        ${people ? `<span class="sub on people" title="${people} contact${people > 1 ? 's' : ''}${sent ? ' · ' + sent + ' messaged' : ''}">${icon('person')}${people}${sent ? ' · ' + icon('check') : ''}</span>` : ''}
      </div>
    </article>`;
  }

  function emptyState() {
    const connected = A.state.claude?.configured || A.state.claude?.codexConfigured;
    const p = A.state.profile || {};
    const role = (p.targetRoles || [])[0], loc = (p.targetLocations || [])[0] || p.city;
    const ex = [`Find ${role ? role + ' jobs' : 'jobs that fit my Onward profile'}${loc ? ' in ' + loc : ''} posted this week and save the best fits to Onward`, 'Tailor my resume for the newest job on my Onward board, then message the hiring manager', 'Which of my applications should I follow up on?'];
    return `<div class="empty">
      <div class="mark"><svg viewBox="0 0 32 32"><path d="M6 22 L16 12 L26 22" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 15 L16 5 L26 15" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" opacity=".45"/></svg></div>
      <h2>Your next role starts here</h2>
      <p>Jobs you find in Discover — or that your AI finds — land on this board with the company, pay, experience, the people hiring, and exactly what was sent with each application.</p>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:18px">
        ${!A.state.baseResume ? `<button class="btn primary" data-go="profile">${icon('upload')}Add your resume</button>` : ''}
        <button class="btn ${A.state.baseResume ? 'primary' : ''}" data-go="discover">${icon('search')}Find jobs</button>
        ${!connected ? `<button class="btn" data-go="settings">${icon('plug')}Connect Claude or ChatGPT</button>` : ''}
      </div>
      <div class="prompts">${ex.map(t => `<div class="prompt">${icon('spark')}<span>“${esc(t)}”</span><button class="btn sm ghost" data-copy="${esc(t)}">${icon('copy')}</button></div>`).join('')}</div>
      <p class="hint" style="margin-top:12px">Try asking Claude or Codex things like these once connected.</p>
    </div>`;
  }
  function bindEmpty(page) {
    $$('[data-go]', page).forEach(b => b.addEventListener('click', () => A.show(b.dataset.go)));
    $$('[data-copy]', page).forEach(b => b.addEventListener('click', () => { onward.claude.copy(b.dataset.copy); A.toast('Copied — paste it into your AI chat'); }));
  }

  // ---------- drawer ----------
  function openDrawer(id, refresh) {
    const j = A.state.jobs.find(x => x.id === id);
    if (!j) { close(); return; }
    openId = id;
    const d = $('#drawer');
    const s = j.submitted || {};
    const ci = j.companyInfo || {};
    const pay = A.pay(j.pay);
    const list = (arr) => arr?.length ? `<ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
    const kv = (pairs) => `<dl class="kv">${pairs.filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
    const file = (label, f, ic) => f ? `<div class="file">${icon(ic)}<div class="name">${esc(label)}<div class="meta">${A.ago(f.at)}${f.changes ? ' · ' + esc(f.changes) : ''}</div></div>
      ${f.pdf ? `<button class="btn sm" data-open="${esc(f.pdf)}">PDF</button>` : ''}${f.docx ? `<button class="btn sm" data-open="${esc(f.docx)}">Word</button>` : ''}</div>` : '';
    const scrollTop = refresh ? $('.d-body', d)?.scrollTop : 0;
    const details = [['Seniority', esc(j.seniority)], ['Industry', esc(j.industry)], ['Applicants', esc(j.applicants)], ['Posted', esc(j.postedAt)], ['Deadline', esc(j.deadline)],
      ['How to apply', j.applyType === 'easy' ? 'LinkedIn Easy Apply' : j.applyType === 'indeed' ? 'Indeed Apply' : j.applyType === 'offsite' ? 'On the company’s site' : ''], ['Notes', esc(j.notes)]];
    const busy = aiBusy === j.id;
    const desc = j.description || '';
    const canLoad = !desc && (j.listingId || /linkedin\.com\/jobs\/view/.test(j.url || ''));

    d.innerHTML = `
      <div class="d-head">
        <div class="top">${A.logo(j, 'lg')}<div style="flex:1;min-width:0"><div class="co">${esc(j.company || '')}${j.source ? ` <span class="source">· ${esc(j.source)}</span>` : ''}</div><h2>${esc(j.title || 'Untitled role')}</h2>
          <div class="chips">${j.location ? `<span class="chip">${icon('pin')}${esc(j.location)}</span>` : ''}${j.workplace ? `<span class="chip">${esc(j.workplace)}</span>` : ''}${pay ? `<span class="chip pay">${icon('money')}${esc(pay)}</span>` : ''}${j.experience ? `<span class="chip">${icon('clock')}${esc(j.experience)}</span>` : ''}${j.employmentType ? `<span class="chip">${esc(j.employmentType)}</span>` : ''}</div></div>
          <button class="btn icon ghost" id="dClose">${icon('x')}</button></div>
        <div class="d-actions">
          <select class="input" id="dStatus" style="width:150px;height:32px">${A.state.statuses.map(st => `<option value="${st}" ${st === j.status ? 'selected' : ''}>${st[0].toUpperCase() + st.slice(1)}</option>`).join('')}</select>
          ${!s.appliedAt && (j.url || j.applyUrl) ? `<button class="btn primary" id="dApply">${icon('send')}Apply with guide</button>` : ''}
          ${j.url ? `<button class="btn" id="dOpen">${icon('globe')}Posting</button>` : ''}
          ${!s.appliedAt ? `<button class="btn" id="dApplied">${icon('check')}Mark applied</button>` : ''}
          ${j.folder ? `<button class="btn" id="dFolder">${icon('folder')}Folder</button>` : ''}
          <button class="btn ghost" id="dEdit">Edit</button>
          <button class="btn ghost danger" id="dDelete">${icon('trash')}</button>
        </div>
        <div class="d-ai ${busy ? 'busy' : ''}">
          <span class="d-ai-label">${icon('spark')}${busy ? esc(aiLabel) + '…' : 'AI · ' + esc(A.AI.engineLabel())}</span>
          <button class="chip-btn" data-ai="tailor" ${busy ? 'disabled' : ''}>${icon('doc')}${s.resume ? 'Re-tailor resume' : 'Tailor resume'}</button>
          <button class="chip-btn" data-ai="cover" ${busy ? 'disabled' : ''}>${icon('letter')}Cover letter</button>
          <button class="chip-btn" data-ai="fit" ${busy ? 'disabled' : ''}>${icon('spark')}Check fit</button>
          ${(j.contacts || []).length ? `<button class="chip-btn" data-ai="message" ${busy ? 'disabled' : ''}>${icon('send')}Message ${esc((j.contacts[0].name || j.contacts[0].email || 'contact').split(' ')[0])}</button>` : ''}
        </div>
      </div>
      <div class="d-body">
        <div class="d-sec"><h3>${icon('send')}What was submitted</h3>
          ${s.appliedAt ? `<p><b style="color:var(--info)">Applied ${A.date(s.appliedAt)}</b>${s.portal ? ' via ' + esc(s.portal) : ''}${s.emailUsed ? ' · using ' + esc(s.emailUsed) : ''}</p>` : `<p class="missing">Not submitted yet.</p>`}
          <div class="files">${file('Tailored resume', s.resume, 'doc')}${file('Cover letter', s.coverLetter, 'letter')}</div>
          ${!s.resume && !s.coverLetter ? `<p class="hint">Press <b>Tailor resume</b> above (or ask your connected AI) — it appears here as PDF and Word, ready to attach.</p>` : ''}
          ${s.resumeUsed ? `<p class="hint" style="margin-top:8px">Resume used: ${esc(s.resumeUsed)}${s.coverLetterUsed ? ' · with cover letter' : ''}</p>` : ''}
          ${s.attachments?.length ? `<p class="hint">Attached: ${s.attachments.map(esc).join(', ')}</p>` : ''}
          ${s.answers?.length ? `<h3 style="margin-top:16px">${icon('list')}Answers</h3><div class="qa">${s.answers.map(a => `<div><b>${esc(a.question)}</b>${esc(a.answer)}</div>`).join('')}</div>` : ''}
        </div>
        ${A.People.section(j)}
        ${desc ? `<div class="d-sec"><h3>${icon('brief')}The posting</h3><div class="desc clamp" id="dDesc">${esc(desc)}</div><button class="btn sm ghost" id="dMore">Show all</button></div>` : canLoad ? `<div class="d-sec"><h3>${icon('brief')}The posting</h3><button class="btn sm" id="dLoad">${icon('reload')}Load the full posting</button></div>` : ''}
        ${(!desc && j.summary) || j.highlights?.length || j.requirements?.length ? `<div class="d-sec"><h3>${icon('brief')}The role</h3>${!desc && j.summary ? `<p>${esc(j.summary)}</p>` : ''}${j.highlights?.length ? `<p class="hint">Highlights</p>${list(j.highlights)}` : ''}${j.requirements?.length ? `<p class="hint" style="margin-top:10px">Requirements</p>${list(j.requirements)}` : ''}</div>` : ''}
        ${ci.about || ci.industry || ci.size || ci.website || ci.hq ? `<div class="d-sec"><h3>${icon('building')}About ${esc(j.company || 'the company')}</h3>${ci.about ? `<p>${esc(ci.about)}</p>` : ''}${kv([['Industry', esc(ci.industry)], ['Size', esc(ci.size)], ['Headquarters', esc(ci.hq)], ['Website', ci.website ? `<a href="#" data-ext="${esc(/^https?:/.test(ci.website) ? ci.website : 'https://' + ci.website)}" style="color:var(--accent-2)">${esc(ci.website)}</a>` : '']])}</div>` : ''}
        ${j.fit?.keywordMatch != null && j.fit?.score == null ? `<div class="d-sec"><h3>${icon('spark')}Keyword match · ${j.fit.keywordMatch}%</h3><div class="fitbar" style="margin-bottom:10px"><i style="width:${Math.max(4, j.fit.keywordMatch)}%"></i></div><div class="kw">${(j.fit.matched || []).map(w => `<span class="hit">${esc(w)}</span>`).join('')}${(j.fit.missing || []).map(w => `<span class="miss">${esc(w)}</span>`).join('')}</div></div>` : ''}
        ${j.fit?.score != null ? `<div class="d-sec"><h3>${icon('spark')}Fit · ${Math.round(j.fit.score)}%</h3><div class="fitbar" style="margin-bottom:12px"><i style="width:${j.fit.score}%"></i></div>${j.fit.reasons?.length ? `<p class="hint">Why it fits</p>${list(j.fit.reasons)}` : ''}${j.fit.gaps?.length ? `<p class="hint" style="margin-top:10px">Gaps to address</p>${list(j.fit.gaps)}` : ''}</div>` : ''}
        ${details.some(([, v]) => v) ? `<div class="d-sec"><h3>${icon('note')}Details</h3>${kv(details)}</div>` : ''}
        <div class="d-sec"><h3>${icon('clock')}Timeline</h3>
          <div class="timeline">${[...(j.timeline || [])].reverse().map(t => `<div class="tl"><time>${A.date(t.at)}</time><span>${esc(t.text)}</span></div>`).join('')}</div>
          <div class="note-row"><input class="input" id="dNote" placeholder="Add a note — e.g. “Recruiter call Tue 2pm”"><button class="btn" id="dAddNote">Add</button></div>
        </div>
      </div>`;
    $('#scrim').classList.add('open');
    d.classList.add('open');
    if (refresh) $('.d-body', d).scrollTop = scrollTop;

    $('#dClose').onclick = close;
    $('#dStatus').onchange = async (e) => { await onward.setStatus(j.id, e.target.value); };
    $('#dOpen') && ($('#dOpen').onclick = () => { A.views.browser.open(j.url, { jobId: j.id }); close(); });
    $('#dApply') && ($('#dApply').onclick = () => { close(); A.views.guide.start(j.id); });
    $$('[data-ai]', d).forEach(b => b.onclick = () => b.dataset.ai === 'message' ? A.People.compose(j.id, j.contacts[0].id) : runAi(b.dataset.ai, j.id));
    $('#dMore') && ($('#dMore').onclick = (e) => { $('#dDesc').classList.toggle('clamp'); e.target.textContent = $('#dDesc').classList.contains('clamp') ? 'Show all' : 'Show less'; });
    $('#dLoad') && ($('#dLoad').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Loading…'; try { await onward.fillDetails(j.id); await A.load(); openDrawer(j.id, true); } catch (err) { A.toast(clean(err)); e.target.disabled = false; } });
    A.People.bind(d, j);
    A.AI?.render();
    $('#dApplied') && ($('#dApplied').onclick = async () => { await onward.markApplied(j.id); A.toast('Marked as applied'); });
    $('#dFolder') && ($('#dFolder').onclick = () => onward.showFile(j.folder));
    $('#dEdit').onclick = () => editJob(j);
    $('#dDelete').onclick = () => A.modal(`<h2>Remove this job?</h2><p style="color:var(--text-2)">${esc(j.title)} at ${esc(j.company)} will be removed from the board. Its files stay in the Onward Files folder.</p><div class="foot"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Remove</button></div>`, (m, closeM) => {
      $('[data-x]', m).onclick = closeM;
      $('[data-ok]', m).onclick = async () => { await onward.removeJob(j.id); closeM(); close(); };
    });
    const addNote = async () => { const v = $('#dNote').value.trim(); if (!v) return; await onward.addNote(j.id, v); };
    $('#dAddNote').onclick = addNote;
    $('#dNote').onkeydown = (e) => { if (e.key === 'Enter') addNote(); };
    $$('[data-open]', d).forEach(b => b.onclick = () => onward.openFile(b.dataset.open));
    $$('[data-ext]', d).forEach(a => a.onclick = (e) => { e.preventDefault(); A.views.browser.open(a.dataset.ext); close(); });
  }

  function close() { openId = null; $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open'); A.AI?.render(); }

  // ---------- AI actions (in-app engine: ChatGPT/Claude/Gemini sign-in or API key) ----------
  let aiBusy = null, aiLabel = '';
  const clean = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  async function runAi(kind, jobId, extra = {}) {
    const job = A.state.jobs.find(j => j.id === jobId);
    if (!job) return;
    if (!A.state.baseResume && kind !== 'fit') { A.toast('Add your base resume in Profile first'); A.show('profile'); return; }
    if (aiBusy) { A.toast('Still working on the last one…'); return; }
    aiBusy = jobId; aiLabel = { tailor: 'Tailoring your resume', cover: 'Writing a cover letter', fit: 'Checking your fit', message: 'Writing your message' }[kind] || 'Working';
    if (openId === jobId) openDrawer(jobId, true);
    try {
      if (!job.description && (job.listingId || /linkedin\.com\/jobs\/view/.test(job.url || ''))) { try { await onward.fillDetails(jobId); } catch {} }
      const r = await A.AI.run(kind, { jobId, ...extra });
      A.fresh.add(jobId); setTimeout(() => A.fresh.delete(jobId), 6000);
      if (kind === 'tailor') A.toast('Tailored resume saved — PDF and Word are on the job' + (r.changes ? ': ' + r.changes : ''), 5000);
      if (kind === 'cover') A.toast('Cover letter saved to the job');
      if (kind === 'fit') A.toast(`Fit: ${r.fit?.score}%`);
      return r;
    } catch (e) { A.toast(clean(e), 6000); throw e; }
    finally { aiBusy = null; await A.load(); A.render(); if (openId === jobId) openDrawer(jobId, true); }
  }

  // ---------- add / edit ----------
  function editJob(j = {}, prefill = {}) {
    const v = { ...prefill, ...j };
    const f = (k, label, ph = '', wide = false) => `<label class="field ${wide ? 'wide' : ''}"><span>${label}</span><input class="input" name="${k}" value="${esc(v[k] || '')}" placeholder="${esc(ph)}"></label>`;
    A.modal(`<h2>${j.id ? 'Edit job' : 'Add a job'}</h2>
      <form class="form" id="jobForm">
        ${f('title', 'Job title', 'Senior Project Manager')}${f('company', 'Company', 'Acme')}
        ${f('url', 'Posting link', 'https://…', true)}
        ${f('location', 'Location', 'Denver, CO')}
        <label class="field"><span>Workplace</span><select class="input" name="workplace">${['', 'Remote', 'Hybrid', 'On-site'].map(o => `<option ${o === (v.workplace || '') ? 'selected' : ''} value="${o}">${o || '—'}</option>`).join('')}</select></label>
        <label class="field"><span>Pay</span><input class="input" name="pay" value="${esc(v.pay?.text || A.pay(v.pay) || '')}" placeholder="$85K–$100K/yr"></label>
        ${f('experience', 'Experience', '5+ years')}
        ${f('employmentType', 'Type', 'Full-time')}${f('postedAt', 'Posted', '2 days ago')}
        <label class="field wide"><span>Summary</span><textarea class="input" name="summary" rows="3">${esc(v.summary || '')}</textarea></label>
      </form>
      <p class="hint">Tip: Claude fills all of this in — plus company info — when it saves a job for you.</p>
      <div class="foot"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>${j.id ? 'Save' : 'Add job'}</button></div>`, (m, closeM) => {
      $('[data-x]', m).onclick = closeM;
      $('[data-ok]', m).onclick = async () => {
        const data = Object.fromEntries(new FormData($('#jobForm', m)).entries());
        if (!data.title && !data.url) { A.toast('Add at least a title or a link'); return; }
        data.pay = data.pay ? { text: data.pay } : undefined;
        if (j.id) data.id = j.id;
        const saved = await onward.saveJob(data);
        closeM();
        await A.load(); A.render();
        openDrawer(saved.id);
      };
      $('input', m)?.focus();
    });
  }

  A.views.jobs = { init, render, close, openDrawer, editJob, runAi, openId: () => openId };
})();
