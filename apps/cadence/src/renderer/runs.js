// Cadence — run history and one run's step-by-step story.
'use strict';

VIEWS.runs = {
  title: 'Runs',
  head: () => { const f = S.runFilter && S.flows.find((x) => x.id === S.runFilter); return `<h1>Runs${f ? `<small>${esc(f.name)} <button class="link-btn" id="rfClear">Show all</button></small>` : ''}</h1>`; },
  actions: () => `<div class="seg" id="runSeg"><button data-k="all" class="${S.runKind !== 'failed' && S.runKind !== 'tests' ? 'on' : ''}">All</button><button data-k="failed" class="${S.runKind === 'failed' ? 'on' : ''}">Problems</button><button data-k="tests" class="${S.runKind === 'tests' ? 'on' : ''}">Tests</button></div>`,
  render(view) {
    let list = S.runs.filter((r) => !S.runFilter || r.flowId === S.runFilter);
    if (S.runKind === 'failed') list = list.filter((r) => r.status === 'failed');
    else if (S.runKind === 'tests') list = list.filter((r) => r.partial || (r.trigger && r.trigger.kind === 'test'));
    else list = list.filter((r) => !r.partial);
    if (!list.length) { view.innerHTML = `<div class="empty">${icon('runs', 34)}<b>No runs here yet</b><span>${S.runKind === 'failed' ? 'Nothing has gone wrong.' : 'Runs show up as automations start — on their schedule, when files arrive, or when you press Run.'}</span></div>`; return; }
    // group by day
    const byDay = new Map();
    for (const r of list) { const d = new Date(r.startedAt || Date.now()); const k = d.toDateString(); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(r); }
    view.innerHTML = [...byDay.entries()].map(([k, rs]) => {
      const d = new Date(k); const today = new Date().toDateString() === k; const yest = new Date(Date.now() - DAY).toDateString() === k;
      return `<div class="section-title">${today ? 'Today' : yest ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}<span class="muted">${rs.length}</span></div><div class="run-list">${rs.map(runRow).join('')}</div>`;
    }).join('');
    $$('.rrow', view).forEach((r) => r.onclick = () => go('run', r.dataset.id));
  },
  after() {
    $$('#runSeg button').forEach((b) => b.onclick = () => { S.runKind = b.dataset.k; render(); });
    const c = $('#rfClear'); if (c) c.onclick = () => { S.runFilter = null; render(); };
  },
};
function runRow(r) {
  const f = S.flows.find((x) => x.id === r.flowId) || { name: r.flowName, stepTypes: (r.steps || []).map((s) => s.type) };
  const dur = r.endedAt && r.startedAt ? fmtDur(r.endedAt - r.startedAt) : r.status === 'running' ? 'running' : '';
  const nFiles = (r.files || []).length;
  const bad = r.status === 'failed' ? (r.steps || []).find((s) => s.status === 'failed') : null;
  return `<button class="rrow st-${r.status}" data-id="${r.id}">
    <span class="r-time tnum">${r.startedAt ? clock(r.startedAt) : ''}</span>
    ${flowTile(f, 'sm')}
    <span class="r-main"><b class="ellip">${esc(r.flowName)}</b><span class="ellip muted small">${bad ? `<span class="bad">${esc(bad.name)}: ${esc(bad.error || '')}</span>` : r.result ? esc(r.result) : `${(r.steps || []).filter((s) => s.status === 'done').length} of ${(r.steps || []).length} steps${nFiles ? ` · ${nFiles} file${nFiles === 1 ? '' : 's'}` : ''}`}</span></span>
    <span class="r-trig muted small">${esc(trigWord(r.trigger))}</span>
    <span class="r-dur muted small tnum">${dur}</span>
    ${statusPill(r.status)}
  </button>`;
}

VIEWS.run = {
  flush: false,
  head: () => { const r = S.runDetail; if (!r || r.id !== S.runId) return '<h1>Run</h1>'; return `<button class="icon-btn" id="rBack" title="All runs">${icon('back', 18)}</button><h1><span class="ellip">${esc(r.flowName)}</span><small>${r.startedAt ? new Date(r.startedAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</small></h1>`; },
  actions: () => { const r = S.runDetail; if (!r || r.id !== S.runId) return ''; const live = ['running', 'queued'].includes(r.status); return `${live ? `<button class="btn" id="rStop">${icon('stop', 14)}Stop</button>` : `<button class="btn" id="rEdit">${icon('edit', 14)}Edit automation</button><button class="btn primary" id="rAgain">${icon('refresh', 14)}Run again</button>`}`; },
  render(view) {
    const r = S.runDetail;
    if (!r || r.id !== S.runId) { view.innerHTML = '<div class="empty"><span class="spin"></span></div>'; call('runs:get', S.runId).then((x) => { S.runDetail = x; S.runSel = null; render(); }).catch((e) => { fail(e); go('runs'); }); return; }
    const total = r.steps.length; const done = r.steps.filter((s) => ['done', 'skipped', 'off'].includes(s.status)).length;
    const files = r.files || [];
    const made = (s) => { const o = r.outputs && r.outputs[s.id]; return o && (o.file || (o.table && o.table.__table)); };
    const sel = S.runSel || (r.steps.find((s) => s.status === 'failed') || r.steps.find((s) => s.status === 'running') || [...r.steps].reverse().find((s) => s.status === 'done' && made(s)) || r.steps[0] || {}).id;
    const st = r.steps.find((s) => s.id === sel);
    view.innerHTML = `
      <div class="run-top st-${r.status}">
        <div class="rt-status">${statusPill(r.status)}<b>${{ done: 'Finished', failed: 'Stopped at a problem', running: 'Running', queued: 'Waiting to start', cancelled: 'Stopped' }[r.status] || r.status}</b>${r.partial ? '<span class="pill">Test</span>' : ''}</div>
        <div class="rt-facts"><span>${icon('clock', 13)}${r.endedAt ? fmtDur(r.endedAt - r.startedAt) : 'so far ' + fmtDur(Date.now() - r.startedAt)}</span><span>${icon('flows', 13)}${done} of ${total} steps</span><span>${icon('bolt', 13)}Started by ${esc(trigWord(r.trigger))}</span></div>
        ${r.error ? `<div class="note bad">${icon('alert', 15)}<span>${esc(r.error)}</span></div>` : r.result ? `<div class="note">${icon('info', 15)}<span>${esc(r.result)}</span></div>` : ''}
        ${files.length ? `<div class="rt-files"><div class="small muted">Made</div>${outputView({ files })}</div>` : ''}
      </div>
      <div class="run-body">
        <div class="steps-tl">${r.steps.map((s, i) => { const m = stepMeta(s.type); return `<button class="tl ${s.id === sel ? 'sel' : ''} st-${s.status}" data-id="${s.id}"><span class="tl-dot">${s.status === 'running' ? '<span class="spin"></span>' : s.status === 'done' ? icon('check', 13) : s.status === 'failed' ? icon('x', 13) : ''}</span>${tile(m.icon, m.color, 'sm')}<span class="tl-main"><b class="ellip">${esc(s.name)}</b><span class="ellip muted small">${s.status === 'failed' ? `<span class="bad">${esc(s.error || '')}</span>` : esc(s.summary || (STATUS[s.status] || [])[1] || '')}</span></span><span class="muted tiny tnum">${s.endedAt && s.startedAt ? fmtDur(s.endedAt - s.startedAt) : ''}</span></button>`; }).join('')}</div>
        <div class="step-detail">${st ? `<div class="sd-head">${tile(stepMeta(st.type).icon, stepMeta(st.type).color)}<div class="grow"><div class="pane-kind">${esc(stepMeta(st.type).label)}${st.attempt > 1 ? ` · try ${st.attempt}` : ''}</div><b>${esc(st.name)}</b></div>${statusPill(st.status)}</div>
          ${st.error ? `<div class="note bad">${icon('alert', 15)}<span>${esc(st.error)}</span></div>` : ''}
          ${r.outputs && r.outputs[st.id] && st.status === 'done' ? `<div class="sd-out">${outputView(r.outputs[st.id])}</div>` : ''}
          ${st.log && st.log.length ? `<div class="pane-sub">Log</div><div class="log">${st.log.map((l) => `<div class="ll ${l.level}"><span class="tnum">${new Date(l.t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>${esc(l.msg)}</div>`).join('')}</div>` : st.status === 'skipped' || st.status === 'off' ? '<div class="muted small">This step didn’t run.</div>' : ''}` : ''}</div>
      </div>`;
    $$('.tl', view).forEach((b) => b.onclick = () => { S.runSel = b.dataset.id; render(); });
    bindOutputs(view);
  },
  after() {
    const r = S.runDetail; if (!r) return;
    const b = (id, fn) => { const x = $('#' + id); if (x) x.onclick = fn; };
    b('rBack', () => go('runs'));
    b('rStop', () => call('run:cancel', r.id).catch(fail));
    b('rEdit', () => go('editor', r.flowId));
    b('rAgain', () => runFlow(r.flowId));
  },
};
