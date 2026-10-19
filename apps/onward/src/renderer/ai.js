/* Onward — in-app AI: a side panel with ChatGPT / Claude / Gemini (your own sign-in), or an API key.
   Onward hands the panel a prompt (profile + resume + job), waits for the answer, and turns it into
   a tailored resume, cover letter, message or answer. Every task starts a fresh chat to keep it lean. */
(() => {
  const A = window.App;
  const { $, $$, esc } = A;
  const SITES = {
    chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com/', home: 'chatgpt.com' },
    claude: { label: 'Claude', url: 'https://claude.ai/new', home: 'claude.ai' },
    gemini: { label: 'Gemini', url: 'https://gemini.google.com/app', home: 'gemini.google.com' }
  };
  const COMPOSER = '#prompt-textarea, div.ProseMirror[contenteditable="true"], rich-textarea [contenteditable="true"], .ql-editor[contenteditable="true"], textarea[data-testid*="composer" i], [contenteditable="true"][role="textbox"], textarea';
  const REPLIES = '[data-message-author-role="assistant"], .font-claude-response, .font-claude-message, [data-testid="assistant-message"], model-response .markdown, message-content, [data-content="ai-message"], [class*="ai-message" i]';
  const STOP = 'button[data-testid="stop-button"], button[aria-label*="Stop" i], button[aria-label*="stop" i], [data-testid*="stop-button" i]';

  const st = { open: false, views: new Map(), busy: null, session: null, apiLog: [] };
  const cfg = () => A.state.settings.ai || {};
  const engine = () => cfg().engine || 'web';
  const site = () => (SITES[cfg().site] ? cfg().site : 'chatgpt');
  const engineLabel = () => engine() === 'openai' ? 'OpenAI API' : engine() === 'anthropic' ? 'Anthropic API' : SITES[site()].label;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function init() {
    st.session = await onward.ai.session();
    st.open = !!A.state.ui.aiOpen;
    $('#aiToggle').onclick = () => toggle();
    render();
  }

  function toggle(force) {
    st.open = force === undefined ? !st.open : !!force;
    onward.saveUi({ aiOpen: st.open });
    render();
    if (st.open) nudge();
  }
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  // macOS can leave a <webview> black if it was created/resized while hidden or 0px wide — nudge its size
  async function nudge() {
    await frame();
    st.views.forEach(v => { v.style.width = 'calc(100% - 1px)'; });
    await frame();
    st.views.forEach(v => { v.style.width = ''; });
  }
  window.addEventListener('resize', () => { if (st.open) nudge(); });

  function currentJob() {
    const id = A.views.jobs?.openId?.() || (A.view === 'browser' ? A.views.browser?.currentJobId?.() : null);
    return id ? A.state.jobs.find(j => j.id === id) : null;
  }

  // The panel keeps its <webview>s alive; only the header and bar re-render
  function render() {
    const dock = $('#aiDock');
    $('#app').classList.toggle('ai-open', st.open);
    $('#aiToggle').classList.toggle('active', st.open);
    $('#aiToggleLabel').textContent = st.busy ? st.busy + '…' : 'Ask AI';
    if (!$('.ai-shell', dock)) {
      dock.innerHTML = `<div class="ai-shell"><div class="ai-head"></div><div class="ai-bar"></div><div class="ai-busy" id="aiBusy"></div><div class="ai-host" id="aiHost"></div><div class="ai-foot"></div></div>`;
    }
    const web = engine() === 'web';
    const key = site();
    $('.ai-head', dock).innerHTML = `
      ${web ? `<div class="seg">${Object.entries(SITES).map(([k, v]) => `<button data-site="${k}" class="${k === key ? 'active' : ''}">${v.label}</button>`).join('')}</div>`
        : `<div class="ai-engine">${icon('spark')}${esc(engineLabel())}</div>`}
      <div style="flex:1"></div>
      ${web ? `<button class="btn icon ghost sm" id="aiLogin" title="Sign in to ${esc(SITES[key].label)} in a window">${icon('person')}</button><button class="btn icon ghost sm" id="aiNew" title="New chat">${icon('plus')}</button><button class="btn icon ghost sm" id="aiReload" title="Reload">${icon('reload')}</button>` : ''}
      <button class="btn icon ghost sm" id="aiSettings" title="AI settings">${icon('plug')}</button>
      <button class="btn icon ghost sm" id="aiClose" title="Close (⌘J)">${icon('x')}</button>`;
    const job = currentJob();
    $('.ai-bar', dock).innerHTML = job
      ? `<div class="ai-ctx">${icon('brief')}<span>${esc(job.title)} · ${esc(job.company || '')}</span></div>
         <div class="chips">
           <button class="chip-btn" data-do="tailor">${icon('doc')}Tailor resume</button>
           <button class="chip-btn" data-do="cover">${icon('letter')}Cover letter</button>
           <button class="chip-btn" data-do="fit">${icon('spark')}Check fit</button>
           ${web ? `<button class="chip-btn" data-do="context">${icon('copy')}Paste job in</button>` : ''}
         </div>`
      : `<div class="ai-ctx muted">${icon('spark')}<span>Open a job (or link a browser tab to one) and Onward hands it to ${esc(engineLabel())} with your profile.</span></div>`;
    $('.ai-foot', dock).innerHTML = web
      ? `${icon('person')} Your own ${esc(SITES[key].label)} account — free plans work. Each Onward task starts a fresh chat.`
      : `${icon('plug')} Using your ${esc(engineLabel())} key (${esc(engine() === 'openai' ? cfg().openaiModel : cfg().anthropicModel)}). Change it in Connect AI.`;
    // body
    const host = $('#aiHost');
    if (web) {
      $('.api-chat', host)?.remove();
      if (st.open) ensureView(key);
      st.views.forEach((v, k) => v.classList.toggle('on', k === key));
    } else {
      st.views.forEach(v => v.classList.remove('on'));
      if (!$('.api-chat', host)) host.insertAdjacentHTML('beforeend', `<div class="api-chat"><div class="api-log" id="apiLog"></div><div class="api-input"><textarea class="input" id="apiText" rows="3" placeholder="Ask anything about your search…"></textarea><button class="btn primary" id="apiSend">${icon('send')}</button></div></div>`);
      renderApiLog();
      $('#apiSend').onclick = apiChat;
      $('#apiText').onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) apiChat(); };
    }
    bind(dock);
    setBusy(st.busy);
    renderSignin();
  }

  function bind(dock) {
    $$('[data-site]', dock).forEach(b => b.onclick = async () => { A.state.settings = await onward.saveSettings({ ai: { site: b.dataset.site } }); render(); });
    $('#aiClose', dock).onclick = () => toggle(false);
    $('#aiSettings', dock).onclick = () => A.show('settings');
    $('#aiNew', dock) && ($('#aiNew', dock).onclick = () => st.views.get(site())?.loadURL(SITES[site()].url));
    $('#aiReload', dock) && ($('#aiReload', dock).onclick = () => { st.views.get(site())?.reload(); nudge(); });
    $('#aiLogin', dock) && ($('#aiLogin', dock).onclick = signIn);
    $$('[data-do]', dock).forEach(b => b.onclick = () => {
      const job = currentJob();
      if (!job) return;
      if (b.dataset.do === 'context') return pasteContext(job.id);
      A.views.jobs.runAi(b.dataset.do, job.id);
    });
  }

  function setBusy(label) {
    st.busy = label;
    const el = $('#aiBusy');
    if (el) { el.innerHTML = label ? `<span class="dot busy"></span>${esc(label)}… <span class="muted">answer appears here, then Onward saves it</span>` : ''; el.classList.toggle('on', !!label); }
    $('#aiToggleLabel') && ($('#aiToggleLabel').textContent = label ? label + '…' : 'Ask AI');
  }

  async function ensureView(key) {
    if (st.views.has(key)) { const v = st.views.get(key); await v.__ready; return v; }
    if (st.creating?.[key]) return st.creating[key];
    st.creating = st.creating || {};
    return (st.creating[key] = (async () => {
      for (let i = 0; i < 40 && $('#aiHost').getBoundingClientRect().width < 50; i++) await sleep(50);
      await frame();
      try { return await createView(key); } finally { delete st.creating[key]; }
    })());
  }
  async function createView(key) {
    const wv = document.createElement('webview');
    wv.className = 'ai-view';
    wv.setAttribute('partition', st.session.partition);
    wv.setAttribute('preload', st.session.preload);
    wv.setAttribute('webpreferences', 'sandbox=yes, contextIsolation=yes');
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('src', SITES[key].url);
    wv.dataset.site = key;
    $('#aiHost').appendChild(wv);
    st.views.set(key, wv);
    wv.classList.toggle('on', key === site());
    wv.__ready = new Promise(r => { wv.addEventListener('dom-ready', r, { once: true }); setTimeout(r, 15000); });
    wv.addEventListener('did-stop-loading', () => checkSignedIn(key));
    await wv.__ready;
    nudge();
    return wv;
  }

  // ---------- sign-in ----------
  // Signing in happens in a normal window (passkeys, Google popups and email codes all behave there);
  // it shares its cookies with the panel, which reloads when the window closes.
  async function signIn() {
    const key = site();
    $('#aiSignin')?.classList.add('waiting');
    await onward.ai.signIn(key);
  }
  onward.ai.onSignedIn(async () => {
    st.signedOut = {};
    for (const [k, v] of st.views) { try { v.loadURL(SITES[k].url); } catch {} }
    render();
    A.toast('Signed in — the AI panel is ready');
  });
  async function checkSignedIn(key) {
    const wv = st.views.get(key);
    if (!wv) return;
    await sleep(1200);
    const r = await exec(wv, `(() => {
      const composer = [...document.querySelectorAll(${JSON.stringify(COMPOSER)})].some(e => e.getClientRects().length);
      const loginish = /log ?in|sign ?in|sign ?up|continue with (google|email|apple)/i.test((document.body?.innerText || '').slice(0, 3000));
      return { composer, loginish, url: location.href };
    })()`);
    st.signedOut = st.signedOut || {};
    st.signedOut[key] = !!r && (!r.composer || (r.loginish && /login|auth|signin|accounts\./i.test(r.url)));
    renderSignin();
  }
  function renderSignin() {
    const host = $('#aiHost');
    if (!host) return;
    let el = $('#aiSignin');
    const need = engine() === 'web' && st.signedOut?.[site()];
    if (!need) { el?.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'aiSignin'; el.className = 'ai-signin'; host.appendChild(el); }
    const label = SITES[site()].label;
    el.innerHTML = `<div class="ai-signin-card">${icon('person', 'big')}<b>Sign in to ${esc(label)}</b>
      <p>Use your own ${esc(label)} account (free works). Sign-in opens in its own window; Onward never sees your password.</p>
      <button class="btn primary" id="aiSigninBtn">${icon('external')}Sign in to ${esc(label)}</button>
      <button class="btn ghost sm" id="aiSigninHere">Use the panel instead</button></div>`;
    $('#aiSigninBtn').onclick = signIn;
    $('#aiSigninHere').onclick = () => { st.signedOut[site()] = false; renderSignin(); nudge(); };
  }
  async function loaded(wv) {
    const busy = () => { try { return wv.isLoading(); } catch { return true; } };
    for (let i = 0; i < 60 && busy(); i++) await sleep(250);
    await sleep(900);
  }
  const exec = (wv, js) => wv.executeJavaScript(js).catch(() => null);

  async function typeInto(wv, text, send) {
    const found = await exec(wv, `(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(COMPOSER)})].filter(e => e.getClientRects().length && !e.disabled && getComputedStyle(e).visibility !== "hidden");
      const el = els.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
      if (!el) return false;
      el.focus();
      if (el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      return true;
    })()`);
    if (!found) return false;
    wv.focus();
    await wv.insertText(text);
    if (send) {
      await sleep(400);
      wv.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      wv.sendInputEvent({ type: 'char', keyCode: '\r' });
      wv.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    }
    return true;
  }

  const READ = `(() => {
    const all = [...document.querySelectorAll(${JSON.stringify(REPLIES)})].filter(e => (e.innerText || '').trim());
    const last = all[all.length - 1];
    const streaming = !!document.querySelector(${JSON.stringify(STOP)});
    return { count: all.length, text: last ? last.innerText.trim() : '', streaming };
  })()`;

  async function askWeb(prompt) {
    toggle(true);
    const key = site();
    const wv = await ensureView(key);
    await loaded(wv);
    // fresh chat for every task
    try { await wv.loadURL(SITES[key].url); } catch {}
    await loaded(wv);
    let before = await exec(wv, READ) || { count: 0 };
    let sent = false;
    for (let i = 0; i < 8 && !sent; i++) { sent = await typeInto(wv, prompt, true); if (!sent) await sleep(700); }
    if (!sent) { st.signedOut = { ...(st.signedOut || {}), [key]: true }; renderSignin(); throw new Error(`Sign in to ${SITES[key].label} first (button in the AI panel), then try again.`); }
    const t0 = Date.now();
    let last = '', stable = 0, started = false;
    while (Date.now() - t0 < 240000) {
      await sleep(1100);
      const r = await exec(wv, READ);
      if (!r) continue;
      if (r.count > before.count || (r.text && r.text !== before.text)) started = true;
      if (!started || !r.text) continue;
      if (r.text === last && !r.streaming) { if (++stable >= 2) return r.text; }
      else { stable = 0; last = r.text; }
    }
    if (last) return last;
    throw new Error(`${SITES[key].label} didn't answer in time.`);
  }

  // Run an Onward AI task: build prompt → model → parse & save
  async function run(kind, args = {}) {
    if (st.busy) throw new Error('The AI is still working on something — one moment.');
    const { prompt, title } = await onward.ai.build(kind, args);
    setBusy(title);
    try {
      const reply = engine() === 'web' ? await askWeb(prompt) : await onward.ai.api(prompt);
      if (engine() !== 'web') { st.apiLog.push({ role: 'user', text: title }, { role: 'ai', text: reply }); renderApiLog(); }
      return await onward.ai.finish(kind, args, reply);
    } finally { setBusy(null); }
  }

  async function pasteContext(jobId) {
    const { prompt } = await onward.ai.build('fit', { jobId });
    const body = prompt.replace(/^Assess honestly[\s\S]*?\n\n/, 'Here is my profile, resume and a job I\'m considering. Help me with questions about it.\n\n');
    toggle(true);
    const wv = await ensureView(site());
    await loaded(wv);
    if (!(await typeInto(wv, body + '\n\n', false))) A.toast(`Sign in to ${SITES[site()].label} in the panel first`);
  }

  // API mode: a simple chat in the panel
  function renderApiLog() {
    const el = $('#apiLog');
    if (!el) return;
    el.innerHTML = st.apiLog.length ? st.apiLog.map(m => `<div class="api-msg ${m.role}">${esc(m.text)}</div>`).join('') : `<div class="api-empty">Ask about a job, your resume, or what to say to a recruiter. Onward's buttons (Tailor, Cover letter, Message) use this same key.</div>`;
    el.scrollTop = el.scrollHeight;
  }
  async function apiChat() {
    const ta = $('#apiText');
    const q = ta.value.trim();
    if (!q || st.busy) return;
    ta.value = '';
    st.apiLog.push({ role: 'user', text: q }); renderApiLog();
    setBusy('Thinking');
    try {
      const job = currentJob();
      let ctx = '';
      if (job) { const b = await onward.ai.build('fit', { jobId: job.id }); ctx = b.prompt.replace(/^Assess honestly[\s\S]*?\n\n/, '') + '\n\n'; }
      const history = st.apiLog.slice(-10).map(m => (m.role === 'user' ? 'User: ' : 'Assistant: ') + m.text).join('\n\n');
      const reply = await onward.ai.api(`You are a sharp, practical career coach helping the user with their job search.\n\n${ctx}Conversation so far:\n${history}\n\nAssistant:`);
      st.apiLog.push({ role: 'ai', text: reply });
    } catch (e) { st.apiLog.push({ role: 'ai', text: '⚠️ ' + (e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }); }
    finally { setBusy(null); renderApiLog(); }
  }

  A.AI = { init, render, toggle, run, askWeb, isOpen: () => st.open, engineLabel, SITES, busy: () => st.busy };
  A.views.ai = { init, render };
})();
