import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Search, Snowflake, Flame, ShieldPlus, ShieldMinus, Flag, Wallet as WalletIcon, Crown } from "lucide-react";
import { formatMoney, ALL_CURRENCIES } from "@/lib/format";

const sb = supabase as any;

interface Profile { id: string; email: string; full_name: string | null; phone_number: string | null; kyc_status: string; created_at: string; }
interface Wallet { id: string; user_id: string; currency: string; balance: number; is_frozen: boolean; }
interface Role { user_id: string; role: string; }
interface Txn { id: string; type: string; amount: number; currency: string; status: string; fee: number; description: string | null; created_at: string; }

const ROLES = ["admin", "finance_admin", "support_admin", "super_admin"] as const;

export default function UserManagement({ canManageRoles, canAdjustBalance }: {
  canManageRoles: boolean; canAdjustBalance: boolean;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Profile | null>(null);

  const load = async () => {
    const [p, w, r] = await Promise.all([
      sb.from("profiles").select("id,email,full_name,phone_number,kyc_status,created_at").order("created_at", { ascending: false }),
      sb.from("wallets").select("id,user_id,currency,balance,is_frozen"),
      sb.from("user_roles").select("user_id,role"),
    ]);
    if (p.data) setProfiles(p.data);
    if (w.data) setWallets(w.data);
    if (r.data) setRoles(r.data);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return profiles;
    return profiles.filter((p) =>
      (p.email || "").toLowerCase().includes(q) ||
      (p.full_name || "").toLowerCase().includes(q) ||
      (p.phone_number || "").toLowerCase().includes(q)
    );
  }, [profiles, search]);

  const userTotal = (uid: string) =>
    wallets.filter((w) => w.user_id === uid).map((w) => `${w.currency} ${Number(w.balance).toFixed(2)}`).join(" · ") || "—";

  const userRoles = (uid: string) => roles.filter((r) => r.user_id === uid).map((r) => r.role);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle>Users</CardTitle>
            <CardDescription>{filtered.length} of {profiles.length} users · click a row for full profile</CardDescription>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search name, email or phone" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead className="hidden md:table-cell">Phone</TableHead>
              <TableHead>KYC</TableHead>
              <TableHead className="hidden lg:table-cell">Balances</TableHead>
              <TableHead>Roles</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p) => {
              const ur = userRoles(p.id);
              return (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => setSelected(p)}>
                  <TableCell>
                    <div className="font-medium">{p.full_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{p.email}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm">{p.phone_number || "—"}</TableCell>
                  <TableCell><KycBadge status={p.kyc_status} /></TableCell>
                  <TableCell className="hidden lg:table-cell text-xs font-mono">{userTotal(p.id)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {ur.length === 0 && <span className="text-xs text-muted-foreground">user</span>}
                      {ur.map((r) => <Badge key={r} variant={r === "super_admin" ? "default" : "secondary"} className="text-[10px]">{r}</Badge>)}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>

      {selected && (
        <UserProfileDialog
          profile={selected}
          wallets={wallets.filter((w) => w.user_id === selected.id)}
          roles={userRoles(selected.id)}
          canManageRoles={canManageRoles}
          canAdjustBalance={canAdjustBalance}
          onClose={() => { setSelected(null); load(); }}
        />
      )}
    </Card>
  );
}

function KycBadge({ status }: { status: string }) {
  const variant = status === "approved" ? "default" : status === "rejected" ? "destructive" : "secondary";
  return <Badge variant={variant as any} className="capitalize text-[10px]">{status}</Badge>;
}

function UserProfileDialog({ profile, wallets, roles, canManageRoles, canAdjustBalance, onClose }: {
  profile: Profile; wallets: Wallet[]; roles: string[];
  canManageRoles: boolean; canAdjustBalance: boolean; onClose: () => void;
}) {
  const [txns, setTxns] = useState<Txn[]>([]);

  // Adjust balance form
  const [adjCurrency, setAdjCurrency] = useState<string>(wallets[0]?.currency ?? "USD");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjDirection, setAdjDirection] = useState<"credit" | "debit">("credit");

  // Flag form
  const [flagReason, setFlagReason] = useState("");
  const [flagSeverity, setFlagSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");

  useEffect(() => {
    sb.from("transactions").select("id,type,amount,currency,status,fee,description,created_at")
      .eq("user_id", profile.id).order("created_at", { ascending: false }).limit(50)
      .then(({ data }: any) => setTxns(data ?? []));
  }, [profile.id]);

  const adjust = async () => {
    const amt = parseFloat(adjAmount);
    if (!amt || amt <= 0) return toast.error("Invalid amount");
    if (adjReason.trim().length < 5) return toast.error("Reason must be at least 5 characters");
    const { data, error } = await sb.rpc("admin_adjust_balance", {
      _target_user: profile.id, _currency: adjCurrency, _amount: amt,
      _direction: adjDirection, _reason: adjReason,
    });
    if (error) return toast.error(error.message);
    toast.success(`Wallet ${adjDirection}ed: ${formatMoney(amt, adjCurrency)} (new balance ${formatMoney(Number(data?.after ?? 0), adjCurrency)})`);
    setAdjAmount(""); setAdjReason(""); onClose();
  };

  const toggleFreeze = async (w: Wallet) => {
    const reason = prompt(`Reason to ${w.is_frozen ? "unfreeze" : "freeze"} ${w.currency} wallet (min 5 chars):`);
    if (!reason || reason.trim().length < 5) return;
    const { error } = await sb.rpc("admin_freeze_wallet", {
      _target_user: profile.id, _currency: w.currency, _frozen: !w.is_frozen, _reason: reason,
    });
    if (error) return toast.error(error.message);
    toast.success(w.is_frozen ? "Wallet unfrozen" : "Wallet frozen");
    onClose();
  };

  const flag = async () => {
    if (flagReason.trim().length < 5) return toast.error("Reason required");
    const { error } = await sb.rpc("admin_flag_user", {
      _target_user: profile.id, _reason: flagReason, _severity: flagSeverity,
    });
    if (error) return toast.error(error.message);
    toast.success("User flagged");
    setFlagReason(""); onClose();
  };

  const setStatus = async (status: "active" | "pending" | "dormant" | "suspended") => {
    const reason = prompt(`Reason to set account ${status} (min 5 chars):`);
    if (!reason || reason.trim().length < 5) return;
    const { error } = await sb.rpc("admin_set_account_status", {
      _target_user: profile.id, _status: status, _reason: reason,
    });
    if (error) return toast.error(error.message);
    toast.success(`Account set to ${status}`);
    onClose();
  };

  const toggleRole = async (role: string, grant: boolean) => {
    const { error } = await sb.rpc("admin_set_role", { _target_user: profile.id, _role: role, _grant: grant });
    if (error) return toast.error(error.message);
    toast.success(grant ? `Granted ${role}` : `Revoked ${role}`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-primary" />{profile.full_name || "User"}
          </DialogTitle>
          <DialogDescription>{profile.email} · {profile.phone_number || "no phone"}</DialogDescription>
        </DialogHeader>

        {/* Wallets */}
        <section>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><WalletIcon className="h-4 w-4" />Wallets</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {wallets.length === 0 && <p className="text-xs text-muted-foreground">No wallets.</p>}
            {wallets.map((w) => (
              <div key={w.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-xs text-muted-foreground">{w.currency}</p>
                  <p className="text-lg font-semibold tabular-nums">{formatMoney(w.balance, w.currency)}</p>
                  {w.is_frozen && <Badge variant="destructive" className="mt-1 text-[10px]">Frozen</Badge>}
                </div>
                <Button size="sm" variant="outline" onClick={() => toggleFreeze(w)}>
                  {w.is_frozen ? <Flame className="mr-1 h-3 w-3" /> : <Snowflake className="mr-1 h-3 w-3" />}
                  {w.is_frozen ? "Unfreeze" : "Freeze"}
                </Button>
              </div>
            ))}
          </div>
        </section>

        {/* Adjust balance */}
        {canAdjustBalance && (
          <section className="rounded-lg border p-3 space-y-2">
            <h3 className="text-sm font-semibold">Adjust balance</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <select value={adjDirection} onChange={(e) => setAdjDirection(e.target.value as any)}
                className="rounded-md border bg-background px-2 text-sm h-10">
                <option value="credit">Credit (+)</option>
                <option value="debit">Debit (−)</option>
              </select>
              <select value={adjCurrency} onChange={(e) => setAdjCurrency(e.target.value)}
                className="rounded-md border bg-background px-2 text-sm h-10">
                {ALL_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <Input type="number" step="0.01" placeholder="Amount" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} />
              <Button onClick={adjust}>Apply</Button>
            </div>
            <Textarea placeholder="Reason (required, min 5 chars) — logged to audit trail"
              value={adjReason} onChange={(e) => setAdjReason(e.target.value)} rows={2} />
          </section>
        )}

        {/* Flag user */}
        <section className="rounded-lg border p-3 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Flag className="h-4 w-4" />Flag user</h3>
          <div className="grid grid-cols-3 gap-2">
            <select value={flagSeverity} onChange={(e) => setFlagSeverity(e.target.value as any)}
              className="rounded-md border bg-background px-2 text-sm h-10 col-span-1">
              <option value="low">Low</option><option value="medium">Medium</option>
              <option value="high">High</option><option value="critical">Critical</option>
            </select>
            <Input placeholder="Reason" value={flagReason} onChange={(e) => setFlagReason(e.target.value)} className="col-span-2" />
          </div>
          <Button size="sm" variant="destructive" onClick={flag}>Flag user</Button>
        </section>

        {/* Account status */}
        <section className="rounded-lg border p-3 space-y-2">
          <h3 className="text-sm font-semibold">Account status</h3>
          <p className="text-xs text-muted-foreground">Dormant/pending/suspended users can sign in but cannot move money.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setStatus("active")}>Activate / Approve</Button>
            <Button size="sm" variant="outline" onClick={() => setStatus("pending")}>Mark pending</Button>
            <Button size="sm" variant="outline" onClick={() => setStatus("dormant")}>Make dormant</Button>
            <Button size="sm" variant="destructive" onClick={() => setStatus("suspended")}>Suspend</Button>
          </div>
        </section>

        {/* Roles */}
        {canManageRoles && (
          <section className="rounded-lg border p-3 space-y-2">
            <h3 className="text-sm font-semibold">Roles</h3>
            <div className="flex flex-wrap gap-2">
              {ROLES.map((r) => {
                const has = roles.includes(r);
                return (
                  <Button key={r} size="sm" variant={has ? "default" : "outline"}
                    onClick={() => toggleRole(r, !has)}>
                    {has ? <ShieldMinus className="mr-1 h-3 w-3" /> : <ShieldPlus className="mr-1 h-3 w-3" />}
                    {r}
                  </Button>
                );
              })}
            </div>
          </section>
        )}

        {/* Recent transactions */}
        <section>
          <h3 className="text-sm font-semibold mb-2">Recent transactions ({txns.length})</h3>
          <div className="rounded-lg border max-h-64 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead>When</TableHead><TableHead>Type</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {txns.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs">{new Date(t.created_at).toLocaleString()}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] capitalize">{t.type.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{formatMoney(t.amount, t.currency)}{t.fee > 0 && <span className="text-muted-foreground"> (fee {formatMoney(t.fee, t.currency)})</span>}</TableCell>
                    <TableCell><Badge variant={t.status === "completed" ? "default" : t.status === "failed" ? "destructive" : "secondary"} className="text-[10px]">{t.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {txns.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground">No transactions.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </section>

        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
