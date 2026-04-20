CREATE OR REPLACE FUNCTION public.generate_wallet_number()
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _n text; _exists boolean;
BEGIN
  LOOP
    _n := 'ABN' || lpad((floor(random() * 10000000000))::bigint::text, 10, '0');
    SELECT EXISTS(SELECT 1 FROM public.wallets WHERE wallet_number = _n) INTO _exists;
    EXIT WHEN NOT _exists;
  END LOOP;
  RETURN _n;
END; $$;

CREATE OR REPLACE FUNCTION public.ensure_wallet_number()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.wallet_number IS NULL THEN
    NEW.wallet_number := public.generate_wallet_number();
  END IF;
  RETURN NEW;
END; $$;