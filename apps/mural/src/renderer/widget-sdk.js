// Mural widget SDK — include it in a widget page:  <script src="mural://app/widget-sdk.js"></script>
// Then:  mural.ready().then(() => { mural.settings … });  mural.on('settings', fn);  await mural.storage.set('k', v);
//
//   mural.settings            this widget's settings (from widget.json "settings", edited in Mural)
//   mural.style               { glass: 'dark'|'light'|'solid'|'clear', opacity }  — <html data-tone="dark|light"> follows it
//   mural.size                { w, h } in points;  mural.resize(w, h) asks for a new size
//   mural.sky                 { phases: {night,dawn,day,dusk}, daylight } — updated every minute (event 'sky')
//   mural.storage.get(key?) / .set(key, value)   saved per widget on this computer (2 MB)
//   mural.saveSettings(patch)  change your own settings (e.g. after the user edits a title in place)
//   mural.system()            CPU %, memory, battery, uptime          (permission "system")
//   mural.open(urlOrPathOrApp)                                         (permission "open")
//   mural.suite(app, call, ...args)  Utility Suite apps, e.g. ('scene','list')  (permission "suite:<app>")
//   mural.location()          the place set in Mural, for weather    (permission "location")
//   mural.openSettings()      open this widget's settings in Mural
//   events: 'settings', 'style', 'resize', 'sky', 'pause', 'resume'  — stop timers on pause, it saves power
(() => {
  const pending = new Map(); const listeners = {}; let seq = 0, readyFn; const readyP = new Promise((r) => (readyFn = r));
  const emit = (ev, d) => (listeners[ev] || []).slice().forEach((fn) => { try { fn(d); } catch (e) { console.error(e); } });
  const tone = (st) => { const g = (st && st.glass) || 'dark'; document.documentElement.dataset.tone = g === 'light' ? 'light' : 'dark'; document.documentElement.dataset.glass = g; };
  const api = {
    id: null, settings: {}, style: { glass: 'dark' }, size: { w: 0, h: 0 }, sky: null, permissions: [], paused: false,
    ready: () => readyP,
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return () => api.off(ev, fn); },
    off(ev, fn) { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
    call(name, ...args) {
      return new Promise((resolve, reject) => {
        const id = ++seq; pending.set(id, { resolve, reject });
        parent.postMessage({ mw: 1, id, call: name, args }, '*');
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(name + ' timed out')); } }, 15000);
      });
    },
    storage: { get: (k) => api.call('storage.get', k), set: (k, v) => api.call('storage.set', k, v) },
    saveSettings: (p) => api.call('settings.set', p).then((s) => { api.settings = s; return s; }),
    system: () => api.call('system'), open: (t) => api.call('open', t), location: () => api.call('location'),
    suite: (app, name, ...args) => api.call('suite', app, name, args),
    resize: (w, h) => api.call('resize', w, h).then((s) => { api.size = s; return s; }),
    openSettings: () => api.call('openSettings')
  };
  addEventListener('message', (e) => {
    if (e.source !== parent) return; const m = e.data; if (!m || m.mw !== 1) return;
    if (m.re) { const p = pending.get(m.re); if (p) { pending.delete(m.re); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error)); } return; }
    switch (m.ev) {
      case 'init': Object.assign(api, m.data); tone(api.style); readyFn(api); emit('ready', api); break;
      case 'settings': api.settings = m.data; emit('settings', m.data); break;
      case 'style': api.style = m.data; tone(m.data); emit('style', m.data); break;
      case 'resize': api.size = m.data; emit('resize', m.data); break;
      case 'sky': api.sky = m.data; emit('sky', m.data); break;
      case 'pause': api.paused = true; emit('pause'); break;
      case 'resume': api.paused = false; emit('resume'); break;
    }
  });
  tone(api.style);
  window.mural = api;
})();
