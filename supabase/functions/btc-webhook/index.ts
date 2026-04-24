// NOWPayments IPN. Verifies HMAC sig, then on 'finished' status credits ABN to the user
// using the AMM (aban_buy_abn equivalent path: convert USD value -> ABN via market).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IPN_SECRET = Deno.env.get("NOWPAYMENTS_IPN_SECRET");

function sortedStringify(obj: any): string {
  if (Array.isArray(obj)) return "[" + obj.map(sortedStringify).join(",") + "]";
  if (obj && typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    return "{" + keys.map(k => JSON.stringify(k) + ":" + sortedStringify(obj[k])).join(",") + "}";
  }
  return JSON.stringify(obj);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const raw = await req.text();
    if (IPN_SECRET) {
      const sig = req.headers.get("x-nowpayments-sig");
      const sortedRaw = sortedStringify(JSON.parse(raw));
      const expected = createHmac("sha512", IPN_SECRET).update(sortedRaw).digest("hex");
      if (sig !== expected) {
        return new Response(JSON.stringify({ error: "Invalid sig" }), { status: 401, headers: corsHeaders });
      }
    }
    const event = JSON.parse(raw);
    console.log("btc-webhook", event.payment_status, event.payment_id);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: row } = await admin.from("btc_deposits")
      .select("*").eq("provider_payment_id", String(event.payment_id)).maybeSingle();
    if (!row) return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });

    const status = event.payment_status;
    if (status === "finished" || status === "confirmed") {
      if (row.status === "completed") return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      // Credit USD wallet first, then trade USD -> ABN via AMM (admin-side, no PIN check).
      const usd = Number(event.actually_paid_at_fiat || row.amount_usd);
      await admin.rpc("fund_wallet", {
        _user_id: row.user_id, _currency: "USD", _amount: usd,
        _method: "btc", _reference: `BTC-${event.payment_id}`,
      });
      // Direct AMM swap by hitting the market table (mirrors aban_buy_abn but service role)
      const { data: market } = await admin.from("aban_market").select("*").eq("id", 1).maybeSingle();
      if (market) {
        const ra = Number(market.reserve_abn), ru = Number(market.reserve_usd);
        const k = ra * ru;
        const newRa = k / (ru + usd);
        const abnOut = ra - newRa;
        await admin.from("aban_market").update({
          reserve_abn: newRa, reserve_usd: ru + usd,
          total_volume_usd: Number(market.total_volume_usd) + usd,
          updated_at: new Date().toISOString(),
        }).eq("id", 1);
        // Debit USD, credit ABN
        await admin.rpc("fund_wallet", {
          _user_id: row.user_id, _currency: "ABN", _amount: abnOut,
          _method: "btc_swap", _reference: `BTC-${event.payment_id}`,
        });
        // Manually debit USD (fund_wallet only credits)
        const { data: wallet } = await admin.from("wallets")
          .select("balance").eq("user_id", row.user_id).eq("currency", "USD").maybeSingle();
        if (wallet) {
          await admin.from("wallets").update({ balance: Number(wallet.balance) - usd, updated_at: new Date().toISOString() })
            .eq("user_id", row.user_id).eq("currency", "USD");
        }
        await admin.from("btc_deposits").update({
          status: "completed", abn_credited: abnOut, txid: event.payin_hash,
          completed_at: new Date().toISOString(), provider_response: event,
        }).eq("id", row.id);
      }
    } else if (status === "failed" || status === "expired" || status === "refunded") {
      await admin.from("btc_deposits").update({
        status, provider_response: event,
      }).eq("id", row.id);
    } else {
      await admin.from("btc_deposits").update({ status, provider_response: event }).eq("id", row.id);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  } catch (e) {
    console.error("btc-webhook error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});