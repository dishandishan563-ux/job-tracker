// GET /api/circulars — সার্কুলার তালিকা সবসময় সার্ভার থেকে তাজা আসে।
// no-store হেডার দেওয়া আছে, তাই ব্রাউজার পুরনো ক্যাশ করা কপি দেখায় না —
// হোম পেইজের তালিকা প্রতিবার লোডে এই এন্ডপয়েন্ট থেকেই আসে (data.js দেখুন)।
// তালিকাটা Vercel KV-তে থাকে (jt:circulars): প্রথমবার data/circulars.json
// থেকে সিড হয়, তারপর অটো-ডিসকভারি (api/_discover.js) নতুন সার্কুলার যোগ
// করে — Teletalk-এর তালিকা + চট্টগ্রাম বন্দরের নিজস্ব পোর্টাল, দুটোই —
// প্রতিদিন সকাল ৮টার ক্রনে, হোমের "এখনই নতুন সার্কুলার খুঁজুন"
// বাটনে, আর এখন অ্যাপ/ওয়েবসাইট খুললেই (থ্রটল করা: শেষ সুইপের ১ ঘণ্টার
// মধ্যে আবার সুইপ চলে না — jt:last-discovery, api/_discover.js দেখুন)।
// তাই নতুন সার্কুলার এলে পরেরবার অ্যাপ খুললেই তালিকায় উঠে
// আসে, কাউকে কিছু চাপতে হয় না। KV না থাকলে সিড করা JSON ফাইলটাই ফেরত যায়।
const { getCirculars, isExpired } = require('./_store');
const { discoverIfDue } = require('./_discover');
const seed = require('../data/circulars.json');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // অটো-ডিসকভারি (থ্রটল করা) — ব্যর্থ হলেও নিচের তালিকা চলবে।
  let discovered = null;
  try { discovered = await discoverIfDue(); } catch {}
  let list = null;
  try { list = await getCirculars(); } catch {}
  if (!Array.isArray(list) || !list.length) list = seed;
  // মেয়াদ শেষ সার্কুলার কখনো দেখাবে না — deadline পেরিয়ে গেলেই তালিকা
  // থেকে বাদ, grace (৩ দিন) পেরিয়েছে কি না তা দেখে নয়। Deadline নেই
  // এমন এন্ট্রি বাদ পড়ে না। KV থেকে মুছে ফেলা আলাদা — সুইপের prune
  // (api/_discover.js) grace পেরোলে সেটা করে।
  const nowMs = Date.now();
  const visible = list.filter(c => !isExpired(c, nowMs));
  return res.status(200).json({
    ok: true,
    count: visible.length,
    updatedAt: new Date().toISOString(),
    discovered: discovered ? { added: discovered.added || 0, throttled: !!discovered.throttled } : null,
    circulars: visible,
  });
};
