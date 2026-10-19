import { RoomCore } from './lib/room-core.mjs';
import { openRoom } from './lib/net.mjs';
import { ClockSync } from './lib/clock.mjs';
import { planCorrection, significantChange, describeDrift, formatTime, projectedPosition } from './lib/sync.mjs';
import { generateCode, formatCode, parseInvite, findInviteLink, inviteText, normalizeCode } from './lib/codes.mjs';
import { Broadcaster, QUALITY, inboundStats } from './lib/broadcast.mjs';

const api = window.sideby;
const $ = id => document.getElementById(id);
const COLORS = ['#D4F08A', '#8AD8F0', '#F0A58A', '#C9A8F5', '#F5D27A', '#8AF0C1', '#F58AB8', '#A8B8F5'];
const REACTIONS = ['😂', '😮', '😍', '🔥', '👏', '😭', '💀', '🍿'];
const MEDIA_EXT = /\.(mp4|m4v|webm|mov|ogv|ogg|mp3|m4a|m3u8)(\?|#|$)/i;

let settings = null;
let info = null;
let session = null;
let dismissedClipboard = null;

// ---------- helpers ----------
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) node.style.setProperty(sk, sv); else node.style[sk] = sv; }
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c.nodeType ? c : String(c));
  return node;
}
const initial = name => (name || '?').trim().charAt(0).toUpperCase() || '?';
function avatar(member, cls = '') {
  return el('span', { class: `avatar ${cls}`, style: { '--c': member.color } }, initial(member.name));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function toast(text, { action, onAction, bad = false, ms = 4200 } = {}) {
  const node = el('div', { class: `toast${bad ? ' bad' : ''}` }, el('span', {}, text));
  if (action) node.append(el('button', { class: 'btn primary xs', onclick: () => { node.remove(); onAction?.(); } }, action));
  $('toasts').append(node);
  setTimeout(() => node.remove(), ms);
  return node;
}

function timeAgo(at) {
  const s = (Date.now() - at) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

async function saveSettings(patch) {
  settings = await api.settings.set(patch);
  return settings;
}

async function resolveInput(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  let url;
  if (/^(https?|sideby-media):\/\//i.test(t)) url = t;
  else if (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(t)) url = `https://${t}`;
  else return `https://www.youtube.com/results?search_query=${encodeURIComponent(t)}`;
  if (/^https?:/i.test(url) && MEDIA_EXT.test(new URL(url).pathname + new URL(url).search)) {
    return api.stage.playerUrl(url, { name: decodeURIComponent(new URL(url).pathname.split('/').pop() || '') });
  }
  return url;
}

function pageLabel(title, url) {
  const t = String(title || '').trim();
  if (t && t !== url && !/^[a-z-]+:\/\//i.test(t) && !/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(t)) return t.slice(0, 80);
  return describeUrl(url);
}

function describeUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'sideby-media:') return u.searchParams.get('name') || 'a video';
    return u.hostname.replace(/^www\./, '');
  } catch { return 'a page'; }
}

// ---------- swatches ----------
function renderSwatches(container, selected, onPick) {
  container.replaceChildren(...COLORS.map(c => el('button', {
    type: 'button', class: 'swatch', role: 'radio', 'aria-checked': String(c === selected), 'aria-label': `Color ${c}`,
    style: { '--c': c }, onclick: () => onPick(c)
  })));
}

// ---------- home ----------
function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
}

function renderHome() {
  showScreen('home');
  $('profile-name').value = settings.profile.name || '';
  const av = $('profile-avatar');
  av.textContent = initial(settings.profile.name);
  av.style.setProperty('--c', settings.profile.color);
  renderSwatches($('profile-swatches'), settings.profile.color, async c => {
    await saveSettings({ profile: { color: c } });
    renderHome();
  });
  $('my-code').textContent = formatCode(settings.personalCode);
  const recent = (settings.recentRooms || []).filter(r => r.code !== settings.personalCode);
  $('recent-wrap').hidden = !recent.length;
  $('recent-list').replaceChildren(...recent.slice(0, 6).map(r => el('li', {}, el('button', { type: 'button', onclick: () => enterRoom(r.code, { asHost: false }) },
    el('span', { class: 'r-name' }, r.name || 'A room'),
    el('span', { class: 'r-code' }, formatCode(r.code)),
    el('span', { class: 'r-when' }, timeAgo(r.at))
  ))));
  checkClipboard();
}

function requireName() {
  const name = $('profile-name').value.trim() || settings.profile.name;
  if (name) return true;
  if (!$('home').hidden) {
    const input = $('profile-name');
    input.focus();
    input.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 });
    toast('Add your name first so friends know who’s here.');
  }
  return false;
}

async function checkClipboard() {
  if (session || $('home').hidden) return;
  try {
    const text = await api.app.clipboardInvite();
    const code = findInviteLink(text);
    if (code && code !== settings.personalCode && code !== dismissedClipboard) {
      $('clipboard-code').textContent = formatCode(code);
      $('clipboard-offer').hidden = false;
      $('clipboard-offer').dataset.code = code;
      return;
    }
  } catch {}
  $('clipboard-offer').hidden = true;
}

function wireHome() {
  let nameTimer;
  $('profile-name').addEventListener('input', () => {
    const name = $('profile-name').value.trim();
    $('profile-avatar').textContent = initial(name);
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => saveSettings({ profile: { name } }), 300);
  });
  $('profile-form').addEventListener('submit', e => { e.preventDefault(); $('start-room').click(); });
  $('start-room').addEventListener('click', async () => {
    if (!requireName()) return;
    await saveSettings({ profile: { name: $('profile-name').value.trim() } });
    enterRoom(settings.personalCode, { asHost: true, personal: true });
  });
  $('copy-my-invite').addEventListener('click', async () => {
    await api.app.copy(inviteText(settings.personalCode, { name: settings.profile.name }));
    toast('Invite copied. Paste it to your friends.');
  });
  $('new-code').addEventListener('click', async () => {
    await saveSettings({ personalCode: generateCode() });
    renderHome();
    toast('New room code made. Old invites won’t open your room anymore.');
  });
  $('join-form').addEventListener('submit', async e => {
    e.preventDefault();
    const code = parseInvite($('join-input').value);
    $('join-error').hidden = true;
    if (!code) {
      $('join-error').textContent = 'That doesn’t look like a Sideby invite. Codes have 9 letters and numbers, like K7Q-M2X-9PD.';
      $('join-error').hidden = false;
      return;
    }
    if (!requireName()) return;
    await saveSettings({ profile: { name: $('profile-name').value.trim() } });
    $('join-input').value = '';
    enterRoom(code, { asHost: code === settings.personalCode, personal: code === settings.personalCode });
  });
  $('clipboard-join').addEventListener('click', async () => {
    if (!requireName()) return;
    await saveSettings({ profile: { name: $('profile-name').value.trim() } });
    enterRoom($('clipboard-offer').dataset.code, { asHost: false });
  });
  $('clipboard-dismiss').addEventListener('click', () => { dismissedClipboard = $('clipboard-offer').dataset.code; $('clipboard-offer').hidden = true; });
  $('home-settings').addEventListener('click', () => openSettings());
}

async function addRecent(code, name) {
  const list = (settings.recentRooms || []).filter(r => r.code !== code);
  list.unshift({ code, name: name || '', at: Date.now() });
  await saveSettings({ recentRooms: list.slice(0, 12) });
}

// ---------- entering / leaving ----------
async function enterRoom(code, { asHost = false, personal = false } = {}) {
  code = normalizeCode(code);
  if (!code) return;
  if (!settings.profile.name) { renderHome(); requireName(); return; }
  if (session) {
    if (session.code === code) return;
    session.destroy();
  }
  const roomName = personal ? (settings.roomName || `${settings.profile.name}’s room`) : '';
  await addRecent(code, roomName);
  showScreen('room');
  session = new RoomSession(code, { asHost, personal, roomName });
}

function leaveRoom() {
  if (!session) return;
  session.destroy();
  session = null;
  document.body.classList.remove('theater');
  api.app.fullscreen(false);
  renderHome();
}

// ---------- room session ----------
class RoomSession {
  constructor(code, { asHost, personal, roomName }) {
    this.code = code;
    this.personal = personal;
    this.disposers = [];
    this.timers = [];
    this.clock = new ClockSync();
    this.local = null;              // our stage video state
    this.nav = {};                  // our stage navigation state
    this.following = true;
    this.loadedHostUrl = null;
    this.lastSeekAt = -Infinity;
    this.userControlUntil = 0;
    this.lastPublished = null;
    this.lastPublishAt = 0;
    this.pendingActivity = null;
    this.syncStatus = 'idle';
    this.drift = null;
    this.remoteStreams = new Map();
    this.frozen = 0;
    this.controlWarned = 0;
    this.typingNames = new Map();
    this.conn = null;
    this.prevStats = null;
    this.scrubbing = false;

    const turn = settings.turn?.[0]?.urls ? settings.turn : [];
    this.net = openRoom({ code, signaling: settings.signaling, turn, onError: msg => toast(msg, { bad: true }) });
    this.core = new RoomCore({
      transport: this.net.transport,
      profile: settings.profile,
      startAsHost: asHost,
      roomName,
      everyoneControls: settings.everyoneControls !== false
    });
    this.broadcaster = new Broadcaster({ net: this.net, bridge: api, onStop: () => { this.core.setBroadcasting(false); this.render(); } });
    this.net.bind(this.core, {
      onPeerJoin: id => { this.broadcaster.addPeer(id); this.renderPresence(); },
      onPeerLeave: id => { this.remoteStreams.delete(id); this.typingNames.delete(id); this.render(); },
      onPeerStream: (stream, id, meta) => {
        if (meta?.kind !== 'broadcast') return;
        this.remoteStreams.set(id, stream);
        stream.addEventListener('removetrack', () => { if (!stream.getTracks().length) { this.remoteStreams.delete(id); this.render(); } });
        this.render();
      }
    });

    const c = this.core;
    this.disposers.push(
      c.on('change', () => this.render()),
      c.on('members', () => { this.renderMembers(); this.renderPresence(); }),
      c.on('message', m => this.appendMessage(m)),
      c.on('history', () => this.renderMessages()),
      c.on('react', r => this.showReaction(r)),
      c.on('typing', id => this.showTyping(id)),
      c.on('activity', a => this.appendActivity(a)),
      c.on('control', (action, who) => this.applyControl(action, who)),
      c.on('host-changed', e => this.onHostChanged(e)),
      c.on('url', () => this.followHost())
    );

    this.timers.push(setInterval(() => this.reportStatus(), 2000));
    this.timers.push(setInterval(() => { if (!this.core.isHost && this.core.hostId) this.sampleClock(2); }, 30000));
    this.timers.push(setInterval(() => this.tick(), 1000));

    this.observer = new ResizeObserver(() => this.syncBounds());
    this.observer.observe($('stage'));
    this.onWinResize = () => this.syncBounds();
    window.addEventListener('resize', this.onWinResize);

    this.setupRoomUi();
    this.renderMessages();
    this.render();
  }

  // ---- lifecycle ----
  destroy() {
    this.broadcaster.stop(false);
    this.core.leave();
    try { this.net.leave(); } catch {}
    for (const d of this.disposers) d();
    for (const t of this.timers) clearInterval(t);
    this.observer.disconnect();
    window.removeEventListener('resize', this.onWinResize);
    api.stage.blank();
    api.stage.mute(false);
    api.stage.bounds({ x: 0, y: 0, width: 0, height: 0, visible: false });
    const v = $('stage-video');
    v.srcObject = null;
    v.hidden = true;
    $('messages').replaceChildren();
  }

  setupRoomUi() {
    $('room-code').textContent = formatCode(this.code);
    $('address').value = '';
    $('follow-btn').hidden = true;
    $('reactions').replaceChildren(...REACTIONS.map((e, i) => el('button', { type: 'button', title: `React (${i + 1})`, onclick: () => this.core.react(e) }, e)));
  }

  // ---- stage geometry & visibility ----
  stagePlan() {
    const s = this.core.state;
    const me = this.core.selfId;
    if (this.core.phase === 'connecting') return { view: false, video: null, empty: false, notice: 'connecting' };
    if (s.mode === 'broadcast') {
      if (s.broadcaster === me) {
        if (this.broadcaster.kind === 'stage') return { view: true, video: null };
        return { view: false, video: this.broadcaster.stream, muted: true };
      }
      const stream = this.remoteStreams.get(s.broadcaster);
      return stream ? { view: false, video: stream, muted: false } : { view: false, video: null, notice: 'waiting-broadcast' };
    }
    if (this.core.isHost) {
      const has = this.nav.url && this.nav.url !== 'about:blank';
      return { view: !!has, video: null, empty: !has };
    }
    if (!this.following) return { view: true, video: null };
    return { view: !!s.url && !isPrivateUrl(s.url), video: null, empty: !s.url };
  }

  syncBounds() {
    const r = $('stage').getBoundingClientRect();
    const plan = this.stagePlan();
    api.stage.bounds({ x: r.left, y: r.top, width: r.width, height: r.height, visible: plan.view && this.frozen === 0 });
  }

  async freeze() {
    this.frozen++;
    if (this.frozen === 1) {
      const shot = this.stagePlan().view ? await api.stage.snapshot() : null;
      if (this.frozen > 0) {
        if (shot) { $('stage-freeze').src = shot; $('stage-freeze').hidden = false; }
        this.syncBounds();
      }
    }
  }

  unfreeze() {
    this.frozen = Math.max(0, this.frozen - 1);
    if (this.frozen === 0) { $('stage-freeze').hidden = true; this.syncBounds(); }
  }

  // ---- render ----
  render() {
    const c = this.core;
    const s = c.state;
    document.body.classList.toggle('is-host', c.isHost);
    const name = s.roomName || (c.host ? `${c.host.name}’s room` : 'Sideby room');
    const nameEl = $('room-name');
    if (document.activeElement !== nameEl) nameEl.textContent = name;
    nameEl.contentEditable = c.isHost ? 'true' : 'false';
    if (s.roomName && this.lastRecentName !== s.roomName) { this.lastRecentName = s.roomName; addRecent(this.code, s.roomName); }

    // stage contents
    const plan = this.stagePlan();
    const video = $('stage-video');
    if (plan.video) {
      if (video.srcObject !== plan.video) { video.srcObject = plan.video; video.play().catch(() => {}); }
      video.muted = !!plan.muted;
      video.hidden = false;
    } else if (!video.hidden) {
      video.srcObject = null;
      video.hidden = true;
    }
    const watchingRemote = s.mode === 'broadcast' && s.broadcaster !== c.selfId;
    if (watchingRemote !== this.watchingRemote) {
      this.watchingRemote = watchingRemote;
      if (watchingRemote) { api.stage.apply({ paused: true }); api.stage.mute(true); }
      else { api.stage.mute(false); this.loadedHostUrl = null; this.followHost(); }
    }
    $('stream-stats').hidden = !watchingRemote || !plan.video;

    $('stage-empty').hidden = !plan.empty;
    $('empty-host').hidden = !c.isHost;
    $('empty-guest').hidden = c.isHost;
    if (!c.isHost) {
      $('guest-title').textContent = `Waiting for ${c.host?.name ?? 'the host'} to pick something.`;
      $('guest-body').textContent = s.everyoneControls
        ? 'When they open a video, it’ll appear here and play in sync. You can also paste a link above to put something on.'
        : 'When they open a video, it’ll appear here and play in sync.';
    }
    this.renderNotice(plan.notice);

    const live = s.mode === 'broadcast';
    $('broadcast-badge').hidden = !live;
    if (live) {
      const mine = s.broadcaster === c.selfId;
      const viewers = c.members.size;
      $('broadcast-label').textContent = mine
        ? `Broadcasting to ${viewers} ${viewers === 1 ? 'friend' : 'friends'}${this.broadcaster.hasAudio ? '' : ' (no sound)'}`
        : `${c.members.get(s.broadcaster)?.name ?? 'Host'} is broadcasting`;
      $('broadcast-stop').hidden = !mine;
    }
    $('broadcast-btn').textContent = live && s.broadcaster === c.selfId ? 'Stop broadcast' : 'Broadcast';

    // address bar
    const addr = $('address');
    const shownUrl = (!c.isHost && this.following) ? (s.url || '') : (this.nav.url || '');
    if (document.activeElement !== addr) addr.value = displayUrl(shownUrl);
    addr.placeholder = c.canControl() ? 'Search YouTube or paste any link' : `${c.host?.name ?? 'The host'} chooses what’s on`;
    $('nav-back').disabled = !this.nav.canGoBack;
    $('nav-forward').disabled = !this.nav.canGoForward;
    $('follow-btn').hidden = c.isHost || this.following || s.mode === 'broadcast';

    this.renderTransport();
    this.renderMembers();
    this.renderPresence();
    this.syncBounds();
  }

  renderNotice(kind) {
    const box = $('stage-notice');
    if (!kind && !this.notice) { box.hidden = true; return; }
    const n = this.notice && !kind ? this.notice : null;
    let title = '', body = '', actions = [];
    if (kind === 'connecting') {
      title = `Opening ${formatCode(this.code)}…`;
      body = 'Looking for friends already in this room. It usually takes a few seconds.';
    } else if (kind === 'waiting-broadcast') {
      title = `Connecting to ${this.core.host?.name ?? 'the host'}’s broadcast…`;
      body = 'The picture should appear in a moment.';
    } else if (n) {
      ({ title, body, actions = [] } = n);
    }
    $('notice-title').textContent = title;
    $('notice-body').textContent = body;
    $('notice-actions').replaceChildren(...actions.map(a => el('button', { class: `btn ${a.primary ? 'primary' : 'ghost'} sm`, onclick: a.run }, a.label)));
    box.hidden = !title;
  }

  setNotice(notice) { this.notice = notice; this.render(); }

  renderTransport() {
    const c = this.core;
    const s = c.state;
    const v = this.local;
    const broadcasting = s.mode === 'broadcast';
    const usable = !!v && !broadcasting && (c.isHost || this.following);
    $('transport').classList.toggle('is-broadcast', broadcasting);
    const canCtl = c.canControl() && usable;
    const playBtn = $('play-btn');
    playBtn.disabled = !canCtl;
    playBtn.classList.toggle('playing', !!v && !v.paused);
    playBtn.setAttribute('aria-label', v && !v.paused ? 'Pause' : 'Play');

    const scrub = $('scrub');
    const live = !!v?.live;
    const duration = v?.duration || 0;
    scrub.disabled = !canCtl || live || !duration;
    if (!this.scrubbing) {
      const p = duration ? Math.min(1, v.t / duration) : (live ? 1 : 0);
      scrub.value = String(Math.round(p * 1000));
      scrub.style.setProperty('--p', `${p * 100}%`);
      $('time-now').textContent = live ? (v.lag != null ? `−${formatTime(v.lag)}` : 'Live') : formatTime(v?.t || 0);
    }
    $('time-total').textContent = live ? '' : formatTime(duration);
    $('live-btn').hidden = !live || broadcasting;
    $('live-btn').classList.toggle('at-edge', live && (v.lag ?? 99) < 8);

    // sync pill
    const pill = $('sync-pill');
    let state = 'idle', text = 'Nothing playing';
    if (broadcasting) {
      state = 'host';
      text = s.broadcaster === c.selfId ? 'You’re broadcasting' : 'Watching live broadcast';
    } else if (c.isHost) {
      if (v) {
        const synced = [...c.members.values()].filter(m => ['synced', 'live-synced'].includes(m.status?.sync)).length;
        state = 'host';
        text = c.members.size ? `You’re hosting, ${synced} of ${c.members.size} in sync` : 'You’re hosting';
      } else text = this.nav.url && this.nav.url !== 'about:blank' ? 'No video on this page yet' : 'Nothing playing';
    } else if (!this.following) {
      state = 'bad'; text = 'Browsing on your own';
    } else {
      text = describeDrift(this.syncStatus, this.drift) || 'Nothing playing';
      state = ['synced', 'live-synced'].includes(this.syncStatus) ? 'good'
        : ['catching-up', 'seeking', 'buffering', 'ad', 'live'].includes(this.syncStatus) ? 'work'
        : ['mismatch', 'no-video'].includes(this.syncStatus) ? 'bad' : 'idle';
      if (this.syncStatus === 'waiting-host' && s.url) text = `Waiting for ${c.host?.name ?? 'the host'} to press play`;
    }
    pill.dataset.state = state;
    $('sync-text').textContent = text;
    $('resync-btn').hidden = c.isHost || broadcasting || !(this.following ? ['mismatch', 'no-video', 'catching-up', 'seeking'].includes(this.syncStatus) : false);
  }

  renderMembers() {
    const c = this.core;
    const members = c.memberList();
    $('member-count').textContent = members.length === 1 ? 'Just you' : `${members.length} here`;
    const seats = members.map(m => {
      const st = m.isSelf ? this.selfSeatStatus() : seatStatus(m, c);
      const seat = el('li', { class: 'seat', dataset: { sync: st.tone } },
        el('span', { class: 'avatar', style: { '--c': m.color } }, initial(m.name)),
        m.isHost ? el('span', { class: 'crown', title: 'Host' }, '★') : null,
        el('span', { class: 'nm', title: m.name }, m.isSelf ? 'You' : m.name),
        el('span', { class: 'st' }, st.text),
        el('span', { class: 'glow' })
      );
      if (c.isHost && !m.isSelf) {
        seat.append(el('button', { class: 'seat-menu', title: `Make ${m.name} the host`, onclick: () => {
          toast(`Make ${m.name} the host? They’ll control what’s on.`, { action: 'Make host', onAction: () => c.transferHost(m.id), ms: 6000 });
        } }));
      }
      return seat;
    });
    if (members.length === 1) {
      seats.push(el('li', { class: 'seat empty' },
        el('button', { class: 'seat-menu', title: 'Invite friends', onclick: () => openInvite() }),
        el('span', { class: 'avatar' }, '+'), el('span', { class: 'nm' }, 'Invite'), el('span', { class: 'st' }, ''), el('span', { class: 'glow' })));
    }
    $('members').replaceChildren(...seats);
  }

  selfSeatStatus() {
    const c = this.core;
    if (c.isHost) return { tone: this.local && !this.local.paused ? 'good' : 'idle', text: 'Host' };
    if (!this.following) return { tone: 'bad', text: 'Browsing' };
    return statusTone(this.syncStatus, this.drift);
  }

  renderPresence() {
    const c = this.core;
    const p = $('presence');
    if (c.phase === 'connecting') { p.textContent = 'Finding your friends…'; return; }
    const n = c.members.size + 1;
    if (n === 1) { p.replaceChildren('Just you so far. ', el('button', { class: 'btn ghost xs', onclick: () => openInvite() }, 'Invite friends')); return; }
    const host = c.isHost ? 'You’re hosting' : `${c.host?.name ?? 'Someone'} is hosting`;
    p.replaceChildren(el('b', {}, String(n)), ` watching. ${host}.`);
  }

  // ---- chat ----
  renderMessages() {
    $('messages').replaceChildren();
    this.lastSender = null;
    for (const m of this.core.messages) this.appendMessage(m, false);
    this.scrollChat(true);
  }

  appendMessage(m, scroll = true) {
    const list = $('messages');
    $('chat-empty').hidden = true;
    if (m.kind === 'system') {
      list.append(el('li', { class: 'msg system' }, m.text));
      this.lastSender = null;
    } else {
      const first = this.lastSender !== m.from || m.at - (this.lastAt || 0) > 5 * 60_000;
      this.lastSender = m.from; this.lastAt = m.at;
      const time = new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      list.append(el('li', { class: `msg${first ? ' first' : ''}`, style: { '--c': m.color } },
        avatar(m),
        el('div', { class: 'who' }, m.from === this.core.selfId ? 'You' : m.name, el('time', {}, time)),
        el('div', { class: 'text' }, ...linkify(m.text, url => this.openLink(url)))
      ));
      if (m.from !== this.core.selfId) this.typingNames.delete(m.from), this.renderTyping();
    }
    if (scroll) this.scrollChat();
  }

  appendActivity(a) {
    const who = a.by === this.core.self.name ? 'You' : a.by;
    let text;
    if (a.action === 'pause') text = `${who} paused${a.t != null ? ` at ${formatTime(a.t)}` : ''}`;
    else if (a.action === 'play') text = `${who} pressed play`;
    else if (a.action === 'seek') text = `${who} jumped to ${formatTime(a.t)}`;
    else if (a.action === 'navigate') text = `${who} put on ${a.title || 'something new'}`;
    else if (a.action === 'go-live') text = `${who} jumped to live`;
    else return;
    $('chat-empty').hidden = true;
    $('messages').append(el('li', { class: 'msg activity' }, text));
    this.lastSender = null;
    this.scrollChat();
  }

  scrollChat(force) {
    const box = $('chat-scroll');
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (force || near) requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  }

  openLink(url) {
    if (this.core.canControl()) {
      resolveInput(url).then(u => { if (u) { this.core.control({ action: 'navigate', url: u }); toast('Putting it on for everyone…'); } });
    } else {
      api.app.openExternal(url);
    }
  }

  showTyping(id) {
    const m = this.core.members.get(id);
    if (!m) return;
    this.typingNames.set(id, { name: m.name, until: Date.now() + 3500 });
    this.renderTyping();
    setTimeout(() => this.renderTyping(), 3600);
  }

  renderTyping() {
    const now = Date.now();
    const names = [...this.typingNames.values()].filter(t => t.until > now).map(t => t.name);
    $('typing').textContent = !names.length ? '' : names.length === 1 ? `${names[0]} is typing…` : `${names.slice(0, 2).join(' and ')} are typing…`;
  }

  showReaction(r) {
    if (this.stagePlan().view && this.frozen === 0) { api.stage.react(r); return; }
    const node = el('div', { class: 'reaction', style: { right: `${18 + Math.random() * 20}%`, '--dx': `${Math.round((Math.random() - 0.5) * 120)}px` } },
      el('div', { class: 'e' }, r.emoji), el('div', { class: 'n', style: { boxShadow: `inset 0 0 0 1.5px ${r.color}` } }, r.name));
    $('reaction-layer').append(node);
    setTimeout(() => node.remove(), 3300);
  }

  // ---- stage events ----
  onStageNav(nav) {
    const prev = this.nav.url;
    this.nav = { ...this.nav, ...nav };
    const c = this.core;
    if (c.isHost) {
      const url = this.nav.url;
      if (url && url !== 'about:blank' && url !== c.state.url && nav.url) {
        c.navigate(url, this.nav.title);
        this.local = null;
        this.lastPublished = null;
        this.pendingNav = { url, at: Date.now() };
      } else if (this.nav.title && this.nav.title !== c.state.title && url === c.state.url) {
        c.setTitle(this.nav.title);
      }
      this.flushNavActivity();
    } else if (nav.url && nav.user && this.following && c.state.mode !== 'broadcast' && nav.url !== this.loadedHostUrl && nav.url !== c.state.url) {
      this.following = false;
      toast('You’re browsing on your own. Your video won’t sync until you go back.', { action: 'Go back', onAction: () => this.refollow() });
    }
    if (nav.url && nav.url !== prev) this.notice = null;
    this.render();
  }

  // Announce "X put on <title>" once the page has a real title (or after 2.5s).
  flushNavActivity(force = false) {
    const p = this.pendingNav;
    if (!p || !this.core.isHost) return;
    const titled = this.nav.url === p.url && pageLabel(this.nav.title, p.url) !== describeUrl(p.url);
    if (!titled && !force && Date.now() - p.at < 2500) return;
    this.pendingNav = null;
    this.core.setPlayback(this.core.state.pb, { action: 'navigate', by: this.core.self.name, title: pageLabel(this.nav.title, p.url) });
  }

  onStageVideo(v) {
    const c = this.core;
    const prev = this.local;
    this.local = v ? { ...v, receivedAt: Date.now() } : null;
    if (c.isHost) this.publish(v);
    else if (v?.event && v.user && this.following && c.state.mode !== 'broadcast') {
      const action = v.event === 'seeked' ? { action: 'seek', t: v.t } : (v.event === 'play' || v.event === 'pause') ? { action: v.event, t: v.t } : null;
      if (action) {
        if (c.control(action)) this.userControlUntil = Date.now() + 1500;
        else if (Date.now() - this.controlWarned > 8000) {
          this.controlWarned = Date.now();
          toast(`${c.host?.name ?? 'The host'} controls playback right now.`);
        }
      }
    }
    if (!c.isHost) this.runSync();
    if (!!prev !== !!v || prev?.paused !== v?.paused || this.syncStatus !== this.lastRenderedSync) {
      this.lastRenderedSync = this.syncStatus;
      this.render();
    } else this.renderTransport();
  }

  publish(v) {
    const c = this.core;
    const now = Date.now();
    if (!v) {
      if (this.lastPublished) { c.setPlayback(null); this.lastPublished = null; }
      return;
    }
    let pb = { t: v.t, paused: v.paused, rate: v.rate, at: now, live: v.live, lag: v.lag, duration: v.duration };
    if (v.ad && this.lastPublished) {
      // Host is watching an ad: hold everyone at the last real position.
      pb = { ...this.lastPublished, t: projectedPosition(this.lastPublished, now), paused: true, at: now };
    }
    let activity = null;
    if (this.pendingActivity && (v.event || now - this.pendingActivity.at > 1500)) {
      activity = this.pendingActivity; this.pendingActivity = null;
    } else if (v.event && v.user && !v.ad && ['play', 'pause', 'seeked'].includes(v.event)) {
      activity = { action: v.event === 'seeked' ? 'seek' : v.event, by: c.self.name, t: v.t };
    }
    if (activity || significantChange(this.lastPublished, pb, now) || now - this.lastPublishAt > 2000) {
      c.setPlayback(pb, activity);
      this.lastPublished = pb;
      this.lastPublishAt = now;
    }
  }

  runSync() {
    const c = this.core;
    if (c.isHost || c.state.mode === 'broadcast' || !this.following) return;
    if (Date.now() < this.userControlUntil) return;
    if (!c.state.url) { this.syncStatus = 'idle'; return; }
    const plan = planCorrection(this.local, c.state.pb, this.clock.hostNow(), { localNow: Date.now(), lastSeekAt: this.lastSeekAt });
    if (plan.cmd) {
      api.stage.apply(plan.cmd);
      if (Number.isFinite(plan.cmd.seek) || Number.isFinite(plan.cmd.seekLag)) this.lastSeekAt = Date.now();
    }
    this.syncStatus = plan.status;
    this.drift = plan.drift;
  }

  tick() {
    if (this.pendingNav) this.flushNavActivity();
    if (!this.core.isHost) this.runSync();
    else if (this.pendingActivity && Date.now() - this.pendingActivity.at > 1500 && this.local) this.publish({ ...this.local });
    this.renderTyping();
    if (this.watchingRemote) this.updateStats();
  }

  async updateStats() {
    const pc = this.net.room.getPeers()[this.core.state.broadcaster];
    const s = await inboundStats(pc, this.prevStats).catch(() => null);
    if (!s) return;
    this.prevStats = s;
    const parts = [];
    if (s.height) parts.push(`${s.height}p`);
    if (s.fps) parts.push(`${s.fps} fps`);
    if (s.kbps) parts.push(`${(s.kbps / 1000).toFixed(1)} Mbps`);
    if (s.rtt) parts.push(`${s.rtt} ms`);
    $('stream-stats').textContent = parts.join('  ');
  }

  async reportStatus() {
    const c = this.core;
    if (c.phase !== 'live') return;
    if (!c.isHost && c.hostId) this.conn = await this.net.connectionType(c.hostId);
    c.setStatus({
      sync: c.isHost ? 'host' : (this.following ? this.syncStatus : 'browsing'),
      drift: this.drift,
      follow: this.following,
      conn: this.conn?.kind || null
    });
  }

  refollow() {
    this.following = true;
    this.loadedHostUrl = null;
    this.lastSeekAt = -Infinity;
    this.followHost();
    this.render();
  }

  followHost() {
    const c = this.core;
    if (c.isHost || !this.following || c.state.mode === 'broadcast') return;
    const url = c.state.url;
    if (!url) {
      if (this.loadedHostUrl) { this.loadedHostUrl = null; api.stage.blank(); this.nav = {}; }
      return;
    }
    if (url === this.loadedHostUrl || isPrivateUrl(url)) return;
    this.loadedHostUrl = url;
    this.local = null;
    api.stage.load(url).catch(error => this.setNotice({ title: 'That page didn’t open', body: error.message, actions: [{ label: 'Try again', primary: true, run: () => this.refollow() }] }));
  }

  async onHostChanged({ isHost, wasHost }) {
    this.clock.reset();
    this.lastPublished = null;
    if (isHost) {
      this.following = true;
      this.syncStatus = 'idle';
      this.nav = { ...(await api.stage.navState()) };
      if (this.nav.url && this.nav.url !== 'about:blank') this.core.navigate(this.nav.url, this.nav.title);
      if (this.local) this.publish({ ...this.local });
    } else {
      if (wasHost && this.broadcaster.active) this.broadcaster.stop(false);
      if (this.core.hostId) this.sampleClock(5);
      this.followHost();
    }
    this.render();
  }

  async sampleClock(n) {
    for (let i = 0; i < n; i++) {
      try {
        const t0 = Date.now();
        const hostTime = await this.core.requestClock();
        const t3 = Date.now();
        if (typeof hostTime === 'number') this.clock.add(t0, hostTime, t3);
      } catch {}
      await sleep(120);
    }
  }

  // ---- host applying controls ----
  applyControl(action, who) {
    const name = who?.name || 'Someone';
    switch (action.action) {
      case 'play': api.stage.apply({ paused: false }); break;
      case 'pause': api.stage.apply({ paused: true }); break;
      case 'seek': api.stage.apply({ seek: action.t, paused: this.local?.paused }); break;
      case 'rate': api.stage.apply({ rate: action.rate }); break;
      case 'go-live': api.stage.apply({ goLive: true, paused: false }); break;
      case 'navigate':
        if (this.core.state.mode === 'broadcast' && this.broadcaster.kind !== 'stage') this.broadcaster.stop();
        api.stage.load(action.url).catch(e => toast(`Couldn’t open that: ${e.message}`, { bad: true }));
        this.core.note(`${who?.id === this.core.selfId ? 'You' : name} put on ${describeUrl(action.url)}`);
        return;
    }
    this.pendingActivity = { action: action.action, by: name, t: action.t ?? this.local?.t ?? null, at: Date.now() };
  }

  // ---- user actions ----
  togglePlay() {
    const v = this.local;
    if (!v) return;
    this.core.control({ action: v.paused ? 'play' : 'pause', t: v.t });
    if (!this.core.isHost) {
      this.userControlUntil = Date.now() + 1200;
      api.stage.apply({ paused: !v.paused });
    }
  }

  seekTo(t) {
    if (!this.core.control({ action: 'seek', t })) return;
    if (!this.core.isHost) { this.userControlUntil = Date.now() + 1200; api.stage.apply({ seek: t }); }
  }

  goLive() { this.core.control({ action: 'go-live' }); }

  resync() {
    this.lastSeekAt = -Infinity;
    this.userControlUntil = 0;
    const c = this.core;
    const target = projectedPosition(c.state.pb, this.clock.hostNow());
    if (target != null && !c.state.pb.live) api.stage.apply({ seek: target, paused: c.state.pb.paused, rate: c.state.pb.rate });
    else this.runSync();
    this.sampleClock(3);
  }

  async goTo(text) {
    const url = await resolveInput(text);
    if (!url) return;
    const c = this.core;
    if (c.isHost) {
      if (c.state.mode === 'broadcast' && this.broadcaster.kind !== 'stage') this.broadcaster.stop();
      api.stage.load(url).catch(e => toast(`Couldn’t open that: ${e.message}`, { bad: true }));
    } else if (c.control({ action: 'navigate', url })) {
      toast(`Asked ${c.host?.name ?? 'the host'}’s Sideby to open it for everyone.`);
    } else {
      toast(`${c.host?.name ?? 'The host'} chooses what’s on. Paste the link in chat to suggest it.`);
    }
  }

  async startBroadcast(kind) {
    const c = this.core;
    if (!c.isHost) { toast(`Only the host can broadcast. Ask ${c.host?.name ?? 'them'} to make you host.`); return; }
    if (c.state.mode === 'broadcast') this.broadcaster.stop(false);
    try {
      if (kind === 'file') {
        const file = await api.stage.openFile();
        if (!file) return;
        await api.stage.load(file.url);
        await sleep(500);
        kind = 'stage';
      }
      if (kind === 'stage') {
        if (!this.nav.url || this.nav.url === 'about:blank') { toast('Open a page on the stage first, then broadcast it.'); return; }
        await this.broadcaster.start({ kind: 'stage', quality: settings.quality, label: this.nav.title });
      } else {
        const choice = await pickSource();
        if (!choice) return;
        await this.broadcaster.start({ kind: 'source', sourceId: choice.id, quality: settings.quality, label: choice.name });
        if (!this.broadcaster.hasAudio) toast('Sharing without sound. To include sound, use “Broadcast this page” with the video open on the stage.', { ms: 7000 });
      }
      c.setBroadcasting(true);
    } catch (error) {
      console.error(error);
      toast(error?.name === 'NotAllowedError' ? 'Screen sharing was blocked. On a Mac, allow Sideby in System Settings → Privacy & Security → Screen Recording.' : `Couldn’t start the broadcast: ${error.message || error}`, { bad: true, ms: 8000 });
    }
    this.render();
  }

  stopBroadcast() { this.broadcaster.stop(); }
}

function isPrivateUrl(url) { return /^sideby-media:\/\/player\/.*src=sideby-media(%3A|:)\/\/file/i.test(url) || /^sideby-media:\/\/file\//i.test(url); }

function displayUrl(url) {
  if (!url || url === 'about:blank') return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'sideby-media:') return u.searchParams.get('name') || u.searchParams.get('src') || '';
  } catch {}
  return url;
}

function statusTone(status, drift) {
  const text = describeDrift(status, drift);
  if (['synced', 'live-synced'].includes(status)) return { tone: 'good', text };
  if (['catching-up', 'seeking', 'buffering', 'ad', 'live'].includes(status)) return { tone: 'work', text };
  if (['mismatch', 'no-video'].includes(status)) return { tone: 'bad', text };
  return { tone: 'idle', text: status === 'waiting-host' ? 'Waiting' : '' };
}

function seatStatus(m, core) {
  if (m.isHost) return { tone: 'good', text: 'Host' };
  const st = m.status;
  if (!st) return { tone: 'idle', text: '' };
  if (core.state.mode === 'broadcast') return { tone: 'good', text: st.conn === 'relay' ? 'Watching (relay)' : 'Watching' };
  if (st.sync === 'browsing') return { tone: 'bad', text: 'Browsing' };
  return statusTone(st.sync, st.drift);
}

function linkify(text, onClick) {
  const parts = [];
  const re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const url = m[0];
    parts.push(el('a', { title: 'Put this on', onclick: e => { e.preventDefault(); onClick(url); } }, url.length > 60 ? url.slice(0, 57) + '…' : url));
    last = m.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ---------- dialogs ----------
async function withFrozenStage(fn) {
  await session?.freeze();
  try { return await fn(); } finally { session?.unfreeze(); }
}

function showDialog(dialog) {
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
    dialog.showModal();
  });
}

function openInvite() {
  if (!session) return;
  const name = session.core.state.roomName;
  const text = inviteText(session.code, { name: settings.profile.name, roomName: name });
  $('invite-text').textContent = text;
  $('copy-invite').onclick = async () => { await api.app.copy(text); toast('Invite copied.'); $('invite-dialog').close(); };
  $('copy-code').onclick = async () => { await api.app.copy(formatCode(session.code)); toast('Room code copied.'); $('invite-dialog').close(); };
  return withFrozenStage(() => showDialog($('invite-dialog')));
}

async function pickSource() {
  return withFrozenStage(async () => {
    const dialog = $('picker-dialog');
    const grid = $('picker-grid');
    grid.replaceChildren(el('p', { class: 'fine' }, 'Looking for windows…'));
    let chosen = null;
    const done = new Promise(resolve => {
      $('picker-cancel').onclick = () => dialog.close();
      dialog.addEventListener('close', () => resolve(chosen), { once: true });
    });
    dialog.showModal();
    const result = await api.capture.sources().catch(() => ({ sources: [] }));
    if (result.error === 'screen-permission' || !result.sources.length) {
      $('picker-help').textContent = info.platform === 'darwin'
        ? 'Sideby needs permission to see your screen. Turn it on in System Settings → Privacy & Security → Screen Recording, then quit and reopen Sideby.'
        : 'No windows were found to share.';
      grid.replaceChildren(info.platform === 'darwin' ? el('button', { class: 'btn primary', onclick: () => api.capture.openSettings() }, 'Open Screen Recording settings') : '');
    } else {
      $('picker-help').textContent = info.platform === 'win32' ? 'Pick what to show the room. Your computer’s sound is included.' : 'Pick what to show the room. Sound isn’t included when sharing another app on a Mac, so for videos with sound, open them on the stage and use “Broadcast this page”.';
      const screens = result.sources.filter(s => s.kind === 'screen');
      const windows = result.sources.filter(s => s.kind === 'window');
      grid.replaceChildren(...[...windows, ...screens].map(s => el('button', { class: 'pick', type: 'button', onclick: () => { chosen = s; dialog.close(); } },
        s.thumbnail ? el('img', { class: 'thumb', src: s.thumbnail, alt: '' }) : el('div', { class: 'thumb' }),
        el('span', {}, s.icon ? el('img', { src: s.icon, alt: '' }) : null, s.kind === 'screen' ? `Entire screen${screens.length > 1 ? ` (${s.name})` : ''}` : s.name)
      )));
    }
    return done;
  });
}

async function openSettings() {
  const f = {
    name: $('set-name'), everyone: $('set-everyone'), adblock: $('set-adblock'), quality: $('set-quality'),
    signaling: $('set-signaling'), relay: $('set-relay-urls'), turnUrl: $('set-turn-url'), turnUser: $('set-turn-user'), turnPass: $('set-turn-pass')
  };
  let color = settings.profile.color;
  f.name.value = settings.profile.name;
  renderSwatches($('set-swatches'), color, function pick(c) { color = c; renderSwatches($('set-swatches'), color, pick); });
  f.everyone.checked = session ? session.core.state.everyoneControls : settings.everyoneControls !== false;
  f.everyone.disabled = !!session && !session.core.isHost;
  f.adblock.checked = settings.adblock !== false;
  f.quality.replaceChildren(...Object.entries(QUALITY).map(([k, q]) => el('option', { value: k, selected: k === settings.quality }, q.label)));
  f.signaling.value = settings.signaling?.kind === 'relay' ? 'relay' : 'public';
  f.relay.value = (settings.signaling?.urls || []).join('\n');
  const turn = settings.turn?.[0] || {};
  f.turnUrl.value = [].concat(turn.urls || []).join(', ');
  f.turnUser.value = turn.username || '';
  f.turnPass.value = turn.credential || '';
  const syncRelay = () => { $('relay-url-wrap').hidden = f.signaling.value !== 'relay'; };
  f.signaling.onchange = syncRelay; syncRelay();

  const result = await withFrozenStage(() => showDialog($('settings-dialog')));
  if (result !== 'save') return;
  const name = f.name.value.trim() || settings.profile.name;
  const urls = f.relay.value.split(/\s+/).map(s => s.trim()).filter(s => /^wss?:\/\//i.test(s));
  const turnUrls = f.turnUrl.value.split(/[,\s]+/).map(s => s.trim()).filter(s => /^turns?:/i.test(s));
  await saveSettings({
    profile: { name, color },
    everyoneControls: f.everyone.checked,
    adblock: f.adblock.checked,
    quality: f.quality.value,
    signaling: { kind: f.signaling.value === 'relay' && urls.length ? 'relay' : 'public', urls: f.signaling.value === 'relay' ? urls : [] },
    turn: turnUrls.length ? [{ urls: turnUrls, username: f.turnUser.value.trim() || undefined, credential: f.turnPass.value || undefined }] : []
  });
  if (session) {
    session.core.setProfile(settings.profile);
    if (session.core.isHost) session.core.setEveryoneControls(f.everyone.checked);
    session.render();
  } else renderHome();
  toast('Settings saved.');
}

// ---------- theater / chat ----------
function setTheater(on) {
  document.body.classList.toggle('theater', on);
  api.app.fullscreen(on);
  setTimeout(() => session?.syncBounds(), 50);
}

function toggleChat() {
  document.body.classList.toggle('chat-hidden');
  setTimeout(() => session?.syncBounds(), 30);
}

// ---------- room ui wiring (once) ----------
function wireRoom() {
  $('leave-btn').addEventListener('click', leaveRoom);
  $('invite-btn').addEventListener('click', openInvite);
  $('room-code-chip').addEventListener('click', async () => {
    if (!session) return;
    await api.app.copy(inviteText(session.code, { name: settings.profile.name, roomName: session.core.state.roomName }));
    toast('Invite copied. Paste it to your friends.');
  });
  $('room-settings').addEventListener('click', () => openSettings());
  $('theater-btn').addEventListener('click', () => setTheater(!document.body.classList.contains('theater')));

  const nameEl = $('room-name');
  nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } if (e.key === 'Escape') { nameEl.textContent = session?.core.state.roomName || ''; nameEl.blur(); } });
  nameEl.addEventListener('blur', async () => {
    if (!session?.core.isHost) return;
    const name = nameEl.textContent.trim().slice(0, 60);
    if (name && name !== session.core.state.roomName) {
      session.core.setRoomName(name);
      if (session.personal) await saveSettings({ roomName: name });
    }
    session.render();
  });

  $('nav-back').addEventListener('click', () => api.stage.nav('back'));
  $('nav-forward').addEventListener('click', () => api.stage.nav('forward'));
  $('nav-reload').addEventListener('click', () => api.stage.nav('reload'));
  $('address-form').addEventListener('submit', e => { e.preventDefault(); session?.goTo($('address').value); $('address').blur(); });
  $('address').addEventListener('focus', () => $('address').select());
  $('follow-btn').addEventListener('click', () => session?.refollow());

  for (const b of document.querySelectorAll('.launch')) {
    b.addEventListener('click', () => {
      if (!session) return;
      if (b.dataset.url) session.goTo(b.dataset.url);
      else session.startBroadcast(b.dataset.action);
    });
  }

  const menu = $('broadcast-menu');
  const closeMenu = () => { if (!menu.hidden) { menu.hidden = true; session?.unfreeze(); } };
  $('broadcast-btn').addEventListener('click', async e => {
    e.stopPropagation();
    if (!session) return;
    if (session.core.state.mode === 'broadcast' && session.core.state.broadcaster === session.core.selfId) { session.stopBroadcast(); return; }
    if (!session.core.isHost) { toast(`Only the host can broadcast. Ask ${session.core.host?.name ?? 'them'} to make you host.`); return; }
    if (!menu.hidden) { closeMenu(); return; }
    await session.freeze();
    menu.hidden = false;
  });
  menu.addEventListener('click', e => {
    const item = e.target.closest('[data-broadcast]');
    if (!item) return;
    closeMenu();
    session?.startBroadcast(item.dataset.broadcast);
  });
  document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('.broadcast-wrap')) closeMenu(); });
  $('broadcast-stop').addEventListener('click', () => session?.stopBroadcast());

  $('play-btn').addEventListener('click', () => session?.togglePlay());
  const scrub = $('scrub');
  scrub.addEventListener('input', () => {
    if (!session?.local?.duration) return;
    session.scrubbing = true;
    const t = scrub.value / 1000 * session.local.duration;
    scrub.style.setProperty('--p', `${scrub.value / 10}%`);
    $('time-now').textContent = formatTime(t);
  });
  scrub.addEventListener('change', () => {
    if (!session?.local?.duration) return;
    session.seekTo(scrub.value / 1000 * session.local.duration);
    setTimeout(() => { if (session) session.scrubbing = false; }, 400);
  });
  $('live-btn').addEventListener('click', () => session?.goLive());
  $('resync-btn').addEventListener('click', () => session?.resync());

  let typingAt = 0;
  $('chat-input').addEventListener('input', () => {
    if (session && Date.now() - typingAt > 2500 && $('chat-input').value) { typingAt = Date.now(); session.core.typing(); }
  });
  $('chat-form').addEventListener('submit', e => {
    e.preventDefault();
    const text = $('chat-input').value;
    if (session && text.trim()) { session.core.chat(text); $('chat-input').value = ''; typingAt = 0; }
  });

  document.addEventListener('keydown', e => {
    if (!session) return;
    const typing = e.target.closest?.('input, textarea, [contenteditable=true]') || document.querySelector('dialog[open]');
    if (e.key === 'Escape' && document.body.classList.contains('theater')) { setTheater(false); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); session.togglePlay(); }
    else if (e.key === 'f') setTheater(!document.body.classList.contains('theater'));
    else if (e.key === 'c') toggleChat();
    else if (/^[1-8]$/.test(e.key)) session.core.react(REACTIONS[Number(e.key) - 1]);
  });
}

function wireBridge() {
  api.stage.on('nav', nav => session?.onStageNav(nav));
  api.stage.on('video', v => session?.onStageVideo(v));
  api.stage.on('popup', ({ url }) => {
    if (!session || Date.now() - (session.lastPopupToast || 0) < 8000) return;
    session.lastPopupToast = Date.now();
    toast(`Blocked a pop-up to ${describeUrl(url)}.`, { action: 'Open on stage', onAction: () => {
      if (session.core.isHost) api.stage.load(url);
      else { session.following = false; api.stage.load(url); session.render(); }
    } });
  });
  api.stage.on('load-error', ({ description, url }) => {
    if (!session) return;
    session.setNotice({ title: 'That page didn’t load', body: `${describeUrl(url)} returned “${description}”. Check the link or try again.`, actions: [
      { label: 'Try again', primary: true, run: () => { session.notice = null; api.stage.nav('reload'); session.render(); } },
      { label: 'Dismiss', run: () => session.setNotice(null) }
    ] });
  });
  api.stage.on('crashed', () => session?.setNotice({ title: 'The page stopped working', body: 'Reloading usually fixes it.', actions: [{ label: 'Reload', primary: true, run: () => { session.notice = null; api.stage.nav('reload'); session.render(); } }] }));
  api.stage.on('fullscreen', on => setTheater(on));
  api.stage.on('escape', () => { if (document.body.classList.contains('theater')) setTheater(false); });
  api.app.on('fullscreen', on => { if (!on && document.body.classList.contains('theater')) { document.body.classList.remove('theater'); setTimeout(() => session?.syncBounds(), 50); } });
  api.app.on('focus', () => checkClipboard());
  api.app.on('deeplink', url => handleDeepLink(url));
  api.app.on('menu', action => {
    if (action === 'leave') leaveRoom();
    else if (action === 'toggle-chat') toggleChat();
    else if (action === 'theater') setTheater(!document.body.classList.contains('theater'));
  });
}

function handleDeepLink(url) {
  const code = parseInvite(url);
  if (!code) return;
  if (!settings.profile.name) {
    renderHome();
    $('join-input').value = formatCode(code);
    requireName();
    return;
  }
  enterRoom(code, { asHost: code === settings.personalCode, personal: code === settings.personalCode });
}

// ---------- boot ----------
async function boot() {
  info = await api.app.info();
  settings = await api.settings.get();
  if (!settings.personalCode) await saveSettings({ personalCode: generateCode() });
  document.body.classList.add(info.platform === 'darwin' ? 'mac' : info.platform === 'win32' ? 'win' : 'linux');
  $('app-version').textContent = `Sideby ${info.version}${info.profile ? ` (${info.profile})` : ''}`;
  wireHome();
  wireRoom();
  wireBridge();
  renderHome();
  document.body.classList.remove('booting');
  const link = await api.app.takeDeepLink();
  if (link) handleDeepLink(link);
  // Test hook: SIDEBY_AUTOJOIN lets automated tests drive two copies.
  window.__sideby = { get session() { return session; }, enterRoom, leaveRoom, saveSettings };
}

boot().catch(error => {
  console.error(error);
  document.body.classList.remove('booting');
  document.body.textContent = `Sideby couldn’t start: ${error.message}`;
});
