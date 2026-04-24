import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribes to live updates on the current user's money tables.
 * Calls `onChange` whenever wallets, transactions, withdrawals, payouts,
 * STK requests, or paystack charges/transfers change for this user.
 */
export function useWalletRealtime(userId: string | undefined, onChange: () => void) {
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`user-money-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets", filter: `user_id=eq.${userId}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions", filter: `user_id=eq.${userId}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "withdrawal_requests", filter: `user_id=eq.${userId}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "mpesa_payouts", filter: `user_id=eq.${userId}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "mpesa_stk_requests", filter: `user_id=eq.${userId}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "paystack_charges", filter: `user_id=eq.${userId}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "paystack_transfers", filter: `user_id=eq.${userId}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "btc_deposits", filter: `user_id=eq.${userId}` }, onChange)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}