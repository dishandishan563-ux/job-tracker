// GET /api/config — public client config (Google OAuth client ID only, never the secret).
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
};
