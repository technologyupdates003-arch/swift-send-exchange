// Polls IntaSend for STK status and credits the wallet if complete.
// Acts as a backup when webhook isn't yet configured or is delayed.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({ reference: z.string().min(4) });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTASEND_PUB = Deno.env.get("INTASEND_PUBLISHABLE_KEY")!;
const INTASEND_SECRET = Deno.env.get("INTASEND_SECRET_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: claims } = await userClient.auth.getClaims(auth.replace("Bearer ", ""));
    if (!claims?.claims?.sub) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userId = claims.claims.sub as string;

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return new Response(JSON.stringify({ error: parsed.error.flatten() }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { reference } = parsed.data;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: row } = await admin.from("mpesa_stk_requests")
      .select("*").eq("reference", reference).maybeSingle();
    if (!row) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (row.user_id !== userId) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (row.status === "completed") {
      return new Response(JSON.stringify({ success: true, status: "completed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const invoiceId = row.invoice_id || (row.provider_response as any)?.invoice?.invoice_id;
    if (!invoiceId) {
      return new Response(JSON.stringify({ success: false, status: row.status, message: "Awaiting prompt" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const res = await fetch("https://payment.intasend.com/api/v1/payment/status/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-IntaSend-Public-API-Key": INTASEND_PUB,
        Authorization: `Bearer ${INTASEND_SECRET}`,
      },
      body: JSON.stringify({ invoice_id: invoiceId }),
    });
    const data = await res.json();
    const state = (data?.invoice?.state || data?.state || "").toUpperCase();
    console.log("intasend-status", reference, state);

    if (state === "COMPLETE" || state === "COMPLETED") {
      // Atomically flip + credit
      const { data: updated } = await admin.from("mpesa_stk_requests")
        .update({ status: "completed", completed_at: new Date().toISOString(), provider_response: data })
        .eq("reference", reference).eq("status", "pending").select().maybeSingle();
      if (updated) {
        await admin.rpc("fund_wallet", {
          _user_id: row.user_id, _currency: "KES", _amount: Number(row.amount),
          _method: "mpesa_stk", _reference: reference,
        });
      }
      return new Response(JSON.stringify({ success: true, status: "completed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (state === "FAILED" || state === "RETRY") {
      await admin.from("mpesa_stk_requests").update({
        status: "failed", failure_reason: data?.invoice?.failed_reason || data?.failed_reason, provider_response: data,
      }).eq("reference", reference).eq("status", "pending");
      return new Response(JSON.stringify({ success: false, status: "failed", message: data?.invoice?.failed_reason || "Failed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ success: false, status: "pending", state, message: "Waiting for confirmation" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("intasend-status error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});