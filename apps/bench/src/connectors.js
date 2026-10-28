// Bench — the Claude / Codex plugin: installs Bench's MCP server into the Claude app, Claude Code and Codex, and
// runs the local bridge the MCP server talks to (127.0.0.1, random port, private token in the app-data folder).
// (Same design as Cadence's plugin.)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { app } = require('electron');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
let server = null, token = null, port = null, lastHello = 0, clientName = '', clients = {};

const bridgeFile = () => path.join(app.getPath('userData'), 'bridge.json');
const mcpDir = () => path.join(app.getPath('userData'), 'mcp');

function startBridge(handle, onStatus = () => {}) {
  token = crypto.randomBytes(24).toString('hex');
  server = http.createServer((req, res) => {
    const done = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method !== 'POST') return done(405, { error: 'POST only' });
    if (req.headers.origin) return done(403, { error: 'no browsers' });
    const given = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, '')); const want = Buffer.from(token);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return done(401, { error: 'bad token' });
    let body = ''; req.on('data', (c) => { body += c; if (body.length > 20e6) req.destroy(); });
    req.on('end', async () => {
      let msg; try { msg = JSON.parse(body || '{}'); } catch { return done(400, { error: 'bad json' }); }
      const was = connected();
      lastHello = Date.now(); if (msg.client) { clientName = msg.client; clients[msg.client] = Date.now(); }
      if (!was) onStatus(status());
      if (req.url === '/hello') return done(200, { ok: true, app: 'Bench', version: app.getVersion() });
      if (req.url === '/call') { try { done(200, await handle(msg.name, msg.args || {}, msg.client || clientName)); } catch (e) { done(200, { content: [{ type: 'text', text: 'Error: ' + (e.message || e) }], isError: true }); } return; }
      done(404, { error: 'not found' });
    });
  });
  server.requestTimeout = 0; server.headersTimeout = 60000;
  server.listen(0, '127.0.0.1', () => {
    port = server.address().port;
    fs.writeFileSync(bridgeFile(), JSON.stringify({ port, token, pid: process.pid, version: app.getVersion() }), { mode: 0o600 });
    try { fs.chmodSync(bridgeFile(), 0o600); } catch {}
  });
  setInterval(() => onStatus(status()), 15000).unref();
}
function stopBridge() { try { server && server.close(); } catch {} try { const b = JSON.parse(fs.readFileSync(bridgeFile(), 'utf8')); if (b.pid === process.pid) fs.unlinkSync(bridgeFile()); } catch {} }
const connected = () => Date.now() - lastHello < 45000;
const pretty = (n) => (/codex/i.test(n) ? 'Codex' : /claude[-_ ]?code/i.test(n) ? 'Claude Code' : n ? 'Claude' : '');
const status = () => ({ running: !!port, connected: connected(), client: pretty(clientName), lastSeen: lastHello || null, clients });

// ───────── finding the Claude Code / Codex command-line tools
function which(name) {
  const exts = IS_WIN ? ['.cmd', '.exe', '.bat', ''] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).concat(IS_WIN ? [] : [path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin']);
  for (const d of dirs) for (const e of exts) { const p = path.join(d, name + e); try { if (fs.statSync(p).isFile()) return p; } catch {} }
  return null;
}
const runCli = (bin, args, timeout = 30000) => new Promise((res, rej) => execFile(bin, args, { timeout, windowsHide: true, shell: IS_WIN && /\.(cmd|bat)$/i.test(bin) }, (e, out, err) => (e ? rej(new Error((err || e.message).toString().trim().split('\n').pop())) : res(out))));

// ───────── install the MCP script where the AI apps can always find it (outside the app bundle, survives updates)
function installScript() {
  fs.mkdirSync(mcpDir(), { recursive: true });
  for (const f of ['bench-mcp.js', 'tools.js']) {
    let src = path.join(__dirname, '..', 'mcp', f);
    const unpacked = src.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    if (fs.existsSync(unpacked)) src = unpacked;
    fs.copyFileSync(src, path.join(mcpDir(), f));
  }
}
function entry() {
  const launch = app.isPackaged ? [process.execPath, '--hidden'] : [process.execPath, app.getAppPath(), '--hidden'];
  return { command: process.execPath, args: [path.join(mcpDir(), 'bench-mcp.js')], env: { ELECTRON_RUN_AS_NODE: '1', BENCH_BRIDGE: bridgeFile(), BENCH_LAUNCH: JSON.stringify(launch) } };
}
const claudeDesktopConfig = () => (IS_MAC ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json') : path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json'));
const claudeCodeConfig = () => path.join(os.homedir(), '.claude.json');
const codexConfig = () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`;

function connectorStatus() {
  const e = entry();
  const readJsonEntry = (p) => { try { const c = JSON.parse(fs.readFileSync(p, 'utf8')); const x = c.mcpServers && c.mcpServers.bench; return { added: !!x, current: !!x && x.args && x.args[0] === e.args[0] }; } catch { return { added: false, current: false }; } };
  const desk = readJsonEntry(claudeDesktopConfig());
  const code = readJsonEntry(claudeCodeConfig());
  const codex = (() => { try { const t = fs.readFileSync(codexConfig(), 'utf8'); const added = /^\s*\[mcp_servers\.("bench"|bench)\]/m.test(t); return { added, current: added && t.includes(JSON.stringify(e.args[0])) }; } catch { return { added: false, current: false }; } })();
  const claudeCli = which('claude'); const codexCli = which('codex');
  return {
    bridge: status(),
    desktop: { ...desk, installed: fs.existsSync(path.dirname(claudeDesktopConfig())), path: claudeDesktopConfig() },
    code: { ...code, installed: !!claudeCli, cmd: `claude mcp add bench --scope user ${Object.entries(e.env).map(([k, v]) => `-e ${k}=${q(v)}`).join(' ')} -- ${q(e.command)} ${q(e.args[0])}` },
    codex: { ...codex, installed: !!codexCli || fs.existsSync(path.dirname(codexConfig())), path: codexConfig(), cmd: `codex mcp add bench ${Object.entries(e.env).map(([k, v]) => `--env ${k}=${q(v)}`).join(' ')} -- ${q(e.command)} ${q(e.args[0])}` },
    entry: e,
  };
}

function backup(p) { if (fs.existsSync(p)) fs.copyFileSync(p, p + '.bench-backup'); }
function connectDesktop() {
  installScript();
  const p = claudeDesktopConfig(); let cfg = {};
  if (fs.existsSync(p)) { const raw = fs.readFileSync(p, 'utf8'); try { cfg = raw.trim() ? JSON.parse(raw) : {}; } catch { throw new Error('Claude’s settings file has a formatting problem, so Bench left it alone: ' + p); } backup(p); } else fs.mkdirSync(path.dirname(p), { recursive: true });
  cfg.mcpServers = { ...(cfg.mcpServers || {}), bench: entry() };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return connectorStatus();
}
// Claude Code keeps user-scope MCP servers in ~/.claude.json. Use its own CLI when installed, else edit the file.
async function connectCode() {
  installScript();
  const e = entry(); const c = which('claude');
  if (c) {
    try { await runCli(c, ['mcp', 'remove', 'bench', '--scope', 'user']); } catch {}
    const args = ['mcp', 'add', 'bench', '--scope', 'user']; for (const [k, v] of Object.entries(e.env)) args.push('-e', `${k}=${v}`); args.push('--', e.command, ...e.args);
    await runCli(c, args);
    return connectorStatus();
  }
  const p = claudeCodeConfig(); let cfg = {};
  if (fs.existsSync(p)) { try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { throw new Error('~/.claude.json has a formatting problem, so Bench left it alone'); } backup(p); }
  cfg.mcpServers = { ...(cfg.mcpServers || {}), bench: { type: 'stdio', ...e } };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return connectorStatus();
}
// Codex (CLI, IDE extension and the Codex app) reads ~/.codex/config.toml
function connectCodex() {
  installScript();
  const p = codexConfig(); let raw = '';
  if (fs.existsSync(p)) { raw = fs.readFileSync(p, 'utf8'); backup(p); } else fs.mkdirSync(path.dirname(p), { recursive: true });
  const out = []; let skip = false;
  for (const line of raw.split(/\r?\n/)) { const h = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line); if (h) skip = /^mcp_servers\.("bench"|bench)(\.|$)/.test(h[1].replace(/\s+/g, '')); if (!skip) out.push(line); }
  const e = entry(); const s = (v) => JSON.stringify(v);
  const block = ['', '# Bench — test workspace (added by Bench)', '[mcp_servers.bench]', `command = ${s(e.command)}`, `args = [${e.args.map(s).join(', ')}]`, 'startup_timeout_sec = 30', 'tool_timeout_sec = 3600', '', '[mcp_servers.bench.env]', ...Object.entries(e.env).map(([k, v]) => `${k} = ${s(v)}`), ''];
  fs.writeFileSync(p, out.join('\n').trimEnd() + '\n' + block.join('\n'));
  return connectorStatus();
}
function disconnect(which) {
  if (which === 'desktop' || which === 'code') {
    const p = which === 'desktop' ? claudeDesktopConfig() : claudeCodeConfig();
    try { const cfg = JSON.parse(fs.readFileSync(p, 'utf8')); if (cfg.mcpServers && cfg.mcpServers.bench) { backup(p); delete cfg.mcpServers.bench; fs.writeFileSync(p, JSON.stringify(cfg, null, 2)); } } catch {}
  } else if (which === 'codex') {
    const p = codexConfig(); try { const raw = fs.readFileSync(p, 'utf8'); backup(p); const out = []; let skip = false; for (const line of raw.split(/\r?\n/)) { const h = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line); if (h) skip = /^mcp_servers\.("bench"|bench)(\.|$)/.test(h[1].replace(/\s+/g, '')); if (!skip && !/^# Bench — test workspace/.test(line)) out.push(line); } fs.writeFileSync(p, out.join('\n')); } catch {}
  }
  return connectorStatus();
}
function refreshInstalled() { try { const st = connectorStatus(); if (st.desktop.added || st.code.added || st.codex.added) installScript(); } catch {} }

module.exports = { startBridge, stopBridge, status, connectorStatus, connectDesktop, connectCode, connectCodex, disconnect, refreshInstalled, installScript, bridgeFile };
