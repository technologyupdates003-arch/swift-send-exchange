// Paystack webhook: verifies signature, credits wallet on charge.success, updates transfers.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-paystack-signature",
};

const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const raw = await req.text();
    const signature = req.headers.get("x-paystack-signature");
    const expected = createHmac("sha512", PAYSTACK_SECRET).update(raw).digest("hex");
    if (signature !== expected) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const event = JSON.parse(raw);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    console.log("paystack webhook:", event.event, event.data?.reference);

    if (event.event === "charge.success") {
      const ref = event.data.reference;
      const { data: charge } = await admin.from("paystack_charges").select("*").eq("reference", ref).maybeSingle();
      if (charge && charge.status !== "success") {
        await admin.from("paystack_charges").update({
          status: "success",
          completed_at: new Date().toISOString(),
          provider_response: event.data,
          card_brand: event.data.authorization?.brand,
          card_last4: event.data.authorization?.last4,
        }).eq("reference", ref);
        const ourCurrency = ["GHS", "ZAR"].includes(charge.currency) ? "USD" : charge.currency;
        await admin.rpc("fund_wallet", {
          _user_id: charge.user_id, _currency: ourCurrency, _amount: charge.amount,
          _method: "card", _reference: ref,
        });
      }
    }

    if (event.event === "transfer.success" || event.event === "transfer.failed" || event.event === "transfer.reversed") {
      const ref = event.data.reference;
      const newStatus = event.event === "transfer.success" ? "success" : event.event === "transfer.failed" ? "failed" : "reversed";
      const { data: transfer } = await admin.from("paystack_transfers").select("*").eq("reference", ref).maybeSingle();
      if (transfer && transfer.status !== newStatus) {
        await admin.from("paystack_transfers").update({
          status: newStatus,
          completed_at: new Date().toISOString(),
          provider_response: event.data,
          failure_reason: newStatus === "failed" ? event.data.reason : null,
        }).eq("reference", ref);
        if (newStatus === "failed" || newStatus === "reversed") {
          // refund wallet
          await admin.rpc("fund_wallet", {
            _user_id: transfer.user_id, _currency: transfer.currency,
            _amount: Number(transfer.amount), _method: "refund", _reference: `RFD-${ref}`,
          });
          if (transfer.withdrawal_id) {
            await admin.from("withdrawal_requests").update({ status: "failed" }).eq("id", transfer.withdrawal_id);
          }
        } else if (newStatus === "success" && transfer.withdrawal_id) {
          await admin.from("withdrawal_requests").update({ status: "completed", processed_at: new Date().toISOString() }).eq("id", transfer.withdrawal_id);
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("paystack-webhook error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
