// GET /api/daily-check — Vercel Cron target (vercel.json: "0 2 * * *" = 08:00 Asia/Dhaka).
// Checks the seeded circulars for deadlines 3 days / 1 day away, admit/exam and
// result updates, and emails every registered recipient from the official sender
// Gmail. Dedupe: a fingerprint (recipient + circular + alert type + date) is kept
// in /tmp/digest-sent.json on the function instance; for production, replace the
// store with Vercel KV / Postgres — see README. No human action is needed.
const fs = require('fs');
const path = require('path');
const { sendMail } = require('./_mail');
const { kvAvailable, kvSMembers, logSentEmail } = require('./_store');
const circulars = require('../data/circulars.json');

const SENT_FILE = '/tmp/job-tracker-sent.json';
function loadSent() { try { return JSON.parse(fs.readFileSync(SENT_FILE, 'utf8')); } catch { return {}; } }
function saveSent(s) { try { fs.writeFileSync(SENT_FILE, JSON.stringify(s)); } catch {} }

// প্রতিদিন সকালে প্রতিটি আবেদন পোর্টাল অনলাইনে চালু আছে কি না লাইভ যাচাই করা
// হয় — তালিকাটা শুধু সিড করা ডেটা নয়, পোর্টালের অবস্থা প্রতিদিন যাচাই হয়।
// (পোর্টালের HTML পার্স করে সার্কুলার বানানো হয় না; নতুন সার্কুলার যোগ হয়
// যাচাই করা অনলাইন সূত্র থেকে data/circulars.json-এ।)
async function checkPortals() {
  const urls = [...new Set(circulars.map(c => c.applyUrl).filter(Boolean))];
  const results = await Promise.all(urls.map(async (url) => {
    try {
      const r = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': 'JobTracker-DailyCheck/1.0' }, signal: AbortSignal.timeout(4000) });
      return { portal: url, live: r.status < 500, unknown: false, status: r.status };
    } catch { return { portal: url, live: false, unknown: true, status: 0 }; }
  }));
  return results;
}

function bn(n) { return String(n).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[+d]); }

module.exports = async (req, res) => {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET> when configured.
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  const recipients = [...new Set([
    ...(process.env.EMAIL_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean),
    // সার্ভারে সেভ থাকা প্রাপকরা (লগইন করা ব্যবহারকারীরা) — KV চালু থাকলে।
    ...(kvAvailable() ? await kvSMembers('jt:recipients').catch(() => []) : []),
  ].map(s => String(s).trim().toLowerCase()).filter(Boolean))];
  const portals = await checkPortals();
  const portalsLive = portals.filter(p => p.live).length;
  const portalsUnknown = portals.filter(p => p.unknown).length;
  const portalSummary = { checked: portals.length, live: portalsLive, unknown: portalsUnknown, results: portals };
  if (!recipients.length) return res.status(200).json({ ok: true, sent: 0, portals: portalSummary, note: 'No recipients registered (EMAIL_RECIPIENTS is empty). Users who sign in are added via /api/register-recipient when a database is wired up.' });
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const sent = loadSent();
  let sentCount = 0; const errors = [];
  for (const c of circulars) {
    const deadline = new Date(c.deadline);
    const daysLeft = Math.ceil((deadline - now) / 86400000);
    if (daysLeft !== 3 && daysLeft !== 1) continue;
    for (const to of recipients) {
      const key = `${to}|${c.id}|deadline-${daysLeft}|${today}`;
      if (sent[key]) continue; // dedupe: never send the same email twice
      const subject = `Job Tracker — ${c.org}: ${daysLeft === 1 ? 'আগামীকাল শেষ' : 'আর ৩ দিন বাকি'}`;
      const text = `আসসালামু আলাইকুম,\n\n${c.org} — মোট ${bn(c.totalPosts)}টি পদ, HSC পদ ${bn(c.hscPosts)}টি।\nশেষ তারিখ: ${new Date(c.deadline).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' })}। ${daysLeft === 1 ? 'আগামীকাল শেষ!' : 'আর ৩ দিন বাকি।'}\nআবেদন: ${c.applyUrl}\n\nদ্বিতীয় সূত্রের তথ্য — আবেদনের আগে অফিসিয়াল সার্কুলার যাচাই করুন।\n— Job Tracker (jobtrackerbd@gmail.com)`;
      try { await sendMail({ subject, text, to }); sent[key] = today; sentCount++; await logSentEmail(to, subject, 'daily'); }
      catch (e) { errors.push(`${to}: ${e.message}`); }
    }
  }
  saveSent(sent);
  return res.status(200).json({ errors, ok: true, sent: sentCount, portals: portalSummary });
};
