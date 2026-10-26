// Nearby: your computer in the middle, devices around it, a beam to whoever you're sending to.
'use strict';

const LIVE = ['preparing', 'waiting', 'asking', 'active'];
const liveFor = (id) => [...S.transfers.values()].filter(t => t.peer.id === id && LIVE.includes(t.status));

// spots on two rings: trusted devices on the inner ring, the rest outside. Devices are ordered by id
// (so they keep their order as others come and go) and spread evenly; the outer ring sits half a step
// round from the inner one so the two never line up.
function layout(peers, w, h, avoid = []) {
  const rings = circles(w, h);
  const groups = [peers.filter(p => p.trusted), peers.filter(p => !p.trusted)].map(g => g.slice().sort((x, y) => hash(x.id) - hash(y.id)));
  const ring = (ri, start) => {
    const items = groups[ri], n = items.length, r = rings[ri];
    return items.map((p, i) => { const a = start + i * (Math.PI * 2) / n; return { id: p.id, x: w / 2 + Math.cos(a) * r, y: h / 2 + Math.sin(a) * r }; });
  };
  // how cramped a placement is: the closest two devices, or a device under something on top of the field
  const score = (pts) => {
    let m = Infinity;
    for (let i = 0; i < pts.length; i++) {
      m = Math.min(m, Math.hypot(pts[i].x - w / 2, pts[i].y + 48 - (h / 2 + 18)) + 8);   // its name clear of this computer
      for (const b of avoid) if (pts[i].x > b.x0 - 60 && pts[i].x < b.x1 + 60 && pts[i].y > b.y0 - 50 && pts[i].y < b.y1 + 50) m = Math.min(m, 20);
      for (let j = i + 1; j < pts.length; j++) m = Math.min(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    }
    return m;
  };
  // try a few turns of each ring and keep the roomiest; the first try is the usual layout, so
  // nothing moves unless it has to
  let best = null, bestScore = -1;
  const n0 = groups[0].length, n1 = groups[1].length;
  const s0 = n0 === 1 ? -Math.PI / 2 - .5 : -Math.PI / 2;
  const s1 = -Math.PI / 2 + (n1 > 1 ? Math.PI / n1 : .95) + (n0 ? .35 : 0);
  const d1 = (Math.PI * 2) / Math.max(1, n1) / 8;
  const turns = [0, 1, -1, 2, -2, 3, -3, 4];
  for (const j of n0 > 1 ? [0, 1, -1] : [0, 1, -1, 2, -2]) {
    for (const k of turns) {
      const pts = [...ring(0, s0 + j * .45), ...ring(1, s1 + k * d1)];
      const sc = score(pts);
      if (sc > bestScore + 1) { best = pts; bestScore = sc; }
      if (bestScore >= 150) break;
    }
    if (bestScore >= 150) break;
  }
  return { out: new Map((best || []).map(p => [p.id, p])), rings };
}

// three true circles sized to the field: the outer one for the sweep, two inside it for devices.
// Each device needs ~74 px sideways and ~62 px below for its name, so the device rings stay that far in.
function circles(w, h) {
  const room = Math.min(w / 2 - 74, h / 2 - 62);
  const outer = Math.max(120, Math.min(room, 300));
  const inner = Math.max(115, outer * .64);
  const edge = Math.max(outer + 30, Math.min(outer + 80, w / 2 - 12, h / 2 - 8));
  return [inner, outer, edge];
}

VIEWS.nearby = {
  title: 'Nearby',
  flush: true,
  head() {
    const n = S.peers.length;
    return `<h1>Nearby <small>${n ? plural(n, 'device') : 'Looking…'}</small></h1>`;
  },
  actions() {
    return `<button class="btn sm" id="addAddr"><span data-icon="plus" data-size="15"></span>Add by address</button>
      <button class="btn sm primary" id="pickSend"><span data-icon="send" data-size="15"></span>Send files</button>`;
  },
  render(view) {
    view.innerHTML = `<div class="nearby"><div class="field${S.peers.length ? ' has-peers' : ''}" id="field">
        <div class="rings" id="rings"></div><div class="sweep" id="sweep"></div>
        <svg class="beams" id="beams"><defs><linearGradient id="beamGrad" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#8ef0ff"/><stop offset="1" stop-color="#4f8cff"/></linearGradient></defs></svg>
        <div class="me-orb ${S.settings.receive === 'off' ? 'off' : ''}"><div class="orb">${icon(devIcon(S.me), 34)}</div><b>${esc(S.settings.name)}</b><span>${S.settings.receive === 'off' ? 'Hidden — you can still send' : 'This computer'}</span></div>
        <div id="peers"></div>
        <div id="fieldEmpty"></div>
        <div id="staged"></div>
        <div class="live-stack" id="live"></div>
      </div></div>`;
    this.renderStaged(); this.renderLive(); this.place();
  },
  after() {
    $('#addAddr').onclick = addAddressSheet;
    $('#pickSend').onclick = async () => {
      const paths = await call('pick', 'files').catch(fail);
      if (paths && paths.length) stage(paths);
    };
    if (!this._ro) {
      this._ro = new ResizeObserver(() => { if (S.view === 'nearby') this.place(); });
    }
    this._ro.disconnect(); this._ro.observe($('#field'));
  },

  // draw rings and devices; reuse elements so animations don't restart on every update
  place() {
    const f = $('#field'); if (!f) return;
    const w = f.clientWidth, h = f.clientHeight;
    const fr = f.getBoundingClientRect();
    const avoid = [...f.querySelectorAll('.live-stack .xfer, .staged')].map(el => { const r = el.getBoundingClientRect(); return { x0: r.left - fr.left, x1: r.right - fr.left, y0: r.top - fr.top, y1: r.bottom - fr.top }; });
    const { out, rings } = layout(S.peers, w, h, avoid);
    $('#rings').innerHTML = rings.map((r, i) => `<div class="ring r${i + 1}" style="width:${r * 2}px;height:${r * 2}px"></div>`).join('');
    const sw = $('#sweep');
    sw.style.width = sw.style.height = rings[2] * 2 + 'px';
    const host = $('#peers');
    const seen = new Set();
    for (const p of S.peers) {
      seen.add(p.id);
      let el = host.querySelector(`[data-id="${CSS.escape(p.id)}"]`);
      if (!el) {
        el = document.createElement('button'); el.className = 'peer ' + tintOf(p.id); el.dataset.id = p.id;
        host.appendChild(el);
        el.onclick = (e) => { const peer = S.peers.find(x => x.id === p.id); if (peer) { if (S.staged.length) sendStaged(peer); else peerMenu(el.querySelector('.bub'), peer); } };
        el.oncontextmenu = (e) => { e.preventDefault(); const peer = S.peers.find(x => x.id === p.id); if (peer) peerMenu(el.querySelector('.bub'), peer); };
        el.addEventListener('dragenter', (e) => { e.preventDefault(); el.classList.add('drop'); });
        el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('drop'); });
        el.addEventListener('dragleave', () => el.classList.remove('drop'));
        el.addEventListener('drop', (e) => {
          e.preventDefault(); e.stopPropagation(); el.classList.remove('drop'); endDrag();
          const paths = droppedPaths(e); const peer = S.peers.find(x => x.id === p.id);
          if (paths.length && peer) sendTo(peer, paths);
        });
      }
      const pos = out.get(p.id) || { x: w / 2, y: h / 2 };
      el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px';
      this.paintPeer(el, p);
    }
    host.querySelectorAll('.peer').forEach(el => { if (!seen.has(el.dataset.id)) el.remove(); });
    $('#field').classList.toggle('has-peers', S.peers.length > 0);
    const empty = $('#fieldEmpty');
    empty.innerHTML = S.peers.length ? '' : `<div class="field-empty"><b>Looking for devices…</b><span>Open Beam on your other Mac or PC and it shows up here — on Wi-Fi or plugged in, as long as it’s the same router. On a separate network, VLAN or guest Wi-Fi? Add it by its address.</span>
      <div class="row"><button class="btn sm" id="emAdd"><span data-icon="plus" data-size="15"></span>Add by address</button><button class="btn sm" id="emPhone"><span data-icon="qr" data-size="15"></span>Phone or tablet</button></div></div>`;
    if (!S.peers.length) { $('#emAdd').onclick = addAddressSheet; $('#emPhone').onclick = () => go('phone'); hydrateIcons(empty); }
    this.drawBeams();
  },

  paintPeer(el, p) {
    const live = liveFor(p.id);
    const t = live[0];
    const pct = t && t.total ? Math.min(1, t.bytes / t.total) : 0;
    const C = 2 * Math.PI * 41;
    const sub = t
      ? (t.status === 'asking' ? 'Wants to send' : t.status === 'waiting' ? 'Waiting for them…' : t.status === 'preparing' ? 'Getting ready…' : `${Math.floor(pct * 100)}% · ${human(t.speed)}/s`)
      : null;
    const key = JSON.stringify([p.name, p.trusted, p.keyChanged, p.os, p.dev, sub, Math.round(pct * 200), S.staged.length > 0]);
    if (el._key === key) return; el._key = key;
    el.classList.toggle('staged-ready', S.staged.length > 0 && !t);
    el.title = S.staged.length ? `Send to ${p.name}` : `${p.name} — click for options, or drop files here`;
    el.innerHTML = `<span class="bub">${icon(devIcon(p), 28)}
        ${t && t.status === 'active' ? `<svg class="pring" viewBox="0 0 90 90"><circle class="bg" cx="45" cy="45" r="41"/><circle class="fg" cx="45" cy="45" r="41" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>` : ''}
        ${p.keyChanged ? `<span class="badge warn" title="This device's key changed">${icon('alert', 13)}</span>` : p.trusted ? `<span class="badge" title="Trusted">${icon('shield', 13)}</span>` : ''}</span>
      <span class="pname">${esc(p.name)}</span>
      ${sub ? `<span class="pstat">${esc(sub)}</span>` : `<span class="psub">${esc(osName(p.os) || 'Device')}${p.via === 'saved' ? ' · by address' : ''}</span>`}`;
  },

  drawBeams() {
    const svg = $('#beams'), f = $('#field'); if (!svg || !f) return;
    const w = f.clientWidth, h = f.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const lines = [];
    for (const p of S.peers) {
      const live = liveFor(p.id); if (!live.length) continue;
      const el = $(`#peers [data-id="${CSS.escape(p.id)}"]`); if (!el) continue;
      const x = parseFloat(el.style.left), y = parseFloat(el.style.top);
      const cx = w / 2, cy = h / 2;
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
      const x1 = cx + dx / d * 52, y1 = cy + dy / d * 52, x2 = x - dx / d * 44, y2 = y - dy / d * 44;
      const t = live[0];
      if (t.status === 'active') {
        const g = `g${hash(p.id)}`;
        lines.push(`<linearGradient id="${g}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${t.dir === 'out' ? '#8ef0ff' : '#4fd18b'}"/><stop offset="1" stop-color="${t.dir === 'out' ? '#4f8cff' : '#8ef0ff'}"/></linearGradient>
          <line class="bm-glow" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:url(#${g})"/><line class="bm-core" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:url(#${g})"/>
          <line class="bm-dash ${t.dir}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
      } else lines.push(`<line class="bm-wait" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
    }
    const defs = svg.querySelector('defs').outerHTML;
    const html = defs + lines.join('');
    if (svg._html !== html) { svg.innerHTML = html; svg._html = html; }
  },

  renderStaged() {
    const host = $('#staged'); if (!host) return;
    if (!S.staged.length) { host.innerHTML = ''; return; }
    const info = S.stagedInfo;
    const size = info.reduce((a, x) => a + (x.size || 0), 0);
    const hasDir = info.some(x => x.dir);
    const label = info.length === 1 ? info[0].name : `${plural(S.staged.length, 'item')}`;
    host.innerHTML = `<div class="staged"><div class="st-thumbs">${info.slice(0, 3).map(x => `<span class="tile sm a-blue">${icon(fileIcon(x.name, x.dir), 14)}</span>`).join('')}</div>
      <div class="st-text"><b class="ellip" style="max-width:320px">${esc(label)}${size ? ` · ${human(size)}${hasDir ? '+' : ''}` : ''}</b><span>${S.peers.length ? 'Now click a device to send' : 'Waiting for a device to show up…'}</span></div>
      <button class="icon-btn sm" id="unstage" title="Clear">${icon('x', 16)}</button></div>`;
    $('#unstage').onclick = async () => { await call('unstage'); S.staged = []; S.stagedInfo = []; refresh(['nearby']); };
  },

  renderLive() {
    const host = $('#live'); if (!host) return;
    const list = [...S.transfers.values()].sort((a, b) => b.started - a.started).slice(0, 4);
    host.innerHTML = list.map(xferCard).join('');
    wireXfers(host);
  },

  // light update while bytes move: no full re-render
  tick() {
    if (S.view !== 'nearby' || !$('#field')) return;
    for (const p of S.peers) { const el = $(`#peers [data-id="${CSS.escape(p.id)}"]`); if (el) this.paintPeer(el, p); }
    this.drawBeams(); this.renderLive();
  },
};

// one transfer as a card (used on Nearby)
function xferCard(t) {
  const pct = t.total ? Math.min(100, (t.bytes / t.total) * 100) : (t.status === 'done' ? 100 : 0);
  const left = t.speed > 0 && t.total ? (t.total - t.bytes) / t.speed : null;
  const title = t.dir === 'out' ? `To ${t.peer.name}` : `From ${t.peer.name}`;
  let msg = '';
  if (t.status === 'preparing') msg = t.note || 'Getting the files ready…';
  else if (t.status === 'waiting') msg = `Waiting for ${t.peer.name} to accept…`;
  else if (t.status === 'asking') msg = 'Waiting for you to accept';
  else if (t.status === 'active') msg = '';
  else if (t.status === 'done') msg = t.kind === 'text' ? (t.dir === 'in' ? 'Copied to the clipboard' : 'Delivered') : `Done${t.avg ? ` · ${human(t.avg)}/s average` : ''}`;
  else if (t.status === 'declined') msg = t.error || 'Declined';
  else if (t.status === 'cancelled') msg = t.error || 'Cancelled';
  else msg = t.error || 'Failed';
  const live = LIVE.includes(t.status);
  return `<div class="xfer ${t.status}" data-tid="${esc(t.tid)}">
    <div class="x-top"><span class="x-dir ${t.dir}">${icon(t.dir === 'out' ? 'arrowUp' : 'arrowDown', 16)}</span>
      <div class="grow" style="min-width:0"><div class="x-title"><span class="ellip">${esc(whatOf(t))}</span></div>
      <div class="x-sub"><span class="ellip">${esc(title)}</span>${t.total && t.kind !== 'text' ? `<span>· ${human(t.total)}</span>` : ''}</div></div>
      ${live ? `<button class="icon-btn xs" data-act="cancel" title="Cancel">${icon('x', 14)}</button>` : `<button class="icon-btn xs" data-act="dismiss" title="Dismiss">${icon('x', 14)}</button>`}</div>
    ${t.kind !== 'text' && (t.status === 'active' || t.status === 'done' || t.bytes > 0) ? `<div class="bar ${t.status === 'waiting' ? 'indet' : ''}"><i style="width:${pct}%"></i></div>` : t.status === 'waiting' || t.status === 'preparing' ? '<div class="bar indet"><i></i></div>' : ''}
    ${t.status === 'active' ? `<div class="x-sub"><b>${human(t.bytes)}</b> of ${human(t.total)}<span class="grow"></span><span class="x-speed">${human(t.speed)}/s</span>${left != null && left < 864000 ? `<span>· ${dur(left)} left</span>` : ''}</div>${t.note ? `<div class="x-msg">${esc(t.note)}</div>` : ''}` : msg ? `<div class="x-msg">${esc(msg)}</div>` : ''}
    ${t.status === 'done' && t.dir === 'in' && t.saved && t.saved.length ? `<div class="x-actions"><button class="btn xs" data-act="show">${icon('reveal', 13)}Show</button>${t.saved.length === 1 ? `<button class="btn xs" data-act="open">${icon('external', 13)}Open</button>` : ''}</div>` : ''}
    ${t.status === 'done' && t.kind === 'text' && t.dir === 'in' && isLink(t.text) ? `<div class="x-actions"><button class="btn xs" data-act="url">${icon('external', 13)}Open link</button></div>` : ''}
    ${t.retryable ? `<div class="x-actions"><button class="btn xs" data-act="retry">${icon('refresh', 13)}Retry</button></div>` : ''}
    ${t.status === 'asking' ? `<div class="x-actions"><button class="btn xs primary" data-act="review">Review</button></div>` : ''}
  </div>`;
}
function wireXfers(host) {
  host.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
    const tid = b.closest('[data-tid]').dataset.tid;
    const t = S.transfers.get(tid) || S.history.find(x => x.tid === tid);
    const act = b.dataset.act;
    try {
      if (act === 'cancel') await call('cancel', tid);
      else if (act === 'dismiss') { S.transfers.delete(tid); refresh(['nearby']); }
      else if (act === 'retry') await call('retry', tid);
      else if (act === 'show') await call('show', t.saved[0]);
      else if (act === 'open') await call('open', t.saved[0]);
      else if (act === 'url') await call('openUrl', t.text.trim());
      else if (act === 'review') { const a = S.asking.find(x => x.t.tid === tid); if (a) askSheet(a); }
    } catch (e) { fail(e); }
  });
}

function addAddressSheet() {
  const el = openSheet(`<div class="sheet-head"><span class="tile md a-sky" data-icon="globe" data-size="18"></span><div class="grow"><h3>Add a device by its address</h3><div class="muted small">For a computer Beam can’t see by itself — on another subnet, VLAN or behind a router that blocks discovery.</div></div></div>
    <div class="sheet-body"><div class="field"><label>Address</label><input class="input" id="addr" placeholder="192.168.1.24 or name.local" spellcheck="false"></div>
      <div class="hint">On the other computer, the address is in Beam › Settings › About. Beam remembers it and checks for it automatically.</div><div class="hint" id="addrErr" style="color:var(--bad)"></div></div>
    <div class="sheet-foot"><span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="ok">Add</button></div>`, { width: 500 });
  hydrateIcons(el);
  el.querySelector('[data-x]').onclick = closeSheet;
  const go = async () => {
    const b = el.querySelector('#ok'); b.disabled = true; b.innerHTML = '<span class="spin"></span>Looking…';
    try { const r = await call('addAddress', el.querySelector('#addr').value); closeSheet(); toast(`Found ${r.name}`); }
    catch (e) { el.querySelector('#addrErr').textContent = e.message; b.disabled = false; b.textContent = 'Add'; }
  };
  el.querySelector('#ok').onclick = go;
  el.querySelector('#addr').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

// ───────── someone wants to send
function askSheet(a) {
  const { t, meta } = a;
  const tint = tintOf(t.peer.id);
  const list = meta.list && meta.list.length ? meta.list : (t.names || []).map(x => ({ name: x }));
  const items = list.map(x => `<div>${icon(fileIcon(x.name, x.dir), 16)}<span class="grow ellip">${esc(x.name)}</span>${x.dir ? `<span class="muted small">${plural(x.count, 'file')}</span>` : x.size != null ? `<span class="muted small">${human(x.size)}</span>` : ''}</div>`).join('');
  const more = (meta.tops || 0) - list.length;
  const el = openSheet(`<div class="sheet-body ask">
      <div class="ask-av ${tint}"><span class="bub">${icon(devIcon(t.peer), 32)}</span></div>
      <h3>${esc(t.peer.name)}</h3>
      <div class="ask-what">wants to send you ${t.kind === 'text' ? (isLink(t.text) ? 'a link' : 'some text') : `${plural(t.count, 'file')} · <b>${human(t.total)}</b>`}</div>
      ${t.kind === 'text' ? `<div class="ask-text">${esc(t.text)}</div>` : `<div class="ask-items">${items}${more > 0 ? `<div class="muted">${icon('more', 16)}and ${more} more</div>` : ''}</div>`}
      ${meta.keyChanged ? `<div class="warnbox">${icon('alert', 16)}<div><b>This isn’t the key ${esc(t.peer.name)} used before.</b> If they didn’t reinstall Beam, someone else may be using their name. Safety code: <span class="code">${esc(meta.code)}</span></div></div>` : ''}
      <label class="check"><input type="checkbox" id="trust"> Always accept from ${esc(t.peer.name)} <span class="muted small">(code <span class="code">${esc(meta.code)}</span>)</span></label>
    </div>
    <div class="sheet-foot"><span class="muted small" id="askLeft"></span><span class="grow"></span><button class="btn" id="no">Decline</button><button class="btn primary" id="yes">${icon('check', 15)}Accept</button></div>`, { width: 460, cls: 'sticky' });
  el.querySelector('#no').onclick = () => { call('respond', t.tid, false); doneAsk(t.tid); };
  el.querySelector('#yes').onclick = () => { call('respond', t.tid, true, el.querySelector('#trust').checked); doneAsk(t.tid); };
  S.askOpen = t.tid;
}
function doneAsk(tid) {
  S.asking = S.asking.filter(x => x.t.tid !== tid);
  if (S.askOpen === tid) { S.askOpen = null; closeSheet(); }
  if (S.asking.length && !S.askOpen) askSheet(S.asking[0]);
}

// ───────── dragging files into the window
let dragDepth = 0;
function endDrag() { dragDepth = 0; document.body.classList.remove('dragging'); $$('.peer.drop').forEach(x => x.classList.remove('drop')); }
function droppedPaths(e) { return [...(e.dataTransfer.files || [])].map(f => B.pathFor(f)).filter(Boolean); }
addEventListener('dragenter', (e) => { if ([...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); if (S.view !== 'nearby' && S.view !== 'phone') go('nearby'); } });
addEventListener('dragover', (e) => { e.preventDefault(); });
addEventListener('dragleave', () => { if (--dragDepth <= 0) endDrag(); });
addEventListener('drop', (e) => {
  e.preventDefault();
  const zone = e.target.closest && e.target.closest('.dropzone');
  endDrag();
  if (zone) return;  // the phone view handles its own drop zone
  const paths = droppedPaths(e);
  if (paths.length) stage(paths);
});
