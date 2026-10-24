// Cadence — form fields for the step inspector, built from the step catalog. Every text box can take {{ }} values;
// the { } button lists what earlier steps produce (and dates, inputs, secrets) and inserts it.
'use strict';

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'value') el.value = v; else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const ic = (name, size = 15) => { const s = document.createElement('span'); s.className = 'icw'; s.innerHTML = icon(name, size); return s; };

const BUILTIN_TOKENS = [
  ['Dates', [['week.label', 'This week’s folder name', 'Week of 2026-10-19'], ['week.range', 'This week', 'Oct 19 – 25, 2026'], ['week.start', 'Week start'], ['week.end', 'Week end'], ['week.iso', 'ISO week', '2026-W43'], ['lastWeek.label', 'Last week’s folder name'], ['lastWeek.range', 'Last week'], ['lastWeek.start', 'Last week start'], ['lastWeek.end', 'Last week end'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['month.label', 'This month', 'October 2026'], ['month.key', 'Month key', '2026-10'], ['lastMonth.label', 'Last month'], ['lastMonth.key', 'Last month key'], ['quarter', 'Quarter', 'Q4 2026'], ['stamp', 'Date and time stamp']]],
  ['This run', [['flow.name', 'Automation name'], ['flow.output', 'Default folder'], ['run.dir', 'Run’s scratch folder'], ['run.id', 'Run id']]],
];

// What a field could insert, from the steps above it.
function tokensFor(ctx, accepts) {
  const groups = [];
  const idx = ctx.flow.steps.findIndex((s) => s.id === ctx.stepId);
  const before = ctx.stepId ? ctx.flow.steps.slice(0, idx < 0 ? ctx.flow.steps.length : idx) : [];
  const want = (kind) => !accepts || accepts.includes(kind) || (accepts.includes('text') && !['table', 'files', 'object', 'list'].includes(kind));
  const stepItems = [];
  for (const s of before) {
    const def = S.cat.steps[s.type]; if (!def) continue;
    for (const o of def.outputs) if (want(o.kind)) stepItems.push([`steps.${s.id}.${o.key}`, `${s.name || def.label} › ${o.label}`, o.kind, s.type]);
    if (s.type === 'data.set') for (const r of (s.with.values || [])) if (r.key) stepItems.push([`vars.${r.key}`, `Value › ${r.key}`, 'text', s.type]);
  }
  if (ctx.flow.trigger.type === 'watch' && want('file')) stepItems.unshift(['inputs.file', 'The new file', 'file', 'trigger']);
  if (ctx.flow.trigger.type === 'watch' && want('files')) stepItems.unshift(['inputs.files', 'All new files', 'files', 'trigger']);
  if (stepItems.length) groups.push(['From earlier steps', stepItems]);
  if (!accepts || accepts.includes('text')) {
    for (const [g, items] of BUILTIN_TOKENS) groups.push([g, items.map(([k, l, ex]) => [k, l, 'text', null, ex])]);
    if (S.secrets.length) groups.push(['Secrets', S.secrets.map((x) => [`secrets.${x.name}`, x.name, 'secret'])]);
  }
  return groups;
}

function tokenPicker(anchor, ctx, accepts, onPick) {
  const groups = tokensFor(ctx, accepts);
  const m = popAt(anchor, `<div class="tp-search"><input class="input" placeholder="Find a value…" spellcheck="false"></div><div class="tp-list">${groups.length ? groups.map(([g, items]) => `<div class="menu-label">${esc(g)}</div>${items.map(([k, l, kind, type, ex]) => `<button class="tp-item" data-k="${esc(k)}" data-s="${esc((k + ' ' + l).toLowerCase())}">${type && type !== 'trigger' ? tile(stepMeta(type).icon, stepMeta(type).color, 'sm') : `<span class="tp-kind">${icon(kind === 'secret' ? 'key' : kind === 'file' || kind === 'files' ? 'file' : 'calendar', 14)}</span>`}<span class="grow"><b>${esc(l)}</b><code>${esc(k)}</code></span>${ex ? `<span class="muted tiny">${esc(ex)}</span>` : ''}</button>`).join('')}`).join('') : '<div class="muted small" style="padding:10px">Nothing to insert yet. Steps above this one will offer their results here.</div>'}</div>`, { width: 380 });
  const inp = m.querySelector('input'); inp.focus();
  inp.oninput = () => { const q = inp.value.toLowerCase(); $$('.tp-item', m).forEach((b) => { b.hidden = q && !b.dataset.s.includes(q); }); };
  $$('.tp-item', m).forEach((b) => b.onclick = () => { closePop(); onPick(b.dataset.k); });
}
function insertToken(input, key, replace) {
  const tok = `{{${key}}}`;
  if (replace) input.value = tok;
  else { const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s; input.value = input.value.slice(0, s) + tok + input.value.slice(e); input.selectionStart = input.selectionEnd = s + tok.length; }
  input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
}
// A text box with the { } button (and optional browse button).
function tokInput({ value, placeholder, multiline, mono, accepts, replace, ctx, onInput, browse, rows }) {
  const inp = multiline ? h('textarea', { class: 'input area' + (mono ? ' mono' : ''), rows: rows || 3, placeholder, spellcheck: 'false' }) : h('input', { class: 'input' + (mono ? ' mono' : ''), placeholder, spellcheck: 'false' });
  inp.value = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : value;
  inp.addEventListener('input', () => onInput(inp.value));
  const tb = h('button', { class: 'icon-btn xs tok-btn', title: 'Insert a value from earlier steps, dates or secrets', onclick: (e) => { e.preventDefault(); tokenPicker(tb, ctx, accepts, (k) => insertToken(inp, k, replace)); } });
  tb.innerHTML = '<span class="brace">{ }</span>';
  const kids = [inp, tb];
  let chip = null;
  if (replace && !multiline) {
    chip = h('button', { class: 'ref-chip', title: 'Click to edit', onclick: (e) => { e.preventDefault(); inp.focus(); } });
    kids.push(chip);
  }
  if (browse) { const bb = h('button', { class: 'icon-btn xs', title: browse === 'folder' ? 'Choose a folder' : 'Choose a file', onclick: async (e) => { e.preventDefault(); try { const p = browse === 'folder' ? await call('dialog:folder', inp.value && !inp.value.includes('{{') ? inp.value : null) : browse === 'save' ? await call('dialog:save', { defaultPath: inp.value && !inp.value.includes('{{') ? inp.value : undefined }) : await call('dialog:file'); if (p) { inp.value = tildify(p); inp.dispatchEvent(new Event('input')); } } catch (er) { fail(er); } } }, ic(browse === 'folder' ? 'folder' : 'file', 14)); kids.push(bb); }
  const wrap = h('div', { class: 'tok-wrap' + (multiline ? ' multi' : '') }, ...kids);
  if (chip) {
    const sync = () => { const single = /^\s*\{\{[^{}]+\}\}\s*$/.test(inp.value); chip.innerHTML = single ? prettyTok(inp.value.trim()) : ''; wrap.classList.toggle('chipped', single && document.activeElement !== inp); };
    inp.addEventListener('blur', sync); inp.addEventListener('focus', () => wrap.classList.remove('chipped'));
    tb.addEventListener('click', () => setTimeout(() => { if (document.activeElement !== inp) sync(); }, 0));
    setTimeout(sync, 0);
  }
  return wrap;
}

// Known columns of the table a field points at, from the last test run.
function columnsOf(ctx, ref) {
  const m = /steps\.([a-z0-9_]+)\.(\w+)/.exec(String(ref || '')); if (!m || !ctx.outputs) return [];
  const o = ctx.outputs[m[1]]; const t = o && o[m[2]];
  if (t && Array.isArray(t.columns)) return t.columns;
  if (o && o.table && Array.isArray(o.table.columns)) return o.table.columns;
  return [];
}
function colList(id, cols) { return cols.length ? h('datalist', { id }, ...cols.map((c) => h('option', { value: c }))) : null; }
let dlSeq = 0;

function labelRow(f, extra) { return h('div', { class: 'f-label' }, h('label', {}, f.label), f.required ? h('span', { class: 'req', title: 'Needed' }, '•') : null, extra || null); }
function field(f, values, ctx, change, rerender) {
  const set = (v) => { values[f.key] = v; change(f.key); };
  const v = values[f.key] !== undefined ? values[f.key] : f.default;
  const wrap = h('div', { class: 'f', 'data-key': f.key });
  const help = f.help ? h('div', { class: 'hint' }, f.help) : null;
  const k = f.kind;
  if (k === 'bool') { const sw = h('button', { class: 'switch' + (v ? ' on' : ''), onclick: () => { sw.classList.toggle('on'); set(sw.classList.contains('on')); if (rerender) rerender(); } }); wrap.append(h('div', { class: 'f-bool' }, h('div', { class: 'grow' }, h('label', {}, f.label), help), sw)); return wrap; }
  wrap.append(labelRow(f));
  if (k === 'select') {
    const sel = h('select', { class: 'select', onchange: () => { set(sel.value); if (rerender) rerender(); } }, ...(f.options || []).map((o) => { const val = typeof o === 'string' ? o : o.value; return h('option', { value: val, selected: String(val) === String(v) }, typeof o === 'string' ? o : o.label); }));
    wrap.append(sel);
  } else if (k === 'number') { const n = h('input', { class: 'input', type: 'number', placeholder: f.placeholder || '', value: v ?? '' }); n.oninput = () => set(n.value === '' ? undefined : Number(n.value)); wrap.append(n); }
  else if (k === 'color') { const c = h('input', { type: 'color', class: 'color', value: v || '#7C5CFF' }); const t = h('input', { class: 'input mono', value: v || '#7C5CFF', style: 'width:110px' }); c.oninput = () => { t.value = c.value; set(c.value); }; t.oninput = () => { if (/^#[0-9a-f]{6}$/i.test(t.value)) { c.value = t.value; set(t.value); } }; wrap.append(h('div', { class: 'row' }, c, t)); }
  else if (k === 'textarea' || k === 'code') wrap.append(tokInput({ value: v, placeholder: f.placeholder, multiline: true, mono: k === 'code', rows: k === 'code' ? 7 : 4, ctx, onInput: set }));
  else if (k === 'folder' || k === 'file') wrap.append(tokInput({ value: v, placeholder: f.placeholder, ctx, onInput: set, browse: k === 'folder' ? 'folder' : /save|path/i.test(f.key) ? 'save' : 'file' }));
  else if (k === 'ref') wrap.append(tokInput({ value: v, placeholder: f.placeholder, ctx, accepts: f.accepts, replace: true, onInput: set }));
  else if (k === 'refs') wrap.append(listEditor(Array.isArray(v) ? v : v ? [v] : [], (arr) => set(arr), (item, upd) => tokInput({ value: item, placeholder: f.placeholder, ctx, accepts: f.accepts, replace: true, onInput: upd }), 'Add', ''));
  else if (k === 'profile') wrap.append(profileField(v, set, f));
  else if (k === 'flow') { const sel = h('select', { class: 'select', onchange: () => set(sel.value) }, h('option', { value: '' }, 'Choose…'), ...S.flows.filter((x) => x.id !== ctx.flow.id).map((x) => h('option', { value: x.id, selected: x.id === v }, x.name))); wrap.append(sel); }
  else if (k === 'kv') wrap.append(kvEditor(Array.isArray(v) ? v : v && typeof v === 'object' ? Object.entries(v).map(([key, value]) => ({ key, value })) : [], set, ctx, f));
  else if (k === 'column') { const id = 'dl' + dlSeq++; const cols = columnsOf(ctx, values.table); const i = h('input', { class: 'input', list: id, placeholder: f.placeholder || '', value: v || '' }); i.oninput = () => set(i.value); wrap.append(i); const dl = colList(id, cols); if (dl) wrap.append(dl); }
  else if (k === 'columns') wrap.append(chipsInput(Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',').map((x) => x.trim()) : [], set, columnsOf(ctx, values.table), f.placeholder));
  else if (k === 'ops') wrap.append(Ops.editor(Array.isArray(v) ? v : [], set, columnsOf(ctx, values.table), ctx));
  else if (k === 'sheets') wrap.append(listEditor(Array.isArray(v) ? v : [], set, (item, upd) => h('div', { class: 'row', style: 'gap:6px' }, (() => { const n = h('input', { class: 'input', placeholder: 'Sheet name', value: item.name || '', style: 'width:130px' }); n.oninput = () => upd({ ...item, name: n.value, table: item.table }); return n; })(), tokInput({ value: item.table, placeholder: '{{steps.read.table}}', ctx, accepts: ['table'], replace: true, onInput: (t) => { item.table = t; upd({ ...item }); } })), 'Add a table', { name: '', table: '' }));
  else if (k === 'actions') wrap.append(Actions.editor(Array.isArray(v) ? v : [], set, ctx, values));
  else if (k === 'slides') wrap.append(Slides.editor(Array.isArray(v) ? v : [], set, ctx));
  else wrap.append(tokInput({ value: v, placeholder: f.placeholder, ctx, onInput: set }));
  if (help) wrap.append(help);
  return wrap;
}

// Generic list with add / remove / move.
function listEditor(items, onChange, renderItem, addLabel, blank) {
  const box = h('div', { class: 'list-ed' });
  const draw = () => {
    box.innerHTML = '';
    items.forEach((it, i) => {
      const row = h('div', { class: 'le-row' }, renderItem(it, (nv) => { items[i] = nv; onChange(items); }),
        h('button', { class: 'icon-btn xs', title: 'Remove', onclick: () => { items.splice(i, 1); onChange(items); draw(); } }, ic('x', 13)));
      box.append(row);
    });
    box.append(h('button', { class: 'link-btn add-btn', onclick: (e) => { e.preventDefault(); items.push(typeof blank === 'object' ? JSON.parse(JSON.stringify(blank)) : blank); onChange(items); draw(); } }, ic('plus', 13), addLabel));
  };
  draw();
  return box;
}
function kvEditor(rows, set, ctx, f) {
  return listEditor(rows, (r) => set(r), (it, upd) => {
    const k = h('input', { class: 'input', placeholder: f.keyLabel || 'Name', value: it.key || '', style: 'width:42%' });
    const v = tokInput({ value: it.value, placeholder: f.valueLabel || 'Value', ctx, onInput: (val) => { it.value = val; upd({ ...it }); } });
    k.oninput = () => { it.key = k.value; upd({ ...it }); };
    return h('div', { class: 'row kv', style: 'gap:6px' }, k, v);
  }, 'Add', { key: '', value: '' });
}
function chipsInput(vals, set, known, placeholder) {
  const box = h('div', { class: 'chips-in' });
  const id = 'dl' + dlSeq++;
  const draw = () => {
    box.innerHTML = '';
    vals.forEach((c, i) => box.append(h('span', { class: 'chip on' }, c, h('button', { class: 'chip-x', onclick: () => { vals.splice(i, 1); set([...vals]); draw(); } }, '×'))));
    const inp = h('input', { class: 'chip-input', list: id, placeholder: vals.length ? '' : placeholder || 'Type a column and press Enter' });
    const add = () => { const t = inp.value.trim().replace(/,$/, ''); if (t && !vals.includes(t)) { vals.push(t); set([...vals]); draw(); box.querySelector('.chip-input').focus(); } };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } if (e.key === 'Backspace' && !inp.value && vals.length) { vals.pop(); set([...vals]); draw(); box.querySelector('.chip-input').focus(); } });
    inp.addEventListener('change', () => { if (known.includes(inp.value)) add(); });
    box.append(inp); if (known.length) box.append(colList(id, known));
  };
  draw(); box.onclick = (e) => { if (e.target === box) box.querySelector('.chip-input').focus(); };
  return box;
}
function profileField(v, set, f) {
  const sel = h('select', { class: 'select grow', onchange: async () => {
    if (sel.value === '__new') { const n = await promptBox({ title: 'New browser profile', text: 'A profile keeps one set of sign-ins (cookies). Use one per account, e.g. “work” or “client-acme”.', label: 'Name', placeholder: 'work' }); if (n) { S.profiles = await call('profiles:add', n); const id = S.profiles[S.profiles.length - 1].id; set(id); redraw(id); } else redraw(v); return; }
    set(sel.value || undefined);
  } });
  const redraw = (val) => { sel.innerHTML = ''; if (f.allowNone) sel.append(h('option', { value: '' }, 'None')); S.profiles.forEach((p) => sel.append(h('option', { value: p.id, selected: p.id === val }, `${p.name}${p.signedInAt ? '' : ' (not signed in)'}`))); sel.append(h('option', { value: '__new' }, 'New profile…')); };
  redraw(v || (f.allowNone ? '' : 'default'));
  return h('div', { class: 'row', style: 'gap:6px' }, sel, f.allowNone ? null : h('button', { class: 'btn sm', title: 'Open a window on this profile and sign in to the site', onclick: async (e) => { e.preventDefault(); const p = sel.value || 'default'; const url = Editor.currentStartUrl(); toast('Sign in, then close the window', 'Cadence keeps the sign-in for later runs.', 'info', 6000); try { S.profiles = await call('profiles:signIn', p, url); toast('Signed in', `Profile “${p}” is ready`); redraw(p); } catch (er) { fail(er); } } }, ic('user', 14), 'Sign in'));
}

// ───────── transform ops
const Ops = {
  KINDS: {
    filter: 'Keep rows where', exclude: 'Remove rows where', select: 'Keep columns', drop: 'Remove columns', rename: 'Rename column', sort: 'Sort by', limit: 'Keep the first / last', group: 'Group and total', total: 'Totals (one row)', compute: 'Add a calculated column', percentOfTotal: 'Add % of total', totalRow: 'Add a total row', dedupe: 'Remove duplicates', fill: 'Fill blanks', skipRows: 'Skip rows at the top',
  },
  editor(ops, set, cols, ctx) {
    const box = h('div', { class: 'ops' });
    const id = 'dl' + dlSeq++;
    const colInput = (o, key, ph) => { const i = h('input', { class: 'input', list: id, placeholder: ph || 'Column', value: o[key] || '' }); i.oninput = () => { o[key] = i.value; set(ops); }; return i; };
    const draw = () => {
      box.innerHTML = '';
      ops.forEach((o, i) => {
        const body = h('div', { class: 'op-body' });
        const t = o.op;
        if (t === 'filter' || t === 'exclude') {
          const test = h('select', { class: 'select', onchange: () => { o.test = test.value; set(ops); draw(); } }, ...S.cat.tests.map((x) => h('option', { value: x.value, selected: x.value === (o.test || 'equals') }, x.label)));
          body.append(colInput(o, 'column'), test);
          if (!['empty', 'notEmpty'].includes(o.test)) body.append(tokInput({ value: o.value, placeholder: 'Value', ctx, onInput: (v) => { o.value = v; set(ops); } }));
          if (o.test === 'between') body.append(tokInput({ value: o.value2, placeholder: 'and', ctx, onInput: (v) => { o.value2 = v; set(ops); } }));
        } else if (t === 'select' || t === 'drop' || t === 'dedupe') body.append(chipsInput(o.columns || [], (v) => { o.columns = v; set(ops); }, cols, t === 'dedupe' ? 'All columns' : 'Columns'));
        else if (t === 'rename') { body.append(colInput(o, 'from')); const to = h('input', { class: 'input', placeholder: 'New name', value: o.to || '' }); to.oninput = () => { o.to = to.value; set(ops); }; body.append(to); }
        else if (t === 'sort') { const d = h('select', { class: 'select', onchange: () => { o.dir = d.value; set(ops); } }, h('option', { value: 'asc', selected: o.dir !== 'desc' }, 'Low to high, A–Z'), h('option', { value: 'desc', selected: o.dir === 'desc' }, 'High to low, Z–A')); body.append(colInput(o, 'column'), d); }
        else if (t === 'limit') { const n = h('input', { class: 'input', type: 'number', value: o.count ?? 10, style: 'width:90px' }); n.oninput = () => { o.count = Number(n.value); set(ops); }; const f = h('select', { class: 'select', onchange: () => { o.from = f.value; set(ops); } }, h('option', { value: 'top' }, 'rows from the top'), h('option', { value: 'bottom', selected: o.from === 'bottom' }, 'rows from the bottom')); body.append(n, f); }
        else if (t === 'group' || t === 'total') {
          if (t === 'group') body.append(h('div', { class: 'op-sub' }, 'Group by'), chipsInput(o.by || [], (v) => { o.by = v; set(ops); }, cols, 'Columns'));
          body.append(h('div', { class: 'op-sub' }, t === 'group' ? 'Totals (leave empty to sum every number column)' : 'Totals'));
          body.append(listEditor(o.aggregates || (o.aggregates = []), (v) => { o.aggregates = v; set(ops); }, (a, upd) => {
            const fn = h('select', { class: 'select', style: 'width:120px', onchange: () => { a.fn = fn.value; upd({ ...a }); } }, ...['sum', 'avg', 'count', 'countDistinct', 'min', 'max', 'median', 'first', 'last'].map((x) => h('option', { value: x, selected: x === (a.fn || 'sum') }, { sum: 'Sum of', avg: 'Average of', count: 'Count of', countDistinct: 'Distinct count of', min: 'Lowest', max: 'Highest', median: 'Median of', first: 'First', last: 'Last' }[x])));
            const c = h('input', { class: 'input', list: id, placeholder: 'Column', value: a.column || '' }); c.oninput = () => { a.column = c.value; upd({ ...a }); };
            const as = h('input', { class: 'input', placeholder: 'Name (optional)', value: a.as || '', style: 'width:120px' }); as.oninput = () => { a.as = as.value || undefined; upd({ ...a }); };
            return h('div', { class: 'row', style: 'gap:6px' }, fn, c, as);
          }, 'Add a total', { fn: 'sum', column: '' }));
        } else if (t === 'compute') { const as = h('input', { class: 'input', placeholder: 'New column name', value: o.as || '' }); as.oninput = () => { o.as = as.value; set(ops); }; const fm = h('input', { class: 'input mono', placeholder: 'round([Spend] / [Signups], 2)', value: o.formula || '' }); fm.oninput = () => { o.formula = fm.value; set(ops); }; body.append(as, fm, h('div', { class: 'hint' }, 'Use [Column] names, + − × ÷, round(), if(), pct(a, b), change(now, before).')); }
        else if (t === 'percentOfTotal') { body.append(colInput(o, 'column')); const as = h('input', { class: 'input', placeholder: 'Name (optional)', value: o.as || '' }); as.oninput = () => { o.as = as.value || undefined; set(ops); }; body.append(as); }
        else if (t === 'totalRow') { const l = h('input', { class: 'input', placeholder: 'Label', value: o.label || 'Total' }); l.oninput = () => { o.label = l.value; set(ops); }; body.append(l); }
        else if (t === 'fill') { body.append(colInput(o, 'column')); const vv = h('input', { class: 'input', placeholder: 'Value (blank = copy from above)', value: o.value || '' }); vv.oninput = () => { o.value = vv.value; set(ops); }; body.append(vv); }
        else if (t === 'skipRows') { const n = h('input', { class: 'input', type: 'number', value: o.count ?? 1, style: 'width:90px' }); n.oninput = () => { o.count = Number(n.value); set(ops); }; body.append(n); }
        const card = h('div', { class: 'op' + (o.off ? ' off' : '') },
          h('div', { class: 'op-head' }, h('span', { class: 'op-n' }, String(i + 1)), h('b', { class: 'grow' }, Ops.KINDS[t] || t),
            h('button', { class: 'icon-btn xs', title: 'Move up', disabled: i === 0, onclick: () => { [ops[i - 1], ops[i]] = [ops[i], ops[i - 1]]; set(ops); draw(); } }, ic('up', 13)),
            h('button', { class: 'icon-btn xs', title: 'Move down', disabled: i === ops.length - 1, onclick: () => { [ops[i + 1], ops[i]] = [ops[i], ops[i + 1]]; set(ops); draw(); } }, ic('down', 13)),
            h('button', { class: 'icon-btn xs', title: 'Remove', onclick: () => { ops.splice(i, 1); set(ops); draw(); } }, ic('x', 13))),
          body);
        box.append(card);
      });
      const add = h('button', { class: 'btn sm add-op', onclick: (e) => { e.preventDefault(); menu(add, Object.entries(Ops.KINDS).map(([k, l]) => ({ label: l, run: () => { ops.push(k === 'filter' || k === 'exclude' ? { op: k, test: 'equals' } : k === 'sort' ? { op: k, dir: 'desc' } : k === 'group' ? { op: k, by: [], aggregates: [] } : k === 'total' ? { op: k, aggregates: [{ fn: 'sum', column: '' }] } : { op: k }); set(ops); draw(); } })), { width: 240 }); } }, ic('plus', 14), 'Add a change');
      box.append(add);
      if (cols.length) box.append(colList(id, cols)); else box.append(h('div', { class: 'hint' }, 'Tip: test the step that reads the data and its column names will be suggested here.'));
    };
    draw();
    return box;
  },
};

// ───────── browser actions
const Actions = {
  editor(acts, set, ctx, values) {
    const box = h('div', { class: 'acts' });
    const BA = S.cat.browserActions;
    const FIELD = { url: 'Address', target: 'What to find', value: 'Value', key: 'Key', timeout: 'Wait up to (s)', seconds: 'Seconds', saveAs: 'Save as (optional)', name: 'Name it', code: 'Script', all: 'Every match', count: 'How many to skip' };
    const PH = { target: 'text=Export CSV  ·  label=Email  ·  #id', key: 'Enter', name: 'e.g. total' };
    const draw = () => {
      box.innerHTML = '';
      const head = h('div', { class: 'acts-head' },
        h('button', { class: 'btn sm rec', title: 'Open the site, click through it, and Cadence writes the steps', onclick: (e) => { e.preventDefault(); Actions.record(acts, set, draw, values); } }, ic('record', 14), 'Record'),
        h('span', { class: 'hint grow' }, 'Click through the site once; Cadence writes these.'));
      box.append(head);
      acts.forEach((a, i) => {
        const def = BA[a.do] || { label: a.do, fields: [] };
        const body = h('div', { class: 'act-body' });
        for (const k of def.fields) {
          if (k === 'all') { const sw = h('label', { class: 'row small', style: 'gap:6px' }, (() => { const c = h('input', { type: 'checkbox', checked: !!a.all }); c.onchange = () => { a.all = c.checked; set(acts); }; return c; })(), 'Every match'); body.append(sw); continue; }
          if (k === 'code') { body.append(tokInput({ value: a.code, placeholder: 'return document.title', multiline: true, mono: true, ctx, onInput: (v) => { a.code = v; set(acts); } })); continue; }
          if (['timeout', 'seconds', 'count'].includes(k)) { const n = h('input', { class: 'input', type: 'number', placeholder: FIELD[k], value: a[k] ?? '', style: 'width:110px', title: FIELD[k] }); n.oninput = () => { a[k] = n.value === '' ? undefined : Number(n.value); set(acts); }; body.append(n); continue; }
          body.append(tokInput({ value: a[k], placeholder: PH[k] || FIELD[k], mono: k === 'target', ctx, onInput: (v) => { a[k] = v; set(acts); } }));
        }
        if (a.do === 'type' && a.secret) body.append(h('div', { class: 'hint warn-hint' }, `Recorded as {{secrets.${a.secret}}} — add that secret in Connections › Secrets.`));
        const sel = h('select', { class: 'select act-do', onchange: () => { a.do = sel.value; set(acts); draw(); } }, ...Object.entries(BA).map(([k, d]) => h('option', { value: k, selected: k === a.do }, d.label)));
        box.append(h('div', { class: 'act' + (a.off ? ' off' : '') },
          h('div', { class: 'act-head' }, h('span', { class: 'op-n' }, String(i + 1)), sel, h('span', { class: 'grow' }),
            h('button', { class: 'icon-btn xs', title: 'Move up', disabled: i === 0, onclick: () => { [acts[i - 1], acts[i]] = [acts[i], acts[i - 1]]; set(acts); draw(); } }, ic('up', 13)),
            h('button', { class: 'icon-btn xs', title: 'Move down', disabled: i === acts.length - 1, onclick: () => { [acts[i + 1], acts[i]] = [acts[i], acts[i + 1]]; set(acts); draw(); } }, ic('down', 13)),
            h('button', { class: 'icon-btn xs', title: 'Remove', onclick: () => { acts.splice(i, 1); set(acts); draw(); } }, ic('x', 13))),
          body));
      });
      const add = h('button', { class: 'btn sm', onclick: (e) => { e.preventDefault(); menu(add, Object.entries(BA).map(([k, d]) => ({ label: d.label, run: () => { acts.push({ do: k }); set(acts); draw(); } })), { width: 230 }); } }, ic('plus', 14), 'Add an action');
      box.append(add);
    };
    draw();
    return box;
  },
  async record(acts, set, draw, values) {
    const url = values.url;
    if (!url || /\{\{/.test(url)) return toast('Put the start page in first', 'Recording opens the site at the Start page address.', 'info');
    try { await call('record:start', values.profile || 'default', url); } catch (e) { return fail(e); }
    const t = toast('Recording', 'Click through the site. Close the window when you’re done.', 'busy', 0);
    const off = C.on('record:event', (ev) => {
      if (ev.type === 'action') { const a = ev.action; const last = acts[acts.length - 1]; if (a.do === 'type' && last && last.do === 'type' && last.target === a.target) acts[acts.length - 1] = a; else acts.push(a); set(acts); draw(); }
      if (ev.type === 'upgrade') { const a = [...acts].reverse().find((x) => x.do === 'click' && x.target === ev.action.target); if (a) { a.do = 'download'; set(acts); draw(); } }
      if (ev.type === 'done') { off(); t.remove(); toast('Recording saved', `${acts.length} action${acts.length === 1 ? '' : 's'}. Test the step to check them.`); }
    });
  },
};

// ───────── slides / report sections
const Slides = {
  editor(slides, set, ctx) {
    const box = h('div', { class: 'slides-ed' });
    const L = S.cat.slideLayouts;
    const txt = (s, key, ph, multi) => tokInput({ value: s[key], placeholder: ph, multiline: multi, ctx, onInput: (v) => { s[key] = v; set(slides); } });
    const draw = () => {
      box.innerHTML = '';
      slides.forEach((s, i) => {
        const lay = s.layout || 'title';
        const body = h('div', { class: 'sl-body' });
        body.append(txt(s, 'title', 'Title'));
        if (lay === 'title' || lay === 'section') body.append(txt(s, 'subtitle', 'Subtitle'));
        if (lay === 'kpis') {
          body.append(listEditor(s.items || (s.items = []), (v) => { s.items = v; set(slides); }, (it, upd) => {
            const mk = (k, ph, w) => { const el = tokInput({ value: it[k], placeholder: ph, ctx, onInput: (v) => { it[k] = v; upd({ ...it }); } }); if (w) el.style.flex = w; return el; };
            const good = h('select', { class: 'select', style: 'width:130px', title: 'Is up good or bad?', onchange: () => { it.good = good.value; upd({ ...it }); } }, h('option', { value: 'up' }, 'Up is good'), h('option', { value: 'down', selected: it.good === 'down' }, 'Down is good'));
            return h('div', { class: 'kpi-ed' }, mk('label', 'Label'), mk('value', 'Value, e.g. {{…totals.Signups.now | number}}'), mk('delta', 'Change (optional), e.g. {{…changePct | change}}'), h('div', { class: 'row', style: 'gap:6px' }, mk('note', 'Note, e.g. vs last week', '1'), good));
          }, 'Add a number', { label: '', value: '' }));
        }
        if (lay === 'chart' || lay === 'table') body.append(tokInput({ value: s.table, placeholder: 'Data: {{steps.….table}}', ctx, accepts: ['table'], replace: true, onInput: (v) => { s.table = v; set(slides); } }));
        if (lay === 'chart') {
          const cols = columnsOf(ctx, s.table); const id = 'dl' + dlSeq++;
          const ch = h('select', { class: 'select', style: 'width:130px', onchange: () => { s.chart = ch.value; set(slides); } }, ...['column', 'bar', 'line', 'area', 'pie', 'doughnut'].map((x) => h('option', { value: x, selected: x === (s.chart || 'column') }, { column: 'Columns', bar: 'Bars', line: 'Line', area: 'Area', pie: 'Pie', doughnut: 'Doughnut' }[x])));
          const x = h('input', { class: 'input', list: id, placeholder: 'Labels from column', value: s.x || '' }); x.oninput = () => { s.x = x.value; set(slides); };
          body.append(h('div', { class: 'row', style: 'gap:6px' }, ch, x), chipsInput(Array.isArray(s.y) ? s.y : s.y ? [s.y] : [], (v) => { s.y = v; set(slides); }, cols, 'Values from columns (blank = all numbers)'), txt(s, 'notes', 'Notes beside the chart, one per line — or {{steps.ai.json.bullets}}', true));
          if (cols.length) body.append(colList(id, cols));
        }
        if (lay === 'table') { body.append(chipsInput(Array.isArray(s.columns) ? s.columns : [], (v) => { s.columns = v; set(slides); }, columnsOf(ctx, s.table), 'Columns to show (blank = all)')); const n = h('input', { class: 'input', type: 'number', placeholder: 'Max rows', value: s.maxRows ?? '', style: 'width:110px' }); n.oninput = () => { s.maxRows = n.value === '' ? undefined : Number(n.value); set(slides); }; body.append(n); }
        if (lay === 'bullets') body.append(txt(s, 'bullets', 'One point per line — or {{steps.ai.json.bullets}}', true));
        if (lay === 'text') body.append(txt(s, 'text', 'Paragraph', true));
        if (lay === 'image') body.append(tokInput({ value: s.image, placeholder: 'Picture file', ctx, accepts: ['file'], browse: 'file', onInput: (v) => { s.image = v; set(slides); } }));
        const sel = h('select', { class: 'select sl-lay', onchange: () => { s.layout = sel.value; set(slides); draw(); } }, ...Object.entries(L).map(([k, d]) => h('option', { value: k, selected: k === lay }, d.label)));
        box.append(h('div', { class: 'sl' },
          h('div', { class: 'sl-head' }, h('span', { class: 'sl-thumb ' + lay }, h('i'), h('i'), h('i')), h('span', { class: 'op-n' }, String(i + 1)), sel, h('span', { class: 'grow' }),
            h('button', { class: 'icon-btn xs', title: 'Move up', disabled: i === 0, onclick: () => { [slides[i - 1], slides[i]] = [slides[i], slides[i - 1]]; set(slides); draw(); } }, ic('up', 13)),
            h('button', { class: 'icon-btn xs', title: 'Move down', disabled: i === slides.length - 1, onclick: () => { [slides[i + 1], slides[i]] = [slides[i], slides[i + 1]]; set(slides); draw(); } }, ic('down', 13)),
            h('button', { class: 'icon-btn xs', title: 'Duplicate', onclick: () => { slides.splice(i + 1, 0, JSON.parse(JSON.stringify(s))); set(slides); draw(); } }, ic('copy', 13)),
            h('button', { class: 'icon-btn xs', title: 'Remove', onclick: () => { slides.splice(i, 1); set(slides); draw(); } }, ic('x', 13))),
          body));
      });
      const add = h('button', { class: 'btn sm', onclick: (e) => { e.preventDefault(); menu(add, Object.entries(L).map(([k, d]) => ({ label: d.label, run: () => { slides.push({ layout: k, title: '' }); set(slides); draw(); } })), { width: 200 }); } }, ic('plus', 14), 'Add a slide');
      box.append(add);
    };
    draw();
    return box;
  },
};
