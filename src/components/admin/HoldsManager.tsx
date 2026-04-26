import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ShieldAlert, Loader2, RefreshCw, Undo2, CheckCircle2 } from "lucide-react";
import { formatMoney, ALL_CURRENCIES } from "@/lib/format";

const sb = supabase as any;

interface Reversal {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  reason: string;
  status: string; // held | released | refunded
  created_at: string;
  released_at: string | null;
}

export default function HoldsManager() {
  const [items, setItems] = useState<Reversal[]>([]);
  const [profiles, setProfiles] = useState<Record<string, { email: string; full_name: string | null }>>({});
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [targetUser, setTargetUser] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const [actionDialog, setActionDialog] = useState<{ hold: Reversal; action: "refund" | "release" } | null>(null);
  const [note, setNote] = useState("");

  const load = async () => {
    setLoading(true);
    const { data } = await sb.from("transaction_reversals").select("*").order("created_at", { ascending: false }).limit(200);
    if (data) {
      setItems(data);
      const ids = Array.from(new Set(data.map((r: Reversal) => r.user_id)));
      if (ids.length) {
        const { data: pp } = await sb.from("profiles").select("id,email,full_name").in("id", ids);
        const map: Record<string, { email: string; full_name: string | null }> = {};
        (pp || []).forEach((p: any) => { map[p.id] = { email: p.email, full_name: p.full_name }; });
        setProfiles(map);
      }
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const createHold = async () => {
    if (!targetUser || !amount || !reason || reason.length < 5) {
      toast.error("User ID, amount, and reason (min 5 chars) required");
      return;
    }
    setWorking(true);
    const { data, error } = await sb.rpc("admin_hold_funds", {
      _target_user: targetUser,
      _currency: currency,
      _amount: parseFloat(amount),
      _reason: reason,
    });
    setWorking(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Funds held");
    setOpen(false); setTargetUser(""); setAmount(""); setReason("");
    load();
  };

  const runAction = async () => {
    if (!actionDialog || note.length < 5) { toast.error("Note (min 5 chars) required"); return; }
    setWorking(true);
    const { error } = await sb.rpc("admin_release_hold", {
      _hold_id: actionDialog.hold.id,
      _action: actionDialog.action,
      _note: note,
    });
    setWorking(false);
    if (error) { toast.error(error.message); return; }
    toast.success(actionDialog.action === "refund" ? "Refunded to user" : "Released to operations");
    setActionDialog(null); setNote("");
    load();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-primary" /> Reversals & holds</CardTitle>
            <CardDescription>Move funds out of a wallet temporarily, then refund or release to ops.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
            <Button size="sm" onClick={() => setOpen(true)}>New hold</Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No holds yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((h) => {
                  const p = profiles[h.user_id];
                  return (
                    <TableRow key={h.id}>
                      <TableCell className="text-xs">
                        <div className="font-medium">{p?.full_name || "—"}</div>
                        <div className="text-muted-foreground">{p?.email || h.user_id.slice(0, 8)}</div>
                      </TableCell>
                      <TableCell className="font-mono">{formatMoney(h.amount, h.currency)}</TableCell>
                      <TableCell className="max-w-xs truncate text-xs">{h.reason}</TableCell>
                      <TableCell>
                        <Badge variant={h.status === "held" ? "default" : h.status === "refunded" ? "secondary" : "outline"}>
                          {h.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        {h.status === "held" && (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => { setActionDialog({ hold: h, action: "refund" }); setNote(""); }}>
                              <Undo2 className="mr-1 h-3 w-3" />Refund
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setActionDialog({ hold: h, action: "release" }); setNote(""); }}>
                              <CheckCircle2 className="mr-1 h-3 w-3" />Release
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hold user funds</DialogTitle>
            <DialogDescription>Debits the user's wallet immediately. You can refund or release later.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Target user ID</Label>
              <Input value={targetUser} onChange={(e) => setTargetUser(e.target.value)} placeholder="uuid" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Suspected fraud / chargeback / compliance review…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={createHold} disabled={working}>
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : "Hold funds"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!actionDialog} onOpenChange={(v) => { if (!v) setActionDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionDialog?.action === "refund" ? "Refund to user" : "Release to operations"}</DialogTitle>
            <DialogDescription>
              {actionDialog?.action === "refund"
                ? "Returns the held amount to the user's wallet."
                : "Marks the hold as released — funds stay off the user's wallet (treated as ops revenue/loss)."}
            </DialogDescription>
          </DialogHeader>
          {actionDialog && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="font-mono">{formatMoney(actionDialog.hold.amount, actionDialog.hold.currency)}</div>
                <div className="text-xs text-muted-foreground mt-1">{actionDialog.hold.reason}</div>
              </div>
              <div className="space-y-2">
                <Label>Resolution note</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Investigation outcome…" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setActionDialog(null)}>Cancel</Button>
            <Button onClick={runAction} disabled={working}>
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
