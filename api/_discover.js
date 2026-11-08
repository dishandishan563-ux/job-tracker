// Auto-discovery of new government circulars — two passes, one sweep.
//
// Pass 1 — Teletalk: https://alljobs.teletalk.com.bd/api/v1/govt-jobs/list
// (public JSON API, no key, no login) — the same live list the Teletalk
// "Alljobs" site shows. One fetch returns every live government job post:
// org (with English name and short name), post title in Bangla + English,
// vacancy, published and deadline dates, and the Teletalk apply link.
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
// Pass 2 — Chattogram Port Authority (CPA): the port runs its own job
// portal, NOT Teletalk, so the Teletalk API never lists it. Its circular
// list is a plain JSON endpoint (DataTables server-side source, GET works
// with no login, no token):
//   https://cpadigital.gov.bd:5302/circular-list
// Each row gives circular number, publish date, application start/end
// dates and status. Only Active rows with a future end date become
// candidates. The list does NOT carry post titles or vacancy counts —
// those live behind a CSRF-protected POST (circular-dtl-list) that a
// serverless function cannot reliably call — so a CPA candidate carries
// one honest placeholder post, the circular number itself
// ("সার্কুলার ০৪/২০২৬"), with count null ("উল্লেখ নেই"). The admin can
// enrich it later via the server-side edit; and a seeded CPA entry with
// full post detail dedupes against the sweep candidate (same host +
// deadline), so the rich entry always wins.
//
// NOT automated (checked, with reasons — do not retry blindly):
// - Bangladesh Bank e-recruitment (erecruitment.bb.org.bd): behind an F5
//   bot-defense challenge (TSPD); a serverless fetch only gets the
//   challenge shell, no circular data.
// - BPSC (bpsc.teletalk.com.bd): NOT in the Teletalk alljobs API, and the
//   portal itself does not answer from a serverless fetch (connection
//   fails even with a 30s timeout and a browser User-Agent).
// - NIPORT (niport.gov.bd): the notice board is server-rendered, but the
//   recruitment notice carries NO deadline anywhere except inside its
//   attached PDF, and the tracker cannot build an entry without a
//   deadline (dedupe key, countdown and sorting all need one) — never
//   guess one. These three still need the admin add (now server-side, so
//   everyone sees it) or the one-shot seed sync.
//
// Failure-proof by design: each pass runs in its own try/catch and the two
// fetches run in parallel — one source failing never breaks the other
// pass, the merge, or the /api/circulars response. Any fetch / parse / KV
// error returns { ok:false, ... } and never throws — the daily reminders
// and the site keep working even if a discovery source is down.
//
// Other listing sites were checked and rejected: alljobsbd.com sits behind
// a reCAPTCHA bot check (unfetchable from a serverless function) and
// chakri.com returns a Cloudflare error. Teletalk's own API is the one
// reliable, structured source.
const { getCirculars, saveCirculars, mergeCirculars, dhakaDate, allKeys, getDeletedKeys, addDeletedKeys, isPastGrace, getLastDiscovery, setLastDiscovery, keyFor, kvAvailable, kvGet, kvSMembers, sendPush, wasPushSent, markPushSent } = require('./_store');
const { sanitizePrefs, circularMatchesPrefs } = require('./_prefs');

const DISCOVER_URL = 'https://alljobs.teletalk.com.bd/api/v1/govt-jobs/list?skipLimit=YES';
const DISCOVER_TIMEOUT_MS = 8000;

// Chattogram Port Authority circular list (see header comment). Plain GET,
// no login, no token. Response: { draw, recordsTotal, recordsFiltered,
// data: [ { circular_id, circular_number, circular_date, app_start_date,
// app_end_date, active_yn, action } ] } — the text fields arrive wrapped
// in <a ...>...</a> tags; dates look like "2026-12-08  11:59 PM".
const CPA_LIST_URL = 'https://cpadigital.gov.bd:5302/circular-list';
const CPA_TIMEOUT_MS = 6000;
const CPA_APPLY_URL = 'https://cpadigital.gov.bd/jobs';
const CPA_ORG = 'চট্টগ্রাম বন্দর কর্তৃপক্ষ (সিপিএ)';
const CPA_ORG_EN = 'Chattogram Port Authority';

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

// Strip the <a> wrappers the CPA list puts around its fields, and decode
// the few entities that can appear in them. Never throws.
function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

// CPA end dates look like "2026-12-08  11:59 PM" (Dhaka wall-clock time).
// Build an ISO string with the +06:00 offset so the date survives the
// server's UTC clock unchanged. A bare date means end of that day, Dhaka
// time — the tracker's usual deadline convention. Returns '' when the
// value cannot be parsed.
function parseCpaEndDate(s) {
  const t = stripTags(s);
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm]))?/);
  if (!m) return '';
  let hh = 23, mm = 59;
  if (m[4] !== undefined) {
    hh = parseInt(m[4], 10);
    mm = parseInt(m[5], 10);
    const ap = m[6].toUpperCase();
    if (ap === 'PM' && hh < 12) hh += 12;
    if (ap === 'AM' && hh === 12) hh = 0;
  }
  if (hh > 23 || mm > 59) return '';
  const iso = `${m[1]}-${m[2]}-${m[3]}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+06:00`;
  return isNaN(new Date(iso)) ? '' : iso;
}

// One circular from one CPA list row. Returns null when the row is
// incomplete (no circular number, no valid end date) or not Active —
// incomplete rows are skipped, never guessed.
function buildCpaCandidate(row) {
  if (!row || typeof row !== 'object') return null;
  const number = stripTags(row.circular_number);
  if (!number) return null;
  const status = stripTags(row.active_yn).toLowerCase();
  if (status && status !== 'active') return null;
  const deadlineIso = parseCpaEndDate(row.app_end_date);
  if (!deadlineIso || isNaN(new Date(deadlineIso))) return null;
  return {
    id: `auto-cpa-${dhakaDate(deadlineIso)}`,
    org: CPA_ORG,
    orgEn: CPA_ORG_EN,
    type: 'port',
    typeBn: 'বন্দর / কর্তৃপক্ষ',
    totalPosts: null,
    hscPosts: null,
    grade: null,
    fee: null,
    deadline: new Date(deadlineIso).toISOString(),
    salary: '',
    age: 'অফিসিয়াল সার্কুলারে দেখুন',
    districts: 'অফিসিয়াল সার্কুলারে দেখুন',
    applyUrl: CPA_APPLY_URL,
    source: 'secondary',
    // Post titles/counts live behind a CSRF-protected POST — not fetchable
    // from here. One honest placeholder: the circular number itself.
    posts: [{ title: `সার্কুলার ${number}`, count: null, grade: null, qualification: null, typingBn: 0, typingEn: 0 }],
    addedAt: new Date().toISOString(),
    autoAdded: true,
  };
}

// CPA pass: fetch the circular list, build candidates. Returns
// { ok, candidates, skipped, total, error } — never throws, never touches KV.
async function runCpaDiscovery() {
  try {
    const r = await fetch(CPA_LIST_URL, {
      headers: { 'User-Agent': 'JobTracker-Discover/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(CPA_TIMEOUT_MS),
    });
    if (!r.ok) return { ok: false, candidates: [], skipped: 0, total: 0, error: 'HTTP ' + r.status };
    const data = await r.json().catch(() => null);
    const rows = data && Array.isArray(data.data) ? data.data : null;
    if (!rows) return { ok: false, candidates: [], skipped: 0, total: 0, error: 'bad_response' };
    const now = new Date();
    const candidates = [];
    let skipped = 0;
    for (const row of rows) {
      const c = buildCpaCandidate(row);
      if (!c || new Date(c.deadline) < now) { skipped++; continue; }
      candidates.push(c);
    }
    return { ok: true, candidates, skipped, total: rows.length, error: null };
  } catch (e) {
    return { ok: false, candidates: [], skipped: 0, total: 0, error: String((e && e.message) || e) };
  }
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

// Teletalk pass: fetch, group, build candidates. Returns
// { ok, candidates, skipped, total, checked, error } — never throws, never
// touches KV. The short-name map lets the merger apply host aliases.
async function runTeletalkDiscovery() {
  try {
    const r = await fetch(DISCOVER_URL, {
      headers: { 'User-Agent': 'JobTracker-Discover/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS),
    });
    if (!r.ok) return { ok: false, candidates: [], skipped: 0, total: 0, checked: 0, error: 'HTTP ' + r.status };
    const data = await r.json().catch(() => null);
    const jobs = data && Array.isArray(data.govtJobs) ? data.govtJobs : null;
    if (!jobs) return { ok: false, candidates: [], skipped: 0, total: 0, checked: 0, error: 'bad_response' };
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
    for (const js of groups.values()) {
      const c = buildCandidate(js);
      if (!c || new Date(c.deadline) < now) { skipped++; continue; }
      shortByCandidate.set(c, c._short);
      delete c._short;
      candidates.push(c);
    }
    return { ok: true, candidates, skipped, total: candidates.length, checked: groups.size, error: null, _shortByCandidate: shortByCandidate };
  } catch (e) {
    return { ok: false, candidates: [], skipped: 0, total: 0, checked: 0, error: String((e && e.message) || e) };
  }
}

// ---------- New-circular push notifications ----------
// When a sweep adds a NEW circular, users who (a) have a pushToken,
// (b) have pushEnabled !== false, (c) have reminders ON, and (d) whose
// selected reminder categories match that circular (exactly the same
// rules as the reminder emails — api/_prefs.js; nothing selected = all;
// an auto-added circular matches a TYPE filter only, never a
// qualification filter) get ONE Bengali push per circular. Dedupe is
// per (user, circular) in KV (jt:push-sent), so a later sweep never
// re-pushes the same circular. No FCM_SERVER_KEY env var = silently
// skipped (no key is ever logged or committed). This runs ONLY when the
// caller asks (opts.notifyNew) — daily-check and online-check do;
// GET /api/circulars (discoverIfDue) never does, so opening the app or
// website alone never sends a push.
function bnDigits(n) { return String(n).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[+d]); }

function pushTextFor(c) {
  const total = c.totalPosts == null ? 'উল্লেখ নেই' : bnDigits(c.totalPosts) + 'টি';
  let dl = '';
  try { dl = new Date(c.deadline).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { dl = ''; }
  return {
    title: `নতুন সার্কুলার: ${c.org}`,
    body: `মোট ${total} পদ${dl ? ` • শেষ: ${dl}` : ''}`,
  };
}

async function notifyNewCirculars(added) {
  const out = { sent: 0, skipped: 0, users: 0 };
  if (!Array.isArray(added) || !added.length) return out;
  if (!kvAvailable() || !process.env.FCM_SERVER_KEY) return out;
  let recipients = [];
  try { recipients = await kvSMembers('jt:recipients'); } catch { return out; }
  for (const rawEmail of recipients) {
    const email = String(rawEmail || '').trim().toLowerCase();
    if (!email) continue;
    let rec = null;
    try { rec = await kvGet(keyFor('jt:user', email)); } catch { continue; }
    const data = rec && rec.data;
    if (!data || typeof data.pushToken !== 'string' || !data.pushToken) continue;
    if (data.profile && data.profile.pushEnabled === false) continue;
    if (data.profile && data.profile.remindersEnabled === false) continue;
    const prefs = (data.profile && data.profile.reminders) ? sanitizePrefs(data.profile.reminders) : null;
    const userHash = keyFor('jt:user', email).split(':').pop();
    out.users++;
    for (const c of added) {
      if (!circularMatchesPrefs(c, prefs)) { out.skipped++; continue; }
      const tag = `new:${c.id}`;
      try { if (await wasPushSent(userHash, tag)) { out.skipped++; continue; } } catch {}
      const { title, body } = pushTextFor(c);
      const r = await sendPush(data.pushToken, title, body, { circularId: String(c.id || ''), org: String(c.org || ''), type: 'new_circular', url: 'https://job-tracker-official-68.vercel.app/' });
      if (r && r.ok) {
        out.sent++;
        try { await markPushSent(userHash, tag); } catch {}
      } else { out.skipped++; }
    }
  }
  return out;
}

// Run one discovery sweep: both passes in parallel, prune expired entries
// from KV (3-day grace), then merge the new ones into the KV list.
// Returns a summary; never throws.
// Top-level fields stay backward compatible (ok, added, skipped, total,
// checked, addedIds); per-source detail lives under `sources`, pruned
// (grace পেরিয়ে KV থেকে মুছে ফেলা) count under `pruned`.
// opts.notifyNew (daily-check / online-check only): new circulars also
// trigger a push per matching user — see notifyNewCirculars above.
async function runDiscovery(opts) {
  const notifyNew = !!(opts && opts.notifyNew);
  try {
    // অ্যাডমিন সার্ভার থেকে মুছে ফেলা সার্কুলার আর ফিরবে না — মুছে ফেলার
    // চাবিগুলো (host+তারিখ / id+তারিখ) KV-তে jt:deleted-circulars-এ থাকে।
    let deletedKeys = new Set();
    try { deletedKeys = new Set(await getDeletedKeys()); } catch {}
    const [tt, cpa] = await Promise.all([runTeletalkDiscovery(), runCpaDiscovery()]);
    let skipped = (tt ? tt.skipped : 0) + (cpa ? cpa.skipped : 0);
    const list = await getCirculars();
    if (!list) return { ok: false, added: 0, skipped, total: 0, checked: 0, error: 'kv_not_configured', sources: { teletalk: stripPass(tt), cpa: stripPass(cpa) } };
    // মেয়াদ শেষ সার্কুলার KV থেকে মুছে ফেলি — শুধু grace (৩ দিন) পেরিয়ে
    // গেলে। মুছে ফেলার চাবিগুলো jt:deleted-circulars-এ রেখে দিই, যাতে সুইপ
    // বা সিড-সিঙ্ক সেটা আর ফিরিয়ে আনতে না পারে। grace-এর মধ্যে থাকা
    // মেয়াদোত্তীর্ণ এন্ট্রি KV-তে থাকে — তালিকা এন্ডপয়েন্ট সেটা লুকায়
    // (api/circulars.js), শুধু grace পেরোলে মুছে যায়। Deadline নেই এমন
    // এন্ট্রি কখনো মোছা হয় না। সুইপের সূত্র দুটোই ডাউন থাকলেও prune চলে —
    // মেয়াদোত্তীর্ণ সার্কুলার তালিকায় ফিরবে না।
    let pruned = [];
    try {
      const nowMs = Date.now();
      const keep = [];
      for (const c of list) {
        if (isPastGrace(c, nowMs)) pruned.push(c); else keep.push(c);
      }
      if (pruned.length) {
        try { await addDeletedKeys(pruned.flatMap(c => allKeys(c))); } catch {}
        list.length = 0;
        list.push(...keep);
      }
    } catch {}
    if (!tt.ok && !cpa.ok) {
      if (pruned.length) { try { await saveCirculars(list); } catch {} }
      return { ok: false, added: 0, skipped, total: 0, checked: 0, pruned: pruned.length, prunedIds: pruned.map(p => p.id), error: `teletalk:${tt.error || '?'}; cpa:${cpa.error || '?'}`, sources: { teletalk: stripPass(tt), cpa: stripPass(cpa) } };
    }
    const now = new Date();
    const candidates = [];
    const shortByCandidate = (tt && tt._shortByCandidate) || new Map();
    for (const c of [...(tt.candidates || []), ...(cpa.candidates || [])]) {
      if (new Date(c.deadline) < now) { skipped++; continue; }
      if (allKeys(c).some(k => deletedKeys.has(k))) { skipped++; continue; }
      candidates.push(c);
    }
    const added = mergeCirculars(list, candidates, cand => {
      const alias = ALIASES[shortByCandidate.get(cand)];
      return alias ? [`id:${alias}|${dhakaDate(cand.deadline)}`] : [];
    });
    if (added.length || pruned.length) await saveCirculars(list);
    let push = null;
    if (notifyNew && added.length) {
      try { push = await notifyNewCirculars(added); } catch { push = { sent: 0, skipped: 0, users: 0 }; }
    }
    return {
      ok: true,
      added: added.length,
      skipped,
      total: candidates.length,
      checked: (tt.checked || 0) + (cpa.total || 0),
      addedIds: added.map(a => a.id),
      pruned: pruned.length,
      prunedIds: pruned.map(p => p.id),
      push,
      sources: { teletalk: stripPass(tt), cpa: stripPass(cpa) },
    };
  } catch (e) {
    return { ok: false, added: 0, skipped: 0, total: 0, error: String((e && e.message) || e) };
  }
}

// A pass result without the (potentially large) candidate list, for the
// summary payload the API routes return.
function stripPass(p) {
  if (!p) return { ok: false, added: 0, error: 'no_result' };
  const { _shortByCandidate, candidates, ...rest } = p;
  return { ...rest, candidates: (candidates || []).length };
}

module.exports = { runDiscovery, runTeletalkDiscovery, runCpaDiscovery, buildCandidate, buildCpaCandidate, parseCpaEndDate, stripTags, classify, notifyNewCirculars, pushTextFor, DISCOVER_URL, CPA_LIST_URL, ALIASES, discoverIfDue, noteDiscoveryRan };

// ---------- Throttled auto-discovery (app/website opens) ----------
// GET /api/circulars is called on every app + website open. A sweep on
// every open would hammer the discovery sources, so this runs one only when
// the last sweep (from any trigger) is more than ~1 hour old. The timestamp
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
