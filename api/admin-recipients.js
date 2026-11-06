// POST /api/admin-recipients — admin portal only: list the registered email
// recipients (every Gmail that signed in) so the owner can SEE who will get
// the reminder emails, not just send to them invisibly.
// Body: { pinHash } — the SHA-256 of the admin PIN, computed in the browser
// (the plain PIN is never sent). If ADMIN_PIN_HASH is set in Vercel, it must
// match; if it is not set, the admin panel's PIN gate is the only protection
// (same rule as /api/send-now). Returns { ok:true, recipients:[...], count }.
// Recipients merge EMAIL_RECIPIENTS env var + KV jt:recipients set (same
// pattern as /api/daily-check). Never returns any password or secret.
const { kvAvailable, kvSMembers } = require('./_store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const { pinHash } = req.body || {};
    if (process.env.ADMIN_PIN_HASH && pinHash !== process.env.ADMIN_PIN_HASH) {
      return res.status(401).json({ ok: false, error: 'ভুল PIN।' });
    }
    const recipients = [...new Set([
      ...(process.env.EMAIL_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean),
      ...(kvAvailable() ? await kvSMembers('jt:recipients').catch(() => []) : []),
    ].map(s => String(s).trim().toLowerCase()).filter(Boolean))].sort();
    return res.status(200).json({ ok: true, recipients, count: recipients.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
