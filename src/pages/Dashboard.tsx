import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Send, Wallet as WalletIcon, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { formatMoney } from "@/lib/format";

interface Wallet { id: string; currency: string; balance: number; }
interface Tx { id: string; type: string; amount: number; currency: string; description: string | null; created_at: string; }

export default function Dashboard() {
  const { user } = useAuth();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [recent, setRecent] = useState<Tx[]>([]);
  const [profileName, setProfileName] = useState("");

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [w, t, p] = await Promise.all([
        supabase.from("wallets").select("*").order("currency"),
        supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(5),
        supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
      ]);
      if (w.data) setWallets(w.data as any);
      if (t.data) setRecent(t.data as any);
      if (p.data?.full_name) setProfileName(p.data.full_name);
    })();
  }, [user]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome{profileName ? `, ${profileName.split(" ")[0]}` : ""}
        </h1>
        <p className="text-muted-foreground">Here's a snapshot of your Swift Remit account.</p>
      </div>

      {/* Hero CTA */}
      <Card className="overflow-hidden border-0 bg-[image:var(--gradient-hero)] text-hero-foreground shadow-[var(--shadow-brand)]">
        <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm opacity-80">Send money instantly</p>
            <h2 className="text-2xl font-bold">Move funds across borders</h2>
          </div>
          <div className="flex gap-2">
            <Button asChild size="lg">
              <Link to="/send"><Send className="mr-2 h-4 w-4" /> Send money</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link to="/wallets"><WalletIcon className="mr-2 h-4 w-4" /> Wallets</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Wallets */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Your wallets</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {wallets.map((w) => (
            <Card key={w.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm font-medium text-muted-foreground">
                  {w.currency}
                  <WalletIcon className="h-4 w-4" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatMoney(w.balance, w.currency)}</p>
              </CardContent>
            </Card>
          ))}
          {wallets.length === 0 && (
            <p className="text-sm text-muted-foreground">No wallets yet. Visit Wallets to add one.</p>
          )}
        </div>
      </section>

      {/* Recent transactions */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent activity</h2>
          <Button asChild variant="ghost" size="sm"><Link to="/transactions">View all</Link></Button>
        </div>
        <Card>
          <CardContent className="p-0">
            {recent.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">No transactions yet</p>
            ) : (
              <ul className="divide-y">
                {recent.map((tx) => {
                  const incoming = tx.type === "transfer_in" || tx.type === "deposit";
                  return (
                    <li key={tx.id} className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-9 w-9 items-center justify-center rounded-full ${incoming ? "bg-success/15 text-success" : "bg-primary/15 text-primary"}`}>
                          {incoming ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                        </div>
                        <div>
                          <p className="text-sm font-medium capitalize">{tx.type.replace("_", " ")}</p>
                          <p className="text-xs text-muted-foreground">{new Date(tx.created_at).toLocaleString()}</p>
                        </div>
                      </div>
                      <p className={`font-semibold ${incoming ? "text-success" : ""}`}>
                        {incoming ? "+" : "-"}{formatMoney(tx.amount, tx.currency)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
