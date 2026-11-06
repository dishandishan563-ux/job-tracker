// Shared data loader: circulars live in /data/circulars.json (seeded, secondary-source).
// The home page renders from this; admin edits are stored in localStorage (jt_admin_circulars)
// and merged over the seed on the client. A production deployment should move this
// to a database (Vercel KV / Postgres) — see README.
async function loadCirculars() {
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
    return Object.values(byId);
  } catch (e) {
    return [];
  }
}
window.loadCirculars = loadCirculars;
