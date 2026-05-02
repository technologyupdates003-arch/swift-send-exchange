import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase as sb } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { CreditCard, Smartphone, Wallet, ShieldCheck, Lock, Coins, Loader2, Bitcoin, Copy } from "lucide-react";
import { useWalletRealtime } from "@/hooks/useWalletRealtime";

const supabase = sb as any;

const stkSchema = z.object({
  amount: z.number().positive().min(10),
  phone: z.string().regex(/^(?:\+?254|0)?[17]\d{8}$/, "Invalid Kenyan phone"),
});

const abanSchema = z.object({ usd_amount: z.number().positive() });

interface WalletRow { id: string; currency: string; balance: number; }

export default function FundWallet() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [wallets, setWallets] = useState<WalletRow[]>([]);

  // Card state (hosted Paystack checkout)
  const [cardCurrency, setCardCurrency] = useState<"NGN" | "USD" | "KES">("NGN");
  const [cardAmount, setCardAmount] = useState("");
  const [cardLoading, setCardLoading] = useState(false);
  const [chargeRef, setChargeRef] = useState<string | null>(null);

  // STK state
  const [stkAmount, setStkAmount] = useState("");
  const [stkPhone, setStkPhone] = useState("");
  const [stkLoading, setStkLoading] = useState(false);
  const [stkRef, setStkRef] = useState<string | null>(null);
  const [stkPolling, setStkPolling] = useState(false);

  // ABN state
  const [abanUsd, setAbanUsd] = useState("");
  const [abanQuote, setAbanQuote] = useState<{ price_usd: number; reserve_abn: number; reserve_usd: number } | null>(null);
  const [abanLoading, setAbanLoading] = useState(false);

  // BTC state
  const [btcUsd, setBtcUsd] = useState("");
  const [btcLoading, setBtcLoading] = useState(false);
  const [btcInvoice, setBtcInvoice] = useState<{ pay_address: string; pay_amount_btc: number; amount_usd: number; payment_id: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("wallets").select("*").order("currency").then(({ data }: any) => data && setWallets(data));
    supabase.rpc("aban_quote").then(({ data }: any) => data && setAbanQuote(data));
  }, [user]);

  // Live wallet refresh — any change to user's money tables updates the cards
  useWalletRealtime(user?.id, () => {
    supabase.from("wallets").select("*").order("currency").then(({ data }: any) => data && setWallets(data));
  });

  

  const submitCard = async () => {
    const amt = parseFloat(cardAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!(window as any).PaystackPop) { toast.error("Payment library not loaded — refresh the page"); return; }
    setCardLoading(true);

    // 1) Create a pending charge + reference on our backend
    const { data: init, error: initErr } = await supabase.functions.invoke("paystack-init-transaction", {
      body: { amount: amt, currency: cardCurrency },
    });
    if (initErr || !init?.reference) {
      setCardLoading(false);
      toast.error(initErr?.message || init?.error || "Could not start payment");
      return;
    }

    // 2) Fetch our public key
    const { data: pk } = await supabase.functions.invoke("paystack-public-key", { body: {} });
    const publicKey = pk?.public_key;
    if (!publicKey) {
      setCardLoading(false);
      toast.error("Card payments not configured");
      return;
    }

    setChargeRef(init.reference);

    // 3) Open Paystack Inline popup (no redirect, on-site overlay)
    const popup = new (window as any).PaystackPop();
    popup.newTransaction({
      key: publicKey,
      email: user?.email || `${user?.id}@user.local`,
      amount: Math.round(amt * 100),
      currency: cardCurrency,
      reference: init.reference,
      onSuccess: (tx: any) => {
        setCardLoading(false);
        toast.success("Payment received — crediting wallet…");
        pollPaystack(tx.reference || init.reference);
      },
      onCancel: () => {
        setCardLoading(false);
        toast.info("Payment cancelled");
        setChargeRef(null);
      },
      onError: (err: any) => {
        setCardLoading(false);
        toast.error(err?.message || "Payment error");
      },
    });
  };

  const pollPaystack = async (reference: string) => {
    let tries = 0;
    const tick = async () => {
      tries++;
      const { data } = await supabase
        .from("paystack_charges").select("status").eq("reference", reference).maybeSingle();
      if (data?.status === "success") {
        toast.success("Payment successful — wallet credited");
        resetCard(); refreshWallets();
        return;
      }
      if (data?.status === "failed") {
        toast.error("Payment failed or was cancelled");
        resetCard();
        return;
      }
      if (tries < 60) setTimeout(tick, 3000);
    };
    setTimeout(tick, 4000);
  };

  const resetCard = () => {
    setCardAmount("");
    setChargeRef(null);
  };
  const refreshWallets = () => supabase.from("wallets").select("*").order("currency").then(({ data }: any) => data && setWallets(data));

  const submitStk = async () => {
    const parsed = stkSchema.safeParse({ amount: parseFloat(stkAmount), phone: stkPhone });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    setStkLoading(true);
    const { data, error } = await supabase.functions.invoke("intasend-stk-push", {
      body: { amount: parsed.data.amount, phone: parsed.data.phone },
    });
    setStkLoading(false);
    if (error || !data?.success) { toast.error(error?.message || data?.error || "STK failed"); return; }
    toast.success(data.message || "Approve the M-Pesa prompt on your phone");
    setStkRef(data.reference);
    setStkPolling(true);
    pollStk(data.reference);
  };

  const pollStk = async (reference: string) => {
    let tries = 0;
    const maxTries = 30; // ~90s at 3s interval
    const tick = async () => {
      tries++;
      const { data } = await supabase.functions.invoke("intasend-status", { body: { reference } });
      if (data?.status === "completed") {
        toast.success("M-Pesa payment received — wallet credited");
        setStkPolling(false); setStkRef(null); setStkAmount(""); setStkPhone("");
        refreshWallets();
        return;
      }
      if (data?.status === "failed") {
        toast.error(data.message || "Payment failed");
        setStkPolling(false); setStkRef(null);
        return;
      }
      if (tries >= maxTries) {
        toast.warning("Still waiting on M-Pesa. Check Transactions later.");
        setStkPolling(false);
        return;
      }
      setTimeout(tick, 3000);
    };
    setTimeout(tick, 3000);
  };

  const buyAban = async () => {
    const parsed = abanSchema.safeParse({ usd_amount: parseFloat(abanUsd) });
    if (!parsed.success) { toast.error("Enter USD amount"); return; }
    const pin = window.prompt("Enter your 4-digit transaction PIN");
    if (!pin) return;
    setAbanLoading(true);
    const { data, error } = await supabase.rpc("aban_buy_abn", { _usd_amount: parsed.data.usd_amount, _pin: pin });
    setAbanLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Bought ${data.abn_received} ABN @ $${data.price}`);
    setAbanUsd(""); refreshWallets();
    supabase.rpc("aban_quote").then(({ data }: any) => data && setAbanQuote(data));
  };

  const submitBtc = async () => {
    const usd = parseFloat(btcUsd);
    if (!usd || usd < 1) { toast.error("Min $1 USD"); return; }
    setBtcLoading(true);
    const { data, error } = await supabase.functions.invoke("btc-deposit-init", { body: { amount_usd: usd } });
    setBtcLoading(false);
    if (error || !data?.success) { toast.error(error?.message || data?.error || "BTC processor error"); return; }
    setBtcInvoice(data);
    toast.success("Send BTC to the address shown — ABN credits automatically");
  };

  const copyText = async (s: string) => {
    try { await navigator.clipboard.writeText(s); toast.success("Copied"); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-6 max-w-2xl pb-20 md:pb-0">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Fund wallet</h1>
        <p className="text-muted-foreground">Add money via card, M-Pesa, or buy ABN coin.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {wallets.map((w) => (
          <Card key={w.id}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Wallet className="h-3 w-3" />{w.currency}</div>
              <p className="mt-1 text-lg font-semibold">{formatMoney(w.balance, w.currency)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="card">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="card"><CreditCard className="mr-2 h-4 w-4" />Card</TabsTrigger>
          <TabsTrigger value="mpesa"><Smartphone className="mr-2 h-4 w-4" />M-Pesa</TabsTrigger>
          <TabsTrigger value="btc"><Bitcoin className="mr-2 h-4 w-4" />BTC</TabsTrigger>
          <TabsTrigger value="aban"><Coins className="mr-2 h-4 w-4" />ABN</TabsTrigger>
        </TabsList>

        <TabsContent value="card">
          <Card>
            <CardHeader>
              <CardTitle>Pay with card</CardTitle>
              <CardDescription>Visa, Mastercard, Verve, bank transfer & more — secure card popup, no redirect.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Select value={cardCurrency} onValueChange={(v: any) => setCardCurrency(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NGN">NGN — Naira</SelectItem>
                      <SelectItem value="USD">USD — Dollar</SelectItem>
                      <SelectItem value="KES">KES — Shilling</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Amount</Label>
                  <Input type="number" min="0" step="0.01" value={cardAmount} onChange={(e) => setCardAmount(e.target.value)} />
                </div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
                <div className="flex items-center gap-2"><Lock className="h-3 w-3" /> Card entered in a secure on-page popup — no redirects.</div>
                <div className="flex items-center gap-2"><ShieldCheck className="h-3 w-3 text-primary" /> Wallet is credited automatically once payment confirms.</div>
              </div>

              <Button onClick={submitCard} disabled={cardLoading || !cardAmount} className="w-full">
                {cardLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Opening Paystack…</> : `Pay ${cardAmount ? formatMoney(parseFloat(cardAmount), cardCurrency) : ""}`}
              </Button>

              {chargeRef && (
                <p className="text-center text-xs text-muted-foreground">
                  Awaiting payment confirmation… Ref: <span className="font-mono">{chargeRef}</span>
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mpesa">
          <Card>
            <CardHeader>
              <CardTitle>M-Pesa STK push</CardTitle>
              <CardDescription>Approve the prompt on your phone to fund your KES wallet instantly.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input type="tel" placeholder="0712345678" value={stkPhone} onChange={(e) => setStkPhone(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Amount (KES)</Label>
                <Input type="number" min="10" value={stkAmount} onChange={(e) => setStkAmount(e.target.value)} />
              </div>
              <Button onClick={submitStk} disabled={stkLoading || stkPolling} className="w-full">
                {stkLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending prompt…</> : <><Smartphone className="mr-2 h-4 w-4" />Send STK push</>}
              </Button>
              {stkPolling && (
                <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Waiting for M-Pesa confirmation… enter PIN on your phone.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="btc">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Bitcoin className="h-5 w-5 text-primary" /> Fund with Bitcoin</CardTitle>
              <CardDescription>Send BTC to the generated address — your USD wallet auto-credits after 1 confirmation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!btcInvoice && (
                <>
                  <div className="space-y-2">
                    <Label>Amount (USD)</Label>
                    <Input type="number" min="1" step="0.01" placeholder="50.00" value={btcUsd} onChange={(e) => setBtcUsd(e.target.value)} />
                  </div>
                  <Button onClick={submitBtc} disabled={btcLoading} className="w-full">
                    {btcLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating address…</> : <><Bitcoin className="mr-2 h-4 w-4" />Generate BTC address</>}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">Powered by NOWPayments. Confirmation usually takes 10–30 minutes.</p>
                </>
              )}
              {btcInvoice && (
                <div className="space-y-3">
                  <div className="rounded-lg border bg-gradient-to-br from-primary/10 to-card p-4 space-y-2">
                    <div className="flex justify-between text-xs text-muted-foreground"><span>Send exactly</span><span>${btcInvoice.amount_usd}</span></div>
                    <div className="font-mono text-2xl font-bold">{btcInvoice.pay_amount_btc} BTC</div>
                    <div className="text-xs text-muted-foreground">to address:</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 break-all rounded border bg-background px-2 py-1.5 text-xs font-mono">{btcInvoice.pay_address}</code>
                      <Button size="icon" variant="outline" onClick={() => copyText(btcInvoice.pay_address)}><Copy className="h-3 w-3" /></Button>
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                    Wallet credits automatically once your BTC payment confirms on the network. You can close this page — see status under Transactions.
                  </div>
                  <Button variant="outline" onClick={() => { setBtcInvoice(null); setBtcUsd(""); }} className="w-full">New deposit</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aban">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Coins className="h-5 w-5 text-primary" /> Buy ABN coin</CardTitle>
              <CardDescription>
                Live price: <span className="font-mono text-foreground">${abanQuote?.price_usd.toFixed(6) ?? "—"}</span> per ABN
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-gradient-to-br from-primary/10 to-card p-3 text-xs text-muted-foreground space-y-1">
                <div className="flex justify-between"><span>ABN reserve</span><span className="font-mono">{abanQuote?.reserve_abn.toLocaleString() ?? "—"}</span></div>
                <div className="flex justify-between"><span>USD reserve</span><span className="font-mono">${abanQuote?.reserve_usd.toLocaleString() ?? "—"}</span></div>
              </div>
              <div className="space-y-2">
                <Label>USD to spend (from your USD wallet)</Label>
                <Input type="number" min="0" step="0.01" value={abanUsd} onChange={(e) => setAbanUsd(e.target.value)} />
                {abanUsd && abanQuote && (
                  <p className="text-xs text-muted-foreground">
                    ≈ {(parseFloat(abanUsd) / abanQuote.price_usd).toFixed(4)} ABN (price moves with trade size)
                  </p>
                )}
              </div>
              <Button onClick={buyAban} disabled={abanLoading} className="w-full">
                {abanLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Coins className="mr-2 h-4 w-4" />Buy ABN</>}
              </Button>
              <Button variant="outline" onClick={() => navigate("/aban-coin")} className="w-full">
                View ABN dashboard
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
