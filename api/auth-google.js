// POST /api/auth/google — verify a Google sign-in and return the user's profile.
//
// The frontend uses Google Identity Services (google.accounts.id), whose callback
// delivers resp.credential — a Google ID token (JWT), NOT an authorization code.
// So this endpoint accepts EITHER:
//   1. { credential } — an ID token, verified directly with Google's tokeninfo
//      endpoint (aud must equal GOOGLE_CLIENT_ID, token must not be expired).
//      This is the path the live site actually uses. No client secret needed.
//   2. { code } — a real authorization code, exchanged at oauth2.googleapis.com/token
//      (kept for compatibility). Requires GOOGLE_CLIENT_SECRET.
// Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (only for the code path).
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const { code, credential, redirectUri } = req.body || {};
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(500).json({ ok: false, error: 'Google OAuth is not configured on the server (GOOGLE_CLIENT_ID)' });
  }
  try {
    // ---- Path 1: ID token from Google Identity Services ----
    if (credential) {
      const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
      const profile = await verifyRes.json();
      if (profile.error || !profile.email) return res.status(401).json({ error: 'Google token verification failed', ok: false });
      if (profile.aud !== process.env.GOOGLE_CLIENT_ID) return res.status(401).json({ error: 'Invalid token audience', ok: false });
      if (profile.exp && Number(profile.exp) * 1000 < Date.now()) return res.status(401).json({ error: 'Google token expired', ok: false });
      return res.status(200).json({ email: profile.email, name: profile.name, ok: true, picture: profile.picture });
    }
    // ---- Path 2: authorization code exchange (legacy/compat) ----
    if (!code) return res.status(400).json({ ok: false, error: 'credential or code is required' });
    if (!process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({ ok: false, error: 'Google OAuth is not configured on the server (GOOGLE_CLIENT_SECRET)' });
    }
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri || `${req.headers.origin || ''}/api/auth/google`,
    });
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', { body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, method: 'POST' });
    const tokens = await tokenRes.json();
    if (!tokens.id_token) return res.status(401).json({ error: 'Google token exchange failed', ok: false });
    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${tokens.id_token}`);
    const profile = await verifyRes.json();
    if (profile.aud !== process.env.GOOGLE_CLIENT_ID) return res.status(401).json({ error: 'Invalid token audience', ok: false });
    return res.status(200).json({ email: profile.email, name: profile.name, ok: true, picture: profile.picture });
  } catch (e) {
    return res.status(500).json({ error: e.message, ok: false });
  }
};
