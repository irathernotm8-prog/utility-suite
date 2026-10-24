'use strict';
// Sample trips: used by "Try a sample trip" on the welcome screen and by WAYPOINT_DEMO=1 (screenshots).
// Dates are set around today so the timeline, countdown and "now" line have something to show.
const TL = require('./core/timeline');
const { newId } = require('./core/store');

function minimalPdf(lines) {
  const text = lines.map((l, i) => `BT /F1 ${i === 0 ? 20 : 12} Tf 56 ${740 - i * 26} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out);
}
function boardingSvg(from, to, flight, seat) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="380" viewBox="0 0 900 380"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#ff8a4c"/><stop offset="1" stop-color="#7a3cff"/></linearGradient></defs><rect width="900" height="380" rx="28" fill="#fff"/><rect width="900" height="90" rx="28" fill="url(#g)"/><rect y="60" width="900" height="30" fill="url(#g)"/><text x="40" y="58" font-family="Helvetica" font-size="30" font-weight="700" fill="#fff">BOARDING PASS</text><text x="40" y="190" font-family="Helvetica" font-size="78" font-weight="800" fill="#1c1a17">${from}</text><text x="330" y="190" font-family="Helvetica" font-size="50" fill="#bbb">→</text><text x="430" y="190" font-family="Helvetica" font-size="78" font-weight="800" fill="#1c1a17">${to}</text><text x="40" y="260" font-family="Helvetica" font-size="22" fill="#777">FLIGHT</text><text x="40" y="300" font-family="Helvetica" font-size="34" font-weight="700" fill="#1c1a17">${flight}</text><text x="300" y="260" font-family="Helvetica" font-size="22" fill="#777">SEAT</text><text x="300" y="300" font-family="Helvetica" font-size="34" font-weight="700" fill="#1c1a17">${seat}</text><g fill="#1c1a17">${Array.from({ length: 34 }, (_, i) => `<rect x="${640 + i * 6}" y="150" width="${(i * 7) % 3 + 1}" height="170"/>`).join('')}</g></svg>`);
}

async function seed(store, { which = 'all' } = {}) {
  const today = TL.todayStr();
  const id = () => newId();
  const made = [];

  // ── Lisbon & Porto: started yesterday
  if (which === 'all' || which === 'lisbon') {
    const s = TL.addDays(today, -1), e = TL.addDays(today, 5);
    const t = store.create({ name: 'Lisbon & Porto', destination: 'Lisbon & Porto, Portugal', country: 'PT', tz: 'Europe/Lisbon', start: s, end: e, cover: 'sunset', currency: 'USD', localCurrency: 'EUR', travelers: ['Bilal', 'Kiana'] });
    const d = (n) => TL.addDays(s, n);
    t.rates = { EUR: 1.08 };
    t.budget = { total: 4200, categories: { flights: 1500, stay: 1350, food: 600, transport: 250, activities: 350, shopping: 150 } };
    t.bookings = [
      { id: id(), type: 'flight', title: 'TAP 202 · Houston → Lisbon', provider: 'TAP Air Portugal', ref: 'K7Q2XM', from: 'IAH', to: 'LIS', startDate: d(0), startTime: '06:40', endDate: d(0), endTime: '10:55', seat: '23A, 23B', cost: 1380, currency: 'USD', paid: true, notes: 'Overnight from Houston; times shown in Lisbon time.', docs: [] },
      { id: id(), type: 'stay', title: 'Casa do Largo, Alfama', provider: 'Booking.com', ref: '4021 889 113', address: 'Largo do Chafariz de Dentro 12, Lisbon', startDate: d(0), startTime: '14:00', endDate: d(3), endTime: '11:00', cost: 612, currency: 'EUR', paid: true, phone: '+351 21 000 0000', docs: [] },
      { id: id(), type: 'train', title: 'Alfa Pendular · Lisbon → Porto', provider: 'CP', ref: 'CP-7781-2', from: 'Santa Apolónia', to: 'Porto Campanhã', startDate: d(3), startTime: '12:09', endDate: d(3), endTime: '15:01', seat: 'Car 4 · 31, 32', cost: 62, currency: 'EUR', paid: true, docs: [] },
      { id: id(), type: 'stay', title: 'Ribeira Loft', provider: 'Airbnb', ref: 'HMX4KQ9TZ', address: 'Rua da Fonte Taurina 40, Porto', startDate: d(3), startTime: '16:00', endDate: d(6), endTime: '10:00', cost: 540, currency: 'EUR', paid: false, docs: [] },
      { id: id(), type: 'ticket', title: 'Livraria Lello timed entry', ref: 'LL-55120', address: 'Rua das Carmelitas 144, Porto', startDate: d(4), startTime: '09:30', endTime: '10:15', cost: 20, currency: 'EUR', paid: true, docs: [] },
      { id: id(), type: 'flight', title: 'TAP 201 · Porto → Houston via Lisbon', provider: 'TAP Air Portugal', ref: 'K7Q2XM', from: 'OPO', to: 'IAH', startDate: d(6), startTime: '11:20', endDate: d(6), endTime: '18:35', cost: 0, currency: 'USD', paid: true, docs: [] },
    ];
    for (const b of t.bookings) TL.syncBooking(t, b, id);
    const add = (n, start, end, title, type, place = '', notes = '') => t.items.push({ id: id(), day: d(n), start, end, title, type, place, notes });
    add(0, '12:00', '13:15', 'Lunch at Taberna da Rua das Flores', 'food', 'Chiado', 'Walk-ins only — get there before noon.');
    add(0, '16:30', '18:30', 'Wander Alfama to Miradouro da Senhora do Monte', 'sight', 'Alfama', 'Golden hour from the top.');
    add(0, '20:00', '22:00', 'Fado dinner', 'food', 'Clube de Fado');
    add(1, '09:00', '10:00', 'Pastéis de Belém', 'food', 'Belém');
    add(1, '10:00', '12:30', 'Jerónimos Monastery', 'sight', 'Belém', 'Tickets at the door, or the Lisboa Card.');
    add(1, '13:00', '14:30', 'Time Out Market', 'food', 'Cais do Sodré');
    add(1, '15:00', '17:30', 'LX Factory', 'activity', 'Alcântara');
    add(1, '17:00', '18:00', 'Sunset on the river', 'rest', 'Ribeira das Naus');
    add(1, '20:30', '22:30', 'Dinner in Bairro Alto', 'food', 'Bairro Alto');
    add(2, '08:15', '09:00', 'Train to Sintra', 'train', 'Rossio station');
    add(2, '09:30', '13:00', 'Pena Palace & Moorish Castle', 'sight', 'Sintra');
    add(2, '19:30', '21:00', 'Dinner at Cervejaria Ramiro', 'food', 'Intendente', 'Order the prawns and the steak sandwich after.');
    add(3, '09:30', '11:00', 'Tram 28 one last time', 'transit', 'Martim Moniz');
    add(4, '11:00', '13:00', 'Ribeira & Dom Luís I bridge', 'sight', 'Ribeira');
    add(4, '15:00', '17:00', 'Port lodge tasting', 'activity', 'Vila Nova de Gaia');
    add(5, '10:00', '17:00', 'Douro Valley day trip', 'activity', 'Pinhão', 'Pickup 9:45 outside the loft.');
    t.expenses = [
      { id: id(), date: d(0), title: 'Airport taxi', amount: 24, currency: 'EUR', category: 'transport', paidBy: 'Kiana' },
      { id: id(), date: d(0), title: 'Lunch, Taberna', amount: 46, currency: 'EUR', category: 'food', paidBy: 'Bilal' },
      { id: id(), date: d(0), title: 'Fado dinner', amount: 92, currency: 'EUR', category: 'food', paidBy: 'Bilal' },
      { id: id(), date: d(1), title: 'Pastéis de Belém', amount: 9.6, currency: 'EUR', category: 'food', paidBy: 'Kiana' },
      { id: id(), date: d(1), title: 'Jerónimos tickets', amount: 36, currency: 'EUR', category: 'activities', paidBy: 'Kiana' },
      { id: id(), date: d(1), title: 'Ceramics at LX Factory', amount: 58, currency: 'EUR', category: 'shopping', paidBy: 'Bilal' },
    ];
    t.research.places = [
      { id: id(), name: 'Miradouro de Santa Luzia', kind: 'sight', area: 'Alfama', notes: 'Tiles and river views', want: true, visited: true },
      { id: id(), name: 'A Cevicheria', kind: 'food', area: 'Príncipe Real', notes: 'Queue early', want: true },
      { id: id(), name: 'Gulbenkian Museum', kind: 'sight', area: 'Avenidas Novas', notes: 'Garden is free', want: true },
      { id: id(), name: 'Majestic Café', kind: 'food', area: 'Porto · Baixa', notes: '', want: true },
      { id: id(), name: 'Serralves', kind: 'sight', area: 'Porto', notes: 'Modern art + park', want: true },
    ];
    t.research.links = [{ id: id(), title: 'Lisboa Card', url: 'https://www.visitlisboa.com/' }, { id: id(), title: 'CP train times', url: 'https://www.cp.pt/' }];
    t.research.packing = ['Passports', 'Power adapters (type F)', 'Comfortable walking shoes', 'Light jacket for evenings', 'Sunscreen', 'Phone chargers', 'Travel insurance card', 'Euros for small cafés']
      .map((text, i) => ({ id: id(), text, done: i < 3 }));
    t.research.notes = 'Most places take card, but small tascas and the trams like cash.\nTipping: rounding up or ~5–10% at sit-down meals is plenty.\nSunday: many shops in Baixa close early.';
    store.save(t);
    const fl = t.bookings[0], st = t.bookings[1], tr = t.bookings[2];
    await store.addDocBytes(t.id, 'Boarding pass IAH-LIS.svg', boardingSvg('IAH', 'LIS', 'TP 202', '23A'), { tag: 'ticket', bookingId: fl.id, who: 'Bilal', name: 'Boarding pass · IAH → LIS' });
    await store.addDocBytes(t.id, 'Casa do Largo confirmation.pdf', minimalPdf(['Casa do Largo, Alfama', 'Booking confirmation 4021 889 113', `Check-in ${d(0)} from 14:00`, `Check-out ${d(3)} by 11:00`, 'Guests: 2']), { tag: 'booking', bookingId: st.id, name: 'Casa do Largo confirmation' });
    await store.addDocBytes(t.id, 'CP ticket.pdf', minimalPdf(['CP Alfa Pendular', 'Lisboa Santa Apolonia - Porto Campanha', `${d(3)} 12:09`, 'Car 4 seats 31, 32']), { tag: 'ticket', bookingId: tr.id, name: 'Train tickets' });
    await store.addDocBytes(t.id, 'Passport Bilal.pdf', minimalPdf(['Passport copy', '(sample document)']), { tag: 'passport', who: 'Bilal', name: 'Passport · Bilal' });
    await store.addDocBytes(t.id, 'Travel insurance.pdf', minimalPdf(['Travel insurance policy', 'Policy TI-2231-PT', 'Emergency line +1 800 000 0000']), { tag: 'insurance', name: 'Travel insurance' });
    const fresh = store.get(t.id);
    for (const doc of fresh.docs) if (doc.bookingId) { const b = fresh.bookings.find(x => x.id === doc.bookingId); if (b && !b.docs.includes(doc.id)) b.docs.push(doc.id); }
    store.save(fresh);
    made.push(t.id);
  }

  // ── Tokyo: in a few months, still being planned
  if (which === 'all') {
    const s = TL.addDays(today, 140), e = TL.addDays(today, 150);
    const t = store.create({ name: 'Tokyo in spring', destination: 'Tokyo & Kyoto, Japan', country: 'JP', tz: 'Asia/Tokyo', start: s, end: e, cover: 'dusk', currency: 'USD', localCurrency: 'JPY', travelers: ['Bilal'] });
    t.budget = { total: 5200, categories: { flights: 1600, stay: 1800, food: 800, transport: 450, activities: 400, shopping: 150 } };
    t.rates = { JPY: 0.0066 };
    t.bookings = [{ id: id(), type: 'flight', title: 'NH 175 · Houston → Tokyo', provider: 'ANA', ref: '', from: 'IAH', to: 'HND', startDate: s, startTime: '11:00', endDate: TL.addDays(s, 1), endTime: '15:30', cost: 1490, currency: 'USD', paid: true, docs: [] }];
    for (const b of t.bookings) TL.syncBooking(t, b, id);
    t.research.places = [{ id: id(), name: 'teamLab Planets', kind: 'activity', area: 'Toyosu', notes: 'Book a week ahead', want: true }, { id: id(), name: 'Fushimi Inari at sunrise', kind: 'sight', area: 'Kyoto', notes: '', want: true }];
    store.save(t);
    made.push(t.id);
  }

  // ── Mexico City: last spring
  if (which === 'all') {
    const s = TL.addDays(today, -200), e = TL.addDays(today, -196);
    const t = store.create({ name: 'CDMX long weekend', destination: 'Mexico City, Mexico', country: 'MX', tz: 'America/Mexico_City', start: s, end: e, cover: 'desert', currency: 'USD', localCurrency: 'MXN', travelers: ['Bilal', 'Kiana'] });
    t.items.push({ id: id(), day: s, start: '13:00', end: '15:00', title: 'Tacos in Roma Norte', type: 'food', place: 'Roma Norte' });
    store.save(t);
    made.push(t.id);
  }
  return made;
}

module.exports = { seed, minimalPdf };
