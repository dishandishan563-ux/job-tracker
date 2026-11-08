// Shared data loader: circulars always come fresh from ONLINE first.
// 1) /api/circulars (server, no-store — never a stale cached copy), which
//    reads the KV list (seeded from data/circulars.json, auto-discovery adds
//    new circulars from Teletalk's live list). New circulars reach every
//    visitor as soon as the sweep adds them.
// 2) Fallback: local data/circulars.json if the API is unreachable.
// Admin edits (add / correct / delete) now save to the server too
// (api/config.js, PIN-gated) — every user sees them. localStorage
// (jt_admin_circulars / jt_deleted_circulars) is only a fallback for when
// the server save fails; a successful server save clears the local copy,
// so a stale local copy never shadows the fresh server copy.
// মেয়াদ শেষ সার্কুলার দেখাবে না — সার্ভার তালিকা আগেই ফিল্টার করে, কিন্তু
// লোকাল ফলব্যাক (সিড ফাইল / ব্রাউজারের jt_admin_circulars) সার্ভার
// ফিল্টার এড়িয়ে যায় বলে এখানেও একই নিয়ম: deadline পেরিয়ে গেলেই বাদ,
// deadline না থাকলে দেখাবে।
function notExpired(c) {
  if (!c || !c.deadline) return true;
  const t = new Date(c.deadline).getTime();
  return !Number.isFinite(t) || t >= Date.now();
}
async function loadCirculars() {
  try {
    const r = await fetch('api/circulars', { cache: 'no-store' });
    if (!r.ok) throw new Error('api failed');
    const data = await r.json();
    const seed = Array.isArray(data.circulars) ? data.circulars : data;
    let extra = [];
    try { extra = JSON.parse(localStorage.getItem('jt_admin_circulars') || '[]'); } catch {}
    const deleted = JSON.parse(localStorage.getItem('jt_deleted_circulars') || '[]');
    const byId = {};
    seed.forEach(c => { if (!deleted.includes(c.id)) byId[c.id] = c; });
    extra.forEach(c => { byId[c.id] = c; });
    return Object.values(byId).filter(notExpired);
  } catch (e) {
    try {
      const r = await fetch('data/circulars.json');
      if (!r.ok) throw new Error('fetch failed');
      const seed = await r.json();
      let extra = [];
      try { extra = JSON.parse(localStorage.getItem('jt_admin_circulars') || '[]'); } catch {}
      const deleted = JSON.parse(localStorage.getItem('jt_deleted_circulars') || '[]');
      const byId = {};
      seed.forEach(c => { if (!deleted.includes(c.id)) byId[c.id] = c; });
      extra.forEach(c => { byId[c.id] = c; });
      return Object.values(byId).filter(notExpired);
    } catch (e2) {
      return [];
    }
  }
}
window.loadCirculars = loadCirculars;
