/* Kiln — Generate: prompt, model and settings on the left; the image firing on the right. */
(() => {
  const { $, $$, esc } = K;
  let el = null;
  const g = { pkgId: null, opts: {}, mode: 'txt2img', p: null, init: null, busy: false, jobId: null, results: [], current: null, progress: 0, preview: null, loraList: null, acIndex: 0, startedAt: 0 };

  const LORA_RE = /<lora:([^:>]+)(?::([-\d.]+))?(?::[-\d.]+)?>/gi;
  const save = K.debounce(() => K.saveSettings({ gen: g.p }), 600);

  function mount(e) {
    el = e;
    el.innerHTML = `<div class="gen"><div class="gen-side"><div class="gen-scroll" id="gSide"></div>
      <div class="gen-foot"><button class="btn primary" id="gGo">${ic('flame', 18)} Generate <kbd style="color:inherit;border-color:currentColor;opacity:.6">Ctrl ⏎</kbd></button><button class="btn lg" id="gStop" hidden>${ic('stop', 15)} Stop</button></div></div>
      <div class="stage"><div class="stage-main" id="gStage"></div><div class="strip" id="gStrip"></div></div></div>`;
    $('#gGo', el).onclick = run;
    $('#gStop', el).onclick = stop;
    el.addEventListener('keydown', (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); run(); } });
    K.bus.on('running', () => { if (K.state.page === 'generate') { pickEngine(); renderSide(); } });
    K.bus.on('downloads:done', () => { g.loraList = null; });
    kiln.gen.onProgress((d) => {
      if (d.jobId && g.jobId && d.jobId !== g.jobId) return;
      if (typeof d.progress === 'number') g.progress = d.progress;
      if (d.preview) g.preview = d.preview;
      g.step = d.step; g.steps = d.steps; g.eta = d.eta;
      renderStage();
    });
    kiln.gen.onStarted((d) => { g.jobId = d.jobId; });
    kiln.browser.onUsePrompt((d) => { usePrompt(d.text); K.go('generate'); });
    kiln.browser.onUseImage(async (d) => { try { setInit(await kiln.gen.imageFromUrl(d.url)); g.mode = 'img2img'; K.go('generate'); renderSide(); } catch { K.toast('Couldn’t load that image', 'error'); } });
  }
  function reset() { g.pkgId = null; g.opts = {}; g.results = []; g.current = null; g.p = null; g.loraList = null; g.init = null; }

  function params() {
    if (!g.p) g.p = { ...K.state.settings.gen };
    if (g.p.positive == null) g.p.positive = '';
    return g.p;
  }
  function pickEngine() {
    const gens = K.generators();
    if (!gens.find(x => x.id === g.pkgId)) g.pkgId = (gens.find(x => x.id === K.state.settings.defaultPackageId) || gens[0])?.id || null;
  }
  async function loadOptions(force) {
    if (!g.pkgId) return;
    if (g.opts[g.pkgId] && !force) return;
    try {
      g.opts[g.pkgId] = { loading: true };
      renderSide();
      g.opts[g.pkgId] = force ? await kiln.gen.refresh(g.pkgId) : await kiln.gen.options(g.pkgId);
      const o = g.opts[g.pkgId], p = params();
      if (!o.checkpoints.some(c => c.value === p.checkpoint)) p.checkpoint = o.current && o.checkpoints.some(c => c.value === o.current) ? o.current : (o.checkpoints[0]?.value || '');
      if (o.samplers.length && !o.samplers.includes(p.sampler)) p.sampler = o.samplers.includes('Euler a') ? 'Euler a' : o.samplers.includes('euler_ancestral') ? 'euler_ancestral' : o.samplers[0];
      if (o.schedulers.length && !o.schedulers.includes(p.scheduler)) p.scheduler = o.schedulers[0];
      if (o.vaes.length && !o.vaes.includes(p.vae)) p.vae = o.vaes[0];
    } catch (e) { g.opts[g.pkgId] = { error: e.message }; }
    renderSide();
  }

  async function show(prm = {}) {
    params();
    pickEngine();
    if (prm.pkgId && K.generators().some(x => x.id === prm.pkgId)) g.pkgId = prm.pkgId;
    if (prm.reuse) applyReuse(prm.reuse);
    if (prm.init) { setInit(prm.init); g.mode = 'img2img'; }
    renderSide(); renderStage(); renderStrip();
    loadOptions();
    if (!g.results.length) {
      const h = await kiln.gen.history();
      g.results = h.slice(0, 30).flatMap(x => x.images.map(p => ({ path: p, entry: x })));
      renderStrip();
    }
  }

  /* ---------- left side ---------- */
  function engineCard() {
    const gens = K.generators();
    const startable = K.state.packages.filter(p => p.catalog?.backend);
    const starting = K.state.running.find(r => r.state === 'starting' && r.backend);
    const r = g.pkgId && gens.find(x => x.id === g.pkgId);
    if (g.pkgId && !r) g.pkgId = null;
    if (r) {
      const o = g.opts[g.pkgId];
      return `<div class="engine ok"><span class="dot"></span><div class="t"><b>${esc(r.name)}</b><small>${o?.loading ? 'Reading its models…' : o?.error ? esc(o.error) : `${o?.checkpoints?.length || 0} checkpoints · ${r.backend === 'comfy' ? 'ComfyUI workflow' : 'sdapi'}`}</small></div>
        ${gens.length > 1 ? `<button class="icon-btn sm" id="gEngine" title="Switch engine">${ic('swap', 15)}</button>` : ''}
        <button class="icon-btn sm" id="gRefresh" title="Reload models">${ic('refresh', 15)}</button></div>`;
    }
    if (starting) return `<div class="engine"><span class="spinner"></span><div class="t"><b>Starting ${esc(starting.name)}…</b><small>First starts can take a few minutes while it installs things.</small></div><button class="btn sm" id="gConsole">Console</button></div>`;
    if (!startable.length) return `<div class="engine"><span class="dot"></span><div class="t"><b>No engine installed</b><small>Install ComfyUI or Forge Neo to generate here.</small></div><button class="btn sm primary" data-go="packages">Install</button></div>`;
    const def = startable.find(p => p.id === K.state.settings.defaultPackageId) || startable[0];
    return `<div class="engine"><span class="dot"></span><div class="t"><b>${esc(def.name)} isn’t running</b><small>Kiln generates through it.</small></div><button class="btn sm primary" id="gLaunch" data-id="${def.id}">${ic('play', 13)} Launch</button>${startable.length > 1 ? `<button class="icon-btn sm" id="gLaunchOther">${ic('chevronDown', 14)}</button>` : ''}</div>`;
  }
  function sel(id, list, value, labelFn = (x) => x) {
    return `<select class="input" id="${id}">${(list || []).map(x => { const v = typeof x === 'object' ? x.value : x; const l = typeof x === 'object' ? x.label : labelFn(x); return `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}${value && !(list || []).some(x => (typeof x === 'object' ? x.value : x) === value) ? `<option value="${esc(value)}" selected>${esc(value)}</option>` : ''}</select>`;
  }
  function range(id, label, value, min, max, step) {
    return `<div class="field"><span>${label}</span><div class="range"><input type="range" id="${id}R" min="${min}" max="${max}" step="${step}" value="${esc(value)}"><input class="input sm" id="${id}" value="${esc(value)}"></div></div>`;
  }
  function group(id, title, body, open = true) { return `<div class="group ${open ? '' : 'closed'}" data-group="${id}"><button class="group-h">${title}${ic('chevronDown', 15)}</button><div class="group-b">${body}</div></div>`; }
  function sizeIcon(w, h) { const m = Math.max(w, h); return `<i style="width:${Math.round(12 * w / m)}px;height:${Math.round(12 * h / m)}px"></i>`; }

  function renderSide() {
    const s = $('#gSide', el);
    if (!s) return;
    const p = params();
    const o = g.opts[g.pkgId] || {};
    const loras = parseLoras(p.positive);
    lastLoraCount = loras.length;
    const sizes = (K.state.settings.sizes || []).map(x => x.split(/\s*x\s*/i).map(Number)).filter(x => x[0] && x[1]);
    const closed = K.state.settings.genClosed || {};
    s.innerHTML = `
      ${engineCard()}
      <div class="seg" style="width:100%;margin-bottom:14px"><button data-mode="txt2img" class="${g.mode === 'txt2img' ? 'on' : ''}" style="flex:1;justify-content:center">${ic('quote', 14)} Text to image</button><button data-mode="img2img" class="${g.mode === 'img2img' ? 'on' : ''}" style="flex:1;justify-content:center">${ic('image', 14)} Image to image</button></div>
      ${g.mode === 'img2img' ? `<div class="field"><span>Starting image</span><div class="init-drop drop-ok" id="gInit">${g.init ? `<img src="${g.init}" alt="">` : ic('upload', 26)}<div>${g.init ? 'Drop or click to replace' : 'Drop an image, paste one, or click to choose'}</div></div></div>
        ${range('gDen', 'How much to change it', p.denoise ?? 0.6, 0, 1, 0.01)}` : ''}
      <div class="field prompt-box" style="margin-bottom:0"><span>Prompt</span><textarea class="input no-enter" id="gPos" placeholder="Describe the image. Type to get tag suggestions.">${esc(p.positive)}</textarea><div class="ac" id="gAc" hidden></div></div>
      <div class="prompt-tools">
        <button class="btn ghost sm" id="gSaved">${ic('bookmark', 14)} Saved</button>
        <button class="btn ghost sm" id="gSave">${ic('plus', 14)} Save</button>
        <button class="btn ghost sm" id="gAddLora">${ic('cube', 14)} LoRA</button>
        <button class="btn ghost sm" id="gAddEmb">${ic('tag', 14)} Embedding</button>
      </div>
      ${loras.length ? `<div class="lora-chips">${loras.map((l, i) => `<div class="lora-chip" data-l="${i}"><b title="${esc(l.name)}">${esc(l.name)}</b><input type="range" min="-1" max="2" step="0.05" value="${l.weight}"><span class="w">${l.weight.toFixed(2)}</span><button class="icon-btn sm" data-rm="${i}">${ic('x', 13)}</button></div>`).join('')}</div>` : ''}
      <div class="field prompt-box neg"><span>Leave out</span><textarea class="input no-enter" id="gNeg" placeholder="e.g. blurry, low quality, extra fingers">${esc(p.negative || '')}</textarea></div>
      ${group('model', 'Model', `
        <div class="field"><span>Checkpoint</span>${o.checkpoints ? sel('gCk', o.checkpoints, p.checkpoint) : `<select class="input" disabled><option>${o.loading ? 'Loading…' : g.pkgId ? 'Unavailable' : 'Start an engine first'}</option></select>`}</div>
        <div class="field"><span>VAE</span>${o.vaes ? sel('gVae', o.vaes, p.vae) : '<select class="input" disabled><option>Automatic</option></select>'}</div>`, !closed.model)}
      ${group('size', 'Size', `
        <div class="sizes">${sizes.map(([w, h]) => `<button data-size="${w}x${h}" class="${w === Number(p.width) && h === Number(p.height) ? 'on' : ''}">${sizeIcon(w, h)}${w}×${h}</button>`).join('')}</div>
        <div class="row" style="margin-bottom:12px"><input class="input" id="gW" value="${esc(p.width)}" aria-label="Width"><button class="icon-btn" id="gSwap" title="Swap width and height">${ic('swap', 15)}</button><input class="input" id="gH" value="${esc(p.height)}" aria-label="Height"></div>
        <div class="fields-2"><label class="field"><span>Images at once</span><input class="input" id="gBs" type="number" min="1" max="8" value="${esc(p.batchSize)}"></label><label class="field"><span>Repeat</span><input class="input" id="gBc" type="number" min="1" max="100" value="${esc(p.batchCount)}"></label></div>`, !closed.size)}
      ${group('settings', 'Sampling', `
        ${range('gSteps', 'Steps', p.steps, 1, 80, 1)}
        ${range('gCfg', 'Prompt strength (CFG)', p.cfg, 1, 20, 0.5)}
        <div class="fields-2"><div class="field"><span>Sampler</span>${sel('gSam', o.samplers || [p.sampler], p.sampler)}</div><div class="field"><span>Scheduler</span>${sel('gSch', o.schedulers || [p.scheduler], p.scheduler)}</div></div>
        <div class="field"><span>Seed</span><div class="row"><input class="input" id="gSeed" value="${esc(p.seed)}" placeholder="-1 is random"><button class="icon-btn" id="gDice" title="Random each time">${ic('dice', 16)}</button><button class="icon-btn" id="gLast" title="Reuse the last seed">${ic('history', 16)}</button></div></div>
        <label class="field"><span>Clip skip</span><input class="input" id="gClip" type="number" min="1" max="12" value="${esc(p.clipSkip || 1)}"></label>`, !closed.settings)}
      ${g.mode === 'txt2img' ? group('hires', 'Upscale while generating (hires fix)', `
        <label class="opt" style="padding-top:0"><div class="t"><b>Turn on</b><small>Generates small, then refines at a larger size for more detail.</small></div><span class="switch"><input type="checkbox" id="gHr" ${p.hires ? 'checked' : ''}><i></i></span></label>
        ${p.hires ? `${range('gHrS', 'Scale', p.hiresScale, 1, 4, 0.05)}<div class="field"><span>Upscaler</span>${sel('gHrU', o.upscalers || ['Latent'], p.hiresUpscaler)}</div>${range('gHrD', 'Change amount', p.hiresDenoise, 0, 1, 0.01)}<label class="field"><span>Refine steps (0 = same as Steps)</span><input class="input" id="gHrSt" type="number" min="0" max="80" value="${esc(p.hiresSteps)}"></label>` : ''}`, !closed.hires) : ''}`;
    bindSide(s);
  }

  function bindSide(s) {
    const p = params();
    const set = (k, v) => { p[k] = v; save(); };
    $$('[data-go]', s).forEach(b => b.onclick = () => K.go(b.dataset.go));
    $('#gLaunch', s)?.addEventListener('click', (e) => window.Home.launch(e.currentTarget.dataset.id));
    $('#gLaunchOther', s)?.addEventListener('click', (e) => K.menuAt(e.currentTarget, K.state.packages.filter(x => x.catalog?.backend).map(x => ({ label: `Launch ${x.name}`, icon: 'play', onClick: () => window.Home.launch(x.id) })), 'right'));
    $('#gConsole', s)?.addEventListener('click', () => K.go('packages', { id: K.state.running.find(r => r.state === 'starting')?.id, tab: 'console' }));
    $('#gRefresh', s)?.addEventListener('click', () => loadOptions(true));
    $('#gEngine', s)?.addEventListener('click', (e) => K.menuAt(e.currentTarget, K.generators().map(r => ({ label: r.name, checked: r.id === g.pkgId, onClick: () => { g.pkgId = r.id; loadOptions(); renderSide(); } })), 'right'));
    $$('[data-mode]', s).forEach(b => b.onclick = () => { g.mode = b.dataset.mode; renderSide(); });
    $$('.group-h', s).forEach(b => b.onclick = () => {
      const gr = b.parentElement; gr.classList.toggle('closed');
      K.saveSettings({ genClosed: { ...(K.state.settings.genClosed || {}), [gr.dataset.group]: gr.classList.contains('closed') } });
    });
    const pos = $('#gPos', s);
    pos.oninput = () => { set('positive', pos.value); autocomplete(pos); syncLoraChips(); };
    pos.onkeydown = (e) => acKey(e, pos);
    pos.onblur = () => setTimeout(() => { $('#gAc', el).hidden = true; }, 150);
    const neg = $('#gNeg', s);
    neg.oninput = () => set('negative', neg.value);
    const bindRange = (id, key, num = Number) => {
      const a = $('#' + id, s), r = $('#' + id + 'R', s);
      if (!a) return;
      r.oninput = () => { a.value = r.value; set(key, num(r.value)); };
      a.onchange = () => { r.value = a.value; set(key, num(a.value)); };
    };
    bindRange('gSteps', 'steps'); bindRange('gCfg', 'cfg'); bindRange('gDen', 'denoise'); bindRange('gHrS', 'hiresScale'); bindRange('gHrD', 'hiresDenoise');
    const bindVal = (id, key, num) => { const x = $('#' + id, s); if (x) x.onchange = () => set(key, num ? Number(x.value) : x.value); };
    bindVal('gCk', 'checkpoint'); bindVal('gVae', 'vae'); bindVal('gSam', 'sampler'); bindVal('gSch', 'scheduler'); bindVal('gHrU', 'hiresUpscaler');
    bindVal('gW', 'width', 1); bindVal('gH', 'height', 1); bindVal('gBs', 'batchSize', 1); bindVal('gBc', 'batchCount', 1); bindVal('gClip', 'clipSkip', 1); bindVal('gHrSt', 'hiresSteps', 1);
    const seed = $('#gSeed', s); seed.onchange = () => set('seed', Number(seed.value) || -1);
    $('#gDice', s).onclick = () => { seed.value = -1; set('seed', -1); };
    $('#gLast', s).onclick = () => { const last = g.results.find(r => r.entry?.seed != null); if (last) { seed.value = last.entry.seed; set('seed', Number(last.entry.seed)); } else K.toast('No previous seed yet'); };
    $('#gSwap', s).onclick = () => { const w = p.width; set('width', p.height); set('height', w); renderSide(); };
    $$('[data-size]', s).forEach(b => b.onclick = () => { const [w, h] = b.dataset.size.split('x').map(Number); set('width', w); set('height', h); renderSide(); });
    $('#gHr', s)?.addEventListener('change', (e) => { set('hires', e.target.checked); renderSide(); });
    $('#gSaved', s).onclick = savedPrompts;
    $('#gSave', s).onclick = () => window.Prompts.edit({ positive: p.positive, negative: p.negative });
    $('#gAddLora', s).onclick = () => pickModel(['Lora', 'LyCORIS'], 'Add a LoRA');
    $('#gAddEmb', s).onclick = () => pickModel(['Embeddings'], 'Add an embedding');
    $$('.lora-chip', s).forEach(c => {
      const i = Number(c.dataset.l);
      const r = $('input', c);
      r.oninput = () => { $('.w', c).textContent = Number(r.value).toFixed(2); setLoraWeight(i, Number(r.value)); };
      $('[data-rm]', c).onclick = () => { removeLora(i); renderSide(); };
    });
    const drop = $('#gInit', s);
    if (drop) {
      drop.onclick = async () => { const d = await kiln.gen.pickImage(); if (d) { setInit(d); renderSide(); } };
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = async (e) => {
        e.preventDefault(); drop.classList.remove('over');
        const f = e.dataTransfer.files[0];
        if (f) { setInit(await blobToDataUrl(f)); renderSide(); return; }
        const url = e.dataTransfer.getData('text/uri-list');
        if (url) { try { setInit(await kiln.gen.imageFromUrl(url)); renderSide(); } catch { K.toast('Couldn’t load that image', 'error'); } }
      };
    }
  }
  function blobToDataUrl(b) { return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); }
  function setInit(d) { g.init = d; }
  document.addEventListener('paste', async (e) => {
    if (K.state.page !== 'generate' || g.mode !== 'img2img') return;
    const it = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (it) { setInit(await blobToDataUrl(it.getAsFile())); renderSide(); }
  });

  /* ---------- LoRA tokens in the prompt ---------- */
  function parseLoras(text) { const out = []; let m; LORA_RE.lastIndex = 0; while ((m = LORA_RE.exec(text || ''))) out.push({ name: m[1], weight: Number(m[2] ?? 1), index: m.index, raw: m[0] }); return out; }
  function setLoraWeight(i, w) {
    const p = params(); const l = parseLoras(p.positive)[i]; if (!l) return;
    p.positive = p.positive.slice(0, l.index) + `<lora:${l.name}:${+w.toFixed(2)}>` + p.positive.slice(l.index + l.raw.length);
    $('#gPos', el).value = p.positive; save();
  }
  function removeLora(i) {
    const p = params(); const l = parseLoras(p.positive)[i]; if (!l) return;
    p.positive = (p.positive.slice(0, l.index) + p.positive.slice(l.index + l.raw.length)).replace(/,\s*,/g, ',').replace(/^\s*,\s*|\s*,\s*$/g, '').trim();
    save();
  }
  let lastLoraCount = -1;
  function syncLoraChips() { const n = parseLoras(params().positive).length; if (n !== lastLoraCount) { lastLoraCount = n; const caret = $('#gPos', el).selectionStart; renderSide(); const t = $('#gPos', el); t.focus(); t.selectionStart = t.selectionEnd = caret; } }
  function insertText(text) {
    const t = $('#gPos', el); const p = params();
    const at = t.selectionStart ?? p.positive.length;
    const before = p.positive.slice(0, at), after = p.positive.slice(at);
    const sep = before && !/[,\s]$/.test(before) ? ', ' : '';
    p.positive = before + sep + text + (after && !/^[,\s]/.test(after) ? ', ' : '') + after;
    save(); renderSide();
  }

  async function pickModel(types, title) {
    const all = await kiln.lib.list({});
    const list = all.filter(m => types.includes(m.type));
    K.modal({
      title, wide: true, subtitle: types.includes('Lora') ? 'Click to add it to your prompt. Trigger words are added too.' : 'Click to add it to your prompt.',
      body: list.length ? `<div class="search" style="margin-bottom:12px">${ic('search', 15)}<input class="input" id="pmQ" placeholder="Search your ${types.includes('Lora') ? 'LoRAs' : 'embeddings'}" autofocus></div>
        <div class="grid" style="--min:150px" id="pmGrid">${list.map((m, i) => `<button class="card" data-i="${i}" data-q="${esc((m.title + ' ' + m.file + ' ' + (m.info?.baseModel || '')).toLowerCase())}"><div class="card-img ${K.nsfwClass(m.info?.nsfw)}" style="aspect-ratio:1">${m.preview ? `<img src="${kiln.file(m.preview, 300)}" loading="lazy" alt="">` : `<span class="ph-ic">${ic('cube', 30)}</span>`}${m.info?.baseModel ? `<span class="tl"><span class="badge">${esc(m.info.baseModel)}</span></span>` : ''}</div><div class="card-body"><b>${esc(m.title)}</b><small>${esc(m.file)}</small></div></button>`).join('')}</div>`
        : `<div class="empty">${ic('cube', 36)}<h3>None in your library yet</h3><p>Find some on CivitAI and they’ll show up here.</p></div>`,
      actions: list.length ? [{ label: 'Close' }] : [{ label: 'Close' }, { label: 'Find models', kind: 'primary', onClick: () => K.go('discover', { type: types[0] }) }],
      onMount: (m, close) => {
        $('#pmQ', m)?.addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); $$('[data-q]', m).forEach(c => c.hidden = q && !c.dataset.q.includes(q)); });
        $$('[data-i]', m).forEach(b => b.onclick = () => {
          const mm = list[Number(b.dataset.i)];
          if (mm.type === 'Embeddings') insertText(mm.name);
          else insertText(`<lora:${mm.name}:1>${mm.info?.trainedWords?.length ? ', ' + mm.info.trainedWords.slice(0, 3).join(', ') : ''}`);
          close();
        });
      }
    });
  }

  /* ---------- tag autocomplete ---------- */
  let acReq = 0;
  const CAT_COLORS = ['#ffb35c', '#ff7a5c', '#f6c64f', '#d79bff', '#7ec8ff', '#9bd36a'];
  async function autocomplete(t) {
    const ac = $('#gAc', el);
    const at = t.selectionStart;
    const before = t.value.slice(0, at);
    const m = before.match(/(?:^|[,\n(\[])\s*([^,\n()<>[\]]{2,})$/);
    if (!m || /<lora:[^>]*$/.test(before)) { ac.hidden = true; return; }
    const q = m[1].trim();
    const id = ++acReq;
    const res = await kiln.tags.search(q);
    if (id !== acReq) return;
    if (!res.length) { ac.hidden = true; return; }
    g.acIndex = 0;
    g.acItems = res; g.acQuery = m[1];
    ac.style.top = (t.offsetTop + t.offsetHeight + 2) + 'px';
    ac.innerHTML = res.map((r, i) => `<button data-i="${i}" class="${i === 0 ? 'on' : ''}"><span class="cat" style="background:${CAT_COLORS[r.category % CAT_COLORS.length]}"></span>${esc(r.tag.replace(/_/g, ' '))}${r.alias ? `<span class="muted small">← ${esc(r.alias)}</span>` : ''}<span class="n">${K.fmtNum(r.count)}</span></button>`).join('');
    ac.hidden = false;
    $$('button', ac).forEach(b => b.onmousedown = (e) => { e.preventDefault(); acAccept(t, Number(b.dataset.i)); });
  }
  function acKey(e, t) {
    const ac = $('#gAc', el);
    if (ac.hidden) return;
    const n = g.acItems.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); g.acIndex = (g.acIndex + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; $$('button', ac).forEach((b, i) => b.classList.toggle('on', i === g.acIndex)); }
    else if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') { e.preventDefault(); acAccept(t, g.acIndex); }
    else if (e.key === 'Escape') ac.hidden = true;
  }
  function acAccept(t, i) {
    const r = g.acItems[i];
    const at = t.selectionStart;
    const before = t.value.slice(0, at), after = t.value.slice(at);
    const q = g.acQuery;
    const tag = r.tag.replace(/_/g, ' ').replace(/([()])/g, '\\$1');
    const lead = q.match(/^\s*/)[0];
    const nb = before.slice(0, before.length - q.length) + lead + tag + ', ';
    t.value = nb + after.replace(/^\s*,?\s*/, '');
    t.selectionStart = t.selectionEnd = nb.length;
    params().positive = t.value; save();
    $('#gAc', el).hidden = true;
  }

  /* ---------- saved prompts ---------- */
  function savedPrompts() {
    const list = K.state.prompts;
    K.modal({
      title: 'Saved prompts', wide: true,
      body: list.length ? `<div class="search" style="margin-bottom:12px">${ic('search', 15)}<input class="input" id="spQ" placeholder="Search by name, text or tag" autofocus></div>
        <div class="grid" style="--min:240px">${list.map(p => `<button class="prompt-card" style="text-align:left" data-id="${p.id}" data-q="${esc((p.name + ' ' + p.positive + ' ' + p.tags.join(' ')).toLowerCase())}"><div class="top"><b>${esc(p.name)}</b>${p.favorite ? ic('star', 14, 'on') : ''}</div><div class="pt">${esc(p.positive)}</div>${p.negative ? `<div class="pn">Leave out: ${esc(p.negative)}</div>` : ''}${p.tags.length ? `<div class="chips">${p.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}</button>`).join('')}</div>`
        : `<div class="empty">${ic('bookmark', 36)}<h3>No saved prompts yet</h3><p>Press Save under the prompt to keep one for later.</p></div>`,
      actions: [{ label: 'Manage prompts', onClick: () => K.go('prompts') }, { label: 'Close' }],
      onMount: (m, close) => {
        $('#spQ', m)?.addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); $$('[data-q]', m).forEach(c => c.hidden = q && !c.dataset.q.includes(q)); });
        $$('[data-id]', m).forEach(b => b.onclick = () => { usePrompt(list.find(x => x.id === b.dataset.id)); close(); });
      }
    });
  }
  function usePrompt(pr) {
    const p = params();
    if (typeof pr === 'string') { p.positive = pr; }
    else { p.positive = pr.positive || ''; p.negative = pr.negative || ''; if (pr.params) Object.assign(p, pr.params); if (pr.id) kiln.prompts.used(pr.id); }
    save(); renderSide();
  }
  function applyReuse(d) {
    const p = params();
    p.positive = d.positive || p.positive; p.negative = d.negative ?? p.negative;
    if (d.params) {
      for (const k of ['steps', 'cfg', 'sampler', 'scheduler', 'width', 'height', 'checkpoint', 'vae', 'clipSkip', 'hires', 'hiresScale', 'hiresUpscaler', 'hiresSteps', 'hiresDenoise', 'denoise', 'batchSize', 'batchCount']) if (d.params[k] !== undefined && d.params[k] !== null) p[k] = d.params[k];
      const sd = Number(d.settings?.Seed); if (!isNaN(sd) && d.settings?.Seed != null) p.seed = sd;
      save(); return;
    }
    const s = d.settings || {};
    const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
    const steps = num(s.Steps ?? s.steps), cfg = num(s['CFG scale'] ?? s.cfg), seed = num(s.Seed ?? s.seed);
    if (steps) p.steps = steps; if (cfg) p.cfg = cfg; if (seed != null && !isNaN(seed)) p.seed = seed;
    const sampler = s.Sampler || s.sampler; if (sampler) p.sampler = sampler;
    const sch = s['Schedule type'] || s.scheduler; if (sch) p.scheduler = sch;
    const size = s.Size || (s.width && s.height ? `${s.width}x${s.height}` : '');
    if (size) { const [w, h] = String(size).split('x').map(Number); if (w && h) { p.width = w; p.height = h; } }
    if (s.checkpoint) p.checkpoint = s.checkpoint;
    save();
  }

  /* ---------- run ---------- */
  async function run() {
    if (g.busy) return;
    const p = params();
    if (!g.pkgId) { K.toast('Launch an engine first', 'error'); return; }
    if (!p.positive.trim()) { K.toast('Write a prompt first', 'error'); $('#gPos', el)?.focus(); return; }
    if (g.mode === 'img2img' && !g.init) { K.toast('Add a starting image', 'error'); return; }
    g.busy = true; g.progress = 0; g.preview = null; g.step = 0; g.steps = p.steps; g.startedAt = Date.now(); g.jobId = null;
    $('#gGo', el).disabled = true; $('#gStop', el).hidden = false;
    renderStage();
    try {
      const r = await kiln.gen.run({ pkgId: g.pkgId, mode: g.mode, params: { ...p }, initImage: g.mode === 'img2img' ? g.init : null });
      const items = r.images.map(i => ({ path: i.path, entry: r.entry }));
      g.results.unshift(...items);
      g.current = items[0] || g.current;
      if (!items.length) K.toast('Stopped before any image finished');
    } catch (e) { K.fail(e); }
    g.busy = false; g.preview = null;
    $('#gGo', el).disabled = false; $('#gStop', el).hidden = true;
    renderStage(); renderStrip();
  }
  async function stop() { if (g.pkgId) await kiln.gen.interrupt(g.pkgId).catch(() => {}); }

  /* ---------- right side ---------- */
  function renderStage() {
    const st = $('#gStage', el);
    if (!st) return;
    const p = params();
    if (g.busy) {
      const elapsed = (Date.now() - g.startedAt) / 1000;
      const label = g.steps && g.step ? `Step ${g.step} of ${g.steps}${g.eta ? ` · about ${Math.ceil(g.eta)}s left` : ''}` : g.progress ? `${Math.round(g.progress * 100)}%` : elapsed > 4 ? 'Loading the model…' : 'Starting…';
      const ar = Number(p.width) / Number(p.height) || 1;
      const H = Math.min(st.clientHeight - 120, 640), W = Math.min(st.clientWidth - 80, H * ar);
      const h = W / ar;
      st.innerHTML = `<div class="firing" style="--p:${Math.max(0.02, g.progress)}"><div class="inner" style="width:${W}px;height:${h}px">${g.preview ? `<img src="${g.preview}" style="width:100%;height:100%;object-fit:contain" alt="">` : `<span class="spinner" style="width:28px;height:28px"></span>`}</div><div class="firing-label">${esc(label)}</div></div>`;
      return;
    }
    const c = g.current;
    if (!c) {
      st.innerHTML = `<div class="placeholder-shelf"><svg class="shelf-mark" viewBox="14 16 36 36" width="132" height="132" aria-hidden="true"><defs><linearGradient id="shA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc66b"/><stop offset=".6" stop-color="#ff8a3d"/><stop offset="1" stop-color="#ee5428"/></linearGradient><linearGradient id="shF" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffdea0"/><stop offset="1" stop-color="#ffb04f"/></linearGradient></defs><path d="M20.75 46.6V31.3a11.25 11.25 0 0 1 22.5 0v15.3" fill="none" stroke="url(#shA)" stroke-width="6.5" stroke-linecap="round"/><path class="shelf-flame" d="M32 25.6c3 3.9 6.3 6.9 6.3 12.4a6.25 6.5 0 0 1-12.5 0c0-3.5 1.4-5.6 3.1-7.2.4 2.2 1.4 3.6 2.7 4.1-.6-3.4-.5-6.6.4-9.3z" fill="url(#shF)"/></svg><h2>Ready when you are</h2><p>${g.pkgId ? 'Write a prompt and press Generate. Your images save to this profile’s gallery.' : 'Launch an engine on the left, then write a prompt.'}</p></div>`;
      return;
    }
    st.innerHTML = `<div class="frame"><img src="${kiln.file(c.path)}" alt="" draggable="true" id="gImg"></div>
      <div class="stage-actions">
        <button class="icon-btn" id="sInit" title="Use as starting image">${ic('image', 17)}</button>
        <button class="icon-btn" id="sReuse" title="Use these settings again">${ic('history', 17)}</button>
        <button class="icon-btn" id="sUp" title="Upscale 2×">${ic('expand', 17)}</button>
        <button class="icon-btn" id="sSavePr" title="Save the prompt">${ic('bookmark', 17)}</button>
        <button class="icon-btn" id="sCopy" title="Copy image">${ic('copy', 17)}</button>
        <button class="icon-btn" id="sOpen" title="Open in gallery">${ic('grid', 17)}</button>
        <button class="icon-btn" id="sShow" title="Show in folder">${ic('folder', 17)}</button>
      </div>`;
    $('#gImg', st).ondragstart = (e) => { e.preventDefault(); kiln.gal.startDrag(c.path); };
    $('#sInit', st).onclick = async () => { setInit(await kiln.gal.dataUrl(c.path)); g.mode = 'img2img'; renderSide(); K.toast('Set as the starting image'); };
    $('#sReuse', st).onclick = async () => { const d = await kiln.gal.details(c.path); applyReuse(d); renderSide(); K.toast('Settings loaded'); };
    $('#sUp', st).onclick = async () => {
      if (!g.pkgId) return K.toast('Launch an engine first', 'error');
      const o = g.opts[g.pkgId];
      const ups = (o?.upscalers || []).filter(u => !/^Latent/.test(u));
      const doIt = async (u) => { K.toast('Upscaling…'); try { const r = await kiln.gen.upscale({ pkgId: g.pkgId, imagePath: c.path, scale: 2, upscaler: u }); const it = { path: r.path, entry: c.entry }; g.results.unshift(it); g.current = it; renderStage(); renderStrip(); K.toast('Upscaled', 'ok'); } catch (e) { K.fail(e); } };
      if (ups.length > 1) K.menuAt($('#sUp', st), ups.slice(0, 14).map(u => ({ label: u, onClick: () => doIt(u) })), 'right'); else doIt(ups[0]);
    };
    $('#sSavePr', st).onclick = async () => { const d = await kiln.gal.details(c.path); window.Prompts.edit({ positive: d.positive, negative: d.negative }); };
    $('#sCopy', st).onclick = async () => { await kiln.gal.copy(c.path); K.toast('Copied', 'ok'); };
    $('#sOpen', st).onclick = () => K.go('gallery', { open: c.path });
    $('#sShow', st).onclick = () => kiln.gal.show(c.path);
  }
  function renderStrip() {
    const s = $('#gStrip', el);
    if (!s) return;
    s.innerHTML = g.results.length ? g.results.slice(0, 60).map((r, i) => `<button data-i="${i}" class="${r === g.current ? 'on' : ''}"><img src="${kiln.file(r.path, 200)}" loading="lazy" alt="" data-fallback></button>`).join('') : `<span class="strip-empty small">Images you generate line up here.</span>`;
    $$('[data-i]', s).forEach(b => b.onclick = () => { g.current = g.results[Number(b.dataset.i)]; renderStage(); renderStrip(); });
  }
  window.addEventListener('resize', K.debounce(() => { if (K.state.page === 'generate') renderStage(); }, 150));

  K.register('generate', { title: 'Generate', mount, show, reset });
  window.Generate = { usePrompt: (p) => { usePrompt(p); K.go('generate'); } };
})();
