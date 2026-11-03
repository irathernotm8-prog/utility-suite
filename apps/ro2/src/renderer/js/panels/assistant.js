// AI design: chat with Claude, ChatGPT, Gemini… right here, or plug RO2 into Claude Desktop, Claude Code or Codex.
// Every AI gets the same RO2 tools (mcp/tools.js); the work happens on the canvas while you watch.
import { register, refresh, currentPanel } from '../drawer.js';
import { h, ico, btn, toast, toastErr, seg, esc } from '../ui.js';
import { app } from '../app.js';

const chat = []; // {role:'user'|'ai'|'tool'|'err'|'img', text, data}
let turn = null; let lastTurn = null; let status = null; let showSettings = false; let fresh = true; let logEl = null;
const IDEAS = [
  'An Instagram post announcing our summer sale, bold and bright',
  'A YouTube thumbnail for “10 tips for better sleep”',
  'A 6-second animated story for a coffee shop opening, then export it as MP4',
  'Make three pages for a product launch and turn them into a slideshow video with fades',
];

window.ro2.ai.onEvent((e) => {
  if (e.turnId !== lastTurn) return; // events can land just after the turn's answer, so keep the id
  if (e.kind === 'text') push({ role: 'ai', text: e.text });
  else if (e.kind === 'tool') push({ role: 'tool', text: toolLabel(e.name, e.args) });
  else if (e.kind === 'tool-error') push({ role: 'err', text: e.text });
  else if (e.kind === 'image' && e.data) push({ role: 'img', data: e.data });
  else if (e.kind === 'thinking') setThinking(true);
});
window.ro2.ai.onBridge(() => { status = null; if (currentPanel() === 'assistant') refresh(['assistant']); });

const TOOL_WORDS = { add_html: 'Building the design in HTML', update_html: 'Changing the HTML', screenshot: 'Looking at the design', preview_animation: 'Watching the animation', new_design: 'Starting a design', add_page: 'Adding a page', set_timeline: 'Setting the timeline', export: 'Exporting', get_state: 'Checking what’s open', ro2_guide: 'Reading the RO2 guide', list_layers: 'Reading the layers', update_layer: 'Adjusting a layer', html_to_layers: 'Making it editable', add_image: 'Adding a picture', add_text: 'Adding text', color_grade: 'Colour grading', brand_kit: 'Reading the brand kit' };
function toolLabel(name, args) { const n = String(name || '').replace(/^mcp__ro2__/, ''); return TOOL_WORDS[n] || n.replace(/_/g, ' '); }
function push(m) {
  const last = chat[chat.length - 1];
  if (m.role === 'img' && chat.filter((x) => x.role === 'img').length > 24) { const i = chat.findIndex((x) => x.role === 'img'); chat.splice(i, 1); }
  if (m.role === 'tool' && last && last.role === 'tool' && last.text === m.text) { last.n = (last.n || 1) + 1; } else chat.push(m);
  setThinking(m.role === 'tool'); draw();
}
function setThinking(v) { if (turn) turn.thinking = v; const t = document.querySelector('.as-typing'); if (t) t.classList.toggle('hidden', !v && !(turn && !chat.length)); }

function draw() {
  if (!logEl || !logEl.isConnected) return;
  logEl.innerHTML = '';
  for (const m of chat) {
    if (m.role === 'user') logEl.append(h('div.as-msg.me', m.text));
    else if (m.role === 'ai') logEl.append(h('div.as-msg.ai', { html: md(m.text) }));
    else if (m.role === 'tool') logEl.append(h('div.as-tool', { html: ico('wand-sparkles') + `<span>${esc(m.text)}${m.n > 1 ? ` ×${m.n}` : ''}</span>` }));
    else if (m.role === 'err') logEl.append(h('div.as-tool.err', { html: ico('triangle-alert') + `<span>${esc(m.text.slice(0, 240))}</span>` }));
    else if (m.role === 'img') logEl.append(h('img.as-shot', { src: 'data:image/jpeg;base64,' + m.data, alt: 'What the AI saw' }));
  }
  if (turn) logEl.append(h('div.as-typing', h('span'), h('span'), h('span')));
  logEl.scrollTop = logEl.scrollHeight;
}
function md(t) { // a little markdown: bold, code, lists, paragraphs
  return esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').split(/\n{2,}/).map((p) => (/^\s*[-*] /m.test(p) ? '<ul>' + p.split('\n').map((l) => `<li>${l.replace(/^\s*[-*] /, '')}</li>`).join('') + '</ul>' : `<p>${p.replace(/\n/g, '<br>')}</p>`)).join('');
}

async function send(prompt) {
  prompt = prompt.trim(); if (!prompt || turn) return;
  chat.push({ role: 'user', text: prompt });
  turn = { id: 't' + Date.now().toString(36), thinking: true }; lastTurn = turn.id; const reset = fresh; fresh = false;
  draw(); syncBtns();
  try {
    const r = await window.ro2.ai.ask(turn.id, { prompt, reset });
    await new Promise((ok) => setTimeout(ok, 250)); // let the last events arrive
    const said = chat.slice(chat.map((m) => m.role).lastIndexOf('user')).filter((m) => m.role === 'ai').map((m) => m.text.trim());
    if (r && r.text && r.text.trim() && !said.includes(r.text.trim()) && !said.join('\n').endsWith(r.text.trim())) push({ role: 'ai', text: r.text });
  } catch (e) {
    const msg = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    if (!/abort/i.test(msg)) push({ role: 'err', text: msg });
    if (/API key|Choose an AI|model/i.test(msg)) { showSettings = true; refresh(['assistant']); }
  } finally { turn = null; draw(); syncBtns(); }
}
function syncBtns() { const s = document.querySelector('.as-send'); const st = document.querySelector('.as-stop'); if (s) s.classList.toggle('hidden', !!turn); if (st) st.classList.toggle('hidden', !turn); }

const ROUTES = [{ value: 'auto', label: 'Auto' }, { value: 'api', label: 'API key' }, { value: 'claude-code', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }];
function routeText(st) {
  const s = st.settings; const p = st.providers.find((x) => x.id === s.provider) || st.providers[0];
  if (s.route === 'claude-code') return st.claude ? 'Using Claude Code on this computer (your Claude plan).' : 'Claude Code isn’t installed on this computer.';
  if (s.route === 'codex') return st.codex ? 'Using Codex on this computer (your ChatGPT plan).' : 'Codex isn’t installed on this computer.';
  if (s.route === 'api' || s.hasKey[s.provider] || p.noKey) return `Using ${p.name}${s.model ? ' · ' + s.model : ''}.`;
  if (st.claude || st.codex) return `Using ${st.claude ? 'Claude Code' : 'Codex'} on this computer. Add an API key to use another AI.`;
  return 'Choose an AI: sign in with Claude Code / Codex, or add an API key.';
}

function settingsBox(st, root) {
  const s = st.settings; const box = h('div.as-settings');
  const save = async (patch) => { try { await window.ro2.ai.set(patch); status = null; refresh(['assistant']); } catch (e) { toastErr(e); } };
  box.append(h('div.form-row', h('label', 'Who answers'), seg(ROUTES, s.route === 'api' ? 'api' : s.route || 'auto', (v) => save({ route: v }), { block: true })));
  if (s.route !== 'claude-code' && s.route !== 'codex') {
    const sel = h('select.input', { on: { change: (e) => save({ provider: e.target.value, model: '' }) } }, ...st.providers.map((p) => h('option', { value: p.id, selected: p.id === s.provider }, p.name)));
    const p = st.providers.find((x) => x.id === s.provider) || st.providers[0];
    box.append(h('div.form-row', h('label', 'AI'), sel));
    const model = h('input.input', { value: s.model || '', placeholder: p.model || 'model name', list: 'asModels', on: { change: (e) => save({ model: e.target.value.trim() }) } });
    const dl = h('datalist#asModels');
    const load = btn('', async () => { try { const l = await window.ro2.ai.models(p.id); dl.innerHTML = ''; l.slice(0, 200).forEach((m) => dl.append(h('option', { value: m.id || m }))); toast(`${l.length} models. Pick one in the box.`); model.focus(); } catch (e) { toastErr(e); } }, { icon: 'refresh-cw', cls: 'ghost sm', title: 'Load the list of models' });
    box.append(h('div.form-row', h('label', 'Model'), h('div', { style: { display: 'flex', gap: '6px' } }, model, load), dl));
    if (p.id === 'custom' || p.noKey) box.append(h('div.form-row', h('label', 'Address'), h('input.input', { value: s.base || p.base || '', placeholder: 'https://…/v1', on: { change: (e) => save({ base: e.target.value.trim() }) } })));
    if (!p.noKey) {
      const key = h('input.input', { type: 'password', placeholder: s.hasKey[p.id] ? '•••••••• saved' : 'Paste your API key', autocomplete: 'off' });
      box.append(h('div.form-row', h('label', 'API key'), h('div', { style: { display: 'flex', gap: '6px' } }, key, btn('Save', () => save({ provider: p.id, key: key.value.trim() }), { cls: 'sm' }))));
      box.append(h('p.tiny.dim', { html: `Kept encrypted on this computer and sent only to ${esc(p.name.split(' · ')[0])}. ${p.keyUrl ? `<a href="#" data-url="${esc(p.keyUrl)}">Get a key</a>` : ''}${s.hasKey[p.id] ? ' · <a href="#" data-forget="1">Forget it</a>' : ''}` }));
      box.querySelectorAll('[data-url]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); window.ro2.shell.open(a.dataset.url); }));
      box.querySelectorAll('[data-forget]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); save({ provider: p.id, key: '' }); }));
      if (!p.vision) box.append(h('p.tiny.dim', 'This model can’t see pictures, so it can’t check its work with screenshots. Results are better with a model that can.'));
    }
  }
  return box;
}
function connectBox(st) {
  const c = st.connectors; const box = h('div.as-connect');
  const card = (id, name, sub, info) => {
    const state = info.current ? 'Connected' : info.added ? 'Needs updating' : info.installed ? 'Not connected' : 'Not installed';
    const b = btn(info.current ? 'Reconnect' : 'Connect', async () => {
      b.disabled = true;
      try { await window.ro2.ai.connect(id); status = null; toast(id === 'desktop' ? 'Added to Claude Desktop. Quit and reopen Claude Desktop, then ask it to design in RO2.' : id === 'code' ? 'Added to Claude Code. Start a new claude session and ask it to design in RO2.' : 'Added to Codex. Start a new codex session and ask it to design in RO2.', { ms: 7000 }); refresh(['assistant']); }
      catch (e) { toastErr(e); b.disabled = false; }
    }, { cls: info.current ? 'ghost sm' : 'sm' + (info.installed ? ' primary' : '') });
    return h('div.as-card', h('div', h('b', name), h('div.tiny.dim', sub)), h('div.as-card-r', h('span.tiny' + (info.current ? '.ok' : '.dim'), state), b));
  };
  box.append(card('desktop', 'Claude Desktop', 'Chat in the Claude app; it designs here', c.desktop), card('code', 'Claude Code', 'claude in a terminal', c.code), card('codex', 'Codex', 'ChatGPT’s coding agent', c.codex));
  box.append(h('p.tiny.dim', c.bridge && c.bridge.port ? `RO2 is listening for them on this computer only (port ${c.bridge.port}). Keep RO2 open while they work.` : 'RO2 starts its connection when it opens. Keep RO2 open while they work.'));
  return box;
}

register('assistant', {
  label: 'AI design', icon: 'bot', ai: true,
  async render(root, _o, alive) {
    if (!status) status = await window.ro2.ai.status(); if (!alive()) return; const st = status;
    const gear = h('button.btn.ghost.sm', { title: 'Choose the AI', html: ico('settings-2'), on: { click: () => { showSettings = !showSettings; refresh(['assistant']); } } });
    const reset = h('button.btn.ghost.sm', { title: 'New chat', html: ico('square-pen'), on: { click: () => { if (turn) return; chat.length = 0; fresh = true; draw(); } } });
    root.append(h('div.p-title', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, h('span', { style: { flex: 1 } }, 'AI design'), reset, gear));
    root.append(h('p.small.muted', { style: { marginTop: '-4px' } }, routeText(st)));
    if (showSettings) { root.append(settingsBox(st, root)); root.append(h('div.sec', h('h4', 'Or use RO2 from another app'))); root.append(connectBox(st)); }
    logEl = h('div.as-log'); root.append(logEl);
    if (!chat.length && !turn) {
      const ideas = h('div.as-ideas'); for (const i of IDEAS) ideas.append(h('button.chip', { on: { click: () => { ta.value = i; ta.focus(); } } }, i));
      logEl.append(h('p.small.muted', 'Tell the AI what to make. It builds the design on the canvas (usually as an HTML layer you can edit, animate or turn into normal layers), checks it with screenshots and fixes what it sees.'), ideas);
    } else draw();
    const ta = h('textarea.input.as-input', { rows: 3, placeholder: app.editor ? 'Describe what to make or change…' : 'Describe a design to make…', on: { keydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const v = ta.value; ta.value = ''; send(v); } } } });
    const go = h('button.btn.primary.sm.as-send' + (turn ? '.hidden' : ''), { html: ico('arrow-up') + '<span>Send</span>', on: { click: () => { const v = ta.value; ta.value = ''; send(v); } } });
    const stop = h('button.btn.sm.as-stop' + (turn ? '' : '.hidden'), { html: ico('square') + '<span>Stop</span>', on: { click: () => turn && window.ro2.ai.stop(turn.id) } });
    root.append(h('div.as-compose', ta, h('div.as-compose-row', h('span.tiny.dim', 'Enter to send · Shift+Enter for a new line'), stop, go)));
    if (!showSettings) root.append(h('div.sec', { style: { marginTop: '14px' } }, h('h4', 'Use RO2 from Claude or Codex')), connectBox(st));
  },
});
