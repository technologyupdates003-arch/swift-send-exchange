import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Crown } from "lucide-react";
import FinancialOverview from "@/components/admin/FinancialOverview";
import UserManagement from "@/components/admin/UserManagement";
import TransactionExplorer from "@/components/admin/TransactionExplorer";
import AuditLog from "@/components/admin/AuditLog";
import SystemConfig from "@/components/admin/SystemConfig";
import HoldsManager from "@/components/admin/HoldsManager";

const sb = supabase as any;

export default function SuperAdmin() {
  const { user, loading } = useAuth();
  const [roles, setRoles] = useState<string[] | null>(null);

  useEffect(() => {
    if (!user) return;
    sb.from("user_roles").select("role").eq("user_id", user.id)
      .then(({ data }: any) => setRoles((data ?? []).map((r: any) => r.role)));
  }, [user]);

  if (loading || roles === null) return null;
  const isSuper = roles.includes("super_admin");
  const isFinance = roles.includes("finance_admin");
  const isAnyAdmin = isSuper || isFinance || roles.includes("admin") || roles.includes("support_admin");
  if (!isAnyAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex items-center gap-3">
        <Crown className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Operations control center</h1>
          <p className="text-muted-foreground">
            Real-time financial oversight, user controls, and audit trail.
            {!isSuper && <span className="ml-2 text-xs">(read-mostly view — only super admins can change roles & some configs)</span>}
          </p>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
          {isSuper && <TabsTrigger value="config">Config</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview"><FinancialOverview /></TabsContent>
        <TabsContent value="users">
          <UserManagement canManageRoles={isSuper} canAdjustBalance={isSuper || isFinance} />
        </TabsContent>
        <TabsContent value="transactions"><TransactionExplorer /></TabsContent>
        <TabsContent value="audit"><AuditLog /></TabsContent>
        {isSuper && <TabsContent value="config"><SystemConfig /></TabsContent>}
      </Tabs>
    </div>
  );
}
