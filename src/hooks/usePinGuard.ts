import { useEffect, useState, useCallback } from "react";
import { supabase as sb } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const supabase = sb as any;

export function usePinGuard() {
  const { user } = useAuth();
  const [hasPin, setHasPin] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.rpc("has_pin");
    setHasPin(!!data);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  return { hasPin, refresh };
}
