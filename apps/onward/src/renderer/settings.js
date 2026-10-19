/* Onward — Connect AI (Claude, ChatGPT via Codex, in-app AI) + settings */
(() => {
  const A = window.App;
  const { $, $$, esc } = A;
  const root = () => $('#view-settings');

  function init() {
    root().innerHTML = `<div class="topbar drag"><h1>Connect AI</h1></div><div class="scroll"><div class="page"><div class="cols" id="sCols"></div></div></div>`;
  }

  function render() {
    const c = A.state.claude || {};
    const s = A.state.settings;
    const ai = s.ai || {};
    const el = $('#sCols');
    if (!el) return;
    const name = A.clientName(c);
    el.innerHTML = `
      <div>
        <div class="panel">
          <h2>${icon('plug')}Your AI, plugged into Onward</h2>
          <p class="lead">Connect an assistant you already pay for. It gets Onward’s tools — Discover search, your profile, the job board, tailored resumes, people & messages, the browser and the Apply Guide’s autofill — using your own account, no API key.
            ${c.connected ? `<br><span class="pill-ok">${icon('check')}${esc(name)} is connected right now</span>` : ''}</p>
          <div class="conn">
            <div class="conn-card ${c.configured ? 'on' : ''}">
              <div class="conn-top"><div class="conn-logo claude">C</div><div><b>Claude</b><span>Claude desktop app</span></div>${c.configured ? `<span class="pill-ok">${icon('check')}Added</span>` : ''}</div>
              <p>${c.claudeInstalled ? `One click adds Onward to Claude. Then quit Claude ${A.state.platform === 'darwin' ? '(⌘Q)' : 'fully (right-click its tray icon → Quit)'} and reopen it.` : 'Install the Claude desktop app first (claude.ai/download).'}</p>
              <button class="btn ${c.configured ? '' : 'primary'}" id="sConnect">${c.configured ? 'Re-add' : 'Add to Claude'}</button>
              <details><summary>Using Claude Code instead?</summary><div class="code"><span>${esc(c.codeCmd || '')}</span><button class="btn sm ghost" data-copy="${esc(c.codeCmd || '')}">${icon('copy')}</button></div></details>
            </div>
            <div class="conn-card ${c.codexConfigured ? 'on' : ''}">
              <div class="conn-top"><div class="conn-logo gpt">G</div><div><b>ChatGPT · Codex</b><span>Codex in the ChatGPT app, Codex app, CLI or IDE</span></div>${c.codexConfigured ? `<span class="pill-ok">${icon('check')}Added</span>` : ''}</div>
              <p>Codex signs in with your ChatGPT plan and can use local tools like Onward. One click adds Onward to Codex’s settings — restart Codex afterwards. <span class="hint">(Regular ChatGPT chats can’t use apps on your computer yet — use Codex, or the in-app panel below.)</span></p>
              <button class="btn ${c.codexConfigured ? '' : 'primary'}" id="sCodex">${c.codexConfigured ? 'Re-add' : 'Add to Codex'}</button>
              <details><summary>Prefer the terminal?</summary><div class="code"><span>${esc(c.codexCmd || '')}</span><button class="btn sm ghost" data-copy="${esc(c.codexCmd || '')}">${icon('copy')}</button></div></details>
            </div>
          </div>
          <h4 class="sub-h">Try asking</h4>
          <div class="prompts" style="margin-top:0">${[
            'Read my Onward profile and tell me what’s missing before I start applying',
            `Search Onward for ${(A.state.profile?.targetRoles || [])[0] ? A.state.profile.targetRoles[0] + ' jobs' : 'jobs that fit my profile'}${(A.state.profile?.targetLocations || [])[0] || A.state.profile?.city ? ' in ' + ((A.state.profile.targetLocations || [])[0] || A.state.profile.city) : ''} from the past week and save the 5 best fits with an honest fit score`,
            'For the newest job on my Onward board: tailor my resume, then draft a short LinkedIn message to the hiring contact'
          ].map(t => `<div class="prompt">${icon('spark')}<span>${esc(t)}</span><button class="btn sm ghost" data-copy="${esc(t)}">${icon('copy')}</button></div>`).join('')}</div>
        </div>

        <div class="panel">
          <h2>${icon('spark')}AI inside Onward</h2>
          <p class="lead">Powers the <b>Tailor resume</b>, <b>Cover letter</b>, <b>Check fit</b>, <b>Write with AI</b> and <b>Draft</b> buttons, and the side panel (⌘J). Pick what spends the tokens.</p>
          <div class="engine">
            <label class="eng ${ai.engine === 'web' ? 'on' : ''}"><input type="radio" name="eng" value="web" ${ai.engine === 'web' ? 'checked' : ''}><div><b>Your chat account (free)</b><span>ChatGPT, Claude or Gemini, signed in inside the panel. Onward pastes the job in and reads the answer back. Uses your plan’s messages, no API cost.</span>
              <div class="seg" style="margin-top:8px">${[['chatgpt', 'ChatGPT'], ['claude', 'Claude'], ['gemini', 'Gemini']].map(([k, l]) => `<button data-site="${k}" class="${(ai.site || 'chatgpt') === k ? 'active' : ''}">${l}</button>`).join('')}</div></div></label>
            <label class="eng ${ai.engine === 'openai' ? 'on' : ''}"><input type="radio" name="eng" value="openai" ${ai.engine === 'openai' ? 'checked' : ''}><div><b>OpenAI API key</b><span>Fast and reliable; pay per use (small models cost cents per resume).</span>
              <div class="keyrow"><input class="input" id="kOpenai" type="password" placeholder="${ai.hasOpenaiKey ? '•••••••• saved — paste to replace' : 'sk-…'}"><input class="input" id="mOpenai" value="${esc(ai.openaiModel || 'gpt-5-mini')}" title="Model"><button class="btn sm" data-key="openai">Save</button></div></div></label>
            <label class="eng ${ai.engine === 'anthropic' ? 'on' : ''}"><input type="radio" name="eng" value="anthropic" ${ai.engine === 'anthropic' ? 'checked' : ''}><div><b>Anthropic API key</b><span>Claude via API; pay per use.</span>
              <div class="keyrow"><input class="input" id="kAnthropic" type="password" placeholder="${ai.hasAnthropicKey ? '•••••••• saved — paste to replace' : 'sk-ant-…'}"><input class="input" id="mAnthropic" value="${esc(ai.anthropicModel || 'claude-haiku-5-5')}" title="Model"><button class="btn sm" data-key="anthropic">Save</button></div></div></label>
          </div>
          <p class="hint" style="margin-top:10px">Keys are encrypted with your Mac’s keychain and only sent to that provider.</p>
        </div>
      </div>
      <div>
        <div class="panel">
          <h2>${icon('check')}Ground rules</h2>
          <ul class="rules" style="margin-top:12px">
            <li><b>You press the final Submit.</b> Onward and your AI fill things in and highlight the button; when you press it, Onward records the application and the answers you gave.</li>
            <li><b>You send every message.</b> Drafts open in your mail app, Gmail, Outlook or LinkedIn for you to check and send.</li>
            <li>No one types your passwords. You sign in to sites yourself in the Browser; those sign-ins stay inside Onward.</li>
            <li>Tailored resumes only reword and reorder what’s true in your resume and credentials.</li>
            <li>Profile, resumes and applications stay on this computer in your Onward Files folder.</li>
          </ul>
        </div>
        <div class="panel">
          <h2>${icon('letter')}Email</h2>
          <p class="lead">When you send a message to a recruiter by email, open it in:</p>
          <div class="seg" id="sMail">${[['mailapp', 'Mail app'], ['gmail', 'Gmail (in Onward)'], ['outlook', 'Outlook (in Onward)']].map(([k, l]) => `<button data-v="${k}" class="${(s.emailVia || 'mailapp') === k ? 'active' : ''}">${l}</button>`).join('')}</div>
        </div>
        <div class="panel">
          <h2>${icon('folder')}Files</h2>
          <p class="lead">Base resume, credentials, and a folder per application with its tailored resume, cover letter and answers.</p>
          <div class="code"><span>${esc(A.state.filesRoot)}</span></div>
          <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="sOpenFiles">${icon('folder')}Open</button><button class="btn ghost" id="sMoveFiles">Change location</button></div>
          <h4 style="margin:18px 0 8px;font-size:13px">Resume paper size</h4>
          <div class="seg" id="sPaper"><button data-v="letter" class="${s.pageLetter !== false ? 'active' : ''}">US Letter</button><button data-v="a4" class="${s.pageLetter === false ? 'active' : ''}">A4</button></div>
        </div>
        <div class="panel">
          <h2>${icon('globe')}Browser</h2>
          <p class="lead">Sign out of every site in Onward’s browser and clear its data.</p>
          <button class="btn danger" id="sClear">Sign out everywhere</button>
        </div>
      </div>`;
    const err = (e) => A.toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 6000);
    $('#sConnect').onclick = async () => { try { A.state.claude = await onward.claude.connect(); A.toast('Added — now restart Claude'); render(); A.renderClaude(); } catch (e) { err(e); } };
    $('#sCodex').onclick = async () => { try { A.state.claude = await onward.claude.connectCodex(); A.toast('Added — now restart Codex'); render(); A.renderClaude(); } catch (e) { err(e); } };
    $$('[data-copy]', el).forEach(b => b.onclick = (e) => { e.preventDefault(); onward.claude.copy(b.dataset.copy); A.toast('Copied'); });
    const saveAi = async (patch) => { A.state.settings = await onward.saveSettings({ ai: patch }); render(); A.AI.render(); };
    $$('input[name=eng]', el).forEach(r => r.onchange = () => saveAi({ engine: r.value }));
    $$('[data-site]', el).forEach(b => b.onclick = (e) => { e.preventDefault(); saveAi({ site: b.dataset.site, engine: 'web' }); });
    $$('[data-key]', el).forEach(b => b.onclick = async (e) => {
      e.preventDefault();
      const p = b.dataset.key;
      const key = $(p === 'openai' ? '#kOpenai' : '#kAnthropic').value.trim();
      const model = $(p === 'openai' ? '#mOpenai' : '#mAnthropic').value.trim();
      if (key) await onward.ai.setKey(p, key);
      await saveAi({ engine: p, [p === 'openai' ? 'openaiModel' : 'anthropicModel']: model });
      A.toast(key ? 'Key saved' : 'Saved');
    });
    $$('#sMail [data-v]', el).forEach(b => b.onclick = async () => { A.state.settings = await onward.saveSettings({ emailVia: b.dataset.v }); render(); });
    $('#sOpenFiles').onclick = () => onward.openFolder('root');
    $('#sMoveFiles').onclick = async () => { const st = await onward.chooseFolder(); if (st) { A.state = st; render(); A.toast('New files go to the new folder'); } };
    $$('#sPaper button').forEach(b => b.onclick = async () => { A.state.settings = await onward.saveSettings({ pageLetter: b.dataset.v === 'letter' }); render(); });
    $('#sClear').onclick = () => A.modal(`<h2>Sign out everywhere?</h2><p style="color:var(--text-2)">You'll need to sign in to LinkedIn, Indeed and other sites again inside Onward.</p><div class="foot"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Sign out</button></div>`, (m, close) => {
      $('[data-x]', m).onclick = close;
      $('[data-ok]', m).onclick = async () => { await onward.browser.clearData(); close(); A.toast('Signed out of all sites'); };
    });
  }

  async function show() { A.state.claude = { ...A.state.claude, ...(await onward.claude.status()) }; render(); }

  A.views.settings = { init, render, show };
})();
