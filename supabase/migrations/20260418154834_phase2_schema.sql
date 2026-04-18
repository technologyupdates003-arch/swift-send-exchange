-- ============ EXCHANGE RATES (seed) ============
create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  from_currency public.wallet_currency not null,
  to_currency public.wallet_currency not null,
  rate numeric(18,8) not null,
  updated_at timestamptz not null default now(),
  unique (from_currency, to_currency)
);
alter table public.exchange_rates enable row level security;
create policy "Anyone authenticated can read rates" on public.exchange_rates
  for select to authenticated using (true);
create policy "Admins manage rates" on public.exchange_rates
  for all using (public.has_role(auth.uid(), 'admin'));

-- Seed indicative rates (base USD = 1.00)
insert into public.exchange_rates (from_currency, to_currency, rate) values
  ('USD','EUR',0.92),('EUR','USD',1.087),
  ('USD','GBP',0.79),('GBP','USD',1.266),
  ('USD','KES',129.0),('KES','USD',0.00775),
  ('USD','NGN',1580.0),('NGN','USD',0.000633),
  ('EUR','GBP',0.859),('GBP','EUR',1.164),
  ('EUR','KES',140.2),('KES','EUR',0.00713),
  ('EUR','NGN',1717.4),('NGN','EUR',0.000582),
  ('GBP','KES',163.3),('KES','GBP',0.00612),
  ('GBP','NGN',2000.0),('NGN','GBP',0.0005),
  ('KES','NGN',12.25),('NGN','KES',0.0816);

-- ============ BANK ACCOUNTS ============
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_number text not null,
  bank_name text not null,
  account_holder_name text not null,
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.bank_accounts enable row level security;

create policy "Users view own bank accounts" on public.bank_accounts
  for select using (auth.uid() = user_id);
create policy "Users insert own bank accounts" on public.bank_accounts
  for insert with check (auth.uid() = user_id);
create policy "Users update own bank accounts" on public.bank_accounts
  for update using (auth.uid() = user_id);
create policy "Users delete own bank accounts" on public.bank_accounts
  for delete using (auth.uid() = user_id);
create policy "Admins view all bank accounts" on public.bank_accounts
  for select using (public.has_role(auth.uid(), 'admin'));

create trigger bank_accounts_updated_at before update on public.bank_accounts
  for each row execute function public.handle_updated_at();

-- ============ KYC VERIFICATIONS ============
create table public.kyc_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  document_type text not null,
  document_number text not null,
  date_of_birth date not null,
  address text not null,
  status text not null default 'pending',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz
);
alter table public.kyc_verifications enable row level security;

create policy "Users view own kyc" on public.kyc_verifications
  for select using (auth.uid() = user_id);
create policy "Users insert own kyc" on public.kyc_verifications
  for insert with check (auth.uid() = user_id);
create policy "Users update own kyc" on public.kyc_verifications
  for update using (auth.uid() = user_id and status = 'pending');
create policy "Admins manage kyc" on public.kyc_verifications
  for all using (public.has_role(auth.uid(), 'admin'));

-- ============ PAYSTACK / INTASEND tx tables (for Phase 2 wiring) ============
create table public.paystack_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reference text not null unique,
  amount numeric(18,2) not null,
  currency public.wallet_currency not null,
  status text not null default 'pending',
  payment_method text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.paystack_transactions enable row level security;
create policy "Users view own paystack tx" on public.paystack_transactions
  for select using (auth.uid() = user_id);
create policy "Admins view all paystack tx" on public.paystack_transactions
  for select using (public.has_role(auth.uid(), 'admin'));

create table public.intasend_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reference text not null unique,
  amount numeric(18,2) not null,
  phone_number text not null,
  status text not null default 'pending',
  transaction_type text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.intasend_transactions enable row level security;
create policy "Users view own intasend tx" on public.intasend_transactions
  for select using (auth.uid() = user_id);
create policy "Admins view all intasend tx" on public.intasend_transactions
  for select using (public.has_role(auth.uid(), 'admin'));

-- ============ EXCHANGE RPC (atomic swap between own wallets) ============
create or replace function public.exchange_currency(
  _from_currency public.wallet_currency,
  _to_currency public.wallet_currency,
  _amount numeric
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  _user uuid := auth.uid();
  _rate numeric;
  _from_balance numeric;
  _converted numeric;
begin
  if _user is null then raise exception 'Not authenticated'; end if;
  if _amount <= 0 then raise exception 'Amount must be positive'; end if;
  if _from_currency = _to_currency then raise exception 'Currencies must differ'; end if;

  select rate into _rate from public.exchange_rates
    where from_currency = _from_currency and to_currency = _to_currency;
  if _rate is null then raise exception 'Rate unavailable'; end if;

  select balance into _from_balance from public.wallets
    where user_id = _user and currency = _from_currency for update;
  if _from_balance is null then raise exception 'Source wallet not found'; end if;
  if _from_balance < _amount then raise exception 'Insufficient balance'; end if;

  insert into public.wallets (user_id, currency, balance)
    values (_user, _to_currency, 0)
    on conflict (user_id, currency) do nothing;

  _converted := round(_amount * _rate, 2);

  update public.wallets set balance = balance - _amount
    where user_id = _user and currency = _from_currency;
  update public.wallets set balance = balance + _converted
    where user_id = _user and currency = _to_currency;

  insert into public.transactions (user_id, type, amount, currency, description)
    values (_user, 'exchange', _amount, _from_currency,
      format('Exchange %s %s -> %s %s @ %s', _amount, _from_currency, _converted, _to_currency, _rate));
  insert into public.transactions (user_id, type, amount, currency, description)
    values (_user, 'exchange', _converted, _to_currency,
      format('Exchange %s %s -> %s %s @ %s', _amount, _from_currency, _converted, _to_currency, _rate));

  return json_build_object('success', true, 'converted', _converted, 'rate', _rate);
end;
$$;
