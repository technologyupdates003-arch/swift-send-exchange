// Create a BTC deposit invoice via NOWPayments. User pays BTC -> auto credit ABN.
// Requires secret NOWPAYMENTS_API_KEY (and optional NOWPAYMENTS_IPN_SECRET for webhook).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({ amount_usd: z.number().positive().min(1) });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NP_KEY = Deno.env.get("NOWPAYMENTS_API_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!NP_KEY) {
      return new Response(JSON.stringify({ error: "BTC processor not configured. Add NOWPAYMENTS_API_KEY in settings." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: claims } = await userClient.auth.getClaims(auth.replace("Bearer ", ""));
    if (!claims?.claims?.sub) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userId = claims.claims.sub as string;

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return new Response(JSON.stringify({ error: parsed.error.flatten() }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { amount_usd } = parsed.data;
    const orderId = `BTC-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const ipnUrl = `${SUPABASE_URL}/functions/v1/btc-webhook`;

    const npRes = await fetch("https://api.nowpayments.io/v1/payment", {
      method: "POST",
      headers: { "x-api-key": NP_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        price_amount: amount_usd, price_currency: "usd",
        pay_currency: "btc", order_id: orderId,
        order_description: `ABN purchase ${userId}`,
        ipn_callback_url: ipnUrl,
      }),
    });
    const data = await npRes.json();
    if (!npRes.ok) {
      return new Response(JSON.stringify({ error: data?.message || "Provider error", details: data }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    await admin.from("btc_deposits").insert({
      user_id: userId,
      btc_address: data.pay_address,
      amount_btc: data.pay_amount,
      amount_usd,
      status: "awaiting_deposit",
      provider: "nowpayments",
      provider_payment_id: String(data.payment_id),
      provider_response: data,
    });

    return new Response(JSON.stringify({
      success: true,
      pay_address: data.pay_address,
      pay_amount_btc: data.pay_amount,
      amount_usd,
      payment_id: data.payment_id,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("btc-deposit-init error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});