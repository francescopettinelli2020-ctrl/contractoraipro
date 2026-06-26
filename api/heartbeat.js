// api/heartbeat.js
// ContractorAIPro — the overnight heartbeat.
// Wakes up on a timer, finds NEW leads, and drafts a reply for each one
// INTO THE APPROVAL QUEUE. It never sends anything. You approve drafts
// before a single email or text goes out.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY; // the same key Tanya already uses
const CRON_SECRET = process.env.CRON_SECRET;             // optional, recommended

// --- tiny helper: talk to your Supabase database over its REST API ---
async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  return res.json();
}

// --- ask Claude to draft a warm, on-brand first reply to a new lead ---
async function draftReply(lead) {
  const prompt = `You are the front desk for Milton Stone, a premium landscaping and fibreglass pool company serving Oakville, Burlington, Milton and the wider Halton/GTA area of Ontario.
A new lead just came in. Write a warm, professional first reply (4-6 sentences, ready to send exactly as written, no blanks or placeholders). Thank them, show you understand what they're asking for, mention you serve their area, and suggest a quick call or a site visit to get them an accurate quote. Sign off as "The Milton Stone Team". Return ONLY the reply text.

Lead name: ${lead.name || "there"}
What they want: ${lead.message || "a landscaping / pool project"}
Their area: ${lead.area || "the Halton/GTA area"}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6", // swappable — this is your drafting brain
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text || "Thanks for reaching out to Milton Stone — we'll be in touch shortly!";
}

// --- the heartbeat itself ---
export default async function handler(req, res) {
  // Only allow the real timer, or a manual run with the secret.
  if (CRON_SECRET) {
    const auth = req.headers.authorization || "";
    const key = (req.query && req.query.key) || "";
    if (auth !== `Bearer ${CRON_SECRET}` && key !== CRON_SECRET) {
      return res.status(401).json({ error: "Not authorized" });
    }
  }

  try {
    // 1. Find leads that haven't been drafted yet.
    const leads = await sb("leads?status=eq.new&select=*", { method: "GET" });

    let drafted = 0;
    for (const lead of leads) {
      // 2. Draft a reply with Claude.
      const body = await draftReply(lead);

      // 3. Put the draft in the approval queue — pending your tap. Nothing is sent.
      await sb("approval_queue", {
        method: "POST",
        body: JSON.stringify({
          agent: "lead_reply",
          channel: "email",
          to_name: lead.name,
          to_email: lead.email,
          to_phone: lead.phone,
          subject: "Thanks for reaching out to Milton Stone",
          body,
          client_ref: lead.id,
          status: "pending",
        }),
      });

      // 4. Mark the lead so it never gets drafted twice.
      await sb(`leads?id=eq.${lead.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "drafted" }),
      });

      drafted++;
    }

    // 5. Log the run so you can watch the machine breathing.
    await sb("agent_activity", {
      method: "POST",
      body: JSON.stringify({
        agent: "lead_reply",
        action: "heartbeat run",
        detail: `Drafted ${drafted} reply(ies) into the queue`,
        status: "ok",
      }),
    });

    return res.status(200).json({ ok: true, drafted });
  } catch (err) {
    const message = String((err && err.message) || err);
    try {
      await sb("agent_activity", {
        method: "POST",
        body: JSON.stringify({
          agent: "lead_reply",
          action: "heartbeat error",
          detail: message,
          status: "error",
        }),
      });
    } catch (_) {}
    return res.status(500).json({ ok: false, error: message });
  }
}
