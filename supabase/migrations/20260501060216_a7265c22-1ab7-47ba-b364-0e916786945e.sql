
-- 1. Fix lookup_wallet to include user_id + wallet_number
CREATE OR REPLACE FUNCTION public.lookup_wallet(_wallet_number text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _row record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT w.user_id, w.wallet_number, w.currency, w.is_frozen, p.full_name, p.email
    INTO _row FROM public.wallets w
    JOIN public.profiles p ON p.id = w.user_id
    WHERE w.wallet_number = _wallet_number;
  IF _row.user_id IS NULL THEN
    RETURN json_build_object('found', false);
  END IF;
  RETURN json_build_object(
    'found', true,
    'user_id', _row.user_id,
    'wallet_number', _row.wallet_number,
    'full_name', _row.full_name,
    'email', _row.email,
    'currency', _row.currency,
    'is_frozen', _row.is_frozen,
    'is_self', _row.user_id = auth.uid()
  );
END; $function$;

-- 2. Allow users to DELETE their own wallets (RLS policy)
CREATE POLICY "Users delete own wallets"
  ON public.wallets FOR DELETE
  USING (auth.uid() = user_id);

-- 3. Safe delete-wallet RPC: balance must be 0, not frozen, not last wallet
CREATE OR REPLACE FUNCTION public.delete_wallet(_wallet_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _w record;
  _wallet_count int;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO _w FROM public.wallets WHERE id = _wallet_id AND user_id = _user;
  IF _w.id IS NULL THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  IF _w.is_frozen THEN RAISE EXCEPTION 'Wallet is frozen'; END IF;
  IF _w.balance <> 0 THEN RAISE EXCEPTION 'Wallet balance must be 0 to delete (current: %)', _w.balance; END IF;
  SELECT count(*) INTO _wallet_count FROM public.wallets WHERE user_id = _user;
  IF _wallet_count <= 1 THEN RAISE EXCEPTION 'Cannot delete your only wallet'; END IF;
  DELETE FROM public.wallets WHERE id = _wallet_id;
  RETURN json_build_object('success', true);
END; $function$;
