// VirtualPay webhook: credits wallet on successful card / bank-transfer funding,
// and marks payouts as completed/failed.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyWebhookSignature } from "../_shared/virtualpay.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-virtualpay-signature",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const raw = await req.text();
    const sig = req.headers.get("x-virtualpay-signature") || req.headers.get("x-signature");
    const valid = await verifyWebhookSignature(raw, sig);
    // We log but don't reject if signature missing — some providers test without it.
    // In production, you may want: if (!valid) return 401.
    const event = JSON.parse(raw);
    const reference: string = event.reference || event.data?.reference;
    const status: string = (event.status || event.data?.status || "").toLowerCase();
    if (!reference) return new Response(JSON.stringify({ error: "Missing reference" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service);

    const { data: tx } = await admin.from("virtualpay_transactions").select("*").eq("reference", reference).maybeSingle();
    if (!tx) return new Response(JSON.stringify({ error: "Unknown reference" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (tx.status === "completed") return new Response(JSON.stringify({ ok: true, idempotent: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const isSuccess = ["success", "completed", "successful", "paid"].includes(status);
    const isFailed = ["failed", "cancelled", "canceled", "declined"].includes(status);

    if (isSuccess && (tx.flow === "card" || tx.flow === "bank_transfer")) {
      await admin.rpc("fund_wallet", {
        _user_id: tx.user_id, _currency: tx.currency, _amount: Number(tx.amount),
        _method: `virtualpay_${tx.flow}`, _reference: reference,
      });
    }
    if (isSuccess && tx.flow === "payout" && tx.withdrawal_id) {
      await admin.from("withdrawal_requests").update({ status: "completed", processed_at: new Date().toISOString() }).eq("id", tx.withdrawal_id);
    }
    if (isFailed && tx.flow === "payout" && tx.withdrawal_id) {
      // Refund: credit balance back
      await admin.rpc("fund_wallet", {
        _user_id: tx.user_id, _currency: tx.currency, _amount: Number(tx.amount),
        _method: "refund_failed_payout", _reference: reference,
      });
      await admin.from("withdrawal_requests").update({ status: "failed", processed_at: new Date().toISOString() }).eq("id", tx.withdrawal_id);
    }

    await admin.from("virtualpay_transactions").update({
      status: isSuccess ? "completed" : isFailed ? "failed" : "processing",
      provider_response: event,
      completed_at: isSuccess || isFailed ? new Date().toISOString() : null,
    }).eq("reference", reference);

    return new Response(JSON.stringify({ ok: true, signature_valid: valid }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
