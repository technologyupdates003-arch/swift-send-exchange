import { NavLink } from "react-router-dom";
import { LayoutDashboard, Send, Plus, History, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/dashboard", label: "Home", icon: LayoutDashboard },
  { to: "/wallets", label: "Wallets", icon: Wallet },
  { to: "/fund", label: "Fund", icon: Plus, primary: true },
  { to: "/send", label: "Send", icon: Send },
  { to: "/transactions", label: "History", icon: History },
];

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur md:hidden">
      <ul className="flex items-center justify-around px-1 pb-[env(safe-area-inset-bottom)]">
        {items.map(({ to, label, icon: Icon, primary }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors",
                  primary
                    ? "text-primary"
                    : isActive
                      ? "text-primary"
                      : "text-muted-foreground"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                      primary
                        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
                        : isActive
                          ? "bg-primary/10"
                          : ""
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
