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
import { toast } from "sonner";
import { ALL_CURRENCIES, formatMoney } from "@/lib/format";
import { CreditCard, Smartphone, Wallet } from "lucide-react";

const supabase = sb as any;
const cardSchema = z.object({
  number: z.string().regex(/^\d{16}$/, "Card number must be 16 digits"),
  expiry: z.string().regex(/^(0[1-9]|1[0-2])\/\d{2}$/, "Use MM/YY"),
  cvv: z.string().regex(/^\d{3,4}$/, "Invalid CVV"),
  amount: z.number().positive("Amount must be > 0"),
});
const stkSchema = z.object({
  phone: z.string().regex(/^(?:\+?254|0)?[17]\d{8}$/, "Invalid Kenyan phone"),
  amount: z.number().positive("Amount must be > 0"),
});

interface Wallet { id: string; currency: string; balance: number; }

export default function FundWallet() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [wallets, setWallets] = useState<Wallet[]>([]);

  // Card
  const [cardCurrency, setCardCurrency] = useState("USD");
  const [cardNum, setCardNum] = useState("");
  const [exp, setExp] = useState("");
  const [cvv, setCvv] = useState("");
  const [cardAmt, setCardAmt] = useState("");
  const [cardLoading, setCardLoading] = useState(false);

  // STK
  const [phone, setPhone] = useState("");
  const [stkAmt, setStkAmt] = useState("");
  const [stkLoading, setStkLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("wallets").select("*").order("currency").then(({ data }: any) => {
      if (data) setWallets(data);
    });
  }, [user]);

  const reload = async () => {
    const { data } = await supabase.from("wallets").select("*").order("currency");
    if (data) setWallets(data);
  };

  const fundCard = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = cardSchema.safeParse({
      number: cardNum.replace(/\s/g, ""),
      expiry: exp,
      cvv,
      amount: parseFloat(cardAmt),
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    setCardLoading(true);
    const { data, error } = await supabase.functions.invoke("paystack-init", {
      body: { amount: parsed.data.amount, currency: cardCurrency, last4: parsed.data.number.slice(-4) },
    });
    setCardLoading(false);
    if (error || !data?.success) { toast.error(error?.message || data?.error || "Funding failed"); return; }
    toast.success(`${formatMoney(parsed.data.amount, cardCurrency)} added to ${cardCurrency} wallet`);
    setCardNum(""); setExp(""); setCvv(""); setCardAmt("");
    reload();
  };

  const fundStk = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = stkSchema.safeParse({ phone, amount: parseFloat(stkAmt) });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    setStkLoading(true);
    toast.info("STK push sent — check your phone");
    const { data, error } = await supabase.functions.invoke("intasend-stk", {
      body: { phone: parsed.data.phone, amount: parsed.data.amount },
    });
    setStkLoading(false);
    if (error || !data?.success) { toast.error(error?.message || data?.error || "STK failed"); return; }
    toast.success(`KES ${parsed.data.amount} added to KES wallet`);
    setPhone(""); setStkAmt("");
    reload();
  };

  return (
    <div className="space-y-6 max-w-2xl pb-20 md:pb-0">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Fund wallet</h1>
        <p className="text-muted-foreground">Add money via card or M-Pesa.</p>
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

      <Tabs defaultValue="card">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="card"><CreditCard className="mr-2 h-4 w-4" />Card</TabsTrigger>
          <TabsTrigger value="mpesa"><Smartphone className="mr-2 h-4 w-4" />M-Pesa</TabsTrigger>
        </TabsList>

        <TabsContent value="card">
          <Card>
            <CardHeader>
              <CardTitle>Pay with card</CardTitle>
              <CardDescription>Powered by Paystack. Test mode: any 16-digit card works.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={fundCard} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Currency</Label>
                    <Select value={cardCurrency} onValueChange={setCardCurrency}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ALL_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Amount</Label>
                    <Input type="number" min="0" step="0.01" value={cardAmt} onChange={(e) => setCardAmt(e.target.value)} required />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Card number</Label>
                  <Input inputMode="numeric" maxLength={19} placeholder="4242 4242 4242 4242" value={cardNum}
                    onChange={(e) => setCardNum(e.target.value.replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 "))} required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Expiry</Label>
                    <Input placeholder="MM/YY" maxLength={5} value={exp} onChange={(e) => {
                      let v = e.target.value.replace(/\D/g, "");
                      if (v.length >= 3) v = v.slice(0, 2) + "/" + v.slice(2, 4);
                      setExp(v);
                    }} required />
                  </div>
                  <div className="space-y-2">
                    <Label>CVV</Label>
                    <Input inputMode="numeric" maxLength={4} value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, ""))} required />
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={cardLoading}>
                  {cardLoading ? "Processing..." : "Pay & fund wallet"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mpesa">
          <Card>
            <CardHeader>
              <CardTitle>M-Pesa STK Push</CardTitle>
              <CardDescription>Powered by IntaSend. Funds your KES wallet.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={fundStk} className="space-y-4">
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input type="tel" placeholder="0712345678" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Amount (KES)</Label>
                  <Input type="number" min="10" step="1" value={stkAmt} onChange={(e) => setStkAmt(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full" disabled={stkLoading}>
                  {stkLoading ? "Sending STK..." : "Send STK & fund"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
