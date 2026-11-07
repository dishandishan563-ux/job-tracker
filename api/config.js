// GET /api/config — public client config.
//   { googleClientId, contact, reminderOptions }
// - googleClientId: Google OAuth client ID only, never the secret.
// - contact: the admin-set WhatsApp / Telegram links (KV jt:contact), shown
//   to every visitor in the menu as "আবেদন করতে চাইলে যোগাযোগ করুন".
//   Empty when the admin has set nothing — then the menu entry stays hidden.
// - reminderOptions: the circular-type + qualification options for the
//   reminder-preference section in Settings (single source of truth; the
//   client falls back to a built-in copy if this fetch fails).
//
// POST /api/config — admin only: { pinHash, contact: { whatsapp, telegram } }.
// PIN-gated exactly like /api/send-now (ADMIN_PIN_HASH when set in Vercel;
// otherwise the admin panel's PIN gate is the only protection). The saved
// contact is PUBLIC — it is shown to every visitor — so only the two link
// fields are ever stored or returned; no PIN or secret ever passes through.
const { kvAvailable, getContact, saveContact } = require('./_store');
const { TYPE_OPTIONS, QUAL_OPTIONS } = require('./_prefs');

function normWhatsApp(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (/^wa\.me\//i.test(v)) return 'https://' + v;
  const digits = v.replace(/\D/g, '');
  if (digits.length >= 10) return 'https://wa.me/' + digits;
  return '';
}

function normTelegram(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (/^t\.me\//i.test(v)) return 'https://' + v;
  if (v.startsWith('@')) return 'https://t.me/' + v.slice(1);
  if (/^[A-Za-z0-9_]{5,}$/.test(v)) return 'https://t.me/' + v;
  return '';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    let contact = { whatsapp: '', telegram: '' };
    try { contact = await getContact(); } catch {}
    return res.status(200).json({
      googleClientId: process.env.GOOGLE_CLIENT_ID || '',
      contact,
      reminderOptions: { types: TYPE_OPTIONS, quals: QUAL_OPTIONS },
    });
  }
  if (req.method === 'POST') {
    try {
      const { pinHash, contact } = req.body || {};
      if (process.env.ADMIN_PIN_HASH && pinHash !== process.env.ADMIN_PIN_HASH) {
        return res.status(401).json({ ok: false, error: 'ভুল PIN।' });
      }
      if (!contact || typeof contact !== 'object') {
        return res.status(400).json({ ok: false, error: 'contact দিতে হবে।' });
      }
      if (!kvAvailable()) {
        return res.status(503).json({ ok: false, error: 'Server storage (Vercel KV) is not configured yet.' });
      }
      const clean = { whatsapp: normWhatsApp(contact.whatsapp), telegram: normTelegram(contact.telegram) };
      await saveContact(clean);
      return res.status(200).json({ ok: true, contact: clean });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
