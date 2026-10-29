// Dither — Drafts: one board per idea, every take playing side by side. You pick, pass and leave notes; Claude reads
// them (get_feedback) and refines. This is the article's loop made into a screen.
'use strict';

const VERDICTS = [{ v: 'pick', label: 'Pick', icon: 'star' }, { v: 'maybe', label: 'Maybe', icon: 'maybe' }, { v: 'no', label: 'Pass', icon: 'x' }];
const BG_OPTS = [['checker', 'Checker'], ['dark', 'Dark'], ['light', 'Light'], ['game', 'Scene']];
const boardOf = () => { const bs = S.project.boards || []; return bs.find((b) => b.id === S.boardId) || bs[0] || null; };
const openNotes = (m) => (m.feedback?.notes || []).filter((n) => !n.done).length;

VIEWS.drafts = {
  title: 'Drafts',
  head() {
    const b = boardOf(); const bs = S.project.boards || [];
    return `<h1>Drafts</h1>${bs.length ? `<button class="btn ghost sm board-pick" id="boardPick">${icon('drafts', 15)}<span class="ellip">${esc(b.idea)}</span>${bs.length > 1 ? `<span class="muted">· ${bs.length} boards</span>` : ''}${icon('chevronDown', 14)}</button>` : ''}`;
  },
  actions() {
    const b = boardOf();
    return `${b ? `<div class="seg" id="bgSeg">${BG_OPTS.map(([k, l]) => `<button data-bg="${k}" class="${(S.settings.previewBg || 'checker') === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}<button class="btn" id="newBoard">${icon('plus', 15)}New idea</button>${b ? `<button class="btn primary" id="nextRound">${icon('sparkle', 15)}Next round</button>` : ''}`;
  },
  render(view) {
    const b = boardOf();
    if (!b) { view.innerHTML = draftsHero(); $('#heroStart').onclick = newBoard; $('#heroLib').onclick = () => go('library'); return; }
    S.boardId = b.id;
    const items = b.items.map(effectById).filter(Boolean);
    const reviewed = items.filter((m) => m.feedback?.verdict || openNotes(m)).length;
    const picks = items.filter((m) => m.feedback?.verdict === 'pick').length;
    view.innerHTML = `<div class="board-top">
        <div class="grow"><div class="bt-idea">${esc(b.idea)}</div>${b.brief ? `<div class="bt-brief">${esc(b.brief)}</div>` : ''}
        <div class="bt-meta">${esc(byWho(b.by))} · ${plural(items.length, 'draft')} · ${esc(ago(b.createdAt))}${b.round > 1 ? ` · round ${b.round}` : ''}</div></div>
        <div class="bt-progress"><div class="btp-num tnum">${reviewed}<span>/${items.length}</span></div><div class="btp-lbl">reviewed</div><div class="bar"><i style="width:${items.length ? Math.round(reviewed / items.length * 100) : 0}%"></i></div><div class="btp-sub">${picks ? `${plural(picks, 'pick')} so far` : 'Pick the ones worth refining'}</div></div>
      </div>
      ${items.length ? `<div class="draft-grid">${items.map(draftCard).join('')}</div>` : `<div class="empty"><b>Waiting for drafts</b><span>Ask Claude to make 5–10 takes on “${esc(b.idea)}”. They appear here as they’re made.</span><button class="btn primary" id="askDrafts">${icon('sparkle', 15)}Ask Claude for drafts</button></div>`}
      <div class="board-foot">${icon('info', 15)}<span>Claude reads your picks and notes with <code>get_feedback</code>. Notes tied to a frame are the most useful: “frame 4 holds too long”.</span><button class="link-btn" id="copyFb">Copy a prompt for your chat</button></div>`;
    $$('.draft', view).forEach((el) => {
      const id = el.dataset.id;
      mountEffect($('.d-stage', el), id, { bg: S.settings.previewBg || 'checker', max: 6 });
      $('.d-stage', el).onclick = () => reviewDraft(id);
      $$('[data-v]', el).forEach((btn) => btn.onclick = async (e) => { e.stopPropagation(); const m = effectById(id); const v = m.feedback?.verdict === btn.dataset.v ? null : btn.dataset.v; await setVerdict(id, v); });
      $('.d-note', el).onclick = () => reviewDraft(id, true);
      $('.d-more', el).onclick = (e) => draftMenu(e.currentTarget, id);
    });
    const ad = $('#askDrafts'); if (ad) ad.onclick = () => askClaude(`Make 6 different drafts for my board “${b.idea}”${b.brief ? ` (brief: ${b.brief})` : ''}. Use create_drafts.`);
    $('#copyFb').onclick = () => { call('clipboard:write', `Read my feedback on the Dither board “${b.idea}” (get_feedback) and refine my picks with update_effect. Address my notes and tell me what you changed.`); toast('Copied', 'Paste it into Claude with the Dither plugin added.'); };
  },
  after() {
    const nb = $('#newBoard'); if (nb) nb.onclick = newBoard;
    const nr = $('#nextRound'); if (nr) nr.onclick = () => { const b = boardOf(); askClaude(`Read my feedback on the board “${b.idea}” with get_feedback. Refine my picks (and anything I left notes on) with update_effect, resolving the notes you address. If I picked nothing yet, make 4 new takes that push in a different direction.`); };
    const bp = $('#boardPick'); if (bp) bp.onclick = () => menu(bp, [{ header: true, label: 'Boards' }, ...S.project.boards.map((b) => ({ label: b.idea, hint: `${b.items.length} · ${ago(b.createdAt)}`, on: b.id === boardOf().id, run: () => { S.boardId = b.id; render(); } })), '-', { label: 'Rename this board…', icon: 'edit', run: renameBoard }, { label: 'Delete this board', icon: 'trash', danger: true, run: deleteBoard }], { width: 340 });
    $$('#bgSeg [data-bg]').forEach((x) => x.onclick = async () => { S.settings = await call('settings:set', { previewBg: x.dataset.bg }); render(); });
  },
  update() { if (S.view === 'drafts') render(); },
};

function draftsHero() {
  return `<div class="hero-empty">
    <div class="loop-art">${['Claude drafts 5–10 takes', 'You pick and leave notes', 'Claude refines your picks'].map((t, i) => `<div class="la-step"><div class="la-n">${i + 1}</div><div>${t}</div></div>${i < 2 ? `<div class="la-arrow">${icon('chevron', 18)}</div>` : ''}`).join('')}</div>
    <h2>Good pixel effects take rounds, not one prompt</h2>
    <p>Start a board for an idea. Claude makes several genuinely different drafts in code, you watch them play side by side and say what works. Repeat until it feels right.</p>
    <div class="row" style="justify-content:center"><button class="btn primary lg" id="heroStart">${icon('plus', 16)}Start a board</button><button class="btn lg" id="heroLib">${icon('book', 16)}Browse starter effects</button></div>
  </div>`;
}

function draftCard(m) {
  const v = m.feedback?.verdict; const n = openNotes(m);
  return `<div class="draft ${v ? 'v-' + v : ''}" data-id="${m.id}">
    <div class="d-stage loading"></div>
    <div class="d-body">
      <div class="row"><div class="d-name grow ellip" title="${esc(m.name)}">${esc(m.name)}</div>${m.current > 1 ? `<span class="pill acc">v${m.current}</span>` : ''}<button class="icon-btn xs d-more">${icon('more', 15)}</button></div>
      ${m.versions?.[m.current - 1]?.note || m.versions?.[0]?.note ? `<div class="d-idea">${esc(m.versions[m.current - 1].note || m.versions[0].note)}</div>` : ''}
      <div class="d-acts"><div class="seg sm verdict">${VERDICTS.map((x) => `<button data-v="${x.v}" class="${v === x.v ? 'on' : ''}" title="${x.label}">${icon(x.icon, 13)}${x.label}</button>`).join('')}</div><span class="grow"></span><button class="btn xs ghost d-note" title="Notes">${icon('note', 14)}${n ? `<b>${n}</b>` : ''}</button></div>
    </div></div>`;
}
async function setVerdict(id, v) { try { await call('effects:feedback', id, { verdict: v }); await loadProject(); if (S.view === 'drafts') render(); } catch (e) { fail(e); } }
function draftMenu(anchor, id) {
  const m = effectById(id);
  menu(anchor, [{ label: 'Review and leave notes', icon: 'note', run: () => reviewDraft(id) }, { label: 'Open in the effect lab', icon: 'code', run: () => go('lab', id) }, { label: m.kept ? 'Kept in Effects' : 'Keep in Effects', icon: 'check', disabled: m.kept, run: async () => { await call('effects:keep', id, true); await loadProject(); toast('Kept', `${m.name} is in Effects now`); } }, '-', { label: 'Record GIF + sheet', icon: 'record', run: async () => filesDone(await call('record', { kind: 'effect', id }).catch(fail), 'Recorded') }, { label: 'Bake into a sprite', icon: 'bake', run: async () => { const sid = await call('sprites:bake', id).catch(fail); if (sid) { await loadProject(); go('editor', sid); } } }, '-', { label: 'Delete draft', icon: 'trash', danger: true, run: async () => { await call('effects:remove', id); await loadProject(); render(); } }], { width: 260, align: 'right' });
}
async function newBoard() {
  const r = await promptBox({ title: 'New idea', text: 'Describe the effect loosely, with the art direction. Claude will make several different takes.', fields: [{ key: 'idea', label: 'Idea', placeholder: 'e.g. MIRV rocket that splits into 5 warheads' }, { key: 'brief', label: 'Art direction (optional)', area: true, placeholder: 'Size, palette, mood, references, what it’s for…' }], ok: 'Create board' });
  if (!r || !r.idea.trim()) return;
  const b = await call('boards:create', { idea: r.idea.trim(), brief: r.brief.trim() }); S.boardId = b.id; await loadProject(); render();
  askClaude(`Make 6 genuinely different drafts for my Dither board “${b.idea}” (board id ${b.id})${b.brief ? `. Art direction: ${b.brief}` : ''}. Use create_drafts.`);
}
async function renameBoard() { const b = boardOf(); const n = await promptBox({ title: 'Rename board', value: b.idea, ok: 'Rename' }); if (!n) return; await call('boards:patch', b.id, { idea: n }); await loadProject(); render(); }
async function deleteBoard() { const b = boardOf(); if (!(await confirmBox({ title: 'Delete this board?', text: `“${b.idea}” goes away. Its drafts stay in the project; picked ones stay in Effects.`, ok: 'Delete', danger: true }))) return; await call('boards:remove', b.id); S.boardId = null; await loadProject(); render(); }

// ───────── review sheet: the draft big, frame by frame, with notes
async function reviewDraft(id, focusNote) {
  const m = effectById(id); if (!m) return;
  const el = openSheet(`<div class="review">
      <div class="rv-stage-wrap"><div class="rv-stage"><canvas></canvas></div>
        <div class="rv-bar"><button class="icon-btn sm" data-a="back">${icon('stepBack', 15)}</button><button class="icon-btn sm" data-a="play">${icon('pause', 15)}</button><button class="icon-btn sm" data-a="fwd">${icon('stepFwd', 15)}</button><span class="rv-frame tnum" id="rvFrame">1 / 1</span><span class="grow"></span>
          <div class="seg sm" id="rvSpeed">${[0.25, 0.5, 1].map((s) => `<button data-s="${s}" class="${s === 1 ? 'on' : ''}">${s}×</button>`).join('')}</div>
          <div class="seg sm" id="rvBg">${BG_OPTS.map(([k, l]) => `<button data-bg="${k}" class="${(S.settings.previewBg || 'checker') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
          <button class="icon-btn sm" data-a="onion" title="Onion skin">${icon('onion', 16)}</button></div>
        <div class="filmstrip" id="rvStrip"></div></div>
      <div class="rv-side">
        <div class="row"><h3 class="grow ellip" style="margin:0">${esc(m.name)}</h3><button class="icon-btn sm" data-a="close">${icon('x', 16)}</button></div>
        <div class="muted small">${esc(byWho(m.by))} · v${m.current}${m.versions.length > 1 ? ` of ${m.versions.length}` : ''} · ${esc(ago(m.updatedAt))}</div>
        ${m.versions[m.current - 1]?.note ? `<div class="rv-change">${icon('sparkle', 13)}<span>${esc(m.versions[m.current - 1].note)}</span></div>` : ''}
        <div class="seg full verdict" id="rvVerdict">${VERDICTS.map((x) => `<button data-v="${x.v}" class="${m.feedback?.verdict === x.v ? 'on' : ''}">${icon(x.icon, 14)}${x.label}</button>`).join('')}</div>
        <div class="label" style="margin-top:6px">Notes for Claude</div>
        <div class="notes" id="rvNotes"></div>
        <textarea class="input area" id="rvNote" rows="3" placeholder="What should change? e.g. the flash needs one more frame"></textarea>
        <div class="row"><label class="chk"><input type="checkbox" id="rvAt" checked> about frame <b id="rvAtN">1</b></label><span class="grow"></span><button class="btn sm primary" id="rvAdd">Add note</button></div>
        <div class="rv-foot"><button class="btn sm" data-a="lab">${icon('code', 14)}Open in lab</button><button class="btn sm" data-a="rec">${icon('record', 14)}Record</button></div>
      </div></div>`, { width: 1180, cls: 'review-sheet' });
  const player = new Player($('canvas', el), { pad: 16, max: 16, bg: S.settings.previewBg || 'checker', onFrame: (i) => { $('#rvFrame').textContent = `${i + 1} / ${player.frames.length}`; $('#rvAtN').textContent = i + 1; $$('#rvStrip .fs', el).forEach((t, k) => t.classList.toggle('on', k === i)); } });
  try {
    const r = await Frames.effect(id); player.set(r.frames, r.meta);
    $('#rvFrame').textContent = `1 / ${r.frames.length}`;
    const strip = $('#rvStrip'); strip.innerHTML = r.frames.map((_, i) => `<button class="fs${i === 0 ? ' on' : ''}" data-i="${i}"><canvas></canvas><span>${i + 1}${r.meta.durations[i] !== r.meta.durations[0] ? ` · ${r.meta.durations[i]}ms` : ''}</span></button>`).join('');
    $$('.fs', strip).forEach((b, i) => { const c = $('canvas', b); const s = Math.max(1, Math.floor(44 / Math.max(r.meta.w, r.meta.h))); c.width = r.meta.w; c.height = r.meta.h; c.style.width = r.meta.w * s + 'px'; c.style.height = r.meta.h * s + 'px'; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.frames[i]), r.meta.w, r.meta.h), 0, 0); b.onclick = () => { player.pause(); syncPlay(); player.seek(i); }; });
  } catch (e) { $('.rv-stage', el).innerHTML = `<div class="broken-msg">${icon('alert', 18)}<span>${esc(e.message)}</span></div>`; }
  const syncPlay = () => { $('[data-a=play]', el).innerHTML = icon(player.playing ? 'pause' : 'play', 15); };
  $('[data-a=play]', el).onclick = () => { player.toggle(); syncPlay(); };
  $('[data-a=back]', el).onclick = () => { player.step(-1); syncPlay(); };
  $('[data-a=fwd]', el).onclick = () => { player.step(1); syncPlay(); };
  $('[data-a=onion]', el).onclick = (e) => { player.setOpt('onion', !player.o.onion); e.currentTarget.classList.toggle('on', player.o.onion); };
  $$('#rvSpeed [data-s]', el).forEach((b) => b.onclick = () => { player.setOpt('speed', +b.dataset.s); $$('#rvSpeed button', el).forEach((x) => x.classList.toggle('on', x === b)); });
  $$('#rvBg [data-bg]', el).forEach((b) => b.onclick = () => { player.setOpt('bg', b.dataset.bg); $$('#rvBg button', el).forEach((x) => x.classList.toggle('on', x === b)); });
  $('[data-a=close]', el).onclick = closeSheet;
  $('[data-a=lab]', el).onclick = () => { closeSheet(); go('lab', id); };
  $('[data-a=rec]', el).onclick = async () => filesDone(await call('record', { kind: 'effect', id }).catch(fail), 'Recorded');
  $$('#rvVerdict [data-v]', el).forEach((b) => b.onclick = async () => { const cur = effectById(id).feedback?.verdict; const v = cur === b.dataset.v ? null : b.dataset.v; await call('effects:feedback', id, { verdict: v }); await loadProject(); $$('#rvVerdict button', el).forEach((x) => x.classList.toggle('on', x.dataset.v === v)); if (S.view === 'drafts') { const keep = S.sheetClose; S.sheetClose = null; refreshBoardCards(); S.sheetClose = keep; } });
  const drawNotes = () => notesList($('#rvNotes', el), id, (i) => { player.pause(); syncPlay(); player.seek(i); });
  drawNotes();
  $('#rvAdd', el).onclick = async () => { const t = $('#rvNote', el).value.trim(); if (!t) return; await call('effects:feedback', id, { note: t, frame: $('#rvAt', el).checked ? player.i + 1 : null }); $('#rvNote', el).value = ''; await loadProject(); drawNotes(); };
  $('#rvNote', el).addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#rvAdd', el).click(); });
  const keys = (e) => { if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return; if (e.key === ' ') { e.preventDefault(); player.toggle(); syncPlay(); } if (e.key === 'ArrowLeft') { player.step(-1); syncPlay(); } if (e.key === 'ArrowRight') { player.step(1); syncPlay(); } };
  document.addEventListener('keydown', keys);
  S.sheetClose = () => { document.removeEventListener('keydown', keys); player.dispose(); if (S.view === 'drafts') render(); };
  if (focusNote) setTimeout(() => $('#rvNote', el).focus(), 50);
}
function refreshBoardCards() { $$('.draft').forEach((el) => { const m = effectById(el.dataset.id); if (!m) return; const v = m.feedback?.verdict; el.className = `draft ${v ? 'v-' + v : ''}`; $$('[data-v]', el).forEach((b) => b.classList.toggle('on', b.dataset.v === v)); }); }

// notes list shared by the review sheet and the effect lab
function notesList(host, id, onFrame) {
  const m = effectById(id); const notes = (m && m.feedback?.notes) || [];
  host.innerHTML = notes.length ? notes.map((n, i) => `<div class="nt ${n.done ? 'done' : ''}"><div class="nt-head">${n.frame ? `<button class="nt-frame" data-f="${n.frame}">frame ${n.frame}</button>` : ''}<span class="muted tiny">${esc(byWho(n.by))} · v${n.v || 1} · ${esc(ago(n.at))}</span><span class="grow"></span>${n.done ? `<span class="pill ok">${icon('check', 11)}done</span>` : ''}<button class="icon-btn xs" data-del="${i}" title="Remove">${icon('x', 12)}</button></div><div class="nt-text">${esc(n.text)}</div></div>`).join('') : `<div class="muted small nt-empty">No notes yet. Say what to keep and what to change — Claude reads them next round.</div>`;
  $$('[data-f]', host).forEach((b) => b.onclick = () => onFrame && onFrame(+b.dataset.f - 1));
  $$('[data-del]', host).forEach((b) => b.onclick = async () => { await call('effects:feedback', id, { removeNote: +b.dataset.del }); await loadProject(); notesList(host, id, onFrame); });
}
