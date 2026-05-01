CREATE OR REPLACE FUNCTION public.transfer_funds_by_wallet(
  _to_wallet_number text,
  _amount numeric,
  _description text,
  _pin text,
  _from_currency wallet_currency DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _from_user uuid := auth.uid();
  _to_user uuid; _to_currency wallet_currency; _to_frozen boolean;
  _from_balance numeric; _from_frozen boolean;
  _src_currency wallet_currency;
  _rate numeric;
  _credited numeric;
BEGIN
  IF _from_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _pin IS NULL OR NOT public.verify_transaction_pin(_pin) THEN RAISE EXCEPTION 'Invalid PIN'; END IF;

  SELECT user_id, currency, is_frozen INTO _to_user, _to_currency, _to_frozen
    FROM public.wallets WHERE wallet_number = _to_wallet_number;
  IF _to_user IS NULL THEN RAISE EXCEPTION 'Wallet number not found'; END IF;
  IF _to_user = _from_user THEN RAISE EXCEPTION 'Cannot transfer to your own wallet'; END IF;
  IF _to_frozen THEN RAISE EXCEPTION 'Recipient wallet is frozen'; END IF;

  -- Default sender currency = recipient currency (back-compat)
  _src_currency := COALESCE(_from_currency, _to_currency);

  SELECT balance, is_frozen INTO _from_balance, _from_frozen
    FROM public.wallets WHERE user_id = _from_user AND currency = _src_currency FOR UPDATE;
  IF _from_balance IS NULL THEN RAISE EXCEPTION 'You have no % wallet', _src_currency; END IF;
  IF _from_frozen THEN RAISE EXCEPTION 'Your wallet is frozen'; END IF;
  IF _from_balance < _amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  IF _src_currency = _to_currency THEN
    _credited := _amount;
    _rate := 1;
  ELSE
    SELECT rate INTO _rate FROM public.exchange_rates
      WHERE from_currency = _src_currency AND to_currency = _to_currency;
    IF _rate IS NULL THEN
      RAISE EXCEPTION 'Exchange rate % -> % not configured', _src_currency, _to_currency;
    END IF;
    _credited := round(_amount * _rate, CASE WHEN _to_currency = 'ABN' THEN 6 ELSE 2 END);
  END IF;

  -- Ensure recipient wallet row exists (it does, since we found it above) — no-op safe
  -- Debit sender, credit recipient
  UPDATE public.wallets SET balance = balance - _amount, updated_at = now()
    WHERE user_id = _from_user AND currency = _src_currency;
  UPDATE public.wallets SET balance = balance + _credited, updated_at = now()
    WHERE user_id = _to_user AND currency = _to_currency;

  INSERT INTO public.transactions (user_id, counterparty_user_id, type, amount, currency, description)
    VALUES (_from_user, _to_user, 'transfer_out', _amount, _src_currency,
      coalesce(_description, '') ||
      CASE WHEN _src_currency = _to_currency
        THEN format(' (to %s)', _to_wallet_number)
        ELSE format(' (to %s | %s %s -> %s %s @ %s)',
          _to_wallet_number, _amount, _src_currency, _credited, _to_currency, _rate)
      END);
  INSERT INTO public.transactions (user_id, counterparty_user_id, type, amount, currency, description)
    VALUES (_to_user, _from_user, 'transfer_in', _credited, _to_currency,
      coalesce(_description, '') ||
      CASE WHEN _src_currency = _to_currency
        THEN ' (from wallet)'
        ELSE format(' (from wallet | %s %s @ %s)', _amount, _src_currency, _rate)
      END);

  RETURN json_build_object(
    'success', true,
    'from_currency', _src_currency,
    'to_currency', _to_currency,
    'amount_sent', _amount,
    'amount_credited', _credited,
    'rate', _rate
  );
END;
$function$;