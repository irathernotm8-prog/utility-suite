/* Kiln — Prompts: a saved prompt library and the generation history, per profile. */
(() => {
  const { $, $$, esc } = K;
  let el = null;
  const st = { tab: 'saved', q: '', tag: '', fav: false };

  function mount(e) { el = e; el.innerHTML = '<div class="scroll"><div class="page-wrap" id="prWrap"></div></div>'; }

  function edit(pre = {}) {
    const d = { id: pre.id || null, name: pre.name || '', positive: pre.positive || '', negative: pre.negative || '', tags: (pre.tags || []).join(', '), favorite: !!pre.favorite, notes: pre.notes || '' };
    K.modal({
      title: d.id ? 'Edit prompt' : 'Save prompt', wide: true,
      body: `<label class="field"><span>Name</span><input class="input" id="peN" value="${esc(d.name)}" placeholder="e.g. Rainy neon street" autofocus></label>
        <label class="field"><span>Prompt</span><textarea class="input" id="peP" rows="5">${esc(d.positive)}</textarea></label>
        <label class="field"><span>Leave out</span><textarea class="input" id="peNg" rows="2">${esc(d.negative)}</textarea></label>
        <div class="fields-2"><label class="field"><span>Tags</span><input class="input" id="peT" value="${esc(d.tags)}" placeholder="portrait, anime, client"><small>Separate with commas.</small></label>
        <label class="field"><span>Notes</span><input class="input" id="peNo" value="${esc(d.notes)}" placeholder="Works best with…"></label></div>
        <label class="row"><span class="switch"><input type="checkbox" id="peF" ${d.favorite ? 'checked' : ''}><i></i></span> Favorite</label>`,
      actions: [{ label: 'Cancel' }, { label: 'Save prompt', kind: 'primary', onClick: async (m) => {
        const positive = $('#peP', m).value.trim();
        if (!positive) { K.toast('The prompt is empty', 'error'); return false; }
        K.state.prompts = await kiln.prompts.save({ ...pre, id: d.id, name: $('#peN', m).value, positive, negative: $('#peNg', m).value.trim(), tags: $('#peT', m).value.split(','), favorite: $('#peF', m).checked, notes: $('#peNo', m).value });
        K.toast('Prompt saved', 'ok');
        if (K.state.page === 'prompts') render();
      } }]
    });
  }

  async function render() {
    const w = $('#prWrap', el);
    const all = K.state.prompts = await kiln.prompts.list();
    const tags = [...new Set(all.flatMap(p => p.tags))].sort();
    w.innerHTML = `<div class="ph"><div class="grow"><h1>Prompts</h1><p>Saved prompts and everything you’ve generated, kept separate for ${esc(K.state.profile.name)}.</p></div>
        <div class="ph-actions"><button class="btn ghost" id="prImp">${ic('upload', 15)} Import</button><button class="btn ghost" id="prExp" ${all.length ? '' : 'disabled'}>${ic('download', 15)} Export</button><button class="btn primary" id="prNew">${ic('plus', 15)} New prompt</button></div></div>
      <div class="tabs" style="margin-bottom:18px"><button data-tab="saved" class="${st.tab === 'saved' ? 'on' : ''}">${ic('bookmark', 15)} Saved <span class="badge">${all.length}</span></button><button data-tab="history" class="${st.tab === 'history' ? 'on' : ''}">${ic('history', 15)} History</button></div>
      <div id="prBody"></div>`;
    $$('[data-tab]', w).forEach(b => b.onclick = () => { st.tab = b.dataset.tab; render(); });
    $('#prNew', w).onclick = () => edit();
    $('#prImp', w).onclick = async () => { try { const r = await kiln.prompts.importFile(); if (r) { K.toast(`Imported ${r.added} prompt${r.added === 1 ? '' : 's'}`, 'ok'); render(); } } catch (e) { K.fail(e); } };
    $('#prExp', w).onclick = async () => { const f = await kiln.prompts.exportAll(); if (f) K.toast('Exported', 'ok'); };
    const body = $('#prBody', w);
    if (st.tab === 'history') return renderHistory(body);
    let list = all;
    if (st.fav) list = list.filter(p => p.favorite);
    if (st.tag) list = list.filter(p => p.tags.includes(st.tag));
    if (st.q) { const q = st.q.toLowerCase(); list = list.filter(p => (p.name + ' ' + p.positive + ' ' + p.negative + ' ' + p.tags.join(' ')).toLowerCase().includes(q)); }
    body.innerHTML = `<div class="row wrap" style="margin-bottom:16px"><div class="search" style="flex:1;max-width:380px">${ic('search', 15)}<input class="input" id="prQ" value="${esc(st.q)}" placeholder="Search prompts"></div>
        <button class="chip ${st.fav ? 'on' : ''}" id="prFav">${ic('star', 13)} Favorites</button>${tags.map(t => `<button class="chip ${st.tag === t ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      ${list.length ? `<div class="grid" style="--min:280px">${list.map(p => `<div class="prompt-card" data-id="${p.id}"><div class="top"><b>${esc(p.name)}</b>${p.favorite ? ic('star', 14, 'on') : ''}<button class="icon-btn sm" data-more>${ic('dots', 15)}</button></div><div class="pt">${esc(p.positive)}</div>${p.negative ? `<div class="pn">Leave out: ${esc(p.negative)}</div>` : ''}
        <div class="row" style="margin-top:4px">${p.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}<span class="spacer"></span><button class="btn sm primary" data-use>${ic('wand', 13)} Use</button></div></div>`).join('')}</div>`
        : `<div class="panel empty">${ic('bookmark', 40)}<h3>${all.length ? 'No prompts match' : 'No saved prompts yet'}</h3><p>${all.length ? 'Try another search or tag.' : 'Save prompts you like from Generate or the Gallery, or start one here.'}</p>${all.length ? '' : `<button class="btn primary" id="prNew2">${ic('plus', 15)} New prompt</button>`}</div>`}`;
    const q = $('#prQ', body);
    q.oninput = K.debounce(() => { st.q = q.value; render().then(() => { const n = $('#prQ', el); n.focus(); n.selectionStart = n.value.length; }); }, 250);
    $('#prFav', body).onclick = () => { st.fav = !st.fav; render(); };
    $$('[data-tag]', body).forEach(b => b.onclick = () => { st.tag = st.tag === b.dataset.tag ? '' : b.dataset.tag; render(); });
    $('#prNew2', body)?.addEventListener('click', () => edit());
    $$('.prompt-card', body).forEach(c => {
      const p = all.find(x => x.id === c.dataset.id);
      $('[data-use]', c).onclick = () => window.Generate.usePrompt(p);
      $('[data-more]', c).onclick = (e) => K.menuAt(e.currentTarget, [
        { label: 'Use in Generate', icon: 'wand', onClick: () => window.Generate.usePrompt(p) },
        { label: 'Edit', icon: 'edit', onClick: () => edit(p) },
        { label: p.favorite ? 'Remove from favorites' : 'Add to favorites', icon: 'star', onClick: async () => { K.state.prompts = await kiln.prompts.save({ ...p, favorite: !p.favorite }); render(); } },
        { label: 'Duplicate', icon: 'copy', onClick: async () => { K.state.prompts = await kiln.prompts.save({ ...p, id: null, name: p.name + ' copy' }); render(); } },
        { label: 'Copy text', icon: 'copy', onClick: () => { navigator.clipboard.writeText(p.positive); K.toast('Copied', 'ok'); } }, '-',
        { label: 'Delete', icon: 'trash', danger: true, onClick: async () => { if (await K.confirm(`Delete “${p.name}”?`, '', { ok: 'Delete', danger: true })) { K.state.prompts = await kiln.prompts.remove(p.id); render(); } } }
      ], 'right');
    });
  }

  async function renderHistory(body) {
    const h = await kiln.gen.history();
    if (!h.length) { body.innerHTML = `<div class="panel empty">${ic('history', 40)}<h3>Nothing generated yet</h3><p>Every generation from Kiln is listed here with its prompt and settings.</p></div>`; return; }
    body.innerHTML = `<div class="list">${h.slice(0, 200).map(x => `<div class="hist-row" data-id="${x.id}">${x.images[0] ? `<img src="${kiln.file(x.images[0], 160)}" alt="" loading="lazy" data-fallback>` : '<span class="thumb"></span>'}
        <div style="min-width:0"><div class="pt">${esc(x.positive)}</div><small class="muted">${K.ago(x.at)} · ${esc(x.pkg || '')} · ${x.images.length} image${x.images.length === 1 ? '' : 's'}${x.seed != null ? ` · seed ${x.seed}` : ''}</small></div>
        <div class="row"><button class="btn sm" data-again>${ic('history', 13)} Use again</button><button class="icon-btn sm" data-more>${ic('dots', 15)}</button></div></div>`).join('')}</div>`;
    $$('.hist-row', body).forEach(r => {
      const x = h.find(y => y.id === r.dataset.id);
      $('[data-again]', r).onclick = () => K.go('generate', { reuse: { positive: x.positive, negative: x.negative, params: x.params, settings: { Seed: x.seed } } });
      $('img', r)?.addEventListener('click', () => K.go('gallery', { open: x.images[0] }));
      $('[data-more]', r).onclick = (e) => K.menuAt(e.currentTarget, [
        { label: 'Save as prompt', icon: 'bookmark', onClick: () => edit({ positive: x.positive, negative: x.negative }) },
        { label: 'Copy prompt', icon: 'copy', onClick: () => { navigator.clipboard.writeText(x.positive); K.toast('Copied', 'ok'); } },
        { label: 'Remove from history', icon: 'trash', danger: true, onClick: async () => { await kiln.gen.removeHistory(x.id); render(); } }
      ], 'right');
    });
  }

  K.register('prompts', { title: 'Prompts', mount, show: render });
  window.Prompts = { edit };
})();
