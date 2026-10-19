/* Relay — Storage tab: Google Drive, OneDrive, Dropbox, MEGA, iCloud Drive, Box…
   Google Drive and OneDrive reuse the session of a Gmail / Outlook account you've already signed into,
   so there's no second login. Other services can borrow a mail account's session too, which makes
   "Continue with Google / Microsoft" one click. */
(() => {
  const R = () => window.RelayApp;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => R().esc(s);

  const PROVIDERS = {
    gdrive:   { label: 'Google Drive', short: 'Drive',    color: '#1fa463', url: 'https://drive.google.com/drive/my-drive', link: 'gmail', blurb: 'Uses your Gmail sign-in' },
    onedrive: { label: 'OneDrive',     short: 'OneDrive', color: '#0f6cbd', url: 'https://onedrive.live.com/', workUrl: 'https://www.office.com/launch/onedrive', link: 'outlook', blurb: 'Uses your Outlook sign-in' },
    dropbox:  { label: 'Dropbox',      short: 'Dropbox',  color: '#0061fe', url: 'https://www.dropbox.com/home' },
    mega:     { label: 'MEGA',         short: 'MEGA',     color: '#d9272e', url: 'https://mega.nz/fm' },
    icloud:   { label: 'iCloud Drive', short: 'iCloud',   color: '#3693f3', url: 'https://www.icloud.com/iclouddrive/' },
    box:      { label: 'Box',          short: 'Box',      color: '#0061d5', url: 'https://app.box.com/folder/0' },
    custom:   { label: 'Other',        short: 'Other',    color: '#64748b', url: '' }
  };

  const st = () => R().state;
  const items = () => st().storage || (st().storage = []);
  const byId = (id) => items().find(x => x.id === id);
  const linkedOf = (it) => it?.linkedAccountId ? R().accountById(it.linkedAccountId) : null;

  function urlFor(it) {
    const P = PROVIDERS[it.provider] || PROVIDERS.custom;
    if (it.provider === 'custom') return it.url;
    if (it.provider === 'onedrive' && linkedOf(it)?.outlookType === 'work') return P.workUrl;
    return P.url;
  }
  // The object the shared webview machinery uses to show this storage account
  function surface(id) {
    const it = byId(id);
    if (!it) return null;
    const linked = linkedOf(it);
    return {
      id: it.id, platform: 'storage', provider: it.provider, name: it.name, color: it.color,
      partition: 'persist:relay-' + (linked ? linked.id : it.id),
      signinMode: linked ? linked.signinMode : it.signinMode,
      adblock: linked ? linked.adblock : it.adblock,
      linkedAccountId: linked?.id || null,
      url: urlFor(it)
    };
  }

  function tileHTML(it, size = '') {
    const P = PROVIDERS[it.provider] || PROVIDERS.custom;
    const linked = linkedOf(it);
    return `<span class="st-tile ${size}" style="--c:${P.color}">${ic('cloud', size === 'lg' ? 26 : 17)}
      ${linked ? `<span class="st-link">${R().avatarHTML(linked, 'sm')}</span>` : ''}</span>`;
  }
  function subtitle(it) {
    const P = PROVIDERS[it.provider] || PROVIDERS.custom;
    const linked = linkedOf(it);
    if (linked) return `${P.label} · ${linked.email || linked.name}`;
    if (it.provider === 'custom') { try { return new URL(it.url).hostname; } catch { return it.url; } }
    return it.email ? `${P.label} · ${it.email}` : P.label;
  }

  function suggestions() {
    const out = [];
    const accts = st().accounts;
    accts.filter(a => a.platform === 'gmail').forEach(a => {
      if (!items().some(x => x.provider === 'gdrive' && x.linkedAccountId === a.id)) out.push({ provider: 'gdrive', account: a });
    });
    accts.filter(a => a.platform === 'outlook').forEach(a => {
      if (!items().some(x => x.provider === 'onedrive' && x.linkedAccountId === a.id)) out.push({ provider: 'onedrive', account: a });
    });
    return out;
  }

  async function quickAdd(provider, account) {
    const P = PROVIDERS[provider];
    const it = { id: 'st_' + R().uid(), provider, name: `${P.short} · ${account.name || account.email}`, color: account.color || P.color, linkedAccountId: account.id };
    st().storage = await relay.saveStorage(it);
    select(it.id);
    R().toast(`${P.label} added — using your ${R().PLATFORMS[account.platform].label} sign-in`);
  }

  function select(id) {
    st().ui.selected.storage = id;
    relay.saveUI({ selected: st().ui.selected });
    if (st().ui.platform !== 'storage') R().setPlatform('storage'); else R().render();
  }

  /* ---------- sidebar ---------- */
  function renderSidebar(side) {
    const list = items();
    const sel = st().ui.selected.storage;
    const sug = suggestions();
    side.innerHTML = `
      <div class="side-head">
        <div class="side-title" style="--c:var(--storage)"><span class="dot"></span>Storage</div>
        <span class="side-title">${list.length || ''}</span>
      </div>
      <div class="accounts">
        ${list.map(it => `
          <div class="account ${it.id === sel ? 'active' : ''}" data-st="${it.id}" style="--c:${esc(it.color || PROVIDERS[it.provider]?.color)}" title="${esc(subtitle(it))}">
            ${tileHTML(it)}
            <div class="meta"><div class="name">${esc(it.name)}</div><div class="email">${esc(subtitle(it))}</div></div>
            <button class="icon-btn sm more" data-st-more="${it.id}" title="Options">${ic('dots', 16)}</button>
          </div>`).join('')}
        <button class="add-account" id="stAdd" style="--c:var(--storage)"><span class="plus">${ic('plus', 18)}</span><span>Add storage</span></button>
        ${sug.length ? `
          <div class="side-head" style="padding-top:16px"><div class="side-title">One-click add</div></div>
          ${sug.map((s, i) => `<button class="mini-acct sug" data-sug="${i}" style="--c:${PROVIDERS[s.provider].color}">
            <span class="st-tile xs" style="--c:${PROVIDERS[s.provider].color}">${ic('cloud', 12)}</span>
            <span class="n">${PROVIDERS[s.provider].short} for ${esc(s.account.name || s.account.email)}</span>${ic('plus', 14)}</button>`).join('')}` : ''}
      </div>
      <div class="side-foot">${ic('link', 13)} Drive & OneDrive reuse your mail sign-in</div>`;
    $('#stAdd', side).onclick = () => openAdd();
    $$('[data-st]', side).forEach(el => {
      el.onclick = (e) => { if (!e.target.closest('[data-st-more]')) select(el.dataset.st); };
      el.oncontextmenu = (e) => { e.preventDefault(); itemMenu(el.dataset.st, e.clientX, e.clientY); };
    });
    R().makeSortable($('.accounts', side), '[data-st]', 'data-st', async (ids) => {
      st().storage = await relay.reorderStorage(ids);
      renderSidebar(side);
    });
    $$('[data-st-more]', side).forEach(b => b.onclick = (e) => { e.stopPropagation(); const r = b.getBoundingClientRect(); itemMenu(b.dataset.stMore, r.right - 4, r.bottom + 4); });
    $$('[data-sug]', side).forEach(b => b.onclick = () => { const s = sug[+b.dataset.sug]; quickAdd(s.provider, s.account); });
  }

  function itemMenu(id, x, y) {
    const it = byId(id);
    if (!it) return;
    R().popMenu(x, y, [
      { label: 'Edit…', icon: 'edit', onClick: () => openAdd(it) },
      { label: 'Reload', icon: 'refresh', onClick: () => R().webviews.get(id)?.wv.reload() },
      { label: 'Open in browser tab', icon: 'globe', onClick: () => window.Browser?.openTab(R().webviews.get(id)?.wv.getURL() || urlFor(it)) },
      ...(it.linkedAccountId ? [] : [{ label: 'Sign-in troubles…', icon: 'wand', onClick: () => R().openSignInHelp(surface(id)) }]),
      '-',
      { label: 'Remove', icon: 'trash', danger: true, onClick: async () => {
          st().storage = await relay.removeStorage(id);
          const e = R().webviews.get(id); if (e) { e.wrap.remove(); R().webviews.delete(id); }
          if (st().ui.selected.storage === id) st().ui.selected.storage = items()[0]?.id;
          R().render(); R().toast(it.linkedAccountId ? 'Removed — your mail account stays signed in' : 'Removed and signed out');
        } }
    ]);
  }

  /* ---------- empty state ---------- */
  function renderEmpty(el) {
    el.style.setProperty('--c', 'var(--storage)');
    const sug = suggestions();
    el.innerHTML = `
      <div class="empty-icon">${ic('cloud', 34)}</div>
      <h2>All your files, next to your inbox</h2>
      <p>Add Google Drive, OneDrive, Dropbox, MEGA, iCloud Drive or Box. Downloads go to your Downloads folder, and uploads work by dragging files in.</p>
      ${sug.length ? `<div class="st-quick">${sug.slice(0, 4).map((s, i) => `
        <button class="st-qcard" data-sug="${i}" style="--c:${PROVIDERS[s.provider].color}">
          ${tileHTML({ provider: s.provider, linkedAccountId: s.account.id })}
          <span><b>${PROVIDERS[s.provider].label}</b><small>${esc(s.account.email || s.account.name)} · no sign-in needed</small></span>${ic('plus', 16)}
        </button>`).join('')}</div>` : ''}
      <button class="btn brand lg" id="stEmptyAdd" style="--c:var(--storage)">${ic('plus', 16)} Add storage</button>`;
    $('#stEmptyAdd', el).onclick = () => openAdd();
    $$('[data-sug]', el).forEach(b => b.onclick = () => { const s = sug[+b.dataset.sug]; quickAdd(s.provider, s.account); });
  }

  /* ---------- add / edit ---------- */
  function openAdd(existing) {
    const isEdit = !!existing;
    const d = existing ? { ...existing } : { id: 'st_' + R().uid(), provider: 'gdrive', name: '', color: '', linkedAccountId: null, url: '' };
    const accts = st().accounts;

    const linkOptions = (provider) => {
      const P = PROVIDERS[provider];
      const pool = P.link ? accts.filter(a => a.platform === P.link) : accts.filter(a => a.platform === 'gmail' || a.platform === 'outlook');
      return pool;
    };
    const defaultLink = (provider) => { const P = PROVIDERS[provider]; return P.link ? (linkOptions(provider)[0]?.id || null) : null; };
    if (!isEdit) d.linkedAccountId = defaultLink(d.provider);

    R().openModal({
      title: isEdit ? 'Edit storage' : 'Add storage', icon: 'cloud', color: 'var(--storage)', wide: true,
      subtitle: isEdit ? '' : 'Pick a service. Drive and OneDrive can use an account you’re already signed into.',
      body: `
        <div class="prov-grid" id="pvGrid" ${isEdit ? 'hidden' : ''}>${Object.entries(PROVIDERS).map(([k, P]) => `
          <button class="prov ${k === d.provider ? 'active' : ''}" data-p="${k}" style="--c:${P.color}"><span class="st-tile">${ic('cloud', 17)}</span><b>${P.label}</b></button>`).join('')}</div>
        <div id="pvDetail"></div>`,
      actions: [{ label: 'Cancel' }, { label: isEdit ? 'Save' : 'Add', cls: 'brand', style: '--c:var(--storage)', onClick: async (m) => {
        const P = PROVIDERS[d.provider];
        d.name = $('#pvName', m).value.trim();
        const linked = d.linkedAccountId ? R().accountById(d.linkedAccountId) : null;
        if (!d.name) d.name = linked ? `${P.short} · ${linked.name || linked.email}` : P.label;
        if (d.provider === 'custom') {
          d.url = $('#pvUrl', m).value.trim();
          if (d.url && !/^https?:\/\//.test(d.url)) d.url = 'https://' + d.url;
          if (!d.url) { R().toast('Add the web address of your storage', 'error'); return false; }
        }
        d.color = d.color || linked?.color || P.color;
        const partitionChanged = isEdit && existing.linkedAccountId !== d.linkedAccountId;
        st().storage = await relay.saveStorage(d);
        if (partitionChanged || (isEdit && existing.url !== d.url)) { const e = R().webviews.get(d.id); if (e) { e.wrap.remove(); R().webviews.delete(d.id); } }
        select(d.id);
        if (!isEdit) R().toast(linked ? `Opening ${P.label} with your ${R().PLATFORMS[linked.platform].label} sign-in` : `Sign in to ${P.label} to finish`);
      } }],
      onMount: (m) => {
        const detail = () => {
          const P = PROVIDERS[d.provider];
          const pool = linkOptions(d.provider);
          const needLink = !!P.link;
          $('#pvDetail', m).innerHTML = `
            <div class="field"><label>${needLink ? `Use this ${R().PLATFORMS[P.link].label} account` : 'Share sign-in with a mail account (optional)'}</label>
              <div class="link-pick" id="pvLink">
                ${pool.map(a => `<button data-a="${a.id}" class="${d.linkedAccountId === a.id ? 'active' : ''}" style="--c:${esc(a.color)}">${R().avatarHTML(a, 'sm')}<span>${esc(a.name || a.email)}<small>${esc(a.email || '')}</small></span></button>`).join('')}
                <button data-a="" class="${!d.linkedAccountId ? 'active' : ''}"><span class="st-tile xs" style="--c:var(--muted)">${ic('key', 12)}</span><span>${needLink ? 'A different account' : 'No — sign in separately'}<small>${needLink ? 'Sign in on the next screen' : 'Keeps this service in its own session'}</small></span></button>
              </div>
              <div class="hint">${needLink ? `Relay opens ${P.label} in the same private session as that inbox, so you’re already signed in.` : `Sharing a session makes “Continue with Google/Microsoft” on ${P.label} one click.`}</div>
            </div>
            ${d.provider === 'custom' ? `<div class="field"><label>Web address</label><input class="input" id="pvUrl" placeholder="https://files.example.com" value="${esc(d.url || '')}"></div>` : ''}
            <div class="field"><label>Name</label><input class="input" id="pvName" placeholder="${esc(P.label)}" value="${esc(d.name || '')}"></div>`;
          $$('#pvLink button', m).forEach(b => b.onclick = () => { d.linkedAccountId = b.dataset.a || null; $$('#pvLink button', m).forEach(x => x.classList.toggle('active', x === b)); });
        };
        $$('#pvGrid .prov', m).forEach(b => b.onclick = () => {
          d.provider = b.dataset.p; d.linkedAccountId = defaultLink(d.provider);
          $$('#pvGrid .prov', m).forEach(x => x.classList.toggle('active', x === b));
          detail();
        });
        detail();
      }
    });
  }

  window.Cloud = { renderSidebar, renderEmpty, surface, openAdd, byId, urlFor, PROVIDERS };
})();
