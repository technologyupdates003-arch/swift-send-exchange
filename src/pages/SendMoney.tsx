import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase as sb } from "@/integrations/supabase/client";
const supabase = sb as any;
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { Send } from "lucide-react";

const schema = z.object({
  to_email: z.string().trim().email("Invalid email").max(255),
  currency: z.string().min(1, "Pick a wallet"),
  amount: z.number().positive("Amount must be > 0"),
  description: z.string().max(200).optional(),
});

interface Wallet { id: string; currency: string; balance: number; }

export default function SendMoney() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [toEmail, setToEmail] = useState("");
  const [currency, setCurrency] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("wallets").select("*").order("currency").then(({ data }) => {
      if (data) {
        setWallets(data as any);
        if (data.length && !currency) setCurrency((data[0] as any).currency);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const selected = wallets.find((w) => w.currency === currency);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({
      to_email: toEmail,
      currency,
      amount: parseFloat(amount),
      description: description || undefined,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (selected && parsed.data.amount > Number(selected.balance)) {
      toast.error("Insufficient balance");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc("transfer_funds", {
      _to_email: parsed.data.to_email,
      _currency: parsed.data.currency as any,
      _amount: parsed.data.amount,
      _description: parsed.data.description ?? null,
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Transfer complete");
    navigate("/transactions");
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Send money</h1>
        <p className="text-muted-foreground">Wallet-to-wallet transfer to another AbanRemit user.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transfer details</CardTitle>
          <CardDescription>Funds arrive instantly in the recipient's wallet.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Recipient email</Label>
              <Input id="email" type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} required />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>From wallet</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger><SelectValue placeholder="Pick wallet" /></SelectTrigger>
                  <SelectContent>
                    {wallets.map((w) => (
                      <SelectItem key={w.id} value={w.currency}>
                        {w.currency} — {formatMoney(w.balance, w.currency)}
                      </SelectItem>
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

            <Button type="submit" className="w-full" disabled={submitting || !wallets.length}>
              <Send className="mr-2 h-4 w-4" />
              {submitting ? "Sending..." : "Send transfer"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
