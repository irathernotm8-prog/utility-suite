// Concourse — Manifest: your self-assigned tasks. Local tasks live on this computer; Microsoft To Do tasks sync both
// ways when an account is connected. Tasks made from a message or a meeting keep a link back to it.
(() => {
  let root, els = {}, show = 'open', srcFilter = 'all';

  function dueText(t, now = Date.now()) {
    if (!t.due) return '';
    const d = Math.round((M.startOfDay(t.due) - M.startOfDay(now)) / 864e5);
    if (d < -1) return `${-d} days late`; if (d === -1) return 'Yesterday';
    if (d === 0) return 'Today'; if (d === 1) return 'Tomorrow'; if (d < 7) return new Date(t.due).toLocaleDateString([], { weekday: 'long' });
    return dayLabel(t.due);
  }

  /** One task line, used on the Board and here. */
  window.taskRow = (t, o = {}) => {
    const now = Date.now(); const st = M.dueState(t, now);
    const box = h('button.tbox' + (t.done ? '.on' : ''), { title: t.done ? 'Mark not done' : 'Done', html: ic('check'), onclick: (e) => { e.stopPropagation(); el.classList.add('flip'); run(C.call('updateTask', { id: t.id, patch: { done: !t.done } })); } });
    const star = h('button.tstar' + (t.important ? '.on' : ''), { title: 'Important', html: ic('star'), onclick: (e) => { e.stopPropagation(); run(C.call('updateTask', { id: t.id, patch: { important: !t.important } })); } });
    const meta = [];
    if (t.due) meta.push(h('span.tag.' + (st === 'overdue' ? 'red' : st === 'today' ? 'lamp' : ''), dueText(t, now)));
    if (t.source === 'todo') { const l = Object.values(S.state.todoLists || {}).flat().find(x => x.id === t.listId); meta.push(h('span.tag.cyan', l ? l.name : 'To Do')); }
    if (t.link && (t.link.chatId || t.link.eventId)) meta.push(h('button.tag', { onclick: (e) => { e.stopPropagation(); if (t.link.chatId) go('chats', { chatId: t.link.chatId, accountId: t.link.accountId }); else go('calendar', { eventId: t.link.eventId }); } }, icon(t.link.chatId ? 'chat' : 'cal'), (t.link.title || 'Open').slice(0, 22)));
    const el = h('div.task' + (t.done ? '.done' : '') + '.st-' + st + (o.compact ? '.compact' : ''), { onclick: () => editTask(t) }, box, h('div.tbody2', h('div.tt2', t.title), (t.notes && !o.compact) ? h('div.tn2', t.notes.slice(0, 140)) : null, meta.length ? h('div.tm2', ...meta) : null), star);
    return el;
  };

  function mount(main) {
    root = main; els = {};
    const seg = h('div.seg', ...[['open', 'Open'], ['done', 'Done']].map(([k, l]) => h('button' + (k === show ? '.on' : ''), { onclick: (e) => { show = k; $$('button', seg).forEach(b => b.classList.toggle('on', b === e.currentTarget)); draw(); } }, l)));
    const src = h('div.seg', ...[['all', 'All'], ['local', 'This computer'], ['todo', 'To Do']].map(([k, l]) => h('button' + (k === srcFilter ? '.on' : ''), { onclick: (e) => { srcFilter = k; $$('button', src).forEach(b => b.classList.toggle('on', b === e.currentTarget)); draw(); } }, l)));
    const title = h('span'); flap(title, 'MANIFEST', { instant: true });
    els.add = addBar();
    els.cols = h('div.mcols');
    main.append(h('header.top.cal', h('div.cl', h('span.eyebrow', 'Your tasks'), title), h('div.grow'), src, seg), els.add, els.cols);
    draw();
  }

  function addBar() {
    let due = M.startOfDay(Date.now()) + 12 * 3600e3, important = false;
    const input = h('input.input.big', { placeholder: 'Add a task — e.g. “Send the Spanish door-hanger copy”' });
    const dueSeg = h('div.seg', ...[['Today', 0], ['Tomorrow', 1], ['Next week', 7], ['Someday', null]].map(([l, n], i) => h('button' + (i === 0 ? '.on' : ''), { onclick: (e) => { due = n == null ? null : M.addDays(M.startOfDay(Date.now()), n) + 12 * 3600e3; $$('button', dueSeg).forEach(b => b.classList.toggle('on', b === e.currentTarget)); } }, l)));
    const star = h('button.btn.icon', { title: 'Important', html: ic('star'), onclick: () => { important = !important; star.classList.toggle('onlamp', important); } });
    const target = targetSelect();
    const add = async () => {
      const t = input.value.trim(); if (!t) return;
      input.value = '';
      await run(C.call('addTask', { title: t, due, important, myDay: due != null && M.startOfDay(due) === M.startOfDay(Date.now()), target: target.value }));
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    return h('div.addbar', icon('plus'), input, dueSeg, star, target, h('button.btn.lamp', { onclick: add }, 'Add'));
  }
  function targetSelect(value) {
    const s = h('select.input.tsel', h('option', { value: 'local' }, 'This computer'));
    for (const a of S.state.accounts) for (const l of (S.state.todoLists || {})[a.id] || []) s.append(h('option', { value: `todo:${a.id}:${l.id}` }, `To Do · ${l.name}${S.state.accounts.length > 1 ? ' (' + a.username + ')' : ''}`));
    s.value = value || S.state.settings.taskTarget || 'local'; if (!s.value) s.value = 'local';
    return s;
  }

  function draw() {
    if (!els.cols) return;
    const now = Date.now();
    let tasks = [...(S.state.tasks || []), ...(S.state.todo || [])];
    if (srcFilter !== 'all') tasks = tasks.filter(t => (t.source || 'local') === srcFilter);
    els.cols.textContent = '';
    if (show === 'done') {
      const done = tasks.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
      els.cols.append(col('Arrived', 'Completed', done, 'green'));
      return;
    }
    const open = tasks.filter(t => !t.done);
    const g = { overdue: [], today: [], upcoming: [], someday: [] };
    for (const t of open) { const s = M.dueState(t, now); (g[s === 'someday' && t.myDay ? 'today' : s] || g.someday).push(t); }
    const sort = (l) => l.sort((a, b) => ((b.important ? 1 : 0) - (a.important ? 1 : 0)) || ((a.due || 9e15) - (b.due || 9e15)) || (b.createdAt - a.createdAt));
    els.cols.append(col('Delayed', 'Overdue', sort(g.overdue), 'red'), col('Boarding', 'Due today', sort(g.today), 'lamp'), col('Scheduled', 'Coming up', sort(g.upcoming), 'white'), col('Standby', 'No date', sort(g.someday), 'dim'));
  }
  function col(title, sub, list, tone) {
    const t = h('span'); flap(t, title, { instant: true, tone: tone === 'lamp' ? undefined : tone });
    return h('section.board.mcol', h('header', t, h('span.sub', sub), h('span.grow'), list.length ? h('span.count', list.length) : null), h('div.body', list.length ? list.map(x => window.taskRow(x)) : h('div.empty', '—')));
  }

  function editTask(t) {
    const m = modal({ title: 'Task' });
    const title = h('input.input', { value: t.title });
    const notes = h('textarea.input', { rows: 4, placeholder: 'Notes' }); notes.value = t.notes || '';
    const due = h('input.input', { type: 'date', value: t.due ? M.dayKey(t.due) : '' });
    const imp = h('input', { type: 'checkbox', checked: !!t.important });
    m.body.append(h('div.field', h('label', 'Title'), title), h('div.field', h('label', 'Due'), due), h('label.check', imp, h('span.sw'), h('span', 'Important')), h('div.field', h('label', 'Notes'), notes),
      h('div.dim.small', t.source === 'todo' ? 'Synced with Microsoft To Do' : 'Saved on this computer'));
    m.foot.append(h('button.btn.danger', { onclick: async () => { await run(C.call('deleteTask', { id: t.id }), 'Task deleted'); m.close(); } }, icon('trash'), 'Delete'), h('div.grow'), h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), h('button.btn.lamp', { onclick: async () => {
      const patch = { title: title.value.trim() || t.title, notes: notes.value, important: imp.checked, due: due.value ? new Date(due.value + 'T12:00').getTime() : null };
      await run(C.call('updateTask', { id: t.id, patch })); m.close();
    } }, 'Save'));
  }

  /** Quick task from anywhere (a message, a meeting, ⌘T). */
  window.newTask = (pre = {}) => {
    const m = modal({ title: 'New task' });
    const title = h('input.input', { value: pre.title || '', placeholder: 'What needs doing?' });
    const notes = h('textarea.input', { rows: 3, placeholder: 'Notes' }); notes.value = pre.notes || '';
    const due = h('input.input', { type: 'date', value: M.dayKey(pre.due || Date.now()) });
    const imp = h('input', { type: 'checkbox' });
    const target = targetSelect();
    m.body.append(h('div.field', h('label', 'Title'), title), h('div.frow', h('div.field', h('label', 'Due'), due), h('div.field', h('label', 'Save to'), target)), h('label.check', imp, h('span.sw'), h('span', 'Important')), h('div.field', h('label', 'Notes'), notes),
      pre.link ? h('div.dim.small', icon(pre.link.chatId ? 'chat' : 'cal'), ' Linked to ', h('b', pre.link.title || '')) : null);
    const save = async () => { if (!title.value.trim()) return; await run(C.call('addTask', { title: title.value.trim(), notes: notes.value, due: due.value ? new Date(due.value + 'T12:00').getTime() : null, important: imp.checked, link: pre.link || null, target: target.value }), 'Added to the manifest'); m.close(); };
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    m.foot.append(h('div.grow'), h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), h('button.btn.lamp', { onclick: save }, 'Add task'));
    title.focus(); title.select();
  };

  S.views.tasks = { mount, update: (parts) => { if (parts.some(p => ['tasks', 'todo', 'all'].includes(p))) draw(); }, tick: () => {} };
})();
