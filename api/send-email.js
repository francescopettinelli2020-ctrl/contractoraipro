export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'Email engine not configured (missing key)' });
  }

  try {
    const { to, subject, html, text, replyTo } = req.body || {};

    if (!to || !subject || (!html && !text)) {
      return res.status(400).json({ error: 'Need to, subject, and a message body' });
    }

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Milton Stone <info@miltonstone.ca>',
        to: Array.isArray(to) ? to : [to],
        subject: subject,
        html: html || undefined,
        text: text || undefined,
        reply_to: replyTo || 'info@miltonstone.ca',
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({ error: data.message || 'Send failed', detail: data });
    }

    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    return res.status(500).json({ error: 'Send error', detail: String(err) });
  }
}
