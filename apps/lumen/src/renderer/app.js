(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { boot: null, ws: null, view: 'overview', range: { preset: '30d' }, syncDays: 90, sort: { k: 'spend', dir: -1 }, sum: null, chat: [], busy: false, guide: 'start', cal: null, posts: [], canPost: false };

  const fmt = {
    money: (n) => '$' + (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : (+n).toFixed(2)),
    compact: (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(Math.round(n))),
    num: (n) => (+n).toLocaleString(undefined, { maximumFractionDigits: 1 }),
    pct: (n) => (+n).toFixed(2) + '%'
  };
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); };
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };


  // ---------- date range (shared by Overview, Analytics and Ask) ----------
  const PRESETS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['14d', 'Last 14 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['mtd', 'This month'], ['lastmonth', 'Last month'], ['ytd', 'This year'], ['custom', 'Custom']];
  const spanOf = (from, to) => Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 864e5) + 1;
  function presetRange(id, t) {
    const monthStart = t.slice(0, 8) + '01';
    switch (id) {
      case 'today': return { from: t, to: t };
      case 'yesterday': return { from: addDays(t, -1), to: addDays(t, -1) };
      case '7d': return { from: addDays(t, -6), to: t };
      case '14d': return { from: addDays(t, -13), to: t };
      case '90d': return { from: addDays(t, -89), to: t };
      case 'mtd': return { from: monthStart, to: t };
      case 'lastmonth': { const end = addDays(monthStart, -1); return { from: end.slice(0, 8) + '01', to: end }; }
      case 'ytd': return { from: t.slice(0, 4) + '-01-01', to: t };
      default: return { from: addDays(t, -29), to: t };
    }
  }
  const getRange = () => (st.range.preset === 'custom' && st.range.from ? { from: st.range.from, to: st.range.to } : presetRange(st.range.preset, st.boot.today));
  const spanDays = () => { const r = getRange(); return spanOf(r.from, r.to); };
  const shortDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: s.slice(0, 4) === st.boot.today.slice(0, 4) ? undefined : 'numeric' });
  function rangePicker() {
    const r = getRange(), label = (PRESETS.find((p) => p[0] === st.range.preset) || PRESETS[4])[1];
    return `<div class="rangepick"><button class="soft rpbtn" id="rpBtn" aria-haspopup="true"><b>${esc(st.range.preset === 'custom' ? 'Custom' : label)}</b> <span>${esc(shortDate(r.from))}${r.from === r.to ? '' : ' – ' + esc(shortDate(r.to))}</span> ▾</button>
      <div class="pop" id="rpPop" hidden><div class="presets">${PRESETS.filter((p) => p[0] !== 'custom').map(([id, l]) => `<button data-p="${id}" class="${id === st.range.preset ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="custom"><label>From</label><input type="date" id="rpFrom" value="${esc(r.from)}" max="${esc(st.boot.today)}"><label>To</label><input type="date" id="rpTo" value="${esc(r.to)}" max="${esc(st.boot.today)}"><div class="err" id="rpErr"></div><button class="primary" id="rpApply" style="margin-top:12px;width:100%">Apply custom range</button></div></div></div>`;
  }
  function wireRange(rerender) {
    const pop = $('#rpPop'); $('#rpBtn').onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; };
    pop.onclick = (e) => { e.stopPropagation(); const p = e.target.closest('[data-p]'); if (p) { st.range = { preset: p.dataset.p }; rerender(); } };
    $('#rpApply').onclick = () => {
      const f = $('#rpFrom').value, t = $('#rpTo').value, err = $('#rpErr');
      if (!f || !t) { err.textContent = 'Pick both dates.'; return; }
      if (f > t) { err.textContent = 'The start date is after the end date.'; return; }
      if (spanOf(f, t) > 1100) { err.textContent = 'Pick a range under three years.'; return; }
      st.range = { preset: 'custom', from: f, to: t }; rerender();
    };
  }
  document.addEventListener('click', () => { const p = $('#rpPop'); if (p) p.hidden = true; });

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
    try { await ({ overview, ads, calendar, analytics, connections, guide, settings })[view](); } catch (e) { $('#main').innerHTML = `<div class="wrap"><div class="note">${esc(e.message)}</div></div>`; }
  }

  // ---------- Overview ----------
  async function overview() {
    const main = $('#main');
    if (!st.ws) { main.innerHTML = '<div class="wrap empty">Create a workspace to begin.</div>'; return; }
    const { from, to } = getRange();
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
      return `<span class="d ${good === null ? 'flat' : good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${Math.abs(pc).toFixed(1)}% vs previous ${s.span} day${s.span === 1 ? '' : 's'}</span>`;
    };
    const maxSpend = Math.max(...s.bySource.map((b) => b.spend), 1);
    const sources = s.bySource.map((b) => `<div class="src"><span>${esc(b.source === 'demo' ? 'Demo data' : b.source)}</span><b>${fmt.money(b.spend)}</b></div><div class="bar"><i style="width:${(b.spend / maxSpend) * 100}%"></i></div>`).join('') || '<div class="sub">No sources yet.</div>';

    main.innerHTML = `<div class="wrap">
      <div class="row between"><div><h1>Overview</h1><p class="sub">${esc(from)} → ${esc(to)}${s.latestData ? ' · latest data ' + esc(s.latestData) : ''}</p></div>
        ${rangePicker()}</div>
      ${s.earliestData && from < s.earliestData ? `<div class="note">Synced data starts ${esc(shortDate(s.earliestData))}. To see earlier days, choose more history under Sources and sync again.</div>` : ''}
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
    wireRange(overview);
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
    const up = pc > 0; return `<span class="d ${up === good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${Math.abs(pc).toFixed(1)}% vs previous ${spanDays()} day${spanDays() === 1 ? '' : 's'}</span>`;
  };
  const kpiCard = (l, v, d, i) => `<div class="card kpi"><div class="l">${l}</div><div class="v">${v}</div>${d}<div class="sp" data-i="${i}"></div></div>`;

  async function analytics() {
    const main = $('#main');
    if (!st.ws) { main.innerHTML = '<div class="wrap empty">Create a workspace to begin.</div>'; return; }
    const { from, to } = getRange();
    const [a, ad, conns] = await Promise.all([lumen.analytics(st.ws, from, to), lumen.summary(st.ws, from, to), lumen.connections(st.ws)]);
    const has = (k) => conns.some((c) => c.kind === k);
    const sparks = [];
    let html = `<div class="wrap"><div class="row between"><div><h1>Analytics</h1><p class="sub">What happened after the click · ${esc(from)} → ${esc(to)}</p></div>
      ${rangePicker()}</div>`;
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
    wireRange(analytics);
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
        <div class="row">${c.kind !== 'demo' ? `<button class="soft" data-a="test" data-id="${esc(c.id)}">Test</button>` : ''}${m.fields.length ? `<button class="soft" data-a="edit" data-id="${esc(c.id)}">Edit</button>` : ''}${c.kind === 'meta-pages' ? '' : `<button class="soft" data-a="sync" data-id="${esc(c.id)}">Sync ${st.syncDays}d</button>`}<button class="ghost danger" data-a="remove" data-id="${esc(c.id)}">Remove</button></div></div>
        ${m.fields.length ? `<form class="editform" data-edit="${esc(c.id)}" hidden>${m.fields.map((f) => fieldHtml(f, c.config, c.hasSecret)).join('')}<div style="margin:14px 0 4px"><button class="primary">Save changes</button></div></form>` : ''}</div>`; };
    const addCard = (m) => { const need = m.google && !g.signedIn;
      return `<div class="card"><h2>Add ${esc(m.name)}</h2><p class="sub" style="font-size:12px;margin-bottom:0">${esc(BLURB[m.kind] || '')}</p><form data-kind="${esc(m.kind)}">${m.fields.map((f) => fieldHtml(f)).join('')}
        <div class="row" style="margin-top:16px"><button class="primary" ${need ? 'disabled' : ''}>${need ? 'Sign in to Google first' : 'Connect &amp; sync'}</button><button class="ghost" type="button" data-guide="${esc(m.kind)}">How?</button></div></form></div>`; };

    $('#main').innerHTML = `<div class="wrap"><div class="row between"><div><h1>Sources</h1><p class="sub">Where Lumen pulls numbers from. Secrets are encrypted with your computer's keychain and never shown again.</p></div><div class="row"><label style="margin:0" for="hist">History</label><select id="hist" style="width:auto">${[30, 90, 180, 365].map((d) => `<option value="${d}" ${d === st.syncDays ? 'selected' : ''}>${d} days</option>`).join('')}</select><button class="soft" id="syncAll">Sync all</button></div></div>
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
      if (e.target.id === 'syncAll') { e.target.disabled = true; let ok = 0, bad = 0; for (const c of list) { try { await lumen.syncConnection(c.id, st.syncDays); ok++; } catch (_) { bad++; } } toast(`Synced ${ok}${bad ? `, ${bad} failed` : ''}`); return connections(); }
      const b = e.target.closest('button[data-a]'); if (!b) return;
      const id = b.dataset.id;
      if (b.dataset.a === 'edit') { const f = document.querySelector(`form[data-edit="${id}"]`); f.hidden = !f.hidden; return; }
      b.disabled = true;
      try {
        if (b.dataset.a === 'test') { const r = await lumen.testConnection(id); toast('Connected: ' + r.detail); }
        if (b.dataset.a === 'sync') { const r = await lumen.syncConnection(id, st.syncDays); toast(r.warning ? 'Synced, with a warning: ' + r.warning.slice(0, 100) : `Synced ${r.rows} rows`); }
        if (b.dataset.a === 'remove' && confirm('Remove this source and the data it brought in?')) { await lumen.removeConnection(id); toast('Removed'); }
      } catch (err) { toast(err.message.slice(0, 120)); }
      connections();
    };
    document.querySelectorAll('form[data-edit]').forEach((f) => f.onsubmit = async (e) => {
      e.preventDefault(); const cfg = Object.fromEntries(new FormData(f).entries());
      try { await lumen.updateConnection(f.dataset.edit, null, cfg); await lumen.testConnection(f.dataset.edit); toast('Saved and tested'); } catch (err) { toast(err.message.slice(0, 140)); }
      connections();
    });
    $('#hist').onchange = (e) => { st.syncDays = +e.target.value; connections(); };
    const gc = $('#gClient'); if (gc) gc.onsubmit = (e) => e.preventDefault();
    document.querySelectorAll('form[data-kind]').forEach((f) => f.onsubmit = async (e) => {
      e.preventDefault(); const btn = f.querySelector('button.primary'); btn.disabled = true; btn.textContent = 'Connecting…';
      const cfg = Object.fromEntries(new FormData(f).entries()); let id;
      try {
        id = await lumen.addConnection(st.ws, f.dataset.kind, null, cfg);
        await lumen.testConnection(id);
        const r = await lumen.syncConnection(id, st.syncDays);
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

  // ---------- Ads manager ----------
  const EFF = { ACTIVE: 'Active', PAUSED: 'Paused', CAMPAIGN_PAUSED: 'Campaign paused', ADSET_PAUSED: 'Ad set paused', WITH_ISSUES: 'Has issues', DISAPPROVED: 'Not approved', PENDING_REVIEW: 'In review', IN_PROCESS: 'Processing', ARCHIVED: 'Archived' };
  const effClass = (e) => (e === 'ACTIVE' ? 'ok' : ['WITH_ISSUES', 'DISAPPROVED'].includes(e) ? 'error' : 'new');
  const curFmt = () => { const c = (st.ads && st.ads.tree && st.ads.tree.account.currency) || 'USD'; try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: c, maximumFractionDigits: 2 }); } catch (_) { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }); } };
  const cm = (n) => (n === null || n === undefined ? '—' : curFmt().format(n));

  // A small confirm / input dialog that returns a promise. fields: [{name,label,type,value,placeholder}]
  function dialog({ title, body = '', fields = [], confirm = 'Confirm', danger = false, typed = null, note = '' }) {
    return new Promise((resolve) => {
      const m = $('#modal2'); m.hidden = false;
      m.innerHTML = `<div class="sheet small" role="dialog" aria-label="${esc(title)}"><h2>${esc(title)}</h2>${body ? `<div class="dbody">${body}</div>` : ''}
        ${fields.map((f) => `<label>${esc(f.label)}</label><input name="${esc(f.name)}" type="${esc(f.type || 'text')}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.step ? `step="${esc(f.step)}"` : ''} ${f.min !== undefined ? `min="${esc(f.min)}"` : ''}>`).join('')}
        ${typed ? `<label>Type <b>${esc(typed)}</b> to confirm</label><input name="__typed" autocomplete="off">` : ''}${note ? `<div class="sub" style="margin:10px 0 0">${esc(note)}</div>` : ''}<div class="err" id="dErr"></div>
        <div class="row end"><span class="grow"></span><button class="ghost" id="dNo">Cancel</button><button class="${danger ? 'primary danger-fill' : 'primary'}" id="dYes" ${typed ? 'disabled' : ''}>${esc(confirm)}</button></div></div>`;
      const done = (v) => { m.hidden = true; m.innerHTML = ''; resolve(v); };
      const first = m.querySelector('input'); if (first) { first.focus(); first.select && first.select(); }
      if (typed) m.querySelector('[name="__typed"]').addEventListener('input', (e) => { $('#dYes', m).disabled = e.target.value.trim() !== String(typed); });
      $('#dNo', m).onclick = () => done(null);
      m.onclick = (e) => { if (e.target === m) done(null); };
      $('#dYes', m).onclick = () => { const v = {}; m.querySelectorAll('input').forEach((i) => { v[i.name] = i.value; }); done(v); };
      m.onkeydown = (e) => { if (e.key === 'Escape') done(null); if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !$('#dYes', m).disabled) $('#dYes', m).click(); };
    });
  }

  const allNodes = () => { const t = st.ads.tree; return [...t.campaigns, ...t.adsets, ...t.ads]; };
  const nodeOf = (id) => allNodes().find((n) => n.id === id);
  const budgetOf = (n) => { if (n.dailyBudget !== null && n.dailyBudget !== undefined) return cm(n.dailyBudget) + '/day'; if (n.lifetimeBudget) return cm(n.lifetimeBudget) + ' lifetime'; return n.kind === 'ad' ? '' : '—'; };
  const sumMetrics = (rows) => rows.reduce((a, r) => ({ spend: a.spend + r.metrics.spend, impressions: a.impressions + r.metrics.impressions, clicks: a.clicks + r.metrics.clicks, conversions: a.conversions + r.metrics.conversions }), { spend: 0, impressions: 0, clicks: 0, conversions: 0 });

  async function ads() {
    const main = $('#main');
    if (!st.ws) { main.innerHTML = '<div class="wrap empty">Create a workspace to begin.</div>'; return; }
    const conns = await lumen.connections(st.ws);
    if (!conns.some((c) => c.kind === 'meta')) { main.innerHTML = '<div class="wrap"><h1>Ads</h1><p class="sub">Manage campaigns, budgets and ads.</p><div class="card empty">Connect <b>Meta Ads</b> in Sources first. The Guide shows how to create the token; for changes it needs the <b>ads_management</b> permission.</div></div>'; return; }
    const { from, to } = getRange();
    st.ads = st.ads || { tab: 'campaigns', open: new Set(), filter: 'all', q: '' };
    main.innerHTML = '<div class="wrap"><h1>Ads</h1><p class="sub">Loading from Meta…</p></div>';
    try { st.ads.tree = await lumen.adsTree(st.ws, from, to, !!st.adsForce); st.adsForce = false; } catch (e) { main.innerHTML = `<div class="wrap"><h1>Ads</h1><div class="note">${esc(e.message)}</div><button class="soft" id="retry">Try again</button></div>`; $('#retry').onclick = () => { st.adsForce = true; ads(); }; return; }
    renderAds();
  }

  function renderAds() {
    const a = st.ads, t = a.tree, { from, to } = getRange(), main = $('#main');
    const q = a.q.trim().toLowerCase(), match = (n) => !q || n.name.toLowerCase().includes(q);
    const stOk = (n) => a.filter === 'all' || (a.filter === 'active' ? n.effective === 'ACTIVE' : n.status === 'PAUSED');
    const camps = t.campaigns.filter((c) => stOk(c) && (match(c) || t.adsets.some((s) => s.campaignId === c.id && match(s)) || t.ads.some((x) => x.campaignId === c.id && match(x))));
    const tot = sumMetrics(t.campaigns);
    const row = (n, depth) => {
      const m = n.metrics, cpr = m.conversions ? m.spend / m.conversions : null, openable = n.kind !== 'ad';
      return `<tr class="ar ${n.kind}" data-id="${esc(n.id)}"><td class="sw"><label class="switch" title="${n.status === 'ACTIVE' ? 'Pause' : 'Turn on'}"><input type="checkbox" data-sw="${esc(n.id)}" ${n.status === 'ACTIVE' ? 'checked' : ''} ${n.status === 'ARCHIVED' ? 'disabled' : ''}><i></i></label></td>
        <td class="nm d${depth}">${openable ? `<button class="tw" data-tw="${esc(n.id)}" aria-label="Expand">${a.open.has(n.id) ? '▾' : '▸'}</button>` : '<span class="tw"></span>'}<span class="nt" title="${esc(n.name)}">${esc(n.name)}</span>
          ${n.kind === 'campaign' && n.objective ? `<span class="tag">${esc(n.objective.replace('OUTCOME_', '').toLowerCase())}</span>` : ''}</td>
        <td><span class="pill ${effClass(n.effective)}">${esc(EFF[n.effective] || n.effective || '')}</span></td><td>${esc(budgetOf(n))}</td><td>${cm(m.spend)}</td><td>${m.impressions.toLocaleString()}</td><td>${m.clicks.toLocaleString()}</td><td>${fmt.num(m.conversions)}</td><td>${cpr === null ? '—' : cm(cpr)}</td>
        <td class="mn"><button class="ghost" data-mn="${esc(n.id)}" aria-label="More actions">⋯</button></td></tr>`;
    };
    let body = '';
    for (const c of camps) {
      body += row(c, 0);
      if (a.open.has(c.id) || q) for (const s of t.adsets.filter((x) => x.campaignId === c.id)) { body += row(s, 1); if (a.open.has(s.id) || q) for (const x of t.ads.filter((y) => y.adsetId === s.id)) body += row(x, 2); }
    }
    main.innerHTML = `<div class="wrap wide"><div class="row between"><div><h1>Ads</h1><p class="sub">${esc(t.account.name)} · ${esc(t.account.currency)} · results for ${esc(shortDate(from))}${from === to ? '' : ' – ' + esc(shortDate(to))} · loaded ${esc(new Date(t.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</p></div>
      <div class="row">${rangePicker()}<button class="soft" id="adsRefresh">Refresh</button><button class="primary" id="newCamp">New campaign</button></div></div>
      <div class="row between" style="margin:6px 0 14px"><div class="seg" id="adsTabs"><button data-t="campaigns" class="${a.tab === 'campaigns' ? 'on' : ''}">Campaigns</button><button data-t="activity" class="${a.tab === 'activity' ? 'on' : ''}">Activity</button></div>
        ${a.tab === 'campaigns' ? `<div class="row"><input id="adsQ" placeholder="Search by name" value="${esc(a.q)}" style="width:220px"><div class="seg" id="adsFilter">${[['all', 'All'], ['active', 'Active'], ['paused', 'Paused']].map(([k, l]) => `<button data-f="${k}" class="${a.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>` : ''}</div>
      <div id="adsBody"></div></div>`;
    wireRange(() => { st.adsForce = false; ads(); });
    $('#adsRefresh').onclick = () => { st.adsForce = true; ads(); };
    $('#newCamp').onclick = () => campaignWizard();
    $('#adsTabs').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) { a.tab = b.dataset.t; renderAds(); } };
    if (a.tab === 'activity') return activityTab();
    $('#adsFilter').onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { a.filter = b.dataset.f; renderAds(); } };
    $('#adsQ').oninput = (e) => { a.q = e.target.value; const pos = e.target.selectionStart; renderAds(); const i = $('#adsQ'); i.focus(); i.setSelectionRange(pos, pos); };
    $('#adsBody').innerHTML = `<div class="card tight"><table class="adtable"><thead><tr><th></th><th>Name</th><th>Delivery</th><th>Budget</th><th>Spend</th><th>Impr.</th><th>Clicks</th><th>Results</th><th>Cost / result</th><th></th></tr></thead>
      <tbody>${camps.length ? `<tr class="tot"><td></td><td class="nm">All campaigns</td><td></td><td></td><td>${cm(tot.spend)}</td><td>${tot.impressions.toLocaleString()}</td><td>${tot.clicks.toLocaleString()}</td><td>${fmt.num(tot.conversions)}</td><td>${tot.conversions ? cm(tot.spend / tot.conversions) : '—'}</td><td></td></tr>${body}` : `<tr><td colspan="10" class="empty">${t.campaigns.length ? 'No campaigns match.' : 'No campaigns yet. Create one with New campaign.'}</td></tr>`}</tbody></table></div>
      <p class="sub" style="font-size:12px">Changes go straight to Meta and are logged under Activity, where most can be undone. Daily budgets are limited to ${cm(t.cap)} (change in Settings). New campaigns are always created paused.</p>`;
    $('#adsBody').onclick = (e) => {
      const tw = e.target.closest('[data-tw]'); if (tw) { const id = tw.dataset.tw; a.open.has(id) ? a.open.delete(id) : a.open.add(id); return renderAds(); }
      const mn = e.target.closest('[data-mn]'); if (mn) { e.stopPropagation(); return openMenu(mn, mn.dataset.mn); }
    };
    $('#adsBody').onchange = (e) => { const sw = e.target.closest('[data-sw]'); if (sw) toggleStatus(sw.dataset.sw, sw.checked, sw); };
  }

  const refreshAds = async () => { st.adsForce = true; await ads(); };
  async function run(fn, okMsg) { try { await fn(); toast(okMsg); } catch (e) { toast(e.message.slice(0, 180)); } await refreshAds(); }

  async function toggleStatus(id, on, box) {
    const n = nodeOf(id), parentBudget = n.kind === 'campaign' ? n : n.kind === 'adset' ? st.ads.tree.campaigns.find((c) => c.id === n.campaignId) : null;
    const spendNote = on ? `This can start spending ${n.dailyBudget !== null ? 'up to ' + cm(n.dailyBudget) + ' per day' : parentBudget && parentBudget.dailyBudget !== null ? 'from its campaign budget of ' + cm(parentBudget.dailyBudget) + ' per day' : 'according to its budget'} as soon as Meta approves it.` : 'It stops delivering right away. You can turn it back on any time.';
    const r = await dialog({ title: `${on ? 'Turn on' : 'Pause'} “${n.name}”?`, body: `<p>${esc(spendNote)}</p>`, confirm: on ? 'Turn on' : 'Pause', danger: on });
    if (!r) { box.checked = !on; return; }
    await run(() => lumen.adsChange(st.ws, id, { status: on ? 'ACTIVE' : 'PAUSED' }, { confirmedActivate: on }), on ? 'Turned on' : 'Paused');
  }

  let openMenuEl = null;
  function openMenu(btn, id) {
    closeMenu(); const n = nodeOf(id); const items = [['rename', 'Rename']];
    if (n.dailyBudget !== null && n.dailyBudget !== undefined) items.push(['budget', 'Edit daily budget']);
    if (n.kind !== 'ad') items.push(['end', 'Edit end date']);
    if (n.kind === 'campaign') items.push(['copy', 'Duplicate (paused)']);
    items.push(['open', 'Open in Ads Manager ↗']); if (n.status !== 'ARCHIVED') items.push(['archive', 'Archive']);
    const m = document.createElement('div'); m.className = 'menu'; m.innerHTML = items.map(([k, l]) => `<button data-k="${k}" class="${k === 'archive' ? 'danger' : ''}">${l}</button>`).join('');
    document.body.append(m); const r = btn.getBoundingClientRect(); m.style.top = Math.min(r.bottom + 4, window.innerHeight - m.offsetHeight - 10) + 'px'; m.style.left = Math.max(8, r.right - m.offsetWidth) + 'px'; openMenuEl = m;
    m.onclick = (e) => { const k = e.target.closest('[data-k]'); if (!k) return; closeMenu(); menuAction(k.dataset.k, n); };
  }
  const closeMenu = () => { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } };
  document.addEventListener('click', closeMenu);

  async function menuAction(k, n) {
    const t = st.ads.tree;
    if (k === 'open') { const acct = t.account.id.replace('act_', ''); return lumen.open(`https://adsmanager.facebook.com/adsmanager/manage/${n.kind === 'campaign' ? 'campaigns' : n.kind === 'adset' ? 'adsets' : 'ads'}?act=${acct}&selected_${n.kind === 'campaign' ? 'campaign' : n.kind === 'adset' ? 'adset' : 'ad'}_ids=${n.id}`); }
    if (k === 'rename') { const r = await dialog({ title: 'Rename', fields: [{ name: 'name', label: 'Name', value: n.name }], confirm: 'Save' }); if (r && r.name.trim() && r.name.trim() !== n.name) await run(() => lumen.adsChange(st.ws, n.id, { name: r.name.trim() }), 'Renamed'); return; }
    if (k === 'budget') {
      const r = await dialog({ title: 'Edit daily budget', body: `<p>Currently <b>${esc(cm(n.dailyBudget))}</b> per day. Lumen won’t set more than <b>${esc(cm(t.cap))}</b>.</p>`, fields: [{ name: 'v', label: 'New daily budget', type: 'number', value: n.dailyBudget, step: '0.01', min: '1' }], confirm: 'Review' });
      if (!r) return; const v = +r.v; if (!(v > 0)) return toast('Enter a budget above zero.');
      if (Math.abs(v - n.dailyBudget) < 0.005) return;
      const big = v > n.dailyBudget * 2 || v >= t.cap * 0.5;
      const c = await dialog({ title: 'Confirm budget change', body: `<p>${esc(n.name)}<br>${esc(cm(n.dailyBudget))} → <b>${esc(cm(v))}</b> per day (${v > n.dailyBudget ? '+' : ''}${Math.round((v / n.dailyBudget - 1) * 100)}%).</p>${big ? '<p class="warn">This is a large change.</p>' : ''}`, confirm: 'Change budget', danger: big, typed: big ? String(v) : null });
      if (c) await run(() => lumen.adsChange(st.ws, n.id, { dailyBudget: v }), 'Budget updated'); return;
    }
    if (k === 'end') {
      const cur = n.endTime ? n.endTime.slice(0, 10) : '';
      const r = await dialog({ title: 'Edit end date', body: n.kind === 'campaign' ? '<p>Sets the campaign stop time.</p>' : '<p>Leave empty to run with no end date.</p>', fields: [{ name: 'd', label: 'Ends on', type: 'date', value: cur, min: st.boot.today }], confirm: 'Save' });
      if (!r) return; let iso = null; if (r.d) { const [y, m, d] = r.d.split('-').map(Number); iso = new Date(y, m - 1, d, 23, 59).toISOString(); }
      if (!iso && n.kind === 'campaign') return toast('A campaign end date can’t be cleared here; change it in Ads Manager.');
      await run(() => lumen.adsChange(st.ws, n.id, { endTime: iso }), iso ? 'End date set' : 'End date cleared'); return;
    }
    if (k === 'copy') { const r = await dialog({ title: `Duplicate “${n.name}”?`, body: '<p>Makes a copy with its ad sets and ads. The copy is created <b>paused</b>.</p>', confirm: 'Duplicate' }); if (r) await run(() => lumen.adsCopy(st.ws, n.id), 'Copy created (paused)'); return; }
    if (k === 'archive') { const r = await dialog({ title: `Archive “${n.name}”?`, body: '<p>It stops delivering and leaves this list. You can restore it in Ads Manager.</p>', confirm: 'Archive', danger: true }); if (r) await run(() => lumen.adsChange(st.ws, n.id, { status: 'ARCHIVED' }), 'Archived'); }
  }

  const summ = (o) => !o ? '' : Object.entries(o).map(([k, v]) => `${({ status: 'Status', name: 'Name', dailyBudget: 'Daily budget', endTime: 'End' })[k] || k}: ${k === 'dailyBudget' && v !== null ? cm(v) : k === 'endTime' ? (v ? new Date(v).toLocaleDateString() : 'none') : v === null ? 'none' : typeof v === 'object' ? '' : v}`).filter(Boolean).join(' · ');
  async function activityTab() {
    const rows = await lumen.adsAudit(st.ws);
    const label = { update: 'Changed', revert: 'Undone', copy: 'Duplicated', create: 'Created' };
    $('#adsBody').innerHTML = `<div class="card tight">${rows.length ? `<table class="adtable act"><thead><tr><th>When</th><th>What</th><th>Item</th><th>Details</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(new Date(r.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</td>
      <td>${esc(label[r.action] || r.action)} ${r.ok ? '' : '<span class="pill error">failed</span>'}${r.reverted ? '<span class="pill new">undone</span>' : ''}</td><td class="nm"><span class="nt">${esc(r.target_name || '')}</span></td>
      <td class="det">${r.ok ? (r.action === 'update' || r.action === 'revert' ? `${esc(summ(r.before))} <b>→</b> ${esc(summ(r.after))}` : r.action === 'create' ? 'Campaign, ad set and ad created paused' : r.action === 'copy' ? 'Paused copy created' : '') : `<span class="err">${esc(r.error || '')}</span>`}</td>
      <td>${r.action === 'update' && r.ok && !r.reverted && r.before ? `<button class="soft" data-undo="${r.id}">Undo</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing yet. Every change Lumen makes to your ads shows up here.</div>'}</div>`;
    $('#adsBody').onclick = async (e) => {
      const u = e.target.closest('[data-undo]'); if (!u) return; const r = rows.find((x) => x.id === +u.dataset.undo); const on = r.before && r.before.status === 'ACTIVE';
      const d = await dialog({ title: 'Undo this change?', body: `<p>${esc(r.target_name)}<br>Restore: ${esc(summ(r.before))}</p>${on ? '<p class="warn">This turns it back on and it can start spending again.</p>' : ''}`, confirm: 'Undo', danger: on });
      if (d) await run(() => lumen.adsRevert(st.ws, r.id, { confirmedActivate: on }), 'Change undone');
    };
  }

  // ----- New campaign wizard -----
  async function campaignWizard() {
    const t = st.ads.tree, o = t.options, m = $('#modal'); m.hidden = false;
    const defaults = await lumen.adsDefaults(st.ws).catch(() => ({}));
    const S = { cities: [], regions: [], zips: [], media: '', results: [] };
    m.innerHTML = `<div class="sheet wiz" role="dialog" aria-label="New campaign"><div class="row between"><h2>New campaign</h2><button class="ghost" id="wClose" aria-label="Close">✕</button></div>
      <p class="sub" style="margin:-4px 0 10px">Creates one campaign, one ad set and one ad. Everything starts <b>paused</b>; nothing spends until you turn it on.</p>
      <details class="aibox-d" open><summary>Draft with AI</summary><div class="aibox"><textarea id="wBrief" rows="3" placeholder="Describe the campaign: who it is for, where, what the offer is, budget idea. The AI only uses the facts you give it."></textarea><div class="row" style="margin-top:8px"><button class="soft" type="button" id="wDraft">Fill in the form</button><span class="sub" id="wDraftMsg" style="margin:0"></span></div></div></details>
      <h3>Campaign</h3><label>Name</label><input id="wName"><div class="two"><div><label>Objective</label><select id="wObj">${o.objectives.map((x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('')}</select></div><div><label>Daily budget (${esc(t.account.currency)}, max ${esc(cm(t.cap))})</label><input id="wBudget" type="number" min="1" step="0.01" placeholder="20"></div></div>
      <div id="wPixelRow" hidden><label>Meta Pixel ID (for lead tracking)</label><input id="wPixel" placeholder="Numbers only"></div>
      <div class="two"><div><label>Start date (optional)</label><input id="wStart" type="date" min="${esc(st.boot.today)}"></div><div><label>End date (optional)</label><input id="wEnd" type="date" min="${esc(st.boot.today)}"></div></div>
      <label>Special ad category</label><select id="wSpecial">${o.special.map((x) => `<option value="${x}">${x === 'NONE' ? 'None (most ads)' : x.replace(/_/g, ' ').toLowerCase()}</option>`).join('')}</select><div class="sub" id="wSpecialNote" style="font-size:12px"></div>
      <h3>Audience</h3><label>Add locations</label><div class="row"><input id="wLoc" placeholder="City, region or ZIP, e.g. Kingsville"><button class="soft" type="button" id="wLocGo">Search</button></div><div id="wLocRes" class="locres"></div><div id="wChips" class="chips"></div>
      <div class="three"><div><label>Radius around cities (miles)</label><input id="wRad" type="number" min="1" max="50" value="10"></div><div><label>Age from</label><input id="wAgeMin" type="number" min="18" max="65" value="18"></div><div><label>Age to</label><input id="wAgeMax" type="number" min="18" max="65" value="65"></div></div>
      <label>Gender</label><select id="wGender"><option value="">Everyone</option><option value="1">Men</option><option value="2">Women</option></select>
      <h3>Ad</h3><div class="two"><div><label>Facebook Page ID</label><input id="wPage" value="${esc(defaults.pageId || '')}" placeholder="Numbers only"></div><div><label>Instagram account ID (optional)</label><input id="wIg" value="${esc(defaults.instagramUserId || '')}" placeholder="Auto-filled if linked"></div></div>
      <label>Headline</label><input id="wHead" maxlength="40"><label>Text</label><textarea id="wMsg" rows="3" maxlength="500"></textarea><label>Description (optional)</label><input id="wDesc" maxlength="30">
      <div class="two"><div><label>Website link</label><input id="wLink" placeholder="https://…"></div><div><label>Button</label><select id="wCta">${o.ctas.map((x) => `<option value="${x}" ${x === 'LEARN_MORE' ? 'selected' : ''}>${x.replace(/_/g, ' ').toLowerCase()}</option>`).join('')}</select></div></div>
      <label>Photo</label><div class="row"><button class="soft" type="button" id="wPick">Choose photo…</button><span class="sub" id="wPicked" style="margin:0"></span></div><div class="sub" style="font-size:12px">JPEG or PNG. Or paste a public image URL: <input id="wImgUrl" placeholder="https://… .jpg" style="margin-top:6px"></div>
      <div class="err" id="wErr"></div><div class="row end"><span class="grow"></span><button class="ghost" id="wCancel">Cancel</button><button class="primary" id="wCreate">Create paused</button></div></div>`;
    const g = (id) => $('#' + id, m), close = () => { m.hidden = true; m.innerHTML = ''; };
    const noteSpecial = () => { g('wSpecialNote').textContent = g('wSpecial').value === 'NONE' ? '' : 'Meta limits targeting for this category: no age or gender targeting, and the minimum age is 18.'; };
    const pixel = () => { const ob = o.objectives.find((x) => x.id === g('wObj').value); g('wPixelRow').hidden = !(ob && ob.needsPixel); };
    g('wObj').onchange = pixel; g('wSpecial').onchange = noteSpecial; pixel();
    const chips = () => { g('wChips').innerHTML = [...S.cities.map((c) => ['cities', c]), ...S.regions.map((c) => ['regions', c]), ...S.zips.map((c) => ['zips', c])].map(([k, c]) => `<span class="chip">${esc(c.label)} <button class="x" data-rm="${k}:${esc(c.key)}" aria-label="Remove">×</button></span>`).join(''); };
    g('wChips').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; const [k, key] = b.dataset.rm.split(':'); S[k] = S[k].filter((x) => x.key !== key); chips(); };
    const addLoc = (r) => { const k = r.type === 'city' ? 'cities' : r.type === 'region' ? 'regions' : 'zips'; if (!S[k].some((x) => x.key === r.key)) S[k].push(r); chips(); };
    const search = async () => { const q = g('wLoc').value.trim(); if (!q) return; g('wLocRes').textContent = 'Searching…'; try { S.results = await lumen.adsGeo(st.ws, q); g('wLocRes').innerHTML = S.results.length ? S.results.map((r, i) => `<button class="soft" data-loc="${i}">${esc(r.label)}</button>`).join('') : '<span class="sub">No matches.</span>'; } catch (e) { g('wLocRes').innerHTML = `<span class="err">${esc(e.message)}</span>`; } };
    g('wLocGo').onclick = search; g('wLoc').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    g('wLocRes').onclick = (e) => { const b = e.target.closest('[data-loc]'); if (b) { addLoc(S.results[+b.dataset.loc]); g('wLocRes').innerHTML = ''; g('wLoc').value = ''; } };
    g('wPick').onclick = async () => { try { const r = await lumen.pickMedia(); if (r) { S.media = r.path; g('wPicked').textContent = r.name; } } catch (e) { toast(e.message); } };
    g('wDraft').onclick = async () => {
      const b = g('wDraft'); b.disabled = true; g('wDraftMsg').textContent = 'Drafting…';
      try {
        const d = await lumen.adsAiDraft(st.ws, g('wBrief').value);
        g('wName').value = d.name; g('wObj').value = d.objective; g('wBudget').value = d.dailyBudget; g('wRad').value = d.radiusMiles; g('wAgeMin').value = d.ageMin; g('wAgeMax').value = d.ageMax;
        g('wHead').value = d.headline; g('wMsg').value = d.message; g('wDesc').value = d.description; g('wCta').value = d.cta; g('wSpecial').value = d.special; pixel(); noteSpecial();
        g('wDraftMsg').textContent = (d.notes || 'Filled in. Check every field.') + ' Add the link and photo yourself.';
        for (const q of d.locations) { try { const r = await lumen.adsGeo(st.ws, q); if (r[0]) addLoc(r[0]); } catch (_) {} }
      } catch (e) { g('wDraftMsg').textContent = e.message.slice(0, 160); }
      b.disabled = false;
    };
    g('wClose').onclick = close; g('wCancel').onclick = close; m.onclick = (e) => { if (e.target === m) close(); };
    g('wCreate').onclick = async () => {
      const iso = (v, end) => { if (!v) return undefined; const [y, mo, d] = v.split('-').map(Number); return (end ? new Date(y, mo - 1, d, 23, 59) : new Date(y, mo - 1, d, 0, 0)).toISOString(); };
      const startIso = iso(g('wStart').value); const rad = +g('wRad').value || 10;
      const spec = { name: g('wName').value, objective: g('wObj').value, dailyBudget: +g('wBudget').value, pixelId: g('wPixel').value.trim(), special: g('wSpecial').value, startTime: startIso && Date.parse(startIso) > Date.now() ? startIso : undefined, endTime: iso(g('wEnd').value, true),
        audience: { cities: S.cities.map((c) => ({ key: c.key, radius: rad })), regions: S.regions.map((c) => ({ key: c.key })), zips: S.zips.map((c) => ({ key: c.key })), ageMin: +g('wAgeMin').value, ageMax: +g('wAgeMax').value, genders: g('wGender').value ? [+g('wGender').value] : [] },
        creative: { pageId: g('wPage').value.trim(), instagramUserId: g('wIg').value.trim(), headline: g('wHead').value, message: g('wMsg').value, description: g('wDesc').value, link: g('wLink').value.trim(), cta: g('wCta').value, mediaPath: S.media, imageUrl: g('wImgUrl').value.trim() } };
      const b = g('wCreate'); b.disabled = true; b.textContent = 'Creating…'; g('wErr').textContent = '';
      try { await lumen.adsCreate(st.ws, spec); close(); toast('Created, all paused. Review it, then turn it on.'); st.ads.filter = 'all'; await refreshAds(); }
      catch (e) { g('wErr').textContent = e.message; b.disabled = false; b.textContent = 'Create paused'; await refreshAds().catch(() => {}); }
    };
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
        <div class="row" style="margin-top:10px"><button class="soft" id="wsRen">Rename current</button><button class="ghost danger" id="wsDel">Delete current</button></div>
        <div class="row" id="renRow" hidden style="margin-top:10px"><input id="renName" aria-label="Workspace name"><button class="primary" id="renSave">Save</button><button class="ghost" id="renCancel">Cancel</button></div>
        <h2 style="margin-top:24px">Ad safety</h2><label>Largest daily budget Lumen will set</label><div class="row"><input id="cap" type="number" min="1" value="${esc(b.budgetCap)}"><button class="soft" id="capSave">Save</button></div><p class="sub" style="font-size:12px;margin:6px 0 0">Lumen refuses any daily budget above this, which also catches typos. New campaigns are always created paused.</p></div>
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
    // Electron has no window.prompt(), so rename happens inline.
    const renSave = async () => { const n = $('#renName').value.trim(); if (!n) return; try { await lumen.renameWorkspace(st.ws, n); await refreshBoot(); toast('Renamed'); settings(); } catch (e) { toast(e.message); } };
    $('#wsRen').onclick = () => { $('#renRow').hidden = false; const i = $('#renName'); i.value = (b.workspaces.find((w) => w.id === st.ws) || {}).name || ''; i.focus(); i.select(); };
    $('#renSave').onclick = renSave; $('#renCancel').onclick = () => { $('#renRow').hidden = true; };
    $('#renName').addEventListener('keydown', (e) => { if (e.key === 'Enter') renSave(); if (e.key === 'Escape') $('#renRow').hidden = true; });
    $('#wsDel').onclick = async () => { if (!confirm('Delete this workspace and all its data?')) return; await lumen.removeWorkspace(st.ws); await refreshBoot(); st.ws = st.boot.active; renderWs(); settings(); };
    $('#capSave').onclick = async () => { try { await lumen.setBudgetCap($('#cap').value); await refreshBoot(); toast('Saved'); } catch (e) { toast(e.message); } };
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
      const { from, to } = getRange();
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
