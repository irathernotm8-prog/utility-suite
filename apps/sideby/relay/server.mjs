// Optional: your own relay for finding friends, instead of the public Nostr
// relays. It only passes connection handshakes; video and chat stay peer to peer.
//   npm run relay            (listens on PORT or 8787)
// Put it behind HTTPS (wss://) and add the address in Sideby → Settings → Connection.
import { createWsRelayServer } from '@trystero-p2p/ws-relay/server';
const port = Number(process.env.PORT || 8787);
createWsRelayServer({ port });
console.log(`Sideby relay listening on ws://0.0.0.0:${port}`);
