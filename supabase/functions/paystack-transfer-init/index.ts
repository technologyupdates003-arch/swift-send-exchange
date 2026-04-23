// Initiate a Paystack Transfer (NGN to Nigerian bank).
// 1) resolve account, 2) create or reuse transfer recipient, 3) initiate transfer.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({
  withdrawal_id: z.string().uuid(),
  bank_code: z.string().min(3).max(10),
});

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY")!;

async function ps(path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
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

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return new Response(JSON.stringify({ error: parsed.error.flatten() }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { withdrawal_id, bank_code } = parsed.data;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: w, error: wErr } = await admin.from("withdrawal_requests")
      .select("*, bank_accounts(*)").eq("id", withdrawal_id).maybeSingle();
    if (wErr || !w) return new Response(JSON.stringify({ error: "Withdrawal not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (w.user_id !== userId) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (w.currency !== "NGN") return new Response(JSON.stringify({ error: "Paystack transfers only support NGN" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const ba = (w as any).bank_accounts;

    // Reuse cached recipient if any
    let recipient_code: string | null = null;
    const { data: cached } = await admin.from("paystack_recipients")
      .select("recipient_code").eq("user_id", userId).eq("bank_account_id", ba.id).maybeSingle();
    if (cached) recipient_code = cached.recipient_code;

    if (!recipient_code) {
      const recRes = await ps("/transferrecipient", {
        method: "POST",
        body: JSON.stringify({
          type: "nuban",
          name: ba.account_holder_name,
          account_number: ba.account_number,
          bank_code,
          currency: "NGN",
        }),
      });
      if (!recRes.ok) {
        return new Response(JSON.stringify({ error: recRes.data?.message || "Failed to create recipient" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      recipient_code = recRes.data.data.recipient_code;
      await admin.from("paystack_recipients").insert({
        user_id: userId, bank_account_id: ba.id, recipient_code, bank_code,
      });
    }

    const reference = `PST-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const subunits = Math.round(Number(w.amount) * 100);

    await admin.from("paystack_transfers").insert({
      user_id: userId, withdrawal_id, bank_account_id: ba.id,
      amount: w.amount, currency: "NGN", reference, status: "pending",
    });

    const trRes = await ps("/transfer", {
      method: "POST",
      body: JSON.stringify({
        source: "balance",
        amount: subunits,
        recipient: recipient_code,
        reference,
        reason: "AbanRemit withdrawal",
      }),
    });

    const requires_otp = trRes.data?.data?.status === "otp" || trRes.data?.message?.toLowerCase?.()?.includes("otp");
    await admin.from("paystack_transfers").update({
      transfer_code: trRes.data?.data?.transfer_code,
      status: trRes.data?.data?.status === "success" ? "success" : requires_otp ? "otp_required" : trRes.ok ? "pending" : "failed",
      requires_otp,
      provider_response: trRes.data,
      failure_reason: !trRes.ok ? trRes.data?.message : null,
    }).eq("reference", reference);

    if (!trRes.ok && !requires_otp) {
      // refund
      await admin.rpc("fund_wallet", {
        _user_id: userId, _currency: "NGN", _amount: Number(w.amount),
        _method: "refund", _reference: `RFD-${reference}`,
      });
      await admin.from("withdrawal_requests").update({ status: "failed" }).eq("id", withdrawal_id);
      return new Response(JSON.stringify({ error: trRes.data?.message || "Transfer failed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      success: true,
      reference,
      transfer_code: trRes.data?.data?.transfer_code,
      requires_otp,
      status: trRes.data?.data?.status,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("paystack-transfer-init error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
