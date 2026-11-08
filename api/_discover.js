// Auto-discovery of new government circulars — Teletalk's own aggregator.
//
// Source: https://alljobs.teletalk.com.bd/api/v1/govt-jobs/list (public JSON API,
// no key, no login) — the same live list the Teletalk "Alljobs" site shows.
// One fetch returns every live government job post: org (with English name
// and short name), post title in Bangla + English, vacancy, published and
// deadline dates, and the Teletalk apply link.
//
// Posts are grouped by organization into one circular per org (a circular
// = one org + one deadline; the API data confirms each org has a single
// deadline). Only complete groups are added: org + deadline + apply URL
// must all be present and the deadline must still be in the future.
// Qualification (HSC / SSC / ...) is NOT in this API, so hscPosts is left
// null (shown as "উল্লেখ নেই") — never guessed. Grade and fee are likewise
// unknown from this source. Everything added is marked source:"secondary"
// and autoAdded:true; auto-added entries carry no sourceNote, so their cards
// show no warning box (owner request).
//
// Failure-proof by design: any fetch / parse / KV error returns
// { ok:false, ... } and never throws — the daily reminders and the site
// keep working even if the discovery source is down.
//
// Other listing sites were checked and rejected: alljobsbd.com sits behind
// a reCAPTCHA bot check (unfetchable from a serverless function) and
// chakri.com returns a Cloudflare error. Teletalk's own API is the one
// reliable, structured source.
const { getCirculars, saveCirculars, mergeCirculars, dhakaDate, allKeys, getDeletedKeys, getLastDiscovery, setLastDiscovery } = require('./_store');

const DISCOVER_URL = 'https://alljobs.teletalk.com.bd/api/v1/govt-jobs/list?skipLimit=YES';
const DISCOVER_TIMEOUT_MS = 8000;

// Same circular, different apply host — the seed links the district's own
// site, Teletalk links the teletalk portal. API short_name -> seeded id.
const ALIASES = { DCPATUAKHALI: 'patuakhali' };

// Filter category for the home page chips, from the Teletalk short name / host.
function classify(shortName, applyUrl) {
  let host = '';
  try { host = new URL(applyUrl).hostname.toLowerCase(); } catch {}
  const s = String(shortName || '').toLowerCase();
  if (host.startsWith('tax') || s.startsWith('tax')) return { type: 'tax', typeBn: 'কর / রাজস্ব' };
  if (host.startsWith('dc') || s.startsWith('dc')) return { type: 'district', typeBn: 'জেলা প্রশাসন' };
  if (host.startsWith('sp') || s.startsWith('sp')) return { type: 'police', typeBn: 'পুলিশ / প্রতিরক্ষা' };
  if (host.startsWith('cpa') || s === 'cpa') return { type: 'port', typeBn: 'বন্দর / কর্তৃপক্ষ' };
  return { type: 'ministry', typeBn: 'মন্ত্রণালয় / অধিদপ্তর' };
}

function mostCommon(values) {
  const counts = {};
  for (const v of values) {
    const s = String(v || '').trim();
    if (s) counts[s] = (counts[s] || 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : '';
}

// One circular from one organization's job posts. Returns null when the
// group is incomplete (no org name, no valid deadline, no apply URL, no
// usable posts) — incomplete groups are skipped, never guessed.
function buildCandidate(jobs) {
  if (!Array.isArray(jobs) || !jobs.length) return null;
  const first = jobs[0];
  const orgObj = first.job_utilities_govtorganization || {};
  const orgName = String(orgObj.name || '').trim();
  const shortName = String(orgObj.short_name || '').trim();
  if (!orgName) return null;
  const deadline = mostCommon(jobs.map(j => j.deadline_date));
  if (!deadline || isNaN(new Date(deadline))) return null;
  const applyUrl = mostCommon(jobs.map(j => j.application_site));
  if (!applyUrl) return null;
  const posts = jobs.map(j => ({
    title: String(j.job_title_bn || j.job_title || '').trim(),
    count: /^\d+$/.test(String(j.vacancy)) ? parseInt(j.vacancy, 10) : null,
    grade: null,
    qualification: null,
    typingBn: 0,
    typingEn: 0,
  })).filter(p => p.title);
  if (!posts.length) return null;
  const total = posts.reduce((s, p) => s + (typeof p.count === 'number' ? p.count : 0), 0);
  const cls = classify(shortName, applyUrl);
  return {
    id: `auto-${first.organization_id}-${dhakaDate(deadline)}`,
    org: orgName,
    orgEn: orgName,
    type: cls.type,
    typeBn: cls.typeBn,
    totalPosts: total || null,
    hscPosts: null,
    grade: null,
    fee: null,
    deadline: new Date(deadline).toISOString(),
    salary: '',
    age: 'অফিসিয়াল সার্কুলারে দেখুন',
    districts: 'অফিসিয়াল সার্কুলারে দেখুন',
    applyUrl,
    source: 'secondary',
    posts,
    addedAt: new Date().toISOString(),
    autoAdded: true,
    _short: shortName,
  };
}

// Run one discovery sweep: fetch, group, build candidates, merge the new
// ones into the KV list. Returns a summary; never throws.
async function runDiscovery() {
  try {
    const r = await fetch(DISCOVER_URL, {
      headers: { 'User-Agent': 'JobTracker-Discover/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS),
    });
    if (!r.ok) return { ok: false, added: 0, skipped: 0, total: 0, error: 'HTTP ' + r.status };
    const data = await r.json().catch(() => null);
    const jobs = data && Array.isArray(data.govtJobs) ? data.govtJobs : null;
    if (!jobs) return { ok: false, added: 0, skipped: 0, total: 0, error: 'bad_response' };
    const groups = new Map();
    for (const j of jobs) {
      if (!j || j.organization_id == null) continue;
      if (!groups.has(j.organization_id)) groups.set(j.organization_id, []);
      groups.get(j.organization_id).push(j);
    }
    const now = new Date();
    const candidates = [];
    const shortByCandidate = new Map();
    let skipped = 0;
    // অ্যাডমিন সার্ভার থেকে মুছে ফেলা সার্কুলার আর ফিরবে না — মুছে ফেলার
    // চাবিগুলো (host+তারিখ / id+তারিখ) KV-তে jt:deleted-circulars-এ থাকে।
    let deletedKeys = new Set();
    try { deletedKeys = new Set(await getDeletedKeys()); } catch {}
    for (const js of groups.values()) {
      const c = buildCandidate(js);
      if (!c || new Date(c.deadline) < now) { skipped++; continue; }
      if (allKeys(c).some(k => deletedKeys.has(k))) { skipped++; continue; }
      shortByCandidate.set(c, c._short);
      delete c._short;
      candidates.push(c);
    }
    const list = await getCirculars();
    if (!list) return { ok: false, added: 0, skipped, total: candidates.length, error: 'kv_not_configured' };
    const added = mergeCirculars(list, candidates, cand => {
      const alias = ALIASES[shortByCandidate.get(cand)];
      return alias ? [`id:${alias}|${dhakaDate(cand.deadline)}`] : [];
    });
    if (added.length) await saveCirculars(list);
    return { ok: true, added: added.length, skipped, total: candidates.length, checked: groups.size, addedIds: added.map(a => a.id) };
  } catch (e) {
    return { ok: false, added: 0, skipped: 0, total: 0, error: String((e && e.message) || e) };
  }
}

module.exports = { runDiscovery, buildCandidate, classify, DISCOVER_URL, ALIASES, discoverIfDue, noteDiscoveryRan };

// ---------- Throttled auto-discovery (app/website opens) ----------
// GET /api/circulars is called on every app + website open. A sweep on
// every open would hammer Teletalk's API, so this runs one only when the
// last sweep (from any trigger) is more than ~1 hour old. The timestamp
// is shared in KV (jt:last-discovery), so all triggers agree.
// Returns the sweep result, or { ok:true, throttled:true } when skipped.
// A failed sweep does NOT stamp the time — the next open retries.
const DISCOVER_THROTTLE_MS = 60 * 60 * 1000;

async function discoverIfDue() {
  try {
    const last = await getLastDiscovery();
    if (last && !isNaN(Date.parse(last)) && (Date.now() - Date.parse(last)) < DISCOVER_THROTTLE_MS) {
      return { ok: true, throttled: true, added: 0, skipped: 0, total: 0 };
    }
  } catch {}
  const r = await runDiscovery();
  if (r && r.ok) { try { await setLastDiscovery(new Date().toISOString()); } catch {} }
  return r;
}

// The manual refresh button and the daily cron run the sweep unconditionally
// (the user / the schedule explicitly asked) — they only stamp the shared
// time afterwards, so a later app open does not re-run it within the hour.
async function noteDiscoveryRan() {
  try { await setLastDiscovery(new Date().toISOString()); } catch {}
}
