/* Onward — Apply Guide: a step-by-step walkthrough beside any application page.
   It reads the form (every embedded frame too), fills what your profile answers — locally, no AI —
   lists what's left, attaches your documents, drafts answers with AI when asked, and points you
   to the Submit button. You press Submit; Onward records the application and your answers. */
(() => {
  const A = window.App;
  const { $, $$, esc } = A;
  const st = { open: false, closedFor: new Set(), scan: null, busy: false, scanning: false, timer: null, lastKey: '', showDone: false, tipsOpen: false, aiBusy: null };
  const el = () => $('#guide');
  const clean = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const tab = () => A.views.browser?.currentTab?.();
  const job = () => { const id = tab()?.jobId; return id ? A.state.jobs.find(j => j.id === id) : null; };

  function init() {
    st.timer = setInterval(() => { if (st.open && A.view === 'browser' && !st.busy && !document.hidden) refresh(true); }, 4000);
  }

  // Open the application for a job, with the guide beside it
  function start(jobId) {
    const j = A.state.jobs.find(x => x.id === jobId);
    if (!j) return;
    const url = j.applyUrl || j.url;
    if (!url) { A.toast('This job has no link yet — add one with Edit'); return; }
    st.closedFor.delete(jobId);
    A.views.browser.open(url, { jobId });
    setOpen(true);
  }

  function toggle() { setOpen(!st.open); if (!st.open && job()) st.closedFor.add(job().id); }
  function setOpen(on) {
    st.open = on;
    $('#view-browser .b-wrap')?.classList.toggle('guide-open', on);
    $('#bGuide')?.classList.toggle('active', on);
    if (on) {
      // On smaller screens, the page + guide need the room more than the AI panel does
      if (window.innerWidth < 1600 && A.AI?.isOpen() && !A.AI.busy()) A.AI.toggle(false);
      render(); refresh();
    }
  }
  function tabChanged() {
    const j = job();
    if (j && !j.submitted?.appliedAt && !st.closedFor.has(j.id) && !st.open) setOpen(true);
    st.scan = null; st.lastKey = '';
    if (st.open) { render(); refresh(); }
  }
  function pageChanged(t) { if (st.open && t === tab()) setTimeout(() => refresh(), 600); }
  function submitted(jobId) { if (job()?.id === jobId) { st.scan = null; render(); } }

  async function refresh(quiet) {
    if (!st.open || st.scanning) return;
    const t = tab();
    if (!t) { st.scan = null; render(); return; }
    st.scanning = true;
    try {
      const s = await onward.guide.scan({ tabId: t.id });
      const key = s ? JSON.stringify([s.url, s.fields.map(f => [f.ref, f.state, f.value, f.checked]), s.errors, s.finalButton?.ref, s.hasPassword, s.job?.attachments?.length, s.job?.hasResume]) : '';
      st.scan = s;
      if (!quiet || key !== st.lastKey) { st.lastKey = key; render(); }
    } catch { /* page mid-navigation */ }
    finally { st.scanning = false; }
  }

  // ---------- what step are we on? ----------
  function stepOf(s, j) {
    if (j?.submitted?.appliedAt) return 'done';
    if (!s) return 'open';
    const fields = s.fields.filter(f => f.type !== 'hidden');
    const postingPage = /linkedin\.com\/jobs\/(view|search|collections)|indeed\.com\/viewjob/.test(s.url) && !fields.some(f => f.type === 'file' || f.required);
    if (postingPage) return 'open';
    if (s.hasPassword) return 'account';
    if (fields.some(f => f.type === 'file' && f.empty) && !(s.job?.attachments || []).length) return 'resume';
    if (fields.some(f => f.state === 'canFill')) return 'fill';
    if (fields.some(f => f.state === 'needsYou' && f.required)) return 'answer';
    if (s.finalButton) return 'submit';
    if (fields.length) return 'next';
    return 'open';
  }

  const STEPS = [
    ['docs', 'Documents ready'], ['open', 'Open the application'], ['account', 'Sign in or create an account'], ['resume', 'Attach your resume'],
    ['fill', 'Fill your details'], ['answer', 'Answer the questions'], ['submit', 'Review & submit']
  ];

  function render() {
    const host = el();
    if (!host) return;
    if (!st.open) { host.innerHTML = ''; return; }
    const t = tab();
    const j = job();
    const s = st.scan;
    const head = `<div class="g-head"><b>${icon('list')}Apply Guide</b><span style="flex:1"></span><button class="btn sm icon ghost" id="gRescan" title="Rescan the page">${icon('reload')}</button><button class="btn sm icon ghost" id="gClose" title="Hide">${icon('x')}</button></div>`;
    if (!t) { host.innerHTML = head + `<div class="g-body"><p class="hint">Open an application — from a job card (“Apply with guide”) or Discover — and the guide walks you through it.</p></div>`; bindHead(); return; }
    if (!j) {
      host.innerHTML = head + `<div class="g-body">
        <div class="g-card"><b>Which job is this page for?</b><p class="hint">Link the tab so Onward can use your tailored resume and record the application.</p>
          <select class="input" id="gLink"><option value="">Choose a job…</option>${A.state.jobs.filter(x => !x.submitted?.appliedAt).map(x => `<option value="${x.id}">${esc((x.company ? x.company + ' — ' : '') + x.title)}</option>`).join('')}</select></div>
        ${s ? fieldsBlock(s, null) : ''}</div>`;
      bindHead();
      $('#gLink').onchange = (e) => { const tt = tab(); if (tt && e.target.value) { tt.jobId = e.target.value; onward.browser.linkTab(tt.id, tt.jobId); A.views.browser.render(); tabChanged(); } };
      bindFields(null);
      return;
    }
    const step = stepOf(s, j);
    const sub = j.submitted || {};
    const portal = s?.portal || { name: '', tips: [] };
    const counts = s ? { can: s.fields.filter(f => f.state === 'canFill').length, need: s.fields.filter(f => f.state === 'needsYou').length, needReq: s.fields.filter(f => f.state === 'needsYou' && f.required).length, done: s.fields.filter(f => f.state === 'done').length } : { can: 0, need: 0, needReq: 0, done: 0 };
    const order = STEPS.map(x => x[0]);
    const curIdx = step === 'done' ? 99 : step === 'next' ? order.indexOf('answer') + 0.5 : order.indexOf(step);
    const docsOk = !!sub.resume || !!A.state.baseResume;

    host.innerHTML = head + `<div class="g-body">
      <div class="g-job">${A.logo(j)}<div style="min-width:0"><b>${esc(j.title)}</b><span>${esc(j.company || '')}${portal.name ? ' · ' + esc(portal.name) : ''}</span></div></div>
      ${step === 'done' ? `<div class="g-done">${icon('check')}<div><b>Applied ${A.date(sub.appliedAt)}</b><span>${sub.answers?.length ? sub.answers.length + ' answers saved on the job card.' : 'Saved on the job card.'}</span></div></div>
        <div class="g-next"><p class="hint">Next: message the hiring team, or find your next role.</p><button class="btn sm" id="gPeople">${icon('person')}Message someone</button><button class="btn sm" id="gDiscover">${icon('search')}Discover</button></div>` : ''}
      ${portal.tips?.length && step !== 'done' ? `<details class="g-tips" ${st.tipsOpen ? 'open' : ''}><summary>${icon('spark')}${esc(portal.name)} tips</summary><ul>${portal.tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
      ${step !== 'done' ? `<ol class="g-steps">${STEPS.map(([id, label], i) => {
        const state = id === 'docs' ? (docsOk ? 'ok' : 'now') : i < curIdx ? 'ok' : i === Math.floor(curIdx) || (step === 'next' && id === 'answer') ? 'now' : 'later';
        return `<li class="${state}"><span class="n">${state === 'ok' ? icon('check') : i + 1}</span><div><b>${label}</b>${state === 'now' || id === 'docs' ? stepBody(id, { j, s, sub, counts, step }) : ''}</div></li>`;
      }).join('')}</ol>` : ''}
      ${s && step !== 'done' ? fieldsBlock(s, j) : ''}
    </div>`;
    bindHead();
    bindSteps(j);
    bindFields(j);
  }

  function stepBody(id, { j, s, sub, counts, step }) {
    switch (id) {
      case 'docs': return sub.resume
        ? `<p>Tailored resume ready${sub.coverLetter ? ' + cover letter' : ''}.</p>`
        : `<p>${A.state.baseResume ? 'A resume tailored to this posting gets past screening more often.' : 'Add your base resume in Profile first.'}</p>${A.state.baseResume ? `<button class="btn sm" data-g="tailor" ${st.aiBusy ? 'disabled' : ''}>${icon('spark')}${st.aiBusy === 'tailor' ? 'Tailoring…' : 'Tailor with AI'}</button>` : `<button class="btn sm" data-g="profile">Open Profile</button>`}`;
      case 'open': return /linkedin\.com/.test(s?.url || '')
        ? `<p>${j.applyType === 'easy' ? 'Press <b>Easy Apply</b> on the posting.' : 'Press <b>Apply</b> on the posting — the company’s site opens in a new tab here and the guide follows it.'}</p>`
        : /indeed\.com/.test(s?.url || '') ? `<p>Press <b>Apply now</b> on the posting.</p>` : `<p>Find the <b>Apply</b> button on this page. The guide springs into action when a form appears.</p>`;
      case 'account': return `<p>This site wants you to sign in or create an account. Use your application email — Onward never sees passwords.</p>
        <div class="copyrow"><code>${esc(A.state.profile.email || 'Add your email in Profile')}</code>${A.state.profile.email ? `<button class="btn sm ghost" data-copy="${esc(A.state.profile.email)}">${icon('copy')}</button>` : ''}</div>`;
      case 'resume': return `<p>Attach a resume to the upload field below${sub.resume ? ' — your tailored one is ready' : ''}.</p>`;
      case 'fill': return `<p>Onward can fill <b>${counts.can}</b> field${counts.can === 1 ? '' : 's'} from your profile.</p><button class="btn sm primary" data-g="fill" ${st.busy ? 'disabled' : ''}>${icon('check')}${st.busy ? 'Filling…' : `Fill ${counts.can} field${counts.can === 1 ? '' : 's'}`}</button>`;
      case 'answer': return `<p>${counts.needReq} required question${counts.needReq === 1 ? '' : 's'} left. Answer on the page, or use <b>Draft</b> for written answers.</p>`;
      case 'submit': return `<p>Everything looks filled in. Check the page (and any errors), then press <b>${esc(s.finalButton.label || 'Submit')}</b> yourself.</p><button class="btn sm" data-g="show-submit">${icon('send')}Show me the button</button>`;
      default: return '';
    }
  }

  function fieldsBlock(s, j) {
    const fields = s.fields.filter(f => f.type !== 'hidden');
    const need = fields.filter(f => f.state === 'needsYou');
    const can = fields.filter(f => f.state === 'canFill');
    const done = fields.filter(f => f.state === 'done');
    const files = fields.filter(f => f.type === 'file');
    const sub = j?.submitted || {};
    const docBtns = (ref) => [
      sub.resume && `<button class="btn sm" data-up="${ref}" data-file="tailored_resume">${icon('doc')}Tailored resume</button>`,
      A.state.baseResume && `<button class="btn sm ghost" data-up="${ref}" data-file="base_resume">Base resume</button>`,
      sub.coverLetter && `<button class="btn sm ghost" data-up="${ref}" data-file="cover_letter">${icon('letter')}Cover letter</button>`,
      A.state.credentials.length && `<select class="input sm" data-upsel="${ref}"><option value="">Other document…</option>${A.state.credentials.map(c => `<option value="credential:${c.id}">${esc(c.title)}</option>`).join('')}</select>`
    ].filter(Boolean).join('');
    const row = (f) => {
      const opts = (f.options || []).map(o => typeof o === 'string' ? o : o.label).filter(Boolean);
      const isText = ['text', 'textarea', 'richtext', 'email', 'tel', 'url', 'number', 'search'].includes(f.type);
      const canDraft = j && (f.type === 'textarea' || f.type === 'richtext' || (isText && f.label.length > 25) || ((f.type === 'select' || f.type === 'radio') && opts.length));
      return `<div class="g-field ${f.state}" data-ref="${esc(f.ref)}">
        <button class="g-label" data-focus="${esc(f.ref)}" title="Show on the page">${esc(f.label || '(unlabelled ' + f.type + ')')}${f.required ? '<i>*</i>' : ''}</button>
        ${f.state === 'canFill' ? `<span class="g-val">${esc(f.suggestion.value)}</span>` : ''}
        ${f.state === 'done' && f.type !== 'file' ? `<span class="g-val done">${esc(f.type === 'radio' ? (f.options || []).filter(o => o.checked).map(o => o.label).join(', ') : f.type === 'checkbox' ? 'Checked' : f.value || '')}</span>` : ''}
        ${f.state === 'needsYou' && (f.type === 'select' || f.type === 'radio') && opts.length && opts.length <= 40 ? `<select class="input sm" data-pick="${esc(f.ref)}"><option value="">Choose…</option>${opts.filter(o => !/^(select|choose|--)/i.test(o)).map(o => `<option>${esc(o)}</option>`).join('')}</select>` : ''}
        ${f.state === 'needsYou' && canDraft ? `<button class="btn sm ghost" data-draft="${esc(f.ref)}" ${st.aiBusy ? 'disabled' : ''}>${icon('spark')}${st.aiBusy === f.ref ? 'Drafting…' : 'Draft'}</button>` : ''}
        ${f.type === 'file' ? `<div class="g-docs">${f.value ? `<span class="g-val done">${esc(f.value)}</span>` : ''}${docBtns(f.ref)}</div>` : ''}
      </div>`;
    };
    if (!fields.length) return `<div class="g-sec"><p class="hint">${s.errors?.length ? '' : 'No form on this page yet.'}</p>${errs(s)}</div>`;
    return `${errs(s)}
      ${files.length ? `<div class="g-sec"><h4>${icon('upload')}Documents</h4>${files.map(row).join('')}</div>` : ''}
      ${need.filter(f => f.type !== 'file').length ? `<div class="g-sec"><h4>${icon('person')}Needs you · ${need.filter(f => f.type !== 'file').length}</h4>${need.filter(f => f.type !== 'file').map(row).join('')}</div>` : ''}
      ${can.length ? `<div class="g-sec"><h4>${icon('spark')}Onward can fill · ${can.length}<span style="flex:1"></span><button class="btn sm primary" data-g="fill" ${st.busy ? 'disabled' : ''}>Fill all</button></h4>${can.map(row).join('')}</div>` : ''}
      ${done.filter(f => f.type !== 'file').length ? `<div class="g-sec"><h4 class="toggle-h" data-g="toggle-done">${icon('check')}Filled · ${done.filter(f => f.type !== 'file').length}<span style="flex:1"></span>${st.showDone ? 'Hide' : 'Show'}</h4>${st.showDone ? done.filter(f => f.type !== 'file').map(row).join('') : ''}</div>` : ''}`;
  }
  const errs = (s) => s.errors?.length ? `<div class="g-errs">${s.errors.slice(0, 5).map(e => `<div>${icon('x')}${esc(e)}</div>`).join('')}</div>` : '';

  function bindHead() {
    $('#gClose') && ($('#gClose').onclick = () => toggle());
    $('#gRescan') && ($('#gRescan').onclick = () => refresh());
  }
  function bindSteps(j) {
    const host = el();
    $$('[data-g="tailor"]', host).forEach(b => b.onclick = async () => {
      st.aiBusy = 'tailor'; render();
      try { await A.views.jobs.runAi('tailor', j.id); } catch {} finally { st.aiBusy = null; render(); }
    });
    $$('[data-g="profile"]', host).forEach(b => b.onclick = () => A.show('profile'));
    $$('[data-g="show-submit"]', host).forEach(b => b.onclick = () => st.scan?.finalButton && onward.guide.markSubmit(st.scan.finalButton.ref));
    $('#gPeople', host) && ($('#gPeople', host).onclick = () => { A.show('jobs'); A.views.jobs.openDrawer(j.id); });
    $('#gDiscover', host) && ($('#gDiscover', host).onclick = () => A.show('discover'));
    $$('[data-copy]', host).forEach(b => b.onclick = () => { onward.claude.copy(b.dataset.copy); A.toast('Copied'); });
    $('.g-tips', host)?.addEventListener('toggle', (e) => { st.tipsOpen = e.target.open; });
  }
  function bindFields(j) {
    const host = el();
    $$('[data-g="fill"]', host).forEach(b => b.onclick = fillAll);
    $$('[data-g="toggle-done"]', host).forEach(b => b.onclick = () => { st.showDone = !st.showDone; render(); });
    $$('[data-focus]', host).forEach(b => b.onclick = () => onward.guide.focus(b.dataset.focus));
    $$('[data-pick]', host).forEach(s => s.onchange = async () => { if (!s.value) return; await fillOne(s.dataset.pick, s.value); });
    $$('[data-up]', host).forEach(b => b.onclick = () => upload(b.dataset.up, b.dataset.file, j));
    $$('[data-upsel]', host).forEach(s => s.onchange = () => s.value && upload(s.dataset.upsel, s.value, j));
    $$('[data-draft]', host).forEach(b => b.onclick = () => draft(b.dataset.draft, j));
  }

  async function fillAll() {
    if (!st.scan || st.busy) return;
    const todo = st.scan.fields.filter(f => f.state === 'canFill').map(f => ({ ref: f.ref, value: f.suggestion.value }));
    if (!todo.length) return;
    st.busy = true; render();
    try {
      const res = await onward.guide.fill(todo);
      const bad = res.filter(r => !r.ok);
      A.toast(`Filled ${res.length - bad.length} field${res.length - bad.length === 1 ? '' : 's'}${bad.length ? ` · ${bad.length} need a look` : ''}`);
    } catch (e) { A.toast(clean(e)); }
    finally { st.busy = false; await refresh(); }
  }
  async function fillOne(ref, value) {
    try { const [r] = await onward.guide.fill([{ ref, value }]); if (!r.ok) A.toast(r.note); } catch (e) { A.toast(clean(e)); }
    await refresh();
  }
  async function upload(ref, file, j) {
    try {
      const r = await onward.guide.upload({ ref, file, jobId: j?.id });
      A.toast(r.ok ? 'Attached ' + r.name : r.note);
    } catch (e) { A.toast(clean(e)); }
    await A.load(); await refresh();
  }
  async function draft(ref, j) {
    const f = st.scan?.fields.find(x => x.ref === ref);
    if (!f || st.aiBusy) return;
    st.aiBusy = ref; render();
    try {
      const opts = (f.options || []).map(o => typeof o === 'string' ? o : o.label).filter(o => o && !/^(select|choose|--)/i.test(o));
      const r = await A.AI.run('answer', { jobId: j.id, question: f.label, options: (f.type === 'select' || f.type === 'radio') ? opts : undefined, maxLength: f.maxLength });
      await fillOne(ref, r.text);
      A.toast('Drafted — read it over on the page');
    } catch (e) { A.toast(clean(e)); }
    finally { st.aiBusy = null; render(); }
  }

  A.views.guide = { init, render: () => { if (st.open) render(); }, start, toggle, tabChanged, pageChanged, submitted, refresh };
})();
