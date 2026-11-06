// POST /api/auth/google — exchange a Google authorization code for an ID token
// and verify it with Google. This is the REAL Google OAuth flow (authorization-code
// grant); the frontend opens the real Google account-chooser popup via Google
// Identity Services and posts the code here. Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const { code, redirectUri } = req.body || {};
  if (!code) return res.status(400).json({ ok: false, error: 'code is required' });
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ ok: false, error: 'Google OAuth is not configured on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)' });
  }
  try {
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
