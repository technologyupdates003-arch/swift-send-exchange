CREATE OR REPLACE FUNCTION public.admin_financial_overview()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _result json;
BEGIN
  IF NOT public.is_admin_any() THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  SELECT json_build_object(
    'balances_by_currency', (SELECT json_object_agg(currency, total) FROM
      (SELECT currency, sum(balance) AS total FROM public.wallets GROUP BY currency) b),
    'platform_wallets', (SELECT json_agg(row_to_json(pw)) FROM
      (SELECT currency, revenue_type, balance, updated_at FROM public.platform_wallets ORDER BY revenue_type, currency) pw),
    'totals', json_build_object(
      'users', (SELECT count(*) FROM public.profiles),
      'wallets', (SELECT count(*) FROM public.wallets),
      'frozen_wallets', (SELECT count(*) FROM public.wallets WHERE is_frozen),
      'txns_today', (SELECT count(*) FROM public.transactions WHERE created_at > now() - interval '1 day'),
      'txns_failed_today', (SELECT count(*) FROM public.transactions WHERE created_at > now() - interval '1 day' AND status = 'failed'),
      'pending_withdrawals', (SELECT count(*) FROM public.withdrawal_requests WHERE status = 'pending'),
      'pending_kyc', (SELECT count(*) FROM public.kyc_verifications WHERE status = 'pending'),
      'open_flags', (SELECT count(*) FROM public.flagged_users WHERE NOT resolved)
    ),
    'revenue_by_currency', (SELECT json_object_agg(currency, total) FROM
      (SELECT currency, sum(balance) AS total FROM public.platform_wallets GROUP BY currency) r),
    'volume_by_type_today', (SELECT json_object_agg(type, total) FROM
      (SELECT type::text, sum(amount) AS total FROM public.transactions
       WHERE created_at > now() - interval '1 day' GROUP BY type) v),
    'daily_volume_30d', (SELECT json_agg(row_to_json(d)) FROM
      (SELECT date_trunc('day', created_at)::date AS day, sum(amount) AS volume,
              sum(fee) AS revenue, count(*) AS txns
       FROM public.transactions WHERE created_at > now() - interval '30 days'
       GROUP BY 1 ORDER BY 1) d)
  ) INTO _result;
  RETURN _result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_financial_overview() TO authenticated;