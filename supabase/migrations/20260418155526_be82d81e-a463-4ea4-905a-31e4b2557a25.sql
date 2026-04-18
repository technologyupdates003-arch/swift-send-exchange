-- ============ ENUMS ============
create type public.app_role as enum ('admin', 'user');
create type public.wallet_currency as enum ('KES', 'NGN', 'USD', 'EUR', 'GBP');
create type public.transaction_type as enum ('transfer_in', 'transfer_out', 'deposit', 'withdrawal', 'exchange');
create type public.transaction_status as enum ('pending', 'completed', 'failed');

-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  phone_number text,
  kyc_status text not null default 'pending',
  kyc_tier text not null default 'tier1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "Users view own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users update own profile" on public.profiles
  for update using (auth.uid() = id);
create policy "Users insert own profile" on public.profiles
  for insert with check (auth.uid() = id);

-- ============ USER ROLES ============
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "Users view own roles" on public.user_roles
  for select using (auth.uid() = user_id);
create policy "Admins view all roles" on public.user_roles
  for select using (public.has_role(auth.uid(), 'admin'));
create policy "Admins manage roles" on public.user_roles
  for all using (public.has_role(auth.uid(), 'admin'));

-- ============ WALLETS ============
create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  currency public.wallet_currency not null,
  balance numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, currency)
);
alter table public.wallets enable row level security;

create policy "Users view own wallets" on public.wallets
  for select using (auth.uid() = user_id);
create policy "Users insert own wallets" on public.wallets
  for insert with check (auth.uid() = user_id);
create policy "Admins view all wallets" on public.wallets
  for select using (public.has_role(auth.uid(), 'admin'));

-- ============ TRANSACTIONS ============
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  counterparty_user_id uuid references auth.users(id) on delete set null,
  type public.transaction_type not null,
  amount numeric(18,2) not null,
  currency public.wallet_currency not null,
  status public.transaction_status not null default 'completed',
  description text,
  created_at timestamptz not null default now()
);
alter table public.transactions enable row level security;

create policy "Users view own transactions" on public.transactions
  for select using (auth.uid() = user_id);
create policy "Admins view all transactions" on public.transactions
  for select using (public.has_role(auth.uid(), 'admin'));

create index idx_transactions_user_created on public.transactions(user_id, created_at desc);

-- ============ TRIGGERS ============
create or replace function public.handle_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.handle_updated_at();
create trigger wallets_updated_at before update on public.wallets
  for each row execute function public.handle_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''));
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  insert into public.wallets (user_id, currency, balance) values (new.id, 'USD', 0);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ TRANSFER RPC ============
create or replace function public.transfer_funds(
  _to_email text, _currency public.wallet_currency, _amount numeric, _description text
)
returns json language plpgsql security definer set search_path = public
as $$
declare
  _from_user uuid := auth.uid();
  _to_user uuid;
  _from_balance numeric;
begin
  if _from_user is null then raise exception 'Not authenticated'; end if;
  if _amount <= 0 then raise exception 'Amount must be positive'; end if;

  select id into _to_user from public.profiles where email = _to_email;
  if _to_user is null then raise exception 'Recipient not found'; end if;
  if _to_user = _from_user then raise exception 'Cannot transfer to yourself'; end if;

  select balance into _from_balance from public.wallets
    where user_id = _from_user and currency = _currency for update;
  if _from_balance is null then raise exception 'Sender wallet not found'; end if;
  if _from_balance < _amount then raise exception 'Insufficient balance'; end if;

  insert into public.wallets (user_id, currency, balance)
    values (_to_user, _currency, 0) on conflict (user_id, currency) do nothing;

  update public.wallets set balance = balance - _amount
    where user_id = _from_user and currency = _currency;
  update public.wallets set balance = balance + _amount
    where user_id = _to_user and currency = _currency;

  insert into public.transactions (user_id, counterparty_user_id, type, amount, currency, description)
    values (_from_user, _to_user, 'transfer_out', _amount, _currency, _description);
  insert into public.transactions (user_id, counterparty_user_id, type, amount, currency, description)
    values (_to_user, _from_user, 'transfer_in', _amount, _currency, _description);

  return json_build_object('success', true);
end;
$$;

-- ============ EXCHANGE RATES ============
create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  from_currency public.wallet_currency not null,
  to_currency public.wallet_currency not null,
  rate numeric(18,8) not null,
  updated_at timestamptz not null default now(),
  unique (from_currency, to_currency)
);
alter table public.exchange_rates enable row level security;
create policy "Authenticated read rates" on public.exchange_rates
  for select to authenticated using (true);
create policy "Admins manage rates" on public.exchange_rates
  for all using (public.has_role(auth.uid(), 'admin'));

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

-- ============ KYC ============
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
create policy "Admins view all kyc" on public.kyc_verifications
  for select using (public.has_role(auth.uid(), 'admin'));
create policy "Admins update kyc" on public.kyc_verifications
  for update using (public.has_role(auth.uid(), 'admin'));

-- ============ PAYMENT PROVIDER TX ============
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

-- ============ WITHDRAWAL REQUESTS ============
create table public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  currency public.wallet_currency not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.withdrawal_requests enable row level security;
create policy "Users view own withdrawals" on public.withdrawal_requests
  for select using (auth.uid() = user_id);
create policy "Admins view all withdrawals" on public.withdrawal_requests
  for select using (public.has_role(auth.uid(), 'admin'));
create policy "Admins update withdrawals" on public.withdrawal_requests
  for update using (public.has_role(auth.uid(), 'admin'));

-- ============ ADMIN POLICIES ON PROFILES ============
create policy "Admins view all profiles" on public.profiles
  for select using (public.has_role(auth.uid(), 'admin'));
create policy "Admins update all profiles" on public.profiles
  for update using (public.has_role(auth.uid(), 'admin'));

-- ============ EXCHANGE RPC ============
create or replace function public.exchange_currency(
  _from_currency public.wallet_currency, _to_currency public.wallet_currency, _amount numeric
)
returns json language plpgsql security definer set search_path = public
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
    values (_user, _to_currency, 0) on conflict (user_id, currency) do nothing;

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

-- ============ WITHDRAWAL RPC ============
create or replace function public.request_withdrawal(
  _bank_account_id uuid, _currency public.wallet_currency, _amount numeric
)
returns json language plpgsql security definer set search_path = public
as $$
declare
  _user uuid := auth.uid();
  _balance numeric;
  _bank_owner uuid;
  _withdrawal_id uuid;
begin
  if _user is null then raise exception 'Not authenticated'; end if;
  if _amount <= 0 then raise exception 'Amount must be positive'; end if;

  select user_id into _bank_owner from public.bank_accounts where id = _bank_account_id;
  if _bank_owner is null or _bank_owner <> _user then raise exception 'Invalid bank account'; end if;

  select balance into _balance from public.wallets
    where user_id = _user and currency = _currency for update;
  if _balance is null then raise exception 'Wallet not found'; end if;
  if _balance < _amount then raise exception 'Insufficient balance'; end if;

  update public.wallets set balance = balance - _amount
    where user_id = _user and currency = _currency;

  insert into public.withdrawal_requests (user_id, bank_account_id, amount, currency)
    values (_user, _bank_account_id, _amount, _currency)
    returning id into _withdrawal_id;

  insert into public.transactions (user_id, type, amount, currency, status, description)
    values (_user, 'withdrawal', _amount, _currency, 'pending', 'Bank withdrawal request');

  return json_build_object('success', true, 'withdrawal_id', _withdrawal_id);
end;
$$;