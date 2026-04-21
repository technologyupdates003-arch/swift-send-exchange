// Shared VirtualPay client used by all virtualpay-* edge functions.
// Uses HMAC-SHA256 signing of the request body with the API secret as commonly required.
// Adjust SIGN_HEADER / signing payload to match VirtualPay's exact spec when their docs are confirmed.

export const VP_BASE = (Deno.env.get("VIRTUALPAY_BASE_URL") || "https://uat.portal.virtual-pay.io/api-management").replace(/\/+$/, "");
export const VP_MERCHANT = Deno.env.get("VIRTUALPAY_MERCHANT_ID") || "";
export const VP_KEY = Deno.env.get("VIRTUALPAY_API_KEY") || "";
export const VP_SECRET = Deno.env.get("VIRTUALPAY_API_SECRET") || "";

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function vpRequest(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: any }> {
  const payload = JSON.stringify({ merchant_id: VP_MERCHANT, ...body });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await hmacHex(VP_SECRET, `${timestamp}.${payload}`);
  const url = `${VP_BASE}${path.startsWith("/") ? path : `/${path}`}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Merchant-Id": VP_MERCHANT,
        "X-Api-Key": VP_KEY,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
        "Authorization": `Bearer ${VP_KEY}`,
      },
      body: payload,
    });
  } catch (e) {
    return { ok: false, status: 0, data: { error: `Network error: ${String(e)}` } };
  }
  const text = await res.text();
  let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

export async function verifyWebhookSignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const expected = await hmacHex(VP_SECRET, rawBody);
  return expected === signature.toLowerCase();
}
