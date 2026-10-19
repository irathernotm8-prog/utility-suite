/* Relay Player — opt-in media player with casting, AirPlay hand-off and download */
(() => {
  const R = () => window.RelayApp;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => R().esc(s);
  const p = { root: null, queue: [], index: 0, casting: null, hideT: null, speed: 1 };

  const isRemote = (src) => /^https?:/i.test(src || '');
  const toUrl = (src) => isRemote(src) || /^(blob|data|file):/.test(src) ? src : 'file://' + encodeURI(src).replace(/#/g, '%23').replace(/\?/g, '%3F');
  const isAudio = (item) => item.kind === 'audio' || /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus)(\?|$)/i.test(item.src);
  const isHls = (item) => item.kind === 'hls' || /\.m3u8(\?|#|$)/i.test(item.src || '');
  const YT = /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/)/i;
  function ytWatchUrl(u) {
    try {
      const url = new URL(u);
      let id = url.searchParams.get('v');
      if (!id && /youtu\.be$/.test(url.hostname)) id = url.pathname.slice(1);
      if (!id) { const m = url.pathname.match(/\/(shorts|live)\/([\w-]+)/); if (m) id = m[2]; }
      const t = url.searchParams.get('t');
      return id ? `https://www.youtube.com/watch?v=${id}${t ? '&t=' + t : ''}` : u;
    } catch { return u; }
  }
  // Cinema view: show just the video player from the page, filling Relay Player
  const CINEMA_CSS = `
    ytd-masthead, #masthead-container, #secondary, #below, #comments, ytd-watch-metadata, #related, tp-yt-app-drawer,
    ytd-mini-guide-renderer, #guide, ytd-popup-container, .ytp-paid-content-overlay { display: none !important; }
    html, body, ytd-app, #page-manager, ytd-watch-flexy { background: #000 !important; overflow: hidden !important; }
    #page-manager { margin-top: 0 !important; }
    #full-bleed-container, #player-full-bleed-container, ytd-watch-flexy[theater] #player-wide-container {
      height: 100vh !important; max-height: 100vh !important; min-height: 100vh !important; }
    #columns { display: none !important; }`;
  const fmt = (t) => { if (!isFinite(t)) return '0:00'; t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };

  function open(items, startIndex = 0) {
    p.queue = (Array.isArray(items) ? items : [items]).map(x => ({ title: x.title || (x.src || '').split(/[\\/]/).pop(), ...x }));
    p.index = startIndex;
    if (!p.root) build();
    p.root.hidden = false;
    document.body.classList.add('overlay-open');
    load();
  }

  function build() {
    p.root = document.createElement('div');
    p.root.className = 'player';
    p.root.innerHTML = `
      <div class="pl-top">
        <div class="pl-title"><span class="pl-badge">${ic('play', 11)} Relay Player</span><b id="plTitle"></b><small id="plSub"></small></div>
        <div class="pl-top-actions">
          <button class="icon-btn" id="plToBrowser" title="Open the page in a Browser tab" hidden>${ic('globe', 17)}</button>
          <button class="icon-btn" id="plOpen" title="Open a file…">${ic('folder', 17)}</button>
          <button class="icon-btn" id="plQueueBtn" title="Up next">${ic('list', 17)}</button>
          <button class="icon-btn" id="plClose" title="Close (Esc)">${ic('x', 18)}</button>
        </div>
      </div>
      <div class="pl-stage" id="plStage">
        <video id="plVideo" playsinline></video>
        <div class="pl-web" id="plWeb" hidden></div>
        <div class="pl-audio" id="plAudio" hidden><div class="pl-art">${ic('music', 54)}</div><div class="pl-art-t" id="plArtT"></div></div>
        <div class="pl-cast" id="plCastInfo" hidden></div>
        <div class="pl-err" id="plErr" hidden></div>
        <aside class="pl-queue" id="plQueue" hidden></aside>
      </div>
      <div class="pl-controls" id="plControls">
        <div class="pl-seek"><span id="plCur">0:00</span><div class="pl-bar" id="plBar"><i class="buf" id="plBuf"></i><i class="fill" id="plFill"></i><b class="knob" id="plKnob"></b></div><span id="plDur">0:00</span></div>
        <div class="pl-row">
          <div class="pl-left">
            <button class="icon-btn" id="plPrev" title="Previous">${ic('chevronLeft', 18)}</button>
            <button class="icon-btn" id="plBack" title="Back 10 seconds (←)">${ic('back10', 20)}</button>
            <button class="pl-play" id="plPlay" title="Play / pause (space)">${ic('play', 20)}</button>
            <button class="icon-btn" id="plFwd" title="Forward 10 seconds (→)">${ic('fwd10', 20)}</button>
            <button class="icon-btn" id="plNext" title="Next">${ic('chevronRight', 18)}</button>
            <div class="pl-vol"><button class="icon-btn" id="plMute" title="Mute (M)">${ic('volume', 18)}</button><input type="range" id="plVolume" min="0" max="1" step="0.01" value="1"></div>
          </div>
          <div class="pl-right">
            <button class="pl-chip" id="plSpeed" title="Playback speed">1×</button>
            <button class="icon-btn" id="plDl" title="Download to Relay downloads">${ic('download', 18)}</button>
            <button class="icon-btn" id="plAirplay" title="AirPlay">${ic('airplay', 18)}</button>
            <button class="icon-btn" id="plCast" title="Cast to a TV or speaker">${ic('cast', 18)}</button>
            <button class="icon-btn" id="plPip" title="Picture in picture">${ic('pip', 18)}</button>
            <button class="icon-btn" id="plFull" title="Full screen (F)">${ic('fullscreen', 18)}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(p.root);
    const v = $('#plVideo', p.root);
    p.v = v;
    v.addEventListener('play', sync); v.addEventListener('pause', sync); v.addEventListener('volumechange', sync);
    v.addEventListener('timeupdate', progress); v.addEventListener('progress', progress); v.addEventListener('loadedmetadata', progress);
    v.addEventListener('ended', () => { saveProg(true); if (p.index < p.queue.length - 1) { p.index++; load(); } });
    v.addEventListener('timeupdate', () => saveProg(false));
    v.addEventListener('pause', () => saveProg(true));
    v.addEventListener('error', () => showError(v.error?.code === 4 ? 'This format can’t be played here. Try “Open with default app” from Downloads, or AirPlay it via QuickTime.' : 'Couldn’t load this media.'));
    v.addEventListener('click', toggle);
    v.addEventListener('dblclick', fullscreen);

    $('#plClose', p.root).onclick = close;
    $('#plToBrowser', p.root).onclick = () => { const it = cur(); const u = p.webView?.getURL() || it.src; close(); window.Browser?.openTab(u); };
    $('#plPlay', p.root).onclick = toggle;
    $('#plBack', p.root).onclick = () => seekBy(-10);
    $('#plFwd', p.root).onclick = () => seekBy(10);
    $('#plPrev', p.root).onclick = () => { if (v.currentTime > 3 || p.index === 0) v.currentTime = 0; else { p.index--; load(); } };
    $('#plNext', p.root).onclick = () => { if (p.index < p.queue.length - 1) { p.index++; load(); } };
    $('#plMute', p.root).onclick = () => { v.muted = !v.muted; };
    $('#plVolume', p.root).oninput = (e) => { v.volume = +e.target.value; v.muted = v.volume === 0; };
    $('#plSpeed', p.root).onclick = speedMenu;
    $('#plPip', p.root).onclick = async () => { try { document.pictureInPictureElement ? await document.exitPictureInPicture() : await v.requestPictureInPicture(); } catch { R().toast('Picture in picture isn’t available for this file'); } };
    $('#plFull', p.root).onclick = fullscreen;
    $('#plDl', p.root).onclick = download;
    $('#plAirplay', p.root).onclick = airplayMenu;
    $('#plCast', p.root).onclick = castMenu;
    $('#plQueueBtn', p.root).onclick = () => { const q = $('#plQueue', p.root); q.hidden = !q.hidden; renderQueue(); };
    $('#plOpen', p.root).onclick = async () => { const files = await relay.media.pick('player'); if (files.length) open(files.map(f => ({ src: f })), 0); };

    // seek bar
    const bar = $('#plBar', p.root);
    const seekTo = (e) => { const r = bar.getBoundingClientRect(); const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); const t = f * (v.duration || 0); if (p.casting) relay.media.castControl('seek', t); else v.currentTime = t; };
    bar.onmousedown = (e) => { seekTo(e); const mv = (ev) => seekTo(ev); const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }; document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); };

    // auto-hide controls while playing video
    p.root.addEventListener('mousemove', () => { p.root.classList.remove('idle'); clearTimeout(p.hideT); p.hideT = setTimeout(() => { if (!v.paused && !isAudio(cur())) p.root.classList.add('idle'); }, 2500); });
    document.addEventListener('keydown', keys, true);
    relay.media.onCastStatus((s) => {
      if (!p.casting) return;
      if (s.state === 'error') { R().toast('Casting stopped: ' + s.message, 'error'); stopCast(); return; }
      p.casting.state = s.state; if (s.currentTime != null) p.casting.time = s.currentTime;
      updateCastInfo();
    });
  }

  const cur = () => p.queue[p.index] || {};
  const isLocal = (item) => item && item.src && !isRemote(item.src) && !/^(blob|data):/.test(item.src) && !item.web;
  // remember where you were in local videos & music so the Library can resume them
  function saveProg(force) {
    const item = cur(), v = p.v;
    if (!isLocal(item) || !v || !isFinite(v.duration) || !v.duration || p.loading) return;
    const now = Date.now();
    if (!force && now - (p.lastSave || 0) < 5000) return;
    p.lastSave = now;
    relay.media.saveProgress({ file: item.src.replace(/^file:\/\//, ''), pos: v.ended ? v.duration : v.currentTime, dur: v.duration }).catch(() => {});
  }

  async function load() {
    const item = cur();
    const v = p.v;
    hideError();
    if (p.hls) { try { p.hls.destroy(); } catch {} p.hls = null; }
    const web = !!item.web;
    p.root.classList.toggle('web-mode', web);
    $('#plToBrowser', p.root).hidden = !web;
    $('#plWeb', p.root).hidden = !web;
    v.hidden = web;
    if (web) { v.pause(); v.removeAttribute('src'); return loadWeb(item); }
    if (p.webView) { p.webView.remove(); p.webView = null; }
    // streams found on a web page need that site's sign-in cookies and referrer
    await relay.media.prepare(isRemote(item.src) && (item.partition || item.referer) ? { partition: item.partition, referer: item.referer } : null);
    $('#plTitle', p.root).textContent = item.title || 'Untitled';
    $('#plSub', p.root).textContent = p.queue.length > 1 ? `${p.index + 1} of ${p.queue.length}` : isRemote(item.src) ? new URL(item.src).hostname : '';
    const audio = isAudio(item);
    $('#plAudio', p.root).hidden = !audio;
    $('#plArtT', p.root).textContent = item.title || '';
    v.classList.toggle('audio-only', audio);
    $('#plPip', p.root).hidden = audio;
    $('#plDl', p.root).hidden = !isRemote(item.src) || isHls(item);
    if (isHls(item) && !v.canPlayType('application/vnd.apple.mpegurl')) {
      if (!window.Hls || !window.Hls.isSupported()) { showError('This stream format isn’t supported here.'); return; }
      p.hls = new window.Hls({ enableWorker: true });
      p.hls.on(window.Hls.Events.ERROR, (_e, d) => { if (d.fatal) showError('The stream stopped — the site may only allow it to play on its own page. Try “Pop out” in the Browser instead.'); });
      p.hls.loadSource(item.src);
      p.hls.attachMedia(v);
    } else {
      p.loading = true;
      v.src = toUrl(item.src);
      if (isLocal(item)) {
        const pr = await relay.media.getProgress(item.src).catch(() => null);
        if (pr && !pr.done && pr.pos > 10 && cur() === item) {
          const go = () => { v.currentTime = pr.pos; };
          if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go, { once: true });
          R().toast(`Resuming at ${fmt(pr.pos)}`, '', { label: 'Start over', onClick: () => { v.currentTime = 0; v.play().catch(() => {}); } });
        }
      }
      p.loading = false;
    }
    const art = $('.pl-art', p.root);
    if (art) art.innerHTML = audio && item.art ? `<img src="${esc(item.art)}" alt="">` : ic('music', 54);
    $('#plArtT', p.root).textContent = [item.title, item.sub].filter(Boolean).join(' — ');
    v.playbackRate = p.speed;
    v.play().catch(() => {});
    renderQueue();
    sync();
  }

  function sync() {
    if (!p.root) return;
    const v = p.v;
    const playing = p.casting ? p.casting.state === 'playing' : !v.paused;
    $('#plPlay', p.root).innerHTML = ic(playing ? 'pause' : 'play', 20);
    $('#plMute', p.root).innerHTML = ic(v.muted || v.volume === 0 ? 'mute' : 'volume', 18);
    $('#plVolume', p.root).value = v.muted ? 0 : v.volume;
    $('#plPrev', p.root).hidden = $('#plNext', p.root).hidden = p.queue.length < 2;
    $('#plCast', p.root).classList.toggle('on', !!p.casting);
  }
  function progress() {
    const v = p.v;
    const t = p.casting?.time ?? v.currentTime, d = v.duration || 0;
    const f = d ? t / d * 100 : 0;
    $('#plFill', p.root).style.width = f + '%';
    $('#plKnob', p.root).style.left = f + '%';
    try { $('#plBuf', p.root).style.width = (d && v.buffered.length ? v.buffered.end(v.buffered.length - 1) / d * 100 : 0) + '%'; } catch {}
    $('#plCur', p.root).textContent = fmt(t);
    $('#plDur', p.root).textContent = fmt(d);
  }
  function toggle() {
    if (p.casting) { relay.media.castControl(p.casting.state === 'playing' ? 'pause' : 'play'); return; }
    p.v.paused ? p.v.play() : p.v.pause();
  }
  function seekBy(s) {
    if (p.casting) { relay.media.castControl('seek', Math.max(0, (p.casting.time || 0) + s)); return; }
    p.v.currentTime = Math.max(0, Math.min((p.v.duration || 0), p.v.currentTime + s));
  }
  function fullscreen() { document.fullscreenElement ? document.exitFullscreen() : p.root.requestFullscreen().catch(() => {}); }
  function showError(m) { const e = $('#plErr', p.root); e.hidden = false; e.innerHTML = `${ic('alert', 26)}<p>${esc(m)}</p>`; }
  function hideError() { const e = $('#plErr', p.root); if (e) e.hidden = true; }

  function speedMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    R().popMenu(r.left, r.top - 260, [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(s => ({ label: `${s}×${s === p.speed ? '  ✓' : ''}`, onClick: () => { p.speed = s; p.v.playbackRate = s; $('#plSpeed', p.root).textContent = s + '×'; } })));
  }

  function renderQueue() {
    const q = $('#plQueue', p.root);
    if (!q || q.hidden) return;
    q.innerHTML = `<div class="plq-head">Up next <button class="icon-btn sm" id="plqAdd" title="Add files">${ic('plus', 15)}</button></div>` + p.queue.map((it, i) => `
      <button class="plq-item ${i === p.index ? 'active' : ''}" data-i="${i}">${ic(isAudio(it) ? 'music' : 'film', 14)}<span>${esc(it.title)}</span></button>`).join('');
    $$('.plq-item', q).forEach(b => b.onclick = () => { p.index = +b.dataset.i; load(); });
    $('#plqAdd', q).onclick = async () => { const files = await relay.media.pick('player'); files.forEach(f => p.queue.push({ src: f, title: f.split('/').pop() })); renderQueue(); sync(); };
  }

  /* ---------- download ---------- */
  async function download() {
    const it = cur();
    if (!isRemote(it.src)) return;
    await relay.downloads.start(it.src, it.partition);
    R().toast('Downloading to your Relay downloads folder');
  }

  /* ---------- AirPlay ---------- */
  function airplayMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const it = cur();
    R().popMenu(r.right - 300, r.top - 210, [
      { html: `<div class="cast-pop-h">${ic('airplay', 16)} <b>AirPlay</b><small>Mac apps built on Chrome’s engine can’t show the AirPlay picker, so Relay hands off to QuickTime Player, which can.</small></div>` },
      { label: isRemote(it.src) ? 'Download, then play via QuickTime' : 'Play in QuickTime (then click AirPlay)', icon: 'airplay', onClick: async () => {
          if (isRemote(it.src)) { await download(); R().toast('When the download finishes, open it from Downloads → ⋯ → Open with default app'); return; }
          p.v.pause();
          const res = await relay.media.airplay(it.src);
          R().toast(res.ok ? 'Opened in QuickTime — click the AirPlay icon in its controls' : res.reason, res.ok ? '' : 'error');
        } },
      { label: 'Send all sound to AirPlay speakers…', icon: 'volume', onClick: () => relay.media.soundOutput() }
    ]);
  }

  /* ---------- Chromecast ---------- */
  async function castMenu(e) {
    const btn = e.currentTarget;
    const r = btn.getBoundingClientRect();
    if (p.casting) {
      R().popMenu(r.right - 260, r.top - 120, [
        { html: `<div class="cast-pop-h">${ic('cast', 16)} <b>Casting to ${esc(p.casting.device)}</b></div>` },
        { label: 'Stop casting', icon: 'x', danger: true, onClick: stopCast }
      ]);
      return;
    }
    const close = R().popMenu(r.right - 280, r.top - 120, [{ html: `<div class="cast-pop-h">${ic('cast', 16)} <b>Looking for TVs & speakers…</b><small>Chromecast, Google TV and Nest devices on your Wi-Fi</small></div>` }]);
    let devices = [];
    try { devices = await relay.media.castDiscover(); } catch {}
    close();
    R().popMenu(r.right - 280, r.top - (devices.length * 36 + 110), [
      { html: `<div class="cast-pop-h">${ic('cast', 16)} <b>${devices.length ? 'Cast to' : 'No cast devices found'}</b><small>${devices.length ? 'Your Mac streams the file to the TV over Wi-Fi' : 'Make sure the TV is on and on the same Wi-Fi. If macOS asks, allow Relay to find devices on your local network.'}</small></div>` },
      ...devices.map(dv => ({ label: dv.name, icon: 'cast', onClick: () => startCast(dv) })),
      { label: 'Search again', icon: 'refresh', onClick: () => btn.click() }
    ]);
  }
  async function startCast(dv) {
    const it = cur();
    try {
      R().toast(`Connecting to ${dv.name}…`);
      await relay.media.castPlay({ deviceId: dv.id, src: it.src, title: it.title, currentTime: p.v.currentTime || 0 });
      p.casting = { device: dv.name, state: 'playing', time: p.v.currentTime };
      p.v.pause();
      updateCastInfo(); sync();
    } catch (e) { R().toast('Couldn’t cast: ' + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error'); }
  }
  function stopCast() {
    relay.media.castControl('stop');
    if (p.casting?.time) p.v.currentTime = p.casting.time;
    p.casting = null;
    updateCastInfo(); sync();
  }
  function updateCastInfo() {
    const box = $('#plCastInfo', p.root);
    box.hidden = !p.casting;
    if (p.casting) box.innerHTML = `${ic('cast', 34)}<b>Playing on ${esc(p.casting.device)}</b><small>${esc(p.casting.state || '')}</small>`;
    progress();
  }

  function keys(e) {
    if (!p.root || p.root.hidden) return;
    if (e.target.closest?.('input, textarea')) return;
    if (cur().web && e.key !== 'Escape') return;
    const k = e.key;
    const handled = { ' ': toggle, k: toggle, ArrowLeft: () => seekBy(-10), ArrowRight: () => seekBy(10), j: () => seekBy(-10), l: () => seekBy(10),
      f: fullscreen, m: () => { p.v.muted = !p.v.muted; }, ArrowUp: () => { p.v.volume = Math.min(1, p.v.volume + 0.1); }, ArrowDown: () => { p.v.volume = Math.max(0, p.v.volume - 0.1); },
      Escape: () => { if (document.fullscreenElement) document.exitFullscreen(); else close(); } }[k];
    if (handled) { e.preventDefault(); e.stopPropagation(); handled(); }
  }

  async function loadWeb(item) {
    $('#plTitle', p.root).textContent = item.title || 'Video';
    $('#plSub', p.root).textContent = 'Cinema view';
    const host = $('#plWeb', p.root);
    if (p.webView) p.webView.remove();
    await relay.media.prepare({ web: true });
    const { preload } = await relay.prepareSession('persist:relay-browser', 'auto');
    const wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:relay-browser');
    wv.setAttribute('preload', preload);
    wv.setAttribute('webpreferences', 'sandbox=yes');
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('src', YT.test(item.src) ? ytWatchUrl(item.src) : item.src);
    host.appendChild(wv);
    p.webView = wv;
    const tidy = () => {
      wv.insertCSS(CINEMA_CSS).catch(() => {});
      wv.executeJavaScript(`setTimeout(() => window.dispatchEvent(new Event('resize')), 300); setTimeout(() => window.dispatchEvent(new Event('resize')), 1500);`).catch(() => {});
    };
    wv.addEventListener('dom-ready', tidy);
    wv.addEventListener('did-navigate-in-page', tidy);
    wv.addEventListener('page-title-updated', (e) => { $('#plTitle', p.root).textContent = e.title.replace(/ - YouTube$/, ''); });
  }

  function close() {
    if (!p.root) return;
    if (p.casting) stopCast();
    const v = p.v;
    saveProg(true);
    v.pause();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    // hide first so closing feels instant, then release the video/stream/web page in the background
    p.root.hidden = true;
    p.root.classList.remove('web-mode', 'idle');
    document.body.classList.remove('overlay-open');
    clearTimeout(p.hideT);
    const hls = p.hls, wv = p.webView;
    p.hls = null; p.webView = null;
    setTimeout(() => {
      if (hls) { try { hls.destroy(); } catch {} }
      if (wv) { try { wv.stop?.(); wv.loadURL('about:blank').catch(() => {}); } catch {} setTimeout(() => wv.remove(), 150); }
      if (p.root.hidden) { v.removeAttribute('src'); try { v.load(); } catch {} }
      relay.media.prepare(null);
    }, 40);
  }

  relay.media.onOpenUrl(({ url, title, partition, referer, web, kind }) => open({ src: url, title: title || url.split('/').pop().split('?')[0], partition, referer, web, kind }));

  window.Player = { open, close, isOpen: () => p.root && !p.root.hidden };
})();
