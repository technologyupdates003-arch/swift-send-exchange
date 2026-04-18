import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase as sb } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Users, ArrowLeftRight, ShieldCheck, ArrowUpFromLine } from "lucide-react";
import { formatMoney } from "@/lib/format";

const supabase = sb as any;

interface Profile { id: string; email: string; full_name: string; kyc_status: string; created_at: string; }
interface Tx { id: string; user_id: string; type: string; amount: number; currency: string; status: string; description: string | null; created_at: string; }
interface Kyc { id: string; user_id: string; document_type: string; status: string; submitted_at: string; }
interface Withdrawal { id: string; user_id: string; amount: number; currency: string; status: string; created_at: string; }

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [kycs, setKycs] = useState<Kyc[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);

  useEffect(() => {
    if (!user) return;
    supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle()
      .then(({ data }: any) => setIsAdmin(!!data));
  }, [user]);

  const load = async () => {
    const [p, t, k, w] = await Promise.all([
      supabase.from("profiles").select("id, email, full_name, kyc_status, created_at").order("created_at", { ascending: false }),
      supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("kyc_verifications").select("*").order("submitted_at", { ascending: false }),
      supabase.from("withdrawal_requests").select("*").order("created_at", { ascending: false }),
    ]);
    if (p.data) setProfiles(p.data);
    if (t.data) setTxs(t.data);
    if (k.data) setKycs(k.data);
    if (w.data) setWithdrawals(w.data);
  };
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  const reviewKyc = async (id: string, status: "verified" | "rejected") => {
    const { error } = await supabase.from("kyc_verifications").update({
      status, reviewed_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    // Update profile too
    const kyc = kycs.find((k) => k.id === id);
    if (kyc) await supabase.from("profiles").update({ kyc_status: status }).eq("id", kyc.user_id);
    toast.success(`KYC ${status}`);
    load();
  };

  const reviewWithdrawal = async (id: string, status: "completed" | "failed") => {
    const { error } = await supabase.from("withdrawal_requests").update({
      status, processed_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Withdrawal marked ${status}`);
    load();
  };

  if (authLoading || isAdmin === null) return null;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
        <p className="text-muted-foreground">Platform overview and reviews.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard icon={Users} label="Users" value={profiles.length} />
        <StatCard icon={ArrowLeftRight} label="Transactions" value={txs.length} />
        <StatCard icon={ShieldCheck} label="KYC pending" value={kycs.filter(k => k.status === "pending").length} />
        <StatCard icon={ArrowUpFromLine} label="Withdrawals pending" value={withdrawals.filter(w => w.status === "pending").length} />
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="kyc">KYC reviews</TabsTrigger>
          <TabsTrigger value="withdrawals">Withdrawals</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Card><CardContent className="p-0">
            <ul className="divide-y">
              {profiles.map((p) => (
                <li key={p.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium">{p.full_name || "—"}</p>
                    <p className="text-xs text-muted-foreground">{p.email}</p>
                  </div>
                  <Badge variant={p.kyc_status === "verified" ? "default" : "secondary"} className="capitalize">{p.kyc_status}</Badge>
                </li>
              ))}
            </ul>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="transactions">
          <Card><CardContent className="p-0">
            <ul className="divide-y">
              {txs.map((t) => (
                <li key={t.id} className="flex items-center justify-between p-4 text-sm">
                  <div>
                    <p className="font-medium capitalize">{t.type.replace("_", " ")}</p>
                    <p className="text-xs text-muted-foreground">{t.description || "—"} · {new Date(t.created_at).toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatMoney(t.amount, t.currency)}</p>
                    <Badge variant="outline" className="text-xs capitalize">{t.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="kyc">
          <Card><CardContent className="p-0">
            <ul className="divide-y">
              {kycs.map((k) => (
                <li key={k.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium capitalize">{k.document_type.replace("_", " ")}</p>
                    <p className="text-xs text-muted-foreground">User {k.user_id.slice(0, 8)} · {new Date(k.submitted_at).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={k.status === "verified" ? "default" : k.status === "rejected" ? "destructive" : "secondary"} className="capitalize">{k.status}</Badge>
                    {k.status === "pending" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => reviewKyc(k.id, "verified")}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => reviewKyc(k.id, "rejected")}>Reject</Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
              {kycs.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No submissions</li>}
            </ul>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="withdrawals">
          <Card><CardContent className="p-0">
            <ul className="divide-y">
              {withdrawals.map((w) => (
                <li key={w.id} className="flex items-center justify-between p-4 text-sm">
                  <div>
                    <p className="font-medium">{formatMoney(w.amount, w.currency)}</p>
                    <p className="text-xs text-muted-foreground">User {w.user_id.slice(0, 8)} · {new Date(w.created_at).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={w.status === "completed" ? "default" : w.status === "failed" ? "destructive" : "secondary"} className="capitalize">{w.status}</Badge>
                    {w.status === "pending" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => reviewWithdrawal(w.id, "completed")}>Mark paid</Button>
                        <Button size="sm" variant="outline" onClick={() => reviewWithdrawal(w.id, "failed")}>Mark failed</Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
              {withdrawals.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No withdrawals</li>}
            </ul>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-medium text-muted-foreground">
          {label}
          <Icon className="h-4 w-4" />
        </CardTitle>
      </CardHeader>
      <CardContent><p className="text-2xl font-bold">{value}</p></CardContent>
    </Card>
  );
}
