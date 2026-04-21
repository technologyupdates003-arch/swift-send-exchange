import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase as sb } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ALL_CURRENCIES, formatMoney } from "@/lib/format";
import { CreditCard, Building2, Wallet, Copy, ExternalLink, ShieldCheck, Lock } from "lucide-react";

const supabase = sb as any;

const fundSchema = z.object({
  amount: z.number().positive("Amount must be > 0"),
  currency: z.enum(["USD", "EUR", "GBP", "KES", "NGN"]),
});

interface WalletRow { id: string; currency: string; balance: number; }
interface BankDetails { bank_name?: string; account_number?: string; account_name?: string; reference?: string; [k: string]: any; }

export default function FundWallet() {
  const { user } = useAuth();
  const [wallets, setWallets] = useState<WalletRow[]>([]);

  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState<"card" | "bank" | null>(null);
  const [bankDetails, setBankDetails] = useState<BankDetails | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("wallets").select("*").order("currency").then(({ data }: any) => data && setWallets(data));
  }, [user]);

  const submit = async (flow: "card" | "bank_transfer") => {
    const parsed = fundSchema.safeParse({ amount: parseFloat(amount), currency });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    setLoading(flow === "card" ? "card" : "bank");
    setBankDetails(null);
    const { data, error } = await supabase.functions.invoke("virtualpay-init", {
      body: { flow, amount: parsed.data.amount, currency: parsed.data.currency },
    });
    setLoading(null);
    if (error || !data?.success) { toast.error(error?.message || data?.error || "Init failed"); return; }
    if (flow === "card" && data.checkout_url) {
      window.open(data.checkout_url, "_blank");
      toast.success("Checkout opened in a new tab. Wallet credits after payment.");
    } else if (flow === "bank_transfer") {
      setBankDetails({ ...(data.bank_details || {}), reference: data.reference });
      toast.success("Bank details ready. Send the exact amount with the reference below.");
    }
  };

  const copy = (v: string) => { navigator.clipboard.writeText(v); toast.success("Copied"); };

  return (
    <div className="space-y-6 max-w-2xl pb-20 md:pb-0">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Fund wallet</h1>
        <p className="text-muted-foreground">Add money via card or bank transfer (powered by VirtualPay).</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {wallets.map((w) => (
          <Card key={w.id}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Wallet className="h-3 w-3" />{w.currency}</div>
              <p className="mt-1 text-lg font-semibold">{formatMoney(w.balance, w.currency)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Amount</CardTitle>
          <CardDescription>Choose a currency and amount, then pick a method.</CardDescription>
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
        </CardContent>
      </Card>

      <Tabs defaultValue="card">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="card"><CreditCard className="mr-2 h-4 w-4" />Card</TabsTrigger>
          <TabsTrigger value="bank"><Building2 className="mr-2 h-4 w-4" />Bank transfer</TabsTrigger>
        </TabsList>

        <TabsContent value="card">
          <Card>
            <CardHeader>
              <CardTitle>Pay with card</CardTitle>
              <CardDescription>
                You'll enter your card details on VirtualPay's PCI-DSS secure hosted page. Card data never touches our servers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-muted/40 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <span>Accepted cards</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center rounded-md border bg-background px-2 py-1 text-[11px] font-bold tracking-wider text-[#1a1f71]">
                      VISA
                    </span>
                    <span className="inline-flex items-center gap-0.5 rounded-md border bg-background px-2 py-1">
                      <span className="h-3 w-3 rounded-full bg-[#eb001b]" />
                      <span className="-ml-1.5 h-3 w-3 rounded-full bg-[#f79e1b] mix-blend-multiply" />
                      <span className="ml-1 text-[10px] font-semibold text-foreground">Mastercard</span>
                    </span>
                  </div>
                </div>
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                  Encrypted end-to-end. 3-D Secure supported. Your wallet auto-credits after the bank confirms the charge.
                </p>
              </div>

              <Button onClick={() => submit("card")} disabled={loading !== null} className="w-full">
                <ExternalLink className="mr-2 h-4 w-4" />
                {loading === "card" ? "Opening secure checkout..." : "Continue to secure card payment"}
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">
                Powered by VirtualPay · PCI-DSS compliant
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bank">
          <Card>
            <CardHeader>
              <CardTitle>Bank transfer</CardTitle>
              <CardDescription>Get bank details to fund via transfer. Wallet auto-credits when received.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={() => submit("bank_transfer")} disabled={loading !== null} className="w-full">
                <Building2 className="mr-2 h-4 w-4" />
                {loading === "bank" ? "Generating..." : "Get bank details"}
              </Button>

              {bankDetails && (
                <div className="rounded-lg border p-3 space-y-2 text-sm">
                  {Object.entries(bankDetails).map(([k, v]) => (
                    typeof v === "string" || typeof v === "number" ? (
                      <div key={k} className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs text-muted-foreground capitalize">{k.replace(/_/g, " ")}</p>
                          <p className="font-mono">{String(v)}</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => copy(String(v))}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : null
                  ))}
                  <p className="pt-2 text-xs text-muted-foreground">
                    Send exactly {formatMoney(parseFloat(amount), currency)} including the reference. Crediting may take a few minutes after the bank confirms.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
