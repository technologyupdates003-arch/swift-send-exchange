import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase as sb } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Crown, ShieldPlus, ShieldMinus, DollarSign, ArrowLeftRight } from "lucide-react";
import { ALL_CURRENCIES } from "@/lib/format";

const supabase = sb as any;

interface Profile { id: string; email: string; full_name: string; }
interface UserRole { user_id: string; role: string; }
interface Config { key: string; value: any; description: string; }
interface Rate { id: string; from_currency: string; to_currency: string; rate: number; }

export default function SuperAdmin() {
  const { user, loading: authLoading } = useAuth();
  const [isSuper, setIsSuper] = useState<boolean | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);

  // Add rate form
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("KES");
  const [rateVal, setRateVal] = useState("");

  useEffect(() => {
    if (!user) return;
    supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "super_admin").maybeSingle()
      .then(({ data }: any) => setIsSuper(!!data));
  }, [user]);

  const load = async () => {
    const [p, r, c, ex] = await Promise.all([
      supabase.from("profiles").select("id, email, full_name").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("app_config").select("*").order("key"),
      supabase.from("exchange_rates").select("*").order("from_currency"),
    ]);
    if (p.data) setProfiles(p.data);
    if (r.data) setRoles(r.data);
    if (c.data) setConfigs(c.data);
    if (ex.data) setRates(ex.data);
  };
  useEffect(() => { if (isSuper) load(); }, [isSuper]);

  const toggleRole = async (userId: string, role: "admin" | "super_admin", grant: boolean) => {
    if (grant) {
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
      if (error) { toast.error(error.message); return; }
    }
    toast.success(grant ? `Granted ${role}` : `Revoked ${role}`);
    load();
  };

  const updateConfig = async (key: string, percent: number, flat: number) => {
    const { error } = await supabase.from("app_config").update({
      value: { percent, flat }, updated_at: new Date().toISOString(), updated_by: user?.id,
    }).eq("key", key);
    if (error) { toast.error(error.message); return; }
    toast.success(`Updated ${key}`); load();
  };

  const upsertRate = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = parseFloat(rateVal);
    if (!r || r <= 0) { toast.error("Invalid rate"); return; }
    if (from === to) { toast.error("Pick different currencies"); return; }
    const existing = rates.find((x) => x.from_currency === from && x.to_currency === to);
    if (existing) {
      await supabase.from("exchange_rates").update({ rate: r, updated_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      await supabase.from("exchange_rates").insert({ from_currency: from, to_currency: to, rate: r });
    }
    toast.success(`${from} → ${to} = ${r}`); setRateVal(""); load();
  };

  if (authLoading || isSuper === null) return null;
  if (!isSuper) return <Navigate to="/dashboard" replace />;

  const hasRole = (uid: string, r: string) => roles.some((x) => x.user_id === uid && x.role === r);

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex items-center gap-3">
        <Crown className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Super Admin</h1>
          <p className="text-muted-foreground">Roles, fees, commissions, and exchange rates.</p>
        </div>
      </div>

      <Tabs defaultValue="roles">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="roles">Role management</TabsTrigger>
          <TabsTrigger value="fees">Fees & commissions</TabsTrigger>
          <TabsTrigger value="rates">Exchange rates</TabsTrigger>
        </TabsList>

        <TabsContent value="roles">
          <Card>
            <CardHeader>
              <CardTitle>Promote / demote users</CardTitle>
              <CardDescription>Only super admins can grant the admin role.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {profiles.map((p) => {
                  const isAdm = hasRole(p.id, "admin");
                  const isSup = hasRole(p.id, "super_admin");
                  return (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                      <div>
                        <p className="text-sm font-medium">{p.full_name || "—"}</p>
                        <p className="text-xs text-muted-foreground">{p.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {isSup && <Badge>Super Admin</Badge>}
                        {isAdm && <Badge variant="secondary">Admin</Badge>}
                        {!isAdm ? (
                          <Button size="sm" variant="outline" onClick={() => toggleRole(p.id, "admin", true)}>
                            <ShieldPlus className="mr-1 h-3 w-3" />Grant admin
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => toggleRole(p.id, "admin", false)} disabled={isSup}>
                            <ShieldMinus className="mr-1 h-3 w-3" />Revoke admin
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fees">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><DollarSign className="h-4 w-4" />Fees & commissions</CardTitle>
              <CardDescription>Adjust percent + flat fee for each transaction type.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {configs.filter((c) => c.key.startsWith("fee_")).map((c) => (
                <ConfigRow key={c.key} config={c} onSave={updateConfig} />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rates">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ArrowLeftRight className="h-4 w-4" />Exchange rates</CardTitle>
              <CardDescription>Used for currency exchange and FX transfers.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={upsertRate} className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                <select value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border bg-background p-2 text-sm">
                  {ALL_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <select value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border bg-background p-2 text-sm">
                  {ALL_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <Input type="number" step="0.000001" placeholder="Rate" value={rateVal} onChange={(e) => setRateVal(e.target.value)} />
                <Button type="submit">Save</Button>
              </form>
              <div className="space-y-1 text-sm">
                {rates.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded border p-2">
                    <span>{r.from_currency} → {r.to_currency}</span>
                    <span className="font-mono">{r.rate}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ConfigRow({ config, onSave }: { config: Config; onSave: (k: string, p: number, f: number) => void }) {
  const [percent, setPercent] = useState(String(config.value?.percent ?? 0));
  const [flat, setFlat] = useState(String(config.value?.flat ?? 0));
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{config.key}</p>
          <p className="text-xs text-muted-foreground">{config.description}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div><Label className="text-xs">Percent</Label><Input type="number" step="0.01" value={percent} onChange={(e) => setPercent(e.target.value)} /></div>
        <div><Label className="text-xs">Flat</Label><Input type="number" step="0.01" value={flat} onChange={(e) => setFlat(e.target.value)} /></div>
        <div className="flex items-end"><Button size="sm" onClick={() => onSave(config.key, parseFloat(percent), parseFloat(flat))} className="w-full">Save</Button></div>
      </div>
    </div>
  );
}
