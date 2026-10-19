// Onward — local bridge. The MCP server (started by Claude) talks to the app through this:
// 127.0.0.1 only, random port, private token in <userData>/bridge.json (readable only by this user).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

let server = null, token = null, port = null;
let lastHello = 0, clientName = 'Claude';
let handler = async () => ({ content: [{ type: 'text', text: 'Onward is starting…' }], isError: true });
let onStatus = () => {};

const bridgeFile = () => path.join(app.getPath('userData'), 'bridge.json');

function start({ handle, status }) {
  handler = handle; onStatus = status || onStatus;
  token = crypto.randomBytes(24).toString('hex');
  server = http.createServer((req, res) => {
    const done = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method !== 'POST') return done(405, { error: 'POST only' });
    const auth = req.headers.authorization || '';
    const given = Buffer.from(auth.replace(/^Bearer /, ''));
    const want = Buffer.from(token);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return done(401, { error: 'bad token' });
    // Refuse browser-originated requests (a web page can't read the token, but be strict anyway)
    if (req.headers.origin) return done(403, { error: 'no browsers' });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 20e6) req.destroy(); });
    req.on('end', async () => {
      let msg = {};
      try { msg = JSON.parse(body || '{}'); } catch { return done(400, { error: 'bad json' }); }
      if (req.url === '/hello') { touch(msg.client); return done(200, { ok: true, app: 'Onward', version: app.getVersion() }); }
      if (req.url === '/call') {
        touch();
        try { done(200, await handler(msg.name, msg.args || {})); }
        catch (e) { done(200, { content: [{ type: 'text', text: 'Error: ' + (e.message || e) }], isError: true }); }
        return;
      }
      done(404, { error: 'not found' });
    });
  });
  server.listen(0, '127.0.0.1', () => {
    port = server.address().port;
    const f = bridgeFile();
    fs.writeFileSync(f, JSON.stringify({ port, token, pid: process.pid, version: app.getVersion() }), { mode: 0o600 });
    try { fs.chmodSync(f, 0o600); } catch {}
  });
  setInterval(() => onStatus(status()), 10000).unref();
}

function touch(client) {
  const was = connected();
  lastHello = Date.now();
  if (client) clientName = client;
  if (!was) onStatus(status());
}
const connected = () => Date.now() - lastHello < 40000;
const status = () => ({ running: !!port, connected: connected(), client: clientName, lastSeen: lastHello || null });

function stop() {
  try { server && server.close(); } catch {}
  try {
    const b = JSON.parse(fs.readFileSync(bridgeFile(), 'utf8'));
    if (b.pid === process.pid) fs.unlinkSync(bridgeFile());
  } catch {}
}

module.exports = { start, stop, status, bridgeFile };
