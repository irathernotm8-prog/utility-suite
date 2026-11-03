// RO2 — finding Claude Code and Codex on this computer, and running them with RO2's plugin attached for the
// in-app "Ask Claude" box. Uses the person's own sign-in; prompts go in on stdin.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
let shellPath = null;
function searchPath() {
  const extra = []; const home = os.homedir();
  if (IS_WIN) {
    const ad = process.env.APPDATA || path.join(home, 'AppData', 'Roaming'); const la = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    extra.push(path.join(home, '.local', 'bin'), path.join(ad, 'npm'), path.join(la, 'Programs', 'claude'), path.join(la, 'Microsoft', 'WinGet', 'Links'), path.join(home, '.bun', 'bin'), path.join(home, 'scoop', 'shims'));
  } else {
    if (shellPath === null) { shellPath = ''; try { const sh = process.env.SHELL || '/bin/zsh'; shellPath = execFileSync(sh, ['-ilc', 'printf %s "$PATH"'], { timeout: 4000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop(); } catch {} }
    extra.push(...(shellPath ? shellPath.split(':') : []), path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin'), path.join(home, '.volta', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin');
    try { const nvm = path.join(home, '.nvm', 'versions', 'node'); for (const v of fs.readdirSync(nvm).sort().reverse()) extra.push(path.join(nvm, v, 'bin')); } catch {}
  }
  return [...new Set([...extra, ...(process.env.PATH || '').split(path.delimiter)].filter(Boolean))].join(path.delimiter);
}
function which(name) { const exts = IS_WIN ? ['.exe', '.cmd', '.bat', ''] : ['']; for (const dir of searchPath().split(path.delimiter)) for (const e of exts) { const p = path.join(dir, name + e); try { if (fs.statSync(p).isFile()) return p; } catch {} } return null; }
const cache = {};
function cli(name) {
  if (cache[name] && Date.now() - cache[name].t < 60000) return cache[name].v;
  const env = name === 'claude' ? process.env.RO2_CLAUDE : name === 'codex' ? process.env.RO2_CODEX : null;
  const p = env ? (fs.existsSync(env) ? env : null) : which(name); let version = null;
  if (p) { try { version = execFileSync(p, ['--version'], { timeout: 8000, encoding: 'utf8', env: { ...process.env, PATH: searchPath() }, shell: IS_WIN && /\.(cmd|bat)$/i.test(p), stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0]; } catch {} }
  const v = p ? { path: p, version } : null; cache[name] = { t: Date.now(), v }; return v;
}
function run(bin, args, { input, cwd, timeout = 900, signal, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const q = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a); const useShell = IS_WIN && /\.(cmd|bat)$/i.test(bin);
    const child = spawn(useShell ? q(bin) : bin, useShell ? args.map(q) : args, { cwd: cwd || os.homedir(), env: { ...process.env, PATH: searchPath(), NO_COLOR: '1', CI: '1' }, shell: useShell, windowsHide: true });
    let out = '', err = '', done = false, buf = '';
    const kill = () => { try { if (IS_WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); else child.kill('SIGTERM'); } catch {} };
    const timer = setTimeout(() => { if (!done) { kill(); finish(new Error(`No answer after ${timeout} seconds`)); } }, timeout * 1000);
    const onAbort = () => { kill(); finish(new Error('Stopped')); }; if (signal) signal.addEventListener('abort', onAbort, { once: true });
    function finish(e, v) { if (done) return; done = true; clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); e ? reject(e) : resolve(v); }
    child.stdout.on('data', (d) => { out += d; if (onLine) { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) onLine(l); } } });
    child.stderr.on('data', (d) => { err += d; if (err.length > 200000) err = err.slice(-100000); });
    child.on('error', (e) => finish(new Error(`Couldn’t start ${path.basename(bin)}: ${e.message}`)));
    child.on('close', (code) => { if (code === 0) finish(null, { out, err }); else finish(new Error((err || out).trim().split('\n').slice(-6).join(' ').slice(0, 600) || `${path.basename(bin)} stopped (exit ${code})`)); });
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

// "Ask Claude" from inside RO2: a headless Claude Code (or Codex) session with only RO2's tools, streamed.
async function askAgent({ prompt, entry, cwd, signal, onEvent = () => {}, provider = 'auto', resume = null }) {
  const claude = cli('claude'), codex = cli('codex');
  const who = provider === 'codex' ? (codex ? 'codex' : null) : provider === 'claude' ? (claude ? 'claude' : null) : claude ? 'claude' : codex ? 'codex' : null;
  if (!who) throw new Error('Install Claude Code (or Codex) to ask from inside RO2 — or talk to Claude in Claude Desktop / Claude Code with the RO2 plugin added.');
  fs.mkdirSync(cwd, { recursive: true });
  if (who === 'claude') {
    const cfg = path.join(cwd, 'ro2-mcp.json'); fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { ro2: { type: 'stdio', ...entry } } }));
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--mcp-config', cfg, '--strict-mcp-config', '--allowedTools', 'mcp__ro2'];
    if (resume) args.push('--resume', resume);
    let final = '', session = resume;
    await run(claude.path, args, { input: prompt, cwd, signal, timeout: 1800, onLine: (l) => {
      let m; try { m = JSON.parse(l); } catch { return; }
      if (m.type === 'assistant') for (const c of m.message?.content || []) { if (c.type === 'text' && c.text.trim()) onEvent({ kind: 'text', text: c.text }); if (c.type === 'tool_use') onEvent({ kind: 'tool', name: String(c.name).replace(/^mcp__ro2__/, '') }); }
      if (m.session_id) session = m.session_id;
      if (m.type === 'user') for (const c of m.message?.content || []) if (c.type === 'tool_result' && Array.isArray(c.content)) for (const b of c.content) if (b.type === 'image' && b.source && b.source.data) onEvent({ kind: 'image', data: b.source.data });
      if (m.type === 'result') final = m.result || final;
    } });
    return { who: 'Claude', text: final, session };
  }
  const outFile = path.join(cwd, `codex-${Date.now()}.txt`);
  const env = Object.entries(entry.env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(',');
  const args = ['exec', '--skip-git-repo-check', '-C', cwd, '-c', `mcp_servers.ro2.command=${JSON.stringify(entry.command)}`, '-c', `mcp_servers.ro2.args=${JSON.stringify(entry.args)}`, '-c', `mcp_servers.ro2.env={${env}}`, '--output-last-message', outFile, '-'];
  await run(codex.path, args, { input: prompt, cwd, signal, timeout: 1800, onLine: (l) => onEvent({ kind: 'text', text: l.slice(0, 300) }) });
  return { who: 'Codex', text: fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '' };
}

module.exports = { cli, run, which, searchPath, askAgent };
