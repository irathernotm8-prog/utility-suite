/* Relay — carrier detection for package tracking numbers.
   Shared by the main process (Node) and the renderer (browser). */
(function (root) {
  const CARRIERS = {
    ups:     { name: 'UPS',      color: '#7a4b1f', code17: 100002, url: (n) => `https://www.ups.com/track?tracknum=${n}` },
    usps:    { name: 'USPS',     color: '#2f4f9e', code17: 21051,  url: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}` },
    fedex:   { name: 'FedEx',    color: '#4d148c', code17: 100003, url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}` },
    dhl:     { name: 'DHL',      color: '#d40511', code17: 100001, url: (n) => `https://www.dhl.com/us-en/home/tracking/tracking-express.html?tracking-id=${n}` },
    amazon:  { name: 'Amazon',   color: '#ff9900', code17: 0, url: (n) => `https://track.amazon.com/tracking/${n}` },
    ontrac:  { name: 'OnTrac',   color: '#0d6b3b', code17: 0, url: (n) => `https://www.ontrac.com/tracking/?number=${n}` },
    lasership: { name: 'LaserShip', color: '#e4002b', code17: 0, url: (n) => `https://www.ontrac.com/tracking/?number=${n}` },
    other:   { name: 'Other',    color: '#64748b', code17: 0,      url: (n) => `https://t.17track.net/en?nums=${n}#nums=${n}` }
  };

  const clean = (s) => String(s || '').toUpperCase().replace(/[\s-]/g, '');

  // Order matters: most specific patterns first
  function detect(raw) {
    const n = clean(raw);
    if (!n || n.length < 8 || n.length > 40) return null;
    if (/^1Z[0-9A-Z]{16}$/.test(n)) return 'ups';
    if (/^TBA\d{9,15}$/.test(n)) return 'amazon';
    if (/^1LS\d{12,}$|^LX\d{8,}$/.test(n)) return 'lasership';
    if (/^[CD]\d{14}$/.test(n)) return 'ontrac';
    if (/^[A-Z]{2}\d{9}US$/.test(n)) return 'usps';
    if (/^(94|93|92|95|91|82)\d{18,20}$/.test(n)) return 'usps';
    if (/^420\d{5}(91|92|93|94|95)\d{18,20}$/.test(n)) return 'usps';
    if (/^96\d{20}$/.test(n) || /^\d{12}$/.test(n) || /^\d{15}$/.test(n)) return 'fedex';
    if (/^(JJD|JVGL|GM)\w{8,}$/.test(n) || /^\d{10}$/.test(n)) return 'dhl';
    if (/^\d{20,22}$/.test(n)) return 'usps';
    return null;
  }

  // Find tracking numbers inside free text (an email) and inside carrier links
  function findInText(text, hrefs = []) {
    const found = new Map();
    const add = (num, carrier, how) => {
      const n = clean(num);
      if (!n || found.has(n)) return;
      const c = carrier || detect(n);
      if (c) found.set(n, { number: n, carrier: c, how });
    };
    // 1) links to carrier tracking pages are the most reliable signal
    for (const h of hrefs) {
      let m;
      if ((m = h.match(/ups\.com\/.*(?:tracknum|trackNums|InquiryNumber1)=([0-9A-Z]{18})/i))) add(m[1], 'ups', 'link');
      else if ((m = h.match(/usps\.com\/.*(?:tLabels|qtc_tLabels1|label)=([0-9A-Z]{13,34})/i))) add(m[1], 'usps', 'link');
      else if ((m = h.match(/fedex\.com\/.*(?:trknbr|tracknumbers|tracknumber)=(\d{12,22})/i))) add(m[1], 'fedex', 'link');
      else if ((m = h.match(/dhl\.com\/.*(?:tracking-id|AWB|trackingNumber)=([0-9A-Z]{10,})/i))) add(m[1], 'dhl', 'link');
      else if ((m = h.match(/(?:track\.amazon\.com\/tracking\/|trackingId=)(TBA\d{9,15})/i))) add(m[1], 'amazon', 'link');
      else if ((m = h.match(/ontrac\.com\/.*(?:number|tracking)=([CD]\d{14}|1LS\d{12,})/i))) add(m[1], null, 'link');
    }
    // 2) numbers written in the email, preferably near the word "tracking"
    const t = String(text || '');
    const patterns = [
      /\b1Z\s?[0-9A-Z]{3}\s?[0-9A-Z]{3}\s?[0-9A-Z]{2}\s?[0-9A-Z]{4}\s?[0-9A-Z]{3}\s?[0-9A-Z]\b/gi,
      /\bTBA\d{9,15}\b/g,
      /\b[A-Z]{2}\d{9}US\b/g,
      /\b9[1-5]\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2,4}\b/g,
      /\b[CD]\d{14}\b/g
    ];
    for (const re of patterns) for (const m of t.matchAll(re)) add(m[0], null, 'text');
    // Plain digit runs (FedEx/DHL) only count when the word "tracking" is close by — avoids order numbers
    for (const m of t.matchAll(/tracking\s*(?:number|no\.?|#|id)?\s*[:#]?\s*([0-9]{10,22})\b/gi)) add(m[1], null, 'text');
    return [...found.values()];
  }

  function info(carrier) { return CARRIERS[carrier] || CARRIERS.other; }
  function trackingUrl(carrier, number) { return info(carrier).url(encodeURIComponent(number)); }

  // Read a carrier tracking page's visible text and work out the status (best effort, no API needed)
  function parseStatus(text) {
    const t = String(text || '').replace(/[ \t]+/g, ' ');
    let head = t.slice(0, 4000);
    // Progress trackers list every step ("Label Created · In Transit · Out for Delivery · Delivered") — ignore those bare labels
    const STEP = /^\s*(label created|order (placed|processed)|shipped|in transit|on the way|out for delivery|delivered|pre-shipment|picked up)\s*$/i;
    const lines = head.split('\n');
    if (lines.filter(l => STEP.test(l)).length >= 3) head = lines.filter(l => !STEP.test(l)).join('\n');
    const upcoming = /(estimated|scheduled|expected|anticipated) (delivery|arrival)|arriving|will be delivered|delivery by/i.test(head);
    const has = (re) => re.test(head);
    let status = null;
    if (has(/out for delivery/i)) status = 'out_for_delivery';
    else if (has(/(was|has been) delivered|delivered on\b|delivered,? (at|to|in)\b|^\s*delivered\s*$|your (package|item|shipment) (was|is) delivered/im) && !(/^\s*delivered\s*$/im.test(head) && upcoming)) status = 'delivered';
    else if (has(/delivery exception|exception|delivery attempt(ed)?|unable to deliver|delayed|returned to sender|held at|action required/i)) status = 'exception';
    else if (has(/ready for pickup|available for pickup|awaiting pickup/i)) status = 'pickup';
    else if (has(/in transit|on (the|its) way|departed|arrived at|moving through|processed at|in possession|picked up|shipped/i)) status = 'in_transit';
    else if (has(/label (created|has been created)|shipping label|pre-shipment|shipment information received|order processed|awaiting item|not yet in system/i)) status = 'info_received';
    let event = '';
    const ev = head.match(/(out for delivery|delivered[^\n]{0,60}|departed[^\n]{0,60}|arrived at[^\n]{0,60}|in transit[^\n]{0,60})/i);
    if (ev) event = ev[1].trim();
    return { status, event };
  }

  const api = { CARRIERS, detect, findInText, info, trackingUrl, clean, parseStatus };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Carriers = api;
})(typeof window !== 'undefined' ? window : globalThis);
