/* Onward — Profile: contact info, preferences, base resume, credentials */
(() => {
  const A = window.App;
  const { $, $$, esc } = A;
  const root = () => $('#view-profile');
  const TYPES = ['Degree', 'Certificate', 'License', 'Portfolio', 'Reference', 'Other'];
  const TYPE_ICON = { Degree: 'cap', Certificate: 'award', License: 'award', Portfolio: 'brief', Reference: 'letter', Other: 'doc' };

  function init() {
    root().innerHTML = `
      <div class="topbar drag"><h1>Profile</h1><div class="spacer"></div><span class="saved-flash" id="pSaved">Saved</span>
        <button class="btn" id="pFolder">${icon('folder')}Open files</button></div>
      <div class="scroll"><div class="page"><div class="cols">
        <div><div class="panel" id="pForm"></div></div>
        <div><div class="panel" id="pResume"></div><div class="panel" id="pCreds"></div></div>
      </div></div></div>`;
    $('#pFolder').onclick = () => onward.openFolder('profile');
    renderForm();
  }

  function render() { renderResume(); renderCreds(); }

  // ---------- contact & preferences ----------
  function renderForm() {
    const p = A.state.profile;
    const f = (k, label, ph = '', o = {}) => `<label class="field ${o.wide ? 'wide' : ''}"><span>${label}</span><input class="input" data-k="${k}" value="${esc(o.value ?? p[k] ?? '')}" placeholder="${esc(ph)}" ${o.type ? `type="${o.type}"` : ''}></label>`;
    const link = (k, label, ph) => f('links.' + k, label, ph, { value: p.links?.[k] || '' });
    const wp = p.workplace || [];
    $('#pForm').innerHTML = `
      <h2>${icon('person')}About you</h2>
      <p class="lead">The Apply Guide fills application forms from this — no AI needed — and your AI uses it to tailor. Everything stays on this computer.</p>
      <div class="form">
        ${f('name', 'Full name', 'Alex Morgan')}${f('headline', 'Headline', 'Operations Manager')}
        ${f('email', 'Preferred email for applications', 'you@example.com', { type: 'email' })}${f('phone', 'Phone', '(555) 123-4567')}
        ${f('currentTitle', 'Current title', 'Operations Manager')}${f('currentCompany', 'Current company', 'Acme Co.')}
        ${f('yearsExperience', 'Years of experience', '5')}${f('highestEducation', 'Highest education', 'Bachelor’s degree')}
        <h4>Address (for application forms)</h4>
        ${f('street', 'Street address', '123 Main St', { wide: true })}
        ${f('city', 'City', 'Denver')}${f('state', 'State', 'CO')}
        ${f('zip', 'ZIP', '80202')}${f('country', 'Country', 'United States')}
        ${f('location', 'How you describe your location', 'Denver, CO', { wide: true })}
        <h4>Links</h4>
        ${link('linkedin', 'LinkedIn', 'linkedin.com/in/…')}${link('portfolio', 'Portfolio', 'yourportfolio.com')}
        ${link('website', 'Website', '')}${link('github', 'GitHub', '')}
        <h4>Common application questions</h4>
        ${f('workAuthorization', 'Work authorization', 'e.g. Authorized to work in the US')}${f('needsSponsorship', 'Needs visa sponsorship?', 'No')}
        ${f('willingToRelocate', 'Willing to relocate?', 'Yes, within the US')}${f('noticePeriod', 'Notice period / start date', '2 weeks')}
        ${f('salaryExpectation', 'Salary expectation', '$90,000–$110,000')}${f('howHeard', '“How did you hear about us?”', 'LinkedIn (default: where the job came from)')}
        <label class="field wide"><span>Voluntary self-identification (gender, race, veteran, disability)</span><select class="input" data-k="eeo"><option value="decline" ${p.eeo !== 'ask' ? 'selected' : ''}>Onward picks “I don’t wish to answer” for me</option><option value="ask" ${p.eeo === 'ask' ? 'selected' : ''}>Leave these for me to answer</option></select></label>
        <h4>What you're looking for</h4>
        ${f('targetRoles', 'Target roles (comma separated)', 'Operations Manager, Project Manager', { wide: true, value: (p.targetRoles || []).join(', ') })}
        ${f('targetLocations', 'Locations (comma separated)', 'Denver, Remote', { value: (p.targetLocations || []).join(', ') })}
        ${f('minSalary', 'Minimum salary', '$85,000')}
        <label class="field wide"><span>Workplace</span><div class="checks">${['Remote', 'Hybrid', 'On-site'].map(w => `<label><input type="checkbox" data-wp="${w}" ${wp.includes(w) ? 'checked' : ''}>${w}</label>`).join('')}</div></label>
        <label class="field wide"><span>Anything else your AI should know</span><textarea class="input" data-k="notes" rows="4" placeholder="Industries you're excited about, deal-breakers, achievements to highlight…">${esc(p.notes || '')}</textarea></label>
      </div>`;
    $$('[data-k]', $('#pForm')).forEach(el => el.addEventListener('change', () => saveField(el)));
    $$('[data-wp]', $('#pForm')).forEach(el => el.addEventListener('change', () => {
      saveProfile({ workplace: $$('[data-wp]').filter(x => x.checked).map(x => x.dataset.wp) });
    }));
  }
  function saveField(el) {
    const k = el.dataset.k, v = el.value.trim();
    if (k.startsWith('links.')) return saveProfile({ links: { [k.slice(6)]: v } });
    if (k === 'targetRoles' || k === 'targetLocations') return saveProfile({ [k]: v.split(',').map(s => s.trim()).filter(Boolean) });
    saveProfile({ [k]: v });
  }
  let flashT = null;
  async function saveProfile(patch) {
    A.state.profile = await onward.saveProfile(patch);
    const s = $('#pSaved'); s.classList.add('show'); clearTimeout(flashT); flashT = setTimeout(() => s.classList.remove('show'), 1400);
  }

  // ---------- resume ----------
  function renderResume() {
    const r = A.state.baseResume;
    $('#pResume').innerHTML = `
      <h2>${icon('doc')}Base resume</h2>
      <p class="lead">Your master resume. Your AI tailors a copy of it for each job — this one is never changed.</p>
      ${r ? `<div class="resume-file">${icon('doc')}<div style="flex:1;min-width:0"><div class="nm">${esc(r.name)}</div><div class="mt">Updated ${A.ago(r.updatedAt)} · ${r.chars ? r.chars.toLocaleString() + ' characters read' : 'no text could be read — try a .docx or text PDF'}</div></div>
          <button class="btn sm" id="rOpen">Open</button><button class="btn sm" id="rReplace">Replace</button></div>
          ${r.preview ? `<div class="preview">${esc(r.preview)}${r.chars > 1600 ? '\n…' : ''}</div>` : ''}`
        : `<div class="drop" id="rDrop">${icon('upload')}<b>Drop your resume here</b><span class="hint">PDF, Word (.docx) or text · or click to choose</span></div>`}`;
    const pick = async (paths) => { const s = await onward.importResume(paths); if (s) { A.state = s; A.render(); A.toast('Resume added'); } };
    $('#rReplace') && ($('#rReplace').onclick = () => pick());
    $('#rOpen') && ($('#rOpen').onclick = () => onward.openFile(r.file));
    const drop = $('#rDrop');
    if (drop) dropzone(drop, (paths) => pick(paths.slice(0, 1)), () => pick());
    else dropzone($('#pResume'), (paths) => pick(paths.slice(0, 1)));
  }

  // ---------- credentials ----------
  function renderCreds() {
    const list = A.state.credentials;
    $('#pCreds').innerHTML = `
      <h2>${icon('award')}Certificates, degrees & more</h2>
      <p class="lead">Add as many as you like — diplomas, certifications, licenses, portfolio pieces, references. Your AI reads them to build a fuller picture and can attach them when an application asks.</p>
      <div class="drop" id="cDrop">${icon('upload')}<b>Drop files here</b><span class="hint">PDF, Word, images · or click to choose</span></div>
      <div class="creds">${list.map(c => `<div class="cred" data-id="${c.id}">
        <div class="ico">${icon(TYPE_ICON[c.type] || 'doc')}</div>
        <div class="fields">
          <select class="input" data-f="type">${TYPES.map(t => `<option ${t === c.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <input class="input" data-f="title" value="${esc(c.title)}" placeholder="Name">
          <input class="input" data-f="issuer" value="${esc(c.issuer)}" placeholder="Issuer / school">
          <input class="input" data-f="date" value="${esc(c.date)}" placeholder="Year">
        </div>
        <div class="acts"><button class="btn sm icon ghost" data-open title="Open">${icon('external')}</button><button class="btn sm icon ghost danger" data-del title="Remove">${icon('trash')}</button></div>
        <div class="sub2">${esc(c.name)}${c.chars ? ` · ${c.chars.toLocaleString()} characters read` : ''}</div>
      </div>`).join('')}</div>`;
    const add = async (paths) => { A.state = await onward.addCredentials(paths); A.render(); };
    dropzone($('#cDrop'), add, () => add());
    $$('.cred').forEach(row => {
      const id = row.dataset.id, c = list.find(x => x.id === id);
      $$('[data-f]', row).forEach(el => el.addEventListener('change', async () => { A.state = await onward.updateCredential(id, { [el.dataset.f]: el.value.trim() }); renderCreds(); }));
      $('[data-open]', row).onclick = () => onward.openFile(c.file);
      $('[data-del]', row).onclick = async () => { A.state = await onward.removeCredential(id); A.render(); };
    });
  }

  function dropzone(el, onFiles, onClick) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault(); el.classList.remove('over');
      const paths = [...e.dataTransfer.files].map(f => onward.pathForFile(f)).filter(Boolean);
      if (paths.length) onFiles(paths);
    });
    if (onClick) el.addEventListener('click', onClick);
  }

  A.views.profile = { init, render };
})();
