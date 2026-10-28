// Vantage — runs in every web page (isolated from the page's own scripts).
//  1. Presents an ordinary browser identity to sign-in pages (Google/Microsoft refuse "embedded" browsers).
//  2. Password autofill: a small menu under sign-in fields with the Vault's matching logins,
//     a strong-password suggestion for new-password fields and 2FA codes for one-time-code fields.
//  3. Offers to save or update a password after you sign in.
const { ipcRenderer, webFrame } = require('electron');

try {
  const patch = ipcRenderer.sendSync('vantage:navigator-patch', location.href);
  if (patch) webFrame.executeJavaScript(patch);
} catch (e) { /* never break the page */ }

(() => {
  if (!/^https?:$/.test(location.protocol)) return;
  const vis = (el) => el && el.isConnected && !el.disabled && !el.readOnly && el.type !== 'hidden' && (el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const pwFields = (root = document) => [...root.querySelectorAll('input[type=password]')].filter(vis);
  const USERISH = 'input[type=email], input[autocomplete~=username], input[autocomplete~=email], input[name=identifier], input[name=loginfmt], input[name*=user i], input[id*=user i], input[name*=login i], input[id*=login i], input[name*=email i], input[id*=email i], input[type=text], input[type=tel], input:not([type])';
  const isOtp = (el) => el.autocomplete === 'one-time-code' || (/(otp|totp|2fa|mfa|one.?time|verification.?code|security.?code|auth.?code)/i.test(`${el.name} ${el.id} ${el.placeholder} ${el.getAttribute('aria-label') || ''}`) && (el.maxLength <= 10 || el.inputMode === 'numeric'));
  const formOf = (el) => el.form || el.closest('form, [role=form], [role=dialog]') || document;
  function userFieldFor(pw) {
    const scope = formOf(pw);
    const all = [...scope.querySelectorAll(USERISH)].filter(el => vis(el) && el.type !== 'password' && !isOtp(el) && el.type !== 'search');
    const before = all.filter(el => el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
    return before[before.length - 1] || all[0] || null;
  }
  function classify(el) {
    if (!(el instanceof HTMLInputElement) || !vis(el)) return null;
    if (el.type === 'password') {
      const inForm = pwFields(formOf(el));
      const isNew = el.autocomplete === 'new-password' || inForm.length >= 2 || /(new|confirm|repeat|create)/i.test(`${el.name} ${el.id} ${el.placeholder} ${el.getAttribute('aria-label') || ''}`);
      return isNew ? 'new' : 'password';
    }
    if (isOtp(el)) return 'otp';
    if (['text', 'email', 'tel', ''].includes(el.type)) {
      if (el.autocomplete && /username|email/.test(el.autocomplete)) return 'username';
      const pws = pwFields(formOf(el));
      if (pws.length) return 'username';
      if (/(user|login|email|identifier|account)/i.test(`${el.name} ${el.id} ${el.autocomplete}`)) return 'username';
    }
    return null;
  }
  function setVal(el, v) {
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    el.focus();
    d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* ---------- the menu ---------- */
  let host = null, shadow = null, menu = null, items = [], sel = -1, anchor = null;
  function ensureMenu() {
    if (host && host.isConnected) return;
    host = document.createElement('vantage-autofill');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0;';
    shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      .m{font:13px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#151a20;color:#e9eef5;border:1px solid #2a323d;border-radius:12px;box-shadow:0 18px 40px -12px rgba(0,0,0,.55);padding:6px;min-width:250px;max-width:340px;max-height:300px;overflow:auto}
      .h{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#7f8a99;padding:6px 10px 4px;display:flex;gap:6px;align-items:center}
      .h b{width:14px;height:14px;border-radius:4px;background:linear-gradient(135deg,#2fe0c4,#4f8cff);display:inline-block}
      .i{display:flex;gap:10px;align-items:center;padding:8px 10px;border-radius:8px;cursor:default}
      .i.on,.i:hover{background:#1f2933}
      .a{width:28px;height:28px;border-radius:8px;background:#253040;display:grid;place-items:center;font-weight:600;color:#9fe8dc;flex:none}
      .t{min-width:0}.t div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.t .s{color:#8a96a6;font-size:12px}
      .code{font:600 16px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;color:#9fe8dc}
      @media (prefers-color-scheme: light){.m{background:#fff;color:#141820;border-color:#e2e6ec}.i.on,.i:hover{background:#eef3f7}.a{background:#e6f7f4;color:#0f8f7f}.code{color:#0f8f7f}}
    </style><div class="m" role="listbox"></div>`;
    menu = shadow.querySelector('.m');
    menu.addEventListener('mousedown', (e) => e.preventDefault());
    document.documentElement.appendChild(host);
  }
  function hide() { if (host) host.style.display = 'none'; items = []; sel = -1; }
  function place() {
    if (!anchor || !host) return;
    const r = anchor.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return hide();
    host.style.display = 'block';
    const mh = menu.offsetHeight || 120;
    const top = r.bottom + 6 + mh > innerHeight && r.top > mh + 6 ? r.top - mh - 6 : r.bottom + 6;
    host.style.left = Math.max(4, Math.min(r.left, innerWidth - (menu.offsetWidth || 260) - 6)) + 'px';
    host.style.top = top + 'px';
  }
  function show(list, el) {
    if (!list.length) return hide();
    ensureMenu(); anchor = el; items = list; sel = -1;
    const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    menu.innerHTML = `<div class="h"><b></b>Vantage Vault</div>` + list.map((it, i) => `<div class="i" data-i="${i}" role="option">
      <div class="a">${esc(it.badge || (it.title || '?')[0].toUpperCase())}</div><div class="t"><div ${it.mono ? 'class="code"' : ''}>${esc(it.title)}</div>${it.sub ? `<div class="s">${esc(it.sub)}</div>` : ''}</div></div>`).join('');
    menu.querySelectorAll('.i').forEach(n => n.onclick = () => pick(+n.dataset.i));
    host.style.display = 'block';
    place();
  }
  function highlight() { menu?.querySelectorAll('.i').forEach((n, i) => n.classList.toggle('on', i === sel)); }
  async function pick(i) { const it = items[i]; hide(); if (it) await it.run(); }

  function genPassword() {
    const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '-_.!@#%+='];
    const all = sets.join('');
    const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
    const out = sets.map(s => s[rnd(s.length)]);
    while (out.length < 20) out.push(all[rnd(all.length)]);
    for (let i = out.length - 1; i > 0; i--) { const j = rnd(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
    return out.join('');
  }

  let lastQuery = 0;
  async function offer(el) {
    const kind = classify(el);
    if (!kind) return hide();
    const q = ++lastQuery;
    let res;
    try { res = await ipcRenderer.invoke('af:query', { kind }); } catch { return; }
    if (q !== lastQuery || document.activeElement !== el) return;
    if (!res || res.state === 'off' || res.state === 'none') {
      if (kind === 'new' && res?.state !== 'off') return show([suggestItem(el)], el);
      return hide();
    }
    const list = [];
    if (res.state === 'locked') {
      list.push({ title: 'Unlock Vantage Vault', sub: `${res.count || 'Your'} saved logins`, badge: '🔒', run: async () => { await ipcRenderer.invoke('af:unlock'); } });
      if (kind === 'new') list.push(suggestItem(el));
      return show(list, el);
    }
    if (kind === 'otp') {
      for (const e of res.list.filter(x => x.hasTotp)) list.push({ title: 'Fill 2FA code', sub: `${e.name} · ${e.username || ''}`, badge: '#', run: async () => { const c = await ipcRenderer.invoke('af:totp', { id: e.id }); if (c) setVal(el, c.code); } });
      return show(list, el);
    }
    if (kind === 'new') list.push(suggestItem(el));
    for (const e of res.list) list.push({ title: e.username || '(no username)', sub: e.name, run: () => fillEntry(e.id, el) });
    show(list, el);
  }
  function suggestItem(el) {
    const pw = genPassword();
    return { title: pw, mono: true, sub: 'Use a strong password · saved when you sign up', badge: '✦', run: () => {
      const fields = pwFields(formOf(el));
      justFilled = Date.now();
      (fields.length ? fields : [el]).forEach(f => setVal(f, pw));
      el.focus();
    } };
  }
  let justFilled = 0;
  async function fillEntry(id, el) {
    const r = await ipcRenderer.invoke('af:fill', { id });
    if (!r) return;
    justFilled = Date.now();
    const pw = el.type === 'password' ? el : pwFields(formOf(el))[0];
    const user = el.type !== 'password' ? el : (pw && userFieldFor(pw));
    if (user && r.username) setVal(user, r.username);
    if (pw) { setVal(pw, r.password); pw.focus(); }
  }

  document.addEventListener('focusin', (e) => { if (Date.now() - justFilled < 800) return hide(); if (e.target instanceof HTMLInputElement) offer(e.target); else hide(); }, true);
  document.addEventListener('mousedown', (e) => { if (e.target === host) return; if (anchor && e.target === anchor && (!host || host.style.display === 'none')) offer(anchor); else if (e.target !== anchor) hide(); }, true);
  document.addEventListener('keydown', (e) => {
    if (!items.length || !host || host.style.display === 'none' || e.target !== anchor) return;
    if (e.key === 'ArrowDown') { sel = (sel + 1) % items.length; highlight(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'ArrowUp') { sel = (sel - 1 + items.length) % items.length; highlight(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); e.stopPropagation(); pick(sel); }
    else if (e.key === 'Escape') hide();
  }, true);
  addEventListener('scroll', () => place(), true);
  addEventListener('resize', () => place());

  /* ---------- offer to save after signing in ---------- */
  let sentFor = '';
  function capture(scope) {
    const pws = pwFields(scope).filter(p => p.value);
    if (!pws.length) {
      // first page of a two-step sign-in: remember the username for the password page
      const u = [...(scope.querySelectorAll ? scope.querySelectorAll(USERISH) : [])].find(el => vis(el) && el.value && classify(el) === 'username');
      if (u) ipcRenderer.send('af:username', u.value);
      return;
    }
    const pw = pws[pws.length - 1];
    if (pw.value === sentFor) return;
    sentFor = pw.value;
    const user = userFieldFor(pws[0]);
    ipcRenderer.send('af:captured', { username: user ? user.value : '', password: pw.value });
  }
  document.addEventListener('submit', (e) => capture(e.target), true);
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button, input[type=submit], input[type=button], [role=button]');
    if (!b) return;
    const label = `${b.textContent || ''} ${b.value || ''} ${b.getAttribute('aria-label') || ''}`;
    if (b.type !== 'submit' && !/(sign|log)\s*(in|on)|continue|next|submit|create|register|sign\s*up|join|save|update|change|confirm/i.test(label)) return;
    const scope = formOf(b);
    if (pwFields(scope).length || scope.querySelector?.(USERISH)) setTimeout(() => capture(scope), 0);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
    const k = classify(e.target);
    if (k) setTimeout(() => capture(formOf(e.target)), 0);
  }, true);
})();
