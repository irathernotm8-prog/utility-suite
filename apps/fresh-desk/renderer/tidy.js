'use strict';
/* Tidy: preview-first organizing for the folder you're in. */
(function () {
  const {el, bytes, when} = U;
  const {I} = Icons;
  const M = reviewModel;
  const T = {open: false, root: null, plan: null, checked: new Set(), cleanChecked: new Set(), cleanDirs: new Set(), profiles: [], scanning: false, error: null, toggled: new Map(), options: null, progress: ''};
  const defaults = () => ({mode: 'kind', profile: 'default', recursive: false, duplicates: true, content: false, activeDays: 0, days: 365});
  const box = () => document.getElementById('tidy');
  const clean = m => (m || '').replace(/^Error invoking remote method '\w+': (Error: )?/, '');

  async function open(root) {
    T.open = true; T.root = root; T.plan = null; T.error = null; T.toggled = new Map();
    T.options = T.options || load();
    box().hidden = false;
    document.body.classList.add('tidy-open');
    App.render();
    if (!T.profiles.length) { try { T.profiles = (await desk.profiles()).profiles; } catch (e) { T.profiles = [{id: 'default', name: 'Everyday', rules: []}]; } }
    if (!T.profiles.some(p => p.id === T.options.profile)) T.options.profile = T.profiles[0].id;
    scan();
  }
  function close() {
    if (T.scanning) desk.cancelScan();
    T.open = false; T.plan = null; box().hidden = true; box().replaceChildren();
    document.body.classList.remove('tidy-open');
    App.render(); document.getElementById('content').focus();
  }
  function load() { try { return {...defaults(), ...JSON.parse(localStorage.getItem('tidyOptions') || '{}')}; } catch { return defaults(); } }
  function persist() { try { localStorage.setItem('tidyOptions', JSON.stringify(T.options)); } catch {} }

  async function scan() {
    if (T.scanning) { desk.cancelScan(); await new Promise(r => setTimeout(r, 60)); }
    T.scanning = true; T.error = null; T.progress = 'Looking through files…'; draw();
    try {
      T.plan = await desk.tidyScan(T.root, {...T.options});
      T.checked = M.defaultChecked(T.plan.rows);
      T.cleanChecked = new Set(); T.cleanDirs = new Set();
    } catch (e) { T.plan = null; T.error = /canceled/i.test(e.message) ? null : clean(e.message); }
    T.scanning = false; draw();
  }
  desk.on('scan-progress', p => { if (!T.open) return; T.progress = `${p.phase} · ${p.count.toLocaleString()} files`; const n = document.querySelector('.tidy-progress'); if (n) n.textContent = T.progress; });

  const setOpt = (k, v) => { T.options[k] = v; persist(); scan(); };
  function seg(key, options) {
    return el('div', {class: 'seg text', role: 'radiogroup'}, options.map(([v, l]) => el('button', {class: 'tb' + (T.options[key] === v ? ' on' : ''), text: l, onclick: () => setOpt(key, v)})));
  }
  function chip(key, label, title) {
    return el('button', {class: 'chip toggle' + (T.options[key] ? ' on' : ''), title, onclick: () => setOpt(key, !T.options[key])}, el('span', {class: 'ic', html: I.check}), label);
  }

  function draw() {
    if (!T.open) return;
    const root = box();
    const name = U.basename(T.root) || T.root;
    const head = el('div', {class: 'tidy-head'},
      el('div', {class: 'tidy-title'},
        el('div', {}, el('div', {class: 'eyebrow', html: I.sparkle + '<span>Tidy</span>'}), el('h1', {text: name})),
        el('div', {class: 'grow'}),
        el('button', {class: 'btn ghost', onclick: rulesDialog}, el('span', {class: 'ic', html: I.filter}), 'Rules'),
        el('button', {class: 'btn ghost', onclick: aiDialog, disabled: !T.plan}, el('span', {class: 'ic', html: I.ai}), 'Ask AI'),
        el('button', {class: 'btn ghost', onclick: close}, 'Done')),
      el('div', {class: 'tidy-controls'},
        el('span', {class: 'lbl', text: 'Group by'}), seg('mode', [['kind', 'Kind'], ['year', 'Year'], ['month', 'Month'], ['type', 'Extension']]),
        el('span', {class: 'lbl', text: 'Rules'}),
        el('select', {class: 'mini', onchange: e => setOpt('profile', e.target.value)}, T.profiles.map(p => { const o = el('option', {value: p.id, text: p.name}); if (p.id === T.options.profile) o.selected = true; return o; })),
        el('span', {class: 'grow'}),
        chip('recursive', 'Subfolders', 'Also look inside folders here'),
        chip('duplicates', 'Duplicates', 'Find exact copies (compares contents)'),
        chip('content', 'Read contents', 'Look inside PDFs, spreadsheets and text to spot receipts and matching reports. Stays on this computer.'),
        el('select', {class: 'mini', title: 'Leave recently changed files alone', onchange: e => setOpt('activeDays', +e.target.value)},
          [[0, 'Include recent files'], [7, 'Skip files from last 7 days'], [30, 'Skip files from last 30 days'], [90, 'Skip files from last 90 days']].map(([v, l]) => { const o = el('option', {value: v, text: l}); if (v === T.options.activeDays) o.selected = true; return o; }))));
    const body = el('div', {class: 'tidy-body'});
    const foot = el('div', {class: 'tidy-foot'});
    root.replaceChildren(head, body, foot);

    if (T.scanning) { body.append(el('div', {class: 'empty subtle'}, el('div', {class: 'spinner'}), el('p', {class: 'tidy-progress', text: T.progress}), el('button', {class: 'btn ghost', text: 'Stop', onclick: () => desk.cancelScan()}))); return; }
    if (T.error) { body.append(el('div', {class: 'empty'}, el('div', {class: 'empty-ic', html: I.warn}), el('h3', {text: 'Tidy couldn’t look through this folder'}), el('p', {text: T.error}), el('button', {class: 'btn', text: 'Try again', onclick: scan}))); return; }
    if (!T.plan) return;

    const {moves, staying, blocked} = M.groupPlan(T.plan.rows);
    const sections = M.cleanup(T.plan);
    if (!T.plan.rows.length && !sections.length) {
      body.append(el('div', {class: 'empty'}, el('div', {class: 'empty-ic ok', html: I.check}), el('h3', {text: 'Already tidy'}), el('p', {text: T.options.recursive ? 'No loose files here or in subfolders.' : 'No loose files here. Turn on Subfolders to look deeper.'})));
      return;
    }

    // ---- sort into folders
    const sortCol = el('div', {class: 'tidy-col'});
    const toMove = moves.reduce((n, g) => n + g.rows.length, 0);
    sortCol.append(el('div', {class: 'tidy-sec-head'}, el('h2', {text: 'Sort into folders'}), el('span', {class: 'muted', text: toMove ? `${toMove} file${toMove > 1 ? 's' : ''} → ${moves.length} folder${moves.length > 1 ? 's' : ''}` : 'Nothing to move'})));
    for (const g of moves) sortCol.append(groupCard(g));
    if (blocked.length) sortCol.append(groupCard({folder: 'Needs a different name', rows: blocked, bytes: 0, blocked: true}));
    if (staying.length) sortCol.append(groupCard({folder: 'Staying put', rows: staying, bytes: 0, staying: true}));

    // ---- clean up
    const cleanCol = el('div', {class: 'tidy-col side'});
    if (sections.length) {
      const total = sections.reduce((n, s) => n + s.bytes, 0);
      cleanCol.append(el('div', {class: 'tidy-sec-head'}, el('h2', {text: 'Clean up'}), el('span', {class: 'muted', text: total ? `up to ${bytes(total)}` : ''})));
      for (const s of sections) cleanCol.append(cleanCard(s));
      const n = T.cleanChecked.size + T.cleanDirs.size;
      cleanCol.append(el('button', {class: 'btn danger block', disabled: !n, onclick: trashSelected}, el('span', {class: 'ic', html: I.trash}), n ? `Move ${n} to ${App.isWin() ? 'Recycle Bin' : 'Trash'}` : 'Pick items to remove'));
    } else cleanCol.append(el('div', {class: 'tidy-sec-head'}, el('h2', {text: 'Clean up'})), el('p', {class: 'muted small', text: 'No duplicates, old installers, unfinished downloads or empty folders found.'}));
    if (T.plan.warnings?.length) cleanCol.append(el('details', {class: 'warnings'}, el('summary', {text: `${T.plan.warnings.length} item${T.plan.warnings.length > 1 ? 's' : ''} skipped`}), el('pre', {text: T.plan.warnings.slice(0, 50).join('\n')})));
    body.append(sortCol, cleanCol);

    // ---- footer
    const s = M.summary(T.plan.rows, T.checked);
    foot.append(el('span', {class: 'muted', text: s.files ? `${s.files} file${s.files > 1 ? 's' : ''} into ${s.folders} folder${s.folders > 1 ? 's' : ''} · ${bytes(s.bytes)}` : 'Tick the files you want sorted.'}),
      el('span', {class: 'grow'}),
      el('span', {class: 'muted small', text: 'Undo anytime with ' + App.short('⌘Z')}),
      el('button', {class: 'btn primary', disabled: !s.files, onclick: applyMoves}, 'Sort files'));
  }

  function groupCard(g) {
    const key = 'g:' + g.folder, open = T.toggled.has(key) ? T.toggled.get(key) : (g.rows.length <= 6 && !g.staying);
    const movableRows = g.rows.filter(M.movable);
    const all = movableRows.length && movableRows.every(r => T.checked.has(r.id));
    const some = movableRows.some(r => T.checked.has(r.id));
    const cb = el('input', {type: 'checkbox', checked: all, disabled: !movableRows.length, 'aria-label': `Select ${g.folder}`, onclick: e => e.stopPropagation(), onchange: e => { for (const r of movableRows) e.target.checked ? T.checked.add(r.id) : T.checked.delete(r.id); draw(); }});
    cb.indeterminate = some && !all;
    const head = el('div', {class: 'g-head', onclick: () => { T.toggled.set(key, !open); draw(); }},
      g.staying || g.blocked ? el('span', {class: 'cb-space'}) : cb,
      el('span', {class: 'g-ic', html: g.staying ? I.check : g.blocked ? I.warn : Icons.folderIcon(20)}),
      el('span', {class: 'g-name', text: g.folder}),
      el('span', {class: 'g-count', text: `${g.rows.length} file${g.rows.length > 1 ? 's' : ''}${g.bytes ? ' · ' + bytes(g.bytes) : ''}`}),
      el('span', {class: 'ic g-chev' + (open ? ' open' : ''), html: I.chevron}));
    const card = el('div', {class: 'g-card' + (g.staying ? ' staying' : '') + (g.blocked ? ' blocked' : '')}, head);
    if (open) card.append(el('div', {class: 'g-rows'}, g.rows.map(r => rowEl(r, g))));
    return card;
  }
  function rowEl(r, g) {
    const can = M.movable(r);
    const cb = el('input', {type: 'checkbox', checked: T.checked.has(r.id), disabled: !can, 'aria-label': `Select ${r.name}`, onchange: e => { e.target.checked ? T.checked.add(r.id) : T.checked.delete(r.id); draw(); }});
    const tags = [];
    if (r.confidence === 'review') tags.push(el('span', {class: 'tag warn', text: 'check this'}));
    if (r.duplicate) tags.push(el('span', {class: 'tag dup', text: r.duplicateOf ? `copy of ${r.duplicateOf}` : `${r.duplicateCount} copies`}));
    if (r.conflict) tags.push(el('span', {class: 'tag warn', text: r.conflict}));
    const where = T.options.recursive && r.relative && r.relative.includes(App.sep()) ? U.dirname(r.relative, App.sep()) + App.sep() : '';
    return el('div', {class: 'g-row'}, g.staying ? el('span', {class: 'cb-space'}) : cb, App.iconFor({...r, isDir: false, kind: kindOf(r)}, 16),
      el('div', {class: 'g-file'}, el('span', {class: 'nm', text: (where ? '' : '') + r.name, title: r.relative || r.name}), el('span', {class: 'why', text: (where ? where + ' · ' : '') + (r.reason || '')}), ...tags),
      el('span', {class: 'g-size', text: bytes(r.bytes)}),
      el('span', {class: 'g-date', text: when(Date.parse(r.modified))}),
      r.source === 'protected' ? el('span', {class: 'g-edit'}) : el('button', {class: 'link g-edit', text: 'Change', onclick: () => changeDialog(r)}));
  }
  function kindOf(r) { const e = r.ext; for (const [k, list] of [['Image', 'png jpg jpeg gif webp heic svg'], ['PDF', 'pdf'], ['Spreadsheet', 'xlsx xls csv numbers'], ['Document', 'doc docx txt md pages rtf'], ['Video', 'mp4 mov mkv'], ['Audio', 'mp3 wav m4a'], ['Archive', 'zip rar 7z gz'], ['Installer', 'dmg pkg exe msi']]) if (list.split(' ').includes(e)) return k; return 'File'; }

  function cleanCard(s) {
    const key = 'c:' + s.id, open = !!T.toggled.get(key);
    const ids = s.rows.map(r => r.id);
    const count = s.dirs ? s.dirs.length : s.rows.length;
    const all = s.dirs ? s.dirs.every(d => T.cleanDirs.has(d)) : ids.every(id => T.cleanChecked.has(id));
    const cb = el('input', {type: 'checkbox', checked: all, onclick: e => e.stopPropagation(), onchange: e => { if (s.dirs) s.dirs.forEach(d => e.target.checked ? T.cleanDirs.add(d) : T.cleanDirs.delete(d)); else ids.forEach(id => e.target.checked ? T.cleanChecked.add(id) : T.cleanChecked.delete(id)); draw(); }});
    const card = el('div', {class: 'c-card'},
      el('div', {class: 'c-head', onclick: () => { T.toggled.set(key, !open); draw(); }}, cb,
        el('div', {class: 'c-text'}, el('strong', {text: s.title}), el('span', {class: 'muted small', text: s.desc})),
        el('span', {class: 'c-count', text: `${count}${s.bytes ? ' · ' + bytes(s.bytes) : ''}`}), el('span', {class: 'ic g-chev' + (open ? ' open' : ''), html: I.chevron})));
    if (open) {
      const list = el('div', {class: 'c-rows'});
      if (s.dirs) for (const d of s.dirs) list.append(el('label', {class: 'c-row'}, el('input', {type: 'checkbox', checked: T.cleanDirs.has(d), onchange: e => { e.target.checked ? T.cleanDirs.add(d) : T.cleanDirs.delete(d); draw(); }}), el('span', {class: 'nm', text: d.slice(T.plan.root.length + 1) || d})));
      else for (const r of s.rows) list.append(el('label', {class: 'c-row'}, el('input', {type: 'checkbox', checked: T.cleanChecked.has(r.id), onchange: e => { e.target.checked ? T.cleanChecked.add(r.id) : T.cleanChecked.delete(r.id); draw(); }}), el('span', {class: 'nm', text: r.relative || r.name, title: r.from}), el('span', {class: 'muted small', text: bytes(r.bytes)})));
      card.append(list);
    }
    return card;
  }

  async function applyMoves() {
    const ids = T.plan.rows.filter(r => T.checked.has(r.id) && M.movable(r)).map(r => r.id);
    if (!ids.length) return;
    try {
      const results = await desk.tidyApply(ids);
      const ok = results.filter(r => r.ok).length, bad = results.filter(r => !r.ok);
      App.toast(bad.length ? `Sorted ${ok}. ${bad.length} stayed put: ${bad[0].error}` : `Sorted ${ok} file${ok > 1 ? 's' : ''}`, {undo: !!ok, error: !!bad.length});
    } catch (e) { App.err(e); }
    await App.reload();
    scan();
  }
  async function trashSelected() {
    try {
      const results = await desk.tidyTrash([...T.cleanChecked], [...T.cleanDirs]);
      if (!results.length) return;
      const ok = results.filter(r => r.ok).length, bad = results.filter(r => !r.ok);
      App.toast(bad.length ? `Removed ${ok}. ${bad.length} couldn’t be: ${bad[0].error}` : `Moved ${ok} item${ok > 1 ? 's' : ''} to the ${App.isWin() ? 'Recycle Bin' : 'Trash'}`, {error: !!bad.length});
    } catch (e) { App.err(e); }
    await App.reload();
    scan();
  }

  // ---------- dialogs
  const dlg = () => document.getElementById('tidyDialog');
  function showDialog(title, content, actions) {
    const d = dlg();
    d.replaceChildren(el('div', {class: 'tidy-dialog'}, el('h2', {text: title}), content, el('div', {class: 'dialog-actions'}, actions)));
    d.showModal();
    return d;
  }
  function changeDialog(r) {
    const groups = [...new Set(T.plan.rows.map(x => x.folder).filter(Boolean))];
    const input = el('input', {class: 'text', value: r.folder || '', list: 'tidyGroups', maxlength: 180, spellcheck: 'false'});
    const remember = el('input', {type: 'checkbox'});
    const d = showDialog(`Where should “${r.name}” go?`, el('div', {},
      el('label', {class: 'field'}, el('span', {text: 'Folder inside ' + (U.basename(T.root) || T.root)}), input, el('datalist', {id: 'tidyGroups'}, groups.map(g => el('option', {value: g})))),
      el('p', {class: 'muted small', text: 'Use / for a folder inside a folder, e.g. Taxes/2025. {year} becomes the year it was last changed.'}),
      el('label', {class: 'check'}, remember, el('span', {text: 'Always send this file name here'}))),
      [el('button', {class: 'btn ghost', text: 'Cancel', onclick: () => d.close()}),
       el('button', {class: 'btn primary', text: 'Update', onclick: async () => {
         try {
           T.plan = await desk.revise([{id: r.id, folder: input.value}]);
           T.checked.add(r.id);
           if (remember.checked) { const p = T.profiles.find(x => x.id === T.options.profile); p.rules.unshift({id: crypto.randomUUID(), name: `Always: ${r.name}`.slice(0, 100), action: 'group', folder: input.value, match: {nameEquals: r.name}, enabled: true}); await saveProfiles(false); }
           d.close(); draw();
         } catch (e) { App.err(e); }
       }})]);
    setTimeout(() => { input.focus(); input.select(); }, 30);
  }
  async function saveProfiles(rescan = true) {
    const result = await desk.saveProfiles({profiles: T.profiles});
    T.profiles = result.profiles;
    if (rescan) scan();
  }

  const FIELDS = [
    ['extensions', 'Extension is', 'pdf, docx'], ['nameContains', 'Name contains', 'invoice'], ['nameEquals', 'Name is exactly', 'report.xlsx'], ['pathContains', 'Path contains', 'clients/'],
    ['minAgeDays', 'Older than (days)', '365'], ['maxAgeDays', 'Newer than (days)', '30'], ['minBytes', 'Bigger than (bytes)', '1000000'], ['maxBytes', 'Smaller than (bytes)', '5000'],
    ['contentContains', 'Text inside contains', 'Amount due'], ['headersContain', 'Spreadsheet has columns', 'Date, Amount'],
    ['minWidth', 'Image at least (px wide)', '1920'], ['minHeight', 'Image at least (px tall)', '1080'], ['width', 'Image width is', '1080'], ['height', 'Image height is', '1080'], ['ratio', 'Image ratio is', '16:9'],
  ];
  const fieldLabel = Object.fromEntries(FIELDS.map(([k, l]) => [k, l]));
  function describe(rule) {
    const cond = Object.entries(rule.match).map(([k, v]) => `${(fieldLabel[k] || k).toLowerCase()} ${Array.isArray(v) ? v.join(', ') : v}`).join(' and ');
    return `${cond} → ${rule.action === 'keep' ? 'leave in place' : rule.folder}`;
  }
  function rulesDialog() {
    const render = () => {
      const p = T.profiles.find(x => x.id === T.options.profile) || T.profiles[0];
      const rules = p.rules;
      const list = el('div', {class: 'rule-list'});
      if (!rules.length) list.append(el('p', {class: 'muted small', text: 'No rules yet — Tidy groups by kind or date on its own. Rules run first, top to bottom; the first match wins.'}));
      rules.forEach((rule, i) => {
        list.append(el('div', {class: 'rule' + (rule.enabled ? '' : ' off')},
          el('label', {class: 'switch', title: rule.enabled ? 'On' : 'Off'}, el('input', {type: 'checkbox', checked: rule.enabled, onchange: async () => { rule.enabled = !rule.enabled; await commit(); }}), el('span')),
          el('div', {class: 'rule-text'}, el('strong', {text: rule.name}), el('span', {class: 'muted small', text: describe(rule)})),
          el('button', {class: 'tb', title: 'Move up', html: I.up, disabled: !i, onclick: async () => { [rules[i - 1], rules[i]] = [rules[i], rules[i - 1]]; await commit(); }}),
          el('button', {class: 'tb', title: 'Remove', html: I.trash, onclick: async () => { rules.splice(i, 1); await commit(); }})));
      });
      const conds = el('div', {class: 'conds'});
      const addCond = () => {
        const sel = el('select', {class: 'mini'}, FIELDS.map(([k, l]) => el('option', {value: k, text: l})));
        const val = el('input', {class: 'text', placeholder: FIELDS[0][2]});
        sel.onchange = () => val.placeholder = FIELDS.find(f => f[0] === sel.value)[2];
        const row = el('div', {class: 'cond'}, sel, val, el('button', {class: 'tb', html: I.close, title: 'Remove condition', onclick: () => row.remove()}));
        conds.append(row);
      };
      addCond();
      const name = el('input', {class: 'text', placeholder: 'e.g. Client invoices', maxlength: 100});
      const action = el('select', {class: 'mini'}, el('option', {value: 'group', text: 'Move to folder'}), el('option', {value: 'keep', text: 'Leave in place'}));
      const folder = el('input', {class: 'text', placeholder: 'Invoices/{year}', maxlength: 180});
      action.onchange = () => folder.disabled = action.value === 'keep';
      const profileSel = el('select', {class: 'mini', onchange: e => { T.options.profile = e.target.value; persist(); render(); }}, T.profiles.map(x => { const o = el('option', {value: x.id, text: x.name}); if (x.id === p.id) o.selected = true; return o; }));
      const newName = el('input', {class: 'text', placeholder: 'New rule set name', maxlength: 80});
      const d = showDialog('Rules', el('div', {class: 'rules-body'},
        el('div', {class: 'row-line'}, el('span', {class: 'lbl', text: 'Rule set'}), profileSel, el('span', {class: 'grow'}), newName,
          el('button', {class: 'btn ghost', text: 'Add set', onclick: async () => { if (!newName.value.trim()) return; const id = crypto.randomUUID(); T.profiles.push({id, name: newName.value.trim(), rules: []}); T.options.profile = id; persist(); await commit(); }})),
        list,
        el('h3', {text: 'New rule'}),
        el('div', {class: 'row-line'}, el('label', {class: 'field grow'}, el('span', {text: 'Name'}), name), el('label', {class: 'field'}, el('span', {text: 'Then'}), action), el('label', {class: 'field grow'}, el('span', {text: 'Folder'}), folder)),
        el('div', {class: 'field'}, el('span', {text: 'When all of these match'}), conds, el('button', {class: 'link', text: '+ Add condition', onclick: addCond})),
        el('div', {class: 'row-line'}, el('span', {class: 'grow'}), el('button', {class: 'btn', text: 'Add rule', onclick: async () => {
          try {
            const match = {};
            for (const row of conds.children) {
              const k = row.querySelector('select').value, v = row.querySelector('input').value.trim();
              if (!v) throw Error('Fill in every condition.');
              match[k] = ['extensions', 'headersContain'].includes(k) ? v.split(',').map(x => x.trim().replace(/^\./, '')).filter(Boolean) : /^(min|max)|^(width|height)$/.test(k) ? Number(v) : v;
            }
            p.rules.push({id: crypto.randomUUID(), name: name.value || 'Rule', action: action.value, folder: folder.value, match, enabled: true});
            await commit();
          } catch (e) { p.rules = p.rules.filter(r => r.match && Object.keys(r.match).length); App.err(e); }
        }}))),
        [el('button', {class: 'btn primary', text: 'Done', onclick: () => { d.close(); scan(); }})]);
    };
    const commit = async () => { try { await saveProfiles(false); } catch (e) { App.err(e); T.profiles = (await desk.profiles()).profiles; } render(); };
    render();
  }

  async function aiDialog() {
    const candidates = T.plan.rows.filter(r => T.checked.has(r.id) && r.source !== 'rule' && r.source !== 'protected' && !r.keep).slice(0, 8);
    const provider = el('select', {class: 'mini'}, el('option', {value: 'assist', text: 'Assist · on this computer'}), el('option', {value: 'openai', text: 'OpenAI · cloud'}), el('option', {value: 'claude', text: 'Claude · cloud'}));
    const model = el('input', {class: 'text', placeholder: 'Model ID from your API account', autocomplete: 'off'});
    const key = el('input', {class: 'text', type: 'password', placeholder: 'API key — used once, never saved', autocomplete: 'off'});
    const cloud = el('div', {class: 'row-line', hidden: true}, el('label', {class: 'field grow'}, el('span', {text: 'Model'}), model), el('label', {class: 'field grow'}, el('span', {text: 'API key'}), key));
    const status = el('p', {class: 'muted small', text: 'Assist answers on this computer. Open Assist and turn on Settings → Plugins.'});
    provider.onchange = () => { cloud.hidden = provider.value === 'assist'; status.textContent = provider.value === 'assist' ? 'Assist answers on this computer. Open Assist and turn on Settings → Plugins.' : 'File names and details you review next are sent to this provider. API charges may apply.'; };
    const goal = el('textarea', {class: 'text', rows: 3, maxlength: 2000, placeholder: 'e.g. Put client work into one folder per client and everything personal into Personal.'});
    const content = el('input', {type: 'checkbox'});
    const out = el('div', {class: 'ai-out'});
    const d = showDialog('Ask AI where files should go', el('div', {},
      el('p', {class: 'muted small', text: candidates.length ? `Asks about ${candidates.length} ticked file${candidates.length > 1 ? 's' : ''} (up to 8, skipping ones a rule already decided). It only suggests — you still review before anything moves.` : 'Tick up to 8 files in the list first.'}),
      el('div', {class: 'row-line'}, el('label', {class: 'field'}, el('span', {text: 'Ask'}), provider), el('button', {class: 'btn ghost', text: 'Check Assist', onclick: async () => { try { const s = await desk.assistStatus(); status.textContent = `${s.modelName || s.model || 'Assist'} · ${s.ready ? 'ready' : s.downloaded ? 'model downloaded' : 'download a model in Assist first'}`; } catch (e) { status.textContent = clean(e.message); } }})),
      cloud, status,
      el('label', {class: 'field'}, el('span', {text: 'What should it aim for?'}), goal),
      el('label', {class: 'check'}, content, el('span', {text: 'Include text excerpts (needs Read contents)'})),
      out),
      [el('button', {class: 'btn ghost', text: 'Close', onclick: () => d.close()}),
       el('button', {class: 'btn primary', text: 'Review request', disabled: !candidates.length, onclick: async () => {
         try {
           const preview = await desk.aiPreview({ids: candidates.map(r => r.id), goal: goal.value, includeContent: content.checked});
           out.replaceChildren(el('p', {class: 'small', text: `This exact request goes to ${provider.value === 'assist' ? 'Assist (127.0.0.1)' : provider.value === 'openai' ? 'api.openai.com' : 'api.anthropic.com'}. Full paths and file contents are left out unless you ticked excerpts.`}),
             el('pre', {class: 'payload', text: JSON.stringify(preview.payload, null, 2)}),
             el('button', {class: 'btn primary', text: 'Send', onclick: async ev => {
               ev.target.disabled = true; ev.target.textContent = 'Waiting for answer…';
               try {
                 const suggestions = await desk.aiRun({ticket: preview.ticket, provider: provider.value, config: {key: key.value, model: model.value}});
                 key.value = '';
                 const picks = new Set(suggestions.map(s => s.proposalId));
                 out.replaceChildren(...[suggestions.length ? el('div', {class: 'ai-list'}, suggestions.map(s => el('label', {class: 'c-row'}, el('input', {type: 'checkbox', checked: true, onchange: e => e.target.checked ? picks.add(s.proposalId) : picks.delete(s.proposalId)}), el('span', {class: 'nm', text: `${s.name} → ${s.folder}`}), el('span', {class: 'muted small', text: `${s.reason} (${Math.round(s.confidence * 100)}%)`})))) : el('p', {text: 'No suggestions came back. Nothing changed.'}),
                   suggestions.length ? el('button', {class: 'btn primary', text: 'Use these', onclick: async () => { try { T.plan = await desk.acceptAI([...picks]); d.close(); draw(); App.toast('AI suggestions added — review them, then Sort files'); } catch (e) { App.err(e); } }}) : null].filter(Boolean));
               } catch (e) { key.value = ''; out.replaceChildren(el('p', {class: 'error-text', text: clean(e.message)})); }
             }}));
         } catch (e) { out.replaceChildren(el('p', {class: 'error-text', text: clean(e.message)})); }
       }})]);
  }

  window.Tidy = {open, close, isOpen: () => T.open, refresh: () => T.open && scan()};
})();
