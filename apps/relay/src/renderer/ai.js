/* Relay — Claude & ChatGPT plugin panel */
(() => {
  const R = () => window.RelayApp;
  const PROVIDERS = {
    claude: { label: 'Claude', mark: 'claude', modelKey: 'claudeModel', keyFlag: 'hasClaudeKey' },
    openai: { label: 'ChatGPT', mark: 'gpt', modelKey: 'openaiModel', keyFlag: 'hasOpenaiKey' },
    assist: { label: 'Assist', mark: 'assist', modelKey: null, keyFlag: 'assistOn', offline: true }
  };
  // Assist (Bilal's offline drafting app) — tone/length options mirror Assist's own
  const TONES = [['professional', 'Professional'], ['friendly', 'Friendly'], ['casual', 'Casual'], ['empathetic', 'Empathetic'], ['firm', 'Firm'], ['enthusiastic', 'Upbeat']];
  const LENGTHS = [['short', 'Short'], ['medium', 'Medium'], ['long', 'Long']];
  const REFINES = [['Shorter', 'Make it shorter.'], ['More formal', 'Make it more formal.'], ['Warmer', 'Make it warmer and friendlier.'], ['Say no politely', 'Politely decline instead.']];
  const assistPrefs = (() => { try { return JSON.parse(localStorage.getItem('relay-assist') || '{}'); } catch { return {}; } })();
  const ai = {
    messages: [], // {role, content, display, provider, ctxLabel, error}
    streaming: null, // reqId
    useContext: true,
    pendingSelection: '',
    streamKind: 'chat', // 'chat' | 'assist'
    assist: { status: null, checkedAt: 0, tone: assistPrefs.tone || 'professional', length: assistPrefs.length || 'medium', intent: '' }
  };
  const saveAssistPrefs = () => { try { localStorage.setItem('relay-assist', JSON.stringify({ tone: ai.assist.tone, length: ai.assist.length })); } catch {} };
  const assistOn = () => R().state.settings.assistEnabled !== false;
  async function refreshAssistStatus(force = false) {
    if (!force && Date.now() - ai.assist.checkedAt < 15000) return ai.assist.status;
    ai.assist.checkedAt = Date.now();
    try { ai.assist.status = await relay.assist.status({ start: false }); } catch { ai.assist.status = null; }
    R().state.settings.assistOn = assistOn() && !!ai.assist.status && ai.assist.status.installed !== false;
    return ai.assist.status;
  }
  const panel = () => document.getElementById('aiPanel');
  const provider = () => R().state.settings.aiProvider || 'claude';

  /* ---------- markdown (small, safe) ---------- */
  function md(src) {
    const esc = R().esc;
    const blocks = [];
    let s = String(src).replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, (_, lang, code) => { blocks.push(`<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
    s = esc(s);
    const inline = (t) => t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a data-href="$2" style="color:var(--accent);cursor:pointer">$1</a>');
    const lines = s.split('\n');
    let html = '', list = null, para = [];
    const flushP = () => { if (para.length) { html += `<p>${inline(para.join('<br>'))}</p>`; para = []; } };
    const flushL = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const line of lines) {
      let m;
      if (/^\u0000\d+\u0000$/.test(line.trim())) { flushP(); flushL(); html += line.trim(); continue; }
      if ((m = line.match(/^(#{1,3})\s+(.*)/))) { flushP(); flushL(); html += `<h3>${inline(m[2])}</h3>`; continue; }
      if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { flushP(); if (list !== 'ul') { flushL(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flushP(); if (list !== 'ol') { flushL(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; continue; }
      if ((m = line.match(/^&gt;\s?(.*)/))) { flushP(); flushL(); html += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
      if (!line.trim()) { flushP(); flushL(); continue; }
      flushL(); para.push(line);
    }
    flushP(); flushL();
    return html.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
  }

  /* ---------- context ---------- */
  function activeAccount() {
    const { state, accountById } = R();
    const p = state.ui.platform;
    if (p === 'calendar') return null;
    const fid = window.Split?.focusedId();
    if (fid && accountById(fid)) return accountById(fid);
    return accountById(state.ui.selected[p]);
  }
  function contextLabel() {
    const { state, PLATFORMS } = R();
    if (state.ui.platform === 'calendar') return { icon: 'calendar', html: 'Include <b>your calendar</b> (next 7 days)' };
    if (state.ui.platform === 'home') return { icon: 'home', html: 'Include your <b>tasks, calendar & briefing</b>' };
    if (state.ui.platform === 'vault') return null;
    if (state.ui.platform === 'browser') return window.Browser?.activeWebview() ? { icon: 'globe', html: `Include <b>this page</b>${window.Browser.isIncognito() ? ' (incognito)' : ''}` } : null;
    if (state.ui.platform === 'storage') return null;
    const a = activeAccount();
    if (!a) return null;
    if (a.platform === 'chats') return { icon: 'chat', html: `Include this <b>${R().esc(R().chatService(a)?.label || 'chat')}</b> conversation` };
    return { icon: 'mail', html: `Include open email from <b>${R().esc(a.name || a.email || PLATFORMS[a.platform].label)}</b>` };
  }
  async function grabContext() {
    const { state, webviews, PLATFORMS } = R();
    if (state.ui.platform === 'calendar') {
      const t = window.Calendar?.upcomingText() || '';
      return { label: 'Calendar · next 7 days', text: t || '(No events in the next 7 days.)' };
    }
    if (state.ui.platform === 'home') {
      const parts = [];
      parts.push('Open tasks:\n' + (window.Home?.summaryText() || '(none)'));
      parts.push('Calendar, next 7 days:\n' + (window.Calendar?.upcomingText() || '(nothing scheduled)'));
      const br = window.Briefing?.contextText();
      if (br) parts.push('Latest inbox briefing:\n' + br);
      return { label: 'Home · tasks, calendar & briefing', text: parts.join('\n\n') };
    }
    if (state.ui.platform === 'vault' || state.ui.platform === 'storage') return null;
    if (state.ui.platform === 'browser') return window.Browser?.pageContext();
    const a = activeAccount();
    const wv = a && webviews.get(a.id)?.wv;
    if (!wv) return null;
    const js = `(() => {
      const sel = String(window.getSelection() || '').trim();
      const pick = (q) => [...document.querySelectorAll(q)].map(e => e.innerText.trim()).filter(Boolean).join('\\n\\n---\\n\\n');
      const subject = (document.querySelector('h2.hP, [role="heading"][aria-level="2"], [data-test-id="message-group-subject-text"], .JdFsz, [id$="_SUBJECT"]') || {}).innerText || '';
      let body = pick('.a3s.aiL, .a3s') || pick('[aria-label="Message body"], [aria-label="Reading Pane"] [role="document"], div[autoid*="ReadingPane"], .XbIp4') || pick('[data-test-id="message-view-body-content"], [data-test-id="message-view"]');
      const draft = pick('[contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label*="Message"], div[contenteditable="true"]');
      if (!body) body = (document.querySelector('[role="main"]') || document.body).innerText;
      return { sel, subject: subject.trim(), body: body.slice(0, 14000), draft: draft.slice(0, 4000), url: location.href };
    })()`;
    try {
      const r = await wv.executeJavaScript(js);
      let text = '';
      if (r.subject) text += `Subject: ${r.subject}\n\n`;
      text += r.body || '';
      if (r.draft) text += `\n\n[User's draft in progress]\n${r.draft}`;
      if (r.sel) text += `\n\n[User's selected text]\n${r.sel}`;
      return { label: `${PLATFORMS[a.platform].label} · ${a.name || a.email}`, text: text.trim(), selection: r.sel, draft: r.draft };
    } catch { return null; }
  }

  function systemPrompt() {
    const { state, PLATFORMS } = R();
    const accts = R().mailAccounts().map(a => `${a.name || ''} <${a.email || a.url || ''}> (${PLATFORMS[a.platform].label})`).join('; ') || 'none yet';
    return `You are the assistant built into Relay, a Mac app that unifies the user's email inboxes (Gmail, Outlook, Yahoo and others) and calendars.
Today is ${new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, local time ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
The user's connected accounts: ${accts}.
When the user shares an email or calendar inside <context>, ground your answer in it. Be concise and practical.
When asked to draft or rewrite an email, return only the email text (greeting through sign-off) with no preamble, so it can be pasted directly. Match the tone of the thread unless told otherwise.`;
  }

  /* ---------- render ---------- */
  const aiMode = () => R().state.settings.aiMode || 'web';
  function render() {
    const el = panel();
    if (!el) return;
    ensureResizer(el);
    if (aiMode() === 'web' && window.AIWeb) return window.AIWeb.render(el);
    const { state, esc } = R();
    // API-key mode shows Claude / ChatGPT; Assist mode shows Assist
    if (aiMode() === 'assist' && provider() !== 'assist') state.settings.aiProvider = 'assist';
    if (aiMode() === 'api' && provider() === 'assist') state.settings.aiProvider = 'claude';
    const p = provider();
    const P = PROVIDERS[p];
    if (p === 'assist' && Date.now() - ai.assist.checkedAt > 15000) refreshAssistStatus().then(() => { if (provider() === 'assist') render(); });
    const hasKey = p === 'assist' ? assistOn() : !!state.settings[P.keyFlag];
    const isMail = !!R().PLATFORMS[state.ui.platform];
    const isCal = state.ui.platform === 'calendar';
    const isHome = state.ui.platform === 'home';
    const isVault = state.ui.platform === 'vault';
    const isWeb = state.ui.platform === 'browser';
    const quick = (isVault || state.ui.platform === 'storage') ? [] : isWeb
      ? [['Summarize page', 'list', 'Summarize this page in 5 short bullet points.'],
         ['Key facts', 'check', 'Pull out the key facts, numbers and dates from this page.'],
         ['Explain simply', 'sparkles', 'Explain what this page is about in plain language, as if to a smart friend.']]
      : isHome
      ? [['Plan my day', 'sun', 'Using my tasks, calendar and inbox briefing, give me a realistic plan for today with rough times.'],
         ['What first?', 'flag', 'What is the single most important thing I should do next, and why?'],
         ['Draft replies', 'reply', 'For each email in my briefing that needs a reply, draft a short reply I can paste.']]
      : isCal
      ? [['Plan my week', 'list', 'Look at my calendar and give me a short plan for the week: priorities, busy days, and gaps I can use for focused work.'],
         ['Find free time', 'clock', 'When am I free for a 1-hour meeting in the next few days? List the best 3 options.'],
         ['Prep for next event', 'sparkles', 'What is my next event and how should I prepare for it?']]
      : [['Summarize', 'list', 'Summarize this email in 3 bullet points, then tell me if it needs a reply and by when.'],
         ['Draft reply', 'reply', 'Draft a reply to this email. Keep it friendly, clear and brief.'],
         ['Action items', 'check', 'List every action item, request or deadline in this email.'],
         ['Polish my draft', 'wand', 'Rewrite my draft (or selected text) to be clearer and more professional. Keep my voice.'],
         ['Translate', 'languages', 'Translate this email into English (or into Spanish if it is already English).']];

    el.innerHTML = `<div class="ai-inner">
      <div class="ai-head">
        <div class="seg wide" id="aiProv">${Object.entries(PROVIDERS).filter(([k]) => aiMode() === 'assist' ? k === 'assist' : k !== 'assist').map(([k, v]) => `<button data-p="${k}" class="${k === p ? 'active' : ''}"><span class="ai-mark ${v.mark}"></span>${v.label}${aiMode() === 'api' ? ' <small class="api-tag">API</small>' : aiMode() === 'assist' ? ' <small class="api-tag">offline</small>' : ''}</button>`).join('')}</div>
        <button class="icon-btn" id="aiNew" title="New chat">${ic('newChat', 17)}</button>
        <button class="icon-btn" id="aiModeBtn" title="Switch how the assistant works">${ic('dots', 17)}</button>
        <button class="icon-btn" id="aiClose" title="Close (⌘J)">${ic('x', 16)}</button>
      </div>
      ${hasKey ? '' : p === 'assist' ? `<div class="ai-nokey">${ic('key', 18)}<span><b>Assist is turned off</b><br>Turn it on in Settings → AI plugins.</span><button class="btn" id="aiAddKey">Settings</button></div>`
        : `<div class="ai-nokey">${ic('key', 18)}<span><b>Connect ${P.label}</b><br>Add your API key to start.</span><button class="btn" id="aiAddKey">Add key</button></div>`}
      <div class="ai-msgs" id="aiMsgs">${p === 'assist' && hasKey && isMail ? assistCardHTML() : ''}${ai.messages.length ? ai.messages.map(msgHTML).join('') : p === 'assist' && isMail ? '' : welcomeHTML(quick)}</div>
      ${ai.messages.length && !(p === 'assist' && isMail) ? `<div class="ai-quick"><div class="chips">${quick.slice(0, 3).map(([l, i, q]) => `<button class="chip" data-q="${esc(q)}">${ic(i, 13)}${l}</button>`).join('')}</div></div>` : ''}
      <div id="aiCtx"></div>
      <div class="ai-compose">
        <div class="composer">
          <textarea id="aiInput" rows="1" placeholder="${p === 'assist' ? 'Ask Assist anything — it runs on this computer…' : `Ask ${P.label} anything…`}"></textarea>
          <div class="composer-bar">
            <span class="model">${p === 'assist' ? esc(assistModelLabel()) : esc(state.settings[P.modelKey] || '')}</span>
            <button class="send ${ai.streaming ? 'stop' : ''}" id="aiSend" title="${ai.streaming ? 'Stop' : 'Send (↵)'}">${ic(ai.streaming ? 'stop' : 'send', 16)}</button>
          </div>
        </div>
      </div>
    </div>`;
    updateContext();
    bind(el);
    scrollDown();
  }

  function welcomeHTML(quick) {
    const name = R().state.accounts[0]?.name?.split(' ')[0];
    return `<div class="ai-welcome">
      <h4>Hey${name && !/work|personal|gmail|outlook|yahoo/i.test(name) ? ' ' + R().esc(name) : ''}, <span>what can I take off your plate?</span></h4>
      <p>${R().state.ui.platform === 'vault' ? 'I can’t see your password vault — it stays private. Switch to another tab to give me context.' : 'I can read the email you have open, draft replies, pull out to-dos, or plan around your calendar.'}</p>
      <div class="chips">${quick.map(([l, i, q]) => `<button class="chip" data-q="${R().esc(q)}">${ic(i, 13)}${l}</button>`).join('')}</div>
    </div>`;
  }

  function assistModelLabel() {
    const st = ai.assist.status;
    if (!st) return 'Offline · on this computer';
    if (st.running && st.modelName) return `${st.modelName} model · offline`;
    return 'Offline · starts Assist when needed';
  }
  function assistStatusHTML() {
    const st = ai.assist.status;
    if (!st) return '<span class="ac-dot"></span>Checking…';
    if (st.code === 'disabled' || st.assistEnabled === false) return '<span class="ac-dot warn"></span>Turned off in Assist';
    if (st.running && st.downloaded === false) return '<span class="ac-dot warn"></span>Model not downloaded';
    if (st.running) return `<span class="ac-dot on"></span>Ready · ${R().esc(st.modelName || 'offline')}`;
    if (st.installed === false) return '<span class="ac-dot warn"></span>Not installed';
    return '<span class="ac-dot"></span>Starts when needed';
  }
  function assistCardHTML() {
    const esc = R().esc;
    const busy = ai.streaming && ai.streamKind === 'assist';
    return `<div class="assist-card">
      <div class="ac-head"><span class="ai-mark assist"></span>Reply with Assist<small>${assistStatusHTML()}</small></div>
      <div class="chips" id="acTone">${TONES.map(([v, l]) => `<button class="chip ${ai.assist.tone === v ? 'on' : ''}" data-tone="${v}">${l}</button>`).join('')}</div>
      <div class="ac-row">
        <div class="seg" id="acLen">${LENGTHS.map(([v, l]) => `<button data-len="${v}" class="${ai.assist.length === v ? 'active' : ''}">${l}</button>`).join('')}</div>
      </div>
      <textarea id="acIntent" placeholder="What should the reply say? (optional) e.g. yes to Thursday, ask about parking">${esc(ai.assist.intent)}</textarea>
      <div class="ac-row">
        <span class="ac-note">Drafts the email you have open. Runs on <b>this computer</b> — nothing is sent anywhere.</span>
        <button class="btn ac-go" id="acGo" ${busy ? 'disabled' : ''}>${ic('reply', 14)} ${busy ? 'Writing…' : 'Draft reply'}</button>
      </div>
      ${ai.assist.status?.installed === false ? `<div class="ac-note">Assist isn’t installed on this computer yet — install it from the Utility Suite.</div>` : ''}
      ${ai.assist.status?.running && ai.assist.status.downloaded === false ? `<div class="ac-note">Open Assist once to download its AI model. <a class="link" id="acOpen">Open Assist</a></div>` : ''}
    </div>`;
  }

  function msgHTML(m, i) {
    const esc = R().esc;
    if (m.role === 'user') return `<div class="msg user">${m.ctxLabel ? `<span class="ctx-tag">${ic('link', 11)} ${esc(m.ctxLabel)}</span>` : ''}<div class="bubble">${esc(m.display ?? m.content)}</div></div>`;
    const P = PROVIDERS[m.provider] || PROVIDERS.claude;
    const live = ai.streaming && i === ai.messages.length - 1;
    return `<div class="msg assistant ${m.error ? 'error' : ''}" data-i="${i}">
      <div class="who"><span class="ai-mark ${P.mark}"></span>${P.label}
        ${!live && !m.error ? `<span class="tools" style="margin-left:auto">
          <button class="icon-btn sm" data-copy="${i}" title="Copy">${ic('copy', 14)}</button>
          <button class="icon-btn sm" data-task="${i}" title="Save as a task with notes">${ic('checkCircle', 14)}</button>
          ${R().PLATFORMS[R().state.ui.platform] ? `<button class="icon-btn sm" data-insert="${i}" title="Insert into the open email draft">${ic('edit', 14)}</button>` : ''}
        </span>` : ''}</div>
      <div class="body">${m.content ? (m.plain ? `<p style="white-space:pre-wrap">${esc(m.content)}</p>` : md(m.content)) : ''}${live ? (m.content ? '<span class="caret"></span>' : m.progress ? `<span class="progress-note">${ic('refresh', 12, 'spin-ic')} ${esc(m.progress)}</span>` : '<span class="typing"><i></i><i></i><i></i></span>') : ''}</div>
      ${m.draft && !live && !m.error ? `<div class="refine-chips">${REFINES.map(([l, q]) => `<button class="chip" data-refine="${i}" data-rq="${esc(q)}">${l}</button>`).join('')}<button class="chip" data-redo="${i}">${ic('refresh', 12)}Try again</button></div>` : ''}
      ${m.error && m.code === 'model_missing' ? `<div class="refine-chips"><button class="chip" data-open-assist>${ic('external', 12)}Open Assist</button></div>` : ''}
    </div>`;
  }

  function updateContext() {
    if (aiMode() === 'web') { window.AIWeb?.updateContext(); return; }
    const box = document.getElementById('aiCtx');
    if (!box) return;
    const c = contextLabel();
    box.innerHTML = c ? `<div class="ai-context">${ic(c.icon, 15)}<span class="label-sm">${c.html}</span>
      <label class="switch" title="Send this as context"><input type="checkbox" id="aiUseCtx" ${ai.useContext ? 'checked' : ''}><span></span></label></div>` : '';
    const cb = document.getElementById('aiUseCtx');
    if (cb) cb.onchange = () => { ai.useContext = cb.checked; };
  }

  function bind(el) {
    const { state } = R();
    el.querySelectorAll('#aiProv button').forEach(b => b.onclick = async () => {
      state.settings = await relay.saveSettings({ aiProvider: b.dataset.p });
      render();
    });
    el.querySelector('#aiNew').onclick = () => { if (ai.streaming) (ai.streamKind === 'assist' ? relay.assist.cancel(ai.streaming) : relay.aiCancel(ai.streaming)); ai.streaming = null; ai.messages = []; render(); };
    el.querySelector('#aiClose').onclick = () => R().toggleAI(false);
    el.querySelector('#aiModeBtn').onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const set = async (mode) => { R().state.settings = await relay.saveSettings({ aiMode: mode, ...(mode === 'assist' ? { aiProvider: 'assist' } : mode === 'api' ? { aiProvider: provider() === 'assist' ? 'claude' : provider() } : {}) }); render(); };
      R().popMenu(r.right - 270, r.bottom + 4, [
        { label: 'Free accounts — Claude, ChatGPT, Gemini, Copilot', icon: 'globe', onClick: () => set('web') },
        { label: 'API keys (Claude / ChatGPT)', icon: 'key', onClick: () => set('api') },
        { label: 'Assist — offline, on this computer', icon: 'sparkles', onClick: () => set('assist') },
        '-',
        { label: 'AI settings…', icon: 'settings', onClick: () => R().openSettings('ai') }
      ]);
    };
    el.querySelector('#aiAddKey')?.addEventListener('click', () => R().openSettings('ai'));
    el.querySelectorAll('#acTone [data-tone]').forEach(b => b.onclick = () => { ai.assist.tone = b.dataset.tone; saveAssistPrefs(); el.querySelectorAll('#acTone [data-tone]').forEach(x => x.classList.toggle('on', x === b)); });
    el.querySelectorAll('#acLen [data-len]').forEach(b => b.onclick = () => { ai.assist.length = b.dataset.len; saveAssistPrefs(); el.querySelectorAll('#acLen [data-len]').forEach(x => x.classList.toggle('active', x === b)); });
    const it = el.querySelector('#acIntent'); if (it) it.oninput = () => { ai.assist.intent = it.value; };
    el.querySelector('#acGo')?.addEventListener('click', () => assistDraft());
    el.querySelectorAll('#acOpen, [data-open-assist]').forEach(b => b.onclick = () => relay.assist.open());
    el.querySelectorAll('[data-refine]').forEach(b => b.onclick = () => assistDraft({ refineOf: +b.dataset.refine, instruction: b.dataset.rq }));
    el.querySelectorAll('[data-redo]').forEach(b => b.onclick = () => assistDraft({ refineOf: +b.dataset.redo, regenerate: true }));
    el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => send(b.dataset.q, b.textContent.trim()));
    el.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard.writeText(ai.messages[+b.dataset.copy].content); R().toast('Copied'); });
    el.querySelectorAll('[data-task]').forEach(b => b.onclick = async () => {
      const m = ai.messages[+b.dataset.task];
      const q = ai.messages[+b.dataset.task - 1];
      const title = (q?.display || 'AI note').split('\n')[0].slice(0, 80);
      await window.Home?.addTask(title, { notes: m.content });
      R().toast('Saved to Tasks & notes');
    });
    el.querySelectorAll('[data-insert]').forEach(b => b.onclick = () => insertIntoEmail(ai.messages[+b.dataset.insert].content));
    el.querySelectorAll('a[data-href]').forEach(a => a.onclick = () => relay.openExternal(a.dataset.href));
    const ta = el.querySelector('#aiInput');
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(180, ta.scrollHeight) + 'px'; };
    ta.oninput = grow;
    ta.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!ai.streaming && ta.value.trim()) send(ta.value.trim()); }
    };
    if (ai.pendingSelection) { ta.value = ai.pendingSelection; ai.pendingSelection = ''; grow(); }
    el.querySelector('#aiSend').onclick = () => {
      if (ai.streaming) { ai.streamKind === 'assist' ? relay.assist.cancel(ai.streaming) : relay.aiCancel(ai.streaming); return; }
      if (ta.value.trim()) send(ta.value.trim());
    };
  }

  function scrollDown() { const m = document.getElementById('aiMsgs'); if (m) m.scrollTop = m.scrollHeight; }

  async function insertIntoEmail(text) {
    const a = activeAccount();
    const wv = a && R().webviews.get(a.id)?.wv;
    if (!wv) return;
    const clean = text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '');
    wv.focus();
    const ok = await wv.executeJavaScript(`(() => { const el = document.activeElement; return !!(el && (el.isContentEditable || /TEXTAREA|INPUT/.test(el.tagName))); })()`).catch(() => false);
    if (ok) { wv.insertText(clean); R().toast('Inserted into your draft'); }
    else { navigator.clipboard.writeText(clean); R().toast('Click into a reply box first — copied to clipboard for now'); }
  }

  /* ---------- send ---------- */
  async function send(text, displayOverride) {
    const { state } = R();
    const p = provider();
    if (p === 'assist' ? !assistOn() : !state.settings[PROVIDERS[p].keyFlag]) { R().openSettings('ai'); return; }
    let content = text, ctxLabel = '';
    if (ai.useContext && contextLabel()) {
      const ctx = await grabContext();
      if (ctx && ctx.text) {
        ctxLabel = ctx.label;
        content = `<context source="${ctx.label}">\n${ctx.text}\n</context>\n\n${text}`;
      }
    }
    ai.messages.push({ role: 'user', content, display: displayOverride && displayOverride !== text ? displayOverride : text, ctxLabel });
    ai.messages.push({ role: 'assistant', content: '', provider: p });
    const reqId = R().uid();
    ai.streaming = reqId; ai.streamKind = 'chat';
    render();
    // Only send the most recent context-heavy turns to keep requests small
    const history = ai.messages.slice(0, -1).filter(m => !m.error && !m.local).map((m, i, arr) => ({
      role: m.role,
      content: i < arr.length - 1 && m.role === 'user' ? (m.display || m.content) : m.content
    })).filter(m => m.content);
    relay.aiChat({ reqId, provider: p, system: systemPrompt(), messages: history });
  }

  /* ---------- Assist drafts ---------- */
  // Draft a reply to the open email (or to text you selected) with Assist, on this computer
  async function assistDraft({ text = null, refineOf = null, instruction = null, regenerate = false } = {}) {
    if (ai.streaming) return;
    if (!assistOn()) { R().openSettings('ai'); return; }
    let payload, display, ctxLabel = '';
    const toneL = TONES.find(t => t[0] === ai.assist.tone)?.[1] || 'Professional', lenL = LENGTHS.find(l => l[0] === ai.assist.length)?.[1] || 'Medium';
    if (refineOf != null) {
      const prev = ai.messages[refineOf];
      if (!prev?.payload) return;
      payload = { ...prev.payload, regenerate, revisions: regenerate ? prev.payload.revisions : [...(prev.payload.revisions || []), { previous: prev.content, instruction }] };
      display = regenerate ? 'Try again' : instruction.replace(/\.$/, '');
    } else {
      let message = text;
      if (!message) {
        const ctx = await grabContext();
        if (!ctx?.text) { R().toast('Open an email first, or select the text you want to reply to', 'error'); return; }
        message = ctx.selection && ctx.selection.length > 20 ? ctx.selection : ctx.text;
        ctxLabel = ctx.label;
      } else ctxLabel = 'Selected text';
      payload = { type: 'email', tone: ai.assist.tone, length: ai.assist.length, message: message.slice(0, 12000), intent: ai.assist.intent.trim(), subject: false };
      display = `Draft a reply · ${toneL} · ${lenL}${payload.intent ? `\n“${payload.intent}”` : ''}`;
    }
    ai.messages.push({ role: 'user', content: display, display, ctxLabel, local: true });
    ai.messages.push({ role: 'assistant', content: '', provider: 'assist', draft: true, plain: true, payload, progress: 'Connecting to Assist…' });
    const reqId = R().uid();
    ai.streaming = reqId; ai.streamKind = 'assist';
    render();
    relay.assist.draft(reqId, payload);
  }

  relay.assist.onEvent(({ reqId, evt }) => {
    if (reqId !== ai.streaming) return;
    const last = ai.messages[ai.messages.length - 1];
    if (evt.type === 'progress') {
      last.progress = evt.text + (evt.progress ? ` · ${Math.round(evt.progress * 100)}%` : '');
      const node = document.querySelector(`.msg.assistant[data-i="${ai.messages.length - 1}"] .progress-note`);
      if (node) node.lastChild.textContent = ' ' + last.progress; else render();
    } else if (evt.type === 'delta') {
      last.content = evt.text; last.progress = '';
      if (!raf) raf = requestAnimationFrame(() => {
        raf = null;
        const node = document.querySelector(`.msg.assistant[data-i="${ai.messages.length - 1}"] .body`);
        if (node) { node.innerHTML = `<p style="white-space:pre-wrap">${R().esc(last.content)}</p><span class="caret"></span>`; scrollDown(); }
      });
    } else if (evt.type === 'done') {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      // replies don't need the subject line Assist sometimes adds
      last.content = (evt.subject && !last.payload?.subject ? evt.body : evt.text) || last.content;
      ai.streaming = null; ai.assist.checkedAt = 0; render();
    } else if (evt.type === 'error' || evt.type === 'cancelled') {
      ai.streaming = null;
      if (evt.type === 'cancelled' && last.content) { render(); return; }
      if (evt.type === 'cancelled') { ai.messages.splice(-2, 2); render(); return; }
      last.content = evt.message || 'Assist couldn’t write that.'; last.error = true; last.code = evt.code; last.plain = true; last.draft = false;
      ai.assist.checkedAt = 0; render();
    }
  });
  relay.assist.onDraftSelection(async (sel) => {
    const { state } = R();
    if (state.settings.aiProvider !== 'assist') state.settings = await relay.saveSettings({ aiProvider: 'assist' });
    R().toggleAI(true);
    render();
    assistDraft({ text: sel });
  });

  let raf = null;
  relay.onAIStream(({ reqId, type, data }) => {
    if (reqId !== ai.streaming) return;
    const last = ai.messages[ai.messages.length - 1];
    if (type === 'delta') {
      last.content += data;
      if (!raf) raf = requestAnimationFrame(() => {
        raf = null;
        const node = document.querySelector(`.msg.assistant[data-i="${ai.messages.length - 1}"] .body`);
        if (node) { node.innerHTML = md(last.content) + '<span class="caret"></span>'; scrollDown(); }
      });
    } else if (type === 'error') {
      last.content = data; last.error = true; ai.streaming = null; render();
    } else if (type === 'done') {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      ai.streaming = null;
      if (!last.content) ai.messages.pop(), ai.messages.pop();
      render();
    }
  });

  /* ---------- resizable panel ---------- */
  function ensureResizer(el) {
    if (el.__resizer) return;
    el.__resizer = true;
    const saved = +R().state.ui.aiWidth;
    if (saved) document.documentElement.style.setProperty('--ai-w', saved + 'px');
    const h = document.createElement('div'); h.className = 'ai-resize'; h.title = 'Drag to resize';
    el.appendChild(h);
    h.onmousedown = (e) => {
      e.preventDefault();
      document.body.classList.add('split-dragging');
      const mv = (ev) => setWidth(innerWidth - ev.clientX);
      const up = () => { document.body.classList.remove('split-dragging'); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); relay.saveUI({ aiWidth: R().state.ui.aiWidth }); };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    };
  }
  function setWidth(px) {
    const v = Math.round(Math.max(340, Math.min(Math.min(820, innerWidth * 0.6), px)));
    R().state.ui.aiWidth = v;
    document.documentElement.style.setProperty('--ai-w', v + 'px');
  }
  function resize(delta) { const cur = +R().state.ui.aiWidth || parseInt(getComputedStyle(document.documentElement).getPropertyValue('--ai-w')) || 440; setWidth(cur + delta); relay.saveUI({ aiWidth: R().state.ui.aiWidth }); }

  function useSelectionApi(sel) { ai.pendingSelection = `About this:\n"${sel.slice(0, 2000)}"\n\n`; render(); setTimeout(() => { const t = document.getElementById('aiInput'); t?.focus(); t?.setSelectionRange(t.value.length, t.value.length); }, 250); }
  window.AI = {
    render,
    resize,
    contextLabel: () => contextLabel(),
    grabContext: () => grabContext(),
    insertIntoEmail: (t) => insertIntoEmail(t),
    updateContext,
    focus: () => { render(); setTimeout(() => document.getElementById('aiInput')?.focus(), 250); },
    prompt: (text) => { ai.pendingSelection = text; render(); setTimeout(() => document.getElementById('aiInput')?.focus(), 250); },
    useSelection: (sel) => (aiMode() === 'web' && window.AIWeb ? (render(), setTimeout(() => window.AIWeb.type(`About this:\n"${sel.slice(0, 4000)}"\n\n`, false), 700)) : useSelectionApi(sel)),
    _unused: (sel) => { ai.pendingSelection = `About this:\n"${sel.slice(0, 2000)}"\n\n`; render(); setTimeout(() => { const t = document.getElementById('aiInput'); t?.focus(); t?.setSelectionRange(t.value.length, t.value.length); }, 250); }
  };
  document.addEventListener('DOMContentLoaded', () => setTimeout(render, 0));
})();
