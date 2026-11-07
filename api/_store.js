// Shared server-side store for the Vercel build — Vercel KV (Upstash REST API).
//
// Why this exists: until now every user's data (profile, shortlist, applications,
// settings) lived only in the browser's localStorage, so it vanished on another
// device/browser or after clearing site data. This module is the one place the
// API routes read/write durable user data.
//
// Backend: Vercel KV via its REST API — plain fetch, no extra dependency.
// Enable it in the Vercel dashboard: Storage -> Create Database -> KV, then the
// KV_REST_API_URL / KV_REST_API_TOKEN env vars are added to the project
// automatically (Production). No code change is needed after that.
//
// If KV is NOT configured, kvAvailable() is false and the routes that depend on
// it answer { stored: false, reason: 'kv_not_configured' } — the client then
// keeps working exactly as before with localStorage only, and the README says
// so honestly. Serverless /tmp is NOT used as a store here: it is per-instance
// on Vercel and would silently lose one user's data on another instance.
//
// Keys (email is never stored in plain text in a key):
//   jt:user:<sha256(email)>     -> JSON { email, name, data, updatedAt }
//   jt:account:<sha256(email)>  -> JSON { name, hash }  (manual-login accounts;
//                                  hash = SHA-256 of "email:password", the
//                                  plain password never reaches the server)
//   jt:recipients               -> SET of Gmails that signed in (daily reminders)
const crypto = require('crypto');

function kvAvailable() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function keyFor(prefix, email) {
  const h = crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');
  return `${prefix}:${h}`;
}

async function kvFetch(path, init) {
  const url = String(process.env.KV_REST_API_URL).replace(/\/$/, '') + path;
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, ...(init && init.headers ? init.headers : {}) },
    signal: AbortSignal.timeout(5000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `KV request failed (${r.status})`);
  return data;
}

async function kvGet(key) {
  const data = await kvFetch(`/get/${encodeURIComponent(key)}`);
  if (data.result === null || data.result === undefined) return null;
  try { return JSON.parse(data.result); } catch { return data.result; }
}

// Upstash REST accepts the value in the URL path; large values are sent as the
// POST body instead (same endpoint, raw body = value).
async function kvSet(key, value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  await kvFetch(`/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: raw,
  });
}

async function kvSAdd(key, member) {
  await kvFetch(`/sadd/${encodeURIComponent(key)}/${encodeURIComponent(member)}`, { method: 'POST' });
}

async function kvSMembers(key) {
  const data = await kvFetch(`/smembers/${encodeURIComponent(key)}`);
  return Array.isArray(data.result) ? data.result : [];
}

// Sent-email log — a KV LIST, newest first (LPUSH), capped at the latest 50.
// Only recipient + subject + time + source are stored: never the email body,
// never a password or secret. Used by /api/daily-check and /api/send-now so
// the admin "See Email" view can show what was actually sent.
const SENT_LOG_KEY = 'jt:sent-emails';
const SENT_LOG_MAX = 50;

async function kvLPush(key, value) {
  await kvFetch(`/lpush/${encodeURIComponent(key)}/${encodeURIComponent(typeof value === 'string' ? value : JSON.stringify(value))}`, { method: 'POST' });
}

async function kvLRange(key, start, stop) {
  const data = await kvFetch(`/lrange/${encodeURIComponent(key)}/${start}/${stop}`);
  return Array.isArray(data.result) ? data.result : [];
}

async function kvLTrim(key, start, stop) {
  await kvFetch(`/ltrim/${encodeURIComponent(key)}/${start}/${stop}`, { method: 'POST' });
}

// Record one successfully sent email. Never throws: logging must not break
// the send itself, and silently no-ops when KV is not configured.
async function logSentEmail(to, subject, source) {
  if (!kvAvailable()) return;
  try {
    await kvLPush(SENT_LOG_KEY, { to: String(to).trim().toLowerCase(), subject: String(subject), sentAt: new Date().toISOString(), source: source || 'manual' });
    await kvLTrim(SENT_LOG_KEY, 0, SENT_LOG_MAX - 1);
  } catch {}
}

// Read the sent-email log, newest first. Entries are JSON strings in the list.
async function getSentEmails() {
  if (!kvAvailable()) return [];
  try {
    const raw = await kvLRange(SENT_LOG_KEY, 0, SENT_LOG_MAX - 1);
    return raw.map(s => { try { return JSON.parse(s); } catch { return null; } })
      .filter(e => e && e.to && e.subject && e.sentAt)
      .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)));
  } catch { return []; }
}

// ---------- Circulars list (KV) ----------
// The list used to be read straight from data/circulars.json, so a new circular
// only appeared after a code push. Now the list lives in KV under jt:circulars:
// on first use it is seeded from data/circulars.json (deduped), and the
// auto-discovery sweep (api/_discover.js) adds new circulars to it.
// If KV is not configured, getCirculars() returns null and callers fall back
// to the JSON file — the site keeps working, just without auto-add.
const CIRCULARS_KEY = 'jt:circulars';

// Org name without a parenthetical suffix, lowercased — "(এনএসডি)" / "(NSD)"
// style suffixes must not create a second copy of the same org.
function normalizeOrg(s) {
  return String(s || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function hostOf(url) {
  try { return new URL(String(url)).hostname.toLowerCase(); } catch { return ''; }
}

// Deadline date in Asia/Dhaka (YYYY-MM-DD) — the same circular is listed with
// "2026-11-08T23:59:00+06:00" in the seed and "2026-11-08T10:00:00.000Z"
// (UTC) by Teletalk; both are 2026-11-08 in Dhaka time.
function dhakaDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  try { return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }); } catch { return d.toISOString().slice(0, 10); }
}

// Dedupe key for one circular. Primary: Teletalk host + deadline date — the
// seed lists a portal root (https://cag.teletalk.com.bd) and Teletalk lists
// a deep link (https://cag.teletalk.com.bd/cag202611/), but the host and the
// deadline date are the same circular. Fallback when there is no usable
// host: normalized org name + deadline date.
function dedupeKey(c) {
  const host = hostOf(c.applyUrl);
  const dl = dhakaDate(c.deadline);
  if (host && dl) return `host:${host}|${dl}`;
  return `org:${normalizeOrg(c.org)}|${dl}`;
}

function dedupeList(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter(c => {
    const k = dedupeKey(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// All identity keys of one entry: the dedupe key plus id+deadline (an entry
// re-added under a different host still matches by its stable id).
function allKeys(c) {
  const keys = [dedupeKey(c)];
  const dl = dhakaDate(c.deadline);
  if (c.id && dl) keys.push(`id:${c.id}|${dl}`);
  return keys;
}

// Add candidates to the list, skipping anything already there. extraKeysFor
// (optional) returns extra identity keys for a candidate — used for known
// same-circular-different-host cases (e.g. Patuakhali: seed links the
// district site, Teletalk links the teletalk portal).
function mergeCirculars(list, candidates, extraKeysFor) {
  const seen = new Set();
  for (const c of list) for (const k of allKeys(c)) seen.add(k);
  const added = [];
  for (const cand of candidates) {
    const keys = [...allKeys(cand), ...(extraKeysFor ? extraKeysFor(cand) : [])];
    if (keys.some(k => seen.has(k))) continue;
    keys.forEach(k => seen.add(k));
    list.push(cand);
    added.push(cand);
  }
  return added;
}

async function getCirculars() {
  if (!kvAvailable()) return null;
  try {
    const stored = await kvGet(CIRCULARS_KEY);
    if (Array.isArray(stored) && stored.length) return stored;
    const seed = dedupeList(require('../data/circulars.json'));
    await kvSet(CIRCULARS_KEY, seed);
    return seed;
  } catch { return null; }
}

async function saveCirculars(list) {
  if (!kvAvailable()) return false;
  await kvSet(CIRCULARS_KEY, list);
  return true;
}

module.exports = { keyFor, kvAvailable, kvFetch, kvGet, kvSet, kvSAdd, kvSMembers, logSentEmail, getSentEmails, CIRCULARS_KEY, normalizeOrg, hostOf, dhakaDate, dedupeKey, dedupeList, mergeCirculars, getCirculars, saveCirculars };
