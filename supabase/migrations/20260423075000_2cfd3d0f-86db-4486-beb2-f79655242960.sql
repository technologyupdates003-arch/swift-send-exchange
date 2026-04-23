
-- 1. Add ABN to wallet_currency enum
ALTER TYPE public.wallet_currency ADD VALUE IF NOT EXISTS 'ABN';

-- 2. Drop unused tables
DROP TABLE IF EXISTS public.virtualpay_transactions CASCADE;
DROP TABLE IF EXISTS public.paystack_transactions CASCADE;

-- 3. Aban Coin AMM market
CREATE TABLE public.aban_market (
  id int PRIMARY KEY DEFAULT 1,
  reserve_abn numeric NOT NULL DEFAULT 1000000,
  reserve_usd numeric NOT NULL DEFAULT 100000,
  total_volume_usd numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);
INSERT INTO public.aban_market (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE public.aban_market ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read aban market" ON public.aban_market FOR SELECT USING (true);

-- 4. Paystack recipients (cached)
CREATE TABLE public.paystack_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  recipient_code text NOT NULL UNIQUE,
  bank_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, bank_account_id)
);
ALTER TABLE public.paystack_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own recipients" ON public.paystack_recipients FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins view all recipients" ON public.paystack_recipients FOR SELECT USING (public.is_admin_any());

-- 5. Paystack transfers (NGN bank withdrawals)
CREATE TABLE public.paystack_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  withdrawal_id uuid,
  bank_account_id uuid NOT NULL,
  amount numeric NOT NULL,
  fee numeric NOT NULL DEFAULT 0,
  currency wallet_currency NOT NULL DEFAULT 'NGN',
  reference text NOT NULL UNIQUE,
  transfer_code text,
  status text NOT NULL DEFAULT 'pending',
  requires_otp boolean NOT NULL DEFAULT false,
  provider_response jsonb,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.paystack_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own transfers" ON public.paystack_transfers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins view all transfers" ON public.paystack_transfers FOR SELECT USING (public.is_admin_any());

-- 6. Paystack card charges
CREATE TABLE public.paystack_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reference text NOT NULL UNIQUE,
  amount numeric NOT NULL,
  currency wallet_currency NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  card_last4 text,
  card_brand text,
  next_action text,
  provider_response jsonb,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.paystack_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own charges" ON public.paystack_charges FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins view all charges" ON public.paystack_charges FOR SELECT USING (public.is_admin_any());

-- 7. IntaSend STK requests
CREATE TABLE public.mpesa_stk_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  phone_number text NOT NULL,
  amount numeric NOT NULL,
  reference text NOT NULL UNIQUE,
  invoice_id text,
  status text NOT NULL DEFAULT 'pending',
  provider_response jsonb,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.mpesa_stk_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own stk" ON public.mpesa_stk_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins view all stk" ON public.mpesa_stk_requests FOR SELECT USING (public.is_admin_any());

-- 8. Updated_at triggers
CREATE TRIGGER trg_paystack_transfers_updated BEFORE UPDATE ON public.paystack_transfers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_paystack_charges_updated BEFORE UPDATE ON public.paystack_charges
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_mpesa_stk_updated BEFORE UPDATE ON public.mpesa_stk_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 9. Aban Coin price quote (read-only)
CREATE OR REPLACE FUNCTION public.aban_quote()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _r record;
BEGIN
  SELECT reserve_abn, reserve_usd, total_volume_usd FROM public.aban_market WHERE id = 1 INTO _r;
  RETURN json_build_object(
    'reserve_abn', _r.reserve_abn,
    'reserve_usd', _r.reserve_usd,
    'price_usd', round(_r.reserve_usd / NULLIF(_r.reserve_abn, 0), 6),
    'total_volume_usd', _r.total_volume_usd
  );
END; $$;

-- 10. Buy ABN with USD (constant product: x*y=k)
CREATE OR REPLACE FUNCTION public.aban_buy_abn(_usd_amount numeric, _pin text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user uuid := auth.uid();
  _usd_balance numeric;
  _ra numeric; _ru numeric; _k numeric;
  _new_ra numeric; _abn_out numeric; _price numeric;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _usd_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF NOT public.verify_transaction_pin(_pin) THEN RAISE EXCEPTION 'Invalid PIN'; END IF;

  SELECT balance INTO _usd_balance FROM public.wallets
    WHERE user_id = _user AND currency = 'USD' FOR UPDATE;
  IF _usd_balance IS NULL THEN RAISE EXCEPTION 'No USD wallet'; END IF;
  IF _usd_balance < _usd_amount THEN RAISE EXCEPTION 'Insufficient USD balance'; END IF;

  SELECT reserve_abn, reserve_usd INTO _ra, _ru FROM public.aban_market WHERE id = 1 FOR UPDATE;
  _k := _ra * _ru;
  _new_ra := _k / (_ru + _usd_amount);
  _abn_out := _ra - _new_ra;
  IF _abn_out <= 0 THEN RAISE EXCEPTION 'Insufficient ABN liquidity'; END IF;
  _price := _usd_amount / _abn_out;

  UPDATE public.aban_market SET
    reserve_abn = _new_ra,
    reserve_usd = _ru + _usd_amount,
    total_volume_usd = total_volume_usd + _usd_amount,
    updated_at = now()
    WHERE id = 1;

  UPDATE public.wallets SET balance = balance - _usd_amount, updated_at = now()
    WHERE user_id = _user AND currency = 'USD';

  INSERT INTO public.wallets (user_id, currency, balance) VALUES (_user, 'ABN', 0)
    ON CONFLICT (user_id, currency) DO NOTHING;
  UPDATE public.wallets SET balance = balance + _abn_out, updated_at = now()
    WHERE user_id = _user AND currency = 'ABN';

  INSERT INTO public.transactions (user_id, type, amount, currency, status, description)
    VALUES (_user, 'exchange', _usd_amount, 'USD', 'completed',
      format('Buy %s ABN @ $%s', round(_abn_out, 4), round(_price, 6)));
  INSERT INTO public.transactions (user_id, type, amount, currency, status, description)
    VALUES (_user, 'exchange', _abn_out, 'ABN', 'completed',
      format('Bought ABN with $%s @ $%s', _usd_amount, round(_price, 6)));

  RETURN json_build_object('success', true, 'abn_received', round(_abn_out, 6), 'price', round(_price, 6));
END; $$;

-- 11. Sell ABN for USD
CREATE OR REPLACE FUNCTION public.aban_sell_abn(_abn_amount numeric, _pin text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user uuid := auth.uid();
  _abn_balance numeric;
  _ra numeric; _ru numeric; _k numeric;
  _new_ru numeric; _usd_out numeric; _price numeric;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _abn_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF NOT public.verify_transaction_pin(_pin) THEN RAISE EXCEPTION 'Invalid PIN'; END IF;

  SELECT balance INTO _abn_balance FROM public.wallets
    WHERE user_id = _user AND currency = 'ABN' FOR UPDATE;
  IF _abn_balance IS NULL THEN RAISE EXCEPTION 'No ABN wallet'; END IF;
  IF _abn_balance < _abn_amount THEN RAISE EXCEPTION 'Insufficient ABN balance'; END IF;

  SELECT reserve_abn, reserve_usd INTO _ra, _ru FROM public.aban_market WHERE id = 1 FOR UPDATE;
  _k := _ra * _ru;
  _new_ru := _k / (_ra + _abn_amount);
  _usd_out := _ru - _new_ru;
  IF _usd_out <= 0 THEN RAISE EXCEPTION 'Insufficient USD liquidity'; END IF;
  _price := _usd_out / _abn_amount;

  UPDATE public.aban_market SET
    reserve_abn = _ra + _abn_amount,
    reserve_usd = _new_ru,
    total_volume_usd = total_volume_usd + _usd_out,
    updated_at = now()
    WHERE id = 1;

  UPDATE public.wallets SET balance = balance - _abn_amount, updated_at = now()
    WHERE user_id = _user AND currency = 'ABN';

  INSERT INTO public.wallets (user_id, currency, balance) VALUES (_user, 'USD', 0)
    ON CONFLICT (user_id, currency) DO NOTHING;
  UPDATE public.wallets SET balance = balance + _usd_out, updated_at = now()
    WHERE user_id = _user AND currency = 'USD';

  INSERT INTO public.transactions (user_id, type, amount, currency, status, description)
    VALUES (_user, 'exchange', _abn_amount, 'ABN', 'completed',
      format('Sell %s ABN @ $%s', _abn_amount, round(_price, 6)));
  INSERT INTO public.transactions (user_id, type, amount, currency, status, description)
    VALUES (_user, 'exchange', _usd_out, 'USD', 'completed',
      format('Sold %s ABN for $%s @ $%s', _abn_amount, round(_usd_out, 4), round(_price, 6)));

  RETURN json_build_object('success', true, 'usd_received', round(_usd_out, 4), 'price', round(_price, 6));
END; $$;
