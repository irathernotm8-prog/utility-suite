/* Onward — Discover: find listings without leaving the app. */
(() => {
  const A = window.App;
  const { $, $$, esc } = A;
  const root = () => $('#view-discover');
  const st = { q: null, results: [], errors: [], page: 0, selected: null, detail: null, loading: false, loadingDetail: false };

  function init() {
    const p = A.state.profile;
    const last = A.state.discover?.last?.q;
    const q = last || { keywords: (p.targetRoles || [])[0] || '', location: (p.targetLocations || [])[0] || p.location || '', posted: 'week', workplace: [], sources: ['linkedin'] };
    root().innerHTML = `
      <div class="topbar drag"><h1>Discover</h1><div class="spacer"></div><span class="hint no-drag" id="dCount"></span></div>
      <form class="d-search" id="dForm" autocomplete="off">
        <div class="searchbox big">${icon('search')}<input class="input" name="keywords" placeholder="Job title, skill or company" value="${esc(q.keywords || '')}"></div>
        <div class="searchbox big loc">${icon('pin')}<input class="input" name="location" placeholder="City, state or “Remote”" value="${esc(q.location || '')}"></div>
        <select class="input" name="posted" style="width:140px">${[['any', 'Any time'], ['day', 'Past 24 hours'], ['week', 'Past week'], ['month', 'Past month']].map(([v, l]) => `<option value="${v}" ${q.posted === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn primary" type="submit">${icon('search')}Search</button>
        <div class="d-filters">
          ${['Remote', 'Hybrid', 'On-site'].map(w => `<label class="toggle"><input type="checkbox" name="wp" value="${w}" ${(q.workplace || []).includes(w) ? 'checked' : ''}><span>${w}</span></label>`).join('')}
          <span class="sep"></span>
          <label class="toggle"><input type="checkbox" name="easyApply" ${q.easyApply ? 'checked' : ''}><span>Easy Apply only</span></label>
          <select class="input sm" name="experience"><option value="">Any level</option>${[['entry', 'Entry'], ['associate', 'Associate'], ['mid', 'Mid–Senior'], ['director', 'Director'], ['executive', 'Executive']].map(([v, l]) => `<option value="${v}" ${(q.experience || [])[0] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <select class="input sm" name="sort"><option value="relevant">Most relevant</option><option value="recent" ${q.sort === 'recent' ? 'selected' : ''}>Most recent</option></select>
          <span class="sep"></span>
          <label class="toggle"><input type="checkbox" name="src" value="linkedin" ${(q.sources || ['linkedin']).includes('linkedin') ? 'checked' : ''}><span>LinkedIn</span></label>
          <label class="toggle"><input type="checkbox" name="src" value="indeed" ${(q.sources || []).includes('indeed') ? 'checked' : ''}><span>Indeed</span></label>
        </div>
        <div class="d-recent" id="dRecent"></div>
      </form>
      <div class="dsc-body">
        <div class="d-list" id="dList"></div>
        <div class="d-detail" id="dDetail"></div>
      </div>`;
    $('#dForm').addEventListener('submit', (e) => { e.preventDefault(); search(readForm(), 0); });
    renderRecent();
    renderList(); renderDetail();
  }

  function readForm() {
    const f = $('#dForm');
    const fd = new FormData(f);
    return {
      keywords: fd.get('keywords').trim(), location: fd.get('location').trim(), posted: fd.get('posted'),
      workplace: fd.getAll('wp'), easyApply: !!fd.get('easyApply'), experience: fd.get('experience') ? [fd.get('experience')] : [],
      sort: fd.get('sort'), sources: fd.getAll('src').length ? fd.getAll('src') : ['linkedin']
    };
  }
  function fillForm(q) {
    const f = $('#dForm');
    if (!f) return;
    f.keywords.value = q.keywords || ''; f.location.value = q.location || '';
    if (q.posted) f.posted.value = q.posted;
    $$('[name=wp]', f).forEach(c => c.checked = (q.workplace || []).includes(c.value));
    f.easyApply.checked = !!q.easyApply;
    $$('[name=src]', f).forEach(c => c.checked = (q.sources || ['linkedin']).includes(c.value));
  }

  function renderRecent() {
    const r = A.state.discover?.recent || [];
    $('#dRecent').innerHTML = r.length ? `<span class="hint">Recent:</span>${r.slice(0, 6).map((x, i) => `<button type="button" class="chip-btn" data-i="${i}">${esc(x.label)}</button>`).join('')}` : '';
    $$('#dRecent [data-i]').forEach(b => b.onclick = () => { const q = r[Number(b.dataset.i)]; fillForm(q); search(q, 0); });
  }

  async function search(q, page = 0) {
    if (!q.keywords) { A.toast('Type a job title or keyword'); return; }
    st.q = q; st.loading = true; st.page = page;
    if (!page) { st.results = []; st.selected = null; st.detail = null; renderDetail(); }
    renderList();
    try {
      const r = await onward.discover.search({ ...q, page });
      st.results = page ? [...st.results, ...r.results.filter(x => !st.results.some(y => y.id === x.id))] : r.results;
      st.errors = r.errors || [];
      if (!page && st.results.length) select(st.results[0].id);
    } catch (e) { st.errors = [{ source: 'Search', message: clean(e) }]; }
    st.loading = false;
    renderList();
    A.state = await onward.getState(); renderRecent();
  }
  const clean = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  // When a connected assistant searches, show the same results here
  function mirror(payload) {
    if (!root().innerHTML) return;
    if (payload?.results) { st.q = payload.q; st.results = payload.results; st.errors = payload.errors || []; st.page = 0; fillForm(payload.q); renderList(); if (st.results[0]) select(st.results[0].id); }
  }

  function card(r) {
    const saved = r.saved || A.state.jobs.find(j => j.listingId && j.listingId === r.listingId)?.id;
    return `<button class="d-card ${st.selected === r.id ? 'active' : ''}" data-id="${esc(r.id)}">
      <div class="logo">${esc((r.company || '?')[0])}${r.logo ? `<img src="${esc(r.logo)}" alt="" class="full" data-over="1">` : ''}</div>
      <div class="d-card-main">
        <div class="d-card-title">${esc(r.title)}</div>
        <div class="d-card-co">${esc(r.company)}</div>
        <div class="d-card-meta">${esc(r.location || '')}${r.pay?.text ? ` · <span class="pay">${esc(r.pay.text)}</span>` : ''}</div>
        <div class="d-card-tags">
          ${r.postedAt ? `<span>${esc(r.postedAt)}</span>` : ''}${r.isNew ? '<span class="new">New</span>' : ''}
          ${r.easyApply || r.applyType === 'easy' ? `<span class="ea">Easy Apply</span>` : ''}
          ${(r.badges || []).slice(0, 2).map(b => `<span>${esc(b)}</span>`).join('')}
          <span class="src">${esc(r.source)}</span>
          ${saved ? `<span class="saved">${icon('check')}On board</span>` : ''}
        </div>
      </div></button>`;
  }

  function renderList() {
    const el = $('#dList');
    if (!el) return;
    $('#dCount').textContent = st.results.length ? `${st.results.length} listings` : '';
    const errs = st.errors.map(e => `<div class="d-err">${icon('x')}<span><b>${esc(e.source)}:</b> ${esc(e.message)}</span>${e.blocked ? `<button class="btn sm" data-open-indeed>Open Indeed</button>` : ''}</div>`).join('');
    if (!st.results.length) {
      el.innerHTML = errs + (st.loading ? skeleton() : `<div class="d-empty">${icon('search', 'big')}<p>Search LinkedIn${A.state.discover?.last?.q?.sources?.includes('indeed') ? ' and Indeed' : ''} right here — results open beside the list, and you can save, message or apply without leaving Onward.</p></div>`);
    } else {
      el.innerHTML = errs + st.results.map(card).join('') + (st.loading ? skeleton(2) : `<button class="btn d-more" id="dMore">Load more</button>`);
    }
    $$('.d-card', el).forEach(c => c.onclick = () => select(c.dataset.id));
    $('#dMore') && ($('#dMore').onclick = () => search(st.q, st.page + 1));
    $('[data-open-indeed]', el) && ($('[data-open-indeed]', el).onclick = () => A.views.browser.open('https://www.indeed.com/'));
  }
  const skeleton = (n = 5) => Array.from({ length: n }, () => `<div class="d-card sk"><div class="logo"></div><div class="d-card-main"><i></i><i></i><i></i></div></div>`).join('');

  async function select(id) {
    st.selected = id; st.loadingDetail = true; st.detail = null;
    $$('.d-card').forEach(c => c.classList.toggle('active', c.dataset.id === id));
    renderDetail();
    try { st.detail = await onward.discover.detail(id); }
    catch (e) { st.detail = { error: clean(e), ...(st.results.find(r => r.id === id) || {}) }; }
    if (st.selected !== id) return;
    st.loadingDetail = false;
    renderDetail();
  }

  function renderDetail() {
    const el = $('#dDetail');
    if (!el) return;
    if (!st.selected) { el.innerHTML = `<div class="d-empty">${icon('brief', 'big')}<p>Pick a listing to see the full posting, pay, how to apply and who’s hiring.</p></div>`; return; }
    const base = st.results.find(r => r.id === st.selected) || {};
    const d = st.detail || base;
    if (st.loadingDetail) { el.innerHTML = `<div class="dd-head">${headHtml(base)}</div><div class="dd-body"><div class="sk-lines"><i></i><i></i><i></i><i></i><i></i></div></div>`; return; }
    const savedId = d.saved || base.saved || A.state.jobs.find(j => j.listingId && j.listingId === d.listingId)?.id;
    const apply = d.applyType === 'easy' ? { label: 'Easy Apply on LinkedIn', cls: 'ea', tip: 'Short form inside LinkedIn — Onward’s guide helps with the questions.' }
      : d.applyType === 'indeed' ? { label: 'Indeed Apply', cls: 'ea', tip: 'Applies through Indeed.' }
      : d.applyType === 'offsite' ? { label: 'Applies on the company’s site', cls: 'off', tip: 'Onward opens it in the Browser with the Apply Guide beside it.' } : null;
    const m = d.match;
    el.innerHTML = `
      <div class="dd-head">${headHtml(d)}
        <div class="d-actions">
          ${savedId ? `<button class="btn" data-act="open-job">${icon('check')}On your board</button>` : `<button class="btn primary" data-act="save">${icon('bookmark')}Save to board</button>`}
          <button class="btn ${savedId ? 'primary' : ''}" data-act="apply">${icon('send')}Apply with guide</button>
          <button class="btn ghost" data-act="open">${icon('globe')}Open posting</button>
        </div>
      </div>
      <div class="dd-body">
        ${d.error ? `<div class="d-err">${icon('x')}<span>${esc(d.error)}</span></div>` : ''}
        ${apply ? `<div class="dd-apply ${apply.cls}">${icon('send')}<div><b>${apply.label}</b><span>${apply.tip}</span></div></div>` : ''}
        ${m ? `<div class="dd-sec"><h3>${icon('spark')}Keyword match with your resume · ${m.score}%</h3><div class="fitbar"><i style="width:${Math.max(4, m.score)}%"></i></div>
          <div class="kw">${m.matched.map(w => `<span class="hit">${esc(w)}</span>`).join('')}${m.missing.map(w => `<span class="miss">${esc(w)}</span>`).join('')}</div>
          <p class="hint">Green words are already in your resume; grey ones are in the posting but not your resume — a tailored resume can fix the true ones.</p></div>` : ''}
        ${d.contacts?.length ? `<div class="dd-sec"><h3>${icon('person')}People</h3>${d.contacts.map(c => `<div class="person"><div class="avatar">${esc((c.name || c.email || '?')[0].toUpperCase())}</div><div class="p-main"><b>${esc(c.name || c.email)}</b><span>${esc([c.title, c.role].filter(Boolean).join(' · '))}</span></div>${c.linkedin ? `<button class="btn sm ghost" data-ext="${esc(c.linkedin)}">LinkedIn</button>` : ''}</div>`).join('')}
          <p class="hint">Saved with the job — you can send them a tailored message from the job card.</p></div>` : ''}
        <div class="dd-sec"><h3>${icon('note')}Details</h3><dl class="kv">
          ${[['Seniority', d.seniority], ['Type', d.employmentType], ['Industry', d.industry], ['Function', d.jobFunction], ['Applicants', d.applicants], ['Posted', d.postedAt]].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}
        </dl></div>
        ${d.description ? `<div class="dd-sec"><h3>${icon('brief')}The posting</h3><div class="desc">${esc(d.description)}</div></div>` : ''}
      </div>`;
    $$('[data-act]', el).forEach(b => b.onclick = () => act(b.dataset.act, d, savedId));
    $$('[data-ext]', el).forEach(b => b.onclick = () => A.views.browser.open(b.dataset.ext));
  }
  function headHtml(d) {
    const chips = [
      d.location && `<span class="chip">${icon('pin')}${esc(d.location)}</span>`,
      d.workplace && `<span class="chip">${esc(d.workplace)}</span>`,
      d.pay?.text && `<span class="chip pay">${icon('money')}${esc(d.pay.text)}</span>`,
      d.experience && `<span class="chip">${icon('clock')}${esc(d.experience)}</span>`,
      d.employmentType && `<span class="chip">${icon('brief')}${esc(d.employmentType)}</span>`
    ].filter(Boolean).join('');
    return `<div class="top">${A.logo({ company: d.company, logo: d.logo }, 'lg')}<div style="min-width:0;flex:1"><div class="co">${esc(d.company || '')} <span class="source">· ${esc(d.source || '')}</span></div><h2>${esc(d.title || '')}</h2><div class="chips">${chips}</div></div></div>`;
  }

  async function act(what, d, savedId) {
    try {
      if (what === 'open') return A.views.browser.open(d.url);
      if (what === 'open-job') { A.show('jobs'); return A.views.jobs.openDrawer(savedId); }
      let id = savedId;
      if (!id) {
        const job = await onward.discover.save(d.id);
        id = job.id;
        A.fresh.add(id);
        await A.load(); A.render();
        const r = st.results.find(x => x.id === d.id); if (r) r.saved = id;
        if (st.detail) st.detail.saved = id;
        renderList(); renderDetail();
        A.toast(`Saved to your board${job.contacts?.length ? ` with ${job.contacts.length} contact${job.contacts.length > 1 ? 's' : ''}` : ''}`);
      }
      if (what === 'apply') A.views.guide.start(id);
    } catch (e) { A.toast(clean(e)); }
  }

  // ---------- Indeed, in a hidden tab (needs a real browser) ----------
  let hidden = null, queue = Promise.resolve();
  async function hiddenTab() {
    if (hidden) return hidden;
    const s = await onward.browser.prepare();
    hidden = document.createElement('webview');
    hidden.setAttribute('partition', s.partition);
    hidden.setAttribute('preload', s.preload);
    hidden.setAttribute('webpreferences', 'sandbox=yes, contextIsolation=yes');
    hidden.setAttribute('src', 'about:blank');
    $('#hiddenTabs').appendChild(hidden);
    await new Promise(r => { hidden.addEventListener('dom-ready', r, { once: true }); setTimeout(r, 8000); });
    return hidden;
  }
  function inQueue(fn) { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; }
  async function load(url) {
    const wv = await hiddenTab();
    try { await wv.loadURL(url); } catch {}
    for (let i = 0; i < 40 && wv.isLoading(); i++) await new Promise(r => setTimeout(r, 250));
    await new Promise(r => setTimeout(r, 1500));
    const blocked = await wv.executeJavaScript(`/just a moment|verify you are human|additional verification|security check/i.test(document.title + ' ' + (document.body?.innerText || '').slice(0, 600))`).catch(() => false);
    return { wv, blocked };
  }
  A.rpc('indeed:search', (q) => inQueue(async () => {
    const u = new URL('https://www.indeed.com/jobs');
    u.searchParams.set('q', q.keywords || '');
    if (q.location) u.searchParams.set('l', q.location);
    const days = { day: 1, week: 7, month: 30 }[q.posted];
    if (days) u.searchParams.set('fromage', String(days));
    if ((q.workplace || []).includes('Remote')) u.searchParams.set('sc', '0kf:attr(DSQF7);');
    if (q.sort === 'recent') u.searchParams.set('sort', 'date');
    if (q.page) u.searchParams.set('start', String(q.page * 10));
    const { wv, blocked } = await load(u.toString());
    if (blocked) return { blocked: true, results: [] };
    const list = await wv.executeJavaScript(`(() => {
      const strip = (h) => { const d = document.createElement('div'); d.innerHTML = h || ''; return d.innerText.replace(/\\s+/g, ' ').trim(); };
      const out = [];
      const res = window.mosaic?.providerData?.['mosaic-provider-jobcards']?.metaData?.mosaicProviderJobCardsModel?.results;
      if (res && res.length) {
        for (const r of res) out.push({ jk: r.jobkey, title: r.displayTitle || r.title, company: r.company, location: r.formattedLocation,
          pay: r.salarySnippet?.text || (r.extractedSalary ? '$' + Math.round(r.extractedSalary.min) + (r.extractedSalary.max ? '–$' + Math.round(r.extractedSalary.max) : '') + ' ' + (r.extractedSalary.type || '') : ''),
          posted: r.formattedRelativeTime || '', snippet: strip(r.snippet), easy: !!r.indeedApplyEnabled, remote: r.remoteWorkModel?.text || '', logo: r.companyBrandingAttributes?.logoUrl || '' });
      } else {
        for (const c of document.querySelectorAll('.job_seen_beacon, [data-jk]')) {
          const a = c.querySelector('a[data-jk], h2 a'); const jk = a?.getAttribute('data-jk') || c.getAttribute('data-jk');
          if (!jk || out.some(x => x.jk === jk)) continue;
          out.push({ jk, title: (c.querySelector('h2') || a)?.innerText?.trim(), company: c.querySelector('[data-testid="company-name"], .companyName')?.innerText?.trim(),
            location: c.querySelector('[data-testid="text-location"], .companyLocation')?.innerText?.trim(), pay: c.querySelector('[data-testid="attribute_snippet_testid"], .salary-snippet-container')?.innerText?.trim() || '',
            posted: c.querySelector('[data-testid="myJobsStateDate"], .date')?.innerText?.trim() || '', easy: /easily apply/i.test(c.innerText) });
        }
      }
      return out;
    })()`).catch(() => []);
    if (!list || !list.length) return { results: [], empty: true };
    return { results: (list || []).filter(x => x.jk && x.title).map(x => ({
      source: 'Indeed', id: 'in:' + x.jk, listingId: 'in:' + x.jk, title: x.title, company: x.company || '', location: x.location || '',
      pay: x.pay && /\d/.test(x.pay) ? { text: x.pay.replace(/\s+/g, ' ').trim() } : null, postedAt: x.posted, easyApply: x.easy, applyType: x.easy ? 'indeed' : '',
      url: 'https://www.indeed.com/viewjob?jk=' + x.jk, logo: x.logo || '', badges: x.remote ? [x.remote] : []
    })) };
  }));
  A.rpc('indeed:detail', ({ jk }) => inQueue(async () => {
    const { wv, blocked } = await load('https://www.indeed.com/viewjob?jk=' + encodeURIComponent(jk));
    if (blocked) return { blocked: true };
    const d = await wv.executeJavaScript(`(() => {
      const q = (s) => document.querySelector(s);
      const t = (s) => q(s)?.innerText?.replace(/\\s+\\n/g, '\\n').trim() || '';
      return {
        title: t('h1, [data-testid="jobsearch-JobInfoHeader-title"]').replace(/\\s*- job post$/i, ''),
        company: t('[data-testid="inlineHeader-companyName"], [data-company-name="true"], .jobsearch-CompanyInfoWithoutHeaderImage a'),
        location: t('[data-testid="inlineHeader-companyLocation"], [data-testid="job-location"], #jobLocationText'),
        pay: t('#salaryInfoAndJobType span:first-child, [data-testid="jobsearch-OtherJobDetailsContainer"] [aria-label*="Pay" i]'),
        type: t('#salaryInfoAndJobType span:nth-child(2)'),
        description: q('#jobDescriptionText')?.innerText?.trim() || '',
        applyUrl: q('#applyButtonLinkContainer a, a[href*="applystart"]')?.href || '',
        easy: !!q('#indeedApplyButton, .ia-IndeedApplyButton, [data-testid*="indeedApply" i], button[aria-label*="Apply now" i]'),
        logo: q('[data-testid="jobsearch-JobInfoHeader-logo"] img, .jobsearch-CompanyAvatar-image')?.src || ''
      };
    })()`).catch(() => null);
    if (!d) return { blocked: true };
    return { source: 'Indeed', id: 'in:' + jk, listingId: 'in:' + jk, title: d.title, company: d.company, location: d.location,
      pay: d.pay && /\d/.test(d.pay) ? { text: d.pay } : null, employmentType: d.type.replace(/^-\s*/, ''), description: d.description,
      applyType: d.easy ? 'indeed' : d.applyUrl ? 'offsite' : '', applyUrl: d.applyUrl, url: 'https://www.indeed.com/viewjob?jk=' + jk, logo: d.logo, contacts: [] };
  }));

  A.views.discover = { init, render: () => {}, mirror, search };
})();
