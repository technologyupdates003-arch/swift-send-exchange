import { useEffect, useState } from "react";
import { supabase as sb } from "@/integrations/supabase/client";
const supabase = sb as any;
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { useWalletRealtime } from "@/hooks/useWalletRealtime";

interface Tx {
  id: string; type: string; amount: number; currency: string;
  status: string; description: string | null; created_at: string;
}

export default function Transactions() {
  const { user } = useAuth();
  const [txs, setTxs] = useState<Tx[]>([]);
  const [filter, setFilter] = useState<string>("all");

  const load = () => {
    supabase.from("transactions").select("*").order("created_at", { ascending: false }).then(({ data }: any) => {
      if (data) setTxs(data as any);
    });
  };
  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);
  useWalletRealtime(user?.id, load);

  const filtered = filter === "all" ? txs : txs.filter((t) => t.type === filter);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Transactions</h1>
          <p className="text-muted-foreground">All your account activity.</p>
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="transfer_in">Received</SelectItem>
            <SelectItem value="transfer_out">Sent</SelectItem>
            <SelectItem value="deposit">Deposits</SelectItem>
            <SelectItem value="withdrawal">Withdrawals</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">No transactions to show</p>
          ) : (
            <ul className="divide-y">
              {filtered.map((tx) => {
                const incoming = tx.type === "transfer_in" || tx.type === "deposit";
                return (
                  <li key={tx.id} className="flex items-center justify-between gap-3 p-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${incoming ? "bg-success/15 text-success" : "bg-primary/15 text-primary"}`}>
                        {incoming ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium capitalize">{tx.type.replace("_", " ")}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {tx.description || "—"} · {new Date(tx.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <p className={`font-semibold ${incoming ? "text-success" : ""}`}>
                        {incoming ? "+" : "-"}{formatMoney(tx.amount, tx.currency)}
                      </p>
                      <Badge variant={tx.status === "completed" ? "secondary" : "outline"} className="text-xs capitalize">
                        {tx.status}
                      </Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
