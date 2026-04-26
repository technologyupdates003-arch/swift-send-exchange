// Paystack /charge — direct card flow. Handles initial charge AND step submissions
// (PIN, OTP, phone, birthday). Card data is forwarded to Paystack and never stored.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Either the initial charge body OR a step-submit body
const CardSchema = z.object({
  number: z.string().regex(/^\d{12,19}$/),
  cvv: z.string().regex(/^\d{3,4}$/),
  expiry_month: z.string().regex(/^\d{1,2}$/),
  expiry_year: z.string().regex(/^\d{2,4}$/),
});
const Body = z.object({
  amount: z.number().positive().optional(),
  currency: z.enum(["NGN", "USD", "GHS", "ZAR", "KES"]).optional(),
  card: CardSchema.optional(),
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

async function paystack(path: string, body: Record<string, unknown>) {
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
    if (!PAYSTACK_SECRET) {
      return json({ success: false, status: "failed", message: "Paystack not configured" }, 503);
    }
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: claims } = await userClient.auth.getClaims(auth.replace("Bearer ", ""));
    if (!claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;
    const email = (claims.claims.email as string) || `${userId}@user.local`;

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const { amount, currency, card, pin, otp, phone, birthday, reference: refIn } = parsed.data;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const isStep = Boolean(refIn && (pin || otp || phone || birthday));

    // ===== STEP SUBMISSION (existing reference) =====
    if (isStep) {
      const psPath = otp ? "/charge/submit_otp"
        : pin ? "/charge/submit_pin"
        : phone ? "/charge/submit_phone"
        : "/charge/submit_birthday";
      const psBody: Record<string, unknown> = { reference: refIn };
      if (otp) psBody.otp = otp;
      if (pin) psBody.pin = pin;
      if (phone) psBody.phone = phone;
      if (birthday) psBody.birthday = birthday;
      const r = await paystack(psPath, psBody);
      return await finalize(admin, r, refIn!, userId, currency || "NGN", null);
    }

    // ===== INITIAL CHARGE =====
    if (!amount || !currency || !card) {
      return json({ error: "amount, currency, card required" }, 400);
    }

    // Block frozen / inactive accounts upstream
    const { data: profile } = await admin.from("profiles").select("account_status").eq("id", userId).maybeSingle();
    if (profile && profile.account_status !== "active") {
      return json({ success: false, status: "failed", message: `Account ${profile.account_status}. Contact support.` }, 403);
    }

    const reference = `PSC-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const last4 = card.number.slice(-4);
    const subunits = Math.round(amount * 100);

    // Validate expiry locally to surface friendly error
    const mm = parseInt(card.expiry_month, 10);
    const yyFull = card.expiry_year.length === 2 ? 2000 + parseInt(card.expiry_year, 10) : parseInt(card.expiry_year, 10);
    const now = new Date();
    const expEnd = new Date(yyFull, mm, 0, 23, 59, 59);
    if (mm < 1 || mm > 12 || expEnd < now) {
      await admin.from("paystack_charges").insert({
        user_id: userId, reference, amount, currency, status: "failed",
        card_last4: last4, failure_reason: "Card expired",
      });
      return json({ success: false, status: "failed", reference, message: "Card expired", gateway_response: "Card expired" });
    }

    const payload = {
      email, amount: subunits, currency, reference,
      card: {
        number: card.number, cvv: card.cvv,
        expiry_month: card.expiry_month.padStart(2, "0"),
        expiry_year: String(yyFull),
      },
    };

    await admin.from("paystack_charges").insert({
      user_id: userId, reference, amount, currency, status: "pending", card_last4: last4,
    });

    const r = await paystack("/charge", payload);
    return await finalize(admin, r, reference, userId, currency, amount);
  } catch (e) {
    console.error("paystack-charge-card error", e);
    return json({ success: false, status: "failed", message: String(e?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function finalize(
  admin: any,
  r: { ok: boolean; status: number; data: any },
  reference: string,
  userId: string,
  currency: string,
  initialAmount: number | null,
) {
  const psStatus = r.data?.data?.status ?? r.data?.status;
  const psReference = r.data?.data?.reference ?? reference;
  const display_text = r.data?.data?.display_text ?? r.data?.message;
  const gatewayResponse = r.data?.data?.gateway_response;
  const psMessage = r.data?.message;

  let ourStatus = "pending";
  let nextAction: string | null = null;
  let redirect: string | null = null;

  if (psStatus === "success") ourStatus = "success";
  else if (psStatus === "failed" || psStatus === "abandoned" || psStatus === "reversed") ourStatus = "failed";
  else if (psStatus === "send_pin") nextAction = "pin";
  else if (psStatus === "send_otp") nextAction = "otp";
  else if (psStatus === "send_phone") nextAction = "phone";
  else if (psStatus === "send_birthday") nextAction = "birthday";
  else if (psStatus === "open_url") { nextAction = "3ds"; redirect = r.data?.data?.url; }
  else if (psStatus === "pay_offline") nextAction = "offline";

  // Paystack returned a clear error (HTTP non-2xx and no progressive next step)
  if (!r.ok && !nextAction && ourStatus !== "success") ourStatus = "failed";

  // Pull existing row to know amount / currency for credit
  const { data: existing } = await admin.from("paystack_charges").select("amount,currency,status").eq("reference", psReference).maybeSingle();
  const amount = existing?.amount ?? initialAmount;
  const ccy = existing?.currency ?? currency;

  const friendlyReason = ourStatus === "failed"
    ? (gatewayResponse || psMessage || "Card declined by issuer")
    : null;

  await admin.from("paystack_charges").update({
    status: ourStatus,
    next_action: nextAction,
    provider_response: r.data,
    card_brand: r.data?.data?.authorization?.brand,
    completed_at: ourStatus === "success" ? new Date().toISOString() : null,
    failure_reason: friendlyReason,
    updated_at: new Date().toISOString(),
  }).eq("reference", psReference);

  // Credit wallet on success (idempotent — webhook re-check guards against double credit)
  if (ourStatus === "success" && amount && existing?.status !== "success") {
    const ourCurrency = ccy === "GHS" || ccy === "ZAR" ? "USD" : ccy;
    await admin.rpc("fund_wallet", {
      _user_id: userId, _currency: ourCurrency, _amount: Number(amount),
      _method: "card", _reference: psReference,
    });
  }

  return json({
    success: ourStatus === "success" || Boolean(nextAction),
    reference: psReference,
    status: ourStatus,
    next_action: nextAction,
    display_text,
    redirect,
    message: friendlyReason || display_text || psMessage,
    gateway_response: gatewayResponse,
  });
}
