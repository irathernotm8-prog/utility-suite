// Atrium — Node checks (no network, no Electron): npm test
'use strict';
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');
const root = path.join(__dirname, '..');
const R = (m) => require(path.join(root, m));
let n = 0; const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('content library is valid', () => { require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'content-check.js')], { stdio: 'pipe' }); });
t('CSS scoping', () => {
  const { scopeCss, checkCss } = R('src/core/scope');
  const out = scopeCss('& { a: 1 } .x, &.on .y { b: 2 } @media (max-width: 600px) { & .z { c: 3 } } @keyframes k { from { opacity: 0 } } html { d: 4 }', '[data-s="s1"]');
  assert(out.includes('[data-s="s1"]{a: 1}')); assert(out.includes('[data-s="s1"] .x,[data-s="s1"].on .y{b: 2}')); assert(out.includes('@media (max-width: 600px){[data-s="s1"] .z{c: 3}}')); assert(out.includes('@keyframes k{ from { opacity: 0 } }')); assert(out.includes('html{d: 4}'));
  assert.strictEqual(scopeCss('body { x: 1 } :root { y: 2 }', '.w', true), '.w{x: 1}\n.w{y: 2}');
  assert(checkCss('a { b: 1 ')); assert(!checkCss('a { content: "}" }'));
});
t('markdown', () => { const { markdown } = R('src/core/markdown'); const h = markdown('# Hi\n\nSome **bold** and `code` [link](https://x.y)\n\n- a\n- b\n\n| a | b |\n|---|---|\n| 1 | 2 |'); assert(h.includes('<h1 id="hi">Hi</h1>') && h.includes('<strong>bold</strong>') && h.includes('<ul><li>a</li><li>b</li></ul>') && h.includes('<td>1</td>') && h.includes('target="_blank"')); });
t('zip round trip', () => { const { makeZip, readZip } = R('src/core/zip'); const z = makeZip([{ name: 'a.txt', data: 'hello '.repeat(50) }, { name: 'b/c.bin', data: Buffer.from([1, 2, 3]) }]); const r = readZip(z); assert.strictEqual(r[0].data.toString(), 'hello '.repeat(50)); assert.deepStrictEqual([...r[1].data], [1, 2, 3]); });
t('section structure check', () => { const { rootCount } = R('src/mcp-handlers'); assert.strictEqual(rootCount('<section><div><img src=x><br></div></section>').roots, 1); assert.strictEqual(rootCount('<div></div><div></div>').roots, 2); assert(rootCount('text<section></section>').text); });
t('theme maths', () => { const T = R('src/core/theme'); assert(T.contrast('#000000', '#ffffff') > 20); const p = T.paletteFrom('#3366ff', 'dark'); assert(T.contrast(p.text, p.bg) > 7); assert(T.themeVars(T.presetTheme('paper')).includes('--at-primary')); });

let site, lib;
t('sites: every template, edits, undo, versions', () => {
  const { Library } = R('src/core/site'); lib = new Library(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-t-')));
  for (const tp of R('src/core/templates').TEMPLATES) lib.create({ name: 'T ' + tp.id, template: tp.id });
  site = lib.get('T saas');
  const p = site.addPage({ title: 'Careers', sections: [{ type: 'hero-split' }] }, 'Claude'); assert.strictEqual(p.slug, 'careers');
  const s = site.addSection('careers', { type: 'faq-accordion' }, 'start'); assert.strictEqual(site.page('careers').sections[0].id, s.id);
  site.replaceInSection(s.id, 'FAQ', 'Questions', true); site.undo(); assert(!site.find(s.id).section.html.includes('Questions') || site.find(s.id).section.html.includes('FAQ'));
  site.updatePage('careers', { slug: 'jobs' }); assert(site.page('jobs'));
  site.setTheme({ preset: 'gold-leaf' }); assert.strictEqual(site.data.theme.preset, 'gold-leaf');
  site.upsertPost({ title: 'Hello world', body: '# Hi' }); assert(site.post('hello-world'));
  assert(site.versions().length >= 2);
});
t('render: placeholders, icons, scoping, SEO', () => {
  const Rn = R('src/core/render'); const html = Rn.renderPage(site, site.page('index'), Rn.withDefaults({ mode: 'export' }));
  assert(/<nav[^>]*data-at-nav[^>]*><a href="index.html" aria-current="page">/.test(html)); assert(html.includes('<svg viewBox="0 0 24 24"')); assert(html.includes('data-s="')); assert(html.includes('<meta name="description"'));
  assert(!/data-icon="[\w-]+"[^>]*><\/i>/.test(html), 'icons expanded');
  const css = Rn.siteCss(site, {}); assert(css.includes('[data-s="')); assert(!/(^|\n)\s*&/.test(css));
  site.setSettings({ analytics: { ga4: 'G-TEST1' } }); assert(Rn.renderPage(site, site.page('index'), Rn.withDefaults({ mode: 'export' })).includes('G-TEST1')); assert(!Rn.renderPage(site, site.page('index'), Rn.withDefaults({ mode: 'preview' })).includes('G-TEST1'));
});
t('exports: every format for every template', () => {
  const EX = R('src/core/exporters'); const { readZip } = R('src/core/zip');
  for (const s of lib.list()) {
    const st = lib.open(s.dir);
    for (const f of ['static', 'single', 'embed', 'weebly', 'wordpress', 'backup']) { const r = EX.exportSite(st, f); assert(fs.existsSync(r.path), f); }
    const files = EX.staticFiles(st); const names = new Set(files.map((x) => x.name));
    for (const f of files.filter((x) => x.name.endsWith('.html'))) for (const m of String(f.data).matchAll(/href="([^"#?]+\.html)/g)) { const target = f.name.startsWith('blog/') && !m[1].startsWith('blog/') && !/^(\.\.\/)/.test(m[1]) ? m[1] : m[1]; assert(names.has(target.replace(/^\.\.\//, '')), `${s.name}: ${f.name} links to missing ${m[1]}`); }
    for (const f of files.filter((x) => x.name.endsWith('.html'))) for (const m of String(f.data).matchAll(/src="(assets\/[^"]+)"/g)) assert(names.has(m[1]), `${s.name}: missing asset ${m[1]}`);
    const wp = EX.wordpressFiles(st); const fn = wp.files.find((x) => x.name.endsWith('functions.php')).data; assert(fn.includes('atrium_setup') && fn.includes("add_filter('render_block'"));
    assert(!wp.files.some((x) => /\.html$/.test(x.name) && /href="[a-z0-9-]+\.html"/.test(String(x.data))), 'WP links all tokenised');
    const tj = JSON.parse(wp.files.find((x) => x.name.endsWith('theme.json')).data); assert.strictEqual(tj.version, 3);
    const emb = EX.embedFiles(st); const head = emb.find((x) => x.name === 'head-code.html').data; assert(!/(^|\})\s*(body|html|:root)\s*\{/.test(head), 'embed css never styles the host page');
    const bk = readZip(EX.backupFile(st)); assert(bk.some((x) => x.name === 'atrium.json'));
  }
});
t('MCP tool list is well-formed', () => { const { TOOLS } = R('mcp/tools'); assert(TOOLS.length > 30); const names = new Set(); for (const x of TOOLS) { assert(!names.has(x.name)); names.add(x.name); assert(x.inputSchema && x.inputSchema.type === 'object', x.name); assert(x.description.length > 20); } });
t('guide renders with the library', () => { const g = R('mcp/guide').guideText({ sections: R('src/core/sections').SECTIONS, presets: R('src/core/presets').PRESETS, icons: Object.keys(R('src/core/site-icons').ICONS) }); assert(g.includes('hero-split') && g.includes('midnight') && g.length > 4000); });

// the in-app agent loop against stand-in servers
function fakeServer(kind) {
  let step = 0; const seen = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { const j = JSON.parse(b); seen.push(j); step++; res.setHeader('Content-Type', 'application/json');
    if (kind === 'anthropic') res.end(JSON.stringify(step === 1 ? { content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 'tu1', name: 'screenshot', input: { page: 'index' } }], stop_reason: 'tool_use' } : { content: [{ type: 'text', text: 'All done.' }], stop_reason: 'end_turn', usage: {} }));
    else res.end(JSON.stringify(step === 1 ? { choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'screenshot', arguments: '{"page":"index"}' } }] } }] } : { choices: [{ message: { content: 'All done.' } }] }));
  }); });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}`, seen })));
}
const handle = async (name) => ({ content: [{ type: 'text', text: '{"ok":true}' }, { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }] });
t('agent loop: Anthropic', async () => { const { runTurn } = R('src/llm'); const f = await fakeServer('anthropic'); const h = []; const ev = []; const r = await runTurn({ provider: { id: 'anthropic', base: f.url }, key: 'k', model: 'm', system: 'sys', history: h, prompt: 'go', handle, onEvent: (e) => ev.push(e.kind) }); f.srv.close(); assert.strictEqual(r.text, 'All done.'); const tr = f.seen[1].messages[2].content[0]; assert.strictEqual(tr.type, 'tool_result'); assert(tr.content.some((c) => c.type === 'image')); assert(ev.includes('tool') && ev.includes('image')); });
t('agent loop: OpenAI-compatible', async () => { const { runTurn } = R('src/llm'); const f = await fakeServer('openai'); const h = []; const r = await runTurn({ provider: { id: 'openai', base: f.url }, key: 'k', model: 'm', system: 'sys', history: h, prompt: 'go', handle }); f.srv.close(); assert.strictEqual(r.text, 'All done.'); const msgs = f.seen[1].messages; assert(msgs.some((m) => m.role === 'tool' && m.tool_call_id === 'c1')); assert(msgs.some((m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((c) => c.type === 'image_url'))); });

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); n++; console.log('✓', name); } catch (e) { failed++; console.log('✗', name, '\n   ', e.message); } }
  console.log(`\n${n} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
