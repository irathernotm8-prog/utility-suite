// Quick Convert: drop files, pick a format, convert. Detailed work goes to Photo/Video.
const QuickConvert = (() => {
  let root, listEl, dropEl, sideEl;
  const items = [];
  const S = {
    image: 'png', video: 'mp4', audio: 'mp3',
    folder: null, quality: 'balanced', fastCopy: true,
    imgMax: 0, vidHeight: 0, svgMode: 'color', svgPreset: 'balanced',
  };
  let running = false, stopRequested = false;

  function init(el) {
    root = el;
    root.innerHTML = '';
    root.appendChild(h(`<div class="ws-convert">
      <div class="cv-main">
        <div class="cv-title"><div><h1>Quick Convert</h1><p>Drop files, choose a format, convert. Originals are never changed.</p></div>
          <div class="row" style="flex:none"><button class="btn btn-ghost" data-act="clear">${icon('trash')}Clear list</button></div></div>
        <div class="drop" tabindex="0"><div class="empty">${icon('convert', 'ico-xl')}<h3>Drop files here or click to browse</h3>
          <p>Images, videos and audio. PNG to SVG, MKV to MP4, video to MP3 and more.</p></div></div>
        <div class="cv-list" role="list"></div>
      </div>
      <aside class="cv-side panel"></aside></div>`));
    listEl = $('.cv-list', root); dropEl = $('.drop', root); sideEl = $('.cv-side', root);
    dropEl.addEventListener('click', browse);
    dropEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') browse(); });
    $('[data-act="clear"]', root).addEventListener('click', () => {
      for (let i = items.length - 1; i >= 0; i--) if (items[i].status !== 'running') items.splice(i, 1);
      render();
    });
    const ws = $('.ws-convert', root);
    ws.addEventListener('dragover', e => { e.preventDefault(); dropEl.classList.add('over'); });
    ws.addEventListener('dragleave', e => { if (!ws.contains(e.relatedTarget)) dropEl.classList.remove('over'); });
    ws.addEventListener('drop', e => {
      e.preventDefault(); dropEl.classList.remove('over');
      addPaths(Array.from(e.dataTransfer.files).map(f => ro3.pathOf(f)).filter(Boolean));
    });
    renderSide();
    render();
  }

  async function browse() {
    const all = [...FORMATS.IMAGE_IN, ...FORMATS.VIDEO_IN, ...FORMATS.AUDIO_IN];
    const paths = await ro3.openDialog({ title: 'Add files to convert', multi: true, filters: [
      { name: 'Media', extensions: all }, { name: 'Images', extensions: FORMATS.IMAGE_IN },
      { name: 'Video', extensions: FORMATS.VIDEO_IN }, { name: 'Audio', extensions: FORMATS.AUDIO_IN }] });
    addPaths(paths);
  }

  const kindOf = p => {
    const e = (/\.([^.\\/]+)$/.exec(p) || [])[1]?.toLowerCase() || '';
    if (FORMATS.IMAGE_IN.includes(e)) return 'image';
    if (FORMATS.VIDEO_IN.includes(e)) return 'video';
    if (FORMATS.AUDIO_IN.includes(e)) return 'audio';
    return 'unknown';
  };

  function addPaths(paths) {
    let skipped = 0;
    for (const p of paths) {
      const kind = kindOf(p);
      if (kind === 'unknown') { skipped++; continue; }
      if (items.some(i => i.path === p && i.status !== 'done')) continue;
      const ext = p.split('.').pop().toLowerCase();
      // Don't default a file to its own format (png → png); pick the most useful alternative.
      const alt = { image: { png: 'jpg', jpg: 'png', jpeg: 'png' }, video: { mp4: 'mov' }, audio: { mp3: 'wav', wav: 'mp3' } }[kind];
      let target = S[kind];
      if (target === ext || (target === 'jpg' && ext === 'jpeg')) target = (alt && alt[ext]) || targetsFor(kind).find(t => t.ext !== ext).ext;
      const it = { id: uid('cv'), path: p, name: baseName(p), kind, target, status: 'ready', progress: 0, meta: '' };
      items.push(it);
      loadMeta(it);
    }
    if (skipped) toast(`${skipped} file${skipped > 1 ? 's' : ''} skipped — not an image, video or audio format RO3 reads.`, 'error');
    render();
  }

  async function loadMeta(it) {
    try {
      const st = await ro3.stat(it.path);
      it.size = st.size;
      if (it.kind === 'image') {
        const info = await ro3.imageInfo(it.path);
        it.meta = `${info.width}×${info.height}`;
      } else {
        const info = await ro3.probe(it.path);
        it.meta = [fmtTime(info.duration, false), info.hasVideo ? `${info.width}×${info.height}` : '', (info.vcodec || info.acodec || '').toUpperCase()].filter(Boolean).join(' · ');
        it.probe = info;
      }
      it.thumb = await ro3.thumb(it.path).catch(() => null);
    } catch (e) { it.meta = 'Unreadable file'; it.status = 'error'; it.error = e.message; }
    renderItem(it);
  }

  function targetsFor(kind) {
    if (kind === 'image') return FORMATS.IMAGE_OUT;
    if (kind === 'video') return [...FORMATS.VIDEO_OUT, ...FORMATS.AUDIO_OUT.map(a => ({ ext: a.ext, label: a.label + ' (audio)' }))];
    return FORMATS.AUDIO_OUT;
  }

  function render() {
    listEl.innerHTML = '';
    dropEl.classList.toggle('compact', items.length > 0);
    items.forEach(it => listEl.appendChild(itemEl(it)));
    updateActions();
  }

  function itemEl(it) {
    const el = h(`<div class="cv-item" role="listitem" data-id="${it.id}">
      <div class="cv-thumb" ${it.thumb ? `style="background-image:url('${it.thumb}')"` : ''}>${it.thumb ? '' : icon(it.kind === 'audio' ? 'music' : it.kind === 'video' ? 'film' : 'image')}</div>
      <div class="cv-name"><strong title="${esc(it.path)}">${esc(it.name)}</strong><span>${esc([fmtBytes(it.size), it.meta].filter(Boolean).join(' · ') || 'Reading…')}</span></div>
      <label class="field"><select aria-label="Convert to">${targetsFor(it.kind).map(t => `<option value="${t.ext}" ${t.ext === it.target ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
      <div class="cv-status"></div>
      <button class="icon-btn" aria-label="Remove">${icon('x')}</button></div>`);
    const sel = $('select', el);
    sel.disabled = it.status === 'running';
    sel.addEventListener('change', () => { it.target = sel.value; if (it.status === 'done' || it.status === 'error') { it.status = 'ready'; renderItem(it); } });
    const st = $('.cv-status', el);
    if (it.status === 'ready') st.textContent = 'Ready';
    if (it.status === 'running') { st.innerHTML = `<div class="progress"><div class="progress-fill" style="width:${(it.progress * 100).toFixed(1)}%"></div></div><span>${Math.round(it.progress * 100)}%</span>`; }
    if (it.status === 'done') { st.classList.add('done'); st.innerHTML = `<span>${icon('check', '')} ${fmtBytes(it.outBytes)}</span>`; st.firstChild.style.display = 'flex'; st.firstChild.style.gap = '5px'; st.appendChild(h(`<button class="btn btn-sm">Show in folder</button>`)); $('button', st).addEventListener('click', () => ro3.showInFolder(it.output)); }
    if (it.status === 'error') { st.classList.add('fail'); st.textContent = it.error || 'Failed'; st.title = it.error || ''; }
    const x = el.querySelector('.icon-btn[aria-label="Remove"]');
    if (it.status === 'running') { x.setAttribute('aria-label', 'Cancel'); x.title = 'Cancel'; }
    x.addEventListener('click', () => {
      if (it.status === 'running') { it.job && it.job.cancel(); return; }
      items.splice(items.indexOf(it), 1); render();
    });
    return el;
  }

  function renderItem(it) {
    const old = listEl.querySelector(`[data-id="${it.id}"]`);
    if (old) old.replaceWith(itemEl(it));
    updateActions();
  }

  function renderSide() {
    sideEl.innerHTML = '';
    sideEl.appendChild(h(`<div class="panel-head"><h3>Defaults for new files</h3></div>`));
    const body = h(`<div class="panel-body"></div>`);
    const imgSel = selectField('Images to', FORMATS.IMAGE_OUT, S.image);
    const vidSel = selectField('Videos to', [...FORMATS.VIDEO_OUT, ...FORMATS.AUDIO_OUT.map(a => ({ ext: a.ext, label: a.label + ' (audio)' }))], S.video);
    const audSel = selectField('Audio to', FORMATS.AUDIO_OUT, S.audio);
    const bind = (el, key, kind) => el.select.addEventListener('change', () => {
      S[key] = el.get();
      items.filter(i => i.kind === kind && i.status === 'ready').forEach(i => { i.target = S[key]; });
      render();
    });
    bind(imgSel, 'image', 'image'); bind(vidSel, 'video', 'video'); bind(audSel, 'audio', 'audio');
    body.append(imgSel, vidSel, audSel, h('<div class="divider"></div>'));

    const q = selectField('Quality', [['high', 'High — larger files'], ['balanced', 'Balanced'], ['small', 'Small files']], S.quality);
    q.select.addEventListener('change', () => S.quality = q.get());
    const imax = selectField('Image size', [[0, 'Keep original'], [4096, 'Fit within 4096 px'], [2048, 'Fit within 2048 px'], [1920, 'Fit within 1920 px'], [1280, 'Fit within 1280 px'], [512, 'Fit within 512 px']], S.imgMax);
    imax.select.addEventListener('change', () => S.imgMax = Number(imax.get()));
    const vh = selectField('Video size', [[0, 'Keep original'], [2160, 'Up to 4K (2160p)'], [1080, 'Up to 1080p'], [720, 'Up to 720p'], [480, 'Up to 480p']], S.vidHeight);
    vh.select.addEventListener('change', () => S.vidHeight = Number(vh.get()));
    const fc = checkField('Copy streams when possible (much faster, lossless)', S.fastCopy);
    fc.input.addEventListener('change', () => S.fastCopy = fc.get());
    body.append(q, imax, vh, fc, h('<div class="divider"></div>'));

    const svgMode = selectField('SVG tracing', [['color', 'Full color'], ['bw', 'Black & white'], ['posterize', 'Posterized grays']], S.svgMode);
    svgMode.select.addEventListener('change', () => S.svgMode = svgMode.get());
    const svgPreset = selectField('SVG detail', [['logo', 'Logo — clean, few shapes'], ['balanced', 'Balanced'], ['detailed', 'Detailed — photos']], S.svgPreset);
    svgPreset.select.addEventListener('change', () => S.svgPreset = svgPreset.get());
    body.append(svgMode, svgPreset, h(`<p class="hint">Vector tracing works best on logos, icons and flat artwork. For finer control, open the image in Photo and export as SVG with a live preview.</p>`), h('<div class="divider"></div>'));

    const folder = h(`<div class="field"><span>Save to</span><div class="cv-folder"><span title="">Same folder as each file</span><button class="btn btn-sm">Change</button><button class="icon-btn" title="Reset to same folder" aria-label="Reset">${icon('x')}</button></div></div>`);
    const paintFolder = () => { const sp = $('.cv-folder span', folder); sp.textContent = S.folder || 'Same folder as each file'; sp.title = S.folder || ''; $('.icon-btn', folder).style.display = S.folder ? '' : 'none'; };
    $('.btn', folder).addEventListener('click', async () => { const f = await ro3.folderDialog(); if (f) { S.folder = f; paintFolder(); } });
    $('.icon-btn', folder).addEventListener('click', () => { S.folder = null; paintFolder(); });
    paintFolder();
    body.append(folder);
    sideEl.appendChild(body);
    const actions = h(`<div class="cv-actions"><button class="btn btn-primary" data-act="go">${icon('convert')}Convert all</button><span class="hint" data-act="summary"></span></div>`);
    $('[data-act="go"]', actions).addEventListener('click', () => running ? stopAll() : convertAll());
    sideEl.appendChild(actions);
  }

  function updateActions() {
    const go = $('[data-act="go"]', sideEl);
    const pending = items.filter(i => i.status === 'ready').length;
    if (running) { go.innerHTML = `${icon('x')}Stop`; go.className = 'btn btn-danger'; go.disabled = false; }
    else { go.innerHTML = `${icon('convert')}Convert ${pending ? pending + ' file' + (pending > 1 ? 's' : '') : 'all'}`; go.className = 'btn btn-primary'; go.disabled = !pending; }
    const done = items.filter(i => i.status === 'done').length, failed = items.filter(i => i.status === 'error').length;
    $('[data-act="summary"]', sideEl).textContent = items.length ? `${done} done${failed ? ` · ${failed} failed` : ''} · ${items.length} in list` : 'Nothing added yet.';
  }

  function stopAll() {
    stopRequested = true;
    items.filter(i => i.status === 'running').forEach(i => i.job && i.job.cancel());
  }

  async function convertAll() {
    const queue = items.filter(i => i.status === 'ready');
    if (!queue.length) return;
    running = true; stopRequested = false; updateActions();
    const quality = { high: 95, balanced: 85, small: 70 }[S.quality];
    const worker = async () => {
      while (queue.length && !stopRequested) {
        const it = queue.shift();
        await convertOne(it, quality);
      }
    };
    await Promise.all([worker(), worker()]);
    running = false; updateActions();
    const done = items.filter(i => i.status === 'done').length;
    if (!stopRequested) toast(`Converted ${done} file${done === 1 ? '' : 's'}.`, 'ok');
  }

  async function convertOne(it, quality) {
    it.status = 'running'; it.progress = 0; renderItem(it);
    const dir = S.folder || dirName(it.path);
    let ext = it.target;
    const output = joinPath(dir, stripExt(it.name) + '.' + ext);
    const spec = { input: it.path, output, quality: it.kind === 'image' ? quality : S.quality, fastCopy: S.fastCopy };
    if (it.kind === 'image') {
      if (S.imgMax) spec.resize = { width: S.imgMax, height: S.imgMax, fit: 'inside' };
      if (ext === 'svg') spec.trace = { mode: S.svgMode, preset: S.svgPreset };
    } else if (S.vidHeight) spec.resize = { height: S.vidHeight };
    const job = ro3.convert(spec, p => {
      it.progress = p;
      const row = listEl.querySelector(`[data-id="${it.id}"] .cv-status`);
      if (row) { const f = $('.progress-fill', row); if (f) f.style.width = (p * 100).toFixed(1) + '%'; const s = $('span', row); if (s) s.textContent = Math.round(p * 100) + '%'; }
    });
    it.job = job;
    try {
      const r = await job.promise;
      it.status = 'done'; it.output = r.output; it.outBytes = r.bytes;
    } catch (e) {
      it.status = e.cancelled ? 'ready' : 'error';
      it.error = e.cancelled ? '' : e.message.replace(/^Error: /, '');
    }
    it.job = null;
    renderItem(it);
  }

  return { init, addPaths, activate() {}, menu(cmd) { if (cmd === 'open') browse(); } };
})();
