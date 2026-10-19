/* Relay — renderer core: tabs, accounts, webviews, modals */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const PLATFORMS = {
  gmail:   { label: 'Gmail',   color: 'var(--gmail)',   hex: '#ff4d3d', blurb: 'Add your Google accounts. Each one gets its own private session, so you can stay signed in to all of them at once.' },
  outlook: { label: 'Outlook', color: 'var(--outlook)', hex: '#1f7bff', blurb: 'Personal Outlook, Hotmail and Live accounts, or work and school Microsoft 365 mailboxes.' },
  yahoo:   { label: 'Yahoo',   color: 'var(--yahoo)',   hex: '#7a2cff', blurb: 'Yahoo Mail and AT&T / Rogers accounts powered by Yahoo.' },
  other:   { label: 'Other',   color: 'var(--other)',   hex: '#10b5a0', blurb: 'iCloud, Proton, AOL, Zoho, Fastmail, or any webmail with a URL.' },
  chats:   { label: 'Chats',   color: 'var(--chats)',   hex: '#0ea5e9', icon: 'chat', blurb: 'Teams, Slack, WhatsApp and more — each signed in once, with its own unread count and notifications.' }
};
const MAIL_PLATFORMS = ['gmail', 'outlook', 'yahoo', 'other'];
const isMailAccount = (a) => !!a && MAIL_PLATFORMS.includes(a.platform);
const mailAccounts = () => state.accounts.filter(isMailAccount);
// Work & social chat apps — each runs its own web app in a private session
const CHAT_SERVICES = {
  teams:     { label: 'Microsoft Teams', group: 'Work', url: 'https://teams.microsoft.com/v2/', personalUrl: 'https://teams.live.com/v2/', color: '#5b5fc7', abbr: 'T', link: 'outlook' },
  slack:     { label: 'Slack', group: 'Work', url: 'https://app.slack.com/client', color: '#4a154b', abbr: 'S' },
  gchat:     { label: 'Google Chat', group: 'Work', url: 'https://chat.google.com/', color: '#1e8e3e', abbr: 'GC', link: 'gmail' },
  zoom:      { label: 'Zoom Team Chat', group: 'Work', url: 'https://app.zoom.us/wc/team-chat', color: '#0b5cff', abbr: 'Z' },
  webex:     { label: 'Webex', group: 'Work', url: 'https://web.webex.com/', color: '#0b7a75', abbr: 'W' },
  whatsapp:  { label: 'WhatsApp', group: 'Social', url: 'https://web.whatsapp.com/', color: '#1fa855', abbr: 'WA' },
  messenger: { label: 'Messenger', group: 'Social', url: 'https://www.messenger.com/', color: '#0a7cff', abbr: 'M' },
  instagram: { label: 'Instagram', group: 'Social', url: 'https://www.instagram.com/direct/inbox/', color: '#d62976', abbr: 'IG' },
  telegram:  { label: 'Telegram', group: 'Social', url: 'https://web.telegram.org/a/', color: '#229ed9', abbr: 'TG' },
  discord:   { label: 'Discord', group: 'Social', url: 'https://discord.com/app', color: '#5865f2', abbr: 'D' },
  linkedin:  { label: 'LinkedIn', group: 'Social', url: 'https://www.linkedin.com/messaging/', color: '#0a66c2', abbr: 'in' },
  x:         { label: 'X', group: 'Social', url: 'https://x.com/messages', color: '#3f3f46', abbr: 'X' }
};
const chatService = (a) => CHAT_SERVICES[a?.service] || null;
const OTHER_PRESETS = [
  { id: 'icloud', label: 'iCloud Mail', url: 'https://www.icloud.com/mail' },
  { id: 'proton', label: 'Proton Mail', url: 'https://mail.proton.me' },
  { id: 'aol', label: 'AOL Mail', url: 'https://mail.aol.com' },
  { id: 'zoho', label: 'Zoho Mail', url: 'https://mail.zoho.com' },
  { id: 'fastmail', label: 'Fastmail', url: 'https://app.fastmail.com' },
  { id: 'gmx', label: 'GMX', url: 'https://www.gmx.com' },
  { id: 'custom', label: 'Custom URL', url: '' }
];
const ACCOUNT_COLORS = ['#6d4aff', '#ff4f9a', '#ff6b3d', '#ffb03b', '#22c55e', '#10b5a0', '#0ea5e9', '#1f7bff', '#a855f7', '#e5484d', '#64748b', '#d946ef'];

const state = {
  accounts: [], events: [], settings: {}, ui: { platform: 'gmail', selected: {} },
  unread: {}, // accountId -> count
  aiOpen: false
};

/* ---------- helpers ---------- */
function initials(a) {
  const src = (a.name || a.email || '?').trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}
function avatarHTML(a, size = '') {
  if (a.platform === 'chats') {
    const sv = chatService(a) || { color: '#64748b', abbr: '?' };
    return `<div class="svc-tile ${size}" style="--sv:${sv.color}">${a.favicon ? `<img src="${esc(a.favicon)}" alt="" draggable="false" data-fallback>` : ''}<span>${esc(sv.abbr)}</span></div>`;
  }
  const face = a.avatar
    ? `<img src="${esc(a.avatar)}" alt="" draggable="false" data-fallback>`
    : '';
  return `<div class="avatar ${size}" style="--c:${esc(a.color)}"><div class="face">${face || esc(initials(a))}</div></div>`;
}
function toast(msg, type = '', action) {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-act'; b.textContent = action.label;
    b.onclick = () => { action.onClick(); t.remove(); };
    t.appendChild(b);
  }
  $('#toastRoot').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, type === 'error' ? 5000 : action ? 6000 : 2600);
}
function accountsFor(p) { return state.accounts.filter(a => a.platform === p); }
function accountById(id) { return state.accounts.find(a => a.id === id); }
// A "surface" is anything shown in the shared webview area: a mail account or a storage account
function surfaceById(id) { return accountById(id) || window.Cloud?.surface(id) || null; }
function startUrl(a) {
  switch (a.platform) {
    case 'gmail': {
      const hint = a.email ? '&Email=' + encodeURIComponent(a.email) : '';
      return 'https://accounts.google.com/ServiceLogin?service=mail&continue=' + encodeURIComponent('https://mail.google.com/mail/u/0/') + hint;
    }
    case 'outlook': return a.outlookType === 'work' ? 'https://outlook.office.com/mail/' : 'https://outlook.live.com/mail/0/';
    case 'yahoo': return 'https://mail.yahoo.com/';
    case 'storage': return a.url || 'about:blank';
    case 'chats': { const sv = chatService(a); return a.url || (sv ? (a.service === 'teams' && a.teamsType === 'personal' ? sv.personalUrl : sv.url) : 'about:blank'); }
    default: return a.url || 'about:blank';
  }
}

/* ---------- theme ---------- */
const mq = window.matchMedia('(prefers-color-scheme: dark)');
// Look: "relay" = one accent color (purple by default) everywhere; "legacy" = the original colorful palette
const ACCENTS = [
  ['#7c5cff', 'Relay purple'], ['#a855f7', 'Violet'], ['#6366f1', 'Indigo'], ['#3b82f6', 'Blue'], ['#14b8a6', 'Teal'],
  ['#22c55e', 'Green'], ['#f59e0b', 'Amber'], ['#f43f5e', 'Rose'], ['#a1a1aa', 'Graphite']
];
const DEFAULT_ACCENT = '#7c5cff';
function hexToRgb(h) { const m = String(h).replace('#', '').match(/^([0-9a-f]{6})$/i); const n = parseInt(m ? m[1] : '7c5cff', 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgbToHex(r, g, b) { return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join(''); }
function mix(hex, toward, amt) { const a = hexToRgb(hex), b = hexToRgb(toward); return rgbToHex(...a.map((v, i) => v + (b[i] - v) * amt)); }
function shiftHue(hex, deg) {
  let [r, g, b] = hexToRgb(hex).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b); let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) { const d = max - min; s = l > .5 ? d / (2 - max - min) : d / (max + min); h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  h = (h + deg / 360 + 1) % 1;
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return s ? rgbToHex(f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255) : hex;
}
function accentColor() { return state.settings.accent || DEFAULT_ACCENT; }
function isDark() { const t = state.settings.theme || 'dark'; return t === 'dark' || (t === 'system' && mq.matches); }
function applyTheme() {
  const dark = isDark();
  const root = document.documentElement;
  root.dataset.dark = dark ? '1' : '0';
  root.dataset.theme = dark ? 'dark' : 'light';
  const legacy = state.settings.look === 'legacy';
  root.dataset.look = legacy ? 'legacy' : 'relay';
  const st = root.style;
  const vars = ['--accent', '--accent-2', '--accent-3', '--accent-soft', '--accent-strong', '--accent-ink', '--gradient', '--glow'];
  if (legacy) { vars.forEach(v => st.removeProperty(v)); return; }
  const a = accentColor();
  const lift = dark ? mix(a, '#ffffff', 0.12) : a;
  st.setProperty('--accent', lift);
  st.setProperty('--accent-strong', dark ? mix(a, '#ffffff', 0.28) : mix(a, '#000000', 0.12));
  st.setProperty('--accent-2', shiftHue(lift, 22));
  st.setProperty('--accent-3', mix(shiftHue(lift, 38), '#ffffff', 0.25));
  st.setProperty('--accent-soft', `color-mix(in srgb, ${lift} ${dark ? 18 : 11}%, transparent)`);
  st.setProperty('--accent-ink', '#ffffff');
  st.setProperty('--gradient', `linear-gradient(125deg, ${mix(a, '#000000', 0.05)} 0%, ${lift} 45%, ${shiftHue(lift, 24)} 100%)`);
  st.setProperty('--glow', `color-mix(in srgb, ${lift} 45%, transparent)`);
}
mq.addEventListener('change', applyTheme);

/* ---------- tabs ---------- */
const VIEWS = { home: () => window.Home, calendar: () => window.Calendar, vault: () => window.Vault, browser: () => window.Browser, downloads: () => window.Downloads, tracking: () => window.Tracking, library: () => window.Library };
const isView = (p) => !!VIEWS[p];

function renderTabs() {
  const tab = (id, label, color, icon) => {
    const total = PLATFORMS[id] ? accountsFor(id).reduce((n, a) => n + (state.unread[a.id] || 0), 0)
      : id === 'downloads' ? (window.Downloads?.activeCount() || 0)
      : id === 'tracking' ? (window.Tracking?.todayCount() || 0) : 0;
    return `<button class="tab ${state.ui.platform === id ? 'active' : ''}" data-tab="${id}" style="--c:${color}" role="tab" title="${label}">
      ${icon ? ic(icon, 15) : '<span class="dot"></span>'}<span>${label}</span>${total ? `<span class="count">${total > 99 ? '99+' : total}</span>` : ''}
    </button>`;
  };
  $('#tabs').innerHTML = `<div class="tab-group">
      ${tab('home', 'Home', 'var(--accent)', 'home')}
      <span class="tab-sep"></span>
      ${Object.entries(PLATFORMS).filter(([id]) => id !== 'chats').map(([id, p]) => tab(id, p.label, p.color)).join('')}
      <span class="tab-sep"></span>
      ${tab('chats', 'Chats', PLATFORMS.chats.color, 'chat')}
      <span class="tab-sep"></span>
      ${tab('calendar', 'Calendar', 'var(--calendar)', 'calendar')}
      ${tab('storage', 'Storage', 'var(--storage)', 'cloud')}
      ${tab('browser', 'Browser', 'var(--browser)', 'globe')}
      ${tab('vault', 'Vault', 'var(--vault)', 'lock')}
      ${tab('library', 'Library', 'var(--library)', 'library')}
      ${tab('downloads', 'Downloads', 'var(--downloads)', 'download')}
      ${tab('tracking', 'Tracking', 'var(--tracking)', 'box')}
    </div>`;
  $$('#tabs .tab').forEach(b => b.onclick = () => setPlatform(b.dataset.tab));
}

function setPlatform(p) {
  const changed = state.ui.platform !== p;
  if (PLATFORMS[p] || p === 'storage') state.ui.lastWeb = p;
  if (changed) { closeFind(); hidePackageChip(); }
  state.ui.platform = p;
  relay.saveUI({ platform: p });
  render();
  if (changed && state.aiOpen) window.AI?.render();
}

/* ---------- sidebar ---------- */
function renderSidebar() {
  const p = state.ui.platform;
  if (isView(p)) { VIEWS[p]()?.renderSidebar($('#sidebar')); return; }
  if (p === 'storage') { window.Cloud?.renderSidebar($('#sidebar')); return; }
  const plat = PLATFORMS[p];
  const list = accountsFor(p);
  const sel = state.ui.selected[p];
  $('#sidebar').innerHTML = `
    <div class="side-head">
      <div class="side-title" style="--c:${plat.color}"><span class="dot"></span>${p === 'chats' ? 'Chats' : `${plat.label} accounts`}</div>
      <span class="side-title">${list.length || ''}</span>
    </div>
    <div class="accounts" id="accountList">
      ${list.map(a => `
        <div class="account ${a.id === sel ? 'active' : ''}" data-id="${a.id}" style="--c:${esc(a.color)}" draggable="true" title="${esc(a.email || a.name)}">
          ${avatarHTML(a)}
          <div class="meta">
            <div class="name">${esc(a.name || a.email || plat.label)}</div>
            <div class="email">${esc(a.platform === 'chats' ? (chatService(a)?.label || '') + (a.email ? ' · ' + a.email : '') : a.email || (a.platform === 'other' ? a.providerLabel || a.url : ''))}</div>
          </div>
          ${state.unread[a.id] ? `<span class="badge">${state.unread[a.id] > 999 ? '999+' : state.unread[a.id]}</span>` : ''}
          <button class="icon-btn sm more" data-more="${a.id}" title="Account options">${ic('dots', 16)}</button>
        </div>`).join('')}
      <button class="add-account" id="addAccountBtn" style="--c:${plat.color}">
        <span class="plus">${ic('plus', 18)}</span>
        <span>${p === 'chats' ? 'Add a chat app' : `Add ${plat.label} account`}</span>
      </button>
    </div>
    <div class="side-foot">${ic('check', 13)} Sessions stay private per account</div>`;

  $('#addAccountBtn').onclick = () => (p === 'chats' ? openChatModal({}) : openAccountModal({ platform: p }));
  $$('#accountList .account').forEach(el => {
    el.onclick = (e) => { if (e.target.closest('[data-more]')) return; selectAccount(el.dataset.id); };
    el.oncontextmenu = (e) => { e.preventDefault(); accountMenu(el.dataset.id, e.clientX, e.clientY); };
    // drag to reorder
    el.ondragstart = (e) => { el.classList.add('dragging'); e.dataTransfer.setData('text/plain', el.dataset.id); };
    el.ondragend = () => el.classList.remove('dragging');
    el.ondragover = (e) => { e.preventDefault(); el.classList.add('drop-above'); };
    el.ondragleave = () => el.classList.remove('drop-above');
    el.ondrop = async (e) => {
      e.preventDefault(); el.classList.remove('drop-above');
      const from = e.dataTransfer.getData('text/plain');
      if (from === el.dataset.id) return;
      const ids = state.accounts.map(a => a.id).filter(i => i !== from);
      ids.splice(ids.indexOf(el.dataset.id), 0, from);
      state.accounts = await relay.reorderAccounts(ids);
      renderSidebar();
    };
  });
  $$('[data-more]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const r = b.getBoundingClientRect();
    accountMenu(b.dataset.more, r.right - 4, r.bottom + 4);
  });
}

function selectAccount(id) {
  const a = accountById(id);
  if (!a) return;
  state.ui.selected[a.platform] = id;
  relay.saveUI({ selected: state.ui.selected });
  render();
}

/* ---------- webviews ---------- */
const webviews = new Map(); // id -> { wrap, wv }

const pendingWebviews = new Map();
function ensureWebview(a) {
  if (webviews.has(a.id)) return Promise.resolve(webviews.get(a.id));
  if (!pendingWebviews.has(a.id)) pendingWebviews.set(a.id, createWebview(a).finally(() => pendingWebviews.delete(a.id)));
  return pendingWebviews.get(a.id);
}
async function createWebview(a) {
  const partition = a.partition || 'persist:relay-' + a.id;
  const isMail = isMailAccount(a);
  const isChat = a.platform === 'chats';
  const { preload } = await relay.prepareSession(partition, a.signinMode || 'auto', a.adblock !== false);
  const wrap = document.createElement('div');
  wrap.className = 'webview-wrap loading';
  wrap.dataset.id = a.id;
  wrap.innerHTML = '<div class="loading-bar"></div>';
  const wv = document.createElement('webview');
  wv.setAttribute('partition', partition);
  wv.setAttribute('preload', preload);
  wv.setAttribute('webpreferences', 'sandbox=yes');
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('src', a.lastUrl && a.platform !== 'gmail' ? a.lastUrl : startUrl(a));
  wrap.appendChild(wv);
  $('#webviews').appendChild(wrap);

  wrap.insertAdjacentHTML('afterbegin', `<div class="pane-head">${avatarHTML(a, 'xs')}<span class="ph-name">${esc(a.name || a.email || chatService(a)?.label || '')}</span><span class="ph-sub">${esc(a.platform === 'chats' ? chatService(a)?.label || '' : PLATFORMS[a.platform]?.label || 'Storage')}</span><span class="spacer"></span><button class="icon-btn sm" data-pane="swap" title="Swap sides">${ic('swap', 14)}</button><button class="icon-btn sm" data-pane="pick" title="Show something else here">${ic('chevronDown', 14)}</button><button class="icon-btn sm" data-pane="close" title="Close split view">${ic('x', 14)}</button></div>`);
  wrap.querySelectorAll('[data-pane]').forEach(b => b.onclick = (e) => window.Split?.paneAction(a.id, b.dataset.pane, e));
  wrap.addEventListener('mousedown', () => window.Split?.focus(a.id), true);
  wv.addEventListener('focus', () => window.Split?.focus(a.id));
  wv.addEventListener('did-start-loading', () => wrap.classList.add('loading'));
  wv.addEventListener('did-stop-loading', () => wrap.classList.remove('loading'));
  if (isChat) {
    wv.addEventListener('page-title-updated', (e) => updateUnread(a.id, e.title));
    // the chat app's own icon becomes its tile in the sidebar
    wv.addEventListener('page-favicon-updated', (e) => {
      const acc = accountById(a.id); const fav = e.favicons?.[0];
      if (acc && fav && /^https:/.test(fav) && !acc.favicon) { acc.favicon = fav; relay.saveAccount({ id: a.id, favicon: fav }); if (state.ui.platform === 'chats') renderSidebar(); }
    });
  }
  if (isMail) {
    wv.addEventListener('page-title-updated', (e) => updateUnread(a.id, e.title));
    wv.addEventListener('did-stop-loading', () => schedulePackageScan(a.id));
    wv.addEventListener('did-navigate-in-page', () => schedulePackageScan(a.id));
    wv.addEventListener('page-title-updated', () => schedulePackageScan(a.id));
  }
  wv.addEventListener('dom-ready', () => {
    if (isChat) window.Skins?.applySoon(accountById(a.id), wv);
    if (isMail) { setTimeout(() => tryGrabAvatar(a.id), 4000); window.Skins?.applySoon(accountById(a.id), wv); }
  });
  wv.addEventListener('did-navigate', (e) => {
    const acc = surfaceById(a.id);
    if (isMail && acc && /^https:/.test(e.url) && !/login|signin|accounts\.google/.test(e.url)) acc.lastUrl = e.url;
    if (acc) handleSignInBlock(acc, e.url);
  });
  wv.addEventListener('did-navigate-in-page', (e) => { const acc = surfaceById(a.id); if (acc && e.isMainFrame) handleSignInBlock(acc, e.url); });
  const entry = { wrap, wv };
  webviews.set(a.id, entry);
  return entry;
}

// Google shows a "browser may not be secure" page when it rejects a sign-in.
// Step through other browser identities automatically before asking for help.
const SIGNIN_FALLBACK = { auto: 'safari', firefox: 'safari', safari: 'edge', edge: 'chrome', chrome: null };
const GOOGLE_REJECT = /accounts\.google\.com\/.*(rejected|disallowed|deniedsignin|unsupportedbrowser)/i;
async function handleSignInBlock(a, url) {
  if (!GOOGLE_REJECT.test(url || '')) return;
  const next = SIGNIN_FALLBACK[a.signinMode || 'auto'];
  if (!next) { openSignInHelp(a, true); return; }
  toast(`Google blocked that sign-in — retrying as ${next[0].toUpperCase() + next.slice(1)}…`);
  await setSignInMode(a, next);
}
async function setSignInMode(a, mode) {
  a.signinMode = mode;
  if (a.platform === 'storage') {
    // Linked storage shares its mail account's session, so the mode belongs to that account
    if (a.linkedAccountId) state.accounts = await relay.saveAccount({ id: a.linkedAccountId, signinMode: mode });
    else state.storage = await relay.saveStorage({ id: a.id, signinMode: mode });
  } else state.accounts = await relay.saveAccount({ id: a.id, signinMode: mode });
  await relay.prepareSession(a.partition || 'persist:relay-' + a.id, mode);
  const e = webviews.get(a.id);
  if (e) e.wv.loadURL(startUrl(a));
}
function openSignInHelp(a, blocked = false) {
  const modes = [
    ['auto', 'Automatic', 'Firefox identity for Google sign-in, Edge for Microsoft'],
    ['safari', 'Safari', 'Looks like Safari on your Mac'],
    ['firefox', 'Firefox', 'Looks like Firefox'],
    ['edge', 'Edge', 'Best for Microsoft accounts'],
    ['chrome', 'Chrome', 'Looks like Google Chrome']
  ];
  let pick = a.signinMode || 'auto';
  openModal({
    title: blocked ? 'Sign-in was blocked' : 'Sign-in troubles?',
    subtitle: 'Some providers refuse sign-in from apps they don’t recognize. Relay can present itself as a different browser on the sign-in page.',
    icon: 'key', color: PLATFORMS[a.platform]?.color || 'var(--storage)',
    body: `
      <div class="mode-list" id="modeList">${modes.map(([v, l, d]) => `<button data-v="${v}" class="${v === pick ? 'active' : ''}"><span class="radio"></span><span><b>${l}</b><small>${d}</small></span></button>`).join('')}</div>
      <div class="tip">${ic('sparkles', 15)}<span>If a sign-in asks for a passkey or security key, choose <b>“Try another way”</b> and use your password or phone prompt instead — passkeys aren’t supported inside Relay yet.</span></div>`,
    actions: [
      { label: 'Cancel' },
      { label: 'Start over', cls: '', onClick: async () => { await relay.signOut(a.id); await setSignInMode(a, pick); toast('Signed out — try signing in again'); } },
      { label: 'Use this mode', cls: 'brand', onClick: async () => { await setSignInMode(a, pick); } }
    ],
    onMount: (m) => $$('#modeList button', m).forEach(b => b.onclick = () => { pick = b.dataset.v; $$('#modeList button', m).forEach(x => x.classList.toggle('active', x === b)); })
  });
}

async function fillFromVault(a) {
  const e = webviews.get(a.id);
  if (!e) return;
  const ok = await window.Vault?.ensureUnlocked();
  if (!ok) return;
  const matches = await relay.vault.matches(e.wv.getURL());
  const run = async (m) => {
    const r = await relay.vault.fill(m.id, e.wv.getWebContentsId());
    toast(r.ok ? `Filled ${r.filled.join(' & ')} for ${m.username || m.name}` : 'Couldn’t find a sign-in field on this page', r.ok ? '' : 'error');
  };
  if (!matches.length) { toast('No saved passwords match this site', 'error'); return; }
  if (matches.length === 1) return run(matches[0]);
  const r = $('#webviews').getBoundingClientRect();
  popMenu(r.left + 20, r.top + 20, matches.slice(0, 10).map(m => ({ label: `${m.username || '(no username)'} — ${m.host}`, icon: 'key', onClick: () => run(m) })));
}

// Right-click → Fill Password works in every webview: mail, chats, storage, browser tabs, the AI panel
const webviewByWcId = (id) => $$('webview').find(w => { try { return w.getWebContentsId() === id; } catch { return false; } });
async function fillFromContextMenu({ wcId, x, y }) {
  const wv = webviewByWcId(wcId);
  if (!wv) return;
  const ok = await window.Vault?.ensureUnlocked();
  if (!ok) return;
  const r = wv.getBoundingClientRect();
  const px = r.left + (x || 20), py = r.top + (y || 20);
  const run = async (m) => {
    const res = await relay.vault.fill(m.id, wcId);
    toast(res.ok ? `Filled ${res.filled.join(' & ')} for ${m.username || m.name}` : 'Couldn’t find a sign-in field here', res.ok ? '' : 'error');
  };
  const matches = await relay.vault.matches(wv.getURL());
  if (matches.length === 1) return run(matches[0]);
  if (matches.length) return popMenu(px, py, [{ html: '<small class="lib-tip">Saved for this site</small>' }, ...matches.slice(0, 10).map(m => ({ label: `${m.username || '(no username)'} — ${m.host}`, icon: 'key', onClick: () => run(m) }))]);
  // nothing saved for this site: offer everything (sign-ins often live on another domain)
  const all = await relay.vault.list().catch(() => []);
  const host = (() => { try { return new URL(wv.getURL()).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const base = host.split('.').slice(-2, -1)[0] || '';
  const ranked = all.slice().sort((a, b) => (String(b.url || b.name).includes(base) ? 1 : 0) - (String(a.url || a.name).includes(base) ? 1 : 0)).slice(0, 12);
  popMenu(px, py, [{ html: `<small class="lib-tip">No password saved for ${esc(host || 'this site')} — pick one:</small>` },
    ...ranked.map(m => ({ label: `${m.name || m.host || 'Login'} — ${m.username || ''}`, icon: 'key', onClick: () => run(m) })),
    '-', { label: 'Open Vault…', icon: 'lock', onClick: () => setPlatform('vault') }]);
}
async function saveFromContextMenu({ wcId }) {
  const wv = webviewByWcId(wcId);
  if (!wv) return;
  const found = await wv.executeJavaScript(`(() => {
    const pw = [...document.querySelectorAll('input[type=password]')].find(i => i.value) || document.querySelector('input[type=password]');
    const form = pw?.form || document;
    const user = [...form.querySelectorAll('input[type=email], input[autocomplete=username], input[name*=user i], input[name*=email i], input[type=text]')].find(i => i.value && i !== pw);
    return { username: user?.value || '', password: pw?.value || '', url: location.origin, title: document.title };
  })()`).catch(() => null);
  if (!found || !found.password) { toast('Type the password into the page first, then choose Save Password', 'error'); return; }
  const ok = await window.Vault?.ensureUnlocked();
  if (!ok) return;
  const host = (() => { try { return new URL(found.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  await relay.vault.save({ name: host, url: found.url, username: found.username, password: found.password });
  toast(`Saved ${found.username || 'password'} for ${host} to your Vault`);
}

function updateUnread(id, title) {
  const m = String(title).match(/\((\d[\d,]*)\+?(?:\s+unread)?\)/i);
  let n = m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
  if (!n && accountById(id)?.service === 'slack' && /^[*!]\s/.test(String(title))) n = 1; // Slack: "* " unread, "! " mention
  if (state.unread[id] === n) return;
  state.unread[id] = n;
  renderTabs();
  if (PLATFORMS[state.ui.platform]) renderSidebar();
  else if (state.ui.platform === 'home') window.Home?.onUnread?.();
  relay.setBadge(Object.values(state.unread).reduce((x, y) => x + y, 0));
}

// Once signed in, try to pick up the profile photo shown in the provider's header.
async function tryGrabAvatar(id) {
  const a = accountById(id);
  const entry = webviews.get(id);
  if (!a || !entry || a.avatarLocked) return;
  const js = `(() => {
    const sel = [
      'a[href*="SignOutOptions"] img', 'a[aria-label*="Google Account"] img', 'img.gb_P', 'img.gbii',
      '#O365_MainLink_MePhoto img', 'button#mectrl_main_trigger img', '#mectrl_headerPicture', 'div[data-automation-id="meInitialsButton"] img',
      '#ybarAccountMenu img', 'img[alt*="Profile"]', 'img[class*="avatar" i]'
    ];
    for (const s of sel) { const i = document.querySelector(s); if (i && i.src && i.naturalWidth > 8) return i.src.replace(/=s\\d+(-c)?/, '=s160-c'); }
    const bg = document.querySelector('#mectrl_headerPicture, .gb_A');
    if (bg) { const m = getComputedStyle(bg).backgroundImage.match(/url\\("?(.*?)"?\\)/); if (m) return m[1]; }
    return null;
  })()`;
  try {
    const src = await entry.wv.executeJavaScript(js);
    if (src && src !== a.avatar && /^https?:|^data:image/.test(src)) {
      a.avatar = src;
      await relay.saveAccount({ id: a.id, avatar: src });
      renderSidebar();
    }
  } catch { /* page not ready */ }
}

function renderMain() {
  const p = state.ui.platform;
  const empty = $('#empty'), wvs = $('#webviews');
  const sections = { home: $('#home'), calendar: $('#calendar'), vault: $('#vault'), browser: $('#browser'), downloads: $('#downloads'), tracking: $('#tracking'), library: $('#library') };
  Object.entries(sections).forEach(([k, el]) => { el.hidden = k !== p; });
  if (isView(p)) {
    wvs.hidden = true; empty.hidden = true;
    VIEWS[p]()?.render(sections[p]);
    return;
  }
  wvs.hidden = false;
  if (p === 'storage') {
    const items = state.storage || [];
    let sid = state.ui.selected.storage;
    if (!items.find(x => x.id === sid)) sid = state.ui.selected.storage = items[0]?.id;
    $$('.webview-wrap').forEach(w => w.classList.toggle('active', w.dataset.id === sid));
    if (!sid) { empty.hidden = false; window.Cloud?.renderEmpty(empty); return; }
    empty.hidden = true;
    ensureWebview(window.Cloud.surface(sid)).then(({ wrap }) => { if (state.ui.platform === 'storage' && state.ui.selected.storage === sid) wrap.classList.add('active'); });
    Split.layout(sid);
    return;
  }
  const list = accountsFor(p);
  let sel = state.ui.selected[p];
  if (!list.find(a => a.id === sel)) sel = state.ui.selected[p] = list[0]?.id;
  $$('.webview-wrap').forEach(w => w.classList.toggle('active', w.dataset.id === sel));
  if (!sel) {
    const plat = PLATFORMS[p];
    empty.hidden = false;
    empty.style.setProperty('--c', plat.color);
    empty.innerHTML = `
      <div class="empty-icon">${ic('mail', 34)}</div>
      <h2>${p === 'other' ? 'Bring any other inbox into Relay' : `Bring your ${plat.label} inbox into Relay`}</h2>
      <p>${plat.blurb}</p>
      <button class="btn brand lg" id="emptyAdd" style="--c:${plat.color}">${ic('plus', 16)} Add ${plat.label} account</button>`;
    $('#emptyAdd').onclick = () => openAccountModal({ platform: p });
  } else {
    empty.hidden = true;
    ensureWebview(accountById(sel)).then(({ wrap }) => {
      if (state.ui.selected[p] === sel && state.ui.platform === p) wrap.classList.add('active');
    });
  }
  Split.layout(sel || null);
}

function render() {
  renderTabs();
  renderSidebar();
  renderMain();
  window.AI?.updateContext();
  if (PLATFORMS[state.ui.platform] && state.ui.selected[state.ui.platform]) schedulePackageScan(state.ui.selected[state.ui.platform]);
  else hidePackageChip();
}

// Drag-to-reorder for any list (Home inboxes, Storage, …)
function makeSortable(container, selector, attr, onDrop) {
  let dragId = null;
  container.querySelectorAll(selector).forEach(el => {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => { dragId = el.getAttribute(attr); el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/relay-sort', dragId); });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); container.querySelectorAll('.drop-above').forEach(x => x.classList.remove('drop-above')); });
    el.addEventListener('dragover', (e) => { if (!dragId) return; e.preventDefault(); e.stopPropagation(); el.classList.add('drop-above'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop-above'));
    el.addEventListener('drop', (e) => {
      if (!dragId) return;
      e.preventDefault(); e.stopPropagation();
      el.classList.remove('drop-above');
      const target = el.getAttribute(attr);
      if (target === dragId) return;
      const ids = [...container.querySelectorAll(selector)].map(x => x.getAttribute(attr)).filter(i => i !== dragId);
      ids.splice(ids.indexOf(target), 0, dragId);
      dragId = null;
      onDrop(ids);
    });
  });
}

/* ---------- account menu ---------- */
function popMenu(x, y, items) {
  const root = $('#menuRoot');
  root.innerHTML = `<div class="menu">${items.map((it, i) => it === '-' ? '<hr>' :
    it.html ? `<div class="menu-pad">${it.html}</div>` :
    `<button class="${it.danger ? 'danger' : ''}" data-i="${i}">${it.icon ? ic(it.icon, 15) : ''}${esc(it.label)}</button>`).join('')}</div>`;
  const m = root.firstChild;
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.min(x, innerWidth - w - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - h - 8) + 'px';
  $$('button[data-i]', m).forEach(b => b.onclick = () => { closeMenu(); items[+b.dataset.i].onClick?.(); });
  items.forEach(it => it.mount?.(m, closeMenu));
  setTimeout(() => { document.addEventListener('mousedown', outside); document.addEventListener('keydown', onEsc); }, 0);
  function outside(e) { if (!m.contains(e.target)) closeMenu(); }
  function onEsc(e) { if (e.key === 'Escape') closeMenu(); }
  function closeMenu() { root.innerHTML = ''; document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', onEsc); }
  return closeMenu;
}

function accountMenu(id, x, y) {
  const a = accountById(id);
  if (!a) return;
  const chat = a.platform === 'chats';
  popMenu(x, y, [
    { label: chat ? 'Edit chat app…' : 'Edit account…', icon: 'edit', onClick: () => (chat ? openChatModal(a) : openAccountModal(a)) },
    ...(chat ? [] : [{ html: colorPickerHTML(a.color), mount: (m, close) => bindColorPicker(m, async (c) => { await updateAccount(a.id, { color: c }); close(); }) }]),
    '-',
    { label: 'Open in split view', icon: 'columns', onClick: () => window.Split?.openRight(a.id) },
    { label: 'Appearance & ads…', icon: 'palette', onClick: () => window.Skins?.openModal(a) },
    { label: 'Fill password from Vault', icon: 'key', onClick: () => { selectAccount(id); fillFromVault(a); } },
    { label: 'Sign-in troubles…', icon: 'wand', onClick: () => openSignInHelp(a) },
    { label: 'Reload', icon: 'refresh', onClick: () => webviews.get(id)?.wv.reload() },
    { label: 'Open in browser tab', icon: 'globe', onClick: () => window.Browser?.openTab(webviews.get(id)?.wv.getURL() || startUrl(a)) },
    { label: 'Sign out', icon: 'logout', onClick: async () => {
        await relay.signOut(id);
        const e = webviews.get(id); if (e) e.wv.loadURL(startUrl(a));
        toast(`Signed out of ${a.email || a.name}`);
      } },
    '-',
    { label: 'Remove account', icon: 'trash', danger: true, onClick: () => confirmRemove(a) }
  ]);
}

function colorPickerHTML(current) {
  return `<div class="label" style="margin-bottom:8px">Account color</div><div class="swatches">
    ${ACCOUNT_COLORS.map(c => `<button class="swatch ${c.toLowerCase() === String(current).toLowerCase() ? 'active' : ''}" style="--c:${c}" data-color="${c}"></button>`).join('')}
    <label class="swatch custom" title="Custom color"><input type="color" value="${esc(current || '#6d4aff')}"></label>
  </div>`;
}
function bindColorPicker(root, onPick) {
  $$('[data-color]', root).forEach(b => b.onclick = (e) => {
    e.preventDefault();
    $$('[data-color]', root).forEach(x => x.classList.toggle('active', x === b));
    onPick(b.dataset.color);
  });
  const inp = $('.swatch.custom input', root);
  if (inp) inp.onchange = () => onPick(inp.value);
}

async function updateAccount(id, patch) {
  const a = accountById(id);
  Object.assign(a, patch);
  state.accounts = await relay.saveAccount({ id, ...patch });
  render();
}

function confirmRemove(a) {
  openModal({
    title: 'Remove account?',
    subtitle: `${a.email || a.name} will be signed out and removed from Relay. Local calendar events for it are deleted too.`,
    color: 'var(--danger)', icon: 'trash',
    body: '',
    actions: [
      { label: 'Cancel' },
      { label: 'Remove', cls: 'brand', style: '--c:var(--danger)', onClick: async () => {
          state.accounts = await relay.removeAccount(a.id);
          state.events = state.events.filter(e => e.accountId !== a.id);
          const e = webviews.get(a.id); if (e) { e.wrap.remove(); webviews.delete(a.id); }
          delete state.unread[a.id];
          if (state.ui.selected[a.platform] === a.id) state.ui.selected[a.platform] = accountsFor(a.platform)[0]?.id;
          render();
          toast('Account removed');
        } }
    ]
  });
}

/* ---------- modal framework ---------- */
function openModal({ title, subtitle = '', color = 'var(--accent)', icon = 'mail', body, actions = [], wide = false, onMount, left = '' }) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal ${wide ? 'wide' : ''}" role="dialog" style="--c:${color}">
      <div class="modal-head">
        <div class="modal-badge">${ic(icon, 20)}</div>
        <div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
        <button class="icon-btn" data-close title="Close">${ic('x', 16)}</button>
      </div>
      ${body !== '' ? `<div class="modal-body">${body}</div>` : ''}
      <div class="modal-foot">${left}<span class="spacer"></span>${actions.map((a, i) => `<button class="btn ${a.cls || ''}" style="${a.style || ''}" data-act="${i}">${esc(a.label)}</button>`).join('')}</div>
    </div></div>`;
  const modal = $('.modal', root);
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $('[data-close]', root).onclick = close;
  $('.modal-backdrop', root).onmousedown = (e) => { if (e.target.classList.contains('modal-backdrop')) close(); };
  $$('[data-act]', root).forEach(b => b.onclick = async () => {
    const a = actions[+b.dataset.act];
    if (a.onClick) { const r = await a.onClick(modal); if (r === false) return; }
    close();
  });
  onMount?.(modal, close);
  setTimeout(() => $('input:not([type=color]):not([type=checkbox]), textarea', modal)?.focus(), 30);
  return { modal, close };
}

/* ---------- add / edit a chat app ---------- */
function openChatModal(existing) {
  const isEdit = !!existing.id;
  const draft = { id: existing.id || uid(), platform: 'chats', service: existing.service || '', name: existing.name || '', email: existing.email || '',
    teamsType: existing.teamsType || 'work', linkedAccountId: existing.linkedAccountId || '', partition: existing.partition || '', adblock: false,
    color: existing.color || '#0ea5e9', skin: existing.skin || 'original' };
  const groups = ['Work', 'Social'];
  const svcGrid = () => groups.map(g => `<div class="label" style="margin:4px 0 8px">${g}</div><div class="svc-grid">${Object.entries(CHAT_SERVICES).filter(([, v]) => v.group === g).map(([k, v]) => `
      <button class="svc-pick ${draft.service === k ? 'on' : ''}" data-svc="${k}"><span class="svc-tile" style="--sv:${v.color}"><span>${esc(v.abbr)}</span></span><b>${esc(v.label)}</b></button>`).join('')}</div>`).join('');
  const linkOptions = () => {
    const sv = CHAT_SERVICES[draft.service];
    if (!sv?.link) return '';
    const list = accountsFor(sv.link);
    if (!list.length) return '';
    const what = sv.link === 'gmail' ? 'Google' : 'Microsoft';
    return `<div class="field"><label>Use a sign-in you already have</label>
      <select class="select" id="cLink"><option value="">No — sign in separately</option>${list.map(a => `<option value="${a.id}" ${draft.linkedAccountId === a.id ? 'selected' : ''}>${esc(a.name || a.email)} (${esc(a.email || PLATFORMS[a.platform].label)})</option>`).join('')}</select>
      <div class="hint">Shares that ${what} account’s session, so you don’t sign in twice.</div></div>`;
  };
  const extra = () => !draft.service ? '<div class="hint">Pick a chat app above.</div>' : `
    ${draft.service === 'teams' ? `<div class="field"><label>Teams account</label><div class="seg wide" id="cTeams">
      <button data-v="work" class="${draft.teamsType === 'work' ? 'active' : ''}">Work or school</button><button data-v="personal" class="${draft.teamsType === 'personal' ? 'active' : ''}">Personal (Teams free)</button></div></div>` : ''}
    <div class="row"><div class="field"><label>Name in Relay</label><input class="input" id="cName" placeholder="${esc(CHAT_SERVICES[draft.service].label)}" value="${esc(draft.name)}"></div>
      <div class="field"><label>Account (optional)</label><input class="input" id="cEmail" placeholder="you@work.com or phone" value="${esc(draft.email)}"></div></div>
    ${linkOptions()}
    ${draft.service === 'whatsapp' ? '<div class="hint">WhatsApp links to your phone: scan the QR code with WhatsApp → Linked devices. Your phone doesn’t need to stay online afterwards.</div>' : ''}`;
  openModal({
    title: isEdit ? 'Edit chat app' : 'Add a chat app', subtitle: isEdit ? '' : 'Each app runs its own web version in a private session. Sign in once and it stays signed in.',
    icon: 'chat', color: 'var(--chats)', wide: true,
    body: `<div id="cSvc">${svcGrid()}</div><div id="cExtra" style="display:flex;flex-direction:column;gap:14px;margin-top:6px">${extra()}</div>`,
    actions: [{ label: 'Cancel' }, { label: isEdit ? 'Save' : 'Add & sign in', cls: 'brand', onClick: async (m) => {
      if (!draft.service) { toast('Pick a chat app first', 'error'); return false; }
      draft.name = $('#cName', m)?.value.trim() || CHAT_SERVICES[draft.service].label;
      draft.email = $('#cEmail', m)?.value.trim() || '';
      const link = $('#cLink', m)?.value || '';
      draft.linkedAccountId = link;
      draft.partition = link ? 'persist:relay-' + link : '';
      draft.color = CHAT_SERVICES[draft.service].color;
      const urlChanged = isEdit && (existing.teamsType !== draft.teamsType || existing.service !== draft.service || existing.partition !== draft.partition);
      if (urlChanged) { delete draft.lastUrl; draft.favicon = ''; }
      state.accounts = await relay.saveAccount(draft);
      if (urlChanged) { const e = webviews.get(draft.id); if (e) { e.wrap.remove(); webviews.delete(draft.id); } }
      state.ui.platform = 'chats'; state.ui.selected.chats = draft.id;
      relay.saveUI({ platform: 'chats', selected: state.ui.selected });
      render();
      if (!isEdit) toast(`Sign in to ${CHAT_SERVICES[draft.service].label} to finish`);
    } }],
    onMount: (m) => {
      const bind = () => {
        $$('[data-svc]', m).forEach(b => b.onclick = () => { draft.service = b.dataset.svc; if (!isEdit) draft.name = ''; $('#cSvc', m).innerHTML = svcGrid(); $('#cExtra', m).innerHTML = extra(); bind(); });
        $$('#cTeams button', m).forEach(b => b.onclick = () => { draft.teamsType = b.dataset.v; $$('#cTeams button', m).forEach(x => x.classList.toggle('active', x === b)); });
      };
      bind();
    }
  });
}

/* ---------- add / edit account ---------- */
function openAccountModal(existing) {
  const isEdit = !!existing.id;
  const platform = existing.platform || state.ui.platform;
  const plat = PLATFORMS[platform];
  const draft = {
    id: existing.id || uid(),
    platform,
    name: existing.name || '',
    email: existing.email || '',
    color: existing.color || ACCOUNT_COLORS[(state.accounts.length * 5) % ACCOUNT_COLORS.length],
    avatar: existing.avatar || '',
    avatarLocked: existing.avatarLocked || false,
    outlookType: existing.outlookType || 'personal',
    provider: existing.provider || 'icloud',
    url: existing.url || OTHER_PRESETS[0].url,
    providerLabel: existing.providerLabel || '',
    icsUrl: existing.icsUrl || '',
    // Yahoo's sign-in breaks with ad blocking on; chat apps don't need it
    adblock: existing.adblock ?? ((platform === 'yahoo' || platform === 'chats') ? false : undefined)
  };

  const otherFields = platform === 'other' ? `
    <div class="field"><label>Provider</label>
      <select class="select" id="fProvider">${OTHER_PRESETS.map(p => `<option value="${p.id}" ${p.id === draft.provider ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div>
    <div class="field"><label>Webmail URL</label><input class="input" id="fUrl" placeholder="https://mail.example.com" value="${esc(draft.url)}"></div>` : '';
  const outlookFields = platform === 'outlook' ? `
    <div class="field"><label>Account type</label>
      <div class="seg wide" id="fOutlookType">
        <button data-v="personal" class="${draft.outlookType === 'personal' ? 'active' : ''}">Personal (Outlook.com, Hotmail)</button>
        <button data-v="work" class="${draft.outlookType === 'work' ? 'active' : ''}">Work or school</button>
      </div></div>` : '';

  const icsHelp = {
    gmail: 'Google Calendar → Settings → pick your calendar → “Secret address in iCal format”.',
    outlook: 'Outlook → Settings → Calendar → Shared calendars → Publish a calendar → copy the ICS link.',
    yahoo: 'Yahoo Calendar → hover a calendar → ⋯ → Share → copy the “ICS” link.',
    other: 'Look for “Share”, “Publish” or “Subscribe” in your calendar settings and copy the .ics link.'
  }[platform];

  openModal({
    title: isEdit ? `Edit ${plat.label} account` : `Add ${plat.label} account`,
    subtitle: isEdit ? '' : 'You’ll sign in on the next screen. Relay never sees your password.',
    color: plat.color,
    icon: 'mail',
    body: `
      <div class="avatar-picker">
        <div id="fAvatarPrev">${avatarHTML(draft, 'lg')}</div>
        <div class="field" style="flex:1">
          <label>Profile picture</label>
          <div class="actions">
            <button class="btn" id="fPickImg">${ic('image', 15)} Choose image…</button>
            <button class="btn ghost" id="fGravatar" title="Look up your Gravatar">${ic('user', 15)} Gravatar</button>
            <button class="btn ghost" id="fClearImg">Reset</button>
          </div>
          <div class="hint">Left on default, Relay picks up your photo after you sign in.</div>
        </div>
      </div>
      <div class="row">
        <div class="field"><label>Display name</label><input class="input" id="fName" placeholder="Work, Personal…" value="${esc(draft.name)}"></div>
        <div class="field"><label>Email address</label><input class="input" id="fEmail" placeholder="you@example.com" value="${esc(draft.email)}"></div>
      </div>
      ${outlookFields}${otherFields}
      <div class="field"><label>Color</label><div id="fColor">${colorPickerHTML(draft.color).replace(/^<div class="label"[^>]*>Account color<\/div>/, '')}</div></div>
      <div class="field"><label>Calendar feed (optional)</label>
        <div class="row" style="gap:6px"><input class="input" id="fIcs" placeholder="Paste the .ics link — e.g. Google’s “Secret address in iCal format”" value="${esc(draft.icsUrl)}" style="flex:1">
          <button class="btn ghost" id="fIcsTest" title="Check the link">Test</button></div>
        <div class="hint" id="fIcsMsg">Shows this account’s events in the Relay calendar. ${icsHelp} ${platform !== 'other' ? `<a id="fIcsFind" class="link">Open my calendar settings</a>` : ''}</div></div>`,
    actions: [
      { label: 'Cancel' },
      { label: isEdit ? 'Save' : 'Add & sign in', cls: 'brand', onClick: async (m) => {
          draft.name = $('#fName', m).value.trim();
          draft.email = $('#fEmail', m).value.trim();
          draft.icsUrl = $('#fIcs', m).value.trim();
          if (platform === 'other') {
            draft.url = $('#fUrl', m).value.trim();
            if (draft.url && !/^https?:\/\//.test(draft.url)) draft.url = 'https://' + draft.url;
            if (!draft.url) { toast('Add a webmail URL', 'error'); return false; }
            const pre = OTHER_PRESETS.find(p => p.id === draft.provider);
            draft.providerLabel = pre && pre.id !== 'custom' ? pre.label : new URL(draft.url).hostname;
          }
          if (!draft.name && !draft.email) draft.name = platform === 'other' ? draft.providerLabel : plat.label;
          const urlChanged = isEdit && (existing.url !== draft.url || existing.outlookType !== draft.outlookType);
          state.accounts = await relay.saveAccount(draft);
          if (urlChanged) { const e = webviews.get(draft.id); if (e) e.wv.loadURL(startUrl(draft)); }
          state.ui.platform = platform;
          state.ui.selected[platform] = draft.id;
          relay.saveUI({ platform, selected: state.ui.selected });
          render();
          window.Calendar?.invalidate(draft.id);
          if (!isEdit) toast(`Sign in to ${draft.email || plat.label} to finish`);
        } }
    ],
    onMount: (m) => {
      const refreshPrev = () => {
        draft.name = $('#fName', m).value; draft.email = $('#fEmail', m).value;
        $('#fAvatarPrev', m).innerHTML = avatarHTML(draft, 'lg');
      };
      $('#fName', m).oninput = refreshPrev;
      $('#fEmail', m).oninput = refreshPrev;
      bindColorPicker($('#fColor', m), (c) => { draft.color = c; refreshPrev(); });
      $('#fPickImg', m).onclick = async () => {
        const data = await relay.pickImage();
        if (data) { draft.avatar = await shrinkImage(data); draft.avatarLocked = true; refreshPrev(); }
      };
      $('#fGravatar', m).onclick = async () => {
        const email = $('#fEmail', m).value.trim();
        if (!email) return toast('Enter the email first', 'error');
        const url = await relay.gravatar(email);
        const img = new Image();
        img.onload = () => { draft.avatar = url; draft.avatarLocked = true; refreshPrev(); };
        img.onerror = () => toast('No Gravatar found for that email');
        img.src = url;
      };
      $('#fClearImg', m).onclick = () => { draft.avatar = ''; draft.avatarLocked = false; refreshPrev(); };
      $('#fIcsTest', m).onclick = async () => {
        const msg = $('#fIcsMsg', m), url = $('#fIcs', m).value.trim();
        if (!url) { msg.textContent = 'Paste the link first.'; return; }
        msg.innerHTML = `${ic('refresh', 12, 'spin-ic')} Checking…`;
        try {
          const r = await relay.testCalendar({ url, accountId: isEdit ? draft.id : null });
          $('#fIcs', m).value = r.url;
          msg.innerHTML = `<span style="color:var(--ok)">${ic('check', 12)} Works${r.name ? ` — “${esc(r.name)}”` : ''}, ${r.events} event${r.events === 1 ? '' : 's'} found.</span>`;
        } catch (e) { msg.innerHTML = `<span style="color:var(--danger)">${esc(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))}</span>`; }
      };
      $('#fIcsFind', m)?.addEventListener('click', async () => {
        if (!isEdit) { toast('Add the account and sign in first, then come back here'); return; }
        await relay.findCalendarLink({ accountId: draft.id, platform, outlookType: draft.outlookType });
        toast(platform === 'gmail' ? 'Pick your calendar → Integrate calendar → copy “Secret address in iCal format”' : platform === 'outlook' ? 'Publish a calendar → choose “Can view all details” → copy the ICS link' : 'Share → copy the ICS link');
      });
      const seg = $('#fOutlookType', m);
      if (seg) $$('button', seg).forEach(b => b.onclick = () => { draft.outlookType = b.dataset.v; $$('button', seg).forEach(x => x.classList.toggle('active', x === b)); });
      const prov = $('#fProvider', m);
      if (prov) prov.onchange = () => {
        draft.provider = prov.value;
        const pre = OTHER_PRESETS.find(p => p.id === prov.value);
        $('#fUrl', m).value = pre.url;
        if (!pre.url) $('#fUrl', m).focus();
      };
    }
  });
}

function shrinkImage(dataUrl, size = 160) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const s = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      res(c.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
  });
}

/* ---------- settings ---------- */
function openSettings(tab = 'general') {
  const s = state.settings;
  const tabs = { general: 'General', ai: 'AI plugins', accounts: 'Accounts' };
  const body = `
    <div class="settings-nav" id="sNav">${Object.entries(tabs).map(([k, v]) => `<button data-t="${k}" class="${k === tab ? 'active' : ''}">${v}</button>`).join('')}</div>
    <div id="sPane" style="display:flex;flex-direction:column;gap:16px"></div>`;
  const panes = {
    general: () => `
      <div class="field"><label>Your name</label><input class="input" id="sName" placeholder="Used in your Home greeting" value="${esc(s.userName || '')}"></div>
      <div class="field"><label>Appearance</label>
        <div class="seg" id="sTheme">${['dark', 'light', 'system'].map(t => `<button data-v="${t}" class="${(s.theme || 'dark') === t ? 'active' : ''}">${t === 'system' ? 'Match Mac' : t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
      <div class="field"><label>Colors</label>
        <div class="look-cards" id="sLook">
          <button class="look-card ${s.look !== 'legacy' ? 'on' : ''}" data-look="relay"><span class="look-prev"><i style="background:${esc(accentColor())}"></i><i style="background:#24202f"></i><i style="background:#24202f"></i></span><b>Relay</b><small>One accent color across the whole app. Calm and focused.</small></button>
          <button class="look-card ${s.look === 'legacy' ? 'on' : ''}" data-look="legacy"><span class="look-prev"><i style="background:#ff4d3d"></i><i style="background:#1f7bff"></i><i style="background:#7a2cff"></i><i style="background:#10b5a0"></i><i style="background:#ff9a1f"></i></span><b>Legacy colors</b><small>The original colorful look — every tab has its own color.</small></button>
        </div>
        <div class="accent-row" id="sAccent" ${s.look === 'legacy' ? 'hidden' : ''}>${ACCENTS.map(([c, n]) => `<button class="accent-sw ${accentColor().toLowerCase() === c ? 'on' : ''}" style="--c:${c}" data-c="${c}" title="${n}"></button>`).join('')}
          <label class="accent-sw custom ${ACCENTS.some(([c]) => c === accentColor().toLowerCase()) ? '' : 'on'}" style="--c:${esc(accentColor())}" title="Any color"><input type="color" id="sAccentCustom" value="${esc(accentColor())}"></label></div></div>
      <div class="field"><label>Inboxes</label>
        <label class="prop-col"><span>Inbox style</span><select class="select" id="sInbox">${[['match', 'Match Relay — purple & black when Relay is dark'], ['relaydark', 'Relay dark (purple & black) always'], ['relay', 'Light with Relay accents'], ['original', 'Original — exactly as the provider designed it']].map(([v, l]) => `<option value="${v}" ${(s.inboxStyle || 'match') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="hint">Applies to every mail account that doesn’t have its own style (right-click an account → Appearance & ads). If you’ve turned on Gmail’s or Outlook’s own dark theme, Relay leaves it alone.</div></div>
      <div class="field"><label>Links & browsing</label>
        <div class="row">
          <label class="prop-col"><span>Open links from email in</span><select class="select" id="sLinks"><option value="relay" ${s.openLinksIn !== 'external' ? 'selected' : ''}>Relay browser</option><option value="external" ${s.openLinksIn === 'external' ? 'selected' : ''}>My default browser</option></select></label>
          <label class="prop-col"><span>Search engine</span><select class="select" id="sEngine">${[['google', 'Google'], ['duckduckgo', 'DuckDuckGo'], ['bing', 'Bing']].map(([v, l]) => `<option value="${v}" ${(s.searchEngine || 'google') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div></div>
      <div class="field"><label>Ad & tracker blocking</label>
        <label class="check"><input type="checkbox" id="sAdMail" ${s.adblockMail !== false ? 'checked' : ''}> Block ads in mail and storage accounts</label>
        <label class="check"><input type="checkbox" id="sAdBrowser" ${s.adblockBrowser !== false ? 'checked' : ''}> Block ads in the Relay browser</label>
        <div class="hint">Uses the same filter lists as uBlock Origin (EasyList + trackers), updated every few days. You can also switch it per account under Appearance & ads.</div></div>
      <div class="field"><label>Calendar</label>
        <label class="check"><input type="checkbox" id="sMonday" ${s.weekStartsMonday ? 'checked' : ''}> Start weeks on Monday</label></div>
      <div class="field"><label>Keyboard shortcuts</label>
        <div class="hint">⌘1 Home · ⌘2–⌘5 mail · ⌘6 Calendar · ⌘7 Storage · ⌘8 Browser · ⌘9 Vault · ⌘B briefing · ⌘T new task (new tab in Browser) · ⌘⇧N incognito tab · ⌘L address bar · ⌘F find · ⌘W close tab · ⌘J assistant · ⌘N add account · ⌘R reload</div></div>`,
    ai: () => `
      <div class="field"><label>How the Assistant works</label>
        <div class="seg wide" id="sAiMode">${[['web', 'Free accounts'], ['api', 'API keys'], ['assist', 'Assist (offline)']].map(([v, l]) => `<button data-v="${v}" class="${(s.aiMode || 'web') === v ? 'active' : ''}">${l}</button>`).join('')}</div>
        <div class="hint"><b>Free accounts</b> opens Claude, ChatGPT, Gemini or Copilot right in the panel with your own login (free plans work) — Relay pastes in the email you’re reading and puts replies back into your draft. <b>API keys</b> are for people who have one. <b>Assist</b> drafts replies on this computer with no account at all.</div></div>
      <div class="provider-card">
        <div class="ph"><span class="ai-mark claude"></span>Claude <span style="margin-left:auto">${s.hasClaudeKey ? `<span class="key-status">${ic('check', 13)} Key saved</span>` : ''}</span></div>
        <div class="field"><label>Anthropic API key</label>
          <input class="input" type="password" id="sClaudeKey" placeholder="${s.hasClaudeKey ? '•••••••••••• (leave blank to keep)' : 'sk-ant-…'}">
          <div class="hint">Get a key at <a data-href="https://console.anthropic.com/settings/keys">console.anthropic.com</a>. Stored encrypted in your macOS keychain.</div></div>
        <div class="field"><label>Model</label><input class="input" id="sClaudeModel" value="${esc(s.claudeModel)}"></div>
      </div>
      <div class="provider-card">
        <div class="ph"><span class="ai-mark gpt"></span>ChatGPT <span style="margin-left:auto">${s.hasOpenaiKey ? `<span class="key-status">${ic('check', 13)} Key saved</span>` : ''}</span></div>
        <div class="field"><label>OpenAI API key</label>
          <input class="input" type="password" id="sOpenaiKey" placeholder="${s.hasOpenaiKey ? '•••••••••••• (leave blank to keep)' : 'sk-…'}">
          <div class="hint">Get a key at <a data-href="https://platform.openai.com/api-keys">platform.openai.com</a>.</div></div>
        <div class="field"><label>Model</label><input class="input" id="sOpenaiModel" value="${esc(s.openaiModel)}"></div>
      </div>
      <div class="provider-card">
        <div class="ph"><span class="ai-mark assist"></span>Assist <span class="muted-sm" style="margin-left:6px">offline · your app</span>
          <label class="switch" style="margin-left:auto" title="Use Assist in Relay"><input type="checkbox" id="sAssistOn" ${s.assistEnabled !== false ? 'checked' : ''}><span></span></label></div>
        <div class="assist-status" id="sAssistStatus">${ic('refresh', 13, 'spin-ic')} Looking for Assist…</div>
        <div class="hint">Drafts replies to the email you have open with your own Assist app, on this computer — no API key, nothing sent anywhere. Choose <b>Assist</b> at the top of the Assistant panel, or right-click selected text → <b>Draft a Reply with Assist</b>. Relay starts Assist in the background when it’s needed.</div>
        <div class="row" style="gap:8px"><button class="btn ghost" id="sAssistOpen">${ic('external', 14)} Open Assist</button><button class="btn ghost" id="sAssistCheck">${ic('refresh', 14)} Check again</button></div>
      </div>`,
    accounts: () => state.accounts.length ? state.accounts.map(a => `
      <div class="account" data-edit="${a.id}" style="--c:${esc(a.color)}">
        ${avatarHTML(a)}
        <div class="meta"><div class="name">${esc(a.name || a.email)}</div><div class="email">${PLATFORMS[a.platform].label} · ${esc(a.email || a.url || '')}</div></div>
        <button class="btn ghost" data-edit-btn="${a.id}">${ic('edit', 14)} Edit</button>
      </div>`).join('') : '<div class="hint">No accounts yet.</div>'
  };
  let current = tab;
  openModal({
    title: 'Settings', icon: 'settings', wide: true, color: 'var(--text)',
    body,
    actions: [{ label: 'Done', cls: 'primary', onClick: async (m) => {
      if (current === 'ai') await saveAIFields(m);
    } }],
    onMount: (m, close) => {
      const show = (t) => {
        if (current === 'ai' && t !== 'ai') saveAIFields(m);
        current = t;
        $$('#sNav button', m).forEach(b => b.classList.toggle('active', b.dataset.t === t));
        $('#sPane', m).innerHTML = panes[t]();
        bindPane(t, m, close);
      };
      $$('#sNav button', m).forEach(b => b.onclick = () => show(b.dataset.t));
      $('#sPane', m).innerHTML = panes[tab]();
      bindPane(tab, m, close);
    }
  });

  function bindPane(t, m, close) {
    $$('a[data-href]', m).forEach(a => a.onclick = () => relay.openExternal(a.dataset.href));
    if (t === 'general') {
      $$('#sTheme button', m).forEach(b => b.onclick = async () => {
        $$('#sTheme button', m).forEach(x => x.classList.toggle('active', x === b));
        state.settings = await relay.saveSettings({ theme: b.dataset.v });
        applyTheme();
        window.Skins?.reapplyAll();
      });
      const setLook = async (patch) => {
        state.settings = await relay.saveSettings(patch);
        applyTheme(); renderTabs(); render(); window.AI?.render(); window.Skins?.reapplyAll();
        $$('#sLook .look-card', m).forEach(x => x.classList.toggle('on', x.dataset.look === (state.settings.look === 'legacy' ? 'legacy' : 'relay')));
        $('#sAccent', m).hidden = state.settings.look === 'legacy';
        $$('#sAccent .accent-sw', m).forEach(x => x.classList.toggle('on', (x.dataset.c || '') === accentColor().toLowerCase() || (!x.dataset.c && !ACCENTS.some(([c]) => c === accentColor().toLowerCase()))));
        $$('#sLook .look-card[data-look="relay"] .look-prev i', m)[0].style.background = accentColor();
      };
      $$('#sLook .look-card', m).forEach(b => b.onclick = () => setLook({ look: b.dataset.look }));
      $$('#sAccent [data-c]', m).forEach(b => b.onclick = () => setLook({ accent: b.dataset.c }));
      let ct; $('#sAccentCustom', m).oninput = (e) => { clearTimeout(ct); const v = e.target.value; ct = setTimeout(() => setLook({ accent: v }), 120); };
      $('#sInbox', m).onchange = async (e) => { state.settings = await relay.saveSettings({ inboxStyle: e.target.value }); window.Skins?.reapplyAll(); };
      $('#sName', m).onchange = async (e) => { state.settings = await relay.saveSettings({ userName: e.target.value.trim() }); if (state.ui.platform === 'home') render(); };
      $('#sLinks', m).onchange = async (e) => { state.settings = await relay.saveSettings({ openLinksIn: e.target.value }); };
      $('#sEngine', m).onchange = async (e) => { state.settings = await relay.saveSettings({ searchEngine: e.target.value }); if (state.ui.platform === 'browser') render(); };
      $('#sAdMail', m).onchange = async (e) => { state.settings = await relay.saveSettings({ adblockMail: e.target.checked }); webviews.forEach(({ wv }) => wv.reload()); toast(e.target.checked ? 'Ad blocking on for mail & storage' : 'Ad blocking off for mail & storage'); };
      $('#sAdBrowser', m).onchange = async (e) => { state.settings = await relay.saveSettings({ adblockBrowser: e.target.checked }); toast('Reload browser tabs to apply'); };
      $('#sMonday', m).onchange = async (e) => {
        state.settings = await relay.saveSettings({ weekStartsMonday: e.target.checked });
        window.Calendar?.refresh();
      };
    }
    if (t === 'ai') {
      $$('#sAiMode button', m).forEach(b => b.onclick = async () => {
        $$('#sAiMode button', m).forEach(x => x.classList.toggle('active', x === b));
        state.settings = await relay.saveSettings({ aiMode: b.dataset.v, ...(b.dataset.v === 'assist' ? { aiProvider: 'assist' } : b.dataset.v === 'api' && state.settings.aiProvider === 'assist' ? { aiProvider: 'claude' } : {}) });
        window.AI?.render();
      });
      const showStatus = async (start = false) => {
        const box = $('#sAssistStatus', m); if (!box) return;
        box.innerHTML = `${ic('refresh', 13, 'spin-ic')} ${start ? 'Starting Assist…' : 'Looking for Assist…'}`;
        const st = await relay.assist.status({ start }).catch(() => null);
        if (!$('#sAssistStatus', m)) return;
        const dot = (c) => `<span class="ac-dot ${c}" style="width:8px;height:8px;border-radius:50%;display:inline-block;background:${c === 'on' ? '#16a34a' : c === 'warn' ? '#f59e0b' : 'var(--muted)'}"></span>`;
        box.innerHTML = !st ? `${dot('warn')} Couldn’t check Assist`
          : st.installed === false ? `${dot('warn')} Assist isn’t installed on this computer — install it from the Utility Suite`
          : st.code === 'disabled' || st.assistEnabled === false ? `${dot('warn')} Assist is running, but “Let my other apps use Assist” is off in its Settings`
          : st.running && st.downloaded === false ? `${dot('warn')} Connected — open Assist once to download its AI model`
          : st.running ? `${dot('on')} Connected · Assist ${esc(st.version || '')} · ${esc(st.modelName || '')} model${st.ready ? ' (loaded)' : ''}`
          : st.error ? `${dot('warn')} ${esc(st.error)}`
          : `${dot('')} Installed · Relay starts it when you ask for a draft`;
      };
      showStatus();
      $('#sAssistCheck', m).onclick = () => showStatus(true);
      $('#sAssistOpen', m).onclick = () => relay.assist.open().then(ok => { if (!ok) toast('Assist isn’t installed on this computer', 'error'); });
      $('#sAssistOn', m).onchange = async (e) => { state.settings = await relay.saveSettings({ assistEnabled: e.target.checked }); window.AI?.render(); toast(e.target.checked ? 'Assist is on' : 'Assist is off'); };
    }
    if (t === 'accounts') {
      $$('[data-edit-btn]', m).forEach(b => b.onclick = () => { close(); openAccountModal(accountById(b.dataset.editBtn)); });
    }
  }
  async function saveAIFields(m) {
    const patch = {};
    const ck = $('#sClaudeKey', m)?.value.trim(), ok = $('#sOpenaiKey', m)?.value.trim();
    if (ck) patch.claudeKey = ck;
    if (ok) patch.openaiKey = ok;
    const cm = $('#sClaudeModel', m)?.value.trim(), om = $('#sOpenaiModel', m)?.value.trim();
    if (cm) patch.claudeModel = cm;
    if (om) patch.openaiModel = om;
    if (Object.keys(patch).length) {
      state.settings = await relay.saveSettings(patch);
      window.AI?.render();
      if (ck || ok) toast('API key saved');
    }
  }
}

/* ---------- packages in emails ---------- */
// When you open a shipping email, Relay spots the tracking number and offers to track it.
const pkgDismissed = new Set();
const scanTimers = new Map();
function schedulePackageScan(id) {
  clearTimeout(scanTimers.get(id));
  scanTimers.set(id, setTimeout(() => scanForPackages(id), 1400));
}
async function scanForPackages(id) {
  const a = accountById(id);
  const wv = webviews.get(id)?.wv;
  if (!a || !wv || state.ui.platform !== a.platform || state.ui.selected[a.platform] !== id || !window.Carriers) return;
  const js = `(() => {
    const bodies = [...document.querySelectorAll('.a3s, [aria-label="Message body"], [aria-label="Reading Pane"] [role="document"], div[autoid*="ReadingPane"], [data-test-id="message-view-body-content"], .XbIp4')];
    if (!bodies.length) return null;
    const q = (s) => (document.querySelector(s) || {}).innerText || '';
    return {
      subject: q('h2.hP, [data-test-id="message-group-subject-text"], [role="heading"][aria-level="2"]').trim(),
      from: ((document.querySelector('.gD[name]') || {}).getAttribute?.('name')) || q('[data-test-id="message-from"], .OZZZK').trim(),
      text: bodies.map(b => b.innerText).join('\\n').slice(0, 20000),
      hrefs: bodies.flatMap(b => [...b.querySelectorAll('a[href]')].map(x => x.href)).slice(0, 500)
    };
  })()`;
  const r = await wv.executeJavaScript(js).catch(() => null);
  if (!r) return hidePackageChip(id);
  // unwrap Gmail / Outlook link redirectors
  const hrefs = r.hrefs.map(h => { try { const u = new URL(h); return u.searchParams.get('q') || u.searchParams.get('url') || u.searchParams.get('u') || h; } catch { return h; } });
  const found = window.Carriers.findInText(r.text, hrefs).filter(f => !window.Tracking?.isTracked(f.number) && !pkgDismissed.has(f.number));
  if (!found.length) return hidePackageChip(id);
  showPackageChip(a, found, r);
}
function showPackageChip(a, found, email) {
  let chip = $('#pkgChip');
  if (!chip) { chip = document.createElement('div'); chip.id = 'pkgChip'; chip.className = 'pkg-chip'; $('#main').appendChild(chip); }
  chip.dataset.acct = a.id;
  const C = window.Carriers;
  const first = found[0];
  const eta = window.Tracking?.extractEta(email.text);
  chip.innerHTML = `<span class="pc-ic">${ic('box', 18)}</span>
    <span class="pc-t"><b>${found.length > 1 ? `${found.length} packages in this email` : `${C.info(first.carrier).name} package in this email`}</b>
    <small>${found.length > 1 ? found.map(f => C.info(f.carrier).name).join(', ') : first.number}${eta ? ` · arriving ${eta.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}</small></span>
    <button class="btn brand" id="pcTrack" style="--c:var(--tracking)">${ic('plus', 14)} Track ${found.length > 1 ? 'all' : 'it'}</button>
    <button class="icon-btn sm" id="pcX" title="Not now">${ic('x', 14)}</button>`;
  chip.hidden = false;
  $('#pcTrack', chip).onclick = async () => {
    $('#pcTrack', chip).disabled = true;
    for (const f of found) await window.Tracking.addFromEmail({ ...f, text: email.text, subject: email.subject, from: email.from, accountId: a.id });
    hidePackageChip();
    toast(found.length > 1 ? `Tracking ${found.length} packages` : 'Package added to Tracking', '', { label: 'View', onClick: () => setPlatform('tracking') });
  };
  $('#pcX', chip).onclick = () => { found.forEach(f => pkgDismissed.add(f.number)); hidePackageChip(); };
}
function hidePackageChip(id) {
  const chip = $('#pkgChip');
  if (chip && (!id || chip.dataset.acct === id)) chip.hidden = true;
}

/* ---------- drop files onto Relay ---------- */
const MEDIA_RE = /\.(mp4|m4v|mov|webm|mkv|mp3|m4a|aac|wav|flac|ogg|oga|opus)$/i;
const READ_RE = /\.(cbz|zip|pdf|jpe?g|png|gif|webp|avif|bmp)$/i;
document.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); document.body.classList.add('dropping'); } });
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
document.addEventListener('drop', async (e) => {
  document.body.classList.remove('dropping');
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  const paths = files.map(f => relay.pathForFile(f)).filter(Boolean);
  const media = paths.filter(p => MEDIA_RE.test(p));
  if (media.length) return window.Player?.open(media.map(src => ({ src })));
  const read = paths.find(p => READ_RE.test(p));
  if (read) return window.Reader?.open(read);
  const st = paths[0] && await relay.media.stat(paths[0]);
  if (st?.dir) return window.Reader?.open(paths[0]);
  toast('Drop videos, music, images, comics (.cbz) or PDFs to open them in Relay', 'error');
});

/* ---------- find in page ---------- */
function activeWebview() {
  const p = state.ui.platform;
  const sw = Split.focusedWebview(); if (sw) return sw;
  if (p === 'browser') return window.Browser?.activeWebview();
  if (p === 'storage') return webviews.get(state.ui.selected.storage)?.wv || null;
  if (PLATFORMS[p]) return webviews.get(state.ui.selected[p])?.wv || null;
  return null;
}
let findWv = null;
function openFind() {
  const wv = activeWebview();
  if (!wv) return;
  let bar = $('#findBar');
  if (!bar) {
    bar = document.createElement('form');
    bar.id = 'findBar'; bar.className = 'find-bar';
    bar.innerHTML = `${ic('search', 15)}<input id="findInput" placeholder="Find on page" autocomplete="off"><span id="findCount"></span>
      <button type="button" class="icon-btn sm" id="findPrev" title="Previous">${ic('chevronLeft', 15)}</button>
      <button type="button" class="icon-btn sm" id="findNext" title="Next">${ic('chevronRight', 15)}</button>
      <button type="button" class="icon-btn sm" id="findClose" title="Close (Esc)">${ic('x', 14)}</button>`;
    $('#main').appendChild(bar);
    const inp = $('#findInput');
    // Electron: findNext=true starts a new search, false moves to the next match of the current one
    const go = (forward, newSearch) => { if (!findWv) return; if (!inp.value) { findWv.stopFindInPage('clearSelection'); $('#findCount').textContent = ''; return; } findWv.findInPage(inp.value, { forward, findNext: newSearch }); };
    inp.oninput = () => go(true, true);
    bar.onsubmit = (e) => { e.preventDefault(); go(true, false); };
    inp.onkeydown = (e) => { if (e.key === 'Escape') closeFind(); if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); go(false, false); } };
    $('#findPrev').onclick = () => go(false, false);
    $('#findNext').onclick = () => go(true, false);
    $('#findClose').onclick = closeFind;
  }
  if (findWv && findWv !== wv) { try { findWv.stopFindInPage('clearSelection'); } catch {} }
  findWv = wv;
  if (!wv.__findBound) { wv.addEventListener('found-in-page', (e) => updateFindCount(e.result)); wv.__findBound = true; }
  bar.hidden = false;
  $('#findInput').focus(); $('#findInput').select();
}
function closeFind() {
  const bar = $('#findBar');
  if (bar) bar.hidden = true;
  try { findWv?.stopFindInPage('clearSelection'); } catch {}
  findWv = null;
}
function updateFindCount(r) {
  const c = $('#findCount');
  if (c && r) c.textContent = r.matches ? `${r.activeMatchOrdinal}/${r.matches}` : 'No matches';
}

/* ---------- AI panel toggle ---------- */
function toggleAI(force) {
  state.aiOpen = force ?? !state.aiOpen;
  $('#app').classList.toggle('ai-open', state.aiOpen);
  $('#aiPanel').setAttribute('aria-hidden', String(!state.aiOpen));
  if (state.aiOpen) window.AI?.focus();
}

/* ---------- split view: two accounts side by side ----------
   Any mail account, chat app or storage drive can sit in the right-hand pane next to what you're
   looking at — e.g. Teams beside Outlook, or Google Drive beside Dropbox. */
const Split = (() => {
  const sp = () => (state.ui.split = state.ui.split || { on: false, right: null, ratio: 0.5 });
  let leftId = null, focus = 'left';
  const save = () => relay.saveUI({ split: state.ui.split });
  const isWebPlatform = (p) => !!PLATFORMS[p] || p === 'storage';
  function allSurfaces() {
    const out = [];
    for (const [k, pl] of Object.entries(PLATFORMS)) for (const a of accountsFor(k)) out.push({ id: a.id, label: a.name || a.email || pl.label, group: k === 'chats' ? 'Chats' : pl.label, a });
    for (const it of state.storage || []) { const sf = window.Cloud?.surface(it.id); if (sf) out.push({ id: it.id, label: it.name || 'Storage', group: 'Storage', a: sf }); }
    return out;
  }
  function platformOf(id) { const a = accountById(id); return a ? a.platform : (state.storage || []).some(x => x.id === id) ? 'storage' : null; }
  function divider() {
    let d = $('#splitDivider');
    if (!d) {
      d = document.createElement('div'); d.id = 'splitDivider'; d.className = 'split-divider'; d.innerHTML = '<i></i>';
      $('#webviews').appendChild(d);
      d.onmousedown = (e) => {
        e.preventDefault();
        const box = $('#webviews').getBoundingClientRect();
        document.body.classList.add('split-dragging');
        const mv = (ev) => { sp().ratio = Math.min(0.78, Math.max(0.22, (ev.clientX - box.left) / box.width)); $('#webviews').style.setProperty('--split', sp().ratio); };
        const up = () => { document.body.classList.remove('split-dragging'); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); save(); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      };
      d.ondblclick = () => { sp().ratio = 0.5; $('#webviews').style.setProperty('--split', 0.5); save(); };
    }
    return d;
  }
  function layout(sel) {
    const s = sp(), box = $('#webviews');
    if (sel && s.right === sel && leftId && leftId !== sel) s.right = leftId; // you opened the right-hand one on the left: keep both visible
    leftId = sel;
    const on = s.on && s.right && sel && s.right !== sel && !!surfaceById(s.right) && isWebPlatform(state.ui.platform);
    box.classList.toggle('split', !!on);
    box.style.setProperty('--split', s.ratio || 0.5);
    divider().hidden = !on;
    $$('.webview-wrap', box).forEach(w => { if (w.dataset.id !== s.right || !on) w.classList.remove('pane-right'); w.classList.toggle('focused', !!on && ((focus === 'left' && w.dataset.id === sel) || (focus === 'right' && w.dataset.id === s.right))); });
    if (!on) { focus = 'left'; renderButton(); return; }
    ensureWebview(surfaceById(s.right)).then(({ wrap }) => { if (sp().on && sp().right === wrap.dataset.id && leftId !== wrap.dataset.id) { wrap.classList.add('pane-right'); wrap.classList.toggle('focused', focus === 'right'); } });
    renderButton();
  }
  function renderButton() { const b = $('#splitBtn'); if (b) b.classList.toggle('on', !!(sp().on && $('#webviews').classList.contains('split'))); }
  function pickMenu(x, y, onPick, exclude) {
    const items = allSurfaces().filter(o => o.id !== exclude);
    if (!items.length) { toast('Add another account first — then you can show two side by side'); return; }
    const out = []; let g = null;
    for (const o of items) { if (o.group !== g) { if (g) out.push('-'); g = o.group; } out.push({ label: `${o.label}${o.group !== o.label ? ' — ' + o.group : ''}`, icon: o.group === 'Chats' ? 'chat' : o.group === 'Storage' ? 'cloud' : 'mail', onClick: () => onPick(o.id) }); }
    popMenu(x, y, out);
  }
  function openRight(id) {
    const s = sp();
    s.right = id; s.on = true; save(); focus = 'right';
    const cur = isWebPlatform(state.ui.platform) ? state.ui.selected[state.ui.platform] : null;
    if (!cur || cur === id) {
      // the left side needs something different: what you used last, or the first other account
      const lp0 = state.ui.lastWeb, lid = lp0 && state.ui.selected[lp0];
      const other = lid && lid !== id && surfaceById(lid) ? lid : allSurfaces().find(o => o.id !== id)?.id;
      if (!other) { s.on = false; save(); toast('Add another account first — then you can show two side by side'); return; }
      const lp = platformOf(other);
      state.ui.selected[lp] = other; relay.saveUI({ selected: state.ui.selected });
      if (lp !== state.ui.platform) { setPlatform(lp); return; }
    }
    render();
  }
  function toggle(anchor) {
    const s = sp();
    if (s.on && $('#webviews').classList.contains('split')) { s.on = false; save(); renderMain(); return; }
    const r = anchor?.getBoundingClientRect?.() || { right: innerWidth - 60, bottom: 60 };
    pickMenu(r.right - 260, r.bottom + 6, (id) => openRight(id), isWebPlatform(state.ui.platform) ? state.ui.selected[state.ui.platform] : null);
  }
  function paneAction(id, act, e) {
    const s = sp();
    if (act === 'close') { s.on = false; save(); renderMain(); return; }
    if (act === 'swap') {
      const left = leftId, right = s.right, lp = platformOf(right);
      s.right = left; save();
      state.ui.selected[lp] = right; relay.saveUI({ selected: state.ui.selected });
      if (lp !== state.ui.platform) setPlatform(lp); else render();
      return;
    }
    if (act === 'pick') {
      const r = e.currentTarget.getBoundingClientRect();
      if (id === s.right) pickMenu(r.right - 260, r.bottom + 4, (nid) => { s.right = nid; save(); renderMain(); }, leftId);
      else pickMenu(r.right - 260, r.bottom + 4, (nid) => { const lp = platformOf(nid); state.ui.selected[lp] = nid; relay.saveUI({ selected: state.ui.selected }); if (lp !== state.ui.platform) setPlatform(lp); else render(); }, s.right);
    }
  }
  function setFocus(id) {
    if (!$('#webviews').classList.contains('split')) return;
    const f = id === sp().right ? 'right' : 'left';
    if (f === focus) return;
    focus = f;
    $$('.webview-wrap', $('#webviews')).forEach(w => w.classList.toggle('focused', (focus === 'left' && w.dataset.id === leftId) || (focus === 'right' && w.dataset.id === sp().right)));
    if (state.aiOpen) window.AI?.updateContext?.();
  }
  function focusedId() { return $('#webviews').classList.contains('split') && focus === 'right' ? sp().right : null; }
  function focusedWebview() { const id = focusedId(); return id ? webviews.get(id)?.wv || null : null; }
  return { layout, toggle, openRight, paneAction, focus: setFocus, focusedId, focusedWebview, isOn: () => $('#webviews').classList.contains('split') };
})();
window.Split = Split;

/* ---------- AI readiness (Claude / ChatGPT keys, or the Assist plugin) ---------- */
function aiReady(prov = state.settings.aiProvider || 'claude') {
  if (prov === 'assist') return state.settings.assistEnabled !== false;
  return !!state.settings[prov === 'claude' ? 'hasClaudeKey' : 'hasOpenaiKey'];
}
const AI_LABEL = { claude: 'Claude', openai: 'ChatGPT', assist: 'Assist' };

/* ---------- slim sidebar ---------- */
// Collapses every left sidebar to a slim icon rail (and back). Rows keep working; hover shows the name.
function applySideMini() {
  const mini = !!state.ui.sideMini;
  $('#app').classList.toggle('side-mini', mini);
  const b = $('#sideToggle');
  b.innerHTML = ic(mini ? 'chevronRight' : 'chevronLeft', 14);
  b.title = mini ? 'Expand sidebar (⌘\\)' : 'Collapse sidebar (⌘\\)';
  if (mini) labelRail();
}
function toggleSideMini(force) {
  state.ui.sideMini = force ?? !state.ui.sideMini;
  relay.saveUI({ sideMini: state.ui.sideMini });
  applySideMini();
}
const RAIL_ROWS = '.side-nav button, .account, .mini-acct, .cal-item, .br-tab, .add-account, .br-new button, .lib-side-row';
function labelRail() {
  $$(RAIL_ROWS, $('#sidebar')).forEach(r => {
    if (r.title && !r.dataset.autoTitle) return;
    const label = (r.querySelector('.name, .n, .cal-name, .br-title') || r).textContent.replace(/\s+/g, ' ').trim();
    if (label) { r.title = label; r.dataset.autoTitle = '1'; }
  });
}

/* ---------- boot ---------- */
// On Windows/Linux, show Ctrl instead of ⌘ everywhere in the interface
function localizeShortcuts() {
  if (relay.platform === 'darwin') return;
  document.body.classList.add('platform-' + relay.platform);
  const fix = (t) => t.replace(/⌘⇧/g, 'Ctrl+Shift+').replace(/⌘/g, 'Ctrl+').replace(/Ctrl\+(\d)–Ctrl\+(\d)/g, 'Ctrl+$1–$2');
  const walk = (root) => {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) if (n.nodeValue.includes('⌘')) n.nodeValue = fix(n.nodeValue);
    root.querySelectorAll?.('[title*="⌘"], [placeholder*="⌘"]').forEach(el => {
      if (el.title?.includes('⌘')) el.title = fix(el.title);
      if (el.placeholder?.includes('⌘')) el.placeholder = fix(el.placeholder);
    });
  };
  walk(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData' && m.target.nodeValue.includes('⌘')) m.target.nodeValue = fix(m.target.nodeValue);
      m.addedNodes.forEach(n => { if (n.nodeType === 1) walk(n); else if (n.nodeType === 3 && n.nodeValue.includes('⌘')) n.nodeValue = fix(n.nodeValue); });
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

async function boot() {
  localizeShortcuts();
  const s = await relay.getState();
  Object.assign(state, s);
  state.ui.selected = state.ui.selected || {};
  applyTheme();
  $('#settingsBtn').innerHTML = ic('settings', 18);
  $('#settingsBtn').onclick = () => openSettings();
  $('#aiToggle').onclick = () => toggleAI();
  $('#sideToggle').onclick = () => toggleSideMini();
  $('#splitBtn').innerHTML = ic('columns', 17);
  $('#palBtn').innerHTML = ic('search', 17);
  $('#palBtn').onclick = () => window.Palette?.open();
  $('#splitBtn').onclick = (e) => Split.toggle(e.currentTarget);
  new MutationObserver(() => { if (state.ui.sideMini) labelRail(); }).observe($('#sidebar'), { childList: true, subtree: true });
  applySideMini();
  render();
  window.AI?.render();

  // Warm up every account in the background so unread counts and notifications work.
  state.accounts.forEach((a, i) => setTimeout(() => ensureWebview(a).then(() => renderMain()), 600 + i * 900));

  relay.onMenu((cmd) => {
    if (cmd === 'settings') openSettings();
    else if (cmd === 'add-account') state.ui.platform === 'chats' ? openChatModal({}) : openAccountModal({ platform: PLATFORMS[state.ui.platform] ? state.ui.platform : 'gmail' });
    else if (cmd === 'briefing') { state.ui.homeView = 'briefing'; relay.saveUI({ homeView: 'briefing' }); setPlatform('home'); }
    else if (cmd === 'new-task' || (cmd === 'cmd-t' && state.ui.platform !== 'browser')) { state.ui.homeView = 'tasks'; relay.saveUI({ homeView: 'tasks' }); setPlatform('home'); window.Home?.focusNewTask(); }
    else if (cmd === 'cmd-t') window.Browser?.command('new-tab');
    else if (cmd === 'incognito') window.Browser?.openTab('', { incognito: true });
    else if (cmd === 'open-location') { if (state.ui.platform !== 'browser') setPlatform('browser'); setTimeout(() => window.Browser?.command('open-location'), 50); }
    else if (cmd === 'find') openFind();
    else if (cmd === 'open-player') relay.media.pick('player').then(f => f.length && window.Player?.open(f.map(src => ({ src }))));
    else if (cmd === 'open-reader') relay.media.pick('reader').then(f => f[0] && window.Reader?.open(f[0]));
    else if (cmd === 'track-package') window.Tracking?.openAdd();
    else if (cmd === 'close-tab') { if (state.ui.platform === 'browser') window.Browser?.command('close-tab'); else relay.closeWindow(); }
    else if (cmd === 'back' || cmd === 'forward') {
      const wv = activeWebview();
      if (wv) cmd === 'back' ? wv.goBack() : wv.goForward();
    }
    else if (cmd === 'new-event') { setPlatform('calendar'); window.Calendar?.newEvent(); }
    else if (cmd === 'toggle-ai') toggleAI();
    else if (cmd === 'toggle-sidebar') toggleSideMini();
    else if (cmd === 'split') Split.toggle($('#splitBtn'));
    else if (cmd === 'palette') window.Palette?.open();
    else if (cmd === 'reload') {
      if (state.ui.platform === 'calendar') window.Calendar?.refresh(true);
      else if (state.ui.platform === 'browser') window.Browser?.command('reload');
      else if (isView(state.ui.platform)) render();
      else webviews.get(state.ui.selected[state.ui.platform])?.wv.reload();
    }
    else if (cmd.startsWith('tab:')) setPlatform(cmd.slice(4));
  });
  relay.onAskSelection((text) => { toggleAI(true); window.AI?.useSelection(text); });
  relay.vault.onLocked(() => window.Vault?.onLocked());
  relay.vault.onFillRequest((d) => fillFromContextMenu(d));
  relay.vault.onSaveRequest((d) => saveFromContextMenu(d));
  relay.browser.onOpenTab(({ url, incognito }) => window.Browser?.openTab(url, { incognito }));
  relay.onDownload((d) => {
    if (d.state === 'started') toast(`Downloading ${d.name}…`);
    else if (d.state === 'completed') {
      const it = window.Downloads?.find(d.path);
      const act = MEDIA_RE.test(d.name) ? { label: 'Play', onClick: () => window.Player?.open({ src: d.path, title: d.name }) }
        : READ_RE.test(d.name) ? { label: 'Read', onClick: () => window.Reader?.open(d.path) }
        : { label: 'Show in Finder', onClick: () => relay.showInFolder(d.path) };
      toast(`Downloaded ${d.name}`, '', act);
    }
    else if (d.state === 'interrupted') toast(`Download of ${d.name} failed`, 'error');
  });
  mq.addEventListener('change', () => window.Skins?.reapplyAll());
}

window.RelayApp = { makeSortable, renderTabs, openAccountModal, openFind, activeWebview, surfaceById, ensureWebview, selectAccount, setPlatform, startUrl, fillFromVault, openSignInHelp, isView, state, $, $$, esc, uid, ic, PLATFORMS, ACCOUNT_COLORS, avatarHTML, accountById, accountsFor, webviews, openModal, popMenu, colorPickerHTML, bindColorPicker, updateAccount, toast, openSettings, openChatModal, CHAT_SERVICES, chatService, mailAccounts, isMailAccount, MAIL_PLATFORMS, toggleAI, toggleSideMini, aiReady, AI_LABEL, applyTheme, isDark, accentColor, ACCENTS, render };
// Broken images (avatars, favicons) quietly disappear instead of showing a broken icon
document.addEventListener('error', (e) => { if (e.target?.tagName === 'IMG' && e.target.hasAttribute('data-fallback')) e.target.remove(); }, true);
document.addEventListener('DOMContentLoaded', boot);
