/* Kiln — Find models: CivitAI, Hugging Face, or any pasted link. Downloads go into the profile's library. */
(() => {
  const { $, $$, esc } = K;
  let el = null;
  const CIV_TYPES = [['Checkpoint', 'Checkpoints'], ['LORA', 'LoRA'], ['LoCon', 'LyCORIS'], ['TextualInversion', 'Embeddings'], ['VAE', 'VAE'], ['Controlnet', 'ControlNet'], ['Upscaler', 'Upscalers'], ['UNet', 'UNet'], ['TextEncoder', 'Text encoders'], ['MotionModule', 'Motion'], ['Detection', 'Detailers'], ['Workflows', 'Workflows']];
  const BASES = ['Illustrious', 'Pony', 'NoobAI', 'SDXL 1.0', 'SD 1.5', 'Flux.1 D', 'Flux.1 S', 'Flux.2 D', 'Qwen', 'ZImageTurbo', 'Wan Video 2.2 T2V-A14B', 'Wan Video 2.2 I2V-A14B', 'Chroma', 'HiDream', 'SD 3.5', 'Hunyuan Video', 'LTXV'];
  const st = { source: 'civitai', q: '', types: [], base: '', sort: 'Most Downloaded', period: 'AllTime', items: [], cursor: null, loading: false, error: null, installed: null, hf: { q: '', items: [], loading: false } };
  const SORTS = ['Most Downloaded', 'Highest Rated', 'Newest'];
  const PERIODS = [['AllTime', 'All time'], ['Year', 'This year'], ['Month', 'This month'], ['Week', 'This week'], ['Day', 'Today']];

  function mount(e) {
    el = e;
    el.innerHTML = `<div class="toolbar" style="padding-bottom:12px">
        <div class="seg" id="dsSrc"><button data-s="civitai">CivitAI</button><button data-s="hf">Hugging Face</button><button data-s="link">${ic('link', 13)} Paste a link</button></div>
        <div class="spacer"></div>
        <button class="btn sm ghost" id="dsBrowse">${ic('globe', 14)} Browse the site</button>
      </div>
      <div id="dsBar"></div>
      <div class="scroll" id="dsScroll"><div class="content-pad" id="dsBody"></div></div>`;
    $$('[data-s]', el).forEach(b => b.onclick = () => { st.source = b.dataset.s; renderBar(); renderBody(); if (st.source === 'civitai' && !st.items.length) search(); if (st.source === 'hf' && !st.hf.items.length && !st.hf.q) renderBody(); });
    $('#dsBrowse', el).onclick = () => window.Browser.openUrl(st.source === 'hf' ? 'https://huggingface.co/models?pipeline_tag=text-to-image&sort=trending' : 'https://civitai.com/models');
    $('#dsScroll', el).onscroll = (ev) => { const s = ev.target; if (st.source === 'civitai' && s.scrollTop + s.clientHeight > s.scrollHeight - 700 && st.cursor && !st.loading) search(true); };
    K.bus.on('downloads:done', () => { st.installed = null; });
  }
  function reset() { st.items = []; st.cursor = null; st.installed = null; st.hf.items = []; }
  const nsfwOk = () => (K.state.settings.nsfw || 'blur') !== 'hide';

  /* ---------- toolbar ---------- */
  function renderBar() {
    $$('[data-s]', el).forEach(b => b.classList.toggle('on', b.dataset.s === st.source));
    $('#dsBrowse', el).hidden = st.source === 'link';
    const bar = $('#dsBar', el);
    if (st.source === 'civitai') {
      bar.innerHTML = `<div class="toolbar" style="border-top:0;padding-top:0">
        <form class="search" id="dsForm">${ic('search', 15)}<input class="input" id="dsQ" value="${esc(st.q)}" placeholder="Search CivitAI — try “watercolor”, “pony realism”, “anime lineart”"></form>
        <select class="input" id="dsBase" style="width:auto"><option value="">Any base model</option>${BASES.map(b => `<option ${b === st.base ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
        <select class="input" id="dsSort" style="width:auto">${SORTS.map(s => `<option ${s === st.sort ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <select class="input" id="dsPer" style="width:auto" ${st.q ? 'disabled' : ''}>${PERIODS.map(([v, l]) => `<option value="${v}" ${v === st.period ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <div class="chips" style="padding:0 24px 12px;border-bottom:1px solid var(--line)">${CIV_TYPES.map(([v, l]) => `<button class="chip ${st.types.includes(v) ? 'on' : ''}" data-t="${v}">${esc(l)}</button>`).join('')}</div>`;
      $('#dsForm', bar).onsubmit = (e) => { e.preventDefault(); st.q = $('#dsQ', bar).value.trim(); search(); renderBar(); };
      $('#dsBase', bar).onchange = (e) => { st.base = e.target.value; search(); };
      $('#dsSort', bar).onchange = (e) => { st.sort = e.target.value; search(); };
      $('#dsPer', bar).onchange = (e) => { st.period = e.target.value; search(); };
      $$('[data-t]', bar).forEach(b => b.onclick = () => { const t = b.dataset.t; st.types = st.types.includes(t) ? st.types.filter(x => x !== t) : [...st.types, t]; b.classList.toggle('on'); search(); });
    } else if (st.source === 'hf') {
      bar.innerHTML = `<div class="toolbar" style="border-top:0;padding-top:0"><form class="search" id="hfForm">${ic('search', 15)}<input class="input" id="hfQ" value="${esc(st.hf.q)}" placeholder="Search Hugging Face — e.g. flux gguf, sdxl vae, controlnet"></form>
        ${K.state.settings.hasHfToken ? '<span class="badge ok">Signed in with a token</span>' : `<button class="btn ghost sm" id="hfTok">${ic('lock', 13)} Add a token for gated models</button>`}</div>`;
      $('#hfForm', bar).onsubmit = (e) => { e.preventDefault(); st.hf.q = $('#hfQ', bar).value.trim(); hfSearch(); };
      $('#hfTok', bar)?.addEventListener('click', () => K.go('settings', { tab: 'accounts' }));
    } else bar.innerHTML = '';
  }

  /* ---------- CivitAI ---------- */
  async function installed() { if (!st.installed) st.installed = await kiln.lib.installed(); return st.installed; }
  async function search(more = false) {
    if (st.loading) return;
    st.loading = true; st.error = null;
    if (!more) { st.items = []; st.cursor = null; renderBody(); }
    try {
      const r = await kiln.civ.search({ query: st.q, types: st.types, baseModels: st.base ? [st.base] : [], sort: st.sort, period: st.period, nsfw: nsfwOk(), cursor: more ? st.cursor : '' });
      await installed();
      st.items.push(...r.items.filter(m => !st.items.some(x => x.id === m.id)));
      st.cursor = r.nextCursor;
    } catch (e) { st.error = e.message; }
    st.loading = false;
    renderBody();
  }
  function coverOf(m) {
    const v = m.versions[0];
    const imgs = (v?.images || []).filter(i => nsfwOk() || (i.nsfwLevel || 1) <= 2);
    return imgs.find(i => i.type === 'image') || imgs[0] || null;
  }
  function civCard(m, i) {
    const img = coverOf(m);
    const inst = st.installed?.models?.[m.id];
    const nsfw = img && (img.nsfwLevel || 1) > 2;
    return `<button class="card" data-i="${i}"><div class="card-img ${K.nsfwClass(nsfw)}">${img ? (img.type === 'video' ? `<video src="${esc(img.url)}" muted loop playsinline preload="none"></video>` : `<img src="${esc(img.thumb)}" alt="" loading="lazy" data-fallback>`) : `<span class="ph-ic">${ic('cube', 40)}</span>`}
      <span class="tl"><span class="badge">${esc(m.type)}</span>${m.versions[0]?.baseModel ? `<span class="badge">${esc(m.versions[0].baseModel)}</span>` : ''}</span>${inst ? `<span class="tr"><span class="badge ok">${ic('check', 11)} In library</span></span>` : ''}</div>
      <div class="card-body"><b title="${esc(m.name)}">${esc(m.name)}</b><div class="card-meta"><span>${ic('download', 13)}${K.fmtNum(m.stats.downloads)}</span><span>${ic('heart', 13)}${K.fmtNum(m.stats.likes)}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.creator)}</span></div></div></button>`;
  }
  function renderBody() {
    const b = $('#dsBody', el);
    if (st.source === 'link') return renderLink(b);
    if (st.source === 'hf') return renderHf(b);
    if (st.error && !st.items.length) { b.innerHTML = `<div class="empty">${ic('alert', 40)}<h3>Couldn’t reach CivitAI</h3><p>${esc(st.error)}</p><button class="btn" id="dsRetry">${ic('refresh', 15)} Try again</button></div>`; $('#dsRetry', b).onclick = () => search(); return; }
    if (!st.items.length && st.loading) { b.innerHTML = `<div class="empty"><span class="spinner" style="width:26px;height:26px"></span></div>`; return; }
    if (!st.items.length) { b.innerHTML = `<div class="empty">${ic('search', 40)}<h3>No models match</h3><p>Try fewer filters or another search.</p></div>`; return; }
    b.innerHTML = `<div class="grid" style="--min:210px">${st.items.map(civCard).join('')}</div><div class="load-more">${st.loading ? '<span class="spinner"></span>' : st.cursor ? '' : '<span class="muted small">That’s everything.</span>'}</div>`;
    $$('[data-i]', b).forEach(c => {
      c.onclick = () => civDetail(st.items[Number(c.dataset.i)]);
      const v = $('video', c); if (v) { c.onmouseenter = () => v.play().catch(() => {}); c.onmouseleave = () => v.pause(); }
    });
  }

  function sanitize(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const ok = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'A', 'IMG', 'CODE', 'PRE', 'BLOCKQUOTE', 'SPAN', 'DIV', 'HR', 'TABLE', 'TR', 'TD', 'TH', 'TBODY', 'THEAD']);
    const walk = (n) => {
      for (const c of [...n.children]) {
        if (!ok.has(c.tagName)) { c.replaceWith(...c.childNodes); continue; }
        for (const a of [...c.attributes]) { if (!((c.tagName === 'A' && a.name === 'href') || (c.tagName === 'IMG' && a.name === 'src'))) c.removeAttribute(a.name); }
        if (c.tagName === 'A' && !/^https?:/i.test(c.getAttribute('href') || '')) c.removeAttribute('href');
        if (c.tagName === 'IMG' && !/^https:/i.test(c.getAttribute('src') || '')) c.remove();
        walk(c);
      }
    };
    walk(doc.body);
    return doc.body.innerHTML;
  }
  async function civDetail(m, versionId) {
    let full = m;
    const { el: md, close } = K.modal({ title: m.name, subtitle: `${m.type} · by ${m.creator || 'unknown'}`, className: 'xwide', body: '<div class="empty"><span class="spinner"></span></div>', actions: [] });
    try { full = await kiln.civ.model(m.id); }
    catch (e) {
      if (!m.versions.length) { $('.modal-body', md).innerHTML = `<div class="empty">${ic('alert', 36)}<h3>Couldn’t load this model</h3><p>${esc(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))}</p></div>`; return; }
    }
    const h = $('.modal-head', md);
    if (h) { $('h2', h).textContent = full.name; const sub = $('p', h); if (sub) sub.textContent = `${full.type} · by ${full.creator || 'unknown'}`; }
    await installed();
    let vi = Math.max(0, full.versions.findIndex(v => v.id === versionId));
    const draw = () => {
      const v = full.versions[vi];
      const imgs = (v?.images || []).filter(i => nsfwOk() || (i.nsfwLevel || 1) <= 2);
      const files = [...(v?.files || [])].sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
      const type = window.KilnTypes.typeForCivitai(full.type);
      const tl = K.state.types.find(t => t.id === type);
      $('.modal-body', md).innerHTML = `
        ${full.versions.length > 1 ? `<div class="chips" style="margin-bottom:14px">${full.versions.slice(0, 14).map((x, n) => `<button class="chip ${n === vi ? 'on' : ''}" data-v="${n}">${esc(x.name)}${x.baseModel ? ` · ${esc(x.baseModel)}` : ''}${(st.installed?.versions || {})[x.id] ? ' ✓' : ''}</button>`).join('')}</div>` : ''}
        ${imgs.length ? `<div class="gallery-row" style="margin-bottom:18px">${imgs.slice(0, 12).map(i => `<div class="gi ${K.nsfwClass((i.nsfwLevel || 1) > 2)}">${i.type === 'video' ? `<video src="${esc(i.url)}" muted loop autoplay playsinline></video>` : `<img src="${esc(window.KilnThumb ? i.thumb : i.thumb)}" alt="" loading="lazy">`}</div>`).join('')}</div>` : ''}
        <div class="model-detail">
          <div>
            <div class="row wrap" style="margin-bottom:12px"><span class="badge">${esc(tl?.label || full.type)}</span>${v?.baseModel ? `<span class="badge info">${esc(v.baseModel)}</span>` : ''}${v?.earlyAccess ? '<span class="badge warn">Early access</span>' : ''}${full.nsfw ? '<span class="badge bad">Mature</span>' : ''}
              <span class="muted small">${ic('download', 12)}</span><span class="small">${K.fmtNum(full.stats.downloads)}</span><span class="muted small">${ic('heart', 12)}</span><span class="small">${K.fmtNum(full.stats.likes)}</span></div>
            ${v?.trainedWords?.length ? `<div class="field"><span>Trigger words · click to copy</span><div class="words">${v.trainedWords.map(w => `<button data-w="${esc(w)}">${esc(w)}</button>`).join('')}</div></div>` : ''}
            <div class="field"><span>About</span><div class="desc" id="dsDesc">${sanitize(v?.description ? v.description + '<hr>' + full.description : full.description) || '<span class="muted">No description.</span>'}</div></div>
          </div>
          <div>
            <div class="field"><span>Files</span>${files.map((f, n) => {
              const have = (st.installed?.versions || {})[v.id] && ((st.installed?.files || {})[f.name.toLowerCase()] || f.primary);
              return `<div class="file-row"><span class="dl-ic">${ic('cube', 16)}</span><div class="t"><b title="${esc(f.name)}">${esc(f.name)}</b><small>${K.fmtBytes(f.sizeKB * 1024)}${f.format ? ' · ' + esc(f.format) : ''}${f.fp ? ' · ' + esc(f.fp) : ''}${f.size ? ' · ' + esc(f.size) : ''}${f.type && f.type !== 'Model' ? ' · ' + esc(f.type) : ''}</small></div>
                ${have ? `<span class="badge ok">${ic('check', 11)} In library</span>` : `<button class="btn sm ${f.primary ? 'primary' : ''}" data-f="${n}">${ic('download', 13)} Download</button>`}</div>`;
            }).join('') || '<p class="muted">No files.</p>'}
            <small class="muted">Saves to ${esc(tl?.label || 'Other')} in ${esc(K.state.profile.libraryName)}${K.state.settings.hasCivitaiKey ? '' : '. Some models need a CivitAI API key (Settings → Accounts).'}</small></div>
            <div class="row" style="margin-top:14px"><button class="btn sm" id="dsOpen">${ic('globe', 13)} Open on CivitAI</button><button class="btn sm ghost" id="dsClose">Close</button></div>
          </div>
        </div>`;
      const body = $('.modal-body', md);
      $$('[data-v]', body).forEach(b => b.onclick = async () => { vi = Number(b.dataset.v); await installed(); draw(); });
      $$('[data-w]', body).forEach(b => b.onclick = () => { navigator.clipboard.writeText(b.dataset.w); K.toast('Copied', 'ok'); });
      $$('#dsDesc a[href]', body).forEach(a => a.onclick = (e) => { e.preventDefault(); close(); window.Browser.openUrl(a.href); });
      $('#dsOpen', body).onclick = () => { close(); window.Browser.openUrl(`https://civitai.com/models/${full.id}?modelVersionId=${v.id}`); };
      $('#dsClose', body).onclick = close;
      $$('[data-f]', body).forEach(b => b.onclick = async () => {
        const f = files[Number(b.dataset.f)];
        const cover = imgs.find(i => i.type === 'image' && (K.state.settings.nsfw === 'show' || (i.nsfwLevel || 1) <= 2));
        b.disabled = true;
        const r = await window.Downloads.startModel({ url: f.downloadUrl, name: f.name, type: f.type === 'VAE' ? 'VAE' : type, source: 'civitai', previewUrl: cover?.url || null,
          meta: { model: { id: full.id, name: full.name, type: full.type, nsfw: full.nsfw, tags: full.tags, description: full.description, creator: full.creator }, version: v, file: f } });
        if (r) { b.innerHTML = `${ic('check', 13)} Downloading`; st.installed = null; } else b.disabled = false;
      });
    };
    draw();
  }

  /* ---------- Hugging Face ---------- */
  async function hfSearch() {
    st.hf.loading = true; renderBody();
    try { st.hf.items = (await kiln.hf.search({ query: st.hf.q, filter: st.hf.q ? '' : 'text-to-image' })).items; st.hf.error = null; }
    catch (e) { st.hf.error = e.message; }
    st.hf.loading = false; renderBody();
  }
  async function renderHf(b) {
    if (st.hf.loading) { b.innerHTML = `<div class="empty"><span class="spinner" style="width:26px;height:26px"></span></div>`; return; }
    if (st.hf.error) { b.innerHTML = `<div class="empty">${ic('alert', 40)}<h3>Couldn’t reach Hugging Face</h3><p>${esc(st.hf.error)}</p></div>`; return; }
    if (!st.hf.q || !st.hf.items.length) {
      const ess = await kiln.hf.essentials();
      b.innerHTML = `${st.hf.q ? `<div class="empty" style="padding:28px">${ic('search', 34)}<h3>No repositories match</h3></div>` : ''}
        <div class="section-h"><h2>Essentials</h2><span class="muted small">VAEs, text encoders, ControlNets and upscalers most setups need</span></div>
        <div class="grid" style="--min:260px">${ess.map((e, i) => `<button class="cat-card" data-e="${i}" style="text-align:left"><div class="head"><span class="pkg-ic">${ic('cube', 17)}</span><div style="min-width:0"><b>${esc(e.repo.split('/')[1])}</b><small>${esc(e.repo.split('/')[0])} · ${esc(K.state.types.find(t => t.id === e.type)?.label || e.type)}</small></div></div><p>${esc(e.note)}</p></button>`).join('')}</div>`;
      $$('[data-e]', b).forEach(c => c.onclick = () => hfRepo(ess[Number(c.dataset.e)].repo, ess[Number(c.dataset.e)].type));
      return;
    }
    b.innerHTML = `<div class="list">${st.hf.items.map((r, i) => `<button class="list-row" data-r="${i}"><span class="pkg-ic">${esc(r.creator[0]?.toUpperCase() || '?')}</span><div style="flex:1;min-width:0"><b>${esc(r.id)}</b><div class="small muted">${esc(r.pipeline || 'model')} · updated ${K.ago(new Date(r.updatedAt).getTime())}${r.gated ? ' · needs access' : ''}</div></div><span class="card-meta"><span>${ic('download', 13)}${K.fmtNum(r.downloads)}</span><span>${ic('heart', 13)}${K.fmtNum(r.likes)}</span></span></button>`).join('')}</div>`;
    $$('[data-r]', b).forEach(c => c.onclick = () => hfRepo(st.hf.items[Number(c.dataset.r)].id));
  }
  async function hfRepo(repo, typeHint) {
    const { el: md, close } = K.modal({ title: repo, subtitle: 'Hugging Face', wide: true, body: '<div class="empty"><span class="spinner"></span></div>', actions: [] });
    let files = [];
    try { files = await kiln.hf.files(repo); }
    catch (e) { $('.modal-body', md).innerHTML = `<div class="empty">${ic('alert', 36)}<h3>Couldn’t list its files</h3><p>${esc(e.message)}${/token/i.test(e.message) ? '' : ''}</p><button class="btn" id="hfWeb">${ic('globe', 14)} Open in the browser</button></div>`; $('#hfWeb', md).onclick = () => { close(); window.Browser.openUrl(`https://huggingface.co/${repo}`); }; return; }
    const models = files.filter(f => f.isModel).sort((a, b) => a.path.localeCompare(b.path));
    const inst = await installed();
    $('.modal-body', md).innerHTML = `${models.length ? models.map((f, i) => {
        const name = f.path.split('/').pop();
        const guess = typeHint || window.KilnTypes.guessType(f.path, f.size);
        const have = inst.files[name.toLowerCase()];
        return `<div class="file-row"><span class="dl-ic">${ic('cube', 16)}</span><div class="t"><b title="${esc(f.path)}">${esc(f.path)}</b><small>${K.fmtBytes(f.size)}</small></div>
          ${have ? `<span class="badge ok">${ic('check', 11)} In library</span>` : `<select class="input sm" data-t="${i}" style="width:auto">${K.state.types.map(t => `<option value="${t.id}" ${t.id === guess ? 'selected' : ''}>${esc(t.short)}</option>`).join('')}</select><button class="btn sm" data-f="${i}">${ic('download', 13)} Download</button>`}</div>`;
      }).join('') : `<div class="empty">${ic('cube', 34)}<h3>No model files here</h3><p>This repository may use the diffusers folder format. Open it in the browser to look around.</p></div>`}
      <div class="row" style="margin-top:12px"><button class="btn sm" id="hfOpen">${ic('globe', 13)} Open on Hugging Face</button><span class="spacer"></span><button class="btn sm ghost" id="hfClose">Close</button></div>`;
    $('#hfOpen', md).onclick = () => { close(); window.Browser.openUrl(`https://huggingface.co/${repo}`); };
    $('#hfClose', md).onclick = close;
    $$('[data-f]', md).forEach(b => b.onclick = async () => {
      const f = models[Number(b.dataset.f)];
      const type = $(`[data-t="${b.dataset.f}"]`, md).value;
      b.disabled = true;
      const r = await window.Downloads.startModel({ url: f.url, name: f.path.split('/').pop(), type, source: 'hf' });
      if (r) b.innerHTML = `${ic('check', 13)} Downloading`; else b.disabled = false;
    });
  }

  /* ---------- Paste a link ---------- */
  function renderLink(b) {
    b.innerHTML = `<div style="max-width:680px;margin:20px auto">
      <h2 style="font-size:22px;margin-bottom:6px">Paste a model link</h2>
      <p class="muted" style="margin:0 0 18px">CivitAI model pages and download links, Hugging Face files and repositories, CivArchive, or a direct link to a .safetensors file.</p>
      <form class="row" id="lnForm"><input class="input" id="lnU" style="height:42px" placeholder="https://civitai.com/models/…" autofocus><button class="btn primary lg">Look it up</button></form>
      <div id="lnOut" style="margin-top:18px"></div>
      <div class="callout" style="margin-top:26px">${ic('info', 17)}<div>You can also <b>browse any site in Kiln’s browser</b>. When you download a model there, Kiln files it into the right folder of your library automatically.</div></div></div>`;
    $('#lnForm', b).onsubmit = async (e) => {
      e.preventDefault();
      const out = $('#lnOut', b);
      const url = $('#lnU', b).value.trim();
      if (!url) return;
      out.innerHTML = '<span class="spinner"></span>';
      try {
        const r = await kiln.link.resolve(url);
        if (r.kind === 'civitai') { out.innerHTML = ''; civDetail({ id: r.modelId, name: 'CivitAI model', type: '', creator: '', versions: [], stats: {}, tags: [] }, r.versionId); return; }
        if (r.kind === 'hf-repo') { out.innerHTML = ''; hfRepo(r.repo); return; }
        out.innerHTML = `<div class="file-row"><span class="dl-ic">${ic('cube', 16)}</span><div class="t"><b>${esc(r.name)}</b><small>${esc(new URL(r.url).hostname)}</small></div>
          <select class="input sm" id="lnT" style="width:auto">${K.state.types.map(t => `<option value="${t.id}" ${t.id === r.suggestedType ? 'selected' : ''}>${esc(t.short)}</option>`).join('')}</select><button class="btn sm primary" id="lnGo">${ic('download', 13)} Download</button></div>`;
        $('#lnGo', out).onclick = async () => { const d = await window.Downloads.startModel({ url: r.url, name: r.name, type: $('#lnT', out).value, source: r.source }); if (d) $('#lnGo', out).innerHTML = `${ic('check', 13)} Downloading`; };
      } catch (err) { out.innerHTML = `<div class="callout warn">${ic('alert', 17)}<div>${esc(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))}</div></div>`; }
    };
  }

  async function show(prm = {}) {
    if (prm.type) { const m = { StableDiffusion: 'Checkpoint', Lora: 'LORA', LyCORIS: 'LoCon', Embeddings: 'TextualInversion', VAE: 'VAE', ControlNet: 'Controlnet', ESRGAN: 'Upscaler', DiffusionModels: 'UNet', TextEncoders: 'TextEncoder', AnimateDiff: 'MotionModule', Ultralytics: 'Detection' }[prm.type]; if (m) { st.types = [m]; st.items = []; } }
    if (prm.source) st.source = prm.source;
    renderBar(); renderBody();
    if (st.source === 'civitai' && !st.items.length) search();
  }

  K.register('discover', { title: 'Find models', mount, show, reset });
  window.Discover = { civDetail };
})();
