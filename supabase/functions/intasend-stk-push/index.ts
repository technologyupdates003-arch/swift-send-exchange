// IntaSend STK Push for KES wallet funding (M-Pesa C2B).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({
  amount: z.number().positive(),
  phone: z.string().regex(/^(?:\+?254|0)?[17]\d{8}$/),
});

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTASEND_PUB = Deno.env.get("INTASEND_PUBLISHABLE_KEY")!;
const INTASEND_SECRET = Deno.env.get("INTASEND_SECRET_KEY")!;

function normalizePhone(p: string) {
  let s = p.replace(/\D/g, "");
  if (s.startsWith("0")) s = "254" + s.slice(1);
  if (!s.startsWith("254")) s = "254" + s;
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: claims } = await userClient.auth.getClaims(auth.replace("Bearer ", ""));
    if (!claims?.claims?.sub) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userId = claims.claims.sub as string;
    const email = claims.claims.email as string;

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return new Response(JSON.stringify({ error: parsed.error.flatten() }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { amount, phone } = parsed.data;
    const phoneNorm = normalizePhone(phone);
    const reference = `STK-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    await admin.from("mpesa_stk_requests").insert({
      user_id: userId, phone_number: phoneNorm, amount, reference, status: "pending",
    });

    const res = await fetch("https://payment.intasend.com/api/v1/payment/mpesa-stk-push/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-IntaSend-Public-API-Key": INTASEND_PUB,
        Authorization: `Bearer ${INTASEND_SECRET}`,
      },
      body: JSON.stringify({
        public_key: INTASEND_PUB,
        amount,
        phone_number: phoneNorm,
        email,
        api_ref: reference,
        currency: "KES",
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      await admin.from("mpesa_stk_requests").update({
        status: "failed", failure_reason: JSON.stringify(data), provider_response: data,
      }).eq("reference", reference);
      return new Response(JSON.stringify({ error: data?.detail || data?.errors || "STK push failed", details: data }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await admin.from("mpesa_stk_requests").update({
      invoice_id: data?.invoice?.invoice_id, provider_response: data,
    }).eq("reference", reference);

    return new Response(JSON.stringify({
      success: true, reference, invoice_id: data?.invoice?.invoice_id,
      message: "STK push sent. Approve on your phone.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("intasend-stk-push error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
