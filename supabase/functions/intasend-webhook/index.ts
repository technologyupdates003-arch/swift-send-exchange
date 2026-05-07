// IntaSend webhook: credits KES wallet on confirmed STK push.
// IntaSend signs with HMAC-SHA256 over body using your webhook challenge secret.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const event = await req.json();
    console.log("intasend webhook:", event?.state, event?.api_ref);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const reference = event?.api_ref;
    const state = (event?.state || "").toUpperCase();
    if (!reference) return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });

    const { data: row } = await admin.from("mpesa_stk_requests").select("*").eq("reference", reference).maybeSingle();
    if (!row || row.status === "completed") return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });

    // IntaSend quirk: sometimes sends state=FAILED with failed_code="0" and a real
    // mpesa_reference — this means M-Pesa actually succeeded. Treat as success.
    const failedCode = String(event?.failed_code ?? "");
    const mpesaRef = event?.mpesa_reference;
    const isActuallySuccess =
      state === "COMPLETE" || state === "COMPLETED" ||
      (failedCode === "0" && !!mpesaRef);

    if (isActuallySuccess) {
      const { data: updated } = await admin.from("mpesa_stk_requests").update({
        status: "completed", completed_at: new Date().toISOString(), provider_response: event,
      }).eq("reference", reference).neq("status", "completed").select().maybeSingle();
      if (updated) {
        await admin.rpc("fund_wallet", {
          _user_id: row.user_id, _currency: "KES", _amount: Number(row.amount),
          _method: "mpesa_stk", _reference: reference,
        });
        // Fire SMS notification (best-effort)
        try {
          await admin.functions.invoke("talksasa-send-sms", {
            body: {
              user_id: row.user_id,
              event: "wallet_funded",
              amount: Number(row.amount), currency: "KES",
              phone: event?.account, reference: mpesaRef || reference,
            },
          });
        } catch (e) { console.error("sms invoke err", e); }
      }
    } else if (state === "FAILED" || state === "RETRY") {
      await admin.from("mpesa_stk_requests").update({
        status: "failed", failure_reason: event?.failed_reason || event?.charges, provider_response: event,
      }).eq("reference", reference);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  } catch (e) {
    console.error("intasend-webhook error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
