// FCM push notifications — HTTP v1 API.
//
// Why v1, not the legacy endpoint: the legacy FCM HTTP API
// (https://fcm.googleapis.com/fcm/send + a server key) is DISABLED for
// Firebase projects created after June 2024, and this project's Firebase
// project ("Job Tracker", job-tracker-cf49e) is one of those — the Cloud
// Messaging tab shows "Cloud Messaging API (Legacy): Disabled" and there
// is no server key to use. The v1 API is the only working path.
//
// Auth: OAuth2 access token from a JWT signed RS256 with the Firebase
// service account's private key (Node built-in crypto only — no new
// dependency), exchanged at https://oauth2.googleapis.com/token for the
// https://www.googleapis.com/auth/firebase.messaging scope. The token is
// cached in memory until shortly before expiry; a 401 refreshes once and
// retries once.
//
// Credentials come ONLY from the FCM_SERVICE_ACCOUNT_JSON env var (the
// whole service-account JSON as one string, parsed at use — set it in
// Vercel, Production). Nothing from the service account is hardcoded or
// committed. If the env var is missing or unparseable, sendPush() logs
// once per serverless instance and returns { ok:false, skipped:true }
// without throwing — daily-check / send-now keep working, and nothing
// sensitive is ever logged.
//
// The project id in the v1 URL (job-tracker-cf49e) is public config —
// the same value as in google-services.json — not a secret.
// The app registers its device token as the top-level "pushToken" on the
// user's server record (via /api/user-data); profile.pushEnabled ===
// false opts that user out (absent = enabled). Dedupe (one KV key per
// (user, alert)) lives in api/_store.js — jt:push-sent:<userHash>:<tag>.
// Tags: "new:<circularId>" for a new circular, "exam:<circularId>:<hash12>"
// for an exam/result change.
const crypto = require('crypto');

const FCM_PROJECT_ID = 'job-tracker-cf49e';
const FCM_V1_URL = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_SAFETY_MS = 60 * 1000; // refresh a token expiring within 60s
const FETCH_TIMEOUT_MS = 8000;

// In-memory access-token cache (per serverless instance). Never logged.
let cachedToken = null; // { accessToken, expiresAtMs }
let warnedMissing = false;

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Parse the service account from the env var. Returns null when the env
// var is missing, unparseable, or not a usable service account — never
// throws, never logs the value.
function getServiceAccount() {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    if (!sa || sa.type !== 'service_account' || !sa.client_email || !sa.private_key) return null;
    return sa;
  } catch { return null; }
}

// Log the missing-credentials warning once per instance, so a day of
// cron runs does not spam the logs.
function warnMissingOnce() {
  if (warnedMissing) return;
  warnedMissing = true;
  try { console.warn('[fcm] FCM_SERVICE_ACCOUNT_JSON is missing or invalid — push notifications skipped'); } catch {}
}

// Service-account JWT for the OAuth2 token exchange (Google's
// "service account authorization" flow): header + claims, RS256-signed
// with the account's private key. nowSec is injectable for tests.
function buildJwt(sa, nowSec) {
  const iat = nowSec == null ? Math.floor(Date.now() / 1000) : nowSec;
  const unsigned = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' +
    base64url(JSON.stringify({
      iss: sa.client_email,
      sub: sa.client_email,
      aud: OAUTH_TOKEN_URL,
      scope: OAUTH_SCOPE,
      iat,
      exp: iat + 3600,
    }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  return unsigned + '.' + base64url(signer.sign(sa.private_key));
}

// Exchange the JWT for an OAuth2 access token. Returns
// { accessToken, expiresIn } or null when push is not configured.
// Throws on an HTTP / protocol error (the caller decides whether to
// retry). fetchFn is injectable for tests; defaults to global fetch.
async function fetchAccessToken(fetchFn) {
  const sa = getServiceAccount();
  if (!sa) return null;
  const r = await fetchFn(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: buildJwt(sa),
    }).toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('oauth_' + r.status);
  if (!j || !j.access_token) throw new Error('oauth_no_token');
  return { accessToken: j.access_token, expiresIn: Number(j.expires_in) || 3600 };
}

// Cached access token — reuses the in-memory token while it has more than
// TOKEN_SAFETY_MS of life left. Returns null when push is not configured.
async function getAccessToken(fetchFn) {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs - now > TOKEN_SAFETY_MS) return cachedToken.accessToken;
  const t = await fetchAccessToken(fetchFn);
  if (!t) return null;
  cachedToken = { accessToken: t.accessToken, expiresAtMs: now + t.expiresIn * 1000 };
  return cachedToken.accessToken;
}

// FCM v1 data values must be strings — stringify anything else (a number,
// boolean or null becomes its JSON text; never dropped, never crashes).
function stringifyData(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    out[String(k)] = typeof v === 'string' ? v : JSON.stringify(v == null ? '' : v);
  }
  return out;
}

// Send one push to one Android device via FCM HTTP v1.
// Contract (unchanged from the legacy version): sendPush(token, title,
// body, data) -> { ok:true, messageId } on success,
// { ok:false, skipped:true } when push is not configured or the token is
// missing, { ok:false, error } on failure. Never throws.
// opts.fetchFn is injectable for tests; callers pass only the first four
// arguments.
async function sendPush(token, title, body, data, opts) {
  const fetchFn = (opts && opts.fetchFn) || fetch;
  if (!token || typeof token !== 'string') return { ok: false, skipped: true };
  if (!getServiceAccount()) { warnMissingOnce(); return { ok: false, skipped: true }; }
  const payload = {
    message: {
      token,
      notification: { title: String(title || ''), body: String(body || '') },
      data: stringifyData(data),
    },
  };
  try {
    let accessToken = await getAccessToken(fetchFn);
    if (!accessToken) { warnMissingOnce(); return { ok: false, skipped: true }; }
    const sendOnce = () => fetchFn(FCM_V1_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    let r = await sendOnce();
    if (r.status === 401) {
      // Token expired or revoked — refresh once and retry once.
      cachedToken = null;
      accessToken = await getAccessToken(fetchFn);
      if (!accessToken) { warnMissingOnce(); return { ok: false, skipped: true }; }
      r = await sendOnce();
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { ok: false, error: 'fcm_' + r.status, detail: (j && j.error && j.error.status) || undefined };
    }
    // v1 success: { name: "projects/<id>/messages/<message-id>" }.
    return { ok: true, messageId: (j && j.name) || null };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function resetTokenCache() { cachedToken = null; warnedMissing = false; }

module.exports = {
  sendPush,
  FCM_PROJECT_ID,
  FCM_V1_URL,
  OAUTH_TOKEN_URL,
  OAUTH_SCOPE,
  _test: { buildJwt, getAccessToken, fetchAccessToken, getServiceAccount, stringifyData, resetTokenCache },
};
