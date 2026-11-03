// Atrium — the right panel: the inspector for the selected section/element, and the AI tab (chat.js).
'use strict';
function setRtab(t) { S.rtab = t; $$('[data-rtab]').forEach((b) => b.classList.toggle('on', b.dataset.rtab === t)); renderRight(); }
function renderRight() {
  const host = $('#rightBody'); if (!host || !S.site) return;
  if (S.rtab === 'ai') { if (!host.querySelector('.chat')) { host.innerHTML = ''; renderChat(host); } else updateChatContext(); return; }
  host.innerHTML = ''; renderInspector(host); hydrateIcons(host);
}

const TOKENS = [['', 'none', 'Default'], ['var(--at-text)', 'text', 'Text'], ['var(--at-muted)', 'muted', 'Muted'], ['var(--at-primary)', 'primary', 'Primary'], ['var(--at-accent)', 'accent', 'Accent'], ['var(--at-bg)', 'bg', 'Background'], ['var(--at-surface)', 'surface', 'Surface'], ['var(--at-surface-2)', 'surface2', 'Alt background'], ['var(--at-primary-text)', 'primaryText', 'On primary']];
function tokRow(prop, cur, withGrad) {
  const c = S.site.theme.colors;
  return `<div class="tok-row" data-prop="${prop}">${TOKENS.map(([v, k, n]) => `<button class="tok ${k === 'none' ? 'none' : ''} ${cur === v ? 'on' : ''}" data-v="${esc(v)}" title="${n}" style="${k !== 'none' ? `background:${c[k]}` : ''}"></button>`).join('')}${withGrad ? `<button class="tok ${cur === 'var(--at-grad)' ? 'on' : ''}" data-v="var(--at-grad)" title="Gradient" style="background:linear-gradient(120deg,${c.primary},${c.accent})"></button>` : ''}<span class="color-in" title="Custom colour"><input type="color" data-custom value="${/^#/.test(cur) ? cur : '#888888'}"></span></div>`;
}
const styleOf = (inline, prop) => { const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)').exec(inline || ''); return m ? m[1].trim() : ''; };

function renderInspector(host) {
  const f = S.sel && findSec(S.sel.id);
  if (!f) {
    host.innerHTML = `<div class="insp-empty"><div class="big">${icon('cursor', 24)}</div><b style="color:var(--fg)">Click anything in the preview</b><span>Select a section to move, restyle or rewrite it. Double-click text to edit it in place, or an image to replace it.</span></div>
    <div class="pane"><div class="group-title">This page</div><div class="quick">
      <button data-q="Review this page like a senior designer and fix the 5 things that most hold it back. Screenshot desktop and phone before and after.">${icon('wand2', 15)} Polish this page with AI</button>
      <button data-q="Check this page on a phone (390px) and fix anything that overflows, is too small to tap, or reads badly.">${icon('phone', 15)} Fix it for phones</button>
      <button data-q="Rewrite the copy on this page so it is specific, benefit-led and confident. Keep the structure.">${icon('type', 15)} Rewrite the copy</button>
      <button data-audit>${icon('shield', 15)} Check quality</button>
      <button data-page-seo>${icon('search', 15)} Page settings & SEO</button></div></div>`;
    $$('[data-q]', host).forEach((b) => b.onclick = () => sendChat(b.dataset.q));
    $('[data-audit]', host).onclick = () => auditSheet(); $('[data-page-seo]', host).onclick = () => pageSheet(curPage());
    return;
  }
  const s = f.sec; const info = S.sel.info; const el = S.sel.path && S.sel.path.length && info ? info : null;
  const where = f.where === 'page' ? `${esc(f.page.title)} · section ${f.index + 1}` : `Shared ${f.where} · every page`;
  let h = `<div class="pane" style="padding-top:12px">
    <div class="insp-title"><input value="${esc(s.name)}" data-name title="Rename"></div>
    <div class="tiny muted" style="margin-top:-8px">${where}${s.type !== 'custom' ? ' · ' + esc(s.type) : ''}</div>
    <div class="insp-acts">
      ${f.where === 'page' ? `<button class="btn xs" data-act="up">${icon('arrowUp', 13)}</button><button class="btn xs" data-act="down">${icon('arrowDown', 13)}</button><button class="btn xs" data-act="dup">${icon('dup', 13)} Duplicate</button>` : ''}
      <button class="btn xs" data-act="code">${icon('code', 13)} Code</button><button class="btn xs danger" data-act="delete">${icon('trash', 13)}</button></div>
    <div class="group"><div class="group-title">Ask AI about this section</div>
      <div class="row"><input class="input sm grow" data-ask placeholder="e.g. make it feel more premium"><button class="btn sm primary" data-ask-go>${icon('send', 14)}</button></div>
      <div class="chat-sugg">${['More premium', 'Tighter copy', 'Add an animation', 'Different layout', 'Fix on phones'].map((x) => `<button data-sugg="${x}">${x}</button>`).join('')}</div></div>`;
  // spacing of the section root
  const rootInline = !el && info ? info.inline : '';
  if (!el) h += `<div class="group"><div class="group-title">Section</div>
      <div class="kv"><label>Background</label>${tokRow('background', styleOf(rootInline, 'background'), true)}</div>
      <div class="kv"><label>Space above</label><div class="num-in"><input data-sp="padding-top" value="${esc(styleOf(rootInline, 'padding-top'))}" placeholder="auto"><span>px</span></div></div>
      <div class="kv"><label>Space below</label><div class="num-in"><input data-sp="padding-bottom" value="${esc(styleOf(rootInline, 'padding-bottom'))}" placeholder="auto"><span>px</span></div></div>
      <span class="hint">Click an element inside the section to style it.</span></div>`;
  if (el) {
    const st = (p) => styleOf(el.inline, p); const isImg = el.tag === 'img'; const isLink = el.tag === 'a';
    h += `<div class="group"><div class="group-title">Element</div><div class="crumbs">${el.crumbs.map((c, i) => `<button data-crumb="${i}" class="${i === el.crumbs.length - 1 ? 'on' : ''}">${esc(c.tag)}${c.cls ? '.' + esc(c.cls.split('.')[0]) : ''}</button>`).join('')}</div>`;
    if (el.textish) h += `<div class="row"><button class="btn xs" data-edit-text>${icon('edit', 13)} Edit text</button><span class="tiny muted ellip">“${esc(el.text)}”</span></div>`;
    if (isImg) h += `<div class="row" style="align-items:flex-start;gap:10px"><img src="http://127.0.0.1:${S.info.previewPort}/${esc(el.src.replace(/^\.\.\//, ''))}" style="width:86px;height:64px;object-fit:cover;border-radius:7px;border:1px solid var(--line-2)"><div class="col grow" style="gap:6px"><button class="btn xs" data-replace>${icon('image', 13)} Replace image</button><input class="input sm" data-alt value="${esc(el.alt)}" placeholder="Describe the image (alt text)"></div></div>
      <div class="kv"><label>Fit</label><div class="seg sm full">${['cover', 'contain'].map((x) => `<button data-css="object-fit" data-v="${x}" class="${st('object-fit') === x ? 'on' : ''}">${x}</button>`).join('')}</div></div>`;
    if (isLink) h += `<div class="field"><label>Link to</label><div class="row"><select class="select sm grow" data-link><option value="">Custom address…</option>${S.site.pages.map((p) => `<option value="${p.slug === 'index' ? 'index' : p.slug}.html" ${el.href === (p.slug === 'index' ? 'index' : p.slug) + '.html' ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></div><input class="input sm" data-href value="${esc(el.href)}" placeholder="https://… or about.html or #section"><label class="chk"><input type="checkbox" data-blank ${el.target === '_blank' ? 'checked' : ''}> Open in a new tab</label></div>`;
    if (!isImg) h += `<div class="kv"><label>Text colour</label>${tokRow('color', st('color'))}</div>
      <div class="kv"><label>Size</label><div class="num-in"><input data-px="font-size" value="${esc(st('font-size').replace('px', ''))}" placeholder="${esc(parseInt(el.computed.fontSize))}"><span>px</span></div></div>
      <div class="kv"><label>Weight</label><select class="select sm" data-sel="font-weight"><option value="">Default (${esc(el.computed.fontWeight)})</option>${[300, 400, 500, 600, 700, 800, 900].map((w) => `<option ${st('font-weight') == w ? 'selected' : ''}>${w}</option>`).join('')}</select></div>
      <div class="kv"><label>Align</label><div class="seg sm full">${['left', 'center', 'right'].map((x) => `<button data-css="text-align" data-v="${x}" class="${st('text-align') === x ? 'on' : ''}">${x}</button>`).join('')}</div></div>`;
    h += `<div class="kv"><label>Background</label>${tokRow('background', st('background'), true)}</div>
      <div class="kv"><label>Padding</label><div class="num-in"><input data-px="padding" value="${esc(st('padding').replace('px', ''))}" placeholder="${esc(el.computed.padding)}"><span>px</span></div></div>
      <div class="kv"><label>Corners</label><div class="num-in"><input data-px="border-radius" value="${esc(st('border-radius').replace('px', ''))}" placeholder="${esc(el.computed.borderRadius)}"><span>px</span></div></div>
      <div class="kv"><label>Max width</label><div class="num-in"><input data-px="max-width" value="${esc(st('max-width').replace('px', ''))}" placeholder="none"><span>px</span></div></div>
      <div class="insp-acts"><button class="btn xs" data-el="move-up" title="Move before its sibling">${icon('arrowUp', 13)}</button><button class="btn xs" data-el="move-down">${icon('arrowDown', 13)}</button><button class="btn xs" data-el="duplicate">${icon('dup', 13)} Duplicate</button>${el.inline ? `<button class="btn xs" data-el="reset">Reset styles</button>` : ''}<button class="btn xs danger" data-el="remove">${icon('trash', 13)}</button></div></div>`;
  }
  h += '</div>';
  host.innerHTML = h;
  const apply = (msg) => toFrame({ type: 'apply', id: s.id, path: el ? S.sel.path : [], ...msg });
  $('[data-name]', host).onchange = (e) => attempt(async () => { await call('sections:update', s.id, { name: e.target.value.trim() || s.name }); await refreshSite(); });
  $$('[data-act]', host).forEach((b) => b.onclick = () => sectionAction(b.dataset.act, s.id));
  const ask = (t) => sendChat(`For the section "${s.name}" (${s.id}): ${t}`);
  $('[data-ask-go]', host).onclick = () => { const v = $('[data-ask]', host).value.trim(); if (v) ask(v); };
  $('[data-ask]', host).onkeydown = (e) => { if (e.key === 'Enter' && e.target.value.trim()) ask(e.target.value.trim()); };
  $$('[data-sugg]', host).forEach((b) => b.onclick = () => ask({ 'More premium': 'make it look more premium and refined — better hierarchy, spacing, subtle depth.', 'Tighter copy': 'tighten the copy: shorter, specific, benefit-led.', 'Add an animation': 'add tasteful entrance/hover animation.', 'Different layout': 'try a noticeably different, stronger layout for the same content.', 'Fix on phones': 'check it at 390px and fix anything that overflows or reads badly.' }[b.dataset.sugg]));
  $$('.tok-row', host).forEach((row) => {
    const prop = row.dataset.prop;
    $$('[data-v]', row).forEach((b) => b.onclick = () => apply({ style: { [prop]: b.dataset.v }, label: 'Style' }));
    const c = $('[data-custom]', row); let t; c.oninput = () => { clearTimeout(t); t = setTimeout(() => apply({ style: { [prop]: c.value }, label: 'Style' }), 150); };
  });
  $$('[data-sp]', host).forEach((i) => i.onchange = () => apply({ style: { [i.dataset.sp]: i.value.trim() ? (/^\d+$/.test(i.value.trim()) ? i.value.trim() + 'px' : i.value.trim()) : '' }, label: 'Spacing' }));
  $$('[data-px]', host).forEach((i) => i.onchange = () => apply({ style: { [i.dataset.px]: i.value.trim() ? (/^[\d.]+$/.test(i.value.trim()) ? i.value.trim() + 'px' : i.value.trim()) : '' }, label: 'Style' }));
  $$('[data-sel]', host).forEach((i) => i.onchange = () => apply({ style: { [i.dataset.sel]: i.value }, label: 'Style' }));
  $$('[data-css]', host).forEach((b) => b.onclick = () => apply({ style: { [b.dataset.css]: b.classList.contains('on') ? '' : b.dataset.v }, label: 'Style' }));
  $$('[data-crumb]', host).forEach((b) => b.onclick = () => { const c = el.crumbs[+b.dataset.crumb]; toFrame({ type: 'select', id: s.id, path: c.path, report: true }); });
  const q = (sel) => $(sel, host);
  if (q('[data-edit-text]')) q('[data-edit-text]').onclick = () => { toFrame({ type: 'start-text', id: s.id, path: S.sel.path }); frame().focus(); };
  if (q('[data-replace]')) q('[data-replace]').onclick = () => pickImage((src) => apply({ attrs: { src }, label: 'Replace image' }));
  if (q('[data-alt]')) q('[data-alt]').onchange = (e) => apply({ attrs: { alt: e.target.value.trim() }, label: 'Alt text' });
  if (q('[data-link]')) q('[data-link]').onchange = (e) => { if (e.target.value) { q('[data-href]').value = e.target.value; apply({ attrs: { href: e.target.value }, label: 'Link' }); } };
  if (q('[data-href]')) q('[data-href]').onchange = (e) => apply({ attrs: { href: e.target.value.trim() }, label: 'Link' });
  if (q('[data-blank]')) q('[data-blank]').onchange = (e) => apply({ attrs: { target: e.target.checked ? '_blank' : null, rel: e.target.checked ? 'noopener' : null }, label: 'Link' });
  $$('[data-el]', host).forEach((b) => b.onclick = () => { const a = b.dataset.el; apply(a === 'remove' ? { remove: true, label: 'Delete element' } : a === 'duplicate' ? { duplicate: true, label: 'Duplicate element' } : a === 'reset' ? { attrs: { style: null }, label: 'Reset styles' } : { move: a === 'move-up' ? -1 : 1, label: 'Move element' }); });
}
