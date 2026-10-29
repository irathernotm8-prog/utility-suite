// Dither — References: the games, films and art you want the work to feel like. Claude can look at them too.
'use strict';

VIEWS.refs = {
  title: 'References',
  actions() { return `<button class="btn primary" id="refAdd">${icon('plus', 15)}Add pictures</button>`; },
  render(view) {
    const refs = S.project.refs || [];
    view.innerHTML = `<div class="lead">Taste comes from references. Drop in screenshots of effects and sprites you love and say why — Claude can see them with <code>view</code> and use them as the bar.</div>
      <div class="drop-zone ${refs.length ? 'slim' : ''}" id="refDrop">${icon('import', 20)}<span>Drop pictures here (PNG, JPG, GIF, WebP)</span></div>
      <div class="ref-grid">${refs.map((r) => `<div class="ref" data-id="${r.id}"><div class="ref-img"><img data-ref="${r.id}" alt=""></div><div class="ref-body"><input class="ref-title" value="${esc(r.title)}" spellcheck="false"><textarea class="ref-note" rows="2" placeholder="What do you like about it?">${esc(r.note || '')}</textarea></div><button class="icon-btn xs ref-del" title="Remove">${icon('x', 13)}</button></div>`).join('')}</div>`;
    $$('img[data-ref]', view).forEach(async (img) => { try { const p = await call('refs:path', img.dataset.ref); img.src = await call('image:dataUrl', p); } catch {} });
    $$('.ref', view).forEach((el) => { const id = el.dataset.id;
      $('.ref-title', el).onchange = (e) => call('refs:patch', id, { title: e.target.value });
      $('.ref-note', el).onchange = (e) => call('refs:patch', id, { note: e.target.value });
      $('.ref-del', el).onclick = async () => { await call('refs:remove', id); await loadProject(); render(); };
      $('.ref-img', el).onclick = () => { const src = $('img', el).src; openSheet(`<div class="lightbox"><img src="${src}"></div>`, { width: 1200, cls: 'lb-sheet' }); };
    });
    wireDrop($('#refDrop'), addRefs, () => call('dialog:files', { multi: true, filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }] }).then((f) => f && addRefs(f)));
  },
  after() { $('#refAdd').onclick = async () => { const f = await call('dialog:files', { multi: true, filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }] }); if (f) addRefs(f); }; },
};
async function addRefs(files) { try { await call('refs:add', files); await loadProject(); render(); toast(`Added ${plural(files.length, 'reference')}`); } catch (e) { fail(e); } }
function wireDrop(el, onFiles, onClick) {
  if (!el) return; el.ondragover = (e) => { e.preventDefault(); el.classList.add('over'); }; el.ondragleave = () => el.classList.remove('over');
  el.ondrop = (e) => { e.preventDefault(); el.classList.remove('over'); const files = [...e.dataTransfer.files].map((f) => D.pathFor(f)).filter(Boolean); if (files.length) onFiles(files); };
  if (onClick) el.onclick = onClick;
}
