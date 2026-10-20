// "Ask Lumen" — answers questions about the numbers on screen. Three ways to power it:
//   anthropic  your own API key (pay per use)
//   claude-cli the Claude Code CLI already signed in on this computer (uses your Claude plan, no API key)
//   codex-cli  the Codex CLI already signed in on this computer (uses your ChatGPT plan, no API key)
// Lumen never touches your subscription login itself; the official CLI does the signing in.
// Read-only for now: it sees a compact summary of the selected window and can't change anything.
const API = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5-5';

function compact(s) {
  const r = (n, d = 2) => +(+n).toFixed(d);
  const t = (x) => ({ spend: r(x.spend), impressions: x.impressions, clicks: x.clicks, conversions: r(x.conversions, 1), ctr_pct: x.impressions ? r(x.clicks / x.impressions * 100) : 0, cost_per_conversion: x.conversions ? r(x.spend / x.conversions) : null });
  return {
    window: { from: s.from, to: s.to, days: s.span },
    totals: t(s.current), previous_period: t(s.previous),
    campaigns: s.campaigns.slice(0, 40).map((c) => ({ name: c.name, source: c.source, ...t(c) })),
    daily: s.series.map((d) => ({ date: d.date, spend: r(d.spend), conversions: r(d.conversions, 1) })),
    ...(s.analytics ? { analytics: s.analytics } : {})
  };
}

const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const PROVIDERS = {
  anthropic: { label: 'Anthropic API key' },
  'claude-cli': { label: 'Claude (signed-in Claude Code CLI)', cmd: 'claude' },
  'codex-cli': { label: 'ChatGPT (signed-in Codex CLI)', cmd: 'codex' }
};

function systemPrompt(summary, workspace) {
  return [
    'You are Lumen, an analytics assistant inside a personal ads dashboard.',
    'Answer only from the data below. If the data cannot answer the question, say so plainly instead of guessing.',
    'Be concise. Show your numbers. Say when a sample is small or a comparison is shaky.',
    'You are read-only: you cannot change campaigns or budgets, only advise. Do not use tools, read files or run commands.',
    `Workspace: ${workspace}.`, '', 'DATA (JSON):', JSON.stringify(compact(summary))
  ].join('\n');
}

const shq = (x) => "'" + String(x).replace(/'/g, "'\\''") + "'";
const extraPath = () => {
  const h = os.homedir();
  return process.platform === 'win32' ? [] : [path.join(h, '.local', 'bin'), path.join(h, '.claude', 'local'), path.join(h, '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
};

// Runs a CLI the way a Terminal would (login shell, so PATH from your profile applies), with the prompt on stdin.
function runCli(cmd, args, input, { timeoutMs = 180000, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PATH: [...extraPath(), process.env.PATH || ''].filter(Boolean).join(path.delimiter), NO_COLOR: '1' };
    const win = process.platform === 'win32';
    const child = win ? spawnImpl(cmd, args, { env, cwd: os.tmpdir(), shell: true, windowsHide: true })
      : spawnImpl(process.env.SHELL || '/bin/zsh', ['-lc', [cmd, ...args].map(shq).join(' ')], { env, cwd: os.tmpdir() });
    let out = '', err = '', done = false;
    const timer = setTimeout(() => { if (!done) { done = true; child.kill(); reject(new Error(`${cmd} took longer than ${Math.round(timeoutMs / 1000)}s and was stopped.`)); } }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    child.on('close', (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, stdout: out, stderr: err }); } });
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}

function cliProblem(cmd, r) {
  const text = (r.stderr + r.stdout).slice(0, 400);
  if (r.code === 127 || /not found|command not found|ENOENT|not recognized/i.test(text)) return `${cmd} isn't installed on this computer (or isn't on your PATH). Install it, run it once in Terminal to sign in, then try again.`;
  if (/log ?in|auth|sign ?in|unauthorized|api key/i.test(text)) return `${cmd} isn't signed in. Run "${cmd}" once in Terminal and sign in with your account, then try again.`;
  return `${cmd} failed (exit ${r.code}): ${text.trim() || 'no output'}`;
}

async function askCli(provider, prompt, model, deps = {}) {
  const run = deps.run || runCli;
  const cmd = PROVIDERS[provider].cmd;
  if (provider === 'claude-cli') {
    const args = ['-p', '--output-format', 'text', '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch'];
    if (model) args.push('--model', model);
    const r = await run(cmd, args, prompt);
    if (r.code !== 0 || !r.stdout.trim()) throw new Error(cliProblem(cmd, r));
    return r.stdout.trim();
  }
  const outFile = path.join(os.tmpdir(), 'lumen-codex-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.txt');
  const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--output-last-message', outFile];
  if (model) args.push('--model', model);
  args.push('-');
  try {
    const r = await run(cmd, args, prompt);
    let text = ''; try { text = fs.readFileSync(outFile, 'utf8'); } catch (_) { text = r.code === 0 ? r.stdout : ''; }
    if (r.code !== 0 || !text.trim()) throw new Error(cliProblem(cmd, r));
    return text.trim();
  } finally { try { fs.unlinkSync(outFile); } catch (_) {} }
}

// Is the CLI present? (Signing in is only checked when you actually ask something.)
async function detect(provider, deps = {}) {
  const p = PROVIDERS[provider]; if (!p || !p.cmd) return { installed: true };
  const r = await (deps.run || runCli)(p.cmd, ['--version'], '', { timeoutMs: 20000 }).catch(() => ({ code: 1, stdout: '', stderr: '' }));
  return r.code === 0 ? { installed: true, version: r.stdout.trim().split('\n')[0] } : { installed: false };
}

// One entry point for all three providers: a system prompt plus a message list in, text out.
async function complete({ provider = 'anthropic', key, model, cliModel, system, messages, maxTokens = 1200 }, fetchImpl = fetch, deps = {}) {
  if (provider === 'claude-cli' || provider === 'codex-cli') {
    const convo = messages.map((m) => `${m.role === 'user' ? 'User' : 'Lumen'}: ${m.content}`).join('\n\n');
    return askCli(provider, `${system}\n\n---\nConversation so far:\n\n${convo}\n\nLumen:`, cliModel, deps);
  }
  if (!key) throw new Error('Add an Anthropic API key in Settings, or switch to a signed-in Claude or ChatGPT CLI.');
  const res = await fetchImpl(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: model || DEFAULT_MODEL, max_tokens: maxTokens, system, messages })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || `Anthropic returned HTTP ${res.status}`);
  return (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

async function ask({ question, history = [], summary, workspace, ...cfg }, fetchImpl = fetch, deps = {}) {
  const hist = history.slice(-10).map((m) => ({ role: m.role, content: String(m.text || '') }));
  return complete({ ...cfg, system: systemPrompt(summary, workspace), messages: [...hist, { role: 'user', content: question }] }, fetchImpl, deps);
}

// Three caption options for a social post. Nothing is posted; the person picks, edits and publishes.
async function draft({ brief, platforms = ['facebook'], tone = 'friendly and clear', workspace, ...cfg }, fetchImpl = fetch, deps = {}) {
  if (!String(brief || '').trim()) throw new Error('Describe what the post is about first.');
  const system = [
    `You write social media captions for ${workspace || 'a local business'}.`,
    `Platforms: ${platforms.join(' and ')}. Tone: ${tone}.`,
    'Use only facts in the brief. Never invent prices, dates, discounts, speeds or guarantees. Keep each option under 600 characters, with a clear hook first and at most two hashtags.',
    'Do not use tools, read files or run commands.',
    'Reply with ONLY a JSON array of exactly 3 different caption strings, nothing else.'
  ].join('\n');
  const text = await complete({ ...cfg, system, messages: [{ role: 'user', content: String(brief) }], maxTokens: 1500 }, fetchImpl, deps);
  const m = text.match(/\[[\s\S]*\]/);
  try { const a = JSON.parse(m ? m[0] : text); if (Array.isArray(a) && a.length) return a.map(String).slice(0, 3); } catch (_) {}
  return [text.trim()];
}

module.exports = { ask, draft, complete, compact, detect, runCli, PROVIDERS, DEFAULT_MODEL };
