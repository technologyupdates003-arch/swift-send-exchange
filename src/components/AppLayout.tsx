import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { LayoutDashboard, Wallet, Send, History, LogOut, RefreshCw, ShieldCheck, Building2, Settings as SettingsIcon, Shield, Crown, Plus, ArrowUpFromLine } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase as sb } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { InstallBanner } from "@/components/InstallBanner";

const supabase = sb as any;

const baseNav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/wallets", label: "Wallets", icon: Wallet },
  { to: "/fund", label: "Fund wallet", icon: Plus },
  { to: "/send", label: "Send", icon: Send },
  { to: "/withdraw", label: "Withdraw", icon: ArrowUpFromLine },
  { to: "/exchange", label: "Exchange", icon: RefreshCw },
  { to: "/transactions", label: "Transactions", icon: History },
  { to: "/kyc", label: "Verification", icon: ShieldCheck },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

function NavItems({ isAdmin, isSuperAdmin, onClick }: { isAdmin: boolean; isSuperAdmin: boolean; onClick?: () => void }) {
  const items = [...baseNav];
  if (isAdmin || isSuperAdmin) items.push({ to: "/admin", label: "Admin", icon: Shield });
  if (isSuperAdmin) items.push({ to: "/super-admin", label: "Super Admin", icon: Crown });
  return (
    <nav className="space-y-1">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} onClick={onClick}
          className={({ isActive }) =>
            cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )
          }>
          <Icon className="h-4 w-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function AppLayout() {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("user_roles").select("role").eq("user_id", user.id).then(({ data }: any) => {
      const roles = (data || []).map((r: any) => r.role);
      setIsAdmin(roles.includes("admin"));
      setIsSuperAdmin(roles.includes("super_admin"));
    });
  }, [user]);

  const handleLogout = async () => { await signOut(); navigate("/login"); };

  return (
    <div className="min-h-screen bg-background">
      <InstallBanner />
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-background px-4 md:hidden">
        <Logo size="sm" />
        <div className="flex items-center gap-2">
          {isSuperAdmin && <Crown className="h-4 w-4 text-primary" />}
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex">
        <aside className="hidden md:flex md:w-64 md:flex-col md:border-r md:bg-card md:min-h-screen md:p-4">
          <div className="mb-8"><Logo size="md" /></div>
          <NavItems isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} />
          <div className="mt-auto space-y-3 pt-6">
            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              <p className="truncate font-medium">{user?.email}</p>
              <p className="text-muted-foreground">
                {isSuperAdmin ? "Super Admin" : isAdmin ? "Admin" : "Signed in"}
              </p>
            </div>
            <Button variant="outline" className="w-full" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" /> Log out
            </Button>
          </div>
        </aside>

        <main className="flex-1 p-4 pb-24 md:p-8 md:pb-8 max-w-6xl mx-auto w-full">
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
