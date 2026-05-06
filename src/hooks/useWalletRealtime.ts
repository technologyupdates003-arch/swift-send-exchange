import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribes to live updates on the current user's money tables.
 * Calls `onChange` whenever wallets, transactions, withdrawals, payouts,
 * STK requests, or paystack charges/transfers change for this user.
 *
 * Also refreshes when the tab regains focus/visibility and on a 15s interval
 * as a backup against missed realtime events.
 */
export function useWalletRealtime(userId: string | undefined, onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!userId) return;
    const fire = () => cb.current?.();

    const ch = supabase
      .channel(`user-money-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets", filter: `user_id=eq.${userId}` }, fire)
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions", filter: `user_id=eq.${userId}` }, fire)
      .on("postgres_changes", { event: "*", schema: "public", table: "withdrawal_requests", filter: `user_id=eq.${userId}` }, fire)
      .on("postgres_changes", { event: "*", schema: "public", table: "mpesa_payouts", filter: `user_id=eq.${userId}` }, fire)
      .on("postgres_changes", { event: "*", schema: "public", table: "mpesa_stk_requests", filter: `user_id=eq.${userId}` }, fire)
      .on("postgres_changes", { event: "*", schema: "public", table: "paystack_charges", filter: `user_id=eq.${userId}` }, fire)
      .on("postgres_changes", { event: "*", schema: "public", table: "paystack_transfers", filter: `user_id=eq.${userId}` }, fire)
      .on("postgres_changes", { event: "*", schema: "public", table: "btc_deposits", filter: `user_id=eq.${userId}` }, fire)
      .subscribe();

    const onVisible = () => { if (document.visibilityState === "visible") fire(); };
    window.addEventListener("focus", fire);
    document.addEventListener("visibilitychange", onVisible);

    // Backup poll every 15s in case a realtime event is missed.
    const poll = window.setInterval(fire, 15000);

    return () => {
      supabase.removeChannel(ch);
      window.removeEventListener("focus", fire);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(poll);
    };
  }, [userId]);
}
