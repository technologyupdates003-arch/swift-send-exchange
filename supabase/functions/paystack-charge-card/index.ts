// Paystack /charge — direct card flow. Requires Paystack to have whitelisted /charge for this account
// (PCI-DSS SAQ-D). Card data is forwarded straight to Paystack and never stored.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ChargeBody = z.object({
  amount: z.number().positive(),
  currency: z.enum(["NGN", "USD", "GHS", "ZAR", "KES"]),
  card: z.object({
    number: z.string().regex(/^\d{12,19}$/),
    cvv: z.string().regex(/^\d{3,4}$/),
    expiry_month: z.string().regex(/^\d{1,2}$/),
    expiry_year: z.string().regex(/^\d{2,4}$/),
  }),
  pin: z.string().regex(/^\d{4}$/).optional(),
  otp: z.string().min(1).optional(),
  phone: z.string().optional(),
  birthday: z.string().optional(),
  reference: z.string().optional(),
});

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY")!;

async function paystack(path: string, body: any) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: claims } = await userClient.auth.getClaims(auth.replace("Bearer ", ""));
    if (!claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = claims.claims.sub as string;
    const email = claims.claims.email as string;

    const parsed = ChargeBody.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { amount, currency, card, pin, otp, phone, birthday, reference: refIn } = parsed.data;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const reference = refIn || `PSC-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const last4 = card.number.slice(-4);

    // Subunits (kobo/cents)
    const subunits = Math.round(amount * 100);

    // Build payload — Paystack /charge expects either fresh card or auth response
    const payload: any = {
      email,
      amount: subunits,
      currency,
      reference,
      card: {
        number: card.number,
        cvv: card.cvv,
        expiry_month: card.expiry_month.padStart(2, "0"),
        expiry_year: card.expiry_year.length === 2 ? `20${card.expiry_year}` : card.expiry_year,
      },
    };
    if (pin) payload.pin = pin;
    if (otp) payload.otp = otp;
    if (phone) payload.phone = phone;
    if (birthday) payload.birthday = birthday;

    // Upsert pending charge row
    if (!refIn) {
      await admin.from("paystack_charges").insert({
        user_id: userId, reference, amount, currency, status: "pending",
        card_last4: last4,
      });
    }

    const psPath = otp ? "/charge/submit_otp" : pin ? "/charge/submit_pin" : phone ? "/charge/submit_phone" : birthday ? "/charge/submit_birthday" : "/charge";
    const psBody = otp || pin || phone || birthday ? { reference, ...(otp && { otp }), ...(pin && { pin }), ...(phone && { phone }), ...(birthday && { birthday }) } : payload;

    const r = await paystack(psPath, psBody);
    const status = r.data?.data?.status ?? r.data?.status;
    const psReference = r.data?.data?.reference ?? reference;
    const display_text = r.data?.data?.display_text ?? r.data?.message;
    const gatewayResponse = r.data?.data?.gateway_response;
    const psMessage = r.data?.message;

    // Map Paystack status -> our status
    let ourStatus = "pending";
    let nextAction: string | null = null;
    let redirect: string | null = null;
    if (status === "success") ourStatus = "success";
    else if (status === "failed") ourStatus = "failed";
    else if (status === "send_pin") nextAction = "pin";
    else if (status === "send_otp") nextAction = "otp";
    else if (status === "send_phone") nextAction = "phone";
    else if (status === "send_birthday") nextAction = "birthday";
    else if (status === "open_url") { nextAction = "3ds"; redirect = r.data?.data?.url; }
    else if (status === "pay_offline") nextAction = "offline";
    // If Paystack returned a non-OK HTTP or a clearly bad gateway response without next-action, treat as failed
    if (!r.ok && !nextAction && ourStatus !== "success") ourStatus = "failed";

    await admin.from("paystack_charges")
      .update({
        status: ourStatus,
        next_action: nextAction,
        provider_response: r.data,
        card_brand: r.data?.data?.authorization?.brand,
        completed_at: ourStatus === "success" ? new Date().toISOString() : null,
        failure_reason: ourStatus === "failed" ? (gatewayResponse || psMessage) : null,
      })
      .eq("reference", psReference);

    // Credit wallet on success (webhook will also do it; this is faster UX)
    if (ourStatus === "success") {
      const ourCurrency = currency === "GHS" || currency === "ZAR" ? "USD" : currency;
      await admin.rpc("fund_wallet", {
        _user_id: userId, _currency: ourCurrency, _amount: amount,
        _method: "card", _reference: psReference,
      });
    }

    return new Response(JSON.stringify({
      success: r.ok && ourStatus !== "failed",
      reference: psReference,
      status: ourStatus,
      next_action: nextAction,
      display_text,
      redirect,
      message: gatewayResponse || psMessage,
      gateway_response: gatewayResponse,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("paystack-charge-card error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
