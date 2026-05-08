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

function fmtDateTime(d = new Date()): string {
  // Kenya time
  const opts: Intl.DateTimeFormatOptions = { timeZone: "Africa/Nairobi", day: "2-digit", month: "2-digit", year: "2-digit" };
  const date = new Intl.DateTimeFormat("en-GB", opts).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Nairobi", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  return `${date} at ${time}`;
}

function buildMessage(event: string, data: any): string {
  const cur = data.currency || "KES";
  const amt = `${cur} ${Number(data.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const bal = data.balance != null ? `${cur} ${Number(data.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;
  const ref = data.reference ? String(data.reference).toUpperCase() : "";
  const when = fmtDateTime();
  const wallet = data.wallet_number ? ` Wallet ${data.wallet_number}.` : "";
  const balLine = bal ? ` New AbanRemit balance is ${bal}.` : "";
  const fee = data.fee != null ? ` Transaction cost ${cur} ${Number(data.fee).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}.` : "";
  const dailyLimit = ` Amount you can transact within the day is ${cur} 500,000.00.`;

  switch (event) {
    case "wallet_funded":
      return `${ref} Confirmed. ${amt} received into your AbanRemit wallet on ${when}.${wallet}${balLine}${fee}${dailyLimit}`;
    case "wallet_withdraw":
      return `${ref} Confirmed. ${amt} withdrawn from your AbanRemit wallet${data.phone ? ` to ${data.phone}` : ""} on ${when}.${wallet}${balLine}${fee}${dailyLimit}`;
    case "wallet_withdraw_failed":
      return `AbanRemit: Your withdrawal of ${amt} on ${when} failed. ${data.reason || "Please try again."}${ref ? ` Ref: ${ref}.` : ""}`;
    case "wallet_send":
      return `${ref} Confirmed. ${amt} sent${data.recipient ? ` to ${data.recipient}` : ""} on ${when}.${wallet}${balLine}${fee}${dailyLimit}`;
    case "wallet_receive":
      return `${ref} Confirmed. ${amt} received${data.sender ? ` from ${data.sender}` : ""} on ${when}.${wallet}${balLine}`;
    default:
      return `AbanRemit: ${event} ${amt} on ${when}.${ref ? ` Ref: ${ref}.` : ""}${balLine}`;
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
      const { data: prof } = await admin.from("profiles").select("phone_number").eq("id", user_id).maybeSingle();
      phone = normalizePhone(prof?.phone_number);
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
