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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Building2, Plus, Trash2, Smartphone, ArrowUpFromLine, AtSign } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { PinDialog } from "@/components/PinDialog";
import { usePinGuard } from "@/hooks/usePinGuard";

const supabase = sb as any;

const bankFormSchema = z.object({
  bank_name: z.string().trim().min(2).max(100),
  account_holder_name: z.string().trim().min(2).max(100),
  account_number: z.string().trim().min(4).max(34),
});
const mpesaSchema = z.object({ phone: z.string().regex(/^(?:\+?254|0)?[17]\d{8}$/, "Invalid Kenyan phone"), amount: z.number().positive() });
const walletSchema = z.object({ to_email: z.string().email(), currency: z.string().min(1), amount: z.number().positive() });

interface Bank { id: string; bank_name: string; account_holder_name: string; account_number: string; }
interface Wallet { id: string; currency: string; balance: number; }

export default function Withdraw() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { hasPin } = usePinGuard();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);

  const [pinOpen, setPinOpen] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<((pin: string) => Promise<void>) | null>(null);

  // Bank
  const [bankId, setBankId] = useState("");
  const [bCurrency, setBCurrency] = useState("");
  const [bAmt, setBAmt] = useState("");

  // M-Pesa
  const [mPhone, setMPhone] = useState("");
  const [mAmt, setMAmt] = useState("");

  // Wallet
  const [wEmail, setWEmail] = useState("");
  const [wCurrency, setWCurrency] = useState("");
  const [wAmt, setWAmt] = useState("");
  const [recipientStatus, setRecipientStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");

  // Add bank inline
  const [addOpen, setAddOpen] = useState(false);
  const [bankName, setBankName] = useState("");
  const [holder, setHolder] = useState("");
  const [acctNum, setAcctNum] = useState("");

  const load = async () => {
    if (!user) return;
    const [b, w] = await Promise.all([
      supabase.from("bank_accounts").select("*").order("created_at", { ascending: false }),
      supabase.from("wallets").select("*").order("currency"),
    ]);
    if (b.data) setBanks(b.data);
    if (w.data) setWallets(w.data);
  };
  useEffect(() => { load(); }, [user]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!wEmail || !z.string().email().safeParse(wEmail).success) { setRecipientStatus("idle"); return; }
      setRecipientStatus("checking");
      const { data } = await supabase.from("profiles").select("id").eq("email", wEmail).maybeSingle();
      setRecipientStatus(data ? "valid" : "invalid");
    }, 400);
    return () => clearTimeout(t);
  }, [wEmail]);

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

  const addBank = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = bankFormSchema.safeParse({ bank_name: bankName, account_holder_name: holder, account_number: acctNum });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    if (!user) return;
    const { error } = await supabase.from("bank_accounts").insert({ user_id: user.id, ...parsed.data });
    if (error) { toast.error(error.message); return; }
    toast.success("Bank added"); setBankName(""); setHolder(""); setAcctNum(""); setAddOpen(false); load();
  };

  const removeBank = async (id: string) => {
    const { error } = await supabase.from("bank_accounts").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const onBank = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankId || !bCurrency || !bAmt) { toast.error("Fill all fields"); return; }
    const amt = parseFloat(bAmt);
    requirePin(async (pin) => {
      const { data, error } = await supabase.rpc("request_withdrawal", {
        _bank_account_id: bankId, _currency: bCurrency, _amount: amt, _pin: pin,
      });
      if (error) { toast.error(error.message); return; }
      // Trigger VirtualPay payout immediately (best-effort; admin can also retry)
      if (data?.withdrawal_id) {
        const { data: payRes, error: payErr } = await supabase.functions.invoke("virtualpay-payout", {
          body: { withdrawal_id: data.withdrawal_id },
        });
        if (payErr || !payRes?.success) {
          toast.warning("Withdrawal logged. Bank payout queued for admin review.");
        } else {
          toast.success("Bank payout sent via VirtualPay");
        }
      } else {
        toast.success("Withdrawal requested");
      }
      setBAmt(""); load();
      navigate("/transactions");
    });
  };

  const onMpesa = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = mpesaSchema.safeParse({ phone: mPhone, amount: parseFloat(mAmt) });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    requirePin(async (pin) => {
      const { data, error } = await supabase.rpc("withdraw_to_mpesa", {
        _phone: parsed.data.phone, _amount: parsed.data.amount, _pin: pin,
      });
      if (error) { toast.error(error.message); return; }
      if (data?.payout_id) await supabase.functions.invoke("intasend-b2c", { body: { payout_id: data.payout_id } });
      toast.success("M-Pesa withdrawal sent"); setMAmt(""); load();
      navigate("/transactions");
    });
  };

  const onWallet = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = walletSchema.safeParse({ to_email: wEmail, currency: wCurrency, amount: parseFloat(wAmt) });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    if (recipientStatus !== "valid") { toast.error("Recipient not registered"); return; }
    requirePin(async (pin) => {
      const { error } = await supabase.rpc("transfer_funds", {
        _to_email: parsed.data.to_email, _currency: parsed.data.currency,
        _amount: parsed.data.amount, _description: "Withdrawal to wallet", _pin: pin,
      });
      if (error) { toast.error(error.message); return; }
      toast.success("Transferred"); setWAmt(""); load();
      navigate("/transactions");
    });
  };

  return (
    <div className="space-y-6 max-w-xl pb-20 md:pb-0">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Withdraw</h1>
        <p className="text-muted-foreground">Move money to your bank, M-Pesa, or another wallet.</p>
      </div>

      <Tabs defaultValue="bank">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="bank"><Building2 className="mr-1 h-4 w-4" />Bank</TabsTrigger>
          <TabsTrigger value="mpesa"><Smartphone className="mr-1 h-4 w-4" />M-Pesa</TabsTrigger>
          <TabsTrigger value="wallet"><AtSign className="mr-1 h-4 w-4" />Wallet</TabsTrigger>
        </TabsList>

        <TabsContent value="bank">
          <Card>
            <CardHeader>
              <CardTitle>Bank withdrawal</CardTitle>
              <CardDescription>Processed by an admin within 1 business day.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={onBank} className="space-y-4">
                <div className="space-y-2">
                  <Label>To bank</Label>
                  <Select value={bankId} onValueChange={setBankId}>
                    <SelectTrigger><SelectValue placeholder={banks.length ? "Pick account" : "Add a bank below"} /></SelectTrigger>
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
                    <Select value={bCurrency} onValueChange={setBCurrency}>
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
                    <Input type="number" min="0" step="0.01" value={bAmt} onChange={(e) => setBAmt(e.target.value)} />
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={!banks.length}>
                  <ArrowUpFromLine className="mr-2 h-4 w-4" /> Request withdrawal
                </Button>
              </form>

              <div className="border-t pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Saved bank accounts</p>
                  <Button variant="ghost" size="sm" onClick={() => setAddOpen(!addOpen)}>
                    <Plus className="mr-1 h-4 w-4" />Add
                  </Button>
                </div>
                <div className="mt-2 space-y-2">
                  {banks.length === 0 && <p className="text-xs text-muted-foreground">No accounts saved.</p>}
                  {banks.map((b) => (
                    <div key={b.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                      <span>{b.bank_name} · ••••{b.account_number.slice(-4)}</span>
                      <Button variant="ghost" size="icon" onClick={() => removeBank(b.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
                {addOpen && (
                  <form onSubmit={addBank} className="mt-3 space-y-2">
                    <Input placeholder="Bank name" value={bankName} onChange={(e) => setBankName(e.target.value)} required />
                    <Input placeholder="Account holder" value={holder} onChange={(e) => setHolder(e.target.value)} required />
                    <Input placeholder="Account number" value={acctNum} onChange={(e) => setAcctNum(e.target.value)} required />
                    <Button type="submit" variant="outline" size="sm" className="w-full">Save bank</Button>
                  </form>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mpesa">
          <Card>
            <CardHeader>
              <CardTitle>M-Pesa withdrawal</CardTitle>
              <CardDescription>Auto B2C payout to any Safaricom number.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onMpesa} className="space-y-4">
                <div className="space-y-2"><Label>Phone</Label>
                  <Input type="tel" placeholder="0712345678" value={mPhone} onChange={(e) => setMPhone(e.target.value)} required />
                </div>
                <div className="space-y-2"><Label>Amount (KES)</Label>
                  <Input type="number" min="10" value={mAmt} onChange={(e) => setMAmt(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full"><Smartphone className="mr-2 h-4 w-4" />Withdraw to M-Pesa</Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="wallet">
          <Card>
            <CardHeader>
              <CardTitle>Withdraw to another wallet</CardTitle>
              <CardDescription>Instant transfer to any AbanRemit user.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onWallet} className="space-y-4">
                <div className="space-y-2">
                  <Label>Recipient email</Label>
                  <Input type="email" value={wEmail} onChange={(e) => setWEmail(e.target.value)} required />
                  {recipientStatus === "valid" && <p className="text-xs" style={{color: "hsl(var(--success))"}}>✓ Valid AbanRemit user</p>}
                  {recipientStatus === "invalid" && <p className="text-xs text-destructive">Not registered</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Wallet</Label>
                    <Select value={wCurrency} onValueChange={setWCurrency}>
                      <SelectTrigger><SelectValue placeholder="Currency" /></SelectTrigger>
                      <SelectContent>
                        {wallets.map((w) => (
                          <SelectItem key={w.id} value={w.currency}>{w.currency} — {formatMoney(w.balance, w.currency)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>Amount</Label>
                    <Input type="number" min="0" step="0.01" value={wAmt} onChange={(e) => setWAmt(e.target.value)} required />
                  </div>
                </div>
                <Button type="submit" className="w-full"><AtSign className="mr-2 h-4 w-4" />Send to wallet</Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <PinDialog open={pinOpen} onClose={() => setPinOpen(false)} onSubmit={onPinSubmit} loading={pinLoading} />
    </div>
  );
}
