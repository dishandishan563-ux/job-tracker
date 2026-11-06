// POST /api/forgot-password — manual-login users who forgot their password.
// Two steps:
//   1. { step: 'request', email } — sends a 6-digit reset code to that Gmail
//      from the official sender (jobtrackerbd@gmail.com via SMTP).
//   2. { step: 'verify', email, code, newPassword } — checks the code; on
//      success the CLIENT sets the new password locally (see below).
//
// IMPORTANT — why the server cannot reset the password itself: manual
// accounts live only in the user's browser (localStorage jt_accounts,
// SHA-256 hash of email:password). The server has no user database, so it
// cannot read or change a stored password — and the OLD password can never
// be sent back, because only its hash exists. The code only proves the
// requester owns the Gmail; the browser then overwrites the local hash
// with the new password. Same-browser limitation: the reset works on the
// browser/device where the account was created.
// Serverless note: codes are kept in /tmp (per-instance on Vercel), like
// the sent-fingerprint file in api/send-now.js. If a verify request lands
// on a different instance the code may not be found — in that case the
// user just requests a new code. A production setup should use Vercel KV.
// Env: GMAIL_USER (default jobtrackerbd@gmail.com), GMAIL_APP_PASSWORD.
const crypto = require('crypto');
const fs = require('fs');
const { sendMail } = require('./_mail');

const STORE_FILE = '/tmp/jt-reset-codes.json';
const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS_PER_HOUR = 3;
const MIN_GAP_MS = 60 * 1000;

function loadStore() { try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch { return {}; } }
function saveStore(s) { try { fs.writeFileSync(STORE_FILE, JSON.stringify(s)); } catch {} }
function codeHash(code) { return crypto.createHash('sha256').update(String(code)).digest('hex'); }
function newCode() { return String(crypto.randomInt(100000, 1000000)); }
function validEmail(e) { return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const body = req.body || {};
  const email = (body.email || '').trim().toLowerCase();

  if (body.step === 'request') {
    if (!validEmail(email)) return res.status(400).json({ ok: false, error: 'সঠিক Gmail ঠিকানা দিন।' });
    const store = loadStore();
    const now = Date.now();
    const entry = store[email] || { requests: [] };
    entry.requests = (entry.requests || []).filter(t => now - t < 60 * 60 * 1000);
    if (entry.requests.length >= MAX_REQUESTS_PER_HOUR) return res.status(429).json({ ok: false, error: 'অনেকবার কোড চাওয়া হয়েছে — ১ ঘণ্টা পর আবার চেষ্টা করুন।' });
    if (entry.requests.length && now - entry.requests[entry.requests.length - 1] < MIN_GAP_MS) return res.status(429).json({ ok: false, error: 'একটু অপেক্ষা করুন — ১ মিনিট পর আবার কোড পাঠানো যাবে।' });
    const code = newCode();
    entry.codeHash = codeHash(code);
    entry.expiresAt = now + CODE_TTL_MS;
    entry.attempts = 0;
    entry.requests.push(now);
    store[email] = entry;
    saveStore(store);
    try {
      await sendMail({
        subject: 'Job Tracker — পাসওয়ার্ড রিসেট কোড',
        text: `আসসালামু আলাইকুম,\n\nJob Tracker-এ আপনার পাসওয়ার্ড রিসেটের কোড: ${code}\n\nএই কোড ১৫ মিনিটের জন্য কার্যকর। কোডটি কাউকে দেবেন না। আপনি রিসেট চাননি হলে এই ইমেইলটি উপেক্ষা করুন — আপনার পুরনো পাসওয়ার্ড বদলাবে না।\n\n— Job Tracker (jobtrackerbd@gmail.com)`,
        to: email,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'ইমেইল পাঠানো যায়নি: ' + e.message });
    }
    return res.status(200).json({ ok: true, note: 'কোড পাঠানো হয়েছে — আপনার Gmail-এর ইনবক্স (প্রয়োজনে স্প্যাম) দেখুন। কোড ১৫ মিনিট কার্যকর থাকবে।' });
  }

  if (body.step === 'verify') {
    if (!validEmail(email)) return res.status(400).json({ ok: false, error: 'সঠিক Gmail ঠিকানা দিন।' });
    const newPassword = String(body.newPassword || '');
    if (newPassword.length < 4) return res.status(400).json({ ok: false, error: 'নতুন পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে।' });
    const store = loadStore();
    const entry = store[email];
    if (!entry || !entry.codeHash) return res.status(400).json({ ok: false, error: 'কোড পাওয়া যায়নি — আবার কোড পাঠান।' });
    if (Date.now() > entry.expiresAt) { delete store[email]; saveStore(store); return res.status(400).json({ ok: false, error: 'কোডের মেয়াদ শেষ — আবার কোড পাঠান।' }); }
    entry.attempts = (entry.attempts || 0) + 1;
    if (entry.attempts > MAX_ATTEMPTS) { delete store[email]; saveStore(store); return res.status(400).json({ ok: false, error: 'অনেকবার ভুল কোড দেওয়া হয়েছে — আবার কোড পাঠান।' }); }
    saveStore(store);
    if (codeHash(String(body.code || '').trim()) !== entry.codeHash) return res.status(400).json({ ok: false, error: 'ভুল কোড — আবার দেখে দিন।' });
    delete store[email];
    saveStore(store);
    // Success: the code is verified. The client now overwrites the local
    // password hash in this browser (jt_accounts). The server never sees
    // the new password and never sends back the old one.
    return res.status(200).json({ ok: true, note: 'কোড মিলেছে — এখন নতুন পাসওয়ার্ড সেট করা যাবে।' });
  }

  return res.status(400).json({ ok: false, error: 'step: request বা verify হতে হবে।' });
};
