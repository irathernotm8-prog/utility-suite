/* Relay — Tracking tab: every package across UPS, USPS, FedEx, DHL, Amazon and more */
(() => {
  const R = () => window.RelayApp;
  const cap = (x) => x ? x[0].toUpperCase() + x.slice(1) : x;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => R().esc(s);
  const C = window.Carriers;
  const t = { list: [], filter: 'active', selected: null, el: null, side: null, loaded: false, refreshing: false };

  const STAGE = { unknown: 0, pending: 0, info_received: 1, in_transit: 2, pickup: 3, out_for_delivery: 3, delivered: 4, exception: 2, expired: 0 };
  const COLOR = { unknown: '#8a869b', pending: '#8a869b', info_received: '#64748b', in_transit: '#1f7bff', pickup: '#a855f7', out_for_delivery: '#f97316', delivered: '#22a06b', exception: '#e5484d', expired: '#8a869b' };
  const LABEL = { unknown: 'Not checked yet', pending: 'Waiting for carrier', info_received: 'Label created', in_transit: 'In transit', pickup: 'Ready for pickup', out_for_delivery: 'Out for delivery', delivered: 'Delivered', exception: 'Delivery problem', expired: 'Tracking expired' };
  const STEPS = ['Label created', 'In transit', 'Out for delivery', 'Delivered'];
  const isActive = (p) => !p.archived && p.status !== 'delivered';
  const DAY = 86400000;

  /* ---------- ETAs ---------- */
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function etaDate(p) { if (!p.eta) return null; const d = new Date(p.eta.to || p.eta.from); return isNaN(d) ? null : d; }
  function etaInfo(p) {
    if (p.status === 'delivered') {
      const d = p.deliveredAt ? new Date(p.deliveredAt) : null;
      return { label: 'Delivered', sub: d && !isNaN(d) ? d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '', tone: 'done' };
    }
    const d = etaDate(p);
    if (!d) return { label: p.status === 'out_for_delivery' ? 'Arriving today' : 'No ETA yet', sub: p.status === 'out_for_delivery' ? 'Out for delivery' : (p.lastChecked ? 'Carrier hasn’t shared one yet' : 'Open the carrier page to check'), tone: p.status === 'out_for_delivery' ? 'today' : 'none' };
    const days = Math.round((startOfDay(d) - startOfDay(new Date())) / DAY);
    const from = p.eta.from && p.eta.to && p.eta.from !== p.eta.to ? new Date(p.eta.from) : null;
    const fmt = (x) => x.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const label = days < 0 ? 'Running late' : days === 0 ? 'Arriving today' : days === 1 ? 'Arriving tomorrow' : days < 7 ? `Arriving ${d.toLocaleDateString(undefined, { weekday: 'long' })}` : `Arriving ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    return { label, sub: (from && !isNaN(from) ? `${fmt(from)} – ${fmt(d)}` : fmt(d)) + (p.eta.source === 'email' ? ' · from email' : p.eta.source === 'manual' ? ' · your estimate' : p.eta.source === 'page' ? ' · from carrier site' : ''), tone: days < 0 ? 'late' : days <= 1 ? 'today' : 'later', days };
  }

  // "Arriving Thursday, October 9", "Estimated delivery: Oct 9", "Get it by Fri, Oct 10", "Delivery date 10/09/2026"…
  function extractEta(text) {
    const s = String(text || '').replace(/\s+/g, ' ');
    const now = new Date();
    const WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const trig = '(?:arriv(?:ing|es)|estimated (?:delivery|arrival)(?: date)?|expected (?:delivery|arrival)(?: date)?|delivery date|scheduled (?:delivery|for)|will arrive|get it|delivers?|delivered)';
    let m = s.match(new RegExp(trig + "[^.\\n]{0,24}?(?:on |by )?(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,? )?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.? \\d{1,2}(?:,? \\d{4})?)", 'i'));
    if (m) {
      let d = new Date(m[1].replace(/\./, '') + (/\d{4}/.test(m[1]) ? '' : ' ' + now.getFullYear()));
      if (!isNaN(d)) { if (!/\d{4}/.test(m[1]) && d < now - 60 * DAY) d.setFullYear(d.getFullYear() + 1); return d; }
    }
    m = s.match(new RegExp(trig + "[^.\\n]{0,24}?(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?", 'i'));
    if (m) { const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear(); const d = new Date(y, +m[1] - 1, +m[2]); if (!isNaN(d)) return d; }
    m = s.match(new RegExp(trig + "[^.\\n]{0,16}?\\b(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\\b", 'i'));
    if (m) {
      const w = m[1].toLowerCase();
      const d = startOfDay(now);
      if (w === 'tomorrow') d.setDate(d.getDate() + 1);
      else if (w !== 'today') { const diff = (WEEK.indexOf(w) - d.getDay() + 7) % 7; d.setDate(d.getDate() + diff); }
      return d;
    }
    return null;
  }

  /* ---------- data ---------- */
  async function load() { t.list = await relay.track.list(); t.loaded = true; }
  function counts() {
    const today = t.list.filter(p => isActive(p) && (p.status === 'out_for_delivery' || etaInfo(p).days === 0)).length;
    return { active: t.list.filter(isActive).length, today, delivered: t.list.filter(p => p.status === 'delivered' && !p.archived).length, archived: t.list.filter(p => p.archived).length, all: t.list.length };
  }
  function filtered() {
    let l = t.list;
    if (t.filter === 'active') l = l.filter(isActive);
    else if (t.filter === 'today') l = l.filter(p => isActive(p) && (p.status === 'out_for_delivery' || etaInfo(p).days === 0));
    else if (t.filter === 'delivered') l = l.filter(p => p.status === 'delivered' && !p.archived);
    else if (t.filter === 'archived') l = l.filter(p => p.archived);
    else if (t.filter.startsWith('c:')) l = l.filter(p => p.carrier === t.filter.slice(2));
    return [...l].sort((a, b) => (isActive(b) - isActive(a)) || ((etaDate(a) || new Date(8e15)) - (etaDate(b) || new Date(8e15))) || (b.addedAt - a.addedAt));
  }

  async function add(input, { quiet = false } = {}) {
    try {
      const r = await relay.track.add(input);
      t.list = r.list;
      t.selected = r.id;
      if (!quiet) R().toast(r.existed ? 'Already tracking that package' : `Tracking ${C.info(input.carrier || C.detect(input.number) || 'other').name} package`);
      refreshUI();
      return r;
    } catch (e) { R().toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error'); }
  }

  // From an email: name it after the store/item and pick up the ETA the email mentions
  async function addFromEmail({ number, carrier, text = '', subject = '', from = '', accountId = null }) {
    const eta = extractEta(text);
    let name = '';
    const s = R().state;
    const prov = s.settings.aiProvider || 'claude';
    if (prov !== 'assist' && R().aiReady(prov) && text) {
      try {
        const out = await Promise.race([
          relay.aiComplete({ system: 'Name a shipped package from its email. Reply with JSON only: {"name":"what was ordered and from where, max 6 words, e.g. \\"Running shoes from Nike\\""}', prompt: `Subject: ${subject}\nFrom: ${from}\n\n${text.slice(0, 3000)}`, maxTokens: 60 }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 9000))
        ]);
        name = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).name || '';
      } catch {}
    }
    if (!name) {
      const store = (from || '').replace(/<.*>/, '').replace(/["']/g, '').trim();
      name = store && !/no-?reply|ups|usps|fedex|dhl/i.test(store) ? `Order from ${store}` : (subject || '').replace(/^(re|fwd?):\s*/i, '').slice(0, 48);
    }
    return add({ number, carrier, name, eta: eta ? { from: eta.toISOString(), to: eta.toISOString(), source: 'email' } : null, source: { accountId, subject, from } });
  }

  /* ---------- sidebar ---------- */
  function renderSidebar(side) {
    if (!side) return;
    t.side = side;
    if (R().state.ui.platform !== 'tracking') return;
    const c = counts();
    const carriers = [...new Set(t.list.map(p => p.carrier))];
    const hasKey = R().state.settings.hasTrackKey;
    const nav = (k, l, i, n) => `<button data-f="${k}" class="${t.filter === k ? 'active' : ''}">${ic(i, 17)}<span>${l}</span>${n ? `<span class="pill">${n}</span>` : ''}</button>`;
    side.innerHTML = `<div class="home-side">
      <nav class="side-nav">
        ${nav('active', 'On the way', 'truck', c.active)}
        ${nav('today', 'Arriving today', 'flag', c.today)}
        ${nav('delivered', 'Delivered', 'checkCircle', c.delivered)}
        ${nav('archived', 'Archived', 'archive', c.archived)}
        ${nav('all', 'All packages', 'box', c.all)}
      </nav>
      ${carriers.length ? `<div class="side-head" style="padding-top:16px"><div class="side-title">Carriers</div></div>
        <nav class="side-nav">${carriers.map(k => `<button data-f="c:${k}" class="${t.filter === 'c:' + k ? 'active' : ''}"><span class="cr-dot" style="--c:${C.info(k).color}"></span><span>${esc(C.info(k).name)}</span><span class="pill">${t.list.filter(p => p.carrier === k).length}</span></button>`).join('')}</nav>` : ''}
      <button class="add-account" id="trAddSide" style="--c:var(--tracking);margin-top:12px"><span class="plus">${ic('plus', 18)}</span><span>Track a package</span></button>
      <div class="health good tr-live" id="trKeyBox" style="cursor:pointer" title="Check every package now">
        ${ic('refresh', 18)}<div><b>${hasKey ? 'Updates via 17TRACK API' : 'Updates from carrier sites'}</b><span>${hasKey ? 'Refreshed every 2 hours in the background' : 'Relay reads each carrier’s tracking page — click to check all now'}</span></div>
      </div>
      <button class="link sm tr-api-link" id="trApiLink">${hasKey ? '17TRACK API settings' : 'Have a 17TRACK API key?'}</button>
    </div>`;
    $$('[data-f]', side).forEach(b => b.onclick = () => { t.filter = b.dataset.f; renderSidebar(side); render(t.el); });
    $('#trAddSide', side).onclick = () => openAdd();
    $('#trKeyBox', side).onclick = () => refreshAll();
    $('#trApiLink', side).onclick = openKey;
  }

  /* ---------- main ---------- */
  // The view is built once; later updates patch the list and details so the embedded carrier page never reloads by accident.
  async function render(el) {
    if (!el) return;
    t.el = el;
    if (R().state.ui.platform !== 'tracking') return;
    if (!t.loaded) { await load(); renderSidebar(t.side || $('#sidebar')); }
    if (!t.mode) t.mode = (() => { try { return localStorage.getItem('relay-track-mode'); } catch { return null; } })() || (R().state.settings.hasTrackKey ? 'details' : 'page');
    if (!$('.tracking-view', el)) build(el);
    // quietly re-check packages that haven't been looked at for a few hours
    if (!R().state.settings.hasTrackKey && !t.refreshing && Date.now() - (t.lastAuto || 0) > 30 * 60000 &&
        t.list.some(p => isActive(p) && Date.now() - (p.lastChecked || 0) > 3 * 3600000)) { t.lastAuto = Date.now(); setTimeout(() => refreshAll(true), 800); }
    const list = filtered();
    if (!t.selected || !t.list.find(p => p.id === t.selected)) t.selected = list[0]?.id || null;
    const p = t.list.find(x => x.id === t.selected);
    $('#trList', el).innerHTML = list.map(cardHTML).join('') || `<div class="card-empty tall">${ic('box', 24)}<span>${t.list.length ? 'Nothing here.' : 'No packages yet. Paste a tracking number above, or open a shipping email — Relay will offer to track it.'}</span></div>`;
    $$('.tr-card', el).forEach(c => c.onclick = () => { t.selected = c.dataset.id; render(el); });
    $('#trRefresh', el).classList.toggle('spin', !!t.refreshing);
    $('#trRefresh', el).title = t.refreshing ? (t.progress || 'Checking…') : 'Check every package now';
    $('#trProgress', el).textContent = t.refreshing ? (t.progress || 'Checking…') : '';
    const empty = $('#trEmpty', el), right = $('#trRight', el);
    empty.hidden = !!p; right.hidden = !p;
    if (!p) { empty.innerHTML = detailEmptyHTML(); hidePage(); return; }
    $('#trHero', el).innerHTML = heroHTML(p);
    $$('#trSeg button', el).forEach(b => b.classList.toggle('active', b.dataset.m === t.mode));
    $('#trBody', el).hidden = t.mode !== 'details';
    $('#trPage', el).hidden = t.mode !== 'page';
    if (t.mode === 'details') $('#trBody', el).innerHTML = detailsHTML(p);
    else showPage(p);
    bindDetail(el);
  }

  function build(el) {
    el.innerHTML = `<div class="tracking-view">
      <div class="tr-pane">
        <div class="tp-head">
          <h2>Packages</h2>
          <span class="muted-sm" id="trProgress"></span>
          <button class="icon-btn" id="trRefresh" title="Check every package now">${ic('refresh', 16)}</button>
        </div>
        <form class="quick-add tr-quick" id="trQuick"><span class="plus">${ic('box', 16)}</span><input class="qa-input" id="trQuickIn" placeholder="Paste a tracking number…" autocomplete="off" spellcheck="false"><span class="tr-detect" id="trDetect"></span></form>
        <div class="tr-list" id="trList"></div>
      </div>
      <div class="tr-detail-wrap">
        <div class="tr-detail" id="trEmpty" hidden></div>
        <div class="tr-right" id="trRight">
          <div class="tr-hero-wrap" id="trHero"></div>
          <div class="tr-switch">
            <div class="seg" id="trSeg"><button data-m="page">${ic('globe', 14)} Carrier page</button><button data-m="details">${ic('list', 14)} Details</button></div>
            <span class="spacer"></span>
            <span class="tr-page-tools" id="trPageTools"></span>
          </div>
          <div class="tr-detail" id="trBody"></div>
          <div class="tr-page" id="trPage"><div class="tr-page-note" id="trPageNote" hidden></div></div>
        </div>
      </div>
    </div>`;
    const qi = $('#trQuickIn', el);
    qi.oninput = () => { const c = C.detect(qi.value); $('#trDetect', el).innerHTML = c ? `<span class="cr-chip" style="--c:${C.info(c).color}">${esc(C.info(c).name)}</span>` : ''; };
    $('#trQuick', el).onsubmit = async (e) => { e.preventDefault(); if (qi.value.trim()) { await add({ number: qi.value }); qi.value = ''; $('#trDetect', el).innerHTML = ''; } };
    $('#trRefresh', el).onclick = () => refreshAll();
    $$('#trSeg button', el).forEach(b => b.onclick = () => { t.mode = b.dataset.m; try { localStorage.setItem('relay-track-mode', t.mode); } catch {} render(el); });
    t.pageWv = null;
  }

  function stepper(p, big = false) {
    const st = STAGE[p.status] ?? 0;
    const col = COLOR[p.status] || COLOR.unknown;
    return `<div class="stepper ${big ? 'big' : ''}" style="--c:${col}">${STEPS.map((s, i) => `<span class="st ${i < st ? 'done' : ''} ${i === st - 1 ? 'cur' : ''}"><i></i>${big ? `<small>${s}</small>` : ''}</span>`).join('')}</div>`;
  }
  function cardHTML(p) {
    const ci = C.info(p.carrier);
    const eta = etaInfo(p);
    return `<button class="tr-card ${p.id === t.selected ? 'active' : ''} ${p.archived ? 'archived' : ''}" data-id="${p.id}">
      <span class="cr-tile" style="--c:${ci.color}">${p.carrier === 'other' ? ic('box', 16) : esc((p.carrierName || ci.name).slice(0, p.carrier === 'fedex' ? 5 : 4))}</span>
      <span class="tr-main">
        <span class="tr-name">${esc(p.name || `${p.carrierName || ci.name} package`)}</span>
        <span class="tr-status" style="--c:${COLOR[p.status] || COLOR.unknown}"><i></i>${esc(LABEL[p.status] || p.statusText || '')}${p.lastLocation && isActive(p) ? ` · ${esc(p.lastLocation)}` : ''}</span>
        ${stepper(p)}
      </span>
      <span class="tr-eta ${eta.tone}"><b>${esc(cap(eta.label.replace(/^Arriving /, '')))}</b><small>${esc(eta.sub.split(' · ')[0])}</small></span>
    </button>`;
  }

  function detailEmptyHTML() {
    return `<div class="detail-empty">${ic('truck', 36)}<h3>Track anything that’s on its way</h3><p>Paste a tracking number from UPS, USPS, FedEx, DHL, Amazon, OnTrac and more. When you open a shipping email, Relay offers to add it for you.</p></div>`;
  }

  function heroHTML(p) {
    const ci = C.info(p.carrier);
    const eta = etaInfo(p);
    const via = p.checkedVia ? `from ${p.checkedVia}` : '';
    return `<div class="trd-hero compact ${eta.tone}" style="--c:${COLOR[p.status] || COLOR.unknown}">
        <div class="trd-top">
          <span class="cr-tile lg" style="--c:${ci.color}">${p.carrier === 'other' ? ic('box', 22) : esc((p.carrierName || ci.name).slice(0, 5))}</span>
          <div class="trd-title"><input id="trName" value="${esc(p.name)}" placeholder="${esc((p.carrierName || ci.name) + ' package')}" spellcheck="false"><span class="trd-num">${esc(p.number)} <button class="icon-btn sm" id="trCopy" title="Copy tracking number">${ic('copy', 13)}</button></span></div>
          <div class="trd-eta-mini"><small>${p.status === 'delivered' ? 'Delivered' : 'Estimated arrival'}</small><b>${esc(eta.label)}</b><span>${esc(eta.sub)}</span></div>
          <button class="icon-btn" id="trMore" title="More">${ic('dots', 18)}</button>
        </div>
        <div class="trd-row">
          <span class="tr-status big" style="--c:${COLOR[p.status] || COLOR.unknown}"><i></i>${esc(LABEL[p.status] || '')}</span>
          ${p.lastEvent && p.lastEvent.toLowerCase() !== (LABEL[p.status] || '').toLowerCase() ? `<span class="trd-last">${esc(p.lastEvent)}${p.lastLocation ? ' · ' + esc(p.lastLocation) : ''}</span>` : ''}
          <span class="spacer"></span>
          ${p.lastChecked ? `<span class="muted-sm">Checked ${timeAgo(p.lastChecked)} ${esc(via)}</span>` : ''}
        </div>
        ${stepper(p, true)}
      </div>`;
  }

  function detailsHTML(p) {
    const ci = C.info(p.carrier);
    const hasKey = R().state.settings.hasTrackKey;
    const src = p.source?.accountId ? R().accountById(p.source.accountId) : null;
    return `
      <div class="trd-actions">
        <button class="btn" id="trCarrier">${ic('globe', 14)} Open ${esc(ci.name === 'Other' ? '17TRACK' : ci.name)} in Browser</button>
        <button class="btn" id="trRefreshOne">${ic('refresh', 14)} Check now</button>
        ${p.status !== 'delivered' ? `<button class="btn" id="trDelivered">${ic('checkCircle', 14)} Mark delivered</button>` : ''}
        <button class="btn ghost" id="trArchive">${ic('archive', 14)} ${p.archived ? 'Unarchive' : 'Archive'}</button>
      </div>
      ${p.error ? `<div class="tip warn">${ic('alert', 15)}<span>${esc(p.error)}</span></div>` : ''}
      ${src || p.source?.subject ? `<button class="source-chip" id="trSource" style="--c:${esc(src?.color || 'var(--accent)')}">${ic('mail', 14)}<span>From ${p.source.from ? `<b>${esc(p.source.from.replace(/<.*>/, '').trim())}</b> — ` : ''}${esc(p.source.subject || 'email')}</span>${src ? ic('external', 13) : ''}</button>` : ''}
      <div class="td-section">
        <div class="td-label">${ic('truck', 14)} Journey</div>
        ${(p.events || []).length ? `<ol class="timeline">${p.events.map((e, i) => `
          <li class="${i === 0 ? 'latest' : ''}" style="--c:${COLOR[p.status] || COLOR.unknown}"><i></i>
            <div><b>${esc(e.desc)}</b><small>${e.time ? esc(new Date(e.time).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : ''}${e.location ? ' · ' + esc(e.location) : ''}</small></div></li>`).join('')}</ol>`
        : `<div class="card-empty">${ic('truck', 20)}<span>Updates Relay reads from the ${esc(ci.name === 'Other' ? 'tracking' : ci.name)} page show up here. ${hasKey ? '' : 'Open the Carrier page tab or press Check now.'}</span></div>`}
      </div>
      <div class="muted-sm">Added ${new Date(p.addedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${esc(p.carrierName || ci.name)}${hasKey ? ' · 17TRACK API connected' : ''}</div>`;
  }

  /* ---------- carrier page (no API needed) ---------- */
  const pageUrlFor = (p) => (p.pageSource === '17track' ? C.trackingUrl('other', p.number) : C.trackingUrl(p.carrier, p.number));
  // 17TRACK is a single-page app that keys off the #hash — changing only the hash keeps showing the
  // previous number. Load a unique URL so every package gets a real, fresh page load.
  const freshUrl = (u) => { if (!/17track\.net/.test(u)) return u; const [a, h] = u.split('#'); return `${a}${a.includes('?') ? '&' : '?'}r=${Date.now()}${h ? '#' + h : ''}`; };
  const squash = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Only trust a page that is actually showing this package's number
  const pageShows = (text, p) => { const n = squash(p.number); return n.length < 6 || squash(text).includes(n); };
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

  async function makeWebview(host, cls) {
    const { preload } = await relay.prepareSession('persist:relay-browser', 'auto');
    const wv = document.createElement('webview');
    wv.className = cls;
    wv.setAttribute('partition', 'persist:relay-browser');
    wv.setAttribute('preload', preload);
    wv.setAttribute('webpreferences', 'sandbox=yes');
    wv.setAttribute('allowpopups', '');
    host.appendChild(wv);
    return wv;
  }

  async function showPage(p) {
    const host = $('#trPage', t.el);
    const tools = $('#trPageTools', t.el);
    let url = pageUrlFor(p);
    tools.innerHTML = `<span class="muted-sm">${esc(hostOf(url))}</span>
      <button class="icon-btn sm" id="trPgReload" title="Reload & read status">${ic('refresh', 15)}</button>
      <button class="pl-chip tr-src" id="trPgSrc" title="Switch between the carrier’s site and 17TRACK">${p.pageSource === '17track' ? 'Use carrier site' : 'Try 17TRACK site'}</button>
      <button class="icon-btn sm" id="trPgOpen" title="Open in Browser tab">${ic('external', 15)}</button>`;
    $('#trPgReload', tools).onclick = () => t.pageWv?.reload();
    $('#trPgOpen', tools).onclick = () => window.Browser?.openTab(t.pageWv?.getURL() || url);
    $('#trPgSrc', tools).onclick = async () => { t.list = await relay.track.update({ id: p.id, pageSource: p.pageSource === '17track' ? 'carrier' : '17track' }); t.pageFor = null; render(t.el); };
    if (!t.pageWv || !t.pageWv.isConnected) {
      // one page view only, even if you click through packages while it's still being created
      if (!t.pageWvP) t.pageWvP = makeWebview(host, 'tr-page-wv').then(wv => {
        wv.addEventListener('did-stop-loading', () => schedulePageRead());
        wv.addEventListener('did-navigate-in-page', () => schedulePageRead());
        t.pageWv = wv; return wv;
      }).finally(() => { t.pageWvP = null; });
      await t.pageWvP;
      p = t.list.find(x => x.id === t.selected) || p; // the package you're on now
    }
    url = pageUrlFor(p);
    if (t.pageFor !== p.id + '|' + url) {
      t.pageFor = p.id + '|' + url;
      t.pageWv.dataset.pkg = p.id;
      $('#trPageNote', host).hidden = true;
      clearTimeout(t.readT1); clearTimeout(t.readT2);
      if (t.pageWv.getAttribute('src')) t.pageWv.loadURL(freshUrl(url)).catch(() => {}); else t.pageWv.setAttribute('src', freshUrl(url));
    }
  }
  function hidePage() { if (t.pageWv) t.pageFor = null; }

  // Read the page a couple of times while the carrier's site fills in its data
  function schedulePageRead() {
    clearTimeout(t.readT1); clearTimeout(t.readT2);
    const id = t.pageWv?.dataset.pkg;
    t.readT1 = setTimeout(() => readPage(t.pageWv, id, true), 2500);
    t.readT2 = setTimeout(() => readPage(t.pageWv, id, true), 7000);
  }

  async function readPage(wv, id, visible = false) {
    const p = t.list.find(x => x.id === id);
    if (!wv || !p) return false;
    let text = '';
    try { text = await wv.executeJavaScript(`(document.querySelector('main, [role=main], #main, #content') || document.body || {innerText:''}).innerText.slice(0, 12000)`); } catch { return false; }
    const url = (() => { try { return wv.getURL(); } catch { return ''; } })();
    if (/verify (you are|you're) (a )?human|captcha|access denied|unusual (traffic|activity)|are you a robot/i.test(text.slice(0, 1500)) || text.trim().length < 40) {
      if (visible) { const n = $('#trPageNote', t.el); if (n) { n.hidden = false; n.innerHTML = `${ic('alert', 14)} ${esc(hostOf(url))} wants to confirm you’re human — complete the check on the page and Relay will read it after.`; } }
      return false;
    }
    // Page still showing a different package (slow load / previous number) — don't apply it to this one
    // (17TRACK lists several numbers and can keep showing an old one, so there the number must be on the page)
    const trusted = pageShows(text, p) || (!/17track\.net/.test(url) && squash(decodeURIComponent(url)).includes(squash(p.number)));
    if (!trusted || (visible && wv.dataset.pkg !== id)) return false;
    let { status, event } = C.parseStatus(text);
    let eta = extractEta(text);
    let location = '';
    // If the plain-text rules can't tell, let the AI assistant read the page (only if you’ve added a key)
    const s = R().state;
    const prov = s.settings.aiProvider || 'claude';
    if (!status && prov !== 'assist' && R().aiReady(prov)) {
      try {
        const out = await relay.aiComplete({ maxTokens: 160,
          system: 'You read package tracking pages. Reply with JSON only: {"status":"info_received|in_transit|out_for_delivery|delivered|exception|pickup|unknown","eta":"YYYY-MM-DD or null","last_event":"short text","location":"city, state or empty"}',
          prompt: `Tracking number ${p.number}. Page text:\n${text.slice(0, 6000)}` });
        const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
        if (j.status && j.status !== 'unknown') status = j.status;
        if (j.eta) { const d = new Date(j.eta + 'T12:00'); if (!isNaN(d)) eta = d; }
        if (j.last_event) event = j.last_event;
        if (j.location) location = j.location;
      } catch {}
    }
    if (!status && !eta && !event) return false;
    t.list = await relay.track.applyPage({ id, status, eta: eta ? eta.toISOString() : null, event, location, via: hostOf(url) });
    refreshUI({ keepPage: true });
    return true;
  }

  // Check every active package by quietly loading its tracking page off-screen
  async function refreshAll(quiet = false) {
    if (t.refreshing) return;
    if (R().state.settings.hasTrackKey) {
      t.refreshing = true; t.progress = 'Checking…'; render(t.el);
      t.list = await relay.track.refresh();
      t.refreshing = false; refreshUI(); return;
    }
    const todo = t.list.filter(isActive);
    if (!todo.length) { if (!quiet) R().toast('Nothing on the way right now'); return; }
    t.refreshing = true;
    let host = document.getElementById('trHidden');
    if (!host) { host = document.createElement('div'); host.id = 'trHidden'; host.className = 'tr-hidden'; document.body.appendChild(host); }
    let ok = 0;
    for (let i = 0; i < todo.length; i++) {
      t.progress = `Checking ${i + 1} of ${todo.length}…`;
      if (R().state.ui.platform === 'tracking') render(t.el);
      const p = todo[i];
      const wv = await makeWebview(host, 'tr-hidden-wv'); // a brand-new page for every package
      await new Promise((res) => {
        const done = () => { wv.removeEventListener('did-stop-loading', onStop); clearTimeout(timer); res(); };
        let fired = false;
        const onStop = () => !fired && (fired = true) && setTimeout(async () => { if (await readPage(wv, p.id)) ok++; else { await new Promise(r => setTimeout(r, 4000)); if (await readPage(wv, p.id)) ok++; } done(); }, 3000);
        const timer = setTimeout(done, 30000);
        wv.addEventListener('did-stop-loading', onStop);
        wv.setAttribute('src', freshUrl(pageUrlFor(p)));
      });
      wv.remove();
    }
    t.refreshing = false; t.progress = '';
    refreshUI();
    if (!quiet) R().toast(ok ? `Updated ${ok} of ${todo.length} package${todo.length === 1 ? '' : 's'}` : 'Couldn’t read the carrier pages — open a package’s Carrier page to check it', ok ? '' : 'error');
  }

  function timeAgo(ts) { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : new Date(ts).toLocaleDateString(); }

  function bindDetail(el) {
    const p = t.list.find(x => x.id === t.selected);
    if (!p) return;
    const upd = async (patch) => { t.list = await relay.track.update({ id: p.id, ...patch }); refreshUI(); };
    const name = $('#trName', el);
    name.onchange = () => upd({ name: name.value.trim() });
    name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); };
    $('#trCopy', el).onclick = () => { navigator.clipboard.writeText(p.number); R().toast('Tracking number copied'); };
    $('#trCarrier', el)?.addEventListener('click', () => window.Browser?.openTab(pageUrlFor(p)));
    $('#trRefreshOne', el)?.addEventListener('click', async () => {
      $('#trRefreshOne', el).disabled = true;
      if (R().state.settings.hasTrackKey) { t.list = await relay.track.refresh([p.id]); refreshUI(); }
      else { t.mode = 'page'; t.pageFor = null; render(el); }
    });
    $('#trDelivered', el)?.addEventListener('click', () => upd({ status: 'delivered', statusText: 'Delivered', deliveredAt: new Date().toISOString() }));
    $('#trArchive', el)?.addEventListener('click', () => upd({ archived: !p.archived }));
    $('#trKeyLink', el)?.addEventListener('click', openKey);
    $('#trSource', el)?.addEventListener('click', () => { const a = R().accountById(p.source.accountId); if (a) { R().setPlatform(a.platform); R().selectAccount(a.id); } });
    $('#trMore', el).onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      R().popMenu(r.right - 240, r.bottom + 4, [
        { label: 'Set expected date…', icon: 'calendar', onClick: () => openEta(p) },
        ...(p.status !== 'delivered' ? [{ label: 'Mark delivered', icon: 'checkCircle', onClick: () => upd({ status: 'delivered', statusText: 'Delivered', deliveredAt: new Date().toISOString() }) }] : []),
        { label: p.archived ? 'Unarchive' : 'Archive', icon: 'archive', onClick: () => upd({ archived: !p.archived }) },
        { label: 'Change carrier…', icon: 'truck', onClick: () => openCarrier(p) },
        { label: 'Add to calendar', icon: 'calendar', onClick: () => { const d = etaDate(p) || new Date(); R().setPlatform('calendar'); window.Calendar?.newEvent({ date: d, allDay: true }); setTimeout(() => { const i = document.getElementById('eTitle'); if (i) i.value = `📦 ${p.name || C.info(p.carrier).name + ' delivery'}`; }, 50); } },
        { label: p.muted ? 'Turn on notifications' : 'Mute notifications', icon: 'alert', onClick: () => upd({ muted: !p.muted }) },
        '-',
        { label: 'Stop tracking', icon: 'trash', danger: true, onClick: async () => { t.list = await relay.track.remove(p.id); t.selected = null; refreshUI(); } }
      ]);
    };
  }

  /* ---------- modals ---------- */
  function carrierOptions(sel) { return Object.entries(C.CARRIERS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v.name}</option>`).join(''); }
  function openAdd(prefill = {}) {
    R().openModal({
      title: 'Track a package', icon: 'box', color: 'var(--tracking)',
      body: `
        <div class="field"><label>Tracking number</label><input class="input mono" id="taNum" value="${esc(prefill.number || '')}" placeholder="e.g. 1Z999AA10123456784" spellcheck="false"></div>
        <div class="row">
          <div class="field"><label>Carrier</label><select class="select" id="taCarrier"><option value="">Detect automatically</option>${carrierOptions(prefill.carrier)}</select></div>
          <div class="field"><label>Expected (optional)</label><input class="input" type="date" id="taEta"></div>
        </div>
        <div class="field"><label>Name (optional)</label><input class="input" id="taName" value="${esc(prefill.name || '')}" placeholder="What’s in it? e.g. New headphones"></div>`,
      actions: [{ label: 'Cancel' }, { label: 'Track', cls: 'brand', style: '--c:var(--tracking)', onClick: async (m) => {
        const number = $('#taNum', m).value.trim();
        if (!number) { R().toast('Enter a tracking number', 'error'); return false; }
        const e = $('#taEta', m).value;
        await add({ number, carrier: $('#taCarrier', m).value || undefined, name: $('#taName', m).value.trim(), eta: e ? { from: new Date(e + 'T12:00').toISOString(), to: new Date(e + 'T12:00').toISOString(), source: 'manual' } : null });
        if (R().state.ui.platform !== 'tracking') R().setPlatform('tracking');
      } }],
      onMount: (m) => { const n = $('#taNum', m); n.oninput = () => { const c = C.detect(n.value); if (c) $('#taCarrier', m).value = c; }; }
    });
  }
  function openEta(p) {
    const d = etaDate(p);
    R().openModal({
      title: 'Expected delivery', icon: 'calendar', color: 'var(--tracking)',
      body: `<div class="field"><label>Date</label><input class="input" type="date" id="teDate" value="${d ? d.toISOString().slice(0, 10) : ''}"></div>`,
      actions: [{ label: 'Clear', onClick: async () => { t.list = await relay.track.update({ id: p.id, eta: null }); refreshUI(); } },
        { label: 'Save', cls: 'brand', style: '--c:var(--tracking)', onClick: async (m) => { const v = $('#teDate', m).value; if (!v) return; const iso = new Date(v + 'T12:00').toISOString(); t.list = await relay.track.update({ id: p.id, eta: { from: iso, to: iso, source: 'manual' } }); refreshUI(); } }]
    });
  }
  function openCarrier(p) {
    R().openModal({
      title: 'Change carrier', icon: 'truck', color: 'var(--tracking)',
      body: `<div class="field"><label>Carrier</label><select class="select" id="tcSel">${carrierOptions(p.carrier)}</select></div>`,
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'brand', style: '--c:var(--tracking)', onClick: async (m) => { t.list = await relay.track.update({ id: p.id, carrier: $('#tcSel', m).value }); t.list = await relay.track.refresh([p.id]); refreshUI(); } }]
    });
  }
  function openKey() {
    const has = R().state.settings.hasTrackKey;
    R().openModal({
      title: '17TRACK API (optional)', icon: 'truck', color: 'var(--tracking)',
      subtitle: 'Relay already reads status from each carrier’s own tracking page for free. If you have a paid 17TRACK API plan, add the key here for faster background updates.',
      body: `
        <ol class="steps-guide">
          <li><span class="sg-n" style="--vault:var(--tracking)">1</span><div><b>Get your 17TRACK API key</b><p>Sign up, then open <b>Settings → Security → Access Key</b>.</p><button class="btn" type="button" id="tkOpen">${ic('external', 14)} Open api.17track.net</button></div></li>
          <li><span class="sg-n" style="--vault:var(--tracking)">2</span><div><b>Paste your key</b><input class="input mono" id="tkKey" type="password" placeholder="${has ? '•••••••••••• (saved — paste to replace)' : 'Your 17TRACK access key'}" style="margin-top:6px"></div></li>
        </ol>
        <div class="hint" style="font-size:11.5px;color:var(--muted)">Stored encrypted in your Mac’s keychain. Relay checks active packages every 2 hours and notifies you when one is out for delivery, delivered, or has a problem.</div>`,
      actions: [...(has ? [{ label: 'Remove key', onClick: async () => { await relay.track.setKey(''); R().state.settings.hasTrackKey = false; refreshUI(); } }] : []), { label: 'Cancel' },
        { label: 'Save', cls: 'brand', style: '--c:var(--tracking)', onClick: async (m) => {
          const k = $('#tkKey', m).value.trim(); if (!k) return;
          R().toast('Checking your packages…');
          try { await relay.track.setKey(k); R().state.settings.hasTrackKey = true; t.list = await relay.track.list(); refreshUI(); R().toast('17TRACK API connected'); }
          catch (e) { R().toast(String(e.message || e), 'error'); }
        } }],
      onMount: (m) => { $('#tkOpen', m).onclick = () => relay.openExternal('https://api.17track.net/en'); }
    });
  }

  function refreshUI() {
    R().renderTabs?.();
    if (t.refreshing && R().state.ui.platform === 'tracking') { renderSidebar(t.side); render(t.el); return; }
    if (R().state.ui.platform === 'tracking') { renderSidebar(t.side); render(t.el); }
    if (R().state.ui.platform === 'home') window.Home?.onCalendar?.();
  }

  relay.track.onChanged((l) => { t.list = l; refreshUI(); });
  relay.track.onAddRequest(async (d) => {
    const acc = R().state.accounts.find(a => d.partition === 'persist:relay-' + a.id);
    await addFromEmail({ number: d.number, carrier: d.carrier, text: '', subject: d.pageTitle || '', accountId: acc?.id || null });
  });
  load().then(() => R().renderTabs?.());

  window.Tracking = {
    render, renderSidebar, add, addFromEmail, openAdd, extractEta, etaInfo,
    isTracked: (n) => t.list.some(p => p.number === C.clean(n)),
    active: () => t.list.filter(isActive),
    todayCount: () => counts().today,
    select: (id) => { t.selected = id; t.filter = 'all'; }
  };
})();
