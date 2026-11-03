// Atrium — the in-app assistant over model APIs. Anthropic's Messages API, or any OpenAI-compatible Chat Completions
// API (OpenAI, Google Gemini, OpenRouter, xAI, Mistral, DeepSeek, Groq, Ollama, LM Studio, or a custom address).
// The model gets the same tools as the Claude/Codex plugin and runs them in a loop until it's done.
'use strict';
const { TOOLS } = require('../mcp/tools');

const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic · Claude', kind: 'anthropic', base: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', keyUrl: 'https://console.anthropic.com/settings/keys', vision: true },
  { id: 'openai', name: 'OpenAI · GPT', kind: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-5', keyUrl: 'https://platform.openai.com/api-keys', vision: true },
  { id: 'gemini', name: 'Google · Gemini', kind: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-pro', keyUrl: 'https://aistudio.google.com/apikey', vision: true },
  { id: 'openrouter', name: 'OpenRouter · any model', kind: 'openai', base: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.5', keyUrl: 'https://openrouter.ai/keys', vision: true },
  { id: 'xai', name: 'xAI · Grok', kind: 'openai', base: 'https://api.x.ai/v1', model: 'grok-4', keyUrl: 'https://console.x.ai', vision: true },
  { id: 'mistral', name: 'Mistral', kind: 'openai', base: 'https://api.mistral.ai/v1', model: 'mistral-large-latest', keyUrl: 'https://console.mistral.ai/api-keys', vision: true },
  { id: 'deepseek', name: 'DeepSeek', kind: 'openai', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys', vision: false },
  { id: 'groq', name: 'Groq', kind: 'openai', base: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', keyUrl: 'https://console.groq.com/keys', vision: false },
  { id: 'ollama', name: 'Ollama · on this computer', kind: 'openai', base: 'http://127.0.0.1:11434/v1', model: 'qwen3-coder', noKey: true, vision: false },
  { id: 'lmstudio', name: 'LM Studio · on this computer', kind: 'openai', base: 'http://127.0.0.1:1234/v1', model: '', noKey: true, vision: false },
  { id: 'custom', name: 'Custom (OpenAI-compatible)', kind: 'openai', base: '', model: '', vision: true },
];

async function post(url, headers, body, signal) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = null; }
  if (!r.ok) { const m = (j && (j.error && (j.error.message || j.error) || j.message)) || t.slice(0, 400) || r.statusText; throw new Error(`${r.status}: ${typeof m === 'string' ? m : JSON.stringify(m)}`); }
  return j;
}

async function listModels(p, key) {
  if (p.kind === 'anthropic') { const r = await fetch(p.base + '/v1/models?limit=100', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }); const j = await r.json(); if (!r.ok) throw new Error(j.error ? j.error.message : r.status); return j.data.map((m) => m.id); }
  const r = await fetch(p.base.replace(/\/$/, '') + '/models', { headers: key ? { Authorization: `Bearer ${key}` } : {} }); const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || r.status);
  return (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean).sort();
}

// keep the conversation from growing without bound: drop old pictures, keep the last few
function pruneImages(messages, keep = 4) {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i].content; if (!Array.isArray(c)) continue;
    for (const part of c) {
      const blocks = part.type === 'tool_result' && Array.isArray(part.content) ? part.content : [part];
      for (let k = 0; k < blocks.length; k++) { const b = blocks[k]; if (b.type === 'image' || b.type === 'image_url') { seen++; if (seen > keep) blocks[k] = { type: 'text', text: '[earlier screenshot removed to save space]' }; } }
    }
  }
}

function toolList(kind) {
  return TOOLS.map((t) => (kind === 'anthropic' ? { name: t.name, description: t.description, input_schema: t.inputSchema } : { type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
}
const brief = (a) => { const s = JSON.stringify(a || {}); return s.length > 140 ? s.slice(0, 140) + '…' : s; };

// run one user turn. history is mutated (kept per site by the caller).
async function runTurn({ provider, key, model, system, history, prompt, handle, onEvent = () => {}, signal, maxSteps = 60, vision }) {
  const p = PROVIDERS.find((x) => x.id === provider.id) || provider; const base = (provider.base || p.base || '').replace(/\/$/, ''); const useVision = vision ?? p.vision;
  if (!base) throw new Error('Set the API address for this provider in Settings › AI.');
  if (!key && !p.noKey) throw new Error(`Add your ${p.name} API key in Settings › AI.`);
  const mdl = model || p.model; if (!mdl) throw new Error('Choose a model in Settings › AI.');
  const by = p.name.split(' · ').pop();
  if (p.kind === 'anthropic') {
    history.push({ role: 'user', content: [{ type: 'text', text: prompt }] });
    const tools = toolList('anthropic'); tools[tools.length - 1].cache_control = { type: 'ephemeral' };
    for (let step = 0; step < maxSteps; step++) {
      pruneImages(history);
      onEvent({ kind: 'thinking' });
      const res = await post(base + '/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model: mdl, max_tokens: 16000, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], tools, messages: history }, signal);
      history.push({ role: 'assistant', content: res.content });
      for (const b of res.content) if (b.type === 'text' && b.text.trim()) onEvent({ kind: 'text', text: b.text });
      const calls = res.content.filter((b) => b.type === 'tool_use');
      if (!calls.length || res.stop_reason !== 'tool_use') { onEvent({ kind: 'usage', usage: res.usage }); return { text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') }; }
      const results = [];
      for (const c of calls) {
        onEvent({ kind: 'tool', name: c.name, args: brief(c.input) });
        const r = await handle(c.name, c.input, by);
        const content = r.content.map((x) => (x.type === 'image' ? (useVision ? { type: 'image', source: { type: 'base64', media_type: x.mimeType, data: x.data } } : { type: 'text', text: '[screenshot taken]' }) : { type: 'text', text: x.text }));
        r.content.filter((x) => x.type === 'image').forEach((x) => onEvent({ kind: 'image', data: x.data }));
        results.push({ type: 'tool_result', tool_use_id: c.id, content, ...(r.isError ? { is_error: true } : {}) });
        if (r.isError) onEvent({ kind: 'tool-error', name: c.name, text: r.content[0].text });
      }
      history.push({ role: 'user', content: results });
    }
    return { text: 'Stopped after many steps. Say “continue” to keep going.' };
  }
  // OpenAI-compatible
  if (!history.length || history[0].role !== 'system') history.unshift({ role: 'system', content: system }); else history[0].content = system;
  history.push({ role: 'user', content: prompt });
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  if (provider.id === 'openrouter') { headers['HTTP-Referer'] = 'https://github.com/irathernotm8-prog/utility-suite'; headers['X-Title'] = 'Atrium'; }
  for (let step = 0; step < maxSteps; step++) {
    pruneImages(history);
    onEvent({ kind: 'thinking' });
    const res = await post(base + '/chat/completions', headers, { model: mdl, messages: history, tools: toolList('openai'), tool_choice: 'auto' }, signal);
    const msg = res.choices && res.choices[0] && res.choices[0].message; if (!msg) throw new Error('The model sent an empty reply');
    history.push({ role: 'assistant', content: msg.content || '', ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) });
    if (msg.content && String(msg.content).trim()) onEvent({ kind: 'text', text: msg.content });
    if (!msg.tool_calls || !msg.tool_calls.length) { onEvent({ kind: 'usage', usage: res.usage }); return { text: msg.content || '' }; }
    const pics = [];
    for (const c of msg.tool_calls) {
      let args = {}; try { args = JSON.parse(c.function.arguments || '{}'); } catch {}
      onEvent({ kind: 'tool', name: c.function.name, args: brief(args) });
      const r = await handle(c.function.name, args, by);
      const imgs = r.content.filter((x) => x.type === 'image'); imgs.forEach((x) => onEvent({ kind: 'image', data: x.data }));
      if (r.isError) onEvent({ kind: 'tool-error', name: c.function.name, text: r.content[0].text });
      history.push({ role: 'tool', tool_call_id: c.id, content: r.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n') + (imgs.length ? `\n[${imgs.length} screenshot(s) attached below]` : '') });
      if (useVision) pics.push(...imgs);
    }
    if (pics.length) history.push({ role: 'user', content: [{ type: 'text', text: 'Screenshots from those tool calls:' }, ...pics.slice(-6).map((x) => ({ type: 'image_url', image_url: { url: `data:${x.mimeType};base64,${x.data}` } }))] });
  }
  return { text: 'Stopped after many steps. Say “continue” to keep going.' };
}

module.exports = { PROVIDERS, runTurn, listModels };
