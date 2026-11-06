// POST /api/auth-manual — server-backed manual (Gmail + password) accounts.
//
// Manual accounts used to live only in the browser's localStorage
// (jt_accounts), so a user who registered on one phone could not log in on
// another — and a forgotten-password reset only worked on the browser where
// the account was created. With Vercel KV configured, the account record
// (name + password hash) is stored on the server instead, so the same Gmail
// + password logs in from any device and the saved data follows.
//
// Body: { email, name?, hash } — hash = SHA-256 of "email:password",
// computed in the browser. The plain password NEVER reaches the server.
//   - No account yet for this Gmail: one is created (same as the old
//     local behaviour — first login registers the account).
//   - Account exists and the hash matches: login succeeds.
//   - Account exists and the hash differs: 401 'wrong_password'.
// On success the response carries a session token (see api/_session.js)
// that the client uses for /api/user-data.
//
// When Vercel KV is not configured this endpoint answers
// { ok: false, reason: 'kv_not_configured' } and the client falls back to
// the old local-only accounts — nothing breaks.
const { keyFor, kvAvailable, kvGet, kvSet } = require('./_store');
const { mint } = require('./_session');

function validEmail(e) { return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const body = req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  const hash = String(body.hash || '');
  if (!validEmail(email)) return res.status(400).json({ ok: false, error: 'সঠিক Gmail ঠিকানা দিন।' });
  if (!/^[0-9a-f]{64}$/.test(hash)) return res.status(400).json({ ok: false, error: 'Invalid credentials.' });
  if (!kvAvailable()) {
    return res.status(503).json({ ok: false, reason: 'kv_not_configured', stored: false, error: 'Server storage (Vercel KV) is not configured yet — accounts stay in this browser only.' });
  }
  try {
    const key = keyFor('jt:account', email);
    const acc = await kvGet(key);
    if (acc) {
      if (acc.hash !== hash) return res.status(401).json({ ok: false, error: 'wrong_password' });
      return res.status(200).json({ created: false, email, name: acc.name || body.name || '', ok: true, token: mint(email) });
    }
    const name = String(body.name || '').trim();
    await kvSet(key, { hash, name });
    return res.status(200).json({ created: true, email, name, ok: true, token: mint(email) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Could not reach server storage: ' + e.message });
  }
};
