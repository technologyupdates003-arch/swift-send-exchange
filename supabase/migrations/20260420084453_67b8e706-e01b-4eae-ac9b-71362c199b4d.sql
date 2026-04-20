CREATE OR REPLACE FUNCTION public.set_transaction_pin(_pin text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, extensions
AS $function$
declare _user uuid := auth.uid();
begin
  if _user is null then raise exception 'Not authenticated'; end if;
  if _pin !~ '^\d{4}$' then raise exception 'PIN must be 4 digits'; end if;
  insert into public.transaction_pins (user_id, pin_hash)
    values (_user, extensions.crypt(_pin, extensions.gen_salt('bf')))
    on conflict (user_id) do update
      set pin_hash = extensions.crypt(_pin, extensions.gen_salt('bf')),
          updated_at = now();
  return json_build_object('success', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.verify_transaction_pin(_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, extensions
AS $function$
declare _user uuid := auth.uid(); _hash text;
begin
  if _user is null then return false; end if;
  select pin_hash into _hash from public.transaction_pins where user_id = _user;
  if _hash is null then return false; end if;
  return _hash = extensions.crypt(_pin, _hash);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.set_transaction_pin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_transaction_pin(text) TO authenticated;
NOTIFY pgrst, 'reload schema';