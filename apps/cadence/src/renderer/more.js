// Cadence — Templates, Connections (Claude/Codex plugin, AI for steps, browser sign-ins, secrets) and Settings.
'use strict';

VIEWS.templates = {
  title: 'Templates',
  render(view) {
    const t = S.cat.templates;
    view.innerHTML = `<div class="describe-bar"><span class="db-ic">${icon('sparkle', 18)}</span><input class="db-input" id="dbText" placeholder="Describe an automation and Claude or Codex will draft it…" spellcheck="false"><button class="btn primary" id="dbGo">${icon('wand', 14)}Draft it</button></div>
      <div class="section-title">Start from one of these</div>
      <div class="tpl-grid">${t.map((x) => `<div class="tpl a-${x.color}" data-id="${x.id}">
        <div class="tpl-top">${tile(x.icon, x.color, 'lg')}<div class="grow"><b>${esc(x.name)}</b><span class="muted small">${esc(x.when)}</span></div></div>
        <p>${esc(x.blurb)}</p>
        <div class="tpl-steps">${x.steps.map((s) => `<span title="${esc(stepMeta(s).label)}">${tile(stepMeta(s).icon, stepMeta(s).color, 'sm')}</span>`).join('<i></i>') || '<span class="muted small">No steps yet</span>'}</div>
        <button class="btn ${x.id === 'weekly-report' ? 'primary' : ''}" data-use="${x.id}">Use this</button>
      </div>`).join('')}</div>`;
    $$('[data-use]', view).forEach((b) => b.onclick = async () => { try { const f = await call('flows:fromTemplate', b.dataset.use); await loadFlows(); go('editor', f.id); toast('Added — switched off for now', 'Change the site, columns and folders to yours, test it, then switch it on.', 'info', 7000); } catch (e) { fail(e); } });
    const goDraft = () => { describeSheet(); setTimeout(() => { const t2 = $('#dsText'); if (t2) t2.value = $('#dbText') ? $('#dbText').value : ''; }, 20); };
    $('#dbGo').onclick = goDraft; $('#dbText').onkeydown = (e) => { if (e.key === 'Enter') goDraft(); };
  },
};

VIEWS.connections = {
  title: 'Connections',
  render(view) {
    view.innerHTML = '<div class="empty"><span class="spin"></span></div>';
    Promise.all([call('connectors:status'), call('ai:status'), call('profiles:list'), call('secrets:list')]).then(([cs, ai, profiles, sec]) => {
      S.ai = ai; S.profiles = profiles; S.secrets = sec.list; S.conn = cs;
      if (S.view !== 'connections') return;
      const b = cs.bridge;
      const live = b.connected ? `<span class="pill ok"><span class="dot on" style="width:6px;height:6px;box-shadow:none"></span>${esc(b.client || 'An assistant')} is connected</span>` : '';
      const card = (key, name, sub, st, btn, note) => `<div class="conn ${st.added ? 'on' : ''}">
        <div class="conn-top"><span class="conn-logo ${key}">${key === 'codex' ? icon('terminal', 18) : icon('sparkle', 18)}</span><div class="grow"><b>${name}</b><span>${sub}</span></div>${st.added ? `<span class="pill ok">${icon('check', 12)}${st.current ? 'Added' : 'Added (old path)'}</span>` : ''}</div>
        <p>${note}</p>
        <div class="row"><button class="btn ${st.added && st.current ? '' : 'primary'} sm" data-conn="${key}" ${st.installed === false && key !== 'desktop' ? 'disabled' : ''}>${st.added ? 'Add again' : btn}</button>${st.cmd ? `<button class="link-btn" data-copy="${esc(st.cmd)}">${icon('copy', 13)}Copy terminal command</button>` : ''}</div>
      </div>`;
      view.innerHTML = `
        <div class="section-title">Claude &amp; Codex plugin ${live}</div>
        <p class="lead">Let Claude or Codex build, edit, test and run your automations. Ask things like “make me a Monday report from our analytics site”, “why did last night’s run fail?”, or “add a slide with spend by channel”.</p>
        <div class="conn-grid">
          ${card('desktop', 'Claude app', 'Claude for Mac and Windows', cs.desktop, 'Add to Claude', 'Restart the Claude app afterwards. Cadence shows up under its tools.')}
          ${card('code', 'Claude Code', cs.code.installed ? `Found ${esc(cs.code.version || '')}` : 'Not found on this computer', cs.code, 'Add to Claude Code', 'Added for every project (user scope). Works in the terminal, the desktop app and IDEs.')}
          ${card('codex', 'Codex', cs.codex.version ? `Found ${esc(cs.codex.version)}` : cs.codex.installed ? 'Settings folder found' : 'Not found on this computer', cs.codex, 'Add to Codex', 'Writes Cadence into ~/.codex/config.toml (a backup is kept). Restart Codex afterwards.')}
        </div>

        <div class="section-title">AI inside automations</div>
        <p class="lead">“Ask AI” and “AI agent task” steps use what’s here, in this order unless a step picks one.</p>
        <div class="rows">
          ${aiRow('Claude Code', ai.claude ? `Signed-in CLI at ${esc(tildify(ai.claude.path))}` : 'Install Claude Code and sign in once in the terminal', !!ai.claude, ai.claude ? '' : '<a class="link-btn" data-ext="https://docs.claude.com/en/docs/claude-code/setup">How to install</a>')}
          ${aiRow('Codex', ai.codex ? `Signed-in CLI at ${esc(tildify(ai.codex.path))}` : 'Install the Codex CLI and sign in with ChatGPT', !!ai.codex, ai.codex ? '' : '<a class="link-btn" data-ext="https://developers.openai.com/codex/cli">How to install</a>')}
          ${aiRow('Anthropic API key', ai.anthropic ? 'Saved in Secrets' : 'Optional — pay-as-you-go instead of a Claude plan', ai.anthropic, `<button class="btn sm" data-key="ANTHROPIC_API_KEY">${ai.anthropic ? 'Replace' : 'Add key'}</button>`)}
          ${aiRow('OpenAI API key', ai.openai ? 'Saved in Secrets' : 'Optional', ai.openai, `<button class="btn sm" data-key="OPENAI_API_KEY">${ai.openai ? 'Replace' : 'Add key'}</button>`)}
        </div>

        <div class="section-title">Browser sign-ins<button class="link-btn" id="addProfile" style="margin-left:auto">${icon('plus', 13)}New profile</button></div>
        <p class="lead">Browser steps use a profile to stay signed in. Sign in once here; scheduled runs reuse it. If a site signs you out, sign in again.</p>
        <div class="rows">${profiles.map((p) => `<div class="row-item"><span class="ri-ic">${icon('user', 16)}</span><div class="grow"><b>${esc(p.name)}</b><span class="muted small">${p.signedInAt ? `Signed in ${esc(ago(p.signedInAt))}${p.site ? ' · ' + esc(p.site) : ''}` : 'Not signed in yet'} · used as “${esc(p.id)}”</span></div><button class="btn sm" data-sign="${p.id}">${icon('globe', 14)}Sign in</button><button class="icon-btn sm" data-pmenu="${p.id}">${icon('more', 16)}</button></div>`).join('')}</div>

        <div class="section-title">Secrets<button class="link-btn" id="addSecret" style="margin-left:auto">${icon('plus', 13)}Add secret</button></div>
        <p class="lead">Passwords, tokens and webhook links for your steps. Use them as {{secrets.NAME}}. ${sec.encrypted ? 'Stored encrypted with this computer’s keychain' : 'This computer has no keychain available, so secrets are stored unencrypted in the app-data folder'} — they never appear in logs, and Claude/Codex only see the names.</p>
        <div class="rows">${sec.list.length ? sec.list.map((x) => `<div class="row-item"><span class="ri-ic">${icon('key', 16)}</span><div class="grow"><b class="mono">${esc(x.name)}</b><span class="muted small">Saved ${esc(ago(x.at))}</span></div><button class="btn sm" data-sreplace="${esc(x.name)}">Replace</button><button class="icon-btn sm" data-sdel="${esc(x.name)}" title="Remove">${icon('trash', 15)}</button></div>`).join('') : '<div class="muted small" style="padding:12px 14px">No secrets yet.</div>'}</div>`;
      hydrateIcons(view);
      $$('[data-conn]', view).forEach((b) => b.onclick = async () => { b.disabled = true; try { await call('connectors:' + b.dataset.conn); toast('Added', b.dataset.conn === 'code' ? 'Start a new Claude Code session to use it.' : `Restart ${b.dataset.conn === 'desktop' ? 'the Claude app' : 'Codex'} to use it.`); render(); } catch (e) { b.disabled = false; fail(e); } });
      $$('[data-copy]', view).forEach((b) => b.onclick = () => { call('clipboard:write', b.dataset.copy); toast('Copied'); });
      $$('[data-ext]', view).forEach((b) => b.onclick = () => openPath(b.dataset.ext));
      $$('[data-key]', view).forEach((b) => b.onclick = async () => { const v = await promptBox({ title: b.dataset.key === 'ANTHROPIC_API_KEY' ? 'Anthropic API key' : 'OpenAI API key', text: 'Saved as a secret on this computer.', label: 'Key', fields: [{ key: 'v', label: 'Key', type: 'password', placeholder: 'sk-…' }] }); if (v && v.v) { await call('secrets:set', b.dataset.key, v.v.trim()); render(); } });
      $$('[data-sign]', view).forEach((b) => b.onclick = async () => { const p = profiles.find((x) => x.id === b.dataset.sign); const url = await promptBox({ title: `Sign in — ${p.name}`, text: 'A window opens on this site. Sign in as usual (including any two-step check), then close the window.', label: 'Site', value: p.site || 'https://', placeholder: 'https://analytics.example.com' }); if (!url) return; try { await call('profiles:signIn', p.id, url); toast('Signed in', `Profile “${p.name}” is ready`); render(); } catch (e) { fail(e); } });
      $$('[data-pmenu]', view).forEach((b) => b.onclick = () => { const id = b.dataset.pmenu; menu(b, [{ label: 'Sign out everywhere (clear cookies)', icon: 'refresh', run: async () => { await call('profiles:clear', id); toast('Signed out'); render(); } }, ...(id === 'default' ? [] : [{ label: 'Remove profile', icon: 'trash', danger: true, run: async () => { if (await confirmBox({ title: 'Remove this profile?', text: 'Its sign-ins are cleared. Browser steps that use it will need a new profile.', ok: 'Remove', danger: true })) { await call('profiles:remove', id); render(); } } }])], { align: 'right', width: 280 }); });
      $('#addProfile').onclick = async () => { const n = await promptBox({ title: 'New browser profile', text: 'One profile per account, e.g. “work” or “client-acme”.', label: 'Name', placeholder: 'work' }); if (n) { await call('profiles:add', n); render(); } };
      const addSecret = async (name) => { const v = await promptBox({ title: name ? `Replace ${name}` : 'Add a secret', fields: [{ key: 'name', label: 'Name', value: name || '', placeholder: 'REPORT_PASSWORD' }, { key: 'value', label: 'Value', type: 'password' }] }); if (v && v.name && v.value) { try { await call('secrets:set', v.name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'), v.value); render(); } catch (e) { fail(e); } } };
      $('#addSecret').onclick = () => addSecret();
      $$('[data-sreplace]', view).forEach((b) => b.onclick = () => addSecret(b.dataset.sreplace));
      $$('[data-sdel]', view).forEach((b) => b.onclick = async () => { if (await confirmBox({ title: `Remove ${b.dataset.sdel}?`, text: 'Steps that use it will stop working until you add it again.', ok: 'Remove', danger: true })) { await call('secrets:remove', b.dataset.sdel); render(); } });
    }).catch(fail);
  },
};
function aiRow(name, sub, ok, extra) { return `<div class="row-item"><span class="dot ${ok ? 'on' : ''}"></span><div class="grow"><b>${esc(name)}</b><span class="muted small">${sub}</span></div>${extra || ''}</div>`; }

VIEWS.settings = {
  title: 'Settings',
  render(view) {
    const s = S.settings;
    const seg = (key, opts) => `<div class="seg" data-set="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(s[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const sw = (key) => `<button class="switch ${s[key] ? 'on' : ''}" data-sw="${key}"></button>`;
    view.innerHTML = `<div class="settings">
      <div class="set-group"><div class="set-title">Running in the background</div>
        <div class="set-row"><div class="grow"><b>Keep running when the window is closed</b><span>Schedules and folder watches only work while Cadence is running. It lives in the ${S.info.platform === 'darwin' ? 'menu bar' : 'system tray'}.</span></div>${sw('background')}</div>
        <div class="set-row"><div class="grow"><b>Open at login</b><span>Starts quietly in the background so Monday’s report still runs after a restart.</span></div>${sw('openAtLogin')}</div>
        <div class="set-row"><div class="grow"><b>Tell me when a run finishes</b><span>Notifications when the window isn’t in front.</span></div>${seg('notify', [['all', 'Always'], ['failures', 'Only problems'], ['none', 'Never']])}</div>
      </div>
      <div class="set-group"><div class="set-title">Dates and folders</div>
        <div class="set-row"><div class="grow"><b>Weeks start on</b><span>Used by {{week.label}}, {{week.range}} and the other week values. Right now: ${esc(S.info.dates.week.label)} (${esc(S.info.dates.week.range)}).</span></div>${seg('weekStart', [[1, 'Monday'], [0, 'Sunday']])}</div>
        <div class="set-row"><div class="grow"><b>Default folder for automations</b><span>${esc(tildify(s.outputRoot || S.info.documents + (S.info.platform === 'win32' ? '\\' : '/') + 'Cadence'))} — each automation gets a folder inside.</span></div><button class="btn sm" id="setOut">${icon('folder', 14)}Change</button>${s.outputRoot ? '<button class="link-btn" id="setOutReset">Reset</button>' : ''}</div>
        <div class="set-row"><div class="grow"><b>Keep each run’s scratch files for</b><span>Downloads that weren’t saved anywhere, AI attachments and so on.</span></div><select class="select" id="setKeep" style="width:130px">${[3, 7, 14, 30, 90].map((d) => `<option value="${d}" ${+s.keepRunDays === d ? 'selected' : ''}>${d} days</option>`).join('')}</select></div>
      </div>
      <div class="set-group"><div class="set-title">Look</div>
        <div class="set-row"><div class="grow"><b>Appearance</b></div>${seg('theme', [['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']])}</div>
        <div class="set-row"><div class="grow"><b>AI for “Describe it”</b><span>Which assistant drafts automations.</span></div><select class="select" id="setAi" style="width:200px">${S.cat.providers.map((p) => `<option value="${p.value}" ${s.aiProvider === p.value ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></div>
      </div>
      <div class="set-group"><div class="set-title">About</div>
        <div class="set-row"><div class="grow"><b>Cadence ${esc(S.info.version)}</b><span>Part of the Utility Suite. Data folder: ${esc(tildify(S.info.userData))}</span></div><button class="btn sm" id="setData">${icon('reveal', 14)}Show</button></div>
      </div></div>`;
    const save = async (patch) => { S.settings = await call('settings:set', patch); applyThemeNow(); renderNext(); render(); };
    $$('[data-set]', view).forEach((g) => $$('button', g).forEach((b) => b.onclick = () => save({ [g.dataset.set]: /^\d+$/.test(b.dataset.v) ? Number(b.dataset.v) : b.dataset.v })));
    $$('[data-sw]', view).forEach((b) => b.onclick = () => save({ [b.dataset.sw]: !s[b.dataset.sw] }));
    $('#setOut').onclick = async () => { const p = await call('dialog:folder', s.outputRoot || null); if (p) save({ outputRoot: p }); };
    const r = $('#setOutReset'); if (r) r.onclick = () => save({ outputRoot: '' });
    $('#setKeep').onchange = (e) => save({ keepRunDays: Number(e.target.value) });
    $('#setAi').onchange = (e) => save({ aiProvider: e.target.value });
    $('#setData').onclick = () => openPath(S.info.userData);
  },
};
