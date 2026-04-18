import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search } from "lucide-react";

const sb = supabase as any;

interface Log {
  id: string; admin_id: string; action: string; target_type: string | null;
  target_id: string | null; reason: string | null;
  before_value: any; after_value: any; created_at: string;
}

const ACTION_TONE: Record<string, "default" | "destructive" | "secondary"> = {
  adjust_balance: "default", freeze_wallet: "destructive", unfreeze_wallet: "secondary",
  flag_user: "destructive", resolve_flag: "secondary",
  grant_role: "default", revoke_role: "secondary",
};

export default function AuditLog() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [admins, setAdmins] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");

  const load = async () => {
    const { data } = await sb.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(500);
    setLogs(data ?? []);
    const ids = Array.from(new Set([
      ...(data ?? []).map((l: Log) => l.admin_id),
      ...(data ?? []).filter((l: Log) => l.target_type === "user" || l.target_type === "wallet").map((l: Log) => l.target_id).filter(Boolean) as string[],
    ]));
    if (ids.length > 0) {
      const { data: ps } = await sb.from("profiles").select("id,email").in("id", ids);
      const am: Record<string, string> = {}, um: Record<string, string> = {};
      (ps ?? []).forEach((p: { id: string; email: string }) => { am[p.id] = p.email; um[p.id] = p.email; });
      setAdmins(am); setUsers(um);
    }
  };
  useEffect(() => { load(); }, []);

  const actions = useMemo(() => Array.from(new Set(logs.map((l) => l.action))), [logs]);
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return logs.filter((l) => {
      if (action !== "all" && l.action !== action) return false;
      if (q) {
        const hay = `${l.action} ${l.reason ?? ""} ${admins[l.admin_id] ?? ""} ${users[l.target_id ?? ""] ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, action, search, admins, users]);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div>
          <CardTitle>Audit log</CardTitle>
          <CardDescription>Every privileged admin action — immutable, append-only.</CardDescription>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <select value={action} onChange={(e) => setAction(e.target.value)} className="rounded-md border bg-background px-2 text-sm h-10">
            <option value="all">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <div className="relative sm:col-span-2">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search admin, target, reason" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[600px] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="hidden lg:table-cell">Reason</TableHead>
                <TableHead className="hidden xl:table-cell">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{admins[l.admin_id] ?? l.admin_id.slice(0, 8)}</TableCell>
                  <TableCell><Badge variant={ACTION_TONE[l.action] ?? "outline"} className="text-[10px]">{l.action}</Badge></TableCell>
                  <TableCell className="text-xs">{l.target_type && <span className="text-muted-foreground">{l.target_type}: </span>}{users[l.target_id ?? ""] ?? l.target_id?.slice(0, 8)}</TableCell>
                  <TableCell className="hidden lg:table-cell text-xs max-w-xs truncate">{l.reason ?? "—"}</TableCell>
                  <TableCell className="hidden xl:table-cell text-[10px] font-mono text-muted-foreground max-w-xs truncate">
                    {l.after_value ? JSON.stringify(l.after_value) : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No audit entries.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
