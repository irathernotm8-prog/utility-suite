(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { boot: null, ws: null, view: 'overview', range: 30, sort: { k: 'spend', dir: -1 }, sum: null, chat: [], busy: false, guide: 'start', cal: null, posts: [], canPost: false };

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
    try { await ({ overview, calendar, analytics, connections, guide, settings })[view](); } catch (e) { $('#main').innerHTML = `<div class="wrap"><div class="note">${esc(e.message)}</div></div>`; }
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
    meta: 'Needs the ad account ID and a token with ads_read.', 'meta-pages': 'Needs your Page ID and a token that can post to the Page and its Instagram account.', 'google-ads': 'Needs a developer token and your customer ID. Sign in to Google first.',
    ga4: 'Needs the numeric property ID. Sign in to Google first.', youtube: 'Nothing to type. Sign in with the account that owns the channel.',
    salesforce: 'Runs the reports you list. Needs an app with the client-credentials flow.'
  };
  const GROUPS = [['ads', 'Advertising'], ['publishing', 'Posting']];
  const isAdv = (m) => m.google || m.category === 'crm';

  async function connections() {
    const list = await lumen.connections(st.ws);
    const meta = st.boot.connectors.ready, g = st.boot.google;
    const fieldHtml = (f, vals = {}, has = {}) => `<label>${esc(f.label)}</label><input name="${esc(f.key)}" ${f.secret ? 'type="password" autocomplete="off"' : ''} value="${f.secret ? '' : esc(vals[f.key] || '')}" placeholder="${f.secret && has[f.key] ? 'Saved — leave blank to keep' : esc(f.placeholder || '')}">`;
    const googleCard = `<div class="card"><div class="row between"><h2>Google sign-in</h2><span class="pill ${g.signedIn ? 'ok' : 'new'}">${g.signedIn ? 'signed in' : g.hasClient ? 'ready to sign in' : 'not set up'}</span></div>
      <p class="sub" style="margin-bottom:6px">One sign-in for Analytics, Google Ads and YouTube.</p>
      ${g.signedIn ? '<div class="row"><button class="soft" data-g="out">Sign out</button><button class="ghost" data-g="guide">Setup guide</button></div>' : `<form id="gClient">${fieldHtml({ key: 'clientId', label: 'OAuth client ID', placeholder: '…apps.googleusercontent.com' }, { clientId: st.googleClientId || '' })}${fieldHtml({ key: 'clientSecret', label: 'OAuth client secret', secret: true }, {}, { clientSecret: g.hasClient })}
        <div class="row" style="margin-top:16px"><button class="soft" data-g="save">Save</button><button class="primary" type="button" data-g="in" ${g.hasClient ? '' : 'disabled'}>Sign in with Google</button><button class="ghost" type="button" data-g="guide">Setup guide</button></div></form>`}</div>`;
    const connCard = (c) => { const m = meta.find((x) => x.kind === c.kind) || { fields: [] };
      return `<div class="conn-wrap"><div class="conn"><div><b>${esc(c.label)}</b> <span class="pill ${esc(c.status)}">${esc(c.status === 'ok' ? (c.kind === 'meta-pages' ? 'connected' : 'synced') : c.status)}</span>
        <div class="sub" style="margin:2px 0 0">${c.kind === 'meta-pages' ? (c.status === 'ok' ? 'Ready to post from the Calendar' : 'Not checked yet') : c.last_sync ? 'Last sync ' + esc(new Date(c.last_sync).toLocaleString()) : 'Not synced yet'}</div>${c.last_error ? `<div class="err">${esc(c.last_error)}</div>` : ''}</div>
        <div class="row">${c.kind !== 'demo' ? `<button class="soft" data-a="test" data-id="${esc(c.id)}">Test</button>` : ''}${m.fields.length ? `<button class="soft" data-a="edit" data-id="${esc(c.id)}">Edit</button>` : ''}${c.kind === 'meta-pages' ? '' : `<button class="soft" data-a="sync" data-id="${esc(c.id)}">Sync 90d</button>`}<button class="ghost danger" data-a="remove" data-id="${esc(c.id)}">Remove</button></div></div>
        ${m.fields.length ? `<form class="editform" data-edit="${esc(c.id)}" hidden>${m.fields.map((f) => fieldHtml(f, c.config, c.hasSecret)).join('')}<div style="margin:14px 0 4px"><button class="primary">Save changes</button></div></form>` : ''}</div>`; };
    const addCard = (m) => { const need = m.google && !g.signedIn;
      return `<div class="card"><h2>Add ${esc(m.name)}</h2><p class="sub" style="font-size:12px;margin-bottom:0">${esc(BLURB[m.kind] || '')}</p><form data-kind="${esc(m.kind)}">${m.fields.map((f) => fieldHtml(f)).join('')}
        <div class="row" style="margin-top:16px"><button class="primary" ${need ? 'disabled' : ''}>${need ? 'Sign in to Google first' : 'Connect &amp; sync'}</button><button class="ghost" type="button" data-guide="${esc(m.kind)}">How?</button></div></form></div>`; };

    $('#main').innerHTML = `<div class="wrap"><div class="row between"><div><h1>Sources</h1><p class="sub">Where Lumen pulls numbers from. Secrets are encrypted with your computer's keychain and never shown again.</p></div><button class="soft" id="syncAll">Sync all</button></div>
      <div class="card"><h2>Connected</h2>${list.map(connCard).join('') || '<div class="sub">Nothing connected in this workspace.</div>'}</div>
      ${GROUPS.map(([cat, label]) => { const ms = meta.filter((m) => m.category === cat && !isAdv(m)); return ms.length ? `<h2 class="sec">${label}</h2><div class="cols">${ms.map(addCard).join('')}</div>` : ''; }).join('')}
      <details class="adv" ${list.some((c) => meta.some((m) => m.kind === c.kind && isAdv(m))) || g.hasClient ? 'open' : ''}><summary>More sources: Google and Salesforce (advanced setup)</summary>
        <div style="margin:14px 0">${googleCard}</div><div class="cols">${meta.filter(isAdv).map(addCard).join('')}</div></details>
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

  // ---------- Calendar ----------
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = (n) => String(n).padStart(2, '0');
  const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const localInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${dkey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const clockShort = (iso) => { const d = new Date(iso), h = d.getHours() % 12 || 12; return h + (d.getMinutes() ? ':' + pad(d.getMinutes()) : '') + (d.getHours() < 12 ? 'a' : 'p'); };
  const whenFull = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const PLAT = { facebook: 'Facebook', instagram: 'Instagram' };
  const STATUS = { draft: 'Draft', scheduled: 'Scheduled', published: 'Posted', partial: 'Partly posted', failed: 'Needs attention' };
  const needsAttention = (p) => ['failed', 'partial'].includes(p.status) || (p.results.facebook && p.results.facebook.overdue && p.status === 'scheduled');
  const dots = (p) => p.platforms.map((x) => `<i class="pd ${x}" title="${PLAT[x]}"></i>`).join('');

  async function calendar() {
    if (!st.ws) { $('#main').innerHTML = '<div class="wrap empty">Create a workspace to begin.</div>'; return; }
    const [posts, conns] = await Promise.all([lumen.posts(st.ws), lumen.connections(st.ws)]);
    st.posts = posts; st.canPost = conns.some((c) => c.kind === 'meta-pages');
    const now = new Date(), cal = st.cal || (st.cal = { y: now.getFullYear(), m: now.getMonth() });
    const first = new Date(cal.y, cal.m, 1), start = new Date(cal.y, cal.m, 1 - first.getDay()), todayKey = dkey(now);
    const byDay = {};
    for (const p of posts) if (p.scheduled_at) (byDay[dkey(new Date(p.scheduled_at))] = byDay[dkey(new Date(p.scheduled_at))] || []).push(p);
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), k = dkey(d), list = byDay[k] || [];
      cells += `<div class="day ${d.getMonth() === cal.m ? '' : 'other'} ${k === todayKey ? 'today' : ''}" data-day="${k}"><span class="dn">${d.getDate()}</span>
        ${list.slice(0, 3).map((p) => `<button class="chip-post s-${p.status}" data-post="${esc(p.id)}">${dots(p)}<span title="${esc(clock(p.scheduled_at) + ' · ' + (p.body || p.link || 'Photo post').slice(0, 80))}">${esc(clockShort(p.scheduled_at))} ${esc((p.body || p.link || 'Photo post').slice(0, 24))}</span></button>`).join('')}${list.length > 3 ? `<span class="more">+${list.length - 3} more</span>` : ''}</div>`;
    }
    const upcoming = posts.filter((p) => p.status === 'scheduled' && p.scheduled_at).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).slice(0, 5);
    const attention = posts.filter(needsAttention), drafts = posts.filter((p) => p.status === 'draft');
    const row = (p) => `<button class="prow" data-post="${esc(p.id)}"><span>${dots(p)}</span><span class="pt">${esc((p.body || p.link || 'Photo post').slice(0, 60))}</span><span class="pw">${p.scheduled_at ? esc(whenFull(p.scheduled_at)) : 'No date yet'}</span></button>`;
    $('#main').innerHTML = `<div class="wrap"><div class="row between"><div><h1>Calendar</h1><p class="sub">Plan, schedule and publish to Facebook and Instagram.</p></div><button class="primary" id="newPost">New post</button></div>
      ${st.canPost ? '' : '<div class="note">You can plan drafts now. To publish, connect <b>Facebook &amp; Instagram posting</b> in Sources (the Guide shows how).</div>'}
      <div class="calwrap"><div class="card cal"><div class="row between calhead"><h2>${MONTHS[cal.m]} ${cal.y}</h2><div class="row"><button class="soft" id="calPrev" aria-label="Previous month">‹</button><button class="soft" id="calToday">Today</button><button class="soft" id="calNext" aria-label="Next month">›</button></div></div>
        <div class="dow">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((x) => `<span>${x}</span>`).join('')}</div><div class="days">${cells}</div></div>
      <div class="side">
        ${attention.length ? `<div class="card attn"><h2>Needs attention</h2>${attention.map(row).join('')}</div>` : ''}
        <div class="card"><h2>Up next</h2>${upcoming.map(row).join('') || '<div class="sub" style="margin:0">Nothing scheduled.</div>'}</div>
        <div class="card"><h2>Drafts</h2>${drafts.map(row).join('') || '<div class="sub" style="margin:0">No drafts.</div>'}</div></div></div></div>`;
    const go = (dm) => { cal.m += dm; if (cal.m < 0) { cal.m = 11; cal.y--; } if (cal.m > 11) { cal.m = 0; cal.y++; } calendar(); };
    $('#calPrev').onclick = () => go(-1); $('#calNext').onclick = () => go(1); $('#calToday').onclick = () => { st.cal = null; calendar(); };
    $('#newPost').onclick = () => composer(null);
    $('#main').onclick = (e) => {
      const pb = e.target.closest('[data-post]'); if (pb) return composer(posts.find((p) => p.id === pb.dataset.post));
      const dd = e.target.closest('[data-day]'); if (dd) { const [y, m, d] = dd.dataset.day.split('-').map(Number); const t = new Date(y, m - 1, d, 10, 0); if (t < Date.now()) t.setTime(Date.now() + 3600e3 - (Date.now() % 3600e3)); composer(null, t.toISOString()); }
    };
  }

  function composer(post, presetIso) {
    const p = post || { id: null, body: '', link: '', media_path: '', media_url: '', platforms: ['facebook'], scheduled_at: presetIso || new Date(Date.now() + 3600e3 - (Date.now() % 3600e3) + 3600e3).toISOString(), status: 'draft', results: {} };
    const locked = p.status === 'scheduled', done = p.status === 'published';
    const m = $('#modal'); m.hidden = false;
    const res = p.platforms.map((x) => { const r = p.results[x]; if (!r) return ''; return `<div class="res ${esc(r.status)}"><b>${PLAT[x]}</b> ${esc(({ published: 'posted', scheduled: r.native ? 'scheduled with Meta' : 'scheduled', queued: 'waiting for its time (Lumen must be open)', failed: 'failed', missed: 'missed' })[r.status] || r.status)}${r.url ? ` · <a href="#" data-open="${esc(r.url)}">View ↗</a>` : ''}${r.error ? `<div class="err">${esc(r.error)}</div>` : ''}${r.overdue ? '<div class="err">This was due a while ago. Check Facebook to confirm it went out.</div>' : ''}</div>`; }).join('');
    m.innerHTML = `<div class="sheet" role="dialog" aria-label="Post"><div class="row between"><h2>${post ? 'Post' : 'New post'} <span class="pill ${p.status === 'published' ? 'ok' : p.status === 'failed' || p.status === 'partial' ? 'error' : 'new'}">${esc(STATUS[p.status] || p.status)}</span></h2><button class="ghost" id="mClose" aria-label="Close">✕</button></div>
      <fieldset ${locked || done ? 'disabled' : ''}><label>Post to</label><div class="row" id="plats">${Object.entries(PLAT).map(([k, v]) => `<label class="tog"><input type="checkbox" value="${k}" ${p.platforms.includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}</div>
        <label>Text</label><textarea id="pBody" rows="5" placeholder="What do you want to say?">${esc(p.body)}</textarea><div class="sub cnt" id="cnt"></div>
        <details id="aiBox"><summary>Draft captions with AI</summary><div class="aibox"><input id="brief" placeholder="What is the post about? (facts only; the AI won’t invent offers)"><div class="row" style="margin-top:8px"><button class="soft" type="button" id="draftBtn">Draft 3 options</button><span class="sub" id="draftMsg" style="margin:0"></span></div><div id="opts"></div></div></details>
        <label>Link (Facebook)</label><input id="pLink" value="${esc(p.link)}" placeholder="https://…">
        <label>Photo ${'<span class="sub" style="font-size:11px">JPEG; Instagram requires one</span>'}</label><div class="row"><button class="soft" type="button" id="pick">Choose photo…</button><button class="ghost" type="button" id="unpick" ${p.media_path ? '' : 'hidden'}>Remove</button><span class="sub" id="mname" style="margin:0"></span></div><img id="thumb" class="thumb" alt="" hidden>
        <details><summary>Or use a public image URL</summary><input id="pUrl" value="${esc(p.media_url)}" placeholder="https://… .jpg"></details>
        <label>Date &amp; time</label><input type="datetime-local" id="pWhen" value="${localInput(p.scheduled_at)}"><div class="sub" id="whenHint"></div></fieldset>
      ${res ? `<div class="results">${res}</div>` : ''}
      <div class="row end">${post && !done ? '<button class="ghost danger" id="del">Delete</button>' : ''}<span class="grow"></span>
        ${locked ? '<button class="soft" id="unsched">Unschedule to edit</button><button class="primary" id="now">Post now</button>' : done ? '<button class="soft" id="mClose2">Close</button>' : '<button class="soft" id="saveDraft">Save draft</button><button class="soft" id="sched">Schedule</button><button class="primary" id="now">Post now</button>'}</div></div>`;
    const close = () => { m.hidden = true; m.innerHTML = ''; if (st.view === 'calendar') calendar(); };
    const pb = $('#pBody', m); let media = p.media_path;
    const hint = () => {
      const t = $('#pWhen', m).value ? new Date($('#pWhen', m).value).getTime() : NaN, lead = t - Date.now(), plats = [...m.querySelectorAll('#plats input:checked')].map((x) => x.value), out = [];
      if (plats.includes('facebook')) out.push(lead >= 11 * 60e3 && lead <= 29 * 864e5 ? 'Facebook: Meta will publish this, even if Lumen is closed.' : 'Facebook: Lumen publishes this at the time, so keep Lumen open.');
      if (plats.includes('instagram')) out.push('Instagram: Lumen publishes this at the time, so keep Lumen open.');
      $('#whenHint', m).textContent = out.join(' ');
      $('#cnt', m).textContent = `${pb.value.length} characters${plats.includes('instagram') ? ' · Instagram allows up to 2,200' : ''}`;
    };
    const showThumb = async () => { const im = $('#thumb', m); $('#unpick', m).hidden = !media; if (!media) { im.hidden = true; $('#mname', m).textContent = ''; return; } try { im.src = await lumen.mediaThumb(media); im.hidden = false; $('#mname', m).textContent = 'Photo added'; } catch (_) { im.hidden = true; } };
    const gather = () => ({ id: p.id, body: pb.value, link: $('#pLink', m).value, media_path: media, media_url: $('#pUrl', m).value, platforms: [...m.querySelectorAll('#plats input:checked')].map((x) => x.value), scheduled_at: $('#pWhen', m).value ? new Date($('#pWhen', m).value).toISOString() : null });
    const act = async (btn, fn, okMsg) => { btn.disabled = true; try { const r = await fn(); toast(okMsg(r)); close(); } catch (err) { toast(err.message.slice(0, 160)); btn.disabled = false; } };
    hint(); showThumb();
    m.oninput = hint;
    $('#mClose', m).onclick = close; if ($('#mClose2', m)) $('#mClose2', m).onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); const o = e.target.closest('[data-open]'); if (o) { e.preventDefault(); lumen.open(o.dataset.open); } };
    $('#pick', m).onclick = async () => { try { const r = await lumen.pickMedia(); if (r) { media = r.path; await showThumb(); } } catch (err) { toast(err.message); } };
    $('#unpick', m).onclick = () => { media = ''; showThumb(); };
    $('#draftBtn', m).onclick = async () => {
      const b = $('#draftBtn', m); b.disabled = true; $('#draftMsg', m).textContent = 'Drafting…';
      try {
        const opts = await lumen.draftCaptions({ ws: st.ws, brief: $('#brief', m).value, platforms: gather().platforms.length ? gather().platforms : ['facebook'] });
        $('#draftMsg', m).textContent = ''; const box = $('#opts', m); box.innerHTML = opts.map((o, i) => `<div class="opt"><div>${esc(o)}</div><button class="soft" type="button" data-use="${i}">Use this</button></div>`).join('');
        box.onclick = (e) => { const u = e.target.closest('[data-use]'); if (u) { pb.value = opts[+u.dataset.use]; hint(); } };
      } catch (err) { $('#draftMsg', m).textContent = err.message.slice(0, 140); }
      b.disabled = false;
    };
    if ($('#saveDraft', m)) $('#saveDraft', m).onclick = (e) => act(e.target, () => lumen.savePost(st.ws, gather()), () => 'Draft saved');
    if ($('#sched', m)) $('#sched', m).onclick = (e) => act(e.target, async () => { const s = await lumen.savePost(st.ws, gather()); return lumen.schedulePost(s.id); }, () => 'Scheduled');
    if ($('#unsched', m)) $('#unsched', m).onclick = (e) => act(e.target, () => lumen.unschedulePost(p.id), () => 'Unscheduled');
    if ($('#now', m)) $('#now', m).onclick = (e) => {
      const g = locked ? p : gather(); if (!confirm(`Post to ${g.platforms.map((x) => PLAT[x]).join(' and ') || 'nothing selected'} right now?`)) return;
      act(e.target, async () => { const s = locked ? p : await lumen.savePost(st.ws, g); return lumen.publishPostNow(s.id); }, (r) => (r.status === 'published' ? 'Posted' : r.status === 'partial' ? 'Posted to some platforms; see details' : 'Not posted; see details'));
    };
    if ($('#del', m)) $('#del', m).onclick = (e) => { if (confirm('Delete this post?')) act(e.target, () => lumen.deletePost(p.id), () => 'Deleted'); };
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
  if (window.lumen.onPostsChanged) lumen.onPostsChanged(() => { if (st.view === 'calendar' && $('#modal').hidden) calendar(); });
  init().catch((e) => { $('#main').textContent = e.message; });
})();
