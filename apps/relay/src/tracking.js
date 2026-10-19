// Relay — package tracking hub.
// Carrier detection works offline. Status/ETAs are read from each carrier's own tracking page by the
// renderer (track:apply-page). 17TRACK's paid API is optional and used only when a key is set.
const crypto = require('crypto');
const { ipcMain, Notification } = require('electron');
const Carriers = require('./shared/carriers');

let ctx = null; // { getStore, saveStore, getWin, encryptKey, decryptKey }
const BASE = process.env.RELAY_17TRACK_BASE || 'https://api.17track.net';
const REFRESH_MS = 2 * 60 * 60 * 1000;
const STATUS = {
  NotFound: 'pending', InfoReceived: 'info_received', InTransit: 'in_transit', Expired: 'expired',
  AvailableForPickup: 'pickup', OutForDelivery: 'out_for_delivery', DeliveryFailure: 'exception',
  Delivered: 'delivered', Exception: 'exception'
};
const LABEL = {
  pending: 'Waiting for carrier', info_received: 'Label created', in_transit: 'In transit', pickup: 'Ready for pickup',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered', exception: 'Delivery problem', expired: 'Tracking expired', unknown: 'Not checked yet'
};

const list = () => { const s = ctx.getStore(); return (s.packages = s.packages || []); };
const key = () => ctx.decryptKey(ctx.getStore().settings.track17Key || '');
const send = (ch, d) => { const w = ctx.getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, d); };

async function api(endpoint, body) {
  const k = key();
  if (!k) throw new Error('NO_KEY');
  const res = await fetch(`${BASE}/track/v2.2/${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json', '17token': k }, body: JSON.stringify(body)
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j.code != null && j.code !== 0)) throw new Error(j?.data?.errors?.[0]?.message || j?.message || `17TRACK error ${res.status}`);
  return j.data || {};
}

function itemFor(p) {
  const code = Carriers.info(p.carrier).code17;
  return code ? { number: p.number, carrier: code } : { number: p.number };
}

function applyTrackInfo(p, ti) {
  if (!ti) return false;
  const before = p.status;
  const st = ti.latest_status?.status;
  p.status = STATUS[st] || p.status || 'pending';
  p.statusText = LABEL[p.status];
  const prov = ti.tracking?.providers?.[0];
  const evs = prov?.events || [];
  if (evs.length) p.events = evs.slice(0, 60).map(e => ({ time: e.time_iso || e.time_utc || e.time_raw?.date || '', desc: e.description || '', location: e.location || '', stage: e.stage || '' }));
  if (ti.latest_event?.description) { p.lastEvent = ti.latest_event.description; p.lastLocation = ti.latest_event.location || ''; }
  const eta = ti.time_metrics?.estimated_delivery_date;
  if (eta && (eta.from || eta.to)) p.eta = { from: eta.from || eta.to, to: eta.to || eta.from, source: 'carrier' };
  if (p.status === 'delivered') {
    const d = evs.find(e => /deliver/i.test(e.stage || e.description || ''));
    p.deliveredAt = d?.time_iso || p.deliveredAt || new Date().toISOString();
  }
  if (prov?.provider?.name && p.carrier === 'other') p.carrierName = prov.provider.name;
  p.lastChecked = Date.now();
  p.error = null;
  return before !== p.status;
}

function notify(p) {
  if (!Notification.isSupported()) return;
  const name = p.name || `${Carriers.info(p.carrier).name} package`;
  const body = p.status === 'delivered' ? 'Delivered' + (p.lastLocation ? ` — ${p.lastLocation}` : '')
    : p.status === 'out_for_delivery' ? 'Out for delivery today'
    : p.status === 'exception' ? (p.lastEvent || 'There’s a problem with this delivery')
    : p.statusText;
  new Notification({ title: `📦 ${name}`, body, silent: false, ...(process.platform === 'darwin' ? {} : { icon: require('path').join(__dirname, '..', 'build', 'icon.png') }) }).show();
}

async function refresh(ids) {
  const pk = list().filter(p => (!ids || ids.includes(p.id)) && !p.archived);
  if (!pk.length || !key()) return list();
  // Register first (17TRACK ignores numbers it already knows), then fetch — 40 per request
  for (let i = 0; i < pk.length; i += 40) {
    const chunk = pk.slice(i, i + 40);
    try {
      const fresh = chunk.filter(p => !p.registered);
      if (fresh.length) {
        const r = await api('register', fresh.map(itemFor));
        const ok = new Set([...(r.accepted || []).map(a => a.number), ...(r.rejected || []).filter(x => /already|registered/i.test(x.error?.message || '') || x.error?.code === -18019901).map(x => x.number)]);
        fresh.forEach(p => { if (ok.has(p.number)) p.registered = true; else p.error = (r.rejected || []).find(x => x.number === p.number)?.error?.message || p.error; });
      }
      const info = await api('gettrackinfo', chunk.map(itemFor));
      for (const a of info.accepted || []) {
        const p = chunk.find(x => x.number === a.number);
        if (p && applyTrackInfo(p, a.track_info) && ['out_for_delivery', 'delivered', 'exception', 'pickup'].includes(p.status) && !p.muted) notify(p);
      }
      for (const r of info.rejected || []) { const p = chunk.find(x => x.number === r.number); if (p) { p.error = r.error?.message || 'Not found yet'; p.lastChecked = Date.now(); } }
    } catch (e) {
      chunk.forEach(p => { p.error = e.message === 'NO_KEY' ? null : e.message; });
    }
  }
  ctx.saveStore();
  send('track:changed', list());
  return list();
}

function register(c) {
  ctx = c;
  ipcMain.handle('track:list', () => list());
  ipcMain.handle('track:add', async (_e, input) => {
    const number = Carriers.clean(input.number);
    if (!number) throw new Error('Enter a tracking number');
    const existing = list().find(p => p.number === number);
    if (existing) return { list: list(), id: existing.id, existed: true };
    const carrier = input.carrier || Carriers.detect(number) || 'other';
    const p = {
      id: crypto.randomUUID(), number, carrier, carrierName: Carriers.info(carrier).name,
      name: input.name || '', source: input.source || null, eta: input.eta || null,
      status: 'unknown', statusText: LABEL.unknown, events: [], addedAt: Date.now(), archived: false
    };
    list().unshift(p);
    ctx.saveStore();
    if (key()) await refresh([p.id]);
    return { list: list(), id: p.id };
  });
  ipcMain.handle('track:update', (_e, patch) => {
    const p = list().find(x => x.id === patch.id);
    if (p) Object.assign(p, patch, patch.carrier ? { carrierName: Carriers.info(patch.carrier).name, registered: false } : {});
    ctx.saveStore();
    return list();
  });
  ipcMain.handle('track:remove', (_e, id) => {
    const s = ctx.getStore();
    s.packages = list().filter(p => p.id !== id);
    ctx.saveStore();
    return s.packages;
  });
  ipcMain.handle('track:refresh', (_e, ids) => refresh(ids));
  // Status read straight off the carrier's own tracking page (no API needed)
  ipcMain.handle('track:apply-page', (_e, { id, status, eta, event, location, via }) => {
    const p = list().find(x => x.id === id);
    if (!p) return list();
    const before = p.status;
    if (status && LABEL[status]) { p.status = status; p.statusText = LABEL[status]; }
    if (eta && !isNaN(new Date(eta)) && p.status !== 'delivered') p.eta = { from: eta, to: eta, source: 'page' };
    if (event) {
      p.lastEvent = event;
      p.events = p.events || [];
      if (!p.events.length || p.events[0].desc !== event) p.events.unshift({ time: new Date().toISOString(), desc: event, location: location || '', stage: status || '' });
      if (p.events.length > 40) p.events.length = 40;
    }
    if (location) p.lastLocation = location;
    if (p.status === 'delivered' && !p.deliveredAt) p.deliveredAt = new Date().toISOString();
    p.lastChecked = Date.now();
    p.checkedVia = via || 'page';
    p.error = null;
    if (before && before !== 'unknown' && before !== p.status && ['out_for_delivery', 'delivered', 'exception', 'pickup'].includes(p.status) && !p.muted) notify(p);
    ctx.saveStore();
    send('track:changed', list());
    return list();
  });
  ipcMain.handle('track:has-key', () => !!key());
  ipcMain.handle('track:set-key', async (_e, k) => {
    ctx.getStore().settings.track17Key = k ? ctx.encryptKey(k.trim()) : '';
    list().forEach(p => { p.registered = false; });
    ctx.saveStore();
    if (k) await refresh();
    return !!k;
  });
  // keep active packages fresh
  setInterval(() => refresh(), REFRESH_MS);
  setTimeout(() => refresh(), 20000);
}

module.exports = { register, LABEL };
