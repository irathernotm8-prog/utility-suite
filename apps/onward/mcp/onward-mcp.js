#!/usr/bin/env node
// Onward — MCP server (stdio). Claude starts this; it forwards tool calls to the running Onward app
// over a private local bridge (127.0.0.1 + a token Onward writes to its app-data folder).
// No dependencies, no API key: Claude uses the user's own Claude account.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFile } = require('child_process');
const { TOOLS, INSTRUCTIONS } = require('./tools');

const VERSION = '0.2.0';
const log = (...a) => process.stderr.write('[onward-mcp] ' + a.join(' ') + '\n');

function defaultBridgePath() {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Onward', 'bridge.json');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Onward', 'bridge.json');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Onward', 'bridge.json');
}
const BRIDGE = process.env.ONWARD_BRIDGE || defaultBridgePath();

function readBridge() {
  try {
    const b = JSON.parse(fs.readFileSync(BRIDGE, 'utf8'));
    if (!b.port || !b.token) return null;
    if (b.pid) { try { process.kill(b.pid, 0); } catch (e) { if (e.code === 'ESRCH') return null; } }
    return b;
  } catch { return null; }
}

// Start Onward if it isn't running (in the background), then wait for its bridge
let launching = null;
async function ensureApp() {
  let b = readBridge();
  if (b) return b;
  if (!launching) launching = (async () => {
    try {
      const cmd = process.env.ONWARD_LAUNCH ? JSON.parse(process.env.ONWARD_LAUNCH) : null;
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      if (cmd && cmd.length) spawn(cmd[0], cmd.slice(1), { detached: true, stdio: 'ignore', env }).unref();
      else if (process.platform === 'darwin') execFile('open', ['-g', '-a', 'Onward']);
    } catch (e) { log('launch failed', e.message); }
    for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 500)); const x = readBridge(); if (x) return x; }
    return null;
  })().finally(() => { setTimeout(() => { launching = null; }, 1000); });
  return launching;
}

function request(b, route, body, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request({ host: '127.0.0.1', port: b.port, path: route, method: 'POST', timeout,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Authorization: 'Bearer ' + b.token } }, (res) => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', c => s += c);
      res.on('end', () => {
        if (res.statusCode === 401) return reject(new Error('Onward refused the connection (token changed). Restart Claude or Onward.'));
        try { resolve(JSON.parse(s)); } catch { reject(new Error('Bad reply from Onward: ' + s.slice(0, 200))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Onward took too long to answer')));
    req.on('error', reject);
    req.end(data);
  });
}

async function callTool(name, args) {
  const b = await ensureApp();
  if (!b) return { content: [{ type: 'text', text: 'Onward isn\'t running and couldn\'t be started. Ask the user to open the Onward app, then try again.' }], isError: true };
  try {
    return await request(b, '/call', { name, args: args || {} });
  } catch (e) {
    return { content: [{ type: 'text', text: 'Couldn\'t reach Onward: ' + e.message }], isError: true };
  }
}

// Let the app show "Claude connected" while this process is alive
let clientName = 'Claude';
async function hello() { const b = readBridge(); if (b) { try { await request(b, '/hello', { client: clientName, pid: process.pid }, 4000); } catch {} } }
setInterval(hello, 15000).unref();

// ---------- JSON-RPC over stdio (newline-delimited) ----------
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    switch (method) {
      case 'initialize': {
        clientName = params?.clientInfo?.name || 'Claude';
        hello();
        return reply(id, {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'onward', title: 'Onward', version: VERSION },
          instructions: INSTRUCTIONS
        });
      }
      case 'notifications/initialized': case 'notifications/cancelled': return;
      case 'ping': return reply(id, {});
      case 'tools/list': return reply(id, { tools: TOOLS });
      case 'tools/call': {
        const name = params?.name;
        if (!TOOLS.some(t => t.name === name)) return fail(id, -32602, 'Unknown tool: ' + name);
        return reply(id, await callTool(name, params.arguments));
      }
      case 'resources/list': return reply(id, { resources: [] });
      case 'prompts/list': return reply(id, { prompts: [] });
      default: if (isRequest) return fail(id, -32601, 'Method not found: ' + method);
    }
  } catch (e) {
    if (isRequest) fail(id, -32603, e.message || String(e));
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    if (Array.isArray(msg)) msg.forEach(handle); else handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
log('ready, bridge at', BRIDGE);
