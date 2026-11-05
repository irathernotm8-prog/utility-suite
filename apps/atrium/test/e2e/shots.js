// Atrium — end-to-end screenshots (Linux: xvfb-run node test/e2e/shots.js <outdir>). Seeds a site from a template,
// opens every screen, edits text through the overlay, runs the plugin bridge end to end and exports every format.
const { _electron: electron } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const OUT = process.argv[2] || '/tmp/atrium-shots'; fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-e2e-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await electron.launch({ executablePath: require(path.join(__dirname, '..', '..', 'node_modules', 'electron')), args: [path.join(__dirname, '..', '..'), '--no-sandbox'], env: { ...process.env, ATRIUM_E2E: '1', ATRIUM_USER_DATA: path.join(tmp, 'ud'), ATRIUM_SITES: path.join(tmp, 'sites') } });
  const errors = []; const win = await app.firstWindow();
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); win.on('pageerror', (e) => errors.push('PAGE ' + e.message));
  await win.setViewportSize({ width: 1500, height: 940 });
  let n = 0; const shot = async (name, ms = 900) => { await sleep(ms); await win.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) }); console.log('shot', name); };
  const theme = async (t) => { await win.evaluate((t) => { document.documentElement.dataset.theme = t; }, t); };
  await win.waitForSelector('body.ready'); await sleep(3500);
  await shot('builder-dark', 1500);
  // select a section in the preview
  const fr = win.frameLocator('#frame');
  await fr.locator('[data-s] h1').first().dispatchEvent('click'); await shot('selected-element');
  await fr.locator('[data-s] h1').first().dispatchEvent('dblclick'); await sleep(300); await win.keyboard.type('Ship analytics people trust'); await win.keyboard.press('Enter'); await shot('edited-text', 1800);
  // panels
  for (const p of ['add', 'theme', 'assets', 'blog', 'site', 'code', 'layers']) { await win.click(`#rail [data-panel=${p}]`); await shot('panel-' + p, p === 'add' ? 2500 : 700); }
  await win.click('#rail [data-panel=theme]'); await win.click('[data-preset="paper"]'); await shot('theme-paper', 2000);
  await win.click('#rail [data-panel=layers]');
  await win.click('[data-device=phone]'); await shot('phone', 1500);
  await win.click('[data-device=tablet]'); await shot('tablet', 1200);
  await win.click('[data-device=desktop]');
  await win.click('[data-rtab=ai]'); await shot('ai-tab');
  await win.click('[data-rtab=inspect]');
  // code editor
  await win.locator('.layer').nth(1).dblclick(); await shot('code-editor', 900); await win.keyboard.press('Escape');
  // sheets
  await win.click('#exportBtn'); await shot('export'); await win.click('.prov[data-f=wordpress]'); await win.click('.sheet [data-yes]'); await shot('export-done', 2500); await win.keyboard.press('Escape');
  await win.click('#exportBtn'); await win.click('.prov[data-f=pdf]'); await win.click('[data-pdev] [data-v=both]'); await shot('export-pdf-options', 500); await win.click('.sheet [data-yes]'); await win.waitForSelector('[data-openpdf]', { timeout: 120000 }); await shot('export-pdf-done', 300);
  const pdfPath = await win.evaluate(() => document.querySelector('.sheet code').textContent); console.log('pdf (ui)', pdfPath); fs.copyFileSync(pdfPath.replace(/^~/, os.homedir()), path.join(OUT, 'ui-review.pdf')); await win.keyboard.press('Escape');
  await win.click('#auditBtn'); await shot('audit', 14000); await win.keyboard.press('Escape');
  await win.click('#historyBtn'); await shot('history'); await win.keyboard.press('Escape');
  await win.click('#publishBtn'); await shot('publish'); await win.keyboard.press('Escape');
  await win.click('#phoneBtn'); await shot('phone-qr'); await win.keyboard.press('Escape');
  await win.click('#homeBtn'); await shot('home', 2500);
  await win.click('[data-new]'); await shot('new-site', 5000); await win.keyboard.press('Escape');
  await win.click('#settingsBtn'); await shot('settings'); await win.click('[data-prov=anthropic]'); await shot('settings-anthropic');
  await win.click('[data-back]');
  await theme('light'); await shot('builder-light', 1200);
  // plugin bridge end to end through the real MCP script
  const ud = path.join(tmp, 'ud');
  const { spawn } = require('child_process');
  const mcp = spawn(process.execPath, [path.join(__dirname, '..', '..', 'mcp', 'atrium-mcp.js')], { env: { ...process.env, ATRIUM_BRIDGE: path.join(ud, 'bridge.json') } });
  let buf = ''; const replies = {}; mcp.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); replies[m.id] = m; } catch {} } });
  const rpc = async (id, method, params) => { mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); for (let i = 0; i < 600 && !replies[id]; i++) await sleep(100); return replies[id]; };
  await rpc(1, 'initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'e2e' } });
  const tl = await rpc(2, 'tools/list', {}); console.log('mcp tools', tl.result.tools.length);
  const ctx = await rpc(3, 'tools/call', { name: 'site_context', arguments: {} }); console.log('site_context ok', !ctx.result.isError);
  const add = await rpc(4, 'tools/call', { name: 'add_section', arguments: { page: 'index', type: 'cta-gradient', position: 'start' } }); console.log('add_section', !add.result.isError, add.result.content.map((c) => c.type).join(','));
  const sc = await rpc(5, 'tools/call', { name: 'screenshot', arguments: { page: 'index', device: 'phone' } }); console.log('screenshot', sc.result.content.filter((c) => c.type === 'image').length, 'images');
  if (sc.result.content[1]) fs.writeFileSync(path.join(OUT, 'mcp-phone-shot.jpg'), Buffer.from(sc.result.content[1].data, 'base64'));
  const au = await rpc(6, 'tools/call', { name: 'audit', arguments: { page: 'index' } }); console.log('audit', au.result.content[0].text.slice(0, 200).replace(/\n/g, ' '));
  for (const f of ['static', 'wordpress', 'embed', 'weebly', 'single', 'backup']) { const r = await rpc(10 + f.length, 'tools/call', { name: 'export', arguments: { format: f } }); console.log('export', f, !r.result.isError); }
  const pr = await rpc(40, 'tools/call', { name: 'export', arguments: { format: 'pdf', device: 'phone', pages: ['index', 'pricing'] } }); console.log('export pdf (mcp)', !pr.result.isError, pr.result.content[0].text.slice(0, 160).replace(/\n/g, ' '));
  try { fs.copyFileSync(JSON.parse(pr.result.content[0].text).path, path.join(OUT, 'mcp-review.pdf')); } catch (e) { console.log('copy pdf failed', e.message); }
  mcp.kill();
  await shot('after-ai-add', 2500);
  console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
