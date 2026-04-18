// MOCK IntaSend STK push: instantly funds KES wallet.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({
  phone: z.string().regex(/^(?:\+?254|0)?[17]\d{8}$/),
  amount: z.number().positive(),
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
    const { phone, amount } = parsed.data;

    const admin = createClient(url, service);
    const reference = `STK-${crypto.randomUUID().slice(0, 12)}`;

    // TODO: Real IntaSend: POST https://api.intasend.com/api/v1/payment/mpesa-stk-push/. Webhook -> fund_wallet.
    await admin.from("intasend_transactions").insert({
      user_id: u.user.id, reference, amount, phone_number: phone,
      transaction_type: "stk_push", status: "completed",
    });
    await admin.rpc("fund_wallet", {
      _user_id: u.user.id, _currency: "KES", _amount: amount, _method: "mpesa", _reference: reference,
    });

    return new Response(JSON.stringify({ success: true, reference }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
