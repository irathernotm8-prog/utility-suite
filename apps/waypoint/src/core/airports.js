// Waypoint — major airports, offline, for the flight search form (type a city or code). With a Duffel
// key the form also asks Duffel for suggestions, which covers every airport. Loaded by main and window.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AIRPORTS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // code|city|airport|country
  const RAW = `IAH|Houston|George Bush Intercontinental|US
HOU|Houston|William P. Hobby|US
DFW|Dallas|Dallas/Fort Worth|US
DAL|Dallas|Love Field|US
AUS|Austin|Austin-Bergstrom|US
SAT|San Antonio|San Antonio|US
ATL|Atlanta|Hartsfield-Jackson|US
ORD|Chicago|O'Hare|US
MDW|Chicago|Midway|US
JFK|New York|John F. Kennedy|US
LGA|New York|LaGuardia|US
EWR|New York|Newark Liberty|US
BOS|Boston|Logan|US
PHL|Philadelphia|Philadelphia|US
IAD|Washington|Dulles|US
DCA|Washington|Reagan National|US
BWI|Baltimore|Baltimore/Washington|US
MIA|Miami|Miami|US
FLL|Fort Lauderdale|Fort Lauderdale-Hollywood|US
MCO|Orlando|Orlando|US
TPA|Tampa|Tampa|US
CLT|Charlotte|Charlotte Douglas|US
DTW|Detroit|Detroit Metro|US
MSP|Minneapolis|Minneapolis-Saint Paul|US
DEN|Denver|Denver|US
PHX|Phoenix|Sky Harbor|US
LAS|Las Vegas|Harry Reid|US
LAX|Los Angeles|Los Angeles|US
SFO|San Francisco|San Francisco|US
SJC|San Jose|San Jose|US
OAK|Oakland|Oakland|US
SAN|San Diego|San Diego|US
SEA|Seattle|Seattle-Tacoma|US
PDX|Portland|Portland|US
SLC|Salt Lake City|Salt Lake City|US
MSY|New Orleans|Louis Armstrong|US
BNA|Nashville|Nashville|US
STL|St. Louis|Lambert|US
HNL|Honolulu|Daniel K. Inouye|US
ANC|Anchorage|Ted Stevens|US
YYZ|Toronto|Pearson|CA
YUL|Montreal|Trudeau|CA
YVR|Vancouver|Vancouver|CA
YYC|Calgary|Calgary|CA
MEX|Mexico City|Benito Juárez|MX
CUN|Cancún|Cancún|MX
GDL|Guadalajara|Guadalajara|MX
MTY|Monterrey|Monterrey|MX
SJD|Los Cabos|San José del Cabo|MX
PVR|Puerto Vallarta|Puerto Vallarta|MX
SJO|San José|Juan Santamaría|CR
LIR|Liberia|Guanacaste|CR
PTY|Panama City|Tocumen|PA
SDQ|Santo Domingo|Las Américas|DO
PUJ|Punta Cana|Punta Cana|DO
MBJ|Montego Bay|Sangster|JM
NAS|Nassau|Lynden Pindling|BS
SJU|San Juan|Luis Muñoz Marín|PR
BOG|Bogotá|El Dorado|CO
MDE|Medellín|José María Córdova|CO
CTG|Cartagena|Rafael Núñez|CO
LIM|Lima|Jorge Chávez|PE
GRU|São Paulo|Guarulhos|BR
GIG|Rio de Janeiro|Galeão|BR
EZE|Buenos Aires|Ezeiza|AR
SCL|Santiago|Arturo Merino Benítez|CL
LHR|London|Heathrow|GB
LGW|London|Gatwick|GB
STN|London|Stansted|GB
MAN|Manchester|Manchester|GB
EDI|Edinburgh|Edinburgh|GB
DUB|Dublin|Dublin|IE
CDG|Paris|Charles de Gaulle|FR
ORY|Paris|Orly|FR
NCE|Nice|Côte d'Azur|FR
LYS|Lyon|Saint-Exupéry|FR
AMS|Amsterdam|Schiphol|NL
BRU|Brussels|Brussels|BE
FRA|Frankfurt|Frankfurt|DE
MUC|Munich|Munich|DE
BER|Berlin|Brandenburg|DE
HAM|Hamburg|Hamburg|DE
DUS|Düsseldorf|Düsseldorf|DE
ZRH|Zurich|Zurich|CH
GVA|Geneva|Geneva|CH
VIE|Vienna|Vienna|AT
MAD|Madrid|Barajas|ES
BCN|Barcelona|El Prat|ES
AGP|Málaga|Málaga|ES
PMI|Palma de Mallorca|Palma|ES
SVQ|Seville|Seville|ES
LIS|Lisbon|Humberto Delgado|PT
OPO|Porto|Francisco Sá Carneiro|PT
FAO|Faro|Faro|PT
FCO|Rome|Fiumicino|IT
MXP|Milan|Malpensa|IT
LIN|Milan|Linate|IT
VCE|Venice|Marco Polo|IT
NAP|Naples|Naples|IT
FLR|Florence|Peretola|IT
ATH|Athens|Eleftherios Venizelos|GR
JTR|Santorini|Santorini|GR
JMK|Mykonos|Mykonos|GR
IST|Istanbul|Istanbul|TR
SAW|Istanbul|Sabiha Gökçen|TR
CPH|Copenhagen|Kastrup|DK
ARN|Stockholm|Arlanda|SE
OSL|Oslo|Gardermoen|NO
HEL|Helsinki|Helsinki-Vantaa|FI
KEF|Reykjavík|Keflavík|IS
PRG|Prague|Václav Havel|CZ
BUD|Budapest|Ferenc Liszt|HU
WAW|Warsaw|Chopin|PL
KRK|Kraków|John Paul II|PL
ZAG|Zagreb|Franjo Tuđman|HR
DBV|Dubrovnik|Dubrovnik|HR
SPU|Split|Split|HR
RAK|Marrakesh|Menara|MA
CMN|Casablanca|Mohammed V|MA
CAI|Cairo|Cairo|EG
NBO|Nairobi|Jomo Kenyatta|KE
JNB|Johannesburg|O. R. Tambo|ZA
CPT|Cape Town|Cape Town|ZA
DXB|Dubai|Dubai|AE
AUH|Abu Dhabi|Zayed|AE
DOH|Doha|Hamad|QA
DEL|Delhi|Indira Gandhi|IN
BOM|Mumbai|Chhatrapati Shivaji Maharaj|IN
BLR|Bengaluru|Kempegowda|IN
KHI|Karachi|Jinnah|PK
LHE|Lahore|Allama Iqbal|PK
ISB|Islamabad|Islamabad|PK
BKK|Bangkok|Suvarnabhumi|TH
DMK|Bangkok|Don Mueang|TH
HKT|Phuket|Phuket|TH
CNX|Chiang Mai|Chiang Mai|TH
SGN|Ho Chi Minh City|Tân Sơn Nhất|VN
HAN|Hanoi|Nội Bài|VN
DAD|Da Nang|Da Nang|VN
SIN|Singapore|Changi|SG
KUL|Kuala Lumpur|Kuala Lumpur|MY
CGK|Jakarta|Soekarno-Hatta|ID
DPS|Bali|Ngurah Rai|ID
MNL|Manila|Ninoy Aquino|PH
HND|Tokyo|Haneda|JP
NRT|Tokyo|Narita|JP
KIX|Osaka|Kansai|JP
ITM|Osaka|Itami|JP
CTS|Sapporo|New Chitose|JP
FUK|Fukuoka|Fukuoka|JP
ICN|Seoul|Incheon|KR
GMP|Seoul|Gimpo|KR
PEK|Beijing|Capital|CN
PKX|Beijing|Daxing|CN
PVG|Shanghai|Pudong|CN
CAN|Guangzhou|Baiyun|CN
HKG|Hong Kong|Hong Kong|HK
TPE|Taipei|Taoyuan|TW
SYD|Sydney|Kingsford Smith|AU
MEL|Melbourne|Tullamarine|AU
BNE|Brisbane|Brisbane|AU
PER|Perth|Perth|AU
AKL|Auckland|Auckland|NZ
ZQN|Queenstown|Queenstown|NZ`;
  const LIST = RAW.split('\n').map(l => { const [code, city, name, country] = l.split('|'); return { code, city, name, country }; });
  const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function find(q, limit = 8) {
    q = fold(q).trim(); if (!q) return [];
    const exact = LIST.filter(a => fold(a.code) === q);
    const starts = LIST.filter(a => !exact.includes(a) && (fold(a.city).startsWith(q) || fold(a.name).startsWith(q)));
    const has = LIST.filter(a => !exact.includes(a) && !starts.includes(a) && (fold(a.city).includes(q) || fold(a.name).includes(q)));
    return [...exact, ...starts, ...has].slice(0, limit);
  }
  const get = (code) => LIST.find(a => a.code === String(code || '').toUpperCase()) || null;
  // best airport for a free-text destination ("Lisbon & Porto, Portugal" → LIS)
  function guess(text, country) {
    const t = fold(text);
    const hits = LIST.filter(a => t.includes(fold(a.city)) && (!country || a.country === country));
    if (hits.length) return hits.sort((a, b) => t.indexOf(fold(a.city)) - t.indexOf(fold(b.city)))[0];
    return country ? LIST.find(a => a.country === country) || null : null;
  }
  const label = (a) => a ? `${a.city} (${a.code})` : '';
  // "Lisbon (LIS)" / "lis" / "LIS – Humberto Delgado" → "LIS"
  function codeOf(v) {
    const s = String(v || '').trim();
    const m = /\(([A-Z]{3})\)/.exec(s) || /^([A-Za-z]{3})$/.exec(s) || /^([A-Z]{3})\b/.exec(s);
    if (m) return m[1].toUpperCase();
    const f = find(s, 1)[0]; return f ? f.code : '';
  }
  return { LIST, find, get, guess, label, codeOf };
});
