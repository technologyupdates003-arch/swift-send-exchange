create or replace function public.exchange_currency(_from_currency wallet_currency, _to_currency wallet_currency, _amount numeric, _pin text default null)
returns json language plpgsql security definer set search_path = public as $$
declare _user uuid := auth.uid(); _rate numeric; _from_balance numeric; _converted numeric;
begin
  if _user is null then raise exception 'Not authenticated'; end if;
  if _amount <= 0 then raise exception 'Amount must be positive'; end if;
  if _from_currency = _to_currency then raise exception 'Currencies must differ'; end if;
  if _pin is null or not public.verify_transaction_pin(_pin) then raise exception 'Invalid PIN'; end if;

  select rate into _rate from public.exchange_rates where from_currency = _from_currency and to_currency = _to_currency;
  if _rate is null then raise exception 'Rate unavailable'; end if;

  select balance into _from_balance from public.wallets where user_id = _user and currency = _from_currency for update;
  if _from_balance is null then raise exception 'Source wallet not found'; end if;
  if _from_balance < _amount then raise exception 'Insufficient balance'; end if;

  insert into public.wallets (user_id, currency, balance) values (_user, _to_currency, 0) on conflict (user_id, currency) do nothing;
  _converted := round(_amount * _rate, 2);

  update public.wallets set balance = balance - _amount where user_id = _user and currency = _from_currency;
  update public.wallets set balance = balance + _converted where user_id = _user and currency = _to_currency;

  insert into public.transactions (user_id, type, amount, currency, description)
    values (_user, 'exchange', _amount, _from_currency, format('Exchange %s %s -> %s %s @ %s', _amount, _from_currency, _converted, _to_currency, _rate));
  insert into public.transactions (user_id, type, amount, currency, description)
    values (_user, 'exchange', _converted, _to_currency, format('Exchange %s %s -> %s %s @ %s', _amount, _from_currency, _converted, _to_currency, _rate));

  return json_build_object('success', true, 'converted', _converted, 'rate', _rate);
end; $$;
