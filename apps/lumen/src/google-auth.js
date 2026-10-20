// Google sign-in for a desktop app: browser consent + PKCE + a one-shot loopback listener.
// You supply your own OAuth client (Desktop app type) once; Lumen keeps only the refresh token, encrypted by main.js.
// Nothing here talks to anyone but accounts.google.com / oauth2.googleapis.com.
const http = require('http');
const crypto = require('crypto');

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
// Read-only everywhere. (adwords is Google's only Ads scope; Lumen's Ads connector only issues report queries.)
const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly'
];
const b64u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function buildAuthUrl({ clientId, redirectUri, challenge, state, scopes = SCOPES }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: scopes.join(' '),
    code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent'
  });
  return `${AUTH}?${q}`;
}

async function tokenCall(params, fetchImpl) {
  const res = await fetchImpl(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const why = body.error === 'invalid_grant' ? ' Sign in to Google again in Sources.' : '';
    throw new Error(`Google sign-in failed: ${body.error_description || body.error || 'HTTP ' + res.status}.${why}`);
  }
  return body;
}

// Opens the consent page via openExternal(url) and resolves with { refreshToken }.
function signIn({ clientId, clientSecret, openExternal, fetchImpl = fetch, timeoutMs = 180000, scopes = SCOPES }) {
  if (!clientId || !clientSecret) return Promise.reject(new Error('Add your Google client ID and secret first (see the Guide).'));
  const verifier = b64u(crypto.randomBytes(32)), challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const state = b64u(crypto.randomBytes(16));
  return new Promise((resolve, reject) => {
    let done = false, timer;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); server.close(); fn(v); };
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') { res.writeHead(404).end(); return; }
      const page = (t) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<body style="font:16px system-ui;padding:48px;text-align:center"><h2>${t}</h2><p>You can close this tab and return to Lumen.</p>`); };
      if (u.searchParams.get('state') !== state) { page('Sign-in link did not match. Try again from Lumen.'); return finish(reject, new Error('Sign-in was interrupted (state mismatch). Try again.')); }
      if (u.searchParams.get('error')) { page('Google sign-in was cancelled.'); return finish(reject, new Error('Google sign-in was cancelled: ' + u.searchParams.get('error'))); }
      try {
        const t = await tokenCall({ code: u.searchParams.get('code'), client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }, fetchImpl);
        if (!t.refresh_token) throw new Error('Google did not return a refresh token. Remove Lumen at myaccount.google.com/permissions and try again.');
        page('Lumen is connected to Google.'); finish(resolve, { refreshToken: t.refresh_token, scope: t.scope });
      } catch (e) { page('Something went wrong.'); finish(reject, e); }
    });
    let redirectUri;
    server.on('error', (e) => finish(reject, e));
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${server.address().port}`;
      timer = setTimeout(() => finish(reject, new Error('Timed out waiting for Google sign-in.')), timeoutMs);
      Promise.resolve(openExternal(buildAuthUrl({ clientId, redirectUri, challenge, state, scopes }))).catch((e) => finish(reject, e));
    });
  });
}

const cache = new Map();
async function accessToken({ clientId, clientSecret, refreshToken }, fetchImpl = fetch) {
  if (!refreshToken) throw new Error('Sign in to Google in Sources first.');
  const hit = cache.get(refreshToken);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;
  const t = await tokenCall({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }, fetchImpl);
  cache.set(refreshToken, { token: t.access_token, exp: Date.now() + (t.expires_in || 3000) * 1000 });
  return t.access_token;
}

// Shared by the Google connectors.
async function gget(url, token, fetchImpl, opts = {}) {
  const res = await fetchImpl(url, { method: opts.method || 'GET', headers: { authorization: 'Bearer ' + token, ...(opts.headers || {}), ...(opts.body ? { 'content-type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const e = body.error || {}; const msg = typeof e === 'string' ? e : e.message || `HTTP ${res.status}`;
    const hint = /has not been used|is disabled|accessNotConfigured/i.test(msg) ? ' (enable this API in your Google Cloud project — see the Guide)' : res.status === 403 ? ' (the signed-in Google account may not have access to this property or account)' : '';
    throw new Error(msg + hint);
  }
  return body;
}

module.exports = { SCOPES, buildAuthUrl, signIn, accessToken, gget, tokenCall };
