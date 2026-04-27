// Safaricom Daraja B2C: send KES to a phone. Triggered by withdraw_to_mpesa or send_to_mpesa.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

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

// Production cert - prefer secret MPESA_PRODUCTION_CERT (paste full PEM from Daraja portal).
// Falls back to embedded cert if not set (may be expired - check Daraja for latest).
const EMBEDDED_CERT = `-----BEGIN CERTIFICATE-----
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
const MPESA_CERT = (Deno.env.get("MPESA_PRODUCTION_CERT") || EMBEDDED_CERT).trim();

async function getAccessToken() {
  const creds = btoa(`${CONSUMER_KEY}:${CONSUMER_SECRET}`);
  const res = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${creds}` },
  });
  if (!res.ok) throw new Error(`Daraja auth failed: ${res.status}`);
  const data = await res.json();
  return data.access_token as string;
}

// ----- ASN.1 / DER helpers (no external deps) -----
// Parse one TLV: returns { tag, len, headerLen, value (offset) } at position p.
function readTLV(buf: Uint8Array, p: number) {
  const tag = buf[p];
  let len = buf[p + 1];
  let headerLen = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[p + 2 + i];
    headerLen = 2 + n;
  }
  return { tag, len, headerLen, valueOffset: p + headerLen };
}

// Walk a Certificate to extract the raw SubjectPublicKeyInfo DER bytes.
// Cert ::= SEQ { tbs SEQ { ...subjectPublicKeyInfo SEQ ... }, sigAlg, sigVal }
function extractSpkiFromCertDer(certDer: Uint8Array): Uint8Array {
  // Outer SEQUENCE
  const outer = readTLV(certDer, 0);
  // tbsCertificate SEQUENCE
  const tbs = readTLV(certDer, outer.valueOffset);
  let p = tbs.valueOffset;
  const tbsEnd = tbs.valueOffset + tbs.len;
  // Optional [0] version
  if (certDer[p] === 0xa0) {
    const v = readTLV(certDer, p);
    p = v.valueOffset + v.len;
  }
  // serialNumber INTEGER
  let t = readTLV(certDer, p); p = t.valueOffset + t.len;
  // signature SEQUENCE
  t = readTLV(certDer, p); p = t.valueOffset + t.len;
  // issuer SEQUENCE
  t = readTLV(certDer, p); p = t.valueOffset + t.len;
  // validity SEQUENCE
  t = readTLV(certDer, p); p = t.valueOffset + t.len;
  // subject SEQUENCE
  t = readTLV(certDer, p); p = t.valueOffset + t.len;
  // subjectPublicKeyInfo SEQUENCE -> this is the SPKI we want (with header)
  const spki = readTLV(certDer, p);
  return certDer.slice(p, spki.valueOffset + spki.len);
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, "");
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// Cache the imported public key
let _cachedKey: CryptoKey | null = null;
async function getPubKey(): Promise<CryptoKey> {
  if (_cachedKey) return _cachedKey;
  const certDer = pemToDer(MPESA_CERT);
  const spkiDer = extractSpkiFromCertDer(certDer);
  // Web Crypto doesn't natively support RSA-PKCS1-v1_5 encryption (only OAEP).
  // Daraja requires PKCS1 v1.5 padding. We must use node:crypto for the encrypt op.
  _cachedKey = await crypto.subtle.importKey(
    "spki", spkiDer.buffer,
    { name: "RSA-OAEP", hash: "SHA-1" }, // dummy algo just to import; we won't use OAEP
    true, ["encrypt"],
  );
  return _cachedKey;
}

// Manual RSAES-PKCS1-v1_5 encryption using Web Crypto for raw modular exponentiation isn't possible.
// Instead: export the imported key as JWK -> get n,e -> do RSA encrypt manually with bigint.
async function encryptInitiator(password: string): Promise<string> {
  const certDer = pemToDer(MPESA_CERT);
  const spkiDer = extractSpkiFromCertDer(certDer);
  // Import as RSA-OAEP just to extract the JWK (n,e)
  const k = await crypto.subtle.importKey(
    "spki", spkiDer.buffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    true, ["encrypt"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", k);
  const n = b64uToBigInt(jwk.n!);
  const e = b64uToBigInt(jwk.e!);
  const kLen = byteLengthOfBigInt(n);

  // PKCS#1 v1.5 EME padding: 0x00 || 0x02 || PS || 0x00 || M
  const m = new TextEncoder().encode(password);
  if (m.length > kLen - 11) throw new Error("Password too long for RSA key");
  const psLen = kLen - m.length - 3;
  const ps = new Uint8Array(psLen);
  crypto.getRandomValues(ps);
  for (let i = 0; i < ps.length; i++) {
    while (ps[i] === 0) ps[i] = (Math.floor(Math.random() * 255) + 1) & 0xff;
  }
  const em = new Uint8Array(kLen);
  em[0] = 0x00; em[1] = 0x02;
  em.set(ps, 2);
  em[2 + psLen] = 0x00;
  em.set(m, 3 + psLen);
  // c = m^e mod n
  const mInt = bytesToBigInt(em);
  const c = modPow(mInt, e, n);
  const cBytes = bigIntToBytes(c, kLen);
  let bin = "";
  for (let i = 0; i < cBytes.length; i++) bin += String.fromCharCode(cBytes[i]);
  return btoa(bin);
}

function b64uToBigInt(b64u: string): bigint {
  const b64 = b64u.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64u.length / 4) * 4, "=");
  const bin = atob(b64);
  let h = "0x";
  for (let i = 0; i < bin.length; i++) h += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return BigInt(h);
}
function bytesToBigInt(bytes: Uint8Array): bigint {
  let h = "0x";
  for (let i = 0; i < bytes.length; i++) h += bytes[i].toString(16).padStart(2, "0");
  return BigInt(h);
}
function bigIntToBytes(n: bigint, length: number): Uint8Array {
  let h = n.toString(16);
  if (h.length % 2) h = "0" + h;
  const out = new Uint8Array(length);
  const start = length - h.length / 2;
  for (let i = 0; i < h.length / 2; i++) out[start + i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function byteLengthOfBigInt(n: bigint): number {
  return Math.ceil(n.toString(16).length / 2);
}
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let r = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return r;
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

    const originatorId = `ABN-${payout_id.replace(/-/g, "").slice(0, 20)}`;
    const body = {
      OriginatorConversationID: originatorId,
      InitiatorName: INITIATOR_NAME,
      SecurityCredential: securityCredential,
      CommandID: "BusinessPayment",
      Amount: Math.round(Number(payout.amount)),
      PartyA: SHORTCODE,
      PartyB: payout.phone_number.replace(/\D/g, ""),
      Remarks: "AbanRemit payout",
      QueueTimeOutURL: `${callbackBase}?type=timeout&id=${payout_id}`,
      ResultURL: `${callbackBase}?type=result&id=${payout_id}`,
      Occasion: "Withdrawal",
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
