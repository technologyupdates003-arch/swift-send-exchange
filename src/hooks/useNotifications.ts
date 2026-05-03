import { useCallback, useEffect, useState } from "react";
import { supabase as sb } from "@/integrations/supabase/client";

const supabase = sb as any;

export interface NotificationRow {
  id: string;
  title: string;
  message: string;
  type: string;
  read_at: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
}

export function useNotifications(userId: string | undefined) {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("notifications")
      .select("id,title,message,type,read_at,created_at,metadata")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setNotifications(data);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`notifications-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, load]);

  const markAllRead = async () => {
    if (!userId) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", userId).is("read_at", null);
    await load();
  };

  return {
    notifications,
    unreadCount: notifications.filter((n) => !n.read_at).length,
    markAllRead,
  };
}