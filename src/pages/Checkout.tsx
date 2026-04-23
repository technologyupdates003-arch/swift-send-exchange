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
import { formatMoney } from "@/lib/format";
import { ShieldCheck, Lock, CreditCard, FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";

const schema = z.object({
  amount: z.number().positive(),
  currency: z.enum(["NGN", "USD", "KES"]),
  number: z.string().regex(/^\d{12,19}$/),
  expiry: z.string().regex(/^(0[1-9]|1[0-2])\/?(\d{2}|\d{4})$/),
  cvv: z.string().regex(/^\d{3,4}$/),
});

export default function Checkout() {
  const [amount, setAmount] = useState("100");
  const [currency, setCurrency] = useState<"NGN" | "USD" | "KES">("NGN");
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const formatCardNumber = (v: string) => v.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");

  const submit = async () => {
    const cleanNum = number.replace(/\s/g, "");
    const [mm, yy] = expiry.split("/");
    const parsed = schema.safeParse({
      amount: parseFloat(amount), currency, number: cleanNum, expiry, cvv,
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    setLoading(true); setResult(null);
    const { data, error } = await supabase.functions.invoke("paystack-charge-card", {
      body: {
        amount: parsed.data.amount, currency,
        card: { number: cleanNum, cvv, expiry_month: mm, expiry_year: yy },
      },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setResult(data);
    if (data?.status === "success") toast.success("Test charge successful");
    else if (data?.next_action) toast.info(`Additional verification: ${data.next_action}`);
    else if (!data?.success) toast.error(data?.message || "Charge failed");
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Checkout</h1>
          <p className="text-muted-foreground">Test the white-labeled Paystack card flow.</p>
        </div>
        <Badge variant="outline" className="gap-1"><FlaskConical className="h-3 w-3" /> Live mode</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" /> Run a test transaction</CardTitle>
          <CardDescription>Card data goes straight to Paystack — never stored in our DB.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={(v: any) => setCurrency(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NGN">NGN</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="KES">KES</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>

          <div className="rounded-xl border bg-gradient-to-br from-primary/10 via-card to-card p-4 space-y-3">
            <Input placeholder="1234 5678 9012 3456" value={number} onChange={(e) => setNumber(formatCardNumber(e.target.value))} className="font-mono text-lg tracking-wider" />
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="MM/YY" maxLength={5} value={expiry} onChange={(e) => {
                let v = e.target.value.replace(/\D/g, "").slice(0, 4);
                if (v.length >= 3) v = v.slice(0, 2) + "/" + v.slice(2);
                setExpiry(v);
              }} className="font-mono" />
              <Input type="password" maxLength={4} placeholder="CVV" value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, ""))} className="font-mono" />
            </div>
          </div>

          <div className="rounded-lg border bg-muted/40 p-3 space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Powered by Paystack · PCI-DSS compliant</div>
            <div className="flex items-center gap-2"><Lock className="h-4 w-4" /> 3-D Secure supported · No card data stored on our servers</div>
          </div>

          <Button onClick={submit} disabled={loading} className="w-full">
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing…</> : `Pay ${formatMoney(parseFloat(amount || "0"), currency)}`}
          </Button>

          {result && (
            <pre className="rounded-lg border bg-muted/30 p-3 text-xs overflow-auto max-h-60">{JSON.stringify(result, null, 2)}</pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
