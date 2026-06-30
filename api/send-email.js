export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'Email engine not configured (missing key)' });
  }

  // Pull the email fields PLUS optional logging fields.
  // Old callers that only send to/subject/html/text still work fine.
  const {
    to, subject, html, text, replyTo,
    sentBy, source, recipientName, recipientPhone, city,
    clientId, service, estimate, hstIncluded, threadId, notes
  } = req.body || {};

  if (!to || !subject || (!html && !text)) {
    return res.status(400).json({ error: 'Need to, subject, and a message body' });
  }

  const recipientEmail = Array.isArray(to) ? to.join(', ') : to;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization':
