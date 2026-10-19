/* Kiln — profiles: the picker, PIN unlock, and creating/editing profiles. */
(() => {
  const { $, $$, esc } = K;
  let screen = null;

  function closeScreen() { screen?.remove(); screen = null; }

  async function picker() {
    K.state.app = await kiln.app.state();
    closeScreen();
    const ps = K.state.app.profiles;
    screen = document.createElement('div');
    screen.className = 'screen';
    screen.innerHTML = `<div class="glow"></div>
      <h1>Who’s creating?</h1>
      <p class="sub">Each profile keeps its own models, images, prompts, settings and browser sign-ins.</p>
      <div class="profiles">
        ${ps.map(p => `<button class="pf" data-id="${p.id}">${K.avatar(p, 'xl')}<b>${esc(p.name)}</b><small>${p.hasPin ? ic('lock', 12) + ' PIN' : esc(p.libraryName || '')}</small></button>`).join('')}
        <button class="pf add" id="pfAdd"><span class="avatar xl">${ic('plus', 34)}</span><b>Add profile</b><small>&nbsp;</small></button>
      </div>
      <label class="row" style="margin-top:38px;position:relative;color:var(--mute)"><span class="switch"><input type="checkbox" id="askEach" ${K.state.app.askOnLaunch ? 'checked' : ''}><i></i></span> Ask which profile every time Kiln opens</label>`;
    document.body.appendChild(screen);
    $$('.pf[data-id]', screen).forEach(b => b.onclick = () => open(b.dataset.id));
    $('#pfAdd', screen).onclick = () => createDialog({ onCreated: (p) => open(p.id) });
    $('#askEach', screen).onchange = (e) => kiln.app.set({ askOnLaunch: e.target.checked });
    setTimeout(() => $('.pf', screen)?.focus(), 50);
  }

  async function open(id) {
    let p = K.state.app?.profiles.find(x => x.id === id);
    if (!p) { K.state.app = await kiln.app.state(); p = K.state.app.profiles.find(x => x.id === id); }
    if (!p) return;
    let pin = '';
    if (p.hasPin) { pin = await askPin(p); if (pin === null) return; }
    const r = await kiln.profiles.open(id, pin);
    if (!r.ok) { K.toast(r.error, 'error'); return open(id); }
    K.state.app = r.app;
    closeScreen();
    await K.enterProfile(r.state);
  }

  function askPin(p) {
    return new Promise((res) => {
      let done = false;
      K.modal({
        title: `Unlock ${p.name}`, subtitle: 'Enter this profile’s PIN.',
        body: `<div class="pin-box">${[0, 1, 2, 3].map(i => `<input inputmode="numeric" maxlength="1" data-i="${i}" ${i === 0 ? 'autofocus' : ''}>`).join('')}</div>`,
        actions: [],
        onClose: () => { if (!done) res(null); },
        onMount: (m, close) => {
          const ins = $$('input', m);
          ins.forEach((inp, i) => {
            inp.oninput = () => {
              inp.value = inp.value.replace(/\D/g, '').slice(-1);
              if (inp.value && i < 3) ins[i + 1].focus();
              const v = ins.map(x => x.value).join('');
              if (v.length === 4) { done = true; close(); res(v); }
            };
            inp.onkeydown = (e) => { if (e.key === 'Backspace' && !inp.value && i > 0) ins[i - 1].focus(); };
          });
        }
      });
    });
  }

  function lock() { kiln.profiles.lock().then(() => picker()); }

  // Create or edit a profile
  async function createDialog({ edit = null, onCreated } = {}) {
    const app = K.state.app = await kiln.app.state();
    const colors = app.colors;
    const d = { name: edit?.name || '', color: edit?.color || colors[app.profiles.length % colors.length], avatar: edit?.avatar || '', pin: '', library: edit ? 'keep' : (app.libraries.length ? 'new' : 'new') };
    const libChoices = app.libraries.map(l => ({ v: 'share:' + l.id, b: `Share “${l.name}”`, s: l.profiles.length ? `Used by ${l.profiles.join(', ')}. Same models, no extra disk space.` : l.path }));
    K.modal({
      title: edit ? 'Edit profile' : 'New profile',
      subtitle: edit ? '' : 'Profiles keep their images, prompts, settings and sign-ins apart.',
      body: `
        <div class="row" style="gap:16px;align-items:flex-start">
          <div id="pvAv">${K.avatar(d, 'xl')}</div>
          <div style="flex:1">
            <label class="field"><span>Name</span><input class="input" id="pfName" value="${esc(d.name)}" placeholder="e.g. Bilal, Client work, Experiments" maxlength="40" autofocus></label>
            <div class="field"><span>Color</span><div class="colors">${colors.map(c => `<button data-c="${c}" style="--c:${c}" class="${c === d.color ? 'on' : ''}" title="${c}"></button>`).join('')}</div></div>
          </div>
        </div>
        ${edit ? '' : `<div class="field"><span>Models</span>
          <button class="choice on" data-lib="new"><span class="radio"></span><div><b>Start with its own empty library</b><small>Models this profile downloads stay separate.</small></div></button>
          ${libChoices.map(c => `<button class="choice" data-lib="${c.v}"><span class="radio"></span><div><b>${esc(c.b)}</b><small>${esc(c.s)}</small></div></button>`).join('')}
        </div>`}
        <label class="field"><span>PIN (optional)</span><input class="input" id="pfPin" inputmode="numeric" maxlength="4" placeholder="${edit?.hasPin ? 'Leave empty to keep the current PIN' : '4 digits to lock this profile'}"><small>A PIN stops others on this computer from opening the profile in Kiln. It doesn’t encrypt files.</small></label>
        ${edit?.hasPin ? `<label class="row small muted"><span class="switch"><input type="checkbox" id="pfNoPin"><i></i></span> Remove the PIN</label>` : ''}`,
      actions: [{ label: 'Cancel' }, { label: edit ? 'Save' : 'Create profile', kind: 'primary', onClick: async (m) => {
        d.name = $('#pfName', m).value.trim();
        if (!d.name) { K.toast('Give the profile a name', 'error'); return false; }
        const pin = $('#pfPin', m).value.trim();
        if (pin && !/^\d{4}$/.test(pin)) { K.toast('The PIN needs 4 digits', 'error'); return false; }
        if (edit) {
          const patch = { name: d.name, color: d.color };
          if (pin) patch.pin = pin;
          if ($('#pfNoPin', m)?.checked) patch.pin = '';
          K.state.app = await kiln.profiles.update(edit.id, patch);
          const me = K.state.app.profiles.find(x => x.id === edit.id);
          if (K.state.profile?.id === edit.id && me) { K.state.profile = me; K.$('#profileBtn').innerHTML = `${K.avatar(me, 'sm')}<span>${esc(me.name)}</span>${ic('chevronDown', 14)}`; }
          K.toast('Profile saved', 'ok');
          onCreated?.(me);
        } else {
          const p = await kiln.profiles.create({ name: d.name, color: d.color, pin: pin || null, library: d.library });
          K.toast(`Created ${p.name}`, 'ok');
          onCreated?.(p);
        }
      } }],
      onMount: (m) => {
        const refresh = () => { $('#pvAv', m).innerHTML = K.avatar({ ...d, name: $('#pfName', m).value || '?' }, 'xl'); };
        $('#pfName', m).oninput = refresh;
        $$('[data-c]', m).forEach(b => b.onclick = () => { d.color = b.dataset.c; $$('[data-c]', m).forEach(x => x.classList.toggle('on', x === b)); refresh(); });
        $$('[data-lib]', m).forEach(b => b.onclick = () => { d.library = b.dataset.lib; $$('[data-lib]', m).forEach(x => x.classList.toggle('on', x === b)); });
      }
    });
  }

  window.Profiles = { picker, open, lock, createDialog, closeScreen };
})();
