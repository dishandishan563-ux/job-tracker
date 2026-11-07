// GET /api/circulars — সার্কুলার তালিকা সবসময় সার্ভার থেকে তাজা আসে।
// no-store হেডার দেওয়া আছে, তাই ব্রাউজার পুরনো ক্যাশ করা কপি দেখায় না —
// হোম পেইজের তালিকা প্রতিবার লোডে এই এন্ডপয়েন্ট থেকেই আসে (data.js দেখুন)।
// তালিকাটা Vercel KV-তে থাকে (jt:circulars): প্রথমবার data/circulars.json
// থেকে সিড হয়, তারপর অটো-ডিসকভারি (api/_discover.js) নতুন সার্কুলার যোগ
// করে — প্রতিদিন সকাল ৮টার ক্রনে আর হোমের "এখনই নতুন সার্কুলার খুঁজুন"
// বাটনে। KV না থাকলে সিড করা JSON ফাইলটাই ফেরত যায়।
const { getCirculars } = require('./_store');
const seed = require('../data/circulars.json');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  let list = null;
  try { list = await getCirculars(); } catch {}
  if (!Array.isArray(list) || !list.length) list = seed;
  return res.status(200).json({
    ok: true,
    count: list.length,
    updatedAt: new Date().toISOString(),
    circulars: list,
  });
};
