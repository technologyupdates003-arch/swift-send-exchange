// Trigger a VirtualPay bank payout for an existing withdrawal_request (admin or owner).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { vpRequest } from "../_shared/virtualpay.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({ withdrawal_id: z.string().uuid() });

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

    const admin = createClient(url, service);
    const { data: wr } = await admin.from("withdrawal_requests").select("*, bank_accounts(*)").eq("id", parsed.data.withdrawal_id).maybeSingle();
    if (!wr) return new Response(JSON.stringify({ error: "Withdrawal not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (wr.user_id !== u.user.id) {
      const { data: isAdmin } = await admin.rpc("is_admin_any");
      if (!isAdmin) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (wr.status !== "pending") {
      return new Response(JSON.stringify({ error: `Already ${wr.status}` }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const reference = `VP-PAY-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
    const bank = (wr as any).bank_accounts;

    const vp = await vpRequest("/payouts/bank", {
      reference,
      amount: Number(wr.amount),
      currency: wr.currency,
      beneficiary: {
        name: bank.account_holder_name,
        account_number: bank.account_number,
        bank_name: bank.bank_name,
      },
      webhook_url: `${url}/functions/v1/virtualpay-webhook`,
    });

    await admin.from("virtualpay_transactions").insert({
      user_id: wr.user_id, reference, flow: "payout",
      amount: Number(wr.amount), currency: wr.currency,
      status: vp.ok ? "processing" : "failed",
      bank_account_id: wr.bank_account_id, withdrawal_id: wr.id,
      provider_reference: vp.data?.transaction_id || vp.data?.reference || null,
      provider_response: vp.data,
    });

    if (vp.ok) {
      await admin.from("withdrawal_requests").update({ status: "processing" }).eq("id", wr.id);
    }

    return new Response(JSON.stringify({ success: vp.ok, reference, details: vp.data }), {
      status: vp.ok ? 200 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
