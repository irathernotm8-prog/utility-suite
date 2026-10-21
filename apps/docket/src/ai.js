// Docket's AI: summaries, action items and questions about meetings. Same three ways to power it as Lumen:
//   claude-cli  the Claude Code CLI already signed in on this computer (uses your Claude plan, no API key)
//   anthropic   your own Anthropic API key (pay per use)
//   codex-cli   the Codex CLI already signed in on this computer (uses your ChatGPT plan)
// Transcription never goes through here: it happens on this computer. Only the text transcript is sent, and only when you summarize or ask.
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const API = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const PROVIDERS = {
  'claude-cli': { label: 'Claude (signed-in Claude Code CLI)', cmd: 'claude' },
  anthropic: { label: 'Anthropic API key' },
  'codex-cli': { label: 'ChatGPT (signed-in Codex CLI)', cmd: 'codex' },
  off: { label: 'Off' }
};

const shq = (x) => "'" + String(x).replace(/'/g, "'\\''") + "'";
const extraPath = () => {
  const h = os.homedir();
  return process.platform === 'win32' ? [] : [path.join(h, '.local', 'bin'), path.join(h, '.claude', 'local'), path.join(h, '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
};

// Runs a CLI the way Terminal would (login shell, so your PATH applies), prompt on stdin.
function runCli(cmd, args, input, { timeoutMs = 300000, spawnImpl = spawn } = {}) {
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
  if (/log ?in|auth|sign ?in|unauthorized|api key/i.test(text)) return `${cmd} isn't signed in. Run "${cmd}" once in Terminal and sign in, then try again.`;
  return `${cmd} failed (exit ${r.code}): ${text.trim() || 'no output'}`;
}
async function askCli(provider, prompt, model, deps = {}) {
  const run = deps.run || runCli;
  const cmd = PROVIDERS[provider].cmd;
  if (provider === 'claude-cli') {
    const args = ['-p', '--output-format', 'text', '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Read,Glob,Grep'];
    if (model) args.push('--model', model);
    const r = await run(cmd, args, prompt);
    if (r.code !== 0 || !r.stdout.trim()) throw new Error(cliProblem(cmd, r));
    return r.stdout.trim();
  }
  const outFile = path.join(os.tmpdir(), 'docket-codex-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.txt');
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
async function detect(provider, deps = {}) {
  const p = PROVIDERS[provider]; if (!p || !p.cmd) return { installed: true };
  const r = await (deps.run || runCli)(p.cmd, ['--version'], '', { timeoutMs: 20000 }).catch(() => ({ code: 1, stdout: '', stderr: '' }));
  return r.code === 0 ? { installed: true, version: r.stdout.trim().split('\n')[0] } : { installed: false };
}

async function complete({ provider = 'claude-cli', key, model, cliModel, system, messages, maxTokens = 4000 }, fetchImpl = fetch, deps = {}) {
  if (provider === 'off') throw new Error('AI is turned off. Pick Claude, an API key or ChatGPT in Settings to get summaries.');
  if (provider === 'claude-cli' || provider === 'codex-cli') {
    const convo = messages.map((m) => `${m.role === 'user' ? 'User' : 'Docket'}: ${m.content}`).join('\n\n');
    return askCli(provider, `${system}\n\n---\n${convo}\n\nDocket:`, cliModel, deps);
  }
  if (!key) throw new Error('Add an Anthropic API key in Settings, or switch to the signed-in Claude or ChatGPT CLI.');
  const res = await fetchImpl(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: model || DEFAULT_MODEL, max_tokens: maxTokens, system, messages })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || `Anthropic returned HTTP ${res.status}`);
  return (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

// ---- turning a meeting into text the model reads ----
const clock = (sec) => {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0');
};
function transcriptText(m) {
  const name = (ch) => (m.speakers && m.speakers[ch]) || (ch === 'me' ? 'You' : ch === 'them' ? 'Them' : 'Speaker');
  return (m.segments || []).filter((s) => s.text && s.text.trim()).map((s) => `[${clock(s.t0)}] ${name(s.ch)}: ${s.text.trim()}`).join('\n');
}
const toSec = (v) => {
  if (typeof v === 'number' && isFinite(v)) return Math.max(0, v);
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const p = String(v).trim().replace(/^\[|\]$/g, '').split(':').map(Number);
  if (!p.length || p.some((n) => !isFinite(n))) return null;
  return p.reduce((a, n) => a * 60 + n, 0);
};
function parseJson(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : text);
}
const arr = (a) => Array.isArray(a) ? a.map((x) => String(x || '').trim()).filter(Boolean) : [];
function cleanSummary(j) {
  return {
    title: String(j.title || '').trim().slice(0, 90),
    text: String(j.summary || j.text || '').trim(),
    keyPoints: arr(j.keyPoints), decisions: arr(j.decisions), openQuestions: arr(j.openQuestions),
    chapters: (Array.isArray(j.chapters) ? j.chapters : []).map((c) => ({ title: String(c.title || '').trim(), t: toSec(c.t) })).filter((c) => c.title),
    actionItems: (Array.isArray(j.actionItems) ? j.actionItems : []).map((a) => ({
      text: String(a.task || a.text || '').trim(), owner: String(a.owner || '').trim(), due: String(a.due || '').trim(), t: toSec(a.t)
    })).filter((a) => a.text)
  };
}

function summaryPrompt(m, { myName = 'You', today } = {}) {
  const me = (m.speakers && m.speakers.me) || myName || 'You';
  const when = new Date(m.startedAt || Date.now());
  return [
    'You are Docket, a meeting note-taker. Below is a transcript made by on-device speech-to-text, so it has mistakes and misheard words: fix obvious ones silently, but never invent facts, names, numbers or dates.',
    `Speakers: "${me}" is the person using Docket (their microphone). "${(m.speakers && m.speakers.them) || 'Them'}" is everyone else on the call (several people can be merged under that one label; use names when the transcript makes them clear). "Speaker" means an imported recording where voices are not separated.`,
    `The meeting started ${when.toDateString()} at ${when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${m.app ? ' on ' + m.app : ''}. Today is ${today || new Date().toDateString()}.`,
    'If the person wrote their own notes, they show what mattered to them: make sure those points are covered.',
    'Reply with ONLY one JSON object, no other text, with these keys:',
    '"title": 3 to 7 words naming what the meeting was about;',
    '"summary": 2 to 4 plain sentences;',
    '"keyPoints": up to 8 short bullets of what was discussed;',
    '"decisions": what was actually agreed (empty if nothing was);',
    '"actionItems": [{"task": a clear imperative to-do, "owner": a name, or "Me" when it is the Docket user, or "" if unclear, "due": "YYYY-MM-DD" when a date can be worked out from the meeting date, otherwise a short phrase like "next week" or "", "t": the [mm:ss] time it was said}] — only things someone committed to or was asked to do;',
    '"openQuestions": things left unresolved;',
    '"chapters": up to 8 [{"title", "t": "mm:ss"}] marking where the topic changes.',
    'Do not use tools, read files or run commands.'
  ].join('\n');
}

const CHUNK = 140000;
async function summarize(m, cfg = {}, fetchImpl = fetch, deps = {}) {
  const transcript = transcriptText(m);
  if (!transcript.trim() && !(m.notes || '').trim()) throw new Error('There is nothing to summarize yet: the transcript is empty.');
  const system = summaryPrompt(m, cfg);
  const notes = (m.notes || '').trim();
  const ask = async (body) => cleanSummary(parseJson(await complete({ ...cfg, system, messages: [{ role: 'user', content: body }], maxTokens: 4000 }, fetchImpl, deps)));
  if (transcript.length <= CHUNK) {
    return ask(`${notes ? 'MY NOTES:\n' + notes + '\n\n' : ''}TRANSCRIPT:\n${transcript || '(no speech captured)'}`);
  }
  // Very long meetings: summarize in parts, then merge the parts.
  const lines = transcript.split('\n'); const parts = []; let cur = '';
  for (const l of lines) { if (cur.length + l.length > CHUNK) { parts.push(cur); cur = ''; } cur += l + '\n'; }
  if (cur) parts.push(cur);
  const partial = [];
  for (let i = 0; i < parts.length; i++) partial.push(await ask(`This is part ${i + 1} of ${parts.length} of a long meeting.\n\nTRANSCRIPT:\n${parts[i]}`));
  return ask(`${notes ? 'MY NOTES:\n' + notes + '\n\n' : ''}The meeting was too long to read at once. Here are summaries of each part as JSON; merge them into one, removing repeats:\n${JSON.stringify(partial)}`);
}

// Questions about one meeting, or across several (the caller picks which meetings to include).
async function ask({ question, history = [], meetings = [], myName }, cfg = {}, fetchImpl = fetch, deps = {}) {
  const budget = Math.floor(160000 / Math.max(1, meetings.length));
  const ctx = meetings.map((m) => {
    const s = m.summary || {};
    const head = `=== ${m.title} (${new Date(m.startedAt).toDateString()}, id ${m.id}) ===`;
    const sum = s.text ? `Summary: ${s.text}\nDecisions: ${(s.decisions || []).join('; ') || 'none'}` : '';
    return [head, sum, (m.notes || '').trim() ? 'My notes:\n' + m.notes.trim() : '', 'Transcript:\n' + transcriptText(m).slice(0, budget)].filter(Boolean).join('\n');
  }).join('\n\n');
  const system = [
    `You are Docket, answering questions about the user's meetings. The user is "${myName || 'You'}" in transcripts; "Them" is everyone else.`,
    'Answer only from the meetings below. Transcripts come from speech-to-text and contain errors. Quote the [mm:ss] time when you point to something. If the meetings do not answer the question, say so plainly.',
    'Be concise. Do not use tools, read files or run commands.', '', ctx || '(no meetings)'
  ].join('\n');
  const msgs = [...history.slice(-8).map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: String(h.text || '') })), { role: 'user', content: String(question) }];
  return complete({ ...cfg, system, messages: msgs, maxTokens: 1500 }, fetchImpl, deps);
}

module.exports = { PROVIDERS, complete, summarize, ask, detect, transcriptText, cleanSummary, parseJson, summaryPrompt, toSec, runCli };
