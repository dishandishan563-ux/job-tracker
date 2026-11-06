// POST /api/register-recipient — register a signed-in user's Gmail as an email recipient.
// Body: { email } — the client sends the Gmail of the Google account the user signed
// in with. With Vercel KV configured the address is saved in the jt:recipients
// set, so the daily cron (api/daily-check.js) can email every signed-in user.
// Without KV it is only validated (the old behaviour) — set EMAIL_RECIPIENTS
// in Vercel env vars as the fallback.
const { kvAvailable, kvSAdd } = require('./_store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: 'Valid email is required' });
  if (kvAvailable()) {
    try {
      await kvSAdd('jt:recipients', String(email).trim().toLowerCase());
      return res.status(200).json({ email, ok: true, stored: true });
    } catch (e) {
      return res.status(200).json({ email, ok: true, stored: false, note: 'Validated, but could not save to server storage: ' + e.message });
    }
  }
  return res.status(200).json({ email, ok: true, stored: false, note: 'Validated. Wire a database (Vercel KV) to persist recipients, or add the address to EMAIL_RECIPIENTS in Vercel env vars.' });
};
