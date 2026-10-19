/* Kiln — first run: pick where Kiln keeps its files and create the first profile. */
(() => {
  const { $, esc } = K;
  let el = null;
  const st = { dataRoot: '', name: '', color: '' };

  function start() {
    const app = K.state.app;
    st.dataRoot = app.dataRoot;
    st.color = app.colors[0];
    el = document.createElement('div');
    el.className = 'screen';
    document.body.appendChild(el);
    el.innerHTML = `<div class="glow"></div><div class="onb">
      <h1>Welcome to Kiln</h1>
      <p class="sub" style="margin-left:auto;margin-right:auto">Kiln installs and runs Stable Diffusion apps, keeps your models organized, and lets you create without leaving the window.</p>
      <div class="panel onb-card">
        <label class="field"><span>Your name</span><input class="input" id="onbName" placeholder="e.g. Bilal" maxlength="40"><small>This becomes your first profile. You can add more later.</small></label>
        <div class="field"><span>Kiln folder</span>
          <div class="row"><input class="input mono" id="onbRoot" value="${esc(st.dataRoot)}" readonly><button class="btn" id="onbPick">${ic('folder', 15)} Change</button></div>
          <small>Packages, profiles and models go here. Models are large, so pick a drive with room to spare.</small>
        </div>
        <div class="onb-foot"><span></span><button class="btn primary lg" id="onbGo">${ic('arrowRight', 16)} Get started</button></div>
      </div></div>`;
    $('#onbPick', el).onclick = async () => { const d = await kiln.app.chooseFolder({ title: 'Choose where Kiln keeps its files', defaultPath: st.dataRoot }); if (d) { st.dataRoot = d; $('#onbRoot', el).value = d; } };
    $('#onbGo', el).onclick = go;
    $('#onbName', el).onkeydown = (e) => { if (e.key === 'Enter') go(); };
    setTimeout(() => $('#onbName', el)?.focus(), 30);
  }

  async function go() {
    const name = $('#onbName', el).value.trim();
    if (!name) return K.toast('Add your name to create your profile', 'error');
    try {
      await kiln.app.completeSetup({ dataRoot: st.dataRoot });
      const p = await kiln.profiles.create({ name, color: st.color, library: 'new' });
      el.remove(); el = null;
      K.state.app = await kiln.app.state();
      await kiln.app.set({ askOnLaunch: false });
      await window.Profiles.open(p.id);
    } catch (e) { K.fail(e); }
  }

  window.Onboarding = { start };
})();
