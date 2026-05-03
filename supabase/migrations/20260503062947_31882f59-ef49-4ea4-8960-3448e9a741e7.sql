CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'transaction',
  read_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Admins view notifications" ON public.notifications;

CREATE POLICY "Users view own notifications"
ON public.notifications
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users update own notifications"
ON public.notifications
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view notifications"
ON public.notifications
FOR SELECT
USING (public.is_admin_any());

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.platform_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  currency wallet_currency NOT NULL,
  balance numeric NOT NULL DEFAULT 0,
  revenue_type text NOT NULL DEFAULT 'fees',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(currency, revenue_type)
);

ALTER TABLE public.platform_wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view platform wallets" ON public.platform_wallets;
CREATE POLICY "Admins view platform wallets"
ON public.platform_wallets
FOR SELECT
USING (public.is_admin_any());

CREATE TABLE IF NOT EXISTS public.platform_revenue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  currency wallet_currency NOT NULL,
  amount numeric NOT NULL,
  revenue_type text NOT NULL,
  source text NOT NULL,
  reference text,
  user_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_revenue_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view platform revenue events" ON public.platform_revenue_events;
CREATE POLICY "Admins view platform revenue events"
ON public.platform_revenue_events
FOR SELECT
USING (public.is_admin_any());

CREATE OR REPLACE FUNCTION public.create_notification(_user_id uuid, _title text, _message text, _type text DEFAULT 'transaction', _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications (user_id, title, message, type, metadata)
  VALUES (_user_id, _title, _message, COALESCE(_type, 'transaction'), COALESCE(_metadata, '{}'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_transaction_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.create_notification(
    NEW.user_id,
    CASE
      WHEN NEW.type = 'deposit' THEN 'Wallet funded'
      WHEN NEW.type = 'transfer_in' THEN 'Money received'
      WHEN NEW.type = 'transfer_out' THEN 'Money sent'
      WHEN NEW.type = 'withdrawal' THEN 'Withdrawal update'
      WHEN NEW.type = 'exchange' THEN 'Currency exchange'
      ELSE 'Transaction update'
    END,
    format('%s %s %s is %s', replace(initcap(NEW.type::text), '_', ' '), NEW.amount, NEW.currency, NEW.status),
    'transaction',
    jsonb_build_object('transaction_id', NEW.id, 'type', NEW.type, 'amount', NEW.amount, 'currency', NEW.currency, 'status', NEW.status)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_transaction_notify ON public.transactions;
CREATE TRIGGER on_transaction_notify
AFTER INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.notify_transaction_created();

CREATE OR REPLACE FUNCTION public.credit_platform_wallet(_currency wallet_currency, _amount numeric, _revenue_type text, _source text, _reference text DEFAULT NULL, _user_id uuid DEFAULT NULL, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RETURN; END IF;
  INSERT INTO public.platform_wallets (currency, revenue_type, balance)
  VALUES (_currency, COALESCE(_revenue_type, 'fees'), 0)
  ON CONFLICT (currency, revenue_type) DO NOTHING;

  UPDATE public.platform_wallets
  SET balance = balance + _amount, updated_at = now()
  WHERE currency = _currency AND revenue_type = COALESCE(_revenue_type, 'fees');

  INSERT INTO public.platform_revenue_events (currency, amount, revenue_type, source, reference, user_id, metadata)
  VALUES (_currency, _amount, COALESCE(_revenue_type, 'fees'), _source, _reference, _user_id, COALESCE(_metadata, '{}'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.fund_wallet(_user_id uuid, _currency wallet_currency, _amount numeric, _method text, _reference text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  INSERT INTO public.wallets (user_id, currency, balance)
    VALUES (_user_id, _currency, 0)
    ON CONFLICT (user_id, currency) DO NOTHING;
  UPDATE public.wallets
    SET balance = balance + _amount, updated_at = now()
    WHERE user_id = _user_id AND currency = _currency;
  INSERT INTO public.transactions (user_id, type, amount, currency, status, description)
    VALUES (_user_id, 'deposit', _amount, _currency, 'completed', format('Funded via %s (%s)', _method, _reference));
  RETURN json_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_funds_by_wallet(
  _to_wallet_number text,
  _amount numeric,
  _description text,
  _pin text,
  _from_currency wallet_currency DEFAULT NULL::wallet_currency
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _from_user uuid := auth.uid();
  _to_user uuid; _to_currency wallet_currency; _to_frozen boolean;
  _from_balance numeric; _from_frozen boolean;
  _src_currency wallet_currency;
  _rate numeric := 1;
  _gross_credited numeric;
  _credited numeric;
  _fee numeric := 0;
  _fee_cfg jsonb;
  _margin_cfg jsonb;
  _margin_percent numeric := 0;
  _commission numeric := 0;
BEGIN
  IF _from_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_account_active(_from_user) THEN RAISE EXCEPTION 'Account not active. Contact support.'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _pin IS NULL OR NOT public.verify_transaction_pin(_pin) THEN RAISE EXCEPTION 'Invalid PIN'; END IF;

  SELECT user_id, currency, is_frozen INTO _to_user, _to_currency, _to_frozen
    FROM public.wallets WHERE upper(wallet_number) = upper(_to_wallet_number);
  IF _to_user IS NULL THEN RAISE EXCEPTION 'Wallet number not found'; END IF;
  IF _to_user = _from_user THEN RAISE EXCEPTION 'Cannot transfer to your own wallet'; END IF;
  IF _to_frozen THEN RAISE EXCEPTION 'Recipient wallet is frozen'; END IF;

  _src_currency := COALESCE(_from_currency, _to_currency);

  SELECT balance, is_frozen INTO _from_balance, _from_frozen
    FROM public.wallets WHERE user_id = _from_user AND currency = _src_currency FOR UPDATE;
  IF _from_balance IS NULL THEN RAISE EXCEPTION 'You have no % wallet', _src_currency; END IF;
  IF _from_frozen THEN RAISE EXCEPTION 'Your wallet is frozen'; END IF;

  SELECT value INTO _fee_cfg FROM public.app_config WHERE key IN ('fee_transfer_wallet', 'fee_send_wallet') ORDER BY key LIMIT 1;
  IF _fee_cfg IS NOT NULL THEN
    _fee := round((_amount * COALESCE((_fee_cfg->>'percent')::numeric, 0) / 100) + COALESCE((_fee_cfg->>'flat')::numeric, 0), CASE WHEN _src_currency = 'ABN' THEN 6 ELSE 2 END);
  END IF;

  IF _from_balance < _amount + _fee THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  IF _src_currency = _to_currency THEN
    _gross_credited := _amount;
    _credited := _amount;
  ELSE
    SELECT rate INTO _rate FROM public.exchange_rates WHERE from_currency = _src_currency AND to_currency = _to_currency;
    IF _rate IS NULL THEN RAISE EXCEPTION 'Exchange rate % -> % not configured', _src_currency, _to_currency; END IF;
    SELECT value INTO _margin_cfg FROM public.app_config WHERE key IN ('fee_exchange_margin', 'fee_exchange') ORDER BY key LIMIT 1;
    IF _margin_cfg IS NOT NULL THEN _margin_percent := COALESCE((_margin_cfg->>'percent')::numeric, 0); END IF;
    _gross_credited := round(_amount * _rate, CASE WHEN _to_currency = 'ABN' THEN 6 ELSE 2 END);
    _commission := round(_gross_credited * _margin_percent / 100, CASE WHEN _to_currency = 'ABN' THEN 6 ELSE 2 END);
    _credited := _gross_credited - _commission;
    IF _credited <= 0 THEN RAISE EXCEPTION 'Converted amount is too small after commission'; END IF;
  END IF;

  UPDATE public.wallets SET balance = balance - (_amount + _fee), updated_at = now()
    WHERE user_id = _from_user AND currency = _src_currency;
  UPDATE public.wallets SET balance = balance + _credited, updated_at = now()
    WHERE user_id = _to_user AND currency = _to_currency;

  PERFORM public.credit_platform_wallet(_src_currency, _fee, 'fees', 'wallet_transfer', _to_wallet_number, _from_user, jsonb_build_object('to_user', _to_user));
  PERFORM public.credit_platform_wallet(_to_currency, _commission, 'exchange_commission', 'wallet_transfer_exchange', _to_wallet_number, _from_user, jsonb_build_object('to_user', _to_user, 'gross_credited', _gross_credited, 'rate', _rate));

  INSERT INTO public.transactions (user_id, counterparty_user_id, type, amount, currency, fee, status, description)
    VALUES (_from_user, _to_user, 'transfer_out', _amount, _src_currency, _fee, 'completed',
      coalesce(_description, '') ||
      CASE WHEN _src_currency = _to_currency
        THEN format(' (to %s)', _to_wallet_number)
        ELSE format(' (to %s | %s %s -> %s %s @ %s | commission %s %s)',
          _to_wallet_number, _amount, _src_currency, _credited, _to_currency, _rate, _commission, _to_currency)
      END);
  INSERT INTO public.transactions (user_id, counterparty_user_id, type, amount, currency, status, description)
    VALUES (_to_user, _from_user, 'transfer_in', _credited, _to_currency, 'completed',
      coalesce(_description, '') ||
      CASE WHEN _src_currency = _to_currency
        THEN ' (from wallet)'
        ELSE format(' (from wallet | %s %s @ %s)', _amount, _src_currency, _rate)
      END);

  RETURN json_build_object('success', true, 'from_currency', _src_currency, 'to_currency', _to_currency, 'amount_sent', _amount, 'amount_credited', _credited, 'fee', _fee, 'commission', _commission, 'rate', _rate);
END;
$$;

CREATE OR REPLACE FUNCTION public.exchange_currency(_from_currency wallet_currency, _to_currency wallet_currency, _amount numeric, _pin text DEFAULT NULL::text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user uuid := auth.uid(); _rate numeric; _from_balance numeric; _gross numeric; _converted numeric;
  _fee_cfg jsonb; _fee_percent numeric := 0; _commission numeric := 0;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_account_active(_user) THEN RAISE EXCEPTION 'Account not active. Contact support.'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _from_currency = _to_currency THEN RAISE EXCEPTION 'Currencies must differ'; END IF;
  IF _pin IS NULL OR NOT public.verify_transaction_pin(_pin) THEN RAISE EXCEPTION 'Invalid PIN'; END IF;

  SELECT rate INTO _rate FROM public.exchange_rates WHERE from_currency = _from_currency AND to_currency = _to_currency;
  IF _rate IS NULL THEN RAISE EXCEPTION 'Rate unavailable'; END IF;

  SELECT balance INTO _from_balance FROM public.wallets WHERE user_id = _user AND currency = _from_currency FOR UPDATE;
  IF _from_balance IS NULL THEN RAISE EXCEPTION 'Source wallet not found'; END IF;
  IF _from_balance < _amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  SELECT value INTO _fee_cfg FROM public.app_config WHERE key IN ('fee_exchange_margin', 'fee_exchange') ORDER BY key LIMIT 1;
  IF _fee_cfg IS NOT NULL THEN _fee_percent := COALESCE((_fee_cfg->>'percent')::numeric, 0); END IF;

  _gross := round(_amount * _rate, CASE WHEN _to_currency = 'ABN' THEN 6 ELSE 2 END);
  _commission := round(_gross * _fee_percent / 100, CASE WHEN _to_currency = 'ABN' THEN 6 ELSE 2 END);
  _converted := _gross - _commission;
  IF _converted <= 0 THEN RAISE EXCEPTION 'Converted amount is too small after commission'; END IF;

  INSERT INTO public.wallets (user_id, currency, balance) VALUES (_user, _to_currency, 0) ON CONFLICT (user_id, currency) DO NOTHING;
  UPDATE public.wallets SET balance = balance - _amount, updated_at = now() WHERE user_id = _user AND currency = _from_currency;
  UPDATE public.wallets SET balance = balance + _converted, updated_at = now() WHERE user_id = _user AND currency = _to_currency;
  PERFORM public.credit_platform_wallet(_to_currency, _commission, 'exchange_commission', 'currency_exchange', NULL, _user, jsonb_build_object('from_currency', _from_currency, 'gross', _gross, 'rate', _rate));

  INSERT INTO public.transactions (user_id, type, amount, currency, status, description)
    VALUES (_user, 'exchange', _amount, _from_currency, 'completed', format('Exchange %s %s -> %s %s @ %s', _amount, _from_currency, _converted, _to_currency, _rate));
  INSERT INTO public.transactions (user_id, type, amount, currency, fee, status, description)
    VALUES (_user, 'exchange', _converted, _to_currency, _commission, 'completed', format('Exchange %s %s -> %s %s @ %s | commission %s', _amount, _from_currency, _converted, _to_currency, _rate, _commission));

  RETURN json_build_object('success', true, 'converted', _converted, 'rate', _rate, 'commission', _commission);
END;
$$;

ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.platform_wallets REPLICA IDENTITY FULL;
ALTER TABLE public.platform_revenue_events REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_wallets;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_revenue_events;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;