// Research: key facts for the destination (built in, editable), places you want to go (add any of them
// to a day), saved links, a packing list and free notes — all kept offline with the trip.
'use strict';

VIEWS.research = {
  head: () => `<h1>Research <small>${esc(S.trip.destination || '')}</small></h1>`,
  actions: () => `<button class="btn primary" id="rsAdd"><span data-icon="plus" data-size="15"></span>Add a place</button>`,
  render(v) {
    const t = S.trip, r = t.research;
    const base = PLACES.get(t.country) || {};
    const f = { ...base, ...r.facts };
    const local = t.tz ? TL.localNow(t.tz) : null;
    const packDone = r.packing.filter(p => p.done).length;
    const pf = S.placeFilter || 'want';
    const places = r.places.filter(p => pf === 'all' || (pf === 'want' ? !p.visited : p.visited));
    const scheduled = new Map(); for (const i of t.items) scheduled.set((i.title || '').toLowerCase(), i.day);
    v.innerHTML = `
    <div class="rs-grid">
      <div class="rs-col">
        <div class="card">
          <div class="card-head"><b>Places to go</b><div class="seg" id="pf">${[['want', 'To do'], ['done', 'Been'], ['all', 'All']].map(([k, l]) => `<button data-k="${k}" class="${pf === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          <form class="quick-add" id="pa" autocomplete="off"><input class="input grow" name="name" placeholder="Add a place — a café, a viewpoint, a museum…"><select class="select" name="kind">${['sight', 'food', 'activity', 'rest'].map(k => `<option value="${k}">${esc(TL.TYPES[k].label)}</option>`).join('')}</select><input class="input" name="area" placeholder="Area" style="width:130px"><button class="btn primary" type="submit">${icon('plus', 15)}</button></form>
          <div class="place-list">${places.length ? places.map(p => { const day = scheduled.get(p.name.toLowerCase()); const T = typeOf(p.kind); return `<div class="place ${p.visited ? 'visited' : ''}" data-id="${p.id}">
            <button class="pl-check" data-visit="${p.id}" title="${p.visited ? 'Mark not been' : 'Mark been'}">${p.visited ? icon('check', 14) : ''}</button>
            ${tile(T.tint, T.icon, 'sm', 13)}
            <div class="grow" style="min-width:0"><input class="pl-name" data-f="name" value="${esc(p.name)}"><input class="pl-notes" data-f="notes" value="${esc(p.notes || '')}" placeholder="Add a note"></div>
            <span class="pl-area ellip">${esc(p.area || '')}</span>
            ${day ? `<button class="pill acc" data-goday="${day}">${icon('calendar', 11)} ${esc(fmtDate(day, { month: 'short', day: 'numeric' }))}</button>` : `<button class="btn xs" data-plan="${p.id}">${icon('plus', 12)}Plan it</button>`}
            <button class="icon-btn xs" data-pmore="${p.id}">${icon('more', 14)}</button></div>`; }).join('') : `<div class="muted small" style="padding:10px 2px">${pf === 'done' ? 'Nothing ticked off yet.' : 'Collect places as you research — then drop them into a day.'}</div>`}</div>
        </div>
        <div class="card">
          <div class="card-head"><b>Notes</b><span class="muted small">saved as you type</span></div>
          <textarea class="input area notes-area" id="rsNotes" rows="8" placeholder="Tipping, neighbourhoods, what to book ahead, phrases…">${esc(r.notes)}</textarea>
        </div>
      </div>
      <div class="rs-col">
        <div class="card">
          <div class="card-head"><b>${esc(flagOf(t.country))} Key facts</b><button class="link-btn" id="factEdit">Edit</button></div>
          ${local ? `<div class="clock-row"><div><span class="tiny muted">There now</span><b>${esc(tmin(local.min))}</b><span class="muted small">${esc(fmtDate(local.date, { weekday: 'long' }))}</span></div><div><span class="tiny muted">Here</span><b>${esc(tmin(new Date().getHours() * 60 + new Date().getMinutes()))}</b><span class="muted small">${esc((() => { const o = TL.tzOffsetHours(t.tz), c = t.tz.split('/').pop().replace(/_/g, ' '); return o === 0 ? 'Same time as ' + c : `${c} is ${Math.abs(o)} h ${o > 0 ? 'ahead' : 'behind'}`; })())}</span></div></div>` : ''}
          ${factRows(f, t)}
        </div>
        <div class="card">
          <div class="card-head"><b>Packing</b><span class="muted small">${packDone} of ${r.packing.length} packed</span></div>
          ${r.packing.length ? `<div class="bar" style="margin-bottom:10px"><i style="width:${r.packing.length ? packDone / r.packing.length * 100 : 0}%"></i></div>` : ''}
          <div class="pack-list">${r.packing.map(p => `<label class="pack ${p.done ? 'done' : ''}"><input type="checkbox" data-pack="${p.id}" ${p.done ? 'checked' : ''}><span class="grow">${esc(p.text)}</span><button class="icon-btn xs" data-unpack="${p.id}" title="Remove">${icon('x', 12)}</button></label>`).join('')}</div>
          <form class="quick-add" id="pk" autocomplete="off"><input class="input grow" name="text" placeholder="Add to the list"><button class="btn" type="submit">${icon('plus', 15)}</button></form>
          ${!r.packing.length ? `<button class="link-btn" id="pkStart" style="margin-top:8px">${icon('sparkle', 13)} Start from a basic list</button>` : ''}
        </div>
        <div class="card">
          <div class="card-head"><b>Saved links</b><span class="muted small">open when you're online</span></div>
          <div class="link-list">${r.links.map(l => `<div class="link-row"><button class="grow ellip link-plain" data-url="${esc(l.url)}" title="${esc(l.url)}">${icon('link', 13)} ${esc(l.title || l.url)}</button><button class="icon-btn xs" data-unlink="${l.id}">${icon('x', 12)}</button></div>`).join('')}</div>
          <form class="quick-add" id="lk" autocomplete="off"><input class="input" name="title" placeholder="Name" style="width:120px"><input class="input grow" name="url" placeholder="https://…"><button class="btn" type="submit">${icon('plus', 15)}</button></form>
        </div>
      </div>
    </div>`;
    $$('#pf button').forEach(b => b.onclick = () => { S.placeFilter = b.dataset.k; render(); });
    $('#pa').onsubmit = (e) => { e.preventDefault(); const f2 = formVals($('#pa')); if (!f2.name) return; r.places.unshift({ id: newId(), name: f2.name, kind: f2.kind, area: f2.area, notes: '', want: true, visited: false }); persist(); render(); setTimeout(() => $('#pa [name=name]').focus(), 10); };
    $$('[data-visit]', v).forEach(b => b.onclick = () => { const p = r.places.find(x => x.id === b.dataset.visit); p.visited = !p.visited; persist(); render(); });
    $$('.place [data-f]', v).forEach(i => i.onchange = () => { const p = r.places.find(x => x.id === i.closest('.place').dataset.id); p[i.dataset.f] = i.value.trim(); persist(); });
    $$('[data-plan]', v).forEach(b => b.onclick = (e) => planPlace(e.currentTarget, r.places.find(x => x.id === b.dataset.plan)));
    $$('[data-goday]', v).forEach(b => b.onclick = () => go('timeline', { day: b.dataset.goday }));
    $$('[data-pmore]', v).forEach(b => b.onclick = () => { const p = r.places.find(x => x.id === b.dataset.pmore); menu(b, [
      { label: 'Kind', section: true }, ...['sight', 'food', 'activity', 'rest'].map(k => ({ label: TL.TYPES[k].label, icon: TL.TYPES[k].icon, on: p.kind === k, run: () => { p.kind = k; persist(); render(); } })),
      '-', { label: 'Look it up on a map', icon: 'map', run: () => call('openUrl', mapsUrl([p.name, p.area, t.destination].filter(Boolean).join(', '))) },
      { label: 'Remove', icon: 'trash', danger: true, run: () => { r.places = r.places.filter(x => x.id !== p.id); persist(); render(); } },
    ]); });
    $('#rsNotes').oninput = (e) => { r.notes = e.target.value; persist(); };
    $('#factEdit').onclick = () => factSheet();
    $$('[data-pack]', v).forEach(c => c.onchange = () => { r.packing.find(x => x.id === c.dataset.pack).done = c.checked; persist(); render(); });
    $$('[data-unpack]', v).forEach(b => b.onclick = (e) => { e.preventDefault(); r.packing = r.packing.filter(x => x.id !== b.dataset.unpack); persist(); render(); });
    $('#pk').onsubmit = (e) => { e.preventDefault(); const x = formVals($('#pk')).text; if (!x) return; r.packing.push({ id: newId(), text: x, done: false }); persist(); render(); setTimeout(() => $('#pk [name=text]').focus(), 10); };
    if ($('#pkStart')) $('#pkStart').onclick = () => { r.packing = basicPacking(t).map(text => ({ id: newId(), text, done: false })); persist(); render(); };
    $('#lk').onsubmit = (e) => { e.preventDefault(); const x = formVals($('#lk')); if (!x.url) return; const url = /^https?:\/\//i.test(x.url) ? x.url : 'https://' + x.url; r.links.push({ id: newId(), title: x.title || url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0], url }); persist(); render(); };
    $$('[data-unlink]', v).forEach(b => b.onclick = () => { r.links = r.links.filter(x => x.id !== b.dataset.unlink); persist(); render(); });
  },
  after() { $('#rsAdd').onclick = () => { const i = $('#pa [name=name]'); if (i) i.focus(); }; },
};

function planPlace(anchor, p) {
  const t = S.trip;
  menu(anchor, [{ label: 'Add to which day?', section: true }, ...TL.dayList(t.start, t.end).map((d, i) => ({ label: `Day ${i + 1} · ${fmtDate(d)}`, icon: 'calendar', hint: plural(TL.itemsOn(t, d).length, 'plan'), run: () => {
    S.day = d;
    const g = TL.gaps(TL.itemsOn(t, d).filter(x => TL.span(x)), { from: 9 * 60, to: 21 * 60, min: 60 })[0];
    const s = g ? g.s : 10 * 60;
    S.mode = 'day';
    addPlan({ title: p.name, type: TL.TYPES[p.kind] ? p.kind : 'sight', place: p.area || '', notes: p.notes || '', start: TL.fromMin(s), end: TL.fromMin(s + 90) });
  } }))]);
}
function basicPacking(t) {
  const f = PLACES.get(t.country);
  const list = ['Passport / ID', 'Phone and charger', 'Wallet and cards', 'Travel insurance details', 'Medications', 'Toothbrush and toiletries', 'Comfortable shoes', 'Clothes for each day', 'Sleepwear', 'Headphones', 'Sunglasses', 'Reusable water bottle'];
  if (t.abroad !== false) list.splice(1, 0, f && f.plugs ? `Power adapter (type ${f.plugs})` : 'Power adapter');
  if (f && f.currency && f.currency !== t.currency) list.push(`A little cash in ${f.currency}`);
  return list;
}
function factSheet() {
  const t = S.trip, base = PLACES.get(t.country) || {}, mine = t.research.facts || {};
  const F = [['emergency', 'Emergency numbers'], ['currency', 'Currency'], ['plugs', 'Plug types'], ['volts', 'Voltage'], ['drive', 'Drives on the'], ['dial', 'Dialling code'], ['languages', 'Languages']];
  const el = openSheet(`<div class="sheet-head">${tile('a-teal', 'info', 'md', 18)}<div class="grow"><h3>Key facts</h3><div class="muted small">${base.name ? `Filled in for ${esc(base.name)} — change anything, or blank it to use the built-in value.` : 'Add what you want handy offline.'}</div></div></div>
    <div class="sheet-body"><div class="grid2">${F.map(([k, l]) => `<div class="field"><label>${esc(l)}</label><input class="input" name="${k}" value="${esc(mine[k] ?? '')}" placeholder="${esc(base[k] || '')}"></div>`).join('')}</div>
      <div class="field"><label>Anything else <span class="muted">(embassy, hotel phone, Wi-Fi code…)</span></label><input class="input" name="extra" value="${esc(mine.extra || '')}"></div></div>
    <div class="sheet-foot"><span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="ok">Save</button></div>`, { width: 560 });
  el.querySelector('[data-x]').onclick = closeSheet;
  el.querySelector('#ok').onclick = () => { const f = formVals(el); const out = {}; for (const [k, v] of Object.entries(f)) if (v) out[k] = v; t.research.facts = out; persist(); closeSheet(); render(); };
}
