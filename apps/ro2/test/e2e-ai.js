// RO2 0.4 end-to-end: AI design over the real MCP server (stdio → bridge → window), HTML layers (still and animated),
// the timeline, video clips, music, MP4 / WebM / GIF export, HTML → layers, and the in-app assistant against a
// stand-in OpenAI-compatible server. Run: E2E=test/e2e-ai.js E2E_OUT=test/e2e-ai-out bash test/e2e.sh
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os'); const http = require('http');
const { spawn, execFileSync } = require('child_process');
const OUT = process.env.RO2_E2E_OUT || path.join(__dirname, 'e2e-ai-out');
const FIX = path.join(__dirname, 'fixtures');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FFMPEG = require('ffmpeg-static'); const FFPROBE = require('ffprobe-static').path;
const probe = (f) => JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString());
const frameAt = (f, t) => execFileSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'scale=96:-2', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
const diff = (a, b) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]); return s / n; };

// the real MCP server, as Claude Desktop / Claude Code / Codex start it
function mcpClient(app) {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'ro2-mcp.js')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', RO2_BRIDGE: path.join(app.getPath('userData'), 'bridge.json') }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const waiting = new Map(); let id = 0; let stderr = '';
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const m = JSON.parse(line); if (m.id != null && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } });
  p.stderr.on('data', (d) => { stderr += d; });
  const rpc = (method, params) => new Promise((res, rej) => { const k = ++id; const t = setTimeout(() => rej(new Error('timeout ' + method + ' ' + stderr.slice(-300))), 10 * 60e3); waiting.set(k, (m) => { clearTimeout(t); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: k, method, params }) + '\n'); });
  return { rpc, call: (name, args = {}) => rpc('tools/call', { name, arguments: args }), close: () => p.kill(), stderr: () => stderr };
}

module.exports = async function drive({ win, app }) {
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const wc = win.webContents; let n = 0; const results = [];
  const log = (l) => { console.log(l); fs.appendFileSync(path.join(OUT, 'log.txt'), l + '\n'); };
  const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' · ' + extra : ''}`); };
  const errors = [];
  wc.on('console-message', (e) => { const level = e.level ?? e.params?.level; const msg = e.message ?? e.params?.message; if (level === 'error' || level === 3) errors.push(msg); });
  const js = (code) => wc.executeJavaScript(`(async () => { ${code} })()`);
  const shot = async (name) => { await sleep(300); const img = await wc.capturePage(); fs.writeFileSync(path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`), img.toPNG()); };
  const saveImg = (r, name) => { const im = (r.content || []).find((c) => c.type === 'image'); if (im) fs.writeFileSync(path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.jpg`), Buffer.from(im.data, 'base64')); return !!im; };
  const txt = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const E = 'window.__ro2.editor';
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ro2ai-'));
  let mcp;
  try {
    await sleep(2500);
    // fixtures: a short test video with a tone, and a music track
    const clip = path.join(work, 'clip.mp4'), music = path.join(work, 'music.m4a');
    execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
    execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-c:a', 'aac', music]);

    mcp = mcpClient(app);
    const init = await mcp.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e-claude', version: '1' } });
    check('MCP server starts and says hello', init && init.serverInfo && /ro2/i.test(init.serverInfo.name) && init.instructions, JSON.stringify(init.serverInfo));
    const tl = await mcp.rpc('tools/list', {});
    check('MCP lists RO2’s tools', tl.tools.length >= 30 && tl.tools.some((t) => t.name === 'add_html'), `${tl.tools.length} tools`);
    let r = await mcp.call('ro2_guide'); check('guide names the bundled fonts and shapes', /Poppins/.test(txt(r)) && /star/.test(txt(r)) && /data-duration/.test(txt(r)));
    r = await mcp.call('get_state'); check('get_state on Home: nothing open', /"open": null/.test(txt(r)), txt(r).slice(0, 80));
    r = await mcp.call('add_text', { text: 'x' }); check('a tool needing a design explains itself', r.isError && /No design is open/.test(txt(r)));

    // ── page 1: an animated HTML layer ──
    r = await mcp.call('new_design', { size: 'Instagram post', name: 'AI launch', background: '#0b1020' });
    check('new_design opens a 1080×1080 design', /1080×1080/.test(txt(r)) && (await js(`return ${E}.W === 1080 && window.__ro2.view === 'editor'`)));
    const anim = `<html data-duration="4"><style>
      .page{position:absolute;inset:0;background:linear-gradient(160deg,#0b1020,#1a2a6c);color:#fff;font-family:Poppins;display:grid;place-content:center;text-align:center}
      h1{font:800 120px/1 Poppins;margin:0;animation:rise 1.2s cubic-bezier(.2,.7,.2,1) both}
      p{font:500 40px Inter;margin:24px 0 0;opacity:.85;animation:rise 1.2s .6s both}
      .bar{position:absolute;left:0;bottom:0;height:24px;background:#46e6a2;animation:grow 4s linear both}
      @keyframes rise{from{opacity:0;transform:translateY(80px)}} @keyframes grow{from{width:0}to{width:100%}}
      #n{position:absolute;top:40px;right:60px;font:700 48px Inter;color:#46e6a2}
    </style><div class="page"><h1>Launch day</h1><p>Everything ships at 9am</p></div><div class="bar"></div><div id="n">0</div>
    <script>const t0=performance.now();(function f(){document.getElementById('n').textContent=Math.floor((performance.now()-t0)/100);requestAnimationFrame(f)})()</script></html>`;
    r = await mcp.call('add_html', { html: anim });
    const htmlId = (txt(r).match(/HTML layer (\w+)/) || [])[1];
    check('add_html makes an animated layer and returns a screenshot', htmlId && /animates: 4 s/.test(txt(r)) && saveImg(r, 'mcp-add-html'), txt(r).slice(0, 160));
    await shot('window-html-layer');
    const a0 = await mcp.call('screenshot', { t: 0.05 }); const a1 = await mcp.call('screenshot', { t: 3.9 });
    saveImg(a0, 'mcp-t0'); saveImg(a1, 'mcp-t39');
    check('screenshot {t} shows different moments', a0.content[1].data !== a1.content[1].data, `${a0.content[1].data.length} vs ${a1.content[1].data.length} b64`);
    r = await mcp.call('preview_animation', { frames: 6 }); check('preview_animation returns a contact sheet', saveImg(r, 'mcp-contact-sheet') && /Frames at/.test(txt(r)), txt(r).slice(0, 120));
    r = await mcp.call('update_html', { id: htmlId, find: 'Launch day', replace: 'Launch week' });
    check('update_html find & replace', !r.isError && (await js(`return ${E}.userObjects().find(o => o.ro2Html).ro2Html.html.includes('Launch week')`)));
    r = await mcp.call('read_html', { id: htmlId }); check('read_html returns the code', /Launch week/.test(txt(r)));
    r = await mcp.call('update_html', { id: htmlId, find: 'nope-not-there', replace: 'x' }); check('update_html with a missing find text says so', r.isError && /not in the code/.test(txt(r)));

    // ── page 2: still HTML, then editable layers + normal tools ──
    r = await mcp.call('add_page', { background: '#ffffff' }); check('add_page', /page 2 of 2/.test(txt(r)));
    const still = `<style>.c{position:absolute;inset:0;background:#fff7ec;font-family:Inter;padding:90px;box-sizing:border-box}
      h2{font:800 96px/1.05 Poppins;color:#1b1f23;margin:0 0 30px;letter-spacing:-0.02em}
      .tag{display:inline-block;background:#ff5757;color:#fff;font:700 34px Inter;padding:14px 26px;border-radius:40px}
      .card{position:absolute;right:90px;bottom:90px;width:380px;height:380px;border-radius:40px;background:#1b1f23}
      svg{position:absolute;left:90px;bottom:100px}</style>
      <div class="c"><h2>Three things<br>we learned</h2><span class="tag">New post</span><div class="card"></div>
      <svg width="140" height="140" viewBox="0 0 24 24" fill="none" stroke="#ff5757" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/></svg></div>`;
    r = await mcp.call('add_html', { html: still, look: false });
    const stillId = (txt(r).match(/HTML layer (\w+)/) || [])[1];
    check('a still HTML layer', stillId && /It is still/.test(txt(r)));
    r = await mcp.call('html_to_layers', { id: stillId, look: true });
    const lays = await js(`return ${E}.userObjects().map(o => ({ k: o.type, t: o.text, v: o.visible, f: o.fontFamily }))`);
    check('html_to_layers makes real text, shapes and an icon', lays.filter((l) => l.k === 'textbox').length >= 2 && lays.some((l) => l.k === 'rect') && lays.some((l) => l.v === false) && lays.some((l) => l.t && /Three things/.test(l.t) && l.f === 'Poppins'), JSON.stringify(lays).slice(0, 300));
    saveImg(r, 'mcp-html-to-layers'); await shot('window-html-to-layers');
    r = await mcp.call('add_text', { text: 'by the RO2 team', x: 90, y: 560, font: 'Inter', size: 36, weight: 600, color: '#ff5757' });
    const tId = (txt(r).match(/text (\w+)/) || [])[1];
    const tb = await js(`const t = ${E}.userObjects().find(o => o.id === '${tId}'); const c = t.getCenterPoint(); return { x: c.x - t.getScaledWidth() / 2, y: c.y - t.getScaledHeight() / 2, fs: t.fontSize }`);
    check('add_text puts the top-left where asked', Math.abs(tb.x - 90) < 1 && Math.abs(tb.y - 560) < 1 && tb.fs === 36, JSON.stringify(tb));
    r = await mcp.call('add_shape', { shape: 'star', x: 880, y: 60, width: 120, height: 120, fill: '#ffc65c' }); const sId = (txt(r).match(/ (\w+) at/) || [])[1];
    r = await mcp.call('add_icon', { name: 'rocket', x: 760, y: 80, size: 90, color: '#1b1f23' }); check('add_icon', !r.isError, txt(r));
    if (fs.existsSync(path.join(FIX, 'person.jpg'))) { r = await mcp.call('add_image', { path: path.join(FIX, 'person.jpg'), x: 610, y: 610, width: 380, height: 380 }); const imId = (txt(r).match(/picture (\w+)/) || [])[1]; check('add_image from a file, cropped to the box', imId && /"width":380,"height":380/.test(txt(r).replace(/\s/g, '')), txt(r)); r = await mcp.call('color_grade', { id: imId, look: 'tealorange' }); check('color_grade a photo', !r.isError && (await js(`return ${E}.userObjects().find(o => o.id === '${imId}').ro2Grade.look === 'tealorange'`))); }
    r = await mcp.call('update_layer', { id: sId, angle: 20, fill: '#46e6a2', x: 870 }); check('update_layer moves, rotates and recolours', /"angle":20/.test(txt(r).replace(/\s/g, '')) && /46e6a2/.test(txt(r)));
    r = await mcp.call('arrange_layer', { id: sId, to: 'back' }); check('arrange_layer', (await js(`return ${E}.userObjects()[0].id === '${sId}'`)));
    r = await mcp.call('list_layers'); check('list_layers', JSON.parse(txt(r)).layers_bottom_to_top.length >= 6);
    r = await mcp.call('screenshot', {}); saveImg(r, 'mcp-page2');

    // ── page 3: a video clip ──
    await mcp.call('add_page', { background: '#000000' });
    r = await mcp.call('add_video', { path: clip, start: 0.5, end: 3.5 }); check('add_video imports, trims and sizes the clip', /plays 0.5–3.5 s, with sound/.test(txt(r)) && /3 s/.test(txt(r)), txt(r).slice(0, 200));
    r = await mcp.call('add_text', { text: 'Watch', x: 60, y: 60, size: 90, weight: 800, font: 'Poppins', color: '#ffffff' });

    // ── the timeline ──
    r = await mcp.call('set_timeline', { pages: [{ page: 2, duration: 2.5, transition: 'slideleft', transition_duration: 0.5 }, { page: 3, transition: 'fadeblack' }], fps: 30, music: { path: music, volume: 0.6 } });
    check('set_timeline: durations, transitions and music', /page 1: 4 s; page 2: 2.5 s, in with slideleft; page 3: 3 s, in with fadeblack/.test(txt(r)) && /Music/.test(txt(r)), txt(r));
    r = await mcp.call('set_timeline', { pages: [{ page: 2, transition: 'spin-o-rama' }] }); check('an unknown transition is refused', r.isError);
    await js(`(await import('./js/timeline.js')).toggleTimeline(true)`); await sleep(600); await shot('window-timeline');

    // ── exports ──
    r = await mcp.call('export', { format: 'png', pages: 'all', path: work });
    const pngs = fs.readdirSync(work).filter((f) => f.endsWith('.png'));
    check('export png, all pages', pngs.length === 3, pngs.join(', ') + ' · ' + txt(r).slice(0, 80));
    let t0 = Date.now();
    r = await mcp.call('export', { format: 'mp4', path: path.join(work, 'design.mp4') });
    const mp4 = path.join(work, 'design.mp4'); const pm = fs.existsSync(mp4) && probe(mp4);
    const dur = pm ? +pm.format.duration : 0; const vs = pm && pm.streams.find((s) => s.codec_type === 'video'); const as = pm && pm.streams.find((s) => s.codec_type === 'audio');
    check('export mp4: 3 scenes with transitions and music', pm && vs.width === 1080 && vs.height === 1080 && as && Math.abs(dur - (4 + 2.5 + 3 - 0.5 - 0.6)) < 0.35, `${dur.toFixed(2)} s, ${vs && vs.codec_name} ${vs && vs.width}×${vs && vs.height}, audio ${as && as.codec_name}, ${((Date.now() - t0) / 1000).toFixed(1)} s to render`);
    if (pm) {
      const f1 = frameAt(mp4, 0.1), f2 = frameAt(mp4, 1.5), f3 = frameAt(mp4, 3.5);
      check('the HTML animation really moves in the video', diff(f1, f2) > 4 && diff(f2, f3) > 0.5, `Δ ${diff(f1, f2).toFixed(1)}, ${diff(f2, f3).toFixed(1)}`);
      const v1 = frameAt(mp4, 6.2), v2 = frameAt(mp4, 7.6); check('the video clip plays on its page', diff(v1, v2) > 1, `Δ ${diff(v1, v2).toFixed(1)}`);
      for (const [t, name] of [[0.1, 'start'], [1.5, 'mid'], [3.9, 'end-p1'], [4.6, 'slide'], [7, 'video']]) execFileSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=540:-2', path.join(OUT, `${String(++n).padStart(2, '0')}-mp4-${name}.jpg`)]);
    }
    r = await mcp.call('export', { format: 'gif', path: path.join(work, 'design.gif') });
    const pg = fs.existsSync(path.join(work, 'design.gif')) && probe(path.join(work, 'design.gif'));
    check('export gif', pg && pg.streams[0].codec_name === 'gif' && pg.streams[0].width <= 720, pg ? `${pg.streams[0].width}×${pg.streams[0].height}, ${Math.round(+pg.format.size / 1024)} KB` : txt(r));
    // a see-through WebM of page 1 only (a lower-third style overlay)
    await mcp.call('go_to_page', { page: 1 }); await mcp.call('set_background', { color: 'rgba(0,0,0,0)', look: false });
    await mcp.call('update_html', { id: htmlId, find: 'background:linear-gradient(160deg,#0b1020,#1a2a6c);', replace: '', look: false });
    r = await mcp.call('export', { format: 'webm', pages: 'current', transparent: true, path: path.join(work, 'overlay.webm') });
    const pw = fs.existsSync(path.join(work, 'overlay.webm')) && probe(path.join(work, 'overlay.webm'));
    const alpha = pw && (pw.streams[0].tags && (pw.streams[0].tags.alpha_mode === '1' || pw.streams[0].tags.ALPHA_MODE === '1'));
    check('export see-through webm', pw && pw.streams[0].codec_name === 'vp9' && alpha, pw ? JSON.stringify(pw.streams[0].tags) : txt(r));
    r = await mcp.call('undo', { steps: 2, look: false }); check('undo', /Undid 2/.test(txt(r)));

    // ── the in-app assistant, against a stand-in OpenAI-compatible server ──
    let step = 0; const seen = [];
    const srv = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
        const body = JSON.parse(b || '{}'); seen.push(body); step++;
        const msg = step === 1
          ? { role: 'assistant', content: 'I’ll add a page with a poster.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'add_page', arguments: '{}' } }, { id: 'c2', type: 'function', function: { name: 'add_html', arguments: JSON.stringify({ html: '<div style="position:absolute;inset:0;background:#ff5757;display:grid;place-content:center;font:800 140px Poppins;color:#fff">HELLO</div>' }) } }] }
          : { role: 'assistant', content: 'Done: page 4 is a red **HELLO** poster.' };
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'x', choices: [{ index: 0, message: msg, finish_reason: msg.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
      });
    }); await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    await js(`await window.ro2.ai.set({ provider: 'custom', base: 'http://127.0.0.1:${srv.address().port}/v1', model: 'stand-in', route: 'api' }); await window.ro2.ai.set({ provider: 'custom', key: 'test-key' });`);
    await js(`document.querySelector('.rail-btn[data-id="assistant"]').click()`); await sleep(700); await shot('assistant-panel');
    await js(`const ta = document.querySelector('.as-input'); ta.value = 'Make a bold red HELLO poster on a new page'; document.querySelector('.as-send').click();`);
    let done = false; for (let i = 0; i < 120 && !done; i++) { await sleep(500); done = await js(`return !!document.querySelector('.as-send') && !document.querySelector('.as-send').classList.contains('hidden') && document.querySelectorAll('.as-msg.ai').length >= 2`); }
    const chat = await js(`return { ai: [...document.querySelectorAll('.as-msg.ai')].map(e => e.textContent), tools: [...document.querySelectorAll('.as-tool')].map(e => e.textContent), shots: document.querySelectorAll('.as-shot').length, pages: ${E}.doc.pages.length, html: ${E}.userObjects().filter(o => o.ro2Html).length }`);
    check('in-app assistant runs tools and answers', done && chat.pages === 4 && chat.html === 1 && chat.shots >= 1 && chat.tools.length >= 2, JSON.stringify(chat).slice(0, 300));
    const sent = seen[1] && seen[1].messages || []; const toolMsgs = sent.filter((m) => m.role === 'tool');
    check('the model got tool results with the screenshot', toolMsgs.length === 2 && JSON.stringify(sent).includes('image_url'), `${toolMsgs.length} tool results; auth ${seen[0] && 'ok'}`);
    check('the model was sent RO2’s tools and the guide', seen[0].tools && seen[0].tools.length >= 30 && /HTML layer/.test(JSON.stringify(seen[0].messages[0])));
    await shot('assistant-chat');
    srv.close();
    r = await mcp.call('get_state'); const st = JSON.parse(txt(r));
    check('get_state describes pages, timeline and music', st.open && st.open.pages.length === 4 && st.open.video && st.open.video.music, JSON.stringify(st.open && st.open.video));
    await js(`document.querySelector('.rail-btn[data-id="assistant"]').click()`); await sleep(200);
    await js(`(await import('./js/modals/export.js')).openExport({ video: true })`); await sleep(700); await shot('export-video-modal');
    await js(`document.querySelector('.modal .btn.ghost')?.click()`);
    // the HTML editor
    await js(`const ed = ${E}; const i = ed.doc.pages.findIndex(p => JSON.stringify(p.objects || []).includes('HELLO')); await ed.gotoPage(i); const o = ed.userObjects().find(o => o.ro2Html); (await import('./js/modals/html-editor.js')).openHtmlEditor(o);`); await sleep(1800); await shot('html-editor');
    check('HTML editor shows the code and plays it live', await js(`return document.querySelector('.html-editor textarea').value.includes('HELLO') && document.querySelector('.html-live').src.startsWith('ro2://html/')`));
    await js(`document.querySelector('.modal .btn.ghost')?.click()`);
  } catch (e) { log('  ✗ CRASH ' + (e.stack || e)); results.push({ name: 'crash', ok: false }); await shot('crash'); if (mcp) log(mcp.stderr().slice(-800)); }
  if (mcp) mcp.close();
  const bad = errors.filter((m) => !/Autofill|DevTools|Electron Security Warning|favicon|Estimating resolution/.test(m));
  check('no console errors', !bad.length, bad.slice(0, 5).join(' || '));
  const fails = results.filter((r) => !r.ok).length;
  log(`\n${results.length - fails}/${results.length} passed`);
};
