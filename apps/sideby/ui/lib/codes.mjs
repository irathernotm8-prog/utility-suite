// Room codes: 9 characters from an alphabet with no look-alikes (no 0/O, 1/I/L).
// Shown as ABC-DEF-GHJ. ~44 bits of entropy; the code is also the room password.
export const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 9;

export function generateCode(random = cryptoRandom) {
  let code = '';
  const bytes = random(CODE_LENGTH * 2);
  for (let i = 0; code.length < CODE_LENGTH; i++) {
    const b = bytes[i % bytes.length];
    if (b < 248) code += ALPHABET[b % ALPHABET.length]; // 248 = 31*8, avoids modulo bias
    else if (i > CODE_LENGTH * 8) code += ALPHABET[b % ALPHABET.length];
  }
  return code;
}

function cryptoRandom(n) {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function formatCode(code) {
  const c = normalizeCode(code);
  return c ? `${c.slice(0, 3)}-${c.slice(3, 6)}-${c.slice(6)}` : '';
}

export function normalizeCode(raw) {
  if (typeof raw !== 'string') return null;
  const c = raw.toUpperCase().replace(/[\s-]/g, '');
  if (c.length !== CODE_LENGTH) return null;
  for (const ch of c) if (!ALPHABET.includes(ch)) return null;
  return c;
}

// Accepts a bare code, "sideby://join/CODE", or any URL/text containing one of those.
export function parseInvite(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text) return null;
  const link = text.match(/sideby:\/\/(?:join\/)?([A-Za-z0-9-]{9,13})/i);
  if (link) return normalizeCode(link[1]);
  const param = text.match(/[?#&](?:room|join|code)=([A-Za-z0-9-]{9,13})/i);
  if (param) return normalizeCode(param[1]);
  if (text.length <= 15) return normalizeCode(text);
  const loose = text.match(/\b([A-Za-z2-9]{3}-[A-Za-z2-9]{3}-[A-Za-z2-9]{3})\b/);
  return loose ? normalizeCode(loose[1]) : null;
}

// Only matches explicit links, so we never treat random clipboard text as an invite.
export function findInviteLink(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/sideby:\/\/join\/([A-Za-z0-9-]{9,13})/i);
  return m ? normalizeCode(m[1]) : null;
}

export const inviteLink = code => `sideby://join/${normalizeCode(code)}`;

export function inviteText(code, { name, roomName } = {}) {
  const who = name ? `${name} invited you` : 'You’re invited';
  const what = roomName ? ` to “${roomName}”` : '';
  return `${who}${what} on Sideby 🍿\nRoom code: ${formatCode(code)}\nOr open: ${inviteLink(code)}`;
}
