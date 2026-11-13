// GET /api/daily-check — Vercel Cron target (vercel.json: "0 2 * * *" = 08:00 Asia/Dhaka).
// 1) Runs the auto-discovery sweep (api/_discover.js): new government
//    circulars from Teletalk's own live list are added to the KV list.
//    New circulars also trigger ONE FCM push per matching user
//    (notifyNew — same category rules as the emails; see _discover.js).
// 2) Checks the circulars (KV list, seeded from data/circulars.json) for
//    deadlines 3 days / 1 day away, admit/exam and result updates, and
//    emails every registered recipient from the official sender Gmail.
//    ONE digest email per recipient per run: all deadline reminders and
//    exam/result alerts for that user go in a single mail (before this,
//    every circular sent its own mail — 4-5+ mails in one morning).
// 3) Exam / result alerts: for circulars a user saved/shortlisted or
//    marked applied, the circular's exam/result link is checked for a
//    newly published exam date or result. NOTE on the schema: no circular
//    currently carries an examUrl/resultUrl field (checked — the only
//    link is applyUrl), so the apply portal page itself is checked, and
//    an examUrl/resultUrl is used first if one is ever added. A change
//    is detected from a stored page hash (KV jt:exam-state:<id>); the
//    first sighting only stores a baseline and never alerts. An alert
//    goes out ONLY when the page changed AND the new text mentions an
//    exam/result (পরীক্ষা/ফলাফল/admit/exam/result) — a fetch or parse
//    failure is skipped silently, and no date is ever invented: the
//    alert says the portal changed and links to it. Alerts respect the
//    user's selected reminder categories, the master reminder toggle,
//    and pushEnabled; they go by email AND push (when enabled).
// Dedupe: a fingerprint (recipient + circular + alert type + date) is kept
// in /tmp/digest-sent.json on the function instance; for production, replace
// the store with Vercel KV / Postgres — see README. No human action is needed.
// The sweep is failure-proof: if it fails, reminders still run on the
// existing list.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sendMail } = require('./_mail');
const { kvAvailable, kvSMembers, kvGet, kvSet, keyFor, logSentEmail, getCirculars, isExpired, sendPush, wasPushSent, markPushSent } = require('./_store');
const { getUserPrefs, circularMatchesPrefs, remindersEnabled } = require('./_prefs');
const { runDiscovery, noteDiscoveryRan } = require('./_discover');
const seedCirculars = require('../data/circulars.json');

const SENT_FILE = '/tmp/job-tracker-sent.json';
function loadSent() { try { return JSON.parse(fs.readFileSync(SENT_FILE, 'utf8')); } catch { return {}; } }
function saveSent(s) { try { fs.writeFileSync(SENT_FILE, JSON.stringify(s)); } catch {} }

// প্রতিদিন সকালে প্রতিটি আবেদন পোর্টাল অনলাইনে চালু আছে কি না লাইভ যাচাই করা
// হয়। নতুন সার্কুলার Teletalk-এর লাইভ তালিকা থেকে অটো যোগ হয়
// (api/_discover.js) — পোর্টালের HTML পার্স করে সার্কুলার বানানো হয় না।
async function checkPortals(circulars) {
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

// ---------- একটাই ডাইজেস্ট মেইল ----------
// HTML এস্কেপ — সংস্থার নাম / লিংকে < > & থাকলেও মেইল ভাঙবে না।
function escHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function fmtDate(c) { try { return new Date(c.deadline).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return String(c.deadline || ''); } }

function deadlineWhen(daysLeft) { return daysLeft === 1 ? 'আগামীকাল শেষ!' : 'আর ৩ দিন বাকি।'; }

function buildDigestText(d) {
  const lines = ['নমস্কার / আসসালামু আলাইকুম,', '', `আজকের আপডেট — মোট ${bn(d.deadline.length + d.exam.length)}টি:`, ''];
  if (d.deadline.length) {
    lines.push('⏰ শেষ হতে চলেছে:');
    for (const { c, daysLeft } of d.deadline) {
      const totalTxt = c.totalPosts == null ? 'উল্লেখ নেই' : bn(c.totalPosts) + 'টি';
      const hscTxt = c.hscPosts == null ? 'উল্লেখ নেই' : bn(c.hscPosts) + 'টি';
      lines.push(`• ${c.org} — মোট ${totalTxt} পদ, HSC পদ ${hscTxt}।`);
      lines.push(`  শেষ তারিখ: ${fmtDate(c)}। ${deadlineWhen(daysLeft)}`);
      if (c.applyUrl) lines.push(`  আবেদন: ${c.applyUrl}`);
    }
    lines.push('');
  }
  if (d.exam.length) {
    lines.push('📋 পরীক্ষা/ফলাফল আপডেট:');
    for (const { c } of d.exam) {
      lines.push(`• ${c.org} — আপনার সেভ করা / আবেদন করা সার্কুলারের পোর্টালে পরীক্ষা বা ফলাফল সংক্রান্ত তথ্য বদলেছে বলে মনে হচ্ছে।`);
      lines.push(`  তারিখ এখানে দেওয়া হয়নি — অফিসিয়াল পোর্টালে যাচাই করুন: ${c.applyUrl}`);
    }
    lines.push('');
  }
  lines.push('দ্বিতীয় সূত্রের তথ্য — আবেদনের আগে অফিসিয়াল সার্কুলার যাচাই করুন।');
  lines.push('— Job Tracker (jobtrackerbd@gmail.com)');
  return lines.join('\n');
}

function buildDigestHtml(d) {
  const total = d.deadline.length + d.exam.length;
  let h = `<p>নমস্কার / আসসালামু আলাইকুম,</p><p>আজকের আপডেট — মোট ${bn(total)}টি:</p>`;
  if (d.deadline.length) {
    h += '<h3>⏰ শেষ হতে চলেছে</h3><ul>';
    for (const { c, daysLeft } of d.deadline) {
      const totalTxt = c.totalPosts == null ? 'উল্লেখ নেই' : bn(c.totalPosts) + 'টি';
      const hscTxt = c.hscPosts == null ? 'উল্লেখ নেই' : bn(c.hscPosts) + 'টি';
      h += `<li><b>${escHtml(c.org)}</b> — মোট ${totalTxt} পদ, HSC পদ ${hscTxt}।<br>শেষ তারিখ: ${escHtml(fmtDate(c))}। ${deadlineWhen(daysLeft)}<br>${c.applyUrl ? `আবেদন: <a href="${escHtml(c.applyUrl)}">${escHtml(c.applyUrl)}</a>` : ''}</li>`;
    }
    h += '</ul>';
  }
  if (d.exam.length) {
    h += '<h3>📋 পরীক্ষা/ফলাফল আপডেট</h3><ul>';
    for (const { c } of d.exam) {
      h += `<li><b>${escHtml(c.org)}</b> — আপনার সেভ করা / আবেদন করা সার্কুলারের পোর্টালে পরীক্ষা বা ফলাফল সংক্রান্ত তথ্য বদলেছে বলে মনে হচ্ছে।<br>তারিখ এখানে দেওয়া হয়নি — অফিসিয়াল পোর্টালে যাচাই করুন: ${c.applyUrl ? `<a href="${escHtml(c.applyUrl)}">${escHtml(c.applyUrl)}</a>` : 'পোর্টাল'}</li>`;
    }
    h += '</ul>';
  }
  h += '<p>দ্বিতীয় সূত্রের তথ্য — আবেদনের আগে অফিসিয়াল সার্কুলার যাচাই করুন।<br>— Job Tracker (jobtrackerbd@gmail.com)</p>';
  return h;
}

// ---------- Exam / result alerts (saved + applied circulars only) ----------
// Conservative by design: fetch fails / unparseable page / no exam keyword
// in the new text = no alert, ever. The stored state is a hash of the
// cleaned page text — no date is extracted or claimed.
const EXAM_KEYWORDS = /পরীক্ষা|ফলাফল|এডমিট|প্রবেশপত্র|admit|exam|result/i;
const EXAM_STATE_PREFIX = 'jt:exam-state';
const EXAM_MAX_URLS = 25;
const EXAM_TIMEOUT_MS = 6000;

function pageText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ').trim();
}

function pageHash(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// Check URLs for one circular, in priority order: a dedicated exam/result
// link first when one exists (none do today), else the apply portal.
function checkUrlsFor(c) {
  return [...new Set([c.examUrl, c.resultUrl, c.applyUrl].filter(u => typeof u === 'string' && u.trim()))];
}

async function checkExamUpdates(recipients, circulars, prefsByEmail, enabledByEmail, sent) {
  const out = { checked: 0, alerts: 0, errors: [], itemsByEmail: new Map() }; // itemsByEmail: to -> [{c, hash12}] — মেইল পাঠানো হয় না, ডাইজেস্টে জমা হয়
  if (!kvAvailable() || !recipients.length) return out;
  const byId = new Map(circulars.map(c => [c.id, c]));
  // Per user: what they saved / applied, plus their push token.
  const watchByEmail = new Map();
  for (const to of recipients) {
    if (!enabledByEmail.get(to)) continue;
    let rec = null;
    try { rec = await kvGet(keyFor('jt:user', to)); } catch { continue; }
    const data = rec && rec.data;
    if (!data) continue;
    const ids = new Set([
      ...(Array.isArray(data.shortlist) ? data.shortlist : []),
      ...Object.entries(data.status || {}).filter(([, v]) => v === 'applied').map(([k]) => k),
    ]);
    const watched = [...ids].map(id => byId.get(id)).filter(c => c && !isExpired(c));
    if (!watched.length) continue;
    watchByEmail.set(to, {
      watched,
      pushToken: (typeof data.pushToken === 'string' && data.pushToken) ? data.pushToken : null,
      pushEnabled: !(data.profile && data.profile.pushEnabled === false),
    });
  }
  if (!watchByEmail.size) return out;
  // One fetch per distinct check URL (capped), in parallel.
  const urlToCircular = new Map(); // url -> first circular that uses it
  for (const { watched } of watchByEmail.values()) {
    for (const c of watched) for (const u of checkUrlsFor(c)) if (!urlToCircular.has(u)) urlToCircular.set(u, c);
  }
  const urls = [...urlToCircular.keys()].slice(0, EXAM_MAX_URLS);
  const fetched = new Map(); // url -> { text, hash } (only on success)
  await Promise.all(urls.map(async (url) => {
    try {
      const r = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': 'JobTracker-ExamCheck/1.0', 'Accept': 'text/html,*/*' }, signal: AbortSignal.timeout(EXAM_TIMEOUT_MS) });
      if (!r.ok) return;
      const text = pageText(await r.text());
      if (text.length < 20) return; // empty / bot shell — not a real page
      fetched.set(url, { text, hash: pageHash(text) });
    } catch { /* skip silently — never alert on a failed fetch */ }
  }));
  out.checked = fetched.size;
  // Per circular: compare with the stored baseline, decide changed+keyword.
  const changed = new Map(); // circularId -> { c, hash }
  for (const { watched } of watchByEmail.values()) {
    for (const c of watched) {
      if (changed.has(c.id)) continue;
      const hit = checkUrlsFor(c).map(u => fetched.get(u)).find(Boolean);
      if (!hit) continue;
      let prev = null;
      try { prev = await kvGet(`${EXAM_STATE_PREFIX}:${c.id}`); } catch {}
      const prevHash = prev && prev.hash;
      if (!prevHash) {
        // First sighting — store the baseline, never alert.
        try { await kvSet(`${EXAM_STATE_PREFIX}:${c.id}`, { hash: hit.hash, seenAt: new Date().toISOString(), url: checkUrlsFor(c)[0] || '' }); } catch {}
        continue;
      }
      if (prevHash === hit.hash) continue;
      // Page changed — move the baseline forward either way, so one
      // non-exam change cannot trigger a stale alert later.
      try { await kvSet(`${EXAM_STATE_PREFIX}:${c.id}`, { hash: hit.hash, seenAt: new Date().toISOString(), url: checkUrlsFor(c)[0] || '' }); } catch {}
      if (!EXAM_KEYWORDS.test(hit.text)) continue;
      changed.set(c.id, { c, hash: hit.hash });
    }
  }
  if (!changed.size) return out;
  // Alert every watcher of a changed circular (category-filtered).
  // মেইল এখানে পাঠানো হয় না — অ্যালার্টগুলো ডাইজেস্টে জমা হয়, মূল
  // হ্যান্ডলার একটাই মেইলে সব পাঠায়। পুশ আগের মতোই প্রতি আইটেমে যায়।
  for (const [to, info] of watchByEmail) {
    for (const c of info.watched) {
      const ch = changed.get(c.id);
      if (!ch) continue;
      if (!circularMatchesPrefs(c, prefsByEmail.get(to))) continue;
      const hash12 = ch.hash.slice(0, 12);
      const emailKey = `${to}|${c.id}|exam|${hash12}`;
      if (!sent[emailKey]) {
        if (!out.itemsByEmail.has(to)) out.itemsByEmail.set(to, []);
        out.itemsByEmail.get(to).push({ c, hash12 });
        out.alerts++;
      }
      if (info.pushToken && info.pushEnabled) {
        const userHash = keyFor('jt:user', to).split(':').pop();
        const tag = `exam:${c.id}:${hash12}`;
        try {
          if (!(await wasPushSent(userHash, tag))) {
            const r = await sendPush(info.pushToken, `পরীক্ষা/ফলাফল আপডেট: ${c.org}`, 'সেভ করা সার্কুলারের পোর্টালে নতুন তথ্য — অফিসিয়াল পোর্টালে দেখুন।', { circularId: String(c.id || ''), org: String(c.org || ''), type: 'exam_update', url: String(c.applyUrl || '') });
            if (r && r.ok) { try { await markPushSent(userHash, tag); } catch {} }
          }
        } catch {}
      }
    }
  }
  return out;
}

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
  // নতুন সার্কুলার অটো যোগ — ব্যর্থ হলেও রিমাইন্ডার চলবে। নতুন সার্কুলার
  // এলে মিলে যাওয়া ব্যবহারকারীকে একবার পুশও যাবে (notifyNew)।
  const discovered = await runDiscovery({ notifyNew: true }).catch(() => ({ ok: false, added: 0, error: 'sweep_failed' }));
  // সুইপ চলেছে — সময়টা সেভ করে রাখি, যাতে অ্যাপ খুললে ১ ঘণ্টার মধ্যে আবার সুইপ না চলে।
  if (discovered && discovered.ok) await noteDiscoveryRan().catch(() => {});
  // রিমাইন্ডার KV তালিকা (সদ্য যোগ হওয়া সার্কুলারসহ) থেকে চলে; KV না
  // থাকলে সিড করা JSON ফাইল থেকে।
  let circulars = null;
  try { circulars = await getCirculars(); } catch {}
  if (!Array.isArray(circulars) || !circulars.length) circulars = seedCirculars;
  const portals = await checkPortals(circulars);
  const portalsLive = portals.filter(p => p.live).length;
  const portalsUnknown = portals.filter(p => p.unknown).length;
  const portalSummary = { checked: portals.length, live: portalsLive, unknown: portalsUnknown, results: portals };
  if (!recipients.length) return res.status(200).json({ ok: true, sent: 0, discovered, portals: portalSummary, note: 'No recipients registered (EMAIL_RECIPIENTS is empty). Users who sign in are added via /api/register-recipient when a database is wired up.' });
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
  // ডাইজেস্ট: সকালের সব মেইল একটায় — প্রতিটি প্রাপকের জন্য ডেডলাইন
  // রিমাইন্ডার + পরীক্ষা/ফলাফল অ্যালার্ট জমা হয়, তারপর একটাই মেইল যায়।
  // (আগে প্রতিটি সার্কুলারের জন্য আলাদা মেইল যেত — ৪/৫টা একসাথে আসত।)
  const errors = [];
  const digestByEmail = new Map(); // to -> { deadline: [{c, daysLeft, key}], exam: [{c, hash12, key}] }
  for (const c of circulars) {
    const deadline = new Date(c.deadline);
    const daysLeft = Math.ceil((deadline - now) / 86400000);
    if (daysLeft !== 3 && daysLeft !== 1) continue;
    for (const to of recipients) {
      if (!enabledByEmail.get(to)) continue; // প্রোফাইলে রিমাইন্ডার "না" — কিছু যাবে না
      if (!circularMatchesPrefs(c, prefsByEmail.get(to))) continue;
      const key = `${to}|${c.id}|deadline-${daysLeft}|${today}`;
      if (sent[key]) continue; // dedupe: never send the same email twice
      if (!digestByEmail.has(to)) digestByEmail.set(to, { deadline: [], exam: [] });
      digestByEmail.get(to).deadline.push({ c, daysLeft, key });
    }
  }
  // পরীক্ষা/ফলাফল অ্যালার্ট — সেভ করা বা আবেদন করা সার্কুলারের পোর্টাল
  // বদলেছে কি না দেখা হয়; ব্যর্থ হলে রিমাইন্ডার বাঁচে, অ্যালার্ট শুধু বাদ যায়।
  // (মেইল এখানে যায় না — অ্যালার্টগুলো ডাইজেস্টে জমা হয়; পুশ আগের মতোই যায়।)
  let exam = { checked: 0, alerts: 0, errors: [] };
  try { exam = await checkExamUpdates(recipients, circulars, prefsByEmail, enabledByEmail, sent); } catch (e) { exam.errors.push(String((e && e.message) || e)); }
  errors.push(...(exam.errors || []));
  if (exam.itemsByEmail) {
    for (const [to, items] of exam.itemsByEmail) {
      if (!digestByEmail.has(to)) digestByEmail.set(to, { deadline: [], exam: [] });
      for (const it of items) digestByEmail.get(to).exam.push({ c: it.c, hash12: it.hash12, key: `${to}|${it.c.id}|exam|${it.hash12}` });
    }
  }
  // একটাই মেইল প্রতি প্রাপক — সফল হলে তবেই সব আইটেমের dedupe চিহ্ন বসে।
  let sentCount = 0; let itemCount = 0;
  for (const [to, d] of digestByEmail) {
    const total = d.deadline.length + d.exam.length;
    if (!total) continue;
    const subject = `Job Tracker — আজকের আপডেট (${bn(total)}টি)`;
    try {
      await sendMail({ subject, text: buildDigestText(d), html: buildDigestHtml(d), to });
      for (const it of d.deadline) sent[it.key] = today;
      for (const it of d.exam) sent[it.key] = today;
      sentCount++; itemCount += total;
      await logSentEmail(to, subject, 'daily');
    } catch (e) { errors.push(`${to}: ${e.message}`); }
  }
  saveSent(sent);
  return res.status(200).json({ errors, ok: true, sent: sentCount, items: itemCount, exam: { checked: exam.checked, alerts: exam.alerts, errors: exam.errors }, discovered, portals: portalSummary });
};

// Mock-test hooks (no new file): the handler stays the default export.
module.exports.checkExamUpdates = checkExamUpdates;
module.exports.pageText = pageText;
module.exports.pageHash = pageHash;
