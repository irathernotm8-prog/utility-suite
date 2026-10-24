'use strict';
// BEAM_DEMO=1 npm start — a pretend neighbourhood for screenshots and UI work: a few devices,
// some history, a transfer on the move and (after a moment) someone asking to send.
const C = require('./core/crypto');

function install(engine) {
  const now = Date.now();
  const mk = (id, name, os, dev, address) => ({ id, name, os, dev, address, port: 47821, pub: C.newKeys().pub, via: 'lan', seen: now + 1e12, addrs: new Map() });
  const peers = [
    mk('demo-studio', 'Studio PC', 'windows', 'desktop', '192.168.1.31'),
    mk('demo-air', 'Kiana’s MacBook Air', 'mac', 'laptop', '192.168.1.40'),
    mk('demo-office', 'Office iMac', 'mac', 'desktop', '192.168.1.22'),
    mk('demo-surface', 'Surface Laptop', 'windows', 'laptop', '192.168.1.57'),
  ];
  for (const p of peers) engine.manual.set(p.id, p);
  const st = engine.settings();
  st.trusted = [{ id: 'demo-studio', name: 'Studio PC', pub: peers[0].pub, os: 'windows', dev: 'desktop', added: now }];
  st.onboarded = true;

  const peer = (p) => ({ id: p.id, name: p.name, os: p.os, dev: p.dev });
  const H = (o) => ({ tid: 'h' + Math.random().toString(36).slice(2), kind: 'files', bytes: o.total, speed: 0, ...o });
  const day = 864e5;
  engine.history = [
    H({ dir: 'in', peer: peer(peers[1]), names: ['Lisbon trip'], tops: 1, count: 214, total: 3.81e9, status: 'done', started: now - 50 * 60e3, ended: now - 49 * 60e3, avg: 104e6, saved: ['/Users/demo/Downloads/Beam/Lisbon trip'] }),
    H({ dir: 'out', kind: 'text', text: 'https://www.figma.com/file/ops-update-q4', peer: peer(peers[2]), names: [], count: 1, total: 41, status: 'done', started: now - 2 * 3600e3, ended: now - 2 * 3600e3 }),
    H({ dir: 'in', phone: true, peer: { id: 'phone', name: 'iPhone', os: 'ios', dev: 'phone' }, names: ['IMG_4120.HEIC', 'IMG_4121.MOV'], tops: 6, count: 6, total: 412e6, status: 'done', started: now - 3 * 3600e3, ended: now - 3 * 3600e3 + 9000, avg: 46e6, saved: ['/Users/demo/Downloads/Beam/IMG_4120.HEIC'] }),
    H({ dir: 'out', peer: peer(peers[0]), names: ['Kiln models'], tops: 1, count: 12, total: 21.4e9, status: 'done', started: now - day - 3600e3, ended: now - day - 3400e3, avg: 112e6 }),
    H({ dir: 'out', peer: peer(peers[3]), names: ['Weekly sign-ups.xlsx'], tops: 1, count: 1, total: 2.2e6, status: 'declined', error: 'Surface Laptop declined.', started: now - day - 7200e3, ended: now - day - 7100e3 }),
    H({ dir: 'in', peer: peer(peers[0]), names: ['Venom storyboards', 'dialogue.docx'], tops: 2, count: 48, total: 880e6, status: 'done', started: now - 2 * day, ended: now - 2 * day + 12000, avg: 98e6, saved: ['/Users/demo/Downloads/Beam/Venom storyboards'] }),
  ];

  // a transfer on the move to the studio PC
  const t = { tid: 'demo-live', dir: 'out', kind: 'files', peer: { ...peer(peers[0]), pub: peers[0].pub }, names: ['Match day edit.mov'], tops: 1, count: 1, total: 8.6e9, bytes: 3.1e9, status: 'active', started: now - 30000, activeSince: now - 30000 };
  engine.transfers.set(t.tid, t);
  let speed = 108e6;
  setInterval(() => {
    speed = 96e6 + Math.random() * 24e6;
    t.bytes = Math.min(t.total * .97, t.bytes + speed / 4); t.speed = speed;
    engine.update(t);
  }, 250);

  setTimeout(() => engine.emitPeers(), 100);
  if (process.env.BEAM_DEMO_ASK !== '0') setTimeout(() => {
    const a = { tid: 'demo-ask', dir: 'in', kind: 'files', peer: { ...peer(peers[1]) }, names: ['Wedding photos', 'Playlist.m3u'], tops: 2, count: 342, total: 6.2e9, bytes: 0, status: 'asking', started: Date.now() };
    engine.transfers.set(a.tid, a);
    engine.update(a, true);
    engine.emit('incoming', engine.snap(a), { keyChanged: false, code: '482 913', tops: 2, list: [{ name: 'Wedding photos', dir: true, count: 341, size: 6.19e9 }, { name: 'Playlist.m3u', dir: false, count: 1, size: 4200 }] });
    a.decide = (ok) => { a.decide = null; engine.emit('asked', a.tid); if (ok) { a.bytes = a.total; a.activeSince = a.started; } engine.finishT(a, ok ? 'done' : 'declined'); };
  }, Number(process.env.BEAM_DEMO_ASK_MS) || 2500);
}

module.exports = { install };
