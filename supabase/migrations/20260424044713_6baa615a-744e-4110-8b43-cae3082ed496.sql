
-- ============ ACCOUNT STATUS ============
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_account_status_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_status_chk
  CHECK (account_status IN ('active', 'pending', 'dormant', 'suspended'));

CREATE OR REPLACE FUNCTION public.is_account_active(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT account_status FROM public.profiles WHERE id = _user) = 'active', false)
$$;

CREATE OR REPLACE FUNCTION public.admin_set_account_status(
  _target_user uuid, _status text, _reason text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _admin uuid := auth.uid(); _before text;
BEGIN
  IF _admin IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_admin_any() THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  IF _status NOT IN ('active','pending','dormant','suspended') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 5 THEN
    RAISE EXCEPTION 'Reason required (min 5 chars)';
  END IF;
  SELECT account_status INTO _before FROM public.profiles WHERE id = _target_user;
  UPDATE public.profiles SET account_status = _status, updated_at = now() WHERE id = _target_user;
  INSERT INTO public.audit_logs (admin_id, action, target_type, target_id, reason, before_value, after_value)
    VALUES (_admin, 'set_account_status', 'user', _target_user, _reason,
      jsonb_build_object('status', _before),
      jsonb_build_object('status', _status));
  RETURN json_build_object('success', true);
END $$;

-- ============ TRANSACTION REVERSALS ============
CREATE TABLE IF NOT EXISTS public.transaction_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_transaction_id uuid NOT NULL,
  user_id uuid NOT NULL,
  amount numeric NOT NULL,
  currency public.wallet_currency NOT NULL,
  status text NOT NULL DEFAULT 'held',
  reason text NOT NULL,
  initiated_by uuid NOT NULL,
  released_at timestamptz,
  released_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.transaction_reversals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own reversals" ON public.transaction_reversals;
CREATE POLICY "Users view own reversals" ON public.transaction_reversals
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin_any());

CREATE OR REPLACE FUNCTION public.admin_hold_funds(
  _target_user uuid, _currency public.wallet_currency, _amount numeric, _reason text, _original_tx uuid DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _admin uuid := auth.uid(); _balance numeric; _hold_id uuid;
BEGIN
  IF NOT public.is_admin_any() THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 5 THEN RAISE EXCEPTION 'Reason required'; END IF;
  SELECT balance INTO _balance FROM public.wallets
    WHERE user_id = _target_user AND currency = _currency FOR UPDATE;
  IF _balance IS NULL OR _balance < _amount THEN RAISE EXCEPTION 'Insufficient balance to hold'; END IF;
  UPDATE public.wallets SET balance = balance - _amount, updated_at = now()
    WHERE user_id = _target_user AND currency = _currency;
  INSERT INTO public.transaction_reversals (original_transaction_id, user_id, amount, currency, status, reason, initiated_by)
    VALUES (COALESCE(_original_tx, gen_random_uuid()), _target_user, _amount, _currency, 'held', _reason, _admin)
    RETURNING id INTO _hold_id;
  INSERT INTO public.transactions (user_id, type, amount, currency, status, description)
    VALUES (_target_user, 'withdrawal', _amount, _currency, 'pending', format('Hold: %s', _reason));
  INSERT INTO public.audit_logs (admin_id, action, target_type, target_id, reason, after_value)
    VALUES (_admin, 'hold_funds', 'wallet', _target_user, _reason,
      jsonb_build_object('hold_id', _hold_id, 'amount', _amount, 'currency', _currency));
  RETURN json_build_object('success', true, 'hold_id', _hold_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_release_hold(
  _hold_id uuid, _action text, _note text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _admin uuid := auth.uid(); _hold record;
BEGIN
  IF NOT public.is_admin_any() THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  IF _action NOT IN ('refund','release') THEN RAISE EXCEPTION 'Action must be refund or release'; END IF;
  SELECT * INTO _hold FROM public.transaction_reversals WHERE id = _hold_id FOR UPDATE;
  IF _hold IS NULL THEN RAISE EXCEPTION 'Hold not found'; END IF;
  IF _hold.status <> 'held' THEN RAISE EXCEPTION 'Hold already %', _hold.status; END IF;
  IF _action = 'refund' THEN
    UPDATE public.wallets SET balance = balance + _hold.amount, updated_at = now()
      WHERE user_id = _hold.user_id AND currency = _hold.currency;
    INSERT INTO public.transactions (user_id, type, amount, currency, status, description)
      VALUES (_hold.user_id, 'deposit', _hold.amount, _hold.currency, 'completed', format('Refund: %s', _note));
  ELSE
    INSERT INTO public.transactions (user_id, type, amount, currency, status, description)
      VALUES (_hold.user_id, 'withdrawal', _hold.amount, _hold.currency, 'completed', format('Released: %s', _note));
  END IF;
  UPDATE public.transaction_reversals
    SET status = CASE WHEN _action = 'refund' THEN 'refunded' ELSE 'released' END,
        released_at = now(), released_by = _admin
    WHERE id = _hold_id;
  INSERT INTO public.audit_logs (admin_id, action, target_type, target_id, reason, after_value)
    VALUES (_admin, 'release_hold_'||_action, 'reversal', _hold_id, _note,
      jsonb_build_object('amount', _hold.amount, 'currency', _hold.currency));
  RETURN json_build_object('success', true);
END $$;

-- ============ BTC DEPOSITS ============
CREATE TABLE IF NOT EXISTS public.btc_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  btc_address text NOT NULL,
  amount_btc numeric,
  amount_usd numeric,
  abn_credited numeric,
  status text NOT NULL DEFAULT 'awaiting_deposit',
  txid text,
  provider text,
  provider_payment_id text,
  provider_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.btc_deposits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own btc" ON public.btc_deposits;
CREATE POLICY "Users view own btc" ON public.btc_deposits
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin_any());

-- ============ ENFORCE ACCOUNT_STATUS ON SENSITIVE RPCS ============
CREATE OR REPLACE FUNCTION public.withdraw_to_mpesa(_phone text, _amount numeric, _pin text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _user uuid := auth.uid(); _balance numeric; _payout_id uuid; _fee numeric := 0; _fee_cfg jsonb;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_account_active(_user) THEN RAISE EXCEPTION 'Account not active. Contact support.'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _phone !~ '^(?:\+?254|0)?[17]\d{8}$' THEN RAISE EXCEPTION 'Invalid phone number'; END IF;
  IF NOT public.verify_transaction_pin(_pin) THEN RAISE EXCEPTION 'Invalid PIN'; END IF;
  SELECT value INTO _fee_cfg FROM public.app_config WHERE key = 'fee_withdraw_mpesa';
  IF _fee_cfg IS NOT NULL THEN
    _fee := round((_amount * (_fee_cfg->>'percent')::numeric / 100) + (_fee_cfg->>'flat')::numeric, 2);
  END IF;
  SELECT balance INTO _balance FROM public.wallets WHERE user_id = _user AND currency = 'KES' FOR UPDATE;
  IF _balance IS NULL THEN RAISE EXCEPTION 'KES wallet not found'; END IF;
  IF _balance < _amount + _fee THEN
    RAISE EXCEPTION 'Insufficient balance. Need % KES (incl. fee %), have %', _amount + _fee, _fee, _balance;
  END IF;
  UPDATE public.wallets SET balance = balance - (_amount + _fee), updated_at = now()
    WHERE user_id = _user AND currency = 'KES';
  INSERT INTO public.mpesa_payouts (user_id, phone_number, amount, fee, status)
    VALUES (_user, _phone, _amount, _fee, 'pending') RETURNING id INTO _payout_id;
  INSERT INTO public.transactions (user_id, type, amount, currency, status, description)
    VALUES (_user, 'withdrawal', _amount + _fee, 'KES', 'pending',
      format('M-Pesa withdrawal to %s | payout:%s | fee %s', _phone, _payout_id, _fee));
  RETURN json_build_object('success', true, 'payout_id', _payout_id, 'fee', _fee, 'available_after', _balance - (_amount + _fee));
END $$;

CREATE OR REPLACE FUNCTION public.send_to_mpesa(_phone text, _amount numeric, _pin text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _user uuid := auth.uid(); _balance numeric; _payout_id uuid; _fee numeric := 0; _fee_cfg jsonb;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_account_active(_user) THEN RAISE EXCEPTION 'Account not active. Contact support.'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _phone !~ '^(?:\+?254|0)?[17]\d{8}$' THEN RAISE EXCEPTION 'Invalid phone number'; END IF;
  IF NOT public.verify_transaction_pin(_pin) THEN RAISE EXCEPTION 'Invalid PIN'; END IF;
  SELECT value INTO _fee_cfg FROM public.app_config WHERE key = 'fee_send_mpesa';
  IF _fee_cfg IS NOT NULL THEN
    _fee := round((_amount * (_fee_cfg->>'percent')::numeric / 100) + (_fee_cfg->>'flat')::numeric, 2);
  END IF;
  SELECT balance INTO _balance FROM public.wallets WHERE user_id = _user AND currency = 'KES' FOR UPDATE;
  IF _balance IS NULL THEN RAISE EXCEPTION 'KES wallet not found'; END IF;
  IF _balance < _amount + _fee THEN
    RAISE EXCEPTION 'Insufficient balance. Need % KES (incl. fee %), have %', _amount + _fee, _fee, _balance;
  END IF;
  UPDATE public.wallets SET balance = balance - (_amount + _fee), updated_at = now()
    WHERE user_id = _user AND currency = 'KES';
  INSERT INTO public.mpesa_payouts (user_id, phone_number, amount, fee, status)
    VALUES (_user, _phone, _amount, _fee, 'pending') RETURNING id INTO _payout_id;
  INSERT INTO public.transactions (user_id, type, amount, currency, status, description)
    VALUES (_user, 'transfer_out', _amount + _fee, 'KES', 'pending',
      format('M-Pesa send to %s | payout:%s | fee %s', _phone, _payout_id, _fee));
  RETURN json_build_object('success', true, 'payout_id', _payout_id, 'fee', _fee);
END $$;

-- ============ REALTIME ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.withdrawal_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.mpesa_payouts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.mpesa_stk_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.paystack_charges;
ALTER PUBLICATION supabase_realtime ADD TABLE public.paystack_transfers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.btc_deposits;

ALTER TABLE public.wallets REPLICA IDENTITY FULL;
ALTER TABLE public.transactions REPLICA IDENTITY FULL;
ALTER TABLE public.withdrawal_requests REPLICA IDENTITY FULL;
ALTER TABLE public.mpesa_payouts REPLICA IDENTITY FULL;
ALTER TABLE public.mpesa_stk_requests REPLICA IDENTITY FULL;
ALTER TABLE public.paystack_charges REPLICA IDENTITY FULL;
ALTER TABLE public.paystack_transfers REPLICA IDENTITY FULL;
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
ALTER TABLE public.btc_deposits REPLICA IDENTITY FULL;
