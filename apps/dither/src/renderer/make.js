// Dither — Generate (the local model through Kiln's engine + Pixel Art XL, then Pixel snap) and Pixelize (any picture
// → clean pixel art).
'use strict';

const G = { status: null, busy: false, result: null };
VIEWS.make = {
  title: 'Generate & pixelize',
  render(view) {
    view.innerHTML = `<div class="make">
      <section class="mk-card"><div class="mk-h">${icon('cpu', 18)}<div class="grow"><b>Generate on this computer</b><div class="muted small">Stable Diffusion from Kiln + the free Pixel Art XL LoRA. No tokens, nothing leaves the computer.</div></div><button class="icon-btn sm" id="gRefresh" title="Check again">${icon('refresh', 16)}</button></div>
        <div id="gStatus" class="mk-status"><span class="spin"></span>Looking for a running engine…</div>
        <div id="gForm"></div><div id="gOut"></div></section>
      <section class="mk-card"><div class="mk-h">${icon('wand', 18)}<div class="grow"><b>Pixelize a picture</b><div class="muted small">Finds the hidden pixel grid in AI images that only look like pixel art, one colour per cell, a clean palette, background cleared. Works on any picture.</div></div></div>
        <div class="drop-zone tall" id="pxDrop">${icon('import', 24)}<span>Drop a picture here</span><span class="muted small">or click to choose</span></div>
        <div class="mk-tips"><div>${icon('info', 14)}<span>Ask Claude to do it too: “pixelize ~/Downloads/knight.png to 48 px wide with the sweetie16 palette”.</span></div></div></section></div>`;
    wireDrop($('#pxDrop'), (f) => pixelizeSheet(f[0]), async () => { const f = await call('dialog:files', { filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }] }); if (f) pixelizeSheet(f[0]); });
    $('#gRefresh').onclick = loadEngine; loadEngine();
  },
};
async function loadEngine() {
  const st = $('#gStatus'); if (!st) return; st.innerHTML = `<span class="spin"></span>Looking for a running engine…`;
  try { G.status = await call('engine:status'); } catch (e) { G.status = { engine: null, error: e.message }; }
  if (S.view !== 'make') return; const s = G.status, e = s.engine;
  if (!e) {
    st.className = 'mk-status off'; st.innerHTML = `<span class="dot"></span><div class="grow"><b>No engine running</b><div class="small muted">Start Forge, A1111 or ComfyUI in Kiln (turn on “Allow Kiln to generate with it”), then check again. Dither looks on ports 7860, 7861 and 8188${S.settings.engineUrl ? ` and ${esc(S.settings.engineUrl)}` : ''}.</div></div><button class="btn sm" id="gUrl">Set address…</button>`;
    $('#gUrl').onclick = async () => { const u = await promptBox({ title: 'Engine address', label: 'URL', value: S.settings.engineUrl || 'http://127.0.0.1:7860', ok: 'Save' }); if (u != null) { S.settings = await call('settings:set', { engineUrl: u }); loadEngine(); } };
    $('#gForm').innerHTML = loraBlock(s); wireLora(s); return;
  }
  st.className = 'mk-status on'; st.innerHTML = `<span class="dot on"></span><div class="grow"><b>${esc(e.name)}</b> <span class="muted small">${esc(e.url)}</span><div class="small muted">${e.error ? esc(e.error) : `${plural(e.checkpoints.length, 'checkpoint')} · ${e.xl.length} SDXL · Pixel Art XL ${e.hasLora ? '<b class="ok-t">ready</b>' : '<b class="warn-t">not added yet</b>'}`}</div></div>`;
  const pals = Object.keys(S.info.palettes);
  $('#gForm').innerHTML = `${e.hasLora ? '' : loraBlock(s)}
    <div class="field"><label>What to make</label><textarea class="input area" id="gPrompt" rows="2" placeholder="e.g. knight with a blue cape, side view, holding a sword"></textarea></div>
    <div class="mk-row"><div class="field"><label>Checkpoint</label><select class="select" id="gCk">${[...e.xl, ...e.checkpoints.filter((c) => !e.xl.includes(c))].map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label>Width in pixels</label><select class="select" id="gSize"><option value="">Auto (from the grid)</option>${[16, 24, 32, 48, 64, 96, 128].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></div></div>
    <div class="mk-row"><div class="field"><label>Colours</label><select class="select" id="gColors"><option value="">Auto</option>${[4, 8, 12, 16, 24, 32].map((n) => `<option>${n}</option>`).join('')}</select></div>
      <div class="field"><label>Palette</label><select class="select" id="gPal"><option value="">Its own</option>${pals.map((p) => `<option>${p}</option>`).join('')}</select></div>
      <div class="field"><label>Seed</label><input class="input" id="gSeed" placeholder="random"></div></div>
    <div class="row"><span class="grow small muted">${e.xl.length ? '' : 'Pixel Art XL needs an SDXL checkpoint. Add one in Kiln › Models.'}</span><button class="btn primary" id="gGo">${icon('sparkle', 15)}Generate</button></div>`;
  wireLora(s);
  $('#gGo').onclick = generate;
}
function loraBlock(s) {
  if (s.engine && s.engine.hasLora) return '';
  const f = s.kilnLoraFolders || []; const has = f.some((x) => x.has);
  return `<div class="lora"><div class="grow"><b>Pixel Art XL</b> <span class="muted small">by nerijs · ${esc(s.lora.license)} · ${esc(s.lora.size)} · for ${esc(s.lora.base)}</span><div class="small muted">${has ? 'Already in a Kiln library — restart the engine (or refresh its LoRAs) to pick it up.' : f.length ? `Adds it to ${f.length === 1 ? 'your Kiln library' : `your ${f.length} Kiln libraries`}.` : 'Kiln’s library wasn’t found here; choose your engine’s Lora folder.'}</div><div class="bar" id="loraBar" hidden><i style="width:0"></i></div></div><button class="btn sm" id="loraGet">${icon('download', 14)}${has ? 'Add again' : 'Add it'}</button><button class="link-btn" id="loraPage">About</button></div>`;
}
function wireLora(s) {
  const b = $('#loraGet'); if (!b) return; $('#loraPage').onclick = () => call('shell:open', s.lora.page);
  b.onclick = async () => {
    let dirs = (s.kilnLoraFolders || []).map((x) => x.dir); if (!dirs.length) { const d = await call('dialog:folder'); if (!d) return; dirs = [d]; }
    b.disabled = true; $('#loraBar').hidden = false; const off = D.on('engine:progress', (p) => { if (p.total) $('#loraBar i').style.width = Math.round(p.got / p.total * 100) + '%'; });
    try { await call('engine:installLora', dirs); toast('Pixel Art XL added', 'Restart the engine in Kiln if it doesn’t show up'); loadEngine(); } catch (e) { fail(e); b.disabled = false; } finally { off(); }
  };
}
async function generate() {
  const prompt = $('#gPrompt').value.trim(); if (!prompt) { $('#gPrompt').focus(); return; }
  const o = { prompt, checkpoint: $('#gCk').value, size: +$('#gSize').value || undefined, colors: +$('#gColors').value || undefined, palette: $('#gPal').value || undefined, seed: $('#gSeed').value ? +$('#gSeed').value : undefined };
  const out = $('#gOut'); out.innerHTML = `<div class="mk-progress"><span class="spin"></span><span id="gMsg">Generating… the first run loads the model and takes longer.</span><div class="bar"><i id="gBar" style="width:2%"></i></div></div>`; $('#gGo').disabled = true;
  const off = D.on('engine:progress', (p) => { if (p.progress != null && $('#gBar')) $('#gBar').style.width = Math.round(p.progress * 100) + '%'; if (p.msg && $('#gMsg')) $('#gMsg').textContent = p.msg; });
  try {
    const r = await call('engine:generate', o); G.result = { ...r, prompt };
    out.innerHTML = `<div class="gen-out"><div class="go-col"><div class="label">From the model</div><img id="goRaw"></div><div class="go-arrow">${icon('chevron', 20)}</div><div class="go-col grow"><div class="label">Pixel-snapped · ${r.w}×${r.h} · ${plural(r.palette.length, 'colour')}</div><div class="go-stage"><canvas></canvas></div></div></div>
      <div class="row"><span class="muted small grow">Seed ${r.seed} · ${esc(r.checkpoint)}${r.lora ? ' · Pixel Art XL' : ''}</span><button class="btn" id="goAgain">${icon('refresh', 14)}Again</button><button class="btn" id="goRepix">${icon('wand', 14)}Adjust snap…</button><button class="btn primary" id="goKeep">${icon('check', 14)}Keep as sprite</button></div>`;
    $('#goRaw').src = await call('image:dataUrl', r.raw);
    new Player($('.go-stage canvas'), { pad: 8, max: 10 }).set([r.data], { w: r.w, h: r.h, durations: [100] });
    $('#goAgain').onclick = generate; $('#goRepix').onclick = () => pixelizeSheet(r.raw, { name: prompt.slice(0, 40) });
    $('#goKeep').onclick = async () => { const id = await call('engine:keep', { w: r.w, h: r.h, data: r.data, palette: r.palette, name: prompt.slice(0, 40), prompt, seed: r.seed }); await loadProject(); go('editor', id); };
  } catch (e) { out.innerHTML = `<div class="mk-err">${icon('alert', 15)}<span>${esc(e.message)}</span></div>`; }
  finally { off(); const g = $('#gGo'); if (g) g.disabled = false; }
}

// ───────── Pixelize sheet: original vs result, with grid / colours / palette / background
async function pixelizeSheet(file, { name } = {}) {
  const pals = Object.keys(S.info.palettes);
  const el = openSheet(`<div class="sheet-head">${icon('wand', 20)}<div class="grow"><h3>Pixelize</h3><div class="muted small ellip">${esc(baseName(file))}</div></div></div>
    <div class="sheet-body"><div class="px-cmp"><div class="px-side"><div class="label">Original</div><div class="px-box"><img id="pxSrc"></div><div class="muted tiny" id="pxSrcInfo"></div></div><div class="px-side"><div class="label">Pixel art</div><div class="px-box" id="pxOutBox"><canvas></canvas></div><div class="muted tiny" id="pxInfo"></div></div></div>
      <div class="mk-row"><div class="field"><label>Grid</label><select class="select" id="pxMode"><option value="auto">Find it (AI pixel art)</option><option value="width">Set the width</option></select></div><div class="field" id="pxWf" hidden><label>Width <b id="pxWv">64</b> px</label><input type="range" id="pxW" min="8" max="256" step="1" value="64"></div>
      <div class="field"><label>Colours</label><select class="select" id="pxC"><option value="">Auto</option>${[2, 4, 6, 8, 12, 16, 24, 32, 48, 64].map((n) => `<option>${n}</option>`).join('')}</select></div><div class="field"><label>Palette</label><select class="select" id="pxP"><option value="">Its own</option>${pals.map((p) => `<option>${p}</option>`).join('')}</select></div></div>
      <div class="row"><label class="chk"><input type="checkbox" id="pxBg" checked> Clear the background</label><span class="grow"></span><input class="input" id="pxName" placeholder="Sprite name" value="${esc(name || baseName(file).replace(/\.[^.]+$/, ''))}" style="width:220px"></div></div>
    <div class="sheet-foot"><span class="grow"></span><button class="btn" id="pxCancel">Cancel</button><button class="btn primary" id="pxKeep">${icon('check', 15)}Keep as sprite</button></div>`, { width: 900 });
  call('image:dataUrl', file).then((u) => { $('#pxSrc', el).src = u; $('#pxSrc', el).onload = () => { $('#pxSrcInfo', el).textContent = `${$('#pxSrc', el).naturalWidth}×${$('#pxSrc', el).naturalHeight}`; }; }).catch(() => {});
  const player = new Player($('#pxOutBox canvas', el), { pad: 6, max: 24 });
  const opts = () => ({ width: $('#pxMode', el).value === 'width' ? +$('#pxW', el).value : undefined, colors: +$('#pxC', el).value || undefined, palette: $('#pxP', el).value || undefined, background: $('#pxBg', el).checked });
  let t = null, seq = 0; const run = () => { clearTimeout(t); t = setTimeout(async () => { const my = ++seq; $('#pxInfo', el).textContent = 'Working…'; try { const r = await call('pixelize:preview', file, opts()); if (my !== seq) return; player.set([r.data], { w: r.w, h: r.h, durations: [100] }); $('#pxInfo', el).textContent = `${r.w}×${r.h} · ${plural(r.palette.length, 'colour')}${$('#pxMode', el).value === 'auto' ? ` · grid cell ${r.grid.cell}px` : ''}`; if ($('#pxMode', el).value === 'auto') { $('#pxW', el).value = r.w; $('#pxWv', el).textContent = r.w; } } catch (e) { $('#pxInfo', el).textContent = e.message; } }, 120); };
  $('#pxMode', el).onchange = () => { $('#pxWf', el).hidden = $('#pxMode', el).value !== 'width'; run(); };
  $('#pxW', el).oninput = () => { $('#pxWv', el).textContent = $('#pxW', el).value; run(); };
  ['#pxC', '#pxP', '#pxBg'].forEach((s) => ($(s, el).onchange = run));
  $('#pxCancel', el).onclick = () => { player.dispose(); closeSheet(); };
  $('#pxKeep', el).onclick = async () => { try { const id = await call('sprites:import', file, { snap: true, ...opts(), name: $('#pxName', el).value.trim() || undefined }); player.dispose(); S.sheetClose = null; closeSheet(); await loadProject(); go('editor', id); } catch (e) { fail(e); } };
  run();
}
