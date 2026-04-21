import { useEffect, useMemo, useState } from "react";
import { supabase as sb } from "@/integrations/supabase/client";
const supabase = sb as any;
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, FileText, CheckCircle2, Clock, XCircle } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface VPTx {
  id: string;
  reference: string;
  flow: string;
  amount: number;
  currency: string;
  status: string;
  provider_reference: string | null;
  created_at: string;
  completed_at: string | null;
}

const statusToSettlement = (s: string) => {
  if (s === "completed" || s === "success" || s === "settled") return "settled";
  if (s === "failed" || s === "cancelled") return "not_settled";
  return "pending";
};

const StatusBadge = ({ status }: { status: string }) => {
  const settled = status === "completed" || status === "success" || status === "settled";
  const failed = status === "failed" || status === "cancelled";
  const Icon = settled ? CheckCircle2 : failed ? XCircle : Clock;
  return (
    <Badge variant={settled ? "secondary" : failed ? "destructive" : "outline"} className="capitalize gap-1">
      <Icon className="h-3 w-3" /> {status}
    </Badge>
  );
};

export default function Reports() {
  const { user } = useAuth();
  const [rows, setRows] = useState<VPTx[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [flowFilter, setFlowFilter] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("virtualpay_transactions")
      .select("id, reference, flow, amount, currency, status, provider_reference, created_at, completed_at")
      .order("created_at", { ascending: false })
      .then(({ data }: any) => {
        if (data) setRows(data as VPTx[]);
        setLoading(false);
      });
  }, [user]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (flowFilter !== "all" && r.flow !== flowFilter) return false;
      if (from && new Date(r.created_at) < new Date(from)) return false;
      if (to && new Date(r.created_at) > new Date(to + "T23:59:59")) return false;
      return true;
    });
  }, [rows, statusFilter, flowFilter, from, to]);

  const totals = useMemo(() => {
    const settled = filtered.filter((r) => statusToSettlement(r.status) === "settled");
    const pending = filtered.filter((r) => statusToSettlement(r.status) === "pending");
    return {
      count: filtered.length,
      settledCount: settled.length,
      pendingCount: pending.length,
      settledAmount: settled.reduce((s, r) => s + Number(r.amount), 0),
    };
  }, [filtered]);

  const exportPdf = () => {
    if (filtered.length === 0) {
      toast.error("No transactions to export");
      return;
    }
    const doc = new jsPDF();
    const dateStr = new Date().toLocaleString();

    doc.setFontSize(16);
    doc.text("Transaction Report", 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generated: ${dateStr}`, 14, 25);
    doc.text(`Account: ${user?.email ?? ""}`, 14, 30);

    if (from || to) {
      doc.text(`Period: ${from || "—"} to ${to || "—"}`, 14, 35);
    }

    doc.setTextColor(0);
    doc.setFontSize(11);
    doc.text(`Total: ${totals.count}   Settled: ${totals.settledCount}   Pending: ${totals.pendingCount}`, 14, 44);

    autoTable(doc, {
      startY: 50,
      head: [["Date", "Reference", "Flow", "Amount", "Currency", "Status", "Settlement", "Provider Ref"]],
      body: filtered.map((r) => [
        new Date(r.created_at).toLocaleString(),
        r.reference,
        r.flow,
        Number(r.amount).toFixed(2),
        r.currency,
        r.status,
        statusToSettlement(r.status),
        r.provider_reference || "—",
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 30, 60] },
    });

    doc.save(`transaction-report-${Date.now()}.pdf`);
    toast.success("PDF exported");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Transaction Reports</h1>
          <p className="text-muted-foreground">View transaction & settlement status. Export as PDF.</p>
        </div>
        <Button onClick={exportPdf} className="gap-2">
          <Download className="h-4 w-4" /> Export PDF
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Transactions</p><p className="text-2xl font-bold">{totals.count}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Settled</p><p className="text-2xl font-bold text-success">{totals.settledCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Pending</p><p className="text-2xl font-bold">{totals.pendingCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Settled volume</p><p className="text-lg font-bold">{formatMoney(totals.settledAmount, filtered[0]?.currency || "USD")}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4" /> Filters</CardTitle>
          <CardDescription>Narrow the report before exporting.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Flow</Label>
            <Select value={flowFilter} onValueChange={setFlowFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                <SelectItem value="payout">Payout</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">No transactions match the filters.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Flow</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Settlement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{r.reference}</TableCell>
                    <TableCell className="capitalize text-xs">{r.flow.replace("_", " ")}</TableCell>
                    <TableCell className="text-right font-medium">{formatMoney(Number(r.amount), r.currency)}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="capitalize text-xs">{statusToSettlement(r.status).replace("_", " ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
