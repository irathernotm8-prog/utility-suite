// The real plugin path: mural-mcp.js (as Claude runs it) -> bridge -> app. Creates, edits and previews a wallpaper.
const { spawn } = require('child_process'); const path = require('path'); const fs = require('fs');
module.exports = async ({ app }) => {
  await new Promise((r) => setTimeout(r, 2500));
  const bridge = path.join(app.getPath('userData'), 'bridge.json');
  const c = spawn(process.env.NODE_BIN || 'node', [path.join(__dirname, '..', '..', 'mcp', 'mural-mcp.js')], { env: { ...process.env, MURAL_BRIDGE: bridge, ELECTRON_RUN_AS_NODE: '' } });
  let buf = ''; const waiters = new Map();
  c.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); const w = waiters.get(m.id); if (w) w(m); } });
  let id = 0; const rpc = (method, params) => new Promise((res) => { const n = ++id; waiters.set(n, res); c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  const tool = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result;
  await rpc('initialize', { clientInfo: { name: 'bridge-test' } });
  const made = await tool('create_wallpaper', { name: 'Bridge test', type: 'shader', code: 'void mainImage(out vec4 o, in vec2 p){ vec2 u = p / iResolution.xy; o = vec4(u, 0.6 + 0.4 * sin(iTime), 1.0) * (0.6 + 0.4 * length(iPointer)); }' });
  const wid = JSON.parse(made.content[0].text).id; console.log('created', wid);
  const pv = await tool('preview', { id: wid, width: 640 });
  console.log('preview', pv.content[0].type, pv.content[0].data.length, pv.content[1].text);
  const ed = await tool('update_wallpaper', { id: 'Snowfall', ops: [{ op: 'set', layer: 'Snow', props: { count: 900 } }] });
  console.log('edit built-in', ed.content[0].text.replace(/\s+/g, ' ').slice(0, 160));
  const st = await tool('status', {}); console.log('status ok', /settings/.test(st.content[0].text));
  c.kill(); console.log(pv.content[0].type === 'image' && /user\//.test(ed.content[0].text) ? 'BRIDGE PASSED' : 'BRIDGE FAILED'); app.exit(0);
};
