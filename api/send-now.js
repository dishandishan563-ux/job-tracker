// POST /api/send-now — admin manual send: "এখনই ইমেইল পাঠান" (admin portal only).
// Sends the current deadline reminders (0–3 days left) to the registered recipients
// right now, using the same fingerprint dedupe as /api/daily-check, so an email
// already sent by the daily cron is never sent twice. ONE digest email per
// recipient: all matching circulars go in a single mail (same as daily-check).
// Automatic email is untouched — it still runs every morning at 08:00 Dhaka via the cron.
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

// ---------- একটাই ডাইজেস্ট মেইল (daily-check.js-এর মতো) ----------
function escHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function fmtDate(c) { try { return new Date(c.deadline).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return String(c.deadline || ''); } }

function reminderWhen(daysLeft) { return daysLeft === 0 ? 'আজই শেষ' : daysLeft === 1 ? 'আগামীকাল শেষ' : `আর ${bn(daysLeft)} দিন বাকি`; }

function buildReminderText(items) {
  const lines = ['নমস্কার / আসসালামু আলাইকুম,', '', `আজকের রিমাইন্ডার — মোট ${bn(items.length)}টি:`, ''];
  for (const { c, daysLeft } of items) {
    const totalTxt = c.totalPosts == null ? 'উল্লেখ নেই' : bn(c.totalPosts) + 'টি';
    const hscTxt = c.hscPosts == null ? 'উল্লেখ নেই' : bn(c.hscPosts) + 'টি';
    lines.push(`• ${c.org} — মোট ${totalTxt} পদ, HSC পদ ${hscTxt}।`);
    lines.push(`  শেষ তারিখ: ${fmtDate(c)}। ${reminderWhen(daysLeft)}।`);
    if (c.applyUrl) lines.push(`  আবেদন: ${c.applyUrl}`);
  }
  lines.push('', 'দ্বিতীয় সূত্রের তথ্য — আবেদনের আগে অফিসিয়াল সার্কুলার যাচাই করুন।');
  lines.push('— Job Tracker (jobtrackerbd@gmail.com)');
  return lines.join('\n');
}

function buildReminderHtml(items) {
  let h = `<p>নমস্কার / আসসালামু আলাইকুম,</p><p>আজকের রিমাইন্ডার — মোট ${bn(items.length)}টি:</p><ul>`;
  for (const { c, daysLeft } of items) {
    const totalTxt = c.totalPosts == null ? 'উল্লেখ নেই' : bn(c.totalPosts) + 'টি';
    const hscTxt = c.hscPosts == null ? 'উল্লেখ নেই' : bn(c.hscPosts) + 'টি';
    h += `<li><b>${escHtml(c.org)}</b> — মোট ${totalTxt} পদ, HSC পদ ${hscTxt}।<br>শেষ তারিখ: ${escHtml(fmtDate(c))}। ${reminderWhen(daysLeft)}।<br>${c.applyUrl ? `আবেদন: <a href="${escHtml(c.applyUrl)}">${escHtml(c.applyUrl)}</a>` : ''}</li>`;
  }
  h += '</ul><p>দ্বিতীয় সূত্রের তথ্য — আবেদনের আগে অফিসিয়াল সার্কুলার যাচাই করুন।<br>— Job Tracker (jobtrackerbd@gmail.com)</p>';
  return h;
}

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
    // ডাইজেস্ট: ম্যানুয়াল পাঠানোতেও একটাই মেইল প্রতি প্রাপক।
    const digestByEmail = new Map();
    for (const c of circulars) {
      const deadline = new Date(c.deadline);
      const daysLeft = Math.ceil((deadline - now) / 86400000);
      if (daysLeft < 0 || daysLeft > 3) continue;
      for (const to of recipients) {
        if (!enabledByEmail.get(to)) continue; // প্রোফাইলে রিমাইন্ডার "না" — কিছু যাবে না
        if (!circularMatchesPrefs(c, prefsByEmail.get(to))) continue;
        const key = `${to}|${c.id}|deadline-${daysLeft}|${today}`;
        if (sent[key]) continue; // dedupe: আজকের রিমাইন্ডার আগেই পাঠানো হয়েছে
        if (!digestByEmail.has(to)) digestByEmail.set(to, []);
        digestByEmail.get(to).push({ c, daysLeft, key });
      }
    }
    let sentCount = 0; let itemCount = 0; const errors = [];
    for (const [to, items] of digestByEmail) {
      if (!items.length) continue;
      const subject = `Job Tracker — আজকের রিমাইন্ডার (${bn(items.length)}টি)`;
      try {
        await sendMail({ subject, text: buildReminderText(items), html: buildReminderHtml(items), to });
        for (const it of items) sent[it.key] = today;
        sentCount++; itemCount += items.length;
        await logSentEmail(to, subject, 'manual');
      } catch (e) { errors.push(`${to}: ${e.message}`); }
    }
    saveSent(sent);
    return res.status(200).json({ errors, ok: true, sent: sentCount, items: itemCount, note: sentCount === 0 ? 'আজকের রিমাইন্ডার আগেই পাঠানো হয়েছে — নতুন কিছু পাঠানোর নেই।' : undefined });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
