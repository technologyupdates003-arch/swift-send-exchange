
-- Fee column on transactions
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS fee numeric NOT NULL DEFAULT 0;

-- Freeze flag on wallets
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS is_frozen boolean NOT NULL DEFAULT false;

-- Audit log table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  reason text,
  before_value jsonb,
  after_value jsonb,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view audit logs" ON public.audit_logs;
CREATE POLICY "Admins view audit logs" ON public.audit_logs
  FOR SELECT USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'finance_admin'::app_role)
    OR public.has_role(auth.uid(), 'support_admin'::app_role)
  );

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin ON public.audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs(target_type, target_id);

-- Flagged users
CREATE TABLE IF NOT EXISTS public.flagged_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  flagged_by uuid NOT NULL,
  reason text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.flagged_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view flags" ON public.flagged_users;
CREATE POLICY "Admins view flags" ON public.flagged_users
  FOR SELECT USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'finance_admin'::app_role)
    OR public.has_role(auth.uid(), 'support_admin'::app_role)
  );

CREATE INDEX IF NOT EXISTS idx_flagged_users_user ON public.flagged_users(user_id);
CREATE INDEX IF NOT EXISTS idx_flagged_users_resolved ON public.flagged_users(resolved);

-- Seed default config
INSERT INTO public.app_config (key, value, description) VALUES
  ('fraud_large_txn', '{"KES": 500000, "USD": 5000, "EUR": 5000, "GBP": 5000, "NGN": 2000000}'::jsonb, 'Per-currency threshold for flagging large transactions'),
  ('fraud_velocity', '{"window_minutes": 60, "max_txns": 10}'::jsonb, 'Rapid transfer detection window'),
  ('fraud_new_account', '{"hours": 24}'::jsonb, 'Treat accounts younger than this as new'),
  ('fee_send_mpesa', '{"percent": 1.5, "flat": 10}'::jsonb, 'Fee for sending to M-Pesa'),
  ('fee_withdraw_mpesa', '{"percent": 1, "flat": 15}'::jsonb, 'Fee for withdrawing to M-Pesa'),
  ('fee_fund_card', '{"percent": 2.5, "flat": 0}'::jsonb, 'Fee for funding via card'),
  ('fee_transfer_wallet', '{"percent": 0, "flat": 0}'::jsonb, 'Fee for wallet-to-wallet transfer'),
  ('fee_exchange_margin', '{"percent": 3}'::jsonb, 'Margin added to exchange rates')
ON CONFLICT (key) DO NOTHING;

-- Helper: any admin tier
CREATE OR REPLACE FUNCTION public.is_admin_any()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'super_admin'::app_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'finance_admin'::app_role)
      OR public.has_role(auth.uid(), 'support_admin'::app_role);
$$;

-- Adjust balance
CREATE OR REPLACE FUNCTION public.admin_adjust_balance(
  _target_user uuid, _currency wallet_currency, _amount numeric,
  _direction text, _reason text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _admin uuid := auth.uid(); _before numeric; _after numeric; _txn_type transaction_type;
BEGIN
  IF _admin IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(_admin, 'super_admin'::app_role) OR public.has_role(_admin, 'finance_admin'::app_role)) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 5 THEN RAISE EXCEPTION 'Reason required (min 5 chars)'; END IF;
  IF _direction NOT IN ('credit','debit') THEN RAISE EXCEPTION 'Direction must be credit or debit'; END IF;

  INSERT INTO public.wallets (user_id, currency, balance) VALUES (_target_user, _currency, 0)
    ON CONFLICT (user_id, currency) DO NOTHING;

  SELECT balance INTO _before FROM public.wallets
    WHERE user_id = _target_user AND currency = _currency FOR UPDATE;

  IF _direction = 'debit' AND _before < _amount THEN RAISE EXCEPTION 'Insufficient balance for debit'; END IF;

  IF _direction = 'credit' THEN
    UPDATE public.wallets SET balance = balance + _amount, updated_at = now()
      WHERE user_id = _target_user AND currency = _currency;
    _txn_type := 'deposit';
  ELSE
    UPDATE public.wallets SET balance = balance - _amount, updated_at = now()
      WHERE user_id = _target_user AND currency = _currency;
    _txn_type := 'withdrawal';
  END IF;

  SELECT balance INTO _after FROM public.wallets
    WHERE user_id = _target_user AND currency = _currency;

  INSERT INTO public.transactions (user_id, type, amount, currency, status, description)
    VALUES (_target_user, _txn_type, _amount, _currency, 'completed',
      format('Admin %s: %s', _direction, _reason));

  INSERT INTO public.audit_logs (admin_id, action, target_type, target_id, reason, before_value, after_value)
    VALUES (_admin, 'adjust_balance', 'wallet', _target_user, _reason,
      jsonb_build_object('balance', _before, 'currency', _currency),
      jsonb_build_object('balance', _after, 'currency', _currency, 'direction', _direction, 'amount', _amount));

  RETURN json_build_object('success', true, 'before', _before, 'after', _after);
END;
$$;

-- Freeze / unfreeze wallet
CREATE OR REPLACE FUNCTION public.admin_freeze_wallet(
  _target_user uuid, _currency wallet_currency, _frozen boolean, _reason text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _admin uuid := auth.uid();
BEGIN
  IF _admin IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_admin_any() THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 5 THEN RAISE EXCEPTION 'Reason required'; END IF;

  UPDATE public.wallets SET is_frozen = _frozen, updated_at = now()
    WHERE user_id = _target_user AND currency = _currency;

  INSERT INTO public.audit_logs (admin_id, action, target_type, target_id, reason, after_value)
    VALUES (_admin, CASE WHEN _frozen THEN 'freeze_wallet' ELSE 'unfreeze_wallet' END,
      'wallet', _target_user, _reason,
      jsonb_build_object('currency', _currency, 'frozen', _frozen));

  RETURN json_build_object('success', true);
END;
$$;

-- Flag user
CREATE OR REPLACE FUNCTION public.admin_flag_user(
  _target_user uuid, _reason text, _severity text DEFAULT 'medium'
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _admin uuid := auth.uid(); _flag_id uuid;
BEGIN
  IF _admin IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_admin_any() THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 5 THEN RAISE EXCEPTION 'Reason required'; END IF;
  IF _severity NOT IN ('low','medium','high','critical') THEN RAISE EXCEPTION 'Invalid severity'; END IF;

  INSERT INTO public.flagged_users (user_id, flagged_by, reason, severity)
    VALUES (_target_user, _admin, _reason, _severity) RETURNING id INTO _flag_id;

  INSERT INTO public.audit_logs (admin_id, action, target_type, target_id, reason, after_value)
    VALUES (_admin, 'flag_user', 'user', _target_user, _reason,
      jsonb_build_object('severity', _severity, 'flag_id', _flag_id));

  RETURN json_build_object('success', true, 'flag_id', _flag_id);
END;
$$;

-- Resolve flag
CREATE OR REPLACE FUNCTION public.admin_resolve_flag(_flag_id uuid, _note text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _admin uuid := auth.uid(); _user uuid;
BEGIN
  IF _admin IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_admin_any() THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  UPDATE public.flagged_users SET resolved = true, resolved_at = now(), resolved_by = _admin
    WHERE id = _flag_id RETURNING user_id INTO _user;
  IF _user IS NULL THEN RAISE EXCEPTION 'Flag not found'; END IF;
  INSERT INTO public.audit_logs (admin_id, action, target_type, target_id, reason)
    VALUES (_admin, 'resolve_flag', 'user', _user, _note);
  RETURN json_build_object('success', true);
END;
$$;

-- Grant / revoke roles (super_admin only)
CREATE OR REPLACE FUNCTION public.admin_set_role(_target_user uuid, _role app_role, _grant boolean)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _admin uuid := auth.uid();
BEGIN
  IF _admin IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_role(_admin, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admin can change roles';
  END IF;
  IF _grant THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_target_user, _role) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _target_user AND role = _role;
  END IF;
  INSERT INTO public.audit_logs (admin_id, action, target_type, target_id, after_value)
    VALUES (_admin, CASE WHEN _grant THEN 'grant_role' ELSE 'revoke_role' END,
      'user', _target_user, jsonb_build_object('role', _role));
  RETURN json_build_object('success', true);
END;
$$;

-- Financial overview
CREATE OR REPLACE FUNCTION public.admin_financial_overview()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _result json;
BEGIN
  IF NOT public.is_admin_any() THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  SELECT json_build_object(
    'balances_by_currency', (SELECT json_object_agg(currency, total) FROM
      (SELECT currency, sum(balance) AS total FROM public.wallets GROUP BY currency) b),
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
      (SELECT currency, sum(fee) AS total FROM public.transactions WHERE fee > 0 GROUP BY currency) r),
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
