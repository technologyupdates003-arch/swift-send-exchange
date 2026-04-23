// Daraja B2C result/timeout callback. Updates mpesa_payouts; refunds on failure.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const payoutId = url.searchParams.get("id");
    const type = url.searchParams.get("type");
    const body = await req.json();
    console.log("mpesa-b2c-callback", type, payoutId, JSON.stringify(body).slice(0, 500));
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    if (!payoutId) return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    const { data: payout } = await admin.from("mpesa_payouts").select("*").eq("id", payoutId).maybeSingle();
    if (!payout) return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });

    const result = body?.Result;
    const code = result?.ResultCode;
    const success = code === 0 || code === "0";

    await admin.from("mpesa_payouts").update({
      status: success ? "completed" : "failed",
      processed_at: new Date().toISOString(),
      provider_response: body,
    }).eq("id", payoutId);

    // Update related transaction
    await admin.from("transactions").update({
      status: success ? "completed" : "failed",
    }).eq("user_id", payout.user_id)
      .eq("currency", "KES")
      .eq("status", "pending")
      .like("description", `%${payout.phone_number.slice(-9)}%`);

    if (!success) {
      // Refund (amount + fee)
      await admin.rpc("fund_wallet", {
        _user_id: payout.user_id, _currency: "KES",
        _amount: Number(payout.amount) + Number(payout.fee || 0),
        _method: "refund", _reference: `RFD-${payoutId}`,
      });
    }

    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("mpesa-b2c-callback error", e);
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), { headers: corsHeaders });
  }
});
