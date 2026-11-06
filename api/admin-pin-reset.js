// POST /api/admin-pin-reset — owner forgot the admin PIN.
// Two steps:
//   1. { step: 'request' } — sends a 6-digit reset code to the OFFICIAL
//      SENDER Gmail (GMAIL_USER, default jobtrackerbd@gmail.com) — the
//      mailbox only the owner controls. No other user can receive this code,
//      because the destination address is never taken from the request.
//   2. { step: 'verify', code, newPin } — checks the code; on success the
//      CLIENT sets the new PIN locally (SHA-256 hash only, stored in
//      localStorage jt_admin_pin_hash, exactly like the normal PIN change).
//      The plain PIN is never sent to the server and never stored in code.
//      If ADMIN_PIN_HASH is set in Vercel, the owner must also update that
//      env var to the new PIN's hash (the admin page shows it after reset).
// Serverless note: codes are kept in /tmp (per-instance on Vercel), like
// the sent-fingerprint file in api/send-now.js. If a verify request lands
// on a different instance the code may not be found — just request a new
// code. A production setup should use Vercel KV.
// Env: GMAIL_USER (default jobtrackerbd@gmail.com), GMAIL_APP_PASSWORD.
const crypto = require('crypto');
const fs = require('fs');
const { sendMail } = require('./_mail');

const STORE_FILE = '/tmp/jt-admin-reset.json';
const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS_PER_HOUR = 3;
const MIN_GAP_MS = 60 * 1000;

function loadStore() { try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch { return {}; } }
function saveStore(s) { try { fs.writeFileSync(STORE_FILE, JSON.stringify(s)); } catch {} }
function codeHash(code) { return crypto.createHash('sha256').update(String(code)).digest('hex'); }
function newCode() { return String(crypto.randomInt(100000, 1000000)); }

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const body = req.body || {};
  const ownerEmail = process.env.GMAIL_USER || 'jobtrackerbd@gmail.com';

  if (body.step === 'request') {
    const store = loadStore();
    const now = Date.now();
    const entry = store.admin || { requests: [] };
    entry.requests = (entry.requests || []).filter(t => now - t < 60 * 60 * 1000);
    if (entry.requests.length >= MAX_REQUESTS_PER_HOUR) return res.status(429).json({ ok: false, error: 'অনেকবার কোড চাওয়া হয়েছে — ১ ঘণ্টা পর আবার চেষ্টা করুন।' });
    if (entry.requests.length && now - entry.requests[entry.requests.length - 1] < MIN_GAP_MS) return res.status(429).json({ ok: false, error: 'একটু অপেক্ষা করুন — ১ মিনিট পর আবার কোড পাঠানো যাবে।' });
    const code = newCode();
    entry.codeHash = codeHash(code);
    entry.expiresAt = now + CODE_TTL_MS;
    entry.attempts = 0;
    entry.requests.push(now);
    store.admin = entry;
    saveStore(store);
    try {
      await sendMail({
        subject: 'Job Tracker — অ্যাডমিন PIN রিসেট কোড',
        text: `আসসালামু আলাইকুম,\n\nJob Tracker-এর অ্যাডমিন PIN রিসেটের কোড: ${code}\n\nএই কোড ১৫ মিনিটের জন্য কার্যকর। কোডটি কাউকে দেবেন না। আপনি রিসেট চাননি হলে এই ইমেইলটি উপেক্ষা করুন — আপনার PIN বদলাবে না।\n\n— Job Tracker`,
        to: ownerEmail,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'ইমেইল পাঠানো যায়নি: ' + e.message });
    }
    return res.status(200).json({ ok: true, note: 'কোড পাঠানো হয়েছে — অফিসিয়াল সেন্ডার Gmail-এর ইনবক্স দেখুন। কোড ১৫ মিনিট কার্যকর থাকবে।' });
  }

  if (body.step === 'verify') {
    const newPin = String(body.newPin || '');
    if (newPin.length < 4) return res.status(400).json({ ok: false, error: 'নতুন PIN কমপক্ষে ৪ অঙ্কের হতে হবে।' });
    const store = loadStore();
    const entry = store.admin;
    if (!entry || !entry.codeHash) return res.status(400).json({ ok: false, error: 'কোড পাওয়া যায়নি — আবার কোড পাঠান।' });
    if (Date.now() > entry.expiresAt) { delete store.admin; saveStore(store); return res.status(400).json({ ok: false, error: 'কোডের মেয়াদ শেষ — আবার কোড পাঠান।' }); }
    entry.attempts = (entry.attempts || 0) + 1;
    if (entry.attempts > MAX_ATTEMPTS) { delete store.admin; saveStore(store); return res.status(400).json({ ok: false, error: 'অনেকবার ভুল কোড দেওয়া হয়েছে — আবার কোড পাঠান।' }); }
    saveStore(store);
    if (codeHash(String(body.code || '').trim()) !== entry.codeHash) return res.status(400).json({ ok: false, error: 'ভুল কোড — আবার দেখে দিন।' });
    delete store.admin;
    saveStore(store);
    // Success: the code is verified. The client now stores the new PIN's
    // SHA-256 hash locally. The server never sees the new PIN.
    return res.status(200).json({ ok: true, note: 'কোড মিলেছে — এখন নতুন PIN সেট করা যাবে।' });
  }

  return res.status(400).json({ ok: false, error: 'step: request বা verify হতে হবে।' });
};
