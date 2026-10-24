// Cadence — the Automations list, and the "New automation" sheet (describe it, start from a template, or blank).
'use strict';

VIEWS.flows = {
  title: 'Automations',
  head: () => `<h1>Automations${S.flows.length ? `<small>${S.flows.filter((f) => f.enabled).length} on · ${S.flows.length} total</small>` : ''}</h1>`,
  actions: () => `<button class="btn" id="importBtn">${icon('import', 15)}Import</button><button class="btn primary" id="newBtn">${icon('plus', 15)}New automation</button>`,
  render(view) {
    if (!S.flows.length) {
      view.innerHTML = `<div class="hero-empty">
        <div class="he-rhythm">${weekStrip({ type: 'schedule', every: 'week', days: [1] }, null)}</div>
        <h2>Put your busywork on a schedule</h2>
        <p>Pull a report from a site every Monday, file it in a folder named for the week, and turn it into slides before you’ve had coffee.</p>
        <div class="row" style="justify-content:center;gap:10px;margin-top:6px"><button class="btn primary lg" id="heTpl">${icon('templates', 16)}Start from a template</button><button class="btn lg" id="heDesc">${icon('sparkle', 16)}Describe it</button></div>
      </div>`;
      $('#heTpl').onclick = () => go('templates');
      $('#heDesc').onclick = () => describeSheet();
      return;
    }
    const groups = [['Scheduled', S.flows.filter((f) => f.trigger.type === 'schedule')], ['When a file arrives', S.flows.filter((f) => f.trigger.type === 'watch')], ['When you run them', S.flows.filter((f) => f.trigger.type === 'manual')]].filter(([, l]) => l.length);
    view.innerHTML = groups.map(([label, list]) => `<div class="section-title">${esc(label)}<span class="muted">${list.length}</span></div><div class="flow-list">${list.sort((a, b) => (a.nextAt || 9e15) - (b.nextAt || 9e15)).map(flowRow).join('')}</div>`).join('');
    $$('.frow', view).forEach((row) => {
      const id = row.dataset.id;
      row.onclick = (e) => { if (e.target.closest('button,.switch')) return; go('editor', id); };
      row.querySelector('.switch').onclick = async (e) => { e.stopPropagation(); const f = S.flows.find((x) => x.id === id); try { await call('flows:enable', id, !f.enabled); await loadFlows(); render(); if (!f.enabled) toast(`${f.name} is on`, f.trigger.type === 'schedule' ? f.when : f.trigger.type === 'watch' ? 'Watching the folder' : ''); } catch (er) { fail(er); } };
      row.querySelector('[data-a=run]').onclick = (e) => { e.stopPropagation(); runFlow(id); };
      row.querySelector('[data-a=more]').onclick = (e) => { e.stopPropagation(); flowMenu(e.currentTarget, id); };
    });
  },
  after() { const n = $('#newBtn'); if (n) n.onclick = (e) => newMenu(e.currentTarget); const i = $('#importBtn'); if (i) i.onclick = importFlow; },
};

function flowRow(f) {
  const running = f.running && S.live[f.running];
  const last = f.lastRun;
  const tw = triggerWords(f);
  let lastTxt = '<span class="muted">Not run yet</span>';
  if (running) lastTxt = `<span class="pill acc"><span class="spin" style="width:10px;height:10px;border-width:1.5px"></span>Running</span>`;
  else if (last) lastTxt = `${statusPill(last.status)}<span class="muted small">${esc(ago(last.at))}</span>`;
  return `<div class="frow${f.enabled ? '' : ' off'}" data-id="${f.id}">
    ${flowTile(f)}
    <div class="fr-main"><div class="fr-name ellip">${esc(f.name)}</div><div class="fr-when">${icon(tw.icon, 13)}<span class="ellip">${esc(tw.text)}</span></div></div>
    ${weekStrip(f.trigger, f.enabled ? f.nextAt : null)}
    <div class="fr-next tnum">${f.enabled && f.nextAt ? `<b>${esc(whenAt(f.nextAt))}</b><span>${esc(until(f.nextAt))}</span>` : f.enabled && f.trigger.type === 'watch' ? '<b>Watching</b><span>for new files</span>' : f.trigger.type === 'manual' ? '<span>—</span>' : '<span>Off</span>'}</div>
    <div class="fr-last">${lastTxt}</div>
    <div class="fr-act"><button class="switch ${f.enabled ? 'on' : ''}" title="${f.enabled ? 'Switch off' : 'Switch on'}" ${f.trigger.type === 'manual' ? 'style="visibility:hidden"' : ''}></button><button class="icon-btn sm" data-a="run" title="Run now">${icon('play', 15)}</button><button class="icon-btn sm" data-a="more" title="More">${icon('more', 16)}</button></div>
  </div>`;
}

function flowMenu(anchor, id) {
  const f = S.flows.find((x) => x.id === id);
  menu(anchor, [
    { label: 'Edit', icon: 'edit', run: () => go('editor', id) },
    { label: 'Run now', icon: 'play', run: () => runFlow(id) },
    { label: 'See runs', icon: 'runs', run: () => { S.runFilter = id; go('runs'); } },
    '-',
    { label: 'Duplicate', icon: 'copy', run: async () => { try { const d = await call('flows:duplicate', id); await loadFlows(); go('editor', d.id); } catch (e) { fail(e); } } },
    { label: 'Export…', icon: 'export', run: async () => { try { const p = await call('flows:export', id); if (p) toast('Exported', baseName(p)); } catch (e) { fail(e); } } },
    '-',
    { label: 'Delete', icon: 'trash', danger: true, run: async () => { if (await confirmBox({ title: `Delete “${f.name}”?`, text: 'Its schedule stops and it leaves the list. Files it already made stay where they are.', ok: 'Delete', danger: true })) { await call('flows:remove', id); await loadFlows(); render(); toast('Deleted', f.name); } } },
  ], { align: 'right', width: 220 });
}

function newMenu(anchor) {
  menu(anchor, [
    { label: 'Describe it…', icon: 'sparkle', hint: 'AI', run: () => describeSheet() },
    { label: 'From a template', icon: 'templates', run: () => go('templates') },
    { label: 'Blank', icon: 'plus', run: () => createBlank() },
  ], { align: 'right', width: 230 });
}
async function createBlank() { try { const r = await call('flows:save', { name: 'New automation', trigger: { type: 'manual' }, steps: [], enabled: false }); await loadFlows(); go('editor', r.flow.id); } catch (e) { fail(e); } }
async function importFlow() { try { const f = await call('flows:import'); if (f) { await loadFlows(); go('editor', f.id); toast('Imported', f.name); } } catch (e) { fail(e); } }

// "Describe it": Claude / Codex drafts the automation; you check it in the editor.
async function describeSheet(existing) {
  const st = S.ai || await call('ai:status').catch(() => ({}));
  S.ai = st;
  const ready = st.claude || st.codex || st.anthropic || st.openai;
  const examples = ['Every Monday at 8, log in to our reporting site, export last week’s sign-ups as CSV, save it in Documents/Reports/<week>, and make a 4-slide PowerPoint with totals by channel compared with the week before.', 'When a PDF lands in Downloads with “invoice” in the name, move it to Documents/Invoices/<month>.', 'On the first weekday of each month, combine last month’s CSVs from Documents/Exports into one Excel workbook with a totals sheet.'];
  const el = openSheet(`<div class="sheet-head">${tile('sparkle', 'violet', 'lg')}<div><h3>${existing ? 'Change it with AI' : 'Describe your automation'}</h3><div class="muted small">${ready ? `${st.claude ? 'Claude' : st.codex ? 'Codex' : 'Your API key'} writes the steps; you check them before anything runs.` : 'Needs Claude Code, Codex or an API key — set one up in Connections.'}</div></div></div>
    <div class="sheet-body">
      <textarea class="input area" id="dsText" rows="5" placeholder="${existing ? 'e.g. Also post the deck to our Slack channel, and run at 7:30 instead' : 'What should happen, and when?'}"></textarea>
      ${existing ? '' : `<div class="examples">${examples.map((x) => `<button class="ex">${esc(x)}</button>`).join('')}</div>`}
      <div id="dsProg" class="muted small" hidden></div>
    </div>
    <div class="sheet-foot">${ready ? '' : `<button class="btn" id="dsSetup">${icon('plug', 15)}Set up AI</button>`}<span class="grow"></span><button class="btn" id="dsCancel">Cancel</button><button class="btn primary" id="dsGo" ${ready ? '' : 'disabled'}>${icon('wand', 15)}${existing ? 'Make the change' : 'Build it'}</button></div>`, { width: 640 });
  $$('.ex', el).forEach((b) => b.onclick = () => { $('#dsText').value = b.textContent; $('#dsText').focus(); });
  $('#dsCancel').onclick = closeSheet;
  if ($('#dsSetup')) $('#dsSetup').onclick = () => { closeSheet(); go('connections'); };
  $('#dsGo').onclick = async () => {
    const text = $('#dsText').value.trim(); if (!text) return $('#dsText').focus();
    $('#dsGo').disabled = true; $('#dsGo').innerHTML = '<span class="spin"></span>Building…';
    const prog = $('#dsProg'); prog.hidden = false; prog.textContent = 'Asking…';
    const off = C.on('ai:progress', (m) => { prog.textContent = m; });
    try {
      const r = await call('ai:draft', text, existing || null);
      off();
      const flow = { ...r.flow, enabled: existing ? existing.enabled : false };
      const saved = await call('flows:save', flow);
      S.sheetClose = null; closeSheet(); await loadFlows();
      go('editor', saved.flow.id);
      toast(existing ? 'Updated' : 'Drafted', r.problems.ok ? 'Check the steps, then test it.' : `${r.problems.errors.length} thing${r.problems.errors.length === 1 ? '' : 's'} to fill in — marked in red.`, r.problems.ok ? 'ok' : 'info', 6000);
    } catch (e) { off(); $('#dsGo').disabled = false; $('#dsGo').innerHTML = `${icon('wand', 15)}Try again`; prog.textContent = e.message; prog.classList.add('err'); }
  };
}
