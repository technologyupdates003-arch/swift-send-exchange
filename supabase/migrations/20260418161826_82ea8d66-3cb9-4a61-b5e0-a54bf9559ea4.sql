create extension if not exists pgcrypto;

-- Transaction PIN table
create table if not exists public.transaction_pins (
  user_id uuid primary key,
  pin_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.transaction_pins enable row level security;
drop policy if exists "Users view own pin meta" on public.transaction_pins;
create policy "Users view own pin meta" on public.transaction_pins for select using (auth.uid() = user_id);

-- App-wide config
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.app_config enable row level security;
drop policy if exists "Authenticated read config" on public.app_config;
drop policy if exists "Super admin manage config" on public.app_config;
create policy "Authenticated read config" on public.app_config for select to authenticated using (true);
create policy "Super admin manage config" on public.app_config for all using (public.has_role(auth.uid(), 'super_admin'::app_role)) with check (public.has_role(auth.uid(), 'super_admin'::app_role));

insert into public.app_config (key, value, description) values
  ('fee_send_wallet', '{"percent": 0.5, "flat": 0}'::jsonb, 'Wallet-to-wallet send fee'),
  ('fee_send_mpesa', '{"percent": 1.5, "flat": 25}'::jsonb, 'Send to M-Pesa fee (KES)'),
  ('fee_withdraw_bank', '{"percent": 1.0, "flat": 50}'::jsonb, 'Bank withdrawal fee'),
  ('fee_withdraw_mpesa', '{"percent": 1.5, "flat": 25}'::jsonb, 'M-Pesa withdrawal fee'),
  ('fee_fund_card', '{"percent": 2.9, "flat": 30}'::jsonb, 'Card funding fee'),
  ('fee_fund_mpesa', '{"percent": 1.0, "flat": 0}'::jsonb, 'M-Pesa funding fee'),
  ('fee_exchange', '{"percent": 1.0, "flat": 0}'::jsonb, 'Currency exchange spread'),
  ('limits_daily', '{"send": 10000, "withdraw": 5000, "fund": 10000}'::jsonb, 'Daily limits per user (USD eq)')
on conflict (key) do nothing;

-- M-Pesa payouts
create table if not exists public.mpesa_payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  phone_number text not null,
  amount numeric not null,
  fee numeric not null default 0,
  status text not null default 'pending',
  reference text,
  provider_response jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.mpesa_payouts enable row level security;
drop policy if exists "Users view own payouts" on public.mpesa_payouts;
drop policy if exists "Admins view all payouts" on public.mpesa_payouts;
drop policy if exists "Admins update payouts" on public.mpesa_payouts;
create policy "Users view own payouts" on public.mpesa_payouts for select using (auth.uid() = user_id);
create policy "Admins view all payouts" on public.mpesa_payouts for select using (public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'super_admin'::app_role));
create policy "Admins update payouts" on public.mpesa_payouts for update using (public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'super_admin'::app_role));

-- Unique constraint on user_roles
do $$ begin
  alter table public.user_roles add constraint user_roles_user_role_unique unique (user_id, role);
exception when duplicate_object then null; when duplicate_table then null; end $$;

-- PIN functions
create or replace function public.set_transaction_pin(_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare _user uuid := auth.uid();
begin
  if _user is null then raise exception 'Not authenticated'; end if;
  if _pin !~ '^\d{4}$' then raise exception 'PIN must be 4 digits'; end if;
  insert into public.transaction_pins (user_id, pin_hash)
    values (_user, crypt(_pin, gen_salt('bf')))
    on conflict (user_id) do update set pin_hash = crypt(_pin, gen_salt('bf')), updated_at = now();
  return json_build_object('success', true);
end; $$;

create or replace function public.verify_transaction_pin(_pin text)
returns boolean language plpgsql security definer set search_path = public as $$
declare _user uuid := auth.uid(); _hash text;
begin
  if _user is null then return false; end if;
  select pin_hash into _hash from public.transaction_pins where user_id = _user;
  if _hash is null then return false; end if;
  return _hash = crypt(_pin, _hash);
end; $$;

create or replace function public.has_pin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.transaction_pins where user_id = auth.uid())
$$;

-- transfer_funds with PIN
create or replace function public.transfer_funds(_to_email text, _currency wallet_currency, _amount numeric, _description text, _pin text default null)
returns json language plpgsql security definer set search_path = public as $$
declare _from_user uuid := auth.uid(); _to_user uuid; _from_balance numeric;
begin
  if _from_user is null then raise exception 'Not authenticated'; end if;
  if _amount <= 0 then raise exception 'Amount must be positive'; end if;
  if _pin is null or not public.verify_transaction_pin(_pin) then raise exception 'Invalid PIN'; end if;
  select id into _to_user from public.profiles where email = _to_email;
  if _to_user is null then raise exception 'Recipient not found'; end if;
  if _to_user = _from_user then raise exception 'Cannot transfer to yourself'; end if;
  select balance into _from_balance from public.wallets where user_id = _from_user and currency = _currency for update;
  if _from_balance is null then raise exception 'Sender wallet not found'; end if;
  if _from_balance < _amount then raise exception 'Insufficient balance'; end if;
  insert into public.wallets (user_id, currency, balance) values (_to_user, _currency, 0) on conflict (user_id, currency) do nothing;
  update public.wallets set balance = balance - _amount where user_id = _from_user and currency = _currency;
  update public.wallets set balance = balance + _amount where user_id = _to_user and currency = _currency;
  insert into public.transactions (user_id, counterparty_user_id, type, amount, currency, description)
    values (_from_user, _to_user, 'transfer_out', _amount, _currency, _description);
  insert into public.transactions (user_id, counterparty_user_id, type, amount, currency, description)
    values (_to_user, _from_user, 'transfer_in', _amount, _currency, _description);
  return json_build_object('success', true);
end; $$;

-- request_withdrawal with PIN
create or replace function public.request_withdrawal(_bank_account_id uuid, _currency wallet_currency, _amount numeric, _pin text default null)
returns json language plpgsql security definer set search_path = public as $$
declare _user uuid := auth.uid(); _balance numeric; _bank_owner uuid; _withdrawal_id uuid;
begin
  if _user is null then raise exception 'Not authenticated'; end if;
  if _amount <= 0 then raise exception 'Amount must be positive'; end if;
  if _pin is null or not public.verify_transaction_pin(_pin) then raise exception 'Invalid PIN'; end if;
  select user_id into _bank_owner from public.bank_accounts where id = _bank_account_id;
  if _bank_owner is null or _bank_owner <> _user then raise exception 'Invalid bank account'; end if;
  select balance into _balance from public.wallets where user_id = _user and currency = _currency for update;
  if _balance is null then raise exception 'Wallet not found'; end if;
  if _balance < _amount then raise exception 'Insufficient balance'; end if;
  update public.wallets set balance = balance - _amount where user_id = _user and currency = _currency;
  insert into public.withdrawal_requests (user_id, bank_account_id, amount, currency)
    values (_user, _bank_account_id, _amount, _currency) returning id into _withdrawal_id;
  insert into public.transactions (user_id, type, amount, currency, status, description)
    values (_user, 'withdrawal', _amount, _currency, 'pending', 'Bank withdrawal request');
  return json_build_object('success', true, 'withdrawal_id', _withdrawal_id);
end; $$;

-- send_to_mpesa
create or replace function public.send_to_mpesa(_phone text, _amount numeric, _pin text)
returns json language plpgsql security definer set search_path = public as $$
declare _user uuid := auth.uid(); _balance numeric; _payout_id uuid; _fee numeric := 0; _fee_cfg jsonb;
begin
  if _user is null then raise exception 'Not authenticated'; end if;
  if _amount <= 0 then raise exception 'Amount must be positive'; end if;
  if _phone !~ '^(?:\+?254|0)?[17]\d{8}$' then raise exception 'Invalid phone number'; end if;
  if not public.verify_transaction_pin(_pin) then raise exception 'Invalid PIN'; end if;
  select value into _fee_cfg from public.app_config where key = 'fee_send_mpesa';
  if _fee_cfg is not null then
    _fee := round((_amount * (_fee_cfg->>'percent')::numeric / 100) + (_fee_cfg->>'flat')::numeric, 2);
  end if;
  select balance into _balance from public.wallets where user_id = _user and currency = 'KES' for update;
  if _balance is null then raise exception 'KES wallet not found. Create one first.'; end if;
  if _balance < _amount + _fee then raise exception 'Insufficient balance (incl. fee)'; end if;
  update public.wallets set balance = balance - (_amount + _fee) where user_id = _user and currency = 'KES';
  insert into public.mpesa_payouts (user_id, phone_number, amount, fee, status)
    values (_user, _phone, _amount, _fee, 'pending') returning id into _payout_id;
  insert into public.transactions (user_id, type, amount, currency, status, description)
    values (_user, 'transfer_out', _amount + _fee, 'KES', 'pending', format('M-Pesa send to %s (fee %s)', _phone, _fee));
  return json_build_object('success', true, 'payout_id', _payout_id, 'fee', _fee);
end; $$;

-- withdraw_to_mpesa
create or replace function public.withdraw_to_mpesa(_phone text, _amount numeric, _pin text)
returns json language plpgsql security definer set search_path = public as $$
declare _user uuid := auth.uid(); _balance numeric; _payout_id uuid; _fee numeric := 0; _fee_cfg jsonb;
begin
  if _user is null then raise exception 'Not authenticated'; end if;
  if _amount <= 0 then raise exception 'Amount must be positive'; end if;
  if _phone !~ '^(?:\+?254|0)?[17]\d{8}$' then raise exception 'Invalid phone number'; end if;
  if not public.verify_transaction_pin(_pin) then raise exception 'Invalid PIN'; end if;
  select value into _fee_cfg from public.app_config where key = 'fee_withdraw_mpesa';
  if _fee_cfg is not null then
    _fee := round((_amount * (_fee_cfg->>'percent')::numeric / 100) + (_fee_cfg->>'flat')::numeric, 2);
  end if;
  select balance into _balance from public.wallets where user_id = _user and currency = 'KES' for update;
  if _balance is null then raise exception 'KES wallet not found'; end if;
  if _balance < _amount + _fee then raise exception 'Insufficient balance (incl. fee)'; end if;
  update public.wallets set balance = balance - (_amount + _fee) where user_id = _user and currency = 'KES';
  insert into public.mpesa_payouts (user_id, phone_number, amount, fee, status)
    values (_user, _phone, _amount, _fee, 'pending') returning id into _payout_id;
  insert into public.transactions (user_id, type, amount, currency, status, description)
    values (_user, 'withdrawal', _amount + _fee, 'KES', 'pending', format('M-Pesa withdrawal to %s (fee %s)', _phone, _fee));
  return json_build_object('success', true, 'payout_id', _payout_id, 'fee', _fee);
end; $$;

-- fund_wallet (called by edge fn after payment success)
create or replace function public.fund_wallet(_user_id uuid, _currency wallet_currency, _amount numeric, _method text, _reference text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if _amount <= 0 then raise exception 'Amount must be positive'; end if;
  insert into public.wallets (user_id, currency, balance) values (_user_id, _currency, 0) on conflict (user_id, currency) do nothing;
  update public.wallets set balance = balance + _amount where user_id = _user_id and currency = _currency;
  insert into public.transactions (user_id, type, amount, currency, status, description)
    values (_user_id, 'deposit', _amount, _currency, 'completed', format('Funded via %s (%s)', _method, _reference));
  return json_build_object('success', true);
end; $$;

-- handle_new_user with super_admin auto-promotion
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''));
  if new.email = 'abancode26@gmail.com' then
    insert into public.user_roles (user_id, role) values (new.id, 'super_admin'::app_role) on conflict do nothing;
    insert into public.user_roles (user_id, role) values (new.id, 'admin'::app_role) on conflict do nothing;
  else
    insert into public.user_roles (user_id, role) values (new.id, 'user'::app_role) on conflict do nothing;
  end if;
  insert into public.wallets (user_id, currency, balance) values (new.id, 'USD', 0) on conflict do nothing;
  return new;
end; $$;

-- Promote existing super-admin email if already signed up
do $$
declare _uid uuid;
begin
  select id into _uid from auth.users where email = 'abancode26@gmail.com' limit 1;
  if _uid is not null then
    insert into public.user_roles (user_id, role) values (_uid, 'super_admin'::app_role) on conflict do nothing;
    insert into public.user_roles (user_id, role) values (_uid, 'admin'::app_role) on conflict do nothing;
  end if;
end $$;
