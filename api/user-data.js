// POST /api/user-data — durable per-user data for the Job Tracker.
//
// This is what makes a login "stick": once a user logs in with a Gmail, their
// profile, shortlist, application status and settings are saved on the server
// (Vercel KV) under that Gmail, and loaded back the next time they log in —
// on any device or browser. The client keeps localStorage as a fast local
// cache, but the server copy is the truth shared across devices.
//
// Auth: the caller proves the Gmail with the session token minted by
// /api/auth-google or /api/auth-manual (Authorization: Bearer <token>, or
// { token } in the body). The token's email is the only account the caller
// can read or write — nobody can fetch or overwrite another user's data.
//
// Body:
//   { action: 'load' }  -> { ok, exists, data|null }
//   { action: 'save', data: { profile, shortlist, status, fontSize } }
//                        -> { ok, stored: true, updatedAt }
// When Vercel KV is not configured, both actions answer
// { ok: false, stored: false, reason: 'kv_not_configured' } (HTTP 503) and
// the client falls back to localStorage only — nothing breaks, but data does
// not travel across devices until KV is enabled (see README).
//
// Data shape (whatever the client sends is stored as-is, so new profile
// fields added later are carried automatically):
//   profile:  { district, dob, edu, typeBn, typeEn, name, address, photo, ... }
//   shortlist: [circularId, ...]
//   status:   { circularId: 'applied', ... }
//   fontSize: 'small' | 'medium' | 'large' | 'xl'
// A profile photo stored as a data URL is capped at ~200 KB — bigger photos
// stay in the browser only, so one huge image cannot blow the KV value limit.
const { keyFor, kvAvailable, kvGet, kvSet, kvSAdd } = require('./_store');
const { sanitizePrefs } = require('./_prefs');
const { verify } = require('./_session');

const MAX_PHOTO_CHARS = 200000;

function validEmail(e) { return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

function sanitizeData(data) {
  const out = {};
  if (data && typeof data === 'object') {
    if (data.profile && typeof data.profile === 'object') {
      out.profile = { ...data.profile };
      // রিমাইন্ডার পছন্দ — শুধু চেনা অপশনের কীগুলোই সেভ হবে (জাঙ্ক বাদ)।
      if (data.profile.reminders !== undefined) out.profile.reminders = sanitizePrefs(data.profile.reminders);
      // রিমাইন্ডার চালু/বন্ধ (হ্যাঁ/না) — শুধু স্পষ্ট false-ই বন্ধ; বাকি সব হ্যাঁ।
      if (data.profile.remindersEnabled !== undefined) out.profile.remindersEnabled = data.profile.remindersEnabled === false ? false : true;
      // ছবি data URL হলে খুব বড় হতে পারে — ২০০ KB-এর বেশি হলে সার্ভারে
      // পাঠানো হবে না, ব্রাউজারের কপিতেই থাকবে।
      if (typeof out.profile.photo === 'string' && out.profile.photo.length > MAX_PHOTO_CHARS) delete out.profile.photo;
      if (typeof out.profile.photoUrl === 'string' && out.profile.photoUrl.length > MAX_PHOTO_CHARS) delete out.profile.photoUrl;
    }
    if (Array.isArray(data.shortlist)) out.shortlist = data.shortlist.filter(x => typeof x === 'string').slice(0, 500);
    if (data.status && typeof data.status === 'object') {
      out.status = {};
      for (const [k, v] of Object.entries(data.status).slice(0, 500)) if (typeof k === 'string' && typeof v === 'string') out.status[k] = v;
    }
    if (typeof data.fontSize === 'string') out.fontSize = data.fontSize;
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.body && req.body.token) || '';
  const email = verify(token);
  if (!email) return res.status(401).json({ ok: false, error: 'Not signed in — log in again.' });
  if (!kvAvailable()) {
    return res.status(503).json({ ok: false, reason: 'kv_not_configured', stored: false, error: 'Server storage (Vercel KV) is not configured yet — data is saved in this browser only. Enable KV in Vercel (README দেখুন).' });
  }
  const body = req.body || {};
  try {
    if (body.action === 'load') {
      const rec = await kvGet(keyFor('jt:user', email));
      if (!rec) return res.status(200).json({ data: null, exists: false, ok: true });
      return res.status(200).json({ data: rec.data || null, exists: true, ok: true, updatedAt: rec.updatedAt || null });
    }
    if (body.action === 'save') {
      const data = sanitizeData(body.data || {});
      const rec = { data, email, updatedAt: new Date().toISOString() };
      await kvSet(keyFor('jt:user', email), rec);
      // রিমাইন্ডার ইমেইলের প্রাপক হিসেবেও নথিভুক্ত করুন।
      try { await kvSAdd('jt:recipients', email); } catch {}
      return res.status(200).json({ ok: true, stored: true, updatedAt: rec.updatedAt });
    }
    return res.status(400).json({ ok: false, error: "action: 'load' বা 'save' হতে হবে।" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Could not reach server storage: ' + e.message });
  }
};
