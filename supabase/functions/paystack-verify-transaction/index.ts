import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({ reference: z.string().min(6).max(80) });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: claims } = await userClient.auth.getClaims(auth.replace("Bearer ", ""));
    if (!claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const { reference } = parsed.data;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: charge } = await admin.from("paystack_charges").select("*").eq("reference", reference).maybeSingle();
    if (!charge || charge.user_id !== userId) return json({ error: "Charge not found" }, 404);
    if (charge.status === "success") return json({ success: true, status: "success", already_credited: true });

    const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    });
    const verified = await res.json();
    const paystackStatus = verified?.data?.status;

    if (!res.ok || verified?.status !== true) {
      return json({ success: false, status: charge.status, message: verified?.message || "Verification pending" });
    }

    if (paystackStatus === "success") {
      const { data: updated } = await admin.from("paystack_charges").update({
        status: "success",
        completed_at: new Date().toISOString(),
        provider_response: verified.data,
        card_brand: verified.data?.authorization?.brand,
        card_last4: verified.data?.authorization?.last4,
      }).eq("reference", reference).neq("status", "success").select().maybeSingle();

      if (updated) {
        const ourCurrency = ["GHS", "ZAR"].includes(charge.currency) ? "USD" : charge.currency;
        await admin.rpc("fund_wallet", {
          _user_id: charge.user_id,
          _currency: ourCurrency,
          _amount: Number(charge.amount),
          _method: "card",
          _reference: reference,
        });
      }
      return json({ success: true, status: "success" });
    }

    if (["failed", "abandoned"].includes(paystackStatus)) {
      await admin.from("paystack_charges").update({
        status: "failed",
        failure_reason: verified?.data?.gateway_response || paystackStatus,
        provider_response: verified.data,
      }).eq("reference", reference).neq("status", "success");
      return json({ success: false, status: "failed", message: verified?.data?.gateway_response || "Payment failed" });
    }

    return json({ success: false, status: paystackStatus || charge.status, message: "Payment still pending" });
  } catch (e) {
    console.error("paystack-verify-transaction error", e);
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}