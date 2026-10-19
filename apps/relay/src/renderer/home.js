/* Relay — Home: overview, tasks with notes, inbox briefing entry point */
(() => {
  const R = () => window.RelayApp;
  const cap = (x) => x ? x[0].toUpperCase() + x.slice(1) : x;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => R().esc(s);
  const DAY = 86400000;
  const PRIORITY = [
    { v: 0, label: 'None', color: 'var(--muted)' },
    { v: 1, label: 'Low', color: '#10b5a0' },
    { v: 2, label: 'Medium', color: '#ffb03b' },
    { v: 3, label: 'High', color: '#ff4d3d' }
  ];
  const home = { el: null, side: null, filter: 'open', selected: null, saveTimers: {} };

  const st = () => R().state;
  const view = () => st().ui.homeView || 'overview';
  const tasks = () => st().tasks || (st().tasks = []);
  const todayKey = () => dateKey(new Date());
  function dateKey(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
  function dueLabel(k) {
    if (!k) return '';
    const t = todayKey();
    const d = new Date(k + 'T00:00');
    const diff = Math.round((d - new Date(t + 'T00:00')) / DAY);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff < 0) return `${-diff} days ago`;
    if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const isOverdue = (t) => !t.done && t.due && t.due < todayKey();
  const isToday = (t) => !t.done && t.due && t.due <= todayKey();
  const openTasks = () => tasks().filter(t => !t.done);
  const totalUnread = () => R().state.accounts.reduce((n, a) => n + (R().state.unread[a.id] || 0), 0);

  function setView(v) {
    st().ui.homeView = v;
    relay.saveUI({ homeView: v });
    renderSidebar(home.side);
    render(home.el);
  }

  /* ---------- task persistence ---------- */
  async function saveTask(t, { rerender = true } = {}) {
    st().tasks = await relay.saveTask(t);
    if (rerender) { render(home.el); renderSidebar(home.side); }
  }
  function saveTaskSoon(t) {
    clearTimeout(home.saveTimers[t.id]);
    home.saveTimers[t.id] = setTimeout(() => saveTask(t, { rerender: false }).then(() => { refreshListOnly(); renderSidebar(home.side); }), 450);
  }
  async function addTask(title, extra = {}) {
    const t = { id: R().uid(), title: title.trim(), done: false, due: null, priority: 0, accountId: null, notes: '', steps: [], ...extra };
    if (!t.title) return null;
    await saveTask(t);
    return t;
  }
  async function toggleDone(id) {
    const t = tasks().find(x => x.id === id);
    if (!t) return;
    t.done = !t.done; t.doneAt = t.done ? Date.now() : null;
    await saveTask(t);
    if (t.done) R().toast('Nice — task done ✓');
  }

  /* ---------- sidebar ---------- */
  function renderSidebar(side) {
    if (!side) return;
    home.side = side;
    if (st().ui.platform !== 'home') return;
    const v = view();
    const open = openTasks();
    const recentNotes = tasks().filter(t => (t.notes || '').trim()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 4);
    side.innerHTML = `
      <div class="home-side">
        <nav class="side-nav">
          <button data-v="overview" class="${v === 'overview' ? 'active' : ''}">${ic('sun', 17)}<span>Overview</span></button>
          <button data-v="briefing" class="${v === 'briefing' ? 'active' : ''}">${ic('inbox', 17)}<span>Inbox briefing</span>${st().briefing ? '' : '<span class="pill new">New</span>'}</button>
          <button data-v="tasks" class="${v === 'tasks' ? 'active' : ''}">${ic('checkCircle', 17)}<span>Tasks & notes</span>${open.length ? `<span class="pill">${open.length}</span>` : ''}</button>
        </nav>
        <div class="side-head" style="padding-top:18px"><div class="side-title" style="--c:var(--accent)"><span class="dot"></span>Inboxes</div><span class="side-title" title="Drag to rearrange">${totalUnread() || ''}</span></div>
        <div class="mini-accounts">
          ${R().state.accounts.length ? R().state.accounts.map(a => `
            <button class="mini-acct" data-acct="${a.id}" style="--c:${esc(a.color)}" title="${esc(a.email || a.name)}">
              ${R().avatarHTML(a, 'sm')}<span class="n">${esc(a.name || a.email)}</span>
              ${R().state.unread[a.id] ? `<span class="u">${R().state.unread[a.id]}</span>` : ''}
            </button>`).join('') : '<div class="upc-empty">No accounts yet</div>'}
        </div>
        ${recentNotes.length ? `
          <div class="side-head" style="padding-top:16px"><div class="side-title">Recent notes</div></div>
          <div class="mini-notes">${recentNotes.map(t => `<button data-open-task="${t.id}">${ic('note', 14)}<span>${esc(t.title)}</span></button>`).join('')}</div>` : ''}
      </div>`;
    $$('.side-nav button', side).forEach(b => b.onclick = () => setView(b.dataset.v));
    $$('[data-acct]', side).forEach(b => b.onclick = () => R().selectAccount(b.dataset.acct) || R().setPlatform(R().accountById(b.dataset.acct).platform));
    // drag to rearrange — the order is shared with each mail tab
    const ma = $('.mini-accounts', side);
    if (ma) R().makeSortable(ma, '[data-acct]', 'data-acct', async (ids) => {
      const all = R().state.accounts.map(a => a.id).filter(id => !ids.includes(id));
      R().state.accounts = await relay.reorderAccounts([...ids, ...all]);
      renderSidebar(side);
    });
    $$('[data-open-task]', side).forEach(b => b.onclick = () => openTask(b.dataset.openTask));
  }

  /* ---------- main ---------- */
  function render(el) {
    if (!el) return;
    home.el = el;
    if (st().ui.platform !== 'home') return;
    const v = view();
    if (v === 'briefing') return window.Briefing?.render(el);
    if (v === 'tasks') return renderTasks(el);
    renderOverview(el);
  }

  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  function renderOverview(el) {
    const s = st();
    const name = (s.settings.userName || '').trim();
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const events = window.Calendar?.eventsBetween(dayStart, new Date(+dayStart + DAY)) || [];
    const upcomingEvents = events.filter(e => e.allDay || e.end > now);
    const open = openTasks();
    const due = open.filter(isToday);
    const overdue = open.filter(isOverdue);
    const unread = totalUnread();
    const doneWeek = tasks().filter(t => t.done && t.doneAt > Date.now() - 7 * DAY).length;
    const sorted = [...open].sort((a, b) => (isToday(b) - isToday(a)) || (b.priority - a.priority) || ((a.due || '9') < (b.due || '9') ? -1 : 1));
    const b = s.briefing;

    const parts = [];
    if (unread) parts.push(`<b>${unread}</b> unread email${unread === 1 ? '' : 's'}`);
    if (due.length) parts.push(`<b>${due.length}</b> task${due.length === 1 ? '' : 's'} due`);
    if (upcomingEvents.length) parts.push(`<b>${upcomingEvents.length}</b> event${upcomingEvents.length === 1 ? '' : 's'} left today`);
    const summary = parts.length ? `You have ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : 'All clear. Enjoy the calm.';

    el.innerHTML = `<div class="home-scroll">
      <header class="hero">
        <div class="hero-text">
          <div class="hero-date">${now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <h1>${greeting()}${name ? `, <span>${esc(name)}</span>` : ''}</h1>
          <p>${summary}</p>
        </div>
        <div class="hero-actions">
          <button class="btn" id="hNewTask">${ic('plus', 15)} New task</button>
          <button class="btn brand" id="hBrief">${ic('sparkles', 15)} ${b ? 'Refresh briefing' : 'Run inbox briefing'}</button>
        </div>
      </header>

      <div class="stat-row">
        ${stat('Unread', unread, 'inbox', 'var(--gmail)', 'across ' + s.accounts.length + ' account' + (s.accounts.length === 1 ? '' : 's'))}
        ${stat('Due today', due.length, 'flag', '#ffb03b', overdue.length ? `${overdue.length} overdue` : 'nothing overdue')}
        ${stat('Events today', events.length, 'calendar', 'var(--calendar)', upcomingEvents[0] ? 'next: ' + (upcomingEvents[0].allDay ? upcomingEvents[0].title : window.Calendar.fmtTime(upcomingEvents[0].start)) : 'free day')}
        ${stat('Done this week', doneWeek, 'checkCircle', 'var(--ok)', open.length + ' still open')}
      </div>

      <div class="home-grid">
        <section class="card tasks-card">
          <div class="card-head"><h3>${ic('checkCircle', 17)} Pending tasks</h3><button class="link" data-goto="tasks">See all ${ic('arrowRight', 14)}</button></div>
          <form class="quick-add" id="hQuickAdd"><span class="plus">${ic('plus', 16)}</span><input class="qa-input" placeholder="Add a task and press Enter…" /></form>
          <div class="task-rows">${sorted.slice(0, 7).map(taskRowHTML).join('') || `<div class="card-empty">${ic('checkCircle', 20)}<span>No pending tasks. Add one above.</span></div>`}</div>
        </section>

        <section class="card today-card">
          <div class="card-head"><h3>${ic('calendar', 17)} Today</h3><button class="link" id="hOpenCal">Calendar ${ic('arrowRight', 14)}</button></div>
          <div class="agenda">${events.length ? events.map(e => `
            <div class="ag ${(!e.allDay && e.end < now) ? 'past' : ''}" style="--c:${e.color}">
              <span class="ag-time">${e.allDay ? 'All day' : window.Calendar.fmtTime(e.start)}</span>
              <span class="ag-bar"></span>
              <span class="ag-meta"><span class="ag-t">${esc(e.title)}</span><span class="ag-s">${esc(e.calName)}${e.location ? ' · ' + esc(e.location) : ''}</span></span>
            </div>`).join('') : `<div class="card-empty">${ic('sun', 20)}<span>Nothing on the calendar today.</span></div>`}</div>
        </section>

        <section class="card brief-card">
          <div class="card-head"><h3>${ic('inbox', 17)} Inbox briefing</h3>${b ? `<span class="muted-sm">${timeAgo(b.at)}</span>` : ''}</div>
          ${b && b.overall ? `
            <p class="brief-lede">${esc(b.overall.greeting || '')}</p>
            <ol class="brief-pri">${(b.overall.priorities || []).slice(0, 4).map(p => `<li><span>${esc(p.text)}</span>${p.account ? `<em>${esc(p.account)}</em>` : ''}</li>`).join('')}</ol>
            <button class="btn" data-goto="briefing">Open full briefing ${ic('arrowRight', 14)}</button>` : `
            <div class="card-empty tall">${ic('sparkles', 22)}<span>Relay can read each signed-in inbox and tell you what needs a reply, what’s important, and what you can skip.</span>
            <button class="btn brand" data-goto="briefing" style="margin-top:6px">${ic('sparkles', 15)} Set up briefing</button></div>`}
        </section>
        ${deliveriesCard()}
      </div>
    </div>`;
    $$('[data-pkg]', el).forEach(b => b.onclick = () => { window.Tracking?.select(b.dataset.pkg); R().setPlatform('tracking'); });
    $('#hTrackAll', el)?.addEventListener('click', () => R().setPlatform('tracking'));

    $('#hNewTask', el).onclick = () => { setView('tasks'); focusNewTask(); };
    $('#hBrief', el).onclick = () => { setView('briefing'); window.Briefing?.run(); };
    $('#hOpenCal', el).onclick = () => window.Calendar?.open(new Date());
    $$('[data-goto]', el).forEach(b => b.onclick = () => setView(b.dataset.goto));
    $('#hQuickAdd', el).onsubmit = async (e) => {
      e.preventDefault();
      const inp = $('.qa-input', el);
      const t = await addTask(inp.value);
      if (t) setTimeout(() => $('#hQuickAdd .qa-input', home.el)?.focus(), 0);
    };
    bindTaskRows(el);
    window.Calendar?.ensureFeeds();
  }

  function deliveriesCard() {
    const pk = (window.Tracking?.active() || []).slice().sort((a, b) => (new Date(a.eta?.to || 8e15)) - (new Date(b.eta?.to || 8e15))).slice(0, 4);
    if (!pk.length) return '';
    return `<section class="card deliveries-card">
      <div class="card-head"><h3>${ic('box', 17)} On the way</h3><button class="link" id="hTrackAll">Tracking ${ic('arrowRight', 14)}</button></div>
      <div class="dlv-list">${pk.map(p => {
        const e = window.Tracking.etaInfo(p);
        const c = window.Carriers.info(p.carrier);
        return `<button class="dlv" data-pkg="${p.id}"><span class="cr-tile sm" style="--c:${c.color}">${esc((p.carrierName || c.name).slice(0, 4))}</span>
          <span class="dlv-m"><b>${esc(p.name || c.name + ' package')}</b><small>${esc(p.statusText || '')}</small></span>
          <span class="tr-eta ${e.tone}"><b>${esc(cap(e.label.replace(/^Arriving /, '')))}</b></span></button>`;
      }).join('')}</div>
    </section>`;
  }

  function stat(label, n, icon, color, sub) {
    return `<div class="stat" style="--c:${color}"><div class="stat-ic">${ic(icon, 18)}</div><div><div class="stat-n">${n}</div><div class="stat-l">${label}</div><div class="stat-s">${esc(sub)}</div></div></div>`;
  }
  function timeAgo(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function taskRowHTML(t) {
    const acc = t.accountId && R().accountById(t.accountId);
    const pr = PRIORITY[t.priority || 0];
    const steps = t.steps || [];
    const doneSteps = steps.filter(s => s.done).length;
    return `<div class="task-row ${t.done ? 'done' : ''} ${home.selected === t.id && view() === 'tasks' ? 'active' : ''}" data-task="${t.id}">
      <button class="tcheck" data-check="${t.id}" style="--c:${t.priority ? pr.color : 'var(--accent)'}" title="${t.done ? 'Mark as not done' : 'Complete'}">${ic('check', 12)}</button>
      <div class="t-main">
        <div class="t-title">${esc(t.title)}</div>
        <div class="t-meta">
          ${t.due ? `<span class="chip-sm ${isOverdue(t) ? 'over' : t.due === todayKey() ? 'today' : ''}">${ic('flag', 11)} ${dueLabel(t.due)}</span>` : ''}
          ${t.priority ? `<span class="chip-sm" style="--c:${pr.color}"><i class="pdot"></i>${pr.label}</span>` : ''}
          ${acc ? `<span class="chip-sm" style="--c:${esc(acc.color)}"><i class="pdot"></i>${esc(acc.name || acc.email)}</span>` : ''}
          ${steps.length ? `<span class="chip-sm">${ic('list', 11)} ${doneSteps}/${steps.length}</span>` : ''}
          ${(t.notes || '').trim() ? `<span class="chip-sm">${ic('note', 11)} Notes</span>` : ''}
        </div>
      </div>
      <span class="t-go">${ic('chevronRight', 16)}</span>
    </div>`;
  }
  function bindTaskRows(el) {
    $$('[data-check]', el).forEach(b => b.onclick = (e) => { e.stopPropagation(); toggleDone(b.dataset.check); });
    $$('.task-row', el).forEach(r => r.onclick = () => openTask(r.dataset.task));
  }

  function openTask(id) {
    home.selected = id;
    if (view() !== 'tasks') { st().ui.homeView = 'tasks'; relay.saveUI({ homeView: 'tasks' }); }
    if (st().ui.platform !== 'home') R().setPlatform('home');
    else { renderSidebar(home.side); render(home.el); }
  }

  /* ---------- tasks & notes view ---------- */
  function filtered() {
    const f = home.filter;
    let list = tasks();
    if (f === 'open') list = list.filter(t => !t.done);
    else if (f === 'today') list = list.filter(isToday);
    else if (f === 'done') list = list.filter(t => t.done);
    return [...list].sort((a, b) => (a.done - b.done) || (isOverdue(b) - isOverdue(a)) || (b.priority - a.priority) || ((a.due || '9') < (b.due || '9') ? -1 : (a.due || '9') > (b.due || '9') ? 1 : 0));
  }

  function renderTasks(el) {
    const list = filtered();
    if (!home.selected || !tasks().find(t => t.id === home.selected)) home.selected = list[0]?.id || null;
    const counts = { open: openTasks().length, today: tasks().filter(isToday).length, done: tasks().filter(t => t.done).length, all: tasks().length };
    el.innerHTML = `<div class="tasks-view">
      <div class="tasks-pane">
        <div class="tp-head">
          <h2>Tasks</h2>
          <div class="seg" id="tFilter">${[['open', 'Open'], ['today', 'Today'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => `<button data-f="${k}" class="${home.filter === k ? 'active' : ''}">${l}${counts[k] ? ` <span class="seg-n">${counts[k]}</span>` : ''}</button>`).join('')}</div>
        </div>
        <form class="quick-add" id="tAdd"><span class="plus">${ic('plus', 16)}</span><input class="qa-input" id="tAddInput" placeholder="Add a task and press Enter…" /></form>
        <div class="task-rows scroll" id="tRows">${list.map(taskRowHTML).join('') || `<div class="card-empty tall">${ic('checkCircle', 22)}<span>${home.filter === 'done' ? 'Nothing completed yet.' : 'You’re all caught up.'}</span></div>`}</div>
      </div>
      <div class="task-detail" id="tDetail"></div>
    </div>`;
    $$('#tFilter button', el).forEach(b => b.onclick = () => { home.filter = b.dataset.f; renderTasks(el); });
    $('#tAdd', el).onsubmit = async (e) => {
      e.preventDefault();
      const t = await addTask($('#tAddInput', el).value);
      if (t) { home.selected = t.id; render(home.el); setTimeout(() => $('#tAddInput', home.el)?.focus(), 0); }
    };
    bindTaskRows(el);
    renderDetail();
  }

  function refreshListOnly() {
    const rows = home.el && $('#tRows', home.el);
    if (!rows) return;
    rows.innerHTML = filtered().map(taskRowHTML).join('');
    bindTaskRows(rows);
  }

  function renderDetail() {
    const box = $('#tDetail', home.el);
    if (!box) return;
    const t = tasks().find(x => x.id === home.selected);
    if (!t) {
      box.innerHTML = `<div class="detail-empty">${ic('note', 34)}<h3>Pick a task to see its notes</h3><p>Every task has its own little notebook — jot down details, links, and steps.</p></div>`;
      return;
    }
    t.steps = t.steps || [];
    const accts = R().state.accounts;
    box.innerHTML = `
      <div class="td-top">
        <button class="tcheck big ${t.done ? 'on' : ''}" id="tdCheck" style="--c:${t.priority ? PRIORITY[t.priority].color : 'var(--accent)'}">${ic('check', 14)}</button>
        <textarea class="td-title" id="tdTitle" rows="1" placeholder="Task name">${esc(t.title)}</textarea>
        <button class="icon-btn" id="tdMore" title="More">${ic('dots', 18)}</button>
      </div>
      <div class="td-props">
        <label class="prop">${ic('flag', 15)}<span>Due</span><input type="date" id="tdDue" value="${t.due || ''}"></label>
        <div class="prop">${ic('alert', 15)}<span>Priority</span>
          <div class="prio" id="tdPrio">${PRIORITY.map(p => `<button data-p="${p.v}" class="${(t.priority || 0) === p.v ? 'active' : ''}" style="--c:${p.color}">${p.label}</button>`).join('')}</div>
        </div>
        <label class="prop">${ic('mail', 15)}<span>Account</span>
          <select id="tdAcct"><option value="">None</option>${accts.map(a => `<option value="${a.id}" ${a.id === t.accountId ? 'selected' : ''}>${esc(a.name || a.email)}</option>`).join('')}</select>
        </label>
      </div>
      ${t.source ? `<button class="source-chip" id="tdSource" style="--c:${esc(R().accountById(t.source.accountId)?.color || 'var(--accent)')}">${ic('mail', 14)}<span>From <b>${esc(t.source.from || 'email')}</b> — ${esc(t.source.subject || '')}</span>${ic('external', 13)}</button>` : ''}
      <div class="td-section">
        <div class="td-label">${ic('list', 14)} Steps <span class="muted-sm">${t.steps.filter(s => s.done).length}/${t.steps.length}</span>
          <button class="link sm" id="tdAiSteps">${ic('sparkles', 13)} Break it down with AI</button></div>
        <div class="steps" id="tdSteps">${t.steps.map(s => `
          <div class="step ${s.done ? 'done' : ''}" data-step="${s.id}">
            <button class="scheck">${ic('check', 11)}</button>
            <input value="${esc(s.text)}" />
            <button class="icon-btn sm sdel" title="Remove">${ic('x', 13)}</button>
          </div>`).join('')}
          <form class="step add" id="tdAddStep"><span class="scheck ghost">${ic('plus', 11)}</span><input placeholder="Add a step" /></form>
        </div>
      </div>
      <div class="td-section grow">
        <div class="td-label">${ic('note', 14)} Notes <span class="muted-sm" id="tdSaved"></span></div>
        <textarea class="td-notes" id="tdNotes" placeholder="Write anything — context, links, ideas, meeting notes…">${esc(t.notes || '')}</textarea>
      </div>
      <div class="td-foot">
        <span class="muted-sm">Created ${new Date(t.createdAt || Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${t.done && t.doneAt ? ' · completed ' + new Date(t.doneAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</span>
        <button class="btn ghost" id="tdAskAI">${ic('sparkles', 14)} Ask the assistant</button>
      </div>`;

    const autosize = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    const title = $('#tdTitle', box);
    autosize(title);
    title.oninput = () => { autosize(title); t.title = title.value.replace(/\n/g, ' '); saveTaskSoon(t); };
    title.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#tdNotes', box).focus(); } };
    $('#tdCheck', box).onclick = () => toggleDone(t.id);
    $('#tdDue', box).onchange = (e) => { t.due = e.target.value || null; saveTask(t); };
    $$('#tdPrio button', box).forEach(b => b.onclick = () => { t.priority = +b.dataset.p; saveTask(t); });
    $('#tdAcct', box).onchange = (e) => { t.accountId = e.target.value || null; saveTask(t); };
    $('#tdSource', box)?.addEventListener('click', () => { const a = R().accountById(t.source.accountId); if (a) { R().setPlatform(a.platform); R().selectAccount(a.id); } });
    const notes = $('#tdNotes', box);
    notes.oninput = () => { t.notes = notes.value; $('#tdSaved', box).textContent = 'Saving…'; saveTaskSoon(t); clearTimeout(home.savedLbl); home.savedLbl = setTimeout(() => { const l = $('#tdSaved', box); if (l) l.textContent = 'Saved'; }, 700); };

    // steps
    $$('.step[data-step]', box).forEach(row => {
      const sid = row.dataset.step;
      const step = t.steps.find(s => s.id === sid);
      $('.scheck', row).onclick = () => { step.done = !step.done; saveTask(t); };
      $('input', row).oninput = (e) => { step.text = e.target.value; saveTaskSoon(t); };
      $('input', row).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#tdAddStep input', box).focus(); } };
      $('.sdel', row).onclick = () => { t.steps = t.steps.filter(s => s.id !== sid); saveTask(t); };
    });
    $('#tdAddStep', box).onsubmit = async (e) => {
      e.preventDefault();
      const inp = $('input', e.target);
      if (!inp.value.trim()) return;
      t.steps.push({ id: R().uid(), text: inp.value.trim(), done: false });
      await saveTask(t);
      setTimeout(() => $('#tdAddStep input', home.el)?.focus(), 0);
    };
    $('#tdAiSteps', box).onclick = () => aiSteps(t);
    $('#tdAskAI', box).onclick = () => {
      R().toggleAI(true);
      window.AI?.prompt(`Help me with this task: "${t.title}"${t.due ? ` (due ${dueLabel(t.due)})` : ''}.${t.notes ? `\n\nMy notes so far:\n${t.notes}` : ''}`);
    };
    $('#tdMore', box).onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      R().popMenu(r.right - 200, r.bottom + 4, [
        { label: 'Due today', icon: 'flag', onClick: () => { t.due = todayKey(); saveTask(t); } },
        { label: 'Due tomorrow', icon: 'flag', onClick: () => { t.due = dateKey(new Date(Date.now() + DAY)); saveTask(t); } },
        { label: 'Add to calendar…', icon: 'calendar', onClick: () => { R().setPlatform('calendar'); window.Calendar?.newEvent({ date: t.due ? new Date(t.due + 'T09:00') : undefined }); setTimeout(() => { const i = document.getElementById('eTitle'); if (i) i.value = t.title; }, 50); } },
        '-',
        { label: 'Delete task', icon: 'trash', danger: true, onClick: async () => { st().tasks = await relay.removeTask(t.id); home.selected = null; render(home.el); renderSidebar(home.side); R().toast('Task deleted'); } }
      ]);
    };
  }

  async function aiSteps(t) {
    const btn = $('#tdAiSteps', home.el);
    if (btn) { btn.disabled = true; btn.innerHTML = `${ic('sparkles', 13)} Thinking…`; }
    try {
      const out = await relay.aiComplete({
        system: 'You turn tasks into short, concrete next steps. Reply with JSON only: {"steps": ["...", "..."]} — 3 to 6 steps, each under 12 words, starting with a verb.',
        prompt: `Task: ${t.title}\n${t.notes ? 'Notes: ' + t.notes.slice(0, 2000) : ''}\nExisting steps: ${(t.steps || []).map(s => s.text).join('; ') || 'none'}`,
        maxTokens: 400
      });
      const json = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
      (json.steps || []).forEach(text => t.steps.push({ id: R().uid(), text: String(text), done: false }));
      await saveTask(t);
    } catch (e) {
      R().toast(/API key/.test(e.message) ? 'Add an AI key in Settings → AI plugins first' : 'Couldn’t generate steps: ' + e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
      renderDetail();
    }
  }

  function focusNewTask() { setTimeout(() => $('#tAddInput', home.el)?.focus(), 60); }

  window.Home = {
    render, renderSidebar, setView, addTask, openTask, focusNewTask,
    onUnread: () => { renderSidebar(home.side); if (view() === 'overview') render(home.el); },
    onCalendar: () => { if (st().ui.platform === 'home' && view() === 'overview') render(home.el); },
    summaryText: () => {
      const open = openTasks();
      return open.slice(0, 25).map(t => `- ${t.title}${t.due ? ` (due ${dueLabel(t.due)})` : ''}${t.priority ? ` [${PRIORITY[t.priority].label} priority]` : ''}`).join('\n');
    }
  };
})();
