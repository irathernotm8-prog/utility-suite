import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore } from '../ui/lib/room-core.mjs';

// In-memory mesh network; delivery is async like a real data channel.
function network() {
  const nodes = new Map();
  const tick = () => new Promise(r => setTimeout(r, 0));
  function add(id, opts) {
    const transport = {
      selfId: id,
      send(type, data, target) {
        const targets = target ? [].concat(target) : [...nodes.keys()].filter(x => x !== id);
        const payload = JSON.parse(JSON.stringify(data));
        for (const t of targets) queueMicrotask(() => nodes.get(t)?.core.receive(type, payload, id));
      },
      async request(type, data, target) { await tick(); return nodes.get(target).core.answer(type, data, id); }
    };
    const core = new RoomCore({ transport, joinTimeoutMs: 50, ...opts });
    const node = { id, core };
    nodes.set(id, node);
    for (const other of nodes.values()) if (other.id !== id) { other.core.peerJoined(id); core.peerJoined(other.id); }
    return core;
  }
  function remove(id) {
    nodes.delete(id);
    for (const n of nodes.values()) n.core.peerLeft(id);
  }
  return { add, remove, settle: async () => { for (let i = 0; i < 10; i++) await tick(); } };
}

test('first member hosts; joiners adopt host state and chat history', async () => {
  const net = network();
  const a = net.add('aaa', { profile: { name: 'Bilal' }, startAsHost: true, roomName: 'Movie night' });
  a.chat('popcorn ready');
  a.navigate('https://www.youtube.com/watch?v=x', 'Trailer');
  const b = net.add('bbb', { profile: { name: 'Kiana' } });
  await net.settle();
  assert.equal(b.hostId, 'aaa');
  assert.equal(b.state.url, 'https://www.youtube.com/watch?v=x');
  assert.equal(b.state.roomName, 'Movie night');
  assert.ok(b.messages.some(m => m.text === 'popcorn ready'));
  assert.equal(a.members.get('bbb').name, 'Kiana');
  assert.deepEqual(a.order, ['aaa', 'bbb']);
});

test('host leaving promotes the most senior remaining member', async () => {
  const net = network();
  const a = net.add('zzz', { profile: { name: 'A' }, startAsHost: true });
  const b = net.add('mmm', { profile: { name: 'B' } });
  await net.settle();
  const c = net.add('aaa', { profile: { name: 'C' } });
  await net.settle();
  assert.deepEqual(a.order, ['zzz', 'mmm', 'aaa']);
  net.remove('zzz');
  await net.settle();
  assert.equal(b.isHost, true);
  assert.equal(c.hostId, 'mmm');
});

test('two simultaneous hosts resolve to the earlier claim', async () => {
  const net = network();
  let clock = 1000;
  const a = net.add('bbb', { profile: { name: 'Early' }, startAsHost: true, now: () => clock });
  a.navigate('https://example.com/a');
  // b arrives "alone" (simulate partition) by creating before linking: claim later
  clock = 2000;
  const b = net.add('aaa', { profile: { name: 'Late' }, startAsHost: true, now: () => clock });
  await net.settle();
  assert.equal(a.isHost, true);
  assert.equal(b.isHost, false);
  assert.equal(b.hostId, 'bbb');
  assert.equal(b.state.url, 'https://example.com/a');
});

test('joiner with nobody around becomes host after the timeout', async () => {
  const net = network();
  const a = net.add('aaa', { profile: { name: 'Solo' } });
  assert.equal(a.isHost, false);
  await new Promise(r => setTimeout(r, 80));
  assert.equal(a.isHost, true);
  assert.ok(a.messages.some(m => /Nobody/.test(m.text)));
});

test('controls route to host only when everyone may control', async () => {
  const net = network();
  const a = net.add('aaa', { profile: { name: 'Host' }, startAsHost: true });
  const b = net.add('bbb', { profile: { name: 'Guest' } });
  await net.settle();
  const seen = [];
  a.on('control', (action, who) => seen.push([action.action, who.name]));
  assert.equal(b.control({ action: 'pause', t: 12 }), true);
  await net.settle();
  assert.deepEqual(seen, [['pause', 'Guest']]);
  a.setEveryoneControls(false);
  await net.settle();
  assert.equal(b.control({ action: 'play' }), false);
  assert.equal(b.control({ action: 'navigate', url: 'javascript:alert(1)' }), false);
});

test('host can hand off; broadcast ends when broadcaster leaves', async () => {
  const net = network();
  const a = net.add('aaa', { profile: { name: 'A' }, startAsHost: true });
  const b = net.add('bbb', { profile: { name: 'B' } });
  await net.settle();
  a.transferHost('bbb');
  await net.settle();
  assert.equal(b.isHost, true);
  assert.equal(a.hostId, 'bbb');
  b.setBroadcasting(true);
  await net.settle();
  assert.equal(a.state.mode, 'broadcast');
  net.remove('bbb');
  await net.settle();
  assert.equal(a.isHost, true);
  assert.notEqual(a.state.mode, 'broadcast');
});

test('playback and messages are sanitized', async () => {
  const net = network();
  const a = net.add('aaa', { profile: { name: 'A' }, startAsHost: true });
  const b = net.add('bbb', { profile: { name: 'B' } });
  await net.settle();
  a.setPlayback({ t: 10, at: 5, paused: false, rate: 99 });
  await net.settle();
  assert.equal(b.state.pb.rate, 1);
  b.receive('chat', { id: 'x', text: '   ' }, 'aaa');
  assert.equal(b.messages.filter(m => m.kind === 'chat').length, 0);
});

test('clock requests reach the host', async () => {
  const net = network();
  net.add('aaa', { profile: { name: 'A' }, startAsHost: true, now: () => 42 });
  const b = net.add('bbb', { profile: { name: 'B' } });
  await net.settle();
  assert.equal(await b.requestClock(), 42);
});
