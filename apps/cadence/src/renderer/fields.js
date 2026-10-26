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
    if (s.type === 'web.browser' || s.type === 'app.use') for (const a of (s.with.actions || [])) {
      if (!a || !a.name) continue;
      const nm = /^\w+$/.test(a.name) ? `.${a.name}` : `["${a.name}"]`;
      if ((a.do === 'extractTable' || a.do === 'extractList' || a.do === 'clipboard') && want('table')) stepItems.push([`steps.${s.id}.tables${nm}`, `${s.name || def.label} › table “${a.name}”`, 'table', s.type]);
      if (a.do === 'extractList' && (!accepts || accepts.includes('text'))) {
        stepItems.push([`steps.${s.id}.values${nm}`, `${s.name || def.label} › “${a.name}” values`, 'object', s.type]);
        const known = getPath({ steps: ctx.outputs || {} }, `steps.${s.id}.values${nm}`);
        if (known && typeof known === 'object') for (const k of Object.keys(known).slice(0, 20)) stepItems.push([`steps.${s.id}.values${nm}${/^\w+$/.test(k) ? '.' + k : `["${k}"]`}`, `${s.name || def.label} › ${k}`, 'text', s.type]);
      }
      if ((a.do === 'extractText' || a.do === 'script' || a.do === 'appScript' || a.do === 'clipboard') && (!accepts || accepts.includes('text'))) stepItems.push([`steps.${s.id}.text${nm}`, `${s.name || def.label} › text “${a.name}”`, 'text', s.type]);
    }
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
  const set = (v) => { values[f.key] = v; change(f.key); if (f.key === 'template' && f.kind === 'file') { clearTimeout(PptMap._t); PptMap._t = setTimeout(() => PptMap.reload && PptMap.reload(), 700); } };
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
  else if (k === 'app') wrap.append(appField(v, set, values, rerender));
  else if (k === 'pptmap') wrap.append(PptMap.editor(values, set, ctx));
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
    const step = ctx.flow.steps.find((x) => x.id === ctx.stepId) || {};
    const isApp = step.type === 'app.use';
    const mode = isApp ? (values.control || 'inside') : 'web';
    const scopes = mode === 'keys' ? ['native', 'any'] : mode === 'inside' ? ['page', 'native', 'any'] : ['page', 'any'];
    const allowed = Object.entries(BA).filter(([, d]) => scopes.includes(d.scope || 'page'));
    const FIELD = { url: 'Address', target: 'What to find', value: 'Value', key: 'Key', timeout: 'Wait up to (s)', seconds: 'Seconds', saveAs: 'Save as (optional)', name: 'Name it', code: 'Script', all: 'Every match', count: 'How many to skip', fields: 'Fields', keys: 'Shortcut', menu: 'Menu path', wait: 'Then wait (s)' };
    const PH = { target: 'text=Export CSV  ·  label=Email  ·  #id', key: 'Enter', name: 'e.g. total', fields: 'Label=.label, Value=.value  (blank = each card’s text)', keys: 'cmd+shift+e  ·  ctrl+s  ·  alt+f, x', menu: 'File > Export > CSV…', code: '' };
    if (mode === 'keys') PH.value = 'Text to type, or a file to open';
    const draw = () => {
      box.innerHTML = '';
      if (mode !== 'keys') box.append(h('div', { class: 'acts-head' },
        h('button', { class: 'btn sm rec', title: isApp ? 'Open the app, click through it, and Cadence writes the steps' : 'Open the site, click through it, and Cadence writes the steps', onclick: (e) => { e.preventDefault(); isApp ? Actions.recordApp(acts, set, draw, values) : Actions.record(acts, set, draw, values); } }, ic('record', 14), 'Record'),
        h('span', { class: 'hint grow' }, isApp ? 'Click through the app once; Cadence writes these.' : 'Click through the site once; Cadence writes these.')));
      else box.append(h('div', { class: 'hint' }, S.info.platform === 'darwin' ? 'Shortcuts and menus need Cadence switched on in System Settings › Privacy & Security › Accessibility.' : 'Shortcuts are sent to the app’s window. Menus can’t be picked by name on Windows; use their alt-key shortcuts.'));
      acts.forEach((a, i) => {
        const def = BA[a.do] || { label: a.do, fields: [] };
        const body = h('div', { class: 'act-body' });
        for (const k of def.fields) {
          if (k === 'all') { const sw = h('label', { class: 'row small', style: 'gap:6px' }, (() => { const c = h('input', { type: 'checkbox', checked: !!a.all }); c.onchange = () => { a.all = c.checked; set(acts); }; return c; })(), 'Every match'); body.append(sw); continue; }
          if (k === 'code') { body.append(tokInput({ value: a.code, placeholder: isApp ? 'window.lumen ? document.title : …' : 'return document.title', multiline: true, mono: true, ctx, onInput: (v) => { a.code = v; set(acts); } })); continue; }
          if (k === 'code' && a.do === 'appScript') { body.append(tokInput({ value: a.code, placeholder: S.info.platform === 'win32' ? 'PowerShell, e.g. Get-Clipboard' : 'AppleScript, e.g. tell application "Finder" to …', multiline: true, mono: true, ctx, onInput: (v) => { a.code = v; set(acts); } })); continue; }
          if (['timeout', 'seconds', 'count', 'wait'].includes(k)) { const n = h('input', { class: 'input', type: 'number', placeholder: FIELD[k], value: a[k] ?? '', style: 'width:110px', title: FIELD[k] }); n.oninput = () => { a[k] = n.value === '' ? undefined : Number(n.value); set(acts); }; body.append(n); continue; }
          body.append(tokInput({ value: a[k], placeholder: PH[k] || FIELD[k], mono: k === 'target', ctx, onInput: (v) => { a[k] = v; set(acts); } }));
        }
        if (a.do === 'type' && a.secret) body.append(h('div', { class: 'hint warn-hint' }, `Recorded as {{secrets.${a.secret}}} — add that secret in Connections › Secrets.`));
        if (!def.fields.length) body.append(h('div', { class: 'hint' }, 'Nothing to fill in.'));
        const sel = h('select', { class: 'select act-do', onchange: () => { a.do = sel.value; set(acts); draw(); } }, ...(allowed.some(([k]) => k === a.do) ? allowed : [[a.do, def], ...allowed]).map(([k, d]) => h('option', { value: k, selected: k === a.do }, d.label)));
        box.append(h('div', { class: 'act' + (a.off ? ' off' : '') },
          h('div', { class: 'act-head' }, h('span', { class: 'op-n' }, String(i + 1)), sel, h('span', { class: 'grow' }),
            h('button', { class: 'icon-btn xs', title: 'Move up', disabled: i === 0, onclick: () => { [acts[i - 1], acts[i]] = [acts[i], acts[i - 1]]; set(acts); draw(); } }, ic('up', 13)),
            h('button', { class: 'icon-btn xs', title: 'Move down', disabled: i === acts.length - 1, onclick: () => { [acts[i + 1], acts[i]] = [acts[i], acts[i + 1]]; set(acts); draw(); } }, ic('down', 13)),
            h('button', { class: 'icon-btn xs', title: 'Remove', onclick: () => { acts.splice(i, 1); set(acts); draw(); } }, ic('x', 13))),
          body));
      });
      const add = h('button', { class: 'btn sm', onclick: (e) => { e.preventDefault(); const page = allowed.filter(([, d]) => d.scope !== 'native'), nat = allowed.filter(([, d]) => d.scope === 'native'); menu(add, [...(page.length && nat.length ? [{ header: true, label: 'Inside the window' }] : []), ...page.map(([k, d]) => ({ label: d.label, run: () => { acts.push({ do: k }); set(acts); draw(); } })), ...(nat.length && page.length ? [{ header: true, label: 'Keyboard and menus' }] : []), ...nat.map(([k, d]) => ({ label: d.label, run: () => { acts.push({ do: k }); set(acts); draw(); } }))], { width: 250 }); } }, ic('plus', 14), 'Add an action');
      box.append(add);
    };
    draw();
    return box;
  },
  async recordApp(acts, set, draw, values) {
    if (!values.app) return toast('Choose the app first', '', 'info');
    const t = toast('Opening ' + values.app, 'Cadence restarts it once so it can follow your clicks.', 'busy', 0);
    try { await call('record:startApp', values.app); } catch (e) { t.remove(); return fail(e); }
    t.remove();
    const bar = toast('Recording in ' + values.app, 'Click through the app, then press Stop here.', 'busy', 0);
    const stop = h('button', { class: 'btn sm', style: 'margin-left:8px', onclick: () => call('record:stopApp') }, 'Stop'); bar.append(stop);
    const off = C.on('record:event', (ev) => {
      if (ev.type === 'action') { const a = ev.action; const last = acts[acts.length - 1]; if (a.do === 'type' && last && last.do === 'type' && last.target === a.target) acts[acts.length - 1] = a; else acts.push(a); set(acts); draw(); }
      if (ev.type === 'done') { off(); bar.remove(); toast('Recording saved', `${acts.length} action${acts.length === 1 ? '' : 's'}. Add “Copy table” or “Copy cards” actions for the numbers you want, then test the step.`); }
    });
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


// ───────── app picker
async function loadApps(fresh) { if (!S.apps || fresh) S.apps = await call('apps:list', !!fresh).catch(() => []); return S.apps; }
function appField(v, set, values, rerender) {
  const box = h('div', { class: 'col', style: 'gap:6px' });
  const sel = h('select', { class: 'select grow' });
  const hint = h('div', { class: 'hint' });
  const describe = (name) => {
    const a = (S.apps || []).find((x) => x.name === name);
    hint.textContent = !name ? '' : !a ? 'Not found in Applications — use Browse to pick it.' : a.kind === 'native' ? `${a.name} is a regular app: Cadence can open it and use its keyboard shortcuts, menus and clipboard.` : `Cadence can read and click inside ${a.name}${a.suite ? ' (Utility Suite)' : ''}.`;
    if (a && a.kind === 'native' && values.control === 'inside') { values.control = 'keys'; if (rerender) setTimeout(rerender, 0); }
  };
  const draw = () => {
    sel.innerHTML = '';
    sel.append(h('option', { value: '' }, 'Choose an app…'));
    const list = S.apps || [];
    const suite = list.filter((a) => a.suite), inside = list.filter((a) => !a.suite && a.kind !== 'native'), other = list.filter((a) => !a.suite && a.kind === 'native');
    const grp = (label, items) => { if (!items.length) return; const g = h('optgroup', { label }); items.forEach((a) => g.append(h('option', { value: a.name, selected: a.name === v }, a.name))); sel.append(g); };
    grp('Utility Suite', suite); grp('Cadence can read inside', inside); grp('Keyboard and menus', other);
    if (v && !list.some((a) => a.name === v)) sel.append(h('option', { value: v, selected: true }, v.split(/[\\/]/).pop()));
    describe(v);
  };
  sel.onchange = () => { v = sel.value; set(v); describe(v); };
  const browse = h('button', { class: 'btn sm', onclick: async (e) => { e.preventDefault(); const p = await call('dialog:file', S.info.platform === 'win32' ? { filters: [{ name: 'Apps', extensions: ['exe'] }] } : {}).catch(fail); if (p) { v = p.replace(/\/Contents\/MacOS\/.*$/, ''); set(v); draw(); } } }, 'Browse…');
  box.append(h('div', { class: 'row', style: 'gap:6px' }, sel, browse), hint);
  loadApps().then(draw);
  draw();
  return box;
}

// ───────── PowerPoint template map
const PptMap = {
  cache: {},
  editor(values, set, ctx) {
    const box = h('div', { class: 'pmap' });
    values.fills = Array.isArray(values.fills) ? values.fills : [];
    values.repeat = Array.isArray(values.repeat) ? values.repeat : [];
    let sel = null; // { slide, shape }
    const save = () => set(values.fills);
    const keyOf = (slide, id) => `${slide}:${id}`;
    const fillOf = (slide, id) => values.fills.find((f) => Number(f.slide) === slide && f.shape && String(f.shape.id) === String(id));
    const literal = () => { const t = values.template; return typeof t === 'string' && t.trim() && !/\{\{/.test(t) ? t.trim() : null; };
    const load = async (fresh) => {
      const p = literal();
      if (!p) { box.innerHTML = ''; box.append(h('div', { class: 'note' }, ic('info', 15), h('span', {}, 'Choose the template above to see its slides here. (A template path that uses {{ }} can still be filled — map it by typing {{ }} into the deck.)'))); return; }
      box.innerHTML = '<div class="muted small"><span class="spin"></span> Reading the template…</div>';
      try { if (fresh || !PptMap.cache[p]) PptMap.cache[p] = await call('pptx:inspect', p); draw(PptMap.cache[p]); }
      catch (e) { box.innerHTML = ''; box.append(h('div', { class: 'note bad' }, ic('alert', 15), h('span', {}, e.message))); }
    };
    const draw = (an) => {
      box.innerHTML = '';
      const filled = values.fills.length + values.repeat.length;
      box.append(h('div', { class: 'pm-head' },
        h('span', { class: 'grow small muted' }, `${an.slideCount} slide${an.slideCount === 1 ? '' : 's'} · ${filled ? `${filled} filled` : 'nothing mapped yet'}${an.theme && an.theme.headFont ? ` · ${an.theme.headFont}${an.theme.bodyFont && an.theme.bodyFont !== an.theme.headFont ? ' / ' + an.theme.bodyFont : ''}` : ''}`),
        h('button', { class: 'btn sm', title: 'Read the template again (after you change it)', onclick: (e) => { e.preventDefault(); load(true); } }, ic('refresh', 13)),
        h('button', { class: 'btn sm primary', onclick: (e) => { e.preventDefault(); PptMap.ai(values, ctx, an, () => { save(); draw(an); }); } }, ic('sparkle', 13), 'Map with AI')));
      box.append(h('div', { class: 'hint' }, 'Click a box on a slide to choose what goes there. Text you leave alone stays as it is; numbers keep the template’s format.'));
      const strip = h('div', { class: 'pm-strip' });
      for (const sl of an.slides) {
        const rep = values.repeat.find((r) => Number(r.slide) === sl.index);
        const frame = h('div', { class: 'pm-slide' + (rep ? ' rep' : ''), style: `aspect-ratio:${an.size.ratio}` });
        for (const sh of sl.shapes) {
          if (!sh.box || !['text', 'table', 'chart', 'picture'].includes(sh.kind)) continue;
          const f = fillOf(sl.index, sh.id);
          const tok = sh.tokens && sh.tokens.length;
          const b = h('button', { class: `pm-box k-${sh.kind}${f ? ' on' : ''}${tok ? ' tok' : ''}${sel && sel.slide === sl.index && String(sel.shape.id) === String(sh.id) ? ' sel' : ''}`, title: `${sh.name}${sh.text ? ': ' + sh.text.slice(0, 80) : ''}${tok ? '\n(already has {{ }} in it)' : ''}`, style: `left:${(sh.box.x * 100).toFixed(2)}%;top:${(sh.box.y * 100).toFixed(2)}%;width:${(sh.box.w * 100).toFixed(2)}%;height:${(sh.box.h * 100).toFixed(2)}%`, onclick: (e) => { e.preventDefault(); sel = { slide: sl.index, shape: sh }; draw(an); } });
          b.append(h('span', {}, sh.kind === 'table' ? '▦' : sh.kind === 'chart' ? '▮▮' : sh.kind === 'picture' ? '◩' : (sh.text || '').slice(0, 40)));
          frame.append(b);
        }
        const card = h('div', { class: 'pm-card' }, frame, h('div', { class: 'pm-cap' }, h('b', {}, String(sl.index)), h('span', { class: 'ellip' }, sl.title), rep ? h('span', { class: 'pill acc' }, 'Repeats') : null));
        strip.append(card);
      }
      box.append(strip);
      if (sel) box.append(PptMap.panel(values, ctx, an, sel, () => { save(); draw(an); }, () => { sel = null; draw(an); }));
      const list = values.fills.map((f, i) => { const sl = an.slides.find((s) => s.index === Number(f.slide)); const sh = sl && sl.shapes.find((x) => String(x.id) === String(f.shape.id)); return h('button', { class: 'pm-item', onclick: (e) => { e.preventDefault(); if (sh) { sel = { slide: sl.index, shape: sh }; draw(an); } } }, h('b', {}, `Slide ${f.slide}`), h('span', { class: 'ellip' }, `${sh ? sh.name : '(missing) ' + (f.shape.name || f.shape.id)} ← `), h('span', { class: 'ellip', html: prettyTok(String(f.kind === 'table' || f.kind === 'chart' ? f.table || '' : f.value || '')) })); });
      const reps = values.repeat.map((r) => h('div', { class: 'pm-item' }, h('b', {}, `Slide ${r.slide}`), h('span', { class: 'ellip', html: 'one per row of ' + prettyTok(String(r.table || '')) })));
      if (list.length || reps.length) box.append(h('div', { class: 'pm-list' }, ...list, ...reps));
    };
    load();
    // reload when the template path changes
    box.dataset.watch = '1';
    PptMap.reload = () => load(true);
    return box;
  },
  panel(values, ctx, an, sel, changed, close) {
    const sh = sel.shape; const slide = sel.slide;
    let f = values.fills.find((x) => Number(x.slide) === slide && String(x.shape.id) === String(sh.id));
    const kinds = sh.kind === 'text' ? [['text', 'Replace all its text'], ['replace', 'Swap part of the text']] : sh.kind === 'table' ? [['table', 'Fill with a table']] : sh.kind === 'chart' ? [['chart', 'Plot a table']] : [['picture', 'Use a picture']];
    const p = h('div', { class: 'pm-panel' });
    const draw = () => {
      p.innerHTML = '';
      p.append(h('div', { class: 'row' }, h('b', { class: 'grow' }, `Slide ${slide} · ${sh.name}`), h('button', { class: 'icon-btn xs', title: 'Close', onclick: (e) => { e.preventDefault(); close(); } }, ic('x', 13))));
      if (sh.text) p.append(h('div', { class: 'pm-now' }, sh.text.slice(0, 300)));
      if (sh.table) p.append(h('div', { class: 'pm-now' }, `Table · ${sh.table.cols} columns: ${sh.table.header.join(' | ')}${sh.table.totalRow ? ' · has a Total row' : ''}`));
      if (sh.chart) p.append(h('div', { class: 'pm-now' }, `${sh.chart.type} chart · series: ${sh.chart.series.join(', ') || '—'} · ${sh.chart.points} points`));
      if (!f) { p.append(h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, ...kinds.map(([k, l]) => h('button', { class: 'btn sm', onclick: (e) => { e.preventDefault(); f = { slide, shape: { id: sh.id, name: sh.name }, kind: k, ...(k === 'replace' ? { find: (String(sh.text || '').match(/[-+$€£]?\d[\d,.]*%?/) || [''])[0] } : {}) }; values.fills.push(f); changed(); } }, l)))); }
      else {
        if (kinds.length > 1) p.append(h('div', { class: 'seg' }, ...kinds.map(([k, l]) => h('button', { class: f.kind === k ? 'on' : '', onclick: (e) => { e.preventDefault(); f.kind = k; changed(); draw(); } }, l))));
        const up = () => changed();
        if (f.kind === 'replace') { const fi = h('input', { class: 'input', value: f.find || '', placeholder: 'Text in the box to swap, e.g. 4,450' }); fi.oninput = () => { f.find = fi.value; up(); }; p.append(h('div', { class: 'f' }, h('div', { class: 'f-label' }, h('label', {}, 'Swap this')), fi)); }
        if (f.kind === 'text' || f.kind === 'replace' || f.kind === 'picture') p.append(h('div', { class: 'f' }, h('div', { class: 'f-label' }, h('label', {}, f.kind === 'picture' ? 'Picture' : 'With')), tokInput({ value: f.value, placeholder: f.kind === 'picture' ? '{{steps.lumen.file}}' : '{{steps.….totals.Signups.now}}', ctx, accepts: f.kind === 'picture' ? ['file', 'files'] : null, onInput: (v) => { f.value = v; up(); } })));
        if (f.kind === 'table' || f.kind === 'chart') {
          p.append(h('div', { class: 'f' }, h('div', { class: 'f-label' }, h('label', {}, 'Data')), tokInput({ value: f.table, placeholder: '{{steps.….table}}', ctx, accepts: ['table'], replace: true, onInput: (v) => { f.table = v; up(); } })));
          const cols = columnsOf(ctx, f.table);
          if (f.kind === 'table') p.append(h('div', { class: 'f' }, h('div', { class: 'f-label' }, h('label', {}, `Columns, in the table’s order (${sh.table ? sh.table.header.join(', ') : ''})`)), chipsInput(Array.isArray(f.columns) ? f.columns : [], (v) => { f.columns = v; up(); }, cols, 'Blank = match headers, else in order')));
          if (f.kind === 'chart') { const id = 'dl' + dlSeq++; const x = h('input', { class: 'input', list: id, placeholder: 'Labels from column', value: f.x || '' }); x.oninput = () => { f.x = x.value; up(); }; p.append(h('div', { class: 'f' }, h('div', { class: 'f-label' }, h('label', {}, 'Labels')), x), h('div', { class: 'f' }, h('div', { class: 'f-label' }, h('label', {}, `Series (template has: ${sh.chart ? sh.chart.series.join(', ') : ''})`)), chipsInput(Array.isArray(f.y) ? f.y : f.y ? [f.y] : [], (v) => { f.y = v; up(); }, cols, 'Value columns'))); if (cols.length) p.append(colList(id, cols)); }
          const mr = h('input', { class: 'input', type: 'number', placeholder: 'All rows', value: f.maxRows ?? '', style: 'width:120px' }); mr.oninput = () => { f.maxRows = mr.value === '' ? undefined : Number(mr.value); up(); };
          p.append(h('div', { class: 'f' }, h('div', { class: 'f-label' }, h('label', {}, 'At most')), mr));
        }
        p.append(h('button', { class: 'link-btn', style: 'color:var(--bad)', onclick: (e) => { e.preventDefault(); values.fills.splice(values.fills.indexOf(f), 1); f = null; changed(); } }, ic('trash', 13), 'Stop filling this'));
      }
      // repeat the whole slide
      let rp = values.repeat.find((r) => Number(r.slide) === slide);
      const rsw = h('button', { class: 'switch' + (rp ? ' on' : ''), onclick: (e) => { e.preventDefault(); if (rp) values.repeat.splice(values.repeat.indexOf(rp), 1); else values.repeat.push({ slide, table: '' }); changed(); } });
      p.append(h('div', { class: 'f-bool sepline' }, h('div', { class: 'grow' }, h('label', {}, `Repeat slide ${slide} for each row`), h('div', { class: 'hint' }, 'E.g. one slide per campaign. Use {{row.Column}} on the slide (in the deck or in fills).')), rsw));
      if (rp) p.append(tokInput({ value: rp.table, placeholder: '{{steps.lumen.tables.campaigns}}', ctx, accepts: ['table'], replace: true, onInput: (v) => { rp.table = v; changed(); } }));
    };
    draw();
    return p;
  },
  async ai(values, ctx, an, done) {
    const groups = tokensFor(ctx, null);
    const vals = [];
    for (const [g, items] of groups) for (const [k, l] of items) { if (g === 'Secrets') continue; let sample = getPath({ steps: ctx.outputs }, k); if (sample && sample.__table) sample = { columns: sample.columns, firstRows: sample.rows.slice(0, 3), rows: sample.total }; vals.push({ value: `{{${k}}}`, what: l, example: sample === undefined ? undefined : typeof sample === 'string' ? sample.slice(0, 200) : sample }); }
    // expand tables into their columns and totals so the AI can point at single numbers
    for (const v of vals.slice()) { const ex = v.example; if (ex && ex.columns && ex.firstRows) { /* keep */ } if (ex && typeof ex === 'object' && !ex.columns && !Array.isArray(ex)) for (const [k2, v2] of Object.entries(ex).slice(0, 30)) if (v2 && typeof v2 === 'object' && 'now' in v2) vals.push({ value: v.value.replace('}}', `.${/^\w+$/.test(k2) ? k2 : `["${k2}"]`}.now}}`), what: `${v.what} › ${k2} now`, example: v2.now }, { value: v.value.replace('}}', `.${/^\w+$/.test(k2) ? k2 : `["${k2}"]`}.changePct}}`), what: `${v.what} › ${k2} change (fraction)`, example: v2.changePct }); }
    const t = toast('Mapping the template', 'Reading your slides and matching them with this automation’s data…', 'busy', 0);
    const off = C.on('ai:progress', (m) => { const el = t.querySelector('.t-text'); if (el) el.textContent = m; });
    try {
      const r = await call('pptx:aiMap', values.template, vals);
      off(); t.remove();
      if (!r.fills.length && !r.repeat.length) return toast('Nothing mapped', r.notes || 'Test the steps above first so there’s data to match.', 'info', 8000);
      values.fills = r.fills; values.repeat = r.repeat; done();
      toast(`Mapped ${r.fills.length} element${r.fills.length === 1 ? '' : 's'}${r.repeat.length ? ` and ${r.repeat.length} repeating slide${r.repeat.length === 1 ? '' : 's'}` : ''}`, r.notes || 'Check them, then test the step.', 'ok', 9000);
    } catch (e) { off(); t.remove(); fail(e); }
  },
};
function getPath(obj, p) { let cur = obj; for (const part of String(p).match(/[^.[\]"]+/g) || []) { if (cur == null) return undefined; cur = cur[part]; } return cur; }
