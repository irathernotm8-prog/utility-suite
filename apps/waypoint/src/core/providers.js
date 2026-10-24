'use strict';
// Waypoint — booking inside the app. Flights through Duffel (search every airline it carries, then
// buy the ticket, paid from your Duffel balance), stays through LiteAPI (search hotels by city, check
// the price, then book on the card saved in your LiteAPI account). Both have free test modes: test
// keys (duffel_test_…, sand_…) return real-looking results and confirmations without charging anyone.
// All calls happen here in the main process; keys never reach the window.

const DUFFEL = process.env.WAYPOINT_DUFFEL_URL || 'https://api.duffel.com';
const LITE = process.env.WAYPOINT_LITEAPI_URL || 'https://api.liteapi.travel/v3.0';
const LITE_BOOK = process.env.WAYPOINT_LITEAPI_BOOK_URL || 'https://book.liteapi.travel/v3.0';

async function call(url, { method = 'GET', headers = {}, body, timeout = 45000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(url, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'The booking service took too long to answer. Try again.' : 'Couldn’t reach the booking service — check your internet connection.');
  } finally { clearTimeout(t); }
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const e = (json && (json.errors && json.errors[0])) || (json && json.error) || {};
    const msg = e.message || e.title || e.description || (typeof e === 'string' ? e : '') || (json && json.message) || `The booking service said no (${res.status}).`;
    const err = new Error(res.status === 401 || res.status === 403 ? 'The booking service didn’t accept your key. Check it in Settings › Booking.' : msg);
    err.status = res.status; err.code = e.code; throw err;
  }
  return json;
}

// ISO 8601 durations like PT11H25M or P1DT2H5M → minutes
function isoMinutes(d) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(String(d || ''));
  return m ? (+(m[1] || 0)) * 1440 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : null;
}
const hhmm = (iso) => String(iso || '').slice(0, 16);   // "2026-11-01T18:40:00" → "2026-11-01T18:40" (local to the airport)
const place = (p) => p ? { code: p.iata_code || '', city: p.city_name || (p.city && p.city.name) || p.name || '', name: p.name || '' } : { code: '', city: '', name: '' };

// ───────── flights (Duffel)
class Duffel {
  constructor(key, base = DUFFEL) { this.key = key; this.base = base; }
  get mode() { return /^duffel_test_/.test(this.key) ? 'test' : 'live'; }
  req(method, path, body, timeout) {
    return call(this.base + path, { method, body, timeout, headers: { Authorization: `Bearer ${this.key}`, 'Duffel-Version': 'v2' } });
  }
  async places(q) {
    if (!q || q.length < 2) return [];
    const r = await this.req('GET', `/places/suggestions?query=${encodeURIComponent(q)}`, null, 10000);
    return (r.data || []).filter(p => p.iata_code).slice(0, 8).map(p => ({ code: p.iata_code, city: p.city_name || p.name, name: p.name, country: p.iata_country_code, type: p.type }));
  }
  async search({ from, to, depart, ret, adults = 1, cabin = 'economy', maxStops }) {
    const slices = [{ origin: from, destination: to, departure_date: depart }];
    if (ret) slices.push({ origin: to, destination: from, departure_date: ret });
    const body = { data: { slices, passengers: Array.from({ length: Math.max(1, Math.min(9, adults)) }, () => ({ type: 'adult' })), cabin_class: cabin } };
    if (maxStops != null && maxStops !== '') body.data.max_connections = Number(maxStops);
    const r = await this.req('POST', '/air/offer_requests?return_offers=true&supplier_timeout=20000', body, 60000);
    return (r.data.offers || []).map(normOffer);
  }
  async offer(id) { const r = await this.req('GET', `/air/offers/${encodeURIComponent(id)}`); return normOffer(r.data); }
  async book({ offerId, amount, currency, passengers }) {
    const body = { data: { type: 'instant', selected_offers: [offerId], payments: [{ type: 'balance', amount: String(amount), currency }], passengers: passengers.map(p => ({
      id: p.id, title: p.title || (p.gender === 'f' ? 'ms' : 'mr'), given_name: p.given, family_name: p.family, born_on: p.born, gender: p.gender === 'f' ? 'f' : 'm', email: p.email, phone_number: p.phone,
    })) } };
    const r = await this.req('POST', '/air/orders', body, 90000);
    const o = r.data;
    return { orderId: o.id, ref: o.booking_reference, amount: Number(o.total_amount), currency: o.total_currency, airline: o.owner ? o.owner.name : '', slices: (o.slices || []).map(normSlice), passengers: (o.passengers || []).map(p => `${p.given_name} ${p.family_name}`), mode: o.live_mode === false ? 'test' : this.mode };
  }
}
function normSlice(s) {
  const segs = (s.segments || []).map(g => {
    const pax = (g.passengers || [])[0] || {};
    const bags = (pax.baggages || []).filter(b => b.quantity > 0).map(b => `${b.quantity} ${b.type === 'checked' ? 'checked' : 'carry-on'}`).join(', ');
    const mc = g.marketing_carrier || g.operating_carrier || {};
    return { carrier: mc.name || '', code: mc.iata_code || '', flight: `${mc.iata_code || ''} ${g.marketing_carrier_flight_number || g.operating_carrier_flight_number || ''}`.trim(),
      from: place(g.origin), to: place(g.destination), depart: hhmm(g.departing_at), arrive: hhmm(g.arriving_at), aircraft: g.aircraft ? g.aircraft.name : '', cabin: pax.cabin_class_marketing_name || '', bags };
  });
  const dur = isoMinutes(s.duration) ?? (segs.length ? Math.round((new Date(segs[segs.length - 1].arrive) - new Date(segs[0].depart)) / 60000) : null);
  return { from: place(s.origin), to: place(s.destination), depart: segs[0] ? segs[0].depart : '', arrive: segs.length ? segs[segs.length - 1].arrive : '', minutes: dur, stops: Math.max(0, segs.length - 1), segments: segs, bags: segs[0] ? segs[0].bags : '' };
}
function normOffer(o) {
  const c = o.conditions || {};
  return {
    id: o.id, price: Number(o.total_amount), currency: o.total_currency, expires: o.expires_at || '',
    airline: { name: o.owner ? o.owner.name : '', code: o.owner ? o.owner.iata_code : '', logo: o.owner ? (o.owner.logo_symbol_url || '') : '' },
    passengerIds: (o.passengers || []).map(p => p.id),
    refundable: !!(c.refund_before_departure && c.refund_before_departure.allowed), changeable: !!(c.change_before_departure && c.change_before_departure.allowed),
    slices: (o.slices || []).map(normSlice),
  };
}

// ───────── stays (LiteAPI)
class LiteApi {
  constructor(key, base = LITE, bookBase = LITE_BOOK) { this.key = key; this.base = base; this.bookBase = bookBase; }
  get mode() { return /^sand_/.test(this.key) ? 'test' : 'live'; }
  req(method, url, body, timeout) { return call(url, { method, body, timeout, headers: { 'X-API-Key': this.key } }); }
  async search({ city, country, checkin, checkout, adults = 2, rooms = 1, currency = 'USD', nationality = 'US' }) {
    if (!country) throw new Error('Pick the trip’s country in Details so hotels can be searched there.');
    rooms = Math.max(1, Math.min(adults, rooms));
    const per = Math.ceil(adults / rooms);
    const body = { checkin, checkout, currency, guestNationality: nationality, occupancies: Array.from({ length: rooms }, () => ({ adults: per, children: [] })), cityName: city, countryCode: country, limit: 40, timeout: 12, includeHotelData: true };
    const r = await this.req('POST', `${this.base}/hotels/rates`, body, 45000);
    const info = new Map((r.hotels || []).map(h => [h.id, h]));
    const nights = Math.max(1, Math.round((Date.parse(checkout) - Date.parse(checkin)) / 864e5));
    return (r.data || []).map(h => {
      const hi = info.get(h.hotelId) || {};
      const roomsOut = (h.roomTypes || []).map(rt => {
        const rate = (rt.rates || [])[0] || {};
        const total = rt.offerRetailRate ? Number(rt.offerRetailRate.amount) : (rt.rates || []).reduce((a, x) => a + Number(((x.retailRate || {}).total || [{}])[0].amount || 0), 0);
        const cur = (rt.offerRetailRate && rt.offerRetailRate.currency) || (((rate.retailRate || {}).total || [{}])[0].currency) || currency;
        const cp = rate.cancellationPolicies || {};
        const until = ((cp.cancelPolicyInfos || [])[0] || {}).cancelTime || '';
        return { offerId: rt.offerId, name: rate.name || 'Room', board: rate.boardName || '', price: total, currency: cur, perNight: total / nights, refundable: cp.refundableTag === 'RFN', cancelUntil: until, sleeps: rate.maxOccupancy || null };
      }).filter(x => x.offerId && x.price > 0).sort((a, b) => a.price - b.price);
      return { hotelId: h.hotelId, name: hi.name || 'Hotel', photo: hi.main_photo || hi.thumbnail || '', address: hi.address || '', rating: hi.rating || null, stars: hi.stars || hi.starRating || null, rooms: roomsOut, from: roomsOut[0] ? roomsOut[0].price : null, currency: roomsOut[0] ? roomsOut[0].currency : currency, nights };
    }).filter(h => h.rooms.length).sort((a, b) => a.from - b.from);
  }
  async prebook(offerId) {
    const r = await this.req('POST', `${this.bookBase}/rates/prebook`, { offerId, usePaymentSdk: false }, 45000);
    const d = r.data || {};
    return { prebookId: d.prebookId, price: Number(d.price ?? d.suggestedSellingPrice ?? 0), currency: d.currency || '', changed: Number(d.priceDifferencePercent || 0) };
  }
  async book({ prebookId, holder, guests, ref }) {
    const body = { prebookId, clientReference: ref, holder: { firstName: holder.given, lastName: holder.family, email: holder.email, phone: holder.phone || undefined },
      payment: { method: 'ACC_CREDIT_CARD' }, guests: guests.map((g, i) => ({ occupancyNumber: g.room || i + 1, firstName: g.given, lastName: g.family, email: g.email || holder.email })) };
    const r = await this.req('POST', `${this.bookBase}/rates/book`, body, 90000);
    const d = r.data || {};
    const hotel = d.hotel || {};
    return { bookingId: d.bookingId, ref: d.hotelConfirmationCode || d.bookingId, status: d.status || '', amount: Number(d.price ?? 0), currency: d.currency || '', checkin: d.checkin, checkout: d.checkout, hotel: hotel.name || '', address: hotel.address || '', mode: this.mode };
  }
}

// ───────── pretend services for WAYPOINT_DEMO (screenshots, trying the flow with no account)
class DemoFlights {
  get mode() { return 'demo'; }
  async places(q) { return require('./airports').find(q).map(a => ({ code: a.code, city: a.city, name: a.name, country: a.country })); }
  async search({ from, to, depart, ret, adults = 1 }) {
    const A = require('./airports');
    const air = [['TAP Air Portugal', 'TP'], ['United', 'UA'], ['American', 'AA'], ['Lufthansa', 'LH'], ['British Airways', 'BA'], ['Iberia', 'IB'], ['KLM', 'KL']];
    const mk = (i) => {
      const [name, code] = air[i % air.length];
      const stops = i % 3 === 0 ? 0 : 1;
      const dh = 6 + (i * 5) % 15, mins = 600 + stops * 140 + (i * 37) % 120;
      const sl = (o, d, date, hOff) => {
        const dep = new Date(`${date}T${String((dh + hOff) % 24).padStart(2, '0')}:${i % 2 ? '35' : '05'}:00Z`);
        const arr = new Date(dep.getTime() + mins * 60000 + 6 * 3600000);
        const iso = (x) => x.toISOString().slice(0, 16);
        const via = stops ? ['JFK', 'MAD', 'FRA', 'LHR', 'AMS'][i % 5] : null;
        const seg = (f, t, a, b, n) => ({ carrier: name, code, flight: `${code} ${100 + i * 7 + n}`, from: { code: f, city: (A.get(f) || {}).city || f }, to: { code: t, city: (A.get(t) || {}).city || t }, depart: a, arrive: b, aircraft: ['Airbus A330-900neo', 'Boeing 787-9', 'Airbus A321neo'][i % 3], cabin: 'Economy', bags: i % 2 ? '1 checked' : '1 carry-on' });
        const mid = new Date(dep.getTime() + mins * 30000), mid2 = new Date(mid.getTime() + 140 * 60000);
        const segs = via ? [seg(o, via, iso(dep), iso(mid), 0), seg(via, d, iso(mid2), iso(arr), 1)] : [seg(o, d, iso(dep), iso(arr), 0)];
        return { from: { code: o, city: (A.get(o) || {}).city || o }, to: { code: d, city: (A.get(d) || {}).city || d }, depart: iso(dep), arrive: iso(arr), minutes: mins, stops, segments: segs, bags: segs[0].bags };
      };
      const slices = [sl(from, to, depart, 0)]; if (ret) slices.push(sl(to, from, ret, 3));
      return { id: `demo_off_${i}`, price: Math.round((640 + ((i * 97) % 520) - stops * 60) * adults), currency: 'USD', expires: new Date(Date.now() + 1800e3).toISOString(), airline: { name, code, logo: '' }, passengerIds: Array.from({ length: adults }, (_, k) => `pas_${k}`), refundable: i % 4 === 0, changeable: i % 2 === 0, slices };
    };
    await new Promise(r => setTimeout(r, 400));
    return Array.from({ length: 12 }, (_, i) => mk(i)).sort((a, b) => a.price - b.price);
  }
  async offer(id) { return { id }; }
  async book({ offerId, amount, currency, passengers }) {
    await new Promise(r => setTimeout(r, 500));
    return { orderId: 'ord_demo_' + offerId, ref: 'DEMO' + Math.random().toString(36).slice(2, 6).toUpperCase(), amount: Number(amount), currency, airline: '', slices: null, passengers: passengers.map(p => `${p.given} ${p.family}`), mode: 'demo' };
  }
}
class DemoStays {
  get mode() { return 'demo'; }
  async search({ city, checkin, checkout, currency = 'USD' }) {
    const nights = Math.max(1, Math.round((Date.parse(checkout) - Date.parse(checkin)) / 864e5));
    const names = ['Casa do Largo', 'Hotel Avenida Palace', 'The Lumiares', 'Memmo Alfama', 'Bairro Alto Hotel', 'Chiado Loft Suites', 'Pestana Palace', 'Lisbon Destination Hostel', 'Valverde Hotel', 'Torel Palace'];
    await new Promise(r => setTimeout(r, 400));
    return names.map((n, i) => {
      const base = 90 + ((i * 53) % 260);
      const rooms = [['Double room', 'Breakfast included', true], ['Superior king', 'Room only', false], ['Junior suite', 'Breakfast included', true]].map(([rn, b, rf], k) => ({ offerId: `demo_room_${i}_${k}`, name: rn, board: b, price: (base + k * 45) * nights, currency, perNight: base + k * 45, refundable: rf, cancelUntil: rf ? `${checkin}T00:00:00` : '', sleeps: 2 }));
      return { hotelId: `demo_h_${i}`, name: n, photo: '', address: `${city}`, rating: (8 + (i % 18) / 10).toFixed(1), stars: 3 + (i % 3), rooms, from: rooms[0].price, currency, nights };
    }).sort((a, b) => a.from - b.from);
  }
  async prebook(offerId) { return { prebookId: 'pre_' + offerId, price: 0, currency: '', changed: 0 }; }
  async book({ prebookId }) { await new Promise(r => setTimeout(r, 500)); return { bookingId: 'bk_' + prebookId, ref: String(Math.floor(1e9 + Math.random() * 9e9)), status: 'CONFIRMED', amount: 0, currency: '', mode: 'demo' }; }
}

module.exports = { Duffel, LiteApi, DemoFlights, DemoStays, isoMinutes, normOffer, call };
