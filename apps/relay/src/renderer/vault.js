/* Relay — Password vault UI. Passwords stay in the main process; this view only asks for them on demand. */
(() => {
  const R = () => window.RelayApp;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => R().esc(s);
  const v = { el: null, side: null, status: null, list: [], selected: null, filter: 'all', query: '', revealed: {}, editing: null, autoPrompted: false };
  const STRENGTH = ['', 'Weak', 'Fair', 'Strong', 'Excellent'];
  const STRENGTH_C = ['var(--muted)', '#e5484d', '#ffb03b', '#22a06b', '#10b5a0'];
  const TILE = ['#6d4aff', '#ff4f9a', '#ff6b3d', '#ffb03b', '#22c55e', '#10b5a0', '#0ea5e9', '#1f7bff', '#a855f7', '#e5484d', '#d946ef'];
  const tileColor = (s) => TILE[[...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TILE.length];
  const cleanErr = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  async function refreshStatus() { v.status = await relay.vault.status(); return v.status; }
  async function loadList() { v.list = await relay.vault.list(); }

  function visible() {
    const q = v.query.trim().toLowerCase();
    let list = v.list;
    if (v.filter === 'favorites') list = list.filter(e => e.favorite);
    if (v.filter === 'weak') list = list.filter(e => e.hasPassword && e.strength <= 1);
    if (v.filter === 'reused') list = list.filter(e => e.reused);
    if (q) list = list.filter(e => [e.name, e.host, e.username, e.url].some(x => String(x || '').toLowerCase().includes(q)));
    return [...list].sort((a, b) => (b.favorite - a.favorite) || String(a.name || a.host).localeCompare(String(b.name || b.host)));
  }

  /* ---------- sidebar ---------- */
  function renderSidebar(side) {
    if (!side) return;
    v.side = side;
    if (R().state.ui.platform !== 'vault') return;
    const s = v.status;
    if (!s || !s.unlocked) {
      side.innerHTML = `<div class="home-side">
        <div class="side-head"><div class="side-title" style="--c:var(--vault)"><span class="dot"></span>Vault</div></div>
        <div class="vault-side-note">${ic('shield', 18)}<p>Your passwords are encrypted on this Mac with your master password (AES-256). Relay never uploads them.</p></div>
      </div>`;
      return;
    }
    const weak = v.list.filter(e => e.hasPassword && e.strength <= 1).length;
    const reused = v.list.filter(e => e.reused).length;
    const fav = v.list.filter(e => e.favorite).length;
    const nav = (k, label, icon, n, warn) => `<button data-f="${k}" class="${v.filter === k ? 'active' : ''}">${ic(icon, 17)}<span>${label}</span>${n ? `<span class="pill ${warn ? 'warn' : ''}">${n}</span>` : ''}</button>`;
    side.innerHTML = `<div class="home-side">
      <nav class="side-nav">
        ${nav('all', 'All passwords', 'key', v.list.length)}
        ${nav('favorites', 'Favorites', 'star', fav)}
        ${nav('weak', 'Weak', 'alert', weak, true)}
        ${nav('reused', 'Reused', 'copy', reused, true)}
      </nav>
      <div class="side-head" style="padding-top:18px"><div class="side-title">Tools</div></div>
      <nav class="side-nav">
        <button id="vImport">${ic('download', 17)}<span>Import from Google</span></button>
        <button id="vGen">${ic('dice', 17)}<span>Password generator</span></button>
        <button id="vSecurity">${ic('fingerprint', 17)}<span>Touch ID & security</span></button>
        <button id="vLock">${ic('lock', 17)}<span>Lock vault</span></button>
      </nav>
      <div class="health ${weak + reused ? 'bad' : 'good'}">
        ${ic('shield', 18)}<div><b>${weak + reused ? `${weak + reused} to fix` : 'Looking healthy'}</b><span>${weak + reused ? 'Weak or reused passwords are easy to guess.' : 'No weak or reused passwords.'}</span></div>
      </div>
    </div>`;
    $$('[data-f]', side).forEach(b => b.onclick = () => { v.filter = b.dataset.f; renderSidebar(side); render(v.el); });
    $('#vImport', side).onclick = openImport;
    $('#vGen', side).onclick = () => openGenerator();
    $('#vSecurity', side).onclick = openSecurity;
    $('#vLock', side).onclick = async () => { await relay.vault.lock(); };
  }

  /* ---------- main ---------- */
  async function render(el) {
    if (!el) return;
    v.el = el;
    if (R().state.ui.platform !== 'vault') return;
    if (!v.status) { el.innerHTML = ''; await refreshStatus(); }
    renderSidebar(v.side || document.getElementById('sidebar'));
    if (!v.status.exists) return renderSetup(el);
    if (!v.status.unlocked) return renderLocked(el);
    if (!v.list.length && v.status.count) await loadList();
    renderVault(el);
  }

  function pwStrengthLocal(pw) {
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26; if (/[A-Z]/.test(pw)) pool += 26; if (/\d/.test(pw)) pool += 10; if (/[^a-zA-Z0-9]/.test(pw)) pool += 32;
    const bits = pw.length * Math.log2(Math.max(pool, 2));
    return !pw ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  }
  function meterHTML(level) {
    return `<div class="meter" style="--c:${STRENGTH_C[level]}">${[1, 2, 3, 4].map(i => `<i class="${i <= level ? 'on' : ''}"></i>`).join('')}<span>${STRENGTH[level] || ''}</span></div>`;
  }

  function renderSetup(el) {
    const touch = v.status.touchIdAvailable;
    el.innerHTML = `<div class="vault-center">
      <div class="vault-card">
        <div class="vault-badge">${ic('shield', 30)}</div>
        <h2>Create your password vault</h2>
        <p>Pick a master password. It encrypts everything in your vault and never leaves this Mac — <b>Relay can’t recover it if you forget it.</b></p>
        <form id="vSetup" class="vault-form">
          <input class="input lg" type="password" id="vPw1" placeholder="Master password" autocomplete="new-password">
          <div id="vMeter">${meterHTML(0)}</div>
          <input class="input lg" type="password" id="vPw2" placeholder="Confirm master password" autocomplete="new-password">
          ${touch ? `<label class="check"><input type="checkbox" id="vTouch" checked> Unlock with Touch ID</label>` : ''}
          <button class="btn brand lg" style="--c:var(--vault)" type="submit">${ic('lock', 16)} Create vault</button>
        </form>
        <div class="vault-hint">${ic('sparkles', 14)} Tip: a short sentence makes a great master password — e.g. <i>purple-tacos-on-tuesday!</i></div>
      </div>
    </div>`;
    const p1 = $('#vPw1', el);
    p1.oninput = () => { $('#vMeter', el).innerHTML = meterHTML(pwStrengthLocal(p1.value)); };
    $('#vSetup', el).onsubmit = async (e) => {
      e.preventDefault();
      const a = p1.value, b = $('#vPw2', el).value;
      if (a.length < 8) return R().toast('Use at least 8 characters', 'error');
      if (a !== b) return R().toast('Passwords don’t match', 'error');
      const btn = $('button[type=submit]', el); btn.disabled = true; btn.textContent = 'Creating…';
      try {
        v.status = await relay.vault.create(a);
        if ($('#vTouch', el)?.checked) { try { v.status = await relay.vault.setTouchID(true); } catch (err) { R().toast(cleanErr(err), 'error'); } }
        v.list = [];
        render(el);
        setTimeout(openImport, 300);
      } catch (err) { R().toast(cleanErr(err), 'error'); btn.disabled = false; btn.textContent = 'Create vault'; }
    };
    setTimeout(() => p1.focus(), 50);
  }

  function renderLocked(el) {
    const s = v.status;
    el.innerHTML = `<div class="vault-center">
      <div class="vault-card">
        <div class="vault-badge locked">${ic('lock', 30)}</div>
        <h2>Vault locked</h2>
        <p>${s.count != null ? `${s.count} saved password${s.count === 1 ? '' : 's'}. ` : ''}Unlock to view and fill your passwords.</p>
        <form id="vUnlock" class="vault-form">
          <input class="input lg" type="password" id="vPw" placeholder="Master password" autocomplete="current-password">
          <button class="btn brand lg" style="--c:var(--vault)" type="submit">${ic('unlock', 16)} Unlock</button>
          ${s.touchIdEnabled ? `<button class="btn lg" type="button" id="vTouchBtn">${ic('fingerprint', 18)} Unlock with Touch ID</button>` : ''}
        </form>
      </div>
    </div>`;
    $('#vUnlock', el).onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', el); btn.disabled = true; btn.innerHTML = 'Unlocking…';
      try { v.status = await relay.vault.unlock($('#vPw', el).value); await afterUnlock(); }
      catch (err) { R().toast(cleanErr(err), 'error'); btn.disabled = false; btn.innerHTML = `${ic('unlock', 16)} Unlock`; $('#vPw', el).select(); }
    };
    $('#vTouchBtn', el)?.addEventListener('click', touchUnlock);
    if (s.touchIdEnabled && !v.autoPrompted) { v.autoPrompted = true; setTimeout(touchUnlock, 250); }
    else setTimeout(() => $('#vPw', el)?.focus(), 50);
  }
  async function touchUnlock() {
    try { v.status = await relay.vault.unlockTouchID(); await afterUnlock(); }
    catch (err) { const m = cleanErr(err); if (!/cancel/i.test(m)) R().toast(m, 'error'); $('#vPw', v.el)?.focus(); }
  }
  async function afterUnlock() {
    await loadList();
    if (R().state.ui.platform === 'vault') render(v.el);
    unlockWaiters.splice(0).forEach(fn => fn(true));
  }

  function renderVault(el) {
    const list = visible();
    if (!v.selected || !v.list.find(e => e.id === v.selected)) v.selected = list[0]?.id || null;
    const sel = v.list.find(e => e.id === v.selected);
    el.innerHTML = `<div class="vault-view">
      <div class="vault-pane">
        <div class="vp-head">
          <div class="search">${ic('search', 15)}<input id="vSearch" placeholder="Search ${v.list.length} passwords" value="${esc(v.query)}"></div>
          <button class="btn brand" style="--c:var(--vault)" id="vNew" title="New password">${ic('plus', 15)}</button>
        </div>
        <div class="v-rows" id="vRows">${list.map(rowHTML).join('') || emptyListHTML()}</div>
      </div>
      <div class="vault-detail" id="vDetail">${v.editing ? editHTML(v.editing) : sel ? detailHTML(sel) : detailEmptyHTML()}</div>
    </div>`;
    const search = $('#vSearch', el);
    search.oninput = () => { v.query = search.value; $('#vRows', el).innerHTML = visible().map(rowHTML).join('') || emptyListHTML(); bindRows(el); };
    $('#vNew', el).onclick = () => { v.editing = { id: null, name: '', url: '', username: '', password: generate(), notes: '' }; renderVault(el); };
    bindRows(el);
    bindDetail(el);
  }
  function emptyListHTML() {
    return v.list.length ? `<div class="card-empty tall">${ic('search', 20)}<span>No matches.</span></div>` :
      `<div class="card-empty tall">${ic('key', 22)}<span>Your vault is empty.</span><button class="btn brand" style="--c:var(--vault)" data-empty-import>${ic('download', 15)} Import from Google</button></div>`;
  }
  function tileHTML(e, big = false) {
    const label = (e.name || e.host || '?').replace(/^https?:\/\//, '');
    return `<span class="v-tile ${big ? 'big' : ''}" style="--c:${tileColor(e.host || e.name)}">${esc(label[0]?.toUpperCase() || '?')}</span>`;
  }
  function rowHTML(e) {
    return `<button class="v-row ${e.id === v.selected && !v.editing ? 'active' : ''}" data-id="${e.id}">
      ${tileHTML(e)}
      <span class="v-meta"><span class="v-name">${esc(e.name || e.host)}${e.favorite ? ` <i class="fav">${ic('star', 11)}</i>` : ''}</span><span class="v-user">${esc(e.username || e.host || '')}</span></span>
      ${e.hasPassword && e.strength <= 1 ? `<span class="v-flag" title="Weak password">${ic('alert', 14)}</span>` : e.reused ? `<span class="v-flag reuse" title="Reused password">${ic('copy', 13)}</span>` : ''}
    </button>`;
  }
  function bindRows(el) {
    $$('.v-row', el).forEach(r => r.onclick = () => { v.selected = r.dataset.id; v.editing = null; renderVault(el); });
    $('[data-empty-import]', el)?.addEventListener('click', openImport);
  }

  function detailEmptyHTML() {
    return `<div class="detail-empty">${ic('key', 34)}<h3>${v.list.length ? 'Select a password' : 'Bring your passwords over'}</h3><p>${v.list.length ? 'Pick an item on the left to see it.' : 'Import everything from Google Password Manager in about a minute.'}</p>${v.list.length ? '' : `<button class="btn brand" style="--c:var(--vault)" data-empty-import>${ic('download', 15)} Import from Google</button>`}</div>`;
  }
  function detailHTML(e) {
    const shown = v.revealed[e.id];
    const url = e.url && !/^https?:\/\//.test(e.url) ? 'https://' + e.url : e.url;
    return `
      <div class="vd-head">${tileHTML(e, true)}<div><h2>${esc(e.name || e.host)}</h2>${e.host ? `<a class="vd-host" data-open="${esc(url)}">${esc(e.host)} ${ic('external', 12)}</a>` : ''}</div>
        <span class="spacer"></span>
        <button class="icon-btn" data-act="fav" title="${e.favorite ? 'Remove from favorites' : 'Add to favorites'}" style="${e.favorite ? 'color:#ffb03b' : ''}">${ic('star', 18)}</button>
        <button class="btn" data-act="edit">${ic('edit', 14)} Edit</button>
      </div>
      <div class="vd-fields">
        <div class="vd-field"><label>Username</label><div class="vd-val"><span class="sel">${esc(e.username || '—')}</span>${e.username ? `<button class="icon-btn sm" data-copy="username" title="Copy username">${ic('copy', 15)}</button>` : ''}</div></div>
        <div class="vd-field"><label>Password</label><div class="vd-val"><span class="pw ${shown ? 'shown sel' : ''}">${shown ? esc(shown) : '••••••••••••'}</span>
          <button class="icon-btn sm" data-act="reveal" title="${shown ? 'Hide' : 'Show'}">${ic(shown ? 'eyeOff' : 'eye', 15)}</button>
          <button class="icon-btn sm" data-copy="password" title="Copy password (clears in 30s)">${ic('copy', 15)}</button></div>
          ${e.hasPassword ? `<div class="vd-strength">${meterHTML(e.strength)}${e.reused ? `<span class="warn-chip">${ic('copy', 12)} Used on other sites</span>` : ''}</div>` : ''}
        </div>
        ${e.url ? `<div class="vd-field"><label>Website</label><div class="vd-val"><span class="sel">${esc(e.url)}</span><button class="icon-btn sm" data-open="${esc(url)}" title="Open">${ic('external', 15)}</button></div></div>` : ''}
        ${e.notes ? `<div class="vd-field"><label>Notes</label><div class="vd-notes sel">${esc(e.notes)}</div></div>` : ''}
      </div>
      ${e.hasPassword && (e.strength <= 1 || e.reused) ? `<div class="tip warn">${ic('alert', 15)}<span>${e.strength <= 1 ? 'This password is weak.' : 'This password is reused.'} Change it on ${esc(e.host || 'the site')}, then click <b>Edit</b> → generate a new one here.</span></div>` : ''}
      <div class="vd-foot muted-sm">Updated ${new Date(e.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>`;
  }
  function editHTML(e) {
    return `<form class="vd-edit" id="vEdit">
      <h2>${e.id ? 'Edit password' : 'New password'}</h2>
      <div class="field"><label>Name</label><input class="input" name="name" value="${esc(e.name)}" placeholder="e.g. Netflix"></div>
      <div class="field"><label>Website</label><input class="input" name="url" value="${esc(e.url)}" placeholder="netflix.com"></div>
      <div class="field"><label>Username or email</label><input class="input" name="username" value="${esc(e.username)}" autocomplete="off"></div>
      <div class="field"><label>Password</label>
        <div class="key-row"><input class="input mono" name="password" value="${esc(e.password ?? '')}" placeholder="${e.id ? 'Leave blank to keep the current password' : ''}" autocomplete="off" spellcheck="false">
        <button class="btn" type="button" data-act="gen" title="Generate">${ic('dice', 15)}</button></div>
        <div id="vEditMeter">${meterHTML(pwStrengthLocal(e.password || ''))}</div></div>
      <div class="field"><label>Notes</label><textarea class="textarea" name="notes">${esc(e.notes || '')}</textarea></div>
      <div class="modal-foot" style="padding:6px 0 0">
        ${e.id ? `<button class="btn danger" type="button" data-act="delete">${ic('trash', 14)} Delete</button>` : ''}
        <span class="spacer"></span>
        <button class="btn" type="button" data-act="cancel">Cancel</button>
        <button class="btn brand" style="--c:var(--vault)" type="submit">Save</button>
      </div>
    </form>`;
  }

  function bindDetail(el) {
    const box = $('#vDetail', el);
    $$('[data-open]', box).forEach(a => a.onclick = () => relay.openExternal(a.dataset.open));
    $('[data-empty-import]', box)?.addEventListener('click', openImport);
    const e = v.list.find(x => x.id === v.selected);
    if (v.editing) {
      const f = $('#vEdit', box);
      const pw = f.elements.password;
      pw.oninput = () => { $('#vEditMeter', box).innerHTML = meterHTML(pwStrengthLocal(pw.value)); };
      $('[data-act=gen]', f).onclick = () => openGenerator((val) => { pw.value = val; pw.oninput(); });
      $('[data-act=cancel]', f).onclick = () => { v.editing = null; renderVault(el); };
      $('[data-act=delete]', f)?.addEventListener('click', () => confirmDelete(v.editing.id));
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        const data = Object.fromEntries(new FormData(f).entries());
        if (!data.name && !data.url) return R().toast('Add a name or website', 'error');
        const entry = { name: data.name.trim() || data.url.trim(), url: data.url.trim(), username: data.username.trim(), notes: data.notes };
        if (v.editing.id) { entry.id = v.editing.id; if (data.password) entry.password = data.password; }
        else entry.password = data.password;
        v.list = await relay.vault.save(entry);
        if (!v.editing.id) v.selected = v.list[v.list.length - 1]?.id;
        delete v.revealed[entry.id];
        v.editing = null;
        renderSidebar(v.side); renderVault(el);
        R().toast('Saved');
      };
      setTimeout(() => f.elements.name.focus(), 30);
      return;
    }
    if (!e) return;
    $$('[data-copy]', box).forEach(b => b.onclick = async () => { await relay.vault.copy(e.id, b.dataset.copy); R().toast(b.dataset.copy === 'password' ? 'Password copied — clears in 30 seconds' : 'Username copied'); });
    $('[data-act=reveal]', box).onclick = async () => {
      if (v.revealed[e.id]) delete v.revealed[e.id];
      else { v.revealed[e.id] = await relay.vault.reveal(e.id); setTimeout(() => { delete v.revealed[e.id]; if (v.selected === e.id && R().state.ui.platform === 'vault' && !v.editing) renderVault(v.el); }, 20000); }
      renderVault(el);
    };
    $('[data-act=fav]', box).onclick = async () => { v.list = await relay.vault.save({ id: e.id, favorite: !e.favorite }); renderSidebar(v.side); renderVault(el); };
    $('[data-act=edit]', box).onclick = async () => { v.editing = { ...e, password: await relay.vault.reveal(e.id) }; renderVault(el); };
  }

  function confirmDelete(id) {
    const e = v.list.find(x => x.id === id);
    R().openModal({
      title: 'Delete this password?', subtitle: `${e?.name || e?.host} will be removed from your vault. This can’t be undone.`,
      icon: 'trash', color: 'var(--danger)', body: '',
      actions: [{ label: 'Cancel' }, { label: 'Delete', cls: 'brand', style: '--c:var(--danger)', onClick: async () => {
        v.list = await relay.vault.remove(id); v.editing = null; v.selected = null; renderSidebar(v.side); renderVault(v.el); R().toast('Deleted');
      } }]
    });
  }

  /* ---------- import ---------- */
  function openImport() {
    R().openModal({
      title: 'Import from Google Password Manager',
      subtitle: 'Takes about a minute. Your passwords are encrypted the moment they land in Relay.',
      icon: 'download', color: 'var(--vault)', wide: true,
      body: `
        <ol class="steps-guide">
          <li><span class="sg-n">1</span><div><b>Open Google Password Manager</b><p>Sign in with the Google account that has your passwords.</p>
            <button class="btn" type="button" id="iOpen">${ic('external', 14)} Open passwords.google.com</button></div></li>
          <li><span class="sg-n">2</span><div><b>Export your passwords</b><p>Click the <b>Settings</b> gear → <b>Export passwords</b> → <b>Export</b>, then confirm with your Google password. A file called <i>Google Passwords.csv</i> lands in your Downloads folder.</p></div></li>
          <li><span class="sg-n">3</span><div><b>Choose that file</b><p>Relay reads it, encrypts everything, and skips duplicates.</p>
            <button class="btn brand" type="button" id="iPick" style="--c:var(--vault)">${ic('upload', 14)} Choose CSV file…</button></div></li>
        </ol>
        <div id="iResult"></div>
        <div class="hint" style="font-size:11.5px;color:var(--muted)">Also works with exports from Chrome, Safari, 1Password, Bitwarden and LastPass.</div>`,
      actions: [{ label: 'Done', cls: 'primary' }],
      onMount: (m) => {
        $('#iOpen', m).onclick = () => relay.openExternal('https://passwords.google.com/options?ep=1');
        $('#iPick', m).onclick = async () => {
          try {
            const r = await relay.vault.importCSV();
            if (!r) return;
            v.list = r.list;
            $('#iResult', m).innerHTML = `<div class="import-ok">${ic('checkCircle', 20)}<div><b>Imported ${r.added} password${r.added === 1 ? '' : 's'}</b>${r.skipped ? ` <span class="muted-sm">(${r.skipped} duplicate${r.skipped === 1 ? '' : 's'} skipped)</span>` : ''}
              <p>“${esc(r.file)}” is <b>not encrypted</b> — anyone with access to your Mac could read it. Move it to the Trash now.</p>
              <button class="btn brand" id="iTrash" style="--c:var(--danger)">${ic('trash', 14)} Move file to Trash</button></div></div>`;
            $('#iTrash', m).onclick = async (ev) => { await relay.vault.trashImport(); ev.target.closest('button').outerHTML = `<span class="key-status">${ic('check', 13)} Moved to Trash — empty the Trash to finish</span>`; };
            renderSidebar(v.side); if (R().state.ui.platform === 'vault') renderVault(v.el);
          } catch (err) { R().toast(cleanErr(err), 'error'); }
        };
      }
    });
  }

  /* ---------- generator ---------- */
  function generate(len = 20, opts = { upper: true, digits: true, symbols: true }) {
    const lower = 'abcdefghijkmnopqrstuvwxyz', upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ', digits = '23456789', symbols = '!@#$%^&*-_=+?';
    const sets = [lower, opts.upper && upper, opts.digits && digits, opts.symbols && symbols].filter(Boolean);
    const all = sets.join('');
    const rnd = (n) => { const a = new Uint32Array(1); const max = Math.floor(0xffffffff / n) * n; do crypto.getRandomValues(a); while (a[0] >= max); return a[0] % n; };
    const out = sets.map(s => s[rnd(s.length)]);
    while (out.length < len) out.push(all[rnd(all.length)]);
    for (let i = out.length - 1; i > 0; i--) { const j = rnd(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
    return out.join('');
  }
  function openGenerator(onUse) {
    const o = { len: 20, upper: true, digits: true, symbols: true };
    let value = generate(o.len, o);
    R().openModal({
      title: 'Password generator', icon: 'dice', color: 'var(--vault)',
      body: `
        <div class="gen-out"><span id="gVal" class="mono sel">${esc(value)}</span><button class="icon-btn" id="gNew" title="New">${ic('refresh', 17)}</button></div>
        <div id="gMeter">${meterHTML(pwStrengthLocal(value))}</div>
        <div class="field"><label>Length: <b id="gLenL">${o.len}</b></label><input type="range" id="gLen" min="8" max="64" value="${o.len}"></div>
        <div class="row" style="gap:16px">
          <label class="check"><input type="checkbox" data-o="upper" checked> A–Z</label>
          <label class="check"><input type="checkbox" data-o="digits" checked> 0–9</label>
          <label class="check"><input type="checkbox" data-o="symbols" checked> !@#$</label>
        </div>`,
      actions: [{ label: 'Copy', onClick: () => { navigator.clipboard.writeText(value); R().toast('Copied'); } }, ...(onUse ? [{ label: 'Use password', cls: 'brand', style: '--c:var(--vault)', onClick: () => onUse(value) }] : [])],
      onMount: (m) => {
        const upd = () => { value = generate(o.len, o); $('#gVal', m).textContent = value; $('#gMeter', m).innerHTML = meterHTML(pwStrengthLocal(value)); };
        $('#gNew', m).onclick = upd;
        $('#gLen', m).oninput = (e) => { o.len = +e.target.value; $('#gLenL', m).textContent = o.len; upd(); };
        $$('[data-o]', m).forEach(c => c.onchange = () => { o[c.dataset.o] = c.checked; upd(); });
      }
    });
  }

  /* ---------- security ---------- */
  function openSecurity() {
    const s = v.status;
    R().openModal({
      title: 'Touch ID & security', icon: 'fingerprint', color: 'var(--vault)',
      body: `
        <div class="provider-card">
          <div class="ph">${ic('fingerprint', 18)} Unlock with Touch ID <span style="margin-left:auto"><label class="switch"><input type="checkbox" id="sTouch" ${s.touchIdEnabled ? 'checked' : ''} ${s.touchIdAvailable ? '' : 'disabled'}><span></span></label></span></div>
          <div class="hint" style="color:var(--muted);font-size:12px">${s.touchIdAvailable ? 'Your vault key is stored in the macOS keychain and released only after Touch ID.' : 'Touch ID isn’t available on this Mac.'} The vault locks after 10 minutes of inactivity, when your Mac sleeps, or when your screen locks.</div>
        </div>
        <div class="provider-card">
          <div class="ph">${ic('key', 18)} Change master password</div>
          <input class="input" type="password" id="sCur" placeholder="Current master password">
          <input class="input" type="password" id="sNew" placeholder="New master password (8+ characters)">
          <button class="btn" id="sChange" style="align-self:flex-start">Change password</button>
        </div>
        <div class="provider-card">
          <div class="ph">${ic('upload', 18)} Export</div>
          <div class="hint" style="color:var(--muted);font-size:12px">Saves an <b>unencrypted</b> CSV you can import into another password manager. Delete it when you’re done.</div>
          <button class="btn" id="sExport" style="align-self:flex-start">Export CSV…</button>
        </div>`,
      actions: [{ label: 'Done', cls: 'primary' }],
      onMount: (m) => {
        $('#sTouch', m).onchange = async (e) => {
          try { v.status = await relay.vault.setTouchID(e.target.checked); R().toast(e.target.checked ? 'Touch ID is on' : 'Touch ID is off'); }
          catch (err) { e.target.checked = !e.target.checked; R().toast(cleanErr(err), 'error'); }
        };
        $('#sChange', m).onclick = async () => {
          try { v.status = await relay.vault.changePassword({ current: $('#sCur', m).value, next: $('#sNew', m).value }); $('#sCur', m).value = $('#sNew', m).value = ''; R().toast('Master password changed'); }
          catch (err) { R().toast(cleanErr(err), 'error'); }
        };
        $('#sExport', m).onclick = async () => { if (await relay.vault.exportCSV()) R().toast('Exported'); };
      }
    });
  }

  /* ---------- unlock on demand (used by "Fill from Vault") ---------- */
  const unlockWaiters = [];
  async function ensureUnlocked() {
    await refreshStatus();
    if (v.status.unlocked) return true;
    if (!v.status.exists) { R().toast('Set up your vault first', 'error'); R().setPlatform('vault'); return false; }
    if (v.status.touchIdEnabled) {
      try { v.status = await relay.vault.unlockTouchID(); await loadList(); return true; } catch { /* fall back to password */ }
    }
    return new Promise((resolve) => {
      let settled = false;
      R().openModal({
        title: 'Unlock your vault', icon: 'lock', color: 'var(--vault)',
        body: `<input class="input lg" type="password" id="uPw" placeholder="Master password">`,
        actions: [{ label: 'Cancel', onClick: () => { settled = true; resolve(false); } }, { label: 'Unlock', cls: 'brand', style: '--c:var(--vault)', onClick: async (m) => {
          try { v.status = await relay.vault.unlock($('#uPw', m).value); await loadList(); settled = true; resolve(true); }
          catch (err) { R().toast(cleanErr(err), 'error'); return false; }
        } }],
        onMount: (m) => { $('#uPw', m).onkeydown = (e) => { if (e.key === 'Enter') $('[data-act="1"]', m).click(); }; }
      });
      setTimeout(() => { if (!settled && !document.querySelector('#uPw')) resolve(false); }, 60000);
    });
  }

  window.Vault = {
    render, renderSidebar, ensureUnlocked,
    onLocked: () => {
      v.list = []; v.revealed = {}; v.editing = null; v.autoPrompted = false;
      if (v.status) v.status.unlocked = false;
      refreshStatus().then(() => { if (R().state.ui.platform === 'vault') { renderSidebar(v.side); render(v.el); } });
    }
  };
})();
