import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase as sb } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Coins, TrendingUp, ArrowDownUp, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { PinDialog } from "@/components/PinDialog";
import { usePinGuard } from "@/hooks/usePinGuard";

const supabase = sb as any;

const buySchema = z.object({ usd: z.number().positive() });
const sellSchema = z.object({ abn: z.number().positive() });

interface Wallet { id: string; currency: string; balance: number; }
interface Quote { reserve_abn: number; reserve_usd: number; price_usd: number; total_volume_usd: number; }

export default function AbanCoin() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { hasPin } = usePinGuard();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [usd, setUsd] = useState("");
  const [abn, setAbn] = useState("");
  const [loading, setLoading] = useState<"buy" | "sell" | null>(null);

  const [pinOpen, setPinOpen] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<((pin: string) => Promise<void>) | null>(null);

  const refresh = () => {
    supabase.from("wallets").select("*").order("currency").then(({ data }: any) => data && setWallets(data));
    supabase.rpc("aban_quote").then(({ data }: any) => data && setQuote(data));
  };

  useEffect(() => {
    if (!user) return;
    refresh();
    const i = setInterval(refresh, 8000);
    return () => clearInterval(i);
  }, [user]);

  const requirePin = (action: (pin: string) => Promise<void>) => {
    if (!hasPin) { toast.error("Set your transaction PIN in Settings first"); navigate("/settings"); return; }
    setPendingAction(() => action); setPinOpen(true);
  };
  const onPinSubmit = async (pin: string) => {
    if (!pendingAction) return;
    setPinLoading(true);
    try { await pendingAction(pin); setPinOpen(false); }
    finally { setPinLoading(false); setPendingAction(null); }
  };

  const buy = () => {
    const p = buySchema.safeParse({ usd: parseFloat(usd) });
    if (!p.success) { toast.error("Enter USD amount"); return; }
    requirePin(async (pin) => {
      setLoading("buy");
      try {
        const { data, error } = await supabase.rpc("aban_buy_abn", { _usd_amount: p.data.usd, _pin: pin });
        if (error) { toast.error(error.message); return; }
        toast.success(`Bought ${data.abn_received} ABN @ $${data.price}`);
        setUsd(""); refresh();
      } finally { setLoading(null); }
    });
  };

  const sell = () => {
    const p = sellSchema.safeParse({ abn: parseFloat(abn) });
    if (!p.success) { toast.error("Enter ABN amount"); return; }
    requirePin(async (pin) => {
      setLoading("sell");
      try {
        const { data, error } = await supabase.rpc("aban_sell_abn", { _abn_amount: p.data.abn, _pin: pin });
        if (error) { toast.error(error.message); return; }
        toast.success(`Sold ${p.data.abn} ABN for $${data.usd_received}`);
        setAbn(""); refresh();
      } finally { setLoading(null); }
    });
  };

  const usdWallet = wallets.find((w) => w.currency === "USD");
  const abnWallet = wallets.find((w) => w.currency === "ABN");
  const abnEstimate = usd && quote ? (parseFloat(usd) / quote.price_usd).toFixed(4) : null;
  const usdEstimate = abn && quote ? (parseFloat(abn) * quote.price_usd).toFixed(4) : null;

  return (
    <div className="space-y-6 max-w-3xl pb-20 md:pb-0">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-primary/10 p-3"><Coins className="h-7 w-7 text-primary" /></div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Aban Coin (ABN)</h1>
          <p className="text-muted-foreground">Buy or sell ABN against the live AMM market.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><TrendingUp className="h-3 w-3" />Live price</div>
          <p className="mt-1 text-xl font-bold">${quote?.price_usd.toFixed(6) ?? "—"}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Wallet className="h-3 w-3" />Your ABN</div>
          <p className="mt-1 text-xl font-bold">{abnWallet ? Number(abnWallet.balance).toFixed(4) : "0.0000"}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Wallet className="h-3 w-3" />Your USD</div>
          <p className="mt-1 text-xl font-bold">{usdWallet ? formatMoney(usdWallet.balance, "USD") : "$0.00"}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><ArrowDownUp className="h-3 w-3" />Volume</div>
          <p className="mt-1 text-xl font-bold">${quote?.total_volume_usd.toLocaleString() ?? "—"}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Liquidity reserves</CardTitle>
          <CardDescription>Constant-product market: price moves with each trade.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">ABN reserve</p>
            <p className="text-lg font-mono">{quote?.reserve_abn.toLocaleString() ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">USD reserve</p>
            <p className="text-lg font-mono">${quote?.reserve_usd.toLocaleString() ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="buy">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="buy">Buy ABN</TabsTrigger>
          <TabsTrigger value="sell">Sell ABN</TabsTrigger>
        </TabsList>
        <TabsContent value="buy">
          <Card>
            <CardHeader>
              <CardTitle>Buy ABN with USD</CardTitle>
              <CardDescription>USD comes from your USD wallet.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>USD to spend</Label>
                <Input type="number" min="0" step="0.01" value={usd} onChange={(e) => setUsd(e.target.value)} />
                {abnEstimate && <p className="text-xs text-muted-foreground">≈ {abnEstimate} ABN</p>}
              </div>
              <Button onClick={buy} disabled={loading === "buy"} className="w-full">
                {loading === "buy" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buy ABN"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="sell">
          <Card>
            <CardHeader>
              <CardTitle>Sell ABN for USD</CardTitle>
              <CardDescription>USD goes to your USD wallet.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>ABN to sell</Label>
                <Input type="number" min="0" step="0.0001" value={abn} onChange={(e) => setAbn(e.target.value)} />
                {usdEstimate && <p className="text-xs text-muted-foreground">≈ ${usdEstimate} USD</p>}
              </div>
              <Button onClick={sell} disabled={loading === "sell"} className="w-full">
                {loading === "sell" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sell ABN"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <PinDialog open={pinOpen} onClose={() => setPinOpen(false)} onSubmit={onPinSubmit} loading={pinLoading} />
    </div>
  );
}
