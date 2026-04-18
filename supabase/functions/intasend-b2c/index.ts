// MOCK IntaSend B2C payout: marks payout as completed (replace with real API when keys are added).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({ payout_id: z.string().uuid() });

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
    const ref = `B2C-${crypto.randomUUID().slice(0, 12)}`;

    // TODO: Real IntaSend B2C call here.
    const { data: payout } = await admin.from("mpesa_payouts").select("*").eq("id", parsed.data.payout_id).maybeSingle();
    if (!payout) return new Response(JSON.stringify({ error: "Payout not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (payout.user_id !== u.user.id) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    await admin.from("mpesa_payouts").update({
      status: "completed", reference: ref, processed_at: new Date().toISOString(),
      provider_response: { mock: true },
    }).eq("id", parsed.data.payout_id);

    // Mark related pending transaction as completed (best effort)
    await admin.from("transactions").update({ status: "completed" })
      .eq("user_id", u.user.id).eq("status", "pending")
      .ilike("description", `%${payout.phone_number}%`);

    return new Response(JSON.stringify({ success: true, reference: ref }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
