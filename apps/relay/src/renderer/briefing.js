/* Relay — Inbox briefing: reads each signed-in inbox and summarizes it with Claude or ChatGPT */
(() => {
  const R = () => window.RelayApp;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => R().esc(s);
  const b = { el: null, running: false, live: {} }; // live: accountId -> { status, data, error }

  // Runs inside each account page. Reads the visible inbox list without changing what you're looking at.
  const SCRAPE = `(async () => {
    const href = location.href, host = location.hostname;
    const out = { url: href, signedIn: true, items: [], unread: null, source: 'list' };
    const txt = (el) => (el ? (el.innerText || el.textContent || '') : '').replace(/\\s+/g, ' ').trim();
    if (/accounts\\.google\\.com|login\\.live\\.com|login\\.microsoftonline\\.com|login\\.yahoo\\.com|\\/signin|\\/login|ServiceLogin/i.test(href) || /^about:/.test(href)) { out.signedIn = false; return out; }
    if (host === 'mail.google.com') {
      try {
        const m = location.pathname.match(/\\/mail\\/u\\/(\\d+)/);
        const r = await fetch('/mail/u/' + (m ? m[1] : '0') + '/feed/atom', { credentials: 'include' });
        if (r.ok) {
          const x = new DOMParser().parseFromString(await r.text(), 'text/xml');
          out.unread = parseInt((x.querySelector('fullcount') || {}).textContent || '0', 10);
          x.querySelectorAll('entry').forEach(e => out.items.push({ from: txt(e.querySelector('author name')), email: txt(e.querySelector('author email')), subject: txt(e.querySelector('title')), snippet: txt(e.querySelector('summary')), date: txt(e.querySelector('issued')), unread: true }));
          out.source = 'feed';
        }
      } catch (e) {}
      document.querySelectorAll('tr.zA').forEach(tr => {
        if (out.items.length >= 40) return;
        const subject = txt(tr.querySelector('.bog'));
        if (!subject || out.items.some(i => i.subject === subject)) return;
        const s = tr.querySelector('.yX [email], .yW [email]');
        out.items.push({ from: (s && s.getAttribute('name')) || txt(tr.querySelector('.yW')), email: (s && s.getAttribute('email')) || '', subject, snippet: txt(tr.querySelector('.y2')).replace(/^-\\s*/, ''), date: (tr.querySelector('.xW span') || { getAttribute: () => '' }).getAttribute('title') || txt(tr.querySelector('.xW')), unread: tr.classList.contains('zE') });
      });
    } else if (/(^|\\.)outlook\\.(live|office|office365)\\.com$/.test(host)) {
      document.querySelectorAll('[role="listbox"] [role="option"], div[data-convid]').forEach(o => {
        if (out.items.length >= 40) return;
        const label = o.getAttribute('aria-label') || txt(o);
        if (label) out.items.push({ raw: label.slice(0, 420), unread: /(^|\\s)unread(\\s|,|$)/i.test(label) });
      });
    } else if (/(^|\\.)mail\\.yahoo\\.com$/.test(host)) {
      document.querySelectorAll('[data-test-id="message-list-item"]').forEach(li => {
        if (out.items.length >= 40) return;
        const q = (s) => txt(li.querySelector(s));
        const subject = q('[data-test-id="message-subject"]');
        const from = q('[data-test-id="senders"]') || q('[data-test-id="senders_list"]');
        const unread = !!li.querySelector('[title="Mark as read"], [aria-label*="Mark as read" i]') || /\\bunread\\b/i.test(li.getAttribute('aria-label') || '');
        if (subject || from) out.items.push({ from, subject, snippet: q('[data-test-id="snippet"]'), date: q('time') || q('[data-test-id="message-date"]'), unread });
        else out.items.push({ raw: txt(li).slice(0, 420) });
      });
    }
    if (!out.items.length) {
      const main = document.querySelector('[role="main"]') || document.body;
      const rows = [...main.querySelectorAll('[role="row"], [role="option"], [role="listitem"], li')].map(txt).filter(t => t.length > 15 && t.length < 500);
      if (rows.length >= 3) out.items = rows.slice(0, 40).map(raw => ({ raw }));
      else out.pageText = txt(main).slice(0, 6000);
      out.source = 'page';
    }
    return out;
  })()`;

  const ACCOUNT_SYSTEM = `You are an executive assistant triaging one email inbox for a busy professional. Be concrete: use real sender names and subjects.
Reply with JSON only (no markdown fences), exactly this shape:
{"headline": "one sentence, max 20 words, what matters in this inbox right now",
 "needsReply": [{"from": "sender", "subject": "subject", "why": "max 14 words", "urgency": "high|medium|low"}],
 "important": ["max 4 items: bills, deadlines, deliveries, security alerts, money, travel — each max 16 words"],
 "canSkip": "one short sentence about newsletters/promos/notifications that can wait",
 "counts": {"needsReply": 0, "promotions": 0}}
Only list messages that genuinely need a response from the user in needsReply (not newsletters, receipts or automated mail). Favor unread messages. Empty arrays are fine.`;

  const OVERALL_SYSTEM = `You combine inbox triage reports from several accounts into one morning briefing.
Reply with JSON only: {"greeting": "one warm, specific sentence (max 28 words) on the overall state of their inboxes", "priorities": [{"text": "imperative action, max 16 words", "account": "account name"}]}
Give 3–5 priorities, most urgent first. If there's nothing urgent, say so kindly and give fewer.`;

  function mailAccounts() { return R().mailAccounts(); }

  async function scrape(a) {
    const entry = await R().ensureWebview(a);
    const wv = entry.wv;
    for (let i = 0; i < 30; i++) {
      try {
        if (!wv.isLoading()) {
          const r = await wv.executeJavaScript(SCRAPE);
          // Give single-page mail apps a moment to fill the list on first load
          if (r.signedIn && !r.items.length && !r.pageText && i < 8) { await sleep(1000); continue; }
          if (r.signedIn && r.source === 'page' && i < 6) { await sleep(1000); continue; }
          return r;
        }
      } catch { /* webview not attached yet */ }
      await sleep(1000);
    }
    throw new Error('This inbox took too long to load');
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function messagesText(r) {
    if (r.items.length) {
      return r.items.slice(0, 40).map(i => i.raw ? `- ${i.unread ? '[UNREAD] ' : ''}${i.raw}` :
        `- ${i.unread ? '[UNREAD] ' : ''}From: ${i.from}${i.email ? ` <${i.email}>` : ''} | Subject: ${i.subject}${i.date ? ` | ${i.date}` : ''}${i.snippet ? ` | Preview: ${i.snippet.slice(0, 220)}` : ''}`).join('\n').slice(0, 11000);
    }
    return `(Could not read a message list. Visible page text:)\n${(r.pageText || '').slice(0, 6000)}`;
  }
  function parseJSON(text) {
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    if (s < 0 || e < 0) throw new Error('The AI reply wasn’t in the expected format');
    return JSON.parse(text.slice(s, e + 1));
  }
  function cleanErr(e) { return String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }

  async function summarize(a, r) {
    const { PLATFORMS } = R();
    const prompt = `Account: ${a.name || ''} <${a.email || a.url || ''}> (${PLATFORMS[a.platform].label})
Today: ${new Date().toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
${r.unread != null ? `Unread in inbox: ${r.unread}\n` : ''}Messages (newest first):
${messagesText(r)}`;
    return parseJSON(await relay.aiComplete({ system: ACCOUNT_SYSTEM, prompt, maxTokens: 1200 }));
  }

  async function run() {
    if (b.running) return;
    const s = R().state;
    const prov = s.settings.aiProvider || 'claude';
    // No API key? Read the inboxes here and hand them to your free Claude/ChatGPT/Gemini/Copilot chat instead
    if (!R().aiReady(prov) || (s.settings.aiMode || 'web') === 'web') return runInChat();
    const accts = mailAccounts();
    if (!accts.length) { R().toast('Add an email account first', 'error'); return; }
    b.running = true;
    b.live = {};
    accts.forEach(a => b.live[a.id] = { status: 'reading' });
    paint();

    const results = {};
    await Promise.all(accts.map(async (a) => {
      try {
        const r = await scrape(a);
        if (!r.signedIn) { results[a.id] = b.live[a.id] = { status: 'signedout' }; paint(); return; }
        b.live[a.id] = { status: 'summarizing', count: r.items.length, unread: r.unread ?? s.unread[a.id] ?? null }; paint();
        const data = await summarize(a, r);
        results[a.id] = b.live[a.id] = { status: 'done', data, count: r.items.length, unread: r.unread ?? s.unread[a.id] ?? null, source: r.source };
      } catch (e) {
        results[a.id] = b.live[a.id] = { status: 'error', error: cleanErr(e) };
      }
      paint();
    }));

    let overall = null;
    const done = accts.filter(a => results[a.id]?.status === 'done');
    if (done.length) {
      b.live.__overall = 'working'; paint();
      try {
        const prompt = done.map(a => `## ${a.name || a.email} (${R().PLATFORMS[a.platform].label})\n${JSON.stringify(results[a.id].data)}`).join('\n\n');
        overall = parseJSON(await relay.aiComplete({ system: OVERALL_SYSTEM, prompt, maxTokens: 600 }));
      } catch (e) { overall = { greeting: '', priorities: [], error: cleanErr(e) }; }
    }
    const briefing = { at: Date.now(), provider: prov, accounts: results, overall };
    s.briefing = briefing;
    await relay.saveBriefing(briefing);
    b.running = false; b.live = {};
    paint();
    window.Home?.renderSidebar(document.getElementById('sidebar'));
  }

  async function runInChat() {
    const accts = mailAccounts();
    if (!accts.length) { R().toast('Add an email account first', 'error'); return; }
    if (b.running) return;
    b.running = true; b.live = {};
    accts.forEach(a => b.live[a.id] = { status: 'reading' }); paint();
    const parts = [];
    await Promise.all(accts.map(async (a) => {
      try {
        const r = await scrape(a);
        if (!r.signedIn) { b.live[a.id] = { status: 'signedout' }; paint(); return; }
        parts.push(`## ${a.name || a.email} (${R().PLATFORMS[a.platform].label})${r.unread != null ? ` — ${r.unread} unread` : ''}\n${messagesText(r).slice(0, 5000)}`);
        b.live[a.id] = { status: 'done', data: { headline: 'Sent to your AI chat', needsReply: [], important: [], canSkip: [] }, count: r.items.length };
      } catch (e) { b.live[a.id] = { status: 'error', error: cleanErr(e) }; }
      paint();
    }));
    b.running = false; b.live = {}; paint();
    if (!parts.length) { R().toast('Couldn’t read any inboxes — make sure you’re signed in', 'error'); return; }
    const site = window.AIWeb?.SITES[R().state.settings.aiWeb || 'claude']?.label || 'your AI chat';
    R().toast(`Sending your inboxes to ${site}…`);
    await window.AIWeb?.briefing(`Here are my email inboxes right now (newest first). Today is ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}.

${parts.join('\n\n')}

Give me an inbox briefing: for each account, what needs a reply (and roughly by when), what's important, and what I can skip. Then finish with my top 3–5 priorities for today. Keep it short and scannable.`);
  }

  /* ---------- UI ---------- */
  function paint() { if (b.el && R().state.ui.platform === 'home' && R().state.ui.homeView === 'briefing') render(b.el); }

  function render(el) {
    b.el = el;
    const s = R().state;
    const br = s.briefing;
    const prov = s.settings.aiProvider || 'claude';
    const provLabel = R().AI_LABEL[prov] || 'Claude';
    const hasKey = R().aiReady(prov);
    const web = (s.settings.aiMode || 'web') === 'web' || !hasKey;
    const webSite = window.AIWeb?.SITES[s.settings.aiWeb || 'claude']?.label || 'Claude';
    const accts = mailAccounts();
    const state = (a) => b.running ? (b.live[a.id] || { status: 'reading' }) : (br?.accounts?.[a.id] || { status: 'none' });
    const overall = b.running ? null : br?.overall;

    el.innerHTML = `<div class="home-scroll">
      <header class="brief-head">
        <div>
          <div class="hero-date">${ic('inbox', 14)} Inbox briefing${br && !b.running ? ` · updated ${new Date(br.at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}</div>
          <h1>${b.running ? 'Reading your inboxes…' : br ? 'Here’s what’s waiting for you' : 'One summary for every inbox'}</h1>
          <p>${web ? `Relay reads the inbox list of each account you’re signed into and hands it to <b>${webSite}</b> in the Assistant panel, using your own free account. Nothing is sent anywhere else.` : `Relay reads the inbox list of each account you’re signed into and asks ${provLabel} what needs your attention. Messages stay on your Mac except for what’s sent to ${provLabel} for the summary.`}</p>
        </div>
        <div class="hero-actions">
          <div class="seg" id="bProv" ${web ? 'hidden' : ''}><button data-p="claude" class="${prov === 'claude' ? 'active' : ''}"><span class="ai-mark claude"></span>Claude</button><button data-p="openai" class="${prov === 'openai' ? 'active' : ''}"><span class="ai-mark gpt"></span>ChatGPT</button><button data-p="assist" class="${prov === 'assist' ? 'active' : ''}" title="Runs on this computer with Assist"><span class="ai-mark assist"></span>Assist</button></div>
          <button class="btn brand" id="bRun" ${b.running ? 'disabled' : ''}>${ic(b.running ? 'refresh' : 'sparkles', 15, b.running ? 'spin-ic' : '')} ${b.running ? 'Working…' : br ? 'Refresh' : 'Run briefing'}</button>
        </div>
      </header>

      ${!hasKey && !web ? `<div class="ai-nokey wide">${ic('key', 18)}<span><b>Connect ${provLabel}</b> — the briefing uses your API key to summarize.</span><button class="btn" id="bKey">Add key</button></div>` : ''}
      ${!accts.length ? `<div class="card-empty tall card">${ic('mail', 22)}<span>Add an email account from the Gmail, Outlook, Yahoo or Other tab to get a briefing.</span></div>` : ''}

      ${overall && (overall.greeting || overall.priorities?.length) ? `
        <section class="card overall-card">
          <div class="oc-glow"></div>
          <div class="card-head"><h3>${ic('sparkles', 17)} Top priorities</h3></div>
          ${overall.greeting ? `<p class="brief-lede">${esc(overall.greeting)}</p>` : ''}
          <ol class="pri-list">${(overall.priorities || []).map((p, i) => `
            <li><span class="pri-n">${i + 1}</span><span class="pri-t">${esc(p.text)}${p.account ? `<em>${esc(p.account)}</em>` : ''}</span>
              <button class="icon-btn sm" data-ptask="${i}" title="Add to tasks">${ic('plus', 15)}</button></li>`).join('')}</ol>
        </section>` : ''}
      ${b.running && b.live.__overall ? `<section class="card overall-card"><div class="card-head"><h3>${ic('sparkles', 17)} Top priorities</h3></div><div class="shimmer"></div><div class="shimmer short"></div></section>` : ''}

      <div class="brief-grid">${accts.map(a => accountCard(a, state(a))).join('')}</div>
    </div>`;

    $$('#bProv button', el).forEach(btn => btn.onclick = async () => { s.settings = await relay.saveSettings({ aiProvider: btn.dataset.p }); render(el); window.AI?.render(); });
    $('#bRun', el).onclick = () => run();
    $('#bKey', el)?.addEventListener('click', () => R().openSettings('ai'));
    $$('[data-ptask]', el).forEach(btn => btn.onclick = async () => {
      const p = overall.priorities[+btn.dataset.ptask];
      const acc = R().state.accounts.find(a => (a.name || a.email) === p.account);
      await window.Home.addTask(p.text, { accountId: acc?.id || null, priority: 2, due: todayKeyLocal() });
      R().toast('Added to tasks');
      btn.innerHTML = ic('check', 15); btn.disabled = true;
    });
    $$('[data-rtask]', el).forEach(btn => btn.onclick = async () => {
      const [aid, i] = btn.dataset.rtask.split('|');
      const item = br.accounts[aid].data.needsReply[+i];
      const pr = { high: 3, medium: 2, low: 1 }[item.urgency] || 2;
      await window.Home.addTask(`Reply to ${item.from}: ${item.subject}`, { accountId: aid, priority: pr, due: item.urgency === 'high' ? todayKeyLocal() : null, notes: item.why ? `Why: ${item.why}` : '', source: { accountId: aid, from: item.from, subject: item.subject } });
      R().toast('Added to tasks');
      btn.innerHTML = ic('check', 14); btn.disabled = true;
    });
    $$('[data-ropen]', el).forEach(btn => btn.onclick = () => {
      const [aid, i] = btn.dataset.ropen.split('|');
      openMessage(aid, br.accounts[aid].data.needsReply[+i]);
    });
    $$('[data-goacct]', el).forEach(btn => btn.onclick = () => { const a = R().accountById(btn.dataset.goacct); R().setPlatform(a.platform); R().selectAccount(a.id); });
  }

  function todayKeyLocal() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

  function openMessage(aid, item) {
    const a = R().accountById(aid);
    if (!a) return;
    R().setPlatform(a.platform); R().selectAccount(a.id);
    const e = R().webviews.get(a.id);
    if (e && a.platform === 'gmail' && item?.subject) {
      const url = e.wv.getURL();
      const base = (url.match(/https:\/\/mail\.google\.com\/mail\/u\/\d+\//) || ['https://mail.google.com/mail/u/0/'])[0];
      e.wv.loadURL(base + '#search/' + encodeURIComponent(`subject:"${item.subject.slice(0, 80)}"`));
    }
  }

  function accountCard(a, st) {
    const { PLATFORMS } = R();
    const head = `<div class="ac-head">
        ${R().avatarHTML(a)}
        <div class="ac-meta"><div class="ac-name">${esc(a.name || a.email)}</div><div class="ac-sub">${PLATFORMS[a.platform].label}${a.email ? ' · ' + esc(a.email) : ''}</div></div>
        ${st.unread ? `<span class="badge" style="--c:${esc(a.color)}">${st.unread} unread</span>` : ''}
        <button class="icon-btn sm" data-goacct="${a.id}" title="Open inbox">${ic('external', 15)}</button>
      </div>`;
    let body = '';
    if (st.status === 'reading' || st.status === 'summarizing') {
      body = `<div class="ac-status">${ic('refresh', 15, 'spin-ic')} ${st.status === 'reading' ? 'Reading inbox…' : `Summarizing ${st.count || ''} messages…`}</div><div class="shimmer"></div><div class="shimmer short"></div>`;
    } else if (st.status === 'signedout') {
      body = `<div class="ac-empty">${ic('key', 18)}<span>Not signed in yet.</span><button class="btn" data-goacct="${a.id}">Sign in</button></div>`;
    } else if (st.status === 'error') {
      body = `<div class="ac-empty err">${ic('alert', 18)}<span>${esc(st.error)}</span></div>`;
    } else if (st.status === 'done') {
      const d = st.data || {};
      const nr = d.needsReply || [];
      body = `
        <p class="ac-headline">${esc(d.headline || '')}</p>
        ${nr.length ? `<div class="ac-label">Needs a reply <span class="pill">${nr.length}</span></div>
          <div class="reply-list">${nr.slice(0, 6).map((it, i) => `
            <div class="reply u-${esc(it.urgency || 'medium')}">
              <span class="urg"></span>
              <div class="r-main"><div class="r-top"><b>${esc(it.from)}</b><span>${esc(it.subject)}</span></div>${it.why ? `<div class="r-why">${esc(it.why)}</div>` : ''}</div>
              <button class="icon-btn sm" data-rtask="${a.id}|${i}" title="Add to tasks">${ic('plus', 14)}</button>
              <button class="icon-btn sm" data-ropen="${a.id}|${i}" title="Open">${ic('arrowRight', 14)}</button>
            </div>`).join('')}</div>` : `<div class="ac-clear">${ic('checkCircle', 15)} Nothing waiting on a reply</div>`}
        ${(d.important || []).length ? `<div class="ac-label">Worth knowing</div><ul class="ac-list">${d.important.slice(0, 4).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${d.canSkip ? `<div class="ac-skip">${ic('inbox', 13)} ${esc(d.canSkip)}</div>` : ''}
        <div class="ac-foot">Read ${st.count || 0} message${st.count === 1 ? '' : 's'}</div>`;
    } else {
      body = `<div class="ac-empty">${ic('sparkles', 18)}<span>Run the briefing to summarize this inbox.</span></div>`;
    }
    return `<section class="card acct-card" style="--c:${esc(a.color)}">${head}${body}</section>`;
  }

  window.Briefing = { render, run, contextText: () => {
    const br = R().state.briefing;
    if (!br) return '';
    const lines = [];
    if (br.overall?.greeting) lines.push(br.overall.greeting);
    (br.overall?.priorities || []).forEach(p => lines.push(`- Priority: ${p.text} (${p.account})`));
    Object.entries(br.accounts || {}).forEach(([id, r]) => {
      const a = R().accountById(id);
      if (!a || r.status !== 'done') return;
      lines.push(`\n${a.name || a.email}: ${r.data.headline || ''}`);
      (r.data.needsReply || []).forEach(x => lines.push(`  - Needs reply: ${x.from} — ${x.subject} (${x.urgency})`));
    });
    return lines.join('\n');
  } };
})();
