(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { boot: null, ws: null, view: 'overview', range: 30, sort: { k: 'spend', dir: -1 }, sum: null, chat: [], busy: false, guide: 'start' };

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
    try { await ({ overview, analytics, connections, guide, settings })[view](); } catch (e) { $('#main').innerHTML = `<div class="wrap"><div class="note">${esc(e.message)}</div></div>`; }
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

  // ---------- Analytics ----------
  const tableHtml = (cols, rows, note) => `<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>${note || ''}`;
  const chg = (cur, prev, good = true) => {
    if (!prev) return '<span class="d flat">no prior period</span>';
    const pc = ((cur - prev) / prev) * 100; if (Math.abs(pc) < 0.5) return '<span class="d flat">flat vs previous</span>';
    const up = pc > 0; return `<span class="d ${up === good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${Math.abs(pc).toFixed(1)}% vs previous ${st.range}d</span>`;
  };
  const kpiCard = (l, v, d, i) => `<div class="card kpi"><div class="l">${l}</div><div class="v">${v}</div>${d}<div class="sp" data-i="${i}"></div></div>`;

  async function analytics() {
    const main = $('#main');
    if (!st.ws) { main.innerHTML = '<div class="wrap empty">Create a workspace to begin.</div>'; return; }
    const to = st.boot.today, from = addDays(to, -(st.range - 1));
    const [a, ad, conns] = await Promise.all([lumen.analytics(st.ws, from, to), lumen.summary(st.ws, from, to), lumen.connections(st.ws)]);
    const has = (k) => conns.some((c) => c.kind === k);
    const sparks = [];
    let html = `<div class="wrap"><div class="row between"><div><h1>Analytics</h1><p class="sub">What happened after the click · ${esc(from)} → ${esc(to)}</p></div>
      <div class="seg" id="range">${[7, 30, 90].map((r) => `<button data-r="${r}" class="${r === st.range ? 'on' : ''}">${r}d</button>`).join('')}</div></div>`;
    if (!has('ga4') && !has('youtube') && !has('salesforce')) html += `<div class="card empty">Nothing here yet.<br>Connect Google Analytics, YouTube or Salesforce in <b>Sources</b>. The <b>Guide</b> walks through each one.</div>`;

    // GA4
    const g = a.ga4, gm = g.metrics;
    if (has('ga4')) {
      html += `<h2 class="sec">Google Analytics 4</h2>`;
      if (!gm.sessions) html += '<div class="note">No GA4 data in this window yet. Sync it in Sources.</div>';
      else {
        const k = [['Sessions', 'sessions', fmt.num], ['Engaged sessions', 'engaged_sessions', fmt.num], ['Key events', 'key_events', fmt.num], ['Revenue', 'revenue', fmt.money]].filter(([, m]) => gm[m] && (m !== 'revenue' || gm[m].total > 0));
        html += `<div class="kpis">${k.map(([l, m, f]) => kpiCard(l, f(gm[m].total), chg(gm[m].total, gm[m].previous), sparks.push({ vals: gm[m].daily.map((d) => d.value), color: 'var(--c1)' }) - 1)).join('')}</div>`;
        const daily = gm.sessions.daily.map((d, i) => ({ date: d.date, sessions: d.value, key_events: gm.key_events ? gm.key_events.daily[i].value : 0 }));
        const matched = (g.dims.campaign_key_events || []).map((c) => { const hit = ad.campaigns.find((x) => x.name.toLowerCase() === c.dim.toLowerCase()); const sess = (g.dims.campaign_sessions || []).find((x) => x.dim === c.dim); return [c.dim, fmt.num(sess ? sess.total : 0), fmt.num(c.total), hit ? fmt.num(hit.conversions) : '—']; });
        html += `<div class="grid2"><div class="card"><div class="row between"><h2>Sessions &amp; key events</h2><div class="legend"><span><i style="background:var(--c1)"></i>Sessions</span><span><i style="background:var(--c2)"></i>Key events</span></div></div><div class="chartbox" id="gaChart"></div></div>
          <div class="card"><h2>Sessions by channel</h2>${tableHtml(['Channel', 'Sessions'], (g.dims.sessions || []).slice(0, 8).map((x) => [x.dim, fmt.num(x.total)]))}</div></div>`;
        html += `<div class="card" style="margin-bottom:14px"><h2>Campaign check: GA4 vs ad platforms</h2>${matched.length ? tableHtml(['GA4 campaign (utm_campaign)', 'Sessions', 'GA4 key events', 'Ad platform conversions'], matched.slice(0, 15), '<p class="sub" style="margin:10px 0 0;font-size:12px">Matched by campaign name. A “—” means no ad campaign has exactly that name. Small gaps are normal; the two systems count differently.</p>') : '<div class="sub">No tagged campaigns yet. Add utm_campaign to your ad links so GA4 can tell them apart.</div>'}</div>`;
        sparks.gaDaily = daily;
      }
    }

    // YouTube
    const y = a.youtube, ym = y.metrics;
    if (has('youtube')) {
      html += `<h2 class="sec">YouTube</h2>`;
      if (!ym.views) html += '<div class="note">No YouTube data in this window yet. Sync it in Sources.</div>';
      else {
        const net = ym.subs_gained.daily.map((d, i) => ({ date: d.date, value: d.value - (ym.subs_lost ? ym.subs_lost.daily[i].value : 0) }));
        const netT = net.reduce((s, x) => s + x.value, 0);
        const k = [['Views', ym.views.total, chg(ym.views.total, ym.views.previous), ym.views.daily.map((d) => d.value), fmt.num], ['Watch hours', ym.watch_minutes.total / 60, chg(ym.watch_minutes.total, ym.watch_minutes.previous), ym.watch_minutes.daily.map((d) => d.value / 60), fmt.num],
          ['Net subscribers', netT, '<span class="d flat">gained minus lost</span>', net.map((d) => d.value), (n) => (n > 0 ? '+' : '') + fmt.num(n)], ['Likes', ym.likes.total, chg(ym.likes.total, ym.likes.previous), ym.likes.daily.map((d) => d.value), fmt.num]];
        html += `<div class="kpis">${k.map(([l, v, d, vals, f]) => kpiCard(l, f(v), d, sparks.push({ vals, color: 'var(--c2)' }) - 1)).join('')}</div>`;
        sparks.ytDaily = ym.views.daily.map((d, i) => ({ date: d.date, views: d.value, minutes: ym.watch_minutes.daily[i].value }));
        const top = a.snapshots.find((s) => s.source === 'youtube' && s.key === 'top-videos');
        html += `<div class="grid2"><div class="card"><div class="row between"><h2>Views &amp; watch time</h2><div class="legend"><span><i style="background:var(--c1)"></i>Views</span><span><i style="background:var(--c2)"></i>Minutes watched</span></div></div><div class="chartbox" id="ytChart"></div></div>
          <div class="card"><h2>Top videos</h2>${top && top.rows.length ? tableHtml(top.columns.slice(0, 2), top.rows.map((r) => [r[0], fmt.num(r[1])])) : '<div class="sub">No videos in this window.</div>'}</div></div>`;
      }
    }

    // Salesforce
    const sf = a.snapshots.filter((s) => s.source === 'salesforce');
    if (has('salesforce')) {
      html += `<h2 class="sec">Salesforce</h2>`;
      html += sf.length ? sf.map((r) => `<div class="card" style="margin-bottom:14px"><div class="row between"><h2>${esc(r.name)}</h2><span class="sub" style="margin:0;font-size:12px">as of ${esc(new Date(r.fetched_at).toLocaleString())}</span></div>
        ${(r.headline || []).length ? `<div class="chips">${r.headline.map((h) => `<span class="chip"><b>${esc(h.value)}</b> ${esc(h.label)}</span>`).join('')}</div>` : ''}
        ${r.rows.length ? tableHtml(r.columns, r.rows, r.truncated ? '<p class="sub" style="margin:10px 0 0;font-size:12px">Showing the first 200 rows.</p>' : '') : '<div class="sub">This report returned no rows.</div>'}</div>`).join('') : '<div class="note">No report results yet. Sync it in Sources. These are the latest results, not tied to the date range above.</div>';
    }
    html += '</div>';
    main.innerHTML = html;
    document.querySelectorAll('.sp[data-i]').forEach((el) => { const sp = sparks[+el.dataset.i]; if (sp) el.append(Charts.spark(sp.vals, sp.color)); });
    if ($('#gaChart')) Charts.daily($('#gaChart'), sparks.gaDaily, fmt, { a: { key: 'sessions', label: 'Sessions', fmt: fmt.num }, b: { key: 'key_events', label: 'Key events', fmt: fmt.num } });
    if ($('#ytChart')) Charts.daily($('#ytChart'), sparks.ytDaily, fmt, { a: { key: 'views', label: 'Views', fmt: fmt.num }, b: { key: 'minutes', label: 'Minutes watched', fmt: fmt.num } });
    $('#range').onclick = (e) => { const r = +e.target.dataset.r; if (r) { st.range = r; analytics(); } };
  }

  // ---------- Sources ----------
  const BLURB = {
    meta: 'Needs the ad account ID and a token with ads_read.', 'google-ads': 'Needs a developer token and your customer ID. Sign in to Google first.',
    ga4: 'Needs the numeric property ID. Sign in to Google first.', youtube: 'Nothing to type. Sign in with the account that owns the channel.',
    salesforce: 'Runs the reports you list. Needs an app with the client-credentials flow.'
  };
  const GROUPS = [['ads', 'Advertising'], ['analytics', 'Analytics'], ['crm', 'CRM']];

  async function connections() {
    const list = await lumen.connections(st.ws);
    const meta = st.boot.connectors.ready, g = st.boot.google;
    const fieldHtml = (f, vals = {}, has = {}) => `<label>${esc(f.label)}</label><input name="${esc(f.key)}" ${f.secret ? 'type="password" autocomplete="off"' : ''} value="${f.secret ? '' : esc(vals[f.key] || '')}" placeholder="${f.secret && has[f.key] ? 'Saved — leave blank to keep' : esc(f.placeholder || '')}">`;
    const googleCard = `<div class="card"><div class="row between"><h2>Google sign-in</h2><span class="pill ${g.signedIn ? 'ok' : 'new'}">${g.signedIn ? 'signed in' : g.hasClient ? 'ready to sign in' : 'not set up'}</span></div>
      <p class="sub" style="margin-bottom:6px">One sign-in for Analytics, Google Ads and YouTube.</p>
      ${g.signedIn ? '<div class="row"><button class="soft" data-g="out">Sign out</button><button class="ghost" data-g="guide">Setup guide</button></div>' : `<form id="gClient">${fieldHtml({ key: 'clientId', label: 'OAuth client ID', placeholder: '…apps.googleusercontent.com' }, { clientId: st.googleClientId || '' })}${fieldHtml({ key: 'clientSecret', label: 'OAuth client secret', secret: true }, {}, { clientSecret: g.hasClient })}
        <div class="row" style="margin-top:16px"><button class="soft" data-g="save">Save</button><button class="primary" type="button" data-g="in" ${g.hasClient ? '' : 'disabled'}>Sign in with Google</button><button class="ghost" type="button" data-g="guide">Setup guide</button></div></form>`}</div>`;
    const connCard = (c) => { const m = meta.find((x) => x.kind === c.kind) || { fields: [] };
      return `<div class="conn-wrap"><div class="conn"><div><b>${esc(c.label)}</b> <span class="pill ${esc(c.status)}">${esc(c.status === 'ok' ? 'synced' : c.status)}</span>
        <div class="sub" style="margin:2px 0 0">${c.last_sync ? 'Last sync ' + esc(new Date(c.last_sync).toLocaleString()) : 'Not synced yet'}</div>${c.last_error ? `<div class="err">${esc(c.last_error)}</div>` : ''}</div>
        <div class="row">${c.kind !== 'demo' ? `<button class="soft" data-a="test" data-id="${esc(c.id)}">Test</button>` : ''}${m.fields.length ? `<button class="soft" data-a="edit" data-id="${esc(c.id)}">Edit</button>` : ''}<button class="soft" data-a="sync" data-id="${esc(c.id)}">Sync 90d</button><button class="ghost danger" data-a="remove" data-id="${esc(c.id)}">Remove</button></div></div>
        ${m.fields.length ? `<form class="editform" data-edit="${esc(c.id)}" hidden>${m.fields.map((f) => fieldHtml(f, c.config, c.hasSecret)).join('')}<div style="margin:14px 0 4px"><button class="primary">Save changes</button></div></form>` : ''}</div>`; };
    const addCard = (m) => { const need = m.google && !g.signedIn;
      return `<div class="card"><h2>Add ${esc(m.name)}</h2><p class="sub" style="font-size:12px;margin-bottom:0">${esc(BLURB[m.kind] || '')}</p><form data-kind="${esc(m.kind)}">${m.fields.map((f) => fieldHtml(f)).join('')}
        <div class="row" style="margin-top:16px"><button class="primary" ${need ? 'disabled' : ''}>${need ? 'Sign in to Google first' : 'Connect &amp; sync'}</button><button class="ghost" type="button" data-guide="${esc(m.kind)}">How?</button></div></form></div>`; };

    $('#main').innerHTML = `<div class="wrap"><div class="row between"><div><h1>Sources</h1><p class="sub">Where Lumen pulls numbers from. Secrets are encrypted with your computer's keychain and never shown again.</p></div><button class="soft" id="syncAll">Sync all</button></div>
      <div class="card"><h2>Connected</h2>${list.map(connCard).join('') || '<div class="sub">Nothing connected in this workspace.</div>'}</div>
      <div style="margin:14px 0">${googleCard}</div>
      ${GROUPS.map(([cat, label]) => { const ms = meta.filter((m) => m.category === cat); return ms.length ? `<h2 class="sec">${label}</h2><div class="cols">${ms.map(addCard).join('')}</div>` : ''; }).join('')}
      <h2 class="sec">Coming next</h2><div class="card">${st.boot.connectors.planned.map((p) => `<div class="conn"><div><b>${esc(p.name)}</b><div class="sub" style="margin:2px 0 0">${esc(p.note)}</div></div><span class="pill planned">planned</span></div>`).join('')}</div></div>`;

    $('#main').onclick = async (e) => {
      const gb = e.target.closest('[data-g]'), gd = e.target.closest('[data-guide]');
      if (gd) { st.guide = gd.dataset.guide; return show('guide'); }
      if (gb) {
        const act = gb.dataset.g;
        if (act === 'guide') { st.guide = 'google'; return show('guide'); }
        if (act === 'save') { e.preventDefault(); const f = $('#gClient'); try { await lumen.setGoogleClient(f.clientId.value, f.clientSecret.value); st.googleClientId = f.clientId.value.trim(); await refreshBoot(); toast('Saved'); } catch (err) { toast(err.message); } return connections(); }
        if (act === 'in') { gb.disabled = true; gb.textContent = 'Waiting for Google…'; try { await lumen.googleSignIn(); toast('Signed in to Google'); } catch (err) { toast(err.message.slice(0, 140)); } await refreshBoot(); return connections(); }
        if (act === 'out') { await lumen.googleSignOut(); await refreshBoot(); return connections(); }
      }
      if (e.target.id === 'syncAll') { e.target.disabled = true; let ok = 0, bad = 0; for (const c of list) { try { await lumen.syncConnection(c.id, 90); ok++; } catch (_) { bad++; } } toast(`Synced ${ok}${bad ? `, ${bad} failed` : ''}`); return connections(); }
      const b = e.target.closest('button[data-a]'); if (!b) return;
      const id = b.dataset.id;
      if (b.dataset.a === 'edit') { const f = document.querySelector(`form[data-edit="${id}"]`); f.hidden = !f.hidden; return; }
      b.disabled = true;
      try {
        if (b.dataset.a === 'test') { const r = await lumen.testConnection(id); toast('Connected: ' + r.detail); }
        if (b.dataset.a === 'sync') { const r = await lumen.syncConnection(id, 90); toast(r.warning ? 'Synced, with a warning: ' + r.warning.slice(0, 100) : `Synced ${r.rows} rows`); }
        if (b.dataset.a === 'remove' && confirm('Remove this source and the data it brought in?')) { await lumen.removeConnection(id); toast('Removed'); }
      } catch (err) { toast(err.message.slice(0, 120)); }
      connections();
    };
    document.querySelectorAll('form[data-edit]').forEach((f) => f.onsubmit = async (e) => {
      e.preventDefault(); const cfg = Object.fromEntries(new FormData(f).entries());
      try { await lumen.updateConnection(f.dataset.edit, null, cfg); await lumen.testConnection(f.dataset.edit); toast('Saved and tested'); } catch (err) { toast(err.message.slice(0, 140)); }
      connections();
    });
    const gc = $('#gClient'); if (gc) gc.onsubmit = (e) => e.preventDefault();
    document.querySelectorAll('form[data-kind]').forEach((f) => f.onsubmit = async (e) => {
      e.preventDefault(); const btn = f.querySelector('button.primary'); btn.disabled = true; btn.textContent = 'Connecting…';
      const cfg = Object.fromEntries(new FormData(f).entries()); let id;
      try {
        id = await lumen.addConnection(st.ws, f.dataset.kind, null, cfg);
        await lumen.testConnection(id);
        const r = await lumen.syncConnection(id, 90);
        toast(r.warning ? 'Connected. Warning: ' + r.warning.slice(0, 100) : 'Connected and synced');
      } catch (err) { toast(err.message.slice(0, 140)); }
      connections();
    });
  }

  // ---------- Guide ----------
  async function guide() {
    const topics = window.GUIDE, cur = topics.find((t) => t.id === st.guide) || topics[0]; st.guide = cur.id;
    $('#main').innerHTML = `<div class="wrap"><h1>Guide</h1><p class="sub">Step-by-step setup for every source. Screens at Meta, Google and Salesforce change now and then, so the steps say what to look for.</p>
      <div class="guide"><div class="gnav">${topics.map((t) => `<button data-t="${esc(t.id)}" class="${t.id === cur.id ? 'on' : ''}">${esc(t.title)}</button>`).join('')}</div>
      <div class="card gbody"><h2>${esc(cur.title)}</h2><p class="sub">${esc(cur.intro)}</p><ol class="steps">${cur.steps.map(([h, b, link]) => `<li><b>${esc(h)}</b><span>${esc(b)}</span>${link ? `<a href="#" data-open="${esc(link)}">Open ↗</a>` : ''}</li>`).join('')}</ol></div></div></div>`;
    $('#main').onclick = (e) => {
      const t = e.target.closest('[data-t]'); if (t) { st.guide = t.dataset.t; return guide(); }
      const o = e.target.closest('[data-open]'); if (o) { e.preventDefault(); lumen.open(o.dataset.open); }
    };
  }

  // ---------- Settings ----------
  async function settings() {
    const b = st.boot, prov = b.ai.provider, isCli = prov !== 'anthropic';
    $('#main').innerHTML = `<div class="wrap"><h1>Settings</h1><p class="sub">Everything stays on this computer.</p><div class="cols">
      <div class="card"><h2>Appearance</h2><div class="seg" id="theme">${['system', 'light', 'dark'].map((t) => `<button data-t="${t}" class="${t === b.theme ? 'on' : ''}">${t}</button>`).join('')}</div>
        <h2 style="margin-top:24px">Workspaces</h2><div class="row"><input id="wsName" placeholder="New workspace name"><button class="soft" id="wsAdd">Add</button></div>
        <div class="row" style="margin-top:10px"><button class="soft" id="wsRen">Rename current</button><button class="ghost danger" id="wsDel">Delete current</button></div></div>
      <div class="card"><h2>AI</h2>
        <label>Power Ask Lumen with</label><select id="prov">${b.ai.providers.map((p) => `<option value="${esc(p.id)}" ${p.id === prov ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
        ${isCli ? `<p class="sub" style="font-size:12px;margin:8px 0 0">Uses the app you are already signed in to on this computer, so there is no API key and no API credits. Your plan's usage limits apply. See the Guide for setup.</p>
          <label>Model (optional)</label><input id="cliModel" value="${esc(b.ai.cliModel)}" placeholder="Blank uses the app's default">
          <div class="row" style="margin-top:14px"><button class="soft" id="aiCheck">Check install</button><button class="soft" id="aiTest">Send test</button><span class="sub" id="aiOut" style="margin:0"></span></div>`
        : `<label>Anthropic API key ${b.keys.anthropic ? '<span class="pill ok">saved</span>' : ''}</label><input id="kA" type="password" autocomplete="off" placeholder="${b.keys.anthropic ? 'Saved — paste a new one to replace' : 'sk-ant-…'}">
          <label>Model</label><input id="model" value="${esc(b.model)}">`}
        <label>OpenAI API key (for image generation, later) ${b.keys.openai ? '<span class="pill ok">saved</span>' : ''}</label><input id="kO" type="password" autocomplete="off" placeholder="${b.keys.openai ? 'Saved — paste a new one to replace' : 'sk-…'}">
        <div style="margin-top:16px" class="row"><button class="primary" id="saveAi">Save</button><button class="ghost danger" id="clearKeys">Clear keys</button></div></div></div></div>`;
    $('#theme').onclick = async (e) => { const t = e.target.dataset.t; if (!t) return; await lumen.setTheme(t); b.theme = t; applyTheme(t); settings(); };
    $('#wsAdd').onclick = async () => { const n = $('#wsName').value.trim(); if (!n) return; st.ws = await lumen.addWorkspace(n); await refreshBoot(); toast('Workspace created'); show('connections'); };
    $('#wsRen').onclick = async () => { const n = prompt('Rename workspace', (b.workspaces.find((w) => w.id === st.ws) || {}).name); if (n && n.trim()) { await lumen.renameWorkspace(st.ws, n); await refreshBoot(); settings(); } };
    $('#wsDel').onclick = async () => { if (!confirm('Delete this workspace and all its data?')) return; await lumen.removeWorkspace(st.ws); await refreshBoot(); st.ws = st.boot.active; renderWs(); settings(); };
    $('#prov').onchange = async (e) => { await lumen.setProvider(e.target.value); await refreshBoot(); settings(); };
    if (isCli) {
      $('#aiCheck').onclick = async () => { $('#aiOut').textContent = 'Checking…'; const r = await lumen.detectAi(prov); $('#aiOut').textContent = r.installed ? 'Installed' + (r.version ? ' · ' + r.version : '') : 'Not found. Install it and sign in once in Terminal.'; };
      $('#aiTest').onclick = async () => { $('#aiOut').textContent = 'Asking…'; try { $('#aiOut').textContent = 'Replied: ' + await lumen.testAi(); } catch (err) { $('#aiOut').textContent = err.message.slice(0, 160); } };
    }
    $('#saveAi').onclick = async () => {
      try {
        if (isCli) await lumen.setCliModel($('#cliModel').value); else { if ($('#kA').value.trim()) await lumen.setKey('anthropic', $('#kA').value); await lumen.setModel($('#model').value); }
        if ($('#kO').value.trim()) await lumen.setKey('openai', $('#kO').value);
        await refreshBoot(); toast('Saved'); settings();
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
