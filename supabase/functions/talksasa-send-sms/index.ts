// Send SMS via TalkSasa BulkSMS API on transaction events.
// https://bulksms.talksasa.com/api/v3/
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TALKSASA_TOKEN = Deno.env.get("TALKSASA_API_TOKEN")!;
const TALKSASA_SENDER = Deno.env.get("TALKSASA_SENDER_ID") || "TalkSasa";

function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  let s = String(p).replace(/\D/g, "");
  if (s.startsWith("0")) s = "254" + s.slice(1);
  if (s.startsWith("7") || s.startsWith("1")) s = "254" + s;
  return s.length >= 10 ? s : null;
}

function buildMessage(event: string, data: any): string {
  const amt = `${data.currency || "KES"} ${Number(data.amount || 0).toLocaleString()}`;
  const ref = data.reference ? ` Ref: ${data.reference}.` : "";
  switch (event) {
    case "wallet_funded":
      return `AbanRemit: Your wallet has been funded with ${amt}.${ref} Thank you.`;
    case "wallet_withdraw":
      return `AbanRemit: ${amt} has been withdrawn from your wallet.${ref}`;
    case "wallet_send":
      return `AbanRemit: You sent ${amt}${data.recipient ? ` to ${data.recipient}` : ""}.${ref}`;
    case "wallet_receive":
      return `AbanRemit: You received ${amt}${data.sender ? ` from ${data.sender}` : ""}.${ref}`;
    default:
      return `AbanRemit: ${event} ${amt}.${ref}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!TALKSASA_TOKEN) throw new Error("TALKSASA_API_TOKEN not set");
    const body = await req.json();
    const { user_id, event, phone: phoneIn } = body;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Resolve phone: use provided, else from profile
    let phone = normalizePhone(phoneIn);
    if (!phone && user_id) {
      const { data: prof } = await admin.from("profiles").select("phone").eq("id", user_id).maybeSingle();
      phone = normalizePhone(prof?.phone);
    }
    if (!phone) {
      console.log("talksasa: no phone for user", user_id);
      return new Response(JSON.stringify({ ok: false, skipped: "no_phone" }), { headers: corsHeaders });
    }

    const message = buildMessage(event, body);
    const res = await fetch("https://bulksms.talksasa.com/api/v3/sms/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${TALKSASA_TOKEN}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        recipient: phone,
        sender_id: TALKSASA_SENDER,
        type: "plain",
        message,
      }),
    });
    const out = await res.json().catch(() => ({}));
    console.log("talksasa response", res.status, JSON.stringify(out).slice(0, 300));
    return new Response(JSON.stringify({ ok: res.ok, provider: out }), {
      status: res.ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("talksasa-send-sms error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
