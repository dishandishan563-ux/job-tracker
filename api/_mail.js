// Shared mail helper: sends from the official sender Gmail via SMTP.
// Env: GMAIL_USER (default jobtrackerbd@gmail.com), GMAIL_APP_PASSWORD.
// Never commit a real password — set it in Vercel > Settings > Environment Variables.
const nodemailer = require('nodemailer');

function transporter() {
  const user = process.env.GMAIL_USER || 'jobtrackerbd@gmail.com';
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!pass) throw new Error('GMAIL_APP_PASSWORD is not set');
  return nodemailer.createTransport({
    auth: { pass, user },
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
  });
}

async function sendMail({ to, subject, html, text }) {
  const from = process.env.GMAIL_USER || 'jobtrackerbd@gmail.com';
  const info = await transporter().sendMail({ from: `Job Tracker <${from}>`, html, subject, text, to });
  return info.messageId;
}

module.exports = { sendMail };
