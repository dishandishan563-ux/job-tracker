// GET /api/online-check — প্রতিটি সার্কুলারের আবেদন পোর্টাল (Teletalk / অফিসিয়াল
// সাইট) এখন অনলাইনে চালু আছে কি না, সার্ভার থেকে লাইভ যাচাই করে।
// হোম পেইজের "এখনই নতুন সার্কুলার খুঁজুন" বাটন এটাই ডাকে; ডেইলি ক্রনও
// প্রতিদিন সকালে /api/daily-check-এর ভেতরে একই যাচাই চালায়।
// এই এন্ডপয়েন্ট প্রথমে অটো-ডিসকভারি চালায় (api/_discover.js): Teletalk-এর
// লাইভ সরকারি চাকরির তালিকা থেকে নতুন সার্কুলার KV তালিকায় যোগ হয়, তারপর
// পোর্টাল যাচাই চলে — তাই বাটন চাপলেই নতুন সার্কুলার তালিকায় উঠে আসে।
// সতর্কতা: কোনো পোর্টালে সংযোগ না-হলে সেটাকে "বন্ধ" বলা হয় না — সেটা
// "অজানা" (unknown), কারণ অনেক Teletalk পোর্টাল কিছু নেটওয়ার্ক থেকে
// সাড়া দেয় না। "live" মানে শুধু নিশ্চিতভাবে চালু। চেকগুলো একসাথে
// (parallel) চলে, তাই পুরো যাচাই কয়েক সেকেন্ডে শেষ হয়।
// ডিসকভারি ব্যর্থ হলেও (সূত্র ডাউন থাকলে) পোর্টাল যাচাই চলবে — সুইপ কখনো
// এই এন্ডপয়েন্ট ভাঙে না।
const { getCirculars } = require('./_store');
const { runDiscovery, noteDiscoveryRan } = require('./_discover');
const seedCirculars = require('../data/circulars.json');

async function checkPortal(url) {
  try {
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'JobTracker-OnlineCheck/1.0' },
      signal: AbortSignal.timeout(4000),
    });
    return { live: r.status < 500, unknown: false, status: r.status };
  } catch (e) {
    // সংযোগই হয়নি — পোর্টাল বন্ধ প্রমাণিত নয়, শুধু এই নেটওয়ার্ক থেকে যাচাই হয়নি।
    return { live: false, unknown: true, status: 0 };
  }
}

module.exports = async (req, res) => {
  // নতুন সার্কুলার অটো যোগ — ব্যর্থ হলেও নিচের যাচাই চলবে। নতুন সার্কুলার
  // এলে মিলে যাওয়া ব্যবহারকারীকে একবার পুশও যাবে (notifyNew)।
  const discovered = await runDiscovery({ notifyNew: true }).catch(() => ({ ok: false, added: 0, error: 'sweep_failed' }));
  // সুইপ চলেছে — সময়টা সেভ করে রাখি, যাতে অ্যাপ খুললে ১ ঘণ্টার মধ্যে আবার সুইপ না চলে।
  if (discovered && discovered.ok) await noteDiscoveryRan().catch(() => {});
  let circulars = null;
  try { circulars = await getCirculars(); } catch {}
  if (!Array.isArray(circulars) || !circulars.length) circulars = seedCirculars;
  const seen = new Map();
  for (const c of circulars) {
    if (c.applyUrl && !seen.has(c.applyUrl)) seen.set(c.applyUrl, c);
  }
  const results = await Promise.all([...seen].map(async ([url, c]) => {
    const r = await checkPortal(url);
    return { id: c.id, org: c.org, portal: url, live: r.live, unknown: r.unknown, status: r.status };
  }));
  const liveCount = results.filter(r => r.live).length;
  const unknownCount = results.filter(r => r.unknown).length;
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.status(200).json({
    ok: true,
    checkedAt: new Date().toISOString(),
    portals: results.length,
    live: liveCount,
    unknown: unknownCount,
    discovered,
    push: discovered && discovered.push ? discovered.push : null,
    results,
  });
};
