// Dither — Starter effects, Connections (the Claude/Codex plugin, Ask, the local model, Sprite Fusion) and Settings.
'use strict';

// ───────── Starter effects
const LIB_GROUPS = ['All', 'Combat', 'Elements', 'Magic', 'Feedback', 'Environment'];
VIEWS.library = {
  title: 'Starter effects',
  head() { return `<h1>Starter effects</h1><div class="seg" id="libSeg">${LIB_GROUPS.map((g) => `<button data-g="${g}" class="${(S.libGroup || 'All') === g ? 'on' : ''}">${g}</button>`).join('')}</div>`; },
  async render(view) {
    const lib = (S.lib ||= await call('library:list')); const g = S.libGroup || 'All';
    view.innerHTML = `<div class="lead">Working effects written with Dither’s kit — references for Claude and starting points for you. Add one to the project to make it your own; Claude can read them with <code>get_library_effect</code>.</div>
      <div class="card-grid">${lib.filter((l) => g === 'All' || l.group === g).map((l) => `<div class="fx-card lib" data-id="${l.id}"><div class="d-stage loading"></div><div class="d-body"><div class="row"><div class="d-name grow">${esc(l.name)}</div><span class="pill">${esc(l.group)}</span></div><div class="d-idea">${esc(l.blurb)}</div><div class="row lib-acts"><button class="btn xs" data-a="add">${icon('plus', 13)}Add to project</button><button class="btn xs ghost" data-a="code">${icon('code', 13)}Code</button></div></div></div>`).join('')}</div>`;
    $$('.fx-card', view).forEach((el) => {
      const l = lib.find((x) => x.id === el.dataset.id); const st = $('.d-stage', el); const cv = document.createElement('canvas'); st.appendChild(cv);
      const p = new Player(cv, { pad: 10, max: 6, bg: 'auto', gap: 300 });
      (Frames.map.get('lib:' + l.id) ? Promise.resolve(Frames.map.get('lib:' + l.id)) : Frames.code(l.code).then((r) => (Frames.map.set('lib:' + l.id, r), r))).then((r) => { if (!p.disposed) p.set(r.frames, r.meta); st.classList.remove('loading'); }).catch((e) => { st.textContent = e.message; });
      $('[data-a=add]', el).onclick = async () => { const m = await call('library:add', l.id); await loadProject(); toast('Added', `${l.name} is in Effects`); go('lab', m.id); };
      $('[data-a=code]', el).onclick = () => openSheet(`<div class="sheet-head">${icon('code', 20)}<h3 class="grow">${esc(l.name)}</h3><button class="icon-btn sm" onclick="closeSheet()">${icon('x', 16)}</button></div><div class="sheet-body"><pre class="code-view">${highlight(l.code)}</pre></div>`, { width: 820 });
    });
  },
  after() { $$('#libSeg [data-g]').forEach((b) => b.onclick = () => { S.libGroup = b.dataset.g; render(); }); },
};

// ───────── Connections
VIEWS.connections = {
  title: 'Connections',
  async render(view) {
    view.innerHTML = `<div class="lead">Dither is built to be driven by your AI. The plugin gives Claude and Codex tools to make drafts, read your feedback, draw sprites, render, record and export — and every result comes back as a picture, so they see what they made.</div><div id="conBody"><div class="empty"><span class="spin"></span></div></div>`;
    let st, a; try { [st, a] = await Promise.all([call('connectors:status'), call('ai:status')]); } catch (e) { $('#conBody').innerHTML = `<div class="mk-err">${esc(e.message)}</div>`; return; }
    S.ai = a; const b = st.bridge || {};
    const row = (k, name, sub, info, btn) => `<div class="con-row"><div class="con-ic">${icon(k === 'codex' ? 'terminal' : k === 'code' ? 'terminal' : 'chat', 18)}</div><div class="grow"><b>${name}</b><div class="muted small">${sub}</div></div>${info}${btn}</div>`;
    const state = (x) => (x.current ? `<span class="pill ok">${icon('check', 11)}Added</span>` : x.added ? `<span class="pill warn">Needs update</span>` : x.installed ? '' : `<span class="pill">Not installed</span>`);
    $('#conBody').innerHTML = `<section class="con-card"><div class="con-h"><b>Plugin</b><span class="grow"></span><span class="dot ${b.connected ? 'on' : ''}"></span><span class="small muted">${b.connected ? `${esc(byWho(b.client))} connected ${esc(ago(b.lastSeen))}` : b.running ? 'Ready — waiting for Claude or Codex' : 'Starting…'}</span></div>
        ${row('desktop', 'Claude Desktop', 'Adds Dither to claude_desktop_config.json. Restart Claude afterwards.', state(st.desktop), `<button class="btn sm ${st.desktop.current ? '' : 'primary'}" data-c="desktop">${st.desktop.added ? 'Update' : 'Add to Claude'}</button>`)}
        ${row('code', 'Claude Code', st.code.installed ? `Found ${esc(st.code.version || 'claude')}. Adds Dither at user scope.` : 'Not found on this computer. You can still add it by hand:', state(st.code), `<button class="btn sm ${st.code.current ? '' : 'primary'}" data-c="code">${st.code.added ? 'Update' : 'Add to Claude Code'}</button>`)}
        ${row('codex', 'Codex', st.codex.installed ? 'Adds Dither to ~/.codex/config.toml (CLI, IDE and the Codex app).' : 'Not found on this computer.', state(st.codex), `<button class="btn sm ${st.codex.current ? '' : 'primary'}" data-c="codex">${st.codex.added ? 'Update' : 'Add to Codex'}</button>`)}
        <details class="con-manual"><summary>Add by hand</summary><div class="code-line"><code>${esc(st.code.cmd)}</code><button class="icon-btn xs" data-copy="${esc(st.code.cmd)}">${icon('copy', 13)}</button></div><div class="code-line"><code>${esc(st.codex.cmd)}</code><button class="icon-btn xs" data-copy="${esc(st.codex.cmd)}">${icon('copy', 13)}</button></div></details></section>
      <section class="con-card"><div class="con-h"><b>Ask from inside Dither</b></div>
        <div class="con-row"><div class="con-ic">${icon('sparkle', 18)}</div><div class="grow"><b>${a.claude ? 'Claude Code' : a.codex ? 'Codex' : 'Not available'}</b><div class="muted small">${a.claude || a.codex ? 'The “Ask Claude” box runs your own sign-in, headless, with only Dither’s tools.' : 'Install Claude Code or Codex to ask from here. Claude Desktop with the plugin works without it.'}</div></div>${a.claude && a.codex ? `<select class="select sm" id="askProv"><option value="auto" ${S.settings.askProvider === 'auto' ? 'selected' : ''}>Claude Code first</option><option value="codex" ${S.settings.askProvider === 'codex' ? 'selected' : ''}>Codex</option></select>` : ''}</div></section>
      <section class="con-card"><div class="con-h"><b>Local model</b></div>
        <div class="con-row"><div class="con-ic">${icon('cpu', 18)}</div><div class="grow"><b>Stable Diffusion through Kiln</b><div class="muted small">Dither uses the engine Kiln runs (Forge, A1111 or ComfyUI) with the Pixel Art XL LoRA, then snaps the result to a real pixel grid. Claude can call it with <code>generate_image</code>.</div></div><button class="btn sm" id="toMake">Set up</button></div></section>
      <section class="con-card"><div class="con-h"><b>More effects for Claude to learn from</b></div>
        <div class="con-row"><div class="con-ic">${icon('book', 18)}</div><div class="grow"><b>Sprite Fusion pixel-art VFX</b><div class="muted small">An MIT-licensed library of 25 pixel effects with an MCP server of its own. Add it next to Dither and Claude can read their recipes as references, then build the effect here.</div></div><div class="code-line inline"><code>https://www.spritefusion.com/mcp</code><button class="icon-btn xs" data-copy="https://www.spritefusion.com/mcp">${icon('copy', 13)}</button></div></div></section>`;
    hydrateIcons(view);
    $$('[data-c]', view).forEach((x) => x.onclick = async () => { x.disabled = true; try { await call('connectors:' + x.dataset.c); toast('Added', x.dataset.c === 'desktop' ? 'Restart Claude Desktop to load Dither' : 'Start a new session to load Dither'); render(); } catch (e) { fail(e); x.disabled = false; } });
    $$('[data-copy]', view).forEach((x) => x.onclick = () => { call('clipboard:write', x.dataset.copy); toast('Copied'); });
    const ap = $('#askProv'); if (ap) ap.onchange = async () => { S.settings = await call('settings:set', { askProvider: ap.value }); };
    $('#toMake').onclick = () => go('make');
  },
};

// ───────── Settings
VIEWS.settings = {
  title: 'Settings',
  render(view) {
    const s = S.settings;
    view.innerHTML = `<div class="settings">
      <div class="set-row"><div class="grow"><b>Appearance</b></div><div class="seg" id="setTheme">${[['system', 'System'], ['dark', 'Dark'], ['light', 'Light']].map(([k, l]) => `<button data-t="${k}" class="${s.theme === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="set-row"><div class="grow"><b>Projects folder</b><div class="muted small">${esc(tildify(S.info.projectsRoot))}</div></div><button class="btn sm" id="setOpen">Show</button><button class="btn sm" id="setDir">Change…</button></div>
      <div class="set-row"><div class="grow"><b>Preview background</b><div class="muted small">Behind effects on boards and in the lab</div></div><div class="seg" id="setBg">${BG_OPTS.map(([k, l]) => `<button data-bg="${k}" class="${(s.previewBg || 'checker') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="set-row"><div class="grow"><b>Image engine address</b><div class="muted small">Leave empty to look on the usual ports</div></div><input class="input" id="setUrl" value="${esc(s.engineUrl || '')}" placeholder="http://127.0.0.1:7860" style="width:260px"></div>
      <div class="set-foot muted small">Dither ${esc(S.info.version)} · data in ${esc(tildify(S.info.userData))}</div></div>`;
    $$('#setTheme [data-t]').forEach((b) => b.onclick = async () => { S.settings = await call('settings:set', { theme: b.dataset.t }); applyThemeNow(); render(); });
    $$('#setBg [data-bg]').forEach((b) => b.onclick = async () => { S.settings = await call('settings:set', { previewBg: b.dataset.bg }); render(); });
    $('#setOpen').onclick = () => openPath(S.info.projectsRoot);
    $('#setDir').onclick = async () => { const d = await call('dialog:folder'); if (!d) return; S.settings = await call('settings:set', { projectsDir: d }); S.info = await call('app:info'); Frames.clear(); await loadProject(); render(); };
    $('#setUrl').onchange = async (e) => { S.settings = await call('settings:set', { engineUrl: e.target.value.trim() }); };
  },
};
