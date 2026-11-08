// Reminder preferences — which circulars a user wants email reminders for.
//
// A user picks, in Settings, (a) circular types and (b) qualification /
// post kinds. The choices are stored per user in KV alongside their profile
// (profile.reminders = { types: [...], quals: [...] }) and are honoured by
// /api/daily-check and /api/send-now when sending reminders.
//
// Rules:
// - Nothing chosen (or no prefs saved at all) means "send everything" —
//   nobody loses mail by not setting preferences.
// - A circular matches a type when its type key is selected; 'govt'
//   (সরকারি) matches every government-type circular.
// - A circular matches a qualification when any of its posts has that
//   qualification (or its hscPosts > 0 for HSC).
// - Auto-added Teletalk entries carry no qualification data (posts: []),
//   so they can only match the TYPE filter, never a qualification filter —
//   their qualification is never guessed.
// - If prefs fail to load, callers must fall back to sending all — a prefs
//   error must never silently drop a reminder.
const { keyFor, kvAvailable, kvGet } = require('./_store');

// The 13 circular categories (same list the filter UI uses).
const TYPE_OPTIONS = [
  { key: 'govt', label: 'সরকারি' },
  { key: 'ministry', label: 'মন্ত্রণালয় / অধিদপ্তর' },
  { key: 'bank', label: 'ব্যাংক' },
  { key: 'police', label: 'পুলিশ / সেনা / প্রতিরক্ষা' },
  { key: 'teacher', label: 'শিক্ষক / শিক্ষা' },
  { key: 'health', label: 'স্বাস্থ্য' },
  { key: 'railway', label: 'রেলওয়ে' },
  { key: 'district', label: 'জেলা প্রশাসন' },
  { key: 'tax', label: 'কর / রাজস্ব / অডিট' },
  { key: 'court', label: 'আদালত' },
  { key: 'private', label: 'বেসরকারি' },
  { key: 'ngo', label: 'এনজিও' },
  { key: 'other', label: 'অন্যান্য' },
];
// Government-type circular keys — 'govt' matches all of these.
const GOVT_TYPES = ['ministry', 'bank', 'police', 'teacher', 'health', 'railway', 'district', 'tax', 'court', 'port'];
const KNOWN_TYPES = [...GOVT_TYPES, 'private', 'ngo'];

const QUAL_OPTIONS = [
  { key: 'HSC', label: 'HSC' },
  { key: 'SSC', label: 'SSC' },
  { key: 'GRAD', label: 'স্নাতক' },
  { key: 'COMPUTER_TYPIST', label: 'কম্পিউটার টাইপিস্ট' },
  { key: 'COMPUTER_OPERATOR', label: 'কম্পিউটার অপারেটর' },
];

const TYPE_KEYS = TYPE_OPTIONS.map(o => o.key);
const QUAL_KEYS = QUAL_OPTIONS.map(o => o.key);

// Keep only known keys — junk from the client is dropped, never stored.
function sanitizePrefs(p) {
  const out = { types: [], quals: [] };
  if (p && typeof p === 'object') {
    if (Array.isArray(p.types)) out.types = [...new Set(p.types.filter(x => TYPE_KEYS.includes(x)))].slice(0, 13);
    if (Array.isArray(p.quals)) out.quals = [...new Set(p.quals.filter(x => QUAL_KEYS.includes(x)))].slice(0, 10);
  }
  return out;
}

function matchesType(c, selected) {
  if (!selected || !selected.length) return true;
  const t = String((c && c.type) || '').toLowerCase();
  for (const k of selected) {
    if (k === 'govt' && (GOVT_TYPES.includes(t) || t === 'govt')) return true;
    if (k === 'other' && (t === 'other' || !KNOWN_TYPES.includes(t))) return true;
    if (k === t) return true;
  }
  return false;
}

function matchesQual(c, selected) {
  if (!selected || !selected.length) return true;
  const posts = Array.isArray(c && c.posts) ? c.posts : [];
  // No post/qualification data (e.g. auto-added Teletalk entries) — never
  // guess a qualification, so a qualification filter never matches these.
  if (!posts.length) return false;
  return selected.some(k => {
    if (k === 'HSC') {
      return ((c && c.hscPosts) || 0) > 0 || posts.some(p => String(p.qualification || '').toUpperCase().startsWith('HSC'));
    }
    if (k === 'SSC') return posts.some(p => String(p.qualification || '').toUpperCase().startsWith('SSC'));
    if (k === 'GRAD') return posts.some(p => String(p.qualification || '').includes('স্নাতক'));
    if (k === 'COMPUTER_TYPIST') {
      return posts.some(p => { const t = String(p.title || ''); return t.includes('কম্পিউটার') && (t.includes('টাইপিস্ট') || t.includes('মুদ্রাক্ষরিক')); });
    }
    if (k === 'COMPUTER_OPERATOR') {
      return posts.some(p => { const t = String(p.title || ''); return t.includes('কম্পিউটার') && t.includes('অপারেটর'); });
    }
    return false;
  });
}

// prefs: { types, quals } or null. null / empty = send everything.
function circularMatchesPrefs(c, prefs) {
  if (!prefs) return true;
  const types = Array.isArray(prefs.types) ? prefs.types : [];
  const quals = Array.isArray(prefs.quals) ? prefs.quals : [];
  if (!types.length && !quals.length) return true;
  return matchesType(c, types) && matchesQual(c, quals);
}

// Load one user's saved reminder prefs from their KV user record
// (jt:user:<sha256(email)> — same record /api/user-data keeps).
// Returns sanitized prefs, or null when the user never set any (send all).
// Never throws: on any error callers treat the result as "no prefs".
async function getUserPrefs(email) {
  if (!kvAvailable()) return null;
  try {
    const rec = await kvGet(keyFor('jt:user', email));
    const rem = rec && rec.data && rec.data.profile && rec.data.profile.reminders;
    if (!rem) return null;
    const p = sanitizePrefs(rem);
    if (!p.types.length && !p.quals.length) return null;
    return p;
  } catch { return null; }
}

// Master reminder on/off for one user (profile.remindersEnabled).
// Returns false ONLY when the user explicitly saved "না" — missing,
// true, or any load error means reminders stay ON, so existing
// recipients never lose mail by not touching the toggle.
async function remindersEnabled(email) {
  if (!kvAvailable()) return true;
  try {
    const rec = await kvGet(keyFor('jt:user', email));
    const v = rec && rec.data && rec.data.profile && rec.data.profile.remindersEnabled;
    return v !== false;
  } catch { return true; }
}

module.exports = { TYPE_OPTIONS, QUAL_OPTIONS, GOVT_TYPES, TYPE_KEYS, QUAL_KEYS, sanitizePrefs, matchesType, matchesQual, circularMatchesPrefs, getUserPrefs, remindersEnabled };
