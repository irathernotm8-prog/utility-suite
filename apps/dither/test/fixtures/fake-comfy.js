// A stand-in ComfyUI (no GPU): answers the endpoints Dither uses for Wan 2.2 and "renders" a bobbing character on
// green from the uploaded start image, so the local Animate path can be tested end to end.
'use strict';
const http = require('http');
const png = require('../../src/core/png');
const FX = require('../../src/core/fxruntime');

function start({ files = true, node = true } = {}) {
  const seen = { graphs: [], uploads: 0 }; let uploaded = null; const jobs = {};
  const srv = http.createServer((req, res) => {
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
    const u = new URL(req.url, 'http://x'); let body = []; req.on('data', (c) => body.push(c)); req.on('end', () => {
      body = Buffer.concat(body);
      if (u.pathname === '/system_stats') return send(200, { system: { os: 'fake' }, devices: [{ name: 'Fake GPU' }] });
      if (u.pathname.startsWith('/object_info/')) {
        const n = u.pathname.split('/').pop();
        const lists = { UNETLoader: ['unet_name', files ? ['wan2.2_ti2v_5B_fp16.safetensors'] : []], CLIPLoader: ['clip_name', files ? ['umt5_xxl_fp8_e4m3fn_scaled.safetensors'] : []], VAELoader: ['vae_name', files ? ['wan2.2_vae.safetensors'] : []] };
        if (n === 'Wan22ImageToVideoLatent') return send(200, node ? { Wan22ImageToVideoLatent: { input: { required: {} } } } : {});
        if (lists[n]) return send(200, { [n]: { input: { required: { [lists[n][0]]: [lists[n][1]] } } } });
        return send(200, {});
      }
      if (u.pathname === '/upload/image') { seen.uploads++; const i = body.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47])); const end = body.lastIndexOf(Buffer.from('IEND')) + 8; uploaded = png.decode(body.subarray(i, end)); return send(200, { name: 'dither.png', subfolder: '', type: 'input' }); }
      if (u.pathname === '/prompt') { const g = JSON.parse(body.toString()).prompt; seen.graphs.push(g); const id = 'p' + seen.graphs.length; const lat = Object.values(g).find((x) => x.class_type === 'Wan22ImageToVideoLatent').inputs; jobs[id] = { polls: 0, n: Math.min(lat.length, 40), size: lat.width }; return send(200, { prompt_id: id, number: 1, node_errors: {} }); }
      if (u.pathname.startsWith('/history/')) { const id = u.pathname.split('/').pop(); const j = jobs[id]; if (!j) return send(200, {}); if (j.polls++ < 1) return send(200, {}); return send(200, { [id]: { status: { completed: true, status_str: 'success' }, outputs: { 11: { images: Array.from({ length: j.n }, (_, i) => ({ filename: `clip_${String(i).padStart(5, '0')}_.png`, subfolder: 'Dither', type: 'output' })) } } } }); }
      if (u.pathname === '/view') { const i = Number(/(\d+)_\.png$/.exec(u.searchParams.get('filename'))[1]); return send(200, png.encode(frame(uploaded, i)), 'image/png'); }
      if (u.pathname === '/interrupt') return send(200, {});
      send(404, { error: 'not here' });
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close(), seen })));
}
// frame i: the uploaded picture's character, bobbing on a 24-frame loop with a little drift
function frame(src, i) {
  const S = 320; const g = new FX.Canvas(S, S, ['#00ff00']); g.clear('#00ee22'); const t = (i % 24) / 24, bob = Math.round(Math.sin(t * Math.PI * 2) * 6), dx = Math.round(i * 0.4);
  if (src) { const sc = S / src.w; for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const sx = Math.floor((x - dx) / sc), sy = Math.floor((y - bob * (y < S * 0.7 ? 1 : 0)) / sc); if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue; const k = (sy * src.w + sx) * 4; const c = [src.data[k], src.data[k + 1], src.data[k + 2]]; if (c[1] > 200 && c[0] < 80) continue; g.px(x, y, FX.toHex(c)); } }
  else g.fillCircle(160 + dx, 160 + bob, 60, '#3b5dc9');
  return g.toImage();
}
module.exports = { start, frame };
