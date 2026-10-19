// Runs in every frame of the stage (isolated world: the page cannot see or
// tamper with this script). Finds the main <video>, reports its state to
// Sideby, applies sync commands, and draws reaction overlays.
const { ipcRenderer } = require('electron');

(() => {
  if (!/^(https?|sideby-media):$/.test(location.protocol)) return;

  let current = null;
  let expect = null;            // { until } window during which media events are our own echoes
  let lastGesture = 0;
  let lastScan = 0;
  let shadowScanAt = 0;
  let reportedVideo = false;
  const listened = new WeakSet();
  const isTop = window === window.top;

  const send = data => { try { ipcRenderer.send('frame:report', data); } catch {} };

  // ---- discovery ----
  function collectVideos() {
    const found = [...document.querySelectorAll('video')];
    if (!found.length && Date.now() - shadowScanAt > 3000) {
      shadowScanAt = Date.now();
      const walk = (root, depth) => {
        if (depth > 4) return;
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) {
            found.push(...el.shadowRoot.querySelectorAll('video'));
            walk(el.shadowRoot, depth + 1);
          }
        }
      };
      try { walk(document, 0); } catch {}
    }
    return found;
  }

  function visibleArea(v) {
    if (!v.isConnected) return 0;
    const r = v.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    const hasMedia = v.currentSrc || v.src || v.srcObject || v.readyState > 0;
    if (!hasMedia) return 0;
    const style = getComputedStyle(v);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return w * h * 0.05;
    return w * h;
  }

  function pick() {
    lastScan = Date.now();
    const videos = collectVideos();
    let best = null, bestArea = 0;
    for (const v of videos) {
      const a = visibleArea(v);
      if (a > bestArea) { best = v; bestArea = a; }
    }
    if (current && current.isConnected && visibleArea(current) >= bestArea * 0.6 && visibleArea(current) > 0) return current;
    if (best && bestArea >= 120 * 68) attach(best);
    else if (current && (!current.isConnected || visibleArea(current) === 0)) current = null;
    return current;
  }

  function attach(v) {
    current = v;
    if (listened.has(v)) return;
    listened.add(v);
    for (const ev of ['play', 'pause', 'seeked', 'ratechange', 'ended']) {
      v.addEventListener(ev, () => { if (v === current) onMediaEvent(ev); });
    }
    for (const ev of ['waiting', 'playing', 'loadedmetadata', 'durationchange']) {
      v.addEventListener(ev, () => { if (v === current) report(); });
    }
  }

  // ---- state ----
  function isAdPlaying() {
    try {
      if (/(^|\.)youtube\.com$/.test(location.hostname)) return !!document.querySelector('.html5-video-player.ad-showing, .ad-interrupting');
    } catch {}
    return false;
  }

  function snapshot(v) {
    const d = v.duration;
    const live = d === Infinity || d > 172800 || (location.host === 'player' && document.documentElement.dataset.live === '1');
    let lag = null;
    if (live) {
      try {
        const s = v.seekable;
        if (s.length) lag = Math.max(0, s.end(s.length - 1) - v.currentTime);
      } catch {}
    }
    return {
      t: v.currentTime,
      paused: v.paused,
      rate: v.playbackRate,
      duration: Number.isFinite(d) && !live ? d : null,
      live, lag,
      buffering: !v.paused && v.readyState < 3,
      ended: v.ended,
      ad: isAdPlaying(),
      muted: v.muted,
      width: v.videoWidth, height: v.videoHeight
    };
  }

  function report(event, user) {
    const v = current;
    if (!v) {
      if (reportedVideo) { reportedVideo = false; send({ kind: 'novideo' }); }
      return;
    }
    reportedVideo = true;
    send({ kind: 'video', area: visibleArea(v), state: snapshot(v), event, user, title: isTop ? null : document.title || null });
  }

  function onMediaEvent(ev) {
    const echo = expect && Date.now() < expect.until;
    let activated = false;
    try { activated = navigator.userActivation?.isActive; } catch {}
    const user = !echo && ev !== 'ratechange' && ev !== 'ended' && (Date.now() - lastGesture < 1500 || activated);
    report(ev, user);
  }

  // ---- commands ----
  ipcRenderer.on('sideby:apply', (_e, cmd) => {
    const v = current || pick();
    if (!v || !cmd) return;
    expect = { until: Date.now() + 1000 };
    try {
      if (cmd.goLive || Number.isFinite(cmd.seekLag)) {
        const s = v.seekable;
        if (s.length) v.currentTime = Math.max(0, s.end(s.length - 1) - (cmd.goLive ? 1.5 : cmd.seekLag));
      } else if (Number.isFinite(cmd.seek)) {
        v.currentTime = cmd.seek;
      }
      if (Number.isFinite(cmd.rate) && Math.abs(v.playbackRate - cmd.rate) > 0.001) v.playbackRate = cmd.rate;
      if (cmd.paused === true && !v.paused) v.pause();
      if (cmd.paused === false && v.paused) {
        const p = v.play();
        if (p && p.catch) p.catch(() => { v.muted = true; v.play().catch(() => {}); });
      }
      if (typeof cmd.muted === 'boolean') v.muted = cmd.muted;
    } catch {}
    setTimeout(report, 60);
  });

  // ---- gestures & fullscreen ----
  const gesture = () => {
    const now = Date.now();
    if (now - lastGesture > 400) send({ kind: 'gesture' });
    lastGesture = now;
  };
  addEventListener('pointerdown', gesture, true);
  addEventListener('keydown', gesture, true);
  document.addEventListener('fullscreenchange', () => {
    send({ kind: 'fullscreen', on: !!document.fullscreenElement });
    if (overlay) mountOverlay();
  });

  // ---- reactions overlay ----
  let overlay = null, layer = null;
  function mountOverlay() {
    if (!overlay) {
      overlay = document.createElement('sideby-overlay');
      const root = overlay.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>
        :host{all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict}
        .r{position:absolute;bottom:56px;display:flex;flex-direction:column;align-items:center;gap:4px;animation:rise 3.2s cubic-bezier(.2,.7,.3,1) forwards;font-family:-apple-system,"Segoe UI",system-ui,sans-serif}
        .e{font-size:44px;line-height:1;filter:drop-shadow(0 4px 10px rgba(0,0,0,.45))}
        .n{font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;background:rgba(10,14,11,.72);color:#fff;backdrop-filter:blur(6px);white-space:nowrap}
        @keyframes rise{0%{transform:translate(0,30px) scale(.4);opacity:0}12%{transform:translate(0,0) scale(1.15);opacity:1}20%{transform:scale(1)}80%{opacity:1}100%{transform:translate(var(--dx),-55vh) scale(.9);opacity:0}}
      </style><div id="l"></div>`;
      layer = root.getElementById('l');
    }
    const fs = document.fullscreenElement;
    const host = fs && fs.tagName !== 'VIDEO' && fs.tagName !== 'IFRAME' ? fs : document.documentElement;
    if (overlay.parentNode !== host) host.appendChild(overlay);
  }

  ipcRenderer.on('sideby:react', (_e, p) => {
    if (!p || typeof p.emoji !== 'string') return;
    try {
      mountOverlay();
      const el = document.createElement('div');
      el.className = 'r';
      el.style.right = `${24 + Math.random() * 18}%`;
      el.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 120)}px`);
      const e = document.createElement('div'); e.className = 'e'; e.textContent = p.emoji.slice(0, 8);
      const n = document.createElement('div'); n.className = 'n'; n.textContent = String(p.name || '').slice(0, 32);
      if (/^#[0-9a-f]{6}$/i.test(p.color)) n.style.boxShadow = `inset 0 0 0 1.5px ${p.color}`;
      el.append(e, n);
      layer.appendChild(el);
      setTimeout(() => el.remove(), 3300);
    } catch {}
  });

  // ---- loop ----
  function loop() {
    try {
      if (Date.now() - lastScan > 1000) pick();
      report();
    } catch {}
  }
  const start = () => { pick(); report(); setInterval(loop, 500); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
