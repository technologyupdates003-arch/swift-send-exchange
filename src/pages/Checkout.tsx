import { useState } from "react";
import { z } from "zod";
import { supabase as sb } from "@/integrations/supabase/client";
const supabase = sb as any;
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ALL_CURRENCIES, formatMoney } from "@/lib/format";
import { ExternalLink, ShieldCheck, Lock, CreditCard, FlaskConical } from "lucide-react";
import { toast } from "sonner";

const VP_DEMO_BRANDING = "https://evirtualpay.com/v2/vp_interface/payment-branding/aQZmJs92uiiWfJCeejsIErwMSjqWEbknQS2JkyGByAS1kFnD0cTWn1";

const schema = z.object({
  amount: z.number().positive(),
  currency: z.enum(["USD", "EUR", "GBP", "KES", "NGN"]),
});

export default function Checkout() {
  const [amount, setAmount] = useState("10");
  const [currency, setCurrency] = useState("USD");
  const [loading, setLoading] = useState(false);
  const [lastRef, setLastRef] = useState<string | null>(null);

  const launch = async () => {
    const parsed = schema.safeParse({ amount: parseFloat(amount), currency });
    if (!parsed.success) { toast.error("Enter a valid amount"); return; }
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("virtualpay-init", {
      body: { flow: "card", amount: parsed.data.amount, currency: parsed.data.currency },
    });
    setLoading(false);
    if (error || !data?.success || !data?.checkout_url) {
      toast.error(error?.message || data?.error || "Could not open checkout");
      return;
    }
    setLastRef(data.reference);
    window.open(data.checkout_url, "_blank");
    toast.success("Checkout opened in new tab");
  };

  const openDemo = () => window.open(VP_DEMO_BRANDING, "_blank");

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Checkout</h1>
          <p className="text-muted-foreground">Test the VirtualPay-hosted payment gateway.</p>
        </div>
        <Badge variant="outline" className="gap-1"><FlaskConical className="h-3 w-3" /> Sandbox / Test mode</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" /> Run a test transaction</CardTitle>
          <CardDescription>Enter an amount and we'll open the VirtualPay hosted checkout in a new tab.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALL_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>

          <div className="rounded-lg border bg-muted/40 p-3 space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Hosted by VirtualPay · PCI-DSS compliant</div>
            <div className="flex items-center gap-2"><Lock className="h-4 w-4" /> Card data is captured on VirtualPay's secure page — never on our servers.</div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={launch} disabled={loading} className="flex-1 gap-2">
              <ExternalLink className="h-4 w-4" />
              {loading ? "Opening checkout…" : `Pay ${formatMoney(parseFloat(amount || "0"), currency)}`}
            </Button>
            <Button variant="outline" onClick={openDemo} className="gap-2">
              <ExternalLink className="h-4 w-4" /> Open VirtualPay demo
            </Button>
          </div>

          {lastRef && (
            <p className="text-xs text-muted-foreground">
              Last reference: <span className="font-mono text-foreground">{lastRef}</span> — track its status in Reports.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How it works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. We create a session with VirtualPay using your merchant credentials.</p>
          <p>2. You're redirected to VirtualPay's secure hosted page to complete payment.</p>
          <p>3. VirtualPay confirms the result via webhook and the transaction appears in your Reports.</p>
        </CardContent>
      </Card>
    </div>
  );
}
