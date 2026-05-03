import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase as sb } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Building2, Plus, Trash2, ArrowUpFromLine } from "lucide-react";
import { ALL_CURRENCIES, formatMoney } from "@/lib/format";
import { useWalletRealtime } from "@/hooks/useWalletRealtime";

const supabase = sb as any;

const accountSchema = z.object({
  bank_name: z.string().trim().min(2).max(100),
  account_holder_name: z.string().trim().min(2).max(100),
  account_number: z.string().trim().min(4).max(34),
});

interface Bank { id: string; bank_name: string; account_holder_name: string; account_number: string; is_verified: boolean; }
interface Wallet { id: string; currency: string; balance: number; }
interface Withdrawal { id: string; amount: number; currency: string; status: string; created_at: string; }

export default function BankAccounts() {
  const { user } = useAuth();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);

  // add bank form
  const [bankName, setBankName] = useState("");
  const [holder, setHolder] = useState("");
  const [acctNum, setAcctNum] = useState("");

  // withdraw form
  const [bankId, setBankId] = useState("");
  const [currency, setCurrency] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    if (!user) return;
    const [b, w, wd] = await Promise.all([
      supabase.from("bank_accounts").select("*").order("created_at", { ascending: false }),
      supabase.from("wallets").select("*").eq("user_id", user.id).order("currency"),
      supabase.from("withdrawal_requests").select("*").order("created_at", { ascending: false }).limit(10),
    ]);
    if (b.data) setBanks(b.data);
    if (w.data) setWallets(w.data);
    if (wd.data) setWithdrawals(wd.data);
  };
  useEffect(() => { load(); }, [user]);
  useWalletRealtime(user?.id, load);

  const addBank = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = accountSchema.safeParse({ bank_name: bankName, account_holder_name: holder, account_number: acctNum });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    if (!user) return;
    const { error } = await supabase.from("bank_accounts").insert({ user_id: user.id, ...parsed.data });
    if (error) { toast.error(error.message); return; }
    toast.success("Bank account added");
    setBankName(""); setHolder(""); setAcctNum("");
    load();
  };

  const removeBank = async (id: string) => {
    const { error } = await supabase.from("bank_accounts").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Removed");
    load();
  };

  const withdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!bankId) { toast.error("Pick a bank account"); return; }
    if (!currency) { toast.error("Pick a wallet"); return; }
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    setSubmitting(true);
    const { error } = await supabase.rpc("request_withdrawal", {
      _bank_account_id: bankId, _currency: currency, _amount: amt,
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Withdrawal requested — pending review");
    setAmount("");
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Withdraw to bank</h1>
        <p className="text-muted-foreground">Manage saved bank accounts and request payouts.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Saved banks */}
        <Card>
          <CardHeader><CardTitle>Saved bank accounts</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {banks.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
            {banks.map((b) => (
              <div key={b.id} className="flex items-start justify-between rounded-lg border p-3">
                <div className="flex gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{b.bank_name}</p>
                    <p className="text-xs text-muted-foreground">{b.account_holder_name} · ••••{b.account_number.slice(-4)}</p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeBank(b.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}

            <form onSubmit={addBank} className="space-y-3 border-t pt-4">
              <p className="text-sm font-medium">Add a new account</p>
              <Input placeholder="Bank name" value={bankName} onChange={(e) => setBankName(e.target.value)} required />
              <Input placeholder="Account holder name" value={holder} onChange={(e) => setHolder(e.target.value)} required />
              <Input placeholder="Account number" value={acctNum} onChange={(e) => setAcctNum(e.target.value)} required />
              <Button type="submit" variant="outline" className="w-full">
                <Plus className="mr-2 h-4 w-4" /> Add account
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Withdraw form */}
        <Card>
          <CardHeader>
            <CardTitle>Request withdrawal</CardTitle>
            <CardDescription>Funds are deducted immediately and processed by an admin.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={withdraw} className="space-y-4">
              <div className="space-y-2">
                <Label>To bank</Label>
                <Select value={bankId} onValueChange={setBankId}>
                  <SelectTrigger><SelectValue placeholder={banks.length ? "Pick account" : "Add a bank first"} /></SelectTrigger>
                  <SelectContent>
                    {banks.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.bank_name} · ••••{b.account_number.slice(-4)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Wallet</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger><SelectValue placeholder="Currency" /></SelectTrigger>
                    <SelectContent>
                      {wallets.map((w) => (
                        <SelectItem key={w.id} value={w.currency}>{w.currency} — {formatMoney(w.balance, w.currency)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Amount</Label>
                  <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={submitting || !banks.length}>
                <ArrowUpFromLine className="mr-2 h-4 w-4" />
                {submitting ? "Requesting..." : "Request withdrawal"}
              </Button>
            </form>

            {withdrawals.length > 0 && (
              <div className="mt-6 space-y-2">
                <p className="text-sm font-medium">Recent withdrawals</p>
                {withdrawals.map((w) => (
                  <div key={w.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                    <div>
                      <p className="font-medium">{formatMoney(w.amount, w.currency)}</p>
                      <p className="text-xs text-muted-foreground">{new Date(w.created_at).toLocaleString()}</p>
                    </div>
                    <Badge variant={w.status === "completed" ? "default" : w.status === "failed" ? "destructive" : "secondary"} className="capitalize">{w.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
