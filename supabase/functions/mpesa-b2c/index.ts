// Safaricom Daraja B2C: send KES to a phone. Triggered by withdraw_to_mpesa or send_to_mpesa.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import forge from "npm:node-forge@1.3.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({ payout_id: z.string().uuid() });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CONSUMER_KEY = Deno.env.get("MPESA_CONSUMER_KEY")!;
const CONSUMER_SECRET = Deno.env.get("MPESA_CONSUMER_SECRET")!;
const SHORTCODE = Deno.env.get("MPESA_SHORTCODE")!;
const INITIATOR_NAME = Deno.env.get("MPESA_INITIATOR_NAME")!;
const INITIATOR_PASSWORD = Deno.env.get("MPESA_INITIATOR_PASSWORD")!;
const BASE = "https://api.safaricom.co.ke";

// Production cert (Safaricom). For sandbox, swap to sandbox cert.
const MPESA_CERT = `-----BEGIN CERTIFICATE-----
MIIGgDCCBWigAwIBAgIKMvrulAAAAARG5DANBgkqhkiG9w0BAQsFADBbMRMwEQYK
CZImiZPyLGQBGRYDbmV0MRkwFwYKCZImiZPyLGQBGRYJc2FmYXJpY29tMSkwJwYD
VQQDEyBTYWZhcmljb20gSW50ZXJuYWwgSXNzdWluZyBDQSAwMzAeFw0yNDA0MTYw
NzI3MTNaFw0yNTA0MTYwNzI3MTNaMIGNMQswCQYDVQQGEwJLRTEQMA4GA1UECBMH
TmFpcm9iaTEQMA4GA1UEBxMHTmFpcm9iaTEaMBgGA1UEChMRU2FmYXJpY29tIFBM
QyBQbGMxEzARBgNVBAsTClRlY2hub2xvZ3kxKTAnBgNVBAMTIGFwaWdlZS5hcGlj
YWxsZXIuc2FmYXJpY29tLmNvLmtlMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB
CgKCAQEAoknIb5Tm1hxOVdFsOejAs6veAai32Zv442BLuOGkFKUeCUM2s0K8XEsU
t6BP25rQGNlTCTEqfdtRrym6bt5k0fTDscf0yMCoYzaxTh1mejg8rPO6bD8MJB0c
FWRUeLEyWjMeEPsYVSJFv7T58IdAn7/RhkrpBl1dT7SmIZfNVkIlD35+Cxgab+u7
+c7dHh6mWguEEoE3NbV7Xjl60zbD/Buvmu6i9EYz+27jNVPI6pRXHvp+ajIzTSsi
eD8Ztz1eoC9mphErasAGpMbR1sba9bM6hjw4tyTWnJDz7RdQQmnsW1NfFdYdK0qD
RKUX7SG6rQkBqVhndFve4SDFRq6wvQIDAQABo4IDJDCCAyAwHwYDVR0RBBgwFoIU
YXBpY2FsbGVyLnNhZmFyaWNvbS5jb20wHQYDVR0OBBYEFG2wycrgEBPFzPUZVjh8
v9cgVUMtMB8GA1UdIwQYMBaAFOsy1E9+YJo6mCBjug1evuh5dF8lMIIBOwYDVR0f
BIIBMjCCAS4wggEqoIIBJqCCASKGgdZsZGFwOi8vL0NOPVNhZmFyaWNvbSUyMElu
dGVybmFsJTIwSXNzdWluZyUyMENBJTIwMDMsQ049U1ZEVDNJU1NDQTAxLENOPUNE
UCxDTj1QdWJsaWMlMjBLZXklMjBTZXJ2aWNlcyxDTj1TZXJ2aWNlcyxDTj1Db25m
aWd1cmF0aW9uLERDPXNhZmFyaWNvbSxEQz1uZXQ/Y2VydGlmaWNhdGVSZXZvY2F0
aW9uTGlzdD9iYXNlP29iamVjdENsYXNzPWNSTERpc3RyaWJ1dGlvblBvaW50hkdo
dHRwOi8vY3JsLnNhZmFyaWNvbS5jby5rZS9TYWZhcmljb20lMjBJbnRlcm5hbCUy
MElzc3VpbmclMjBDQSUyMDAzLmNybDCB+gYIKwYBBQUHAQEEge0wgeowgbcGCCsG
AQUFBzAChoGqbGRhcDovLy9DTj1TYWZhcmljb20lMjBJbnRlcm5hbCUyMElzc3Vp
bmclMjBDQSUyMDAzLENOPUFJQSxDTj1QdWJsaWMlMjBLZXklMjBTZXJ2aWNlcyxD
Tj1TZXJ2aWNlcyxDTj1Db25maWd1cmF0aW9uLERDPXNhZmFyaWNvbSxEQz1uZXQ/
Y0FDZXJ0aWZpY2F0ZT9iYXNlP29iamVjdENsYXNzPWNlcnRpZmljYXRpb25BdXRo
b3JpdHkwLgYIKwYBBQUHMAGGImh0dHA6Ly9vY3NwLnNhZmFyaWNvbS5jby5rZS9v
Y3NwMA4GA1UdDwEB/wQEAwIFoDA9BgkrBgEEAYI3FQcEMDAuBiYrBgEEAYI3FQiH
8/JNgu2QFIWhgz+CieKQOoSGiTmCkOgRhrnuCQIBZAIBAjATBgNVHSUEDDAKBggr
BgEFBQcDATAbBgkrBgEEAYI3FQoEDjAMMAoGCCsGAQUFBwMBMA0GCSqGSIb3DQEB
CwUAA4IBAQA9wd2c4PgNIfuGAOiWKVYpzc7SD33mdUdYO5FfKkGWVKM/jQR0N84/
EZPIcFqEZi4MZxwgTjIrh3ICeWyxX1HpbZWcXfSJZDOJrkj4fXl5TcN5ZYbJp51c
fGyGJiL/YtncjY7vtNSEaqdjAU2cQX/NNQbfn8L/4yV3wfwj/FXk5d/rg6+WxV6h
cCYtCoMlTqFn50LZuoVHb3dFyoyyQIqIjV0R6+B6FA9o8WD1eqnLAAHmpLyaFR1g
hHSZ+hflhBwUEpv1gLRRZyJq1adH5l5MLaDKw31TGNtNw9bvCkLQqvrMfO7epmlP
1lhf4/yRWxuuKW5+L1bz8NtZUAuQ97Cp
-----END CERTIFICATE-----`;

async function getAccessToken() {
  const creds = btoa(`${CONSUMER_KEY}:${CONSUMER_SECRET}`);
  const res = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${creds}` },
  });
  if (!res.ok) throw new Error(`Daraja auth failed: ${res.status}`);
  const data = await res.json();
  return data.access_token as string;
}

// RSA / PKCS1 encrypt initiator password with M-Pesa public key cert (using node-forge)
function encryptInitiator(password: string): string {
  const cert = forge.pki.certificateFromPem(MPESA_CERT);
  const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
  const encrypted = publicKey.encrypt(password, "RSAES-PKCS1-V1_5");
  return forge.util.encode64(encrypted);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: claims } = await userClient.auth.getClaims(auth.replace("Bearer ", ""));
    if (!claims?.claims?.sub) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return new Response(JSON.stringify({ error: parsed.error.flatten() }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { payout_id } = parsed.data;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: payout } = await admin.from("mpesa_payouts").select("*").eq("id", payout_id).maybeSingle();
    if (!payout) return new Response(JSON.stringify({ error: "Payout not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (payout.status !== "pending") return new Response(JSON.stringify({ error: "Payout not pending" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const token = await getAccessToken();
    const securityCredential = await encryptInitiator(INITIATOR_PASSWORD);
    const callbackBase = `${SUPABASE_URL}/functions/v1/mpesa-b2c-callback`;

    const body = {
      InitiatorName: INITIATOR_NAME,
      SecurityCredential: securityCredential,
      CommandID: "BusinessPayment",
      Amount: Math.round(Number(payout.amount)),
      PartyA: SHORTCODE,
      PartyB: payout.phone_number.replace(/\D/g, ""),
      Remarks: "AbanRemit payout",
      QueueTimeOutURL: `${callbackBase}?type=timeout&id=${payout_id}`,
      ResultURL: `${callbackBase}?type=result&id=${payout_id}`,
      Occasion: payout_id.slice(0, 20),
    };

    const res = await fetch(`${BASE}/mpesa/b2c/v3/paymentrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    await admin.from("mpesa_payouts").update({
      reference: data?.ConversationID || data?.OriginatorConversationID,
      provider_response: data,
      status: res.ok && data?.ResponseCode === "0" ? "processing" : "failed",
    }).eq("id", payout_id);

    if (!res.ok || data?.ResponseCode !== "0") {
      // Refund
      await admin.rpc("fund_wallet", {
        _user_id: payout.user_id, _currency: "KES",
        _amount: Number(payout.amount) + Number(payout.fee || 0),
        _method: "refund", _reference: `RFD-${payout_id}`,
      });
      return new Response(JSON.stringify({ error: data?.errorMessage || data?.ResponseDescription || "B2C failed", details: data }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, conversation_id: data?.ConversationID }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("mpesa-b2c error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
