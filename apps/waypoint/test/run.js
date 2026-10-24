'use strict';
// Waypoint — Node checks for the core (no Electron): node test/run.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const TL = require('../src/core/timeline');
const PLACES = require('../src/core/places');
const { Store, guessTag, safeName } = require('../src/core/store');
const bundle = require('../src/core/bundle');
const pack = require('../src/core/pack');
const { Share } = require('../src/core/share');
const { seed } = require('../src/demo');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'waypoint-test-'));
const get = (url, headers = {}) => new Promise((res, rej) => http.get(url, { headers }, (r) => { const c = []; r.on('data', d => c.push(d)); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(c) })); }).on('error', rej));

test('days, times and phases', () => {
  assert.deepStrictEqual(TL.dayList('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.deepStrictEqual(TL.dayList('2027-03-01', '2027-02-27'), ['2027-03-01']);           // end before start → one day
  assert.strictEqual(TL.addDays('2028-02-28', 1), '2028-02-29');
  assert.strictEqual(TL.daysBetween('2026-03-07', '2026-03-09'), 2);                         // across a DST change
  assert.strictEqual(TL.toMin('07:45'), 465); assert.strictEqual(TL.fromMin(465), '07:45'); assert.strictEqual(TL.fromMin(2000), '23:59');
  assert.strictEqual(TL.snap(68), 75); assert.strictEqual(TL.snap(66), 60);
  const now = new Date(2026, 9, 24, 12, 0);
  assert.deepStrictEqual(TL.phase({ start: '2026-11-01', end: '2026-11-05' }, now), { kind: 'before', days: 8, total: 5 });
  assert.strictEqual(TL.phase({ start: '2026-10-22', end: '2026-10-26' }, now).day, 3);
  assert.strictEqual(TL.phase({ start: '2026-10-01', end: '2026-10-03' }, now).kind, 'after');
  assert.strictEqual(TL.phase({}).kind, 'undated');
  const tokyo = TL.localNow('Asia/Tokyo', new Date(Date.UTC(2026, 9, 24, 20, 30)));
  assert.deepStrictEqual(tokyo, { date: '2026-10-25', min: 5 * 60 + 30 });
});

test('timeline layout, clashes and free time', () => {
  const items = [
    { id: 'a', start: '09:00', end: '11:00', type: 'sight' },
    { id: 'b', start: '10:00', end: '12:00', type: 'food' },
    { id: 'c', start: '10:30', end: '11:00', type: 'activity' },
    { id: 'd', start: '13:00', end: '14:00', type: 'activity' },
    { id: 'e', start: '', title: 'untimed', type: 'note' },
    { id: 'f', start: '22:00', end: '01:00', type: 'food' },          // runs past midnight → to the end of the day
  ];
  const L = TL.layout(items);
  assert.strictEqual(L.get('a').cols, 3); assert.strictEqual(L.get('a').col, 0); assert.strictEqual(L.get('b').col, 1); assert.strictEqual(L.get('c').col, 2);
  assert.strictEqual(L.get('d').cols, 1); assert.ok(!L.has('e'));
  assert.strictEqual(L.get('f').e, 1440);
  const cl = TL.clashes(items).map(p => p.join('')).sort();
  assert.deepStrictEqual(cl, ['ab', 'ac', 'bc']);
  const g = TL.gaps(items);
  assert.deepStrictEqual(g.map(x => [TL.fromMin(x.s), TL.fromMin(x.e)]), [['08:00', '09:00'], ['12:00', '13:00'], ['14:00', '22:00']]);
  const w = TL.window([{ start: '05:30', end: '06:00' }]);
  assert.deepStrictEqual(w, { lo: 300, hi: 1380 });
});

test('bookings put themselves on the timeline and stay in sync', () => {
  let n = 0; const id = () => 'i' + (++n);
  const trip = { items: [{ id: 'mine', day: '2026-11-01', start: '09:00', title: 'Breakfast', type: 'food' }] };
  const stay = { id: 'b1', type: 'stay', title: 'Hotel', startDate: '2026-11-01', startTime: '15:00', endDate: '2026-11-04', address: 'Main St', ref: 'ABC' };
  TL.syncBooking(trip, stay, id);
  const mine = trip.items.filter(i => i.bookingId === 'b1');
  assert.strictEqual(mine.length, 2);
  assert.deepStrictEqual(mine.map(i => [i.day, i.start, i.title]), [['2026-11-01', '15:00', 'Check in · Hotel'], ['2026-11-04', '11:00', 'Check out · Hotel']]);
  assert.strictEqual(mine[0].ref, 'ABC');
  const keepId = mine[0].id;
  stay.startTime = '16:00'; stay.endDate = '2026-11-01';             // same-day: no check-out
  TL.syncBooking(trip, stay, id);
  const after = trip.items.filter(i => i.bookingId === 'b1');
  assert.strictEqual(after.length, 1); assert.strictEqual(after[0].id, keepId); assert.strictEqual(after[0].start, '16:00');
  const fl = { id: 'b2', type: 'flight', title: 'Flight', from: 'IAH', to: 'LIS', startDate: '2026-11-01', startTime: '18:00', endDate: '2026-11-02', endTime: '10:00' };
  TL.syncBooking(trip, fl, id);
  const f = trip.items.filter(i => i.bookingId === 'b2');
  assert.deepStrictEqual(f.map(i => [i.day, i.start, i.end]), [['2026-11-01', '18:00', '23:59'], ['2026-11-02', '00:00', '10:00']]);
  assert.strictEqual(f[0].place, 'IAH → LIS');
  fl.onTimeline = false; TL.syncBooking(trip, fl, id);
  assert.strictEqual(trip.items.filter(i => i.bookingId === 'b2').length, 0);
  TL.unlinkBooking(trip, 'b1');
  assert.deepStrictEqual(trip.items.map(i => i.id), ['mine']);
});

test('budget: currencies, categories, unknown rates and who owes whom', () => {
  const trip = {
    currency: 'USD', rates: { EUR: 1.1 }, travelers: ['A', 'B', 'C'], budget: { total: 0, categories: { food: 300, stay: 700 } },
    bookings: [{ type: 'stay', cost: 500, currency: 'EUR' }, { type: 'flight', cost: 800, currency: 'USD' }, { type: 'car', cost: 100, currency: 'GBP' }],
    expenses: [{ amount: 90, currency: 'USD', category: 'food', paidBy: 'A', date: '2026-11-01' }, { amount: 30, currency: 'EUR', category: 'food', paidBy: 'B', date: '2026-11-01' }, { amount: 10, currency: 'JPY', category: 'other', paidBy: 'C' }],
  };
  const b = TL.budget(trip);
  assert.strictEqual(b.planned, 1000);
  assert.strictEqual(Math.round(b.cats.stay.booked), 550);
  assert.strictEqual(b.cats.flights.booked, 800);
  assert.strictEqual(Math.round(b.cats.food.spent), 123);
  assert.deepStrictEqual(b.missing.sort(), ['GBP', 'JPY']);
  assert.strictEqual(Math.round(b.byDay['2026-11-01']), 123);
  // A paid 90, B paid 33, C paid 0 → share 41 each; C owes A 41, B owes A 8
  const s = b.settle.map(x => `${x.from}>${x.to}:${Math.round(x.amount)}`).sort();
  assert.deepStrictEqual(s, ['B>A:8', 'C>A:41']);
});

test('places and small helpers', () => {
  const pt = PLACES.get('pt');
  assert.strictEqual(pt.currency, 'EUR'); assert.strictEqual(pt.tz, 'Europe/Lisbon'); assert.strictEqual(pt.drive, 'right');
  assert.strictEqual(PLACES.get('JP').drive, 'left');
  assert.strictEqual(PLACES.flag('pt'), '🇵🇹');
  assert.ok(PLACES.list().length >= 50);
  for (const c of PLACES.list()) { assert.ok(c.tz && c.currency && c.emergency, c.code); new Intl.DateTimeFormat('en', { timeZone: c.tz }); }
  assert.strictEqual(guessTag('Passport scan.jpg'), 'passport'); assert.strictEqual(guessTag('BoardingPass.pdf'), 'ticket'); assert.strictEqual(guessTag('hotel confirmation.pdf'), 'booking');
  assert.strictEqual(safeName('a/b:c?.pdf'), 'a_b_c_.pdf'); assert.strictEqual(safeName('CON.txt'), '_CON.txt');
});

test('store: create, save, documents, reload and a damaged trip.json', async () => {
  const dir = tmp(); const s = new Store(dir);
  const t = s.create({ name: 'Paris / Rome', start: '2026-11-01', end: '2026-11-05' });
  assert.ok(fs.existsSync(path.join(dir, 'Paris-Rome', 'trip.json')));
  const src = path.join(tmp(), 'Passport.png'); fs.writeFileSync(src, Buffer.alloc(2048, 7));
  const { added } = await s.addDocs(t.id, [src, src]);
  assert.strictEqual(added.length, 2); assert.strictEqual(added[0].tag, 'passport'); assert.notStrictEqual(added[0].file, added[1].file);
  // the window can't add or repoint documents
  const forged = { ...s.get(t.id), docs: [...s.get(t.id).docs, { id: 'evil', file: '../../etc/passwd' }] };
  forged.docs[0] = { ...forged.docs[0], file: '../../x' };
  const saved = s.save(forged);
  assert.strictEqual(saved.docs.length, 2); assert.ok(saved.docs[0].file.startsWith('Documents/'));
  assert.throws(() => s.docPath(t.id, { file: '../../etc/passwd' }));
  const s2 = new Store(dir); s2.scan();
  assert.strictEqual(s2.get(t.id).docs.length, 2);
  // damaged trip.json → the backup is used
  s2.save(s2.get(t.id));
  fs.writeFileSync(path.join(dir, 'Paris-Rome', 'trip.json'), '{ broken');
  const s3 = new Store(dir); s3.scan();
  assert.strictEqual(s3.get(t.id).name, 'Paris / Rome');
  const r = await s3.removeDoc(t.id, added[0].id);
  assert.ok(r.file.endsWith('Passport.png')); assert.strictEqual(r.trip.docs.length, 1);
});

test('.waypoint: export, peek, import as copy and replace, damage is caught', async () => {
  const a = new Store(tmp()); await seed(a, { which: 'lisbon' });
  const [trip] = a.list();
  const big = path.join(tmp(), 'Big map.pdf'); fs.writeFileSync(big, require('crypto').randomBytes(9 * 1024 * 1024));
  await a.addDocs(trip.id, [big, path.join(tmp(), 'missing.pdf')]);
  const out = path.join(tmp(), 'Lisbon.waypoint');
  let prog = 0;
  const r = await bundle.exportTrip(a, trip.id, out, { onProgress: (d) => (prog = d) });
  assert.strictEqual(r.docs, 6); assert.ok(prog > 9e6);
  const b = new Store(tmp());
  const pk = await bundle.peek(b, out);
  assert.strictEqual(pk.exists, false); assert.strictEqual(pk.docs, 6); assert.ok(pk.bookings >= 6);
  const t1 = await bundle.importTrip(b, out, 'copy');
  assert.strictEqual(t1.id, trip.id);
  const orig = a.get(trip.id), got = b.get(trip.id);
  assert.strictEqual(got.items.length, orig.items.length); assert.strictEqual(got.docs.length, 6);
  for (const d of got.docs) {
    const od = orig.docs.find(x => x.id === d.id);
    assert.ok(fs.readFileSync(b.docPath(got.id, d)).equals(fs.readFileSync(a.docPath(orig.id, od))), d.name);
  }
  // the booking ↔ document links survive
  assert.ok(got.bookings.some(x => x.docs.length));
  const again = await bundle.importTrip(b, out, 'copy');
  assert.notStrictEqual(again.id, trip.id); assert.match(again.name, /\(copy\)$/);
  const rep = await bundle.importTrip(b, out, 'replace');
  assert.strictEqual(rep.id, trip.id); assert.strictEqual(b.list().length, 2);
  assert.strictEqual(fs.readdirSync(path.join(b.folder(trip.id), 'Documents')).length, 6);
  // flip a byte inside the big document
  const buf = fs.readFileSync(out); buf[buf.length - 100] ^= 0xff; const bad = out.replace('.waypoint', '-bad.waypoint'); fs.writeFileSync(bad, buf);
  await assert.rejects(bundle.importTrip(new Store(tmp()), bad, 'copy'), /intact/);
  fs.writeFileSync(bad, buf.subarray(0, buf.length - 5000));
  await assert.rejects(bundle.peek(b, bad), /incomplete/);
  fs.writeFileSync(bad, 'hello');
  await assert.rejects(bundle.peek(b, bad), /isn’t a Waypoint/);
});

test('offline pack and printable itinerary', async () => {
  const s = new Store(tmp()); await seed(s, { which: 'lisbon' });
  const [x] = s.list(); const t = s.get(x.id);
  t.items[0].title = '</script><script>alert(1)</script>';
  const html = pack.build(t, { embed: true, docPath: (d) => s.docPath(t.id, d) });
  assert.ok(!html.includes('</script><script>alert(1)'));
  const data = JSON.parse(html.match(/<script id="trip" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.strictEqual(data.items[0].title, '</script><script>alert(1)</script>');
  assert.ok(data.docs.every(d => d.data && d.data.startsWith('data:')));
  assert.strictEqual(data.facts.currency, 'EUR');
  const linked = pack.build(t, { docUrl: (d) => `/doc/${d.id}` });
  assert.ok(linked.includes(`/doc/${t.docs[0].id}`) && !linked.includes('base64,'));
  const pr = pack.printable(t);
  assert.ok(pr.includes('Day 1') && pr.includes('K7Q2XM') && pr.includes('Casa do Largo'));
});

test('phone hand-off over the network', async () => {
  const s = new Store(tmp()); await seed(s, { which: 'lisbon' });
  const [x] = s.list();
  const settings = {};
  const visits = [];
  const sh = new Share({ store: s, settings: () => settings, saveSettings: () => {}, tmpDir: tmp(), onVisit: (v) => visits.push(v) });
  const info = await sh.open(x.id);
  assert.ok(info.on);
  const base = `http://127.0.0.1:${sh.port}/w/${settings.shareToken}/${x.id}/`;
  const page = await get(base, { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile' });
  assert.strictEqual(page.status, 200); assert.ok(page.body.toString().includes('Save for offline'));
  assert.strictEqual(visits[0].dev, 'iPhone');
  const t = s.get(x.id); const d = t.docs[0];
  const doc = await get(base + 'doc/' + d.id);
  assert.strictEqual(doc.status, 200); assert.strictEqual(doc.body.length, d.size);
  const part = await get(base + 'doc/' + d.id, { range: 'bytes=10-19' });
  assert.strictEqual(part.status, 206); assert.strictEqual(part.body.length, 10);
  const off = await get(base + 'offline.html');
  assert.match(off.headers['content-disposition'], /attachment/); assert.ok(off.body.toString().includes('base64,'));
  const wp = await get(base + 'trip.waypoint');
  assert.strictEqual(wp.status, 200); assert.ok(wp.body.subarray(0, 8).equals(Buffer.from('WAYPOINT')));
  // wrong token, unshared trip, path tricks
  assert.strictEqual((await get(base.replace(settings.shareToken, 'nope'))).status, 404);
  assert.strictEqual((await get(base + 'doc/..%2F..%2Ftrip.json')).status, 404);
  const other = s.create({ name: 'Other' });
  assert.strictEqual((await get(`http://127.0.0.1:${sh.port}/w/${settings.shareToken}/${other.id}/`)).status, 404);
  sh.newLink();
  assert.strictEqual((await get(base)).status, 404);
  sh.close(x.id);
  await new Promise(r => setTimeout(r, 50));
  assert.strictEqual(sh.server, null);
});

test('checks find what’s missing', async () => {
  const s = new Store(tmp()); await seed(s, { which: 'lisbon' });
  const t = s.get(s.list()[0].id);
  const c = TL.checks(t);
  assert.ok(c.some(x => x.kind === 'doc' && /TAP 201/.test(x.text)));   // return flight has no boarding pass
  assert.ok(!c.some(x => x.kind === 'passport'));
  assert.ok(!c.some(x => x.kind === 'stay'));
  t.bookings = t.bookings.filter(b => !/Ribeira/.test(b.title));
  assert.ok(TL.checks(t).some(x => x.kind === 'stay'));
});


// ───────── booking (mock Duffel and LiteAPI servers that answer like the real ones)
function mockServer(handler) {
  return new Promise((res) => {
    const seen = [];
    const srv = http.createServer((req, resp) => {
      let b = ''; req.on('data', d => b += d); req.on('end', () => {
        const body = b ? JSON.parse(b) : null; seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        const [code, json] = handler(req, body); resp.writeHead(code, { 'content-type': 'application/json' }); resp.end(JSON.stringify(json));
      });
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}
const duffelOffer = (id, amount) => ({ id, total_amount: amount, total_currency: 'USD', expires_at: '2026-11-01T00:00:00Z', owner: { name: 'Duffel Airways', iata_code: 'ZZ', logo_symbol_url: 'https://x/zz.svg' },
  passengers: [{ id: 'pas_1', type: 'adult' }, { id: 'pas_2', type: 'adult' }], conditions: { refund_before_departure: { allowed: false }, change_before_departure: { allowed: true } },
  slices: [{ duration: 'PT11H25M', origin: { iata_code: 'IAH', city_name: 'Houston' }, destination: { iata_code: 'LIS', city_name: 'Lisbon' }, segments: [
    { departing_at: '2026-11-01T18:40:00', arriving_at: '2026-11-02T10:05:00', origin: { iata_code: 'IAH', city_name: 'Houston' }, destination: { iata_code: 'EWR', city_name: 'New York' }, marketing_carrier: { name: 'Duffel Airways', iata_code: 'ZZ' }, marketing_carrier_flight_number: '101', aircraft: { name: 'Boeing 787-9' }, passengers: [{ cabin_class_marketing_name: 'Economy', baggages: [{ type: 'checked', quantity: 1 }, { type: 'carry_on', quantity: 0 }] }] },
    { departing_at: '2026-11-02T12:00:00', arriving_at: '2026-11-02T23:30:00', origin: { iata_code: 'EWR', city_name: 'New York' }, destination: { iata_code: 'LIS', city_name: 'Lisbon' }, marketing_carrier: { name: 'Duffel Airways', iata_code: 'ZZ' }, marketing_carrier_flight_number: '202', passengers: [{ cabin_class_marketing_name: 'Economy', baggages: [] }] }] }],
});

test('flights: Duffel search, fresh price, booking → trip bookings on the timeline', async () => {
  const P = require('../src/core/providers');
  const CAP = require('../src/core/capture');
  const m = await mockServer((req, body) => {
    if (req.headers.authorization !== 'Bearer duffel_test_abc' || req.headers['duffel-version'] !== 'v2') return [401, { errors: [{ message: 'bad token' }] }];
    if (req.url.startsWith('/air/offer_requests')) return [201, { data: { offers: [duffelOffer('off_1', '812.40'), duffelOffer('off_2', '640.00')] } }];
    if (req.url === '/air/offers/off_2') return [200, { data: duffelOffer('off_2', '640.00') }];
    if (req.url === '/air/orders') return [201, { data: { id: 'ord_9', booking_reference: 'RZPVBD', total_amount: '640.00', total_currency: 'USD', live_mode: false, owner: { name: 'Duffel Airways' }, passengers: body.data.passengers, slices: duffelOffer('x', '1').slices } }];
    if (req.url.startsWith('/places/suggestions')) return [200, { data: [{ iata_code: 'LIS', name: 'Humberto Delgado Airport', city_name: 'Lisbon', type: 'airport' }] }];
    return [404, { errors: [{ message: 'nope' }] }];
  });
  try {
    const d = new P.Duffel('duffel_test_abc', m.url);
    assert.strictEqual(d.mode, 'test');
    const offers = await d.search({ from: 'IAH', to: 'LIS', depart: '2026-11-01', ret: '2026-11-08', adults: 2, maxStops: 1 });
    const req = m.seen[0];
    assert.match(req.url, /return_offers=true/);
    assert.deepStrictEqual(req.body.data.slices, [{ origin: 'IAH', destination: 'LIS', departure_date: '2026-11-01' }, { origin: 'LIS', destination: 'IAH', departure_date: '2026-11-08' }]);
    assert.strictEqual(req.body.data.passengers.length, 2); assert.strictEqual(req.body.data.max_connections, 1);
    const o = offers.find(x => x.id === 'off_2');
    assert.strictEqual(o.price, 640); assert.strictEqual(o.slices[0].minutes, 685); assert.strictEqual(o.slices[0].stops, 1);
    assert.strictEqual(o.slices[0].segments[0].flight, 'ZZ 101'); assert.strictEqual(o.slices[0].bags, '1 checked'); assert.strictEqual(o.changeable, true);
    assert.deepStrictEqual((await d.places('lis')).map(x => x.code), ['LIS']);
    const pax = [{ given: 'Bilal', family: 'Ahmad', born: '1995-01-01', gender: 'm', email: 'b@example.com', phone: '+17135550100' }, { given: 'Kiana', family: 'Campbell', born: '1996-02-02', gender: 'f', email: 'k@example.com', phone: '+17135550101' }];
    const order = await d.book({ offerId: 'off_2', amount: '640.00', currency: 'USD', passengers: pax.map((p, i) => ({ ...p, id: o.passengerIds[i] })) });
    const ob = m.seen[m.seen.length - 1].body.data;
    assert.strictEqual(ob.type, 'instant'); assert.deepStrictEqual(ob.payments, [{ type: 'balance', amount: '640.00', currency: 'USD' }]);
    assert.strictEqual(ob.passengers[1].id, 'pas_2'); assert.strictEqual(ob.passengers[1].title, 'ms'); assert.strictEqual(ob.passengers[0].born_on, '1995-01-01');
    assert.strictEqual(order.ref, 'RZPVBD'); assert.strictEqual(order.mode, 'test');
    // into the trip
    let n = 0; const trip = { items: [], bookings: [] };
    const bks = CAP.flightBookings(trip, o, order, () => 'b' + (++n));
    assert.strictEqual(bks.length, 1);
    assert.deepStrictEqual([bks[0].from, bks[0].to, bks[0].startDate, bks[0].startTime, bks[0].endDate, bks[0].endTime, bks[0].ref, bks[0].cost], ['IAH', 'LIS', '2026-11-01', '18:40', '2026-11-02', '23:30', 'RZPVBD', 640]);
    assert.match(bks[0].title, /ZZ 101 \+ ZZ 202 · Houston → Lisbon/); assert.match(bks[0].notes, /TEST booking/);
    for (const b of bks) TL.syncBooking(trip, b, () => 'i' + (++n));
    assert.deepStrictEqual(trip.items.map(i => i.day), ['2026-11-01', '2026-11-02']);
    // a bad key reads as a key problem
    await assert.rejects(new P.Duffel('duffel_test_wrong', m.url).search({ from: 'IAH', to: 'LIS', depart: '2026-11-01' }), /didn’t accept your key/);
  } finally { m.srv.close(); }
});

test('stays: LiteAPI search by city, prebook, book on the account card', async () => {
  const P = require('../src/core/providers');
  const CAP = require('../src/core/capture');
  const m = await mockServer((req, body) => {
    if (req.headers['x-api-key'] !== 'sand_123') return [401, { error: { message: 'no' } }];
    if (req.url === '/v3/hotels/rates') return [200, { data: [
      { hotelId: 'lp1', roomTypes: [{ offerId: 'o_b', offerRetailRate: { amount: 540, currency: 'EUR' }, rates: [{ name: 'Double', boardName: 'Room only', cancellationPolicies: { refundableTag: 'NRFN' } }] },
        { offerId: 'o_a', offerRetailRate: { amount: 420, currency: 'EUR' }, rates: [{ name: 'Twin', boardName: 'Breakfast included', maxOccupancy: 2, cancellationPolicies: { refundableTag: 'RFN', cancelPolicyInfos: [{ cancelTime: '2026-10-30 12:00:00' }] } }] }] },
      { hotelId: 'lp2', roomTypes: [{ offerId: 'o_c', offerRetailRate: { amount: 300, currency: 'EUR' }, rates: [{ name: 'Single' }] }] }],
      hotels: [{ id: 'lp1', name: 'Casa do Largo', main_photo: 'https://x/1.jpg', address: 'Largo 12', rating: 8.9 }, { id: 'lp2', name: 'Hostel Lisboa' }] }];
    if (req.url === '/b3/rates/prebook') return [200, { data: { prebookId: 'pre_1', price: 420, currency: 'EUR' } }];
    if (req.url === '/b3/rates/book') return [200, { data: { bookingId: 'bk_77', hotelConfirmationCode: 'HC-5521', status: 'CONFIRMED', price: 420, currency: 'EUR', checkin: '2026-11-02', checkout: '2026-11-05', hotel: { name: 'Casa do Largo' } } }];
    return [404, {}];
  });
  try {
    const l = new P.LiteApi('sand_123', m.url + '/v3', m.url + '/b3');
    assert.strictEqual(l.mode, 'test');
    const hotels = await l.search({ city: 'Lisbon', country: 'PT', checkin: '2026-11-02', checkout: '2026-11-05', adults: 3, rooms: 2, currency: 'EUR' });
    const sb = m.seen[0].body;
    assert.strictEqual(sb.cityName, 'Lisbon'); assert.strictEqual(sb.countryCode, 'PT'); assert.strictEqual(sb.guestNationality, 'US');
    assert.deepStrictEqual(sb.occupancies, [{ adults: 2, children: [] }, { adults: 2, children: [] }]);
    assert.deepStrictEqual(hotels.map(h => h.name), ['Hostel Lisboa', 'Casa do Largo']);       // cheapest first
    const h = hotels[1];
    assert.deepStrictEqual(h.rooms.map(r => r.offerId), ['o_a', 'o_b']); assert.strictEqual(h.rooms[0].perNight, 140); assert.strictEqual(h.rooms[0].refundable, true); assert.strictEqual(h.photo, 'https://x/1.jpg');
    const pre = await l.prebook('o_a');
    assert.strictEqual(pre.prebookId, 'pre_1'); assert.strictEqual(m.seen[1].body.usePaymentSdk, false);
    const res = await l.book({ prebookId: 'pre_1', holder: { given: 'Bilal', family: 'Ahmad', email: 'b@example.com' }, guests: [{ given: 'Bilal', family: 'Ahmad', email: 'b@example.com' }], ref: 'wp-1' });
    const bb = m.seen[2].body;
    assert.deepStrictEqual(bb.payment, { method: 'ACC_CREDIT_CARD' }); assert.strictEqual(bb.holder.firstName, 'Bilal'); assert.strictEqual(bb.guests[0].occupancyNumber, 1); assert.strictEqual(bb.clientReference, 'wp-1');
    assert.strictEqual(res.ref, 'HC-5521');
    const b = CAP.stayBooking(h, h.rooms[0], res, { checkin: '2026-11-02', checkout: '2026-11-05' }, () => 'b1');
    assert.deepStrictEqual([b.type, b.title, b.startDate, b.endDate, b.ref, b.cost, b.currency, b.paid], ['stay', 'Casa do Largo', '2026-11-02', '2026-11-05', 'HC-5521', 420, 'EUR', true]);
    assert.match(b.notes, /Free cancellation until 2026-10-30 12:00/);
    await assert.rejects(l.search({ city: 'Lisbon', checkin: '2026-11-02', checkout: '2026-11-03' }), /country/);
  } finally { m.srv.close(); }
});

test('booking sites, reading confirmation pages, airports and private details', () => {
  const CAP = require('../src/core/capture');
  const A = require('../src/core/airports');
  const { Secrets, keyMode } = require('../src/core/secrets');
  const q = { from: 'IAH', to: 'LIS', depart: '2026-11-01', ret: '2026-11-08', adults: 2 };
  assert.match(CAP.siteUrl('flights', 'google', q).url, /^https:\/\/www\.google\.com\/travel\/flights\?q=Flights%20to%20LIS%20from%20IAH%20on%202026-11-01%20through%202026-11-08/);
  assert.strictEqual(CAP.siteUrl('flights', 'kayak', q).url, 'https://www.kayak.com/flights/IAH-LIS/2026-11-01/2026-11-08/2adults?sort=bestflight_a');
  assert.strictEqual(CAP.siteUrl('flights', 'skyscanner', q).url, 'https://www.skyscanner.com/transport/flights/iah/lis/261101/261108/?adultsv2=2');
  assert.strictEqual(CAP.siteUrl('stays', 'booking', { city: 'Porto', checkin: '2026-11-05', checkout: '2026-11-08', adults: 2 }).url, 'https://www.booking.com/searchresults.html?ss=Porto&checkin=2026-11-05&checkout=2026-11-08&group_adults=2&no_rooms=1');
  const page = 'Thanks, Bilal! Your booking is confirmed.\nBooking number: 4021889113\nPIN: 7731\nCheck-in Mon 2 Nov\nTotal price € 612.40\n2 nights, 1 room';
  assert.ok(CAP.looksConfirmed(page)); assert.ok(!CAP.looksConfirmed('Search results for Lisbon · 412 properties'));
  const g = CAP.readConfirmation(page, 'https://secure.booking.com/confirmation.html', 'Confirmation | Booking.com');
  assert.deepStrictEqual([g.provider, g.kind, g.ref, g.total, g.currency], ['Booking.com', 'stay', '4021889113', 612.4, 'EUR']);
  const fl = CAP.readConfirmation('You’re all set!\nConfirmation code: K7Q2XM\nFlight UA 1234 departs 6:40 AM\nTotal $1,380.00', 'https://www.united.com/en/us/confirmation', '');
  assert.deepStrictEqual([fl.provider, fl.kind, fl.ref, fl.total, fl.currency], ['United', 'flight', 'K7Q2XM', 1380, 'USD']);
  assert.deepStrictEqual(A.find('lisb').map(a => a.code), ['LIS']); assert.strictEqual(A.find('LHR')[0].code, 'LHR'); assert.ok(A.find('tokyo').map(a => a.code).includes('HND'));
  assert.strictEqual(A.guess('Lisbon & Porto, Portugal', 'PT').code, 'LIS'); assert.strictEqual(A.codeOf('Lisbon (LIS)'), 'LIS'); assert.strictEqual(A.codeOf('iah'), 'IAH'); assert.strictEqual(A.codeOf('Houston'), 'IAH');
  assert.strictEqual(new Set(A.LIST.map(a => a.code)).size, A.LIST.length);
  // private details: encrypted when the keychain is there, never readable as plain text
  const f = path.join(tmp(), 'private.bin');
  const fake = { available: () => true, encrypt: (t) => Buffer.from(t).map(x => x ^ 0x5a), decrypt: (b) => Buffer.from(b).map(x => x ^ 0x5a).toString() };
  const s1 = new Secrets(f, fake);
  s1.setKey('duffel', ' duffel_test_xyz '); s1.saveTraveler({ given: 'Bilal', family: 'Ahmad', born: '1995-01-01', email: 'b@example.com' });
  assert.ok(!fs.readFileSync(f).toString().includes('duffel_test_xyz'));
  const s2 = new Secrets(f, fake);
  assert.strictEqual(s2.key('duffel'), 'duffel_test_xyz'); assert.strictEqual(s2.travelers()[0].family, 'Ahmad');
  assert.strictEqual(keyMode('duffel', 'duffel_test_1'), 'test'); assert.strictEqual(keyMode('duffel', 'duffel_live_1'), 'live'); assert.strictEqual(keyMode('liteapi', 'sand_1'), 'test'); assert.strictEqual(keyMode('liteapi', ''), null);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('  ✓', t.name); }
    catch (e) { failed++; console.log('  ✗', t.name, '\n   ', e.stack.split('\n').slice(0, 4).join('\n    ')); }
  }
  console.log(failed ? `\n${failed} failed` : `\nAll ${tests.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
