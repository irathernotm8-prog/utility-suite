// Cadence — AI providers. Uses the person's own Claude Code (`claude -p`) or Codex (`codex exec`) sign-in when
// installed, or an Anthropic / OpenAI API key kept in Secrets. Prompts go in on stdin (no length limits, no quoting).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const T = require('./table');

const IS_WIN = process.platform === 'win32';
let shellPath = null;

// GUI apps on the Mac don't get the terminal's PATH, so ask the login shell once and add the usual places.
function searchPath() {
  const extra = [];
  const home = os.homedir();
  if (IS_WIN) {
    const ad = process.env.APPDATA || path.join(home, 'AppData', 'Roaming'); const la = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    extra.push(path.join(home, '.local', 'bin'), path.join(ad, 'npm'), path.join(la, 'Programs', 'claude'), path.join(la, 'Microsoft', 'WinGet', 'Links'), path.join(home, '.bun', 'bin'), path.join(home, 'scoop', 'shims'));
  } else {
    if (shellPath === null) {
      shellPath = '';
      try { const sh = process.env.SHELL || '/bin/zsh'; shellPath = execFileSync(sh, ['-ilc', 'printf %s "$PATH"'], { timeout: 4000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop(); } catch {}
    }
    extra.push(...(shellPath ? shellPath.split(':') : []), path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin'), path.join(home, '.volta', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin');
    try { const nvm = path.join(home, '.nvm', 'versions', 'node'); for (const v of fs.readdirSync(nvm).sort().reverse()) extra.push(path.join(nvm, v, 'bin')); } catch {}
  }
  const all = [...extra, ...(process.env.PATH || '').split(path.delimiter)].filter(Boolean);
  return [...new Set(all)].join(path.delimiter);
}
function which(name) {
  const exts = IS_WIN ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of searchPath().split(path.delimiter)) for (const e of exts) { const p = path.join(dir, name + e); try { if (fs.statSync(p).isFile()) return p; } catch {} }
  return null;
}
const cache = {};
function cli(name) {
  if (cache[name] && Date.now() - cache[name].t < 60000) return cache[name].v;
  const env = name === 'claude' ? process.env.CADENCE_CLAUDE : name === 'codex' ? process.env.CADENCE_CODEX : null;
  const p = env ? (fs.existsSync(env) ? env : null) : which(name);
  let version = null;
  if (p) { try { version = execFileSync(p, ['--version'], { timeout: 8000, encoding: 'utf8', env: { ...process.env, PATH: searchPath() }, shell: IS_WIN && /\.(cmd|bat)$/i.test(p), stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0]; } catch {} }
  const v = p ? { path: p, version } : null;
  cache[name] = { t: Date.now(), v }; return v;
}

function run(bin, args, { input, cwd, timeout = 300, signal, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const q = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
    const useShell = IS_WIN && /\.(cmd|bat)$/i.test(bin);
    const child = spawn(useShell ? q(bin) : bin, useShell ? args.map(q) : args, { cwd: cwd || os.homedir(), env: { ...process.env, PATH: searchPath(), NO_COLOR: '1', CI: '1' }, shell: useShell, windowsHide: true });
    let out = '', err = '', done = false, buf = '';
    const kill = () => { try { if (IS_WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); else child.kill('SIGTERM'); } catch {} };
    const timer = setTimeout(() => { if (!done) { kill(); finish(new Error(`No answer after ${timeout} seconds`)); } }, timeout * 1000);
    const onAbort = () => { kill(); finish(new Error('Cancelled')); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    function finish(e, v) { if (done) return; done = true; clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); e ? reject(e) : resolve(v); }
    child.stdout.on('data', (d) => { out += d; if (onLine) { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) onLine(l); } } });
    child.stderr.on('data', (d) => { err += d; if (err.length > 200000) err = err.slice(-100000); });
    child.on('error', (e) => finish(new Error(`Couldn’t start ${path.basename(bin)}: ${e.message}`)));
    child.on('close', (code) => { if (code === 0) finish(null, { out, err }); else finish(new Error((err || out).trim().split('\n').slice(-6).join(' ').slice(0, 600) || `${path.basename(bin)} stopped (exit ${code})`)); });
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

// ───────── attachments → text / files the AI can read
function prepareAttachments(list, dir) {
  const parts = []; const files = [];
  let n = 0;
  for (const a of list || []) {
    if (a == null || a === '') continue;
    n++;
    if (T.isTable(a) || (a && T.isTable(a.table))) {
      const t = T.asTable(a); const csv = T.toCSV(t);
      const f = path.join(dir, `data-${n}.csv`); fs.writeFileSync(f, csv); files.push(f);
      parts.push(`<data name="table ${n}" rows="${t.rows.length}" file="${f}">\n${csv.length > 60000 ? csv.slice(0, 60000) + '\n…(cut; full file at the path above)' : csv}</data>`);
    } else if (typeof a === 'string' && path.isAbsolute(a) && fs.existsSync(a)) {
      files.push(a);
      const textish = /\.(txt|md|csv|tsv|json|html?|xml|log|ya?ml)$/i.test(a) && fs.statSync(a).size < 200000;
      parts.push(textish ? `<file path="${a}">\n${fs.readFileSync(a, 'utf8')}\n</file>` : `<file path="${a}" />`);
    } else if (Array.isArray(a) && a.every((x) => typeof x === 'string' && path.isAbsolute(x))) {
      for (const f of a) if (fs.existsSync(f)) { files.push(f); parts.push(`<file path="${f}" />`); }
    } else if (a && typeof a === 'object' && (a.file || a.files)) {
      return prepareAttachments([...(a.files || [a.file])], dir);
    } else parts.push(`<input>\n${typeof a === 'string' ? a : JSON.stringify(a, null, 2)}\n</input>`);
  }
  return { text: parts.join('\n\n'), files };
}

function extractJSON(text) {
  let s = String(text || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s); if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch {}
  const i = s.search(/[[{]/); if (i < 0) throw new Error('The AI didn’t reply with JSON');
  const open = s[i], close = open === '{' ? '}' : ']';
  for (let j = s.lastIndexOf(close); j > i; j = s.lastIndexOf(close, j - 1)) { try { return JSON.parse(s.slice(i, j + 1)); } catch {} }
  throw new Error('The AI’s JSON couldn’t be read');
}

function available(secrets) {
  const has = (k) => { try { return !!(secrets && secrets.get(k)); } catch { return false; } };
  return { claude: cli('claude'), codex: cli('codex'), anthropic: has('ANTHROPIC_API_KEY'), openai: has('OPENAI_API_KEY') };
}
function pick(provider, secrets, { agent = false } = {}) {
  const av = available(secrets);
  if (provider && provider !== 'auto') {
    if ((provider === 'claude' || provider === 'codex') && !av[provider]) throw new Error(`${provider === 'claude' ? 'Claude Code' : 'Codex'} isn’t installed on this computer (or Cadence can’t find it). See Connections › AI.`);
    if ((provider === 'anthropic' || provider === 'openai') && !av[provider]) throw new Error(`Add ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} in Connections › Secrets first`);
    return provider;
  }
  if (av.claude) return 'claude';
  if (av.codex) return 'codex';
  if (!agent && av.anthropic) return 'anthropic';
  if (!agent && av.openai) return 'openai';
  throw new Error(agent ? 'An agent task needs Claude Code or Codex installed. See Connections › AI.' : 'No AI is set up. Install Claude Code or Codex, or add an API key in Connections › AI.');
}

async function ask({ provider = 'auto', prompt, attach = [], json = false, shape = '', model = '', timeout = 300, signal, dir, secrets, log = () => {} }) {
  const who = pick(provider, secrets);
  fs.mkdirSync(dir, { recursive: true });
  const att = prepareAttachments(attach, dir);
  const wantJson = json ? `\n\nReply with only valid JSON${shape ? ' in this shape:\n' + shape : ''}. No prose, no code fences.` : '';
  const full = `${prompt}${att.text ? `\n\n${att.text}` : ''}${wantJson}`;
  log(`Asking ${{ claude: 'Claude', codex: 'Codex', anthropic: 'Claude (API)', openai: 'OpenAI (API)' }[who]}${model ? ' · ' + model : ''}…`);
  let text;
  if (who === 'claude') {
    const c = cli('claude');
    const args = ['-p', '--output-format', 'text', '--allowedTools', 'Read,Glob,Grep'];
    const dirs = [...new Set([dir, ...att.files.map((f) => path.dirname(f))])];
    for (const d of dirs) args.push('--add-dir', d);
    if (model) args.push('--model', model);
    text = (await run(c.path, args, { input: full, cwd: dir, timeout, signal })).out;
  } else if (who === 'codex') {
    const c = cli('codex');
    const outFile = path.join(dir, `codex-answer-${Date.now()}.txt`);
    const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', dir, '--output-last-message', outFile];
    if (model) args.push('-m', model);
    args.push('-');
    const r = await run(c.path, args, { input: full, cwd: dir, timeout, signal });
    text = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : r.out;
  } else if (who === 'anthropic') {
    const res = await fetchJSON('https://api.anthropic.com/v1/messages', { 'x-api-key': secrets.get('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
      { model: model || 'claude-sonnet-5-5', max_tokens: 8000, messages: [{ role: 'user', content: full }] }, timeout, signal);
    text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  } else {
    const res = await fetchJSON('https://api.openai.com/v1/responses', { Authorization: 'Bearer ' + secrets.get('OPENAI_API_KEY') }, { model: model || 'gpt-5', input: full }, timeout, signal);
    text = res.output_text || (res.output || []).flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
  }
  text = String(text || '').trim();
  if (!text) throw new Error('The AI answered with nothing');
  return { text, json: json ? extractJSON(text) : null, provider: who };
}

async function fetchJSON(url, headers, body, timeout, signal) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout * 1000);
  const onAbort = () => ctl.abort(); if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ? (j.error.message || JSON.stringify(j.error)) : `HTTP ${r.status}`);
    return j;
  } catch (e) { if (e.name === 'AbortError') throw new Error(signal && signal.aborted ? 'Cancelled' : 'The AI took too long'); throw e; }
  finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); }
}

function snapshotDir(dir, max = 20000) {
  const m = new Map(); const st = [dir];
  while (st.length && m.size < max) { const d = st.pop(); let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; } for (const e of es) { if (e.name.startsWith('.') || e.name === 'node_modules') continue; const p = path.join(d, e.name); if (e.isDirectory()) st.push(p); else { try { m.set(p, fs.statSync(p).mtimeMs); } catch {} } } }
  return m;
}

async function agent({ provider = 'auto', folder, task, allowEdits = true, allowCommands = false, timeout = 900, signal, secrets, log = () => {} }) {
  const who = pick(provider, secrets, { agent: true });
  fs.mkdirSync(folder, { recursive: true });
  const before = snapshotDir(folder);
  log(`${who === 'claude' ? 'Claude Code' : 'Codex'} is working in ${folder}…`);
  let text;
  if (who === 'claude') {
    const tools = ['Read', 'Glob', 'Grep', ...(allowEdits ? ['Write', 'Edit', 'MultiEdit'] : []), ...(allowCommands ? ['Bash'] : [])];
    const args = ['-p', '--output-format', 'text', '--allowedTools', tools.join(','), '--permission-mode', allowEdits ? 'acceptEdits' : 'default'];
    text = (await run(cli('claude').path, args, { input: task, cwd: folder, timeout, signal })).out;
  } else {
    const outFile = path.join(os.tmpdir(), `cadence-codex-${Date.now()}.txt`);
    const args = ['exec', '--skip-git-repo-check', '-C', folder, '--sandbox', allowEdits ? 'workspace-write' : 'read-only', '--output-last-message', outFile, '-'];
    const r = await run(cli('codex').path, args, { input: task + (allowCommands ? '' : '\n\nDon’t run shell commands other than to read files.'), cwd: folder, timeout, signal });
    text = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : r.out; try { fs.unlinkSync(outFile); } catch {}
  }
  const after = snapshotDir(folder);
  const changed = [...after.entries()].filter(([p, t]) => !before.has(p) || before.get(p) !== t).map(([p]) => p);
  const added = changed.filter((p) => !before.has(p));
  log(`${changed.length} file${changed.length === 1 ? '' : 's'} made or changed`);
  return { text: String(text || '').trim(), files: changed, file: added[0] || changed[0] || '', provider: who };
}

module.exports = { ask, agent, available, cli, which, searchPath, extractJSON, prepareAttachments, run };
