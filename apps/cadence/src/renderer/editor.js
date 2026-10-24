// Cadence — the automation editor: the trigger and steps as a spine on the left, the selected item's settings on
// the right. Saves as you type. Test runs show each step's result in place.
'use strict';

const Editor = {
  draft: null, sel: 'trigger', problems: { errors: [], warnings: [] }, outputs: {}, run: null, saveT: null, saving: false, dirty: false,

  async open(id) {
    try { this.draft = await call('flows:get', id); } catch (e) { fail(e); return go('flows'); }
    if (this._prev !== id) { this.sel = this.draft.steps.length ? this.draft.steps[0].id : 'trigger'; this.outputs = {}; this.run = null; }
    this._for = id;
    this.problems = await call('flows:check', this.draft).catch(() => ({ errors: [], warnings: [] }));
    // last finished run gives step results and column names for hints
    const last = S.runs.find((r) => r.flowId === id && ['done', 'failed'].includes(r.status));
    if (last && !Object.keys(this.outputs).length) { try { const full = await call('runs:get', last.id); this.outputs = full.outputs || {}; this.lastRun = full; } catch {} }
    const live = S.runs.find((r) => r.flowId === id && r.status === 'running'); if (live) this.run = live;
  },
  leave() { if (this.dirty) this.flush(); },
  ctx(stepId) { return { flow: this.draft, stepId, outputs: this.outputs }; },
  currentStartUrl() { const s = this.draft && this.draft.steps.find((x) => x.id === this.sel); return s && s.with && /^https?:/.test(s.with.url || '') ? s.with.url : ''; },

  changed({ canvas = true } = {}) {
    this.dirty = true; this.setSaveState('Saving…');
    clearTimeout(this.saveT); this.saveT = setTimeout(() => this.flush(), 450);
    if (canvas) this.drawCanvas();
  },
  async flush() {
    clearTimeout(this.saveT); if (!this.dirty || !this.draft) return;
    this.dirty = false;
    try {
      const r = await call('flows:save', this.draft);
      this.draft.updatedAt = r.flow.updatedAt; this.problems = r.problems;
      this.setSaveState('Saved');
      this.drawCanvas(); this.drawProblems();
      const i = S.flows.findIndex((f) => f.id === r.flow.id); loadFlows();
    } catch (e) { this.setSaveState('Not saved'); fail(e); }
  },
  setSaveState(t) { const el = $('#edSave'); if (el) { el.textContent = t; el.classList.toggle('busy', t === 'Saving…'); } },

  // ───────── canvas
  drawCanvas() {
    const el = $('#edCanvas'); if (!el) return;
    const f = this.draft;
    const errsFor = (id) => this.problems.errors.filter((e) => (id === 'trigger' ? !e.step && (e.field === 'trigger' || e.field === 'name') : e.step === id));
    const stat = (id) => { const r = this.run || this.lastRun; if (!r) return null; const s = r.steps.find((x) => x.id === id); return s ? s.status : null; };
    const trigErr = errsFor('trigger').length;
    const tw = f.trigger.type === 'schedule' ? (S.flows.find((x) => x.id === f.id) || {}).when || 'On a schedule' : f.trigger.type === 'watch' ? `When a file lands in ${baseName(f.trigger.folder || '') || 'a folder'}` : 'When you run it';
    let html = `<div class="spine">
      <button class="node trig${this.sel === 'trigger' ? ' sel' : ''}${trigErr ? ' err' : ''}" data-id="trigger">
        ${tile(f.trigger.type === 'schedule' ? 'clock' : f.trigger.type === 'watch' ? 'folderIn' : 'play', 'violet')}
        <span class="n-main"><span class="n-kind">Starts</span><span class="n-name">${esc(tw)}</span>${f.trigger.type === 'schedule' ? weekStrip(f.trigger, (S.flows.find((x) => x.id === f.id) || {}).nextAt) : ''}</span>
      </button>`;
    f.steps.forEach((s, i) => {
      const m = stepMeta(s.type); const st = stat(s.id); const errs = errsFor(s.id);
      const rr = this.run || this.lastRun; const out = rr && rr.steps.find((x) => x.id === s.id);
      html += `<div class="link"><button class="ins" data-at="${i}" title="Add a step here">${icon('plus', 13)}</button></div>
      <button class="node${this.sel === s.id ? ' sel' : ''}${errs.length ? ' err' : ''}${s.off ? ' off' : ''}${st ? ' st-' + st : ''}" data-id="${s.id}" draggable="true">
        ${tile(m.icon, m.color)}
        <span class="n-main"><span class="n-kind">${esc(m.label)}${s.continueOnError ? ' · may fail' : ''}${s.off ? ' · off' : ''}</span><span class="n-name ellip">${esc(s.name || m.label)}</span><span class="n-sum ellip">${out && out.summary && st === 'done' ? esc(out.summary) : out && out.error ? `<span class="bad">${esc(out.error)}</span>` : prettyTok(stepSummary(s))}</span></span>
        <span class="n-stat">${st === 'running' ? '<span class="spin"></span>' : st === 'done' ? icon('check', 15) : st === 'failed' ? icon('alert', 15) : st === 'skipped' ? '<span class="muted tiny">skipped</span>' : errs.length ? icon('alert', 15) : ''}</span>
      </button>`;
    });
    html += `<div class="link end"></div><button class="add-step" data-at="${f.steps.length}">${icon('plus', 16)}Add a step</button></div>`;
    el.innerHTML = html;
    $$('.node', el).forEach((n) => n.onclick = () => this.select(n.dataset.id));
    $$('[data-at]', el).forEach((b) => b.onclick = () => stepPicker(+b.dataset.at));
    // drag to reorder
    let dragId = null;
    $$('.node[draggable]', el).forEach((n) => {
      n.addEventListener('dragstart', (e) => { dragId = n.dataset.id; n.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      n.addEventListener('dragend', () => { n.classList.remove('dragging'); $$('.node', el).forEach((x) => x.classList.remove('drop-above')); });
      n.addEventListener('dragover', (e) => { e.preventDefault(); $$('.node', el).forEach((x) => x.classList.remove('drop-above')); n.classList.add('drop-above'); });
      n.addEventListener('drop', (e) => { e.preventDefault(); const from = f.steps.findIndex((s) => s.id === dragId); const to = f.steps.findIndex((s) => s.id === n.dataset.id); if (from < 0 || to < 0 || from === to) return; const [s] = f.steps.splice(from, 1); f.steps.splice(to, 0, s); this.changed(); });
    });
  },
  select(id) { this.sel = id; this.drawCanvas(); this.drawInspector(); const n = $(`#edCanvas .node[data-id="${id}"]`); if (n) n.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },

  // ───────── inspector
  drawInspector() {
    const el = $('#edInspector'); if (!el) return;
    el.innerHTML = '';
    el.scrollTop = 0;
    if (this.sel === 'trigger') return el.append(this.triggerPane());
    const s = this.draft.steps.find((x) => x.id === this.sel);
    if (!s) { this.sel = 'trigger'; return this.drawInspector(); }
    el.append(this.stepPane(s));
  },
  drawProblems() {
    $$('#edInspector .f').forEach((f) => f.classList.remove('has-err'));
    const box = $('#edProblems'); if (!box) return;
    const id = this.sel === 'trigger' ? null : this.sel;
    const list = this.problems.errors.filter((e) => (id ? e.step === id : !e.step)).concat(this.problems.warnings.filter((e) => (id ? e.step === id : !e.step)).map((w) => ({ ...w, warn: true })));
    box.innerHTML = list.map((p) => `<div class="note${p.warn ? '' : ' bad'}">${icon(p.warn ? 'info' : 'alert', 15)}<span>${esc(p.msg)}</span></div>`).join('');
    for (const p of list) if (p.field && !p.warn) { const f = $(`#edInspector .f[data-key="${p.field}"]`); if (f) f.classList.add('has-err'); }
  },

  triggerPane() {
    const f = this.draft; const t = f.trigger;
    const pane = h('div', { class: 'pane' });
    pane.append(h('div', { class: 'pane-head' }, h('span', { html: tile('clock', 'violet', 'lg') }), h('div', { class: 'grow' }, h('div', { class: 'pane-kind' }, 'When it runs'), h('div', { class: 'pane-title' }, 'Trigger'))));
    pane.append(h('div', { id: 'edProblems' }));
    const seg = h('div', { class: 'seg full' }, ...[['manual', 'When I run it'], ['schedule', 'On a schedule'], ['watch', 'When a file arrives']].map(([k, l]) => h('button', { class: t.type === k ? 'on' : '', onclick: () => {
      if (k === t.type) return;
      f.trigger = k === 'schedule' ? { type: 'schedule', every: 'week', days: [1], time: '08:00', catchUp: true } : k === 'watch' ? { type: 'watch', folder: '~/Downloads', pattern: '*.csv, *.xlsx', subfolders: false } : { type: 'manual' };
      this.changed(); this.drawInspector();
    } }, l)));
    pane.append(seg);
    const body = h('div', { class: 'pane-body' });
    const upd = () => { this.changed(); this.previewSchedule(); };
    if (t.type === 'schedule') {
      const every = h('select', { class: 'select', onchange: () => { t.every = every.value; if (t.every === 'week' && !(t.days || []).length) t.days = [1]; if (['minutes', 'hours'].includes(t.every) && !t.interval) t.interval = t.every === 'minutes' ? 15 : 1; this.changed(); this.drawInspector(); } }, ...[['minutes', 'Every few minutes'], ['hours', 'Every few hours'], ['day', 'Every day'], ['week', 'Every week'], ['month', 'Every month']].map(([k, l]) => h('option', { value: k, selected: t.every === k }, l)));
      body.append(h('div', { class: 'f' }, h('div', { class: 'f-label' }, h('label', {}, 'How often')), every));
      if (['minutes', 'hours', 'week'].includes(t.every)) { const n = h('input', { class: 'input', type: 'number', min: 1, value: t.interval || 1, style: 'width:100px' }); n.oninput = () => { t.interval = Math.max(1, Number(n.value) || 1); upd(); }; body.append(h('div', { class: 'f' }, h('div', { class: 'f-label' }, h('label', {}, t.every === 'week' ? 'Every how many weeks' : t.every === 'hours' ? 'Every how many hours' : 'Every how many minutes')), n)); }
      if (t.every !== 'month') {
        const ws = Number(S.settings.weekStart ?? 1); const order = [0, 1, 2, 3, 4, 5, 6].map((i) => (i + ws) % 7); const L = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const all = !t.days || !t.days.length;
        const days = h('div', { class: 'days' }, ...order.map((d) => h('button', { class: (t.every === 'week' ? (t.days || [1]).includes(d) : all || t.days.includes(d)) ? 'on' : '', onclick: (e) => {
          let cur = t.every === 'week' ? [...(t.days || [1])] : all ? [0, 1, 2, 3, 4, 5, 6] : [...t.days];
          cur = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
          if (!cur.length) return;
          t.days = t.every !== 'week' && cur.length === 7 ? undefined : cur.sort();
          e.currentTarget.classList.toggle('on'); upd(); this.drawCanvas();
        } }, L[d])));
        body.append(h('div', { class: 'f' }, h('div', { class: 'f-label' }, h('label', {}, t.every === 'week' ? 'On' : 'Only on')), days));
      } else {
        const dom = h('select', { class: 'select', onchange: () => { t.dayOfMonth = /^\d+$/.test(dom.value) ? Number(dom.value) : dom.value; upd(); } }, ...[...Array.from({ length: 31 }, (_, i) => [String(i + 1), `The ${i + 1}${['th', 'st', 'nd', 'rd'][((i + 1) % 100 > 10 && (i + 1) % 100 < 14) ? 0 : (i + 1) % 10] || 'th'}`]), ['firstWeekday', 'First weekday'], ['lastWeekday', 'Last weekday'], ['last', 'Last day']].map(([k, l]) => h('option', { value: k, selected: String(t.dayOfMonth || 1) === k }, l)));
        body.append(h('div', { class: 'f' }, h('div', { class: 'f-label' }, h('label', {}, 'On')), dom));
      }
      if (t.every !== 'minutes') { const tm = h('input', { class: 'input', type: 'time', value: t.time || '09:00', style: 'width:140px' }); tm.oninput = () => { t.time = tm.value; upd(); }; body.append(h('div', { class: 'f' }, h('div', { class: 'f-label' }, h('label', {}, t.every === 'hours' ? 'Starting at' : 'At')), tm)); }
      const cu = h('button', { class: 'switch' + (t.catchUp !== false ? ' on' : ''), onclick: () => { cu.classList.toggle('on'); t.catchUp = cu.classList.contains('on'); this.changed(); } });
      body.append(h('div', { class: 'f-bool' }, h('div', { class: 'grow' }, h('label', {}, 'Catch up on missed runs'), h('div', { class: 'hint' }, 'If the computer was asleep or off at that time, run once as soon as it’s back.')), cu));
      body.append(h('div', { class: 'preview', id: 'schedPreview' }));
    } else if (t.type === 'watch') {
      body.append(field({ key: 'folder', label: 'Folder to watch', kind: 'folder', required: true, placeholder: '~/Downloads' }, t, this.ctx(null), () => this.changed()));
      body.append(field({ key: 'pattern', label: 'Files named like', kind: 'text', placeholder: '*.csv, report-*.xlsx', help: 'Only new files count; files already there are left alone.' }, t, this.ctx(null), () => this.changed()));
      body.append(field({ key: 'subfolders', label: 'Include subfolders', kind: 'bool' }, t, this.ctx(null), () => this.changed()));
      body.append(h('div', { class: 'note' }, ic('info', 15), h('span', {}, 'Steps can use the new file as {{inputs.file}} (or {{inputs.files}} when several arrive together).')));
    } else body.append(h('p', { class: 'muted small', style: 'margin:0' }, 'Runs only when you press Run, from the menu-bar icon, or when Claude or Codex runs it.'));
    pane.append(body);

    // automation-wide settings
    const more = h('div', { class: 'pane-body sep' });
    more.append(h('div', { class: 'pane-sub' }, 'About this automation'));
    more.append(field({ key: 'description', label: 'Description', kind: 'textarea', placeholder: 'What it does, for future you' }, f, this.ctx(null), () => this.changed({ canvas: false })));
    more.append(field({ key: 'output', label: 'Default folder', kind: 'folder', placeholder: `${tildify((S.settings.outputRoot || (S.info.documents + '/Cadence')))}/${f.name}`, help: 'Where relative paths in steps go.' }, f, this.ctx(null), () => this.changed({ canvas: false })));
    pane.append(more);
    setTimeout(() => { this.previewSchedule(); this.drawProblems(); }, 0);
    return pane;
  },
  async previewSchedule() {
    const el = $('#schedPreview'); if (!el || this.draft.trigger.type !== 'schedule') return;
    try { const p = await call('flows:preview', this.draft.trigger); el.innerHTML = `<div class="pv-when">${esc(p.when)}</div>${p.next.length ? `<div class="pv-list">${p.next.map((t, i) => `<span class="${i ? '' : 'first'}">${esc(whenAt(t))}</span>`).join('')}</div>` : ''}`; } catch {}
  },

  stepPane(s) {
    const m = stepMeta(s.type); const def = S.cat.steps[s.type];
    const pane = h('div', { class: 'pane' });
    const name = h('input', { class: 'pane-name', value: s.name || '', placeholder: m.label, spellcheck: 'false' });
    name.oninput = () => { s.name = name.value || undefined; this.changed(); };
    const more = h('button', { class: 'icon-btn sm', title: 'More', onclick: () => this.stepMenu(more, s) }, ic('more', 16));
    pane.append(h('div', { class: 'pane-head' }, h('span', { html: tile(m.icon, m.color, 'lg') }), h('div', { class: 'grow' }, h('div', { class: 'pane-kind' }, m.label, h('code', { class: 'sid', title: 'Step id — other steps use {{steps.' + s.id + '.…}}' }, s.id)), name), more));
    pane.append(h('p', { class: 'pane-sum' }, def ? def.summary : ''));
    pane.append(h('div', { id: 'edProblems' }));
    const ctx = this.ctx(s.id);
    const body = h('div', { class: 'pane-body' });
    const drawFields = () => {
      body.innerHTML = '';
      for (const fl of def ? def.fields : []) {
        if (fl.show && !Object.entries(fl.show).every(([k, v]) => { const cur = s.with[k] !== undefined ? s.with[k] : (def.fields.find((x) => x.key === k) || {}).default; return Array.isArray(v) ? v.includes(cur) : cur === v; })) continue;
        body.append(field(fl, s.with, ctx, () => this.changed(), fl.kind === 'select' || fl.kind === 'bool' ? drawFields : null));
      }
      this.drawProblems();
    };
    drawFields();
    pane.append(body);
    // when it fails
    const fails = h('details', { class: 'pane-body sep fails' }, h('summary', {}, 'If it fails'));
    const rt = h('input', { class: 'input', type: 'number', min: 0, max: 5, value: s.retries || 0, style: 'width:90px' }); rt.oninput = () => { s.retries = Number(rt.value) || 0; this.changed(); };
    const keep = h('button', { class: 'switch' + (s.continueOnError ? ' on' : ''), onclick: () => { keep.classList.toggle('on'); s.continueOnError = keep.classList.contains('on'); this.changed(); } });
    fails.append(h('div', { class: 'f' }, h('div', { class: 'f-label' }, h('label', {}, 'Try again')), h('div', { class: 'row' }, rt, h('span', { class: 'muted small' }, 'more times, waiting a little longer each time'))));
    fails.append(h('div', { class: 'f-bool' }, h('div', { class: 'grow' }, h('label', {}, 'Keep going'), h('div', { class: 'hint' }, 'Carry on with the next steps even if this one fails.')), keep));
    if (s.retries || s.continueOnError) fails.open = true;
    pane.append(fails);
    pane.append(h('div', { id: 'edResult' }));
    setTimeout(() => this.drawResult(), 0);
    return pane;
  },
  stepMenu(anchor, s) {
    const f = this.draft; const i = f.steps.indexOf(s);
    menu(anchor, [
      { label: 'Test up to here', icon: 'play', run: () => this.test(s.id) },
      { label: 'Run just this step', icon: 'bolt', run: () => this.test(s.id, true) },
      '-',
      { label: s.off ? 'Switch on' : 'Switch off (skip it)', icon: 'power', run: () => { s.off = !s.off || undefined; this.changed(); this.drawInspector(); } },
      { label: 'Duplicate', icon: 'copy', run: () => { const c = JSON.parse(JSON.stringify(s)); c.id = uniqueId(c.id); c.name = (s.name || stepMeta(s.type).label) + ' copy'; f.steps.splice(i + 1, 0, c); this.sel = c.id; this.changed(); this.drawInspector(); } },
      { label: 'Rename id…', icon: 'edit', run: async () => { const n = await promptBox({ title: 'Rename step id', text: 'Other steps that use this one are updated too.', label: 'Id', value: s.id }); if (n && n !== s.id) { const nid = n.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '').slice(0, 40); if (!nid || f.steps.some((x) => x.id === nid)) return fail(new Error('That id is taken or empty')); renameRefs(f, s.id, nid); s.id = nid; this.sel = nid; this.changed(); this.drawInspector(); } } },
      { label: 'Move up', icon: 'up', disabled: i === 0, run: () => { f.steps.splice(i, 1); f.steps.splice(i - 1, 0, s); this.changed(); } },
      { label: 'Move down', icon: 'down', disabled: i === f.steps.length - 1, run: () => { f.steps.splice(i, 1); f.steps.splice(i + 1, 0, s); this.changed(); } },
      '-',
      { label: 'Delete step', icon: 'trash', danger: true, run: () => { f.steps.splice(i, 1); this.sel = f.steps[Math.max(0, i - 1)] ? f.steps[Math.max(0, i - 1)].id : 'trigger'; this.changed(); this.drawInspector(); } },
    ], { align: 'right', width: 240 });
  },
  drawResult() {
    const el = $('#edResult'); if (!el) return;
    const id = this.sel; const r = this.run || this.lastRun; if (!r) { el.innerHTML = ''; return; }
    const st = r.steps.find((x) => x.id === id); if (!st || st.status === 'pending') { el.innerHTML = ''; return; }
    const out = (this.outputs || {})[id];
    const live = this.run && this.run.status === 'running';
    el.innerHTML = `<div class="result"><div class="res-head">${statusPill(st.status)}<b class="grow">${live ? 'This run' : r.partial ? 'Last test' : 'Last run'}</b>${st.endedAt && st.startedAt ? `<span class="muted small tnum">${fmtDur(st.endedAt - st.startedAt)}</span>` : ''}</div>
      ${st.error ? `<div class="note bad">${icon('alert', 15)}<span>${esc(st.error)}</span></div>` : ''}
      ${out && st.status === 'done' ? outputView(out) : ''}
      ${st.log && st.log.length ? `<details class="log-d" ${st.status === 'failed' ? 'open' : ''}><summary>Log</summary><div class="log">${st.log.map((l) => `<div class="ll ${l.level}"><span class="tnum">${new Date(l.t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>${esc(l.msg)}</div>`).join('')}</div></details>` : ''}</div>`;
    bindOutputs(el);
  },

  // ───────── running from the editor
  async test(upTo, only) {
    await this.flush();
    if (this.problems.errors.length) { const first = this.problems.errors[0]; this.select(first.step || 'trigger'); return toast('Fix this first', first.msg, 'bad'); }
    try {
      const snap = await call('run:start', this.draft.id, upTo ? (only ? { only: upTo, test: true } : { upTo, test: true }) : {});
      upsertRun(snap); this.run = snap; this.outputs = only ? this.outputs : {};
      this.drawCanvas(); this.drawRunBar(); this.drawResult();
    } catch (e) { fail(e); }
  },
  async onRun(snap) {
    if (!this.draft || snap.flowId !== this.draft.id) return;
    if (!this.run || this.run.id === snap.id || snap.startedAt > (this.run.startedAt || 0)) this.run = snap;
    if (['done', 'failed', 'cancelled'].includes(snap.status)) { try { const full = await call('runs:get', snap.id); this.outputs = { ...(full.partial && full.steps.length === 1 ? this.outputs : {}), ...full.outputs }; this.run = full; } catch {} }
    this.drawCanvas(); this.drawRunBar(); this.drawResult();
  },
  drawRunBar() {
    const el = $('#edRun'); if (!el) return;
    const r = this.run;
    if (!r) { el.hidden = true; return; }
    el.hidden = false;
    const done = r.steps.filter((s) => ['done', 'skipped', 'failed', 'off'].includes(s.status)).length;
    const files = r.files || [];
    if (r.status === 'running' || r.status === 'queued') el.innerHTML = `<span class="spin"></span><b>${r.partial ? 'Testing' : 'Running'}</b><span class="muted">Step ${Math.min(done + 1, r.steps.length)} of ${r.steps.length}: ${esc((r.steps.find((s) => s.status === 'running') || {}).name || '')}</span><span class="grow"></span><button class="btn sm" id="rbStop">${icon('stop', 13)}Stop</button>`;
    else el.innerHTML = `${statusPill(r.status)}<b>${r.status === 'done' ? (r.partial ? 'Test finished' : 'Finished') : r.status === 'failed' ? 'Stopped at a problem' : 'Stopped'}</b><span class="muted ellip">${r.status === 'failed' ? esc(r.error || '') : r.endedAt ? `in ${fmtDur(r.endedAt - r.startedAt)}${files.length ? ` · ${files.length} file${files.length === 1 ? '' : 's'}` : ''}` : ''}</span><span class="grow"></span>${files.length ? `<button class="btn sm" id="rbOpen">${icon('reveal', 14)}Show files</button>` : ''}<button class="btn sm" id="rbView">See run</button><button class="icon-btn xs" id="rbX" title="Hide">${icon('x', 13)}</button>`;
    const b = (id, fn) => { const x = $('#' + id); if (x) x.onclick = fn; };
    b('rbStop', () => call('run:cancel', r.id)); b('rbView', () => go('run', r.id)); b('rbX', () => { el.hidden = true; });
    b('rbOpen', () => reveal(files[files.length - 1]));
    if (r.status === 'failed') { const bad = r.steps.find((s) => s.status === 'failed'); if (bad && this.sel !== bad.id && this._failJump !== r.id) { this._failJump = r.id; this.select(bad.id); } }
  },
};

function uniqueId(base) { const taken = new Set(Editor.draft.steps.map((s) => s.id)); let id = String(base).replace(/_\d+$/, ''); let n = 2; let x = id; while (taken.has(x)) x = `${id}_${n++}`; return x; }
function renameRefs(flow, from, to) { const re = new RegExp(`steps\\.${from}(?=[.\\]\\s|}])`, 'g'); for (const s of flow.steps) s.with = JSON.parse(JSON.stringify(s.with).replace(re, `steps.${to}`)); }
// {{steps.save.file | basename}} → a readable chip
function prettyTok(str) {
  return esc(str).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, e) => {
    const head = e.split('|')[0].trim(); const p = head.split('.');
    let label = head;
    if (p[0] === 'steps' && Editor.draft) { const s = Editor.draft.steps.find((x) => x.id === p[1]); const def = s && S.cat.steps[s.type]; const o = def && def.outputs.find((x) => x.key === p[2]); label = `${s ? s.name || def.label : p[1]}${o ? ' › ' + o.label : p[2] ? ' › ' + p.slice(2).join('.') : ''}`; }
    else if (p[0] === 'secrets') label = '🔑 ' + p[1];
    else { const b = BUILTIN_TOKENS.flatMap((g) => g[1]).find((x) => x[0] === head); if (b) label = b[1]; }
    return `<span class="tk">${esc(label)}</span>`;
  });
}
function stepSummary(s) {
  const w = s.with || {}; const host = (u) => { try { return new URL(u).host; } catch { return u || ''; } };
  switch (s.type) {
    case 'web.browser': return `${host(w.url) || 'No start page yet'} · ${(w.actions || []).length} action${(w.actions || []).length === 1 ? '' : 's'}${w.profile && w.profile !== 'default' ? ' · ' + w.profile : ''}`;
    case 'web.download': case 'web.request': return host(w.url) || 'No link yet';
    case 'web.post': return w.text || '';
    case 'folder.make': return w.path || '';
    case 'file.save': return `${w.mode === 'move' ? 'Move' : 'Copy'} into ${w.to || '…'}`;
    case 'file.find': return `${w.pattern || '*'} in ${w.folder || '…'}`;
    case 'file.unzip': return w.file || '';
    case 'file.write': case 'data.write': case 'doc.report': return w.path || '';
    case 'file.cleanup': return `Older than ${w.days || '?'} days in ${w.folder || '…'}`;
    case 'data.read': return w.file || '';
    case 'data.transform': return `${(w.ops || []).length} change${(w.ops || []).length === 1 ? '' : 's'}`;
    case 'data.compare': return w.key ? `Matched by ${w.key}` : 'Totals';
    case 'data.set': return (w.values || []).map((r) => r.key).filter(Boolean).join(', ');
    case 'doc.slides': return `${(w.slides || []).length} slide${(w.slides || []).length === 1 ? '' : 's'} → ${w.path || '…'}`;
    case 'ai.ask': case 'ai.agent': return (w.prompt || w.task || '').slice(0, 120);
    case 'logic.if': return `${w.left || '…'} ${(S.cat.tests.find((t) => t.value === w.test) || {}).label || ''} ${w.right ?? ''}`;
    case 'logic.notify': return w.title || '';
    case 'logic.open': return w.target || '';
    case 'logic.wait': return `${w.seconds || 0} seconds`;
    case 'logic.script': return (w.code || '').split('\n')[0];
    case 'logic.run': return (S.flows.find((f) => f.id === w.flow) || {}).name || '';
    default: return '';
  }
}

// Shared by the editor and the run view: show a step's outputs.
function outputView(out) {
  const parts = [];
  const files = [...new Set([...(Array.isArray(out.files) ? out.files : []), ...(out.file ? [out.file] : [])])].filter((x) => typeof x === 'string');
  if (files.length) parts.push(`<div class="files">${files.slice(0, 30).map((p) => `<div class="fchip" title="${esc(p)}">${icon(/\.pptx$/i.test(p) ? 'slides' : /\.(xlsx|csv)$/i.test(p) ? 'sheet' : /\.pdf$/i.test(p) ? 'report' : 'file', 15)}<span class="ellip">${esc(baseName(p))}</span><button class="icon-btn xs" data-open="${esc(p)}" title="Open">${icon('external', 13)}</button><button class="icon-btn xs" data-reveal="${esc(p)}" title="Show in folder">${icon('reveal', 13)}</button></div>`).join('')}</div>`);
  if (out.folder && !files.length) parts.push(`<div class="files"><div class="fchip">${icon('folder', 15)}<span class="ellip">${esc(tildify(out.folder))}</span><button class="icon-btn xs" data-open="${esc(out.folder)}" title="Open">${icon('external', 13)}</button></div></div>`);
  const t = out.table && out.table.__table ? out.table : null;
  if (t) parts.push(tableView(t));
  if (out.totals) parts.push(`<div class="kv-out">${Object.entries(out.totals).map(([k, v]) => `<div><span>${esc(k)}</span><b class="tnum">${esc(fmtN(v.now))}</b>${v.changePct != null ? `<em class="${v.changePct >= 0 ? 'up' : 'down'}">${v.changePct >= 0 ? '+' : '−'}${Math.abs(v.changePct * 100).toFixed(1)}%</em>` : '<em>first run</em>'}</div>`).join('')}</div>`);
  if (out.json && typeof out.json === 'object') parts.push(`<pre class="json">${esc(JSON.stringify(out.json, null, 2).slice(0, 6000))}</pre>`);
  else if (typeof out.text === 'string' && out.text && !t) parts.push(`<pre class="json">${esc(out.text.slice(0, 6000))}</pre>`);
  if (out.values) parts.push(`<div class="kv-out">${Object.entries(out.values).map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</b></div>`).join('')}</div>`);
  if (out.text && typeof out.text === 'object' && Object.keys(out.text).length) parts.push(`<div class="kv-out">${Object.entries(out.text).map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(Array.isArray(v) ? v.join(', ') : v)}</b></div>`).join('')}</div>`);
  if (out.tables) for (const [n, tb] of Object.entries(out.tables)) if (tb && tb.__table && tb !== out.table) parts.push(`<div class="small muted">${esc(n)}</div>` + tableView(tb));
  return parts.join('') || '<div class="muted small">Nothing to show.</div>';
}
const fmtN = (v) => (typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v ?? '');
function tableView(t) {
  return `<div class="tview"><div class="tv-meta">${t.total.toLocaleString()} row${t.total === 1 ? '' : 's'} · ${t.columns.length} columns${t.total > t.rows.length ? ` · first ${t.rows.length} shown` : ''}</div><div class="tv-scroll"><table><thead><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${t.rows.slice(0, 30).map((r) => `<tr>${t.columns.map((c) => `<td class="${typeof r[c] === 'number' ? 'n' : ''}">${esc(fmtN(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
function bindOutputs(root) {
  $$('[data-open]', root).forEach((b) => b.onclick = () => openPath(b.dataset.open));
  $$('[data-reveal]', root).forEach((b) => b.onclick = () => reveal(b.dataset.reveal));
}

// Step picker
function stepPicker(at) {
  const groups = S.cat.groups.map((g) => ({ ...g, steps: Object.entries(S.cat.steps).filter(([, s]) => s.group === g.id) }));
  const el = openSheet(`<div class="sheet-head"><h3 class="grow">Add a step</h3><input class="input" id="spFind" placeholder="Find a step…" style="width:220px"></div><div class="sheet-body picker">${groups.map((g) => `<div class="pk-group"><div class="pk-label">${esc(g.label)}</div><div class="pk-grid">${g.steps.map(([type, s]) => `<button class="pk" data-type="${type}" data-s="${esc((s.label + ' ' + s.summary).toLowerCase())}">${tile(s.icon, COLORS[s.group])}<span><b>${esc(s.label)}</b><span>${esc(s.summary)}</span></span></button>`).join('')}</div></div>`).join('')}</div>`, { width: 820 });
  $('#spFind').oninput = (e) => { const q = e.target.value.toLowerCase(); $$('.pk', el).forEach((b) => { b.hidden = q && !b.dataset.s.includes(q); }); $$('.pk-group', el).forEach((g) => { g.hidden = !$$('.pk:not([hidden])', g).length; }); };
  $$('.pk', el).forEach((b) => b.onclick = async () => {
    const type = b.dataset.type; const d = await call('step:defaults', type);
    const label = S.cat.steps[type].label;
    const base = { 'web.browser': 'pull', 'web.download': 'download', 'folder.make': 'folder', 'file.save': 'save', 'data.read': 'read', 'data.transform': 'shape', 'data.compare': 'compare', 'doc.slides': 'slides', 'doc.report': 'report', 'ai.ask': 'ai', 'logic.notify': 'notify' }[type] || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20);
    const step = { id: uniqueId(base), type, name: label, with: d };
    // helpful wiring to the step just above
    const prev = Editor.draft.steps[at - 1];
    if (prev) {
      const po = (S.cat.steps[prev.type] || { outputs: [] }).outputs.map((o) => o.key);
      if (type === 'data.read' && po.includes('file')) step.with.file = `{{steps.${prev.id}.file}}`;
      if (['data.transform', 'data.compare'].includes(type) && po.includes('table')) step.with.table = `{{steps.${prev.id}.table}}`;
      if (type === 'file.save' && po.includes('files')) step.with.files = `{{steps.${prev.id}.files}}`;
      if (type === 'data.write' && po.includes('table')) step.with.sheets = [{ name: 'Data', table: `{{steps.${prev.id}.table}}` }];
      if (type === 'ai.ask' && po.includes('table')) step.with.attach = [`{{steps.${prev.id}.table}}`];
    }
    const folderStep = Editor.draft.steps.slice(0, at).find((s) => s.type === 'folder.make');
    if (folderStep && ['doc.slides', 'doc.report', 'data.write'].includes(type)) step.with.path = `{{steps.${folderStep.id}.folder}}/${{ 'doc.slides': 'Report {{week.start}}.pptx', 'doc.report': 'Report {{week.start}}.pdf', 'data.write': 'Data {{week.start}}.xlsx' }[type]}`;
    if (folderStep && type === 'file.save') step.with.to = `{{steps.${folderStep.id}.folder}}`;
    Editor.draft.steps.splice(at, 0, step);
    Editor.sel = step.id; closeSheet(); Editor.changed(); Editor.drawInspector();
  });
}

VIEWS.editor = {
  flush: true,
  head: () => {
    const f = Editor.draft; if (!f) return '';
    return `<button class="icon-btn" id="edBack" title="All automations">${icon('back', 18)}</button><input class="title-input" id="edName" value="${esc(f.name)}" spellcheck="false"><span class="save-state" id="edSave">Saved</span>`;
  },
  actions: () => {
    const f = Editor.draft; if (!f) return '';
    const canSched = f.trigger.type !== 'manual';
    return `${canSched ? `<label class="on-toggle" title="${f.enabled ? 'Switch off' : 'Switch on'}"><span>${f.enabled ? (f.trigger.type === 'watch' ? 'Watching' : 'Scheduled') : 'Off'}</span><button class="switch ${f.enabled ? 'on' : ''}" id="edOn"></button></label>` : ''}
      <button class="btn" id="edTest" title="Run every step without remembering results for comparisons">${icon('play', 14)}Test</button>
      <button class="btn primary" id="edRunBtn">${icon('bolt', 14)}Run now</button>
      <button class="icon-btn" id="edMore" title="More">${icon('more', 18)}</button>`;
  },
  render(view) {
    view.innerHTML = `<div class="editor"><div class="ed-left"><div id="edCanvas" class="canvas"></div><div id="edRun" class="run-bar" hidden></div></div><aside id="edInspector" class="inspector"></aside></div>`;
    if (!Editor.draft || Editor._for !== S.flowId) { Editor.open(S.flowId).then(() => render()); view.innerHTML = '<div class="empty"><span class="spin"></span></div>'; return; }
    Editor.drawCanvas(); Editor.drawInspector(); Editor.drawRunBar();
  },
  after() {
    const f = Editor.draft; if (!f || Editor._for !== S.flowId) return;
    $('#edBack').onclick = () => go('flows');
    const n = $('#edName'); n.oninput = () => { f.name = n.value; Editor.changed({ canvas: false }); };
    const on = $('#edOn'); if (on) on.onclick = async () => { f.enabled = !f.enabled; await Editor.flush(); Editor.changed({ canvas: false }); await Editor.flush(); render(); toast(f.enabled ? `${f.name} is on` : `${f.name} is off`, f.enabled ? (S.flows.find((x) => x.id === f.id) || {}).when || '' : 'It won’t run on its own until you switch it back on.'); };
    $('#edTest').onclick = () => Editor.test(f.steps.length ? f.steps[f.steps.length - 1].id : null);
    $('#edRunBtn').onclick = async () => { await Editor.flush(); if (Editor.problems.errors.length) { const p = Editor.problems.errors[0]; Editor.select(p.step || 'trigger'); return toast('Fix this first', p.msg, 'bad'); } Editor.test(null); };
    $('#edMore').onclick = (e) => menu(e.currentTarget, [
      { label: 'Change with AI…', icon: 'sparkle', run: async () => { await Editor.flush(); describeSheet(Editor.draft); } },
      { label: 'Runs of this automation', icon: 'runs', run: () => { S.runFilter = f.id; go('runs'); } },
      { label: 'Duplicate', icon: 'copy', run: async () => { await Editor.flush(); const d = await call('flows:duplicate', f.id); await loadFlows(); go('editor', d.id); } },
      { label: 'Export…', icon: 'export', run: async () => { await Editor.flush(); const p = await call('flows:export', f.id).catch(fail); if (p) toast('Exported', baseName(p)); } },
      { label: 'Forget last run (for comparisons)', icon: 'refresh', run: async () => { await call('memory:clear', f.id); toast('Forgotten', 'The next run starts a fresh comparison.'); } },
      '-',
      { label: 'Delete automation', icon: 'trash', danger: true, run: async () => { if (await confirmBox({ title: `Delete “${f.name}”?`, text: 'Its schedule stops and it leaves the list. Files it already made stay where they are.', ok: 'Delete', danger: true })) { Editor.dirty = false; await call('flows:remove', f.id); Editor.draft = null; Editor._for = null; await loadFlows(); go('flows'); } } },
    ], { align: 'right', width: 280 });
  },
};
