/* Relay — skins & clutter removal for account pages.
   A light CSS layer injected into each mail page. It can't redesign Gmail/Outlook/Yahoo from scratch
   (their markup changes constantly), but it can recolor, darken, soften and tidy them reliably. */
(() => {
  const R = () => window.RelayApp;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const polish = (accent) => `
    ::selection { background: ${accent}55 !important; }
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(120, 115, 140, .35); border-radius: 10px; border: 3px solid transparent; background-clip: padding-box; }
    ::-webkit-scrollbar-thumb:hover { background-color: rgba(120, 115, 140, .55); }
    :focus-visible { outline-color: ${accent} !important; }
    input[type=checkbox], input[type=radio] { accent-color: ${accent}; }`;

  // "Smart invert": flips the page to dark, then flips photos/video back so they look normal
  const midnight = `
    html { filter: invert(0.9) hue-rotate(180deg) !important; background: #fff !important; }
    img, video, picture, canvas, iframe, embed, object,
    [style*="background-image"]:not(body):not(html), [role="img"][style*="url("] { filter: invert(1) hue-rotate(180deg) !important; }
    img img, picture img { filter: none !important; }`;

  const dim = `html { filter: brightness(0.93) contrast(0.95) sepia(0.07) !important; }`;

  // "Relay dark": purple & black. The page is flipped to dark on <body>, then a faint purple light is
  // "screened" over it from <html>, so white becomes Relay's purple-black (#110d1a) and text stays crisp.
  // Colors we add ourselves are pre-flipped (pre()) so they come out exactly right.
  const H180 = [[-0.574, 1.43, 0.144], [0.426, 0.43, 0.144], [0.426, 1.43, -0.856]];
  function pre(hex) {
    const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16);
    const t = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => v / 255);
    const y = H180.map(r => r[0] * t[0] + r[1] * t[1] + r[2] * t[2]);
    return '#' + y.map(v => Math.round(Math.max(0, Math.min(1, (0.96 - v) / 0.92)) * 255).toString(16).padStart(2, '0')).join('');
  }
  const BODY_LINKS = '.a3s a[href], [aria-label="Message body"] a[href], [data-test-id="message-view-body"] a[href], [role="document"] a[href]';
  const relayDark = (accent) => `
    html { background: #000 !important; }
    html::after { content: ""; position: fixed; inset: 0; background: #070311; mix-blend-mode: screen; pointer-events: none; z-index: 2147483647; }
    body { filter: invert(0.96) hue-rotate(180deg) !important; }
    img, video, picture, canvas, iframe, embed, object, svg image,
    [style*="background-image"]:not(body):not(html), [role="img"][style*="url("] { filter: invert(1) hue-rotate(180deg) !important; }
    img img, picture img { filter: none !important; }
    ${BODY_LINKS} { color: ${pre(accent)} !important; }
    ::selection { background: ${pre(accent)} !important; color: #fff !important; }
    input[type=checkbox], input[type=radio] { accent-color: ${pre(accent)}; }`;
  // When the page already uses its own dark theme, just bring in the accent
  const darkNative = (accent) => `${BODY_LINKS} { color: ${accent} !important; }`;

  const SKINS = [
    { id: 'original', label: 'Original', desc: 'Exactly how the provider designed it', swatch: ['#ffffff', '#e8eaed', '#1a73e8'] },
    { id: 'relay', label: 'Relay', desc: 'Your account color, soft scrollbars, tidy focus rings', swatch: ['#ffffff', '#f4f3f9', 'ACCENT'] },
    { id: 'relaydark', label: 'Relay dark', desc: 'Purple & black, matching Relay', swatch: ['#110d1a', '#1d1a28', '#a78bfa'] },
    { id: 'midnight', label: 'Midnight', desc: 'Neutral dark mode for any inbox — photos stay normal', swatch: ['#121118', '#24222e', 'ACCENT'] },
    { id: 'dim', label: 'Dim', desc: 'Warmer, lower-glare for late nights', swatch: ['#efe9df', '#ddd5c7', 'ACCENT'] },
    { id: 'auto', label: 'Match Relay', desc: 'Relay dark when Relay is dark, light with accents otherwise', swatch: ['#ffffff', '#110d1a', 'ACCENT'] },
    { id: 'default', label: 'App default', desc: 'Follow Settings → Appearance → Inbox style', swatch: ['#110d1a', '#ffffff', 'ACCENT'] }
  ];

  // Extra "clutter" rules on top of the ad blocker's filter lists: ad slots and upsell banners
  // that are served by the mail providers themselves.
  const CLUTTER = {
    yahoo: `
      [data-test-id="pencil-ad"], [data-test-id*="pencil-ad"], [data-test-id="right-rail-ad"], [data-test-id*="right-rail-ad"],
      [data-test-id="gam-iframe"], [data-test-id*="gam-ad"], [data-test-id="ad-free-upsell"], [data-test-id*="upsell"],
      [data-test-id="comms-properties"], [data-test-id="mail-right-rail"], #gam-iframe, iframe[id^="gam"],
      [data-test-id="message-list-ad"], a[href*="beap.gemini.yahoo.com"], [class*="ad-slot" i] { display: none !important; }`,
    outlook: `
      #owaadbar0, #owaadbar1, [id^="owaadbar"], [data-app-section="AdsContainer"], [aria-label="Advertisement" i], [aria-label="Ads" i],
      [id*="AdContainer"], [class*="adContainer" i], div[data-max-width][style*="160px"], [aria-label*="Upgrade to Microsoft 365" i],
      [data-automation-type="RibbonUpsellButton"], #app [class*="PremiumUpsell" i] { display: none !important; }`,
    gmail: '',
    other: `
      iframe[id^="google_ads"], iframe[src*="doubleclick.net"], [id^="div-gpt-ad"], ins.adsbygoogle { display: none !important; }`
  };

  const keys = new Map(); // webview -> inserted css keys
  // Looks at what's actually painted in the middle of the page to tell light pages from dark ones
  const DARK_PROBE = `(() => {
    const lum = (c) => { const m = String(c).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); if (p.length > 3 && p[3] < 0.5) return null; return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255; };
    const pts = [[0.5, 0.5], [0.7, 0.4], [0.3, 0.6], [0.5, 0.15]];
    let dark = 0, n = 0;
    for (const [x, y] of pts) {
      let el = document.elementFromPoint(innerWidth * x, innerHeight * y);
      while (el) { const l = lum(getComputedStyle(el).backgroundColor); if (l != null) { n++; if (l < 0.35) dark++; break; } el = el.parentElement; }
    }
    if (!n) { const l = lum(getComputedStyle(document.body || document.documentElement).backgroundColor); return l != null && l < 0.35; }
    return dark / n > 0.5;
  })()`;

  const isMail = (a) => ['gmail', 'outlook', 'yahoo', 'other'].includes(a.platform);
  function effectiveSkin(a) {
    let s = a.skin && a.skin !== 'default' ? a.skin : isMail(a) ? (R().state.settings.inboxStyle || 'match') : 'original';
    if (s === 'match') s = 'auto';
    if (s !== 'auto') return s;
    return document.documentElement.dataset.theme === 'dark' ? 'relaydark' : 'relay';
  }
  const appAccent = () => (R().state.settings.look === 'legacy' ? null : getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()) || '#8b6dff';

  function cssFor(a, pageIsDark = false) {
    const skin = effectiveSkin(a);
    const accent = skin === 'relaydark' || skin === 'relay' && R().state.settings.look !== 'legacy' ? appAccent() : (a.color || '#6d4aff');
    let css = '';
    if (skin !== 'original') css += polish(accent);
    if (skin === 'relaydark') css += pageIsDark ? darkNative(accent) : relayDark(accent);
    if (skin === 'midnight' && !pageIsDark) css += midnight;
    if (skin === 'dim') css += dim;
    if (a.adblock !== false && R().state.settings.adblockMail !== false) css += CLUTTER[a.platform] || CLUTTER.other;
    if (a.customCss) css += '\n' + a.customCss;
    return css;
  }

  async function apply(a, wv) {
    if (!wv) wv = R().webviews.get(a.id)?.wv;
    if (!wv) return;
    try {
      // already dark (e.g. Gmail's own dark theme)? then don't flip it back to light
      let pageIsDark = false;
      const skin = effectiveSkin(a);
      if (skin === 'relaydark' || skin === 'midnight') {
        for (const k of keys.get(wv) || []) await wv.removeInsertedCSS(k).catch(() => {});
        keys.set(wv, []);
        pageIsDark = await wv.executeJavaScript(DARK_PROBE).catch(() => false);
      }
      for (const k of keys.get(wv) || []) await wv.removeInsertedCSS(k).catch(() => {});
      const css = cssFor(a, pageIsDark);
      keys.set(wv, css.trim() ? [await wv.insertCSS(css)] : []);
    } catch { /* page not ready yet; dom-ready will call again */ }
  }
  function forget(wv) { keys.delete(wv); }
  function reapplyAll() {
    R().state.accounts.forEach(a => apply(a));
  }
  // pages repaint as they load; re-check once things settle
  const settle = new WeakSet();
  function applySoon(a, wv) {
    apply(a, wv);
    if (!settle.has(wv)) { settle.add(wv); wv.addEventListener('did-stop-loading', () => setTimeout(() => { const acc = R().accountById(a.id); if (acc) apply(acc, wv); }, 1500)); }
  }

  function openModal(a) {
    const draft = { skin: a.skin || 'default', adblock: a.adblock !== false, customCss: a.customCss || '' };
    const accent = a.color || '#6d4aff';
    R().openModal({
      title: 'Appearance & ads',
      subtitle: `${a.name || a.email || 'This account'} — changes apply instantly`,
      icon: 'palette', color: accent, wide: true,
      body: `
        <div class="skin-grid" id="skGrid">${SKINS.map(s => `
          <button class="skin ${draft.skin === s.id ? 'active' : ''}" data-s="${s.id}">
            <span class="sk-prev" style="--a:${s.swatch[0]};--b:${s.swatch[1]};--c:${s.swatch[2] === 'ACCENT' ? accent : s.swatch[2]}">
              <i class="sk-side"></i><i class="sk-row"></i><i class="sk-row short"></i><i class="sk-row"></i><i class="sk-dot"></i>
            </span>
            <b>${s.label}</b><small>${s.desc}</small>
          </button>`).join('')}</div>
        <label class="toggle-row"><span><b>Block ads & clutter</b><small>Removes ad slots, trackers and upsell banners — pages load faster</small></span>
          <span class="switch"><input type="checkbox" id="skAd" ${draft.adblock ? 'checked' : ''}><span></span></span></label>
        <details class="custom-css" ${draft.customCss ? 'open' : ''}>
          <summary>${ic('edit', 14)} Custom CSS <small>for tinkerers</small></summary>
          <textarea class="textarea mono" id="skCss" spellcheck="false" placeholder="/* e.g. make the reading pane text bigger */\n[role=main] { font-size: 15px !important; }">${R().esc(draft.customCss)}</textarea>
        </details>
        <div class="tip">${ic('sparkles', 15)}<span>For the cleanest look, you can also turn on the provider’s own dark theme in its settings and use <b>Relay</b> here. Skins are a styling layer on top, so a provider redesign can occasionally make one look a little off.</span></div>`,
      actions: [{ label: 'Done', cls: 'primary', onClick: (m) => save(m) }],
      onMount: (m) => {
        $$('#skGrid .skin', m).forEach(b => b.onclick = () => {
          draft.skin = b.dataset.s;
          $$('#skGrid .skin', m).forEach(x => x.classList.toggle('active', x === b));
          preview();
        });
        $('#skAd', m).onchange = (e) => { draft.adblock = e.target.checked; };
        let t; $('#skCss', m).oninput = (e) => { draft.customCss = e.target.value; clearTimeout(t); t = setTimeout(preview, 400); };
      }
    });
    function preview() { apply({ ...a, ...draft }); }
    async function save() {
      const adChanged = (a.adblock !== false) !== draft.adblock;
      await R().updateAccount(a.id, draft);
      apply(R().accountById(a.id));
      if (adChanged) {
        await relay.prepareSession('persist:relay-' + a.id, a.signinMode || 'auto', draft.adblock);
        R().webviews.get(a.id)?.wv.reload();
      }
    }
  }

  window.Skins = { apply, applySoon, forget, reapplyAll, openModal, effectiveSkin, pre };
})();
