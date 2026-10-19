/* Slate — optional bank connection through SimpleFIN Bridge: connect, refresh, disconnect */
(() => {
  const X = Slate;
  const { S, $, $$, esc, fmt, modal, toast } = X;
  let state = { connected: false, accounts: [] };
  const ago = (t) => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const banks = () => [...new Set((state.accounts || []).map(a => a.institution).filter(Boolean))];

  async function load() { state = await slate.simplefin.state(); return state; }
  slate.on.simplefin((s) => { state = s; });

  /* ---------- connect ---------- */
  function setup(replace) {
    if (state.connected && replace !== true) return manage();
    modal({
      title: 'Update balances automatically',
      sub: 'Optional. SimpleFIN Bridge is a small paid service (about $1.50 a month or $15 a year) that reads balances from your banks. Statements and typing balances in keep working either way.',
      body: `<ol style="margin:0 0 18px;padding-left:20px;color:var(--text-2);line-height:1.7">
          <li>Make an account at <a href="#" id="sfBridge" style="color:var(--accent)">bridge.simplefin.org</a> and link your banks there. You sign in to each bank on Bridge, not in Slate.</li>
          <li>In Bridge, open <b>My Account → Apps → New connection</b>, name it “Slate” and copy the <b>Setup Token</b>.</li>
          <li>Paste it below. Slate trades it for a private access link, stores that link encrypted with this computer’s keychain, and only ever sends it back to SimpleFIN.</li></ol>
        <div class="field"><label>Setup Token</label><textarea class="input" id="sfToken" rows="3" autocomplete="off" spellcheck="false" placeholder="aHR0cHM6Ly9icmlkZ2Uuc2ltcGxlZmluLm9yZy9zaW1wbGVmaW4vY2xhaW0v…" style="font-family:ui-monospace,Menlo,monospace;font-size:12px;resize:vertical"></textarea></div>
        <div id="sfMsg" class="small"></div>
        <p class="muted small" style="margin:10px 0 0">Slate only asks for balances, never transactions, and refreshes them at most every few hours. Nothing is sent anywhere until you connect.</p>`,
      actions: [{ label: 'Cancel' }, { label: 'Connect', cls: 'primary', onClick: async (m) => {
        const token = $('#sfToken', m).value.trim();
        if (!token) { $('#sfMsg', m).innerHTML = '<span class="neg">Paste the Setup Token from Bridge.</span>'; return false; }
        $('#sfMsg', m).innerHTML = '<span class="muted">Connecting to SimpleFIN…</span>';
        let r;
        try { r = await slate.simplefin.connect(token); }
        catch (e) { $('#sfMsg', m).innerHTML = `<span class="neg">${esc(cleanErr(e))}</span>`; return false; }
        await load();
        const fresh = await slate.load(); S.store.accounts = fresh.accounts;
        X.refresh();
        if (r.syncError) toast(`Connected, but the first update failed: ${r.syncError}`, 'error');
        else setTimeout(() => afterConnect(r), 60); // after this dialog has closed
      } }],
      onMount: (m) => { $('#sfBridge', m).onclick = (e) => { e.preventDefault(); slate.simplefin.openBridge(); }; setTimeout(() => $('#sfToken', m).focus(), 50); }
    });
  }
  const cleanErr = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  function manage() {
    modal({
      title: 'SimpleFIN connection',
      sub: `Connected ${state.addedAt ? X.dateLabel(new Date(state.addedAt).toISOString().slice(0, 10), true) : ''} through ${esc(state.host || 'SimpleFIN')}. Last update ${ago(state.lastSync)}.`,
      body: `${state.accounts.length ? `<div class="panel"><table class="t"><thead><tr><th>Account</th><th>Bank</th></tr></thead><tbody>${state.accounts.map(a => `<tr><td><b>${esc(a.name)}</b>${a.last4 ? ` <span class="muted small">••${esc(a.last4)}</span>` : ''}</td><td class="muted">${esc(a.institution || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No accounts came through yet. Link banks in Bridge, then press Update now.</p>'}
        ${issues()}
        <p class="muted small" style="margin:14px 0 0">To add or remove banks, do it in Bridge; Slate picks up the change on the next update. Disconnecting here deletes the access link from this computer. To shut it off completely, also delete the “Slate” app in Bridge.</p>`,
      left: '<button class="btn ghost danger" id="sfOff">Disconnect</button>',
      actions: [{ label: 'Open Bridge', onClick: () => { slate.simplefin.openBridge('apps'); return false; } }, { label: 'Done', cls: 'primary' }],
      onMount: (m, close) => { $('#sfOff', m).onclick = async () => { close(); await disconnect(); }; }
    });
  }
  function issues() {
    const list = [...(state.errors || []), ...(state.warnings || [])];
    if (state.needsReconnect) list.unshift('SimpleFIN turned this connection off. Make a new Setup Token in Bridge and connect again.');
    return list.length ? `<div class="panel" style="padding:10px 12px;margin-top:12px;border-color:var(--neg)">${list.map(e => `<div class="small">${ic('alert', 13)} ${esc(e)}</div>`).join('')}</div>` : '';
  }
  async function disconnect() {
    if (!await X.confirm('Disconnect SimpleFIN?', 'Your accounts and their balance history stay in Slate; they just stop updating on their own. Delete the “Slate” app in Bridge too if you’re done with it.', 'Disconnect')) return;
    state = await slate.simplefin.disconnect();
    const fresh = await slate.load(); S.store.accounts = fresh.accounts;
    toast('Disconnected from SimpleFIN'); X.refresh();
  }

  // New card accounts → suggest which card from the catalog they are
  function guessCard(a) {
    const iss = (a.institution || '').toLowerCase();
    const text = `${a.simplefin?.name || ''} ${a.name}`.toLowerCase().replace(/[®™℠]/g, '');
    const cands = X.allCards().filter(c => {
      const ci = c.issuer.toLowerCase();
      return !iss || iss.includes(ci.split(' ')[0]) || ci.includes(iss.split(' ')[0]) || (c.issuer === 'Goldman Sachs' && /apple|goldman/.test(iss));
    });
    return (cands.find(c => text.includes(c.name.toLowerCase().replace(/ card$/, ''))) || {}).id || '';
  }
  function afterConnect(r) {
    const cards = X.accounts().filter(a => a.type === 'credit' && a.simplefin && !X.wallet().some(w => w.accountId === a.id));
    const names = banks().join(', ');
    const summary = `${r.balances || 0} balance${r.balances === 1 ? '' : 's'}${r.created?.length ? ` · ${r.created.length} new account${r.created.length > 1 ? 's' : ''}` : ''}${r.linked?.length ? ` · ${r.linked.length} matched to accounts you had` : ''}`;
    if (r.errors?.length) toast(r.errors[0], 'error');
    if (!cards.length) { toast(`Connected${names ? ' ' + names : ''} · ${summary}`); return; }
    modal({
      title: `Connected${names ? ' ' + names : ''}`, wide: true,
      sub: 'These cards came in with it. Pick which card each one is to put it in your wallet with its fees and credits.',
      body: `<div class="panel"><table class="t"><thead><tr><th></th><th>Account</th><th class="r">Balance</th><th style="width:45%">Card</th></tr></thead><tbody>
        ${cards.map(a => { const g = guessCard(a); const l = X.latest(a); return `<tr data-a="${a.id}"><td><input type="checkbox" data-inc ${g ? 'checked' : ''}></td><td><b>${esc(a.name)}</b><div class="muted small">${esc(a.institution)}${a.last4 ? ' · ••' + esc(a.last4) : ''}</div></td><td class="r">${l ? fmt(l.amount, { cents: true }) : '—'}</td>
          <td><select class="input" data-card><option value="">Choose a card…</option>${X.allCards().map(c => `<option value="${esc(c.id)}" ${c.id === g ? 'selected' : ''}>${esc(c.issuer)} ${esc(c.name)}</option>`).join('')}</select></td></tr>`; }).join('')}
        </tbody></table></div>
        <p class="muted small" style="margin:12px 0 0">Banks don’t share open dates through SimpleFIN. Your credit report fills them in (Cards → Fill in from credit report).</p>`,
      actions: [{ label: 'Not now' }, { label: 'Add to wallet', cls: 'primary', onClick: (m) => {
        let n = 0;
        $$('tr[data-a]', m).forEach(tr => {
          const cardId = $('[data-card]', tr).value;
          if (!$('[data-inc]', tr).checked || !cardId) return;
          const a = X.account(tr.dataset.a);
          const c = X.card(cardId);
          a.name = `${c.issuer === 'American Express' ? 'Amex' : c.issuer === 'Goldman Sachs' ? 'Apple' : c.issuer} ${c.name}`.replace(/^Apple Apple/, 'Apple');
          S.store.wallet.push({ id: X.uid(), cardId, accountId: a.id, last4: a.last4 || '', opened: a.opened || null, usage: [] });
          n++;
        });
        X.save('wallet', 'accounts');
        if (n) toast(`${n} card${n > 1 ? 's' : ''} added to your wallet`);
        X.refresh();
      } }],
      onMount: (m) => $$('tr[data-a]', m).forEach(tr => { $('[data-card]', tr).onchange = (e) => { $('[data-inc]', tr).checked = !!e.target.value; }; })
    });
  }

  async function refreshNow(silent) {
    if (!state.connected) return;
    if (!silent) toast('Updating balances…');
    let r;
    try { r = await slate.simplefin.sync(); }
    catch (e) { await load(); X.refresh(); return toast(cleanErr(e), 'error'); }
    await load();
    if (r.skipped) {
      if (silent) return;
      if (r.reason === 'too-soon') return toast(`Balances were updated ${ago(state.lastSync)}. SimpleFIN limits how often Slate can ask, so try again in a few minutes.`);
      if (r.reason === 'daily-cap') return toast('That’s enough updates for today; SimpleFIN limits how often Slate can ask. It’ll update again tomorrow.');
      return;
    }
    const fresh = await slate.load(); S.store.accounts = fresh.accounts;
    X.refresh();
    if (r.errors?.length) toast(r.errors[0], 'error');
    else if (!silent) toast(`Updated ${r.balances} balance${r.balances === 1 ? '' : 's'}${r.created.length ? ` · ${r.created.length} new account${r.created.length > 1 ? 's' : ''}` : ''}`);
  }

  /* ---------- the panel on the Accounts page ---------- */
  function panelHTML() {
    if (!state.connected) {
      return `<div class="drop-zone" style="margin-bottom:22px">${ic('link', 20)}<div style="flex:1"><b>Update balances automatically (optional).</b> Connect your banks through SimpleFIN Bridge and every balance refreshes on its own.</div><button class="btn sm" data-sf="setup">Set up</button></div>`;
    }
    const bad = state.needsReconnect || (state.errors || []).length;
    return `<div class="section-head" style="margin-top:0"><h2>Connected banks</h2><span class="muted small">via SimpleFIN · updated ${ago(state.lastSync)}</span><span class="spacer"></span>
        <button class="btn sm" data-sf="sync">${ic('refresh', 14)} Update now</button><button class="icon-btn sm" data-sf="setup" title="Connection settings">${ic('settings', 15)}</button></div>
      ${state.needsReconnect ? `<div class="drop-zone" style="margin-bottom:14px;border-color:var(--neg)">${ic('alert', 18)}<div style="flex:1">SimpleFIN turned this connection off. Make a new Setup Token in Bridge to keep balances updating.</div><button class="btn sm primary" data-sf="reconnect">Connect again</button></div>` : ''}
      <div class="row wrap" style="gap:10px;margin-bottom:24px">${banks().length ? banks().map(b => { const n = state.accounts.filter(a => a.institution === b).length; const err = (state.errors || []).find(e => e.toLowerCase().includes(b.toLowerCase().split(' ')[0])); return `
        <div class="panel" style="padding:10px 12px;display:flex;align-items:center;gap:10px;min-width:200px">
          <span class="dot" style="--c:${err ? 'var(--neg)' : 'var(--pos)'}"></span>
          <div style="flex:1"><b>${esc(b)}</b><div class="muted small">${err ? esc(err) : `${n} account${n === 1 ? '' : 's'}`}</div></div></div>`; }).join('')
        : `<p class="muted small" style="margin:-4px 0 0">${bad ? 'Check the connection settings.' : 'Connected. Link banks in Bridge, then press Update now.'}</p>`}</div>`;
  }
  function bindPanel(el) {
    $$('[data-sf]', el).forEach(b => b.onclick = () => ({ setup, sync: () => refreshNow(false), reconnect: () => setup(true) })[b.dataset.sf]());
  }

  X.views.connections = { load, setup, refreshNow, panelHTML, bindPanel, guessCard, state: () => state, ago };
})();
