// Documents: passport copies, visas, tickets, boarding passes, booking confirmations and insurance —
// copied into the trip folder so they open with no internet. Drop files anywhere to add them.
'use strict';

const TAGS = {
  passport: ['Passports & ID', 'passport', 'a-violet'], visa: ['Visas & entry', 'shieldCheck', 'a-indigo'], ticket: ['Tickets & passes', 'ticket', 'a-sky'],
  booking: ['Confirmations', 'bookmark', 'a-gold'], insurance: ['Insurance', 'shield', 'a-teal'], license: ['Licences & permits', 'car', 'a-slate'],
  health: ['Health', 'heart', 'a-rose'], map: ['Maps & guides', 'map', 'a-lime'], other: ['Other', 'file', 'a-coral'],
};

VIEWS.docs = {
  head: () => `<h1>Documents <small>${plural(S.trip.docs.length, 'file')} · ${esc(human(S.trip.docs.reduce((a, d) => a + (d.size || 0), 0)))}</small></h1>`,
  actions: () => `<button class="btn" id="dcCopy" ${S.trip.docs.length ? '' : 'disabled'}><span data-icon="export" data-size="15"></span>Copy all to…</button><button class="btn primary" id="dcAdd"><span data-icon="plus" data-size="15"></span>Add documents</button>`,
  render(v) {
    const t = S.trip;
    const f = S.docFilter || 'all';
    const counts = {}; for (const d of t.docs) counts[d.tag] = (counts[d.tag] || 0) + 1;
    const list = t.docs.filter(d => f === 'all' || d.tag === f).sort((a, b) => Object.keys(TAGS).indexOf(a.tag) - Object.keys(TAGS).indexOf(b.tag) || b.added - a.added);
    v.innerHTML = `
      <div class="drop-zone" id="dz">${tile('a-sunset', 'import', 'lg', 20)}<div class="grow"><b>Drop files here — or anywhere in the window</b><span>PDFs, photos, screenshots, Wallet passes. They're copied into this trip's folder, so they open offline.</span></div><button class="btn" id="dzPick">Choose files…</button></div>
      ${t.docs.length ? `<div class="chips"><button class="chip ${f === 'all' ? 'on' : ''}" data-f="all">All <span>${t.docs.length}</span></button>${Object.entries(TAGS).filter(([k]) => counts[k]).map(([k, [l, ic]]) => `<button class="chip ${f === k ? 'on' : ''}" data-f="${k}">${icon(ic, 13)}${esc(l)} <span>${counts[k]}</span></button>`).join('')}</div>
      <div class="doc-grid">${list.map(docCard).join('')}</div>` : `<div class="doc-ideas">${Object.entries(TAGS).slice(0, 6).map(([k, [l, ic, tint]]) => `<button class="doc-idea" data-tag="${k}">${tile(tint, ic, 'md', 17)}<b>${esc(l)}</b><span>${esc(IDEAS[k])}</span></button>`).join('')}</div>`}`;
    $('#dzPick').onclick = () => addDocs();
    $$('[data-f]', v).forEach(b => b.onclick = () => { S.docFilter = b.dataset.f; render(); });
    $$('.doc-idea', v).forEach(b => b.onclick = () => addDocs({ tag: b.dataset.tag }));
    $$('.doc-card', v).forEach(c => {
      c.onclick = (e) => { if (e.target.closest('[data-more]')) return; openDoc(c.dataset.id); };
      c.oncontextmenu = (e) => { e.preventDefault(); docMenu(e, c.dataset.id); };
    });
    $$('[data-more]', v).forEach(b => b.onclick = (e) => { e.stopPropagation(); docMenu(b, b.dataset.more); });
    loadThumbs(v);
  },
  after() {
    $('#dcAdd').onclick = () => addDocs();
    $('#dcCopy').onclick = () => call('copyDocsOut', S.trip.id, null).then(n => n && toast(`Copied ${plural(n, 'file')}`)).catch(fail);
  },
};
const IDEAS = { passport: 'A scan or photo of each passport', visa: 'eVisas, ESTA, ETIAS, entry forms', ticket: 'Boarding passes, train and event tickets', booking: 'Hotel and rental confirmations', insurance: 'Policy and the emergency number', license: 'Driving licence, international permit' };

function docCard(d) {
  const [l, ic, tint] = TAGS[d.tag] || TAGS.other;
  const b = d.bookingId && S.trip.bookings.find(x => x.id === d.bookingId);
  return `<div class="doc-card" data-id="${d.id}">
    <div class="dc-thumb ${tint}" data-thumb="${d.kind === 'image' ? d.id : ''}">${d.kind === 'image' ? '' : `<span class="dc-ext">${esc((d.ext || 'file').toUpperCase())}</span>${icon(d.kind === 'pdf' ? 'fileText' : ic, 26)}`}</div>
    <div class="dc-body"><b class="ellip" title="${esc(d.name)}">${esc(d.name)}</b><span class="ellip">${esc(l)}${d.who ? ' · ' + esc(d.who) : ''} · ${esc(human(d.size))}</span>
    ${b ? `<span class="dc-link ellip">${icon('ticket', 11)} ${esc(b.title)}</span>` : ''}</div>
    <button class="icon-btn sm dc-more" data-more="${d.id}" title="More">${icon('more', 16)}</button>
  </div>`;
}
async function loadThumbs(root) {
  for (const el of $$('[data-thumb]', root)) {
    if (!el.dataset.thumb) continue;
    try { const f = await call('docFile', S.trip.id, el.dataset.thumb); if (f.exists) el.style.backgroundImage = `url("${f.url.replace(/"/g, '%22')}")`; el.classList.add('img'); } catch {}
  }
}
async function addDocs(meta = {}, paths) {
  try {
    const r = paths ? await call('addDocs', S.trip.id, paths, meta) : await call('pickDocs', S.trip.id, meta);
    if (!r || !r.added.length) return;
    S.trip = r.trip;
    if (S.view !== 'docs') go('docs'); else render();
    toast(`Added ${plural(r.added.length, 'document')}`, r.added.length === 1 ? `Filed under ${TAGS[r.added[0].tag][0]}` : 'Saved in the trip folder', 'ok', 5000, r.added.length === 1 ? [{ label: 'Edit details', run: () => docSheet(r.added[0].id) }] : null);
  } catch (e) { fail(e); }
}
function openDoc(id) {
  const d = S.trip.docs.find(x => x.id === id); if (!d) return;
  if (d.kind === 'image' || d.kind === 'pdf') call('previewDoc', S.trip.id, id).catch(fail);
  else call('openDoc', S.trip.id, id).catch(fail);
}
function docMenu(anchor, id) {
  const d = S.trip.docs.find(x => x.id === id); if (!d) return;
  menu(anchor, [
    { label: 'Preview', icon: 'eye', run: () => openDoc(id), disabled: !['image', 'pdf'].includes(d.kind) },
    { label: 'Open in its app', icon: 'external', run: () => call('openDoc', S.trip.id, id).catch(fail) },
    { label: 'Show in folder', icon: 'folder', run: () => call('showDoc', S.trip.id, id).catch(fail) },
    { label: 'Edit details…', icon: 'edit', run: () => docSheet(id) },
    { label: 'Copy to…', icon: 'export', run: () => call('copyDocsOut', S.trip.id, [id]).catch(fail) },
    '-',
    { label: 'Remove', icon: 'trash', danger: true, run: () => removeDoc(id) },
  ]);
}
async function removeDoc(id) {
  const d = S.trip.docs.find(x => x.id === id);
  if (!await confirmBox({ title: `Remove “${d.name}”?`, text: 'The copy in the trip folder goes to the Trash. Your original file is untouched.', ok: 'Remove', danger: true })) return;
  try { await flush(); S.trip = await call('removeDoc', S.trip.id, id); render(); } catch (e) { fail(e); }
}
function docSheet(id) {
  const t = S.trip, d = t.docs.find(x => x.id === id); if (!d) return;
  const el = openSheet(`<div class="sheet-head">${tile((TAGS[d.tag] || TAGS.other)[2], (TAGS[d.tag] || TAGS.other)[1], 'md', 18)}<div class="grow"><h3>Document details</h3><div class="muted small">${esc(d.file.split('/').pop())} · ${esc(human(d.size))}</div></div></div>
    <div class="sheet-body">
      <div class="field"><label>Name</label><input class="input" name="name" value="${esc(d.name)}"></div>
      <div class="grid2"><div class="field"><label>Kind</label><select class="select" name="tag">${Object.entries(TAGS).map(([k, [l]]) => `<option value="${k}" ${k === d.tag ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div class="field"><label>Whose</label><select class="select" name="who"><option value="">Everyone</option>${t.travelers.map(p => `<option ${p === d.who ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div></div>
      <div class="field"><label>Goes with booking</label><select class="select" name="bookingId"><option value="">None</option>${t.bookings.map(b => `<option value="${b.id}" ${b.id === d.bookingId ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}</select></div>
      <div class="field"><label>Notes</label><textarea class="input area" name="notes" rows="2">${esc(d.notes || '')}</textarea></div>
    </div>
    <div class="sheet-foot"><span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="ok">Save</button></div>`, { width: 500 });
  el.querySelector('[data-x]').onclick = closeSheet;
  el.querySelector('#ok').onclick = () => {
    const f = formVals(el);
    if (d.bookingId !== f.bookingId) {
      for (const b of t.bookings) b.docs = (b.docs || []).filter(x => x !== d.id);
      const nb = t.bookings.find(b => b.id === f.bookingId); if (nb) nb.docs.push(d.id);
    }
    Object.assign(d, f, { name: f.name || d.name });
    persist(); closeSheet(); render();
  };
}
