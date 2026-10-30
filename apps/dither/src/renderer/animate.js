// Dither — Animate: a character → a video model (local Wan 2.2 through Kiln's ComfyUI, or the cloud with your fal.ai
// key) → a clip → a pixel-art sprite. Any video or GIF you drop in becomes a clip too.
'use strict';

const AN = { status: null, source: null, preset: 'idle', prompt: '', seconds: 0, busy: false, prog: null, clips: [] };
const engineLabel = (s) => (!s ? '…' : s.preferred === 'cloud' ? `Cloud · ${(s.cloud.models.find((m) => m.id === s.cloud.model) || {}).label || 'fal.ai'}` : 'Local · Wan 2.2');

VIEWS.animate = {
  title: 'Animate',
  head() { return `<h1>Animate</h1><button class="btn ghost sm" id="anEngine"><span class="dot" id="anDot"></span><span id="anEngLbl">${esc(engineLabel(AN.status))}</span>${icon('chevronDown', 14)}</button>`; },
  actions() { return `<button class="btn" id="anImport">${icon('import', 15)}Import video or GIF</button>`; },
  async render(view) {
    view.innerHTML = `<div class="anim">
      <section class="an-new">
        <div class="an-step"><div class="an-n">1</div><b>Character</b></div>
        <div class="an-src"><div class="an-src-box" id="anSrc"><canvas></canvas><div class="an-src-empty">${icon('sprites', 22)}<span>Pick a sprite or a picture</span></div></div>
          <div class="col an-src-pick"><select class="select" id="anSprite"><option value="">Choose a sprite…</option>${S.sprites.map((s) => `<option value="${s.id}">${esc(s.name)} · ${s.w}×${s.h}</option>`).join('')}</select>
          <button class="btn sm" id="anFile">${icon('refs', 14)}Use a picture…</button><button class="btn sm" id="anDraw">${icon('sparkle', 14)}Draw a character…</button>
          <div class="hint">Full body, side view, on a flat background works best. It goes on a green screen for the video model.</div></div></div>
        <div class="an-step"><div class="an-n">2</div><b>Motion</b></div>
        <div class="an-presets" id="anPresets"></div>
        <textarea class="input area" id="anPrompt" rows="3" placeholder="Describe one action, e.g. swings a sword overhead and returns to the starting pose"></textarea>
        <div class="row"><span class="label">Length</span><div class="seg sm" id="anSecs">${[2, 3, 4, 5].map((n) => `<button data-s="${n}">${n}s</button>`).join('')}</div><span class="grow"></span><span class="muted tiny">Camera lock, steady background and loop are added for you</span></div>
        <div class="an-step"><div class="an-n">3</div><b>Make the clip</b></div>
        <div class="an-go"><div class="seg full" id="anEng"><button data-e="local">${icon('cpu', 14)}On this computer</button><button data-e="cloud">${icon('globe', 14)}Cloud (fal.ai)</button></div>
          <div class="an-eng-note small muted" id="anEngNote"></div>
          <button class="btn primary lg" id="anGo">${icon('film', 16)}Animate</button>
          <div class="an-prog" id="anProg" hidden><div class="row"><span class="spin"></span><span class="grow small" id="anMsg">Starting…</span><button class="btn xs" id="anStop">Stop</button></div><div class="bar"><i id="anBar" style="width:2%"></i></div></div></div>
      </section>
      <section class="an-clips"><div class="section-title">Clips<span class="muted small" id="anClipN"></span></div><div class="clip-grid" id="anClips"></div></section></div>`;
    wireAnimate(view);
    await Promise.all([refreshAnimateStatus(), drawClips()]);
    drawPresets(); if (AN.source) showSource();
  },
};

async function refreshAnimateStatus() { try { AN.status = await call('animate:status'); } catch (e) { AN.status = null; } paintEngine(); }
function paintEngine() {
  const s = AN.status; if (!s || S.view !== 'animate') return; const eng = S.settings.animateEngine || s.preferred;
  const lbl = $('#anEngLbl'); if (lbl) lbl.textContent = engineLabel({ ...s, preferred: eng });
  const ready = eng === 'cloud' ? s.cloud.hasKey : s.local.ready; const dot = $('#anDot'); if (dot) dot.className = 'dot' + (ready ? ' on' : '');
  $$('#anEng [data-e]').forEach((b) => b.classList.toggle('on', b.dataset.e === eng));
  const note = $('#anEngNote'); if (note) note.innerHTML = eng === 'cloud' ? (s.cloud.hasKey ? `${esc((s.cloud.models.find((m) => m.id === s.cloud.model) || {}).label || 'Custom model')} on fal.ai — paid per clip from your fal balance.` : `Add your fal.ai key first. <button class="link-btn" data-open-engine>Set up</button>`) : s.local.ready ? `Wan 2.2 in ComfyUI at ${esc(s.local.comfy)} — free, on your GPU.${s.local.platformNote ? ' ' + esc(s.local.platformNote) : ''}` : !s.local.comfy ? `Start ComfyUI in Kiln, then come back. <button class="link-btn" data-open-engine>Set up</button>` : `ComfyUI is running but Wan 2.2 isn’t added yet (${s.local.missingGB} GB). <button class="link-btn" data-open-engine>Add it</button>`;
  $$('[data-open-engine]').forEach((b) => (b.onclick = engineSheet));
  const go = $('#anGo'); if (go) go.disabled = AN.busy || !ready || !AN.source;
}
function drawPresets() {
  const P = (AN.status && AN.status.presets) || {}; const host = $('#anPresets'); if (!host) return;
  host.innerHTML = Object.entries(P).map(([k, v]) => `<button class="chip ${AN.preset === k ? 'on' : ''}" data-p="${k}">${esc(v.label)}${v.loop ? ' <i>loop</i>' : ''}</button>`).join('') + `<button class="chip ${!AN.preset ? 'on' : ''}" data-p="">Custom</button>`;
  $$('[data-p]', host).forEach((b) => (b.onclick = () => { AN.preset = b.dataset.p; const pr = P[AN.preset]; $('#anPrompt').value = pr ? pr.text : ''; AN.seconds = pr ? pr.seconds : AN.seconds || 2; drawPresets(); paintSecs(); }));
  if (!$('#anPrompt').value && P[AN.preset]) { $('#anPrompt').value = P[AN.preset].text; AN.seconds = AN.seconds || P[AN.preset].seconds; } paintSecs();
}
function paintSecs() { $$('#anSecs [data-s]').forEach((b) => b.classList.toggle('on', +b.dataset.s === (AN.seconds || 2))); }
async function showSource() {
  const box = $('#anSrc'); if (!box || !AN.source) return;
  try { const r = await call('animate:source', AN.source); box.classList.add('has'); const cv = $('canvas', box); new Player(cv, { pad: 6, max: 4, bg: 'none' }).set([r.data], { w: r.w, h: r.h, durations: [100] }); } catch (e) { fail(e); }
  paintEngine();
}
async function drawClips() {
  try { AN.clips = await call('clips:list'); } catch { AN.clips = []; } const host = $('#anClips'); if (!host) return; $('#anClipN').textContent = AN.clips.length ? ` · ${AN.clips.length}` : '';
  if (!AN.clips.length) { host.innerHTML = `<div class="an-empty">${icon('film', 26)}<b>No clips yet</b><span>Animate a character, or import a video or GIF — a 3D render, footage on a green screen, anything with one subject.</span></div>`; return; }
  host.innerHTML = AN.clips.map((c) => `<div class="clip" data-id="${c.id}"><div class="d-stage loading"></div><div class="d-body"><div class="row"><div class="d-name grow ellip">${esc(c.name)}</div>${c.loop ? '<span class="pill acc">loop</span>' : ''}<button class="icon-btn xs d-more">${icon('more', 15)}</button></div><div class="d-idea">${c.n} frames · ${c.fps} fps · ${esc(c.engine || (c.imported ? 'imported' : ''))}${c.sprites && c.sprites.length ? ` · ${plural(c.sprites.length, 'sprite')}` : ''}</div><button class="btn sm primary clip-go">${icon('sprites', 14)}Make sprite</button></div></div>`).join('');
  $$('.clip', host).forEach((el) => {
    const id = el.dataset.id; const st = $('.d-stage', el); const cv = document.createElement('canvas'); st.appendChild(cv); const p = new Player(cv, { pad: 8, max: 3, bg: 'none' });
    call('animate:raw', id, { count: 24, max: 192 }).then((r) => { if (!p.disposed) p.set(r.frames, { w: r.w, h: r.h, durations: r.durations }); st.classList.remove('loading'); }).catch(() => st.classList.remove('loading'));
    $('.clip-go', el).onclick = () => convertSheet(id); st.onclick = () => convertSheet(id);
    $('.d-more', el).onclick = (e) => menu(e.currentTarget, [{ label: 'Rename…', icon: 'edit', run: async () => { const c = AN.clips.find((x) => x.id === id); const n = await promptBox({ title: 'Rename clip', value: c.name, ok: 'Rename' }); if (n) { await call('clips:rename', id, n); drawClips(); } } }, { label: 'Animate this source again', icon: 'refresh', disabled: !(AN.clips.find((x) => x.id === id) || {}).source, run: () => { const c = AN.clips.find((x) => x.id === id); AN.source = c.source; AN.preset = c.preset || ''; render(); setTimeout(() => { $('#anPrompt').value = c.prompt || ''; }, 50); } }, '-', { label: 'Delete clip', icon: 'trash', danger: true, run: async () => { await call('clips:remove', id); drawClips(); } }], { width: 240, align: 'right' });
  });
}

function wireAnimate() {
  $('#anEngine').onclick = engineSheet; $('#anImport').onclick = importClip;
  $('#anSprite').onchange = (e) => { if (!e.target.value) return; AN.source = { sprite: e.target.value, frame: 0 }; showSource(); };
  if (AN.source && AN.source.sprite) $('#anSprite').value = AN.source.sprite;
  $('#anFile').onclick = async () => { const f = await call('dialog:files', { filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] }); if (!f) return; AN.source = { file: f[0] }; $('#anSprite').value = ''; showSource(); };
  $('#anDraw').onclick = drawCharacter;
  $$('#anSecs [data-s]').forEach((b) => (b.onclick = () => { AN.seconds = +b.dataset.s; paintSecs(); }));
  $$('#anEng [data-e]').forEach((b) => (b.onclick = async () => { S.settings = await call('settings:set', { animateEngine: b.dataset.e }); paintEngine(); }));
  $('#anGo').onclick = startAnimate; $('#anStop').onclick = () => call('animate:stop');
  const drop = $('.an-clips'); wireDrop(drop, (f) => importClip(f[0]));
}
async function startAnimate() {
  if (!AN.source) return; const prompt = $('#anPrompt').value.trim(); const P = AN.status.presets || {}; const pr = P[AN.preset];
  AN.busy = true; paintEngine(); $('#anProg').hidden = false; $('#anMsg').textContent = 'Starting…'; $('#anBar').style.width = '2%';
  try { const c = await call('animate:generate', { source: AN.source, preset: AN.preset || undefined, prompt: pr && prompt === pr.text ? undefined : prompt || undefined, seconds: AN.seconds || undefined, engine: S.settings.animateEngine || AN.status.preferred }); toast('Clip ready', `${c.n} frames — make a sprite from it`); await drawClips(); convertSheet(c.id); }
  catch (e) { if (!/Stopped/.test(e.message)) fail(e); }
  finally { AN.busy = false; const pg = $('#anProg'); if (pg) pg.hidden = true; paintEngine(); }
}
D.on('animate:progress', (e) => { if (S.view !== 'animate') return; if (e.msg && $('#anMsg')) $('#anMsg').textContent = e.msg; if (e.progress != null && $('#anBar')) $('#anBar').style.width = Math.round(e.progress * 100) + '%'; });
async function importClip(file) {
  if (!file || typeof file !== 'string') { const f = await call('dialog:files', { filters: [{ name: 'Video or GIF', extensions: ['mp4', 'mov', 'm4v', 'webm', 'gif', 'webp'] }] }); if (!f) return; file = f[0]; }
  const t = toast('Reading frames…', baseName(file), 'busy', 0); try { const c = await call('animate:import', file); t.remove(); await drawClips(); convertSheet(c.id); } catch (e) { t.remove(); fail(e); }
}
async function drawCharacter() {
  const r = await promptBox({ title: 'Draw a character', text: 'Uses your image engine (Kiln) to draw a full-body character on a green screen, ready to animate. Describe just the character.', fields: [{ key: 'p', label: 'Character', area: true, placeholder: 'e.g. a knight in blue armour with a red cape, holding a sword' }], ok: 'Draw' });
  if (!r || !r.p.trim()) return; const t = toast('Drawing the character…', 'This uses Kiln’s running engine', 'busy', 0);
  try { const g = await call('animate:character', { prompt: r.p.trim() }); t.remove(); AN.source = { file: g.file }; $('#anSprite').value = ''; showSource(); } catch (e) { t.remove(); fail(e); }
}

// ───────── clip → sprite
async function convertSheet(id) {
  const clip = AN.clips.find((c) => c.id === id) || {}; const pals = Object.keys(S.info.palettes);
  const o = { height: 48, count: clip.loop ? 8 : 8, colors: 16, palette: '', align: clip.align || 'feet', loop: !!clip.loop, outline: false, key: 45 };
  const el = openSheet(`<div class="sheet-head">${icon('sprites', 20)}<div class="grow"><h3>Make a sprite</h3><div class="muted small ellip">${esc(clip.name || '')} · ${clip.n} frames at ${clip.fps} fps</div></div></div>
    <div class="sheet-body"><div class="px-cmp"><div class="px-side"><div class="label">Clip</div><div class="px-box"><canvas id="cvA"></canvas></div><div class="muted tiny" id="cvAi"></div></div><div class="px-side"><div class="label">Pixel art</div><div class="px-box" id="cvBox"><canvas id="cvB"></canvas></div><div class="muted tiny" id="cvBi">Working…</div></div></div>
      <div class="cv-ctrls">
        <div class="field"><label>Height <b id="cvHv">48</b> px</label><input type="range" id="cvH" min="16" max="128" step="2" value="48"></div>
        <div class="field"><label>Frames</label><select class="select sm" id="cvN">${[2, 3, 4, 6, 8, 10, 12, 16, 24].map((n) => `<option ${n === o.count ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label>Colours</label><select class="select sm" id="cvC">${[6, 8, 12, 16, 24, 32].map((n) => `<option ${n === o.colors ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label>Palette</label><select class="select sm" id="cvP"><option value="">Its own</option>${pals.map((p) => `<option>${p}</option>`).join('')}</select></div>
        <div class="field"><label>Hold in place</label><div class="seg sm" id="cvA2">${[['feet', 'Feet'], ['x', 'Sideways only'], ['none', 'Off']].map(([k, l]) => `<button data-a="${k}" class="${o.align === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="field"><label>Screen removal <b id="cvKv">45</b></label><input type="range" id="cvK" min="0" max="100" value="45"></div>
        <div class="field cv-checks"><label class="chk"><input type="checkbox" id="cvL" ${o.loop ? 'checked' : ''}> Find the loop</label><label class="chk"><input type="checkbox" id="cvO"> Dark outline</label></div>
      </div></div>
    <div class="sheet-foot"><input class="input" id="cvName" value="${esc(clip.name || 'Animation')}" style="width:220px"><span class="grow"></span><button class="btn" id="cvCancel">Close</button><button class="btn primary" id="cvKeep">${icon('check', 15)}Keep as sprite</button></div>`, { width: 1000 });
  const pa = new Player($('#cvA', el), { pad: 6, max: 3, bg: 'none' }), pb = new Player($('#cvB', el), { pad: 8, max: 8 });
  call('animate:raw', id, { count: 48, max: 256 }).then((r) => { pa.set(r.frames, { w: r.w, h: r.h, durations: r.durations }); $('#cvAi', el).textContent = `${clip.n} source frames`; });
  const opts = () => ({ height: o.height, count: o.count, colors: o.colors, palette: o.palette || undefined, align: o.align, loop: o.loop, outline: o.outline, key: { tolerance: o.key } });
  let t = null, seq = 0; const run = () => { clearTimeout(t); t = setTimeout(async () => { const my = ++seq; $('#cvBi', el).textContent = 'Working…'; try { const r = await call('animate:preview', id, opts()); if (my !== seq) return; pb.set(r.frames, { w: r.w, h: r.h, durations: r.durations, loop: true }); $('#cvBi', el).textContent = `${r.w}×${r.h} · ${plural(r.frames.length, 'frame')} · ${plural(r.palette.length, 'colour')}${r.info.loop ? ` · loops at source frame ${r.info.loop.end}` : ''} · screen ${r.info.key || 'off'}`; } catch (e) { if (my === seq) $('#cvBi', el).textContent = e.message; } }, 160); };
  $('#cvH', el).oninput = (e) => { o.height = +e.target.value; $('#cvHv', el).textContent = o.height; run(); };
  $('#cvK', el).oninput = (e) => { o.key = +e.target.value; $('#cvKv', el).textContent = o.key; run(); };
  $('#cvN', el).onchange = (e) => { o.count = +e.target.value; run(); }; $('#cvC', el).onchange = (e) => { o.colors = +e.target.value; run(); }; $('#cvP', el).onchange = (e) => { o.palette = e.target.value; run(); };
  $('#cvL', el).onchange = (e) => { o.loop = e.target.checked; run(); }; $('#cvO', el).onchange = (e) => { o.outline = e.target.checked; run(); };
  $$('#cvA2 [data-a]', el).forEach((b) => (b.onclick = () => { o.align = b.dataset.a; $$('#cvA2 button', el).forEach((x) => x.classList.toggle('on', x === b)); run(); }));
  $('#cvCancel', el).onclick = closeSheet;
  $('#cvKeep', el).onclick = async () => { try { const r = await call('animate:keep', id, opts(), $('#cvName', el).value.trim() || clip.name); pa.dispose(); pb.dispose(); S.sheetClose = null; closeSheet(); await loadProject(); toast('Sprite made', `${r.w}×${r.h}, ${plural(r.frames, 'frame')}. Critique and Shade work on it like any sprite.`); go('editor', r.sprite); } catch (e) { fail(e); } };
  S.sheetClose = () => { pa.dispose(); pb.dispose(); };
  run();
}

// ───────── engines
async function engineSheet() {
  await refreshAnimateStatus(); const s = AN.status; if (!s) return; const L = s.local;
  const el = openSheet(`<div class="sheet-head">${icon('film', 20)}<div class="grow"><h3>Video engines</h3><div class="muted small">Animate uses a video model to move your character. Pick one or both.</div></div></div>
    <div class="sheet-body">
      <div class="eng-card"><div class="row"><b class="grow">${icon('cpu', 15)} On this computer — Wan 2.2 (5B)</b>${L.ready ? '<span class="pill ok">Ready</span>' : ''}</div>
        <div class="muted small">Free, private, runs on your GPU through the ComfyUI that Kiln runs. Best on the PC’s NVIDIA card (12 GB is enough); a 2-second clip takes a few minutes.${L.platformNote ? ' ' + esc(L.platformNote) : ''}</div>
        <div class="eng-row"><span class="dot ${L.comfy ? 'on' : ''}"></span><span class="grow small">${L.comfy ? `ComfyUI at ${esc(L.comfy)}${L.nodeOk === false ? ' — <b class="warn-t">too old for Wan 2.2, update it in Kiln</b>' : ''}` : 'ComfyUI isn’t running. Start it in Kiln › Packages.'}</span><button class="btn xs" id="egUrl">Address…</button></div>
        <div class="eng-files">${(L.files || []).map((f) => { const d = (L.onDisk || []).find((x) => x.file === f.file); return `<div class="eng-file"><span class="grow mono tiny">${esc(f.file)}</span><span class="muted tiny">${f.size} GB</span>${f.found ? '<span class="pill ok">in ComfyUI</span>' : d && d.in.length ? '<span class="pill info">downloaded — restart ComfyUI</span>' : '<span class="pill">missing</span>'}</div>`; }).join('')}</div>
        <div class="bar" id="egBar" hidden><i style="width:0"></i></div><div class="tiny muted" id="egMsg"></div>
        <div class="row">${L.libraries && L.libraries.length ? `<button class="btn sm primary" id="egGet" ${L.ready ? 'disabled' : ''}>${icon('download', 14)}Download into Kiln (${L.missingGB || 0} GB)</button>` : ''}<button class="btn sm" id="egGetDir">Into a ComfyUI models folder…</button><span class="grow"></span><button class="link-btn" id="egUse1">Use this engine</button></div></div>
      <div class="eng-card"><div class="row"><b class="grow">${icon('globe', 15)} Cloud — fal.ai with your key</b>${s.cloud.hasKey ? '<span class="pill ok">Key saved</span>' : ''}</div>
        <div class="muted small">Kling 3.0 or Wan in the cloud: faster and usually smoother motion, charged per clip to your fal.ai account. Your key is kept encrypted on this computer and only sent to fal.ai.</div>
        <div class="row"><input class="input grow" type="password" id="egKey" placeholder="${s.cloud.hasKey ? '•••••••• (saved — paste a new one to replace)' : 'fal.ai API key'}"><button class="btn sm" id="egKeySave">Save</button><button class="link-btn" id="egKeys">Get a key</button></div>
        <div class="row"><span class="label">Model</span><select class="select sm" id="egModel">${s.cloud.models.map((m) => `<option value="${m.id}" ${s.cloud.model === m.id ? 'selected' : ''}>${esc(m.label)} — ${esc(m.endpoint)}</option>`).join('')}<option value="custom" ${s.cloud.model === 'custom' ? 'selected' : ''}>Another fal endpoint…</option></select><input class="input sm" id="egCustom" placeholder="fal-ai/…/image-to-video" value="${esc(s.cloud.customId)}" ${s.cloud.model === 'custom' ? '' : 'hidden'} style="width:240px"></div>
        <div class="row"><span class="grow"></span><button class="link-btn" id="egUse2">Use this engine</button></div></div>
    </div><div class="sheet-foot"><span class="grow"></span><button class="btn" id="egClose">Done</button></div>`, { width: 720 });
  const use = async (e) => { S.settings = await call('settings:set', { animateEngine: e }); await refreshAnimateStatus(); toast(`Animate uses ${e === 'cloud' ? 'the cloud' : 'this computer'}`); };
  $('#egUse1', el).onclick = () => use('local'); $('#egUse2', el).onclick = () => use('cloud'); $('#egClose', el).onclick = () => { closeSheet(); paintEngine(); };
  $('#egUrl', el).onclick = async () => { const u = await promptBox({ title: 'ComfyUI address', label: 'URL', value: S.settings.comfyUrl || 'http://127.0.0.1:8188', ok: 'Save' }); if (u != null) { S.settings = await call('settings:set', { comfyUrl: u.trim() }); engineSheet(); } };
  $('#egKeys', el).onclick = () => call('shell:open', 'https://fal.ai/dashboard/keys');
  $('#egKeySave', el).onclick = async () => { const k = $('#egKey', el).value.trim(); if (!k) return; await call('animate:setKey', k); $('#egKey', el).value = ''; toast('fal.ai key saved'); engineSheet(); };
  $('#egModel', el).onchange = async (e) => { $('#egCustom', el).hidden = e.target.value !== 'custom'; S.settings = await call('settings:set', { cloudModel: e.target.value }); };
  $('#egCustom', el).onchange = async (e) => { S.settings = await call('settings:set', { cloudCustomId: e.target.value.trim() }); };
  const dl = async (folder) => {
    const off = D.on('animate:download', (p) => { const b = $('#egBar', el); if (!b) return; b.hidden = false; if (p.total) $('i', b).style.width = Math.round(p.got / p.total * 100) + '%'; $('#egMsg', el).textContent = `${p.file || ''} — ${(p.got / 1e9).toFixed(1)} of ${(p.total / 1e9).toFixed(1)} GB`; });
    try { const r = await call('animate:installWan', folder); if (r) { toast('Wan 2.2 downloaded', r.note, 'ok', 9000); engineSheet(); } } catch (e) { fail(e); } finally { off(); }
  };
  const g = $('#egGet', el); if (g) g.onclick = () => { g.disabled = true; dl(false); }; $('#egGetDir', el).onclick = () => dl(true);
}
