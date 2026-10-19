/* Kiln — downloads drawer: every model and file download, wherever it started. */
(() => {
  const { $, $$, esc } = K;
  let items = [];
  let open = false;

  async function load() { items = await kiln.dl.list(); badge(); if (open) render(); }
  function badge() {
    const n = items.filter(i => ['progressing', 'starting', 'paused'].includes(i.state)).length;
    const b = $('#dlBadge');
    if (!b) return;
    b.hidden = !n; b.textContent = n;
  }
  function toggle(force) {
    open = force ?? !open;
    const d = $('#drawer');
    d.hidden = !open;
    if (open) { render(); setTimeout(() => document.addEventListener('mousedown', outside), 0); }
    else document.removeEventListener('mousedown', outside);
  }
  function outside(e) { const d = $('#drawer'); if (d && !d.contains(e.target) && !e.target.closest('#dlBtn') && !e.target.closest('.menu') && !e.target.closest('.modal-wrap')) toggle(false); }

  const typeLabel = (t) => K.state.types.find(x => x.id === t)?.label || t;
  function row(d) {
    const pct = d.total ? Math.round((d.received / d.total) * 100) : 0;
    const active = ['progressing', 'starting', 'paused'].includes(d.state);
    const status = d.state === 'completed' ? (d.isModel ? `Saved to ${typeLabel(d.type)} · ${K.fmtBytes(d.total)}` : `Saved · ${K.fmtBytes(d.total)}`)
      : d.state === 'progressing' ? `${K.fmtBytes(d.received)} of ${d.total ? K.fmtBytes(d.total) : '…'} · ${pct}%`
      : d.state === 'paused' ? `Paused · ${pct}%` : d.state === 'starting' ? 'Starting…' : d.state === 'cancelled' ? 'Cancelled' : d.state === 'interrupted' ? 'Stopped before it finished' : 'Failed';
    const ask = d.isModel && d.needsType && d.state !== 'failed' && d.state !== 'cancelled';
    return `<div class="dl" data-id="${d.id}">
      <div class="dl-top">
        <span class="dl-ic">${ic(d.isModel ? 'cube' : 'download', 17)}</span>
        <div class="dl-name"><b title="${esc(d.name)}">${esc(d.title || d.name)}</b><small>${esc(status)}${d.source === 'browser' ? ' · from the browser' : ''}</small></div>
        ${active && d.state !== 'starting' ? `<button class="icon-btn sm" data-act="${d.state === 'paused' ? 'resume' : 'pause'}" title="${d.state === 'paused' ? 'Resume' : 'Pause'}">${ic(d.state === 'paused' ? 'play' : 'pause', 14)}</button>` : ''}
        ${active ? `<button class="icon-btn sm" data-act="cancel" title="Cancel">${ic('x', 14)}</button>` : ''}
        ${d.state === 'completed' && d.exists ? `<button class="icon-btn sm" data-act="show" title="Show in folder">${ic('folder', 14)}</button>` : ''}
        ${['failed', 'interrupted', 'cancelled'].includes(d.state) ? `<button class="icon-btn sm" data-act="retry" title="Try again">${ic('refresh', 14)}</button>` : ''}
        ${!active ? `<button class="icon-btn sm" data-act="remove" title="Remove from list">${ic('trash', 14)}</button>` : ''}
      </div>
      ${active ? `<div class="bar ${d.total ? '' : 'indet'}"><i style="width:${pct}%"></i></div>` : ''}
      ${ask ? `<div class="dl-ask">${ic('info', 14)} File it under <select class="input sm" data-type style="width:auto">${K.state.types.map(t => `<option value="${t.id}" ${t.id === d.suggestedType ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select><button class="btn sm" data-act="settype">Set</button></div>` : ''}
      ${d.state === 'completed' && d.isModel ? `<div class="dl-ask"><button class="btn ghost sm" data-act="move">${ic('move', 13)} Wrong folder? Move it</button></div>` : ''}
      ${d.error ? `<div class="dl-err">${esc(d.error)}</div>` : ''}
    </div>`;
  }
  function render() {
    const d = $('#drawer');
    if (!d || !open) return;
    d.innerHTML = `<div class="drawer-head"><h2>Downloads</h2>
      <button class="btn ghost sm" id="dlClear" ${items.some(i => !['progressing', 'starting', 'paused'].includes(i.state)) ? '' : 'disabled'}>Clear finished</button>
      <button class="icon-btn" id="dlClose">${ic('x', 17)}</button></div>
      <div class="drawer-body">${items.length ? items.map(row).join('') : `<div class="empty">${ic('download', 40)}<h3>No downloads yet</h3><p>Models you download from Find models, a pasted link or the browser show up here.</p><button class="btn" id="dlFind">${ic('compass', 15)} Find models</button></div>`}</div>`;
    $('#dlClose', d).onclick = () => toggle(false);
    $('#dlFind', d)?.addEventListener('click', () => { toggle(false); K.go('discover'); });
    $('#dlClear', d).onclick = async () => { items = await kiln.dl.clear(); render(); badge(); };
    $$('.dl', d).forEach(el => {
      const id = el.dataset.id;
      $$('[data-act]', el).forEach(b => b.onclick = async () => {
        const a = b.dataset.act;
        try {
          if (a === 'pause' || a === 'resume' || a === 'cancel') await kiln.dl.control(id, a);
          if (a === 'show') kiln.dl.show(id);
          if (a === 'retry') { await kiln.dl.retry(id); await load(); }
          if (a === 'remove') { await kiln.dl.remove(id); items = items.filter(x => x.id !== id); render(); }
          if (a === 'settype') { const r = await kiln.dl.setType(id, $('[data-type]', el).value); upsert(r); }
          if (a === 'move') {
            const it = items.find(x => x.id === id);
            K.menuAt(b, K.state.types.map(t => ({ label: t.label, checked: t.id === it.type, onClick: async () => { const r = await kiln.dl.setType(id, t.id); upsert(r); K.toast(`Moved to ${t.label}`, 'ok'); } })));
          }
        } catch (e) { K.fail(e); }
      });
    });
  }
  function upsert(d) {
    if (!d) return;
    const i = items.findIndex(x => x.id === d.id);
    if (i >= 0) items[i] = { ...items[i], ...d }; else items.unshift(d);
    badge();
    if (open) scheduleRender();
  }
  let rt = null;
  function scheduleRender() {
    if (rt) return;
    rt = setTimeout(() => {
      rt = null;
      // don't redraw under an open dropdown
      if (document.activeElement?.closest?.('#drawer select')) { scheduleRender(); return; }
      render();
    }, 200);
  }
  kiln.dl.onUpdate(upsert);
  kiln.dl.onDone((d) => {
    upsert(d);
    if (d.state === 'completed' && d.isModel) K.toast(`${d.title || d.name} is in your ${typeLabel(d.type)}`, 'ok', { label: 'View', onClick: () => K.go('models', { type: d.type }) });
    else if (d.state === 'failed') K.toast(d.error || `${d.name} failed`, 'error');
    K.bus.emit('downloads:done', d);
  });

  // Start a download and open the drawer so progress is visible
  async function startModel(opts) {
    try { const r = await kiln.dl.start(opts); upsert(r); toggle(true); return r; }
    catch (e) { K.fail(e); return null; }
  }

  window.Downloads = { load, toggle, startModel, items: () => items };
})();
