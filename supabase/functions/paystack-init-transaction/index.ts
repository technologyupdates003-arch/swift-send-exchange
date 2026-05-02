// Paystack Transaction Initialize — hosted checkout (works on LIVE by default).
// Returns an authorization_url that the user opens to enter card details on
// Paystack's PCI-compliant page. The webhook (paystack-webhook) credits the
// wallet on charge.success.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({
  amount: z.number().positive(),
  currency: z.enum(["NGN", "USD", "GHS", "ZAR", "KES"]),
  callback_url: z.string().url().optional(),
});

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!PAYSTACK_SECRET) return json({ error: "Paystack not configured" }, 503);
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: claims } = await userClient.auth.getClaims(auth.replace("Bearer ", ""));
    if (!claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;
    const email = (claims.claims.email as string) || `${userId}@user.local`;

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const { amount, currency, callback_url } = parsed.data;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: profile } = await admin.from("profiles").select("account_status").eq("id", userId).maybeSingle();
    if (profile && profile.account_status !== "active") {
      return json({ error: `Account ${profile.account_status}. Contact support.` }, 403);
    }

    const reference = `PSI-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const subunits = Math.round(amount * 100);

    await admin.from("paystack_charges").insert({
      user_id: userId, reference, amount, currency, status: "pending",
    });

    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email, amount: subunits, currency, reference,
        callback_url,
        metadata: { user_id: userId, our_currency: currency === "GHS" || currency === "ZAR" ? "USD" : currency },
        channels: ["card", "bank", "ussd", "qr", "mobile_money", "bank_transfer"],
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.status) {
      await admin.from("paystack_charges").update({
        status: "failed", failure_reason: data?.message || "Init failed",
      }).eq("reference", reference);
      return json({ error: data?.message || "Failed to initialize" }, 400);
    }

    return json({
      success: true,
      reference,
      authorization_url: data.data.authorization_url,
      access_code: data.data.access_code,
    });
  } catch (e) {
    console.error("paystack-init-transaction error", e);
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
