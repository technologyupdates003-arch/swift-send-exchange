import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase as sb } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ALL_CURRENCIES, formatMoney } from "@/lib/format";
import { ArrowDown, RefreshCw } from "lucide-react";
import { PinDialog } from "@/components/PinDialog";
import { usePinGuard } from "@/hooks/usePinGuard";

const supabase = sb as any;

interface Wallet { id: string; currency: string; balance: number; }
interface Rate { from_currency: string; to_currency: string; rate: number; }

export default function Exchange() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { hasPin } = usePinGuard();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("EUR");
  const [amount, setAmount] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("wallets").select("*").order("currency"),
      supabase.from("exchange_rates").select("*"),
    ]).then(([w, r]: any) => {
      if (w.data) setWallets(w.data);
      if (r.data) setRates(r.data);
    });
  }, [user]);

  const fromWallet = wallets.find((w) => w.currency === from);
  const rate = useMemo(
    () => rates.find((r) => r.from_currency === from && r.to_currency === to)?.rate ?? null,
    [rates, from, to]
  );
  const converted = rate && amount ? (parseFloat(amount) * Number(rate)) : 0;

  const swap = () => { const a = from; setFrom(to); setTo(a); };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (from === to) { toast.error("Pick two different currencies"); return; }
    if (!fromWallet || amt > Number(fromWallet.balance)) { toast.error("Insufficient balance"); return; }
    if (!hasPin) { toast.error("Set your transaction PIN in Settings first"); navigate("/settings"); return; }
    setPinOpen(true);
  };

  const onPinSubmit = async (pin: string) => {
    const amt = parseFloat(amount);
    setPinLoading(true);
    const { error } = await supabase.rpc("exchange_currency", {
      _from_currency: from, _to_currency: to, _amount: amt, _pin: pin,
    });
    setPinLoading(false);
    if (error) { toast.error(error.message); return; }
    setPinOpen(false);
    toast.success("Exchange complete");
    navigate("/wallets");
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Currency exchange</h1>
        <p className="text-muted-foreground">Convert balances between your wallets at indicative rates.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Swap currencies</CardTitle>
          <CardDescription>
            {rate ? <>Rate: <span className="font-medium text-foreground">1 {from} = {Number(rate).toFixed(4)} {to}</span></> : "Rate unavailable"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>From</Label>
              <div className="flex gap-2">
                <Select value={from} onValueChange={setFrom}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="number" min="0" step="0.01" placeholder="0.00"
                  value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              {fromWallet && <p className="text-xs text-muted-foreground">Available: {formatMoney(fromWallet.balance, from)}</p>}
            </div>

            <div className="flex justify-center">
              <Button type="button" variant="outline" size="icon" onClick={swap}>
                <ArrowDown className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-2">
              <Label>To</Label>
              <div className="flex gap-2">
                <Select value={to} onValueChange={setTo}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input readOnly value={converted ? converted.toFixed(2) : ""} placeholder="0.00" />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={submitting || !rate || !amount}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {submitting ? "Converting..." : "Convert"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
