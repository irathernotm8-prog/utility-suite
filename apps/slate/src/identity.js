// Slate — browser identity per site (from Relay).
// Google and Microsoft refuse sign-in when they think the page is inside an "embedded" app.
// We present a consistent, ordinary browser identity (headers + JavaScript) for their sign-in pages.
const CHROME_MAJOR = process.versions.chrome.split('.')[0];
const CHROME_FULL = process.versions.chrome;
// Firefox's version number runs a release or two ahead of Chrome's; keep it current as Electron updates
const FIREFOX_V = `${Number(CHROME_MAJOR) + 1}.0`;

const IDENTITIES = {
  chrome: {
    kind: 'chrome',
    ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`,
    vendor: 'Google Inc.',
    brands: [['Google Chrome', CHROME_MAJOR], ['Chromium', CHROME_MAJOR], ['Not?A_Brand', '99']]
  },
  edge: {
    kind: 'edge',
    ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROME_MAJOR}.0.0.0`,
    vendor: 'Google Inc.',
    brands: [['Microsoft Edge', CHROME_MAJOR], ['Chromium', CHROME_MAJOR], ['Not?A_Brand', '99']]
  },
  firefox: {
    kind: 'firefox',
    ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:${FIREFOX_V}) Gecko/20100101 Firefox/${FIREFOX_V}`,
    vendor: '',
    brands: null
  },
  safari: {
    kind: 'safari',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    vendor: 'Apple Computer, Inc.',
    brands: null
  }
};

const GOOGLE_LOGIN = /(^|\.)accounts\.google\.com$|(^|\.)accounts\.youtube\.com$|^gds\.google\.com$/;
const MS_LOGIN = /(^|\.)login\.live\.com$|(^|\.)login\.microsoftonline\.com$|(^|\.)account\.live\.com$|(^|\.)signup\.live\.com$|(^|\.)account\.microsoft\.com$|(^|\.)login\.microsoft\.com$/;

// mode: 'auto' | 'chrome' | 'edge' | 'firefox' | 'safari'
function identityFor(url, mode = 'auto') {
  if (mode && mode !== 'auto' && IDENTITIES[mode]) {
    // Explicit modes apply to sign-in pages only; mail pages keep the regular Chrome identity
    let host = '';
    try { host = new URL(url).hostname; } catch {}
    if (GOOGLE_LOGIN.test(host) || MS_LOGIN.test(host) || /login\.yahoo\.com$/.test(host)) return IDENTITIES[mode];
    return IDENTITIES.chrome;
  }
  let host = '';
  try { host = new URL(url).hostname; } catch {}
  if (GOOGLE_LOGIN.test(host)) return IDENTITIES.firefox;
  if (MS_LOGIN.test(host)) return IDENTITIES.edge;
  return IDENTITIES.chrome;
}

function secChUa(brands) {
  return brands.map(([b, v]) => `"${b}";v="${v}"`).join(', ');
}

// Rewrites outgoing headers so they match the identity of the page making the request.
function rewriteHeaders(headers, id) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk === 'user-agent') continue;
    if (lk.startsWith('sec-ch-ua')) continue;
    out[k] = v;
  }
  out['User-Agent'] = id.ua;
  if (id.brands) {
    out['sec-ch-ua'] = secChUa(id.brands);
    out['sec-ch-ua-mobile'] = '?0';
    out['sec-ch-ua-platform'] = '"macOS"';
  }
  return out;
}

// Script injected into the page's main world before its own scripts run.
function navigatorPatch(id) {
  const brands = id.brands ? id.brands.map(([brand, version]) => ({ brand, version })) : null;
  const full = id.brands ? id.brands.map(([brand, v]) => ({ brand, version: v === '99' ? '99.0.0.0' : CHROME_FULL })) : null;
  return `(() => {
    try {
      const id = ${JSON.stringify({ kind: id.kind, ua: id.ua, vendor: id.vendor, brands, full })};
      const N = Navigator.prototype;
      const def = (o, k, get) => { try { Object.defineProperty(o, k, { get, configurable: true }); } catch (e) {} };
      def(N, 'userAgent', () => id.ua);
      def(N, 'appVersion', () => id.ua.replace(/^Mozilla\\//, ''));
      def(N, 'vendor', () => id.vendor);
      def(N, 'platform', () => 'MacIntel');
      if (!id.brands) {
        def(N, 'userAgentData', () => undefined);
        if (id.kind === 'firefox') {
          def(N, 'buildID', () => '20181001000000');
          def(N, 'oscpu', () => 'Intel Mac OS X 10.15');
          try { delete window.chrome; } catch (e) {}
          try { Object.defineProperty(window, 'chrome', { get: () => undefined, configurable: true }); } catch (e) {}
        }
      } else {
        const data = {
          brands: id.brands, mobile: false, platform: 'macOS',
          getHighEntropyValues: async () => ({ brands: id.brands, mobile: false, platform: 'macOS', platformVersion: '15.5.0', architecture: 'arm', bitness: '64', model: '', wow64: false, uaFullVersion: id.full[0].version, fullVersionList: id.full }),
          toJSON() { return { brands: id.brands, mobile: false, platform: 'macOS' }; }
        };
        def(N, 'userAgentData', () => data);
      }
    } catch (e) {}
  })();`;
}

module.exports = { IDENTITIES, identityFor, rewriteHeaders, navigatorPatch, GOOGLE_LOGIN, MS_LOGIN };
