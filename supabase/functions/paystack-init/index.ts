// MOCK Paystack init: instantly funds wallet (replace with real Paystack call when keys are added).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({
  amount: z.number().positive(),
  currency: z.enum(["USD", "EUR", "GBP", "KES", "NGN"]),
  last4: z.string().optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace("Bearer ", "");
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return new Response(JSON.stringify({ error: parsed.error.flatten() }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { amount, currency, last4 } = parsed.data;

    const admin = createClient(url, service);
    const reference = `PSK-${crypto.randomUUID().slice(0, 12)}`;

    // TODO: Real Paystack: POST https://api.paystack.co/charge with secret key. Webhook -> fund_wallet.
    // Mock: insert as completed and credit immediately.
    await admin.from("paystack_transactions").insert({
      user_id: u.user.id, reference, amount, currency,
      payment_method: `card${last4 ? ` ****${last4}` : ""}`, status: "completed",
    });
    await admin.rpc("fund_wallet", {
      _user_id: u.user.id, _currency: currency, _amount: amount, _method: "card", _reference: reference,
    });

    return new Response(JSON.stringify({ success: true, reference }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
