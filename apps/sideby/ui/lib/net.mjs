// Serverless rooms: peers find each other through public Nostr relays (or a
// self-hosted relay) and then talk directly over encrypted WebRTC. No video or
// chat passes through any server. The room code doubles as the password that
// encrypts the connection handshake.
import { joinNostr, joinWsRelay, selfId } from '../vendor/trystero.mjs';

const APP_ID = 'app.sideby.desktop/v2';
const MESSAGE_TYPES = ['hello', 'state', 'hist', 'chat', 'react', 'status', 'typing', 'ctl', 'bye', 'profile'];

export { selfId };

export function openRoom({ code, signaling = {}, turn = [], onError } = {}) {
  const config = { appId: APP_ID, password: code };
  if (turn.length) config.turnConfig = turn;
  const callbacks = { onJoinError: details => onError?.(details?.error || 'Could not join the room.') };
  const urls = (signaling.urls || []).filter(Boolean);
  const room = signaling.kind === 'relay' && urls.length
    ? joinWsRelay({ ...config, relayConfig: { urls } }, code, callbacks)
    : joinNostr({ ...config, ...(urls.length ? { relayConfig: { urls } } : {}) }, code, callbacks);

  const actions = Object.fromEntries(MESSAGE_TYPES.map(type => [type, room.makeAction(type)]));
  const clock = room.makeAction('clock', { kind: 'request' });

  const transport = {
    selfId,
    send(type, data, target) {
      const action = actions[type];
      if (!action) throw new Error(`Unknown message type ${type}`);
      action.send(data, target ? { target } : undefined).catch(() => {});
    },
    request(type, data, target, timeoutMs = 3000) {
      return clock.request(data ?? {}, { target, timeoutMs });
    }
  };

  function bind(core, { onPeerJoin, onPeerLeave, onPeerStream } = {}) {
    room.onPeerJoin = id => { core.peerJoined(id); onPeerJoin?.(id); };
    room.onPeerLeave = id => { core.peerLeft(id); onPeerLeave?.(id); };
    room.onPeerStream = (stream, id, metadata) => onPeerStream?.(stream, id, metadata);
    for (const type of MESSAGE_TYPES) actions[type].onMessage = (data, { peerId }) => core.receive(type, data, peerId);
    clock.onRequest = (data, { peerId }) => core.answer('clock', data, peerId);
  }

  async function connectionType(peerId) {
    const pc = room.getPeers()[peerId];
    if (!pc) return null;
    try {
      const stats = await pc.getStats();
      let pair;
      stats.forEach(s => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId); });
      if (!pair) stats.forEach(s => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
      if (!pair) return null;
      const localCandidate = stats.get(pair.localCandidateId);
      const remoteCandidate = stats.get(pair.remoteCandidateId);
      const relayed = localCandidate?.candidateType === 'relay' || remoteCandidate?.candidateType === 'relay';
      return { kind: relayed ? 'relay' : 'direct', rtt: pair.currentRoundTripTime ? Math.round(pair.currentRoundTripTime * 1000) : null };
    } catch { return null; }
  }

  return { room, transport, bind, connectionType, leave: () => room.leave() };
}
