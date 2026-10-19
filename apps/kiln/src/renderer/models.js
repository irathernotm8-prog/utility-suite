/* Kiln — My models: the profile's model library. */
(() => {
  const { $, $$, esc } = K;
  let el = null;
  const st = { items: [], type: '', q: '', sort: 'new', base: '', scan: null };

  function mount(e) {
    el = e;
    el.innerHTML = `<div class="split"><nav class="subnav" id="mdNav"></nav><div style="display:flex;flex-direction:column;min-height:0">
      <div class="toolbar"><div class="search">${ic('search', 15)}<input class="input" id="mdQ" placeholder="Search your models"></div>
        <select class="input" id="mdBase" style="width:auto"></select>
        <select class="input" id="mdSort" style="width:auto"><option value="new">Newest</option><option value="name">Name</option><option value="size">Largest</option></select>
        <div class="spacer"></div>
        <button class="btn sm" id="mdScan" title="Look up missing details and previews on CivitAI">${ic('hash', 13)} Find missing details</button>
        <button class="btn sm" id="mdAdd">${ic('plus', 13)} Add files</button>
        <button class="btn sm primary" id="mdFind">${ic('compass', 13)} Find models</button>
      </div>
      <div class="scroll drop-ok" id="mdScroll"><div class="content-pad" id="mdBody"></div></div></div></div>`;
    $('#mdQ', el).oninput = K.debounce((ev) => { st.q = ev.target.value.toLowerCase(); render(); }, 150);
    $('#mdSort', el).onchange = (ev) => { st.sort = ev.target.value; render(); };
    $('#mdBase', el).onchange = (ev) => { st.base = ev.target.value; render(); };
    $('#mdFind', el).onclick = () => K.go('discover', { type: st.type });
    $('#mdAdd', el).onclick = addFiles;
    $('#mdScan', el).onclick = scanAll;
    const sc = $('#mdScroll', el);
    sc.ondragover = (ev) => { if (ev.dataTransfer.types.includes('Files')) ev.preventDefault(); };
    sc.ondrop = async (ev) => { ev.preventDefault(); const files = [...ev.dataTransfer.files].map(f => kiln.app.pathForFile(f)).filter(Boolean); if (files.length) importFiles(files); };
    kiln.lib.onChanged(() => { if (K.state.page === 'models') load(); });
    kiln.lib.onScanProgress((d) => { st.scan = d.finished ? null : d; if (d.finished) { K.toast(`Found details for ${d.found} of ${d.total} models`, 'ok'); load(true); } else renderScan(); });
    kiln.lib.onHashProgress((d) => { const b = $('#mdHash'); if (b) b.style.width = Math.round(d.progress * 100) + '%'; });
  }
  async function load(force) { st.items = await kiln.lib.list({ force }); render(); }

  function filtered() {
    let l = st.items;
    if (st.type) l = l.filter(m => m.type === st.type);
    if (st.base) l = l.filter(m => (m.info?.baseModel || 'Unknown') === st.base);
    if (st.q) l = l.filter(m => (m.title + ' ' + m.file + ' ' + (m.info?.trainedWords || []).join(' ') + ' ' + (m.info?.author || '')).toLowerCase().includes(st.q));
    if (st.sort === 'name') l = [...l].sort((a, b) => a.title.localeCompare(b.title));
    if (st.sort === 'size') l = [...l].sort((a, b) => b.size - a.size);
    return l;
  }
  function render() {
    const counts = {};
    for (const m of st.items) counts[m.type] = (counts[m.type] || 0) + 1;
    const p = K.state.profile;
    $('#mdNav', el).innerHTML = `<button class="${!st.type ? 'on' : ''}" data-t="">${ic('grid', 15)}<span>All models</span><em>${st.items.length}</em></button>
      <h4>Types</h4>${K.state.types.map(t => `<button class="${st.type === t.id ? 'on' : ''}" data-t="${t.id}" ${counts[t.id] ? '' : 'style="opacity:.6"'}><span>${esc(t.label)}</span><em>${counts[t.id] || ''}</em></button>`).join('')}
      <h4>Library</h4><div class="small muted" style="padding:0 10px">${esc(p.libraryName)}${p.sharedWith.length ? `<br>Shared with ${esc(p.sharedWith.join(', '))}` : ''}</div>
      <button style="margin-top:6px" id="mdOpen">${ic('folder', 15)}<span>Open folder</span></button>
      <button id="mdLib">${ic('settings', 15)}<span>Change library</span></button>`;
    $$('[data-t]', el).forEach(b => b.onclick = () => { st.type = b.dataset.t; render(); });
    $('#mdOpen', el).onclick = () => kiln.lib.openFolder(st.type || null);
    $('#mdLib', el).onclick = () => K.go('settings', { tab: 'profile' });
    const bases = [...new Set(st.items.filter(m => !st.type || m.type === st.type).map(m => m.info?.baseModel || 'Unknown'))].sort();
    $('#mdBase', el).innerHTML = `<option value="">All base models</option>` + bases.map(b => `<option ${b === st.base ? 'selected' : ''}>${esc(b)}</option>`).join('');
    const list = filtered();
    const body = $('#mdBody', el);
    const tl = K.state.types.find(t => t.id === st.type);
    if (!list.length) {
      body.innerHTML = `<div class="empty">${ic('cube', 46)}<h3>${st.q || st.base ? 'Nothing matches' : st.type ? `No ${esc(tl.label)} yet` : 'Your library is empty'}</h3>
        <p>${st.q || st.base ? 'Try a different search.' : 'Find models on CivitAI or Hugging Face, paste a link, or drop model files here.'}</p>
        ${st.q || st.base ? '' : `<div class="row"><button class="btn primary" id="mdE1">${ic('compass', 15)} Find models</button><button class="btn" id="mdE2">${ic('plus', 15)} Add files</button></div>`}</div>`;
      $('#mdE1', body)?.addEventListener('click', () => K.go('discover', { type: st.type }));
      $('#mdE2', body)?.addEventListener('click', addFiles);
      renderScan();
      return;
    }
    body.innerHTML = `<div id="mdScanBox"></div><div class="grid" style="--min:190px">${list.map((m, i) => card(m, i)).join('')}</div>`;
    $$('[data-i]', body).forEach(c => {
      const m = list[Number(c.dataset.i)];
      c.onclick = () => detail(m);
      c.oncontextmenu = (e) => { e.preventDefault(); K.menu(e.clientX, e.clientY, actions(m)); };
    });
    renderScan();
  }
  function card(m, i) {
    const tl = K.state.types.find(t => t.id === m.type);
    return `<button class="card" data-i="${i}"><div class="card-img ${K.nsfwClass(m.info?.nsfw)}">${m.preview ? `<img src="${kiln.file(m.preview, 360)}" alt="" loading="lazy" data-fallback>` : `<span class="ph-ic">${ic('cube', 40)}</span>`}
      <span class="tl"><span class="badge">${esc(tl?.short || m.type)}</span>${m.info?.baseModel ? `<span class="badge">${esc(m.info.baseModel)}</span>` : ''}</span></div>
      <div class="card-body"><b title="${esc(m.title)}">${esc(m.title)}</b><small title="${esc(m.file)}">${esc(m.info?.versionName ? m.info.versionName + ' · ' : '')}${K.fmtBytes(m.size)}</small></div></button>`;
  }
  function renderScan() {
    const box = $('#mdScanBox', el);
    const btn = $('#mdScan', el);
    if (st.scan) {
      btn.disabled = true;
      if (box) box.innerHTML = `<div class="callout" style="margin-bottom:16px">${ic('hash', 17)}<div style="flex:1"><b>Finding details on CivitAI… ${st.scan.done} of ${st.scan.total}</b><div class="small">${esc(st.scan.current || '')}</div><div class="bar" style="margin-top:8px"><i id="mdHash" style="width:0%"></i></div></div></div>`;
    } else { btn.disabled = false; if (box) box.innerHTML = ''; }
  }

  function actions(m) {
    const civ = m.info?.sourceUrl;
    return [
      ...(m.type === 'Lora' || m.type === 'LyCORIS' ? [{ label: 'Add to prompt in Generate', icon: 'wand', onClick: () => window.Generate.usePrompt(`<lora:${m.name}:1>${m.info?.trainedWords?.length ? ', ' + m.info.trainedWords.slice(0, 3).join(', ') : ''}`) }] : []),
      ...(civ ? [{ label: 'Open on CivitAI', icon: 'external', onClick: () => window.Browser.openUrl(civ) }] : []),
      { label: m.info ? 'Refresh details from CivitAI' : 'Find details on CivitAI', icon: 'hash', onClick: () => lookup(m) },
      { label: 'Rename', icon: 'edit', onClick: async () => { const t = await K.ask('Rename', { label: 'Name shown in Kiln', value: m.title, subtitle: 'The file name stays the same, so packages keep finding it.' }); if (t !== null) { await kiln.lib.setTitle(m.path, t.trim()); load(true); } } },
      { label: 'Move to another type', icon: 'move', onClick: () => moveDialog(m) },
      { label: 'Show in folder', icon: 'folder', onClick: () => kiln.lib.show(m.path) }, '-',
      { label: 'Move to trash', icon: 'trash', danger: true, onClick: () => del(m) }
    ];
  }
  async function lookup(m) {
    K.toast(`Looking up ${m.title}… large files take a moment to fingerprint`);
    try { const r = await kiln.lib.lookup(m.path); if (r.found) { K.toast(`Found: ${r.name} (${r.version})`, 'ok'); load(true); } else K.toast('CivitAI doesn’t know this file', 'error'); }
    catch (e) { K.fail(e); }
  }
  async function scanAll() {
    const missing = st.items.filter(m => !m.info).length;
    if (!missing) return K.toast('Every model already has details');
    if (!await K.confirm(`Look up ${missing} model${missing > 1 ? 's' : ''} on CivitAI?`, 'Kiln fingerprints each file (this reads the whole file once), then fetches names, trigger words and previews.', { ok: 'Look them up' })) return;
    st.scan = { done: 0, total: missing }; renderScan();
    kiln.lib.lookupAll().catch(K.fail);
  }
  function moveDialog(m) {
    K.modal({ title: `Move ${m.title}`, body: `<label class="field"><span>Type</span><select class="input" id="mvT">${K.state.types.map(t => `<option value="${t.id}" ${t.id === m.type ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>`,
      actions: [{ label: 'Cancel' }, { label: 'Move', kind: 'primary', onClick: async (mm) => { await kiln.lib.move(m.path, $('#mvT', mm).value); K.toast('Moved', 'ok'); load(true); } }] });
  }
  async function del(m) {
    if (!await K.confirm(`Move ${m.title} to the trash?`, K.state.profile.sharedWith.length ? `This library is shared with ${K.state.profile.sharedWith.join(', ')}. It will disappear for them too.` : 'Its preview and details go with it.', { ok: 'Move to trash', danger: true })) return;
    try { await kiln.lib.remove(m.path); K.toast('Moved to the trash'); load(true); } catch (e) { K.fail(e); }
  }
  function detail(m) {
    const i = m.info || {};
    const tl = K.state.types.find(t => t.id === m.type);
    K.modal({
      title: m.title, subtitle: [tl?.label, i.baseModel, i.author && `by ${i.author}`].filter(Boolean).join(' · '), wide: true,
      body: `<div class="model-detail">
          <div class="card-img ${K.nsfwClass(i.nsfw)}" style="border-radius:12px;aspect-ratio:auto;min-height:240px">${m.preview ? `<img src="${kiln.file(m.preview)}" alt="" style="height:auto">` : `<span class="ph-ic">${ic('cube', 50)}</span>`}</div>
          <div>
            ${i.trainedWords?.length ? `<div class="field"><span>Trigger words · click to copy</span><div class="words">${i.trainedWords.map(w => `<button data-w="${esc(w)}">${esc(w)}</button>`).join('')}</div></div>` : ''}
            <dl class="kv" style="margin-bottom:16px">${i.versionName ? `<dt>Version</dt><dd>${esc(i.versionName)}</dd>` : ''}<dt>File</dt><dd class="mono">${esc(m.file)}</dd><dt>Size</dt><dd>${K.fmtBytes(m.size)}</dd><dt>Folder</dt><dd>${esc(m.type)}${m.folder ? '/' + esc(m.folder) : ''}</dd><dt>Added</dt><dd>${new Date(m.mtime).toLocaleDateString()}</dd>${i.sha256 ? `<dt>SHA-256</dt><dd class="mono" style="font-size:11px">${esc(i.sha256.slice(0, 16))}…</dd>` : ''}</dl>
            ${!m.info ? `<div class="callout" style="margin-bottom:14px">${ic('info', 17)}<div>No details yet. <b>Find details on CivitAI</b> fills in the name, trigger words and a preview.</div></div>` : ''}
            <div class="row wrap" id="mdAct"></div>
          </div></div>`,
      actions: [{ label: 'Close' }],
      onMount: (mm, close) => {
        $$('[data-w]', mm).forEach(b => b.onclick = () => { navigator.clipboard.writeText(b.dataset.w); K.toast('Copied', 'ok'); });
        const act = $('#mdAct', mm);
        const items = actions(m).filter(x => x && x !== '-');
        act.innerHTML = items.map((a, n) => `<button class="btn sm ${a.danger ? 'danger' : ''}" data-n="${n}">${ic(a.icon, 13)} ${esc(a.label)}</button>`).join('');
        $$('[data-n]', act).forEach(b => b.onclick = () => { close(); items[Number(b.dataset.n)].onClick(); });
      }
    });
  }
  async function addFiles() {
    const files = await kiln.app.chooseFiles({ title: 'Add model files', filters: [{ name: 'Models', extensions: ['safetensors', 'ckpt', 'pt', 'pth', 'bin', 'gguf', 'sft'] }] });
    if (files.length) importFiles(files);
  }
  async function importFiles(files) {
    K.modal({
      title: `Add ${files.length} file${files.length > 1 ? 's' : ''}`, subtitle: 'Kiln copies them into this profile’s library. The originals stay where they are.',
      body: `<label class="field"><span>Type</span><select class="input" id="imT"><option value="">Work it out from the file</option>${K.state.types.map(t => `<option value="${t.id}" ${t.id === st.type ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>`,
      actions: [{ label: 'Cancel' }, { label: 'Copy into library', kind: 'primary', onClick: async (m) => { K.toast('Copying…'); const r = await kiln.lib.importFiles(files, $('#imT', m).value || null); K.toast(`Added ${r.length} model${r.length === 1 ? '' : 's'}`, 'ok'); load(true); } }]
    });
  }

  async function show(prm = {}) { if (prm.type !== undefined) st.type = prm.type; await load(); }
  K.register('models', { title: 'My models', mount, show, reset: () => { st.items = []; st.type = ''; st.q = ''; } });
})();
