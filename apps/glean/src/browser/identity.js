// Glean — browser identity per site (shared with Kiln and Relay).
// Google and Microsoft refuse sign-in when they think the page is inside an "embedded" app.
// We present a consistent, ordinary browser identity (headers + JavaScript) everywhere.
const WIN = process.platform === 'win32';
const OS_UA = WIN ? 'Windows NT 10.0; Win64; x64' : 'Macintosh; Intel Mac OS X 10_15_7';
const OS_UA_FF = WIN ? 'Windows NT 10.0; Win64; x64' : 'Macintosh; Intel Mac OS X 10.15';
const PLATFORM = WIN ? 'Windows' : 'macOS';
const NAV_PLATFORM = WIN ? 'Win32' : 'MacIntel';
const CHROME_MAJOR = process.versions.chrome.split('.')[0];
const CHROME_FULL = process.versions.chrome;
const FIREFOX_V = `${Number(CHROME_MAJOR) + 1}.0`;

const IDENTITIES = {
  chrome: {
    kind: 'chrome',
    ua: `Mozilla/5.0 (${OS_UA}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`,
    vendor: 'Google Inc.',
    brands: [['Google Chrome', CHROME_MAJOR], ['Chromium', CHROME_MAJOR], ['Not?A_Brand', '99']]
  },
  edge: {
    kind: 'edge',
    ua: `Mozilla/5.0 (${OS_UA}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROME_MAJOR}.0.0.0`,
    vendor: 'Google Inc.',
    brands: [['Microsoft Edge', CHROME_MAJOR], ['Chromium', CHROME_MAJOR], ['Not?A_Brand', '99']]
  },
  firefox: {
    kind: 'firefox',
    ua: `Mozilla/5.0 (${OS_UA_FF}; rv:${FIREFOX_V}) Gecko/20100101 Firefox/${FIREFOX_V}`,
    vendor: '',
    brands: null
  }
};

const GOOGLE_LOGIN = /(^|\.)accounts\.google\.com$|(^|\.)accounts\.youtube\.com$|^gds\.google\.com$/;
const MS_LOGIN = /(^|\.)login\.live\.com$|(^|\.)login\.microsoftonline\.com$|(^|\.)account\.live\.com$|(^|\.)signup\.live\.com$|(^|\.)account\.microsoft\.com$|(^|\.)login\.microsoft\.com$/;

function identityFor(url) {
  let h = '';
  try { h = new URL(url).hostname; } catch {}
  if (GOOGLE_LOGIN.test(h)) return IDENTITIES.firefox;
  if (MS_LOGIN.test(h)) return IDENTITIES.edge;
  return IDENTITIES.chrome;
}

function secChUa(brands) { return brands.map(([b, v]) => `"${b}";v="${v}"`).join(', '); }

function rewriteHeaders(headers, id) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk === 'user-agent' || lk.startsWith('sec-ch-ua')) continue;
    out[k] = v;
  }
  out['User-Agent'] = id.ua;
  if (id.brands) {
    out['sec-ch-ua'] = secChUa(id.brands);
    out['sec-ch-ua-mobile'] = '?0';
    out['sec-ch-ua-platform'] = `"${PLATFORM}"`;
  }
  return out;
}

function navigatorPatch(id) {
  const brands = id.brands ? id.brands.map(([brand, version]) => ({ brand, version })) : null;
  const full = id.brands ? id.brands.map(([brand, v]) => ({ brand, version: v === '99' ? '99.0.0.0' : CHROME_FULL })) : null;
  return `(() => {
    try {
      const id = ${JSON.stringify({ kind: id.kind, ua: id.ua, vendor: id.vendor, brands, full, platform: PLATFORM, navPlatform: NAV_PLATFORM })};
      const N = Navigator.prototype;
      const def = (o, k, get) => { try { Object.defineProperty(o, k, { get, configurable: true }); } catch (e) {} };
      def(N, 'userAgent', () => id.ua);
      def(N, 'appVersion', () => id.ua.replace(/^Mozilla\\//, ''));
      def(N, 'vendor', () => id.vendor);
      def(N, 'platform', () => id.navPlatform);
      if (!id.brands) {
        def(N, 'userAgentData', () => undefined);
        if (id.kind === 'firefox') {
          def(N, 'buildID', () => '20181001000000');
          def(N, 'oscpu', () => id.platform === 'Windows' ? 'Windows NT 10.0; Win64; x64' : 'Intel Mac OS X 10.15');
          try { delete window.chrome; } catch (e) {}
          try { Object.defineProperty(window, 'chrome', { get: () => undefined, configurable: true }); } catch (e) {}
        }
      } else {
        const data = {
          brands: id.brands, mobile: false, platform: id.platform,
          getHighEntropyValues: async () => ({ brands: id.brands, mobile: false, platform: id.platform, platformVersion: id.platform === 'Windows' ? '15.0.0' : '15.5.0', architecture: id.platform === 'Windows' ? 'x86' : 'arm', bitness: '64', model: '', wow64: false, uaFullVersion: id.full[0].version, fullVersionList: id.full }),
          toJSON() { return { brands: id.brands, mobile: false, platform: id.platform }; }
        };
        def(N, 'userAgentData', () => data);
      }
    } catch (e) {}
  })();`;
}

module.exports = { IDENTITIES, identityFor, rewriteHeaders, navigatorPatch };
