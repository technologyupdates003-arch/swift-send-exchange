CREATE OR REPLACE FUNCTION public.send_to_mpesa(_phone text, _amount numeric, _pin text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _user uuid := auth.uid(); _balance numeric; _payout_id uuid; _fee numeric := 0; _fee_cfg jsonb;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_account_active(_user) THEN RAISE EXCEPTION 'Account not active. Contact support.'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _phone !~ '^(?:\+?254|0)?[17]\d{8}$' THEN RAISE EXCEPTION 'Invalid phone number'; END IF;
  IF NOT public.verify_transaction_pin(_pin) THEN RAISE EXCEPTION 'Invalid PIN'; END IF;
  SELECT value INTO _fee_cfg FROM public.app_config WHERE key = 'fee_send_mpesa';
  IF _fee_cfg IS NOT NULL THEN
    _fee := round((_amount * COALESCE((_fee_cfg->>'percent')::numeric, 0) / 100) + COALESCE((_fee_cfg->>'flat')::numeric, 0), 2);
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
  PERFORM public.credit_platform_wallet('KES', _fee, 'fees', 'mpesa_send', _payout_id::text, _user, jsonb_build_object('phone', _phone));
  INSERT INTO public.transactions (user_id, type, amount, currency, fee, status, description)
    VALUES (_user, 'transfer_out', _amount + _fee, 'KES', _fee, 'pending',
      format('M-Pesa send to %s | payout:%s | fee %s', _phone, _payout_id, _fee));
  RETURN json_build_object('success', true, 'payout_id', _payout_id, 'fee', _fee);
END;
$$;

CREATE OR REPLACE FUNCTION public.withdraw_to_mpesa(_phone text, _amount numeric, _pin text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _user uuid := auth.uid(); _balance numeric; _payout_id uuid; _fee numeric := 0; _fee_cfg jsonb;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_account_active(_user) THEN RAISE EXCEPTION 'Account not active. Contact support.'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _phone !~ '^(?:\+?254|0)?[17]\d{8}$' THEN RAISE EXCEPTION 'Invalid phone number'; END IF;
  IF NOT public.verify_transaction_pin(_pin) THEN RAISE EXCEPTION 'Invalid PIN'; END IF;
  SELECT value INTO _fee_cfg FROM public.app_config WHERE key = 'fee_withdraw_mpesa';
  IF _fee_cfg IS NOT NULL THEN
    _fee := round((_amount * COALESCE((_fee_cfg->>'percent')::numeric, 0) / 100) + COALESCE((_fee_cfg->>'flat')::numeric, 0), 2);
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
  PERFORM public.credit_platform_wallet('KES', _fee, 'fees', 'mpesa_withdrawal', _payout_id::text, _user, jsonb_build_object('phone', _phone));
  INSERT INTO public.transactions (user_id, type, amount, currency, fee, status, description)
    VALUES (_user, 'withdrawal', _amount + _fee, 'KES', _fee, 'pending',
      format('M-Pesa withdrawal to %s | payout:%s | fee %s', _phone, _payout_id, _fee));
  RETURN json_build_object('success', true, 'payout_id', _payout_id, 'fee', _fee, 'available_after', _balance - (_amount + _fee));
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_to_mpesa(text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_to_mpesa(text, numeric, text) TO authenticated;