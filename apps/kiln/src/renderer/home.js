/* Kiln — Home: what to do next, recent images, and what's running. */
(() => {
  const { $, $$, esc } = K;
  let el = null;

  function mount(e) { el = e; el.innerHTML = '<div class="scroll"><div class="page-wrap" id="homeWrap"></div></div>'; K.bus.on('running', () => { if (K.state.page === 'home') render(); }); K.bus.on('pkg:list', () => { if (K.state.page === 'home') render(); }); }

  async function render() {
    const w = $('#homeWrap', el);
    const s = K.state;
    const [models, gal, hist] = await Promise.all([kiln.lib.list({}).catch(() => []), kiln.gal.list({ limit: 16 }).catch(() => ({ items: [], total: 0 })), kiln.gen.history().catch(() => [])]);
    const pkgs = s.packages;
    const def = pkgs.find(p => p.id === s.settings.defaultPackageId) || pkgs[0];
    const running = K.generators();
    const ckpts = models.filter(m => m.type === 'StableDiffusion' || m.type === 'DiffusionModels').length;
    const hr = new Date().getHours();
    const hello = hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const steps = [
      { done: pkgs.length > 0, b: 'Install a package', s: 'ComfyUI, Forge Neo, A1111 and more. Kiln sets up Python for you.' },
      { done: ckpts > 0, b: 'Get a checkpoint', s: 'Find one on CivitAI or Hugging Face, or paste any model link.' },
      { done: hist.length > 0, b: 'Launch it and generate', s: 'Create here in Kiln, or in the package’s own web UI.' }
    ];
    let cta;
    if (!pkgs.length) cta = `<button class="btn primary lg" data-go="packages">${ic('pkg', 17)} Install a package</button>`;
    else if (!ckpts) cta = `<button class="btn primary lg" data-go="discover">${ic('compass', 17)} Find a checkpoint</button>`;
    else if (running.length) cta = `<button class="btn primary lg" data-go="generate">${ic('wand', 17)} Start generating</button>`;
    else cta = `<button class="btn primary lg" id="homeLaunch">${ic('play', 16)} Launch ${esc(def?.name || '')}</button>`;

    w.innerHTML = `
      <p class="muted" style="margin:0">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h1 class="hello">${hello}, ${esc(s.profile.name)}</h1>
      <div class="home-grid">
        <div class="panel start-card"><div class="art"></div>
          <h2>${steps.every(x => x.done) ? 'Pick up where you left off' : 'Get set up'}</h2>
          <ol class="steps">${steps.map(x => `<li class="${x.done ? 'done' : ''}"><div><b>${x.b}</b><small>${x.s}</small></div></li>`).join('')}</ol>
          <div class="row" style="margin-top:6px;position:relative">${cta}${running.length ? `<button class="btn lg" id="homeOpenUi">${ic('globe', 16)} Open ${esc(running[0].name)}</button>` : ''}</div>
        </div>
        <div class="panel panel-pad">
          <div class="stat-row">
            <button class="stat" data-go="models" style="text-align:left"><b>${models.length}</b><small>models</small></button>
            <button class="stat" data-go="gallery" style="text-align:left"><b>${K.fmtNum(gal.total)}</b><small>images</small></button>
            <button class="stat" data-go="prompts" style="text-align:left"><b>${s.prompts.length}</b><small>saved prompts</small></button>
          </div>
          <div class="section" style="margin-top:18px">
            <div class="section-h"><h3 style="flex:1">Packages</h3><button class="btn ghost sm" data-go="packages">Manage</button></div>
            ${pkgs.length ? `<div class="list">${pkgs.slice(0, 4).map(p => `<div class="list-row"><span class="pkg-ic">${esc(p.name[0])}</span><div style="flex:1;min-width:0"><b>${esc(p.name)}</b><div class="small muted row"><span class="state-dot ${p.status?.state}"></span>${esc(stateText(p.status?.state))}</div></div>
              ${p.status?.state === 'running' ? `<button class="btn sm" data-stop="${p.id}">${ic('stop', 13)} Stop</button>` : p.status?.state === 'stopped' || p.status?.state === 'error' ? `<button class="btn sm" data-launch="${p.id}">${ic('play', 13)} Launch</button>` : '<span class="spinner"></span>'}</div>`).join('')}</div>`
              : `<p class="muted" style="margin:0">Nothing installed yet.</p>`}
          </div>
        </div>
      </div>
      <div class="section">
        <div class="section-h"><h2>Recent images</h2><button class="btn ghost sm" data-go="gallery">Open gallery</button></div>
        ${gal.items.length ? `<div class="recent-strip">${gal.items.map(i => `<button data-img="${esc(i.path)}"><img src="${kiln.file(i.path, 256)}" alt="" loading="lazy" data-fallback></button>`).join('')}</div>`
          : `<div class="panel empty" style="padding:36px">${ic('image', 36)}<h3>No images yet</h3><p>What you create shows up here and in the Gallery, separate for each profile.</p></div>`}
      </div>`;
    $$('[data-go]', w).forEach(b => b.onclick = () => K.go(b.dataset.go));
    $$('[data-img]', w).forEach(b => b.onclick = () => K.go('gallery', { open: b.dataset.img }));
    $$('[data-launch]', w).forEach(b => b.onclick = () => launch(b.dataset.launch));
    $$('[data-stop]', w).forEach(b => b.onclick = () => kiln.pkg.stop(b.dataset.stop));
    $('#homeLaunch', w)?.addEventListener('click', () => launch(def.id));
    $('#homeOpenUi', w)?.addEventListener('click', () => window.Browser.openUrl(running[0].url, { title: running[0].name }));
  }
  function stateText(s) { return { running: 'Running', starting: 'Starting…', working: 'Installing or updating…', stopping: 'Stopping…', error: 'Stopped with an error', stopped: 'Not running' }[s] || 'Not running'; }
  async function launch(id) {
    try { await kiln.pkg.launch(id); K.toast('Starting… the console is in Packages', '', { label: 'Console', onClick: () => K.go('packages', { id, tab: 'console' }) }); }
    catch (e) { K.fail(e); }
  }

  K.register('home', { title: 'Home', mount, show: render });
  window.Home = { launch, stateText };
})();
