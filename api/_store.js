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

module.exports = { keyFor, kvAvailable, kvFetch, kvGet, kvSet, kvSAdd, kvSMembers, logSentEmail, getSentEmails };
