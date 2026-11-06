// GET /api/online-check — প্রতিটি সার্কুলারের আবেদন পোর্টাল (Teletalk / অফিসিয়াল
// সাইট) এখন অনলাইনে চালু আছে কি না, সার্ভার থেকে লাইভ যাচাই করে।
// হোম পেইজের "এখনই নতুন সার্কুলার খুঁজুন" বাটন এটাই ডাকে; ডেইলি ক্রনও
// প্রতিদিন সকালে /api/daily-check-এর ভেতরে একই যাচাই চালায়, তাই তালিকাটা
// শুধু সিড করা ডেটা নয় — অনলাইন পোর্টালের অবস্থা প্রতিদিন যাচাই হয়।
// সতর্কতা: কোনো পোর্টালে সংযোগ না-হলে সেটাকে "বন্ধ" বলা হয় না — সেটা
// "অজানা" (unknown), কারণ অনেক Teletalk পোর্টাল কিছু নেটওয়ার্ক থেকে
// সাড়া দেয় না। "live" মানে শুধু নিশ্চিতভাবে চালু। চেকগুলো একসাথে
// (parallel) চলে, তাই পুরো যাচাই কয়েক সেকেন্ডে শেষ হয়।
// কোনো পোর্টালের HTML পার্স করে সার্কুলার বানানো হয় না (Teletalk পেইজ
// সেভাবে নির্ভরযোগ্যভাবে পার্স করা যায় না); নতুন সার্কুলার যোগ হয়
// যাচাই করা অনলাইন সূত্র থেকে data/circulars.json-এ, আর এখানে প্রতিটি
// পোর্টালের লাইভ অবস্থা দেখানো হয়।
const circulars = require('../data/circulars.json');

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
    results,
  });
};
