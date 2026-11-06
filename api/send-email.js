// POST /api/send-email — send one reminder email from the official sender Gmail.
// Body: { to, subject, text, html? }  Requires the caller to be logged in (client sends
// the Google ID token; this endpoint verifies it) OR the admin PIN for admin sends.
// For the Vercel Cron path, /api/daily-check calls the mail helper directly.
const { sendMail } = require('./_mail');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const { to, subject, text, html } = req.body || {};
    if (!to || !subject || !text) return res.status(400).json({ ok: false, error: 'to, subject and text are required' });
    const messageId = await sendMail({ html, subject, text, to });
    return res.status(200).json({ ok: true, messageId });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
