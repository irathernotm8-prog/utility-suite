// Waypoint — destination basics that work with no internet: currency, plugs, voltage, which side
// of the road, emergency numbers, dialling code, languages and the main time zone. Everything here
// can be overridden per trip (Research › Key facts). Rules change, so the window labels these as
// "check before you go". Loaded by the main process and the window.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PLACES = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // code: [name, currency, plugs, volts, drive, emergency, dial, languages, main time zone]
  const C = {
    US: ['United States', 'USD', 'A, B', '120 V', 'right', '911', '+1', 'English', 'America/New_York'],
    CA: ['Canada', 'CAD', 'A, B', '120 V', 'right', '911', '+1', 'English, French', 'America/Toronto'],
    MX: ['Mexico', 'MXN', 'A, B', '127 V', 'right', '911', '+52', 'Spanish', 'America/Mexico_City'],
    CR: ['Costa Rica', 'CRC', 'A, B', '120 V', 'right', '911', '+506', 'Spanish', 'America/Costa_Rica'],
    DO: ['Dominican Republic', 'DOP', 'A, B', '120 V', 'right', '911', '+1', 'Spanish', 'America/Santo_Domingo'],
    CO: ['Colombia', 'COP', 'A, B', '110 V', 'right', '123', '+57', 'Spanish', 'America/Bogota'],
    BR: ['Brazil', 'BRL', 'C, N', '127 / 220 V', 'right', '190 police · 192 ambulance', '+55', 'Portuguese', 'America/Sao_Paulo'],
    AR: ['Argentina', 'ARS', 'C, I', '220 V', 'right', '911', '+54', 'Spanish', 'America/Argentina/Buenos_Aires'],
    CL: ['Chile', 'CLP', 'C, L', '220 V', 'right', '133 police · 131 ambulance', '+56', 'Spanish', 'America/Santiago'],
    GB: ['United Kingdom', 'GBP', 'G', '230 V', 'left', '999 or 112', '+44', 'English', 'Europe/London'],
    IE: ['Ireland', 'EUR', 'G', '230 V', 'left', '112 or 999', '+353', 'English, Irish', 'Europe/Dublin'],
    FR: ['France', 'EUR', 'C, E', '230 V', 'right', '112', '+33', 'French', 'Europe/Paris'],
    DE: ['Germany', 'EUR', 'C, F', '230 V', 'right', '112', '+49', 'German', 'Europe/Berlin'],
    ES: ['Spain', 'EUR', 'C, F', '230 V', 'right', '112', '+34', 'Spanish', 'Europe/Madrid'],
    PT: ['Portugal', 'EUR', 'C, F', '230 V', 'right', '112', '+351', 'Portuguese', 'Europe/Lisbon'],
    IT: ['Italy', 'EUR', 'C, F, L', '230 V', 'right', '112', '+39', 'Italian', 'Europe/Rome'],
    NL: ['Netherlands', 'EUR', 'C, F', '230 V', 'right', '112', '+31', 'Dutch', 'Europe/Amsterdam'],
    BE: ['Belgium', 'EUR', 'C, E', '230 V', 'right', '112', '+32', 'Dutch, French, German', 'Europe/Brussels'],
    CH: ['Switzerland', 'CHF', 'C, J', '230 V', 'right', '112', '+41', 'German, French, Italian', 'Europe/Zurich'],
    AT: ['Austria', 'EUR', 'C, F', '230 V', 'right', '112', '+43', 'German', 'Europe/Vienna'],
    GR: ['Greece', 'EUR', 'C, F', '230 V', 'right', '112', '+30', 'Greek', 'Europe/Athens'],
    HR: ['Croatia', 'EUR', 'C, F', '230 V', 'right', '112', '+385', 'Croatian', 'Europe/Zagreb'],
    CZ: ['Czechia', 'CZK', 'C, E', '230 V', 'right', '112', '+420', 'Czech', 'Europe/Prague'],
    PL: ['Poland', 'PLN', 'C, E', '230 V', 'right', '112', '+48', 'Polish', 'Europe/Warsaw'],
    HU: ['Hungary', 'HUF', 'C, F', '230 V', 'right', '112', '+36', 'Hungarian', 'Europe/Budapest'],
    DK: ['Denmark', 'DKK', 'C, E, F, K', '230 V', 'right', '112', '+45', 'Danish', 'Europe/Copenhagen'],
    SE: ['Sweden', 'SEK', 'C, F', '230 V', 'right', '112', '+46', 'Swedish', 'Europe/Stockholm'],
    NO: ['Norway', 'NOK', 'C, F', '230 V', 'right', '112', '+47', 'Norwegian', 'Europe/Oslo'],
    FI: ['Finland', 'EUR', 'C, F', '230 V', 'right', '112', '+358', 'Finnish, Swedish', 'Europe/Helsinki'],
    IS: ['Iceland', 'ISK', 'C, F', '230 V', 'right', '112', '+354', 'Icelandic', 'Atlantic/Reykjavik'],
    TR: ['Türkiye', 'TRY', 'C, F', '230 V', 'right', '112', '+90', 'Turkish', 'Europe/Istanbul'],
    MA: ['Morocco', 'MAD', 'C, E', '220 V', 'right', '19 police · 15 ambulance', '+212', 'Arabic, Berber (French widely used)', 'Africa/Casablanca'],
    EG: ['Egypt', 'EGP', 'C, F', '220 V', 'right', '122 police · 123 ambulance', '+20', 'Arabic', 'Africa/Cairo'],
    KE: ['Kenya', 'KES', 'G', '240 V', 'left', '999 or 112', '+254', 'Swahili, English', 'Africa/Nairobi'],
    ZA: ['South Africa', 'ZAR', 'C, D, M, N', '230 V', 'left', '10111 police · 112 from a mobile', '+27', 'English, Zulu, Xhosa, Afrikaans and more', 'Africa/Johannesburg'],
    AE: ['United Arab Emirates', 'AED', 'G', '230 V', 'right', '999 police · 998 ambulance', '+971', 'Arabic (English widely used)', 'Asia/Dubai'],
    QA: ['Qatar', 'QAR', 'G, D', '240 V', 'right', '999', '+974', 'Arabic (English widely used)', 'Asia/Qatar'],
    IN: ['India', 'INR', 'C, D, M', '230 V', 'left', '112', '+91', 'Hindi, English and many more', 'Asia/Kolkata'],
    PK: ['Pakistan', 'PKR', 'C, D', '230 V', 'left', '15 police · 1122 rescue', '+92', 'Urdu, English', 'Asia/Karachi'],
    TH: ['Thailand', 'THB', 'A, B, C, O', '230 V', 'left', '191 police · 1669 ambulance', '+66', 'Thai', 'Asia/Bangkok'],
    VN: ['Vietnam', 'VND', 'A, C, F', '220 V', 'right', '113 police · 115 ambulance', '+84', 'Vietnamese', 'Asia/Ho_Chi_Minh'],
    SG: ['Singapore', 'SGD', 'G', '230 V', 'left', '999 police · 995 ambulance', '+65', 'English, Malay, Mandarin, Tamil', 'Asia/Singapore'],
    MY: ['Malaysia', 'MYR', 'G', '240 V', 'left', '999', '+60', 'Malay (English widely used)', 'Asia/Kuala_Lumpur'],
    ID: ['Indonesia', 'IDR', 'C, F', '230 V', 'left', '112', '+62', 'Indonesian', 'Asia/Jakarta'],
    PH: ['Philippines', 'PHP', 'A, B, C', '220 V', 'right', '911', '+63', 'Filipino, English', 'Asia/Manila'],
    JP: ['Japan', 'JPY', 'A, B', '100 V', 'left', '110 police · 119 ambulance', '+81', 'Japanese', 'Asia/Tokyo'],
    KR: ['South Korea', 'KRW', 'C, F', '220 V', 'right', '112 police · 119 ambulance', '+82', 'Korean', 'Asia/Seoul'],
    CN: ['China', 'CNY', 'A, C, I', '220 V', 'right', '110 police · 120 ambulance', '+86', 'Mandarin', 'Asia/Shanghai'],
    HK: ['Hong Kong', 'HKD', 'G', '220 V', 'left', '999', '+852', 'Cantonese, English', 'Asia/Hong_Kong'],
    TW: ['Taiwan', 'TWD', 'A, B', '110 V', 'right', '110 police · 119 ambulance', '+886', 'Mandarin', 'Asia/Taipei'],
    AU: ['Australia', 'AUD', 'I', '230 V', 'left', '000', '+61', 'English', 'Australia/Sydney'],
    NZ: ['New Zealand', 'NZD', 'I', '230 V', 'left', '111', '+64', 'English, Māori', 'Pacific/Auckland'],
  };
  const FIELDS = ['name', 'currency', 'plugs', 'volts', 'drive', 'emergency', 'dial', 'languages', 'tz'];
  function get(code) {
    const r = C[String(code || '').toUpperCase()];
    if (!r) return null;
    const o = { code: String(code).toUpperCase() };
    FIELDS.forEach((f, i) => (o[f] = r[i]));
    return o;
  }
  const list = () => Object.keys(C).map(get).sort((a, b) => a.name.localeCompare(b.name));
  const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'MXN', 'JPY', 'AUD', 'NZD', 'CHF', 'CNY', 'HKD', 'SGD', 'INR', 'PKR', 'AED', 'QAR', 'THB', 'KRW', 'TWD', 'VND', 'MYR', 'IDR', 'PHP', 'TRY', 'SEK', 'NOK', 'DKK', 'ISK', 'PLN', 'CZK', 'HUF', 'ZAR', 'KES', 'EGP', 'MAD', 'BRL', 'ARS', 'CLP', 'COP', 'CRC', 'DOP'];
  // a flag from the two-letter code (regional indicator letters)
  const flag = (code) => /^[A-Z]{2}$/i.test(code || '') ? String(code).toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0))) : '';
  return { get, list, flag, CURRENCIES };
});
