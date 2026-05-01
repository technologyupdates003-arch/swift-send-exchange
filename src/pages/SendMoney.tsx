import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase as sb } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { Send, Smartphone, Hash, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { PinDialog } from "@/components/PinDialog";
import { usePinGuard } from "@/hooks/usePinGuard";
import { useWalletRealtime } from "@/hooks/useWalletRealtime";

const supabase = sb as any;

const walletNumberSchema = z.object({
  to_wallet_number: z.string().regex(/^ABN\d{10}$/i, "Format: ABN + 10 digits"),
  amount: z.number().positive("Amount must be > 0"),
  description: z.string().max(200).optional(),
});
const mpesaSchema = z.object({
  phone: z.string().regex(/^(?:\+?254|0)?[17]\d{8}$/, "Invalid Kenyan phone"),
  amount: z.number().positive("Amount must be > 0"),
});

interface Wallet { id: string; currency: string; balance: number; wallet_number: string; }
interface LookupResult { wallet_number: string; currency: string; full_name: string | null; user_id: string; }

export default function SendMoney() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { hasPin } = usePinGuard();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<((pin: string) => Promise<void>) | null>(null);

  // Wallet send (by wallet number)
  const [toWallet, setToWallet] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [lookupStatus, setLookupStatus] = useState<"idle" | "checking" | "found" | "notfound" | "self">("idle");
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [fromCurrency, setFromCurrency] = useState<string>("");
  const [rate, setRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(false);

  // M-Pesa send
  const [phone, setPhone] = useState("");
  const [mAmt, setMAmt] = useState("");

  const loadWallets = () => {
    supabase.from("wallets").select("*").order("currency").then(({ data }: any) => {
      if (data) setWallets(data);
    });
  };
  useEffect(() => { if (user) loadWallets(); }, [user]);
  useWalletRealtime(user?.id, loadWallets);

  // Lookup wallet number (debounced)
  useEffect(() => {
    const raw = toWallet.trim().toUpperCase();
    if (!/^ABN\d{10}$/.test(raw)) {
      setLookupStatus("idle"); setLookup(null); return;
    }
    setLookupStatus("checking");
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("lookup_wallet", { _wallet_number: raw });
      if (error || !data || !data.found) { setLookupStatus("notfound"); setLookup(null); return; }
      if (data.is_self || data.user_id === user?.id) { setLookupStatus("self"); setLookup(null); return; }
      setLookup(data as LookupResult);
      setLookupStatus("found");
    }, 350);
    return () => clearTimeout(t);
  }, [toWallet, user?.id]);

  // Default sender wallet to one matching recipient currency, else first wallet with balance
  useEffect(() => {
    if (!lookup || wallets.length === 0) return;
    if (fromCurrency && wallets.some((w) => w.currency === fromCurrency)) return;
    const match = wallets.find((w) => w.currency === lookup.currency);
    if (match) setFromCurrency(match.currency);
    else {
      const withBal = wallets.find((w) => Number(w.balance) > 0) ?? wallets[0];
      setFromCurrency(withBal.currency);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup, wallets]);

  const senderWallet = fromCurrency ? wallets.find((w) => w.currency === fromCurrency) : null;
  const sameCurrency = !!(lookup && senderWallet && lookup.currency === senderWallet.currency);

  // Fetch exchange rate when cross-currency
  useEffect(() => {
    if (!lookup || !senderWallet || sameCurrency) { setRate(null); return; }
    setRateLoading(true);
    supabase.from("exchange_rates")
      .select("rate")
      .eq("from_currency", senderWallet.currency)
      .eq("to_currency", lookup.currency)
      .maybeSingle()
      .then(({ data }: any) => {
        setRate(data?.rate ? Number(data.rate) : null);
        setRateLoading(false);
      });
  }, [lookup, senderWallet?.currency, sameCurrency]);

  const amtNum = parseFloat(amount) || 0;
  const credited = sameCurrency
    ? amtNum
    : (rate ? Number((amtNum * rate).toFixed(lookup?.currency === "ABN" ? 6 : 2)) : null);

  const requirePin = (action: (pin: string) => Promise<void>) => {
    if (!hasPin) {
      toast.error("Set your transaction PIN in Settings first");
      navigate("/settings");
      return;
    }
    setPendingAction(() => action);
    setPinOpen(true);
  };

  const onPinSubmit = async (pin: string) => {
    if (!pendingAction) return;
    setPinLoading(true);
    try {
      await pendingAction(pin);
      setPinOpen(false);
    } finally {
      setPinLoading(false);
      setPendingAction(null);
    }
  };

  const onSendWallet = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = walletNumberSchema.safeParse({
      to_wallet_number: toWallet.trim().toUpperCase(),
      amount: parseFloat(amount),
      description: description || undefined,
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    if (lookupStatus !== "found" || !lookup) { toast.error("Recipient wallet not found"); return; }
    if (!senderWallet) { toast.error("Pick a wallet to send from"); return; }
    if (!sameCurrency && !rate) {
      toast.error(`No exchange rate set for ${senderWallet.currency} → ${lookup.currency}`);
      return;
    }
    if (parsed.data.amount > Number(senderWallet.balance)) {
      toast.error("Insufficient balance"); return;
    }

    requirePin(async (pin) => {
      const { error } = await supabase.rpc("transfer_funds_by_wallet", {
        _to_wallet_number: parsed.data.to_wallet_number,
        _amount: parsed.data.amount,
        _description: parsed.data.description ?? null,
        _pin: pin,
        _from_currency: senderWallet.currency,
      });
      if (error) { toast.error(error.message); return; }
      toast.success("Transfer complete");
      navigate("/transactions");
    });
  };

  const onSendMpesa = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = mpesaSchema.safeParse({ phone, amount: parseFloat(mAmt) });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    requirePin(async (pin) => {
      const { data, error } = await supabase.rpc("send_to_mpesa", {
        _phone: parsed.data.phone, _amount: parsed.data.amount, _pin: pin,
      });
      if (error) { toast.error(error.message); return; }
      if (data?.payout_id) {
        await supabase.functions.invoke("mpesa-b2c", { body: { payout_id: data.payout_id } });
      }
      toast.success("M-Pesa send queued");
      navigate("/transactions");
    });
  };

  return (
    <div className="space-y-6 max-w-xl pb-20 md:pb-0">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Send money</h1>
        <p className="text-muted-foreground">To another AbanRemit wallet number or to an M-Pesa phone.</p>
      </div>

      <Tabs defaultValue="wallet">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="wallet"><Hash className="mr-2 h-4 w-4" />To wallet</TabsTrigger>
          <TabsTrigger value="mpesa"><Smartphone className="mr-2 h-4 w-4" />To M-Pesa</TabsTrigger>
        </TabsList>

        <TabsContent value="wallet">
          <Card>
            <CardHeader>
              <CardTitle>Send to wallet number</CardTitle>
              <CardDescription>Enter the recipient's AbanRemit wallet number (ABN + 10 digits).</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSendWallet} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="wn">Recipient wallet number</Label>
                  <Input
                    id="wn"
                    value={toWallet}
                    onChange={(e) => setToWallet(e.target.value.toUpperCase())}
                    placeholder="ABN1234567890"
                    className="font-mono"
                    maxLength={13}
                    required
                  />
                  {lookupStatus === "checking" && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Looking up…
                    </p>
                  )}
                  {lookupStatus === "found" && lookup && (
                    <div className="rounded-md border bg-muted/40 p-3">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{lookup.full_name || "AbanRemit user"}</p>
                          <p className="text-xs text-muted-foreground">
                            {lookup.currency} wallet · {lookup.wallet_number}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  {lookupStatus === "notfound" && (
                    <p className="flex items-center gap-1 text-xs text-destructive">
                      <XCircle className="h-3 w-3" /> Wallet number not found
                    </p>
                  )}
                  {lookupStatus === "self" && (
                    <p className="flex items-center gap-1 text-xs text-destructive">
                      <XCircle className="h-3 w-3" /> You can't send to your own wallet
                    </p>
                  )}
                </div>

                {lookup && wallets.length === 0 && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                    You don't have any wallets yet. Create one from the Wallets page.
                  </div>
                )}

                {lookup && wallets.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="from">Send from</Label>
                    <select
                      id="from"
                      value={fromCurrency}
                      onChange={(e) => setFromCurrency(e.target.value)}
                      className="w-full rounded-md border bg-background p-2 text-sm"
                    >
                      {wallets.map((w) => (
                        <option key={w.id} value={w.currency}>
                          {w.currency} — {formatMoney(w.balance, w.currency)} available
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="amt">Amount {senderWallet ? `(${senderWallet.currency})` : ""}</Label>
                  <Input id="amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                </div>

                {lookup && senderWallet && !sameCurrency && (
                  <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
                    {rateLoading ? (
                      <p className="text-muted-foreground flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> Loading rate…
                      </p>
                    ) : rate ? (
                      <>
                        <p className="text-muted-foreground">
                          Rate: 1 {senderWallet.currency} = {rate} {lookup.currency}
                        </p>
                        <p className="font-semibold">
                          Recipient gets: {credited !== null ? formatMoney(credited, lookup.currency) : "—"}
                        </p>
                      </>
                    ) : (
                      <p className="text-destructive">
                        No exchange rate set for {senderWallet.currency} → {lookup.currency}. Ask admin to add one.
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="desc">Note (optional)</Label>
                  <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} rows={2} />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={
                    lookupStatus !== "found" ||
                    !senderWallet ||
                    (!sameCurrency && !rate)
                  }
                >
                  <Send className="mr-2 h-4 w-4" /> Send transfer
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mpesa">
          <Card>
            <CardHeader>
              <CardTitle>Send to M-Pesa</CardTitle>
              <CardDescription>Deducted from your KES wallet. Paid out via M-Pesa B2C.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSendMpesa} className="space-y-4">
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input type="tel" placeholder="0712345678" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Amount (KES)</Label>
                  <Input type="number" min="10" step="1" value={mAmt} onChange={(e) => setMAmt(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full">
                  <Smartphone className="mr-2 h-4 w-4" /> Send to M-Pesa
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <PinDialog open={pinOpen} onClose={() => setPinOpen(false)} onSubmit={onPinSubmit} loading={pinLoading} />
    </div>
  );
}
