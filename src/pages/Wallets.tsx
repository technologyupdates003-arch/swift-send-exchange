import { useEffect, useState } from "react";
import { supabase as sb } from "@/integrations/supabase/client";
const supabase = sb as any;
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ALL_CURRENCIES, formatMoney } from "@/lib/format";
import { Plus, Wallet as WalletIcon, Copy, Check } from "lucide-react";

interface Wallet { id: string; currency: string; balance: number; wallet_number: string; }

export default function Wallets() {
  const { user } = useAuth();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [newCurrency, setNewCurrency] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase.from("wallets").select("*").order("currency");
    if (data) setWallets(data as any);
  };

  useEffect(() => { if (user) load(); }, [user]);

  const existingCurrencies = new Set(wallets.map((w) => w.currency));
  const available = ALL_CURRENCIES.filter((c) => !existingCurrencies.has(c));

  const create = async () => {
    if (!newCurrency || !user) return;
    setCreating(true);
    const { error } = await supabase.from("wallets").insert({
      user_id: user.id,
      currency: newCurrency as any,
      balance: 0,
    });
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${newCurrency} wallet created`);
    setNewCurrency("");
    load();
  };

  const copyNumber = async (num: string) => {
    await navigator.clipboard.writeText(num);
    setCopied(num);
    toast.success("Wallet number copied");
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Wallets</h1>
        <p className="text-muted-foreground">Hold balances in multiple currencies. Share your wallet number to receive money.</p>
      </div>

      {available.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Add a wallet</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <Select value={newCurrency} onValueChange={setNewCurrency}>
              <SelectTrigger className="sm:w-48"><SelectValue placeholder="Pick currency" /></SelectTrigger>
              <SelectContent>
                {available.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={create} disabled={!newCurrency || creating}>
              <Plus className="mr-2 h-4 w-4" /> Create wallet
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {wallets.map((w) => (
          <Card key={w.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm font-medium text-muted-foreground">
                {w.currency} wallet
                <WalletIcon className="h-4 w-4" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{formatMoney(w.balance, w.currency)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Available balance</p>
              {w.wallet_number && (
                <button
                  onClick={() => copyNumber(w.wallet_number)}
                  className="mt-3 flex w-full items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-left hover:bg-muted transition"
                >
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Wallet number</p>
                    <p className="truncate font-mono text-sm font-semibold">{w.wallet_number}</p>
                  </div>
                  {copied === w.wallet_number
                    ? <Check className="h-4 w-4 text-primary shrink-0" />
                    : <Copy className="h-4 w-4 text-muted-foreground shrink-0" />}
                </button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
