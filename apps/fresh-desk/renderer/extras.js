'use strict';
/* Favorite editor (custom icon, color, name) and batch rename. */
(function () {
  const {el} = U;
  const {G, meta, SWATCHES, suggest, categories} = Glyphs;

  // ---------- favorites: icon, color, name
  function editFavorite(p, {adding = false, baseName, baseIcon} = {}) {
    const S = App.S;
    const cur = S.prefs.favMeta[p] || {};
    let icon = cur.icon || (adding ? suggest(U.basename(p)) : baseIcon && G[baseIcon] ? baseIcon : suggest(U.basename(p)));
    let color = cur.color || 'accent';
    const d = document.getElementById('tidyDialog');
    const name = el('input', {class: 'text', value: cur.name || baseName || U.basename(p) || p, maxlength: 80, spellcheck: 'false'});
    const prevIcon = el('span', {class: 'ic'}), prevName = el('span', {class: 'place-name'});
    const preview = el('div', {class: 'fav-preview'}, el('div', {class: 'place active'}, prevIcon, prevName));
    const paint = () => { prevIcon.innerHTML = G[icon] || G.folder; prevIcon.style.color = color === 'accent' ? '' : color; prevName.textContent = name.value || U.basename(p); };
    name.oninput = paint;
    const swatches = el('div', {class: 'swatches'}, SWATCHES.map(([c, label]) => {
      const b = el('button', {class: 'swatch' + (c === color ? ' on' : ''), title: label, 'aria-label': label, onclick: () => { color = c; swatches.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x === b)); paint(); }});
      b.style.setProperty('--sw', c === 'accent' ? 'var(--accent)' : c);
      return b;
    }));
    const grid = el('div', {class: 'glyph-grid'});
    const search = el('input', {class: 'text', type: 'search', placeholder: `Search ${meta.length} icons…`, spellcheck: 'false'});
    const drawGrid = () => {
      const q = search.value.trim().toLowerCase();
      grid.replaceChildren();
      for (const cat of categories) {
        const items = meta.filter(m => m.cat === cat && (!q || m.kw.includes(q)));
        if (!items.length) continue;
        if (!q) grid.append(el('div', {class: 'glyph-cat', text: cat}));
        for (const m of items) {
          const b = el('button', {class: 'glyph' + (m.id === icon ? ' on' : ''), title: m.label, 'aria-label': m.label, html: G[m.id], onclick: () => { icon = m.id; grid.querySelectorAll('.glyph').forEach(x => x.classList.toggle('on', x === b)); paint(); }});
          grid.append(b);
        }
      }
      if (!grid.children.length) grid.append(el('div', {class: 'muted small', text: 'No icons match.'}));
    };
    search.oninput = drawGrid;
    const save = () => {
      const m = {icon, color};
      const n = name.value.trim();
      if (n && n !== (baseName || U.basename(p))) m.name = n;
      S.prefs.favMeta = {...S.prefs.favMeta, [p]: m};
      if (adding) App.pinPath(p);
      d.close(); App.renderPlaces(); App.savePrefsSoon();
      if (adding) App.toast(`Added “${n || U.basename(p)}” to Favorites`);
    };
    d.replaceChildren(el('div', {class: 'tidy-dialog fav-dialog'},
      el('h2', {text: adding ? 'Add to Favorites' : 'Edit Favorite'}),
      el('div', {class: 'row-line'}, el('label', {class: 'field grow'}, el('span', {text: 'Name'}), name), preview),
      el('div', {class: 'field'}, el('span', {text: 'Color'}), swatches),
      el('div', {class: 'field'}, el('span', {text: 'Icon'}), search, grid),
      el('div', {class: 'dialog-actions'},
        !adding && S.prefs.favMeta[p] ? el('button', {class: 'btn ghost', text: 'Reset', onclick: () => { const m = {...S.prefs.favMeta}; delete m[p]; S.prefs.favMeta = m; d.close(); App.renderPlaces(); App.savePrefsSoon(); }}) : null,
        el('span', {class: 'grow'}),
        el('button', {class: 'btn ghost', text: 'Cancel', onclick: () => d.close()}),
        el('button', {class: 'btn primary', text: adding ? 'Add' : 'Save', onclick: save}))));
    name.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    paint(); drawGrid(); d.showModal();
    setTimeout(() => { name.focus(); name.select(); grid.querySelector('.glyph.on')?.scrollIntoView({block: 'nearest'}); }, 30);
  }

  // ---------- batch rename
  function splitName(name, isDir) {
    const i = name.lastIndexOf('.');
    return !isDir && i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ''];
  }
  const titleCase = s => s.toLowerCase().replace(/(^|[\s_\-(\[])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  function computeNames(entries, o) {
    return entries.map((e, i) => {
      let [stem, ext] = splitName(e.name, e.isDir);
      if (!o.keepExt) { stem = e.name; ext = ''; }
      if (o.mode === 'replace' && o.find) {
        const flags = o.caseSensitive ? 'g' : 'gi';
        const re = o.regex ? new RegExp(o.find, flags) : new RegExp(o.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
        stem = stem.replace(re, o.replace);
      } else if (o.mode === 'add') stem = o.where === 'before' ? o.text + stem : stem + o.text;
      else if (o.mode === 'format') {
        const n = String((+o.start || 0) + i).padStart(+o.digits || 1, '0');
        stem = o.base ? (o.numberFirst ? `${n}${o.joiner}${o.base}` : `${o.base}${o.joiner}${n}`) : n;
      } else if (o.mode === 'case') stem = o.caseMode === 'lower' ? stem.toLowerCase() : o.caseMode === 'upper' ? stem.toUpperCase() : titleCase(stem);
      return {from: e.path, old: e.name, name: (stem + ext).trim()};
    });
  }
  function batchRename(entries) {
    const d = document.getElementById('tidyDialog');
    const o = {mode: 'replace', find: '', replace: '', caseSensitive: false, regex: false, text: '', where: 'after', base: entries[0] ? splitName(entries[0].name, entries[0].isDir)[0].replace(/[\s_-]*\d+$/, '') : '', start: 1, digits: '2', joiner: ' ', numberFirst: false, caseMode: 'title', keepExt: true};
    const body = el('div', {class: 'br-fields'});
    const list = el('div', {class: 'br-list'});
    const status = el('span', {class: 'muted small'});
    const apply = el('button', {class: 'btn primary', text: 'Rename'});
    const input = (key, attrs = {}) => { const i = el('input', {class: 'text', value: o[key], spellcheck: 'false', ...attrs}); i.oninput = () => { o[key] = attrs.type === 'number' ? +i.value : i.value; update(); }; return i; };
    const check = (key, label) => { const c = el('input', {type: 'checkbox', checked: o[key]}); c.onchange = () => { o[key] = c.checked; update(); }; return el('label', {class: 'check'}, c, el('span', {text: label})); };
    const pick = (key, options) => { const s = el('select', {class: 'mini'}, options.map(([v, l]) => { const x = el('option', {value: v, text: l}); if (o[key] === v) x.selected = true; return x; })); s.onchange = () => { o[key] = s.value === 'true' ? true : s.value === 'false' ? false : s.value; update(); }; return s; };
    const modes = el('div', {class: 'seg text'}, [['replace', 'Replace text'], ['add', 'Add text'], ['format', 'Number'], ['case', 'Change case']].map(([m, l]) =>
      el('button', {class: 'tb' + (o.mode === m ? ' on' : ''), text: l, onclick: ev => { o.mode = m; modes.querySelectorAll('.tb').forEach(b => b.classList.toggle('on', b === ev.currentTarget)); fields(); update(); }})));
    function fields() {
      if (o.mode === 'replace') body.replaceChildren(el('div', {class: 'row-line'}, el('label', {class: 'field grow'}, el('span', {text: 'Find'}), input('find', {placeholder: 'e.g. IMG_'})), el('label', {class: 'field grow'}, el('span', {text: 'Replace with'}), input('replace', {placeholder: 'leave empty to remove'}))), el('div', {class: 'row-line'}, check('caseSensitive', 'Match case'), check('regex', 'Regular expression')));
      else if (o.mode === 'add') body.replaceChildren(el('div', {class: 'row-line'}, el('label', {class: 'field grow'}, el('span', {text: 'Text'}), input('text', {placeholder: 'e.g.  (final)'})), el('label', {class: 'field'}, el('span', {text: 'Where'}), pick('where', [['after', 'After name'], ['before', 'Before name']]))));
      else if (o.mode === 'format') body.replaceChildren(el('div', {class: 'row-line'}, el('label', {class: 'field grow'}, el('span', {text: 'Name'}), input('base', {placeholder: 'e.g. Trip'})), el('label', {class: 'field'}, el('span', {text: 'Start at'}), input('start', {type: 'number', min: 0})), el('label', {class: 'field'}, el('span', {text: 'Digits'}), pick('digits', [['1', '1'], ['2', '01'], ['3', '001'], ['4', '0001']])), el('label', {class: 'field'}, el('span', {text: 'Number'}), pick('numberFirst', [['false', 'After name'], ['true', 'Before name']]))));
      else body.replaceChildren(el('div', {class: 'row-line'}, el('label', {class: 'field'}, el('span', {text: 'Case'}), pick('caseMode', [['title', 'Title Case'], ['lower', 'lowercase'], ['upper', 'UPPERCASE']]))));
      body.append(check('keepExt', 'Keep file extensions as they are'));
    }
    let result = [];
    function update() {
      let error = '';
      try { result = computeNames(entries, o); } catch (x) { result = entries.map(e => ({from: e.path, old: e.name, name: e.name})); error = 'That regular expression isn’t valid.'; }
      const seen = new Map();
      for (const r of result) { const k = r.name.toLowerCase(); seen.set(k, (seen.get(k) || 0) + 1); }
      list.replaceChildren(...result.slice(0, 400).map(r => {
        const bad = !r.name || /[\/\x00]/.test(r.name) || (App.isWin() && /[<>:"\\|?*]/.test(r.name)) || seen.get(r.name.toLowerCase()) > 1;
        return el('div', {class: 'br-row' + (bad ? ' bad' : r.name !== r.old ? ' changed' : '')}, el('span', {class: 'br-old', text: r.old}), el('span', {class: 'br-arrow', text: '→'}), el('span', {class: 'br-new', text: r.name || '(empty)'}));
      }));
      const changed = result.filter(r => r.name !== r.old).length;
      const bad = list.querySelectorAll('.br-row.bad').length;
      status.textContent = error || (bad ? `${bad} name${bad > 1 ? 's' : ''} would clash or aren’t allowed` : `${changed} of ${entries.length} will change`);
      apply.disabled = !!error || !!bad || !changed;
    }
    apply.onclick = async () => {
      try {
        const done = await desk.renameMany(result.filter(r => r.name !== r.old).map(r => ({from: r.from, name: r.name})));
        d.close();
        await App.reload();
        App.tab().sel = new Set(done.map(x => x.to)); App.render();
        App.toast(`Renamed ${done.length} item${done.length > 1 ? 's' : ''}`, {undo: true});
      } catch (x) { App.err(x); }
    };
    d.replaceChildren(el('div', {class: 'tidy-dialog br-dialog'}, el('h2', {text: `Rename ${entries.length} items`}), modes, body, list,
      el('div', {class: 'dialog-actions'}, status, el('span', {class: 'grow'}), el('button', {class: 'btn ghost', text: 'Cancel', onclick: () => d.close()}), apply)));
    fields(); update(); d.showModal();
    setTimeout(() => body.querySelector('input.text')?.focus(), 30);
  }

  window.Extras = {editFavorite, batchRename, computeNames};
})();
