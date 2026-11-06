// POST /api/register-recipient — register a signed-in user's Gmail as an email recipient.
// Body: { email } — the client sends the Gmail of the Google account the user signed
// in with. NOTE: serverless functions are stateless; this endpoint validates and
// returns the address, and the production store (Vercel KV / Postgres) should
// persist it. Until a database is wired up, set EMAIL_RECIPIENTS in Vercel env vars.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: 'Valid email is required' });
  return res.status(200).json({ email, ok: true, stored: false, note: 'Validated. Wire a database (Vercel KV / Postgres) to persist recipients, or add the address to EMAIL_RECIPIENTS in Vercel env vars.' });
};
