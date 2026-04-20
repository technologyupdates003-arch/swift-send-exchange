-- 1. Add wallet_number column
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS wallet_number text UNIQUE;

-- 2. Generator function: ABN + 10 digits, collision-safe
CREATE OR REPLACE FUNCTION public.generate_wallet_number()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE _n text; _exists boolean;
BEGIN
  LOOP
    _n := 'ABN' || lpad((floor(random() * 10000000000))::bigint::text, 10, '0');
    SELECT EXISTS(SELECT 1 FROM public.wallets WHERE wallet_number = _n) INTO _exists;
    EXIT WHEN NOT _exists;
  END LOOP;
  RETURN _n;
END; $$;

-- 3. Backfill existing wallets
UPDATE public.wallets SET wallet_number = public.generate_wallet_number() WHERE wallet_number IS NULL;

-- 4. Make NOT NULL
ALTER TABLE public.wallets ALTER COLUMN wallet_number SET NOT NULL;
ALTER TABLE public.wallets ALTER COLUMN wallet_number SET DEFAULT public.generate_wallet_number();

-- 5. Trigger to ensure auto-generation on insert (defensive)
CREATE OR REPLACE FUNCTION public.ensure_wallet_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.wallet_number IS NULL THEN
    NEW.wallet_number := public.generate_wallet_number();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_ensure_wallet_number ON public.wallets;
CREATE TRIGGER trg_ensure_wallet_number BEFORE INSERT ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.ensure_wallet_number();

-- 6. Lookup function (anyone authenticated can resolve a wallet number to owner name + currency)
CREATE OR REPLACE FUNCTION public.lookup_wallet(_wallet_number text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT w.user_id, w.currency, w.is_frozen, p.full_name, p.email
    INTO _row FROM public.wallets w
    JOIN public.profiles p ON p.id = w.user_id
    WHERE w.wallet_number = _wallet_number;
  IF _row.user_id IS NULL THEN
    RETURN json_build_object('found', false);
  END IF;
  RETURN json_build_object(
    'found', true,
    'full_name', _row.full_name,
    'email', _row.email,
    'currency', _row.currency,
    'is_frozen', _row.is_frozen,
    'is_self', _row.user_id = auth.uid()
  );
END; $$;

-- 7. Transfer by wallet number
CREATE OR REPLACE FUNCTION public.transfer_funds_by_wallet(
  _to_wallet_number text, _amount numeric, _description text, _pin text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _from_user uuid := auth.uid();
  _to_user uuid; _to_currency wallet_currency; _to_frozen boolean;
  _from_balance numeric; _from_frozen boolean;
BEGIN
  IF _from_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _pin IS NULL OR NOT public.verify_transaction_pin(_pin) THEN RAISE EXCEPTION 'Invalid PIN'; END IF;

  SELECT user_id, currency, is_frozen INTO _to_user, _to_currency, _to_frozen
    FROM public.wallets WHERE wallet_number = _to_wallet_number;
  IF _to_user IS NULL THEN RAISE EXCEPTION 'Wallet number not found'; END IF;
  IF _to_user = _from_user THEN RAISE EXCEPTION 'Cannot transfer to your own wallet'; END IF;
  IF _to_frozen THEN RAISE EXCEPTION 'Recipient wallet is frozen'; END IF;

  SELECT balance, is_frozen INTO _from_balance, _from_frozen
    FROM public.wallets WHERE user_id = _from_user AND currency = _to_currency FOR UPDATE;
  IF _from_balance IS NULL THEN RAISE EXCEPTION 'You have no % wallet', _to_currency; END IF;
  IF _from_frozen THEN RAISE EXCEPTION 'Your wallet is frozen'; END IF;
  IF _from_balance < _amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  UPDATE public.wallets SET balance = balance - _amount
    WHERE user_id = _from_user AND currency = _to_currency;
  UPDATE public.wallets SET balance = balance + _amount
    WHERE user_id = _to_user AND currency = _to_currency;

  INSERT INTO public.transactions (user_id, counterparty_user_id, type, amount, currency, description)
    VALUES (_from_user, _to_user, 'transfer_out', _amount, _to_currency,
      coalesce(_description, '') || ' (to ' || _to_wallet_number || ')');
  INSERT INTO public.transactions (user_id, counterparty_user_id, type, amount, currency, description)
    VALUES (_to_user, _from_user, 'transfer_in', _amount, _to_currency,
      coalesce(_description, '') || ' (from wallet)');

  RETURN json_build_object('success', true, 'currency', _to_currency);
END; $$;