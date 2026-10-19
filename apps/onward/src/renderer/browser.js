/* Onward — built-in browser (persistent sign-in for LinkedIn, Indeed, company career sites).
   Tabs remember which job they're for — including tabs a job page opens (LinkedIn "Apply" → company site) —
   and the Apply Guide sits beside the page. */
(() => {
  const A = window.App;
  const { $, $$, esc } = A;
  const tabs = [];            // { id, url, title, wv, wcId, loading, jobId }
  let active = null, session = null;
  const root = () => $('#view-browser');
  const tabId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  async function init() {
    session = await onward.browser.prepare();
    root().innerHTML = `
      <div class="b-wrap">
        <div class="b-main">
          <div class="b-tabs drag" id="bTabs"></div>
          <div class="b-bar">
            <button class="btn icon ghost" id="bBack" title="Back">${icon('back')}</button>
            <button class="btn icon ghost" id="bFwd" title="Forward">${icon('fwd')}</button>
            <button class="btn icon ghost" id="bReload" title="Reload">${icon('reload')}</button>
            <input class="input url" id="bUrl" placeholder="Search or enter a job link" spellcheck="false">
            <span class="driving-pill" id="bDriving">${icon('spark')}<span id="bDrivingName">AI</span> is driving</span>
            <select class="input job-link" id="bJob" title="Which job this tab is for"></select>
            <button class="btn" id="bSave" title="Save this page as a job">${icon('bookmark')}</button>
            <button class="btn" id="bGuide" title="Apply Guide">${icon('list')}Guide</button>
          </div>
          <div class="b-marks" id="bMarks"></div>
          <div id="bBanner"></div>
          <div class="b-stage" id="bStage"><div class="loading-bar"></div></div>
        </div>
        <aside class="guide" id="guide"></aside>
      </div>`;
    $('#bBack').onclick = () => cur()?.wv.canGoBack() && cur().wv.goBack();
    $('#bFwd').onclick = () => cur()?.wv.canGoForward() && cur().wv.goForward();
    $('#bReload').onclick = () => cur()?.wv.reload();
    $('#bUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') { go(e.target.value); e.target.blur(); } });
    $('#bUrl').addEventListener('focus', (e) => e.target.select());
    $('#bSave').onclick = saveCurrentJob;
    $('#bGuide').onclick = () => A.views.guide.toggle();
    $('#bJob').onchange = (e) => { const t = cur(); if (t) { setJob(t, e.target.value || null); } };

    onward.browser.onNewTab(({ url, reqId, openerWcId }) => {
      A.show('browser');
      const opener = openerWcId && tabs.find(x => x.wcId === openerWcId);
      addTab(url, { reqId, jobId: opener?.jobId || null });
    });
    onward.browser.onSaveJob(saveCurrentJob);
    onward.browser.onLinked(({ tabId, jobId }) => { const t = tabs.find(x => x.id === tabId); if (t) { t.jobId = jobId; renderJobLink(); persist(); A.views.guide?.tabChanged(); } });
    onward.browser.onReadyToSubmit(({ jobId, text }) => readyToSubmit(jobId, text));
    onward.browser.onSubmitted(({ jobId }) => { hideBanner(); A.views.guide?.submitted(jobId); });
    onward.browser.onSubmittedUnknown(askWhichJob);

    const saved = A.state.browser.tabs || [];
    saved.slice(0, 8).forEach((t, i) => addTab(t.url, { background: i !== (A.state.browser.active || 0), jobId: t.jobId || null }));
    renderMarks();
    renderAll();
  }

  const cur = () => tabs.find(t => t.id === active);
  function normalize(v) {
    v = v.trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(v) && !v.includes(' ')) return 'https://' + v;
    return 'https://www.google.com/search?q=' + encodeURIComponent(v);
  }
  function go(v) {
    const url = normalize(v);
    if (!url) return;
    if (cur()) cur().wv.loadURL(url).catch(() => {}); else addTab(url);
  }
  function setJob(t, jobId) {
    t.jobId = jobId || null;
    onward.browser.linkTab(t.id, t.jobId);
    renderJobLink(); persist();
    A.views.guide?.tabChanged();
  }

  function addTab(url, { background = false, reqId = null, jobId = null } = {}) {
    const t = { id: tabId(), url, title: A.host(url) || 'New tab', loading: true, jobId };
    const wv = document.createElement('webview');
    wv.setAttribute('partition', session.partition);
    wv.setAttribute('preload', session.preload);
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('webpreferences', 'sandbox=yes, contextIsolation=yes');
    wv.setAttribute('src', url);
    t.wv = wv;
    let registered = false;
    wv.addEventListener('dom-ready', () => {
      if (registered) return;
      registered = true;
      t.wcId = wv.getWebContentsId();
      onward.browser.register({ tabId: t.id, wcId: t.wcId, reqId });
      if (t.jobId) onward.browser.linkTab(t.id, t.jobId);
      if (active === t.id) onward.browser.active(t.id);
    });
    wv.addEventListener('did-start-loading', () => { t.loading = true; if (t.id === active) $('#bStage').classList.add('loading'); });
    wv.addEventListener('did-stop-loading', () => { t.loading = false; if (t.id === active) { $('#bStage').classList.remove('loading'); A.views.guide?.pageChanged(t); } });
    const nav = (e) => { t.url = e.url; if (t.id === active) $('#bUrl').value = e.url; persist(); renderTabs(); };
    wv.addEventListener('did-navigate', nav);
    wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) { nav(e); if (t.id === active) A.views.guide?.pageChanged(t); } });
    wv.addEventListener('page-title-updated', (e) => { t.title = e.title; renderTabs(); });
    wv.addEventListener('page-favicon-updated', (e) => { t.favicon = e.favicons?.[0]; renderTabs(); });
    $('#bStage').appendChild(wv);
    tabs.push(t);
    if (!background || !active) select(t.id);
    renderAll();
    persist();
    return t;
  }

  function select(id) {
    active = id;
    tabs.forEach(t => t.wv.classList.toggle('active', t.id === id));
    const t = cur();
    $('#bUrl').value = t?.url || '';
    $('#bStage').classList.toggle('loading', !!t?.loading);
    if (t) onward.browser.active(t.id);
    renderTabs(); renderJobLink(); hideBanner();
    persist();
    A.views.guide?.tabChanged();
    A.AI?.render();
  }

  function closeTab(id) {
    const i = tabs.findIndex(t => t.id === id);
    if (i < 0) return;
    const [t] = tabs.splice(i, 1);
    t.wv.remove();
    onward.browser.closed(id);
    if (active === id) { active = null; if (tabs.length) select(tabs[Math.min(i, tabs.length - 1)].id); else A.views.guide?.tabChanged(); }
    renderAll(); persist();
  }

  let persistT = null;
  function persist() {
    clearTimeout(persistT);
    persistT = setTimeout(() => onward.browser.save({ tabs: tabs.map(t => ({ url: t.url, jobId: t.jobId || undefined })), active: Math.max(0, tabs.findIndex(t => t.id === active)) }), 400);
  }

  function renderAll() { renderTabs(); renderEmpty(); renderJobLink(); }
  function renderTabs() {
    const el = $('#bTabs');
    if (!el) return;
    el.innerHTML = tabs.map(t => `<div class="b-tab no-drag ${t.id === active ? 'active' : ''} ${t.jobId ? 'linked' : ''}" data-id="${t.id}" title="${esc(t.title || '')}">
        ${t.favicon ? `<img src="${esc(t.favicon)}" alt="">` : `<img src="${esc(A.favicon(t.url, 32))}" alt="">`}
        <span class="t">${esc(t.title || A.host(t.url))}</span><button class="x" data-close="${t.id}">${icon('x')}</button></div>`).join('') +
      `<button class="b-new no-drag" id="bNew" title="New tab">${icon('plus')}</button>`;
    $$('.b-tab', el).forEach(n => n.addEventListener('click', (e) => { if (!e.target.closest('[data-close]')) select(n.dataset.id); }));
    $$('[data-close]', el).forEach(b => b.addEventListener('click', () => closeTab(b.dataset.close)));
    $('#bNew').onclick = () => addTab('https://www.linkedin.com/jobs/');
  }
  function renderMarks() {
    $('#bMarks').innerHTML = (A.state.browser.bookmarks || []).map(b => `<button data-url="${esc(b.url)}"><img src="${esc(A.favicon(b.url, 32))}" alt="">${esc(b.title)}</button>`).join('');
    $$('#bMarks button').forEach(b => b.onclick = () => go(b.dataset.url));
  }
  function renderEmpty() {
    const stage = $('#bStage');
    let e = $('.b-empty', stage);
    if (tabs.length) { e?.remove(); return; }
    if (!e) { e = document.createElement('div'); e.className = 'b-empty'; stage.appendChild(e); }
    e.innerHTML = `<div><h2>Sign in once, stay signed in</h2><p>Your LinkedIn, Indeed, Gmail and company-site sign-ins are kept privately inside Onward.<br>Find jobs in <b>Discover</b>; applications open here with the Apply Guide beside them.</p>
      <div class="sites">${(A.state.browser.bookmarks || []).slice(0, 4).map(b => `<button class="btn" data-url="${esc(b.url)}"><img src="${esc(A.favicon(b.url, 32))}" style="width:14px;height:14px" alt="">${esc(b.title)}</button>`).join('')}</div></div>`;
    $$('[data-url]', e).forEach(b => b.onclick = () => addTab(b.dataset.url));
  }
  function renderJobLink() {
    const sel = $('#bJob');
    if (!sel) return;
    const t = cur();
    const jobs = A.state.jobs.filter(j => !['rejected', 'withdrawn'].includes(j.status) || j.id === t?.jobId);
    sel.innerHTML = `<option value="">Not linked to a job</option>` + jobs.map(j => `<option value="${j.id}" ${t?.jobId === j.id ? 'selected' : ''}>${esc((j.company ? j.company + ' — ' : '') + (j.title || ''))}</option>`).join('');
    sel.disabled = !t;
    sel.classList.toggle('linked', !!t?.jobId);
  }

  async function saveCurrentJob() {
    const t = cur();
    if (!t) return;
    let title = t.title || '', company = '';
    const parts = title.split(/\s+[|·–—-]\s+/).map(s => s.trim()).filter(Boolean).filter(s => !/^(linkedin|indeed|glassdoor|jobs?)$/i.test(s));
    if (parts.length >= 2) { [title, company] = parts; }
    title = title.replace(/^\(\d+\)\s*/, '').replace(/\s*job in .*$/i, '');
    A.views.jobs.editJob({}, { title, company, url: t.url });
  }

  // ---------- banners ----------
  function banner({ html, action, copy, kind = '' }) {
    $('#bBanner').innerHTML = `<div class="banner ${kind}">${icon(kind === 'submit' ? 'send' : 'spark')}<div class="msg">${html}</div>
      ${copy ? `<button class="btn sm ghost" id="bCopy">${icon('copy')}Copy again</button>` : ''}
      ${action ? `<button class="btn sm primary" id="bAct">${esc(action.label)}</button>` : ''}<button class="btn sm ghost" id="bBannerX">${icon('x')}</button></div>`;
    $('#bBannerX').onclick = hideBanner;
    $('#bCopy') && ($('#bCopy').onclick = () => { onward.claude.copy(copy); A.toast('Copied'); });
    $('#bAct') && ($('#bAct').onclick = async () => { await action.fn(); hideBanner(); });
  }
  function readyToSubmit(jobId, text) {
    A.show('browser');
    const job = A.state.jobs.find(j => j.id === jobId);
    banner({ kind: 'submit', html: `The application${job ? ` for <b>${esc(job.title)}</b>` : ''} is filled in. Review everything, then press <b>${esc(text || 'Submit')}</b> yourself — it's highlighted on the page. Onward records it when you do.`,
      action: job && { label: 'I submitted it', fn: async () => { await onward.markApplied(job.id); A.toast('Marked as applied 🎉'); } } });
    A.views.guide?.refresh();
  }
  function hideBanner() { $('#bBanner') && ($('#bBanner').innerHTML = ''); }

  function askWhichJob({ url, answers, portal }) {
    hideBanner();
    const jobs = A.state.jobs.filter(j => !j.submitted?.appliedAt);
    if (!jobs.length) return;
    A.modal(`<h2>Nice — which job was that?</h2><p style="color:var(--text-2)">You just submitted an application on ${esc(A.host(url))}. Pick the job so Onward can mark it as applied${answers?.length ? ` and keep the ${answers.length} answers you gave` : ''}.</p>
      <select class="input" id="whichJob">${jobs.map(j => `<option value="${j.id}">${esc((j.company ? j.company + ' — ' : '') + j.title)}</option>`).join('')}</select>
      <div class="foot"><button class="btn" data-x>Skip</button><button class="btn primary" data-ok>Mark applied</button></div>`, (m, close) => {
      $('[data-x]', m).onclick = close;
      $('[data-ok]', m).onclick = async () => { await onward.markAppliedWith($('#whichJob', m).value, answers || [], portal); close(); A.toast('Marked as applied 🎉'); };
    });
  }

  function driving(on) {
    $('#bStage')?.classList.toggle('driving', on);
    $('#bDriving')?.classList.toggle('show', on);
    if ($('#bDrivingName')) $('#bDrivingName').textContent = A.clientName();
  }

  // Open a page in a new tab. opts: { jobId, banner: {html, action, copy} }
  function open(url, opts = {}) {
    A.views.jobs?.close?.();
    A.show('browser');
    const t = addTab(url, { jobId: opts.jobId || null });
    if (opts.jobId) { t.jobId = opts.jobId; renderJobLink(); A.views.guide?.tabChanged(); }
    if (opts.banner) setTimeout(() => banner(opts.banner), 50);
    return t;
  }

  A.views.browser = { init, render: renderJobLink, driving, open, banner, show: () => A.views.guide?.tabChanged(), currentJobId: () => cur()?.jobId || null, currentTab: cur };
})();
