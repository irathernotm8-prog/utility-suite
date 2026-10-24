'use strict';
// Waypoint — the glue between booking and the trip:
//  • links to booking sites with your search filled in (Google Flights, Kayak, Booking.com, Airbnb…)
//  • reading a confirmation page you finished on one of those sites (reference, total, provider)
//  • turning an in-app flight order or hotel booking into trip bookings (they land on the timeline)
//  • a one-page confirmation for each in-app booking, saved with the trip's documents
const TL = require('./timeline');

const ymd = (d) => String(d || '').slice(0, 10);
const enc = encodeURIComponent;

const SITES = {
  flights: [
    { id: 'google', name: 'Google Flights', url: (q) => `https://www.google.com/travel/flights?q=${enc(`Flights to ${q.to} from ${q.from} on ${q.depart}${q.ret ? ` through ${q.ret}` : ' one way'}${q.adults > 1 ? ` for ${q.adults} adults` : ''}`)}` },
    { id: 'kayak', name: 'Kayak', url: (q) => `https://www.kayak.com/flights/${enc(q.from)}-${enc(q.to)}/${q.depart}${q.ret ? '/' + q.ret : ''}/${q.adults || 1}adults?sort=bestflight_a` },
    { id: 'skyscanner', name: 'Skyscanner', url: (q) => `https://www.skyscanner.com/transport/flights/${q.from.toLowerCase()}/${q.to.toLowerCase()}/${q.depart.slice(2).replace(/-/g, '')}/${q.ret ? q.ret.slice(2).replace(/-/g, '') + '/' : ''}?adultsv2=${q.adults || 1}` },
    { id: 'expedia', name: 'Expedia', url: (q) => `https://www.expedia.com/Flights-Search?trip=${q.ret ? 'roundtrip' : 'oneway'}&leg1=${enc(`from:${q.from},to:${q.to},departure:${q.depart}TANYT`)}${q.ret ? `&leg2=${enc(`from:${q.to},to:${q.from},departure:${q.ret}TANYT`)}` : ''}&passengers=${enc(`adults:${q.adults || 1}`)}&mode=search` },
  ],
  stays: [
    { id: 'booking', name: 'Booking.com', url: (q) => `https://www.booking.com/searchresults.html?ss=${enc(q.city)}&checkin=${q.checkin}&checkout=${q.checkout}&group_adults=${q.adults || 2}&no_rooms=${q.rooms || 1}` },
    { id: 'airbnb', name: 'Airbnb', url: (q) => `https://www.airbnb.com/s/${enc(q.city)}/homes?checkin=${q.checkin}&checkout=${q.checkout}&adults=${q.adults || 2}` },
    { id: 'expedia', name: 'Expedia', url: (q) => `https://www.expedia.com/Hotel-Search?destination=${enc(q.city)}&startDate=${q.checkin}&endDate=${q.checkout}&adults=${q.adults || 2}&rooms=${q.rooms || 1}` },
    { id: 'google', name: 'Google Hotels', url: (q) => `https://www.google.com/travel/search?q=${enc(`hotels in ${q.city} ${q.checkin} to ${q.checkout}`)}` },
    { id: 'hotels', name: 'Hotels.com', url: (q) => `https://www.hotels.com/Hotel-Search?destination=${enc(q.city)}&startDate=${q.checkin}&endDate=${q.checkout}&adults=${q.adults || 2}` },
  ],
};
const siteList = () => ({ flights: SITES.flights.map(({ id, name }) => ({ id, name })), stays: SITES.stays.map(({ id, name }) => ({ id, name })) });
function siteUrl(kind, id, q) {
  const s = (SITES[kind] || []).find(x => x.id === id) || (SITES[kind] || [])[0];
  if (!s) throw new Error('Unknown site');
  return { url: s.url(q), name: s.name };
}

// ───────── reading a confirmation page
const PROVIDERS = [[/booking\.com/, 'Booking.com', 'stay'], [/airbnb\./, 'Airbnb', 'stay'], [/expedia\./, 'Expedia', ''], [/hotels\.com/, 'Hotels.com', 'stay'], [/vrbo\./, 'Vrbo', 'stay'],
  [/kayak\./, 'Kayak', ''], [/skyscanner\./, 'Skyscanner', 'flight'], [/google\./, 'Google', ''], [/united\.com/, 'United', 'flight'], [/aa\.com/, 'American Airlines', 'flight'], [/delta\.com/, 'Delta', 'flight'],
  [/southwest\.com/, 'Southwest', 'flight'], [/flytap\.com/, 'TAP Air Portugal', 'flight'], [/britishairways\.com/, 'British Airways', 'flight'], [/lufthansa\.com/, 'Lufthansa', 'flight'], [/klm\./, 'KLM', 'flight'],
  [/airfrance\./, 'Air France', 'flight'], [/iberia\.com/, 'Iberia', 'flight'], [/emirates\.com/, 'Emirates', 'flight'], [/qatarairways\.com/, 'Qatar Airways', 'flight'], [/marriott\.com/, 'Marriott', 'stay'],
  [/hilton\.com/, 'Hilton', 'stay'], [/hyatt\.com/, 'Hyatt', 'stay'], [/ihg\.com/, 'IHG', 'stay'], [/hertz\./, 'Hertz', 'car'], [/enterprise\.com/, 'Enterprise', 'car'], [/avis\./, 'Avis', 'car'], [/getyourguide\./, 'GetYourGuide', 'tour'], [/viator\./, 'Viator', 'tour']];
const CONFIRM_WORDS = /(booking|reservation|itinerary|trip|order)\s+(is\s+)?(confirmed|complete)|you'?re\s+(all\s+set|booked|going)|confirmation\s+(number|code|#|no\.?)|booking\s+(number|reference|ref\.?|id)|record\s+locator|thanks?\s+(you\s+)?for\s+(your\s+)?(booking|reservation)|your\s+(booking|reservation)\s+(number|reference)/i;

function looksConfirmed(text) { return CONFIRM_WORDS.test(String(text || '')); }
function readConfirmation(text, url = '', title = '') {
  const t = String(text || '').replace(/ /g, ' ');
  let provider = '', kind = '';
  let host = ''; try { host = new URL(url).hostname; } catch {}
  for (const [re, name, k] of PROVIDERS) if (re.test(host)) { provider = name; kind = k; break; }
  if (!kind) kind = /check[- ]?in|nights?|room|guests?/i.test(t) && !/depart|boarding|flight\s+\w{2}\s?\d/i.test(t) ? 'stay' : /flight|depart|airline|seat/i.test(t) ? 'flight' : /pick[- ]?up|rental car|drop[- ]?off/i.test(t) ? 'car' : 'other';
  // reference: the code that follows a confirmation-ish label
  let ref = '';
  const refRe = /(confirmation|booking|reservation|record\s+locator|pnr|itinerary|order)\s*(number|no\.?|code|#|reference|ref\.?|id)?\s*(is)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,19})\b/gi;
  let m; while ((m = refRe.exec(t))) { const c = m[4]; if (/\d/.test(c) || /^[A-Z]{6}$/.test(c)) { ref = c; break; } }
  // total: the first amount after "total"/"you paid"/"amount"
  let total = null, currency = '';
  const SYM = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', 'C$': 'CAD', 'A$': 'AUD', 'US$': 'USD' };
  const mt = /(?:total(?:\s+(?:price|cost|charged|paid|due))?|you\s+paid|amount\s+(?:paid|charged)|grand\s+total)[^0-9$€£¥]{0,40}(?:(?<sym>US\$|C\$|A\$|[$€£¥])\s?(?<n1>[\d.,]+)|(?<n2>[\d.,]+)\s?(?<cur>USD|EUR|GBP|CAD|MXN|JPY))/i.exec(t);
  if (mt) {
    const g = mt.groups;
    const num = (g.n1 || g.n2 || '').replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');
    total = Number(num) || null; currency = g.sym ? SYM[g.sym] || '' : (g.cur || '').toUpperCase();
  }
  let name = String(title || '').replace(/\s*[|–-]\s*(Booking\.com|Airbnb|Expedia|Kayak|Google|Hotels\.com|Vrbo).*$/i, '').trim().slice(0, 80);
  if (/^(your\s+)?(booking|reservation|order|trip)?\s*(confirm|thank|success|complete|itinerary)/i.test(name)) name = '';
  return { provider, kind, ref, total, currency, title: name };
}

// ───────── in-app bookings → trip bookings
function airportsLine(sl) { return `${sl.from.city || sl.from.code} → ${sl.to.city || sl.to.code}`; }
function flightBookings(trip, offer, order, newId) {
  const out = [];
  const slices = order.slices && order.slices.length ? order.slices : offer.slices;
  slices.forEach((sl, i) => {
    const flights = sl.segments.map(s => s.flight).filter(Boolean).join(' + ');
    out.push({
      id: newId(), type: 'flight', title: `${flights || offer.airline.name} · ${airportsLine(sl)}`, provider: order.airline || offer.airline.name, ref: order.ref,
      from: sl.from.code, to: sl.to.code, startDate: ymd(sl.depart), startTime: String(sl.depart).slice(11, 16), endDate: ymd(sl.arrive), endTime: String(sl.arrive).slice(11, 16),
      seat: '', phone: '', address: '', cost: i === 0 ? order.amount : '', currency: order.currency, paid: true, onTimeline: true, docs: [],
      notes: [sl.segments.map(s => `${s.flight}  ${s.from.code} ${String(s.depart).slice(11, 16)} → ${s.to.code} ${String(s.arrive).slice(11, 16)}${s.aircraft ? ' · ' + s.aircraft : ''}`).join('\n'), sl.bags ? `Bags: ${sl.bags}` : '', `Passengers: ${order.passengers.join(', ')}`, `Booked in Waypoint (Duffel order ${order.orderId})${order.mode !== 'live' ? ' — TEST booking, not a real ticket' : ''}`].filter(Boolean).join('\n'),
      booked: { via: 'duffel', orderId: order.orderId, mode: order.mode, at: Date.now() },
    });
  });
  return out;
}
function stayBooking(hotel, room, res, q, newId) {
  return {
    id: newId(), type: 'stay', title: res.hotel || hotel.name, provider: 'Booked in Waypoint', ref: res.ref, address: res.address || hotel.address || '',
    startDate: ymd(res.checkin || q.checkin), startTime: '15:00', endDate: ymd(res.checkout || q.checkout), endTime: '11:00', from: '', to: '', seat: room.name, phone: '',
    cost: res.amount || room.price, currency: res.currency || room.currency, paid: true, onTimeline: true, docs: [],
    notes: [room.name, room.board, room.refundable ? `Free cancellation${room.cancelUntil ? ' until ' + room.cancelUntil.replace('T', ' ').slice(0, 16) : ''}` : 'Non-refundable', `Booked in Waypoint (LiteAPI booking ${res.bookingId})${res.mode !== 'live' ? ' — TEST booking, no room is held' : ''}`].filter(Boolean).join('\n'),
    booked: { via: 'liteapi', bookingId: res.bookingId, mode: res.mode, at: Date.now() },
  };
}

// a clean one-page confirmation, saved to Documents as a PDF
function confirmationHtml({ title, kind, ref, mode, lines, total, travelers, note }) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;font:11pt/1.5 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#1c1a17}
  .top{padding:26px 30px;border-radius:16px;color:#fff;background:linear-gradient(135deg,#ffb340,#ff6a4c 55%,#c43c7a);-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .top small{font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:9pt;opacity:.9}.top h1{margin:6px 0 0;font-size:22pt}
  .ref{margin:22px 0 6px;font-size:10pt;color:#6b655c}.code{font:800 26pt ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em}
  .test{display:inline-block;margin-top:10px;padding:4px 10px;border-radius:6px;background:#fff1d6;color:#8a5a00;font-weight:700;font-size:10pt}
  table{width:100%;border-collapse:collapse;margin-top:18px}td{padding:9px 6px;border-bottom:1px solid #eee7df;vertical-align:top}td:first-child{color:#6b655c;width:150px}
  .foot{margin-top:24px;color:#8a847a;font-size:9pt}</style></head><body>
  <div class="top"><small>${esc(kind)} confirmation · Waypoint</small><h1>${esc(title)}</h1></div>
  <div class="ref">Confirmation / booking reference</div><div class="code">${esc(ref)}</div>
  ${mode !== 'live' ? `<div class="test">${mode === 'demo' ? 'Sample booking' : 'Test booking'} — nothing was charged and this is not a real ${kind === 'Flight' ? 'ticket' : 'reservation'}</div>` : ''}
  <table>${lines.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b).replace(/\n/g, '<br>')}</td></tr>`).join('')}
  ${travelers ? `<tr><td>Travelers</td><td>${esc(travelers)}</td></tr>` : ''}${total ? `<tr><td>Total</td><td><b>${esc(total)}</b></td></tr>` : ''}</table>
  ${note ? `<div class="foot">${esc(note)}</div>` : ''}<div class="foot">Saved by Waypoint on ${esc(new Date().toLocaleString('en-US'))}.</div></body></html>`;
}

module.exports = { SITES, siteList, siteUrl, looksConfirmed, readConfirmation, flightBookings, stayBooking, confirmationHtml, TL };
