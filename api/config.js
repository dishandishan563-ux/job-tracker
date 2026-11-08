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
// POST /api/config — admin only. Two kinds of writes, same PIN gate:
// 1) { pinHash, contact: { whatsapp, telegram } } — saves the contact links.
// 2) { pinHash, action: 'add' | 'update' | 'delete' | 'sync-seed', ... } —
//    server-side circulars writes (KV jt:circulars), so every user sees the
//    change. Before this, admin add/delete only wrote to the admin's own
//    browser localStorage (jt_admin_circulars / jt_deleted_circulars) —
//    other users never saw them. The client keeps localStorage only as a
//    fallback when the server call fails.
// PIN gate: exactly like /api/send-now — ADMIN_PIN_HASH when set in Vercel
// must match (the SHA-256 of the PIN, computed in the browser; the plain
// PIN is never sent). If it is not set, the admin panel's PIN gate is the
// only protection. The saved contact is PUBLIC — it is shown to every
// visitor — so only the two link fields are ever stored or returned; no PIN
// or secret ever passes through.
//
// Circular actions:
// - add:    { circular } — validates org + applyUrl + deadline, generates
//           the id server-side (custom-...), stores it in KV. Everyone sees
//           it on the next list load.
// - update: { id, circular } — replaces the entry with that id (used to
//           correct a wrong entry). Keeps the old addedAt / autoAdded /
//           sourceNote when present.
// - delete: { id } — removes the entry from KV for everyone, and records
//           its identity keys in jt:deleted-circulars so the auto-discovery
//           sweep does not silently re-add a Teletalk circular.
// - sync-seed: no extra fields — one-shot migration: merges the current
//           data/circulars.json into the live KV list (adds entries that
//           are missing, e.g. BSCS / BPSC / NIPORT) and REPLACES the entries
//           in REPLACE_IDS with the seed version (DMP: the live entry is
//           wrong — 10 posts — the seed has the corrected 20-post version).
//           Skips anything already present and anything the admin deleted.
const { kvAvailable, getContact, saveContact, getCirculars, saveCirculars, allKeys, dedupeKey, getDeletedKeys, addDeletedKeys } = require('./_store');
const { TYPE_OPTIONS, QUAL_OPTIONS } = require('./_prefs');
const seedCirculars = require('../data/circulars.json');

// Seed ids whose live entry is REPLACED (not skipped) by sync-seed — the
// seed file is the curated source of truth for these. Add an id here only
// when the seed entry was corrected and the live copy is known wrong.
const REPLACE_IDS = ['dmp'];

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

// Validate + clean one circular from the admin form. Only allowlisted
// fields are kept — nothing else from the request is ever stored.
function cleanCircular(input) {
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const org = String((input && input.org) || '').trim();
  if (!org) return { ok: false, error: 'প্রতিষ্ঠানের নাম দিন।' };
  const applyUrl = String((input && input.applyUrl) || '').trim();
  if (!/^https?:\/\//i.test(applyUrl)) return { ok: false, error: 'সঠিক আবেদনের লিংক দিন (https://…)।' };
  const dl = new Date((input && input.deadline) || '');
  if (isNaN(dl)) return { ok: false, error: 'সঠিক শেষ তারিখ দিন।' };
  const posts = Array.isArray(input.posts) ? input.posts
    .filter(p => p && String(p.title || '').trim())
    .map(p => ({
      title: String(p.title).trim().slice(0, 120),
      count: num(p.count),
      grade: num(p.grade),
      qualification: String(p.qualification || '').trim().slice(0, 40) || null,
      typingBn: num(p.typingBn) || 0,
      typingEn: num(p.typingEn) || 0,
      ...(p.note ? { note: String(p.note).slice(0, 200) } : {}),
    })).slice(0, 30) : [];
  return {
    ok: true,
    circular: {
      org: org.slice(0, 200),
      orgEn: String(input.orgEn || '').trim().slice(0, 200) || org,
      type: String(input.type || 'ministry').trim().slice(0, 40) || 'ministry',
      typeBn: String(input.typeBn || '').trim().slice(0, 60) || 'মন্ত্রণালয় / অধিদপ্তর',
      totalPosts: num(input.totalPosts),
      hscPosts: num(input.hscPosts),
      grade: num(input.grade),
      fee: num(input.fee),
      deadline: dl.toISOString(),
      salary: String(input.salary || '').trim().slice(0, 120),
      age: String(input.age || '').trim().slice(0, 120),
      districts: String(input.districts || '').trim().slice(0, 200),
      applyUrl,
      source: 'secondary',
      sourceNote: 'অ্যাডমিন যোগ করেছেন — অফিসিয়াল সার্কুলার যাচাই করুন।',
      posts,
    },
  };
}

async function handleCircularAction(action, body) {
  const list = await getCirculars();
  if (!Array.isArray(list)) return { status: 503, body: { ok: false, error: 'Server storage (Vercel KV) is not configured yet.' } };

  if (action === 'add') {
    const cleaned = cleanCircular(body.circular);
    if (!cleaned.ok) return { status: 400, body: { ok: false, error: cleaned.error } };
    const c = cleaned.circular;
    c.id = 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    c.addedAt = new Date().toISOString();
    list.push(c);
    await saveCirculars(list);
    return { status: 200, body: { ok: true, id: c.id, count: list.length } };
  }

  if (action === 'update') {
    const id = String(body.id || '').trim();
    if (!id) return { status: 400, body: { ok: false, error: 'কোন সার্কুলার ঠিক করবেন, id দিন।' } };
    const idx = list.findIndex(c => c.id === id);
    if (idx < 0) return { status: 404, body: { ok: false, error: 'সার্কুলারটি পাওয়া যায়নি।' } };
    const cleaned = cleanCircular(body.circular);
    if (!cleaned.ok) return { status: 400, body: { ok: false, error: cleaned.error } };
    const old = list[idx];
    const c = cleaned.circular;
    c.id = old.id;
    c.addedAt = old.addedAt || new Date().toISOString();
    if (old.autoAdded) c.autoAdded = true;
    if (old.sourceNote) c.sourceNote = old.sourceNote;
    list[idx] = c;
    await saveCirculars(list);
    return { status: 200, body: { ok: true, id: c.id, count: list.length } };
  }

  if (action === 'delete') {
    const id = String(body.id || '').trim();
    if (!id) return { status: 400, body: { ok: false, error: 'কোন সার্কুলার মুছবেন, id দিন।' } };
    const idx = list.findIndex(c => c.id === id);
    if (idx < 0) return { status: 404, body: { ok: false, error: 'সার্কুলারটি পাওয়া যায়নি।' } };
    const removed = list[idx];
    list.splice(idx, 1);
    // মুছে ফেলা সার্কুলার যেন অটো-ডিসকভারি আবার না যোগ করে — তার চাবিগুলো সেভ রাখি।
    try { await addDeletedKeys(allKeys(removed)); } catch {}
    await saveCirculars(list);
    return { status: 200, body: { ok: true, id, count: list.length } };
  }

  if (action === 'sync-seed') {
    const deleted = new Set(await getDeletedKeys());
    const seen = new Set();
    for (const c of list) for (const k of allKeys(c)) seen.add(k);
    let added = 0, replaced = 0, skipped = 0;
    const addedIds = [], replacedIds = [];
    for (const s of seedCirculars) {
      const keys = allKeys(s);
      if (keys.some(k => deleted.has(k))) { skipped++; continue; }
      if (REPLACE_IDS.includes(s.id)) {
        // DMP: একই id বা একই host+তারিখের লাইভ এন্ট্রি থাকলে সিড দিয়ে বদলাও —
        // শুধু দেখে এড়িয়ে গেলে ভুল এন্ট্রিটাই থেকে যাবে।
        let idx = list.findIndex(c => c.id === s.id);
        if (idx < 0) idx = list.findIndex(c => dedupeKey(c) === dedupeKey(s));
        if (idx >= 0) {
          const old = list[idx];
          list[idx] = { ...s, addedAt: old.addedAt || s.addedAt || new Date().toISOString() };
          replaced++; replacedIds.push(s.id);
          continue;
        }
      }
      if (keys.some(k => seen.has(k))) { skipped++; continue; }
      list.push({ ...s });
      keys.forEach(k => seen.add(k));
      added++; addedIds.push(s.id);
    }
    if (added || replaced) await saveCirculars(list);
    return { status: 200, body: { ok: true, added, replaced, skipped, count: list.length, addedIds, replacedIds } };
  }

  return { status: 400, body: { ok: false, error: 'অজানা action।' } };
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
      const { pinHash, contact, action } = req.body || {};
      if (process.env.ADMIN_PIN_HASH && pinHash !== process.env.ADMIN_PIN_HASH) {
        return res.status(401).json({ ok: false, error: 'ভুল PIN।' });
      }
      if (!kvAvailable()) {
        return res.status(503).json({ ok: false, error: 'Server storage (Vercel KV) is not configured yet.' });
      }
      if (action) {
        const r = await handleCircularAction(action, req.body || {});
        return res.status(r.status).json(r.body);
      }
      if (!contact || typeof contact !== 'object') {
        return res.status(400).json({ ok: false, error: 'contact দিতে হবে।' });
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
