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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { Send, Smartphone, AtSign } from "lucide-react";
import { PinDialog } from "@/components/PinDialog";
import { usePinGuard } from "@/hooks/usePinGuard";

const supabase = sb as any;

const walletSchema = z.object({
  to_email: z.string().trim().email("Invalid email").max(255),
  currency: z.string().min(1, "Pick a wallet"),
  amount: z.number().positive("Amount must be > 0"),
  description: z.string().max(200).optional(),
});
const mpesaSchema = z.object({
  phone: z.string().regex(/^(?:\+?254|0)?[17]\d{8}$/, "Invalid Kenyan phone"),
  amount: z.number().positive("Amount must be > 0"),
});

interface Wallet { id: string; currency: string; balance: number; }

export default function SendMoney() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { hasPin } = usePinGuard();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<((pin: string) => Promise<void>) | null>(null);

  // Wallet send
  const [toEmail, setToEmail] = useState("");
  const [currency, setCurrency] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [recipientStatus, setRecipientStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");

  // M-Pesa send
  const [phone, setPhone] = useState("");
  const [mAmt, setMAmt] = useState("");

  useEffect(() => {
    if (!user) return;
    supabase.from("wallets").select("*").order("currency").then(({ data }: any) => {
      if (data) {
        setWallets(data);
        if (data.length && !currency) setCurrency(data[0].currency);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Validate recipient email
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!toEmail || !z.string().email().safeParse(toEmail).success) {
        setRecipientStatus("idle"); return;
      }
      setRecipientStatus("checking");
      const { data } = await supabase.from("profiles").select("id").eq("email", toEmail).maybeSingle();
      setRecipientStatus(data ? "valid" : "invalid");
    }, 400);
    return () => clearTimeout(t);
  }, [toEmail]);

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
    const parsed = walletSchema.safeParse({
      to_email: toEmail, currency, amount: parseFloat(amount),
      description: description || undefined,
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    if (recipientStatus !== "valid") { toast.error("Recipient is not a registered user"); return; }
    const sel = wallets.find((w) => w.currency === currency);
    if (sel && parsed.data.amount > Number(sel.balance)) { toast.error("Insufficient balance"); return; }

    requirePin(async (pin) => {
      const { error } = await supabase.rpc("transfer_funds", {
        _to_email: parsed.data.to_email,
        _currency: parsed.data.currency,
        _amount: parsed.data.amount,
        _description: parsed.data.description ?? null,
        _pin: pin,
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
      // trigger B2C edge function (auto)
      if (data?.payout_id) {
        await supabase.functions.invoke("intasend-b2c", { body: { payout_id: data.payout_id } });
      }
      toast.success("M-Pesa send queued");
      navigate("/transactions");
    });
  };

  return (
    <div className="space-y-6 max-w-xl pb-20 md:pb-0">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Send money</h1>
        <p className="text-muted-foreground">To another AbanRemit user or to an M-Pesa phone number.</p>
      </div>

      <Tabs defaultValue="wallet">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="wallet"><AtSign className="mr-2 h-4 w-4" />To wallet</TabsTrigger>
          <TabsTrigger value="mpesa"><Smartphone className="mr-2 h-4 w-4" />To M-Pesa</TabsTrigger>
        </TabsList>

        <TabsContent value="wallet">
          <Card>
            <CardHeader>
              <CardTitle>Send to wallet</CardTitle>
              <CardDescription>We validate the recipient before you send.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSendWallet} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Recipient email</Label>
                  <Input id="email" type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} required />
                  {recipientStatus === "checking" && <p className="text-xs text-muted-foreground">Checking…</p>}
                  {recipientStatus === "valid" && <p className="text-xs text-success-foreground" style={{color: "hsl(var(--success))"}}>✓ Valid AbanRemit user</p>}
                  {recipientStatus === "invalid" && <p className="text-xs text-destructive">Not a registered user</p>}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>From wallet</Label>
                    <Select value={currency} onValueChange={setCurrency}>
                      <SelectTrigger><SelectValue placeholder="Pick wallet" /></SelectTrigger>
                      <SelectContent>
                        {wallets.map((w) => (
                          <SelectItem key={w.id} value={w.currency}>{w.currency} — {formatMoney(w.balance, w.currency)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="amt">Amount</Label>
                    <Input id="amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="desc">Note (optional)</Label>
                  <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} rows={2} />
                </div>
                <Button type="submit" className="w-full" disabled={!wallets.length}>
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
              <CardDescription>Deducted from your KES wallet. Auto-paid out via IntaSend.</CardDescription>
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
