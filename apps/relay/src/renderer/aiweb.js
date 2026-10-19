/* Relay — Assistant panel, "free account" mode.
   Most people have a free Claude, ChatGPT, Gemini or Copilot account but no API key, so the panel can
   simply open those sites, signed in with your own account. Relay adds the glue: it pastes the email
   (or page, or calendar) you're looking at into the chat, runs one-click prompts, and puts the reply
   back into your email draft. Relay never sees your chats — they're just those websites, side by side. */
(() => {
  const R = () => window.RelayApp;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const PARTITION = 'persist:relay-ai';
  const SITES = {
    claude:  { label: 'Claude',  mark: 'claude',  url: 'https://claude.ai/new', home: 'claude.ai' },
    chatgpt: { label: 'ChatGPT', mark: 'gpt',     url: 'https://chatgpt.com/', home: 'chatgpt.com' },
    gemini:  { label: 'Gemini',  mark: 'gemini',  url: 'https://gemini.google.com/app', home: 'gemini.google.com' },
    copilot: { label: 'Copilot', mark: 'copilot', url: 'https://copilot.microsoft.com/', home: 'copilot.microsoft.com' }
  };
  const w = { host: null, views: new Map(), busy: false };
  const site = () => (SITES[R().state.settings.aiWeb] ? R().state.settings.aiWeb : 'claude');

  // Where to type and where replies show up, per site (with generic fallbacks)
  const COMPOSER = '#prompt-textarea, div.ProseMirror[contenteditable="true"], rich-textarea [contenteditable="true"], .ql-editor[contenteditable="true"], textarea#userInput, textarea[data-testid*="composer" i], [contenteditable="true"][role="textbox"], textarea';
  const REPLIES = '[data-message-author-role="assistant"], .font-claude-message, [data-testid="assistant-message"], .font-claude-response, message-content, model-response .markdown, [data-content="ai-message"], [class*="ai-message" i]';

  const PROMPTS = {
    summarize: (kind) => kind === 'page' ? 'Summarize this page in 5 short bullet points.' : kind === 'calendar' ? 'Give me a short plan for my week based on this calendar.' : 'Summarize this email in 3 bullet points, then tell me if it needs a reply and by when.',
    reply: () => 'Draft a reply to this email. Keep it friendly, clear and brief. Reply with only the email text, from greeting to sign-off.',
    todos: () => 'List every action item, request or deadline in this, as a short checklist.'
  };

  async function ensureView(key) {
    if (w.views.has(key)) return w.views.get(key);
    const { preload } = await relay.prepareSession(PARTITION, 'auto', false);
    const wv = document.createElement('webview');
    wv.className = 'aiw-view';
    wv.setAttribute('partition', PARTITION);
    wv.setAttribute('preload', preload);
    wv.setAttribute('webpreferences', 'sandbox=yes');
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('src', SITES[key].url);
    wv.dataset.site = key;
    w.host.appendChild(wv);
    wv.addEventListener('did-start-loading', () => w.host?.classList.add('loading'));
    wv.addEventListener('did-stop-loading', () => w.host?.classList.remove('loading'));
    w.views.set(key, wv);
    return wv;
  }

  // The chat sites live in <webview>s that must never leave the page (that would reload them),
  // so the panel keeps one fixed frame and only refreshes the header and the context bar.
  function render(panel) {
    const { esc } = R();
    const key = site();
    let inner = $('.ai-inner.aiw', panel);
    if (!inner || !w.host || !inner.contains(w.host)) {
      if (!w.host) { w.host = document.createElement('div'); w.host.className = 'aiw-host'; w.host.innerHTML = '<div class="loading-bar"></div>'; }
      panel.innerHTML = '<div class="ai-inner aiw"><div class="ai-head"></div><div class="aiw-bar"></div><div class="aiw-foot"></div></div>';
      inner = $('.ai-inner.aiw', panel);
      inner.insertBefore(w.host, $('.aiw-foot', inner));
    }
    const ctx = window.AI.contextLabel();
    $('.ai-head', inner).innerHTML = `
        <div class="seg wide aiw-sites" id="aiwSites">${Object.entries(SITES).map(([k, v]) => `<button data-site="${k}" class="${k === key ? 'active' : ''}" title="${v.label} — your own account"><span class="ai-mark ${v.mark}"></span>${v.label}</button>`).join('')}</div>
        <button class="icon-btn" id="aiwMore" title="More">${ic('dots', 17)}</button>
        <button class="icon-btn" id="aiClose" title="Close (⌘J)">${ic('x', 16)}</button>`;
    $('.aiw-bar', inner).innerHTML = ctx ? `<div class="aiw-ctx" title="What Relay will paste into the chat">${ic(ctx.icon, 13)}<span>${ctx.html.replace(/^Include /, '').replace(/^./, c => c.toUpperCase())}</span></div>
        <div class="aiw-actions">
          <button class="chip" data-act="paste" title="Paste it into the chat so you can ask anything">${ic('copy', 12)}Paste in</button>
          <button class="chip" data-act="summarize">${ic('list', 12)}Summarize</button>
          ${ctx.icon === 'mail' ? `<button class="chip" data-act="reply">${ic('reply', 12)}Draft reply</button>` : `<button class="chip" data-act="todos">${ic('check', 12)}To-dos</button>`}
          ${ctx.icon === 'mail' ? `<button class="chip" data-act="insert" title="Put the latest answer into your email draft">${ic('edit', 12)}Use answer</button>` : ''}
        </div>` : `<div class="aiw-ctx muted">${ic('sparkles', 13)}<span>Open an email, a page or your calendar and Relay can hand it to ${esc(SITES[key].label)} for you.</span></div>`;
    $('.aiw-foot', inner).innerHTML = `${ic('lock', 11)} Your own ${esc(SITES[key].label)} account — free plans work. Relay doesn’t see your chats.`;
    // only load the chat site once the panel is actually open
    if (R().state.aiOpen) ensureView(key).then(() => { w.views.forEach((v, k) => v.classList.toggle('on', k === key)); });
    w.views.forEach((v, k) => v.classList.toggle('on', k === key));
    bind(inner);
  }
  function updateContext() { const p = document.getElementById('aiPanel'); if (p && $('.ai-inner.aiw', p)) render(p); }

  function bind(panel) {
    $$('#aiwSites [data-site]', panel).forEach(b => b.onclick = async () => {
      R().state.settings = await relay.saveSettings({ aiWeb: b.dataset.site });
      window.AI.render();
    });
    $('#aiClose', panel).onclick = () => R().toggleAI(false);
    $('#aiwMore', panel).onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const wv = w.views.get(site());
      R().popMenu(r.right - 250, r.bottom + 4, [
        { label: 'New chat', icon: 'newChat', onClick: () => wv?.loadURL(SITES[site()].url) },
        { label: 'Reload', icon: 'refresh', onClick: () => wv?.reload() },
        { label: `Open ${SITES[site()].label} in a browser tab`, icon: 'globe', onClick: () => window.Browser?.openTab(wv?.getURL() || SITES[site()].url) },
        '-',
        { label: 'Use API keys instead', icon: 'key', onClick: () => setMode('api') },
        { label: 'Use Assist (offline, on this computer)', icon: 'sparkles', onClick: () => setMode('assist') },
        '-',
        { label: 'Panel wider', icon: 'chevronLeft', onClick: () => window.AI.resize(+80) },
        { label: 'Panel narrower', icon: 'chevronRight', onClick: () => window.AI.resize(-80) }
      ]);
    };
    $$('[data-act]', panel).forEach(b => b.onclick = () => act(b.dataset.act));
  }

  async function setMode(mode) {
    R().state.settings = await relay.saveSettings({ aiMode: mode, ...(mode === 'assist' ? { aiProvider: 'assist' } : mode === 'api' && R().state.settings.aiProvider === 'assist' ? { aiProvider: 'claude' } : {}) });
    window.AI.render();
  }

  // Put text into the site's message box (and optionally send it)
  async function type(text, send) {
    const wv = await ensureView(site());
    if (w.busy) return;
    w.busy = true;
    try {
      const found = await wv.executeJavaScript(`(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(COMPOSER)})].filter(e => e.getClientRects().length && !e.disabled && getComputedStyle(e).visibility !== "hidden");
        const el = els.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
        if (!el) return false;
        el.focus();
        if (el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
        return true;
      })()`).catch(() => false);
      if (!found) { R().toast(`Sign in to ${SITES[site()].label} in the panel first`, 'error'); return; }
      wv.focus();
      await wv.insertText(text);
      if (send) {
        await new Promise(r => setTimeout(r, 250));
        wv.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
        wv.sendInputEvent({ type: 'char', keyCode: '\r' });
        wv.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      }
    } finally { w.busy = false; }
  }

  async function act(what) {
    if (what === 'insert') return useAnswer();
    const ctx = await window.AI.grabContext();
    if (!ctx?.text) { R().toast('Nothing to share yet — open an email, page or your calendar', 'error'); return; }
    const kind = /calendar/i.test(ctx.label) ? 'calendar' : /page|browser/i.test(ctx.label) || R().state.ui.platform === 'browser' ? 'page' : 'email';
    const body = `${kind === 'email' ? 'Here is an email I received' : kind === 'page' ? 'Here is a web page I am reading' : 'Here is my calendar'} (${ctx.label}):\n\n"""\n${ctx.text.slice(0, 16000)}\n"""\n\n`;
    if (what === 'paste') return type(body, false);
    return type(body + (PROMPTS[what] || PROMPTS.summarize)(kind), true);
  }

  // Take the latest answer from the chat and put it in your email draft
  async function useAnswer() {
    const wv = w.views.get(site());
    let text = '';
    if (wv) text = await wv.executeJavaScript(`(() => { const all = [...document.querySelectorAll(${JSON.stringify(REPLIES)})].filter(e => e.innerText.trim()); return all.length ? all[all.length - 1].innerText.trim() : ''; })()`).catch(() => '');
    if (!text) { try { text = (await navigator.clipboard.readText()).trim(); } catch {} }
    if (!text) { R().toast('Copy the answer in the chat first, then press Use answer', 'error'); return; }
    window.AI.insertIntoEmail(text);
  }

  // Inbox briefing for people without an API key: hand the inboxes to the free chat
  async function briefing(text) {
    if (!R().state.aiOpen) R().toggleAI(true);
    if (R().state.settings.aiMode !== 'web') { R().state.settings = await relay.saveSettings({ aiMode: 'web' }); }
    window.AI.render();
    await new Promise(r => setTimeout(r, 600));
    const wv = await ensureView(site());
    if (wv.isLoading()) await new Promise(r => wv.addEventListener('did-stop-loading', r, { once: true }));
    await new Promise(r => setTimeout(r, 1200));
    return type(text, true);
  }

  window.AIWeb = { render, updateContext, act, type, briefing, SITES, views: w.views };
})();
