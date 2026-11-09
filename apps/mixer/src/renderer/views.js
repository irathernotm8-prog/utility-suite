// Mixer window: Sounds (browse and audition every instrument and kit), Songs, Connections (the Claude/Codex plugin and
// Ask), Settings, and the Export sheet.
'use strict';

// ───────── Sounds
VIEWS.sounds = {
  title: 'Sounds',
  head() { return `<h1>Sounds</h1><div class="seg" id="sndSeg">${['All', ...SND.CATS, 'Drum kits'].map((c) => `<button data-c="${c}" class="${(S.sndCat || 'All') === c ? 'on' : ''}">${c}</button>`).join('')}</div>`; },
  render(view) {
    const cat = S.sndCat || 'All'; const target = S.arg && track(S.arg);
    const inst = (i) => `<div class="snd"><div class="sn-top"><span class="sn-ic">${icon(i.cat === 'Bass' ? 'wave' : i.cat === 'Keys' ? 'piano' : i.cat === 'Pads' ? 'sparkle' : 'sounds', 16)}</span><b>${esc(i.name)}</b><span class="pill">${esc(i.cat)}</span></div><p>${esc(i.desc)}</p><div class="sn-acts"><button class="btn xs" data-play="${i.id}">${icon('play', 12)}Preview</button><span class="grow"></span>${target && target.kind === 'instrument' ? `<button class="btn xs" data-use="${i.id}">Use on ${esc(target.name)}</button>` : ''}<button class="btn xs ${target ? 'ghost' : ''}" data-new="${i.id}">${icon('plus', 12)}New track</button></div></div>`;
    const kitCard = (k) => `<div class="snd"><div class="sn-top"><span class="sn-ic">${icon('drum', 16)}</span><b>${esc(k.name)}</b><span class="pill">Drums</span></div><p>${esc(k.desc)}</p><div class="sn-acts"><button class="btn xs" data-beat="${k.id}">${icon('play', 12)}Preview</button><span class="grow"></span>${target && target.kind === 'drums' ? `<button class="btn xs" data-usek="${k.id}">Use on ${esc(target.name)}</button>` : ''}<button class="btn xs ${target ? 'ghost' : ''}" data-newk="${k.id}">${icon('plus', 12)}New track</button></div></div>`;
    let html = `<div class="lead">Every instrument is synthesized — no sample packs to download — so they all play in any key and at any length. Preview plays a short phrase in the song’s key. ${target ? `Choosing a sound for <b>${esc(target.name)}</b>.` : ''}</div>`;
    for (const c of SND.CATS) if (cat === 'All' || cat === c) html += `<div class="cat-h">${esc(c)}</div><div class="card-grid">${SND.INSTRUMENTS.filter((i) => i.cat === c).map(inst).join('')}</div>`;
    if (cat === 'All' || cat === 'Drum kits') html += `<div class="cat-h">Drum kits</div><div class="card-grid">${SND.KITS.map(kitCard).join('')}</div>`;
    view.innerHTML = html; hydrateIcons(view);
    $$('[data-play]', view).forEach((b) => b.onclick = () => phrase(b.dataset.play));
    $$('[data-beat]', view).forEach((b) => b.onclick = () => beat(b.dataset.beat));
    $$('[data-new]', view).forEach((b) => b.onclick = () => { addTrackOf('instrument', b.dataset.new); toast('Track added', SND.instrument(b.dataset.new).name); });
    $$('[data-newk]', view).forEach((b) => b.onclick = () => { addTrackOf('drums', b.dataset.newk); toast('Track added', SND.kit(b.dataset.newk).name); });
    $$('[data-use]', view).forEach((b) => b.onclick = () => { edit('Change sound', (s) => { SG.updateTrack(s, target.id, { sound: b.dataset.use }); }); toast(`${target.name} now plays ${SND.instrument(b.dataset.use).name}`); });
    $$('[data-usek]', view).forEach((b) => b.onclick = () => { edit('Change kit', (s) => { SG.updateTrack(s, target.id, { sound: b.dataset.usek }); }); toast(`${target.name} now uses ${SND.kit(b.dataset.usek).name}`); });
  },
  after() { $$('#sndSeg [data-c]').forEach((b) => b.onclick = () => { S.sndCat = b.dataset.c; render(); }); },
};
// a little phrase in the song's key so you hear the sound in context
function phrase(id) {
  const P = SND.instrument(id); let K; try { K = TH.parseKey(S.song.key); } catch { K = TH.parseKey('C major'); }
  const bass = P.cat === 'Bass'; const root = (bass ? 36 : 60) + K.tonic - (K.tonic > 6 ? 12 : 0); const sc = TH.SCALES[K.scale].length === 7 ? TH.SCALES[K.scale] : TH.SCALES.major;
  const fake = { id: 'preview', kind: 'instrument', sound: id, effects: (P.fx || []).map((f) => ({ ...SND.effectDefaults(f.type), ...f, id: 'p' + f.type, on: true })), volume: 0, octave: 0 };
  const seq = P.cat === 'Pads' || P.cat === 'Keys' ? [[0, [0, 2, 4], 1.6]] : P.cat === 'FX' ? [[0, [0], 2.5]] : bass ? [[0, [0], 0.4], [0.5, [0], 0.4], [1, [4], 0.4], [1.5, [5], 0.6]] : [[0, [0], 0.3], [0.3, [2], 0.3], [0.6, [4], 0.3], [0.9, [7], 0.6]];
  for (const [t, degs, d] of seq) setTimeout(() => { for (const dg of degs) { const o = Math.floor(dg / 7); const m = root + sc[dg % 7] + 12 * o; Player.preview({ track: fake, sound: id, midi: m, dur: d, vel: 0.8 }); } }, t * 1000);
}
function beat(kitId) { const fake = { id: 'previewk', kind: 'drums', sound: kitId, effects: [] }; const pat = kitId === 'fx' ? [[0, 'impact'], [0.6, 'crash']] : [[0, 'kick'], [0, 'hat'], [0.25, 'hat'], [0.5, 'snare'], [0.5, 'hat'], [0.75, 'hat'], [0.875, 'kick'], [1, 'kick'], [1, 'hat'], [1.25, 'openhat'], [1.5, 'snare'], [1.5, 'clap']]; const spb = 0.5; for (const [t, v] of pat) setTimeout(() => Player.preview({ track: fake, sound: kitId, kind: 'drums', voice: v, vel: v === 'hat' ? 0.6 : 0.9 }), t * spb * 1000 * 2); }

// ───────── Songs
VIEWS.songs = {
  title: 'Songs',
  actions() { return `<button class="btn sm" id="sgReveal">${icon('folder', 15)}Show folder</button><button class="btn sm primary" id="sgNew">${icon('plus', 15)}New song</button>`; },
  async render(view) {
    view.innerHTML = `<div class="empty"><span class="spin"></span></div>`;
    const { list, active } = await call('songs:list'); S.songs = list; $('#songCount').textContent = list.length || '';
    view.innerHTML = `<div class="lead">Each song is a folder in ${esc(tildify(S.info.songsRoot))} with its audio, exports and history. Claude works on whichever song is open.</div><div class="card-grid">${list.map((p) => `<div class="song-card ${p.id === active ? 'on' : ''}" data-id="${esc(p.id)}"><div class="song-art">${Array.from({ length: 24 }, (_, i) => `<i style="height:${18 + Math.round(70 * Math.abs(Math.sin((i + 1) * (p.bpm || 100) * 0.013 + p.name.length)))}%"></i>`).join('')}</div><b>${esc(p.name)}</b><div class="meta">${p.bpm} BPM · ${esc(p.key)} · ${p.bars} bars · ${plural(p.tracks, 'track')}</div><div class="row"><span class="muted tiny grow">${esc(ago(p.updatedAt))}</span>${p.id === active ? '<span class="pill acc">Open</span>' : ''}<button class="icon-btn xs" data-more>${icon('more', 14)}</button></div></div>`).join('')}</div>`;
    hydrateIcons(view);
    $$('.song-card', view).forEach((el) => { el.onclick = (e) => { if (e.target.closest('[data-more]')) return; openSong(el.dataset.id); }; $('[data-more]', el).onclick = (e) => menu(e.currentTarget, [{ label: 'Open', icon: 'folder', run: () => openSong(el.dataset.id) }, { label: 'Duplicate', icon: 'dup', run: async () => { applySnapshot(await call('songs:duplicate', el.dataset.id)); render(); } }, { label: 'Show in folder', icon: 'reveal', run: () => call('songs:reveal', el.dataset.id) }]); });
  },
  after() { $('#sgNew').onclick = newSong; $('#sgReveal').onclick = () => openPath(S.info.songsRoot); },
};

// ───────── Connections
VIEWS.connections = {
  title: 'Connections',
  async render(view) {
    view.innerHTML = `<div class="lead">Mixer is built to be driven by your AI. The plugin gives Claude and Codex tools to start songs, write drums, bass, chords and melodies, import and edit recordings, add effects and automation, and export — and because they can’t hear, every result comes back measured (loudness, key, balance, a mix check) with a picture of the waveform, piano roll or arrangement.</div><div id="conBody"><div class="empty"><span class="spin"></span></div></div>`;
    let st, a; try { [st, a] = await Promise.all([call('connectors:status'), call('ai:status')]); } catch (e) { $('#conBody').innerHTML = `<div class="cnote major">${esc(e.message)}</div>`; return; }
    S.ai = a; const b = st.bridge || {};
    const row = (k, name, sub, info, btn) => `<div class="con-row"><div class="con-ic">${icon(k === 'desktop' ? 'chat' : 'terminal', 18)}</div><div class="grow"><b>${name}</b><div class="muted small">${sub}</div></div>${info}${btn}</div>`;
    const state = (x) => (x.current ? `<span class="pill ok">${icon('check', 11)}Added</span>` : x.added ? `<span class="pill warn">Needs update</span>` : x.installed ? '' : `<span class="pill">Not installed</span>`);
    $('#conBody').innerHTML = `<section class="con-card"><div class="con-h"><b>Plugin</b><span class="grow"></span><span class="dot ${b.connected ? 'on' : ''}"></span><span class="small muted">${b.connected ? `${esc(byWho(b.client))} connected ${esc(ago(b.lastSeen))}` : b.running ? 'Ready — waiting for Claude or Codex' : 'Starting…'}</span></div>
        ${row('desktop', 'Claude Desktop', 'Adds Mixer to claude_desktop_config.json. Restart Claude afterwards.', state(st.desktop), `<button class="btn sm ${st.desktop.current ? '' : 'primary'}" data-c="desktop">${st.desktop.added ? 'Update' : 'Add to Claude'}</button>`)}
        ${row('code', 'Claude Code', st.code.installed ? `Found ${esc(st.code.version || 'claude')}. Adds Mixer at user scope.` : 'Not found on this computer. You can still add it by hand:', state(st.code), `<button class="btn sm ${st.code.current ? '' : 'primary'}" data-c="code">${st.code.added ? 'Update' : 'Add to Claude Code'}</button>`)}
        ${row('codex', 'Codex (ChatGPT)', st.codex.installed ? 'Adds Mixer to ~/.codex/config.toml — the Codex CLI, IDE extension and Codex app.' : 'Not found on this computer.', state(st.codex), `<button class="btn sm ${st.codex.current ? '' : 'primary'}" data-c="codex">${st.codex.added ? 'Update' : 'Add to Codex'}</button>`)}
        <details class="con-manual"><summary>Add by hand</summary><div class="code-line"><code>${esc(st.code.cmd)}</code><button class="icon-btn xs" data-copy="${esc(st.code.cmd)}">${icon('copy', 13)}</button></div><div class="code-line"><code>${esc(st.codex.cmd)}</code><button class="icon-btn xs" data-copy="${esc(st.codex.cmd)}">${icon('copy', 13)}</button></div></details></section>
      <section class="con-card"><div class="con-h"><b>Ask from inside Mixer</b></div>
        <div class="con-row"><div class="con-ic">${icon('sparkle', 18)}</div><div class="grow"><b>${a.claude ? 'Claude Code' : a.codex ? 'Codex' : 'Not available'}</b><div class="muted small">${a.claude || a.codex ? 'The “Ask Claude” box runs your own sign-in, headless, with only Mixer’s tools.' : 'Install Claude Code or Codex to ask from here. Claude Desktop with the plugin works without it.'}</div></div>${a.claude && a.codex ? `<select class="select sm" id="askProv"><option value="auto" ${S.settings.askProvider === 'auto' ? 'selected' : ''}>Claude Code first</option><option value="codex" ${S.settings.askProvider === 'codex' ? 'selected' : ''}>Codex</option></select>` : ''}</div></section>
      <section class="con-card"><div class="con-h"><b>What Claude can do here</b></div><div class="con-row" style="display:block;font-size:12.5px;color:var(--fg-2);line-height:1.6">Start songs and set tempo, key and sections · write drums from text patterns or 14 grooves · chord progressions by name or numeral with 20 rhythms and smooth voicing · melodies note by note · import a recording, detect its tempo and key, cut, fade, pitch, stretch and reverse it · copy, insert and delete bars · 12 effects incl. sidechain ducking · automation · measure everything and read a mix check · play it for you · export WAV/MP3 and stems, normalized.</div></section>`;
    hydrateIcons(view);
    $$('[data-c]', view).forEach((x) => x.onclick = async () => { x.disabled = true; try { await call('connectors:' + x.dataset.c); toast('Added', x.dataset.c === 'desktop' ? 'Restart Claude Desktop to load Mixer' : 'Start a new session to load Mixer'); render(); } catch (e) { fail(e); x.disabled = false; } });
    $$('[data-copy]', view).forEach((x) => x.onclick = () => { call('clipboard:write', x.dataset.copy); toast('Copied'); });
    const ap = $('#askProv'); if (ap) ap.onchange = async () => { S.settings = await call('settings:set', { askProvider: ap.value }); };
  },
};

// ───────── Settings
VIEWS.settings = {
  title: 'Settings',
  render(view) {
    const s = S.settings;
    view.innerHTML = `<div class="settings">
      <div class="set-row"><div class="grow"><b>Appearance</b></div><div class="seg" id="setTheme">${[['system', 'System'], ['dark', 'Dark'], ['light', 'Light']].map(([k, l]) => `<button data-t="${k}" class="${s.theme === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="set-row"><div class="grow"><b>Songs folder</b><div class="muted small">${esc(tildify(S.info.songsRoot))}</div></div><button class="btn sm" id="setOpen">Show</button><button class="btn sm" id="setDir">Change…</button></div>
      <div class="set-row"><div class="grow"><b>Export</b><div class="muted small">Defaults for the Export sheet and for Claude</div></div><select class="select sm" id="setFmt"><option value="wav" ${s.exportFormat === 'wav' ? 'selected' : ''}>WAV</option><option value="mp3" ${s.exportFormat === 'mp3' ? 'selected' : ''}>MP3</option></select><select class="select sm" id="setBits"><option value="16" ${s.exportBits == 16 ? 'selected' : ''}>16-bit</option><option value="24" ${s.exportBits == 24 ? 'selected' : ''}>24-bit</option><option value="32" ${s.exportBits == 32 ? 'selected' : ''}>32-bit float</option></select><select class="select sm" id="setRate"><option value="44100" ${s.exportRate == 44100 ? 'selected' : ''}>44.1 kHz</option><option value="48000" ${s.exportRate == 48000 ? 'selected' : ''}>48 kHz</option></select></div>
      <div class="set-row"><div class="grow"><b>Loudness target</b><div class="muted small">Used by Check mix and “normalize” on export</div></div><select class="select sm" id="setLufs">${[[-16, '−16 LUFS (Apple Music, gentle)'], [-14, '−14 LUFS (Spotify, YouTube)'], [-11, '−11 LUFS (loud pop)'], [-9, '−9 LUFS (club, EDM)']].map(([v, l]) => `<option value="${v}" ${+s.normalize === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="set-row"><div class="grow"><b>Follow the playhead</b><div class="muted small">Scroll the timeline while playing</div></div><button class="switch ${S.follow !== false ? 'on' : ''}" id="setFollow"></button></div>
      <div class="set-foot muted small">Mixer ${esc(S.info.version)} · data in ${esc(tildify(S.info.userData))}</div></div>`;
    $$('#setTheme [data-t]').forEach((b) => b.onclick = async () => { S.settings = await call('settings:set', { theme: b.dataset.t }); applyThemeNow(); render(); });
    $('#setOpen').onclick = () => openPath(S.info.songsRoot);
    $('#setDir').onclick = async () => { const d = await call('dialog:folder'); if (!d) return; S.settings = await call('settings:set', { songsDir: d }); S.info = await call('app:info'); await reloadSong(); render(); };
    $('#setFmt').onchange = async (e) => { S.settings = await call('settings:set', { exportFormat: e.target.value }); };
    $('#setBits').onchange = async (e) => { S.settings = await call('settings:set', { exportBits: +e.target.value }); };
    $('#setRate').onchange = async (e) => { S.settings = await call('settings:set', { exportRate: +e.target.value }); };
    $('#setLufs').onchange = async (e) => { S.settings = await call('settings:set', { normalize: +e.target.value }); };
    $('#setFollow').onclick = (e) => { S.follow = S.follow === false; e.currentTarget.classList.toggle('on', S.follow !== false); };
  },
};

// ───────── Export
function exportSheet() {
  const s = S.settings; const song = S.song;
  const el = openSheet(`<div class="sheet-head">${icon('export', 20)}<div class="grow"><h3>Export</h3><div class="muted small">${esc(song.name)} · ${fmtTime(SG.songEnd(song) * SG.spb(song)).replace(/\.\d$/, '')}</div></div></div>
    <div class="sheet-body"><div class="opt-grid">
      <label>Format</label><div class="seg" id="exFmt"><button data-f="wav" class="${s.exportFormat !== 'mp3' ? 'on' : ''}">WAV</button><button data-f="mp3" class="${s.exportFormat === 'mp3' ? 'on' : ''}">MP3</button></div>
      <label>Quality</label><div class="row"><select class="select sm" id="exBits"><option value="16" ${s.exportBits == 16 ? 'selected' : ''}>16-bit</option><option value="24" ${s.exportBits == 24 ? 'selected' : ''}>24-bit</option><option value="32" ${s.exportBits == 32 ? 'selected' : ''}>32-bit float</option></select><select class="select sm" id="exKbps"><option value="320">320 kbps</option><option value="256">256 kbps</option><option value="192">192 kbps</option><option value="128">128 kbps</option></select><select class="select sm" id="exRate"><option value="44100" ${s.exportRate == 44100 ? 'selected' : ''}>44.1 kHz</option><option value="48000" ${s.exportRate == 48000 ? 'selected' : ''}>48 kHz</option></select></div>
      <label>Loudness</label><select class="select sm" id="exNorm"><option value="">Keep the mix as it is</option>${[-16, -14, -11, -9].map((v) => `<option value="${v}" ${+s.normalize === v ? 'selected' : ''}>Normalize to ${v} LUFS</option>`).join('')}</select>
      <label>Range</label><select class="select sm" id="exRange"><option value="all">The whole song</option>${song.loop.on ? `<option value="loop">The loop (bars ${SG.beatToBar(song, song.loop.start)}–${SG.beatToBar(song, song.loop.end) - 1})</option>` : ''}</select>
      <label>Stems</label><label class="chk"><input type="checkbox" id="exStems">Also export each track as its own file</label>
      <label>Name</label><input class="input" id="exName" value="${esc(song.name)}">
    </div><div id="exOut"></div></div>
    <div class="sheet-foot"><button class="btn ghost sm" id="exWhere">${icon('folder', 14)}Choose folder…</button><span class="muted small grow ellip" id="exDest">Song’s exports folder</span><button class="btn" id="exCancel">Cancel</button><button class="btn primary" id="exGo">${icon('export', 15)}Export</button></div>`, { width: 600 });
  let fmt = s.exportFormat === 'mp3' ? 'mp3' : 'wav'; let folder = null;
  const sync = () => { $('#exBits').hidden = $('#exRate').hidden = fmt === 'mp3'; $('#exKbps').hidden = fmt !== 'mp3'; }; sync();
  $$('#exFmt [data-f]', el).forEach((b) => b.onclick = () => { fmt = b.dataset.f; $$('#exFmt button', el).forEach((x) => x.classList.toggle('on', x === b)); sync(); });
  $('#exCancel').onclick = closeSheet;
  $('#exWhere').onclick = async () => { const d = await call('dialog:folder'); if (d) { folder = d; $('#exDest').textContent = tildify(d); } };
  $('#exGo').onclick = async () => {
    const b = $('#exGo'); b.disabled = true; const out = $('#exOut'); out.innerHTML = `<div class="row muted"><span class="spin"></span><span id="exMsg">Rendering…</span></div>`;
    const off = D.on('engine:progress', (p) => { const m = $('#exMsg'); if (m) m.textContent = p.msg; });
    const range = $('#exRange').value === 'loop' ? { from_bar: SG.beatToBar(song, song.loop.start), bars: (song.loop.end - song.loop.start) / SG.bpb(song) } : {};
    try {
      await commitChain;
      const r = await call('export', { format: fmt, bits: +$('#exBits').value, kbps: +$('#exKbps').value, sample_rate: +$('#exRate').value, normalize_lufs: $('#exNorm').value ? +$('#exNorm').value : null, stems: $('#exStems').checked, name: $('#exName').value.trim() || song.name, folder, ...range });
      closeSheet(); const t = toast('Exported', `${r.files.map(baseName).join(', ')} · ${r.loudness_lufs} LUFS · peak ${r.peak_dbfs} dBFS`, 'ok', 9000); t.style.cursor = 'pointer'; t.title = 'Show in folder'; t.onclick = () => reveal(r.files[0]);
    } catch (e) { out.innerHTML = `<div class="cnote major">${icon('alert', 14)}<div>${esc(e.message)}</div></div>`; hydrateIcons(out); b.disabled = false; }
    finally { off(); }
  };
}
