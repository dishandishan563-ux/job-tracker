// Shared data loader: circulars always come fresh from ONLINE first.
// 1) /api/circulars (server, no-store — never a stale cached copy), which reads
//    data/circulars.json on the server. New circulars added there from verified
//    online sources (Teletalk portals / official pages) reach every visitor.
// 2) Fallback: local data/circulars.json if the API is unreachable.
// Admin edits are stored in localStorage (jt_admin_circulars) and merged over
// the online list on the client. A production deployment should move this
// to a database (Vercel KV / Postgres) — see README.
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
    return Object.values(byId);
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
      return Object.values(byId);
    } catch (e2) {
      return [];
    }
  }
}
window.loadCirculars = loadCirculars;
