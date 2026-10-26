'use strict';
// Finding other Beam devices on the same network, with nothing to set up.
// Each device says hello every few seconds over UDP: to a multicast group and to every
// network's broadcast address (so it works on Wi-Fi and wired, Mac and Windows, even where one of
// the two is filtered). A newcomer asks "who's there?" and everyone answers straight away.
// Saved addresses (devices on another subnet or behind a router that drops multicast) are asked
// directly, so they show up too.
const dgram = require('dgram');
const os = require('os');
const { EventEmitter } = require('events');

const GROUP = '239.255.77.21';
const UDP_PORT = 47820;
const MAGIC = 'BEAM1 ';
const EVERY = 3000;
const GONE = 11000;
const SWEEP = 30000;          // ask every address on our own networks directly this often
const SWEEP_MAX = 1022;       // …on networks up to a /22 (1,022 addresses)

const VIRTUAL = /^(lo|utun|awdl|llw|bridge|vmnet|vboxnet|docker|veth|br-|virbr|zt|tailscale|vEthernet|VirtualBox|VMware|Hyper-V|Loopback|isatap|Teredo|anpi|ap\d)/i;

// IPv4 addresses on real networks (skips loopback and most virtual adapters), best first.
function interfaces() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;
      const ip = a.address.split('.').map(Number), m = a.netmask.split('.').map(Number);
      const bcast = ip.map((x, i) => (x & m[i]) | (~m[i] & 255)).join('.');
      const virtual = VIRTUAL.test(name);
      // Wi-Fi / Ethernet first (en0, en1, Wi-Fi, Ethernet), then everything else
      const rank = virtual ? 9 : /^(en0|wi-?fi|wlan|wl)/i.test(name) ? 0 : /^(en|eth|ethernet)/i.test(name) ? 1 : 5;
      out.push({ name, address: a.address, netmask: a.netmask, broadcast: bcast, virtual, rank });
    }
  }
  return out.sort((a, b) => a.rank - b.rank);
}

function sameSubnet(a, b, mask) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number), m = mask.split('.').map(Number);
  return x.every((v, i) => (v & m[i]) === (y[i] & m[i]));
}

class Discovery extends EventEmitter {
  // me(): { id, name, os, dev, port, pub, visible } — read fresh each time so renames show at once.
  constructor({ me, udpPort = UDP_PORT, group = GROUP, every = EVERY, gone = GONE, sweepEvery = SWEEP, extraTargets = () => [] }) {
    super();
    this.me = me; this.udpPort = udpPort; this.group = group; this.every = every; this.gone = gone; this.sweepEvery = sweepEvery;
    this.lastSweep = 0; this.ifKey = '';
    this.extraTargets = extraTargets;
    this.peers = new Map();
    this.joined = new Set();
    this.sock = null; this.timer = null;
  }

  start() {
    return new Promise((resolve) => {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.sock = s;
      s.on('error', (e) => { this.emit('warn', 'Discovery: ' + e.message); });
      s.on('message', (buf, rinfo) => this.onMessage(buf, rinfo));
      s.bind(this.udpPort, () => {
        try { s.setBroadcast(true); } catch {}
        try { s.setMulticastTTL(1); } catch {}
        try { s.setMulticastLoopback(true); } catch {}
        this.joinAll();
        this.send('q');
        this.sweep();
        this.timer = setInterval(() => this.tick(), this.every);
        resolve();
      });
    });
  }

  stop() {
    clearInterval(this.timer); this.timer = null;
    if (this.sock) { try { this.send('bye'); } catch {} const s = this.sock; this.sock = null; setTimeout(() => { try { s.close(); } catch {} }, 50); }
  }

  joinAll() {
    const ifs = interfaces();
    const now = new Set(ifs.map(i => i.address));
    for (const i of ifs) {
      if (this.joined.has(i.address)) continue;
      try { this.sock.addMembership(this.group, i.address); this.joined.add(i.address); } catch {}
    }
    for (const a of [...this.joined]) if (!now.has(a)) { try { this.sock.dropMembership(this.group, a); } catch {} this.joined.delete(a); }
    if (!ifs.length && !this.joined.has('*')) { try { this.sock.addMembership(this.group); this.joined.add('*'); } catch {} }
  }

  packet(t) {
    const m = this.me();
    return Buffer.from(MAGIC + JSON.stringify({ t, v: 1, id: m.id, name: m.name, os: m.os, dev: m.dev, port: m.port, pub: m.pub, ver: m.ver }));
  }

  // to the group on every interface, to every broadcast address, and to saved addresses
  send(t, only) {
    if (!this.sock) return;
    const m = this.me();
    if (t === 'hi' && !m.visible) return;
    const buf = this.packet(t);
    const go = (addr, port = this.udpPort) => { try { this.sock.send(buf, port, addr); } catch {} };
    if (only) return go(only.address, only.port);
    const ifs = interfaces();
    for (const i of ifs) {
      try { this.sock.setMulticastInterface(i.address); } catch {}
      go(this.group);
    }
    if (!ifs.length) go(this.group);
    for (const i of ifs) go(i.broadcast);
    go('255.255.255.255');
    for (const a of this.extraTargets()) go(a);
    // and straight to every device we already know, so we stay visible to each other even where
    // the network drops multicast and broadcast between Wi-Fi and wired (many mesh systems and APs do)
    for (const p of this.peers.values()) for (const a of p.addrs.keys()) go(a);
  }

  // Ask every address on our own networks “who's there?” with a tiny unicast packet. Unicast gets
  // through where multicast/broadcast between Wi-Fi and Ethernet is filtered; Beam answers back the same way.
  sweep() {
    if (!this.sock) return;
    this.lastSweep = Date.now();
    const buf = this.packet('q');
    const toInt = (a) => a.split('.').reduce((n, x) => (n * 256) + Number(x), 0);
    const toIp = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    const seen = new Set();
    for (const i of interfaces()) {
      if (i.virtual) continue;
      const ip = toInt(i.address), mask = toInt(i.netmask) >>> 0;
      const net = (ip & mask) >>> 0, size = (~mask >>> 0) + 1;
      if (size - 2 > SWEEP_MAX || size < 4) continue;
      for (let h = net + 1; h < net + size - 1; h++) {
        if (h === ip || seen.has(h)) continue;
        seen.add(h);
        try { this.sock.send(buf, this.udpPort, toIp(h)); } catch {}
      }
    }
  }

  tick() {
    this.joinAll();
    this.send('hi');
    const key = interfaces().map(i => i.address + '/' + i.netmask).join(',');
    if (key !== this.ifKey || Date.now() - this.lastSweep > this.sweepEvery) { this.ifKey = key; this.sweep(); }
    const now = Date.now();
    for (const [id, p] of this.peers) {
      if (now - p.seen > this.gone) { this.peers.delete(id); this.emit('lost', p); }
    }
  }

  onMessage(buf, rinfo) {
    if (buf.length > 4096 || buf.toString('latin1', 0, MAGIC.length) !== MAGIC) return;
    let msg;
    try { msg = JSON.parse(buf.toString('utf8', MAGIC.length)); } catch { return; }
    const me = this.me();
    if (!msg || typeof msg.id !== 'string' || msg.id === me.id) return;
    if (msg.t === 'bye') {
      const p = this.peers.get(msg.id);
      if (p) { this.peers.delete(msg.id); this.emit('lost', p); }
      return;
    }
    if (msg.t === 'q') { if (me.visible) this.send('hi', { address: rinfo.address, port: rinfo.port }); return; }
    if (msg.t !== 'hi' || !msg.port || !msg.pub) return;
    this.see({ id: msg.id, name: String(msg.name || 'Device').slice(0, 80), os: msg.os, dev: msg.dev, port: Number(msg.port), pub: msg.pub, ver: msg.ver }, rinfo.address, 'lan');
  }

  // record a device seen at an address (from UDP, or from a direct hello to a saved address)
  see(info, address, via) {
    const prev = this.peers.get(info.id);
    const p = prev || { id: info.id, addrs: new Map() };
    const changed = !prev || prev.name !== info.name || prev.port !== info.port || prev.pub !== info.pub || prev.address !== address;
    Object.assign(p, { name: info.name, os: info.os, dev: info.dev, port: info.port, pub: info.pub, ver: info.ver, seen: Date.now(), via: prev && prev.via === 'lan' ? 'lan' : via });
    p.addrs.set(address, Date.now());
    p.address = this.bestAddress(p);
    this.peers.set(info.id, p);
    if (changed) this.emit('peer', p, !prev);
  }

  // prefer an address on one of our own subnets, then the most recently heard one
  bestAddress(p) {
    const ifs = interfaces();
    const list = [...p.addrs.entries()].filter(([, t]) => Date.now() - t < this.gone * 2).sort((a, b) => b[1] - a[1]);
    const local = list.find(([a]) => ifs.some(i => sameSubnet(a, i.address, i.netmask)));
    return (local || list[0] || [p.address])[0];
  }

  list() { return [...this.peers.values()]; }
  get(id) { return this.peers.get(id); }
}

module.exports = { Discovery, interfaces, GROUP, UDP_PORT };
