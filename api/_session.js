// HMAC session tokens for the Job Tracker API.
//
// After a login is verified (Google OAuth in api/auth-google, or the manual
// password hash in api/auth-manual), the server mints a token that proves
// "this browser is logged in as this Gmail" for later calls such as
// /api/user-data. The token is NOT a Google token and grants nothing else:
// it only lets the holder read/write that one Gmail's own saved data.
//
// Format: base64url(email) + '.' + expiryMs + '.' + hex(HMAC-SHA256(secret,
// base64url(email) + '.' + expiryMs)). Tokens last 30 days; after that the
// user just logs in again and gets a fresh one.
//
// Secret: SESSION_SECRET env var when set; otherwise GOOGLE_CLIENT_SECRET
// (a server-only secret — never sent to the browser). Set SESSION_SECRET in
// Vercel for a stable key that survives OAuth secret rotation.
const crypto = require('crypto');

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function secret() {
  return process.env.SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
}

function mint(email) {
  const e = String(email).trim().toLowerCase();
  const payload = Buffer.from(e, 'utf8').toString('base64url') + '.' + String(Date.now() + TOKEN_TTL_MS);
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  return payload + '.' + sig;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [emailB64, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!exp || exp < Date.now()) return null;
  const payload = emailB64 + '.' + expStr;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const email = Buffer.from(emailB64, 'base64url').toString('utf8').toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  } catch { return null; }
}

module.exports = { mint, verify };
