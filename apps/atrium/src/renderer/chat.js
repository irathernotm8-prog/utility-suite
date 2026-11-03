// Atrium — the AI tab: pick Claude Code, Codex, or a model with your own key (Claude, GPT, Gemini, OpenRouter, a
// local model…), talk about the site, and watch it work: tool steps, screenshots it took, and the live preview.
'use strict';
const CLI = [{ id: 'claude-code', name: 'Claude Code · your subscription' }, { id: 'codex', name: 'Codex · your ChatGPT plan' }];
const TOOL_LABEL = { site_context: 'Looking at the site', atrium_guide: 'Reading the guide', get_page: 'Reading a page', add_section: 'Adding a section', update_section: 'Rewriting a section', edit_text: 'Editing text', set_theme: 'Changing the theme', screenshot: 'Taking a screenshot', audit: 'Checking quality', add_page: 'Adding a page', write_post: 'Writing a post', search_photos: 'Finding photos', add_asset: 'Adding an image', fetch_url: 'Reading a web page', update_settings: 'Updating settings', export: 'Exporting', publish: 'Publishing', create_site: 'Creating a site', list_sections: 'Browsing the library', get_section_template: 'Reading a library section', move_section: 'Moving a section', delete_section: 'Deleting a section', update_page: 'Editing a page' };

function providerOptions() { const L = S.lib.providers; const cur = S.settings.aiProvider; return [...CLI, ...L].map((p) => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}${!CLI.some((c) => c.id === p.id) && !p.noKey && !(S.settings.hasKey || {})[p.id] ? ' — add a key' : ''}</option>`).join(''); }
function renderChat(host) {
  host.innerHTML = `<div class="chat"><div class="chat-top"><select class="select sm" id="provSel" title="Which AI">${providerOptions()}</select><button class="icon-btn sm" id="chatMore" title="More">${icon('more', 16)}</button></div>
    <div class="chat-log" id="chatLog"></div>
    <div class="chat-input"><div id="chatCtx"></div><textarea class="input" id="chatText" placeholder="Describe what you want — a whole site, a page, or a change to this section…"></textarea>
      <div class="row"><span class="tiny muted" id="chatHint">⏎ to send · ⇧⏎ new line</span><div class="row"><button class="btn sm" id="chatStop" hidden>Stop</button><button class="btn sm primary" id="chatSend">${icon('send', 14)} Send</button></div></div></div></div>`;
  $('#provSel').onchange = async (e) => { S.settings = await call('settings:set', { aiProvider: e.target.value }); const p = S.lib.providers.find((x) => x.id === e.target.value); if (p && !p.noKey && !(S.settings.hasKey || {})[p.id]) { toast('Add your key', `${p.name} needs an API key — Settings › AI.`, 'info'); } };
  $('#chatMore').onclick = (e) => menu(e.currentTarget, [{ text: 'AI settings & keys…', icon: 'key', run: () => { showView('prefs'); } }, { text: 'Connect Claude / Codex apps…', icon: 'plug', run: () => showView('prefs') }, '-', { text: 'Clear this conversation', icon: 'trash', run: async () => { await call('chat:clear'); loadChat(); } }], { right: true });
  const ta = $('#chatText');
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const v = ta.value.trim(); if (v) sendChat(v); } };
  ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(220, ta.scrollHeight) + 'px'; };
  $('#chatSend').onclick = () => { const v = ta.value.trim(); if (v) sendChat(v); };
  $('#chatStop').onclick = () => call('chat:stop');
  hydrateIcons(host); loadChat(); updateChatContext(); setBusy(S.aiBusy);
}
function updateChatContext() {
  const box = $('#chatCtx'); if (!box) return; const f = S.sel && findSec(S.sel.id);
  box.innerHTML = f ? `<span class="ctx-chip">${icon('cursor', 12)} <span>About</span> <b>${esc(f.sec.name)}</b><button class="icon-btn xs" id="ctxClear" title="Not about this section">${icon('x', 12)}</button></span>` : `<span class="ctx-chip">${icon('pages', 12)} <span>On</span> <b>${esc(curPage() ? curPage().title : '')}</b></span>`;
  const c = $('#ctxClear'); if (c) c.onclick = () => { S.sel = null; toFrame({ type: 'select', id: null }); reportSel(); updateChatContext(); };
}
async function loadChat() {
  const log = $('#chatLog'); if (!log) return; const items = await call('chat:get'); log.innerHTML = '';
  if (!items.length) { log.innerHTML = suggestions(); wireSugg(log); return; }
  for (const it of items) addChat(it, true); log.scrollTop = log.scrollHeight;
}
function suggestions() {
  const empty = S.site && S.site.pages.every((p) => p.sections.length <= 1);
  const list = empty ? ['Build me a complete site for my business. Ask me a few questions first.', 'Rebuild https://example.com as a modern, premium site', 'Make a one-page landing site for a product launch with a waitlist form'] : ['Review the whole site like a senior designer and fix the biggest issues', 'Make the home page hero more striking', 'Write SEO titles and descriptions for every page', 'Check every page on a phone and fix what breaks', 'Add a pricing page that matches the site', 'Draft three blog posts for this business'];
  return `<div class="insp-empty" style="padding:18px 6px 8px"><div class="big">${icon('sparkle', 24)}</div><b style="color:var(--fg)">Your AI has the whole site</b><span>It can add and rewrite sections, change the theme, write posts, find photos, look at every page on desktop and phone, run checks, export and publish.</span></div><div class="chat-sugg" style="flex-direction:column;align-items:stretch">${list.map((x) => `<button data-s="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
}
function wireSugg(log) { $$('[data-s]', log).forEach((b) => b.onclick = () => { const t = $('#chatText'); t.value = b.dataset.s; t.focus(); }); }
let lastShotRow = null;
function addChat(e, old) {
  const log = $('#chatLog'); if (!log) return; const first = log.querySelector('.insp-empty'); if (first) { log.innerHTML = ''; }
  const th = log.querySelector('.thinking'); if (th && e.kind !== 'thinking') th.remove();
  let el;
  if (e.kind === 'user') { el = document.createElement('div'); el.className = 'msg user'; el.textContent = e.text; lastShotRow = null; }
  else if (e.kind === 'text') { el = document.createElement('div'); el.className = 'msg ai'; el.textContent = e.text; lastShotRow = null; }
  else if (e.kind === 'tool') { el = document.createElement('div'); el.className = 'tool-chip'; el.title = (e.name || '') + ' ' + (e.args || ''); el.innerHTML = `${icon('bolt', 12)}<span>${esc(TOOL_LABEL[e.name] || e.name)}</span>`; if (!old) { $('#aiBusyText').textContent = (TOOL_LABEL[e.name] || e.name) + '…'; } lastShotRow = null; }
  else if (e.kind === 'tool-error') { el = document.createElement('div'); el.className = 'tool-chip err'; el.title = e.text; el.innerHTML = `${icon('alert', 12)}<span>${esc((e.text || '').replace(/^Error: /, '').slice(0, 90))}</span>`; }
  else if (e.kind === 'image') { if (!lastShotRow) { lastShotRow = document.createElement('div'); lastShotRow.className = 'shot-row'; log.appendChild(lastShotRow); } const img = document.createElement('img'); img.src = 'data:image/jpeg;base64,' + e.data; img.onclick = () => lightbox(img.src); lastShotRow.appendChild(img); log.scrollTop = log.scrollHeight; return; }
  else if (e.kind === 'thinking') { if (log.querySelector('.thinking')) return; el = document.createElement('div'); el.className = 'thinking'; el.innerHTML = '<i></i><i></i><i></i>'; }
  else if (e.kind === 'error') { el = document.createElement('div'); el.className = 'msg err'; el.textContent = e.text; }
  else if (e.kind === 'done') { if (!e.text || old) return; el = document.createElement('div'); el.className = 'msg done'; el.textContent = 'Done'; }
  else return;
  log.appendChild(el); log.scrollTop = log.scrollHeight;
}
function setBusy(on) {
  S.aiBusy = on; const st = $('#chatStop'), sd = $('#chatSend'); if (st) st.hidden = !on; if (sd) sd.disabled = on;
  $('#aiBusy').hidden = !on; $('#aiDot').classList.toggle('on', on);
}
async function sendChat(text) {
  if (S.aiBusy) { toast('The AI is still working', 'Stop it first, or wait for it to finish.', 'info'); return; }
  if (S.rtab !== 'ai') setRtab('ai');
  const ta = $('#chatText'); if (ta) { ta.value = ''; ta.style.height = ''; }
  addChat({ kind: 'user', text }); setBusy(true); $('#aiBusyText').textContent = 'Thinking…';
  try { await call('chat:send', text, { provider: S.settings.aiProvider }); }
  catch (e) { if (!/Stopped/.test(e.message) && /key|Install Claude Code|Settings/.test(e.message)) toast('The AI couldn’t start', e.message, 'bad', 9000); }
  finally { setBusy(false); refreshSite().catch(() => {}); }
}
