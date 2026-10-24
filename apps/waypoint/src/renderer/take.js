// Take it with you: hand the trip to a phone over Wi-Fi (scan a code), save the one-file offline pack,
// send the whole trip to another computer with Beam or as a .waypoint file, or save a PDF itinerary.
'use strict';

async function takeSheet(tab = 'phone') {
  const t = S.trip; if (!t) return;
  await flush();
  const el = openSheet(`<div class="sheet-head">${tile('a-sunset', 'suitcase', 'md', 18)}<div class="grow"><h3>Take ${esc(t.name)} with you</h3><div class="muted small">Every way works without the cloud — and once it's on your device, without signal.</div></div><button class="icon-btn sm" data-x>${icon('x', 16)}</button></div>
    <div class="take-tabs">${[['phone', 'qr', 'To your phone'], ['pack', 'wifiOff', 'Offline pack'], ['file', 'beam', 'Another computer'], ['pdf', 'print', 'PDF']].map(([k, i, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${icon(i, 15)}${l}</button>`).join('')}</div>
    <div class="sheet-body take-body" id="takeBody"></div>`, { width: 640, onClose: () => { if (S.share && S.share.on && !S.keepSharing) { /* keep sharing until the trip closes or the user stops */ } } });
  el.querySelector('[data-x]').onclick = closeSheet;
  const show = (k) => { $$('.take-tabs button', el).forEach(b => b.classList.toggle('on', b.dataset.tab === k)); TAKE[k]($('#takeBody', el)); hydrateIcons(el); };
  $$('.take-tabs button', el).forEach(b => b.onclick = () => show(b.dataset.tab));
  show(tab);
}

const TAKE = {
  async phone(box) {
    const t = S.trip;
    box.innerHTML = `<div class="muted small">Starting…</div>`;
    let info;
    try { info = await call('shareInfo', t.id); if (!info.on) info = await call('shareOpen', t.id); } catch (e) { box.innerHTML = `<div class="note-box warn">${icon('alert', 16)}<div>${esc(e.message)}</div></div>`; return; }
    S.share = info;
    drawPhone(box, info);
  },
  pack(box) {
    const t = S.trip;
    const docBytes = t.docs.reduce((a, d) => a + (d.size || 0), 0);
    box.innerHTML = `
      <div class="take-hero">${phoneMock()}<div class="grow">
        <h4>One page, the whole trip</h4>
        <p>A single web page with every day, booking and confirmation number, key facts, the packing list${S.settings.embedDocs !== false && t.docs.length ? ' — and your documents inside it' : ''}. It opens in any browser on any device with no app and no internet. Email it to yourself, drop it in iCloud Drive or Google Drive, or AirDrop it to your phone.</p>
        <label class="check-line"><input type="checkbox" id="pkEmbed" ${S.settings.embedDocs !== false ? 'checked' : ''}> Put documents inside the page${t.docs.length ? ` <span class="muted">(${plural(t.docs.length, 'file')}, ${esc(human(docBytes))})</span>` : ''}</label>
        <div class="row" style="gap:8px;margin-top:14px"><button class="btn primary" id="pkSave">${icon('download', 15)}Save offline pack…</button><button class="btn" id="pkPrev">${icon('eye', 15)}Preview</button></div>
      </div></div>`;
    $('#pkEmbed').onchange = (e) => setSettings({ embedDocs: e.target.checked }, true);
    $('#pkSave').onclick = async () => { try { const r = await call('savePack', t.id); if (r) toast('Offline pack saved', `${r.path.split(/[\\/]/).pop()} · ${human(r.size)}`); } catch (e) { fail(e); } };
    $('#pkPrev').onclick = () => call('previewPack', t.id).catch(fail);
  },
  file(box) {
    const t = S.trip;
    box.innerHTML = `
      <div class="take-two">
        <div class="take-opt">${tile('a-sky', 'beam', 'lg', 20)}<h4>Send with Beam</h4><p>Beam finds your other Macs and PCs on this network and sends the trip straight over — documents and all, as fast as your Wi-Fi goes. On the other computer, double-click the file to open it in Waypoint.</p>
          ${S.beam ? `<button class="btn primary" id="tfBeam">${icon('beam', 15)}Send with Beam</button>` : `<div class="note-box">${icon('info', 16)}<div>Beam isn't on this computer yet. Install it from Utility Hub, or save the file below and move it any way you like.</div></div>`}</div>
        <div class="take-opt">${tile('a-gold', 'suitcase', 'lg', 20)}<h4>Save a .waypoint file</h4><p>One file with the whole trip and every document inside. Move it by USB, email, a shared drive or AirDrop, then open it in Waypoint on the other computer — or drag it onto the Waypoint window.</p>
          <button class="btn ${S.beam ? '' : 'primary'}" id="tfSave">${icon('download', 15)}Save trip file…</button></div>
      </div>
      <div class="bar" id="tfProg" hidden><i style="width:0%"></i></div>`;
    if ($('#tfBeam')) $('#tfBeam').onclick = () => sendWithBeam();
    $('#tfSave').onclick = async () => { $('#tfProg').hidden = false; try { const r = await call('saveBundle', t.id); if (r) toast('Trip file saved', `${plural(r.docs, 'document')} · ${human(r.size)}`); } catch (e) { fail(e); } $('#tfProg').hidden = true; };
  },
  pdf(box) {
    const t = S.trip;
    box.innerHTML = `<div class="take-hero"><div class="pdf-mock">${TL.dayList(t.start, t.end).slice(0, 3).map((d, i) => `<div><b>Day ${i + 1}</b>${TL.itemsOn(t, d).slice(0, 3).map(x => `<i class="${typeOf(x.type).tint}"></i>`).join('')}</div>`).join('')}</div><div class="grow">
      <h4>A printable itinerary</h4><p>Every day with times, places and confirmation numbers, then all the bookings and key facts — on clean pages for printing, emailing to family, or keeping in your bag.</p>
      <button class="btn primary" id="pdfSave">${icon('print', 15)}Save PDF…</button></div></div>`;
    $('#pdfSave').onclick = () => savePdf();
  },
};

function drawPhone(box, info) {
  const t = S.trip;
  if (!info.url) { box.innerHTML = `<div class="note-box warn">${icon('wifiOff', 16)}<div>This computer isn't on a network right now. Connect to Wi-Fi, then try again — or use the Offline pack tab.</div></div>`; return; }
  const n = info.qr.n, cell = 6, pad = 4, size = (n + pad * 2) * cell;
  let rects = '';
  info.qr.rows.forEach((row, r) => { for (let c = 0; c < n; c++) if (row[c] === '1') rects += `M${(c + pad) * cell} ${(r + pad) * cell}h${cell}v${cell}h-${cell}z`; });
  box.innerHTML = `
    <div class="phone-take">
      <div class="qr-wrap"><svg viewBox="0 0 ${size} ${size}" width="220" height="220"><rect width="${size}" height="${size}" rx="${cell * 2}" fill="#fff"/><path d="${rects}" fill="#1c1410"/></svg><span class="qr-badge">${icon('qr', 14)} Scan with your camera</span></div>
      <div class="grow">
        <h4>Open it on your phone</h4>
        <ol class="steps-list"><li>Make sure your phone is on the same Wi-Fi as this computer.</li><li>Point the camera at the code and tap the link.</li><li>Tap <b>Save for offline</b> on the page — the trip, with documents, is then on your phone and works with no signal.</li></ol>
        <div class="url-row"><span class="mono ellip">${esc(info.url)}</span><button class="icon-btn xs" data-copy="${esc(info.url)}" title="Copy link">${icon('copy', 13)}</button></div>
        ${info.addresses.length > 1 ? `<div class="field" style="margin-top:8px"><label>Network</label><select class="select" id="shAddr">${info.addresses.map(a => `<option value="${a.address}" ${a.address === info.address ? 'selected' : ''}>${esc(a.address)} · ${esc(a.name)}</option>`).join('')}</select></div>` : ''}
        <div class="visits">${info.visits.length ? info.visits.slice(0, 4).map(v => `<div>${icon(v.dev === 'iPhone' || v.dev === 'Android' ? 'phone' : v.dev === 'iPad' ? 'tablet' : 'browser', 13)}<span class="grow">${esc(v.dev)} ${esc(v.what)}</span><span class="muted tiny">${esc(new Date(v.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</span></div>`).join('') : `<div class="muted small"><span class="dot on"></span> Waiting for a phone…</div>`}</div>
        <div class="row" style="gap:6px;margin-top:12px"><button class="btn sm" id="shNew">${icon('refresh', 13)}New link</button><button class="btn sm ghost danger" id="shStop">${icon('stop', 13)}Stop sharing</button></div>
        <div class="hint" style="margin-top:8px">Only devices on this network with the link can open it, and only while Waypoint is open and sharing is on.${W.platform === 'win32' ? ' If the phone can\'t connect, allow Waypoint on Private networks when Windows asks.' : ''}</div>
      </div>
    </div>`;
  hydrateIcons(box);
  if ($('#shAddr')) $('#shAddr').onchange = async (e) => { S.share = await call('shareInfo', t.id, e.target.value); drawPhone(box, S.share); };
  $('#shNew').onclick = async () => { S.share = await call('shareNewLink', t.id); drawPhone(box, S.share); toast('New link made', 'The old code no longer works.'); };
  $('#shStop').onclick = async () => { await call('shareClose', t.id); S.share = null; closeSheet(); toast('Stopped sharing'); };
}
function phoneMock() {
  const t = S.trip;
  const d = TL.dayList(t.start, t.end)[0];
  const items = d ? TL.itemsOn(t, d).slice(0, 4) : [];
  return `<div class="phone-mock"><div class="pm-hero" style="background:${coverCss(t.cover)}"><span>${esc(flagOf(t.country))}</span><b>${esc(t.name)}</b></div>${items.map(i => `<div class="pm-row"><i class="${typeOf(i.type).tint}"></i><span class="ellip">${esc(i.title)}</span></div>`).join('')}<div class="pm-tabs"><i></i><i></i><i></i><i></i></div></div>`;
}
async function sendWithBeam() {
  const t = S.trip;
  await flush();
  const tt = toast('Packing the trip for Beam…', '', 'busy', 0);
  try { const r = await call('beam', t.id); tt.remove(); toast('Handed to Beam', `Pick the computer in Beam. ${plural(r.docs, 'document')} · ${human(r.size)}`); }
  catch (e) { tt.remove(); fail(e); }
}
async function savePdf() {
  await flush();
  try { const r = await call('savePdf', S.trip.id); if (r) toast('PDF saved', r.path.split(/[\\/]/).pop()); } catch (e) { fail(e); }
}
