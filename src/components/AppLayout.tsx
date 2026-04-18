import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { LayoutDashboard, Wallet, Send, History, LogOut, Menu, RefreshCw, ShieldCheck, Building2, Settings as SettingsIcon, Shield } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { supabase as sb } from "@/integrations/supabase/client";

const supabase = sb as any;

const baseNav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/wallets", label: "Wallets", icon: Wallet },
  { to: "/send", label: "Send", icon: Send },
  { to: "/exchange", label: "Exchange", icon: RefreshCw },
  { to: "/withdraw", label: "Withdraw", icon: Building2 },
  { to: "/transactions", label: "Transactions", icon: History },
  { to: "/kyc", label: "Verification", icon: ShieldCheck },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

function NavItems({ isAdmin, onClick }: { isAdmin: boolean; onClick?: () => void }) {
  const items = isAdmin ? [...baseNav, { to: "/admin", label: "Admin", icon: Shield }] : baseNav;
  return (
    <nav className="space-y-1">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onClick}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )
          }
        >
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

  useEffect(() => {
    if (!user) return;
    supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle()
      .then(({ data }: any) => setIsAdmin(!!data));
  }, [user]);

  const handleLogout = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-background px-4 md:hidden">
        <Logo size="sm" />
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon"><Menu className="h-5 w-5" /></Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-4">
            <div className="mb-6"><Logo size="md" /></div>
            <NavItems isAdmin={isAdmin} />
            <Button variant="outline" className="mt-6 w-full" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" /> Log out
            </Button>
          </SheetContent>
        </Sheet>
      </header>

      <div className="flex">
        <aside className="hidden md:flex md:w-64 md:flex-col md:border-r md:bg-card md:min-h-screen md:p-4">
          <div className="mb-8"><Logo size="md" /></div>
          <NavItems isAdmin={isAdmin} />
          <div className="mt-auto space-y-3 pt-6">
            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              <p className="truncate font-medium">{user?.email}</p>
              <p className="text-muted-foreground">{isAdmin ? "Admin" : "Signed in"}</p>
            </div>
            <Button variant="outline" className="w-full" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" /> Log out
            </Button>
          </div>
        </aside>

        <main className="flex-1 p-4 md:p-8 max-w-6xl mx-auto w-full">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
