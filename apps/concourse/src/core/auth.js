'use strict';
// Concourse — Microsoft sign-in. Authorization code + PKCE with a loopback redirect, the way Microsoft asks desktop
// apps to do it: the system browser opens Microsoft's own sign-in page (so MFA, passkeys and company SSO all work),
// Microsoft sends the browser back to http://localhost:<port>, and we trade the code for tokens. No client secret:
// Concourse is a "public client". Tokens never leave this computer; main.js stores them encrypted with the system
// keychain (safeStorage).
const http = require('http');
const crypto = require('crypto');

const AUTHORITY = 'https://login.microsoftonline.com';

/** Everything Concourse asks for at sign-in. All of these can be granted by the user themselves in most tenants. */
const BASE_SCOPES = [
  'openid', 'profile', 'email', 'offline_access',
  'User.Read', 'User.ReadBasic.All', 'People.Read',
  'Chat.ReadWrite', 'ChatMessage.Send',
  'Calendars.ReadWrite',
  'Presence.Read.All', 'Presence.ReadWrite',
  'Tasks.ReadWrite',
  'Team.ReadBasic.All', 'Channel.ReadBasic.All', 'ChannelMessage.Send',
];
/** Reading channel posts needs an admin to approve it in most tenants, so it's asked for separately (Teams › Turn on). */
const CHANNEL_SCOPES = ['ChannelMessage.Read.All'];

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pkce() {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** Reads the (unverified) claims in an id token: we only use them for the account's name and ids. */
function claims(idToken) {
  try { return JSON.parse(Buffer.from(String(idToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
  catch (_) { return {}; }
}

const PAGE = (title, body, ok) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>html,body{height:100%;margin:0;background:#07080b;color:#ffcf6b;font:600 16px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;display:grid;place-items:center;text-align:center}
.b{padding:28px 40px;border:1px solid #2a2418;border-radius:14px;background:#0d0e12;box-shadow:0 0 40px #ffb54722}
h1{margin:0 0 6px;font-size:22px;letter-spacing:.12em;text-shadow:0 0 12px #ffb54788;color:${ok ? '#ffcf6b' : '#ff7a6b'}}p{margin:0;color:#b9a684}</style>
<div class="b"><h1>${title}</h1><p>${body}</p></div>`;

/**
 * Signs in. Opens the browser, waits for Microsoft to come back, returns tokens.
 * @param {{clientId:string, tenant?:string, scopes?:string[], openUrl:(u:string)=>void, loginHint?:string, timeoutMs?:number, prompt?:string}} o
 */
function signIn(o) {
  const tenant = o.tenant || 'organizations';
  const scopes = o.scopes || BASE_SCOPES;
  const { verifier, challenge } = pkce();
  const state = b64url(crypto.randomBytes(16));
  return new Promise((resolve, reject) => {
    let done = false, timer = null;
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://localhost');
      if (u.pathname !== '/' || (!u.searchParams.has('code') && !u.searchParams.has('error'))) { res.writeHead(404); res.end(); return; }
      if (u.searchParams.get('state') !== state) { res.writeHead(400, { 'content-type': 'text/html' }); res.end(PAGE('SIGN-IN REJECTED', 'That reply did not come from this sign-in. Try again from Concourse.', false)); return; }
      const err = u.searchParams.get('error');
      if (err) {
        const desc = u.searchParams.get('error_description') || err;
        res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE('NOT SIGNED IN', escapeHtml(friendlyError(desc)), false));
        finish(new AuthError(friendlyError(desc), err, desc)); return;
      }
      try {
        const tok = await tokenRequest(tenant, {
          client_id: o.clientId, grant_type: 'authorization_code', code: u.searchParams.get('code'),
          redirect_uri: redirect, code_verifier: verifier, scope: scopes.join(' '),
        });
        res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE('ALL ABOARD', 'You’re signed in. You can close this tab and go back to Concourse.', true));
        finish(null, tok);
      } catch (e) {
        res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE('NOT SIGNED IN', escapeHtml(e.message), false));
        finish(e);
      }
    });
    let redirect = '';
    function finish(err, tok) {
      if (done) return; done = true; clearTimeout(timer);
      setTimeout(() => server.close(), 300);
      if (err) reject(err); else resolve(tok);
    }
    server.on('error', (e) => finish(e));
    server.listen(0, '127.0.0.1', () => {
      redirect = `http://localhost:${server.address().port}`;
      const q = new URLSearchParams({
        client_id: o.clientId, response_type: 'code', redirect_uri: redirect, response_mode: 'query',
        scope: scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256',
        prompt: o.prompt || 'select_account',
      });
      if (o.loginHint) q.set('login_hint', o.loginHint);
      o.openUrl(`${AUTHORITY}/${tenant}/oauth2/v2.0/authorize?${q}`);
      timer = setTimeout(() => finish(new AuthError('Sign-in timed out. Start again from Concourse.', 'timeout')), o.timeoutMs || 5 * 60 * 1000);
    });
  });
}

/** Swaps a refresh token for a fresh access token. Microsoft may hand back a new refresh token too. */
function refresh({ clientId, tenant, refreshToken, scopes }) {
  return tokenRequest(tenant || 'organizations', { client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken, scope: (scopes || BASE_SCOPES).join(' ') });
}

class AuthError extends Error { constructor(msg, code, detail) { super(msg); this.code = code; this.detail = detail; } }

async function tokenRequest(tenant, form) {
  const res = await fetch(`${AUTHORITY}/${tenant}/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    const d = j.error_description || j.error || `HTTP ${res.status}`;
    throw new AuthError(friendlyError(d), j.error || 'token', d);
  }
  const c = claims(j.id_token);
  return {
    accessToken: j.access_token, refreshToken: j.refresh_token || form.refresh_token || null,
    expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60 * 1000,
    scopes: String(j.scope || '').split(' ').filter(Boolean),
    idClaims: c,
  };
}

/** Microsoft's errors as plain sentences. AADSTS codes are the stable part. */
function friendlyError(desc) {
  const s = String(desc || '');
  if (/AADSTS65001|consent_required/i.test(s)) return 'Your organisation hasn’t approved Concourse yet. Ask your IT admin to grant consent (Settings › Accounts › “Admin consent link” has the link to send them).';
  if (/AADSTS90094|AADSTS90008|admin approval|needs permission to access resources/i.test(s)) return 'Your organisation needs an admin to approve Concourse before you can sign in. Settings › Accounts › “Admin consent link” has a link to send them.';
  if (/AADSTS700016|was not found in the directory/i.test(s)) return 'Microsoft doesn’t recognise this app ID. Check the Application (client) ID in Settings › Accounts, and that the app is set to “Accounts in any organizational directory”.';
  if (/AADSTS50011|redirect URI/i.test(s)) return 'The app registration is missing its redirect URI. Add “http://localhost” under Authentication › Mobile and desktop applications.';
  if (/AADSTS7000218|client_assertion|client_secret/i.test(s)) return 'The app registration needs “Allow public client flows” turned on (Authentication › Advanced settings).';
  if (/AADSTS50020|AADSTS500200|personal Microsoft account|MSA/i.test(s)) return 'Personal Microsoft accounts can’t use Teams chats through Microsoft Graph. Sign in with a work or school account.';
  if (/AADSTS700082|AADSTS70008|AADSTS50173|invalid_grant|expired/i.test(s)) return 'Your sign-in expired. Sign in again.';
  if (/access_denied|AADSTS65004|declined/i.test(s)) return 'Sign-in was cancelled.';
  return s.replace(/\r?\n.*$/s, '').replace(/^AADSTS\d+:\s*/, '') || 'Sign-in failed.';
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

/** The link an admin opens to approve Concourse for the whole organisation. */
function adminConsentUrl(clientId, tenant = 'organizations') {
  return `${AUTHORITY}/${tenant}/v2.0/adminconsent?client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(['https://graph.microsoft.com/.default'].join(' '))}&redirect_uri=${encodeURIComponent('http://localhost')}`;
}

module.exports = { signIn, refresh, claims, pkce, friendlyError, adminConsentUrl, AuthError, BASE_SCOPES, CHANNEL_SCOPES };
