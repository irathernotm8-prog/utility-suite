(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { boot: null, ws: null, view: 'overview', range: 30, sort: { k: 'spend', dir: -1 }, sum: null, chat: [], busy: false };

  const fmt = {
    money: (n) => '$' + (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : (+n).toFixed(2)),
    compact: (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(Math.round(n))),
    num: (n) => (+n).toLocaleString(undefined, { maximumFractionDigits: 1 }),
    pct: (n) => (+n).toFixed(2) + '%'
  };
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); };
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  function applyTheme(t) { if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }

  async function init() {
    st.boot = await lumen.bootstrap();
    st.ws = st.boot.active;
    document.body.classList.add(st.boot.platform === 'darwin' ? 'mac' : 'other');
    applyTheme(st.boot.theme);
    renderWs();
    show('overview');
  }

  function renderWs() {
    const s = $('#ws');
    s.innerHTML = st.boot.workspaces.map((w) => `<option value="${esc(w.id)}" ${w.id === st.ws ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
  }

  async function show(view) {
    st.view = view;
    document.querySelectorAll('#rail [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    try { await ({ overview, connections, settings })[view](); } catch (e) { $('#main').innerHTML = `<div class="wrap"><div class="note">${esc(e.message)}</div></div>`; }
  }

  // ---------- Overview ----------
  async function overview() {
    const main = $('#main');
    if (!st.ws) { main.innerHTML = '<div class="wrap empty">Create a workspace to begin.</div>'; return; }
    const to = st.boot.today, from = addDays(to, -(st.range - 1));
    const s = st.sum = await lumen.summary(st.ws, from, to);
    const c = s.current, p = s.previous;
    const hasData = s.campaigns.length > 0;
    const cpl = (x) => (x.conversions ? x.spend / x.conversions : 0);
    const ctr = (x) => (x.impressions ? (x.clicks / x.impressions) * 100 : 0);
    const kp = [
      { l: 'Spend', v: fmt.money(c.spend), cur: c.spend, prev: p.spend, key: 'spend', lowerBetter: false, color: 'var(--c1)', neutral: true },
      { l: 'Conversions', v: fmt.num(c.conversions), cur: c.conversions, prev: p.conversions, key: 'conversions', color: 'var(--c2)' },
      { l: 'Cost per conversion', v: c.conversions ? fmt.money(cpl(c)) : '—', cur: cpl(c), prev: cpl(p), lowerBetter: true, color: 'var(--c1)', series: s.series.map((d) => (d.conversions ? d.spend / d.conversions : 0)) },
      { l: 'Click-through rate', v: fmt.pct(ctr(c)), cur: ctr(c), prev: ctr(p), color: 'var(--c2)', series: s.series.map((d) => (d.impressions ? (d.clicks / d.impressions) * 100 : 0)) }
    ];
    const delta = (k) => {
      if (!k.prev) return '<span class="d flat">no prior period</span>';
      const pc = ((k.cur - k.prev) / k.prev) * 100; if (Math.abs(pc) < 0.5) return '<span class="d flat">flat vs previous</span>';
      const up = pc > 0, good = k.neutral ? null : (k.lowerBetter ? !up : up);
      return `<span class="d ${good === null ? 'flat' : good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${Math.abs(pc).toFixed(1)}% vs previous ${st.range}d</span>`;
    };
    const maxSpend = Math.max(...s.bySource.map((b) => b.spend), 1);
    const sources = s.bySource.map((b) => `<div class="src"><span>${esc(b.source === 'demo' ? 'Demo data' : b.source)}</span><b>${fmt.money(b.spend)}</b></div><div class="bar"><i style="width:${(b.spend / maxSpend) * 100}%"></i></div>`).join('') || '<div class="sub">No sources yet.</div>';

    main.innerHTML = `<div class="wrap">
      <div class="row between"><div><h1>Overview</h1><p class="sub">${esc(from)} → ${esc(to)}${s.latestData ? ' · latest data ' + esc(s.latestData) : ''}</p></div>
        <div class="seg" id="range">${[7, 30, 90].map((r) => `<button data-r="${r}" class="${r === st.range ? 'on' : ''}">${r}d</button>`).join('')}</div></div>
      ${hasData ? '' : '<div class="note">No data in this window yet. Add a source, or sync an existing one, in Sources.</div>'}
      ${(st.boot.workspaces.find((w) => w.id === st.ws) || {}).demo ? '<div class="note">This is generated demo data so you can see how Lumen looks. Create a new workspace and connect Meta to see your own numbers.</div>' : ''}
      <div class="kpis">${kp.map((k, i) => `<div class="card kpi"><div class="l">${k.l}</div><div class="v">${k.v}</div>${delta(k)}<div class="sp" data-i="${i}"></div></div>`).join('')}</div>
      <div class="grid2">
        <div class="card"><div class="row between"><h2>Daily spend &amp; conversions</h2><div class="legend"><span><i style="background:var(--c1)"></i>Spend</span><span><i style="background:var(--c2)"></i>Conversions</span></div></div><div class="chartbox" id="chart"></div></div>
        <div class="card"><h2>By source</h2>${sources}</div>
      </div>
      <div class="card"><h2>Campaigns</h2><div id="tbl"></div></div></div>`;

    kp.forEach((k, i) => {
      const vals = k.series || s.series.map((d) => d[k.key]);
      $(`.sp[data-i="${i}"]`).append(Charts.spark(vals, k.color));
    });
    Charts.daily($('#chart'), s.series, fmt);
    drawTable();
    $('#range').onclick = (e) => { const r = +e.target.dataset.r; if (r) { st.range = r; overview(); } };
  }

  function drawTable() {
    const s = st.sum, { k, dir } = st.sort;
    const rows = s.campaigns.map((r) => ({ ...r, cpl: r.conversions ? r.spend / r.conversions : Infinity, ctr: r.impressions ? r.clicks / r.impressions : 0 }));
    rows.sort((a, b) => (typeof a[k] === 'string' ? a[k].localeCompare(b[k]) : a[k] - b[k]) * dir);
    const cols = [['name', 'Campaign'], ['spend', 'Spend'], ['impressions', 'Impr.'], ['clicks', 'Clicks'], ['ctr', 'CTR'], ['conversions', 'Conv.'], ['cpl', 'Cost / conv.']];
    $('#tbl').innerHTML = rows.length ? `<table><thead><tr>${cols.map(([key, l]) => `<th data-k="${key}" class="${key === k ? 'sorted' : ''}">${l}${key === k ? (dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead><tbody>${rows.map((r) =>
      `<tr><td>${esc(r.name)}<span class="tag">${esc(r.source === 'demo' ? 'demo' : r.source)}</span></td><td>${fmt.money(r.spend)}</td><td>${r.impressions.toLocaleString()}</td><td>${r.clicks.toLocaleString()}</td><td>${fmt.pct(r.ctr * 100)}</td><td>${fmt.num(r.conversions)}</td><td>${isFinite(r.cpl) ? fmt.money(r.cpl) : '—'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No campaigns in this window.</div>';
    $('#tbl').onclick = (e) => { const th = e.target.closest('th'); if (!th) return; const nk = th.dataset.k; st.sort = { k: nk, dir: nk === k ? -dir : (nk === 'name' ? 1 : -1) }; drawTable(); };
  }

  // ---------- Sources ----------
  async function connections() {
    const list = await lumen.connections(st.ws);
    const meta = st.boot.connectors.ready;
    $('#main').innerHTML = `<div class="wrap"><h1>Sources</h1><p class="sub">Where Lumen pulls numbers from. Secrets are encrypted with your computer's keychain and never shown again.</p>
      <div class="card"><h2>Connected</h2>${list.map((c) => `<div class="conn"><div><b>${esc(c.label)}</b> <span class="pill ${esc(c.status)}">${esc(c.status === 'ok' ? 'synced' : c.status)}</span>
        <div class="sub" style="margin:2px 0 0">${c.last_sync ? 'Last sync ' + esc(new Date(c.last_sync).toLocaleString()) : 'Not synced yet'}</div>${c.last_error ? `<div class="err">${esc(c.last_error)}</div>` : ''}</div>
        <div class="row">${c.kind !== 'demo' ? `<button class="soft" data-a="test" data-id="${esc(c.id)}">Test</button>` : ''}<button class="soft" data-a="sync" data-id="${esc(c.id)}">Sync 90d</button><button class="ghost danger" data-a="remove" data-id="${esc(c.id)}">Remove</button></div></div>`).join('') || '<div class="sub">Nothing connected in this workspace.</div>'}</div>
      <div class="cols" style="margin-top:14px">${meta.map((m) => `<div class="card"><h2>Add ${esc(m.name)}</h2><form data-kind="${esc(m.kind)}">${m.fields.map((f) => `<label>${esc(f.label)}</label><input name="${esc(f.key)}" ${f.secret ? 'type="password" autocomplete="off"' : ''} placeholder="${esc(f.placeholder || '')}">`).join('')}<div style="margin-top:16px"><button class="primary">Connect &amp; sync</button></div></form>
        <p class="sub" style="margin-top:12px;font-size:12px">Create a long-lived token with <b>ads_read</b> in Meta's developer tools. Lumen only reads — it can't change anything in your account.</p></div>`).join('')}
        <div class="card"><h2>Coming next</h2>${st.boot.connectors.planned.map((p) => `<div class="conn"><div><b>${esc(p.name)}</b><div class="sub" style="margin:2px 0 0">${esc(p.note)}</div></div><span class="pill planned">planned</span></div>`).join('')}</div></div></div>`;

    $('#main').onclick = async (e) => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      const id = b.dataset.id; b.disabled = true;
      try {
        if (b.dataset.a === 'test') { const r = await lumen.testConnection(id); toast('Connected: ' + r.detail); }
        if (b.dataset.a === 'sync') { const r = await lumen.syncConnection(id, 90); toast(`Synced ${r.rows} rows`); }
        if (b.dataset.a === 'remove' && confirm('Remove this source and the data it brought in?')) { await lumen.removeConnection(id); toast('Removed'); }
      } catch (err) { toast(err.message.slice(0, 120)); }
      connections();
    };
    document.querySelectorAll('form[data-kind]').forEach((f) => f.onsubmit = async (e) => {
      e.preventDefault(); const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Connecting…';
      const cfg = Object.fromEntries(new FormData(f).entries()); let id;
      try {
        id = await lumen.addConnection(st.ws, f.dataset.kind, null, cfg);
        await lumen.testConnection(id);
        await lumen.syncConnection(id, 90);
        toast('Connected and synced');
      } catch (err) { toast(err.message.slice(0, 140)); }
      connections();
    });
  }

  // ---------- Settings ----------
  async function settings() {
    const b = st.boot;
    $('#main').innerHTML = `<div class="wrap"><h1>Settings</h1><p class="sub">Everything stays on this computer.</p><div class="cols">
      <div class="card"><h2>Appearance</h2><div class="seg" id="theme">${['system', 'light', 'dark'].map((t) => `<button data-t="${t}" class="${t === b.theme ? 'on' : ''}">${t}</button>`).join('')}</div>
        <h2 style="margin-top:24px">Workspaces</h2><div class="row"><input id="wsName" placeholder="New workspace name"><button class="soft" id="wsAdd">Add</button></div>
        <div class="row" style="margin-top:10px"><button class="soft" id="wsRen">Rename current</button><button class="ghost danger" id="wsDel">Delete current</button></div></div>
      <div class="card"><h2>AI</h2>
        <label>Anthropic API key ${b.keys.anthropic ? '<span class="pill ok">saved</span>' : ''}</label><input id="kA" type="password" autocomplete="off" placeholder="${b.keys.anthropic ? 'Saved — paste a new one to replace' : 'sk-ant-…'}">
        <label>Model</label><input id="model" value="${esc(b.model)}">
        <label>OpenAI API key (for image generation, later) ${b.keys.openai ? '<span class="pill ok">saved</span>' : ''}</label><input id="kO" type="password" autocomplete="off" placeholder="${b.keys.openai ? 'Saved — paste a new one to replace' : 'sk-…'}">
        <div style="margin-top:16px" class="row"><button class="primary" id="saveAi">Save</button><button class="ghost danger" id="clearKeys">Clear keys</button></div></div></div></div>`;
    $('#theme').onclick = async (e) => { const t = e.target.dataset.t; if (!t) return; await lumen.setTheme(t); b.theme = t; applyTheme(t); settings(); };
    $('#wsAdd').onclick = async () => { const n = $('#wsName').value.trim(); if (!n) return; st.ws = await lumen.addWorkspace(n); await refreshBoot(); toast('Workspace created'); show('connections'); };
    $('#wsRen').onclick = async () => { const n = prompt('Rename workspace', (b.workspaces.find((w) => w.id === st.ws) || {}).name); if (n && n.trim()) { await lumen.renameWorkspace(st.ws, n); await refreshBoot(); settings(); } };
    $('#wsDel').onclick = async () => { if (!confirm('Delete this workspace and all its data?')) return; await lumen.removeWorkspace(st.ws); await refreshBoot(); st.ws = st.boot.active; renderWs(); settings(); };
    $('#saveAi').onclick = async () => {
      try {
        if ($('#kA').value.trim()) await lumen.setKey('anthropic', $('#kA').value);
        if ($('#kO').value.trim()) await lumen.setKey('openai', $('#kO').value);
        await lumen.setModel($('#model').value); await refreshBoot(); toast('Saved'); settings();
      } catch (e) { toast(e.message); }
    };
    $('#clearKeys').onclick = async () => { await lumen.setKey('anthropic', ''); await lumen.setKey('openai', ''); await refreshBoot(); toast('Keys cleared'); settings(); };
  }

  async function refreshBoot() { st.boot = await lumen.bootstrap(); if (!st.boot.workspaces.find((w) => w.id === st.ws)) st.ws = st.boot.active; renderWs(); }

  // ---------- Ask panel ----------
  function logMsg(role, text) { const d = document.createElement('div'); d.className = 'msg ' + role; d.textContent = text; $('#askLog').append(d); $('#askLog').scrollTop = 1e9; return d; }
  $('#askBtn').onclick = () => { const a = $('#ask'); a.hidden = !a.hidden; if (!a.hidden) $('#askInput').focus(); };
  $('#askClose').onclick = () => { $('#ask').hidden = true; };
  $('#askInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#askForm').requestSubmit(); } });
  $('#askForm').onsubmit = async (e) => {
    e.preventDefault(); const q = $('#askInput').value.trim(); if (!q || st.busy) return;
    $('#askInput').value = ''; logMsg('user', q); st.busy = true; const wait = logMsg('bot', 'Thinking…');
    try {
      const to = st.boot.today, from = addDays(to, -(st.range - 1));
      const a = await lumen.ask({ question: q, history: st.chat, ws: st.ws, from, to });
      wait.textContent = a; st.chat.push({ role: 'user', text: q }, { role: 'assistant', text: a });
    } catch (err) { wait.className = 'msg err'; wait.textContent = err.message; }
    st.busy = false;
  };

  $('#ws').onchange = async (e) => { st.ws = e.target.value; await lumen.setActive(st.ws); st.chat = []; $('#askLog').innerHTML = ''; show(st.view); };
  document.querySelectorAll('#rail [data-view]').forEach((b) => b.onclick = () => show(b.dataset.view));
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (st.view === 'overview' && st.sum) Charts.daily($('#chart'), st.sum.series, fmt); }, 120); });
  init().catch((e) => { $('#main').textContent = e.message; });
})();
