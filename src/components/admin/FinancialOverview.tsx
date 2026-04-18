import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import {
  Wallet, Users, ArrowDownToLine, ArrowUpFromLine, AlertTriangle, Snowflake,
  TrendingUp, ShieldAlert, FileClock,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid, Legend,
} from "recharts";

interface Overview {
  balances_by_currency: Record<string, number> | null;
  totals: {
    users: number; wallets: number; frozen_wallets: number;
    txns_today: number; txns_failed_today: number;
    pending_withdrawals: number; pending_kyc: number; open_flags: number;
  };
  revenue_by_currency: Record<string, number> | null;
  volume_by_type_today: Record<string, number> | null;
  daily_volume_30d: { day: string; volume: number; revenue: number; txns: number }[] | null;
}

export default function FinancialOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data, error } = await (supabase as any).rpc("admin_financial_overview");
    if (!error) setData(data);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // refresh every 15s
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }
  if (!data) return <p className="text-sm text-muted-foreground">No data.</p>;

  const balances = data.balances_by_currency ?? {};
  const revenue = data.revenue_by_currency ?? {};
  const t = data.totals;
  const series = (data.daily_volume_30d ?? []).map((d) => ({
    ...d, day: new Date(d.day).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    volume: Number(d.volume), revenue: Number(d.revenue),
  }));
  const volByType = Object.entries(data.volume_by_type_today ?? {}).map(([type, total]) => ({
    type: type.replace("_", " "), total: Number(total),
  }));

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Users} label="Users" value={t.users} />
        <KpiCard icon={Wallet} label="Wallets" value={t.wallets} sub={`${t.frozen_wallets} frozen`} />
        <KpiCard icon={TrendingUp} label="Txns today" value={t.txns_today}
          sub={`${t.txns_failed_today} failed`} tone={t.txns_failed_today > 0 ? "warn" : undefined} />
        <KpiCard icon={ShieldAlert} label="Open flags" value={t.open_flags}
          tone={t.open_flags > 0 ? "danger" : undefined} />
        <KpiCard icon={FileClock} label="Pending KYC" value={t.pending_kyc}
          tone={t.pending_kyc > 0 ? "warn" : undefined} />
        <KpiCard icon={ArrowUpFromLine} label="Pending payouts" value={t.pending_withdrawals}
          tone={t.pending_withdrawals > 0 ? "warn" : undefined} />
        <KpiCard icon={Snowflake} label="Frozen wallets" value={t.frozen_wallets} />
        <KpiCard icon={AlertTriangle} label="Failed (24h)" value={t.txns_failed_today}
          tone={t.txns_failed_today > 0 ? "danger" : undefined} />
      </div>

      {/* Money in system */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Total system balance</CardTitle>
            <CardDescription>Sum of every user wallet, by currency.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.keys(balances).length === 0 && <p className="text-sm text-muted-foreground">No wallets.</p>}
              {Object.entries(balances).map(([cur, amt]) => (
                <div key={cur} className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{cur}</p>
                  <p className="text-lg font-semibold tabular-nums">{formatMoney(Number(amt), cur)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Total revenue (fees)</CardTitle>
            <CardDescription>All-time fees collected, by currency.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.keys(revenue).length === 0 && <p className="text-sm text-muted-foreground">No revenue yet.</p>}
              {Object.entries(revenue).map(([cur, amt]) => (
                <div key={cur} className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{cur}</p>
                  <p className="text-lg font-semibold tabular-nums text-primary">{formatMoney(Number(amt), cur)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Daily volume (30d)</CardTitle>
            <CardDescription>Volume across all currencies (raw amounts, not converted).</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="vol" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }} />
                <Area type="monotone" dataKey="volume" stroke="hsl(var(--primary))" fill="url(#vol)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Revenue trend (30d)</CardTitle>
            <CardDescription>Daily fee income.</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }} />
                <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Volume by type today */}
      <Card>
        <CardHeader>
          <CardTitle>Volume by type — today</CardTitle>
          <CardDescription>Inflow vs outflow over the last 24h.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {volByType.length === 0 && <p className="text-sm text-muted-foreground">No transactions today.</p>}
            {volByType.map((v) => (
              <div key={v.type} className="rounded-lg border p-3">
                <Badge variant="secondary" className="capitalize">{v.type}</Badge>
                <p className="mt-1 text-lg font-semibold tabular-nums">{v.total.toLocaleString()}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, tone }: {
  icon: any; label: string; value: number; sub?: string; tone?: "warn" | "danger";
}) {
  const toneCls = tone === "danger" ? "text-destructive" : tone === "warn" ? "text-yellow-600 dark:text-yellow-500" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{label}</p>
          <Icon className={`h-4 w-4 ${toneCls}`} />
        </div>
        <p className={`mt-1 text-2xl font-bold tabular-nums ${toneCls}`}>{value.toLocaleString()}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}
