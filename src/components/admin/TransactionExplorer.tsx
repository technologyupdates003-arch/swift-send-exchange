import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Download } from "lucide-react";
import { formatMoney } from "@/lib/format";

const sb = supabase as any;

interface Txn {
  id: string; user_id: string; type: string; amount: number; currency: string;
  status: string; fee: number; description: string | null; created_at: string;
}
interface Profile { id: string; email: string; full_name: string | null; }

const TYPES = ["all", "deposit", "withdrawal", "transfer_in", "transfer_out", "exchange"];
const STATUSES = ["all", "completed", "pending", "failed"];

export default function TransactionExplorer() {
  const [txns, setTxns] = useState<Txn[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [days, setDays] = useState(7);

  const load = async () => {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await sb.from("transactions")
      .select("id,user_id,type,amount,currency,status,fee,description,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    setTxns(data ?? []);
    const ids = Array.from(new Set((data ?? []).map((t: Txn) => t.user_id)));
    if (ids.length > 0) {
      const { data: profs } = await sb.from("profiles").select("id,email,full_name").in("id", ids);
      const map: Record<string, Profile> = {};
      (profs ?? []).forEach((p: Profile) => { map[p.id] = p; });
      setProfiles(map);
    }
  };
  useEffect(() => { load(); }, [days]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return txns.filter((t) => {
      if (type !== "all" && t.type !== type) return false;
      if (status !== "all" && t.status !== status) return false;
      if (q) {
        const p = profiles[t.user_id];
        const hay = `${t.id} ${t.description ?? ""} ${p?.email ?? ""} ${p?.full_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [txns, type, status, search, profiles]);

  const totals = useMemo(() => {
    const byCur: Record<string, { volume: number; fees: number }> = {};
    filtered.forEach((t) => {
      byCur[t.currency] ??= { volume: 0, fees: 0 };
      byCur[t.currency].volume += Number(t.amount);
      byCur[t.currency].fees += Number(t.fee);
    });
    return byCur;
  }, [filtered]);

  const exportCsv = () => {
    const rows = [
      ["id", "when", "user_email", "type", "amount", "currency", "fee", "status", "description"],
      ...filtered.map((t) => [
        t.id, new Date(t.created_at).toISOString(),
        profiles[t.user_id]?.email ?? "", t.type, t.amount, t.currency, t.fee, t.status, t.description ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `transactions-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle>All transactions</CardTitle>
            <CardDescription>{filtered.length} transactions in window · last {days} days</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={exportCsv}><Download className="mr-1 h-3 w-3" />Export CSV</Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-md border bg-background px-2 text-sm h-10">
            {TYPES.map((t) => <option key={t} value={t}>{t === "all" ? "All types" : t.replace("_", " ")}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border bg-background px-2 text-sm h-10">
            {STATUSES.map((s) => <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>)}
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-md border bg-background px-2 text-sm h-10">
            <option value={1}>Last 24h</option><option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search id, user, description" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {Object.keys(totals).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(totals).map(([cur, t]) => (
              <Badge key={cur} variant="secondary" className="font-mono">
                {cur}: vol {formatMoney(t.volume, cur)} · fees {formatMoney(t.fees, cur)}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[600px] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Fee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t) => {
                const p = profiles[t.user_id];
                return (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(t.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{p?.email ?? t.user_id.slice(0, 8)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] capitalize">{t.type.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatMoney(t.amount, t.currency)}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">{t.fee > 0 ? formatMoney(t.fee, t.currency) : "—"}</TableCell>
                    <TableCell><Badge variant={t.status === "completed" ? "default" : t.status === "failed" ? "destructive" : "secondary"} className="text-[10px]">{t.status}</Badge></TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground max-w-xs truncate">{t.description}</TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No transactions match.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
