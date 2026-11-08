// POST /api/send-now — admin manual send: "এখনই ইমেইল পাঠান" (admin portal only).
// Sends the current deadline reminders (0–3 days left) to the registered recipients
// right now, using the same fingerprint dedupe as /api/daily-check, so an email
// already sent by the daily cron is never sent twice. Automatic email is untouched
// — it still runs every morning at 08:00 Dhaka via the cron.
// Body: { pinHash } — the SHA-256 of the admin PIN, computed in the browser (the
// plain PIN is never sent). If ADMIN_PIN_HASH is set in Vercel, it must match;
// if it is not set, the admin panel's PIN gate is the only protection (see README).
const fs = require('fs');
const { sendMail } = require('./_mail');
const { kvAvailable, kvSMembers, logSentEmail, getCirculars } = require('./_store');
const { getUserPrefs, circularMatchesPrefs, remindersEnabled } = require('./_prefs');
const seedCirculars = require('../data/circulars.json');

const SENT_FILE = '/tmp/job-tracker-sent.json';
function loadSent() { try { return JSON.parse(fs.readFileSync(SENT_FILE, 'utf8')); } catch { return {}; } }
function saveSent(s) { try { fs.writeFileSync(SENT_FILE, JSON.stringify(s)); } catch {} }

function bn(n) { return String(n).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[+d]); }

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const { pinHash } = req.body || {};
    if (process.env.ADMIN_PIN_HASH && pinHash !== process.env.ADMIN_PIN_HASH) {
      return res.status(401).json({ ok: false, error: 'ভুল PIN।' });
    }
    // প্রাপক: EMAIL_RECIPIENTS + সার্ভারে সেভ থাকা লগইন করা ব্যবহারকারীরা (KV)।
    // আগে শুধু EMAIL_RECIPIENTS দেখা হতো, তাই লগইন করা ব্যবহারকারী থাকলেও
    // "কোনো প্রাপক নথিভুক্ত নেই" দেখাত — এটাই ছিল বাগ।
    const recipients = [...new Set([
      ...(process.env.EMAIL_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean),
      ...(kvAvailable() ? await kvSMembers('jt:recipients').catch(() => []) : []),
    ].map(s => String(s).trim().toLowerCase()).filter(Boolean))];
    if (!recipients.length) return res.status(200).json({ ok: true, sent: 0, note: 'কোনো প্রাপক নথিভুক্ত নেই (EMAIL_RECIPIENTS খালি)।' });
    // রিমাইন্ডার KV তালিকা (অটো যোগ হওয়া সার্কুলারসহ) থেকে চলে; KV না
    // থাকলে সিড করা JSON ফাইল থেকে।
    let circulars = null;
    try { circulars = await getCirculars(); } catch {}
    if (!Array.isArray(circulars) || !circulars.length) circulars = seedCirculars;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const sent = loadSent();
    // প্রতিটি প্রাপকের রিমাইন্ডার পছন্দ — পছন্দ না থাকলে বা লোড না হলে সব
    // রিমাইন্ডার যাবে (পছন্দের ভুলে কখনো মেইল বাদ পড়বে না)।
    // মাস্টার সুইচ: যিনি প্রোফাইলে "না" সেভ করেছেন, তাঁকে কিছুই যাবে না।
    const prefsByEmail = new Map();
    const enabledByEmail = new Map();
    for (const to of recipients) {
      try { prefsByEmail.set(to, await getUserPrefs(to)); } catch { prefsByEmail.set(to, null); }
      try { enabledByEmail.set(to, await remindersEnabled(to)); } catch { enabledByEmail.set(to, true); }
    }
    let sentCount = 0; const errors = [];
    for (const c of circulars) {
      const deadline = new Date(c.deadline);
      const daysLeft = Math.ceil((deadline - now) / 86400000);
      if (daysLeft < 0 || daysLeft > 3) continue;
      for (const to of recipients) {
        if (!enabledByEmail.get(to)) continue; // প্রোফাইলে রিমাইন্ডার "না" — কিছু যাবে না
        if (!circularMatchesPrefs(c, prefsByEmail.get(to))) continue;
        const key = `${to}|${c.id}|deadline-${daysLeft}|${today}`;
        if (sent[key]) continue; // dedupe: আজকের রিমাইন্ডার আগেই পাঠানো হয়েছে
        const when = daysLeft === 0 ? 'আজই শেষ' : daysLeft === 1 ? 'আগামীকাল শেষ' : `আর ${bn(daysLeft)} দিন বাকি`;
        const subject = `Job Tracker — ${c.org}: ${when}`;
        const totalTxt = c.totalPosts == null ? 'উল্লেখ নেই' : bn(c.totalPosts) + 'টি';
        const hscTxt = c.hscPosts == null ? 'উল্লেখ নেই' : bn(c.hscPosts) + 'টি';
        const text = `নমস্কার / আসসালামু আলাইকুম,\n\n${c.org} — মোট ${totalTxt} পদ, HSC পদ ${hscTxt}।\nশেষ তারিখ: ${new Date(c.deadline).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' })}। ${when}।\nআবেদন: ${c.applyUrl}\n\nদ্বিতীয় সূত্রের তথ্য — আবেদনের আগে অফিসিয়াল সার্কুলার যাচাই করুন।\n— Job Tracker (jobtrackerbd@gmail.com)`;
        try { await sendMail({ subject, text, to }); sent[key] = today; sentCount++; await logSentEmail(to, subject, 'manual'); }
        catch (e) { errors.push(`${to}: ${e.message}`); }
      }
    }
    saveSent(sent);
    return res.status(200).json({ errors, ok: true, sent: sentCount, note: sentCount === 0 ? 'আজকের রিমাইন্ডার আগেই পাঠানো হয়েছে — নতুন কিছু পাঠানোর নেই।' : undefined });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
