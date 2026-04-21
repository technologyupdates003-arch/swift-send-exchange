// Initialize a VirtualPay funding flow: card checkout OR bank-transfer instructions.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { vpRequest } from "../_shared/virtualpay.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({
  flow: z.enum(["card", "bank_transfer"]),
  amount: z.number().positive().max(10_000_000),
  currency: z.enum(["USD", "EUR", "GBP", "KES", "NGN"]),
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
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { flow, amount, currency } = parsed.data;
    const reference = `VP-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
    const admin = createClient(url, service);

    // Get user email for the checkout
    const { data: prof } = await admin.from("profiles").select("email, full_name").eq("id", u.user.id).maybeSingle();
    const origin = req.headers.get("origin") || req.headers.get("referer") || "";
    const callback_url = `${origin}/transactions?ref=${reference}`;

    const vp = await vpRequest(flow === "card" ? "/payments/checkout" : "/payments/bank-transfer", {
      reference,
      amount,
      currency,
      method: flow === "card" ? "card" : "bank_transfer",
      customer: { email: prof?.email, name: prof?.full_name || "Customer" },
      callback_url,
      webhook_url: `${url}/functions/v1/virtualpay-webhook`,
    });

    await admin.from("virtualpay_transactions").insert({
      user_id: u.user.id, reference, flow, amount, currency,
      status: vp.ok ? "pending" : "failed",
      checkout_url: vp.data?.checkout_url || vp.data?.payment_url || null,
      bank_details: flow === "bank_transfer" ? (vp.data?.bank || vp.data?.bank_details || null) : null,
      provider_reference: vp.data?.transaction_id || vp.data?.reference || null,
      provider_response: vp.data,
    });

    if (!vp.ok) {
      return new Response(JSON.stringify({ error: vp.data?.message || vp.data?.error || `VirtualPay ${vp.status}`, details: vp.data }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true, reference,
      checkout_url: vp.data?.checkout_url || vp.data?.payment_url || null,
      bank_details: flow === "bank_transfer" ? (vp.data?.bank || vp.data?.bank_details || null) : null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
