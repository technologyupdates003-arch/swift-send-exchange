import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNotifications } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";

export function NotificationsBell({ userId, light = false }: { userId?: string; light?: boolean }) {
  const { notifications, unreadCount, markAllRead } = useNotifications(userId);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("relative", light && "text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground")}>
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge className="absolute -right-1 -top-1 h-5 min-w-5 justify-center px-1 text-[10px]">
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b p-3">
          <p className="text-sm font-semibold">Notifications</p>
          <Button variant="ghost" size="sm" onClick={markAllRead} disabled={unreadCount === 0}>
            <CheckCheck className="mr-1 h-3.5 w-3.5" /> Read
          </Button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">No notifications yet</p>
          ) : notifications.map((n) => (
            <div key={n.id} className={cn("border-b p-3 last:border-b-0", !n.read_at && "bg-primary/5")}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{n.title}</p>
                {!n.read_at && <span className="mt-1 h-2 w-2 rounded-full bg-primary" />}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{n.message}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">{new Date(n.created_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}