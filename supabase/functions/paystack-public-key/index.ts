// Returns the Paystack public key for browser-side Paystack Inline.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const key = Deno.env.get("PAYSTACK_PUBLIC_KEY") ?? "";
  return new Response(JSON.stringify({ public_key: key }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
